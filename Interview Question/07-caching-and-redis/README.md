# Caching & Redis

> Senior-level Go backend interview questions on caching strategies, invalidation, failure modes, eviction, Redis data structures and patterns, persistence, and scaling.

**28 questions** across **10 topics** · Level: senior

## Topics

- [Caching Strategies](#caching-strategies) (4)
- [Cache Invalidation & Consistency](#cache-invalidation-consistency) (3)
- [Cache Failure Modes](#cache-failure-modes) (4)
- [Eviction Policies](#eviction-policies) (2)
- [Redis Data Structures](#redis-data-structures) (3)
- [Redis Patterns](#redis-patterns) (5)
- [Persistence & Durability](#persistence-durability) (1)
- [Scaling & Architecture](#scaling-architecture) (3)
- [Expiry & Memory](#expiry-memory) (1)
- [Choosing the Right Tool](#choosing-the-right-tool) (2)

---

## Caching Strategies

#### 1. Walk through the cache-aside (lazy loading) pattern. Where exactly does the read and write logic live, and what is its principal weakness?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `cache-aside`, `lazy-loading`, `patterns`

In **cache-aside**, the application owns the cache logic, not the cache. On read: check the cache; on a miss, load from the database, populate the cache, and return. On write: update the database and **invalidate** (or update) the cache entry. The cache is a passive store. Its strengths are simplicity and resilience: a cache outage degrades to direct DB reads. Its principal weakness is the read-miss penalty (every cold key pays a DB round-trip) plus a subtle race: two concurrent requests can interleave a DB write and a stale cache populate, leaving a stale value cached. It also couples every call site to cache plumbing unless wrapped in a repository. Most production caches use cache-aside because it keeps the cache out of the write path's critical correctness loop.

**Key points**
- Application controls cache; cache is passive
- Read: miss -> load DB -> populate cache
- Write: update DB then invalidate/update cache
- Resilient: cache down -> reads fall through to DB
- Weakness: cold-miss latency + stale-populate race on concurrent write


```go
func (r *UserRepo) Get(ctx context.Context, id string) (*User, error) {
    key := "user:" + id
    if b, err := r.rdb.Get(ctx, key).Bytes(); err == nil {
        var u User
        if json.Unmarshal(b, &u) == nil {
            return &u, nil // cache hit
        }
    }
    u, err := r.db.LoadUser(ctx, id) // miss -> source of truth
    if err != nil {
        return nil, err
    }
    if b, err := json.Marshal(u); err == nil {
        r.rdb.Set(ctx, key, b, 5*time.Minute) // populate w/ TTL
    }
    return u, nil
}
```

**Follow-ups**
- How would you close the stale-populate race?
- Why invalidate rather than write-through update on write?

---

#### 2. Contrast read-through and write-through caching with cache-aside. When does putting the cache in the data path actually help?

*Difficulty:* 🟡 medium  ·  *Tags:* `read-through`, `write-through`, `patterns`

**Read-through** and **write-through** move the DB access into the cache layer (a library or a cache proxy), so the application talks only to the cache. Read-through: the cache loads from the DB on a miss itself. Write-through: every write goes to the cache, which synchronously writes to the DB before acknowledging. Versus cache-aside, the win is a single, centralized place for load/store logic and consistency rules, eliminating per-call-site duplication and reducing the stale-populate race. The cost: the cache is now on the critical path, so a cache outage breaks writes (unless you fall back), and write-through adds latency since each write pays cache + DB. It helps when you have many call sites, want uniform consistency semantics, and can tolerate the cache being a hard dependency, e.g. a caching library/DAO layer or a system like a CDN/edge cache. For most Go services, cache-aside in a repository is preferred for its failure isolation.

**Key points**
- Read/write-through: cache is in the data path, app talks only to cache
- Centralizes load/store logic; fewer races and duplication
- Write-through: synchronous cache+DB write -> higher write latency
- Cache becomes a hard dependency; outage can break writes
- Cache-aside preferred when failure isolation matters most

**Follow-ups**
- How do you keep write-through writes atomic across cache and DB?
- Why is write-through often paired with read-through?

---

#### 3. Explain write-back (write-behind) and write-around. What durability and consistency risks do they introduce?

*Difficulty:* 🟡 medium  ·  *Tags:* `write-back`, `write-behind`, `write-around`, `durability`

**Write-back / write-behind**: writes hit the cache and are acknowledged immediately, then flushed to the DB asynchronously (batched/coalesced). It gives the lowest write latency and absorbs write bursts, and can coalesce repeated writes to the same key. The risk is **data loss**: if the cache node dies before the flush, acknowledged writes vanish, and readers on other paths see stale DB data. You need durable buffering (e.g. an append log) to make it safe. **Write-around**: writes go straight to the DB and bypass the cache; the cache is populated only on subsequent reads. This avoids polluting the cache with write-heavy, rarely-read data, but the just-written key is a guaranteed cache miss on the next read, and a stale entry may linger if you didn't invalidate. Choose write-back for write-heavy throughput with loss tolerance; write-around for write-once/read-rarely data.

**Key points**
- Write-back: ack at cache, async batched flush to DB -> lowest latency
- Write-back risk: lost acked writes on cache crash; needs durable buffer
- Write-back can coalesce repeated writes to a hot key
- Write-around: write to DB, skip cache; avoids cache pollution
- Write-around: next read is a miss; stale entry if not invalidated

**Follow-ups**
- How would you make write-back crash-safe?
- Which pattern fits a metrics ingestion counter?

---

#### 4. How do you choose a TTL? Discuss the trade-offs and when a short TTL is no substitute for invalidation.

*Difficulty:* 🟡 medium  ·  *Tags:* `ttl`, `staleness`, `freshness`

TTL bounds the maximum staleness window and provides eventual self-healing: even if invalidation logic has a bug, every entry expires and refetches. Choosing it balances **staleness tolerance vs. backend load**. Short TTL -> fresher data but more cache misses and DB load (and more stampede risk). Long TTL -> cheaper but staler. Drive it from the business freshness requirement (a product price might tolerate 60s; a feature flag maybe 5s; an immutable asset hours/days). Critically, a short TTL is **not** a substitute for explicit invalidation: it still serves stale data for the whole TTL window after an update, and shrinking the TTL to compensate just multiplies backend load. Best practice: explicit invalidation on writes for correctness, plus a TTL as a safety net for missed invalidations and as a stampede control via jitter. Also distinguish absolute TTL from sliding/refresh-ahead semantics.

**Key points**
- TTL = max staleness bound + self-healing safety net
- Short TTL: fresh but more misses/DB load; long TTL: cheap but stale
- Derive TTL from business freshness requirement per key class
- TTL is not a replacement for invalidation on writes
- Add jitter to TTLs to avoid synchronized expiry (avalanche)

**Follow-ups**
- How does TTL jitter prevent avalanche?
- When is an infinite TTL with explicit invalidation correct?

---

## Cache Invalidation & Consistency

#### 5. Why is cache invalidation famously hard? Frame it in terms of staleness vs. consistency and the dual-write problem.

*Difficulty:* 🟠 hard  ·  *Tags:* `invalidation`, `consistency`, `dual-write`

Invalidation is hard because the cache and the source of truth are two independent systems with no shared transaction, so any update is a **dual write** that can partially fail or interleave. If you update the DB then delete the cache and the delete fails (or the process crashes between them), you serve stale data until TTL. Concurrency makes it worse: a reader can fetch the old DB value, then a writer commits a new value and deletes the cache, then the reader populates the cache with the *old* value, persisting staleness. There is no perfect ordering of (DB write, cache op) that is race-free under concurrency without extra coordination. So you trade **strong consistency** (expensive: locks, versioning, or transactional outbox) against **bounded staleness** (cheap: TTL + best-effort invalidation). Most systems accept eventual consistency: delete-on-write plus a TTL safety net, and design reads to tolerate brief staleness.

**Key points**
- Cache + DB are separate systems with no shared transaction (dual write)
- Partial failure between DB write and cache op -> stale data
- Read-populate can race a write-delete and re-cache stale value
- No race-free ordering without extra coordination
- Practical answer: bounded staleness (TTL + delete) over strong consistency

**Follow-ups**
- Walk through the classic read-populate vs. write-delete race timeline.
- How does a transactional outbox help here?

---

#### 6. Compare cache invalidation approaches: delete-on-write vs. update-on-write vs. TTL-only vs. versioned keys. Which do you default to and why?

*Difficulty:* 🟠 hard  ·  *Tags:* `invalidation`, `versioning`, `ttl`

**Delete-on-write** (invalidate): on a DB write, delete the key so the next read repopulates. Simple and avoids caching computed-but-stale values; downside is a guaranteed miss after every write and the read/write race. **Update-on-write**: write the new value into the cache directly. Saves a miss but is racy (concurrent writers can land out of order) and wasteful if the key is rarely read. **TTL-only**: never explicitly invalidate; rely on expiry. Cheapest, but staleness is unbounded up to the TTL. **Versioned / key-namespaced**: embed a version or generation in the key (e.g. `user:123:v7`); a write bumps the version, instantly orphaning all old entries without scanning. Great for invalidating derived/aggregate keys atomically. My default is **delete-on-write + TTL safety net**: correctness from the delete, resilience from the TTL when a delete is missed. For derived data with many dependent keys, I prefer versioned keys.

**Key points**
- Delete-on-write: simple, avoids caching stale derived values, but races + extra miss
- Update-on-write: saves a miss but ordering races and wasted writes
- TTL-only: cheapest, unbounded staleness up to TTL
- Versioned keys: bump a generation to invalidate many keys atomically
- Default: delete-on-write + TTL; versioned keys for derived/aggregate data

**Follow-ups**
- How do versioned keys interact with memory and eviction?
- When would you update-on-write instead of delete?

---

#### 7. Should you delete the cache before or after the DB write? Explain the race in each ordering and how delayed double-delete helps.

*Difficulty:* 🔴 staff  ·  *Tags:* `invalidation`, `double-delete`, `race-conditions`, `cdc`

**Delete-then-write-DB**: a concurrent reader can miss, read the *old* DB value (write hasn't landed), then repopulate the cache with stale data after your delete — stale until TTL. **Write-DB-then-delete** (the common choice) is safer but still races: reader R reads old DB, then writer W commits new DB + deletes cache, then R populates with old value. Window is small (read-then-populate gap) but real. A mitigation is **delayed double-delete**: delete the cache, write the DB, then asynchronously delete again after a short delay (longer than the populate window). The second delete evicts any stale value a racing reader re-cached. It is best-effort, not a guarantee. Stronger fixes: serialize per-key with a lock, use versioned keys, or subscribe to the DB change log (CDC/binlog) so invalidation happens after the commit is durable and ordered. Pick the strength based on how costly staleness is.

**Key points**
- Delete-then-write: racing reader re-caches old value before write lands
- Write-then-delete: smaller race in read-populate gap; the usual default
- Delayed double-delete: second async delete evicts re-cached stale value
- Double-delete is best-effort, not a correctness guarantee
- Stronger: per-key lock, versioned keys, or CDC-driven invalidation


```go
func (s *Svc) Update(ctx context.Context, u *User) error {
    key := "user:" + u.ID
    s.rdb.Del(ctx, key)                 // 1) first delete
    if err := s.db.Save(ctx, u); err != nil {
        return err                       // 2) source of truth
    }
    s.rdb.Del(ctx, key)                 // 3) immediate delete
    time.AfterFunc(500*time.Millisecond, func() {
        s.rdb.Del(context.Background(), key) // 4) delayed double-delete
    })
    return nil
}
```

**Follow-ups**
- How do you pick the double-delete delay?
- Why is CDC-based invalidation more correct than app-level deletes?

---

## Cache Failure Modes

#### 8. What is a cache stampede (thundering herd)? Enumerate the standard mitigations and their trade-offs.

*Difficulty:* 🟠 hard  ·  *Tags:* `stampede`, `thundering-herd`, `singleflight`, `jitter`

A **stampede** happens when a hot key expires (or the cache is cold) and many concurrent requests all miss simultaneously, hammering the backend with duplicate, expensive recomputations — often overwhelming the DB and cascading. Mitigations: (1) **Request coalescing / single-flight** — only one in-flight load per key per process; others wait and share the result (Go's `singleflight`). Cheap and effective per-instance, but doesn't dedupe across instances. (2) **Distributed lock** — first miss acquires a Redis lock, recomputes, others briefly wait or serve stale; adds latency and lock-management complexity. (3) **Early / probabilistic recompute (XFetch)** — refresh the value *before* expiry with a probability that rises as TTL approaches, so the herd never forms. (4) **TTL jitter** — randomize expiry so keys don't expire in lockstep. (5) **Stale-while-revalidate** — serve the stale value while one worker refreshes. Combine singleflight + jitter + SWR for most read paths.

**Key points**
- Hot key expiry -> many simultaneous misses -> duplicate expensive recomputes
- Single-flight / coalescing: one load per key per instance (Go singleflight)
- Distributed lock: cross-instance dedupe, adds latency + lock handling
- Probabilistic early recompute (XFetch) refreshes before expiry
- TTL jitter + stale-while-revalidate smooth the herd


```go
var g singleflight.Group

func (s *Svc) Get(ctx context.Context, id string) (*User, error) {
    if b, err := s.rdb.Get(ctx, "user:"+id).Bytes(); err == nil {
        return decode(b)
    }
    v, err, _ := g.Do("user:"+id, func() (any, error) { // coalesce misses
        u, err := s.db.LoadUser(ctx, id)
        if err != nil {
            return nil, err
        }
        b, _ := json.Marshal(u)
        ttl := 5*time.Minute + time.Duration(rand.Intn(60))*time.Second // jitter
        s.rdb.Set(ctx, "user:"+id, b, ttl)
        return u, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

**Follow-ups**
- How does XFetch decide when to recompute early?
- Why isn't singleflight alone enough in a multi-pod deployment?

---

#### 9. Explain cache penetration. How do null caching and Bloom filters defend against it, and what are their downsides?

*Difficulty:* 🟠 hard  ·  *Tags:* `penetration`, `null-caching`, `bloom-filter`, `security`

**Cache penetration** is when requests target keys that *don't exist* in the DB at all — so every request misses the cache, hits the DB, finds nothing, and caches nothing, leaving the DB exposed. It's often an attack: an adversary requests random non-existent IDs to bypass the cache. Defenses: (1) **Null caching** — cache a sentinel 'not found' marker with a *short* TTL so repeated lookups for the same missing key are absorbed. Downside: memory bloat from many distinct bogus keys and a brief window where a real insert is masked by the cached null. (2) **Bloom filter** — keep a probabilistic set of all existing keys; check it before touching the cache/DB. A negative is definitive (key absent -> reject instantly); a positive may be false (small DB cost). Downsides: no deletion in a plain Bloom filter, must be rebuilt/kept in sync with the keyspace, and false positives still allow some misses. Combine: Bloom filter to reject most bogus keys, null caching for the rest, plus input validation/rate limiting.

**Key points**
- Penetration: requests for non-existent keys always miss -> DB exposed
- Often malicious (random IDs to bypass cache)
- Null caching: short-TTL sentinel for misses; risks memory bloat + masking inserts
- Bloom filter: definitive negatives reject bogus keys before DB
- Bloom limits: no delete, must stay in sync, false positives remain

**Follow-ups**
- Why a *short* TTL for null entries?
- How would you handle deletes with a Bloom filter (counting/cuckoo)?

---

#### 10. What is a cache avalanche, and how is it different from a stampede? How do you prevent it?

*Difficulty:* 🟡 medium  ·  *Tags:* `avalanche`, `ttl-jitter`, `high-availability`, `degradation`

A **cache avalanche** is large-scale, near-simultaneous expiry of *many different keys* (or a full cache node going down), causing a sudden flood of misses that overwhelms the backend all at once. A **stampede** is the same idea for a *single hot key*; avalanche is the population-wide version. Common cause: bulk-loading many keys with the same TTL (e.g. warming the cache at startup), so they all expire together. Prevention: (1) **TTL jitter** — add a random spread to TTLs so expiries desynchronize. (2) **Tiered/multi-level caching** (local L1 + Redis L2) so an L2 blip doesn't fully hit the DB. (3) **Graceful degradation** — circuit breakers and load shedding so the DB isn't crushed; serve stale or shed low-priority traffic. (4) **High availability** for the cache (replication/Sentinel/Cluster) so node failure doesn't drop the whole keyspace. (5) Request coalescing per key to bound concurrent recomputes. Jitter is the cheapest and most impactful first move.

**Key points**
- Avalanche: many keys expire (or cache node dies) at once -> backend flood
- Stampede is single-hot-key; avalanche is population-wide
- Root cause often: bulk warm-up with identical TTLs
- TTL jitter desynchronizes expiry (primary fix)
- Tiered cache + HA + circuit breakers/load shedding limit blast radius

**Follow-ups**
- How much jitter is enough?
- How does an L1 in-process cache help during an L2 outage?

---

#### 11. What problems do hot keys cause in Redis, and how do you mitigate a single extremely hot key?

*Difficulty:* 🔴 staff  ·  *Tags:* `hot-keys`, `redis-cluster`, `sharding`, `single-threaded`

A **hot key** is one accessed disproportionately (a celebrity profile, a viral product, a global config). In Redis Cluster a key maps to one hash slot on one node, so a hot key concentrates load on a single shard's CPU/network and cannot be spread by adding shards — it creates a hotspot that caps throughput and risks that node. Mitigations: (1) **Local (L1) caching** in the app process with a very short TTL, so most reads never reach Redis — the highest-leverage fix for read-hot keys. (2) **Key replication / sharding the value** — store N copies (`key#0..#N`) across slots and read a random replica, spreading load (at the cost of N-way invalidation). (3) **Read replicas** for read-hot keys. (4) For write-hot counters, **shard the counter** into sub-counters and sum on read, or batch increments. (5) Detect hot keys via `redis-cli --hotkeys`, MONITOR sampling, or `OBJECT FREQ` with LFU. The single-threaded model means one hot key can saturate a whole core.

**Key points**
- Hot key maps to one slot/node; can't be spread by adding shards
- Single-threaded model: one hot key can saturate a core
- L1 in-process cache absorbs most reads (best read fix)
- Replicate/shard the value across slots; read random replica
- Shard hot counters; read replicas; detect via --hotkeys/OBJECT FREQ

**Follow-ups**
- Why doesn't adding cluster nodes fix a single hot key?
- What's the invalidation cost of value replication?

---

## Eviction Policies

#### 12. Compare LRU and LFU as eviction policies. When does LFU clearly win, and what does Redis's approximated LRU/LFU actually do?

*Difficulty:* 🟡 medium  ·  *Tags:* `lru`, `lfu`, `eviction`, `cache-pollution`

**LRU** evicts the least-recently-used entry — great when access has temporal locality (recently used implies soon-to-be-used). Its weakness is **cache pollution**: a one-time bulk scan (e.g. a batch job touching many keys) evicts genuinely hot entries simply because they weren't touched most recently. **LFU** evicts the least-*frequently*-used, so a brief scan can't dislodge a key that's popular over time; it wins for skewed, stable popularity distributions. LFU's risk is staleness — an old key that was once very popular can linger — so Redis's LFU uses a probabilistic counter (8-bit, logarithmically incremented) plus a **decay** so frequency ages out. Redis doesn't do exact LRU/LFU (too costly); it **samples** `maxmemory-samples` keys (default 5) and evicts the best candidate among them — an approximation that trades a little accuracy for O(1) memory and speed. Higher sample counts approach true LRU/LFU at more CPU cost.

**Key points**
- LRU: temporal locality; vulnerable to scan-based cache pollution
- LFU: frequency-based; resists one-time scans, fits skewed popularity
- LFU risk: stale once-popular keys -> Redis decays the frequency counter
- Redis approximates via random sampling (maxmemory-samples), not exact
- More samples -> closer to true policy, more CPU

**Follow-ups**
- Why does Redis sample instead of maintaining a true LRU list?
- How does the LFU decay/counter (OBJECT FREQ) work?

---

#### 13. Walk through Redis maxmemory-policy options. What's the difference between allkeys-* and volatile-*, and when is noeviction dangerous?

*Difficulty:* 🟡 medium  ·  *Tags:* `maxmemory-policy`, `eviction`, `allkeys`, `volatile`

`maxmemory` sets a memory cap; `maxmemory-policy` decides what happens when it's reached. The **allkeys-** family (`allkeys-lru`, `allkeys-lfu`, `allkeys-random`) considers *every* key for eviction — correct when Redis is used purely as a cache and any key may be dropped. The **volatile-** family (`volatile-lru`, `volatile-lfu`, `volatile-random`, `volatile-ttl`) only evicts keys that have a TTL set, leaving persistent (no-TTL) keys untouched — useful when you mix durable data and cache data in one instance, but it can run out of evictable keys and then fail writes. `volatile-ttl` evicts the soonest-to-expire first. **noeviction** (the default) returns errors on writes once full instead of dropping data — safe for a durable datastore but dangerous for a cache, because under memory pressure your *writes start failing* (OOM-command errors) and the app breaks. For a cache, use `allkeys-lru` or `allkeys-lfu`; for mixed/durable use, be deliberate about volatile-* and monitor evictable headroom.

**Key points**
- maxmemory cap + policy governs behavior when full
- allkeys-*: any key evictable -> pure-cache use
- volatile-*: only TTL keys evictable -> mixed durable+cache use
- volatile-ttl evicts soonest-expiring first; can exhaust evictable keys
- noeviction: writes error when full -> safe for store, dangerous for cache

**Follow-ups**
- What happens if volatile-lru runs out of keys with TTLs?
- Which policy for a session store vs. a read cache?

---

## Redis Data Structures

#### 14. Give a senior-level tour of the core Redis data structures and a real use case for each: strings, hashes, lists, sets, sorted sets, bitmaps, HyperLogLog, geo.

*Difficulty:* 🟡 medium  ·  *Tags:* `data-structures`, `zset`, `hyperloglog`, `bitmaps`, `geo`

**Strings**: bytes up to 512MB; caching serialized objects, counters (`INCR`), atomic flags, distributed locks. **Hashes**: field-value maps; storing an object's fields without serializing the whole thing (`HSET user:1 name ...`), efficient partial updates and memory-efficient for small objects (ziplist encoding). **Lists**: linked lists; simple queues/stacks (`LPUSH`/`BRPOP`), recent-activity feeds. **Sets**: unordered unique members; tags, unique visitors, set algebra (`SINTER` for common followers). **Sorted sets (ZSET)**: members ordered by score; **leaderboards**, rate-limiter sliding windows (score=timestamp), priority queues, time-series indexes — O(log n) inserts and range queries. **Bitmaps**: bit ops on strings; compact boolean/feature tracking (daily active users via `SETBIT userid`), `BITCOUNT`. **HyperLogLog**: probabilistic cardinality in ~12KB with ~0.81% error; unique-count at scale (UVs) where exact sets would be huge. **Geo**: geospatial indexes (built on ZSETs) for radius/nearest queries (`GEOADD`/`GEOSEARCH`). Picking the right structure is often the difference between O(log n) and O(n) and between KBs and GBs.

**Key points**
- Strings: objects, counters, locks (INCR/SETNX)
- Hashes: object fields w/ partial update; memory-efficient small objects
- Lists: queues/stacks/feeds (LPUSH/BRPOP)
- Sets: uniqueness + set algebra (SINTER/SUNION)
- ZSET: leaderboards, sliding windows, priority queues (O(log n))
- Bitmaps: compact booleans (DAU); HLL: approx cardinality in ~12KB; Geo: radius queries

**Follow-ups**
- Why might a small hash use less memory than many string keys?
- What accuracy/error does HyperLogLog trade for its tiny footprint?

---

#### 15. Design a leaderboard with Redis sorted sets. How do you get a user's rank, a top-N page, and handle ties and very large boards?

*Difficulty:* 🟠 hard  ·  *Tags:* `leaderboard`, `zset`, `ranking`, `sharding`

Model the leaderboard as a single **ZSET** with score = points and member = user ID. Update with `ZADD board 1500 user:42` (or `ZINCRBY` for deltas). Top-N descending: `ZREVRANGE board 0 9 WITHSCORES` (page p: offsets `p*10 .. p*10+9`). A user's rank: `ZREVRANK board user:42` (0-based) — both are O(log n) / O(log n + m). **Ties**: ZSET orders equal scores lexicographically by member, which is arbitrary for ranking; to break ties by time, encode a composite score (e.g. `points * 1e10 - timestamp`) so earlier achievers rank higher while staying numerically sortable, or use ZSET's lexicographic ordering deliberately. **Very large boards**: a global ZSET with tens of millions of members is fine for reads but rank pagination deep into the set and memory can grow; shard by segment (region/tier) and merge, snapshot periodically to a durable store, or keep only a top-K leaderboard plus an approximate rank for the long tail. For time-windowed boards (daily/weekly), use per-window keys with TTLs and union on read.

**Key points**
- ZSET: score=points, member=userID; ZADD/ZINCRBY to update
- Top-N: ZREVRANGE WITHSCORES; rank: ZREVRANK (O(log n))
- Ties: composite score (points*K - timestamp) for deterministic order
- Scale: shard by segment, snapshot, or top-K + approximate tail
- Time windows: per-window keys with TTL, union on read


```go
// Update score and read rank + a page
rdb.ZIncrBy(ctx, "board:weekly", 50, "user:42")
// 0-based rank, highest score = rank 0
rank, _ := rdb.ZRevRank(ctx, "board:weekly", "user:42").Result()
// Top 10
top, _ := rdb.ZRevRangeWithScores(ctx, "board:weekly", 0, 9).Result()
// Tie-break: encode composite score points*1e10 - tsMillis at write time
```

**Follow-ups**
- How do you implement a weekly leaderboard that resets?
- What's the memory cost of a 50M-member ZSET and how to bound it?

---

#### 16. Redis Streams vs. Lists vs. Pub/Sub for a queue. When do you reach for Streams, and what do consumer groups give you?

*Difficulty:* 🟠 hard  ·  *Tags:* `streams`, `pub-sub`, `lists`, `consumer-groups`, `queue`

**Pub/Sub** is fire-and-forget: messages go only to currently-connected subscribers, with no persistence, no replay, no ack — a subscriber that's down misses everything. Good for live fan-out (notifications), bad as a reliable queue. **Lists** (`LPUSH`/`BRPOP`) give a durable, persisted queue with blocking pops, but no consumer groups, no per-message acks, and a popped message is gone — if the worker crashes mid-processing, the message is lost unless you use the reliable-queue `BRPOPLPUSH` pattern. **Streams** are an append-only log with persistent, ID-ordered entries and **consumer groups**: multiple consumers share a group, each message is delivered to exactly one group member, messages must be **acked** (`XACK`), and unacked messages sit in the Pending Entries List (PEL) so you can detect stuck consumers and reclaim with `XCLAIM`/`XAUTOCLAIM`. You also get replay from any ID, at-least-once delivery, and backpressure visibility (`XLEN`, lag). Reach for Streams when you need a durable work queue with load-balanced consumers, acks, retries, and replay — i.e. Kafka-lite semantics inside Redis.

**Key points**
- Pub/Sub: ephemeral fan-out, no persistence/ack/replay
- Lists: durable FIFO, blocking pops, but no groups/acks (loss on crash)
- Streams: append-only log, IDs, persistence, replay from any ID
- Consumer groups: one-of-N delivery, XACK, PEL for unacked, XCLAIM to recover
- Use Streams for reliable, load-balanced, at-least-once work queues


```go
// Producer
rdb.XAdd(ctx, &redis.XAddArgs{Stream: "jobs", Values: map[string]any{"id": 42}})
// Consumer in a group (creates group once with XGroupCreateMkStream)
res, _ := rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
    Group: "workers", Consumer: "w1", Streams: []string{"jobs", ">"}, Count: 10, Block: 5 * time.Second,
}).Result()
// process... then ack
rdb.XAck(ctx, "jobs", "workers", msgID)
// Reclaim stuck messages from dead consumers
rdb.XAutoClaim(ctx, &redis.XAutoClaimArgs{Stream: "jobs", Group: "workers", Consumer: "w1", MinIdle: time.Minute, Start: "0"})
```

**Follow-ups**
- How do you cap a stream's memory growth (MAXLEN/trimming)?
- How do you achieve at-least-once vs. effectively-once with Streams?

---

## Redis Patterns

#### 17. Implement a correct distributed lock on a single Redis. Why must you use SET NX PX with a random token plus a Lua release, and what is the fencing-token problem?

*Difficulty:* 🔴 staff  ·  *Tags:* `distributed-lock`, `setnx`, `fencing-token`, `lua`

Acquire with a single atomic command: `SET lock:resource <token> NX PX 30000` — `NX` makes it acquire-only-if-absent, `PX` sets an expiry so a crashed holder's lock auto-releases (no deadlock). The **token** must be a unique random value per acquisition. Release must **not** be a plain `DEL`: if your operation overran the TTL, the lock may already have expired and been re-acquired by someone else, and a naive `DEL` would delete *their* lock. So release is a Lua script that checks the token matches before deleting (compare-and-delete, atomic). The deeper, unfixable-at-the-lock-layer issue is the **fencing-token problem**: any TTL-based lock can expire mid-operation (GC pause, slow I/O) while you still believe you hold it, so two clients can act concurrently. The robust fix is a **monotonically increasing fencing token** returned on acquire and *checked by the protected resource*, which rejects writes carrying a stale token. The lock alone cannot guarantee mutual exclusion against pauses — only the downstream resource enforcing fencing can.

**Key points**
- Acquire atomically: SET key token NX PX ttl (NX = mutual exclusion, PX = no deadlock)
- Unique random token per acquisition
- Release via Lua compare-and-delete; never plain DEL (could delete another holder's lock)
- TTL locks can expire mid-op (GC/pause) -> two holders
- Fencing token: monotonic counter checked by the resource is the real safety mechanism


```go
// Acquire
token := uuid.NewString()
ok, _ := rdb.SetNX(ctx, "lock:order:1", token, 30*time.Second).Result()
if !ok { /* not acquired */ }

// Safe release: only delete if token still matches (atomic)
var release = redis.NewScript(`
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end`)
release.Run(ctx, rdb, []string{"lock:order:1"}, token)

// Fencing: resource must reject writes with a token <= last seen
```

**Follow-ups**
- Why does a naive DEL on release cause a correctness bug?
- Where exactly is the fencing token validated?

---

#### 18. What is Redlock and why is it controversial? Would you use it, and what's your default for a distributed lock?

*Difficulty:* 🔴 staff  ·  *Tags:* `redlock`, `distributed-lock`, `fencing`, `consensus`

**Redlock** is an algorithm (Antirez) to make Redis locks safer across multiple independent masters (typically 5): acquire the same lock on a majority within a small time bound, and you 'hold' it only if you got a quorum with time to spare. It removes the single-master failure point. The controversy is Martin Kleppmann's critique: Redlock relies on bounded clocks and bounded pauses, but **GC pauses, clock jumps, and network delays are not bounded**, so a client can believe it holds the lock after it has expired — Redlock provides *no fencing token*, so it can't prevent two clients from acting. Antirez countered on the timing assumptions, but the consensus is: Redlock is fine for **efficiency** locks (avoid duplicate work, where a rare double-execution is merely wasteful) but **not sufficient for correctness** locks (where double execution corrupts data). My default: for efficiency, a single-Redis `SET NX PX` lock (with HA via Sentinel) is simpler and adequate; for correctness, don't trust any TTL lock alone — require fencing tokens enforced by the resource, or use a real consensus system (ZooKeeper/etcd) that provides them.

**Key points**
- Redlock: quorum-acquire across N independent masters to avoid single point of failure
- Kleppmann: unbounded pauses/clock skew break its safety; no fencing token
- OK for efficiency locks (dedupe work), unsafe for correctness locks
- Default: single SET NX PX (Sentinel HA) for efficiency
- For correctness: fencing tokens enforced by resource, or etcd/ZooKeeper

**Follow-ups**
- Why don't fencing tokens solve the problem inside Redlock itself?
- When is etcd/ZooKeeper the right answer over Redis?

---

#### 19. Implement a rate limiter in Redis. Compare fixed-window, sliding-window-log, and token-bucket, and why must the check-and-update be atomic?

*Difficulty:* 🟠 hard  ·  *Tags:* `rate-limiting`, `lua`, `token-bucket`, `sliding-window`, `atomicity`

**Fixed window**: `INCR rl:user:minute` with `EXPIRE` on first hit; reject if > limit. Cheap and O(1), but allows a 2x burst at the window boundary (two windows' worth of traffic clustered around the edge). **Sliding-window log**: store request timestamps in a ZSET, `ZREMRANGEBYSCORE` to drop entries older than the window, `ZCARD` to count, `ZADD` the new one. Accurate and smooth but O(log n) per request and stores every timestamp (memory). A sliding-window-counter approximation blends two fixed windows for a middle ground. **Token bucket**: store tokens + last-refill time; on each request refill by elapsed*rate, consume one if available. Allows controlled bursts up to bucket size and a steady refill rate — usually the best UX. The check-and-update **must be atomic**, otherwise concurrent requests read the same count and all pass (TOCTOU over-admission). Use a single `INCR`/`EXPIRE` where possible, or a **Lua script** so the read, decision, and write execute as one indivisible operation on Redis's single thread.

**Key points**
- Fixed window: O(1) INCR+EXPIRE, but boundary burst (up to 2x)
- Sliding-window log: ZSET of timestamps, accurate, O(log n) + memory
- Token bucket: tokens + refill, allows bursts to bucket size; best UX
- Atomicity required: non-atomic check-then-incr -> over-admission (TOCTOU)
- Use single INCR or Lua so check+update is one operation


```go
// Sliding-window-log rate limit as one atomic Lua script
var slidingWindow = redis.NewScript(`
  local now    = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit  = tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
  local count = redis.call('ZCARD', KEYS[1])
  if count >= limit then return 0 end
  redis.call('ZADD', KEYS[1], now, now)
  redis.call('PEXPIRE', KEYS[1], window)
  return 1`)
// returns 1 = allowed, 0 = throttled
allowed, _ := slidingWindow.Run(ctx, rdb, []string{"rl:user:42"},
    time.Now().UnixMilli(), 60000, 100).Int()
```

**Follow-ups**
- Why does fixed-window allow a 2x boundary burst?
- How would you make the limiter distributed-fair across many app nodes?

---

#### 20. Why is Lua scripting the canonical way to get atomicity in Redis? What are the rules and pitfalls (keys, determinism, blocking)?

*Difficulty:* 🟠 hard  ·  *Tags:* `lua`, `atomicity`, `scripting`, `cluster`, `determinism`

Redis executes each Lua script **atomically and to completion** on its single thread — no other command interleaves — so a script bundling read-decide-write (e.g. compare-and-delete a lock, check-and-increment a limiter) is race-free without external locking, and saves round-trips versus multiple commands. Rules and pitfalls: (1) **Declare all keys via `KEYS[]`**, not by constructing key names inside the script, so Redis Cluster can route correctly — all keys a script touches must live in the **same hash slot** (use hash tags `{...}`), or it errors in Cluster mode. (2) Scripts must be **deterministic/effect-deterministic** historically (so replicas/AOF replay identically); modern Redis replicates the *effects* rather than the script, easing this, but avoid non-deterministic sources (`TIME`, `RANDOM`) feeding writes unless intended. (3) Because a script blocks the whole server until it finishes, a **long or looping script stalls every client** — keep scripts short and bounded; runaway scripts hit `lua-time-limit` and may require `SCRIPT KILL`. (4) Use `EVALSHA` with `SCRIPT LOAD` to avoid resending the body. For multi-step atomic logic, Lua beats `MULTI/EXEC` because it can branch on read values.

**Key points**
- Scripts run atomically on the single thread -> no interleaving, fewer round-trips
- Pass keys via KEYS[]; in Cluster all keys must share a hash slot (hash tags)
- Determinism matters for replication/AOF; avoid uncontrolled randomness/time in writes
- Script blocks the whole server -> keep it short; runaway -> SCRIPT KILL
- EVALSHA + SCRIPT LOAD to cache; Lua > MULTI/EXEC when you must branch on reads

**Follow-ups**
- Why is Lua better than MULTI/EXEC for conditional logic?
- What breaks if a script touches keys in different hash slots in Cluster?

---

#### 21. When is Redis Pub/Sub the right tool versus the wrong one? What guarantees does it not provide?

*Difficulty:* 🟡 medium  ·  *Tags:* `pub-sub`, `messaging`, `streams`, `fan-out`

Pub/Sub broadcasts a message to all clients subscribed to a channel **at that instant**, with O(1) decoupling between publishers and subscribers. It's right for ephemeral, real-time fan-out where missing a message is acceptable: live dashboards, cache-invalidation broadcasts across app nodes, chat presence, config-change notifications. It does **not** provide: persistence (no replay — a subscriber that's down or reconnecting loses messages), delivery guarantees (fire-and-forget, no ack/retry), consumer groups or load balancing (every subscriber gets every message; you can't share work), or backpressure (slow subscribers get disconnected when their output buffer overflows). So it's the *wrong* tool for a reliable work queue, event sourcing, or anything requiring at-least-once delivery — use **Streams** with consumer groups for those. Also note classic Pub/Sub isn't cluster-wide unless you use **sharded Pub/Sub** (`SSUBSCRIBE`) introduced to scale fan-out across cluster shards. Rule of thumb: Pub/Sub for 'tell whoever's listening right now', Streams for 'deliver this reliably and let me replay'.

**Key points**
- Pub/Sub: instant fan-out to current subscribers, fully decoupled
- Right for ephemeral real-time: invalidation broadcast, presence, config change
- No persistence/replay, no ack/retry, no consumer groups, no backpressure
- Wrong for reliable queues/event sourcing -> use Streams
- Classic Pub/Sub not cluster-scaled without sharded Pub/Sub (SSUBSCRIBE)

**Follow-ups**
- How would you make Pub/Sub-based cache invalidation resilient to missed messages?
- What is sharded Pub/Sub and why was it added?

---

## Persistence & Durability

#### 22. Compare RDB and AOF persistence in Redis. What are the durability and recovery trade-offs, and what do you run in production?

*Difficulty:* 🟠 hard  ·  *Tags:* `rdb`, `aof`, `persistence`, `durability`

**RDB** takes point-in-time **snapshots** (forked child writes a compact binary dump). Pros: small files, fast restart/restore, low runtime overhead, ideal for backups/replication bootstraps. Con: you can lose all writes **since the last snapshot** (minutes), and the `fork` on large datasets can cause a memory spike (copy-on-write) and latency blip. **AOF** logs **every write command** to an append-only file, replayed on restart. With `appendfsync everysec` (the common setting) you lose at most ~1s of writes; `always` is near-zero loss but slow; `no` defers to the OS. AOF files are larger and grow, so Redis **rewrites/compacts** them periodically; recovery is slower than RDB (replaying commands). Durability ranking: AOF-always > AOF-everysec > RDB. **Production default**: run **both** — AOF for fine-grained durability and RDB for fast restarts and backups (Redis can use RDB-preamble AOF to combine compact base + recent commands). Remember even AOF-everysec is *not* a true durable datastore guarantee, and replication is async, so a primary crash can still lose acked writes; if you can't lose data, Redis is the wrong primary store.

**Key points**
- RDB: periodic snapshot, compact, fast restart, but loses writes since last snapshot + fork spike
- AOF: logs every write; everysec ~1s loss, always ~0 loss but slow; needs rewrite/compaction
- Durability: AOF-always > AOF-everysec > RDB; recovery: RDB faster than AOF replay
- Production: run both (RDB-preamble AOF) for durability + fast restart + backups
- Even AOF + async replication can lose acked writes -> not a durable system of record

**Follow-ups**
- What causes the fork latency spike and how do you mitigate it?
- Why doesn't AOF-everysec guarantee zero data loss on a crash?

---

## Scaling & Architecture

#### 23. Explain Redis Cluster's hash-slot model. How is a key mapped to a node, and what are hash tags for?

*Difficulty:* 🟠 hard  ·  *Tags:* `redis-cluster`, `hash-slots`, `hash-tags`, `sharding`

Redis Cluster partitions the keyspace into a fixed **16384 hash slots**. A key's slot is `CRC16(key) mod 16384`; each master owns a contiguous-ish set of slots, and clients (or via `MOVED`/`ASK` redirects) route a command to the node owning that key's slot. Resharding moves slots (and their keys) between nodes without changing the slot count, so scaling out is migrating slots, not rehashing all keys. A crucial constraint: **multi-key operations (MGET, transactions, Lua with multiple KEYS) only work if all keys are in the same slot.** To force that, use a **hash tag** — only the substring inside `{...}` is hashed, so `user:{42}:profile` and `user:{42}:settings` land in the same slot and can be operated on together. Overusing a single hash tag, though, concentrates keys on one slot/node and creates a hotspot, so balance co-location against distribution. Cluster also implies no cross-slot atomicity and that your data model must avoid cross-slot multi-key needs.

**Key points**
- 16384 fixed hash slots; slot = CRC16(key) mod 16384
- Masters own slot ranges; clients route, MOVED/ASK redirect during migration
- Resharding migrates slots, not a full rehash
- Multi-key ops require same slot; hash tags {..} force co-location
- Over-using one tag concentrates load (hotspot) -> balance co-location vs spread

**Follow-ups**
- What's the difference between MOVED and ASK redirects?
- How do hash tags interact with hot keys?

---

#### 24. Compare Redis replication, Sentinel, and Cluster. What does each provide, and what failover/consistency caveats apply?

*Difficulty:* 🟠 hard  ·  *Tags:* `replication`, `sentinel`, `cluster`, `failover`, `consistency`

**Replication** alone gives you read scaling and a warm standby: replicas asynchronously copy the primary, you can offload reads, but there's **no automatic failover** — promotion is manual. **Sentinel** adds automatic failover and monitoring on top of replication: a quorum of Sentinels detects a primary failure, elects a new primary, and reconfigures replicas and clients (via Pub/Sub of the new topology). It provides HA for a single-primary dataset but does **not** shard — your whole dataset must fit on one node. **Cluster** provides both sharding (16384 slots across multiple primaries) **and** built-in failover (each shard has replicas; the cluster promotes one on failure), so it scales data and writes horizontally. Caveats common to all: **replication is asynchronous**, so a failover can lose writes acked by the old primary that hadn't replicated (the `WAIT` command and `min-replicas-to-write` reduce but don't eliminate this); split-brain is possible during partitions, which Cluster bounds with `cluster-node-timeout` and majority rules. Choose replication for read scaling, Sentinel for HA at one-node scale, Cluster when data/writes exceed a single node.

**Key points**
- Replication: read scaling + warm standby, no auto failover
- Sentinel: monitoring + automatic failover for single-primary, no sharding
- Cluster: sharding (slots) + per-shard failover -> horizontal scale
- All async replication -> failover can lose acked writes (WAIT/min-replicas mitigate)
- Split-brain possible on partitions; Cluster bounds via node-timeout + majority

**Follow-ups**
- How does WAIT change durability semantics, and at what cost?
- When is Sentinel enough vs. needing Cluster?

---

#### 25. Redis is single-threaded for command execution. What are the practical implications for performance, and how does it stay fast?

*Difficulty:* 🔴 staff  ·  *Tags:* `single-threaded`, `performance`, `atomicity`, `io-threads`

Redis executes commands on a **single thread**, processing them one at a time from an event loop (epoll/kqueue). Implications: (1) Each command is effectively **atomic** — no locks needed, which is why `INCR`, Lua scripts, and `MULTI/EXEC` are race-free. (2) A **single slow command blocks everything** — `KEYS *`, big `SORT`, large `ZRANGEBYSCORE`, a `SMEMBERS` on a huge set, or an unbounded Lua loop stalls all clients; you must avoid O(N) commands on large keys (use `SCAN`, bounded ranges). (3) It can't use multiple cores for command processing, so a single instance is **CPU-bound on one core**; you scale by sharding (Cluster) or running multiple instances, not by adding threads. It stays fast because everything is in-memory (no disk in the hot path), it avoids lock contention and context switches, and it uses efficient data structures and a tight event loop — so the single thread handles ~100k+ ops/sec. Modern Redis added **I/O threads** for network read/write (socket parsing/replies) and threaded lazy-freeing of large objects, but the **command execution remains single-threaded** to preserve the atomicity guarantees.

**Key points**
- Single command thread -> each command atomic, no locks needed
- One slow/O(N) command blocks all clients (avoid KEYS, big ranges, unbounded Lua)
- CPU-bound on one core; scale by sharding/instances, not threads
- Fast due to in-memory, no lock contention, tight event loop
- I/O threads + threaded free exist, but execution stays single-threaded for atomicity

**Follow-ups**
- Which commands are dangerous on large keys and what replaces them?
- What exactly do Redis I/O threads parallelize?

---

## Expiry & Memory

#### 26. How does Redis actually expire keys? Contrast passive and active expiry and the memory implications of each.

*Difficulty:* 🟡 medium  ·  *Tags:* `expiry`, `passive`, `active`, `memory`, `replication`

A TTL doesn't delete a key the instant it elapses. Redis uses two mechanisms. **Passive (lazy) expiry**: when a client *accesses* a key, Redis checks its TTL and, if expired, deletes it then and returns nil. Cheap, but a key that's never accessed again would linger forever, wasting memory. **Active expiry**: a background cycle (~10 times/sec) **samples** a batch of keys that have TTLs, deletes the expired ones, and — if more than ~25% of the sample was expired — repeats the loop, throttling so it doesn't monopolize the single thread. The memory implication: expired-but-not-yet-collected keys still **occupy memory** until one of these reclaims them, so under heavy use with many short TTLs you can see memory above the 'logically live' set, and expiry pressure competes with command execution. On a replica, keys are **not** expired independently — the primary sends explicit `DEL`/`UNLINK` so reads stay consistent (a replica won't serve a logically-expired key once a newer Redis returns nil for it). Use `UNLINK`/lazy-free for large keys to avoid blocking on deletion.

**Key points**
- TTL keys aren't deleted exactly on expiry
- Passive: deleted on access; never-accessed keys can linger -> wasted memory
- Active: periodic sampling cycle deletes expired, repeats if >25% expired, throttled
- Expired-not-collected keys still consume memory until reclaimed
- Replicas don't expire independently; primary propagates DEL/UNLINK for consistency

**Follow-ups**
- Why does active expiry sample rather than scan all TTL keys?
- How do replicas avoid serving logically-expired keys?

---

## Choosing the Right Tool

#### 27. Redis vs. Memcached for a caching layer. Where does each win, and when would you still pick Memcached?

*Difficulty:* 🟡 medium  ·  *Tags:* `redis`, `memcached`, `comparison`, `caching`

**Memcached** is a lean, multi-threaded, in-memory key-value cache: strings/blobs only, LRU eviction, no persistence, no replication. Its strengths are simplicity and raw multi-core throughput for a pure 'cache opaque blobs by key' workload, and slab allocation that's efficient for uniform object sizes. **Redis** is far richer: many data structures (hashes, sorted sets, streams, HLL, geo), Lua scripting, persistence (RDB/AOF), replication, Sentinel, Cluster, pub/sub, transactions, and TTL/eviction policies — so it doubles as a primitive datastore, queue, rate limiter, and leaderboard, not just a cache. For most modern systems Redis is the default because of that versatility and HA story. You'd still pick **Memcached** when you need a dead-simple, horizontally-sharded cache of large numbers of similarly-sized blobs at very high throughput, want to exploit many cores per node without sharding, and need none of Redis's data structures or durability — e.g. a massive multi-tenant fragment/object cache where simplicity and predictable memory (slabs) matter more than features.

**Key points**
- Memcached: multi-threaded, blob-only, LRU, no persistence/replication; simple + high multi-core throughput
- Redis: rich data structures, scripting, persistence, replication, Cluster, pub/sub
- Redis is the default for versatility + HA; doubles as queue/limiter/leaderboard
- Pick Memcached for simple, uniform-size blob caching at scale, multi-core per node
- Choose by feature need + ops model, not raw speed alone

**Follow-ups**
- How does Memcached's slab allocation cause memory waste with varied sizes?
- What Redis features most often justify choosing it over Memcached?

---

#### 28. When is caching the wrong answer? Describe scenarios where adding a cache hurts more than it helps.

*Difficulty:* 🔴 staff  ·  *Tags:* `anti-patterns`, `when-not-to-cache`, `consistency`, `architecture`

Caching trades correctness/complexity for latency and load reduction; it's wrong when those costs outweigh the gain. Cases: (1) **Low hit ratio / high cardinality** — if access is uniform over a huge keyspace (little locality), most reads miss, so you pay cache+DB latency and gain almost nothing while adding a moving part. (2) **Strong consistency requirements** — financial balances, inventory at checkout, auth state where stale reads cause real harm; the invalidation complexity and staleness window aren't acceptable. (3) **Write-heavy, read-rare data** — you invalidate/repopulate constantly; the cache thrashes and adds work. (4) **Cheap source queries** — if the DB read is already sub-millisecond and indexed, the cache's network hop and serialization may not beat it. (5) **Premature optimization** — adding Redis before you've measured a real read bottleneck introduces an operational dependency, a new failure/consistency surface, and 'dual source of truth' bugs. (6) When the **real fix is elsewhere** — a missing index, an N+1 query, or denormalization often solves the latency more cheaply and correctly. The senior move: measure first, fix the data path, and add caching only for proven read-hot, staleness-tolerant access patterns.

**Key points**
- Low hit ratio / high cardinality: misses dominate, cache adds latency for little gain
- Strong consistency needs: staleness + invalidation risk unacceptable
- Write-heavy/read-rare: constant invalidation thrash
- Cheap/already-indexed queries: cache hop may not beat them
- Premature caching adds a failure + dual-source-of-truth surface; fix index/N+1 first

**Follow-ups**
- How do you measure whether a cache is actually earning its keep?
- What hit-ratio threshold makes a cache worthwhile for your workload?

---
