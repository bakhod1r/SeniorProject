# Database Types & Selection (Polyglot Persistence)

> A senior Go backend engineer's map of the database landscape and a decisive framework for choosing the right store per workload, with deep ClickHouse/OLAP coverage and cross-references to the dedicated PostgreSQL, MongoDB, Redis, and Elasticsearch sections.

**36 questions** across **7 topics** · Level: senior

## Topics

- [Selection Framework & Database Taxonomy](#selection-framework-database-taxonomy) (5)
- [Relational / OLTP & NewSQL](#relational-oltp-newsql) (4)
- [Key-Value Stores](#key-value-stores) (5)
- [Document & Wide-Column Stores](#document-wide-column-stores) (4)
- [Columnar / OLAP — ClickHouse Deep Dive](#columnar-olap-clickhouse-deep-dive) (8)
- [Time-Series, Search, Graph & Vector](#time-series-search-graph-vector) (5)
- [Storage Engines, Sync & OLTP vs OLAP](#storage-engines-sync-oltp-vs-olap) (5)

---

## Selection Framework & Database Taxonomy

#### 1. Walk me through the framework you use to choose a database for a new service. What questions do you ask before naming any product?

*Difficulty:* 🟡 medium  ·  *Tags:* `selection`, `framework`, `access-patterns`

I start from the workload, never the brand. The driving questions: (1) **Access pattern** — point lookups by key, range scans, full-text, graph traversal, or large aggregations? (2) **Read/write ratio and shape** — write-heavy ingest vs read-heavy analytics. (3) **Consistency needs** — does a stale read break correctness (money) or just annoy (a feed)? (4) **Query flexibility** — fixed known queries (model query-first) vs ad-hoc exploration. (5) **Scale** — current and 3-year data volume, QPS, cardinality. (6) **OLTP vs OLAP** — many small transactional rows vs few huge scans. Only after these do I map to a family: relational for transactional truth, KV for cache/session, columnar for analytics, etc. The default is PostgreSQL until a *specific* requirement breaks it; every extra store is operational cost you must justify.

**Key points**
- Start from access pattern, consistency, scale, OLTP vs OLAP — not the product name
- Default to one relational store until a concrete requirement forces a specialized one
- Query shape (known vs ad-hoc) decides whether you can model query-first
- Every additional datastore is recurring operational cost

**Follow-ups**
- How would your answer change if the read/write ratio were 1000:1?
- What requirement would make you reach past PostgreSQL first?

---

#### 2. What is polyglot persistence, and what is the real cost of operating many stores?

*Difficulty:* 🟡 medium  ·  *Tags:* `polyglot-persistence`, `operations`, `trade-offs`

Polyglot persistence means using multiple database types in one system, each chosen for the workload it serves best — e.g. PostgreSQL as source of truth, Redis for sessions, ClickHouse for analytics, Elasticsearch for search. The upside is each store does what it's optimized for. The cost is real and often underestimated: each store needs separate operational expertise (backups, upgrades, failover, capacity planning), separate monitoring, separate on-call runbooks, and most painfully **keeping data in sync** — the same fact now lives in several places and can diverge. You also fragment transactions: you can't atomically write across Postgres and ClickHouse. My rule: adopt a new store only when a measured requirement (latency, scale, query type) can't be met by what you already run, and have a sync strategy (CDC/outbox) before you add it.

**Key points**
- Right tool per workload, but each store multiplies operational surface
- Cross-store atomicity is lost — no distributed transaction across families
- Sync/consistency between stores is the hidden recurring tax
- Justify each new store with a measured, unmet requirement

**Follow-ups**
- How do you keep the analytics store in sync with the OLTP source of truth?
- When is one over-stretched Postgres better than three specialized stores?

---

#### 3. How does CAP positioning differ across database families, and how does it inform selection?

*Difficulty:* 🟠 hard  ·  *Tags:* `cap`, `consistency`, `distributed`

CAP says under a network **partition** you choose consistency or availability; with no partition you get both. Single-node relational (PostgreSQL, MySQL) is CA in practice — no partition within one node, but it can't survive one either. Distributed systems must pick: **CP** systems (Spanner, CockroachDB, etcd, HBase, MongoDB with majority writes) refuse writes that can't reach a quorum, favoring correctness — pick these for money, coordination, metadata. **AP** systems (Cassandra/ScyllaDB, DynamoDB, Riak with low quorum) stay writable on both sides of a partition and reconcile later, favoring uptime — pick these for high-availability ingest, carts, telemetry where stale/converging data is acceptable. The nuance: most modern stores are *tunable* (Cassandra per-query consistency, Dynamo's quorum knobs), so 'AP vs CP' is really per-operation. PACELC extends this: even without partitions you trade latency vs consistency.

**Key points**
- CP (Spanner, CockroachDB, etcd, HBase): correctness over uptime — money, coordination
- AP (Cassandra, ScyllaDB, DynamoDB): uptime over freshness — converging data tolerated
- Single-node RDBMS is effectively CA — fine until you need to survive a partition
- Consistency is tunable per-operation in many stores; PACELC adds the latency dimension

**Follow-ups**
- Where does DynamoDB sit, and how do you make a read strongly consistent?
- Why is etcd CP and what would break if it were AP?

---

#### 4. Give a concise map of the major database families and the one-line job each is best at.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `taxonomy`, `overview`

**Relational/OLTP** (PostgreSQL, MySQL): transactional source of truth, joins, ACID. **NewSQL** (CockroachDB, Spanner, YugabyteDB): relational semantics with horizontal scale and strong consistency. **Key-value** (Redis, DynamoDB): O(1) lookups by key — cache, session, high-scale KV. **Document** (MongoDB, Couchbase): flexible nested JSON aggregates, schema evolution. **Wide-column** (Cassandra, ScyllaDB, HBase): write-heavy, horizontally scaled, query-first. **Columnar/OLAP** (ClickHouse, BigQuery, Snowflake, Druid): fast aggregations over huge scans. **Time-series** (TimescaleDB, InfluxDB, Prometheus): timestamped metrics with retention/downsampling. **Search** (Elasticsearch, OpenSearch): relevance-ranked full-text. **Graph** (Neo4j, Dgraph): deep relationship traversal. **Vector** (pgvector, Pinecone, Milvus, Qdrant): ANN similarity for embeddings/RAG. **Object** (S3, MinIO): blobs and data lakes.

**Key points**
- Each family is shaped by its dominant access pattern
- OLTP = many small transactions; OLAP = few huge scans
- Specialized stores (search, graph, vector, time-series) earn their place only for their specific query shape

**Follow-ups**
- Which two families overlap most, and how do you decide between them?
- Which of these can PostgreSQL plausibly substitute for via extensions?

---

#### 5. A team wants to add Cassandra for one new feature. What pushback or questions do you raise?

*Difficulty:* 🟠 hard  ·  *Tags:* `selection`, `operations`, `wide-column`

I'd challenge whether the workload truly needs it. Cassandra/ScyllaDB shines for write-heavy, query-first, horizontally-scaled workloads with no ad-hoc querying — millions of writes/sec, predictable access by partition key. Questions: What's the actual write volume and is Postgres really the bottleneck, or is it a missing index? Are queries fully known up front, or will product want new query shapes (Cassandra can't do those without remodeling)? Who will operate the ring — repairs, compaction tuning, tombstone management — that's a specialized on-call skill we may not have? Can we meet the need by partitioning Postgres, adding a read replica, or using an existing store? If the answer is 'we have one feature and don't operate Cassandra today,' adding a whole distributed store and its operational burden for one feature is usually the wrong call — extend what you run or pick a managed equivalent.

**Key points**
- Match Cassandra to its sweet spot: write-heavy, query-first, no ad-hoc queries
- New store = new operational skill set (repairs, compaction, tombstones)
- Prefer extending existing stores or managed services over a new self-run cluster for one feature
- Verify the bottleneck is real, not a missing index

**Follow-ups**
- What does 'query-first modeling' force you to give up?
- When would ScyllaDB change this calculus over Cassandra?

---

## Relational / OLTP & NewSQL

#### 6. PostgreSQL vs MySQL for a new OLTP service — how do you decide?

*Difficulty:* 🟡 medium  ·  *Tags:* `postgresql`, `mysql`, `oltp`

Both are mature, ACID, replicated relational engines; the gap has narrowed. I default to **PostgreSQL** for richer SQL and extensibility: native JSONB, arrays, full-text, window/CTE depth, GiST/GIN/BRIN index types, partial and expression indexes, and an enormous extension ecosystem (PostGIS, pgvector, TimescaleDB) — so it doubles as geo, vector, or time-series store. Its MVCC needs autovacuum tuning at scale. I'd pick **MySQL/InnoDB** when the org already runs it well, when I want its battle-tested replication and tooling at huge scale (it powers many web giants), or for read-heavy workloads where its clustered-index-by-primary-key layout helps. For greenfield, PostgreSQL's flexibility usually wins unless there's existing MySQL expertise/operational standardization to honor. Either way, the relational model's value is the same: declarative SQL, strong consistency, and joins that keep data normalized.

**Key points**
- Default PostgreSQL: JSONB, extensions (PostGIS/pgvector/Timescale), richer index types, deeper SQL
- MySQL/InnoDB: existing expertise, proven replication at scale, clustered PK layout
- Postgres MVCC needs autovacuum attention; understand bloat
- Decision is often org standardization, not raw capability

**Follow-ups**
- How does Postgres MVCC bloat happen and how do you mitigate it?
- When does Postgres-as-everything (Timescale + pgvector) beat dedicated stores?

---

#### 7. What does ACID actually guarantee, and why is it the default for transactional systems?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `acid`, `oltp`, `consistency`

**Atomicity**: a transaction is all-or-nothing — partial writes never persist. **Consistency**: each committed transaction moves the DB from one valid state to another, respecting constraints. **Isolation**: concurrent transactions don't see each other's uncommitted intermediate state (strength tuned by isolation level — read committed, repeatable read, serializable). **Durability**: once committed, data survives crashes (WAL/redo log). ACID is the default for transactional systems because it lets you reason about correctness locally: you write the business rule, the engine guarantees no torn writes, no lost updates, no dirty reads. For money, inventory, and any invariant that must always hold, this is non-negotiable, and it's why relational OLTP remains the source-of-truth backbone even in polyglot architectures. The cost is coordination overhead, which is what NoSQL stores relax to scale.

**Key points**
- Atomicity/Consistency/Isolation/Durability — local correctness reasoning
- Isolation level is a tunable knob, not a single setting
- Non-negotiable for money/inventory invariants
- Coordination cost is exactly what NoSQL relaxes for scale

**Follow-ups**
- What anomaly does SERIALIZABLE prevent that REPEATABLE READ does not?
- How do distributed SQL engines preserve ACID across nodes?

---

#### 8. What problem does NewSQL / distributed SQL solve, and how do CockroachDB and Spanner achieve scale with strong consistency?

*Difficulty:* 🟠 hard  ·  *Tags:* `newsql`, `cockroachdb`, `spanner`, `raft`, `truetime`

NewSQL targets the dilemma where you've outgrown a single relational node but refuse to give up SQL and strong consistency for NoSQL's eventual consistency. CockroachDB, Spanner, and YugabyteDB shard data into ranges/tablets spread across nodes, replicate each range with a **consensus protocol** (Raft in CockroachDB/Yugabyte, Paxos in Spanner), and commit a write only when a quorum agrees — giving linearizable, fault-tolerant writes that survive node loss. Spanner additionally uses **TrueTime** (GPS + atomic clocks giving bounded clock uncertainty) to assign globally consistent commit timestamps and offer external consistency across datacenters; CockroachDB approximates this with hybrid logical clocks. Distributed transactions use two-phase commit over the consensus groups. The trade-off: cross-range/cross-region transactions add latency (you pay for quorum round-trips), and operating them is more complex than one Postgres. Worth it when you genuinely need horizontal write scale plus SQL plus strong consistency plus survive-a-region resilience.

**Key points**
- Horizontal scale + SQL + strong consistency in one system
- Raft/Paxos quorum per shard → linearizable, fault-tolerant writes
- Spanner TrueTime gives globally consistent timestamps; CockroachDB uses HLCs
- Cost: quorum/2PC latency and operational complexity — justify with a real scale+consistency need


```sql
-- CockroachDB: SQL surface is familiar; scale is transparent
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
) LOCALITY REGIONAL BY ROW;  -- pin rows to a region for latency
```

**Follow-ups**
- Why does a cross-region transaction in CockroachDB cost more latency than a local one?
- When is Vitess (sharded MySQL) a better fit than CockroachDB?

---

#### 9. How does Vitess differ from CockroachDB/Spanner, and when would you choose it?

*Difficulty:* 🟠 hard  ·  *Tags:* `vitess`, `mysql`, `sharding`, `newsql`

Vitess is a **sharding and connection-pooling layer in front of vanilla MySQL**, originally built at YouTube. It doesn't reimplement the storage engine; it shards your MySQL data across many instances and routes queries via a proxy (VTGate), handling resharding, query rewriting, and connection pooling. CockroachDB/Spanner are ground-up distributed SQL engines with built-in consensus replication and distributed transactions. Choose **Vitess** when you already run MySQL at large scale, want to keep MySQL semantics, tooling, and operational familiarity, and primarily need horizontal sharding and online resharding without rewriting your stack — cross-shard transactions are limited and best avoided by good shard-key design. Choose **CockroachDB/Spanner** when you want native distributed ACID across shards/regions, automatic rebalancing, and don't have a MySQL legacy to preserve. Vitess is evolutionary (scale what you have); distributed SQL is revolutionary (new engine, stronger cross-shard guarantees).

**Key points**
- Vitess = sharding/proxy layer over real MySQL, not a new engine
- Best when you already run MySQL and need horizontal sharding + online resharding
- Cross-shard transactions limited — design shard keys to avoid them
- CockroachDB/Spanner give native cross-shard ACID at the cost of being a new system

**Follow-ups**
- How does VTGate route a query to the right shard?
- What makes online resharding hard, and how does Vitess do it?

---

## Key-Value Stores

#### 10. When is a key-value store the right primary choice, and how do Redis and DynamoDB differ in role? (cross-ref §7)

*Difficulty:* 🟡 medium  ·  *Tags:* `key-value`, `redis`, `dynamodb`

Key-value fits when every access is by a known key and you want predictable O(1) latency — sessions, feature flags, rate-limit counters, caches, user-profile-by-id. You give up ad-hoc querying and joins. **Redis** (§7) is primarily an in-memory store: microsecond latency, rich data structures (sorted sets, streams, HLL), used as cache, queue, lock, leaderboard — durability is optional (RDB/AOF) so treat it as a fast layer, not always the source of truth. **DynamoDB** is a fully-managed, disk-backed, infinitely-scalable KV/document store with single-digit-ms latency, designed as a *durable primary* store for high-scale apps where you can model access patterns up front. Rule of thumb: Redis for speed and ephemeral/derived state in front of a source of truth; DynamoDB when you want a serverless, always-on, horizontally-scaling primary KV store and accept query-pattern-first modeling.

**Key points**
- KV fits pure key access; sacrifices ad-hoc queries and joins
- Redis: in-memory, rich structures, cache/queue/lock — often a fast layer not the truth
- DynamoDB: durable, managed, auto-scaling primary KV/document store
- Choose by durability role and operational model (self-run vs serverless)

**Follow-ups**
- When is Redis your source of truth rather than a cache?
- What query patterns are impossible without redesigning a KV schema?

---

#### 11. Explain DynamoDB partition-key design and the hot-partition problem.

*Difficulty:* 🟠 hard  ·  *Tags:* `dynamodb`, `partition-key`, `hot-partition`

DynamoDB shards data by hashing the **partition key**; items with the same partition key (and optional sort key) land on the same physical partition, which has bounded throughput (historically ~1000 WCU / 3000 RCU per partition). A **hot partition** happens when one key value receives disproportionate traffic — e.g. partitioning by `status='active'` or `date=today`, or a celebrity user_id — concentrating load on one partition and causing throttling even though total provisioned capacity is fine. Fixes: choose a **high-cardinality, evenly-accessed** partition key (user_id, order_id, a UUID); add **write sharding** by suffixing the key with a random/computed shard number for unavoidable hot keys (`metric#0..#9`) and fan-in on read; use composite keys so access spreads. Adaptive capacity helps somewhat automatically but doesn't excuse a low-cardinality key. The lesson generalizes to all hash-sharded stores: the partition key must distribute both data *and* traffic uniformly.

**Key points**
- Data is hashed by partition key; each partition has a throughput ceiling
- Hot partition = skewed traffic to one key value → throttling despite spare total capacity
- Pick high-cardinality, evenly-accessed keys; write-shard unavoidable hot keys
- Same principle applies to any hash-sharded system (Cassandra, etc.)

**Follow-ups**
- How do you read back data that you write-sharded across 10 suffixes?
- What's the difference between a hot partition and exceeding table-level capacity?

---

#### 12. What is single-table design in DynamoDB, and when is it worth the complexity?

*Difficulty:* 🔴 staff  ·  *Tags:* `dynamodb`, `single-table-design`, `data-modeling`

Single-table design stores multiple entity types (users, orders, order-items) in **one** DynamoDB table, using overloaded generic partition/sort keys (PK/SK) plus item-type discriminators so that one query can fetch a whole object graph in a single round-trip — e.g. PK=`USER#123`, with SK=`PROFILE`, `ORDER#001`, `ORDER#002` co-located so 'get user and their orders' is one query, not N. It exists because DynamoDB has no joins; co-locating related items by access pattern is how you avoid multiple requests. You design the keys backward from your known query list, often adding GSIs to support secondary access patterns. It's worth it for high-scale, latency-critical services with **stable, well-understood access patterns** where each saved round-trip and request matters. It's the wrong call when access patterns are evolving or ad-hoc, because every new query may force a new GSI or a remodel — the rigidity is the price of the performance. For most apps, a normalized relational model is more flexible and cheaper to evolve.

**Key points**
- All entities in one table; overloaded PK/SK co-locate related items by access pattern
- Replaces joins — fetch an object graph in one query
- Design keys backward from a fixed list of known queries; GSIs add secondary patterns
- Worth it only when access patterns are stable; rigidity is the cost

**Follow-ups**
- How do GSIs let you support a query the base table's keys can't?
- What signals tell you single-table design was the wrong choice?

---

#### 13. Differentiate GSI vs LSI in DynamoDB, and on-demand vs provisioned capacity.

*Difficulty:* 🟠 hard  ·  *Tags:* `dynamodb`, `gsi`, `lsi`, `capacity`

A **Local Secondary Index (LSI)** shares the table's partition key but uses a different sort key; it must be created at table creation, is strongly-consistent-capable, and shares the item collection's 10GB partition limit. A **Global Secondary Index (GSI)** has a completely different partition and sort key, can be added anytime, is its own partitioned structure with its own throughput, and is **eventually consistent** only. Practically you reach for GSIs far more — they unlock new access patterns on existing data — while LSIs are for alternate sort orders within the same partition key. On capacity: **provisioned** mode means you set RCU/WCU (with optional auto-scaling) — cheapest for steady, predictable traffic. **On-demand** mode charges per request with no capacity planning and instant scaling — ideal for spiky, unpredictable, or new workloads, at a higher per-request price. Start on-demand to learn the pattern, switch to provisioned + auto-scaling once traffic is predictable to cut cost.

**Key points**
- LSI: same PK, different sort key, create-time only, can be strongly consistent
- GSI: different PK+SK, add anytime, own throughput, eventually consistent
- Provisioned: cheap for steady/predictable traffic with auto-scaling
- On-demand: pay-per-request, instant scale, best for spiky/unknown workloads

**Follow-ups**
- Why can a GSI only be eventually consistent?
- What's the cost trap of an over-projected GSI?

---

#### 14. Where do etcd and Consul fit, and why use them instead of a general database?

*Difficulty:* 🟡 medium  ·  *Tags:* `etcd`, `consul`, `coordination`, `config`

etcd and Consul are **distributed, strongly-consistent key-value stores built for coordination and configuration**, not bulk data. etcd (the backing store of Kubernetes) uses Raft for linearizable reads/writes, watches for change notifications, leases for ephemeral keys, and compare-and-swap for atomic updates — perfect for service registration, leader election, distributed locks, and config that must be consistent cluster-wide. Consul adds service discovery, health checking, and a built-in DNS/HTTP interface. You use them over a general database because they're optimized for small, highly-consistent, frequently-watched metadata with built-in primitives (leases, watches, CAS) that you'd otherwise hand-roll. They are **not** for large datasets or high write throughput — etcd holds typically well under a few GB and degrades under heavy write load. So: coordination, config, discovery, leader election → etcd/Consul; everything else → a real database.

**Key points**
- Strongly-consistent (Raft) KV for coordination/config, not bulk data
- Built-in primitives: watches, leases, CAS, leader election
- etcd backs Kubernetes; Consul adds service discovery + health checks
- Keep datasets small — not a general data store

**Follow-ups**
- How would you implement leader election with etcd leases?
- Why does etcd cap practical dataset size?

---

## Document & Wide-Column Stores

#### 15. When does the document model (MongoDB, Couchbase) genuinely fit better than relational? (cross-ref §6)

*Difficulty:* 🟡 medium  ·  *Tags:* `document`, `mongodb`, `couchbase`, `data-modeling`

The document model fits when your data is naturally a **self-contained aggregate** that's read and written as a whole — a product with nested variants, a CMS page, an event payload, a user profile with embedded preferences. Storing it as one JSON/BSON document means no joins to reassemble it and schema can evolve per-document without migrations, which is great for heterogeneous or rapidly-changing shapes. MongoDB (§6) adds horizontal sharding, secondary indexes, and an aggregation pipeline; Couchbase pairs a document store with a built-in memory-first KV cache and N1QL (SQL-for-JSON). It fits poorly when data is highly relational with many-to-many relationships and you need ad-hoc joins and strong cross-entity transactions — you'll end up emulating joins in app code or duplicating data and fighting update anomalies. Decision: embed when you read/write together and the aggregate is bounded; reference (or use relational) when entities are independent and shared. Document DBs trade join power for aggregate locality and schema flexibility.

**Key points**
- Fits self-contained aggregates read/written as a unit — no joins, flexible schema
- Great for heterogeneous, evolving shapes (CMS, profiles, event payloads)
- Poor fit for many-to-many relational data needing ad-hoc joins
- Embed when bounded and read together; reference/relational when shared/independent

**Follow-ups**
- How do you decide embed vs reference for a one-to-many relationship?
- What unbounded-array anti-pattern breaks document modeling?

---

#### 16. Explain the wide-column model (Cassandra/ScyllaDB): ring, tunable consistency, and why it's write-optimized.

*Difficulty:* 🟠 hard  ·  *Tags:* `wide-column`, `cassandra`, `scylladb`, `lsm-tree`

Cassandra/ScyllaDB are **masterless, ring-based** wide-column stores: every node is equal, data is distributed by hashing the partition key onto a token ring, and replicas live on the next N nodes. There's no single point of failure and writes can hit any node (coordinator). **Tunable consistency** lets each query pick how many replicas must respond (ONE, QUORUM, ALL) on read and write independently — you trade consistency for availability/latency per operation, and `R + W > replication_factor` gives you strong consistency when needed. They're **write-optimized** because storage is an **LSM-tree**: writes append to an in-memory memtable + commit log and flush to immutable SSTables sequentially — no random in-place updates, so write throughput is huge and predictable. Reads may touch multiple SSTables (mitigated by bloom filters and compaction). ScyllaDB is a C++ rewrite of Cassandra with a shard-per-core, shared-nothing architecture for far higher per-node throughput and lower tail latency. Choose them for massive write volume, linear horizontal scale, multi-DC availability, and *known* queries.

**Key points**
- Masterless ring, partition-key hashing, replicas on adjacent tokens — no SPOF
- Per-query tunable consistency; R+W>RF for strong consistency
- LSM-tree storage → sequential appends → write-optimized, predictable throughput
- ScyllaDB = shard-per-core C++ Cassandra for higher throughput/lower tail latency

**Follow-ups**
- What is a tombstone and why do too many hurt reads?
- How does QUORUM read after QUORUM write give consistency?

---

#### 17. What does 'query-first modeling' mean in Cassandra, and what does it force you to give up?

*Difficulty:* 🟠 hard  ·  *Tags:* `cassandra`, `query-first`, `data-modeling`

In Cassandra you design tables **around the exact queries you'll run**, not around normalized entities. Because there are no joins and you can only efficiently query by partition key (and sort within it by clustering columns), you list your queries first and create one denormalized table per query pattern — often duplicating the same data across several tables, each keyed for a different access path. This gives blazing reads for those patterns at scale. What you give up: (1) **ad-hoc querying** — a query you didn't model requires a new table and a backfill, or an inefficient ALLOW FILTERING scan; (2) **normalization** — data is duplicated, so updates must touch every copy and you own consistency; (3) **flexible joins/aggregations** — none. The partition key must also spread data and traffic evenly to avoid hot partitions. So Cassandra trades query flexibility for predictable, horizontally-scalable performance — great when access patterns are stable and known, painful when product keeps asking for new query shapes.

**Key points**
- Model tables per known query; one denormalized table per access pattern
- Query only by partition key + clustering columns — no joins
- Cost: no ad-hoc queries, data duplication, app-owned update consistency
- Partition key must distribute data and traffic evenly

**Follow-ups**
- Why is ALLOW FILTERING a red flag in production?
- How do clustering columns control on-disk sort order?

---

#### 18. Where do HBase and Bigtable fit relative to Cassandra?

*Difficulty:* 🟡 medium  ·  *Tags:* `hbase`, `bigtable`, `wide-column`

HBase (open source) and Google Bigtable (managed) are wide-column stores in the Bigtable lineage: sparse, sorted maps keyed by row key, with column families, built on top of a distributed file system (HDFS for HBase, Colossus for Bigtable) and an LSM-tree storage engine. Unlike Cassandra's masterless ring, they are **range-partitioned and master-coordinated** (region servers / tablet servers own contiguous key ranges, assigned by a master), which gives efficient **range scans** over the row key — a natural fit for time-series-by-key, IoT, and Hadoop/analytics-adjacent workloads. They favor consistency (CP) over Cassandra's tunable AP leanings. Choose Bigtable/HBase when you want ordered range scans on a row key at massive scale and are in the GCP/Hadoop ecosystem; choose Cassandra/ScyllaDB when you want masterless multi-DC availability, tunable per-query consistency, and no single coordinator. Both are write-optimized LSM stores with query-first modeling.

**Key points**
- Bigtable lineage: sorted-by-row-key, range-partitioned, master-coordinated (CP)
- Efficient row-key range scans — fits time-series/IoT and Hadoop ecosystems
- Cassandra contrast: masterless ring, tunable AP, no efficient global range scan
- All are LSM-tree, write-optimized, query-first

**Follow-ups**
- Why does range partitioning enable scans that hash partitioning can't?
- What is a region/tablet split and when does it happen?

---

## Columnar / OLAP — ClickHouse Deep Dive

#### 19. Why are analytical scans in ClickHouse so fast? Explain columnar storage, compression, and vectorized execution.

*Difficulty:* 🟠 hard  ·  *Tags:* `clickhouse`, `columnar`, `vectorized`, `compression`

ClickHouse is a **columnar** OLAP database: each column is stored contiguously on disk rather than row-by-row. Three things compound to make scans fast. (1) **Columnar I/O**: an analytical query like `SELECT avg(price) ... GROUP BY day` only reads the `price` and `day` columns — it never touches the other 50 columns of the row, slashing disk reads versus a row store that must read whole rows. (2) **Compression**: a column holds homogeneous values, so codecs (LZ4 by default, ZSTD, plus specialized Delta, DoubleDelta, Gorilla, T64) achieve high ratios — often 5–10x — meaning fewer bytes read and more data in page cache. (3) **Vectorized execution**: ClickHouse processes data in **blocks/batches** of column values through tight CPU loops that exploit SIMD and cache locality, rather than one row at a time, so per-row interpreter overhead disappears. Add a **sparse primary index** (skip granules that can't match) and massive parallelism across cores/shards, and you get billions of rows aggregated per second. The flip side: this design is hostile to point lookups, updates, and OLTP.

**Key points**
- Columnar layout reads only the columns the query needs
- Per-column homogeneity → 5–10x compression (LZ4/ZSTD + Delta/Gorilla codecs)
- Vectorized, SIMD block processing eliminates per-row overhead
- Sparse index + parallelism → billions of rows/sec; bad for point lookups/OLTP


```sql
-- column-level codecs squeeze time-series further
CREATE TABLE metrics (
  ts          DateTime CODEC(DoubleDelta, LZ4),
  device_id   UInt32   CODEC(T64, LZ4),
  value       Float64  CODEC(Gorilla, ZSTD)
) ENGINE = MergeTree
ORDER BY (device_id, ts);
```

**Follow-ups**
- How does the sparse primary index skip data without indexing every row?
- Why does the same design make single-row updates expensive?

---

#### 20. Explain the ClickHouse MergeTree engine: how ORDER BY, the sparse primary index, partitioning, and background merges work.

*Difficulty:* 🔴 staff  ·  *Tags:* `clickhouse`, `mergetree`, `sparse-index`, `partitioning`

MergeTree is the core engine family. Inserts are written as immutable **parts** (sorted on disk by the `ORDER BY` key); a background process continually **merges** small parts into larger ones — that's the 'MergeTree.' The `ORDER BY` key defines on-disk sort order and is the basis of the **primary index**, which is **sparse**: ClickHouse stores one index mark per **granule** (default 8192 rows), not per row, so the index is tiny and lives in memory. A query uses it to skip whole granules whose min/max can't match the WHERE on prefix columns — so putting your most-filtered columns first in ORDER BY is the single biggest performance lever. **PARTITION BY** (commonly by month: `toYYYYMM(date)`) splits data into independent partitions you can drop, detach, or merge in bulk — great for retention (`DROP PARTITION` is instant) but don't over-partition (too many parts hurts). **Skip indexes** (minmax, set, bloom_filter) further prune granules on non-prefix columns. The mental model: sort once by access pattern, index sparsely, partition for lifecycle, and let merges keep the part count low.

**Key points**
- Inserts = immutable sorted parts; background merges consolidate them
- ORDER BY sets on-disk sort; primary index is sparse (one mark per ~8192-row granule)
- Put most-filtered columns first in ORDER BY — biggest performance lever
- PARTITION BY (e.g. by month) for fast retention/DROP; skip indexes prune non-prefix columns; avoid over-partitioning


```sql
CREATE TABLE events (
  event_date  Date,
  event_time  DateTime,
  user_id     UInt64,
  event_type  LowCardinality(String),
  payload     String
) ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_type, user_id, event_time)
SETTINGS index_granularity = 8192;

-- instant retention: drop a whole month
ALTER TABLE events DROP PARTITION '202401';
```

**Follow-ups**
- Why does ORDER BY column order matter more than the choice of columns?
- What goes wrong if PARTITION BY has too-high cardinality?

---

#### 21. When is ClickHouse the WRONG choice? Be specific about its weaknesses.

*Difficulty:* 🟠 hard  ·  *Tags:* `clickhouse`, `anti-patterns`, `selection`, `olap`

ClickHouse is purpose-built for high-throughput analytical scans and is a bad fit for the opposite workloads. Avoid it for: (1) **OLTP / point lookups and single-row reads** — fetching one row by id reads/decompresses whole granules; it's slow and wasteful versus a B-tree store. (2) **Frequent updates/deletes** — MergeTree is immutable-parts; `ALTER ... UPDATE/DELETE` are heavyweight asynchronous **mutations** that rewrite parts, not transactional row updates. (3) **High-concurrency, low-latency transactional traffic** — it's tuned for a modest number of heavy analytical queries, not thousands of tiny concurrent OLTP queries; no real multi-statement ACID transactions. (4) **Frequent small inserts** — each insert makes a part; thousands of tiny inserts create a part explosion that overwhelms merges ('too many parts'). You must **batch** inserts (thousands–hundreds-of-thousands of rows, or buffer/async insert) and accept seconds of latency to visibility. (5) **Strong read-after-write consistency** — replication and merges (ReplacingMergeTree dedup) are eventually consistent. So: ClickHouse for analytics/BI/dashboards over big data; keep your OLTP source of truth in Postgres and stream into ClickHouse.

**Key points**
- Bad at point lookups/single-row reads — decompresses whole granules
- Updates/deletes are async mutations that rewrite parts — not transactional
- Not for high-concurrency OLTP; no real multi-row ACID transactions
- Small frequent inserts cause 'too many parts' — must batch / use async insert; merges and replication are eventually consistent

**Follow-ups**
- What batching strategy keeps part count healthy for streaming ingest?
- How would you serve a point lookup that ClickHouse handles poorly?

---

#### 22. Explain ClickHouse materialized views and the AggregatingMergeTree / SummingMergeTree engines for pre-aggregation.

*Difficulty:* 🔴 staff  ·  *Tags:* `clickhouse`, `materialized-views`, `aggregatingmergetree`, `summingmergetree`

A ClickHouse **materialized view (MV)** is an **insert trigger**, not a cached query: when rows land in the source table, the MV's SELECT runs over just that inserted block and writes the transformed/aggregated result into a target table. This is how you maintain rolling aggregates incrementally at ingest time rather than scanning raw data on every dashboard query. Pair MVs with aggregation engines: **SummingMergeTree** collapses rows with the same sort key by summing numeric columns during merges — ideal for simple additive counters. **AggregatingMergeTree** stores partial aggregate *states* (via `-State` combinators like `sumState`, `uniqState`, `quantileState`) that merges combine, and you finalize with `-Merge` at query time — this supports non-additive aggregates like `uniqExact`, quantiles, and averages correctly. The pattern: raw events table → MV computes per-minute/hour partial states → AggregatingMergeTree rollup table → dashboards query the small rollup, finalizing states. Caveat: aggregation happens *eventually* during merges, so query the rollup with `-Merge`/`GROUP BY` (or `FINAL`) to get correct results before all merges complete.

**Key points**
- MV = insert-time trigger that writes transformed/aggregated rows to a target table
- SummingMergeTree: collapse + sum additive columns on merge
- AggregatingMergeTree: store partial aggregate states (-State) and finalize with -Merge — handles uniq/quantiles/avg
- Aggregation is eventual; finalize with -Merge/GROUP BY/FINAL for correct reads


```sql
CREATE TABLE hits_raw (ts DateTime, page String, user_id UInt64)
ENGINE = MergeTree ORDER BY (page, ts);

CREATE TABLE hits_hourly (
  hour DateTime, page String,
  hits UInt64, uniques AggregateFunction(uniq, UInt64)
) ENGINE = AggregatingMergeTree ORDER BY (page, hour);

CREATE MATERIALIZED VIEW hits_mv TO hits_hourly AS
SELECT toStartOfHour(ts) AS hour, page,
       count() AS hits, uniqState(user_id) AS uniques
FROM hits_raw GROUP BY hour, page;

-- read: finalize the aggregate state
SELECT hour, page, sum(hits), uniqMerge(uniques)
FROM hits_hourly GROUP BY hour, page;
```

**Follow-ups**
- Why must you use uniqMerge on read instead of just uniq?
- What happens to an MV if you alter the source table's schema?

---

#### 23. What problems do ReplacingMergeTree and CollapsingMergeTree solve, and what's the catch?

*Difficulty:* 🟠 hard  ·  *Tags:* `clickhouse`, `replacingmergetree`, `collapsingmergetree`, `eventual-consistency`

Both address the fact that ClickHouse has no in-place updates. **ReplacingMergeTree** deduplicates rows that share the `ORDER BY` key, keeping the one with the highest version column (or the last inserted) — you model an 'update' as inserting a new version and let merges drop the old one. **CollapsingMergeTree** (and VersionedCollapsingMergeTree) uses a `sign` column of +1/-1; inserting a -1 'cancel' row plus a new +1 row lets merges collapse them, effectively expressing deletes/updates. The crucial catch for both: **deduplication/collapsing happens only during background merges, which are asynchronous and not guaranteed to have run**. So between insert and merge you'll see duplicate or stale rows. To get correct results immediately you must either query with the `FINAL` modifier (which merges on the fly and is expensive), or aggregate around it (`argMax(value, version)` / `GROUP BY` with `sum(sign)`), accepting that you handle dedup at query time. They are tools for eventual-consistency 'upserts' in an append-only engine, not a substitute for transactional updates.

**Key points**
- ReplacingMergeTree: dedup by ORDER BY key, keep highest version — models upsert
- CollapsingMergeTree: +1/-1 sign rows collapse to express delete/update
- Catch: dedup/collapse only at merge time — eventual, not immediate
- For correct reads use FINAL (costly) or query-time argMax/sum(sign)


```sql
CREATE TABLE accounts (
  id UInt64, balance Decimal(18,2), version UInt64
) ENGINE = ReplacingMergeTree(version)
ORDER BY id;

-- 'update' = insert a higher version
INSERT INTO accounts VALUES (1, 250.00, 2);

-- correct read without waiting for merges:
SELECT id, argMax(balance, version) AS balance
FROM accounts GROUP BY id;
```

**Follow-ups**
- Why is SELECT ... FINAL discouraged on hot paths?
- How does VersionedCollapsingMergeTree fix out-of-order sign rows?

---

#### 24. How do distributed tables and sharding work in ClickHouse, and how do you handle replication?

*Difficulty:* 🔴 staff  ·  *Tags:* `clickhouse`, `sharding`, `distributed-table`, `replication`

ClickHouse scales horizontally with **shards** (data split across nodes) and **replicas** (copies within a shard for HA). A **Distributed table** is a thin routing layer: it holds no data itself but fans queries out to the underlying local MergeTree tables on every shard, runs partial aggregation on each shard, and merges results on the initiator — so a `GROUP BY` is computed in parallel across shards. You insert either through the Distributed table (it routes rows by a **sharding key**, ideally high-cardinality and aligned with your common GROUP BY to enable shard-local aggregation) or directly into each shard for control. Replication is per-table via **ReplicatedMergeTree**, which coordinates through ClickHouse Keeper (or ZooKeeper): replicas pull parts from each other and stay eventually consistent, surviving node loss. Key design points: pick a sharding key that distributes evenly and co-locates data you join/aggregate together (to avoid cross-shard shuffles); choose replication factor for HA; and remember reads of just-inserted data may be eventually consistent across replicas. This is how ClickHouse serves petabyte-scale analytics.

**Key points**
- Distributed table = stateless router that scatter-gathers across shards with partial aggregation
- Sharding key should be high-cardinality and aligned with common GROUP BY for shard-local aggregation
- ReplicatedMergeTree + ClickHouse Keeper/ZooKeeper for HA replicas (eventually consistent)
- Co-locate joined/aggregated data on the same shard to avoid cross-shard shuffles


```sql
-- local table on every node
CREATE TABLE events_local ON CLUSTER ck (...)
ENGINE = ReplicatedMergeTree('/ch/tables/{shard}/events','{replica}')
ORDER BY (event_type, event_time);

-- distributed routing layer
CREATE TABLE events ON CLUSTER ck AS events_local
ENGINE = Distributed(ck, default, events_local, cityHash64(user_id));
```

**Follow-ups**
- What causes a cross-shard shuffle and how do you avoid it for JOINs?
- Why is ClickHouse Keeper preferred over ZooKeeper now?

---

#### 25. Compare ClickHouse to Redshift, BigQuery, and Snowflake. When would you pick the cloud warehouses instead?

*Difficulty:* 🟠 hard  ·  *Tags:* `clickhouse`, `bigquery`, `snowflake`, `redshift`, `olap`

All are columnar OLAP engines; the difference is operating model and architecture. **ClickHouse** is open-source, self-hostable (or ClickHouse Cloud), tuned for blazing low-latency queries and real-time ingest — you control hardware/cost and it excels at sub-second dashboards and high-ingest analytics, but you (or the managed offering) own schema and cluster design. **Redshift** is AWS's MPP warehouse — classic provisioned clusters (now with serverless and managed storage); good when you're deep in AWS and want a traditional warehouse, though tuning (dist/sort keys) is real work. **BigQuery** is fully serverless, separates storage and compute, charges per bytes scanned (or slots), and needs zero cluster management — ideal for spiky, ad-hoc, petabyte analytics where you don't want to run anything. **Snowflake** also separates storage and compute with elastic per-warehouse scaling, excellent concurrency isolation and data sharing, multi-cloud. Pick the cloud warehouses when you want **zero operational burden, elastic on-demand compute, and easy scaling** and can accept higher/usage-based cost and higher per-query latency. Pick **ClickHouse** when you need the lowest latency, real-time ingest, cost control at high query volume, or want to self-host. Rule: ClickHouse for real-time/low-latency analytics you operate; BigQuery/Snowflake for serverless, elastic, low-ops warehousing.

**Key points**
- All columnar MPP OLAP; differ in ops model and pricing
- ClickHouse: lowest latency, real-time ingest, self-host/cost-control — you own design
- BigQuery/Snowflake: serverless, storage/compute separation, elastic, near-zero ops, usage-based cost
- Redshift: AWS-native MPP warehouse with manual dist/sort tuning
- Choose by latency need vs operational appetite and cost model

**Follow-ups**
- How does separation of storage and compute change scaling and cost?
- Why can ClickHouse beat BigQuery on dashboard latency?

---

#### 26. When would you choose Apache Druid or Apache Pinot over ClickHouse for real-time OLAP?

*Difficulty:* 🔴 staff  ·  *Tags:* `druid`, `pinot`, `clickhouse`, `real-time-olap`

Druid, Pinot, and ClickHouse all serve real-time OLAP, but Druid and Pinot are purpose-built for **user-facing analytics at very high query concurrency with sub-second latency on streaming data** — think powering an in-product analytics dashboard hit by thousands of concurrent users. They natively integrate with Kafka for **streaming ingestion** (rows are queryable within seconds), pre-build inverted/bitmap indexes and roll-ups, and are designed around tight latency SLAs at high QPS. **Pinot** especially targets the lowest-latency, highest-concurrency user-facing case (born at LinkedIn for member-facing analytics) with star-tree indexes for fast aggregations. **Druid** offers a mature segment-based architecture with strong time-based partitioning and approximate aggregations. **ClickHouse** is more general and SQL-rich, superb for ad-hoc analytical exploration, complex queries, and high-throughput batch+stream ingest, and often cheaper to run, but it isn't optimized for thousands of concurrent sub-second point-aggregation queries the way Pinot is. So: choose Pinot/Druid for high-concurrency, streaming, user-facing dashboards with strict latency SLAs; choose ClickHouse for flexible SQL analytics, complex ad-hoc queries, and lower operational complexity. Many shops actually pick ClickHouse first for its versatility and only reach for Pinot/Druid when concurrency/latency at the user-facing edge demands it.

**Key points**
- Druid/Pinot: user-facing, very high concurrency, sub-second, native Kafka streaming ingest
- Pinot: lowest-latency/highest-QPS (star-tree indexes); Druid: segment-based, time-partitioned, approximate aggregates
- ClickHouse: richer SQL, complex/ad-hoc analytics, simpler ops, often cheaper
- Pick Pinot/Druid for high-concurrency user-facing dashboards; ClickHouse for flexible analytics

**Follow-ups**
- Why does high query concurrency push you toward Pinot over ClickHouse?
- How does Kafka-native ingestion change your CDC/ETL design?

---

## Time-Series, Search, Graph & Vector

#### 27. When does a purpose-built time-series database beat a generic one? Compare TimescaleDB, InfluxDB, and Prometheus.

*Difficulty:* 🟡 medium  ·  *Tags:* `time-series`, `timescaledb`, `influxdb`, `prometheus`

Time-series workloads are append-heavy, timestamp-ordered, rarely updated, queried by time ranges, and benefit from downsampling and retention. A purpose-built TSDB beats a generic store when you need automatic time-partitioning, fast range/aggregation queries over huge volumes, efficient compression of timestamp/value pairs, retention policies, and continuous downsampling. **TimescaleDB** is a PostgreSQL extension: you keep full SQL, joins, and the Postgres ecosystem while it transparently partitions tables into **hypertables** (chunked by time), adds columnar compression and continuous aggregates — ideal when you want time-series *plus* relational data and SQL. **InfluxDB** is a dedicated TSDB with a tag/field data model and purpose-built query languages, good for metrics/IoT where you don't need relational joins. **Prometheus** has its own pull-based TSDB optimized for operational monitoring/alerting — short-to-medium retention, PromQL, and the cloud-native ecosystem; it's a metrics system, not a general data store (use Thanos/Mimir/Cortex for long-term/HA). Choose Timescale when SQL+relational matters, Influx for standalone IoT/metrics, Prometheus for infra monitoring.

**Key points**
- TSDBs win on time-partitioning, range/aggregation speed, compression, retention, downsampling
- TimescaleDB: Postgres extension — full SQL + hypertables + continuous aggregates
- InfluxDB: dedicated tag/field TSDB for metrics/IoT
- Prometheus: pull-based monitoring TSDB + PromQL, not a general store

**Follow-ups**
- What is a continuous aggregate and how does it differ from a ClickHouse MV?
- Why is Prometheus' local TSDB unsuitable as a long-term store?

---

#### 28. When do you reach for a search engine (Elasticsearch/OpenSearch) versus a database's built-in full-text? (cross-ref §8)

*Difficulty:* 🟡 medium  ·  *Tags:* `search`, `elasticsearch`, `opensearch`, `full-text`

Use a database's built-in full-text (Postgres `tsvector`/GIN, MySQL FULLTEXT) when search is a secondary feature: modest corpus, simple keyword matching, and you value keeping data in one consistent store with no extra system to operate. Reach for a dedicated **search engine** (Elasticsearch/OpenSearch, §8) when search is a first-class product feature needing **relevance ranking** (BM25/TF-IDF), tunable analyzers (stemming, synonyms, language-specific tokenization), fuzzy/typo tolerance, autocomplete, faceted/aggregated search, and high query throughput over large text corpora. They build **inverted indexes** purpose-built for this and scale horizontally. The cost is real: it's a separate distributed system you must operate, and it's typically a **secondary, denormalized index** fed from your source of truth (via CDC/ETL), so you own keeping it in sync and accept eventual consistency. Rule: if relevance scoring, analyzers, and search-as-product matter at scale, use a search engine as a derived index; otherwise Postgres FTS keeps your architecture simpler.

**Key points**
- Built-in FTS (Postgres GIN) for modest, secondary keyword search in one store
- Search engine for relevance ranking, analyzers, fuzzy/autocomplete, facets at scale
- Inverted index, horizontal scale — but a separate system to operate
- Usually a derived, denormalized index fed by CDC/ETL — eventual consistency

**Follow-ups**
- How do you keep Elasticsearch in sync with the Postgres source of truth?
- What does an analyzer do that Postgres FTS doesn't easily?

---

#### 29. When does a graph database (Neo4j, Dgraph) justify itself over recursive SQL?

*Difficulty:* 🟠 hard  ·  *Tags:* `graph`, `neo4j`, `dgraph`, `traversal`

A graph database earns its place when your **core queries are deep, variable-length relationship traversals** — friends-of-friends-of-friends, shortest path, fraud rings, recommendation paths, dependency/impact analysis — where the answer depends on traversing many hops and the traversal depth varies at query time. In a relational store, each hop is a self-join; an N-hop query becomes N joins, and the planner's cost explodes as the graph grows, because relational engines aren't optimized for pointer-chasing across rows. Graph databases use **index-free adjacency**: a node directly references its neighbors, so traversing an edge is O(1) regardless of total graph size, and query languages (Cypher in Neo4j, DQL in Dgraph) express traversals declaratively (`MATCH (a)-[:KNOWS*2..4]->(b)`). Dgraph adds horizontal sharding/distribution and a GraphQL-style interface. The trade-off: graph DBs are a specialized store to operate and weaker for the tabular aggregations relational/columnar stores excel at. Reach for one when relationship traversal *is* the workload; for a few fixed-depth joins or mostly-tabular data, recursive CTEs in Postgres are simpler and sufficient.

**Key points**
- Justified by deep, variable-depth relationship traversals (paths, rings, recommendations)
- Relational N-hop = N self-joins; cost explodes as graph grows
- Graph DBs use index-free adjacency → O(1) edge traversal regardless of size
- Cypher/DQL express traversals declaratively; overkill for shallow/fixed joins

**Follow-ups**
- What is index-free adjacency and why does it beat join-based traversal?
- When is a Postgres recursive CTE the right answer instead?

---

#### 30. What are vector databases for, and how do you choose among pgvector, Pinecone, Milvus, Weaviate, and Qdrant?

*Difficulty:* 🟠 hard  ·  *Tags:* `vector`, `pgvector`, `pinecone`, `milvus`, `qdrant`, `ann`, `rag`

Vector databases store high-dimensional **embeddings** and answer **nearest-neighbor similarity** queries — the backbone of semantic search, recommendations, and **RAG** (retrieve relevant chunks by embedding similarity to feed an LLM). Exact nearest-neighbor over millions of vectors is too slow, so they use **Approximate Nearest Neighbor (ANN)** indexes — **HNSW** (graph-based, great recall/latency, higher memory) or **IVF/IVF-PQ** (cluster-then-search, compresses with product quantization) — trading a little recall for big speedups. Choosing: **pgvector** is a Postgres extension — keep vectors next to your relational data, transactions, and filters in one store; ideal up to moderate scale and when you already run Postgres (the default 'don't add a new system' choice). **Qdrant**, **Milvus**, **Weaviate** are dedicated vector engines for large scale, high QPS, advanced filtering and hybrid (vector+keyword) search, and billions of vectors — Milvus for massive scale, Qdrant for a lean fast Rust engine, Weaviate for built-in modules/hybrid search. **Pinecone** is fully managed/serverless — zero ops, you pay for convenience. Rule: start with pgvector if you run Postgres and scale is moderate; graduate to a dedicated/managed vector store when scale, QPS, or advanced filtering demand it.

**Key points**
- Store embeddings; answer ANN similarity for semantic search/recommendations/RAG
- ANN indexes: HNSW (graph, high recall, more memory) vs IVF/IVF-PQ (cluster + quantization)
- pgvector: keep vectors in Postgres with your relational data — default for moderate scale
- Milvus/Qdrant/Weaviate (self-host, large scale, hybrid search) or Pinecone (managed/serverless)


```sql
-- pgvector: embeddings beside relational data, ANN via HNSW
CREATE EXTENSION vector;
CREATE TABLE docs (
  id bigserial PRIMARY KEY,
  content text,
  embedding vector(1536)
);
CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops);

-- top-5 semantic matches
SELECT id, content
FROM docs
ORDER BY embedding <=> '[...]'::vector
LIMIT 5;
```

**Follow-ups**
- Explain the recall vs latency vs memory trade-off of HNSW vs IVF-PQ.
- When does pgvector stop being enough and you migrate to a dedicated store?

---

#### 31. When is object storage (S3/MinIO) the right 'database', and what is a data lake?

*Difficulty:* 🟡 medium  ·  *Tags:* `object-storage`, `s3`, `minio`, `data-lake`, `lakehouse`

Object storage (S3, GCS, MinIO self-hosted) is the right store for **large immutable blobs** — images, videos, backups, ML artifacts, logs, and big analytical files — that you address by key, not query by content. It's effectively infinite, cheap, durable (11 nines), and decoupled from compute, but it offers no transactions, no joins, eventual-consistency semantics historically, and per-object (not row) access — so never put it where you need transactional row queries. A **data lake** is exactly this: raw and processed data dumped into object storage in open columnar formats (Parquet/ORC) and queried in place by external engines (Athena/Trino/Spark/ClickHouse) — schema-on-read, store-everything-cheap, decide structure later. Contrast a **data warehouse** (structured, schema-on-write, optimized for SQL analytics). The modern **lakehouse** (Delta Lake, Apache Iceberg, Hudi) adds a transactional metadata layer over Parquet-on-S3 to give ACID, schema evolution, and time travel — warehouse-like reliability on lake-like cheap storage. Use object storage for blobs and as the durable foundation of a lake/lakehouse; never as your OLTP store.

**Key points**
- S3/MinIO for large immutable blobs addressed by key — cheap, durable, infinite, decoupled compute
- No transactions/joins/row queries — wrong for OLTP
- Data lake = raw/processed data as Parquet/ORC on object storage, schema-on-read, queried by external engines
- Lakehouse (Iceberg/Delta/Hudi) adds ACID + schema evolution + time travel over Parquet-on-S3

**Follow-ups**
- Why is Parquet the format of choice for analytical lakes?
- What does Iceberg's metadata layer add over plain Parquet files?

---

## Storage Engines, Sync & OLTP vs OLAP

#### 32. Contrast B-tree and LSM-tree storage engines, and explain how the choice maps onto real databases.

*Difficulty:* 🟠 hard  ·  *Tags:* `storage-engine`, `b-tree`, `lsm-tree`, `internals`

These are the two dominant on-disk structures, and they encode a read-vs-write trade-off. A **B-tree** keeps data sorted in fixed pages and updates **in place**: a write finds the leaf page and modifies it, so it's **read-optimized** (a lookup is a few page reads, predictable low read amplification) but writes do random I/O and page splits, and you pay write amplification via the WAL + in-place updates. PostgreSQL, MySQL/InnoDB, and most classic OLTP engines are B-tree based — great for read-heavy transactional workloads with point lookups and range scans. An **LSM-tree** (log-structured merge) buffers writes in an in-memory memtable + sequential commit log, then flushes **immutable sorted runs (SSTables)** to disk, merging them later via **compaction**. Writes are sequential and cheap → **write-optimized**, but a read may check several SSTables (mitigated by bloom filters), giving higher read amplification, and compaction adds background I/O/space amplification. Cassandra, ScyllaDB, RocksDB/LevelDB, HBase, and ClickHouse's MergeTree are LSM-style — built for heavy ingest. Rule of thumb: read-heavy/transactional → B-tree (Postgres/MySQL); write-heavy/high-ingest → LSM (Cassandra/RocksDB/ClickHouse).

**Key points**
- B-tree: in-place updates, sorted pages — read-optimized, predictable reads (Postgres, MySQL/InnoDB)
- LSM-tree: buffer + immutable SSTables + compaction — write-optimized, sequential writes (Cassandra, RocksDB, ClickHouse)
- Trade-off: B-tree write amplification vs LSM read/space amplification (compaction)
- Map selection: read-heavy OLTP → B-tree; write-heavy ingest → LSM

**Follow-ups**
- What are read, write, and space amplification, and how does compaction strategy trade them?
- How do bloom filters reduce LSM read amplification?

---

#### 33. Explain the dual-write problem and how the outbox pattern with CDC (Debezium) solves keeping stores in sync.

*Difficulty:* 🔴 staff  ·  *Tags:* `cdc`, `debezium`, `outbox`, `dual-write`, `sync`

The **dual-write problem**: when application code writes the same fact to two systems (e.g. `INSERT into Postgres` then `publish to Kafka`, or write DB then update search index), there's no shared transaction — if the process crashes between the two writes, or the second fails, the systems diverge silently. Retries can cause duplicates; ordering can be lost. You cannot fix this with two separate writes, because there's no atomicity across systems. The robust solution is the **transactional outbox**: in the **same database transaction** that changes business state, insert an event row into an `outbox` table. The write is now atomic — either both the state change and the event commit, or neither. A separate relay then reliably publishes those outbox rows downstream, ideally via **Change Data Capture**: a tool like **Debezium** tails the database's WAL/binlog and streams committed changes (including outbox inserts) to Kafka with at-least-once delivery and ordering. CDC means you never poll or dual-write — you derive downstream state (search index, cache, ClickHouse warehouse) from the database's own commit log, with the OLTP store as the single source of truth. Consumers must be idempotent to handle at-least-once redelivery.

**Key points**
- Dual-write: two non-transactional writes → silent divergence on partial failure
- Outbox: write event into an outbox table in the same DB transaction → atomic
- CDC (Debezium) tails WAL/binlog and streams committed changes to Kafka — no polling/dual-write
- Source of truth = the DB commit log; consumers must be idempotent (at-least-once)


```sql
BEGIN;
  UPDATE orders SET status = 'shipped' WHERE id = 42;
  INSERT INTO outbox (aggregate_id, event_type, payload)
  VALUES (42, 'OrderShipped', '{"id":42,"status":"shipped"}');
COMMIT;
-- Debezium tails the WAL, publishes the outbox row to Kafka,
-- and consumers update the search index / ClickHouse / cache.
```

**Follow-ups**
- Why must downstream consumers be idempotent under CDC?
- How does CDC ordering interact with multiple Kafka partitions?

---

#### 34. How do you load OLTP data into an analytical warehouse, and what's the difference between ETL and ELT?

*Difficulty:* 🟡 medium  ·  *Tags:* `etl`, `elt`, `warehouse`, `ingestion`, `dbt`

You move data from the transactional source of truth into the warehouse (ClickHouse, BigQuery, Snowflake) either by **batch** (periodic snapshots/incremental loads) or **streaming** via CDC (Debezium → Kafka → warehouse) for near-real-time freshness. The historical pattern is **ETL**: Extract from sources, **Transform** in a separate processing tier (clean, join, aggregate), then **Load** the finished, structured data into the warehouse — used when storage/compute were expensive and you only loaded modeled data. **ELT** flips the last two steps: Extract, **Load raw data first** into a cheap, scalable warehouse/lake, then **Transform inside** the warehouse using its compute (often with tools like dbt). ELT dominates today because cloud warehouses make storage cheap and in-warehouse compute powerful, so you keep raw fidelity, can re-transform when requirements change, and avoid a separate ETL cluster. For ClickHouse specifically, remember its ingest constraints: batch inserts and let materialized views do in-warehouse aggregation — an ELT-style approach. Choose streaming CDC for freshness-critical analytics, batch ELT for cost-efficient periodic reporting.

**Key points**
- Load via batch snapshots/incremental or streaming CDC for near-real-time
- ETL: transform before load (separate tier) — legacy, storage-scarce era
- ELT: load raw then transform in-warehouse (dbt) — dominant with cheap cloud storage/compute
- ELT keeps raw fidelity and re-transformability; for ClickHouse, batch + MVs do in-warehouse aggregation

**Follow-ups**
- Why has ELT largely replaced ETL in modern stacks?
- How does CDC change the freshness ceiling of warehouse data?

---

#### 35. Define OLTP, OLAP, and HTAP, and explain the source-of-truth principle in a polyglot architecture.

*Difficulty:* 🟡 medium  ·  *Tags:* `oltp`, `olap`, `htap`, `source-of-truth`

**OLTP** (Online Transaction Processing) is many small, low-latency read/write transactions on current operational data — orders, payments, profiles — row-oriented, ACID, indexed for point lookups (PostgreSQL, MySQL). **OLAP** (Online Analytical Processing) is few but huge, scan/aggregate-heavy read queries over historical data for BI/reporting — column-oriented, optimized for throughput not single-row latency (ClickHouse, BigQuery, Snowflake). You separate them because their physical layouts are opposite: a row store for transactions, a column store for analytics, and running heavy analytics on your OLTP database degrades transactional performance. **HTAP** (Hybrid Transactional/Analytical Processing) tries to serve both in one system (TiDB, SingleStore, Spanner+analytics) to avoid ETL lag, usually by keeping a row store and a column replica internally — convenient for fresh analytics but rarely matches a dedicated columnar store at extreme analytical scale. The **source-of-truth principle** ties it together: designate exactly one authoritative store per piece of data (usually the OLTP database). All other stores — search index, cache, warehouse — are **derived**, kept in sync one-directionally via CDC/ETL, and rebuildable from the source. This prevents divergence, makes recovery easy (rebuild the derived store), and means writes always go to the source of truth, never to a derived copy.

**Key points**
- OLTP: many small ACID transactions, row store, point lookups (Postgres/MySQL)
- OLAP: few huge scan/aggregate queries, column store (ClickHouse/BigQuery/Snowflake)
- HTAP: one system for both (TiDB/SingleStore) — convenient, rarely beats dedicated OLAP at scale
- Source-of-truth: one authoritative store; all others derived, one-way synced, rebuildable

**Follow-ups**
- Why does running OLAP queries on your OLTP primary hurt transactions?
- When is HTAP worth it over OLTP + CDC-to-OLAP?

---

#### 36. Differentiate data warehouse, data lake, and lakehouse, and when you'd choose each.

*Difficulty:* 🟠 hard  ·  *Tags:* `warehouse`, `data-lake`, `lakehouse`, `iceberg`, `architecture`

A **data warehouse** stores structured, cleaned, modeled data optimized for SQL analytics — **schema-on-write** (you define structure before loading) on columnar storage (Snowflake, BigQuery, Redshift, ClickHouse). It gives fast, reliable BI/reporting and governance, but loading requires up-front modeling and it's less suited to raw/unstructured data. A **data lake** stores raw data of any shape — structured, semi-structured, unstructured — cheaply on object storage (S3) in open formats (Parquet/JSON), **schema-on-read** (interpret structure at query time). It's flexible and cheap and feeds ML/exploration, but without governance becomes a 'data swamp' with no ACID, quality, or reliable querying. The **lakehouse** (Delta Lake, Apache Iceberg, Apache Hudi) is the convergence: a transactional metadata/table layer over Parquet-on-object-storage that adds **ACID, schema evolution, time travel, and warehouse-grade SQL** while keeping the lake's cheap, open, decoupled storage — so one copy of data serves BI and ML. Choose a warehouse for structured, governed BI with strict SQL performance; a lake for cheap raw storage and ML/exploration; a lakehouse when you want one architecture giving warehouse reliability on lake economics. Increasingly the lakehouse is the default for new analytics platforms.

**Key points**
- Warehouse: structured, schema-on-write, columnar — fast governed BI (Snowflake/BigQuery)
- Lake: raw any-shape data, schema-on-read, cheap object storage — flexible but risks 'data swamp'
- Lakehouse: ACID + schema evolution + time travel over Parquet-on-S3 (Iceberg/Delta/Hudi) — warehouse reliability on lake economics
- Choose by structure/governance needs vs raw-data flexibility and cost

**Follow-ups**
- What turns a data lake into a 'data swamp' and how does the lakehouse prevent it?
- How do Iceberg table formats provide ACID over immutable Parquet files?

---
