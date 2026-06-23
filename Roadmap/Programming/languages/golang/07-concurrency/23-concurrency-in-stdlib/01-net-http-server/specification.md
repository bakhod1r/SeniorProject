---
layout: default
title: net/http Server Concurrency — Specification
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/specification/
---

# net/http Server Concurrency — Specification

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [RFC 9110 — HTTP Semantics](#rfc-9110--http-semantics)
3. [RFC 9112 — HTTP/1.1](#rfc-9112--http11)
4. [RFC 9113 — HTTP/2](#rfc-9113--http2)
5. [RFC 8441 — Bootstrapping WebSockets with HTTP/2](#rfc-8441--bootstrapping-websockets-with-http2)
6. [Go Memory Model Statements Relevant to net/http](#go-memory-model-statements-relevant-to-nethttp)
7. [Documented Concurrency Contracts in `net/http`](#documented-concurrency-contracts-in-nethttp)
8. [Source-Tree Pointers](#source-tree-pointers)
9. [Cross-Reference Table](#cross-reference-table)
10. [References](#references)

---

## Introduction

This file collects normative excerpts from the IETF RFCs that govern HTTP, paired with the Go documentation and source statements that govern concurrent behaviour in `net/http`. Citations are paraphrased where necessary; pointers to original sources are at the end.

---

## RFC 9110 — HTTP Semantics

### §3.1 Resources

> An origin server MAY be capable of handling multiple requests over a single connection or in parallel over multiple connections.

`net/http`'s `Server` implements both: HTTP/1.1 keep-alive (sequential reuse on one connection) and HTTP/2 (parallel streams on one connection).

### §3.4 Idempotent Methods

> A request method is considered "idempotent" if the intended effect on the server of multiple identical requests with that method is the same as the effect of a single such request. Of the request methods defined by this specification, PUT, DELETE, and safe request methods are idempotent.

Idempotency matters for the server because `net/http` retries (on the *client* side) require idempotency, and graceful shutdown semantics differ for in-flight idempotent vs non-idempotent requests.

### §9.3.6 CONNECT

> The CONNECT method requests that the recipient establish a tunnel to the destination origin server identified by the request-target and, if successful, thereafter restrict its behavior to blind forwarding of data, in both directions, until the tunnel is closed.

In Go this surfaces as the `Hijacker` interface: a handler that handles CONNECT calls `Hijack()` and from that point owns the raw `net.Conn`.

---

## RFC 9112 — HTTP/1.1

### §9.3 Persistence

> A recipient determines whether a connection is persistent by examining the most recently received `Connection` header field. If the close connection option is present, the connection will not persist after the current response; else, if the received protocol is HTTP/1.1, the connection will persist after the current response.

`net/http` honours this in `(*conn).serve` at `net/http/server.go` (around lines 2000-2100): after each request, the server checks `req.Close` and the persistent flag and either loops or returns.

### §9.6 Tear-down

> A server that doesn't have further use for a connection SHOULD send a "Connection: close" header field and close the connection after sending the final response.

When `Server.Close()` is called, the server forcibly terminates all connections (closes the listener and every active connection). When `Server.Shutdown()` is called, the server stops accepting and waits for in-flight requests to complete; idle connections are closed immediately, busy connections are closed on next idle.

### §6.3 Transfer-Encoding

> Transfer-Encoding MAY be used in HTTP messages to indicate any transfer-codings applied to the message body to safely transport it through the network.

`http.ResponseWriter` automatically uses chunked transfer encoding when `Content-Length` is unknown (i.e., the handler writes without setting `Content-Length` and doesn't end before headers are flushed).

---

## RFC 9113 — HTTP/2

### §3.4 HTTP/2 Connection Preface

> In HTTP/2, each endpoint is required to send a connection preface as a final confirmation of the protocol in use and to establish the initial settings for the HTTP/2 connection.

`golang.org/x/net/http2` reads the preface in `http2serverConn.serve` (`http2/server.go` around line 950).

### §5.1 Stream States

> The lifecycle of a stream is shown in [Figure 2]:
> idle → reserved (local/remote) → open → half-closed (local/remote) → closed

In Go this is tracked per-stream by `http2stream.state`. State transitions occur on frame send/receive and are protected by `http2serverConn.serveMu`.

### §5.2 Flow Control

> Flow control is used for both individual streams and for the connection as a whole. ... A receiver advertises its initial window size via the SETTINGS frame.

`net/http` HTTP/2 uses a default per-stream window of 64 KiB (configurable via `http2.Server.MaxUploadBufferPerStream`) and a connection window of 1 MiB. Window updates are sent automatically as data is consumed.

### §5.1.2 Stream Concurrency

> A peer can limit the number of concurrently active streams using the SETTINGS_MAX_CONCURRENT_STREAMS parameter within a SETTINGS frame.

In `net/http` this is `http2.Server.MaxConcurrentStreams` (default 250 in Go 1.21+). Each accepted stream gets one goroutine. Exceeding the limit results in `REFUSED_STREAM`.

### §6.9 WINDOW_UPDATE

> The WINDOW_UPDATE frame is used to implement flow control. ... Flow control only applies to frames that are identified as being subject to flow control. Of the frame types defined in this document, this includes only DATA frames.

The server's framer goroutine batches window updates to reduce frame chatter (`http2/server.go` `http2serverConn.scheduleFrameWrite`).

---

## RFC 8441 — Bootstrapping WebSockets with HTTP/2

WebSockets over HTTP/2 use the extended CONNECT method. Go's `net/http` does *not* natively bridge WebSockets over HTTP/2; you must use `golang.org/x/net/websocket` or `nhooyr.io/websocket` and these typically downgrade to HTTP/1.1 + `Upgrade: websocket`. The `Hijacker` interface only works in HTTP/1.1 mode; on HTTP/2, `Hijack()` returns `http.ErrNotSupported`.

---

## Go Memory Model Statements Relevant to net/http

From [go.dev/ref/mem](https://go.dev/ref/mem):

> The go statement that starts a new goroutine happens before the goroutine's execution begins.

This means: when `Serve` calls `go c.serve(ctx)`, every memory write that occurred before the `go` statement is visible to `c.serve`. The connection is fully initialised before its goroutine runs.

> A receive from an unbuffered channel happens before the send on that channel completes.

`Server.Shutdown` uses a `doneChan` channel (closed when shutdown completes) to signal waiters. The close-before-receive relationship guarantees that any state written before `close(s.doneChan)` is visible after `<-s.doneChan` returns.

> The closing of a channel happens before a receive that returns because the channel is closed.

`s.doneChan` is closed at the end of `Shutdown`. Any caller waiting on it observes a fully-shutdown server.

---

## Documented Concurrency Contracts in `net/http`

### `http.ResponseWriter` is NOT safe for concurrent use

From `net/http/server.go` doc comment near line 95:

> A ResponseWriter interface is used by an HTTP handler to construct an HTTP response. A ResponseWriter may not be used after the Handler.ServeHTTP method has returned.

And implicitly: a `ResponseWriter` may not be used concurrently from multiple goroutines. If you call `Write()` from a background goroutine and from the main handler goroutine simultaneously, the result is undefined (often a data race detected by `-race`).

### `r.Context()` cancellation

From `net/http/request.go` near line 360:

> For incoming server requests, the context is canceled when the client's connection closes, the request is canceled (with HTTP/2), or when the ServeHTTP method returns.

This means: any goroutine you spawn from a handler MUST observe `<-r.Context().Done()` to avoid leaking when the client disconnects.

### `Handler.ServeHTTP` and goroutines

From `net/http/server.go` doc comment on `Handler`:

> ServeHTTP should write reply headers and data to the ResponseWriter and then return. Returning signals that the request is finished; it is not valid to use the ResponseWriter or read from the Request.Body after or concurrently with the completion of the ServeHTTP call.

Critical implication: if your handler spawns a goroutine that writes to `w` after the handler returns, you have a use-after-free against the server's per-connection state machine.

### Hijacker

From `net/http/server.go` doc on `Hijacker`:

> After a call to Hijack the HTTP server library will not do anything else with the connection.

So the goroutine running the handler now owns the underlying `net.Conn`. The server no longer reads from it, writes to it, or applies timeouts. You must `Close()` the conn yourself.

### Server.Serve concurrency

From the `Serve` doc comment:

> Serve always returns a non-nil error and closes l. ... Serve accepts incoming connections on the Listener l, creating a new service goroutine for each.

Each accepted connection gets exactly one goroutine.

---

## Source-Tree Pointers

| File | Approximate lines | What lives there |
|------|-------------------|------------------|
| `net/http/server.go:1934` | Server type definition | All exported `Server` fields including `ReadTimeout`, `Handler`, `ErrorLog`, `ConnState` |
| `net/http/server.go:3260` | `(*Server).Serve` | Main accept loop |
| `net/http/server.go:3367` | `(*Server).ListenAndServe` | Convenience: listen TCP, then `Serve` |
| `net/http/server.go:1924` | `(*conn).serve` | Per-connection goroutine entry point |
| `net/http/server.go:990`  | `(*conn).readRequest` | Reads and parses one HTTP/1.1 request |
| `net/http/server.go:2814` | `(*Server).Shutdown` | Graceful shutdown |
| `net/http/server.go:2890` | `(*Server).Close` | Forceful shutdown |
| `net/http/server.go:2480` | `(*conn).hijackLocked` | Connection hijacking |
| `net/http/server.go:1670` | `(*response).WriteHeader` | Writes response status line and headers |
| `net/http/server.go:1808` | `(*response).Write` | Writes response body |
| `net/http/server.go:2380` | `(*conn).serve`'s cancelCtx | Spawns context-cancel goroutine on close |
| `net/http/transfer.go:84`  | `transferWriter` | Manages chunked encoding output |
| `net/http/h2_bundle.go`    | bundled http2 | HTTP/2 implementation (vendored from `golang.org/x/net/http2`) |

Notes:
- Line numbers are approximate (Go 1.22). Use `grep -n` to locate exactly.
- `h2_bundle.go` is auto-generated from `golang.org/x/net/http2`. For readable source, look at the upstream package: `golang.org/x/net/http2/server.go`.

---

## Cross-Reference Table

| Concept | net/http API | RFC | Source |
|---------|-------------|-----|--------|
| Accept loop | `Server.Serve` | RFC 9112 §9.3 | `server.go:3260` |
| Keep-alive | `Server.SetKeepAlivesEnabled` | RFC 9112 §9.3 | `server.go:2900` |
| Graceful shutdown | `Server.Shutdown` | (none) | `server.go:2814` |
| Forceful close | `Server.Close` | (none) | `server.go:2890` |
| Read timeout | `Server.ReadTimeout` | (none) | `server.go:1955` |
| Header timeout | `Server.ReadHeaderTimeout` | (none) | `server.go:1957` |
| Write timeout | `Server.WriteTimeout` | (none) | `server.go:1959` |
| Idle timeout | `Server.IdleTimeout` | (none) | `server.go:1962` |
| Connection hijack | `Hijacker` | RFC 9110 §9.3.6 | `server.go:2480` |
| Request context | `Request.Context` | (none) | `request.go:360` |
| Flusher | `Flusher` | RFC 9112 §7 | `server.go:182` |
| HTTP/2 streams | (transparent) | RFC 9113 §5 | `h2_bundle.go` |
| HTTP/2 flow control | `http2.Server.MaxUploadBufferPerStream` | RFC 9113 §5.2 | `http2/server.go` |
| HTTP/2 stream limit | `http2.Server.MaxConcurrentStreams` | RFC 9113 §5.1.2 | `http2/server.go` |

---

## References

- IETF RFC 9110 — *HTTP Semantics*. <https://www.rfc-editor.org/rfc/rfc9110>
- IETF RFC 9112 — *HTTP/1.1*. <https://www.rfc-editor.org/rfc/rfc9112>
- IETF RFC 9113 — *HTTP/2*. <https://www.rfc-editor.org/rfc/rfc9113>
- IETF RFC 8441 — *Bootstrapping WebSockets with HTTP/2*. <https://www.rfc-editor.org/rfc/rfc8441>
- Go Memory Model. <https://go.dev/ref/mem>
- Go source tree: <https://github.com/golang/go/tree/master/src/net/http>
- `golang.org/x/net/http2` source: <https://github.com/golang/net/tree/master/http2>
- "Go's HTTP server: a deep dive" — talks at GopherCon 2017, 2019.
- Brad Fitzpatrick, "HTTP/2 in Go" — GopherCon 2016.
