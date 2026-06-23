# 8.19 `strings` and `bytes` — Senior

> **Audience.** You write the string-manipulation primitives others
> depend on. You're asked why two equal-looking strings compare false,
> why `for range s` and `for i := range s` produce different indices,
> why `strings.Builder` panics on copy, and why `bytes.IndexByte` is
> 50× faster than your hand-written loop. This file is the layer where
> "use the stdlib" becomes "understand the stdlib".

## 1. The `stringHeader` and `sliceHeader` layouts

A `string` and a `[]byte` differ by exactly one word in their runtime
representation:

```go
// runtime/string.go (paraphrased)
type stringHeader struct {
    Data unsafe.Pointer
    Len  int
}

// runtime/slice.go
type sliceHeader struct {
    Data unsafe.Pointer
    Len  int
    Cap  int
}
```

That extra `Cap` field is the only structural difference. Three
operational consequences flow from this:

1. **`string([]byte)` and `[]byte(string)` allocate** by default —
   not because the contents need transformation but because the
   compiler cannot prove the source won't change. Strings are
   immutable; a `[]byte` is mutable. To preserve the invariant, the
   conversion copies.

2. **String slicing is zero-copy**. `s[i:j]` produces a new header
   with adjusted `Data` and `Len`; it does not allocate. This is why
   string slicing is O(1).

3. **A small substring can pin a large allocation alive**. If you do
   `s := bigString[0:8]` and keep `s` for an hour, the whole
   `bigString` cannot be garbage-collected. Defensive copy with
   `string([]byte(s))` to break the link.

## 2. Rune vs byte iteration

```go
s := "héllo"

// Byte iteration:
for i := 0; i < len(s); i++ {
    fmt.Printf("%d %x\n", i, s[i])
}
// 0 68
// 1 c3   ← first byte of 'é' (U+00E9 encoded as 0xC3 0xA9)
// 2 a9   ← second byte of 'é'
// 3 6c
// 4 6c
// 5 6f

// Rune iteration:
for i, r := range s {
    fmt.Printf("%d %c\n", i, r)
}
// 0 h
// 1 é   ← rune at byte index 1
// 3 l   ← byte index jumps by 2 (é was 2 bytes)
// 4 l
// 5 o
```

The `i` from `range` is the **byte offset of the rune's first byte**,
not a rune count. If you want both byte and rune indices, count
separately:

```go
runeIdx := 0
for byteIdx, r := range s {
    _ = byteIdx
    _ = runeIdx
    runeIdx++
}
```

`utf8.RuneCountInString(s)` gives you the total rune count in O(n).
There is no O(1) way — Go does not cache rune counts.

## 3. `unicode/utf8` — the rune toolkit

Anything more careful than `range` needs `unicode/utf8`:

```go
import "unicode/utf8"

// Decode one rune starting at index i:
r, size := utf8.DecodeRuneInString(s[i:])
// r is the rune, size is the number of bytes consumed.
// If s[i:] is invalid UTF-8, r is utf8.RuneError and size is 1.

// Validate:
if !utf8.ValidString(s) {
    // bytes that don't form valid UTF-8
}

// Length of a rune when UTF-8 encoded:
n := utf8.RuneLen(r)  // 1..4, or -1 if r is not a valid rune

// Encode a rune into a fixed-size buffer:
var buf [4]byte
n := utf8.EncodeRune(buf[:], '€')  // n == 3
```

The most common senior-level use is "validate this is real UTF-8
before treating it as text":

```go
if !utf8.Valid(p) {
    return fmt.Errorf("invalid UTF-8")
}
```

`utf8.RuneError` (the Unicode replacement character `U+FFFD`,
encoded as `0xEF 0xBF 0xBD`) is what `range` substitutes for invalid
bytes. If your data must round-trip, validate first.

## 4. `strings.Builder` internals

The Builder is a thin wrapper:

```go
// strings/builder.go (paraphrased)
type Builder struct {
    addr *Builder  // for copyCheck
    buf  []byte
}

func (b *Builder) String() string {
    // Reinterpret b.buf as a string without copying:
    return unsafe.String(unsafe.SliceData(b.buf), len(b.buf))
}

func (b *Builder) Grow(n int) {
    b.copyCheck()
    if n < 0 { panic("strings.Builder.Grow: negative count") }
    if cap(b.buf)-len(b.buf) < n {
        b.grow(n)
    }
}

func (b *Builder) copyCheck() {
    if b.addr == nil {
        // First use; remember this Builder's address.
        b.addr = (*Builder)(noescape(unsafe.Pointer(b)))
    } else if b.addr != b {
        panic("strings: illegal use of non-zero Builder copied by value")
    }
}
```

### Why `copyCheck` exists

A `strings.Builder` returned a string that aliases its buffer. If you
copied a partially-built Builder and continued writing to one of the
copies, both would see writes — or, worse, the previously-returned
string would mutate. The panic forces the bug to surface at the
first cross-write.

Acceptable patterns:

```go
var b strings.Builder       // OK: zero-value, never copied
b.WriteString("hello")
return b.String()            // OK

func makeBuilder() *strings.Builder { // OK: returns pointer
    return &strings.Builder{}
}
```

Broken pattern:

```go
func makeBuilder() strings.Builder { // BUG: returns by value
    var b strings.Builder
    b.WriteString("x")
    return b   // panics on next write to the returned value
}
```

### Growth strategy

`grow(n)` doubles capacity if `n` is small, otherwise it grows to
exactly `len(buf) + n`. The growth bytes come from a single `make`,
and the old contents are copied. If you know the final size, call
`Grow(N)` up front — one allocation total.

## 5. `bytes.Buffer` internals

```go
type Buffer struct {
    buf      []byte // contents are the bytes buf[off : len(buf)]
    off      int    // read at &buf[off], write at &buf[len(buf)]
    lastRead readOp // last operation, for UnreadByte/UnreadRune
}
```

Three things make `bytes.Buffer` interesting:

### 5.1 Small-buffer optimization

There's no `bootstrap` array in the modern source — the optimization
that used to live in `Buffer` (a 64-byte inline array) was removed
because `sync.Pool` plus a growable slice gave better results in the
common case. The current behavior: first `Write` triggers an initial
`make([]byte, 0, smallBufferSize)` where `smallBufferSize == 64`.

### 5.2 Reslice over realloc

When data is consumed from the front via `Read` or `Next`, `off`
advances; the underlying slice is not reallocated. Eventually a write
notices `len(buf) == off` and resets `off` to 0 to reclaim front
space without a copy. This is the same trick `bufio.Reader` uses.

### 5.3 The `ReadFrom` and `WriteTo` fast paths

`Buffer.ReadFrom(r)` is the fast way to drain an `io.Reader` into a
buffer. It calls `r.Read` directly into the buffer's tail capacity
when possible — no intermediate `[]byte`. Same for `Buffer.WriteTo`:
it calls `w.Write(b.Bytes())` once, then resets.

## 6. `IndexByte` is assembly

`strings.IndexByte` and `bytes.IndexByte` dispatch to per-architecture
assembly. On amd64 with SSE2 (every machine since ~2003), the
implementation processes 16 bytes per cycle using `PCMPEQB` and
`PMOVMSKB`. A hand-written `for` loop in Go produces one byte per
iteration; the speedup is typically 30×–50×.

This is why `strings.Index(s, "X")` is the right shape for "find
single byte" — internally, `Index(s, string)` checks for `len(sep) == 1`
and calls `IndexByte`. The fast path lights up automatically.

Less obvious: `strings.IndexAny(s, chars)` falls back to a loop when
`chars` has more than one character. For "any of a few bytes", a
custom `IndexFunc` plus an inline check can beat it.

## 7. Reading the assembly

```bash
go build -gcflags="-S" pkg.go 2>&1 | less
```

For `strings.IndexByte(s, '\n')` you'll see a single `CALL` into
`runtime.indexbytebody` (or `strings.IndexByte` directly, depending
on inlining). On amd64 this is:

```asm
PCMPEQB X1, X0       ; compare 16 bytes against target
PMOVMSKB X0, AX      ; pack the mask
TESTL AX, AX         ; any match?
JNZ found
```

You don't need to write asm; the lesson is that the stdlib's
primitives are usually the fastest correct option.

## 8. `strings.EqualFold` and `unicode.SimpleFold`

ASCII case-insensitive comparison is straightforward; Unicode is not.
German `ß` uppercases to `SS` (two characters); Turkish `i` does not
uppercase to `I`. `strings.EqualFold` implements Unicode "simple case
folding" which handles the common cases correctly:

```go
strings.EqualFold("Go", "GO")      // true
strings.EqualFold("straße", "STRASSE") // true
strings.EqualFold("İ", "i")        // false (Turkish dotted I)
```

For protocol identifiers like HTTP header names (which are ASCII-only
by spec), `EqualFold` is overkill — `bytes.EqualFold` with the
ASCII-only contract is faster. Modern `net/http` uses a dedicated
`http.CanonicalHeaderKey` that's faster still.

## 9. The `clone` problem and `strings.Clone`

When you receive a string that points into a larger buffer (e.g., a
`bufio.Scanner`'s `Bytes()` converted with `unsafe`), the original
backing array is alive as long as your substring is. To break the
link:

```go
// Go 1.18+:
s2 := strings.Clone(s)

// Pre-1.18 equivalent:
s2 := string([]byte(s))
```

`strings.Clone` always allocates a fresh backing array, even if
`s` is the empty string (where it returns the canonical "").

This is important when:

- You're caching strings extracted from a large request body.
- You're returning strings from a parser that uses pooled buffers.
- You're storing strings in long-lived maps after extracting them
  from a transient `[]byte`.

## 10. Concurrent use of `bytes.Buffer` and `strings.Builder`

**Neither is safe for concurrent use.** Both grow a backing slice;
unsynchronized concurrent writes race on the header and on the
copy-on-grow.

If you need a concurrent buffer, either:

1. Pool single-writer buffers and merge at the end (cheap).
2. Wrap with `sync.Mutex` (correct, slower).
3. Use `io.Pipe` and a single reader/writer per side (when streaming).

## 11. Custom `SplitFunc` for `bufio.Scanner`

Mixing this leaf with `bufio`: when you need to scan a binary protocol
where frames are length-prefixed, write a custom split function:

```go
func framedSplit(data []byte, atEOF bool) (advance int, token []byte, err error) {
    if len(data) < 4 {
        return 0, nil, nil  // need more data
    }
    length := binary.BigEndian.Uint32(data[:4])
    if len(data) < int(4+length) {
        return 0, nil, nil
    }
    return int(4 + length), data[4 : 4+length], nil
}

sc := bufio.NewScanner(conn)
sc.Buffer(make([]byte, 0, 1<<20), 1<<24)
sc.Split(framedSplit)
for sc.Scan() {
    frame := sc.Bytes()  // valid only until next Scan()
}
```

The returned `frame` is a view into the scanner's internal buffer.
If you need to keep it past the next `Scan`, copy it with
`append([]byte(nil), frame...)`.

## 12. Strings in maps: the cost of hashing

Go's map type hashes string keys with `runtime.aeshash` (on amd64
with AES-NI; falls back to MemHash elsewhere). The hash is O(key
length), not O(1). For a hot map keyed on long strings, the hash
itself can dominate.

Two common patterns:

1. Pre-hash and store an `uint64` key with the string in the value.
2. Use a fixed-size key (e.g., a SHA-1 prefix) if you control the
   space.

For maps keyed on short strings (HTTP header names, identifiers),
the hash cost is irrelevant. Don't over-optimize.

## 13. `strings.NewReader` vs `bytes.NewReader` — same shape, different ownership

`strings.NewReader(s)` and `bytes.NewReader(b)` both produce readers
with the same interface set. The difference is what they hold:

- `strings.NewReader` holds a string. Strings are immutable, so the
  reader is safe to keep past the lifetime of any other reference.
- `bytes.NewReader` holds a slice. Mutating the slice after wrapping
  it changes what the reader reads.

For tests that need an `io.Reader` over a literal, prefer
`strings.NewReader("...")` — no slice allocation, no aliasing risk.

## 14. Cross-references for the next layer

The professional file picks up from here:

- Pooling Builders and Buffers with `sync.Pool`, including the
  empty-pool case and the per-P caching cost.
- High-throughput sanitization with `Replacer` and `Map`.
- Streaming text transformation without `Split`/`Join`.
- A real-world benchmark: `+=` vs `Builder` vs `Sprintf` vs raw
  `append`.

For the underlying memory model, see the planned
`25-runtime-and-internals/` chapter (coming soon).
For pooling and `sync.Pool` semantics, see
[`../../07-concurrency/03-sync-package/01-mutexes/junior.md`](../../07-concurrency/03-sync-package/01-mutexes/junior.md).
