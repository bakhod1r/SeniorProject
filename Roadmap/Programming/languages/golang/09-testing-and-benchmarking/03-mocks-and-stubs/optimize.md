---
layout: default
title: Mocks and Stubs — Optimize
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/optimize/
---

# Mocks and Stubs — Optimize

[← Back](../)

Performance discussion of test doubles. The summary is short: in unit tests, mock framework overhead is invisible because test runtime is dominated by setup, log, and `t.Cleanup` work. In benchmarks driven through mocked dependencies, framework overhead becomes measurable and can dwarf the work being measured. This file shows where the overhead lives, how to measure it, and how to remove it when it matters.

---

## Where the cost lives

A `testify/mock` method call does roughly:

1. Reflect-walk the registered `ExpectedCalls` slice.
2. For each, compare the method name (string equality), then for each argument run an equality check via `ObjectsAreEqual`.
3. On match, increment the call count and pick the canned `Arguments` return value.
4. Type-assert each return into the caller's expected type via `args.Get(i).(T)`.

A `gomock` method call does:

1. Look up registered expectations indexed by method (no string walk; the generated code dispatches via a typed `Recorder`).
2. Match arguments via `gomock.Matcher.Matches`, which is an interface call.
3. Return statically-typed values without reflection.

A hand-rolled stub does:

1. Whatever your code does — typically a struct field read or a map lookup.

Rough order of magnitude per call (modern Apple Silicon, Go 1.22):

| Style | ns/op | allocs/op |
|-------|-------|-----------|
| Hand-rolled (struct field) | 0.5 - 2 | 0 |
| `gomock` typed mock | 80 - 200 | 1 - 2 |
| `testify/mock` | 600 - 1500 | 4 - 8 |
| `testify/mock` with `MatchedBy` (closure) | 1000 - 2500 | 6 - 10 |

The exact numbers vary across machines and Go versions; the *ratios* are stable. Hand-rolled is 2-3 orders of magnitude faster than `testify/mock`.

---

## Measuring the overhead in your own code

Write a micro-benchmark for the dependency boundary:

```go
package svc

import (
    "context"
    "testing"

    "github.com/stretchr/testify/mock"
)

type Repo interface {
    Find(ctx context.Context, id string) (string, error)
}

// Hand-rolled stub.
type stubRepo struct{ v string }

func (s stubRepo) Find(_ context.Context, _ string) (string, error) { return s.v, nil }

// testify/mock-based mock.
type mockRepo struct{ mock.Mock }

func (m *mockRepo) Find(ctx context.Context, id string) (string, error) {
    args := m.Called(ctx, id)
    return args.String(0), args.Error(1)
}

func BenchmarkRepo_Stub(b *testing.B) {
    r := stubRepo{v: "ok"}
    ctx := context.Background()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = r.Find(ctx, "id")
    }
}

func BenchmarkRepo_Testify(b *testing.B) {
    r := new(mockRepo)
    r.On("Find", mock.Anything, "id").Return("ok", nil)
    ctx := context.Background()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = r.Find(ctx, "id")
    }
}
```

Run:

```bash
go test -bench=. -benchmem -benchtime=2s ./...
```

Expect output similar to:

```
BenchmarkRepo_Stub-8       1000000000     2.1 ns/op    0 B/op    0 allocs/op
BenchmarkRepo_Testify-8       2000000   850   ns/op  240 B/op    6 allocs/op
```

If your service under benchmark performs ~10 mock-dispatched calls per operation, `testify/mock` adds ~8 microseconds per op of pure framework overhead — measurable when the real work is in the low-microsecond range.

---

## When framework overhead matters

1. **Benchmarks driven through mocks.** The mock cost is folded into your reported numbers. A bench that "measures the order pipeline" actually measures the mock library if 90% of calls are mocked.
2. **Property-based or fuzz tests** that exercise millions of iterations through a mocked boundary.
3. **In-test load generators** — a test that simulates 10k concurrent requests against a mocked dependency.
4. **Cache or pool tests** where you measure throughput across a mocked storage layer.

In all four cases, replace the mock with a hand-rolled stub *for the benchmark only*. Keep the framework-backed mock in unit tests where setup ergonomics matter and runtime cost does not.

---

## Codegen vs runtime reflection

A common claim is that `gomock` and `mockery` produce "faster" mocks because they generate code. The reality is:

- `gomock`'s generated code uses *less* reflection than `testify/mock`, so it is genuinely faster per call (3-10x in micro-benchmarks).
- `mockery` generates `testify/mock`-style code; the underlying dispatch is still reflection. Generation saves you typing, not runtime.
- `moq` generates closure-based mocks with no reflection; it is the fastest of the generators, comparable to hand-rolled when the closures are simple.

If you have a hot test path and you want generation, prefer `moq` or `gomock` over `mockery`. If you want absolute minimum overhead, hand-roll.

---

## Allocation pressure

`testify/mock` allocates on every call:

- An `Arguments` slice for the recorded arguments.
- An `[]any` slice for the return values.
- An entry in the `ExpectedCalls` matched list (in some versions).

For benchmarks with `-benchmem`, you will see 4-8 `allocs/op` per mocked call. Multiplied by 10 calls per op and 1M iterations, that is 40-80M allocations — enough to trigger GC stalls that distort the benchmark of the *real* code.

`gomock` allocates a small `Call` lookup per invocation (typically 1-2 allocs). Hand-rolled stubs allocate zero if the methods return pre-computed values.

---

## Reducing setup cost

Sometimes the slow part is not the mock call itself but the *setup* per test. Common offenders:

- `On(...)` called inside a loop registering 1000 expectations.
- `mock.MatchedBy(func(x T) bool { ... })` with a closure that captures large slices.
- Construction of `gomock.Controller` per subtest if you have thousands of subtests.

Mitigations:

1. **Build expectations once.** Use `t.Run` with a fresh controller, but precompute reusable matchers at the top of the file.
2. **Batch `Return` values** with `.Return(...).Times(n)` rather than `n` separate `.Return(...)` lines.
3. **Avoid closures in matchers** when an `Eq` matcher would suffice.

---

## Practical guideline

| Scenario | Use |
|----------|-----|
| Unit test, < 1k calls per test | any (cost invisible) |
| Unit test, > 100k calls per test | hand-rolled or `moq`/`gomock` |
| Benchmark of a layer above mocks | hand-rolled — period |
| Fuzz test exercising the boundary | hand-rolled |
| Integration test with real DB | no mock; use the DB |

The optimization rule for mocks mirrors the optimization rule for everything else in Go: profile first, switch to a faster style only at proven bottlenecks, and keep readability in the common case.

---

## A worked refactor

A team noticed their pipeline benchmark was 4x slower than expected. The pipeline made ~12 calls per op into a `testify/mock`-backed dependency. Profile:

```
12 calls/op * 900 ns/call = 10.8 us/op of mock overhead
Real work per op:           3.2 us/op
Total measured:            ~14 us/op
```

The reported benchmark number was 14 us/op. After replacing the mock with a hand-rolled stub identical in behavior:

```
12 calls/op * 2 ns/call = 24 ns/op of stub overhead
Real work per op:         3.2 us/op
Total measured:           3.2 us/op
```

The "optimization" was not in the production code — it was in the test scaffolding. The production code did not change at all; the team simply learned that their benchmark had been measuring the wrong thing for three months.

---

## Closing note

Mocks are a tool for *test ergonomics*, not for *test performance*. If your tests are slow, look first at I/O (file system, sleeps, network), then at setup cost, then at the mock framework. The mock layer is usually the smallest contributor unless you have driven it into a hot path; when you have, replace it for the benchmark and forget about it for the unit tests.
