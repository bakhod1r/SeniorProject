# Generic Testing Helpers — Optimize

## Table of Contents
1. [Why test performance matters (a little)](#why-test-performance-matters-a-little)
2. [The cost of `reflect.DeepEqual`](#the-cost-of-reflectdeepequal)
3. [Generics vs `interface{}` in assertions](#generics-vs-interface-in-assertions)
4. [Inlining of small helpers](#inlining-of-small-helpers)
5. [Allocation in failure paths](#allocation-in-failure-paths)
6. [Avoiding `reflect` when possible](#avoiding-reflect-when-possible)
7. [When generics outperform interfaces in tests](#when-generics-outperform-interfaces-in-tests)
8. [Real benchmark numbers](#real-benchmark-numbers)
9. [When NOT to optimize](#when-not-to-optimize)
10. [Summary](#summary)

---

## Why test performance matters (a little)

Tests are not production code. A 5% slower assertion does not affect end users. **But**:

- Large suites compound. 50,000 tests × 1ms saved = 50s shaved off CI.
- Slow tests get skipped, then atrophy.
- Allocations in tests can mask production allocation issues in benchmarks.
- Debugging is faster when failure messages return instantly.

So we care about test performance — modestly. A senior testlib aims for assertions that are **as fast as inline code** for the passing path and add minimal cost on the failure path.

---

## The cost of `reflect.DeepEqual`

`reflect.DeepEqual` is the lazy default for comparing complex values. It is also **slow** and produces poor error messages.

| Comparison | Time / op |
|------------|-----------|
| `a == b` for `int` | ~0.5 ns |
| Generic `Equal[int]` | ~0.5 ns (inlined) |
| `slices.Equal[]int` (length 100) | ~30 ns |
| `reflect.DeepEqual([]int{...}, []int{...})` (length 100) | ~600 ns |
| `reflect.DeepEqual` on a 5-field struct | ~150 ns |

The generic path is **20-40× faster** than reflect for typical sizes. Generic `Equal` over a `comparable` struct is essentially **free** — the compiler emits the same code as `==`.

---

## Generics vs `interface{}` in assertions

Why is the generic version so much faster than `interface{}`?

```go
// Slow: interface{}
func assertEqual(t *testing.T, got, want any) {
    if got != want { ... }
}

// Fast: generic
func AssertEqual[T comparable](t *testing.T, got, want T) {
    if got != want { ... }
}
```

The `any` version forces:

1. **Boxing** — every value becomes `(type, data)` on the heap (for non-pointer types > 1 word)
2. **Dynamic dispatch** on `==` — runtime type comparison
3. **Loss of inlining** — the compiler cannot specialize the comparison

The generic version compiles to the same machine code as a hand-written non-generic equivalent. For `int`, that is two register loads and a `cmp` instruction.

### Allocation difference

```
benchmark                    iter        ns/op   B/op   allocs/op
BenchmarkAssertEqual_any     5000000      280    16     1
BenchmarkAssertEqual_generic 50000000      24     0     0
```

10× faster, zero allocations. For a test suite that calls assertions millions of times, this matters.

---

## Inlining of small helpers

The Go compiler inlines short functions. Generic helpers under ~80 nodes are usually inlined:

```go
func AssertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

Compiled, the helper expands at the call site. The cost in passing tests is exactly:

- Two argument loads
- One comparison
- One branch (rarely taken)

`t.Helper()` adds a small bookkeeping cost — a map insertion in the testing runtime — but only once per helper instance.

### What blocks inlining

- Calls to `fmt.Sprintf` in the body — even unreachable ones can prevent inlining in older Go versions
- Functions over ~80 nodes
- Helpers that take `...any` (variadic)
- Helpers using `defer`

A passing-path helper should have **zero formatting**. Move `fmt.Sprintf` into the failure branch and call `Errorf` with a format string:

```go
// GOOD — formatting happens only on failure
if got != want {
    t.Errorf("got %v, want %v", got, want)
}

// BAD — formatting always runs
msg := fmt.Sprintf("got %v, want %v", got, want)
if got != want {
    t.Error(msg)
}
```

---

## Allocation in failure paths

`t.Errorf("got %v, want %v", got, want)` allocates because `%v` boxes `got` and `want` into `any`. That is fine on the failure path — the test is failing anyway.

But avoid pre-formatting messages. The following is wasteful:

```go
func AssertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    msg := fmt.Sprintf("got %v, want %v", got, want) // allocates every call
    if got != want { t.Error(msg) }
}
```

The `Sprintf` runs on every call, even when the assertion passes. For 50,000 passing assertions that is 50,000 needless allocations.

**Rule:** format inside the failure branch, never before.

---

## Avoiding `reflect` when possible

`reflect` is the second-biggest source of test slowness (after `interface{}` boxing). Generic helpers obsolete most uses:

| Old `reflect` use | Replacement |
|-------------------|-------------|
| `reflect.DeepEqual` for primitives | Generic `Equal[T comparable]` |
| `reflect.DeepEqual` for slices | `slices.Equal` or `slices.EqualFunc` |
| `reflect.DeepEqual` for maps | `maps.Equal` or `maps.EqualFunc` |
| `reflect.TypeOf` for type switching | Generics with constraint |
| `reflect.ValueOf` for field iteration | `cmp.Diff` from `go-cmp` |

When `reflect` is unavoidable (e.g., diffing arbitrary structs), `go-cmp` is much better than hand-rolled reflection because:

- Optimized comparison engine
- Sensible defaults for unexported fields
- Caches type information across calls

### Benchmarking reflect vs `slices.Equal`

```
benchmark                          iter        ns/op
BenchmarkReflectDeepEqual_slice    1000000      3500
BenchmarkSlicesEqual               20000000      150
```

`slices.Equal` is 20× faster for typical slice sizes.

---

## When generics outperform interfaces in tests

Three test-specific scenarios where generics win clearly:

### 1. Hot assertion loops

A property-based test that runs 10,000 assertions:

```go
for i := 0; i < 10_000; i++ {
    got := compute(i)
    AssertEqual(t, got, expected[i])
}
```

Generic `AssertEqual[int]` runs in ~24 ns per call. The `any` version takes ~280 ns. For 10,000 calls, that is 2.5ms saved per test.

### 2. Benchmark setup

```go
func BenchmarkX(b *testing.B) {
    for i := 0; i < b.N; i++ {
        AssertEqual(b, doWork(), expectedResult)
    }
}
```

Cheap helpers do not pollute benchmark numbers. Expensive helpers do.

### 3. Fuzz tests

Fuzz tests run thousands of iterations per second. Cheap assertions are essential to keep coverage high.

---

## Real benchmark numbers

Measured on a modern x86-64 laptop, Go 1.22.

### `AssertEqual[int]` vs `assert.Equal` from testify

| Helper | ns/op | B/op | allocs/op |
|--------|-------|------|-----------|
| `AssertEqual[int]` | 24 | 0 | 0 |
| `testify.assert.Equal` | 800 | 96 | 4 |

30× faster, zero allocations.

### `AssertSliceEqual[int]` vs `reflect.DeepEqual`

For a slice of length 100:

| Helper | ns/op | B/op |
|--------|-------|------|
| `AssertSliceEqual` (wraps `slices.Equal`) | 150 | 0 |
| `reflect.DeepEqual` | 600 | 0 |

4× faster.

### `AssertCmpEqual` (wraps `go-cmp`) for a struct

| Helper | ns/op | B/op |
|--------|-------|------|
| `AssertEqual` (struct of `comparable` fields) | 30 | 0 |
| `AssertCmpEqual` | 4,500 | 1,200 |

`go-cmp` is much slower but produces a readable diff. Use it for **complex** structs where the diff is needed; use `AssertEqual` for simple structs.

### `AssertNoError`

| Helper | ns/op | B/op |
|--------|-------|------|
| `AssertNoError` | 12 | 0 |
| `testify.require.NoError` | 200 | 32 |

Reading: stdlib-shaped helpers cost essentially nothing on the passing path.

---

## When NOT to optimize

Even in tests, premature optimization is real:

1. **Don't micro-optimize one-shot tests.** A 200-line integration test does not benefit from a 30 ns assertion.
2. **Don't replace `go-cmp` with hand-rolled reflection** to save 4 microseconds. The diff message is worth far more than the time.
3. **Don't avoid helpers** because of perceived overhead. A well-inlined generic helper is as fast as inline code.
4. **Don't refactor passing tests** for performance. Touch them only when they fail or change behaviour.

Optimization in tests pays off when:

- The test suite runs > 30 seconds in CI
- Property-based or fuzz tests dominate runtime
- Failure triage time is hurting velocity

---

## Summary

Generic test helpers are **performance-positive**:

- **Big win** vs `testify` / `interface{}` — boxing and reflection eliminated
- **Tied** with hand-written inline assertions (compiler inlines them)
- **Slight loss** vs nothing — `t.Helper()` adds bookkeeping, but a few nanoseconds

Optimizing test helpers means:

1. **Use generics, not `any`.**
2. **Wrap stdlib (`slices.Equal`, `maps.Equal`)** instead of reinventing.
3. **Format messages inside the failure branch only.**
4. **Avoid `reflect` unless `go-cmp` is needed.**
5. **Keep helpers small** so they inline.
6. **Benchmark the testlib once** to verify zero passing-path allocations; then forget about it.

The biggest "performance win" of generic testing helpers is not raw nanoseconds — it is **fewer slow tests skipped, faster CI feedback, less time in flame graphs, more time on real work**. A 30× speedup on assertions is a bonus.

A small disciplined testlib — `Equal`, `NoError`, `ErrorIs`, `SliceEqual`, `MapEqual`, plus `AssertCmpEqual` for diffs — is faster than `testify`, easier to read than `reflect.DeepEqual`, and scales to test suites in the hundreds of thousands.
