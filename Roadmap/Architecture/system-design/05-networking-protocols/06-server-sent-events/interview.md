# Server-Sent Events (SSE) — Interview Questions

A staged set of interview questions on Server-Sent Events: the protocol, the `EventSource` API, resumable delivery, the trade-offs against WebSocket and long-polling, the infrastructure gotchas that bite in production, and the judgment calls a staff engineer is expected to make.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is Server-Sent Events, in one sentence?**

> Server-Sent Events (SSE) is a browser-standard mechanism for a server to push a continuous stream of text events to a client over a single, long-lived HTTP response. The client opens one HTTP request; the server never closes it and instead keeps writing new events as they occur. It is defined by the WHATWG HTML Living Standard as the `EventSource` interface plus the `text/event-stream` wire format. The defining property is that it is **one-way**: server-to-client only.

**Q2: How is SSE different from a normal HTTP request?**

> A normal HTTP request is request/response: the client asks, the server answers with a complete body, the connection is done. SSE keeps the response body open indefinitely. The server sends `Content-Type: text/event-stream`, omits `Content-Length` (the body has no known end), and uses chunked transfer encoding to stream events as they happen. Instead of one response representing one answer, the open response is a channel over which many discrete events flow.

**Q3: How does a browser client consume an SSE stream?**

> Through the built-in `EventSource` API. Minimal usage:
>
> ```javascript
> const es = new EventSource("/api/updates");
> es.onmessage = (e) => console.log("data:", e.data);
> es.onerror = (e) => console.warn("connection issue", e);
> es.close(); // stop listening
> ```
>
> `onmessage` fires for unnamed events. For named events you subscribe explicitly: `es.addEventListener("price", handler)`. The browser handles the HTTP request, the parsing of the `text/event-stream` format, and — importantly — automatic reconnection, all for free.

**Q4: What does the `text/event-stream` wire format look like?**

> It is plain UTF-8 text made of lines. Each event is a block of `field: value` lines terminated by a **blank line**. The recognized fields are `data`, `event`, `id`, and `retry`. Example:
>
> ```
> event: price
> data: {"symbol":"AAPL","px":192.4}
> id: 42
>
> data: a plain message
>
> ```
>
> The first block dispatches a `price` event carrying that JSON, with id `42`. The second block is an unnamed message. The blank line is the delimiter — forget it and nothing dispatches.

**Q5: What are the four fields in an SSE event and what does each do?**

> | Field   | Purpose |
> |---------|---------|
> | `data`  | The payload. Multiple `data:` lines in one block are joined with `\n`. |
> | `event` | The event name; determines which `addEventListener` handler fires. Defaults to `message`. |
> | `id`    | An opaque event ID the browser stores as the "last event ID." |
> | `retry` | Reconnection delay in milliseconds the client should use if the connection drops. |
>
> A line beginning with `:` is a comment and is ignored — often used as a keep-alive heartbeat (`: ping`).

**Q6: Do you need a special server or library to send SSE?**

> No. SSE is just HTTP. Any server that can hold a response open and flush bytes can serve it: set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, then write `data: ...\n\n` blocks and flush after each. There is no handshake, no framing library, no upgrade. This simplicity — "it's a text file that never ends" — is a big part of why SSE is easy to adopt.

---

## Middle Questions

**Q7: How does automatic reconnection work in SSE?**

> When the connection drops, `EventSource` waits a delay (default a few seconds, overridable by the server via a `retry:` field) and reissues the same GET request. This is fully automatic — the application code does nothing. On reconnect the browser sends a `Last-Event-ID` request header containing the `id` of the last event it successfully received. The server can read that header and resume the stream from just after that point. Reconnection and resumption are the two features that make SSE feel robust despite riding on a fragile long-lived connection.

**Q8: What is `Last-Event-ID` and how do you use it for resume?**

> Every time the server sends an `id:` field, the browser remembers it. If the connection breaks and reconnects, the browser automatically puts that value in a `Last-Event-ID` HTTP header on the new request. The server uses it as a cursor: "the client has everything up to id N; send N+1 onward." For this to prevent data loss, the server must be able to look up events after a given id — typically from a durable log or an offset in a message broker. Without a durable source behind it, `Last-Event-ID` only avoids *duplicating* the current position; it cannot recover events that were produced while the client was disconnected.

**Q9: Can you control the reconnection delay from the server?**

> Yes, with the `retry:` field. Sending `retry: 10000` tells the client to wait 10 seconds before reconnecting after a drop. This is useful for backpressure: if a server is overloaded or shedding load, it can raise the retry interval to spread reconnection storms out over time rather than have thousands of clients hammer it in the same second. The value persists on the client until changed by a later `retry:`.

**Q10: When would you choose SSE over WebSocket?**

> Choose SSE when the data flow is predominantly **server-to-client** and you want to stay inside plain HTTP. Live feeds — notifications, dashboards, log tailing, stock tickers, LLM token streams, progress bars, activity timelines — are natural fits. SSE gives you automatic reconnection, resumable delivery via `Last-Event-ID`, transparent traversal of HTTP proxies and CDNs, and no protocol upgrade. Choose WebSocket when you need frequent, low-latency **client-to-server** messages too (chat, collaborative editing, multiplayer games, live cursors) or binary frames. If most upstream traffic is occasional, a plain HTTP POST alongside an SSE downstream is often cleaner than a full WebSocket.

**Q11: Compare SSE, WebSocket, and long-polling directly.**

> | Property             | SSE                          | WebSocket                    | Long-polling                 |
> |----------------------|------------------------------|------------------------------|------------------------------|
> | Direction            | Server → client only         | Full-duplex                  | Server → client (per poll)   |
> | Transport            | Plain HTTP (streaming)       | TCP after HTTP upgrade       | Plain HTTP (repeated)        |
> | Payload              | UTF-8 text only              | Text or binary               | Any                          |
> | Auto-reconnect       | Built in                     | Manual (app code)            | Implicit (next request)      |
> | Resume after drop    | Built in (`Last-Event-ID`)   | Manual                       | Manual                       |
> | Proxy/CDN friendly   | High (looks like HTTP)       | Needs upgrade support        | High                         |
> | Per-message overhead | Low (no framing handshake)   | Low                          | High (full request per msg)  |
> | Browser API          | `EventSource`                | `WebSocket`                  | `fetch` / `XMLHttpRequest`   |
>
> Long-polling is the fallback for environments that break streaming; SSE is the sweet spot for one-way real-time; WebSocket is for genuine bidirectional interactivity.

**Q12: What are the fundamental limitations of SSE?**

> Three that matter. First, it is **one-way** — there is no built-in channel back to the server; upstream needs a separate request. Second, it is **text-only** — the wire format is UTF-8, so binary must be base64-encoded (roughly 33% inflation) or sent out of band. Third, over **HTTP/1.1** browsers cap concurrent connections to the same origin at 6, and a held-open SSE stream consumes one of those six for its entire lifetime, which can starve other requests to the same host — a problem HTTP/2 solves.

**Q13: What is the significance of the blank line in the wire format?**

> The blank line (`\n\n`) is the event boundary. The parser accumulates `field: value` lines into a pending event and dispatches it only when it hits a blank line. If your server writes `data: hello\n` but forgets the second newline, the event sits in the buffer and never fires. This is the single most common SSE bug: "the server is sending data but the client sees nothing" almost always means a missing terminating blank line or a proxy buffering the stream.

---

## Senior Questions

**Q14: Explain the HTTP/1.1 6-connection cap problem and how HTTP/2 fixes it.**

> Browsers limit concurrent TCP connections to a single origin to 6 under HTTP/1.1. An SSE stream holds one open for its lifetime. Open two or three SSE streams (say, one per browser tab, or a few widgets each with their own stream) and you have consumed most of the budget; any additional request to that origin — an API call, an image — queues until a slot frees. HTTP/2 multiplexes many logical streams over a single TCP connection, so an SSE stream is one of ~100 concurrent streams rather than 1 of 6 hard connections. The practical takeaway: **serve SSE over HTTP/2 (or HTTP/3)**. Under H2 the connection-starvation problem largely disappears and per-tab stream limits become a non-issue.
>
> ```mermaid
> sequenceDiagram
>     participant B as Browser (HTTP/1.1)
>     participant S as Server
>     Note over B,S: STAGE 1 — cap of 6 connections to origin
>     B->>S: GET /sse (holds conn 1 forever)
>     B->>S: GET /sse (holds conn 2 forever)
>     B->>S: GET /sse (holds conn 3 forever)
>     Note over B: STAGE 2 — 3 slots left for everything else
>     B->>S: GET /api/data (uses conn 4)
>     B--xS: GET /avatar.png ... 3 more open ... 7th QUEUES
>     Note over B,S: STAGE 3 — switch to HTTP/2
>     B->>S: single TCP conn, multiplexed streams
>     B->>S: SSE + API + images all share it, no starvation
> ```

**Q15: What proxy and buffering gotchas break SSE, and how do you fix them?**

> Reverse proxies and load balancers frequently **buffer** responses — they wait to accumulate bytes before forwarding, which destroys streaming: the client receives nothing until the buffer flushes (or never, since the stream never ends). Nginx buffers by default. The fixes:
>
> - Send the response header `X-Accel-Buffering: no` — Nginx honors this to disable buffering for that response.
> - Set `proxy_buffering off;` and `proxy_cache off;` on the relevant Nginx location.
> - Ensure `Content-Type: text/event-stream` and `Cache-Control: no-cache` are set so intermediaries don't cache.
> - Disable response compression buffering, or ensure the compressor flushes per event; gzip that buffers whole responses will stall the stream.
> - Watch idle timeouts on proxies/LBs (e.g. a 60s idle timeout kills a quiet stream) — emit periodic comment heartbeats (`: ping\n\n`) to keep the connection warm and to detect dead peers.

**Q16: How do you scale SSE to many concurrent clients across many servers?**

> The core problem: an event generated anywhere must reach the specific servers holding the connections for the interested clients. You decouple event *production* from connection *ownership* with a pub/sub layer.
>
> ```mermaid
> flowchart LR
>   subgraph Producers
>     P[Event source / service]
>   end
>   P -->|publish| PS[(Pub/Sub<br/>Redis / Kafka / NATS)]
>   PS -->|fan-out| N1[SSE node 1]
>   PS -->|fan-out| N2[SSE node 2]
>   PS -->|fan-out| N3[SSE node 3]
>   N1 -->|text/event-stream| C1[clients]
>   N2 -->|text/event-stream| C2[clients]
>   N3 -->|text/event-stream| C3[clients]
> ```
>
> Each SSE node subscribes to the channels its connected clients care about; when an event is published, every node with a relevant client writes it to those streams. Nodes are stateless with respect to the event source — a client can reconnect to any node behind a load balancer. This is a classic fan-out: producers publish once, the broker replicates to N subscribing nodes, each node fans out to its local connections. Because a single node holds thousands of open connections, you also tune file-descriptor limits, use an event-loop / async model rather than thread-per-connection, and cap connections per node with graceful shedding.

**Q17: How do you build truly no-loss resume for SSE?**

> `Last-Event-ID` gives you the mechanism; you must supply a **durable event log** behind it. Assign every event a monotonic, ordered id and persist events in an append-only store (Redis Streams, a Kafka topic, or a database table keyed by offset) with a retention window. On reconnect, read `Last-Event-ID`, look up all events after that id, replay them to the client, then attach the client to the live stream. Key details:
>
> - IDs must be **globally ordered per stream** so "everything after N" is well-defined; per-node counters won't do behind a load balancer — use a broker offset or a global sequence.
> - Retention bounds recovery: if the client was gone longer than the window, you can only offer a snapshot-plus-resume, not full replay.
> - Handle the race between replaying the backlog and joining the live tail without gaps or duplicates (fence on the id you replay up to).
> - Make delivery idempotent on the client where possible, since a client may receive an event, drop before acking, and get it again on resume.

**Q18: Why did SSE resurge for LLM token streaming?**

> LLM inference produces tokens incrementally and the UX demands they appear as they're generated — a textbook one-way, server-to-client, text stream. SSE fits perfectly: no WebSocket upgrade, it rides ordinary HTTP through every proxy and CDN, `text/event-stream` carries token deltas as `data:` lines, and the client renders each event as it arrives. The pattern most APIs adopted (including OpenAI's and Anthropic's streaming endpoints) is SSE-style: `data:` lines with JSON deltas, a terminal sentinel event to mark completion, and named events for tool calls, usage, and errors. The stream is short-lived (one response), text-only fits tokens, and there's no upstream chatter to justify WebSocket's complexity. SSE's decade-old design turned out to be exactly the right shape for streaming generative output.

**Q19: How do you handle authentication and CORS with SSE?**

> The subtlety: the native `EventSource` constructor cannot set custom headers — you can't pass an `Authorization: Bearer` header. Options: (1) authenticate via cookies, since `EventSource` sends same-origin cookies (and cross-origin ones if you pass `{ withCredentials: true }` and the server sets the right `Access-Control-Allow-Credentials`); (2) put a short-lived token in the query string of the SSE URL (log it carefully — query strings leak into access logs); or (3) drop the native API and use `fetch()` with a `ReadableStream` reader, which lets you set arbitrary headers and parse the event stream yourself, at the cost of reimplementing reconnection and `Last-Event-ID` handling. For CORS, the server must return `Access-Control-Allow-Origin` (and `-Credentials` if cookies are used); the stream itself is a simple GET, so no preflight for the basic case.

---

## Professional / Deep-Dive Questions

**Q20: Walk through exactly what happens from `new EventSource()` to a dispatched event, including reconnection.**

> ```mermaid
> sequenceDiagram
>     participant App as App code
>     participant ES as EventSource (browser)
>     participant Srv as Server
>     Note over App,Srv: STAGE 1 — open
>     App->>ES: new EventSource("/sse")
>     ES->>Srv: GET /sse, Accept: text/event-stream
>     Srv-->>ES: 200, Content-Type: text/event-stream (body stays open)
>     Note over ES,Srv: STAGE 2 — stream events
>     Srv-->>ES: retry: 3000\n\n
>     Srv-->>ES: id: 10\ndata: {"n":1}\n\n
>     ES->>App: dispatch message event, store lastId=10
>     Srv-->>ES: : ping\n\n  (comment heartbeat, ignored)
>     Note over ES,Srv: STAGE 3 — drop + resume
>     Srv--xES: connection lost
>     ES->>ES: wait 3000ms (retry value)
>     ES->>Srv: GET /sse, Last-Event-ID: 10
>     Srv-->>ES: id: 11\ndata: {"n":2}\n\n  (resumes after 10)
>     ES->>App: dispatch message event, store lastId=11
> ```
>
> The browser parses the stream line by line, buffering fields until a blank line dispatches an event. `id:` updates the stored last-event-id. `retry:` updates the reconnect delay. On a drop the browser waits that delay, reconnects with `Last-Event-ID`, and the server resumes. All of this is invisible to app code.

**Q21: How does the parser handle multi-line data, comments, and edge cases in the wire format?**

> The spec parses line by line, splitting on `\n`, `\r`, or `\r\n`. For each line: a leading `:` makes it a comment (ignored, used for heartbeats). Otherwise split on the first `:`; the part before is the field name, the part after (minus one optional leading space) is the value. Multiple `data:` lines in one event are concatenated with `\n` between them and the trailing `\n` is stripped — so `data: line1\ndata: line2\n\n` yields the payload `"line1\nline2"`. Unknown field names are ignored. An `id:` containing a NUL character is ignored (a guard). A `retry:` value that isn't an integer is ignored. The event is dispatched on the blank line with its accumulated `data`, `event` name (default `message`), and last id. Understanding this is why you must JSON-encode anything with embedded newlines carefully or use multiple `data:` lines deliberately.

**Q22: What are the failure modes of SSE at the connection layer, and how do you detect a dead stream?**

> The insidious failure is a **half-open connection**: the TCP connection looks alive to the server but the client is gone (laptop slept, network dropped silently), or vice versa. Nothing flows, no error fires, resources leak. Detection and mitigation:
>
> - **Server → client heartbeats**: emit `: ping\n\n` every 15–30s. If the write fails, the server learns the client is gone and can release the connection.
> - **Idle timeouts**: proxies and LBs kill quiet connections; heartbeats keep them alive *and* let both ends notice death within one interval.
> - **TCP keepalive**: OS-level keepalive as a backstop, though its default timers are far too long (hours) to rely on alone.
> - **Client-side watchdog**: if using `fetch`-based SSE, track time since last event and force-reconnect if it exceeds a threshold; the native `EventSource` handles this internally.
> - **Connection accounting**: track open streams per node so you can shed load and detect leaks (open count that never drops signals half-open connections piling up).

**Q23: Compare native `EventSource` against a `fetch`-based streaming reader. When and why switch?**

> | Concern              | Native `EventSource`              | `fetch` + `ReadableStream`         |
> |----------------------|-----------------------------------|------------------------------------|
> | Custom headers       | No (can't set `Authorization`)    | Yes (any header)                   |
> | Request method       | GET only                          | Any (POST with a body)             |
> | Auto-reconnect       | Built in                          | You implement it                   |
> | `Last-Event-ID`      | Automatic                         | You track and resend it            |
> | Parsing              | Built in                          | You parse `text/event-stream`      |
> | Non-2xx handling     | Coarse (reconnect on some codes)  | Full control                       |
>
> Switch to `fetch` streaming when you need auth headers, a POST body (common for LLM requests that carry a large prompt), or fine-grained control over reconnection and error handling. The cost is reimplementing everything the browser gave you for free — so unless a limitation forces it, prefer native `EventSource`. Many production LLM clients use `fetch` streaming precisely because the request is a POST with a JSON body, which native `EventSource` cannot express.

**Q24: How do compression, keep-alive, and HTTP/2 flow control interact with an SSE stream?**

> Compression: gzip/br can be applied, but the compressor must **flush per event** or events buffer inside the compression window and stall — many setups therefore disable compression on `text/event-stream`, trading a little bandwidth for correct streaming. Keep-alive: the response uses `Connection: keep-alive` and chunked encoding; the TCP connection stays open for the stream's life, so file-descriptor and ephemeral-port limits become the scaling ceiling per node. HTTP/2 flow control: each stream has a window; a slow client that doesn't consume data causes the server's writes to block once the window fills — this is real backpressure. A server must handle a full write buffer gracefully (drop the client, buffer bounded, or apply per-client queues with limits) rather than letting one slow reader consume unbounded memory. Under H2, dozens of SSE streams share one connection, so a single misbehaving stream shouldn't be able to starve the others — the multiplexing and per-stream windows are what make that safe.

---

## Staff / Judgment Questions

**Q25: A team wants to add a WebSocket for a feature that's 95% server-push and 5% occasional client actions. What's your recommendation?**

> Push back toward **SSE for the downstream plus plain HTTP POSTs for the occasional upstream actions**. WebSocket buys you full-duplex, but you pay for it: manual reconnection logic, manual resume, sticky-session complications at the load balancer, more finicky proxy/CDN traversal, and a second protocol to operate and monitor. For a workload that's overwhelmingly one-way, SSE gives you automatic reconnect and `Last-Event-ID` resume for free, rides ordinary HTTP infrastructure, and lets the rare client action be a normal, cacheable-and-observable HTTP request. Reserve WebSocket for genuinely interactive, high-frequency bidirectional workloads (chat, collaborative editing, games). The judgment is to match protocol complexity to actual traffic shape, not to the theoretical maximum. If the 5% ever grows into sustained low-latency interactivity, revisit — but don't pay WebSocket's operational tax speculatively.

**Q26: You're designing streaming for a public API used by thousands of integrators. SSE or WebSocket, and why?**

> For a public streaming API delivering server-generated data (events, notifications, LLM output), lean **SSE**. Reasons weighted for an external audience: it's plain HTTP, so it works through every corporate proxy, CDN, and firewall your integrators sit behind — WebSocket upgrades are still blocked or mangled in some enterprise networks. The client story is trivial (`EventSource` or a `data:`-line parser in any language), lowering integration friction. Resumability via `Last-Event-ID` is a first-class contract you can document. Auth via bearer token works if you standardize on `fetch`-streaming or a token param. You give up binary and true duplex, but a public *streaming* API rarely needs the client to push high-frequency data — that's what your regular REST endpoints are for. The industry converged here: most streaming/LLM APIs ship SSE-style responses precisely because it minimizes integrator support burden.

**Q27: How do you decide between "resume from durable log" versus "reconnect and re-snapshot"?**

> It's a cost/consistency trade-off driven by how much history matters and how large the state is.
>
> - **Durable-log resume** (`Last-Event-ID` + append-only store) suits streams where every event is meaningful and clients must miss nothing — audit trails, financial ticks, ordered domain events. Cost: you operate a retained, ordered log and handle the replay-vs-live race.
> - **Reconnect-and-resnapshot** suits streams where only the *current state* matters and intermediate deltas are disposable — a dashboard gauge, a presence indicator, a "current price." On reconnect, send a fresh snapshot and resume live; skipping the gap is fine and cheaper (no log, no per-event retention).
>
> Many real systems combine both: snapshot on connect to establish state, then stream deltas with ids, and use the log only for a bounded recent window. Decide per stream based on whether a missed event is a bug or a non-event, and on how expensive a full snapshot is relative to replaying deltas.

**Q28: What are the top production risks when running SSE at scale, and how do you mitigate each?**

> | Risk                          | Symptom                                  | Mitigation |
> |-------------------------------|------------------------------------------|------------|
> | Proxy/LB buffering            | Clients see nothing until flush          | `X-Accel-Buffering: no`, `proxy_buffering off`, no response-buffering compression |
> | Connection starvation (H1.1)  | Other requests to origin stall           | Serve over HTTP/2/3; consolidate streams |
> | Half-open / leaked connections| Open-connection count climbs, memory up  | Heartbeats + write-failure detection + connection accounting |
> | Reconnection storms           | Thundering herd after a deploy/outage     | Raise `retry:`, jitter reconnect, graceful drain on deploy |
> | Slow consumers (backpressure) | One client balloons server memory         | Bounded per-client queues, drop-and-reset policy, H2 flow control |
> | Idle timeouts                 | Quiet streams killed mid-flight           | Heartbeats under the timeout interval |
> | Missing durable log for resume| Data loss on any disconnect               | Ordered append-only log behind `Last-Event-ID` |
>
> The unifying theme: SSE's simplicity is deceptive — the hard parts are infrastructure (buffering, connection limits, timeouts) and operational (heartbeats, backpressure, graceful deploys), not the protocol itself.

**Q29: A dashboard opens six SSE streams and users report the page "freezing" other requests. Diagnose and fix.**

> This is the HTTP/1.1 6-connection cap in action: six held-open SSE streams consume the entire per-origin connection budget, so every subsequent request to that origin — API calls, images, fonts — queues indefinitely, making the page appear frozen. Diagnosis: check the protocol (is it HTTP/1.1?), count concurrent streams to the origin, and watch the network panel for queued (not slow — *queued*) requests. Fixes, in order of preference: (1) **serve over HTTP/2**, which multiplexes all streams and requests over one connection and eliminates the cap entirely — this is the real fix; (2) **consolidate** the six streams into one multiplexed SSE endpoint that fans several logical channels into a single connection (send `event:` names to distinguish them client-side); (3) as a stopgap, **shard across subdomains** so each stream uses a different origin's budget — a hack that HTTP/2 makes unnecessary. The lesson: never design for many parallel SSE streams to one origin under HTTP/1.1.

**Q30: When is SSE the wrong choice entirely, and what would you reach for instead?**

> SSE is wrong when the workload genuinely needs what SSE structurally lacks. Reach elsewhere when: (1) you need **frequent, low-latency client-to-server** messages — chat, collaborative editing, multiplayer, live cursors — where WebSocket's duplex is essential; (2) you're moving **binary** data (media, protobuf frames) where base64 inflation and text-only framing are unacceptable — WebSocket or a binary streaming protocol fits; (3) you need **bidirectional streaming RPC** between services rather than to browsers — gRPC streaming over HTTP/2 is the better fit; (4) the environment aggressively **breaks streaming responses** (legacy proxies that buffer everything) and you can't fix the infrastructure — long-polling is the resilient fallback; (5) you need **guaranteed, transactional delivery semantics** beyond best-effort-plus-resume — that's a message queue's job, with SSE only as the last-mile delivery. The staff-level answer isn't "SSE is best" or "WebSocket is best" — it's matching the protocol to the traffic shape, the payload type, and the infrastructure you actually have to run on.

---

*Next step:* [Long-Polling & Streaming](../07-long-polling-and-streaming/junior.md)
