# Cross-Package Methods — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Wrapper Type API Design](#wrapper-type-api-design)
3. [Free Function Strategy](#free-function-strategy)
4. [Embedding-Based Extension](#embedding-based-extension)
5. [Real-World Standard Library Wrappers](#real-world-standard-library-wrappers)
6. [Marshaling and Unmarshaling Forwarding](#marshaling-and-unmarshaling-forwarding)
7. [Wrapper Plus Interface Satisfaction](#wrapper-plus-interface-satisfaction)
8. [Multi-Package Architecture](#multi-package-architecture)
9. [Decision Tree for Workarounds](#decision-tree-for-workarounds)
10. [Migration Strategies](#migration-strategies)
11. [Anti-Patterns Catalog](#anti-patterns-catalog)
12. [Tooling and Linters](#tooling-and-linters)
13. [Summary](#summary)

---

## Introduction

The Go specification states a hard rule: a method's receiver base type **must be a defined type declared in the same package as the method**. This rule is small in text and large in consequence — every API that wants to extend a foreign type (`time.Time`, `net.IP`, `sql.NullString`, third-party structs) has to choose a workaround.

At the professional level, the choice is not "which workaround compiles" but "which workaround maintains backward compatibility, satisfies serialization contracts, and integrates with our domain model." This file walks through the production patterns and the trade-offs that real teams hit.

The three sanctioned workarounds:

1. **Defined wrapper type** — `type MyTime time.Time`. New methods, conversion needed.
2. **Free function** — `func FormatRFC(t time.Time) string`. No type, no method set change.
3. **Struct embedding** — `type Event struct { time.Time }`. Promoted methods plus new ones.

A type alias (`type X = time.Time`) is **not** a workaround — aliases share an identity with the aliased type, and methods cannot be declared on a foreign type.

---

## Wrapper Type API Design

### The basic wrapper

```go
package billing

import "time"

// CycleDate wraps time.Time to add billing-cycle semantics.
type CycleDate time.Time

// New methods can now exist on CycleDate.
func (c CycleDate) BillingMonth() string {
    return time.Time(c).Format("2006-01")
}

func (c CycleDate) IsEndOfMonth() bool {
    t := time.Time(c)
    next := t.AddDate(0, 0, 1)
    return next.Day() == 1
}
```

Conversion is explicit on both sides:

```go
t := time.Now()
cd := CycleDate(t)        // time.Time -> CycleDate
back := time.Time(cd)     // CycleDate -> time.Time
```

### Promoted methods do NOT carry across

A defined wrapper has the **same memory layout** as the underlying type but a **fresh method set**. None of `time.Time`'s methods exist on `CycleDate` until you re-declare them.

```go
cd := CycleDate(time.Now())
// cd.Format(time.RFC3339)   // compile error — Format is on time.Time, not CycleDate
time.Time(cd).Format(time.RFC3339)   // OK — convert back first
```

This is by design. If you want the original method set plus new ones, embed instead.

### Forwarding selectively

Production wrappers usually expose only the operations the domain needs. Hide the rest:

```go
type CycleDate time.Time

func (c CycleDate) Year() int                  { return time.Time(c).Year() }
func (c CycleDate) Month() time.Month          { return time.Time(c).Month() }
func (c CycleDate) Add(d time.Duration) CycleDate {
    return CycleDate(time.Time(c).Add(d))
}
```

The wrapper becomes a small DSL. Callers see `CycleDate.Add` returning `CycleDate`, never `time.Time`.

### Wrapping pointer types

If the foreign type is large and copies are expensive, wrap a pointer:

```go
type Session struct { *http.Request }

func (s Session) UserAgent() string { return s.Request.Header.Get("User-Agent") }
```

That is technically embedding, not a defined type, and brings promotion rules into play (see section 4).

---

## Free Function Strategy

### When a function beats a wrapper

If the domain logic is **stateless** and you do not need polymorphism, a plain function is the smallest and clearest option.

```go
package timefmt

import "time"

// FormatRFC always renders in UTC — useful for log lines.
func FormatRFC(t time.Time) string {
    return t.UTC().Format(time.RFC3339Nano)
}

// IsBusinessHour treats Monday-Friday 09:00-17:00 in the given location as business hours.
func IsBusinessHour(t time.Time, loc *time.Location) bool {
    t = t.In(loc)
    if w := t.Weekday(); w == time.Saturday || w == time.Sunday {
        return false
    }
    h := t.Hour()
    return h >= 9 && h < 17
}
```

No new type. No method set surgery. Callers keep using `time.Time` everywhere.

### Function-only API surface

If the package only adds operations on `time.Time`, no struct is required at all:

```go
package timex

func StartOfDay(t time.Time) time.Time { return t.Truncate(24 * time.Hour) }
func EndOfDay(t time.Time) time.Time   { return StartOfDay(t).Add(24*time.Hour - time.Nanosecond) }
func DaysBetween(a, b time.Time) int   { return int(b.Sub(a) / (24 * time.Hour)) }
```

Standard library follows this pattern: `path/filepath.Clean`, `strings.ToLower`, `net.JoinHostPort` — none of them attach methods to foreign types.

### When a function falls short

A free function cannot:
- Be passed to an interface that demands `Format() string` etc.
- Implement `fmt.Stringer`, `json.Marshaler`, `sql.Scanner`.
- Be discovered through `t.<dot>` IDE completion.

Anything that requires the call site to look like `value.M()` needs a wrapper or embedding.

---

## Embedding-Based Extension

### Preserving the original method set

```go
package event

import "time"

type Event struct {
    time.Time          // embedded — promotes Format, UTC, Add, Sub, etc.
    Source string
}

func (e Event) Stamp() string {
    return e.Source + "@" + e.Format(time.RFC3339)
}
```

`Event{}.Format(time.RFC3339)` calls the promoted `time.Time.Format`. No conversion is needed.

### Embedding a pointer

```go
type Connection struct {
    *net.TCPConn
    Tag string
}

func (c *Connection) Tagged() string { return c.Tag + ":" + c.RemoteAddr().String() }
```

Promoted methods include `Read`, `Write`, `Close`, `RemoteAddr`. The wrapper adds `Tagged`.

### Method shadowing

If you re-declare a method that the embedded type also has, the outer method **wins** at the outer-type call site:

```go
type Event struct{ time.Time }

// Shadow String() — time.Time also has String().
func (e Event) String() string { return "Event[" + e.Time.String() + "]" }

// e.String() calls Event.String, not e.Time.String.
```

Use shadowing carefully — readers can be surprised when `e.String()` and `e.Time.String()` differ.

### Embedding interfaces

If you embed an interface, the wrapper satisfies that interface automatically and can selectively override methods:

```go
type loggingDB struct {
    *sql.DB                     // promotes Query, Exec, Begin, etc.
    log *slog.Logger
}

func (l *loggingDB) Query(q string, args ...any) (*sql.Rows, error) {
    l.log.Info("sql", "q", q)
    return l.DB.Query(q, args...)
}
```

This is the textbook decorator pattern — only `Query` is wrapped, every other call passes through.

---

## Real-World Standard Library Wrappers

### `sql.NullString`

`database/sql.NullString` is a wrapper struct, not an embedding, because the underlying value (`string`) is a built-in type:

```go
type NullString struct {
    String string
    Valid  bool   // Valid is true if String is not NULL
}

// Methods can exist because NullString is defined in database/sql.
func (ns *NullString) Scan(value any) error    { ... }
func (ns NullString) Value() (driver.Value, error) { ... }
```

You cannot do `type MyString string; func (m MyString) Scan(...)` and use it for nullability — `MyString` has no slot for `Valid`. The struct is mandatory because nullability is **state**, not a method on the value alone.

### `pq.NullTime` and `sql.NullTime`

```go
// database/sql (Go 1.13+)
type NullTime struct {
    Time  time.Time
    Valid bool
}

func (nt *NullTime) Scan(value any) error { ... }
func (nt NullTime) Value() (driver.Value, error) { ... }
```

`Time` is exported as a regular field, not embedded — embedding `time.Time` would promote `Format`, `String`, etc., bloating the public method set and making JSON marshaling ambiguous.

### `net.IP`

```go
// net package
type IP []byte

func (ip IP) String() string             { ... }
func (ip IP) IsLoopback() bool           { ... }
func (ip IP) MarshalText() ([]byte, error) { ... }
```

`net.IP` itself is a defined type wrapping `[]byte`. If your application wants extra IP semantics:

```go
package geo

import "net"

type GeoIP struct {
    net.IP        // embed — keep IsLoopback, To4, etc.
    Country string
}

func (g GeoIP) String() string { return g.Country + "@" + g.IP.String() }
```

### Custom `Duration`

```go
package config

import (
    "encoding/json"
    "time"
)

// Duration enables JSON parsing as "2h30m" instead of nanoseconds.
type Duration time.Duration

func (d Duration) MarshalJSON() ([]byte, error) {
    return json.Marshal(time.Duration(d).String())
}

func (d *Duration) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil {
        return err
    }
    parsed, err := time.ParseDuration(s)
    if err != nil {
        return err
    }
    *d = Duration(parsed)
    return nil
}
```

Without this wrapper there is no place to attach `MarshalJSON` — `time.Duration` lives in `time` and you cannot add methods from `config`.

---

## Marshaling and Unmarshaling Forwarding

### Why wrappers must implement marshaling explicitly

A defined type does **not** inherit interface implementations from its underlying type for foreign types either:

```go
type CycleDate time.Time

// time.Time implements json.Marshaler. Does CycleDate?
// NO — CycleDate has no methods until you add them.

b, err := json.Marshal(CycleDate(time.Now()))
// Marshals as a struct {wall,ext,loc} — surprise!
```

The fix: forward to the underlying type's implementation.

```go
func (c CycleDate) MarshalJSON() ([]byte, error) {
    return time.Time(c).MarshalJSON()
}

func (c *CycleDate) UnmarshalJSON(b []byte) error {
    var t time.Time
    if err := t.UnmarshalJSON(b); err != nil {
        return err
    }
    *c = CycleDate(t)
    return nil
}
```

### Embedding side-steps the issue

```go
type Event struct{ time.Time }

// json.Marshal(Event{time.Now()}) — uses promoted MarshalJSON from time.Time.
```

Embedding promotes interface implementations too, so `Event` automatically becomes a `json.Marshaler`.

But if `Event` has additional fields, you must spell out the marshal logic:

```go
type Event struct {
    time.Time
    Source string
}

func (e Event) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Time   time.Time `json:"time"`
        Source string    `json:"source"`
    }{e.Time, e.Source})
}
```

Without the explicit marshaller the promoted `time.Time.MarshalJSON` would emit only the timestamp, dropping `Source`.

### Database `Scanner` and `Valuer`

```go
type CycleDate time.Time

func (c *CycleDate) Scan(value any) error {
    var t sql.NullTime
    if err := t.Scan(value); err != nil {
        return err
    }
    if !t.Valid {
        *c = CycleDate{}
        return nil
    }
    *c = CycleDate(t.Time)
    return nil
}

func (c CycleDate) Value() (driver.Value, error) {
    if (time.Time(c)).IsZero() {
        return nil, nil
    }
    return time.Time(c), nil
}
```

The pattern is identical: convert into the standard wrapper, do the work, convert back.

---

## Wrapper Plus Interface Satisfaction

### Adding interface compliance to a foreign type

You cannot add `Stringer` to `time.Time` directly. But you can wrap it and the wrapper satisfies `Stringer`:

```go
type LogTime time.Time

func (l LogTime) String() string {
    return time.Time(l).UTC().Format("2006-01-02T15:04:05.000Z")
}

var _ fmt.Stringer = LogTime{}   // compile-time guarantee
```

Now `fmt.Println(LogTime(t))` uses your formatting, while `fmt.Println(t)` still uses Go's default.

### Embedding satisfies foreign interfaces

```go
type Scanner interface {
    Scan(state fmt.ScanState, verb rune) error
}

type Wrapper struct{ time.Time }
// Wrapper does not satisfy Scanner unless time.Time does.
// time.Time does NOT implement fmt.Scanner — so Wrapper does not either.
```

Embedding promotes whatever the embedded type has — no more, no less. To make `Wrapper` satisfy a new interface, declare the method directly.

### Sentinel: interface assertion at package init

```go
var (
    _ json.Marshaler   = CycleDate{}
    _ json.Unmarshaler = (*CycleDate)(nil)
    _ sql.Scanner      = (*CycleDate)(nil)
    _ driver.Valuer    = CycleDate{}
)
```

These zero-cost assertions break the build if any expected interface stops being satisfied — important because forgetting to update marshaling on a wrapper is a frequent regression.

---

## Multi-Package Architecture

### Layer the wrappers

A common pattern in larger codebases:

```
internal/
├── domain/
│   └── billing.go        // type CycleDate time.Time + business rules
├── infra/db/
│   └── billing_dao.go    // imports domain, scans into CycleDate
├── api/http/
│   └── billing_handler.go // imports domain, marshals CycleDate
└── pkg/timex/
    └── timex.go          // FREE FUNCTIONS on time.Time
```

The defined type lives in `domain` so that `infra/db` and `api/http` can both use it without duplicating logic. `pkg/timex` holds operations that are not domain-specific.

### Avoid wrapper sprawl

Anti-pattern: every layer wraps `time.Time` again.

```go
// domain/billing.go
type CycleDate time.Time

// infra/db/billing.go
type DBCycleDate time.Time   // DON'T — duplicate of CycleDate

// api/http/billing.go
type APIDate time.Time       // DON'T — yet another duplicate
```

One wrapper per concept. If layer-specific behavior is needed, add functions, not new types.

### Wrappers across module boundaries

When you publish a wrapper in a public module, callers must convert:

```go
// module example.com/billing
package billing
type CycleDate time.Time

// caller in another module
cd := billing.CycleDate(time.Now())
```

Document this clearly. Many users prefer that the public API expose `time.Time` directly and use the wrapper internally.

---

## Decision Tree for Workarounds

```
Need behavior on a foreign type?
│
├── Need an interface implementation (Stringer, Marshaler, Scanner, ...)?
│   │
│   ├── YES, plus extra fields → struct embedding + custom marshaling
│   │
│   └── YES, no extra fields → defined wrapper type + forwarded marshaling
│
├── Need polymorphism (call x.M() through an interface)?
│   │
│   └── Wrapper or embedding (free function cannot satisfy an interface)
│
├── Need to retain the foreign type's full API automatically?
│   │
│   └── Struct embedding
│
├── Pure stateless transformation?
│   │
│   └── Free function (smallest API surface)
│
└── Trying to add a method to time.Time directly?
    │
    └── Not possible. Spec forbids it. Pick one of the above.
```

| Need | Best fit |
|------|----------|
| Domain semantics around a primitive | Defined wrapper type |
| Decorator over an interface (logging, retry) | Embedding |
| Custom marshal/unmarshal of stdlib type | Wrapper + forwarding |
| Stateless utility | Free function |
| Compose new behavior with full original API | Embedding |
| Hide some methods of the original | Wrapper, expose only what you forward |

---

## Migration Strategies

### From a free function to a wrapper

```go
// v1
package billing
func IsEndOfMonth(t time.Time) bool { ... }

// v2 — wrapper
type CycleDate time.Time
func (c CycleDate) IsEndOfMonth() bool { ... }

// Keep v1 as a deprecated proxy
// Deprecated: use CycleDate(t).IsEndOfMonth().
func IsEndOfMonth(t time.Time) bool {
    return CycleDate(t).IsEndOfMonth()
}
```

Add the wrapper in a non-breaking minor release. Remove the function in the next major.

### From embedding to a defined type

This is **breaking**: embedding promotes the foreign type's method set, a defined type does not.

```go
// v1
type Event struct{ time.Time; Source string }   // e.Format(...) works

// v2 — switch to a defined type
type Event struct {
    Time   CycleDate
    Source string
}
// e.Format(...) no longer compiles
```

If you must do this, bump the major version and document that callers should use `e.Time.<method>()` or convert back to `time.Time`.

### Adding marshaling to an existing wrapper

Safe in a minor release **only** if the previous behavior was the default Go marshaling and you confirm no consumers relied on it.

```go
// Before: CycleDate had no MarshalJSON; JSON came out as a struct.
// After: MarshalJSON emits an RFC3339 string.

func (c CycleDate) MarshalJSON() ([]byte, error) { ... }
```

Internal databases that stored the old JSON format may break. In a public API this is effectively breaking — bump major.

### Removing a wrapper in favor of stdlib

If you used `type Duration time.Duration` and the standard library later supports your need (or you give up custom JSON), migrate consumers off the wrapper before deletion. Provide:

1. A `// Deprecated: use time.Duration.` doc comment.
2. A static-analysis lint banning new uses.
3. A CHANGELOG entry pointing to the migration guide.

---

## Anti-Patterns Catalog

### Anti-pattern 1: Trying to add a method to a foreign type

```go
// in your package
// func (t time.Time) FormatRFC() string { ... }   // compile error
```

The compiler rejects this. New developers hit it weekly. Pick a workaround.

### Anti-pattern 2: Type alias to a foreign type

```go
type MyTime = time.Time          // alias
// func (m MyTime) FormatRFC() string { ... }   // compile error: time.Time is not defined here
```

A type alias is the same identity as the aliased type. Methods would have to be in the aliased type's package. Aliases serve renames and gradual API moves, not method extension.

### Anti-pattern 3: Embedding inside a domain entity by accident

```go
type Order struct {
    time.Time   // inherits Year, UTC, Format, String, ...
    ID string
}

fmt.Println(o)   // calls promoted time.Time.String() — surprising
```

Either name the field (`CreatedAt time.Time`) or shadow `String()` deliberately. Promoted methods leak public API.

### Anti-pattern 4: Forgetting marshaling forwarding

```go
type CycleDate time.Time
// no MarshalJSON

json.Marshal(CycleDate{})   // emits internal struct, not "2006-01-02..."
```

The wrapper compiles, the test passes locally, the JSON in production is unreadable. Always run a marshaling round-trip test.

### Anti-pattern 5: Wrapping for the sake of it

```go
type UserID string
func (u UserID) String() string { return string(u) }   // adds nothing
```

If the wrapper's only method is identity, drop the wrapper and use the underlying type. Wrappers should buy you semantics or behavior.

### Anti-pattern 6: Inconsistent layering

Two packages each define their own `type Date time.Time`. Conversion between them requires two casts (`Date(time.Time(otherDate))`). Centralize wrappers; do not duplicate them.

---

## Tooling and Linters

### `go vet`

Catches `composites`-style mistakes when wrappers are created without all fields, but does not warn about missing `MarshalJSON` on a wrapper.

### `staticcheck`

- `SA1019` flags use of deprecated wrappers.
- `SA9005` warns about marshaling structs without exported fields, useful when wrappers fail to implement custom marshaling.

### `revive`

- `confusing-naming` flags two types named the same way in different packages (`billing.Date` vs `report.Date`).

### Custom analyzer

A team-specific analyzer can ban embedding `time.Time` in domain types or require `_ json.Marshaler = (*Wrapper)(nil)` assertions in any file declaring a wrapper.

```go
// example pseudo-code
if isWrapperOf(typ, "time.Time") && !hasMarshalJSON(typ) {
    pass.Reportf(typ.Pos(), "wrapper of time.Time must implement MarshalJSON")
}
```

### Test patterns

```go
func TestCycleDateRoundTrip(t *testing.T) {
    in := CycleDate(time.Date(2025, 11, 30, 12, 0, 0, 0, time.UTC))
    b, err := json.Marshal(in)
    if err != nil { t.Fatal(err) }
    var out CycleDate
    if err := json.Unmarshal(b, &out); err != nil { t.Fatal(err) }
    if !time.Time(in).Equal(time.Time(out)) {
        t.Fatalf("round trip lost data: %v != %v", in, out)
    }
}
```

Round-trip tests are non-negotiable for any wrapper that touches JSON, SQL, or other serialization formats.

---

## Cheat Sheet

```
SPEC RULE
────────────────────────────
Receiver base type MUST be a defined type
in the SAME package as the method.
A type alias does NOT change the package.

WORKAROUNDS
────────────────────────────
1. Wrapper type   type X T            new methods, new method set
2. Free function  func F(t T) ...     no type, no method set
3. Embedding      struct{ T }         promoted + new methods

NOT A WORKAROUND
────────────────────────────
type X = time.Time      // alias
type X = T              // generic alias (Go 1.24+)

WRAPPER + MARSHALING
────────────────────────────
Wrapper of stdlib type with marshaler →
  must forward MarshalX/UnmarshalX
Embedding promotes existing marshalers.

INTERFACE SATISFACTION
────────────────────────────
Wrapper: declare each method explicitly.
Embedding: promoted methods count.

REAL-WORLD EXAMPLES
────────────────────────────
sql.NullString    struct + Scan/Value
sql.NullTime      struct + Scan/Value
net.IP            type IP []byte
custom Duration   type Duration time.Duration + JSON

DECISION
────────────────────────────
Need new state?         struct (NullX style)
Need new behavior only? defined wrapper
Need full original API? embedding
Need utility?           free function
```

---

## Summary

The same-package rule for method declarations forces every Go codebase that touches stdlib or third-party types to choose a workaround consciously:

1. **Defined wrapper type** — `type CycleDate time.Time`. Use when you need new methods or interface implementations on a foreign type.
2. **Free function** — Use when behavior is stateless and no interface contract requires `value.M()` form.
3. **Struct embedding** — Use when you need to keep the original method set intact and add a few new methods.

A type alias is not a workaround. Generic type aliases (Go 1.24+) are not either — they share identity with the aliased type.

Wrappers come with hidden costs: marshalers, scanners, and other interface implementations must be forwarded explicitly. Run round-trip tests, install interface-satisfaction assertions at the top of the file, and document conversion clearly.

Architecturally, a single wrapper per concept, owned by the domain package, beats per-layer wrappers every time. Combine the wrapper rule with the patterns from Methods vs Functions, Hexagonal Architecture, and DDD already covered in this section, and the cross-package method limitation becomes a design constraint that pushes toward cleaner abstractions rather than friction.
