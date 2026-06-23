# Methods on Defined Types — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

These bugs are specific to **non-struct** defined types — type aliases vs defined
types, primitives wrapped as domain types, function types with methods,
generic defined types, and embedded defined types whose method sets are easy
to break in subtle ways.

---

## Bug 1 — Methods on a type alias

```go
package money

import "time"

// Looks like a "wrapper" — but uses '='.
type Timestamp = time.Time

func (t Timestamp) Unix() int64 {
    return time.Time(t).Unix()
}
```

**Hint:** What kind of type does `=` create?

**Bug:** `type Timestamp = time.Time` is an **alias**, not a defined type.
Aliases are the same type as their target. `time.Time` is declared in another
package, and Go does not allow new methods to be defined on a non-local type.
Compile error:

```
cannot define new methods on non-local type time.Time
```

The author wanted a "richer Timestamp" but accidentally wrote `=`, turning the
declaration into an alias and silently disabling the entire purpose of the
file.

**Fix:** drop the `=` so it becomes a defined type.

```go
type Timestamp time.Time   // defined type — has its own method set

func (t Timestamp) Unix() int64 {
    return time.Time(t).Unix()
}
```

Convert at boundaries: `Timestamp(t)` and `time.Time(ts)`.

---

## Bug 2 — Method silently lost after refactoring `type X` → `type X = Y`

```go
// v1 — defined type, methods work
type UserID int64
func (u UserID) String() string { return fmt.Sprintf("u-%d", u) }

// ... later, somebody decides "UserID is just int64, let's simplify" ...

// v2 — refactor introduces an alias by mistake
type UserID = int64
// String method file deleted because "it's just int64 now"
```

```go
fmt.Println(UserID(42))   // prints "42", not "u-42"
```

**Hint:** Read the diff of the refactor — what changed besides removing the
method?

**Bug:** Replacing `type UserID int64` with `type UserID = int64` looks like a
one-character cleanup, but it is a destructive change:

- All methods previously defined on `UserID` had to be removed (you cannot
  declare methods on `int64`).
- Every `fmt.Stringer`, `json.Marshaler`, etc. quietly disappears from the
  method set.
- Code compiles fine because alias makes `UserID` interchangeable with
  `int64`. The bug is invisible until logs or APIs start showing raw integers.

**Fix:** keep the defined type. If the goal is "less ceremony", document it
instead of aliasing.

```go
type UserID int64

func (u UserID) String() string { return fmt.Sprintf("u-%d", u) }
```

If you really need an alias, audit every method that was attached and decide,
explicitly, what to do with each one.

---

## Bug 3 — Wrong conversion at the boundary

```go
type MyTime time.Time

func (m MyTime) IsWeekend() bool {
    d := m.Weekday()                  // ?
    return d == time.Saturday || d == time.Sunday
}

func Schedule(t time.Time) {
    m := MyTime(t)
    if m.IsWeekend() { /* ... */ }
}
```

**Hint:** Does `MyTime` inherit methods from `time.Time`?

**Bug:** A defined type built on another type does **not** inherit the source
type's methods. `MyTime` does not have `Weekday()`. Compile error:

```
m.Weekday undefined (type MyTime has no field or method Weekday)
```

People often confuse this with embedding — but `type MyTime time.Time` is a
plain type definition, not a struct with an embedded field.

**Fix:** convert back to `time.Time` to call its methods.

```go
func (m MyTime) IsWeekend() bool {
    d := time.Time(m).Weekday()
    return d == time.Saturday || d == time.Sunday
}
```

Or embed the type if you want method promotion:

```go
type MyTime struct{ time.Time }
func (m MyTime) IsWeekend() bool { /* m.Weekday() works now */ }
```

---

## Bug 4 — Method lost on slice copy through `[]T` vs `[]Defined`

```go
type Email string
func (e Email) Domain() string {
    i := strings.IndexByte(string(e), '@')
    if i < 0 { return "" }
    return string(e)[i+1:]
}

func collectDomains(addrs []string) []string {
    out := make([]string, 0, len(addrs))
    for _, a := range addrs {
        out = append(out, a.Domain())   // ?
    }
    return out
}
```

**Hint:** What is the element type of `addrs`?

**Bug:** The function takes `[]string`, not `[]Email`. Even though `Email`'s
underlying type is `string`, the method `Domain` is in `Email`'s method set,
not `string`'s. Compile error:

```
a.Domain undefined (type string has no field or method Domain)
```

The classic mistake is to "save a conversion" by accepting the underlying
type. The cost is the entire reason `Email` exists — the methods.

**Fix:** accept the defined type, or convert per element.

```go
func collectDomains(addrs []Email) []string {
    out := make([]string, 0, len(addrs))
    for _, a := range addrs { out = append(out, a.Domain()) }
    return out
}
```

If callers genuinely have `[]string`, convert at the boundary:

```go
for _, a := range addrs {
    out = append(out, Email(a).Domain())
}
```

---

## Bug 5 — Pointer-receiver method on map element of a defined int

```go
type Counter int

func (c *Counter) Inc() { *c++ }

func main() {
    counters := map[string]Counter{"hits": 0}
    counters["hits"].Inc()
    fmt.Println(counters["hits"])
}
```

**Hint:** Can you take the address of a map element?

**Bug:** `Inc` has a pointer receiver, so calling `counters["hits"].Inc()`
needs `&counters["hits"]`. Map elements are not addressable. Compile error:

```
cannot call pointer method on counters["hits"]
cannot take the address of counters["hits"]
```

This bites harder for `type Counter int` than for structs because there is no
visual "this is heavy state" — people assume an `int` should be cheap to
mutate in place.

**Fix:** read, mutate, write back.

```go
c := counters["hits"]
c.Inc()
counters["hits"] = c
```

Or store pointers:

```go
counters := map[string]*Counter{"hits": new(Counter)}
counters["hits"].Inc()
```

Or use an immutable style with a value receiver that returns a new value:

```go
func (c Counter) Inc() Counter { return c + 1 }
counters["hits"] = counters["hits"].Inc()
```

---

## Bug 6 — Domain primitive accidentally compared to a plain string

```go
type UserID string

func currentUser() UserID { return "alice" }

func isAdmin(id UserID) bool {
    admins := []string{"alice", "bob"}
    for _, a := range admins {
        if id == a {            // ?
            return true
        }
    }
    return false
}
```

**Hint:** Is `id == a` a string comparison or a UserID comparison?

**Bug:** `id` is `UserID`, `a` is `string`. They share the same underlying
type but they are **different types**. Comparison between defined types and
their underlying types is not allowed without conversion. Compile error:

```
invalid operation: id == a (mismatched types UserID and string)
```

The seductive variant is when the literal sneaks through: `id == "alice"`
works (the untyped string constant is convertible to `UserID`), but as soon
as you put the literals into a `[]string`, the comparison breaks. The
worse-case scenario is when somebody "fixes" it by writing
`if string(id) == a`, which throws away the type safety the wrapper was
created to provide.

**Fix:** keep the type at both ends.

```go
admins := []UserID{"alice", "bob"}
for _, a := range admins {
    if id == a { return true }
}
```

Or make the conversion explicit and intentional in one direction only:

```go
if id == UserID(a) { return true }
```

---

## Bug 7 — `HandlerFunc`-style adapter that calls itself

```go
type HandlerFunc func(w http.ResponseWriter, r *http.Request)

// Make HandlerFunc satisfy http.Handler.
func (h HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    h.ServeHTTP(w, r)    // ?
}
```

**Hint:** What does `h.ServeHTTP` resolve to?

**Bug:** The adapter is supposed to dispatch by **calling** the underlying
function value: `h(w, r)`. Instead, the author wrote `h.ServeHTTP(w, r)`,
which is the same method that is currently executing. Result: infinite
recursion until the goroutine's stack grows past `runtime.GOMAXSTACK` and the
program crashes with `runtime: goroutine stack exceeds 1000000000-byte
limit`.

The reason this happens so often: people copy the pattern from
`net/http.HandlerFunc` and forget that the *whole point* of the adapter is to
call `h` as a function, not as a method.

**Fix:** call the function value.

```go
func (h HandlerFunc) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    h(w, r)   // call the function, not the method
}
```

---

## Bug 8 — `Errno` type compared to literal `0`

```go
type Errno int

func (e Errno) Error() string { return fmt.Sprintf("errno %d", e) }

func syscallX() error {
    var e Errno = 0
    return e          // ?
}

func main() {
    if err := syscallX(); err != nil {
        fmt.Println("failed:", err)
    } else {
        fmt.Println("ok")
    }
}
```

**Hint:** What does `return e` mean when `e == 0` and the return type is
`error`?

**Bug:** Two interacting problems, both very common with `type Errno int`:

1. `return e` returns an `error` interface whose dynamic type is `Errno` and
   dynamic value is `0`. The interface value is **not nil** — `err != nil`
   is true even when `e == 0`. The caller mistakenly thinks the call failed.
2. If the author tries to "fix" it inside the syscall with
   `if e == 0 { return nil }`, that works — but if they then write
   `if err == 0` at the call site (treating the returned `error` as an int),
   it does not even compile, because `error` is not comparable to `0`.

This is the Go FAQ's classic "typed nil" trap, with `Errno` as the canonical
victim because the zero value of an int-based error type is exactly the
"success" sentinel.

**Fix:** in the producer, convert sentinel zero to a literal `nil` before
returning.

```go
func syscallX() error {
    var e Errno = 0
    if e == 0 {        // compare as Errno, not as the error interface
        return nil
    }
    return e
}
```

Equivalently and more idiomatically:

```go
func syscallX() error {
    e := doSyscall()    // returns Errno
    if e == Errno(0) {
        return nil
    }
    return e
}
```

At call sites, never compare `err == 0`; always compare `err == nil` or use
`errors.Is`.

---

## Bug 9 — Generic defined type instantiated with the wrong parameter

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(v T)        { s[v] = struct{}{} }
func (s Set[T]) Has(v T) bool   { _, ok := s[v]; return ok }

type UserID string

func main() {
    ids := Set[string]{}    // ?
    var u UserID = "alice"
    ids.Add(u)
}
```

**Hint:** What is the parameter `T` and what does `Add` accept?

**Bug:** The set is instantiated with `string`, so `Add` accepts `string`,
not `UserID`. `ids.Add(u)` fails to compile:

```
cannot use u (variable of type UserID) as string value in argument to ids.Add
```

The seductive fix is to write `ids.Add(string(u))`. That compiles, but it
silently downgrades every value going into the set to `string`, defeating
the point of using `UserID`. Worse, `ids.Has(otherID)` then also needs a
conversion, and a stray `ids.Has("alice")` (plain string literal) compiles
without complaint — exactly the kind of mistake `UserID` was meant to catch.

**Fix:** instantiate with the domain type.

```go
ids := Set[UserID]{}
ids.Add(u)              // type-checked
ids.Has("alice")        // still ok — untyped constant converts to UserID
ids.Has(plainString)    // compile error if plainString is string — good!
```

---

## Bug 10 — Embedded defined type whose methods are not promoted

```go
type Email string
func (e Email) Domain() string {
    i := strings.IndexByte(string(e), '@')
    if i < 0 { return "" }
    return string(e)[i+1:]
}

type Contact struct {
    primary Email     // not embedded — named field
    backup  Email
}

func main() {
    c := Contact{primary: "alice@example.com"}
    fmt.Println(c.Domain())   // ?
}
```

**Hint:** Is `primary` embedded or just a field?

**Bug:** `primary Email` is a **named field**, not an embedded field. Method
promotion only happens for anonymous (embedded) fields. The outer struct
`Contact` does not gain `Domain()`. Compile error:

```
c.Domain undefined (type Contact has no field or method Domain)
```

The asymmetric variant is even nastier: a refactor renames an embedded
`Email` to a named `Primary Email`, and every call site that relied on
`c.Domain()` breaks at once — but only at compile time for direct calls. If
`Contact` was being passed through an `interface{ Domain() string }`,
that interface assertion now fails at **runtime** with `*Contact does not
implement DomainProvider`, often deep inside a generic helper.

**Fix:** embed the type if you want promotion.

```go
type Contact struct {
    Email           // embedded — Domain() is promoted
    Backup Email    // named — explicit access via c.Backup.Domain()
}

c := Contact{Email: "alice@example.com"}
fmt.Println(c.Domain())              // works — promoted from Email
fmt.Println(c.Backup.Domain())       // explicit
```

If both fields need promotion of the same method, you cannot embed both —
you must call the methods explicitly.

---

## Bug 11 — Embedded defined type with pointer receivers, outer used by value

```go
type Counter int
func (c *Counter) Inc()        { *c++ }
func (c Counter) Value() int   { return int(c) }

type Stats struct {
    Counter            // embedded
    name string
}

func track(s Stats) {
    s.Inc()             // ?
}

func main() {
    s := Stats{name: "hits"}
    track(s)
    fmt.Println(s.Value())
}
```

**Hint:** Two layers of receiver/value confusion.

**Bug:** Two cooperating problems:

1. `track` takes `Stats` by value. The embedded `Counter` is copied. `s.Inc()`
   does compile (Go takes the address of the local `s.Counter`), but the
   increment happens on the **copy** — the caller's `s` is unchanged.
2. Because `Inc` has a pointer receiver and the outer `Stats` is held by
   value, an interface like `interface{ Inc() }` cannot be satisfied by a
   plain `Stats` value: the method set of `Stats` only contains the methods
   whose receivers are value-typed in the outer-or-embedded sense. You need
   `*Stats`.

The defined-type angle is what makes this subtle: the same trap on a struct
embedded type is more visible because struct types are usually big and
people instinctively pass them by pointer; an `int`-shaped `Counter` looks
"cheap" and tempts pass-by-value.

**Fix:** pass `*Stats` and operate on it through the pointer.

```go
func track(s *Stats) { s.Inc() }

func main() {
    s := &Stats{name: "hits"}
    track(s)
    fmt.Println(s.Value())   // 1
}
```

Or, if you need a value-typed API, give `Counter` a value receiver that
returns a new value, and re-assign:

```go
func (c Counter) Inc() Counter { return c + 1 }

func track(s Stats) Stats { s.Counter = s.Counter.Inc(); return s }

s = track(s)
```

---

## Cheat Sheet

```
DEFINED-TYPE METHOD BUGS
─────────────────────────────
1. type X = Y       → cannot add methods (alias, not defined type)
2. Refactor to alias → silently drops every method on X
3. type X Y         → does NOT inherit Y's methods; convert at boundary
4. []string vs []X  → method set lives on X, not on its underlying type
5. type X int + *X.M → map["k"].M() is non-addressable: read-modify-write
6. UserID == string → mismatched types; keep domain type on both sides
7. HandlerFunc.M    → call h(...), not h.M(...) — recursion otherwise
8. Errno(0) vs nil  → typed-nil trap; return literal nil from producer
9. Generic[T]       → instantiate with the domain type, not its underlying
10. Named field     → no method promotion; embed (anonymous) for promotion
11. *receiver + value outer → method set excludes *-receiver methods

QUICK CHECKS
─────────────────────────────
go vet ./...                      # typed-nil, copylocks, etc.
go vet -vettool=$(which fieldalignment) ./...
staticcheck ./...                 # ST1016 receiver names, SA4023 typed nil

RULE OF THUMB
─────────────────────────────
- Use 'type X Y'  when X has invariants, methods, or domain meaning.
- Use 'type X = Y' only for migrations / package renames.
- Convert at the boundary; never let underlying types leak into APIs.
- Pointer receiver?  Decide once per type, apply consistently.
```
