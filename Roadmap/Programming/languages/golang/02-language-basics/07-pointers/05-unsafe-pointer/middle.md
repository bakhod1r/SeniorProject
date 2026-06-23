# Unsafe Pointer — Middle

## 1. Recap and what changes here

The [junior file](junior.md) introduced `unsafe.Pointer`, the cardinal rule that `uintptr` is not a pointer, and the existence of six valid patterns. This file walks all six patterns with worked, runnable examples; covers the new APIs added in Go 1.17 (`unsafe.Add`, `unsafe.Slice`) and Go 1.20 (`unsafe.String`, `unsafe.StringData`, `unsafe.SliceData`); and explains exactly what `go vet` does and does not catch.

By the end you should be able to write `unsafe`-using code that passes `go vet`, executes correctly under the race detector, and survives both heap- and stack-allocated inputs.

---

## 2. Pattern 1 in detail — re-typing a pointer

The simplest valid use of `unsafe.Pointer`: take a `*T1`, view its bytes as `*T2`.

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var i int64 = 0x4142434445464748
    bs := *(*[8]byte)(unsafe.Pointer(&i))
    fmt.Printf("%c %c %c %c %c %c %c %c\n",
        bs[0], bs[1], bs[2], bs[3], bs[4], bs[5], bs[6], bs[7])
}
// On little-endian amd64: H G F E D C B A
```

The rule, paraphrased from the [doc](https://pkg.go.dev/unsafe#Pointer):

> A pointer to one type can be converted to a pointer to another type. The result is a `*T2` that uses the same memory as the original `*T1`. The sizes need not match, but if the second is larger than the first you must be sure the memory really extends that far.

Three concrete consequences:

1. **Size matters.** `(*[16]byte)(unsafe.Pointer(&x))` where `x` is an `int64` is **invalid** — you'd be claiming 16 bytes of memory but only 8 exist. Read past `&x` gives garbage; write past it corrupts whatever's next.
2. **Alignment matters.** Re-viewing a `*byte` as a `*int64` requires the byte to be 8-byte aligned. On x86 misalignment is silently slow; on ARM it can fault. See §10.
3. **Aliasing must respect compiler assumptions.** Writing through one view and reading through another in the same goroutine is fine; doing so across goroutines without synchronization is a data race even though the types look unrelated.

A canonical zero-allocation use: viewing the bytes of a fixed-size struct for hashing.

```go
type Header struct {
    Magic   uint32
    Version uint16
    Flags   uint16
    Length  uint64
}

func bytesOf(h *Header) []byte {
    return unsafe.Slice((*byte)(unsafe.Pointer(h)), unsafe.Sizeof(*h))
}

func crc(h *Header) uint32 {
    return crc32.ChecksumIEEE(bytesOf(h))
}
```

`unsafe.Slice` (introduced in 1.17) is exactly the right primitive here. We re-type a `*Header` to `*byte` and produce a 16-byte slice over it.

---

## 3. The modern API: `Add`, `Slice`, `String`, `SliceData`, `StringData`

Before Go 1.17, walking through memory at byte offsets required the awkward `unsafe.Pointer(uintptr(p) + n)` dance. Go 1.17 added `unsafe.Add`. Go 1.20 added the string-and-slice-data quartet that obsoletes `reflect.SliceHeader` and `reflect.StringHeader`.

| Function | Since | Replaces |
|----------|-------|----------|
| `unsafe.Add(p, n)` | 1.17 | `unsafe.Pointer(uintptr(p) + uintptr(n))` |
| `unsafe.Slice(p, n)` | 1.17 | Manual `reflect.SliceHeader{Data: uintptr(p), Len: n, Cap: n}` |
| `unsafe.String(p, n)` | 1.20 | Manual `reflect.StringHeader{Data: uintptr(p), Len: n}` |
| `unsafe.StringData(s)` | 1.20 | `(*reflect.StringHeader)(unsafe.Pointer(&s)).Data` |
| `unsafe.SliceData(s)` | 1.20 | `(*reflect.SliceHeader)(unsafe.Pointer(&s)).Data` (with cap fix) |

### 3.1 `unsafe.Add`

```go
// signature: func Add(ptr Pointer, len IntegerType) Pointer
p := unsafe.Pointer(&arr[0])
p2 := unsafe.Add(p, 16)   // advance 16 bytes
```

The second argument can be any integer type. The result is the new pointer. Unlike the manual `uintptr` arithmetic, `unsafe.Add` is a single expression, so the GC sees the pointer live throughout — no "moved-between-cast-and-cast-back" hazard.

### 3.2 `unsafe.Slice`

```go
// signature: func Slice(ptr *ArbitraryType, len IntegerType) []ArbitraryType
arr := [4]int32{10, 20, 30, 40}
s := unsafe.Slice(&arr[0], 4)
fmt.Println(s)   // [10 20 30 40]
```

`unsafe.Slice` builds a slice header that points at `len` consecutive elements starting at `ptr`. Three error cases panic at runtime:

- `ptr == nil && len != 0` — nil pointer with nonzero length.
- `len < 0` — negative length.
- `len * sizeof(T)` overflows `uintptr` — pathological.

All three are panics, not undefined behaviour. That's a contract worth knowing.

### 3.3 `unsafe.String`

```go
// signature: func String(ptr *byte, len IntegerType) string
b := []byte("hello")
s := unsafe.String(&b[0], len(b))
fmt.Println(s)   // hello — but s and b share memory
```

Same shape as `unsafe.Slice` but produces a `string`. Same panic conditions.

### 3.4 `unsafe.StringData` and `unsafe.SliceData`

These extract the underlying data pointer from a string/slice header:

```go
func bytesToString(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func stringToBytes(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

`unsafe.SliceData` is interestingly subtle. For a non-empty slice, it returns `&s[0]`. For an empty slice (`len(s) == 0`) it returns either `nil` (if the slice itself is nil) or some non-nil pointer to the backing array if one exists. The doc lays this out exactly; don't guess.

---

## 4. Pattern 2 in detail — `uintptr` for offset arithmetic

The rule: conversion to `uintptr` and back must be **a single expression**.

```go
// LEGAL — one expression
p2 := unsafe.Pointer(uintptr(p) + offset)

// ILLEGAL — uintptr held across statements
u := uintptr(p)
// ... possibly any other code ...
p2 := unsafe.Pointer(u + offset)   // u may now dangle
```

Why? Between the two statements, the garbage collector can run; if `p` pointed into a stack frame, that frame may have been moved by a stack-grow; if it was a heap object that's no longer reachable, it may have been freed; if it was a heap object that was moved (Go doesn't compact today, but the rules are written with the option in mind), the address in `u` is stale.

`go vet`'s `unsafeptr` analyzer flags the second form. The first form it accepts because it's syntactically the documented pattern.

The modern alternative is `unsafe.Add`, which is just a typed function call:

```go
p2 := unsafe.Add(p, offset)   // same meaning, GC-safe by construction
```

For new code, prefer `unsafe.Add`. The single-expression `uintptr` arithmetic remains valid for cases where you're not adding a byte count — e.g., bit-masking the low bits of an address for alignment checks — but those are rare.

---

## 5. Pattern 3 in detail — accessing a struct field by offset

You can compute the address of an unexported field of another package's struct without naming it directly:

```go
type Hidden struct {
    pub int
    // unexported, but the runtime layout is fixed
    secret int64
}

h := Hidden{pub: 1}

// Address of h.secret without referring to it by name
sp := (*int64)(unsafe.Add(unsafe.Pointer(&h), unsafe.Offsetof(h.secret)))
*sp = 42
fmt.Println(h)   // {1 42}
```

This is the trick libraries like [`go-spew`](https://github.com/davecgh/go-spew) use to inspect private state for debugging. It's also how `reflect`'s `value.go` reaches into struct fields under the hood.

`unsafe.Offsetof` is a compile-time constant. The expression `unsafe.Offsetof(h.secret)` is replaced at compile time with the byte offset. It does **not** evaluate `h.secret` at runtime — it just reads the field's position in the type's memory layout.

The replacement for the older `(*int64)(unsafe.Pointer(uintptr(unsafe.Pointer(&h)) + unsafe.Offsetof(h.secret)))` is `(*int64)(unsafe.Add(unsafe.Pointer(&h), unsafe.Offsetof(h.secret)))`. Both are valid; the second is shorter and reads more clearly.

---

## 6. Pattern 4 — calling `syscall.Syscall`

Some syscall functions have signatures like:

```go
func Syscall(trap, a1, a2, a3 uintptr) (r1, r2 uintptr, err Errno)
```

So when you pass a pointer to a syscall, you have to convert it to `uintptr`:

```go
n, _, e := syscall.Syscall(
    syscall.SYS_WRITE,
    uintptr(fd),
    uintptr(unsafe.Pointer(&buf[0])),
    uintptr(len(buf)),
)
```

This violates the "uintptr is not a pointer" rule — except that the compiler has a special case for `syscall.Syscall` (and friends): it recognizes the pattern `uintptr(unsafe.Pointer(x))` in a syscall argument list and guarantees `x` stays live for the duration of the call.

**This special case is hard-coded to specific function names** in `runtime/syscall*.go` and `cmd/compile/internal/escape/escape.go`. You cannot replicate it with a wrapper:

```go
// BAD — the compiler doesn't know mySyscall is special
func mySyscall(trap, a1, a2 uintptr) uintptr { ... }

n := mySyscall(SYS_WRITE, uintptr(fd), uintptr(unsafe.Pointer(&buf[0])))
// The pointer may be GC'd before mySyscall returns
```

The fix in the wrapper case is `runtime.KeepAlive`:

```go
n := mySyscall(SYS_WRITE, uintptr(fd), uintptr(unsafe.Pointer(&buf[0])))
runtime.KeepAlive(buf)   // tells the compiler buf is alive at this point
```

`runtime.KeepAlive` is a no-op at runtime; it's purely a compile-time signal that the named variable must be considered live up to this statement. See [senior.md](senior.md) §6 for more on `KeepAlive`.

---

## 7. Pattern 5 — `reflect.Value.Pointer` and `UnsafeAddr`

```go
v := reflect.ValueOf(&someStruct)
p := unsafe.Pointer(v.Elem().Field(0).UnsafeAddr())
```

`UnsafeAddr` returns a `uintptr`. The conversion to `unsafe.Pointer` **must** happen in the same expression. Don't do this:

```go
addr := v.UnsafeAddr()
// ... GC could run ...
p := unsafe.Pointer(addr)   // BUG: addr may dangle
```

Modern reflect has `v.Addr().UnsafePointer()` (added in Go 1.18) which returns an `unsafe.Pointer` directly and avoids the dance entirely. Prefer it.

---

## 8. Pattern 6 — `SliceHeader` and `StringHeader` (legacy)

Up to Go 1.20, the canonical way to alias a slice's backing array as a string was:

```go
// Legacy — works but deprecated since 1.20
sh := (*reflect.SliceHeader)(unsafe.Pointer(&b))
sh2 := reflect.StringHeader{Data: sh.Data, Len: sh.Len}
s := *(*string)(unsafe.Pointer(&sh2))
```

This pattern lives in millions of lines of pre-1.20 code. The doc page now says:

> SliceHeader is the runtime representation of a slice. ... Deprecated: Use `unsafe.Slice` or `unsafe.SliceData` instead.

The new pattern:

```go
s := unsafe.String(unsafe.SliceData(b), len(b))
```

Why deprecate? `SliceHeader.Data` is `uintptr` — and storing the slice's backing pointer in a `uintptr` field violates the "no pointer in uintptr" rule. The runtime worked because the compiler had a special exemption, but the type's existence misleads users into believing they can compute with `Data` like a number. They can't. The new API uses `unsafe.Pointer` everywhere and removes the trap.

If you maintain pre-1.20 code, the modern replacements are mechanical:

| Old | New |
|-----|-----|
| `(*reflect.SliceHeader)(unsafe.Pointer(&b)).Data` | `uintptr(unsafe.Pointer(unsafe.SliceData(b)))` |
| `(*reflect.StringHeader)(unsafe.Pointer(&s)).Data` | `uintptr(unsafe.Pointer(unsafe.StringData(s)))` |
| Manually building a SliceHeader | `unsafe.Slice(p, n)` |
| Manually building a StringHeader | `unsafe.String(p, n)` |

---

## 9. What `go vet`'s `unsafeptr` analyzer checks

The analyzer source is at `golang.org/x/tools/go/analysis/passes/unsafeptr/unsafeptr.go`. It catches three categories:

1. **Conversion from `uintptr` to `unsafe.Pointer` where the `uintptr` did not originate as `unsafe.Pointer` in the same expression**. The flag pattern is `unsafe.Pointer(arithmeticExpression)` where the expression is not "a `uintptr` cast of an `unsafe.Pointer`, possibly with `unsafe.Sizeof` / `Alignof` / `Offsetof` added or multiplied".

2. **Anything that doesn't look like the documented patterns**. The analyzer is *pattern-matching*; if your code does the right thing in a way the analyzer doesn't recognize, you'll get a false positive. (Rare in practice.)

3. **The legacy `reflect.SliceHeader` / `StringHeader` manipulations are NOT flagged** — they predate the analyzer and were grandfathered. The new `unsafe.Slice`/`String` pattern is what `vet` is built around.

What `unsafeptr` does **not** catch:

| Missed case | Why |
|-------------|-----|
| Misalignment (re-viewing a `*byte` as a `*int64` on unaligned memory) | The analyzer reasons about syntactic patterns, not runtime values |
| Lifetime: passing `unsafe.Pointer(&x)` to a function that retains it past `x`'s scope | Lifetime analysis is escape analysis, not vet |
| Out-of-bounds via `unsafe.Add` | The argument can be any integer; vet doesn't know if it's in range |
| Wrong size in pattern 1 (re-typing a `*T1` to a `*T2` where `sizeof(T2) > sizeof(T1)`) | The compiler doesn't enforce this either; you must be sure manually |
| Cross-goroutine data races on aliased memory | That's `-race`'s job, not `vet`'s |

Run `go vet -unsafeptr ./...` explicitly; the analyzer is in the default set but it's worth knowing the flag.

---

## 10. Alignment — the rule the doc glosses over

The doc says:

> The size or alignment of an object is not specified; do not assume any specific layout.

What this means in practice:

- `unsafe.Alignof(int64(0))` is 8 on amd64. So `*int64` reads/writes require 8-byte-aligned addresses.
- `unsafe.Alignof(int32(0))` is 4. So `*int32` requires 4-byte alignment.
- A `*byte` has alignment 1, so any address is a valid `*byte`.

Re-typing a pointer means inheriting the new type's alignment requirement. If you take a `*byte` at address `0x1003` and cast it to `*int64`, the resulting pointer is misaligned. On amd64 you get a slow load; on ARM, a SIGBUS.

The safe pattern:

```go
buf := make([]byte, 16)
// guarantee 8-byte alignment by using a typed allocation
nums := unsafe.Slice((*int64)(unsafe.Pointer(&buf[0])), 2)
```

`make([]byte, N)` for N ≥ 8 returns memory aligned to at least 8 bytes (the Go allocator's minimum) — so this works. But:

```go
buf := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9}
nums := unsafe.Slice((*int64)(unsafe.Pointer(&buf[1])), 1)   // BUG: &buf[1] is 1-byte aligned
```

Now `&buf[1]` may be at an odd address; on ARM this crashes.

For 64-bit atomics (`sync/atomic.AddInt64` etc.), the `Uint64`/`Int64` type itself (introduced in 1.19) takes care of alignment. For bare `*int64` you must guarantee alignment yourself. See [atomic-internals](../../../09-concurrency/04-sync-and-atomic/) for the historical reasons.

---

## 11. A complete worked example — fixed-size buffer reader

A zero-copy reader for a binary header format:

```go
package main

import (
    "encoding/binary"
    "fmt"
    "unsafe"
)

type Packet struct {
    Magic    uint32
    Version  uint16
    Flags    uint16
    Payload  uint64
}

// readPacket parses bytes into a *Packet without copying.
// Caller must keep buf alive while using the returned *Packet.
func readPacket(buf []byte) (*Packet, error) {
    const sz = unsafe.Sizeof(Packet{})
    if uintptr(len(buf)) < sz {
        return nil, fmt.Errorf("short buffer: got %d, want %d", len(buf), sz)
    }
    // Alignment: we need 8-byte alignment for Payload (uint64). make([]byte, N) on a
    // typical Go allocator is at least pointer-aligned (8 on 64-bit), so this is OK
    // for buffers from make. Be careful with slices of caller-provided memory.
    if uintptr(unsafe.Pointer(&buf[0]))%unsafe.Alignof(Packet{}) != 0 {
        return nil, fmt.Errorf("buffer not aligned to %d bytes", unsafe.Alignof(Packet{}))
    }
    return (*Packet)(unsafe.Pointer(&buf[0])), nil
}

func main() {
    buf := make([]byte, unsafe.Sizeof(Packet{}))
    binary.LittleEndian.PutUint32(buf[0:4], 0xCAFEBABE)
    binary.LittleEndian.PutUint16(buf[4:6], 1)
    binary.LittleEndian.PutUint16(buf[6:8], 0x80)
    binary.LittleEndian.PutUint64(buf[8:16], 42)

    p, err := readPacket(buf)
    if err != nil { panic(err) }
    fmt.Printf("%+v\n", *p)
}
```

This is correct, uses only documented patterns, passes `go vet`, and copies zero bytes. The caller-keeps-`buf`-alive contract is explicit in the doc comment — that's the kind of discipline that makes `unsafe` code maintainable.

---

## 12. When the `go vet` warning is right and you "know better"

Sometimes the analyzer flags code you believe is correct. The right response is almost always to rewrite the code in a form vet recognizes, not to suppress the warning. There is no `//nolint:unsafeptr` directive built into `go vet`; you'd be writing one yourself.

If after careful thought the code really is correct and there is no equivalent form that vet accepts, the convention is:

```go
// vet:nolint
// The uintptr round-trip is required here because <reason>.
// This pattern is safe because <argument>.
addr := uintptr(unsafe.Pointer(p))
// ... operations on addr ...
p2 := (*T)(unsafe.Pointer(addr))
```

Then run with `go vet -unsafeptr=false ./pkg/...` for that specific package in CI. **Don't disable `unsafeptr` globally.**

The number of times this is genuinely necessary in application code is approximately zero. If you're reaching for the suppression, double-check that you haven't missed a `unsafe.Add` or `runtime.KeepAlive`-shaped fix.

---

## 13. Summary

The six patterns are the only legal uses of `unsafe.Pointer`: type re-view, single-expression `uintptr` arithmetic, `unsafe.Add` for the same purpose, `syscall.Syscall` calls, `reflect.Value.Pointer`/`UnsafeAddr`, and the legacy `SliceHeader`/`StringHeader` round-trip. Go 1.17 introduced `unsafe.Add` and `unsafe.Slice` to replace error-prone arithmetic; Go 1.20 added `unsafe.String`, `unsafe.StringData`, and `unsafe.SliceData` to replace the legacy `reflect` headers, which are now deprecated. `go vet`'s `unsafeptr` analyzer catches the most common misuses (storing `uintptr` across statements, ad-hoc arithmetic) but misses misalignment, out-of-bounds, lifetime, and concurrency bugs. For those you rely on `-race`, `runtime.KeepAlive`, and your own discipline. The next file dives into why the rules exist: GC interaction, stack growth, and the compiler's escape analysis.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `unsafe.Add` proposal (#40481): https://github.com/golang/go/issues/40481
- `unsafe.Slice` proposal (#19367): https://github.com/golang/go/issues/19367
- `unsafe.String` / `StringData` / `SliceData` proposal (#53003): https://github.com/golang/go/issues/53003
- `unsafeptr` analyzer source: https://cs.opensource.google/go/x/tools/+/master:go/analysis/passes/unsafeptr/
- `reflect.SliceHeader` deprecation: https://pkg.go.dev/reflect#SliceHeader
- Sibling: [string-internals](../../02-data-types/07-string-internals/)
- Sibling: [slice-header-internals](../../03-composite-types/02-slices/05-slice-header-internals/)
