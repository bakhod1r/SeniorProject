# Embedding Interfaces — Senior Level

## Composition Strategy

### Granularity principle

```go
// Atomic
type Reader interface { Read([]byte) (int, error) }
type Writer interface { Write([]byte) (int, error) }
type Closer interface { Close() error }

// Composed
type ReadCloser interface { Reader; Closer }
type ReadWriter interface { Reader; Writer }
type ReadWriteCloser interface { Reader; Writer; Closer }
```

The caller should ask for the smallest interface possible. `io.Copy` needs `Reader` and `Writer` — `Closer` is unnecessary.

### Anti-pattern: kitchen sink interface

```go
// BAD
type Storage interface {
    Read(...) ...
    Write(...) ...
    Close() error
    Stats() Stats
    Backup(...) ...
    Restore(...) ...
    Verify(...) ...
}
```

ISP is violated. Split into smaller interfaces.

### Migration anti → granular

```go
// v1
type FullStore interface { /* 10 methods */ }

// v2 — granular
type Reader interface { ... }
type Writer interface { ... }
type Deleter interface { ... }

// Caller demands only the interface it needs
func ReadOnly(r Reader) { ... }
func WriteOnly(w Writer) { ... }
func ReadWrite(rw interface { Reader; Writer }) { ... }
```

---

## Decorator Pattern

### Simple decorator

```go
type Logger interface { Log(string) }

type ConsoleLogger struct{}
func (ConsoleLogger) Log(msg string) { fmt.Println(msg) }

type TimestampLogger struct{ Logger }
func (t TimestampLogger) Log(msg string) {
    t.Logger.Log(time.Now().Format(time.RFC3339) + " " + msg)
}

// Use
l := TimestampLogger{Logger: ConsoleLogger{}}
l.Log("hi")  // 2026-05-05T12:00:00Z hi
```

### Multi-decorator

```go
type LevelLogger struct{ Logger; level string }
func (l LevelLogger) Log(msg string) {
    l.Logger.Log("[" + l.level + "] " + msg)
}

// Compose
l := LevelLogger{
    Logger: TimestampLogger{Logger: ConsoleLogger{}},
    level:  "INFO",
}
l.Log("hi")  // [INFO] 2026-05-05T12:00:00Z hi
```

---

## Refactoring with Embedding

### Adding a method to existing interface

**Breaking** — implementations are broken.

```go
// v1
type Reader interface { Read(...) ... }

// v2 — new method
type Reader interface {
    Read(...) ...
    Available() int   // NEW
}
```

### Soft migration — new interface

```go
// v1 keeps
type Reader interface { Read(...) ... }

// v2 — separate interface
type AvailableReader interface {
    Reader
    Available() int
}
```

Callers can use `AvailableReader`. The original `Reader` is unchanged.

---

## Embed for Generics Constraint

```go
type Sortable interface {
    int | int64 | float64 | string
}

type Lengthy interface {
    Len() int
}

type SortableLen interface {
    Sortable
    Lengthy
}

// constraint
func Foo[T SortableLen](xs []T) { ... }
```

(This is a generics constraint, not a classic interface — it works with type sets.)

---

## Best Practices for Library Authors

### 1. Public interfaces are atomic

The foundation of a library is atomic interfaces. Let the caller compose, or provide a few typical compositions in your package.

```go
// Public
type Reader interface { ... }
type Writer interface { ... }
type Closer interface { ... }

// Convenience composition
type ReadWriteCloser interface { Reader; Writer; Closer }
```

### 2. Short, focused interfaces

The `-er` suffix on interface names is the Go convention:
- `Reader`, `Writer`, `Closer`
- `Stringer`, `Marshaler`, `Validator`

### 3. Documenting the contract

```go
// Reader is the interface that wraps the basic Read method.
//
// Read reads up to len(p) bytes into p. ...
type Reader interface { ... }

// ReadCloser combines Reader and Closer.
//
// Implementations must guarantee that calls to Close are idempotent.
type ReadCloser interface {
    Reader
    Closer
}
```

---

## Anti-patterns

### 1. Big embedding chain

```go
type A interface { ... }
type B interface { A; ... }
type C interface { B; ... }
type D interface { C; ... }
type E interface { D; ... }
```

The hierarchy is too deep — refactoring becomes hard.

### 2. Unrelated embed

```go
type Logger interface { Log(string) }
type Counter interface { Count() int }

type Bizarre interface { Logger; Counter }
```

There is no logical relationship.

### 3. Ignoring method conflict

```go
type A interface { M() string }
type B interface { M() int }
type AB interface { A; B }   // compile error — be careful
```

---

## Cheat Sheet

```
COMPOSITION STRATEGY
────────────────────────
Atomic interface first
Build larger via composition
Caller asks for the minimum

DECORATOR
────────────────────────
type X struct { Logger }
func (x X) Log(msg) { x.Logger.Log(modify(msg)) }

LIBRARY DESIGN
────────────────────────
Granular interfaces
Convenience compositions
-er suffix names
Documented contract

ANTI-PATTERNS
────────────────────────
Big chain (5+ levels)
Unrelated embed
Method conflict ignored

REFACTORING
────────────────────────
Adding a new method → BREAKING
Creating a new interface → soft
```

---

## Summary

Embedding at the senior level:
- Granularity — atomic interfaces are preferred
- Decorator pattern — embed + override
- Soft migration — add a new interface
- Library design — atomic + convenience
- Anti-patterns — big chain, unrelated embeds

Embedding is the Go-style way to build interfaces through composition. Used correctly, it produces powerful, modular abstractions.
