# Embedding Interfaces — Optimize

## 1. Embedding itself has no performance impact

Embedding is compile-time syntactic. The method set is identical:
```go
type AB interface { A; B }
// equivalent
type AB interface { Method1(); Method2() }
```

No runtime difference.

## 2. Granular interface — cheaper for callers

```go
// Bad
func process(rwc io.ReadWriteCloser) { ... }

// Good
func process(r io.Reader) { ... }
```

Callers should depend only on the interface they need — mocks are cheaper and dependencies stay small.

## 3. Interface dispatch overhead

An embedded interface uses the same dispatch — via the itab. ~2 ns.

## 4. Decorator overhead

```go
type LoggingReader struct{ Reader }
func (lr LoggingReader) Read(p []byte) (int, error) {
    log.Println("...")
    return lr.Reader.Read(p)
}
```

Each Read carries a log call + an interface dispatch. Measure it on the hot path.

## 5. Inline opportunity

When methods are promoted via embedding, the compiler can inline them (when the concrete type is known).

## 6. Cleaner code

### Granular small interfaces
```go
// Atomic
type Reader interface { ... }
type Writer interface { ... }
type Closer interface { ... }

// Composition
type ReadWriteCloser interface { Reader; Writer; Closer }
```

### Caller minimal interface
```go
func ReadOnly(r Reader) { ... }
```

### Decorator chain
```go
l := Filtered{
    Logger: Level{
        Logger: Timestamp{Logger: Console{}},
        level:  "INFO",
    },
    minLen: 3,
}
```

### Compile-time check
```go
var _ ReadCloser = (*File)(nil)
```

## 7. Cheat Sheet

```
PERFORMANCE
─────────────────────
Embed → no runtime cost
Method dispatch → ~2 ns (interface)
Decorator chain → dispatch overhead per layer

DESIGN
─────────────────────
Granular > big
Caller minimal interface
-er suffix
Documentation contract

PATTERNS
─────────────────────
Decorator: embed + override
Mock: NoOp + override
Capability: granular per-role
Plugin: Configurable + Runnable
```

## 8. Summary

Embedding performance:
- Compile-time syntactic — no runtime overhead
- Decorator chain — ~2 ns per dispatch
- Inline opportunity — with a concrete type

Cleaner code:
- Granular atomic interfaces
- Caller asks for the minimal interface
- Decorator pattern — embed + override
- Compile-time check — `var _ I = (*T)(nil)`

Embedding is the Go-style composition. Used correctly, it produces a modular, extensible design.
