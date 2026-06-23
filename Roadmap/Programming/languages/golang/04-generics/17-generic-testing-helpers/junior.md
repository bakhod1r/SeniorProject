# Generic Testing Helpers — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why do test helpers need generics?" and "What is the smallest type-safe assert?"

Tests in Go are written with the standard `testing` package. For years that meant either **copy-pasting** tiny equality checks for every type or living with `reflect.DeepEqual` and ugly error messages. Once generics arrived in **Go 1.18**, the very first thing the community wrote was a one-line `Equal[T]` helper — because the same shape (`got` vs `want`) repeats in every test in every project ever written.

A generic test helper is a **normal generic function** that takes `*testing.T` plus typed arguments and reports a typed mismatch. There is no new testing API; the magic is just type parameters.

```go
import "testing"

func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

That is the whole idea. After reading this file you will:

- Write `Equal[T comparable]` and know why `t.Helper()` is mandatory
- Run **table-driven tests** that are themselves generic
- Recognize when `comparable` is enough and when you need a custom comparator
- Avoid the "hidden line number" bug that haunts every junior testlib

---

## Prerequisites

- Go 1.18+ installed (`go version`)
- Familiarity with the `testing` package: `func TestX(t *testing.T)`
- Understanding of `t.Errorf`, `t.Fatalf`, and `go test ./...`
- Reading basic generic syntax: `func F[T any](x T)`

---

## Glossary

| Term | Definition |
|------|------------|
| **Test helper** | A function called from a test to centralize an assertion |
| **`t.Helper()`** | Marks the caller as a helper so failures point at the test, not the helper |
| **Assertion** | A check that fails the test with a message when violated |
| **Table-driven test** | A test that loops over a slice of `(input, want)` rows |
| **Fixture** | Pre-built test data shared by multiple cases |
| **`comparable`** | Built-in constraint for types usable with `==` / `!=` |
| **`EqualFunc`** | Helper that takes a custom equality function for non-comparable types |
| **Diff** | A human-readable description of how `got` differs from `want` |
| **Subtest** | A test created with `t.Run("name", func(t *testing.T) {...})` |
| **`testing.T`** | The struct passed into every test, used to report failures |

---

## Core Concepts

### 1. The repeated assertion shape

Every Go test eventually contains lines like:

```go
if got != want {
    t.Errorf("got %v, want %v", got, want)
}
```

That code is the same for `int`, `string`, `User`, anything comparable. Without generics, the only way to centralize it was either `reflect.DeepEqual` (slow, ugly errors) or copy-paste.

### 2. The first generic helper

```go
func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

Three parts matter:

- `[T comparable]` — only types with `==` may pass
- `t.Helper()` — line numbers in failures point at the **test**, not at this function
- `t.Errorf` — fail but keep running; use `t.Fatalf` to stop immediately

### 3. Why `t.Helper()` is non-negotiable

Without `t.Helper()`, every assertion failure reports the line **inside** the helper. Every test failure looks like `assert.go:14`. Adding `t.Helper()` makes the failure point at the actual `Equal(t, got, want)` line in the test — exactly what you want.

```go
// BAD — no t.Helper():  failure reads assert.go:14
// GOOD — with t.Helper(): failure reads user_test.go:42
```

This single line is the difference between a useful helper and a useless one.

### 4. Generic table-driven tests

Table-driven tests are idiomatic Go. With generics, the table itself can be generic:

```go
type case_[I, O any] struct {
    name string
    in   I
    want O
}

func runCases[I, O any](t *testing.T, cases []case_[I, O], fn func(I) O, eq func(O, O) bool) {
    t.Helper()
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            got := fn(tc.in)
            if !eq(got, tc.want) {
                t.Errorf("got %v, want %v", got, tc.want)
            }
        })
    }
}
```

That single helper drives **every** unary function in the codebase.

### 5. `comparable` is enough — until it isn't

`comparable` covers basic types, structs of comparable fields, arrays, and pointers. It rejects slices, maps, and functions. For those, junior code often falls back on `reflect.DeepEqual`. The next file shows better options.

---

## Real-World Analogies

**Analogy 1 — Standardised measuring cups**

A kitchen with no measuring cups copies "1/4 cup" instructions for every recipe. A kitchen with a measuring cup uses the same tool everywhere. `Equal[T]` is the measuring cup of test code.

**Analogy 2 — Customs declaration form**

Every traveller fills out the same form — only the values change. A generic test helper is the form: one shape, many travellers (types).

**Analogy 3 — `t.Helper()` as a signpost**

Imagine reading an error that says "the problem is on Floor 3" but Floor 3 is the elevator shaft, not the office. `t.Helper()` redirects the signpost to the actual office.

**Analogy 4 — Table-driven test as a spreadsheet**

A spreadsheet has rows of inputs and one column of expected outputs. A table-driven test is the same idea expressed in Go. Generics let one runner consume any spreadsheet.

---

## Mental Models

### Model 1 — "One assertion shape, many types"

If you find yourself writing `if got != want { t.Errorf... }` for the third time, replace it with `Equal[T]`.

### Model 2 — "Helpers travel up the stack"

`t.Helper()` is a **stack annotation**. The runtime climbs the call chain looking for the first frame that did not call `Helper()`. That frame is the line shown in the failure message.

### Model 3 — "Two layers: runner + assertion"

Most test code can be split into a **runner** (the loop that drives cases) and **assertions** (the per-case checks). Generics fit both layers naturally.

### Model 4 — "Tests are code too"

A test helper that is hard to read is a bad helper. Pick `Equal[T]` over `Eq[T]`, write doc comments, and keep it close to the test it serves.

---

## Pros & Cons

### Pros

| Benefit | Why it matters |
|---------|----------------|
| **Type-safe assertions** | Compiler rejects mismatched types |
| **No `reflect.DeepEqual`** | Faster, clearer error messages |
| **Less boilerplate** | One helper for every type |
| **Better error messages** | `%v` of typed values, no `interface{}` |
| **Easy to nest** | Helpers calling helpers all use `t.Helper()` |

### Cons

| Drawback | Why it matters |
|----------|----------------|
| **`comparable` is restrictive** | No slices, maps, funcs |
| **Easy to over-build** | A 200-line testlib for a 10-line project is silly |
| **Hides intent** | Wrong constraint = confusing compile errors |
| **`t.Helper()` is invisible** | Forgetting it is a silent bug |

---

## Use Cases

Generic test helpers shine in:

1. **Unit tests** for utility packages where every type is checked
2. **Table-driven tests** with many `(in, want)` pairs
3. **Domain tests** for ID types, Money types, enums (all comparable)
4. **Integration test fixtures** where helpers wrap setup/teardown

Avoid them when:

1. The test is **5 lines long** — the helper adds more code
2. The values are **non-comparable** — `reflect.DeepEqual` may be simpler than custom `EqualFunc`
3. You are migrating from a fluent library (`testify`) — keep the style consistent

---

## Code Examples

### Example 1 — `Equal[T comparable]`

```go
package testutil

import "testing"

func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

Use:

```go
func TestAdd(t *testing.T) {
    Equal(t, 2+3, 5)
    Equal(t, "go"+"pher", "gopher")
}
```

### Example 2 — `NotEqual[T comparable]`

```go
func NotEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got == want {
        t.Errorf("got %v, want != %v", got, want)
    }
}
```

### Example 3 — Generic table-driven runner

```go
type Case[I, O any] struct {
    Name string
    In   I
    Want O
}

func Run[I, O comparable](t *testing.T, cases []Case[I, O], fn func(I) O) {
    t.Helper()
    for _, tc := range cases {
        t.Run(tc.Name, func(t *testing.T) {
            Equal(t, fn(tc.In), tc.Want)
        })
    }
}
```

Use:

```go
func TestDouble(t *testing.T) {
    Run(t, []Case[int, int]{
        {"zero", 0, 0},
        {"one", 1, 2},
        {"neg", -3, -6},
    }, func(x int) int { return x * 2 })
}
```

### Example 4 — Forgetting `t.Helper()`

```go
func badEqual[T comparable](t *testing.T, got, want T) {
    if got != want {
        t.Errorf("got %v, want %v", got, want) // line shown in failure
    }
}
```

Every failure points at this function, not at the test. Always include `t.Helper()`.

### Example 5 — Using `t.Fatalf` for "stop now"

```go
func MustEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Fatalf("got %v, want %v", got, want)
    }
}
```

Use `Fatalf` when the test **cannot continue** — for example, after a setup function fails.

### Example 6 — Asserting on typed enums

```go
type Status int

const (
    StatusOK Status = iota
    StatusFail
)

func TestStatus(t *testing.T) {
    Equal(t, StatusOK, Status(0)) // OK
    // Equal(t, StatusOK, 0)      // compile error — int vs Status
}
```

The compiler refuses mismatched types. That is the headline benefit over `reflect.DeepEqual`.

---

## Coding Patterns

### Pattern 1 — One package per concern

Put helpers in `internal/testutil` (or similar). Keep them small and unexported until proven necessary.

### Pattern 2 — `t *testing.T` first

By convention `*testing.T` is the **first** argument. Mirrors `cmp.Diff`-style helpers and feels native to Go.

### Pattern 3 — Pair with subtests

Inside a runner, always use `t.Run(name, ...)`. That way one bad case does not hide the others.

### Pattern 4 — Keep helpers below 10 lines

If your helper grows logic, it is no longer a helper — it is code that needs its own tests.

---

## Clean Code

- **Name the helper after the assertion**: `Equal`, `NotEqual`, `True`, `Nil`. Avoid `Check`, `Verify`, or other vague verbs.
- **Always start with `t.Helper()`**. Make it the first line.
- **Use `%v`, not `%+v` / `%#v`** unless you need them — readers want short messages.
- **One concern per helper.** `EqualOrNil` is a smell.

```go
// Clean
func Equal[T comparable](t *testing.T, got, want T) { ... }

// Less clean — does too much
func CheckThing[T comparable](t *testing.T, got, want T, msg string, fatal bool) { ... }
```

---

## Product Use / Feature

A generic testlib pays for itself when:

1. **Domain types** are everywhere — `UserID`, `OrderID`, `Money` — and tests assert on them
2. **Migration** is in progress — replacing legacy `interface{}` assertions
3. **Onboarding** — new engineers need a consistent assertion vocabulary
4. **CI logs** are searched by humans — clear messages cut triage time

A small testlib (`Equal`, `NotEqual`, `NoError`, `ErrorIs`) covers 80% of real test code.

---

## Error Handling

Test helpers themselves do not return errors — they call `t.Errorf` or `t.Fatalf`. But two patterns matter:

```go
func NoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err) // Fatal — test cannot continue
    }
}

func HasError(t *testing.T, err error) {
    t.Helper()
    if err == nil {
        t.Errorf("expected error, got nil")   // non-fatal — test can keep going
    }
}
```

Decide deliberately between `Errorf` and `Fatalf`. The wrong choice causes either premature exits or cascading nonsense errors.

---

## Security Considerations

- **Do not log secrets.** A failing `Equal` on a struct with `Password` prints the password into CI logs.
- **Be careful with `reflect.DeepEqual`** — it walks unexported fields and can panic on funcs.
- **Avoid time-based assertions.** A flaky test that compares timestamps invites retries that hide real failures.

---

## Performance Tips

- Generic helpers are **as fast as** the equivalent inline check for `comparable` types.
- `reflect.DeepEqual` is 5-50× slower; a custom `EqualFunc` is usually faster.
- Keep helpers tiny so the inliner can absorb them. A 30-line helper is rarely inlined.
- Do not create a `*testing.T` in the helper; always pass the existing one.

---

## Best Practices

1. **Always call `t.Helper()` first.**
2. **Keep helpers in `internal/testutil`** unless they are reusable across modules.
3. **Use `comparable` for the simple case**, custom `EqualFunc` for the rest.
4. **Prefer subtests over a giant for-loop** — easier to filter with `-run`.
5. **Mirror the stdlib style** — `Equal(t, got, want)` matches `slices.Equal(got, want)`.
6. **Do not over-abstract.** A custom DSL is a maintenance burden.
7. **Document non-obvious helpers** with examples.
8. **Add tests for the testlib** — yes, your assertions need their own tests.

---

## Edge Cases & Pitfalls

### 1. NaN compares non-equal to itself

```go
Equal(t, math.NaN(), math.NaN()) // FAILS — NaN != NaN
```

For floats, use `EqualFunc` with an epsilon comparison.

### 2. Zero-value vs nil

```go
var p *int
Equal(t, p, nil) // compile error — nil has no concrete type
```

Use `if p != nil` or a typed nil: `Equal[*int](t, p, nil)`.

### 3. Slices are not `comparable`

```go
Equal(t, []int{1,2}, []int{1,2}) // compile error
```

Use `slices.Equal` or `AssertSliceEqual` (next file).

### 4. Comparing structs with maps

A struct that contains a map is **not** `comparable`. Use a custom helper.

### 5. Forgetting `t.Helper()` in a wrapper

If `MyAssert` calls `Equal`, **both** must call `t.Helper()`. Otherwise the failure points at `MyAssert`, not the test.

---

## Common Mistakes

1. **Skipping `t.Helper()`.** Every junior testlib repeats this mistake.
2. **Using `t.Errorf` when `t.Fatalf` is needed** (e.g., after a failed setup).
3. **Comparing slices with `Equal`.** Compile error or, if you cast through `any`, a runtime issue.
4. **Building elaborate fluent APIs** before the stdlib-shape helpers are exhausted.
5. **Swapping `got` and `want`.** A bad message reads "got 5, want 5" — keep ordering consistent.
6. **Calling `Equal(t, err, nil)` for errors** — use `NoError` so the message is meaningful.

---

## Common Misconceptions

- **"Generics make test helpers slower."** No — they are as fast as inline code.
- **"`testing` needs special generic support."** No — it is just a normal generic function over `*testing.T`.
- **"`t.Helper()` only matters for nested helpers."** False — it matters for **every** helper.
- **"`comparable` covers everything I need."** No — slices, maps, funcs are out.
- **"My testlib has to look like `testify`."** Not at all. Stdlib-shaped helpers are usually cleaner.

---

## Tricky Points

1. **`t.Helper()` is per-frame.** Each function in the chain that should be skipped must call it.
2. **`Equal(t, nil, nil)` does not compile** — `nil` has no static type.
3. **Generic helpers cannot use `len(s)` on `T any`** — you'd need `~[]E` constraint.
4. **`*testing.T` vs `*testing.B`** — write helpers for both with an interface (`testing.TB`).
5. **`go test -run` works with subtests** by joining names with `/`.

---

## Test

Test yourself before continuing.

1. What does `t.Helper()` do?
2. Why is `[T comparable]` enough for most assertions?
3. Why does `Equal(t, []int{1,2}, []int{1,2})` not compile?
4. When should `MustEqual` use `Fatalf` instead of `Errorf`?
5. What is a generic table-driven runner's signature?
6. What is the standard argument order for an assertion?
7. Why is `reflect.DeepEqual` not ideal for tests?
8. What does `Equal(t, math.NaN(), math.NaN())` do?
9. Where should generic test helpers live in a Go module?
10. Name two failure modes of forgetting `t.Helper()`.

(Answers: 1) marks frame as helper for failure-line reporting; 2) covers basic comparable types; 3) slices are not comparable; 4) when continuing the test makes no sense; 5) `Run[I, O any](t, cases, fn)`; 6) `(t, got, want)`; 7) slow, walks unexported fields, weak messages; 8) fails — NaN != NaN; 9) `internal/testutil`; 10) wrong line in failure; cascading misleading errors.)

---

## Tricky Questions

**Q1.** Why does this assertion compile but always fail?
```go
Equal(t, math.NaN(), math.NaN())
```
**A.** `NaN` is comparable (it is a `float64`) but the IEEE rule says `NaN != NaN`. The constraint allows the call; the runtime always reports a mismatch.

**Q2.** Why does this not compile?
```go
Equal(t, []int{1,2}, []int{1,2})
```
**A.** `[]int` is not `comparable`. Use `slices.Equal` or a custom `AssertSliceEqual`.

**Q3.** What does forgetting `t.Helper()` cost?
**A.** Every failure points at the helper file/line, not the test. Hours of debugging fixed by one missed line.

**Q4.** When is `Errorf` better than `Fatalf`?
**A.** When several independent assertions follow and you want all failures reported, not just the first.

**Q5.** Can a generic helper accept `*testing.B`?
**A.** Yes — change the parameter to `testing.TB`, the interface that both `*T` and `*B` satisfy.

---

## Cheat Sheet

```go
// Smallest useful helper
func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want { t.Errorf("got %v, want %v", got, want) }
}

// Stop the test instead of continuing
func MustEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want { t.Fatalf("got %v, want %v", got, want) }
}

// Generic table-driven test
type Case[I, O any] struct{ Name string; In I; Want O }

// Common stdlib companions
slices.Equal(a, b)
maps.Equal(m1, m2)
errors.Is(err, target)
```

| Helper | Constraint | Stops test? |
|--------|------------|-------------|
| `Equal` | `comparable` | no (`Errorf`) |
| `MustEqual` | `comparable` | yes (`Fatalf`) |
| `NoError` | — | yes |
| `HasError` | — | no |

---

## Self-Assessment Checklist

- [ ] I can write `Equal[T comparable]` from memory.
- [ ] I never forget `t.Helper()`.
- [ ] I know when to use `Errorf` vs `Fatalf`.
- [ ] I can write a generic table-driven runner.
- [ ] I know why slices need their own helper.
- [ ] I prefer stdlib-shaped helpers over fluent DSLs.
- [ ] I keep helpers in `internal/testutil`.
- [ ] I can spot a missing `t.Helper()` in code review.

If you ticked at least 6, move on to `middle.md`.

---

## Summary

Generic test helpers are the **most popular first use of generics** in Go. The reason is simple: every test contains `if got != want { t.Errorf(...) }`. Replacing that with one type-safe `Equal[T comparable]` removes copy-paste, gives clear error messages, and — when paired with `t.Helper()` — points failures at the test, not the helper.

Junior code should start with **two helpers**: `Equal` and `NoError`. Add `MustEqual` and a small table-driven runner only if duplication justifies it. Avoid the temptation to ship a 30-helper "testlib" before you have ten failing tests it would simplify.

The middle file extends this foundation to slices, maps, and error wrapping — the cases where `comparable` is no longer enough.

---

## What You Can Build

After this section you can build:

1. A package-local **`testutil`** with `Equal`, `NotEqual`, `NoError`, `HasError`.
2. A generic **`MustEqual[T]`** that stops the test on mismatch.
3. A generic **table-driven runner** that takes `[]Case[I, O]`.
4. A typed **`AssertEnum`** for your domain enums.
5. A reusable **subtest harness** that names cases automatically.
6. A small **integration test fixture** type with typed setup/teardown.

---

## Further Reading

- [`testing` package documentation](https://pkg.go.dev/testing)
- [The Go Blog — Subtests and Subbenchmarks](https://go.dev/blog/subtests)
- [`t.Helper` reference](https://pkg.go.dev/testing#T.Helper)
- [`slices.Equal`, `maps.Equal`](https://pkg.go.dev/slices)
- [Go 1.18 release notes — generics](https://go.dev/doc/go1.18)
- [Go 1.21 release notes — `slices`, `maps`, `cmp`](https://go.dev/doc/go1.21)

---

## Related Topics

- **9.x Testing & Benchmarking** — broader test culture, not generics-specific
- **4.4 Type Constraints** — when `comparable` is the right choice
- **4.13 `comparable` and `Ordered`** — what each constraint allows
- **4.7 Generic Performance** — why helpers stay cheap

---

## Diagrams & Visual Aids

### The role of `t.Helper()`

```
Without t.Helper():
  test_test.go:42  ─→  Equal(t, got, want)
                          │
  assert.go:14    ◀─── failure reported here  ✗

With t.Helper():
  test_test.go:42  ─→  Equal(t, got, want)  ◀─── failure reported here  ✓
                          │
  assert.go:14
```

### Anatomy of a generic assertion

```
func Equal[T comparable](t *testing.T, got, want T) {
            └─ constraint    └─ first  └─ values
   t.Helper()      ── stack annotation
   if got != want { ── the only branch
       t.Errorf(...) ── soft failure
   }
}
```

### Table-driven runner shape

```
[]Case[I, O]                fn func(I) O
       │                          │
       ▼                          ▼
   for tc := range cases ───► t.Run(tc.Name, func(t *testing.T){
                                  Equal(t, fn(tc.In), tc.Want)
                              })
```
