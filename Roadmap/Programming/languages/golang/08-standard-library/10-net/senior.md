# 8.10 `net` — Senior

> **Audience.** You've shipped network services and seen them
> misbehave. This file is the precise contract: what `Conn` and
> `Listener` guarantee and forbid, what deadlines actually do, the
> resolver split, the error taxonomy, and the systems-level details
> that separate code that mostly works from code that survives.

## 1. The exact `net.Conn` contract

`Conn` is `io.ReadWriteCloser` plus addresses and deadlines. The
embedded `Read` and `Write` inherit the `io.Reader` and `io.Writer`
contracts (covered in [`../01-io-and-file-handling/senior.md`](../01-io-and-file-handling/senior.md)).
The additions specific to `net.Conn`:

> **Multiple goroutines may invoke methods on a Conn simultaneously.**

This is the single most important `net.Conn` rule and the one most
often misunderstood. It means specifically:

- One goroutine in `Read`, another in `Write`: legal.
- One goroutine in `Read`, another in `Read`: not legal in general
  for stream conns (you'll interleave bytes); the package doesn't
  forbid it but the result is garbage. For `PacketConn`,
  concurrent `ReadFrom` calls are legal — each gets a different
  datagram.
- One goroutine in any operation, another in `Close`: legal. Close
  unblocks the operation with `net.ErrClosed`.
- One goroutine in any operation, another in `SetDeadline` or
  `SetReadDeadline` or `SetWriteDeadline`: legal. The new deadline
  takes effect for the operation in flight (this is how the
  context cancellation pattern works).

The asymmetry between `Read` and `Write`: a single in-flight `Write`
call may translate to multiple `send` syscalls under the hood. The
stdlib retries short writes inside `Write`; the API contract is that
`Write` returns when the whole slice has been written or an error
occurred. So *one* goroutine in `Write` is fine; two are not.

## 2. Deadlines — the precise semantics

```go
SetDeadline(t time.Time) error
SetReadDeadline(t time.Time) error
SetWriteDeadline(t time.Time) error
```

The contract:

1. **Deadlines are absolute.** `SetDeadline(time.Now().Add(5*time.Second))`
   says "fail if the operation isn't done by 5 seconds from now."
   Resetting the deadline mid-operation is allowed and changes the
   effective limit for the operation in flight.

2. **Deadlines persist across operations.** Once set, the deadline
   applies to *every* subsequent read or write until you change it.
   For a request/response server you must reset before each request.

3. **A passed deadline does not auto-clear.** A conn whose deadline
   has fired and not been reset will keep returning timeouts on
   every subsequent `Read`/`Write` until you call `SetDeadline(time.Time{})`
   or set a future deadline.

4. **The zero `time.Time` means no deadline.** That is how you clear
   one.

5. **A deadline in the past makes the next operation fail
   immediately.** This is how the context-cancellation pattern
   below works — the watcher sets the deadline to "now" to interrupt
   a blocking syscall.

6. **The error is `os.ErrDeadlineExceeded` and `Timeout() == true`.**
   `errors.Is(err, os.ErrDeadlineExceeded)` is the modern check; the
   older `if ne, ok := err.(net.Error); ok && ne.Timeout()` still works.

The kernel mechanism: Go's runtime poller registers a wakeup at the
deadline. When the timer fires, the goroutine blocked on the syscall
is unparked with `EAGAIN`, and the package translates that to
`os.ErrDeadlineExceeded`.

## 3. Cancellation via deadline

There is no `Conn.ReadContext`. The pattern that works is a watcher
that sets a past deadline when the context is canceled:

```go
func readCtx(ctx context.Context, c net.Conn, p []byte) (int, error) {
    if d, ok := ctx.Deadline(); ok {
        c.SetReadDeadline(d)
    }
    done := make(chan struct{})
    defer close(done)
    go func() {
        select {
        case <-ctx.Done():
            c.SetReadDeadline(time.Unix(1, 0)) // past
        case <-done:
        }
    }()
    return c.Read(p)
}
```

The watcher races the read; whichever finishes first wins. If the
context is canceled, the past-deadline trick wakes the read with a
timeout error. After the function returns, the `done` channel
shuts down the watcher.

This works because `SetReadDeadline` is goroutine-safe with
in-flight reads — it's the documented mechanism for interrupting
them.

## 4. The `net.Listener` contract

```go
type Listener interface {
    Accept() (Conn, error)
    Close() error
    Addr() Addr
}
```

What's guaranteed:

1. **`Accept` blocks until either a conn arrives or `Close` is
   called.** A closed listener returns `net.ErrClosed` from the
   next (and every subsequent) `Accept`.
2. **`Accept` is goroutine-safe.** Multiple goroutines calling
   `Accept` on the same listener is supported; one of them gets
   each new conn.
3. **`Close` does not affect already-accepted conns.** They stay
   open; you have to close them yourself.
4. **`Addr` is callable any time.** Even after `Close`.

The deprecated `*Listener.SetDeadline(t)` exists on `*TCPListener`
and friends — useful in tests that need bounded `Accept`. Modern
servers prefer the close-the-listener pattern from
[middle.md](middle.md).

## 5. The `net.Error` interface and what's deprecated

```go
type Error interface {
    error
    Timeout() bool
    Temporary() bool
}
```

`Timeout()` is reliable — it returns `true` if the error came from
a deadline.

`Temporary()` is officially deprecated for errors returned by
`Conn.Read`, `Conn.Write`, and `Conn.Close` since Go 1.18. The
classification was always heuristic and led to retry loops that
silently masked real bugs. For `Listener.Accept` errors,
`Temporary()` is still informative (and the canonical `net/http`
Accept loop still uses it).

For new code:

- Use `errors.Is(err, net.ErrClosed)` for clean-shutdown signal.
- Use `errors.Is(err, os.ErrDeadlineExceeded)` for deadline.
- Use `errors.As(err, &dnsErr)` for DNS-specific fields.
- Don't write retry logic gated on `Temporary()`. Match specific
  syscalls or specific `net` sentinels instead.

## 6. The error wrapping chain

A typical conn error is wrapped twice:

```
*net.OpError
  └── *os.SyscallError
        └── syscall.Errno (e.g., ECONNRESET)
```

`*net.OpError` adds the operation name (`"read"`, `"write"`,
`"dial"`), the network (`"tcp"`), and the addresses. It implements
`Unwrap`, so `errors.Is` and `errors.As` walk through it.

```go
err := c.Read(buf)
var oe *net.OpError
if errors.As(err, &oe) {
    fmt.Println(oe.Op, oe.Addr, oe.Err)
}
if errors.Is(err, syscall.ECONNRESET) {
    // peer reset the connection
}
```

DNS errors have their own type:

```go
type DNSError struct {
    Err         string
    Name        string
    Server      string
    IsTimeout   bool
    IsTemporary bool
    IsNotFound  bool
}
```

`IsNotFound` distinguishes NXDOMAIN from other failures — the right
field to branch on when a missing record means "skip this host."

## 7. The Go vs cgo resolver split

When your binary needs to resolve `example.com:443`, Go has two
implementations available. The choice is made at runtime per-lookup
and depends on the platform, build flags, and `GODEBUG=netdns`.

### The pure-Go resolver

- Reads `/etc/resolv.conf` directly, parses `nameserver`, `search`,
  `options`.
- Sends DNS packets to the configured servers using the Go
  networking stack.
- Honors `context.Context` for cancellation natively.
- Does not consult `nsswitch.conf`. mDNS, LDAP, and `files`-only
  hosts won't work.
- Always available; the default in `CGO_ENABLED=0` builds.

### The cgo resolver

- Calls the platform's `getaddrinfo` (POSIX) or `GetAddrInfoEx`
  (Windows).
- Honors `nsswitch.conf`, `/etc/hosts`, mDNS, NIS, LDAP, etc.
- Cannot be canceled mid-call (the syscall is opaque to Go's
  runtime). A 30-second resolver hang holds your goroutine.
- Requires cgo (and on some platforms, the system C library) at
  build time.

### The decision

- If `CGO_ENABLED=0`, always pure-Go.
- If `GODEBUG=netdns=go`, always pure-Go.
- If `GODEBUG=netdns=cgo`, always cgo.
- Otherwise, Go inspects `/etc/resolv.conf` and `/etc/nsswitch.conf`
  at startup and decides per-call. With a "complex" config — custom
  NSS modules, mDNS, etc. — it tends toward cgo. With a simple
  config it uses Go.

`GODEBUG=netdns=go+1` (or `cgo+1`) prints the choice at runtime.
`netdns=go+2` is the verbose mode for debugging name resolution
problems.

The main practical implications:

1. **Bound your lookups.** A cgo-resolver lookup cannot be canceled.
   Guard with `context.WithTimeout` + your own goroutine, or set
   `Resolver.PreferGo = true` to force the cancelable path.
2. **Static binaries (`CGO_ENABLED=0`) skip nsswitch.conf.** mDNS
   stops working. /etc/hosts still works because Go reads it
   directly.
3. **Match your test environment.** A staging box that uses cgo and
   prod that uses pure-Go can produce different lookup behavior
   for edge cases (search domains, IDN handling).

## 8. The `net.Resolver` contract

```go
type Resolver struct {
    PreferGo     bool
    StrictErrors bool
    Dial         func(ctx context.Context, network, address string) (Conn, error)
}
```

Behavior of each field:

- **`PreferGo`**: when true, always use the pure-Go resolver. When
  false, the runtime picks per-call based on the platform and
  config.
- **`StrictErrors`**: when true, `Lookup*` methods report partial
  failures. By default, getting a successful A record but a failed
  AAAA record returns the A records and no error — `StrictErrors`
  changes that to return both the A records and a non-nil error.
- **`Dial`**: when non-nil, the pure-Go resolver uses this to reach
  DNS servers instead of the system-configured ones. Set it to
  point at a specific resolver. Ignored when cgo is in use.

The methods (`LookupHost`, `LookupAddr`, `LookupCNAME`, `LookupMX`,
`LookupSRV`, `LookupTXT`, `LookupNS`, `LookupNetIP`, `LookupPort`)
all take a `context.Context`. Cancellation works for the pure-Go
path; the cgo path may continue running until the syscall returns.

## 9. The `net.IP` representation

`net.IP` is a `[]byte` of length 4 (IPv4) or 16 (IPv6 or IPv4-in-IPv6).
The package produces 16-byte values from `ParseIP` even for IPv4:

```go
ip := net.ParseIP("192.0.2.1")
fmt.Println(len(ip)) // 16
fmt.Println(ip.To4() != nil) // true; .To4() returns a 4-byte slice
```

This bites equality comparisons. `bytes.Equal(ip1, ip2)` may be
false even when they're the same IP, if one is the 4-byte form and
the other is the 16-byte form. Use `ip1.Equal(ip2)` instead:

```go
ip1 := net.ParseIP("192.0.2.1")        // 16 bytes
ip2 := net.IPv4(192, 0, 2, 1)          // 16 bytes (Go normalizes)
ip3 := net.ParseIP("192.0.2.1").To4()  // 4 bytes
fmt.Println(bytes.Equal(ip1, ip3))     // false
fmt.Println(ip1.Equal(ip3))            // true
```

In Go 1.18 the `net/netip` package introduced `netip.Addr`, an
immutable, comparable value type that fixes these issues. New code
should prefer `netip.Addr`/`netip.AddrPort`/`netip.Prefix` for
in-memory representation, converting to `net.IP` only at the
package boundary.

## 10. Half-close: the FIN dance

A TCP conn has separate read and write half-states. The states are:

- **ESTABLISHED**: both halves open.
- **FIN-WAIT-1 / FIN-WAIT-2 / TIME-WAIT**: local side closing.
- **CLOSE-WAIT**: peer closed their write side; we still have ours.
- **CLOSED**: fully torn down.

`(*net.TCPConn).CloseWrite` sends a FIN. The peer's `Read` returns
EOF; our reads still work because the peer can keep sending. After
we receive *their* FIN (their `Read` returns EOF when we try, or
our `Read` returns EOF when they `CloseWrite`), the conn is fully
closed and we can `Close()`.

`CloseRead` sends nothing on the wire — it just tells the local
kernel to discard incoming data. Useful when a misbehaving client
keeps shoving bytes and we want to drop them without backpressure
into TCP receive windows.

Common bug: forgetting to call `Close()` after `CloseWrite()`.
`CloseWrite` releases neither the file descriptor nor the kernel
memory; the goroutine is still leaking. Always `defer c.Close()`.

## 11. SO_LINGER and the RST escape hatch

```go
tc.SetLinger(0) // RST on Close instead of FIN
```

Three values:

- **`-1`** (default): `Close` returns immediately. The kernel finishes
  the FIN handshake in the background; the conn enters TIME-WAIT for
  about 2 minutes. This is fine for normal traffic.
- **`0`**: `Close` discards any unsent data and sends a RST. The peer
  sees `ECONNRESET` on their next read. Useful for shedding broken
  clients without the local side accumulating TIME-WAIT slots.
- **`n > 0`**: `Close` blocks up to `n` seconds waiting for FIN-ACK.
  If the timer expires, behavior is platform-dependent (usually a
  RST). Almost never the right choice.

When you want SO_LINGER=0: a server with thousands of short-lived
conns, where TIME-WAIT exhaustion threatens to consume ephemeral
ports. When you don't: anywhere correctness of in-flight data
matters.

## 12. Keepalive — what it actually detects

`SetKeepAlive(true)` and `SetKeepAlivePeriod(d)` enable
`SO_KEEPALIVE` and set the interval between probes. What it
detects:

- A peer host that's down (no ACK to a keepalive probe within the
  retry window).
- A network partition that's been up for longer than the keepalive
  timeout.

What it does *not* detect:

- A peer process that crashed but the host is up — the host's
  kernel sends RST when the next probe arrives, which is faster
  than keepalive but reactive.
- A peer that's silently blackholing your traffic (e.g.,
  middlebox). Modern keepalive intervals (5s–30s) catch most of
  these but not within a single request's SLO.

For interactive RPC, application-level heartbeats with a hard
deadline are tighter than TCP keepalive. Use both.

The underlying knobs (`TCP_KEEPIDLE`, `TCP_KEEPINTVL`,
`TCP_KEEPCNT`) aren't exposed by stdlib. Use `Dialer.Control` or
`x/sys/unix` to set them via `setsockopt` on the raw fd.

## 13. UDP semantics in detail

`*UDPConn.ReadFromUDP` returns one datagram per call. Subtleties:

1. **Buffer size matters.** A 1500-byte buffer truncates a 9000-byte
   jumbo datagram silently — `n` is 1500 and the rest is gone. For
   internet-facing UDP, 1500 bytes is enough (path MTU). For
   localhost or LAN, 65535 is the safe ceiling.

2. **Source address may be IPv4-mapped IPv6.** On a dual-stack
   socket, an IPv4 packet appears as `::ffff:1.2.3.4`. Test with
   `addr.IP.To4() != nil` if you need to branch on family.

3. **`WriteToUDP` rejects an oversized datagram with `EMSGSIZE`** —
   it does not fragment at the application layer. The kernel
   fragments at IP layer up to 65507 bytes (UDP/IPv4 max payload);
   beyond that you get the error.

4. **No connection state means no backpressure.** UDP `Write` always
   succeeds locally as long as there's a route; the peer may drop
   the packet. Application-level acks are mandatory if you need
   reliability.

A UDP socket "connected" via `net.DialUDP` filters incoming packets
to the connected peer (source address must match) and supports
`Read`/`Write` directly — but it's still UDP, still no reliability.

## 14. `IPConn` and raw sockets

`net.IPConn` lets you send and receive raw IP packets. Use cases:
ICMP ping, custom protocol numbers, traceroute. On Linux it
requires `CAP_NET_RAW` (or root). On macOS, the BSD heritage means
some ICMP types work without raw socket privileges via
`net.ListenPacket("udp4", ...)`.

```go
c, err := net.ListenPacket("ip4:icmp", "0.0.0.0")
```

Most production code does *not* use `IPConn`. For ICMP-style
features, prefer `golang.org/x/net/icmp`, which handles the
quirks. For custom transport protocols, `IPConn` is a starting
point but you'll want raw sockets via `unix.Socket(AF_PACKET, ...)`
on Linux for full control.

## 15. `net.Pipe` semantics

```go
c1, c2 := net.Pipe()
```

Two `Conn` values backed by an in-memory channel. Properties:

- **Synchronous.** A `Write` on `c1` blocks until a matching `Read`
  on `c2` consumes it. No buffering.
- **Deadlines work.** Both sides honor `SetDeadline`.
- **No socket.** No file descriptor, no kernel involvement, no TCP
  options. Type assertion to `*net.TCPConn` fails.
- **Goroutine-safe in the documented way.** One reader and one
  writer per side.

Excellent for tests. Don't use for "high-performance in-memory
transport" — channels are faster, and the synchronous semantics
make `net.Pipe` slow under contention.

## 16. The `Dialer.Control` hook

```go
d := net.Dialer{
    Control: func(network, address string, c syscall.RawConn) error {
        return c.Control(func(fd uintptr) {
            unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)
        })
    },
}
```

`Control` is called after the socket is created but before `connect`
or `bind`. It's where you set socket options that must be set
pre-connect: `SO_REUSEADDR`, `SO_REUSEPORT`, `IP_BIND_ADDRESS_NO_PORT`,
`SO_MARK`. The `syscall.RawConn.Control` callback gives you the
raw `fd` to pass to `setsockopt`.

`net.ListenConfig` has the same `Control` hook for listeners. This is
the canonical way to enable `SO_REUSEPORT` for multi-process server
patterns (covered in [optimize.md](optimize.md)).

## 17. File-descriptor handover and `dup`

```go
tl := ln.(*net.TCPListener)
f, err := tl.File()
```

`File()` returns an `*os.File` representing a *duplicate* of the
underlying fd. Important:

- The returned fd is in *blocking* mode. It's been removed from
  Go's runtime poller. You can't use the listener via the original
  Go API and the file simultaneously without confusion.
- Closing the `*os.File` does not close the listener and vice versa.
- You typically use `File()` to get an fd to pass to `exec` for
  zero-downtime restart, then close the listener (the child has
  the dup'd fd).

To go the other way: `net.FileListener(f)` and `net.FileConn(f)` turn
an `*os.File` (whose fd is a socket) back into a Go listener/conn.

## 18. Common senior-level pitfalls

| Pitfall | What goes wrong |
|---------|-----------------|
| Comparing `net.IP` with `bytes.Equal` | 4-byte vs 16-byte form mismatch |
| Calling `Close` on a conn while another goroutine is in `Read`/`Write` | Legal, but the in-flight op gets `net.ErrClosed`; handle it as clean shutdown, not error |
| Forgetting to clear deadlines after a deadline-fired error | All subsequent ops fail with timeout |
| Using `Temporary()` for retry decisions | Deprecated; the heuristic was always wrong |
| Trusting peer-supplied length prefix without a cap | Trivial OOM DoS |
| Holding the buffer from `ReadFromUDP` instead of copying | The buffer is reused on the next read |
| Calling `CloseWrite` and not `Close` | Leaks the file descriptor |
| Setting `SO_LINGER 0` everywhere "for performance" | Loses unsent data; surfaces as random data corruption |
| Ignoring `*os.ErrDeadlineExceeded` after Go 1.15 | Pre-1.15 idioms still work but obscure intent |

## 19. Cross-references

- [`../01-io-and-file-handling/senior.md`](../01-io-and-file-handling/senior.md) — `Read`/`Write` contracts that `Conn` inherits.
- [`../03-time/`](../03-time/junior.md) — timer semantics behind deadlines.
- [`../05-os/`](../05-os/junior.md) — process signals and `os.ErrDeadlineExceeded`.
- [`../11-net-http-internals/`](../11-net-http-internals/junior.md) — uses every senior-level rule above.
- [`../13-crypto/`](../13-crypto/junior.md) — `tls.Conn` wraps a `net.Conn` and inherits its deadline semantics.
