# Generic Performance — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution sketch for each exercise is provided at the end. Each task is designed to **measure** something — code that just compiles is not enough. Run the benchmarks.

---

## Easy 🟢

### Task 1 — Benchmark generic vs concrete `Min`
Write `MinG[T cmp.Ordered]`, `MinC(int, int) int`, and benchmarks for both. Confirm they are within 5% of each other.

### Task 2 — Benchmark generic vs interface `Sum`
Implement `SumGen[T int | float64]`, `SumIface(s []any) int`, and `SumConc(s []int) int`. Benchmark on 1,000,000 elements. Report the relative cost.

### Task 3 — Run `-benchmem`
Take Task 2's benchmarks and add `b.ReportAllocs()`. Identify which version allocates and how many bytes.

### Task 4 — Inspect inlining
Run `go build -gcflags="-m=2" .` on a package that defines `func Add[T int | float64](a, b T) T { return a + b }`. Find the line that says it is inlined.

### Task 5 — Read a stencil name
Write a tiny program that calls `Find[int]` and `Find[string]`, build with `go build -gcflags="-S"`, and locate the two distinct stencil symbols.

---

## Medium 🟡

### Task 6 — `slices.Sort` vs `sort.Slice`
Write benchmarks for sorting 10,000 random `int` values using both APIs. Confirm `slices.Sort` is at least 25% faster.

### Task 7 — Generic vs interface cache
Build `CacheG[K comparable, V any]` and `CacheI` (uses `map[any]any` plus assertions). Benchmark `Get`/`Set` over 100,000 operations. Report ns/op and allocations.

### Task 8 — Escape analysis surprise
Write a generic `Wrap[T any](v T) *T { return &v }`. Confirm via `-gcflags="-m"` that `v` escapes to the heap. Now write a non-generic `WrapInt(v int) *int`. Compare the escape decisions.

### Task 9 — Pointer-shape penalty
Implement `Find[T comparable](s []T, target T) int`. Instantiate it for `int`, `string`, and three custom struct types. Benchmark each. Compare with hand-written equivalents for the slowest case.

### Task 10 — Profile with `pprof`
Take a benchmark from Task 7 and run it with `-cpuprofile=cpu.prof`. Open the profile in `go tool pprof`. Locate the stencil-mangled symbol.

### Task 11 — `slices.SortFunc` migration
Convert this code to use `slices.SortFunc`:
```go
sort.Slice(users, func(i, j int) bool {
    return users[i].Age < users[j].Age
})
```
Benchmark before / after.

### Task 12 — Allocation-free generic
Write `Reverse[T any](s []T) []T` that returns a new slice. Then write a variant `ReverseInPlace[T any](s []T)` that mutates. Benchmark both. Identify the allocation in the first one.

### Task 13 — Map of generic struct keys
Build `Set[T comparable]`. Benchmark `Add`+`Has` for `int` keys vs `Point{x, y int}` keys. Explain the difference.

### Task 14 — Compare with `golang.org/x/exp/constraints`
Implement `Sum` first with a custom `Number` constraint, then with `constraints.Integer | constraints.Float`. Confirm they produce the same machine code (`go tool objdump -s 'Sum'`).

---

## Hard 🔴

### Task 15 — Specialize a hot path
Write a `Cache[K comparable, V any]` and a `userCache` wrapper specialised for `Cache[string, *User]`. Benchmark both. Demonstrate that the specialised wrapper inlines the generic body.

### Task 16 — Detect dictionary indirection
Construct a program where `Find[T comparable]` is instantiated for 5 distinct pointer-shaped types. Verify in `pprof` that all five appear under the same stencil name. Measure the overhead vs a hand-written equivalent.

### Task 17 — `iter.Seq[T]` vs `chan T` vs `chan interface{}`
Implement a producer that yields integers using each of the three patterns. Benchmark consumption of 1,000,000 values. Rank the three by speed.

### Task 18 — Generic JSON decoder
Write `Decode[T any](data []byte) (T, error)` using `encoding/json`. Compare with the equivalent `Decode(data []byte, v any) error`. Discuss whether the generic version saves anything.

### Task 19 — Benchstat with `-count`
Run `go test -bench=. -count=10 > new.txt`. Use `benchstat` to compare against an earlier baseline. Determine if the change is statistically significant.

---

## Expert 🟣

### Task 20 — PGO experiment
Capture a CPU profile of a generic-heavy service. Place it as `default.pgo` and rebuild. Re-benchmark. Show the speedup attributable to PGO.

### Task 21 — Binary size accounting
Use `go tool nm` and `objdump -h` to measure the size attributable to generic stencils in a real binary. Identify the top 5 contributors.

### Task 22 — Detect a regression in a Go upgrade
Run a benchmark suite under Go 1.21 and Go 1.22 (or any two adjacent versions). Identify any benchmark that regressed and explain a likely cause from the release notes.

---

## Solutions

### Solution 1
```go
import "cmp"

func MinG[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
func MinC(a, b int) int {
    if a < b { return a }
    return b
}

func BenchmarkMinG(b *testing.B) { for i := 0; i < b.N; i++ { _ = MinG(3, 5) } }
func BenchmarkMinC(b *testing.B) { for i := 0; i < b.N; i++ { _ = MinC(3, 5) } }
```
Expected: identical or within 1-2 ns/op.

### Solution 2
```go
func SumGen[T int | float64](s []T) T {
    var t T
    for _, v := range s { t += v }
    return t
}
func SumIface(s []any) int {
    t := 0
    for _, v := range s { t += v.(int) }
    return t
}
func SumConc(s []int) int {
    t := 0
    for _, v := range s { t += v }
    return t
}
```
Expected: `SumIface` is 15-30× slower than the others.

### Solution 3
Add `b.ReportAllocs()` at the start of each benchmark function. `SumIface` allocates only if its input is built by boxing; if the slice is pre-built, it does not. The point of the exercise is to **see the difference**.

### Solution 4
The compiler prints lines like:
```
./code.go:5:6: can inline Add[float64]
./code.go:7:14: inlining call to Add[int]
```
Numeric generics inline aggressively.

### Solution 5
After `go build -gcflags="-S" 2>asm.txt`, search for `Find\[`. You will see entries like:
```
"".Find[go.shape.int_0] STEXT ...
"".Find[go.shape.string] STEXT ...
```

### Solution 6
```go
func BenchmarkSortSlice(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := makeRandom(10000)
        b.StartTimer()
        sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
        b.StopTimer()
    }
}
func BenchmarkSlicesSort(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := makeRandom(10000)
        b.StartTimer()
        slices.Sort(s)
        b.StopTimer()
    }
}
```
Expected: `slices.Sort` 25-40% faster.

### Solution 7
```go
type CacheG[K comparable, V any] struct{ m map[K]V }
type CacheI struct{ m map[any]any }

func (c *CacheG[K, V]) Get(k K) (V, bool) { v, ok := c.m[k]; return v, ok }
func (c *CacheI) Get(k any) (any, bool)    { v, ok := c.m[k]; return v, ok }
```
Expected: generic version 2-5× faster, no allocations on `Get`.

### Solution 8
```go
func Wrap[T any](v T) *T { return &v }
func WrapInt(v int) *int { return &v }
```
Both should escape to the heap — the generic version is no worse here. The point is to **read** the escape decision.

### Solution 9
Multiple instantiations share the pointer-shape stencil. Hand-written `findFoo` outperforms `Find[*Foo]` by ~50% in tight loops because of dictionary indirection.

### Solution 10
```bash
go test -bench=Cache -cpuprofile=cpu.prof
go tool pprof -http=:8080 cpu.prof
```
Look for `CacheG[go.shape.string]` (or similar) in the flame graph.

### Solution 11
```go
slices.SortFunc(users, func(a, b User) int { return a.Age - b.Age })
```
Expected: ~30-40% faster on large slices.

### Solution 12
`Reverse` allocates a new slice (`make([]T, n)`). `ReverseInPlace` allocates nothing. Confirm with `b.ReportAllocs()`.

### Solution 13
`Set[int]` is fast — `int` keys hit the fast-path in the runtime hash. `Set[Point]` is slower — `Point` shares a stencil with other 16-byte structs and dictionary calls handle hashing.

### Solution 14
Use `objdump -s 'Sum'` and confirm the body is identical. The constraint type is just a compile-time gate.

### Solution 15
```go
type Cache[K comparable, V any] struct { m map[K]V }
func (c *Cache[K, V]) Get(k K) (V, bool) { v, ok := c.m[k]; return v, ok }

type userCache struct { c Cache[string, *User] }
func (uc *userCache) Get(k string) (*User, bool) { return uc.c.Get(k) }
```
The wrapper should inline `Get` for a single concrete type. Inspect with `-gcflags="-m=2"`.

### Solution 16
Define five struct types containing pointers, instantiate `Find` for each, run benchmarks. Confirm via `pprof` that they appear as one stencil with five dictionary entries. Measure overhead vs `findExactType` for each.

### Solution 17
Roughly:
- `iter.Seq[int]` — fastest, zero allocation.
- `chan int` — second; channel synchronization is the cost.
- `chan interface{}` — slowest; boxing on send.

### Solution 18
The generic `Decode[T]` saves the caller from allocating `T` and casting from `any`, but internally `encoding/json` uses reflection regardless. Net runtime cost is similar; ergonomic gain is real.

### Solution 19
```bash
go test -bench=. -count=10 > old.txt
# make a change
go test -bench=. -count=10 > new.txt
benchstat old.txt new.txt
```
The output shows mean, p-value, and delta. Treat changes with p < 0.05 as significant.

### Solution 20
```bash
go test -bench=. -cpuprofile=default.pgo
go build -pgo=auto .
# benchmark again
```
Expected: 2-5% speedup on hot generic paths.

### Solution 21
```bash
go tool nm -size ./bin/app | sort -k1 -n -r | head -50
```
Look for symbols containing `[go.shape.`. The cumulative size is the generic stencil cost.

### Solution 22
Common cause: a compiler optimization changed in the new release. Read the release notes' "Compiler" section. Examples: PGO defaults, register allocator changes, or improvements to the inliner.

---

## Final notes

Performance work is **iterative** and **measured**. The point of these tasks is not the answer — it is the habit of running the benchmark, reading the profile, and trusting numbers over intuition. A senior Go programmer measures first, theorises later.
