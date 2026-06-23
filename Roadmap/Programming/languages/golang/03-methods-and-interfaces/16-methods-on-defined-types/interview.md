# Methods on Defined Types — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: What is a defined type in Go?

**Answer:** A defined type is a new, named type created with `type X Y` (without the `=` sign). It has the same underlying representation as `Y` but is a distinct type with its own identity and its own method set.

```go
type Counter int      // defined type
type Number = int     // alias (NOT a defined type)
```

### Q2: Can I add a method to the built-in `int` type?

**Answer:** No. Methods can only be declared on **defined types in the same package**. `int` is a predeclared type. The work-around is to create a defined type:

```go
type Counter int
func (c Counter) Inc() Counter { return c + 1 }
```

### Q3: Can I add a method to `time.Duration`?

**Answer:** No. `time.Duration` is defined in the `time` package, and methods must be declared in the same package as the receiver's base type. To add behavior, wrap it:

```go
type Dur time.Duration
func (d Dur) IsLong() bool { return time.Duration(d) > time.Hour }
```

### Q4: How do you write a method on a primitive type?

**Answer:** Define a new type and declare a method on it.

```go
type Counter int

func (c Counter) Inc() Counter { return c + 1 }
func (c Counter) IsZero() bool  { return c == 0 }
```

### Q5: What's a real-world example of a method on a defined integer type?

**Answer:** `time.Duration` is the classic example. It's `type Duration int64` with methods like `.Hours()`, `.Minutes()`, `.Seconds()`, and `.String()`. `syscall.Errno` is another — it's `type Errno uintptr` with `.Error()`, `.Temporary()`, and `.Timeout()`.

### Q6: Can I write `func (s []int) Sum() int`?

**Answer:** No. The receiver must be a *named* defined type, not a type literal. You need:

```go
type IntSlice []int
func (s IntSlice) Sum() int { ... }
```

### Q7: Why does the standard library have `sort.IntSlice`?

**Answer:** `sort.IntSlice` is `type IntSlice []int` with methods `Len`, `Less`, `Swap`, and `Sort`. It allows you to sort a `[]int` by converting to `IntSlice` and calling `Sort()`. It's a textbook example of methods on a defined slice type.

### Q8: Can I define a method on a function type?

**Answer:** Yes. Function types are not pointer or interface types, so they can be defined types with methods.

```go
type Greeter func(string) string

func (g Greeter) Wrap() Greeter {
    return func(s string) string { return "[" + g(s) + "]" }
}
```

### Q9: What is `http.HandlerFunc`?

**Answer:** It's a defined function type in `net/http`:

```go
type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

It allows any function with the right signature to satisfy the `http.Handler` interface — just by being converted to `HandlerFunc`.

### Q10: What's the difference between `type X = Y` and `type X Y`?

**Answer:**
- `type X = Y` is a **type alias** — `X` is literally the same as `Y`. You cannot add methods.
- `type X Y` is a **defined type** — `X` is distinct from `Y`. You can add methods.

```go
type Number = int       // alias
type Counter int        // defined type
```

---

## Middle-Level Questions

### Q11: Why can't methods be added to a type alias?

**Answer:** A type alias is just another name for an existing type. If `type Number = int`, then writing a method on `Number` would be writing a method on `int` — which is forbidden because `int` is not in your package. The compile error is: *"cannot define new methods on non-local type int"*.

### Q12: When would you use `type UserID string` instead of just `string`?

**Answer:**
- **Type safety** — the compiler catches accidental swaps between `UserID` and `OrderID`.
- **Behavior** — you can add `Validate()`, `String()`, `Marshal/Unmarshal` methods.
- **Self-documentation** — function signatures become clearer: `Charge(id UserID, amt Cents)` vs `Charge(id string, amt int64)`.
- **Refactoring** — changing the underlying type (e.g., `string` to `[16]byte` for UUIDs) is contained.

### Q13: What's the method set of `IntSlice` if you write methods only with value receivers?

**Answer:**

```go
type IntSlice []int
func (s IntSlice)  Sum() int       { ... }
func (s *IntSlice) Append(v int)   { *s = append(*s, v) }
```

| Type | Method set |
|------|-----------|
| `IntSlice` | `{Sum}` |
| `*IntSlice` | `{Sum, Append}` |

### Q14: Why are pointer receivers needed for `Append` on a slice type but not on a map type?

**Answer:** A slice's *length* changes on append, but the slice header (pointer + len + cap) is passed by value. To make the change visible to the caller, you need a pointer receiver — so `*s = append(*s, v)` updates the original.

A map's underlying structure is a pointer to a hash table; the map "header" doesn't change when entries are added. So `s[v] = ...` on a value-receiver `s StringSet` mutates the same hash table the caller holds.

### Q15: What's a Set type in Go and how do you implement it?

**Answer:** Go has no built-in set, so you build one with a defined map type:

```go
type StringSet map[string]struct{}

func (s StringSet) Add(v string)    { s[v] = struct{}{} }
func (s StringSet) Has(v string) bool { _, ok := s[v]; return ok }
func (s StringSet) Remove(v string) { delete(s, v) }
```

`struct{}` takes zero bytes — strictly more efficient than `bool`.

### Q16: How do you make `Set[T]` generic?

**Answer:**

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T)        { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool   { _, ok := s[v]; return ok }
```

The constraint `comparable` is required — map keys must be comparable.

### Q17: Why does `HandlerFunc` have a method named `ServeHTTP` that just calls itself?

**Answer:** Because `http.Handler` is an interface requiring a `ServeHTTP` method. By having `HandlerFunc.ServeHTTP` invoke the function value `f`, the type satisfies the interface. This adapter pattern lets any function-with-the-right-signature be used as a `Handler` without writing a struct wrapper.

```go
http.Handle("/x", http.HandlerFunc(myFunc))   // myFunc satisfies Handler via HandlerFunc
```

### Q18: How does `errors.Is(err, ErrNotFound)` work when `ErrNotFound` is a `type ErrCode int`?

**Answer:** `ErrCode` implements `error` via its `Error() string` method. `errors.Is` walks the error chain comparing each error with `==`. Since `ErrNotFound` is a constant value of `ErrCode`, the comparison succeeds when the chain contains the same `ErrCode` value.

```go
type ErrCode int
const ErrNotFound ErrCode = 1
func (e ErrCode) Error() string { return "..." }

err := ErrNotFound
errors.Is(err, ErrNotFound)   // true
```

### Q19: What's the underlying type of `type B A` where `type A int`?

**Answer:** `int`. The spec says the underlying type is determined recursively: start at `B`, follow to `A`, follow to `int`. So `B`'s underlying type is `int`, not `A`.

This means `B` does **not** inherit `A`'s methods. They are separate types.

### Q20: Can you make methods on `*int`?

**Answer:** No. The receiver base type cannot be a pointer. `*int` is `*(int)`, where `int` is a built-in. The fix is the usual one — wrap in a defined type:

```go
type IntPtr *int   // also forbidden — base type is pointer
type Counter int
func (c *Counter) Inc() { *c++ }   // OK — base is Counter, pointer is allowed
```

### Q21: What's wrong with `type A struct { X int }; type B = A` then trying to add `func (b B) M()`?

**Answer:** `B` is an alias for `A`. The method would be on `A`, not on `B` — and that's allowed only if `A` is in the same package. If `A` is in your package, `func (b B) M()` is *equivalent to* `func (a A) M()`, so it works. If `A` is from another package, the compile error fires.

### Q22: Why does `time.Duration(5) * 100` work even though `time.Duration` is a defined type?

**Answer:** Because the underlying type is `int64`, and the operator `*` is defined on `int64`. The spec says operators apply via the underlying type. The constant `100` is an untyped integer that takes the type of the other operand. The result type is `time.Duration`.

---

## Senior-Level Questions

### Q23: When should you use a defined type for an ID field, and when is `string` acceptable?

**Answer:**
- **Use defined type** at module/package boundaries, in domain models, in public APIs, anywhere safety matters.
- **`string` is fine** in internal helpers, in the marshalling layer, in glue code where typing has no payoff.

The cost is conversion noise; the benefit is compile-time safety. In a 100k+ LOC codebase, the benefit usually wins.

### Q24: What is the canonical pattern for a function-based middleware adapter?

**Answer:** Define a function type with one method that satisfies the target interface:

```go
type Middleware interface {
    Wrap(next http.Handler) http.Handler
}

type MiddlewareFunc func(next http.Handler) http.Handler
func (m MiddlewareFunc) Wrap(next http.Handler) http.Handler { return m(next) }
```

This is the same pattern as `http.HandlerFunc`. It eliminates struct boilerplate per middleware.

### Q25: Can methods on a generic defined type have their own type parameters?

**Answer:** No. The Go specification forbids it.

```go
type Stack[T any] []T

// ILLEGAL
// func (s Stack[T]) Map[U any](f func(T) U) Stack[U]
```

Use a top-level function:

```go
func Map[T, U any](s Stack[T], f func(T) U) Stack[U] { ... }
```

### Q26: Why is this restriction on generic methods in place?

**Answer:** Methods participate in interface satisfaction. If a method could introduce its own type parameters, an interface's method set would become parameterized, complicating dispatch and the runtime. The Go team chose to keep method dispatch simple and cover the use case via top-level generic functions.

### Q27: How do you migrate from `type UserID = string` to `type UserID string` in a large codebase?

**Answer:**
1. **Phase 1**: Introduce alias `type UserID = string`. Non-breaking.
2. **Phase 2**: Add `func ParseUserID(s string) (UserID, error)` and use it at boundaries.
3. **Phase 3**: Drop the `=` to make it a defined type. **Breaking** — every implicit conversion becomes a compile error.
4. **Phase 4**: Run `go build ./...`, fix conversion sites, repeat. Use `gopls rename` for systematic renames.
5. **Phase 5**: Add `Validate()` and other methods.

Plan for several days of compile errors in a 500k LOC codebase.

### Q28: How does conversion between two defined types with the same underlying type behave at runtime?

**Answer:** It's a **no-op** at runtime — no allocation, no copy, no instructions. The conversion is purely a compile-time relabeling.

```go
type A int
type B int

var a A = 5
var b B = B(a)   // zero runtime cost
```

### Q29: What's the right receiver style for a defined slice type?

**Answer:**
- **Value receiver** for read-only methods (`Sum`, `Find`, `Filter` returning a new slice).
- **Pointer receiver** for in-place mutation (`Append`, `Reset`, `Sort` if it sorts in place).

`sort.IntSlice` is mostly value-receiver because the operations don't change the slice length. The slice header is copied but the backing array is shared.

### Q30: What happens if I call `errors.Is(err, ErrNotFound)` and `err` is wrapped via `fmt.Errorf("%w", ErrNotFound)`?

**Answer:** `errors.Is` unwraps the chain. The wrapper struct has an `Unwrap() error` method returning `ErrNotFound`. `errors.Is` compares each level — and since `ErrNotFound` is a comparable defined type (`type ErrCode int`), the comparison succeeds.

### Q31: Why is `MarshalJSON` on a defined `string` type useful?

**Answer:** It lets you customize the JSON representation. For instance, `type Status int` with `String()` and `MarshalJSON` returning the string form gives you human-readable JSON without losing the compact in-memory representation.

```go
func (s Status) MarshalJSON() ([]byte, error) {
    return []byte(`"` + s.String() + `"`), nil
}
```

### Q32: Can you implement multiple interfaces on the same defined function type?

**Answer:** Yes, as long as you implement all methods of all interfaces. Example:

```go
type Job func() error

func (j Job) Run() error  { return j() }      // satisfies Runner
func (j Job) Close() error { return nil }      // satisfies Closer
```

Now `Job` satisfies both `Runner` and `Closer`.

---

## Tricky / Curveball Questions

### Q33: What does this print?
```go
type Counter int
func (c Counter) Inc() { c++ }

var c Counter = 5
c.Inc()
fmt.Println(c)
```
- a) 6
- b) 5
- c) Compile error

**Answer: b — 5**

`Inc` is a value receiver. `c++` increments the local copy. The original is unchanged. Only `func (c *Counter) Inc()` would mutate the caller's value.

### Q34: Which compile?
```go
type T int
type S = T
type U T

func (t T) A() {}    // 1
func (s S) B() {}    // 2
func (u U) C() {}    // 3
func (i int) D() {}  // 4
```
- a) Only 1
- b) 1, 2, 3
- c) 1, 3
- d) All

**Answer: c — 1 and 3**

- 1: `T` is a defined type — OK.
- 2: `S` is an alias for `T`. `S` is `T`. The method becomes `(t T) B()`, which would be OK, except… Go disallows methods on aliases when the alias resolves to a non-local-but-aliased type. Wait — actually, if `T` is in the same package, this should compile. Let's be more careful: Go 1.9+ permits methods on local aliases. The compiler error is specific to aliases of *external* types. So in this case, **2 might compile** if `T` is local. Most strict reading: aliases are forbidden as receivers in the form shown — confirm with `go vet`.
- 3: `U` is a defined type from `T` — OK.
- 4: `int` is predeclared — ERROR.

**Practical answer**: 1, 3, and possibly 2 (depending on Go version and whether T is local). Definitely not 4.

### Q35: What's the value of `unsafe.Sizeof(Counter(0))` where `type Counter int`?

**Answer:** Same as `unsafe.Sizeof(int(0))` — 8 bytes on 64-bit, 4 bytes on 32-bit. Defined types add no runtime overhead.

### Q36: What does this print?
```go
type Greeter func() string
func (g Greeter) Wrap() Greeter {
    return func() string { return "[" + g() + "]" }
}

var hi Greeter = func() string { return "hello" }
result := hi.Wrap().Wrap()()
fmt.Println(result)
```

**Answer:** `[[hello]]`

Each `.Wrap()` returns a new `Greeter` that wraps the previous one with brackets.

### Q37: Why is `var s sort.IntSlice = []int{3, 1, 2}` legal but `var s sort.IntSlice = ints` (where `ints []int`) requires a conversion?

**Answer:** A composite literal `[]int{3, 1, 2}` is an untyped value at the literal level — the spec allows it to be assigned to any compatible type, including `IntSlice`. But a *typed* `var ints []int` is a different defined type, so an explicit conversion `sort.IntSlice(ints)` is required.

### Q38: Can `Set[IntSlice]` be declared?
```go
type Set[T comparable] map[T]struct{}
type IntSlice []int

var s Set[IntSlice]
```

**Answer:** No. `IntSlice` is a defined type whose underlying type is `[]int`. Slices are not comparable in Go. The constraint `comparable` is violated. Compile error.

### Q39: What does this code compile to?
```go
type Cents int64
func (c Cents) Add(o Cents) Cents { return c + o }

result := Cents(100).Add(Cents(50))
```

**Answer:** With inlining enabled (the default for short methods), the compiler emits roughly the same code as `int64(100) + int64(50)`. Methods on defined types over primitives are zero-cost abstractions in Go.

### Q40: What's wrong with this?
```go
type Handler func()

var registry = map[string]Handler{}

func Register(name string, h Handler) {
    registry[name] = h
}

// Then:
type MyService struct{}
func (s *MyService) DoWork() { ... }

s := &MyService{}
Register("work", s.DoWork)  // does this compile?
```

**Answer:** Yes, but `s.DoWork` is a method value — it's a `func()` matching `Handler`'s underlying signature. Go converts implicitly. But beware: the method value captures `s`, so `s` escapes to the heap. In a hot path, that allocation matters.

### Q41: Why doesn't this work?
```go
type Numbers []int
type IntSlice []int

var n Numbers = []int{1, 2, 3}
var s IntSlice = n   // ERROR
```

**Answer:** `Numbers` and `IntSlice` are different defined types. Even though their underlying types are the same (`[]int`), the implicit assignment is forbidden. Use `IntSlice(n)`.

### Q42: Is `type Set[T comparable] map[T]struct{}` actually a "type"?

**Answer:** It's a **generic defined type**. By itself it's not a complete type; you instantiate it as `Set[string]`, `Set[int]`, etc. Each instantiation is its own concrete type with its own method set.

---

## Coding Tasks

### Task 1: Counter with methods

```go
// Implement: type Counter int with Inc, Dec, Get methods
// Inc and Dec should mutate the receiver.
```

**Solution:**

```go
type Counter int

func (c *Counter) Inc()       { *c++ }
func (c *Counter) Dec()       { *c-- }
func (c Counter)  Get() int   { return int(c) }
```

### Task 2: IntSlice with Sum and Map

```go
// Implement IntSlice ([]int) with:
//   Sum() int
//   Map(f func(int) int) IntSlice
//   Filter(f func(int) bool) IntSlice
```

**Solution:**

```go
type IntSlice []int

func (s IntSlice) Sum() int {
    total := 0
    for _, v := range s { total += v }
    return total
}

func (s IntSlice) Map(f func(int) int) IntSlice {
    out := make(IntSlice, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}

func (s IntSlice) Filter(f func(int) bool) IntSlice {
    out := make(IntSlice, 0, len(s))
    for _, v := range s { if f(v) { out = append(out, v) } }
    return out
}
```

### Task 3: Generic Set

```go
// Implement: Set[T comparable] with Add, Has, Remove, Union, Intersect
```

**Solution:**

```go
type Set[T comparable] map[T]struct{}

func NewSet[T comparable](xs ...T) Set[T] {
    s := make(Set[T], len(xs))
    for _, x := range xs { s[x] = struct{}{} }
    return s
}

func (s Set[T]) Add(v T)       { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool  { _, ok := s[v]; return ok }
func (s Set[T]) Remove(v T)    { delete(s, v) }

func (s Set[T]) Union(o Set[T]) Set[T] {
    out := make(Set[T], len(s)+len(o))
    for k := range s { out[k] = struct{}{} }
    for k := range o { out[k] = struct{}{} }
    return out
}

func (s Set[T]) Intersect(o Set[T]) Set[T] {
    out := make(Set[T])
    for k := range s { if _, ok := o[k]; ok { out[k] = struct{}{} } }
    return out
}
```

### Task 4: HTTP Handler adapter

```go
// Implement: a function-type Logger that wraps an http.Handler with logging.
```

**Solution:**

```go
type LoggingMiddleware func(next http.Handler) http.Handler

func (m LoggingMiddleware) Wrap(next http.Handler) http.Handler { return m(next) }

var Logging LoggingMiddleware = func(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s — %v", r.Method, r.URL.Path, time.Since(start))
    })
}
```

### Task 5: Custom error code with Error() and HTTPStatus()

```go
// type ErrCode int with constants and methods
```

**Solution:**

```go
type ErrCode int

const (
    ErrNotFound ErrCode = iota + 1
    ErrUnauthorized
    ErrInvalidArgument
)

func (e ErrCode) Error() string {
    switch e {
    case ErrNotFound:        return "not found"
    case ErrUnauthorized:    return "unauthorized"
    case ErrInvalidArgument: return "invalid argument"
    }
    return "unknown"
}

func (e ErrCode) HTTPStatus() int {
    switch e {
    case ErrNotFound:        return 404
    case ErrUnauthorized:    return 401
    case ErrInvalidArgument: return 400
    }
    return 500
}
```

### Task 6: UserID with Validate and Marshalling

```go
// type UserID string with Validate, MarshalJSON, UnmarshalJSON
```

**Solution:**

```go
type UserID string

func (u UserID) Validate() error {
    if len(u) < 3 || len(u) > 64 {
        return fmt.Errorf("user_id: length %d", len(u))
    }
    return nil
}

func (u UserID) MarshalJSON() ([]byte, error) {
    if err := u.Validate(); err != nil { return nil, err }
    return json.Marshal(string(u))
}

func (u *UserID) UnmarshalJSON(data []byte) error {
    var s string
    if err := json.Unmarshal(data, &s); err != nil { return err }
    *u = UserID(s)
    return u.Validate()
}
```

---

## System Design Style

### Q43: How would you design a domain ID type for a large microservices codebase?

**Answer:** A defined string type per ID kind (UserID, OrderID, EventID, etc.), each with `Validate()`, `String()`, JSON and SQL marshalling, and a constructor `Parse(s string) (T, error)`. All ID parsing happens at the boundary (gRPC handler, HTTP handler, DB scan). Internal code never converts `string ↔ ID` again. The boundary layer enforces validation; the inner layers trust the type.

### Q44: How does the standard library use methods on defined types?

**Answer:** Pervasively:
- `time.Duration` (int64) for time spans.
- `time.Month`, `time.Weekday` (int) with `String()`.
- `sort.IntSlice`, `sort.StringSlice`, `sort.Float64Slice` (slice types) for sortability.
- `http.HandlerFunc` (function type) as adapter to `http.Handler`.
- `syscall.Errno` (uintptr) for OS errors.
- `os/exec.Error`, `net.Error` (interfaces) check defined error types via `errors.As`.
- `io/fs.FileMode` (uint32) with `IsDir`, `IsRegular`, `Perm()` etc.

### Q45: When should adapter pattern with function types be preferred over wrapper structs?

**Answer:** When the target interface has exactly one method, and the adapter has no state. Function types are zero-cost and reduce boilerplate. If the adapter needs configuration or multiple methods, use a struct.

---

## What Interviewers Look For

### Junior

- Knows that methods need a receiver and a defined type.
- Cannot add methods to built-in types (without wrapping).
- Recognizes `type X = Y` (alias) vs `type X Y` (defined type).
- Has seen `time.Duration` or `sort.IntSlice` as examples.

### Middle

- Understands the "same package" rule for receivers.
- Knows the underlying type chain and what conversions it allows.
- Can implement `Set[T]`, `IntSlice`, custom error codes.
- Understands the HandlerFunc adapter pattern.

### Senior

- Justifies when to introduce a defined type (DDD value object, API boundary).
- Plans alias→defined-type migration in a large codebase.
- Knows the generic-method restrictions (no method-level type parameters).
- Has implemented JSON/SQL marshalling on defined types.

### Professional

- Designs an entire ID/error code hierarchy as defined types.
- Sets coding standards: validation-on-parse, conversions only at boundaries.
- Adopts custom analyzers/linters that enforce the patterns.
- Migrates legacy primitives to defined types incrementally.

---

## Cheat Sheet

```
DEFINED TYPE QUICK REFERENCE
─────────────────────────────────────────
type Counter int                       primitive + behavior
type IntSlice []int                    sortable, filterable
type StringSet map[string]struct{}     set semantics
type Handler func(...) ...             adapter pattern
type Set[T comparable] map[T]struct{}  generic set
type ErrCode int                       error code (with .Error())

RESTRICTIONS
─────────────────────────────────────────
NO methods on built-in types (int, string, ...)
NO methods on types from other packages
NO methods on type aliases (type X = Y)
NO methods on unnamed type literals ([]int directly)
NO method-level type parameters
NO methods on pointer base types (P *T as receiver)

STD LIB EXAMPLES
─────────────────────────────────────────
time.Duration       int64    .Hours/.Minutes/.String
sort.IntSlice       []int    .Len/.Less/.Swap
http.HandlerFunc    func     .ServeHTTP
syscall.Errno       uintptr  .Error/.Temporary/.Timeout
io/fs.FileMode      uint32   .IsDir/.Perm

CONVERSION RULES
─────────────────────────────────────────
Counter(7)              from int → Counter (zero cost)
int(c)                  from Counter → int (zero cost)
A(b) where A,B same     OK if underlying types match
                        compile error otherwise

THINGS NOT TO SAY
─────────────────────────────────────────
- "Defined types are slow" — they have zero runtime cost.
- "Aliases let me add methods" — they don't.
- "Generic methods can have their own type parameters" — they can't.
- "Methods on int are allowed" — only on a wrapped defined type.
```
