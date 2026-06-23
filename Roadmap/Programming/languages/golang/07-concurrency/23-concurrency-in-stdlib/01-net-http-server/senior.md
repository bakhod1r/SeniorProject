---
layout: default
title: net/http Server Concurrency — Senior
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/senior/
---

# net/http Server Concurrency — Senior

[← Back](../)

You are a senior Go engineer staring at a stuck production server. `pprof` shows
40,000 goroutines, half of them parked on `runtime.gopark` deep inside
`h2_bundle.go`. The team wants to know why. This page is the map.

The HTTP/1.1 model is simple: one goroutine per connection, that goroutine reads
a request, calls the handler, writes a response, repeats. HTTP/2 is not simple.
A single TCP connection multiplexes many concurrent streams, each stream looks
like an independent request to the handler, but they all share one socket, one
flow-control budget, one frame reader, one frame writer, and one control loop.
The result is at least four classes of goroutine per connection plus one per
in-flight stream, all coordinated by channels.

This document walks the HTTP/2 server path inside the standard library
(`net/http/h2_bundle.go`, which is a generated vendoring of `golang.org/x/net/http2`)
and the production bugs that show up at the seams where it meets `net/http`'s
HTTP/1.1 path.

---

## 1. The HTTP/2 upgrade — how a request becomes h2

A `http.Server` listening on TLS speaks HTTP/2 only if the TLS handshake
selected `h2` via ALPN. That selection is wired up automatically the first time
you call `ListenAndServeTLS`, `ServeTLS`, or `(*Server).Serve` on a `tls.Listener`,
provided you have not turned it off.

The relevant field on `http.Server` is `TLSNextProto`:

```go
// net/http/server.go (approximately line 3050+)
type Server struct {
    // ...
    TLSNextProto map[string]func(*Server, *tls.Conn, Handler)
    // ...
}
```

If `TLSNextProto` is `nil`, `Server.setupHTTP2_ServeTLS` (in `h2_bundle.go`,
generated from `x/net/http2.ConfigureServer`) installs an entry under the key
`"h2"` whose value is a function that takes the just-handshaken `*tls.Conn` and
hands it to the HTTP/2 server:

```go
// h2_bundle.go (generated). The real upstream is x/net/http2/server.go
// ConfigureServer.
func http2ConfigureServer(s *Server, conf *http2Server) error {
    // ... defaults ...
    if s.TLSNextProto == nil {
        s.TLSNextProto = map[string]func(*Server, *tls.Conn, Handler){}
    }
    protoHandler := func(hs *Server, c *tls.Conn, h Handler) {
        if testHookOnConn != nil { testHookOnConn() }
        conf.ServeConn(c, &http2ServeConnOpts{
            Context:    hs.ConnContext,
            Handler:    h,
            BaseConfig: hs,
        })
    }
    s.TLSNextProto["h2"] = protoHandler
    return nil
}
```

The HTTP/1.1 accept loop in `(*Server).Serve` hands the connection to
`(*conn).serve`, which performs the TLS handshake; if the negotiated protocol
matches an entry in `TLSNextProto`, it calls that function and returns. The
HTTP/1 connection state is abandoned and the HTTP/2 server takes over the raw
`*tls.Conn`. From the `net/http` HTTP/1.1 codebase's perspective, the connection
is gone.

```go
// net/http/server.go, (*conn).serve, around the TLS handshake path:
if proto := c.tlsState.NegotiatedProtocol; validNextProto(proto) {
    if fn := c.server.TLSNextProto[proto]; fn != nil {
        h := initALPNRequest{ctx, tlsConn, serverHandler{c.server}}
        // Mark the connection as hijacked so no further HTTP/1 cleanup runs.
        c.setState(c.rwc, StateActive, runHooks)
        fn(c.server, tlsConn, h)
    }
    return
}
```

`validNextProto` rejects `http/1.1` so that a confused client cannot trick the
server into re-entering HTTP/1 via ALPN. Anything else (h2, h3 in future) flows
to the registered handler.

### h2c — cleartext HTTP/2

For unencrypted HTTP/2 (h2c) the standard library does not register the upgrade
automatically. You wrap your handler with `golang.org/x/net/http2/h2c.NewHandler`:

```go
import (
    "net/http"
    "golang.org/x/net/http2"
    "golang.org/x/net/http2/h2c"
)

func main() {
    h2s := &http2.Server{
        MaxConcurrentStreams: 250,
        IdleTimeout:          120 * time.Second,
    }
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("hello h2c\n"))
    })
    srv := &http.Server{
        Addr:    ":8080",
        Handler: h2c.NewHandler(handler, h2s),
    }
    log.Fatal(srv.ListenAndServe())
}
```

`h2c.NewHandler` inspects each HTTP/1 request. If the request is the special
HTTP/2 connection preface (the `PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n` line) or a
client sent the `Upgrade: h2c` header with the magic `HTTP2-Settings` header, it
hijacks the underlying `net.Conn` (`http.Hijacker.Hijack`) and hands the raw
socket to `http2Server.ServeConn`. After that the HTTP/1 server no longer owns
the connection. Hijack is what makes h2c work without ALPN.

You cannot do this twice on the same connection. If `h2c.NewHandler` does not
recognise the preface it returns the request to the HTTP/1 handler chain.

---

## 2. `http2Server.ServeConn` — the connection-level goroutine

Once the upgrade routes a `net.Conn` to `http2Server.ServeConn`, that function
constructs a `*http2serverConn` (one per HTTP/2 connection) and calls
`sc.serve()`. The caller is the HTTP/1.1 accept-loop goroutine; it stays parked
here for the lifetime of the connection. This is goroutine #1 for the
connection: the *control loop*.

```go
// h2_bundle.go, http2serverConn type (abbreviated; field count ~70 in stdlib):
type http2serverConn struct {
    srv              *http2Server
    hs               *Server
    conn             net.Conn
    bw               *http2bufferedWriter
    handler          Handler

    framer           *http2Framer
    doneServing      chan struct{}
    readFrameCh      chan http2readFrameResult
    wantWriteFrameCh chan http2FrameWriteRequest
    wroteFrameCh     chan http2frameWriteResult
    bodyReadCh       chan http2bodyReadMsg
    serveMsgCh       chan interface{}

    streams          map[uint32]*http2stream
    maxClientStreamID uint32
    advMaxStreams    uint32 // SETTINGS_MAX_CONCURRENT_STREAMS we advertised
    initialStreamSendWindowSize int32
    maxFrameSize     int32

    inFrameScheduleLoop bool
    needToSendGoAway    bool
    goAwayCode          http2ErrCode
    shutdownTimer       *time.Timer
    idleTimer           *time.Timer
    // ...
}
```

The `serve()` function is structured as a single goroutine running a `for`
select-loop over the channels listed above. Every transition that mutates
`sc.streams`, the SETTINGS table, or the flow-control state happens on this
single goroutine. That is the trick that lets the HTTP/2 server avoid most
fine-grained locking: it uses CSP-style message passing within one connection,
and the per-connection goroutine is the only one allowed to touch most state.

A simplified sketch of the loop:

```go
func (sc *http2serverConn) serve() {
    sc.serveG.check()                     // panics if called from wrong goroutine
    defer sc.notePanic()
    defer sc.conn.Close()
    defer sc.closeAllStreamsOnConnClose()
    defer sc.stopShutdownTimer()
    defer close(sc.doneServing)

    if err := sc.processSettingsInitial(); err != nil { return }
    go sc.readFrames()                    // goroutine #2

    settingsTimer := time.AfterFunc(http2firstSettingsTimeout, sc.onSettingsTimer)
    defer settingsTimer.Stop()

    loopNum := 0
    for {
        loopNum++
        select {
        case wr := <-sc.wantWriteFrameCh:
            sc.writeFrame(wr)
        case res := <-sc.wroteFrameCh:
            sc.wroteFrame(res)
        case res := <-sc.readFrameCh:
            if !sc.processFrameFromReader(res) { return }
            if sc.writeSched.MaxFrameSize() != int(sc.maxFrameSize) { /* ... */ }
        case m := <-sc.bodyReadCh:
            sc.noteBodyRead(m.st, m.n)
        case msg := <-sc.serveMsgCh:
            switch v := msg.(type) {
            case func(int):  v(loopNum)
            case *http2serverMessage:
                switch v {
                case http2settingsTimerMsg: sc.goAway(http2ErrCodeProtocol)
                case http2idleTimerMsg:     sc.goAway(http2ErrCodeNo)
                case http2shutdownTimerMsg: return
                case http2gracefulShutdownMsg: sc.startGracefulShutdownInternal()
                }
            case *http2startPushRequest:
                sc.startPush(v)
            }
        }

        if sc.inGoAway && sc.curOpenStreams() == 0 && !sc.needToSendGoAway && !sc.writingFrame {
            return
        }
    }
}
```

That single `for-select` is the heart of every HTTP/2 connection in your
process. It receives **events** from:

* the wire (`readFrameCh`) — frames just read by the framer goroutine,
* the writer (`wroteFrameCh`) — frame just finished writing,
* request handlers (`wantWriteFrameCh`, `bodyReadCh`) — handlers want to flush
  data or have consumed body bytes (which triggers WINDOW_UPDATE),
* timers and shutdown channels (`serveMsgCh`).

If you want a mental model: think of `sc.serve()` as a single-threaded event
loop running the entire HTTP/2 state machine for one connection, and every
handler goroutine is a *worker* that posts messages back to this loop.

---

## 3. The framer goroutine — `readFrames`

The framer goroutine is goroutine #2 per connection. It does exactly one thing:
read frames from the TCP socket and forward them to `sc.readFrameCh`.

```go
// h2_bundle.go (simplified):
func (sc *http2serverConn) readFrames() {
    gate := make(http2gate)
    gateDone := gate.Done
    for {
        f, err := sc.framer.ReadFrame()
        select {
        case sc.readFrameCh <- http2readFrameResult{f, err, gateDone}:
        case <-sc.doneServing:
            return
        }
        select {
        case <-gate:
        case <-sc.doneServing:
            return
        }
        if http2terminalReadFrameError(err) {
            return
        }
    }
}
```

The `gate` is subtle: the framer reads one frame, hands it to the control loop,
and then *blocks* until the control loop signals that it is ready for the next
frame. That backpressure prevents the framer from racing ahead and allocating
unbounded buffers when the handler is slow. Frames are not pipelined; each
frame's processing happens to completion (state-machine-wise) before the next
is read.

`sc.framer` is a `*http2Framer`, which wraps a `bufio.Reader` over the network
connection. It reads the 9-byte frame header and then the payload according to
`MaxReadFrameSize` (default `1 << 14` = 16384 from RFC 7540). Each frame type
(HEADERS, DATA, SETTINGS, WINDOW_UPDATE, PING, PRIORITY, RST_STREAM, GOAWAY,
CONTINUATION, PUSH_PROMISE) is decoded into a typed struct before delivery.

If a peer sends garbage, `ReadFrame` returns `http2ConnectionError` and the
framer goroutine forwards the error; the control loop responds with GOAWAY and
tears the connection down.

---

## 4. Per-stream goroutines — where your handler runs

A HEADERS frame with a previously unseen client-initiated stream ID
(odd-numbered) means "new request". The control loop validates the headers,
constructs the `*http.Request`, builds a `*http2responseWriter`, registers the
stream in `sc.streams`, and launches goroutine #3+N — one per stream — to run
the user handler:

```go
// h2_bundle.go (paraphrased from runHandler)
func (sc *http2serverConn) runHandler(rw *http2responseWriter, req *Request, handler func(ResponseWriter, *Request)) {
    didPanic := true
    defer func() {
        rw.rws.stream.cancelCtx()
        if didPanic {
            // log and send RST_STREAM
            sc.writeFrameFromHandler(http2FrameWriteRequest{
                write:  http2handlerPanicRST{rw.rws.stream.id},
                stream: rw.rws.stream,
            })
        } else {
            rw.handlerDone()
        }
    }()
    handler(rw, req)
    didPanic = false
}
```

That `go sc.runHandler(rw, req, handler)` is launched from `processHeaders`,
which the control loop calls when it receives a HEADERS frame.

Key invariants:

* Each stream goroutine sees its own `*http.Request` and `http.ResponseWriter`.
  Two concurrent requests on the same connection map to two goroutines, and
  they cannot reach each other's request/response state.
* The stream goroutine **never writes directly to the socket**. Writes are
  posted to the control loop via `wantWriteFrameCh`, which serializes them with
  every other stream's writes.
* The stream goroutine has its own `context.Context`, derived from the
  connection context and cancelled when the stream ends, the client sends
  RST_STREAM, the connection closes, or the handler returns.

The "goroutine per stream" model means a single connection can spawn hundreds
of goroutines at once. The `MaxConcurrentStreams` setting (default 250 in the
stdlib HTTP/2 server) caps how many streams a client may have open. Beyond that
the server rejects new HEADERS frames with RST_STREAM(REFUSED_STREAM) and never
spawns a handler goroutine. This is your main lever against per-connection
fan-out.

---

## 5. The control loop's `serveMsgCh` — message bus

Why does the HTTP/2 server have so many channels? Because Go's race detector
hates shared state, and the engineers behind `x/net/http2` deliberately chose a
message-passing design to keep the state machine sane. Every event that needs
to mutate connection state — including timers, shutdown requests, and pushes —
is converted to a value sent on `serveMsgCh`. The control loop has a single
`select` that reads from all event channels and handles them sequentially.

This is `goroutine confinement` taken to a logical extreme. The cost is one
extra channel send per event; the benefit is no locks on `sc.streams`,
`sc.flow`, the SETTINGS table, the idle timer, etc.

The `serveG` field is a debug helper:

```go
type http2goroutineLock uint64
func (g http2goroutineLock) check()        { /* panic if g != current G */ }
func (g http2goroutineLock) checkNotOn()   { /* panic if g == current G */ }
```

`sc.serveG` is captured when `serve()` starts, and many internal functions call
`sc.serveG.check()` at entry. If anyone ever calls one of those functions from
the wrong goroutine, the program panics at the bad call site rather than
corrupting state silently. This is why the codebase is dotted with
`sc.serveG.check()` lines — they enforce the "one goroutine touches this
state" invariant.

---

## 6. The writer goroutine — `writeFrameAsync`

A second worker pattern: when the control loop wants to write a frame, it does
not block. It calls `sc.writeFrameAsync`:

```go
// h2_bundle.go (simplified)
func (sc *http2serverConn) writeFrameAsync(wr http2FrameWriteRequest, wd *http2writeData) {
    var err error
    if wd == nil {
        err = wr.write.writeFrame(sc)
    } else {
        err = sc.framer.endWrite()
    }
    sc.wroteFrameCh <- http2frameWriteResult{wr: wr, err: err}
}
```

This is invoked as `go sc.writeFrameAsync(wr, nil)` from the control loop. The
writer goroutine writes to `sc.bw` (a buffered writer wrapping the conn) and
posts the result back on `wroteFrameCh`. The control loop receives that result,
updates flow-control state, and decides what to write next.

You might wonder why writing needs its own goroutine. The answer is buffering
and backpressure. `sc.bw` is a `*http2bufferedWriter`, which writes into a
`bufio.Writer`. A large DATA frame can block on a slow client; while it blocks,
the control loop must keep running so it can read PING frames, accept new
HEADERS, send WINDOW_UPDATE, and so on. By moving the actual `Write` into a
goroutine, the control loop is free to keep selecting on channels.

There is at most one outstanding write at a time per connection. The control
loop sets `sc.writingFrame = true` before launching `writeFrameAsync`, and only
sets it false when the result arrives on `wroteFrameCh`. The writer scheduler
chooses which frame to emit next while `writingFrame` is false.

### Frame scheduling

`sc.writeSched` is an `http2WriteScheduler`. The default is the *priority*
scheduler from RFC 7540 section 5.3, but RFC 9113 deprecated stream priorities,
and the stdlib's default has changed to a *round-robin* scheduler in newer Go
versions. The scheduler holds a queue of pending writes per stream and decides
which to release next.

The scheduler is consulted whenever the control loop is ready to launch the
next write. Important for senior debugging: if you see a connection where data
is not flowing, look at `writeSched.MaxFrameSize` and the pending write queues
— the scheduler may be holding frames because of flow-control exhaustion.

---

## 7. Flow control

HTTP/2 has *two levels* of receive-side flow control:

1. Per-stream window: how many DATA bytes the peer may send on this stream
   without an explicit WINDOW_UPDATE.
2. Per-connection window: how many DATA bytes the peer may send across all
   streams combined.

Initially each window is 65535 bytes (RFC default). The server raises the
initial stream window via SETTINGS_INITIAL_WINDOW_SIZE, and the connection
window via an explicit WINDOW_UPDATE frame after the SETTINGS exchange. The
stdlib's HTTP/2 server defaults are tuned to about 1 MiB per stream and a few
MiB per connection (the constants are in `h2_bundle.go`:
`http2initialWindowSize`, `http2transportDefaultStreamFlow`, etc.).

When DATA flows into the server, the framer goroutine reads the DATA frame and
forwards it to the control loop. The control loop:

1. Validates the stream is open.
2. Subtracts the frame size from `stream.inflow` and `sc.inflow`.
3. Calls `stream.body.write(...)` to enqueue the bytes for the handler.
4. Optionally schedules a WINDOW_UPDATE if the in-buffer was drained.

The handler reads via `req.Body.Read`. That `Read` is implemented by
`*http2requestBody`, which copies bytes out of a `*http2dataBuffer`. After the
handler consumes N bytes, the body reader posts an `http2bodyReadMsg{st, n}`
onto `sc.bodyReadCh`:

```go
// h2_bundle.go (simplified):
func (b *http2requestBody) Read(p []byte) (n int, err error) {
    if b.conn == nil && http2inTests { return 0, errors.New("...") }
    n, err = b.pipe.Read(p)
    if n > 0 {
        b.conn.noteBodyReadFromHandler(b.stream, n, err)
    }
    return
}
```

`noteBodyReadFromHandler` pushes the message onto `bodyReadCh`. The control
loop picks it up and calls `sc.sendWindowUpdate(st, n)`, which schedules a
WINDOW_UPDATE frame to be written.

This is the second-level subtlety many engineers miss: WINDOW_UPDATE is sent
*after* the handler has consumed the bytes, not when the bytes arrive. If the
handler is slow, the windows shrink, the peer pauses, and back-pressure
propagates back to the client. If your handler buffers the entire body before
processing, you have lost flow control's benefit.

### Sending data — the symmetric problem

When the handler writes via `w.Write`, the bytes are deposited into the
response stream's in-memory buffer and a write request is posted to the
control loop. The control loop checks the per-stream send window
(`stream.outflow`) and the per-connection send window (`sc.outflow`) and emits
DATA frames only up to the smaller of the two minus any bytes already in
flight. If both windows are zero, the data sits in the buffer until the client
sends WINDOW_UPDATE.

A handler that calls `w.Write` faster than the client can drain pays the price
in memory: the bytes pile up in the stream buffer. This is why long-lived
streaming handlers must be careful to use `http.Flusher.Flush` and respect
client backpressure.

---

## 8. SETTINGS handshake

When a new HTTP/2 connection is established, the server immediately sends a
SETTINGS frame announcing its limits. The client also sends a SETTINGS frame,
the server ACKs it, and the connection becomes fully operational. The
`processSettingsInitial` call inside `serve()` performs the server's initial
SETTINGS write before the loop starts:

```go
// h2_bundle.go (paraphrased):
func (sc *http2serverConn) processSettingsInitial() error {
    sc.writeFrame(http2FrameWriteRequest{
        write: http2writeSettings{
            {http2SettingMaxFrameSize, sc.srv.maxReadFrameSize()},
            {http2SettingMaxConcurrentStreams, sc.advMaxStreams},
            {http2SettingMaxHeaderListSize, sc.maxHeaderListSize()},
            {http2SettingHeaderTableSize, http2initialHeaderTableSize},
            {http2SettingInitialWindowSize, uint32(sc.srv.initialStreamRecvWindowSize())},
        },
    })
    sc.unackedSettings++
    if err := sc.bw.Flush(); err != nil { return err }
    if diff := sc.srv.initialConnRecvWindowSize() - http2initialWindowSize; diff > 0 {
        sc.sendWindowUpdate32(nil, int32(diff))
    }
    if err := sc.bw.Flush(); err != nil { return err }
    return nil
}
```

The MaxConcurrentStreams setting is enforced as follows: when a HEADERS frame
arrives with a new stream ID, the control loop checks
`sc.curOpenStreams() >= sc.advMaxStreams`. If so it sends RST_STREAM with code
REFUSED_STREAM and never spawns a handler. The client should retry on a
different stream.

The stdlib's HTTP/2 client (`http2Transport`) honours MaxConcurrentStreams and
will open a new TCP connection if all streams on existing connections are
saturated. The implication for capacity planning: a single client with
high concurrency may open many TCP connections to your server, each with up to
`MaxConcurrentStreams` streams. Total goroutines = connections * streams + 2
per connection.

### Tuning `http2.Server` knobs

```go
http2.ConfigureServer(srv, &http2.Server{
    MaxHandlers:                  0, // unlimited; rarely a useful knob
    MaxConcurrentStreams:         250,
    MaxDecoderHeaderTableSize:    4 << 10,
    MaxEncoderHeaderTableSize:    4 << 10,
    MaxReadFrameSize:             1 << 20, // 1 MiB max DATA frame
    PermitProhibitedCipherSuites: false,
    IdleTimeout:                  120 * time.Second,
    ReadIdleTimeout:              60 * time.Second,
    PingTimeout:                  15 * time.Second,
    WriteByteTimeout:             30 * time.Second,
    MaxUploadBufferPerConnection: 1 << 20,
    MaxUploadBufferPerStream:     1 << 20,
    NewWriteScheduler:            nil, // default RR
    CountError:                   nil,
})
```

Each knob maps directly to a SETTINGS field or to an internal limit:

* `MaxConcurrentStreams` — advertised via SETTINGS_MAX_CONCURRENT_STREAMS.
* `MaxReadFrameSize` — advertised via SETTINGS_MAX_FRAME_SIZE; caps how big a
  DATA frame the client may send. Larger values reduce syscall overhead at the
  cost of head-of-line blocking when bursts arrive.
* `IdleTimeout` — if no streams are open for this long, GOAWAY and close.
* `ReadIdleTimeout` / `PingTimeout` — periodic PING frames to detect dead
  connections.
* `MaxUploadBufferPerConnection` / `MaxUploadBufferPerStream` — controls the
  initial WINDOW_UPDATE and per-stream buffer caps. If a handler stops
  consuming the body, the buffer fills to this limit and the peer is
  flow-controlled to a stop.
* `WriteByteTimeout` — if the writer goroutine cannot push a single byte in
  this duration, abort the connection. Critical defense against slow-read
  attacks.

---

## 9. Stream lifecycle states

RFC 7540 section 5.1 defines six stream states. The stdlib tracks them in
`stream.state`:

```go
type http2streamState int

const (
    http2stateIdle http2streamState = iota
    http2stateOpen
    http2stateHalfClosedLocal   // we (server) sent END_STREAM
    http2stateHalfClosedRemote  // client sent END_STREAM
    http2stateResvLocal         // pushed by us, headers not yet sent
    http2stateResvRemote        // unused on server side
    http2stateClosed
)
```

Transitions on the server side:

* Idle → Open: HEADERS received from client without END_STREAM.
* Idle → HalfClosedRemote: HEADERS received with END_STREAM (no body).
* Open → HalfClosedRemote: DATA frame with END_STREAM received.
* Open → HalfClosedLocal: server's handler returns and we flush response with
  END_STREAM, but client has not finished sending body.
* HalfClosedLocal → Closed: client sends END_STREAM on its remaining body.
* HalfClosedRemote → Closed: server's handler returns, response flushed with
  END_STREAM.
* Any state → Closed: RST_STREAM received or sent.

When a stream enters Closed, the control loop:

1. Cancels the stream's context.
2. Closes the request body pipe (`pipe.CloseWithError`) so a blocked
   `Body.Read` returns immediately.
3. Removes the stream from `sc.streams`.
4. Refunds the per-connection flow-control credit.

The handler goroutine may still be running after step 4. That is the most
important fact in this section. Closing the stream does *not* kill the handler
goroutine — Go has no goroutine cancellation. The handler must observe context
cancellation, or `Body.Read` returning EOF, or `ResponseWriter.Write` returning
`http.ErrBodyNotAllowed` / a context error, and exit on its own.

---

## 10. RST_STREAM and GOAWAY

RST_STREAM (stream-level abort): either side may send it. The server emits
RST_STREAM in the following cases:

* The peer violated the protocol on this stream (e.g. invalid header).
* `MaxConcurrentStreams` exceeded → RST_STREAM(REFUSED_STREAM).
* The handler panicked → RST_STREAM(INTERNAL_ERROR) (see the panic recover in
  `runHandler`).
* A `http2errStreamClosed` is returned from any per-stream write because the
  control loop already closed the stream.

RST_STREAM does not affect other streams or the connection.

GOAWAY (connection-level): the server emits it when:

* `IdleTimeout` elapsed with no streams.
* The peer violated the protocol at the connection level.
* `Server.Shutdown` was called and graceful shutdown is in progress.
* A serious internal error occurred.

GOAWAY includes the LastStreamID — the highest stream the server promises to
process. Streams above that ID are abandoned and may be retried on a new
connection. After GOAWAY the server keeps the connection open until all
streams up to LastStreamID complete or `Server.Shutdown`'s deadline elapses.

The graceful shutdown sequence on the server is:

1. `Server.Shutdown(ctx)` posts `http2gracefulShutdownMsg` to `serveMsgCh`.
2. Control loop sends GOAWAY with code NO_ERROR and LastStreamID =
   `maxClientStreamID`.
3. Control loop refuses new streams (any HEADERS for a new ID gets
   RST_STREAM).
4. Control loop waits until `curOpenStreams() == 0` *or* the shutdown timer
   fires (set by `Server.Shutdown`'s context deadline).
5. Connection is closed.

---

## 11. Server push — `(*responseWriter).Push`

HTTP/2 server push was a useful idea: the server speculatively sends a
PUSH_PROMISE for a resource it knows the client will need, then proceeds to
send DATA for that pushed stream. Chromium removed support for it in early 2022
(Chrome 106), but the stdlib still exposes it.

```go
// net/http/server.go has the Pusher interface:
type Pusher interface {
    Push(target string, opts *PushOptions) error
}
```

The HTTP/2 ResponseWriter implements it:

```go
func (w *http2responseWriter) Push(target string, opts *PushOptions) error {
    st := w.rws.stream
    sc := st.sc
    sc.serveG.checkNotOn()
    if st.isPushed() { return http2ErrRecursivePush }
    // build URL, validate scheme/method, etc.
    msg := &http2startPushRequest{
        parent: st, method: method, url: u, header: opts.Header,
        done:   make(chan error),
    }
    select {
    case <-sc.doneServing:    return http2errClientDisconnected
    case <-st.cw:             return http2errStreamClosed
    case sc.serveMsgCh <- msg:
    }
    select {
    case <-sc.doneServing:    return http2errClientDisconnected
    case <-st.cw:             return http2errStreamClosed
    case err := <-msg.done:   return err
    }
}
```

The push request is a message to the control loop, which actually allocates
the new server-initiated stream ID (even-numbered), sends PUSH_PROMISE, builds
a synthetic `*http.Request`, and spawns a handler goroutine just as if the
client had sent a HEADERS frame.

Two senior gotchas: pushed streams count toward your handler goroutine
budget; and if the client has set SETTINGS_ENABLE_PUSH = 0 (as Chromium does
nowadays) `Push` returns `http.ErrNotSupported`. Defensive code should always
check for that error rather than rely on push.

---

## 12. Graceful shutdown on HTTP/2

Compared to HTTP/1, where `Server.Shutdown` waits for active connections to
drain idle, HTTP/2 graceful shutdown is *stream-aware*. The implementation
lives in `(*http2serverConn).startGracefulShutdownInternal`:

```go
func (sc *http2serverConn) startGracefulShutdownInternal() {
    sc.goAwayIn(http2ErrCodeNo, 0)
}

func (sc *http2serverConn) goAwayIn(code http2ErrCode, forceCloseIn time.Duration) {
    if sc.inGoAway {
        if sc.goAwayCode == http2ErrCodeNo {
            sc.goAwayCode = code
        }
        return
    }
    sc.inGoAway = true
    if forceCloseIn != 0 {
        sc.shutDownIn(forceCloseIn)
    }
    sc.goAwayCode = code
    sc.scheduleFrameWrite()
}
```

The actual GOAWAY frame is written by the scheduler when it next gets a turn,
with `LastStreamID = sc.maxClientStreamID`. After that, `processHeaders` for a
new stream ID will RST_STREAM with REFUSED_STREAM.

If `Server.Shutdown`'s context deadline elapses while streams are still open,
the server forces the connection closed. This is the moment many production
issues surface: in-flight handlers may have their bodies / writers ripped out
from under them. Every long-running handler should:

```go
func longHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    for chunk := range source {
        if _, err := w.Write(chunk); err != nil {
            return // context cancelled, connection gone, or stream RST
        }
        select {
        case <-ctx.Done():
            return
        default:
        }
    }
}
```

---

## 13. Context cancellation through HTTP/2

`r.Context()` for an HTTP/2 request is the per-stream context, built from the
connection context (`ConnContext`) like this:

```go
ctx, cancelCtx := context.WithCancel(sc.baseCtx)
st := &http2stream{ ctx: ctx, cancelCtx: cancelCtx, /* ... */ }
```

The cancel is invoked from several places:

* The handler returns (deferred in `runHandler`).
* The stream is closed by RST_STREAM from the peer.
* The connection closes (`closeAllStreamsOnConnClose`).
* `Server.Shutdown` blew through its deadline and forced close.

So a handler observing `<-ctx.Done()` is a reliable signal for "client gave
up". But: there is no signal in the other direction. If the **server** wants to
cancel a handler programmatically, `r.Context()` does not help. You need a
side-channel — for instance, a `context.WithCancel` derived from
`r.Context()` that you propagate to your downstream callers.

A common production pattern:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithCancel(r.Context())
    defer cancel()

    // Pass ctx to all downstream calls. If anything fails, cancel cascades.
    if err := callBackend(ctx); err != nil {
        http.Error(w, err.Error(), 502)
        return
    }
}
```

If the client disconnects, `r.Context()` cancels, which cascades into `ctx`,
which cancels `callBackend`. The backend call observes `ctx.Done()` and aborts.
This is how you avoid wasting compute on requests whose client is gone.

---

## 14. Hijack on HTTP/2 — not supported

`http.Hijacker` is an interface served by HTTP/1.1's `ResponseWriter`. It lets
your handler take ownership of the underlying `net.Conn`, used by WebSocket
implementations, raw TCP tunnels, and the h2c upgrader itself.

HTTP/2 does *not* support `Hijack`. The HTTP/2 `responseWriter`
deliberately does not implement `http.Hijacker`. If your handler does:

```go
hj, ok := w.(http.Hijacker)
if !ok { http.Error(w, "no hijack", 500); return }
conn, _, err := hj.Hijack()
```

then over HTTP/2 the type assertion fails and you take the "no hijack" branch.
This is by design: hijacking would require seizing the shared TCP socket, which
is multiplexing other streams. You cannot give one stream exclusive ownership
of a connection that other streams are using.

The implication for WebSocket: WebSockets do not work over HTTP/2 with the
standard handshake. RFC 8441 defined an `:protocol` pseudo-header extension
("Bootstrapping WebSockets with HTTP/2"), but the Go stdlib does not implement
it. If you need WebSocket on a server that also serves HTTP/2, either:

1. Serve WebSocket on a different hostname/port that advertises only HTTP/1.1
   in ALPN.
2. Use `Server.TLSNextProto["h2"] = nil` to disable h2 entirely.
3. Use a third-party WebSocket-over-h2 stack.

You can also disable HTTP/2 per-`Server` cheaply:

```go
srv := &http.Server{
    Addr:         ":443",
    Handler:      mux,
    TLSNextProto: map[string]func(*Server, *tls.Conn, Handler){}, // h2 off
}
```

The non-nil empty map prevents `setupHTTP2_ServeTLS` from registering h2.

---

## 15. Race-detector hot paths and historical bugs

Selected high-impact HTTP/2 server bugs Go has fixed (worth knowing if you are
debugging a stuck connection):

* CVE-2018-17142 — invalid host header could panic the server.
* CVE-2022-27664 — denial of service via long client header frames; fixed by
  capping CONTINUATION frame chains.
* CVE-2023-39325 — "Rapid Reset" attack: a client could open and immediately
  RST_STREAM many streams faster than the server could clean them up, exhausting
  CPU. Fix: the server now tracks `streamsRapidReset` and aborts the connection
  with ENHANCE_YOUR_CALM after a threshold.
* golang.org/cl/471535 — fixed a goroutine leak when a client cancelled a
  push promise mid-flight.
* golang.org/cl/518327 — fixed a flow-control accounting bug where DATA frames
  on closed streams could leak window credit.
* golang.org/cl/485395 — fixed a race in the body pipe between
  `pipe.CloseWithError` from the control loop and `pipe.Read` from the
  handler.

Race-detector positives historically clustered in three places:

1. `responseWriter.Write` racing with handler's deferred cleanup.
2. `requestBody.Read` racing with stream cancellation.
3. `*http2serverConn` field reads from outside `serve()` goroutine.

The defensive `serveG.check()` calls were added precisely because the team
caught many of these with `-race` in production-like soak tests.

---

## 16. Knobs cheat sheet

| Setting | Default | Tune up when... | Tune down when... |
|--|--|--|--|
| `MaxConcurrentStreams` | 250 | Single client legitimately needs more parallelism. | Per-connection memory or goroutine count is a problem. |
| `MaxReadFrameSize` | 1 MiB (configured) | Throughput-bound, high-bandwidth/high-latency links. | Memory-bound, many connections. |
| `MaxUploadBufferPerStream` | 1 MiB | Upload-heavy workloads with slow handlers. | Defensive against slow-handler attacks. |
| `MaxUploadBufferPerConnection` | 1 MiB | Many concurrent uploads on one connection. | Many connections with bursty uploads. |
| `IdleTimeout` | 0 (none) | Always set this. 2 min is a sane default. | Sub-second for ephemeral peers. |
| `ReadIdleTimeout` | 0 | Detect dead idle connections faster. | Avoid PING noise on flaky networks. |
| `PingTimeout` | 15s | If `ReadIdleTimeout` is short. | If clients are slow to ACK PINGs. |
| `WriteByteTimeout` | 0 | Slow-read attacks suspected. | Legitimately slow clients (mobile). |

---

## 17. h2-specific timeout patterns

The classic `Server.ReadTimeout` and `Server.WriteTimeout` are wall-clock
deadlines on the underlying `net.Conn`. They apply to HTTP/2 too, but with a
twist: an HTTP/2 connection lives for many streams, so `ReadTimeout = 30s` does
not mean "30s per request" — it means "if no byte arrives on the socket for
30s, kill the connection". Across all streams. That is almost never what you
want for HTTP/2.

The right pattern is **per-stream timeouts via context**:

```go
func withTimeout(d time.Duration, h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx, cancel := context.WithTimeout(r.Context(), d)
        defer cancel()
        h.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

This works the same on HTTP/1 and HTTP/2. The handler must of course propagate
the context to downstream calls; the `ResponseWriter` does not observe it
directly.

For request body reads, the body is a `*http2requestBody` whose `Read`
honours stream context cancellation: when the stream's context cancels, the
pipe is closed with `errStreamClosed` and `Body.Read` returns immediately.
You do not need to wrap the body in a context-aware reader for cancellation;
you do need to set a context deadline appropriate for your endpoint.

For writes, the situation is trickier. `w.Write` on h2 does not directly poll
the context. It posts a write request to the control loop and blocks on a
channel. If the context cancels mid-write, the underlying stream's cancellation
will eventually unblock the write, but you may have already buffered megabytes
of response data. The defensive pattern for streaming endpoints is:

```go
func streamLargeResponse(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    flusher, _ := w.(http.Flusher)
    enc := json.NewEncoder(w)
    for chunk := range sourceCh {
        if err := enc.Encode(chunk); err != nil { return }
        if flusher != nil { flusher.Flush() }
        select {
        case <-ctx.Done(): return
        default:
        }
    }
}
```

The `Flush` is essential: it forces the buffered bytes onto the wire, and
respects flow control. Without it, the server may buffer the entire response
in memory while the client is happily idle.

---

## 18. Concurrent write to ResponseWriter — a race

The single most common race I have seen in HTTP/2 production code:

```go
// BAD: race on w
func badHandler(w http.ResponseWriter, r *http.Request) {
    var wg sync.WaitGroup
    for _, partURL := range parts {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            data := fetch(u)
            w.Write(data) // RACE: concurrent writes to ResponseWriter
        }(partURL)
    }
    wg.Wait()
}
```

`http.ResponseWriter` is **not** safe for concurrent use. The HTTP/2
implementation has an internal mutex on the response writer state, so you may
not always see a crash with `-race`, but you can produce interleaved DATA
frames, headers written twice, or panics from `WriteHeader` being called
twice.

The fix is a single writer goroutine fed by a channel, with all sources
posting their bytes onto the channel:

```go
func goodHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    out := make(chan []byte, 16)
    var wg sync.WaitGroup
    for _, u := range parts {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            data := fetch(u)
            select {
            case out <- data:
            case <-ctx.Done():
            }
        }(u)
    }
    // Close the channel when all producers are done.
    go func() { wg.Wait(); close(out) }()

    flusher, _ := w.(http.Flusher)
    for chunk := range out {
        if _, err := w.Write(chunk); err != nil { return }
        if flusher != nil { flusher.Flush() }
    }
}
```

The handler goroutine itself is the sole writer. Producers are isolated. Even
if `fetch` is slow, the bytes-per-second on the wire is bounded by what the
handler can push.

A subtlety: `ctx.Done()` in the producers prevents leaks when the client
disconnects. Without it, the producers keep computing even though the handler
has exited and the consumer of `out` is gone, then they block forever on
`out <- data`.

---

## 19. Production bugs to watch for

### Bug 1 — handler goroutine leak after client disconnect

```go
// LEAK
func slow(w http.ResponseWriter, r *http.Request) {
    result := <-backendChan // blocks forever if backend hangs
    w.Write(result)
}
```

Client disconnects → stream cancels → `r.Context()` fires Done → but the
handler is blocked on `backendChan` and does not observe it. The goroutine
sits there forever. With enough disconnects, your process grows unbounded.

The fix is to derive a context-aware select on every blocking operation:

```go
func ok(w http.ResponseWriter, r *http.Request) {
    select {
    case result := <-backendChan:
        w.Write(result)
    case <-r.Context().Done():
        return
    }
}
```

In real code the blocking call is often `database/sql`'s `QueryContext`,
`net/http`'s `Client.Do` with `req.WithContext(ctx)`, or a gRPC call. All of
those take a context. Use it.

### Bug 2 — using `r.Context()` after handler returns

```go
// BUG
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        // r.Context() is cancelled the moment handler returns.
        // This async work is killed before it can do anything useful.
        doAsyncWork(r.Context())
    }()
}
```

When the handler returns, the per-stream context is cancelled (see section 9).
Background work that wants to outlive the request must not derive from
`r.Context()`. Instead:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // Detach from r.Context for fire-and-forget.
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    go func() {
        defer cancel()
        doAsyncWork(ctx)
    }()
}
```

This is a deliberate decoupling. You lose request-scoped values (loggers, trace
IDs); add them back explicitly.

### Bug 3 — Body.Read + ResponseWriter.Write deadlock on HTTP/1.1

On HTTP/1.1, the same TCP connection carries the request body in one direction
and the response in the other. If the client is sending a large body and not
reading any response, and the server's handler tries to write a large response
before consuming the body, the TCP send buffer fills, the server blocks in
`w.Write`, and meanwhile the client is blocked in its `Write` waiting for the
server to read. Classic deadlock.

```go
// DANGEROUS on HTTP/1.1 (works on HTTP/2 because they are separate streams)
func handler(w http.ResponseWriter, r *http.Request) {
    // Write 100 MiB without reading r.Body.
    for i := 0; i < 100; i++ { w.Write(make([]byte, 1<<20)) }
    // Now read the body. Too late.
    io.Copy(io.Discard, r.Body)
}
```

The cure on HTTP/1.1 is to read the body first (or in parallel), or to set
`Content-Length` correctly and use `http.Server.WriteTimeout` so the
connection is severed before the deadlock becomes permanent.

On HTTP/2, request body DATA frames and response DATA frames are independent
streams of frames on the same connection, multiplexed by the framer. There is
no head-of-line block between them. But: if both streams hit their flow-control
windows because the client is not reading, you can still livelock at the
connection's per-connection window. The principle is the same — read the body,
even if you discard it.

### Bug 4 — too many goroutines from a single buggy client

A malicious or buggy client can open one HTTP/2 connection and immediately
issue 250 concurrent streams, each pinned by a handler that blocks on a slow
upstream. You now have 250 goroutines from one client. Multiply by N
connections and your goroutine count explodes.

Defenses:

1. Reduce `MaxConcurrentStreams` (e.g. 50).
2. Set a global semaphore inside your handler:
   ```go
   sem := make(chan struct{}, 5000)
   func handler(w http.ResponseWriter, r *http.Request) {
       select {
       case sem <- struct{}{}:
           defer func() { <-sem }()
       case <-r.Context().Done():
           return
       default:
           http.Error(w, "busy", 503)
           return
       }
       // ... real work ...
   }
   ```
3. Per-IP / per-token rate limits via middleware.
4. Aggressive `IdleTimeout` and `WriteByteTimeout` to evict slow attackers.

### Bug 5 — race between `http.ServeMux` and handler-overrides

Not HTTP/2-specific but bites under load: `http.ServeMux` is a `sync.Mutex`-
protected map. If you register routes at startup (the only sane time), there
is no race. If you mutate routes at runtime, the mutex serializes lookups and
contention scales with goroutine count. Build a snapshot router (radix tree,
chi, julienschmidt/httprouter) and never touch it at runtime.

---

## 20. Diagnosing a stuck server with goroutine profiles

Enable `net/http/pprof` (or expose its handlers behind auth on a dedicated
listener):

```go
import _ "net/http/pprof"

go http.ListenAndServe("127.0.0.1:6060", nil)
```

When the server is stuck or memory-bloated, grab a goroutine profile:

```
curl -o /tmp/goroutine.txt 'http://127.0.0.1:6060/debug/pprof/goroutine?debug=2'
```

`debug=2` produces a text dump grouped by stack. Look for these signatures.

**Healthy idle connection:**

```
1 @ runtime.gopark ... runtime.selectgo
    net/http.(*http2serverConn).serve ...
    net/http.(*http2Server).ServeConn ...
    net/http.(*Server).Serve ...
```

One goroutine per connection, parked in `serve`'s `select`. Plus one in
`(*http2serverConn).readFrames` per connection, parked in
`net.(*conn).Read`. Plus, briefly during writes, one in
`(*http2serverConn).writeFrameAsync` per connection.

**Stuck handler goroutine:**

```
1 @ chan receive ...
    backend.Get ...
    main.handler ...
    net/http.HandlerFunc.ServeHTTP ...
    net/http.serverHandler.ServeHTTP ...
    net/http.(*http2serverConn).runHandler ...
```

This is your culprit: a handler parked on a channel receive (or a mutex, or a
sql.Conn). Cross-reference the stack against your code to find which downstream
dependency is hanging.

**Goroutine leak signature:**

If you see 5000 of the same stack, all parked on the same line of your code,
that line is your leak.

**Stuck control loop (rare but ugly):**

```
1 @ chan send ...
    net/http.(*http2serverConn).writeFrame ...
```

A `writeFrame` parked on a channel send means the writer goroutine has not
posted its result; either the writer is blocked on a slow socket, or someone
above us in the call stack has not consumed `wroteFrameCh`. Either way the
connection is wedged. Check the network stack (`ss -tnp`) for full send-Q;
slow-read attack is the usual cause.

### Quick checklist when goroutines explode

1. `goroutine?debug=2` → group by stack → identify the dominant stack.
2. If the dominant stack is in your handler → context propagation bug.
3. If it's in `http2serverConn.serve` → many connections; check
   `IdleTimeout` and connection-level limits.
4. If it's in `http2serverConn.writeFrameAsync` → slow clients filling kernel
   buffers; check `WriteByteTimeout` and network metrics.
5. If it's in `tls.(*Conn).Handshake` → slow TLS handshakes; consider lower
   `Server.ReadHeaderTimeout` and OCSP stapling.

### Heap profiles for memory leaks

`go tool pprof -alloc_objects -inuse_space http://127.0.0.1:6060/debug/pprof/heap`

For HTTP/2 servers, the usual heap suspects are:

* `(*http2dataBuffer).Read` retainers — streams whose body buffers were not
  drained because the handler never read `r.Body`.
* `responseWriter.bw` — buffered response writers retained because the handler
  did not return.
* `hpack.dynamicTable` — header tables held by HTTP/2 connections; this grows
  with `MaxDecoderHeaderTableSize`.

---

## Putting it together — a debugging story

Suppose you get paged: "API latency p99 jumped from 80ms to 2s, no recent
deploys". The Prometheus metrics show goroutine count climbing linearly.

1. Hit `/debug/pprof/goroutine?debug=2` on the affected process. Grep for the
   top 5 stacks by goroutine count.
2. You see 12,000 goroutines stuck at:
   ```
   chan receive (nil chan)
       main.(*backendClient).Do at backend.go:142
       main.handler at handler.go:33
   ```
   That nil-channel receive is the bug.
3. Look at `handler.go:33` — it does `result := <-backendClient.outCh`. Find
   the call site that constructs `backendClient`; verify `outCh` is properly
   initialized.
4. Discover that a feature flag started constructing the client without
   initializing `outCh`. Every request that path now leaks a goroutine on
   `<-nil`.
5. Roll back the flag. Goroutine count plateaus. Existing leaks remain — the
   stuck goroutines never exit because nil-channel receive blocks forever.
6. Trigger a graceful restart of one replica at a time to flush the leaks.

The senior debugging skill here is not exotic. It is recognizing the HTTP/2
server's normal goroutine topology (one per conn, one per stream, plus a
framer per conn, plus transient writers) so that *anything beyond that* stands
out. Without that baseline, 12,000 goroutines looks scary; with it, you can
say "11,990 of them should not exist".

---

## 21. The body pipe — `http2pipe`

The data path from "DATA frame arrives" to "handler reads `r.Body`" goes
through `http2pipe`, a small bounded in-memory buffer with read and write
ends. It is worth understanding because most "Body.Read returned X" weirdness
ultimately reduces to pipe state.

```go
// h2_bundle.go (paraphrased)
type http2pipe struct {
    mu       sync.Mutex
    c        sync.Cond     // c.L lazily set to &p.mu
    b        http2pipeBuffer // a *http2dataBuffer or nil
    unread   int
    err      error    // set by CloseWithError; returned after b drained
    breakErr error    // set by BreakWithError; returned immediately
    donec    chan struct{}
    readFn   func()   // optional: called once on first Read
}
```

There are two ways to "close" a pipe:

* `CloseWithError(err)` — graceful: existing buffered bytes are still
  returned; only after the buffer drains does the reader see `err`.
* `BreakWithError(err)` — abrupt: even buffered bytes are dropped; the reader
  immediately sees `err`.

The control loop uses `CloseWithError(io.EOF)` when the stream ends naturally
(END_STREAM on the last DATA frame). It uses `BreakWithError(stream cancel
err)` when the stream is RST'd or the connection dies. The choice affects what
handlers see in `r.Body.Read`:

* Graceful close → reader drains buffer, then gets `io.EOF`.
* Abrupt close → reader gets the cancel error on the next `Read`, even if
  there are unread bytes in the buffer.

When you write a `Body.Read` loop in a handler, distinguish:

```go
buf := make([]byte, 32<<10)
for {
    n, err := r.Body.Read(buf)
    if n > 0 {
        process(buf[:n])
    }
    if err == io.EOF {
        return // client finished body cleanly
    }
    if err != nil {
        // RST_STREAM, conn loss, ctx cancel: client gave up
        return
    }
}
```

The `if n > 0` before `if err` check is mandatory — `Read` can return both
bytes and an error in the same call, and skipping the bytes is a data-loss
bug.

`http2dataBuffer` itself is a growable circular buffer with chunked storage.
It avoids the worst-case linear realloc when streaming uploads grow.
Per-stream and per-connection caps come from `MaxUploadBufferPerStream` and
`MaxUploadBufferPerConnection`.

---

## 22. HPACK header table — shared decoder state

HTTP/2 compresses headers with HPACK (RFC 7541). The HPACK decoder has a
dynamic table whose state is *shared across all streams on the connection*.
That makes the decoder a connection-level resource that must be touched only
by the framer/control-loop side.

A subtle implication: a single buggy stream that violates HPACK invariants
(e.g. an index beyond the table) does not just break that stream — it breaks
the whole connection, because the decoder state is now out of sync with the
peer's encoder. The protocol mandates GOAWAY with COMPRESSION_ERROR for any
HPACK violation. Go's framer detects this and the control loop closes the
connection.

`MaxDecoderHeaderTableSize` (the server's receive-side limit) controls how
much memory the dynamic table can occupy. Increasing it helps clients that
send repetitive headers (typical microservices traffic with the same auth
headers per call). The default is 4 KiB.

The encoder side has its own table, sized by `MaxEncoderHeaderTableSize`. The
client also has a limit, advertised in its SETTINGS. The server's encoder
respects the smaller of its own size and the client's advertised size.

---

## 23. The PRIORITY (deprecated) and write scheduler

RFC 7540 defined a stream priority tree where each stream could declare a
parent and a weight, and the server scheduler was supposed to allocate
bandwidth proportionally. In practice nobody used this correctly and RFC 9113
deprecated it. The stdlib still parses PRIORITY frames but the default
scheduler ignores their tree structure.

The current default scheduler is `http2roundRobinWriteScheduler` (since
Go 1.21 or so), which gives each open stream an equal slice of the connection
bandwidth in round-robin order. Control frames (PING, SETTINGS, WINDOW_UPDATE,
RST_STREAM, GOAWAY) bypass the per-stream queues and ship immediately.

If you have a use case that needs custom prioritization — say, an interactive
endpoint that should preempt bulk downloads — you can supply a custom
scheduler:

```go
http2.ConfigureServer(srv, &http2.Server{
    NewWriteScheduler: func() http2.WriteScheduler {
        return myCustomScheduler{}
    },
})
```

In 99% of cases the default round-robin is the right choice. Custom
schedulers are advanced terrain; one bug stalls all writes on a connection.

---

## 24. ConnContext, BaseContext, and per-connection state

`http.Server` exposes two context hooks:

```go
type Server struct {
    // BaseContext returns the base context for incoming requests. If unset,
    // the default is context.Background().
    BaseContext func(net.Listener) context.Context

    // ConnContext optionally specifies a function that modifies the context
    // used for a new connection. The provided ctx is derived from BaseContext.
    ConnContext func(ctx context.Context, c net.Conn) context.Context
}
```

`BaseContext` runs once per `Listen`. `ConnContext` runs once per accepted
connection. Both produce contexts that are then ancestors of every request
context on that listener / connection.

For HTTP/2, this means `r.Context()`'s ancestor chain is:

```
context.Background()
  └── BaseContext result
        └── ConnContext result
              └── per-stream context (cancel = stream end)
```

You can stash a connection-local value (e.g. peer cert info, request ID
seed, observability tags) into the connection context and every stream on
that connection inherits it. This is the only way to get per-connection state
without a global map.

```go
type peerKey struct{}

srv := &http.Server{
    ConnContext: func(ctx context.Context, c net.Conn) context.Context {
        if tc, ok := c.(*tls.Conn); ok {
            // Lazily reads handshake state at first use.
            return context.WithValue(ctx, peerKey{}, tc.RemoteAddr())
        }
        return ctx
    },
}
```

Inside handlers: `peer, _ := r.Context().Value(peerKey{}).(net.Addr)`.

---

## 25. Behind the curtain — how requests become handlers on h2

When a HEADERS frame arrives on a new stream, `(*http2serverConn).processHeaders`
does roughly this:

```go
func (sc *http2serverConn) processHeaders(f *http2MetaHeadersFrame) error {
    sc.serveG.check()
    id := f.StreamID
    if sc.inGoAway { /* RST_STREAM REFUSED_STREAM and return */ }
    // Reject if already a known stream, even-id (server-initiated reserved),
    // or below the high water mark.
    if id%2 == 0 || id <= sc.maxClientStreamID { /* PROTOCOL_ERROR */ }
    sc.maxClientStreamID = id

    if sc.curOpenStreams() >= sc.advMaxStreams {
        // RST_STREAM REFUSED_STREAM; the client must retry.
        return sc.writeFrame(http2FrameWriteRequest{
            write:  http2writeRSTStream{id, http2ErrCodeRefusedStream},
        })
    }

    st := sc.newStream(id, 0, http2stateOpen)
    sc.streams[id] = st
    st.body = http2newPipe()
    st.declBodyBytes = f.PseudoValue("content-length")...

    req, err := sc.newWriterAndRequest(st, f)
    if err != nil { /* RST_STREAM and return */ }
    rw := st.responseWriter()

    go sc.runHandler(rw, req, sc.handler.ServeHTTP)
    return nil
}
```

Two interesting bits:

1. The handler goroutine is spawned **inside** the control loop's iteration.
   That means the control loop briefly does `go runHandler(...)`, then keeps
   reading. If your `Server.Handler` is `http.DefaultServeMux`, the mux's
   per-request work happens on the *handler* goroutine, never on the control
   loop — so a slow regex match in your router never blocks frame processing.
2. `sc.newWriterAndRequest` constructs the `*http.Request` synchronously,
   reading pseudo-headers, building the URL, validating the host. If it errors,
   the stream is reset and no handler is spawned. Common cause: invalid `:path`
   pseudo-header from a malicious client.

The handler goroutine's stack will look like:

```
sc.runHandler
  serverHandler{sc.hs}.ServeHTTP        // type defined in net/http/server.go
    (your *http.ServeMux).ServeHTTP
      your handler
```

`serverHandler` is the tiny adapter (`net/http/server.go` around line 2900)
that delegates to `Server.Handler` or `DefaultServeMux`.

---

## 26. ResponseWriter implementation peek

The HTTP/2 ResponseWriter is `*http2responseWriter`. It is a thin wrapper
around `*http2responseWriterState`:

```go
type http2responseWriter struct {
    rws *http2responseWriterState
}

type http2responseWriterState struct {
    stream *http2stream
    req    *Request
    body   *http2requestBody // for waiting for trailers
    conn   *http2serverConn

    bw *bufio.Writer // writing to a chunkWriter that posts to wantWriteFrameCh

    handlerHeader http.Header
    snapHeader    http.Header
    trailers      []string

    status        int
    wroteHeader   bool
    sentHeader    bool
    handlerDone   bool

    sentContentLen int64
    wroteBytes     int64

    closeNotifierMu sync.Mutex
    closeNotifierCh chan bool
}
```

`bw` is the buffered writer. `Write` calls funnel into `bw.Write`. The
backing `io.Writer` is an internal `chunkWriter` that converts buffered
bytes into DATA frames and posts them to the control loop.

`Flush` calls `bw.Flush()`, which forces the buffered bytes into DATA frames
and sends them right away. Without `Flush`, your bytes may sit in `bw` until
the handler returns.

`CloseNotify` (legacy interface `http.CloseNotifier`, deprecated in favor of
`r.Context()`) returns a channel that closes when the client disconnects.
HTTP/2 implements it by deriving from the stream context.

---

## 27. Trailers — the easy-to-miss feature

HTTP/2 supports trailing headers cleanly (HTTP/1.1 supports them too via
chunked encoding, but in practice almost nothing emits them). To send
trailers from a handler:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Trailer", "X-Compute-Time")
    w.WriteHeader(200)
    fmt.Fprintln(w, "body...")
    w.Header().Set("X-Compute-Time", fmt.Sprintf("%dms", 42))
}
```

The first `w.Header().Set("Trailer", ...)` declares which trailer names will
be sent. The actual values are set in `w.Header()` after `WriteHeader`. When
the handler returns, the stdlib emits a final HEADERS frame containing the
trailers and sets END_STREAM.

Alternative: prefix the trailer name with `http.TrailerPrefix`
(`"Trailer:"`) at write-time, which avoids declaring it up front. This is
useful when the set of trailer names depends on the response body:

```go
w.Header().Set(http.TrailerPrefix+"X-Final-Hash", hash.Sum())
```

gRPC uses this heavily — the `grpc-status` and `grpc-message` are trailers,
which is why gRPC needs HTTP/2 specifically.

---

## 28. Two-listener pattern — h2 internal, h1+h2 external

A common production deployment: external traffic terminates TLS at an
ingress / load balancer that speaks HTTP/2 to clients but HTTP/1.1 to your
service. Internal traffic between services is plain HTTP/2 (h2c) for low
overhead. You end up with two listeners:

```go
// External: HTTP/1.1 over plain TCP. The ingress handles TLS+h2.
extSrv := &http.Server{
    Addr:    ":8080",
    Handler: extHandler,
    TLSNextProto: map[string]func(*Server, *tls.Conn, Handler){}, // h2 off
}
go extSrv.ListenAndServe()

// Internal: h2c.
intH2 := &http2.Server{ MaxConcurrentStreams: 1000 }
intSrv := &http.Server{
    Addr:    ":8081",
    Handler: h2c.NewHandler(intHandler, intH2),
}
go intSrv.ListenAndServe()
```

This split is common because:

* External clients are diverse (browsers, mobile apps, third parties); HTTP/1.1
  via the LB is simplest.
* Internal clients are your own Go services using `http.Transport` with
  `ForceAttemptHTTP2 = true`; h2c lets you skip TLS overhead.

Be aware: HTTP/1.1 over TCP is *not* the same as h2c. The handler code is
identical; the concurrency model differs. The HTTP/1.1 server gives you one
goroutine per connection (and one per request, which is the same thing for
HTTP/1.1 because each connection serves one request at a time, modulo
pipelining which is essentially unused). HTTP/2 gives you one per stream.

---

## 29. Server-Sent Events and HTTP/2

SSE is "one HTTP response with a streaming body". It works on both HTTP/1.1
and HTTP/2 in Go. On HTTP/2 it works *better* because the connection is
multiplexed: a single HTTP/2 connection can support many concurrent SSE
streams without consuming an OS file descriptor per stream.

Implementation skeleton:

```go
func sse(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "streaming not supported", 500)
        return
    }
    ctx := r.Context()
    for {
        select {
        case <-ctx.Done():
            return
        case event := <-eventCh:
            fmt.Fprintf(w, "data: %s\n\n", event)
            flusher.Flush()
        }
    }
}
```

Two issues to watch for on HTTP/2:

1. `Flush` is essential; without it bytes pile up in the bufio writer and the
   client sees no events until the buffer fills (often megabytes).
2. The connection cannot drain on graceful shutdown until the stream
   completes. SSE streams are by definition long-lived. Set
   `Server.Shutdown(ctx)` with a deadline appropriate for forcing SSE
   handlers to exit, and have your handler check `ctx.Done()` aggressively.

---

## 30. Tuning checklist for a production HTTP/2 server

When you stand up a new HTTP/2 service, set these explicitly. Defaults are
not always production-safe.

```go
h2 := &http2.Server{
    MaxConcurrentStreams:          250,
    MaxReadFrameSize:              1 << 20,
    IdleTimeout:                   2 * time.Minute,
    ReadIdleTimeout:               1 * time.Minute,
    PingTimeout:                   15 * time.Second,
    WriteByteTimeout:              30 * time.Second,
    MaxUploadBufferPerStream:      1 << 20,
    MaxUploadBufferPerConnection: 4 << 20,
}
srv := &http.Server{
    Addr:              ":443",
    Handler:           handler,
    ReadHeaderTimeout: 10 * time.Second,
    BaseContext: func(_ net.Listener) context.Context {
        return rootCtx
    },
    ConnContext: func(ctx context.Context, c net.Conn) context.Context {
        return context.WithValue(ctx, connStartKey{}, time.Now())
    },
    ErrorLog: log.New(os.Stderr, "http: ", log.LstdFlags),
    TLSConfig: tlsCfg, // with min version TLS 1.2 and h2 in NextProtos
}
http2.ConfigureServer(srv, h2)

go func() {
    sig := waitForSignal()
    log.Printf("got %v, draining", sig)
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(ctx); err != nil {
        log.Printf("shutdown: %v", err)
        srv.Close()
    }
}()

log.Fatal(srv.ListenAndServeTLS(certFile, keyFile))
```

Notes on each line:

* `ReadHeaderTimeout` defends against slow-headers attacks (Slowloris).
* `IdleTimeout` reclaims idle connections.
* `ReadIdleTimeout` + `PingTimeout` detect dead clients on long-lived
  connections (essential for SSE / streaming).
* `WriteByteTimeout` defends against slow-read attacks.
* `MaxUploadBufferPerStream/Connection` caps server memory under malicious
  pressure.
* `BaseContext` is the right place to inject a shutdown context that you can
  cancel to drain background work.
* The 30s `Shutdown` deadline is a balance: long enough to let in-flight
  RPCs finish, short enough that a stuck handler does not block a deploy.

---

## 31. Final mental model

If you remember nothing else from this page, remember the goroutine ledger
for a healthy HTTP/2 server:

```
N TCP connections
  N connection control-loop goroutines (sc.serve)
  N framer goroutines (sc.readFrames)
  0..N transient writer goroutines (sc.writeFrameAsync)
  Σ open streams per connection -> goroutines (sc.runHandler -> your handler)
```

Total = `2N + Σstreams + occasional_writers`.

If the actual count is higher than this, you have a leak. Find the dominant
stack in a goroutine profile, find the line of your code that appears,
trace back to a missing context-aware select or a goroutine spawned without
a cancellation path. The 99% case is one of these two bugs.

The HTTP/2 server is more complex than HTTP/1.1, but the complexity is
**structured**: a fixed topology of goroutines coordinating via well-defined
channels. Once you can recite that topology from memory, debugging a stuck
server becomes routine.

---

## Summary

* The HTTP/2 server in `net/http` is generated from `golang.org/x/net/http2`
  and lives in `h2_bundle.go`. It is engaged via TLS ALPN ("h2") through
  `Server.TLSNextProto`.
* Each HTTP/2 connection runs a control loop (`(*http2serverConn).serve`),
  a framer goroutine (`readFrames`), transient writer goroutines
  (`writeFrameAsync`), and one handler goroutine per stream.
* The control loop is single-threaded; state mutations are serialized via
  channels (`readFrameCh`, `wantWriteFrameCh`, `wroteFrameCh`, `bodyReadCh`,
  `serveMsgCh`).
* Flow control runs at two levels (stream and connection); handlers must
  consume bodies promptly to allow WINDOW_UPDATE to flow.
* `MaxConcurrentStreams`, `IdleTimeout`, `WriteByteTimeout`,
  `MaxUploadBufferPerStream` are the senior-level knobs.
* `r.Context()` cancellation is the only reliable cancellation signal for
  handlers; propagate it into every downstream call.
* `http.ResponseWriter` is not concurrency-safe; serialize writes through a
  single goroutine.
* HTTP/2 does not support `http.Hijacker`; do not depend on it for routes that
  may run over h2.
* Graceful shutdown on HTTP/2 sends GOAWAY and waits for streams to complete
  up to LastStreamID, then force-closes.
* When debugging, goroutine profiles plus knowledge of the normal HTTP/2
  topology let you spot leaks instantly.

The HTTP/2 server is a sophisticated concurrent state machine implemented in
roughly 5000 lines of generated code. Knowing its shape — not memorizing every
line — is what separates senior debugging from cargo-culted "restart the pod"
incident response.

---

[← Back](../)
