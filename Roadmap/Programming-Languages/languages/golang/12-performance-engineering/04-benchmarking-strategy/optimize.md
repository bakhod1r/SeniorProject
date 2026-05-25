# Benchmarking Strategy — Writing Effective Benchmarks

A benchmark is only useful when it answers a question accurately. This file is about *writing* benchmarks that hold up — under varying inputs, under repeated runs, under reviewers — and avoiding the dozens of subtle traps that turn benchmarks into expensive coincidences.

---

## 1. Start with a question

Before writing one line of benchmark code, write down the question.

| Bad question | Better question |
|--------------|----------------|
| "Is `Foo` fast?" | "Is `Foo` faster than `Bar` for inputs in the range we ship?" |
| "How fast is JSON parsing?" | "What is the per-byte cost of `json.Unmarshal` on payloads of 1 KB, 10 KB, 100 KB?" |
| "Does pooling help?" | "Does pooling reduce allocations per request below 5 for handler `H`?" |

A precise question fixes the workload, the comparison target, and the success metric. Without these three, a benchmark is just a number.

---

## 2. Identify the real workload

Benchmarks must reflect production. Three dimensions:

**Input size.** Pull histogram data from logs or a profile. If 90% of requests are 1–4 KB and 10% are 100 KB+, benchmark both ends, not the median.

**Input shape.** Is the data random? Sorted? Mostly-empty? Repeating? A `strings.IndexByte` benchmark on `"aaaaa..."` measures a different path than on natural English text.

**Concurrency.** Is the function called once per request (single-threaded), once per CPU (parallel-bounded), or thousands of times concurrently (heavily contended)? Each needs a different benchmark form.

A useful exercise: list five real inputs the function sees in production. Make each one a sub-benchmark.

---

## 3. Choose a representative input table

```go
var inputs = []struct {
    name string
    data []byte
}{
    {"small_json_ok",       loadFixture("small_ok.json")},
    {"small_json_err",      loadFixture("small_err.json")},
    {"medium_json_typical", loadFixture("medium.json")},
    {"large_json_typical",  loadFixture("large.json")},
    {"adversarial_deep",    loadFixture("deep_nested.json")},
}

func BenchmarkParseJSON(b *testing.B) {
    for _, in := range inputs {
        b.Run(in.name, func(b *testing.B) {
            b.SetBytes(int64(len(in.data)))
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                _, _ = parse(in.data)
            }
        })
    }
}
```

Now one benchmark answers five questions. The `adversarial_deep` case is especially useful: it catches regressions in the error path that "typical" cases miss.

---

## 4. Hoist setup correctly

The single most common benchmark mistake: setup measured as part of the work.

```go
// BAD
func BenchmarkProcess(b *testing.B) {
    for i := 0; i < b.N; i++ {
        cfg := loadConfig("config.yaml")   // 5 ms per iteration!
        process(cfg)
    }
}

// GOOD
func BenchmarkProcess(b *testing.B) {
    cfg := loadConfig("config.yaml")       // once, outside the timer
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        process(cfg)
    }
}
```

When you cannot hoist (because the function under test consumes its input destructively), use `b.StopTimer`/`b.StartTimer` around the per-iteration setup:

```go
func BenchmarkConsume(b *testing.B) {
    template := buildPayload()
    for i := 0; i < b.N; i++ {
        b.StopTimer()
        input := slices.Clone(template)
        b.StartTimer()
        consume(input)
    }
}
```

But: `StopTimer`/`StartTimer` have non-zero overhead (~50 ns each). For very fast benchmarks they can become 20% of the measurement. In those cases, prefer to fix the design — make `consume` non-destructive, or use a ring buffer of pre-built inputs.

---

## 5. Defeat dead-code elimination

The compiler may remove unused work. Use one of:

**Package-level sink:**

```go
var sinkResult Result

func BenchmarkCompute(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sinkResult = compute(input)
    }
}
```

**`runtime.KeepAlive` for allocations without a natural sink:**

```go
for i := 0; i < b.N; i++ {
    buf := make([]byte, 4096)
    runtime.KeepAlive(buf)
}
```

**`b.Loop()` on Go 1.24+:**

```go
for b.Loop() {
    _ = compute(input)
}
```

Verify the work runs. Two cheap checks:

- Disassemble: `go test -c -o test.bin && go tool objdump -s 'BenchmarkCompute' test.bin`.
- Profile: `go test -bench=BenchmarkCompute -cpuprofile=cpu.out -run=^$` then `go tool pprof -top cpu.out`. The function under test should dominate.

---

## 6. Avoid microbench traps

A microbench measures a tiny operation in isolation. Some traps unique to that scale:

**Cache effects.** A benchmark that re-reads the same 1 KB array forever runs entirely in L1; the production function sweeps 1 GB of working set. Add a warm-up pass or rotate through a larger pool of inputs.

**Branch prediction.** A benchmark that repeats `if x > 0` with the same input every iteration trains the predictor; production data has varying branches. Use varied input.

**Inlining decisions.** The benchmark calls `compute(x)` directly; production calls it via an interface or function pointer. The compiler may inline one and not the other.

**Constant folding.** `compute(42)` with a literal argument can be folded at compile time; `compute(arg)` where `arg` comes from a function call cannot. Pass arguments through a `var x = ...` to break folding.

```go
// Susceptible to folding
for i := 0; i < b.N; i++ {
    _ = parse("hello world")
}

// Folding-resistant
var input = []byte("hello world")
for i := 0; i < b.N; i++ {
    _ = parse(input)
}
```

---

## 7. Pre-allocate inputs

For benchmarks that consume an input slice or buffer:

```go
const N = 1024

func BenchmarkSort(b *testing.B) {
    data := make([][]int, b.N)
    for i := range data {
        data[i] = randomInts(N)
    }
    b.ResetTimer()

    for i := 0; i < b.N; i++ {
        sort.Ints(data[i])
    }
}
```

Each iteration sorts a fresh, independent slice. The allocation cost is excluded by `ResetTimer`. If you used a single slice and re-randomized in the loop, you'd be measuring `randomInts` plus `Sort` — not what you wanted.

Catch: `data` itself is now `b.N` slices of N ints = 8 * N * b.N bytes. For `b.N = 10M`, that's 80 GB. Pre-allocate a *pool* of K independent inputs (e.g., K=1024) and rotate:

```go
const PoolSize = 1024
data := make([][]int, PoolSize)
for i := range data {
    data[i] = randomInts(N)
}
b.ResetTimer()

for i := 0; i < b.N; i++ {
    sort.Ints(data[i%PoolSize])
}
```

Caveat: now you're sorting *already sorted* slices on later iterations. Restore each slice or use a fresh shuffle. There is no free lunch.

---

## 8. Allocation budgets

Decide ahead of time what the alloc budget should be. Encode it in a test:

```go
func TestBenchmarkRouteAllocBudget(t *testing.T) {
    result := testing.Benchmark(BenchmarkRoute)
    if got := result.AllocsPerOp(); got > 3 {
        t.Errorf("BenchmarkRoute: got %d allocs/op, budget 3", got)
    }
    if got := result.AllocedBytesPerOp(); got > 256 {
        t.Errorf("BenchmarkRoute: got %d B/op, budget 256", got)
    }
}
```

The test runs in `go test ./...` (no `-bench` flag needed because `testing.Benchmark` is just a function call). A PR that doubles allocations breaks the test. Reviewers see it before merge.

---

## 9. Concurrent benchmarks done right

`b.RunParallel` is for *contended* code. Three rules:

**Don't share mutable state between iterations.** Each `pb.Next()` call should be independent:

```go
func BenchmarkLookup(b *testing.B) {
    var m sync.Map
    for i := 0; i < 1000; i++ {
        m.Store(i, i)
    }
    b.RunParallel(func(pb *testing.PB) {
        rng := rand.New(rand.NewSource(rand.Int63()))  // per-goroutine RNG
        for pb.Next() {
            m.Load(rng.Intn(1000))
        }
    })
}
```

**Vary the keys across goroutines.** If every goroutine looks up the same key, you're measuring read-only cache coherence, not realistic load.

**Don't use `RunParallel` for single-threaded code.** It adds scheduler overhead and produces less-informative numbers.

---

## 10. Sub-benchmarks for scaling curves

The single best use of `b.Run` is to plot a scaling curve:

```go
func BenchmarkSort(b *testing.B) {
    for _, n := range []int{10, 100, 1000, 10000, 100000} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            data := randomInts(n)
            buf := make([]int, n)
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                copy(buf, data)
                sort.Ints(buf)
            }
        })
    }
}
```

Plot `ns/op` vs `n` on a log-log axis. A line with slope 1 = linear; slope 1.something = `n log n`; slope 2 = quadratic. Surprises here ("we expected O(n log n) but the slope is 1.4 — what's the constant?") drive real investigations.

---

## 11. Statistical hygiene

Three rules that prevent most false-conclusion bugs:

**Always `-count=10` or more.** A single sample is noise. `benchstat` refuses to compare with fewer than 6 samples; 10 is the conventional default.

**Run base and head on the same machine, in the same session, with similar warmup.** Comparing yesterday's bench to today's is risky — kernel updates, BIOS firmware, even ambient temperature affect numbers.

**Reject `p ≥ 0.05` differences.** A 4% improvement with `p=0.30` is not real. Either gather more samples or accept the result is inconclusive.

```bash
go test -bench=. -count=10 -run=^$ ./... | tee old.txt
# make change
go test -bench=. -count=10 -run=^$ ./... | tee new.txt
benchstat old.txt new.txt
```

If you see `~` (not significantly different), the change had no measurable effect. Don't claim it did.

---

## 12. Workload realism techniques

| Technique | When |
|-----------|------|
| Read inputs from a fixtures file | Production-shaped JSON, protobuf payloads |
| Sample inputs from a recorded request log | Heavy-tailed distributions matter |
| Generate randomized inputs with a fixed seed | Stress + reproducibility |
| Use `testing/quick` for property-style inputs | Catches edge cases benchmarks miss |
| Replay anonymized production traffic | Highest fidelity, most expensive |

For most teams, fixture files plus seeded randomness covers 90% of the value. Recorded traffic is the gold standard for systems where input distribution dominates.

---

## 13. When the function does I/O

Pure-CPU benchmarks are easy. Benchmarks of code that touches the network, disk, or kernel are tricky because their cost depends on system state outside the benchmark.

Strategy: **separate the CPU and I/O costs.**

```go
func BenchmarkHTTPHandler(b *testing.B) {
    handler := newHandler()
    req := httptest.NewRequest("GET", "/users/42", nil)
    rec := httptest.NewRecorder()

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        handler.ServeHTTP(rec, req)
        rec.Body.Reset()
    }
}
```

`httptest.NewRecorder` eliminates the kernel and network from the measurement. You're measuring the handler's CPU and allocation behavior in isolation — which is what's reproducible across machines.

For end-to-end timing (with real network, real disk), use a load tester (`vegeta`, `hey`, `wrk`) — not `testing.B`.

---

## 14. The opaque-input trick

When the compiler is too clever — folding constants, inlining everything, proving allocations away — break the chain with an explicit barrier:

```go
//go:noinline
func opaque[T any](v T) T { return v }

func BenchmarkCompute(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = compute(opaque(42))
    }
}
```

`opaque` is `//go:noinline`-marked, so the compiler cannot fold the argument through it. Use sparingly — it's a hack — but it's the cleanest way to defeat over-optimization in some Go versions.

---

## 15. A checklist before you commit a benchmark

- [ ] The benchmark name is descriptive (`BenchmarkRouteRequest_LargePayload`, not `BenchmarkX`).
- [ ] The input shape is documented (a comment names the fixture, or the code makes it obvious).
- [ ] `b.ResetTimer()` is called after setup, before the loop.
- [ ] The loop runs exactly `b.N` (or uses `b.Loop()`) times.
- [ ] Returns are assigned to a sink, or `b.Loop()` is used.
- [ ] `b.ReportAllocs()` is on, or `-benchmem` is part of the team's standard invocation.
- [ ] You ran it with `-count=10` and checked variance.
- [ ] If it's a comparison, you ran `benchstat` and noted `p` value.
- [ ] If on a tracked path, you added it to the tracked suite (build tag or name prefix).
- [ ] An alloc budget test exists if zero/low allocations are the goal.

---

## 16. Common output anti-patterns

| Output | What it suggests |
|--------|------------------|
| `0.31 ns/op` | Compiler removed the work. Add a sink. |
| `10000 iterations, ns/op fluctuates 50%` | Benchmark is too noisy; `-benchtime=5s`, more `-count`, or hardware issue. |
| `allocs/op` jumps from 0 to 4 with no code change | A dependency update added boxing; check `go.sum`. |
| `MB/s` rising as size shrinks | Per-call overhead dominates; the function isn't I/O-bound at small sizes. |
| Sub-benchmarks with wildly different variance | One is dominated by setup, one isn't. Hoist consistently. |
| `b.N` ends very small (e.g., 100) | Each iteration is slow (ms+); use longer `-benchtime` for stability. |

---

## 17. Summary

Effective benchmarks start with a precise question, use a representative workload, and defend against the compiler removing work. Hoist setup, use `b.ResetTimer`, pin sinks, sweep input sizes with `b.Run`, and always confirm significance with `-count=10` and `benchstat`. Allocation budgets enforced as tests are the cheapest way to lock in gains. Microbench wins that ignore production context are worse than no benchmark at all.

---

## Further reading
- Damian Gryski, *go-perfbook*: https://github.com/dgryski/go-perfbook
- Dave Cheney, *High Performance Go*: https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html
- Go blog — *Profile-Guided Optimization*: https://go.dev/blog/pgo
- `runtime.KeepAlive`: https://pkg.go.dev/runtime#KeepAlive
- `go.dev/blog/subtests`: https://go.dev/blog/subtests
