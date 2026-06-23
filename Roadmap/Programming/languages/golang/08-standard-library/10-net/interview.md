# 8.10 `net` — Interview

> Forty questions with model answers. Everything from "what's a TCP
> three-way handshake" through "how does Go's resolver decide between
> cgo and pure Go" through "design a connection pool." Use it to
> prep, to interview, or to find the gaps in your own model.

## Junior tier

### 1. What's the difference between `net.Conn` and `net.PacketConn`?

`net.Conn` is a stream connection (TCP, Unix stream, TLS). Bytes
flow as an unframed stream; one `Read` may return any prefix of
what was sent. `net.PacketConn` is a datagram socket (UDP, Unix
datagram). Each `ReadFrom` returns exactly one datagram, with the
sender's address.

### 2. What does `net.Dial("tcp", "example.com:80")` do?

Resolves `example.com` via the system DNS, opens a TCP socket,
connects to port 80, and returns a `net.Conn`. The conn has no
deadline set; reads and writes can block indefinitely.

### 3. Why use `bufio.Scanner` over a raw conn?

`Conn.Read` returns whatever bytes are buffered in the kernel,
which is rarely a clean record boundary. `bufio.Scanner` takes a
split function (default: lines) and gives you records.

### 4. How do you listen on a kernel-chosen port?

`net.Listen("tcp", ":0")`. Then `ln.Addr().(*net.TCPAddr).Port` to
read which port the kernel picked. Useful in tests.

### 5. What does `defer c.Close()` do for an accepted conn?

Releases the file descriptor and (for TCP) sends a FIN. Without
it, the goroutine ends but the fd leaks. `ulimit -n` exhaustion
follows.

### 6. What's the right way to know a peer closed the conn?

`Read` returns `io.EOF` (or `n>0` with `io.EOF` on the same call
for the last byte). Check `err == io.EOF` or `errors.Is(err, io.EOF)`.

### 7. `net.Listen("tcp", ":8080")` returns. How do you exit the Accept loop cleanly?

Call `ln.Close()`. The next `Accept` returns an error wrapping
`net.ErrClosed`; check it with `errors.Is(err, net.ErrClosed)` and
return.

### 8. What's the difference between TCP and UDP in the package?

TCP: `net.Listen` + `Accept` + per-conn goroutines, stream of
bytes. UDP: `net.ListenPacket` + a single read goroutine,
discrete datagrams, connectionless.

### 9. How do you read exactly N bytes from a `Conn`?

`io.ReadFull(c, buf)`. A single `Read` may return fewer; never
trust one call to fill the buffer.

### 10. How do you handle a conn that hangs forever on `Read`?

`SetReadDeadline(time.Now().Add(timeout))` before the call. If
the deadline fires you get an error satisfying
`os.ErrDeadlineExceeded`.

## Middle tier

### 11. Are deadlines absolute or relative?

Absolute. `SetReadDeadline(t)` says "fail if not done by `t`."
Once set, the deadline persists across operations until you change
it or pass `time.Time{}` to clear.

### 12. How do you do per-request timeouts on a long-lived conn?

Reset the deadline before each request:
`c.SetReadDeadline(time.Now().Add(d))`. Same for writes.

### 13. What's the difference between `net.Dial` and `net.Dialer.DialContext`?

`Dial` has no cancellation and no per-call configuration.
`DialContext` honors the context's deadline and cancellation.
Use `Dialer{Timeout: …}.DialContext(ctx, …)` in services.

### 14. What does `SetKeepAlive(true)` do?

Enables `SO_KEEPALIVE`: the kernel sends probes after the
configured idle interval. If no ACK comes back within the retry
window, the conn is marked dead and the next `Read` returns
`ECONNRESET` or similar. Detects dead idle peers; doesn't help
with broken-but-talking peers.

### 15. What's `Nagle's algorithm` and what does Go do about it?

Nagle's batches small writes to reduce packet count: a write is
held briefly until either the previous packet is acked or enough
data accumulates. Bad for interactive RPC. Go disables it by
default — `*TCPConn.SetNoDelay(true)` is the default.

### 16. What is half-close?

A TCP conn has independent read and write halves. `CloseWrite`
sends a FIN: the peer's read returns EOF, but our reads still
work. Used for protocols like HTTP/1.0 where the request is
finished before the response.

### 17. What's `net.ErrClosed` and when is it returned?

Sentinel introduced in Go 1.16. Returned by any operation on a
closed `Conn` or `Listener`. Use `errors.Is(err, net.ErrClosed)`
instead of string-matching `"use of closed network connection"`.

### 18. What does `ln.Addr()` return for a Unix socket listener?

`*net.UnixAddr` whose `Name` is the filesystem path and `Net` is
`"unix"`. The address is non-nil even after `Close`.

### 19. How do you remove the Unix socket file on shutdown?

`defer os.Remove(path)` *before* `defer ln.Close()`. Closing the
listener doesn't remove the file; subsequent `Listen` on the same
path fails with "address already in use." On Linux, the abstract
namespace (`@socket`) avoids this.

### 20. What's the resolver split (cgo vs Go)?

Go has two DNS resolvers: a pure-Go one that reads
`/etc/resolv.conf` and sends DNS packets, and a cgo one that calls
`getaddrinfo`. The runtime picks per-call based on platform,
config, and `GODEBUG=netdns`. cgo is required for `nsswitch.conf`
features (mDNS, LDAP); pure-Go is required for cancellation
support and static binaries.

## Senior tier

### 21. Why is `Temporary()` deprecated for Conn errors?

The classification was always heuristic. Errors flagged
"temporary" were a mix of truly transient (e.g., `EAGAIN`) and
permanent (e.g., the conn is dead). Retry logic gated on
`Temporary()` silently looped on permanent errors. Go 1.18
deprecated it for `Conn.Read/Write/Close`; use specific
sentinels (`net.ErrClosed`, `os.ErrDeadlineExceeded`,
`syscall.ECONNRESET`) instead.

### 22. How does `context` cancel an in-flight `Read`?

There's no `ReadContext`. The pattern is a watcher goroutine that
calls `c.SetReadDeadline(time.Unix(1, 0))` (a past time) when the
context is canceled. The kernel poller wakes the blocked syscall
with a deadline-exceeded error; the watcher exits when the read
returns.

### 23. What goroutine-safety guarantees does `net.Conn` make?

"Multiple goroutines may invoke methods on a Conn simultaneously."
In practice that means: one Read goroutine plus one Write
goroutine plus a Close goroutine plus a SetDeadline goroutine, all
concurrent, are legal. Two concurrent `Read` calls on a stream
conn produce interleaved garbage.

### 24. Why should you cap a length-prefixed frame's size?

A peer-supplied 4-byte length can be `0xFFFFFFFF` = 4 GiB. If you
do `make([]byte, n)` without checking, the OS kills your process.
Always: `if n > maxFrame { return error }`.

### 25. What's the difference between `net.IP` length 4 and length 16?

`net.IP` is a `[]byte`. IPv4 fits in 4; IPv6 uses 16. The package
sometimes returns 16-byte forms even for IPv4 (`::ffff:1.2.3.4`).
`bytes.Equal` may say two equal IPs differ. Use `IP.Equal` or
switch to `netip.Addr` (Go 1.18+).

### 26. What does `SetLinger(0)` do and when do you use it?

Sends RST instead of FIN on `Close`, discarding any unsent data.
The peer sees `ECONNRESET`. Use it to shed conns quickly without
TIME_WAIT accumulation. Don't use it on conns whose unsent data
matters.

### 27. Why does TIME_WAIT matter for outbound conns?

After `Close`, the initiator's side enters TIME_WAIT for ~60s.
At 30k qps, the ephemeral port range exhausts in seconds. Mitigate
by reusing conns (pool), enabling `tcp_tw_reuse` (Linux), or in
extreme cases `SetLinger(0)` once you've already read the response.

### 28. Why can `getaddrinfo` lookups not be canceled?

The cgo resolver calls into libc's `getaddrinfo`, which is opaque
to Go's runtime. Once the syscall starts, only the kernel can
abort it — Go can't preempt it. To get cancelable lookups, set
`Resolver.PreferGo = true`, ensuring the pure-Go path is used.

### 29. What's `SO_REUSEPORT` for?

Lets multiple sockets bind the same port; the kernel hashes
incoming connections to one of them. Used to scale a single
process across CPUs (one Accept per CPU), or to enable zero-downtime
restart (parent and child both accept). Set via `Dialer.Control`
or `ListenConfig.Control` calling `setsockopt(SO_REUSEPORT)`.

### 30. How does `net/http.Server.Shutdown` actually work?

Closes the listener (returning `net.ErrClosed` from `Accept`),
sets all idle conns to "shutting down" so they close after the
current request, and waits for the in-flight handler set to
empty. The implementation is a sync.Map of active conns, a
sync.WaitGroup for handlers, and a `select` on the context's
Done channel.

## Professional tier

### 31. Design a connection pool. What goes wrong if you skip the health check?

A conn idle in the pool can be reset by the peer between Put and
Get (TCP keepalive lag, peer process restart, NAT timeout). On
Get without health check, the next `Write` succeeds (data goes to
kernel buffer) but the next `Read` fails — by which time the
caller has already committed a request. Pool poison with
half-broken conns.

Solution: idle timeout (close conns past N minutes), and a
non-blocking probe on Get (zero-byte write, or a brief read with a
1ms deadline; if it returns EOF or RST, evict).

### 32. What's the right size for `SO_RCVBUF`/`SO_SNDBUF`?

Default is platform-tuned, usually 87KB receive / 16KB send on
Linux with autotuning. For high-bandwidth long-RTT links
(throughput * RTT > default), set explicitly via
`SetReadBuffer`/`SetWriteBuffer`. Larger buffers absorb burst
traffic and unblock writes; the cost is memory per conn.
Multiply by conn count to estimate.

### 33. Diagnose: a TCP server's tail latency is high; pprof shows goroutines blocked in `Write`.

Likely a slow or stuck client filling the kernel send buffer.
`Write` blocks until the buffer drains. Without
`SetWriteDeadline`, those goroutines hang forever. Fix: set a
write deadline on every response. Confirm via `ss -tip` showing
high `wmem` per conn.

### 34. Diagnose: a service is opening 50k outbound conns/sec and failing intermittently with `connect: cannot assign requested address`.

TIME_WAIT exhausting the ephemeral port range. Fix in priority
order: (1) reuse conns via a pool; (2) enable `tcp_tw_reuse`
sysctl; (3) widen the ephemeral range (`net.ipv4.ip_local_port_range`).
Don't touch `tcp_tw_recycle` (gone in modern kernels and was
NAT-hostile).

### 35. Implement zero-downtime restart for a TCP server.

Old process: on signal, `tl.File()` to dup the listener fd; pass
it to the new process via `cmd.ExtraFiles`. New process:
`net.FileListener(os.NewFile(...))` to wrap the fd back into a
listener. Old process closes its listener (parent-side fd) and
waits for in-flight conns to drain with a timeout, then exits.

### 36. Why is `SO_REUSEPORT` not enough for true zero-downtime?

`SO_REUSEPORT`-bound sockets are independent — the parent can't
hand off in-flight conns to the child. The child only handles
new conns from when it started. Combined with a graceful shutdown
on the parent (drain in-flight), it works; but you need both
mechanisms.

### 37. Design a slow-loris-resistant TCP server.

(1) First-byte deadline (1–3s) before any handler-specific
processing. (2) Per-request read/write deadlines. (3) Bounded
total conns via semaphore. (4) Per-IP conn limit (or LB equivalent).
(5) Cap request size with `io.LimitReader`. (6) Reject when at
capacity with `SetLinger(0)` + `Close` so the rejection is cheap.

### 38. How do you detect a goroutine leak from forgotten conns?

Two signals: monotonically rising `runtime.NumGoroutine()` despite
constant load, and rising open-fd count (`lsof -p`). pprof's
goroutine profile shows the stuck stack — usually `Read` or
`Write` without a deadline. Fix at the call site, not the pool.

### 39. Walk through a TCP three-way handshake and where Go fits.

SYN: client (Go's `Dial`) sends. SYN-ACK: server kernel responds.
ACK: client kernel responds. The conn is now ESTABLISHED in the
kernel's listen queue. The server's `Accept` syscall pops it from
the queue. None of these steps run Go code on the server until
`Accept` returns. Listen-backlog size (`SO_BACKLOG`, set by Go to
the platform's max ~4096) determines how many pending conns the
kernel holds before it starts rejecting.

### 40. Walk through a TLS handshake on top of `net.Conn`.

`tls.Server(conn, cfg)` wraps a raw `net.Conn`. The first
`Read` or explicit `Handshake()` triggers the TLS state machine:
the client sends ClientHello, server responds with ServerHello +
certificate (for TLS 1.2; TLS 1.3 is similar but compresses round
trips). After the handshake, application data flows through the
same socket but encrypted. The deadline on the underlying
`net.Conn` covers the handshake too — set
`SetReadDeadline` *before* calling `Handshake` to bound it.

## Cross-references

- [`../01-io-and-file-handling/interview.md`](../01-io-and-file-handling/interview.md) — adjacent stdlib I/O questions.
- [`../11-net-http-internals/`](../11-net-http-internals/junior.md) — every interview question above shows up there in HTTP form.
- [specification.md](specification.md) — when an answer hinges on the exact contract.
