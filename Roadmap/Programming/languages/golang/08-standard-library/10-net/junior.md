# 8.10 `net` — Junior

> **Audience.** You can write Go and you've used `net/http`, but the
> raw socket layer is still mostly opaque. By the end of this file you
> will know how to dial a TCP server, accept connections, exchange
> bytes over UDP, talk to a Unix socket, parse and resolve addresses,
> and set deadlines so your code does not hang forever.

## 1. The two interfaces that matter

The `net` package is built around two interfaces. Almost everything
else in the package is a method, helper, or address type that hangs off
them.

```go
type Conn interface {
    Read(b []byte) (n int, err error)
    Write(b []byte) (n int, err error)
    Close() error

    LocalAddr() Addr
    RemoteAddr() Addr

    SetDeadline(t time.Time) error
    SetReadDeadline(t time.Time) error
    SetWriteDeadline(t time.Time) error
}

type Listener interface {
    Accept() (Conn, error)
    Close() error
    Addr() Addr
}
```

`Conn` is `io.ReadWriteCloser` plus addresses and deadlines. Everything
that gives you a stream connection — TCP, TLS, Unix stream, in-memory
`net.Pipe` — implements `Conn`. Anything written against `io.Reader`
or `io.Writer` (compression, hashing, JSON encoders, `bufio.Scanner`)
works on a `Conn` without modification.

`Listener` is what you get back from `net.Listen`. You call `Accept`
in a loop and serve each `Conn` it returns. That is the whole TCP
server pattern.

For datagram sockets (UDP, Unix datagram) there's a parallel
interface, `PacketConn`, which has `ReadFrom`/`WriteTo` instead of
`Read`/`Write` because each datagram has its own remote address.

## 2. Dialing a TCP server in five lines

```go
conn, err := net.Dial("tcp", "example.com:80")
if err != nil {
    return err
}
defer conn.Close()

fmt.Fprintf(conn, "GET / HTTP/1.0\r\nHost: example.com\r\n\r\n")
_, err = io.Copy(os.Stdout, conn)
```

`net.Dial(network, address)` is the universal dialer. The `network`
argument tells it what kind of socket to open: `"tcp"`, `"tcp4"`,
`"tcp6"`, `"udp"`, `"udp4"`, `"udp6"`, `"unix"` (stream), or
`"unixgram"` (datagram). The `address` for IP networks is
`host:port`; for Unix sockets it is a filesystem path.

The returned `net.Conn` is a stream you write requests to and read
responses from. There is no framing — TCP is a byte stream, and one
`Read` may return any prefix of what was sent. Application protocols
add their own framing on top (length prefixes, delimiters, fixed
records).

## 3. Listening for TCP connections

The mirror image of dialing is listening:

```go
ln, err := net.Listen("tcp", ":8080")
if err != nil {
    return err
}
defer ln.Close()

for {
    conn, err := ln.Accept()
    if err != nil {
        return err
    }
    go handle(conn)
}

func handle(c net.Conn) {
    defer c.Close()
    io.Copy(c, c) // echo
}
```

Three rules to internalize on day one:

1. **Always close accepted conns.** A conn that escapes the handler
   without `Close()` leaks a file descriptor. `defer c.Close()` is
   the cheap fix; do it on the first line of the handler.
2. **One goroutine per conn.** The Accept loop must not block on a
   slow client. Hand the conn off to a goroutine and immediately
   return to `Accept`.
3. **The Accept loop only ever exits on listener Close.** If you
   call `ln.Close()`, the next `Accept` returns
   `net.ErrClosed`. That is your shutdown signal.

The address `":8080"` means "listen on port 8080 on every interface."
Pass `"127.0.0.1:8080"` to bind only to loopback, or `":0"` to ask
the kernel to pick a free port — useful in tests where you query
`ln.Addr().(*net.TCPAddr).Port` afterward.

## 4. The simplest working server

```go
package main

import (
    "bufio"
    "fmt"
    "log"
    "net"
    "strings"
)

func main() {
    ln, err := net.Listen("tcp", ":8080")
    if err != nil {
        log.Fatal(err)
    }
    log.Printf("listening on %s", ln.Addr())
    for {
        c, err := ln.Accept()
        if err != nil {
            log.Fatal(err)
        }
        go serve(c)
    }
}

func serve(c net.Conn) {
    defer c.Close()
    s := bufio.NewScanner(c)
    for s.Scan() {
        line := strings.TrimSpace(s.Text())
        fmt.Fprintf(c, "you said: %s\n", line)
    }
}
```

That's a full echo server: 25 lines, one Accept loop, one goroutine
per client, line-delimited protocol. Run it, point `nc localhost 8080`
at it, and it works. We will spend the rest of this leaf making it
not catch fire under load.

## 5. UDP — datagrams instead of streams

UDP is connectionless. There is no `Listen` and no `Accept`; you open
a single socket and read datagrams from anyone who sends one.

```go
addr, err := net.ResolveUDPAddr("udp", ":9000")
if err != nil { return err }

pc, err := net.ListenUDP("udp", addr)
if err != nil { return err }
defer pc.Close()

buf := make([]byte, 1500)
for {
    n, src, err := pc.ReadFromUDP(buf)
    if err != nil { return err }
    log.Printf("got %d bytes from %s: %q", n, src, buf[:n])

    if _, err := pc.WriteToUDP([]byte("ack\n"), src); err != nil {
        return err
    }
}
```

Things to know:

- **One read = one datagram.** `ReadFromUDP` returns exactly one
  packet. If you give it a 1500-byte buffer and the datagram is 800
  bytes, you get `n = 800` and the rest of the buffer is irrelevant.
  If the datagram is larger than the buffer, the excess is discarded
  silently (you do not get the rest on the next read).
- **No connection state.** Every call needs the remote address. UDP
  does not maintain a "who sent the last packet" notion.
- **Datagrams can be lost, reordered, duplicated.** UDP gives you
  one shot per packet. If you need reliability, build it on top, or
  use TCP.

For the client side, `net.DialUDP` returns a `*UDPConn` "connected"
to a fixed remote — you can then use `Read`/`Write` instead of
`ReadFromUDP`/`WriteToUDP`, and the kernel filters out packets from
other senders.

## 6. Unix sockets

Unix sockets look like TCP/UDP but live on the local filesystem.
Two flavors:

- `"unix"` — stream, behaves like TCP locally.
- `"unixgram"` — datagrams, behaves like UDP locally.

```go
// Server.
ln, err := net.Listen("unix", "/tmp/app.sock")
if err != nil { return err }
defer os.Remove("/tmp/app.sock")
defer ln.Close()

// Client.
c, err := net.Dial("unix", "/tmp/app.sock")
```

Two everyday gotchas:

1. **You must remove the socket file on shutdown.** Unlike a TCP
   port, the file persists after your process exits. Subsequent
   `Listen` calls fail with "address already in use." `defer
   os.Remove(path)` covers the clean exit path; on Linux you can
   also use the abstract namespace (path starting with `\x00`).
2. **Path length is capped** at around 108 bytes (104 on macOS).
   Long paths under `/tmp` with random suffixes can blow through
   it. Keep names short.

Unix sockets are faster than localhost TCP (no IP stack, no
checksum, no TIME_WAIT) and are the right choice for inter-process
communication on a single host.

## 7. Addresses: `IP`, `TCPAddr`, `UDPAddr`, `UnixAddr`

The address types are concrete structs implementing `net.Addr`:

```go
type Addr interface {
    Network() string // "tcp", "udp", "unix"
    String() string  // "1.2.3.4:80", "/tmp/app.sock"
}
```

The most useful concrete addresses:

| Type | What it holds |
|------|---------------|
| `net.IP` | A `[]byte` (4 or 16 bytes) with helpers like `To4()`, `IsLoopback()` |
| `net.IPMask` | A `[]byte` mask, used with `IPNet` for CIDR |
| `net.IPNet` | An `IP` plus a `Mask` — what you get from `net.ParseCIDR` |
| `net.TCPAddr` | `IP`, `Port`, `Zone` (for IPv6 link-local) |
| `net.UDPAddr` | Same shape as `TCPAddr` |
| `net.UnixAddr` | `Name` (path) and `Net` ("unix" or "unixgram") |

Parse an address from text:

```go
ip := net.ParseIP("192.0.2.1")              // returns nil if invalid
_, cidr, err := net.ParseCIDR("10.0.0.0/8") // returns *IPNet

tcpAddr, err := net.ResolveTCPAddr("tcp", "example.com:443")
udpAddr, err := net.ResolveUDPAddr("udp", "239.0.0.1:5000")
```

`net.ParseIP` accepts dotted-quad IPv4 and full or shortened IPv6.
The returned `net.IP` is always 16 bytes; call `.To4()` to get the
4-byte form when you need it.

`net.ResolveTCPAddr` does a DNS lookup if the host is a name, then
returns a `*TCPAddr`. If you pass it to `net.DialTCP`, the kernel
already knows the address — no second lookup.

## 8. Name resolution: `LookupHost`, `LookupAddr`, friends

The `net` package wraps DNS lookups in a small set of functions:

```go
ips, err := net.LookupHost("example.com")            // []string of IPs
names, err := net.LookupAddr("8.8.8.8")              // []string of names (PTR)
cname, err := net.LookupCNAME("www.example.com.")    // canonical name
mxs, err := net.LookupMX("example.com")              // []*MX (preference, host)
txts, err := net.LookupTXT("example.com")            // []string
srvs, err := net.LookupSRV("xmpp-server", "tcp", "example.com")
```

Every one of these takes the host system's DNS configuration. Behind
the scenes, Go has two resolvers:

- **The Go resolver.** Pure-Go implementation that reads
  `/etc/resolv.conf` directly and sends UDP/TCP DNS packets. Default
  on most platforms in most modes.
- **The cgo resolver.** Calls the platform's `getaddrinfo`. Required
  for some corporate setups that use `nsswitch.conf`, mDNS, or
  custom NSS modules.

You rarely have to think about which one is in use, but when DNS
behaves oddly the choice matters. We come back to it in
[middle.md](middle.md).

For a one-shot lookup with a context, use `net.DefaultResolver`:

```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
ips, err := net.DefaultResolver.LookupHost(ctx, "example.com")
```

The functions without `Resolver` (`net.LookupHost`, etc.) are
shortcuts for `net.DefaultResolver.LookupHost(context.Background(), …)`.
Use them for scripts; in services prefer the resolver method so you
can pass a context and bound the lookup.

## 9. Deadlines and timeouts — your only defense against hung sockets

A `net.Conn` with no deadline can block on `Read` forever if the peer
goes silent. The fix is `SetDeadline`:

```go
c.SetReadDeadline(time.Now().Add(5 * time.Second))
n, err := c.Read(buf)
if ne, ok := err.(net.Error); ok && ne.Timeout() {
    // peer was idle, do something
}
```

Three things to internalize:

1. **Deadlines are absolute, not durations.** `SetReadDeadline(t)`
   says "fail if the read isn't done by `t`." You set it once per
   operation; it does not auto-reset.
2. **There's no read timeout setting.** You implement it by
   updating the deadline before each read.
3. **`time.Time{}` clears the deadline.** Pass the zero time to
   undo a previous `SetDeadline`.

For the dial side, `net.DialTimeout` caps how long the TCP handshake
takes:

```go
c, err := net.DialTimeout("tcp", "example.com:80", 3*time.Second)
```

Or, with full control, use a `net.Dialer`:

```go
d := net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}
c, err := d.DialContext(ctx, "tcp", "example.com:80")
```

`DialContext` cancels the dial when the context is done — the right
pattern for any server-side outbound call.

## 10. Reading and writing protocol data

`net.Conn` is just bytes. To exchange records you need a framing
strategy. The three patterns you'll see most:

### Line-delimited (text protocols)

```go
s := bufio.NewScanner(c)
for s.Scan() {
    line := s.Text()
    handle(line)
}
```

Works for SMTP, IRC, Redis text, custom debug protocols. The
default `Scanner` token cap is 64 KiB; raise it with `s.Buffer` if
your protocol allows longer lines.

### Length-prefixed (binary)

```go
var hdr [4]byte
if _, err := io.ReadFull(c, hdr[:]); err != nil { return err }
n := binary.BigEndian.Uint32(hdr[:])
body := make([]byte, n)
if _, err := io.ReadFull(c, body); err != nil { return err }
```

`io.ReadFull` is mandatory here. A single `Read` may return fewer
bytes than the buffer, and you'd splice random data into the next
record.

### Length-prefixed with size cap

```go
const maxFrame = 1 << 20 // 1 MiB
if n > maxFrame {
    return fmt.Errorf("frame too large: %d", n)
}
```

Always cap. A peer that claims a 4 GiB frame can OOM you instantly.

## 11. Half-close and `CloseWrite`

A TCP connection has two independent halves. After you finish
sending, you can close *only* the write side, leaving the read side
open so the peer can finish replying:

```go
tc := c.(*net.TCPConn)
tc.CloseWrite() // sends FIN to peer; reads still work
io.Copy(out, tc)
```

This is the pattern HTTP/1.0 uses, and it's also how `nc -N` works.
Without `CloseWrite`, you have to use a length prefix or the peer
has no way to know your request is finished except by closing the
whole conn — which loses the response.

`CloseRead` is the symmetric operation; it discards anything the peer
sends after this point. Less commonly useful.

## 12. Random ports and address inspection

To listen on a free port chosen by the kernel:

```go
ln, err := net.Listen("tcp", "127.0.0.1:0")
if err != nil { return err }
addr := ln.Addr().(*net.TCPAddr)
fmt.Println("listening on", addr.Port)
```

Useful in tests so two test runs don't fight over a fixed port. The
type assertion is safe because `tcp` listeners always return
`*TCPAddr`.

To learn whose IP is on the other end of an accepted conn:

```go
remote := conn.RemoteAddr().(*net.TCPAddr)
fmt.Println("client IP:", remote.IP, "port:", remote.Port)
```

Behind a load balancer the remote IP is the LB's, not the original
client's; use proxy protocol or `X-Forwarded-For` for the real
source.

## 13. `net.Pipe` — an in-memory full-duplex `Conn`

```go
c1, c2 := net.Pipe()

go func() {
    fmt.Fprintln(c1, "hello")
    c1.Close()
}()

io.Copy(os.Stdout, c2)
```

`net.Pipe` returns two `Conn` values that talk to each other in RAM.
There is no socket, no kernel involvement, no buffering — every
write blocks until a read consumes it. It's invaluable for testing
code that takes a `net.Conn` without wiring up real sockets.

Two caveats: `net.Pipe` ignores deadlines on most Go versions before
1.10 (fine on modern Go), and it cannot set TCP options like
`NoDelay` because there is no TCP underneath.

## 14. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| `dial tcp: lookup … no such host` | DNS resolution failed |
| `dial tcp …: connect: connection refused` | Nothing is listening on that port |
| `read tcp …: i/o timeout` | A `SetReadDeadline` fired before the peer responded |
| `use of closed network connection` | You closed the conn or listener while another goroutine was using it |
| `address already in use` | Listener restart while the old socket is in TIME_WAIT, or stale Unix socket file |
| `EOF` from a fresh-looking conn | Peer closed before sending anything |
| Truncated UDP datagram | Read buffer smaller than the datagram |

The `use of closed network connection` string is so common that Go
1.16 added `net.ErrClosed` so you can match it without parsing
strings:

```go
if errors.Is(err, net.ErrClosed) {
    // listener or conn was closed; clean shutdown path
}
```

## 15. A working TCP echo client and server

```go
// Server.
package main

import (
    "io"
    "log"
    "net"
)

func main() {
    ln, err := net.Listen("tcp", "127.0.0.1:9000")
    if err != nil { log.Fatal(err) }
    defer ln.Close()

    for {
        c, err := ln.Accept()
        if err != nil { log.Fatal(err) }
        go func(c net.Conn) {
            defer c.Close()
            io.Copy(c, c)
        }(c)
    }
}

// Client.
package main

import (
    "io"
    "log"
    "net"
    "os"
)

func main() {
    c, err := net.Dial("tcp", "127.0.0.1:9000")
    if err != nil { log.Fatal(err) }
    defer c.Close()

    go io.Copy(c, os.Stdin)
    io.Copy(os.Stdout, c)
}
```

Forty-ish lines, two binaries, a working interactive echo. Type a
line in the client, the server bounces it back. Everything else in
this leaf — deadlines, half-close, keepalive, graceful shutdown — is
making this skeleton survive contact with real users.

## 16. What to read next

- [middle.md](middle.md) — server patterns, deadlines per request,
  graceful shutdown, the resolver.
- [senior.md](senior.md) — the precise contract of `Conn`, error
  classification, the cgo/Go resolver split.
- [tasks.md](tasks.md) — exercises that turn this material into
  reflexes.
- The official package docs: [`net`](https://pkg.go.dev/net).
