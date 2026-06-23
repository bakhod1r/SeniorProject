# 8.6 `bufio` — Specification

Reference material. Method signatures, semantics, errors, defaults.
Distilled from the Go 1.22 standard library, with implementation notes
the docs leave implicit.

For prose, see [senior.md](senior.md). For the foundational
`Reader`/`Writer` contracts that `bufio` builds on, see
[../01-io-and-file-handling/specification.md](../01-io-and-file-handling/specification.md).

## 1. Constants and defaults

| Constant / default | Value | Meaning |
|--------------------|-------|---------|
| `bufio.MaxScanTokenSize` | 65536 | Default `Scanner` token cap |
| Default reader buffer | 4096 | `bufio.NewReader(r)` |
| Default writer buffer | 4096 | `bufio.NewWriter(w)` |
| Minimum reader buffer | 16 | Smaller requests bumped up |
| Minimum writer buffer | 16 | Smaller requests bumped up |
| `maxConsecutiveEmptyReads` | 100 | Internal: triggers `io.ErrNoProgress` |

## 2. Sentinel errors

| Error | Source | Meaning |
|-------|--------|---------|
| `bufio.ErrInvalidUnreadByte` | `Reader.UnreadByte` | No prior `ReadByte` to undo |
| `bufio.ErrInvalidUnreadRune` | `Reader.UnreadRune` | No prior `ReadRune` to undo |
| `bufio.ErrBufferFull` | `Reader.ReadSlice`, `Reader.Peek` | Delimiter or peek size exceeds buffer |
| `bufio.ErrNegativeCount` | `Reader.Discard` | Negative `n` |
| `bufio.ErrTooLong` | `Scanner.Err` | Token larger than configured cap |
| `bufio.ErrNegativeAdvance` | `Scanner.Err` | `SplitFunc` returned `advance < 0` |
| `bufio.ErrAdvanceTooFar` | `Scanner.Err` | `SplitFunc` returned `advance > len(data)` |
| `bufio.ErrBadReadCount` | `Scanner.Err` | Underlying reader returned more than `len(buf)` |
| `bufio.ErrFinalToken` | (sentinel; not returned via `Err()`) | Used by `SplitFunc` to yield one last token and stop cleanly |
| `io.ErrNoProgress` | `Reader.Read` | Underlying reader returned `(0, nil)` 100 times |

## 3. `bufio.Reader` constructors

```go
func NewReader(rd io.Reader) *Reader
func NewReaderSize(rd io.Reader, size int) *Reader
```

| Behaviour | Detail |
|-----------|--------|
| `NewReader(rd)` | Equivalent to `NewReaderSize(rd, 4096)` |
| Existing `*Reader` of adequate size | Returned as-is to avoid double-buffering |
| `size < 16` | Silently raised to 16 |

## 4. `bufio.Reader` methods

| Method | Signature | Returns | Allocates? |
|--------|-----------|---------|-----------|
| `Read` | `(p []byte) (n int, err error)` | Bytes read, possibly fewer than `len(p)` | No |
| `ReadByte` | `() (byte, error)` | One byte; `(0, io.EOF)` at end | No |
| `UnreadByte` | `() error` | nil or `ErrInvalidUnreadByte` | No |
| `ReadRune` | `() (r rune, size int, err error)` | UTF-8 rune; `(RuneError, 1, nil)` for invalid sequence | No |
| `UnreadRune` | `() error` | nil or `ErrInvalidUnreadRune` | No |
| `ReadSlice` | `(delim byte) ([]byte, error)` | Slice into buffer, valid until next read | No |
| `ReadBytes` | `(delim byte) ([]byte, error)` | Owned copy, including delimiter | Yes (one) |
| `ReadString` | `(delim byte) (string, error)` | String, including delimiter | Yes (one) |
| `ReadLine` | `() (line []byte, isPrefix bool, err error)` | Slice into buffer; `isPrefix` if line exceeds buffer | No |
| `Peek` | `(n int) ([]byte, error)` | Slice of next `n` bytes; valid until next read | No |
| `Discard` | `(n int) (discarded int, err error)` | Bytes actually skipped | No |
| `Buffered` | `() int` | Bytes currently in internal buffer | No |
| `Size` | `() int` | Buffer capacity | No |
| `Reset` | `(r io.Reader)` | Reuses buffer with new source; discards buffered data and clears error | No |
| `WriteTo` | `(w io.Writer) (n int64, err error)` | Drains buffer + remainder of source into `w` | No |

### `ReadSlice` error matrix

| Condition | Result |
|-----------|--------|
| Delimiter found in buffer | `(slice, nil)` |
| Buffer full, no delimiter | `(entire buffer, ErrBufferFull)` |
| Source returned EOF before delimiter | `(slice, io.EOF)` with `slice` = remaining data |
| Source error | `(slice, err)` |

### `Peek` error matrix

| Condition | Result |
|-----------|--------|
| `n` bytes available | `(buf[r:r+n], nil)` |
| `n` exceeds buffer size | `(buf[r:w], ErrBufferFull)` |
| Source EOF before `n` bytes | `(partial, io.EOF)` |

### `Read` behaviour

| `len(p)` | Buffer state | Action |
|----------|--------------|--------|
| 0 | any | Returns `(0, nil)` |
| any | non-empty | Copy from buffer to `p`; never refills |
| `>= bufferSize` | empty | Bypass buffer; `rd.Read(p)` directly |
| `< bufferSize` | empty | Fill buffer with `rd.Read(buf)`, copy to `p` |

## 5. `bufio.Writer` constructors

```go
func NewWriter(w io.Writer) *Writer
func NewWriterSize(w io.Writer, size int) *Writer
```

| Behaviour | Detail |
|-----------|--------|
| `NewWriter(w)` | Equivalent to `NewWriterSize(w, 4096)` |
| Existing `*Writer` of adequate size | Returned as-is |
| `size < 16` | Silently raised to 16 |

## 6. `bufio.Writer` methods

| Method | Signature | Returns | Allocates? |
|--------|-----------|---------|-----------|
| `Write` | `(p []byte) (n int, err error)` | Bytes written from `p` | No |
| `WriteByte` | `(c byte) error` | nil or sticky error | No |
| `WriteRune` | `(r rune) (size int, err error)` | UTF-8 byte count | No |
| `WriteString` | `(s string) (n int, err error)` | Bytes from `s` written | No |
| `Flush` | `() error` | Pushes buffered bytes to underlying | No |
| `Available` | `() int` | Free bytes in buffer | No |
| `AvailableBuffer` | `() []byte` | Slice with `len 0`, `cap = Available()` (Go 1.18+) | No |
| `Buffered` | `() int` | Bytes currently buffered | No |
| `Size` | `() int` | Buffer capacity | No |
| `Reset` | `(w io.Writer)` | Reuses buffer with new sink; discards buffered data and clears error | No |
| `ReadFrom` | `(r io.Reader) (n int64, err error)` | Drains `r` into the writer (buffered + bypass for large copies) | No |

### Flush semantics

- Pushes `buf[:n]` to the underlying writer in one call.
- If the underlying `Write` returns `m < n` with `err == nil`, error is
  `io.ErrShortWrite`; remaining `buf[n-m:n]` shifts to `buf[:n-m]`.
- If underlying `Write` returns an error, error is sticky in
  `b.err`; `n` updated to reflect actual bytes sent.

### `bufio.Writer` has no `Close` method

Caller must `Flush` then close the underlying writer. `bufio.Writer`
deliberately does not own the sink.

## 7. `bufio.ReadWriter`

```go
type ReadWriter struct {
    *Reader
    *Writer
}

func NewReadWriter(r *Reader, w *Writer) *ReadWriter
```

A pair of pointers, no methods of its own. All `Reader` and `Writer`
methods are inherited via embedding. Reads do not flush writes. The
two halves share no state; you can pair any `*Reader` with any
`*Writer`.

## 8. `bufio.Scanner` constructor

```go
func NewScanner(r io.Reader) *Scanner
```

Lazy: the internal buffer is allocated on the first call to `Scan`.

## 9. `bufio.Scanner` methods

| Method | Signature | Behaviour |
|--------|-----------|-----------|
| `Scan` | `() bool` | Advance to next token; `false` at EOF or error |
| `Bytes` | `() []byte` | Slice of current token; **invalid after next `Scan`** |
| `Text` | `() string` | String copy of `Bytes()` |
| `Err` | `() error` | First non-EOF scan error, or nil |
| `Buffer` | `(buf []byte, max int)` | Set initial buffer and max token size; **must be called before first `Scan`**, else panics |
| `Split` | `(SplitFunc)` | Set the split function; **must be called before first `Scan`**, else panics |

Default split: `bufio.ScanLines`.
Default `max`: `bufio.MaxScanTokenSize` (65536).

## 10. `bufio.SplitFunc`

```go
type SplitFunc func(data []byte, atEOF bool) (advance int, token []byte, err error)
```

| Return | Meaning |
|--------|---------|
| `(0, nil, nil)` | Need more data; scanner reads more from source |
| `(advance, nil, nil)` | Consume `advance` bytes; produce no token |
| `(advance, token, nil)` | Consume `advance` bytes; yield `token` |
| `(advance, token, err)` | Yield `token` if non-nil, then stop with `err` |
| `(advance, token, ErrFinalToken)` | Yield `token`, then `Scan` returns false with `Err() == nil` |

Constraints:
- `advance >= 0`. Negative advance triggers `ErrNegativeAdvance`.
- `advance <= len(data)`. Larger triggers `ErrAdvanceTooFar`.
- At `atEOF == true && len(data) > 0`, returning `(0, nil, nil)` is a
  bug; the scanner panics.

## 11. Built-in `SplitFunc`s

| Function | Token | Notes |
|----------|-------|-------|
| `bufio.ScanBytes` | One byte at a time | `len(token) == 1` per call |
| `bufio.ScanRunes` | One UTF-8 rune | Invalid sequence becomes `RuneError` (3-byte token) |
| `bufio.ScanWords` | Whitespace-separated tokens | Whitespace per `unicode.IsSpace` |
| `bufio.ScanLines` | Lines | Strips trailing `\r\n` or `\n` |

## 12. `Scanner` token-loss behaviour

| Condition | Result |
|-----------|--------|
| Token > buffer cap | `Scan` returns false, `Err() == ErrTooLong`; the long token is lost |
| `SplitFunc` returns error | Yields final token if any, then `Scan` returns false, `Err()` reports the error |
| `SplitFunc` returns `ErrFinalToken` | Yields final token, then `Scan` returns false, `Err() == nil` |
| Source returns non-EOF error | Final partial-buffer token may be yielded; `Err()` reports source error |

## 13. Concurrency table

| Type | Concurrent reads | Concurrent writes | Mixed |
|------|------------------|-------------------|-------|
| `*bufio.Reader` | Unsafe | n/a | n/a |
| `*bufio.Writer` | n/a | Unsafe | n/a |
| `*bufio.Scanner` | Unsafe | n/a | n/a |
| `*bufio.ReadWriter` | Inherits each side's unsafety | Same | Same |

`Reset` is not a synchronisation point. Calling `Reset` from one
goroutine while another is mid-method is a race detected by `-race`.

## 14. Method-by-method allocation

| Surface | Allocates? | Per call cost |
|---------|-----------|---------------|
| `NewReader` / `NewReaderSize` | Yes | One buffer + struct |
| `Reader.Read` | No | — |
| `Reader.ReadByte` / `WriteByte` | No | — |
| `Reader.ReadSlice` / `ReadLine` / `Peek` | No | Slice into existing buffer |
| `Reader.ReadBytes` / `ReadString` | Yes | One copy of the token |
| `Reader.Discard` / `Buffered` / `Size` | No | — |
| `Reader.Reset` | No | — |
| `Reader.WriteTo` | No | — |
| `NewWriter` / `NewWriterSize` | Yes | One buffer + struct |
| `Writer.Write` / `WriteByte` / `WriteRune` / `WriteString` | No | — |
| `Writer.AvailableBuffer` | No | Slice into buffer |
| `Writer.Flush` / `Reset` | No | — |
| `Writer.ReadFrom` | No | — |
| `NewScanner` | Yes | Struct only (buffer lazy) |
| `Scanner.Scan` (after first) | No | — |
| `Scanner.Bytes` | No | Slice into buffer |
| `Scanner.Text` | Yes | One string copy per call |
| `Scanner.Buffer(buf, max)` | Maybe | Replaces buffer; if `cap(buf) > 0`, reuses |

## 15. Layered close order

For a stack of `os.File` → `bufio.Writer` → codec writer (gzip, etc.):

1. Close codec writer (writes its trailer into bufio).
2. Flush bufio writer (pushes all bytes to file).
3. Close file.

In `defer` form (LIFO), declare in reverse: file close, bufio flush,
codec close. The first-declared defer runs last.

## 16. `bufio.Writer.ReadFrom` short-circuit

`io.Copy(bw, r)` invokes `bw.ReadFrom(r)`. The implementation:

1. If buffer has bytes, drain via underlying `Write`.
2. If underlying writer implements `io.ReaderFrom`, defer to it.
3. Otherwise, loop: fill buffer from `r`, write to underlying.

Returns total bytes written; first error stops the loop.

## 17. `bufio.Reader.WriteTo` short-circuit

`io.Copy(w, br)` invokes `br.WriteTo(w)`. The implementation:

1. Send buffered bytes (`buf[r:w]`) to `w`.
2. If underlying reader implements `io.WriterTo`, defer to it.
3. Otherwise, loop: read into buffer, write to `w`.

Returns total bytes; first error stops the loop. EOF normalised to nil
on return.

## 18. `Scanner` cannot be reused

There is no `Reset` method on `Scanner`. After `Scan` returns false,
the scanner is done. Construct a new `Scanner` for a new source.
Pooling the underlying buffer is possible but rarely worth the
complexity; pool the underlying source instead.

## 19. Build-time / type information

```go
type Reader struct { /* unexported */ }
type Writer struct { /* unexported */ }
type Scanner struct { /* unexported */ }
type ReadWriter struct {
    *Reader
    *Writer
}
type SplitFunc func(data []byte, atEOF bool) (advance int, token []byte, err error)
```

All of `Reader`, `Writer`, `Scanner` have unexported fields; you must
use the constructors to create them.

`Reader` implements `io.Reader`, `io.ByteReader`, `io.RuneReader`,
`io.WriterTo`.
`Writer` implements `io.Writer`, `io.ByteWriter`, `io.StringWriter`,
`io.ReaderFrom`.

## 20. What to read next

- [senior.md](senior.md) — prose form of these tables with examples.
- [find-bug.md](find-bug.md) — bugs that result from violating items
  above.
- [optimize.md](optimize.md) — performance implications of the
  defaults.
