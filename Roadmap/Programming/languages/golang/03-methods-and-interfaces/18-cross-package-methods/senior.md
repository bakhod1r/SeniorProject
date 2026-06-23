# Cross-Package Methods — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Interface Satisfaction Across the Wrapper Boundary](#interface-satisfaction-across-the-wrapper-boundary)
3. [The Marshaler/Unmarshaler Problem](#the-marshalerunmarshaler-problem)
4. [The `database/sql` Scanner/Valuer Problem](#the-databasesql-scannervaluer-problem)
5. [Embedding vs Wrapping for Interface Inheritance](#embedding-vs-wrapping-for-interface-inheritance)
6. [Generics + Cross-Package Methods](#generics-cross-package-methods)
7. [Generic Type Aliases (Go 1.24+)](#generic-type-aliases-go-124)
8. [Method Sets When Underlying Type Is a Pointer](#method-sets-when-underlying-type-is-a-pointer)
9. [Performance — Conversion vs Indirection](#performance-conversion-vs-indirection)
10. [Reflect and Type Identity](#reflect-and-type-identity)
11. [Cross-Package Method Pattern Catalog](#cross-package-method-pattern-catalog)
12. [Real-World Architecture Examples](#real-world-architecture-examples)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

At the senior level, cross-package method workarounds become an architecture decision. Each pattern leaks behavior in a specific way:

- A wrapper changes the **type identity** — interfaces no longer match.
- An embedding preserves type identity for promotion but changes the outer type.
- A free function leaves type identity intact but changes the call shape.

The choice depends on what the surrounding system needs: JSON, SQL, fmt, reflection, generics. This file walks through each interaction.

---

## Interface Satisfaction Across the Wrapper Boundary

A wrapper does **not** inherit the interface satisfaction of its underlying type. This is the most consequential property of the pattern.

```go
package myapp

import (
    "fmt"
    "time"
)

type MyTime time.Time

// time.Time has String(), so it satisfies fmt.Stringer.
// But MyTime does not — it has no methods of its own.
var _ fmt.Stringer = time.Time{} // OK
// var _ fmt.Stringer = MyTime{} // compile error
```

The compiler is precise: interface satisfaction is computed from the **method set of the type itself**, not from any underlying type.

### Restoring satisfaction by forwarding

```go
func (t MyTime) String() string { return time.Time(t).Format(time.RFC3339) }

var _ fmt.Stringer = MyTime{} // now OK
```

You declare `String()` on `MyTime` and forward to the underlying. This is a cheap one-liner per interface method.

### Restoring satisfaction by embedding

```go
type EmbeddedTime struct { time.Time }

var _ fmt.Stringer = EmbeddedTime{} // OK — String promoted
```

Embedding preserves all interface satisfactions of the embedded type, automatically. This is the embedding pattern's biggest strength.

### When the difference matters

Three common stdlib interfaces are easy to forget when wrapping:

| Interface | Foreign type that satisfies it | What breaks if not forwarded |
|---|---|---|
| `fmt.Stringer` | `time.Duration`, `net.IP`, many others | `fmt.Println` shows `{1 2 3}` instead of `"1.2.3.4"` |
| `error` | `*url.Error`, `*net.OpError` | wrapping these masks `Error()` |
| `json.Marshaler` | `time.Time`, `time.Duration` (no), `net.IP` | round-trip JSON breaks |
| `sql.Scanner` / `driver.Valuer` | `sql.NullString`, `time.Time` | DB I/O breaks |
| `encoding.TextMarshaler` | `time.Time`, `net.IP`, `net.HardwareAddr` | Text-based encodings break |
| `gob.GobEncoder` / `BinaryMarshaler` | `time.Time` | Binary encoding breaks |

A single missed forward can corrupt a serialization round-trip silently. Senior-level wrappers ALWAYS audit the marshal interfaces.

---

## The Marshaler/Unmarshaler Problem

`time.Time` has carefully tuned `MarshalJSON` and `UnmarshalJSON`. A bare wrapper loses all of it:

```go
type Timestamp time.Time

func main() {
    t := Timestamp(time.Date(2026, 5, 7, 12, 0, 0, 0, time.UTC))
    b, _ := json.Marshal(t)
    fmt.Println(string(b))
    // {} — Timestamp has no exported fields visible to encoding/json
}
```

The default JSON encoder sees `Timestamp` as a struct (its underlying layout), but the fields of `time.Time` are unexported. Output: empty object.

### Forwarding the marshalers — the canonical fix

```go
type Timestamp time.Time

func (t Timestamp) MarshalJSON() ([]byte, error) {
    return time.Time(t).MarshalJSON()
}

func (t *Timestamp) UnmarshalJSON(b []byte) error {
    var inner time.Time
    if err := inner.UnmarshalJSON(b); err != nil {
        return err
    }
    *t = Timestamp(inner)
    return nil
}
```

Now `Timestamp` round-trips identically to `time.Time`.

### Wrapping with custom format

The whole point of wrapping `time.Duration` is often to customize its JSON shape:

```go
type Duration time.Duration

func (d Duration) MarshalJSON() ([]byte, error) {
    return json.Marshal(time.Duration(d).String()) // "5m30s" instead of nanoseconds
}

func (d *Duration) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil {
        return err
    }
    parsed, err := time.ParseDuration(s)
    if err != nil { return err }
    *d = Duration(parsed)
    return nil
}
```

This is one of the most common reasons developers introduce a wrapper in the first place.

### Forwarding via embedding

When embedding, the marshalers are promoted automatically:

```go
type EnrichedTime struct { time.Time }

func main() {
    t := EnrichedTime{Time: time.Now()}
    b, _ := json.Marshal(t)
    fmt.Println(string(b))
    // "2026-05-07T12:00:00Z" — promoted MarshalJSON
}
```

But promotion has its own subtle pitfalls. If `EnrichedTime` adds extra fields, the JSON output may include them at the top level along with the time, or the time may collide with a struct-key:

```go
type Wrong struct {
    time.Time
    Name string
}
// JSON output: {"Name":"x"} — time.Time's MarshalJSON dominates
```

When `time.Time` is embedded and has its own `MarshalJSON`, encoding/json calls **only** the embedded type's `MarshalJSON` for the entire struct. The `Name` field disappears from the output.

This trap surprises many developers. The fix is to write a custom `MarshalJSON` on the outer type, or **not embed types that already implement `MarshalJSON`**.

---

## The `database/sql` Scanner/Valuer Problem

`database/sql` uses two interfaces to handle custom types:

```go
type Scanner interface { Scan(src any) error }
type Valuer interface { Value() (driver.Value, error) }
```

`time.Time` satisfies both directly. A wrapper does not. To make the wrapper usable in `db.QueryRow().Scan(&ts)`, you must forward:

```go
package myapp

import (
    "database/sql/driver"
    "time"
)

type Timestamp time.Time

func (t *Timestamp) Scan(src any) error {
    if src == nil {
        *t = Timestamp{}
        return nil
    }
    switch v := src.(type) {
    case time.Time:
        *t = Timestamp(v)
        return nil
    case []byte:
        parsed, err := time.Parse(time.RFC3339, string(v))
        if err != nil { return err }
        *t = Timestamp(parsed)
        return nil
    }
    return fmt.Errorf("cannot scan %T into Timestamp", src)
}

func (t Timestamp) Value() (driver.Value, error) {
    return time.Time(t), nil
}
```

Notice `Scan` has a pointer receiver (it mutates) and `Value` has a value receiver (it does not).

### `pq.NullTime` reference implementation

The `lib/pq` package's `NullTime` is the canonical wrapper:

```go
type NullTime struct {
    Time  time.Time
    Valid bool
}

func (nt *NullTime) Scan(value any) error {
    nt.Time, nt.Valid = value.(time.Time)
    return nil
}

func (nt NullTime) Value() (driver.Value, error) {
    if !nt.Valid {
        return nil, nil
    }
    return nt.Time, nil
}
```

`NullTime` is a struct (not a defined type wrapping `time.Time`) because it adds the `Valid` flag. It cannot be a simple `type NullTime time.Time` — there is no spare bit in `time.Time` to encode "null".

### `sql.NullString` reference implementation

```go
type NullString struct {
    String string
    Valid  bool
}

func (ns *NullString) Scan(value any) error { /* ... */ return nil }
func (ns NullString) Value() (driver.Value, error) { /* ... */ return nil, nil }
```

Same shape as `NullTime`. The pattern: pair the foreign value with a flag, attach `Scan` and `Value`.

---

## Embedding vs Wrapping for Interface Inheritance

A common dilemma: you want a domain type that "looks like" a `time.Time` for serialization but adds new methods.

### Option A — Wrapper (explicit)

```go
type Event time.Time

func (e Event) IsBusinessHours() bool { /* ... */ return true }
func (e Event) MarshalJSON() ([]byte, error) { return time.Time(e).MarshalJSON() }
func (e *Event) UnmarshalJSON(b []byte) error { /* ... */ return nil }
```

**Result**: explicit method set, predictable behavior, requires manual forwarding.

### Option B — Embedding (implicit)

```go
type Event struct { time.Time }

func (e Event) IsBusinessHours() bool { /* ... */ return true }
```

**Result**: all of `time.Time`'s methods auto-promoted, but JSON encoding may behave unexpectedly when the struct has extra fields, and you cannot do `Event(t)` as a free conversion.

### How to choose

| Situation | Choose |
|---|---|
| Need free conversion `Event(t)` | Wrapper |
| Need ALL of `time.Time`'s methods + new ones | Embedding |
| Adding new fields to the struct | Embedding |
| Want JSON to behave exactly like `time.Time` | Wrapper, forward MarshalJSON |
| Wrapped type has pointer-receiver mutating methods | Embedding (with pointer field) |
| Strict, controlled public API | Wrapper |

A thoughtful codebase often layers both: a wrapper at the persistence boundary, an embedding inside an aggregate.

---

## Generics + Cross-Package Methods

Generics do not change the rule. You still cannot add a method to a foreign type, generic or otherwise:

```go
import "container/list"

// func (l *list.List) Filter(...) // compile error — list.List is non-local
```

You can wrap a generic foreign type, but you must respect the receiver-type-parameter rule:

```go
package myapp

import "sync"

// sync.Map has no type parameters yet (in 1.x). For a hypothetical
// generic foreign type, you would write:

// import "container/list" — list.List is not generic, but suppose:

// type MyList[T any] container/list.List // illegal — receiver base must be local

// You instead wrap an instantiation:
type IntStack struct { items []int }

func (s *IntStack) Push(x int) { s.items = append(s.items, x) }
```

For real generic foreign types, the wrapping pattern is:

```go
// Hypothetical: generic foreign type Pair[A, B any]
// You define a local generic wrapper.
type MyPair[A, B any] struct { A A; B B } // a fresh local type

func (p MyPair[A, B]) Swap() MyPair[B, A] {
    return MyPair[B, A]{A: p.B, B: p.A}
}
```

The senior-level rule: generics do not bend the cross-package method restriction.

---

## Generic Type Aliases (Go 1.24+)

Go 1.24 introduced generic type aliases:

```go
type StringMap[V any] = map[string]V
```

These behave like ordinary aliases plus type parameters: they let you give a parameterized name to a structural type. They do **not** create a new type, and so you cannot add methods:

```go
// type StringMap[V any] = map[string]V
// func (m StringMap[V]) Keys() ... // compile error — alias to a built-in map
```

The fix is the same as before:

```go
type StringMap[V any] map[string]V // defined generic type, no =

func (m StringMap[V]) Keys() []string {
    out := make([]string, 0, len(m))
    for k := range m {
        out = append(out, k)
    }
    return out
}
```

Generic type aliases are useful for **API surface** ("rename this complex type"), not for adding behavior.

---

## Method Sets When Underlying Type Is a Pointer

You cannot have a pointer as a receiver base type. But the underlying type of a defined type is allowed to be... well, almost anything:

```go
// Allowed underlying types for a defined type:
type T int             // primitive
type T struct{ ... }   // struct
type T []int           // slice
type T map[K]V         // map
type T func(...) ...   // function type
type T chan int        // channel
type T *something      // pointer? NO — see below
```

The spec **does** allow `type T *Other`, but you cannot add methods to such a `T`:

```go
type IntPtr *int
// func (p IntPtr) Get() int { return *p } // compile error: invalid receiver IntPtr
```

The receiver base type must be neither a pointer nor an interface. So pointer-typed defined types are largely useless for method extension. The standard pattern is:

```go
type IntBox struct { Value *int }

func (b IntBox) Get() int {
    if b.Value == nil { return 0 }
    return *b.Value
}
```

Wrap the pointer in a struct, then attach methods to the struct.

---

## Performance — Conversion vs Indirection

Wrapper conversions are free. Embedding adds an indirection.

### Wrapper

```go
type Timestamp time.Time

t := time.Now()
ts := Timestamp(t)        // no work
back := time.Time(ts)     // no work
```

The compiler emits no MOV/COPY beyond the surrounding statements. `Timestamp` and `time.Time` are bit-identical at the machine level.

### Embedding (no extra fields)

```go
type Wrap struct { time.Time }

t := time.Now()
w := Wrap{Time: t}        // copy of time.Time fields
inner := w.Time           // copy
```

The struct is the same size as `time.Time`, but the fields move when constructing/destructuring. In hot loops this can show up in benchmarks if you construct the struct millions of times.

### Embedding (extra fields)

```go
type Wrap struct {
    time.Time
    UserID int64
}
```

`Wrap` is larger than `time.Time` — the size grows by the size of the extra fields plus alignment padding. Stack/heap layout changes.

### Practical guidance

For most code, both patterns have negligible cost. For genuinely hot paths (parsing millions of timestamps per second, for example) prefer the wrapper. For everyday code, prefer whichever pattern reads better.

---

## Reflect and Type Identity

`reflect.TypeOf` distinguishes between the wrapper and the underlying:

```go
type Timestamp time.Time

t := time.Now()
ts := Timestamp(t)

fmt.Println(reflect.TypeOf(t).String())  // time.Time
fmt.Println(reflect.TypeOf(ts).String()) // myapp.Timestamp
```

Code that reflects on type names — generic JSON encoders, GORM, validation libraries — sees `Timestamp`, not `time.Time`. This can affect:

- Field tag interpretation (most libraries are field-by-field, so the wrapper-as-field is fine).
- Custom type registries (`gob.Register`, etc.) — register the wrapper type explicitly.
- Schema migrations that look at Go types (rare, but real for some frameworks).

Embedding does NOT change the embedded field's type — `reflect.TypeOf(w.Time)` still returns `time.Time`. This is one more reason to prefer embedding when working with reflective frameworks.

---

## Cross-Package Method Pattern Catalog

A senior-level catalog. Every entry is in production somewhere.

### Pattern 1 — Domain-typed primitive

```go
type UserID int64
type OrderID string
type Money int64 // cents

func (m Money) Add(o Money) Money { return m + o }
```

Gain: type safety. `func ChargeUser(userID UserID, amount Money)` cannot be called with arguments swapped.

### Pattern 2 — Wrapper with marshal forwarding

```go
type Timestamp time.Time

func (t Timestamp) MarshalJSON() ([]byte, error) { /* ... */ return nil, nil }
func (t *Timestamp) UnmarshalJSON(b []byte) error { /* ... */ return nil }
```

Gain: cleanest representation in DTOs, no `time.Time`-specific layout choices leaking out.

### Pattern 3 — SQL nullable wrapper

```go
type NullTime struct {
    Time  time.Time
    Valid bool
}

func (n *NullTime) Scan(src any) error { /* ... */ return nil }
func (n NullTime) Value() (driver.Value, error) { /* ... */ return nil, nil }
```

Gain: nullable database column with a clean API.

### Pattern 4 — Decorator via embedding

```go
type RetryClient struct {
    *http.Client
    MaxRetries int
}

func (c *RetryClient) DoWithRetry(req *http.Request) (*http.Response, error) { /* ... */ return nil, nil }
```

Gain: every method of `*http.Client` still works, plus a new one.

### Pattern 5 — Free function for one-off operations

```go
func IsRFC1918(ip net.IP) bool { /* ... */ return false }
func ParseTimeoutOrDefault(s string, d time.Duration) time.Duration { /* ... */ return d }
```

Gain: minimal API surface, no new types in your package.

### Pattern 6 — Struct adapter (interface implementation)

```go
type SQLLogger struct { db *sql.DB }

func (s *SQLLogger) Write(p []byte) (int, error) {
    _, err := s.db.Exec("INSERT INTO logs(msg) VALUES($1)", string(p))
    return len(p), err
}
```

Gain: adapt a foreign type (`*sql.DB`) to satisfy `io.Writer` via composition.

---

## Real-World Architecture Examples

### `time.Time` everywhere → domain `Timestamp`

A growing service has `time.Time` scattered across handlers, repository, and JSON DTOs. The team introduces `Timestamp` to:

1. Force timezone discipline (`Timestamp` is always UTC).
2. Customize JSON shape (`"2026-05-07T12:00:00Z"` always, never the default verbose form).
3. Add domain helpers (`IsBusinessHours()`, `RoundToHour()`).

Migration is the 7-step process from `middle.md`. Result: a single canonical timestamp type, stronger type safety, predictable JSON.

### Multi-package monorepo

In a service with `domain/`, `infra/`, `api/` packages:

- `domain/` defines `type Timestamp time.Time` with business methods.
- `infra/` adds `Scan`/`Value` (defined as **methods on `Timestamp`** — so they live in `domain/`, not `infra/`).
- `api/` uses `Timestamp` directly in DTOs.

The cross-package method rule forces all methods on `Timestamp` to live with the type's declaration in `domain/`. `infra/` cannot add `Scan` from outside. This is a feature: it keeps the type's full behavior visible in one place.

### When you reach for embedding

A logging HTTP client is the classic case. You want to log every request without losing any of `*http.Client`'s methods:

```go
type LoggingClient struct {
    *http.Client
    log *log.Logger
}

func (c *LoggingClient) Do(req *http.Request) (*http.Response, error) {
    c.log.Println("REQ:", req.Method, req.URL)
    return c.Client.Do(req)
}
```

The new `Do` shadows the embedded `Do`, but every other method (`Get`, `Post`, `PostForm`, etc.) is still promoted from `*http.Client`. The wrapper would force you to forward all of those by hand.

---

## Cheat Sheet

```
INTERFACE SATISFACTION
───────────────────────────────────
Wrapper inherits methods?       NO
Wrapper inherits interfaces?    NO
Embedding inherits methods?     YES (promotion)
Embedding inherits interfaces?  YES (via promotion)

MARSHAL FORWARDING
───────────────────────────────────
fmt.Stringer        forward String()
json.Marshaler      forward MarshalJSON / UnmarshalJSON
sql.Scanner         forward Scan
driver.Valuer       forward Value
encoding.Text*      forward MarshalText / UnmarshalText
gob, binary         forward as needed

PERFORMANCE
───────────────────────────────────
Wrapper conversion         FREE
Embedding (no extra)       struct copy on construction
Embedding (extra fields)   larger struct
Hot path                   prefer wrapper

GENERICS
───────────────────────────────────
Cross-pkg method rule unchanged
Generic foreign type → wrap an instantiation
Go 1.24 generic alias → still no methods

REFLECT
───────────────────────────────────
reflect.TypeOf(wrapper) shows wrapper name
embedding preserves embedded type's identity
```

---

## Summary

Senior-level cross-package method patterns:

1. **Wrappers break interface satisfaction by default**. Forward the methods you need (especially `String`, `MarshalJSON`, `Scan`, `Value`).
2. **Embedding preserves interface satisfaction** at the cost of a more permissive method set and the embedded-marshaler trap.
3. **Marshalers must be forwarded** — the most common silent failure of naive wrappers.
4. **`database/sql` requires `Scan`/`Value`** — model after `pq.NullTime` and `sql.NullString`.
5. **Generics + Go 1.24 aliases** do not bend the rule.
6. **Reflect sees the wrapper's name**; embedding preserves the inner type's identity.
7. **Choose by need**: wrapper for explicit API, embedding for full inheritance, free function for one-off helpers.

In `professional.md` we look at API design with wrappers across multiple packages, migration strategies for breaking changes, and team conventions.
