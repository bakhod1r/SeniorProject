# String Internals — Middle

## 1. What this file adds

[junior.md](junior.md) established the two-word header, immutability, RODATA storage, and the byte-vs-rune distinction. This file goes one level deeper:

- How UTF-8 is laid out byte-by-byte and how `range` decodes it.
- How `string ⟷ []byte` conversions actually work, including the compiler-recognized patterns that avoid allocation.
- The lifecycle of a string produced by concatenation, and why `+` allocates.
- The `strings.Builder` internal data flow.
- `unsafe.String` and `unsafe.StringData` (Go 1.20) — when they are safe, and what they cost.

Mid-level understanding means you can read string-heavy code and predict every allocation it will perform.

---

## 2. UTF-8, in memory

Go strings hold **arbitrary bytes**. The convention — and what most of the standard library assumes — is that those bytes are valid UTF-8, but the type system does not enforce it. You can put any byte sequence into a string with `string([]byte{0xFF, 0xFE})` and the runtime will not object.

UTF-8 encodes each Unicode code point in 1 to 4 bytes:

| Code point range | Bytes | Pattern |
|------------------|-------|---------|
| U+0000 – U+007F (ASCII) | 1 | `0xxxxxxx` |
| U+0080 – U+07FF | 2 | `110xxxxx 10xxxxxx` |
| U+0800 – U+FFFF | 3 | `1110xxxx 10xxxxxx 10xxxxxx` |
| U+10000 – U+10FFFF | 4 | `11110xxx 10xxxxxx 10xxxxxx 10xxxxxx` |

So `"héllo😀"` is encoded as:

```
h    0x68
é    0xC3 0xA9              (2 bytes)
l    0x6C
l    0x6C
o    0x6F
😀   0xF0 0x9F 0x98 0x80    (4 bytes)
```

That's 9 bytes for what visually looks like 6 characters. `len("héllo😀") == 9`. `utf8.RuneCountInString("héllo😀") == 6`.

The `unicode/utf8` package is the canonical implementer of decoding/validation. Its main entry points:

```go
utf8.DecodeRuneInString(s string) (r rune, size int)
utf8.RuneCountInString(s string) int
utf8.ValidString(s string) bool
utf8.RuneLen(r rune) int
```

Reading `utf8.DecodeRuneInString` is illuminating — it is a straightforward state machine over the byte patterns above, with a fast path for ASCII (`s[0] < 0x80`).

---

## 3. The range loop is a decoder

```go
for i, r := range s {
    ...
}
```

is sugar for, approximately:

```go
i := 0
for i < len(s) {
    r, size := utf8.DecodeRuneInString(s[i:])
    // body sees i, r
    i += size
}
```

Two consequences:

- `i` is the **byte index**, not the rune index. After the `é` in `"héllo"` you go from `i=1` to `i=3`.
- Invalid UTF-8 bytes are reported as `utf8.RuneError` (the replacement character `U+FFFD`) with `size=1`, so the loop never gets stuck.

This is also why range is slower than plain indexing for ASCII-heavy work: every iteration runs the decoder, even though for ASCII the decoder is a single branch. If you know your input is ASCII, prefer a plain `for i := 0; i < len(s); i++` and `s[i]`.

---

## 4. `[]rune(s)` materializes the decoded form

```go
rs := []rune("héllo")
fmt.Println(len(rs)) // 5
fmt.Println(rs[1])   // 233 (é)
```

This conversion **allocates** a slice big enough to hold one `int32` per rune (so up to 4 bytes per character) and walks the UTF-8 decoding. Cost is O(n) time and O(n) space. Use when you genuinely need random rune access; avoid in hot paths.

The reverse — `string([]rune{...})` — re-encodes to UTF-8 and again allocates. Both directions copy.

---

## 5. The `string ⟷ []byte` conversion in detail

Both conversions are implemented in `runtime/string.go`:

```go
// rune slice -> string and byte slice -> string
func slicebytetostring(buf *tmpBuf, b []byte) string
// string -> byte slice
func stringtoslicebyte(buf *tmpBuf, s string) []byte
```

A naive `string(b)` calls `slicebytetostring`, which:

1. Asks the allocator for a new backing array sized `len(b)`.
2. Copies the bytes.
3. Returns a `string` header pointing at the new array.

The new array is **not** GC-reachable from `b`; the two are independent from now on. Mutating `b` does not affect the resulting string.

Likewise `[]byte(s)` allocates a new slice and copies.

This default behaviour is correct, safe, and the right thing 95 % of the time. The other 5 % is when an allocation per request is too much, and the compiler or `unsafe` can help.

---

## 6. Compiler-recognized "no-allocation" patterns

The Go compiler specifically recognises a handful of code shapes where the temporary string from `string(b)` doesn't need its own backing array, because the conversion is short-lived and the original bytes are guaranteed not to change during use.

### Pattern A: `m[string(b)]`

```go
m := map[string]int{"hi": 1}
b := []byte("hi")
_ = m[string(b)]  // no allocation
```

The compiler emits a lookup that hashes the bytes of `b` and compares against the map's keys, **without** allocating a new string. This is implemented through specialised runtime helpers (`runtime.mapaccess1_faststr`-adjacent fast paths and `runtime.slicebytetostringtmp`).

Caveat: this only fires when `string(b)` is used **directly** as the key. Assign it to a variable first and you lose the optimization:

```go
s := string(b)    // allocates
_ = m[s]
```

### Pattern B: `for i, c := range string(b)`

```go
b := []byte("héllo")
for i, c := range string(b) {
    _, _ = i, c
}
```

Again, no allocation. The range loop reads the bytes directly from `b`, without materialising an intermediate string.

### Pattern C: comparison `string(b) == "literal"`

```go
if string(b) == "GET" { ... }   // no allocation
```

The compiler compiles this to a length check followed by `memequal` over `b`'s bytes and the literal's bytes. The literal already lives in RODATA; no temporary string is built.

### Pattern D: `len(string(b))`

```go
n := len(string(b))   // n = len(b); no allocation, no conversion
```

The compiler simplifies this all the way down to `len(b)`.

### How to verify

Run with allocation profiling or simply `-gcflags='-m'`:

```bash
go build -gcflags='-m=2' ./...
```

For the optimized pattern, the compiler reports something like `does not escape`. For the non-optimized form, the conversion appears as a heap allocation.

---

## 7. `unsafe.String` and `unsafe.StringData` (Go 1.20)

Since Go 1.20, the `unsafe` package provides two functions that let you construct a `string` from existing bytes **without copying**:

```go
unsafe.String(ptr *byte, len IntegerType) string
unsafe.StringData(s string) *byte
```

`unsafe.String(p, n)` builds a string header `{p, n}` directly. `unsafe.StringData(s)` returns the data pointer of `s`. Both are the supported, post-Go-1.20 replacements for poking `reflect.StringHeader` fields (which is now strongly discouraged).

```go
b := []byte{'h', 'i'}
s := unsafe.String(&b[0], len(b))   // no copy
```

This is the zero-copy escape hatch. The cost is that you must hold **two contracts**:

1. The bytes `b` points at must not be mutated for as long as `s` is reachable.
2. The bytes must remain alive (not GC-reclaimed) for as long as `s` is reachable.

Violating either is undefined behaviour. The runtime will not check. A common safe usage is converting a freshly built `[]byte` that you control and won't touch again:

```go
buf := make([]byte, 0, 64)
buf = append(buf, "hello "...)
buf = append(buf, name...)
result := unsafe.String(&buf[0], len(buf))
// do not modify buf after this point
```

For the inverse direction, `unsafe.Slice(unsafe.StringData(s), len(s))` produces a `[]byte` aliasing the string's bytes — but writing to that slice corrupts every other holder of the string. Only safe if `s` is **provably** your own, exclusive value.

---

## 8. Concatenation — what `+` actually does

Repeated string concatenation is the classic Go performance pitfall:

```go
var s string
for _, p := range parts {
    s = s + p
}
```

Each `s + p` calls `runtime.concatstring2` (for two operands) or `concatstrings` (for more), which:

1. Sums the lengths.
2. Allocates a new backing array of the total size.
3. Copies the bytes of all operands into the new array.
4. Returns a string header pointing at the new array.
5. The previous `s` becomes garbage.

For N iterations on average size K bytes, you allocate `N` strings of growing size, totaling O(N²) bytes copied. For 1000 parts of 10 bytes each, that's ~5 MB of allocation to produce a 10 KB result.

A single concatenation expression (`a + b + c + d`) is collapsed into one `concatstrings` call, so the cost is one allocation for the whole expression. The problem is only with **iterated** concatenation.

---

## 9. The runtime fast path: stack buffer for short concats

`runtime.concatstrings` has an interesting optimization. For small results it tries to use a stack-allocated temporary buffer (`tmpBuf`) passed in by the caller:

```go
// runtime/string.go
const tmpStringBufSize = 32

type tmpBuf [tmpStringBufSize]byte

func concatstrings(buf *tmpBuf, a []string) string {
    ...
    if buf != nil && l <= len(buf) {
        // use stack buffer
    } else {
        // mallocgc
    }
}
```

The compiler emits a `tmpBuf` on the caller's stack when escape analysis proves the resulting string does not escape. So `s := "hello, " + name` where `s` doesn't leave the function may produce **zero heap allocations** if the total is under 32 bytes and `s` doesn't escape. As soon as `s` is returned, stored in a struct, or passed to an `interface{}`, escape analysis kicks in and the buffer goes to the heap.

---

## 10. `strings.Builder` — the right tool

```go
var b strings.Builder
b.Grow(1024)
for _, p := range parts {
    b.WriteString(p)
}
result := b.String()
```

Internally, `strings.Builder` holds a `[]byte` that grows like a slice (`append`-style doubling). `WriteString` appends without allocation when capacity is sufficient. `String()` returns a string whose backing array is the slice's array — converted with `unsafe.String` under the hood, so **no final copy**.

The Builder enforces a no-copy invariant: once `String()` has been called, further writes will reallocate (so the returned string can't be mutated through the Builder). It also has a `noescape` field that prevents `Builder` values from being copied — copying would alias the same byte buffer, breaking immutability of strings already handed out.

Realistic improvement over `+` in a loop: 100×–10000× depending on input size. For anything more than three or four concatenations in a loop, use `Builder`.

---

## 11. `fmt.Sprintf` is not free

```go
s := fmt.Sprintf("user=%d action=%s", id, action)
```

Looks innocent. Under the hood:

1. `fmt` parses the format string at runtime.
2. It boxes `id` and `action` into `interface{}` values (potential allocation).
3. It calls a printer that uses a `[]byte` buffer (potential allocation, often pooled via `sync.Pool`).
4. Final conversion `string(buf)` may or may not allocate, depending on whether the printer can transfer ownership.

For one-off log messages this is fine. In a hot loop, prefer direct concatenation, `strings.Builder`, or `strconv.AppendInt` / `strconv.AppendQuote` patterns that write into a pre-existing buffer.

---

## 12. `strconv` `AppendX` family

The append-style functions in `strconv` are the lowest-allocation way to build strings programmatically:

```go
buf := make([]byte, 0, 64)
buf = append(buf, "id="...)
buf = strconv.AppendInt(buf, int64(userID), 10)
buf = append(buf, " name="...)
buf = strconv.AppendQuote(buf, name)
s := string(buf)   // single allocation for the result
```

This is the pattern used inside `log/slog`'s text encoder, `encoding/json`'s number encoder, and most other performance-conscious stdlib code. There is no intermediate string per field; you pay for one final string conversion.

If you want to avoid even the final conversion, use `unsafe.String(&buf[0], len(buf))` — at the cost of the contracts described in section 7.

---

## 13. Slice-of-string vs single string

```go
parts := []string{"hello", " ", "world"}
result := strings.Join(parts, "")
```

`strings.Join` computes the total length, allocates one backing array, copies each part in, and returns the result. It performs **exactly one** allocation regardless of `len(parts)`. This is almost always the right way to flatten a `[]string` into one `string`, and it is often faster than building it with `Builder` because the size is known up front and no growth is needed.

Compare to:

```go
result := ""
for _, p := range parts { result += p }   // N allocations, O(N²) bytes copied
```

The difference at 1000 parts is roughly four orders of magnitude.

---

## 14. Equality and the string-as-map-key fast path

`map[string]V` is among the most heavily optimized type combinations in Go. The runtime has dedicated fast paths:

```go
// runtime/map_faststr.go
func mapaccess1_faststr(t *maptype, h *hmap, ky string) unsafe.Pointer
func mapassign_faststr(t *maptype, h *hmap, s string) unsafe.Pointer
func mapdelete_faststr(t *maptype, h *hmap, ky string)
```

These versions inline the string-hash computation, skip the generic `(typ, key)` lookup, and special-case empty strings. Combined with the `m[string(b)]` no-alloc trick from section 6, you can perform millions of `[]byte`-keyed map lookups per second without allocating anything.

---

## 15. Two-word slice header vs three-word slice header — and why string is "lighter"

For comparison: a `[]byte` slice header is **three** words:

```
+--------+--------+--------+
|  data  |  len   |  cap   |
+--------+--------+--------+   (24 bytes on 64-bit)
```

A `string` is **two** words because it has no capacity — there's no "append to a string in place", and immutability means the runtime never needs to track remaining buffer.

This 8-byte difference is meaningful when you have huge arrays of strings vs huge arrays of byte-slices. For 10 million records, you save 80 MB just on headers.

---

## 16. Mid-level checklist

When you read or write string-heavy code, run through these:

- [ ] Where does each `string(b)` / `[]byte(s)` occur? Is it on a hot path?
- [ ] Are there map lookups using `string(b)` in the key — and is the optimization preserved (no intermediate variable)?
- [ ] Is there `+=` concatenation in a loop? Replace with `Builder` or `Join`.
- [ ] Is `fmt.Sprintf` used in a hot loop? Replace with `strconv.AppendX` into a buffer.
- [ ] Do you have a `string` derived from a much larger string via slicing and held long-term? `strings.Clone` it.
- [ ] Are you ranging strings when plain indexing would do (ASCII-only inputs)?
- [ ] Are there places where `unsafe.String` would be safe and worthwhile?

---

## 17. Looking at the bytes: a worked example

```go
package main

import (
    "fmt"
    "unicode/utf8"
    "unsafe"
)

func main() {
    s := "Go💙"
    fmt.Println("len:", len(s))                          // 6
    fmt.Println("rune count:", utf8.RuneCountInString(s)) // 3

    data := unsafe.StringData(s)
    for i := 0; i < len(s); i++ {
        fmt.Printf("byte %d: 0x%02x\n", i,
            *(*byte)(unsafe.Add(unsafe.Pointer(data), i)))
    }

    for i, r := range s {
        fmt.Printf("rune at %d: %c (U+%04X)\n", i, r, r)
    }
}
```

Output:

```
len: 6
rune count: 3
byte 0: 0x47        G
byte 1: 0x6f        o
byte 2: 0xf0        \
byte 3: 0x9f         } 💙 (U+1F499) encoded as F0 9F 92 99
byte 4: 0x92        /
byte 5: 0x99       /
rune at 0: G (U+0047)
rune at 1: o (U+006F)
rune at 2: 💙 (U+1F499)
```

You can see explicitly: `len` reports 6 bytes, `range` yields 3 runes, the third rune starts at byte offset 2.

---

## 18. Migrating from `reflect.StringHeader` (deprecated)

Pre-1.20 code often did:

```go
hdr := (*reflect.StringHeader)(unsafe.Pointer(&s))
fmt.Println(hdr.Data, hdr.Len)
```

This pattern is now discouraged because the layout could change (it hasn't, but the contract was tightened). The replacements are:

```go
ptr := unsafe.StringData(s)          // *byte
length := len(s)                      // int

s := unsafe.String(ptr, length)       // reverse direction
```

Same operation, type-safe, future-proof against runtime layout changes.

---

## 19. When concatenation is fine

Despite the "+ is slow" lore, plain concatenation is **fine** when:

- The number of operands is a small compile-time constant: `name + "@" + host`.
- The total result is short (under ~32 bytes, fits in `tmpBuf`) and doesn't escape.
- It happens once, not in a loop.

The compiler folds these into a single `concatstrings` (or `concatstring2`, `concatstring3`, `concatstring4`, `concatstring5` for specific arities), which is one allocation total. Don't reach for `Builder` for `"hello, " + name`.

---

## 20. Summary

Mid-level string fluency means knowing the byte layout (UTF-8), the conversion contracts (when copies happen, when the compiler skips them), and the assembly tools (`Builder`, `Join`, `strconv.AppendX`, `unsafe.String`). Allocate at boundaries, accumulate in `[]byte` buffers, prefer the fast paths the runtime offers (`m[string(b)]`, faststr map ops), and reserve `unsafe.String` for the cases where you control both producer and consumer of the bytes. The runtime walk-through that explains *why* each path is fast is in [senior.md](senior.md).
