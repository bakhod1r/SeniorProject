# 8.10 `net` — Middle

> **Audience.** You're comfortable with the basics in
> [junior.md](junior.md) and you're now writing services that take
> production traffic. This file covers the patterns you actually
> reach for: `net.Dialer`, the `net.Resolver`, deadline management
> for request/response protocols, graceful shutdown, UDP server
> shapes, Unix socket details, and the common knobs on `*TCPConn`.

## 1. The `net.Dialer` — your one-stop dialing knob

`net.Dial` is fine for scripts. In services you almost always want
`net.Dialer` because it lets you set timeouts, keepalive, source
addresses, and dual-stack behavior.

```go
d := net.Dialer{
    Timeout:   3 * time.Second,
    KeepAlive: 30 * time.Second,
    DualStack: true, // deprecated but harmless; on by default in 1.12+
}
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()

c, err := d.DialContext(ctx, "tcp", "example.com:443")
```

Knobs worth knowing:

| Field | Effect |
|-------|--------|
| `Timeout` | Cap on the total time `Dial` may spend |
| `Deadline` | Absolute time after which `Dial` fails |
| `KeepAlive` | Sets `SO_KEEPALIVE` interval on the new conn |
| `LocalAddr` | Source address (IP and/or port) for the outbound conn |
| `Control` | Hook to set socket options before the syscall |
| `Resolver` | Custom resolver (default uses `net.DefaultResolver`) |
| `FallbackDelay` | Happy Eyeballs delay between IPv4 and IPv6 attempts |

Always prefer `DialContext` over `Dial`. Cancellation propagation in
a service is non-negotiable, and once you've reached for `Dialer`
you might as well take the context-aware variant.

## 2. The `net.Resolver` — how Go finds names

`net.DefaultResolver` is a `*net.Resolver`. You can swap in your own
to use a specific DNS server, set a different timeout, or force the
pure-Go resolver path:

```go
r := &net.Resolver{
    PreferGo: true, // use the pure-Go resolver, not cgo
    Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
        d := net.Dialer{Timeout: 2 * time.Second}
        return d.DialContext(ctx, network, "1.1.1.1:53")
    },
}

ips, err := r.LookupHost(ctx, "example.com")
```

The `Dial` field overrides how the resolver reaches the DNS server.
This is how you point Go at a specific DoT/DoH gateway, an internal
recursive resolver, or a DNS-over-TCP for environments with broken
UDP.

The Go runtime decides between the pure-Go resolver and cgo's
`getaddrinfo` based on platform and the `GODEBUG=netdns=…` variable.
Common values:

- `netdns=go` — always pure Go.
- `netdns=cgo` — always cgo (requires cgo enabled at build time).
- `netdns=go+1` / `cgo+1` — print diagnostics about the choice.
- `netdns=go+2` — verbose diagnostics for every lookup.

In CGO_ENABLED=0 builds the cgo resolver isn't available; you always
get pure-Go. That is a feature for static binaries — but it also
means `nsswitch.conf` aliases (mDNS, LDAP, etc.) won't work.

## 3. Deadline management for request/response protocols

A long-lived TCP conn that handles many requests needs deadlines per
request, not per conn. The pattern:

```go
func handle(c net.Conn) {
    defer c.Close()
    for {
        c.SetReadDeadline(time.Now().Add(30 * time.Second))
        req, err := readRequest(c)
        if err != nil {
            return
        }

        resp := process(req)

        c.SetWriteDeadline(time.Now().Add(10 * time.Second))
        if err := writeResponse(c, resp); err != nil {
            return
        }
    }
}
```

Three rules of thumb:

1. **Set the read deadline before each request read.** A client may
   open a conn and never send anything; without a deadline you'd
   leak that goroutine.
2. **Set the write deadline before each response write.** A slow or
   dead client leaves data buffering in the kernel until the send
   buffer fills, then `Write` blocks forever.
3. **Use absolute time, not duration.** `SetDeadline` takes
   `time.Time`; the package converts to a future relative kernel
   timeout internally.

For protocols where the application has its own per-message timeout
(e.g., a 5-second SLO), set the deadline to `start.Add(slo)` and
rely on a single deadline covering both the read and the write.

## 4. Graceful shutdown — the canonical shape

A real server has two shutdown phases: stop accepting new conns,
then drain the in-flight ones with a deadline.

```go
type server struct {
    ln  net.Listener
    wg  sync.WaitGroup
    ctx context.Context
}

func (s *server) Serve() error {
    for {
        c, err := s.ln.Accept()
        if err != nil {
            if errors.Is(err, net.ErrClosed) {
                return nil
            }
            return err
        }
        s.wg.Add(1)
        go func() {
            defer s.wg.Done()
            s.handle(c)
        }()
    }
}

func (s *server) Shutdown(ctx context.Context) error {
    s.ln.Close() // unblocks Accept

    done := make(chan struct{})
    go func() { s.wg.Wait(); close(done) }()

    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Ingredients:

- A `WaitGroup` tracks live conns.
- Closing the listener returns `net.ErrClosed` from `Accept`, which
  is the loop's exit signal.
- A bounded `Shutdown(ctx)` waits for the wait group with a deadline,
  so a stuck client doesn't hold up shutdown indefinitely.

To get the SIGINT/SIGTERM trigger in `main`:

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

go srv.Serve()

<-ctx.Done()
shutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(shutCtx)
```

For more on signals see [`../05-os/`](../05-os/junior.md).

## 5. The Accept loop — resilience to transient errors

Some `Accept` errors are recoverable. The classic resilient loop:

```go
var tempDelay time.Duration
for {
    c, err := ln.Accept()
    if err != nil {
        if errors.Is(err, net.ErrClosed) {
            return nil
        }
        if ne, ok := err.(net.Error); ok && ne.Timeout() {
            // Listener has a deadline; ignore.
            continue
        }
        if tempDelay == 0 {
            tempDelay = 5 * time.Millisecond
        } else {
            tempDelay *= 2
        }
        if tempDelay > time.Second {
            tempDelay = time.Second
        }
        log.Printf("accept error: %v; retrying in %v", err, tempDelay)
        time.Sleep(tempDelay)
        continue
    }
    tempDelay = 0
    go handle(c)
}
```

This is the same shape `net/http` uses internally. The only `Accept`
errors that are truly fatal are out-of-memory (rare) and "listener
closed" (your shutdown signal). Everything else — `EMFILE` (out of
file descriptors), `ECONNABORTED` — should back off and retry.

The historical `Temporary()` method on `net.Error` used to flag
recoverable errors, but it's deprecated for `Conn` errors as of Go
1.18. For `Accept` it's still informative; for `Conn` errors prefer
`errors.Is` against specific sentinels (`net.ErrClosed`, `os.ErrDeadlineExceeded`).

## 6. `*TCPConn` knobs: KeepAlive, NoDelay, Linger

The conn returned from a TCP listener or dialer is a `*net.TCPConn`
under the `net.Conn` interface. Type-assert to reach the TCP-only
methods:

```go
tc := c.(*net.TCPConn)
tc.SetKeepAlive(true)
tc.SetKeepAlivePeriod(30 * time.Second)
tc.SetNoDelay(true)               // disable Nagle (default is true)
tc.SetLinger(0)                   // RST instead of FIN on Close
```

What each one does:

| Method | When to touch it |
|--------|------------------|
| `SetKeepAlive` | Detect dead idle peers. Off-by-default on most platforms; the dialer/`Dialer.KeepAlive` turn it on for you. |
| `SetKeepAlivePeriod` | Interval between keepalive probes. 30s–60s for chatty proxies, 2 minutes for default. |
| `SetNoDelay(true)` | Default. Sends each `Write` immediately (Nagle off). |
| `SetNoDelay(false)` | Coalesces small writes for throughput at the cost of latency. Rarely the right choice for interactive RPC. |
| `SetLinger(-1)` | Default; `Close` returns immediately, kernel finishes the FIN. |
| `SetLinger(0)` | `Close` sends RST. Useful for shedding broken clients without waiting in TIME_WAIT. |
| `SetLinger(n>0)` | `Close` blocks up to `n` seconds waiting for FIN-ACK. Almost never useful. |

A point most people miss: `SetNoDelay` is *true* by default in Go's
TCP conns. The package fights Nagle so you don't trip over it
silently. If you've heard "Go TCP is slow because of Nagle," that
hasn't been true since well before Go 1.0.

## 7. CloseWrite and CloseRead — half-close in detail

A TCP conn has two independent flow halves. `CloseWrite` sends a FIN
without tearing down the read side:

```go
tc := c.(*net.TCPConn)
io.Copy(tc, request)         // send the whole request
tc.CloseWrite()              // signal "I'm done sending"
io.Copy(out, tc)             // read the response until peer FINs
tc.Close()
```

`CloseRead` is the mirror — useful when you want to stop reading
incoming bytes (e.g., to discard whatever a misbehaving client is
sending) while continuing to send:

```go
tc.CloseRead() // discards further data from peer
```

Most servers don't need `CloseRead`. Most request/response clients
don't need `CloseWrite` either, because they use length-prefixed or
delimited protocols. But if you ever wonder "how does
`echo foo | nc -N host port` know the server's done?" — it's
`CloseWrite` on the sender plus a peer that reads until EOF.

## 8. UDP server patterns

A UDP server has no Accept loop. The shape is one socket, one read
goroutine, fan-out to workers:

```go
pc, err := net.ListenPacket("udp", ":9000")
if err != nil { return err }
defer pc.Close()

work := make(chan packet, 1024)

// Worker pool.
var wg sync.WaitGroup
for i := 0; i < runtime.NumCPU(); i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for p := range work {
            handle(pc, p)
        }
    }()
}

buf := make([]byte, 65535)
for {
    n, addr, err := pc.ReadFrom(buf)
    if err != nil {
        if errors.Is(err, net.ErrClosed) { break }
        log.Printf("read: %v", err)
        continue
    }
    pkt := packet{data: append([]byte(nil), buf[:n]...), src: addr}
    work <- pkt
}
close(work)
wg.Wait()
```

Two non-obvious points:

1. **The buffer is reused across reads.** You must copy the payload
   before handing it to a worker, or the next read will overwrite
   it.
2. **Read is single-threaded.** A goroutine per packet doesn't
   help; the bottleneck is the kernel handing you packets one at a
   time. The fix at scale is multiple sockets via `SO_REUSEPORT`
   (covered in [optimize.md](optimize.md)).

For sending, `WriteTo` is goroutine-safe. Multiple workers can
share the same `PacketConn` for replies.

## 9. UDP multicast (briefly)

```go
group := net.ParseIP("239.0.0.1")
ifi, _ := net.InterfaceByName("eth0")
addr := &net.UDPAddr{IP: group, Port: 5000}

pc, err := net.ListenMulticastUDP("udp", ifi, addr)
if err != nil { return err }
defer pc.Close()

buf := make([]byte, 1500)
for {
    n, src, _ := pc.ReadFromUDP(buf)
    handle(buf[:n], src)
}
```

`ListenMulticastUDP` joins the group on the given interface. Pass
`nil` for the interface to use the default. To send, dial the
group address with `net.DialUDP("udp", nil, addr)` and call
`Write`. For administrative-scope ranges (239.0.0.0/8) you usually
want to set the TTL via `golang.org/x/net/ipv4` since the stdlib
exposes only the basic API.

## 10. Unix socket idioms

Two patterns that show up in real services:

### Permission-locked Unix socket

The socket file inherits the umask. To make sure only the right user
can connect, set the file mode after listening:

```go
ln, err := net.Listen("unix", "/var/run/app.sock")
if err != nil { return err }
defer os.Remove("/var/run/app.sock")
defer ln.Close()

if err := os.Chmod("/var/run/app.sock", 0o660); err != nil {
    return err
}
```

Or set the umask before listening (process-wide, careful in
servers).

### Abstract namespace (Linux only)

Linux supports a "no filesystem entry" Unix socket whose name starts
with NUL:

```go
ln, err := net.Listen("unix", "@app.sock")
```

Go uses the `@` prefix to mean abstract. Pros: no cleanup, no
filesystem permissions. Cons: anyone in the same network namespace
can connect; only Linux supports it.

## 11. Reading whole records: `bufio.Reader` over a conn

The default `Read` returns whatever the kernel has buffered. For
line-oriented or length-prefixed protocols, wrap in a `bufio.Reader`:

```go
br := bufio.NewReader(c)
line, err := br.ReadString('\n') // includes the '\n'
```

`bufio.Reader.ReadString` and `ReadBytes` allocate; `ReadSlice`
returns a slice into the internal buffer (no allocation, but the
slice is invalidated by the next read). For high-throughput line
protocols, prefer `ReadSlice` plus an immediate copy when you keep
the line around.

For length-prefixed binary, use `io.ReadFull`:

```go
var hdr [4]byte
if _, err := io.ReadFull(c, hdr[:]); err != nil { return err }
n := binary.BigEndian.Uint32(hdr[:])
if n > maxFrame {
    return fmt.Errorf("frame too large: %d", n)
}
body := make([]byte, n)
if _, err := io.ReadFull(c, body); err != nil { return err }
```

Always cap `n`. A peer that sends `0xFFFFFFFF` will OOM you with a
`make([]byte, 4 GiB)` if you trust it.

## 12. The `net.Buffers` write path

`net.Conn` doesn't expose `writev` directly, but `*TCPConn` (and
several others) implement `io.WriterTo` and accept the special
`net.Buffers` slice for vectored I/O:

```go
bufs := net.Buffers{header, body, footer}
n, err := bufs.WriteTo(c)
```

On platforms that support it, this becomes a single `writev`
syscall — useful when you have several non-contiguous slices. The
common case (a length prefix and a payload) is exactly two slices.

After `WriteTo` returns, `bufs` has been consumed: it's reslicd to
contain only the unwritten remainder. So on a short write you can
loop and retry without bookkeeping.

## 13. Errors you'll encounter and how to classify them

`net` errors usually arrive as `*net.OpError`, which wraps the
operation name, network, address, and underlying error:

```go
if oe, ok := err.(*net.OpError); ok {
    log.Printf("op=%s net=%s addr=%v err=%v", oe.Op, oe.Net, oe.Addr, oe.Err)
}
```

The underlying error is one of:

- `*os.SyscallError` — a raw syscall failure with errno.
- `*net.DNSError` — name lookup failure; has `IsTimeout`,
  `IsNotFound`.
- `net.ErrClosed` — the conn or listener is closed (introduced in
  Go 1.16).
- `os.ErrDeadlineExceeded` — a deadline fired (introduced in Go 1.15).

Classification with `errors.Is`:

```go
switch {
case errors.Is(err, net.ErrClosed):
    return nil // clean shutdown
case errors.Is(err, os.ErrDeadlineExceeded):
    // your deadline fired; retry or fail soft
case errors.Is(err, syscall.ECONNREFUSED):
    // peer rejected
}

var dnsErr *net.DNSError
if errors.As(err, &dnsErr) && dnsErr.IsNotFound {
    // DNS NXDOMAIN
}
```

The `Temporary()` method on `net.Error` is deprecated for `Conn`
errors. For `Listener.Accept` it's still meaningful; for
`Conn.Read`/`Write` use `Timeout()` and `errors.Is` against the
specific sentinels.

## 14. File-descriptor handover

A `*TCPListener`, `*TCPConn`, `*UDPConn`, and `*UnixConn` can hand
back the underlying OS file descriptor:

```go
tl := ln.(*net.TCPListener)
f, err := tl.File()       // *os.File, dup'd
defer f.Close()
fd := f.Fd()              // raw uintptr
```

This is how you implement zero-downtime restart: dup the listener,
exec the new binary with the fd in env, and have the new process
turn it back into a listener with `net.FileListener(f)`.

The dup'd fd is independent. Closing it doesn't close the original
`*TCPListener`, and vice versa. After you hand it to a child you
typically close the parent's copy to release the reference.

## 15. Putting it together: a deadline-aware echo server

```go
package main

import (
    "bufio"
    "context"
    "errors"
    "log"
    "net"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    ln, err := net.Listen("tcp", ":8080")
    if err != nil { log.Fatal(err) }

    var wg sync.WaitGroup
    go func() {
        for {
            c, err := ln.Accept()
            if err != nil {
                if errors.Is(err, net.ErrClosed) { return }
                log.Printf("accept: %v", err)
                continue
            }
            wg.Add(1)
            go func() {
                defer wg.Done()
                serve(c)
            }()
        }
    }()

    <-ctx.Done()
    log.Println("shutting down")
    ln.Close()

    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(30 * time.Second):
        log.Println("forced shutdown after 30s")
    }
}

func serve(c net.Conn) {
    defer c.Close()
    s := bufio.NewScanner(c)
    for {
        c.SetReadDeadline(time.Now().Add(60 * time.Second))
        if !s.Scan() {
            return
        }
        c.SetWriteDeadline(time.Now().Add(10 * time.Second))
        if _, err := c.Write(append(s.Bytes(), '\n')); err != nil {
            return
        }
    }
}
```

That's the production shape: signal-driven shutdown, listener close,
wait group with a hard deadline, per-request read and write
deadlines, bufio for line framing. Everything in
[professional.md](professional.md) builds on this skeleton.

## 16. Cross-references

- [`../01-io-and-file-handling/`](../01-io-and-file-handling/junior.md) — `Conn` is `io.ReadWriteCloser`; everything in that leaf works on a conn.
- [`../03-time/`](../03-time/junior.md) — `time.Time`, `time.Now`, `time.Duration` for deadlines.
- [`../05-os/`](../05-os/junior.md) — `signal.NotifyContext` for SIGTERM handling.
- [`../11-net-http-internals/`](../11-net-http-internals/junior.md) — how `net/http.Server` builds on top of `Listener` and `Conn`.
- [`../13-crypto/`](../13-crypto/junior.md) — wrapping `net.Conn` in `tls.Conn` for TLS.
