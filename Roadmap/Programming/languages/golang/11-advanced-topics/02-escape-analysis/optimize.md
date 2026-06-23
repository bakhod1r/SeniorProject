# Escape Analysis — Optimize

## 1. The optimization loop

1. Identify the hot path with a CPU profile.
2. Identify the *allocation* hotspot inside that with `-benchmem` and `pprof -alloc_objects`.
3. Read `-gcflags="-m=2"` for the file in question to see escape reasoning.
4. Apply a targeted change (one at a time).
5. Re-bench with `benchstat`. Keep the change only if the improvement is statistically meaningful.

Without the profile, you're optimizing fiction. Stick to the loop.

---

## 2. Pointer vs. value for small structs

```go
type Point struct{ X, Y int }

// allocates
func newP() *Point { return &Point{1, 2} }

// no allocation
func newP() Point { return Point{1, 2} }
```

A `Point` is 16 bytes; passing it by value is cheaper than allocating + GC overhead. The break-even depends on call frequency and CPU cache effects, but for anything under ~64 bytes, value semantics usually win unless you specifically need to share mutation.

---

## 3. Pre-sizing slices and maps

```go
out := make([]Result, 0)        // grows: 0 → 1 → 2 → 4 → 8 → 16 → ...
for _, x := range input { out = append(out, transform(x)) }

// vs

out := make([]Result, 0, len(input))   // one allocation
for _, x := range input { out = append(out, transform(x)) }
```

For maps:

```go
m := make(map[K]V, len(input))   // hint to allocate buckets upfront
```

This usually eliminates a chain of reallocations and copies.

---

## 4. Sharing buffers via `sync.Pool`

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(req *Req) string {
    b := bufPool.Get().(*bytes.Buffer)
    defer func() {
        if b.Cap() < 64<<10 {     // discard oversized
            b.Reset()
            bufPool.Put(b)
        }
    }()
    write(b, req)
    return b.String()             // last alloc; copies bytes into a new string
}
```

Two things to watch:

- `b.String()` copies because strings are immutable; if your callers can accept a `[]byte` slice (with the documented constraint "don't retain past Put"), you can skip even that.
- Without the cap discard, one giant request inflates pooled buffers permanently.

---

## 5. Inline-friendly accessors

Inlining is what lets escape analysis "see through" calls. For tiny helpers, encourage inlining:

- Keep them short (Go's inliner has a budget per function).
- Avoid loops or `defer` inside them.
- Use the `//go:inline` hint if necessary (only in standard library / runtime; user code rarely needs it).

If a helper isn't inlining, the analyzer falls back to the summary; that's where escapes sneak in.

```bash
go build -gcflags="-m=2" 2>&1 | grep "cannot inline"
```

The message tells you why: "too complex", "function too large", "contains for/range/select", etc. Restructure if it's on the hot path.

---

## 6. Avoid `interface{}` in the loop

Replace:

```go
for _, v := range items {
    doThing(v)               // doThing(any): boxes each v
}
```

with:

```go
func doThingT[T Item](v T) { ... }

for _, v := range items {
    doThingT(v)              // no box
}
```

Or restructure the API so the loop calls a concrete-typed function.

When the API really must be polymorphic (e.g., third-party callbacks), consider:

- A pre-allocated `any` slice that you populate once, not per call.
- A method-table approach: store a `func(T)` per type at registration, dispatch through that.

---

## 7. The escape-friendly closure

```go
func process(items []Item, log func(string)) {
    for _, it := range items {
        log("processing " + it.Name)        // string concat: allocs
        it.Run()
    }
}
```

Two allocations per iteration: the concatenation and (if `log` is an interface) the param boxing.

Faster:

```go
var buf strings.Builder
buf.Grow(64)
for _, it := range items {
    buf.Reset()
    buf.WriteString("processing ")
    buf.WriteString(it.Name)
    log(buf.String())                       // string still allocates, but only once + grows once
    it.Run()
}
```

For "log if enabled" patterns, gate the formatting behind the level check entirely:

```go
if logger.Enabled(slog.LevelDebug) {
    logger.Debug("processing", "name", it.Name)
}
```

---

## 8. The `[]byte` ↔ `string` boundary

`string(b)` and `[]byte(s)` always allocate and copy in safe Go. For read-only conversions in absolutely hot paths, `unsafe` provides escape hatches:

```go
import "unsafe"

func b2s(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func s2b(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

Rules:

- The shared memory must not be mutated through the `[]byte` while the `string` is alive.
- Strings are immutable in Go's semantics; violating this corrupts maps, switch statements, etc.
- Use only at internal package boundaries with thorough documentation.

This pair (Go 1.20+) replaces the older `reflect.StringHeader`/`reflect.SliceHeader` hack.

---

## 9. Generics for monomorphic hot paths

```go
// boxes every call
func MaxAny(a, b any) any { ... }

// no boxing
func Max[T constraints.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```

Generics monomorphize per shape — typically per pointer-vs-value. Be aware: the body is shared across same-shape types, and there may be a slight performance difference vs hand-specialized code. Bench when it matters.

---

## 10. The "carry the slice" trick

Instead of returning a freshly-allocated slice, accept a destination slice and append:

```go
// allocs
func Words(s string) []string {
    var out []string
    for _, w := range strings.Fields(s) { out = append(out, w) }
    return out
}

// reuses caller's slice
func AppendWords(dst []string, s string) []string {
    for _, w := range strings.Fields(s) { dst = append(dst, w) }
    return dst
}
```

The caller can reuse the slice across calls or pre-size it. This is the standard pattern in `strconv.AppendInt`, `time.Time.AppendFormat`, and many `encoding/*` packages.

---

## 11. `errors.New` once

```go
// allocates every call
func get(k string) error {
    if !ok(k) { return errors.New("invalid key") }
    return nil
}

// allocates once, at package init
var errInvalidKey = errors.New("invalid key")

func get(k string) error {
    if !ok(k) { return errInvalidKey }
    return nil
}
```

Sentinels also enable `errors.Is(err, errInvalidKey)` for callers.

---

## 12. The "stack-allocated buffer" pattern

```go
func quickFormat(n int) string {
    var buf [20]byte
    b := strconv.AppendInt(buf[:0], int64(n), 10)
    return string(b)            // one alloc (for the result string)
}
```

`buf` is a stack array (20 bytes is plenty for an `int64`). `buf[:0]` is a zero-length slice over it. `AppendInt` fills it without allocating. Only the final `string(b)` allocates, because strings can't share with stack memory.

For pure-write paths (writing to an `io.Writer`), you can avoid even that:

```go
var buf [20]byte
b := strconv.AppendInt(buf[:0], int64(n), 10)
w.Write(b)                      // zero allocations
```

---

## 13. When **not** to fight allocation

- One-off setup code: cost is paid once, who cares.
- Code that is dominated by I/O (network, disk): syscall costs dwarf any heap allocation.
- Code that is rarely invoked: optimizing the cold path is wasted engineering.
- Code where clarity is paramount: a sentinel error or a `sync.Pool` adds maintenance debt.

Optimization without measurement is a tax on readability. Don't pay it.

---

## 14. Summary

Optimizing escape is mostly mechanical: profile, identify the costly site, apply a known transformation (value over pointer, preallocate, sync.Pool, generics, AppendXxx, sentinels, `unsafe` at borders), and confirm with `benchstat`. The toolkit is small; the discipline is everything. Keep the rest of the code clear.

---

## Further reading
- `strconv` `Append*` and `time` `AppendFormat`: examples of the buffer-carrying API
- `bytes.Buffer` and `sync.Pool` interaction patterns: Go standard library `net/http`
- `unsafe.String` / `unsafe.Slice`: https://pkg.go.dev/unsafe
- Inlining heuristics: https://github.com/golang/go/blob/master/src/cmd/compile/internal/inline/doc.go
