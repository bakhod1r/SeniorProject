# Cross-Package Methods — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Wrapper Type Pattern, In Depth](#the-wrapper-type-pattern-in-depth)
3. [Method Set of a Wrapper Type](#method-set-of-a-wrapper-type)
4. [Conversion Cost — Theoretically Zero](#conversion-cost-theoretically-zero)
5. [Wrapper vs Embedding — Side-By-Side](#wrapper-vs-embedding-side-by-side)
6. [Free Function vs Wrapper Decision](#free-function-vs-wrapper-decision)
7. [Wrapping Pointer Types](#wrapping-pointer-types)
8. [Wrapping Slice and Map Types](#wrapping-slice-and-map-types)
9. [Cross-Package Constructors](#cross-package-constructors)
10. [Methods on Aliases — What Compiles, What Does Not](#methods-on-aliases-what-compiles-what-does-not)
11. [Built-in Types Follow the Same Rule](#built-in-types-follow-the-same-rule)
12. [Refactoring an Existing Codebase to Use a Wrapper](#refactoring-an-existing-codebase-to-use-a-wrapper)
13. [Patterns and Anti-Patterns](#patterns-and-anti-patterns)
14. [Code Review Checklist](#code-review-checklist)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you learned the rule and three workarounds. At the middle level the questions become structural:

- Which workaround fits which situation?
- What happens to the method set of a wrapper?
- Does converting `time.Time(mt)` cost anything at runtime?
- When should you wrap a pointer instead of a value?
- How do you migrate code from "uses `time.Time` directly" to "uses `MyTime`"?

This file answers each of them.

---

## The Wrapper Type Pattern, In Depth

A wrapper type is a defined type whose underlying type is a foreign type:

```go
package myapp

import "time"

type MyTime time.Time
```

That single line creates a brand-new type:

- `MyTime` and `time.Time` have the **same memory layout**.
- `MyTime` and `time.Time` are **distinct types** in Go's type system.
- `MyTime` has **no methods** initially — defined types do not inherit methods from their underlying type.

You then attach the methods you want:

```go
func (t MyTime) IsWeekend() bool {
    wd := time.Time(t).Weekday()
    return wd == time.Saturday || wd == time.Sunday
}

func (t MyTime) Format(layout string) string {
    return time.Time(t).Format(layout)
}

func (t MyTime) String() string {
    return time.Time(t).Format(time.RFC3339)
}
```

Notice the recurring pattern: convert `MyTime → time.Time`, call the foreign method, return.

### Forwarding boilerplate

If you only need a few methods, forwarding by hand is fine. If you need every method `time.Time` has — switch to embedding. The wrapper-type pattern shines when the method set is small and chosen on purpose.

---

## Method Set of a Wrapper Type

This is the most important rule to internalize:

> A defined type **does not** inherit methods from its underlying type.

```go
package myapp

import "time"

type MyTime time.Time

func main() {
    t := MyTime(time.Now())
    // t.Year()        // compile error — MyTime has no Year method
    // t.Format(...)   // compile error
    time.Time(t).Year() // OK — convert first
}
```

The `time.Time` value still has all of `time.Time`'s methods. `MyTime` is a separate type with its own (initially empty) method set.

### Implication for interfaces

If `time.Time` satisfies `fmt.Stringer` (via its `String()` method), `MyTime` does **not** automatically satisfy `fmt.Stringer`. You either:

1. Define `String()` on `MyTime` explicitly, or
2. Use the embedding workaround (which promotes `String()`).

```go
type MyTime time.Time
// var _ fmt.Stringer = MyTime{} // compile error — no String method
```

Compare to embedding:

```go
type EmbeddedTime struct { time.Time }
var _ fmt.Stringer = EmbeddedTime{} // OK — promoted String
```

This is the single biggest practical difference between the two patterns. Senior file goes deeper.

---

## Conversion Cost — Theoretically Zero

```go
mt := MyTime(time.Now())
back := time.Time(mt)
```

These conversions are **free at runtime**. They produce no machine code beyond what the surrounding statements already require. The compiler tracks the type label, but the bits never move.

You can verify this with the assembly view:

```bash
go build -gcflags='-S' main.go 2>&1 | grep -A2 'main.foo'
```

You will see no MOV/COPY beyond what the surrounding code does on a `time.Time` directly.

### "Theoretically zero" — when does it cost something?

Conversions can produce work in a few specific cases:

- Converting between types of **different layout** (not applicable to defined-type wrappers — they always share layout).
- Converting `[]byte ↔ string` — these have the same layout but Go allocates because of immutability.
- Converting interface ↔ concrete type — runtime type check.

For a defined-type wrapper of a struct or a primitive, `MyT(x)` and `T(mx)` are always free. This is what makes the pattern viable for hot paths.

---

## Wrapper vs Embedding — Side-By-Side

### Wrapper — `type MyT T`

```go
type MyTime time.Time

func (t MyTime) IsWeekend() bool { /* ... */ }

func (t MyTime) Format(layout string) string {
    return time.Time(t).Format(layout) // forwarded by hand
}

mt := MyTime(time.Now())
mt.IsWeekend()       // your method
mt.Format(time.RFC3339) // forwarded
```

**Pros**: same layout, free conversion, drop-in for callers that take a `time.Time` after explicit conversion, controlled method set.

**Cons**: must forward every method you want callable directly; methods of the underlying type do not appear unless you forward them.

### Embedding — `type S struct { T }`

```go
type EnrichedTime struct {
    time.Time
    Note string
}

func (e EnrichedTime) IsWeekend() bool { /* ... */ }

et := EnrichedTime{Time: time.Now(), Note: "n"}
et.IsWeekend()       // your method
et.Format(time.RFC3339) // promoted automatically
```

**Pros**: all foreign methods promoted automatically; can add new fields.

**Cons**: not a free conversion — `EnrichedTime` is a struct that contains `time.Time`, not the same layout (unless it has only the embedded field); you cannot directly convert `time.Time` to `EnrichedTime`; size grows with extra fields.

### Side-by-side decision

| Concern | Wrapper | Embedding |
|---|---|---|
| Same memory layout as `T` | Yes | Only if no extra fields and unnamed field is the only field |
| All methods of `T` available | No (must forward) | Yes (promoted) |
| Add new fields | No (you replace `T` entirely) | Yes |
| Add new methods | Yes | Yes |
| Conversion `T(x)` works | Yes (free) | No (need `S{T: x}` literal) |
| Method set explicit | Yes | No (you get whatever the embedded type has) |
| Drop-in for APIs taking `T` | Yes (after conversion) | No (different concrete type) |

---

## Free Function vs Wrapper Decision

Go programmers reach for a free function more often than they think. The decision boils down to syntax preference and reuse:

```go
// Free function
func IsWeekend(t time.Time) bool {
    wd := t.Weekday()
    return wd == time.Saturday || wd == time.Sunday
}

// Wrapper method
type MyTime time.Time
func (t MyTime) IsWeekend() bool { /* same logic */ }
```

Use a **free function** when:
- The helper is used once or twice.
- You do not want to convert at every call site.
- The helper has no obvious "owner" type.
- You are extending a pure value (e.g. `net.IP`) with a single check.

Use a **wrapper** when:
- You will attach multiple methods to the same logical concept.
- You want method-call syntax (`t.IsWeekend()`) and chaining.
- The wrapper carries domain meaning (`type Temperature float64`).
- You need to satisfy an interface that the foreign type does not satisfy.

Many real codebases use **both**: a wrapper for the domain concept, and free helper functions for one-off computations.

---

## Wrapping Pointer Types

You can wrap pointer types, but the result is usually awkward:

```go
import "net/http"

type RetryClient *http.Client

// func (c RetryClient) Do(...)  // compile error — receiver base type cannot be a pointer
```

The Go spec forbids pointer types as receiver base types. So this rarely works the way beginners hope.

The standard pattern is to **embed `*http.Client` in a struct**:

```go
type RetryClient struct {
    *http.Client
    MaxRetries int
}

func (c *RetryClient) DoWithRetry(req *http.Request) (*http.Response, error) {
    for i := 0; i <= c.MaxRetries; i++ {
        resp, err := c.Do(req) // promoted from *http.Client
        if err == nil { return resp, nil }
    }
    return nil, errors.New("retry exhausted")
}
```

This gives you all of `*http.Client`'s methods (via promotion) and your own `DoWithRetry`. The struct itself is small (one pointer + one int).

---

## Wrapping Slice and Map Types

Wrappers work nicely on slices and maps too. The standard library uses this pattern internally — `sort.IntSlice`, `sort.StringSlice`:

```go
package sort

type IntSlice []int

func (s IntSlice) Len() int           { return len(s) }
func (s IntSlice) Less(i, j int) bool { return s[i] < s[j] }
func (s IntSlice) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }
```

You can extend a foreign slice type the same way:

```go
import "net"

type IPList []net.IP

func (l IPList) Filter(predicate func(net.IP) bool) IPList {
    var out IPList
    for _, ip := range l {
        if predicate(ip) { out = append(out, ip) }
    }
    return out
}
```

Same idea: build a defined type on top of a foreign-element slice, then attach methods.

---

## Cross-Package Constructors

Wrapper types usually need a constructor to keep call sites clean:

```go
package myapp

import "time"

type Timestamp time.Time

func NewTimestamp(t time.Time) Timestamp { return Timestamp(t) }
func Now() Timestamp                      { return Timestamp(time.Now()) }

// Usage
ts := myapp.Now()
ts2 := myapp.NewTimestamp(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
```

Constructors are normal Go functions — no rule prevents them. They keep the conversion `Timestamp(t)` out of the caller's code.

---

## Methods on Aliases — What Compiles, What Does Not

The single character `=` switches between "alias" and "defined type". Here is the full table:

| Declaration | Meaning | Methods on local declarations? |
|---|---|---|
| `type X = int` | Alias for built-in | No (int is universe-scoped) |
| `type X int` | Defined type from int | Yes |
| `type X = time.Time` | Alias for foreign type | No (foreign owner) |
| `type X time.Time` | Defined type from foreign | Yes |
| `type X = MyLocal` (current package) | Alias | Methods declared on `X` are methods on `MyLocal` |
| `type X MyLocal` (current package) | Defined type | Yes |

The rule is: **aliases are transparent** — methods declared "on the alias" are actually methods on the original type. If the original type lives elsewhere, that is forbidden. If the original type is local, the methods are added to it.

```go
package myapp

type Local struct{}
type LocalAlias = Local

func (l LocalAlias) M() {} // OK — equivalent to func (l Local) M()
```

The above compiles, but it is confusing. Most code reviewers will ask you to write `func (l Local) M()` directly.

### Generic type alias (Go 1.24+)

Go 1.24 introduced generic type aliases:

```go
type StringMap[V any] = map[string]V
```

Methods on `StringMap` are not allowed for two reasons:
1. It is an alias — same restriction as ordinary aliases.
2. The underlying type is `map[string]V`, which is a built-in composite type from the universe.

You have to define a new type:

```go
type StringMap[V any] map[string]V

func (m StringMap[V]) Keys() []string {
    out := make([]string, 0, len(m))
    for k := range m {
        out = append(out, k)
    }
    return out
}
```

---

## Built-in Types Follow the Same Rule

Built-in types like `int`, `string`, `[]byte`, and `map[K]V` belong to the **universe block** — an implicit "package" outside any user package. They are non-local for everyone.

```go
func (s string) Reverse() string { return s } // compile error
```

The fix is identical to the foreign-package case:

```go
type Reversible string
func (r Reversible) Reverse() Reversible { /* ... */ return r }
```

Or a free function, if the operation is one-off:

```go
func Reverse(s string) string { /* ... */ return s }
```

This is why the standard library has both `strings.ToUpper(s)` (free function) and `bytes.Buffer.WriteString(s)` (method on a defined type).

---

## Refactoring an Existing Codebase to Use a Wrapper

Suppose your code uses `time.Time` everywhere and you decide a domain-typed `Timestamp` is cleaner. The migration plan:

### Step 1 — Define the wrapper

```go
package myapp

import "time"

type Timestamp time.Time
```

### Step 2 — Define methods you need

```go
func (t Timestamp) IsWeekend() bool { /* ... */ return false }
func (t Timestamp) Format(layout string) string { return time.Time(t).Format(layout) }
```

### Step 3 — Add a constructor

```go
func NewTimestamp(t time.Time) Timestamp { return Timestamp(t) }
```

### Step 4 — Migrate call sites incrementally

Old code:

```go
func Schedule(t time.Time) { /* ... */ }
```

New code (transitional — accepts both):

```go
func Schedule(t time.Time) {
    ScheduleAt(NewTimestamp(t))
}

func ScheduleAt(t Timestamp) {
    // new logic uses Timestamp methods
}
```

### Step 5 — Update boundaries (JSON, SQL, etc.)

If the original `time.Time` had specific marshaling behavior, your wrapper must replicate it. (The senior file covers this in detail.)

```go
func (t Timestamp) MarshalJSON() ([]byte, error) {
    return time.Time(t).MarshalJSON()
}
func (t *Timestamp) UnmarshalJSON(b []byte) error {
    var inner time.Time
    if err := inner.UnmarshalJSON(b); err != nil { return err }
    *t = Timestamp(inner)
    return nil
}
```

### Step 6 — Deprecate the old function

```go
// Deprecated: use ScheduleAt instead.
func Schedule(t time.Time) { ScheduleAt(NewTimestamp(t)) }
```

### Step 7 — Remove

In the next major version, drop the old function.

This 7-step pattern works for any "introduce a wrapper" migration.

---

## Patterns and Anti-Patterns

### Pattern: Wrapper + free helper combination

```go
package myapp

import "time"

type Timestamp time.Time

func (t Timestamp) Day() int { return time.Time(t).Day() }

// Free function for cross-cutting concerns
func DurationBetween(a, b Timestamp) time.Duration {
    return time.Time(b).Sub(time.Time(a))
}
```

A clean separation: methods for type-bound behavior, free functions for relational operations.

### Pattern: Wrapper with explicit `Unwrap`

```go
type Timestamp time.Time
func (t Timestamp) Unwrap() time.Time { return time.Time(t) }
```

Some codebases prefer an explicit `Unwrap()` method over scattered `time.Time(t)` conversions. Both work; pick one and be consistent.

### Anti-pattern: Half-wrapper

```go
type Timestamp time.Time
func (t Timestamp) Day() int { return time.Time(t).Day() }
// no Format, no Unix, no Sub — but callers still need them
```

A wrapper that exposes only some of the foreign type's methods, leaving callers to convert to the original type at half their call sites. Pick one of two approaches:
1. Forward every method you intend to use, OR
2. Switch to embedding so all methods promote automatically.

### Anti-pattern: Wrapping a pointer-receiver-heavy type by value

```go
import "bytes"

type MyBuffer bytes.Buffer
// (mb MyBuffer).Write(...) // mb is a copy — the original Buffer is unaffected
```

`bytes.Buffer` has pointer-receiver methods because it mutates internal state. Wrapping it by value and forwarding does not work as expected:

```go
func (b MyBuffer) Write(p []byte) (int, error) {
    return (&bytes.Buffer{}).Write(p) // wrong — writes to a fresh buffer
}
```

Either embed (`type MyBuffer struct { *bytes.Buffer }`) or wrap a pointer (`type MyBuffer = *bytes.Buffer` — but then no methods).

The right answer is usually embedding for mutating types.

### Anti-pattern: Forgetting to convert in a method

```go
type MyTime time.Time
func (t MyTime) Hour() int {
    return t.Hour() // infinite recursion — t.Hour() calls itself
}
```

This compiles. It also stack-overflows at runtime. The fix: convert.

```go
func (t MyTime) Hour() int { return time.Time(t).Hour() }
```

---

## Code Review Checklist

When reviewing a wrapper type:

- [ ] Is the declaration `type X T` (defined) and not `type X = T` (alias)?
- [ ] Do methods convert via `T(x)` to call foreign methods?
- [ ] Is the method set explicit and complete for the wrapper's intended use?
- [ ] Does the wrapper need to satisfy interfaces? Are those satisfied by methods declared on the wrapper itself?
- [ ] If JSON, SQL, or other marshal interfaces are needed, are they forwarded?
- [ ] Is there a constructor (`NewX(...)`) to keep call sites clean?
- [ ] If the foreign type has pointer-receiver methods that mutate, is the wrapper using embedding instead?
- [ ] Is the conversion in a hot path? (Defined-type conversions are free; do not worry about it.)

---

## Cheat Sheet

```
WRAPPER PATTERN
────────────────────────────────────
type MyT T                  → defined type
func (m MyT) M()            → method on wrapper
MyT(t) and T(mt)            → free conversions
no method inheritance       → forward what you need
no interface inheritance    → re-declare on wrapper

EMBEDDING PATTERN
────────────────────────────────────
type S struct { T; ... }    → embed foreign type
S.M() works for all T's M   → promoted automatically
S{T: x}                     → construction
new fields allowed          → cannot drop-in for T

ALIAS — NOT A WORKAROUND
────────────────────────────────────
type X = T                  → alias
methods on X = methods on T → forbidden if T is non-local
generic alias (1.24+)       → same restriction

DECISION (MIDDLE LEVEL)
────────────────────────────────────
1 helper, no state        → free function
add many methods          → defined wrapper type
need ALL T's methods + extras → embedding
mutating type             → embedding (or pointer)
```

---

## Summary

The wrapper type is the workhorse of cross-package method extensions:

- A defined type built on top of a foreign type — `type MyTime time.Time`.
- Conversion `MyTime(t)` and `time.Time(mt)` is free at runtime.
- The wrapper has an **empty method set** initially — you forward what you want.
- It does **not** automatically satisfy interfaces the original type satisfies.

When wrapping is awkward — many methods to forward, mutating semantics — use **struct embedding**. When the operation is one-off, use a **free function**. Aliases (`type X = Y`) cannot grow new methods.

In `senior.md` we go further: interface satisfaction implications across the whole standard library, the JSON/SQL marshal forwarding problem, and how generics interact with cross-package methods.
