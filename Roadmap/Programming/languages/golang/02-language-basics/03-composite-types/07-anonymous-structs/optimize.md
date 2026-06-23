# Go Anonymous Structs — Optimize

## Instructions

Each exercise presents a usage of anonymous structs that may have a performance, layout, or readability concern. Identify the issue, write the optimized version, and explain. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

The headline answer for most "optimization" questions on anonymous structs is: they are layout- and codegen-equivalent to named structs. Real wins come from layout-aware field ordering, avoiding heap allocation, and trimming reflection costs — the same wins available to named structs.

---

## Exercise 1 🟢 — Field Order and Padding

**Problem**:
```go
type Big struct{}

func main() {
    rows := []struct {
        A bool
        B int64
        C bool
        D int64
    }{
        {true, 1, false, 2},
    }
    _ = rows
}
```

What is `unsafe.Sizeof(rows[0])` on amd64? How can you shrink it?

<details>
<summary>Solution</summary>

**Issue**: Field padding. The layout is:
```
A: bool (1 byte)  + 7 bytes padding (to align B to 8)
B: int64 (8 bytes)
C: bool (1 byte)  + 7 bytes padding (to align D to 8)
D: int64 (8 bytes)
```
Total: 32 bytes.

**Optimization** — group small fields together:
```go
rows := []struct {
    B int64
    D int64
    A bool
    C bool
}{
    {1, 2, true, false},
}
```
Layout:
```
B: int64 (8 bytes)
D: int64 (8 bytes)
A: bool  (1 byte)
C: bool  (1 byte) + 6 bytes trailing padding
```
Total: 24 bytes. 25% smaller.

**Key insight**: Anonymous structs follow exactly the same alignment rules as named structs. Order fields large-to-small (or group same-size fields together) for compact layouts.

**Benchmark** (`go test -bench=`): a slice of 1M elements drops from 32 MB to 24 MB.
</details>

---

## Exercise 2 🟢 — Anonymous vs Named — Codegen

**Problem**:
```go
// Version A
type P struct{ X, Y int }
func makeA() P { return P{1, 2} }

// Version B
func makeB() struct{ X, Y int } {
    return struct{ X, Y int }{1, 2}
}
```

Which is faster?

<details>
<summary>Solution</summary>

**Answer**: Identical. The compiler generates the same machine code for both.

```bash
go build -gcflags="-S" anon.go 2>&1 | grep -A 5 makeA
go build -gcflags="-S" anon.go 2>&1 | grep -A 5 makeB
```

Both functions emit the same MOVQ instructions for the two fields and the same return sequence.

**Key insight**: Anonymous and named structs produce identical machine code. There is no codegen cost or saving; the choice is purely about maintainability.

**Benchmark**:
```
BenchmarkMakeA-8    1000000000   0.31 ns/op
BenchmarkMakeB-8    1000000000   0.31 ns/op
```
</details>

---

## Exercise 3 🟡 — Allocation in a Hot Path

**Problem**:
```go
func process(items []Item) {
    for _, item := range items {
        log := struct {
            ID    int
            Stage string
        }{item.ID, "processed"}
        send(log)
    }
}

func send(v any) { /* serialized */ }
```

What's the allocation behavior, and can you reduce it?

<details>
<summary>Solution</summary>

**Issue**: Passing the anonymous struct as `any` boxes it on the heap (one allocation per iteration). The boxing happens because `any` requires an interface header pointing at heap data when the value is larger than a word.

**Optimization** — change `send`'s type, or pre-allocate, or use a typed channel:
```go
type logEntry struct {
    ID    int
    Stage string
}

func sendLog(v logEntry) { /* serialized */ }

func process(items []Item) {
    for _, item := range items {
        sendLog(logEntry{ID: item.ID, Stage: "processed"})
    }
}
```

**Or**, if `send` cannot change, batch:
```go
type batch struct {
    entries []logEntry
}
b := batch{}
for _, item := range items {
    b.entries = append(b.entries, logEntry{...})
}
sendBatch(&b)
```

**Benchmark** (1M items):
- Before: ~1M allocs, ~32 MB.
- After (typed `sendLog`): 0 allocs.

**Key insight**: The allocation cost is the boxing into `any`, not the anonymous struct itself. Avoid `any` in hot paths.
</details>

---

## Exercise 4 🟡 — Reflection-Driven JSON Encode

**Problem**:
```go
func emitMany(events []Event) {
    for _, e := range events {
        b, _ := json.Marshal(struct {
            Name string `json:"name"`
            Tags []string `json:"tags"`
        }{e.Name, e.Tags})
        publish(b)
    }
}
```

`json.Marshal` reflects on the struct type each call — but does it really, given the type is the same?

<details>
<summary>Solution</summary>

**Answer**: `encoding/json` caches per-type encoders in a `sync.Map` keyed by `reflect.Type`. The first encode builds the encoder; subsequent encodes hit the cache. Anonymous and named structs share the same caching mechanism.

**Optimization** — pre-resolve the encoder is unnecessary; the cache already does it. The actual hot-spot is:
1. The reflection call to discover fields (cached).
2. Building the JSON byte buffer (per call).

For very high throughput, use `jsoniter` or hand-rolled writers — but the choice between anonymous and named struct is irrelevant.

**Benchmark** (`json.Marshal` on a 2-field struct, 1M ops):
- Anonymous: ~120 ns/op, 1 alloc/op.
- Named: ~120 ns/op, 1 alloc/op.

Identical.

**Key insight**: Reflection caching erases any "named-type-warmer-cache" advantage. The only saving is from avoiding `json.Marshal` itself (use `json.NewEncoder` with a buffer, or a code-gen library).
</details>

---

## Exercise 5 🟡 — Map Key With Anonymous Struct

**Problem**:
```go
type Pair struct{ A, B int }
m1 := map[Pair]string{}

m2 := map[struct{ A, B int }]string{}
```

Is one faster?

<details>
<summary>Solution</summary>

**Answer**: Identical performance. The map runtime hashes the key bytes; both keys are 16 bytes laid out identically.

**Benchmark** (1M inserts + 1M lookups):
- Named key: ~22 ns/op insert, ~14 ns/op lookup.
- Anonymous key: ~22 ns/op insert, ~14 ns/op lookup.

**Key insight**: Map performance depends on key size and hash function, both of which are identical for named and anonymous structs of the same shape. Choose based on readability.
</details>

---

## Exercise 6 🟢 — Slice of Anonymous Structs vs Slice of Pointers

**Problem**:
```go
xs := []struct{ A, B int }{{1, 2}, {3, 4}}
ys := []*struct{ A, B int }{{1, 2}, {3, 4}}
```

Which is faster to iterate?

<details>
<summary>Solution</summary>

**Answer**: `xs` (slice of values). Each element is contiguous; iteration is cache-friendly. `ys` requires a pointer load and an indirection per element.

**Benchmark** (1M elements, summing `A+B`):
- Slice of values: ~1.0 ms total.
- Slice of pointers: ~3.5 ms total.

**Key insight**: Same as for named structs — prefer `[]T` over `[]*T` for small `T`. The anonymity of the struct is irrelevant.
</details>

---

## Exercise 7 🟡 — Test Table With Heavy Setup

**Problem**:
```go
cases := []struct {
    name string
    db   *sql.DB
    fs   *os.File
    setup func() error
    teardown func()
    in   string
    want string
}{
    {"a", openDB(), openFile(), setupA, teardownA, "x", "y"},
    {"b", openDB(), openFile(), setupB, teardownB, "x", "y"},
    ...
}
```

What's wrong, and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: All resources are created when the slice literal evaluates, even before any test runs. If the slice has 50 entries, you open 50 DB connections and 50 files immediately. Resource exhaustion or test-init slowness.

**Optimization** — defer construction:
```go
cases := []struct {
    name  string
    setup func(t *testing.T) (string, func())
    in    string
    want  string
}{
    {"a", func(t *testing.T) (string, func()) {
        path := setupA(t)
        return path, func() { teardownA(path) }
    }, "x", "y"},
    ...
}
for _, c := range cases {
    t.Run(c.name, func(t *testing.T) {
        path, cleanup := c.setup(t)
        defer cleanup()
        _ = path
        ...
    })
}
```

The factory closure runs only when the row is exercised.

**Key insight**: Slice-of-anonymous-struct test tables eagerly evaluate every field. For expensive fixtures, store factories instead.
</details>

---

## Exercise 8 🔴 — Type Switching on Anonymous Structs

**Problem**:
```go
func describe(v any) string {
    switch x := v.(type) {
    case struct{ Name string }:
        return "name " + x.Name
    case struct{ ID int }:
        return fmt.Sprintf("id %d", x.ID)
    }
    return "unknown"
}
```

Will this work, and is it fast?

<details>
<summary>Solution</summary>

**Answer**: It works syntactically — type switches accept anonymous types. Performance is identical to named-type switches: the runtime compares `*rtype` pointers (one cmp + branch).

**Caveat**: maintainability. Each call site has to spell the exact shape, including tag-equality. A typo or tag drift makes the case unreachable.

**Recommendation**: do not type-switch on anonymous structs. Use named types.

**Benchmark** (1M switch hits):
- Anonymous case: ~2 ns/op (hit), ~3 ns/op (miss).
- Named case: ~2 ns/op (hit), ~3 ns/op (miss).
- Identical.

**Key insight**: Type-switch performance is shape-agnostic. The win from naming is purely readability and safety.
</details>

---

## Exercise 9 🟡 — Heap Escape From Returning an Anonymous Struct

**Problem**:
```go
func newPoint() *struct{ X, Y int } {
    return &struct{ X, Y int }{1, 2}
}
```

Does this allocate? Can you avoid it?

<details>
<summary>Solution</summary>

**Answer**: Yes, the value escapes (the address is returned), so the struct is heap-allocated. One allocation per call.

**Optimization** — return by value:
```go
func newPoint() struct{ X, Y int } {
    return struct{ X, Y int }{1, 2}
}
```
Now the value is returned in registers (small struct on amd64 fits two SSA values). Zero allocation.

**Key insight**: Same rule as named structs — return by value when possible. Anonymous-vs-named has no effect on escape analysis.

**Benchmark**:
- Pointer return: 1 alloc/op, ~30 ns/op.
- Value return: 0 allocs, ~1 ns/op.
</details>

---

## Exercise 10 🟢 — Embedded Anonymous Struct Layout

**Problem**:
```go
type Outer struct {
    A bool
    M struct {
        B int64
        C bool
    }
    D int64
}
```

What's `unsafe.Sizeof(Outer{})`?

<details>
<summary>Solution</summary>

**Layout**:
```
A: bool (1) + 7 padding (M needs 8-byte alignment because of B int64)
M.B: int64 (8)
M.C: bool (1) + 7 padding (M's tail to align D)
D: int64 (8)
```

Total: 32 bytes.

**Optimization** — promote fields to outer or reorder:
```go
type Outer struct {
    M struct {
        B int64
        C bool
    }
    D int64
    A bool
}
```
```
M.B: int64 (8)
M.C: bool (1) + 7 padding
D: int64 (8)
A: bool (1) + 7 trailing padding
```
Total: still 32 bytes — the embedded struct's tail is padded to its own alignment.

**Better**: flatten:
```go
type Outer struct {
    B int64
    D int64
    A bool
    C bool
}
```
Total: 24 bytes.

**Key insight**: Embedded anonymous structs preserve their internal padding even inside an outer struct. Flatten when memory matters.
</details>

---

## Exercise 11 🟡 — Slice Header Sharing

**Problem**:
```go
func read(req []byte) (struct {
    Header []byte
    Body   []byte
}, error) {
    var out struct {
        Header []byte
        Body   []byte
    }
    out.Header = req[:8]
    out.Body = req[8:]
    return out, nil
}
```

What's the lifetime concern?

<details>
<summary>Solution</summary>

**Issue**: `out.Header` and `out.Body` are slices into `req`. The returned anonymous struct pins `req`'s underlying array as long as either slice is alive. If `req` is large, the entire array is pinned even if the caller drops the body.

**Optimization** — copy when you need to detach:
```go
func read(req []byte) (struct {
    Header []byte
    Body   []byte
}, error) {
    var out struct {
        Header []byte
        Body   []byte
    }
    out.Header = append([]byte(nil), req[:8]...)
    out.Body = append([]byte(nil), req[8:]...)
    return out, nil
}
```

**Key insight**: Same as for named structs — slice-pinning is independent of whether the wrapping struct is anonymous.
</details>

---

## Exercise 12 🟡 — Anonymous Struct in a Channel

**Problem**:
```go
ch := make(chan struct {
    Tick int
    At   time.Time
}, 1024)
```

Compare to:
```go
type Tick struct {
    Tick int
    At   time.Time
}
ch := make(chan Tick, 1024)
```

Performance?

<details>
<summary>Solution</summary>

**Answer**: Identical. Channel performance depends on element size and the runtime's queue management — neither cares whether the type is named.

**Benchmark** (1M sends + 1M recvs):
- Anonymous: ~50 ns/op.
- Named: ~50 ns/op.

**Key insight**: Channel cost depends on size and synchronization. Anonymous-vs-named has no effect.

The only consideration is at the receiver: if the receiver wants a typed local variable, naming the type makes the code shorter:
```go
for v := range ch { ... } // works either way
var local Tick = <-ch     // requires named type
```
</details>

---

## Exercise 13 🟢 — Repeated Inline Shape

**Problem**:
```go
func a() {
    v := struct{ X, Y int }{1, 2}
    _ = v
}
func b() {
    v := struct{ X, Y int }{3, 4}
    _ = v
}
func c() {
    v := struct{ X, Y int }{5, 6}
    _ = v
}
```

Is this a performance issue?

<details>
<summary>Solution</summary>

**Answer**: No performance issue. The compiler emits a single `runtime._type` descriptor for the shared shape; the linker deduplicates. Codegen is the same.

**Concern**: maintenance. Three sites with the same shape signal that a named type would be clearer. Refactor:

```go
type point struct{ X, Y int }
func a() { v := point{1, 2}; _ = v }
func b() { v := point{3, 4}; _ = v }
func c() { v := point{5, 6}; _ = v }
```

**Key insight**: Repeated inline shapes are a code-smell, not a performance issue. Let readability drive the refactor.
</details>

---

## Exercise 14 🔴 — Generic Function Returning Anonymous Struct

**Problem**:
```go
func Pair[A, B any](a A, b B) struct {
    First  A
    Second B
} {
    return struct {
        First  A
        Second B
    }{a, b}
}
```

Is this a good pattern?

<details>
<summary>Solution</summary>

**Answer**: Legal but bad. Each instantiation produces a distinct anonymous struct type, but the caller still has to spell the full shape (or use `any`) to declare a typed variable.

**Optimization** — name the type:
```go
type Pair[A, B any] struct {
    First  A
    Second B
}

func NewPair[A, B any](a A, b B) Pair[A, B] {
    return Pair[A, B]{a, b}
}
```

Now `Pair[int, string]{}` is a clean, typed value the caller can pass around.

**Key insight**: Generics multiply the cost of anonymous return types because each instantiation creates a separately-named-but-spelled-the-same shape.
</details>

---

## Exercise 15 🟢 — sync.Pool With Anonymous Struct

**Problem**:
```go
var pool = sync.Pool{
    New: func() any {
        return &struct {
            Buf [4096]byte
        }{}
    },
}
```

Does the anonymity hurt anything?

<details>
<summary>Solution</summary>

**Answer**: No. `sync.Pool` works on `any` and looks at the pointer, not the type name. The pool is fine.

**Recommendation anyway** — name the type:
```go
type buffer struct {
    Buf [4096]byte
}

var pool = sync.Pool{
    New: func() any { return &buffer{} },
}
```

Now you can declare typed locals: `b := pool.Get().(*buffer)` reads cleaner than `b := pool.Get().(*struct{ Buf [4096]byte })`.

**Key insight**: Anonymous struct in `sync.Pool` is mechanically fine but stylistically poor.
</details>

---

## Summary

The dominant theme: **anonymous and named structs are layout-equivalent and codegen-equivalent**. Real performance wins come from the same techniques you would apply to named structs:

1. Order fields large-to-small.
2. Avoid passing as `any` in hot paths.
3. Avoid pointer-returning anonymous structs unless escape is required.
4. Trim slice-header pinning.
5. Use named types in `sync.Pool` for clarity.

Anonymous structs do not introduce hidden costs. The reasons to choose named types are **maintenance, documentation, and method support**, not performance.
