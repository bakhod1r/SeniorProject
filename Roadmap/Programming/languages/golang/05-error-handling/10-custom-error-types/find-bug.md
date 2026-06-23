# Custom Error Types — Find the Bug

A series of broken Go programs related to custom error types. Each problem includes:
1. The buggy code
2. A symptom (what the user sees)
3. The bug
4. The fix

Read the code carefully *before* scrolling to the answer. Several bugs look correct at first glance.

## Table of Contents
1. [Bug 1 — The phantom error](#bug-1--the-phantom-error)
2. [Bug 2 — `Is` never matches](#bug-2--is-never-matches)
3. [Bug 3 — Wrap chain ends early](#bug-3--wrap-chain-ends-early)
4. [Bug 4 — `errors.As` panics](#bug-4--errorsas-panics)
5. [Bug 5 — Recursive `Error()`](#bug-5--recursive-error)
6. [Bug 6 — JSON loses the cause](#bug-6--json-loses-the-cause)
7. [Bug 7 — Mixed receivers](#bug-7--mixed-receivers)
8. [Bug 8 — Sentinel double-creation](#bug-8--sentinel-double-creation)
9. [Bug 9 — Pool corrupts logs](#bug-9--pool-corrupts-logs)
10. [Bug 10 — `Format` infinite loop](#bug-10--format-infinite-loop)
11. [Bug 11 — Stack captured at every wrap](#bug-11--stack-captured-at-every-wrap)
12. [Bug 12 — Embedded `error` swallows `Unwrap`](#bug-12--embedded-error-swallows-unwrap)
13. [Bug 13 — Concurrent mutation of error fields](#bug-13--concurrent-mutation-of-error-fields)
14. [Bug 14 — Custom `Is` never walks](#bug-14--custom-is-never-walks)
15. [Bug 15 — Public-facing leak](#bug-15--public-facing-leak)

---

## Bug 1 — The phantom error

```go
package main

import "fmt"

type AuthError struct{ msg string }

func (e *AuthError) Error() string { return e.msg }

func authenticate(user string) error {
    var aerr *AuthError
    if user == "" {
        aerr = &AuthError{msg: "empty user"}
    }
    return aerr
}

func main() {
    err := authenticate("alice")
    if err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("ok")
    }
}
```

**Symptom:** the program prints `error: <nil>` for a valid user.

**Bug:** the typed-nil trap. When `user != ""`, `aerr` is a nil `*AuthError`. Returning it as `error` produces an interface with `(type=*AuthError, value=nil)` — *not* the zero interface — so `err != nil` is true. The implicit `.String()` of a nil-pointer-to-`AuthError` then prints `<nil>`.

**Fix:**
```go
if aerr != nil {
    return aerr
}
return nil
```
Always return the literal `nil` on success.

---

## Bug 2 — `Is` never matches

```go
package main

import (
    "errors"
    "fmt"
)

type NotFound struct{ ID int }

func (e *NotFound) Error() string { return fmt.Sprintf("id %d", e.ID) }

var ErrNotFound = errors.New("not found")

func main() {
    err := &NotFound{ID: 42}
    fmt.Println(errors.Is(err, ErrNotFound)) // false
}
```

**Symptom:** the program prints `false`.

**Bug:** `errors.Is` does identity comparison and chain walking. `*NotFound{}` is not the same value as `ErrNotFound`, has no `Is` method, and does not wrap anything. So nothing matches.

**Fix:** add `Is` so the custom type accepts the sentinel:
```go
func (e *NotFound) Is(target error) bool { return target == ErrNotFound }
```

---

## Bug 3 — Wrap chain ends early

```go
package main

import (
    "errors"
    "fmt"
    "io"
)

type ReadErr struct {
    Path string
    Err  error
}

func (e *ReadErr) Error() string { return e.Path + ": " + e.Err.Error() }

func main() {
    err := &ReadErr{Path: "/etc/x", Err: io.EOF}
    fmt.Println(errors.Is(err, io.EOF)) // false
}
```

**Symptom:** prints `false` even though `io.EOF` is in the wrapped chain.

**Bug:** `*ReadErr` does not implement `Unwrap`. `errors.Is` cannot walk past it.

**Fix:**
```go
func (e *ReadErr) Unwrap() error { return e.Err }
```

---

## Bug 4 — `errors.As` panics

```go
package main

import (
    "errors"
    "fmt"
)

type ValErr struct{ Field string }

func (e *ValErr) Error() string { return "v: " + e.Field }

func main() {
    err := &ValErr{Field: "name"}
    var ve ValErr
    errors.As(err, ve)
    fmt.Println(ve.Field)
}
```

**Symptom:** runtime panic about a non-pointer target.

**Bug:** `errors.As` requires the second argument to be a *pointer* to a target variable. We passed `ve`, not `&ve`. Also, `*ValErr` (the wrapped type) is a pointer; the target should match: `var ve *ValErr; errors.As(err, &ve)`.

**Fix:**
```go
var ve *ValErr
if errors.As(err, &ve) {
    fmt.Println(ve.Field)
}
```

---

## Bug 5 — Recursive `Error()`

```go
package main

import "fmt"

type E struct{ Inner error }

func (e *E) Error() string {
    return fmt.Sprintf("layer: %s", e)
}

func main() {
    e := &E{}
    fmt.Println(e)
}
```

**Symptom:** stack overflow.

**Bug:** `fmt.Sprintf("%s", e)` calls `e.Error()` recursively because `*E` implements `error`/`Stringer`.

**Fix:** print fields, not the receiver:
```go
return fmt.Sprintf("layer: %v", e.Inner)
```

---

## Bug 6 — JSON loses the cause

```go
package main

import (
    "encoding/json"
    "errors"
    "fmt"
)

type DBErr struct {
    Op  string
    Err error
}

func (e *DBErr) Error() string { return e.Op + ": " + e.Err.Error() }

func main() {
    err := &DBErr{Op: "Get", Err: errors.New("connection refused")}
    b, _ := json.Marshal(err)
    fmt.Println(string(b))
}
```

**Symptom:** prints `{"Op":"Get","Err":{}}`. The cause is empty.

**Bug:** default JSON marshalling reflects exported fields. The `Err` field is an `error` interface whose concrete type (`errorString`) has no exported fields, so it marshals as `{}`.

**Fix:** implement `MarshalJSON`:
```go
func (e *DBErr) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Op    string `json:"op"`
        Cause string `json:"cause,omitempty"`
    }{Op: e.Op, Cause: errStr(e.Err)})
}

func errStr(err error) string {
    if err == nil { return "" }
    return err.Error()
}
```

---

## Bug 7 — Mixed receivers

```go
package main

import "fmt"

type E struct{ msg string }

func (e E)  Error() string { return e.msg }
func (e *E) Code() int     { return 1 }

func produce() error {
    return E{msg: "boom"}
}

func main() {
    err := produce()
    if c, ok := err.(interface{ Code() int }); ok {
        fmt.Println(c.Code())
    } else {
        fmt.Println("no Code")
    }
}
```

**Symptom:** prints `no Code`.

**Bug:** `Error()` is on the value receiver; `Code()` is on the pointer receiver. We returned a *value* `E{}`. Its method set does not include pointer-receiver methods. So the interface assertion to `Code() int` fails.

**Fix:** be consistent. Use pointer receivers for both, and return `&E{...}`. Or use value receivers for both. Mixed receivers on the same type are a code smell.

---

## Bug 8 — Sentinel double-creation

```go
package somepkg

import "errors"

func ErrNotFound() error {
    return errors.New("not found")
}
```

```go
// In some other file
err := somepkg.ErrNotFound()
if errors.Is(err, somepkg.ErrNotFound()) { ... } // never matches
```

**Symptom:** the `errors.Is` check is always false.

**Bug:** `ErrNotFound()` is a function returning a *new* `errorString` each call. Two calls produce two different pointers; `errors.Is` compares by identity and the new instance is not the same as the one returned earlier.

**Fix:** make it a package-level variable, not a function:
```go
var ErrNotFound = errors.New("not found")
```

---

## Bug 9 — Pool corrupts logs

```go
package main

import (
    "fmt"
    "sync"
)

type E struct{ msg string }

func (e *E) Error() string { return e.msg }

var pool = sync.Pool{New: func() any { return &E{} }}

func produce(msg string) error {
    e := pool.Get().(*E)
    e.msg = msg
    // imagine a defer that puts e back
    defer pool.Put(e)
    return e
}

func main() {
    err := produce("first")
    fmt.Println(err) // may print "second" if scheduler is unlucky
}
```

**Symptom:** logs show wrong messages, especially under load.

**Bug:** the error is `Put` back to the pool *before* the caller reads it. The next `Get` resets `msg`, racing with whoever holds the old reference.

**Fix:** do not pool errors that escape the function. Errors leak into logs, channels, deferred reads — pooling is unsafe unless you fully control retention.

---

## Bug 10 — `Format` infinite loop

```go
package main

import (
    "fmt"
)

type E struct{ msg string }

func (e *E) Error() string { return e.msg }

func (e *E) Format(s fmt.State, v rune) {
    fmt.Fprintf(s, "%v", e)
}

func main() {
    e := &E{msg: "x"}
    fmt.Printf("%+v\n", e)
}
```

**Symptom:** stack overflow.

**Bug:** `Format` calls `Fprintf("%v", e)`, which dispatches back to `e.Format(...)`.

**Fix:** print *fields*, not the receiver, inside `Format`:
```go
func (e *E) Format(s fmt.State, v rune) {
    fmt.Fprint(s, e.msg)
}
```

---

## Bug 11 — Stack captured at every wrap

```go
type E struct {
    Op   string
    Err  error
    pcs  [32]uintptr
    npcs int
}

func wrap(op string, inner error) *E {
    e := &E{Op: op, Err: inner}
    e.npcs = runtime.Callers(2, e.pcs[:])
    return e
}

func leaf() error {
    return wrap("leaf", io.EOF)
}

func mid() error {
    return wrap("mid", leaf())
}

func top() error {
    return wrap("top", mid())
}
```

**Symptom:** printing `%+v` shows three stacks, all pointing at slightly different frames; readers cannot tell which one to look at.

**Bug:** every wrap captures a stack. Only the *leaf* should.

**Fix:**
```go
func wrap(op string, inner error) *E {
    e := &E{Op: op, Err: inner}
    if inner == nil {
        e.npcs = runtime.Callers(2, e.pcs[:])
    }
    return e
}
```
Or split into `New` (captures) and `Wrap` (does not).

---

## Bug 12 — Embedded `error` swallows `Unwrap`

```go
type Wrapper struct {
    Op string
    error
}

err := &Wrapper{Op: "x", error: io.EOF}
fmt.Println(errors.Is(err, io.EOF)) // false
```

**Symptom:** despite the embedded `error` field, `errors.Is` does not find `io.EOF`.

**Bug:** embedding promotes `Error()` (so `*Wrapper` satisfies `error`) but does *not* automatically promote `Unwrap()`. The chain ends at `*Wrapper`.

**Fix:** add an explicit `Unwrap`:
```go
func (w *Wrapper) Unwrap() error { return w.error }
```

---

## Bug 13 — Concurrent mutation of error fields

```go
type E struct{ Visited int }
func (e *E) Error() string { return fmt.Sprintf("visited %d", e.Visited) }

var sentinel = &E{}

func handle(err error) {
    var ee *E
    if errors.As(err, &ee) {
        ee.Visited++ // mutating a shared sentinel from many goroutines
    }
}
```

**Symptom:** intermittent crashes, race detector reports.

**Bug:** the "sentinel" is a shared pointer. Mutating it in many goroutines is a data race.

**Fix:** sentinels should be immutable. If you need per-call counters, allocate a new error each time, or use atomics:
```go
type E struct{ Visited atomic.Int64 }
```
But better: don't mutate sentinels at all.

---

## Bug 14 — Custom `Is` never walks

```go
type E struct {
    Code int
    Err  error
}

func (e *E) Error() string { return fmt.Sprintf("code=%d", e.Code) }

func (e *E) Is(target error) bool {
    var t *E
    if !errors.As(target, &t) { return false }
    return e.Code == t.Code
}

// no Unwrap()

err := fmt.Errorf("layer: %w", &E{Code: 5, Err: io.EOF})
errors.Is(err, io.EOF) // false
```

**Symptom:** `io.EOF` not found.

**Bug:** `*E` has no `Unwrap`, so the chain stops there. `Is` only matches against another `*E`.

**Fix:** add `Unwrap`:
```go
func (e *E) Unwrap() error { return e.Err }
```

---

## Bug 15 — Public-facing leak

```go
func writeError(w http.ResponseWriter, err error) {
    json.NewEncoder(w).Encode(err)
}
```

with

```go
type DBErr struct {
    Query string
    Args  []any
    Err   error
}
```

**Symptom:** clients see queries, parameters, and database error strings.

**Bug:** `json.NewEncoder(w).Encode(err)` reflects exported fields straight to the client. SQL strings, internal IDs, and host names all leak.

**Fix:** route public responses through a sanitised DTO:
```go
type publicErr struct {
    Code    string `json:"code"`
    Message string `json:"message"`
}

func writeError(w http.ResponseWriter, err error) {
    var e *DBErr
    if errors.As(err, &e) {
        json.NewEncoder(w).Encode(publicErr{Code: "DB_ERROR", Message: "internal error"})
        log.Printf("internal: %+v", e) // log full detail server-side
        return
    }
    json.NewEncoder(w).Encode(publicErr{Code: "INTERNAL", Message: "internal error"})
}
```

---

## Wrap-up

The recurring themes across these bugs:

- **The typed-nil trap** is the most expensive single mistake.
- **Forgetting `Unwrap`** breaks every chain-walking helper silently.
- **Mixing receivers** breaks method sets at unexpected call sites.
- **Default JSON** does the wrong thing — never trust it for an error type.
- **Stack capture at every layer** is noise.
- **Pooling errors** is almost always a mistake.
- **Recursion in `Error()` or `Format`** crashes.
- **Mutating shared sentinels** races.
- **Public-facing JSON of internal types** leaks.

Build a small unit-test harness that catches each of these in your own code base.
