# errors.New — Find the Bug

> Each snippet contains a real-world bug related to `errors.New` misuse. Find it, explain it, fix it.

---

## Bug 1 — Comparing two `errors.New` results with `==`

```go
func IsNotFound(err error) bool {
    return err == errors.New("not found")
}
```

**Bug:** Each call to `errors.New` allocates a new `*errorString`. The right-hand side is a fresh pointer; the left-hand side is whatever pointer `err` carries. They will never compare equal under `==`. The function always returns `false`.

**Fix:** Declare a sentinel once, then compare against it:

```go
var ErrNotFound = errors.New("not found")

func IsNotFound(err error) bool {
    return errors.Is(err, ErrNotFound)
}
```

---

## Bug 2 — Sentinel inside a function

```go
func Find(id int) error {
    var ErrNotFound = errors.New("not found")
    if id == 0 {
        return ErrNotFound
    }
    return nil
}
```

**Bug:** `ErrNotFound` is a *local* variable, re-allocated on every call. Each invocation returns a *different* pointer. Callers cannot rely on `errors.Is(err, anyKnownErrNotFound)` to match across calls.

**Fix:** Move the declaration to package scope:

```go
var ErrNotFound = errors.New("not found")

func Find(id int) error {
    if id == 0 {
        return ErrNotFound
    }
    return nil
}
```

---

## Bug 3 — Per-call allocation in a hot loop

```go
for _, item := range hotInputs { // millions of items
    if !valid(item) {
        return errors.New("invalid input")
    }
}
```

**Bug:** A fresh `*errorString` is allocated on every failure. In a hot loop with frequent invalid inputs, this is millions of throwaway allocations and added GC pressure.

**Fix:** Use a package-level sentinel:

```go
var ErrInvalidInput = errors.New("invalid input")

for _, item := range hotInputs {
    if !valid(item) {
        return ErrInvalidInput
    }
}
```

Allocation drops to zero on the failure path.

---

## Bug 4 — Building a message with `+` and `errors.New`

```go
func GetUser(name string) error {
    return errors.New("user " + name + " not found")
}
```

**Bug:** Three problems stacked:
1. The string is built per call, allocating again.
2. The error message changes per call, so callers cannot match a category.
3. If you wanted to wrap a cause, this form does not allow `%w`.

**Fix:** Use `fmt.Errorf` with a sentinel:

```go
var ErrUserNotFound = errors.New("user not found")

func GetUser(name string) error {
    return fmt.Errorf("user %q: %w", name, ErrUserNotFound)
}
```

Now callers can `errors.Is(err, ErrUserNotFound)` and the message still includes the name.

---

## Bug 5 — Shadowing a package-level sentinel

```go
package store

import "errors"

var ErrNotFound = errors.New("store: not found")

func Get(id int) (Item, error) {
    var ErrNotFound = errors.New("store: not found") // shadow!
    if !exists(id) {
        return Item{}, ErrNotFound
    }
    return load(id), nil
}
```

**Bug:** The local `ErrNotFound` shadows the package-level one. Inside `Get`, `ErrNotFound` refers to the local variable. Callers using `errors.Is(err, store.ErrNotFound)` will compare against the *package-level* pointer, which is different. Match always fails.

**Fix:** Remove the local declaration. Use the package-level variable directly:

```go
func Get(id int) (Item, error) {
    if !exists(id) {
        return Item{}, ErrNotFound
    }
    return load(id), nil
}
```

---

## Bug 6 — Using `errors.New` to "wrap" another error

```go
func Load() error {
    if err := readFile(); err != nil {
        return errors.New("load failed: " + err.Error())
    }
    return nil
}
```

**Bug:** This flattens the chain. The returned error's message includes the cause's text, but `errors.Is` and `errors.As` cannot find the original error. Wrapping is destroyed.

**Fix:** Use `fmt.Errorf` with `%w`:

```go
func Load() error {
    if err := readFile(); err != nil {
        return fmt.Errorf("load failed: %w", err)
    }
    return nil
}
```

---

## Bug 7 — Reassigning the sentinel at runtime

```go
var ErrFoo = errors.New("foo")

func init() {
    if testing.Short() {
        ErrFoo = errors.New("foo (short)") // changes pointer
    }
}
```

**Bug:** The reassignment replaces the sentinel pointer. Code elsewhere that captured the original `ErrFoo` (perhaps in a closure or another package's init that ran before this one) will hold a stale pointer. `errors.Is` matches will fail unpredictably depending on init order.

**Fix:** Treat sentinels as `const`. If you need a different message in tests, inject the error rather than reassign:

```go
var ErrFoo = errors.New("foo")

// In tests, pass a different error explicitly to the function under test.
```

---

## Bug 8 — Empty error message

```go
return errors.New("")
```

**Bug:** Legal but useless. Logs show an empty string. A reader cannot tell what went wrong.

**Fix:** Always provide a meaningful message, even for "this should never happen" cases:

```go
return errors.New("internal: invariant violated")
```

---

## Bug 9 — Returning `nil` after `errors.New`

```go
func Validate(x int) error {
    if x < 0 {
        errors.New("x must be non-negative") // value discarded
    }
    return nil
}
```

**Bug:** `errors.New` returns a value but it is not used. The function silently returns `nil`. The compiler does not warn because Go does not warn on unused expression results.

**Fix:** Return the error:

```go
func Validate(x int) error {
    if x < 0 {
        return errors.New("x must be non-negative")
    }
    return nil
}
```

A linter like `errcheck` or `staticcheck` would flag the original.

---

## Bug 10 — Comparing wrapped error with `==`

```go
var ErrTimeout = errors.New("timeout")

func handle(err error) {
    if err == ErrTimeout {
        // retry
    }
}

// elsewhere
err := fmt.Errorf("call: %w", ErrTimeout)
handle(err) // does NOT trigger the retry
```

**Bug:** The wrapped error is a `*fmt.wrapError`, not `*errorString`. `==` compares the interface values, which differ in type and pointer. The retry never happens.

**Fix:** Use `errors.Is`:

```go
if errors.Is(err, ErrTimeout) {
    // retry
}
```

---

## Bug 11 — Grouping unrelated sentinels

```go
var (
    ErrSomething = errors.New("error")
    ErrAnother   = errors.New("error")
)
```

**Bug:** Two distinct sentinels with the same string. Logs cannot distinguish them. Tests grepping by message cannot tell them apart. Since identity-based matching works, this *technically* runs, but it is misleading and brittle.

**Fix:** Give each a unique, descriptive message including the package prefix:

```go
var (
    ErrSomething = errors.New("mypkg: something failed")
    ErrAnother   = errors.New("mypkg: another failed")
)
```

---

## Bug 12 — Sentinel returned only sometimes

```go
var ErrNotFound = errors.New("not found")

func Get(id int) (Item, error) {
    if id < 0 {
        return Item{}, fmt.Errorf("not found")          // string-only error
    }
    if id == 0 {
        return Item{}, ErrNotFound                       // sentinel
    }
    return load(id), nil
}
```

**Bug:** Inconsistent: callers sometimes get the sentinel, sometimes get a fresh `fmt.Errorf` value. `errors.Is(err, ErrNotFound)` matches only in the second case. The "id < 0" path silently fails to match.

**Fix:** Always return the sentinel (or a wrap thereof):

```go
func Get(id int) (Item, error) {
    if id <= 0 {
        return Item{}, fmt.Errorf("Get(%d): %w", id, ErrNotFound)
    }
    return load(id), nil
}
```

---

## Bug 13 — Sentinel in a generated/init-order-sensitive context

```go
package alpha
import "myproj/beta"
var ErrFromBeta = beta.MakeErr() // depends on beta's init order

// beta package
package beta
var canon = errors.New("beta: canon")
func MakeErr() error { return canon }
```

**Bug:** This works in trivial cases but is fragile if `beta.canon` is ever reassigned, or if `MakeErr` is later refactored to return `errors.New(...)` per call. The "canonical sentinel" abstraction is buried in a function call instead of a direct variable reference.

**Fix:** Reference the canonical sentinel directly:

```go
package alpha
import "myproj/beta"
var ErrFromBeta = beta.Canon // direct reference, exported sentinel
```

```go
package beta
var Canon = errors.New("beta: canon")
```

Identity is now obvious and stable.

---

## Bug 14 — Storing `errors.New` results in a slice for matching

```go
var KnownErrors = []error{
    errors.New("not found"),
    errors.New("conflict"),
}

func IsKnown(err error) bool {
    for _, k := range KnownErrors {
        if err == k {
            return true
        }
    }
    return false
}
```

**Bug:** The slice contains valid sentinels (allocated once at init), so `==` against them works. The bug is the *comparison style*: `==` fails for wrapped errors. Better is `errors.Is`. Also, this pattern hides the sentinels behind index access; explicit named variables are easier to read.

**Fix:**

```go
var (
    ErrNotFound = errors.New("not found")
    ErrConflict = errors.New("conflict")
)

func IsKnown(err error) bool {
    return errors.Is(err, ErrNotFound) || errors.Is(err, ErrConflict)
}
```

---

## Bug 15 — `errors.New` with a format string

```go
return errors.New("failed for id %d") // missing the value
```

**Bug:** `errors.New` does not interpret format verbs. The returned error literally says `"failed for id %d"` — the `%d` is not substituted. This is a common confusion for developers coming from `fmt.Errorf`.

**Fix:** Use `fmt.Errorf`:

```go
return fmt.Errorf("failed for id %d", id)
```

---

## Bug 16 — Using `Error()` for comparison

```go
if err.Error() == "not found" {
    // handle
}
```

**Bug:** Three problems:
1. Wrapping breaks this — a wrapped error has a longer message.
2. Refactoring the sentinel message silently breaks all of these checks.
3. It loses any structured information.

**Fix:**

```go
if errors.Is(err, ErrNotFound) {
    // handle
}
```

---

## Bug 17 — Exporting a sentinel intended as private

```go
package httputil

import "errors"

// ErrInternal is a control-flow signal between two private functions.
var ErrInternal = errors.New("httputil: internal")
```

**Bug:** The doc comment says it is for internal use, but the variable is exported. External callers will start matching against it, locking in the behavior. Now you cannot remove or rename it without breaking them.

**Fix:** Make it lowercase if internal:

```go
var errInternal = errors.New("httputil: internal")
```

If callers do need to match, leave it exported but be honest about the contract.

---

## Bug 18 — Two packages declaring the "same" sentinel

```go
// package a
var ErrNotFound = errors.New("not found")

// package b
var ErrNotFound = errors.New("not found")
```

In a caller:

```go
err := a.Lookup() // returns a.ErrNotFound
if errors.Is(err, b.ErrNotFound) {
    // never matches
}
```

**Bug:** Two `errors.New` calls in two packages give two distinct values. The match is always false even though the messages are identical.

**Fix:** Centralize into a shared `errs` package:

```go
// package errs
var ErrNotFound = errors.New("errs: not found")

// package a
import "myproj/errs"
return errs.ErrNotFound

// package b
import "myproj/errs"
return errs.ErrNotFound
```

Now both packages emit the same identity, and `errors.Is(err, errs.ErrNotFound)` matches both.

---

## Bug 19 — Trusting message text in tests

```go
func TestNotFound(t *testing.T) {
    _, err := store.Get(42)
    if err.Error() != "not found" {
        t.Fatalf("got %q", err.Error())
    }
}
```

**Bug:** The test passes today but will fail the moment someone wraps the error with `fmt.Errorf("Get: %w", err)` — even though the *behavior* is unchanged. Tests should match identity, not text.

**Fix:**

```go
func TestNotFound(t *testing.T) {
    _, err := store.Get(42)
    if !errors.Is(err, store.ErrNotFound) {
        t.Fatalf("expected ErrNotFound, got %v", err)
    }
}
```

The test now survives any internal wrapping.

---

## Bug 20 — Multiple equal sentinels collapsed in `errors.Join`

```go
var ErrA = errors.New("a")

errs := errors.Join(ErrA, ErrA, ErrA)
```

**Not a bug, but a misconception:** `errors.Join` keeps all three references. `errors.Is(errs, ErrA)` returns `true`. The list does not deduplicate. If you intend a unique set, deduplicate yourself first. (This is a "find the assumption" exercise rather than a bug, but worth knowing.)

**No fix needed**, just awareness.
