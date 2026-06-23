# Type Assertions — Senior Level

## Internals

### Single-value (panicking)

Compile-time:
```go
v := i.(T)
```

Runtime:
1. Read the dynamic type from the itab
2. Compare with the target T
3. On match — return the value
4. On mismatch — call `runtime.panicTypeAssertion`

### Two-value

```go
v, ok := i.(T)
```

Runtime:
1. Read the dynamic type from the itab
2. Compare with the target T
3. On match — return `(value, true)`
4. On mismatch — return `(zero, false)` — NO panic

### Interface to interface

```go
var i any = T{}
s, ok := i.(Stringer)
```

Runtime:
1. Take the method set of the dynamic type T
2. Compare with the method set of the Stringer interface
3. On match — a new itab is created and cached
4. On mismatch — `(zero, false)`

### itab cache

The itab is cached per `(interface, concrete)` pair. The first assertion is slower; subsequent ones are fast.

---

## Performance Profile

### Direct assertion

```go
func BenchmarkAssertConcrete(b *testing.B) {
    var i any = 42
    for n := 0; n < b.N; n++ {
        _, _ = i.(int)
    }
}
```

Typical: ~1 ns/op.

### Interface to interface

```go
func BenchmarkAssertInterface(b *testing.B) {
    var i any = User{}
    for n := 0; n < b.N; n++ {
        _, _ = i.(fmt.Stringer)
    }
}
```

Typical: ~2–3 ns/op (with itab cache hit).

### Type switch

```go
func BenchmarkSwitch(b *testing.B) {
    var i any = "hello"
    for n := 0; n < b.N; n++ {
        switch i.(type) {
        case int: _ = "int"
        case string: _ = "string"
        case bool: _ = "bool"
        }
    }
}
```

Typical: ~1–2 ns/op. The compiler optimizes it.

---

## Architectural Decisions

### Use interface, not assertion

```go
// Bad — caller passes various types
func process(x any) {
    if a, ok := x.(*A); ok { a.M() }
    if b, ok := x.(*B); ok { b.M() }
}

// Good — interface
type Processor interface { M() }
func process(p Processor) { p.M() }
```

Express polymorphism via an interface, not a type assertion.

### Assertion as escape hatch

A type assertion is an emergency tool:
- Custom error inspection
- Capability check (`io.Seeker`)
- Plugin / dynamic dispatch

Avoid type assertions in domain logic.

### errors.As semantics

```go
var target *MyError
if errors.As(err, &target) {
    // target — concrete type
}
```

`errors.As`:
1. `err == target type` — direct
2. Calls `err.Unwrap()` and recurses
3. On the first match — assigns to `target`

`Is` is `==` (or the `Is(target) bool` method).

---

## Refactoring

### From assertion chain to interface

```go
// Before
func describe(x any) string {
    if a, ok := x.(*Animal); ok { return a.Name }
    if v, ok := x.(*Vehicle); ok { return v.Model }
    if p, ok := x.(*Place); ok { return p.City }
    return "unknown"
}

// After
type Describable interface { Describe() string }

func (a *Animal) Describe() string  { return a.Name }
func (v *Vehicle) Describe() string { return v.Model }
func (p *Place) Describe() string   { return p.City }

func describe(d Describable) string { return d.Describe() }
```

### From assertion to type switch

```go
// Before
if s, ok := i.(string); ok { handleString(s) }
if n, ok := i.(int); ok { handleInt(n) }

// After
switch v := i.(type) {
case string: handleString(v)
case int:    handleInt(v)
}
```

---

## Generic Alternative (Go 1.18+)

```go
// Old — assertion
func Get(m map[string]any, key string) any { return m[key] }

// New — generics
func Get[V any](m map[string]V, key string) V { return m[key] }
```

Type-safe and faster.

---

## Cheat Sheet

```
INTERNALS
────────────────────────
Direct: itab type compare (~1 ns)
Interface to interface: method set match (~2-3 ns)
itab cache — repeated assertion fast

PATTERNS
────────────────────────
Capability check: if c, ok := x.(I); ok
Custom error: errors.As
Refactor to interface — polymorphism

ARCHITECTURAL
────────────────────────
Polymorphism → interface
Type assertion → escape hatch
errors.As → wrapped errors
Generics → type-safe alternative

ANTI-PATTERNS
────────────────────────
Assertion chain
Single-value in production
Polymorphism via assertion
```

---

## Summary

Senior-level type assertion:
- Internals — itab compare, ~1 ns
- Patterns: capability check, error inspection
- Refactor: assertion → interface
- Architectural — escape hatch, not the main tool
- Generics — type-safe alternative

Type assertion is the way into Go's runtime type system. Use it deliberately and only where appropriate — prefer interfaces in domain logic.
