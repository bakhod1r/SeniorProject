# String Internals — Senior

## Table of Contents
1. [Introduction](#1-introduction)
2. [Source map](#2-source-map)
3. [The stringStruct layout in runtime](#3-the-stringstruct-layout-in-runtime)
4. [concatstrings and friends](#4-concatstrings-and-friends)
5. [slicebytetostring and rawstring](#5-slicebytetostring-and-rawstring)
6. [stringtoslicebyte and the noescape buffer](#6-stringtoslicebyte-and-the-noescape-buffer)
7. [The compiler-recognized conversion patterns](#7-the-compiler-recognized-conversion-patterns)
8. [Literal interning and the linker](#8-literal-interning-and-the-linker)
9. [Escape analysis on string conversions](#9-escape-analysis-on-string-conversions)
10. [Map-key fast paths](#10-map-key-fast-paths)
11. [internal/bytealg and SIMD](#11-internalbytealg-and-simd)
12. [Reflect, unsafe, and Go 1.20 changes](#12-reflect-unsafe-and-go-120-changes)
13. [Version history](#13-version-history)
14. [Summary](#14-summary)

---

## 1. Introduction

At the senior level you are expected to read the runtime sources, predict allocations from source code, and reason about the compiler's optimization passes that touch strings. This file walks the relevant files in the Go tree:

- `runtime/string.go` — string layout, conversion, concatenation.
- `runtime/map_faststr.go` — string map fast paths.
- `cmd/compile/internal/walk/order.go` and `walk/builtin.go` — compiler rewrites for `string(b)` patterns.
- `internal/bytealg/equal_*.s` — assembly implementations of `memequal`.
- `unsafe` package documentation for `String` and `StringData`.

Paths cited are inside the Go source tree (https://github.com/golang/go/tree/master/src).

---

## 2. Source map

```
runtime/
├── string.go              <-- core string helpers
├── slice.go               <-- slicebytetostring redirects here for the temp-buf variants
├── alg.go                 <-- string hash for map keys
├── map_faststr.go         <-- string-specialized map ops
└── iface.go               <-- convTstring boxes string into interface{}

internal/
└── bytealg/
    ├── equal_amd64.s      <-- memequal SIMD
    ├── equal_arm64.s
    └── compare_amd64.s    <-- strcmp-style for < > ordering

cmd/compile/internal/
├── walk/builtin.go        <-- lowering of string() and []byte()
└── walk/order.go          <-- the m[string(b)] and range string(b) rewrites
```

---

## 3. The stringStruct layout in runtime

`runtime/string.go` defines an internal mirror:

```go
type stringStruct struct {
    str unsafe.Pointer
    len int
}
```

This is what the compiler emits at every `string` value site. Two words. Identical to `reflect.StringHeader`'s layout, except `Data` is `uintptr` in `reflect` and `unsafe.Pointer` here — the latter is the one the GC understands as a pointer.

The runtime also defines `stringStructDWARF` for the debugger to render strings in `delve`:

```go
type stringStructDWARF struct {
    str *byte
    len int
}
```

Same layout, more debugger-friendly type.

Throughout the runtime, internal helpers receive bytes as `*byte` plus `int`, then assemble a `stringStruct` and reinterpret-cast it to `string`:

```go
func rawstring(size int) (s string, b []byte) {
    p := mallocgc(uintptr(size), nil, false)
    stringStructOf(&s).str = p
    stringStructOf(&s).len = size
    *(*slice)(unsafe.Pointer(&b)) = slice{p, size, size}
    return
}
```

`rawstring` is the single entry point for "give me a string of this size, and let me write into it as a `[]byte`". After returning, the runtime writes to `b` and the caller never touches `b` again — the string and the slice alias the same memory, but the alias is briefly used and discarded.

This pattern is used by `slicebytetostring`, `concatstrings`, and a handful of others. It is the only sanctioned in-runtime way to "mutate" a string's bytes, and it only happens during the millisecond between allocation and visibility.

---

## 4. concatstrings and friends

```go
// runtime/string.go
func concatstrings(buf *tmpBuf, a []string) string {
    idx := 0
    l := 0
    count := 0
    for i, x := range a {
        n := len(x)
        if n == 0 { continue }
        if l+n < l { throw("string concatenation too long") }
        l += n
        count++
        idx = i
    }
    if count == 0 { return "" }
    if count == 1 && (buf != nil || !stringDataOnStack(a[idx])) {
        return a[idx]   // single non-empty operand: return as-is
    }
    s, b := rawstringtmp(buf, l)
    for _, x := range a {
        copy(b, x)
        b = b[len(x):]
    }
    return s
}
```

Three observations:

1. **Empty operands are dropped** before allocation. `"" + s + "" + ""` returns `s` with zero allocation.
2. **Single non-empty operand is returned directly** when safe (no need to copy `s + ""`).
3. **`tmpBuf` is opportunistic.** If escape analysis proved the result doesn't escape and total length ≤ 32, the compiler passes a stack-allocated `tmpBuf` and `rawstringtmp` writes into it, **without `mallocgc`**.

The compiler generates calls to specialised variants for small arities:

```go
func concatstring2(buf *tmpBuf, a [2]string) string
func concatstring3(buf *tmpBuf, a [3]string) string
func concatstring4(buf *tmpBuf, a [4]string) string
func concatstring5(buf *tmpBuf, a [5]string) string
```

For `a + b` the compiler emits `concatstring2`; for six or more operands it falls back to `concatstrings(slice)`. The reason for the unrolled variants is to keep the argument list on registers (register ABI since Go 1.17) — slice headers in arguments are slower.

---

## 5. slicebytetostring and rawstring

The `[]byte` → `string` direction:

```go
// runtime/string.go
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) string {
    if n == 0 { return "" }
    if n == 1 {
        p := unsafe.Pointer(&staticuint64s[*ptr])
        if goarch.BigEndian { p = add(p, 7) }
        stringStructOf(&s).str = p
        stringStructOf(&s).len = 1
        return
    }
    var p unsafe.Pointer
    if buf != nil && n <= len(buf) {
        p = unsafe.Pointer(buf)
    } else {
        p = mallocgc(uintptr(n), nil, false)
    }
    stringStructOf(&s).str = p
    stringStructOf(&s).len = n
    memmove(p, unsafe.Pointer(ptr), uintptr(n))
    return
}
```

Two fast paths that surprise people:

- **`n == 0`** returns the constant empty string — no allocation.
- **`n == 1`** returns a string whose `Data` points into `runtime.staticuint64s`, a pre-built table of 256 single-byte strings indexed by the byte value. So `string([]byte{'a'})` does not allocate. This optimization landed in Go 1.13 and primarily benefits one-character keys in maps.

For `n >= 2`, the function uses the temp buffer if the compiler supplied one (escape-proven on-stack result), otherwise `mallocgc`.

The runtime symbol you will see in profiles is `runtime.slicebytetostring`. If it tops your `pprof`, you are converting too much; look for the producer of `[]byte` and consider whether the consumer could take `[]byte` directly, or whether the intermediate string is needed.

---

## 6. stringtoslicebyte and the noescape buffer

The reverse, `string` → `[]byte`:

```go
func stringtoslicebyte(buf *tmpBuf, s string) []byte {
    var b []byte
    if buf != nil && len(s) <= len(buf) {
        *buf = tmpBuf{}
        b = buf[:len(s)]
    } else {
        b = rawbyteslice(len(s))
    }
    copy(b, s)
    return b
}
```

Same temp-buffer story. The 32-byte threshold catches a lot of short-lived conversions, especially in JSON encoding where small string fields are turned into bytes for hashing or normalization.

---

## 7. The compiler-recognized conversion patterns

In `cmd/compile/internal/walk/order.go` and `walk/builtin.go`, the compiler inspects every `OCONV` (conversion) node where source is `[]byte` and destination is `string`. If the resulting string is used in one of these positions, it lowers to a specialised helper that **doesn't copy**:

| Source pattern | Lowered to | Allocates? |
|----------------|------------|------------|
| `m[string(b)]`, `m[string(b)] = ...` | `mapaccess1_faststr` / `mapassign_faststr` over `b`'s bytes | No |
| `string(b) == "lit"`, `string(b) == s2` | `memequal` over `b`'s bytes | No |
| `for i, c := range string(b)` | range over `b` with UTF-8 decoder | No |
| `len(string(b))` | `len(b)` | No |
| Everything else | `slicebytetostring` | Yes (or stack if small + non-escaping) |

The lowering relies on a helper called `slicebytetostringtmp`:

```go
func slicebytetostringtmp(ptr *byte, n int) string {
    // Build a string header pointing directly at the byte slice.
    // Caller guarantees the slice is not mutated while the string is in use.
    stringStructOf(&s).str = unsafe.Pointer(ptr)
    stringStructOf(&s).len = n
    return
}
```

The compiler emits this only when **it can prove the string won't be retained past the safe window**. If you take the result of `string(b)` and store it anywhere observable (a struct field, a map value, a return), the proof fails and the regular copying `slicebytetostring` is emitted instead.

This is why **assigning the result to a variable defeats the optimization** even though the program looks equivalent:

```go
// optimized
if _, ok := m[string(b)]; ok { ... }

// not optimized - allocates
k := string(b)
if _, ok := m[k]; ok { ... }
```

In the second form, `k` outlives the immediate use and escape analysis must assume it could outlive `b`. The copy must happen for safety.

---

## 8. Literal interning and the linker

String literals are emitted into a `.rodata` section (or `.gostring` for Go-specific tagging). The linker performs **deduplication**:

- Identical literal byte sequences across the whole program share one storage.
- The `string` header for each occurrence is filled with the same `Data` pointer and `Len`.

You can inspect this with the linker map or `nm`:

```bash
go tool nm -size ./binary | grep '\.rodata' | head
go tool nm -size ./binary | grep 'go:string' | head
```

There is no runtime "intern these strings" operation. Interning is purely a compile-time decision for literals. If you want runtime interning (deduplicating strings constructed at runtime from network input), you have to implement it yourself with a `map[string]string` lookup before retaining.

The runtime does **not** intern strings produced from byte slices, concatenations, or `fmt.Sprintf`. Each call returns a fresh backing array.

---

## 9. Escape analysis on string conversions

The escape analyser in `cmd/compile/internal/escape` treats string-related allocations specially. Some observable behaviours:

```go
func a(b []byte) {
    _ = string(b)            // does not escape; no allocation
}

func b(b []byte) string {
    return string(b)         // escapes (return value); allocates
}

func c(b []byte) {
    s := string(b)
    fmt.Println(s)           // s escapes into the empty interface; allocates
}

func d(b []byte) bool {
    return string(b) == "GET"   // does not escape; no allocation
}
```

Print this with `-gcflags='-m'`:

```bash
go build -gcflags='-m' ./pkg
# ./file.go:12:11: string(b) escapes to heap
```

A useful diagnostic flag is `-gcflags='-m=2'` for verbose escape reasons. Look for "escapes to heap" attached to the `string(...)` expression.

A consequence: returning a string built from bytes always allocates. There is no way to return a temp-buffer string, because the buffer would live on the caller's stack (the caller didn't allocate it) — the result has to outlive your stack frame, so it must be on the heap.

---

## 10. Map-key fast paths

`runtime/map_faststr.go` defines five functions, none of which take a `(key unsafe.Pointer, keyType *_type)` pair — they take `string` directly and hash/compare in place:

```go
func mapaccess1_faststr(t *maptype, h *hmap, ky string) unsafe.Pointer
func mapaccess2_faststr(t *maptype, h *hmap, ky string) (unsafe.Pointer, bool)
func mapassign_faststr(t *maptype, h *hmap, s string) unsafe.Pointer
func mapdelete_faststr(t *maptype, h *hmap, ky string)
```

The compiler chooses these when both:

1. The map's key type is `string` exactly (not a named type with underlying string).
2. The map's value size is one of the optimized cases (or the generic fast path is selected).

These avoid the generic dispatch over `*_type` (which would walk a function pointer for the hash and another for `equal`). Combined with the lowered `slicebytetostringtmp` from `m[string(b)]`, you get: byte slice → in-place hash → compare against keys (which are already strings) → return value pointer. Zero allocations.

You can verify the fast path was selected by looking for the symbol in a profile or with `go tool objdump`:

```bash
go tool objdump -s 'main\.handle' ./binary | grep mapaccess
# CALL runtime.mapaccess1_faststr(SB)
```

If you see `mapaccess1` (no `_faststr`), the fast path was not chosen — your key type is probably a named string or the map type is being passed through an interface.

---

## 11. internal/bytealg and SIMD

String equality is `runtime.memequal`, which dispatches to architecture-specific implementations in `internal/bytealg`:

```
internal/bytealg/equal_amd64.s
internal/bytealg/equal_arm64.s
internal/bytealg/equal_generic.go
```

On AMD64 the implementation:

- For small sizes (≤16 bytes), compares with regular loads.
- For 16–32 bytes, a single SSE2 compare (`PCMPEQB`).
- For 32+ bytes, an AVX2 256-bit compare when AVX2 is available, otherwise unrolled SSE2.
- For sizes > 256 bytes, the loop is hoisted to use cache-line-aligned reads.

Practical impact: comparing two 8 KB strings is one or two microseconds — bandwidth-bound, not instruction-bound. String comparison is rarely the bottleneck in real programs.

Lexicographic comparison (`<`, `>`) is `runtime.cmpstring`, similarly assembly-optimized, in `internal/bytealg/compare_*.s`.

`strings.Contains`, `strings.Index` etc. go through `bytealg.IndexString` and use SIMD search (`PCMPEQB` for short needles, Rabin-Karp for longer ones). The functions in `internal/bytealg` are intentionally shared between `strings`, `bytes`, and `regexp` so that all three pay the same low cost.

---

## 12. Reflect, unsafe, and Go 1.20 changes

Before Go 1.20, the way to build a string from raw bytes without copying was:

```go
hdr := reflect.StringHeader{Data: uintptr(unsafe.Pointer(&b[0])), Len: len(b)}
s := *(*string)(unsafe.Pointer(&hdr))
```

This has multiple problems:

- Using `uintptr` discards the pointer's GC tracking. Between writing `Data` and reading `s`, a GC can move/free `b`'s backing array.
- `reflect.StringHeader` is documented as "no longer used by this implementation" since 1.20.
- Order of field assignment matters in subtle ways.

The 1.20 replacements remove all these concerns:

```go
s := unsafe.String(&b[0], len(b))
```

`unsafe.String` takes a `*byte` (typed pointer, GC-trackable), returns a `string`, and is properly defined in the `unsafe` rules — the runtime guarantees the string is valid as long as `b` is reachable and unmodified.

The reverse direction also gained a sanctioned function:

```go
ptr := unsafe.StringData(s)   // *byte
```

Replaces `(*reflect.StringHeader)(unsafe.Pointer(&s)).Data`.

These are the only correct ways to do zero-copy conversion on Go ≥ 1.20. New code should never touch `reflect.StringHeader`.

---

## 13. Version history

| Go version | Change relevant to string internals |
|------------|-------------------------------------|
| 1.0 | Two-word header established; `string` immutable; UTF-8 convention. |
| 1.4 | `concatstrings` family fixed shape; `tmpBuf` optimization for short non-escaping results. |
| 1.5 | Linker emits deduplicated string literals; `go:string` symbol prefix. |
| 1.10 | `strings.Builder` introduced — direct access to underlying byte buffer with unsafe-cast to string. |
| 1.13 | `slicebytetostring` adds the `n==1` fast path using `staticuint64s`; `mapaccess_faststr` family overhauled. |
| 1.17 | Register-based ABI; `concatstring2..5` variants pay off (args in registers). |
| 1.18 | `strings.Clone` added — explicit "force copy" for slicing-into-large-string scenarios. |
| 1.20 | `unsafe.String`, `unsafe.StringData`, `unsafe.SliceData` added. `reflect.StringHeader` and `reflect.SliceHeader` documented as deprecated. |
| 1.21 | `slices`, `maps`, `cmp` stdlib; minor refactor in `runtime/string.go` (no behavior change). |
| 1.22 | `string` map fast paths refactored for `hmap2` layout changes; identical visible semantics. |
| 1.23 | `go vet` strengthens `string(int)` warning; range-over-int does not affect strings. |

---

## 14. Summary

A senior view of strings tracks five intertwined systems:

1. **The runtime layout** (`runtime/string.go` and friends) — `stringStruct`, `concatstrings`, `slicebytetostring`, `rawstring`, the temp-buffer optimization.
2. **The compiler lowering** (`cmd/compile/internal/walk`) — `m[string(b)]`, range over `string(b)`, `string(b) == "lit"`, all recognised and lowered without allocation.
3. **Escape analysis** — what makes a `string(b)` conversion stay on the stack vs. allocate, and why returning or capturing forces the heap.
4. **Linker-level interning** — every literal shared across the binary; runtime-built strings are never automatically interned.
5. **`internal/bytealg`** — the assembly substrate that makes string comparison, search, and equality essentially free relative to byte bandwidth.

With these in hand, you can read Go source and predict every string allocation it will make, and you can recognise when a small reorganisation (keep the conversion inside `m[]`; hoist a `string(b)` out of a loop into a `Builder`) changes the allocation profile materially. Apply this in real services with [professional.md](professional.md).
