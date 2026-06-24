# Scalability & High Availability

> Senior Go backend interview questions on scaling stateless microservices horizontally, load balancing, auto-scaling, database scaling, caching, capacity planning, high-availability architecture, and resilience patterns under production load.

**51 questions** across **16 topics** · Level: senior

## Topics

- [Scaling Fundamentals](#scaling-fundamentals) (3)
- [Stateless Services](#stateless-services) (2)
- [Load Balancing](#load-balancing) (4)
- [Auto-scaling](#auto-scaling) (4)
- [Database Scaling](#database-scaling) (5)
- [Caching & CDN](#caching-cdn) (2)
- [Consistent Hashing](#consistent-hashing) (2)
- [Capacity Planning](#capacity-planning) (2)
- [High Availability](#high-availability) (5)
- [Availability Math](#availability-math) (3)
- [Resilience Patterns](#resilience-patterns) (4)
- [Geo-distribution](#geo-distribution) (2)
- [Common Scaling Pitfalls](#common-scaling-pitfalls) (3)
- [Cell-Based Architecture & Blast Radius](#cell-based-architecture-blast-radius) (4)
- [Shuffle Sharding & Tenant Isolation](#shuffle-sharding-tenant-isolation) (3)
- [Load Shedding & Brownout](#load-shedding-brownout) (3)

---

## Scaling Fundamentals

#### 1. Vertical vs horizontal scaling: define each and explain when you'd reach for one over the other for a Go API service.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `scaling`, `fundamentals`, `vertical`, `horizontal`

**Vertical (scale-up)** means giving one machine more CPU/RAM/IO; **horizontal (scale-out)** means adding more machines behind a load balancer. Vertical is the simplest lever: no code changes, no distributed-state problems, and it cuts cross-node latency. Its failure mode is a hard ceiling (the biggest instance you can buy), super-linear cost at the top end, and a single point of failure. Horizontal scales close to linearly and gives redundancy, but it *requires* the service to be stateless (or to externalize state) and pushes complexity into load balancing, service discovery, and data consistency. For a Go API, prefer **horizontal** as the default because Go's lightweight goroutines and small memory footprint make instances cheap and fast to start, and you get HA for free. Use vertical first when the bottleneck is a single non-shardable resource (e.g., one big in-memory cache or a database primary).

**Key points**
- Vertical = bigger box, no distribution complexity, hard ceiling + SPOF
- Horizontal = more boxes, near-linear, needs statelessness + LB
- Go's cheap goroutines/footprint favor scale-out as the default
- Vertical still wins for single non-shardable resources (DB primary, big cache)

**Follow-ups**
- What's the cost curve difference at the high end of vertical scaling?
- Why can't you horizontally scale a database primary the same way as a stateless API?

---

#### 2. Why doesn't horizontal scaling give you perfectly linear capacity? Where does the curve bend?

*Difficulty:* 🟡 medium  ·  *Tags:* `scaling`, `amdahl`, `usl`, `bottleneck`

Adding nodes rarely yields N× throughput because of **shared bottlenecks** that don't scale with the stateless tier. The first wall is usually the **database**: more API replicas means more connections, more contention on hot rows, and more replication lag, none of which adding API pods fixes. Second is **coordination/contention** — Amdahl's and the Universal Scalability Law say any serialized fraction (locks, a shared cache, a single queue) caps speedup, and the USL's *crosstalk* term means throughput can actually *decline* past a point as nodes spend time coordinating. Third is **shared infra**: load balancer, NAT gateway, service mesh sidecars, DNS, and connection limits. Practically, you watch the throughput-vs-nodes curve for the 'knee': the point where adding a node yields diminishing or negative returns. The fix is to scale the bottleneck tier (shard the DB, add cache, partition the queue), not the tier that's already idle.

**Key points**
- Database connections/contention/replication lag is the usual first wall
- Universal Scalability Law: serialization caps gains, crosstalk can reverse them
- Shared infra (LB, NAT, mesh, DNS) becomes the limiter
- Fix the actual bottleneck tier, not the idle one

**Follow-ups**
- How would you empirically find the knee of your scaling curve?
- What does the crosstalk term of the USL look like in practice?

---

#### 3. Give a concrete cost/limit comparison: when is scaling up genuinely cheaper than scaling out?

*Difficulty:* 🟡 medium  ·  *Tags:* `scaling`, `cost`, `tradeoffs`

Scale-up is cheaper when the workload has **strong locality or shared state** that scale-out would force you to replicate or coordinate. Example: an in-memory analytics cache of 200 GB. One r6i.8xlarge (256 GB) holds it on one box with zero network hops; splitting it across eight 32 GB boxes adds a distributed-cache layer, cross-node fetches, and a consistency story — operationally far more expensive than the marginal instance cost. Up to mid-range instances, price scales roughly linearly with vCPU/RAM, so vertical isn't penalized. The penalty kicks in at the **top of the line**: the largest instances carry a premium (often 1.3-2× per-core), and you still have a SPOF and a ceiling. Rule of thumb: scale up while it's linear and the state is hard to distribute; switch to scale-out before you hit the premium tier or need redundancy. Many real systems do both — scale up each node to a sweet spot, then scale out.

**Key points**
- Scale-up wins when state has locality and is costly to distribute (big in-memory cache)
- Pricing is ~linear in the mid-range; premium hits at the top of the line
- Vertical keeps a SPOF and a hard ceiling regardless of cost
- Real systems combine: right-size the node, then scale out

**Follow-ups**
- How do reserved/spot pricing change this calculus?
- When does the per-core premium of large instances make scale-out mandatory?

---

## Stateless Services

#### 4. Why is statelessness the precondition for cheap horizontal scaling, and where does the state actually go?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `stateless`, `session`, `horizontal-scaling`

A **stateless** service keeps no client-specific data in process memory between requests, so any replica can serve any request. That's what makes scale-out trivial: you can add/remove instances, route round-robin, and lose a node without losing data or breaking sessions. The state doesn't disappear — it's **externalized** to systems built to be shared and durable: the **database** for persistent entities, a **distributed cache** (Redis/Memcached) for sessions and hot reads, **object storage** (S3) for blobs/uploads, and **message queues** for in-flight work. The trade-off is that every request now pays a network hop to fetch state, so you lean on caching and connection pooling to keep latency down. The failure mode of getting this wrong is hidden in-memory state — an in-process cache, a local rate-limiter counter, a WebSocket session map — which silently breaks correctness the moment you add a second replica.

**Key points**
- Stateless = any replica serves any request → add/remove/lose nodes freely
- State moves to DB (entities), cache (sessions/hot data), object store (blobs), queue (work)
- Cost is a network hop per request → mitigate with caching + pooling
- Hidden in-process state (local counters, session maps) breaks at replica #2

**Follow-ups**
- How do you handle WebSocket connections, which are inherently stateful, at scale?
- What in-memory state is actually fine to keep (e.g., read-only config)?

---

#### 5. Sticky sessions vs externalized session state: what are the trade-offs, and which do you choose for a Go service?

*Difficulty:* 🟡 medium  ·  *Tags:* `stateless`, `sticky-sessions`, `session-affinity`, `redis`

**Sticky sessions** (session affinity) pin a client to one replica via a cookie or IP hash so its in-memory session stays local. It's simple and keeps session reads in-process, but it undermines the whole point of statelessness: load gets uneven (a 'hot' replica with long-lived users), scale-in or a crash drops every session on that node, and rolling deploys evict users. **Externalized state** stores the session in Redis/DB and gives every replica a token (e.g., a signed cookie or session ID) to fetch it. Now any replica serves any request, scale-in/crash is harmless, and load is even — at the cost of a cache lookup per request and a dependency on the store's availability. For a Go microservice, prefer externalized: keep the cookie a signed JWT or an opaque ID, store session data in Redis with a TTL, and treat the service as fully stateless. Reserve stickiness for protocols that are intrinsically connection-bound (WebSockets, SSE), and even then back it with externalized state for recovery.

**Key points**
- Sticky = simple but uneven load, lost sessions on crash/scale-in/deploy
- Externalized = even load, crash-safe, any replica serves any request
- Cost of externalized: per-request cache lookup + dependency on the store
- Default to externalized (signed cookie/Redis); reserve stickiness for WS/SSE


```go
// Externalized session: replica is stateless, session lives in Redis
func SessionMiddleware(rdb *redis.Client) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            c, err := r.Cookie("sid")
            if err != nil { http.Error(w, "no session", 401); return }
            data, err := rdb.Get(r.Context(), "sess:"+c.Value).Bytes()
            if err != nil { http.Error(w, "expired", 401); return }
            ctx := context.WithValue(r.Context(), sessKey, data)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

**Follow-ups**
- How does a rolling deploy behave under sticky vs externalized sessions?
- Where do signed JWTs let you avoid the per-request store lookup entirely?

---

## Load Balancing

#### 6. L4 vs L7 load balancing: what's the difference, and what does each let you do?

*Difficulty:* 🟡 medium  ·  *Tags:* `load-balancing`, `l4`, `l7`, `grpc`

**L4** balances at the transport layer (TCP/UDP): it forwards packets/connections based on IP and port without inspecting payload. It's fast, cheap, protocol-agnostic, and great for raw throughput, but it can't route on HTTP attributes or do per-request balancing — once a TCP connection is pinned to a backend, all its requests go there (a problem for HTTP/2 multiplexing). **L7** terminates the connection and inspects the application protocol (HTTP headers, path, host, cookies), so it can do path/host routing, TLS termination, header-based canaries, per-request balancing across HTTP/2 streams, sticky cookies, retries, and circuit breaking. The cost is more CPU (it parses every request) and it becomes a more involved component. For Go microservices behind something like Envoy or an ALB, L7 is the usual choice because gRPC/HTTP-2 connection reuse means an L4 LB would hot-spot a few long-lived connections onto a few backends; L7 balances each *request* and spreads load evenly.

**Key points**
- L4 = transport-layer, IP/port, fast, protocol-agnostic, pins whole connections
- L7 = app-layer, routes on path/host/header/cookie, per-request balancing, TLS term
- HTTP/2 + L4 = hot-spotting; L7 balances each request/stream evenly
- L7 costs CPU and adds a richer component (retries, canaries, circuit breaking)

**Follow-ups**
- Why specifically does gRPC behind an L4 LB cause load imbalance?
- When would you still pick L4 (e.g., latency-critical or non-HTTP traffic)?

---

#### 7. Walk through the common load-balancing algorithms and when each is the right choice.

*Difficulty:* 🟡 medium  ·  *Tags:* `load-balancing`, `algorithms`, `consistent-hashing`, `least-connections`

**Round-robin**: cycle through backends in order — simple, good when requests are uniform and backends are identical, but ignores actual load. **Weighted round-robin**: skew shares by capacity — use when backends are heterogeneous (mixed instance sizes). **Least-connections**: send to the backend with fewest active connections — better when request durations vary widely (some slow, some fast), since it adapts to real load; the L7 variant *least-request* or EWMA-based *peak-EWMA* (Envoy/Finagle) is even smarter. **IP hash**: hash the client IP to a backend — gives a cheap form of stickiness without cookies, but rebalances badly when the backend set changes and skews if clients are behind a few NATs. **Consistent hashing**: hash a key (user ID, cache key) to a point on a ring — used when you need a request to keep hitting the same backend (cache locality, sharded state) while minimizing reshuffling on membership change. Default to least-request/round-robin for stateless APIs; reach for consistent hashing when locality matters.

**Key points**
- Round-robin: uniform requests, identical backends
- Weighted: heterogeneous capacity
- Least-connections / peak-EWMA: variable request durations, adapts to load
- IP hash: cheap stickiness, but NAT skew + rebalance pain
- Consistent hashing: locality/sharding with minimal reshuffle on change

**Follow-ups**
- Why is least-connections risky if a backend is failing fast (returning errors instantly)?
- How does peak-EWMA improve on plain least-connections?

---

#### 8. How do load balancer health checks work, and what's the difference between liveness, readiness, and a deep health check?

*Difficulty:* 🟡 medium  ·  *Tags:* `load-balancing`, `health-checks`, `readiness`, `graceful-shutdown`

An LB periodically probes each backend and removes failing ones from rotation. **Liveness** answers 'is the process alive?' — if it fails, the orchestrator restarts the pod; it must NOT check dependencies, or a DB blip restart-loops your whole fleet. **Readiness** answers 'should I get traffic right now?' — it's what the LB/k8s uses to add or pull a replica from the pool; it can fail temporarily (warming up, draining, dependency degraded) without a restart. A **deep/dependency health check** verifies downstreams (DB, cache) are reachable. The senior trap: making readiness a deep check that fails when a *shared* dependency hiccups — every replica reports unhealthy simultaneously and the LB pulls the *entire* fleet, turning a minor DB blip into a full outage. Best practice: keep readiness shallow (can I serve a request at all?), surface dependency health via separate signals/metrics, and use **graceful shutdown** — fail readiness first, drain in-flight requests, then exit, so the LB stops sending traffic before you die.

**Key points**
- Liveness → restart; must not check dependencies (avoid restart loops)
- Readiness → add/remove from LB pool; can fail temporarily without restart
- Deep checks verify downstreams but risk fleet-wide pull on shared-dep blips
- Graceful shutdown: fail readiness, drain, then exit


```go
// Readiness should be shallow; liveness must not touch dependencies.
func readyz(ready *atomic.Bool) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if !ready.Load() { http.Error(w, "draining", 503); return }
        w.WriteHeader(200)
    }
}

// On SIGTERM: flip readiness off, let LB drain, then shut down.
func onShutdown(ready *atomic.Bool, srv *http.Server) {
    ready.Store(false)
    time.Sleep(5 * time.Second) // let LB notice + drain
    ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancel()
    _ = srv.Shutdown(ctx)
}
```

**Follow-ups**
- Why must the shutdown grace period exceed the LB's health-check interval × threshold?
- How do you avoid a correlated failure where every replica fails readiness at once?

---

#### 9. Explain global vs local load balancing and where anycast fits in.

*Difficulty:* 🟠 hard  ·  *Tags:* `load-balancing`, `anycast`, `gslb`, `geo-routing`

**Local (regional) LB** distributes traffic across replicas within one region/AZ — this is your ALB/Envoy doing per-request balancing. **Global LB (GSLB)** decides which *region* a user hits, typically via DNS-based geo/latency routing or anycast, then hands off to a local LB inside that region. The two layers solve different problems: global picks the nearest healthy region (latency + failover); local spreads load and does health checks among instances. **Anycast** advertises the same IP from many locations via BGP; the network routes each client to the topologically nearest PoP, giving low latency and automatic DDoS/failover absorption (if a PoP dies, BGP reroutes). The trade-off with anycast is that it's connection-stable only as long as routing is stable — a BGP reconvergence can move a client mid-session, which is fine for UDP/QUIC and stateless HTTP but bad for long-lived TCP. DNS-based GSLB is simpler but suffers from caching/TTL lag, so failover isn't instant. Real edges (Cloudflare, AWS Global Accelerator) combine anycast at the edge with health-aware routing to regional LBs.

**Key points**
- Local LB = spread load across instances in a region; global LB = pick the region
- Anycast = same IP from many PoPs via BGP → nearest PoP, auto-failover
- Anycast can move clients on BGP reconvergence (bad for long-lived TCP)
- DNS GSLB is simpler but TTL/caching delays failover

**Follow-ups**
- Why is DNS-based failover often slow in practice despite low TTLs?
- How does QUIC's connection migration make anycast reconvergence less painful?

---

## Auto-scaling

#### 10. Reactive vs predictive/scheduled auto-scaling: define them and when you'd use each.

*Difficulty:* 🟡 medium  ·  *Tags:* `auto-scaling`, `target-tracking`, `predictive`, `scheduled`

**Reactive** scaling responds to current metrics: **target-tracking** keeps a metric at a setpoint (e.g., CPU at 60%) by adding/removing capacity, and **step scaling** adds capacity in tiers as a metric crosses thresholds. It's simple and needs no forecast, but it's always *behind* the load — there's a lag between the spike, the metric crossing, the scale-out decision, and new instances becoming ready, during which you're under-provisioned. **Scheduled** scaling pre-provisions capacity on a known calendar (business hours, a 9am traffic ramp, a Black-Friday window). **Predictive** scaling uses historical patterns/ML to forecast load and scale *ahead* of it. Use reactive as the always-on safety net; layer scheduled scaling for known recurring spikes (so you're not caught flat-footed during the warm-up lag); add predictive when traffic is patterned but the exact timing varies. The senior point: reactive alone fails for *fast* spikes because instance warm-up (pull image, JIT/connection warm-up, LB registration) can be minutes, far slower than the spike.

**Key points**
- Target-tracking (hold a setpoint) and step (tiered thresholds) are reactive
- Reactive lags the load; under-provisioned during the detect→provision→ready window
- Scheduled pre-provisions for known calendar spikes
- Predictive forecasts and scales ahead; combine all three

**Follow-ups**
- How big is the typical end-to-end reactive scaling lag, and what dominates it?
- How do you set scale-in cooldowns to avoid flapping?

---

#### 11. Which metric should you auto-scale a Go HTTP API on — CPU, RPS, queue depth, or p99 latency? Defend your answer.

*Difficulty:* 🟠 hard  ·  *Tags:* `auto-scaling`, `metrics`, `latency`, `go`

The right metric is the one that's the actual **bottleneck and a leading indicator** of pain. **CPU** is the default for CPU-bound Go APIs and works well when work-per-request is uniform — but it lies for IO-bound services (you're latency-bound at low CPU) and for goroutine-heavy code where you're blocked on the DB. **RPS per replica** is a good proxy if each request costs roughly the same and you've load-tested the per-replica ceiling; it scales *ahead* of CPU saturation. **Queue depth / in-flight requests** is excellent for worker/async services — it directly measures backlog, the thing you actually care about. **p99 latency** is the truest user-facing signal but a *lagging, noisy* one: by the time p99 climbs you're already hurting, and it's polluted by GC pauses and downstream slowness you can't fix by adding replicas. Best practice: scale a synchronous Go API on **RPS or concurrency per replica** (validated against a load test), use CPU as a guardrail, and reserve queue depth for async workers. Never scale solely on p99 — it reacts too late and can cause feedback loops.

**Key points**
- CPU: good for CPU-bound uniform work; misleads for IO-bound services
- RPS/concurrency per replica: scales ahead, needs a load-tested ceiling
- Queue depth: best for async/worker services (direct backlog signal)
- p99 latency: truest but lagging/noisy (GC, downstreams) → don't scale solely on it

**Follow-ups**
- Why can scaling on p99 latency create an oscillation/feedback loop?
- How would you determine the per-replica RPS ceiling to use as a target?

---

#### 12. What is the thundering-herd problem on scale-out, and how does cold-start / warm-up make it worse?

*Difficulty:* 🟠 hard  ·  *Tags:* `auto-scaling`, `thundering-herd`, `cold-start`, `singleflight`

On a scale-out event, a burst of *new* replicas comes online and simultaneously does the same expensive startup work — opening DB connection pools, warming caches, refreshing config, re-resolving DNS, JIT/connection handshakes — all hitting shared downstreams at once. That synchronized surge (a **thundering herd**) can knock over the very database or cache you scaled out to protect: e.g., 50 new pods each opening a 20-connection pool = 1000 new DB connections in seconds, exhausting the primary's connection limit. **Cold start / warm-up** compounds it: a fresh Go binary is fast to start, but its connection pools are empty and any in-process cache is cold, so its first requests are slow and fan out heavily to downstreams — exactly when you most need it ready. Mitigations: stagger/ramp scale-out (max-surge limits), pre-warm pools lazily with jittered ramp-up, put a connection proxy (PgBouncer) in front of the DB to decouple replica count from DB connections, add request-coalescing/singleflight for cold-cache fill, and use readiness gates so the LB doesn't route until warm.

**Key points**
- New replicas do synchronized expensive startup → herd hits shared downstreams
- 50 pods × 20-conn pools = 1000 sudden DB connections → exhaustion
- Cold pools/caches make new replicas slow + downstream-heavy at the worst time
- Mitigate: staggered ramp, jitter, PgBouncer, singleflight cache fill, readiness gates


```go
// singleflight collapses a cold-cache stampede into one downstream call.
var g singleflight.Group

func getUser(ctx context.Context, id string) (*User, error) {
    v, err, _ := g.Do("user:"+id, func() (any, error) {
        return loadUserFromDB(ctx, id) // only one in-flight per key
    })
    if err != nil { return nil, err }
    return v.(*User), nil
}
```

**Follow-ups**
- How does PgBouncer in transaction-pooling mode decouple replica count from DB connections?
- Why is jitter essential when many replicas refresh config/cache on the same TTL?

---

#### 13. What is scale-to-zero, what does it buy you, and what are its failure modes?

*Difficulty:* 🟡 medium  ·  *Tags:* `auto-scaling`, `scale-to-zero`, `serverless`, `cold-start`

**Scale-to-zero** runs zero replicas when there's no traffic and spins one up on the first request (serverless / Knative / KEDA). It saves cost for spiky, low-baseline, or bursty workloads (internal tools, webhooks, batch triggers). The dominant failure mode is **cold-start latency**: the first request after idle pays for image pull, process start, pool/cache warm-up, and LB registration — easily hundreds of ms to seconds, unacceptable for user-facing latency-sensitive paths. It also amplifies thundering-herd (a burst from zero starts many cold instances at once) and complicates anything that assumes a warm in-process state or long-lived connections. It's a poor fit for: latency-critical APIs, services holding persistent connections (DB pools you want kept warm, WebSocket hubs), or anything with heavy init. Good fit: async/event-driven workers, rarely-used endpoints, and dev/preview environments. Mitigations: keep a small warm floor (min replicas = 1) for latency-critical paths, and use provisioned concurrency where the platform offers it.

**Key points**
- Zero replicas when idle, spin up on first request → cost savings for spiky/low-baseline
- Cold-start latency (image pull, start, warm-up) is the main downside
- Bad for latency-critical APIs and persistent-connection services
- Mitigate with a warm floor (min=1) or provisioned concurrency

**Follow-ups**
- How does Go's fast startup help here vs a JVM service?
- When is a warm floor of 1 replica strictly better than true scale-to-zero?

---

## Database Scaling

#### 14. Why is the database the hardest tier to scale, and what's the usual order of techniques you apply?

*Difficulty:* 🟡 medium  ·  *Tags:* `database`, `scaling`, `sharding`, `cqrs`

The stateless tier scales by adding identical replicas; the database can't, because it holds **mutable, consistent state** — you can't just clone a primary and write to all copies without a consistency problem. So you climb a ladder of increasingly invasive techniques, cheapest/least-invasive first: (1) **vertical scale** the primary (easy, buys time); (2) **caching** to offload reads (Redis in front of hot queries); (3) **read replicas + read/write splitting** to scale reads (with replication-lag consequences); (4) **connection pooling / PgBouncer** because connection limits are a hard ceiling; (5) **partitioning** (split a big table by range/hash within one DB); (6) **sharding** (split data across independent DBs by a shard key — last resort, hardest, breaks cross-shard queries and transactions); (7) **CQRS / read models** to serve reads from purpose-built stores. The senior insight: every step after caching trades away some combination of consistency, transactional scope, or query flexibility — sharding especially is a one-way door you delay as long as possible.

**Key points**
- DB holds mutable consistent state → can't clone-and-write like stateless replicas
- Ladder: vertical → cache → read replicas → pooling → partition → shard → CQRS
- Each step trades consistency, transaction scope, or query flexibility
- Sharding is the last resort and a near-one-way door

**Follow-ups**
- Why do you exhaust caching and read replicas before sharding?
- What query patterns break the moment you shard?

---

#### 15. Read replicas and replication lag: how does read/write splitting work and what bugs does lag introduce?

*Difficulty:* 🟠 hard  ·  *Tags:* `database`, `read-replicas`, `replication-lag`, `consistency`

**Read/write splitting** sends writes to the primary and reads to one or more **read replicas** that asynchronously copy the primary's changes. It scales reads (most workloads are read-heavy) without touching write capacity. The catch is **replication lag**: replicas trail the primary by milliseconds to seconds (worse under write bursts or long transactions), so a read replica can return *stale* data. This produces the classic **read-your-own-writes** bug: a user updates their profile (write → primary), immediately reads it back (read → lagging replica), and sees the old value. Fixes: route reads that must be fresh to the primary; use 'read-from-primary-after-write' for a short window keyed to the user; or use **causal/session consistency** where the app tracks a write position (LSN/GTID) and only reads from a replica that's caught up past it. Also watch for monotonic-read violations (two reads hit two replicas at different lag). Always monitor lag and shed reads from over-lagged replicas. The trade-off is explicit: you bought read scale by giving up immediate consistency, and your code must account for it.

**Key points**
- Writes → primary, reads → async replicas; scales read-heavy workloads
- Replication lag (ms to seconds) → stale reads
- Read-your-own-writes bug: write to primary, read from lagging replica
- Fixes: read-after-write from primary, session/causal consistency (track LSN/GTID), monitor lag

**Follow-ups**
- How would you implement read-your-own-writes correctness with an LSN watermark?
- Why does a long-running analytics query on the primary worsen replica lag?

---

#### 16. Sharding: how do you pick a shard key, and what goes wrong with a bad one?

*Difficulty:* 🟠 hard  ·  *Tags:* `database`, `sharding`, `shard-key`, `hot-shard`

**Sharding** splits data across independent databases, each owning a slice keyed by a **shard key**. The key determines everything. A good key gives (1) **even distribution** — no shard gets disproportionate data/traffic; (2) **query locality** — most queries hit a single shard (you include the shard key in the WHERE clause); and (3) **low resharding pain**. Bad keys: a monotonic key (timestamp, auto-increment) creates a **hot shard** since all new writes land on the newest shard; a low-cardinality key (country, status) creates imbalance and limited parallelism; choosing customer_id when most queries are cross-customer forces scatter-gather. The failure modes of sharding generally: **cross-shard queries** require fan-out and app-side merge/sort (slow, no single index); **cross-shard transactions** lose ACID — you need sagas or 2PC; **JOINs across shards** are gone; and **resharding** (adding shards) is a data-migration project unless you used consistent hashing or a directory. Pick the key around your dominant access pattern, hash it for distribution, and accept that the wrong key is extremely expensive to change later.

**Key points**
- Shard key drives distribution, query locality, and resharding cost
- Bad keys: monotonic → hot shard; low cardinality → imbalance; wrong axis → scatter-gather
- Cross-shard queries = fan-out + app merge; cross-shard txns lose ACID (sagas/2PC); no JOINs
- Hash the key for distribution; pick around the dominant access pattern

**Follow-ups**
- How does consistent hashing reduce the pain of adding a shard?
- How do you handle a query that legitimately needs all shards (analytics)?

---

#### 17. CQRS: what problem does it solve for scaling, and what's the cost?

*Difficulty:* 🟠 hard  ·  *Tags:* `database`, `cqrs`, `read-model`, `eventual-consistency`

**CQRS** (Command Query Responsibility Segregation) splits the write model from the read model into separate paths, often separate stores. Writes go through a normalized, consistency-focused model; reads are served from one or more **denormalized read models** shaped exactly for specific queries (e.g., a flattened materialized view, an Elasticsearch index for search, a Redis projection for a dashboard). For scaling this is powerful: you scale reads and writes independently, eliminate expensive JOINs/aggregations at query time (pre-computed in the read model), and can have *many* purpose-built read models off one write stream. The cost is **eventual consistency** between write and read sides (the projection lags the write, reintroducing read-your-own-writes issues), plus the operational complexity of building, versioning, and rebuilding projections, and handling the event/sync pipeline (often via the outbox pattern or change-data-capture). Use CQRS when read and write workloads are genuinely asymmetric and query shapes are diverse; avoid it for simple CRUD where it's pure overhead. It pairs naturally with event sourcing but doesn't require it.

**Key points**
- Separate write model from purpose-built denormalized read models
- Scales reads/writes independently; precomputes expensive queries
- Cost: eventual consistency (projection lag), projection build/rebuild complexity
- Worth it for asymmetric, diverse-query workloads; overkill for simple CRUD

**Follow-ups**
- How does the outbox pattern or CDC keep the read model in sync reliably?
- How do you handle rebuilding a read model from scratch without downtime?

---

#### 18. Why are database connections a scaling ceiling, and how does a pooler like PgBouncer help?

*Difficulty:* 🟠 hard  ·  *Tags:* `database`, `connection-pooling`, `pgbouncer`, `ceiling`

A Postgres connection isn't free: each backend is a separate OS process costing several MB of RAM plus per-connection work-mem, and the server has a hard `max_connections` (often a few hundred). Performance actually *degrades* past the sweet spot (~2-3× cores) due to lock and context-switch contention — more connections ≠ more throughput. Now horizontal scaling breaks this: 100 stateless Go replicas × a 25-connection pool each = 2500 connections demanded, far over the limit, and most sit idle while a few do work. **PgBouncer** (a connection pooler) sits between app and DB and multiplexes many *client* connections onto a small set of *server* connections. In **transaction pooling** mode, a server connection is borrowed only for the duration of a transaction, so thousands of idle app connections map to maybe 20-50 real DB connections — decoupling replica count from DB load. The trade-off: transaction pooling forbids session-level features (session-scoped prepared statements, `SET`, advisory locks held across statements, LISTEN/NOTIFY), so the app must be written to not rely on them. This is often the single highest-leverage fix when 'the DB is the bottleneck.'

**Key points**
- Each PG connection = a process + RAM; max_connections is a hard cap
- Throughput peaks near ~2-3× cores; more connections cause contention, not speed
- N replicas × pool size easily exceeds the cap; most connections idle
- PgBouncer transaction pooling multiplexes thousands of clients onto tens of server conns
- Cost: no session-scoped features (some prepared statements, SET, advisory locks, LISTEN/NOTIFY)


```go
// Bound each replica's pool so total stays under the DB limit.
db, _ := sql.Open("pgx", dsn)
db.SetMaxOpenConns(20)         // per replica; size = DBlimit / replicas, w/ headroom
db.SetMaxIdleConns(10)
db.SetConnMaxLifetime(30 * time.Minute) // recycle to balance across replicas
db.SetConnMaxIdleTime(5 * time.Minute)
```

**Follow-ups**
- How do you size per-replica pool given a fixed DB max and an autoscaler?
- What breaks if your Go code uses session-level prepared statements with transaction pooling?

---

## Caching & CDN

#### 19. Cache hit ratio as a scaling lever: how does it change your backend load, and why is the relationship non-linear?

*Difficulty:* 🟡 medium  ·  *Tags:* `caching`, `hit-ratio`, `scaling`, `stampede`

Caching scales reads by serving them from a fast store so they never reach the database. The leverage is in the **miss rate**, and it's non-linear: backend load is proportional to misses, so going from a 90% to a 99% hit ratio doesn't shave 9% off DB load — it cuts misses from 10% to 1%, a **10× reduction** in database read traffic. Conversely, a small *drop* in hit ratio is dangerous: 99%→90% is a 10× *increase* in DB load, which can instantly overload a database that was sized assuming the cache. That's why cache problems cause sudden outages — a cache flush, a cold cache after a deploy, or a TTL stampede can take the hit ratio to zero and slam the unprotected DB with full traffic. So you treat the cache as load-bearing infrastructure: monitor hit ratio as a first-class metric, size the DB with enough headroom to survive a partial cache loss, and protect against stampedes (singleflight, jittered TTLs, request coalescing). High hit ratio is a scaling multiplier — and a fragility you must defend.

**Key points**
- Backend load ∝ miss rate, so hit-ratio gains are non-linear (90→99% = 10× fewer misses)
- A small hit-ratio drop is a multiplicative DB-load spike (99→90% = 10× more)
- Cache flush/cold-start/TTL stampede → hit ratio crashes → DB overload outage
- Treat cache as load-bearing: monitor ratio, size DB headroom, prevent stampedes

**Follow-ups**
- How do you protect the DB during a cold cache after a deploy?
- Why does a synchronized TTL across keys cause a periodic load spike?

---

#### 20. How does a CDN / edge cache help you scale, and what's the difference between caching static vs dynamic content?

*Difficulty:* 🟡 medium  ·  *Tags:* `cdn`, `edge-caching`, `static`, `dynamic`

A **CDN** caches content at PoPs near users, so requests are served from the edge instead of your origin — cutting latency (fewer network hops) and, crucially for scaling, **offloading the origin**: a high edge hit ratio means your backend sees a tiny fraction of total traffic, absorbing spikes and DDoS-like surges at the edge. **Static content** (images, JS/CSS, videos) caches trivially with long TTLs and content-hashed URLs for cache-busting — this is the bulk of the offload. **Dynamic content** is harder: personalized or frequently-changing responses can't use long TTLs, but you can still cache with short TTLs (micro-caching, e.g., 1-5s, which collapses a burst of identical requests into one origin hit), cache by varying on the right keys (Vary headers, cache keys including auth tier), or use **stale-while-revalidate** to serve slightly stale content while refreshing in the background. The failure mode is caching something that shouldn't be — leaking one user's personalized response to another via a bad cache key — so correctness of the cache key and Cache-Control/Vary headers is paramount. Edge compute (Workers/Lambda@Edge) extends this to compute personalization at the edge.

**Key points**
- CDN serves from PoPs near users → lower latency + massive origin offload
- Static: long TTLs + content-hashed URLs; the bulk of the offload
- Dynamic: micro-caching (1-5s collapses bursts), correct Vary/cache keys, stale-while-revalidate
- Failure mode: wrong cache key leaks personalized content between users

**Follow-ups**
- How does micro-caching (a 1-second TTL) still meaningfully reduce origin load?
- What does stale-while-revalidate buy you over a hard TTL expiry?

---

## Consistent Hashing

#### 21. Explain consistent hashing and why it beats modulo hashing when nodes are added or removed.

*Difficulty:* 🟠 hard  ·  *Tags:* `consistent-hashing`, `modulo`, `distributed`, `ring`

With naive **modulo hashing** you map a key to a node via `hash(key) % N`. The fatal flaw: when N changes (a node joins or dies), the modulus changes, so *almost every* key remaps to a different node — for a cache, that's a near-total miss storm and a thundering herd on the backing store; for sharded data, it's a near-total reshuffle. **Consistent hashing** instead maps both nodes and keys onto a fixed ring (hash space, e.g., 0..2^32). A key is owned by the first node clockwise from its position. Now adding or removing a node only reassigns the keys in the arc between that node and its predecessor — on average **K/N keys move**, not all of them. Remove one node out of 100 and only ~1% of keys remap, instead of ~99% with modulo. This is why it's the standard for distributed caches (Memcached clients), DHTs, sharded databases (Cassandra/DynamoDB partitioning), and consistent-hash load balancing: it makes membership changes cheap and incremental, which is exactly what you need in an autoscaling, failure-prone environment.

**Key points**
- Modulo: hash(key) % N — changing N remaps almost all keys (cache miss storm / full reshuffle)
- Consistent hashing: nodes + keys on a ring, key owned by next node clockwise
- Membership change moves only ~K/N keys (e.g., 1% when removing 1 of 100)
- Standard for distributed caches, DHTs, sharded DBs, consistent-hash LB

**Follow-ups**
- Quantify the keys remapped: 100 nodes, remove 1, how many keys move under each scheme?
- What's the load-distribution problem with a plain ring, and how is it fixed?

---

#### 22. What are virtual nodes in consistent hashing, and what problem do they solve?

*Difficulty:* 🟠 hard  ·  *Tags:* `consistent-hashing`, `virtual-nodes`, `load-balancing`, `rebalance`

A plain consistent-hash ring with one point per physical node distributes load **unevenly** — with few nodes, the random arc sizes vary widely, so one node can own 2-3× the keys of another (the variance is roughly 1/√(points)). It also can't easily account for heterogeneous capacity, and when a node dies, *all* its load lands on the single successor (a sudden hot spot). **Virtual nodes** fix this: each physical node is hashed to *many* points on the ring (e.g., 100-200 vnodes per node). Now (1) load is smoothed — owning many small arcs averages out, so each physical node gets close to its fair share; (2) a bigger machine can be assigned more vnodes to take proportionally more load (weighting); and (3) when a node fails, its many vnodes' arcs are scattered around the ring, so its load is **spread across all remaining nodes** rather than dumped on one neighbor, avoiding a hot spot during failure/rebalance. The cost is more metadata (the ring has N×V points) and slightly more lookup overhead, which is negligible. Virtual nodes are why production systems (DynamoDB, Cassandra, Riak, consistent-hash LBs) are usable in practice.

**Key points**
- Plain ring → uneven arcs → load imbalance + can't weight by capacity
- Node death dumps all its load on the single successor (hot spot)
- Vnodes: many ring points per node smooth load and enable capacity weighting
- On failure, a node's load scatters across all peers, not one neighbor

**Follow-ups**
- How many vnodes per node do real systems use and why?
- How do bounded-load variants (consistent hashing with bounded loads) further cap hot spots?

---

## Capacity Planning

#### 23. Do a back-of-the-envelope capacity estimate: a service handles 50M requests/day with an average response of 5 KB. Compute QPS, peak QPS, and egress bandwidth.

*Difficulty:* 🟡 medium  ·  *Tags:* `capacity-planning`, `estimation`, `qps`, `bandwidth`

**Average QPS**: 50M / 86,400s ≈ **580 req/s**. Traffic is never flat, so apply a **peak factor**. A common rule is peak ≈ 2-3× average for diurnal traffic, but the sharper rule of thumb is that ~80% of daily traffic arrives in a busy 4-hour window: 0.8 × 50M / (4×3600) ≈ 40M/14,400 ≈ **2,800 req/s peak**. Always size for peak, not average. **Egress bandwidth at peak**: 2,800 req/s × 5 KB = 14,000 KB/s ≈ **14 MB/s ≈ 112 Mbps**, plus protocol/header overhead, call it ~130-150 Mbps. **Per-replica sizing**: if a load test shows one Go replica safely handles 500 req/s at target latency, peak needs 2,800/500 ≈ 6 replicas, and you'd run ~8-9 for headroom and to survive losing a node/AZ. The discipline: start from the business number, convert to per-second, multiply by a justified peak factor, then derive replicas/bandwidth/storage from measured per-unit costs — never average, never without headroom.

**Key points**
- Avg QPS = 50M / 86,400 ≈ 580 req/s
- Peak (80%-in-4h) ≈ 0.8×50M / 14,400 ≈ 2,800 req/s — size for peak
- Egress ≈ 2,800 × 5 KB ≈ 14 MB/s ≈ ~112 Mbps (+overhead → ~130-150 Mbps)
- Replicas = peak / measured per-replica ceiling, plus headroom for node/AZ loss

**Follow-ups**
- How would the numbers change for a write-heavy vs read-heavy mix?
- Why size on peak-of-peak (e.g., a launch) rather than steady peak?

---

#### 24. What is the 'knee' of the performance curve, and how do you find it with load testing?

*Difficulty:* 🟠 hard  ·  *Tags:* `capacity-planning`, `load-testing`, `knee`, `latency`

As you ramp load, throughput rises while latency stays flat and low — until the system nears saturation of its bottleneck resource (CPU, connections, locks). Past that point, throughput plateaus (or drops) while **latency climbs sharply and queues build**. The **knee** is that inflection: the maximum *useful* load where latency is still acceptable. Operating at or beyond the knee is dangerous because the system is in the non-linear regime where a small load increase causes a large latency spike and queueing collapse (per the USL and queueing theory — utilization above ~70-80% makes wait time blow up). You find it by **load testing**: ramp concurrency/RPS in steps, plot throughput AND p99 latency vs offered load, and identify where throughput stops rising and p99 starts its hockey-stick. That RPS is your per-replica capacity. Then you set the **autoscaler target and capacity plan well below the knee** (e.g., 60-70% of it) so you have headroom to absorb spikes and a failed node without tipping into the danger zone. Testing only to 'it doesn't crash' misses this — you must find where latency degrades, not where it dies.

**Key points**
- Knee = inflection where throughput plateaus and latency hockey-sticks
- Beyond it: non-linear regime, queue buildup, collapse (utilization >~70-80%)
- Find via ramped load test plotting throughput AND p99 vs offered load
- Set capacity/autoscale targets well below the knee (~60-70%) for headroom

**Follow-ups**
- Why does queueing theory predict latency blowup above ~70-80% utilization?
- How do you load-test the database tier without a full prod-scale replica?

---

## High Availability

#### 25. What is a single point of failure, and how does redundancy at each tier eliminate it?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `high-availability`, `spof`, `redundancy`, `failover`

A **single point of failure (SPOF)** is any component whose failure takes down the whole system because nothing else can take over. High availability is fundamentally about **finding and eliminating every SPOF** by adding redundancy with automatic failover. You walk the request path tier by tier: the **load balancer** (use a managed/redundant LB or multiple in different AZs), the **stateless app tier** (multiple replicas across AZs behind the LB — the easy tier, since they're interchangeable), the **database** (primary + standby with automatic failover, or a quorum cluster), the **cache** (replicated/clustered so a node loss doesn't dump load on the DB), **DNS** (multiple providers/redundant), and the **AZ/region** itself (spread across AZs; multi-region for the highest tiers). The subtlety: redundancy only helps if failover is *automatic and tested* — a standby you never failover-test, or a 'redundant' pair sharing the same rack/AZ/power, is a hidden SPOF. Also watch for *correlated* failures: two replicas that both depend on one config service fail together. HA = N+1 (or N+2) at every tier, with failover you've actually exercised.

**Key points**
- SPOF = component whose loss takes down the system; HA = eliminate every SPOF
- Add redundancy + auto-failover tier by tier: LB, app, DB, cache, DNS, AZ/region
- Redundancy only counts if failover is automatic and tested
- Beware hidden/correlated SPOFs (shared rack/AZ/config dependency)

**Follow-ups**
- How do you find SPOFs you didn't know about (chaos/fault injection)?
- Why is an untested standby effectively a SPOF?

---

#### 26. Active-active vs active-passive: compare them, including failover behavior and cost.

*Difficulty:* 🟠 hard  ·  *Tags:* `high-availability`, `active-active`, `active-passive`, `failover`

**Active-passive** runs a primary serving all traffic and a standby idle (or read-only) ready to take over. On failure you **failover** to the standby — fast for stateless tiers, but the DB tier incurs a promotion + DNS/connection cutover and possibly some data loss (whatever wasn't yet replicated → your RPO). Pros: simpler, no multi-writer conflict problem, cheaper compute on the passive side if it's smaller. Cons: the standby is idle capacity you pay for, failover has a detectable RTO, and an untested failover may not work. **Active-active** runs all nodes/regions serving traffic simultaneously. Pros: no idle capacity, you're already using both so failover is just removing a node (near-zero RTO), and you get geographic load distribution. Cons: it's much harder for *stateful* tiers — multiple writers mean **conflict resolution** (last-write-wins, CRDTs, or partitioned ownership) and you must handle the consistency trade-offs (often eventual consistency cross-region). Rule: active-active is straightforward for the stateless tier and read traffic; for the write/database tier it's a hard distributed-systems problem, so many systems run active-active at the app/read layer but active-passive (single primary) for writes.

**Key points**
- Active-passive: standby idle, failover has RTO + possible data loss (RPO); simpler, single writer
- Active-active: all nodes serve, near-zero RTO, no idle capacity, geo-distribution
- Active-active stateful = multi-writer conflict resolution + consistency trade-offs
- Common pattern: active-active app/reads, active-passive (single primary) for writes

**Follow-ups**
- How do you resolve write conflicts in an active-active multi-region database?
- Why does active-passive failover often have a worse real-world RTO than expected?

---

#### 27. Multi-AZ vs multi-region: what does each protect against, and what does each cost you?

*Difficulty:* 🟠 hard  ·  *Tags:* `high-availability`, `multi-az`, `multi-region`, `rpo`

**Multi-AZ** spreads replicas across availability zones within one region — separate data centers with independent power/cooling/network but low-latency (~1-2 ms) links between them. It protects against a single-AZ failure (power, network, hardware) and is nearly free architecturally: synchronous DB replication across AZs is viable because latency is tiny, so you get HA with strong consistency and ~zero RPO. This is the *default* for any serious production system. **Multi-region** spans geographically distant regions and protects against a whole-region outage, plus gives users lower latency via geo-routing. But the cost is steep: cross-region latency (tens to >100 ms) makes synchronous replication impractical, so you accept **asynchronous replication** → non-zero RPO (data loss window on regional failover) and the full distributed-systems tax of cross-region consistency (active-active write conflicts, data residency/locality concerns, much higher complexity and egress cost). Rule of thumb: do multi-AZ always; add multi-region only when your availability SLA or DR requirement genuinely needs to survive a region loss, or when latency to distant users demands local presence — and be honest that it roughly doubles operational complexity.

**Key points**
- Multi-AZ: separate DCs, ~1-2 ms apart → sync replication, strong consistency, ~zero RPO; the default
- Multi-region: survives region loss + geo-latency wins
- Multi-region cost: async replication → RPO loss window, cross-region consistency tax, residency, egress
- Always multi-AZ; add multi-region only when SLA/DR/latency truly require it

**Follow-ups**
- Why can't you do synchronous cross-region DB replication for a write-heavy service?
- How does data residency (GDPR) interact with multi-region design?

---

#### 28. Define RTO and RPO. How do they drive your HA/DR architecture?

*Difficulty:* 🟡 medium  ·  *Tags:* `high-availability`, `rto`, `rpo`, `disaster-recovery`

**RTO (Recovery Time Objective)** is the maximum acceptable *downtime* — how long until service is restored after a failure. **RPO (Recovery Point Objective)** is the maximum acceptable *data loss* — how far back, in time, you can lose data (the gap between the last durable copy and the failure). They are distinct and drive different choices. A tight **RPO** (near zero) forces **synchronous replication** (every write durable in 2+ places before ack) — cheap within an AZ, expensive/latency-adding across regions; a relaxed RPO (e.g., 'up to 5 minutes of loss is OK') permits async replication and periodic snapshots. A tight **RTO** (seconds) forces **active-active or hot-standby with automatic failover**; a relaxed RTO (hours) permits cold standby or restore-from-backup. You set both from business impact, then pick the cheapest architecture that meets them — over-provisioning (zero-RPO/zero-RTO everywhere) is wasteful, under-provisioning is an outage you can't recover from. Critically, you must **test** failover to validate the *actual* RTO, since real failover (DNS propagation, connection draining, promotion) is usually slower than the theoretical number.

**Key points**
- RTO = max downtime; RPO = max data loss — separate objectives
- Tight RPO → synchronous replication (cost/latency); relaxed RPO → async/snapshots
- Tight RTO → active-active/hot-standby + auto-failover; relaxed RTO → cold standby/restore
- Set from business impact; test failover to learn the real RTO

**Follow-ups**
- Give an architecture for RPO=0, RTO<30s and explain its cost.
- Why is the tested RTO usually worse than the designed one?

---

#### 29. What is graceful degradation, and how does it keep a service available under partial failure?

*Difficulty:* 🟡 medium  ·  *Tags:* `high-availability`, `graceful-degradation`, `fallback`, `resilience`

**Graceful degradation** means that when a dependency or capacity is lost, the service drops to a reduced-but-functional mode instead of failing entirely. The principle: not all features are equally critical, so you protect the core and shed the rest. Concrete tactics: serve **stale cache** when the DB is down (slightly old data beats an error); **disable non-essential features** under load (turn off recommendations, related items, or expensive personalization while keeping checkout working); return a **default/fallback** response when an enrichment service times out (e.g., show the product without its live inventory count); and **degrade quality** (lower-res images, fewer results). This requires designing dependencies as **optional vs required** up front and wiring each optional call with a timeout + fallback (often behind a circuit breaker so a dead dependency fails fast to the fallback). The opposite failure mode is a hard dependency on something non-critical — e.g., the page won't render because the 'recently viewed' service is down. The senior mindset: a payment service should keep taking payments even if analytics, recommendations, and notifications are all down. Degraded availability > zero availability.

**Key points**
- Drop to reduced-but-functional mode on partial failure instead of erroring out
- Tactics: serve stale cache, disable non-essential features, default/fallback responses, lower quality
- Classify dependencies optional vs required; wrap optional ones in timeout + fallback + circuit breaker
- Anti-pattern: a non-critical dependency blocking the critical path


```go
// Optional enrichment must never block the core response.
func getProduct(ctx context.Context, id string) ProductView {
    p := loadProduct(ctx, id) // required
    ctx2, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
    defer cancel()
    if inv, err := inventory.Get(ctx2, id); err == nil {
        p.Stock = inv.Count
    } // on timeout/error: render without live stock (degrade, don't fail)
    return p
}
```

**Follow-ups**
- How do circuit breakers make graceful degradation fast instead of timeout-bound?
- How do you decide at design time which dependencies are 'required'?

---

## Availability Math

#### 30. Translate 99.9%, 99.99%, and 99.999% into real downtime. Why do the extra nines get so expensive?

*Difficulty:* 🟡 medium  ·  *Tags:* `availability`, `nines`, `slo`, `downtime`

Availability as allowed downtime per year: **99.9% ('three nines')** ≈ 8.76 hours/year (~43 min/month); **99.99% ('four nines')** ≈ 52.6 min/year (~4.3 min/month); **99.999% ('five nines')** ≈ 5.26 min/year (~26 s/month). Each nine is a 10× reduction in tolerated downtime. Cost explodes because at three nines a single careful human-driven failover or a short deploy blip fits in budget, but at five nines you have ~5 minutes for the *entire year* — that's less than the time it takes a human to even notice an alert, so you *must* have fully automated detection and failover, active-active multi-region, redundant everything, zero-downtime deploys, and rigorous change control. You're also bounded by your **dependencies**: you can't be more available than the multiplied availability of everything in your critical path. So each nine roughly multiplies cost and operational rigor, with diminishing business value — the senior move is to right-size the SLO to what the business actually needs (often 99.9-99.95% is plenty) rather than chase nines that cost more than the outages they prevent.

**Key points**
- 99.9% ≈ 8.76 h/yr; 99.99% ≈ 52.6 min/yr; 99.999% ≈ 5.26 min/yr (each nine = 10× less)
- Five nines leaves no room for human-in-the-loop → full automation required
- Bounded by dependency availability in the critical path
- Cost/rigor multiply per nine with diminishing value → right-size the SLO

**Follow-ups**
- Why is five-nines essentially impossible with any manual operational step?
- How do you choose an SLO target from business impact rather than vanity?

---

#### 31. How do dependencies multiply to reduce availability, and what design patterns counteract it?

*Difficulty:* 🟠 hard  ·  *Tags:* `availability`, `dependencies`, `redundancy`, `math`

For components in **series** (all must work for the request to succeed), availabilities **multiply**. If your request needs the DB (99.9%), cache (99.9%), auth service (99.9%), and a payment gateway (99.9%) all up, end-to-end availability ≈ 0.999⁴ ≈ **99.6%** — worse than any single component, ~35 hours/year of downtime. Add more dependencies and it keeps dropping. This is the central reason chatty microservice graphs with deep synchronous fan-out are fragile: every hop you make *required* drags the product down. Counter-patterns: (1) **redundancy in parallel** — two redundant instances at 99.9% each give 1−(0.001)² = 99.9999%, so parallel redundancy raises availability while series lowers it; (2) **make dependencies non-required** via graceful degradation/fallbacks so a dependency's downtime doesn't count against you; (3) **async/queue decoupling** so a downstream being down delays rather than fails work; (4) **caching** so you survive a dependency blip; (5) **circuit breakers + timeouts** so a slow dependency doesn't cascade. The takeaway: minimize the number of *synchronous, required* dependencies on the critical path, and add parallel redundancy where you can't.

**Key points**
- Series dependencies multiply: 0.999⁴ ≈ 99.6% (~35 h/yr) — worse than any one
- Deep synchronous required fan-out is the core fragility of microservice graphs
- Parallel redundancy raises availability: 1−(0.001)² = 99.9999%
- Reduce required synchronous deps via fallbacks, async/queues, caching, circuit breakers

**Follow-ups**
- Compute the availability of 10 serial 99.95% dependencies.
- How does making a dependency async change its contribution to availability?

---

#### 32. What is an error budget, and how does it govern the trade-off between reliability and velocity?

*Difficulty:* 🟠 hard  ·  *Tags:* `availability`, `error-budget`, `slo`, `sre`

An **error budget** is the inverse of your SLO: if the SLO is 99.9% successful requests, the budget is the 0.1% you're *allowed* to fail — over a 30-day window, roughly 43 minutes of full downtime or the equivalent in elevated error rate. It reframes reliability from 'never fail' (impossible and over-expensive) to 'fail no more than X,' turning availability into a quantified, spendable resource. Operationally it governs the **velocity-vs-reliability tension**: when the budget has room, teams ship fast, take deployment risk, and run experiments — those carry some failure cost, which is fine. When the budget is **exhausted** (you've burned the month's allowance), the policy flips: freeze risky launches, halt non-essential deploys, and pour effort into reliability work until the budget recovers. This aligns incentives between product (wants features) and SRE (wants stability) with a shared, objective number instead of arguments. You watch the **burn rate** — how fast you're consuming budget — and alert on fast burn (a sudden spike threatening to blow the whole month in hours) more aggressively than slow burn. It also stops you over-investing: if you're consistently *under*-spending the budget, you may be too conservative and could trade some reliability for velocity.

**Key points**
- Error budget = 1 − SLO; 99.9% → ~43 min/month of allowed failure
- Reframes reliability as a spendable resource, not 'never fail'
- Budget has room → ship fast; budget exhausted → freeze risk, do reliability work
- Track burn rate; alert harder on fast burn; under-spend signals over-conservatism

**Follow-ups**
- How do you set multi-window burn-rate alerts (fast and slow burn)?
- What happens to the freeze policy if the budget keeps getting blown by a flaky dependency?

---

## Resilience Patterns

#### 33. Rate limiting vs load shedding vs backpressure: distinguish these and when each applies.

*Difficulty:* 🟠 hard  ·  *Tags:* `resilience`, `rate-limiting`, `load-shedding`, `backpressure`

All three protect a service from being overwhelmed, but at different layers. **Rate limiting** caps how many requests a *client/tenant* may send (e.g., 100 req/s per API key), enforced at the edge — it's about fairness and abuse prevention, applied *before* work begins, and is proactive/policy-driven. **Load shedding** is reactive *self-protection*: when the service itself is overloaded (queue full, CPU pegged, latency rising), it deliberately **rejects** some requests fast (HTTP 503) so the ones it does accept stay healthy — better to fail 20% cleanly than to brown out 100% by accepting everything. The key insight: an overloaded server that tries to serve everything serves nothing well (goodput collapses), so shedding *increases* useful throughput. **Backpressure** propagates 'slow down' *upstream* through the system: a bounded queue or a blocking channel that, when full, makes the producer wait or fail — so overload signals flow back to the source rather than building unbounded buffers. In Go, backpressure is often a buffered channel/semaphore that blocks when full; load shedding is choosing to drop instead of block when the semaphore is exhausted. Use rate limiting at the edge for fairness, load shedding inside the service for survival, and backpressure to keep queues bounded end-to-end.

**Key points**
- Rate limiting: per-client cap at the edge, proactive fairness/abuse control
- Load shedding: reactive self-protection, reject fast under overload to keep goodput up
- Backpressure: propagate 'slow down' upstream via bounded queues/blocking
- Go: semaphore/bounded channel = backpressure; drop-on-full = shedding


```go
// Concurrency-limit semaphore: backpressure (block) or shed (drop) when full.
sem := make(chan struct{}, maxInFlight)
func handle(w http.ResponseWriter, r *http.Request) {
    select {
    case sem <- struct{}{}:
        defer func() { <-sem }()
        serve(w, r)
    default: // at capacity → shed fast instead of queueing unboundedly
        http.Error(w, "overloaded", http.StatusServiceUnavailable)
    }
}
```

**Follow-ups**
- Why does accepting all requests under overload reduce goodput to near zero?
- How do you choose between blocking (backpressure) and dropping (shedding) at capacity?

---

#### 34. Explain the circuit breaker pattern and how it prevents cascading failure at scale.

*Difficulty:* 🟠 hard  ·  *Tags:* `resilience`, `circuit-breaker`, `cascading-failure`, `bulkhead`

A **circuit breaker** wraps calls to a dependency and tracks failures. In **closed** state, calls flow through normally while it counts errors/timeouts; once failures cross a threshold it **trips open**, and for a cooldown period it **fails fast** — returning an error or fallback *immediately* without calling the dependency. After the cooldown it goes **half-open**, letting a trickle of probe requests through; if they succeed it closes again, if they fail it re-opens. The scaling value is preventing **cascading failure**: when a downstream is down or slow, naive callers pile up waiting on timeouts, exhausting their own goroutines/threads/connection pools, which makes *them* unresponsive, which cascades upstream until the whole graph is gridlocked. By failing fast, the breaker (1) stops callers from blocking on a dead dependency (preserving their capacity for healthy work), (2) gives the struggling downstream room to recover instead of being hammered by retries, and (3) lets you serve a fallback for graceful degradation. It pairs with **timeouts** (so 'slow' counts as failure) and **bulkheads** (isolate the breaker's resource pool). The trap: thresholds too sensitive cause flapping; too lax and it never protects you — tune against real failure data.

**Key points**
- States: closed (count) → open (fail fast) → half-open (probe) → close/re-open
- Prevents cascade: stops callers blocking on a dead dependency and exhausting their own pools
- Gives the failing downstream room to recover; enables fast fallback
- Pair with timeouts + bulkheads; tune thresholds to avoid flapping

**Follow-ups**
- How does a circuit breaker interact with retries to avoid amplifying load?
- Why is a timeout a prerequisite for a breaker to be effective?

---

#### 35. Why do retries need jitter, and how can naive retries make an outage worse?

*Difficulty:* 🟠 hard  ·  *Tags:* `resilience`, `retries`, `jitter`, `backoff`

Retries handle *transient* failures, but done naively they're a load amplifier and a cause of **retry storms**. Problem one: **synchronized retries**. If a dependency blips and thousands of clients all retry after the same fixed backoff (e.g., 'wait 1s, retry'), they hit the recovering service in a synchronized wave — a thundering herd that re-overloads it the instant it comes back, causing a self-perpetuating outage. **Jitter** (randomizing the backoff, e.g., `sleep = random(0, base·2^attempt)`, 'full jitter') spreads retries over time so the recovering service sees a smooth ramp, not a spike. Problem two: **retry amplification across layers**. If each of 3 service hops retries 3×, a single user request can become 27 backend calls; under partial failure that multiplies load exactly when the system is weakest. Mitigations beyond jitter: **exponential backoff** (give the dependency increasing time to recover), a **retry budget / token bucket** (cap the fraction of traffic that is retries, e.g., ≤10%), **don't retry non-idempotent or non-retriable errors** (a 400 or a 'duplicate charge' should never retry), retry only at *one* layer (usually the outermost or via the service mesh), and combine with circuit breakers so you stop retrying a dead dependency entirely.

**Key points**
- Fixed backoff → synchronized retry wave re-overloads the recovering service
- Jitter randomizes backoff → smooth ramp instead of a spike (full jitter)
- Retry amplification: 3 hops × 3 retries = 27 calls — worst at peak stress
- Add exponential backoff, retry budgets (≤10%), retry only idempotent ops, retry at one layer, pair with breakers


```go
// Exponential backoff with full jitter; only retry retriable, idempotent ops.
func retry(ctx context.Context, op func() error) error {
    base := 50 * time.Millisecond
    for attempt := 0; attempt < 5; attempt++ {
        err := op()
        if err == nil || !retriable(err) { return err }
        backoff := base * (1 << attempt)
        sleep := time.Duration(rand.Int63n(int64(backoff))) // full jitter
        select {
        case <-time.After(sleep):
        case <-ctx.Done(): return ctx.Err()
        }
    }
    return errExhausted
}
```

**Follow-ups**
- Why is retrying at every layer of a call chain dangerous, and where should retries live?
- How does a retry budget differ from a circuit breaker, and why use both?

---

#### 36. What are bulkheads, and how does queue-based load leveling smooth out scaling spikes?

*Difficulty:* 🟠 hard  ·  *Tags:* `resilience`, `bulkhead`, `queue-based-leveling`, `backpressure`

**Bulkheads** isolate resources so a failure in one part can't sink the whole ship (the naval metaphor). In a service, you give each dependency or workload class its own resource pool — separate connection pools, separate goroutine/concurrency limits, or separate thread pools — so that if one downstream goes slow and saturates *its* pool, the calls to *other* healthy dependencies still have their own capacity and keep working. Without bulkheads, one slow dependency consumes all shared goroutines/connections and starves everything (a cascading failure). **Queue-based load leveling** decouples producers from consumers with a buffer: instead of a traffic spike hitting the database/processor synchronously, requests land on a queue and consumers drain it at their own sustainable rate. This converts a bursty arrival pattern into a smooth, bounded processing rate — the consumer is sized for *average* throughput plus headroom, not peak, and the queue absorbs the spike. It's how you scale a downstream that can't itself absorb bursts. The critical caveat: the queue must be **bounded** with a defined overflow policy (reject/shed when full). An *unbounded* queue under sustained overload just grows until it exhausts memory and adds unbounded latency — it hides backpressure instead of applying it, turning a fast failure into a slow, total collapse.

**Key points**
- Bulkheads: per-dependency resource pools so one slow downstream can't starve the rest
- Without them, a shared pool lets one slow dep cause cascading starvation
- Queue-based leveling: buffer converts bursty arrivals into smooth consumer-paced processing
- Queues MUST be bounded with an overflow policy — unbounded = memory blowup + hidden backpressure

**Follow-ups**
- How do you size a leveling queue and its consumer pool from arrival-rate statistics?
- Why is an unbounded queue often worse than no queue at all under sustained overload?

---

## Geo-distribution

#### 37. What are the core trade-offs of multi-region data consistency, and how does data locality factor in?

*Difficulty:* 🔴 staff  ·  *Tags:* `geo-distribution`, `consistency`, `data-locality`, `multi-region`

Going multi-region forces a CAP/PACELC reckoning on your *write* path. Cross-region latency (tens to 100+ ms) means **synchronous** replication on every write is too slow, so you pick a model: (1) **single-primary, async replicas** — one region owns writes, others replicate asynchronously; strong consistency near the primary but high write latency and a stale-read/RPO window for remote regions on failover; (2) **active-active multi-master** — every region accepts writes, replicated async, requiring **conflict resolution** (last-write-wins, CRDTs, or per-key ownership) and giving only eventual consistency; (3) **partitioned/home-region** — each record has a 'home' region (by user geography), writes go there, so you get locality *and* single-writer simplicity per record, at the cost of cross-region access being slower. **Data locality** is the lever that makes this tractable: if you can partition data so each user's data lives in *their* region, most requests are local (low latency) and writes don't cross regions, sidestepping the multi-master conflict problem entirely. This also satisfies **data residency** laws (GDPR — EU users' data stays in the EU). The staff-level judgment: choose the weakest consistency the product can tolerate, partition by locality to minimize cross-region traffic, and reserve strong cross-region consistency (e.g., Spanner-style) only for the rare data that truly needs it — because it's expensive in latency and money.

**Key points**
- Cross-region latency kills synchronous writes → choose a consistency model
- Options: single-primary async (RPO/stale reads), multi-master (conflict resolution, eventual), home-region partitioning
- Data locality (home-region per user) gives local latency + single-writer simplicity + residency compliance
- Pick the weakest tolerable consistency; reserve strong cross-region consistency for the few records that need it

**Follow-ups**
- How do CRDTs let active-active writes converge without coordination?
- How does home-region partitioning handle a user who travels or whose data is shared?

---

#### 38. Explain latency-based routing and the 'follow-the-sun' operational model.

*Difficulty:* 🟡 medium  ·  *Tags:* `geo-distribution`, `latency-routing`, `follow-the-sun`, `failover`

**Latency-based routing** sends each user to the region that gives them the lowest network latency (often the geographically nearest healthy region), typically via a global DNS/anycast layer that measures or estimates RTT and resolves the user to the best endpoint. It improves user-perceived performance (a 150 ms cross-ocean round trip becomes ~20 ms local) and naturally distributes load geographically, with health-awareness so a failed region's users get routed to the next-best one (failover). It pairs with data locality — routing users to the region where their data also lives, so you don't trade a fast network hop for a slow cross-region data fetch. **Follow-the-sun** is an operational model where responsibility (on-call ownership, or even active write capacity) moves around the globe with the working day: an APAC team owns operations during their daytime, handing off to EMEA, then to the Americas, so there's always an awake, local team and you avoid 3am pages. For *data*, a follow-the-sun write-primary can shift the active write region to wherever the bulk of active users currently are, keeping write latency low for the majority — though this only works cleanly when the dominant traffic genuinely shifts by time zone and the data model tolerates moving the primary.

**Key points**
- Latency-based routing: send users to lowest-RTT healthy region (DNS/anycast), with failover
- Pair with data locality so the fast network hop isn't undone by a cross-region data fetch
- Follow-the-sun (ops): on-call ownership moves with the working day → no 3am pages
- Follow-the-sun (data): shift the write primary to where active users currently are

**Follow-ups**
- How does latency-based routing behave when the nearest region is degraded but not down?
- What data-model constraints must hold to move a write primary follow-the-sun?

---

## Common Scaling Pitfalls

#### 39. Hot keys and hot shards: why do they break horizontal scaling, and how do you mitigate them?

*Difficulty:* 🟠 hard  ·  *Tags:* `pitfalls`, `hot-key`, `hot-shard`, `skew`

Horizontal scaling assumes load spreads evenly across nodes/shards. A **hot key** (one record getting a wildly disproportionate share of traffic — a celebrity user, a viral product, a global counter) or a **hot shard** (one shard owning the hot keys, or a bad shard key concentrating load) breaks that assumption: that single partition saturates while the others sit idle, so you can't scale your way out — adding shards doesn't help because the load is on *one* of them. It's the classic 'the average is fine but the p99 partition is on fire.' Mitigations depend on read vs write: for **hot reads**, put a cache in front (replicate the hot key across cache nodes or use a local in-process cache for the hottest keys) so reads never reach the shard; for **hot writes** (the hard case), **split the key** — shard a single counter into N sub-counters per node and sum on read (write-sharding), or add a random/time suffix to the key to spread writes across partitions; or **co-locate + isolate** the hot tenant on dedicated capacity. Detection matters: you need per-key/per-shard metrics, not just aggregate, to even *see* a hot key. The deeper lesson is that real-world key distributions are power-law/Zipfian, not uniform, so hot spots are the rule, not the exception — design for skew.

**Key points**
- Hot key/shard concentrates load on one partition → other shards idle, can't scale out of it
- Hot reads: front with cache / replicate the hot key / local cache
- Hot writes (hard): write-sharding (split counter into N), key suffixing, isolate the hot tenant
- Need per-key/per-shard metrics to detect; real distributions are Zipfian → expect skew

**Follow-ups**
- How does write-sharding a global counter work, and what does it cost on read?
- Why won't adding more shards fix a single hot key?

---

#### 40. What is the network N+1 / chatty-services problem, and why is it worse than the database N+1?

*Difficulty:* 🟠 hard  ·  *Tags:* `pitfalls`, `n-plus-1`, `chatty-services`, `microservices`

A **network N+1** happens when serving one request triggers one call to get a list, then a separate cross-service/cross-network call *per item* — e.g., fetch 100 orders, then call the user-service once per order to get the customer name = 1 + 100 calls. It's the database N+1 problem (1 query + N queries) but over the network between microservices, and it's **far worse** because each hop carries network latency (~1 ms LAN, far more cross-AZ/region), serialization, connection acquisition, and TLS overhead — and these add up *serially* if done in a loop. 100 sequential 2 ms remote calls = 200 ms of pure latency added to one request, and at scale it multiplies into a flood of small requests that hammer the downstream and exhaust connection pools (a **chatty** architecture). It's a top cause of microservice latency blowup and cascading overload. Fixes: **batch** the calls (a single `GetUsers([ids])` instead of N `GetUser(id)`), do **request-time joins via a batched dataloader** (collect IDs, fan out one bulk call — the DataLoader pattern), **denormalize** the needed field so you don't need the second call at all, or **parallelize** the calls if you truly can't batch (turns N×latency into ~1×, though it still floods the downstream). The architectural lesson: service boundaries that force per-item cross-network calls are mis-drawn — prefer coarse-grained, batch-friendly APIs.

**Key points**
- Network N+1: 1 list call + N per-item cross-service calls (1 + 100)
- Worse than DB N+1: network latency + serialization + TLS + connection cost per hop, often serial
- 100 serial 2 ms calls = 200 ms added; at scale floods downstream + exhausts pools
- Fix: batch APIs (GetUsers([ids])), dataloader pattern, denormalize, or parallelize as last resort

**Follow-ups**
- How does the DataLoader/request-coalescing pattern batch per-item calls into one?
- When is denormalizing the field across the service boundary the right call?

---

#### 41. Shared mutable state and unbounded queues: why are these two among the most dangerous scaling pitfalls?

*Difficulty:* 🟠 hard  ·  *Tags:* `pitfalls`, `shared-state`, `unbounded-queue`, `scaling`

**Shared mutable state** is the silent killer of horizontal scaling. Any state held in one process's memory and mutated per-request — an in-process counter, a local rate-limiter, a session map, a non-distributed lock, an in-memory dedup set — is *correct on one replica and wrong on many*. Add a second replica and your rate limiter allows 2× the limit, your dedup misses duplicates handled by the other replica, and your counter is split. The fix is to externalize that state to a store designed for sharing (Redis for counters/locks/sessions) or redesign to avoid it — but the danger is that it *works in dev/single-instance* and only breaks under scale-out, often subtly (wrong numbers, not crashes). **Unbounded queues** are the other trap: a channel, buffer, or message queue with no size limit looks like it 'absorbs' load, but under sustained overload (arrival rate > processing rate) it grows without limit — consuming memory until OOM, and adding ever-increasing latency so by the time an item is processed the caller has long given up (work you do is wasted). It converts backpressure (a healthy fast signal) into a slow, hidden, total collapse. The fix is **bounded** queues with an explicit overflow policy (block = backpressure, or drop = load shedding) so overload surfaces immediately. Both pitfalls share a theme: things that appear fine at small scale fail catastrophically and non-obviously at large scale.

**Key points**
- Shared mutable in-process state (counters, rate limiters, locks, dedup) is correct on 1 replica, wrong on N
- Breaks subtly under scale-out (wrong numbers, not crashes); fix by externalizing to Redis or redesigning
- Unbounded queues grow under sustained overload → OOM + unbounded latency (wasted work)
- Bound queues with overflow policy (block=backpressure / drop=shed) to surface overload fast

**Follow-ups**
- Give an example where a local rate-limiter silently allows N× the intended limit.
- Why does an unbounded queue's latency make the work it eventually does worthless?

---

## Cell-Based Architecture & Blast Radius

#### 42. What is a cell-based architecture, and how does it limit blast radius compared to plain horizontal scaling?

*Difficulty:* 🟠 hard  ·  *Tags:* `cell-based`, `blast-radius`, `fault-isolation`, `architecture`

Plain horizontal scaling adds more identical instances behind one shared everything — one load balancer, one database fleet, one cache. It scales throughput, but a poison-pill request, a bad deploy, or a hot data item can take down the *whole* shared layer: the blast radius is **100% of users**. A **cell-based architecture** instead slices the entire stack into multiple **independent cells**, where each cell is a complete, self-contained copy of the service (its own compute, its own datastore, its own cache) serving a **fixed subset** of users/tenants. A thin **cell router** at the edge maps each request to its cell (by tenant id, user id hash, etc.). The win is **fault isolation**: a failure — corrupted data, a runaway tenant, a bad code path triggered by specific input, even an overload — is contained to the **one cell** that hit it. If you have 10 cells, a worst-case cell failure affects ~10% of users, not everyone. It also bounds **deploy risk** (roll out cell-by-cell; a bad release is caught in cell 1 before it reaches cell 10) and **scaling units** (you scale by adding cells of a known, tested size rather than growing one giant unbounded system whose behavior at 10× is unknown). The cost is operational complexity: routing, per-cell capacity headroom, cross-cell operations, and avoiding data that must span cells. AWS uses this pattern extensively for its own services.

**Key points**
- Cell = a full independent copy of the stack serving a fixed user/tenant subset
- Plain horizontal scaling shares state → blast radius = 100%; cells contain failures to 1/N
- A thin cell router maps each request to its cell
- Bounds deploy risk (roll out cell-by-cell) and gives known-size scaling units
- Cost: routing complexity, per-cell headroom, hard cross-cell operations

**Follow-ups**
- How do you pick the number and size of cells?
- What breaks if a feature needs data that spans multiple cells?

---

#### 43. How does the cell router stay reliable, and why must the control plane be separate from the data plane in a cell architecture?

*Difficulty:* 🔴 staff  ·  *Tags:* `control-plane`, `data-plane`, `static-stability`, `cell-based`

The **cell router** is the one shared component every request passes through, so it's the new potential single point of failure — and the design rule is that it must be **dumb, stateless, and almost never change**. It does one thing: map a partition key to a cell using a **simple, stable mapping** (a hash, or a small lookup table), and it should keep working even if everything behind it is degraded. You keep it thin precisely so its own blast radius is minimal and its change rate (the main source of outages) is near zero. This is the broader **control-plane / data-plane split**: the **data plane** is the per-cell request-serving path that must scale with traffic and stay up; the **control plane** does the heavy, complex, lower-frequency work — provisioning cells, rebalancing tenants, deployments, capacity decisions, the cell-assignment database. The split matters because control planes are **complex and change often** (the two top causes of outages), so you must ensure a control-plane failure **cannot** take down the data plane. Concretely: the router caches its cell-assignment mapping locally and keeps serving from cache if the control plane (assignment DB) is unavailable — 'static stability,' the principle that the data plane survives on its last-known-good state without a live dependency on the control plane. A cell architecture where the router calls the control plane on every request has just reinvented the shared single point of failure.

**Key points**
- Router must be dumb, stateless, stable, rarely-changing — it's the new shared component
- Control plane (provisioning, rebalancing, deploys, assignment DB) is complex + changes often = outage source
- Data plane (per-cell serving) must scale and stay up independent of the control plane
- Static stability: router caches assignments, keeps serving on last-known-good if control plane is down
- Router calling control plane per request = reinvented single point of failure

**Follow-ups**
- What is 'static stability' and where else does it apply (e.g. autoscaling, DNS)?
- How do you safely move a tenant from one cell to another?

---

#### 44. A single tenant outgrows its cell, or one cell becomes a hotspot. How do you handle rebalancing without a big-bang migration?

*Difficulty:* 🟠 hard  ·  *Tags:* `rebalancing`, `cell-based`, `tenant-migration`, `capacity`

First, distinguish the two problems. A **whole cell that's hot** (aggregate load too high) is solved by **adding cells** and shifting *some tenants* off the hot cell — a routing/assignment change plus per-tenant data movement, ideally one tenant at a time so each move is small, reversible, and low-risk. The key is that cell assignment lives in a **lookup table** (not a pure hash), so you can move an individual tenant by updating its entry and migrating just that tenant's data, rather than rehashing everyone (the consistent-hashing-style 'rebalance the world' problem). A migration runs as: dual-write or replicate the tenant's data to the target cell, verify, flip the router entry atomically, drain in-flight requests on the old cell, then clean up — the same playbook as an online shard split. The harder case is a **single tenant too big for any cell** — that tenant violates the assumption that a tenant fits in a cell. Options: give that tenant a **dedicated, larger cell** (heavy hitters get their own blast radius, which is also good isolation), or **sub-partition within the tenant** (shard the tenant's own data across cells by a secondary key), which adds cross-cell complexity for just that tenant. Plan capacity so cells run with **headroom** (e.g. target 50–60% so a tenant's growth or a failover-induced load doubling doesn't instantly saturate), and monitor per-cell utilization so you rebalance *before* a cell tips, not after.

**Key points**
- Hot cell: add cells, move individual tenants (assignment as lookup table, not pure hash)
- Per-tenant migration = online shard-split playbook: replicate → verify → flip router entry → drain → clean up
- Tenant too big for any cell: give it a dedicated cell, or sub-partition that tenant across cells
- Run cells with headroom (~50-60%) so growth/failover doesn't instantly saturate
- Monitor per-cell utilization and rebalance before tipping

**Follow-ups**
- Why is a lookup-table assignment easier to rebalance than a hash-based one?
- How do you make the router cutover atomic and avoid split-brain during migration?

---

#### 45. When is cell-based architecture overkill, and what's the simplest version you'd reach for first?

*Difficulty:* 🟡 medium  ·  *Tags:* `cell-based`, `trade-offs`, `sharding`, `when-to-use`

Cells are a real investment — routing infrastructure, per-cell capacity headroom (you can't pack cells to 100%), cross-cell operational tooling, and the loss of trivial global queries — so they're **overkill until your blast radius actually hurts**. If you're a single small service where a full outage is a brief, acceptable event, or you have few/uniform tenants, plain stateless horizontal scaling plus read replicas is simpler and cheaper. Reach for cells when: you're **multi-tenant** and one tenant's problem must not hurt others; you have a **reliability/contractual** need to cap how many customers a single failure can affect; or you've **outgrown one database/region** and want known-size, independently-deployable scaling units. The simplest stepping-stone before full cells is **partitioning the data tier alone** (shard the database, keep shared stateless compute) plus **shuffle sharding** of the compute so a noisy tenant degrades a small subset of capacity — you get much of the isolation benefit without standing up fully independent cells. Then graduate to true cells (independent stacks per partition) when the shared compute/cache/edge layer itself becomes the thing whose failure you can't tolerate. The progression is: monolith → horizontal scale → sharded data + shuffle-sharded compute → full cells.

**Key points**
- Cells cost routing, headroom, cross-cell tooling, no easy global queries — overkill until blast radius hurts
- Fine to stay on plain horizontal scaling for small/single-tenant/uniform workloads
- Adopt cells for multi-tenant isolation, contractual blast-radius caps, or outgrowing one DB/region
- Stepping stone: shard the data tier + shuffle-shard compute for most of the isolation, less cost
- Progression: monolith → horizontal → sharded+shuffle → full cells

**Follow-ups**
- What concrete signal tells you it's time to move from sharding to full cells?
- What capabilities do you lose when data is split across cells?

---

## Shuffle Sharding & Tenant Isolation

#### 46. What is the noisy-neighbor problem, and how does shuffle sharding give strong isolation with very few resources?

*Difficulty:* 🟠 hard  ·  *Tags:* `shuffle-sharding`, `noisy-neighbor`, `isolation`, `multi-tenant`

The **noisy-neighbor** problem: when many tenants share a pool of workers, one tenant's bad behavior — a flood, a poison-pill request, an expensive query — degrades or kills the shared workers and hurts **everyone**. Plain **sharding** helps a bit: split the pool into, say, 8 shards and assign each tenant to one shard, so a bad tenant only harms the ~1/8 of tenants in its shard. But that's still a big collateral group, and every tenant in that shard is fully exposed. **Shuffle sharding** does dramatically better by assigning each tenant a **random *combination* of nodes** instead of one fixed shard. Say you have 8 nodes and give each tenant a random subset of 2. There are C(8,2)=28 possible pairs, so two tenants share their *entire* assigned set only if they drew the *same* pair. A bad tenant saturates its 2 nodes — but another tenant overlaps with it on **at most one** of *their* 2 nodes, so they still have a healthy node to serve from (especially with a client that retries the other node / routes around the bad one). The magic is combinatorial: with modest node counts and small per-tenant subsets you get a **huge number of distinct combinations**, so the probability that any two tenants fully overlap — and thus that one can fully take down another — becomes tiny, *without* dedicating resources per tenant.

**Key points**
- Noisy neighbor: one tenant's flood/poison-pill degrades the shared pool for all
- Plain sharding limits collateral to one shard (~1/N) but fully exposes everyone in it
- Shuffle sharding assigns each tenant a random COMBINATION of nodes (e.g. 2 of 8)
- Two tenants fully overlap only if they drew the same combination → rare
- Combinatorial blowup gives near-isolation without per-tenant dedicated resources

**Follow-ups**
- Why does a retry/route-around-failure client make shuffle sharding much stronger?
- How does plain sharding's isolation compare numerically to shuffle sharding's?

---

#### 47. Walk through the combinatorics: with N nodes and a shard size of k per tenant, how much isolation do you actually get?

*Difficulty:* 🔴 staff  ·  *Tags:* `shuffle-sharding`, `combinatorics`, `isolation`, `capacity`

The number of distinct shuffle shards is **C(N, k)** (N-choose-k). With N=8 nodes and k=2 per tenant that's 28 combinations; with N=100 and k=5 it's over **75 million**. The isolation question is: given a bad tenant occupying its k nodes, what's the chance another tenant is *fully* overlapped (all of *its* k nodes are inside the bad tenant's k)? For a victim to be fully overlapped, all k of its nodes must fall within the bad tenant's k chosen nodes — probability **C(k, k) / C(N, k) = 1 / C(N, k)** if they're the same size, i.e. they must have drawn the identical shard. More usefully, the chance a victim shares *all* its nodes with the attacker drops fast as N grows and k stays small. The practical effect: with a **retry-on-failure** client, a victim is only truly harmed if it has **no** non-overlapping healthy node — and the probability of *complete* overlap is ~1/C(N,k), which for N=100,k=5 is ~1-in-75-million per tenant pair. So a single bad tenant might fully impact a handful of unlucky tenants out of millions, while plain sharding would have impacted an entire 1/(N/k) fraction. The tuning trade-off: **larger k** → more throughput per tenant and more combinations (better isolation) but more nodes touched per bad tenant (each bad tenant 'pollutes' more of the fleet); **smaller k** → tighter containment per incident but less per-tenant capacity and fewer combinations. You size k to the per-tenant throughput need, then pick N to make C(N,k) large enough that full overlap is negligible.

**Key points**
- Distinct shards = C(N,k); N=100,k=5 → ~75M combinations
- Probability a victim fully overlaps the attacker ≈ 1/C(N,k) (must draw identical shard)
- With retry-around-failure, harm needs ZERO non-overlapping healthy node → extremely rare
- vs plain sharding which exposes a full 1/(N/k) fraction per incident
- Tuning: bigger k = more capacity + combinations but each bad tenant pollutes more nodes; smaller k = tighter containment

**Follow-ups**
- How does increasing k affect both isolation AND the fraction of the fleet a bad tenant touches?
- Where does AWS use shuffle sharding (e.g. Route 53, API Gateway)?

---

#### 48. When would you choose dedicated-per-tenant resources over shuffle sharding, and what are the costs of each?

*Difficulty:* 🟡 medium  ·  *Tags:* `multi-tenant`, `isolation`, `shuffle-sharding`, `trade-offs`

**Dedicated per-tenant** (each tenant gets its own isolated stack/instance) gives the **strongest possible isolation** — zero overlap, a tenant literally cannot touch another's resources — and clean per-tenant accounting, security boundaries, and the ability to offer per-tenant SLAs or versions. Its cost is **money and density**: you pay for idle capacity per tenant (most tenants don't use their full allocation), it scales operationally with tenant count (thousands of stacks to deploy/patch/monitor), and small tenants are wildly uneconomical. **Shuffle sharding** gives *near*-perfect isolation at a **fraction of the cost** because tenants **share** a pool — you size for aggregate load, not sum-of-peaks, so utilization is high and you operate one fleet. Its cost is that isolation is **probabilistic, not absolute** (a tiny chance of overlap), it relies on tenants being **smaller than the pool** and on **retry/route-around** behavior to realize the benefit, and noisy tenants still consume shared capacity you must headroom for. The decision: use **dedicated** for a *small number* of large, high-value, or compliance-bound tenants (the heavy hitters and the ones paying for guaranteed isolation); use **shuffle sharding** for the *long tail* of many small/medium tenants where per-tenant dedication is uneconomical and probabilistic isolation is plenty. Real platforms do **both** — dedicated cells for whales, a shuffle-sharded shared pool for everyone else.

**Key points**
- Dedicated: absolute isolation + per-tenant SLA/security/accounting, but costly, low density, ops scales with tenant count
- Shuffle sharding: near-perfect isolation, high utilization (size for aggregate), one fleet — but probabilistic and needs tenants < pool + retry
- Dedicated for few large/high-value/compliance tenants (whales)
- Shuffle sharding for the long tail of many small tenants
- Hybrid is common: dedicated cells for whales + shared shuffle-sharded pool for the rest

**Follow-ups**
- How do you bill/account fairly in a shared shuffle-sharded pool?
- What compliance requirements force dedicated isolation regardless of cost?

---

## Load Shedding & Brownout

#### 49. Why does an overloaded service that keeps accepting work collapse, and how does load shedding prevent it? Tie it to queueing.

*Difficulty:* 🟠 hard  ·  *Tags:* `load-shedding`, `congestion-collapse`, `queueing`, `overload`

A service has finite concurrency. When the **arrival rate exceeds throughput**, the excess doesn't disappear — it **queues**. By Little's Law / queueing theory, as utilization approaches 100% the wait time goes nonlinear (response time ~ 1/(μ−λ)), so latency spikes; meanwhile each queued request still holds memory, a connection, maybe a goroutine, so the **queue itself consumes the resources** needed to drain it. You enter a **congestion-collapse spiral**: latency rises → clients time out → clients **retry** → arrival rate goes *up* → queue grows → latency rises more. The server ends up spending all its capacity on work that's **already been abandoned** by callers who timed out — it's doing maximum work and completing nothing useful, often until it OOMs. **Load shedding** breaks the spiral by **refusing excess work early and cheaply** (return `503`/`429` before doing expensive processing) so the service only admits what it can actually complete within its latency budget. Throughput stays at the healthy plateau instead of collapsing past the knee, admitted requests keep meeting their SLO, and the rejected ones get a fast, honest 'no' the client can act on. The counterintuitive senior point: **a good service under overload does *less* total work on purpose** — completing 80% of requests well beats accepting 100% and completing 0% as it falls over.

**Key points**
- Arrivals > throughput → unbounded queue; Little's Law: latency goes nonlinear near 100% util
- Queued requests hold the very resources needed to drain them
- Congestion collapse: slow → timeouts → retries → more load → spiral; server does max work, completes nothing
- Load shedding: reject excess early/cheap (503/429) so only completable work is admitted
- Deliberately do less total work: 80% completed well beats 100% accepted, 0% completed

**Follow-ups**
- Where should you shed: at the LB, the gateway, or inside the service — and why early?
- How do retries from clients make shedding necessary rather than optional?

---

#### 50. Design admission control / load shedding for a service. What signal do you shed on, and how do you decide WHICH requests to drop?

*Difficulty:* 🔴 staff  ·  *Tags:* `admission-control`, `load-shedding`, `prioritization`, `brownout`

Two decisions: **when** to shed and **what** to shed. **When (the signal):** shedding on CPU or a static RPS cap is brittle — the robust signal is a **direct measure of saturation**, typically **queue depth / latency** or **concurrency in flight**. Adaptive approaches (e.g. Netflix-style concurrency limits, or a TCP-Vegas-like controller) watch latency and **shrink the allowed concurrency** when latency climbs, so the limit self-tunes to the current capacity rather than a guessed number. The moment in-flight work exceeds what keeps latency in SLO, new arrivals are rejected. **What (prioritization):** not all requests are equal, so shed the **least critical first**. Tag requests with a **criticality / priority** class — e.g. (1) user-facing critical (checkout, login), (2) user-facing non-critical (recommendations, 'people also viewed'), (3) background/batch (prefetch, analytics, retries). Under pressure, drop class 3, then 2, protecting class 1 to the last. Also shed **retries before first-tries** (a retry storm shouldn't starve fresh requests) and prefer to reject **cheap-to-reject** work before it consumes resources. Make the rejection **fast and honest** (`503` + `Retry-After`) so clients back off rather than hammer. The advanced version is **brownout**: instead of all-or-nothing per request, individual features degrade — the page still loads but drops the expensive personalized panel — so the user gets a *degraded but working* experience instead of an error. Combine: brownout non-critical features first, then shed whole low-priority requests, always protecting the critical path.

**Key points**
- Shed on a saturation signal (queue depth/latency/in-flight concurrency), not static CPU/RPS — adaptive concurrency limits self-tune
- Prioritize: tag requests by criticality; drop background → non-critical → critical last
- Shed retries before first-tries; reject cheap-to-reject work before it consumes resources
- Reject fast + honest (503/Retry-After) so clients back off
- Brownout: degrade individual features (drop expensive panel) for a working-but-degraded experience vs an error

**Follow-ups**
- How does an adaptive concurrency limit (e.g. Vegas/Gradient) decide the current limit?
- How do you propagate request criticality across service hops?

---

#### 51. What is brownout (graceful degradation), and how is it different from load shedding and from a circuit breaker?

*Difficulty:* 🟡 medium  ·  *Tags:* `brownout`, `graceful-degradation`, `load-shedding`, `circuit-breaker`

All three are overload/failure responses, but they act at different granularities. **Load shedding** is **per-request, binary**: under overload you *reject* whole requests (fast `503`) to keep the admitted ones healthy — the user either gets served or gets an error. A **circuit breaker** is **per-dependency**: when a *downstream* is failing, you stop calling it and fail fast (or serve a fallback) so its sickness doesn't hang you — it's about protecting *yourself* from a *broken dependency*, not about your own overload. **Brownout** is **per-feature, graded**: instead of failing the whole request, you **drop the optional, expensive parts** and still return a useful response — the product page renders from cache and core data but skips the personalized recommendations, real-time inventory, or rich media that cost the most. It's 'dim the lights' rather than 'cut the power.' You wire it by classifying functionality as essential vs. optional and disabling optional work when a load signal (latency, queue depth, an error budget, a feature flag) trips. The three compose: a **circuit breaker** trips when the recommendations *service* is down → the page **browns out** that panel (degrades the feature) → and if the *whole* service is still over capacity, **load shedding** rejects excess requests outright. The progression from best to worst user experience is: full service → brownout (degraded but working) → shed (clean error) → collapse (everything fails). Good systems move down that ladder deliberately, one rung at a time.

**Key points**
- Load shedding = per-request binary reject (503) to protect admitted requests
- Circuit breaker = per-dependency: stop calling a failing downstream, fail fast/fallback (protect self)
- Brownout = per-feature graded: drop optional/expensive parts, still return a useful response
- Classify features essential vs optional; disable optional on a load signal/flag
- They compose; UX ladder: full → brownout → shed → collapse — descend one rung deliberately

**Follow-ups**
- Which features would you mark 'optional' in an e-commerce product page, and why?
- How do feature flags help you pre-wire brownout before an incident?

---
