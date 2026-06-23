# error interface — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Pointer vs Value Receivers](#pointer-vs-value-receivers)
3. [Method Sets and Interface Satisfaction](#method-sets-and-interface-satisfaction)
4. [Behavioral Interfaces](#behavioral-interfaces)
5. [Embedding error](#embedding-error)
6. [Composing Multiple Interfaces](#composing-multiple-interfaces)
7. [Stringer vs Error](#stringer-vs-error)
8. [Custom Is and As Methods](#custom-is-and-as-methods)
9. [Comparable vs Non-Comparable Errors](#comparable-vs-non-comparable-errors)
10. [Nil Receivers](#nil-receivers)
11. [Refactoring Errors](#refactoring-errors)
12. [Common Patterns from the Standard Library](#common-patterns-from-the-standard-library)
13. [Anti-Patterns](#anti-patterns)
14. [Summary](#summary)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you wrote a struct + an `Error()` method and stopped. At middle level the questions multiply: pointer or value? embed or compose? add fields or methods? When does an error need an `Unwrap`, a custom `Is`, an `As`? And when do you stop and use `errors.New`?

This file is the middle-of-the-road decision-making manual.

---

## Pointer vs Value Receivers

```go
// Pointer receiver
type PathError struct{ Path string }
func (e *PathError) Error() string { return "path: " + e.Path }

// Value receiver
type CodeError struct{ Code int }
func (e CodeError) Error() string { return "code" }
```

| Choose | When |
|--------|------|
| **Pointer receiver** | The struct has fields, may be modified, allocates on the heap anyway, and you want pointer identity for `errors.Is` comparisons. |
| **Value receiver** | The type is a primitive (`type ErrCode string`), is empty (`type ErrFoo struct{}`), or you specifically want value identity. |

Standard library overwhelmingly uses pointer receivers for error types. Default to pointer.

**Identity matters**: `errors.Is(a, b)` first does `a == b`. For pointer types, equality is "same pointer." For value types, equality is "same fields." A pointer-typed sentinel (`var ErrX = &MyErr{...}`) is identified by address — many copies of the same value are *not* equal. A value-typed sentinel (`type Sentinel string; const ErrX = Sentinel("x")`) compares by value — useful for enum-like cases.

---

## Method Sets and Interface Satisfaction

This rule trips up many Go developers:

> **A method declared on a value receiver is in the method set of both `T` and `*T`. A method declared on a pointer receiver is in the method set of `*T` only.**

Implication for errors:

```go
type Foo struct{}
func (f *Foo) Error() string { return "foo" }

var v Foo = Foo{}
var i error = v   // COMPILE ERROR: Foo does not satisfy error (Error has pointer receiver)
var i error = &v  // OK
```

If your error type has a pointer receiver, you must return a pointer. Returning the value silently fails to satisfy the interface.

Conversely, value receivers are *more permissive*:

```go
type Bar struct{}
func (b Bar) Error() string { return "bar" }

var v Bar = Bar{}
var i error = v   // OK
var i error = &v  // OK
```

But: addressability still matters. If `Bar` is used through an interface and you want to call methods that mutate it, you cannot — interface values are not addressable.

---

## Behavioral Interfaces

A *behavioral* interface defines what an error can *do*, beyond just having a message. Examples from real code:

```go
type Temporary interface {
    Temporary() bool
}

type Timeout interface {
    Timeout() bool
}

type Retryable interface {
    Retryable() bool
}
```

Code that wants to retry can ask:

```go
if t, ok := err.(Temporary); ok && t.Temporary() {
    // retry
}
```

Or with `errors.As`:

```go
var t Temporary
if errors.As(err, &t) && t.Temporary() {
    // retry
}
```

This decouples "what kind of error" (concrete type) from "what should I do" (capability). The `net` package historically used this for deciding whether to retry.

> Note: Modern Go discourages broad behavioral interfaces in favor of named sentinels. But the pattern is still useful for capability-based dispatch.

---

## Embedding error

Embedding the `error` interface (or another error type) lets you compose:

```go
type ValidationError struct {
    error             // embedded interface
    Field string
}

func main() {
    e := ValidationError{
        error: fmt.Errorf("invalid"),
        Field: "email",
    }
    fmt.Println(e.Error())  // "invalid"  (delegated to embedded error)
    fmt.Println(e.Field)    // "email"
}
```

The embedded `error` provides the `Error()` method automatically; you can override or add more.

Be careful: this can be confusing if you also want `Unwrap` behavior — embedding does not automatically wire up `Unwrap`. You may need to explicitly define one:

```go
func (e *ValidationError) Unwrap() error { return e.error }
```

---

## Composing Multiple Interfaces

Your error can satisfy more than just `error`:

```go
type APIError struct {
    Status int
    Msg    string
}

func (e *APIError) Error() string  { return e.Msg }
func (e *APIError) StatusCode() int { return e.Status }
```

Now `*APIError` satisfies `error` *and* a custom `interface { StatusCode() int }`. A handler can do:

```go
type statusCoder interface{ StatusCode() int }

func writeError(w http.ResponseWriter, err error) {
    code := http.StatusInternalServerError
    var sc statusCoder
    if errors.As(err, &sc) {
        code = sc.StatusCode()
    }
    http.Error(w, err.Error(), code)
}
```

Decoupled: the handler does not know about `*APIError`; it only knows the `statusCoder` interface.

---

## Stringer vs Error

Two adjacent interfaces:

```go
type Stringer interface {  // fmt.Stringer
    String() string
}

type error interface {
    Error() string
}
```

Both return strings. Both are used by `fmt.Println` and `%v`. **`Error()` wins**: if a type has both methods, `fmt` calls `Error()`.

Do not implement *only* `String()` if you want the value to be printable as an error — provide `Error()`. Do not implement both unless you have a clear reason for distinct text in error vs string contexts.

---

## Custom Is and As Methods

By default, `errors.Is(err, target)` does `err == target` (and walks the chain). For **typed errors** that hold variable data, equality may not be what you want. Define a custom `Is`:

```go
type DBError struct {
    Code string
}

func (e *DBError) Error() string { return "db: " + e.Code }

func (e *DBError) Is(target error) bool {
    t, ok := target.(*DBError)
    return ok && e.Code == t.Code
}
```

Now `errors.Is(someErr, &DBError{Code: "23505"})` works regardless of which specific instance was returned.

Custom `As`:

```go
func (e *DBError) As(target any) bool {
    if pp, ok := target.(**DBError); ok {
        *pp = e
        return true
    }
    return false
}
```

Rarely needed — the default `errors.As` based on assignability covers most cases. Custom `As` is for adapting between two different error types.

---

## Comparable vs Non-Comparable Errors

Interface values are comparable, but the comparison panics if the underlying type is non-comparable (e.g., contains a slice or map).

```go
type BadErr struct{ Tags []string }
func (e BadErr) Error() string { return "bad" }

var e1 error = BadErr{Tags: []string{"a"}}
var e2 error = BadErr{Tags: []string{"a"}}
fmt.Println(e1 == e2)  // PANIC: comparing uncomparable type BadErr
```

Two fixes:
- Use a pointer receiver: `*BadErr` is comparable (by pointer identity).
- Avoid slices/maps as fields; use strings, ints, named types.

`errors.Is` panics on non-comparable error types when checking against `==`. So **make your error types comparable** unless you have a clear reason not to.

---

## Nil Receivers

A method on a pointer receiver can be called on a nil pointer if the method doesn't dereference. This is sometimes useful:

```go
type ErrNotFound struct{}
func (e *ErrNotFound) Error() string { return "not found" }

var e *ErrNotFound  // nil pointer
fmt.Println(e.Error())  // works — Error() doesn't read e
```

But mixing nil pointers and the typed-nil interface gotcha is dangerous:

```go
func f() error {
    var e *ErrNotFound  // nil pointer
    return e            // returns NON-nil interface!
}
```

Avoid this pattern. Either always return `nil` explicitly when there is no error, or define your error type with value semantics if you need a singleton.

---

## Refactoring Errors

Common evolutions of an error type as a project grows:

1. **Step 1 — `errors.New("not found")`** scattered across files.
2. **Step 2 — sentinel:** `var ErrNotFound = errors.New("not found")`.
3. **Step 3 — typed:** `type NotFoundError struct{ Resource string }` to add the resource name.
4. **Step 4 — error kind enum:** `type Kind int; type Error struct{ Kind Kind; ... }` to unify many cases.

Each step is a refactor that adds expressiveness. Do not skip — each step costs more code, so add complexity only when needed.

---

## Common Patterns from the Standard Library

### `*os.PathError`

```go
type PathError struct {
    Op   string
    Path string
    Err  error
}
func (e *PathError) Error() string  { return e.Op + " " + e.Path + ": " + e.Err.Error() }
func (e *PathError) Unwrap() error  { return e.Err }
func (e *PathError) Timeout() bool  {
    t, ok := e.Err.(interface{ Timeout() bool })
    return ok && t.Timeout()
}
```

Three methods: `Error`, `Unwrap`, `Timeout` (delegated). This is the canonical pattern: a struct that wraps a cause and surfaces both message and behavior.

### `*net.OpError`

```go
type OpError struct {
    Op     string
    Net    string
    Source Addr
    Addr   Addr
    Err    error
}
```

Same shape. Carries operational metadata, wraps a cause, delegates `Timeout()` and `Temporary()`.

### `*json.SyntaxError`

```go
type SyntaxError struct {
    msg    string
    Offset int64
}
func (e *SyntaxError) Error() string { return e.msg }
```

A simpler variant: just a message and a position. Caller can extract the offset for diagnostics.

---

## Anti-Patterns

- **Implementing `Error()` and never returning the type.** Dead code.
- **Multiple unrelated fields glued onto one error type.** If your `MyError` has 17 fields covering 8 different conditions, split into multiple types.
- **Hierarchies via embedding to "extend" a base error.** Go is not Java; embedding is for delegation, not inheritance.
- **`Error()` that allocates heavily** (long format strings, calls to remote services). Make it cheap and predictable; defer expensive work to inspection methods.
- **Silent panic on unknown method.** A custom `Is` that ignores all but one type means the chain breaks silently.

---

## Summary

The `error` interface is shallow but enables deep composition. Pointer receivers are the default. Behavioral interfaces let you ask "can this be retried?" without tying to a concrete type. Embedding delegates `Error()`. Custom `Is`/`As` adapt comparison to the semantics of your type. Comparable types and explicit nils prevent the classic Go traps. Steal patterns from the standard library — they have been battle-tested for a decade.

---

## Further Reading

- [Effective Go: Interfaces](https://go.dev/doc/effective_go#interfaces_and_types)
- [Go FAQ: Interfaces](https://go.dev/doc/faq#different_method_sets)
- `$GOROOT/src/os/error.go`
- `$GOROOT/src/net/net.go`
- [Don't just check errors, handle them gracefully (Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
