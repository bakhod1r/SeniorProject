# 8.6 `bufio` — Tasks

Hands-on exercises that exercise each surface of `bufio`. Most have
multiple parts: a baseline, a refinement, a bench. Solutions are not
included — the point is to write the code, run it, and feel where the
edges are.

Stand up a scratch package once:

```
mkdir -p ~/code/bufio-tasks && cd $_
go mod init buftasks
mkdir -p exercises
```

For each task, write the code in a file under `exercises/` and run
with `go test -run X -v ./...` or `go run ./exercises/<file>.go`.

## 1. Word counter

Write a function with this signature:

```go
func countWords(r io.Reader) (lines, words, bytes int, err error)
```

Use a single `bufio.Scanner` with `bufio.ScanLines`, then count words
with `strings.Fields` per line. Test with a file the size of the
Linux kernel mailing list archive (~hundreds of MiB) and observe
memory usage with `runtime.ReadMemStats`. Goal: bounded memory
regardless of input size.

Refinement: switch to `bufio.ScanWords` and count differently. Compare
allocations with `go test -bench . -benchmem`.

## 2. Tail-N

Write a function that prints the last N lines of an `io.Reader`:

```go
func tail(r io.Reader, n int, w io.Writer) error
```

Use a circular buffer of `[]byte` slices, populated from
`bufio.Scanner`. Remember to copy `s.Bytes()` since you keep it past
the next `Scan`. Compare the cost of `Bytes() + copy` vs `Text()`.

Refinement: support the case where the input is a regular file and
you want true `tail` (read backwards from EOF). Hint: `os.File.Seek`
to `(0, io.SeekEnd)`, then back up in chunks, scan for newlines.

## 3. Line-of-the-day cache

Build a function that, given a stream, prints exactly one line every
second:

```go
func sample(ctx context.Context, r io.Reader, w io.Writer) error
```

Run a goroutine that reads lines as fast as possible into an atomic
`*string` (latest line), and a ticker goroutine that writes the
current value once per second. Use `bufio.Scanner` with raised buffer
to handle long lines. Confirm via `go test -race` that there are no
races on the shared string.

## 4. Custom split: CSV without commas

`encoding/csv` is the right tool for real CSV, but as an exercise,
implement a `SplitFunc` that splits on a configurable delimiter byte:

```go
func splitOn(delim byte) bufio.SplitFunc
```

Behaviour:
- Yield each record (sequence of bytes between delimiters).
- The final record (no trailing delimiter at EOF) is still yielded.
- An empty record between two consecutive delimiters yields an empty
  byte slice.

Test with `delim = ','` against `"a,b,,c"` — expect 4 tokens.

## 5. Length-prefixed framing

Implement a `SplitFunc` for records prefixed with a 4-byte big-endian
length:

```go
var scanLPR bufio.SplitFunc
```

Test with a stream of mixed-size records (some bigger than the default
buffer). Configure `Scanner.Buffer` accordingly. Add a max-record
guard that returns an error if the prefix declares more than 1 MiB.

## 6. Header-then-body parser

Many protocols start with a header (lines until a blank line) followed
by an opaque body. Write a function that reads from a `bufio.Reader`,
parses the headers with `Scanner` into a `map[string]string`, then
returns the rest of the stream (body) as an `io.Reader`:

```go
func parseHeaders(br *bufio.Reader) (map[string]string, io.Reader, error)
```

Trick: once the `Scanner` is done with headers, you can't re-use it,
but the `bufio.Reader` underneath still has buffered body bytes. Don't
double-wrap. Hint: don't use `Scanner` at all — use
`br.ReadString('\n')` directly so the reader stays the canonical
position cursor.

## 7. Pooled buffered writers

Write a benchmark that compares:

- `bw := bufio.NewWriter(f); bw.Flush(); bw = nil` per loop iteration
  (allocates each time)
- A `sync.Pool` of `bufio.Writer`s where each iteration calls
  `bw.Reset(f); use(bw); bw.Flush(); pool.Put(bw)`

Measure with `go test -bench . -benchmem`. Expect the pooled version
to be near-zero allocations per op for medium loops; the unpooled
version allocates the buffer each time.

## 8. Scanner with deadline

Wrap a `net.Conn` so reads have a per-operation deadline driven by
context:

```go
type ctxConn struct {
    net.Conn
    ctx context.Context
}

func (c *ctxConn) Read(p []byte) (int, error)
```

Wire up a small TCP echo server (`net.Listen("tcp", ":0")`), connect,
send some lines, scan with a 100 ms context. Verify the scanner
returns `s.Err() == context.DeadlineExceeded` (or `os.ErrDeadlineExceeded`,
depending on which path triggers first) when the server stops sending.

## 9. AvailableBuffer integer dump

Write a function that emits N integers, one per line, to a writer
using zero allocations per integer:

```go
func writeNumbers(bw *bufio.Writer, nums []int64) error
```

Use `bw.AvailableBuffer()` + `strconv.AppendInt` + `append('\n')` and
pass the result to `bw.Write`. Compare with
`fmt.Fprintln(bw, n)` and `strconv.Itoa(int(n)) + "\n"` versions.
Benchmark; expect `AvailableBuffer` to be ~3x faster.

## 10. Mid-stream protocol switch

Write a server that reads the first 5 bytes from a connection. If the
prefix is `"GET /"`, dispatch to an HTTP handler. Otherwise, treat the
rest as line-based custom protocol.

```go
func dispatch(c net.Conn) error
```

Use `bufio.Reader.Peek(5)` to inspect without consuming. Then pass the
*same* `bufio.Reader` to whichever handler. Confirm the bytes weren't
lost.

## 11. Fault-injecting reader

Build a wrapper that deliberately misbehaves to test your robustness:

```go
type flakyReader struct {
    r          io.Reader
    shortAfter int   // return short reads after this many calls
    errAfter   int   // return an error after this many calls
}

func (f *flakyReader) Read(p []byte) (int, error)
```

Wrap `bytes.NewReader([]byte("hello world\n"))` with one that returns
1 byte at a time, then feed it through `bufio.Scanner`. Verify the
scanner still returns the whole line. Then make it return errors
mid-token; verify `Err()` reports correctly.

## 12. Byte-by-byte to chunked

Write two equivalent implementations of "uppercase every byte in the
input":

```go
// Slow version
func upperByteByByte(r io.Reader, w io.Writer) error

// Fast version
func upperChunked(r io.Reader, w io.Writer) error
```

The first reads with `ReadByte`/`WriteByte` on `bufio.Reader`/`Writer`.
The second reads chunks (`Read([]byte)`) and writes chunks. Benchmark
both on a 100 MiB file. Both are correct; the second should be ~10x
faster because of the per-call overhead even with buffering.

## 13. ReadSlice without bugs

Write a parser that reads a stream of `key=value` records (newline
terminated) using `ReadSlice('\n')` and produces a `map[string]string`:

```go
func parseKV(br *bufio.Reader) (map[string]string, error)
```

The challenge: `ReadSlice` returns a slice that is invalidated by the
next read. You must extract `key` and `value` substrings and copy them
into the map *before* the next `ReadSlice`. Confirm with `-race` and
with adversarial input that you don't accidentally keep a stale slice.

## 14. Drain remaining buffered bytes

Write a function that takes a `*bufio.Reader` whose underlying source
has been replaced (`Reset`) but still has buffered data from the old
source, and recovers those buffered bytes:

Wait — that doesn't work. `Reset` discards the buffer. So write the
inverse: a function that copies the buffered bytes *out* of a
`*bufio.Reader` before resetting it:

```go
func drainBuffered(br *bufio.Reader) []byte {
    n := br.Buffered()
    out := make([]byte, n)
    io.ReadFull(br, out)
    return out
}
```

Now `br` has no buffered bytes from the old source; you can `Reset`
safely. Useful in connection-reuse code.

## 15. Implement `bufio.Writer.Flush` from scratch

Build a minimal `bufio.Writer`-equivalent. It should:

- Buffer writes up to a fixed size.
- Flush on full buffer or explicit call.
- Track sticky errors.
- Be a drop-in for `io.Writer`.

Don't worry about `WriteByte`, `WriteRune`, etc. Just `Write`,
`Flush`, `Buffered`, `Available`, `Reset`. Match `bufio.Writer`'s
behaviour for partial underlying writes (retry remainder, set
`io.ErrShortWrite` if no progress).

Compare your code with the stdlib source in `src/bufio/bufio.go`.
The stdlib version is tighter; your job is to understand why each
line is the way it is.

## 16. Implement `bufio.Scanner` with `ScanLines`

Build a minimal `Scanner` that supports `ScanLines` only:

```go
type miniScanner struct {
    r   io.Reader
    buf []byte
    // ...
}

func (s *miniScanner) Scan() bool
func (s *miniScanner) Text() string
func (s *miniScanner) Err() error
```

Refill the buffer when the existing data has no `\n`. Yield the line
without the trailing `\n`. Track EOF; once true, yield the trailing
partial line if any, then return false.

Compare with the stdlib's `Scan` implementation. Note especially the
"shift-left" optimisation when a partial read leaves the front of the
buffer empty.

## 17. Continuous gzip writer

Write a sink that compresses data with gzip into a file, with a flush
every 1 MB of compressed output:

```go
type gzSink struct {
    f  *os.File
    bw *bufio.Writer
    gz *gzip.Writer
}

func newGZSink(path string) (*gzSink, error)
func (g *gzSink) Write(p []byte) (int, error)
func (g *gzSink) Close() error
```

Layered close order: `gz.Close()` → `bw.Flush()` → `f.Close()`. Add
periodic `gz.Flush()` calls so a reader can decompress mid-stream.
Confirm by running `gunzip` on a partial copy of the file produced
between flushes.

## 18. Multi-source merger

Write a function that takes N `io.Reader`s, each producing
newline-delimited records, and merges them into one writer in
arrival order:

```go
func merge(out io.Writer, sources ...io.Reader) error
```

One goroutine per source, each scanning lines and pushing to a shared
channel. One consumer goroutine writes to a `bufio.Writer` over `out`,
flushing periodically. Verify under load (10 sources, 100 K lines
each) that no lines are lost or duplicated.

## 19. Read until predicate

Implement a generalised version of `ReadString` that reads until a
predicate returns true:

```go
func readUntil(br *bufio.Reader, pred func(b byte) bool) ([]byte, error)
```

Use `ReadByte` in a loop, accumulating into a `[]byte`. Compare
performance with using `ReadSlice` + `bytes.IndexFunc`.

## 20. Connection-level write buffer monitor

Wrap a `bufio.Writer` so it exposes its `Buffered()` count via an
atomic `int64`:

```go
type monitoredWriter struct {
    bw      *bufio.Writer
    pending atomic.Int64
}

func (m *monitoredWriter) Write(p []byte) (int, error)
func (m *monitoredWriter) Flush() error
func (m *monitoredWriter) Pending() int64 // safe from any goroutine
```

`Write` and `Flush` update `pending`; `Pending()` is safe to call from
a metrics goroutine without a race. Test with the race detector;
verify the pending count tracks reality across many writers.

## What to read next

- [find-bug.md](find-bug.md) — broken snippets to diagnose.
- [optimize.md](optimize.md) — measured tuning of buffer sizes.
- [senior.md](senior.md) — re-read with the tasks above as concrete
  examples of what each contract clause means.
