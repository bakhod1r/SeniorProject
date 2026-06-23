# Pointer Receivers — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Memory Model and Receiver Choice](#memory-model-and-receiver-choice)
3. [Escape Analysis Deep Dive](#escape-analysis-deep-dive)
4. [Receiver Choice for Standard Library Patterns](#receiver-choice-for-standard-library-patterns)
5. [Concurrency Patterns](#concurrency-patterns)
6. [Embedding Trade-offs](#embedding-trade-offs)
7. [Lifecycle Management](#lifecycle-management)
8. [Performance Profiling](#performance-profiling)
9. [Testing Pointer Receiver Methods](#testing-pointer-receiver-methods)
10. [Anti-patterns](#anti-patterns)
11. [Cheat Sheet](#cheat-sheet)

---

## Introduction

A senior-level discussion of pointer receivers covers:
- Memory model — what memory semantics a pointer receiver produces
- Escape analysis — when the receiver moves to the heap
- Which conventions the standard library follows, and why
- Pointer receiver responsibilities in concurrent code
- Lifecycle — who allocates, who cleans up

---

## Memory Model and Receiver Choice

### Go memory model

The Go memory model defines "happens-before" relationships. With a pointer receiver:

1. One goroutine calls `c.Inc()` — `c.n` is mutated
2. Another goroutine calls `c.Get()` — may observe a stale value (without synchronization)

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }
func (c *Counter) Get() int { return c.n }
```

Without a happens-before between `Inc` and `Get` — race condition.

### Memory ordering

`atomic` operations provide explicit memory ordering:

```go
type Counter struct{ n atomic.Int64 }
func (c *Counter) Inc() { c.n.Add(1) }       // sequentially consistent
func (c *Counter) Get() int64 { return c.n.Load() }
```

### Lock-free design

With a pointer receiver, atomic primitives can be used. With a value receiver the atomic gets copied and stops working.

---

## Escape Analysis Deep Dive

### When does the receiver escape to the heap?

```go
type S struct{ n int }
func (s *S) Compute() int { return s.n * 2 }

// 1. Stays on the stack
func f() int {
    s := S{n: 5}
    return s.Compute()
}

// 2. Escapes to the heap (passed via interface)
func g() {
    s := S{n: 5}
    var c interface{ Compute() int } = &s
    c.Compute()
}

// 3. Escapes to the heap (returned)
func h() *S {
    s := S{n: 5}
    return &s
}
```

### Inspecting with `go build -gcflags='-m=2'`

```
$ go build -gcflags='-m=2' main.go
main.go:5:6: can inline (*S).Compute
main.go:9:6: can inline f
main.go:10:7: s does not escape
main.go:13:6: can inline g
main.go:14:7: s escapes to heap
main.go:18:6: can inline h
main.go:19:7: &s escapes to heap
```

### A pointer receiver is often not the cause of escape

A pointer receiver is not, by itself, a reason to escape. The cause of escape is where the pointer goes:
- Local — stack
- Returned — heap
- Interface — heap (often)
- Goroutine — heap

---

## Receiver Choice for Standard Library Patterns

### `fmt.Stringer`

```go
type Stringer interface { String() string }
```

The standard library prefers value receivers for `String()` (immutable):

```go
func (d Duration) String() string { ... }      // time.Duration — value
func (e *RemoveError) Error() string { ... }   // likely pointer — error wrapping
```

### `error` interface

```go
type error interface { Error() string }
```

Concrete error types often use a pointer receiver:

```go
type MyError struct{ msg string }
func (e *MyError) Error() string { return e.msg }
```

When the type is pointer-based, equality comparison with `==` is pointer identity. For sentinel errors:

```go
var ErrNotFound = &MyError{msg: "not found"}

if err == ErrNotFound { ... }  // pointer comparison
```

### `io.Reader`/`io.Writer`

```go
type Reader interface { Read(p []byte) (n int, err error) }
```

Concrete — usually pointer receiver, because internal state (offset, buffer) changes:

```go
type bufio.Reader struct { ... }
func (b *Reader) Read(p []byte) (n int, err error) { ... }
```

### `sort.Interface`

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

`Swap` mutates — pointer receiver. But the built-in `sort.IntSlice` uses a value receiver because copying the slice header is cheap:

```go
type IntSlice []int
func (p IntSlice) Len() int           { return len(p) }
func (p IntSlice) Less(i, j int) bool { return p[i] < p[j] }
func (p IntSlice) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }  // slice header is by value, but the underlying array is shared
```

When a slice has a value receiver, the slice header is copied, but the **underlying array is the same**. That is why mutation works.

---

## Concurrency Patterns

### Pattern 1: Mutex + pointer receiver

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]any
}

func (c *Cache) Get(k string) (any, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    v, ok := c.m[k]
    return v, ok
}
```

### Pattern 2: Atomic counter

```go
type RequestCounter struct {
    success atomic.Int64
    failure atomic.Int64
}

func (rc *RequestCounter) RecordSuccess() { rc.success.Add(1) }
func (rc *RequestCounter) RecordFailure() { rc.failure.Add(1) }
func (rc *RequestCounter) Stats() (int64, int64) {
    return rc.success.Load(), rc.failure.Load()
}
```

### Pattern 3: Channel-based ownership

```go
type Worker struct {
    in  chan Job
    out chan Result
}

func NewWorker() *Worker {
    w := &Worker{in: make(chan Job), out: make(chan Result)}
    go w.run()
    return w
}

func (w *Worker) run() {
    for j := range w.in {
        w.out <- process(j)
    }
}

func (w *Worker) Submit(j Job) { w.in <- j }
func (w *Worker) Recv() Result { return <-w.out }
func (w *Worker) Stop()        { close(w.in) }
```

A concurrent-safe interface — one goroutine owns the internal state (`worker.run`), and others interact through channels.

---

## Embedding Trade-offs

### Value embed

```go
type Base struct { m sync.Mutex }
func (b *Base) Lock() { b.m.Lock() }

type S struct { Base }   // value embed

var s S
s.Lock()  // OK — Go: (&s.Base).Lock()
```

But if `S` is copied:

```go
s2 := s   // Base is copied too — the mutex moves (bad)
```

`go vet` will issue a warning.

### Pointer embed

```go
type S struct { *Base }

s := S{Base: &Base{}}
s2 := s   // *Base is copied (8 bytes), but the Base struct is the same
```

Pointer embed works correctly with mutexes — every `S` points to the same `Base` instance.

### Promotion and method set

```go
type Base struct{}
func (b Base)  ValM() {}
func (b *Base) PtrM() {}

type S1 struct { Base }    // value embed
type S2 struct { *Base }   // pointer embed

var s1 S1
var s2 S2 = S2{Base: &Base{}}

s1.ValM()  // OK
s1.PtrM()  // OK (s1 is addressable)
s2.ValM()  // OK
s2.PtrM()  // OK
```

But interface satisfaction:

```go
type Mr interface { PtrM() }

var _ Mr = s1    // ERROR — S1's method set with value embed
var _ Mr = &s1   // OK
var _ Mr = s2    // OK — *Base embed
```

---

## Lifecycle Management

### Allocation responsibility

With a pointer receiver, **who** allocates the struct?

```go
// Caller allocates
type Server struct { ... }
func (s *Server) Start() {}

s := &Server{}   // caller
s.Start()
```

Or:

```go
// Constructor allocates
func NewServer() *Server { return &Server{} }
s := NewServer()
s.Start()
```

The constructor pattern handles internal initialization the caller does not need to know about (channels, mutexes, default values).

### Cleanup responsibility

```go
type DB struct{ conn *sql.DB }

func NewDB(dsn string) (*DB, error) {
    conn, err := sql.Open("postgres", dsn)
    if err != nil { return nil, err }
    return &DB{conn: conn}, nil
}

func (d *DB) Close() error {
    return d.conn.Close()
}

// Usage
db, err := NewDB(dsn)
if err != nil { ... }
defer db.Close()
```

`Close()` method — pointer receiver, cleans up the internal resource.

### `Closer` interface

```go
type Closer interface { Close() error }

func cleanup(closers ...Closer) {
    for _, c := range closers {
        c.Close()
    }
}
```

---

## Performance Profiling

### Benchmark pointer vs value

```go
type Big struct { data [1024]int }

func (b Big)  Sum() int { sum := 0; for _, v := range b.data { sum += v }; return sum }
func (b *Big) PtrSum() int { sum := 0; for _, v := range b.data { sum += v }; return sum }

func BenchmarkBigValue(b *testing.B) {
    big := Big{}
    for i := 0; i < b.N; i++ { big.Sum() }
}

func BenchmarkBigPtr(b *testing.B) {
    big := &Big{}
    for i := 0; i < b.N; i++ { big.PtrSum() }
}
```

Typical result:
- `BigValue`: 1.5µs/op (8KB copy per call)
- `BigPtr`: 100ns/op

### Inline opportunity

Pointer receiver methods are often good inline candidates:

```go
go build -gcflags='-m'
# can inline (*Counter).Inc
# inlining call to (*Counter).Inc
```

Inline = no call overhead.

---

## Testing Pointer Receiver Methods

### Mock interface implementation

```go
type UserRepo interface {
    Find(id string) (*User, error)
    Save(u *User) error
}

type fakeRepo struct{ users map[string]*User }
func (f *fakeRepo) Find(id string) (*User, error) {
    if u, ok := f.users[id]; ok { return u, nil }
    return nil, errors.New("not found")
}
func (f *fakeRepo) Save(u *User) error {
    f.users[u.ID] = u
    return nil
}
```

### State checking

```go
func TestCounter_Inc(t *testing.T) {
    c := &Counter{}
    c.Inc(); c.Inc(); c.Inc()
    if c.n != 3 {
        t.Errorf("expected 3, got %d", c.n)
    }
}
```

With a pointer receiver, you can check the field directly (in the test package — if exposed) or via a getter method.

### Concurrent test

```go
func TestSafeCounter_Concurrent(t *testing.T) {
    c := &SafeCounter{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c.Inc() }()
    }
    wg.Wait()
    if c.Value() != 1000 {
        t.Errorf("expected 1000, got %d", c.Value())
    }
}
```

`go test -race` will catch the race.

---

## Anti-patterns

### 1. Value receiver with a mutex

```go
// BAD
type X struct{ mu sync.Mutex; n int }
func (x X) Inc() { x.mu.Lock(); x.n++; x.mu.Unlock() }
```

`go vet` issues a warning.

### 2. Mixed receivers

```go
// BAD
type Buffer struct{ data []byte }
func (b Buffer)  Len() int { return len(b.data) }
func (b *Buffer) Write(p []byte) { ... }
```

The method set is confusing. Make all of them pointer.

### 3. Using a returned pointer without checking

```go
u := repo.Find(id)
fmt.Println(u.Name)   // u may be nil — panic
```

Correct:

```go
u, err := repo.Find(id)
if err != nil { return err }
fmt.Println(u.Name)
```

### 4. Sharing a pointer receiver across goroutines without synchronization

```go
c := &Counter{}
go c.Inc()
go c.Inc()
fmt.Println(c.n)  // race
```

### 5. Pointer lifetime is unclear

```go
// BAD — caller forgets to Close
func Open(path string) *File { ... }
```

Better: return an error + documentation:

```go
func Open(path string) (*File, error) { ... }
// Caller MUST call Close()
```

---

## Cheat Sheet

```
SENIOR-LEVEL POINTER RECEIVER
────────────────────────────────
✓ Memory model — with atomic primitives
✓ Escape analysis — when heap allocation happens
✓ Follow standard library conventions
✓ Concurrency — mutex/atomic/channel
✓ Embedding — pointer vs value embed
✓ Lifecycle — who allocates, who cleans up

PROFILING
────────────────────────────────
go build -gcflags='-m=2'  # escape analysis
go test -bench=. -cpuprofile=cpu.prof
go test -race             # race detector

ANTI-PATTERN WARNINGS
────────────────────────────────
✗ Value receiver with a mutex
✗ Mixed receivers on the same type
✗ Using a nil pointer without checking
✗ Sharing a pointer without synchronization
✗ Unclear lifecycle (Close)
```

---

## Summary

Senior-level pointer receiver:
- Working with the memory model and atomic operations
- Understanding escape analysis and profiling it
- Following standard library conventions
- Correct usage with concurrency primitives
- Embedding and interface satisfaction nuances
- Lifecycle management — constructor + close

Pointer receiver — Go's powerful tool, but it demands more responsibility from you: nil checks, synchronization, lifecycle. At a professional level we examine it in the context of team standards and library design.
