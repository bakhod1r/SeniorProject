# Generic Testing Helpers — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task focuses on **building a real test helper** — not on testing some unrelated function. Always include `t.Helper()` and use stdlib pieces when available.

---

## Easy 🟢

### Task 1 — `AssertEqual[T comparable]`
Write the smallest useful generic equality helper with `t.Helper()` and an `Errorf` failure.

### Task 2 — `AssertNotEqual[T comparable]`
Mirror Task 1 but fail when the values **are** equal.

### Task 3 — `AssertTrue` and `AssertFalse`
Two helpers that take a `bool` and a `*testing.T`. Use `Errorf` and clear messages.

### Task 4 — `AssertNoError`
Fail with `t.Fatalf` when `err != nil`. Why fatal?

### Task 5 — `AssertContains` for strings
Write `AssertContains(t *testing.T, s, sub string)` that wraps `strings.Contains`.

### Task 6 — `AssertNil` and `AssertNotNil` for pointers
Use `[T any]` plus `*T` parameters.

---

## Medium 🟡

### Task 7 — `AssertSliceEqual[T comparable]`
Wrap `slices.Equal`. Format the failure on two lines for readability.

### Task 8 — `AssertSliceContains[T comparable]`
Use `slices.Contains` internally.

### Task 9 — `AssertMapEqual[K, V comparable]`
Wrap `maps.Equal`.

### Task 10 — `AssertErrorIs`
Use `errors.Is`. Failure message should print both the actual error and the target.

### Task 11 — `AssertErrorAs[T error]`
Use `errors.As` and **return** the typed error so the caller can inspect it.

### Task 12 — Generic table-driven runner
Write `RunCases[I, O comparable](t *testing.T, cases []Case[I, O], fn func(I) O)` that uses `t.Run` and `Equal`.

### Task 13 — `AssertSetEqual[T cmp.Ordered]`
Compare two slices ignoring order. Sort copies; never mutate the caller's data.

### Task 14 — Float helper with epsilon
Write `AssertFloatNear(t, got, want, eps float64)`. Handle NaN explicitly.

---

## Hard 🔴

### Task 15 — `AssertPanics[T any]`
Catch a panic, ensure it has type `T`, and return the recovered value.

### Task 16 — `AssertEventually`
Poll a predicate until it returns true or a timeout elapses. Signature: `AssertEventually(t *testing.T, predicate func() bool, timeout, interval time.Duration)`. Why is this useful?

### Task 17 — Generic fixture builder
Implement `WithFixture[T any](t *testing.T, build func(*testing.T) (T, func())) T` that registers cleanup with `t.Cleanup`.

### Task 18 — `AssertCmpEqual[T any]` using `go-cmp`
Wrap `cmp.Diff` so the helper produces a `-want +got` diff on failure. Allow extra `cmp.Option` arguments.

### Task 19 — Multiset comparison
Write `AssertMultisetEqual[T comparable]` that ignores order and accepts non-orderable types. Use a map of counts.

---

## Expert 🟣

### Task 20 — Test the testlib
Build a fake `testing.TB` (a struct that records calls to `Errorf` / `Fatalf`) and write tests that call `Equal` and assert on the recorded behaviour.

### Task 21 — Generic subtest namer
Write a helper that generates subtest names from a struct: given a `tc` of type `T`, produce a name like `"in=42_want=84"`. Use reflection or a `Named` interface.

### Task 22 — Migrate a fake testify suite
Take a tiny `testify`-style file with `assert.Equal`, `require.NoError`, `assert.ElementsMatch` and migrate it to generic stdlib-shaped helpers. Discuss what changed.

---

## Solutions

### Solution 1
```go
import "testing"

func AssertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

### Solution 2
```go
func AssertNotEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got == want {
        t.Errorf("got %v, want != %v", got, want)
    }
}
```

### Solution 3
```go
func AssertTrue(t *testing.T, cond bool) {
    t.Helper()
    if !cond { t.Errorf("expected true, got false") }
}

func AssertFalse(t *testing.T, cond bool) {
    t.Helper()
    if cond { t.Errorf("expected false, got true") }
}
```

### Solution 4
```go
func AssertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil { t.Fatalf("unexpected error: %v", err) }
}
```
Fatal because subsequent assertions usually depend on the result of the call that errored. Continuing produces cascading nonsense.

### Solution 5
```go
import "strings"

func AssertContains(t *testing.T, s, sub string) {
    t.Helper()
    if !strings.Contains(s, sub) {
        t.Errorf("string %q does not contain %q", s, sub)
    }
}
```

### Solution 6
```go
func AssertNil[T any](t *testing.T, p *T) {
    t.Helper()
    if p != nil { t.Errorf("expected nil, got %v", *p) }
}

func AssertNotNil[T any](t *testing.T, p *T) {
    t.Helper()
    if p == nil { t.Errorf("expected non-nil pointer to %T", *new(T)) }
}
```

### Solution 7
```go
import (
    "slices"
    "testing"
)

func AssertSliceEqual[T comparable](t *testing.T, got, want []T) {
    t.Helper()
    if !slices.Equal(got, want) {
        t.Errorf("slice mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

### Solution 8
```go
func AssertSliceContains[T comparable](t *testing.T, s []T, target T) {
    t.Helper()
    if !slices.Contains(s, target) {
        t.Errorf("slice %v does not contain %v", s, target)
    }
}
```

### Solution 9
```go
import "maps"

func AssertMapEqual[K, V comparable](t *testing.T, got, want map[K]V) {
    t.Helper()
    if !maps.Equal(got, want) {
        t.Errorf("map mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

### Solution 10
```go
import "errors"

func AssertErrorIs(t *testing.T, err, target error) {
    t.Helper()
    if !errors.Is(err, target) {
        t.Fatalf("error chain does not contain %v: got %v", target, err)
    }
}
```

### Solution 11
```go
func AssertErrorAs[T error](t *testing.T, err error) T {
    t.Helper()
    var target T
    if !errors.As(err, &target) {
        t.Fatalf("expected error of type %T, got %T (%v)", target, err, err)
    }
    return target
}
```

### Solution 12
```go
type Case[I, O any] struct {
    Name string
    In   I
    Want O
}

func RunCases[I, O comparable](t *testing.T, cases []Case[I, O], fn func(I) O) {
    t.Helper()
    for _, tc := range cases {
        t.Run(tc.Name, func(t *testing.T) {
            AssertEqual(t, fn(tc.In), tc.Want)
        })
    }
}
```

### Solution 13
```go
import (
    "cmp"
    "slices"
)

func AssertSetEqual[T cmp.Ordered](t *testing.T, got, want []T) {
    t.Helper()
    g := slices.Clone(got)
    w := slices.Clone(want)
    slices.Sort(g)
    slices.Sort(w)
    if !slices.Equal(g, w) {
        t.Errorf("set mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

### Solution 14
```go
import "math"

func AssertFloatNear(t *testing.T, got, want, eps float64) {
    t.Helper()
    if math.IsNaN(got) && math.IsNaN(want) { return }
    if math.Abs(got-want) > eps {
        t.Errorf("got %v, want %v ± %v", got, want, eps)
    }
}
```

### Solution 15
```go
func AssertPanics[T any](t *testing.T, fn func()) (got T, ok bool) {
    t.Helper()
    defer func() {
        r := recover()
        if r == nil {
            t.Fatalf("expected panic, got none")
            return
        }
        v, isT := r.(T)
        if !isT {
            t.Fatalf("recovered non-T value: %v (%T)", r, r)
            return
        }
        got = v
        ok = true
    }()
    fn()
    return
}
```

### Solution 16
```go
import "time"

func AssertEventually(t *testing.T, predicate func() bool, timeout, interval time.Duration) {
    t.Helper()
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if predicate() { return }
        time.Sleep(interval)
    }
    t.Fatalf("predicate did not become true within %v", timeout)
}
```
Useful for integration tests that wait on async state — health checks, eventually-consistent reads, log appearance. Always pair with timeouts to avoid stuck tests.

### Solution 17
```go
func WithFixture[T any](t *testing.T, build func(*testing.T) (T, func())) T {
    t.Helper()
    v, clean := build(t)
    t.Cleanup(clean)
    return v
}
```

### Solution 18
```go
import "github.com/google/go-cmp/cmp"

func AssertCmpEqual[T any](t *testing.T, got, want T, opts ...cmp.Option) {
    t.Helper()
    if d := cmp.Diff(want, got, opts...); d != "" {
        t.Errorf("mismatch (-want +got):\n%s", d)
    }
}
```

### Solution 19
```go
func AssertMultisetEqual[T comparable](t *testing.T, got, want []T) {
    t.Helper()
    countOf := func(s []T) map[T]int {
        m := map[T]int{}
        for _, v := range s { m[v]++ }
        return m
    }
    if !maps.Equal(countOf(got), countOf(want)) {
        t.Errorf("multiset mismatch:\n  got:  %v\n  want: %v", got, want)
    }
}
```

### Solution 20
```go
type fakeTB struct {
    testing.TB
    errors []string
    fatals []string
}

func (f *fakeTB) Helper() {}
func (f *fakeTB) Errorf(format string, args ...any) {
    f.errors = append(f.errors, fmt.Sprintf(format, args...))
}
func (f *fakeTB) Fatalf(format string, args ...any) {
    f.fatals = append(f.fatals, fmt.Sprintf(format, args...))
    runtime.Goexit()
}
```
Note: `testing.TB` has an unexported method, so embedding it lets us "satisfy" the interface for type-checking. Run the helper under test in a goroutine and use channels to signal completion.

### Solution 21
```go
type Named interface{ Name() string }

func RunCasesNamed[T Named, O any](
    t *testing.T,
    cases []T,
    fn func(*testing.T, T),
) {
    t.Helper()
    for _, tc := range cases {
        t.Run(tc.Name(), func(t *testing.T) { fn(t, tc) })
    }
}
```
This requires the case struct to implement `Name() string`. Cleaner than reflection for most projects.

### Solution 22
```go
// Before
func TestUser_Old(t *testing.T) {
    u, err := loadUser(1)
    require.NoError(t, err)
    assert.Equal(t, "alice", u.Name)
    assert.ElementsMatch(t, u.Roles, []string{"admin", "user"})
}

// After
func TestUser_New(t *testing.T) {
    u, err := loadUser(1)
    AssertNoError(t, err)
    AssertEqual(t, u.Name, "alice")
    AssertSetEqual(t, u.Roles, []string{"admin", "user"})
}
```
Differences: typed assertions catch wrong-type bugs at compile time, `(got, want)` order is consistent, no third-party dependency.

---

## Final notes

These tasks deliberately mirror the helpers shipped by mature Go projects. The real lesson is **comparison**: every helper you write should be paired in your mind with the inline check it replaces. The point is not the new syntax; it is the discipline of `t.Helper()`, clear messages, and small APIs.

A complete in-house testlib usually contains 12-20 helpers. Anything bigger should make you reach for `testify` or `gotest.tools` instead of building your own.
