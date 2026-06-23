# Go Call by Value — Optimize

## Instructions

Each exercise presents inefficient or wasteful patterns around argument passing. Identify the issue, write an optimized version, and explain. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Large Struct By Value in Hot Loop

**Problem**:
```go
type State struct {
    Buffer [1024]byte
}

func process(s State) byte {
    return s.Buffer[0]
}

// Hot:
// for i := 0; i < N; i++ {
//     _ = process(state)
// }
```

**Question**: What's the cost? How do you fix?

<details>
<summary>Solution</summary>

**Issue**: Each call copies 1 KB of `state` into the parameter. For 1M calls/sec, 1 GB/sec of memory traffic.

**Optimization** — pass by pointer:
```go
func process(s *State) byte {
    return s.Buffer[0]
}

for i := 0; i < N; i++ {
    _ = process(&state)
}
```

**Benchmark** (10M calls):
- By value: ~150 ns/op
- By pointer: ~1 ns/op (~150×)

For struct sizes > ~64 B, pointer pass is dramatically faster.

**Key insight**: Large structs (~> 64 B) by value pay a memcpy on every call. Use pointers in hot paths.
</details>

---

## Exercise 2 🟢 — Slice Passed by Value (Already Efficient)

**Problem**:
```go
func sum(nums []int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}
```

**Question**: Should you "optimize" by passing `*[]int`?

<details>
<summary>Solution</summary>

**Discussion**: A slice header is 24 B (3 registers). Passing by value is essentially free.

`*[]int` would be 8 B (1 register), saving 2 register loads — but at every access, you'd dereference the pointer to read the header. Net result: similar or slightly slower.

`*[]int` is needed when:
- You want to reassign the caller's slice (rare).
- The slice header is part of a struct that's mutated.

For pure reading or element mutation, plain `[]int` is preferred.

**Benchmark**: identical.

**Key insight**: Slice/map/channel/interface headers are small. Passing by value is the right choice. Only use `*[]int` when you need header reassignment.
</details>

---

## Exercise 3 🟢 — Returning Pointer to Local

**Problem**:
```go
func newPoint(x, y int) *Point {
    p := Point{X: x, Y: y}
    return &p
}
```

**Question**: Why does this allocate?

<details>
<summary>Solution</summary>

**Issue**: `&p` escapes to the heap because the function returns it. Per call: 1 heap allocation for Point.

**Optimization** — return by value when Point is small:
```go
func newPoint(x, y int) Point {
    return Point{X: x, Y: y}
}
```

For `Point` (16 B), the register ABI passes it back via 2 registers — no allocation.

**Benchmark** (10M calls):
- Return *Point: ~20 ns/op, 16 B/op, 1 alloc/op
- Return Point: ~3 ns/op, 0 B/op, 0 allocs/op

**Caveat**: if the caller will store the value and pass pointers around, a pointer return is fine. The choice depends on usage.

**Key insight**: For small types, return by value. Pointer returns force heap allocation.
</details>

---

## Exercise 4 🟡 — Method Receiver Choice

**Problem**:
```go
type Big struct {
    Data [256]int
}

// Read-only method
func (b Big) Sum() int {
    s := 0
    for _, v := range b.Data {
        s += v
    }
    return s
}
```

**Question**: Value receiver — efficient?

<details>
<summary>Solution</summary>

**Issue**: Value receiver copies 2 KB per call. For a method that just reads, this is wasteful.

**Optimization** — pointer receiver:
```go
func (b *Big) Sum() int {
    s := 0
    for _, v := range b.Data {
        s += v
    }
    return s
}
```

Now each call passes an 8 B pointer, not a 2 KB struct.

**Benchmark** (1M calls):
- Value receiver: ~300 ns/op
- Pointer receiver: ~150 ns/op

For larger structs, the gap is even bigger.

**Caveat**: pointer receivers prevent inlining of the method in some cases; value receivers can inline if the method body is small. Profile to verify.

**Key insight**: For methods on large types, prefer pointer receivers — even for read-only methods. The copy cost dominates.
</details>

---

## Exercise 5 🟡 — Defensive Copy Per Call

**Problem**:
```go
func filter(items []Item, keep func(Item) bool) []Item {
    out := append([]Item(nil), items...) // BUG: copies before filtering
    j := 0
    for _, it := range out {
        if keep(it) {
            out[j] = it
            j++
        }
    }
    return out[:j]
}
```

**Question**: Why is the defensive copy wasteful here?

<details>
<summary>Solution</summary>

**Issue**: The function copies the entire input before filtering. If we want to return a NEW slice (not modify the input), we should allocate ONLY the filtered elements, not the full input.

**Optimization** — allocate only what's needed:
```go
func filter(items []Item, keep func(Item) bool) []Item {
    out := make([]Item, 0, len(items)) // capacity for worst case
    for _, it := range items {
        if keep(it) {
            out = append(out, it)
        }
    }
    return out
}
```

Or in-place (if mutation is OK):
```go
func filter(items []Item, keep func(Item) bool) []Item {
    j := 0
    for _, it := range items {
        if keep(it) {
            items[j] = it
            j++
        }
    }
    return items[:j] // shares backing with input
}
```

**Benchmark** (10k items, 50% pass):
- Naive copy + filter: ~80 µs/op, 16 KB/op, 1 alloc/op
- Pre-allocated only: ~40 µs/op, 8 KB/op, 1 alloc/op
- In-place: ~30 µs/op, 0 allocs/op

**Key insight**: Defensive copy is for safety, not optimization. If you only need a subset, allocate only the subset.
</details>

---

## Exercise 6 🟡 — Interface Boxing Allocates

**Problem**:
```go
func log(msg string, args ...any) {
    // ... use args ...
    _ = args
}

// Hot:
// for i := 0; i < N; i++ {
//     log("count=%d sum=%d", i, sum)
// }
```

**Question**: What allocates?

<details>
<summary>Solution</summary>

**Issue**: Each `int` argument is boxed into an `any` (interface) value. For most ints (outside the staticuint64s pool), this allocates 8 B per arg.

For `log("count=%d sum=%d", i, sum)`:
- `i` (likely outside pool): 1 alloc.
- `sum`: 1 alloc.
- Implicit `[]any{...}` slice: usually stack-allocated.

Total: ~2 allocs per call. For 1M calls/sec, 2M allocs/sec.

**Optimization** — typed Field API:
```go
type Field struct {
    Key   string
    Type  fieldType
    Int64 int64
}

func IntField(k string, v int) Field { return Field{Key: k, Type: tInt, Int64: int64(v)} }

func log(msg string, fs ...Field) {
    // ... use fs ...
}

log("event", IntField("count", i), IntField("sum", sum))
```

Now zero allocations per call (Field is small enough to be register-passed).

**Benchmark** (1M calls):
- `log("...", i, sum)` via `...any`: ~80 ns/op, 32 B/op, 2 allocs/op
- `log("...", IntField(...), IntField(...))`: ~15 ns/op, 0 allocs/op

**Key insight**: `...any` boxes each non-pointer arg. Typed APIs eliminate boxing for hot logging paths.
</details>

---

## Exercise 7 🔴 — Pre-Allocate Result Capacity

**Problem**:
```go
func double(items []int) []int {
    var out []int
    for _, v := range items {
        out = append(out, v*2)
    }
    return out
}
```

**Question**: How does append's growth strategy hurt?

<details>
<summary>Solution</summary>

**Issue**: `append` to nil slice triggers growth: 0 → 1 → 2 → 4 → 8 → 16 → ... Each growth allocates a new backing array and copies. Total: ~log2(N) allocations + copies.

For 10k items, ~14 reallocations.

**Optimization** — pre-allocate to known size:
```go
func double(items []int) []int {
    out := make([]int, len(items))
    for i, v := range items {
        out[i] = v * 2
    }
    return out
}
```

Single allocation; no copies.

**Benchmark** (10k items):
- Naive append: ~80 µs/op, 80 KB/op, 14 allocs/op
- Pre-allocated: ~30 µs/op, 80 KB/op, 1 alloc/op

For known sizes, always pre-allocate.

**Key insight**: When the output size is predictable, allocate once.
</details>

---

## Exercise 8 🔴 — Avoid Copy in Method by Storing State Externally

**Problem**:
```go
type Service struct {
    BigConfig BigConfig // 4 KB
}

func (s Service) handle(req Request) Response {
    // ... uses s.BigConfig ...
    return Response{}
}
```

**Question**: Each method call copies 4 KB of Service. How do you fix?

<details>
<summary>Solution</summary>

**Issue**: Value receiver copies the entire 4 KB Service struct per call.

**Optimization 1** — pointer receiver:
```go
func (s *Service) handle(req Request) Response {
    // ... uses s.BigConfig ...
    return Response{}
}
```

Now each call passes 8 B (pointer). Same access semantics inside.

**Optimization 2** — separate config from service:
```go
type Service struct {
    Config *BigConfig // pointer to shared config
}

func (s Service) handle(req Request) Response {
    cfg := s.Config // pointer copy
    // ... use cfg ...
    return Response{}
}
```

Multiple Service instances share the same BigConfig.

**Benchmark** (1M calls):
- Value receiver: ~400 ns/op
- Pointer receiver: ~10 ns/op

**Key insight**: For services with large state, use pointer receivers OR refactor to share state via pointers.
</details>

---

## Exercise 9 🔴 — Eliminating Per-Call Slice Allocation

**Problem**:
```go
func formatItems(items []Item) string {
    var parts []string
    for _, it := range items {
        parts = append(parts, it.String())
    }
    return strings.Join(parts, ",")
}
```

**Question**: How can you avoid both the slice allocation and the join?

<details>
<summary>Solution</summary>

**Optimization** — use a `strings.Builder`:
```go
import "strings"

func formatItems(items []Item) string {
    var sb strings.Builder
    for i, it := range items {
        if i > 0 {
            sb.WriteString(",")
        }
        sb.WriteString(it.String())
    }
    return sb.String()
}
```

The builder's internal buffer can grow (similar to slice append) but only one final allocation for the resulting string.

**Optimization with capacity**:
```go
func formatItems(items []Item) string {
    var sb strings.Builder
    sb.Grow(estimateSize(items))
    for i, it := range items {
        if i > 0 { sb.WriteString(",") }
        sb.WriteString(it.String())
    }
    return sb.String()
}
```

**Benchmark** (10k items):
- Original: ~800 µs/op, 320 KB/op
- Builder: ~400 µs/op, 80 KB/op
- Builder + Grow: ~300 µs/op, 40 KB/op

**Key insight**: For string building, `strings.Builder` is more efficient than build-then-join. Pre-allocate with `Grow` for known sizes.
</details>

---

## Exercise 10 🔴 — Sub-slice Holds Onto Large Backing

**Problem**:
```go
func extractFirst10(big []byte) []byte {
    return big[:10] // shares big's backing
}

func main() {
    big := readLargeFile() // 100 MB
    first := extractFirst10(big)
    big = nil // try to release
    // first holds onto 100 MB through the sub-slice
}
```

**Question**: How do you fix?

<details>
<summary>Solution</summary>

**Issue**: `big[:10]` is a view into `big`'s backing array. As long as `first` exists, the entire 100 MB array stays alive.

**Optimization** — copy the bytes out:
```go
func extractFirst10(big []byte) []byte {
    out := make([]byte, 10)
    copy(out, big[:10])
    return out
}
```

Now `first` has its own 10-byte backing; `big`'s array is collectable.

**Benchmark** — for sub-slice memory, use a profile (`pprof -inuse_space`) to see retained heap before and after.

**Key insight**: Sub-slices keep the entire backing array alive. For long-term storage of small portions, copy explicitly.
</details>

---

## Bonus Exercise 🔴 — Verify a Function Stays in Registers

**Problem**:
```go
type Pair struct{ A, B int }

func combine(p Pair) int {
    return p.A + p.B
}
```

**Task**: Show how to verify the struct is register-passed (not stack-spilled).

<details>
<summary>Solution</summary>

**Step 1 — assembly**:
```bash
go build -gcflags="-S" -o /dev/null . 2>asm.txt
grep -A 10 "main.combine" asm.txt
```

Expected (amd64):
```
main.combine STEXT
    ADDQ BX, AX        ; AX = a + b (a was in AX, b in BX)
    RET
```

Two registers in (AX, BX), one register out (AX). No stack frame.

**Step 2 — escape analysis**:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "Pair|combine"
```

Expected: no "moved to heap"; everything stays on the stack.

**Step 3 — benchmark**:
```go
func BenchmarkCombine(b *testing.B) {
    p := Pair{1, 2}
    s := 0
    for i := 0; i < b.N; i++ {
        s += combine(p)
    }
    _ = s
}
```

```bash
go test -bench=Combine -benchmem
# BenchmarkCombine-8    1000000000   0.5 ns/op   0 B/op   0 allocs/op
```

If you see ~0.5 ns/op with 0 allocs, the struct is register-passed and the call inlined.

**Key insight**: For small structs, the register ABI is very efficient. Verify with assembly + benchmarks.
</details>
