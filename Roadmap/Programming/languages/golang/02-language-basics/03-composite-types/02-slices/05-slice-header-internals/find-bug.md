# Slice Header Internals — Find the Bug

A collection of realistic slice-header bugs. For each: the symptom, the (often subtle) cause, and the fix. Reading them in order builds the intuition you need to spot slice issues in code review and production.

---

## Bug 1: The append that secretly mutated its caller

```go
func appendID(prefix []byte, id int) []byte {
    return append(prefix, byte(id))
}

func main() {
    common := make([]byte, 0, 8)
    common = append(common, 'P', 'R', 'E')
    a := appendID(common, 1)
    b := appendID(common, 2)
    fmt.Println(string(a)) // "PRE\x01"... maybe?
    fmt.Println(string(b)) // "PRE\x02"
}
```

**Symptom.** `a` and `b` look fine individually, but printing `a` again at the end reveals it has been silently changed: `string(a)` is now `"PRE\x02"`.

**Cause.** `common` has `cap == 8, len == 3`. `appendID(common, 1)` writes `1` at index 3 (room available), returns `{Data: common.Data, Len: 4, Cap: 8}`. `appendID(common, 2)` is called with the *original* `common` (still `len == 3`), writes `2` at index 3, returning `{Data: common.Data, Len: 4, Cap: 8}`. `a` and `b` have the same `Data`; the second write to index 3 corrupts what `a` sees.

**Fix.** Bound the prefix's capacity before passing it around:

```go
a := appendID(common[:len(common):len(common)], 1)
b := appendID(common[:len(common):len(common)], 2)
```

Now each `appendID` call sees a slice with `Cap == Len`, forcing the `append` to allocate fresh memory. `a` and `b` are now independent.

Better: `appendID` itself should defensively cap its input, or document that it mutates the prefix's spare capacity.

---

## Bug 2: The function that "didn't return" the slice

```go
func sortAndReturn(s []int) []int {
    sort.Ints(s)
    s = s[:0]
    s = append(s, 1, 2, 3)
    return s
}

func main() {
    data := []int{5, 3, 1, 4, 2}
    sorted := sortAndReturn(data)
    fmt.Println(sorted) // [1 2 3]
    fmt.Println(data)   // ?
}
```

**Symptom.** `data` is `[1 2 3 4 5]` (sorted!) but its length is still 5, not 3. The user expected either both to be `[1 2 3]` or both `[5 3 1 4 2]`.

**Cause.** `sort.Ints(s)` mutates the elements through the shared backing array — visible to `data`. `s = s[:0]` reslices `s` to length 0, but only locally; `data`'s header is unchanged. `append(s, 1, 2, 3)` writes 1, 2, 3 into the backing array at indices 0, 1, 2 — visible through `data` because `data.Cap >= 3`.

**Fix.** Either:

```go
// Option A: don't mutate the input
func sortAndReturn(s []int) []int {
    out := slices.Clone(s)
    sort.Ints(out)
    return []int{1, 2, 3}
}

// Option B: mutate-with-pointer if you really want to
func sortAndReturn(s *[]int) {
    sort.Ints(*s)
    *s = (*s)[:0]
    *s = append(*s, 1, 2, 3)
}
```

The bug came from mixing "mutate caller's elements" with "create a new view that the caller doesn't see". Pick one paradigm per function.

---

## Bug 3: The retained gigabyte

```go
type Cache struct {
    items map[string][]byte
}

func (c *Cache) Add(key string, fullFile []byte) {
    c.items[key] = fullFile[:200] // just the header
}

func main() {
    cache := &Cache{items: make(map[string][]byte)}
    for _, name := range fileNames {
        b, _ := os.ReadFile(name) // each ~50 MiB
        cache.Add(name, b)
    }
    // hundreds of cache entries, each 200 bytes; RSS = many gigabytes
}
```

**Symptom.** Cache reports 100k entries × 200 bytes = 20 MiB of "data", but RSS is 50 GB.

**Cause.** Each cache entry is a 200-byte slice header *pointing into a 50 MiB array*. The full file array is retained because the cache holds a slice into it. Multiply by 1000 files: 50 GB held alive.

**Fix.**

```go
func (c *Cache) Add(key string, fullFile []byte) {
    c.items[key] = slices.Clone(fullFile[:200])
}
```

Now each cache entry is its own 200-byte array. The full files become garbage-collectable once `Add` returns.

Equivalent older idioms: `append([]byte(nil), fullFile[:200]...)` or `make([]byte, 200)` + `copy`.

---

## Bug 4: The `range` loop that didn't mutate

```go
type Item struct{ Done bool }

func markAllDone(items []Item) {
    for _, it := range items {
        it.Done = true
    }
}

func main() {
    items := []Item{{}, {}, {}}
    markAllDone(items)
    fmt.Println(items[0].Done) // false!
}
```

**Symptom.** `markAllDone` appears to do nothing.

**Cause.** `it` is a copy of `items[i]`. Setting `it.Done = true` modifies the copy, not the slice element. The element type is `Item` (a value), so the loop copies it on each iteration.

**Fix.** Index into the slice:

```go
func markAllDone(items []Item) {
    for i := range items {
        items[i].Done = true
    }
}
```

Now the write goes through the slice header's `Data` pointer, targeting the actual element.

Alternative: declare the slice with pointer elements (`[]*Item`); then `it.Done = true` mutates the pointed-to struct. But this changes the data model and usually isn't worth it just to satisfy a syntax preference.

---

## Bug 5: The cached `bytes.Buffer.Bytes()` that became garbage

```go
type Logger struct {
    buf   *bytes.Buffer
    saved [][]byte
}

func (l *Logger) Log(line string) {
    l.buf.WriteString(line)
    l.saved = append(l.saved, l.buf.Bytes())
    l.buf.Reset()
}

func main() {
    l := &Logger{buf: &bytes.Buffer{}}
    l.Log("alpha")
    l.Log("beta")
    l.Log("gamma")
    for _, s := range l.saved {
        fmt.Println(string(s))
    }
}
```

**Symptom.** Prints either all empty strings, or "gamma" three times, or some other corruption depending on Go version and luck.

**Cause.** `buf.Bytes()` returns a slice that aliases the buffer's internal array. After `Reset()`, the buffer reuses the same array. Subsequent `WriteString` overwrites the cells that `saved` points into. By the time `main` reads `saved`, all entries reference the same address, whose contents depend on what `buf` last wrote.

**Fix.** Copy at capture:

```go
l.saved = append(l.saved, slices.Clone(l.buf.Bytes()))
```

The doc warning on `bytes.Buffer.Bytes()` says exactly this: *the slice is valid only until the next modification of the buffer.*

---

## Bug 6: The pool that grew unboundedly

```go
var pool = sync.Pool{
    New: func() any {
        s := make([]byte, 0, 1024)
        return &s
    },
}

func process(req Request) []byte {
    bufP := pool.Get().(*[]byte)
    buf := *bufP
    buf = handleRequest(buf, req) // may grow buf up to many MiB
    out := slices.Clone(buf)
    *bufP = buf
    pool.Put(bufP)
    return out
}
```

**Symptom.** Memory usage steadily climbs. After heavy traffic with a few large requests, total RSS is 10× steady-state expected.

**Cause.** A few large requests grow `buf` to several MiB. That oversized slice is returned to the pool. Subsequent `Get()` calls receive these oversized slices and either retain them or contribute to multi-MiB live pool entries across many goroutines.

**Fix.** Cap the size on return:

```go
func process(req Request) []byte {
    bufP := pool.Get().(*[]byte)
    buf := (*bufP)[:0]
    buf = handleRequest(buf, req)
    out := slices.Clone(buf)
    if cap(buf) <= 16*1024 { // cap pool growth
        *bufP = buf
        pool.Put(bufP)
    }
    return out
}
```

Now oversized buffers are dropped instead of pooled. The pool stays bounded.

---

## Bug 7: The "empty slice" that was nil in JSON

```go
type Resp struct {
    Items []Item `json:"items"`
}

func handler(w http.ResponseWriter, r *http.Request) {
    var items []Item
    items = filterFromDB(...)
    json.NewEncoder(w).Encode(Resp{Items: items})
}
```

**Symptom.** Client expects `{"items": []}` when there are no items. Sometimes receives `{"items": null}` instead. Client-side JS code crashes on `.length` of null.

**Cause.** `filterFromDB` returns `nil` when no rows match. `json.Marshal` encodes a nil slice as `null`, an empty non-nil slice as `[]`. The client-side code did not anticipate `null`.

**Fix.** Normalise to empty:

```go
items := filterFromDB(...)
if items == nil {
    items = []Item{}
}
json.NewEncoder(w).Encode(Resp{Items: items})
```

Or guarantee non-nil at the source:

```go
func filterFromDB(...) []Item {
    out := []Item{}
    // ... append matches ...
    return out
}
```

Or document the API as returning `null` for empty and have the client handle both. (Most teams choose the normalise-to-`[]` route.)

---

## Bug 8: The append that shared and lost data

```go
func splitInTwo(s []int) ([]int, []int) {
    mid := len(s) / 2
    return s[:mid], s[mid:]
}

func processBoth(s []int) {
    a, b := splitInTwo(s)
    a = append(a, 99) // intended: extend a with 99
    fmt.Println("a:", a)
    fmt.Println("b:", b)
}

func main() {
    s := []int{1, 2, 3, 4, 5, 6}
    processBoth(s)
}
```

**Symptom.** Output is `a: [1 2 3 99]` and `b: [99 5 6]`. Where did the 99 in `b` come from?

**Cause.** `a` is `s[:3]` with `Cap = 6`. `append(a, 99)` has room (`cap > len`), so it writes 99 at index 3 of the backing array. But index 3 of the backing array is also `b[0]`. So both `a[3]` and `b[0]` are the new 99.

**Fix.** Cap both halves:

```go
func splitInTwo(s []int) ([]int, []int) {
    mid := len(s) / 2
    return s[:mid:mid], s[mid:len(s):len(s)]
}
```

Now neither half has spare capacity. Either side's `append` allocates fresh memory.

---

## Bug 9: The slice deduplication that left dangling pointers

```go
type Conn struct{ /* a large struct holding a fd */ }

func compact(conns []*Conn) []*Conn {
    n := 0
    for _, c := range conns {
        if c.IsAlive() {
            conns[n] = c
            n++
        }
    }
    return conns[:n]
}
```

**Symptom.** After repeated compactions, fd numbers grow without bound. `lsof` shows hundreds of file descriptors held open on connections that "should have been closed".

**Cause.** `conns[n:cap(conns)]` still holds pointers to the removed `*Conn` values, since the cells in the backing array are unchanged. As long as the slice header (or any retained sub-slice) references that backing array, those `*Conn` pointers are reachable. The `*Conn` finalisers/destructors that close fds never run.

**Fix.** Zero out the tail:

```go
func compact(conns []*Conn) []*Conn {
    n := 0
    for i, c := range conns {
        if c.IsAlive() {
            conns[n] = c
            n++
        }
        conns[i] = nil
    }
    return conns[:n]
}
```

Or use `slices.DeleteFunc` (Go 1.21+), which does this clearing internally:

```go
return slices.DeleteFunc(conns, func(c *Conn) bool { return !c.IsAlive() })
```

This is one of the most common slice bugs in long-running services. The `slices` package was largely designed to make people stop hand-rolling broken versions of this.

---

## Bug 10: The captured loop variable

```go
type Worker struct{ id int }

func main() {
    workers := []Worker{{1}, {2}, {3}}
    ptrs := make([]*Worker, 0, 3)
    for _, w := range workers {
        ptrs = append(ptrs, &w)
    }
    for _, p := range ptrs {
        fmt.Println(p.id)
    }
}
```

**Symptom.** On Go 1.21 and earlier: prints `3 3 3`. On Go 1.22+: prints `1 2 3`.

**Cause (pre-1.22).** `w` was a single loop-scoped variable reused across iterations. `&w` was always the same address. After the loop, `w == workers[2]`, so all three pointers print 3.

**Fix.** Index instead of capturing the loop variable:

```go
for i := range workers {
    ptrs = append(ptrs, &workers[i])
}
```

This produces three distinct pointers, one into each slice element.

Or, on Go 1.22+, the original code works because each iteration creates a fresh `w`. But the fixed version is still preferable: it produces pointers into the original backing array (not into copies), which is what the user usually intended.

---

## Bug 11: The "I'll just use unsafe.Pointer" footgun

```go
import (
    "reflect"
    "unsafe"
)

func bytesFromString(s string) []byte {
    sh := (*reflect.StringHeader)(unsafe.Pointer(&s))
    var b []byte
    bh := (*reflect.SliceHeader)(unsafe.Pointer(&b))
    bh.Data = sh.Data
    bh.Len = sh.Len
    bh.Cap = sh.Len
    return b
}

func main() {
    s := "hello"
    b := bytesFromString(s)
    b[0] = 'H' // crashes the program!
}
```

**Symptom.** Program segfaults or corrupts memory.

**Cause.** Two problems compounded:

1. String backing memory is read-only (stored in the binary's `.rodata` segment for string literals). Writing to it segfaults.
2. Using `reflect.SliceHeader` with `Data uintptr` doesn't keep the underlying memory GC-tracked. If `s` could ever be garbage-collected while `b` is in use, `b.Data` becomes a dangling pointer.

**Fix.** If you really need zero-copy `string→[]byte`, you cannot mutate. For read-only access (with `unsafe.Slice`, GC-safe):

```go
func bytesFromString(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

But document loudly: *do not mutate the result*. For mutable access, you must copy:

```go
b := []byte(s) // always safe; always allocates
```

The wider lesson: `reflect.SliceHeader` is deprecated for exactly this kind of bug. Use `unsafe.Slice`/`unsafe.SliceData`/`unsafe.StringData`/`unsafe.String` (Go 1.20+).

---

## Bug 12: The slice that "forgot" elements after `append`

```go
type Inbox struct {
    messages []*Message
}

func (i *Inbox) Add(m *Message) {
    i.messages = append(i.messages, m)
}

func processAll(i Inbox) { // pass by value!
    for _, m := range i.messages {
        process(m)
    }
    i.messages = nil // attempt to clear
}

func main() {
    inbox := Inbox{}
    inbox.Add(&Message{...})
    inbox.Add(&Message{...})
    processAll(inbox)
    fmt.Println(len(inbox.messages)) // 2, not 0!
}
```

**Symptom.** Clearing `i.messages` inside `processAll` has no effect on the caller's inbox.

**Cause.** `processAll` received a copy of the `Inbox` struct. The copy contains a slice header pointing at the same backing array. Setting `i.messages = nil` modifies the copy's slice header; the caller's header is unchanged.

**Fix.** Pass by pointer (and consider whether mutating is the right design):

```go
func (i *Inbox) processAll() {
    for _, m := range i.messages {
        process(m)
    }
    i.messages = nil
}
```

Now `i` is a pointer; mutations propagate. This is also why slice fields on structs are usually accessed via pointer-receiver methods — anything that wants to grow, shrink, or reset the slice needs to update the struct.

---

## Bug 13: The "deep copy" that wasn't

```go
type Config struct {
    Tags []string
    Sub  *SubConfig
}

func (c Config) Clone() Config {
    return c // struct copy
}

func main() {
    c1 := Config{Tags: []string{"a", "b"}}
    c2 := c1.Clone()
    c2.Tags[0] = "X"
    fmt.Println(c1.Tags[0]) // "X" — c1 was modified!
}
```

**Symptom.** "Cloning" a struct produces shared mutable state.

**Cause.** `return c` makes a shallow copy. The slice header is copied (three words), but `Data` is the same pointer. Writing through `c2.Tags[0]` writes through the same memory cell as `c1.Tags[0]`.

**Fix.** Deep-clone the slice field:

```go
func (c Config) Clone() Config {
    out := c
    out.Tags = slices.Clone(c.Tags)
    if c.Sub != nil {
        sub := *c.Sub
        out.Sub = &sub
    }
    return out
}
```

Any pointer or slice field needs explicit cloning. The default `Config{}` syntax (or `return c`) is always shallow. This bug surfaces most often in cache invalidation and configuration hot-reload code.

---

## Bug 14: The slice growth that wasted a connection

```go
type Pool struct {
    conns []*Conn // pre-grown to 16
}

func New() *Pool {
    p := &Pool{conns: make([]*Conn, 0, 16)}
    for i := 0; i < 16; i++ {
        p.conns = append(p.conns, dial())
    }
    return p
}

func (p *Pool) Add(c *Conn) {
    p.conns = append(p.conns, c) // exceeds cap — reallocates
}

func main() {
    p := New()
    p.Add(dial())
    // p.conns is now in a new array, cap 32. The old array of 16 conns is GC-eligible.
}
```

**Symptom.** After a few `Add` calls, the connection pool quietly drops connections that other goroutines still reference, leading to "use of closed network connection" errors.

**Cause.** If any code held a reference to `p.conns` from before the `Add` (e.g., a goroutine snapshotted `p.conns` for iteration), it now sees a stale array. Meanwhile, `p.conns` references the new array. The two are independent. Connections written to one are invisible to the other.

**Fix.** Don't pass `p.conns` directly across goroutine boundaries; copy or use indirection:

```go
func (p *Pool) Snapshot() []*Conn {
    p.mu.Lock()
    defer p.mu.Unlock()
    return slices.Clone(p.conns)
}
```

Or use a fixed-size pool that never reallocates, accepting that you can't dynamically grow:

```go
type Pool struct {
    conns [maxConns]*Conn
    n     int
}
```

The wider lesson: any slice that may be shared and may grow needs synchronisation around both reads and writes, including the read of the slice header itself.

---

## Bug 15: Copy with too-small destination

```go
func dupe(s []int) []int {
    var out []int
    copy(out, s) // intended: deep copy
    return out
}

func main() {
    d := dupe([]int{1, 2, 3})
    fmt.Println(d) // []
    fmt.Println(len(d)) // 0
}
```

**Symptom.** `dupe` returns an empty slice regardless of input.

**Cause.** `copy(dst, src)` copies `min(len(dst), len(src))` elements. `out` is nil with `len == 0`. `copy(out, s)` copies zero elements.

**Fix.** Either preallocate `out`:

```go
func dupe(s []int) []int {
    out := make([]int, len(s))
    copy(out, s)
    return out
}
```

Or use `slices.Clone`:

```go
func dupe(s []int) []int {
    return slices.Clone(s)
}
```

The pattern `var out T; copy(out, src)` is one of the most common slice mistakes for newcomers, especially those coming from languages where `copy` allocates.

---

## 16. Summary

Slice bugs cluster around four themes: **aliasing through shared backing arrays** (Bugs 1, 2, 5, 8, 13), **retention of large arrays through small headers** (Bug 3), **header-by-value vs element-by-reference confusion** (Bugs 4, 12), and **special cases like nil/empty and growth** (Bugs 7, 11, 14, 15). Each one is a real shape that appears in production code. The mental model — "header copy, array share" — is sufficient to spot every one of them on review. The `slices` package and the `unsafe.Slice` family (Go 1.20+) are stdlib answers to the most common patterns; prefer them over hand-rolled equivalents.

---

## Further reading
- `slices` package — https://pkg.go.dev/slices
- `bytes.Buffer.Bytes` warning — https://pkg.go.dev/bytes#Buffer.Bytes
- `unsafe.Slice` / `unsafe.SliceData` — https://pkg.go.dev/unsafe#Slice
- Russ Cox: "Go Data Structures" — https://research.swtch.com/godata
- `runtime/slice.go` — https://github.com/golang/go/blob/master/src/runtime/slice.go
