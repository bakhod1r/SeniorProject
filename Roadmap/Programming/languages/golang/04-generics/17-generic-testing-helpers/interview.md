# Generic Testing Helpers — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Difficulty:

- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. What is `t.Helper()` and why do you call it?
**Short:** It marks the function as a test helper so failure messages point at the test, not the helper.

**Long:** Without `t.Helper()`, every `t.Errorf` from inside an assertion helper reports the line **inside the helper**. Adding `t.Helper()` tells the runtime to skip this frame when printing file/line, so the failure points at the actual test that called the helper. Forgetting it is the single most common mistake in test helpers.

### Q2. Write the simplest generic equality helper.
**Short:**
```go
func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

### Q3. Why use `[T comparable]` and not `[T any]`?
**Short:** `any` does not allow `==` or `!=` on `T`.

**Long:** Inside the helper we use `got != want`. The compiler only allows `==` and `!=` if `T`'s constraint guarantees comparability. `comparable` is the built-in constraint for that.

### Q4. When use `Errorf` vs `Fatalf`?
**Short:** `Errorf` continues the test; `Fatalf` stops it immediately.

**Long:** Use `Errorf` for independent assertions (so all failures are reported). Use `Fatalf` when continuing makes no sense — e.g., setup failed or a required value is `nil` and dereferencing would panic.

### Q5. Can `Equal[T comparable]` compare slices?
**Short:** No — slices are not comparable.

**Long:** `[]int`, `[]string`, etc., are not in the `comparable` type set. Use `slices.Equal` directly or write `AssertSliceEqual[T comparable]` that wraps `slices.Equal`.

### Q6. What does `*testing.T` give you?
**Short:** `Errorf`, `Fatalf`, `Run`, `Helper`, `Cleanup`, `Parallel`, etc.

**Long:** It is the per-test handle. Most helpers need `Errorf`/`Fatalf` and `Helper`. Runners also use `Run` to create subtests.

### Q7. How do you write a table-driven test in Go?
**Short:** Define a slice of `(input, want)` rows, loop with `t.Run` for each row.

**Long:**
```go
cases := []struct{ in, want int }{
    {1, 2}, {2, 4},
}
for _, tc := range cases {
    t.Run(fmt.Sprintf("in=%d", tc.in), func(t *testing.T) {
        Equal(t, double(tc.in), tc.want)
    })
}
```

### Q8. Why prefer subtests over a simple loop?
**Short:** Failures show which row failed; you can filter with `-run`; each subtest can run in parallel.

### Q9. What does `errors.Is` do?
**Short:** Walks the wrapping chain to check if an error matches a target.

**Long:** `errors.Is(err, io.EOF)` returns true if `err` is `io.EOF` or wraps it (via `%w`). Tests should use `errors.Is`, not `==`, because of wrapping.

### Q10. Should helpers accept `*testing.T` or `testing.TB`?
**Short:** `testing.TB` if the helper is used in benchmarks; otherwise `*testing.T` is fine.

**Long:** `testing.TB` is the interface satisfied by `T`, `B`, and `F`. Helpers that only assert work in all three. Runners that need `t.Run` must accept `*testing.T`.

---

## Mid-level 🟡

### Q11. Why does `Equal(t, math.NaN(), math.NaN())` always fail?
**Short:** `NaN != NaN` per IEEE 754.

**Long:** `float64` is `comparable` so the call type-checks, but the runtime equality always returns false. For NaN-aware tests, write a `FloatEqual` comparator and use `EqualFunc`.

### Q12. Write `AssertSliceEqual[T comparable]`.
**Short:**
```go
func AssertSliceEqual[T comparable](t *testing.T, got, want []T) {
    t.Helper()
    if !slices.Equal(got, want) {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

### Q13. How do you assert on errors of a specific type?
**Short:** Use `errors.As` and capture the typed error.

**Long:**
```go
func AssertErrorAs[T error](t *testing.T, err error) T {
    t.Helper()
    var target T
    if !errors.As(err, &target) {
        t.Fatalf("expected %T, got %v", target, err)
    }
    return target
}
```

### Q14. Why does `reflect.DeepEqual` not always make a good helper?
**Short:** Slow, walks unexported fields, can panic on funcs, weak error messages.

**Long:** It works for most types but offers no diff. `slices.Equal`, `maps.Equal`, and `go-cmp` produce better messages and handle the edge cases. `DeepEqual` is fine for quick tests and bad for production-grade testlibs.

### Q15. How do you compare two unordered slices?
**Short:** Sort both then compare, or build multisets and compare maps.

**Long:**
```go
func AssertSetEqual[T cmp.Ordered](t *testing.T, got, want []T) {
    t.Helper()
    g, w := slices.Clone(got), slices.Clone(want)
    slices.Sort(g); slices.Sort(w)
    if !slices.Equal(g, w) {
        t.Errorf("set mismatch: got %v, want %v", got, want)
    }
}
```

### Q16. Why do nested helpers need `t.Helper()` in every layer?
**Short:** `Helper()` is per-frame; the runtime climbs the stack until it finds a non-helper frame.

**Long:** If `AssertUser` calls `Equal`, both must call `Helper()`. Otherwise the failure points at whichever didn't, which is rarely the test.

### Q17. Why might you NOT use `t.Parallel()`?
**Short:** Shared state; setup order matters; you want sequential output for debugging.

**Long:** Parallel tests are great for independent rows but break tests that share global state, modify env vars, or depend on order. Inspect each test before sprinkling `Parallel()`.

### Q18. Are generics in tests slower than non-generic?
**Short:** No — for `comparable` types they compile to the same code as inline `==`.

**Long:** Test helpers usually inline well. The generic version of `Equal[T comparable]` produces the same machine code as a non-generic equivalent for the same `T`. The exception is helpers that use `reflect`, which are slow regardless.

### Q19. Why is `interface{}`-based assert worse than generic assert?
**Short:** Loses type safety — `Equal(t, 1, "1")` compiles and fails at runtime.

**Long:** With `[T comparable]`, both arguments must be the same type. The compiler refuses mismatched calls, catching a class of bug at build time.

### Q20. How does `*testing.B` differ from `*testing.T`?
**Short:** `B` adds `b.N`, `b.ResetTimer`, `b.ReportAllocs`; both share `TB` for assertions.

**Long:** Benchmarks loop `b.N` times. Generic assertions accepting `testing.TB` work in benchmarks. Avoid `Errorf` in tight benchmark loops — formatting allocates.

---

## Senior 🔴

### Q21. When is `EqualFunc` better than `Equal`?
**Short:** When the type is not `comparable` or business equality differs from value equality.

**Long:** Slices, maps, structs containing maps, floats with epsilon, domain types with custom equality — all need `EqualFunc[T any](t, got, want, eq)` so the test author supplies the comparator.

### Q22. Why do many testlibs use `cmp.Diff` instead of element-wise comparison?
**Short:** Pretty diffs that highlight only the differences.

**Long:** A struct with 20 fields and 1 mismatch is unreadable as `got X, want Y`. `cmp.Diff` produces a `git diff`-style report showing only the differing path. Generic wrappers like `AssertCmpEqual` keep the API ergonomic.

### Q23. How do you avoid hidden line numbers in helpers?
**Short:** `t.Helper()` in every helper; do not use a stack-frame-skipping wrapper that the runtime cannot see.

**Long:** All helpers in the chain must call `Helper()`. Avoid clever indirection (deferred reporters, goroutine-spawning) — the runtime can lose track of the call frame and report wrong lines.

### Q24. Can a generic helper return values?
**Short:** Yes — extracting helpers like `AssertErrorAs[T error] T` are very useful.

**Long:** A helper that asserts AND returns the typed value collapses two test lines into one. The key is to fail loudly on mismatch (using `Fatalf`) so the returned value is always valid in passing tests.

### Q25. What is the design choice between `(got, want)` and `(want, got)`?
**Short:** Convention. Pick one and document it in `CONTRIBUTING.md`.

**Long:** Stdlib mostly uses `(got, want)`. `cmp.Diff` uses `(want, got)`. Mixing these in a project means someone always reads "got 5, want 3" and wonders which is which. Pick one early.

### Q26. How do you write a helper that asserts a function panics?
**Short:**
```go
func AssertPanics[T any](t *testing.T, fn func()) T {
    t.Helper()
    var got T
    defer func() {
        if r := recover(); r != nil {
            if v, ok := r.(T); ok { got = v; return }
            t.Fatalf("recovered non-T: %v", r)
        } else {
            t.Fatalf("expected panic, got none")
        }
    }()
    fn()
    return got
}
```

**Long:** This catches the panic, ensures it is of type `T`, and returns the value for further assertions. Use it sparingly — most code should not panic on user input.

### Q27. How do you organize fixtures with generics?
**Short:** Typed fixture struct, constructor that takes `t *testing.T`, registered with `t.Cleanup`.

**Long:**
```go
type Fixture[T any] struct{ Value T }

func WithFixture[T any](t *testing.T, build func(*testing.T) (T, func())) Fixture[T] {
    v, clean := build(t)
    t.Cleanup(clean)
    return Fixture[T]{Value: v}
}
```

### Q28. Why might a team migrate away from `testify`?
**Short:** Type safety, runtime overhead, consistency with `slices.Equal`/`maps.Equal`.

**Long:** `testify` predates generics and uses `interface{}` extensively. Generic helpers catch type mismatches at compile time and are usually faster. Migration is gradual: new code uses the new helpers; old code converts during refactors.

### Q29. What is `go-cmp`'s role in a generic testlib?
**Short:** It produces diffs; the generic helper provides `t.Helper()` and standard message formatting.

**Long:** `go-cmp.Diff` is **not** an assertion. The generic wrapper turns it into one, with consistent error format and proper helper-frame handling. Pair them rather than choosing one.

### Q30. How do you test a test helper?
**Short:** Use a fake `testing.TB` or run the helper in a subprocess and inspect output.

**Long:** Helpers can have bugs. The standard way is a small `mockTB` that captures `Errorf` and `Fatalf` calls. Then write tests that call the helper and assert on what the mock recorded.

---

## Expert 🟣

### Q31. Why is `testing.TB` sealed by an unexported method?
**Short:** Prevents fake implementations and protects the testing API.

**Long:** The unexported `private()` method ensures only stdlib types satisfy `TB`. Third-party libraries cannot create their own "testing" types and impersonate `*testing.T`. This protects test orchestration logic — the runtime can rely on `tb` being a real testing handle.

### Q32. How do generics interact with `pprof` for test code?
**Short:** Stenciled bodies appear with `[go.shape.X]` suffixes in flame graphs.

**Long:** A generic `Equal[T comparable]` instantiated for `int` becomes `pkg.Equal[go.shape.int_0]`. Performance work on tests (e.g., reducing setup overhead) can use `pprof` like normal — the suffixes are just naming.

### Q33. Can `t.Run` be made generic?
**Short:** No — `Run` is on `*testing.T` and not parameterized.

**Long:** You can build a generic **runner** that calls `t.Run` internally:
```go
func RunCases[I, O any](t *testing.T, cases []Case[I, O], fn func(I) O, eq func(O, O) bool) {
    for _, tc := range cases {
        t.Run(tc.Name, func(t *testing.T) { ... })
    }
}
```
But `t.Run` itself is not a generic method.

### Q34. Why is `comparable` "looser" since Go 1.20 and how does that affect helpers?
**Short:** Interface types satisfy `comparable` at compile time; runtime panic possible if dynamic types are not comparable.

**Long:** Pre-1.20 helpers `[T comparable]` rejected `interface{}` arguments. From 1.20 they accept them but can panic at runtime if the dynamic value contains a slice, map, or function. Helpers should test for this with `recover` if untrusted types are passed.

### Q35. How do you write a helper that handles both order-sensitive and order-insensitive comparisons?
**Short:** Two helpers: `AssertSliceEqual` (order-sensitive) and `AssertSetEqual` (order-insensitive). Do not combine.

**Long:** A combined helper with a "sort" flag is harder to read at the call site. Two named helpers communicate intent clearly: `AssertSliceEqual(t, got, want)` reads as "in this order"; `AssertSetEqual` reads as "any order".

### Q36. What is the trade-off of returning typed values from helpers?
**Short:** Saves boilerplate but couples the helper to a specific type-checking pattern.

**Long:** `id := AssertErrorAs[*MyErr](t, err).ID` is concise. But it's harder to compose with other tools that expect "void" assertions. A balanced testlib provides both flavours: `AssertErrorAs` (returns) and `AssertErrorIs` (boolean).

### Q37. Should you use `t.Fatalf` inside a goroutine?
**Short:** No — `Fatalf` only stops the current goroutine, not the test.

**Long:** `FailNow` (called by `Fatalf`) terminates the goroutine that called it. From a sub-goroutine, the test continues with a passing status until the main test ends. Use a channel to communicate failures to the main goroutine, or refactor to avoid background work.

### Q38. How do you test that a concurrent helper is goroutine-safe?
**Short:** Run it from many goroutines; use the race detector (`go test -race`).

**Long:** Helpers can have hidden shared state (e.g., a fixture map). The race detector catches data races at runtime. For a pure helper that only calls `t.Errorf`, this is rarely an issue — `*testing.T` is goroutine-safe by spec.

### Q39. Compare a `testify`-style assertion with a generic one for compile-time guarantees.
**Short:** `testify` accepts `interface{}` at runtime; generics enforce types at compile time.

**Long:** `assert.Equal(t, 1, "1")` compiles in `testify` and fails at runtime. `Equal(t, 1, "1")` does not compile with `[T comparable]`. The compile-time check eliminates an entire category of bugs.

### Q40. What is the future of generic testing helpers in Go?
**Short:** Closer integration with stdlib (more helpers in `slices`, `maps`); fluent API stays third-party.

**Long:** The Go team has signalled comfort with adding more helpers to stdlib (`slices.SortedFunc`, `maps.Insert`, etc.). Assertion helpers themselves are unlikely to land in stdlib because conventions vary too much. The pattern of "generic wrapper around `slices.Equal`" will remain the idiom.

---

## Summary

Memorize the **short answers** for fluency. The most common interview themes are:

- `t.Helper()` and why it matters
- `comparable` vs `cmp.Ordered` vs `any`
- `EqualFunc` for non-comparable types
- Order-sensitive vs order-insensitive comparison
- Errors: `Is` vs `As` vs `==`
- Generics vs `testify` trade-offs
- `*testing.T` vs `testing.TB`
- Subtests, parallel execution, loop-variable capture

A confident candidate explains **the why**, not just the syntax. The why is almost always: "type safety + clear failure messages + small API".
