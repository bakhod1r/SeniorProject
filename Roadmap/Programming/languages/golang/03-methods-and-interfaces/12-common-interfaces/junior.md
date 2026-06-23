# Common Interfaces — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The `error` Interface](#the-error-interface)
5. [`fmt.Stringer`](#fmtstringer)
6. [`io.Reader`](#ioreader)
7. [`io.Writer`](#iowriter)
8. `io.Closer` and Composed Interfaces
9. [`sort.Interface`](#sortinterface)
10. [Quick Tour: Other Interfaces You Will Meet](#quick-tour-other-interfaces-you-will-meet)
11. [Common Mistakes](#common-mistakes)
12. [Tricky Points](#tricky-points)
13. [Test](#test)
14. [Cheat Sheet](#cheat-sheet)
15. [Self-Assessment Checklist](#self-assessment-checklist)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What is each interface for?" and "How do I implement it correctly?"

The Go standard library is glued together by a handful of small interfaces. Once your type satisfies one of them, it gains a huge amount of behavior for free — printing, copying, sorting, JSON encoding, HTTP serving, context cancellation. This page is a guided tour of the most fundamental ones.

Every interface here is **tiny** (1-3 methods). That tiny-ness is on purpose: small interfaces are easy to satisfy, easy to mock, and easy to compose.

After reading this file you will:
- Understand the contracts for `error`, `Stringer`, `Reader`, `Writer`, and `sort.Interface`.
- Know how to implement each one with a non-trivial example.
- Recognize when the standard library is silently calling these methods on your type (`fmt.Println` calls `String()`, `io.Copy` calls `Read`/`Write`, `sort.Sort` calls `Len`/`Less`/`Swap`).
- Avoid the common mistakes (returning concrete error types, short-read bugs, broken `Less`).

---

## Prerequisites
- Methods and interfaces basics (sections 01-04 of this chapter)
- Pointer vs value receivers
- Comfort with `package main`, imports, and `go run`

---

## Glossary

| Term | Definition |
|------|------------|
| **error** | Built-in interface: `interface{ Error() string }` |
| **Stringer** | `fmt.Stringer` — `String() string` for human-readable output |
| **Reader** | `io.Reader` — pull bytes from a source |
| **Writer** | `io.Writer` — push bytes to a sink |
| **Closer** | `io.Closer` — release resources via `Close() error` |
| **EOF** | `io.EOF` — sentinel error meaning "no more data" |
| **Short read** | A `Read` call that returned fewer bytes than the buffer size; legal — you must call again |
| **sort.Interface** | `Len() int`, `Less(i, j int) bool`, `Swap(i, j int)` |
| **stable sort** | Equal elements keep their original relative order |
| **Implicit satisfaction** | Go interfaces are satisfied by method set, no `implements` keyword |

---

## The `error` Interface

`error` is the only interface declared by the language itself, in the `builtin` package:

```go
type error interface {
    Error() string
}
```

Anything with an `Error() string` method **is** an error. That's it.

### Implementing `error`

```go
package main

import "fmt"

// ValidationError is a custom error carrying field info.
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: field %q: %s", e.Field, e.Message)
}

func validate(name string) error {
    if name == "" {
        return &ValidationError{Field: "name", Message: "must not be empty"}
    }
    return nil
}

func main() {
    if err := validate(""); err != nil {
        fmt.Println(err) // validation: field "name": must not be empty
    }
}
```

Notice three things:
1. The receiver is a **pointer** (`*ValidationError`). This is the idiomatic choice so that two `ValidationError` instances are not accidentally equal.
2. `Error()` returns a single string — no formatting verbs, no extra arguments.
3. The function returns `error` (the interface), not `*ValidationError` (the concrete type). Returning the concrete type leads to a famous nil-pointer bug — see [find-bug.md](find-bug.md).

### Sentinel errors

Some errors are global, comparable values:

```go
import "io"

if err := r.Read(buf); err == io.EOF {
    // end of stream — not really an "error"
}
```

`io.EOF` is declared as `var EOF = errors.New("EOF")`. You compare with `==` (pre-1.13) or `errors.Is` (1.13+).

### Wrapping (Go 1.13+)

```go
if err := openFile(); err != nil {
    return fmt.Errorf("starting service: %w", err) // %w wraps
}
```

`errors.Is` and `errors.As` walk the wrap chain.

godoc: <https://pkg.go.dev/builtin#error>, <https://pkg.go.dev/errors>

---

## `fmt.Stringer`

```go
type Stringer interface {
    String() string
}
```

`fmt.Println`, `fmt.Sprintf("%v", x)`, `log.Printf("%s", x)` — all of these check whether the argument has a `String()` method. If it does, that method controls the output.

### Implementation: enum-like type

```go
package main

import "fmt"

type Status int

const (
    StatusPending Status = iota
    StatusActive
    StatusClosed
)

func (s Status) String() string {
    switch s {
    case StatusPending:
        return "pending"
    case StatusActive:
        return "active"
    case StatusClosed:
        return "closed"
    default:
        return fmt.Sprintf("Status(%d)", int(s))
    }
}

func main() {
    fmt.Println(StatusActive) // active
    fmt.Printf("%s\n", StatusPending) // pending
    fmt.Printf("%v\n", StatusClosed)  // closed
}
```

### Implementation: composite type

```go
type Money struct {
    Amount   int64 // in cents
    Currency string
}

func (m Money) String() string {
    return fmt.Sprintf("%s %d.%02d", m.Currency, m.Amount/100, m.Amount%100)
}

// Money{Amount: 12345, Currency: "USD"} → "USD 123.45"
```

### Rules for `String()`

1. **Don't recurse**: `return fmt.Sprintf("%v", m)` inside `String()` calls `String()` again — infinite loop.
2. **Don't put logging side effects in it.** `String()` may be called from any `fmt.Print*`, including in panic dumps.
3. **Value receiver** is preferred unless you're already pointer-only.

godoc: <https://pkg.go.dev/fmt#Stringer>

---

## `io.Reader`

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

`Read` fills the buffer `p` with up to `len(p)` bytes from a source. It returns:
- `n` — number of bytes written into `p` (`0 <= n <= len(p)`).
- `err` — non-nil when the stream is over (`io.EOF`) or something failed.

### The contract (read carefully — this trips up everyone)

From the io godoc:
> Read reads up to len(p) bytes into p. It returns the number of bytes read (0 <= n <= len(p)) and any error encountered. Even if Read returns n < len(p), it may use all of p as scratch space during the call. If some data is available but not len(p) bytes, Read conventionally returns what is available instead of waiting for more.
>
> When Read encounters an error or end-of-file condition after successfully reading n > 0 bytes, it returns the number of bytes read. It may return the (non-nil) error from the same call or return the error (and n == 0) from a subsequent call. An instance of this general case is that a Reader returning a non-zero number of bytes at the end of the input stream may return either err == EOF or err == nil. The next Read should return 0, EOF.

In practice this means **always** loop until `EOF`, and **always** process the bytes returned even when `err != nil`.

### Implementation: a reader that emits a fixed message

```go
package main

import (
    "fmt"
    "io"
)

// SlowReader yields bytes from msg, one chunk per Read.
type SlowReader struct {
    msg []byte
    pos int
}

func (r *SlowReader) Read(p []byte) (int, error) {
    if r.pos >= len(r.msg) {
        return 0, io.EOF
    }
    n := copy(p, r.msg[r.pos:])
    r.pos += n
    return n, nil
}

func main() {
    r := &SlowReader{msg: []byte("hello, reader")}
    buf := make([]byte, 5)
    for {
        n, err := r.Read(buf)
        if n > 0 {
            fmt.Printf("got %q\n", buf[:n])
        }
        if err == io.EOF {
            break
        }
        if err != nil {
            fmt.Println("error:", err)
            break
        }
    }
}
```

Output:
```
got "hello"
got ", rea"
got "der"
```

### Reading the right way with helpers

For most code you don't loop manually — you reach for `io.ReadAll`, `bufio.NewReader`, or `io.ReadFull`:

```go
data, err := io.ReadAll(r) // reads until EOF, returns []byte
```

godoc: <https://pkg.go.dev/io#Reader>

---

## `io.Writer`

```go
type Writer interface {
    Write(p []byte) (n int, err error)
}
```

The mirror of `Reader`: it pushes bytes from `p` into the sink. The contract:
- `Write` must write all of `p` or return an error. If `n < len(p)`, it must return a non-nil error.
- Implementations must not retain `p` after `Write` returns (the caller may reuse the buffer).

### Implementation: a writer that uppercases bytes into a backing buffer

```go
package main

import (
    "bytes"
    "fmt"
    "unicode"
)

// UpperWriter is an io.Writer that uppercases ASCII letters as it writes.
type UpperWriter struct {
    buf bytes.Buffer
}

func (w *UpperWriter) Write(p []byte) (int, error) {
    for _, b := range p {
        if b < 128 {
            w.buf.WriteByte(byte(unicode.ToUpper(rune(b))))
        } else {
            w.buf.WriteByte(b)
        }
    }
    return len(p), nil
}

func (w *UpperWriter) String() string { return w.buf.String() }

func main() {
    var w UpperWriter
    fmt.Fprint(&w, "hello, world")
    fmt.Println(w.String()) // HELLO, WORLD
}
```

`fmt.Fprint` accepts any `io.Writer` — your custom type now works with the entire `fmt` package.

### Why so many things in std-lib are `Writer`s

- `os.Stdout`, `os.Stderr`, `*os.File`
- `*bytes.Buffer`, `*strings.Builder`
- `*bufio.Writer`
- `gzip.Writer`, `tls.Conn`, `http.ResponseWriter`

You can chain them: write to a `gzip.Writer` that wraps a `bufio.Writer` that wraps a `*os.File`.

godoc: <https://pkg.go.dev/io#Writer>

---

## `io.Closer` and Composed Interfaces

```go
type Closer interface {
    Close() error
}
```

Anything that holds a resource (file, socket, db handle) implements `Closer`. The `io` package then composes:

```go
type ReadCloser interface {
    Reader
    Closer
}

type WriteCloser interface {
    Writer
    Closer
}

type ReadWriter interface {
    Reader
    Writer
}

type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

This is **interface embedding**. A type satisfies `ReadCloser` if it has both `Read` and `Close`.

### Example: a file-like type

```go
type MemFile struct {
    data []byte
    pos  int
}

func (f *MemFile) Read(p []byte) (int, error) {
    if f.pos >= len(f.data) {
        return 0, io.EOF
    }
    n := copy(p, f.data[f.pos:])
    f.pos += n
    return n, nil
}

func (f *MemFile) Close() error {
    f.data = nil // release memory
    return nil
}

// Now *MemFile satisfies io.Reader, io.Closer, AND io.ReadCloser
var _ io.ReadCloser = (*MemFile)(nil)
```

The `var _ io.ReadCloser = (*MemFile)(nil)` line is a compile-time assertion: if `*MemFile` does not satisfy `io.ReadCloser`, the build fails. Use this whenever you want the compiler to police your contract.

godoc: <https://pkg.go.dev/io#Closer>

---

## `sort.Interface`

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

Implement these three methods and `sort.Sort` works on your collection.

### Implementation: sorting people by age, then name

```go
package main

import (
    "fmt"
    "sort"
)

type Person struct {
    Name string
    Age  int
}

type ByAgeThenName []Person

func (s ByAgeThenName) Len() int { return len(s) }
func (s ByAgeThenName) Less(i, j int) bool {
    if s[i].Age != s[j].Age {
        return s[i].Age < s[j].Age
    }
    return s[i].Name < s[j].Name
}
func (s ByAgeThenName) Swap(i, j int) { s[i], s[j] = s[j], s[i] }

func main() {
    people := []Person{
        {"Charlie", 30}, {"Alice", 25}, {"Bob", 30}, {"Dave", 25},
    }
    sort.Sort(ByAgeThenName(people))
    for _, p := range people {
        fmt.Printf("%s (%d)\n", p.Name, p.Age)
    }
    // Alice (25)
    // Dave (25)
    // Bob (30)
    // Charlie (30)
}
```

### Rules for `Less`

`Less(i, j)` must implement a **strict weak ordering**:
1. **Irreflexive**: `Less(i, i)` is false.
2. **Asymmetric**: if `Less(i, j)` then not `Less(j, i)`.
3. **Transitive**: if `Less(i, j)` and `Less(j, k)` then `Less(i, k)`.
4. **Transitive equivalence**: if neither `Less(i, j)` nor `Less(j, i)`, then `i` and `j` are "equal" for sort purposes; this equivalence must be transitive.

Violating these gives non-deterministic output and can cause the sort to loop or panic.

### Helper: `sort.Slice` (Go 1.8+)

For one-off sorts you don't need to declare a new type:

```go
sort.Slice(people, func(i, j int) bool {
    return people[i].Age < people[j].Age
})
```

But `sort.Interface` is still important for reusable types and stable sorts.

godoc: <https://pkg.go.dev/sort#Interface>

---

## Quick Tour: Other Interfaces You Will Meet

You will see these interfaces in the wild. Each gets its own deep dive in the middle/senior pages.

### `json.Marshaler` / `json.Unmarshaler`

```go
type Marshaler interface {
    MarshalJSON() ([]byte, error)
}
type Unmarshaler interface {
    UnmarshalJSON([]byte) error
}
```

Custom JSON encoding/decoding. Implement when the default tag-based encoding isn't enough.

### `http.Handler`

```go
type Handler interface {
    ServeHTTP(http.ResponseWriter, *http.Request)
}
```

Anything that handles an HTTP request. `http.HandlerFunc` adapts a plain function into one.

### `context.Context`

```go
type Context interface {
    Deadline() (time.Time, bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Carries cancellation, deadlines, and request-scoped values. Pass it as the **first argument** to functions that do I/O or wait.

### `fs.FS` (Go 1.16+)

```go
type FS interface {
    Open(name string) (File, error)
}
```

A virtual file system. `os.DirFS`, `embed.FS`, `zip.Reader`, `txtar` all satisfy it.

### `iter.Seq` and `iter.Seq2` (Go 1.23+)

```go
type Seq[V any]      func(yield func(V) bool)
type Seq2[K, V any]  func(yield func(K, V) bool)
```

User-defined iterators usable in `for v := range mySeq`. We will implement these in middle.md and senior.md.

### `driver.Valuer` and `sql.Scanner`

```go
type Valuer interface {
    Value() (Value, error)
}
type Scanner interface {
    Scan(src any) error
}
```

How custom types travel into and out of SQL drivers.

---

## Common Mistakes

| Mistake | Why it hurts |
|---------|--------------|
| Returning `*MyError` instead of `error` | Nil concrete type wrapped in interface is non-nil → bug |
| Calling `fmt.Sprintf("%v", m)` inside `String()` | Infinite recursion |
| Ignoring `n` when `Read` returns an error | You drop valid data — never retry from scratch |
| Implementing `Less` with `<=` | Breaks irreflexivity; sort gives wrong results |
| Forgetting to `Close` after success | Resource leak; use `defer` |
| `Write` returning `n < len(p)` and `nil` error | Violates contract; callers retry indefinitely |
| Relying on a specific `Read` returning everything | A single `Read` can be short — always loop |

---

## Tricky Points

### 1. `io.EOF` with `n > 0`

Some readers return data **and** EOF in the same call:

```go
n, err := r.Read(buf)
// process buf[:n] BEFORE checking err
if err == io.EOF {
    // handle end
}
```

If you bail out on `err != nil` before consuming `buf[:n]`, you lose the last chunk.

### 2. A nil-typed error is not nil

```go
func bad() error {
    var e *MyError = nil
    return e // BUG: returns a non-nil interface holding a nil pointer
}

if err := bad(); err != nil {
    fmt.Println("bug:", err) // prints, even though e was nil
}
```

Always declare the return type as `error` and return `nil` literally for the success path.

### 3. `String()` for pointer types

```go
type T struct{ n int }
func (t *T) String() string { return fmt.Sprintf("T(%d)", t.n) }

var x T
fmt.Println(x) // calls (*T).String? Yes — fmt addresses x for you when possible.
```

But if `x` is not addressable (e.g. a map value), `String()` is **not** called. Use a value receiver to be safe.

---

## Test

### 1. What does this print?
```go
type E struct{}
func (e *E) Error() string { return "boom" }
func may() error { var e *E; return e }
err := may()
fmt.Println(err == nil)
```
- a) true
- b) false
- c) compile error
- d) panic

**Answer: b** — interface holding a nil concrete pointer is non-nil.

### 2. Which signature is correct for `io.Reader.Read`?
- a) `Read(p []byte) error`
- b) `Read(p []byte) (n int, err error)`
- c) `Read() ([]byte, error)`
- d) `Read(n int) []byte`

**Answer: b**

### 3. After `n, err := r.Read(buf)` returns `n=5, err=io.EOF`, you should:
- a) Discard `buf` and break
- b) Process `buf[:5]`, then break
- c) Retry the Read
- d) Panic

**Answer: b**

### 4. What does `sort.Interface.Less(i, i)` need to return?
- a) true
- b) false
- c) doesn't matter
- d) panic

**Answer: b** — must be irreflexive.

### 5. Which interface does `fmt.Println(x)` look for first?
- a) `error`
- b) `fmt.Stringer`
- c) `io.Writer`
- d) `json.Marshaler`

**Answer: b**

---

## Cheat Sheet

```
ERROR
─────────────────────────
type error interface { Error() string }
return error (the interface), not the concrete type

STRINGER
─────────────────────────
type Stringer interface { String() string }
fmt.Println / Printf %s / Sprintf %v all use it

READER / WRITER
─────────────────────────
Read(p []byte)  (n int, err error)
Write(p []byte) (n int, err error)
Read may return n>0 AND err — process bytes first
Write must write all of p or return err

CLOSER and friends
─────────────────────────
ReadCloser  = Reader + Closer
WriteCloser = Writer + Closer
ReadWriter  = Reader + Writer
defer x.Close()

SORT.INTERFACE
─────────────────────────
Len() int
Less(i, j int) bool   // strict weak ordering
Swap(i, j int)
sort.Sort(myCollection)
```

---

## Self-Assessment Checklist

- [ ] I can write a custom `error` type with a pointer receiver
- [ ] I know why `func() error` should return `nil` literally on success
- [ ] I can implement `Stringer` for an enum-style type
- [ ] I understand the `io.Reader` short-read rule
- [ ] I can implement `io.Writer` for a memory-backed type
- [ ] I know why `defer w.Close()` is the standard pattern
- [ ] I can implement `sort.Interface` and explain the `Less` rules
- [ ] I can use `var _ Interface = (*Type)(nil)` as a compile-time check

---

## Summary

The std-lib is a federation of tiny interfaces. Five of them carry the bulk of the weight:

| Interface | Method(s) | Used by |
|-----------|-----------|---------|
| `error` | `Error() string` | every function that can fail |
| `fmt.Stringer` | `String() string` | `fmt.*`, `log.*` |
| `io.Reader` | `Read([]byte) (int, error)` | `io.Copy`, `bufio`, `json.NewDecoder` |
| `io.Writer` | `Write([]byte) (int, error)` | `fmt.Fprint`, `io.Copy`, `gzip.NewWriter` |
| `sort.Interface` | `Len/Less/Swap` | `sort.Sort`, `sort.Stable` |

Implementing them correctly is the gateway to plugging your types into the rest of Go.

---

## Further Reading

- [Effective Go — Interfaces](https://go.dev/doc/effective_go#interfaces)
- [io package](https://pkg.go.dev/io)
- [fmt package](https://pkg.go.dev/fmt)
- [sort package](https://pkg.go.dev/sort)
- [Errors are values (Rob Pike)](https://go.dev/blog/errors-are-values)
- [Working with errors in Go 1.13](https://go.dev/blog/go1.13-errors)
