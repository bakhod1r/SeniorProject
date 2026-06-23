# Custom Error Types — Specification

## Table of Contents
1. [The `error` Interface](#the-error-interface)
2. [The `Unwrap` Convention](#the-unwrap-convention)
3. [`errors.Is` Semantics](#errorsis-semantics)
4. [`errors.As` Semantics](#errorsas-semantics)
5. [`errors.Join` and `Unwrap() []error`](#errorsjoin-and-unwrap-error)
6. [The `fmt.Formatter` Interface](#the-fmtformatter-interface)
7. [The `json.Marshaler` and `encoding.TextMarshaler` Interfaces](#the-jsonmarshaler-and-encodingtextmarshaler-interfaces)
8. [`%w` Verb in `fmt.Errorf`](#w-verb-in-fmterrorf)
9. [Nil-Interface Semantics](#nil-interface-semantics)
10. [Method Set Rules for Pointer vs Value Receivers](#method-set-rules-for-pointer-vs-value-receivers)
11. [Compatibility Table](#compatibility-table)
12. [Reference Implementation Skeleton](#reference-implementation-skeleton)
13. [Further Reading](#further-reading)

---

## The `error` Interface

Defined in the predeclared identifier set (effectively in `builtin/builtin.go` for documentation):

```go
type error interface {
    Error() string
}
```

Rules:
- Any concrete type implementing `Error() string` satisfies `error`.
- `Error` is a regular method; receiver may be a value or pointer.
- The implementation should not return an empty string. The runtime treats a nil `error` interface specially; an empty message is *not* the same as no error.
- `Error()` should not panic. If it does, surrounding code (logging, formatting, recovery) becomes unreliable.
- `Error()` should be safe to call on the same value from multiple goroutines, in practice — Go does not require it but every standard error supports it. Avoid mutating internal fields inside `Error()`.

---

## The `Unwrap` Convention

Two valid signatures since Go 1.20:

```go
Unwrap() error
Unwrap() []error
```

`errors.Unwrap(err error) error` returns the result of calling `err.Unwrap()` if the method exists and returns a single error; otherwise nil. For the multi-error form, `errors.Unwrap` returns nil — you must use `errors.Is`/`errors.As` to traverse.

Conformance:
- A type with `Unwrap() error` is assumed to carry exactly one inner error.
- A type with `Unwrap() []error` carries zero or more inner errors.
- Both methods on the same type is undefined; only one is allowed.
- A nil `Unwrap` result terminates the chain.
- Cycles in the chain are undefined behavior (`errors.Is` is not guaranteed to terminate).

---

## `errors.Is` Semantics

```go
func Is(err, target error) bool
```

Pseudocode:

```
for {
    if err == target { return true }
    if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) { return true }
    switch u := err.(type) {
    case interface{ Unwrap() error }:
        err = u.Unwrap()
        if err == nil { return false }
    case interface{ Unwrap() []error }:
        for _, e := range u.Unwrap() {
            if Is(e, target) { return true }
        }
        return false
    default:
        return false
    }
}
```

Notes:
- Identity comparison (`==`) checks at every level *first*, so a sentinel reachable through `Unwrap` chain matches.
- The `Is(target error) bool` method is consulted *after* identity. Implement it when:
  - Multiple sentinels should match the same custom type.
  - Comparison is by *value* of fields, not pointer identity.
- A custom `Is` should *not* call `errors.Is(e.Err, target)` — that is the chain walker's job.

---

## `errors.As` Semantics

```go
func As(err error, target any) bool
```

Pseudocode:

```
require target is a non-nil pointer to:
    a type that implements error, or
    an interface type
for {
    if reflect.TypeOf(err).AssignableTo(reflect.TypeOf(target).Elem()) {
        *target = err
        return true
    }
    if x, ok := err.(interface{ As(any) bool }); ok && x.As(target) { return true }
    switch u := err.(type) {
    case interface{ Unwrap() error }:
        err = u.Unwrap()
        if err == nil { return false }
    case interface{ Unwrap() []error }:
        for _, e := range u.Unwrap() {
            if As(e, target) { return true }
        }
        return false
    default:
        return false
    }
}
```

Notes:
- Panics if `target` is nil, not a pointer, or is `*error`.
- Assignment uses Go assignment rules; `As` does not call methods other than `As` itself.
- A custom `As(target any) bool` is rare. The most common reason: an envelope type that should expose a deeper inner type without unwrapping.

---

## `errors.Join` and `Unwrap() []error`

`errors.Join(errs ...error) error` (Go 1.20+) returns a value satisfying:

```go
type joinError struct {
    errs []error
}
func (e *joinError) Error() string  { /* newline-joined */ }
func (e *joinError) Unwrap() []error { return e.errs }
```

Behaviour:
- If all inputs are nil, returns nil.
- Nil inputs are filtered out.
- The error string is each child's message joined by `"\n"`.
- `errors.Is`/`errors.As` recurse into all children; first match wins (DFS, in order).

You may implement `Unwrap() []error` on your own types to participate in the same traversal.

---

## The `fmt.Formatter` Interface

```go
type Formatter interface {
    Format(f State, c rune)
}
```

When implemented, `fmt.Printf("%v", err)` calls `Format(state, 'v')`. Customary verbs:

| Verb | Convention |
|------|-----------|
| `%s`, `%v` | Same as `Error()` — short, single line. |
| `%+v` | Verbose: include cause chain, fields, optional stack. |
| `%q` | Quoted version of `%s`. |
| `%w` | Reserved by `fmt.Errorf` — *not* delivered to `Format` of an error. |

Implementations should:
- Honour the `+` flag for richness.
- Honour the width/precision flags for compatibility with logging libraries.
- Default to `Error()` for unknown verbs.

```go
func (e *Error) Format(s fmt.State, c rune) {
    switch c {
    case 's', 'v':
        if c == 'v' && s.Flag('+') {
            // verbose form
            fmt.Fprintf(s, "%s\n%+v", e.Error(), e.Err)
            return
        }
        io.WriteString(s, e.Error())
    case 'q':
        fmt.Fprintf(s, "%q", e.Error())
    default:
        fmt.Fprintf(s, "%%!%c(%T)", c, e)
    }
}
```

---

## The `json.Marshaler` and `encoding.TextMarshaler` Interfaces

`encoding/json` does **not** call `Error()` by default. It treats the value as a struct and marshals exported fields. To control the wire shape:

```go
type jsonMarshaler interface {
    MarshalJSON() ([]byte, error)
}

type textMarshaler interface {
    MarshalText() ([]byte, error)
}
```

For custom errors, prefer `MarshalJSON` returning a deliberate DTO:

```go
func (e *Error) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Code  string `json:"code"`
        Op    string `json:"op,omitempty"`
        Cause string `json:"cause,omitempty"`
    }{
        Code:  string(e.Code),
        Op:    string(e.Op),
        Cause: errString(e.Err),
    })
}
```

Symmetric `UnmarshalJSON` is rarely needed unless errors travel back into a Go process.

---

## `%w` Verb in `fmt.Errorf`

```go
fmt.Errorf("layer: %w", inner)
```

Behaviour:
- The returned error implements `Unwrap() error` and returns `inner`.
- Multiple `%w` (Go 1.20+) produce a value with `Unwrap() []error`.
- The wrap is *anonymous*: the returned type is `*fmt.wrapError` (or similar), not exported.
- `errors.Is`/`errors.As` therefore traverse it normally.
- `%w` may appear at most once per `fmt.Errorf` in Go < 1.20; multiple are allowed in 1.20+.
- Using `%w` with a non-error operand is an error checked at runtime.

Limitations:
- The wrapped error is the *only* structured information. Fields are encoded only into the message string.
- There is no way to add an `Op` or `Kind` to the wrap with `%w` alone — you need a custom type.

---

## Nil-Interface Semantics

Quoting the Go FAQ: an interface value is `nil` only when *both* its type and its value are nil. Therefore:

```go
var p *MyErr = nil
var err error = p   // (type=*MyErr, value=nil)
err == nil          // false
```

Required practice for error-returning functions:

```go
func F() error {
    var p *MyErr
    if cond {
        p = &MyErr{...}
    }
    if p != nil {
        return p
    }
    return nil // never `return p` if p might be nil
}
```

`go vet` does not catch every instance; the rule must be enforced by code review and tests.

---

## Method Set Rules for Pointer vs Value Receivers

Given:

```go
type T struct{}
func (T)  M() {}
func (*T) N() {}
```

| Expression | Has `M`? | Has `N`? |
|------------|----------|----------|
| `T{}` | Yes | No |
| `&T{}` | Yes | Yes |
| `*T` (type) | Yes | Yes |
| `T` (type) | Yes | No |

For an error type with a pointer-receiver `Error()`:
- `&MyErr{}` is an `error`.
- `MyErr{}` is *not* an `error`.
- Therefore you cannot do `errors.Is(MyErr{}, ...)`. Always use a pointer.

For a value-receiver `Error()`:
- Both `MyErr{}` and `&MyErr{}` are errors.
- Comparisons by value happen with `==`. Comparisons by pointer happen with pointer equality. Be deliberate.

---

## Compatibility Table

| Standard interface | Required method | Optional? |
|--------------------|----------------|----------|
| `error` | `Error() string` | Required |
| `errors.Unwrap` chain (single) | `Unwrap() error` | Optional |
| `errors.Unwrap` chain (multi) | `Unwrap() []error` | Optional |
| `errors.Is` custom matching | `Is(error) bool` | Optional |
| `errors.As` custom matching | `As(any) bool` | Optional |
| `fmt` rich formatting | `Format(fmt.State, rune)` | Optional |
| `encoding/json` wire shape | `MarshalJSON() ([]byte, error)` | Optional |
| `encoding` text shape | `MarshalText() ([]byte, error)` | Optional |
| `net.Error` timeout/temp | `Timeout() bool`, `Temporary() bool` | Required for net.Error |

Implement the smallest set that meets your needs. Adding interfaces is forward-compatible; removing is not.

---

## Reference Implementation Skeleton

```go
package errs

import (
    "errors"
    "fmt"
    "io"
    "runtime"
    "strings"
)

type Op string
type Kind uint8

const (
    KindOther Kind = iota
    KindNotExist
    KindExist
    KindPermission
    KindInvalid
    KindIO
    KindInternal
)

func (k Kind) String() string {
    switch k {
    case KindNotExist:   return "not exist"
    case KindExist:      return "already exists"
    case KindPermission: return "permission denied"
    case KindInvalid:    return "invalid"
    case KindIO:         return "I/O error"
    case KindInternal:   return "internal"
    }
    return "other"
}

type Error struct {
    Op   Op
    Kind Kind
    Path string
    Err  error
    pcs  [16]uintptr
    npcs int
}

func E(args ...any) *Error {
    e := &Error{}
    for _, a := range args {
        switch v := a.(type) {
        case Op:    e.Op = v
        case Kind:  e.Kind = v
        case string:
            if e.Path == "" { e.Path = v }
        case *Error:
            cp := *v; e.Err = &cp
        case error:
            e.Err = v
        }
    }
    e.npcs = runtime.Callers(2, e.pcs[:])
    return e
}

func (e *Error) Error() string {
    var b strings.Builder
    if e.Op != ""   { b.WriteString(string(e.Op)); b.WriteString(": ") }
    if e.Path != "" { b.WriteString(e.Path);       b.WriteString(": ") }
    if e.Err != nil { b.WriteString(e.Err.Error()) } else { b.WriteString(e.Kind.String()) }
    return b.String()
}

func (e *Error) Unwrap() error { return e.Err }

func (e *Error) Is(target error) bool {
    var t *Error
    if !errors.As(target, &t) { return false }
    if t.Kind != KindOther && t.Kind != e.Kind { return false }
    if t.Op != "" && t.Op != e.Op { return false }
    return true
}

func (e *Error) Format(s fmt.State, v rune) {
    switch v {
    case 'v':
        if s.Flag('+') {
            fmt.Fprintln(s, e.Error())
            if e.npcs > 0 {
                fr := runtime.CallersFrames(e.pcs[:e.npcs])
                for {
                    f, more := fr.Next()
                    fmt.Fprintf(s, "\t%s\n\t\t%s:%d\n", f.Function, f.File, f.Line)
                    if !more { break }
                }
            }
            return
        }
        fallthrough
    case 's':
        io.WriteString(s, e.Error())
    case 'q':
        fmt.Fprintf(s, "%q", e.Error())
    }
}

func (e *Error) MarshalJSON() ([]byte, error) {
    return jsonMarshal(struct {
        Op    string `json:"op,omitempty"`
        Kind  string `json:"kind,omitempty"`
        Path  string `json:"path,omitempty"`
        Cause string `json:"cause,omitempty"`
    }{
        Op:    string(e.Op),
        Kind:  e.Kind.String(),
        Path:  e.Path,
        Cause: errString(e.Err),
    })
}
```

This template — `Op`, `Kind`, `Path`, `Err`, optional stack, custom `Is`, `Unwrap`, `Format`, `MarshalJSON` — is the reference skeleton that scales.

---

## Further Reading

- [Package errors](https://pkg.go.dev/errors) — `Is`, `As`, `Join`, `Unwrap`
- [Package fmt](https://pkg.go.dev/fmt) — `Errorf`, `%w`, `Formatter`
- [The Go Programming Language Specification](https://go.dev/ref/spec) — interface semantics, method sets
- [Effective Go — Errors](https://go.dev/doc/effective_go#errors)
- [Go FAQ — Why is my nil error value not equal to nil?](https://go.dev/doc/faq#nil_error)
- [Proposal: error wrapping](https://go.googlesource.com/proposal/+/master/design/29934-error-values.md)
