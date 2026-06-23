# Type Assertions — Middle Level

## Common Patterns

### Pattern 1: Interface upgrade

```go
func process(r io.Reader) {
    if rs, ok := r.(io.ReadSeeker); ok {
        rs.Seek(0, io.SeekStart)
    }
}
```

### Pattern 2: Custom error

```go
err := doIt()
var nf *NotFoundError
if errors.As(err, &nf) {
    fmt.Println("ID:", nf.ID)
}
```

`errors.As` walks the wrapped error chain.

### Pattern 3: Optional method

```go
type Resetter interface { Reset() }

func ResetIfPossible(x any) {
    if r, ok := x.(Resetter); ok {
        r.Reset()
    }
}
```

### Pattern 4: Inspect map[string]any

```go
func GetString(m map[string]any, key string) (string, bool) {
    v, ok := m[key]
    if !ok { return "", false }
    s, ok := v.(string)
    return s, ok
}
```

### Pattern 5: Type assertion to add new methods

```go
type V2Reader interface {
    io.Reader
    NewMethod() error
}

if v2, ok := r.(V2Reader); ok {
    v2.NewMethod()
}
```

---

## errors.As vs Type Assertion

### Type assertion — direct only

```go
err := fmt.Errorf("wrap: %w", &MyErr{})
e, ok := err.(*MyErr)   // ok=false — wrapped
```

### errors.As — wrapper-aware

```go
var e *MyErr
errors.As(err, &e)   // ok=true — finds wrapped
```

`errors.As`:
1. Direct match: asserts to the target type
2. Unwrap chain: descends via `Unwrap()`
3. On success — fills `target` and returns true

### errors.Is — sentinel comparison

```go
errors.Is(err, sql.ErrNoRows)
```

For sentinel errors.

---

## Type Assertion Performance

```go
var i any = 42

v := i.(int)         // ~1-2 ns
v, ok := i.(int)     // ~1-2 ns
```

The compiler knows the exact type — there is no significant overhead.

### Type switch is faster

```go
// Multi-assertion
if s, ok := i.(string); ok { ... }
if n, ok := i.(int); ok { ... }

// Type switch
switch v := i.(type) {
case string: ...
case int: ...
}
```

A type switch compiles to a single jump table.

---

## Interface to Interface Assertion

```go
type Reader interface { Read([]byte) (int, error) }
type Closer interface { Close() error }

func handle(r Reader) {
    if c, ok := r.(Closer); ok {
        defer c.Close()
    }
    // ...
}
```

`r` is a `Reader`. If the concrete type also satisfies `Closer`, the assertion succeeds.

---

## Type Assertion in Switch

```go
switch v := i.(type) {
case int:
    fmt.Println("int:", v)
case string:
    fmt.Println("string:", v)
case nil:
    fmt.Println("nil")
default:
    fmt.Printf("unknown: %T\n", v)
}
```

Inside each case, `v` has the specific type. (In multi-case clauses, `v` keeps the `any` type.)

---

## Tricky Patterns

### Pattern: Self-modifying

```go
type ModifierA struct{}
func (m *ModifierA) Apply(s *State) { ... }

type ModifierB struct{}
func (m *ModifierB) Apply(s *State) { ... }

mods := []any{&ModifierA{}, &ModifierB{}}
for _, m := range mods {
    if mod, ok := m.(interface{ Apply(*State) }); ok {
        mod.Apply(s)
    }
}
```

Ad-hoc interface assertion.

### Pattern: Ad-hoc capability

```go
func printable(x any) {
    if s, ok := x.(fmt.Stringer); ok {
        fmt.Println(s.String())
    } else {
        fmt.Println(x)
    }
}
```

---

## Anti-patterns

### 1. Assertion chain

```go
// Bad
if a, ok := x.(*A); ok { a.Method() }
if b, ok := x.(*B); ok { b.Method() }
if c, ok := x.(*C); ok { c.Method() }
```

Use a type switch or introduce an interface.

### 2. Single-value assertion (production)

```go
v := i.(T)   // panic risk
```

Fine in tests. Use the two-value form in production.

### 3. Assertion in place of polymorphism

```go
// Bad
func process(x any) {
    if a, ok := x.(*A); ok { a.Method() }
    if b, ok := x.(*B); ok { b.Method() }
}

// Good
type Processor interface { Method() }
func process(p Processor) { p.Method() }
```

---

## Cheat Sheet

```
PATTERNS
─────────────────────
Interface upgrade
Custom error (errors.As)
Optional method
Map[string]any inspection

PERFORMANCE
─────────────────────
Single assertion: ~1-2 ns
Multi-assertion → type switch is faster

ERROR
─────────────────────
errors.As — wrapper-aware
errors.Is — sentinel
Direct assertion — only direct match

ANTI-PATTERNS
─────────────────────
Assertion chain → type switch
Single-value in production
Assertion in place of polymorphism
```

---

## Summary

Middle-level type assertion topics:
- Common patterns: interface upgrade, custom error, optional capability
- `errors.As` is wrapper-aware; type assertion is direct
- Performance: assertion ~1–2 ns; type switch wins for many types
- Anti-patterns: assertion chains, single-value form in production, assertion replacing polymorphism
