# errors.Is vs errors.As — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The errors Package: Public API](#the-errors-package-public-api)
3. [Behavior of `errors.Is`](#behavior-of-errorsis)
4. [Behavior of `errors.As`](#behavior-of-errorsas)
5. [Behavior of `errors.Unwrap`](#behavior-of-errorsunwrap)
6. [Behavior of `errors.Join`](#behavior-of-errorsjoin)
7. [The `Unwrap`/`Is`/`As` Method Contracts](#the-unwrapisas-method-contracts)
8. [Behavior Matrix](#behavior-matrix)
9. [Panic Conditions](#panic-conditions)
10. [Compatibility Across Versions](#compatibility-across-versions)
11. [Things the Spec Does NOT Define](#things-the-spec-does-not-define)
12. [References](#references)

---

## Introduction

This document collects the formal contracts of `errors.Is`, `errors.As`, `errors.Unwrap`, and `errors.Join`, along with the optional method interfaces (`Unwrap`, `Is`, `As`) that user types may implement to participate. It covers what is documented and stable, what is panic-inducing, and what the standard library leaves unspecified.

Reference: [pkg.go.dev/errors](https://pkg.go.dev/errors), [Go 1.13 release notes](https://go.dev/doc/go1.13#error_wrapping), [Go 1.20 release notes](https://go.dev/doc/go1.20#errors).

---

## The errors Package: Public API

```go
package errors

// New returns an error that formats as the given text.
// Each call to New returns a distinct error value even if the text is identical.
func New(text string) error

// Unwrap returns the result of calling the Unwrap method on err, if err's
// type contains an Unwrap method returning error. Otherwise, Unwrap returns nil.
//
// Unwrap returns nil if the Unwrap method returns []error.
func Unwrap(err error) error

// Is reports whether any error in err's tree matches target.
//
// The tree consists of err itself, followed by the errors obtained by repeatedly
// calling Unwrap. When err wraps multiple errors, Is examines err followed by a
// depth-first traversal of its children.
//
// An error is considered to match a target if it is equal to that target or if it
// implements a method `Is(error) bool` such that Is(target) returns true.
//
// An error type might provide an Is method so it can be treated as equivalent
// to an existing error.
func Is(err, target error) bool

// As finds the first error in err's tree that matches target, and if one is found,
// sets target to that error value and returns true. Otherwise, it returns false.
//
// The tree consists of err itself, followed by the errors obtained by repeatedly
// calling Unwrap. When err wraps multiple errors, As examines err followed by a
// depth-first traversal of its children.
//
// An error matches target if the error's concrete type is assignable to the value
// pointed to by target, or if the error has a method `As(any) bool` such that
// As(target) returns true.
//
// As panics if target is not a non-nil pointer to either a type that implements
// error, or to any interface type.
func As(err error, target any) bool

// Join returns an error that wraps the given errors. Any nil error values are
// discarded. Join returns nil if every value in errs is nil.
//
// The error formats as the concatenation of the strings obtained by calling
// the Error method of each element of errs, with a newline between each string.
//
// A non-nil error returned by Join implements the `Unwrap() []error` method.
func Join(errs ...error) error

// ErrUnsupported indicates that a requested operation cannot be performed,
// because it is unsupported. (Added in Go 1.21.)
var ErrUnsupported = New("unsupported operation")
```

---

## Behavior of `errors.Is`

### Inputs and outputs

```go
func Is(err, target error) bool
```

- Returns **true** if any error in `err`'s tree matches `target`.
- Returns **false** otherwise, including when:
  - `err` is nil and `target` is non-nil.
  - `target` is nil and `err` is non-nil.
- Returns **true** when both `err` and `target` are nil.
- Never panics under normal use. (See "Panic Conditions" for edge cases.)

### Walk algorithm

1. If `target == nil`, return `err == nil`.
2. Compute `isComparable := reflect.TypeOf(target).Comparable()`.
3. Loop:
   1. If `isComparable && err == target`, return true.
   2. If `err` implements `Is(error) bool` and `err.Is(target)` is true, return true.
   3. If `err` implements `Unwrap() error`:
      - Set `err = err.Unwrap()`. If now nil, return false. Else continue loop.
   4. If `err` implements `Unwrap() []error`:
      - For each child, recursively call `Is(child, target)`. If any returns true, return true.
      - Return false.
   5. Otherwise return false.

### Match rules

| Rule | Match condition |
|------|----------------|
| Default equality | `err == target`, only when `target`'s dynamic type is comparable. |
| Custom `Is` | `err.(interface{ Is(error) bool }).Is(target)` returns true. |

A node matches if either rule fires. Custom `Is` fires *after* default equality, so it cannot mask a literal equality match — but it can broaden matching beyond `==`.

---

## Behavior of `errors.As`

### Inputs and outputs

```go
func As(err error, target any) bool
```

- Returns **true** if a matching error was found, and `*target` is set to that error.
- Returns **false** otherwise.
- Returns **false** when `err` is nil.
- **Panics** when `target` is nil, not a pointer, or a pointer to a type that neither implements `error` nor is an interface type.

### Walk algorithm

1. Validate `target`:
   - `target` must be non-nil.
   - `target` must be a pointer (`reflect.Ptr`).
   - The pointer must be non-nil.
   - `*target`'s type must implement `error` or be an interface type.
2. If any validation fails, panic.
3. Loop:
   1. If the dynamic type of `err` is assignable to `targetType`:
      - Set `*target = err` (via reflection).
      - Return true.
   2. If `err` implements `As(any) bool` and `err.As(target)` returns true:
      - Return true. (The `As` method is responsible for setting `*target`.)
   3. If `err` implements `Unwrap() error`:
      - `err = err.Unwrap()`. If now nil, return false. Else continue loop.
   4. If `err` implements `Unwrap() []error`:
      - For each child, recursively call `As(child, target)`. If any returns true, return true.
      - Return false.
   5. Otherwise return false.

### Match rules

| Rule | Match condition |
|------|----------------|
| Default assignability | `reflect.TypeOf(err).AssignableTo(reflect.TypeOf(target).Elem())`. |
| Custom `As` | `err.(interface{ As(any) bool }).As(target)` returns true. |

A node matches if either rule fires. Custom `As` fires *after* default assignability.

### What `target` can be

- `*T` where `T` implements `error`. Example: `var pe *os.PathError; errors.As(err, &pe)`.
- `*I` where `I` is an interface type (typically containing `error`). Example: `var t Temporary; errors.As(err, &t)`.

What `target` **cannot** be:
- `T` (not a pointer).
- `nil`.
- `*int`, `*string`, etc. — types that neither implement `error` nor are interfaces.

---

## Behavior of `errors.Unwrap`

```go
func Unwrap(err error) error
```

- Returns the result of calling `err.Unwrap() error`, if such a method exists.
- Returns **nil** if `err` is nil.
- Returns **nil** if `err` does not implement `Unwrap() error`.
- Returns **nil** if `err` only implements `Unwrap() []error` (the multi-error variant).
- Does NOT walk the chain. It returns the *immediate* next link, not the deepest cause.

To get the deepest cause, loop:

```go
for {
    next := errors.Unwrap(err)
    if next == nil {
        return err // err is the cause
    }
    err = next
}
```

---

## Behavior of `errors.Join`

```go
func Join(errs ...error) error
```

- Returns **nil** if all `errs` are nil (or if `errs` is empty).
- Otherwise returns a non-nil error wrapping all non-nil entries.
- The returned error's `Error()` method concatenates each child's `Error()` joined by `"\n"`.
- The returned error implements `Unwrap() []error` returning the original (non-nil) `errs` slice.
- The returned error does **not** implement `Unwrap() error`. `errors.Unwrap(joined)` returns nil.
- A single-arg `Join(err)` (with err non-nil) **does** return a wrapper, not `err` itself.

Examples:

```go
errors.Join()                         // nil
errors.Join(nil)                      // nil
errors.Join(nil, nil)                 // nil
errors.Join(io.EOF)                   // wrapper around [io.EOF], not io.EOF
errors.Join(io.EOF, io.ErrUnexpectedEOF) // wrapper around [io.EOF, io.ErrUnexpectedEOF]
errors.Join(nil, io.EOF, nil, errFoo) // wrapper around [io.EOF, errFoo]
```

---

## The `Unwrap`/`Is`/`As` Method Contracts

### `Unwrap() error`

```go
type singleUnwrapper interface { Unwrap() error }
```

- Returns the immediate next error in the chain.
- Returns nil at the end of the chain.
- Should not return the receiver (cycle).
- Should be deterministic: the same call returns the same error each time.

### `Unwrap() []error`

```go
type multiUnwrapper interface { Unwrap() []error }
```

- Returns the slice of immediate child errors.
- The returned slice should not be mutated by callers (it is shared with the wrapper).
- Returning an empty slice is allowed (matches a node with no children).
- A nil entry in the slice is permitted; the walk will skip nil children gracefully.
- Should be deterministic: the same call returns the same slice.

### `Is(target error) bool`

```go
type isMatcher interface { Is(target error) bool }
```

- Returns true if `e` (the receiver) should be considered equivalent to `target`.
- Should be a pure function of `e` and `target` (no side effects).
- Need not be symmetric: `a.Is(b)` may differ from `b.Is(a)`.
- Need not be reflexive: `e.Is(e)` is decided by the implementer.
- The receiver may be nil; the method should handle nil receivers safely.

### `As(target any) bool`

```go
type asExtractor interface { As(target any) bool }
```

- Inspects `target` (which is a pointer; check its element type via type-switch).
- If the receiver can fill `*target`, sets `*target` and returns true.
- Returns false if no fill is possible. Does not modify `*target` on false.
- Should not panic on unexpected `target` types — return false instead.
- The receiver may be nil; the method should handle nil receivers safely.

A typical implementation:

```go
func (e *MyErr) As(target any) bool {
    switch t := target.(type) {
    case **MyErr:
        *t = e
        return true
    case *KindCode:
        *t = e.Code
        return true
    }
    return false
}
```

---

## Behavior Matrix

| Input shape | `errors.Is` returns | `errors.As` returns |
|-------------|---------------------|---------------------|
| `Is(nil, nil)` / `As(nil, &x)` | true / false | (see comparable) |
| `Is(err, nil)`, err ≠ nil | false | n/a |
| `Is(nil, target)` | false | false |
| `Is(err, target)`, exact match at depth 0 | true | true |
| `Is(err, target)`, match after Unwrap | true | true |
| `Is(err, target)`, target is non-comparable, no custom `Is` | false (silent) | (n/a) |
| `As(err, &concrete)`, err's type assignable to concrete | true, sets target | (matches) |
| `As(err, &iface)`, err implements iface | true, sets target | (matches) |
| `As(err, target)` with target == nil | n/a | panic |
| `As(err, target)` with non-pointer target | n/a | panic |
| `As(err, target)` with pointer to non-error non-interface | n/a | panic |

---

## Panic Conditions

`errors.Is` does not panic in any documented case. (It can panic if a custom `Is` method panics, but that is the method's fault.)

`errors.As` panics if **and only if**:

1. `target == nil`. Message: `errors: target cannot be nil`.
2. `reflect.ValueOf(target).Kind() != reflect.Ptr`. Message: `errors: target must be a non-nil pointer`.
3. `reflect.ValueOf(target).IsNil()`. Same message.
4. `targetType` does not implement `error` and is not an interface. Message: `errors: *target must be interface or implement error`.

The panic happens **before** the chain walk; you do not get a partial walk.

`errors.Join` does not panic.

`errors.Unwrap` does not panic.

`fmt.Errorf` panics if `%w` is used with a non-error argument.

---

## Compatibility Across Versions

| Feature | Introduced in | Stable since |
|---------|---------------|--------------|
| `errors.New` | Go 1.0 | always |
| `errors.Is` | Go 1.13 | 1.13 |
| `errors.As` | Go 1.13 | 1.13 |
| `errors.Unwrap` | Go 1.13 | 1.13 |
| `fmt.Errorf("%w", err)` | Go 1.13 | 1.13 |
| `Unwrap() []error` interface | Go 1.20 | 1.20 |
| `errors.Join` | Go 1.20 | 1.20 |
| `fmt.Errorf` with multiple `%w` | Go 1.20 | 1.20 |
| `errors.ErrUnsupported` | Go 1.21 | 1.21 |

The Go 1 compatibility promise covers the package; the function signatures and documented behavior will not change in incompatible ways within Go 1.x.

A library that wants to support both single-error `Unwrap` and multi-error `Unwrap` can implement both methods. The standard library will detect both interfaces; the type switch in `errors.Is`/`errors.As` checks `Unwrap() error` first, then `Unwrap() []error`.

---

## Things the Spec Does NOT Define

- **Cycle behavior**: if `Unwrap` chains form a cycle, `errors.Is` and `errors.As` loop forever. The spec does not promise detection.
- **Order of `Is` vs default equality**: documented as default equality first, then custom `Is`. A reasonable implementation could change this; do not rely on internal ordering for correctness.
- **`As` method's effect on a false return**: callers should treat `*target` as undefined when `As` returns false. The standard library does not modify `*target` when its default rule does not match, but a buggy custom `As` might.
- **Performance characteristics**: not part of the spec. They are de facto stable but not guaranteed.
- **Stack-trace capture**: `errors.Is`/`errors.As` do not capture stack traces. Adding stack traces requires a custom error type or third-party package.
- **Concurrency**: nothing is said about concurrent use. The walk reads `Unwrap`, `Is`, `As` methods; if those are concurrent-safe, the walk is. The standard library types (`*fmt.wrapError`, `*errors.errorString`) are immutable and thus safe.

---

## References

- [Package errors](https://pkg.go.dev/errors)
- [Package fmt — Errorf](https://pkg.go.dev/fmt#Errorf)
- [The Go Programming Language Specification](https://go.dev/ref/spec) (does not define error wrapping; refers to the `errors` package)
- [Go 1.13 release notes — Error wrapping](https://go.dev/doc/go1.13#error_wrapping)
- [Go 1.20 release notes — Multiple wrapped errors](https://go.dev/doc/go1.20#errors)
- [Russ Cox, "Error values proposal"](https://go.googlesource.com/proposal/+/master/design/29934-error-values.md)
- [Russ Cox, "Working with Errors in Go 1.13"](https://go.dev/blog/go1.13-errors)
