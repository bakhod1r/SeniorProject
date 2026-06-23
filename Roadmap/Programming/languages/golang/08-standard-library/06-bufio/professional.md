# 8.6 `bufio` — Professional

> **Audience.** You operate Go services that handle thousands of
> connections, gigabytes of streaming data, or both. This file covers
> the production patterns: pooled buffered I/O, observable buffered
> pipelines, and the corners that bite under load — backpressure,
> timeouts, and partial writes.

## 1. Pooling readers and writers

Every `bufio.NewReader` allocates a 4 KiB buffer. For a server that
opens and closes hundreds of connections per second, that's hundreds
of KiB of churn for the GC. The fix is `sync.Pool`:

```go
var readerPool = sync.Pool{
    New: func() any {
        return bufio.NewReaderSize(nil, 4096)
    },
}

var writerPool = sync.Pool{
    New: func() any {
        return bufio.NewWriterSize(nil, 4096)
    },
}

func handleConn(c net.Conn) {
    br := readerPool.Get().(*bufio.Reader)
    bw := writerPool.Get().(*bufio.Writer)
    br.Reset(c)
    bw.Reset(c)
    defer func() {
        bw.Flush()           // flush before returning to pool
        br.Reset(nil)        // drop reference to c
        bw.Reset(nil)
        readerPool.Put(br)
        writerPool.Put(bw)
    }()
    serve(br, bw)
}
```

Three rules to internalise:

1. **`Reset(nil)` before `Put`.** Otherwise the pooled value retains a
   reference to the connection, blocking GC and risking a dangling
   read on next borrow if the connection has since been closed.
2. **`Flush` the writer before pooling.** A pooled writer with
   buffered bytes from the previous owner will flush them to the next
   owner's stream — a cross-tenant data leak.
3. **Never share a pooled value across goroutines.** `Pool.Get`
   returns one value; one goroutine at a time. Don't pass it through
   a channel and keep using it on the original goroutine.

`net/http` uses this pattern internally. Your handlers see a buffered
reader and writer that were almost certainly recycled from a previous
request.

## 2. Sizing the pool buffer

The 4 KiB default is fine for line-oriented protocols where the
typical record is hundreds of bytes. For protocols with larger
typical records (Redis bulk strings, gRPC frames, large HTTP
headers), a 16 KiB or 32 KiB buffer reduces fill-frequency.

Trade-off:

- Larger buffer → fewer underlying reads/writes, but more idle memory
  per connection.
- Smaller buffer → tighter memory, but more syscall overhead.

For a server with `N` concurrent connections, the steady-state memory
cost is roughly `N * (reader_buf + writer_buf)`. At 10 K connections,
4 KiB each side is 80 MiB; 32 KiB each side is 640 MiB. Pick a size
informed by `pprof` heap profiles, not folk wisdom.

## 3. The 64 KiB scanner cap in production

The default `Scanner` cap eats records silently. In a log pipeline,
this is the kind of bug that goes unnoticed for months: 99% of lines
fit, 0.1% don't, and those 0.1% are exactly the stack traces you need
during an outage.

Production-grade scanner setup:

```go
const (
    initialBuf = 64 * 1024
    maxToken   = 16 * 1024 * 1024  // 16 MiB ceiling
)

s := bufio.NewScanner(r)
s.Buffer(make([]byte, 0, initialBuf), maxToken)

for s.Scan() {
    process(s.Bytes())
}
if err := s.Err(); err != nil {
    if errors.Is(err, bufio.ErrTooLong) {
        // 16 MiB+ in one record — almost certainly a bug; log loudly.
        metrics.IncrCounter("scan_too_long")
    }
    return err
}
```

For unbounded inputs, switch to `bufio.Reader.ReadBytes('\n')` or use
a custom `SplitFunc` with explicit length validation.

## 4. Observable buffered pipelines

When a buffered writer drops bytes (forgotten flush, panicking
goroutine), you want to know in metrics, not from a customer email.
Wrap the writer:

```go
type observableWriter struct {
    bw      *bufio.Writer
    written *atomic.Int64
    flushed *atomic.Int64
}

func (o *observableWriter) Write(p []byte) (int, error) {
    n, err := o.bw.Write(p)
    o.written.Add(int64(n))
    return n, err
}

func (o *observableWriter) Flush() error {
    pending := int64(o.bw.Buffered())
    if err := o.bw.Flush(); err != nil { return err }
    o.flushed.Add(pending)
    return nil
}

func (o *observableWriter) Close() error {
    return o.Flush()
}
```

Now you can alert on `written - flushed > 0` for too long, which
catches the "I forgot to call Flush before exit" class of bugs.

## 5. Cancellable scanning

`bufio.Scanner` does not respect `context.Context`. The standard
workaround is to set a read deadline on the underlying connection:

```go
type ctxConn struct {
    net.Conn
    ctx context.Context
}

func (c *ctxConn) Read(p []byte) (int, error) {
    if deadline, ok := c.ctx.Deadline(); ok {
        c.SetReadDeadline(deadline)
    }
    n, err := c.Conn.Read(p)
    if errors.Is(err, os.ErrDeadlineExceeded) {
        if c.ctx.Err() != nil {
            return n, c.ctx.Err()
        }
    }
    return n, err
}

func scanCtx(ctx context.Context, c net.Conn) error {
    s := bufio.NewScanner(&ctxConn{Conn: c, ctx: ctx})
    for s.Scan() {
        // ...
    }
    return s.Err()
}
```

For scanners over arbitrary `io.Reader`s (not network), there is no
deadline mechanism. Run the scanner on a goroutine and select on the
context's `Done` channel, but be aware that the goroutine itself
won't unblock until the underlying read returns. A blocked read on a
file descriptor can pin a goroutine indefinitely. For files that
might block, consider `os.File.SetReadDeadline` (only works on pipes
and sockets, not regular files) or a forced close from outside:
`f.Close()` makes the in-flight read return with an error.

## 6. Backpressure with `bufio.Writer`

`bufio.Writer.Write` returns instantly when bytes fit in the buffer.
It blocks only when `Flush` is called and the underlying writer
blocks. For a slow downstream (clogged TCP connection), this means
the producer is decoupled from the consumer up to the buffer size.

For protocols where you want backpressure to flow through quickly
(real-time streaming, where lag is worse than dropped frames), use a
small buffer or write unbuffered. For protocols where you want
batching for throughput (logging, ETL), use a large buffer.

A common production setup: writer-side `bufio.Writer` of 64 KiB +
periodic `Flush` from a ticker:

```go
go func() {
    t := time.NewTicker(10 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            mu.Lock()
            if err := bw.Flush(); err != nil { /* handle */ }
            mu.Unlock()
        }
    }
}()
```

The mutex is required because `Flush` is not safe to call concurrently
with `Write`. For higher performance, use a single owner goroutine
that handles both writes and flushes; producers post messages via
channel.

## 7. Worker pattern for one-owner I/O

```go
type writeReq struct {
    data []byte
    done chan error
}

func runWriter(ctx context.Context, w io.Writer, requests <-chan writeReq) {
    bw := bufio.NewWriterSize(w, 64*1024)
    flushTicker := time.NewTicker(10 * time.Millisecond)
    defer flushTicker.Stop()

    for {
        select {
        case <-ctx.Done():
            bw.Flush()
            return
        case req := <-requests:
            _, err := bw.Write(req.data)
            req.done <- err
        case <-flushTicker.C:
            if err := bw.Flush(); err != nil {
                // log; producers are oblivious to flush failures
            }
        }
    }
}
```

One owner, no locks. Producers post requests; the owner drains them
and periodically flushes. This pattern handles the writer side of
many production protocols: replication logs, audit pipelines, metric
sinks.

## 8. Connection lifecycle and `Reset`

For a server that handles long-lived connections (WebSocket, raw TCP),
`Reset` is rarely useful — each connection has its own
`bufio.Reader`/`Writer` for its lifetime. For short-lived connections
(HTTP/1, line protocols with quick request/response), `Reset` saves
allocations:

```go
br := readerPool.Get().(*bufio.Reader)
defer readerPool.Put(br)

for {
    c, err := listener.Accept()
    if err != nil { return err }
    br.Reset(c)
    handle(br, c)
    c.Close()
}
```

But this is single-threaded. For concurrent accept-handle, you need
one `*bufio.Reader` per goroutine — which means `Get`/`Put` per
connection, not per loop iteration. Profile before optimising.

## 9. `bufio` and `crypto/tls`

`tls.Conn` already does internal buffering (TLS records are up to
16 KiB). Wrapping a `tls.Conn` in `bufio.Reader` doubles the buffering
and can hurt latency for small writes (the small write goes into the
bufio buffer, then into the TLS record buffer, neither flushes
immediately).

Rule of thumb:

- For request/response protocols over TLS, `bufio.NewReader` on the
  read side is fine (TLS buffers up to one record; bufio batches
  beyond that).
- For latency-sensitive writes (HTTP/2 push, WebSocket frames), avoid
  `bufio.Writer` over `tls.Conn`. Write directly and flush implicitly
  via small TLS records.

`net/http` does the right thing here: HTTP/1 uses bufio on both sides;
HTTP/2 uses neither because the stream framer manages its own buffers.

## 10. Detecting double-flush

A surprisingly common bug: `Flush` is called twice in different
defers. The second one is a no-op (the buffer is already empty), but
it can mask the *first* one's error if the second one's error wins:

```go
// BUG: cerr from the inner Flush gets shadowed
defer bw.Flush()
defer func() { bw.Flush() }()
```

Production-quality teardown is once, with the error checked:

```go
defer func() {
    if cerr := bw.Flush(); err == nil { err = cerr }
}()
```

Code review: any function with two `bw.Flush()` calls is suspect.
Either there are two writers (different variables, not a bug), or
there's a duplicate.

## 11. Metric: bytes-pending watchdog

Long-running services with buffered output can develop "stuck buffer"
bugs: bytes accumulate in `bufio.Writer.Buffered()` but never flush,
because the sole flush trigger (e.g., a goroutine that was supposed to
periodically flush) crashed silently.

A watchdog metric:

```go
go func() {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for range t.C {
        metrics.SetGauge("bufio_pending_bytes", float64(bw.Buffered()))
    }
}()
```

Wait — you can't call `Buffered()` from another goroutine without a
race. So either expose it through a channel-driven query, or accept
the race for an approximate metric.

The right way:

```go
type guardedWriter struct {
    mu      sync.Mutex
    bw      *bufio.Writer
    pending atomic.Int64
}

func (g *guardedWriter) Write(p []byte) (int, error) {
    g.mu.Lock()
    defer g.mu.Unlock()
    n, err := g.bw.Write(p)
    g.pending.Store(int64(g.bw.Buffered()))
    return n, err
}

func (g *guardedWriter) Flush() error {
    g.mu.Lock()
    defer g.mu.Unlock()
    err := g.bw.Flush()
    g.pending.Store(int64(g.bw.Buffered()))
    return err
}

func (g *guardedWriter) Pending() int64 { return g.pending.Load() }
```

Lock-protected `bufio.Writer` + atomic gauge. `Pending()` is safe to
call from any goroutine.

## 12. Multi-megabyte tokens

For records that legitimately span megabytes (full XML documents,
JSON arrays larger than the working set you'd want to keep), don't
materialise the whole token. Use a streaming parser:

```go
dec := json.NewDecoder(bufio.NewReader(r))
for {
    var v Event
    if err := dec.Decode(&v); err != nil {
        if errors.Is(err, io.EOF) { break }
        return err
    }
    process(v)
}
```

`json.Decoder` decodes one value at a time without loading the whole
stream. The same idea for `xml.Decoder`. If you want a "token" view,
use `Decoder.Token()` which yields one syntactic token per call.

If you absolutely need a record-at-a-time `bufio.Scanner` API for
multi-megabyte tokens, write a custom `SplitFunc` that yields *byte
ranges* (offsets into a memory-mapped file) rather than the bytes
themselves. The token in the scanner becomes a small record metadata
struct.

## 13. `*bufio.Writer` over `net.TCPConn` — Nagle interaction

`net.TCPConn` has Nagle's algorithm enabled by default. Combined with
`bufio.Writer`, you get two layers of batching:

1. `bufio.Writer` batches small `Write` calls into 4 KiB chunks.
2. The kernel batches small TCP sends until either an ACK arrives or
   the segment fills.

For latency-sensitive request/response protocols, this can add round
trips. Two fixes:

- `(*net.TCPConn).SetNoDelay(true)` — disables Nagle, sends each
  bufio-flushed chunk as its own TCP segment.
- Smaller `bufio.Writer` size — flush more often, naturally.

The `net/http` server sets `SetNoDelay(true)` by default. For custom
protocols, decide based on your latency vs throughput needs.

## 14. The `panic` recovery question

A panic mid-write leaves the `bufio.Writer` with buffered bytes that
will never be flushed. If your panic handler is responsible for
graceful shutdown, it must flush:

```go
defer func() {
    if r := recover(); r != nil {
        bw.Flush() // best-effort; might also fail
        panic(r)
    }
}()
```

For audit logs, this is the difference between "we logged the request
that crashed us" and "we have no record." The flush itself can fail
(panic during flush is a real possibility); handle errors with
`errors.Join` or by logging to stderr.

## 15. Buffered I/O in tests

For tests of code that takes an `io.Writer`, pass `bytes.Buffer` or
`bufio.NewWriter(&bytes.Buffer{})` depending on whether you want to
exercise the buffering layer. The interesting bugs (forgotten flush,
short-write retry) only surface against a real buffered writer:

```go
func TestWriteReport(t *testing.T) {
    var buf bytes.Buffer
    bw := bufio.NewWriter(&buf)
    if err := writeReport(bw, data); err != nil {
        t.Fatal(err)
    }
    bw.Flush() // simulate the real caller's flush
    if got := buf.String(); got != want {
        t.Errorf("got %q want %q", got, want)
    }
}
```

For a writer that should be flushing on its own, omit the test-side
flush — if `writeReport` forgot to flush, the test catches it:

```go
// If writeReport is contracted to flush before returning, this test
// fails when it doesn't.
if err := writeReport(bw, data); err != nil { t.Fatal(err) }
// no bw.Flush() here
if got := buf.String(); got != want { /* ... */ }
```

## 16. Production checklist

Before shipping a `bufio`-using service:

| Check | Why |
|-------|-----|
| Every writer has a `Flush` before its underlying close | Otherwise data loss |
| Scanner buffer cap is large enough for max legitimate record | Otherwise silent token loss |
| Pooled bufio values get `Reset(nil)` before `Put` | Otherwise leak / dangling read |
| Pooled writers are flushed before pool `Put` | Otherwise cross-request data leak |
| `Buffered()` is monitored or watchdog'd | Otherwise stuck-buffer bugs |
| `bufio.Writer` width matches typical record + flush cadence | Otherwise wasted memory or syscalls |
| Concurrent goroutines own separate `bufio.*` values | Otherwise races |
| Layered codecs (gzip, tls) close in correct LIFO order | Otherwise corrupted output |

## 17. What to read next

- [optimize.md](optimize.md) — measured tuning of buffer sizes.
- [find-bug.md](find-bug.md) — production failure-mode drills.
- [specification.md](specification.md) — full method/error reference.
- The `net/http` source: `src/net/http/transport.go` and
  `src/net/http/server.go` use `bufio` extensively and are good
  reading for production patterns.
