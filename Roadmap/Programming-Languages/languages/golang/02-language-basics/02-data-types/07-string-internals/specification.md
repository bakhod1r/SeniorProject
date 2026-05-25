# String Internals — Specification

> **Spec note:** Go's language specification defines the **semantics** of the `string` type (immutability, indexing, conversion, comparison), but the **memory layout** of a `string` value (the two-word pointer-plus-length header) is **implementation-defined**. The text below cites the spec where the spec applies and the official runtime sources for layout.
>
> Spec: https://go.dev/ref/spec#String_types
> Runtime sources: `runtime/string.go`, `runtime/map_faststr.go`, `internal/bytealg/`.

---

## Table of Contents
1. [Spec references](#1-spec-references)
2. [What the spec guarantees](#2-what-the-spec-guarantees)
3. [Implementation layout: stringStruct](#3-implementation-layout-stringstruct)
4. [Conversion semantics](#4-conversion-semantics)
5. [Concatenation semantics](#5-concatenation-semantics)
6. [Indexing and slicing](#6-indexing-and-slicing)
7. [Comparison semantics](#7-comparison-semantics)
8. [Range semantics](#8-range-semantics)
9. [Unsafe interop contract](#9-unsafe-interop-contract)
10. [Version history](#10-version-history)
11. [Compliance checklist](#11-compliance-checklist)

---

## 1. Spec references

### String types

> A string type represents the set of string values. A string value is a (possibly empty) sequence of bytes. The number of bytes is called the length of the string and is never negative. **Strings are immutable**: once created, it is impossible to change the contents of a string. The predeclared string type is `string`; it is a defined type.
>
> The length of a string `s` can be discovered using the built-in function `len`. The length is a compile-time constant if the string is a constant. **A string's bytes can be accessed by integer indices** 0 through `len(s)-1`. **It is illegal to take the address of such an element**; if `s[i]` is the `i`th byte of a string, `&s[i]` is invalid.
>
> — https://go.dev/ref/spec#String_types

### Source code representation: string literals

> A string literal represents a string constant obtained from concatenating a sequence of characters. There are two forms: raw string literals and interpreted string literals. Raw string literals are character sequences between back quotes ... Interpreted string literals are character sequences between double quotes ... The text between the quotes, which may not contain newlines, forms the value of the literal, with backslash escapes interpreted.
>
> — https://go.dev/ref/spec#String_literals

### Conversions to and from a string type

> 1. Converting a signed or unsigned integer value to a string type yields a string containing the UTF-8 representation of the integer. Values outside the range of valid Unicode code points are converted to "�".
> 2. Converting a slice of bytes to a string type yields a string whose successive bytes are the elements of the slice.
> 3. Converting a slice of runes to a string type yields a string that is the concatenation of the individual rune values converted to strings.
> 4. Converting a value of a string type to a slice of bytes type yields a non-nil slice whose successive elements are the bytes of the string.
> 5. Converting a value of a string type to a slice of runes type yields a slice containing the individual Unicode code points of the string.
>
> — https://go.dev/ref/spec#Conversions_to_and_from_a_string_type

### Comparison operators

> String values are comparable and ordered, lexically byte-wise.
>
> — https://go.dev/ref/spec#Comparison_operators

### For statements with range clause

> For a string value, the "range" clause iterates over the Unicode code points in the string starting at byte index 0. On successive iterations, the index value will be the index of the first byte of successive UTF-8-encoded code points in the string, and the second value, of type `rune`, will be the value of the corresponding code point. If the iteration encounters an invalid UTF-8 sequence, the second value will be `0xFFFD`, the Unicode replacement character, and the next iteration will advance a single byte in the string.
>
> — https://go.dev/ref/spec#For_range

### Length and capacity

> The expression `len(s)` is constant if `s` is a string constant. ... Otherwise, invocations of `len` and `cap` are not constant.
> `len(s)` — string type — string length in bytes
>
> — https://go.dev/ref/spec#Length_and_capacity

---

## 2. What the spec guarantees

| Property | Guaranteed by spec |
|----------|--------------------|
| Strings are immutable | YES |
| `len(s)` returns byte count | YES |
| `s[i]` returns `byte` (= `uint8`) | YES |
| `&s[i]` is illegal | YES |
| `string(b)` copies bytes (`b` is `[]byte`) | YES (implied by immutability) |
| Range produces `(int byteOffset, rune)` | YES |
| Invalid UTF-8 yields `0xFFFD` in range | YES |
| `string(int)` is the UTF-8 of that code point | YES |
| Two-word memory layout | NO — implementation defined |
| Map-key fast path for `m[string(b)]` | NO — compiler optimization |
| Linker interning of literals | NO — implementation choice |
| `unsafe.String` zero-copy | YES (since Go 1.20, in `unsafe` package docs) |
| `staticuint64s` cache for `string([]byte{x})` | NO — runtime implementation detail |

Anything in the "NO" rows is **stable but not portable**. Don't write code that breaks if Go 2 reorganises the layout — but do write code that benefits from the optimisations on current Go.

---

## 3. Implementation layout: stringStruct

### From `runtime/string.go`

```go
type stringStruct struct {
    str unsafe.Pointer
    len int
}
```

Two words. On 64-bit platforms: 16 bytes total. On 32-bit: 8 bytes.

### Public mirror (deprecated since 1.20)

```go
// reflect/value.go
type StringHeader struct {
    Data uintptr
    Len  int
}
```

Marked as superseded; new code should use `unsafe.String` and `unsafe.StringData`.

### Runtime helpers (internal, not part of public API)

```go
// runtime/string.go
func concatstrings(buf *tmpBuf, a []string) string
func concatstring2(buf *tmpBuf, a [2]string) string
func concatstring3(buf *tmpBuf, a [3]string) string
func concatstring4(buf *tmpBuf, a [4]string) string
func concatstring5(buf *tmpBuf, a [5]string) string
func slicebytetostring(buf *tmpBuf, ptr *byte, n int) string
func slicebytetostringtmp(ptr *byte, n int) string
func stringtoslicebyte(buf *tmpBuf, s string) []byte
func stringtoslicerune(buf *[tmpStringBufSize]rune, s string) []rune
func slicerunetostring(buf *tmpBuf, a []rune) string
func intstring(buf *[4]byte, v int64) string
func rawstring(size int) (s string, b []byte)
func rawbyteslice(size int) (b []byte)
func rawruneslice(size int) (b []rune)
```

```go
// runtime/map_faststr.go
func mapaccess1_faststr(t *maptype, h *hmap, ky string) unsafe.Pointer
func mapaccess2_faststr(t *maptype, h *hmap, ky string) (unsafe.Pointer, bool)
func mapassign_faststr(t *maptype, h *hmap, s string) unsafe.Pointer
func mapdelete_faststr(t *maptype, h *hmap, ky string)
```

```go
// internal/bytealg/
func Equal(a, b []byte) bool                       // memequal under the hood
func IndexString(s, substr string) int             // SIMD search
func CompareString(a, b string) int                // lexicographic
```

These names are stable enough for runtime authors but not part of any user-facing API. Debuggers (`delve`, `gdb`) know them; user code should not depend on them.

---

## 4. Conversion semantics

### `string(b)` where `b` is `[]byte`

Specification: yields a string whose bytes are equal to the bytes of `b`. The string is independent of `b` — modifying `b` later does not modify the string.

Implementation: calls `runtime.slicebytetostring`. Always copies, except when the compiler proves the resulting string does not escape and the use is one of the recognised no-alloc patterns (see section 4.5).

### `[]byte(s)` where `s` is `string`

Specification: yields a non-nil byte slice whose elements are the bytes of `s`. The result is independent of `s` — modifying the slice does not modify the string.

Implementation: calls `runtime.stringtoslicebyte`. Always copies.

### `string(r)` where `r` is `rune` (i.e. `int32`)

Specification: yields the UTF-8 encoding of the Unicode code point with value `r`. If `r` is outside the valid range, yields `"�"` (U+FFFD).

Implementation: calls `runtime.intstring` with a 4-byte stack buffer; allocates only if the result escapes.

### `string(n)` where `n` is `int`

Specification: same as `string(rune)` — interprets `n` as a code point. `go vet` warns since Go 1.15. This is **not** a number-to-decimal-string conversion; use `strconv.Itoa(n)` for that.

### `string(rs)` where `rs` is `[]rune`

Specification: yields the concatenation of `rs[i]` as UTF-8.

Implementation: `runtime.slicerunetostring`. Allocates the result string.

### `[]rune(s)` where `s` is `string`

Specification: yields the slice of Unicode code points of `s`. Invalid UTF-8 contributes a single `RuneError` rune.

Implementation: `runtime.stringtoslicerune`. Allocates the result slice.

### 4.5 Compiler-recognised no-alloc patterns

The following uses of `string(b)` do not allocate because the compiler rewrites them to use `slicebytetostringtmp` (which builds a header aliasing `b`'s bytes, valid only for the lifetime of the expression):

- `m[string(b)]` and `m[string(b)] = v` — map index expressions where the key conversion is direct.
- `string(b) == "lit"` and `string(b) == s2` — equality comparisons.
- `string(b) < "lit"` and similar ordered comparisons.
- `for i, c := range string(b)` — range clause directly over the conversion.
- `len(string(b))` — folds to `len(b)`.
- Switch case selector: `switch string(b) { case "a": ... }`.

These optimisations are documented in `cmd/compile/internal/walk/order.go` and `cmd/compile/internal/walk/builtin.go`. They have been present since Go 1.5 (the original `m[string(b)]`) and were extended in later versions.

---

## 5. Concatenation semantics

### Spec

> String concatenation is the only operation `+` performs on strings.

The expression `s1 + s2 + ... + sn` produces a single new string equal to the byte-wise concatenation. Original strings are not modified.

### Implementation

The compiler folds a single `+` chain into one call to `runtime.concatstring2`, `concatstring3`, `concatstring4`, `concatstring5`, or `concatstrings` (for 6+ operands). Each performs **one** allocation for the result.

The runtime applies:

- **Skip empty operands**: `"" + s` returns `s`.
- **Single non-empty operand**: returned as-is when safe.
- **`tmpBuf` optimisation**: when escape analysis proved the result stays on the caller's stack and total length is ≤ 32 bytes, no heap allocation occurs.

For iterated concatenation (`+=` in a loop), each iteration is a separate call — N allocations totalling O(N²) bytes copied. Use `strings.Builder` or `strings.Join` instead.

---

## 6. Indexing and slicing

### Indexing

```go
s[i]  // returns byte at position i, of type byte (uint8)
```

Spec requires panic on out-of-range (`i < 0 || i >= len(s)`).

`&s[i]` is illegal at compile time. This restriction enables the runtime to put strings in read-only pages and to share backing arrays for literals and slices.

### Slicing

```go
s[low:high]
```

Produces a new string header. `Data = s.Data + low`, `Len = high - low`. **No bytes are copied.** The new string shares the backing array with `s`.

Bounds: `0 ≤ low ≤ high ≤ len(s)`; out-of-range panics.

The three-index slice `s[low:high:max]` is not allowed on strings (strings have no capacity).

### Spec quote

> For arrays, slices, and strings, the indices low and high select which elements appear in the result. The result has type string for string operands.

---

## 7. Comparison semantics

### Spec

> String values are comparable and ordered, lexically byte-wise.

Two strings are equal iff their lengths are equal and their bytes are equal in order. Ordering is byte-wise lexicographic (not Unicode-aware): `"a" < "b"`, `"ab" < "b"`, `"a" < "aa"`.

### Implementation

Equality goes through `runtime.memequal` (assembly, SIMD on AMD64/ARM64). Ordering goes through `runtime.cmpstring` (similar SIMD).

The fast path is the length check: unequal lengths return immediately.

---

## 8. Range semantics

```go
for i, r := range s {
    // i is the byte index of the start of r in s
    // r is the decoded rune
}
```

Spec defines:

- `i` increments by the UTF-8 byte length of each rune (1–4 bytes).
- `r` is the decoded code point; invalid UTF-8 yields `0xFFFD` with `i` advancing by 1.
- The two-valued form is the only form for strings (single-valued range yields the index).

Implementation: `runtime.decoderune` walks the bytes; for ASCII the path is one branch.

---

## 9. Unsafe interop contract

### Functions (Go 1.20+)

```go
// from package unsafe
func String(ptr *byte, len IntegerType) string
func StringData(str string) *byte
```

### Documented contract (https://pkg.go.dev/unsafe#String)

> `String` returns a string value whose underlying bytes start at `ptr` and whose length is `len`.
>
> The `len` argument must be of integer type or an untyped constant. A constant `len` argument must be non-negative and representable by a value of type `int`; if it is an untyped constant it is given type `int`. At run time, if `len` is negative, or if `ptr` is nil and `len` is not zero, a run-time panic occurs.
>
> Since Go strings are immutable, the bytes passed to `String` must not be modified as long as the returned string value exists.

> `StringData` returns a pointer to the underlying bytes of `str`. For an empty string the return value is unspecified, and may be nil.
>
> Since Go strings are immutable, the bytes returned by `StringData` must not be modified.

### Caller responsibilities (formal)

For `s := unsafe.String(p, n)`:

1. The `n` bytes starting at `p` are valid memory for the lifetime of `s`.
2. The bytes are not mutated for the lifetime of `s`.
3. The pointer `p` keeps its referent alive (GC-reachable).

For `p := unsafe.StringData(s)`:

1. The pointer is valid only while `s` is reachable.
2. Writes through `p` are undefined behaviour.

### Deprecated alternatives

`reflect.StringHeader` is documented as superseded since Go 1.20:

> StringHeader is the runtime representation of a string. It cannot be used safely or portably and its representation may change in a later release. Moreover, the Data field is not sufficient to guarantee the data it references will not be garbage collected, so programs must keep a separate, correctly typed pointer to the underlying data.

New code must use `unsafe.String` / `unsafe.StringData`.

---

## 10. Version history

| Go version | Change |
|------------|--------|
| 1.0 | Initial release: two-word layout, immutability, UTF-8 convention, `range` semantics, `string([]byte)` and `[]byte(string)` conversions. |
| 1.4 | `concatstrings` family formalised; temp-buf optimisation for short non-escaping concats. |
| 1.5 | Linker emits deduplicated literals; `m[string(b)]` compiler optimisation introduced. |
| 1.10 | `strings.Builder` added (allocation-free finalisation via unsafe cast). |
| 1.13 | `slicebytetostring` adds `n==1` fast path using `runtime.staticuint64s` (256-byte cache). |
| 1.15 | `go vet` flags `string(int)` as suspicious. |
| 1.17 | Register ABI; `concatstring2..5` benefit from register-passed args. |
| 1.18 | `strings.Clone` added — explicit force-copy for slice-of-large-string scenarios. |
| 1.20 | `unsafe.String`, `unsafe.StringData` added; `reflect.StringHeader` documented as deprecated. |
| 1.21 | Stdlib `slices`, `maps`, `cmp`; refactor of `runtime/string.go` (no behaviour change). |
| 1.22 | `range` over integer added (does not affect strings); map fast paths updated for new `hmap` layout. |
| 1.23 | `go vet` strengthens `string(int)` checks. |
| 1.24 | `encoding/json/v2` experimental; uses `unsafe.String` for zero-copy decoding (not on by default). |

---

## 11. Compliance checklist

For library authors and reviewers:

- [ ] No reliance on the order of fields in `reflect.StringHeader`. Use `unsafe.String` / `unsafe.StringData` instead.
- [ ] No use of `string(int)` to convert numbers to decimal strings; use `strconv.Itoa`.
- [ ] Map keys built from `[]byte` use `m[string(b)]` directly (no intermediate variable) where possible.
- [ ] Concatenation in loops uses `strings.Builder` or `strings.Join`, not `+`.
- [ ] Strings sliced from much larger strings and retained long-term call `strings.Clone`.
- [ ] `unsafe.String` callers document the byte-lifetime contract at the call site.
- [ ] `unsafe.String` is not used together with pooled buffers (the pool may recycle bytes the string still references).
- [ ] `[]byte(s)` followed by `string(b)` (or vice versa) is removed; the round-trip is always wasteful.
- [ ] `for i, c := range string(b)` is preserved as-is when the byte slice is the source (compiler optimisation).
- [ ] Tests using string equality consider Unicode normalisation if input might be NFC/NFD-distinct.
- [ ] Cross-cgo boundaries do not assume any particular layout; convert explicitly to `*C.char` via `C.CString`.

---

## 12. Concluding remarks

The Go spec treats strings as opaque immutable byte sequences with well-defined conversion, indexing, and range semantics. The runtime implements these semantics with a stable two-word header layout that has been unchanged since Go 1.0. The compiler adds layers of optimisation (literal deduplication, `m[string(b)]` zero-copy, temp-buffer concatenation) that the spec does not require but are reliable across all current Go versions. Go 1.20 closed the last major gap by adding `unsafe.String` and `unsafe.StringData`, giving programs a sanctioned way to perform zero-copy conversion without poking at deprecated `reflect` types.

The runtime sources (`runtime/string.go`, `runtime/map_faststr.go`, `internal/bytealg/`) and the compiler walk passes (`cmd/compile/internal/walk/`) are authoritative beyond the spec for layout and optimisation questions; they are open and well-commented and should be required reading for anyone diagnosing string-related performance issues.
