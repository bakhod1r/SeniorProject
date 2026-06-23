# Methods on Defined Types — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Defined Types as Domain Primitives (DDD Value Objects)](#defined-types-as-domain-primitives-ddd-value-objects)
3. [Strong Typing Across Module Boundaries](#strong-typing-across-module-boundaries)
4. [The Adapter Pattern via Function Types](#the-adapter-pattern-via-function-types)
5. [Slice and Map Defined Types in Production](#slice-and-map-defined-types-in-production)
6. [Custom Error Code Hierarchies](#custom-error-code-hierarchies)
7. [Generic Defined Types in a Large Codebase](#generic-defined-types-in-a-large-codebase)
8. [Migration Strategies — Plain → Defined → Methods](#migration-strategies-plain-defined-methods)
9. [Defined Types vs Type Aliases — When To Choose Which](#defined-types-vs-type-aliases-when-to-choose-which)
10. [Anti-Patterns Catalog](#anti-patterns-catalog)
11. [Performance and Layout Considerations](#performance-and-layout-considerations)
12. [Tooling, Linters, and Code Review Heuristics](#tooling-linters-and-code-review-heuristics)
13. [Summary](#summary)

---

## Introduction

A **defined type** is a named type created by a `type Name Underlying` declaration. The Go specification gives every defined type its own identity, distinct from its underlying type, and — crucially — its own **method set**. This makes the defined-type construct one of the most powerful tools in production Go: a way to attach behavior to primitives, slices, maps, and even function values.

At the professional level, the question is no longer "how do I write a method on `type Counter int`?" but rather:

- *Where in the architecture should defined types appear?*
- *Which boundaries require strong typing, and which do not?*
- *How do I migrate a million-line codebase from `string` IDs to `UserID` without breaking every caller?*
- *When is `type X = Y` the right call, and when must I write `type X Y`?*

This document walks through each of those questions using non-struct receivers exclusively — primitives, slices, maps, and function types. Struct receivers are covered elsewhere; here, we focus on the often-overlooked but production-critical category of methods on **non-struct defined types**.

---

## Defined Types as Domain Primitives (DDD Value Objects)

### Problem: primitive obsession

A typical service starts like this:

```go
func ChargeUser(userID string, amount int64, currency string) error
```

Three primitives, three opportunities for bugs. Nothing prevents a caller from swapping `userID` and `currency`, or passing `amount` in dollars when the function expects cents.

### Solution: defined types as value objects

```go
type UserID    string
type OrderID   int64
type Cents     int64
type Currency  string

func (u UserID) String() string { return string(u) }
func (u UserID) Validate() error {
    if len(u) < 8 || len(u) > 64 {
        return fmt.Errorf("user_id: invalid length %d", len(u))
    }
    return nil
}

func (c Cents) Dollars() float64 { return float64(c) / 100 }
func (c Cents) Add(o Cents) Cents { return c + o }

func ChargeUser(userID UserID, amount Cents, currency Currency) error
```

Now the compiler enforces:
- `ChargeUser("usd", 1500, userID)` — **compile error**, types misaligned
- `var raw string = "u_42"; ChargeUser(raw, ...)` — **compile error**, `string` is not `UserID`

The conversion is explicit: `ChargeUser(UserID(raw), ...)`. That single act of conversion is where validation belongs.

### Methods on the value object

Because `UserID` is a defined type with the underlying type `string`, you can attach *behavior*:

```go
func (u UserID) IsAnonymous() bool { return strings.HasPrefix(string(u), "anon_") }
func (u UserID) Tenant() TenantID  { return TenantID(strings.SplitN(string(u), ":", 2)[0]) }
```

The underlying string operations require an explicit conversion (`string(u)`), and that conversion is intentional — it forces the implementer to confirm the abstraction boundary.

### Money pattern

The single most-cited example of a defined-type value object is `Money`. It is also the most-cited example of getting it wrong:

```go
// Anti-pattern — Money as raw float
type Money float64
func (m Money) Add(o Money) Money { return m + o }  // BAD — float rounding
```

In production, money is always an integer-cents (or fixed-point) value:

```go
type Money int64  // amount in micro-units, e.g. 1 USD = 1_000_000

func (m Money) Add(o Money) Money       { return m + o }
func (m Money) Sub(o Money) Money       { return m - o }
func (m Money) Mul(qty int64) Money     { return m * Money(qty) }
func (m Money) Format() string          { return fmt.Sprintf("%.2f", float64(m)/1_000_000) }
```

The point is: **the underlying type is an implementation detail, the methods are the contract**.

---

## Strong Typing Across Module Boundaries

### API gateway pattern

Microservice A returns a payload to gateway G. The payload contains an ID. If both sides are typed:

```go
// service-A
type EventID string
func (id EventID) Validate() error { ... }

// gateway
type EventID = service_a.EventID  // type alias: stays compatible
```

versus:

```go
// service-A
type EventID string

// gateway — independent definition
type EventID string  // different type — incompatible
```

In the second form, the gateway and service A's IDs are not interchangeable, even though they share the same underlying string. This is sometimes intentional (you want a translation layer) and sometimes a footgun (you forgot to import the type).

### gRPC and protobuf integration

When using `protoc-gen-go`, generated code uses `string` for IDs. Wrapping at the boundary makes the API safer:

```go
// generated.pb.go
type GetUserRequest struct {
    UserId string `protobuf:"..."`
}

// internal/api/handler.go
func (s *Server) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
    id := UserID(req.UserId)
    if err := id.Validate(); err != nil {
        return nil, status.Error(codes.InvalidArgument, err.Error())
    }
    return s.svc.GetUser(ctx, id)
}
```

The wrapping happens **once**, at the edge. Internally everything uses `UserID`.

### Database boundary

`database/sql` accepts any value implementing `driver.Valuer`. With defined types, you can give scan/value behavior to your IDs:

```go
type UserID string

func (u UserID) Value() (driver.Value, error) { return string(u), nil }
func (u *UserID) Scan(src any) error {
    switch v := src.(type) {
    case string: *u = UserID(v); return nil
    case []byte: *u = UserID(v); return nil
    case nil:    *u = ""; return nil
    }
    return fmt.Errorf("user_id: cannot scan %T", src)
}
```

Now `db.QueryRowContext(...).Scan(&id)` works directly with `UserID`. No type juggling at every call site.

---

## The Adapter Pattern via Function Types

### `http.HandlerFunc` — the canonical example

The standard library's `net/http` package defines:

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}

type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

This is one of the most elegant patterns in all of Go. It says: "any function with the right signature can be promoted to a `Handler` by converting it to `HandlerFunc`." The conversion costs nothing at runtime — it is a type assertion that simply changes the static type — but it grants the function value a method, and therefore it satisfies the `Handler` interface.

### Building your own adapter

Suppose you have a `Middleware` interface:

```go
type Middleware interface {
    Wrap(next http.Handler) http.Handler
}
```

A function with the right signature can be promoted:

```go
type MiddlewareFunc func(next http.Handler) http.Handler

func (m MiddlewareFunc) Wrap(next http.Handler) http.Handler { return m(next) }

// Usage
var Logging MiddlewareFunc = func(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Println(r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
    })
}

// Logging is now a Middleware
var _ Middleware = Logging
```

### Why this pattern matters in production

Without this pattern, every "middleware" in your code must be a struct with one method. That is six lines of boilerplate per middleware, and code review fatigue. With the function-type adapter, the boilerplate is two lines per **type**, not per *value*.

### Real-world example: validators

```go
type Validator func(v any) error

func (vf Validator) Then(next Validator) Validator {
    return Validator(func(v any) error {
        if err := vf(v); err != nil { return err }
        return next(v)
    })
}

func (vf Validator) Optional() Validator {
    return Validator(func(v any) error {
        if v == nil { return nil }
        return vf(v)
    })
}

var nonEmpty Validator = func(v any) error {
    if s, _ := v.(string); s == "" { return errors.New("empty") }
    return nil
}

emailValidator := nonEmpty.Then(checkEmailFormat)
```

The `Validator` function type now has methods. You can chain validators with the same fluency as struct-based builders, but with zero boxing.

---

## Slice and Map Defined Types in Production

### `sort.IntSlice`, `sort.StringSlice`, `sort.Float64Slice`

The standard library's `sort` package is built entirely around defined slice types:

```go
package sort

type IntSlice []int

func (p IntSlice) Len() int           { return len(p) }
func (p IntSlice) Less(i, j int) bool { return p[i] < p[j] }
func (p IntSlice) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p IntSlice) Sort()              { Sort(p) }
```

This pattern still appears in modern Go — it's the most efficient way to sort a slice without allocating a new comparator on every iteration.

### Building a custom slice type

Suppose your service handles a stream of events:

```go
type Event struct {
    ID        EventID
    Timestamp time.Time
    Type      string
}

type Events []Event

func (es Events) Len() int                { return len(es) }
func (es Events) Filter(fn func(Event) bool) Events {
    out := make(Events, 0, len(es))
    for _, e := range es {
        if fn(e) { out = append(out, e) }
    }
    return out
}
func (es Events) ByType(t string) Events  { return es.Filter(func(e Event) bool { return e.Type == t }) }
func (es Events) Latest() (Event, bool) {
    if len(es) == 0 { return Event{}, false }
    return es[len(es)-1], true
}
```

`Events` becomes a self-documenting collection: callers don't need helper functions, they call methods.

### Set type via map

A common need in Go is a set type. The idiomatic implementation is a defined type over `map[T]struct{}`:

```go
type StringSet map[string]struct{}

func (s StringSet) Add(v string)    { s[v] = struct{}{} }
func (s StringSet) Has(v string) bool { _, ok := s[v]; return ok }
func (s StringSet) Remove(v string) { delete(s, v) }
func (s StringSet) Len() int        { return len(s) }

func (s StringSet) Union(o StringSet) StringSet {
    out := make(StringSet, len(s)+len(o))
    for k := range s { out[k] = struct{}{} }
    for k := range o { out[k] = struct{}{} }
    return out
}
```

Note: `Add` and `Remove` mutate the underlying map. Because maps are reference types, value receivers work fine — there is no need for `*StringSet`. The exception is when `Add` could need to reassign the map (e.g., grow from nil), in which case the receiver must be `*StringSet`.

---

## Custom Error Code Hierarchies

### `type ErrCode int` + `Error() string`

A defined integer type can implement the `error` interface:

```go
type ErrCode int

const (
    ErrUnknown ErrCode = iota
    ErrNotFound
    ErrPermissionDenied
    ErrInvalidArgument
    ErrConflict
    ErrInternal
)

func (e ErrCode) Error() string {
    switch e {
    case ErrNotFound:         return "not found"
    case ErrPermissionDenied: return "permission denied"
    case ErrInvalidArgument:  return "invalid argument"
    case ErrConflict:         return "conflict"
    case ErrInternal:         return "internal error"
    }
    return "unknown error"
}

func (e ErrCode) HTTPStatus() int {
    switch e {
    case ErrNotFound:         return 404
    case ErrPermissionDenied: return 403
    case ErrInvalidArgument:  return 400
    case ErrConflict:         return 409
    }
    return 500
}
```

Now `ErrCode` values are `error` *and* sentinel constants — comparable with `errors.Is`:

```go
if errors.Is(err, ErrNotFound) { ... }
```

This is the foundation of structured error handling at scale: a small, finite set of error codes, each implementing `Error()`, each carrying additional behavior (HTTP status, severity, retryability).

### Wrapping with structured details

```go
type ErrDetails struct {
    Code    ErrCode
    Message string
    Cause   error
}

func (e *ErrDetails) Error() string {
    if e.Cause != nil { return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Cause) }
    return fmt.Sprintf("%s: %s", e.Code, e.Message)
}
func (e *ErrDetails) Unwrap() error      { return e.Cause }
func (e *ErrDetails) Is(target error) bool {
    code, ok := target.(ErrCode)
    return ok && code == e.Code
}
```

`errors.Is(err, ErrNotFound)` walks the chain, sees `ErrDetails.Is` matches the underlying `ErrCode`, and returns `true`.

### Lessons from the standard library

`syscall.Errno` is itself a defined integer type:

```go
type Errno uintptr
func (e Errno) Error() string { ... }
func (e Errno) Is(target error) bool { ... }
func (e Errno) Temporary() bool { ... }
func (e Errno) Timeout() bool { ... }
```

This pattern has been in Go since version 1.0 and is unchanged. It's a strong signal that defined integer types are the production-grade approach to error codes.

---

## Generic Defined Types in a Large Codebase

### `type Set[T comparable] map[T]struct{}`

Generics (Go 1.18+) make defined non-struct types far more powerful:

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T)         { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool    { _, ok := s[v]; return ok }
func (s Set[T]) Remove(v T)      { delete(s, v) }
func (s Set[T]) Len() int        { return len(s) }

func (s Set[T]) Union(o Set[T]) Set[T] {
    out := make(Set[T], len(s)+len(o))
    for k := range s { out[k] = struct{}{} }
    for k := range o { out[k] = struct{}{} }
    return out
}

func NewSet[T comparable](xs ...T) Set[T] {
    s := make(Set[T], len(xs))
    for _, x := range xs { s[x] = struct{}{} }
    return s
}
```

Usage:

```go
ids := NewSet[UserID]("u1", "u2")
roles := NewSet("admin", "viewer")  // T inferred as string
```

### Generic slice type

```go
type Stack[T any] []T

func (s *Stack[T]) Push(v T) { *s = append(*s, v) }
func (s *Stack[T]) Pop() (T, bool) {
    if len(*s) == 0 { var zero T; return zero, false }
    last := (*s)[len(*s)-1]
    *s = (*s)[:len(*s)-1]
    return last, true
}
func (s Stack[T]) Peek() (T, bool) {
    if len(s) == 0 { var zero T; return zero, false }
    return s[len(s)-1], true
}
```

Note the asymmetry: `Push` and `Pop` use a pointer receiver (because they reassign `s`), while `Peek` uses a value receiver.

### Restrictions on generic methods

A method on a generic type **cannot introduce its own type parameters**:

```go
type Stack[T any] []T

// ILLEGAL — methods cannot have their own type parameters
// func (s Stack[T]) Map[U any](f func(T) U) Stack[U]
```

The work-around is a top-level function:

```go
func Map[T, U any](s Stack[T], f func(T) U) Stack[U] {
    out := make(Stack[U], 0, len(s))
    for _, v := range s { out = append(out, f(v)) }
    return out
}
```

This restriction is intentional — it keeps method dispatch simple in the runtime.

---

## Migration Strategies — Plain → Defined → Methods

### Phase 1: introduce the type as an alias

```go
// before
type UserID = string

// callers
func ChargeUser(id UserID, ...) { ... }
```

A type alias is a non-breaking change: `UserID` is **literally** `string`, so no caller code changes.

### Phase 2: graduate the alias to a defined type

```go
type UserID string  // dropped the `=`
```

This **is** a breaking change at the type level. Every implicit conversion between `string` and `UserID` becomes a compile error. The migration:

1. Add explicit conversions at *every* boundary.
2. Run `go build ./...` to find remaining call sites.
3. Repeat until clean.

In practice, this can be a multi-week effort in a large codebase. Tools like `gofmt -r` or `gopls rename` help, but human review is irreplaceable.

### Phase 3: add validation and behavior

```go
func (u UserID) Validate() error { ... }
func (u UserID) IsAnonymous() bool { ... }
```

Now the type carries domain meaning. New code uses methods; old code that hasn't been migrated still compiles because the *operations* on `UserID` (concatenation, comparison) still work.

### Phase 4: lock down conversion sites

Final step — restrict where `string → UserID` conversions occur:

```go
// internal/userid/userid.go
package userid

type ID string

// Parse is the only allowed entry point.
func Parse(s string) (ID, error) {
    if len(s) < 8 { return "", errors.New("too short") }
    return ID(s), nil
}

// MustParse panics — for tests only.
func MustParse(s string) ID {
    id, err := Parse(s)
    if err != nil { panic(err) }
    return id
}
```

Now `userid.ID` can only be created via `Parse` or `MustParse`. Even though Go can't enforce this at the language level, code review and linters can.

---

## Defined Types vs Type Aliases — When To Choose Which

### The fundamental rule

| Aspect | `type X = Y` (alias) | `type X Y` (defined) |
|--------|---------------------|----------------------|
| Identity | Same as `Y` | Distinct from `Y` |
| Method set | Same as `Y` | Empty (you add methods) |
| Conversion | Implicit | Explicit |
| Use case | Refactoring, gradual migration | Strong typing, behavior |
| Can add methods | NO (would conflict with `Y`'s set) | YES |

### Concrete scenario

```go
// alias — same type, just a different name
type Bytes = []byte

// defined type — separate identity, can have methods
type ByteString []byte
func (b ByteString) Hex() string { return hex.EncodeToString(b) }
```

A function expecting `[]byte` accepts `Bytes` directly. It does *not* accept `ByteString` without an explicit conversion.

### Why the spec forbids methods on aliases

You cannot write:

```go
type Bytes = []byte

// ILLEGAL — Bytes is just []byte; []byte cannot have methods
func (b Bytes) Hex() string { ... }
```

The Go specification allows methods only on **defined types defined in the same package**. Since `Bytes` is `[]byte` (a type literal from no package), no method can be attached.

### Aliases for transitions only

Type aliases were added to Go 1.9 specifically to support large refactorings (the `os.FileInfo` → `fs.FileInfo` migration is the canonical example). They are a transitional mechanism, not a primary design tool. In greenfield code, prefer `type X Y`.

---

## Anti-Patterns Catalog

### Anti-pattern 1: defined type that adds nothing

```go
// BAD
type EmailString string  // no methods, no validation
```

If you add no methods and the type carries no semantic distinction, it's noise. Write it only when the strong typing or the behavior pays for itself.

### Anti-pattern 2: defined type over a struct just for one method

```go
// BAD — you should put the method on the struct directly
type WrappedUser User
func (w WrappedUser) FullName() string { return w.First + " " + w.Last }
```

Add the method to `User` instead, unless you genuinely need an independent method set (e.g., a different `Marshal` shape).

### Anti-pattern 3: methods on a function type that capture state

```go
// BAD
type Handler func()

var counter int
func (h Handler) WithCount() Handler {
    return func() { counter++; h() }  // captures global state
}
```

The closure captures package-level state. Use a struct receiver for stateful adapters, not a function type.

### Anti-pattern 4: pointer receiver on a slice/map type when not needed

```go
// Usually wrong
type IntSlice []int
func (p *IntSlice) Sum() int { ... }  // value receiver suffices for read-only
```

Use a pointer receiver only when the method must reassign the slice (e.g., `Append`, `Reset`).

### Anti-pattern 5: using `type X = Y` to "save typing"

```go
// BAD — pointless alias
type StringMap = map[string]string
```

If you cannot add methods and never bind it to a domain concept, just write `map[string]string` directly. Aliases are for migration, not for shortening.

### Anti-pattern 6: defined type that hides the underlying

```go
type Config map[string]any
func (c Config) Get(k string) any { return c[k] }
```

The `any` return type defeats the purpose of strong typing. Either return a typed result (`GetString`, `GetInt`) or skip the wrapping entirely.

### Anti-pattern 7: nominal abuse

```go
type Celsius float64
type Fahrenheit float64

// ANTI — adding "+" between Celsius and Fahrenheit is allowed (after conversion)
// but the conversion makes the bug invisible
func MixTemps(c Celsius, f Fahrenheit) Celsius { return c + Celsius(f) }
```

The compiler permits the explicit conversion, but the code is wrong. Strong typing helps but doesn't substitute for domain reasoning.

---

## Performance and Layout Considerations

### Memory layout is identical

`type Counter int` has the same in-memory representation as `int`. There is no boxing, no extra header, no virtual table. The defined-type wrapper is purely a compile-time construct.

```go
type Counter int
fmt.Println(unsafe.Sizeof(Counter(0))) // 8 (on 64-bit) — same as int
```

### Method calls are direct, not virtual

When you call `c.Inc()` on a `*Counter`, the compiler emits a direct call to the method. There is no `itab` lookup unless `*Counter` is held behind an interface.

### Conversions are free

`int(c)` and `Counter(i)` are no-ops at runtime — no allocation, no copy, no instruction beyond the load.

### Inlining

Small methods on defined types are inlined aggressively:

```go
type Cents int64
func (c Cents) Add(o Cents) Cents { return c + o }

// Compiler typically inlines `total.Add(itemPrice)` to `total + itemPrice`.
```

Verify with `go build -gcflags='-m'`.

### Comparable rules

A defined type is comparable if and only if its underlying type is comparable. `type IntSlice []int` is **not** comparable (slices are not comparable in Go), so `IntSlice == IntSlice` is a compile error. `type UserID string` is comparable.

This matters for `Set[T comparable]` — you cannot make `Set[IntSlice]`.

---

## Tooling, Linters, and Code Review Heuristics

### `golangci-lint` rules

- `unused` — flags methods on defined types that are never called.
- `revive var-naming` — receiver naming consistency.
- `staticcheck SA1024` — `strings.Replacer` with odd args (unrelated, but illustrates how staticcheck inspects defined types).
- `gocritic typeAssertChain` — encourages defined type assertion patterns.

### `go vet` checks

- `printfuncs` — detects unsafe `fmt.Errorf` calls on defined error types.
- `lostcancel` — identifies leaked context cancellations regardless of receiver type.

### Code review heuristics

When reviewing a pull request that introduces a defined type:

1. **Is the underlying type printed?** Look for `string(id)` and `int(c)` conversions — too many is a smell.
2. **Are there any `Stringer` and `Validate` methods?** A new ID type without these is incomplete.
3. **Is the type used at API boundaries (HTTP, gRPC, DB) with proper marshalling?** If yes, it needs `MarshalJSON`, `UnmarshalJSON`, `Value`, `Scan`.
4. **Is it tested for equality?** Sentinel error codes need `errors.Is` tests.
5. **Is the migration plan documented?** If this type replaces an existing primitive, the PR description should include the rollout plan.

### `gopls rename` workflow

When converting `string` to `UserID` across a large codebase:

```bash
# 1. Introduce the alias
echo 'type UserID = string' > types.go

# 2. Use gopls rename to update call sites
gopls rename -w 'package_path:PrimitiveStringField' UserIDField

# 3. Drop the alias to a defined type
# Edit types.go: type UserID string

# 4. Compile, fix conversions, repeat
go build ./...
```

### Custom analyzer example

You can write a custom `golang.org/x/tools/go/analysis` analyzer that ensures every defined string type has a `Validate()` method:

```go
var Analyzer = &analysis.Analyzer{
    Name: "validatedid",
    Doc:  "every defined string type must have Validate()",
    Run:  run,
}
// run inspects the package, finds defined types with underlying string,
// and reports missing Validate methods.
```

This is the kind of policy that pays off in a 500k-LOC codebase.

---

## Cheat Sheet

```
DEFINED TYPE DECISION TREE
────────────────────────────
Need behavior on a primitive?       → type X primitive + methods
Need a value object (Money, ID)?    → type X primitive + methods + Validate
Need a domain collection?           → type Xs []Item + methods
Need an adapter for a func sig?     → type F func(...) + (f F) M(...)
Just renaming for migration?        → type X = Y (alias)

NON-STRUCT RECEIVER PATTERNS
────────────────────────────
type Counter int                    → counter, error code, status
type IDs []UserID                   → collection with filter/sort
type Set[T comparable] map[T]X      → set membership
type Handler func(...)              → adapter pattern (HandlerFunc)
type ErrCode int                    → sentinel error code

RESTRICTIONS (can't add methods)
────────────────────────────
- on type aliases (type X = Y)
- on types from other packages
- on unnamed types ([]int directly)
- on pointer types (*T base)
- on interface types

RECEIVER STYLE
────────────────────────────
read-only on slice          → value receiver
mutating slice (Append)     → pointer receiver
read or mutate on map       → value receiver (maps are ref types)
read on primitive           → value receiver
mutating primitive          → pointer receiver

API STABILITY
────────────────────────────
Add a method                → non-breaking
Add a field (struct only)   → non-breaking
Change underlying type      → BREAKING
Alias → defined type        → BREAKING
Defined → alias             → BREAKING

STD LIB CITATIONS
────────────────────────────
sort.IntSlice, sort.StringSlice, sort.Float64Slice
http.HandlerFunc.ServeHTTP
time.Duration with .Seconds(), .Hours()
syscall.Errno with .Error()
io/fs.FileMode with .IsDir()
```

---

## Summary

Methods on non-struct defined types are one of Go's most expressive features and one of its most under-used. The professional checklist:

1. **Defined type, not alias** — when behavior is needed, use `type X Y`, not `type X = Y`.
2. **Domain primitives** — wrap raw `string`/`int64` IDs as `UserID`/`OrderID` early.
3. **Validation at the boundary** — `Parse(...)` and `Validate()` belong with the type.
4. **Function-type adapters** — `HandlerFunc`-style patterns are the idiomatic way to convert a function value into an interface implementer.
5. **Slice and map collections** — `Events`, `StringSet`, `Stack[T]` collect behavior with the data.
6. **Error codes** — `type ErrCode int` + `Error()` is the foundation of structured error handling.
7. **Generics** — `Set[T comparable]` and `Stack[T any]` are both expressive and efficient, but cannot have method-level type parameters.
8. **Migrations** — alias → defined type is a breaking change; plan it carefully.
9. **Performance** — defined types have zero runtime cost; conversions are free.
10. **Tooling** — `golangci-lint`, `go vet`, `gopls rename` are essential when working at scale.

The defined-type pattern is what gives Go its quiet expressive power: simple rules, but composed deeply, they yield safe APIs, fast code, and maintainable architectures.
