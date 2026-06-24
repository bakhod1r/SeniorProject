# Redis at Scale Lab

> Drive a Redis deployment past its comfortable operating point: saturate a single
> shard with a hot key, watch the hit-rate cliff when data outgrows `maxmemory`,
> and pay for durability in measured p99. Redis is single-threaded per shard — so
> every O(N) command, every fsync, every hot slot is a choice you can see and price.

| | |
|---|---|
| **Tier** | Lab (data-systems) |
| **Primary domain** | In-memory datastore / caching |
| **Skills exercised** | Redis single-thread model, pipelining & `MULTI`, Cluster (16384 hash slots), hot-key/hot-slot mitigation, eviction & expiry, RDB/AOF persistence, latency monitoring, Go (`go-redis`) |
| **Interview sections** | 7 (caching & Redis), 22 (scalability & HA), 17 (performance) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the cache tier for a read-heavy product: a hot path that does ~200k
lookups/s against Redis, backed by a Postgres that can sustain maybe 8k/s if the
cache evaporates. Last quarter, one celebrity object (a single key) took down a
shard during a traffic spike, and a separate incident — an `RDB` save during peak
— added 400 ms to p99 for 12 seconds and nobody knew why. Leadership now wants the
cache to hold **100M+ keys** and survive a node loss without a cold-cache
thundering herd.

Your job in this lab is to *characterize* Redis under high load, *find* the
failure modes (hot key, eviction cliff, fsync stall, O(N) event-loop block,
resharding pause), and *fix* each one with a measured before/after. You will
produce numbers, not opinions. The single-thread model means every microsecond
the event loop spends on the wrong thing is a microsecond of head-of-line
blocking for every other client — so this lab is fundamentally about *what you let
the event loop do*.

## 2. Goals / Non-goals

**Goals**
- Find the sustained ops/s ceiling of one shard for `GET`/`SET` at a fixed value
  size, and explain what bounds it (event loop CPU? NIC? syscall overhead?).
- Quantify the throughput win of **pipelining** and `MULTI/EXEC` vs one-RTT-per-command.
- Reproduce the **hot-key / hot-slot** problem on a cluster and measure one
  mitigation (client-side cache, key splitting, or replica reads).
- Characterize **eviction** under memory pressure: find the hit-rate cliff as the
  working set exceeds `maxmemory`, and compare `allkeys-lru` vs `allkeys-lfu`.
- Price **persistence**: measure p99 latency under `appendfsync everysec` vs
  `always`, and the latency spike of an `RDB` `BGSAVE`/AOF rewrite.
- Reproduce a **big-key O(N)** command stalling the event loop, and detect it.
- Run a **live resharding** (slot migration) under load and measure client impact
  (MOVED/ASK redirects, latency).

**Non-goals**
- A managed Redis (ElastiCache/MemoryStore). Run it yourself so you own the knobs.
- Building a novel cache library — use `go-redis` and `redis-cli`/`redis-benchmark`/`memtier_benchmark`.
- Geo-replication / active-active CRDT Redis (that's the multi-region lab).
- Persisting *as a database* — Redis here is a cache with durability options, not your system of record.

## 3. Functional requirements

1. A **loader** (`cmd/loader`) populates Redis with a configurable number of keys
   (target **≥ 100M**), value size, and TTL distribution. Deterministic given a seed.
2. A **driver** (`cmd/driver`) issues a configurable read/write mix at a target
   rate, with a switchable access distribution (uniform vs **Zipfian**), and a
   switchable transport: per-command, pipelined (batch size `N`), or `MULTI/EXEC`.
3. The driver supports two topologies by flag: **single node** and **Redis Cluster**
   (≥ 3 masters + 3 replicas), and records redirect counts (MOVED/ASK).
4. A **mitigation mode** for hot keys: at least one of client-side caching
   (`CLIENT TRACKING` / `go-redis` local cache), key splitting (`key:{shard}`), or
   read-from-replica, switchable by flag.
5. A **chaos hook** (`cmd/chaos`) can: trigger `BGSAVE`/`BGREWRITEAOF` mid-load,
   start a slot migration, run a big-key O(N) command (`KEYS *`, `HGETALL` on a
   huge hash, `LRANGE 0 -1`), and kill a master to force failover.

## 4. Load & data profile

- **Dataset:** **≥ 100M keys**, total resident set in the **tens of GB** (e.g. 100M
  keys × ~300 B value + overhead ≈ 40–50 GB). Report `used_memory` and
  `used_memory_rss` from `INFO memory`, and `mem_fragmentation_ratio`.
- **Value sizes:** test at least two — 100 B (typical cache entry) and 4 KB (fat
  serialized object). Report both.
- **Access distribution:** **Zipfian** (s ≈ 1.0–1.2) over the keyspace, so a small
  set of keys/slots gets disproportionate traffic — this is what creates the hot
  key and hot slot. Also run a **uniform** baseline for contrast.
- **TTL distribution:** mix of no-TTL keys and TTL'd keys (e.g. 30% with TTL drawn
  from 60 s–3600 s) so expiry behavior (lazy vs active) is observable.
- **Traffic model:** open-model driver (fixed target rate, not "as fast as Redis
  drains"), so you can watch latency and lag build instead of self-throttling.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Single-shard `GET` ceiling (100 B, non-pipelined, 50 conns) | Find & report (typically ~100k–150k ops/s/core); name the bound |
| Single-shard `GET` ceiling (pipelined, batch 16) | Find & report (often **5–10×** the non-pipelined number); explain the gap |
| Read p99 at 80% of ceiling, no persistence | < 1 ms |
| Cache hit rate, working set ≤ `maxmemory`, Zipfian | > 99% |
| Cache hit-rate **cliff**, working set > `maxmemory` | Locate the cliff; report hit rate vs (working_set / maxmemory) curve |
| Write p99 under `appendfsync everysec` | < 2 ms |
| Write p99 under `appendfsync always` | Measured (expect a multiple of `everysec`); quantify the tax |
| `BGSAVE` / AOF-rewrite latency spike | Measured peak p99 and its duration |
| Cluster resharding (slot migration) under load | p99 impact + MOVED/ASK redirect count during migration |
| Event-loop block from a big-key O(N) command | Measured stall (ms) via `SLOWLOG` + client p99 spike |

> The point of the lab is not a magic ops/s number — it's to **find** your
> deployment's number, **find each cliff**, and **explain** them.

## 6. Architecture constraints & guidance

- Run Redis yourself via `docker-compose`. Two stacks: a **single node** and a
  **6-node Cluster** (3 masters, 3 replicas). Pin the Redis version (7.x).
- Go client: **`redis/go-redis/v9`** — it exposes `Pipeline`, `TxPipeline`
  (`MULTI/EXEC`), Cluster mode with MOVED/ASK handling, and `CLIENT TRACKING`-based
  local caching. Use it for the driver.
- Use **`redis-benchmark`** for quick single-shard sweeps and **`memtier_benchmark`**
  for richer distributions (Zipfian via `--key-pattern`, ratios, pipelining) and
  for cross-checking your Go driver's numbers.
- Set `maxmemory` and `maxmemory-policy` explicitly — never run with the default
  `noeviction` for a cache lab; that turns memory pressure into write errors
  instead of evictions.
- Instrument from `INFO` (Prometheus via `redis_exporter`): `instantaneous_ops_per_sec`,
  `keyspace_hits`/`keyspace_misses`, `evicted_keys`, `expired_keys`,
  `used_memory`/`maxmemory`, `latest_fork_usec`, `rdb_last_bgsave_status`,
  `aof_last_write_status`, per-slot key counts. Plus client-side p50/p99/p999.
- Pin Redis to known cores and disable swap on the host — a swapped event loop
  destroys every measurement and teaches you nothing.

## 7. Data model

```
Keyspace (cache entries):
  obj:{id}                STRING  value ~100 B or 4 KB; some with TTL
  big:hash:{id}           HASH    deliberately large (1M+ fields) for the O(N) experiment
  big:list:{id}           LIST    deliberately large for LRANGE 0 -1

Hot-key splitting (mitigation):
  hot:{id}:{n}            STRING  the one hot value, fanned across n sub-keys / slots
                                  using hash tags {id} to co-locate, or distinct
                                  keys to spread across slots — state which and why

Cluster slot model:
  16384 hash slots; slot = CRC16(key) % 16384  (or CRC16 of the {tag} substring)
  driver records per-slot op counts to locate the hot slot
```

For the hot-key mitigation, be explicit: **hash tags** `{id}` force keys into the
*same* slot (good for `MULTI` across them, bad for spreading load); **distinct
keys** spread across slots (good for load, can't be atomic together). The whole
point is that you can't have both — show the trade you made.

## 8. Interface contract

- Driver configured via flags/env: `-keys`, `-value-size`, `-ttl-frac`,
  `-dist=uniform|zipfian`, `-zipf-s`, `-rw-ratio`, `-rate`, `-conns`,
  `-pipeline=N` (0 = per-command), `-tx` (use `MULTI/EXEC`), `-topology=node|cluster`,
  `-mitigation=none|local-cache|key-split|replica-read`.
- Loader: `-keys`, `-value-size`, `-ttl-frac`, `-seed`, `-batch` (pipelined load).
- Chaos: `-action=bgsave|aof-rewrite|reshard|bigkey-on|kill-master`,
  `-slots=<range>` (for reshard), `-target=<node>`.
- `GET /metrics` → Prometheus exposition (client-side latencies + scraped Redis `INFO`).

## 9. Key technical challenges

- **The single thread is the whole game.** One shard serves commands serially.
  Pipelining doesn't make Redis faster per command — it amortizes RTT and syscall
  overhead so the thread does more useful work per `read()`/`write()`. You must show
  *why* pipelining wins and where it stops winning (it doesn't help a single hot
  key's contention, and it can starve fairness).
- **A hot key has no horizontal fix.** Adding shards does nothing for *one* key —
  it lives in one slot on one master. Mitigation means changing the access pattern
  (local cache / split / replica), each with a correctness cost (staleness,
  atomicity, replication lag). Measure the cost, not just the throughput.
- **The eviction cliff is non-linear.** Below `maxmemory` the hit rate is flat and
  high; cross it and LRU/LFU start evicting *working-set* keys, misses cascade to
  the backing store, and hit rate falls off a cliff. The shape of that cliff —
  and how `lru` vs `lfu` differ under Zipfian — is the deliverable.
- **Durability is latency you pay on the event loop.** `appendfsync always` fsyncs
  on the critical path; `BGSAVE` forks (copy-on-write) and the fork itself
  (`latest_fork_usec`) plus COW page faults stall the parent. Quantify each.
- **O(N) commands block everyone.** `KEYS *`, `HGETALL`/`LRANGE` on a big key, `SMEMBERS`
  on a huge set — each monopolizes the single thread for milliseconds, head-of-line
  blocking every other client. Reproduce, measure the stall, and find the scan-based
  alternative (`SCAN`/`HSCAN`).
- **Resharding moves data under live traffic.** Slot migration emits `ASK`
  redirects mid-key-move and `MOVED` once a slot's home changes; a correct client
  follows them transparently. Measure the redirect volume and latency cost.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each.

1. **Pipelining sweep.** Same read mix at `pipeline=0,1,8,16,64` and via `MULTI/EXEC`.
   *Measure:* ops/s and p99 for each. Find the batch size where throughput plateaus
   and where p99 starts climbing (large batches add queueing latency). Explain the curve.
2. **Hot-key saturation.** Zipfian with `s≈1.2` so one key dominates. Drive load on
   a cluster and watch one master's `instantaneous_ops_per_sec` and CPU pin while the
   others idle. *Measure:* per-slot op distribution; single hot master CPU; client p99.
   Then enable one mitigation (`local-cache` or `key-split`) and re-run. *Measure:*
   the drop in hot-master load and the new p99 — and the staleness/atomicity cost incurred.
3. **Eviction cliff.** Fix `maxmemory`; load a growing working set so
   `working_set / maxmemory` goes 0.5 → 0.8 → 1.0 → 1.5 → 3.0. *Measure:* hit rate
   (`keyspace_hits / (hits+misses)`) and `evicted_keys/s` at each point. Plot the cliff.
   Re-run with `allkeys-lru` vs `allkeys-lfu` vs `volatile-lru`; show which holds the
   Zipfian working set best.
4. **AOF fsync vs p99.** Same write rate under `appendfsync no`, `everysec`, and
   `always`. *Measure:* write p99/p999 for each, and `aof_delayed_fsync` count.
   Quantify the `everysec → always` latency multiple.
5. **Persistence spike.** Mid-load, trigger `BGSAVE` and (separately) an AOF rewrite.
   *Measure:* `latest_fork_usec`, the p99 spike magnitude and its duration, and
   whether COW page faults correlate with the stall on a large dataset.
6. **Big-key O(N) stall.** With steady background load, run `KEYS *`, then
   `HGETALL big:hash:{id}` (1M fields), then `LRANGE big:list:{id} 0 -1`.
   *Measure:* the `SLOWLOG` entry duration, the client p99 spike for *unrelated*
   keys during the stall (head-of-line blocking), and the improvement when you
   replace `KEYS` with `SCAN` and `HGETALL` with `HSCAN`.
7. **Live resharding under load.** Migrate a slot range from one master to another
   (`reshard`) while the driver runs. *Measure:* MOVED + ASK redirect counts, p99
   during migration vs steady state, and total migration duration. Note whether the
   hot slot moving helps or hurts.
8. **Expiry spike.** Load many keys with TTLs clustered to expire near-simultaneously.
   *Measure:* `expired_keys/s`, the active-expiry CPU cost, and any p99 blip when a
   large batch expires; contrast lazy expiry (on access) vs the active cycle.

## 11. Milestones

1. Single-node compose up; loader + driver; `redis_exporter` + a Grafana board for
   ops/s, hits/misses, memory, evictions, latency. First `redis-benchmark` ceiling run.
2. Pipelining and `MULTI` sweep (experiment 1); write down the non-pipelined and
   pipelined ceilings and the bound on each.
3. Eviction-cliff and AOF/persistence experiments (3, 4, 5); plot the cliff and the
   fsync/p99 trade.
4. Cluster compose up; hot-key reproduction + mitigation (experiment 2); per-slot
   distribution evidence.
5. Big-key stall, live resharding, expiry spike (6, 7, 8); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained run at a stated rate with **≥ 100M keys** loaded; `INFO memory`
      output and a dashboard screenshot attached.
- [ ] Non-pipelined **and** pipelined ceiling numbers reported, **with the bound
      named** (event-loop CPU / NIC / syscall), and the pipelining win explained.
- [ ] Hit-rate-vs-`maxmemory` cliff curve plotted; `lru` vs `lfu` compared under Zipfian.
- [ ] AOF `everysec` vs `always` p99 quantified; `BGSAVE`/AOF-rewrite spike magnitude
      and duration measured.
- [ ] Hot key reproduced (one master pinned, others idle) **and** a mitigation shown
      to reduce hot-master load, with its correctness cost stated.
- [ ] Big-key O(N) stall reproduced via `SLOWLOG`, its head-of-line impact on
      unrelated keys measured, and the `SCAN`/`HSCAN` fix shown.
- [ ] Live reshard run; MOVED/ASK counts and p99 impact reported; client kept correct.
- [ ] Every number reproducible from a committed command + config.

## 13. Stretch goals

- **Client-side caching at scale:** enable `CLIENT TRACKING` (RESP3 invalidation
  push) via `go-redis` local cache; measure the hot-master offload and the
  invalidation lag window where a client may read stale data.
- **Cache-stampede defense:** add request coalescing / a short lock on miss so a key
  expiry doesn't fan a thundering herd to the backing store; measure herd size before/after.
- **Replica-read consistency:** serve reads from replicas to spread a hot slot;
  quantify the staleness window from replication lag (`master_repl_offset` vs replica).
- **`io-threads`:** enable Redis I/O threads and measure how much of the
  single-thread ceiling was actually network I/O vs command execution.
- **Big-key remediation:** shard a 1M-field hash into bucketed sub-hashes and show
  the O(N) hazard disappears.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Throughput analysis | Reports pipelined vs non-pipelined ceilings | Names and **proves** the bound; explains *why* pipelining wins and where it stops |
| Single-thread model | Knows Redis is single-threaded per shard | Reasons about head-of-line blocking; predicts which commands endanger the event loop |
| Hot-key/hot-slot | Reproduces the hot key, sees one master pinned | Mitigates it, measures the offload **and** names the correctness cost (staleness/atomicity/lag) |
| Eviction & memory | Sees evictions when over `maxmemory` | Locates the hit-rate cliff; picks `lru`/`lfu` for the workload with evidence |
| Persistence trade-offs | Shows AOF/`always` adds latency | Quantifies the fsync tax and `BGSAVE` spike; recommends a profile for an SLO |
| Cluster operations | Knows 16384 slots, MOVED/ASK exist | Runs live resharding, measures redirect/latency impact, keeps clients correct |
| Communication | Clear findings note with curves | Could defend every cliff and knee to a staff panel |

## 15. References

- Redis docs: pipelining, transactions (`MULTI`/`EXEC`/`WATCH`), Cluster spec
  (16384 slots, MOVED/ASK, resharding), eviction policies, persistence (RDB & AOF,
  `appendfsync`), expiration (lazy & active), `SLOWLOG`, `LATENCY DOCTOR`/`LATENCY HISTORY`.
- `redis/go-redis/v9` — `Pipeline`, `TxPipeline`, Cluster client, `CLIENT TRACKING` local cache.
- `redis-benchmark` and `memtier_benchmark` (Zipfian key patterns, pipelining, ratios).
- *Designing Data-Intensive Applications* — Ch. 1 & 5 (caching, replication, leader/follower).
- See also: `Interview Question/07-caching-and-redis/` and
  `Interview Question/22-scalability-and-high-availability/`.
