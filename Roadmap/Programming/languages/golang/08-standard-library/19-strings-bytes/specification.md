# 8.19 `strings` and `bytes` — Specification

> Reference card. Method signatures and notes only — for "why" see
> the other files in this leaf. Source of truth: `$GOROOT/src/strings/`
> and `$GOROOT/src/bytes/`.

## 1. The two packages mirror each other

For almost every function in `strings`, there is a `bytes` function
with the same name and the same shape, with `string` replaced by
`[]byte`. The exceptions:

- `strings.Builder` vs `bytes.Buffer` — different APIs because they
  serve different roles (write-only string builder vs read/write
  byte buffer).
- `strings.Title` is deprecated (Unicode title-casing is locale-
  dependent); `bytes` has no analog because byte-level case mapping
  isn't meaningful for non-ASCII text.

The tables below use `s` for the input and document `strings`
unless noted.

## 2. Search and comparison

| Function | Signature | Notes |
|----------|-----------|-------|
| `Contains` | `Contains(s, substr string) bool` | True if `substr` is in `s`. Empty `substr` returns true. |
| `ContainsAny` | `ContainsAny(s, chars string) bool` | Any rune in `chars` is in `s`. |
| `ContainsRune` | `ContainsRune(s string, r rune) bool` | UTF-8 aware. |
| `ContainsFunc` | `ContainsFunc(s string, f func(rune) bool) bool` | Go 1.21+. |
| `Count` | `Count(s, substr string) int` | Non-overlapping count. Empty substr returns `utf8.RuneCountInString(s) + 1`. |
| `EqualFold` | `EqualFold(s, t string) bool` | Unicode simple case folding. |
| `HasPrefix` | `HasPrefix(s, prefix string) bool` | |
| `HasSuffix` | `HasSuffix(s, suffix string) bool` | |
| `Index` | `Index(s, substr string) int` | Byte index of first match, or -1. |
| `IndexAny` | `IndexAny(s, chars string) int` | First rune in `s` that is in `chars`. |
| `IndexByte` | `IndexByte(s string, c byte) int` | Heavily SIMD-optimized. |
| `IndexFunc` | `IndexFunc(s string, f func(rune) bool) int` | |
| `IndexRune` | `IndexRune(s string, r rune) int` | |
| `LastIndex` | `LastIndex(s, substr string) int` | |
| `LastIndexAny` | `LastIndexAny(s, chars string) int` | |
| `LastIndexByte` | `LastIndexByte(s string, c byte) int` | |
| `LastIndexFunc` | `LastIndexFunc(s string, f func(rune) bool) int` | |
| `Compare` | `Compare(a, b string) int` | -1, 0, +1. Equivalent to `cmp.Compare`; provided for callsite consistency with `bytes.Compare`. |

## 3. Split, join, fields

| Function | Signature | Notes |
|----------|-----------|-------|
| `Split` | `Split(s, sep string) []string` | All parts. Empty `sep` splits into runes. |
| `SplitN` | `SplitN(s, sep string, n int) []string` | At most `n` parts; last includes remainder. |
| `SplitAfter` | `SplitAfter(s, sep string) []string` | Like Split but keeps `sep` at end of each part. |
| `SplitAfterN` | `SplitAfterN(s, sep string, n int) []string` | |
| `Fields` | `Fields(s string) []string` | Split on Unicode whitespace, collapse runs. |
| `FieldsFunc` | `FieldsFunc(s string, f func(rune) bool) []string` | Split where `f` is true; runs collapse. |
| `Cut` | `Cut(s, sep string) (before, after string, found bool)` | Go 1.18+. Split-once. |
| `CutPrefix` | `CutPrefix(s, prefix string) (after string, found bool)` | Go 1.20+. |
| `CutSuffix` | `CutSuffix(s, suffix string) (before string, found bool)` | Go 1.20+. |
| `Join` | `Join(elems []string, sep string) string` | Single allocation when result fits. |

## 4. Transformation

| Function | Signature | Notes |
|----------|-----------|-------|
| `Replace` | `Replace(s, old, new string, n int) string` | `n < 0` for "all". `n == 0` is a no-op. |
| `ReplaceAll` | `ReplaceAll(s, old, new string) string` | Equivalent to `Replace(..., -1)`. |
| `Map` | `Map(mapping func(rune) rune, s string) string` | Return -1 to drop. |
| `Repeat` | `Repeat(s string, count int) string` | Panics on negative `count`; panics on overflow. |
| `ToLower` | `ToLower(s string) string` | Unicode-aware (simple). |
| `ToUpper` | `ToUpper(s string) string` | |
| `ToTitle` | `ToTitle(s string) string` | Title-case every rune. |
| `ToLowerSpecial` | `ToLowerSpecial(c unicode.SpecialCase, s string) string` | Locale variant (e.g., Turkish). |
| `ToUpperSpecial` | `ToUpperSpecial(c unicode.SpecialCase, s string) string` | |
| `ToTitleSpecial` | `ToTitleSpecial(c unicode.SpecialCase, s string) string` | |
| `ToValidUTF8` | `ToValidUTF8(s, replacement string) string` | Replace ill-formed sequences. |
| `Title` | (deprecated) | Use `golang.org/x/text/cases`. |

### `Trim*`

| Function | Signature |
|----------|-----------|
| `Trim` | `Trim(s, cutset string) string` |
| `TrimLeft` | `TrimLeft(s, cutset string) string` |
| `TrimRight` | `TrimRight(s, cutset string) string` |
| `TrimFunc` | `TrimFunc(s string, f func(rune) bool) string` |
| `TrimLeftFunc` | `TrimLeftFunc(s string, f func(rune) bool) string` |
| `TrimRightFunc` | `TrimRightFunc(s string, f func(rune) bool) string` |
| `TrimSpace` | `TrimSpace(s string) string` |
| `TrimPrefix` | `TrimPrefix(s, prefix string) string` |
| `TrimSuffix` | `TrimSuffix(s, suffix string) string` |

`Trim*Func` checks each rune from the relevant end. `Trim` and
`TrimLeft`/`TrimRight` treat `cutset` as a set of runes (not a
substring).

## 5. `strings.Builder`

```go
type Builder struct {
    // unexported
}

func (b *Builder) Cap() int
func (b *Builder) Grow(n int)
func (b *Builder) Len() int
func (b *Builder) Reset()
func (b *Builder) String() string
func (b *Builder) Write(p []byte) (int, error)
func (b *Builder) WriteByte(c byte) error
func (b *Builder) WriteRune(r rune) (int, error)
func (b *Builder) WriteString(s string) (int, error)
```

Contracts:

- The zero value is ready to use.
- A non-zero `Builder` copied by value will panic on the next write.
- `String()` returns a string that aliases the internal buffer
  (zero-copy). Subsequent writes mutate the underlying buffer; the
  returned string is observed as before-the-write because the
  internal slice header records the length at call time. Do not
  rely on observability of writes; do reset and reuse safely.
- `Write` always returns `nil` error; the signature matches
  `io.Writer`.
- `WriteByte` always returns `nil`; signature matches
  `io.ByteWriter`.

## 6. `bytes.Buffer`

```go
type Buffer struct {
    // unexported
}

func NewBuffer(buf []byte) *Buffer
func NewBufferString(s string) *Buffer

func (b *Buffer) Bytes() []byte
func (b *Buffer) Cap() int
func (b *Buffer) Grow(n int)
func (b *Buffer) Len() int
func (b *Buffer) Next(n int) []byte
func (b *Buffer) Read(p []byte) (int, error)
func (b *Buffer) ReadByte() (byte, error)
func (b *Buffer) ReadBytes(delim byte) ([]byte, error)
func (b *Buffer) ReadFrom(r io.Reader) (int64, error)
func (b *Buffer) ReadRune() (r rune, size int, err error)
func (b *Buffer) ReadString(delim byte) (string, error)
func (b *Buffer) Reset()
func (b *Buffer) String() string
func (b *Buffer) Truncate(n int)
func (b *Buffer) UnreadByte() error
func (b *Buffer) UnreadRune() error
func (b *Buffer) Write(p []byte) (int, error)
func (b *Buffer) WriteByte(c byte) error
func (b *Buffer) WriteRune(r rune) (int, error)
func (b *Buffer) WriteString(s string) (int, error)
func (b *Buffer) WriteTo(w io.Writer) (int64, error)
```

Interface satisfaction:

| Interface | Methods |
|-----------|---------|
| `io.Reader` | `Read` |
| `io.Writer` | `Write` |
| `io.ByteReader` | `ReadByte` |
| `io.ByteWriter` | `WriteByte` |
| `io.RuneReader` | `ReadRune` |
| `io.ByteScanner` | `UnreadByte` |
| `io.RuneScanner` | `UnreadRune` |
| `io.ReaderFrom` | `ReadFrom` |
| `io.WriterTo` | `WriteTo` |
| `io.StringWriter` | `WriteString` |
| `fmt.Stringer` | `String` |

Contracts:

- Zero value is ready to use.
- `Bytes()` returns the unread portion of the buffer. Validity ends
  at the next mutating call (any `Read*`/`Write*`/`Reset`/`Grow`/
  `Truncate`).
- `Read` drains; `Bytes` views without draining.
- `ReadFrom` reads into tail capacity; may grow.
- `WriteTo` calls `w.Write(b.Bytes())` then resets.

## 7. `strings.Reader`

```go
type Reader struct {
    // unexported
}

func NewReader(s string) *Reader

func (r *Reader) Len() int
func (r *Reader) Read(p []byte) (int, error)
func (r *Reader) ReadAt(p []byte, off int64) (int, error)
func (r *Reader) ReadByte() (byte, error)
func (r *Reader) ReadRune() (ch rune, size int, err error)
func (r *Reader) Reset(s string)
func (r *Reader) Seek(offset int64, whence int) (int64, error)
func (r *Reader) Size() int64
func (r *Reader) UnreadByte() error
func (r *Reader) UnreadRune() error
func (r *Reader) WriteTo(w io.Writer) (int64, error)
```

Implements: `io.Reader`, `io.ReaderAt`, `io.ByteReader`,
`io.ByteScanner`, `io.RuneReader`, `io.RuneScanner`, `io.Seeker`,
`io.WriterTo`. No allocation beyond the struct itself.

## 8. `bytes.Reader`

Same shape as `strings.Reader` but for `[]byte`:

```go
type Reader struct {
    // unexported
}

func NewReader(b []byte) *Reader
// methods identical to strings.Reader except Reset(b []byte)
```

## 9. `strings.Replacer`

```go
type Replacer struct {
    // unexported
}

func NewReplacer(oldnew ...string) *Replacer

func (r *Replacer) Replace(s string) string
func (r *Replacer) WriteString(w io.Writer, s string) (n int, err error)
```

`NewReplacer` panics if given an odd number of arguments. Construction
chooses one of three strategies based on input: single-byte trie,
generic trie, or hash-based. Replacement happens in a single pass.

`*Replacer` is safe for concurrent use after construction.

## 10. `bytes.Buffer` constants and limits

```go
// MinRead is the minimum slice size passed to a Read call by Buffer.ReadFrom.
const MinRead = 512

// ErrTooLarge is returned when a buffer cannot grow.
var ErrTooLarge = errors.New("bytes.Buffer: too large")
```

## 11. Conversion table: when does it allocate?

| Expression | Allocates? | Notes |
|------------|-----------|-------|
| `s[i:j]` | No | Reslices the same data. |
| `b[i:j]` | No | |
| `[]byte(s)` | Yes | Always copies. |
| `string(b)` | Yes | Always copies. |
| `len(string(b))` | No | Compiler-optimized. |
| `strings.Index(string(b), "x")` | No | Compiler-optimized. |
| `m[string(b)]` | No | Map lookup is special-cased. |
| `string(b) == "x"` | No | String compare is special-cased. |
| `for i, c := range string(b)` | No | |
| `unsafe.String(&b[0], len(b))` | No | Unsafe. |
| `unsafe.Slice(unsafe.StringData(s), len(s))` | No | Unsafe; result is read-only. |

## 12. Complexity summary

| Operation | Time | Space |
|-----------|------|-------|
| `Index`, `Contains` | O(n+m) average via Rabin-Karp / IndexByte fast path | O(1) |
| `IndexByte` | O(n) SIMD | O(1) |
| `Count` | O(n+m) | O(1) |
| `Split` | O(n) | O(k) where k is number of parts |
| `Cut` | O(n) | O(1) (no slice header allocation) |
| `Replace`/`ReplaceAll` | O(n+km) where k is replacement count | O(n+km) |
| `Replacer.Replace` | O(n) after construction | O(n) |
| `Builder.WriteString` | amortized O(1) per byte | depends on Grow |
| `Buffer.Write` | amortized O(1) per byte | |
| `EqualFold` | O(n) | O(1) |
| `utf8.RuneCountInString` | O(n) | O(1) |

## 13. Stability and compatibility

- The `strings` and `bytes` packages have a hard compatibility
  promise. No function has been removed since Go 1.
- Behavior of `Title` is deprecated; results are unchanged but
  callers should migrate to `golang.org/x/text/cases`.
- `strings.Clone`, `Cut`, `CutPrefix`, `CutSuffix`, `ContainsFunc`
  are post-1.0 additions; check `go.mod` for minimum version when
  using.

## 14. References

- [pkg.go.dev/strings](https://pkg.go.dev/strings)
- [pkg.go.dev/bytes](https://pkg.go.dev/bytes)
- [pkg.go.dev/unicode/utf8](https://pkg.go.dev/unicode/utf8)
- Source: `$GOROOT/src/strings/`, `$GOROOT/src/bytes/`,
  `$GOROOT/src/internal/bytealg/`
