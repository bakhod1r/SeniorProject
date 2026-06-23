# Type Assertions — Professional Level

## Production Patterns

### Pattern 1: Error inspection

```go
import "errors"

type ValidationError struct{ Field, Msg string }
func (e *ValidationError) Error() string { return e.Msg }

func process(req Request) error {
    if err := validate(req); err != nil {
        var ve *ValidationError
        if errors.As(err, &ve) {
            // structured error response
            return BadRequest(ve.Field, ve.Msg)
        }
        return InternalError(err)
    }
    return nil
}
```

### Pattern 2: Optional capability

```go
func writeLog(w io.Writer, msg string) {
    fmt.Fprintln(w, msg)
    if f, ok := w.(interface{ Flush() error }); ok {
        f.Flush()
    }
}
```

### Pattern 3: Safe configuration

```go
func GetInt(m map[string]any, key string, def int) int {
    v, ok := m[key]
    if !ok { return def }
    n, ok := v.(int)
    if !ok { return def }
    return n
}
```

### Pattern 4: Plugin discovery

```go
type Plugin interface { Run() error }
type Configurable interface { Configure(map[string]any) error }

func StartPlugin(p Plugin, cfg map[string]any) error {
    if c, ok := p.(Configurable); ok {
        if err := c.Configure(cfg); err != nil { return err }
    }
    return p.Run()
}
```

---

## Anti-patterns

### 1. Assertion chain in domain logic

```go
// Bad
func processEntity(e any) {
    switch v := e.(type) {
    case *User:    processUser(v)
    case *Order:   processOrder(v)
    case *Product: processProduct(v)
    }
}

// Good
type Processor interface { Process() error }
func processEntity(p Processor) error { return p.Process() }
```

### 2. Single-value in production

```go
// Bad
v := i.(T)   // panic risk

// Good
v, ok := i.(T)
if !ok { return ErrUnexpectedType }
```

### 3. Direct assertion on wrapped error

```go
// Bad
if e, ok := err.(*MyError); ok { ... }

// Good
var e *MyError
if errors.As(err, &e) { ... }
```

---

## Library API Design

### Hide assertions behind interface

```go
// Bad — caller has to do the assertion
func GetData() any { ... }

// Good — typed return
func GetUser() (*User, error) { ... }
```

### Documentation

```go
// Decode parses payload as JSON.
//
// On success, the result is one of:
//   - map[string]any
//   - []any
//   - float64, string, bool, nil
//
// Use type assertion or json.Unmarshal with a typed struct.
func Decode(payload []byte) (any, error) { ... }
```

---

## Testing

### Custom error testing

```go
func TestNotFound(t *testing.T) {
    err := find("missing")
    var nf *NotFoundError
    if !errors.As(err, &nf) {
        t.Fatalf("expected NotFoundError, got %T", err)
    }
    if nf.ID != "missing" {
        t.Errorf("expected ID=missing, got %s", nf.ID)
    }
}
```

### Capability testing

```go
func TestSeekable(t *testing.T) {
    r := &MyReader{}
    if _, ok := any(r).(io.Seeker); ok {
        t.Error("expected NOT seekable")
    }
}
```

---

## Cheat Sheet

```
PRODUCTION PATTERNS
────────────────────────
Error inspection (errors.As)
Optional capability
Safe configuration getter
Plugin discovery

ANTI-PATTERNS
────────────────────────
Assertion chain in domain
Single-value in production
Direct assertion on wrapped error

LIBRARY DESIGN
────────────────────────
Hide assertion behind typed return
Document accepted types

TESTING
────────────────────────
errors.As assert
Capability check
Negative testing — wrong type
```

---

## Summary

Professional type assertion:
- Production patterns — error inspection, optional capability, plugin discovery
- Anti-patterns — assertion chain, single-value, direct assertion on wrapped
- Library design — typed return, documented behavior
- Testing — `errors.As`, capability check

Type assertion is Go's escape hatch. In domain logic, use interfaces; at integration boundaries, use assertions. Deliberate, consistent use leads to stable code.
