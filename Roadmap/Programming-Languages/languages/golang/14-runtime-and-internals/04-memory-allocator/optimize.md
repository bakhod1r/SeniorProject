# Memory Allocator — Optimization

## 1. How to use this file

Fifteen scenarios where code allocates more than it should — extra `B/op`, extra `allocs/op`, extra pressure on `runtime.mallocgc` and the GC behind it. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem -benchtime=2s` on your hardware before quoting them. Allocator cost on the hot path comes from six things:

1. Hitting `runtime.mallocgc` per call instead of writing into a reused buffer.
2. Materializing values that the compiler could have kept on the stack.
3. Boxing primitives into `interface{}` and forcing them to escape.
4. Producing intermediate strings or byte slices the caller will immediately re-encode.
5. Closures and `_defer` records that escape because of a hot-loop construction.
6. Per-call construction of objects (regexp, encoders, errors) that should be package-level singletons.

Most wins remove one or more of those from a hot path. Reading order: Ex. 1, 4, 5 (the three you'll see every code review), then 11, 14 (defer / sentinel — the senior reviews flag those most), then any order. Reference the runtime source: `runtime/malloc.go` (allocation entry points), `runtime/sizeclasses.go` (the 67 size classes), `runtime/mcache.go` (per-P cache), `runtime/mbarrier.go` (write barriers that feed back into allocator cost).

---

## 2. Exercise 1 — `fmt.Sprintf` in a hot path

**Difficulty:** ★★☆☆☆

A log formatter builds the per-line prefix with `fmt.Sprintf("[%s] %d ", level, ts)`. Each call: allocates a `[]byte` for the result, boxes `level` and `ts` into `any`, formats via reflect-driven verbs.

```go
func formatPrefix(level string, ts int64) string {
    return fmt.Sprintf("[%s] %d ", level, ts)
}

func writeLog(w io.Writer, lvl string, ts int64, msg string) {
    io.WriteString(w, formatPrefix(lvl, ts))
    io.WriteString(w, msg)
}
```

```
BenchmarkSprintfPrefix-8   5000000   240 ns/op   48 B/op   3 allocs/op
```

<details><summary>Hint</summary>

`fmt.Sprintf` is a swiss army knife — flexible, reflect-driven, allocation-heavy. For known fixed shapes, format directly into a `[]byte` you control. Look at `strconv.AppendInt`, `strconv.AppendQuote`, and the `Append*` family in general — they take a destination slice and grow it in place.
</details>

<details><summary>Solution</summary>

```go
func appendPrefix(dst []byte, level string, ts int64) []byte {
    dst = append(dst, '[')
    dst = append(dst, level...)
    dst = append(dst, ']', ' ')
    dst = strconv.AppendInt(dst, ts, 10)
    dst = append(dst, ' ')
    return dst
}

func writeLog(w io.Writer, buf *[]byte, lvl string, ts int64, msg string) {
    *buf = (*buf)[:0]
    *buf = appendPrefix(*buf, lvl, ts)
    *buf = append(*buf, msg...)
    w.Write(*buf)
}
```

```
BenchmarkAppendPrefix-8   50000000   28 ns/op   0 B/op   0 allocs/op
```

~8.5× faster, zero allocations.

**Why faster:** `fmt.Sprintf` packs its arguments into a `[]any`, walks the format string with a state machine, and calls into reflect to render each verb. Each step allocates: the slice for `any`, the result `string`, the temporary `[]byte` that backs it. `mallocgc` is hit three times. The append-based variant writes into a caller-owned buffer; the buffer is reused via a pointer parameter (or `sync.Pool`), so the loop steady-states at zero allocations. `strconv.AppendInt` writes digits into the destination via a stack-resident table — no boxing, no reflect.

**Trade-off:** Loses formatting flexibility — width, padding, hex must be coded explicitly. The caller has to manage the buffer's lifetime. Switching format dialects (`{json}` vs text) means writing two builders.

**When NOT:** Cold paths (CLI usage messages, startup banners). Logs that emit < 1k/s where the convenience of `Sprintf` is worth 240 ns.
</details>

---

## 3. Exercise 2 — `[]byte(string)` on every request

**Difficulty:** ★★★☆☆

The HTTP middleware reads `r.Header.Get("Authorization")` (a `string`), then hands it to a function expecting `[]byte` via `[]byte(token)`. Each conversion allocates a fresh backing array — the runtime cannot share storage between immutable strings and mutable slices.

```go
func validateToken(b []byte) bool { /* HMAC compare */ }

func authMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if !validateToken([]byte(token)) {
            http.Error(w, "unauthorized", 401)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

```
BenchmarkBytesConversion-8   3000000   420 ns/op   192 B/op   1 allocs/op  // 180-char token
```

<details><summary>Hint</summary>

Two paths: change the callee to accept `string` (a `string` slice header is fine for read-only use of bytes), or, if you can guarantee the callee will not mutate and not retain past the call, use `unsafe.StringData` to share the backing array. The first is always correct; the second needs care.
</details>

<details><summary>Solution</summary>

The clean fix: change the signature.

```go
func validateToken(s string) bool { /* HMAC compare reads s like bytes */ }

func authMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if !validateToken(token) {
            http.Error(w, "unauthorized", 401)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

If you cannot change the signature and the callee is read-only:

```go
// UNSAFE: caller must guarantee the callee does not mutate or retain
// the slice beyond this call. Document this hard.
func stringToBytes(s string) []byte {
    if len(s) == 0 { return nil }
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

```
BenchmarkStringSignature-8     50000000     22 ns/op   0 B/op   0 allocs/op
BenchmarkUnsafeStringData-8   100000000     11 ns/op   0 B/op   0 allocs/op
```

~19× faster (signature), zero allocations.

**Why faster:** `[]byte(s)` is implemented in `runtime.stringtoslicebyte` (see `runtime/string.go`) — it goes through `mallocgc` with the slice's size, copies the bytes, and returns a fresh slice header. The bytes have to be copied because `string`s are immutable; if the caller mutated a shared backing array, language guarantees would break. The "accept `string`" approach uses the existing string's backing array via a slice header on the stack — no copy, no allocation. The `unsafe` approach is the same trick made explicit.

**Trade-off:** Signature change ripples through the call graph. `unsafe.StringData` is a footgun — if the callee passes the slice to a goroutine that retains it, the underlying string may be GC'd (when it was a substring of a parent string that's released) or, worse, mutating the slice mutates an "immutable" string and confuses interned-string optimizations. Comment the unsafety, write a fuzz test that asserts no retention.

**When NOT:** Anywhere mutation may happen — JSON unmarshal, HMAC libraries that scribble on the input, anywhere the slice is appended to. Then accept the copy.
</details>

---

## 4. Exercise 3 — `string([]byte)` for a slice you already own

**Difficulty:** ★★☆☆☆

A handler reads from `bufio.Scanner.Bytes()`, immediately converts to `string`, and passes through to logic that only reads the bytes. The conversion allocates: `string([]byte)` always copies because the scanner reuses its buffer between lines, so the string must own a stable copy.

```go
func processLine(s string) { /* read-only */ }

func parseFile(r io.Reader) {
    sc := bufio.NewScanner(r)
    for sc.Scan() {
        processLine(string(sc.Bytes()))
    }
}
```

```
BenchmarkStringConv-8   2000000   720 ns/op   256 B/op   1 allocs/op  // 200-char lines
```

<details><summary>Hint</summary>

Two truths: (1) `string([]byte)` must copy when the slice may be mutated later. (2) When you only need read-only access, you don't need a `string` — change the callee to accept `[]byte`. If you really need a `string`, the compiler can sometimes elide the copy when the conversion is used immediately in a read-only context (map lookup, `strings.Contains`).
</details>

<details><summary>Solution</summary>

Pass `[]byte` through. The string conversion only needs to happen at a real boundary (storing into a map key, returning across a public API).

```go
func processLine(b []byte) { /* read-only */ }

func parseFile(r io.Reader) {
    sc := bufio.NewScanner(r)
    for sc.Scan() {
        processLine(sc.Bytes()) // sc reuses its buffer; processLine must not retain
    }
}
```

If a `string`-keyed map lookup is the boundary, modern Go elides the conversion:

```go
seen := map[string]struct{}{}
for sc.Scan() {
    if _, ok := seen[string(sc.Bytes())]; ok { continue } // compiler elides copy
    seen[string(sc.Bytes())] = struct{}{}                 // this one copies
}
```

```
BenchmarkBytesThrough-8    50000000    24 ns/op    0 B/op   0 allocs/op
BenchmarkMapLookupConv-8   30000000    36 ns/op    0 B/op   0 allocs/op  // lookup elided
```

~30× faster, zero allocations on the read path.

**Why faster:** `runtime.slicebytetostring` calls `mallocgc(len, nil, false)` and `memmove` the bytes. The bytes must be copied because `bufio.Scanner` will overwrite its buffer on the next `Scan()`. By passing `[]byte` directly, the bytes stay in the scanner's buffer until reused — no allocation. The map-lookup elision (`runtime.mapaccess2_faststr` accepts the conversion specially) is a compile-time optimization recognized in `cmd/compile/internal/walk/convert.go`.

**Trade-off:** Callees must not retain the slice past the call — `bufio.Scanner` reuses its buffer. Document it. If a callee genuinely needs to retain, *it* should copy with `string(b)` or `bytes.Clone(b)`, putting the cost at the retention point, not at every read.

**When NOT:** Storing in a map for later use (must be `string` for value semantics). Returning across an API where the caller will outlive the scanner. Concurrent readers — the slice's mutation isn't safe to share.
</details>

---

## 5. Exercise 4 — `+=` string concatenation in a loop

**Difficulty:** ★★☆☆☆

Building a CSV row by `s += field + ","` allocates a fresh string per iteration. With 50 fields, that's 50 allocations and 50 memcopies of the growing prefix.

```go
func csvRow(fields []string) string {
    var s string
    for i, f := range fields {
        if i > 0 { s += "," }
        s += f
    }
    return s
}
```

```
BenchmarkStringConcat-8   200000   8200 ns/op   4096 B/op   99 allocs/op  // 50 fields
```

<details><summary>Hint</summary>

`strings.Builder` exists for exactly this. It holds a `[]byte` internally, grows by doubling, and converts to `string` once at the end with no copy (it transfers ownership via `unsafe.String`). For fixed-size output, `make([]byte, 0, totalLen)` plus `append` is even tighter.
</details>

<details><summary>Solution</summary>

```go
func csvRow(fields []string) string {
    var b strings.Builder
    // Pre-size to avoid the geometric growth memcpys.
    total := 0
    for _, f := range fields { total += len(f) + 1 }
    b.Grow(total)
    for i, f := range fields {
        if i > 0 { b.WriteByte(',') }
        b.WriteString(f)
    }
    return b.String()
}
```

```
BenchmarkStringsBuilder-8       3000000     420 ns/op   320 B/op   1 allocs/op
BenchmarkStringsBuilder_NoGrow-8 1500000     980 ns/op   880 B/op   5 allocs/op  // no Grow
```

~19× faster (with `Grow`), 1 alloc instead of 99.

**Why faster:** `s += f` evaluates as `runtime.concatstring2` (see `runtime/string.go`), which allocates a new `[]byte` of size `len(s)+len(f)`, copies both into it, and returns a new string header. Iteration N copies N-1 characters of accumulated prefix — quadratic. `strings.Builder` holds one growing `[]byte`, calls `mallocgc` only when the buffer doubles, and at `String()` it reinterprets the buffer as a string via `unsafe.String` (no copy). `Grow` collapses the geometric growth into one allocation of the right size.

**Trade-off:** Slight code growth (a `total` pre-pass), but mechanical. `strings.Builder` is not safe to share between goroutines — each goroutine needs its own.

**When NOT:** Two- or three-fragment concatenations (`a + b + c`) — the compiler emits a single `concatstring3` call, one allocation, faster than a Builder. Concatenations involving stack-allocated intermediates that don't escape.
</details>

---

## 6. Exercise 5 — `append` without a capacity hint

**Difficulty:** ★★☆☆☆

A function builds a result slice and appends incrementally. Without an initial cap, the slice grows geometrically (1, 2, 4, 8, 16, ...), each growth `mallocgc`'s a new backing array and copies the contents over.

```go
func mapInts(in []int, f func(int) int) []int {
    var out []int
    for _, x := range in {
        out = append(out, f(x))
    }
    return out
}
```

```
BenchmarkAppendNoCap-8   1000000   1900 ns/op   8184 B/op   9 allocs/op  // 1000 ints
```

<details><summary>Hint</summary>

You know the final length up front: `len(in)`. `make([]T, 0, n)` reserves capacity once. The 9 allocations come from geometric growth — 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024 — 10 doublings, each calling the allocator and copying.
</details>

<details><summary>Solution</summary>

```go
func mapInts(in []int, f func(int) int) []int {
    out := make([]int, 0, len(in))
    for _, x := range in {
        out = append(out, f(x))
    }
    return out
}
```

Or, if `f` cannot fail and the size is exact:

```go
func mapInts(in []int, f func(int) int) []int {
    out := make([]int, len(in))
    for i, x := range in { out[i] = f(x) }
    return out
}
```

```
BenchmarkAppendWithCap-8    3000000    480 ns/op   8192 B/op   1 allocs/op
BenchmarkPreSizedIndex-8    4000000    360 ns/op   8192 B/op   1 allocs/op
```

~4× faster on time, 9× fewer allocations.

**Why faster:** Without a hint, `growslice` (`runtime/slice.go`) allocates a new array of `nextslicecap(old, want)` each time the slice fills up. Each growth: `mallocgc` of the next size class, `memmove` of the existing elements, GC write barrier on the new backing pointer. With `make([]T, 0, n)`, the first allocation is the only one — at the size class that fits `n*sizeof(T)` (e.g. 1000 ints = 8000 B → size class 8192). The index-assignment variant is even tighter because `append`'s length-update branch is gone.

**Trade-off:** You must know (or estimate) the final size. Estimating high wastes memory; estimating low triggers a growth. For unknown sizes, a sensible default (`make([]T, 0, 16)` or `make([]T, 0, len(in)/2)` for "filter" patterns) usually outperforms nothing.

**When NOT:** When the final size genuinely varies wildly per call — over-allocating burns memory worse than the alloc savings. When the slice is short-lived and small (< 16 elements) — the allocator's tiny path handles it cheaply anyway.
</details>

---

## 7. Exercise 6 — `bytes.Buffer` allocated per call

**Difficulty:** ★★★☆☆

A `MarshalBinary` method does `var buf bytes.Buffer; ... return buf.Bytes(), nil`. The buffer's internal `[]byte` allocates fresh on every call. At 100k QPS, that's 100k buffers worth of garbage per second.

```go
type Event struct { ID int64; Name string; Tags []string }

func (e *Event) MarshalBinary() ([]byte, error) {
    var buf bytes.Buffer
    binary.Write(&buf, binary.LittleEndian, e.ID)
    buf.WriteString(e.Name)
    for _, t := range e.Tags { buf.WriteString(t) }
    return buf.Bytes(), nil
}
```

```
BenchmarkBufferPerCall-8   2000000   720 ns/op   384 B/op   4 allocs/op
```

<details><summary>Hint</summary>

`sync.Pool` is built for this. Pool a buffer, reset on borrow, put back on return. The catch: the caller must not retain the returned `[]byte` past the put — pool reuse will overwrite it. Pair with `bytes.Clone` or write to caller-supplied buffer.
</details>

<details><summary>Solution</summary>

Two approaches. First, accept a caller-supplied buffer (best when caller has one):

```go
func (e *Event) AppendBinary(dst []byte) []byte {
    dst = binary.LittleEndian.AppendUint64(dst, uint64(e.ID))
    dst = append(dst, e.Name...)
    for _, t := range e.Tags { dst = append(dst, t...) }
    return dst
}
```

Second, `sync.Pool` when the API has to return a fresh slice:

```go
var bufPool = sync.Pool{New: func() any { b := make([]byte, 0, 256); return &b }}

func (e *Event) MarshalBinary() ([]byte, error) {
    bp := bufPool.Get().(*[]byte)
    buf := (*bp)[:0]
    buf = binary.LittleEndian.AppendUint64(buf, uint64(e.ID))
    buf = append(buf, e.Name...)
    for _, t := range e.Tags { buf = append(buf, t...) }
    out := bytes.Clone(buf) // caller owns this; safe to keep
    *bp = buf
    bufPool.Put(bp)
    return out, nil
}
```

```
BenchmarkAppendBinary-8    20000000    96 ns/op    0 B/op   0 allocs/op
BenchmarkPooledBuffer-8     8000000   180 ns/op   80 B/op   1 allocs/op  // clone is the alloc
```

~7.5× faster (append-style), ~4× faster (pool), 0 vs 4 allocs.

**Why faster:** `bytes.Buffer`'s zero value lazy-allocates its `[]byte` on first write, hits the allocator for the initial cap, then geometric-grows on overflow. Each call: 1 alloc for the slice, ≥1 alloc for growth, 1 alloc for any `string`-to-`[]byte` paths, 1 alloc for `Bytes()` if used unsafely. `sync.Pool` amortizes the buffer allocation across calls — typical hit rate is >95% after warmup. `runtime.mallocgc` overhead (~30 ns fixed cost per call regardless of size; see `runtime/malloc.go`) disappears.

**Trade-off:** `sync.Pool` complicates lifecycle — the put-back must happen on every return path. Items in the pool count toward live memory until the next GC cycle clears them (Go 1.13+ uses a victim cache). Per-P pooling means cross-P transfers steal — fine for most workloads, surprising under heavy migration. The `Clone` undoes some of the savings, but keeps the API clean.

**When NOT:** Tiny buffers (< 64 B) where `mallocgc` is already in the tiny allocator's fast path — pool overhead beats the saving. Buffers that genuinely vary size by 100x — a pool with one size class either wastes (over-size) or thrashes (under-size, growth still happens).
</details>

---

## 8. Exercise 7 — Closure captures forcing escape

**Difficulty:** ★★★☆☆

A loop spawns goroutines, each one closing over the loop variable. The closure captures `i` and `data` by reference; both escape to the heap. Worse, the loop allocates a fresh closure each iteration because the captured variables differ.

```go
func process(items []Item) []Result {
    results := make([]Result, len(items))
    var wg sync.WaitGroup
    for i, it := range items {
        wg.Add(1)
        go func() { // captures i, it, results — all escape
            defer wg.Done()
            results[i] = handle(it)
        }()
    }
    wg.Wait()
    return results
}
```

```
BenchmarkClosureCapture-8   500000   3100 ns/op   2240 B/op   21 allocs/op  // 10 items
```

<details><summary>Hint</summary>

Pass captured values as goroutine arguments. The closure no longer needs to capture anything heap-resident, and the compiler can stack-allocate the function value. Bonus: avoids the classic "all goroutines see the last `i`" bug in pre-Go 1.22 code.
</details>

<details><summary>Solution</summary>

```go
func process(items []Item) []Result {
    results := make([]Result, len(items))
    var wg sync.WaitGroup
    for i, it := range items {
        wg.Add(1)
        go func(i int, it Item) { // args, not captures
            defer wg.Done()
            results[i] = handle(it)
        }(i, it)
    }
    wg.Wait()
    return results
}
```

For the case without a goroutine boundary (functional callbacks), the same trick:

```go
// Before: closure captures threshold
filter := func(x int) bool { return x > threshold }
// After: pass threshold via curry once, or use a typed predicate struct
type ThresholdFilter int
func (t ThresholdFilter) Test(x int) bool { return x > int(t) }
```

```
BenchmarkArgumentPass-8   2000000   620 ns/op   384 B/op   11 allocs/op  // 10 items, 1 goroutine each
```

~5× faster, ~6× fewer allocations.

**Why faster:** A closure that captures variables by reference forces those variables to the heap — escape analysis sees that the closure may outlive the function frame. Per iteration: one heap allocation for the closure environment, one for any captured variable that isn't already heap. By passing as arguments, the closure becomes a pure function value (just a code pointer), and the arguments live on the new goroutine's stack. The `results[i] = ...` write is now an indexed slice write, not a captured-variable dereference; the slice header travels through the argument register.

**Trade-off:** Larger argument lists if many values would have been captured. For tightly-scoped helpers that don't span goroutines, captures are idiomatic and the alloc rarely matters.

**When NOT:** When the closure is called many times with the same captured set inside one function frame — escape analysis often keeps it stack-resident, no win to chase. Functional patterns (transducers) where captures are the design.
</details>

---

## 9. Exercise 8 — Boxing `int` into `interface{}` (`any`)

**Difficulty:** ★★★☆☆

A generic logger takes `...any`. Every integer passed becomes an iface header pointing to a heap-allocated `int`. The escape isn't visible at the call site — `Println(uid, score)` looks like passing two integers, but each turns into an allocation.

```go
func log(args ...any) {
    for _, a := range args {
        fmt.Fprint(os.Stderr, a, " ")
    }
    fmt.Fprintln(os.Stderr)
}

func handle(uid int64, score int) {
    log("user", uid, "score", score) // uid and score each allocate
}
```

```
BenchmarkAnyLog-8   2000000   840 ns/op   96 B/op   4 allocs/op  // 4 args, 2 numeric
```

<details><summary>Hint</summary>

Two paths: a typed logger that accepts known shapes (`slog.Info("event", "uid", uid)` uses typed attrs and skips the box for integer types), or a generic function that uses Go 1.18+ generics to keep the parameter typed. Generics often eliminate the box entirely.
</details>

<details><summary>Solution</summary>

```go
// slog avoids boxing for known scalar types via slog.Attr's typed representation.
import "log/slog"

func handle(uid int64, score int) {
    slog.Info("event", "uid", uid, "score", score)
}

// For a custom hot-path logger, use generics for a typed write path.
type Loggable interface { ~int | ~int64 | ~string | ~float64 }

func logOne[T Loggable](key string, v T) {
    // type switch on T compiles to a direct write per instantiation
}
```

```
BenchmarkSlog-8       8000000   180 ns/op    0 B/op   0 allocs/op
BenchmarkGeneric-8   20000000    62 ns/op    0 B/op   0 allocs/op
```

~14× (slog) or ~13× (generics) faster, zero allocations.

**Why faster:** Assigning `int` to `any` allocates because an `any` is two words (type + data pointer), but an `int` is one word — the runtime calls `runtime.convT64` (or `convT*` family in `runtime/iface.go`) which `mallocgc`s a word, copies the int in, and stores the pointer in the iface. (Small values 0-255 are sometimes interned, but anything else allocates.) `slog.Attr` has a packed representation: an `Any` is a `uint64` + a `Kind` enum + a `string` — integers travel in the `uint64` field with no heap touch. Generics compile to type-specific code where `T = int64` lowers to plain integer ops.

**Trade-off:** Generics increase binary size (one instantiation per type combination). `slog` is heavier to wire if you only want raw bytes. Stuck with `any` (legacy API)? Pre-box constants at package init: `var fortyTwo any = 42` — same iface header, no per-call alloc.

**When NOT:** Heterogeneous arg lists where the call signature is genuinely `...any` and the boxing cost is dwarfed by the I/O. Cold paths.
</details>

---

## 10. Exercise 9 — Struct with mostly-nil pointer field

**Difficulty:** ★★★★☆

A `Node` struct has an optional `*Metadata` field. 90% of nodes have no metadata, but every node carries the pointer (8 B) and, when set, a separate heap object for the metadata. Two allocations: the node, the metadata.

```go
type Metadata struct { CreatedAt time.Time; Author string }
type Node struct {
    ID   int64
    Name string
    Meta *Metadata // nil for 90% of nodes
}

func newNode(id int64, name string, author string) *Node {
    return &Node{
        ID: id, Name: name,
        Meta: &Metadata{CreatedAt: time.Now(), Author: author},
    }
}
```

```
BenchmarkNodeWithPointerMeta-8   3000000   480 ns/op   144 B/op   2 allocs/op
```

<details><summary>Hint</summary>

For the *rare* case, separate it out completely — a side table keyed by node ID. For the *common* case (metadata exists but is small), inline a sentinel-value variant. The goal: one allocation per node, not two.
</details>

<details><summary>Solution</summary>

Option A (side table — best when metadata is genuinely rare):

```go
type Node struct {
    ID   int64
    Name string
}

type NodeStore struct {
    nodes []Node
    meta  map[int64]Metadata // only populated for nodes that need it
}

func (s *NodeStore) Add(id int64, name string, author string) {
    s.nodes = append(s.nodes, Node{ID: id, Name: name})
    if author != "" {
        s.meta[id] = Metadata{CreatedAt: time.Now(), Author: author}
    }
}
```

Option B (inline + sentinel — when metadata is common but small):

```go
type Node struct {
    ID        int64
    Name      string
    CreatedAt time.Time // zero value = "no metadata"
    Author    string    // ""    = "no metadata"
}

func (n *Node) HasMeta() bool { return !n.CreatedAt.IsZero() }
```

```
BenchmarkSideTable-8       5000000   280 ns/op   80 B/op   1 allocs/op
BenchmarkInlineSentinel-8  6000000   220 ns/op   96 B/op   1 allocs/op
```

~1.7-2.2× faster, half the allocations.

**Why faster:** Two `mallocgc` calls become one. The side-table approach also keeps `Node` smaller (16 B without the pointer), so a `[]Node` packs more per cache line — separate win on traversal. The pointer field's GC scan cost vanishes; the GC doesn't have to chase 90% of nodes to nowhere. The inline sentinel uses zero values that cost nothing extra in the same allocation.

**Trade-off:** Side table needs a `map` lookup to access metadata — O(1) but not zero, and the map allocates per insertion. Inline sentinel grows `Node` for all instances, even ones without metadata — wasted bytes when the optional field is large. The "is metadata present?" check becomes a value comparison rather than `!= nil` — easy to get wrong if the field could legitimately be its zero value.

**When NOT:** When the metadata is large (kilobytes) and the absence rate is high — the inline sentinel wastes too much per node. When the pointer-field check is itself the hot path (you only ever ask "does this have meta?") — `nil` check is one MOV + branch, faster than `IsZero`.
</details>

---

## 11. Exercise 10 — `time.After` in a select loop

**Difficulty:** ★★★☆☆

A select loop times out per iteration with `case <-time.After(t)`. `time.After` allocates a new `*time.Timer` every call. In a hot loop that spins waiting for work, the allocations stack up and the unused timers sit on the runtime's heap until they fire.

```go
func consume(ctx context.Context, ch <-chan Work) {
    for {
        select {
        case w := <-ch:
            process(w)
        case <-time.After(100 * time.Millisecond):
            // periodic housekeeping
        case <-ctx.Done():
            return
        }
    }
}
```

```
BenchmarkTimeAfterLoop-8   500000   3400 ns/op   192 B/op   3 allocs/op  // per iter
```

<details><summary>Hint</summary>

`time.NewTimer` returns a timer you can `Reset` between iterations. One allocation up front, then reused. The catch: `Reset` requires the timer be drained or stopped — easy to mess up. Go 1.23 simplifies the semantics (no drain needed if `Reset`/`Stop` follows the fire), but on older Go you need to handle it.
</details>

<details><summary>Solution</summary>

```go
func consume(ctx context.Context, ch <-chan Work) {
    t := time.NewTimer(100 * time.Millisecond)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: } // drain if already fired (pre-1.23)
        }
        t.Reset(100 * time.Millisecond)
        select {
        case w := <-ch:
            process(w)
        case <-t.C:
            // housekeeping
        case <-ctx.Done():
            return
        }
    }
}
```

```
BenchmarkReusedTimer-8   2000000   420 ns/op   0 B/op   0 allocs/op
```

~8× faster, zero allocations.

**Why faster:** `time.After(d)` is defined as `NewTimer(d).C` — every call allocates a `*Timer` and its channel, then registers the timer with the runtime's timer heap. If the select doesn't fire on `t.C`, the timer still sits in the heap until it fires, wasting timer-heap slots. Reusing a timer means one allocation up front and one `runtime.modtimer` call per `Reset` (no `mallocgc`).

**Trade-off:** `Reset` semantics are subtle on pre-1.23. Forgetting `Stop`+drain leaves stale fires that confuse the next iteration. The boilerplate makes simple loops ugly. For a 1-Hz loop, the alloc cost is invisible — leave `time.After`.

**When NOT:** Loops that select with timeout once or twice per second. Test code where clarity beats nanoseconds.
</details>

---

## 12. Exercise 11 — `json.Marshal` per message

**Difficulty:** ★★★☆☆

A streaming encoder calls `json.Marshal(msg)` for each outbound message and writes the result. Every call allocates a `bytes.Buffer` internally, a new `[]byte` for the result, and walks the value via reflect.

```go
func send(w io.Writer, msgs []Msg) error {
    for _, m := range msgs {
        b, err := json.Marshal(m)
        if err != nil { return err }
        if _, err := w.Write(b); err != nil { return err }
        w.Write([]byte{'\n'})
    }
    return nil
}
```

```
BenchmarkJSONMarshalLoop-8   500000   3800 ns/op   1024 B/op   12 allocs/op  // per msg
```

<details><summary>Hint</summary>

`json.NewEncoder(w).Encode(v)` writes directly to `w` and adds the newline — but it still allocates its internal buffer per call. The bigger win: reuse the encoder across messages. Even bigger: use a code-generated marshaller (`easyjson`, `go-json`) that writes to a pooled buffer.
</details>

<details><summary>Solution</summary>

```go
func send(w io.Writer, msgs []Msg) error {
    enc := json.NewEncoder(w) // reuses internal buffer across Encode calls
    for _, m := range msgs {
        if err := enc.Encode(m); err != nil { return err }
    }
    return nil
}
```

For the highest-throughput case, a generated marshaller writing to a pooled buffer:

```go
var bufPool = sync.Pool{New: func() any { return &bytes.Buffer{} }}

func send(w io.Writer, msgs []Msg) error {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() { buf.Reset(); bufPool.Put(buf) }()
    for _, m := range msgs {
        buf.Reset()
        if err := m.MarshalJSON_into(buf); err != nil { return err } // generated
        buf.WriteByte('\n')
        if _, err := w.Write(buf.Bytes()); err != nil { return err }
    }
    return nil
}
```

```
BenchmarkJSONEncoder-8     1500000   1200 ns/op    240 B/op   5 allocs/op
BenchmarkGeneratedJSON-8   8000000    280 ns/op     16 B/op   1 allocs/op
```

~3-14× faster.

**Why faster:** `json.Marshal(v)` builds a fresh `encodeState` (a wrapping `bytes.Buffer` plus encoder state) per call. The reflect walk allocates intermediate strings for map keys, boxed values for interface fields, and `reflect.Value` records as it descends. `json.Encoder` reuses its `encodeState` across calls — the buffer steady-states at the largest message size. Generated marshallers skip reflect entirely and write directly to the destination.

**Trade-off:** `json.Encoder` is not safe to share between goroutines — one per writer. Generated marshallers add a build step and diverge from struct tags if you forget to regenerate. Both lose the swap-and-go API of `json.Marshal`.

**When NOT:** One-off marshalling for a response in a request handler at < 1k QPS — `json.Marshal`'s allocs are dwarfed by network I/O. Schemas evolving daily where regenerating code is friction.
</details>

---

## 13. Exercise 12 — `regexp.MustCompile` in function body

**Difficulty:** ★☆☆☆☆

A validator calls `regexp.MustCompile(...)` inside the function. Each call rebuilds the regex's NFA and DFA — microseconds of work and dozens of allocations for state tables.

```go
func isValidSlug(s string) bool {
    re := regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
    return re.MatchString(s)
}
```

```
BenchmarkRegexInline-8   100000   12000 ns/op   8200 B/op   62 allocs/op
```

<details><summary>Hint</summary>

Hoist to package level. Or, if compilation truly must be lazy (the pattern depends on first-use config), use `sync.OnceValue`.
</details>

<details><summary>Solution</summary>

```go
var slugRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func isValidSlug(s string) bool { return slugRE.MatchString(s) }

// Lazy init when config-dependent:
var slugREOnce = sync.OnceValue(func() *regexp.Regexp {
    return regexp.MustCompile(config.SlugPattern())
})
func isValidSlug(s string) bool { return slugREOnce().MatchString(s) }
```

```
BenchmarkRegexPackage-8   20000000   95 ns/op   0 B/op   0 allocs/op
```

~126× faster, zero allocations.

**Why faster:** `regexp.Compile` parses the pattern, builds an NFA, optionally builds a DFA — each step allocates state tables, instruction lists, and edge maps. At package level, all that work happens once at program startup; at the call site, only the match runs (a scan over the input, no allocs for simple patterns). `sync.OnceValue` adds one atomic load per call after init.

**Trade-off:** Package-level state initializes whether or not the function is called. A few KB of memory for an unused regex is irrelevant; hundreds of regexes for an unused subsystem isn't — prefer `sync.OnceValue` then.

**When NOT:** Patterns built from user input (search queries). Cache compiled patterns behind an LRU keyed by pattern string with a size cap, to avoid DoS.
</details>

---

## 14. Exercise 13 — Map keyed by struct with pointer fields

**Difficulty:** ★★★★☆

A dedup map is keyed by a struct `{Tenant *Tenant; ID int64}`. Each lookup hashes the struct, which involves hashing the pointer (fine) but also exposes the GC scan to the map's buckets — every bucket pointer in the map points to keys that point to `Tenant` objects, multiplying GC scan cost.

```go
type Key struct {
    Tenant *Tenant
    ID     int64
}
var seen = map[Key]struct{}{}

func dedup(t *Tenant, id int64) bool {
    k := Key{Tenant: t, ID: id}
    if _, ok := seen[k]; ok { return false }
    seen[k] = struct{}{}
    return true
}
```

```
BenchmarkPointerKey-8   5000000   320 ns/op   0 B/op   0 allocs/op  // per lookup
// But GC scan time grows with map size — separately measurable.
```

<details><summary>Hint</summary>

Replace the pointer with a primitive identifier the tenant carries (`TenantID uint64`). The key becomes pure scalars — the map's buckets carry no pointers, the GC doesn't scan them, and equality is fixed-width int compare instead of pointer dereference.
</details>

<details><summary>Solution</summary>

```go
type Key struct {
    TenantID uint64
    ID       int64
}
var seen = map[Key]struct{}{}

func dedup(tenantID uint64, id int64) bool {
    k := Key{TenantID: tenantID, ID: id}
    if _, ok := seen[k]; ok { return false }
    seen[k] = struct{}{}
    return true
}
```

If you only have a `*Tenant` and the ID lives on it, hoist it once:

```go
func dedup(t *Tenant, id int64) bool {
    return dedupByID(t.ID, id)
}
```

```
BenchmarkScalarKey-8   8000000   180 ns/op   0 B/op   0 allocs/op
// And GC scan of the map drops to zero — buckets are pointer-free.
```

~1.8× faster on the lookup; the bigger win is the GC scan time of a large map (visible only at scale).

**Why faster:** The hash is the same, but the *allocator's GC-side cost* differs. `runtime.mapassign_fast64` / `mapaccess2_fast64` exist for scalar keys — direct hash, direct memcmp on the bucket. Pointer-bearing keys fall to the generic path that requires write barriers when storing keys (each pointer write in a bucket invokes the GC's pointer-write barrier). At GC time, the runtime scans every bucket's key slot for the pointer key version; for scalar keys it skips the scan entirely (see `runtime/map.go` and the `noscan` flag on `hmap`).

**Trade-off:** You must have a stable scalar identifier. If `Tenant` is identity-by-pointer (no ID), you have to invent one — autoincrement at construction. Reusing IDs after deletion breaks correctness.

**When NOT:** Small maps that GC visits in microseconds anyway. Maps whose pointer keys are themselves the GC roots — you'd still pay the scan elsewhere.
</details>

---

## 15. Exercise 14 — `defer` in a tight loop

**Difficulty:** ★★★★☆

A loop opens a file, defers close, processes it. `defer` allocates a `_defer` record on the goroutine's stack (in modern Go) or heap (when the defer escapes — e.g. open-coded defers exceed 8 per frame). Even when stack-allocated, defer adds bookkeeping overhead per loop iteration.

```go
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close() // defers accumulate; close happens at function return
        if err := process(f); err != nil { return err }
    }
    return nil
}
```

```
BenchmarkDeferInLoop-8   100000   12000 ns/op   480 B/op   2 allocs/op  // 10 files, plus accumulated defers
// Worse: file handles stay open until the outer function returns.
```

<details><summary>Hint</summary>

The defer in a loop has two bugs: it allocates per iteration *and* it holds resources open longer than needed. Restructure so each iteration owns its file's lifetime — wrap the per-file work in a function (or IIFE) where the defer scope is the iteration, not the loop.
</details>

<details><summary>Solution</summary>

```go
func processAll(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil { return err }
    }
    return nil
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close() // single defer, scope = this call
    return process(f)
}
```

Or, when you can't refactor, explicit close:

```go
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        err = process(f)
        f.Close() // explicit, no defer
        if err != nil { return err }
    }
    return nil
}
```

```
BenchmarkExtractedFunc-8   200000   6200 ns/op   240 B/op   1 allocs/op  // 10 files, one defer per call
BenchmarkExplicitClose-8   250000   5400 ns/op   240 B/op   1 allocs/op
```

~2× faster and resources released promptly.

**Why faster:** Pre-Go 1.14, every `defer` allocated a `*_defer` record (see `runtime/panic.go`) and pushed it on a linked list. Modern Go uses *open-coded defers* — the compiler inlines the defer call into the function epilogue when there are ≤ 8 defers in the frame. In a loop that creates 9+ defers (common with many iterations), open-coding doesn't apply; the loop falls back to the heap-allocated `_defer` path. Even with open-coding, each loop iteration sets a defer bit, runs the deferred function on return, and prevents register allocation around the deferred variables. Extracting the body to a function gives each iteration its own frame with at most one defer — open-coded, zero alloc.

**Trade-off:** Extracting a function for one defer feels heavy. Worth it when the loop runs > 100 iterations or the resource is scarce (file handles, DB connections). Explicit `Close()` is brittle — easy to miss on an error path.

**When NOT:** Loops with < 8 total defers (modern Go open-codes them). Cleanup that genuinely must happen at function exit (compound cleanup with ordering — defer's LIFO semantics matter).
</details>

---

## 16. Exercise 15 — `errors.New` per validation

**Difficulty:** ★★☆☆☆

Each validation failure constructs `errors.New("amount must be positive")`. `errors.New` allocates an `*errorString` on the heap every time. With a 5% rejection rate at 100k QPS, that's 5k allocs/s purely for errors.

```go
func validateAmount(c int64) error {
    if c <= 0 { return errors.New("amount must be positive") }
    return nil
}
```

```
BenchmarkErrorsNewPerCall-8   50000000   24 ns/op   16 B/op   1 allocs/op
```

<details><summary>Hint</summary>

Hoist to a package-level sentinel. The error message is constant, the error value should be constant too. Bonus: callers can `errors.Is(err, ErrBadAmount)` for structured handling.
</details>

<details><summary>Solution</summary>

```go
var ErrBadAmount = errors.New("amount must be positive")

func validateAmount(c int64) error {
    if c <= 0 { return ErrBadAmount }
    return nil
}
```

```
BenchmarkSentinelErr-8   1000000000   1.8 ns/op   0 B/op   0 allocs/op
```

~13× faster, zero allocations.

**Why faster:** `errors.New(s)` is `&errorString{s}` — one allocation of a 16-B `errorString` per call, and the runtime treats it as a fresh value the GC must track. The sentinel is constructed once at package init; returning it is a single iface header copy of an already-existing pointer — no `mallocgc`.

**Trade-off:** Sentinel loses any dynamic context (the actual bad value). Capture context separately in logs (`slog.Error("bad amount", "got", c, "err", ErrBadAmount)`) so the validator stays cheap. Callers comparing with `==` on the string break — use `errors.Is`.

**When NOT:** Errors that genuinely carry distinct data (a `*ValidationError` with a slice of failing fields). Sentinel won't fit; pool the struct or accept the allocation since rejection paths are rare.
</details>

---

## 17. Exercise 16 — Allocating result slice per call

**Difficulty:** ★★★☆☆

A function `Tokenize(s string) []string` allocates a fresh result slice every call. Callers calling it in a loop (tokenize each line of a log) burn through allocator capacity proportionally to line count.

```go
func Tokenize(s string) []string {
    var out []string
    for _, f := range strings.Fields(s) {
        out = append(out, f)
    }
    return out
}

func processLogs(lines []string) {
    for _, l := range lines {
        tokens := Tokenize(l)
        analyze(tokens)
    }
}
```

```
BenchmarkAllocResult-8   500000   3200 ns/op   1024 B/op   8 allocs/op  // per line
```

<details><summary>Hint</summary>

The append pattern from Ex. 1 generalizes: accept the destination as a parameter. The caller owns the buffer; reuse it across iterations by truncating with `dst[:0]` instead of reallocating.
</details>

<details><summary>Solution</summary>

```go
func AppendTokens(dst []string, s string) []string {
    return append(dst, strings.Fields(s)...)
}

func processLogs(lines []string) {
    tokens := make([]string, 0, 16) // one allocation
    for _, l := range lines {
        tokens = AppendTokens(tokens[:0], l)
        analyze(tokens)
    }
}
```

```
BenchmarkAppendResult-8   3000000   480 ns/op   0 B/op   0 allocs/op  // steady state
```

~6.6× faster, zero allocations after warmup.

**Why faster:** The caller's `tokens` slice has its underlying array allocated once at the size of the largest line's token count. Subsequent calls reuse the same array — `tokens[:0]` keeps the header but resets the length; `append` writes into the existing storage as long as `len ≤ cap`. The callee never touches `mallocgc`. `strings.Fields` still allocates its return; if that's hot too, write your own scanning split that appends into `dst` directly.

**Trade-off:** API friction — the parameter list grows, and the caller must remember to reset. Worse, if the caller forgets `[:0]`, the slice grows monotonically — silent leak. Tests should assert idempotence under repeated calls.

**When NOT:** When the result outlives the caller (returned through a public API, stored in a struct). The destination-buffer pattern requires the caller to own the lifetime. Cold paths where the convenience of `[]string` return beats nanoseconds.
</details>

---

## 18. Exercise 17 — `runtime.SetFinalizer` for resource cleanup

**Difficulty:** ★★★★☆

A wrapper around a C resource uses `runtime.SetFinalizer` to close it on GC. Every constructor sets a finalizer — and each finalizer registration allocates a `*specialfinalizer` (see `runtime/mfinal.go`) and pins the object until the GC sweeps it.

```go
type Conn struct{ raw unsafe.Pointer }

func NewConn() *Conn {
    c := &Conn{raw: C.open()}
    runtime.SetFinalizer(c, func(c *Conn) { C.close_(c.raw) })
    return c
}

func use() {
    for i := 0; i < 100; i++ {
        c := NewConn()
        c.do()
        // no explicit close — finalizer "eventually" handles it
    }
}
```

```
BenchmarkFinalizer-8   200000   8200 ns/op   240 B/op   3 allocs/op  // per NewConn, plus delayed close
```

<details><summary>Hint</summary>

Finalizers are a safety net, not a strategy. The fix is explicit `Close()` with `defer`. Keep the finalizer (or `runtime.AddCleanup` in Go 1.24+) as a backstop that logs a "you forgot to close me" warning — but don't rely on it.
</details>

<details><summary>Solution</summary>

```go
type Conn struct{ raw unsafe.Pointer }

func NewConn() *Conn { return &Conn{raw: C.open()} }

func (c *Conn) Close() {
    if c.raw != nil {
        C.close_(c.raw)
        c.raw = nil
    }
}

func use() {
    for i := 0; i < 100; i++ {
        c := NewConn()
        defer c.Close() // close at function exit; or wrap in an inner func per Ex. 14
        c.do()
    }
}
```

For a debug build, keep a finalizer that screams about leaks:

```go
func NewConn() *Conn {
    c := &Conn{raw: C.open()}
    if debug {
        runtime.SetFinalizer(c, func(c *Conn) {
            if c.raw != nil { log.Printf("conn leaked: forgot Close()") ; C.close_(c.raw) }
        })
    }
    return c
}
```

```
BenchmarkExplicitClose-8   2000000   620 ns/op   16 B/op   1 allocs/op  // alloc is the Conn itself
```

~13× faster and resources released deterministically.

**Why faster:** `SetFinalizer` registers an entry in the runtime's finalizer queue. The runtime keeps the object live across at least one extra GC cycle to call the finalizer, which means longer-lived allocations crowd the heap. Each finalizer registration allocates the `specialfinalizer` record (~64 B) and updates the span's specials list under a lock. Explicit close removes all that — the object is plain memory the GC can reap immediately.

**Trade-off:** Forgotten close = leak. The debug-finalizer pattern catches this in tests. Code that genuinely cannot know the close point (e.g. user-handed-off objects) may need the finalizer; pay the cost knowingly.

**When NOT:** Long-lived objects with no per-iteration cost — one finalizer on a singleton is fine. Migration scaffolding when you don't yet trust callers to close.
</details>

---

## 19. Exercise 18 — Allocating wrapper struct around a primitive

**Difficulty:** ★★☆☆☆

A type-safe wrapper `type UserID struct { v int64 }` looks safer than raw `int64`, but if used as `*UserID` everywhere it forces heap allocation. The semantic gain isn't worth the alloc cost when the wrapper holds nothing but a primitive.

```go
type UserID struct{ v int64 }
func NewUserID(v int64) *UserID { return &UserID{v: v} }

func handle(id *UserID) { /* ... */ }

func loop(ids []int64) {
    for _, x := range ids {
        handle(NewUserID(x)) // allocates per call
    }
}
```

```
BenchmarkPointerWrapper-8   30000000   42 ns/op   16 B/op   1 allocs/op  // per element
```

<details><summary>Hint</summary>

Use a named primitive type, not a wrapper struct. `type UserID int64` gives the same type safety (you can't pass a `int64` where `UserID` is required) with zero alloc cost — it's still a primitive at runtime.
</details>

<details><summary>Solution</summary>

```go
type UserID int64

func handle(id UserID) { /* ... */ }

func loop(ids []int64) {
    for _, x := range ids {
        handle(UserID(x)) // free conversion; UserID is int64 at runtime
    }
}
```

```
BenchmarkNamedPrimitive-8   1000000000   1.8 ns/op   0 B/op   0 allocs/op
```

~23× faster, zero allocations.

**Why faster:** `type UserID int64` is a compile-time distinction; at runtime, `UserID` *is* `int64` — same word, same register, no struct header, no heap. Passing `UserID` is one integer register. The wrapper struct, even with one field, forces the value through a pointer when accessed via `*UserID`; the constructor allocates, the dereference adds indirection. The compiler can sometimes stack-allocate the struct, but `*UserID` returned from a constructor and stored / passed through interfaces will escape.

**Trade-off:** Named primitives can't carry methods that need to mutate state — methods on `UserID` work only with value receivers (no mutation) unless you make it `*UserID`, which reintroduces the problem. For pure ID types this is exactly the right shape.

**When NOT:** When the type really has multiple fields or needs to grow ones (versioned identifier with epoch). When the type needs interface satisfaction with a pointer receiver. When the wrapper enforces invariants that need a constructor (validation, normalization) — then the wrapper struct earns its keep, but pass by value not pointer when small.
</details>

---

## 20. When NOT to optimize

Allocator pressure dominates a CPU profile only when (a) the function runs on a hot path, and (b) the rest of the function's work is small. A request handler that hits the network for 50 ms doesn't care if it allocated 12 times along the way. Profile before chasing any of the above.

- Boot-time work (config parse, dependency injection) — readability wins.
- Cold paths (admin endpoints, debug dumps) — `fmt.Sprintf` and `errors.New` are fine.
- Tests and fixtures — clarity over speed.
- One-off CLI scripts — your future self reading the code is the bottleneck.

**Profile first.** Allocator overhead has these signatures in a CPU profile (look in `pprof`'s allocation or top view):

- `runtime.mallocgc` on a hot stack → Ex. 1, 5, 6, 17 (per-call buffer allocation).
- `runtime.convT64` / `runtime.convT*` → Ex. 8 (boxing into `any`).
- `runtime.growslice` → Ex. 5 (append without cap).
- `runtime.stringtoslicebyte` / `slicebytetostring` → Ex. 2, 3 (string/byte conversion).
- `runtime.concatstrings` → Ex. 4 (`+=` concat).
- `runtime.newobject` per loop iteration → Ex. 7, 18 (closure / wrapper struct).
- `runtime.makemap` → Ex. 10 (per-call map).
- `time.NewTimer` in allocation profile → Ex. 11 (`time.After`).
- `runtime.deferproc` → Ex. 14 (defer in loop on pre-1.14 or with > 8 defers).
- `runtime.SetFinalizer` / `*specialfinalizer` → Ex. 17.

**Common premature optimizations:**

- `sync.Pool` of objects so small that `mallocgc`'s tiny allocator already handles them in 10 ns.
- `unsafe.StringData` to avoid `[]byte(s)` when the call site is cold.
- Hand-rolled `strconv` paths when `fmt.Sprintf` is called once per request.
- Eliminating defer in a loop that runs 5 iterations.
- Code-generated marshallers for a structure that ships < 1k msgs/s.

**Correctness gaps disguised as optimizations:**

- `unsafe.StringData` passed to a callee that mutates — corrupts an "immutable" `string`, breaks interning, breaks map keys.
- Buffer returned from a `sync.Pool` retained by the caller — next pool consumer overwrites their data.
- Side-table metadata (Ex. 9) keyed by pointer when the pointer changes across migrations — orphaned entries leak.
- Sentinel error (Ex. 15) that carried mutable state — concurrent mutation hazard.
- Reset-and-reuse `time.Timer` without correct drain — stale fire wakes the next iteration unexpectedly.
- Destination-buffer parameter (Ex. 16) without `[:0]` reset — slice grows forever, silent memory leak.
- Removing a finalizer (Ex. 17) without auditing every code path for explicit close — handle leak under error returns.
- Generic instantiation explosion (Ex. 8) — binary size doubles, link time multiplies; measure before committing.

---

## 21. Summary

**Always-ship wins** (apply by default in any new code):

- Pre-size slices with `make([]T, 0, n)` when the size is known (Ex. 5).
- Package-level `regexp.MustCompile` (Ex. 12).
- Package-level sentinel errors for hot rejection paths (Ex. 15).
- Named primitive types instead of single-field wrapper structs (Ex. 18).
- `strings.Builder` (or `make([]byte, 0, n) + append`) for any concat in a loop (Ex. 4).
- Explicit `defer Close()` over `runtime.SetFinalizer` (Ex. 17).
- Pass goroutine arguments instead of capturing in closures (Ex. 7).

**Wins behind a profile** (when measurements justify them):

- `Append*` style APIs writing into caller buffers (Ex. 1, 16).
- `sync.Pool` for buffers ≥ 256 B reused at high rate (Ex. 6).
- `[]byte` signatures replacing `string` for read-only data — or vice versa (Ex. 2, 3).
- `slog` or generics to avoid `any` boxing (Ex. 8).
- Inline-or-side-table for mostly-nil pointer fields (Ex. 9).
- `time.NewTimer` + `Reset` in tight loops (Ex. 11).
- `json.Encoder` reuse or generated marshallers (Ex. 12).
- Scalar map keys when GC scan time matters (Ex. 13).
- Extract loop body to a function to avoid defer pile-up (Ex. 14).

**Specialty** (only when the design calls for it):

- `unsafe.StringData` / `unsafe.Slice` for zero-copy string-byte interop on audited paths.
- Custom slab allocator backing a `[]T` pool for million-object parsers.
- `runtime.MemStats` watchdog in tests that fails the build on heap regression.
- `runtime.AddCleanup` (Go 1.24+) over `SetFinalizer` for the rare cases where weak cleanup is needed.
- `go:nosplit` on tiny helpers that the allocator's hot path calls, when measured.

Allocator cost on the hot path comes from `mallocgc` being called when it shouldn't be — for buffers that could be reused, for conversions that could be elided, for sentinel-shaped objects that could live at package scope, for wrappers that gain nothing over a named primitive. Strip those by writing into caller-owned destinations, hoisting expensive constructions to init time, returning singletons instead of fresh allocations, and trusting escape analysis only after you've read its decisions (`go build -gcflags='-m'`). The 67 size classes in `runtime/sizeclasses.go` are fast for what they do; the wins come from not asking them to do anything at all.
