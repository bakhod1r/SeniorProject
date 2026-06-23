---
layout: default
title: net/http Server Concurrency
parent: Concurrency in Stdlib
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: true
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/
---

# net/http Server Concurrency

The Go HTTP server in `net/http` is the canonical example of the runtime's goroutine-per-connection design. A single `(*Server).Serve` loop accepts TCP connections; each accepted connection is handed to a fresh goroutine (`go c.serve(ctx)`), which owns the connection's read buffer, write buffer, header parser, request body reader, and response writer until the connection closes or is hijacked. On top of this base, HTTP/1.1 keep-alive reuses one goroutine across many requests, HTTP/2 multiplexes streams over one TCP connection with one goroutine per stream, and `Server.Shutdown` orchestrates a graceful drain via per-connection state tracked in an `activeConn` map under a mutex.

This subsection unpacks the server's concurrency model end to end — from the accept loop to the response writer, from per-connection state to per-request state, from `Hijack()` ownership transfer to the `cancelCtx` goroutine that cancels `r.Context()` when the peer closes its end. Every claim in the sub-pages points at a `net/http/*.go` source file and approximate line. By the end you should be able to read `(*conn).serve` and explain every goroutine launched, every channel signaled, and every mutex acquired.

## Sub-pages

- [junior.md](junior.md) — Goroutine-per-connection model in plain terms, simple `http.Server` examples, what handlers run on, race traps on `ResponseWriter`, lifecycle of one request from `Accept` to handler return
- [middle.md](middle.md) — Stdlib reader's walk through `net/http/server.go`: `(*Server).Serve`, `(*conn).serve` line by line, persistent-connection loop, `ConnState` callbacks, `activeConn` bookkeeping
- [senior.md](senior.md) — HTTP/2 internals: `http2serverConn.serve`, framer goroutine, per-stream goroutines, flow-control windows, server preface, stream lifecycle, `Hijack()`, advanced timeouts, `MaxConcurrentStreams`
- [professional.md](professional.md) — Production tuning, `pprof` of a busy server, finding handler-leaked goroutines with `runtime.Stack`, building a custom `*http.Server` with structured shutdown, deadlines and panics
- [specification.md](specification.md) — Normative excerpts: RFC 9110 (HTTP Semantics), RFC 9112 (HTTP/1.1), RFC 9113 (HTTP/2), Go memory model statements relevant to handlers, pointers into the source tree
- [interview.md](interview.md) — 30+ interview questions from junior to staff with model answers
- [tasks.md](tasks.md) — Hands-on exercises: custom server with graceful shutdown, pprof instrumentation, intentionally leaking handler, fixing it
- [find-bug.md](find-bug.md) — 8-10 snippets with concurrency bugs in HTTP handlers (races on `ResponseWriter`, leaked goroutines, missing ctx propagation), with fixes
- [optimize.md](optimize.md) — Performance scenarios: `ReadTimeout` vs `ReadHeaderTimeout`, `MaxConcurrentStreams` tuning, response buffering, `sync.Pool` for handler scratch buffers, benchmarks
