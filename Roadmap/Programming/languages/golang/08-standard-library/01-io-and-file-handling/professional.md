# 8.1 `io` and File Handling — Professional

> **Audience.** You've shipped services that read and write a lot of
> bytes, and you've watched them misbehave under load. This file is the
> production playbook: cancellable copies, retries that don't corrupt
> data, observability hooks that don't lie, log rotation, tail-following,
> chunked uploads with resume, and the platform-specific zero-copy paths
> that decide whether your service costs $X or $10X to run.

## 1. Cancellable I/O with `context.Context`

`io.Reader` and `io.Writer` predate `context`, so the stdlib has no
`ReadContext` method. The pattern that *works* is wrapping the source so
that each `Read` checks the context and aborts cleanly:

```go
type ctxReader struct {
    r   io.Reader
    ctx context.Context
}

func (c *ctxReader) Read(p []byte) (int, error) {
    if err := c.ctx.Err(); err != nil {
        return 0, err
    }
    return c.r.Read(p)
}
```

This is *cooperative* cancellation. A `Read` already in flight inside the
kernel does not abort. To unblock a syscall-blocked goroutine, you need
to close the underlying file or socket from the context's `Done` watcher.
For network code, `(*net.Conn).SetReadDeadline(time.Time{})` interrupts a
blocking read; for `*os.File` over a pipe, `f.Close()` does.

```go
func copyCtx(ctx context.Context, dst io.Writer, src io.ReadCloser) (int64, error) {
    done := make(chan struct{})
    defer close(done)
    go func() {
        select {
        case <-ctx.Done():
            src.Close() // unblock any Read in flight
        case <-done:
        }
    }()
    return io.Copy(dst, &ctxReader{r: src, ctx: ctx})
}
```

For HTTP client bodies, attach the context via `http.NewRequestWithContext`
instead — the transport handles the cancellation plumbing for you.

## 2. Streaming pipelines under load

The composition rules from [middle.md](middle.md) carry over, with two
production additions: backpressure and bounded concurrency. A pipeline
that pulls from a slow source and pushes to a slow sink should never
buffer the whole stream in memory.

```go
type stage func(ctx context.Context, in io.Reader, out io.Writer) error

func pipeline(ctx context.Context, in io.Reader, out io.Writer, stages ...stage) error {
    if len(stages) == 0 {
        _, err := io.Copy(out, in)
        return err
    }
    pr, pw := io.Pipe()
    g, gctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        defer pw.Close()
        return stages[0](gctx, in, pw)
    })
    g.Go(func() error {
        return pipeline(gctx, pr, out, stages[1:]...)
    })
    return g.Wait()
}
```

`io.Pipe` provides synchronous backpressure: if the next stage stalls,
`pw.Write` blocks, which blocks the previous stage's `Read`. Memory stays
flat regardless of payload size. The `errgroup` cancels every stage when
one fails.

## 3. Observability hooks: counters, histograms, byte rates

Wrap readers and writers to record bytes, latencies, and error counts.
Keep the wrappers pure data-plane code — never block on a metrics export
call inside `Read`/`Write`, or you've turned a fast path into a slow one.

```go
type instrumentedReader struct {
    r        io.Reader
    bytes    *atomic.Int64
    reads    *atomic.Int64
    errors   *atomic.Int64
}

func (i *instrumentedReader) Read(p []byte) (int, error) {
    n, err := i.r.Read(p)
    i.bytes.Add(int64(n))
    i.reads.Add(1)
    if err != nil && err != io.EOF {
        i.errors.Add(1)
    }
    return n, err
}
```

For latency, sample only every Nth call (or use a histogram with
constant-cost record). Updating a Prometheus histogram on every `Read`
of a busy stream is itself a bottleneck. A typical balance: per-call
counters, sampled-per-batch histograms.

When you publish metrics, label them by *direction* (read/write) and
*source* (file, network, pipe). A spike in "read errors from file" reads
very differently from "read errors from network."

## 4. Retry semantics that don't corrupt data

Retrying a failed `Read` is usually safe. Retrying a failed `Write` is
dangerous — you may write the same bytes twice. The rule:

| Failure | Safe to retry? |
|---------|----------------|
| `Read` returned an error after `n == 0` | Yes |
| `Read` returned `(n > 0, err)` | Process the `n` bytes, then retry |
| `Write` returned `(n, err)` with `n < len(p)` | Retry only `p[n:]` |
| `Write` returned `(0, err)` | Retry only if the destination is idempotent |
| `Sync` returned an error | Treat the file as suspect; do not assume retry succeeds |

For network-backed writes (uploading to S3, posting to an API), the
idempotency story has to be in the protocol — content hashes,
sequence numbers, or `Content-MD5` headers. Without one, a client
that retries on a 502 may silently double-write.

`bufio.Writer` does the right thing on partial writes internally: it
loops over `Write` until the buffer is empty or an error returns.
`io.Copy` uses the same loop. If you write your own loop, copy that
pattern verbatim:

```go
for len(p) > 0 {
    n, err := w.Write(p)
    p = p[n:]
    if err != nil {
        return err
    }
}
```

## 5. Partial-write recovery for long uploads

For uploads that may take minutes or hours (large file → object store),
build resume into the protocol from day one. The shape:

1. Compute an upload ID before the first byte.
2. Track the offset of the last fully acknowledged chunk.
3. On retry, send `If-Match` or `Range` headers to resume from the
   recorded offset.

```go
type resumableUpload struct {
    f      *os.File
    id     string
    offset int64
    chunk  int
}

func (u *resumableUpload) sendNext(ctx context.Context, c *http.Client) error {
    sec := io.NewSectionReader(u.f, u.offset, int64(u.chunk))
    req, _ := http.NewRequestWithContext(ctx, "PUT", uploadURL(u.id), sec)
    req.Header.Set("Content-Range", contentRange(u.offset, u.chunk))
    resp, err := c.Do(req)
    if err != nil { return err }
    defer drainAndClose(resp.Body)
    if resp.StatusCode/100 != 2 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    u.offset += int64(u.chunk)
    return nil
}
```

`io.NewSectionReader` is the right tool: it gives the HTTP client a
fresh `Reader` per attempt without re-opening the file. Closing the
response body via `drainAndClose` (read to EOF, then close) lets the
underlying TCP connection return to the pool — see section 6.

## 6. Drain-and-close on every HTTP body

This is the single most common production bug in Go HTTP code:

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

If you return from a handler without draining, the connection pool can't
reuse the socket. Under load, you accumulate sockets in `TIME_WAIT`,
exhaust ephemeral ports, and stall. Always drain. Cap the drain if the
body might be huge:

```go
io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
resp.Body.Close()
```

## 7. Graceful shutdown of long-running copies

A long `io.Copy` is uninterruptible from outside the goroutine running it.
For server shutdown, you need to be able to abort. Three patterns:

- **Close the source.** `src.Close()` from another goroutine causes the
  in-flight `Read` to return an error. Works on every `io.Closer`.
- **Set a deadline.** For `*net.Conn`, `SetReadDeadline(time.Now())`
  interrupts immediately. Restoring the deadline lets future reads
  resume. `*os.File` doesn't support deadlines on regular files.
- **Wrap with context.** Use the `ctxReader` from section 1; pair with
  source closure for syscall-blocked goroutines.

Combine all three for a robust shutdown:

```go
func gracefulCopy(ctx context.Context, dst io.Writer, src io.ReadCloser) error {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    go func() {
        <-ctx.Done()
        src.Close()
    }()
    _, err := io.Copy(dst, &ctxReader{ctx: ctx, r: src})
    if err != nil && ctx.Err() != nil {
        return ctx.Err()
    }
    return err
}
```

## 8. Large-file uploads with chunking

For uploads larger than a few hundred MiB, slice the file into chunks
and upload them in parallel with `io.SectionReader`. The throughput
gain is real on high-latency links — N parallel chunks fill the BDP
(bandwidth-delay product) better than a single TCP stream.

```go
const chunkSize = 16 << 20 // 16 MiB

func uploadParallel(ctx context.Context, f *os.File, c *http.Client) error {
    info, err := f.Stat()
    if err != nil { return err }
    size := info.Size()
    sem := make(chan struct{}, 4) // bounded concurrency
    g, gctx := errgroup.WithContext(ctx)
    for off := int64(0); off < size; off += chunkSize {
        off := off
        end := off + chunkSize
        if end > size { end = size }
        sem <- struct{}{}
        g.Go(func() error {
            defer func() { <-sem }()
            sec := io.NewSectionReader(f, off, end-off)
            return uploadChunk(gctx, c, sec, off)
        })
    }
    return g.Wait()
}
```

The semaphore caps in-flight requests so you don't open 1000 sockets
for a 16 GiB file. Each goroutine gets its own `SectionReader`; the
underlying `*os.File` is shared safely because `ReadAt` doesn't touch
the position cursor (see [senior.md](senior.md) section 21).

## 9. Zero-copy on Linux: `sendfile`, `splice`, `copy_file_range`

When both ends of a copy are real OS objects, the kernel can move bytes
without ever materializing them in user space. Go uses the right
syscall automatically when both sides have the right shape:

| Source | Destination | Syscall used |
|--------|-------------|--------------|
| `*os.File` (regular) | `*os.File` (regular) | `copy_file_range` (Linux 4.5+) |
| `*os.File` | `*net.TCPConn` | `sendfile` |
| `*net.TCPConn` | `*os.File` | `splice` (via `*os.File`'s `ReadFrom`) |
| `*net.TCPConn` | `*net.TCPConn` | `splice` (Linux only) |

The hook is `io.Copy`'s preference for `WriterTo` and `ReaderFrom`. If
you wrap the source or destination in something that hides the
underlying type — say, an `io.LimitReader` or a custom buffer-counting
reader — you lose the fast path. Bytes flow through user-space memory
again at typical 32 KiB chunks.

If you need both observability (byte counts) *and* zero-copy, you have
to choose. One workable compromise: skip the wrapper for the bulk of
the copy, then read `Stat` afterward to get the byte count. Or, on
Linux, add an `eBPF` probe instead of touching the data path.

## 10. Tail-following: `tail -f` style

The Linux `tail -f` pattern is "read to EOF, then poll for new data."
Two ways:

```go
// Polling.
func tailPoll(f *os.File, w io.Writer) error {
    buf := make([]byte, 32*1024)
    for {
        n, err := f.Read(buf)
        if n > 0 {
            if _, werr := w.Write(buf[:n]); werr != nil {
                return werr
            }
        }
        if err == io.EOF {
            time.Sleep(200 * time.Millisecond)
            continue
        }
        if err != nil { return err }
    }
}
```

This is correct but burns CPU when idle. For production, use `inotify`
on Linux (via `github.com/fsnotify/fsnotify`) so you wake only on
actual changes.

The harder case is *log rotation*: the file you're reading gets renamed
to `app.log.1` and a fresh `app.log` is created. Your file handle still
points at the old inode, which keeps growing only with anything written
*before* the rotation completed. To follow the new file, watch the
directory and reopen on rename.

```go
func tailRotating(path string, w io.Writer) error {
    var f *os.File
    open := func() error {
        if f != nil { f.Close() }
        nf, err := os.Open(path)
        if err != nil { return err }
        f = nf
        return nil
    }
    if err := open(); err != nil { return err }
    // ... use a watcher to call open() again on rename ...
}
```

## 11. File rotation patterns

Server-side log rotation has two common shapes:

**Copy-truncate.** The rotator copies the active log to `app.log.1`,
then truncates `app.log` back to zero. The writer's file handle still
points at the same inode, so writes continue. Downside: there's a
window where bytes can be lost between the copy and the truncate.

**Move-and-reopen.** The rotator renames `app.log` to `app.log.1`. The
writer notices (via `SIGHUP` or a periodic stat) and reopens the file,
creating a new `app.log`. Downside: writes that arrive between the
rename and the reopen go to `app.log.1`.

Most production loggers (`logrotate`, Lumberjack) use one or the other.
If you implement your own writer, prefer move-and-reopen — it never
loses lines, only briefly delivers them to the wrong file.

```go
type rotatingWriter struct {
    mu       sync.Mutex
    f        *os.File
    path     string
    maxBytes int64
    written  int64
}

func (r *rotatingWriter) Write(p []byte) (int, error) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if r.written+int64(len(p)) > r.maxBytes {
        if err := r.rotate(); err != nil { return 0, err }
    }
    n, err := r.f.Write(p)
    r.written += int64(n)
    return n, err
}

func (r *rotatingWriter) rotate() error {
    if err := r.f.Close(); err != nil { return err }
    if err := os.Rename(r.path, r.path+"."+time.Now().Format("20060102-150405")); err != nil {
        return err
    }
    f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
    if err != nil { return err }
    r.f = f
    r.written = 0
    return nil
}
```

The `O_APPEND` flag is load-bearing: even if multiple processes write
concurrently to the same log path, each `Write` lands at the current
end of file atomically (POSIX guarantee for writes ≤ `PIPE_BUF`).

## 12. Atomic configuration reload

For long-running services that watch a config file, the read-side
pattern is:

1. Watch the directory with `inotify`/`fsnotify`.
2. On change, reload the file, parse it, validate it.
3. Swap the in-memory config atomically with `atomic.Pointer[Config]`.

The write-side pattern is the atomic-rename from
[middle.md](middle.md) section 7. As long as the writer renames into
place, the reader either sees the old file or the new file, never a
half-parsed mess.

```go
var current atomic.Pointer[Config]

func reload(path string) error {
    data, err := os.ReadFile(path)
    if err != nil { return err }
    cfg, err := parse(data)
    if err != nil { return err }
    current.Store(&cfg)
    return nil
}

func get() *Config { return current.Load() }
```

`atomic.Pointer` was added in Go 1.19; it lets readers see the new
config immediately without locking. Old goroutines holding a reference
to the previous `*Config` continue using it until they drop the pointer.

## 13. Rate limiting writes

The naive `time.Sleep` based limiter from [middle.md](middle.md) is
fine for one writer. For shared rate limits across many goroutines, use
`golang.org/x/time/rate.Limiter` and call `Wait` per chunk.

```go
type limitedWriter struct {
    w   io.Writer
    lim *rate.Limiter
}

func (l *limitedWriter) Write(p []byte) (int, error) {
    if err := l.lim.WaitN(context.Background(), len(p)); err != nil {
        return 0, err
    }
    return l.w.Write(p)
}
```

Pass a `context.Context` if you want cancellable rate-limited writes.
For very high rates, `WaitN` allocates per call; consider a token
bucket implementation that uses atomics in the hot path.

## 14. Backpressure across boundaries

If your service reads from a slow source, transforms, and writes to a
slow sink, the natural backpressure of `io.Pipe` works inside one
process. Across process or network boundaries, you have to build it.

For HTTP server endpoints that stream a response, write directly to
`http.ResponseWriter` — Go flushes per buffer naturally and the TCP
window controls the rate. For HTTP server endpoints that consume a
body, read in chunks; don't `io.ReadAll` an unbounded body.

For Kafka producers, the client library queues internally — your
`Produce` returns immediately and the actual send happens in the
background. Treat that queue as the buffer; bound it via the producer's
`queue.buffering.max.messages` (or equivalent). Without a bound, a slow
broker collapses your service's heap.

## 15. The `*os.File` as a long-lived handle

Most file handles in services are short-lived: open, copy, close. A few
need to live for the lifetime of the service: the access log writer,
the audit log writer, the local-cache file. For those, the rules
change:

- `Sync` periodically (every N seconds or N writes), not on every
  `Write` — see [senior.md](senior.md) section 7.
- Wrap with a mutex if multiple goroutines write. `*os.File`'s
  concurrent `Write`s race on the position cursor.
- Reopen on rotate or on certain errors (`EBADF`, `EIO`).
- Limit by descriptor count: a service that opens one cache file per
  tenant exhausts FDs at scale. Use an LRU.

## 16. File-descriptor exhaustion

The default `ulimit -n` on Linux is often 1024. A service that opens
files faster than it closes them will hit it and start failing with
`too many open files`. Pre-checks at startup:

```go
var rl syscall.Rlimit
syscall.Getrlimit(syscall.RLIMIT_NOFILE, &rl)
if rl.Cur < 65536 {
    rl.Cur = 65536
    syscall.Setrlimit(syscall.RLIMIT_NOFILE, &rl)
}
```

The hard limit (`rl.Max`) caps how high you can raise the soft limit
without root. Production deployments should bump the hard limit via
`/etc/security/limits.conf` or systemd's `LimitNOFILE=`.

To monitor live FD usage on Linux, count entries in `/proc/self/fd`.
A service with FDs growing monotonically is leaking handles — almost
always a missing `Close` on an error path.

## 17. Preallocating large files: `Truncate` and `fallocate`

For files you know will grow to a target size (databases, downloads),
preallocating avoids fragmentation and surprises mid-write when the
filesystem fills:

```go
f, _ := os.Create("data.db")
f.Truncate(10 << 30) // 10 GiB sparse file
```

This is a "sparse" allocation — the file logically has 10 GiB of zeros,
but the filesystem reserves no blocks. To actually reserve the blocks,
use `fallocate(2)` via `syscall`:

```go
syscall.Fallocate(int(f.Fd()), 0, 0, 10<<30)
```

Now writes won't fail with `ENOSPC` partway through, and the on-disk
layout is more contiguous. Not portable — the syscall is Linux-only.

## 18. Working with `mmap`

The standard library does not expose `mmap`. For read-only access to
large files, `golang.org/x/exp/mmap` provides a thin wrapper that
returns an `io.ReaderAt`:

```go
r, err := mmap.Open("/var/data/index.bin")
if err != nil { return err }
defer r.Close()
buf := make([]byte, 4096)
r.ReadAt(buf, 1<<30) // read at 1 GiB offset, no syscall
```

`mmap` shines when you randomly access a large file repeatedly — the
kernel page-cache becomes the read cache for free. It loses to plain
`pread` when you scan the file once: each access is still a page fault
on first touch, and you've added VM bookkeeping overhead. Benchmark.

## 19. Crash-safe queues with append-only logs

A common pattern: produce messages by appending to a file with
`O_APPEND`, consume by reading from a checkpoint offset. The write side
is naturally atomic for messages smaller than `PIPE_BUF` (4 KiB on
Linux); the read side is just `ReadAt` from the last consumed offset.

```go
type appendQueue struct {
    f *os.File
}

func (q *appendQueue) Push(msg []byte) error {
    if len(msg) > 4000 {
        return errors.New("message too large for atomic append")
    }
    framed := append(binary.BigEndian.AppendUint16(nil, uint16(len(msg))), msg...)
    _, err := q.f.Write(framed)
    if err != nil { return err }
    return q.f.Sync()
}
```

The `Sync` call makes the message durable. For high throughput, batch
multiple messages and sync once — see "group commit" in
[senior.md](senior.md) section 7.

## 20. Observability hooks: example metrics surface

A reasonable production set of metrics for an I/O-heavy service:

| Metric | Type | Labels |
|--------|------|--------|
| `io_bytes_total` | counter | direction, source |
| `io_operations_total` | counter | op (read/write/seek), source |
| `io_errors_total` | counter | source, error_class |
| `io_op_duration_seconds` | histogram | op, source |
| `open_file_descriptors` | gauge | (none) |
| `disk_sync_duration_seconds` | histogram | (none) |

`error_class` should aggregate at the `errors.Is` level: `io.EOF`,
`io.ErrUnexpectedEOF`, `os.ErrNotExist`, `*os.PathError` with a
specific syscall, etc. Cardinality matters — don't label by file path.

## 21. Profiles to keep on hand

Three commands that pay for themselves repeatedly when an I/O service
misbehaves:

```sh
# CPU profile while the service is hot
curl -o cpu.prof http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http :8080 cpu.prof

# Goroutine count over time (look for blocked Reads stacking up)
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt

# Block profile (requires runtime.SetBlockProfileRate)
curl -o block.prof http://localhost:6060/debug/pprof/block
```

A goroutine dump that shows hundreds of goroutines blocked in
`(*os.File).Read` or `net/http.(*persistConn).readLoop` is almost
always either a body-not-drained bug, a leaked file handle, or a slow
downstream that needs backpressure. See [optimize.md](optimize.md) for
the deep version.

## 22. What to read next

- [optimize.md](optimize.md) — when correctness is settled and you're
  chasing throughput.
- [find-bug.md](find-bug.md) — the bug catalog, including production
  patterns that look right and aren't.
- [tasks.md](tasks.md) — the production-tier exercises (rate-limited
  writer, atomic reloader, parallel checksum) put this material to work.
- [specification.md](specification.md) — when you need the exact
  guarantee a wrapper makes or breaks.
