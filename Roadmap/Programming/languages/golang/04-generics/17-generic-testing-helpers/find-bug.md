# Generic Testing Helpers — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Would generics or `t.Helper()` have prevented it?

Solutions are at the end. The bugs are realistic — most are caught in code review of in-house testlibs.

---

## Bug 1 — Missing `t.Helper()`

```go
func Equal[T comparable](t *testing.T, got, want T) {
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

func TestAdd(t *testing.T) {
    Equal(t, 2+2, 5) // failure points at Equal, not TestAdd
}
```

**Hint:** Where does the failure file/line point?

---

## Bug 2 — Comparing slices with `==`

```go
func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want { t.Errorf(...) }
}

Equal(t, []int{1,2}, []int{1,2}) // ❌
```

**Hint:** Are slices `comparable`?

---

## Bug 3 — Float deep equality

```go
func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want { t.Errorf("got %v, want %v", got, want) }
}

Equal(t, 0.1+0.2, 0.3) // surprise: fails
```

**Hint:** Floating-point arithmetic.

---

## Bug 4 — Asserting before checking the error

```go
func TestUser(t *testing.T) {
    u, err := loadUser(1)
    AssertEqual(t, u.Name, "alice")  // u may be nil — panic
    AssertNoError(t, err)
}
```

**Hint:** Order matters.

---

## Bug 5 — `Errorf` instead of `Fatalf` after a critical setup

```go
func TestThing(t *testing.T) {
    db, err := openDB()
    if err != nil {
        t.Errorf("open: %v", err) // 🚨
    }
    rows, err := db.Query(...)   // db is nil — panic
    ...
}
```

**Hint:** Continuing after a fatal failure.

---

## Bug 6 — `Equal(t, err, nil)` for errors

```go
func TestX(t *testing.T) {
    _, err := f()
    AssertEqual(t, err, nil) // ❌
}
```

**Hint:** Constraint inference.

---

## Bug 7 — Wrong got/want order

```go
func TestX(t *testing.T) {
    got := compute()
    AssertEqual(t, 42, got) // 🚨 swapped
}
```

**Hint:** Convention.

---

## Bug 8 — Hidden line numbers in nested helper

```go
func AssertUser(t *testing.T, got, want User) {
    AssertEqual(t, got.Name, want.Name) // Equal calls Helper, but AssertUser does not
}
```

**Hint:** Helper-frame propagation.

---

## Bug 9 — Loop variable capture before Go 1.22

```go
for _, tc := range cases {
    t.Run(tc.Name, func(t *testing.T) {
        t.Parallel()
        AssertEqual(t, tc.In, tc.Want) // 🚨 in Go 1.21 and earlier
    })
}
```

**Hint:** Closure shares the loop variable in older Go.

---

## Bug 10 — `reflect.DeepEqual` on a struct with funcs

```go
type Handler struct{ Func func() }

func AssertHandlerEqual(t *testing.T, got, want Handler) {
    if !reflect.DeepEqual(got, want) { t.Errorf(...) }
}
```

**Hint:** What does `DeepEqual` do with funcs?

---

## Bug 11 — Map iteration order

```go
got := keysOf(m)
want := []string{"a", "b", "c"}
AssertSliceEqual(t, got, want) // flaky
```

**Hint:** Ordering guarantees.

---

## Bug 12 — Helper that catches all panics

```go
func Safe(t *testing.T, fn func()) {
    defer func() { recover() }()
    fn()
}
```

**Hint:** What does this hide?

---

## Bug 13 — `AssertEqual(t, math.NaN(), math.NaN())`

```go
AssertEqual(t, math.NaN(), math.NaN()) // always fails
```

**Hint:** IEEE 754.

---

## Bug 14 — Generic helper with `any` argument

```go
func AssertEqual(t *testing.T, got, want any) {
    t.Helper()
    if got != want { t.Errorf("got %v, want %v", got, want) }
}

AssertEqual(t, 1, "1") // compiles, fails at runtime — wrong types
```

**Hint:** Why is `any` a regression here?

---

## Bug 15 — Setup logic in the assertion helper

```go
func AssertConfigured(t *testing.T) {
    t.Helper()
    db := openTestDB(t)
    setupSchema(db)
    if db.IsConfigured() {
        return
    }
    t.Fatalf("not configured")
}
```

**Hint:** Mixing fixtures and assertions.

---

## Bug 16 — Returning from `defer` after `Fatalf`

```go
func AssertNoError(t *testing.T, err error) {
    if err != nil {
        defer t.Fatalf("error: %v", err) // 🚨
    }
}
```

**Hint:** Order of execution.

---

## Solutions

### Bug 1 — fix
Add `t.Helper()`:
```go
func Equal[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want { t.Errorf("got %v, want %v", got, want) }
}
```
Without `Helper()`, the failure file/line is the helper file. With it, the failure points at the test. Generics did not cause the bug; missing `Helper()` did.

### Bug 2 — fix
Slices are not `comparable`. Use a different helper:
```go
import "slices"
func AssertSliceEqual[T comparable](t *testing.T, got, want []T) {
    t.Helper()
    if !slices.Equal(got, want) { t.Errorf(...) }
}
```

### Bug 3 — fix
Use a tolerance:
```go
func AssertFloatNear(t *testing.T, got, want, eps float64) {
    t.Helper()
    if math.Abs(got-want) > eps { t.Errorf("got %v, want %v ± %v", got, want, eps) }
}
```
`0.1 + 0.2 == 0.30000000000000004`. Direct equality on floats almost always wrong in tests.

### Bug 4 — fix
Check the error first; abort the test if it failed:
```go
u, err := loadUser(1)
AssertNoError(t, err)
AssertEqual(t, u.Name, "alice")
```
`AssertNoError` uses `Fatalf` so the test stops if `err != nil`.

### Bug 5 — fix
Use `Fatalf` (or wrap in `AssertNoError`):
```go
db, err := openDB()
AssertNoError(t, err) // Fatal on error
```

### Bug 6 — fix
Use a dedicated helper:
```go
AssertNoError(t, err)
```
`Equal(t, err, nil)` does not compile because `nil` has no concrete type for inference. Even if it did, `error` is an interface; comparing it for equality is brittle.

### Bug 7 — fix
Convention: `(got, want)` everywhere. Document this in `CONTRIBUTING.md`. Failures read consistently and reviewers can spot reversed calls.

### Bug 8 — fix
Add `t.Helper()` to **every** wrapper:
```go
func AssertUser(t *testing.T, got, want User) {
    t.Helper()
    AssertEqual(t, got.Name, want.Name)
}
```
Without it, failures point at `AssertUser`, not the test that called it.

### Bug 9 — fix
For Go 1.21 and earlier, copy the loop variable:
```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.Name, func(t *testing.T) {
        t.Parallel()
        AssertEqual(t, tc.In, tc.Want)
    })
}
```
Go 1.22+ fixes this at the language level — no copy needed.

### Bug 10 — fix
`reflect.DeepEqual` returns false for any two functions unless they are both nil. Don't compare structs that contain funcs; ignore that field or use `cmpopts.IgnoreFields`.

### Bug 11 — fix
Map iteration order is randomized. Sort before comparing:
```go
got := keysOf(m)
slices.Sort(got)
AssertSliceEqual(t, got, []string{"a","b","c"})
```
Or use `AssertSetEqual` which sorts internally.

### Bug 12 — fix
Don't recover panics in a generic helper. Tests should panic loudly. The only acceptable use is `AssertPanics[T any]` that explicitly expects a panic.

### Bug 13 — fix
NaN-aware float comparison:
```go
func FloatEqual(a, b float64) bool {
    if math.IsNaN(a) && math.IsNaN(b) { return true }
    return a == b
}
```
Use `EqualFunc` with this comparator.

### Bug 14 — fix
Use generics:
```go
func AssertEqual[T comparable](t *testing.T, got, want T) { ... }
```
The compile error catches `AssertEqual(t, 1, "1")` immediately. The `any` version silently compiled and failed at runtime.

### Bug 15 — fix
Split the helper:
```go
func setupConfigured(t *testing.T) *DB {
    t.Helper()
    db := openTestDB(t)
    setupSchema(db)
    return db
}

func AssertConfigured(t *testing.T, db *DB) {
    t.Helper()
    if !db.IsConfigured() { t.Fatalf("not configured") }
}
```
Fixtures in one helper, assertions in another. Tests using fixtures: `db := setupConfigured(t); AssertConfigured(t, db)`.

### Bug 16 — fix
`defer` runs after the function returns, so `t.Fatalf` runs at function exit. But the test code that called `AssertNoError` continues running until then — possibly using a nil value. Just call `Fatalf` directly:
```go
func AssertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil { t.Fatalf("error: %v", err) }
}
```

---

## Lessons

Patterns from these bugs:

1. **`t.Helper()` is non-negotiable** (Bugs 1, 8). Add it as the first line of every helper.
2. **Constraints must match the operations** (Bugs 2, 6). `comparable` for `==`, custom equality for slices/maps/floats.
3. **Floats are not comparable** in the colloquial sense (Bugs 3, 13). Always use a tolerance or NaN-aware comparator.
4. **Order matters in tests** (Bugs 4, 5). Check errors before using values; use `Fatalf` when continuing makes no sense.
5. **Generics catch bugs `interface{}` does not** (Bug 14). Resist `any` for assertion helpers.
6. **Don't mix fixtures with assertions** (Bug 15). Two responsibilities, two helpers.
7. **Don't catch panics blindly** (Bug 12). The race detector and stack traces are your friends.
8. **Test conventions matter** (Bug 7). Consistent `(got, want)` makes triage faster.
9. **Loop-variable capture changed in Go 1.22** (Bug 9). Update the targeted Go version or copy the variable.
10. **Map iteration is randomized** (Bug 11). Sort or use a multiset comparison.

A senior reviewer reads test helpers like a contract: each `t.Helper()`, `Errorf` vs `Fatalf`, and constraint is a precise statement of intent. Mismatch between the contract and what the helper does is **the** category of testlib bugs.
