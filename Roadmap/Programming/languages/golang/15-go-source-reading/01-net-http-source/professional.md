# `net/http` Source Walkthrough — Professional

> Focus: read the actual Go 1.22+ standard-library source — `src/net/http/server.go`, `transport.go`, `request.go`, `h2_bundle.go` — and follow one request through every layer. Not a tutorial on `http.HandleFunc`; a tour of the functions, the calls they make, and the contract boundaries between them. Excerpts are simplified; paths and function names are the stable anchors across releases.

---

## 0. Reading order

The HTTP code is ~25 000 lines across ~30 files. Top-down is hopeless; read along the request path.

1. `src/net/http/server.go` — `Server`, `conn`, `response`, `serverHandler`, `ServeMux`.
2. `src/net/http/request.go` — `readRequest`, body construction.
3. `src/net/http/transfer.go` — `transferReader`/`transferWriter`, chunked vs content-length state.
4. `src/net/http/client.go` — `Client.do`, redirect handling.
5. `src/net/http/transport.go` — `Transport`, `getConn`, `persistConn`, idle pool.
6. `src/net/http/h2_bundle.go` — bundled `golang.org/x/net/http2`; ALPN upgrade.
7. `src/net/http/httputil/reverseproxy.go` — director, hop-by-hop stripping.
8. `src/net/http/internal/chunked.go`, `internal/ascii/print.go` — primitives.
9. `src/net/http/cookiejar/jar.go` — `Client.Jar` semantics.

Open with `go doc` and `git log -p` alongside. The history is full of fix-this-CVE commits that explain why specific checks exist.

---

## 1. `Server.Serve` — the accept loop

`ListenAndServe` opens the listener and delegates to `Serve`.

```go
// from net/http/server.go, simplified
func (srv *Server) Serve(l net.Listener) error {
    l = &onceCloseListener{Listener: l}
    defer l.Close()
    if err := srv.setupHTTP2_Serve(); err != nil { return err }
    if !srv.trackListener(&l, true) { return ErrServerClosed }
    defer srv.trackListener(&l, false)

    ctx := context.WithValue(context.Background(), ServerContextKey, srv)
    var tempDelay time.Duration
    for {
        rw, err := l.Accept()
        if err != nil {
            if srv.shuttingDown() { return ErrServerClosed }
            if ne, ok := err.(net.Error); ok && ne.Temporary() {
                if tempDelay == 0 { tempDelay = 5 * time.Millisecond } else { tempDelay *= 2 }
                if tempDelay > time.Second { tempDelay = time.Second }
                srv.logf("http: Accept error: %v; retrying in %v", err, tempDelay)
                time.Sleep(tempDelay); continue
            }
            return err
        }
        tempDelay = 0
        c := srv.newConn(rw)
        c.setState(c.rwc, StateNew, runHooks)
        go c.serve(ctx)
    }
}
```

Three things to notice. **`tempDelay` is exponential backoff capped at one second**, triggered only on `net.Error` with `Temporary() == true` — classic `EMFILE` recovery. **`ErrServerClosed` is the sentinel** returned both on `Shutdown` and `Close`. **Every connection runs in its own goroutine** — no built-in connection limit, that's a deliberate design choice (you put limits in front, e.g. `netutil.LimitListener`). `setupHTTP2_Serve` is the entry to the HTTP/2 bundled code (§11).

---

## 2. `conn.serve` — per-connection lifecycle

```go
// from net/http/server.go, simplified
func (c *conn) serve(ctx context.Context) {
    c.remoteAddr = c.rwc.RemoteAddr().String()
    ctx = context.WithValue(ctx, LocalAddrContextKey, c.rwc.LocalAddr())
    var inFlightResponse *response
    defer func() {
        if err := recover(); err != nil && err != ErrAbortHandler {
            buf := make([]byte, 64<<10); buf = buf[:runtime.Stack(buf, false)]
            c.server.logf("http: panic serving %v: %v\n%s", c.remoteAddr, err, buf)
        }
        if inFlightResponse != nil { inFlightResponse.cancelCtx() }
        if !c.hijacked() { c.close(); c.setState(c.rwc, StateClosed, runHooks) }
    }()

    if tlsConn, ok := c.rwc.(*tls.Conn); ok {
        if tlsTO := c.server.tlsHandshakeTimeout(); tlsTO > 0 {
            dl := time.Now().Add(tlsTO)
            c.rwc.SetReadDeadline(dl); c.rwc.SetWriteDeadline(dl)
        }
        if err := tlsConn.HandshakeContext(ctx); err != nil { return }
        c.tlsState = new(tls.ConnectionState); *c.tlsState = tlsConn.ConnectionState()
        if proto := c.tlsState.NegotiatedProtocol; validNextProto(proto) {
            if fn := c.server.TLSNextProto[proto]; fn != nil {
                h := initALPNRequest{ctx, tlsConn, serverHandler{c.server}}
                fn(c.server, tlsConn, h) // hand off to HTTP/2
            }
            return
        }
    }

    ctx, cancelCtx := context.WithCancel(ctx); c.cancelCtx = cancelCtx; defer cancelCtx()
    c.r = &connReader{conn: c}
    c.bufr = newBufioReader(c.r)
    c.bufw = newBufioWriterSize(checkConnErrorWriter{c}, 4<<10)

    for {
        w, err := c.readRequest(ctx)
        if err != nil { return } // 400 / read deadline / close
        inFlightResponse = w
        serverHandler{c.server}.ServeHTTP(w, w.req)
        inFlightResponse = nil
        w.cancelCtx()
        if c.hijacked() { return }
        w.finishRequest()
        if !w.shouldReuseConnection() { return }
        c.setState(c.rwc, StateIdle, runHooks)
        if !w.conn.server.doKeepAlives() { return }
        if d := c.server.idleTimeout(); d != 0 { c.rwc.SetReadDeadline(time.Now().Add(d)) }
        if _, err := c.bufr.Peek(4); err != nil { return }
        c.rwc.SetReadDeadline(time.Time{})
    }
}
```

The for-loop is the **keep-alive loop**: parse one request, dispatch, flush, then `Peek(4)` blocks until next request bytes arrive so the server doesn't sit on a tight deadline during idle keepalive. `IdleTimeout` is enforced via `SetReadDeadline` on the post-flush path.

The `recover` block is the **handler panic firewall** — any panic except `ErrAbortHandler` is logged with stack and the connection torn down. `ErrAbortHandler` is the documented opt-out.

ALPN is handled inline: if TLS negotiated `h2`, hand the connection to `TLSNextProto["h2"]`, set by `setupHTTP2_Serve` to drive the HTTP/2 frame loop.

---

## 3. `readRequest` — wire to `*Request`

In `request.go`, `readRequest` is built around `textproto.Reader`:

```go
// from net/http/request.go, simplified
func readRequest(b *bufio.Reader) (req *Request, err error) {
    tp := newTextprotoReader(b)
    defer putTextprotoReader(tp)
    req = new(Request)

    s, err := tp.ReadLine()
    if err != nil { return nil, err }
    var ok bool
    req.Method, req.RequestURI, req.Proto, ok = parseRequestLine(s)
    if !ok || !validMethod(req.Method) { return nil, badStringError("malformed", s) }
    if req.ProtoMajor, req.ProtoMinor, ok = ParseHTTPVersion(req.Proto); !ok {
        return nil, badStringError("bad version", req.Proto)
    }

    rawurl := req.RequestURI
    justAuthority := req.Method == "CONNECT" && !strings.HasPrefix(rawurl, "/")
    if justAuthority { rawurl = "http://" + rawurl }
    if req.URL, err = url.ParseRequestURI(rawurl); err != nil { return nil, err }
    if justAuthority { req.URL.Scheme = "" }

    mimeHeader, err := tp.ReadMIMEHeader()
    if err != nil { return nil, err }
    req.Header = Header(mimeHeader)
    if len(req.Header["Host"]) > 1 { return nil, fmt.Errorf("too many Host headers") }
    req.Host = req.URL.Host
    if req.Host == "" { req.Host = req.Header.get("Host") }
    req.Close = shouldClose(req.ProtoMajor, req.ProtoMinor, req.Header, false)

    if err = readTransfer(req, b); err != nil { return nil, err }
    return req, nil
}
```

Key details: `ReadMIMEHeader` enforces `MaxHeaderBytes` (default 1 MB). `CONNECT` uses authority form (`host:port`) instead of path; the code synthesises a fake `http://` scheme so `url.ParseRequestURI` works, then strips it. Duplicate `Host` is rejected per RFC 7230 §5.4. `readTransfer` (in `transfer.go`) decides `Content-Length` vs `Transfer-Encoding: chunked` and wires `req.Body` to one of:

- `http.NoBody` — methods without a body, absent `Content-Length`.
- `*body{Reader: &io.LimitedReader{R: bufr, N: contentLength}}` — content-length.
- `*body{Reader: internal.NewChunkedReader(bufr)}` — chunked.
- `*body{Reader: bufr, closing: true}` — HTTP/1.0 close-delimited.

The `*body` wrapper implements `Close()` correctly — draining unread bytes off the wire if the handler ignored them so the connection can be reused.

---

## 4. `response` — building the reply

`response` (lowercase) is the concrete `http.ResponseWriter` for HTTP/1.x.

```go
// from net/http/server.go, simplified
type response struct {
    conn          *conn
    req           *Request
    wroteHeader   bool
    w             *bufio.Writer  // buffers output into cw
    cw            chunkWriter    // chunks (or content-lengths) into conn.bufw
    handlerHeader Header
    written       int64
    contentLength int64 // -1 if unknown
    status        int
    closeAfterReply bool
    trailers      []string
}
```

Writer chain: `handler.Write(b)` → `response.Write` → `response.w` (bufio) → `response.cw` → `c.bufw` → `c.rwc` (TCP). `WriteHeader` and `Write` interact via the **deferred header send**: calling `Write` without `WriteHeader` triggers `WriteHeader(200)`. The header isn't actually written until `cw.writeHeader` flushes — giving bufio a chance to *measure* the body and emit `Content-Length` instead of chunked for small responses.

```go
// from net/http/server.go, simplified
func (cw *chunkWriter) Write(p []byte) (n int, err error) {
    if !cw.wroteHeader { cw.writeHeader(p) }
    if cw.res.req.Method == "HEAD" { return len(p), nil }
    if cw.chunking {
        fmt.Fprintf(cw.res.conn.bufw, "%x\r\n", len(p))
    }
    n, err = cw.res.conn.bufw.Write(p)
    if cw.chunking && err == nil { cw.res.conn.bufw.Write(crlf) }
    return
}
```

`writeHeader` (different from `response.WriteHeader`) is invoked **once, lazily**, with the first chunk of body data. If the handler closed cleanly without exceeding the bufio buffer, `cw.writeHeader` knows the total length and emits `Content-Length: N` — no chunked encoding. If the handler is still writing when the buffer fills, fall back to `Transfer-Encoding: chunked`. This is the **implicit Content-Length optimisation**.

`Flush()` exists to force the bufio→chunkWriter pipeline now — SSE and long-polling call it. `http.Flusher` is feature-detected via type assertion, not part of the base `ResponseWriter`.

---

## 5. `serverHandler.ServeHTTP` — dispatch

```go
// from net/http/server.go, simplified
type serverHandler struct{ srv *Server }

func (sh serverHandler) ServeHTTP(rw ResponseWriter, req *Request) {
    handler := sh.srv.Handler
    if handler == nil { handler = DefaultServeMux }
    if !sh.srv.DisableGeneralOptionsHandler && req.RequestURI == "*" && req.Method == "OPTIONS" {
        handler = globalOptionsHandler{}
    }
    handler.ServeHTTP(rw, req)
}
```

Two responsibilities. **Fall back to `DefaultServeMux` when `Server.Handler` is nil** — this is why `http.HandleFunc` works with `http.ListenAndServe(":8080", nil)`. Special-cased `OPTIONS *` for server-wide capability discovery, opted out via `DisableGeneralOptionsHandler` (Go 1.17+).

There is no `recover` here — the panic firewall lives one level up in `conn.serve`. Deliberate: ALPN-hijacked HTTP/2 connections don't go through `conn.serve`'s loop but still need panic semantics, so HTTP/2's frame-handling code has its own recover.

---

## 6. `ServeMux.Handler` — pattern routing (Go 1.22+)

Go 1.22 rewrote `ServeMux` for method-aware patterns (`GET /foo`), wildcards (`/users/{id}`), and host matching.

```go
// from net/http/server.go, simplified — Go 1.22+
func (mux *ServeMux) Handler(r *Request) (h Handler, pattern string) {
    if r.Method == "CONNECT" { return mux.handler(r.Host, r.URL.Path) }
    host := stripHostPort(r.Host)
    path := cleanPath(r.URL.Path)
    if u, ok := mux.redirectToPathSlash(host, path, r.URL); ok {
        return RedirectHandler(u.String(), StatusMovedPermanently), u.Path
    }
    if path != r.URL.Path {
        _, pattern = mux.handler(host, path)
        u := &url.URL{Path: path, RawQuery: r.URL.RawQuery}
        return RedirectHandler(u.String(), StatusMovedPermanently), pattern
    }
    return mux.handler(host, r.URL.Path)
}
```

`mux.handler` walks a routing tree built at registration. The tree is a trie of segment nodes; `match` does longest-prefix lookup with wildcard segment support.

Pattern syntax (`[METHOD ][HOST]/PATH`): `GET /foo` method-aware; `/users/{id}` single-segment wildcard exposed via `req.PathValue("id")`; `/files/{path...}` multi-segment greedy; `example.com/foo` host-restricted.

**Conflict detection at registration**: `mux.register` calls `(*pattern).conflictsWith` against every existing pattern; conflicts panic at startup (e.g. `GET /a/{x}` and `GET /a/{y}` both match `/a/1`). Fail loud at boot, not silently at request time. Trailing-slash semantics remain: `/foo/` matches the subtree, `/foo` matches only the exact path.

---

## 7. `Client.Do` — request to response

`Client.Do` handles cookies, redirects, and timeouts; the wire work is in `Transport.RoundTrip`.

```go
// from net/http/client.go, simplified
func (c *Client) do(req *Request) (*Response, error) {
    var reqs []*Request
    var resp *Response
    var redirectMethod string
    var includeBody bool
    deadline := c.deadline()
    copyHeaders := c.makeHeadersCopier(req)
    for {
        if len(reqs) >= 10 { return nil, errors.New("stopped after 10 redirects") }
        if len(reqs) > 0 {
            u, _ := req.URL.Parse(resp.Header.Get("Location"))
            ireq := reqs[0]
            req = &Request{Method: redirectMethod, Response: resp, URL: u,
                Header: make(Header), Host: ireq.Host, ctx: ireq.ctx}
            if includeBody && ireq.GetBody != nil {
                req.Body, _ = ireq.GetBody()
                req.ContentLength = ireq.ContentLength
            }
            copyHeaders(req) // strips Authorization, Cookie cross-host
            if err := c.checkRedirect(req, reqs); err == ErrUseLastResponse { return resp, nil } else if err != nil { /* ... */ }
        }
        reqs = append(reqs, req)
        var err error
        if resp, _, err = c.send(req, deadline); err != nil { return nil, err }
        var shouldRedirect bool
        redirectMethod, shouldRedirect, includeBody = redirectBehavior(req.Method, resp, reqs[0])
        if !shouldRedirect { return resp, nil }
        req.closeBody()
    }
}
```

Three responsibilities. **Redirect loop with cap of 10**, configurable via `Client.CheckRedirect`. `redirectBehavior` decides whether to keep method/body — 307/308 preserve both; 301/302/303 typically change POST to GET and drop the body. **Header sanitisation across hosts**: `copyHeaders` strips `Authorization`, `Www-Authenticate`, `Cookie`, `Cookie2` when redirecting to a different host (RFC-mandated; exploit history full of cross-host credential leaks). **Cookie jar**: `c.send` calls `c.Jar.Cookies(req.URL)` before dispatching and `c.Jar.SetCookies(req.URL, resp.Cookies())` after.

`c.send` then calls `send(req, c.transport(), deadline)`, which invokes `RoundTripper.RoundTrip(req)` — the polymorphic boundary. Default `c.transport()` is `DefaultTransport`, a `*Transport`.

---

## 8. `Transport.roundTrip` — connection acquisition

```go
// from net/http/transport.go, simplified
func (t *Transport) roundTrip(req *Request) (*Response, error) {
    t.nextProtoOnce.Do(t.onceSetNextProtoDefaults)
    ctx := req.Context()
    if req.URL == nil || req.URL.Host == "" { return nil, errors.New("http: bad request") }
    // header validation: httpguts.ValidHeaderFieldName / Value
    origReq := req
    cancelKey := cancelKey{req}
    req = setupRewindBody(req)

    if altRT := t.alternateRoundTripper(req); altRT != nil {
        if resp, err := altRT.RoundTrip(req); err != ErrSkipAltProtocol { return resp, err }
        req = origReq
    }
    for {
        select { case <-ctx.Done(): return nil, ctx.Err(); default: }
        treq := &transportRequest{Request: req, cancelKey: cancelKey}
        cm, _ := t.connectMethodForRequest(treq)
        pconn, err := t.getConn(treq, cm)
        if err != nil { return nil, err }

        var resp *Response
        if pconn.alt != nil { // HTTP/2 transparent upgrade
            resp, err = pconn.alt.RoundTrip(req)
        } else {
            resp, err = pconn.roundTrip(treq)
        }
        if err == nil { resp.Request = origReq; return resp, nil }
        if !pconn.shouldRetryRequest(req, err) { return nil, err }
        if req.GetBody != nil { newReq := *req; newReq.Body, _ = req.GetBody(); req = &newReq }
    }
}
```

The retry loop covers idempotent requests on an idle connection that closes mid-request — the "broken idle connection" case where the server closed an idle keepalive between your last response and next request, but `Transport` still had it pooled. `shouldRetryRequest` enforces idempotency: GET/HEAD/PUT/DELETE/OPTIONS retry; POST does not unless `Request.GetBody` is set, because the body may have been partially written.

`alternateRoundTripper` is the HTTP/2 hook (§11). `pconn.alt != nil` means the persistent connection was already upgraded to HTTP/2 and the request goes through `http2.Transport.RoundTrip`.

---

## 9. `persistConn` — the two-goroutine model

A `persistConn` is one pooled TCP/TLS connection with two goroutines: `readLoop` parses responses off the wire, `writeLoop` serialises requests onto the wire. They communicate with the caller via channels.

```go
// from net/http/transport.go, simplified
type persistConn struct {
    alt RoundTripper // non-nil if HTTP/2
    t        *Transport
    cacheKey connectMethodKey
    conn     net.Conn
    br       *bufio.Reader
    bw       *bufio.Writer
    reqch    chan requestAndChan // writeLoop signals readLoop via this
    writech  chan writeRequest   // roundTrip pushes here for writeLoop
    closech  chan struct{}
    mu       sync.Mutex
    closed   error
}

type requestAndChan struct {
    req        *Request
    ch         chan responseAndError
    continueCh chan<- struct{}
    callerGone <-chan struct{}
}
```

`persistConn.roundTrip` is the per-request rendezvous:

```go
// from net/http/transport.go, simplified
func (pc *persistConn) roundTrip(req *transportRequest) (*Response, error) {
    pc.t.replaceReqCanceler(req.cancelKey, pc.cancelRequest)

    writeErrCh := make(chan error, 1)
    pc.writech <- writeRequest{req, writeErrCh, nil}

    resc := make(chan responseAndError)
    pc.reqch <- requestAndChan{req: req.Request, ch: resc}

    var respHeaderTimer <-chan time.Time
    ctxDoneChan := req.Context().Done()
    for {
        select {
        case err := <-writeErrCh:
            if err != nil { return nil, err }
            if d := pc.t.ResponseHeaderTimeout; d > 0 {
                t := time.NewTimer(d); defer t.Stop()
                respHeaderTimer = t.C
            }
        case <-pc.closech:
            return nil, pc.mapRoundTripError(req, 0, pc.closed)
        case <-respHeaderTimer:
            pc.close(errTimeout); return nil, errTimeout
        case re := <-resc:
            if re.err != nil { return nil, re.err }
            return re.res, nil
        case <-ctxDoneChan:
            pc.t.cancelRequest(req.cancelKey, req.Context().Err())
            ctxDoneChan = nil
        }
    }
}
```

`writeLoop` pulls `writeRequest` from `pc.writech`, writes/flushes, signals `writeErrCh`. `readLoop` pulls `requestAndChan` from `pc.reqch`, reads the response off `pc.br`, posts to `rc.ch`. The two goroutines coordinate around `numExpectedResponses` so they don't deadlock on connection close.

The select-statement is the heart of timeout/cancellation correctness: response-header timeout, context cancel, connection close, write error, and successful response all rendezvous on one goroutine. Adding a sixth case (a new failure mode) historically breaks one of the first five.

---

## 10. Connection pool — `idleConn` and `idleLRU`

```
            idleConn   map[connectMethodKey][]*persistConn
            idleLRU    *connLRU                            (MRU -> LRU)
            idleMu     sync.Mutex                          (guards both)

            getConn(key)
              ├── pop *persistConn from idleConn[key]      (LIFO within key)
              ├── remove from idleLRU
              └── if pool empty:  dial new connection

            putOrCloseIdleConn(pc)
              ├── if Transport closed:                     pc.close
              ├── if pc.broken:                            pc.close
              ├── if MaxIdleConnsPerHost hit:              pc.close
              ├── if MaxIdleConns hit:                     evict oldest via idleLRU
              └── push to idleConn[key], idleLRU.front
```

```go
// from net/http/transport.go, simplified
func (t *Transport) tryPutIdleConn(pconn *persistConn) error {
    if t.DisableKeepAlives || t.MaxIdleConnsPerHost < 0 { return errKeepAlivesDisabled }
    if pconn.isBroken() { return errConnBroken }
    pconn.markReused()
    t.idleMu.Lock(); defer t.idleMu.Unlock()

    if q, ok := t.idleConnWait[pconn.cacheKey]; ok {
        // Hand off directly to a goroutine waiting in getConn.
        for q.len() > 0 {
            w := q.popFront()
            if w.tryDeliver(pconn, nil) { return nil }
        }
    }
    idles := t.idleConn[pconn.cacheKey]
    if len(idles) >= t.maxIdleConnsPerHost() { return errTooManyIdleHost }
    t.idleConn[pconn.cacheKey] = append(idles, pconn)
    t.idleLRU.add(pconn)
    if t.MaxIdleConns != 0 && t.idleLRU.len() > t.MaxIdleConns {
        oldest := t.idleLRU.removeOldest()
        oldest.close(errTooManyIdle); t.removeIdleConnLocked(oldest)
    }
    if t.IdleConnTimeout > 0 {
        if pconn.idleTimer != nil { pconn.idleTimer.Reset(t.IdleConnTimeout) }
        else { pconn.idleTimer = time.AfterFunc(t.IdleConnTimeout, pconn.closeConnIfStillIdle) }
    }
    return nil
}
```

The handoff to waiters before pushing to the LRU is the **wait-queue optimisation**: if another goroutine is in `getConn` blocked on `idleConnCh`, give it this connection directly — saves a wake-up.

`IdleConnTimeout` is Go's equivalent of `keepalive_timeout` (default 90 s). `MaxIdleConnsPerHost` defaults to **2**, which is the single biggest config trap in production Go HTTP clients — services with many backends usually want 100+.

---

## 11. HTTP/2 transparent upgrade

`net/http` ships a bundled copy of `golang.org/x/net/http2` as `h2_bundle.go`. Integration is via two hooks: `Server.TLSNextProto` and `Transport.TLSNextProto`, both populated by `setupHTTP2_Serve` / `Transport.onceSetNextProtoDefaults` unless the user has set them.

```go
// from net/http/server.go, simplified
func http2ConfigureServer(s *Server, conf *http2Server) error {
    if s.TLSNextProto == nil { s.TLSNextProto = map[string]func(*Server, *tls.Conn, Handler){} }
    s.TLSNextProto["h2"] = func(hs *Server, c *tls.Conn, h Handler) {
        conf.ServeConn(c, &http2ServeConnOpts{Handler: h, BaseConfig: hs})
    }
    return nil
}
```

**Server flow**: ALPN negotiates `h2`, `conn.serve` invokes `TLSNextProto["h2"]`, which calls `http2.Server.ServeConn` on the existing TLS connection. From that point everything is HTTP/2 — frames, streams, HPACK, flow control — entirely inside `h2_bundle.go`.

**Client flow**: `Transport.dialConn` checks `tlsConn.ConnectionState().NegotiatedProtocol == "h2"` after handshake; if so, calls `t.TLSNextProto["h2"](authority, tlsConn)`, which returns an `*http2.ClientConn`. The `*persistConn` is marked with `alt != nil` and `roundTrip` delegates to the HTTP/2 transport.

The bundle is *identical* to external `golang.org/x/net/http2` with symbols prefixed `http2` to avoid collisions when both compile into one binary. Read the external package — easier to navigate.

---

## 12. `httputil.ReverseProxy` — production reverse proxy

`ReverseProxy.ServeHTTP` is ~150 lines in `httputil/reverseproxy.go`. Every line is the result of a CVE or RFC compliance bug.

```go
// from net/http/httputil/reverseproxy.go, simplified
func (p *ReverseProxy) ServeHTTP(rw ResponseWriter, req *Request) {
    transport := p.Transport
    if transport == nil { transport = DefaultTransport }
    outreq := req.Clone(req.Context())
    if req.ContentLength == 0 { outreq.Body = nil }
    if outreq.Body != nil { defer outreq.Body.Close() }
    if outreq.Header == nil { outreq.Header = make(Header) }

    if p.Director != nil { p.Director(outreq) }
    outreq.Close = false

    reqUpType := upgradeType(outreq.Header)
    removeHopByHopHeaders(outreq.Header)
    if reqUpType != "" {
        outreq.Header.Set("Connection", "Upgrade")
        outreq.Header.Set("Upgrade", reqUpType)
    }
    if clientIP, _, err := net.SplitHostPort(req.RemoteAddr); err == nil {
        prior, ok := outreq.Header["X-Forwarded-For"]
        omit := ok && prior == nil
        if len(prior) > 0 { clientIP = strings.Join(prior, ", ") + ", " + clientIP }
        if !omit { outreq.Header.Set("X-Forwarded-For", clientIP) }
    }
    if p.Rewrite != nil {
        pr := &ProxyRequest{In: req, Out: outreq}; p.Rewrite(pr); outreq = pr.Out
    }

    res, err := transport.RoundTrip(outreq)
    if err != nil { p.getErrorHandler()(rw, outreq, err); return }
    if res.StatusCode == StatusSwitchingProtocols { p.handleUpgradeResponse(rw, outreq, res); return }
    removeHopByHopHeaders(res.Header)
    copyHeader(rw.Header(), res.Header)
    rw.WriteHeader(res.StatusCode)
    p.copyResponse(rw, res.Body, p.flushInterval(res))
    res.Body.Close()
}

var hopHeaders = []string{
    "Connection", "Proxy-Connection", "Keep-Alive",
    "Proxy-Authenticate", "Proxy-Authorization",
    "Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

func removeHopByHopHeaders(h Header) {
    for _, f := range h["Connection"] {
        for _, sf := range strings.Split(f, ",") {
            if sf = textproto.TrimString(sf); sf != "" { h.Del(sf) }
        }
    }
    for _, f := range hopHeaders { h.Del(f) }
}
```

The hop-by-hop list is RFC 7230 §6.1: headers describing properties of *this hop* (`Connection: keep-alive`) must not be forwarded to the next hop. CVEs have shipped against proxies that forwarded `Transfer-Encoding` (smuggling) or `Connection` (downstream pool corruption). The `Connection:` walk happens *before* the static list because attackers add custom hop-by-hop names via `Connection:`.

`Rewrite` (Go 1.20+) replaced `Director` because `Director` saw both inbound and outbound mixed in one mutable value — bug-prone for header sanitisation. `ProxyRequest` separates `In` and `Out`. WebSockets are handled via `handleUpgradeResponse` — the 101 response triggers bidirectional `io.Copy`.

---

## 13. Cookie jar — `Client.Jar` interaction

The interface is tiny:

```go
type CookieJar interface {
    SetCookies(u *url.URL, cookies []*Cookie)
    Cookies(u *url.URL) []*Cookie
}
```

`Client.send` calls `Jar.Cookies(req.URL)` to add `Cookie:` headers before dispatch, then `Jar.SetCookies(req.URL, resp.Cookies())` after a response. Domain matching, path scoping, expiry, secure-flag handling all live in the implementation.

`net/http/cookiejar.Jar` is standard. It implements the public-suffix-list test (`PublicSuffixList` interface — ship `golang.org/x/net/publicsuffix` in real code) so `example.co.uk` can't set a cookie scoped to `co.uk`. Internal storage is a per-eTLD+1 map keyed by `(name, path, domain)`. Cookies are returned sorted by path length desc, then creation time asc — RFC 6265 §5.4. Servers reading raw `Cookie:` may rely on this order.

---

## 14. Internal helpers

`net/http/internal/chunked.go` implements `chunkedReader` and `chunkedWriter`, the RFC 7230 chunked transfer-encoding state machines:

```go
// from net/http/internal/chunked.go, simplified
type chunkedReader struct {
    r        *bufio.Reader
    n        uint64 // unread bytes in current chunk
    err      error
    checkEnd bool   // whether next bytes must be \r\n
}

func (cr *chunkedReader) Read(b []byte) (n int, err error) {
    for cr.err == nil {
        if cr.checkEnd {
            var buf [2]byte
            if _, cr.err = io.ReadFull(cr.r, buf[:]); cr.err == nil {
                if buf[0] != '\r' || buf[1] != '\n' { cr.err = errors.New("malformed chunked") }
            }
            cr.checkEnd = false
        }
        if cr.n == 0 {
            if n > 0 && !cr.chunkHeaderAvailable() { break } // avoid blocking on slow producer
            cr.beginChunk(); continue
        }
        if len(b) == 0 { break }
        rbuf := b
        if uint64(len(rbuf)) > cr.n { rbuf = rbuf[:cr.n] }
        n0, e := cr.r.Read(rbuf)
        n += n0; b = b[n0:]; cr.n -= uint64(n0); cr.err = e
        if cr.n == 0 && cr.err == nil { cr.checkEnd = true }
    }
    return n, cr.err
}
```

The `chunkHeaderAvailable` peek avoids blocking on slow producers — return what's buffered and let the caller decide whether to call `Read` again.

`net/http/internal/ascii/print.go` provides `EqualFold` and `IsPrint` that work strictly in ASCII, bypassing Unicode tables. HTTP header parsing is ASCII-only by spec; `strings.EqualFold` would be both slower and wrong on `İ`/`i` style folds. Every header comparison in `net/http` goes through these.

---

## 15. One request, end to end

```
  client side
  ───────────
  c.Do(req)
    → Client.do (cookie load, redirect loop)
        → c.send
            → DefaultTransport.RoundTrip
                → Transport.roundTrip
                    → connectMethodForRequest    (key = scheme+host+proxy)
                    → getConn                     (idle pool lookup or dial)
                        → dialConn (TLS handshake, ALPN)
                    → persistConn.roundTrip
                        → writech  <- writeRequest    (writeLoop serialises)
                        → reqch    <- requestAndChan  (readLoop awaits response)
                        ← resc:  *Response
                    → return resp
            ← c.Jar.SetCookies(u, resp.Cookies())

                                       │
                                  network
                                       │
  server side
  ───────────
  Server.Serve(l)
    → for { l.Accept() → go c.serve(ctx) }
                          │
                          ↓
  conn.serve
    → tls.Conn.HandshakeContext (if TLS)
      → if ALPN == "h2": TLSNextProto["h2"](srv, tlsConn, handler)  — HTTP/2 path
    → for {
        c.readRequest(ctx)            // textproto.Reader + readTransfer
        serverHandler{srv}.ServeHTTP  // recover-wrapped at conn level
          → DefaultServeMux.ServeHTTP (or srv.Handler)
            → mux.Handler             // pattern match, method-aware
              → user handler          // writes via *response → chunkWriter
        w.finishRequest               // flushes, drains body, decides reuse
        if !w.shouldReuseConnection { return }
        c.bufr.Peek(4)                // block until next request bytes
      }
```

Idle inbound connections are reaped by `IdleTimeout` via `SetReadDeadline` after each response. Idle outbound connections are reaped by `IdleConnTimeout` via `time.AfterFunc(t.IdleConnTimeout, pconn.closeConnIfStillIdle)`. Mirror images; the asymmetry is that the server can't reuse a hijacked connection, while the client always discards a connection after a redirect to a different host.

---

## 16. Where the bugs live

Reading these files top to bottom, historically buggy regions cluster in four places:

1. **`conn.serve` recover + cleanup interaction.** Issues #14897, #38447 — handler panics that left the connection half-open. The current shape (recover before `finishRequest`, `cancelCtx` before close) is the result of multiple fixes.
2. **`Transport.shouldRetryRequest`.** Idempotency rules are tricky; CL 50318 added the `GetBody`-based retry for POST. Read the doc comment on `Request.GetBody`.
3. **`ReverseProxy.removeHopByHopHeaders`.** Smuggling CVEs (CVE-2022-32148, CVE-2023-39322) touched this region. Current logic walks `Connection:` values *before* the static list because attackers add custom hop-by-hop names via `Connection:`.
4. **HTTP/2 frame parsing in `h2_bundle.go`.** Rapid Reset (CVE-2023-44487) lived here. Read the `MaxConcurrentStreams` enforcement and `streamCloseRetry` budget if you serve HTTP/2 publicly.

Each CVE is a story; `git log -p src/net/http/*.go` is one of the best Go education tools available.

---

## 17. Further reading

- `src/net/http/server.go`, `client.go`, `transport.go`, `request.go`, `transfer.go` — primary sources.
- `golang.org/x/net/http2` — unbundled HTTP/2 implementation; same code, easier to navigate.
- `src/net/http/httputil/reverseproxy.go` — reverse proxy with hop-by-hop tooling.
- `src/net/http/cookiejar/jar.go` — RFC 6265 cookie semantics.
- `src/net/textproto/reader.go` — header parsing primitives `readRequest` builds on.
- Go proposal #21426 — `ServeMux` enhancement that became the Go 1.22 router.
- CVE-2023-44487 (Rapid Reset) — read against `h2_bundle.go`'s stream close path.
- `runtime/pprof` + `net/http/pprof` — instrument the server you just read.
- Russ Cox and Brad Fitzpatrick GopherCon talks on `net/http` design.
- `git log --follow src/net/http/server.go` — the most rewarding read in the standard library.
