---
layout: default
title: Benchmarks — Find the Bug
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/find-bug/
---

# Benchmarks — Find the Bug

[← Back](../)

Each snippet below compiles and "runs". Most produce numbers that look plausible — but they are wrong. Identify what is being measured incorrectly and how to fix it.

---

## Bug 1 — The compiler ate my work

```go
package buggy

import "testing"

func hash(x uint64) uint64 {
    x ^= x >> 33
    x *= 0xff51afd7ed558ccd
    x ^= x >> 33
    return x
}

func BenchmarkHash(b *testing.B) {
    for i := 0; i < b.N; i++ {
        hash(uint64(i))
    }
}
```

Reported result: `0.27 ns/op` — implausibly fast for three multiplications.

**Diagnosis.** The return value of `hash` is unused. The compiler inlines `hash`, observes the result is dead, and deletes the entire body. What you measure is `for i := 0; i < N; i++ {}`.

**Fix.**

```go
var sinkU64 uint64

func BenchmarkHash(b *testing.B) {
    var s uint64
    for i := 0; i < b.N; i++ {
        s = hash(uint64(i))
    }
    sinkU64 = s
}
```

Or, on Go 1.24+, switch to `for b.Loop()` which signals to the compiler that side-effects in the body cannot be elided.

---

## Bug 2 — Setup time is inside the loop

```go
func BenchmarkParseJSON(b *testing.B) {
    for i := 0; i < b.N; i++ {
        data, _ := os.ReadFile("testdata/big.json")
        var v map[string]any
        _ = json.Unmarshal(data, &v)
    }
}
```

Reported result: `1.2 ms/op` — but `json.Unmarshal` should be much faster.

**Diagnosis.** Every iteration reads the file from disk. The benchmark is dominated by `os.ReadFile`, not by JSON parsing. The page cache helps a bit, but the syscall overhead alone is in the hundreds of microseconds.

**Fix.** Read once, outside the loop; reset the timer.

```go
func BenchmarkParseJSON(b *testing.B) {
    data, err := os.ReadFile("testdata/big.json")
    if err != nil {
        b.Fatal(err)
    }
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var v map[string]any
        _ = json.Unmarshal(data, &v)
    }
}
```

---

## Bug 3 — `ResetTimer` in the wrong place

```go
func BenchmarkSlow(b *testing.B) {
    b.ResetTimer()
    cache := buildExpensiveCache() // takes 5 seconds
    for i := 0; i < b.N; i++ {
        _ = cache.Lookup(i)
    }
}
```

Reported result: `Lookup` shows `5 ms/op` even though it is a hash lookup.

**Diagnosis.** `ResetTimer` is called *before* `buildExpensiveCache`. The 5-second build is included. Then `b.N` is small (because the benchmark already ran 5 seconds), so the build-time amortises poorly.

**Fix.** Reset *after* the setup.

```go
cache := buildExpensiveCache()
b.ResetTimer()
for i := 0; i < b.N; i++ {
    _ = cache.Lookup(i)
}
```

---

## Bug 4 — `SetBytes` not set on a streaming benchmark

```go
func BenchmarkGzipWrite(b *testing.B) {
    src := make([]byte, 1<<20) // 1 MiB
    rand.Read(src)
    for i := 0; i < b.N; i++ {
        var buf bytes.Buffer
        w := gzip.NewWriter(&buf)
        _, _ = w.Write(src)
        _ = w.Close()
    }
}
```

Reported result: `25 ms/op`. A reviewer asks "how many MB/s is that?" and you cannot answer without arithmetic.

**Diagnosis.** Throughput benchmarks should declare bytes processed so the framework prints `MB/s`. Without it, comparing two compressors is awkward.

**Fix.**

```go
src := make([]byte, 1<<20)
b.SetBytes(int64(len(src)))
b.ResetTimer()
for i := 0; i < b.N; i++ {
    // ...
}
```

---

## Bug 5 — Missing `ReportAllocs` on an allocation-heavy benchmark

```go
func BenchmarkBuildSlice(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := []int{}
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
    }
}
```

Reported result: `4500 ns/op`. The PR review asks "how many allocations?" — you do not know.

**Diagnosis.** Without `b.ReportAllocs()` (or `-benchmem`), the allocation columns are not printed. Heap allocations are a *huge* part of this benchmark — append's growth path triggers several copies.

**Fix.**

```go
func BenchmarkBuildSlice(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s := []int{}
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
    }
}
```

Now you get `B/op` and `allocs/op`, which reveal whether `make([]int, 0, 1000)` would help.

---

## Bug 6 — Parallel benchmark with shared mutable state

```go
func BenchmarkParseInParallel(b *testing.B) {
    var v map[string]any
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            _ = json.Unmarshal([]byte(`{"a":1}`), &v)
        }
    })
}
```

Reported result: occasional `-race` failures; numbers are unstable.

**Diagnosis.** All goroutines write to the same `v` map. This is a race. Even when not detected, it makes the benchmark measure cache-line contention on `v`, not JSON parsing.

**Fix.** Per-goroutine local state.

```go
b.RunParallel(func(pb *testing.PB) {
    var v map[string]any
    for pb.Next() {
        _ = json.Unmarshal([]byte(`{"a":1}`), &v)
    }
})
```

---

## Bug 7 — `StopTimer` allocation surprise

```go
func BenchmarkProcess(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        b.StopTimer()
        input := make([]byte, 1<<16) // 64 KiB per iter
        b.StartTimer()
        _ = process(input)
    }
}
```

Reported result: `B/op` reports `~65600 B/op` even though `process` allocates nothing.

**Diagnosis.** `StopTimer` pauses the *clock*, not the allocation counter. The 64 KiB allocation inside the stopped region still counts toward `B/op`.

**Fix.** Move allocation outside the `b.N` loop entirely; reuse the buffer.

```go
input := make([]byte, 1<<16)
b.ReportAllocs()
b.ResetTimer()
for i := 0; i < b.N; i++ {
    _ = process(input)
}
```

---

## Bug 8 — One run, declared significant

```
$ go test -bench=. -benchmem
BenchmarkFast-8  10000   123 ns/op
$ git checkout feature/optimisation
$ go test -bench=. -benchmem
BenchmarkFast-8  10000   118 ns/op
```

The PR claims "4% improvement". Reviewer is skeptical.

**Diagnosis.** A single run on each branch. The 5 ns difference is well within laptop noise (often ± 5%). Without `-count` and `benchstat`, no significance claim can be made.

**Fix.**

```
go test -bench=BenchmarkFast -count=10 -benchmem > old.txt
git checkout feature/optimisation
go test -bench=BenchmarkFast -count=10 -benchmem > new.txt
benchstat old.txt new.txt
```

Look at `delta` *and* `p`. If `p > 0.05`, the change is not statistically distinguishable.

---

## Bug 9 — Forgot the regex anchor

```
$ go test -bench=Foo
BenchmarkFoo-8         500  3 ms/op
BenchmarkFooBar-8      300  5 ms/op
BenchmarkAnotherFoo-8  200  7 ms/op
```

You wanted only `BenchmarkFoo`. You got all three.

**Diagnosis.** `-bench=Foo` is a regex matched against the full benchmark name. `Foo` matches anywhere in the name. Use `-bench=^BenchmarkFoo$`.

**Fix.**

```
go test -bench='^BenchmarkFoo$'
```

---

## Bug 10 — Sub-benchmark setup inside the closure

```go
func BenchmarkSort(b *testing.B) {
    for _, n := range []int{10, 100, 1000} {
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                data := makeRandomSlice(n) // <-- inside the loop
                sort.Ints(data)
            }
        })
    }
}
```

Reported result: `n=10` is dominated by `makeRandomSlice`, not by sort.

**Diagnosis.** `makeRandomSlice` is inside the timed `b.N` loop. For small `n`, allocation + RNG dominates.

**Fix.** Generate data outside; copy in.

```go
b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
    src := makeRandomSlice(n)
    dst := make([]int, n)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        copy(dst, src)
        sort.Ints(dst)
    }
})
```

`copy` is far cheaper than `makeRandomSlice` and brings the data back to unsorted state each iteration.

---

## Summary

| Bug | Symptom | Fix |
|---|---|---|
| 1 | 0.27 ns/op | Sink variable or `b.Loop` |
| 2 | Setup inside loop | Move outside + `ResetTimer` |
| 3 | `ResetTimer` before setup | Place after setup |
| 4 | No `MB/s` | Add `b.SetBytes` |
| 5 | No alloc data | Add `b.ReportAllocs` |
| 6 | Shared mutable state | Per-goroutine local |
| 7 | Allocations counted in stopped time | Hoist alloc out of loop |
| 8 | One-run "significance" | `-count=10` + `benchstat` |
| 9 | Regex too broad | Anchor with `^...$` |
| 10 | Per-iter setup dominates | Hoist setup, copy cheaply |
