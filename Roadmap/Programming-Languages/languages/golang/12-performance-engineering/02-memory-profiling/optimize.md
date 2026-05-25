# Memory Profiling in Go — Optimization Playbook

A field guide to allocation-reduction techniques, organized by what the profile told you. Each section: the signal in `pprof`, the cause, the fix, an example, and the expected improvement.

---

## 1. Always profile first

Before applying *any* technique below, capture a profile. Memory optimizations are easy to do wrong — they cost code clarity and they're satisfying, which is a dangerous combination. The rule is the same as for any performance work:

```
measure → hypothesize → change → measure
```

If you can't show a profile before and after, the change shouldn't merge.

---

## 2. Preallocate slices when the size is known

**Signal:** `runtime.growslice` near the top of `alloc_space`.

**Cause:** `append` to a nil or small slice causes geometric growth — the runtime allocates a larger backing array, copies, and the old array becomes garbage. For N appends, total work is O(N) and total throwaway memory is O(N).

**Before:**

```go
out := []string{}
for _, x := range src {
    out = append(out, transform(x))
}
```

**After:**

```go
out := make([]string, 0, len(src))
for _, x := range src {
    out = append(out, transform(x))
}
```

**Improvement:** Typically `O(log N)` fewer allocations and zero copy overhead. In a slice of 10k elements, this can drop from ~14 allocations to 1.

The same applies to `bytes.Buffer.Grow(n)` and to `make(map[K]V, n)` for maps with a known size.

---

## 3. Pre-size maps

**Signal:** `runtime.hashGrow` or `runtime.mapassign_*` high in `alloc_space`.

**Cause:** Maps double their bucket count when load factor exceeds ~6.5. Each rehash allocates a new bucket array; the old one becomes garbage.

**Before:**

```go
m := make(map[string]int)
for _, k := range keys {
    m[k]++
}
```

**After:**

```go
m := make(map[string]int, len(keys))
for _, k := range keys {
    m[k]++
}
```

**Improvement:** No rehashing. For a 100k-entry map, the difference is one allocation instead of ~14.

Note: Go maps **never shrink**. Pre-sizing buys allocation efficiency; it doesn't change the resident size after deletes.

---

## 4. `sync.Pool` for short-lived, frequently-reused allocations

**Signal:** Same allocation site appears with high `alloc_objects` count, but low `inuse_objects` — most are short-lived.

**Cause:** Per-request scratch buffers. The pattern: allocate, use, discard, repeat.

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handle(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        if buf.Cap() <= 64<<10 {
            buf.Reset()
            bufPool.Put(buf)
        }
    }()

    // ... use buf ...
}
```

Three rules to remember:

| Rule | Why |
|------|-----|
| **Always Reset before Put** | Otherwise the next caller sees stale data and you've leaked references |
| **Drop oversized values** | One 64 MiB request would pin 64 MiB per pool slot forever |
| **Pool only for hot paths** | Cold pools cost more than they save (the eviction-on-GC isn't free) |

**Improvement:** Often 10× fewer allocations in the hot site. The GC sees fewer objects, the allocator's slow path runs less, and the buffer reuse is essentially zero-cost.

---

## 5. Avoid interface boxing

**Signal:** `runtime.convT*` (`convT16`, `convT32`, `convTslice`, etc.) appears in `alloc_objects`.

**Cause:** Converting a value to an `interface{}` (or any interface whose dynamic type is larger than a word) boxes the value — allocates a heap copy and stores its address in the interface header.

**Before:**

```go
type Point struct{ X, Y int }

func log(v any) { fmt.Println(v) }

for _, p := range points {
    log(p)   // each call boxes p
}
```

**After:**

```go
func log(p Point) { fmt.Println(p.X, p.Y) }
```

Or, if a generic function helps:

```go
func log[T any](v T) { fmt.Println(v) }
```

**Improvement:** Eliminates one allocation per call. For a million-iteration loop, this is a million allocations saved.

When the interface conversion is unavoidable (you genuinely need polymorphism), prefer pointer receivers — the pointer can be stored directly in the interface header without copying:

```go
var l logger = &stdoutLogger{}   // boxed once
```

---

## 6. Value vs pointer: choose deliberately

**Signal:** Small structs allocated in tight loops, often visible as `runtime.newobject` or named-type allocations.

**Cause:** Returning a pointer escapes the local; returning a value copies it but keeps it on the stack.

**Before:**

```go
type Point struct{ X, Y int }

func newOrigin() *Point {
    return &Point{}    // escapes: caller has a heap pointer
}
```

**After:**

```go
func newOrigin() Point {
    return Point{}     // value returned, no heap allocation
}
```

The general rule, validated against your profile:

| Size of T | Pointer or value? |
|-----------|-------------------|
| ≤ ~64 bytes | Usually value (cheap to copy, stays on stack) |
| 64–512 bytes | Measure; both are reasonable |
| > 512 bytes or contains a slice/map | Usually pointer (avoid copy cost) |

`-gcflags="-m"` confirms whether your "value" actually stays on the stack — sometimes interface conversion or closure capture still forces it to escape.

---

## 7. `strings.Builder` and `strconv` over `fmt`

**Signal:** `fmt.Sprintf`, `fmt.Sprintln`, `fmt.Fprintf` in the top frames of `alloc_objects`.

**Cause:** Every `Sprintf` allocates the format args slice (`[]interface{}{...}`), boxes each argument, allocates the result string, and may allocate intermediate buffers. It's ~6–10 allocations per call.

**Before:**

```go
s := fmt.Sprintf("user=%s,id=%d", user, id)
```

**After:**

```go
var b strings.Builder
b.Grow(32)
b.WriteString("user=")
b.WriteString(user)
b.WriteString(",id=")
b.WriteString(strconv.Itoa(id))
s := b.String()
```

**Improvement:** Roughly 1 allocation instead of 6–10. Reserve `fmt` for human-readable, low-frequency output (logs, errors); use `strings.Builder` + `strconv` in hot paths.

For error wrapping, `errors.Join` and `fmt.Errorf("...: %w", err)` are unavoidable — but those are usually on cold paths.

---

## 8. Reuse the output buffer (pass-in instead of return)

**Signal:** Repeated allocations of slices/buffers that are returned from a function called in a loop.

**Cause:** Each call returns a fresh allocation; the caller can't reuse.

**Before:**

```go
func encode(v Value) []byte {
    buf := make([]byte, 0, 64)
    // ... append ...
    return buf
}

for _, v := range values {
    out := encode(v)
    send(out)
}
```

**After:**

```go
func encodeInto(buf []byte, v Value) []byte {
    // ... append into buf ...
    return buf
}

scratch := make([]byte, 0, 64)
for _, v := range values {
    scratch = encodeInto(scratch[:0], v)
    send(scratch)
}
```

**Improvement:** One allocation outside the loop instead of N inside. This is the pattern used by `strconv.AppendInt`, `time.Time.AppendFormat`, and `encoding/binary` — match it in your own code.

---

## 9. Escape-aware coding

Use `-gcflags="-m"` to learn which lines escape and rewrite them. Common rewrites:

| Pattern | Escape | Rewrite |
|---------|--------|---------|
| `return &T{...}` | `T` heap-allocated | Return `T` by value if size small |
| `var x T; f(&x)` where `f` stores `&x` | `x` heap-allocated | Have `f` take by value if write-only |
| `i := interface{}(v)` where `v` is large | `v` boxed | Use generics or concrete type |
| Closure captures large struct | Struct may escape | Capture only fields needed |
| `make([]T, n)` with `n` dynamic and slice escapes | Heap-allocated | Pre-size with constant where possible |

The compiler is precise. If `-gcflags="-m"` says something escapes, it does — there's no "but it should be safe" you can wish into existence. Either change the code, or accept the allocation.

---

## 10. Avoid `time.After` in long-lived loops

**Signal:** Memory creeps when a `select` with `time.After` is hot.

**Cause:** Each `time.After(d)` returns a new channel that's only collected when the timer fires. In a busy loop, hundreds or thousands of pending timers accumulate.

**Before:**

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(5 * time.Second):
        tick()
    }
}
```

**After:**

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(5 * time.Second)

    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        tick()
    }
}
```

(Go 1.23+ fixed the leak in the original pattern, but the `NewTimer` form is still more efficient because it reuses one timer object.)

---

## 11. Avoid `[]byte(s)` and `string(b)` round-trips

**Signal:** `runtime.stringtoslicebyte` and `runtime.slicebytetostring` in `alloc_space`.

**Cause:** Both conversions allocate and copy. There's no way for the runtime to share the underlying memory because strings are immutable and `[]byte` is not.

**Before:**

```go
for _, line := range lines {
    w.Write([]byte(line))
}
```

**After:**

```go
for _, line := range lines {
    io.WriteString(w, line)
}
```

`io.WriteString` checks if the writer implements `StringWriter` and uses the fast path. `bytes.Buffer`, `strings.Builder`, `bufio.Writer`, and most HTTP writers do.

For read-only access to a string's bytes without copy, Go 1.20+ provides `unsafe.StringData(s)` — use sparingly, with review, and only when the profile actually justifies it.

---

## 12. Cache compiled regexps

**Signal:** `regexp.MustCompile` (or `Compile`) in `alloc_space`.

**Cause:** Each compile allocates the entire automaton structure — often kilobytes per call.

**Before:**

```go
func validate(s string) bool {
    return regexp.MustCompile(`^[a-z]+$`).MatchString(s)
}
```

**After:**

```go
var validateRe = regexp.MustCompile(`^[a-z]+$`)

func validate(s string) bool {
    return validateRe.MatchString(s)
}
```

**Improvement:** One allocation at package init, zero per call. For high-traffic handlers this is hundreds of allocations per second saved.

---

## 13. Decode into typed structs, not `map[string]interface{}`

**Signal:** `encoding/json.(*decodeState).objectInterface` allocates heavily.

**Cause:** Decoding JSON into `interface{}` produces a `map[string]interface{}`, with one heap allocation per key, one for the value boxing, and a chain of nested maps. Decoding into a typed struct uses preallocated fields.

**Before:**

```go
var m map[string]interface{}
json.Unmarshal(raw, &m)
```

**After:**

```go
type Event struct {
    ID      string `json:"id"`
    Ts      int64  `json:"ts"`
    Payload string `json:"payload"`
}
var ev Event
json.Unmarshal(raw, &ev)
```

**Improvement:** Often 5–10× fewer allocations. For high-throughput services parsing JSON, this is the single biggest win available.

When the schema is genuinely dynamic, prefer `json.RawMessage` for the dynamic field and a typed struct around it; you defer the per-field allocation until you actually need to decode that branch.

---

## 14. Pooled byte slices, sized by class

For variable-sized buffers, a single pool stores wildly different sizes and wastes most of the memory. The fix is a **slab pool**:

```go
var slabs [16]sync.Pool

func init() {
    for i := range slabs {
        size := 1 << (i + 6)   // 64, 128, 256, ..., 2 MiB
        slabs[i].New = func() any {
            buf := make([]byte, size)
            return &buf
        }
    }
}

func getBuf(n int) *[]byte {
    for i := range slabs {
        if 1<<(i+6) >= n {
            return slabs[i].Get().(*[]byte)
        }
    }
    buf := make([]byte, n)
    return &buf
}
```

(Note: `sync.Pool` holds pointer types more cheaply than value types — returning `*[]byte` avoids reboxing on every Get/Put.)

This is how `bytes.Buffer`, `net/http`'s body reader, and most byte-heavy libraries handle it internally. Worth it when allocations of varying sizes dominate the profile.

---

## 15. Use `make([]T, len)` over `append` when you know the count

A subtle one:

**Before:**

```go
out := make([]int, 0, n)
for i := 0; i < n; i++ {
    out = append(out, f(i))
}
```

**After:**

```go
out := make([]int, n)
for i := 0; i < n; i++ {
    out[i] = f(i)
}
```

Both produce the same final slice. The second variant skips the bounds check in `append`'s slow path and tends to vectorize better. Profile shows a marginal difference, but it's free.

---

## 16. The negative checklist — when NOT to optimize

| Situation | Why not |
|-----------|---------|
| The function is cold (called once per minute) | Allocation cost doesn't matter |
| The allocation is for a long-lived structure | Pooling doesn't help |
| Code clarity drops significantly | The clarity is worth more than the bytes |
| You don't have a before/after profile | You're guessing |
| The fix introduces `unsafe` | The bug it'll cause costs more than the bytes |
| The hot path is downstream (network, DB) | Allocation isn't the bottleneck |

A reviewer's "I don't see the profile" should kill any allocation-reduction PR.

---

## 17. Summary

Memory optimization in Go is a small toolbox applied surgically: preallocate when the size is known, pool when allocations are short-lived and frequent, avoid interface boxing in hot loops, prefer value semantics for small types, use `strings.Builder`/`strconv` over `fmt`, and cache anything expensive to construct. None of these are clever; they're the well-known set, and each has a clear pprof signature. The actual skill is knowing **which** to apply, and that comes from reading the profile carefully before changing any line.

---

## Further reading
- High-performance Go workshop (Dave Cheney): https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html
- 100 Go mistakes: https://100go.co
- `sync.Pool` semantics: https://pkg.go.dev/sync#Pool
- `strconv.AppendInt`-style API: https://pkg.go.dev/strconv#AppendInt
- Generics for allocation-free polymorphism: https://go.dev/doc/tutorial/generics
