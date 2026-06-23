# 8.10 `net` — Professional

> **Audience.** You've shipped network services that take real
> traffic and you've watched them struggle. This file is the
> production playbook: connection pooling, listener patterns at
> scale, observability, zero-downtime restart, TLS integration,
> and the failure modes that show up only past 10k conns.

## 1. Connection pooling — what `net` gives you and what it doesn't

The `net` package does *not* provide connection pooling. `net.Conn`
is a long-lived bidirectional stream, and the assumption is you
keep it open and reuse it. Pooling is built on top — `net/http`
has its own pool in `http.Transport`, database drivers have their
own pool inside `database/sql`, and gRPC manages connections per
target.

When you build a custom RPC client over raw `net`, you write the
pool yourself. The minimal correct pool:

```go
type Pool struct {
    addr string
    mu   sync.Mutex
    idle []net.Conn
    max  int
}

func (p *Pool) Get(ctx context.Context) (net.Conn, error) {
    p.mu.Lock()
    if n := len(p.idle); n > 0 {
        c := p.idle[n-1]
        p.idle = p.idle[:n-1]
        p.mu.Unlock()
        return c, nil
    }
    p.mu.Unlock()
    d := net.Dialer{}
    return d.DialContext(ctx, "tcp", p.addr)
}

func (p *Pool) Put(c net.Conn) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if len(p.idle) >= p.max {
        c.Close()
        return
    }
    p.idle = append(p.idle, c)
}
```

That's the skeleton. Production additions you'll need:

- **Idle timeout.** Conns sitting in the pool past N minutes get
  closed (TCP keepalive doesn't catch every silently dropped peer).
- **Health check on Get.** Before returning an idle conn, do a
  zero-byte write or set a brief read deadline and try one byte to
  see if the peer reset.
- **Bounded total conns.** A semaphore so callers wait instead of
  opening unbounded conns under load.
- **Per-conn-error eviction.** A conn that returned an error must
  not go back in the pool; many callers forget this and return a
  broken conn.

Default to `net/http.Transport` semantics in your own pools: idle
timeout 90s, max idle per host 100, total max 1000.

## 2. Listener patterns at scale

A single Accept goroutine on a single listener is fine up to a few
thousand new conns per second. Past that, you have two options:

### `SO_REUSEPORT` for kernel-level fan-out

Multiple processes (or goroutines, on Linux) bind the same port;
the kernel hashes incoming connections to one of them. No userspace
contention.

```go
lc := net.ListenConfig{
    Control: func(network, address string, c syscall.RawConn) error {
        return c.Control(func(fd uintptr) {
            syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, unix.SO_REUSEPORT, 1)
        })
    },
}
ln, err := lc.Listen(ctx, "tcp", ":8080")
```

In a single Go process, spin up N listeners (one per CPU), all
bound to the same port via `SO_REUSEPORT`. Each gets its own Accept
goroutine.

### Multiple Accept goroutines per listener

`net.Listener.Accept` is goroutine-safe — multiple goroutines can
call it. On most platforms one Accept goroutine saturates well
before you'd reach the kernel ceiling, so this rarely helps; prefer
`SO_REUSEPORT`.

For UDP, `SO_REUSEPORT` is the only way to scale beyond one CPU.
The `ListenPacket` socket has a single read queue per fd; a single
goroutine reads it, fan-out to workers won't help.

## 3. Bounding inbound conns: the semaphore pattern

A flood of conns can exhaust file descriptors before anything
useful happens. Limit accepted conns in flight:

```go
sem := make(chan struct{}, 1024)

for {
    c, err := ln.Accept()
    if err != nil {
        if errors.Is(err, net.ErrClosed) { return nil }
        log.Printf("accept: %v", err)
        continue
    }

    select {
    case sem <- struct{}{}:
    default:
        // Over capacity. RST and move on.
        if tc, ok := c.(*net.TCPConn); ok {
            tc.SetLinger(0)
        }
        c.Close()
        continue
    }

    go func() {
        defer func() { <-sem }()
        defer c.Close()
        handle(c)
    }()
}
```

`SetLinger(0)` makes the rejection cheap — the peer gets `ECONNRESET`
immediately and the local side doesn't accumulate TIME-WAIT slots.

## 4. Observability: Conn wrappers for metrics

Wrap `net.Conn` to count bytes, record latency, and tag errors. The
shape is the standard interface-wrapping pattern — keep it on the
data-plane fast path:

```go
type measuredConn struct {
    net.Conn
    bytesIn  *atomic.Int64
    bytesOut *atomic.Int64
}

func (m *measuredConn) Read(p []byte) (int, error) {
    n, err := m.Conn.Read(p)
    m.bytesIn.Add(int64(n))
    return n, err
}

func (m *measuredConn) Write(p []byte) (int, error) {
    n, err := m.Conn.Write(p)
    m.bytesOut.Add(int64(n))
    return n, err
}
```

Two rules:

1. **Don't allocate per-call.** Use atomic counters; a metric library
   call inside `Read`/`Write` doubles the per-syscall cost.
2. **Don't capture variable error chains.** Storing `err` in the
   wrapper for later inspection prevents the caller from seeing it
   first; just forward.

For `Listener` wrappers, intercept `Accept` and wrap the returned
conn:

```go
type measuredListener struct{ net.Listener }
func (m *measuredListener) Accept() (net.Conn, error) {
    c, err := m.Listener.Accept()
    if err != nil { return nil, err }
    return &measuredConn{Conn: c, ...}, nil
}
```

This composes with `net/http.Server` — pass the wrapped listener to
`srv.Serve` and every conn flows through your wrapper.

## 5. Wrapping `net.Conn` in `tls.Conn`

TLS sits on top of `net.Conn`. You can do this two ways:

### Server side: wrap the listener

```go
cfg := &tls.Config{Certificates: []tls.Certificate{cert}}
ln, err := tls.Listen("tcp", ":443", cfg)
```

`tls.Listen` returns a `net.Listener` whose `Accept` does the TLS
handshake and returns a `*tls.Conn` (which satisfies `net.Conn`).

### Server side: handshake per-conn

```go
rawLn, _ := net.Listen("tcp", ":443")
for {
    raw, err := rawLn.Accept()
    if err != nil { continue }
    tlsConn := tls.Server(raw, cfg)
    if err := tlsConn.HandshakeContext(ctx); err != nil {
        raw.Close()
        continue
    }
    go handle(tlsConn)
}
```

Use this when you want to set a handshake deadline separate from
the application read/write deadlines, or when the listener is
something exotic (proxy protocol, multiplexer).

The `*tls.Conn` inherits its deadline semantics from the underlying
`net.Conn` — `SetReadDeadline` covers the whole TLS state machine
including any internal handshake messages.

For TLS specifics see [`../13-crypto/`](../13-crypto/junior.md).

## 6. Zero-downtime restart with fd handover

The pattern: the running server holds a listener; the new binary
inherits the listener's fd via env or a control socket; the old
process drains in-flight conns and exits.

```go
// In the old process, on signal SIGUSR2:
tl := ln.(*net.TCPListener)
f, _ := tl.File() // dup'd fd

cmd := exec.Command(os.Args[0], os.Args[1:]...)
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
cmd.ExtraFiles = []*os.File{f}
cmd.Env = append(os.Environ(), "LISTEN_FD=3")
cmd.Start()
```

In the new process:

```go
if v := os.Getenv("LISTEN_FD"); v != "" {
    n, _ := strconv.Atoi(v)
    f := os.NewFile(uintptr(n), "listener")
    ln, _ := net.FileListener(f)
    // Use ln; the parent will exit shortly.
}
```

Three details to get right:

1. `cmd.ExtraFiles` makes `f` the child's fd 3. Index in
   `ExtraFiles` plus 3 (because 0/1/2 are stdio).
2. Close the parent's `f` after starting the child — the kernel
   keeps the listener open while *any* fd references it.
3. The parent's existing accepted conns keep working until they
   close. The parent should `ln.Close()` (parent-side only),
   wait for in-flight handlers to drain (with a timeout), and
   exit.

Real-world projects: tableflip, overseer, and the `cloudflare/tableflip`
library encapsulate this dance.

## 7. Backpressure and the read/write asymmetry

In a busy server, the bytes-in queue and bytes-out queue have
different failure modes.

**Inbound flooding.** A peer that sends faster than you process
fills the kernel receive buffer. Once full, TCP advertises a zero
window and the peer's `Write` blocks. That's healthy
backpressure — it pushes the problem upstream. The danger is
*application-level* buffering: if your handler stores incoming bytes
in a slice that grows unboundedly, the kernel buffer drains and the
peer keeps sending.

**Outbound stalling.** A peer that doesn't read fills the kernel
send buffer, then your `Write` blocks. Without `SetWriteDeadline`,
that goroutine hangs forever and accumulates. Always set a write
deadline; treat a write timeout as a permanent failure (close the
conn).

For long-running streaming responses (server-sent events,
WebSocket-like protocols), a missing write deadline is the most
common reason a server "leaks goroutines under load."

## 8. Per-request budgets across multiple network calls

A request that fans out to three downstreams should not give each
downstream the full budget — the sum can exceed the request SLO.
Carry a single `context.Context` with the request deadline, and use
`Dialer.DialContext` for every outbound call:

```go
func handle(ctx context.Context, req Request) Response {
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()

    var wg sync.WaitGroup
    var aResp, bResp, cResp Resp
    for _, call := range []func(context.Context) Resp{
        func(ctx context.Context) Resp { return callA(ctx) },
        func(ctx context.Context) Resp { return callB(ctx) },
        func(ctx context.Context) Resp { return callC(ctx) },
    } {
        wg.Add(1)
        go func(f func(context.Context) Resp) {
            defer wg.Done()
            _ = f(ctx) // shares the parent deadline
        }(call)
    }
    wg.Wait()
    ...
}
```

Each downstream call uses `DialContext(ctx, ...)`; the dialer
respects the parent deadline. If the user-facing SLO is 500ms, no
downstream gets more than 500ms total.

## 9. Slow-loris resistance

A "slow loris" client opens a conn and dribbles bytes
indefinitely, hoping to tie up server goroutines. Mitigations:

1. **Read deadline before Accept loop returns.** Set
   `c.SetReadDeadline(time.Now().Add(30s))` before any
   handler-specific read; refresh after the request line is in.
2. **Bound the request size.** `io.LimitReader` around the conn,
   capped at the largest legitimate request.
3. **Bound concurrent conns per IP.** A semaphore keyed by remote
   IP (with reasonable timeouts on the lookup) caps a single bad
   actor.
4. **First-byte deadline.** A separate, tight deadline (1–3 seconds)
   on the *first* read; once data is flowing, switch to the
   per-request deadline.

For HTTP servers, `http.Server` exposes `ReadHeaderTimeout`,
`ReadTimeout`, `WriteTimeout`, and `IdleTimeout` — set all four.
For raw `net` servers, you implement the equivalents yourself.

## 10. UDP at scale: lessons from real services

UDP servers in production hit different walls than TCP servers:

1. **One read goroutine is the bottleneck.** A single
   `ReadFrom` call processes packets serially. To scale past a
   single CPU, use `SO_REUSEPORT` and N listening sockets, one
   read goroutine per socket.

2. **Buffer ownership matters.** `ReadFrom` reuses the same buffer.
   Either copy the payload before fan-out, or use a sync.Pool of
   buffers, one per in-flight packet.

3. **Send buffer can fill.** UDP `WriteTo` can return
   `ENOBUFS` under burst load. Treat it as transient and retry once
   after a tiny delay; if it persists, drop the packet.

4. **No backpressure on the wire.** A peer that sends too fast just
   loses packets; your job is rate-limiting on the application
   layer if you care.

5. **MTU choice.** Internet UDP is safest at 1200–1400 bytes per
   datagram (after IPv6 + UDP headers). Localhost can go to 65535.
   In between depends on your network — test, don't guess.

## 11. TIME_WAIT exhaustion and ephemeral ports

A short-lived outbound conn (HTTP request, RPC call) leaves a
TIME_WAIT entry on the *initiator* side for ~60 seconds. With
30k requests/second, you can exhaust the 28k–60k ephemeral port
range on a single machine within a couple of seconds.

Mitigations, in order of correctness:

1. **Reuse conns.** A pool with idle timeout 90s and 100 idle conns
   per target makes the issue irrelevant — you're not opening a new
   conn per request. This is what `net/http.Transport` does.
2. **`tcp_tw_reuse` (Linux sysctl).** Allow TIME_WAIT entries to be
   reused for new outbound connections. Generally safe.
3. **`SO_REUSEADDR` on the local source.** Together with
   tcp_tw_reuse, lets you bind the same source port immediately.
4. **`SetLinger(0)` on outbound conns.** RST instead of FIN avoids
   TIME_WAIT, but loses unsent data. Use only when you've already
   processed the response.

`tcp_tw_recycle` is gone (removed in Linux 4.12+) and was always
hostile to NATs. Don't reach for it.

## 12. Diagnostics: tools that pay for themselves

When a network service misbehaves, the tools you reach for in
order:

| Tool | When |
|------|------|
| `ss -tan` (Linux) / `netstat -an` | Conn states, TIME_WAIT count, listen queue depth |
| `ss -tip state established` | Per-conn rtt, retransmits, send/recv buffer fill |
| `tcpdump -i any port X` | What's actually on the wire |
| `lsof -p PID` | Open file descriptors per process |
| `pprof goroutine` | Stuck goroutines, leak detection |
| `pprof block` | Goroutines blocked on syscalls (set `runtime.SetBlockProfileRate`) |
| `GODEBUG=netdns=go+2` | Verbose resolver decisions |
| `GODEBUG=gctrace=1` | GC pauses correlated with latency spikes |

For production: ship `pprof` endpoints behind admin auth, alert on
fd count, and graph the difference between "accepted conns" and
"closed conns" — a divergence is a leak.

## 13. The conn-per-request anti-pattern

Worth calling out because it shows up regularly in custom
protocols. When a service implements its own RPC over raw TCP and
opens a fresh conn per RPC:

- Every call pays the TCP handshake (1 RTT).
- TIME_WAIT exhaustion kicks in around 30k qps as discussed.
- `connect` calls compete for the same source port range.

Pool conns and reuse them across many requests. Frame the protocol
so the server can tell where one request ends and the next begins
(length prefix, delimiter, request id). The bookkeeping is small;
the throughput difference is large.

## 14. Production checklist for a new TCP service

Before promoting a `net`-based service to "ready":

- [ ] Read deadline set per request, write deadline set per response.
- [ ] First-byte deadline distinct from per-request deadline.
- [ ] `Dialer.KeepAlive` set on outbound (default 15s in `net/http`).
- [ ] Listener wrapped in shutdown logic that drains in-flight conns.
- [ ] Maximum frame/request size capped.
- [ ] Concurrent-conns semaphore.
- [ ] Per-IP rate or conn limit (or LB-side equivalent).
- [ ] Metrics: bytes in/out, conn count, accept errors, deadline
      timeouts, handler durations.
- [ ] `pprof` endpoint on a separate port behind auth.
- [ ] Fd limit raised (`ulimit -n`) and monitored.
- [ ] TIME_WAIT count monitored on outbound-heavy boxes.
- [ ] Handler does not block forever even on a misbehaving peer
      (every blocking call has a deadline).
- [ ] Test that simulates a peer that connects and never sends.
- [ ] Test that simulates a peer that reads at 1 byte/sec.
- [ ] Test that simulates 10k conns and graceful shutdown.

If any of these is missing, you'll discover the gap during an
incident, not during testing.

## 15. Cross-references

- [`../01-io-and-file-handling/professional.md`](../01-io-and-file-handling/professional.md) — cancellable I/O patterns, instrumented readers/writers.
- [`../05-os/`](../05-os/junior.md) — `signal.NotifyContext`, fd inheritance, process management.
- [`../11-net-http-internals/`](../11-net-http-internals/junior.md) — how `net/http.Server` implements every pattern in this file.
- [`../13-crypto/`](../13-crypto/junior.md) — `tls.Conn` integration.
