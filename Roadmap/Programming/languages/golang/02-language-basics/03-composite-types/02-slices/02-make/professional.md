# make() for Slices — Professional Level

## 1. Assembly: What `make([]int, 3, 5)` Compiles To

Compile with: `go tool compile -S main.go | grep -A 20 'makeslice'`

```
// Go source
s := make([]int, 3, 5)

// Generated assembly (AMD64, Go 1.21)
LEAQ    type:int(SB), AX          ; load int type descriptor
MOVL    $3, BX                     ; len = 3
MOVL    $5, CX                     ; cap = 5
CALL    runtime.makeslice(SB)      ; returns ptr in AX
MOVQ    AX, s+0(SP)                ; store ptr
MOVQ    $3, s+8(SP)                ; store len
MOVQ    $5, s+16(SP)               ; store cap
```

The compiler converts `make` into a direct call to `runtime.makeslice` with the element type, len, and cap as arguments.

---

## 2. `runtime.makeslice` Source (simplified)

```go
// From go/src/runtime/slice.go
func makeslice(et *_type, len, cap int) unsafe.Pointer {
    mem, overflow := math.MulUintptr(et.size, uintptr(cap))
    if overflow || mem > maxAlloc || len < 0 || len > cap {
        // Compute detailed panic message
        mem, overflow := math.MulUintptr(et.size, uintptr(len))
        if overflow || mem > maxAlloc || len < 0 {
            panicmakeslicelen()
        }
        panicmakeslicecap()
    }
    return mallocgc(mem, et, true) // true = zero memory
}
```

Key insight: the function computes `cap * element_size`, checks for overflow, then delegates to `mallocgc`.

---

## 3. `mallocgc` and Zero Initialization

```go
// From go/src/runtime/malloc.go (simplified)
func mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer {
    // Fast path: tiny allocations (< 16 bytes, no pointers)
    if size <= maxTinySize {
        // tiny allocator path
    }

    // Small allocations: use per-P mcache
    if size <= maxSmallSize {
        sizeclass := size_to_class[size]
        span := c.alloc[sizeclass]
        x := nextFreeFast(span)
        if needzero {
            memclrNoHeapPointers(x, size) // zero memory
        }
        return x
    }

    // Large allocations: directly from mheap
    s := mheap_.alloc(npages, ...)
    if needzero {
        memclrNoHeapPointers(s.base(), size)
    }
    return s.base()
}
```

---

## 4. The `_type` Descriptor

Every Go type has a runtime descriptor. For `[]int`, the element type `int` descriptor contains:

```go
// From go/src/reflect/type.go
type rtype struct {
    size       uintptr    // 8 for int64
    ptrdata    uintptr    // 0 for int (no pointers)
    hash       uint32
    tflag      tflag
    align      uint8
    fieldAlign uint8
    kind_      uint8
    equal      func(unsafe.Pointer, unsafe.Pointer) bool
    gcdata     *byte      // GC bitmap (nil for int)
    str        nameOff
    ptrToThis  typeOff
}
```

The `ptrdata` field tells the GC whether to scan this memory for pointers. For `[]int`, `ptrdata=0` means the GC skips it — making `make([]int, n)` cheaper to GC than `make([]*int, n)`.

---

## 5. Compiler Optimization: Inline `make`

For small, fixed-size slices that don't escape, the compiler may eliminate the `runtime.makeslice` call entirely and allocate on the stack:

```go
// go build -gcflags='-m -l' shows:
//   "make([]int, 4) does not escape"
func stackAllocated() {
    s := make([]int, 4) // → stack array [4]int
    s[0] = 1
    _ = s
}

// This CANNOT be stack-allocated (size is not compile-time constant):
func heapAllocated(n int) {
    s := make([]int, n) // → runtime.makeslice
    s[0] = 1
    _ = s
}
```

---

## 6. `makeslice64` for Large Slices

On 32-bit platforms, Go uses `makeslice64` for large slices:

```go
// If len or cap > maxInt32, uses 64-bit arithmetic
func makeslice64(et *_type, len64, cap64 int64) unsafe.Pointer {
    len := int(len64)
    if int64(len) != len64 {
        panicmakeslicelen()
    }
    cap := int(cap64)
    if int64(cap) != cap64 {
        panicmakeslicecap()
    }
    return makeslice(et, len, cap)
}
```

---

## 7. Memory Allocator Classes (mcache/mcentral/mheap)

When `make` allocates, it goes through Go's tiered allocator:

```
Size     → Allocator Path
──────────────────────────────────────────
0 bytes  → zerobase (shared zero pointer)
1-16     → tiny allocator (per-P, no pointers allowed)
17-32768 → small allocator (size classes, per-P mcache)
>32768   → large allocator (directly from mheap)

make([]byte, 32)    → small, sizeclass 4 (32-byte object)
make([]byte, 4096)  → small, sizeclass 39 (4096-byte span)
make([]byte, 65536) → large, directly from mheap
```

---

## 8. GC Write Barrier and `make`

```go
// For pointer-containing types, GC write barrier is inserted:
// s[i] = ptr compiles to:
//   gcWriteBarrier(&s[i], ptr)

// For non-pointer types, no write barrier:
// s[i] = 42 compiles to:
//   MOVQ $42, s+i*8(SP)

// This means []int is faster than []*int in GC-heavy programs:
func pointerSlice(n int) []*int {
    s := make([]*int, n)      // GC must scan each element
    for i := range s {
        x := i
        s[i] = &x             // write barrier invoked
    }
    return s
}

func intSlice(n int) []int {
    s := make([]int, n)       // GC skips (no pointers)
    for i := range s {
        s[i] = i              // no write barrier
    }
    return s
}
```

---

## 9. `reflect.MakeSlice` Internals

```go
// From reflect/value.go
func MakeSlice(typ Type, len, cap int) Value {
    if typ.Kind() != Slice {
        panic("reflect.MakeSlice of non-slice type")
    }
    if len < 0 {
        panic("reflect.MakeSlice: negative len")
    }
    if cap < 0 {
        panic("reflect.MakeSlice: negative cap")
    }
    if len > cap {
        panic("reflect.MakeSlice: len > cap")
    }

    s := SliceHeader{
        Data: unsafe.Pointer(&make([]byte, cap*int(typ.Elem().Size()))[0]),
        Len:  len,
        Cap:  cap,
    }
    return Value{typ.common(), unsafe.Pointer(&s), flagIndir | flag(Slice)}
}
```

---

## 10. Compiler IR: SSA for `make`

Viewing the compiler's intermediate representation:

```bash
GOSSAFUNC=main go build main.go
# Opens HTML with SSA phases
```

In SSA, `make([]int, n)` becomes:
```
v1 = StaticCall {runtime.makeslice} [...]
v2 = SelectN [0] v1   ; ptr
v3 = SelectN [1] v1   ; len
v4 = SelectN [2] v1   ; cap
```

After optimization passes, small fixed-size makes may be converted to `SliceAlloc` operations that the backend handles with stack allocation.

---

## 11. `unsafe.SliceData`, `unsafe.Slice` (Go 1.17+)

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := make([]int, 5)
    s[0] = 42

    // Get pointer to backing array
    ptr := unsafe.SliceData(s) // *int, points to s[0]

    // Reconstruct slice from pointer (dangerous!)
    s2 := unsafe.Slice(ptr, 3) // []int of length 3
    fmt.Println(s2) // [42 0 0]

    // This is how CGo interop works internally
    _ = ptr
}
```

---

## 12. `make` and Stack Growth

```go
package main

import (
    "fmt"
    "runtime"
)

func deepStack(depth int, s []int) {
    if depth == 0 {
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        fmt.Printf("Stack: %d bytes used\n", m.StackInuse)
        return
    }
    // make on stack in deep recursion causes stack growth
    local := make([]int, 8)
    local[0] = depth
    deepStack(depth-1, local)
}

func main() {
    deepStack(100, nil)
}
```

Go goroutine stacks start at 8KB and grow dynamically (via `runtime.morestack`). Large `make` calls in deep recursion contribute to stack pressure.

---

## 13. Memory Barrier Semantics Around `make`

```go
package main

import (
    "sync/atomic"
    "unsafe"
)

// Publishing a newly-made slice safely across goroutines
type SharedSlice struct {
    ptr unsafe.Pointer // atomic pointer to []int
}

func (ss *SharedSlice) Store(s []int) {
    atomic.StorePointer(&ss.ptr, unsafe.Pointer(&s))
}

func (ss *SharedSlice) Load() []int {
    p := atomic.LoadPointer(&ss.ptr)
    if p == nil {
        return nil
    }
    return *(*[]int)(p)
}

// make guarantees all writes are visible before return
// This pairs well with atomic publication
```

---

## 14. Profiling `make` Allocations with `pprof`

```go
package main

import (
    "net/http"
    _ "net/http/pprof"
    "os"
    "runtime/pprof"
)

func heavyMakeWorkload() {
    for i := 0; i < 100000; i++ {
        s := make([]int, 1000)
        _ = s
    }
}

func main() {
    // CPU profile
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)
    heavyMakeWorkload()
    pprof.StopCPUProfile()
    f.Close()

    // Heap profile
    f2, _ := os.Create("heap.prof")
    pprof.WriteHeapProfile(f2)
    f2.Close()

    // go tool pprof -http :8080 cpu.prof
    // go tool pprof -http :8080 heap.prof
    _ = http.DefaultMux
}
```

---

## 15. `GOGC` and `make` Allocation Pressure

```go
// GOGC controls when GC runs:
// GOGC=100 (default): GC when heap doubles
// GOGC=200: GC when heap triples (less frequent, more memory)
// GOGC=off: disable GC (dangerous)

// For make-heavy workloads:
// GOGC=200 GOMEMLIMIT=500MiB go run main.go

// GOMEMLIMIT (Go 1.19+) prevents OOM even with high GOGC:
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    // Set memory limit programmatically
    debug.SetMemoryLimit(500 * 1024 * 1024) // 500MB

    // Now make can allocate freely until 500MB limit
    for i := 0; i < 1000; i++ {
        s := make([]int, 100000)
        _ = s
    }

    fmt.Println("Done")
}
```

---

## 16. Internal: `appendslice` and `growslice`

When `append` exceeds capacity, it calls `runtime.growslice`:

```go
// From go/src/runtime/slice.go
func growslice(et *_type, old slice, cap int) slice {
    // cap is the minimum capacity needed
    newcap := old.cap
    doublecap := newcap + newcap

    if cap > doublecap {
        newcap = cap
    } else {
        const threshold = 256
        if old.cap < threshold {
            newcap = doublecap
        } else {
            for 0 < newcap && newcap < cap {
                newcap += (newcap + 3*threshold) / 4
            }
            if newcap <= 0 {
                newcap = cap
            }
        }
    }

    // ... compute new byte size, call mallocgc, copy old data ...
    p := mallocgc(capmem, et, true)
    memmove(p, old.array, lenmem)
    return slice{p, old.len, newcap}
}
```
