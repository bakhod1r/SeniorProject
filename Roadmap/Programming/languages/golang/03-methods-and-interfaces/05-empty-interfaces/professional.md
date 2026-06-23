# Empty Interfaces — Professional Level

## Production Patterns

### Pattern 1: Event payload

```go
type Event struct {
    Name    string
    Time    time.Time
    Payload any
}

func Publish(e Event) {
    // any for the event bus — accepts various payload types
}
```

### Pattern 2: Plugin config

```go
type Plugin interface {
    Configure(opts map[string]any) error
}
```

### Pattern 3: Generic logger fields

```go
type Logger interface {
    Info(msg string, fields ...any)
}

logger.Info("user login", "userID", "u1", "ip", "127.0.0.1")
```

### Pattern 4: Functional options as map

```go
func New(opts map[string]any) *Service { ... }
```

But **functional options** are often preferred:

```go
type Option func(*Service)
func WithTimeout(d time.Duration) Option { ... }
```

### Pattern 5: ORM dynamic query

```go
type Query struct {
    Table string
    Where map[string]any
}
```

---

## Anti-patterns

### 1. `any` instead of generics

```go
// Bad
func Sum(xs []any) any { ... }

// Good
func Sum[T Number](xs []T) T { ... }
```

### 2. `any` in domain entity

```go
// Bad
type User struct {
    ID   any
    Data any
}

// Good
type User struct {
    ID   UserID
    Name string
    Email Email
}
```

### 3. `any` for everything

```go
// Bad
func Process(input any) any { ... }

// Good
func Process(input ProcessInput) (ProcessOutput, error) { ... }
```

### 4. Type assertion chains

```go
// Bad
v, _ := input.(map[string]any)
sub, _ := v["data"].(map[string]any)
list, _ := sub["items"].([]any)
first, _ := list[0].(string)

// Good — typed struct
var data Data
json.Unmarshal(payload, &data)
```

---

## Library API Design

### Public API — `any` rare

```go
// Standard library style
func Marshal(v any) ([]byte, error)         // json: any makes sense
func (l *log.Logger) Print(v ...any)        // logger: any makes sense
func New(name string, args ...any) *Cmd     // exec.Command: any makes sense
```

`any` — at input boundaries, with generic semantics.

### Internal — concrete types

The library's internal implementation uses concrete types and generics.

### Documentation

```go
// Marshal returns the JSON encoding of v.
//
// v can be any Go value. Map keys must be strings or implement
// encoding.TextMarshaler. Channel, complex, and function values
// cannot be encoded.
func Marshal(v any) ([]byte, error) { ... }
```

It is important to document the types accepted by `any`.

---

## Migration to Generics

### Migrate when:

1. Same algorithm + different types
2. Type-safe container
3. Performance-sensitive

### Don't migrate when:

1. Heterogeneous collection
2. JSON dynamic data
3. Uses reflect
4. Public API boundary

### Example: gradual

```go
// v1
type Cache struct{ m map[string]any }

// v1.5 — both old and new
type CacheGeneric[T any] struct{ m map[string]T }

// v2 — old is removed
```

---

## Documentation Standards

```go
// Decode parses payload as JSON into a generic structure.
//
// The result is one of:
//   - map[string]any (JSON object)
//   - []any (JSON array)
//   - float64, string, bool, nil (JSON primitive)
//
// Use a typed structure with json.Unmarshal for known schemas.
func Decode(payload []byte) (any, error) { ... }
```

---

## Linter Rules

- **`gocritic`** — `interfaceUsage`: `any` overuse warning
- **`unconvert`** — Unnecessary type assertion
- **`gomnd`** — Magic numbers (often hides type knowledge)
- **`forcetypeassert`** — Single-value type assertion warning

Custom lint:
```go
// Avoid `interface{}` in domain layer
```

---

## Cheat Sheet

```
PRODUCTION any USE
─────────────────────
✓ Event payload
✓ Plugin config
✓ Logger fields
✓ JSON dynamic
✓ ORM query
✗ Domain entity ID/data
✗ Same-type container
✗ Algorithm input

LIBRARY API
─────────────────────
Public boundary: any OK
Internal: concrete + generics
Documentation matters

GENERICS MIGRATION
─────────────────────
Migrate: same algo + types, container, hot path
Skip: heterogeneous, JSON dynamic, reflect

DOCUMENTATION
─────────────────────
Document accepted types
JSON unmarshal result map/list/primitive
State boundaries clearly
```

---

## Summary

Professional `any`:
- Production patterns: event payload, plugin config, dynamic query
- Anti-patterns: domain entity, hot path, type assertion chains
- Library API: public boundary OK, internal concrete
- Migration to generics — gradual, selective
- Documentation: accepted types matter
- Linter — overuse warning

`any` is Go's powerful boundary tool. Concrete types in the domain core; `any` at integration boundaries. This is a deliberate decision.
