# Realtime Chat & Presence Service

> Hold 100k+ live WebSocket connections on one Go node, fan messages out across a
> cluster, and track who's online — without one slow client poisoning the rest or
> a reconnect storm taking the node down. Memory per connection and fan-out p99
> are the numbers you defend.

| | |
|---|---|
| **Tier** | Senior (own a service end-to-end) |
| **Primary domain** | Realtime messaging / networking |
| **Skills exercised** | WebSockets, goroutine-per-conn vs epoll, Redis/NATS pub-sub fan-out, presence with TTL heartbeats, slow-consumer backpressure, graceful drain, Go (`gorilla/websocket` / `coder/websocket`, `gnet`, `go-redis`) |
| **Interview sections** | 2 (concurrency), 7 (caching/Redis), 9 (networking) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own "realtime" at a product with a few million registered users and a chat +
presence surface (DMs, channels, typing indicators, online/away dots). On a busy
evening you have **400k users connected at once**, spread over a handful of nodes,
and each user often has 2–3 devices open. The current single-node prototype falls
over around 20k connections: memory balloons, one mobile client on a train (a
*slow consumer*) backs up the whole event loop, and every deploy drops every
socket at once, producing a thundering-herd reconnect that the node can't absorb.

Your job is to build a WebSocket chat-and-presence service in Go that **holds
100k+ concurrent connections per node**, fans messages out across nodes so a
user's devices receive a message no matter which node they landed on, and keeps
presence accurate under churn — and to *prove* the per-connection memory cost,
the cross-node fan-out latency, and that slow clients are isolated. You will
produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Sustain **100k concurrent WebSocket connections on a single node** and report
  the real memory and file-descriptor cost per idle connection.
- Fan messages out **across nodes** (Redis pub/sub or NATS) so delivery is
  independent of which node a recipient is connected to.
- Track **presence** (online / away / offline) with TTL heartbeats that converge
  correctly under connect/disconnect churn.
- Implement **backpressure**: a bounded per-connection send buffer with an
  explicit drop/disconnect policy, so one slow client cannot stall others.
- Deliver **at-least-once with client-side dedup**, ordered per channel, with
  **reconnect + missed-message catch-up**.
- Detect dead connections (ping/pong) and **drain a node gracefully** for deploys.

**Non-goals**
- Message *persistence* as a product feature — keep a short bounded backlog per
  channel for catch-up, not a full chat history store.
- Rich chat features (reactions, threads, media upload). Text frames only.
- Auth UX / account system — assume a signed token grants a `user_id`.
- End-to-end encryption (that's a different lab).

## 3. Functional requirements

1. A **gateway** (`cmd/gateway`) terminates WebSocket connections, authenticates
   the opening handshake (`?token=` → `user_id`), and registers the connection in
   a local connection table keyed by `user_id` → set of conns (multi-device).
2. Clients **subscribe** to channels (`{ "op": "sub", "channel": "room:42" }`) and
   **publish** messages; the gateway fans each message to all local subscribers
   **and** publishes it to the cross-node bus so other nodes deliver to their
   subscribers.
3. A **presence subsystem** marks a user online while they hold ≥1 connection,
   `away` after an idle window, and `offline` when their last heartbeat TTL
   lapses; presence changes are broadcast to interested subscribers.
4. On **reconnect**, a client sends its last-seen `seq` per channel and the
   gateway replays missed messages from a bounded per-channel backlog (catch-up).
5. A **load client** (`cmd/loadclient`) can open N connections, hold them idle,
   drive a configurable publish rate, and simulate **slow consumers** (a fraction
   of clients that read their socket slowly or not at all) and **reconnect storms**
   (drop X% of connections simultaneously and have them reconnect).
6. A **drain hook** (`SIGTERM` or `cmd/drain`) stops accepting new connections,
   tells clients to reconnect-elsewhere, and closes sockets gracefully within a
   deadline.

## 4. Load & data profile

- **Connections:** ≥ **100k concurrent** WebSocket connections held on one node
  for the steady-state memory test; ramp to find the node's ceiling.
- **Devices per user:** 1–3 (so `user_id` → {conn} is a *set*, fan-out is per
  user not per conn).
- **Message rate:** sustained **tens of thousands of messages/s** cluster-wide;
  channel fan-out is skewed — a few "big rooms" with 10k+ subscribers, a long tail
  of DMs with 2.
- **Channel/subscriber distribution:** Zipfian room sizes (s≈1.2) so some channels
  are *hot* — fan-out cost is dominated by the big rooms.
- **Churn:** a baseline connect/disconnect rate, plus an injectable **reconnect
  storm** that drops and re-establishes ≥ 50k connections within seconds.
- **Slow consumers:** a tunable fraction (e.g. 1–5%) of clients that drain their
  receive buffer at a fraction of the publish rate, or stall entirely.
- **Generator:** `cmd/loadclient` is deterministic given a seed (which users join
  which channels, which clients go slow).

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Concurrent connections per node | **≥ 100k** held stable; report the ceiling and what bounds it (memory? FDs? GC? accept rate?) |
| Memory per idle connection | Measure & report (goroutine-per-conn baseline ~tens of KB; show the number, then show the epoll alternative) |
| File descriptors | 100k+ FDs open without `EMFILE`; `ulimit`/`somaxconn`/`netdev_max_backlog` tuned and documented |
| Cross-node fan-out p99 (publish on node A → delivered on node B) | **< 150 ms** at target message rate |
| Same-node delivery p99 | **< 20 ms** |
| Slow-consumer isolation | A stalled client's buffer fills and it is dropped/disconnected per policy; **p99 of healthy clients unchanged** (prove it) |
| Presence accuracy | Online/offline converges within **2× heartbeat interval** under churn; no stuck-online ghosts |
| Reconnect-storm recovery | After dropping ≥ 50k conns, node re-accepts to steady state within a stated bound without OOM or accept-queue overflow |
| Message loss on node failure | Quantified; with catch-up, a reconnecting client recovers missed messages within the backlog window |
| Graceful drain | Node closes all sockets within deadline; clients reconnect to peers; zero abrupt `RST` to healthy clients |

> The point is not a magic number — it's to **find** your node's connection
> ceiling, **name** what bounds it, and **prove** slow clients are isolated.

## 6. Architecture constraints & guidance

- **N gateway nodes**, each stateless except for its local connection table, behind
  an L4 load balancer. A user's devices may land on **different nodes** — this is
  the whole reason fan-out exists.
- **Cross-node bus:** Redis pub/sub via `go-redis` (simplest) **or** NATS. Each
  node subscribes to the channels its local clients care about (or a sharded set of
  bus topics); a publish goes to the bus and every node delivers to its locals.
  Discuss the trade-off: per-channel bus subscriptions (precise, many subs) vs a
  fixed set of sharded topics (fewer subs, some over-delivery).
- **Connection model:** start with **goroutine-per-connection** (`gorilla/websocket`
  or `coder/websocket`), typically *two* goroutines per conn (reader + writer).
  Measure its memory at 100k. Then evaluate an **epoll-based** model (`gnet` or a
  hand-rolled `epoll`/`kqueue` loop) that drops the per-conn goroutines, and
  compare. Know *why* the goroutine model costs what it does (stacks + runtime
  bookkeeping) and what you trade away (code complexity, per-conn blocking I/O).
- **Backpressure is mandatory:** every connection has a **bounded** outbound
  channel/buffer. When it's full you must choose — block (never, it spreads
  backpressure to the publisher), **drop oldest**, **drop newest**, or
  **disconnect the slow client**. State and implement your policy.
- Instrument with Prometheus: connection count, accept rate, per-conn send-buffer
  depth, dropped-message count, fan-out p50/p99/p999 (same-node and cross-node),
  presence transitions, goroutine count, heap.

## 7. Data model

```text
# In-memory, per gateway node
conns:    map[user_id] -> set[*Conn]           # multi-device
subs:     map[channel] -> set[*Conn]           # local subscribers only
Conn:     { id, user_id, send chan Frame (BOUNDED, cap=N), lastPong time, ... }

# Per-channel ordering + catch-up (bounded backlog)
channel seq: monotonic uint64 per channel (assigned at publish)
backlog:   ring buffer of last K messages per channel (for reconnect replay)

# Redis (presence + bus + backlog)
presence:
  key  presence:{user_id}            -> "online"|"away"   (SET with TTL = heartbeat*2)
  set  channel:{channel}:members     -> user_ids (for presence queries)   [optional]
bus (pub/sub):
  channel  bus:{shard}               -> serialized {channel, seq, payload, sender}
catch-up backlog (durable-ish, bounded):
  stream/list  backlog:{channel}     -> last K entries, trimmed (XADD + MAXLEN, or LPUSH+LTRIM)
```

- **Presence via TTL heartbeat:** each connection refreshes `presence:{user_id}`
  with `SET ... EX <2×heartbeat>` on every heartbeat. If all of a user's conns
  die, the key expires and the user goes offline — no explicit "I left" message
  required, which is what makes it correct under hard disconnects.
- **Ordering:** `seq` is assigned **per channel** at publish so each channel is a
  totally ordered stream; clients dedup and reorder by `seq`. There is no global
  order (and you don't need one).
- **Catch-up:** Redis Stream (`XADD`/`XRANGE` with `MAXLEN`) or a `LPUSH`/`LTRIM`
  list holds the last K messages per channel; on reconnect the client asks for
  `seq > last_seen` and the node replays from the backlog.

## 8. WebSocket protocol / API

Handshake: `GET /ws?token=<jwt>` → `101 Switching Protocols`. Reject with `401`
before upgrade if the token is invalid (don't upgrade then close).

Client → server frames (JSON text):
```jsonc
{ "op": "sub",   "channel": "room:42" }
{ "op": "unsub", "channel": "room:42" }
{ "op": "pub",   "channel": "room:42", "body": "hi", "client_msg_id": "..." }   // client_msg_id for dedup
{ "op": "sync",  "channel": "room:42", "from_seq": 1057 }                       // catch-up request
{ "op": "ping" }                                                               // app-level heartbeat
```
Server → client frames:
```jsonc
{ "op": "msg",      "channel": "room:42", "seq": 1058, "body": "hi", "sender": "u_9" }
{ "op": "presence", "user": "u_9", "state": "online" }
{ "op": "ack",      "client_msg_id": "...", "seq": 1058 }
{ "op": "pong" }
{ "op": "drain",    "reconnect_after_ms": 0 }    // node draining: reconnect elsewhere
{ "op": "dropped",  "reason": "slow_consumer" }  // your backpressure policy fired
```

- Use protocol-level WebSocket **ping/pong** for dead-connection detection
  (configurable interval, e.g. 30 s ping, 45 s read deadline → if no pong, kill).
- HTTP side: `GET /metrics` (Prometheus), `GET /healthz`, `GET /presence/{user}`.

## 9. Key technical challenges

- **The memory wall at 100k.** Goroutine-per-conn means ~2 goroutines × 100k =
  200k goroutines plus per-conn read/write buffers. Stacks and buffers dominate.
  You must measure it and decide whether to shrink buffers, pool them, or move to
  an epoll model.
- **Slow consumers are the silent killer.** A naive `conn.WriteJSON` blocks the
  fan-out path; one stalled client backs up everyone sharing that goroutine or
  channel. The bounded send buffer + drop/disconnect policy is the fix — and you
  must *prove* healthy clients are unaffected.
- **Fan-out across nodes.** A user's three devices may be on three nodes. Every
  publish must reach the bus and be re-fanned locally on each node. The cost is a
  serialize + Redis round-trip per message; hot rooms multiply it. Decide between
  per-channel bus subs and sharded bus topics, and measure.
- **Presence under churn.** Flapping connections (train wifi) must not produce
  online/offline thrash. TTL heartbeats + an `away` grace window absorb it; getting
  the TTL vs heartbeat ratio wrong yields ghosts (stuck online) or flicker.
- **Reconnect storms.** A deploy or LB blip drops 50k conns; they all reconnect at
  once. TLS handshakes + auth + re-subscribe is expensive. You need accept-queue
  headroom (`somaxconn`), client backoff+jitter, and possibly admission control.
- **Ordering vs at-least-once.** The bus can redeliver; clients can double-receive
  on reconnect. Per-channel `seq` + client dedup by `seq`/`client_msg_id` gives
  ordered, effectively-once *delivery to the UI* on top of at-least-once transport.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Idle-connection cost:** open 10k → 50k → 100k idle connections; plot RSS,
   goroutine count, and FD count vs connections. Report **bytes/connection** and
   name what dominates (goroutine stacks? read/write buffers? TLS?).
2. **Goroutine-per-conn vs epoll:** hold 100k idle conns under `gorilla`/`coder`
   (goroutine-per-conn) vs `gnet` (epoll). Compare memory/conn and CPU at a fixed
   low message rate. State what you gave up.
3. **Cross-node fan-out latency:** two+ nodes, publish on A, measure delivery p50/
   p99/p999 on B via Redis pub/sub as message rate climbs to target. Find where
   the bus (or serialization) becomes the bottleneck.
4. **Slow-consumer blast radius:** make 1% then 5% of clients stall. **Before** the
   fix (unbounded/blocking write): show healthy-client p99 degrading. **After**
   (bounded buffer + drop/disconnect): show healthy-client p99 flat and the slow
   clients getting `dropped`. This is the headline result.
5. **Reconnect storm:** drop 50k connections at once; measure time-to-steady-state,
   peak accept-queue depth, peak memory, and whether any `EMFILE`/accept overflow
   occurred. Then add client backoff+jitter and re-measure.
6. **Presence accuracy under churn:** drive a flapping-connection workload; verify
   no stuck-online ghosts and that offline is detected within 2× heartbeat. Sweep
   the heartbeat/TTL ratio and show the flicker-vs-ghost trade-off.
7. **Message-loss + catch-up on node failure:** during steady publish, kill a node
   holding subscribers; have clients reconnect to a peer and `sync` from
   `last_seen` seq. Quantify messages lost vs recovered-from-backlog, and the gap
   the backlog window leaves.
8. **Graceful drain:** `SIGTERM` a node at 100k conns; measure drain time, that
   clients reconnected to peers, and that no healthy client saw an abrupt `RST`.

## 11. Milestones

1. Single-node gateway: upgrade, auth handshake, sub/pub, local fan-out;
   Prometheus + a Grafana board for conns/goroutines/heap/fan-out latency.
2. `cmd/loadclient`; first **idle-100k** memory run; write down bytes/conn and the
   bottleneck (experiment 1).
3. Bounded send buffer + slow-consumer policy; prove isolation (experiment 4).
4. Cross-node fan-out via Redis pub/sub; presence with TTL heartbeats; fan-out
   latency + presence-accuracy runs (experiments 3, 6).
5. Reconnect/backoff, catch-up backlog, graceful drain; storm + node-failure +
   drain runs (experiments 5, 7, 8). Optional epoll comparison (experiment 2).

## 12. Acceptance criteria (definition of done)

- [ ] **100k concurrent connections** held stable on one node for ≥ 15 min;
      dashboard screenshot (conns, goroutines, heap, FDs) attached.
- [ ] **Bytes/connection** reported with the dominant cost named and shown
      (pprof heap/goroutine profile evidence).
- [ ] Slow-consumer isolation **proven**: healthy-client p99 flat while stalled
      clients are dropped per policy (before/after plot).
- [ ] Cross-node fan-out p99 **< 150 ms** at target rate, with the bus cost shown.
- [ ] Presence converges within **2× heartbeat** under churn; zero ghosts in the
      run; heartbeat/TTL ratio justified.
- [ ] Reconnect storm of ≥ 50k conns recovers to steady state without OOM or
      accept overflow; backoff+jitter effect shown.
- [ ] Node-failure run: reconnecting clients recover missed messages from backlog;
      loss outside the window quantified.
- [ ] Graceful drain closes all sockets within deadline with no `RST` to healthy
      clients.
- [ ] Every number reproducible from a committed command + config (incl. the OS
      tuning: `ulimit -n`, `somaxconn`, etc.).

## 13. Stretch goals

- **Epoll path to completion:** finish the `gnet` (or hand-rolled `epoll`) gateway
  and hold **1M connections** across a few nodes; report the new bytes/conn.
- **Sharded bus topics** with consistent hashing to cut Redis subscription count
  on hot rooms; measure over-delivery vs subscription overhead.
- **Compression** (`permessage-deflate`) and its CPU vs bandwidth trade-off at
  100k conns.
- **Read-receipts / typing** as presence-style ephemeral, TTL'd, never-persisted
  signals — and show they don't touch the durable path.
- **Admission control** on reconnect storms (token-bucket on `accept`) to protect
  the node, with a measured fairness/latency trade-off.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Connection scale | Holds 100k; reports memory/conn | Names the bound, shows the epoll alternative and *why* it's cheaper |
| Concurrency model | Goroutine-per-conn works | Justifies goroutine-per-conn vs epoll with measured numbers and a clear trade-off statement |
| Backpressure | Has a bounded buffer | Proves slow-client isolation with a before/after p99 plot; defends the drop-vs-disconnect policy |
| Fan-out | Cross-node delivery works | Quantifies bus cost; argues per-channel-sub vs sharded-topic with data |
| Presence | Online/offline mostly right | Correct under churn (no ghosts/flicker); TTL/heartbeat ratio justified |
| Delivery semantics | At-least-once delivers | Ordered per channel + dedup; catch-up recovers within a stated window; explains *why* it's correct |
| Resilience | Survives a kill | Storm recovery + graceful drain measured; OS limits tuned and documented |
| Communication | Clear findings note | Could defend every curve and the connection ceiling to a staff panel |

## 15. References

- WebSocket: RFC 6455; `gorilla/websocket` and `coder/websocket` (formerly
  `nhooyr.io/websocket`) docs — read deadlines, ping/pong, write timeouts.
- Epoll at scale: `gnet` docs; "A Million WebSockets and Go" (Sergey Kamardin) on
  dropping the per-conn goroutines.
- `go-redis` pub/sub and Redis Streams (`XADD`/`XRANGE`/`MAXLEN`) for the bus and
  catch-up backlog; NATS as an alternative bus.
- Backpressure: Go's bounded-channel idiom; the slow-consumer / drop-policy
  discussion in any production WebSocket gateway write-up (Slack, Phoenix Channels).
- OS tuning: `ulimit -n`, `/proc/sys/net/core/somaxconn`, `netdev_max_backlog`,
  ephemeral port range.
- See also: `Interview Question/09-networking-fundamentals/` (TCP, epoll, WebSocket
  framing, keep-alive) and `Interview Question/02-concurrency/` (goroutines,
  channels, bounded buffers, backpressure).
