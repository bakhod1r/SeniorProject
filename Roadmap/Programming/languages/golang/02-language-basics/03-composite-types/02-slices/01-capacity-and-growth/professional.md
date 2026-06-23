# Slice Capacity and Growth — Professional Deep Dive

> **Focus:** What happens under the hood when Go slices grow, reallocate, and manage memory.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [How It Works Internally](#2-how-it-works-internally)
3. [Runtime Deep Dive](#3-runtime-deep-dive)
4. [Compiler Perspective](#4-compiler-perspective)
5. [Memory Layout](#5-memory-layout)
6. [OS / Syscall Level](#6-os-syscall-level)
7. [Source Code Walkthrough](#7-source-code-walkthrough)
8. [Assembly Output Analysis](#8-assembly-output-analysis)
9. [Performance Internals](#9-performance-internals)
10. [Metrics & Analytics](#10-metrics-analytics)
11. [Edge Cases at the Lowest Level](#11-edge-cases-at-the-lowest-level)
12. [Test](#12-test)
13. [Tricky Questions](#13-tricky-questions)
14. [Summary](#14-summary)
15. [Further Reading](#15-further-reading)
16. [Diagrams & Visual Aids](#16-diagrams-visual-aids)

---

## 1. Introduction

A Go slice is a **three-word descriptor** over a backing array:

```go
// Internal runtime representation (src/runtime/slice.go)
type slice struct {
    array unsafe.Pointer  // pointer to first element
    len   int             // number of accessible elements
    cap   int             // total allocated elements
}
```

This descriptor lives on the stack (or in a register); the backing array lives on the heap. When you `append` past `cap`, Go must allocate a new, larger backing array — this is a **reallocation**. Understanding *when* and *how* that happens is the key to writing allocation-efficient Go programs.

The two built-in functions you interact with directly are `len()` and `cap()`. The growth happens implicitly through `append`. The performance difference between naive and expert Go code often comes down to whether you avoid unnecessary reallocations.

---

## 2. How It Works Internally

### The Slice Header

Every slice value carries three fields. You can observe this with `reflect.SliceHeader`:

```go
package main

import (
    "fmt"
    "reflect"
    "unsafe"
)

func main() {
    s := make([]int, 3, 8)
    hdr := (*reflect.SliceHeader)(unsafe.Pointer(&s))
    fmt.Printf("ptr=%x  len=%d  cap=%d\n", hdr.Data, hdr.Len, hdr.Cap)
    // ptr=c000016080  len=3  cap=8
}
```

### What `append` Does Step by Step

```go
s = append(s, 42)
```

The compiler rewrites this (roughly) to:

```go
if s.len < s.cap {
    // Fast path: no allocation needed
    s.array[s.len] = 42
    s.len++
} else {
    // Slow path: must grow
    s = runtime.growslice(elemType, s, s.len+1)
    s.array[s.len-1] = 42
}
```

The fast path is why single appends below capacity are extremely cheap — a single bounds check, a store, and an increment.

### Observing Growth in Practice

```go
package main

import "fmt"

func main() {
    s := make([]int, 0)
    prevCap := 0
    for i := 0; i < 20; i++ {
        s = append(s, i)
        if cap(s) != prevCap {
            fmt.Printf("len=%2d  cap=%2d\n", len(s), cap(s))
            prevCap = cap(s)
        }
    }
}
```

Output:
```
len= 1  cap= 1
len= 2  cap= 2
len= 3  cap= 4
len= 5  cap= 8
len= 9  cap=16
len=17  cap=32
```

---

## 3. Runtime Deep Dive

### `runtime.growslice` — The Core Growth Function

Located in `src/runtime/slice.go`. The capacity calculation as of **Go 1.18+**:

```go
newcap := oldcap
doublecap := newcap + newcap
if newLen > doublecap {
    newcap = newLen
} else {
    const threshold = 256
    if oldcap < threshold {
        newcap = doublecap
    } else {
        for 0 < newcap && newcap < newLen {
            // Transition from growing 2x for small slices
            // to growing 1.25x for large slices.
            newcap += (newcap + 3*threshold) / 4
        }
        if newcap <= 0 {
            newcap = newLen
        }
    }
}
```

**Key observations:**

| Condition | Behavior |
|-----------|----------|
| `newLen > doublecap` | Allocate exactly `newLen` (large batch append) |
| `oldcap < 256` | Double the capacity |
| `oldcap >= 256` | Grow by `(oldcap + 768) / 4` per step until sufficient |

### Why 256 as the Threshold?

Before Go 1.18, the threshold was `1024`. The change to `256` with a smoother growth curve reduces memory waste for medium-sized slices and provides a gentler transition between the "double" and "1.25x" regimes.

### Memory Size Class Rounding

After computing `newcap`, `growslice` rounds it up to the nearest allocator size class:

```go
capmem = roundupsize(uintptr(newcap) * et.size)
newcap = int(capmem / et.size)
```

This means the *actual* reported capacity after growth is often larger than the computed `newcap` — the allocator size classes are steps like 48, 64, 80, 96, 112, 128 bytes, etc.

```go
package main

import "fmt"

func main() {
    // Demonstrate size-class rounding
    s := make([]byte, 0, 33) // requests 33 bytes
    s = append(s, make([]byte, 33)...)
    fmt.Println(cap(s)) // likely 48, not 33 (rounded to size class)
}
```

---

## 4. Compiler Perspective

### How `append` is Lowered

The Go compiler (`cmd/compile`) handles `append` as a special form during parsing and type-checking, then lowers it during SSA generation:

1. **Inline the fast path** — if `len < cap`, no function call is emitted.
2. **Emit a call to `runtime.growslice`** for the slow path.
3. The call passes: element type pointer, old slice value, new minimum length.

Inspect the compiler output:

```bash
# View SSA output for the main function
GOSSAFUNC=main go build -gcflags="-S" main.go 2>&1 | grep growslice

# View full assembly
go build -gcflags="-S" . 2>&1
```

### Escape Analysis

The compiler performs escape analysis to decide whether the backing array lives on the heap or stack. You can inspect this:

```bash
go build -gcflags="-m=2" . 2>&1
```

Small slices with known, bounded sizes that don't escape may be stack-allocated, completely bypassing `mallocgc`.

```go
// This slice may be stack-allocated (does not escape)
func sum() int {
    s := [4]int{1, 2, 3, 4} // array, not slice
    total := 0
    for _, v := range s {
        total += v
    }
    return total
}
```

---

## 5. Memory Layout

### Slice Header on the Stack (64-bit system)

```
Stack frame:
┌──────────────────────┐
│ array ptr   8 bytes  │ ──→ heap backing array
│ len         8 bytes  │
│ cap         8 bytes  │
└──────────────────────┘
Total: 24 bytes
```

### Backing Array on the Heap

```
Heap (cap=8, len=4, element=int64):
┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│  e[0]  │  e[1]  │  e[2]  │  e[3]  │        │        │        │        │
│ 8 bytes│ 8 bytes│ 8 bytes│ 8 bytes│(unused)│(unused)│(unused)│(unused)│
└────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
                                     ↑ indices 4-7 exist but are not accessible via len
```

### Two Slices Sharing a Backing Array

```go
a := []int{1, 2, 3, 4, 5}
b := a[1:3]
```

```
a: ptr→[0]  len=5  cap=5
b: ptr→[1]  len=2  cap=4

Memory:
index:  [0] [1] [2] [3] [4]
value:  [ 1] [ 2] [ 3] [ 4] [ 5]
         ↑    ↑────────↑
         a    b (b shares a's memory)
```

Modifying `b[0]` modifies `a[1]` — they share the same underlying memory.

---

## 6. OS / Syscall Level

### The Allocation Chain

```
append → runtime.growslice
              ↓
         mallocgc(size, type, needszero)
              ↓
    ┌─────────────────────────────────┐
    │ size <= 32KB?                   │
    │   Yes → mcache (P-local, no GC lock) │
    │   No  → mheap  (global, lock)   │
    └─────────────────────────────────┘
              ↓
    mheap may call mmap (OS syscall)
    to obtain new spans from OS
```

### `mallocgc` Key Behaviors

- **Zero-initialization**: Go guarantees new allocations are zeroed. `mallocgc` calls `memclrNoHeapPointers` for non-pointer types.
- **Write barriers**: If the slice holds pointers (`[]string`, `[]*T`), write barriers are inserted to inform the GC of new pointer locations.
- **GC metadata**: The allocator records whether the allocated object contains pointers, which determines GC scan behavior.

### Why Pointer-Free Slices Are Cheaper

```go
// []int — no GC scanning of elements needed
s1 := make([]int, 1000000)

// []*MyStruct — GC must scan all 1M pointers
s2 := make([]*MyStruct, 1000000)
```

For `[]int`, the GC only needs to check the slice header (one pointer). For `[]*MyStruct`, it must trace all 1,000,000 pointers.

---

## 7. Source Code Walkthrough

Relevant files in the Go standard library source:

| File | Relevance |
|------|-----------|
| `src/runtime/slice.go` | `growslice`, `makeslice`, `slicecopy` |
| `src/runtime/malloc.go` | `mallocgc`, `roundupsize` |
| `src/runtime/sizeclasses.go` | Size class table (67 size classes) |
| `src/cmd/compile/internal/ssagen/ssa.go` | `append` SSA lowering |
| `src/reflect/value.go` | `Grow`, `Append` reflection helpers |

### `makeslice` — Used by `make([]T, len, cap)`

```go
func makeslice(et *_type, len, cap int) unsafe.Pointer {
    mem, overflow := math.MulUintptr(et.size, uintptr(cap))
    if overflow || mem > maxAlloc || len < 0 || len > cap {
        mem, overflow := math.MulUintptr(et.size, uintptr(len))
        if overflow || mem > maxAlloc || len < 0 {
            panicmakeslicelen()
        }
        panicmakeslicecap()
    }
    return mallocgc(mem, et, true)
}
```

Note that `makeslice` returns only the pointer — the `len` and `cap` fields are filled in by the compiler at the call site.

---

## 8. Assembly Output Analysis

Given this function:

```go
//go:noinline
func grow(s []int) []int {
    return append(s, 99)
}
```

Compile and inspect:

```bash
go build -gcflags="-S" -o /dev/null . 2>&1
```

Annotated assembly (x86-64):

```asm
"".grow STEXT
    ; Load slice fields
    MOVQ    "".s_ptr+8(SP), AX   ; AX = s.array
    MOVQ    "".s_len+16(SP), CX  ; CX = s.len
    MOVQ    "".s_cap+24(SP), DX  ; DX = s.cap

    ; Fast path check: len < cap?
    CMPQ    CX, DX
    JGE     slow_path            ; if len >= cap, jump to growslice

    ; Fast path: store element, increment len
    MOVQ    $99, 0(AX)(CX*8)     ; s.array[len] = 99
    INCQ    CX                   ; len++
    ; ... return new slice header
    RET

slow_path:
    ; Prepare args for runtime.growslice
    LEAQ    type.int(SB), AX     ; element type
    MOVQ    AX, (SP)
    ; ... push old slice, newLen
    CALL    runtime.growslice(SB)
    ; ... store 99 into new slice
    RET
```

The fast path is ~5 instructions. `growslice` is only called at capacity overflow.

---

## 9. Performance Internals

### Amortized O(1) Append

Because capacity doubles for small slices, the total copy work for `n` appends starting from capacity 1 is:

```
copies = 1 + 2 + 4 + 8 + ... + n/2 = n - 1
```

This is **O(n)** total work for **n** appends, meaning **O(1) amortized** per append. The geometric series ensures the amortized cost stays constant regardless of `n`.

### Cache Locality

The backing array is contiguous in memory. Iterating over a slice is maximally cache-friendly:

```
x86-64 cache line = 64 bytes
[]int64 elements per cache line = 8

For a []int64 of length 1000:
  - Sequential access: ~125 cache line reads
  - Random pointer traversal (linked list): ~1000 cache line reads
```

Slices win over linked lists for sequential access by ~8x on cache efficiency alone.

### The True Cost of a Reallocation

```
1. mallocgc()       — heap allocation (slow path through mcache or mheap)
2. memmove()        — O(n) copy of all existing elements
3. Write barriers   — if slice holds pointers, GC write barriers fire
4. GC pressure      — old backing array becomes garbage, triggers GC sooner
5. TLB pressure     — new memory may be on a new page, TLB miss
```

For a slice that grows from 0 to n elements without pre-allocation:
- Number of reallocations: ~log2(n) for n < 256
- Total bytes copied: ~2n bytes (geometric series)

---

## 10. Metrics & Analytics

### Counting Allocations at Runtime

```go
package main

import (
    "fmt"
    "runtime"
)

func countAllocs(f func()) uint64 {
    var before, after runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&before)
    f()
    runtime.ReadMemStats(&after)
    return after.Mallocs - before.Mallocs
}

func dynamicGrowth() {
    s := []int{}
    for i := 0; i < 1024; i++ {
        s = append(s, i)
    }
    _ = s
}

func preAllocated() {
    s := make([]int, 0, 1024)
    for i := 0; i < 1024; i++ {
        s = append(s, i)
    }
    _ = s
}

func main() {
    fmt.Printf("Dynamic allocs:       %d\n", countAllocs(dynamicGrowth))
    fmt.Printf("Pre-allocated allocs: %d\n", countAllocs(preAllocated))
}
```

Expected output:
```
Dynamic allocs:       11
Pre-allocated allocs:  1
```

The 11 allocations correspond to the ~log2(1024) = 10 doublings plus the initial allocation.

### Using `testing.B` for Allocation Benchmarks

```go
func BenchmarkDynamic(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s := []int{}
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
        _ = s
    }
}

func BenchmarkPreAlloc(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s := make([]int, 0, 1000)
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
        _ = s
    }
}
```

Run with: `go test -bench=. -benchmem`

---

## 11. Edge Cases at the Lowest Level

### 1. Zero-Length, Non-Nil Slice

```go
s := make([]int, 0, 0)
fmt.Println(s == nil)    // false
fmt.Println(len(s) == 0) // true
// s.ptr points to runtime.zerobase — a special zero-size sentinel
// No heap allocation occurs for zero-capacity slices
```

### 2. Append to Nil Slice

```go
var s []int               // ptr=nil, len=0, cap=0
s = append(s, 1, 2, 3)   // triggers growslice
fmt.Println(len(s), cap(s)) // 3, 4 (or size-class rounded)
```

### 3. Large Batch Append Bypasses Doubling

```go
a := make([]int, 0, 2)
b := make([]int, 100)
a = append(a, b...)
// newLen=100 > doublecap=4
// Formula: newcap = newLen = 100 (not 4)
fmt.Println(cap(a)) // 112 (rounded from 100 to size class)
```

### 4. Integer Overflow Protection

```go
// growslice checks for overflow via math.MulUintptr:
// if uintptr(newcap) * et.size overflows uintptr, panic
// This prevents silent memory corruption on 32-bit systems
```

### 5. Full Slice Expression Stops Clobbering

```go
a := make([]int, 5, 10)
b := a[2:4:4]  // len=2, cap=2 (max=4, low=2, so cap=4-2=2)
b = append(b, 99)
// b must reallocate because cap(b)=2 and we need len=3
// a is completely unaffected
fmt.Println(a) // [0 0 0 0 0] — unchanged
```

### 6. Slice of Structs vs Slice of Pointers

```go
type Big struct{ data [1024]byte }

// Grows by copying full struct values — expensive for large structs
s1 := []Big{}
s1 = append(s1, Big{})

// Grows by copying pointers — cheap regardless of struct size
s2 := []*Big{}
s2 = append(s2, &Big{})
```

---

## 12. Test

```go
package capacity_test

import (
    "testing"
)

// TestGrowthDoubling verifies that capacity at least doubles for small slices.
func TestGrowthDoubling(t *testing.T) {
    s := make([]int, 0, 1)
    prevCap := cap(s)
    for i := 0; i < 255; i++ {
        s = append(s, i)
        if cap(s) > prevCap {
            if cap(s) < prevCap*2 {
                t.Errorf("expected at least double at len=%d: prevCap=%d newCap=%d",
                    len(s), prevCap, cap(s))
            }
            prevCap = cap(s)
        }
    }
}

// TestMakeCapacity verifies make respects the requested capacity.
func TestMakeCapacity(t *testing.T) {
    s := make([]int, 0, 100)
    if cap(s) != 100 {
        t.Errorf("expected cap=100, got %d", cap(s))
    }
    if len(s) != 0 {
        t.Errorf("expected len=0, got %d", len(s))
    }
}

// TestFullSliceExpression verifies the max parameter prevents overwrite.
func TestFullSliceExpression(t *testing.T) {
    a := []int{1, 2, 3, 4, 5}
    original4 := a[4]
    b := a[1:3:3] // cap = 3-1 = 2
    b = append(b, 99)
    if a[3] == 99 {
        t.Error("append to b (with max=3) should not have modified a[3]")
    }
    if a[4] != original4 {
        t.Error("append to b should not have modified a[4]")
    }
}

// TestNilSliceAppend verifies nil slice can be appended to safely.
func TestNilSliceAppend(t *testing.T) {
    var s []int
    s = append(s, 1, 2, 3)
    if len(s) != 3 {
        t.Errorf("expected len=3, got %d", len(s))
    }
    if s[0] != 1 || s[1] != 2 || s[2] != 3 {
        t.Errorf("unexpected values: %v", s)
    }
}

// TestSharedBackingArray verifies that subslices share the backing array.
func TestSharedBackingArray(t *testing.T) {
    a := []int{1, 2, 3, 4, 5}
    b := a[1:3] // shares backing array
    b[0] = 99
    if a[1] != 99 {
        t.Errorf("expected a[1]=99 after b[0]=99, got %d", a[1])
    }
}

// BenchmarkDynamic measures dynamic growth performance.
func BenchmarkDynamic(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s := []int{}
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
        _ = s
    }
}

// BenchmarkPreAllocated measures pre-allocated slice performance.
func BenchmarkPreAllocated(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        s := make([]int, 0, 1000)
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
        _ = s
    }
}
```

---

## 13. Tricky Questions

**Q1: After `b := a[1:3]`, what is `cap(b)`?**

```go
a := make([]int, 5, 10)
b := a[1:3]
fmt.Println(cap(b)) // Answer: 9
```

`cap(b) = cap(a) - low = 10 - 1 = 9`. Capacity extends to the end of the backing array.

**Q2: Does `copy` affect capacity?**

```go
src := []int{1, 2, 3, 4, 5}
dst := make([]int, 3)
n := copy(dst, src)
fmt.Println(n, cap(dst)) // 3, 3 — copy never changes len or cap
```

`copy` only fills existing elements. It never allocates.

**Q3: Can capacity ever shrink automatically?**

No. Capacity never shrinks on its own. To reclaim memory, create a new slice:

```go
// Method 1: copy to exact size
trimmed := make([]int, len(s))
copy(trimmed, s)

// Method 2: full slice expression trick
trimmed := append([]int(nil), s[:n]...)
```

**Q4: Why must `append` return a value?**

The slice header `{ptr, len, cap}` is a value type. If `append` reallocates, the new header has a different `ptr`. The caller's copy of the header must be updated. This is why you must always write `s = append(s, x)`.

**Q5: What is the capacity after `make([]int, 5)`?**

```go
s := make([]int, 5)
fmt.Println(cap(s)) // 5 — when cap is omitted, cap == len
```

---

## 14. Summary

| Concept | Key Point |
|---------|-----------|
| Slice header | `{ptr, len, cap}` — 24 bytes on 64-bit systems |
| `len` vs `cap` | `len` = accessible elements; `cap` = total allocated |
| Growth below 256 | New capacity = old capacity * 2 |
| Growth at/above 256 | `newcap += (newcap + 768) / 4` per iteration |
| Batch append | If `newLen > 2*oldCap`, allocate exactly `newLen` |
| Size-class rounding | Actual cap rounded up to allocator size class |
| `make([]T, l, c)` | Pre-allocates backing array; avoids reallocation |
| Full slice expression | `s[l:h:m]` limits cap; prevents clobbering shared data |
| Memory leak risk | Subslice keeps entire large backing array alive |
| Amortized cost | O(1) per append due to geometric growth strategy |
| `nil` slice | `ptr=nil, len=0, cap=0`; safe to append to |

---

## 15. Further Reading

- [Go runtime/slice.go source](https://github.com/golang/go/blob/master/src/runtime/slice.go)
- [Go specification: Appending to and copying slices](https://go.dev/ref/spec#Appending_and_copying_slices)
- [The Go Blog: Arrays, slices (and strings): The mechanics of append](https://go.dev/blog/slices-intro)
- [The Go Blog: Go Slices: usage and internals](https://go.dev/blog/slices)
- [Go 1.18 Release Notes — slice growth formula change](https://tip.golang.org/doc/go1.18)
- [Russ Cox — Go Data Structures](https://research.swtch.com/godata)
- [Go Wiki: Slice Tricks](https://github.com/golang/go/wiki/SliceTricks)
- [Dmitry Vyukov — Go Memory Model](https://go.dev/ref/mem)

---

## 16. Diagrams & Visual Aids

### Growth Curve (capacity vs number of appends)

```
Cap
^
512 |                                              *
256 |                              *
128 |                  *
 64 |          *
 32 |    *
 16 |  *
  8 | *
  4 |*
  2 |*
  1 |*
  0 +-----------------------------------------------→ Appends
    0  1  2  3  4  5  6  7  8  9  10  ...
    |← small (doubles every step) →|← large (1.25x) →|
                                   256
```

### Before and After Reallocation

```
BEFORE (cap=4, len=4):
Header on stack: [ ptr0 | len=4 | cap=4 ]
                    ↓
Heap:           [ A | B | C | D ]

AFTER append(s, E) (cap=8, len=5):
Header on stack: [ ptr1 | len=5 | cap=8 ]   ← ptr changed!
                    ↓
Heap (new):     [ A | B | C | D | E |   |   |   ]
Heap (old):     [ A | B | C | D ]  ← garbage collected
```

### Full Slice Expression `a[low:high:max]`

```
a := make([]int, 8)
//   [0][1][2][3][4][5][6][7]
//         ↑           ↑   ↑
//         low=2     high=5 max=6

b := a[2:5:6]
// b.ptr = &a[2]
// b.len = high - low = 5 - 2 = 3
// b.cap = max  - low = 6 - 2 = 4

// append(b, x) can write to a[5] but NOT a[6], a[7]
// append(b, x, y) forces reallocation — a[6], a[7] are safe
```

### Memory Leak Pattern

```
LARGE backing array (1,000,000 elements):
[  0  ][  1  ][ ... ][ 999999 ]
  ↑
subslice s = original[0:2]
// s.ptr points here
// s.len = 2, s.cap = 1,000,000
// GC CANNOT collect the 1M-element array
// because s still holds a reference to it

FIX: s = append([]int(nil), s[:2]...)
// new backing array with only 2 elements
// original 1M-element array becomes garbage-collectible
```
