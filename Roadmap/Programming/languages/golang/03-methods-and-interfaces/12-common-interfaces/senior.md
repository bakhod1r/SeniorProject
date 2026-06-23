# Common Interfaces — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `io.Copy` Picks a Fast Path](#how-iocopy-picks-a-fast-path)
3. [Implementing `io.WriterTo` and `io.ReaderFrom`](#implementing-iowriterto-and-ioreaderfrom)
4. [`io.Copy` Source Walkthrough](#iocopy-source-walkthrough)
5. [itab Caching and Interface Conversion Cost](#itab-caching-and-interface-conversion-cost)
6. [Optional Interfaces — the "Type Assertion Probe" Pattern](#optional-interfaces-the-type-assertion-probe-pattern)
7. [`iter.Seq` and `iter.Seq2` Internals (Go 1.23+)](#iterseq-and-iterseq2-internals-go-123)
8. [`driver.Valuer` and `sql.Scanner`](#drivervaluer-and-sqlscanner)
9. [Contract Enforcement Tools](#contract-enforcement-tools)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)

---

## Introduction

At the senior level you stop just satisfying interfaces and start **exploiting** them. The std-lib is full of optional fast-path interfaces that the public API checks for at runtime via type assertion — `io.WriterTo`, `io.ReaderFrom`, `http.Flusher`, `http.Pusher`, `database/sql.RawBytes`, and many more. If your type implements them, you skip a copy. If not, the std-lib falls back to a generic loop.

This page traces those fast paths, shows the itab mechanism that makes interface dispatch cheap, and finishes with the brand-new iterator interfaces in Go 1.23+.

---

## How `io.Copy` Picks a Fast Path

`io.Copy(dst, src)` is the most-used I/O function in Go. Its public signature looks innocent:

```go
func Copy(dst Writer, src Reader) (written int64, err error)
```

But the implementation is a careful dance:

```go
// Simplified from src/io/io.go
func copyBuffer(dst Writer, src Reader, buf []byte) (written int64, err error) {
    // Fast path 1: src has WriteTo
    if wt, ok := src.(WriterTo); ok {
        return wt.WriteTo(dst)
    }
    // Fast path 2: dst has ReadFrom
    if rt, ok := dst.(ReaderFrom); ok {
        return rt.ReadFrom(src)
    }
    // Slow path: generic loop with a 32 KiB buffer
    if buf == nil {
        buf = make([]byte, 32*1024)
    }
    for {
        nr, er := src.Read(buf)
        if nr > 0 {
            nw, ew := dst.Write(buf[0:nr])
            // ...
        }
    }
}
```

Two type assertions, both potentially **free** (they hit a tiny lookup, not a syscall). If either succeeds, `io.Copy` skips the byte-by-byte loop and lets the source/sink handle the transfer however it likes.

### The two fast-path interfaces

```go
type WriterTo interface {
    WriteTo(w Writer) (n int64, err error)
}

type ReaderFrom interface {
    ReadFrom(r Reader) (n int64, err error)
}
```

Real-world use:

| Source | Implements `WriterTo`? | Why it matters |
|--------|------------------------|----------------|
| `*bytes.Buffer` | yes | Single `dst.Write(b.buf)` — no loop |
| `*strings.Reader` | yes | Single `Write` from the underlying string |
| `*os.File` | yes (via `WriteTo`) | On Linux, may invoke `sendfile(2)` zero-copy |

| Sink | Implements `ReaderFrom`? | Why it matters |
|------|--------------------------|----------------|
| `*os.File` | yes | `sendfile`/`splice` on supported kernels |
| `*net.TCPConn` | yes | `sendfile` straight from a file descriptor |
| `*bytes.Buffer` | yes | Avoids 32 KiB intermediate buffer |

When you `io.Copy(tcpConn, osFile)`, neither byte ever lands in user space — the kernel splices the file FD straight to the socket FD. That's millions of bytes/sec saved by **two type assertions** in `io.Copy`.

godoc: <https://pkg.go.dev/io#Copy>, <https://pkg.go.dev/io#WriterTo>, <https://pkg.go.dev/io#ReaderFrom>

---

## Implementing `io.WriterTo` and `io.ReaderFrom`

Implement these on your own types when you have a more efficient path than "loop with a 32 KiB buffer."

### Example: a chunked source whose chunks are already in memory

```go
package main

import (
    "fmt"
    "io"
    "os"
)

// Chunks holds discrete byte slices in memory. The default Reader
// implementation must concatenate these into a buffer for every Read.
// WriteTo lets us hand each chunk to the destination directly.
type Chunks struct {
    data [][]byte
    cur  int
    pos  int
}

// Read — generic, not very efficient.
func (c *Chunks) Read(p []byte) (int, error) {
    if c.cur >= len(c.data) {
        return 0, io.EOF
    }
    n := copy(p, c.data[c.cur][c.pos:])
    c.pos += n
    if c.pos >= len(c.data[c.cur]) {
        c.cur++
        c.pos = 0
    }
    return n, nil
}

// WriteTo — fast path: hand each chunk straight to the writer.
func (c *Chunks) WriteTo(w io.Writer) (int64, error) {
    var total int64
    for c.cur < len(c.data) {
        n, err := w.Write(c.data[c.cur][c.pos:])
        total += int64(n)
        if err != nil {
            return total, err
        }
        c.cur++
        c.pos = 0
    }
    return total, io.EOF // optional; io.Copy ignores EOF from WriteTo
}

func main() {
    src := &Chunks{data: [][]byte{[]byte("hello, "), []byte("world\n")}}
    n, _ := io.Copy(os.Stdout, src) // io.Copy detects WriterTo, calls it
    fmt.Println("wrote", n)
}
```

The `io.Copy` call **never enters the generic loop**. It calls `Chunks.WriteTo(os.Stdout)` once, and that does the work in two `Write` calls instead of N `Read`/`Write` round trips through a 32 KiB buffer.

### Example: a sink that hashes incoming bytes (`ReaderFrom`)

```go
import (
    "crypto/sha256"
    "hash"
    "io"
)

type HashingSink struct {
    h hash.Hash
}

func NewHashingSink() *HashingSink { return &HashingSink{h: sha256.New()} }

// Default Write implementation
func (s *HashingSink) Write(p []byte) (int, error) {
    return s.h.Write(p)
}

// ReadFrom: streaming read instead of buffer-by-buffer.
func (s *HashingSink) ReadFrom(r io.Reader) (int64, error) {
    return io.Copy(s.h, r) // delegate to hash's own ReadFrom-aware path
}

func (s *HashingSink) Sum() []byte { return s.h.Sum(nil) }
```

### Subtle rule: `WriteTo` MUST consume the source completely

Per godoc:
> WriteTo writes data to w until there's no more data to write or when an error occurs. The return value n is the number of bytes written.

If you return early without draining, `io.Copy` reports incorrect bytes written and the upstream caller assumes everything was sent.

---

## `io.Copy` Source Walkthrough

A trimmed view of the actual std-lib source (Go 1.23):

```go
// src/io/io.go
func copyBuffer(dst Writer, src Reader, buf []byte) (written int64, err error) {
    if wt, ok := src.(WriterTo); ok {
        return wt.WriteTo(dst)
    }
    // Similarly, if the writer has a ReadFrom method, use it to do the copy.
    if rf, ok := dst.(ReaderFrom); ok {
        return rf.ReadFrom(src)
    }
    if buf == nil {
        size := 32 * 1024
        if l, ok := src.(*LimitedReader); ok && int64(size) > l.N {
            if l.N < 1 {
                size = 1
            } else {
                size = int(l.N)
            }
        }
        buf = make([]byte, size)
    }
    for {
        nr, er := src.Read(buf)
        if nr > 0 {
            nw, ew := dst.Write(buf[0:nr])
            // bookkeeping...
        }
        // EOF handling
    }
}
```

Lessons:
1. The fast path is taken **only if the type assertion succeeds**.
2. The `WriterTo` check comes first — it gives the source full control.
3. There's even a special-case for `*LimitedReader` to avoid over-allocating the scratch buffer.

The same pattern appears in `bufio.Reader.WriteTo`, `bytes.Buffer.WriteTo`, and many third-party libraries. Senior engineers spot this pattern and design their I/O types to participate.

---

## itab Caching and Interface Conversion Cost

When Go converts a concrete type to an interface — `var w io.Writer = file` — the runtime needs an **itab** (interface table): a struct containing the interface type, the concrete type, and pointers to each method.

```
itab {
    inter *interfacetype     // *io.Writer
    _type *_type             // *os.File
    fun   [N]uintptr         // [&(*os.File).Write, ...]
}
```

The first time a `(io.Writer, *os.File)` pair is seen, the runtime builds the itab and stores it in a global hash table. Every subsequent conversion is a **hash lookup** — single-digit nanoseconds.

### Why this matters for hot paths

```go
for _, f := range files {
    var w io.Writer = f       // first iter: build itab; rest: cache hit
    fmt.Fprintln(w, "ok")
}
```

The conversion is not free, but it's not painful either. What is painful: **changing the concrete type each iteration**:

```go
for _, sink := range []any{file1, conn1, buffer1, ...} {
    var w io.Writer = sink.(io.Writer) // different itab each time
}
```

Each unique pair requires its own itab construction. If your loop hits hundreds of distinct concrete types this can show up in profiles.

### Inspecting itabs

```bash
go build -gcflags='-m' main.go
# main.go:5: x escapes to heap (interface conversion)
```

Interface conversions can also force values to **escape to the heap** because the interface representation is `(typeptr, dataptr)` and `dataptr` must outlive the conversion site.

For deep dives, see the source: `src/runtime/iface.go`.

---

## Optional Interfaces — the "Type Assertion Probe" Pattern

Std-lib code routinely tests for **optional** interfaces and degrades gracefully:

```go
// in net/http
if flusher, ok := w.(http.Flusher); ok {
    flusher.Flush()
}

// in sort (since Go 1.19)
if sort, ok := data.(sort.Interface); ok && data.Len() > 12 {
    // use pattern-defeating quicksort
}

// in encoding/json
if marshaler, ok := v.(json.Marshaler); ok {
    return marshaler.MarshalJSON()
}
```

Design your library this way too:

```go
// Process accepts any reader. If it also satisfies io.Closer,
// Process closes it after reading.
func Process(r io.Reader) error {
    data, err := io.ReadAll(r)
    if c, ok := r.(io.Closer); ok {
        defer c.Close()
    }
    return work(data, err)
}
```

This is **structural polymorphism** without forcing every caller to adopt a wider interface.

### Anti-pattern: probing for too many interfaces

```go
// BAD — six type assertions on every call
func handle(x any) {
    if a, ok := x.(A); ok { ... }
    if b, ok := x.(B); ok { ... }
    // ...
}
```

If you find yourself probing more than two or three optional interfaces, refactor: ask the caller to pass a richer type, or introduce a single "Capabilities" struct.

---

## `iter.Seq` and `iter.Seq2` Internals (Go 1.23+)

Go 1.23 added user-defined iterators usable in `for ... range` loops:

```go
// From the iter package
type Seq[V any]      func(yield func(V) bool)
type Seq2[K, V any]  func(yield func(K, V) bool)
```

A `Seq[V]` is a function that, when called with a `yield` callback, drives the iteration. The callback returns `false` to stop early.

### Implementation: range over a custom type

```go
package main

import (
    "fmt"
    "iter"
)

type Tree struct {
    val   int
    left  *Tree
    right *Tree
}

// All returns a sequence over an in-order traversal.
func (t *Tree) All() iter.Seq[int] {
    return func(yield func(int) bool) {
        var walk func(n *Tree) bool
        walk = func(n *Tree) bool {
            if n == nil {
                return true
            }
            if !walk(n.left) {
                return false
            }
            if !yield(n.val) {
                return false
            }
            return walk(n.right)
        }
        walk(t)
    }
}

func main() {
    t := &Tree{val: 2,
        left:  &Tree{val: 1},
        right: &Tree{val: 3, right: &Tree{val: 4}},
    }
    for v := range t.All() {
        fmt.Println(v)
    }
    // 1 2 3 4
}
```

### `Seq2` for key-value iteration

```go
type Cache struct {
    data map[string]int
}

func (c *Cache) All() iter.Seq2[string, int] {
    return func(yield func(string, int) bool) {
        for k, v := range c.data {
            if !yield(k, v) {
                return
            }
        }
    }
}

// for k, v := range cache.All() { ... }
```

### Internals: how the compiler lowers `for v := range seq`

Roughly:

```go
// for v := range seq { body }
// becomes:
seq(func(v V) bool {
    body
    return true
})
```

`break` translates to `return false` from the yielded callback. `continue` translates to `return true`.

### Why this matters for std-lib types

`maps.Keys`, `maps.Values`, `slices.All`, `slices.Values`, and `slices.Backward` (Go 1.23) all return `iter.Seq` / `iter.Seq2`. Implementing the same pattern on your collections gives users a uniform iteration syntax with zero allocations on the hot path (the closures escape only if you keep the seq value).

godoc: <https://pkg.go.dev/iter>

---

## `driver.Valuer` and `sql.Scanner`

`database/sql` uses two interfaces to bridge custom Go types and SQL types:

```go
// database/sql/driver
type Valuer interface {
    Value() (Value, error)
}

// database/sql
type Scanner interface {
    Scan(src any) error
}
```

`Valuer` runs when you pass a Go value into `db.Exec`/`db.Query`. `Scanner` runs when scanning a row into your value.

### Implementation: store a struct as JSON in a TEXT column

```go
import (
    "database/sql/driver"
    "encoding/json"
    "errors"
)

type Tags []string

func (t Tags) Value() (driver.Value, error) {
    return json.Marshal(t)
}

func (t *Tags) Scan(src any) error {
    if src == nil {
        *t = nil
        return nil
    }
    var data []byte
    switch v := src.(type) {
    case []byte:
        data = v
    case string:
        data = []byte(v)
    default:
        return errors.New("Tags.Scan: unsupported type")
    }
    return json.Unmarshal(data, t)
}

// Now:
// _, _ = db.Exec("INSERT INTO posts(tags) VALUES(?)", Tags{"go", "sql"})
// var tags Tags
// _ = db.QueryRow("SELECT tags FROM posts WHERE id=?", id).Scan(&tags)
```

The `database/sql` package will detect both interfaces and call them automatically. No driver changes needed.

godoc: <https://pkg.go.dev/database/sql/driver#Valuer>, <https://pkg.go.dev/database/sql#Scanner>

---

## Contract Enforcement Tools

### 1. Compile-time interface checks

```go
var _ io.ReadWriteCloser = (*MyType)(nil)
```

Place this near the type declaration. CI catches contract drift on the next build.

### 2. `go vet -checkstmt` and `staticcheck`

Detect:
- `Read` implementations that lose `n` (`SA4006`)
- `Less` returning the same value for both directions
- Missing `defer Close()`

### 3. `go test -race`

Catches `Read`/`Write` implementations that mutate shared state without locking.

### 4. Property tests with `testing/quick` or `gopter`

```go
import "testing/quick"

func TestReadFullEqualsAllChunks(t *testing.T) {
    f := func(data []byte) bool {
        r := bytes.NewReader(data)
        out, _ := io.ReadAll(r)
        return bytes.Equal(out, data)
    }
    if err := quick.Check(f, nil); err != nil {
        t.Fatal(err)
    }
}
```

### 5. Reflection-based assertions in tests

```go
func TestImplementsAll(t *testing.T) {
    interfaces := []reflect.Type{
        reflect.TypeOf((*io.Reader)(nil)).Elem(),
        reflect.TypeOf((*io.Writer)(nil)).Elem(),
        reflect.TypeOf((*io.Closer)(nil)).Elem(),
    }
    typ := reflect.TypeOf(&MyType{})
    for _, iface := range interfaces {
        if !typ.Implements(iface) {
            t.Errorf("MyType does not implement %v", iface)
        }
    }
}
```

---

## Cheat Sheet

```
FAST-PATH INTERFACES
─────────────────────────────────
io.WriterTo (src) → io.Copy hands off
io.ReaderFrom (dst) → io.Copy hands off
*os.File implements both → kernel sendfile
Implement these on your own types when
you can avoid the 32 KiB intermediate buffer

ITAB
─────────────────────────────────
First conversion: build itab (alloc + hash insert)
Subsequent: hash lookup, single-digit ns
Many distinct concrete types → many itabs
Interface conversions can cause heap escape

OPTIONAL-INTERFACE PROBE
─────────────────────────────────
if x, ok := v.(I); ok { fast path }
Use sparingly; max 2-3 probes per function
http.Flusher, sort.Interface, fmt.Stringer
all use this pattern

iter (Go 1.23+)
─────────────────────────────────
type Seq[V]    func(yield func(V) bool)
type Seq2[K,V] func(yield func(K, V) bool)
for v := range seq { ... }
yield returns false → stop iteration

driver.Valuer / sql.Scanner
─────────────────────────────────
Value() (driver.Value, error)
Scan(src any) error
JSON-in-TEXT, NULL handling, custom types

CONTRACT ENFORCEMENT
─────────────────────────────────
var _ I = (*T)(nil)        compile-time check
go vet, staticcheck         lint
testing/quick               property tests
reflect.Type.Implements     runtime check
```

---

## Summary

The senior view of common interfaces:

1. **Fast paths exist.** `io.Copy` checks for `WriterTo` and `ReaderFrom`; net/http checks for `Flusher` and `Hijacker`. Implement them when your type can deliver bytes more efficiently than the generic loop.
2. **itab is cheap, but not free.** Stable concrete-to-interface pairs hash-lookup in single digit nanoseconds; explosive variety can hurt.
3. **The optional-interface probe** is the std-lib's way of doing graceful degradation — use it sparingly.
4. **`iter.Seq` and `iter.Seq2`** turn user-defined types into `for ... range` participants with zero ceremony.
5. **`driver.Valuer`/`sql.Scanner`** bridge custom Go types into SQL with no driver changes.
6. **Enforce contracts** with `var _ I = (*T)(nil)`, `go vet`, property tests, and reflection.

In professional.md we step back and look at how to design entire systems around these interface boundaries.
