# Sealed Interfaces — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

A "sealed interface" in Go is a pattern: an interface declares an unexported method (the "seal") so that only types inside the package can satisfy it. Callers outside the package must use one of the known variants — they cannot invent new ones. The pattern is fragile in subtle ways. Below are the most common bugs.

---

## Bug 1 — New variant forgets the seal method

```go
package shape

type Shape interface {
    Area() float64
    isShape() // unexported seal
}

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14 * c.R * c.R }
func (c Circle) isShape()      {}

type Square struct{ S float64 }
func (s Square) Area() float64 { return s.S * s.S }
// forgot isShape()

type Triangle struct{ B, H float64 }
func (t Triangle) Area() float64 { return t.B * t.H / 2 }
func (t Triangle) isShape()      {}

func Describe(s Shape) string { return "shape" }

func main() {
    Describe(Square{S: 2}) // ?
}
```

**Hint:** Examine the method set of each variant.

**Bug:** `Square` does not implement `isShape()`, so it does not satisfy `Shape`. Compile error: `Square does not implement Shape (missing method isShape)`. The seal is doing exactly what it should — but the author of `Square` simply forgot the boilerplate. In a large package with many variants this omission is easy to miss in review.

**Fix:**

```go
func (s Square) isShape() {}
```

A common discipline is to put a compile-time assertion right next to the variant so the omission is caught at the file level:

```go
var _ Shape = Square{}
```

If `Square` is missing `isShape`, that single line fails to compile and points directly at the offender.

---

## Bug 2 — Seal method accidentally exported

```go
package event

type Event interface {
    Timestamp() int64
    IsEvent() // EXPORTED seal — bug
}

type Login struct{ At int64 }
func (l Login) Timestamp() int64 { return l.At }
func (l Login) IsEvent()         {}

type Logout struct{ At int64 }
func (l Logout) Timestamp() int64 { return l.At }
func (l Logout) IsEvent()         {}
```

A consumer in another package writes:

```go
package evil

import "myapp/event"

type Hack struct{}
func (Hack) Timestamp() int64 { return 0 }
func (Hack) IsEvent()         {} // perfectly legal

var _ event.Event = Hack{} // compiles!
```

**Hint:** Who is allowed to call `IsEvent`?

**Bug:** The seal is the entire point of the pattern, but it only works while it is unexported. With a capital `I` it becomes part of the public API. Any outside type can satisfy `event.Event` simply by declaring an `IsEvent()` method, defeating the exhaustive type-switch invariant downstream.

**Fix:** Make the seal lowercase so it is only callable inside the defining package.

```go
type Event interface {
    Timestamp() int64
    isEvent()
}
```

Outside packages can still hold and pass `event.Event` values, but they can no longer invent new variants.

---

## Bug 3 — Type switch silently falls through

```go
package payment

type Method interface{ isMethod() }

type Card struct{ Number string }
func (Card) isMethod() {}

type Bank struct{ IBAN string }
func (Bank) isMethod() {}

type Crypto struct{ Wallet string }
func (Crypto) isMethod() {}

func Charge(m Method, amount int) error {
    switch v := m.(type) {
    case Card:
        return chargeCard(v, amount)
    case Bank:
        return chargeBank(v, amount)
    default:
        // Crypto silently falls in here
        return nil
    }
}
```

**Hint:** What happens with a `Crypto` value at runtime?

**Bug:** The author forgot the `Crypto` case. Because there is a `default` branch returning `nil`, every crypto payment is silently treated as "successful" while no money is actually charged. The compiler cannot help — Go has no exhaustiveness check for type switches.

**Fix 1 — handle every variant explicitly and panic on the unknown:**

```go
switch v := m.(type) {
case Card:
    return chargeCard(v, amount)
case Bank:
    return chargeBank(v, amount)
case Crypto:
    return chargeCrypto(v, amount)
default:
    panic(fmt.Sprintf("payment: unhandled method %T", v))
}
```

**Fix 2 — run an exhaustiveness linter:**

```
exhaustive ./...
```

Mark the switch with `//exhaustive:enforce` (or use a build tag) and CI fails the moment a new variant slips through.

---

## Bug 4 — External package embeds the concrete variant

```go
package shape

type Shape interface {
    Area() float64
    isShape()
}

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14 * c.R * c.R }
func (c Circle) isShape()      {}
```

```go
package draw

import "myapp/shape"

// Embeds the exported concrete type — and so inherits its method set
type DashedCircle struct{ shape.Circle }

func (d DashedCircle) Style() string { return "dashed" }

var _ shape.Shape = DashedCircle{} // compiles — the seal is bypassed
```

**Hint:** What does Go do with promoted methods from an embedded field?

**Bug:** Embedding promotes the embedded type's methods, including the unexported `isShape()`. The promoted method retains its identity — it still belongs to package `shape` — so it counts as the seal. The result: an outside package created a brand-new variant by embedding, and downstream `switch m.(type)` blocks have no `case DashedCircle` and will fall through.

**Fix:** Do not export the concrete struct types when sealing matters. Expose constructors only and keep the structs unexported, or expose the interface and a small set of factory functions.

```go
// shape package
type circle struct{ r float64 }
func (c circle) Area() float64 { return 3.14 * c.r * c.r }
func (c circle) isShape()      {}

func NewCircle(r float64) Shape { return circle{r: r} }
```

Now `draw.DashedCircle` cannot embed `shape.circle` (unexported), and the seal holds.

---

## Bug 5 — Variant defined in a different package

```go
// package shape
type Shape interface {
    Area() float64
    isShape()
}
```

```go
// package extras
import "myapp/shape"

type Hex struct{ S float64 }
func (h Hex) Area() float64 { return 2.598 * h.S * h.S }
func (h Hex) isShape()      {} // ?
```

**Hint:** Identifiers in Go include the package they came from.

**Bug:** Newcomers expect "I implemented every method on the interface, so I satisfy it." They get a confusing compile error:

```
Hex does not implement shape.Shape (missing method isShape)
```

The error is slightly misleading because the method *looks* present. The reason: `isShape` declared in package `extras` is a different identifier from `isShape` declared in package `shape`. The interface lists `shape.isShape`; only methods declared inside `shape` can match it. This is exactly the property the pattern relies on.

**Fix:** Move the variant inside the sealing package, or re-design — perhaps add an `Extend` mechanism with an explicit registration API. There is no syntactic workaround: that is the whole point of the pattern.

---

## Bug 6 — Nil sealed interface vs typed-nil variant

```go
package result

type Result interface{ isResult() }

type Ok struct{ Value int }
func (Ok) isResult() {}

type Err struct{ Msg string }
func (*Err) isResult() {} // pointer receiver

func Handle(r Result) {
    if r == nil {
        fmt.Println("nothing")
        return
    }
    switch v := r.(type) {
    case Ok:
        fmt.Println("ok", v.Value)
    case *Err:
        fmt.Println("err", v.Msg)
    }
}

func main() {
    var e *Err
    Handle(e) // ?
}
```

**Hint:** Read about "typed nil" interface values.

**Bug:** `Handle(e)` passes a typed-nil — the interface value `r` has type `*Err` and value `nil`. The check `r == nil` is **false** (the interface is non-nil because the type half is set). Execution continues into the switch, matches `case *Err`, and `v.Msg` panics with a nil-pointer dereference.

**Fix:** Either guard inside the case, or normalise to an untyped nil at the boundary.

```go
case *Err:
    if v == nil {
        fmt.Println("err: <nil>")
        return
    }
    fmt.Println("err", v.Msg)
```

A more disciplined design: never expose pointer variants. Use value receivers consistently so a zero `Err{}` is the only "empty" form, and `nil` always means "no result".

---

## Bug 7 — Adding a new variant breaks every caller silently

```go
// v1 of the library
package token

type Token interface{ isToken() }

type Word struct{ Text string }
func (Word) isToken() {}

type Number struct{ N int }
func (Number) isToken() {}
```

```go
// caller, written against v1
func render(t token.Token) string {
    switch v := t.(type) {
    case token.Word:
        return v.Text
    case token.Number:
        return strconv.Itoa(v.N)
    }
    return ""
}
```

```go
// v2 of the library — adds a new variant
package token

type Punct struct{ R rune }
func (Punct) isToken() {}
```

**Hint:** Sealed interfaces are not enums — the compiler still does not police callers.

**Bug:** Library v2 added `Punct`. The caller still compiles with v2, but every `Punct` now silently renders as the empty string. The seal pattern protects you against *foreign* variants, not against *new internal* variants — those are technically a non-breaking change at the type level but a breaking change at the semantic level.

**Fix:**

1. Treat new variants as a breaking change in the package's compatibility promise. Document it.
2. In CI, run an exhaustiveness linter on every consumer's type switch over `token.Token`.
3. For the library author, consider returning an error sentinel from a helper:

```go
func Render(t Token) (string, error) {
    switch v := t.(type) {
    case Word:
        return v.Text, nil
    case Number:
        return strconv.Itoa(v.N), nil
    case Punct:
        return string(v.R), nil
    default:
        return "", fmt.Errorf("token: unhandled variant %T", v)
    }
}
```

The default arm guarantees that *the library itself* never silently drops a variant.

---

## Bug 8 — Generic sealed interface with a type set

```go
type Number interface {
    int | float64
    isNumber() // ?
}

func Sum[T Number](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}
```

**Hint:** What can a type set contain?

**Bug:** Go interfaces have *two* roles: traditional method sets (used at runtime as `interface{}` values) and type sets (used as type-parameter constraints). You cannot mix the two freely. An interface that contains a union of basic types like `int | float64` is a *type-constraint-only* interface — it cannot be used as a value type, and it cannot list methods that the basic types do not have. `int` has no `isNumber` method, so the constraint is unsatisfiable and you get:

```
int does not implement Number (missing method isNumber)
```

Even worse, you cannot seal a constraint at all — the whole point of unions is to enumerate types from outside the package.

**Fix:** Pick one role. If you want a sealed sum type, drop generics and use the runtime-interface pattern. If you want a numeric constraint, drop the seal:

```go
type Number interface { int | float64 } // constraint only

func Sum[T Number](xs []T) T { /* ... */ }
```

If you genuinely need both — sealed *and* generic — model the generic part separately:

```go
type Numeric interface { int | float64 }
type Boxed[T Numeric] struct{ V T }
func (Boxed[T]) isNumber() {}

type Number interface{ isNumber() }
```

`Boxed[int]` and `Boxed[float64]` are now the variants of the sealed `Number`.

---

## Bug 9 — json.Unmarshal of a sealed type

```go
type Shape interface {
    Area() float64
    isShape()
}

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14 * c.R * c.R }
func (c Circle) isShape()      {}

type Square struct{ S float64 }
func (s Square) Area() float64 { return s.S * s.S }
func (s Square) isShape()      {}

func Decode(data []byte) (Shape, error) {
    var s Shape
    err := json.Unmarshal(data, &s) // ?
    return s, err
}
```

**Hint:** What does `encoding/json` know about your interface?

**Bug:** `encoding/json` cannot decode into an interface value — it has no way to know which concrete type to allocate. You will get the runtime error `json: cannot unmarshal object into Go value of type shape.Shape`. The sealed interface offers no help here — there is no discriminator field telling the decoder which variant a JSON object represents.

**Fix:** Add an explicit discriminator and a custom unmarshaller.

```go
type envelope struct {
    Kind string          `json:"kind"`
    Data json.RawMessage `json:"data"`
}

func Decode(data []byte) (Shape, error) {
    var env envelope
    if err := json.Unmarshal(data, &env); err != nil {
        return nil, err
    }
    switch env.Kind {
    case "circle":
        var c Circle
        if err := json.Unmarshal(env.Data, &c); err != nil {
            return nil, err
        }
        return c, nil
    case "square":
        var s Square
        if err := json.Unmarshal(env.Data, &s); err != nil {
            return nil, err
        }
        return s, nil
    default:
        return nil, fmt.Errorf("shape: unknown kind %q", env.Kind)
    }
}
```

The producer side must agree to write `{"kind":"circle","data":{...}}`. Pair this with the same exhaustiveness check used by the runtime switch — if you forget a `case`, decoding an unrecognised kind returns a clean error rather than a silent zero value.

---

## Bug 10 — Test file bypasses the seal

```go
// shape.go
package shape

type Shape interface {
    Area() float64
    isShape()
}

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14 * c.R * c.R }
func (c Circle) isShape()      {}
```

```go
// shape_test.go (same package!)
package shape

type fakeShape struct{ a float64 }
func (f fakeShape) Area() float64 { return f.a }
func (f fakeShape) isShape()      {}

func TestRender(t *testing.T) {
    s := Render(fakeShape{a: 1})
    if s != "shape" { t.Fatal(s) }
}
```

Then the production switch is updated:

```go
func Render(s Shape) string {
    switch s.(type) {
    case Circle:
        return "circle"
    default:
        panic("unknown shape")
    }
}
```

Tests pass during development. Production crashes once running.

**Hint:** Why does the test file see the unexported method?

**Bug:** Internal tests live in the same package and so can implement `isShape()`. That makes them a useful tool for testing rendering logic — but it also means tests can declare *new* variants that production never sees. Switches that panic on `default` happily pass the test (if `fakeShape` is never used in those tests) and then explode for real users. Worse: a test mock with `isShape()` may shadow real production behaviour and hide a missing `case Circle`.

**Fix:** Two complementary disciplines:

1. Use `package shape_test` (an external test package) for tests of public behaviour. External tests cannot satisfy the seal, so they exercise only the real variants.
2. Keep an internal table of all known variants and assert it in a test:

```go
// shape_internal_test.go
package shape

func TestKnownVariants(t *testing.T) {
    var got []string
    for _, s := range []Shape{Circle{}, Square{}, Triangle{}} {
        got = append(got, fmt.Sprintf("%T", s))
    }
    want := []string{"shape.Circle", "shape.Square", "shape.Triangle"}
    if !reflect.DeepEqual(got, want) {
        t.Fatalf("variants drifted: got %v want %v", got, want)
    }
}
```

A new variant added without updating this test (or without updating downstream switches) trips the alarm in CI before any code ships.

---

## Bug 11 — Pointer vs value receiver mismatch on the seal

```go
type Shape interface {
    Area() float64
    isShape()
}

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return 3.14 * c.R * c.R }
func (c *Circle) isShape()     {} // pointer receiver

func main() {
    var s Shape = Circle{R: 1} // ?
}
```

**Hint:** Method sets of `Circle` versus `*Circle`.

**Bug:** `isShape` is declared on `*Circle`. The method set of the value type `Circle` does not include pointer-receiver methods, so `Circle{}` does *not* satisfy `Shape`. You get `Circle does not implement Shape (isShape method has pointer receiver)`. Worse, this is sometimes "fixed" by always passing `&Circle{...}` — but then equality checks (`s == otherCircle`) and `switch s.(type) { case Circle }` no longer match, because the dynamic type is `*Circle`, not `Circle`.

**Fix:** Pick one receiver style for all variants and stick with it. For sum-type-like sealed interfaces, value receivers are usually preferable — they make variants comparable, allow `==` against a zero value, and avoid the typed-nil pitfall from Bug 6.

```go
func (c Circle) isShape() {}
```

Add an assertion to lock in the choice:

```go
var (
    _ Shape = Circle{}
    _ Shape = Square{}
    _ Shape = Triangle{}
)
```

If anyone changes a receiver to a pointer, the line that no longer compiles points straight at the offender.

---

## Cheat Sheet

```
TYPICAL BUGS
─────────────────────────────
1. New variant forgets the seal           → "missing method isShape"
2. Seal method exported                   → outsiders can implement
3. Type switch missing a case + default   → silent bug
4. Outside package embeds concrete type   → seal bypassed via promotion
5. Variant defined in another package     → unexported method identity differs
6. Typed-nil vs untyped-nil interface     → r == nil is false
7. New variant in v2 silently drops cases → enforce exhaustiveness in CI
8. Generic + seal in one interface        → constraint vs method-set conflict
9. json.Unmarshal into the interface      → needs a discriminator + custom code
10. Internal tests declare fake variants  → use external test package
11. Pointer/value receiver mismatch       → Circle{} does not satisfy Shape

DISCIPLINES
─────────────────────────────
- var _ Iface = Variant{}      // compile-time assertion per variant
- exhaustive ./...             // type-switch coverage
- panic in default arm         // fail fast on unknown variant
- envelope { Kind, Data }      // explicit discriminator for serialization
- one receiver style per type  // value receivers preferred for sum types
```
