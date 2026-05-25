# Slice Header Internals — Senior

## 1. The runtime's view

The Go runtime represents every slice with this struct, defined verbatim in `src/runtime/slice.go`:

```go
type slice struct {
    array unsafe.Pointer
    len   int
    cap   int
}
```

That is the entire data model. Every operation the compiler emits — slicing, indexing, copying, ranging, conversion — is, at the runtime level, manipulation of this three-word value. No method table, no header bits, no descriptor pointer. Just an `unsafe.Pointer` plus two `int`s.

Compare with the user-facing `reflect.SliceHeader` (deprecated in Go 1.20, see [specification.md](specification.md)):

```go
type SliceHeader struct {
    Data uintptr  // not unsafe.Pointer!
    Len  int
    Cap  int
}
```

The use of `uintptr` instead of `unsafe.Pointer` is exactly why `reflect.SliceHeader` is unsafe and was deprecated — a `uintptr` is not a GC root, so the compiler may decide the array is unreachable while you still hold a `uintptr` to it.

---

## 2. The lifecycle of a slice through the compiler

Consider:

```go
s := make([]int, 3, 5)
s[0] = 42
s = append(s, 99)
```

The compiler emits roughly:

```
// s := make([]int, 3, 5)
CALL    runtime.makeslice(_type, 3, 5)    -> array pointer
// then build header {array, 3, 5} on the stack at s

// s[0] = 42
MOVQ    s+0(SP), AX        // load Data
MOVQ    $42, 0(AX)         // store 42 at Data[0]

// s = append(s, 99)
// if cap > len: store at Data[len], bump len
// else: CALL runtime.growslice; build new header
```

The runtime entry points are:

- `runtime.makeslice(elemType, len, cap) unsafe.Pointer` — allocate backing array, return pointer.
- `runtime.makeslicecopy(elemType, len, cap, fromPtr) unsafe.Pointer` — allocate and pre-fill (used when `make` is followed by a known initializer).
- `runtime.growslice(oldArray, newLen, oldCap, num, elemType) slice` — the heart of `append` overflow.
- `runtime.memmove(dst, src, size)` — used by `copy`.

`make` panics if `cap < 0`, `cap < len`, `len < 0`, or the resulting size would overflow. The check is in `runtime.makeslice` via `math.MulUintptr`.

---

## 3. `growslice` in detail

`growslice` (in `src/runtime/slice.go`) is the routine `append` calls when capacity is exhausted. Its job:

1. Decide the new capacity.
2. Allocate a new backing array of that capacity.
3. `memmove` the old elements into it.
4. Return a new `slice` header pointing at the new array.

The capacity-decision formula was rewritten in Go 1.18. Pre-1.18 it was roughly "double until 1024, then grow by 25 %". The new formula is smoother:

```go
newcap := oldCap
doublecap := newcap + newcap
if cap > doublecap {
    newcap = cap
} else {
    const threshold = 256
    if oldCap < threshold {
        newcap = doublecap
    } else {
        // Transition from 2x growth to 1.25x growth.
        for 0 < newcap && newcap < cap {
            newcap += (newcap + 3*threshold) / 4
        }
        if newcap <= 0 {
            newcap = cap
        }
    }
}
```

The interesting tweak: the transition from 2x to 1.25x happens **smoothly** between caps of 256 and ~4096 instead of cliffing at 1024. This avoids the prior pathology where a slice growing to 1024 would jump to 2048 (waste) but a slice growing past 1024 by one would grow only to 1280 (often triggering a second realloc soon after).

After picking `newcap`, the runtime rounds up to the next allocation size class (the malloc-internal `mallocgc` size buckets), which is why `cap(s)` after append is often *larger* than what the formula above produces.

For the algorithmic dive: [`01-capacity-and-growth`](../01-capacity-and-growth/). This file is concerned with the *header* side: the result of `growslice` is the new three-word value the caller writes back into `s`.

---

## 4. Header as a function parameter

In Go's calling convention (register-based since 1.17), a slice argument occupies **three registers**. On amd64 with the register ABI:

```
func f(s []int) → s.array in RAX, s.len in RBX, s.cap in RCX
```

This means slice passing is cheaper than passing a struct of the same size by value (which the ABI might spill to the stack). It also means a function returning a slice returns three registers — no stack spill, no allocation.

The caller's slice variable lives wherever the compiler chose: stack, register, or heap (depending on escape analysis). The callee's parameter `s` is a fresh copy of those three words.

---

## 5. Escape analysis: where does the backing array live?

The header lives on the stack (or in registers) unless it escapes — but the **backing array** is a separate question.

The Go escape analyser tries to allocate the backing array on the **same stack frame** as the slice header when:

- The size is known at compile time and fits in the per-function stack budget (~10 KB typically; larger thresholds for `make([]T, fixedConst)`).
- The slice doesn't escape — i.e., no reference to any element or to the slice itself is reachable beyond the function's return.

Example: stack allocation.

```go
func f() int {
    s := make([]int, 4)
    s[0] = 10
    return s[0]
}
```

`s` doesn't escape; size is constant. The backing array is laid out directly in `f`'s frame as if you wrote `var arr [4]int`. The header is just a register triple. Zero heap allocation.

Example: heap allocation.

```go
func f() []int {
    s := make([]int, 4)
    s[0] = 10
    return s
}
```

`s` escapes (returned). The backing array must outlive the frame, so the runtime calls `mallocgc` and puts the array on the heap. The header is still returned in registers.

Confirm with `go build -gcflags="-m"`:

```
./main.go:2:6: can inline f
./main.go:3:11: make([]int, 4) does not escape    # stack
./main.go:8:11: make([]int, 4) escapes to heap    # heap
```

This is **the single highest-leverage optimisation** for slice-heavy code: keep the backing array on the stack by not letting the slice escape.

---

## 6. Slice elements and escape

A subtle point: taking `&s[i]` may force `s`'s backing array to the heap even if `s` itself doesn't visibly escape, because the address might leak.

```go
func f() {
    s := make([]int, 4)
    save(&s[0])      // escape — &s[0] leaks
}
```

Output of `-m`:
```
./main.go:3:11: make([]int, 4) escapes to heap
```

If `&s[0]` is passed to a function whose body the compiler can see (and which doesn't store it past return), inlining + escape analysis can still keep the array on the stack. But across package boundaries, this typically forces heap.

---

## 7. The header is a value; the array is referenced

The fundamental dual: header by value, array by reference. This drives the entire design.

**Header is value:**
- Pass-by-value semantics for slices.
- Reslicing produces a new header without touching the array.
- `len(s)` reads a register, costs zero.
- A function can't change the caller's `Len` without indirection.

**Array is referenced:**
- All slices into the same array share memory.
- Mutation propagates.
- `append` may produce a new array (relocating) — then your `s` and any aliasing slices point to *different* arrays.

This dual is the source of every advanced slice trick and every advanced slice bug.

---

## 8. `runtime.typedslicecopy` and the write barrier

When you `copy(dst, src)` for a slice of pointer-shaped elements, the runtime must inform the GC of the pointer writes — that's the *write barrier*. The runtime function:

```go
//go:linkname typedslicecopy reflect.typedslicecopy
func typedslicecopy(elemType *_type, dst, src slice) int
```

For pointer-free element types (`[]int`, `[]byte`, scalar structs), the compiler emits a plain `memmove`. For element types containing pointers, the compiler emits a call to `typedslicecopy` which does pointer-aware copying with barriers active.

Why this matters: copying a `[]byte` is essentially `memmove(dst, src, n)` and benefits from SIMD/REP MOVSB on modern CPUs. Copying a `[]*SomeStruct` is much slower because every word is pointer-bar-checked.

If you have a hot path copying `[]SomePointerStruct`, consider reshaping the data to have separate columns: a `[]int64` for one field, `[]string` for another. The copies become pointer-free and accelerate.

---

## 9. `slicebytetostring` and conversions

`string(b)` for `b []byte` builds a string header `{Data, Len}` (only two words, no Cap):

```go
type stringStruct struct {
    str unsafe.Pointer
    len int
}
```

The conversion `string([]byte)` allocates and copies. The runtime function is `runtime.slicebytetostring` (and the inverse `runtime.stringtoslicebyte`). The reason for the copy: strings are immutable, and the runtime cannot prove the `[]byte` won't be modified afterward.

Exceptions where the compiler skips the copy (since Go 1.10, expanded in later versions):

- `for _, c := range string(b) { ... }` — no string allocated; iteration goes byte-by-byte directly over `b`.
- Map lookup `m[string(b)]` — no string allocated; the runtime uses `mapaccess2_faststr` with the byte slice directly.
- String comparison `string(b) == "literal"` — the compiler may compare byte-by-byte without materialising the string.

These are all peephole optimisations; treat them as "nice if you get them, never assume you got one". Verify with `-gcflags="-m"`.

---

## 10. The actual bytes of a slice header

If you ever need to look at a slice header byte-by-byte (debugging, interop):

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := []int{10, 20, 30, 40}
    // unsafe.Sizeof(s) is 24 on a 64-bit machine
    hdr := (*[3]uintptr)(unsafe.Pointer(&s))
    fmt.Printf("Data: 0x%x\n", hdr[0])
    fmt.Printf("Len:  %d\n", hdr[1])
    fmt.Printf("Cap:  %d\n", hdr[2])
}
```

Output (on amd64):

```
Data: 0xc0000180a0
Len:  4
Cap:  4
```

The cast `(*[3]uintptr)(unsafe.Pointer(&s))` is a peek into the three words. This is precisely the kind of thing `reflect.SliceHeader` used to do, why it was tempting, and why it was a footgun (using `uintptr` instead of `unsafe.Pointer` for the Data field breaks GC reachability). The safe modern replacement is `unsafe.SliceData(s)` for the pointer and `len(s)`/`cap(s)` for the lengths.

---

## 11. The `unsafe.Slice` and `unsafe.SliceData` pair (Go 1.20)

Two new built-ins replaced `reflect.SliceHeader`:

```go
// Build a slice from a pointer + length.
func Slice[T any](ptr *T, len IntegerType) []T

// Get the data pointer of a slice (returns *T, not unsafe.Pointer).
func SliceData[T any](s []T) *T
```

Use:

```go
buf := C.malloc(1024)
defer C.free(buf)

s := unsafe.Slice((*byte)(buf), 1024) // []byte view of the C buffer
copy(s, []byte("hello"))
```

```go
s := []int{1, 2, 3}
p := unsafe.SliceData(s) // *int pointing at s[0]
```

The crucial difference vs `reflect.SliceHeader`: `unsafe.Slice`/`unsafe.SliceData` work with **typed pointers**, which the GC tracks correctly. The old `SliceHeader.Data uintptr` was outside GC awareness; building a slice from raw `uintptr` is a memory-safety bug because the GC may free your array under your feet.

If you have legacy code using `reflect.SliceHeader`, the migration is:

```go
// Before (deprecated):
hdr := (*reflect.SliceHeader)(unsafe.Pointer(&s))
hdr.Data = uintptr(ptr)
hdr.Len = n
hdr.Cap = n

// After:
s = unsafe.Slice((*T)(ptr), n)
```

Direct, safe, GC-correct.

---

## 12. The compiler's `OAPPEND` lowering

`append` is special-cased in the compiler (it's not a regular function). For:

```go
s = append(s, x)
```

the compiler emits (roughly):

```
if s.len < s.cap {
    s.array[s.len] = x
    s.len++
} else {
    s = runtime.growslice(s, 1, /*elemType*/)
    s.array[s.len-1] = x  // growslice sets new len to old len + num appended
}
```

For multi-element `append(s, a, b, c)` the runtime function call is the same; the inlined fast path stores all three if capacity suffices.

For `append(s, other...)`:

```go
s = append(s, other...)
```

becomes a single check; if `s.cap - s.len >= len(other)`, `memmove(s.array[s.len:], other.array, len(other))` and bump `s.len`; else `growslice` then `memmove`.

The split inline-fast-path / runtime-slow-path lets the common warm case stay branch-free except for the cap check.

---

## 13. Why the spec doesn't define the layout

The Go spec deliberately abstracts over the slice header. It defines:

- A slice is a descriptor of a contiguous segment of an underlying array.
- The slice has length and capacity.
- The slice's underlying array is shared with other slices that include its elements.

It does not say "three-word struct" or "the data pointer comes first". Why? Because:

1. Future implementations might extend the header (e.g., add an epoch field for `bytes.Buffer`-style safety checks).
2. Some hypothetical implementation might use a single fat pointer with the length encoded in pointer bits.
3. Conformance should not require a specific machine layout.

In practice, all three Go implementations (gc, gccgo, gollvm) use the three-word layout. But code that *depends on* the layout (via `reflect.SliceHeader` or unsafe pointer arithmetic) is depending on an implementation detail, not the language. The `unsafe.Slice`/`unsafe.SliceData` built-ins were added precisely to give such code a *defined* path that doesn't lock the language into a specific layout.

---

## 14. Header + array + size: a complete picture

A slice carries less information than people often think:

| Carried by header | Carried by allocator |
|-------------------|----------------------|
| `Data` pointer    | Allocation size class (the rounded-up size class `mallocgc` chose) |
| `Len`             | GC bitmap for the array (in `mheap`'s metadata) |
| `Cap`             | Span class (small/large) |

That is, **the slice header does not know** what allocator-class its array lives in. The runtime can recover that from the pointer (using `mheap_.spanOf(ptr)`), but the slice value itself is just three words.

Practical consequence: when the runtime grows or shrinks a slice, it cannot resize the existing allocation in place (Go's `mallocgc` doesn't expose `realloc`-style resizing). It must allocate a fresh span and copy. That's why `append` is "old array, new array, copy"; there is no `realloc` path in the slice machinery.

---

## 15. Reading the source

The files to read, in order:

1. `src/runtime/slice.go` — defines `slice`, `makeslice`, `growslice`, `mallocgc` wrapper, helpers.
2. `src/runtime/typekind.go` and `src/internal/abi/type.go` — the `*_type` used by `makeslice` for size + GC bitmap.
3. `src/cmd/compile/internal/walk/builtin.go` — compiler's lowering of `make`, `append`, `copy`.
4. `src/cmd/compile/internal/walk/expr.go` — slicing expression lowering (look for `walkSlice`).
5. `src/reflect/value.go` — the (now deprecated) `SliceHeader` type, and the `Slice` method.
6. `src/unsafe/unsafe.go` — declarations of `Slice` and `SliceData` (the actual implementations are compiler intrinsics).

Reading the compiler lowering once is illuminating; you see exactly what code your `s[i:j]` produces.

---

## 16. Mental model recap

A slice is the three-word triple `(array, len, cap)`. The triple is passed by value, lives in registers, and is essentially free to copy. The array it references is shared, may live on the stack or the heap, and is what your data actually occupies. `append` either bumps the in-place `len` or calls `growslice` to allocate a new array and produce a new header. `unsafe.Slice` and `unsafe.SliceData` are the modern, GC-safe ways to construct and inspect headers. Everything else — aliasing, retention, escape — follows from those mechanics.

---

## Further reading
- `runtime/slice.go` — https://github.com/golang/go/blob/master/src/runtime/slice.go
- `cmd/compile/internal/walk/expr.go` — https://github.com/golang/go/blob/master/src/cmd/compile/internal/walk/expr.go
- Go 1.20 release notes (`unsafe.Slice`/`SliceData`) — https://go.dev/doc/go1.20#language
- Russ Cox: "Go Data Structures" — https://research.swtch.com/godata
- Vincent Blanchon: "Go: Slice and Memory Management" — https://medium.com/a-journey-with-go
