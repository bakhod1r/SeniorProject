# Cross-Package Methods — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

These bugs all revolve around the rule "you cannot define a method on a type from another package." The workarounds — defined types, wrappers, embeddings — each have their own pitfalls.

---

## Bug 1 — Method directly on `time.Time`

```go
package main

import (
    "fmt"
    "time"
)

func (t time.Time) IsWeekend() bool {
    d := t.Weekday()
    return d == time.Saturday || d == time.Sunday
}

func main() {
    fmt.Println(time.Now().IsWeekend())
}
```

**Hint:** Where does `time.Time` live?

**Bug:** A method receiver type must be defined in the same package as the method. `time.Time` is declared in the `time` package, so the compiler rejects the declaration with `cannot define new methods on non-local type time.Time`. Methods can only be added to types you own.

**Fix:** Wrap the type in a defined local type and add the method to the wrapper.

```go
type MyTime time.Time

func (t MyTime) IsWeekend() bool {
    d := time.Time(t).Weekday()
    return d == time.Saturday || d == time.Sunday
}

func main() {
    fmt.Println(MyTime(time.Now()).IsWeekend())
}
```

A defined type (no `=`) creates a new named type whose method set you fully control.

---

## Bug 2 — Method on a type alias

```go
package main

import (
    "fmt"
    "time"
)

type MyTime = time.Time

func (t MyTime) IsWeekend() bool {
    d := t.Weekday()
    return d == time.Saturday || d == time.Sunday
}

func main() {
    fmt.Println(MyTime(time.Now()).IsWeekend())
}
```

**Hint:** Look at the `=` in the type declaration.

**Bug:** `type MyTime = time.Time` is a *type alias*, not a defined type. After aliasing, `MyTime` and `time.Time` refer to the exact same type. Adding a method to `MyTime` is therefore the same as adding a method to `time.Time`, which the compiler forbids: `cannot define new methods on non-local type time.Time`. The `=` sign is the giveaway — drop it to make a brand-new type.

**Fix:**

```go
type MyTime time.Time   // defined type — no '='

func (t MyTime) IsWeekend() bool {
    d := time.Time(t).Weekday()
    return d == time.Saturday || d == time.Sunday
}
```

Aliases are useful for migrations and re-exports, but they cannot grow the method set of a foreign type.

---

## Bug 3 — Wrapper forgets to forward `MarshalJSON`

```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

type Date time.Time

func (d Date) IsWeekend() bool {
    return time.Time(d).Weekday() == time.Saturday
}

func main() {
    d := Date(time.Date(2026, 5, 7, 0, 0, 0, 0, time.UTC))
    b, _ := json.Marshal(d)
    fmt.Println(string(b))
}
```

**Hint:** What method set does the wrapper inherit?

**Bug:** When you write `type Date time.Time`, the new type does **not** inherit any methods from the underlying type. `time.Time` implements `json.Marshaler` via `MarshalJSON`, but `Date` does not — so `json.Marshal` falls back to the default struct encoding and emits something like `{}` (because `time.Time`'s fields are unexported). The custom RFC 3339 format you expected is gone.

**Fix:** Forward the marshaler explicitly.

```go
func (d Date) MarshalJSON() ([]byte, error) {
    return time.Time(d).MarshalJSON()
}

func (d *Date) UnmarshalJSON(b []byte) error {
    var t time.Time
    if err := t.UnmarshalJSON(b); err != nil {
        return err
    }
    *d = Date(t)
    return nil
}
```

For every interface the underlying type implemented, the wrapper must re-implement (usually by delegation) — `Stringer`, `MarshalJSON`, `Scan`, `Value`, and so on.

---

## Bug 4 — Embedding `time.Time`: marshaling ignores wrapper fields

```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

type Event struct {
    time.Time
    Name string
}

func main() {
    e := Event{Time: time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC), Name: "launch"}
    b, _ := json.Marshal(e)
    fmt.Println(string(b)) // expect both Time and Name?
}
```

**Hint:** Which `MarshalJSON` wins when a type is embedded?

**Bug:** Embedding promotes the embedded type's methods. `time.Time` has `MarshalJSON`, so `Event` inherits it. `json.Marshal(e)` therefore calls `e.Time.MarshalJSON()` — producing only the timestamp string `"2026-05-07T12:00:00Z"` and **silently dropping** the `Name` field. The same trap applies on the way back: `UnmarshalJSON` is also promoted, so `Name` will never be populated from JSON either.

**Fix:** Either don't embed, or override the marshaler on `Event`.

```go
type Event struct {
    Time time.Time `json:"time"`
    Name string    `json:"name"`
}
```

Or, if embedding is needed for ergonomics:

```go
type Event struct {
    time.Time
    Name string
}

func (e Event) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Time time.Time `json:"time"`
        Name string    `json:"name"`
    }{e.Time, e.Name})
}
```

---

## Bug 5 — Implicit conversion missing

```go
package main

import (
    "fmt"
    "time"
)

type MyTime time.Time

func describe(t time.Time) string {
    return t.Format(time.RFC3339)
}

func main() {
    mt := MyTime(time.Now())
    fmt.Println(describe(mt))
}
```

**Hint:** Defined types and assignability.

**Bug:** Even though `MyTime` and `time.Time` share an underlying type, they are **distinct types**. Go does not implicitly convert between distinct named types — even with identical underlying types — except for untyped constants. The compiler rejects the call: `cannot use mt (variable of type MyTime) as type time.Time in argument to describe`.

**Fix:** Convert explicitly at the call site.

```go
fmt.Println(describe(time.Time(mt)))
```

If conversions are frequent, expose helpers:

```go
func (m MyTime) Std() time.Time { return time.Time(m) }
// usage: describe(mt.Std())
```

---

## Bug 6 — Wrapping pointer vs value type

```go
package main

import (
    "bytes"
    "fmt"
)

type MyBuffer bytes.Buffer

func (b MyBuffer) Dump() string {
    return bytes.Buffer(b).String()
}

func main() {
    var b MyBuffer
    bp := &b
    bp.Write([]byte("hello"))     // ?
    fmt.Println(bp.Dump())
}
```

**Hint:** Which methods does `MyBuffer` actually have?

**Bug:** `bytes.Buffer`'s mutating methods (`Write`, `WriteString`, `Reset`, ...) all have pointer receivers — `func (b *Buffer) Write(...)`. When you wrap with `type MyBuffer bytes.Buffer`, **none** of those methods carry over: a defined type starts empty. So `bp.Write(...)` fails to compile with `bp.Write undefined`. (`Dump` works only because you defined it locally.)

**Fix:** Wrap by embedding (so methods are promoted) or by holding a pointer.

```go
type MyBuffer struct {
    *bytes.Buffer
}

func New() *MyBuffer {
    return &MyBuffer{Buffer: new(bytes.Buffer)}
}

func (b *MyBuffer) Dump() string { return b.Buffer.String() }

func main() {
    b := New()
    b.Write([]byte("hello"))
    fmt.Println(b.Dump())
}
```

Beware: the inner `*bytes.Buffer` must be initialised, otherwise `Write` will panic on a nil pointer (see Bug 8).

---

## Bug 7 — Generic alias appears to take a method (Go 1.24+)

```go
package main

import "fmt"

type Slice[T any] = []T  // Go 1.24+ allows generic aliases

func (s Slice[T]) First() T { // ?
    return s[0]
}

func main() {
    fmt.Println(Slice[int]{1, 2, 3}.First())
}
```

**Hint:** Even with the new generic-alias support, what's the difference between an alias and a definition?

**Bug:** Go 1.24 introduced *generic aliases* — but they are still aliases (`=`). `Slice[T]` resolves to `[]T`, an unnamed slice type defined in the universe block, not in your package. You cannot attach methods to it. The compiler rejects the declaration with `invalid receiver type Slice[T] (Slice[T] is an alias)`.

**Fix:** Use a defined generic type.

```go
type Slice[T any] []T   // no '='

func (s Slice[T]) First() T { return s[0] }
```

The general rule is unchanged: methods require a *named, locally-defined* type. Aliases — generic or not — never qualify.

---

## Bug 8 — Embedded `*http.Client` is nil

```go
package main

import (
    "fmt"
    "net/http"
)

type API struct {
    *http.Client
    Base string
}

func main() {
    a := API{Base: "https://example.com"}
    resp, err := a.Get(a.Base) // promoted from *http.Client
    fmt.Println(resp, err)
}
```

**Hint:** What is the zero value of `*http.Client`?

**Bug:** Embedding a pointer type promotes its methods, but the field's zero value is `nil`. `a.Client` is `nil`, and `a.Get(...)` is shorthand for `a.Client.Get(...)` — calling a method on a nil `*http.Client` panics with `runtime error: invalid memory address or nil pointer dereference`. Pointer embedding is a frequent foot-gun: code compiles, looks idiomatic, then panics at first use.

**Fix:** Always initialise the embedded pointer (or embed by value where appropriate).

```go
func NewAPI(base string) *API {
    return &API{Client: &http.Client{}, Base: base}
}

func main() {
    a := NewAPI("https://example.com")
    resp, err := a.Get(a.Base)
    _ = resp
    _ = err
}
```

A constructor (`NewAPI`) makes the requirement explicit — callers cannot accidentally instantiate the zero value.

---

## Bug 9 — Embedded `sql.NullString` and a custom marshaler

```go
package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
)

type User struct {
    ID    int
    Email sql.NullString `json:"email"`
}

func main() {
    u := User{ID: 1, Email: sql.NullString{String: "a@b.com", Valid: true}}
    b, _ := json.Marshal(u)
    fmt.Println(string(b))
}
```

**Hint:** Does `sql.NullString` know how to marshal as a plain string?

**Bug:** `sql.NullString` does **not** implement `json.Marshaler`. The default encoder marshals it as a struct: `{"email":{"String":"a@b.com","Valid":true}}` — exposing internal database wire details to the client and leaking `Valid: false` rows as `{"String":"","Valid":false}` instead of `null`. The `json:"email"` tag survives, but the value shape is wrong.

**Fix:** Wrap `sql.NullString` (or any `Null*` type) and provide JSON methods.

```go
type NullString struct{ sql.NullString }

func (n NullString) MarshalJSON() ([]byte, error) {
    if !n.Valid {
        return []byte("null"), nil
    }
    return json.Marshal(n.String)
}

func (n *NullString) UnmarshalJSON(b []byte) error {
    if string(b) == "null" {
        n.Valid = false
        return nil
    }
    if err := json.Unmarshal(b, &n.String); err != nil {
        return err
    }
    n.Valid = true
    return nil
}

type User struct {
    ID    int        `json:"id"`
    Email NullString `json:"email"`
}
```

Now the JSON shape (`"email":"a@b.com"` or `"email":null`) matches what API clients actually expect.

---

## Bug 10 — Wrapper breaks `reflect.TypeOf` checks

```go
package main

import (
    "fmt"
    "reflect"
    "time"
)

type Stamp time.Time

func isTime(v any) bool {
    return reflect.TypeOf(v) == reflect.TypeOf(time.Time{})
}

func main() {
    s := Stamp(time.Now())
    fmt.Println(isTime(s)) // expecting true?
}
```

**Hint:** Are `Stamp` and `time.Time` the same type at runtime?

**Bug:** `reflect.TypeOf` returns the **dynamic, declared** type, not the underlying type. `Stamp` is a distinct named type, so `reflect.TypeOf(s)` reports `main.Stamp`, not `time.Time`. The equality check returns `false`, even though both share the same underlying struct. Code paths that key off `reflect.TypeOf(...) == reflect.TypeOf(time.Time{})` (common in custom encoders, ORM dialects, and validation libraries) silently skip your wrapper.

**Fix:** Compare *underlying* types, or check assignability/convertibility.

```go
func isTime(v any) bool {
    rt := reflect.TypeOf(v)
    timeT := reflect.TypeOf(time.Time{})
    return rt == timeT || rt.ConvertibleTo(timeT) && rt.Kind() == reflect.Struct &&
        rt.NumField() == timeT.NumField()
}
```

Even better: instead of type identity, check for an interface (`reflect.TypeOf(v).Implements(stringerT)`) — that survives wrapping. Wrapping foreign types is fine, but downstream reflective code may need to be taught about the wrapper.

---

## Bug 11 — Conversion through alias chain loses methods

```go
package main

import (
    "fmt"
    "time"
)

type Stamp time.Time

func (s Stamp) Pretty() string {
    return time.Time(s).Format(time.RFC1123)
}

func main() {
    var t time.Time = time.Now()
    fmt.Println(t.Pretty()) // ?
}
```

**Hint:** Conversions go one way, methods don't follow.

**Bug:** `Pretty` is defined on `Stamp`, not on `time.Time`. Converting from `time.Time` to `Stamp` is allowed, but a `time.Time` value does not gain methods just because a wrapper exists. The compiler reports `t.Pretty undefined (type time.Time has no field or method Pretty)`. To use `Pretty`, you must hold the value in the wrapper type.

**Fix:** Convert at the boundary.

```go
fmt.Println(Stamp(t).Pretty())
```

Or, if the conversion is common, write a free function:

```go
func Pretty(t time.Time) string { return Stamp(t).Pretty() }
```

Methods follow the type, not the value — wrapping changes the type, the value is the same bits.

---

## Bug 12 — Embedded interface vs embedded concrete type

```go
package main

import (
    "fmt"
    "io"
    "os"
)

type LoggedWriter struct {
    io.Writer
}

func (l LoggedWriter) Write(p []byte) (int, error) {
    fmt.Print("[log] ")
    return l.Writer.Write(p)
}

func main() {
    lw := LoggedWriter{Writer: os.Stdout}
    n, _ := fmt.Fprintln(lw, "hello")
    _ = n
}
```

**Hint:** What is the zero value of `io.Writer`, and what happens if you forget to set it?

**Bug:** This compiles and runs — but only because `Writer` is initialised. If a caller writes `LoggedWriter{}` (no field), the embedded `io.Writer` is `nil`. `l.Writer.Write(p)` then panics with `runtime error: invalid memory address or nil pointer dereference`. The same trap as Bug 8, but harder to spot because the embedded field is an interface, so `go vet` won't warn. There is no compile-time check that an interface field is non-nil.

**Fix:** Use a constructor and validate, or fall back to a sentinel `io.Discard`.

```go
func NewLoggedWriter(w io.Writer) *LoggedWriter {
    if w == nil {
        w = io.Discard
    }
    return &LoggedWriter{Writer: w}
}

func main() {
    lw := NewLoggedWriter(os.Stdout)
    fmt.Fprintln(lw, "hello")
}
```

Whenever you embed an interface or pointer from another package, treat the zero value as a bug magnet — wrap construction in a function that establishes the invariant.

---

## Cheat Sheet

```
CROSS-PACKAGE METHOD RULES
─────────────────────────────────────────────
1. Methods only on locally-defined types
   - foreign type direct        → compile error
   - alias (type X = Foo)       → compile error
   - generic alias (Go 1.24+)   → still alias, still error

2. Defined wrappers (type X Foo)
   - new type, empty method set
   - must re-implement Stringer / Marshaler / Scanner / ...
   - distinct from underlying — explicit conversion needed

3. Embedding (struct { Foo })
   - promotes methods
   - promotes Marshaler too — may swallow outer fields
   - pointer/interface embed: nil zero value → panic

4. Reflection
   - reflect.TypeOf sees the wrapper, not Foo
   - prefer interface checks over type equality

CHECKLIST WHEN WRAPPING A FOREIGN TYPE
─────────────────────────────────────────────
[ ] Does the underlying type implement json.Marshaler / Stringer / Scanner?
    → forward each one
[ ] Are the original methods on pointer receivers?
    → embed *T or hold a pointer field
[ ] Will reflection-based code see the wrapper?
    → document or expose .Std() / .Underlying()
[ ] Is the zero value safe?
    → constructor with NewX(...)
[ ] Will JSON / SQL drivers see the right shape?
    → write round-trip tests
```
