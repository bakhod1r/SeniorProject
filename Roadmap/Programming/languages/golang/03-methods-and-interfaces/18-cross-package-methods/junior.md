# Cross-Package Methods — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Rule, Stated Plainly](#the-rule-stated-plainly)
5. [Why The Rule Exists](#why-the-rule-exists)
6. [What Compile Errors Look Like](#what-compile-errors-look-like)
7. [Workaround 1 — Defined Wrapper Type](#workaround-1-defined-wrapper-type)
8. [Workaround 2 — Free Function](#workaround-2-free-function)
9. [Workaround 3 — Struct Embedding](#workaround-3-struct-embedding)
10. [Type Alias Is NOT a Workaround](#type-alias-is-not-a-workaround)
11. [Conversion Syntax](#conversion-syntax)
12. [Real-World Examples](#real-world-examples)
13. [Decision Sketch (Beginner Version)](#decision-sketch-beginner-version)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Self-Assessment Checklist](#self-assessment-checklist)
17. [Summary](#summary)

---

## Introduction

> Focus: "Why can't I add a method to `time.Time`?" and "What do I do instead?"

Here is one of the first surprises a Go beginner runs into. You have learned how to write methods. You write a struct, attach `Area()`, and everything works. Then you try the same trick on `time.Time`:

```go
import "time"

func (t time.Time) IsWeekend() bool { // compile error
    wd := t.Weekday()
    return wd == time.Saturday || wd == time.Sunday
}
```

The compiler refuses with a sharp message:

```
cannot define new methods on non-local type time.Time
```

This is not a bug in your IDE. It is a deliberate Go language rule: **methods can only be declared on types that live in the SAME package as the method itself**. `time.Time` lives in `time`, your code lives in `main` — you are not allowed to attach a method to it.

This file teaches you the rule, the reason behind it, and the three standard workarounds: a **wrapper type**, a **free function**, and **struct embedding**.

After reading this file you will:
- Understand the cross-package method restriction
- Know why the rule exists (collision avoidance)
- Be able to apply the wrapper-type workaround
- Be able to apply the free-function workaround
- Be able to apply the embedding workaround
- Know that `type X = Y` (alias) is NOT a workaround

---

## Prerequisites
- Basics of Go syntax (variables, functions)
- A working `struct` understanding
- Familiarity with declaring methods (`func (t T) M() ...`)
- Awareness that `time.Time` lives in the `time` package
- Ability to import packages and call their functions

---

## Glossary

| Term | Definition |
|--------|--------|
| **Local type** | A type declared in the current package |
| **Non-local type** | A type imported from another package |
| **Defined type** | A new type declared with `type Name Underlying` |
| **Type alias** | A new name for the same type, declared with `type Name = Other` |
| **Wrapper type** | A defined type whose underlying type is a foreign type |
| **Free function** | A package-level function — not a method |
| **Embedding** | Including a type as an unnamed field in a struct |
| **Conversion** | Changing a value's type without changing its bits — `MyTime(t)` |
| **Receiver base type** | The type written between `func` and the method name |
| **Method promotion** | Methods of an embedded type becoming callable on the outer type |

---

## The Rule, Stated Plainly

The Go specification's rule is short:

> The receiver base type ... must be a defined type defined in the **same package** as the method.

Three implications follow:

1. You cannot add a method to `time.Time`, `http.Client`, `net.IP`, `sql.NullString`, or any other type from an imported package.
2. You cannot add a method to built-in types (`int`, `string`, `[]byte`) — they live in the implicit "universe" package, not yours.
3. You cannot add a method through a type alias (`type X = time.Time`), because aliases do not create a new local type.

Allowed:

```go
package myapp

type User struct{ Name string }

func (u User) Greet() string { return "Hi, " + u.Name } // OK — same package
```

Not allowed:

```go
package myapp

import "time"

func (t time.Time) IsWeekend() bool { return false } // compile error
```

---

## Why The Rule Exists

Imagine the rule did not exist. Two unrelated packages could each add their own `String()` method to `time.Time`:

```go
package pkga
func (t time.Time) String() string { return "A" }

package pkgb
func (t time.Time) String() string { return "B" }
```

Now any program importing both packages has two methods of the same name on the same type. Which one wins? There is no good answer — the program would either be ambiguous, or its behavior would silently depend on import order, or it would break the moment a third party changed their methods.

Go avoids this problem at the source. **The owner of a type owns its methods.** If you want to extend behavior, you wrap or compose — you do not reach across the package boundary.

A second benefit: methods stay close to the data they describe. When you read the `time` package source, you see every method on `time.Time` in one place. No hidden methods declared "somewhere else in the program" can surprise you.

---

## What Compile Errors Look Like

Recognize these messages early — they all describe the same restriction.

### Foreign struct type

```go
import "time"

func (t time.Time) IsWeekend() bool { return false }
// cannot define new methods on non-local type time.Time
```

### Built-in type

```go
func (s string) Reverse() string { return s }
// cannot define new methods on non-local type string
```

### Pointer to a foreign type

```go
import "net/http"

func (c *http.Client) WithRetry() *http.Client { return c }
// cannot define new methods on non-local type http.Client
```

### Through an alias

```go
import "time"

type T = time.Time
func (t T) IsWeekend() bool { return false }
// cannot define new methods on non-local type time.Time
```

The compiler always traces the alias back to its original package and rejects the declaration.

---

## Workaround 1 — Defined Wrapper Type

The most common solution: declare your own type whose **underlying type** is the foreign type.

```go
package myapp

import "time"

// Defined wrapper type — note: NO equals sign
type MyTime time.Time

// Now you can attach methods — MyTime is local
func (t MyTime) IsWeekend() bool {
    wd := time.Time(t).Weekday()
    return wd == time.Saturday || wd == time.Sunday
}

func main() {
    t := MyTime(time.Now())
    if t.IsWeekend() {
        // ...
    }
}
```

Three things to notice:

1. `type MyTime time.Time` — no `=` sign. This creates a **new defined type**.
2. `MyTime(time.Now())` — explicit conversion from `time.Time` to `MyTime`.
3. Inside the method we convert back: `time.Time(t)` — to call `time.Time`'s own methods.

The conversion is **free**: it does not copy the data structure in any meaningful way; it only changes how the compiler thinks about the bits. Both `MyTime` and `time.Time` have the same memory layout.

### A second example — wrapping a primitive

```go
package myapp

type UserID int64

func (u UserID) IsValid() bool { return u > 0 }
func (u UserID) String() string { return "user_" + intToStr(int64(u)) }
```

`UserID` is a defined type built on top of `int64`. You cannot add `IsValid()` to `int64` itself, but you can add it to `UserID`.

---

## Workaround 2 — Free Function

If a method-like operation is not on the critical path of a "natural" type, simply write a package-level function.

```go
package myapp

import "time"

// FormatRFC3339 — a free function that takes time.Time as an argument
func FormatRFC3339(t time.Time) string {
    return t.Format(time.RFC3339)
}

// IsWeekend — same pattern
func IsWeekend(t time.Time) bool {
    wd := t.Weekday()
    return wd == time.Saturday || wd == time.Sunday
}
```

Calling site:

```go
now := time.Now()
fmt.Println(FormatRFC3339(now))
fmt.Println(IsWeekend(now))
```

This is the Go-style answer to "I just need one helper for `time.Time`". You do not need a wrapper type, you do not need embedding — you need a function.

### When the function form is best

- Single, isolated helper (`FormatRFC3339`)
- Stateless transform (`UpperCaseIP(net.IP) string`)
- The function has no obvious "owner" type
- You do not want to change the call-site pattern from `Foo(x)` to `x.Foo()`

---

## Workaround 3 — Struct Embedding

Embed the foreign type inside a struct of your own. Embedded methods are **promoted**, so callers can still use the original methods, and you can add new ones.

```go
package myapp

import "time"

// EnrichedTime is a local struct that embeds time.Time
type EnrichedTime struct {
    time.Time
    Note string
}

// Add a new method
func (e EnrichedTime) IsWeekend() bool {
    wd := e.Weekday() // promoted from time.Time
    return wd == time.Saturday || wd == time.Sunday
}

func main() {
    e := EnrichedTime{Time: time.Now(), Note: "meeting"}
    fmt.Println(e.Format(time.RFC3339)) // promoted Format from time.Time
    fmt.Println(e.IsWeekend())          // your new method
}
```

What you gain:
- All `time.Time` methods are still callable on `e` (promotion).
- You can add new methods.
- You can add new fields (`Note string`).

What you lose, compared to the wrapper-type workaround:
- The struct is not directly convertible from `time.Time` — you have to construct it: `EnrichedTime{Time: t}`.
- The size grows by the size of the additional fields.
- The struct is no longer drop-in for an API expecting `time.Time` itself.

---

## Type Alias Is NOT a Workaround

Beginners often try this:

```go
import "time"

type Time = time.Time // alias — note the = sign

func (t Time) IsWeekend() bool { return false } // compile error
```

The compiler still rejects the method. The reason: `type Time = time.Time` does **not** create a new type — `Time` and `time.Time` are the **same** type, just with two names. Methods on `Time` would actually be methods on `time.Time`, and `time.Time` is non-local.

Compare:

| Declaration | Creates new type? | Methods can be added? |
|---|---|---|
| `type X = time.Time` (alias) | No | No |
| `type X time.Time` (defined) | Yes | Yes |

The single-character difference (`=` vs no `=`) decides everything.

### Generic type alias — same restriction

Go 1.24 added generic type aliases. They do not change this rule:

```go
// Go 1.24+
type MyMap[K comparable, V any] = map[K]V

// Still cannot add methods — MyMap is an alias, not a new type
```

---

## Conversion Syntax

You will see two conversions over and over: into your wrapper, and back out.

```go
import "time"

type MyTime time.Time

now := time.Now()

// time.Time → MyTime
mt := MyTime(now)

// MyTime → time.Time
back := time.Time(mt)
```

Conversions are allowed when the **underlying types are identical**, which is always the case between a defined type and its base.

Inside a method, you typically need to convert in order to use the foreign type's methods:

```go
func (t MyTime) Format(layout string) string {
    return time.Time(t).Format(layout) // call time.Time's Format
}
```

This is a small price. The bits are the same — the conversion is purely a compile-time relabel.

---

## Real-World Examples

### Example 1 — `pq.NullTime`

The `lib/pq` PostgreSQL driver wraps `time.Time` to support nullable database columns:

```go
type NullTime struct {
    Time  time.Time
    Valid bool
}

func (nt *NullTime) Scan(value interface{}) error { /* ... */ }
func (nt NullTime) Value() (driver.Value, error)  { /* ... */ }
```

`pq.NullTime` cannot add `Scan` or `Value` directly to `time.Time` — it lives in another package. Wrapping is the only path.

### Example 2 — `sql.NullString`

The standard library does the same for nullable strings:

```go
type NullString struct {
    String string
    Valid  bool
}

func (ns *NullString) Scan(value interface{}) error { /* ... */ }
func (ns NullString) Value() (driver.Value, error)  { /* ... */ }
```

Same idea: a struct that embeds the underlying value plus a flag, with new methods attached.

### Example 3 — Custom `Duration`

Many projects need a `Duration` that round-trips through JSON as `"5m"` instead of nanoseconds. The standard library's `time.Duration` does not implement `MarshalJSON` — and you cannot add it from outside.

```go
package myapp

import (
    "time"
    "encoding/json"
)

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
    if err != nil { return err }
    *d = Duration(parsed)
    return nil
}
```

The wrapper unlocks JSON behavior that `time.Duration` itself does not provide.

---

## Decision Sketch (Beginner Version)

The full decision tree appears in the middle/senior files. For a beginner, this short form is enough:

```
Do you need a method on a foreign type?
│
├─ It is a one-off helper, no state, no chaining → free function
│
├─ You want method-call syntax (t.IsWeekend()) and the
│  type is essentially "the foreign type, with extras" → defined wrapper type
│
└─ You want to keep ALL the foreign methods AND add fields → struct embedding
```

---

## Common Mistakes

| Mistake | Symptom | Fix |
|------|-------|--------|
| `type X = time.Time` and adding methods | Compile error | Drop `=`: `type X time.Time` |
| Forgetting conversion inside the method | "method has no method called X" | Convert: `time.Time(t).X()` |
| Trying to add a method to `*http.Client` | Same compile error as on the value type | Wrap or use a free function |
| Wrapping `time.Time` and losing JSON behavior | JSON output is wrong | Forward `MarshalJSON`/`UnmarshalJSON` (covered later) |
| Using embedding when a wrapper would do | Larger struct, awkward construction | Switch to `type MyT time.Time` |

---

## Tricky Points

### 1. The wrapper does NOT inherit methods

A defined wrapper type does **not** automatically get `time.Time`'s methods:

```go
type MyTime time.Time

mt := MyTime{}
// mt.Format(time.RFC3339) // compile error — MyTime has no Format method
time.Time(mt).Format(time.RFC3339) // OK — convert first
```

This is the one place embedding wins: an embedded `time.Time` does promote `Format`.

### 2. Pointer wrapper

You can wrap pointer types too:

```go
type MyClient *http.Client
```

But this is rarely useful — you cannot add a method that "owns" `*http.Client` semantics, and the pointer is now opaque to readers. Most real code wraps the value type or embeds.

### 3. Conversion is a one-line dance, but it is mandatory

Every time you cross between `MyTime` and `time.Time` you write a conversion. After a few hours of writing wrapper methods, the dance becomes muscle memory.

---

## Self-Assessment Checklist

- [ ] I can state the cross-package method restriction in one sentence
- [ ] I can explain why the rule exists (collision avoidance)
- [ ] I know that `type X = Y` (alias) cannot have new methods
- [ ] I know that `type X Y` (defined) can have new methods
- [ ] I can write a wrapper type with `MyTime(t)` and `time.Time(mt)` conversions
- [ ] I can decide between wrapper, free function, and embedding for a simple case
- [ ] I recognize the compile error message "cannot define new methods on non-local type"
- [ ] I have seen real examples (`sql.NullString`, custom `Duration`)

---

## Summary

The cross-package method rule is a single, small constraint with large consequences:

> A method's receiver base type must be a **defined type in the current package**. Foreign types — including built-ins — are off-limits.

This rule prevents method collisions, keeps types' behavior visible in one place, and pushes Go programmers toward three patterns:

1. **Wrapper type** — `type MyTime time.Time` plus methods plus conversion. Best when you want `t.Method()` syntax on something that is essentially the foreign type.
2. **Free function** — `func FormatRFC(t time.Time) string`. Best for one-off helpers.
3. **Struct embedding** — `type X struct { time.Time; ... }`. Best when you want to keep all original methods AND add fields.

A type alias (`type X = Y`) is **not** a workaround — aliases share the original type and inherit its same restriction.

In the next file (`middle.md`) we go deep into the wrapper-type pattern: when conversion costs anything, what happens to the method set, and how the wrapper interacts with embedding.
