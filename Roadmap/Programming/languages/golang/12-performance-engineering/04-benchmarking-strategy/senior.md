# Benchmarking Strategy — Senior

## 1. What changes at senior level

Junior asks "is this faster?" Middle asks "is this faster across inputs?" Senior asks "**is the number I'm reading actually measuring what I think it is?**"

That question has three flavors:

1. Is the compiler letting my work execute, or is the loop body dead code?
2. Are my samples independent and stable enough to make a claim?
3. Am I measuring the workload that matters in production, or a microbench that lies?

This file is about answering all three carefully.

---

## 2. The dead-code problem in detail

Modern Go compilers (`go1.20+`) do non-trivial dead-store elimination. The classic broken benchmark:

```go
func add(a, b int) int { return a + b }

func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        add(1, 2)
    }
}
```

Disassemble the loop and `add` is gone. The function had no side effects, the return value was unused, and the compiler decided it had no obligation to call it.

### The sink pattern

```go
var sinkInt int

func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sinkInt = add(1, 2)
    }
}
```

The compiler cannot prove `sinkInt` is unread (it's package-level, could be observed via reflection, could be touched by other code). The call survives.

For non-trivial return types use the matching sink:

```go
var (
    sinkInt    int
    sinkStr    string
    sinkBytes  []byte
    sinkIface  interface{}
    sinkErr    error
)
```

### `runtime.KeepAlive`

`runtime.KeepAlive(x)` is a different tool: it tells the compiler that `x` must remain reachable up to this point. Use it when you need an *allocation* to survive but don't have a natural sink:

```go
func BenchmarkAlloc(b *testing.B) {
    for i := 0; i < b.N; i++ {
        p := new([1024]byte)
        runtime.KeepAlive(p)
    }
}
```

Without `KeepAlive`, the compiler may stack-allocate `p` (cheap), or determine the allocation is dead and elide it. With `KeepAlive`, the heap allocation happens and shows up in `-benchmem`.

### `b.Loop()` in Go 1.24+

```go
func BenchmarkAdd(b *testing.B) {
    for b.Loop() {
        add(1, 2)
    }
}
```

`b.Loop()` is a function call with intentional opacity: the compiler cannot inline it for benchmark purposes and treats arguments passed to functions in the loop body as escaping. The dead-code problem mostly vanishes. New code on Go 1.24+ should default to this form; older code keeps using sinks.

---

## 3. Confirming the optimization did *not* happen

Before you trust a benchmark, prove the work runs. Three confirmations:

**1. Disassembly.** `go test -c` builds a test binary; `go tool objdump -s 'BenchmarkXxx'` shows the loop. You should see a `CALL add(SB)` (or the inlined arithmetic) inside the loop.

**2. CPU profile.** Run with `-cpuprofile=cpu.out` and `go tool pprof cpu.out`. The function under test should account for a meaningful fraction of CPU. If `runtime.main` and the test framework dominate, your loop body is essentially empty.

**3. Sanity time.** A `1 + 2` benchmark cannot finish in under 1 ns/op (the addition takes ~0.3 ns on x86, but the loop counter and `b.N` test add more). If you see `0.31 ns/op`, the loop is empty.

---

## 4. Stability: variance is the enemy of conclusions

A single sample like `97.4 ns/op` is meaningless without context. Two competing implementations might report `97.4` and `102.1` ns/op — but if the within-run noise is ±8%, neither claim is justified.

Sources of variance, ranked by impact on a typical Linux laptop:

| Source | Typical impact |
|--------|---------------|
| Thermal throttling | 5–30% |
| CPU frequency scaling (turbo / governor) | 5–20% |
| Other processes (Chrome, Slack) | 2–10% |
| ASLR / page allocation luck | 1–3% |
| GC interference | 1–5% |
| Branch predictor / cache state across iterations | 1–5% |
| Scheduler placement | 1–3% |

Mitigations, in order of effectiveness:

1. **Run on Linux**, not macOS or Windows, when accuracy matters. Linux gives you tools to pin and control the system.
2. **Use `perflock`** (`go install github.com/aclements/perflock/cmd/perflock@latest`). It serializes benchmark runs and sets CPU governor temporarily.
3. **Pin governor:** `sudo cpupower frequency-set -g performance`. Disable turbo via `/sys/devices/system/cpu/intel_pstate/no_turbo` (or AMD equivalent).
4. **Pin to CPU:** `taskset -c 2,3 go test -bench=...`. CPU 0 catches IRQs; isolate cores 2–3.
5. **`-count=10`** minimum. Twenty is better for noisy environments.
6. **Long `-benchtime`** (5s or 10s). Each sample becomes more stable, fewer needed.
7. **`runtime.GC()` before each ramp.** Built-in to `testing` since Go 1.21.

A modestly tuned setup can reach 1% coefficient of variation. A CI runner often sits at 10%+; design for that.

---

## 5. Statistical interpretation: what `benchstat` actually computes

`benchstat` performs a **Mann–Whitney U-test** (a non-parametric two-sample test) on each benchmark name. The output:

```
                old time/op    new time/op    delta
Sum-8           97.4ns ± 1%   74.2ns ± 2%   -23.82%  (p=0.000 n=10+10)
```

| Symbol | What it means |
|--------|---------------|
| `97.4ns` | Geometric mean of the 10 old samples. |
| `± 1%` | Coefficient of variation (σ/μ as a percent). |
| `-23.82%` | `(new - old) / old`. |
| `p=0.000` | Probability of seeing this large a difference under the null hypothesis (no real change). |
| `n=10+10` | Sample counts in old and new files. |
| `~` (instead of a delta) | `p ≥ 0.05`; result is "not significantly different". |

The default alpha is **0.05**. A `p < 0.05` is interpreted as "the difference is statistically significant at 5%". This is the standard threshold but does not measure *practical* significance — a 0.5% improvement with `p=0.001` is real but probably not worth shipping.

Tighter thresholds:

- `benchstat -confidence=0.99` requires `p < 0.01` (95th-percentile-confident becomes 99th).
- A team standard might be: report `p < 0.05` deltas; require `p < 0.01` for "the bench got slower" alarms; require ±5% practical effect to act on.

---

## 6. Choosing a representative workload

A microbenchmark answers a microquestion. A function that's 1% of CPU in production won't make the program faster no matter how much you optimize it. Two failure modes:

**The hot-loop trap.** You benchmark `sum := 0; for _, x := range xs { sum += x }` with `xs` of length 10 and report 4 ns/op. The real workload is length 10,000,000, where SIMD vectorization, cache misses, and prefetcher behavior dominate. The microbench is right about the loop overhead but wrong about the relevant operation.

**The cold-cache trap.** You re-allocate the input slice every iteration in your benchmark. In production the slice lives for the whole request. Your benchmark measures allocator throughput; the production code measures memory bandwidth.

**Antidote.** Pick the input size and shape from a production profile. If `pprof` shows the function being called with payloads averaging 4 KiB, benchmark at 4 KiB — not 16 B because it's convenient.

---

## 7. Cache effects and branch prediction

These are the senior-level "benchmarks lie" cases.

### Cache warming

```go
func BenchmarkScan(b *testing.B) {
    data := make([]byte, 64<<20)        // 64 MiB
    for i := 0; i < b.N; i++ {
        scan(data)
    }
}
```

First iteration: cold caches, page faults on every page touched. Time-per-op = 50 ns/byte.
Second iteration onward: warm L3, no page faults. Time-per-op = 0.2 ns/byte.

The driver's ramp-up runs `b.N=1, 100, 10000, 1000000` until one second elapses. The early ramps are dominated by cold-cache cost; the later ramps measure warm-cache cost. The reported number is biased toward the late runs but contains the noise of the early ones.

**Mitigation.** Add a warm-up pass before `b.ResetTimer`:

```go
scan(data)            // warm cache
scan(data)
b.ResetTimer()
for i := 0; i < b.N; i++ {
    scan(data)
}
```

### Branch prediction

```go
func BenchmarkBranch(b *testing.B) {
    nums := make([]int, 1024)
    for i := range nums { nums[i] = i % 256 }       // predictable
    for i := 0; i < b.N; i++ {
        for _, n := range nums {
            if n > 128 { sinkInt++ }
        }
    }
}
```

The CPU branch predictor sees a repeating pattern and predicts perfectly. The same code with `rand.Intn(256)` data runs 4× slower because every branch is a coin flip.

If production data is patterned (sorted, partially sorted, repeating), benchmark with patterned data. If production data is random, benchmark with random data. Mixing them gives meaningless numbers.

### False sharing

```go
type Counter struct {
    a, b int64                          // share a cache line
}
var ctr Counter

func BenchmarkAtomicAdd(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            atomic.AddInt64(&ctr.a, 1)
        }
    })
}
```

If a second benchmark writes to `ctr.b` on another CPU, the cache line bounces between cores even though they touch different fields. Add padding:

```go
type Counter struct {
    a   int64
    _   [56]byte    // pad to 64-byte cache line
    b   int64
}
```

A benchmark that doesn't reproduce production layout will report misleading numbers.

---

## 8. Allocation budgets and `b.ReportAllocs`

`-benchmem` reports `B/op` and `allocs/op`. The senior decision is **what counts as too many**. Three useful budgets:

| Bucket | Budget |
|--------|--------|
| Tight inner loop (encoder, parser, hash) | `0 allocs/op` |
| Request handler kernel (route, validate) | ≤ 5 allocs/op |
| Whole request handler (parse JSON, look up DB, render) | ≤ 50 allocs/op |
| Cold path (startup, config reload) | Don't bother |

Pin a budget in a regression test:

```go
func BenchmarkEncode(b *testing.B) {
    var buf bytes.Buffer
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        buf.Reset()
        enc.Encode(&buf, payload)
    }
}

func TestEncodeAllocBudget(t *testing.T) {
    result := testing.Benchmark(BenchmarkEncode)
    if got := result.AllocsPerOp(); got > 0 {
        t.Fatalf("BenchmarkEncode: %d allocs/op, budget 0", got)
    }
}
```

`testing.Benchmark` lets you run a benchmark from inside a test, including its alloc counters. The `TestEncodeAllocBudget` will fail CI if someone introduces a regression.

---

## 9. Avoiding measurement bias from setup

Three setup-bias patterns and their fixes:

**A. Setup inside the loop, no `StopTimer`.**

```go
// BAD
for i := 0; i < b.N; i++ {
    input := buildBigInput()    // 50% of measured time
    process(input)
}
```

If `buildBigInput` cannot be hoisted (e.g., the test must be stateful), wrap it:

```go
for i := 0; i < b.N; i++ {
    b.StopTimer()
    input := buildBigInput()
    b.StartTimer()
    process(input)
}
```

**B. Allocation in the loop counted as the function's allocs.**

```go
// BAD: the slice allocation shows up under BenchmarkProcess
for i := 0; i < b.N; i++ {
    buf := make([]byte, 4096)
    process(buf)
}
```

If `buf` is the *input*, hoist it. If `buf` is allocated *by* `process`, that's its real cost and you're measuring correctly.

**C. State accumulation.**

```go
// BAD: the map grows during the run; later iterations are slower
m := make(map[int]int)
for i := 0; i < b.N; i++ {
    m[i] = i
}
```

If you must accumulate, either use `b.N`-aware sizing (`make(map[int]int, b.N)`) or reset inside the loop.

---

## 10. Reading variance out of a single run

Some `go test` flags shed light without `benchstat`:

`go test -bench=. -count=1 -benchtime=1000000x ./...`

This pins `b.N` to exactly 1,000,000 across all benchmarks, giving you N independent samples per benchmark function. Combined with `-cpuprofile`, you can see the per-iteration cost distribution. But for actual comparison, `-count=10` with `benchstat` is still the right tool — pinning `b.N` does not reduce inter-sample variance from external sources.

---

## 11. When benchmarks lie: a checklist

Run this against any "surprising" benchmark result before believing it:

| Question | If yes, suspect |
|----------|------------------|
| Is `ns/op` < 1? | Compiler removed your code. |
| Did `allocs/op` drop to 0 with no code change? | Compiler proved escape-free; verify with `-gcflags="-m"`. |
| Did running the same benchmark again give a 20% different number? | High variance; pin governor, add `-count`. |
| Is your benchmark 10× faster than the function in production? | Input is unrealistic (size, shape, randomness). |
| Did `benchstat` print `~`? | The difference is noise. |
| Is `p` between 0.05 and 0.10? | Borderline; needs more samples. |
| Did the benchmark allocate but the function looks pure? | Closure capture or interface boxing. |
| Did optimization win in benchmark but lose in production? | Cache effects, branch patterns, or contention you didn't model. |

---

## 12. Summary

Senior-level benchmarking is largely about **trust**: trust that the compiler didn't elide your code, trust that the variance is bounded, trust that the workload represents reality. Use sinks or `b.Loop()` against dead-code elimination, `perflock`/governor pinning against system noise, `benchstat` with `-count≥10` for significance, and cache/branch-aware workloads against microbench traps. Allocation budgets enforced in CI are the cheapest way to keep gains.

---

## Further reading
- `runtime.KeepAlive` reference: https://pkg.go.dev/runtime#KeepAlive
- Aleksey Shipilëv, *Nanotrusting the Nanotime*: https://shipilev.net/blog/2014/nanotrusting-nanotime/
- `perflock`: https://github.com/aclements/perflock
- Damian Gryski, *go-perfbook*: https://github.com/dgryski/go-perfbook
- Eli Bendersky, *Benchmarking tail latency*: https://eli.thegreenplace.net/2024/benchmarking-tail-latency-with-go/
