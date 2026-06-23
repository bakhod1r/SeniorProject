# `unsafe` Package — Find the Bug

Realistic `unsafe` bugs, each with symptom, cause, and fix.

---

## Bug 1: The disappearing object

```go
func bad() *int {
    x := new(int)
    *x = 42
    addr := uintptr(unsafe.Pointer(x))
    runtime.GC()
    return (*int)(unsafe.Pointer(addr))
}
```

**Symptom.** Returned value is sometimes 42, sometimes garbage. Crashes under load.

**Cause.** Between the `uintptr` conversion and the dereference, the GC may collect `x` because no Go-typed reference exists.

**Fix.** Don't convert to `uintptr` across program points. Use `unsafe.Pointer` throughout, or `runtime.KeepAlive`:

```go
defer runtime.KeepAlive(x)
return (*int)(unsafe.Pointer(x))
```

Better yet: avoid the round-trip.

---

## Bug 2: String mutation

```go
b := []byte("hello")
s := unsafe.String(unsafe.SliceData(b), len(b))
b[0] = 'H'                                  // mutates b — and s!
fmt.Println(s)                              // "Hello"
m := map[string]int{s: 1}
b[0] = 'h'
fmt.Println(m[s])                           // 0 (key changed under the map's hash)
```

**Symptom.** Maps lose entries; switch cases misfire.

**Cause.** Mutating bytes after creating a string view violates the invariant that strings are immutable. Maps cache hashes; the bytes change but the hash doesn't.

**Fix.** Don't mutate `b` while `s` is alive. Or take a real copy:

```go
s := string(b)   // explicit copy
```

---

## Bug 3: Misaligned 64-bit atomic

```go
type T struct {
    a int32
    b int64
}

func bad(t *T) {
    atomic.AddInt64(&t.b, 1)        // may panic on 32-bit ARM
}
```

**Symptom.** "unaligned 64-bit atomic operation" panic, only on 32-bit platforms.

**Cause.** `b`'s offset is 4 (after `a`'s 4 bytes) on 32-bit, but 64-bit atomics require 8-byte alignment.

**Fix.** Reorder fields, pad explicitly, or use `atomic.Int64` (Go 1.19+), which guarantees alignment via its struct layout:

```go
type T struct {
    a int32
    b atomic.Int64
}
```

---

## Bug 4: `unsafe.Slice` past the buffer

```go
buf := make([]byte, 100)
s := unsafe.Slice((*int32)(unsafe.Pointer(&buf[0])), 200)   // claims 800 bytes
s[150] = 0xdeadbeef                                          // writes past buf
```

**Symptom.** Memory corruption, eventually a crash.

**Cause.** `unsafe.Slice` doesn't check that `n * sizeof(T)` fits in the underlying memory.

**Fix.** Compute `n` correctly:

```go
n := len(buf) / int(unsafe.Sizeof(int32(0)))
s := unsafe.Slice((*int32)(unsafe.Pointer(&buf[0])), n)
```

---

## Bug 5: Lifetime of cgo memory

```go
func process(n int) []byte {
    buf := C.malloc(C.size_t(n))
    defer C.free(buf)                // freed at return
    return unsafe.Slice((*byte)(buf), n)
}
```

**Symptom.** Caller reads garbage from the returned slice.

**Cause.** `C.free(buf)` runs at function return; the returned slice is a dangling alias.

**Fix.** Either copy out, or let the caller own the lifetime:

```go
func process(n int) []byte {
    out := make([]byte, n)
    cbuf := C.malloc(C.size_t(n))
    defer C.free(cbuf)
    // ... fill cbuf via C calls ...
    copy(out, unsafe.Slice((*byte)(cbuf), n))
    return out
}
```

---

## Bug 6: `append` reallocates an `unsafe.Slice`

```go
buf := C.malloc(C.size_t(100))
s := unsafe.Slice((*byte)(buf), 100)
s = append(s, 0)                     // append exceeds cap → reallocates
C.free(buf)                          // s no longer points at C memory
```

**Symptom.** Caller mutates the slice expecting it to write to C memory; it doesn't.

**Cause.** `append` grows the slice into Go-allocated memory once capacity is exceeded.

**Fix.** Don't `append` to slices that wrap external memory. Use the slice as a fixed-size view; for variable lengths, use a Go slice and copy at the boundary.

---

## Bug 7: Reading bytes with the wrong layout

```go
type Header struct {
    Magic uint32
    Len   uint32
}

func parse(b []byte) Header {
    return *(*Header)(unsafe.Pointer(&b[0]))
}
```

**Symptom.** Works on x86 but produces garbage on big-endian platforms; or, the file was written by a tool on a different platform.

**Cause.** `unsafe.Pointer` reads the host's byte order. If the bytes were written little-endian and the host is big-endian, every field is byte-swapped.

**Fix.** Use `encoding/binary`:

```go
return Header{
    Magic: binary.LittleEndian.Uint32(b[0:4]),
    Len:   binary.LittleEndian.Uint32(b[4:8]),
}
```

Or document that the code only runs on little-endian platforms.

---

## Bug 8: `&slice[0]` on an empty slice

```go
b := []byte{}
p := unsafe.Pointer(&b[0])           // panic: index out of range
```

**Symptom.** Panic at the `&b[0]` evaluation.

**Cause.** An empty slice has no valid first element.

**Fix.** Check the length, or use `unsafe.SliceData`:

```go
p := unsafe.Pointer(unsafe.SliceData(b))
if p == nil { return ... }
```

`unsafe.SliceData` returns `nil` for an empty slice.

---

## Bug 9: Hidden race via `unsafe`

```go
var p unsafe.Pointer

go func() {
    n := newNode()
    p = unsafe.Pointer(n)             // unsynchronized store
}()

go func() {
    if p != nil {
        n := (*Node)(p)                // unsynchronized read
        fmt.Println(n.val)
    }
}()
```

**Symptom.** Sometimes prints the expected value, sometimes panics or prints garbage. `-race` reports a data race.

**Cause.** Unsynchronized concurrent read/write of `p`. `unsafe.Pointer` is not magically atomic.

**Fix.** Use `atomic.Pointer[Node]` (Go 1.19+):

```go
var p atomic.Pointer[Node]
p.Store(newNode())
if n := p.Load(); n != nil { ... }
```

---

## Bug 10: Storing pointers as `uintptr` in a struct

```go
type ref struct {
    addr uintptr
}

func newRef() *ref {
    x := new(int)
    *x = 42
    return &ref{addr: uintptr(unsafe.Pointer(x))}
}

// Later — possibly after GC:
r := newRef()
runtime.GC()
fmt.Println(*(*int)(unsafe.Pointer(r.addr)))    // undefined
```

**Symptom.** Reads garbage or crashes.

**Cause.** `uintptr` is not GC-tracked. The `int` is no longer reachable to the GC.

**Fix.** Store as `unsafe.Pointer`:

```go
type ref struct {
    p unsafe.Pointer
}
```

The GC will trace the pointer through the struct.

---

## Bug 11: `unsafe.Sizeof` on the wrong thing

```go
fmt.Println(unsafe.Sizeof("hello world"))   // 16, not 11
```

**Symptom.** Confused user thinks `Sizeof` measures content length.

**Cause.** `Sizeof` measures the type's header. A string is a 2-word header (pointer + length). It doesn't measure the bytes it points to.

**Fix.** For content length, use `len(s)`. For all sizes including the content, add `len(s)` to `unsafe.Sizeof(s)`.

---

## Bug 12: Forgetting padding

```go
type T struct {
    a byte    // offset 0, size 1
    b int64   // offset 8, size 8 — 7 bytes of padding before
    c byte    // offset 16, size 1
    // 7 bytes of tail padding
}
// unsafe.Sizeof(T{}) == 24, not 10
```

**Symptom.** A buffer sized for "10 bytes" overflows; a memory profile shows much higher usage than expected.

**Cause.** Alignment-driven padding inflates the struct.

**Fix.** Reorder fields:

```go
type T struct {
    b int64   // 8
    a byte    // 1
    c byte    // 1 + 6 padding
}
// Sizeof = 16
```

Use `unsafe.Offsetof` to inspect each field's position when in doubt.

---

## Bug 13: `unsafe.Pointer` arithmetic across an arena boundary

```go
arr := [4]int{}
p := unsafe.Pointer(&arr[0])
p = unsafe.Add(p, 100)               // way past arr
v := *(*int)(p)                       // reads unrelated memory or crashes
```

**Symptom.** Reads garbage or crashes.

**Cause.** Arithmetic that walks past the original object is undefined behavior. The Go runtime makes no promises about adjacent memory.

**Fix.** Constrain arithmetic to within the object. For dynamic ranges, check before advancing.

---

## 14. Summary

Most `unsafe` bugs come from a small set of mistakes: storing `uintptr` (GC-invisible), mutating bytes after a string view, alignment errors on 32-bit, miscounted `unsafe.Slice` lengths, lifetime mismatches between Go and C memory, host-byte-order assumptions, and unsynchronized concurrent access. Each is preventable with discipline; each bites hard when missed.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `runtime.KeepAlive`: https://pkg.go.dev/runtime#KeepAlive
- `atomic.Pointer[T]`: https://pkg.go.dev/sync/atomic#Pointer
- cgo memory rules: https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers
