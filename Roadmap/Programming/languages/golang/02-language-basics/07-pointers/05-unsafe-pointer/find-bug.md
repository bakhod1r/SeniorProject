# Unsafe Pointer — Find the Bug

A collection of realistic, broken `unsafe.Pointer` snippets. For each: the symptom, the (often subtle) cause referenced to the six patterns or the runtime contract, and the fix. Reading them in order builds the intuition you need to spot the bugs in code review before they ship.

---

## Bug 1: The `uintptr` stashed in a variable

```go
package main

import (
    "fmt"
    "runtime"
    "unsafe"
)

func main() {
    big := make([]byte, 1024)
    big[0] = 0x42
    addr := uintptr(unsafe.Pointer(&big[0]))

    runtime.GC()
    runtime.GC()

    // Try to read the first byte through the saved address.
    p := unsafe.Pointer(addr)
    fmt.Println(*(*byte)(p))
}
```

**Symptom.** Usually prints `0x42`. Occasionally prints garbage. Under `-race -gcflags=all=-d=checkptr`, fails with `fatal error: checkptr: pointer arithmetic result points to invalid allocation`.

**Cause.** Violation of Pattern 2. `addr` is a `uintptr`. The garbage collector doesn't see it, so the bytes it points to are not kept alive. `big` is still reachable here (it's a local variable still in scope), but in a more complex example where `big` goes out of scope before the cast back, you have a use-after-free.

`go vet` warns: `possible misuse of unsafe.Pointer`.

**Fix.** Keep the value as `unsafe.Pointer` across statements (it's a real pointer, GC-tracked):

```go
p := unsafe.Pointer(&big[0])

runtime.GC()
runtime.GC()

fmt.Println(*(*byte)(p))
```

The runtime now rewrites `p` correctly if a stack-grow moves the underlying memory, and the GC keeps `big` alive because there's a real pointer to it.

---

## Bug 2: `uintptr` arithmetic split across statements

```go
type T struct {
    a int32
    b int32
    c int32
}

func setC(t *T, v int32) {
    p := unsafe.Pointer(t)
    off := uintptr(p)
    off += unsafe.Offsetof(T{}.c)        // (1)
    cp := (*int32)(unsafe.Pointer(off))  // (2)
    *cp = v
}
```

**Symptom.** Sometimes works, sometimes writes to wrong memory. Hard to reproduce. `go vet` warns `unsafeptr`.

**Cause.** Pattern 3 requires the conversion-to-`uintptr` + arithmetic + conversion-back to be **one expression**. Here it's split: `off := uintptr(p)` at (1), with a separate cast-back at (2). Between (1) and (2), `t` may move (stack-grow or, theoretically, heap compaction) — `off` doesn't get rewritten.

**Fix.** Use `unsafe.Add` (Go 1.17+):

```go
func setC(t *T, v int32) {
    cp := (*int32)(unsafe.Add(unsafe.Pointer(t), unsafe.Offsetof(T{}.c)))
    *cp = v
}
```

`unsafe.Add` is a single expression; the GC and stack-grow handle it correctly.

---

## Bug 3: Misalignment on ARM

```go
func parseUint64(buf []byte, offset int) uint64 {
    return *(*uint64)(unsafe.Pointer(&buf[offset]))
}

func main() {
    b := make([]byte, 16)
    for i := range b { b[i] = byte(i) }
    fmt.Println(parseUint64(b, 3))   // offset 3 — not 8-byte aligned
}
```

**Symptom.** Works on amd64 (slow load). On arm64 (Apple Silicon, AWS Graviton), crashes with `SIGBUS: bus error`.

**Cause.** Pattern 1 requires the destination type's alignment to be satisfied. `&buf[3]` is at a byte offset of 3 — not 8-byte aligned. Casting to `*uint64` and loading on ARM faults.

**Fix.** Either guard against the misalignment or use `encoding/binary`:

```go
func parseUint64(buf []byte, offset int) uint64 {
    return binary.LittleEndian.Uint64(buf[offset:])
}
```

`encoding/binary` does the byte-by-byte load and is just as fast on modern CPUs (the compiler often emits the same code).

If you really need the cast for some other reason, check alignment first:

```go
func parseUint64(buf []byte, offset int) (uint64, error) {
    p := unsafe.Pointer(&buf[offset])
    if uintptr(p)%unsafe.Alignof(uint64(0)) != 0 {
        return 0, errors.New("misaligned offset")
    }
    return *(*uint64)(p), nil
}
```

---

## Bug 4: Lifetime ending before the call returns

```go
func bad() *Header {
    var buf [16]byte
    binary.LittleEndian.PutUint32(buf[:], 0xCAFEBABE)
    return (*Header)(unsafe.Pointer(&buf[0]))
}
```

**Symptom.** The returned `*Header` reads correct values immediately after the call, but garbage if you hold onto it across other code. Sometimes corruption.

**Cause.** `buf` is a stack-allocated local. After `bad()` returns, its stack frame is reused. The returned pointer references memory that no longer holds the header — it now holds whatever the next function call put there.

Escape analysis usually catches this and moves `buf` to the heap. But because the analysis sees an `unsafe.Pointer` cast, the heuristics may or may not fire correctly. The fix is to make the intent explicit.

**Fix.** Allocate on the heap explicitly:

```go
func good() *Header {
    buf := make([]byte, 16)
    binary.LittleEndian.PutUint32(buf, 0xCAFEBABE)
    return (*Header)(unsafe.Pointer(&buf[0]))
}
```

`make([]byte, 16)` heap-allocates the backing array. The returned `*Header` keeps the backing array alive through the GC pointer it represents.

Even better: return a value, not a pointer:

```go
func best() Header {
    var h Header
    h.Magic = 0xCAFEBABE
    return h
}
```

---

## Bug 5: Wrapping `syscall.Syscall` and losing the keepalive

```go
func myWrite(fd int, p []byte) (int, error) {
    return mySyscall3(
        SYS_WRITE,
        uintptr(fd),
        uintptr(unsafe.Pointer(&p[0])),
        uintptr(len(p)),
    )
}

func mySyscall3(trap, a1, a2, a3 uintptr) (int, error) {
    n, _, e := syscall.Syscall(trap, a1, a2, a3)
    if e != 0 {
        return 0, e
    }
    return int(n), nil
}
```

**Symptom.** Most calls succeed. Some return partial writes that don't match the input length. Under heavy GC pressure, occasional SIGSEGV inside `syscall.Syscall`.

**Cause.** Pattern 4 (the compiler's keepalive for `syscall.Syscall`) is hardcoded to the *direct* call site. When you wrap it in `mySyscall3`, the compiler sees only `uintptr` arguments — the `unsafe.Pointer(&p[0])` was converted to `uintptr` in the *caller*, and the compiler can't see that the `uintptr` is meant to be a pointer. So when GC runs during the syscall, `p` may be freed.

**Fix.** Add `runtime.KeepAlive` in the caller:

```go
func myWrite(fd int, p []byte) (int, error) {
    n, err := mySyscall3(
        SYS_WRITE,
        uintptr(fd),
        uintptr(unsafe.Pointer(&p[0])),
        uintptr(len(p)),
    )
    runtime.KeepAlive(p)
    return n, err
}
```

`KeepAlive` is a no-op at runtime but tells the compiler `p` must live until that line. The GC now sees `p` as reachable for the duration of the syscall.

Better yet, **don't wrap `syscall.Syscall`** — call it directly so the compiler's keepalive applies.

---

## Bug 6: Aliasing a `[]byte` as `[]uint32` for parallel write

```go
func parallelWrite(buf []byte) {
    as32 := unsafe.Slice((*uint32)(unsafe.Pointer(&buf[0])), len(buf)/4)
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(start int) {
            defer wg.Done()
            for j := start; j < len(as32); j += 4 {
                as32[j] = uint32(j)
            }
        }(i)
    }
    wg.Done()
}
```

**Symptom.** Most runs produce the correct output. Some runs produce values one byte off, or with one byte from the wrong write. `-race` flags it.

**Cause.** Writes to `as32` at indices `0, 4, 8, ...` and `1, 5, 9, ...` don't overlap at the `uint32` level — but the byte addresses overlap with byte indices `0..3`, `4..7`, `16..19`, `20..23`, etc. That's fine for the `uint32` writes themselves. **The actual race** is that the underlying `[]byte` and `[]uint32` are two views of the same memory; if any other goroutine reads `buf` while these writes happen, that's a data race.

If there's no concurrent reader of `buf`, the writes to disjoint `uint32` indices are non-racy. But `-race` reasons about the memory regardless of the type view, so any actual concurrent access (even through the same `as32`) at the byte level is detected.

**Fix.** Either ensure exclusive access (use a `sync.Mutex` or a single goroutine), or partition the byte slice into non-overlapping subslices for each goroutine:

```go
func parallelWriteFixed(buf []byte) {
    chunkSize := (len(buf) / 4) &^ 3   // multiple of 4 bytes
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        start := i * chunkSize
        end := start + chunkSize
        wg.Add(1)
        go func(b []byte) {
            defer wg.Done()
            as32 := unsafe.Slice((*uint32)(unsafe.Pointer(&b[0])), len(b)/4)
            for j := range as32 {
                as32[j] = uint32(j)
            }
        }(buf[start:end])
    }
    wg.Wait()
}
```

Each goroutine works on a disjoint byte region. No race, no aliasing issue.

---

## Bug 7: Mutating a `[]byte` view of a `string`

```go
func upper(s string) string {
    b := unsafe.Slice(unsafe.StringData(s), len(s))
    for i := range b {
        if b[i] >= 'a' && b[i] <= 'z' {
            b[i] -= 32
        }
    }
    return s
}

const greeting = "hello world"

func main() {
    fmt.Println(upper(greeting))
    fmt.Println(greeting)   // also changed!
}
```

**Symptom.** The constant `greeting` appears uppercased after `upper` runs. Other strings sharing the same backing memory (string interning) are also corrupted.

**Cause.** `unsafe.Slice(unsafe.StringData(s), len(s))` returns a slice that **aliases the string's bytes**. Strings are supposed to be immutable. Writing through the slice violates that contract. The original `greeting`, possibly held in read-only memory (string literals often live in `.rodata`), is either modified or causes a segfault on the write.

In Go 1.20+, string literals are typically in read-only memory; the write may actually fault rather than silently corrupt.

**Fix.** Copy to a new `[]byte` first:

```go
func upper(s string) string {
    b := []byte(s)   // copy
    for i := range b {
        if b[i] >= 'a' && b[i] <= 'z' {
            b[i] -= 32
        }
    }
    return string(b)
}
```

Or use `strings.ToUpper(s)` — same effect, doesn't touch `unsafe`.

The rule: `unsafe.SliceData`/`StringData` is for *reading* aliases. Never write through them.

---

## Bug 8: `reflect.Value.UnsafeAddr` stored before cast

```go
func setField(s any, name string, v int) {
    rv := reflect.ValueOf(s).Elem()
    fv := rv.FieldByName(name)
    addr := fv.UnsafeAddr()
    // ... some bookkeeping ...
    runtime.GC()
    p := (*int)(unsafe.Pointer(addr))
    *p = v
}
```

**Symptom.** Sometimes the field is set to `v`. Sometimes it's set to garbage. Sometimes the program crashes.

**Cause.** Pattern 5 requires `unsafe.Pointer(rv.UnsafeAddr())` to be one expression. Here `addr` is stashed as `uintptr` and converted back later. Between the two, the GC ran explicitly; in real code it could run implicitly. The address in `addr` no longer corresponds to the original field.

`go vet` warns: `possible misuse of unsafe.Pointer`.

**Fix.** One expression:

```go
func setField(s any, name string, v int) {
    rv := reflect.ValueOf(s).Elem()
    fv := rv.FieldByName(name)
    *(*int)(unsafe.Pointer(fv.UnsafeAddr())) = v
}
```

Or, since Go 1.18, use `UnsafePointer()`:

```go
*(*int)(fv.Addr().UnsafePointer()) = v
```

`UnsafePointer()` returns `unsafe.Pointer` directly — no `uintptr` to manage.

---

## Bug 9: Cgo callback retaining a Go pointer without `Pinner`

```go
/*
#include <stdlib.h>
extern void register_handler(void* data);
*/
import "C"

import (
    "unsafe"
)

type State struct{ Counter int }

func register(s *State) {
    C.register_handler(unsafe.Pointer(s))
}
```

Where the C side stores `data` in a static variable for later use.

**Symptom.** Initially everything works. Minutes or hours later, the C callback's stored pointer leads to a SIGSEGV when dereferenced, or worse, points to a different Go object that's now occupying the same address.

**Cause.** The Go runtime is free to move heap objects (today's GC doesn't actually compact, but the rules are written for it) and free unreachable ones. The C-stored pointer is invisible to the GC. Once Go's pointers to `s` go out of scope, the runtime may reclaim the object — C's stored copy now dangles.

This violates cgo's pointer-passing rules: "Go code may pass a Go pointer to C provided the Go memory to which it points does not contain any Go pointers."

**Fix.** Pin the object for as long as C may hold the pointer:

```go
import "runtime"

var stateRegistry = make(map[*State]*runtime.Pinner)

func register(s *State) {
    var p runtime.Pinner
    p.Pin(s)
    stateRegistry[s] = &p
    C.register_handler(unsafe.Pointer(s))
}

func unregister(s *State) {
    if p := stateRegistry[s]; p != nil {
        p.Unpin()
        delete(stateRegistry, s)
    }
}
```

Now the object stays at a fixed address until you explicitly `Unpin`. The caller is responsible for `unregister` when the C side no longer needs the pointer.

For pre-1.21 Go, the workaround is to copy the data into a `C.malloc` allocation that C owns, then `C.free` when done.

---

## Bug 10: `unsafe.Slice` with `len * sizeof` overflowing

```go
type Big struct {
    data [1 << 30]byte
}

func makeSlice(p *Big, n int) []Big {
    return unsafe.Slice(p, n)
}

func main() {
    var b Big
    s := makeSlice(&b, math.MaxInt64)
    _ = s
}
```

**Symptom.** Go 1.22+: panics with `unsafe.Slice: len out of range`. Pre-1.22: silently produces a slice with bizarre header values, then any operation on it corrupts unrelated memory.

**Cause.** `unsafe.Slice(p, n)` produces a slice of length `n` and capacity `n` whose underlying array has `n * sizeof(T)` bytes. If that multiplication overflows `uintptr`, the slice header is invalid. Go 1.22 added the explicit panic; earlier versions trusted the user.

**Fix.** Validate the length before calling:

```go
func makeSlice(p *Big, n int) ([]Big, error) {
    if n < 0 {
        return nil, errors.New("negative length")
    }
    const maxLen = (1 << 62) / int64(unsafe.Sizeof(Big{}))
    if int64(n) > maxLen {
        return nil, errors.New("length too large")
    }
    return unsafe.Slice(p, n), nil
}
```

For dynamically-determined lengths (e.g., from a packet header you don't control), this check is mandatory. Otherwise an attacker can send a header claiming `len = 1<<62` and crash your process.

---

## Bug 11: Hot-loop allocation hidden by `unsafe.Pointer`

```go
type Buffer struct {
    data unsafe.Pointer
    len  int
}

func New() *Buffer {
    b := make([]byte, 1024)
    return &Buffer{data: unsafe.Pointer(&b[0]), len: 1024}
}

func main() {
    for i := 0; i < 1_000_000; i++ {
        _ = New()
    }
}
```

**Symptom.** Profiling shows massive heap allocation. The `unsafe.Pointer` "trick" hasn't avoided the allocation; it's added one.

**Cause.** `&b[0]` is an `unsafe.Pointer`, which forces `b` to escape to the heap (the compiler can't trace it through the cast). Then `&Buffer{...}` escapes too. The `unsafe` work has produced zero benefit and introduced confusion.

Check with `go build -gcflags="-m"`:

```
./main.go:8:13: make([]byte, 1024) escapes to heap
./main.go:9:9: &Buffer literal escapes to heap
./main.go:9:24: unsafe.Pointer(&b[0]) escapes to heap
```

**Fix.** Either ditch `unsafe` and store the `[]byte` directly:

```go
type Buffer struct {
    data []byte
}

func New() *Buffer {
    return &Buffer{data: make([]byte, 1024)}
}
```

Or, if you really want a `Buffer` per call, use a `sync.Pool`:

```go
var pool = sync.Pool{
    New: func() any { return &Buffer{data: make([]byte, 1024)} },
}
```

The rule: `unsafe.Pointer` does not magically remove allocations. Measure with `-benchmem` and `-gcflags=-m` before assuming it helps.

---

## Bug 12: Forgetting `runtime.KeepAlive` with a finalizer

```go
type File struct{ fd int }

func openFile(path string) *File {
    fd, _ := syscall.Open(path, syscall.O_RDONLY, 0)
    f := &File{fd: fd}
    runtime.SetFinalizer(f, func(f *File) { syscall.Close(f.fd) })
    return f
}

func readByte(f *File) (byte, error) {
    var b [1]byte
    _, err := syscall.Read(f.fd, b[:])
    if err != nil {
        return 0, err
    }
    return b[0], nil
}
```

**Symptom.** Rare `bad file descriptor` errors. Mostly works. Under heavy GC pressure, the failure rate increases.

**Cause.** After `f.fd` is loaded inside `syscall.Read`, the only reference to `f` in `readByte` is gone — the compiler considers `f` dead. The GC can run between the load of `f.fd` and the return from `syscall.Read`, fire the finalizer, and close the fd. The in-flight syscall then operates on a closed/reused fd.

**Fix.** `runtime.KeepAlive` after the syscall:

```go
func readByte(f *File) (byte, error) {
    var b [1]byte
    _, err := syscall.Read(f.fd, b[:])
    runtime.KeepAlive(f)
    if err != nil {
        return 0, err
    }
    return b[0], nil
}
```

`KeepAlive(f)` tells the compiler `f` must be considered live up to that point. The GC sees `f` as reachable; the finalizer doesn't run yet; the fd stays open through the syscall.

Better: don't use a finalizer for resource management. Make the caller `defer f.Close()` explicitly. Finalizers are a backstop for forgotten cleanup, not a primary mechanism.

---

## Bug 13: `unsafe.SliceData` on an empty slice

```go
func firstByte(b []byte) byte {
    return *unsafe.SliceData(b)
}

func main() {
    b := []byte{}
    fmt.Println(firstByte(b))
}
```

**Symptom.** Sometimes prints `0`. Sometimes segfaults. Behaviour depends on whether `b` is `nil` or an empty-but-non-nil slice.

**Cause.** `unsafe.SliceData` for an empty slice returns either `nil` (if the slice itself is `nil`) or some non-nil but **may-not-be-dereferenceable** pointer (if the slice has zero length but the runtime allocated a header). Dereferencing it is undefined.

The doc says (paraphrased): "If `cap(slice)` is zero, the returned pointer is `&slice[:1][0]` if accessible, or `nil` otherwise" — meaning even if it's non-nil, the underlying byte is not guaranteed to be readable.

**Fix.** Always guard:

```go
func firstByte(b []byte) (byte, error) {
    if len(b) == 0 {
        return 0, errors.New("empty slice")
    }
    return b[0], nil
}
```

Or use direct indexing — Go's runtime checks bounds and panics gracefully:

```go
func firstByte(b []byte) byte {
    return b[0]   // panics on empty, which is the right behaviour
}
```

`unsafe.SliceData` is the wrong tool here. It's for *constructing* slices and strings, not for replacing index `[0]`.

---

## Bug 14: Aliasing the same memory through two pointer types

```go
type Inner struct {
    A int64
}

type Outer struct {
    A int64
    B int64
}

func mutate(in *Inner) {
    out := (*Outer)(unsafe.Pointer(in))
    out.B = 99   // writes past the end of *in!
}

func main() {
    var i Inner
    mutate(&i)
    fmt.Println(i.A)
}
```

**Symptom.** Sometimes works. Sometimes corrupts whatever variable was allocated next to `i`. Under `-d=checkptr`, fails with `pointer arithmetic result points to invalid allocation`.

**Cause.** Pattern 1 requires the destination type to be no larger than the source (or, if larger, you must guarantee the memory extends far enough). `Inner` is 8 bytes; `Outer` is 16. Writing `out.B` writes 8 bytes past the end of `i`. If `i` is on the stack, you've corrupted the stack frame's next variable; if on the heap, you've corrupted whatever the allocator put next.

**Fix.** Either allocate as `Outer`:

```go
func main() {
    var o Outer
    mutate(&Inner{A: o.A})   // wrong shape — but at least passes a real Inner
}
```

Or, more honestly, don't fake the type. If you need an `Outer`, take an `*Outer`:

```go
func mutate(out *Outer) {
    out.B = 99
}
```

The bug here is conceptual: the function pretends `*Inner` is an `*Outer`. Type punning requires the actual memory layout to match the new view.

---

## Bug 15: Pointer-to-slice-of-pointers vs slice-of-pointer-to-pointer

```go
type Node struct { Val int }

func zeroSlice(s []*Node) {
    p := unsafe.Pointer(&s[0])
    for i := 0; i < len(s); i++ {
        np := (**Node)(unsafe.Add(p, uintptr(i)*unsafe.Sizeof((*Node)(nil))))
        *np = nil
    }
}
```

**Symptom.** Compiles and runs, but the GC may free the `Node` values you wanted to keep — even ones not in `s`. Sometimes a `Node` that's still in use elsewhere gets collected.

**Cause.** Setting `*np = nil` writes a nil pointer to position `i` of the slice's backing array. This is correct — sets `s[i] = nil`. So far so good.

But the bigger conceptual issue: when you mutate pointer-typed slice elements via `unsafe`, the GC's write barrier may not fire correctly. The write barrier is what keeps the GC's mark phase consistent when pointers change. Pre-Go-1.5 `unsafe` writes bypassed the barrier; modern Go is more careful, but it depends on the compiler inserting the barrier when it sees a pointer-typed write.

A write through `(**Node)` with the inner type known to the compiler does emit the barrier. A write through `unsafe.Pointer` followed by a manual reinterpretation may not.

**Fix.** Use the slice directly — the compiler knows how to write pointers correctly:

```go
func zeroSlice(s []*Node) {
    for i := range s {
        s[i] = nil
    }
}
```

Or `clear(s)` since Go 1.21.

The rule: never use `unsafe` to write pointer-typed memory. The GC barrier is hard to get right manually. Read-only patterns (re-typing for parsing, building zero-copy views) are fine; writes through `unsafe` to slots that may hold GC-tracked pointers are dangerous.

---

## 16. Summary

The bugs cluster around four themes:

1. **`uintptr` lifetime** (Bugs 1, 2, 8) — storing the integer form of an address across statements, calls, or GC cycles.
2. **Layout assumptions** (Bugs 3, 4, 10, 14) — assuming alignment, lifetime, size, or memory extent that isn't guaranteed.
3. **Compiler/runtime contracts** (Bugs 5, 9, 12) — wrappers that lose the syscall keepalive, cgo without `Pinner`, finalizers without `KeepAlive`.
4. **Misuse of the modern API** (Bugs 7, 11, 13, 15) — treating `unsafe.SliceData`/`StringData` as "free" or "fast", forgetting that aliases are still GC-tracked memory, writing through aliases that should be read-only.

Each is a real production-incident shape. The defenses are the same in every case: stay inside the six patterns, run `-race` and `-d=checkptr`, document lifetime contracts, and audit `unsafe`-touching code at PR time. The mechanical checkers catch about half; the rest needs a reviewer who knows the rules.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `unsafeptr` analyzer source: https://cs.opensource.google/go/x/tools/+/master:go/analysis/passes/unsafeptr/
- `-d=checkptr` documentation: https://github.com/golang/go/issues/22218
- `runtime.Pinner`: https://pkg.go.dev/runtime#Pinner
- `runtime.KeepAlive`: https://pkg.go.dev/runtime#KeepAlive
- cgo pointer-passing rules: https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers
- Sibling: [memory-management](../04-memory-management/)
