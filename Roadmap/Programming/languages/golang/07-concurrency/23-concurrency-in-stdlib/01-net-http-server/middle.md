---
layout: default
title: net/http Server Concurrency — Middle
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/middle/
---

# net/http Server Concurrency — Middle

[← Back](../)

This page walks through Go's `net/http` server source, tracing concurrency from
the moment a TCP connection is accepted to the moment a handler runs and the
response is flushed back to the wire. The path is dense; we are not summarizing
behavior we are following actual code in `src/net/http/server.go`. All line
numbers refer to the Go 1.22 / 1.23 era of the file. Minor offsets exist between
versions but the structure is stable; we will note where to look if a line moved.

The audience is an intermediate Go developer who can already write a handler,
already knows that handlers run in goroutines, and now wants to know exactly
which goroutines exist, who owns the connection, what gets cancelled, what gets
blocked, and what happens when the client goes away.

We will visit, in order:

1. The accept loop at `(*Server).Serve` and the backoff dance on temporary
   errors.
2. The `conn` struct and what each field protects.
3. `(*conn).serve(ctx)` — the per-connection goroutine.
4. Reading a request, the `expectContinueReader`, body wrappers, and the chunked
   transfer reader.
5. Handler dispatch through `serverHandler` and how `DefaultServeMux` plugs in.
6. The `response` struct, the `bufio.Writer` chain, and `chunkWriter`.
7. Keep-alive: how the connection goroutine reuses itself.
8. Contexts — `BaseContext`, `ConnContext`, the per-connection cancel context,
   the per-request context, and the watchdog goroutine that fires when the
   client closes.
9. Timeouts — `ReadTimeout`, `ReadHeaderTimeout`, `WriteTimeout`, `IdleTimeout`
   and why they are deadlines on the net.Conn rather than separate timer
   goroutines.
10. The `ConnState` callback and the four-state transition machine.
11. `Shutdown` and how it cooperatively drains active connections.
12. The `activeConn` map, the `mu` mutex, and `trackConn` / `deleteConn`.
13. `Hijack` and what changes once a handler steals the connection.

## 1. The accept loop — `(*Server).Serve`

`ListenAndServe` is a thin wrapper. It creates a `net.Listener` and calls
`Serve`. The real work begins at `(*Server).Serve` around
`net/http/server.go:3194`. The shape, condensed for reading:

```go
// net/http/server.go (around line 3194)
func (srv *Server) Serve(l net.Listener) error {
    if fn := testHookServerServe; fn != nil {
        fn(srv, l)
    }

    origListener := l
    l = &onceCloseListener{Listener: l}
    defer l.Close()

    if err := srv.setupHTTP2_Serve(); err != nil {
        return err
    }

    if !srv.trackListener(&l, true) {
        return ErrServerClosed
    }
    defer srv.trackListener(&l, false)

    baseCtx := context.Background()
    if srv.BaseContext != nil {
        baseCtx = srv.BaseContext(origListener)
        if baseCtx == nil {
            panic("BaseContext returned a nil context")
        }
    }

    var tempDelay time.Duration // how long to sleep on accept failure

    ctx := context.WithValue(baseCtx, ServerContextKey, srv)
    for {
        rw, err := l.Accept()
        if err != nil {
            if srv.shuttingDown() {
                return ErrServerClosed
            }
            if ne, ok := err.(net.Error); ok && ne.Temporary() {
                if tempDelay == 0 {
                    tempDelay = 5 * time.Millisecond
                } else {
                    tempDelay *= 2
                }
                if max := 1 * time.Second; tempDelay > max {
                    tempDelay = max
                }
                srv.logf("http: Accept error: %v; retrying in %v", err, tempDelay)
                time.Sleep(tempDelay)
                continue
            }
            return err
        }
        connCtx := ctx
        if cc := srv.ConnContext; cc != nil {
            connCtx = cc(connCtx, rw)
            if connCtx == nil {
                panic("ConnContext returned nil")
            }
        }
        tempDelay = 0
        c := srv.newConn(rw)
        c.setState(c.rwc, StateNew, runHooks) // before Serve can return
        go c.serve(connCtx)
    }
}
```

Notice what is and is not on the hot path:

- `Accept` runs in the **listener goroutine**. There is exactly one of these
  per call to `Serve`. It blocks on the OS until a new TCP connection
  materializes.
- Successful accepts allocate one `conn`, register it via `setState(StateNew)`
  (which both records bookkeeping and fires the user-supplied `ConnState`
  hook), and then dispatch to a fresh goroutine: `go c.serve(connCtx)`. From
  this point forward the listener goroutine is uninvolved with that
  connection.
- Temporary errors (`net.Error.Temporary()`) trigger an exponential backoff
  starting at 5ms and capped at 1s. The same goroutine sleeps; it does not
  spawn a timer. The intent is to avoid burning CPU when, say, the process is
  out of file descriptors. After a successful accept, `tempDelay` is reset to
  zero, so a single transient failure does not penalize subsequent accepts.
- A non-temporary error returns. If `srv.shuttingDown()` is true (set by
  `Shutdown`), the loop exits cleanly with `ErrServerClosed`.

The `ConnContext` hook is applied before the goroutine launches, so the per
connection context is built once on the listener goroutine. This matters for
data races: anything you stash via `context.WithValue(connCtx, ...)` is safe
because nothing else holds a reference to that context until `go c.serve` reads
it.

`srv.trackListener` adds the listener to `srv.listeners`, a `map[*net.Listener]struct{}`
guarded by `srv.mu`. `Shutdown` walks that map to close the listeners and unblock
the `Accept` call above.

## 2. Per-connection state — `type conn struct`

Look at `type conn struct` around `net/http/server.go:265`. It is the canonical
object representing one HTTP connection. Stripped of comments:

```go
// net/http/server.go (around line 265)
type conn struct {
    // server is the server on which the connection arrived.
    // Immutable; never nil.
    server *Server

    // cancelCtx cancels the connection-level context.
    cancelCtx context.CancelFunc

    // rwc is the underlying network connection.
    // This is never wrapped by other types and is the value given out
    // to CloseNotifier callers. It is usually of type *net.TCPConn or
    // *tls.Conn.
    rwc net.Conn

    // remoteAddr is rwc.RemoteAddr().String(). It is not populated synchronously
    // inside (*conn).serve because it can hang on some implementations.
    remoteAddr string

    // tlsState is the TLS connection state when using TLS.
    // nil for non-TLS.
    tlsState *tls.ConnectionState

    // werr is set to the first write error to rwc.
    // It is set via checkConnErrorWriter{w}, where bufw writes.
    werr error

    // r is bufr's underlying reader; it is a wrapper around rwc
    // that provides io.LimitedReader-style limiting (while reading
    // request headers) and functionality to support CloseNotifier.
    // See *connReader docs.
    r *connReader

    // bufr reads from r.
    bufr *bufio.Reader

    // bufw writes to checkConnErrorWriter{c}, which populates werr on error.
    bufw *bufio.Writer

    // lastMethod is the method of the most recent request
    // on this connection, if any.
    lastMethod string

    curReq atomic.Pointer[response] // (which has a Request in it)

    curState atomic.Uint64 // packed (unixtime<<8|uint8(ConnState))

    // mu guards hijackedv
    mu sync.Mutex

    // hijackedv is whether this connection has been hijacked
    // by a Handler with the Hijacker interface.
    // It is guarded by mu.
    hijackedv bool
}
```

The fields divide cleanly into three groups:

- **Immutable after construction**: `server`, `rwc`, `cancelCtx`,
  `remoteAddr`, `tlsState`. These are written before `go c.serve` is invoked
  and are read freely afterwards without locking.
- **Owned by the per-connection goroutine**: `r`, `bufr`, `bufw`, `lastMethod`,
  `werr`. Only `(*conn).serve` and the code it calls (synchronously) touch
  these. They are not safe to read from another goroutine.
- **Atomic / locked**: `curReq` (an `atomic.Pointer[response]`, read by
  background helpers; the conn-level cancel goroutine peeks at it),
  `curState` (an `atomic.Uint64` packing the state byte with the unix
  timestamp, used by `Shutdown` to know when an idle connection has been
  idle long enough), and `hijackedv` guarded by `mu`. `Hijack` is the one
  case where ownership of the connection legally transfers, and the locking
  protocol is centered on `mu` and the `hijackedv` flag.

There is also `hijacked` exposed as an atomic accessor:

```go
// net/http/server.go (around line 304)
func (c *conn) hijacked() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.hijackedv
}
```

The codebase predates `sync/atomic.Bool` for this field, hence the explicit
mutex. The mutex also synchronizes the transition: once `hijackedv` is set,
the conn-level cleanup must not close `rwc` or drain `bufr`; the new owner
will. We will return to this in section 13.

`curState` is unusual. It packs the connection state (one of `StateNew`,
`StateActive`, `StateIdle`, `StateHijacked`, `StateClosed`) into the low byte
and the unix timestamp into the high 56 bits. The packed form means a single
atomic load gives `Shutdown` both pieces of information at once:

```go
// net/http/server.go (around line 3030)
func (s *Server) closeIdleConns() bool {
    s.mu.Lock()
    defer s.mu.Unlock()
    quiescent := true
    for c := range s.activeConn {
        st, unixSec := c.getState()
        // Issue 22682: treat StateNew connections as if
        // they're idle if we haven't read the first request's
        // header in over 5 seconds.
        if st == StateNew && unixSec < time.Now().Unix()-5 {
            st = StateIdle
        }
        if st != StateIdle || unixSec == 0 {
            quiescent = false
            continue
        }
        c.rwc.Close()
        delete(s.activeConn, c)
    }
    return quiescent
}
```

`getState` reverses the packing:

```go
// net/http/server.go (around line 1900)
func (c *conn) getState() (state ConnState, unixSec int64) {
    packedState := c.curState.Load()
    return ConnState(packedState & 0xff), int64(packedState >> 8)
}
```

## 3. `(*conn).serve(ctx)` — the per-connection goroutine

This function, around `net/http/server.go:1956`, is where most of the per
connection lifecycle lives. Lightly condensed:

```go
// net/http/server.go (around line 1956)
func (c *conn) serve(ctx context.Context) {
    c.remoteAddr = c.rwc.RemoteAddr().String()
    ctx = context.WithValue(ctx, LocalAddrContextKey, c.rwc.LocalAddr())
    var inFlightResponse *response
    defer func() {
        if err := recover(); err != nil && err != ErrAbortHandler {
            const size = 64 << 10
            buf := make([]byte, size)
            buf = buf[:runtime.Stack(buf, false)]
            c.server.logf("http: panic serving %v: %v\n%s", c.remoteAddr, err, buf)
        }
        if inFlightResponse != nil {
            inFlightResponse.cancelCtx()
            inFlightResponse.disableWriteContinue()
        }
        if !c.hijacked() {
            c.close()
            c.setState(c.rwc, StateClosed, runHooks)
        }
    }()

    if tlsConn, ok := c.rwc.(*tls.Conn); ok {
        tlsTO := c.server.tlsHandshakeTimeout()
        if tlsTO > 0 {
            dl := time.Now().Add(tlsTO)
            c.rwc.SetReadDeadline(dl)
            c.rwc.SetWriteDeadline(dl)
        }
        if err := tlsConn.HandshakeContext(ctx); err != nil {
            // If the handshake failed due to the client not speaking
            // TLS, assume they're speaking plaintext HTTP and write a
            // status code 400 response.
            if re, ok := err.(tls.RecordHeaderError); ok && re.Conn != nil && tlsRecordHeaderLooksLikeHTTP(re.RecordHeader) {
                io.WriteString(re.Conn, "HTTP/1.0 400 Bad Request\r\n\r\nClient sent an HTTP request to an HTTPS server.\n")
                re.Conn.Close()
                return
            }
            c.server.logf("http: TLS handshake error from %s: %v", c.rwc.RemoteAddr(), err)
            return
        }
        // Restore Conn-level deadlines.
        if tlsTO > 0 {
            c.rwc.SetReadDeadline(time.Time{})
            c.rwc.SetWriteDeadline(time.Time{})
        }
        c.tlsState = new(tls.ConnectionState)
        *c.tlsState = tlsConn.ConnectionState()
        if proto := c.tlsState.NegotiatedProtocol; validNextProto(proto) {
            if fn := c.server.TLSNextProto[proto]; fn != nil {
                h := initALPNRequest{ctx, tlsConn, serverHandler{c.server}}
                // Mark the connection as hijacked so it won't be re-used.
                c.setState(c.rwc, StateHijacked, skipHooks)
                fn(c.server, tlsConn, h)
            }
            return
        }
    }

    // HTTP/1.x from here on.

    ctx, cancelCtx := context.WithCancel(ctx)
    c.cancelCtx = cancelCtx
    defer cancelCtx()

    c.r = &connReader{conn: c}
    c.bufr = newBufioReader(c.r)
    c.bufw = newBufioWriterSize(checkConnErrorWriter{c}, 4<<10)

    for {
        w, err := c.readRequest(ctx)
        if c.r.remain != c.server.initialReadLimitSize() {
            // If we read any bytes off the wire, we're active.
            c.setState(c.rwc, StateActive, runHooks)
        }
        if err != nil {
            // ... error handling that writes a 400, 408, 413, 431 and bails out.
            return
        }

        // Expect 100 Continue support
        req := w.req
        if req.expectsContinue() {
            if req.ProtoAtLeast(1, 1) && req.ContentLength != 0 {
                // Wrap the Body reader with one that replies on the connection.
                req.Body = &expectContinueReader{readCloser: req.Body, resp: w}
                w.canWriteContinue.Store(true)
            }
        } else if req.Header.get("Expect") != "" {
            w.sendExpectationFailed()
            return
        }

        c.curReq.Store(w)

        if requestBodyRemains(req.Body) {
            registerOnHitEOF(req.Body, w.conn.r.startBackgroundRead)
        } else {
            w.conn.r.startBackgroundRead()
        }

        // HTTP cannot have multiple simultaneous active requests.[*]
        // Until the server replies to this request, it can't read another,
        // so we might as well run the handler in this goroutine.
        // [*] Not strictly true: HTTP pipelining. We could let them all process
        // in parallel even if their responses need to be serialized.
        // But we're not going to implement HTTP pipelining because it
        // was never deployed in the wild and the answer is HTTP/2.
        inFlightResponse = w
        serverHandler{c.server}.ServeHTTP(w, w.req)
        inFlightResponse = nil
        w.cancelCtx()
        if c.hijacked() {
            return
        }
        w.finishRequest()
        c.rwc.SetWriteDeadline(time.Time{})
        if !w.shouldReuseConnection() {
            if w.requestBodyLimitHit || w.closedRequestBodyEarly() {
                c.closeWriteAndWait()
            }
            return
        }
        c.setState(c.rwc, StateIdle, runHooks)
        c.curReq.Store(nil)

        if !w.conn.server.doKeepAlives() {
            return
        }

        if d := c.server.idleTimeout(); d != 0 {
            c.rwc.SetReadDeadline(time.Now().Add(d))
        } else {
            c.rwc.SetReadDeadline(time.Time{})
        }
        // Wait for the connection to become readable again before trying to
        // read the next request. This prevents a ReadHeaderTimeout or
        // ReadTimeout from starting until the first byte of the next request.
        if _, err := c.bufr.Peek(4); err != nil {
            return
        }
        c.rwc.SetReadDeadline(time.Time{})
    }
}
```

Key observations:

- The panic recovery wraps the entire serve. A user handler that panics does
  **not** crash the whole server; it logs a stack trace, abandons that
  connection, and `defer` runs `c.close()` to make sure the socket is shut.
  The exception is `ErrAbortHandler`: it suppresses the log, but still
  abandons the connection. Handlers use it to bail out silently when the
  client is gone.
- The TLS handshake happens on this same goroutine. It is bounded by the
  `tlsHandshakeTimeout` via `SetReadDeadline` / `SetWriteDeadline`. Once
  the handshake completes, the deadlines are restored to "no deadline" so
  the per-request timeouts can apply later.
- If ALPN negotiates `h2`, the conn-level goroutine becomes a thin shim. It
  marks the conn `StateHijacked` (with `skipHooks` — the ConnState hook is
  not fired again, since the next handler is HTTP/2 specific) and calls into
  `golang.org/x/net/http2` which manages its own concurrency model. From
  `(*conn).serve`'s perspective the connection is gone.
- After the HTTP/1.x branch is taken, the function sets up the connection
  level `cancelCtx`. This is the context that **all** requests on this
  connection derive from. When the conn-level goroutine returns, `defer
  cancelCtx()` cancels everything downstream — including any goroutines a
  handler spawned and tied to `r.Context()`.
- The `connReader`, `bufr` and `bufw` are constructed once per connection and
  reused for every request. They are returned to `sync.Pool`s on close, via
  `newBufioReader`/`putBufioReader`.

The for loop is the heart. One iteration handles one HTTP/1.x request and
response. We will dissect each phase next.

## 4. Reading a request

`c.readRequest(ctx)` is defined around `net/http/server.go:1023`. The function
returns a `*response` — note that the response is allocated **before** the
handler runs, because the response holds the request, the per-request cancel
function, and the chain of buffered writers.

```go
// net/http/server.go (around line 1023)
func (c *conn) readRequest(ctx context.Context) (w *response, err error) {
    if c.hijacked() {
        return nil, ErrHijacked
    }

    var (
        wholeReqDeadline time.Time // or zero if none
        hdrDeadline      time.Time // or zero if none
    )
    t0 := time.Now()
    if d := c.server.readHeaderTimeout(); d > 0 {
        hdrDeadline = t0.Add(d)
    }
    if d := c.server.ReadTimeout; d > 0 {
        wholeReqDeadline = t0.Add(d)
    }
    c.rwc.SetReadDeadline(hdrDeadline)
    if d := c.server.WriteTimeout; d > 0 {
        defer func() {
            c.rwc.SetWriteDeadline(time.Now().Add(d))
        }()
    }

    c.r.setReadLimit(c.server.initialReadLimitSize())
    if c.lastMethod == "POST" {
        // RFC 7230 section 3 tolerance for old buggy clients.
        peek, _ := c.bufr.Peek(4) // ReadRequest will get err below
        c.bufr.Discard(numLeadingCRorLF(peek))
    }
    req, err := readRequest(c.bufr)
    if err != nil {
        if c.r.hitReadLimit() {
            return nil, errTooLarge
        }
        return nil, err
    }

    if !http1ServerSupportsRequest(req) {
        return nil, statusError{StatusHTTPVersionNotSupported, "unsupported protocol version"}
    }

    c.lastMethod = req.Method
    c.r.setInfiniteReadLimit()

    hosts, haveHost := req.Header["Host"]
    isH2Upgrade := req.isH2Upgrade()
    if req.ProtoAtLeast(1, 1) && (!haveHost || len(hosts) == 0) && !isH2Upgrade && req.Method != "CONNECT" {
        return nil, badRequestError("missing required Host header")
    }
    // ...
    // After full header read, switch to wholeReqDeadline.
    if !hdrDeadline.Equal(wholeReqDeadline) {
        c.rwc.SetReadDeadline(wholeReqDeadline)
    }

    ctx, cancelCtx := context.WithCancel(ctx)
    req.ctx = ctx
    req.RemoteAddr = c.remoteAddr
    req.TLS = c.tlsState
    if body, ok := req.Body.(*body); ok {
        body.doEarlyClose = true
    }

    // Adjust the read deadline if necessary.
    if !hdrDeadline.Equal(wholeReqDeadline) {
        c.rwc.SetReadDeadline(wholeReqDeadline)
    }

    w = &response{
        conn:          c,
        cancelCtx:     cancelCtx,
        req:           req,
        reqBody:       req.Body,
        handlerHeader: make(Header),
        contentLength: -1,
        closeNotifyCh: make(chan bool, 1),

        // We populate these ahead of time so we're not
        // reading from req.Header after their Handler starts
        // and maybe mutates it (Issue 14940).
        wants10KeepAlive: req.wantsHttp10KeepAlive(),
        wantsClose:       req.wantsClose(),
    }
    if isH2Upgrade {
        w.closeAfterReply = true
    }
    w.cw.res = w
    w.w = newBufioWriterSize(&w.cw, bufferBeforeChunkingSize)
    return w, nil
}
```

What happens here, concurrency-wise:

- Two read deadlines exist: `ReadHeaderTimeout` (`hdrDeadline`) covers just
  the request-line and headers, `ReadTimeout` (`wholeReqDeadline`) covers
  the whole request including body. They are enforced as `SetReadDeadline`
  on the underlying `net.Conn`; the kernel returns `i/o timeout` if no data
  is delivered before the deadline. There is no separate timer goroutine.
- `WriteTimeout` is applied with a `defer`. After `readRequest` returns, the
  next thing the goroutine does is run the handler; once any data is being
  written, `WriteTimeout` from the point of header completion governs how
  long the entire response can take.
- The per-request context is a `WithCancel` derived from the
  conn-level context. `req.ctx = ctx` and `w.cancelCtx = cancelCtx`. Once
  the handler completes, `w.cancelCtx()` is called from `(*conn).serve`. If
  the client disconnects mid-request, the background reader (see below) will
  cancel this context.
- `initialReadLimitSize` is the per-server cap for the size of headers (1MB by
  default). The `connReader` enforces this as an explicit `LimitedReader`
  style limit; if exceeded, we return `errTooLarge`, which becomes a 431
  response.
- The body is wrapped twice: first by `readTransfer` inside `readRequest`
  (which decides between content-length, chunked, or no body), and again by
  the response struct (`w.reqBody = req.Body`). The original handle is kept
  so that `finishRequest` can drain the body if the handler did not.

### 4a. `expectContinueReader`

For requests with `Expect: 100-continue`, the client withholds the body until
the server says "go ahead." `expectContinueReader` does this lazily: it sends
`HTTP/1.1 100 Continue\r\n\r\n` on the first `Read` of the body. The relevant
type:

```go
// net/http/server.go (around line 950)
type expectContinueReader struct {
    resp       *response
    readCloser io.ReadCloser
    closed     atomic.Bool
    sawEOF     atomic.Bool
}

func (ecr *expectContinueReader) Read(p []byte) (n int, err error) {
    if ecr.closed.Load() {
        return 0, ErrBodyReadAfterClose
    }
    w := ecr.resp
    if w.canWriteContinue.Load() {
        w.writeContinueMu.Lock()
        if w.canWriteContinue.Load() {
            w.conn.bufw.WriteString("HTTP/1.1 100 Continue\r\n\r\n")
            w.conn.bufw.Flush()
            w.canWriteContinue.Store(false)
        }
        w.writeContinueMu.Unlock()
    }
    n, err = ecr.readCloser.Read(p)
    if err == io.EOF {
        ecr.sawEOF.Store(true)
    }
    return
}
```

Two atomics gate the work: `canWriteContinue` and `closed`. The lock
`writeContinueMu` serializes the actual write to `bufw` against
`finishRequest` (which may have decided to skip Continue and just write the
final response). Both paths check `canWriteContinue` after taking the lock
to avoid double writes.

### 4b. `connReader` and the background read for client-disconnect detection

`c.r` is a `*connReader`. Its job is two-fold: enforce the header read limit,
and detect when the **client** closes the connection while the server is
writing or the handler is busy. Look at `startBackgroundRead`:

```go
// net/http/server.go (around line 740)
func (cr *connReader) startBackgroundRead() {
    cr.lock()
    if cr.inRead {
        cr.unlock()
        panic("invalid concurrent Body.Read call")
    }
    if cr.hasByte {
        cr.unlock()
        return
    }
    cr.inRead = true
    cr.unlock()
    go cr.backgroundRead()
}

func (cr *connReader) backgroundRead() {
    n, err := cr.conn.rwc.Read(cr.byteBuf[:])
    cr.lock()
    if n == 1 {
        cr.hasByte = true
        // We were past the end of the previous request's body already
        // (since we wouldn't be in a background read otherwise), so
        // this is a pipelined HTTP request. Prior to Go 1.11 we used to
        // send on the CloseNotify channel and cancel the context here,
        // but the behavior was documented as only "may", so we stopped
        // doing that, since it caused problems for some servers.
    }
    if ne, ok := err.(net.Error); ok && cr.aborted && ne.Timeout() {
        // Ignore this error. It's the expected error from
        // another goroutine calling abortPendingRead.
    } else if err != nil {
        cr.handleReadError(err)
    }
    cr.aborted = false
    cr.inRead = false
    cr.unlock()
    cr.cond.Broadcast()
}
```

This is the only goroutine that net/http spawns per active request beyond the
connection goroutine. It exists for two reasons:

- If the client sends a byte while the server is still writing the response,
  the byte is a pipelined next request — we save it (`hasByte = true`) so
  the next iteration of the conn serve loop can return it via
  `bufr.Peek(4)`.
- If the client **closes** the connection or the read returns any non-timeout
  error, `handleReadError` is called. That cancels the request context and
  fires `CloseNotify`:

```go
// net/http/server.go (around line 690)
func (cr *connReader) handleReadError(_ error) {
    cr.conn.cancelCtx()
    cr.closeNotify()
}
```

So **the client-disconnect signal is delivered by a goroutine that is blocked
in `Read` on the socket**. There is no polling. The same goroutine that
notices the disconnect is the one that propagates it. Cancellation of
`r.Context()` is therefore prompt.

The choreography between the handler reading the request body and the
background reader is precise. While the handler is reading the body (via the
`*body` type from `transfer.go`), the connReader is **not** in background-read
mode; it is the body's reader. Once the body hits EOF, `registerOnHitEOF`
fires and `startBackgroundRead` is invoked, putting the connReader into the
"watch for the next byte / disconnect" state. If the handler never finishes
reading the body, the background read does not start until `finishRequest`
drains the body. This avoids the "concurrent Body.Read" panic that the
function guards against.

### 4c. Chunked transfer decoding

For chunked request bodies, the read path is set up in `readTransfer` (in
`net/http/transfer.go`). The body wrapper is `*body`, which holds an
`*internal/textproto.Reader` plus a chunk-decoding `io.Reader`. The decode
runs synchronously on the handler's goroutine — there is no separate body
goroutine on the read side for HTTP/1.x. (The write side is different; we
will see `chunkWriter` shortly.)

The relevant excerpt:

```go
// net/http/transfer.go (around line 580)
func (b *body) Read(p []byte) (n int, err error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return 0, ErrBodyReadAfterClose
    }
    return b.readLocked(p)
}

func (b *body) readLocked(p []byte) (n int, err error) {
    n, err = b.src.Read(p)
    if err == io.EOF {
        b.sawEOF = true
        // Force a final read of trailers.
        if b.hdr != nil {
            if e := b.readTrailer(); e != nil {
                err = e
                b.hdr = nil
            } else {
                b.hdr = nil
            }
        }
    }
    // ...
    return n, err
}
```

`b.mu` exists because the body can be touched from two goroutines: the
handler goroutine reading, and the background body-drain in `finishRequest`.
Both go through `body.Read`, and the mutex serializes them.

## 5. Dispatch — `serverHandler{c.server}.ServeHTTP(w, w.req)`

After a request is read, the conn-level serve calls:

```go
inFlightResponse = w
serverHandler{c.server}.ServeHTTP(w, w.req)
inFlightResponse = nil
```

`serverHandler` is a tiny adapter that picks `srv.Handler` if non-nil, else
`DefaultServeMux`:

```go
// net/http/server.go (around line 2932)
type serverHandler struct {
    srv *Server
}

func (sh serverHandler) ServeHTTP(rw ResponseWriter, req *Request) {
    handler := sh.srv.Handler
    if handler == nil {
        handler = DefaultServeMux
    }
    if !sh.srv.DisableGeneralOptionsHandler && req.RequestURI == "*" && req.Method == "OPTIONS" {
        handler = globalOptionsHandler{}
    }
    handler.ServeHTTP(rw, req)
}
```

`DefaultServeMux` is a global `*ServeMux`. Its `ServeHTTP` walks the
internal pattern tree, finds the most specific match, and calls that
handler's `ServeHTTP`. The mux uses an internal `sync.RWMutex`:

```go
// net/http/server.go (around line 2487)
type ServeMux struct {
    mu       sync.RWMutex
    tree     routingNode
    index    routingIndex
    patterns []*pattern  // TODO(jba): remove if not needed for Go 1.22
    mux121   serveMux121
}
```

Every `Handle` / `HandleFunc` takes the write lock; every request takes the
read lock. Lookups are O(log n) thanks to the `routingNode` trie. Read lock
contention is essentially nil in steady state because no one is mutating
routes during traffic.

Crucially, the handler runs on the same goroutine as the connection's serve
loop. So when you call `r.Context()` inside a handler, the context you get is
the per-request context derived from the connection context derived from
`BaseContext`. There is no goroutine handoff for the handler call. If the
handler **does** spawn goroutines, those are user-owned; net/http knows
nothing about them. They will see `r.Context()` cancelled when the conn-level
serve calls `w.cancelCtx()` after `ServeHTTP` returns or when the background
reader notices a disconnect.

## 6. The `response` struct and the bufio chain

The `response` struct around `net/http/server.go:432` is the concrete type
behind `ResponseWriter`. Trimmed:

```go
// net/http/server.go (around line 432)
type response struct {
    conn             *conn
    req              *Request // request for this response
    reqBody          io.ReadCloser
    cancelCtx        context.CancelFunc // when ServeHTTP exits
    wroteHeader      bool               // a non-1xx header has been (logically) written
    wroteContinue    bool               // 100 Continue response was written
    wants10KeepAlive bool               // HTTP/1.0 w/ Connection "keep-alive"
    wantsClose       bool               // HTTP request has Connection "close"

    // canWriteContinue is an atomic boolean that says whether or
    // not a 100 Continue header can be written to the
    // connection.
    canWriteContinue atomic.Bool
    writeContinueMu  sync.Mutex

    w  *bufio.Writer // buffers output in chunks to chunkWriter
    cw chunkWriter

    handlerHeader     Header
    calledHeader      bool

    written       int64 // number of bytes written in body
    contentLength int64 // explicitly-declared Content-Length; or -1
    status        int   // status code passed to WriteHeader

    closeAfterReply bool

    fullDuplex bool

    requestBodyLimitHit bool

    trailers []string

    handlerDone atomic.Bool

    // Buffers for Date, Content-Length, and status code
    dateBuf   [len(TimeFormat)]byte
    clenBuf   [10]byte
    statusBuf [3]byte

    // closeNotifyCh is the channel returned by CloseNotify.
    // It is lazily allocated by CloseNotify.
    closeNotifyCh  chan bool
    didCloseNotify atomic.Bool
}
```

The write path is a sandwich:

```
handler ─Write─▶  response.w (bufio.Writer)
                       │
                       ▼
                  chunkWriter (response.cw)
                       │
                       ▼
                  conn.bufw (bufio.Writer)
                       │
                       ▼
                  checkConnErrorWriter{conn}
                       │
                       ▼
                  conn.rwc (net.Conn)
```

Two layers of `bufio.Writer` look redundant; they are not.

- `response.w` is the **handler-facing** buffer. Default size:
  `bufferBeforeChunkingSize = 4 << 10`. It exists so that small writes inside
  the handler get coalesced before any chunk framing happens. Critically,
  while `response.w` has bytes buffered, the headers may not yet have been
  written — the server defers the status line and headers as long as
  possible so that things like `Content-Type` sniffing can run on the actual
  body bytes.
- `chunkWriter` is the framer. It writes the headers exactly once on the
  first flush, then either writes raw bytes (with Content-Length already
  known) or chunked-encoding-framed bytes.
- `conn.bufw` is the **connection-level** buffer that writes to the socket.
  It is owned by the conn, reused across requests.

`chunkWriter.Write` is where the response headers get materialized:

```go
// net/http/server.go (around line 379)
func (cw *chunkWriter) Write(p []byte) (n int, err error) {
    if !cw.wroteHeader {
        cw.writeHeader(p)
    }
    if cw.res.req.Method == "HEAD" {
        // Eat writes.
        return len(p), nil
    }
    if cw.chunking {
        _, err = fmt.Fprintf(cw.res.conn.bufw, "%x\r\n", len(p))
        if err != nil {
            cw.res.conn.rwc.Close()
            return
        }
    }
    n, err = cw.res.conn.bufw.Write(p)
    if cw.chunking && err == nil {
        _, err = cw.res.conn.bufw.Write(crlf)
    }
    if err != nil {
        cw.res.conn.rwc.Close()
    }
    return
}
```

`writeHeader` does content-type sniffing on the very first chunk of body
bytes, decides on chunked vs Content-Length transfer, formats the status
line and headers, and writes them to `conn.bufw`. Subsequent writes skip
that path.

`checkConnErrorWriter` (around line 3573) records the first write error to
`c.werr` so the conn-level code can decide whether to attempt further writes
or just abandon. It is read by `finishRequest` to know whether to bother
flushing.

## 7. Keep-alive

In the for loop in `(*conn).serve`, the post-handler section is the keep
alive decision:

```go
w.finishRequest()
c.rwc.SetWriteDeadline(time.Time{})
if !w.shouldReuseConnection() {
    if w.requestBodyLimitHit || w.closedRequestBodyEarly() {
        c.closeWriteAndWait()
    }
    return
}
c.setState(c.rwc, StateIdle, runHooks)
c.curReq.Store(nil)

if !w.conn.server.doKeepAlives() {
    return
}

if d := c.server.idleTimeout(); d != 0 {
    c.rwc.SetReadDeadline(time.Now().Add(d))
} else {
    c.rwc.SetReadDeadline(time.Time{})
}
if _, err := c.bufr.Peek(4); err != nil {
    return
}
c.rwc.SetReadDeadline(time.Time{})
```

`shouldReuseConnection` checks: did the response complete cleanly, was
`Connection: close` requested, was the body fully drained or drainable, was
there a write error, was the protocol HTTP/1.0 without keep-alive? If any of
those say "do not reuse," the loop exits and the deferred `c.close()` runs.

If reuse is possible, the goroutine **stays alive** and loops back. The same
`bufr`, `bufw`, `connReader`, and conn-level context are reused. This is
critical for performance: a single TCP connection can serve thousands of
requests, all on the same goroutine, with the same buffers pulled from
`sync.Pool` once.

`bufr.Peek(4)` is the gate. It blocks until either four bytes arrive (start
of a new request) or the idle deadline fires (returns an error and we exit).
If `IdleTimeout` is zero, the server falls back to `ReadTimeout` for the
idle wait, which is generally not what users want — hence the explicit
`SetReadDeadline(time.Time{})` to clear the deadline if no `IdleTimeout` is
set, and then a re-set after a single byte arrives.

The pattern of "set deadline, peek, clear deadline, then readRequest" is
why an idle connection times out at `IdleTimeout` rather than `ReadTimeout`,
but once any byte of the next request arrives, the `ReadHeaderTimeout`
deadline applies to the rest of the header. Without this dance, a long
`ReadTimeout` would let idle connections camp on file descriptors.

## 8. Contexts

There are three contexts in play. They are nested:

- **Base context** — derived from `srv.BaseContext(listener)` if set, else
  `context.Background()`. Built once per `Serve` call. Has `ServerContextKey`
  set to the server.
- **Connection context** — for each accepted conn:
  - The base context is passed through `srv.ConnContext(ctx, rwc)` if set.
  - In `(*conn).serve`, `ctx = context.WithValue(ctx,
    LocalAddrContextKey, c.rwc.LocalAddr())` is added.
  - Then `ctx, cancelCtx := context.WithCancel(ctx)`; `c.cancelCtx =
    cancelCtx`.
  - The `defer cancelCtx()` runs when the conn-level serve function
    returns, propagating cancellation to every request that derived from
    this context.
- **Request context** — in `readRequest`, `ctx, cancelCtx :=
  context.WithCancel(ctx)` is called with the connection context as parent.
  `req.ctx = ctx`. `cancelCtx` is stored in `w.cancelCtx`. After the
  handler returns, the conn-level loop calls `w.cancelCtx()` to release
  request-scoped resources promptly.

The disconnect watchdog is `(*connReader).backgroundRead` — discussed
earlier. When a read on the socket returns any non-Timeout error,
`handleReadError` calls `cr.conn.cancelCtx()`, which cancels the connection
context. Every request derived from it sees `<-ctx.Done()` fire.

There is also a per-response `closeNotifyCh`, exposed by `(w).CloseNotify()`.
Modern handlers should use `r.Context().Done()` instead, but the channel
remains for compatibility:

```go
// net/http/server.go (around line 2225)
func (w *response) CloseNotify() <-chan bool {
    if w.handlerDone.Load() {
        panic("net/http: CloseNotify called after ServeHTTP finished")
    }
    w.closeNotifyCh = make(chan bool, 1) // wait, this would race; in fact it is lazily set once.
    // ... (the real code uses a sync.Once-ish pattern; see source)
    return w.closeNotifyCh
}
```

(The actual implementation uses `didCloseNotify` atomic and `startBackgroundRead`
to register the notify path.) Both paths share the same underlying mechanism:
the background read on the socket noticing EOF or error.

## 9. Timeouts

`net/http`'s timeouts are read/write deadlines on the `net.Conn`, not separate
timer goroutines. The four timeouts and where they apply:

- **`ReadHeaderTimeout`** — bounds the time from accepting the connection
  (or the previous request finishing) to receiving the complete request
  headers. Set in `readRequest` via
  `c.rwc.SetReadDeadline(hdrDeadline)` before the header read. Cleared once
  the headers are fully read; the deadline is then advanced to the whole
  request deadline or zero.
- **`ReadTimeout`** — bounds the time for the entire request, including the
  body. Set as `wholeReqDeadline` after `ReadHeaderTimeout` expires (if
  separate from it). If `ReadHeaderTimeout` is unset, `ReadTimeout` plays
  both roles, and `readRequest` uses `ReadTimeout` as the header deadline
  too.
- **`WriteTimeout`** — bounds the time from header completion to the end of
  the response. Applied as a `defer` inside `readRequest`:

```go
if d := c.server.WriteTimeout; d > 0 {
    defer func() {
        c.rwc.SetWriteDeadline(time.Now().Add(d))
    }()
}
```

  The `defer` runs after `readRequest` returns, so the deadline is set just
  before the handler runs. Every write on `conn.rwc` is bounded by this
  deadline. If the handler is slow to write, the next `Write` returns
  `i/o timeout` and the response goes unfinished (and the conn is closed).
- **`IdleTimeout`** — bounds the time a keep-alive connection sits between
  requests. Applied right after the keep-alive `setState(StateIdle)`:

```go
if d := c.server.idleTimeout(); d != 0 {
    c.rwc.SetReadDeadline(time.Now().Add(d))
}
```

  If `IdleTimeout` is zero, `ReadTimeout` is used as a fallback (via
  `idleTimeout()` which checks both fields). Once a byte arrives, the
  deadline is cleared and the next `readRequest` runs.

Why deadlines and not timer goroutines? Two reasons:

1. The kernel already implements per-socket timers via `SO_RCVTIMEO` /
   `SO_SNDTIMEO`. Setting a deadline is a single syscall; tracking it in
   userspace would require a `time.AfterFunc` and a goroutine per timeout
   per connection.
2. Deadlines are naturally relative to the kernel's view of socket activity.
   A timer goroutine would race with the read syscall completing.

The cost: there is no graceful "cancel" path. If `WriteTimeout` fires, the
handler is not notified by `r.Context()`; the next `Write` simply returns
an error. Handlers that want graceful cancellation should still use
`r.Context()`, which is cancelled by the disconnect watchdog but not by
the deadline timers.

## 10. The `ConnState` callback

`Server.ConnState` is an optional function called on state transitions. The
helper `setState` does the work:

```go
// net/http/server.go (around line 1865)
func (s *Server) setState(nc net.Conn, state ConnState, runHook bool) {
    srv := s
    switch state {
    case StateNew:
        srv.trackConn(nc, true)
    case StateHijacked, StateClosed:
        srv.trackConn(nc, false)
    }
    if state > 0xff || state < 0 {
        panic("internal error")
    }
    packedState := uint64(time.Now().Unix()<<8) | uint64(state)
    nc.(*conn).curState.Store(packedState)
    if !runHook {
        return
    }
    if hook := srv.ConnState; hook != nil {
        hook(nc, state)
    }
}
```

Wait — that signature does not match. Let us look at how it is actually
called. In `(*conn).serve` the call is `c.setState(c.rwc, StateActive,
runHooks)`. So the `nc` argument is the underlying `net.Conn` from the
listener, which the hook receives. The `nc.(*conn)` cast looks suspicious;
the real code stores the packed state on the conn itself (not via cast):

```go
// (paraphrased; check src for exact form)
func (c *conn) setState(nc net.Conn, state ConnState, runHook bool) {
    srv := c.server
    switch state {
    case StateNew:
        srv.trackConn(c, true)
    case StateHijacked, StateClosed:
        srv.trackConn(c, false)
    }
    packedState := uint64(time.Now().Unix()<<8) | uint64(state)
    c.curState.Store(packedState)
    if !runHook {
        return
    }
    if hook := srv.ConnState; hook != nil {
        hook(nc, state)
    }
}
```

The five states and their transitions:

- `StateNew` — fired immediately after accept, before `go c.serve`. The
  hook runs on the listener goroutine.
- `StateActive` — fired in `(*conn).serve` once the first byte of a request
  has been read. The hook runs on the conn goroutine.
- `StateIdle` — fired after `finishRequest`, when keep-alive is keeping the
  conn for the next request. The hook runs on the conn goroutine.
- `StateHijacked` — fired from `(*response).Hijack` (or for h2 ALPN). The
  hook runs on whatever goroutine called `Hijack`.
- `StateClosed` — fired from the deferred close path in `(*conn).serve`.
  The hook runs on the conn goroutine, just before the goroutine returns.

`runHook` is `skipHooks` for the ALPN h2 transition (since the h2 stack is
about to take over; the user already saw the conn move to `StateActive` and
the next state is `StateHijacked`).

There is a subtle ordering rule: the hook is called **after** the packed
state has been stored. So if your hook reads `curState` it sees the new
value. Also, the hook can block; if it does, the conn goroutine blocks.
Hooks must not call back into the server (`Shutdown`, etc.) on the same
goroutine — they will deadlock against `mu`.

## 11. Shutdown

`(*Server).Shutdown` is the cooperative drain path:

```go
// net/http/server.go (around line 3000)
func (srv *Server) Shutdown(ctx context.Context) error {
    srv.inShutdown.Store(true)

    srv.mu.Lock()
    lnerr := srv.closeListenersLocked()
    for _, f := range srv.onShutdown {
        go f()
    }
    srv.mu.Unlock()
    srv.listenerGroup.Wait()

    pollIntervalBase := time.Millisecond
    nextPollInterval := func() time.Duration {
        interval := pollIntervalBase + time.Duration(rand.Intn(int(pollIntervalBase/10)))
        pollIntervalBase *= 2
        if pollIntervalBase > shutdownPollIntervalMax {
            pollIntervalBase = shutdownPollIntervalMax
        }
        return interval
    }

    timer := time.NewTimer(nextPollInterval())
    defer timer.Stop()
    for {
        if srv.closeIdleConns() {
            return lnerr
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
            timer.Reset(nextPollInterval())
        }
    }
}
```

Steps in order:

1. `inShutdown.Store(true)` — the `Serve` loop checks this on accept errors
   and bails out. New `ServeHTTP` calls also check via `shuttingDown()`.
2. `closeListenersLocked` — closes every listener registered via
   `trackListener`. This unblocks the `Accept` call in `Serve` (which then
   sees `shuttingDown()` true and returns `ErrServerClosed`).
3. Run every `OnShutdown` callback in its own goroutine. These are fire and
   forget; if the caller wants to wait, it should use `ctx`.
4. Wait for the listener goroutines to finish via `srv.listenerGroup.Wait()`
   (a `sync.WaitGroup`).
5. Poll `closeIdleConns()` with exponential-jittered backoff. This closes
   any conn currently in `StateIdle` and returns true if all conns are now
   gone. If `ctx` fires before that, `Shutdown` returns `ctx.Err()` and
   leaves any active conns running. The caller must then `Close()` the
   server to forcibly close them.

The polling approach is a deliberate trade-off. The alternative — having
each conn signal a `doneChan` when it transitions to `StateClosed` — would
require an additional channel per conn and synchronization with `Shutdown`.
Polling with backoff (1ms, 2ms, 4ms, ..., capped at 500ms) is simpler and
in practice idle conns finish quickly under shutdown pressure.

`doneChan` does exist as a method-local construct in the listener-tracking
path:

```go
// net/http/server.go (around line 3072)
func (s *Server) getDoneChan() <-chan struct{} {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.getDoneChanLocked()
}

func (s *Server) getDoneChanLocked() chan struct{} {
    if s.doneChan == nil {
        s.doneChan = make(chan struct{})
    }
    return s.doneChan
}

func (s *Server) closeDoneChanLocked() {
    ch := s.getDoneChanLocked()
    select {
    case <-ch:
        // Already closed. Don't close again.
    default:
        close(ch)
    }
}
```

`doneChan` is closed inside `Close` (the abrupt version) and `Shutdown`. It
can be selected on by goroutines that want to know when the server is
shutting down. The `Server.getDoneChan` is exposed indirectly via the
internal `Server.closeIdleConns` polling path.

`Close` (not Shutdown) is the abrupt path: it closes listeners, closes
every conn in `activeConn` immediately, and returns. No drain.

```go
// net/http/server.go (around line 2974)
func (srv *Server) Close() error {
    srv.inShutdown.Store(true)
    srv.mu.Lock()
    defer srv.mu.Unlock()
    err := srv.closeListenersLocked()

    // Unlock srv.mu while waiting for listenerGroup.
    // The group Add and Done calls are made with srv.mu held,
    // to avoid adding a new listener in the window between
    // us setting inShutdown above and waiting here.
    srv.mu.Unlock()
    srv.listenerGroup.Wait()
    srv.mu.Lock()

    for c := range srv.activeConn {
        c.rwc.Close()
        delete(srv.activeConn, c)
    }
    return err
}
```

## 12. `activeConn` map, `mu`, `trackConn` / `deleteConn`

`Server.activeConn` is `map[*conn]struct{}` guarded by `Server.mu`. It exists
solely so `Shutdown` and `Close` can iterate over every live conn.

```go
// net/http/server.go (around line 3105)
func (s *Server) trackConn(c *conn, add bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.activeConn == nil {
        s.activeConn = make(map[*conn]struct{})
    }
    if add {
        s.activeConn[c] = struct{}{}
    } else {
        delete(s.activeConn, c)
    }
}
```

The map is touched on three transitions:

- `StateNew` (add): listener goroutine calls `trackConn(c, true)` before
  spawning `go c.serve`.
- `StateHijacked` (remove): the conn is no longer the server's
  responsibility.
- `StateClosed` (remove): the conn goroutine is exiting.

Every other state — `StateActive`, `StateIdle` — does **not** mutate the
map. Those transitions only update `curState` (atomically) and fire the
hook.

The mutex `s.mu` also guards `s.listeners`, `s.doneChan`, `s.onShutdown`,
and other server-level bookkeeping. It is **not** held during `Accept`,
during request reading, or during handler execution. Lock contention is
limited to state transitions and listener changes.

## 13. Hijack

A handler can request the raw `net.Conn` via the `Hijacker` interface:

```go
// net/http/server.go (around line 2153)
type Hijacker interface {
    Hijack() (net.Conn, *bufio.ReadWriter, error)
}

func (w *response) Hijack() (rwc net.Conn, buf *bufio.ReadWriter, err error) {
    if w.handlerDone.Load() {
        panic("net/http: Hijack called after ServeHTTP finished")
    }
    if w.wroteHeader {
        w.cw.flush()
    }

    c := w.conn
    c.mu.Lock()
    defer c.mu.Unlock()

    // Release the bufioWriter that writes to the chunk writer, it is not
    // used after a connection has been hijacked.
    rwc, buf, err = c.hijackLocked()
    if err == nil {
        putBufioWriter(w.w)
        w.w = nil
    }
    return rwc, buf, err
}

func (c *conn) hijackLocked() (rwc net.Conn, buf *bufio.ReadWriter, err error) {
    if c.hijackedv {
        return nil, nil, ErrHijacked
    }
    c.r.abortPendingRead()

    c.hijackedv = true
    rwc = c.rwc
    rwc.SetDeadline(time.Time{})

    buf = bufio.NewReadWriter(c.bufr, bufio.NewWriter(rwc))
    if c.r.hasByte {
        if _, err := c.bufr.Peek(c.bufr.Buffered() + 1); err != nil {
            return nil, nil, fmt.Errorf("unexpected Peek failure reading buffered byte: %v", err)
        }
    }
    c.setState(rwc, StateHijacked, runHooks)
    return
}
```

What ownership transfer looks like, step by step:

1. The handler calls `w.Hijack()`. The response flushes any buffered output
   so the client sees a valid HTTP response prefix (or nothing, if no
   `WriteHeader` was called).
2. `c.mu.Lock()` is taken; we are now serialized with anything that reads
   `hijackedv`.
3. `c.r.abortPendingRead()` cancels the background read goroutine if one
   was active. It sets `c.r.aborted = true` and calls
   `c.rwc.SetReadDeadline(aLongTimeAgo)` to force any pending read to
   return immediately. Then `c.cond.Wait()` blocks until the background
   goroutine has noticed and unwound. After this returns, no other
   goroutine is touching `c.rwc`.
4. `c.hijackedv = true`. From now on, `c.hijacked()` returns true. The
   deferred close in `(*conn).serve` becomes a no-op except for the panic
   recovery.
5. `c.rwc.SetDeadline(time.Time{})` clears the deadlines. The hijacker is
   on its own for timeouts.
6. A new `*bufio.ReadWriter` is built. The Reader half is `c.bufr` (so any
   bytes the server already read into the bufio reader are preserved — in
   particular the byte buffered by the background read, if any). The
   Writer half is a fresh `bufio.NewWriter` on the raw conn (the
   chunk-writer wrapping is shed).
7. `setState(StateHijacked)` fires, which removes the conn from
   `activeConn` and runs the `ConnState` hook.

After `Hijack` returns, the handler can use the `net.Conn` however it
likes — typically for WebSocket upgrade, raw TCP forwarding, or custom
protocols. The conn-level serve goroutine still exists; it is in the middle
of running the handler. When the handler returns, the serve goroutine
exits via:

```go
if c.hijacked() {
    return
}
```

and the deferred close skips closing `c.rwc` (the hijacker owns it now)
but still calls `c.r.cond.Broadcast()` etc. to unblock anything left.

The hijacker is responsible for closing `rwc`. The server will not.

## Putting it together — one full request, one diagram

Goroutines involved in a single keep-alive request, with no Hijack:

```
[listener goroutine]                 [conn goroutine]            [bg read goroutine]
     │                                     │                              │
     │ Accept ───────────────▶ rwc        │                              │
     │ newConn + setState(New) ───────────▶                              │
     │ trackConn(add)                      │                              │
     │ go c.serve ─────────────────────────▶                              │
     │                                     │ TLS handshake (if TLS)       │
     │                                     │ build connCtx (WithCancel)   │
     │ ◀── ready for next Accept           │                              │
     │                                     │ for { ...                    │
     │                                     │   readRequest                │
     │                                     │   setReadDeadline(hdr)       │
     │                                     │   read request bytes         │
     │                                     │   setReadDeadline(whole)     │
     │                                     │   build response, reqCtx     │
     │                                     │   setState(Active) ────────▶ ConnState hook
     │                                     │   startBackgroundRead ──────▶ go backgroundRead
     │                                     │                              │ Read(byteBuf) (blocks)
     │                                     │   serverHandler.ServeHTTP    │
     │                                     │   ...handler runs...         │
     │                                     │   handler.Write              │
     │                                     │   response.w.Flush ──▶ cw.Write ──▶ writeHeader, framing
     │                                     │   ▶ conn.bufw.Write ──▶ rwc.Write (with WriteDeadline)
     │                                     │   handler returns            │
     │                                     │   w.cancelCtx() (cancels reqCtx)
     │                                     │   w.finishRequest (drain body, flush)
     │                                     │   setState(Idle) ─────────▶ ConnState hook
     │                                     │                              │
     │                                     │   setReadDeadline(idle)      │
     │                                     │   bufr.Peek(4) (blocks)      │
     │                                     │                              │ Read returns EOF (client closed)
     │                                     │                              │ handleReadError ──▶ c.cancelCtx (connCtx)
     │                                     │   bufr.Peek returns err      │
     │                                     │   loop exit                  │
     │                                     │   defer: c.close + setState(Closed)
     │                                     │   trackConn(remove)
     │                                     │   ConnState hook (Closed)
```

A keep-alive sequence with N requests on one conn means the inner for-loop
section repeats N times. The same goroutine, the same buffers, the same
connection context. Only `bufr`, `bufw`, and `connReader` are reused;
`response` and request context are fresh per request.

## Numbers worth remembering

- `bufferBeforeChunkingSize` = 4 KiB. Handler writes are coalesced up to
  this before any framing happens.
- `initialReadLimitSize` = `MaxHeaderBytes` if set on the server, else
  `DefaultMaxHeaderBytes` = 1 MiB. This is the maximum total header size.
- Accept backoff: starts at 5ms, doubles, caps at 1s.
- Shutdown poll: starts at 1ms with jitter, doubles, caps at 500ms
  (`shutdownPollIntervalMax`).
- TLS handshake deadline default: `srv.tlsHandshakeTimeout()` returns
  `ReadHeaderTimeout` if set else `ReadTimeout` if set else 0 (no
  timeout).
- The `byteBuf` in `connReader` is 1 byte. Just enough to detect the next
  pipelined byte or a disconnect.

## Edge cases the source handles

A few cases that the source explicitly accounts for and that affect the
concurrency story.

### Concurrent Body.Read

The `connReader` panics if you start a background read while a foreground
read is in progress:

```go
if cr.inRead {
    cr.unlock()
    panic("invalid concurrent Body.Read call")
}
```

This catches handlers that pass `r.Body` to another goroutine that races
the per-conn loop's body-drain. The mutex in `*body` plus this guard make
the assertion enforced.

### Pipelined request with byte already buffered

If `c.r.hasByte` is true when we return from `Hijack` or proceed to the next
request, that byte was peeked by the background read. `readRequest` and
`Hijack` both account for it via `bufr.Peek` / discard, ensuring the byte is
not lost.

### Connection close after a long-running handler returns

When the handler is still running and the client disconnects, the
background read returns EOF. `handleReadError` calls
`cr.conn.cancelCtx()` which is the **connection** cancel function. This
cancels the connection context, which cascades to the request context (a
child). The handler observes `r.Context().Done()` firing. The conn loop
still waits for the handler to return before doing anything else; it does
not preempt.

If the handler is unaware of context and keeps writing, the next `Write`
will likely fail because either the kernel TCP buffer has been reset by the
peer (RST), or `WriteTimeout` fires. The error is captured by
`checkConnErrorWriter.werr` and `finishRequest` notices the connection is
toast.

### Hijack while body is being read

`(*conn).Hijack` calls `c.r.abortPendingRead()`. If the body reader was
mid-Read (i.e., `connReader.inRead == true`), `abortPendingRead` sets a
read deadline in the past on `rwc`, which causes the in-flight read to
return immediately with a Timeout error. The reader then drops its
reference; the new owner gets fresh reads.

```go
// net/http/server.go (around line 711)
func (cr *connReader) abortPendingRead() {
    cr.lock()
    if !cr.inRead {
        cr.unlock()
        return
    }
    cr.aborted = true
    cr.conn.rwc.SetReadDeadline(aLongTimeAgo)
    for cr.inRead {
        cr.cond.Wait()
    }
    cr.conn.rwc.SetReadDeadline(time.Time{})
    cr.unlock()
}
```

`aLongTimeAgo` is `time.Unix(1, 0)`. `Cond.Wait` re-acquires the lock on
return, so the function unlocks safely.

### ALPN to HTTP/2

If the TLS handshake negotiates `h2`, `(*conn).serve` does not enter the
HTTP/1.x for-loop. Instead it looks up `TLSNextProto["h2"]` (set up by
`setupHTTP2_Serve` which calls `http2.ConfigureServer`). The result is a
function that takes over the conn. From net/http's perspective, the conn
becomes Hijacked. The HTTP/2 stack runs its own framing loop, per-stream
handler goroutines, and so on. The h2 server inside `golang.org/x/net/http2`
spawns one goroutine per stream and one for the connection framing; we will
not dive into that here.

### CloseIdleConns called from outside Shutdown

`Server.CloseIdleConns` is public. It can be invoked at any time. It walks
`activeConn` under `s.mu`, finds entries in `StateIdle`, and closes them.
The conn goroutine sees the read fail and exits naturally. There is no need
to message the conn goroutine; the socket close is the message.

## The data model, summarized

The net/http server uses a small number of synchronization primitives:

- `Server.mu sync.Mutex` — for the listener set, active conn set, doneChan,
  onShutdown slice. Held briefly.
- `Server.inShutdown atomic.Bool` — read on the hot path of `Serve` (accept
  error branch) and `ServeHTTP` checks; no lock.
- `Server.listenerGroup sync.WaitGroup` — tracks listener goroutines for
  `Shutdown` / `Close` to wait on.
- `conn.mu sync.Mutex` — guards `hijackedv` only.
- `conn.curState atomic.Uint64` — packed state + timestamp.
- `conn.curReq atomic.Pointer[response]` — set per request; read by hooks.
- `connReader.mu sync.Mutex` + `connReader.cond *sync.Cond` — guard
  in-progress / pending read flags.
- `expectContinueReader.closed / sawEOF atomic.Bool` and
  `response.writeContinueMu sync.Mutex` — 100-continue coordination.
- `response.handlerDone atomic.Bool` — set in `finishRequest`; read by
  `CloseNotify` to enforce that you cannot register a CloseNotify channel
  after the handler returned.

Goroutines per conn at any moment:

- 1 conn goroutine (always, until close).
- 0 or 1 background read goroutines (started after a request body hits EOF
  or before the handler if there was no body; stopped by `abortPendingRead`
  or `handleReadError`).
- 0 to N user-spawned goroutines from inside the handler. These are not
  tracked by net/http; the handler owns them.

Goroutines per server:

- 1 listener goroutine per call to `Serve` / `ServeTLS`.
- Per-conn goroutines as above.
- 0 to N goroutines from `OnShutdown` hooks when shutting down.

That is the entire concurrent footprint. The minimal accounting is
deliberate: net/http leans on the OS for what the OS can do (socket
deadlines, blocking reads), and uses goroutines only where Go is
clearly the right tool (handler dispatch, disconnect watchdog).

## Reading the source yourself

A few practical tips when you open the file:

- The `(*conn).serve` function is long. Skim past the TLS branch on a
  first read; come back to it when you care about ALPN.
- The for loop is the model. Everything past `c.r = &connReader{...}` is
  the per-request body, executed once per pipelined request on the conn.
- `bufio.Pool` helpers (`newBufioReader`, `newBufioWriterSize`,
  `putBufioReader`, `putBufioWriter`) live near the bottom of the file
  (around line 855). They use a per-size `sync.Pool`. This is a major
  reason why net/http has low allocation under steady load.
- `(*response).finishRequest` (around line 1690) is worth reading. It
  flushes `response.w`, calls `cw.close()`, drains the request body up to
  some limit, and flushes `conn.bufw`. The body-drain is what makes
  keep-alive correct: if the handler did not read the body, the server
  must consume it (or close) before another request can be read off the
  same socket.

For an even deeper view, follow these into the rest of the package:

- `net/http/transfer.go` — `readTransfer`, the `body` type, the
  chunked-encoding read path.
- `net/http/h2_bundle.go` (or `golang.org/x/net/http2` upstream) — the
  HTTP/2 server, which has its own concurrency model.
- `net/http/request.go` — `readRequest`, header parsing.
- `internal/textproto` — header reading at the syntactic level.

## What you should now be able to answer

If you understood the above, you can answer these without re-reading:

- Why does an HTTP/1.x server have at least one goroutine per active TCP
  connection?
- What goroutine cancels `r.Context()` when the client disconnects? When
  exactly does it detect the disconnect?
- Why does `WriteTimeout` not surface as a context cancellation?
- What happens to the conn-level buffers when keep-alive reuses a
  connection? When the conn closes?
- How does `Shutdown` know it is done?
- Why does net/http maintain `activeConn` as a map rather than a counter?
- What ownership invariants does `Hijack` enforce?
- What does `StateActive` mean exactly, in terms of when it fires?

Each of these can be answered with a citation to a specific function and
line range in `net/http/server.go`. That is the level of comfort the
intermediate tier aims for; the professional tier (next page) goes into
allocation budgets, syscall counts per request, the http2 server's stream
fan-out, and how to instrument all of it.

[← Back](../)
