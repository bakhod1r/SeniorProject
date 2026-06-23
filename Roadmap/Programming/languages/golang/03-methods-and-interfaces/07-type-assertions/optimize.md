# Type Assertions — Optimize

## 1. Performance

```
Direct assertion (concrete) — ~1 ns
Interface to interface      — ~2-3 ns (itab cache)
Type switch                 — ~1-2 ns (jump table)
errors.As (Unwrap chain)    — ~10-20 ns per Unwrap
```

## 2. Type switch is faster

```go
// Bad
if s, ok := i.(string); ok { ... }
if n, ok := i.(int); ok    { ... }
if b, ok := i.(bool); ok   { ... }

// Good
switch v := i.(type) {
case string: ...
case int: ...
case bool: ...
}
```

## 3. itab cache

The itab is cached per `(interface, concrete)` pair. The first assertion is slow; subsequent ones are faster.

## 4. Prefer generics

```go
// Bad
func Sum(xs []any) int {
    total := 0
    for _, x := range xs { total += x.(int) }
    return total
}

// Good
func Sum[T int | float64](xs []T) T {
    var total T
    for _, x := range xs { total += x }
    return total
}
```

Generics — no boxing, no assertions.

## 5. Assertion in a hot path

```go
// Bad — assertion on every iteration
for _, x := range items {
    n := x.(int)
    process(n)
}

// Good — concrete slice
items := []int{...}
for _, n := range items { process(n) }
```

## 6. Use errors.As

```go
// Bad — direct
e, ok := err.(*MyErr)

// Good — wrapper-aware
var e *MyErr
errors.As(err, &e)
```

## 7. Cleaner code

### Always use two-value
```go
v, ok := i.(T)
if !ok { return errInvalid }
```

### Type switch for multiple types
```go
switch v := i.(type) {
case T1: ...
case T2: ...
}
```

### Refactor to an interface
```go
// Before — assertion chain
if a, ok := x.(*A); ok { ... }
if b, ok := x.(*B); ok { ... }

// After — interface
type Processor interface { Process() }
func handle(p Processor) { p.Process() }
```

### Hide behind a typed return
```go
// Bad
func GetData() any { ... }

// Good
func GetUser() (*User, error) { ... }
```

## 8. Cheat Sheet

```
PERFORMANCE
─────────────────────
Assertion: ~1-3 ns
Type switch: ~1-2 ns (multi)
errors.As: per-Unwrap overhead

OPTIMIZATION
─────────────────────
Type switch > multi-assertion
itab cache — repeated fast
Generics > assertion (no boxing)
Concrete slice — no assertion needed

CLEANER CODE
─────────────────────
Always two-value
Type switch for multi-type
Interface for polymorphism
Typed return hides assertion

ANTI-PATTERNS
─────────────────────
Single-value in production
Assertion chain
Polymorphism via assertion
Direct assertion on wrapped error
```

## 9. Summary

Performance:
- Assertion ~1–3 ns — fine in most cases
- Type switch is faster for many types
- itab cache makes repeated assertions fast
- Generics > assertion (no boxing)
- In a hot path, prefer the concrete type

Cleaner code:
- Always use the two-value form
- Type switch for multiple types
- Refactor an assertion chain into an interface
- A typed return hides the assertion
- `errors.As` for wrapped errors

Type assertion is Go's escape hatch. Use it deliberately and only where appropriate. In domain logic prefer interfaces; at integration boundaries assertion is fine. When performance matters, generics are preferred.
