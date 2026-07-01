# Long-Polling & Streaming — Theory and Formal Foundations

The polling family — short-poll, long-poll, and HTTP streaming — is the set of techniques that emulate server push over a request/response transport that was never designed for it. They are not interchangeable: each occupies a distinct point on a two-dimensional frontier of **delivery latency** versus **request/overhead rate**, and each carries different consequences for delivery semantics under failure. This document builds a quantitative model of that frontier, formalizes the chunked-transfer mechanism that makes streaming possible without a `Content-Length`, reconstructs the Comet lineage that first exploited it, and analyzes the message-gap race that governs at-most-once versus at-least-once versus exactly-once delivery.

## Table of Contents

1. [The Problem: Push Over a Pull Transport](#1-the-problem-push-over-a-pull-transport)
2. [A Latency & Overhead Model](#2-a-latency--overhead-model)
3. [The Comparison Table](#3-the-comparison-table)
4. [Chunked Transfer Encoding, Formally](#4-chunked-transfer-encoding-formally)
5. [Staged Chunked-Stream Framing](#5-staged-chunked-stream-framing)
6. [The Comet Pattern and Its Techniques](#6-the-comet-pattern-and-its-techniques)
7. [Delivery Semantics and the Message-Gap Race](#7-delivery-semantics-and-the-message-gap-race)
8. [Cursors, Idempotency, and Exactly-Once](#8-cursors-idempotency-and-exactly-once)
9. [Decision Framework](#9-decision-framework)
10. [Summary](#10-summary)

---

## 1. The Problem: Push Over a Pull Transport

HTTP/1.x is a strict request/response protocol: the client speaks first, the server answers, the exchange terminates. There is no message primitive by which a server can spontaneously deliver data to an idle client. Yet a large class of applications — chat, notifications, live scores, collaborative editing, market data, progress bars — is fundamentally *server-initiated*: the event that must reach the client originates on the server at an unpredictable time.

The polling family resolves this impedance mismatch by inverting who bears the cost of the missing primitive. There are three canonical strategies:

- **Short-polling.** The client issues a request every `T` seconds; the server answers *immediately* with whatever is available (possibly nothing). Simplicity is total — it is ordinary HTTP — but the client pays with wasted requests and the server pays with load proportional to `1/T` per client.
- **Long-polling.** The client issues a request; the server *holds it open* until an event is ready (or a timeout fires), then answers and the client immediately re-requests. The hold converts idle round-trips into a single suspended connection, collapsing latency toward zero while eliminating empty responses.
- **Streaming.** The client issues one request; the server *never closes* the response body, instead appending each event to a single, long-lived, incrementally-flushed stream. One request amortizes across the entire session.

The three differ only in *how long the server holds the response and how many events it delivers per request*. Everything else — the latency curve, the overhead curve, the delivery-semantics analysis — follows from that single axis.

---

## 2. A Latency & Overhead Model

Let events arrive at the server destined for a particular client. We analyze the *delivery latency* `L` (time from event availability to client receipt) and the *request rate* `R` (HTTP requests per unit time), which is the dominant cost driver because each request carries fixed protocol overhead.

### 2.1 Short-poll

Fix a poll interval `T`. Suppose an event becomes available at a uniformly random instant within a poll cycle. The client will not learn of it until the *next* poll boundary. The wait until that boundary is uniform on `[0, T]`, so:

```
E[L_short] = T / 2         (plus one network RTT for the fetch)
R_short    = 1 / T         (requests per second, per client, unconditionally)
```

This is the central tension of short-polling, stated as a hyperbola: **latency and request rate are inversely coupled through the single knob `T`.** Halving mean latency (halving `T`) doubles the request rate. There is no `T` that makes both small.

Overhead is worse than the request count alone suggests, because most polls return *nothing*. If events arrive at rate `λ` (per client) and you poll at rate `1/T`, the fraction of *useful* polls is at most `λT` (for `λT < 1`). The **overhead ratio** — HTTP requests per delivered message — is:

```
requests-per-message ≈ (1/T) / λ = 1 / (λT)
```

For a client that receives one event per minute but polls every 2 seconds, that is 30 requests per delivered message. Each carries request line, headers (cookies, `User-Agent`, `Authorization`, `Accept`), and a response with its own headers. On a typical stack a bare request/response pair is 400 B–1.5 KB of headers before any payload; at 30:1 the header overhead dwarfs the message.

### 2.2 Long-poll

The server holds the request until an event is ready. Ignoring network transit and server dispatch time, an available event is delivered *immediately*:

```
E[L_long] ≈ RTT/2 + t_dispatch     (near-zero application wait)
R_long    ≈ λ + 1/T_timeout        (one request per event, plus timeout re-polls)
```

Request rate now tracks the *event rate* `λ` rather than an arbitrary poll frequency, plus a small floor from the long-poll timeout `T_timeout` (typically 30–120 s) that exists to defend against dead proxies and NAT idle-eviction. The **overhead ratio approaches 1:1** during active periods: one request delivers one event (or one small batch). This is the decisive win of long-poll over short-poll — you pay per *event*, not per *unit time*.

The catch is the re-arm gap (Section 7): between the server answering and the client re-requesting, the connection is closed, and any event arriving in that window is not immediately deliverable.

### 2.3 Streaming

One request, held open indefinitely, with events flushed as chunks:

```
E[L_stream] ≈ RTT/2 + t_flush      (near-zero, and no re-arm gap)
R_stream    ≈ 1 / session_length   (one request per connection lifetime)
```

Request rate collapses to essentially *one request per session*. Per-message header overhead is now only the framing bytes (chunk-size line + CRLFs, ~5–12 B), because HTTP headers are sent exactly once at stream open. For high-frequency, bursty streams (many events per second), streaming is the only member of the family whose overhead does not grow with event rate.

### 2.4 The frontier

Placing all three on the (latency, request-rate) plane:

- Short-poll traces the hyperbola `R = 1/(2 E[L])` — you buy latency with requests.
- Long-poll drops off that hyperbola: latency ≈ 0 while `R ≈ λ`.
- Streaming pushes further: latency ≈ 0 while `R ≈ 1/session`.

The progression short → long → stream is a monotone improvement on *both* axes, purchased with increasing statefulness on the server (each held connection consumes a socket, a file descriptor, and often a thread or an async task).

---

## 3. The Comparison Table

| Dimension | Short-poll | Long-poll | HTTP Streaming |
|---|---|---|---|
| Mean delivery latency | `T/2` (+RTT) | ≈ 0 (+RTT) | ≈ 0 (+RTT), no re-arm gap |
| Request rate per client | `1/T` (constant) | ≈ `λ` + timeout floor | ≈ `1/session` |
| Requests per delivered msg | `1/(λT)` (often ≫ 1) | ≈ 1 | ≈ 0 (amortized) |
| Header overhead per msg | full req+resp headers | full req+resp headers | ~5–12 B chunk framing |
| Held connections | none (bursty) | 1 per waiting client | 1 per client, persistent |
| Server memory footprint | lowest | 1 suspended req/client | 1 open stream/client |
| Re-arm gap risk | large (`T`) | small (RTT) | none |
| Empty responses | frequent | none (timeout only) | none |
| Content-Length | present | present | absent (chunked/close) |
| Proxy/intermediary friction | none | idle-timeout eviction | buffering breaks flush |
| Ordering guarantee | needs cursor | needs cursor | in-order by stream |
| Direction | client→server pull | client→server pull | server→client push |
| Native browser API | `fetch` loop | `fetch` loop | `EventSource` / `fetch` reader |
| Failure recovery | trivial (next poll) | reconnect + cursor | reconnect + `Last-Event-ID` |
| Best fit | rare events, simplicity | moderate rate, low latency | high rate, low latency |

The table encodes the thesis of Section 2: as you move right, latency improves and per-message overhead falls, but connection statefulness and intermediary sensitivity rise. Short-poll is the only column with *zero* held state and the only one whose overhead is decoupled from event rate — which is precisely why it is wasteful when events are rare and expensive when latency must be low.

---

## 4. Chunked Transfer Encoding, Formally

Streaming over HTTP/1.1 rests on one mechanism: **chunked transfer encoding** (`Transfer-Encoding: chunked`). Its purpose is to let the server begin (and continue) sending a response body of *unknown, unbounded* length. Without it, HTTP/1.0 offered only two ways to delimit a body — a known `Content-Length`, or "read until the connection closes." A stream has neither a known length nor a desire to close, so chunked encoding supplies a third framing: a self-delimiting sequence of length-prefixed chunks.

### 4.1 Grammar

The body is a sequence of chunks terminated by a zero-length chunk, defined (RFC 7230 §4.1) as:

```
chunked-body = *chunk
               last-chunk
               trailer-part
               CRLF

chunk        = chunk-size [ chunk-ext ] CRLF
               chunk-data CRLF
chunk-size   = 1*HEXDIG            ; length of chunk-data, in hex octets
last-chunk   = 1*("0") [ chunk-ext ] CRLF
```

Each chunk is: a **hexadecimal size** on its own line, `CRLF`, exactly that many payload octets, then a trailing `CRLF`. The stream ends with a chunk whose size is `0`, optionally followed by trailer headers, then a final blank line.

### 4.2 Why this enables streaming

Three properties make chunked encoding the substrate for HTTP streaming:

1. **No Content-Length required.** The size is carried per-chunk, so the server never needs to know the total body length in advance. It can generate and flush a chunk the instant an application event is ready.
2. **Self-delimiting at the message layer.** The receiver reads the hex size, then reads exactly that many bytes, then expects `CRLF`. This lets the parser recover message boundaries *within* one continuous byte stream — the framing the raw TCP stream lacks.
3. **Explicit, in-band termination.** The `0`-length chunk is an unambiguous end-of-body marker that does not require closing the connection. This is what allows a *persistent* (keep-alive) connection to be reused after a chunked response completes — and, conversely, why a never-terminating stream simply *never sends* the zero chunk.

For a long-lived event stream, the server sends the initial status line and headers (including `Transfer-Encoding: chunked`), then emits one chunk per event indefinitely, **flushing after each** so intermediaries and the client see it immediately. The zero-chunk is sent only when the server deliberately ends the stream.

### 4.3 The flush and buffering hazard

Chunked framing is necessary but not sufficient. If any layer buffers — an application-server output buffer, a reverse proxy accumulating a response, `nginx`'s `proxy_buffering on`, a compression filter waiting to fill a window — the chunk is written into the pipe but not *delivered*, defeating the near-zero latency the model promises. Correct streaming requires an explicit flush at every layer and often `X-Accel-Buffering: no` (nginx) or equivalent to disable intermediary buffering. This is the single most common cause of "my stream works locally but not in production": the framing is correct, but a proxy is holding the chunks.

### 4.4 Trailers

Because the size and status are committed at stream open, chunked encoding permits **trailer headers** after the last chunk — metadata (a checksum, a final status, a signature) that could only be computed once the body was fully generated. Trailers are rarely used in browser streaming (support is thin) but are structurally important in gRPC-over-HTTP/2, where the terminal status travels as a trailer.

### 4.5 Under HTTP/2 and HTTP/3

HTTP/2 and HTTP/3 abolish `Transfer-Encoding: chunked` — framing is native to the protocol's binary layer (DATA frames on a stream). The *semantics* are unchanged: a response can omit `content-length` and remain open, delivering DATA frames as events occur, closed by an `END_STREAM` flag rather than a zero-length chunk. Everything in Sections 2, 6, and 7 carries over; only the wire framing differs.

---

## 5. Staged Chunked-Stream Framing

The diagram traces a single streaming response through its life: header commit, three event chunks flushed at different times, and deliberate termination.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (reader)
    participant P as Proxy (flush-through)
    participant S as Server (stream)

    Note over C,S: Stage 1 — Open & commit headers (once)
    C->>S: GET /events (Accept: text/event-stream)
    S-->>C: 200 OK<br/>Transfer-Encoding: chunked<br/>(no Content-Length)

    Note over C,S: Stage 2 — Event A ready → emit chunk, FLUSH
    S-->>P: "1a\r\n" + 26 octets + "\r\n"
    P-->>C: chunk A delivered (flush, no buffering)
    Note right of C: parse size=0x1a → read 26B → expect CRLF

    Note over C,S: Stage 3 — idle; connection held open (no chunk sent)
    Note over S: no zero-chunk → stream stays alive

    Note over C,S: Stage 4 — Event B ready → next chunk, FLUSH
    S-->>P: "2f\r\n" + 47 octets + "\r\n"
    P-->>C: chunk B delivered

    Note over C,S: Stage 5 — Event C ready → next chunk, FLUSH
    S-->>C: "9\r\n" + 9 octets + "\r\n"

    Note over C,S: Stage 6 — Deliberate end → zero-length chunk
    S-->>C: "0\r\n" + [trailers] + "\r\n"
    Note right of C: size 0 ⇒ end-of-body; connection may be reused
```

The load-bearing detail is **Stage 3**: during idle periods the server sends *nothing at all* — not a heartbeat framing, not an empty chunk — and the stream survives purely because the zero-chunk (Stage 6) has not been sent. In practice a periodic keep-alive comment (e.g. an SSE `:` line inside a chunk) is emitted every ~15–30 s to keep NATs and proxies from evicting an "idle" connection, but that is defense against intermediaries, not a protocol requirement.

---

## 6. The Comet Pattern and Its Techniques

Before `WebSocket` (2011) and `EventSource`/SSE standardization, "server push in the browser" was achieved through a family of hacks collectively named **Comet** (coined ~2006 by Alex Russell, a pun on Ajax — both are cleaning products). Comet is not a protocol; it is a *pattern* — "use a persistent HTTP connection to push data from server to browser" — realized through whatever mechanism the browser of the era would tolerate. Understanding it is worthwhile because the modern APIs are its direct, standardized descendants, and its constraints still explain today's failure modes.

Comet had two principal transport techniques, plus long-polling as the fallback:

- **Hidden `<iframe>` (a.k.a. "forever frame").** The page embeds an invisible iframe whose `src` points to an endpoint that returns a *never-ending* chunked HTML document. The server periodically flushes a `<script>…</script>` tag into the still-open document; the browser, parsing incrementally, executes each script the moment it arrives, invoking a callback in the parent frame. The open document *is* the event stream. This worked in every browser that streamed HTML but leaked the "still loading" indicator and required careful escaping of pushed data into executable script.

- **XHR streaming (`multipart/x-mixed-replace` or raw text).** A single `XMLHttpRequest` is issued; the client reads `xhr.responseText` incrementally in `readyState 3` (LOADING) as chunks arrive, parsing off the new bytes since the last read. Some servers used `multipart/x-mixed-replace` so each event was a MIME part that "replaced" the last. The pitfall: `responseText` grows unboundedly for the life of the connection (the browser retains the whole accumulated body), forcing periodic connection recycling to release memory — the direct ancestor of SSE's reconnect behavior.

- **Long-polling** (the resilient fallback): when streaming was blocked by an intermediary that buffered responses, Comet libraries degraded to long-poll, which looks like ordinary request/response to every proxy and therefore traverses hostile networks that break streaming.

The lineage is exact:

| Comet-era technique | Standardized successor |
|---|---|
| XHR streaming (text/event-stream by convention) | **Server-Sent Events** (`EventSource`) |
| Forever-frame / bidirectional hacks | **WebSocket** |
| Long-poll fallback | still used verbatim (e.g. transport fallback in `socket.io`) |
| `responseText` incremental read | **Streams API** (`fetch().body.getReader()`) |

SSE in particular is Comet's XHR-streaming technique frozen into a spec: a `text/event-stream` body, `data:`-prefixed frames, automatic reconnection, and a `Last-Event-ID` cursor for gap-free resumption — which brings us to delivery semantics.

---

## 7. Delivery Semantics and the Message-Gap Race

All three polling strategies must answer: *if the client is momentarily not connected — between a long-poll response and its re-request, or between a dropped stream and its reconnect — what happens to events that arrive during that gap?* The answer defines the delivery semantics.

### 7.1 The re-arm gap

Consider long-poll. The timeline of one cycle:

```
   t0        t1              t2                 t3
   |---------|---------------|------------------|----->
  req      event E1        server              client
  held    delivered,       responds,          re-requests
          response         connection          (new held req)
          begins           CLOSED

                        └──── re-arm gap ────┘
                        events here are at risk
```

Between `t2` (connection closed) and `t3` (new request arrives and is registered as a waiter), the server has no open channel to this client. Call this window the **re-arm gap**, of duration ≈ one RTT plus client processing. Any event `E2` published in `(t2, t3)` races against the client's re-request:

- If the server **buffers** `E2` (or the client sends a **cursor** identifying the last event it saw), `E2` is delivered on the next poll → **at-least-once**.
- If the server **drops** `E2` because no waiter was registered when it published → **at-most-once** (a lost message).

Streaming shrinks this gap to zero *during* a healthy connection (no re-arm), but the identical race reappears on **reconnect** after a network drop: events published between disconnect and successful reconnect are subject to the same fork.

### 7.2 The three semantics

- **At-most-once.** The server pushes into whatever connection is currently open and forgets. Simple, stateless, lowest overhead — and lossy across every gap. Acceptable only for events where loss is tolerable (e.g. a live cursor position where the *next* update supersedes the lost one).

- **At-least-once.** The server retains events (a buffer, a log, or a durable queue) and the client acknowledges progress via a cursor. On reconnect the client presents its cursor; the server replays everything after it. Because a client may reconnect *after* it received `E2` but *before* it persisted the acknowledgment, `E2` can be redelivered → duplicates are possible. This is the pragmatic default for reliable delivery.

- **Exactly-once.** No transport delivers this natively; it is *synthesized* from at-least-once delivery plus **idempotent processing**. The producer assigns each event a monotonic id (the cursor domain); the consumer deduplicates on that id. "Exactly-once" is thus "at-least-once transport + at-most-once *effect*." Section 8 makes this precise.

### 7.3 Ordering

A single stream delivers in send order by construction (the chunks are a serial byte stream). But across a reconnect that switches servers, or across parallel long-polls, ordering is *not* guaranteed unless the cursor encodes a total order. Reliable systems therefore make the cursor a **monotone sequence** so that "everything after cursor `c`, in cursor order" is well-defined regardless of which server serves the replay.

---

## 8. Cursors, Idempotency, and Exactly-Once

The cursor is the single mechanism that upgrades a lossy, racy transport into a reliable one. Formally, let the server assign every event a strictly increasing id from a totally ordered domain (a monotonic counter, a log offset, a hybrid logical clock). The protocol invariant is:

> The client persists the id of the last event it has *durably processed*, call it `c`. On every (re)connection it presents `c`. The server's contract is to deliver, in id order, exactly the events with id `> c`.

This invariant delivers **at-least-once**: no event with id `> c` is ever skipped, because the client only advances `c` after processing. It permits **duplicates**, because a crash after processing `E` but before persisting `c := id(E)` causes `E` to be redelivered.

To reach **exactly-once effect**, the consumer must make processing idempotent with respect to the id:

```
on receive(event e):
    if e.id <= c: discard          # already seen (dedup)
    else:
        apply(e)                   # must be idempotent OR
        c := e.id                  # atomically committed with apply()
```

Two implementation strategies bound the correctness:

1. **Dedup by id.** Keep a set (or high-water mark) of processed ids; discard any `e.id ≤ c`. With a *monotone* stream and in-order delivery, the high-water mark `c` alone suffices — a duplicate necessarily has `id ≤ c`.
2. **Atomic apply-and-advance.** Commit the side effect and the cursor advance in one transaction. If they cannot be atomic (side effect is an external system), the side effect itself must be idempotent (e.g. keyed by `e.id`), so a redelivery is a no-op.

This is exactly the machinery SSE standardizes: each event may carry an `id:` field; the browser stores it and re-sends it as the `Last-Event-ID` request header on automatic reconnection. The server replays from that id. SSE gives you the *transport* half (at-least-once, ordered, resumable); the *effect* half (dedup / atomicity) is the application's responsibility. No amount of transport engineering removes that obligation — which is the enduring lesson of the whole polling family: **the network gives you at-least-once; exactly-once is something you build on top.**

---

## 9. Decision Framework

Reduce the choice to three questions, answered in order:

1. **How rare are events, and how tolerant is latency?** If events are rare *and* multi-second latency is acceptable (a dashboard refreshed on human timescales), short-poll's zero held state and trivial recovery win outright. Do not hold connections you don't need.

2. **Is the traffic bidirectional or purely server→client?** If the client must *also* send frequently and interactively (a game, a collaborative editor with fine-grained cursors), you have outgrown the polling family — use WebSocket. If it is one-directional server push, streaming (SSE) is the natural fit; long-poll is the fallback when intermediaries buffer streams.

3. **What are the reliability requirements across gaps?** If any loss is tolerable, at-most-once push is cheapest. If not, commit to a cursor and design the consumer for idempotency *before* shipping — retrofitting exactly-once semantics onto a lossy push system is a rewrite, not a patch.

A practical default for reliable server→client push in a browser: **SSE with an `id`-cursored, replayable backend**, degrading to **long-poll** where proxies break the stream. This combines near-zero latency, ~1:framing-bytes overhead, in-order delivery, and resumable at-least-once semantics, with a fallback that survives hostile networks.

---

## 10. Summary

- The polling family differs on one axis — **how long the server holds the response** — and everything else follows: latency, overhead, and semantics.
- Short-poll obeys the hyperbola `E[L] = T/2`, `R = 1/T`: latency and request rate are inversely coupled through one knob, and the requests-per-message ratio `1/(λT)` makes it wasteful when events are rare relative to poll frequency.
- Long-poll drops off that hyperbola — latency ≈ 0, one request *per event* — at the cost of a suspended connection per client and a small **re-arm gap**.
- Streaming amortizes to one request per session with only chunk-framing overhead per message, but demands **flush-through at every layer** and is the most sensitive to buffering intermediaries.
- **Chunked transfer encoding** is the enabling substrate: per-chunk hex sizes remove the need for `Content-Length`, make the byte stream self-delimiting, and use a **zero-length chunk** as explicit, in-band termination — so a stream simply never sends it.
- **Comet** (forever-frame, XHR streaming, long-poll fallback) is the historical pattern from which SSE, WebSocket, and the Streams API are direct descendants.
- Across every gap, the transport gives you **at-least-once at best**; **exactly-once** is synthesized from cursors (monotone ids) plus **idempotent, atomically-advanced consumers** — a responsibility that lives in the application, not the wire.

*Next step:* [Staff level](staff.md)
