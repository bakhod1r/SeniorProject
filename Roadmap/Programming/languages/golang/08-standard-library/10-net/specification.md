# 8.10 `net` — Specification

> The exact contracts, for reference. Whenever a section in the other
> files says "the `net.Conn` contract requires…" or "deadlines are
> absolute," this file is the source of truth.

## 1. `net.Conn` interface

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
```

Required behaviors:

1. `Read` and `Write` follow the `io.Reader` / `io.Writer` contracts
   (see [`../01-io-and-file-handling/specification.md`](../01-io-and-file-handling/specification.md)).
2. `Close` releases the resource. After `Close`, all subsequent
   `Read`/`Write`/`Close` calls return an error.
3. `LocalAddr`/`RemoteAddr` are callable any time, including after
   `Close`. They never return nil.
4. **Multiple goroutines may invoke methods on a `Conn`
   simultaneously.** This is the only stdlib I/O interface that
   makes this guarantee.
5. The deadline methods return nil if the underlying transport
   supports them; they may return a non-nil error if not (e.g.,
   some custom `Conn` implementations).

## 2. `net.Listener` interface

```go
type Listener interface {
    Accept() (Conn, error)
    Close() error
    Addr() Addr
}
```

Required behaviors:

1. `Accept` blocks until a new connection arrives or the listener
   is closed.
2. After `Close`, `Accept` returns an error wrapping `net.ErrClosed`
   for every subsequent call.
3. `Close` does not affect connections previously returned by
   `Accept`.
4. `Addr` is callable any time including after `Close`.
5. Multiple goroutines may call `Accept` concurrently.

## 3. `net.PacketConn` interface

```go
type PacketConn interface {
    ReadFrom(p []byte) (n int, addr Addr, err error)
    WriteTo(p []byte, addr Addr) (n int, err error)
    Close() error
    LocalAddr() Addr
    SetDeadline(t time.Time) error
    SetReadDeadline(t time.Time) error
    SetWriteDeadline(t time.Time) error
}
```

Required behaviors:

1. `ReadFrom` returns at most one datagram per call. If `len(p)` is
   smaller than the datagram, the excess is discarded silently.
2. `WriteTo` sends one datagram. The datagram is delivered atomically
   or not at all (no partial writes).
3. Concurrent `ReadFrom` calls on the same `PacketConn` are legal;
   each gets a different datagram (kernel-arbitrated).
4. Deadlines apply to each operation independently as for `Conn`.

## 4. `net.Addr` interface

```go
type Addr interface {
    Network() string
    String() string
}
```

`Network()` returns the network name (`"tcp"`, `"udp"`, `"unix"`,
`"ip"`, etc.). `String()` returns the address in network-specific
form. Both methods are pure functions of the value's state.

## 5. Deadline contract

For any `Conn` or `PacketConn`:

1. `SetDeadline(t)` sets the deadline for both reads and writes to
   the absolute time `t`.
2. `SetReadDeadline(t)` sets the deadline for reads only.
3. `SetWriteDeadline(t)` sets the deadline for writes only.
4. The zero `time.Time` value clears the deadline (no expiry).
5. A deadline in the past makes the next operation return an error
   immediately. The error satisfies `os.ErrDeadlineExceeded` and
   `net.Error.Timeout() == true`.
6. A deadline persists across operations until changed.
7. Setting a deadline is goroutine-safe with operations in flight;
   the change applies to the in-flight operation.
8. After a deadline-induced error, the `Conn` remains usable. The
   caller must reset the deadline before retrying (otherwise the
   next operation also fails immediately).

## 6. `net.Error` interface

```go
type Error interface {
    error
    Timeout() bool
    Temporary() bool // deprecated for Conn errors as of Go 1.18
}
```

`Timeout()` returns true if and only if the error was caused by a
deadline. `Temporary()` is deprecated for errors from `Conn` methods.

## 7. Sentinel errors

| Sentinel | Returned by |
|----------|-------------|
| `net.ErrClosed` | Any operation on a closed `Conn`, `PacketConn`, or `Listener` |
| `net.ErrWriteToConnected` | `WriteTo` on a connected `*UDPConn` |
| `os.ErrDeadlineExceeded` | Read/write that fired a deadline |
| `io.EOF` | Read on a `Conn` whose peer closed |

`errors.Is` is the supported way to check for these.

## 8. `*net.OpError`

```go
type OpError struct {
    Op     string  // "dial", "read", "write", "accept", "close", ...
    Net    string  // "tcp", "udp", "unix", ...
    Source Addr    // local address (may be nil for dial errors)
    Addr   Addr    // remote/listener address (may be nil)
    Err    error   // underlying error
}
```

`Unwrap()` returns `Err`. `Timeout()` and `Temporary()` delegate to
`Err` when it satisfies `net.Error`.

`errors.Is(opErr, syscall.ECONNRESET)` walks through the wrapping.

## 9. `*net.DNSError`

```go
type DNSError struct {
    Err         string
    Name        string
    Server      string
    IsTimeout   bool
    IsTemporary bool
    IsNotFound  bool // since Go 1.13
}
```

Returned by `Resolver.Lookup*` methods. `IsNotFound` distinguishes
NXDOMAIN from transient failures.

## 10. `net.Dial` and `net.Listen` networks

| `network` | Meaning | Address syntax |
|-----------|---------|----------------|
| `"tcp"` | TCP, IPv4 or IPv6 | `host:port` |
| `"tcp4"` | TCP, IPv4 only | `host:port` |
| `"tcp6"` | TCP, IPv6 only | `[host]:port` |
| `"udp"`, `"udp4"`, `"udp6"` | UDP | same |
| `"unix"` | Unix domain stream | path |
| `"unixgram"` | Unix domain datagram | path |
| `"unixpacket"` | Unix sequenced-packet | path (Linux) |
| `"ip"`, `"ip4"`, `"ip6"` | Raw IP | host |

For `Listen` the host part may be empty (`":port"`) to bind on all
interfaces.

## 11. Address types — fields

```go
type IP []byte // 4 or 16 bytes

type IPMask []byte // 4 or 16 bytes

type IPNet struct {
    IP   IP
    Mask IPMask
}

type TCPAddr struct {
    IP   IP
    Port int
    Zone string // IPv6 scope (e.g., "eth0")
}

type UDPAddr struct { /* same shape as TCPAddr */ }

type UnixAddr struct {
    Name string
    Net  string // "unix", "unixgram", "unixpacket"
}

type IPAddr struct {
    IP   IP
    Zone string
}
```

`IP.Equal` is the correct comparison; `bytes.Equal` is wrong because
of the 4-byte vs 16-byte ambiguity.

## 12. `net.Dialer` fields

```go
type Dialer struct {
    Timeout       time.Duration
    Deadline      time.Time
    LocalAddr     Addr
    DualStack     bool // deprecated; on by default
    FallbackDelay time.Duration
    KeepAlive     time.Duration
    Resolver      *Resolver
    Cancel        <-chan struct{} // deprecated; use DialContext
    Control       func(network, address string, c syscall.RawConn) error
    ControlContext func(ctx context.Context, network, address string, c syscall.RawConn) error // since Go 1.20
}
```

`Timeout` and `Deadline` interact: the effective deadline is the
earlier of `time.Now() + Timeout` and `Deadline`.

## 13. `net.ListenConfig` fields

```go
type ListenConfig struct {
    Control        func(network, address string, c syscall.RawConn) error
    KeepAlive      time.Duration // since Go 1.13
    KeepAliveConfig KeepAliveConfig // since Go 1.23
}
```

`Control` runs after `socket()` and before `bind()`. Use it for
`SO_REUSEPORT`, `SO_REUSEADDR`, `IP_FREEBIND`, etc.

## 14. `net.Resolver` fields

```go
type Resolver struct {
    PreferGo     bool
    StrictErrors bool
    Dial         func(ctx context.Context, network, address string) (Conn, error)
}
```

Methods:

| Method | Returns |
|--------|---------|
| `LookupHost(ctx, host)` | `[]string` of addresses |
| `LookupIPAddr(ctx, host)` | `[]IPAddr` |
| `LookupNetIP(ctx, network, host)` | `[]netip.Addr` (since Go 1.18) |
| `LookupPort(ctx, network, service)` | `int` |
| `LookupCNAME(ctx, host)` | `string` |
| `LookupSRV(ctx, service, proto, name)` | `cname string, addrs []*SRV, err error` |
| `LookupMX(ctx, name)` | `[]*MX` |
| `LookupNS(ctx, name)` | `[]*NS` |
| `LookupTXT(ctx, name)` | `[]string` |
| `LookupAddr(ctx, addr)` | `[]string` (PTR) |

## 15. TCP-specific methods on `*TCPConn`

| Method | Effect |
|--------|--------|
| `SetKeepAlive(bool)` | Enable/disable `SO_KEEPALIVE` |
| `SetKeepAlivePeriod(d)` | Probe interval |
| `SetNoDelay(bool)` | Disable Nagle (default true) |
| `SetReadBuffer(n)` | `SO_RCVBUF` |
| `SetWriteBuffer(n)` | `SO_SNDBUF` |
| `SetLinger(n)` | `SO_LINGER`: -1=default, 0=RST, n>0=block on Close |
| `CloseRead()` | Half-close, discard incoming |
| `CloseWrite()` | Half-close, send FIN |
| `File()` | Return a `*os.File` for the dup'd fd |
| `SyscallConn()` | Return a `syscall.RawConn` |

## 16. UDP-specific methods on `*UDPConn`

| Method | Effect |
|--------|--------|
| `ReadFromUDP(p)` | Like `ReadFrom` but returns `*UDPAddr` |
| `WriteToUDP(p, addr)` | Like `WriteTo` with `*UDPAddr` |
| `ReadMsgUDP(p, oob)` | With out-of-band data (control message) |
| `WriteMsgUDP(p, oob, addr)` | With out-of-band data |
| `SetReadBuffer(n)` / `SetWriteBuffer(n)` | Kernel buffer size |
| `File()` / `SyscallConn()` | Same as TCP |

## 17. Unix-specific methods on `*UnixConn`

| Method | Effect |
|--------|--------|
| `ReadFromUnix(p)` | With sender's `*UnixAddr` |
| `WriteToUnix(p, addr)` | Datagram send |
| `ReadMsgUnix(p, oob)` / `WriteMsgUnix(p, oob, addr)` | With ancillary data (file descriptors via `SCM_RIGHTS`) |
| `CloseRead()` / `CloseWrite()` | Half-close (stream sockets) |
| `File()` / `SyscallConn()` | Same |

## 18. `net.Buffers` semantics

```go
type Buffers [][]byte

func (v *Buffers) WriteTo(w io.Writer) (n int64, err error)
```

`WriteTo` writes all buffers in order. On platforms supporting
vectored I/O and a `Conn` implementing the `*net.TCPConn` /
`*net.UnixConn` writer paths, this becomes a single `writev`
syscall. After `WriteTo` returns, `*v` is reslicd to contain only
unwritten remainders (so a short write leaves `v` ready for retry).

## 19. `net.Pipe` semantics

`net.Pipe()` returns two `Conn` values. Each `Write` on one blocks
until a corresponding `Read` on the other consumes the bytes.
There is no buffer. Both sides honor `SetDeadline`. The conns are
not real OS sockets and cannot be type-asserted to `*TCPConn`,
`*UnixConn`, etc. Calls to `LocalAddr`/`RemoteAddr` return
`pipeAddr{}` whose `Network()` is `"pipe"`.

## 20. Versioning notes

| Feature | Go version |
|---------|------------|
| `net.ErrClosed` | 1.16 |
| `os.ErrDeadlineExceeded` | 1.15 |
| `DNSError.IsNotFound` | 1.13 |
| `net.ListenConfig` | 1.11 |
| `net.Dialer.Control` | 1.11 |
| `net.Dialer.ControlContext` | 1.20 |
| `Resolver.LookupNetIP` | 1.18 |
| `netip` package | 1.18 |
| `KeepAliveConfig` (per-listener) | 1.23 |
| `Temporary()` deprecated for Conn | 1.18 |

When in doubt, the package documentation at
[pkg.go.dev/net](https://pkg.go.dev/net) is normative; this file
is a quick-reference summary.
