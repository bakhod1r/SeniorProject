# Interface Best Practices — Optimize

This file focuses on the performance side-effects of disciplined interface design. Good shape, good size, and good placement of interfaces all map directly onto compiler decisions: inlining, devirtualization, escape analysis, allocation pressure, and itab pollution. The advice here is not about premature optimization — it is about not paying for unnecessary indirection.

---

## 1. Small interfaces enable devirtualization

A method call through an interface is dynamic dispatch — the compiler must look up the function pointer in the itab. For some patterns the Go compiler can prove the concrete type at the call site and replace the dynamic dispatch with a static call (devirtualization). Small, single-method interfaces give the compiler the best chance.

```go
type Writer interface {
    Write(p []byte) (n int, err error)
}

func emit(w Writer, msg []byte) {
    w.Write(msg) // call site
}

func main() {
    var buf bytes.Buffer
    emit(&buf, []byte("hello"))
}
```

When `emit` is inlined into `main`, the compiler sees `w` was constructed from `&buf` (concrete `*bytes.Buffer`). Go 1.21+ devirtualizes `w.Write` into `(*bytes.Buffer).Write` and may further inline it. If `Writer` had eight methods and `emit` mixed concrete and interface paths, devirtualization becomes harder.

Practical rule: keep interfaces at one to three methods. The smaller the surface, the better the compiler can reason about real call sites. Confirm with `-gcflags='-m=2'`:

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep -i devirtualizing
```

---

## 2. Capability detection avoids fallback paths

Many `io` helpers test for richer interfaces and skip generic fallbacks. The canonical example is `io.Copy`: if the source implements `io.WriterTo` or the destination implements `io.ReaderFrom`, copying is delegated to that method, which can use a private buffer, send a sendfile syscall, or use a connection-internal optimization.

```go
type WriterTo interface {
    WriteTo(w io.Writer) (n int64, err error)
}

type ReaderFrom interface {
    ReadFrom(r io.Reader) (n int64, err error)
}
```

`*bytes.Buffer`, `*bytes.Reader`, `*strings.Reader`, `*os.File`, and `*net.TCPConn` all implement these, so `io.Copy(dst, src)` can use a zero-copy path. If you wrap one of these types and forget to forward the capability, you push every copy back through a 32 KiB stack-allocated bounce buffer.

```go
// Bad — wrapper hides capability
type Counted struct{ inner io.Reader; n int64 }
func (c *Counted) Read(p []byte) (int, error) {
    n, err := c.inner.Read(p); c.n += int64(n); return n, err
}

// Good — forward WriteTo when inner supports it
func (c *Counted) WriteTo(w io.Writer) (int64, error) {
    if wt, ok := c.inner.(io.WriterTo); ok {
        n, err := wt.WriteTo(w); c.n += n; return n, err
    }
    return io.Copy(w, struct{ io.Reader }{c}) // fallback
}
```

The cost saved is real: for a 1 GiB transfer with `*os.File` to `*net.TCPConn`, sendfile is a single syscall vs. tens of thousands of read/write pairs.

---

## 3. Use concrete types in hot loops; interfaces at the boundary

Interface dispatch costs ~1-3 ns per call plus an inhibition of inlining. For tight loops that iterate millions of items per second, that overhead dominates. The cure is to take the interface argument once, type-assert (or branch), and run the loop on the concrete type.

```go
func sumAll(rs []io.Reader) int64 {
    var total int64
    for _, r := range rs {
        // each iteration goes through itab
        n, _ := io.Copy(io.Discard, r)
        total += n
    }
    return total
}

func sumFiles(rs []*os.File) int64 {
    var total int64
    for _, f := range rs {
        // f.Read directly inlined; no itab lookup
        n, _ := io.Copy(io.Discard, f)
        total += n
    }
    return total
}
```

Pattern at API design level: accept interfaces in the public function (so callers may swap implementations), but inside the implementation immediately type-assert hot-path callees to a concrete type when justified by profiling. The interface is a boundary, not a runtime tax on every line.

---

## 4. Generic constraints vs. interface dispatch

Generics under Go's GCShape stenciling produce a single function copy per memory shape. For scalar shapes (`int`, `float64`, fixed-size structs), the call is fully monomorphized — no dispatch table, no itab, and the body can be inlined and constant-folded.

```go
// Interface — dynamic dispatch on every Less call
type Less interface{ Less(other any) bool }

func MinIface(xs []Less) Less {
    m := xs[0]
    for _, x := range xs[1:] {
        if x.Less(m) { m = x }
    }
    return m
}

// Generic — monomorphized for cmp.Ordered shapes
func Min[T cmp.Ordered](xs []T) T {
    m := xs[0]
    for _, x := range xs[1:] {
        if x < m { m = x }
    }
    return m
}
```

For `[]int` of one million elements, `Min` is roughly 4-6x faster than `MinIface` because the comparison becomes a single CMP+CMOV instruction with no boxing. The reverse holds for pointer/interface shapes — generics still go through a dictionary, so the win is smaller. Profile before assuming generics is faster.

---

## 5. Avoid pointer-to-interface allocations

A common allocation trap: taking the address of an interface variable forces it to escape, because the interface header (two words: type, data) is now referenced from outside the stack frame.

```go
// Bad — *io.Reader is essentially never useful
func process(r *io.Reader) { /* ... */ }

// Good — interfaces are already reference-shaped
func process(r io.Reader) { /* ... */ }
```

The interface value is itself a 16-byte fat pointer; passing `*io.Reader` adds another indirection and forces heap allocation of the interface header. `go vet -copylocks` will not catch this, but escape analysis will report it:

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep "moved to heap"
```

Same rule applies to slices, maps, and channels: if the type is already reference-shaped, do not take its address. Reserve `*I` exclusively for the rare case where the callee must rebind the interface (e.g., `flag.Var` accepting `*flag.Value`).

---

## 6. Empty interface boxing in the hot path

`any` (alias for `interface{}`) requires boxing for non-pointer values: a heap allocation for the data, plus the type word. In a hot path, this allocation pressure blows out cache lines and stalls the GC.

```go
// Bad — every int is boxed
func sumAny(xs []any) int64 {
    var s int64
    for _, x := range xs {
        s += int64(x.(int))
    }
    return s
}

// Good — generics avoid boxing
func sum[T constraints.Integer](xs []T) int64 {
    var s int64
    for _, x := range xs {
        s += int64(x)
    }
    return s
}
```

Even small ints can be boxed. Go has a tiny escape optimization that interns small integer values (0-255 on most architectures), but anything outside that range allocates. Switch to generics, or to a typed slice, in any path that processes more than a few thousand items per second.

A second pattern: logging libraries that accept `...any` for structured fields. If the call site is on the request path, prefer typed builders (`zap.Int("k", v)`, `slog.Int("k", v)`) which use a typed `Attr` struct instead of `any`.

---

## 7. sync.Pool with concrete buffer types

`sync.Pool.Get` returns `any`. Storing a concrete pointer type in the pool is fine because pointer values do not need additional allocation to live inside `any` — the data word of the interface is the pointer itself. Storing a value type (or worse, a slice header) forces an allocation on every Put, defeating the pool.

```go
// Good — pointer to concrete buffer; no boxing on Put
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(w io.Writer, data []byte) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    buf.Write(data)
    buf.WriteByte('\n')
    buf.WriteTo(w)
}

// Bad — interface{} bag mixing types; every Put boxes the slice header
var sliceBag = sync.Pool{
    New: func() any { return make([]byte, 0, 4096) },
}
// Get returns any → []byte boxing on Put loses the cap
```

For slice buffers, store a pointer to a struct that holds the slice, or pool a typed `*bytes.Buffer`. The principle: the pool's stored type should be a single concrete pointer so `any` never needs a heap word for data.

Verify with a benchmark that allocations stay flat:

```go
func BenchmarkRender(b *testing.B) {
    b.ReportAllocs()
    var sink bytes.Buffer
    for i := 0; i < b.N; i++ {
        sink.Reset()
        render(&sink, []byte("hello"))
    }
}
```

If `allocs/op` is greater than zero in steady state, the pool is not actually recycling.

---

## 8. Compile-time interface checks have zero runtime cost

A common defensive idiom asserts at package load time that a concrete type implements an interface:

```go
type fileStore struct{ /* ... */ }

func (f *fileStore) Get(key string) ([]byte, error) { /* ... */ }
func (f *fileStore) Put(key string, val []byte) error { /* ... */ }

// Compile-time check — enforced statically, no runtime work
var _ Store = (*fileStore)(nil)
```

The `(*fileStore)(nil)` is a typed nil pointer. The assignment to the blank identifier is type-checked by the compiler and emits no code. The benefit: the moment someone removes a method or changes a signature, the build breaks at the type's package, not at every consumer. Use it on every public interface implementation:

```go
var (
    _ http.Handler   = (*Server)(nil)
    _ io.Closer      = (*Server)(nil)
    _ fmt.Stringer   = (*Server)(nil)
)
```

These declarations cost nothing at runtime and dramatically improve refactor safety. Combined with discipline about returning concrete types (so consumers can `var _ I = (*T)(nil)` against any interface they care about), you get strong compile-time guarantees without a runtime price.

---

## 9. Method-set discipline reduces itab entries

Every (concrete type, interface type) pair used in a value-to-interface assignment generates one itab — a small struct that maps interface methods to concrete method pointers. Itabs live in a global hash table; each one is roughly the size of (n_methods + 4) words.

If your codebase has 50 concrete types that all implement a 30-method "kitchen-sink" interface, you pay for ~50 large itabs. If each concrete type instead implements a few small interfaces, you generate fewer and tinier itabs, and the relevant ones land in CPU cache more often.

```go
// Bad — one giant interface, many implementors
type Store interface {
    Get(string) ([]byte, error)
    Put(string, []byte) error
    Delete(string) error
    List(string) ([]string, error)
    Watch(string) (<-chan Event, error)
    Stats() Stats
    Close() error
    // ... 23 more methods
}

// Good — composable small interfaces
type Getter interface{ Get(string) ([]byte, error) }
type Putter interface{ Put(string, []byte) error }
type Deleter interface{ Delete(string) error }
type Lister interface{ List(string) ([]string, error) }
```

Consumers depend only on the methods they use:

```go
func cacheReadThrough(g Getter, key string) ([]byte, error) { /* ... */ }
```

Result: fewer itabs created, smaller itabs, better cache behavior on hot dispatch paths, and easier mocking. This is the same principle as Interface Segregation in SOLID, but with a measurable performance angle.

---

## 10. Avoid interface types as map keys in hot paths

`any` (and other interface types) work as map keys but require a runtime equality check that dispatches through the type word, plus a hash that walks the dynamic type. For tight loops, this dwarfs the cost of the algorithm.

```go
// Bad — interface keys; equality goes through reflect-like dispatch
cache := map[any]int{}

// Good — concrete keys; equality is a single instruction
cache := map[string]int{}
```

When you genuinely need polymorphic keys (tagged values), prefer a typed struct:

```go
type Key struct {
    Kind  uint8
    Value uint64
}

cache := map[Key]int{}
```

Equality on `Key` is a 16-byte memcmp; equality on `any` is a runtime call into `runtime.efaceeq`. The difference is roughly 5-10x for sub-microsecond lookups.

---

## 11. Type assertions: comma-ok cost vs. typeswitch

Both `v, ok := x.(T)` and `switch v := x.(type)` compile to similar runtime checks against the type word. The cost is a single pointer comparison plus, on cache miss, a load of the type metadata.

```go
// Comma-ok — fastest when one type dominates
if f, ok := w.(*os.File); ok {
    f.Sync()
    return
}
fallbackPath(w)

// Typeswitch — expands to a sequence of compares; arrange common cases first
switch v := x.(type) {
case *os.File:  v.Sync()
case *bytes.Buffer: v.Reset()
case io.Closer: v.Close()
default: /* ... */
}
```

The compiler does not currently rebuild typeswitches into jump tables, so order cases by frequency. For two or three cases the difference is negligible; for large switches in hot paths, consider a small handwritten map keyed on a type tag.

Avoid repeated assertions on the same value:

```go
// Bad — three lookups
if _, ok := x.(io.Closer); ok { /* ... */ }
if _, ok := x.(io.Flusher); ok { /* ... */ }
if _, ok := x.(io.Reader); ok { /* ... */ }

// Good — one lookup, struct-typed dispatch
type fullIO interface {
    io.Closer
    Flush() error
    Read([]byte) (int, error)
}
if f, ok := x.(fullIO); ok { /* ... */ }
```

For decoding-style functions that walk an `any` graph (e.g. `encoding/json`), pre-cache the assertion result in a local variable rather than re-asserting in each branch. The runtime will not memoize for you.

---

## 13. Return concrete, accept interface — the allocation angle

The "accept interfaces, return structs" guideline is usually framed as a coupling rule, but it has a direct performance reason. When a function returns a concrete `*T`, the caller can store it in either a concrete or an interface variable. When a function returns an interface, the caller is forced into the interface form, and any subsequent method call goes through dispatch.

```go
// Returns concrete — caller chooses
func NewBuffer() *bytes.Buffer { return new(bytes.Buffer) }

// Returns interface — caller is locked into dispatch
func NewWriter() io.Writer { return new(bytes.Buffer) }
```

In the second form, even if the caller knows the underlying type, the compiler cannot prove it without further work. Returning concrete types preserves the option to use static dispatch and inlining downstream. Use interface returns only when the implementation is genuinely meant to be private (factory pattern with multiple back-ends).

A second cost of returning an interface: the return value lives in the interface header (16 bytes) on the caller's stack. If the concrete type is a small struct that would otherwise be SSA-promoted into registers, wrapping it in an interface forces it onto the stack and often onto the heap.

---

## 12. Cheat sheet

```
INTERFACE PERFORMANCE
─────────────────────────────
Small interface           → devirtualization friendly
WriterTo / ReaderFrom     → zero-copy fast path in io.Copy
Concrete in hot loops     → no itab lookup, inline-friendly
Generics for scalars      → monomorphized, no boxing
*io.Reader                → almost never; interface is fat-pointer
any in hot path           → boxing alloc; switch to generics
sync.Pool concrete *T     → no Put-time allocation
var _ I = (*T)(nil)       → zero runtime cost, big refactor win
Many small interfaces     → fewer/smaller itabs
Interface map keys        → 5-10x slower; use concrete struct
Type assert once          → cache the assertion, do not repeat

TOOLING
─────────────────────────────
go build -gcflags='-m=2'                # escape + inlining + devirt
go test -bench=. -benchmem -cpuprofile  # confirm gains
go tool pprof -alloc_objects mem.prof   # find boxing sites
go vet                                  # catch *interface mistakes
```

---

## Summary

Interface performance follows five rules: keep interfaces narrow, expose richer capabilities through optional interfaces (`WriterTo`, `ReaderFrom`), prefer concrete types in hot loops, lean on generics for scalar polymorphism, and never let `any` box millions of values per second. Spend allocations consciously: pool concrete buffers, never `*Interface`, and check pool health with `-benchmem`. Add static interface assertions everywhere — they are free and they protect refactors. The compiler is already on your side: small interfaces, clean method sets, and disciplined call-site shapes give it the most room to inline, devirtualize, and elide indirection.

