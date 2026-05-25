# Unsafe Pointer — Senior

## 1. The runtime contract, in one mental model

The six patterns in the [`unsafe`](https://pkg.go.dev/unsafe#Pointer) doc page aren't an arbitrary list. They are the smallest set of operations the Go runtime can support without breaking three invariants:

1. **The garbage collector must accurately enumerate live pointers.** Any "address" the GC can't see is invisible — the object it points to can be freed at any time.
2. **The runtime may move stack-allocated objects.** When a goroutine's stack grows (Go's stacks start at 8 KiB and double on overflow), the runtime allocates a new stack, copies the contents, and rewrites every pointer that pointed into the old stack. A `uintptr` is not rewritten because the GC doesn't know it's a pointer.
3. **Escape analysis decides at compile time** whether a value lives on the stack or the heap. `unsafe.Pointer` interacts with this decision: if `&x` flows through an `unsafe.Pointer`, the compiler must conservatively force `x` to the heap.

The rules exist to make `unsafe`-using code compatible with these three. Violations don't usually crash immediately; they corrupt the heap, then crash later, then become "intermittent" bugs that never reproduce on the developer's machine.

This file explains the mechanics behind each invariant, walks the `unsafeptr` analyzer source, and shows the compiler/runtime guarantees you can and can't lean on.

---

## 2. The GC pointer map

The Go garbage collector traces pointers by walking the heap, starting from goroutine stacks and global variables. For every reachable object, it needs to know which words inside that object are pointers.

The compiler emits a **pointer map** (a `runtime.bitvector`) for every type: a bit per word, 1 if that word is a pointer. The GC reads the bitmap and follows the marked words.

Three categories of words:

| Word | Bitmap bit | GC behaviour |
|------|-----------|--------------|
| `*T` | 1 | Followed |
| `unsafe.Pointer` | 1 | Followed |
| `uintptr`, `int`, `bool`, ... | 0 | Ignored |

This is why `unsafe.Pointer` is GC-safe and `uintptr` is not. The bit is the *only* difference; at the CPU level both hold 8 bytes (on 64-bit). The compiler tags `unsafe.Pointer` as "pointer", `uintptr` as "scalar", and the GC respects the tag.

You can inspect the pointer map of any type via `runtime.dumpheap` (debug builds) or by reading the generated assembly: types with pointer fields produce `runtime.gcdata` entries.

Practical implication: a `struct { p uintptr }` and a `struct { p unsafe.Pointer }` look identical at runtime but have **opposite** GC semantics. The first is safe to hold anything; nothing in it keeps memory alive. The second keeps whatever its pointer field references alive, and the GC will treat the bytes at that address as live.

---

## 3. The `unsafeptr` analyzer, line by line

Source: [`golang.org/x/tools/go/analysis/passes/unsafeptr/unsafeptr.go`](https://cs.opensource.google/go/x/tools/+/master:go/analysis/passes/unsafeptr/unsafeptr.go).

The analyzer is short — under 200 lines. Its core is:

```go
// isSafeUintptr reports whether x is a uintptr expression that is
// safe to convert to unsafe.Pointer. It is safe if x is itself a
// uintptr(unsafe.Pointer(...)) within the same expression or if x is
// a constant that obviously doesn't represent an address.
func isSafeUintptr(info *types.Info, x ast.Expr) bool {
    ...
}
```

The check `isSafeUintptr` runs on every `unsafe.Pointer(expr)` conversion. The patterns it accepts:

| Pattern | Accepted? |
|---------|-----------|
| `unsafe.Pointer(uintptr(p))` where `p` is `unsafe.Pointer` | Yes |
| `unsafe.Pointer(uintptr(p) + N)` where `N` is a `uintptr`-ish constant or `unsafe.{Size,Align,Offset}of` | Yes |
| `unsafe.Pointer(uintptr(p) + uintptr(i)*unsafe.Sizeof(...))` | Yes |
| `unsafe.Pointer(someLocalUintptrVariable)` | **No** — `someLocalUintptrVariable` was stored across statements |
| `unsafe.Pointer(reflect.ValueOf(...).Pointer())` | Yes — recognized as the Pattern 5 case |
| `unsafe.Pointer(uintptr(0x1234))` (constant address) | No (but a different analyzer warns) |

The analyzer is **purely syntactic**. It doesn't follow data flow. If you obscure the pattern with an intermediate function call, vet stays silent — but the bug remains:

```go
// vet doesn't catch this — wrap hides the round-trip
func wrap(p unsafe.Pointer) uintptr { return uintptr(p) }
u := wrap(p)
// ... other code ...
p2 := unsafe.Pointer(u)   // not flagged, but identical bug
```

The lesson: `unsafeptr` is a guardrail, not a verifier. Code that passes vet can still be wrong. Code review by someone who knows the patterns is the actual safety net.

---

## 4. Why `uintptr` is invisible: walking through a stack-grow

To make the "uintptr is not a pointer" rule concrete, follow what happens during a stack grow.

```go
func sneaky() {
    var x [1024]byte
    addr := uintptr(unsafe.Pointer(&x[0]))
    bigFunc()                                    // (A) may grow this goroutine's stack
    p := (*[1024]byte)(unsafe.Pointer(addr))     // (B) dangling?
    _ = p[0]                                     // (C) may read garbage
}
```

At point (A), `bigFunc` may push the stack past its current limit. The runtime allocates a new stack (twice the size), copies the contents of the old stack into the new one, and walks every pointer that was on the old stack — every typed pointer, every `unsafe.Pointer` — rewriting it to point into the new stack.

`addr` is a `uintptr`. Its bit in the stack's pointer map is 0. The runtime ignores it. After the stack grow, `addr` still holds the old address — which now points into deallocated memory (or, worse, into a freshly-reused stack belonging to a different goroutine).

At point (B), `unsafe.Pointer(addr)` produces a pointer at an address that no longer corresponds to `x`. At point (C), the read returns whatever bytes happen to be there now.

This is not "if the GC ran". This is "if the stack grew". Stack grows happen all the time and are completely transparent to user code. There is no warning, no signal, no opportunity to react.

The fix is trivial: don't take `addr` as a `uintptr`. Keep it as an `unsafe.Pointer`:

```go
func notSneaky() {
    var x [1024]byte
    p := unsafe.Pointer(&x[0])
    bigFunc()                                     // runtime rewrites p if stack moves
    arr := (*[1024]byte)(p)
    _ = arr[0]
}
```

Now the runtime knows `p` is a pointer, sees it on the stack pointer map, and rewrites it during the move.

---

## 5. Escape analysis and `unsafe.Pointer`

The compiler decides per-value whether each `&x` taken can escape the function. A reference that escapes forces `x` to be heap-allocated.

For typed pointers (`*T`), escape analysis is precise: the compiler can prove that a pointer doesn't outlive the function and keep `x` on the stack.

For `unsafe.Pointer`, escape analysis is **conservative**: any `unsafe.Pointer(&x)` flowing into a function call escapes `x` to the heap. The compiler can't reason through the cast.

You can see this with `go build -gcflags="-m"`:

```go
package main

import "unsafe"

func sink(unsafe.Pointer) {}

func main() {
    x := 42
    sink(unsafe.Pointer(&x))
}
```

```
$ go build -gcflags="-m" ./main.go
./main.go:8:6: moved to heap: x
./main.go:9:7: unsafe.Pointer(&x) escapes to heap
```

`x` would normally stay on the stack — `sink` doesn't store the pointer anywhere. But the moment `&x` flows through an `unsafe.Pointer` to an external function, the compiler bails out and heap-allocates.

This has two consequences:

1. `unsafe.Pointer` makes some code **slower** (extra allocation, GC pressure) even when it looks like a zero-copy trick. Measure before assuming wins.
2. The `runtime.KeepAlive` you sometimes need with `cgo` and syscalls works *because* the compiler is forced to keep the variable's lifetime extended through the keep-alive call. Without escape conservativism, the compiler could prove the variable was dead and free its memory before the syscall.

---

## 6. `runtime.KeepAlive`, what it actually does

`runtime.KeepAlive(x)` is documented as:

> KeepAlive marks its argument as currently reachable. This ensures that the object is not freed, and its finalizer is not run, before the point in the program where KeepAlive is called.

What that means in compiler terms: `KeepAlive(x)` tells the optimizer that `x`'s lifetime extends to that point. Without it, the compiler may reason "this variable's last use was 10 lines ago; we can reuse its slot" — and the GC can then free what it was pointing to.

The textbook case: a finalizer.

```go
type File struct{ fd int }

func openFile(name string) *File {
    fd, _ := syscall.Open(name, syscall.O_RDONLY, 0)
    f := &File{fd: fd}
    runtime.SetFinalizer(f, func(f *File) { syscall.Close(f.fd) })
    return f
}

func readByte(f *File) byte {
    var b [1]byte
    syscall.Read(f.fd, b[:])     // (X) — f.fd is fine here
    // (Y) — f's last use is the load of f.fd at (X). After (X), f is dead.
    // Finalizer could run between (X) and (Y), closing fd while the syscall is in flight.
    return b[0]
}

// Fix:
func readByteFixed(f *File) byte {
    var b [1]byte
    syscall.Read(f.fd, b[:])
    runtime.KeepAlive(f)         // f stays live until here
    return b[0]
}
```

The `KeepAlive` ensures the finalizer doesn't run between the `Read` and the function return. For `unsafe.Pointer` code that crosses into C land via `cgo`, the same pattern applies: keep the Go object alive across the C call.

---

## 7. Cgo, `runtime.Pinner`, and the modern alternative

Before Go 1.21, passing a `*T` (where `T` contains pointers) to a C function was forbidden by `cgo`'s pointer-passing rules: C could store the pointer, the GC would move/collect the Go object, and C would now hold a dangling pointer.

Go 1.21 introduced `runtime.Pinner`:

```go
var pinner runtime.Pinner
defer pinner.Unpin()
pinner.Pin(&goObj)
C.someCfunc(unsafe.Pointer(&goObj))
```

`Pin` tells the runtime that this object must not be moved or collected until `Unpin` runs. The GC marks it as pinned in the heap bitmap. C can hold the pointer for as long as we want; the address is stable.

`Pinner` is the right tool when:

- You're passing Go memory to C and C will store the address.
- You're doing zero-copy DMA from a kernel device into Go memory.
- You're integrating with libraries (FFI, OpenGL) that expect stable host-side buffers.

Before 1.21, the workaround was `C.malloc` followed by `C.memcpy` — slow and forced double allocation. `Pinner` removes that cost.

See [unsafe-package](../../../11-advanced-topics/04-unsafe-package/) and the cgo wiki for the full pointer-passing rules.

---

## 8. The compiler's `//go:nosplit` and `//go:nointerface`

Code inside the Go runtime sometimes uses `unsafe.Pointer` in ways that violate the analyzer's expectations. The runtime escapes the patterns with two pragmas:

```go
//go:nosplit
func runtime_someThing(p unsafe.Pointer) {
    // Cannot do a stack-grow check here, so cannot grow the stack.
    // Pointers in locals don't need rewriting because the stack won't move.
}
```

`//go:nosplit` forbids the compiler from inserting the prologue stack-grow check. The function runs on whatever stack space is already available; the runtime is responsible for ensuring there's enough.

`//go:nointerface` and `//go:linkname` are other runtime-only escapes. You'll see them all over `runtime/` and `reflect/`. **Don't use them in application code.** They exist to bootstrap the runtime; once outside it, the normal rules apply.

---

## 9. Memory model implications

The [Go Memory Model](https://go.dev/ref/mem) doesn't say anything specific about `unsafe.Pointer`. The happens-before rules apply the same way: a write through `unsafe.Pointer` and a read through another `unsafe.Pointer` to the same memory need synchronization (channel, mutex, `atomic`) if performed by different goroutines.

This is easy to forget when you've aliased a `[]byte` as a `[]uint32` for parallel work:

```go
buf := make([]byte, 1024)
asInts := unsafe.Slice((*uint32)(unsafe.Pointer(&buf[0])), 256)

// Goroutine A
go func() { asInts[0] = 42 }()

// Goroutine B
go func() { _ = buf[3] }()    // RACE — same memory, different type alias
```

The race detector (`-race`) flags this correctly. It tracks memory by address, not by type, so aliasing doesn't fool it.

The same memory accessed via two unsynchronized goroutines is a data race regardless of the types used to view it. `unsafe.Pointer` doesn't change the rule; it just makes the aliasing easier to miss in review.

---

## 10. ARM64, alignment, and `SIGBUS`

x86 historically forgave misaligned access — slow but functional. ARM is stricter; misaligned `int64` loads can fault with `SIGBUS`.

Go's allocator returns memory aligned to at least `unsafe.Alignof(T)` for objects of type `T`. So `make([]int64, N)` always gives 8-byte-aligned memory. But:

```go
b := make([]byte, 100)
p := (*int64)(unsafe.Pointer(&b[3]))    // 3-byte offset; not aligned!
n := *p                                  // amd64: slow; arm64: SIGBUS
```

This is one of the bugs that "works on Mac, crashes on Graviton" — Apple Silicon's M1/M2 are ARM, and AWS Graviton is ARM. Code that ran fine in dev fails in production on the cheaper instance tier.

The remedy: never re-type a pointer obtained at an arbitrary offset into byte memory. Compute aligned offsets explicitly, or use `encoding/binary` for the parsing path that doesn't care about layout.

```go
// Safe — uses an aligned start
b := make([]byte, 128)
p := (*int64)(unsafe.Pointer(&b[0]))   // b[0] is 8-byte aligned by allocator
```

For sub-aligned offsets, copy through a typed local:

```go
var n int64
copy((*(*[8]byte)(unsafe.Pointer(&n)))[:], b[3:11])
```

`encoding/binary.LittleEndian.Uint64(b[3:11])` does the equivalent without `unsafe` and the compiler usually inlines it to comparable speed.

---

## 11. The `noescape` trick (advanced, runtime-internal)

The Go runtime has a function:

```go
//go:nosplit
//go:nocheckptr
func noescape(p unsafe.Pointer) unsafe.Pointer {
    x := uintptr(p)
    return unsafe.Pointer(x ^ 0)
}
```

The XOR-by-zero is a no-op at runtime, but the round-trip through `uintptr` defeats escape analysis: from the compiler's view, the returned pointer doesn't have a known relationship to the input, so it can't conclude the underlying object escapes.

This is used inside `sync.Pool` and similar hot-path runtime code to keep objects stack-allocated. **Do not use it in application code.** It violates the "uintptr is not a pointer" rule deliberately, and it works only because the runtime's GC and escape analysis cooperate carefully with each other. Replicating it elsewhere produces undefined behaviour.

The `//go:nocheckptr` pragma also disables the `-race`-enabled pointer-validity check, which would otherwise flag the round-trip.

---

## 12. What the compiler guarantees, in plain terms

For code that obeys the six patterns:

1. **Pointer arithmetic via `unsafe.Add` is GC-safe.** The result is treated as a real pointer; the GC keeps the underlying object alive.
2. **Round-trip `uintptr` arithmetic in one expression is GC-safe.** The compiler recognizes the syntactic pattern and inserts a "keepalive" of sorts.
3. **Calls to `syscall.Syscall*` get pointer keepalive automatically.** Hardcoded.
4. **Re-typed pointers see the same memory.** Cast `*T1` to `*T2` and back; you get the same address.

The compiler does **not** guarantee:

| Not guaranteed | Why |
|----------------|-----|
| Struct field layout (padding, ordering) | The spec leaves layout implementation-defined |
| `Sizeof(T)` constancy across Go versions | Padding rules have changed historically |
| Stack location stability across function calls | Stack-grow can move things |
| Heap object address stability across GC cycles | The runtime reserves the right to compact (currently doesn't) |
| Pointer arithmetic that goes "off the end" of an object | Undefined; may seem to work or may corrupt the heap |

The rules are written defensively because the runtime authors want to preserve the freedom to change layout, compact the heap, or move stacks. Code that depends on current behaviour will break when those freedoms are exercised.

---

## 13. The `-d=checkptr` runtime check

When you build with `-race` or `-d=checkptr`, the compiler emits extra runtime checks around `unsafe.Pointer` operations:

```bash
go run -gcflags="all=-d=checkptr" ./main.go
```

The checks include:

| Check | When |
|-------|------|
| Conversion alignment check | Casting `unsafe.Pointer` to `*T` verifies the address is `Alignof(T)`-aligned |
| Pointer-in-bounds check | `unsafe.Slice(p, n)` and `unsafe.String(p, n)` verify `p + n*sizeof` doesn't overflow |
| Pointer-to-heap check | When casting `unsafe.Pointer` to `*T`, the runtime checks the address belongs to a valid Go object (with `-race` only) |

On failure, the program aborts with a clear message:

```
fatal error: checkptr: misaligned pointer conversion
```

Use this in CI for `unsafe`-heavy code. The runtime cost is non-trivial (5–30 % slowdown depending on workload) so it's a CI tool, not a production tool — but it's the most powerful dynamic checker for `unsafe.Pointer` misuse currently available.

---

## 14. The Go 1.22 stricter `unsafe.Slice` checks

Go 1.22 tightened `unsafe.Slice` to require `len ≥ 0` strictly and to validate the pointer-and-length combination doesn't overflow `uintptr`. Pre-1.22, certain pathological inputs would silently produce invalid slices; post-1.22 they panic.

If you're maintaining a library that supports older Go versions, write defensively:

```go
func sliceOf[T any](p *T, n int) []T {
    if n < 0 {
        panic("negative length")
    }
    if p == nil && n != 0 {
        panic("nil pointer with nonzero length")
    }
    return unsafe.Slice(p, n)
}
```

The wrapper makes the failure mode explicit and forward-compatible.

---

## 15. Summary

The six patterns exist because of three runtime invariants: the GC's pointer map (which `uintptr` doesn't participate in), goroutine stack-grow (which rewrites typed pointers but not `uintptr`s), and escape analysis (which conservatively forces `unsafe.Pointer`-touched values to the heap). Violations corrupt memory silently; the `unsafeptr` vet analyzer is a syntactic guardrail that catches the obvious cases but misses lifetime, alignment, and data-race issues. For runtime-level concerns (cgo pointer passing, finalizers, stable addresses for FFI) use `runtime.KeepAlive` and `runtime.Pinner` rather than ad-hoc `uintptr` tricks. The `-d=checkptr` build flag and `-race` together form the best dynamic checker for `unsafe.Pointer` misuse. The next file extends these mechanics into production patterns: zero-copy I/O, hardening, contracts, and operational discipline for shipping `unsafe`-touching code.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `unsafeptr` analyzer source: https://cs.opensource.google/go/x/tools/+/master:go/analysis/passes/unsafeptr/unsafeptr.go
- Go memory model: https://go.dev/ref/mem
- `runtime.Pinner` proposal (#46787): https://github.com/golang/go/issues/46787
- `runtime.KeepAlive` docs: https://pkg.go.dev/runtime#KeepAlive
- `-d=checkptr` documentation: https://github.com/golang/go/issues/22218
- Sibling: [memory-management](../04-memory-management/)
