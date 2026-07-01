# Long-Polling & Streaming — Interview Questions

A structured question bank on HTTP-based push emulation: short-polling, long-polling, and streaming (chunked transfer, SSE-adjacent). Answers favor arithmetic, concrete numbers, and the trade-offs that separate a correct answer from a memorized one.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is the difference between short-polling, long-polling, and streaming?**

> All three are ways for a browser to receive server updates over plain HTTP, differing in *when the response returns*.
>
> - **Short-polling**: the client sends a request on a fixed timer (say every 5 s). The server answers *immediately* with "here is what I have, possibly nothing." Simple, but most requests come back empty.
> - **Long-polling**: the client sends a request and the server *holds it open* until data is available or a timeout fires, then responds. The client immediately re-requests. Latency drops to near-zero without a persistent protocol.
> - **Streaming**: the client sends *one* request and the server keeps the response body open, pushing many messages down the same connection (chunked transfer or SSE) without the client re-requesting.
>
> The progression trades simplicity for lower latency and fewer wasted requests.

**Q2: Walk through how a single long-poll cycle works.**

> 1. Client issues `GET /events?cursor=42`.
> 2. Server checks for events after cursor 42. If some exist, it responds now. If none, it *parks* the request (registers a callback / suspends the handler) instead of returning an empty body.
> 3. When a new event arrives — or a server-side timeout (e.g. 30 s) elapses — the server writes the response and closes it.
> 4. The client receives the response, processes any events, updates its cursor, and immediately fires the next `GET /events?cursor=…`.
>
> The key idea: the *pending* request is the "channel." At any moment each client has exactly one request in flight.

**Q3: Why is short-polling considered wasteful?**

> Because most requests return nothing. If you poll every 5 s but the average message arrives every 60 s, roughly 11 of every 12 requests are empty round-trips. Each still pays the full cost of a TCP/TLS handshake (if not kept alive), request headers, server dispatch, and a response — often hundreds of bytes of headers to carry zero bytes of payload. You burn bandwidth, server CPU, and battery for the privilege of *usually* learning nothing changed.

**Q4: What does "the client reconnects immediately" mean in long-polling, and why?**

> After the server responds to a long-poll (with data or on timeout), there is a brief window where *no request is in flight* — the client is not listening. If an event fires in that gap, the server cannot push it. So the client must re-issue the request as fast as possible to reopen the channel. The gap is unavoidable but should be minimized; correctness is preserved not by shrinking the gap but by using cursors (see Q9) so nothing gets lost during it.

**Q5: What HTTP status and headers make a streaming response possible?**

> A `200 OK` with **`Transfer-Encoding: chunked`** and **no `Content-Length`**. Chunked encoding tells the client the body arrives in framed pieces of unknown total size, so the server can flush chunks over time and the connection stays open. For an event stream you also send `Content-Type: text/event-stream` (SSE) or a custom line-delimited type, plus `Cache-Control: no-cache` so proxies don't buffer or serve stale data.

**Q6: Does long-polling need WebSockets or any special protocol?**

> No. Long-polling is *plain HTTP*. That is its main appeal: it works through virtually any proxy, corporate firewall, or CDN because it looks like an ordinary slow request. WebSockets need an `Upgrade` handshake that some middleboxes strip or block; long-polling has no such requirement, which is exactly why it survives as a fallback.

---

## Middle Questions

**Q7: Derive the mean notification latency and request rate for short-polling with interval `T`.**

> Assume events arrive independently of the poll timer. A given event lands uniformly at random within a polling interval, so the client learns of it after an average delay of **`T/2`**, with a worst case of `T`.
>
> - Poll every 5 s → mean latency **2.5 s**, worst case 5 s.
> - Poll every 1 s → mean latency 500 ms, worst case 1 s.
>
> The request rate is `1/T` per client regardless of activity. For 100,000 connected users at `T = 5 s`: `100000 / 5 = 20,000 req/s` — a constant floor of traffic even when nothing is happening. Halving latency (→ `T = 2.5 s`) *doubles* the request rate to 40,000 req/s. That linear coupling of latency and load is the reason short-polling doesn't scale to low latency.

**Q8: Compare the three approaches across the dimensions that matter.**

> | Dimension | Short-poll | Long-poll | Streaming (chunked/SSE) |
> |---|---|---|---|
> | Mean latency | `T/2` (e.g. 2.5 s) | ~network RTT | ~network RTT |
> | Requests per client | `1/T`, constant | ~1 per message + timeouts | 1 (reconnect on drop) |
> | Empty responses | Many | None (only timeouts) | None |
> | Server-held connections | 0 idle | 1 pending per client | 1 open per client |
> | Works through dumb proxies | Yes | Yes | Usually (needs no buffering) |
> | Server model | Any | Async preferred | Async required |
> | Client complexity | Trivial | Reconnect loop + cursor | Stream parser + resume |
> | Bidirectional | No | No | No (server→client only) |
>
> Short-poll optimizes for simplicity, long-poll for compatibility with low latency, streaming for throughput when many messages flow.

**Q9: What is the message-gap problem, and how do cursors solve it?**

> The gap is the interval between "server responded" and "client's next request is registered." An event produced in that window has no in-flight request to ride on. If the server pushes to whatever is connected, that event is silently lost.
>
> The fix is to make the client **stateful about position** rather than about connection. Each event has a monotonic id (offset, sequence number, timestamp+tiebreaker). The client sends its last-seen id — `GET /events?cursor=42` — and the server returns *everything after 42*. When the client reconnects after the gap, it asks again from 42; any events produced during the gap were assigned ids > 42 and are delivered on the next response. Delivery becomes independent of connection continuity. SSE formalizes this with the `Last-Event-ID` header.

**Q10: Why do async / event-driven servers matter so much for long-poll and streaming?**

> Because these patterns hold connections *idle* for a long time. With one OS thread per pending request, 50,000 parked long-polls means 50,000 threads — at ~1 MB of stack each that's ~50 GB of RAM plus scheduler overhead, mostly doing nothing. An async server (epoll/kqueue event loop, goroutines, async/await) suspends a request as a cheap continuation — a few KB — and wakes it when data arrives. The same box can hold hundreds of thousands of idle connections. The workload is I/O-bound and mostly *waiting*, which is exactly what async models are built to make cheap.

**Q11: Where do timeouts live in a long-poll path, and how must they be ordered?**

> There are several, and they must be ordered from **innermost (shortest) to outermost (longest)** so the *application* controls termination, not a middlebox:
>
> - **App hold timeout** — how long the handler parks the request (e.g. 25 s). Should be the shortest.
> - **Load balancer idle timeout** — e.g. AWS ALB default 60 s.
> - **Reverse proxy read/send timeout** — nginx `proxy_read_timeout`, default 60 s.
> - **Client request timeout** — how long the browser/lib waits.
>
> If the app holds for 25 s while the LB cuts at 60 s, the app always responds first with a clean, resumable answer. If those are reversed — app holds 90 s, LB cuts at 60 s — the client sees an abrupt 504 with no cursor advance, no clean framing, and a reconnect storm. Rule of thumb: **app_hold < LB_idle < proxy_read**, each with a safety margin.

**Q12: What delivery guarantee does long-polling naturally provide, and what does the client owe in return?**

> With cursors, long-polling gives **at-least-once** delivery. The server can crash after sending a batch but before the client commits the new cursor; on reconnect the client re-requests from the *old* cursor and receives the batch again. That means the client (or a downstream consumer) must be **idempotent**: dedupe by event id, or design handlers so replaying an event is harmless. You get at-least-once cheaply; exactly-once would require a commit protocol the transport doesn't provide.

**Q13: How does chunked transfer encoding actually frame a streaming body?**

> Each chunk is sent as a hex length line, `CRLF`, the bytes, `CRLF`. A zero-length chunk (`0\r\n\r\n`) terminates the stream. So the server can compute one event, write it as a chunk, and **flush** — the client's parser sees a complete framed message immediately, without waiting for `Content-Length` or connection close. The critical operational detail is disabling buffering everywhere in the path (app output buffer, nginx `proxy_buffering off`, no gzip that accumulates), otherwise chunks pile up and the "streaming" is delivered in one late lump.

---

## Senior Questions

**Q14: A message can be produced while the client's request is not in flight. Prove your design never loses it.**

> Model the client as holding a durable `cursor` = highest event id it has fully processed. Invariant: **the client only advances `cursor` after successfully processing every event up to that id.** The server's contract: given `cursor = k`, return all events with id > k, in id order.
>
> Consider any event `e` with id `n`. The client processes `e` only via some response to a request carrying `cursor < n`. Whether `e` was produced while a request was in flight or during the gap, `e` sits in the store with id `n`. The client's *next* request carries `cursor = m` where `m < n` (it hasn't seen `e` yet), so the server's response includes `e`. The gap can delay `e` but cannot skip it, because delivery is keyed on stored id, not on connection presence. Loss would require the client to advance `cursor ≥ n` without processing `e`, which the invariant forbids. ∎

**Q15: Diagram the degradation ladder from WebSocket down to short-poll, and explain the fallback trigger at each rung.**

> ```mermaid
> flowchart TD
>   subgraph Stage1["1 · Attempt WebSocket"]
>     A[Client opens WS Upgrade] --> B{Handshake OK<br/>+ stays open?}
>   end
>   B -- yes --> WS[Bidirectional, lowest overhead]
>   B -- "no: proxy strips Upgrade<br/>or drops idle" --> C
>   subgraph Stage2["2 · Fall back to SSE"]
>     C[Open text/event-stream] --> D{Chunks flow<br/>unbuffered?}
>   end
>   D -- yes --> SSE[Server→client stream,<br/>auto-reconnect + Last-Event-ID]
>   D -- "no: proxy buffers<br/>or blocks chunked" --> E
>   subgraph Stage3["3 · Fall back to long-poll"]
>     E[GET with cursor, server holds] --> F{Held request<br/>survives to timeout?}
>   end
>   F -- yes --> LP[Near-RTT latency<br/>over plain HTTP]
>   F -- "no: aggressive idle cut<br/>on any held request" --> G
>   subgraph Stage4["4 · Fall back to short-poll"]
>     G[GET on fixed interval] --> SP[Always works;<br/>T/2 latency, high req rate]
>   end
> ```
>
> Each rung sheds a requirement the middlebox couldn't honor: WebSocket needs `Upgrade` to pass; SSE needs unbuffered chunked responses; long-poll needs held requests to not be cut mid-hold; short-poll needs nothing but request/response. You descend only as far as the environment forces you, and short-poll is the universal floor.

**Q16: Why keep long-polling as a fallback in a WebSocket-first product?**

> Because a non-trivial slice of real users sit behind proxies, VPNs, mobile carriers, and corporate firewalls that break persistent connections — strip the `Upgrade`, buffer chunked bodies, or kill idle sockets in seconds. For those users, WebSocket and SSE silently fail or thrash, but a long-poll (a plain slow `GET`) sails through. Even a 1–3% failure rate is unacceptable for a chat or trading UI. Long-poll is the "it always works" tier: higher per-message overhead, but it delivers correct, ordered, resumable messages where nothing else connects. The engineering cost is one shared cursor abstraction the other transports already use.

**Q17: How do you preserve ordering and dedupe across a reconnect that spans multiple servers?**

> Ordering can't come from the connection (it just got replaced) — it must come from a **globally meaningful id**: a per-stream monotonic sequence, a log offset (Kafka partition offset), or a Lamport/hybrid-logical clock for multi-writer streams. The client tracks the max id it has committed. On reconnect to *any* server, it presents that id; the new server queries the shared store for `id > cursor` in id order. Dedup is the same id: the client keeps a small window of recently-seen ids and drops repeats. Two requirements make this robust: (a) ids are assigned at a point of serialization *before* fan-out, not per-connection; (b) the backing store is shared/replicated so any server can answer from any cursor.

**Q18: Estimate the resource cost of 500,000 long-poll clients and decide the server model.**

> Per client you hold one idle TCP connection plus a suspended request context.
>
> - **Thread-per-request**: 500,000 × ~1 MB stack ≈ **500 GB RAM** just for stacks — infeasible on any single node, and the scheduler chokes long before that.
> - **Async (event loop / goroutines)**: a suspended request is a few KB of heap plus a socket. Sockets cost kernel memory (~10–20 KB with buffers) → 500,000 × ~15 KB ≈ **7.5 GB** of socket buffers, plus ~1–4 KB per continuation ≈ another ~1–2 GB. Call it ~10 GB — fits comfortably, and you'd shard across a handful of nodes for headroom and blast radius.
>
> Conclusion: async is mandatory. Also tune the OS (`somaxconn`, ephemeral port range, `nofile` ulimit into the millions across the fleet), because at this scale the file-descriptor and port limits bite before CPU does.

**Q19: What was Comet, and what did it teach us that still applies?**

> "Comet" (coined ~2006) was the umbrella term for pushing data to browsers over HTTP *before* WebSockets existed — implemented via long-polling and "forever frames"/hidden-iframe streaming. It powered early live features (Meebo, Gmail chat) and proved the model of *server-held HTTP requests as a push channel*. The lessons endure: (1) latency and request rate are coupled in polling, so hold the request instead; (2) middleboxes buffer and time out, so you must control framing and timeouts; (3) resumability needs a cursor, not a socket. WebSocket/SSE later standardized the transport, but the correctness discipline — ids, idempotency, reconnect loops — came straight out of the Comet era and is exactly what you still implement behind SSE and long-poll fallbacks today.

---

## Professional / Deep-Dive Questions

**Q20: nginx sits in front of your long-poll service and clients get 504s at ~60 s despite a 25 s app hold. Diagnose.**

> A clean 25 s hold should never reach a 60 s proxy timeout, so something is *re-holding* or *buffering*. Prime suspects, in order:
>
> 1. **`proxy_buffering on`** (default): nginx buffers the upstream response and may not forward the app's early completion promptly; combined with `proxy_read_timeout 60s` you can see stalls. Set `proxy_buffering off` for the streaming/long-poll location.
> 2. **Keep-alive / upstream reuse** masking the real timeout: check whether the 504 is upstream (app slow) or nginx-generated. `proxy_read_timeout` counts time between *reads* from upstream; if the app parks silently for 25 s with no bytes, and something resets the hold to loop again, cumulative silence crosses 60 s.
> 3. **App accidentally re-parking**: a bug where the handler loops and re-suspends without flushing means no bytes reach nginx for >60 s. Emit a periodic heartbeat/comment line (`: ping\n\n`) every ~15 s to reset the read timer and to detect dead peers.
> 4. **A second proxy** (CDN/ELB) with its own 60 s idle. Trace the whole chain; the tightest timeout wins.
>
> Fix: `proxy_read_timeout` > app hold + margin, `proxy_buffering off`, heartbeats, and verify no double-hold. The 60 s value being a *default* is the tell that a middlebox, not your code, is terminating.

**Q21: How do you tune the app hold timeout — what forces make it neither too short nor too long?**

> Push it *up* toward fewer reconnects; push it *down* toward faster failure detection and headroom under the LB.
>
> - **Too short** (e.g. 5 s): with sparse traffic, most holds time out empty and the client reconnects constantly — you've reinvented short-polling with 5 s intervals, restoring the `1/T` request floor. For 100k idle clients at 5 s that's 20k req/s of pure churn.
> - **Too long** (e.g. 120 s): fewer reconnects, but you risk exceeding LB/proxy idle limits (giving 504s), you detect dead clients slowly (a client that vanished still holds a slot for up to 120 s), and NAT/firewall idle mappings (often 30–120 s) may silently drop the connection so the response can't be delivered.
>
> Sweet spot is usually **20–45 s**: comfortably under the common 60 s middlebox default, long enough that idle clients reconnect only ~1–3 times/min, short enough to reclaim dead slots. Pair it with heartbeats if the environment cuts truly-idle connections faster.

**Q22: Design the cursor scheme for a feed where events come from multiple shards. What breaks with a naive per-shard sequence?**

> A single integer per shard doesn't give a global order the client can present as *one* cursor. If the feed merges shards A and B, a cursor of "42" is ambiguous — 42 in which shard? Naive concatenation loses monotonicity across shards, so a reconnect can skip or replay incorrectly.
>
> Options:
> - **Composite cursor**: `{shardId: offset}` map, e.g. `A:42,B:17`. The client sends all positions; the server resumes each shard independently and merges. Correct, but cursor grows with shard count.
> - **Single ordering authority**: assign a global sequence (or hybrid logical clock) *at merge time* before fan-out, so the client tracks one number. Requires a serialization point, which can become a bottleneck.
> - **Time-based with tiebreaker**: `(timestamp, shardId, localSeq)` — orders across shards without a global counter, tolerant of clock skew within the tiebreaker window, but "resume from time T" can replay a bounded window.
>
> Choose composite for a fixed small shard count, a global sequence when a serialization point is affordable and strict order matters, time-based when shards are many and you can tolerate at-least-once with a small replay window.

**Q23: Quantify the crossover where streaming beats long-polling on overhead.**

> Let each long-poll response carry `H` bytes of HTTP headers (request + response, say ~800 B combined for a modern request) and `P` bytes of payload. Long-poll pays `H` *per message* (each message ≈ one held request answered). Streaming pays `H` **once** at stream open, then only per-chunk framing (chunk length line + CRLFs ≈ tens of bytes) per message.
>
> If a client receives `N` messages over a session:
> - Long-poll bytes ≈ `N·(H + P)` (plus timeout reconnects).
> - Streaming bytes ≈ `H + N·(f + P)` where `f` ≈ 20 B chunk framing.
>
> Streaming wins whenever `N·H` (long-poll's repeated headers) exceeds `H + N·f`, i.e. essentially always for `N ≥ 2` when `H ≫ f`. At `H = 800 B`, `f = 20 B`, 50 messages: long-poll spends `50·800 = 40 KB` on headers; streaming spends `800 + 50·20 = 1.8 KB`. That **~22× header reduction** is why high-message-rate feeds (live scores, tickers, log tails) prefer streaming, while low-rate feeds (occasional notifications) barely care and pick long-poll for its proxy-friendliness.

**Q24: A client oscillates between SSE and long-poll every few minutes, causing reconnect storms. Root-cause and stabilize.**

> Oscillation means the fallback decision is *stateless and per-attempt*: SSE half-works (connects, then a proxy buffers/cuts it after N seconds), the client flips to long-poll, long-poll succeeds briefly, some heuristic re-tries SSE (optimism), and the cycle repeats. Each flip drops and re-establishes connections across the fleet → storms.
>
> Stabilize with three mechanisms:
> 1. **Sticky, hysteretic downgrade**: once SSE fails K times in a window, *pin* the client to long-poll for a cooldown (e.g. 30 min) before probing SSE again. Don't upgrade eagerly.
> 2. **Distinguish "connected" from "healthy"**: SSE that connects but delivers no heartbeat within X seconds is *unhealthy* — treat it as failure fast, before it looks intermittently alive.
> 3. **Jittered backoff on reconnect** so that when many clients do flip, they don't reconnect in a synchronized wave; add full jitter to the reconnect delay.
>
> The underlying bug is treating fallback as a coin flip per connection rather than a *stateful capability decision* per client/environment. Fallback should ratchet down and stay down until there's evidence the environment changed.

---

## Staff / Judgment Questions

**Q25: You're choosing the real-time transport for a new product. Give the decision framework, not a favorite.**

> Decide along four axes:
>
> 1. **Directionality**: need client→server too (typing indicators, cursors, acks)? → WebSocket. Server→client only (feeds, notifications, dashboards)? → SSE or long-poll suffice and are simpler.
> 2. **Message rate**: high and steady (ticker, log tail) → streaming amortizes headers; sparse (a notification every few minutes) → long-poll's per-message overhead is irrelevant, and its proxy-friendliness wins.
> 3. **Reach/environment**: consumer app over hostile networks (corp proxies, carriers) → you *must* have a long-poll (and ultimately short-poll) fallback regardless of the primary. Internal tool on a controlled network → you can commit to WebSocket alone.
> 4. **Operational maturity**: WebSocket needs sticky routing or a shared pub/sub bus, connection-count autoscaling, and careful LB config. If the team can't operate that yet, SSE/long-poll over the existing HTTP stack ships sooner and safer.
>
> The staff answer is: pick a primary for the common case and *always* define the degradation ladder and the shared cursor abstraction, because the transport is replaceable but the correctness contract (ids, idempotency, resume) is not. Build the contract once; let transports be swappable behind it.

**Q26: Leadership wants to "just use WebSockets everywhere and delete the polling code." How do you respond?**

> I'd resist deleting the fallback and explain the risk in their terms. WebSockets fail *silently and selectively* for a minority of users behind broken middleboxes — the exact users who won't file a bug, they'll just churn. Removing long-poll converts a graceful degradation into an outage for that segment, and it's invisible in aggregate dashboards until support tickets and retention data reveal it weeks later.
>
> I'd propose a middle path: make WebSocket the primary, keep the long-poll fallback behind the shared cursor abstraction (so it's ~one code path, not a parallel stack), and add a metric — *percentage of sessions that fell back*. If that number is a fraction of a percent, we can revisit deletion with data. If it's several percent, we've just quantified the customers we'd have silently dropped. The goal isn't to hoard code; it's to not trade a measurable reliability floor for a modest maintenance saving.

**Q27: When would you deliberately choose short-polling despite its inefficiency?**

> When simplicity and robustness dominate and latency doesn't matter:
>
> - **Low-value, low-frequency status checks**: "is the export ready?" polled every 10 s from a job-status page. Held connections aren't worth the server resources; a stateless poll is trivially cacheable and load-balanceable.
> - **Hostile or unknown infrastructure** where even long-poll's held request gets cut, and you need something that provably always works.
> - **Serverless / stateless backends** billed per-invocation and awkward at holding open connections — a short poll fits the request/response model of FaaS cleanly, whereas a 30 s held request costs 30 s of billed duration.
> - **Extremely spiky client counts** where you'd rather not carry hundreds of thousands of idle sockets; short-poll converts that to burstable, sheddable request load you can rate-limit and cache.
>
> The judgment: short-poll's constant `1/T` load is a *feature* when it makes the system stateless, cacheable, and boring. Reach for it when "correct and cheap to operate" beats "low latency."

**Q28: Post-incident: during a deploy, thousands of long-poll clients all reconnected at once and overwhelmed the new servers. What went wrong and how do you prevent it?**

> Two failure modes stacked. First, a **thundering herd**: when old servers drained, every parked request completed near-simultaneously, and every client reconnected in the same instant — a synchronized wall of new requests hitting the fresh fleet before it was warm. Second, likely **no jittered backoff**, so the herd stayed synchronized on subsequent retries, and possibly **no connection-draining budget**, so capacity dipped exactly as demand spiked.
>
> Prevention:
> - **Staggered draining**: close held connections in waves over a rollout window, not all at once, so reconnects spread over minutes.
> - **Full-jitter reconnect**: client reconnect delay = `random(0, base)` so re-arrivals smear across time.
> - **Warm the fleet / surge capacity** during deploys; scale on connection count, not just CPU, since idle connections show low CPU right up until the reconnect storm.
> - **Load shedding at the edge** (429 + `Retry-After`) so an overwhelmed new node pushes back cheaply instead of collapsing.
>
> The meta-lesson: any push-emulation transport concentrates risk at reconnect time. Design the *reconnect* path — jitter, draining, surge, shedding — with the same care as the happy path, because deploys and network blips make reconnect the highest-load moment in the system's life.

---

*Next step:* [Network Proxies & NAT](../08-network-proxies-and-nat/junior.md)
