---
layout: default
title: Mocks and Stubs — Interview
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/interview/
---

# Mocks and Stubs — Interview

[← Back](../)

A mix of pure-knowledge and design-judgement questions. The harder questions in Go interviews are almost never "how do I use `gomock`?" — they are "*should* I use `gomock` here, and what would you replace it with?" The answers below assume an interviewer who values idiom and design taste over framework recall.

---

### 1. Define stub, mock, fake, spy, dummy. (Fowler's taxonomy.)

- **Dummy** — passed but never used; fills a parameter slot.
- **Stub** — returns canned answers to calls made during the test; no verification.
- **Spy** — like a stub, but also records what was called for later inspection.
- **Mock** — pre-programmed with expectations that form a behavior specification; the test fails if those expectations are not met.
- **Fake** — a working implementation with a shortcut not suitable for production (e.g. an in-memory database).

In casual conversation people say "mock" for everything; in technical writing, distinguish.

---

### 2. Why does Go culture prefer hand-rolled stubs over mock frameworks?

Three reasons:

1. **Interfaces are structural**, so a stub is just a struct with the right method set; you do not need a framework to declare conformance.
2. **Small consumer-defined interfaces** are idiomatic, so the surface to fake is usually 1-3 methods.
3. **The cognitive cost** of a hand-rolled stub is a single struct definition; the cognitive cost of `gomock` includes a build tag, a generation step, a `make generate` target in CI, and a vocabulary (`EXPECT`, `Eq`, `InOrder`) shared by ~3 people on the team.

When the interface has 30 methods and you faked 4 of them, a generator helps. Until then, it does not.

---

### 3. When would you NOT use a mock framework, even at a large company?

- The interface has fewer than 5 methods *and* you only fake 1-2 of them in tests.
- The interface lives in a leaf package with no other consumers.
- The team has junior members who haven't seen `gomock` before; reading hand-rolled stubs is free, learning a framework is not.
- You suspect you'll need to refactor the interface within a sprint; regenerating mocks for every change costs more than the framework saves.

---

### 4. What's the difference between `golang/mock` and `go.uber.org/mock`?

`golang/mock` was archived by Google in June 2023. `go.uber.org/mock` is the active community fork — same `mockgen` binary, same API, same package layout. New projects should depend on the Uber path. Existing code that imports `github.com/golang/mock/gomock` keeps working but receives no fixes.

---

### 5. Mock vs stub — which one verifies behavior?

A **mock** verifies behavior (it checks that calls happened, in the right order, with the right arguments). A **stub** does not — it only supplies return values so the code under test can proceed. If your test does `mock.AssertCalled(t, "Save", ...)`, the object is being used as a mock. If it only does `On("Save", ...).Return(nil)` and never asserts, it is being used as a stub.

---

### 6. What's the "consumer-defined interface" rule and how does it interact with mocking?

In Go, interfaces belong to the package that *uses* them, not the package that implements them. If `package billing` needs to call `Charge(amount)` on a payment provider, `billing` declares the interface; `stripe.Client` happens to satisfy it. This keeps interfaces small (only the methods `billing` actually uses) and means the fake also only needs those methods. Frameworks like `mockery` can still generate against this small interface — but you'll often find that hand-rolling a 2-method stub is faster than configuring the generator.

---

### 7. Should you mock the database?

Usually no. Two better options exist:

- **In-memory fake repository** — a `map`-backed struct implementing the same repository interface as the real one. Fast, deterministic, refactor-safe.
- **Real database via Docker/testcontainers** — slow but tests the actual SQL dialect, transactions, and constraints.

`sqlmock` (which matches SQL strings) gives you neither the speed of the fake nor the realism of the real DB, and it locks your tests to a specific query phrasing. Use it only when you cannot run a real DB in CI and the in-memory fake would be too divergent.

---

### 8. What is "over-mocking" and why is it harmful?

Over-mocking is when the test specifies so many call expectations that it becomes a mirror of the implementation. The test then fails on any refactor that preserves behavior — e.g. replacing two calls with one batched call, or reordering independent operations. Sign: changing the function body to a logically equivalent rewrite breaks the test, but the user-visible behavior is unchanged. Cure: assert on outputs and side effects, not on the sequence of internal calls.

---

### 9. How do you mock a function (not a method)?

Two patterns:

1. **Assign to a package-level `var`** for the call site, then swap in tests:
   ```go
   var nowFn = time.Now
   func handler() { t := nowFn() ... }
   // in test:
   nowFn = func() time.Time { return fixed }
   ```
2. **Inject as a field**:
   ```go
   type Service struct{ Now func() time.Time }
   ```

Pattern 2 is cleaner because it does not mutate global state and is parallel-test safe.

---

### 10. What problem does `testify/mock`'s `Maybe()` solve?

`AssertExpectations` fails if any registered call was not invoked. If a call is *optional* (e.g. a log write that may or may not happen), `On(...).Maybe()` tells the framework that absence is acceptable. Without it you would have to use `On` only conditionally inside the test, which is awkward.

---

### 11. Explain `gomock.InOrder` vs `.After`.

`InOrder(a, b, c)` is sugar for `b.After(a); c.After(b)`. `.After(otherCall)` adds a single happens-before edge between two expectations. Use `InOrder` for linear sequences; use `.After` for diamonds (`d` must follow both `b` and `c` but `b` and `c` are independent).

---

### 12. What happens if you forget `ctrl.Finish()` in `gomock`?

Pre Go 1.14: missed expectations are not reported and the test passes silently — a classic source of false-green CI. Post 1.14 with the Uber fork: `gomock.NewController(t)` registers a `t.Cleanup` that calls `Finish` automatically. So in 2024+ code, you generally do not need to call `Finish` yourself.

---

### 13. Compare `testify/mock` and `gomock` on type safety.

`testify/mock` uses `interface{}` for arguments and returns — typos and type mismatches surface at runtime as panics or test failures. `gomock` generates typed wrappers, so `m.EXPECT().FindByID("42").Return(&User{}, nil)` is compile-checked. For codebases that change interfaces often, `gomock` catches more mistakes; for codebases with stable interfaces, the difference is academic.

---

### 14. Can you race-detect tests that use shared mocks across goroutines?

You can, and you should run with `-race`. Both `testify/mock` and `gomock` synchronize internal state on each call, so most races involve *user* mistakes — e.g. closing over a captured variable inside a `.Run(func)` callback that two goroutines hit simultaneously. The race detector flags the user code, not the framework.

---

### 15. How would you mock an HTTP client without monkey-patching the global transport?

Inject a `*http.Client` (or, better, a small interface like `type Doer interface{ Do(*http.Request) (*http.Response, error) }`) into the service. In tests, supply a `Doer` whose `Do` returns canned responses, or pass `&http.Client{Transport: &myRoundTripper{}}` with a custom `RoundTripper`. Both approaches are parallel-test safe and require no third-party dependency.

---

### 16. What is an "expectation leak"?

When a test registers an expectation but a code path skips the call that would satisfy it, and the test framework silently passes. In `testify/mock` this happens if you forget `AssertExpectations(t)`. In `gomock` it happens only if you bypass the controller. Always finish with the assertion call.

---

### 17. What is a "fake" repository and why is it sometimes better than a mock?

A fake repository is a struct that implements the repository interface using an in-memory `map`. Tests against the fake exercise the repository contract (Save/FindByID/List) without simulating each call. This means you can test the full service logic — including code paths that read what they just wrote — without rewriting expectations for every flow. The fake is shared across many tests; mocks have to be configured per test.

---

### 18. When does mock-framework reflection cost matter?

Almost never for unit tests (test runtime is dominated by setup, not mock calls). It matters when:

- You drive *benchmarks* through mocked dependencies — reflection adds tens to hundreds of ns per call.
- You write contract-style tests with millions of generated cases.
- You use mocks inside `for` loops that simulate hot paths.

For the first two, use hand-rolled stubs in the benchmark to remove reflection from the measurement.

---

### 19. What's `mockery`'s `with-expecter`?

A generation option that produces a typed `EXPECT()` wrapper around `testify/mock`'s `On`. Without it: `m.On("FindByID", "42").Return(...)`. With it: `m.EXPECT().FindByID("42").Return(...)`. Same runtime behavior, but typo-proof method names and compile-checked arguments. Recommended for any new use of `mockery`.

---

### 20. Can interface satisfaction be checked at compile time for hand-rolled stubs?

Yes, with a blank-identifier conformance check:

```go
var _ UserRepo = (*FakeUserRepo)(nil)
```

Place this near the stub declaration. If `FakeUserRepo` drifts from the interface, the package stops compiling. Cheap insurance.

---

### 21. How do you test code that calls `time.Now()`?

Inject a clock interface:

```go
type Clock interface{ Now() time.Time }
type RealClock struct{}
func (RealClock) Now() time.Time { return time.Now() }
```

In production, pass `RealClock{}`. In tests, pass a fake that returns a fixed or advanceable time. Libraries that do this well: `github.com/benbjohnson/clock`, `k8s.io/utils/clock`.

---

### 22. What's wrong with this expectation: `m.On("Update", mock.Anything).Return(nil)`?

It accepts *any* argument, so the test does not assert that `Update` is called with the right value. If the bug being checked is "Update receives a malformed input," the mock will happily report success. Prefer `mock.MatchedBy(func(x Input) bool { return x.ID == "42" })` or strict equality.

---

### 23. Should you mock the standard library?

Rarely. `io.Reader`, `io.Writer`, `context.Context`, `time.Time` (via injected clock) are designed to be substituted at the boundary. `os.File`, `net.Conn`, and `*sql.DB` are usually substituted via interfaces *you* define in your package — not by mocking the std-lib type directly. If you find yourself "mocking `os.Exit`," step back and ask what behavior you actually want to test.

---

### 24. How do mocks interact with `t.Parallel()`?

A mock object is mutable state. If two parallel subtests share one mock, they race. The rule: construct a fresh mock per `t.Run`. With `gomock`, that means a fresh `gomock.NewController(t)` per subtest; `t.Cleanup` keeps lifetimes correct.

---

### 25. You inherit a 5000-line file with 80% mock setup. What do you do first?

Step 1: read three random tests and ask "what does this test *verify* about user-visible behavior?" If the answer is "calls happen in order X," the tests are over-mocked. Step 2: pick the smallest interface with the most mock setup and replace mocks with a fake — usually you can delete two-thirds of the mock code. Step 3: keep mocks only for boundary side-effects (network, time, external command execution) and for asserting that those side-effects were attempted.

---

### 26. Quick: name three argument matchers across `testify` and `gomock`.

`testify`: `mock.Anything`, `mock.AnythingOfType("string")`, `mock.MatchedBy(fn)`.
`gomock`: `gomock.Any()`, `gomock.Eq(x)`, `gomock.Not(matcher)`, `gomock.AssignableToTypeOf(x)`.

---

### 27. What's the trade-off between source-mode and reflect-mode `mockgen`?

Source mode parses one file — fast, no compilation, but cannot see types defined in other packages. Reflect mode compiles a generator program that imports the real package — slower, but resolves transitive types. Pick source mode for monorepos with well-isolated interfaces; pick reflect mode when interface types reference cross-package generics.

---

### 28. What is `moq` and when would you choose it over `mockery`?

`github.com/matryer/moq` generates mocks with no framework dependency — the output is plain Go with closure-based method bodies. The generated mock is smaller, faster, and easier to read than `testify/mock`-style output. Choose `moq` when you want generation but do not want a framework in your test dependencies; choose `mockery` when your team already uses `testify` and likes the `On/Return` style.
