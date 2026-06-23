# 8.6 `bufio` — Middle

> **Audience.** You've written code with `bufio.Scanner` and
> `bufio.Writer`, you remember to `Flush`, and you're starting to hit
> the corners — long tokens, framed protocols, parsing where allocation
> matters. This file covers the methods you reach for once the basics
> aren't enough: `ReadSlice`, `Peek` for protocol detection,
> `AvailableBuffer`, custom `SplitFunc`, framed wire formats,
> connection pooling with `Reset`.

Assumed prerequisite: [junior.md](junior.md) and the composition
chapter of
[../01-io-and-file-handling/middle.md](../01-io-and-file-handling/middle.md).

## 1. `ReadSlice` — fast and dangerous

`ReadSlice(delim byte)` returns a slice into the `bufio.Reader`'s
internal buffer, up to and including the delimiter. No copy, no
allocation:

```go
br := bufio.NewReader(conn)
line, err := br.ReadSlice('\n')
// line is valid right now
process(line)
// line is INVALID after this point — the next read may overwrite it
_, _ = br.ReadByte()
// using `line` here is undefined behaviour
```

The contract: the returned slice is valid only until the next read on
the same `bufio.Reader`. Any read — `ReadByte`, another `ReadSlice`,
`Read`, `Discard`, `Peek` — invalidates the slice.

`ReadSlice` returns `bufio.ErrBufferFull` if the delimiter does not
appear in the entire buffer. The buffer-full error is recoverable: the
data is still buffered, you just can't get a single slice that ends at
the delimiter. `ReadString` and `ReadBytes` handle this internally by
allocating a growable buffer; `ReadSlice` makes you own the choice.

When to use `ReadSlice`:

- You'll consume the bytes immediately and not keep them.
- You want zero allocations per record (parsers, log shippers, hot
  loops).
- Your records fit in the buffer (configure `NewReaderSize` accordingly).

When to use `ReadBytes`/`ReadString` instead:

- You'll keep the bytes past the next read.
- Records can be arbitrarily large.
- You don't have a budget tight enough for the allocation to matter.

## 2. `Peek` for protocol detection

`Peek(n)` is the right tool for "what kind of stream is this?" checks:

```go
func detect(br *bufio.Reader) string {
    head, err := br.Peek(4)
    if err != nil { return "unknown" }
    switch {
    case head[0] == 0x1f && head[1] == 0x8b:
        return "gzip"
    case head[0] == 'P' && head[1] == 'K' && head[2] == 0x03 && head[3] == 0x04:
        return "zip"
    case bytes.HasPrefix(head, []byte("HTTP")):
        return "http"
    }
    return "unknown"
}
```

The bytes are still there for the next read. The downstream code (the
gzip reader, the HTTP parser) sees the same prefix that `Peek`
returned. This is how `net/http`, `crypto/tls`, and many other parsers
do connection sniffing without rewinding.

If `Peek(n)` cannot return `n` bytes (EOF reached, source error), it
returns whatever it has plus a non-nil error. `bufio.ErrBufferFull` if
`n` exceeds the buffer; allocate a larger buffer with `NewReaderSize`
when the protocol prologue is large.

## 3. `Buffered` and `Discard` for framing

`Buffered()` tells you how many bytes are sitting in the internal
buffer right now. Combined with `Discard`, you can build framing
parsers that don't allocate:

```go
// Read a length-prefixed frame.
header, err := br.Peek(4)
if err != nil { return err }
n := int(binary.BigEndian.Uint32(header))

if br.Buffered() >= 4+n {
    // The whole frame is already buffered.
    br.Discard(4)
    body, _ := br.Peek(n)
    handle(body)
    br.Discard(n)
    return nil
}
// Frame straddles the buffer; fall back to a copy.
buf := make([]byte, 4+n)
if _, err := io.ReadFull(br, buf); err != nil {
    return err
}
handle(buf[4:])
return nil
```

The fast path (whole frame buffered) is zero-allocation. The slow path
(frame larger than buffer or not yet fully read) takes one allocation.
This shape — peek, branch on `Buffered`, allocate only if needed — is
the bread and butter of high-throughput protocol parsing in Go.

## 4. `AvailableBuffer` (Go 1.18+)

`(*bufio.Writer).AvailableBuffer()` returns a slice with `cap` equal to
the writer's free space and `len == 0`. You append to it, then pass it
to `Write`:

```go
bw := bufio.NewWriterSize(f, 64*1024)

buf := bw.AvailableBuffer() // borrowed slice, len 0, cap = Available()
buf = strconv.AppendInt(buf, n, 10)
buf = append(buf, '\n')
bw.Write(buf) // copies into the buffer (no syscall yet)
```

The point: `strconv.AppendInt` and `append` write directly into the
writer's buffer area without allocating. The `Write` call at the end
just bumps the buffer's length — no actual copy when the source is
already the same memory.

Compare with the naive version:

```go
s := strconv.Itoa(n) + "\n"  // allocates a string
bw.WriteString(s)            // copies the string into the buffer
```

For million-line numeric output, `AvailableBuffer` is roughly 2x
faster and produces zero garbage. Stdlib's `fmt` package uses similar
tricks internally.

Caveats: the slice is invalidated by any other operation on the
writer. Build, write, drop reference. Don't keep the slice across
calls.

## 5. Custom `SplitFunc` — the framework

```go
type SplitFunc func(data []byte, atEOF bool) (advance int, token []byte, err error)
```

The scanner calls your function with whatever bytes it has buffered.
You return:

- `advance` — how many bytes to drop from the front (consumed).
- `token` — the next logical record to yield, or `nil` if you need
  more data.
- `err` — terminate scanning (or `bufio.ErrFinalToken` to yield this
  one and then stop cleanly).

Three forms of return:

| Return | Meaning |
|--------|---------|
| `(0, nil, nil)` | Need more data; scanner reads more from the source |
| `(advance, nil, nil)` | Consume `advance` bytes but produce no token (skip whitespace, headers, etc.) |
| `(advance, token, nil)` | Consume `advance` bytes, yield `token` |
| `(advance, token, err)` | Yield `token` (if non-nil) then stop with `err` |

`atEOF` is `true` when the source has signalled EOF. Your last chance
to drain trailing data without a delimiter — if `atEOF && len(data) >
0`, return what's left as a token, or return an error if a partial
record is unrecoverable.

## 6. `scanCRLF` — the CRLF-only line splitter

The default `bufio.ScanLines` accepts both `\r\n` and `\n` as line
terminators, and silently strips a trailing `\r` from the token.
Sometimes you want strict CRLF (HTTP, SMTP, IRC):

```go
func scanCRLF(data []byte, atEOF bool) (int, []byte, error) {
    if i := bytes.Index(data, []byte("\r\n")); i >= 0 {
        return i + 2, data[:i], nil
    }
    if atEOF && len(data) > 0 {
        return len(data), data, nil
    }
    return 0, nil, nil
}

s := bufio.NewScanner(conn)
s.Split(scanCRLF)
```

A bare `\n` no longer ends a line. A line with only `\r` and no `\n`
yields nothing until either a `\n` arrives or EOF (in which case the
trailing data becomes the last token).

## 7. Length-prefixed records

Wire formats often prefix each record with a fixed-length count:

```go
func scanLPR(data []byte, atEOF bool) (int, []byte, error) {
    if len(data) < 4 {
        if atEOF && len(data) > 0 {
            return 0, nil, io.ErrUnexpectedEOF
        }
        return 0, nil, nil
    }
    n := int(binary.BigEndian.Uint32(data[:4]))
    if n < 0 || n > maxRecord {
        return 0, nil, fmt.Errorf("record length %d out of range", n)
    }
    if 4+n > len(data) {
        if atEOF {
            return 0, nil, io.ErrUnexpectedEOF
        }
        return 0, nil, nil
    }
    return 4 + n, data[4 : 4+n], nil
}
```

Pair this with a buffer large enough to hold the largest record:

```go
s := bufio.NewScanner(r)
s.Buffer(make([]byte, 0, 64*1024), maxRecord+4)
s.Split(scanLPR)
```

Without `s.Buffer`, the default 64 KiB cap will reject any record over
~64 KiB.

## 8. Netstrings (`<n>:<bytes>,`)

DJB's netstrings: a length in ASCII, a colon, the bytes, a trailing
comma:

```go
func scanNetstring(data []byte, atEOF bool) (int, []byte, error) {
    colon := bytes.IndexByte(data, ':')
    if colon < 0 {
        if atEOF { return 0, nil, io.ErrUnexpectedEOF }
        return 0, nil, nil
    }
    n, err := strconv.Atoi(string(data[:colon]))
    if err != nil { return 0, nil, fmt.Errorf("bad length: %w", err) }
    end := colon + 1 + n + 1 // colon + body + comma
    if end > len(data) {
        if atEOF { return 0, nil, io.ErrUnexpectedEOF }
        return 0, nil, nil
    }
    if data[end-1] != ',' {
        return 0, nil, fmt.Errorf("missing trailing comma")
    }
    return end, data[colon+1 : colon+1+n], nil
}
```

The pattern repeats for any framing: read enough to know the length,
then wait until enough bytes are available, then yield.

## 9. `ErrFinalToken` — clean stop after one more token

Sometimes you want to yield one final token and then stop scanning,
without raising an error:

```go
const sentinel = "END"

func scanUntilEnd(data []byte, atEOF bool) (int, []byte, error) {
    if i := bytes.IndexByte(data, '\n'); i >= 0 {
        line := data[:i]
        if string(line) == sentinel {
            return i + 1, line, bufio.ErrFinalToken
        }
        return i + 1, line, nil
    }
    if atEOF && len(data) > 0 {
        return len(data), data, bufio.ErrFinalToken
    }
    return 0, nil, nil
}
```

When the split function returns `bufio.ErrFinalToken`, the scanner
yields the token (you must check `s.Scan()` returns `true`), then on
the next call returns `false` with `s.Err() == nil` (clean stop). Use
it for streams with an in-band terminator that you want to surface to
the user *and* stop cleanly.

Without `ErrFinalToken`, you'd have to either (a) yield the sentinel
and let the scanner keep going past EOF, or (b) return a real error
that the caller has to filter out.

## 10. Raising `Buffer` for the whole scan

```go
const (
    initialBuf = 64 * 1024
    maxToken   = 4 * 1024 * 1024
)

s := bufio.NewScanner(r)
s.Buffer(make([]byte, 0, initialBuf), maxToken)
s.Split(bufio.ScanLines)
```

`Buffer(buf, max)` must be called before the first `Scan`. After the
first `Scan`, calling `Buffer` panics. The scanner allocates a fresh
buffer of the size you pass; it does not grow above `max`.

If you have an upper bound, use it. If you don't, switch to
`bufio.Reader.ReadBytes` (unbounded growth, one alloc per call) or to
a streaming parser that doesn't materialise full records in memory.

## 11. `bufio.Reader.WriteTo` — the fast path for `io.Copy`

`(*bufio.Reader).WriteTo(w io.Writer) (int64, error)` drains the
buffered bytes plus the rest of the source into `w`. `io.Copy(w, br)`
detects this method and uses it, bypassing the 32 KiB intermediate
buffer.

```go
br := bufio.NewReader(socket)
// ... maybe a Peek and some inspection ...
io.Copy(out, br) // uses br.WriteTo internally
```

The implementation drains the buffered bytes first, then calls the
underlying reader's `WriteTo` (if it has one) or falls back to
chunked reads. The whole call is a single allocation if the source's
`WriteTo` is allocation-free.

## 12. `bufio.Writer.ReadFrom` — the fast path for `io.Copy`

`(*bufio.Writer).ReadFrom(r io.Reader) (int64, error)` is symmetric.
For copies of more than the buffer's `Available` space, it bypasses
the buffer and writes large chunks directly to the underlying writer:

```go
bw := bufio.NewWriter(out)
io.Copy(bw, src)        // uses bw.ReadFrom
bw.Flush()              // still need this, for the small tail
```

The "writev-style" efficiency note: for large transfers, the buffered
writer doesn't double-buffer. Bytes flow source → underlying writer
without going through the bufio buffer. For small writes after the
copy, the buffer is back in play. `Flush` at the end as always.

## 13. `Reset` and `sync.Pool`

For high-throughput servers that handle many short connections,
allocating a `bufio.Reader` per connection adds up. The standard
pattern:

```go
var readerPool = sync.Pool{
    New: func() any {
        return bufio.NewReaderSize(nil, 4096)
    },
}

func handleConn(c net.Conn) {
    br := readerPool.Get().(*bufio.Reader)
    br.Reset(c)
    defer func() {
        br.Reset(nil) // drop reference to c so it can be GC'd
        readerPool.Put(br)
    }()
    // ... use br ...
}
```

`Reset(nil)` before returning to the pool is important — without it,
the pooled `bufio.Reader` holds a reference to the connection,
preventing GC and (worse) leaving a dangling handle that the next
borrower might accidentally read from.

`net/http` uses this exact pattern for both server and client
connections. The pooled readers/writers are why a tight HTTP request
loop allocates almost nothing per request.

## 14. `bufio.NewReadWriter` over a connection

For request/response protocols (Redis, IRC, custom RPC), wrap a
`net.Conn` in both directions:

```go
type Client struct {
    conn net.Conn
    rw   *bufio.ReadWriter
}

func Dial(addr string) (*Client, error) {
    c, err := net.Dial("tcp", addr)
    if err != nil { return nil, err }
    return &Client{
        conn: c,
        rw:   bufio.NewReadWriter(bufio.NewReader(c), bufio.NewWriter(c)),
    }, nil
}

func (c *Client) Do(cmd string) (string, error) {
    if _, err := c.rw.WriteString(cmd + "\r\n"); err != nil {
        return "", err
    }
    if err := c.rw.Flush(); err != nil {
        return "", err
    }
    return c.rw.ReadString('\n')
}
```

The reader and writer share no state. Reads do not auto-flush writes —
that's still your job. Pipelined protocols (multiple writes before a
read) flush once at the end, not per write.

## 15. Mixing `Scanner` and `Reader` on the same source

Don't. A `bufio.Scanner` wraps an internal `bufio.Reader` that is not
exposed; if you also create your own `bufio.Reader` over the same
underlying source, the two compete for bytes:

```go
// BROKEN — bytes are consumed by whichever reader gets there first
s := bufio.NewScanner(f)
br := bufio.NewReader(f)
```

To switch from scanning to byte-level reading mid-stream, finish what
you started: drain the scanner, then build a `bufio.Reader` and use it
exclusively. Or skip the scanner entirely and use `bufio.Reader` for
everything — `ReadString('\n')` is the equivalent of `Scanner.Scan` +
`Text()` with the newline kept.

## 16. Custom `SplitFunc` — skipping comments

A common need: scan lines, but skip blank lines and `#`-comments. You
can do this in the loop, but doing it in the splitter keeps the
business code clean:

```go
func scanContent(data []byte, atEOF bool) (int, []byte, error) {
    advance, token, err := bufio.ScanLines(data, atEOF)
    if err != nil || token == nil {
        return advance, token, err
    }
    // Drop blank lines and `#` comments — but tell the scanner we
    // consumed those bytes so it asks for more.
    trim := bytes.TrimSpace(token)
    if len(trim) == 0 || trim[0] == '#' {
        return advance, nil, nil // consume, no token
    }
    return advance, token, nil
}
```

`(advance, nil, nil)` is the magic: "I ate `advance` bytes; please ask
me again with the next chunk." The scanner does, and the user-visible
`Scan` loop never sees blank or comment lines.

## 17. `Scanner` with timeouts

`bufio.Scanner` doesn't know about deadlines, but the underlying
`io.Reader` can. For a `net.Conn`, set a read deadline before each
`Scan`:

```go
for {
    conn.SetReadDeadline(time.Now().Add(5 * time.Second))
    if !s.Scan() {
        if err := s.Err(); err != nil {
            if errors.Is(err, os.ErrDeadlineExceeded) {
                continue // idle timeout, keep going
            }
            return err
        }
        return nil // clean EOF
    }
    handle(s.Text())
}
```

The deadline is per `Read`, but `Scanner` may call `Read` multiple
times per `Scan`. In practice, a per-`Scan` deadline above is good
enough; if you need stricter bounds, switch to `bufio.Reader` and
manage the loop yourself.

## 18. Buffered writers around `gzip.Writer`

`gzip.Writer` has its own internal buffering, but the bytes it writes
to the underlying `io.Writer` (your file or socket) are unbuffered.
Wrap with `bufio.Writer` for fewer syscalls:

```go
f, _ := os.Create("data.json.gz")
defer f.Close()

bw := bufio.NewWriter(f)
defer bw.Flush()

gz := gzip.NewWriter(bw)
defer gz.Close() // writes the gzip trailer

enc := json.NewEncoder(gz)
for _, v := range items {
    enc.Encode(v)
}
```

Defer order, again, is critical: `gz.Close()` runs first (writes the
gzip trailer into `bw`), then `bw.Flush()` (pushes everything to `f`),
then `f.Close()`. Skip any of those and you get a corrupted or
truncated file.

## 19. The `Buffer` method's hidden allocation

`Scanner.Buffer(buf, max)` uses `buf` as the *initial* buffer but
allocates a fresh one if `len(buf) > 0` (it will reuse the cap but
zero out the length). For a true zero-allocation reuse:

```go
buf := make([]byte, 0, 64*1024)
s := bufio.NewScanner(r)
s.Buffer(buf, 64*1024)
```

`len(buf) == 0`, `cap(buf) == 64*1024`. The scanner uses the cap and
grows from there. Don't pre-fill the slice.

## 20. What to read next

- [senior.md](senior.md) — exact contracts, the `ErrTooLong` data-loss
  story, `ReadFrom`/`WriteTo` plumbing, full concurrency table.
- [professional.md](professional.md) — production patterns: pooled
  scanners, observable buffered pipelines, multi-megabyte tokens.
- [optimize.md](optimize.md) — benchmarked guidance on buffer sizes
  and split-function shape.
- [find-bug.md](find-bug.md) — broken snippets to diagnose.
