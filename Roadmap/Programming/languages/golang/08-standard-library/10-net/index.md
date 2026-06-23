# 8.10 — `net` (TCP, UDP, Unix sockets)

The `net` package is the transport layer of Go. Every byte that crosses a
process boundary — RPC calls, database drivers, message queues, custom
binary protocols — eventually flows through `net.Conn` or
`net.PacketConn`. This leaf covers the package end-to-end *except* for
`net/http`, which gets its own leaf.

The package is organized around two interfaces: `Conn` for stream
connections (TCP, Unix stream, TLS) and `PacketConn` for datagram
sockets (UDP, Unix datagram). On top of those sit `Listener` for
accepting incoming streams, the address types (`TCPAddr`, `UDPAddr`,
`UnixAddr`, `IPAddr`), and the resolver that turns names into
addresses. Everything else — keepalive, deadlines, half-close,
file-descriptor handover — is a method on those interfaces.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need to dial, listen, and exchange bytes |
| [middle.md](middle.md) | You're building real TCP/UDP servers with deadlines and graceful shutdown |
| [senior.md](senior.md) | You need the exact contract for `Conn`, the resolver split, and net errors |
| [professional.md](professional.md) | You're shipping production network code under load |
| [specification.md](specification.md) | You want the formal interface guarantees |
| [interview.md](interview.md) | You're preparing for systems-Go interviews |
| [tasks.md](tasks.md) | You want exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for socket bugs |
| [optimize.md](optimize.md) | You're cutting syscalls and tuning throughput |

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/) — `Conn` is an `io.ReadWriteCloser`.
- [`08-standard-library/03-time`](../03-time/) — deadlines are absolute `time.Time` values.
- [`08-standard-library/05-os`](../05-os/) — signals for graceful shutdown.
- [`08-standard-library/11-net-http-internals`](../11-net-http-internals/) — what `net/http` builds on top of `net`.
- [`08-standard-library/13-crypto`](../13-crypto/) — wrapping `net.Conn` in `tls.Conn`.
