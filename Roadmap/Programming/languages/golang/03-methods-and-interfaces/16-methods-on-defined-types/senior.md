# Methods on Defined Types — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Domain Primitives — Type-Safe IDs](#domain-primitives-type-safe-ids)
3. [Strongly-Typed Units](#strongly-typed-units)
4. [Custom Error Types via int](#custom-error-types-via-int)
5. [ADT-Like Enums](#adt-like-enums)
6. [Validation as a Method](#validation-as-a-method)
7. [Constructors for Defined Primitives](#constructors-for-defined-primitives)
8. [Designing Around the Conversion Boundary](#designing-around-the-conversion-boundary)
9. [Defined Types in Public APIs](#defined-types-in-public-apis)
10. [The Adapter Layer Between Function and Interface](#the-adapter-layer-between-function-and-interface)
11. [When Not to Use a Defined Type](#when-not-to-use-a-defined-type)
12. [Architectural Cheat Sheet](#architectural-cheat-sheet)
13. [Summary](#summary)

---

## Introduction

At the senior level the question is no longer "how do I attach a method to an int" — it is "what kind of design decisions does this enable?" The answer in modern Go: **domain primitives**, **strongly-typed identifiers**, and **type-safe units**. None of these need a struct; all of them are defined types over primitives or slices, with carefully chosen methods.

This file walks through the senior-level patterns and the trade-offs.

---

## Domain Primitives — Type-Safe IDs

In any non-trivial system you will have a `User`, an `Order`, a `Product`. Their IDs all happen to be strings or integers — but they are **not interchangeable**. A function `func ChargeOrder(id string)` accepts any string, including a `UserID`. Bugs follow.

The fix is a defined type per ID:

```go
package domain

type UserID    string
type OrderID   string
type ProductID string

func (u UserID) String() string    { return "u_" + string(u) }
func (o OrderID) String() string   { return "o_" + string(o) }
func (p ProductID) String() string { return "p_" + string(p) }
```

Now the API:

```go
func ChargeOrder(id OrderID) error { ... }
```

is impossible to call with a `UserID`:

```go
var u UserID = "abc"
ChargeOrder(u)              // compile error
ChargeOrder(OrderID(u))     // compile error stops you...
                            // ...unless you write the explicit conversion
```

The explicit conversion forces a moment of thought. If you legitimately need it, you do it consciously. If you do not, you get a compile error instead of a billing-the-wrong-account incident.

### Numeric variants

```go
type AccountID int64
type LedgerID  int64
type EntryID   int64
```

Same story — three distinct types, all `int64` underneath.

### When to add methods

Most domain ID types start with **no methods at all**. Add methods only when there is real behavior:

```go
type OrderID string

func (o OrderID) Valid() bool { return strings.HasPrefix(string(o), "o_") }
func (o OrderID) String() string { return string(o) }
```

Resist the temptation to add `Bytes()`, `Hash()`, `JSON()` until you need them. The defined type's purpose is **identity**, not features.

---

## Strongly-Typed Units

Mixing seconds and milliseconds is a famous source of bugs (Mars Climate Orbiter, anyone). Go's standard library uses defined types to prevent this:

```go
// In time:
type Duration int64

const (
    Nanosecond  Duration = 1
    Microsecond          = 1000 * Nanosecond
    Millisecond          = 1000 * Microsecond
    Second               = 1000 * Millisecond
    Minute               = 60 * Second
    Hour                 = 60 * Minute
)
```

Every duration is a `Duration`, never a raw `int64`. The compiler enforces this.

You can do the same for any unit your codebase keeps using:

```go
type Bytes int64
type KB    int64

func (b Bytes) Human() string {
    switch {
    case b < 1024:                return fmt.Sprintf("%dB",   int64(b))
    case b < 1024*1024:           return fmt.Sprintf("%.1fKB", float64(b)/1024)
    case b < 1024*1024*1024:      return fmt.Sprintf("%.1fMB", float64(b)/1024/1024)
    default:                      return fmt.Sprintf("%.1fGB", float64(b)/1024/1024/1024)
    }
}
```

```go
type Celsius    float64
type Fahrenheit float64

func (c Celsius) Fahrenheit() Fahrenheit { return Fahrenheit(float64(c)*9/5 + 32) }
func (f Fahrenheit) Celsius() Celsius    { return Celsius((float64(f) - 32) * 5 / 9) }
```

A function takes the unit it really needs:

```go
func RecordTemperature(t Celsius) { ... }

var f Fahrenheit = 100
// RecordTemperature(f)              // compile error — different unit
RecordTemperature(f.Celsius())       // explicit conversion through the conversion method
```

### Idiomatic durations

```go
type Backoff struct{ initial, max DurationSeconds }
type DurationSeconds int64

func (s DurationSeconds) Duration() time.Duration {
    return time.Duration(s) * time.Second
}
```

The wrapper communicates "this number is a count of seconds, treat it accordingly". The conversion method bridges to `time.Duration` when interacting with the standard library.

---

## Custom Error Types via int

Methods on defined types of `int` give you concise, comparable, type-safe error categories.

```go
package codes

type ErrCode int

const (
    ErrUnknown ErrCode = iota
    ErrNotFound
    ErrConflict
    ErrPermission
    ErrInvalidArgument
    ErrInternal
)

func (e ErrCode) Error() string {
    switch e {
    case ErrNotFound:        return "not found"
    case ErrConflict:        return "conflict"
    case ErrPermission:      return "permission denied"
    case ErrInvalidArgument: return "invalid argument"
    case ErrInternal:        return "internal error"
    }
    return "unknown error"
}

// HTTP status mapping
func (e ErrCode) HTTPStatus() int {
    switch e {
    case ErrNotFound:        return 404
    case ErrConflict:        return 409
    case ErrPermission:      return 403
    case ErrInvalidArgument: return 400
    case ErrInternal:        return 500
    }
    return 500
}
```

Because `ErrCode` satisfies `error`, you can return it directly:

```go
func GetUser(id UserID) (*User, error) {
    if id == "" { return nil, ErrInvalidArgument }
    ...
}
```

And callers compare with `errors.Is`:

```go
if errors.Is(err, codes.ErrNotFound) {
    // ...
}
```

`errors.Is` for sentinel-comparable values is just `==`, which works because both sides are `ErrCode` (an int).

The big win: `ErrCode` carries **exactly one bit of information** — the code. There is no message, no stack trace, no allocations. When you need a richer error you wrap it: `fmt.Errorf("get user %q: %w", id, codes.ErrNotFound)`.

---

## ADT-Like Enums

Go does not have algebraic data types. But a defined int with a `String()` method, a `Valid()` method, and a fixed set of constants is the closest you get.

```go
package order

type Status int

const (
    StatusUnknown Status = iota
    StatusDraft
    StatusSubmitted
    StatusPaid
    StatusShipped
    StatusCancelled
)

func (s Status) String() string {
    switch s {
    case StatusDraft:     return "draft"
    case StatusSubmitted: return "submitted"
    case StatusPaid:      return "paid"
    case StatusShipped:   return "shipped"
    case StatusCancelled: return "cancelled"
    }
    return "unknown"
}

func (s Status) Valid() bool {
    return s >= StatusDraft && s <= StatusCancelled
}

func (s Status) IsTerminal() bool {
    return s == StatusShipped || s == StatusCancelled
}

func (s Status) Next() (Status, bool) {
    switch s {
    case StatusDraft:     return StatusSubmitted, true
    case StatusSubmitted: return StatusPaid,      true
    case StatusPaid:      return StatusShipped,   true
    }
    return s, false
}
```

This approach gives:

- A compact, comparable value (`int`)
- A `Stringer` for logs and debugging
- Behavior collocated with the type (`Valid`, `IsTerminal`, `Next`)
- Exhaustive-looking switch statements (lint tools like `exhaustive` flag missing cases)

You can complement this with `go:generate stringer` from `golang.org/x/tools/cmd/stringer` to autogenerate the `String()` method. Same pattern — methods on a defined int.

---

## Validation as a Method

Domain primitives can carry their own validation:

```go
type Email string

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func (e Email) Validate() error {
    if !emailRe.MatchString(string(e)) {
        return fmt.Errorf("invalid email: %q", string(e))
    }
    return nil
}

func (e Email) Domain() string {
    if i := strings.IndexByte(string(e), '@'); i >= 0 {
        return string(e[i+1:])
    }
    return ""
}
```

Two patterns flow from this:

**Validate-then-trust.** Once validated, treat any `Email` value as a real email:

```go
func RegisterUser(e Email) error {
    if err := e.Validate(); err != nil { return err }
    // from here on, e is trusted
    ...
}
```

**Constructor that returns a validated value.** Even better — make construction enforce the invariant:

```go
type Email string

func NewEmail(s string) (Email, error) {
    e := Email(s)
    if err := e.Validate(); err != nil { return "", err }
    return e, nil
}
```

But the unexported-version pattern is even tighter:

```go
package mail

type Email struct{ s string }   // unexported field — outsiders can't fabricate

func New(s string) (Email, error) { ... }
func (e Email) String() string    { return e.s }
```

Now `Email` is impossible to construct without going through `New`. This is the **Parse, don't validate** rule expressed in Go: instead of accepting a string and remembering to call `Validate`, accept an `Email`, which by construction is valid.

(That last form uses a struct rather than a defined `string`. Use whichever fits the safety bar you need.)

---

## Constructors for Defined Primitives

When the defined type cannot enforce its invariants on its own, pair it with a constructor:

```go
type Percentage float64

var (
    ErrPercentageOutOfRange = errors.New("percentage must be in [0,100]")
)

func NewPercentage(v float64) (Percentage, error) {
    if v < 0 || v > 100 {
        return 0, ErrPercentageOutOfRange
    }
    return Percentage(v), nil
}

func (p Percentage) Of(total float64) float64 { return float64(p) / 100 * total }
```

Without `NewPercentage`, callers can do `Percentage(150)` and break the invariant. The constructor is the gate — but the type is still convertible (`Percentage(150)`) by anyone who wants to bypass it. The compiler does not enforce this.

To **truly** lock construction, hide the underlying form:

```go
type Percentage struct{ v float64 }   // unexported field
func New(v float64) (Percentage, error) { ... }
func (p Percentage) Float64() float64   { return p.v }
```

Now the only way to make a `Percentage` is via `New`. The defined-int / defined-float style is convenient but **not airtight**.

---

## Designing Around the Conversion Boundary

A defined type sits at a conversion boundary: code inside your package may treat `OrderID` as a string for indexing into maps; code at the API surface should use `OrderID` exclusively. Get this layered right and the type carries weight; get it wrong and `string(orderID)` litters your code base.

### Patterns

**Stringer for output, conversion at the bottom of the stack.**

```go
type OrderID string
func (o OrderID) String() string { return string(o) }

// Logging:           log.Println("order:", id)             // uses Stringer
// Map keys:          orders[id] = ...                       // ID is comparable
// SQL parameter:     db.QueryRow(q, string(id))             // explicit conversion at the boundary
// Public JSON tag:   `json:"id"`                            // marshals as string
```

**`Marshal`/`Unmarshal` at I/O edges.**

```go
func (o OrderID) MarshalJSON() ([]byte, error) {
    return json.Marshal(string(o))
}

func (o *OrderID) UnmarshalJSON(data []byte) error {
    var s string
    if err := json.Unmarshal(data, &s); err != nil { return err }
    *o = OrderID(s)
    return nil
}
```

For most simple defined-string IDs, you do **not** need these — `encoding/json` handles `OrderID` (a defined string type) just like a string by default. Add them only when you need custom shape (e.g. always lowercase, or a special prefix).

### Reflection traps

`reflect.TypeOf(OrderID("x"))` returns `OrderID`, not `string`. Code that switches on `reflect.Kind() == reflect.String` will still match — `Kind()` is `String` for any defined-string. Code that compares to `reflect.TypeOf("")` will not match. This rarely surfaces, but when serializing through reflection you may need to handle it.

---

## Defined Types in Public APIs

A defined type in your public API is a contract. Every consumer either sees a clean type or has to import your package and reference it. Two practical implications:

**1. Once you publish a defined type, changing its underlying type is breaking.** Going from `type OrderID string` to `type OrderID int64` is a major-version event.

**2. Methods you publish are even harder to remove.** A consumer's code may rely on `o.Validate()` or `o.String()`. Remove or rename, and you break them.

Recommendations:

- Start with **few methods** (`String`, `Validate`, the indispensable ones).
- Add methods later when they prove useful.
- Avoid leaking the underlying type into the public API except through one explicit conversion path (e.g. `func (o OrderID) String() string`).
- Document whether values are validated by construction or trusted on input.

### Example: a money library

```go
package money

type Money struct {       // Note: struct, not defined int — see "When Not to Use" below
    units    int64
    currency Currency
}

type Currency string      // defined string — light, comparable

func (c Currency) Valid() bool   { return knownCurrencies[c] }
func (c Currency) Code() string  { return string(c) }

func (m Money) Add(other Money) (Money, error) { ... }
func (m Money) Sub(other Money) (Money, error) { ... }
```

`Currency` is a defined string. `Money` is a struct, because we need both `units` and `currency` together. The two designs coexist comfortably.

---

## The Adapter Layer Between Function and Interface

The function-type-with-method pattern (covered in `middle.md` as `HandlerFunc`) becomes a senior-level architectural tool when you compose adapters:

```go
package middleware

import "net/http"

type Middleware func(http.Handler) http.Handler

func (m Middleware) Then(next http.Handler) http.Handler { return m(next) }

func Chain(ms ...Middleware) Middleware {
    return func(final http.Handler) http.Handler {
        for i := len(ms) - 1; i >= 0; i-- {
            final = ms[i](final)
        }
        return final
    }
}

func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Println(r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
    })
}

func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // attach request id...
        next.ServeHTTP(w, r)
    })
}
```

Usage:

```go
stack := middleware.Chain(
    middleware.Logging,
    middleware.RequestID,
)

http.Handle("/", stack.Then(myHandler))
```

`Middleware` is a function type. Its `Then` method makes the middleware chain composable like an interface, but underneath it remains a plain function value. No structs needed.

---

## When Not to Use a Defined Type

Defined types are not free for the reader. Use them when:

- The semantic distinction is meaningful (`UserID` vs `OrderID`, `Celsius` vs `Fahrenheit`).
- The type is going to flow through public APIs.
- You want to attach methods to a non-struct type.

Avoid them when:

- A short-lived local variable is enough — `var c int` is fine inside a function.
- The wrapper has no methods, no semantic meaning, and is just a typedef for typedef's sake.
- Two values that should be interchangeable are forced apart by separate types.

A particularly common antipattern is the **typedef noise** — every primitive in the package gets a defined type, and call sites are full of `int(x)` and `MyInt(y)` conversions. The compile-time safety did not add value; the noise did.

```go
// Anti-pattern: defined types for everything
type Width  int
type Height int

func area(w Width, h Height) int { return int(w) * int(h) }

w := Width(5)
h := Height(7)
a := area(w, h)
```

If `Width` and `Height` are not actually mixable in your codebase (and the only use is `area(w, h)`), you have not gained much. Reserve defined types for **real semantic categories**.

---

## Architectural Cheat Sheet

```
DOMAIN PRIMITIVES
─────────────────────────────────────────
type UserID    string
type OrderID   string
type ProductID string

* one type per ID kind
* methods sparse — String, maybe Validate
* compile-time prevents mixing IDs

UNITS
─────────────────────────────────────────
type Celsius     float64
type Fahrenheit  float64
type Bytes       int64
type Duration    int64   // (already in time)

* conversion methods bridge to other units
* arithmetic stays inside the type

ERROR CODES
─────────────────────────────────────────
type ErrCode int
* implement Error() string
* zero allocation, sentinel-comparable
* HTTPStatus()/GRPCCode() helpers natural

ADT-LIKE ENUMS
─────────────────────────────────────────
type Status int
* String(), Valid(), IsTerminal()
* go:generate stringer
* exhaustive linter

VALIDATION
─────────────────────────────────────────
type Email string
* Validate() error
* better — unexported field + New()
* "parse, don't validate"

API SAFETY
─────────────────────────────────────────
* defined type in public API = contract
* underlying-type change = breaking
* keep methods minimal at first

WHEN NOT TO USE
─────────────────────────────────────────
* typedef-for-typedef sake
* values that are actually interchangeable
* throwaway local variables
```

---

## Summary

Methods on defined types are not a low-level Go quirk — they are the foundation of Go's idiom of **type-safe primitives**. At the senior level the pattern repertoire is:

1. **Domain IDs** — `UserID`, `OrderID`, `ProductID` — each a defined string.
2. **Units** — `Celsius`, `Bytes`, `Duration` — each a defined numeric, with conversion methods between related units.
3. **Error codes** — a defined int that satisfies `error`.
4. **ADT-like enums** — a defined int + a fixed constant set + `String()`/`Valid()`/state-transition methods.
5. **Adapter function types** — `HandlerFunc`, `Middleware`, `ValidatorFunc` — bridging functions and interfaces.

The compiler does the heavy lifting once you have committed to the type. Your job is restraint: pick the categories that matter, give them the minimum methods they need, and resist defining a type for every variable in sight.

The professional file extends this into DDD value objects, multi-package strategies, and migration playbooks.
