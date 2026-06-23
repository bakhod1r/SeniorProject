# Array to Slice Conversion — Professional / Internals Guide

## 1. How It Works Internally

### The Slice Header in Go's Runtime

In Go, every slice is represented by a three-word struct called `SliceHeader` (defined in `reflect` package for external code, but internally in `cmd/compile/internal/types`):

```go
// From reflect/value.go (simplified)
type SliceHeader struct {
    Data uintptr // pointer to first element
    Len  int
    Cap  int
}
```

When you write `s := arr[i:j]`, the compiler emits code equivalent to:

```go
s = SliceHeader{
    Data: uintptr(unsafe.Pointer(&arr[0])) + uintptr(i)*unsafe.Sizeof(arr[0]),
    Len:  j - i,
    Cap:  len(arr) - i,
}
```

No runtime function call is needed — this is a **compile-time transformation** into a struct literal assignment.

---

## 2. Runtime Deep Dive

### Bounds Checking

Go's compiler inserts bounds checks for all slice expressions. The check for `arr[i:j]` is:

```
if uint(i) > uint(j) { panic: slice bounds out of range }
if uint(j) > uint(len(arr)) { panic: slice bounds out of range }
```

For `arr[i:j:k]`:
```
if uint(i) > uint(j) { panic }
if uint(j) > uint(k) { panic }
if uint(k) > uint(len(arr)) { panic }
```

Note the use of **unsigned comparison**: `uint(i) > uint(j)` catches negative indices without a separate `< 0` check, since a negative int becomes a very large uint.

### Bounds Check Elimination (BCE)

The compiler's SSA pass (`cmd/compile/internal/ssa`) performs **bounds check elimination** when it can prove at compile time that indices are in range:

```go
func sumFixed(arr *[8]int) int {
    sum := 0
    for i := 0; i < 8; i++ { // compiler KNOWS 0 <= i < 8 == len(arr)
        sum += arr[i]         // bounds check ELIMINATED
    }
    return sum
}
```

You can verify with:
```bash
go build -gcflags="-d=ssa/prove/debug=1" . 2>&1 | grep "Proved"
```

---

## 3. Compiler Perspective

### SSA Form for Array-to-Slice Conversion

Given:
```go
arr := [4]int{1, 2, 3, 4}
s := arr[1:3]
```

The compiler's SSA IR (simplified) looks like:

```
v1 = LocalAddr <*[4]int> arr
v2 = ConstInt <int> 1
v3 = ConstInt <int> 3
; bounds check
v4 = IsInBounds v2 v3           // 1 <= 3?
v5 = IsSliceInBounds v3 (len 4) // 3 <= 4?
PanicBounds v4
PanicBounds v5
; build slice header
v6 = PtrIndex v1 v2             // &arr[1]
v7 = Sub v3 v2                  // len = 3-1 = 2
v8 = Sub (len arr) v2           // cap = 4-1 = 3
s = SliceMake v6 v7 v8
```

### Assembly Output

For a simple `arr[:]` conversion, no assembly is generated beyond computing the address:

```asm
// arr := [4]int{1,2,3,4}  (on stack at SP+0)
// s := arr[:]
LEAQ 0(SP), AX          // AX = &arr[0]
MOVQ AX, s+0(SP)        // s.Data = &arr[0]
MOVQ $4, s+8(SP)        // s.Len  = 4
MOVQ $4, s+16(SP)       // s.Cap  = 4
// No function call, no allocation — 3 MOV instructions
```

---

## 4. Memory Layout

### Stack Frame

```
Stack frame of a function with `var arr [4]int; s := arr[1:3]`:

Offset  Size  Field
  0      32   arr[0..3]   (4 × 8 bytes)
 32       8   s.Data      (pointer to arr[1], i.e., SP+8)
 40       8   s.Len       (2)
 48       8   s.Cap       (3)

SP+8 == address of arr[1] — s.Data points INTO the same stack frame.
```

### Heap Layout (when array escapes)

```
Heap object header (16 bytes): {type*, size}
├── arr[0]  8 bytes
├── arr[1]  8 bytes
├── arr[2]  8 bytes
└── arr[3]  8 bytes

Slice s:
├── Data: heap_addr + 8   (points to arr[1])
├── Len: 2
└── Cap: 3
```

### Alignment

Go guarantees that arrays are aligned to their element type's alignment. For `[N]int64`, alignment is 8 bytes. This makes array-derived slices suitable for atomic operations:

```go
var counters [4]int64
// counters[i] is guaranteed 8-byte aligned — safe for sync/atomic
atomic.AddInt64(&counters[0], 1)
```

---

## 5. OS / Syscall Level

### How Stack Memory Is Managed

Go goroutine stacks are managed by the runtime, not the OS directly. The initial stack size is 8 KB (as of Go 1.21). When a goroutine's stack grows, Go uses **stack copying** (formerly stack segmentation):

1. A new, larger stack is allocated.
2. All live pointers in the old stack (including slice Data pointers) are updated to point into the new stack.
3. The old stack is freed.

This means **slice headers on the stack are correctly updated** during stack growth — Go's GC cooperates with the stack copier to fix up all pointers.

### mmap and Large Arrays

When you declare a large array (`> 32 KB` approximately), the Go runtime may use `mmap(2)` via its page allocator:

```
OS memory layout for a 1 MB array:
mmap(NULL, 1MB, PROT_READ|PROT_WRITE, MAP_ANONYMOUS|MAP_PRIVATE, -1, 0)
→ returns virtual address 0x7f...

The runtime's `mallocgc` is called, which calls `mheap_.alloc()`
which eventually calls `sysAlloc` which calls `mmap`.
```

For stack-allocated arrays, no syscall occurs — the goroutine stack is pre-allocated.

---

## 6. Source Code Walkthrough

### Slice expression lowering: `cmd/compile/internal/typecheck`

File: `cmd/compile/internal/typecheck/typecheck.go`

```go
// tcSlice typechecks a slice expression n[low:high:max]
func tcSlice(n *ir.SliceExpr) ir.Node {
    // ... validates types, computes len/cap ...
    // Emits OSLICEARR (for arrays) or OSLICE (for slices)
    // OSLICEARR is special: it takes the address of the array first
}
```

The `OSLICEARR` node is lowered to `OSLICE` of a pointer:
```
arr[i:j]  → (&arr)[i:j]
```

This is why `arr[i:j]` and `(&arr)[i:j]` produce identical code.

### Runtime panicslice: `runtime/slice.go`

```go
// panicSliceB is called when the bounds check fails for s[i:j]
func panicSliceB(x int, y int) {
    panicCheck2(errorString("slice bounds out of range [" + intstring(nil, int64(x)) + ":" + intstring(nil, int64(y)) + "]"))
}
```

---

## 7. Assembly Output Analysis

```go
package main

func getSlice(arr *[4]int) []int {
    return arr[1:3]
}
```

Compiled with `GOARCH=amd64`:
```asm
TEXT main.getSlice(SB), NOSPLIT|NOFRAME, $0-40
    MOVQ arr+0(FP), AX    ; AX = arr (pointer to [4]int)
    LEAQ 8(AX), CX        ; CX = &arr[1] (offset 8 = 1 * sizeof(int64))
    MOVQ CX, ~r1+8(FP)    ; result.Data = &arr[1]
    MOVQ $2, ~r1+16(FP)   ; result.Len = 2
    MOVQ $3, ~r1+24(FP)   ; result.Cap = 4-1 = 3
    RET
```

Notice:
- No `CALL` instruction — no runtime function call
- No `MALLOC` — no heap allocation
- Just pointer arithmetic (LEAQ = Load Effective Address) and three stores

With bounds checks (constant indices are checked at compile time and optimized out):
```bash
go tool compile -S -o /dev/null main.go | grep -A20 "main.getSlice"
```

---

## 8. Performance Internals

### Cost Model

| Operation | Cost |
|-----------|------|
| `arr[:]` | 3 stores (ptr, len, cap) — ~1 ns |
| `arr[i:j]` (constant indices) | 3 stores + 0 runtime checks (BCE) — ~1 ns |
| `arr[i:j]` (variable indices) | 3 stores + 2 comparisons + 2 branches — ~2-3 ns |
| `make([]T, n)` | `mallocgc` call — ~50-200 ns depending on size and GC state |

### L1 Cache Behavior

An array `[64]int64` is exactly 512 bytes = 8 cache lines (64 bytes each). Sequential access to `arr[:]` is cache-optimal: hardware prefetcher loads ahead.

```go
// Cache-friendly: sequential scan
func sumSlice(s []int64) int64 {
    var sum int64
    for _, v := range s { sum += v }
    return sum
}

// Cache-unfriendly: strided access
func sumEvery4(arr *[64]int64) int64 {
    var sum int64
    for i := 0; i < 64; i += 4 { sum += arr[i] }
    return sum
}
```

### SIMD Vectorization

The Go compiler (as of 1.21) can auto-vectorize simple loops over slices on amd64 using SSE2/AVX2 when the loop body is simple enough. Slices derived from arrays are indistinguishable from other slices at the assembly level — vectorization applies equally.

---

## 9. GC Interaction

### Write Barrier

When you store a slice header (containing a pointer) into a heap-allocated struct, the GC's **write barrier** is invoked:

```go
type S struct { data []int }
s := &S{}
arr := [4]int{1,2,3,4}
s.data = arr[:] // WRITE BARRIER invoked for the pointer in s.data
```

The write barrier informs the GC's tri-color marking that `arr`'s address is now reachable through `s`.

### Pinning via `runtime.Pinner` (Go 1.21+)

For CGo or unsafe interop, you can pin an array to prevent the GC from moving it:

```go
import "runtime"

var arr [16]byte
p := new(runtime.Pinner)
p.Pin(&arr[0])
defer p.Unpin()
// now arr's address is stable for C code
cFunc((*C.uchar)(unsafe.Pointer(&arr[0])), C.int(len(arr)))
```

---

## 10. `unsafe` Package Internals

### `unsafe.Slice` (Go 1.17+)

Creates a slice from a raw pointer and length without bounds checking:

```go
// Creates []int with Data=ptr, Len=n, Cap=n
s := unsafe.Slice((*int)(unsafe.Pointer(&arr[0])), len(arr))
```

### `unsafe.SliceData` (Go 1.20+)

Returns the backing pointer of a slice:
```go
ptr := unsafe.SliceData(s) // returns *T pointing to s[0]
```

These are used in performance-critical serialization/deserialization code to avoid copies.

---

## 11. `reflect` Package View

```go
import (
    "fmt"
    "reflect"
    "unsafe"
)

func inspectSlice(s []int) {
    h := (*reflect.SliceHeader)(unsafe.Pointer(&s))
    fmt.Printf("Data: %x\n", h.Data)
    fmt.Printf("Len:  %d\n", h.Len)
    fmt.Printf("Cap:  %d\n", h.Cap)
}

func main() {
    arr := [5]int{1, 2, 3, 4, 5}
    s := arr[1:3]
    inspectSlice(s)
    // Data: same address as &arr[1]
    // Len:  2
    // Cap:  4
}
```

Note: `reflect.SliceHeader` is deprecated in Go 1.20+ in favor of `unsafe.Slice` and `unsafe.SliceData`.

---

## 12. Compiler Directives and Pragmas

### `//go:noescape`

Prevents the compiler from assuming a function causes its argument to escape:

```go
//go:noescape
func noescape(p unsafe.Pointer) unsafe.Pointer
```

This is used in the runtime itself to keep arrays on the stack even when passed to functions.

### `//go:nosplit`

Prevents stack growth check insertion. Used for functions called from signal handlers or critical paths:

```go
//go:nosplit
func criticalRead(arr *[64]byte, i int) byte {
    return arr[i]
}
```

---

## 13. Memory Safety Guarantees

Go's memory model provides the following guarantees for slice operations:

1. **No buffer overflow:** The runtime always checks bounds (or BCE proves safety statically).
2. **No use-after-free:** The GC keeps the backing array alive as long as any slice references it.
3. **No double free:** GC manages all heap memory; stack memory is automatically reclaimed.
4. **No uninitialized memory reads:** Arrays are zero-initialized by the runtime (`runtime.memclrNoHeapPointers`).

The one exception: `unsafe` operations bypass all these guarantees.

---

## 14. Profiling and Tracing

### Heap Profiling

```bash
go test -bench=. -benchmem -memprofile=mem.out ./...
go tool pprof -alloc_objects mem.out
```

Look for unexpected `runtime.newarray` calls in hot paths — these indicate array escapes.

### Execution Tracing

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... your code ...
```

```bash
go tool trace trace.out
# Look for GC events — fewer = better stack allocation usage
```

---

## 15. Gotchas at the Professional Level

1. **Stack split during slice lifetime:** If a goroutine's stack is copied while a CGo call holds a pointer into it, corruption can occur. CGo prohibits holding Go pointers across calls for this reason.

2. **`//go:linkname` and slice internals:** Some packages use `//go:linkname` to access runtime slice functions directly. This is fragile across Go versions.

3. **`reflect.NewAt` with array-derived slice:** Creating a reflect.Value from a slice's Data pointer requires careful lifetime management.

4. **`sync/atomic` on slice elements:** `atomic.LoadInt64(&arr[i])` requires `arr[i]` to be 8-byte aligned, which is guaranteed for `[N]int64` but NOT for `[N]int32` on 32-bit platforms.

5. **`mmap`-backed arrays:** If you mmap a file and cast it to `*[N]byte`, the GC does NOT manage that memory. Slices derived from it must not outlive the mmap.

---

## 16. Summary: Under the Hood

Array-to-slice conversion compiles to **three pointer-sized assignments** (Data, Len, Cap) with **two runtime bounds checks** (or zero if BCE eliminates them). The resulting slice header is indistinguishable at the machine level from a heap-allocated slice — the difference is only in where Data points.

Key internal facts:
- Slice header = `{*T, int, int}` = 24 bytes on amd64
- `arr[i:j]` = `LEAQ i*sizeof(T)(arr), ADD SUB STORE STORE STORE`
- Bounds checks use unsigned comparison to handle negatives in one branch
- BCE in the SSA prove pass eliminates checks for constant/range-bounded indices
- Stack arrays are relocated correctly during goroutine stack growth
- Write barriers are inserted when slice headers are stored in heap objects
- No GC work occurs when a slice is created pointing to a stack array (stack pointers are scanned differently)
