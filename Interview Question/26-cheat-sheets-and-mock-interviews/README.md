# Cheat Sheets — Last-Mile Quick Reference

Dense, scannable reference tables for the night-before review. Read top to bottom in 30–45 minutes. Everything here is approximate by design — interviewers want orders of magnitude and correct reasoning, not memorized decimals.

---

## 1. Latency Numbers Every Engineer Should Know

Round figures (modern server, ~2020s hardware). Memorize the *ratios*, not the digits.

| Operation                                   | Latency      | Notes / mental model                     |
|---------------------------------------------|--------------|------------------------------------------|
| L1 cache reference                          | ~1 ns        | baseline                                 |
| Branch mispredict                           | ~3 ns        |                                          |
| L2 cache reference                          | ~4 ns        | ~4× L1                                   |
| Mutex lock/unlock (uncontended)             | ~17 ns       |                                          |
| L3 cache reference                          | ~10–20 ns    |                                          |
| Main memory (RAM) reference                 | ~100 ns      | ~100× L1                                 |
| Compress 1 KB (e.g. snappy)                 | ~2 µs        |                                          |
| Read 1 MB sequentially from RAM             | ~3 µs        |                                          |
| Send 1 KB over 10 Gbps network              | ~1 µs        |                                          |
| SSD random read (NVMe)                       | ~16–100 µs   | ~1000× RAM                               |
| Read 1 MB sequentially from SSD             | ~50–200 µs   |                                          |
| Round trip within same datacenter           | ~0.5 ms      | 500 µs                                   |
| Read 1 MB sequentially from disk (HDD)      | ~5–20 ms     |                                          |
| HDD seek                                     | ~10 ms       |                                          |
| Round trip CA → Netherlands → CA            | ~150 ms      | speed of light dominates                 |
| TLS handshake (new connection, cross-region)| ~250–500 ms  | reuse connections!                       |

**Key ratios:** RAM is ~100× L1. SSD is ~1000× RAM. Network DC round-trip is ~5× SSD read. Cross-continent is ~300× DC round-trip. Disk seek ≈ cross-continent round-trip.

---

## 2. Big-O Complexity — Data Structures & Algorithms

### Data structure operations (average / worst)

| Structure              | Access     | Search     | Insert     | Delete     | Space  |
|------------------------|------------|------------|------------|------------|--------|
| Array / slice (index)  | O(1)       | O(n)       | O(n)       | O(n)       | O(n)   |
| Slice append (amortized)| —         | —          | O(1)*      | —          | O(n)   |
| Hash map               | —          | O(1)/O(n)  | O(1)/O(n)  | O(1)/O(n)  | O(n)   |
| Linked list            | O(n)       | O(n)       | O(1)†      | O(1)†      | O(n)   |
| Binary search tree     | O(log n)/O(n)| O(log n)/O(n)| O(log n)/O(n)| O(log n)/O(n)| O(n)|
| Balanced BST (RB/AVL)  | O(log n)   | O(log n)   | O(log n)   | O(log n)   | O(n)   |
| Heap (binary)          | —          | O(n)       | O(log n)   | O(log n)   | O(n)   |
| Skip list              | O(log n)   | O(log n)   | O(log n)   | O(log n)   | O(n)   |
| B-tree / B+tree        | O(log n)   | O(log n)   | O(log n)   | O(log n)   | O(n)   |
| Trie                   | O(k)       | O(k)       | O(k)       | O(k)       | O(n·k) |

\* amortized; a single append that triggers regrow is O(n).  † given the node pointer.

### Sorting

| Algorithm   | Best       | Average    | Worst      | Space    | Stable |
|-------------|------------|------------|------------|----------|--------|
| Quicksort   | O(n log n) | O(n log n) | O(n²)      | O(log n) | No     |
| Mergesort   | O(n log n) | O(n log n) | O(n log n) | O(n)     | Yes    |
| Heapsort    | O(n log n) | O(n log n) | O(n log n) | O(1)     | No     |
| Insertion   | O(n)       | O(n²)      | O(n²)      | O(1)     | Yes    |
| Counting    | O(n+k)     | O(n+k)     | O(n+k)     | O(n+k)   | Yes    |
| Radix       | O(nk)      | O(nk)      | O(nk)      | O(n+k)   | Yes    |

### Go standard library specifics

| Operation                          | Complexity | Notes                                            |
|------------------------------------|------------|--------------------------------------------------|
| `sort.Slice` / `sort.Sort`         | O(n log n) | pattern-defeating quicksort (pdqsort), not stable|
| `sort.Stable`                      | O(n log n) | stable merge-based                               |
| `slices.Sort` (1.21+)              | O(n log n) | pdqsort, generic                                 |
| `sort.Search` (binary search)      | O(log n)   | on sorted data                                   |
| map read/write/delete              | O(1) avg   | hashed; iteration order randomized               |
| `slices.Contains`                  | O(n)       | linear scan                                      |
| `append` (amortized)               | O(1)       | doubles capacity (then ~1.25× for large slices)  |
| `copy`                             | O(n)       |                                                  |
| `len` / `cap`                      | O(1)       |                                                  |
| string concat in loop with `+`     | O(n²)      | use `strings.Builder` → O(n)                     |

---

## 3. Capacity Estimation Cheatsheet

### Time constants

| Period       | Seconds      | Round number          |
|--------------|--------------|-----------------------|
| 1 day        | 86,400       | ~10⁵ (~100k)          |
| 1 month      | ~2.6M        | ~2.5 × 10⁶            |
| 1 year       | ~31.5M       | π × 10⁷ (handy trick) |

### QPS math

- **Avg QPS** = daily requests / 86,400. So 1M req/day ≈ **12 QPS**. 1B req/day ≈ **12k QPS**.
- **Peak QPS** ≈ 2–3× average (rule of thumb). Some bursty systems: 10×.
- **DAU × actions/user/day** → daily requests. e.g. 10M DAU × 20 actions = 200M req/day ≈ 2.3k avg QPS, ~5–7k peak.

### Powers of two ↔ storage

| Power | Exact value      | Approx | Name |
|-------|------------------|--------|------|
| 2¹⁰   | 1,024            | ~10³   | KB   |
| 2²⁰   | 1,048,576        | ~10⁶   | MB   |
| 2³⁰   | ~1.07 × 10⁹      | ~10⁹   | GB   |
| 2⁴⁰   | ~1.10 × 10¹²     | ~10¹²  | TB   |
| 2⁵⁰   | ~1.13 × 10¹⁵     | ~10¹⁵  | PB   |

### Typical record sizes (estimation anchors)

| Item                          | Size estimate          |
|-------------------------------|------------------------|
| char (ASCII) / byte           | 1 B                    |
| UUID                          | 16 B (raw) / 36 B (text)|
| int64 / timestamp / pointer   | 8 B                    |
| Short metadata row (id, fks, status, ts) | ~100–200 B  |
| Typical DB row (e-commerce order) | ~1 KB              |
| User profile JSON             | ~1–5 KB                |
| Thumbnail image               | ~10–50 KB              |
| Web page (HTML)               | ~100 KB                |
| Photo (compressed)            | ~1–5 MB                |
| Minute of 1080p video         | ~10–50 MB              |

**Worked example:** 1B orders/year × 1 KB = **1 TB/year** raw. With indexes + replication (×3) + overhead → budget ~5 TB/year. Storage is cheap; design for retention/archival.

---

## 4. PostgreSQL Isolation Levels vs Anomalies

✗ = prevented, ✓ = possible. PostgreSQL is stricter than the SQL standard (no dirty reads even at Read Committed; "Repeatable Read" is actually snapshot isolation).

| Level (PostgreSQL)        | Dirty read | Non-repeatable read | Phantom read | Serialization anomaly |
|---------------------------|------------|---------------------|--------------|-----------------------|
| Read Uncommitted*         | ✗          | ✓                   | ✓            | ✓                     |
| **Read Committed** (default)| ✗        | ✓                   | ✓            | ✓                     |
| **Repeatable Read** (snapshot)| ✗      | ✗                   | ✗            | ✓                     |
| **Serializable** (SSI)    | ✗          | ✗                   | ✗            | ✗                     |

\* PostgreSQL treats Read Uncommitted as Read Committed — dirty reads never occur.

**Anomaly definitions:**
- **Dirty read** — read uncommitted data from another txn.
- **Non-repeatable read** — re-read a row, value changed (committed update).
- **Phantom read** — re-run a query, new rows appear (committed insert).
- **Serialization anomaly** — concurrent commits produce a result no serial order could.

**Senior notes:** Repeatable Read & Serializable can throw `40001 serialization_failure` → app **must retry**. Serializable uses SSI (predicate locks), not blocking, so it scales surprisingly well for OLTP but raises abort rate under contention. Read Committed re-reads the *latest* snapshot per statement — beware lost updates; use `SELECT ... FOR UPDATE` or `INSERT ... ON CONFLICT`.

---

## 5. Kafka Quick Reference

### Producer `acks`

| acks   | Durability                          | Latency | Risk                              |
|--------|-------------------------------------|---------|-----------------------------------|
| `0`    | none (fire and forget)              | lowest  | silent data loss                  |
| `1`    | leader only                         | medium  | loss if leader dies pre-replication|
| `all`/`-1` | all in-sync replicas (ISR)      | highest | none, if configured with min ISR ≥ 2|

### Durability config

- **ISR (In-Sync Replicas):** replicas caught up with the leader. Leader + ISR define the durable set.
- **`min.insync.replicas`:** with `acks=all`, write fails if ISR count drops below this. **Set to 2** with RF=3 → survive 1 broker loss, still reject writes when too few replicas (no silent under-replication).
- **Golden durability combo:** `replication.factor=3`, `min.insync.replicas=2`, `acks=all`, `unclean.leader.election.enable=false`.

### Delivery semantics

| Semantic        | How                                                                 |
|-----------------|---------------------------------------------------------------------|
| At-most-once    | commit offset *before* processing; no producer retries              |
| At-least-once   | commit *after* processing + producer retries (**default, dups possible**)|
| Exactly-once    | idempotent producer (`enable.idempotence=true`) + transactions, or idempotent consumers (dedup by key) |

### Partitions & consumer groups

- **More partitions** = more parallelism, but more open files, more rebalance cost, higher end-to-end latency, more controller load. Tune up when consumer lag grows and consumers are CPU/IO-bound — not preemptively.
- **Max useful consumers in a group = partition count.** Extra consumers sit idle.
- **Ordering is per-partition only.** Need ordering? Key by entity id (e.g. `order_id`) so all events for one entity land on one partition.
- A partition is consumed by **exactly one** consumer in a group at a time.
- Rebalances pause consumption — prefer cooperative/incremental rebalancing (`CooperativeStickyAssignor`).

---

## 6. HTTP Status Codes That Matter

| Code | Name                  | Use when                                                        |
|------|-----------------------|----------------------------------------------------------------|
| 200  | OK                    | Successful GET/PUT/PATCH with body                             |
| 201  | Created               | POST created a resource (return `Location` header)            |
| 202  | Accepted              | Async accepted, not yet processed (queued)                    |
| 204  | No Content            | Success, no body (DELETE, idempotent PUT)                     |
| 301/308| Moved Permanently   | Permanent redirect (308 preserves method/body)               |
| 302/307| Found / Temp Redirect| Temporary redirect (307 preserves method/body)               |
| 304  | Not Modified          | Conditional GET, `ETag`/`If-None-Match` matched              |
| 400  | Bad Request           | Malformed syntax / unparseable body                          |
| 401  | Unauthorized          | Missing/invalid auth (really "unauthenticated")              |
| 403  | Forbidden             | Authenticated but not permitted                              |
| 404  | Not Found             | Resource absent (or hide existence from unauthorized)        |
| 405  | Method Not Allowed    | Wrong verb on a valid resource                               |
| 409  | **Conflict**          | State conflict: duplicate, version mismatch, optimistic-lock fail|
| 410  | Gone                  | Resource permanently removed                                 |
| 422  | **Unprocessable Entity**| Syntactically valid but semantically invalid (validation)  |
| 429  | **Too Many Requests** | Rate limited (return `Retry-After`)                          |
| 500  | Internal Server Error | Unhandled server fault (don't leak internals)                |
| 502  | Bad Gateway           | Upstream returned invalid response                           |
| 503  | **Service Unavailable**| Overloaded / down / draining (return `Retry-After`)         |
| 504  | Gateway Timeout       | Upstream didn't respond in time                              |

**409 vs 422:** 409 = conflict with *current resource state* (versioning, uniqueness). 422 = the *payload itself* fails business validation. **429 vs 503:** 429 = *this client* exceeded its quota. 503 = the *server* can't serve anyone right now.

---

## 7. HTTP Method Semantics

| Method | Safe | Idempotent | Cacheable | Has body | Typical use                       |
|--------|------|------------|-----------|----------|-----------------------------------|
| GET    | Yes  | Yes        | Yes       | No       | Read a resource                   |
| HEAD   | Yes  | Yes        | Yes       | No       | Headers only                      |
| OPTIONS| Yes  | Yes        | No        | No       | Capabilities / CORS preflight     |
| POST   | No   | **No**     | Rarely    | Yes      | Create / non-idempotent action    |
| PUT    | No   | **Yes**    | No        | Yes      | Full replace / upsert at known URI|
| PATCH  | No   | **No**\*   | No        | Yes      | Partial update                    |
| DELETE | No   | **Yes**    | No        | Maybe    | Remove resource                   |

- **Safe** = no server-state change. **Idempotent** = N identical calls ≡ 1 call's effect.
- \* PATCH is not guaranteed idempotent, but can be designed to be (e.g. set-absolute-value semantics).
- **Senior tip:** Make POST idempotent with an **idempotency key** header when retries are possible (payments, order creation).

---

## 8. Go Concurrency Quick Patterns

```go
// Worker pool
jobs := make(chan Job); results := make(chan Result)
for i := 0; i < numWorkers; i++ {
    go func() { for j := range jobs { results <- process(j) } }()
}

// Fan-out / fan-in
// fan-out: launch N goroutines reading from one input chan
// fan-in: merge N output chans into one via a sync.WaitGroup + single out chan

// errgroup — bounded, first-error-cancels-context
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)                       // bound concurrency (1.23+)
for _, item := range items {
    item := item
    g.Go(func() error { return work(ctx, item) })
}
err := g.Wait()                     // returns first non-nil error

// Semaphore (bound concurrency without a pool)
sem := make(chan struct{}, maxConcurrent)
sem <- struct{}{}                   // acquire
go func() { defer func() { <-sem }(); work() }()

// select with timeout
select {
case res := <-ch:        use(res)
case <-time.After(2*time.Second): return ErrTimeout
case <-ctx.Done():       return ctx.Err()
}

// Pipeline cancellation: always pass ctx; check ctx.Done() in long loops.
```

**Rules:** the goroutine that creates a channel owns closing it; never close from the receiver side; `for range ch` exits when the channel is closed; a `nil` channel blocks forever (useful to disable a `select` case).

---

## 9. Go Performance Checklist

### Allocation reduction
- Preallocate: `make([]T, 0, n)`, `make(map[K]V, n)`.
- Reuse buffers with `sync.Pool` (for short-lived, frequently-allocated objects).
- `strings.Builder` instead of `+` in loops; `bytes.Buffer` for `[]byte`.
- Pass small structs by value; avoid pointers that force heap escape.
- Avoid `interface{}`/boxing in hot paths; watch escape analysis: `go build -gcflags=-m`.
- Prefer slices of structs over slices of pointers (better cache locality, fewer allocs).

### pprof commands

```bash
go test -bench=. -benchmem -cpuprofile cpu.out -memprofile mem.out
go tool pprof cpu.out          # interactive; top, list <fn>, web
go tool pprof -http=:8080 cpu.out
# live server (import _ "net/http/pprof")
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30   # CPU
go tool pprof http://localhost:6060/debug/pprof/heap                 # heap
go tool pprof http://localhost:6060/debug/pprof/allocs               # all allocs
curl localhost:6060/debug/pprof/goroutine?debug=2                    # goroutine dump
go tool trace trace.out        # scheduler/GC latency analysis
```

### GC / memory tuning
- **`GOGC`** (default 100): GC triggers when heap grows 100% since last GC. Higher (e.g. 200) = less CPU, more RAM. `GOGC=off` disables (dangerous).
- **`GOMEMLIMIT`** (1.19+): soft memory cap, e.g. `GOMEMLIMIT=4GiB`. Use it to avoid OOM-kills in containers; set it **below** the container limit (~80–90%). Pair with `GOGC=off` for a hard-cap-driven GC strategy in memory-constrained pods.
- **`GOMAXPROCS`**: set to container CPU quota (use `automaxprocs` lib) or you'll oversubscribe and thrash.

---

## 10. Redis Data Structures & Use Cases

| Type    | Core commands              | Use cases                                              |
|---------|----------------------------|--------------------------------------------------------|
| String  | GET/SET/INCR/SETEX         | cache, counters, rate limiter, sessions, distributed lock (`SET NX PX`)|
| Hash    | HSET/HGET/HGETALL          | object/record cache (fields), shopping cart            |
| List    | LPUSH/RPOP/LRANGE/BLPOP    | queues, recent items, simple job queue (use Streams instead for reliability)|
| Set     | SADD/SISMEMBER/SINTER      | tags, unique visitors, relationships, dedup            |
| Sorted Set (ZSet)| ZADD/ZRANGE/ZRANGEBYSCORE| leaderboards, priority queues, rate limiting windows, time-ordered feeds|
| Stream  | XADD/XREAD/XACK/XAUTOCLAIM | durable event log, consumer groups (Kafka-lite), at-least-once delivery|
| HyperLogLog| PFADD/PFCOUNT           | approximate unique counts (cardinality) at ~12 KB fixed|
| Bitmap  | SETBIT/BITCOUNT/BITOP      | daily active users, feature flags per-user, presence   |
| Geo     | GEOADD/GEOSEARCH           | nearby-search, location features                       |

**Senior notes:** Redis is single-threaded for commands — avoid O(n) commands (`KEYS`, big `SMEMBERS`) on large keys; use `SCAN`. Set TTLs to bound memory; pick an eviction policy (`allkeys-lru` for cache, `noeviction` for queues). For distributed locks across nodes, plain `SET NX` is fine for most cases; Redlock only when you truly need multi-master safety (and understand its caveats).

---

## 11. AWS Service Cheat-Map

| Category    | Need                              | Service                                  |
|-------------|-----------------------------------|------------------------------------------|
| Compute     | VMs                               | EC2                                      |
|             | Containers (managed)              | ECS (Fargate = serverless), EKS (k8s)    |
|             | Functions                         | Lambda                                   |
| Storage     | Object storage                    | S3                                       |
|             | Block storage (disks)             | EBS                                      |
|             | Shared file system                | EFS                                      |
|             | Archive                           | S3 Glacier                               |
| Database    | Managed relational (Postgres)     | RDS / Aurora (Postgres-compatible)       |
|             | Key-value / wide-column           | DynamoDB                                 |
|             | In-memory cache                   | ElastiCache (Redis/Memcached)            |
|             | Data warehouse                    | Redshift                                 |
| Messaging   | Pub/sub fan-out                   | SNS                                      |
|             | Queue (point-to-point)            | SQS (FIFO for ordering/dedup)            |
|             | Managed Kafka                     | MSK                                      |
|             | Event bus / routing               | EventBridge                              |
|             | Streaming                         | Kinesis Data Streams                     |
| Networking  | DNS                               | Route 53                                 |
|             | CDN                               | CloudFront                               |
|             | Load balancer                     | ALB (L7) / NLB (L4)                      |
|             | Private network                   | VPC                                      |
|             | API front door                    | API Gateway                              |
| Ops/Security| Secrets                           | Secrets Manager / SSM Parameter Store    |
|             | Identity/permissions              | IAM                                      |
|             | Metrics/logs/alarms               | CloudWatch                               |
|             | Tracing                           | X-Ray                                    |

**E-commerce mapping (this role):** ALB → ECS/Fargate Go services → RDS Aurora Postgres + ElastiCache Redis; MSK for the event backbone; S3 for assets/exports; SNS+SQS or EventBridge for fan-out notifications; Secrets Manager for credentials; CloudWatch + X-Ray for observability.

---

## 12. The Nines (Availability → Downtime)

| Availability | "Nines"   | Downtime / year | Downtime / month | Downtime / day |
|--------------|-----------|-----------------|------------------|----------------|
| 90%          | one nine  | 36.5 days       | ~73 hours        | 2.4 hours      |
| 99%          | two nines | 3.65 days       | ~7.2 hours       | 14.4 min       |
| 99.9%        | three nines| 8.76 hours     | ~43.8 min        | 1.44 min       |
| 99.95%       |           | 4.38 hours      | ~21.9 min        | 43 sec         |
| 99.99%       | four nines| 52.6 min        | ~4.38 min        | 8.6 sec        |
| 99.999%      | five nines| 5.26 min        | ~26.3 sec        | 0.86 sec       |

**Senior note:** Each nine roughly costs an order of magnitude more (redundancy, multi-AZ → multi-region, automation). Tie targets to an **error budget**: 99.9% = ~43 min/month of allowed downtime to spend on risky deploys.

---

## 13. gRPC vs REST — Quick Decision

| Dimension            | gRPC                                  | REST/JSON over HTTP                  |
|----------------------|---------------------------------------|--------------------------------------|
| Wire format          | Protobuf (binary, compact)            | JSON (text, verbose, human-readable) |
| Transport            | HTTP/2 (multiplexed, streaming)       | HTTP/1.1 or /2                       |
| Contract             | Strongly typed `.proto`, codegen      | OpenAPI/Swagger (optional)           |
| Streaming            | Native (uni + bidirectional)          | SSE / WebSocket bolt-ons             |
| Browser support      | Needs grpc-web proxy                  | Native everywhere                    |
| Performance          | Higher throughput, lower latency      | Higher overhead                      |
| Debuggability        | Needs tooling (grpcurl)               | curl / browser friendly              |
| Best for             | **Internal service-to-service**, low-latency, polyglot, streaming | **Public/external APIs**, browser clients, broad compatibility |

**Rule of thumb:** gRPC inside the mesh (Go service ↔ Go service), REST at the edge (public API, partner integrations, mobile).

---

## 14. SQL EXPLAIN — Scan & Join Types (PostgreSQL)

### Scan types (cheapest → most expensive, context-dependent)

| Node            | Meaning                                                  | Good/Bad                                   |
|-----------------|----------------------------------------------------------|--------------------------------------------|
| Index Only Scan | Answered entirely from index (covering index)            | Best                                       |
| Index Scan      | Walk index, then fetch matching rows from heap           | Good for selective predicates              |
| Bitmap Index/Heap Scan| Build a bitmap of matches, then fetch heap pages   | Good for medium selectivity / multiple indexes|
| Seq Scan        | Read the whole table                                     | Fine for small tables / low selectivity; **bad** if it should've used an index|

### Join types

| Node              | How it works                                  | Best when                              |
|-------------------|-----------------------------------------------|----------------------------------------|
| Nested Loop       | For each outer row, probe inner               | Small outer + indexed inner            |
| Hash Join         | Build hash table on one side, probe with other| Large unsorted equi-joins              |
| Merge Join        | Sort both inputs, merge                        | Both inputs already sorted / large     |

### What to look for in `EXPLAIN ANALYZE`

- **`rows` estimate vs `actual rows`** wildly off → stale stats; run `ANALYZE`.
- **`Seq Scan` on a big table** with a selective `WHERE` → missing/unused index.
- **`Rows Removed by Filter`** high → index not selective enough; consider composite/partial index.
- **`loops=N`** large on a Nested Loop → likely the wrong join strategy (bad estimates).
- **Sort / Hash spilling to disk** (`external merge Disk: …kB`) → raise `work_mem` or reduce rows earlier.
- Always use `EXPLAIN (ANALYZE, BUFFERS)` to see real I/O, and `BUFFERS` to spot cache misses.
