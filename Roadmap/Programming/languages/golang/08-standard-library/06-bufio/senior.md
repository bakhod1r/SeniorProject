# 8.6 `bufio` — Senior

> **Audience.** You've shipped Go services that depend on `bufio` and
> you've been bitten by at least one of: a forgotten `Flush`, an
> `ErrTooLong` that ate a token, or a `ReadSlice` that handed you stale
> bytes. This file is the precise contract: what each method
> guarantees, what it does *not*, and the systems-level details that
> separate "passes the test" from "behaves under load."

Prerequisites: [middle.md](middle.md) and the
`Reader`/`Writer`/`Closer` contracts in
[../01-io-and-file-handling/senior.md](../01-io-and-file-handling/senior.md).

## 1. The `bufio.Reader` invariants

The internal state of a `bufio.Reader` is, simplified:

```go
type Reader struct {
    buf      []byte
    rd       io.Reader
    r, w     int   // buf[r:w] is unread data
    err      error // sticky read error
    lastByte int   // for UnreadByte
    lastRune int   // for UnreadRune
}
```

- `0 <= r <= w <= len(buf)`.
- `buf[r:w]` is the bytes that have been read from `rd` but not yet
  consumed by the caller.
- `err` is sticky: once set, `bufio.Reader` returns it from every read
  until `Reset` clears it.
- `r == w` means the buffer is empty and the next user read triggers a
  fill from `rd`.

Implications:

1. **Buffered bytes are gone from `rd`'s view.** Once `bufio.Reader`
   has called `rd.Read` and pulled bytes into `buf`, those bytes are
   the bufio reader's; reading directly from `rd` skips them.

2. **Sticky errors block further reads.** A transient error from `rd`
   becomes permanent for the `bufio.Reader`. If you want to recover,
   `Reset(rd)` (or `Reset(other)`) clears the error — but you may also
   lose buffered bytes if they belong to before the error.

3. **`UnreadByte` and `UnreadRune` only work once.** They push the
   most recent successful `ReadByte`/`ReadRune` back. A second
   `UnreadByte` without an intervening `ReadByte` returns
   `bufio.ErrInvalidUnreadByte`.

## 2. Why `Read` may return less than the buffer holds

`(*bufio.Reader).Read(p []byte)` does not always fill `p`. The
implementation:

1. If `buf[r:w]` is non-empty, copy up to `len(p)` bytes from there
   into `p` and return.
2. Otherwise, if `len(p) >= len(buf)`, bypass the buffer and call
   `rd.Read(p)` directly. Return whatever that produced.
3. Otherwise, fill `buf` by calling `rd.Read(buf)`, then copy from
   `buf` into `p`.

In case 2 (large reads), the bufio buffer is bypassed. This is the
right behaviour — buffering only helps when the *user* reads in small
chunks. A 1 MiB `Read` call gets one underlying `Read` and copies
zero bytes through `bufio`'s buffer.

In case 1 (buffered data), you get whatever happens to be there —
possibly less than `len(p)`. That's fine if the caller is `io.Copy`
or any other helper that loops.

## 3. The `ErrNoProgress` watchdog

If an underlying `io.Reader` returns `(0, nil)` repeatedly,
`bufio.Reader` gives up after 100 such calls and returns
`io.ErrNoProgress`. This is a defence against buggy readers that would
otherwise cause `bufio` to spin forever.

```go
// Inside bufio.Reader.fill (paraphrased):
for i := maxConsecutiveEmptyReads; i > 0; i-- {
    n, err := b.rd.Read(b.buf[b.w:])
    b.w += n
    if err != nil { b.err = err; return }
    if n > 0 { return }
}
b.err = io.ErrNoProgress
```

You should never see this in production code with well-behaved
readers. If you do, the underlying reader is broken — file a bug or
fix the producer.

## 4. `ReadSlice` and the buffer-full case

`ReadSlice(delim)` returns a slice from the internal buffer, up to
and including `delim`. The error story is more nuanced than the
junior level admitted:

- Delimiter found in buffer: `(slice, nil)`.
- Delimiter not found, but buffer not full: `bufio.Reader` calls fill
  on the underlying reader and tries again.
- Delimiter not found *and* buffer full: `(slice, bufio.ErrBufferFull)`
  where `slice` is the entire buffer contents.
- Underlying reader hit EOF before finding delimiter: `(slice, io.EOF)`
  where `slice` is whatever was read (possibly empty).

The buffer-full case is recoverable: you can keep reading, and the
delimiter may appear after more data. You can also widen the buffer
(only by creating a new `bufio.Reader` with `NewReaderSize`) and
re-attempt. `ReadString` and `ReadBytes` handle this internally by
copying `slice` into a growing buffer and looping.

## 5. `ReadLine` — the inconvenient primitive

`ReadLine` is what `Scanner` uses internally. Its signature:

```go
func (b *Reader) ReadLine() (line []byte, isPrefix bool, err error)
```

- `line` is a slice into the internal buffer (no allocation).
- `isPrefix` is `true` if the line is longer than the buffer; the
  return is the first chunk and the rest comes on subsequent calls.
- `err` follows the standard EOF rules.

`ReadLine` strips the trailing `\r?\n` from the returned bytes. To
preserve it, use `ReadBytes('\n')` instead.

The `isPrefix` story is what makes `ReadLine` painful for direct use:
you have to glue chunks together yourself, and the slice is invalid
after the next call. Most code that wants line semantics goes through
`Scanner` (which handles the gluing) or `ReadString('\n')` (which
allocates a complete line).

## 6. The `Scanner` token-loss bug

`bufio.Scanner` with default settings has a 64 KiB token cap. When a
token exceeds it, the scanner advances *past* the long token and
returns `bufio.ErrTooLong` from `Err()`. The data of the offending
token is *lost* — there is no way to recover it from the scanner.

```go
// File has lines: "ok\n<70 KiB blob>\nalso ok\n"

s := bufio.NewScanner(f)
for s.Scan() {
    fmt.Println(s.Text())
}
err := s.Err()
// Output: "ok\nalso ok\n", err = bufio.ErrTooLong
// The 70 KiB blob is gone.
```

Worse: in some older versions, the scanner stops on `ErrTooLong`
without advancing past the bad token, so the next iteration would
try to parse the same too-long token again. Modern (Go 1.22) behaviour
is "advance and stop with error."

If your input might have long tokens:

1. Raise the cap with `s.Buffer(make([]byte, 0, init), max)`.
2. Or switch to `bufio.Reader.ReadBytes('\n')` for unbounded lines.
3. Or split with a custom `SplitFunc` that explicitly handles
   length-prefixed records, where length validation is the parser's
   responsibility.

Never silently retry past `ErrTooLong` and assume you got the data.

## 7. The `Scanner` "no progress" panic

If a custom `SplitFunc` returns `(0, nil, nil)` — "I need more data" —
and the scanner has already read everything available without making
progress, the scanner panics with `bufio.ErrFinalToken` (Go versions
vary on exact sentinel; the message is "Scan called after Scan
returned false" or "split function returned no progress").

A correct `SplitFunc` returns `(0, nil, nil)` only when more bytes
might arrive. When `atEOF` is true, you must either yield the
trailing data or return an error. Returning `(0, nil, nil)` with
`atEOF == true` is the bug.

```go
// CORRECT
if atEOF && len(data) > 0 {
    return len(data), data, nil
}
return 0, nil, nil

// WRONG — at EOF with no progress causes a panic
return 0, nil, nil
```

## 8. `ErrFinalToken` semantics

`bufio.ErrFinalToken` is a sentinel that lets a `SplitFunc` end
scanning cleanly with one last token:

```go
return advance, token, bufio.ErrFinalToken
```

When the scanner sees this:

1. If `token != nil`, it yields the token (next `Scan` returns true).
2. The next `Scan` call returns `false`, and `Err()` returns `nil`.

This is the only way to terminate scanning *cleanly* with a final
token in hand. Returning `(advance, token, io.EOF)` is wrong because
the scanner treats `io.EOF` as a real error and `Err()` reports it.

## 9. The `bufio.Writer` invariants

The internal state, simplified:

```go
type Writer struct {
    err error  // sticky write error
    buf []byte
    n   int    // bytes used in buf
    wr  io.Writer
}
```

- `0 <= n <= len(buf)`.
- `buf[:n]` is the buffered data not yet sent to `wr`.
- `err` is sticky: once any underlying `Write` fails, all subsequent
  writes return the same error. `Reset` clears it.

The `Flush` method sends `buf[:n]`. If the underlying `Write` returns
`m < n` with no error, that's an `io.ErrShortWrite`. If it returns an
error, the writer is poisoned: `err` is set, `n` is updated to reflect
how many bytes were actually sent, and future writes fail.

## 10. `Flush` is not "drain"

A successful `Flush` means the buffered bytes were handed to the
underlying writer. It does *not* mean those bytes hit the disk, the
network, or any final destination. For files, you need `f.Sync()`
after `bw.Flush()` (see
[../01-io-and-file-handling/senior.md](../01-io-and-file-handling/senior.md)
section 4–5).

For TCP, `Flush` returns when the bytes are in the kernel send buffer.
The peer might not have received them; the network might be down; the
connection might already be closed. `Flush` on a writer over a closed
TCP connection typically returns a `*net.OpError` wrapping `EPIPE` or
similar.

## 11. `Available` and `AvailableBuffer`

```go
func (b *Writer) Available() int        // = len(b.buf) - b.n
func (b *Writer) AvailableBuffer() []byte // = b.buf[b.n:b.n] (Go 1.18+)
```

`Available()` is the free byte count. `AvailableBuffer()` returns the
same memory as a zero-length slice with that capacity, suitable for
`append` calls that fill the buffer in place.

The contract for `AvailableBuffer`:

- The returned slice is borrowed from the writer's buffer.
- Any other operation on the writer (`Write`, `Flush`, `WriteByte`,
  etc.) invalidates the slice.
- The caller is expected to `append` to the slice and pass the result
  to `b.Write`. The writer detects that the slice is its own buffer
  and sets `n` directly without copying.

```go
buf := bw.AvailableBuffer()
buf = strconv.AppendInt(buf, x, 10)
buf = append(buf, '\n')
bw.Write(buf) // no copy; just bumps b.n by len(buf)
```

If the appends grow `buf` past `Available()`, the slice escapes to the
heap (Go's append rules) and `Write` falls back to a normal copy.
That's correct but loses the optimisation; size the buffer to fit your
typical record.

## 12. `Buffered` and partial flushes

`Buffered()` returns `n`, the number of bytes currently buffered.
After a successful `Flush`, `n == 0`. After a partial flush (the
underlying `Write` returned `m < n`), `n` is set to `n - m` and the
bytes `buf[:n]` shift left to start at zero. Subsequent writes append
to the new tail.

This means an `io.ErrShortWrite` does not lose data — the unwritten
suffix is still buffered, and a subsequent `Flush` will retry it.
Whether the retry succeeds depends on why the previous one failed; for
network writes after `EPIPE`, retries don't help.

## 13. `ReadFrom` short-circuits the buffer

`(*bufio.Writer).ReadFrom(r io.Reader)` is the fast path for `io.Copy`
where the destination is a `bufio.Writer`:

```go
io.Copy(bw, r) // calls bw.ReadFrom(r)
```

The implementation, simplified:

1. Drain the buffer first (one underlying `Write` of `buf[:n]`).
2. Loop: read directly into the buffer's free space, then write that
   from the buffer to the underlying writer.
3. If the underlying writer also implements `ReaderFrom`, hand off
   to it after the buffer drain.

The point: large copies don't double-buffer. The bytes do go through
`bufio`'s buffer briefly, but they are not split into 4 KiB chunks
and re-assembled — the buffer is filled to capacity, written in one
call, then refilled.

## 14. `WriteTo` on `bufio.Reader`

`(*bufio.Reader).WriteTo(w io.Writer)` is the symmetric fast path
for `io.Copy(w, br)`:

1. Send `buf[r:w]` to `w` first (drain buffered bytes).
2. If the underlying reader implements `WriterTo`, defer to it.
3. Otherwise, loop: read into `buf` and write to `w`.

The total bytes returned is the sum across all phases. The first
error from `w.Write` or `rd.Read` stops the loop and is returned (EOF
is normalised to `nil` on the return).

## 15. The full method-by-method allocation table

| Method | Allocates? | Notes |
|--------|-----------|-------|
| `bufio.NewReader(r)` | Yes (4096-byte buffer + Reader struct) | Once per call |
| `bufio.NewReaderSize(r, n)` | Yes if `n != existing buffer size` | Reuses if `r` is already a `*bufio.Reader` of size `>= n` |
| `Reader.Read(p)` | No | Possibly bypasses buffer if `len(p) >= bufsize` |
| `Reader.ReadByte` | No | |
| `Reader.UnreadByte` | No | |
| `Reader.ReadRune` | No | |
| `Reader.UnreadRune` | No | |
| `Reader.ReadSlice(delim)` | No | Slice into buffer |
| `Reader.ReadBytes(delim)` | Yes (one per call) | Copy of slice |
| `Reader.ReadString(delim)` | Yes (one string per call) | |
| `Reader.ReadLine` | No | Slice into buffer |
| `Reader.Peek(n)` | No | Slice into buffer |
| `Reader.Discard(n)` | No | |
| `Reader.Buffered` | No | |
| `Reader.Reset(r)` | No | |
| `bufio.NewWriter(w)` | Yes | |
| `Writer.Write(p)` | No | |
| `Writer.WriteByte(c)` | No | |
| `Writer.WriteRune(r)` | No | |
| `Writer.WriteString(s)` | No | |
| `Writer.AvailableBuffer` | No | Slice into buffer |
| `Writer.Flush` | No | |
| `Writer.Reset(w)` | No | |
| `Writer.ReadFrom(r)` | No | Buffer-only |
| `bufio.NewScanner(r)` | Yes (Scanner struct, no buffer yet) | |
| `Scanner.Scan` | No (after first call) | First call allocates the buffer |
| `Scanner.Bytes` | No | Slice into buffer |
| `Scanner.Text` | Yes (one string per call) | |
| `Scanner.Buffer(buf, max)` | Maybe | Replaces buffer; allocates if `cap(buf) == 0` |

## 16. `Reset` reset semantics

For both `Reader` and `Writer`, `Reset(x)`:

- Clears `err` to nil.
- Resets `r`, `w` (Reader) or `n` (Writer) to zero.
- Discards any buffered bytes — they are lost.
- Reuses the existing internal buffer.

For `Reader`, this means: after `br.Reset(other)`, any unread bytes
that were buffered from the *previous* source are gone. Don't `Reset`
in the middle of a stream and expect the bytes to come back.

For `Writer`, this is more dangerous: any unflushed bytes in the
buffer are silently dropped. `Reset` does not flush. If you forget to
`Flush` before `Reset`, you lose data without an error.

```go
// CORRECT
bw.Flush()
bw.Reset(newWriter)

// WRONG — silently discards bw's pending bytes
bw.Reset(newWriter)
```

## 17. `Scanner` cannot be reused

`bufio.Scanner` does not have a `Reset` method. Once it has scanned a
source to completion (or to error), you must allocate a new
`bufio.Scanner` to scan another source. Pooling scanners is harder
than pooling readers/writers — it requires managing the underlying
`bufio.Reader` separately and reconstructing the scanner around it.

In practice, the cost of allocating a `bufio.Scanner` is small (the
struct is ~88 bytes plus the buffer it lazily allocates). Don't bend
over backwards to pool them; pool the underlying `*os.File` /
`net.Conn` instead.

## 18. Concurrency, exactly

| Type | Safe for concurrent calls? |
|------|---------------------------|
| `*bufio.Reader` | No. All methods touch shared state. |
| `*bufio.Writer` | No. All methods touch shared state. |
| `*bufio.Scanner` | No. |
| `*bufio.ReadWriter` | No (it's just two unsafe values). |

The standard rule: one `bufio.*` value per goroutine. If you need to
share a connection across goroutines, build a worker pattern — one
goroutine owns the bufio reader and dispatches messages via channels.

The `Reset` method is *not* a synchronisation point. Calling `Reset`
from one goroutine while another is mid-`Read` is a data race that
the Go race detector will report.

## 19. `bufio.Writer.WriteRune` and the `\xC0` trap

`WriteRune(r)` writes `utf8.RuneLen(r)` bytes for valid runes. For
`r < 0` or `r > utf8.MaxRune` (invalid UTF-8), it writes the UTF-8
encoding of `utf8.RuneError` (which is `\xEF\xBF\xBD`, the Unicode
replacement character). It does *not* return an error for an invalid
rune — the substitution is silent.

If you need strict validation, check with `utf8.ValidRune` first.

## 20. `bufio.Reader.ReadRune` and surrogate pairs

`ReadRune` returns one rune per call. If the source contains an
invalid UTF-8 sequence, `ReadRune` returns `(utf8.RuneError, 1, nil)`
— one byte consumed, the replacement rune yielded. This is the same
behaviour as `utf8.DecodeRune`.

`UnreadRune` after `ReadRune` returned `RuneError` works only if the
read was a valid rune. After an invalid sequence, `UnreadRune` returns
`bufio.ErrInvalidUnreadRune`.

## 21. `Scanner.Buffer` ordering rule

`Scanner.Buffer(buf, max)` must be called before the first `Scan`.
After the first `Scan`, calling `Buffer` panics with "Buffer called
after Scan." The reason: the scanner has already started using its
internal buffer, and reseating it mid-scan would lose buffered data.

The same rule applies to `Scanner.Split`. Configure your scanner
fully, then start the loop.

## 22. The interaction of `bufio.Writer` and `O_APPEND`

A file opened with `os.O_APPEND` causes every kernel `write(2)` to
seek to end-of-file before writing. This is atomic per-syscall —
multiple processes appending to the same file get whole-write
interleaving, never byte-interleaving (as long as each `write(2)` is
under `PIPE_BUF`, typically 4 KiB).

A `bufio.Writer` over an `O_APPEND` file batches writes. When
`Flush` runs, the whole buffer is written in one syscall. If the
buffer is under `PIPE_BUF`, multi-process appending is still safe.
Above that, the kernel may split the write into multiple
`write(2)` calls, each of which seeks-to-end independently —
interleaving with other appenders.

For multi-process log appending, keep `bufio.Writer.Size()` at or
below `PIPE_BUF` (4 KiB on Linux). Or skip `bufio` and write directly
with `O_APPEND`, accepting one syscall per record.

## 23. `bufio.Writer` does not implement `Close`

There is no `Close` method on `*bufio.Writer`. Code that does
`bw.Close()` does not compile. The decision is intentional: `bufio`
doesn't own the underlying writer; it only buffers. Closing the
underlying is the caller's responsibility, after `Flush`.

If you compose a `bufio.Writer` into a struct that wraps a closeable,
your struct's `Close` method is the right place to do
`Flush(); underlying.Close()`. Stdlib examples: `zip.Writer`,
`gzip.Writer`, `csv.Writer` all do something similar.

## 24. The order of operations for a layered output stack

```
caller writes
  -> json.Encoder
    -> gzip.Writer
      -> bufio.Writer
        -> os.File
```

Close order, in `defer` (LIFO):

```go
f, _ := os.Create("out.json.gz")
defer f.Close()           // 4: closes file

bw := bufio.NewWriter(f)
defer bw.Flush()          // 3: pushes bytes to f

gz := gzip.NewWriter(bw)
defer gz.Close()          // 2: writes gzip trailer to bw

enc := json.NewEncoder(gz) // no Close needed
// ... encode ...
```

Reverse the encoder (1) → gzip (2) → bufio (3) → file (4) order and
the file ends up missing the gzip trailer or the last few KiB of data.
Get the order right, check every error, and the layered stack works.

The correct version with error checking:

```go
func writeJSONGZ(path string, items []Item) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); err == nil { err = cerr }
    }()

    bw := bufio.NewWriter(f)
    gz := gzip.NewWriter(bw)
    enc := json.NewEncoder(gz)

    for _, it := range items {
        if err = enc.Encode(it); err != nil { return err }
    }
    if err = gz.Close(); err != nil { return err }
    return bw.Flush()
}
```

## 25. What to read next

- [professional.md](professional.md) — large-scale production patterns.
- [specification.md](specification.md) — every method and error in tables.
- [optimize.md](optimize.md) — measured guidance on buffer sizes.
- [find-bug.md](find-bug.md) — drills targeting items in this file.
- The `bufio` package source is small and worth reading. Start at
  [src/bufio/bufio.go](https://cs.opensource.google/go/go/+/refs/tags/go1.22.0:src/bufio/bufio.go).
