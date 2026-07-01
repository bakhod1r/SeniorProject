# Server-Sent Events (SSE) — Middle Level

Middle level is where you stop treating SSE as "a magic real-time thing" and start reading the bytes. An SSE stream is not a framing protocol with headers and opcodes like WebSocket — it is a plain, line-oriented, UTF-8 text format sent over an ordinary HTTP response that never ends. If you can produce the exact bytes by hand, you can debug any SSE bug, because everything the browser does is a direct function of what those bytes say.

This file covers the `text/event-stream` grammar precisely, the automatic reconnection machinery built on `Last-Event-ID`, the server-side requirements that make streaming actually stream (flushing, buffering, keepalives), and the hard limits you must design around.

## Table of contents

1. [The response that never ends](#1-the-response-that-never-ends)
2. [The `text/event-stream` grammar, field by field](#2-the-texteventstream-grammar-field-by-field)
3. [Worked example: real stream bytes](#3-worked-example-real-stream-bytes)
4. [Automatic reconnection and `Last-Event-ID`](#4-automatic-reconnection-and-last-event-id)
5. [Staged reconnect walkthrough](#5-staged-reconnect-walkthrough)
6. [Server requirements: flush, buffering, keepalive](#6-server-requirements-flush-buffering-keepalive)
7. [The connection-limit problem and HTTP/2](#7-the-connection-limit-problem-and-http2)
8. [Hard limits and what SSE cannot do](#8-hard-limits-and-what-sse-cannot-do)
9. [SSE vs WebSocket capability table](#9-sse-vs-websocket-capability-table)
10. [Checklist and next step](#10-checklist-and-next-step)

---

## 1. The response that never ends

A normal HTTP response has a body of known length: the server sets `Content-Length`, writes that many bytes, and closes. SSE inverts this. The server sends response headers, then holds the connection open and dribbles out bytes over seconds, minutes, or hours. There is no `Content-Length`; the body is open-ended.

The headers that make a response an SSE stream:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

- `Content-Type: text/event-stream` is mandatory — it is the signal that tells `EventSource` (and intermediaries) to parse the body with the event-stream grammar rather than buffering it as a document.
- `Cache-Control: no-cache` prevents proxies and the browser cache from holding the stream or replaying a stale copy.
- Under HTTP/1.1 the body is delivered with `Transfer-Encoding: chunked` (each write becomes a chunk); the server infrastructure adds this automatically once no `Content-Length` is set.

On the client side, all of this is driven by one object:

```js
const es = new EventSource("/stream");
es.onmessage = (e) => console.log(e.data);       // default (unnamed) events
es.addEventListener("price", (e) => update(e));  // named events
es.onerror = (e) => console.warn("disconnected, browser will retry");
```

`EventSource` opens the connection, parses the incoming byte stream line by line, dispatches events, and — crucially — **reconnects automatically** when the stream drops. That last behavior is the single biggest reason to reach for SSE, and it is entirely governed by the wire format below.

## 2. The `text/event-stream` grammar, field by field

The body is a sequence of **events**, and each event is a sequence of **lines**. A line is terminated by `\n`, `\r`, or `\r\n` (all three are legal; `\n` is conventional). An event is terminated by a **blank line**. That blank line is the framing — miss it and the client keeps buffering, waiting for an event that never dispatches.

Each non-blank line is a *field*: everything up to the first colon is the field name, everything after the colon (with a single leading space stripped, if present) is the value. There are exactly four field names the client understands, plus the comment form:

| Field | Purpose | Client behavior |
|-------|---------|-----------------|
| `data:` | Payload text | Appended to the event's data buffer; multiple `data:` lines are joined with `\n` |
| `event:` | Event name | Sets the event type; dispatched to the matching `addEventListener` (default is `message`) |
| `id:` | Event ID / cursor | Stored as the stream's "last event ID"; sent back on reconnect via `Last-Event-ID` |
| `retry:` | Reconnect delay | Integer milliseconds; sets how long the client waits before reconnecting |
| `:` (comment) | Comment / keepalive | Ignored entirely; used to keep the connection warm |

Rules that trip people up:

- **`data:` is joined with `\n`, not concatenated.** Two `data:` lines become a two-line string. To send one logical newline in your payload, emit two `data:` lines. To send JSON, you can put it all on one `data:` line.
- **A field with no colon** (a bare line like `data`) is treated as a field name with an empty value — legal but almost never what you want.
- **Unknown field names are silently ignored.** `foo: bar` does nothing on the client; it will *not* error. This is a common source of "my event never arrives" — a typo like `evnt:` is dropped without complaint.
- **The event dispatches on the blank line.** At that point the client fires the event with the accumulated `data` buffer and the current `event` type, then resets the `data` and `event` buffers (but *not* the last-event-id, which persists).
- **A trailing `\n` inside `data` is dropped.** If your data buffer ends with a newline, the client strips exactly one before dispatch.

The value of `id:` should not contain a NUL character (`\0`); if it does, the client ignores that `id:` line. Everything is UTF-8; a leading UTF-8 BOM on the stream is stripped once at the start.

## 3. Worked example: real stream bytes

Here is a concrete stream, shown as literal bytes (`␊` marks each `\n` so blank lines are visible). Read it as the browser does.

```
: connected, ping every 15s␊          ← comment line, ignored (used as keepalive)
␊
data: hello world␊                     ← unnamed event, data = "hello world"
␊
event: price␊                          ← named "price" event
data: {"sym":"AAPL","px":214.7}␊       ← data = that JSON string
id: 1042␊                              ← cursor stored; sent back on reconnect
␊
event: price␊
data: line one␊                        ← two data lines →
data: line two␊                        ← data = "line one\nline two"
id: 1043␊
retry: 5000␊                           ← tell client: wait 5s before reconnecting
␊
```

What the client does with each block:

1. **First block** — a comment. Nothing dispatched. Its only job is to push bytes so proxies and the client register the connection as live.
2. **Second block** — fires an `onmessage` event whose `event.data === "hello world"`, `event.lastEventId === ""` (no `id:` seen yet).
3. **Third block** — fires a `price` listener; `event.data` is the JSON *string* (you call `JSON.parse` yourself), and `event.lastEventId === "1042"`. The client now remembers `1042`.
4. **Fourth block** — fires a `price` listener with `event.data === "line one\nline two"` and `event.lastEventId === "1043"`. The `retry: 5000` updates the reconnect timer for all future drops.

Notice there is no length prefix, no checksum, no binary framing. The blank lines are the entire framing protocol. That simplicity is why SSE is trivial to generate from any language — it is just `printf`-style text with flushes.

## 4. Automatic reconnection and `Last-Event-ID`

This is the feature that distinguishes SSE from "a fetch that streams." When the TCP connection drops — server restart, load-balancer idle timeout, laptop lid closed, tunnel through a flaky mobile network — `EventSource` does not fail permanently. It waits a *reconnection time* and reopens the same URL. The default delay is browser-defined (typically a few seconds); the server can override it at any time by sending a `retry:` field.

The magic is **resumption without data loss**, and it works through a single contract:

1. Every event the server sends carries an `id:` — a monotonic cursor (a sequence number, a Kafka offset, a database row version, a timestamp — whatever your backend can resume from).
2. The client stores the most recent `id:` it saw as its *last event ID*.
3. When the connection drops and the client reconnects, it automatically sends an HTTP request header:
   ```
   Last-Event-ID: 1043
   ```
4. The server reads that header, treats `1043` as "the client already has everything up to and including 1043," and **replays from 1044 onward** before resuming the live feed.

The server is responsible for the replay. `EventSource` only promises to *send you the cursor*; it cannot magically recover events it never received. If your handler ignores `Last-Event-ID` and always starts from "now," reconnects will silently drop every event that occurred during the outage. Correct SSE backends keep a bounded buffer (in memory, Redis, or a log/stream store) keyed by ID so they can seek to `Last-Event-ID + 1`.

A minimal Node.js handler that honors this:

```js
app.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",              // disable nginx proxy buffering
  });

  const cursor = Number(req.headers["last-event-id"] || 0);
  for (const ev of eventsSince(cursor)) {   // replay the gap
    res.write(`id: ${ev.id}\n`);
    res.write(`event: ${ev.type}\n`);
    res.write(`data: ${JSON.stringify(ev.payload)}\n\n`);
  }

  const keepalive = setInterval(() => res.write(": ping\n\n"), 15000);
  const unsub = feed.subscribe((ev) => {    // live feed after replay
    res.write(`id: ${ev.id}\n`);
    res.write(`event: ${ev.type}\n`);
    res.write(`data: ${JSON.stringify(ev.payload)}\n\n`);
  });

  req.on("close", () => { clearInterval(keepalive); unsub(); });
});
```

Two subtleties worth internalizing:

- **`Last-Event-ID` is a request header, not a query parameter.** It is added by the browser, not by your JS. You never set it from the client side — you just design your server to read it.
- **The client keeps sending the *same* ID until it receives a newer one.** If the reconnect itself fails, the next attempt carries the same `Last-Event-ID`, so replay is idempotent from the server's point of view — as long as your `id:`s are truly monotonic per stream.

## 5. Staged reconnect walkthrough

The diagram below stages a normal session, an outage, and an automatic resume so you can see exactly which byte carries the state across the gap.

```mermaid
sequenceDiagram
    autonumber
    participant C as EventSource (browser)
    participant LB as Load balancer / proxy
    participant S as SSE server

    Note over C,S: Stage 1 — open + steady stream
    C->>S: GET /stream  (Accept: text/event-stream)
    S-->>C: 200, Content-Type: text/event-stream
    S-->>C: id:1042  data:{px:214.7}  (blank line)
    Note over C: last event id = 1042
    S-->>C: id:1043  data:{px:215.1}  (blank line)
    Note over C: last event id = 1043

    Note over C,S: Stage 2 — connection drops mid-stream
    LB--xS: idle timeout / deploy resets TCP
    C->>C: onerror fires; wait retry ms (e.g. 5000)

    Note over C,S: Stage 3 — automatic reconnect with cursor
    C->>S: GET /stream  (Last-Event-ID: 1043)
    Note over S: seek to 1044, replay the gap

    Note over C,S: Stage 4 — gap replay, then live again
    S-->>C: id:1044  data:{px:215.9}  (missed during outage)
    S-->>C: id:1045  data:{px:216.2}  (missed during outage)
    S-->>C: id:1046  data:{px:216.0}  (live)
    Note over C: no events lost — resumed at 1044
```

The whole recovery hinges on Stage 3's request header. Delete the `id:` fields from your server output and Stage 3 still happens — the client reconnects — but it sends `Last-Event-ID: ` (empty), the server has no cursor, and Stage 4 replays nothing. The user silently loses whatever happened during the outage. IDs are not decoration; they are the resume protocol.

## 6. Server requirements: flush, buffering, keepalive

SSE fails in subtle ways when some layer between your code and the browser decides to *buffer*. Buffering is the enemy of streaming: it holds your bytes until "enough" accumulate, which for a slow event feed can be minutes — or forever. Three concrete requirements.

**Flush after every event.** Writing to the response socket is not enough; many stacks buffer at the application or framework layer. You must flush so the bytes leave the process immediately.

- Node.js `res.write(...)` flushes to the OS by default — good — but if compression middleware sits in front, it may buffer (see below).
- PHP: call `flush()` and often `ob_flush()`, and disable output buffering.
- Python WSGI: yield from a generator; ensure the server (gunicorn/uWSGI) does not buffer — use an async worker.
- Java: call `response.getWriter().flush()` (or use the async Servlet/`SseEmitter`).

**Never compress an SSE stream.** `Content-Encoding: gzip` (or `br`) buffers input to build compression blocks, which destroys the one-event-at-a-time flow and can hold events indefinitely. Explicitly disable compression for the `text/event-stream` route. In nginx this means turning `gzip off` for the location; in app frameworks, exclude the route from compression middleware.

**Disable proxy buffering.** Reverse proxies buffer response bodies by default to smooth out slow upstreams — exactly wrong for SSE. For nginx, set on the SSE location:

```
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;          # don't kill a long-lived stream
add_header X-Accel-Buffering no;   # or send it from the app
```

The `X-Accel-Buffering: no` response header (which nginx honors) is the portable way to say "do not buffer this response" from application code, which is why the Node example above sets it.

**Send keepalive comments to defeat idle timeouts.** Load balancers, proxies, and some browsers close connections that are silent for too long (commonly 30–120 seconds). A slow event feed — say, an alert channel that emits nothing for ten minutes — looks idle and gets reaped. The fix is a periodic **comment line** that pushes bytes without dispatching an event:

```
: ping

```

A `:`-prefixed line is ignored by the client (no event fires, no data buffer change), but it counts as activity for every intermediary, resetting their idle timers. Send one every 15–30 seconds — comfortably under the tightest idle timeout in your path. This is cheaper and cleaner than sending real "heartbeat" events, because it needs no client handling.

## 7. The connection-limit problem and HTTP/2

The classic SSE gotcha under **HTTP/1.1**: browsers cap the number of simultaneous connections to a single origin at roughly **6**. An SSE stream is a connection that stays open indefinitely. So a page that opens SSE, plus a few tabs to the same site, quickly exhausts the budget — and because SSE connections never close, the seventh request *blocks* until one frees up. Symptom: images stop loading, XHR/fetch hang, the app appears frozen, all because one long-lived `EventSource` per tab ate the pool.

Consequences and mitigations under HTTP/1.1:

- **One SSE connection per tab, at most.** Multiplex all your real-time channels through a single stream (use the `event:` field to distinguish channel A from channel B) rather than opening one `EventSource` per feature.
- **Multiple tabs multiply the problem.** Five tabs of your app = five SSE connections = the budget is gone before any tab does normal work. A `SharedWorker` holding one `EventSource` shared across tabs is the standard workaround.

**HTTP/2 removes the cap entirely.** HTTP/2 multiplexes many logical streams over a single TCP connection, so an SSE stream is just one stream among many — it no longer consumes a whole connection slot. The per-origin concurrent-stream limit is negotiated (commonly 100+), not 6, and normal requests share the same connection. In practice this means: **serve SSE over HTTPS/HTTP/2** and the six-connection problem disappears. This is the single biggest operational reason SSE is far more comfortable today than a decade ago — TLS is near-universal, and TLS effectively means HTTP/2.

The connection budget is per *origin*, so `api.example.com` and `www.example.com` have separate pools; sharding SSE onto a subdomain is a legacy HTTP/1.1 trick, but HTTP/2 makes it unnecessary.

## 8. Hard limits and what SSE cannot do

SSE is deliberately narrow. Know the edges before you commit to it.

- **One-way only (server → client).** There is no client-to-server channel *on the SSE stream itself*. The client sends data the normal way: a separate `fetch`/XHR `POST`. This is fine for the common pattern (server pushes updates, client acts via ordinary API calls) but it is not a symmetric duplex link. If you need low-latency bidirectional messaging, that is WebSocket's job.
- **UTF-8 text only — no binary.** The format is line-oriented text. You cannot send raw bytes, protobuf frames, or images directly. To send binary you must Base64-encode it into a `data:` line, paying ~33% size overhead and encode/decode cost. If your payloads are fundamentally binary, SSE is the wrong tool.
- **No true framing for large payloads.** Because events are delimited by blank lines, a `data:` value that itself contains a blank line must be split across multiple `data:` lines. Huge single events are awkward and hold the parser until the terminating blank line arrives.
- **Reconnect replay is your responsibility.** As covered in §4, the browser sends `Last-Event-ID` but the *server* must implement the buffer and seek. Get this wrong and you have "real-time updates that silently lose data on every wifi hiccup" — a bug that never shows in a demo and always shows in production.
- **`EventSource` cannot set custom headers.** The native browser API allows no custom request headers (e.g., an `Authorization` header) and only a `withCredentials` flag for cookies. Token auth typically rides on a cookie or a query parameter, or you use a fetch-based SSE polyfill that does support headers.
- **Connection accounting at scale.** Every connected client is a held-open socket on your server. 100k concurrent SSE clients = 100k sockets; you need an event-loop / async server (not thread-per-request) and careful file-descriptor and memory budgeting.

## 9. SSE vs WebSocket capability table

Both are "real-time browser transports," but they solve different shapes of problem. This table is the decision aid.

| Capability | SSE (`EventSource`) | WebSocket |
|------------|---------------------|-----------|
| Direction | One-way, server → client | Full duplex, both directions |
| Underlying protocol | Plain HTTP response (`text/event-stream`) | HTTP `Upgrade` to `ws://`/`wss://`, own framing |
| Payload type | UTF-8 text only (Base64 for binary) | Text *and* binary frames natively |
| Auto-reconnect | Built in, no code | Manual — you write reconnect + backoff |
| Resume after drop | Built in via `Last-Event-ID` (server replays) | Manual — you design your own resume protocol |
| Message framing | Blank-line delimited events; `event:`/`id:`/`retry:` fields | Length-prefixed frames, opcodes, ping/pong |
| Works through HTTP proxies/CDNs | Yes — it *is* HTTP | Often needs proxy `Upgrade` support / config |
| Connection cap (HTTP/1.1) | ~6 per origin; each stream holds one | Not subject to the HTTP request pool the same way |
| Connection cap (HTTP/2) | Multiplexed — cap effectively gone | N/A (WebSocket over HTTP/2 is a separate mechanism) |
| Custom request headers | No (native API); cookies/query only | Limited during handshake; app-level after |
| Server implementation | Trivial — write text + flush | More moving parts (frame parsing, ping/pong, close codes) |
| Best fit | Notifications, live feeds, dashboards, progress, log tailing, LLM token streaming | Chat, multiplayer, collaborative editing, live control |

The rule of thumb: **if the data flows mostly one way (server telling the client "here's an update"), choose SSE** — you get reconnection and resumption for free, and it traverses HTTP infrastructure without special config. **If the client must push a steady low-latency stream too (typing, cursor moves, game input), choose WebSocket.** Do not reach for WebSocket just because it sounds more powerful; the free reconnect/resume of SSE is a large amount of correctness you would otherwise have to build and test yourself.

## 10. Checklist and next step

Before you ship an SSE endpoint, confirm every line:

- [ ] Response sets `Content-Type: text/event-stream` and `Cache-Control: no-cache`.
- [ ] Every event carries a monotonic `id:` your backend can resume from.
- [ ] The handler reads `Last-Event-ID` and replays the gap before resuming live.
- [ ] Each event ends with a blank line; you flush after every write.
- [ ] Compression is disabled for the route; proxy buffering is off (`X-Accel-Buffering: no`).
- [ ] A `: ping` comment is sent every 15–30 s to defeat idle timeouts.
- [ ] The stream is served over HTTP/2 (HTTPS) to avoid the 6-connection cap.
- [ ] One `EventSource` per tab, multiplexing channels via `event:` names.
- [ ] Binary payloads are Base64-encoded, or you've chosen WebSocket instead.

Master these and you can produce and debug an SSE stream byte-for-byte. The senior level goes up a layer: operating SSE at scale — connection fan-out and the C10k/C100k socket budget, broadcasting to millions via a pub/sub backplane, load-balancer stickiness and graceful drain during deploys, and where SSE fits against gRPC streaming and WebSocket in a real architecture.

*Next step:* [Senior level](senior.md)
