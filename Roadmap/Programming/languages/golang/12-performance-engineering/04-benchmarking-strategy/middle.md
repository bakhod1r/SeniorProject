# Benchmarking Strategy — Middle

## 1. Beyond the single benchmark

At the junior level you write a benchmark for one function and read `ns/op`. The middle-level skill is to design a *suite* of benchmarks that answers a real engineering question:

- "Which implementation should we ship?"
- "How does this scale with input size?"
- "Does it hold up under concurrent load?"
- "Did this PR regress anything?"

That requires three tools: **sub-benchmarks**, **parallel benchmarks**, and **`-count` + `benchstat`** for statistical comparison.

---

## 2. Table-driven sub-benchmarks (`b.Run`)

Most useful functions take varying input sizes, and their cost curve is what you really want to see. `b.Run` lets you turn one benchmark into a parameter sweep:

```go
func BenchmarkParse(b *testing.B) {
    sizes := []int{16, 256, 4096, 65536}
    for _, n := range sizes {
        payload := bytes.Repeat([]byte("x"), n)
        b.Run(fmt.Sprintf("size=%d", n), func(b *testing.B) {
            b.SetBytes(int64(n))
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                _ = parse(payload)
            }
        })
    }
}
```

Output:

```
BenchmarkParse/size=16-8       7234567    164 ns/op    97.5 MB/s    0 B/op   0 allocs/op
BenchmarkParse/size=256-8      1532142    782 ns/op   327.4 MB/s    0 B/op   0 allocs/op
BenchmarkParse/size=4096-8       98432  12143 ns/op   337.3 MB/s    0 B/op   0 allocs/op
BenchmarkParse/size=65536-8       6234 192871 ns/op   339.8 MB/s    0 B/op   0 allocs/op
```

Three things to notice:

1. Each sub-benchmark gets its own `b.N`. Tiny inputs run many more iterations than big ones.
2. `b.SetBytes(n)` enables the `MB/s` column — throughput. Above, throughput saturates around 4 KiB; the parser has fixed per-call overhead that dominates small inputs.
3. The sub-benchmark name is slash-joined. You can target just one with `-bench=BenchmarkParse/size=4096$`.

---

## 3. Comparing implementations side by side

Same shape, but the table values are *implementations*, not sizes:

```go
func BenchmarkConcat(b *testing.B) {
    parts := []string{"hello", " ", "world", "!"}

    impls := map[string]func([]string) string{
        "plus":    func(p []string) string { s := ""; for _, v := range p { s += v }; return s },
        "builder": func(p []string) string {
            var sb strings.Builder
            sb.Grow(64)
            for _, v := range p { sb.WriteString(v) }
            return sb.String()
        },
        "join":    func(p []string) string { return strings.Join(p, "") },
    }

    for name, fn := range impls {
        b.Run(name, func(b *testing.B) {
            b.ReportAllocs()
            for i := 0; i < b.N; i++ {
                sink = fn(parts)
            }
        })
    }
}

var sink string
```

A single `go test -bench=BenchmarkConcat -benchmem` now reports three lines that you can read top-to-bottom and pick a winner.

---

## 4. Parallel benchmarks (`b.RunParallel`)

When the thing you're measuring is contended — a lock, an atomic, a shared map, a channel — single-goroutine numbers are misleading. `b.RunParallel` distributes `b.N` across `GOMAXPROCS` goroutines:

```go
func BenchmarkSyncMapGet(b *testing.B) {
    var m sync.Map
    m.Store("hot", 42)

    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _, _ = m.Load("hot")
        }
    })
}
```

Run with `-cpu=1,2,4,8` to see how cost scales:

```bash
go test -bench=BenchmarkSyncMapGet -cpu=1,2,4,8 -run=^$
```

```
BenchmarkSyncMapGet-1     85423567     14.1 ns/op
BenchmarkSyncMapGet-2     61203456     19.6 ns/op
BenchmarkSyncMapGet-4     38234561     31.3 ns/op
BenchmarkSyncMapGet-8     18432567     65.0 ns/op
```

A *good* concurrent data structure stays flat as CPU count rises. The one above (a `sync.Map` with all-reads on one key) actually does well; the rising `ns/op` here is cache-coherence overhead, not lock contention. Compare against a `sync.RWMutex`-protected map and the contrast is dramatic.

Rule of thumb: use `RunParallel` only when concurrency is the question. Single-threaded code in `RunParallel` just adds noise.

---

## 5. `b.SetParallelism` and tuning

`b.SetParallelism(p)` multiplies the goroutine count over `GOMAXPROCS`. Use it when you want to oversubscribe — e.g., when benchmarking a network client whose goroutines spend most of their time blocked:

```go
func BenchmarkHTTPClient(b *testing.B) {
    b.SetParallelism(50)   // ~50× GOMAXPROCS goroutines
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _, _ = http.Get(srv.URL)
        }
    })
}
```

This roughly emulates 50× concurrent requests per CPU — useful for measuring connection-pool behavior. Don't oversubscribe CPU-bound code; it just adds scheduler overhead.

---

## 6. The `-count` flag and why one number lies

A single `go test -bench` run gives you *one* number. That number has noise — typically 3–10% on a laptop, more on shared CI. To know whether 97.4 ns/op is really faster than 102.1 ns/op, you need multiple samples.

`-count=N` repeats each benchmark `N` times:

```bash
go test -bench=. -count=10 -run=^$ ./... | tee bench.txt
```

```
BenchmarkSum-8     289453122   4.10 ns/op
BenchmarkSum-8     288341290   4.13 ns/op
BenchmarkSum-8     291102345   4.07 ns/op
...
```

Ten samples is the conventional minimum for statistical comparison. Less than that and `benchstat` will refuse to draw conclusions.

---

## 7. Statistical comparison with `benchstat`

`benchstat` compares two files of `-count` runs and tells you whether the difference is statistically significant.

```bash
go install golang.org/x/perf/cmd/benchstat@latest

# Capture baseline
git checkout main
go test -bench=. -count=10 -run=^$ ./mathx | tee old.txt

# Capture new code
git checkout feature
go test -bench=. -count=10 -run=^$ ./mathx | tee new.txt

benchstat old.txt new.txt
```

```
                old time/op     new time/op    delta
Sum-8           97.4ns ± 1%    74.2ns ± 2%   -23.82%  (p=0.000 n=10+10)
ParseConfig-8   1.32µs ± 3%    1.30µs ± 4%      ~     (p=0.314 n=10+10)
```

How to read it:

- **`-23.82%`** — `Sum` got 23.82% faster. The `±1%` and `±2%` are coefficients of variation.
- **`p=0.000`** — the difference is statistically significant (p ≪ 0.05).
- **`~`** — `ParseConfig` shows no significant change. `p=0.314` is well above the 0.05 threshold. The 2 ns difference is noise.

Without `benchstat`, you cannot tell a real change from noise. With it, "is this faster?" is an objective question.

---

## 8. Anatomy of a clean comparison run

A reproducible script:

```bash
#!/usr/bin/env bash
set -euo pipefail

PKG="${1:-./...}"
BASE_REF="${BASE_REF:-main}"
HEAD_REF="$(git rev-parse --abbrev-ref HEAD)"

mkdir -p .bench

# Baseline
git checkout "$BASE_REF" --quiet
go test -bench=. -benchmem -count=10 -run=^$ -benchtime=2s "$PKG" > .bench/old.txt

# New
git checkout "$HEAD_REF" --quiet
go test -bench=. -benchmem -count=10 -run=^$ -benchtime=2s "$PKG" > .bench/new.txt

benchstat .bench/old.txt .bench/new.txt
```

Pin yourself to:

- `-count=10` (`benchstat` minimum).
- `-benchtime=2s` (or more) for less noisy per-sample runs.
- `-run=^$` so unit tests don't pollute the output.
- Same binary, same machine, no other load.

---

## 9. Custom metrics with `b.ReportMetric`

You're not stuck with `ns/op`. `b.ReportMetric` adds your own columns:

```go
func BenchmarkRouter(b *testing.B) {
    for i := 0; i < b.N; i++ {
        route("/users/42")
    }
    b.ReportMetric(float64(b.N)/b.Elapsed().Seconds(), "req/s")
}
```

```
BenchmarkRouter-8   23456789   42.6 ns/op   23456789 req/s
```

Custom metrics are first-class to `benchstat` — comparing `req/s` across PRs works the same way as `ns/op`.

Common custom metrics:

- `ns/key` for hash-table operations.
- `MB/s` (use `b.SetBytes` instead — same effect).
- `cache_miss_rate` if you can measure it.
- `p99_ns` for tail-latency studies (computed across iterations yourself).

---

## 10. Common patterns

### Pattern A: pre-allocate input outside the loop

```go
func BenchmarkJSONDecode(b *testing.B) {
    data, _ := json.Marshal(buildBigStruct())
    var dst BigStruct

    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = json.Unmarshal(data, &dst)
    }
}
```

`data` is built once; the loop measures only `Unmarshal`.

### Pattern B: avoid GC interference

```go
func BenchmarkProcess(b *testing.B) {
    runtime.GC()                  // start from a clean baseline
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        process(input)
    }
}
```

Running GC before the timer starts makes the first few iterations more representative — otherwise a stale heap from previous benchmarks can trigger an early collection mid-loop.

### Pattern C: warm up

```go
func BenchmarkCache(b *testing.B) {
    for i := 0; i < 1000; i++ { _ = cache.Get("key") }  // warm
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = cache.Get("key")
    }
}
```

When the code under test has a cold-cache cost (a CPU cache miss, a regex compile), warming up before `ResetTimer` measures the steady state.

### Pattern D: avoid `time.Now()` inside the loop

```go
// BAD
for i := 0; i < b.N; i++ {
    start := time.Now()
    process()
    _ = time.Since(start)
}

// GOOD
for i := 0; i < b.N; i++ {
    process()
}
// The framework already measures total elapsed.
```

`time.Now()` is not free (typically 20–40 ns on Linux). Don't measure inside the measurement.

---

## 11. Sub-benchmarks for table-driven units

Combine `b.Run` with a slice of inputs for a maintainable benchmark family:

```go
type tc struct {
    name string
    data []byte
}

var cases = []tc{
    {"empty", []byte{}},
    {"short", []byte("hello, world")},
    {"long",  bytes.Repeat([]byte("hello, world. "), 1024)},
}

func BenchmarkHash(b *testing.B) {
    for _, c := range cases {
        b.Run(c.name, func(b *testing.B) {
            b.SetBytes(int64(len(c.data)))
            for i := 0; i < b.N; i++ {
                _ = sha256.Sum256(c.data)
            }
        })
    }
}
```

When you later add a fourth case, the bench changes by exactly one line, and `benchstat` will tell you whether the new case behaves like the others.

---

## 12. Summary

The middle-level benchmarking workflow is: write **sub-benchmarks** for size and implementation sweeps; use **`b.RunParallel`** when concurrency is the question; **always run with `-count=10`** so `benchstat` can declare significance. Custom metrics (`b.SetBytes`, `b.ReportMetric`) make domain-specific numbers visible. Patterns like pre-allocation, warm-up, and `b.ResetTimer` keep the measurement honest.

---

## Further reading
- Go blog — subtests & sub-benchmarks: https://go.dev/blog/subtests
- `benchstat` README: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- "Better Go benchmarks": https://eli.thegreenplace.net/2024/benchmarking-tail-latency-with-go/
