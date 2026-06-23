# Embedding Interfaces — Middle Level

## Conflict Resolution

### Same signature — OK (Go 1.14+)

```go
type A interface { M() }
type B interface { M() }   // same signature
type AB interface { A; B } // OK — single M
```

Before Go 1.14 this was a compile error. Now it is OK.

### Different signature — error

```go
type A interface { M() string }
type B interface { M() int }
type AB interface { A; B }  // compile error — incompatible
```

### Diamond inheritance

```go
type Base interface { Foo() }
type X interface { Base }
type Y interface { Base }
type XY interface { X; Y }   // OK — Foo only once
```

---

## Struct + Interface Embed

### Interface inside a struct

```go
type Logger interface { Log(string) }

type Service struct {
    Logger      // interface embedded
    name string
}

s := Service{Logger: ConsoleLogger{}}
s.Log("hi")    // promoted from Logger
```

`Service`'s method set: `Log` (promoted) plus any other methods.

### Use case — decorator

```go
type Reader interface { Read([]byte) (int, error) }

type CountingReader struct {
    Reader   // any Reader can be embedded
    n int
}

func (cr *CountingReader) Read(p []byte) (int, error) {
    n, err := cr.Reader.Read(p)
    cr.n += n
    return n, err
}
```

`CountingReader.Read` overrides the inner reader's Read and collects statistics.

---

## Method Promotion via Embed

### Outer auto-gets methods

```go
type A interface { Foo() }
type B interface {
    A
    Bar()
}

type T struct{}
func (T) Foo() {}
func (T) Bar() {}

var _ B = T{}   // OK — both Foo and Bar
```

### Outer can add new method

```go
type A interface { Foo() }
type B interface {
    A
    Bar()    // new method
}
```

`B`'s method set: `Foo, Bar`.

### Outer can re-declare (same signature)

```go
type A interface { Foo() string }
type B interface {
    A
    Foo() string   // same — OK (1.14+)
}
```

---

## Common Standard Interfaces

### `io.ReadWriter`

```go
type ReadWriter interface { Reader; Writer }
```

### `io.ReadCloser`

```go
type ReadCloser interface { Reader; Closer }
```

### `io.ReadWriteCloser`

```go
type ReadWriteCloser interface { Reader; Writer; Closer }
```

### `io.ReadSeeker`

```go
type ReadSeeker interface { Reader; Seeker }
```

### `io.WriteCloser`

```go
type WriteCloser interface { Writer; Closer }
```

---

## Interface Compose Best Practices

### 1. Atomic interfaces first

```go
// Good — granular
type Reader interface { Read(...) ... }
type Writer interface { Write(...) ... }
type Closer interface { Close() error }

// Composition
type ReadWriteCloser interface { Reader; Writer; Closer }
```

### 2. Combine with purpose

```go
// Good — Reader + Closer logically belong together
type ReadCloser interface { Reader; Closer }

// Bad — unrelated
type Bizarre interface { Logger; Counter }
```

### 3. Caller demands the minimal interface

```go
// Bad — caller demands too much
func process(rw io.ReadWriteCloser) { ... }

// Good — only what is needed
func process(r io.Reader) { ... }
```

---

## Patterns

### Pattern 1: Decorator with embed

```go
type Reader interface { Read([]byte) (int, error) }

type LoggingReader struct{ Reader }
func (lr LoggingReader) Read(p []byte) (int, error) {
    log.Println("reading...")
    return lr.Reader.Read(p)
}
```

### Pattern 2: Mock with embed

```go
type Repo interface {
    Find(id string) (*User, error)
    Save(u *User) error
}

type PartialMock struct{ Repo }   // embed real Repo
func (m *PartialMock) Find(id string) (*User, error) {
    // override only Find
    return &User{ID: id}, nil
}
// Save — delegates to embedded Repo
```

### Pattern 3: Adapter

```go
type StringReader struct{ s string; pos int }
func (r *StringReader) Read(p []byte) (int, error) { ... }

// implements io.Reader without explicit embed
```

### Pattern 4: Interface as type constraint (1.18+)

```go
type Sized interface { Size() int }
type Named interface { Name() string }

type SizedNamed interface { Sized; Named }

func describe[T SizedNamed](items []T) { ... }
```

---

## Test

### 1. How does `type AB interface { A; B }` resolve method conflicts?
**Answer:** Same signature (1.14+) is OK. Different signatures cause a compile error.

### 2. Can diamond inheritance produce a compile error?
**Answer:** In 1.14+ no (when the signatures match). Otherwise yes.

### 3. When an interface is embedded inside a struct, does method promotion work?
**Answer:** Yes. The outer struct automatically gets the methods of the embedded interface.

### 4. How is the decorator pattern written with embed?
**Answer:** A new struct embeds the interface and overrides the method.

### 5. Which 3 interfaces does `io.ReadWriteCloser` embed?
**Answer:** Reader, Writer, Closer.

---

## Cheat Sheet

```
EMBED RULES
─────────────────────
Same signature  → 1.14+ OK
Diff signature  → compile error
Circular        → compile error
Diamond         → OK if signature same

STRUCT + INTERFACE
─────────────────────
type S struct { I }   → method promotion
Override in outer

PATTERNS
─────────────────────
Decorator: Wrap interface, override
Mock: Embed real, override fields
Adapter: Implement implicitly
Constraint: Compose for generics

STD LIBRARY
─────────────────────
io.ReadWriter, io.ReadCloser, io.ReadSeeker
io.WriteCloser, io.ReadWriteCloser
```

---

## Summary

Embedding at the middle level:
- Same signature is OK in 1.14+, different signatures cause a compile error
- Diamond — a single method
- Struct + interface embed → method promotion
- Decorator pattern — embed + override
- Granular small interfaces + composition
- Callers should ask for the minimal interface
