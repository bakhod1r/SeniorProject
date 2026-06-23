# Struct Method Promotion — Optimize

This file focuses on the performance characteristics of struct embedding and method promotion: memory layout, dispatch cost, devirtualization, mutex co-location, and pool reuse.

---

## 1. Embedded value vs embedded pointer — layout & access cost

### Embedded value — inline layout

```go
type Logger struct {
    prefix string
    level  int
}
func (l Logger) Log(msg string) { /* ... */ }

type Server struct {
    Logger        // embedded by value
    addr   string
}
```

`Logger` lives **inline** inside `Server`. The selector `s.Log("hi")` becomes a direct field read — no pointer chase. `sizeof(Server) = sizeof(Logger) + sizeof(string)` plus alignment padding.

### Embedded pointer — extra indirection

```go
type Server struct {
    *Logger        // embedded by pointer
    addr string
}
```

Now `Server` holds an 8-byte pointer; `Logger` lives elsewhere on the heap. Every promoted call costs an extra dereference. Plus a possible nil check at runtime.

### Benchmark

```go
func BenchmarkEmbeddedValue(b *testing.B) {
    s := Server{Logger: Logger{prefix: "x", level: 1}}
    for i := 0; i < b.N; i++ {
        _ = s.level   // direct field read
    }
}

func BenchmarkEmbeddedPointer(b *testing.B) {
    s := ServerP{Logger: &Logger{prefix: "x", level: 1}}
    for i := 0; i < b.N; i++ {
        _ = s.level   // pointer dereference + field read
    }
}
```

Typical: value embed ~0.3 ns/op, pointer embed ~0.6-1.0 ns/op. The gap widens once the cache is cold.

---

## 2. Selector chain depth & inlining

The compiler must walk the embedding tree to resolve `s.Log`. Shallow chains inline cleanly; deep chains can defeat inlining.

```go
type A struct{ x int }
func (a A) Hit() int { return a.x }

type B struct{ A }
type C struct{ B }
type D struct{ C }

var d D
_ = d.Hit()   // resolved as d.C.B.A.Hit()
```

For value-embedded chains the compiler folds the offsets at compile time — `d.Hit()` becomes a single load at offset 0. There is no per-level cost.

But mix in a pointer embed and each level adds a load:

```go
type B struct{ *A }   // pointer
type C struct{ *B }   // pointer
type D struct{ *C }   // pointer

d.Hit()   // 3 dereferences
```

### Benchmark

```go
func BenchmarkChainValue(b *testing.B) {
    d := D{C: C{B: B{A: A{x: 7}}}}
    for i := 0; i < b.N; i++ { _ = d.Hit() }
}

func BenchmarkChainPointer(b *testing.B) {
    d := DP{C: &CP{B: &BP{A: &A{x: 7}}}}
    for i := 0; i < b.N; i++ { _ = d.Hit() }
}
```

Inlining check:

```bash
go build -gcflags='-m' main.go
# main.go:14: can inline A.Hit
# main.go:20: inlining call to A.Hit
```

If the embedded method is small and the chain is value-only, expect full inlining.

---

## 3. Devirtualization across a promoted call

Calling a promoted method through the **concrete** type lets the compiler see the real receiver and devirtualize:

```go
type Writer struct{ buf []byte }
func (w *Writer) Write(p []byte) (int, error) {
    w.buf = append(w.buf, p...)
    return len(p), nil
}

type Conn struct {
    *Writer        // embedded
    addr string
}

c := &Conn{Writer: &Writer{}}
c.Write([]byte("hi"))   // static dispatch — devirtualized
```

If you instead pass the embedded type through an `io.Writer` interface, the call goes via itab and **cannot** be inlined:

```go
var w io.Writer = c
w.Write([]byte("hi"))   // dynamic dispatch via itab
```

### Benchmark

```go
func BenchmarkPromotedConcrete(b *testing.B) {
    c := &Conn{Writer: &Writer{}}
    p := []byte("hi")
    for i := 0; i < b.N; i++ { _, _ = c.Write(p) }
}

func BenchmarkPromotedInterface(b *testing.B) {
    var w io.Writer = &Conn{Writer: &Writer{}}
    p := []byte("hi")
    for i := 0; i < b.N; i++ { _, _ = w.Write(p) }
}
```

Concrete: full inline + escape analysis. Interface: itab lookup, no inline. Difference is usually 2-4 ns/op per call — material in tight loops.

---

## 4. Mutex embed — cache line co-location

Embedding a `sync.Mutex` keeps it adjacent to the data it guards:

```go
type Counter struct {
    sync.Mutex   // embedded — co-located in cache line with n
    n int
}

func (c *Counter) Inc() {
    c.Lock()
    c.n++
    c.Unlock()
}
```

The lock state and the protected field land in the **same 64-byte cache line** on most architectures. Lock acquisition warms exactly the line you need next, so the post-lock write hits L1.

### Counter-example — pointer-embedded mutex

```go
type Counter struct {
    *sync.Mutex   // separate allocation, separate cache line
    n int
}
```

Now `Lock()` warms one line, `n++` warms another — two L1 misses under contention.

### Copy hazard

Value-embedding a mutex makes the parent struct **non-copyable**:

```go
c := Counter{}
d := c   // go vet: assignment copies lock value
```

Always pass `*Counter`, never `Counter`. The compiler does not flag it; `go vet` does.

### Benchmark

```go
func BenchmarkMutexEmbedValue(b *testing.B) {
    c := &CounterV{}
    for i := 0; i < b.N; i++ { c.Inc() }
}

func BenchmarkMutexEmbedPointer(b *testing.B) {
    c := &CounterP{Mutex: &sync.Mutex{}}
    for i := 0; i < b.N; i++ { c.Inc() }
}
```

Single-threaded the difference is small; under contention with many goroutines the value-embedded form wins because both the lock word and the payload share a line.

---

## 5. Embedding to satisfy an interface vs explicit method

Promotion to satisfy an interface costs nothing extra:

```go
type Reader interface{ Read(p []byte) (int, error) }

type File struct{ fd int }
func (f *File) Read(p []byte) (int, error) { /* ... */ }

type LoggedFile struct {
    *File   // promotes Read — LoggedFile satisfies Reader
}

// vs explicit forward
type LoggedFile2 struct{ f *File }
func (l *LoggedFile2) Read(p []byte) (int, error) { return l.f.Read(p) }
```

Both compile to the same machine code. The explicit forward is just a thin wrapper that the compiler usually inlines. The promoted version skips the wrapper entirely — the method table for `*LoggedFile` points at `(*File).Read` directly.

### Benchmark

```go
func BenchmarkPromotedSatisfy(b *testing.B) {
    var r io.Reader = &LoggedFile{File: &File{fd: 1}}
    p := make([]byte, 16)
    for i := 0; i < b.N; i++ { _, _ = r.Read(p) }
}

func BenchmarkExplicitForward(b *testing.B) {
    var r io.Reader = &LoggedFile2{f: &File{fd: 1}}
    p := make([]byte, 16)
    for i := 0; i < b.N; i++ { _, _ = r.Read(p) }
}
```

Identical numbers within noise. The choice is about clarity, not speed.

---

## 6. Promoted method call: zero overhead vs explicit forward

The compiler emits a **method wrapper** for promoted methods. For value embeds it adds a fixed offset; for pointer embeds it adds a load + offset. After inlining there is no overhead at all.

```go
type Inner struct{ v int }
func (i *Inner) Get() int { return i.v }

type Outer struct{ Inner }   // value embed

o := Outer{Inner: Inner{v: 42}}
_ = o.Get()   // generated wrapper: (*Outer).Get(o) { return (&o.Inner).Get() }
```

Disassembly check:

```bash
go build -gcflags='-S' main.go 2>&1 | grep -A3 'Get'
# (*Outer).Get is just a jmp/call to (*Inner).Get with adjusted receiver
```

The wrapper is tiny and inlinable, so calls become a single load.

### Benchmark

```go
func BenchmarkPromoted(b *testing.B) {
    o := &Outer{Inner: Inner{v: 42}}
    for i := 0; i < b.N; i++ { _ = o.Get() }
}

func BenchmarkExplicitWrap(b *testing.B) {
    o := &OuterE{i: Inner{v: 42}}   // explicit field
    for i := 0; i < b.N; i++ { _ = o.GetWrap() }
}
```

Both around the same nanosecond mark. Use promotion when the API of the inner type **is** part of the outer type's API; use an explicit field + named method when you want to filter or rename.

---

## 7. Avoid embedding when only one method is needed

Embedding pulls in the **entire** method set — public fields, helpers, everything. If the outer type only needs one method, embedding inflates the struct's API surface and prevents future evolution.

```go
// Bad — embeds full Logger just to call Log
type Service struct {
    *Logger
    db *sql.DB
}

// Good — narrow dependency
type Service struct {
    log func(string)
    db  *sql.DB
}

func New(l *Logger, db *sql.DB) *Service {
    return &Service{log: l.Log, db: db}
}
```

Or accept a tiny interface:

```go
type logFn interface{ Log(string) }
type Service struct {
    log logFn
    db  *sql.DB
}
```

### Size impact

Embedding `*Logger` adds 8 bytes; embedding `Logger` by value adds the full size of `Logger`. A function-pointer field is 8 bytes regardless. For `[]Service` slices with millions of entries, the layout choice changes RAM usage measurably.

### Benchmark — payload size

```go
func BenchmarkAllocEmbedValue(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = make([]ServiceWithLogger, 1024)
    }
}

func BenchmarkAllocFnField(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = make([]ServiceWithFn, 1024)
    }
}
```

The fn-field version allocates fewer bytes per element and warms fewer cache lines on iteration.

---

## 8. Layout impact on struct size & GC scan

Embedding extends the parent struct's layout. The GC scans every pointer-typed field, including those reached through embedded structs.

```go
type Big struct {
    cache map[string]string
    mu    sync.Mutex
    list  []*Item
}

type Wrapper struct {
    Big           // 3 pointer-shaped fields scanned
    name string
}
```

`Wrapper` now has 4 GC-relevant words. If you only need `cache`, embed less — or store `*Big` and live with one indirection. Field ordering also matters: putting all pointer fields together keeps the GC bitmap dense and shrinks scan time.

### Tips

- Group pointer fields together — better GC scan locality.
- Group small numeric fields to reduce padding.
- Use `unsafe.Sizeof(T{})` and `go vet -fieldalignment` to verify.

```go
// Good order — pointers together
type Server struct {
    *Logger
    cache map[string]string
    addr  string
    port  int
    flags uint8
}
```

### Benchmark — GC pressure

```go
func BenchmarkGCEmbedded(b *testing.B) {
    s := make([]*Wrapper, 100_000)
    for i := range s {
        s[i] = &Wrapper{Big: Big{cache: map[string]string{}}}
    }
    runtime.GC()
    b.ResetTimer()
    for i := 0; i < b.N; i++ { runtime.GC() }
}
```

Compare against the same benchmark with a non-embedded variant — GC time scales with pointer count per object.

---

## 9. sync.Pool with embedded struct types

Pools work well with embedded types **when the outer struct has no extra state to reset**:

```go
type Buffer struct {
    bytes.Buffer   // embedded
    id int
}

var pool = sync.Pool{
    New: func() any { return &Buffer{} },
}

func Get() *Buffer {
    b := pool.Get().(*Buffer)
    b.Reset()   // promoted from bytes.Buffer
    b.id = 0    // also reset outer field
    return b
}

func Put(b *Buffer) { pool.Put(b) }
```

The `Reset()` method is promoted, so the cleanup looks ergonomic. Beware: any **outer** fields you forget to reset leak across pool round-trips.

### Benchmark

```go
func BenchmarkPoolEmbedded(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        buf := Get()
        buf.WriteString("hello")
        Put(buf)
    }
}

func BenchmarkNoPool(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var buf Buffer
        buf.WriteString("hello")
    }
}
```

Pool reuse drops allocs/op to zero in steady state; the embedded layout means the inner buffer's backing array is reused too.

### Pitfall — pointer embeds in pooled objects

Pooling works best when the embedded type is value-embedded: one allocation per pooled object. With a pointer embed the inner allocation may be GC'd separately, defeating the pool.

---

## 10. When the wrapper hides escape — watch -gcflags

Embedded methods can change escape analysis. When the outer struct holds the inner by value, calling a pointer-receiver method auto-takes the address — which can force the outer struct onto the heap if its address is captured.

```go
type Inner struct{ buf [64]byte }
func (i *Inner) Fill() { /* ... */ }

type Outer struct{ Inner }

func use() {
    var o Outer
    o.Fill()      // takes &o.Inner
    save(&o)      // captures address of o — o escapes
}
```

Run `go build -gcflags='-m=2'` to see where promotion forced an escape.

---

## 11. Cheat Sheet

```
LAYOUT
─────────────────────────────
value embed   → inline, no indirection
pointer embed → 8B + 1 deref + nil check
chain of value embeds → folded offsets, free
chain of pointer embeds → one deref per level

DISPATCH
─────────────────────────────
concrete type → static, devirtualized, inlinable
interface type → itab, no inline
explicit forward vs promoted → identical speed

MUTEX
─────────────────────────────
embed by value → co-located in cache line
embed by pointer → separate line, copy-safe but slower
ALWAYS use *Counter receivers; let go vet catch copies

SIZE / GC
─────────────────────────────
embedding pulls in every field
pointer fields = GC scan work
group pointers; check go vet -fieldalignment

POOL
─────────────────────────────
value-embed inner type → one alloc per pooled obj
reset every outer field after Get
pointer-embed defeats pool locality

PROFILING
─────────────────────────────
go build -gcflags='-m=2'   # escapes, inline decisions
go test -bench=. -benchmem
go test -bench=. -cpuprofile=cpu.prof
```

---

## Summary

Method promotion through struct embedding is mostly a compile-time convenience: the generated wrapper has zero runtime cost once inlined. The real performance levers are upstream of that:

1. **Value vs pointer embed** — value gives you inline layout and one less dereference; pointer gives you separately-allocated inner state and copy-safety.
2. **Selector chain depth** — value chains fold to a single offset; pointer chains accumulate dereferences.
3. **Devirtualization** — call promoted methods through the concrete outer type when you can; interface dispatch costs itab lookups and blocks inlining.
4. **Mutex embed** — value embed keeps the lock on the same cache line as the data, but blocks struct copies. Always pair with pointer receivers.
5. **API surface** — embed the whole thing or take a one-method dependency. Embedding for one method is over-coupling.
6. **GC scan** — embedding inherits every pointer field. Group pointers and check field alignment.
7. **sync.Pool** — value-embed inner types for one-allocation pooled objects; reset every outer field on Get.
8. **Escape analysis** — pointer-receiver methods on value-embedded inner types can quietly take the parent's address. Verify with `-gcflags='-m=2'`.

Promotion itself is free. The decisions around it — by-value vs by-pointer, breadth of inheritance, receiver shape — drive performance. Profile, read escape output, and let `go vet` catch lock-copy mistakes.
