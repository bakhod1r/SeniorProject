# 8.11 — `net/http` Internals

`net/http` is a server, a client, a connection pool, an HTTP/1.1
parser, an HTTP/2 implementation, a TLS wrapper, a multiplexer, a
reverse proxy, and a body-reading discipline in one package. This leaf
covers what runs per request, where buffers live, when goroutines end,
and which knobs matter under load.

It builds on `net.Conn` from [`../10-net/`](../10-net/) and on the
`io.Reader`/`Writer` contracts from
[`../01-io-and-file-handling/`](../01-io-and-file-handling/).

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You can write a handler but `Server`, `Client`, and `ServeMux` still feel like magic |
| [middle.md](middle.md) | You're building real services with timeouts, middleware, and graceful shutdown |
| [senior.md](senior.md) | You need the precise per-conn lifecycle, ResponseWriter contract, and Transport pool |
| [professional.md](professional.md) | You're shipping HTTP under load with reverse proxies, hot reloads, and tracing |
| [specification.md](specification.md) | You want the formal contracts distilled |
| [interview.md](interview.md) | You're preparing for backend Go interviews |
| [tasks.md](tasks.md) | You want exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for HTTP bugs |
| [optimize.md](optimize.md) | You're cutting allocations and tuning throughput |

## Cross-references

- [`../10-net/`](../10-net/) — sockets, deadlines, `net.Listener`.
- [`../03-time/`](../03-time/) — timer semantics behind every HTTP timeout.
- [`../04-encoding-json/`](../04-encoding-json/) — request/response bodies.
- [`../13-crypto/`](../13-crypto/) — TLS server, certificate reload.
- [`../05-os/`](../05-os/) — signals for graceful shutdown.
- [`../01-io-and-file-handling/`](../01-io-and-file-handling/) — body draining and `Close` discipline.
