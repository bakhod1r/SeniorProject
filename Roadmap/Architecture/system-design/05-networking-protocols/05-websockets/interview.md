# WebSockets — Interview Questions

A staged bank of questions and model answers, from first-principles definitions
through the judgment calls a staff engineer makes when a real-time system meets
production traffic. Read the answers as scripts you can compress or expand to fit
the room — the goal is to sound like someone who has actually run WebSockets at
scale, not someone who memorized the RFC.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is a WebSocket, and how does it differ from an ordinary HTTP request?**

> A WebSocket is a persistent, bidirectional, message-oriented connection between
> a client and a server, standardized in RFC 6455. Once established it stays open,
> and either side can push a message to the other at any time without being asked.
>
> Ordinary HTTP is request/response and half-duplex in practice: the client speaks,
> the server answers, the exchange ends. To get new data the client must ask again.
> HTTP/1.1 keep-alive reuses the TCP socket, but it is still one-question-one-answer,
> and the server cannot originate a message. WebSockets flip that model — after a
> one-time handshake the connection is *full-duplex*: both directions carry data
> simultaneously and independently over a single TCP connection. That is the whole
> point: it removes the "the client must poll to learn about change" tax.

**Q2: What does "full-duplex" mean, and why does it matter for real-time apps?**

> Full-duplex means both endpoints can send and receive at the same time, like a
> phone call where both people can talk at once, versus a walkie-talkie (half-duplex)
> where only one side transmits at a time. For a chat app, a trading dashboard, a
> collaborative editor, or a multiplayer game, events arrive from the server
> unpredictably — a new message, a price tick, a peer's keystroke. With HTTP you
> either poll on a timer (wasting requests and adding latency equal to your poll
> interval) or hold a request open (long-polling). Full-duplex lets the server push
> the instant something happens, and lets the client send input concurrently on the
> same connection, so a chat message and an incoming notification never block each
> other.

**Q3: What URL scheme do WebSockets use, and how does a connection start?**

> WebSockets use the `ws://` scheme for plaintext and `wss://` for TLS-encrypted
> connections — the WebSocket analog of `http://` and `https://`. In production you
> always use `wss://`; plaintext `ws://` is fine only for localhost.
>
> A connection *starts* as a normal HTTP/1.1 GET request carrying special headers
> that ask the server to "upgrade" the connection from HTTP to the WebSocket
> protocol. If the server agrees it replies `101 Switching Protocols`, and from that
> moment the same TCP socket stops speaking HTTP and starts speaking WebSocket
> frames. In the browser you open one with `new WebSocket("wss://api.example.com/ws")`
> and attach `onopen`, `onmessage`, `onclose`, and `onerror` handlers.

**Q4: Name three good use cases for WebSockets and one where they are overkill.**

> Good fits — chat and messaging, live dashboards and price feeds, collaborative
> editing (cursors, presence, operational-transform / CRDT sync), multiplayer game
> state, and live notifications. The common thread: frequent, low-latency,
> bidirectional or server-initiated updates.
>
> Overkill — a page that shows a stock price refreshed once a minute, or a "new
> content available" banner. There a periodic `fetch` or Server-Sent Events costs
> far less operationally than maintaining a stateful socket per user. If updates are
> rare, one-directional, or the client can tolerate seconds of staleness, don't reach
> for WebSockets first.

**Q5: What are `onopen`, `onmessage`, and `onclose` used for?**

> They are the browser `WebSocket` lifecycle callbacks. `onopen` fires once the
> handshake completes and the socket is ready to send. `onmessage` fires for every
> inbound message and hands you the payload in `event.data` (a string, `Blob`, or
> `ArrayBuffer` depending on `binaryType`). `onclose` fires when the connection ends,
> gracefully or not, and its event carries a numeric `code` and a `reason` string so
> you can decide whether to reconnect. There is also `onerror`, which fires on a
> failure and is almost always followed by a close — treat `onclose` as the single
> place you make the reconnect decision.

---

## Middle Questions

**Q6: Walk me through the upgrade handshake. What are `Sec-WebSocket-Key` and `Sec-WebSocket-Accept` for?**

> The handshake is a standard HTTP/1.1 GET that advertises the intent to switch
> protocols. The client sends:
>
> ```
> GET /chat HTTP/1.1
> Host: api.example.com
> Upgrade: websocket
> Connection: Upgrade
> Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
> Sec-WebSocket-Version: 13
> ```
>
> The server, if it accepts, replies:
>
> ```
> HTTP/1.1 101 Switching Protocols
> Upgrade: websocket
> Connection: Upgrade
> Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
> ```
>
> `Sec-WebSocket-Key` is a random 16-byte base64 nonce the client generates fresh
> per connection. The server takes that string, concatenates the fixed magic GUID
> `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, computes SHA-1 of the result, and base64-
> encodes it to produce `Sec-WebSocket-Accept`. This is **not** security or
> authentication — it is a proof that the responding server actually understands the
> WebSocket protocol and isn't a naive cache or proxy blindly echoing a `101`. It
> stops an intermediary from accidentally completing a handshake it doesn't grasp.
> The `Sec-` prefix also prevents this header from being forged by scripted
> `XMLHttpRequest`/`fetch` calls, so a malicious page can't trick a browser into
> smuggling a fake upgrade.

**Q7: After the handshake, how is data framed? Describe frames and opcodes.**

> Data travels in *frames*, not raw bytes. Each frame has a small binary header:
> a FIN bit (is this the last fragment of a message), an opcode, a MASK bit, a
> payload length (7 bits, or extended to 16 or 64 bits for larger payloads), an
> optional masking key, and the payload. A logical *message* can be split across
> several frames using the FIN bit and continuation opcodes.
>
> Opcodes classify the frame:
>
> | Opcode | Name         | Meaning                                         |
> |--------|--------------|-------------------------------------------------|
> | `0x0`  | Continuation | A fragment continuing a prior message           |
> | `0x1`  | Text         | UTF-8 text payload                              |
> | `0x2`  | Binary       | Arbitrary binary payload                        |
> | `0x8`  | Close        | Start the closing handshake (carries a code)    |
> | `0x9`  | Ping         | Liveness probe; peer must reply with Pong       |
> | `0xA`  | Pong         | Reply to a Ping (or unsolicited keepalive)      |
>
> Opcodes `0x1`, `0x2`, and `0x0` are *data* frames; `0x8`, `0x9`, `0xA` are
> *control* frames. Control frames must be short (≤125 bytes) and cannot be
> fragmented, because they need to be handled promptly even in the middle of a large
> data message.

**Q8: What are ping/pong frames for, and why can't you rely on TCP alone to detect a dead peer?**

> Ping/pong are the protocol's application-level heartbeat. The server (or client)
> sends a Ping; a healthy peer must answer with a Pong echoing the same payload. If
> no Pong arrives within a timeout, you declare the connection dead and tear it down.
>
> You can't lean on TCP alone because a broken path often produces *no* signal: a
> laptop lid closes, a phone loses radio, a NAT or load balancer silently drops an
> idle flow from its state table. TCP will not surface an error until it tries to
> send and the retransmit timer eventually gives up — which can be minutes, or never
> if nothing is sent. From your server's view the socket looks perfectly open while
> the client is long gone (a "half-open" connection). Regular pings force traffic on
> the wire so you detect death in seconds, and they also keep intermediaries from
> reaping the flow as idle. A common cadence is a ping every 20–30 seconds with a
> close after one or two missed pongs.

**Q9: What are WebSocket close codes, and can you name a few?**

> When either side initiates the closing handshake it sends a Close frame (opcode
> `0x8`) whose 2-byte payload is a status code, optionally followed by a UTF-8
> reason. The peer echoes a Close frame and the TCP connection is then shut down.
> Common codes:
>
> | Code   | Meaning                                                        |
> |--------|----------------------------------------------------------------|
> | `1000` | Normal closure — the purpose is fulfilled                     |
> | `1001` | Going away — server shutting down or client navigating off    |
> | `1002` | Protocol error                                                 |
> | `1003` | Unacceptable data type (e.g. binary where text expected)      |
> | `1006` | Abnormal closure — connection lost with no Close frame        |
> | `1008` | Policy violation (a catch-all for app-level rejection)         |
> | `1009` | Message too big                                                |
> | `1011` | Internal server error                                          |
> | `1013` | Try again later (backpressure / overload)                     |
>
> `1006` is special: it is *never sent on the wire*. The library synthesizes it
> locally to mean "the connection dropped abnormally and I never got a clean Close
> frame." Seeing lots of `1006` in your metrics usually points at network flakiness,
> a proxy timing out idle sockets, or crashes — not clean shutdowns.

**Q10: Why must a browser client mask the payload of every frame it sends?**

> RFC 6455 mandates that every frame sent *client→server* be XOR-masked with a
> random 4-byte key chosen per frame, while server→client frames are never masked.
> This isn't for confidentiality — the key travels in the same frame, so anyone
> reading the bytes can trivially unmask them. It exists to defeat **cache-poisoning
> attacks against intermediaries**.
>
> The threat: before WebSockets were widely understood, a malicious page could open
> a raw-looking connection and craft bytes that, to a transparent proxy that doesn't
> speak WebSocket, looked like a valid HTTP request for, say, a popular JS file. The
> proxy might cache the attacker-controlled response and serve it to other users.
> By XOR-masking with an unpredictable per-frame key, the attacker can no longer
> control the exact bytes on the wire, so they can't forge a recognizable HTTP
> request through the proxy. The server, which knows the key from the frame header,
> unmasks trivially. A server *must* reject an unmasked client frame, and a client
> *must* reject a masked server frame.

**Q11: When would you choose WebSockets over Server-Sent Events or long-polling?**

> The deciding axes are directionality, message frequency, and infrastructure cost.
>
> | Aspect            | Long-polling            | Server-Sent Events (SSE)      | WebSockets                     |
> |-------------------|-------------------------|-------------------------------|--------------------------------|
> | Direction         | Request/response only   | Server → client only          | Full-duplex                    |
> | Transport         | Repeated HTTP requests  | One long-lived HTTP response  | Upgraded TCP, custom framing   |
> | Data type         | Any                     | UTF-8 text only               | Text and binary                |
> | Auto-reconnect    | Manual                  | Built into the browser        | Manual (you write it)          |
> | Proxy/CDN friendly| Very                    | Yes (it's plain HTTP)         | Sometimes needs config         |
> | Overhead per msg  | Full HTTP round trip    | Tiny (framed on open stream)  | Tiny (few-byte frame header)   |
>
> Choose **WebSockets** when the client also sends frequently and the interaction is
> genuinely bidirectional and latency-sensitive — chat, games, collaborative editing,
> trading input. Choose **SSE** when data flows one way, server→client, is text, and
> you value the browser's built-in reconnect and Last-Event-ID replay plus plain-HTTP
> friendliness — notifications, feeds, live logs, progress. Choose **long-polling**
> as a fallback where nothing else survives the network, or for very infrequent
> updates. A pragmatic pattern: SSE for the downstream feed plus ordinary POSTs for
> the occasional upstream action often beats a WebSocket, because you keep the whole
> HTTP toolchain (auth, caching, HTTP/2 multiplexing, observability).

---

## Senior Questions

**Q12: What makes WebSockets hard to scale horizontally compared to a stateless HTTP service?**

> A stateless HTTP service can spread requests across any instance because each
> request is self-contained; you add machines and a load balancer and you're done.
> WebSockets break that because the connection is **stateful and long-lived**. Each
> connection pins a client to one specific server process for its entire lifetime —
> often minutes to hours. That has three consequences.
>
> First, *routing*: a message meant for user B might arrive at the server holding
> user A's connection, but B is connected to a different server. The servers must be
> able to reach each other. Second, *memory and file descriptors*: every connection
> is an open socket plus per-connection buffers and state, so capacity is measured in
> concurrent connections (hundreds of thousands per box with tuning), not requests
> per second — you can be CPU-idle and still full. Third, *rebalancing is violent*:
> you can't drain a WebSocket server the way you drain HTTP requests; deploying or
> autoscaling means dropping live connections and forcing reconnects. Load balancing
> a stateless service smooths over instance churn; with WebSockets, instance churn is
> a client-visible event.

**Q13: How do you scale WebSockets horizontally? Explain sticky sessions and a pub/sub backplane.**

> Two mechanisms working together: sticky sessions get a client *to* a server, and a
> pub/sub backplane lets servers reach *each other*.
>
> **Sticky sessions** (session affinity) make the load balancer route a given client
> to the same backend for the life of the connection — keyed on source IP or a cookie
> set at handshake. This is mostly moot for a single WebSocket, which stays on one
> TCP connection anyway; it matters for the *reconnect* and for any fallback transport
> that needs to land on the node holding the session, and to avoid pinning the wrong
> node when a client re-establishes.
>
> **The pub/sub backplane** solves fan-out across servers. When user A sends a message
> destined for user B, A's server doesn't know where B is connected. So each server
> publishes outbound events to a shared broker — Redis Pub/Sub, NATS, Kafka — and each
> server subscribes to the channels for the users/rooms it currently holds. The broker
> fans the event out; the server that owns B's socket receives it and pushes it down.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant A as Client A
>     participant S1 as WS Server 1
>     participant PS as Pub/Sub (Redis/NATS)
>     participant S2 as WS Server 2
>     participant B as Client B
>     Note over A,B: A and B are pinned to different WS servers
>     A->>S1: send("hi B") over WebSocket
>     S1->>PS: PUBLISH room:xyz {from:A, "hi B"}
>     PS-->>S2: deliver room:xyz event
>     Note over S2: S2 holds B's live socket
>     S2->>B: push frame "hi B"
>     B->>S2: send("ack") over WebSocket
>     S2->>PS: PUBLISH room:xyz {from:B, ack}
>     PS-->>S1: deliver room:xyz event
>     S1->>A: push frame "ack from B"
> ```
>
> The backplane makes the WebSocket tier effectively stateless *with respect to
> routing*: any server can accept any connection because the broker handles the
> cross-node delivery. You often add a presence/registry store (which user is on
> which node) so directed messages can target a channel instead of broadcasting.

**Q14: A client's connection drops mid-session. How do you handle reconnection and replay missed messages?**

> Reconnection is entirely your responsibility — unlike SSE, the WebSocket API gives
> you no automatic reconnect. Two problems: re-establishing the socket, and not losing
> the messages that occurred while it was down.
>
> **Reconnect** with exponential backoff *plus jitter* so a mass disconnect doesn't
> become a synchronized retry stampede (see the reconnect-storm question). Cap the
> backoff, and reset it after a stable connection. On each reconnect, re-authenticate
> and re-subscribe to the rooms/topics the client cares about.
>
> **Replay** requires the server to buffer or persist recent events with a monotonic
> sequence number or cursor per stream. On reconnect the client sends the last
> sequence number it successfully processed — conceptually the same idea as SSE's
> `Last-Event-ID`. The server replays everything after that cursor, then resumes live
> delivery. Design choices: how far back you retain (a ring buffer of N events, or a
> time window, or a durable log like Kafka/Redis Streams for stronger guarantees); and
> whether delivery is at-least-once (client must dedupe by sequence id) or you attempt
> exactly-once (much harder — usually you settle for idempotent handlers). If you skip
> replay entirely, at minimum the client should re-fetch current state via a normal
> HTTP snapshot on reconnect so the UI is consistent, then apply live deltas.

**Q15: What is backpressure in a WebSocket server, and what happens with a slow consumer?**

> Backpressure is the feedback that a downstream can't keep up with an upstream. In a
> WebSocket server the danger is a **slow consumer**: a client on a weak network, or
> one that stopped reading, while your server keeps generating messages for it. Each
> unsent message queues in that connection's send buffer. If you never bound that
> buffer, one slow client grows unbounded memory until the process OOMs — and because
> a single box holds many connections, one bad client can take down thousands.
>
> Handling it well means treating the socket's writability as a first-class signal.
> Check the outbound buffer size (`bufferedAmount` in the browser; the equivalent in
> your server library) and when it exceeds a threshold, apply a policy: drop stale
> messages (fine for a price feed — only the latest tick matters), coalesce/downsample
> (send one aggregated update instead of ten), or, if you can't lose data, stop
> producing for that client and only resume when the buffer drains. As a last resort,
> close the connection with `1013`/`1009` and let the client reconnect and resync.
> The anti-pattern is fire-and-forget writes with no bound — it turns one slow phone
> into a server-wide outage.

**Q16: How does authentication and authorization work over a WebSocket, given there are no per-request headers after the handshake?**

> The key insight: authorization happens once, at the handshake, because after the
> `101` there are no more HTTP requests to attach a token to. So you authenticate the
> *upgrade* GET. Options: send a cookie (works automatically, but you must handle CSRF
> because the handshake is a GET a cross-origin page can trigger — validate the
> `Origin` header server-side), or pass a short-lived token. You cannot set custom
> headers on a browser `WebSocket`, so the common patterns are a token in the query
> string (`wss://…/ws?token=…`, but beware it lands in access logs) or, better, a
> first application message right after `onopen` that carries the token, with the
> server refusing to process anything else until it validates.
>
> Because the connection is long-lived, you also need to think about *token
> expiry mid-session*: either re-validate periodically over the channel and force a
> reconnect when credentials lapse, or accept that a session lives as long as the
> socket. For authorization of individual actions, re-check permissions per message
> on the server — never trust that "authenticated at connect" means "allowed to do
> everything for the next two hours."

---

## Professional / Deep-Dive Questions

**Q17: A deploy just restarted your fleet and now you have a reconnect storm. What happened and how do you prevent it?**

> A reconnect storm ("thundering herd") happens when a large set of clients lose their
> connections at nearly the same instant — a rolling deploy, an autoscaler killing
> nodes, a load balancer failover — and all try to reconnect simultaneously. The
> reconnect wave hammers the handshake path, TLS termination, the auth service, and
> the presence store all at once. If the servers can't absorb it, some reconnects
> fail, those clients retry, and you get a self-amplifying loop that keeps the fleet
> pinned. The handshake is dramatically more expensive than steady-state (TLS,
> auth, subscription rehydration, state fetch), so a mass reconnect can cost 10–100×
> the load of the same clients sitting idle.
>
> Defenses, layered:
> - **Backoff with jitter** on the client — never a fixed delay. Full jitter
>   (`sleep = random(0, min(cap, base·2^attempt))`) spreads the herd across a window
>   instead of re-synchronizing it. This is the single most important fix.
> - **Slow, staggered rollouts** — drain and cycle a small percentage of nodes at a
>   time, with a pause, so only a fraction of connections migrate at once.
> - **Connection draining hints** — send a `1001`/`1013` close with a "reconnect after
>   N seconds" signal so clients spread their return, and where possible hand off
>   gracefully before killing the old process.
> - **Capacity headroom and rate-limited accept** — cap the handshake accept rate so
>   the reconnect flood degrades gracefully (queued, not collapsed), and keep enough
>   spare nodes that the surviving fleet can hold the reconnecting clients.
> - **Cheap resume** — make reconnect fast: resumable sessions, cached auth,
>   incremental catch-up instead of a full state reload, so each reconnect costs less.

**Q18: How do WebSockets behave across HTTP/1.1, HTTP/2, and HTTP/3, and how do corporate proxies and load balancers complicate them?**

> Classic WebSockets (RFC 6455) ride on HTTP/1.1's `Upgrade` mechanism over a single
> TCP connection. HTTP/2 doesn't have the same `Upgrade` semantics — its answer is
> RFC 8441, which bootstraps WebSockets over an HTTP/2 stream via an extended
> `CONNECT`, letting a WebSocket share a multiplexed HTTP/2 connection (support is
> uneven across servers, proxies, and clients). HTTP/3 runs on QUIC/UDP; RFC 9220
> extends the same `CONNECT` approach there. In practice today most deployments still
> negotiate WebSockets over HTTP/1.1, and infra must be configured to allow the
> upgrade.
>
> Proxies and LBs complicate this in concrete ways: a Layer-7 proxy or LB must
> explicitly understand and forward the `Upgrade`/`Connection` headers, or it strips
> them and the handshake fails. Idle-timeout settings that are sane for HTTP requests
> (say 60s) silently kill long-lived idle WebSockets, producing mysterious `1006`
> closes — you must raise them and use application pings to keep flows warm. Some
> corporate/transparent proxies simply don't allow the upgrade at all; this is why
> production real-time libraries (Socket.IO, SockJS) implement a *fallback ladder* —
> try WebSocket, and if it fails, degrade to long-polling. And terminating TLS
> (`wss://`) at the edge is strongly preferred both for cost and because plaintext
> upgrades are more likely to be mangled by intermediaries.

**Q19: What does a WebSocket cost on the server, and how do you size a fleet for N million concurrent connections?**

> The cost model is *connections*, not requests. Each connection consumes: a file
> descriptor, kernel socket buffers (send + receive), per-connection application state
> (user id, subscriptions, sequence cursors), and a slice of TLS session state. CPU is
> spent mostly at handshake (TLS + auth) and on message throughput, not on idle held
> connections. So a box can hold hundreds of thousands of *idle* connections while
> being CPU-bound the moment they all get chatty.
>
> Sizing method: measure bytes-per-connection at rest under your framework, and
> messages-per-second-per-connection at peak. Then two ceilings apply — memory
> (`total_conns × bytes_per_conn` must fit with headroom) and throughput
> (`total_conns × msg_rate × msg_size` must fit your CPU and NIC). File-descriptor and
> ephemeral-port limits, `net.core.somaxconn`, and epoll tuning all need raising from
> defaults; the classic "C10K/C10M" tuning. For N million connections you shard across
> many nodes, front them with LBs that can pass through upgrades and hold their own
> connection tables, and add the pub/sub backplane for cross-node fan-out. Critically,
> size for the **reconnect surge**, not the steady state — the fleet must survive
> re-establishing a large fraction of connections at once, which is the real capacity
> constraint.

**Q20: How do you guarantee message ordering and delivery over WebSockets, and what happens across a reconnect?**

> On a *single* WebSocket connection, ordering is free: it rides on one TCP stream, so
> frames are delivered in order and framing is reliable byte-for-byte. The hard cases
> are (a) fan-out through a backplane and (b) reconnects.
>
> Through a backplane, ordering is only as strong as the broker. Redis Pub/Sub gives
> you no durability and only per-channel best-effort ordering; Kafka gives you strict
> ordering *within a partition*, so you must partition by the entity whose order
> matters (e.g. by room or by user) to keep a total order there. If two producers
> publish concurrently, "order" is only well-defined once the broker serializes them.
>
> Across a reconnect, the in-flight TCP guarantee is gone: messages sent while the
> socket was down are lost unless you buffered them, and the client may have received
> a message the server isn't sure landed. So you build application-level guarantees on
> top: monotonic sequence numbers per stream, client-side dedupe, and cursor-based
> replay (client says "last seq I have is 4711," server replays from 4712). This gives
> at-least-once delivery with idempotent processing — the pragmatic target.
> Exactly-once end-to-end generally isn't achievable at the transport layer, so you
> make handlers idempotent instead of chasing it.

**Q21: Compare building your own WebSocket layer versus using a managed/real-time platform.**

> This is a build-vs-buy call, and the honest answer is that the socket handling is
> the easy 20% — the operational tail is the 80%. What you're really deciding is who
> owns fan-out, presence, reconnection semantics, scaling, and edge distribution.
>
> **Buy** (Ably, Pusher, PubNub, AWS API Gateway WebSockets, Supabase Realtime) when
> real-time isn't your core differentiator, you want global edge presence without
> running a fleet, and you'd rather pay per-message/per-connection than staff a team
> to run stateful infrastructure. You get reconnection, replay, presence, and
> horizontal scale as product features. The costs: per-connection pricing that can
> dominate at scale, vendor lock-in, and less control over latency-critical paths.
>
> **Build** (raw WebSockets on your servers, or a library like Socket.IO / Phoenix
> Channels / Centrifugo, plus Redis/NATS/Kafka) when real-time *is* your product, when
> you have unusual routing or data-sovereignty needs, when scale makes per-message
> pricing untenable, or when you need deep control over the backplane. The cost is that
> you now own the reconnect storms, backpressure, presence store, and 3am pages.
>
> A common middle path: build on Phoenix Channels or Centrifugo, which give you the
> backplane, presence, and scaling patterns as a framework while you keep your own
> infrastructure — most of the "buy" ergonomics without the per-connection bill.

---

## Staff / Judgment Questions

**Q22: A team wants to "make the app real-time" by putting everything on a WebSocket. How do you evaluate that?**

> I'd push back on "everything," because WebSockets convert a stateless, cacheable,
> horizontally-trivial HTTP system into a stateful one with a whole new failure class,
> and that tax should be paid only where it buys something. My evaluation runs three
> questions.
>
> First, *which interactions actually need push?* Request/response that happens to be
> fast doesn't need a socket — a plain API call is simpler, cacheable, and observable
> with existing tooling. Only genuinely server-initiated, latency-sensitive, or
> high-frequency-bidirectional flows justify a persistent connection. Often the honest
> answer is "one feed and a handful of actions," not "everything."
>
> Second, *is a lighter transport enough?* If the real need is server→client updates
> of text, SSE gives you built-in reconnect and replay over plain HTTP for a fraction
> of the operational cost. WebSockets earn their keep specifically when the client also
> streams upstream frequently.
>
> Third, *can we afford the operational surface?* Sticky routing, a pub/sub backplane,
> presence, reconnect storms, backpressure, per-connection memory sizing, and deploys
> that drop live connections. If the team isn't ready to own those, "real-time
> everything" becomes an outage generator. My recommendation is usually surgical:
> WebSockets (or SSE) for the two or three flows that truly need push, ordinary HTTP
> everywhere else, and one shared, well-run real-time subsystem rather than sockets
> sprinkled across every feature.

**Q23: When would you deliberately *not* use WebSockets, even for a feature that feels real-time?**

> Several situations where I'd steer away despite the "real-time" label:
>
> - **One-directional server→client text.** SSE is a better fit — free reconnect,
>   `Last-Event-ID` replay, works through every proxy and CDN because it's plain HTTP.
>   Reach for WebSockets only when you also need a frequent upstream channel.
> - **Infrequent or staleness-tolerant updates.** If the data changes every few
>   minutes and the user won't notice a small delay, periodic polling is cheaper to
>   build, run, and reason about than a stateful socket per user.
> - **Hostile network environments.** If a large share of users sit behind corporate
>   proxies that block upgrades, you'll be maintaining a fallback ladder anyway — start
>   with the transport that survives (long-polling/SSE) rather than fighting the proxy.
> - **Small teams without ops capacity for stateful infra.** The reconnect storms,
>   backpressure, and backplane are real work; a managed platform or SSE avoids owning
>   them.
> - **Request/response semantics.** If a message expects exactly one reply and you want
>   HTTP's caching, status codes, idempotency keys, and per-request auth, don't
>   contort that into a socket. Use HTTP.
>
> The meta-rule: WebSockets are the right tool when the interaction is genuinely
> bidirectional, frequent, and latency-sensitive. Absent all three, a cheaper
> transport almost always wins on total cost of ownership.

**Q24: You're designing the real-time backbone for a product expected to grow 100×. What are the load-bearing decisions you make on day one?**

> I optimize for the decisions that are expensive to reverse, not for premature scale.
> The load-bearing ones:
>
> - **Decouple routing from the socket tier via a backplane from day one.** Even at
>   small scale, publish outbound events to a broker and have servers subscribe to what
>   they hold. Retrofitting cross-node fan-out after you've assumed a single box is a
>   painful rewrite; designing for it early costs little.
> - **Make the tier restartable without user pain.** Sequence-numbered streams,
>   cursor-based replay, and a cheap resume path so a deploy or an autoscale event is a
>   blip, not an incident. This is what lets you operate the fleet at all.
> - **Enforce backpressure policy per connection.** Bounded send buffers with an
>   explicit drop/coalesce/close policy, chosen per data type, so a slow consumer can
>   never OOM a node. This is the difference between a bad client and a bad day.
> - **Jittered client backoff, everywhere, from launch.** It's a one-line client change
>   that determines whether your first big deploy survives. Add it before you need it.
> - **Pick the delivery guarantee explicitly.** At-least-once with idempotent handlers
>   is the pragmatic default; don't drift into implicit assumptions about ordering or
>   exactly-once that the backplane can't honor.
> - **Instrument connections, not just requests.** Concurrent connections, per-node
>   fan-in, buffered-bytes distribution, `1006` rate, reconnect rate, and handshake
>   latency. You can't operate what you can't see, and the WebSocket failure modes are
>   invisible to request-centric dashboards.
> - **Keep an off-ramp.** Whether managed platform or self-hosted, avoid coupling
>   business logic to one vendor's proprietary channel semantics so 100× growth can be
>   a scaling exercise, not a migration.

---

*Next step:* [Server-Sent Events](../06-server-sent-events/junior.md)
