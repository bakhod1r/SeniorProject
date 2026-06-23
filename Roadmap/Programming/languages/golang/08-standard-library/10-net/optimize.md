# 8.10 `net` — Optimize

> Performance work in `net`-heavy code: cutting syscalls, reusing
> buffers, batching writes, scaling Accept across CPUs, and the
> kernel-level knobs worth knowing. Profile first, then apply.

## 1. The cost ladder of network I/O

Before optimizing, know what each operation costs:

| Operation | Approximate cost |
|-----------|-----------------|
| One syscall (`read`/`write`) | 1–3 μs |
| One `Read` returning few bytes | 1 syscall + Go scheduler tick |
| Goroutine switch | 100–300 ns |
| TCP handshake (LAN) | 0.1–1 ms |
| TCP handshake (WAN) | 10–200 ms |
| TLS handshake (full) | 2 RTTs + crypto |
| TLS handshake (resumed) | 1 RTT + light crypto |
| DNS lookup (cached) | <1 ms |
| DNS lookup (cold) | 10–100 ms |
| `net.Pipe` Write→Read | ~1 μs |
| `chan []byte` send→recv | ~200 ns |

The biggest wins come from removing handshakes (pool conns) and
removing syscalls (buffer + batch).

## 2. Reuse conns: connection pooling pays for itself

Opening a new TCP conn per request is expensive on three axes:

1. The handshake (one RTT minimum).
2. TLS handshake on top (extra RTTs + crypto).
3. TIME_WAIT on the local side (~60s, port consumption).

A pool of long-lived conns turns N requests into 1 handshake.
Even on localhost, 30k qps over fresh conns hits ephemeral-port
exhaustion within seconds; a pool of 100 idle conns sustains it
indefinitely.

For HTTP, use the `http.Transport` defaults and don't create a
new transport per request. For custom RPC, build a pool with idle
timeout + health check (see [tasks.md §12](tasks.md)).

## 3. Buffer the read side: `bufio.Reader`

Raw `Conn.Read` does one syscall per call. For protocols with
many small reads (line-based, or fixed-size headers followed by
small payloads), wrap with `bufio.NewReader`:

```go
br := bufio.NewReaderSize(c, 8192)
```

The reader fills its buffer in 8 KiB chunks and serves your small
reads from RAM. Net effect: ~100x fewer syscalls for small-record
protocols.

`bufio.Reader.ReadSlice` is the allocation-free variant. It returns
a slice into the internal buffer; the slice is valid until the
next read. Copy if you need to retain.

```go
line, err := br.ReadSlice('\n')
if err != nil { return err }
// process line; it'll be invalidated on the next read
```

For binary protocols, `binary.Read(br, ...)` works on a buffered
reader and avoids the per-field syscall.

## 4. Buffer the write side: `bufio.Writer` and explicit Flush

The mirror image. Many small `Write` calls become one syscall:

```go
bw := bufio.NewWriterSize(c, 8192)
for _, msg := range messages {
    binary.Write(bw, binary.BigEndian, msg)
}
bw.Flush()
```

Two pitfalls:

1. **You must `Flush` before the conn is read by the peer.** A
   request/response protocol where the server replies only after
   the request is "done" needs `Flush()` to push the request out.
2. **Don't `Flush` after every record.** Defeats the purpose. Flush
   at the protocol's natural batch boundary (end of request, full
   buffer).

For length-prefixed records, a frequent pattern: write the prefix
to one slice, the body to another, and `bw.Write` both — or use
`net.Buffers` (next section).

## 5. Vectored I/O: `net.Buffers`

When you have multiple non-contiguous slices to write (header +
body, length-prefix + payload), `net.Buffers` becomes a single
`writev` syscall on supported platforms:

```go
hdr := make([]byte, 4)
binary.BigEndian.PutUint32(hdr, uint32(len(body)))

bufs := net.Buffers{hdr, body}
n, err := bufs.WriteTo(c)
```

Saves one syscall per frame. For high-throughput servers writing
millions of frames per second, this can be the difference between
syscall-bound and CPU-bound.

After `WriteTo` returns, `bufs` is reslicd to contain only the
unwritten remainder, so a short write leaves it ready for retry.

## 6. Right-size the kernel buffers

Default `SO_RCVBUF`/`SO_SNDBUF` is autotuned on Linux but capped.
For high-bandwidth-delay-product flows (transcontinental WAN, big
files, video streams), the cap may throttle throughput.

```go
tc.SetReadBuffer(4 << 20)  // 4 MiB receive
tc.SetWriteBuffer(4 << 20) // 4 MiB send
```

Calculation: throughput * RTT = required buffer.

| RTT | Throughput | BDP |
|-----|------------|-----|
| 100 ms | 1 Gbps | 12.5 MB |
| 200 ms | 100 Mbps | 2.5 MB |
| 1 ms (LAN) | 10 Gbps | 1.25 MB |

If the bottleneck is the receive window, larger buffers help. If
the bottleneck is the application reading too slowly, larger
buffers just delay the inevitable.

Cost: per-conn memory. 1000 conns × 4 MiB = 4 GiB resident. Don't
oversize blindly.

## 7. Disable Nagle for interactive protocols (default already)

Go's TCP conns have `NoDelay` set to `true` by default. There's
nothing to do for the common case.

If you specifically *want* coalescing of small writes (e.g., bulk
upload protocols where latency doesn't matter), set
`SetNoDelay(false)`. Together with `SetKeepAlive`, you get
roughly the kernel's "throughput mode."

For latency-sensitive RPC, keep `NoDelay = true` (default) and
buffer with `bufio.Writer` instead. Buffering at the application
gives you control over flush timing; Nagle gives the kernel
control. App-level buffering wins because you know when a logical
message ends; the kernel doesn't.

## 8. Scale Accept with `SO_REUSEPORT`

A single listener with one Accept goroutine saturates around tens
of thousands of new connections per second. Past that, `SO_REUSEPORT`
lets multiple sockets bind the same port; the kernel hashes
connections to one of them.

```go
lc := net.ListenConfig{
    Control: func(network, address string, c syscall.RawConn) error {
        return c.Control(func(fd uintptr) {
            unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
        })
    },
}

for i := 0; i < runtime.NumCPU(); i++ {
    ln, _ := lc.Listen(ctx, "tcp", ":8080")
    go acceptLoop(ln)
}
```

Linux only (BSD has different semantics). The kernel hash
distributes load across listeners; pin each goroutine's GOMAXPROCS
slice if you need NUMA-aware routing.

For UDP, `SO_REUSEPORT` is the *only* way to scale past one CPU,
since each `PacketConn` has a single read queue.

## 9. Pool buffers with `sync.Pool`

For per-conn buffers, `sync.Pool` cuts allocations:

```go
var bufPool = sync.Pool{
    New: func() any { b := make([]byte, 0, 4096); return &b },
}

func handle(c net.Conn) {
    defer c.Close()
    bp := bufPool.Get().(*[]byte)
    defer bufPool.Put(bp)
    buf := (*bp)[:cap(*bp)]
    ...
}
```

Two things to remember:

1. Reset the slice (`buf := (*bp)[:0]`) before reuse if you appended
   to it.
2. `sync.Pool` may drop entries on GC. Don't assume `Get` reuses
   the same buffer twice in a row.

For UDP, where each datagram needs an independent buffer (you
can't share across reads), pooling is especially valuable.

## 10. Avoid allocations on the hot path

Profile per-frame allocations with `go test -benchmem`. Common
allocations to remove:

- **`fmt.Sprintf` for log lines.** Use a structured logger that
  appends to a pooled buffer.
- **`[]byte(string)` conversion.** When you have a `string` and
  need `[]byte`, the conversion allocates. For read-only access,
  `unsafe.StringData` (Go 1.20+) is allocation-free but more
  fragile.
- **`fmt.Fprintf` to a conn.** Each call goes through reflection.
  For a hot path, build the bytes yourself and `c.Write` once.
- **`bufio.Reader.ReadString`.** Allocates a new string per call.
  Use `ReadSlice` + copy only when retaining.

A common gain: 30–50% throughput by removing 1–2 allocations per
request.

## 11. The cgo resolver tax

Every `net.LookupHost` (and friends) without `Resolver.PreferGo =
true` may go through cgo. Each cgo call is ~5x more expensive
than a pure-Go syscall, plus the lookup itself can block any
goroutine on a thread.

For services that look up many hostnames (e.g., a web crawler),
forcing the pure-Go resolver eliminates the cgo overhead and lets
the runtime handle scheduling:

```go
net.DefaultResolver.PreferGo = true
```

For one-shot programs the cost rounds to nothing; for sustained
DNS load, it adds up.

## 12. Cache DNS at the app layer (carefully)

The pure-Go resolver does not cache. Every call hits
`/etc/resolv.conf`'s nameserver. For services hammering a small
set of hostnames:

```go
type cachedResolver struct {
    base  *net.Resolver
    cache sync.Map // host -> entry
    ttl   time.Duration
}

type entry struct {
    addrs   []net.IPAddr
    expires time.Time
}
```

Build a TTL cache on top of `Resolver.LookupIPAddr`. Be honest
about TTL: DNS records have their own TTL, and your cache shouldn't
exceed it (or you'll route to dead hosts after failover).

Don't cache forever and don't cache without an honest invalidation
trigger. The OS resolver libraries cache because they share state
across processes; in-process caches have less reason and more
risk.

## 13. Profile what you're paying for

For a Go network service, the profiles to check:

| Profile | What it shows |
|---------|---------------|
| `pprof goroutine` | Stuck goroutines, leaks |
| `pprof block` | Time blocked on channels, mutexes, syscalls |
| `pprof mutex` | Lock contention |
| `pprof heap` | Per-allocation memory |
| `pprof profile` (CPU) | Where CPU time goes |
| `pprof allocs` | Per-allocation site |

A network service stuck at 100% CPU usually shows: lots of small
buffer allocations (`bufio.Reader.ReadString`), frequent GC,
syscall-bound on `read`/`write`, or hashing/encoding overhead.

A service that's idle but slow usually shows: blocking on locks
(contention), blocking on channels (single-producer/single-consumer
mismatch), or IO blocking on a single goroutine that should be
parallel.

## 14. Benchmark with real workloads

A microbenchmark that opens one conn, sends 1 MB, and closes
doesn't predict production behavior. Things to vary:

- **Conn count.** 1, 100, 10k. Memory and goroutine costs scale
  with conn count, not request count.
- **Message size distribution.** A bimodal mix of small
  control messages and large payloads stresses different
  paths than a uniform size.
- **Idle time.** A real client sends 1 message every 100 ms, not
  back-to-back. Buffering and Nagle behave differently.
- **Network conditions.** LAN benchmarks miss WAN-specific
  problems (small CWND, high RTT, packet loss).

Tools: `wrk`, `tcpkali`, `ab` for HTTP; `nping`, `iperf3` for raw
TCP/UDP; `tc qdisc netem` to simulate WAN conditions on Linux.

## 15. `runtime.LockOSThread` for hot paths (rarely)

In extreme cases, pinning a goroutine to an OS thread eliminates
the per-iteration scheduler tick. Almost never the right answer;
the Go scheduler is fast and the pinning prevents work-stealing.
Reach for it only when:

- You're calling a thread-local-state cgo library (CUDA, GL).
- You've measured scheduler overhead and proven it dominates.

For general network code, don't.

## 16. Half-close to free resources early

For request/response protocols where the request is fully sent
before the response starts:

```go
io.Copy(server, request)
server.(*net.TCPConn).CloseWrite() // FIN; server can stop reading
io.Copy(out, server)
```

The peer's read returns EOF as soon as the FIN arrives; it can
release any per-request resources (parsing buffers, locked
records) without waiting for the connection to close.

Net effect: peer's per-request memory drops from "held until
conn closes" to "held until request ends." For long-lived conns
with many requests, this is the difference between bounded and
unbounded memory.

## 17. Listening on Unix instead of localhost TCP

Localhost TCP goes through the IP stack: checksum, routing
table, TIME_WAIT entries. Unix sockets skip all of it.

For inter-process communication on a single host, `net.Listen("unix", ...)`
is 30–50% faster than localhost TCP for small messages, with
lower overhead per conn.

```go
ln, _ := net.Listen("unix", "/tmp/app.sock")
defer os.Remove("/tmp/app.sock")
```

The protocol layer above is unchanged — `net.Conn` is `net.Conn`.
Drop-in replacement.

## 18. Keep request handlers short

`net/http` and most custom RPC frameworks dispatch each request to
a goroutine. The Go scheduler is happy with 1M idle goroutines
and 100k active ones, but every request you can serve from a
fast path in the receiving goroutine avoids the dispatch cost.

For trivial requests (cache hit, ping, health check), handle in
the receive goroutine and skip the goroutine creation. Even better,
batch: read multiple requests off one conn, process all, write
all responses, single `Flush`.

## 19. Avoid TCP_NODELAY for true bulk transfers

The default (`NoDelay=true`) flushes every write. For *bulk*
transfers (file uploads, log shipping) where latency doesn't
matter, you want the kernel to coalesce. Either:

- Set `SetNoDelay(false)` to enable Nagle, or
- Use `bufio.Writer` with a large buffer (this gives you the
  control without involving the kernel-level Nagle state).

App-level batching is usually preferable. You know when a logical
chunk ends; you can `Flush` exactly there. Nagle applies the same
delay to everything.

## 20. The `sendfile`/`splice` path (zero-copy)

`*os.File` to `*net.TCPConn` (or `tls.Conn`) `io.Copy` may use
`sendfile`/`splice` on Linux for zero-copy transfer:

```go
f, _ := os.Open("big.bin")
io.Copy(c, f) // may invoke sendfile
```

This is true on Linux when `c` is a plain `*net.TCPConn` (not
TLS). The bytes never enter user space — the kernel reads from
the file's page cache and DMAs into the network card.

Conditions:

- Source is `*os.File`.
- Destination is `*net.TCPConn` or `*net.UnixConn`.
- Linux (and macOS, less effectively).

`net.Conn` exposes this via the `WriteTo`/`ReadFrom` interface.
`io.Copy` checks for these and uses them when available.

## 21. The summary checklist

For a `net`-heavy service, the highest-impact, lowest-risk
optimizations in order:

1. **Pool conns.** Eliminate per-request handshakes.
2. **Buffer reads with `bufio.Reader`.** Cut syscalls 100x.
3. **Buffer writes with `bufio.Writer` and explicit `Flush`.**
   Same.
4. **Use `net.Buffers` for header+body writes.** One syscall.
5. **Set deadlines on every read and write.** Frees goroutines.
6. **Pool per-request buffers with `sync.Pool`.**
7. **Force pure-Go resolver if doing many lookups.**
8. **Tune kernel buffers for high-BDP flows.**
9. **`SO_REUSEPORT` to scale Accept past one CPU.**
10. **`sendfile`-style zero-copy for file→net transfers.**

Each is well-understood, well-tested in production, and
profile-justifiable. Avoid premature optimization on the
exotic ones (LockOSThread, raw sockets) until profiling proves
necessity.

## Cross-references

- [`../01-io-and-file-handling/optimize.md`](../01-io-and-file-handling/optimize.md) — buffering and zero-copy at the file layer.
- [professional.md](professional.md) — the production patterns that interact with these optimizations.
- [find-bug.md](find-bug.md) — what goes wrong when these are applied without care.
