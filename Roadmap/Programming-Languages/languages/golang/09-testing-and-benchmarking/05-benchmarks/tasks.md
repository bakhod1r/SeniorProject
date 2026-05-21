---
layout: default
title: Benchmarks — Tasks
parent: Benchmarks (testing.B)
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/05-benchmarks/tasks/
---

# Benchmarks — Tasks

[← Back](../)

Hands-on exercises. Do them in order: each one introduces a tool or technique you will need in the next.

---

## Task 1 — Write your first benchmark

**Goal.** Produce a working benchmark and read its output.

**Steps.**

1. Create a new directory `bench-task-01` with `go mod init example/bench01`.
2. Add a file `sum.go`:

   ```go
   package bench01

   func Sum(xs []int) int {
       var s int
       for _, x := range xs {
           s += x
       }
       return s
   }
   ```

3. Add a file `sum_test.go`:

   ```go
   package bench01

   import "testing"

   var input = make([]int, 1000)

   func init() {
       for i := range input {
           input[i] = i
       }
   }

   func BenchmarkSum(b *testing.B) {
       for i := 0; i < b.N; i++ {
           _ = Sum(input)
       }
   }
   ```

4. Run `go test -bench=. -benchmem`.

**Deliverable.** Paste the output line. Identify:

- The chosen `b.N`.
- The `ns/op`.
- The `B/op` and `allocs/op`.

**Expected observation.** `allocs/op` should be `0` — `Sum` does not allocate.

---

## Task 2 — Convert to table-driven

**Goal.** Use `b.Run` so a single benchmark function exercises many input sizes.

Refactor `BenchmarkSum` so it runs four sub-benchmarks: sizes `100`, `1_000`, `10_000`, `100_000`.

```go
func BenchmarkSum(b *testing.B) {
    sizes := []int{100, 1_000, 10_000, 100_000}
    for _, n := range sizes {
        xs := make([]int, n)
        for i := range xs {
            xs[i] = i
        }
        b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
            for i := 0; i < b.N; i++ {
                _ = Sum(xs)
            }
        })
    }
}
```

Run with `-benchmem`. **Verify** `ns/op` scales roughly linearly with `n`. If it does not, your benchmark has a bug — find it.

---

## Task 3 — Add `b.SetBytes`

`Sum` reads `n*8` bytes per call (assuming `int` is 8 bytes). Inside each sub-benchmark, call `b.SetBytes(int64(len(xs) * 8))`.

**Deliverable.** Output that now includes a `MB/s` column. The number should be roughly constant across sizes — *that* is the bandwidth your CPU can sustain on a tight integer-sum loop. Note the value.

---

## Task 4 — Setup excluded with `b.ResetTimer`

Build a benchmark whose setup is deliberately slow. Compare with and without `b.ResetTimer`.

```go
func BenchmarkWithSetup(b *testing.B) {
    // Expensive setup we do NOT want timed.
    data := make([]byte, 10_000_000)
    for i := range data {
        data[i] = byte(i)
    }
    // Without ResetTimer: setup time inflates ns/op.
    // With ResetTimer: only the inner work is measured.
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = data[i%len(data)]
    }
}
```

Run the benchmark twice — once with the `b.ResetTimer()` line, once without. **Report** the ratio of `ns/op`. Explain.

---

## Task 5 — Compare two implementations with `benchstat`

**Goal.** Demonstrate a real comparison workflow.

1. Install benchstat:

   ```
   go install golang.org/x/perf/cmd/benchstat@latest
   ```

2. Write two implementations of string concatenation:

   ```go
   package bench05

   import "strings"

   func ConcatPlus(parts []string) string {
       var s string
       for _, p := range parts {
           s += p
       }
       return s
   }

   func ConcatBuilder(parts []string) string {
       var b strings.Builder
       for _, p := range parts {
           b.WriteString(p)
       }
       return b.String()
   }
   ```

3. Benchmark both with the same input:

   ```go
   var parts = make([]string, 100)

   func init() {
       for i := range parts {
           parts[i] = "abcdef"
       }
   }

   func BenchmarkConcatPlus(b *testing.B) {
       b.ReportAllocs()
       for i := 0; i < b.N; i++ {
           _ = ConcatPlus(parts)
       }
   }

   func BenchmarkConcatBuilder(b *testing.B) {
       b.ReportAllocs()
       for i := 0; i < b.N; i++ {
           _ = ConcatBuilder(parts)
       }
   }
   ```

4. Run each ten times:

   ```
   go test -bench=ConcatPlus -count=10 -benchmem > plus.txt
   go test -bench=ConcatBuilder -count=10 -benchmem > builder.txt
   benchstat plus.txt builder.txt
   ```

**Deliverable.** Paste the `benchstat` output. Identify the percentage delta and the p-value.

---

## Task 6 — Identify a benchmark trap

The following benchmark gives `0.27 ns/op`. Explain why and fix it.

```go
package bench06

import "testing"

func square(x int) int { return x * x }

func BenchmarkSquare(b *testing.B) {
    for i := 0; i < b.N; i++ {
        square(i)
    }
}
```

**Expected fix.** Either assign to a package-level sink:

```go
var sink int

func BenchmarkSquare(b *testing.B) {
    var s int
    for i := 0; i < b.N; i++ {
        s = square(i)
    }
    sink = s
}
```

Or use `for b.Loop()` on Go 1.24+. **Run** both forms; compare `ns/op`.

---

## Task 7 — `RunParallel` on a mutex-protected counter

Implement two counters: one with `sync.Mutex`, one with `sync/atomic.Int64`. Benchmark both under contention with `b.RunParallel`.

```go
func BenchmarkMutexCounter(b *testing.B) {
    var (
        mu sync.Mutex
        n  int64
    )
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            mu.Lock()
            n++
            mu.Unlock()
        }
    })
}

func BenchmarkAtomicCounter(b *testing.B) {
    var n atomic.Int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            n.Add(1)
        }
    })
}
```

Run with `-cpu=1,2,4,8` to see scaling. **Report** which scales better.

---

## Task 8 — Profile-collecting run

For the slower of the two counters from Task 7, collect a CPU profile and a mutex profile.

```
go test -bench=BenchmarkMutexCounter -cpuprofile=cpu.out -mutexprofile=mutex.out -count=1
go tool pprof -top cpu.out
go tool pprof -top mutex.out
```

**Deliverable.** The top three entries of each profile. Explain where contention shows up.

---

## Task 9 — Reproducibility experiment

Run Task 5's benchmark **five times** on your laptop, each time with `-count=10`. Save each as `run-N.txt`. Then run:

```
benchstat run-1.txt run-2.txt run-3.txt run-4.txt run-5.txt
```

**Question.** Do the means drift across runs? By how much? This is your laptop's noise floor — improvements smaller than this number are statistically indistinguishable.

---

## Task 10 — Stretch goal: noise reduction

If you are on a Linux box:

1. Set the CPU governor to `performance` (root):

   ```
   echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
   ```

2. Disable turbo (Intel):

   ```
   echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo
   ```

3. Pin to one physical core:

   ```
   taskset -c 3 go test -bench=. -count=10 -benchmem > pinned.txt
   ```

Compare `pinned.txt` to a normal run. The reduction in stddev is what professional benchmarkers buy with this setup.

---

## Submission checklist

- [ ] Task 1 raw output.
- [ ] Task 2 sub-benchmark output for all four sizes.
- [ ] Task 3 `MB/s` numbers and CPU model.
- [ ] Task 4 ns/op ratio with and without `ResetTimer`.
- [ ] Task 5 `benchstat` output.
- [ ] Task 6 fixed benchmark + before/after `ns/op`.
- [ ] Task 7 mutex vs atomic numbers under `-cpu=1,2,4,8`.
- [ ] Task 8 top-3 profile entries.
- [ ] Task 9 noise floor estimate.
- [ ] Task 10 (optional) stddev reduction percentage.
