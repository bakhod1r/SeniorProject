# Unsafe Pointer — Interview Questions

A set of interview-style questions on Go's `unsafe.Pointer` semantics, with concise but complete answers. Questions cluster around: the six legal patterns, why `uintptr` is not a pointer, the modern API replacing `reflect.SliceHeader`/`StringHeader`, and the GC/runtime interactions that make the rules necessary.

---

## Q1. What is `unsafe.Pointer` and why does Go have it?

`unsafe.Pointer` is Go's generic pointer type. It's the only type that can be converted to/from any other pointer type and to/from `uintptr`. Go has it because some operations — interfacing with C, doing zero-copy `[]byte`↔`string` conversion, walking custom memory layouts — fundamentally require breaking type safety, and `unsafe.Pointer` is the controlled escape hatch. Without it, the runtime, `reflect`, and `syscall` packages couldn't be implemented in Go.

---

## Q2. List the four basic `unsafe.Pointer` conversions allowed by the language.

1. `*T` → `unsafe.Pointer` — lift a typed pointer.
2. `unsafe.Pointer` → `*T` — lower to a typed pointer.
3. `unsafe.Pointer` → `uintptr` — extract the address as an integer.
4. `uintptr` → `unsafe.Pointer` — re-cast the integer back to a pointer.

These are syntactic permissions. The doc page lists the six **patterns** that combine them legally; everything else is undefined behaviour.

---

## Q3. List the six legal patterns from the `unsafe.Pointer` doc.

1. Conversion of `*T1` to `*T2` (re-view the same memory through a different type).
2. Conversion of `unsafe.Pointer` to `uintptr` (one-way, for printing/comparing only).
3. Conversion of `unsafe.Pointer` to `uintptr` and back **as one expression**, with arithmetic, for pointer arithmetic.
4. Conversion of an `unsafe.Pointer` to `uintptr` when calling `syscall.Syscall`.
5. Conversion of the result of `reflect.Value.Pointer` or `UnsafeAddr` from `uintptr` to `unsafe.Pointer` in the same expression.
6. Conversion of `reflect.SliceHeader.Data` / `StringHeader.Data` to/from `unsafe.Pointer` (deprecated since Go 1.20).

Anything outside these six is undefined.

---

## Q4. Why is `uintptr` not a pointer?

Because the garbage collector doesn't see it. The compiler emits a pointer map for every type: 1 bit per word, set if the word holds a pointer. `*T` and `unsafe.Pointer` get bit 1; `uintptr` gets bit 0. The GC follows only the 1-bit words. So a heap object reachable *only* via a `uintptr` is collectible right now, even though the integer value still "is" its address.

The same applies to stack-grow: when a goroutine's stack moves, the runtime rewrites typed pointers on the stack to point at the new locations. `uintptr` values are not rewritten — they still hold the old address.

---

## Q5. What's wrong with this code?

```go
p := unsafe.Pointer(&x)
u := uintptr(p)
runtime.GC()
p2 := unsafe.Pointer(u)
```

The `uintptr u` is held across the `runtime.GC()` call. If `x` was heap-allocated and lost its last typed pointer, the GC can free it; `u` doesn't keep it alive. Even without an explicit `runtime.GC()`, a stack-grow or implicit GC between the two casts can move or free the object. `p2` is then dangling. `go vet` flags this with the `unsafeptr` analyzer.

---

## Q6. How do you correctly do pointer arithmetic in modern Go?

Use `unsafe.Add` (Go 1.17+):

```go
p2 := unsafe.Add(p, 8)
```

This advances `p` by 8 bytes and returns the new `unsafe.Pointer`. The compiler/runtime treat the result as a real pointer; no `uintptr` is exposed to user code, so the GC and stack-grow rewriting work correctly.

The pre-1.17 form `unsafe.Pointer(uintptr(p) + 8)` is still valid but must be a single expression — splitting it across statements is undefined.

---

## Q7. Why is `unsafe.Add(p, n)` safer than `unsafe.Pointer(uintptr(p) + n)`?

Both compile to the same arithmetic, but `unsafe.Add` is recognized by the compiler as a single intrinsic. There's no point at which the address exists in user-code as a `uintptr` — the conversion happens internally. The user never has the opportunity to assign it to a variable, pass it to a function, or hold it across a statement. `unsafeptr` analyzer understands it; `unsafe.Pointer(uintptr(p) + n)` works only when the analyzer can pattern-match the *whole expression*, which can fail when the arithmetic is dynamic.

---

## Q8. What replaces `reflect.SliceHeader` and `reflect.StringHeader` in Go 1.20+?

`unsafe.Slice`, `unsafe.SliceData`, `unsafe.String`, and `unsafe.StringData`.

| Old pattern | New equivalent |
|-------------|----------------|
| Construct a string from `(ptr, len)` via `StringHeader` | `unsafe.String(ptr, len)` |
| Construct a slice from `(ptr, len)` via `SliceHeader` | `unsafe.Slice(ptr, len)` |
| Get the data pointer of a string | `unsafe.StringData(s)` |
| Get the data pointer of a slice | `unsafe.SliceData(s)` |

The old types had a `Data uintptr` field — a `uintptr` exposed as if it were a pointer. The new API uses real `*byte` / `*T` everywhere and removes that trap. `reflect.SliceHeader` and `reflect.StringHeader` are now deprecated (1.20) and trigger `staticcheck SA1019`.

---

## Q9. Write a zero-copy `bytesToString`.

```go
func bytesToString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

The caller must not mutate `b` after calling this — mutating violates the immutability contract that consumers of `string` assume. The lifetime of the returned string is bounded by `b`'s lifetime; if `b` becomes unreachable, the bytes can be GC'd.

The non-`unsafe` alternative is `string(b)`, which allocates and copies.

---

## Q10. Write a zero-copy `stringToBytes`.

```go
func stringToBytes(s string) []byte {
    if s == "" {
        return nil
    }
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

The caller must not mutate the returned slice — writing through it corrupts the string's backing bytes and breaks any other `string` that shares the same backing array (string interning, slicing). It is correct for reading-only paths.

---

## Q11. What does `unsafe.Sizeof` return for a string and a slice?

| Type | `Sizeof` on 64-bit |
|------|-------------------|
| `string` | 16 (data pointer + length) |
| `[]T` (any T) | 24 (data pointer + length + capacity) |
| `map[K]V` | 8 (single map pointer) |
| `interface{}` | 16 (type word + data word) |

The numbers are header sizes. The actual data (the string's bytes, the slice's array, the map's contents) is reached through the header's data pointer and is not counted by `Sizeof`.

---

## Q12. What does the `unsafeptr` go vet analyzer check?

Three syntactic patterns:

1. `unsafe.Pointer(x)` where `x` is `uintptr` and did not originate as `uintptr(unsafe.Pointer(...))` in the same expression.
2. Arithmetic on `uintptr` that doesn't follow the documented forms (e.g., random additions, not `unsafe.Sizeof`-derived).
3. The result of `reflect.Value.Pointer` / `UnsafeAddr` being stored in a variable before being converted to `unsafe.Pointer`.

It does **not** check alignment, bounds, lifetime, escape, or concurrency. Those require `-d=checkptr`, `-race`, manual review, or fuzz testing.

---

## Q13. What does the `-d=checkptr` runtime flag do?

It inserts runtime checks around `unsafe.Pointer` operations:

- Verifies alignment when casting `unsafe.Pointer` to `*T`.
- Verifies `unsafe.Slice(p, n)` and `unsafe.String(p, n)` don't overflow.
- With `-race`, verifies the address falls within a known Go heap object.

On failure the program aborts with `fatal error: checkptr: ...`. Use in CI for `unsafe`-heavy code; the runtime cost (5–30 %) is too high for production.

Enable: `go test -gcflags="all=-d=checkptr" ./...`. Auto-enabled by `-race`.

---

## Q14. What's the special case for `syscall.Syscall`?

The signature is:

```go
func Syscall(trap, a1, a2, a3 uintptr) (r1, r2 uintptr, err Errno)
```

When you pass `uintptr(unsafe.Pointer(&x))` as one of the arguments, the compiler recognizes the pattern and inserts a keepalive: `x` stays live for the duration of the syscall, even though the address has been converted to `uintptr`.

This special treatment is hardcoded to specific function names (`syscall.Syscall`, `Syscall6`, `SyscallN`, `RawSyscall`, etc.). Custom wrappers do **not** inherit it; you must add `runtime.KeepAlive(x)` explicitly after the call.

---

## Q15. What is `runtime.KeepAlive` and when do you need it?

`runtime.KeepAlive(x)` is a no-op at runtime but tells the compiler that `x` must be considered live up to the call site. Without it, escape analysis may conclude `x`'s last use was before the call site and free it.

Needed in three situations:

1. Wrapping a syscall (the compiler's special-case doesn't apply to wrappers).
2. Passing a pointer to a C function via cgo when the C code may execute concurrently.
3. Using `runtime.SetFinalizer` and needing the finalized object to live until a specific point.

---

## Q16. What is `runtime.Pinner` (Go 1.21+) and what does it solve?

`runtime.Pinner` lets you mark a Go-allocated object as "must not move, must not be collected" until you call `Unpin`. Cgo's pointer-passing rules forbid C from retaining pointers to Go memory because the GC may move/free; `Pinner` is the exception that makes retention safe.

```go
var p runtime.Pinner
defer p.Unpin()
p.Pin(&buf[0])
C.someAsyncFunc(unsafe.Pointer(&buf[0]))
```

Before 1.21 the workaround was `C.malloc` + copy. `Pinner` removes the copy.

---

## Q17. Why does `unsafe.Pointer` interact with escape analysis?

When the compiler sees `unsafe.Pointer(&x)`, it can't reason about how the pointer will be used (the user might cast it to any type, do arithmetic, store it). So escape analysis falls back to the conservative answer: `x` escapes to the heap.

Practical effect: `unsafe.Pointer` can make code *slower* by forcing heap allocation that wouldn't otherwise happen. Always benchmark before assuming an `unsafe` trick wins.

---

## Q18. How does `unsafe.Pointer` interact with the race detector?

`-race` tracks memory by address, not by type. If two goroutines access the same memory concurrently — through whatever types — and at least one is a write, it's a race. `unsafe.Pointer` aliasing doesn't fool the detector. Re-typing a `[]byte` as a `[]uint32` and writing through the latter while another goroutine reads through the former is a race the detector will catch.

The implication: re-typed aliased memory needs the same synchronization as any other shared memory.

---

## Q19. What happens to a `*T` if `T` contains an `unsafe.Pointer` field?

The struct's pointer map has a `1` bit for the `unsafe.Pointer` field. The GC follows it, keeps whatever it points to alive, and rewrites it during stack-grow if it points into a stack.

If `T` contains a `uintptr` field instead, the GC ignores it. So a struct with `uintptr` storing an address is one of the most common ways to accidentally lose memory.

---

## Q20. Is misalignment a problem on amd64? On arm64?

Different stories:

- **amd64**: Misaligned reads/writes work but are slow. CPU splits the access into two cache-line operations. Not a correctness bug.
- **arm64** (including Apple Silicon and AWS Graviton): Misaligned access to `int64` / `uint64` can fault with `SIGBUS`. Correctness bug.

This is one of the most common "works on Mac in dev, crashes in Graviton in prod" patterns. Always allocate with `make([]T, N)` for the target type (which gives correct alignment) rather than slicing into `[]byte` at arbitrary offsets and re-typing.

---

## Q21. Show a vet-clean version of "advance a pointer through an array".

```go
type Item struct { X int32 }

func sum(items []Item) int32 {
    var s int32
    p := unsafe.Pointer(&items[0])
    for i := 0; i < len(items); i++ {
        elem := (*Item)(unsafe.Add(p, uintptr(i)*unsafe.Sizeof(Item{})))
        s += elem.X
    }
    return s
}
```

`unsafe.Add(p, uintptr(i)*unsafe.Sizeof(Item{}))` is the modern way. `unsafeptr` accepts it.

(In practice the safe version `for _, it := range items { s += it.X }` is the same speed because the compiler optimizes range loops well; the unsafe version is rarely worth it.)

---

## Q22. What happens if I pass a `nil` pointer to `unsafe.Slice`?

| `len` | Behaviour |
|-------|-----------|
| 0 | Returns `nil` |
| > 0 | Panics: `unsafe.Slice: ptr is nil and len is not zero` |
| < 0 | Panics: `unsafe.Slice: len out of range` |

Same shape for `unsafe.String(nil, n)`. The panics are documented (Go 1.17 introduced `Slice`; 1.22 tightened the checks).

---

## Q23. Why is `reflect.Value.UnsafePointer()` preferred over `reflect.Value.Pointer()`?

`Pointer()` returns `uintptr`. The user must immediately convert to `unsafe.Pointer` in the same expression (Pattern 5), but this is easy to get wrong. `UnsafePointer()` returns `unsafe.Pointer` directly, eliminating the dangerous `uintptr` step.

Added in Go 1.18. New code should always use `UnsafePointer()`.

---

## Q24. What's wrong with this cgo code?

```go
buf := make([]byte, 1024)
C.async_callback(unsafe.Pointer(&buf[0]))
return
```

`async_callback` may store the pointer for later. After this function returns, the Go runtime may move or free `buf`. The C code's stored pointer is then dangling.

The fix is `runtime.Pinner`:

```go
buf := make([]byte, 1024)
var p runtime.Pinner
p.Pin(&buf[0])
// Caller is responsible for calling p.Unpin() when the C side is done.
C.async_callback(unsafe.Pointer(&buf[0]))
```

For synchronous C calls, `runtime.KeepAlive(buf)` after the call is sufficient.

---

## Q25. Why is the `unsafe` package excluded from the Go 1 compatibility promise?

Because the rules describe the runtime's contract with itself, not a stable user-facing API. Improvements to the GC (compaction, new allocator strategies), changes to struct layout (better packing), and changes to escape analysis can all interact with `unsafe` code in ways the compatibility promise can't predict.

In practice the six patterns have been stable since they were documented. New APIs (`unsafe.Add`, `Slice`, `String`) have only ever *added* valid usages. But the explicit exclusion lets the Go team tighten things if a future change demands it.

---

## Q26. How would you write a struct-field accessor without naming the field?

```go
type T struct {
    a int32
    b int64
}

func getB(t *T) int64 {
    return *(*int64)(unsafe.Add(unsafe.Pointer(t), unsafe.Offsetof(T{}.b)))
}
```

`unsafe.Offsetof` is a compile-time constant (the offset of `b` within `T`'s layout). `unsafe.Add` advances the pointer by that many bytes. The result is cast back to `*int64`.

In real code, just write `t.b`. The accessor is useful for unexported fields of *other* packages, or in code-generated marshalers.

---

## Q27. What's the alignment of a `struct{ a bool; b int64 }`?

Alignment is the max of fields' alignments: `Alignof(bool) = 1`, `Alignof(int64) = 8`, so the struct's alignment is **8**. Total size includes padding: 1 byte for `a`, 7 bytes of padding, 8 bytes for `b`, total **16 bytes**. Confirm with:

```go
type T struct { a bool; b int64 }
unsafe.Sizeof(T{})   // 16
unsafe.Alignof(T{})  // 8
unsafe.Offsetof(T{}.b) // 8
```

Reorder fields by descending alignment to reduce padding: `struct{ b int64; a bool }` is **9 bytes occupied, 16 bytes total** (trailing padding for arrays), same total but the field order matters when embedding.

---

## Q28. Can you store an `unsafe.Pointer` in an `interface{}`?

Yes. `interface{}` stores any value, including `unsafe.Pointer`. The interface's data word holds the pointer; the type word identifies it as `unsafe.Pointer`. The GC follows it normally because the type word tells the runtime that the data word is a pointer.

```go
p := unsafe.Pointer(&x)
var i interface{} = p
back := i.(unsafe.Pointer)   // works
```

Not particularly useful in practice but legal.

---

## Q29. What is the `noescape` runtime trick?

A function in `runtime/`:

```go
//go:nosplit
//go:nocheckptr
func noescape(p unsafe.Pointer) unsafe.Pointer {
    x := uintptr(p)
    return unsafe.Pointer(x ^ 0)
}
```

The XOR-by-zero is a no-op at runtime, but the round-trip through `uintptr` defeats escape analysis: the compiler can't trace the input's lifetime through the cast, so it can't conclude that the input escapes. This is used inside `sync.Pool` and similar runtime hot paths to keep objects stack-allocated.

**Don't use in application code.** It deliberately violates the "uintptr is not a pointer" rule and works only because of careful runtime cooperation.

---

## Q30. What's the canonical CI gate for an `unsafe`-touching package?

```bash
go vet ./...                                         # catches obvious unsafeptr misuse
go test ./...                                        # behaviour
go test -race ./...                                  # concurrent aliasing
go test -gcflags="all=-d=checkptr" ./...             # alignment, bounds, validity
go test -fuzz=. -fuzztime=60s ./unsafepath/...       # input-driven misuse
```

Plus `staticcheck` with `SA1019` enabled to catch `reflect.SliceHeader` / `StringHeader` usage. Combined coverage catches the vast majority of `unsafe.Pointer` bugs before they ship.

---

## Q31. Summary

The recurring themes: the six legal patterns are non-negotiable; `uintptr` is invisible to the GC and stack-grow rewriting; the modern `unsafe.Add`/`Slice`/`String`/`StringData`/`SliceData` API has obsoleted manual `reflect.SliceHeader`/`StringHeader` tricks; vet, `-race`, and `-d=checkptr` together form the dynamic checker but none of them catch lifetime bugs; `runtime.KeepAlive` and `runtime.Pinner` handle the cgo and syscall corner cases. Master these and you've mastered Go's escape hatch.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `unsafeptr` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/unsafeptr
- `runtime.Pinner`: https://pkg.go.dev/runtime#Pinner
- `runtime.KeepAlive`: https://pkg.go.dev/runtime#KeepAlive
- `reflect.Value.UnsafePointer`: https://pkg.go.dev/reflect#Value.UnsafePointer
- Related: [pointers-basics](../01-pointers-basics/)
- Related: [unsafe-package](../../../11-advanced-topics/04-unsafe-package/)
