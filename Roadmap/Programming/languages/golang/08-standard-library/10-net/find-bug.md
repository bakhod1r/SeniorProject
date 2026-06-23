# 8.10 `net` — Find the Bug

> Twenty real-world bugs, all in the `net` layer. Each one comes from
> production code: the kind of mistake that compiles, passes light
> testing, and fails under load. For each, the buggy code is shown,
> followed by what goes wrong, why, and the fix.

## 1. The accept loop that never returns

```go
ln, _ := net.Listen("tcp", ":8080")
for {
    c, err := ln.Accept()
    if err != nil {
        log.Printf("accept: %v", err)
        continue
    }
    go handle(c)
}
```

**What goes wrong.** When the listener is closed (graceful shutdown),
`Accept` returns `net.ErrClosed` *forever*. The loop spins, logging
"use of closed network connection" thousands of times per second.

**Why.** The `continue` blindly retries every error, including the
"listener is dead" signal.

**Fix.**

```go
for {
    c, err := ln.Accept()
    if err != nil {
        if errors.Is(err, net.ErrClosed) {
            return
        }
        log.Printf("accept: %v", err)
        continue
    }
    go handle(c)
}
```

`net.ErrClosed` is the sentinel introduced in Go 1.16. Don't
match the error string.

## 2. The conn that never closes

```go
ln, _ := net.Listen("tcp", ":8080")
for {
    c, _ := ln.Accept()
    go handle(c)
}

func handle(c net.Conn) {
    s := bufio.NewScanner(c)
    for s.Scan() {
        c.Write(s.Bytes())
    }
}
```

**What goes wrong.** Each accepted conn leaks. After the client
disconnects, the goroutine returns but the file descriptor is
never freed. After enough connections, `EMFILE` (too many open
files) takes down the listener.

**Why.** `Scanner.Scan` returning false closes the scanner but not
the underlying conn.

**Fix.** `defer c.Close()` on the first line of `handle`.

## 3. The infinite read

```go
func handle(c net.Conn) {
    defer c.Close()
    buf := make([]byte, 1024)
    for {
        n, err := c.Read(buf)
        if err != nil { return }
        process(buf[:n])
    }
}
```

**What goes wrong.** A connected client that goes silent (network
partition, crashed app on the other end without keepalive) leaves
this goroutine in `Read` *forever*. Memory and goroutine count
climb until OOM.

**Why.** `Read` has no deadline; the kernel just keeps waiting.

**Fix.** Set a read deadline before each `Read`.

```go
for {
    c.SetReadDeadline(time.Now().Add(60 * time.Second))
    n, err := c.Read(buf)
    if err != nil { return }
    process(buf[:n])
}
```

## 4. The deadline that fires forever

```go
c.SetReadDeadline(time.Now().Add(5 * time.Second))
for {
    n, err := c.Read(buf)
    if err != nil {
        if ne, ok := err.(net.Error); ok && ne.Timeout() {
            log.Println("timeout, retry")
            continue
        }
        return
    }
    process(buf[:n])
}
```

**What goes wrong.** After the first timeout, the deadline is in
the past. Every subsequent `Read` fails immediately with the same
timeout error. The loop spins logging "timeout, retry" at full
CPU.

**Why.** `SetReadDeadline` set once; never reset.

**Fix.** Reset on each iteration, or clear after a non-fatal
timeout:

```go
for {
    c.SetReadDeadline(time.Now().Add(5 * time.Second))
    n, err := c.Read(buf)
    ...
}
```

## 5. The trusted length prefix

```go
var hdr [4]byte
io.ReadFull(c, hdr[:])
n := binary.BigEndian.Uint32(hdr[:])
body := make([]byte, n)
io.ReadFull(c, body)
```

**What goes wrong.** A peer sends `0xFFFFFFFF` as the length. `make`
tries to allocate 4 GiB; the runtime kills the process. Trivially
exploitable as a DoS.

**Why.** No size cap on peer-supplied length.

**Fix.**

```go
const maxFrame = 1 << 20 // 1 MiB
if n > maxFrame {
    return fmt.Errorf("frame too large: %d", n)
}
body := make([]byte, n)
```

Always cap. Reject *or* close the conn.

## 6. The conn buffered into oblivion

```go
func handle(c net.Conn) {
    defer c.Close()
    var buf bytes.Buffer
    for {
        n, err := c.Read(make([]byte, 4096))
        buf.Write(make([]byte, n))
        if err != nil { return }
    }
}
```

**What goes wrong.** A peer that sends 10 GB fills `buf` until the
process OOMs. Variant of bug 5, but in streaming form.

**Why.** Unbounded application-level buffer holds bytes that the
kernel would otherwise be unable to deliver (TCP backpressure).

**Fix.** Cap the buffer; or stream-process without buffering; or
wrap with `io.LimitReader(c, max)` so reading past the cap returns
EOF.

## 7. The UDP buffer reuse

```go
buf := make([]byte, 65535)
for {
    n, addr, _ := pc.ReadFrom(buf)
    go func() {
        process(buf[:n], addr)
    }()
}
```

**What goes wrong.** The goroutine sees `buf[:n]` for the *next*
read by the time it runs, not the one that was current when it
spawned. Random data corruption; sometimes the goroutine reads the
zero suffix that's been overwritten.

**Why.** `buf` is shared across reads. Spawning a goroutine that
references it is a race.

**Fix.** Copy the slice before fan-out:

```go
data := append([]byte(nil), buf[:n]...)
go process(data, addr)
```

## 8. The half-close that wasn't

```go
func proxy(client net.Conn, server net.Conn) {
    go io.Copy(server, client)
    io.Copy(client, server)
    server.Close()
    client.Close()
}
```

**What goes wrong.** `io.Copy(client, server)` returns when `server`
returns EOF. But `io.Copy(server, client)` is *still running* — it
only finishes when `client` returns EOF. If the server returned
EOF but the client is still talking, the second goroutine hangs
forever.

**Why.** Closing `client` after the second goroutine should
unblock it, but only because `Close` interrupts in-flight reads.
The original goroutine might have already finished (and double-Close
is a different bug). The races are nasty.

**Fix.** Cancel both directions when either finishes; use
`CloseWrite` to propagate half-close cleanly.

```go
errc := make(chan error, 2)
go func() { _, err := io.Copy(server, client); errc <- err }()
go func() { _, err := io.Copy(client, server); errc <- err }()
<-errc
server.Close()
client.Close()
<-errc
```

## 9. The `ResolveTCPAddr` that's done twice

```go
func dial(host string) (net.Conn, error) {
    addr, err := net.ResolveTCPAddr("tcp", host)
    if err != nil { return nil, err }
    return net.Dial("tcp", addr.String())
}
```

**What goes wrong.** Two DNS lookups. `ResolveTCPAddr` does one;
`net.Dial` with a hostname does another. The first is wasted.

**Why.** `Dial` accepts a string, re-resolves; `DialTCP` accepts a
`*TCPAddr` and skips resolution.

**Fix.**

```go
addr, err := net.ResolveTCPAddr("tcp", host)
if err != nil { return nil, err }
return net.DialTCP("tcp", nil, addr)
```

Or skip the explicit resolve entirely and pass the host string to
`net.Dial`.

## 10. The `lookup` that hangs on a dead resolver

```go
ips, err := net.LookupHost("internal.example.com")
```

**What goes wrong.** With cgo resolver and a misbehaving DNS
server, this can block for 30 seconds (the libc default). The
caller's context deadline doesn't help because there's no context.

**Why.** `net.LookupHost` is `net.DefaultResolver.LookupHost(context.Background(), host)`.
The cgo path can't be canceled.

**Fix.** Use the `Resolver` method with a context, and force the
pure-Go resolver:

```go
r := &net.Resolver{PreferGo: true}
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()
ips, err := r.LookupHost(ctx, "internal.example.com")
```

## 11. The dialer with no timeout

```go
c, err := net.Dial("tcp", "remote-rpc:8000")
```

**What goes wrong.** The TCP handshake can hang on a packet-dropping
firewall for the SYN retransmit timeout (~75 seconds on Linux).
A user-facing request that depends on this dial hangs accordingly.

**Why.** No timeout, no context.

**Fix.**

```go
d := net.Dialer{Timeout: 3 * time.Second}
c, err := d.DialContext(ctx, "tcp", "remote-rpc:8000")
```

Always set a timeout. In services, always use `DialContext`.

## 12. The Unix socket that won't restart

```go
ln, err := net.Listen("unix", "/tmp/app.sock")
```

**What goes wrong.** The first run works. After a crash (kill -9,
panic without defer), the socket file persists. The next run fails
with `bind: address already in use`.

**Why.** `os.Remove(path)` only ran on the clean exit path.

**Fix.** Pre-clean before `Listen`:

```go
os.Remove("/tmp/app.sock") // ignore error
ln, err := net.Listen("unix", "/tmp/app.sock")
```

Or use the Linux abstract namespace (`@app.sock`), which has no
filesystem entry to clean.

## 13. The IP comparison that lies

```go
if bytes.Equal(remoteIP, allowedIP) {
    allow()
}
```

**What goes wrong.** If `remoteIP` is the 16-byte IPv4-in-IPv6 form
and `allowedIP` is the 4-byte form (or vice versa), comparison
fails for what's actually the same IP.

**Why.** `net.IP` is `[]byte` and the IPv4 address has two
representations.

**Fix.**

```go
if remoteIP.Equal(allowedIP) {
    allow()
}
```

Or, in new code, use `netip.Addr` (Go 1.18+) which is a comparable
value type:

```go
if remote == allowed { ... } // both netip.Addr
```

## 14. The Accept loop that exits on EMFILE

```go
for {
    c, err := ln.Accept()
    if err != nil {
        return err
    }
    go handle(c)
}
```

**What goes wrong.** Under fd exhaustion (`EMFILE: too many open
files`), `Accept` returns the error. The function returns, the
listener is gone, the service is dead. EMFILE was transient — a
brief spike — but the service stays down.

**Why.** No retry on temporary errors.

**Fix.** Back off and retry transient errors:

```go
var delay time.Duration
for {
    c, err := ln.Accept()
    if err != nil {
        if errors.Is(err, net.ErrClosed) { return nil }
        if ne, ok := err.(net.Error); ok && ne.Temporary() {
            if delay == 0 { delay = 5 * time.Millisecond } else { delay *= 2 }
            if delay > time.Second { delay = time.Second }
            time.Sleep(delay)
            continue
        }
        return err
    }
    delay = 0
    go handle(c)
}
```

`Temporary()` is still the documented mechanism for `Accept`
errors (only deprecated for `Conn` errors).

## 15. The HTTP-style "drain to reuse" missed

```go
resp, err := http.Get(url)
if err != nil { return err }
io.Copy(out, resp.Body)
resp.Body.Close()
```

**What goes wrong** (in the `net` layer). If `out` returns an
error mid-copy, the body is not drained. `http.Transport` cannot
return the underlying TCP conn to the pool — it has to close it.
You're now opening a fresh conn (with handshake) for the next
request.

**Why.** A partially read body holds the conn. Closing without
draining tears it down.

**Fix.**

```go
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()
```

`io.Copy` to `io.Discard` finishes the body so the conn is
returned to the pool.

## 16. The deadline in the past

```go
deadline := time.Now().Add(5 * time.Second)
// ... slow setup ...
c.SetReadDeadline(deadline)
n, err := c.Read(buf)
```

**What goes wrong.** If the setup took 6 seconds, `deadline` is
already in the past when set. `Read` fails immediately with
deadline-exceeded.

**Why.** Computing the deadline once and using it later means the
real per-operation budget is `(5s - setup_time)`, possibly
negative.

**Fix.** Compute the deadline immediately before the operation:

```go
c.SetReadDeadline(time.Now().Add(5 * time.Second))
```

If the deadline is request-scoped, use `context.WithTimeout` and
propagate via `Dialer`/explicit context.

## 17. The Listener test that flakes

```go
func TestServer(t *testing.T) {
    go server.Run(":8080")
    time.Sleep(100 * time.Millisecond) // wait for listen
    c, _ := net.Dial("tcp", "127.0.0.1:8080")
    ...
}
```

**What goes wrong.** Two flakes: (1) port 8080 may be in use by
another test or a leftover process; (2) the 100ms sleep is racy.
On a slow CI box, the server hasn't started; on a fast box, the
test passes.

**Why.** Hard-coded port + sleep-based synchronization.

**Fix.** Use port 0 and a sync mechanism:

```go
ln, err := net.Listen("tcp", "127.0.0.1:0")
if err != nil { t.Fatal(err) }
addr := ln.Addr().String()
go server.Serve(ln)
t.Cleanup(func() { ln.Close() })

c, err := net.Dial("tcp", addr)
```

## 18. The UDP packet larger than MTU

```go
big := make([]byte, 8000)
pc.WriteTo(big, addr)
```

**What goes wrong.** On internet paths, the packet may be silently
dropped (if DF is set and PMTU < 8000). On Linux without IP
fragmentation, you get `EMSGSIZE`. Your "send succeeded" log lies.

**Why.** UDP doesn't fragment at the application layer; the
kernel does (or doesn't), and middle boxes may drop oversized
packets.

**Fix.** Cap datagram size at 1200 bytes for internet traffic;
implement application-layer fragmentation if needed.

## 19. The `SetLinger(0)` for performance

```go
tc := c.(*net.TCPConn)
tc.SetLinger(0) // "for performance"
defer tc.Close()

io.Copy(tc, response) // write 100 KB
```

**What goes wrong.** `Close` sends RST. Any data still in the
kernel send buffer (likely some, on a slow client) is *discarded*.
The peer sees `ECONNRESET` and may have only the first chunk of
the response.

**Why.** `SetLinger(0)` means "RST and drop unsent data."

**Fix.** Don't set linger to 0 on conns whose data matters. The
proper "for performance" use is rejecting at-capacity new conns
without TIME_WAIT cost — not normal traffic.

## 20. The keepalive that never connects

```go
d := net.Dialer{KeepAlive: 30 * time.Second}
c, _ := d.Dial("tcp", "rpc:8000")

// in handler:
n, err := c.Read(buf)
```

**What goes wrong.** The dialer set `SO_KEEPALIVE` with a 30s
interval, but the *first probe* doesn't fire until the connection
has been idle for the *system default* idle time — usually 2
hours. A peer that vanishes after handshake but before keepalive
kicks in is undetectable for 2 hours.

**Why.** Go's `KeepAlive` field sets the *interval between
probes*, not the idle time before probes start
(`TCP_KEEPIDLE`). Stdlib doesn't expose `TCP_KEEPIDLE` directly.

**Fix.** Set the kernel option via `Dialer.Control`:

```go
d := net.Dialer{
    KeepAlive: 30 * time.Second,
    Control: func(_, _ string, c syscall.RawConn) error {
        return c.Control(func(fd uintptr) {
            syscall.SetsockoptInt(int(fd), syscall.IPPROTO_TCP, unix.TCP_KEEPIDLE, 60)
            syscall.SetsockoptInt(int(fd), syscall.IPPROTO_TCP, unix.TCP_KEEPCNT, 3)
            syscall.SetsockoptInt(int(fd), syscall.IPPROTO_TCP, unix.TCP_KEEPINTVL, 10)
        })
    },
}
```

Or, in Go 1.23+, use `net.KeepAliveConfig` on `Dialer.KeepAliveConfig`,
which exposes Idle / Interval / Count.

## 21. The race on `net.Listener.Close`

```go
go func() {
    <-ctx.Done()
    ln.Close()
}()
for {
    c, err := ln.Accept()
    if err != nil { return }
    go handle(c)
}
```

**What goes wrong.** The pattern is correct *if* you handle the
error. As written, `Accept` returns `net.ErrClosed`, the loop
returns — but if you forgot `if errors.Is(err, net.ErrClosed)`,
you're back to bug 1.

Subtler race: between `ln.Close()` and `Accept`'s next call, a
client may have started connecting; that conn gets aborted.
Usually harmless; mention to interviewers if asked about
shutdown semantics.

**Fix.** Check the error explicitly:

```go
if errors.Is(err, net.ErrClosed) { return }
```

## 22. Goroutine leak from blocking write

```go
func handle(c net.Conn) {
    defer c.Close()
    s := bufio.NewScanner(c)
    for s.Scan() {
        if _, err := c.Write(append(s.Bytes(), '\n')); err != nil {
            return
        }
    }
}
```

**What goes wrong.** A client that connects, sends a request, and
then *stops reading* causes the server's `Write` to block (kernel
send buffer fills, then `Write` blocks for backpressure). Without
a write deadline, that goroutine hangs forever. Repeat with many
such clients and the server is dead from goroutine accumulation.

**Why.** No write deadline.

**Fix.**

```go
c.SetWriteDeadline(time.Now().Add(10 * time.Second))
if _, err := c.Write(...); err != nil { return }
```

## 23. Closing while reading

```go
go func() {
    <-quit
    c.Close()
}()
n, err := c.Read(buf)
```

**What goes wrong.** Nothing! This is correct. `Conn` is
goroutine-safe in this sense: closing while another goroutine is
in `Read` interrupts the read with `net.ErrClosed`. It is the
documented mechanism.

The bug is *not* doing this when you need to interrupt a read.
Without `Close` or `SetReadDeadline`, a blocked `Read` can't be
canceled — the goroutine is stuck.

**Lesson.** Calling `Close` from another goroutine to unblock a
peer goroutine is *intentional*, not a race. Use `errors.Is(err,
net.ErrClosed)` to recognize it.

## 24. Trusting `LocalAddr` to give the original interface

```go
ln, _ := net.Listen("tcp", ":8080")
addr := ln.Addr().String() // "[::]:8080" or ":8080"
fmt.Println("listening on", addr)
```

**What goes wrong.** The address is `[::]:8080` (or `0.0.0.0:8080`),
which is the *bind* address, not a routable client address. Logs
saying "listening on `[::]:8080`" are correct but unhelpful for
clients trying to connect.

**Why.** The bind to all interfaces shows up as `0.0.0.0` /
`[::]`.

**Fix.** Show the explicit interface or the resolved address.
For tests, bind to `127.0.0.1:0` so the address is unambiguously
local.

## 25. The `sync.Map` used in the wrong direction

```go
var conns sync.Map // remoteAddr -> conn

go func() {
    for {
        c, _ := ln.Accept()
        conns.Store(c.RemoteAddr().String(), c)
        go handle(c)
    }
}()

// Later, to broadcast:
conns.Range(func(key, value any) bool {
    c := value.(net.Conn)
    c.Write(msg)
    return true
})
```

**What goes wrong.** Two issues. (1) Keying by `RemoteAddr().String()`
isn't unique — two NAT'd clients can have the same source. (2)
`c.Write` inside `Range` is serialized; if any client is slow,
the whole broadcast stalls.

**Fix.** Key by a unique conn id; copy the conn list under read,
write outside the range:

```go
var list []net.Conn
conns.Range(func(_, v any) bool {
    list = append(list, v.(net.Conn))
    return true
})
for _, c := range list {
    c.SetWriteDeadline(time.Now().Add(time.Second))
    c.Write(msg)
}
```

Slow clients fail with deadline; the rest succeed.

## 26. `bytes.Buffer` shared between goroutines

```go
var buf bytes.Buffer

go func() {
    for s.Scan() { buf.WriteString(s.Text()) }
}()

go func() {
    for {
        b := buf.Bytes()
        process(b)
    }
}()
```

**What goes wrong.** `bytes.Buffer` is not goroutine-safe.
Concurrent `WriteString` and `Bytes` (or any combination) is a
race that the race detector flags but production builds do not.

**Why.** `bytes.Buffer` documentation explicitly does not
guarantee concurrent safety.

**Fix.** Use a channel between the two goroutines, or wrap the
buffer with a mutex, or use `io.Pipe`.

## 27. `LookupHost` returning unsorted

```go
ips, _ := net.LookupHost("example.com")
fmt.Println("primary:", ips[0])
```

**What goes wrong.** Treating `ips[0]` as "the primary" is wrong.
DNS doesn't guarantee an order; `getaddrinfo` may sort by RFC 6724
preferences (IPv6 first, etc.) but the order is implementation
detail. A retry strategy that always tries `ips[0]` first hammers
one address.

**Fix.** Iterate all addresses, retrying on error. For
priority/weight semantics, use `LookupSRV` or design the protocol
with an explicit primary.

## 28. UDP send before listen

```go
c, _ := net.Dial("udp", "remote:9000")
c.Write([]byte("hello"))

buf := make([]byte, 1500)
c.Read(buf) // wait for response
```

**What goes wrong.** No deadline on the read. If the response is
lost (UDP is unreliable), the goroutine hangs forever.

**Fix.** `c.SetReadDeadline(time.Now().Add(d))` before each read,
treat the timeout as "no response," retry or fail.

## 29. The TCP server with non-blocking expectations

```go
c.Write(smallMsg) // assume non-blocking for small messages
c.Write(smallMsg)
c.Write(smallMsg)
```

**What goes wrong.** Even small writes can block: if the kernel
send buffer is full and the peer isn't reading, the third small
`Write` blocks even though the byte count fits in any buffer.

**Why.** TCP is flow-controlled. Small or large doesn't matter when
the receive window is closed.

**Fix.** Set a write deadline. Treat blocking as backpressure, not
an error of size.

## 30. Using `LocalAddr` of an unconnected UDP socket

```go
pc, _ := net.ListenPacket("udp", ":0")
local := pc.LocalAddr().(*net.UDPAddr)
fmt.Println("port:", local.Port)
```

**What goes wrong.** Nothing if you control both ends. But
`LocalAddr.IP` is `[]byte{0, 0, 0, 0}` (or empty `IPv6unspecified`)
because the socket is bound to "all interfaces." A peer that has
to be told "I'm at 192.0.2.1" can't get that from `LocalAddr`.

**Why.** Bind-to-all means no specific local IP.

**Fix.** Use platform-specific `IP_PKTINFO` / `IPV6_RECVPKTINFO`
to discover the local IP per packet, or `net.InterfaceAddrs()` and
choose. For most uses, `0.0.0.0` is fine; the peer's reply goes
through the same routing.

## 31. The "dialer gives me a Conn, I store it as net.TCPConn"

```go
var conns []*net.TCPConn

c, _ := net.Dial("tcp", addr)
conns = append(conns, c.(*net.TCPConn))
```

**What goes wrong.** `net.Dial` returns `net.Conn`. The type
assertion to `*net.TCPConn` works for `tcp` networks but panics if
someone passes `tcp4` *and* you swap in `tls.Conn` later. Storing
the concrete type couples your code to that specific transport.

**Fix.** Store as `net.Conn`. Type-assert to `*net.TCPConn` only
in the spot where you need the TCP-specific method, with the
two-form assertion:

```go
if tc, ok := c.(*net.TCPConn); ok {
    tc.SetKeepAlive(true)
}
```

## 32. The DNS round-robin fallacy

```go
ips, _ := net.LookupHost("svc.example.com")
ip := ips[0]
c, _ := net.Dial("tcp", net.JoinHostPort(ip, "8080"))
```

**What goes wrong.** You picked the first IP. If it's unreachable,
the dial fails — and you don't try the others. With multiple A
records, the resolver was doing DNS round-robin for you; by
picking `[0]` you defeated it.

**Fix.** Iterate, retry, or just pass the *hostname* to `Dial` —
the dialer tries each address in order and falls through.

```go
c, _ := net.Dial("tcp", "svc.example.com:8080")
```

## 33. Assuming `Read` returns `len(buf)` bytes

```go
n, _ := c.Read(buf[:8])
header := binary.BigEndian.Uint64(buf[:8])
```

**What goes wrong.** `Read` may return 1–7 bytes. `Uint64` reads 8;
the prefix is the right bytes followed by stale buffer content.
Wrong header value → wrong frame → corrupt protocol state.

**Fix.** `io.ReadFull`:

```go
io.ReadFull(c, buf[:8])
header := binary.BigEndian.Uint64(buf[:8])
```

## 34. The `os.Remove` after `Listen` fails

```go
ln, err := net.Listen("unix", "/tmp/app.sock")
if err != nil {
    os.Remove("/tmp/app.sock") // try to recover from leftover
    ln, err = net.Listen("unix", "/tmp/app.sock")
}
```

**What goes wrong.** The first `Listen` failed because the file
existed. `os.Remove` succeeds and the second `Listen` succeeds.
But on a panic/crash this code never runs — you're back to "won't
restart."

**Fix.** Pre-clean unconditionally:

```go
os.Remove("/tmp/app.sock") // ignore error
ln, err := net.Listen("unix", "/tmp/app.sock")
```

Pre-cleaning is safe: if no file existed, `Remove` returns "not
exist" which is harmless.

## 35. Forgetting the timer goroutine doesn't stop on its own

```go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
// no defer cancel()
go func() {
    <-ctx.Done()
    c.Close()
}()
do(c)
```

**What goes wrong.** No `defer cancel()`. If `do` finishes before
the deadline, the timer keeps running, the watcher goroutine keeps
sleeping, and they all leak. After enough successful requests,
goroutine count climbs.

**Fix.** Always `defer cancel()`. The cancel function is cheap to
call multiple times (idempotent).

## 36. Reusing a closed conn

```go
c, _ := pool.Get()
n, err := c.Read(buf)
if err != nil {
    c.Close()
    return err
}
pool.Put(c) // "for next time"
```

**What goes wrong.** When `Read` errored, `c` is dead. `Put`
returns it to the pool. Some later caller pulls it out and uses
a closed (or half-closed) conn.

**Fix.** Don't `Put` a conn that errored. The pool's `Put` should
accept only known-good conns.

```go
if err != nil {
    c.Close()
    return err
}
pool.Put(c) // only here, on success
```

## 37. Treating `EOF` as error in protocol code

```go
for {
    var hdr [4]byte
    if _, err := io.ReadFull(c, hdr[:]); err != nil {
        log.Printf("read header: %v", err)
        return
    }
    ...
}
```

**What goes wrong.** Logs a noisy error every time a peer
disconnects cleanly. `io.EOF` is the normal end-of-stream
signal — not a problem worth alerting on.

**Fix.** Distinguish EOF from real errors:

```go
if err != nil {
    if !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
        log.Printf("read header: %v", err)
    }
    return
}
```

`io.ErrUnexpectedEOF` (peer closed mid-header) is also a hint
about a misbehaving peer, but is logically different from a clean
disconnect.

## 38. Dropping `WriteTo` errors

```go
for _, msg := range msgs {
    pc.WriteTo(msg, addr)
}
```

**What goes wrong.** UDP `WriteTo` can return `ENOBUFS` (kernel
out of buffer space) or `EMSGSIZE` (datagram too large). Ignoring
the error means silent drops *plus* you don't notice the
configuration problem.

**Fix.** At minimum, count and log errors:

```go
if _, err := pc.WriteTo(msg, addr); err != nil {
    metrics.SendErrors.Inc()
    log.Printf("send: %v", err)
}
```

`ENOBUFS` is transient; retry with backoff. `EMSGSIZE` is
configuration; don't retry.

## 39. The shutdown that doesn't drain

```go
go func() {
    <-ctx.Done()
    ln.Close()
    os.Exit(0)
}()
```

**What goes wrong.** In-flight requests are interrupted mid-write
when the process exits. Clients see truncated responses or
`ECONNRESET`. Bad UX.

**Fix.** Track in-flight handlers, close listener, wait for
handlers to drain (with timeout), *then* exit:

```go
go func() {
    <-ctx.Done()
    ln.Close()
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(30 * time.Second):
    }
    os.Exit(0)
}()
```

## 40. `Pipe` as performance trick

```go
pr, pw := net.Pipe()
go func() { writeBigBlob(pw); pw.Close() }()
processStream(pr)
```

**What goes wrong.** `net.Pipe` is *synchronous*: every `Write`
blocks until a `Read` consumes it. There is no buffer. For
"streaming a big blob between goroutines," `net.Pipe` is much
slower than a `chan []byte` with a small buffer or `io.Pipe`
(same pattern but with a single-byte channel).

**Fix.** Use `io.Pipe` for streaming I/O between goroutines (it's
the proper API for that), reserve `net.Pipe` for code that wants a
`net.Conn` interface (e.g., testing a server with no real socket).

## Cross-references

- [`../01-io-and-file-handling/find-bug.md`](../01-io-and-file-handling/find-bug.md) — adjacent stdlib I/O bugs.
- [senior.md](senior.md) — the contracts these bugs violate.
- [optimize.md](optimize.md) — performance-flavored bugs that look like correctness bugs.
