# Benchmarking Strategy — Find the Bug

A collection of realistic benchmarking bugs. For each: the symptom (what the numbers say), the cause (what really happened), and the fix. These are the bugs that turn benchmark numbers into lies — and they all look harmless at first glance.

---

## Bug 1: The benchmark that was optimized away

```go
func BenchmarkSquare(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = i * i
    }
}
```

**Symptom.** `BenchmarkSquare-8   1000000000   0.31 ns/op`. The benchmark reports 0.31 ns/op regardless of what's inside the loop.

**Cause.** The compiler sees that the result of `i * i` is discarded (`_ = ...` is a no-op) and removes the multiplication. You are measuring the cost of `i++` and the bounds check, nothing else.

**Fix.** Assign to a package-level sink:

```go
var sinkInt int

func BenchmarkSquare(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sinkInt = i * i
    }
}
```

Or on Go 1.24+, use `b.Loop()` which prevents this class of elimination automatically.

---

## Bug 2: Setup measured as the benchmark

```go
func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        data, err := os.ReadFile("testdata/large.json")
        if err != nil {
            b.Fatal(err)
        }
        _, _ = parse(data)
    }
}
```

**Symptom.** `BenchmarkParse-8   1234   980000 ns/op`. The number looks reasonable but is dominated by file I/O. Comparing two parsers shows no difference because both are <5% of the measured time.

**Cause.** `os.ReadFile` is called inside the loop. Disk reads (or the kernel cache hit, ~200 ns) are part of every iteration.

**Fix.** Hoist the read and `b.ResetTimer`:

```go
func BenchmarkParse(b *testing.B) {
    data, err := os.ReadFile("testdata/large.json")
    if err != nil { b.Fatal(err) }

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = parse(data)
    }
}
```

Or for `parse` that mutates its input, clone with `StopTimer/StartTimer`. The cardinal rule: the timer measures only `parse`, not `parse + ReadFile`.

---

## Bug 3: Variance ignored, "improvement" was noise

```bash
$ go test -bench=BenchmarkSum -run=^$
BenchmarkSum-8   5000000    97.4 ns/op

# made a change
$ go test -bench=BenchmarkSum -run=^$
BenchmarkSum-8   5000000    93.1 ns/op
```

**Symptom.** Two single-run benchmarks differ by 4.4%. The PR claims a performance improvement.

**Cause.** Without multiple samples, you cannot tell a real change from background noise. On most laptops, run-to-run variance is 3–10%. The 4.4% "improvement" is well within that.

**Fix.** Use `-count=10` and `benchstat`:

```bash
$ go test -bench=BenchmarkSum -count=10 -run=^$ > old.txt
# checkout new code
$ go test -bench=BenchmarkSum -count=10 -run=^$ > new.txt
$ benchstat old.txt new.txt
        old time/op    new time/op    delta
Sum-8   97.4ns ± 4%    93.1ns ± 5%       ~     (p=0.342 n=10+10)
```

`~` and `p=0.342` say: no significant change. The 4.4% was noise.

---

## Bug 4: Per-iteration allocation pollutes the count

```go
func BenchmarkProcess(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        buf := make([]byte, 4096)   // allocation here
        process(buf)
    }
}
```

**Symptom.** `BenchmarkProcess-8   1234567   812 ns/op   4096 B/op   1 allocs/op`. The team reads this as "process allocates 4 KiB per call". They optimize `process` repeatedly without effect.

**Cause.** The `make([]byte, 4096)` is the benchmark's setup, not `process`'s work. The allocation is counted against `process` because it's inside the timed loop.

**Fix.** Move the allocation out, or pass a pooled buffer:

```go
func BenchmarkProcess(b *testing.B) {
    buf := make([]byte, 4096)
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        process(buf)
    }
}
```

Now `B/op` and `allocs/op` reflect what `process` actually does. If `process` mutates `buf`, restore it inside `StopTimer/StartTimer` or pre-allocate a pool of fresh buffers.

---

## Bug 5: Constant folding made the function disappear

```go
func parse(s string) int {
    n, _ := strconv.Atoi(s)
    return n
}

func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sinkInt = parse("42")
    }
}
```

**Symptom.** `BenchmarkParse-8   1000000000   0.45 ns/op`. Suspiciously fast for what should be a multi-instruction conversion.

**Cause.** The string `"42"` is a compile-time constant. The compiler inlines `strconv.Atoi`, sees the input is constant, computes `42` at compile time, and stores it directly. There is no work left in the loop.

**Fix.** Break the constant chain. Pass through a `var`:

```go
var input = "42"

func BenchmarkParse(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sinkInt = parse(input)
    }
}
```

Now the compiler cannot fold; `input` is a package-level variable, potentially modifiable.

---

## Bug 6: `b.RunParallel` on single-threaded code

```go
func BenchmarkHash(b *testing.B) {
    data := []byte("hello, world")
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = sha256.Sum256(data)
        }
    })
}
```

**Symptom.** Slower than the equivalent non-parallel benchmark, and the team concludes "hashing doesn't parallelize". They invest weeks in a parallel hash library that doesn't help.

**Cause.** SHA-256 over 12 bytes is ~50 ns of CPU work. The cost of `pb.Next()` (atomic decrement on a shared counter) is comparable. Running on 8 cores hammers the same cache line; throughput goes *down*.

**Fix.** `RunParallel` is for measuring *contended* code. For pure-CPU work with no shared state, use the plain form:

```go
func BenchmarkHash(b *testing.B) {
    data := []byte("hello, world")
    for i := 0; i < b.N; i++ {
        _ = sha256.Sum256(data)
    }
}
```

If you genuinely need to measure throughput across cores, give each goroutine independent work (its own buffer, no shared state):

```go
b.RunParallel(func(pb *testing.PB) {
    local := []byte("hello, world")
    for pb.Next() {
        _ = sha256.Sum256(local)
    }
})
```

---

## Bug 7: The "warm cache" benchmark in a cold-cache world

```go
func BenchmarkScan(b *testing.B) {
    data := make([]byte, 64<<20)
    rand.Read(data)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = scan(data)
    }
}
```

**Symptom.** Reports `200 MB/s`. Production code with the same function reports `35 MB/s`.

**Cause.** The benchmark scans the *same* 64 MiB buffer every iteration. After the first pass, the data sits in L3 cache (or DRAM with prefetcher-friendly access). In production, every request scans a *different* buffer; cache and TLB are cold on each call.

**Fix.** Rotate through a pool large enough to evict the cache:

```go
func BenchmarkScan(b *testing.B) {
    const poolSize = 16
    pool := make([][]byte, poolSize)
    for i := range pool {
        pool[i] = make([]byte, 64<<20)
        rand.Read(pool[i])
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = scan(pool[i%poolSize])
    }
}
```

A pool of 16 × 64 MiB = 1 GiB easily exceeds L3. The number will drop dramatically — and match production.

---

## Bug 8: Branch predictor cheat

```go
func BenchmarkBranchHeavy(b *testing.B) {
    nums := make([]int, 1024)
    for i := range nums { nums[i] = i }   // sorted!
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var sum int
        for _, n := range nums {
            if n > 512 { sum += n }
        }
        sinkInt = sum
    }
}
```

**Symptom.** Reports `190 ns/op`. The same code on random data reports `780 ns/op`. A 4× difference for the same algorithm.

**Cause.** With sorted input, the branch `n > 512` produces a predictable pattern (`false, false, ..., true, true, ...`). The CPU's branch predictor handles it perfectly. Random input gives 50/50 mispredictions, each costing ~10 cycles.

**Fix.** Match production data shape. If real input is random, randomize the benchmark:

```go
rand.New(rand.NewSource(42)).Shuffle(len(nums), func(i, j int) {
    nums[i], nums[j] = nums[j], nums[i]
})
```

If production data is partially sorted, sort partially. The benchmark's input distribution must match.

---

## Bug 9: Closure captures the loop variable (pre-Go-1.22)

```go
func BenchmarkCallback(b *testing.B) {
    for i := 0; i < b.N; i++ {
        callback := func() int { return i * 2 }   // pre-1.22: captures shared i
        sinkInt = callback()
    }
}
```

**Symptom.** `BenchmarkCallback-8   1000000   4500 ns/op   24 B/op   1 allocs/op`. The team is surprised by the allocation.

**Cause.** Before Go 1.22, the closure captures the *address* of `i`. To do that, `i` escapes to the heap, and the closure itself is a heap allocation. Every iteration allocates.

**Fix on 1.22+.** The language fixed this — `i` is now per-iteration. The benchmark allocates zero. If you must support older versions:

```go
for i := 0; i < b.N; i++ {
    i := i   // shadow with a local copy
    callback := func() int { return i * 2 }
    sinkInt = callback()
}
```

---

## Bug 10: `time.Now()` in the loop

```go
func BenchmarkProcess(b *testing.B) {
    var total time.Duration
    for i := 0; i < b.N; i++ {
        start := time.Now()
        process()
        total += time.Since(start)
    }
    b.ReportMetric(float64(total.Nanoseconds())/float64(b.N), "manual_ns/op")
}
```

**Symptom.** Reported `manual_ns/op` is 30–50 ns higher than the framework's `ns/op`.

**Cause.** `time.Now()` is not free. On Linux it's ~25 ns (vDSO `clock_gettime`); on macOS it's ~100 ns. Two calls per iteration adds 50–200 ns to the measurement.

**Fix.** Don't measure inside the measurement. The `testing` framework already records total elapsed time; trust it.

```go
func BenchmarkProcess(b *testing.B) {
    for i := 0; i < b.N; i++ {
        process()
    }
}
```

If you need a custom metric, derive it without per-iteration timestamps:

```go
b.ReportMetric(float64(b.N)/b.Elapsed().Seconds(), "ops/s")
```

---

## Bug 11: Sharing state across iterations

```go
var globalCache = make(map[int]int)

func BenchmarkFib(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sinkInt = fibCached(globalCache, 30)
    }
}
```

**Symptom.** First run: `400000 ns/op`. Second run on the same machine: `28 ns/op`. Numbers are reproducible per process but vary wildly across invocations.

**Cause.** `globalCache` accumulates results. The first iteration does real work and populates the cache; subsequent iterations are cache hits. The reported `ns/op` is heavily skewed toward the cache-hit cost.

**Fix.** Reset state per `b.N` worth of work, or scope the cache:

```go
func BenchmarkFib(b *testing.B) {
    for i := 0; i < b.N; i++ {
        cache := make(map[int]int)
        sinkInt = fibCached(cache, 30)
    }
}
```

But now you're also measuring the map allocation. The deeper fix: separate two benchmarks — one for cold cache, one for warm — and document which you care about.

---

## Bug 12: Comparing benchmarks across machines

```bash
# on developer laptop
$ go test -bench=. -count=10 > local.txt

# on CI runner
$ go test -bench=. -count=10 > ci.txt

$ benchstat local.txt ci.txt
        local time/op   ci time/op   delta
Sum-8   97ns ± 1%       183ns ± 8%   +88.6%
```

**Symptom.** The team thinks the CI runner introduced a 88% regression. They investigate code changes. Find nothing.

**Cause.** `benchstat` is comparing numbers from different hardware. The developer laptop has an M2 Pro at 3.5 GHz with low contention; the CI runner is a shared cloud VM at 2.0 GHz with 7 other tenants. The 88% is the hardware difference, not a code change.

**Fix.** Always run base and head on the same machine, in the same session. The right CI comparison:

```bash
# both on the SAME runner, same session
git checkout main
go test -bench=. -count=10 > base.txt

git checkout pr-branch
go test -bench=. -count=10 > head.txt

benchstat base.txt head.txt
```

If you must compare across machines, factor out the constant difference by benchmarking a stable reference function on both, and report only deltas relative to that reference.

---

## Bug 13: Microbench-only "win" that hurts production

A team optimizes a string formatter:

```go
// before
func format(u User) string {
    return fmt.Sprintf("user=%s id=%d", u.Name, u.ID)
}

// after — manually constructed
func format(u User) string {
    buf := make([]byte, 0, 64)
    buf = append(buf, "user="...)
    buf = append(buf, u.Name...)
    buf = append(buf, " id="...)
    buf = strconv.AppendInt(buf, int64(u.ID), 10)
    return *(*string)(unsafe.Pointer(&buf))   // zero-copy
}
```

**Symptom.** `BenchmarkFormat` reports `40 ns/op` down from `190 ns/op`. PR claims 4.75× speedup. After merge, p99 request latency *rises* 8%.

**Cause.** Two issues:

1. `format` was 0.4% of request CPU. A 4.75× speedup on 0.4% is 0.3% net — invisible in production noise.
2. The `unsafe.Pointer` cast lets `buf` (a slice) be returned as a string. If anyone later appends to a slice header that aliases that backing array, the "string" mutates. This corrupts logging output under load — exactly the bug that drove p99 up.

**Fix.** Two parts:

1. **Quote production share.** Before any optimization, run a production profile. If the function is <5% of CPU, the micro-win won't move SLO numbers; spend effort elsewhere.

2. **Don't ship clever code without measurable ROI.** The `unsafe` trick saved one allocation. Cost: a correctness bug under specific concurrent patterns, plus permanent reviewer overhead.

Revert and use the `fmt.Sprintf` version — or, if formatting is provably hot, use `strings.Builder` (no `unsafe`):

```go
func format(u User) string {
    var sb strings.Builder
    sb.Grow(64)
    sb.WriteString("user=")
    sb.WriteString(u.Name)
    sb.WriteString(" id=")
    sb.WriteString(strconv.Itoa(u.ID))
    return sb.String()
}
```

---

## 14. Summary

Benchmark bugs fall into a few archetypes: the compiler removed the work (dead-code elimination, constant folding), the setup was measured (no `ResetTimer`, allocations in the loop), the comparison was unsound (single sample, cross-machine), the workload didn't match reality (warm cache, sorted-input branch predictor, no contention model), or the win didn't matter (microbench-only optimization). Each scenario above is one engineers hit; recognizing them quickly is most of benchmark debugging.

---

## Further reading
- Dave Cheney, *Five things that make Go fast*: https://dave.cheney.net/2014/06/07/five-things-that-make-go-fast
- Aleksey Shipilëv, *Nanotrusting the Nanotime*: https://shipilev.net/blog/2014/nanotrusting-nanotime/
- Damian Gryski, *go-perfbook*: https://github.com/dgryski/go-perfbook
- `benchstat` semantics: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
