# Slice to Array Conversion — Professional Level

## 1. Assembly: Pointer Conversion `(*[N]T)(s)`

```
// Source: arr := (*[3]int)(s)
// AMD64 assembly (Go 1.21)

// Load slice header fields
MOVQ s_ptr+0(SP), AX      ; AX = s.data (pointer)
MOVQ s_len+8(SP), CX      ; CX = s.len

// Bounds check: CMP len with N (compile-time constant 3)
CMPQ CX, $3
JLT  runtime.panicSliceConvert  ; jump if len < 3

// Result: arr = AX (same pointer, type changed)
MOVQ AX, arr+0(SP)
// No memory allocation, no copy!
```

---

## 2. Assembly: Value Conversion `[N]T(s)`

```
// Source: arr := [3]int(s)
// AMD64 assembly (small N — inline copy)

MOVQ s_ptr+0(SP), AX      ; AX = s.data
MOVQ s_len+8(SP), CX      ; CX = s.len

// Bounds check
CMPQ CX, $3
JLT  runtime.panicSliceConvert

// Stack-allocate [3]int
SUBQ $24, SP               ; allocate 3*8 = 24 bytes on stack

// Inline copy (3 × 8 bytes = MOVQ × 3)
MOVQ 0(AX), DX
MOVQ DX, 0(SP)
MOVQ 8(AX), DX
MOVQ DX, 8(SP)
MOVQ 16(AX), DX
MOVQ DX, 16(SP)

// arr is now at SP — no call to memmove for small arrays!
```

For larger arrays (N > ~8 elements), the compiler emits a call to `runtime.memmove`.

---

## 3. Compiler Spec: Type Conversion Rules

From the Go specification (1.20+):

> Converting a value of a slice type to a type of array pointer type
> yields a pointer to the underlying array of the slice.
> If the length of the slice is less than the length of the array,
> a run-time panic occurs.

The key type rules:
- `(*[N]T)` is constructible from `[]T` if `N` is a non-negative integer constant
- `[N]T` is constructible from `[]T` (Go 1.20+) using the same bounds check
- The element type `T` must be identical in both

---

## 4. `runtime.panicSliceConvert` Source

```go
// From go/src/runtime/panic.go
func panicSliceConvert(x int, y int) {
    panicCheck1(getcallerpc(), "slice bounds out of range")
    panic(boundsError{x: int64(x), signed: true, y: y, code: boundsSlice3Acap})
}
```

The panic message format (Go 1.21):
```
runtime error: slice bounds out of range [::N] with length L
```

Where N is the array size and L is the slice length.

---

## 5. `_type` Descriptor Comparison

For `(*[N]T)(s)`:
- The result type is `*[N]T` — a pointer type
- GC sees it as a pointer — it keeps the backing array alive
- `_type.ptrdata = sizeof(*[N]T)` = pointer size (8 bytes on 64-bit)

For `[N]T(s)`:
- The result type is `[N]T` — a value type
- If T contains pointers, each element is a GC root
- `_type.ptrdata` = N * sizeof(T) if T has pointers, else 0

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    // Pointer: 8 bytes (one pointer)
    s := []int{1, 2, 3}
    ptr := (*[3]int)(s)
    fmt.Println(unsafe.Sizeof(ptr)) // 8

    // Array: 24 bytes (3 × 8)
    arr := [3]int(s)
    fmt.Println(unsafe.Sizeof(arr)) // 24
}
```

---

## 6. Compiler Pass: `typecheck` Phase

During type checking, the compiler validates:

1. Source type is `[]T` (slice)
2. Target type is `*[N]T` or `[N]T`
3. Element types match exactly
4. N is a non-negative constant

```
// From go/src/cmd/compile/internal/typecheck/typecheck.go
case ir.OCONV:
    n := n.(*ir.ConvExpr)
    if n.Type().IsPtr() && n.Type().Elem().IsArray() {
        if !n.X.Type().IsSlice() {
            base.Errorf("...")
        }
        if n.Type().Elem().Elem() != n.X.Type().Elem() {
            base.Errorf("...")
        }
        // Emit runtime bounds check via OSLICE3ARR
    }
```

---

## 7. SSA Representation

In the SSA (Static Single Assignment) phase:

```
// (*[3]int)(s) becomes:
v1 = LocalAddr s
v2 = Load v1           ; load slice header
v3 = SlicePtr v2       ; extract data pointer
v4 = SliceLen v2       ; extract length
v5 = IsInBounds v4, 3  ; bounds check
If v5 → ok, panicBlock
v6 = PtrIndex v3, 0    ; *[3]int = same ptr as data

// [3]int(s) becomes:
v1 = LocalAddr s
v2 = Load v1
v3 = SlicePtr v2
v4 = SliceLen v2
v5 = IsInBounds v4, 3
If v5 → ok, panicBlock
v6 = Move {[3]int} dst, v3   ; memmove(dst, src, 24)
```

---

## 8. Bounds Check Elimination (BCE) Deep Dive

```go
package main

func sum4(s []int64) int64 {
    // Without BCE optimization: 4 bounds checks
    return s[0] + s[1] + s[2] + s[3]
}

func sum4BCE(s []int64) int64 {
    // With conversion: ONE bounds check (the conversion itself)
    arr := (*[4]int64)(s) // one bounds check: len >= 4
    return arr[0] + arr[1] + arr[2] + arr[3] // ZERO extra bounds checks!
}

// Compiler analysis for sum4BCE:
// After "arr := (*[4]int64)(s)":
//   - arr is *[4]int64, which the compiler knows has exactly 4 elements
//   - arr[0], arr[1], arr[2], arr[3] are all statically proven in-bounds
//   - BCE eliminates all 4 subsequent checks
```

```bash
# Verify with: go build -gcflags='-d=ssa/check_bce/debug=1'
# sum4:    "Found IsInBounds" × 4
# sum4BCE: "Found IsInBounds" × 1 (only the conversion check)
```

---

## 9. Memory Layout: Stack vs Heap for Array Result

```go
// Case 1: Array stays on stack (doesn't escape)
func f1(s []int) int {
    arr := [4]int(s[:4]) // arr on stack
    return arr[0] + arr[3]
}

// Case 2: Array escapes to heap (returned by pointer)
func f2(s []int) *[4]int {
    arr := [4]int(s[:4]) // arr must be on heap
    return &arr
}

// Case 3: Array returned by value (copy to caller's stack)
func f3(s []int) [4]int {
    return [4]int(s[:4]) // copy into caller's stack frame
}

// Escape analysis output:
// f1: "arr does not escape"
// f2: "arr escapes to heap"
// f3: "arr does not escape" (returned by value = copy)
```

---

## 10. GC Interaction: Pointer Lifetime

```go
package main

import (
    "fmt"
    "runtime"
)

type largeData [1024 * 1024]byte // 1MB

func main() {
    data := make([]byte, len(largeData{}))

    // Pointer conversion: data's backing array kept alive by ptr
    ptr := (*[8]byte)(data[:8])
    data = nil          // header gone, but backing array LIVES (ptr holds it)
    runtime.GC()

    fmt.Println(ptr[0]) // safe: backing array not collected!

    // Value conversion: data's backing array can be collected
    arr := [8]byte(data[:0]) // but data is nil now...
    _ = arr
}
```

The GC's reachability analysis: any live `*[N]T` pointer keeps the full backing array alive. This is the memory leak pattern from the postmortem.

---

## 11. `reflect.ArrayOf` and Dynamic Conversion

```go
package main

import (
    "fmt"
    "reflect"
    "unsafe"
)

// dynamicArrayFromSlice creates a reflect.Value of [N]T from []T
// N must be <= len(s)
func dynamicArrayFromSlice(s interface{}, n int) interface{} {
    sv := reflect.ValueOf(s)
    if sv.Kind() != reflect.Slice {
        panic("not a slice")
    }
    if sv.Len() < n {
        panic("slice too short")
    }

    elemType := sv.Type().Elem()
    arrType := reflect.ArrayOf(n, elemType)
    arrPtr := reflect.NewAt(arrType, unsafe.Pointer(sv.Pointer()))
    return arrPtr.Elem().Interface()
}

func main() {
    s := []int{10, 20, 30, 40, 50}
    arr := dynamicArrayFromSlice(s, 3).([3]int)
    fmt.Println(arr) // [10 20 30]
}
```

---

## 12. `unsafe.Slice` and `unsafe.SliceData` (Inverse Operations)

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    // Array → Slice (the inverse)
    arr := [5]int{1, 2, 3, 4, 5}
    s := unsafe.Slice(&arr[0], len(arr))
    fmt.Println(s) // [1 2 3 4 5]

    // Slice → Array pointer (the operation we've been studying)
    arr2 := (*[5]int)(s)
    fmt.Println(*arr2) // [1 2 3 4 5]

    // SliceData: get raw data pointer
    ptr := unsafe.SliceData(s)
    fmt.Printf("type: %T, val: %d\n", ptr, *ptr) // *int, 1
}
```

---

## 13. Protocol Buffer Pattern

```go
package main

import (
    "encoding/binary"
    "fmt"
)

// Protobuf varint followed by fixed64 field
type WireType byte

const (
    WireVarint  WireType = 0
    WireFixed64 WireType = 1
    WireFixed32 WireType = 5
)

func parseFixed64(buf []byte) (uint64, int) {
    _ = buf[7] // BCE hint
    arr := (*[8]byte)(buf[:8]) // zero-copy
    return binary.LittleEndian.Uint64(arr[:]), 8
}

func parseFixed32(buf []byte) (uint32, int) {
    _ = buf[3] // BCE hint
    arr := (*[4]byte)(buf[:4]) // zero-copy
    return binary.LittleEndian.Uint32(arr[:]), 4
}

func main() {
    data := []byte{0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}
    v, n := parseFixed64(data)
    fmt.Printf("Fixed64: %d (%d bytes)\n", v, n) // Fixed64: 1 (8 bytes)
}
```

---

## 14. Compiler Intrinsics and Auto-Vectorization

The compiler may auto-vectorize loops over fixed-size arrays:

```go
package main

import "fmt"

// This loop over [16]byte can be vectorized to a single XMM register op
func xor16(dst, src []byte) {
    _ = dst[15] // BCE
    _ = src[15] // BCE
    d := (*[16]byte)(dst[:16])
    s := (*[16]byte)(src[:16])
    for i := range d {
        d[i] ^= s[i]
    }
    // Compiled to: VPXOR xmm0, xmm1, [src]; VMOVDQU [dst], xmm0
    // (on AVX-capable CPUs with -gcflags='-gcflags=-spectre=off')
}

func main() {
    dst := make([]byte, 16)
    src := make([]byte, 16)
    for i := range src { src[i] = byte(i) }
    xor16(dst, src)
    fmt.Println(dst[:4]) // [0 1 2 3]
}
```

---

## 15. Runtime Panic Message Format

Exact format of the panic message for slice-to-array conversion failure:

```go
// runtime/error.go
type boundsError struct {
    x    int64
    y    int
    signed bool
    code  boundsErrorCode
}

func (e boundsError) RuntimeError() {}

func (e boundsError) Error() string {
    // For slice conversion: "runtime error: slice bounds out of range [:N] with length L"
}
```

The values:
- `x` = the length of the slice (e.g., 2)
- `y` = the required length (N, e.g., 5)
- Result: `"runtime error: slice bounds out of range [::5] with length 2"`

---

## 16. Full Compilation Pipeline View

```
Source: arr := [3]int(s)

1. Parser → AST: OCONV node {Type: [3]int, X: s}

2. Typecheck:
   - Verify s.Type() == []int
   - Verify [3]int elem matches
   - Tag node as OSLICE3ARR (internal op)

3. SSA Gen:
   - Emit IsInBounds(s.len, 3) check
   - Emit panicBlock if false
   - Emit Move {size=24} from s.ptr to new temp

4. Regalloc:
   - Assign registers for ptr, len
   - Schedule bounds check early (before memory access)

5. Lowering (AMD64):
   - MOVQ, CMPQ, JLT for bounds check
   - MOVQ×3 or CALL memmove for copy

6. Linker:
   - Embed runtime.panicSliceConvert address
```
