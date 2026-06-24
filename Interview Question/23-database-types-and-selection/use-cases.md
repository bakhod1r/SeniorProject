# Database Types — Real-World Use Cases

How each database family is actually used in production, with well-documented examples from real engineering teams. In a senior interview, naming a concrete case ("Discord moved billions of messages from Cassandra to ScyllaDB") is far more convincing than reciting features. Use these to anchor your "when would you choose X" answers.

> Note: company examples reflect publicly shared engineering decisions and can change over time. The point is the *pattern*, not that a given company still runs exactly this today.

---

## Relational / OLTP — PostgreSQL, MySQL

**What it's for:** the system of record for transactional data that needs ACID, joins, and integrity — orders, payments, users, inventory.

**Real cases:**
- **GitHub, Shopify, Slack** run core data on **MySQL**, scaled horizontally with **Vitess** (sharding/routing layer) once a single primary hit its ceiling.
- **Instagram** famously scaled **PostgreSQL** for its core (plus Cassandra for feeds); **Notion** and **Figma** shard PostgreSQL to handle massive document/workspace data.
- **Stripe** uses relational stores as the backbone for financial ledgers where correctness is non-negotiable.

**Why chosen:** strong consistency, mature tooling, flexible ad-hoc queries, and transactions across multiple entities. The ceiling is single-node write throughput — which is why these teams reach for Vitess/sharding rather than switching engines.

**Interview line:** "Default to Postgres for OLTP; reach past it only when a measured write/connection ceiling forces sharding or a different consistency model."

---

## NewSQL / Distributed SQL — CockroachDB, Spanner, YugabyteDB, Vit.ess

**What it's for:** you want SQL + ACID *and* horizontal scale + geo-distribution + survive-a-zone-failure, without manual sharding.

**Real cases:**
- **Google** runs ad and core systems on **Spanner**, which uses TrueTime (atomic-clock + GPS) for globally consistent transactions.
- **CockroachDB** is used by companies needing multi-region OLTP with strong consistency (Raft under the hood) — fintechs and SaaS that can't lose data on a regional outage.

**Why chosen:** Raft/Paxos replication gives strong consistency across nodes/regions; SQL keeps the developer model familiar. **Cost:** higher write latency (consensus round-trips), operational complexity. Don't pay for it unless you genuinely need multi-region strong consistency.

---

## Key-Value — Redis, DynamoDB

**What it's for:** ultra-low-latency lookups by key; caching, sessions, counters, queues, leaderboards.

**Real cases:**
- **Redis** is the near-universal cache/session store — **Twitter, GitHub, Stack Overflow** use it for caching and rate limiting; leaderboards (sorted sets) power game/ranking features.
- **Amazon DynamoDB** was born from the Dynamo paper to power the **Amazon** shopping cart at scale; **Lyft, Snapchat, Disney+** use it for predictable single-digit-ms access at massive scale.

**Why chosen:** predictable latency at any scale when access is by key. **Trap:** DynamoDB punishes bad partition-key design (hot partitions) and is awkward for ad-hoc queries; Redis is memory-bound and (by default) not your source of truth.

**Interview line:** "DynamoDB is fantastic when access patterns are known up front and modeled into the key; painful when requirements demand flexible queries later."

---

## Document — MongoDB, Couchbase

**What it's for:** flexible, evolving, self-contained documents read/written as a whole; rapid iteration when the schema isn't settled.

**Real cases:**
- **MongoDB** powers content/catalog and rapidly-evolving product data at many startups; used where the access pattern is "fetch this whole document by id."
- **The Guardian** migrated its content platform to MongoDB for flexible article documents.

**Why chosen:** developer velocity, schema flexibility, natural fit for hierarchical data. **Trap:** people pick it to "avoid schema design," then need cross-document joins/transactions and rediscover why relational exists. Model for your read patterns, not for convenience.

---

## Wide-Column — Cassandra, ScyllaDB, HBase/Bigtable

**What it's for:** write-heavy, massive-scale, always-on workloads with known query patterns and tunable consistency; time-stamped or partitioned data.

**Real cases:**
- **Netflix** runs huge **Cassandra** fleets for viewing data and telemetry — write-optimized, multi-region, no single point of failure.
- **Discord** stored **billions of messages** in Cassandra, then migrated to **ScyllaDB** (C++ rewrite, same model) to cut tail latency and node count.
- **Apple, Uber** run some of the largest Cassandra deployments; **Bigtable** powers Google Search/Maps/Analytics internals.

**Why chosen:** linear write scalability, LSM-tree write path, AP-leaning availability, multi-DC replication. **Cost:** query-first modeling (you design tables per query, no ad-hoc joins), eventual consistency, and read-before-write/tombstone pitfalls.

---

## Columnar / OLAP — ClickHouse (deep), Druid, Pinot, BigQuery, Redshift, Snowflake

**What it's for:** analytical queries that scan and aggregate billions of rows — dashboards, reporting, event analytics, observability. This is the **BI/analytics** angle of the job.

**Real cases — ClickHouse:**
- **Cloudflare** processes **millions of rows/sec** of HTTP/DNS analytics in ClickHouse to power customer-facing dashboards.
- **Uber** uses ClickHouse for real-time analytics/observability; **Sentry** moved event search/aggregation to ClickHouse; **GitLab, Cloudflare, eBay, Spotify** use it for log/event analytics.
- ClickHouse routinely replaces slow Elasticsearch or Postgres reporting setups when the workload is "aggregate huge ranges fast."

**Real cases — others:**
- **Netflix** built real-time dashboards on **Apache Druid**; **LinkedIn** created **Apache Pinot** for user-facing real-time analytics ("Who viewed your profile").
- **Spotify, Twitter** use **BigQuery** for warehouse-scale analytics; many enterprises standardize on **Snowflake**.

**Why ClickHouse is fast:** columnar storage (read only needed columns), heavy compression, vectorized execution, and a **sparse primary index** over the `ORDER BY` key via the MergeTree engine.

**When ClickHouse is the WRONG choice:** point lookups/updates/deletes, high-concurrency OLTP, frequent tiny inserts (you must batch), or needing strong transactional consistency. It's an analytics engine, not your order-of-record.

**Interview line:** "Keep OLTP in Postgres; stream changes (CDC/Kafka) into ClickHouse for analytics. Don't run heavy reporting queries against the transactional database."

---

## Time-Series — TimescaleDB, InfluxDB, Prometheus

**What it's for:** metrics, IoT sensor data, financial ticks — append-heavy, time-ordered, queried over time ranges with downsampling/retention.

**Real cases:**
- **Prometheus** TSDB is the de-facto standard for infrastructure metrics in Kubernetes shops.
- **TimescaleDB** (a Postgres extension with hypertables) is used where teams want time-series performance *and* SQL/joins with their relational data.
- **InfluxDB** powers IoT and DevOps monitoring dashboards.

**Why chosen:** time-partitioning, automatic retention/rollups, and compression tuned for time-ordered inserts — things a generic DB handles poorly at scale.

---

## Search — Elasticsearch / OpenSearch

**What it's for:** full-text search, relevance ranking, faceted search, and log analytics (the "E" in ELK).

**Real cases:**
- **GitHub** code search, **Uber** and **Tinder** search features, and countless e-commerce product searches run on Elasticsearch.
- **The ELK/Elastic stack** is ubiquitous for centralized log search and observability.

**Why chosen:** inverted index + BM25 relevance + aggregations beat `LIKE '%...%'` in any real DB. **Pattern:** Elasticsearch is a *secondary* index synced from a source-of-truth DB (via CDC), never the system of record.

---

## Graph — Neo4j, Dgraph

**What it's for:** queries dominated by traversing relationships — fraud rings, recommendations, social graphs, dependency/permission graphs.

**Real cases:**
- **Neo4j** is used for fraud detection (following money/identity links), network/IT topology, and recommendation engines.
- Many social/identity platforms model "friends-of-friends"-style traversals where recursive SQL joins explode.

**Why chosen:** multi-hop traversals are O(relationship) instead of repeated expensive joins. **Trap:** if your queries aren't actually graph-shaped, a relational DB with a recursive CTE is simpler and cheaper.

---

## Vector Databases — pgvector, Pinecone, Milvus, Weaviate, Qdrant

**What it's for:** semantic search, recommendations, and **RAG** (retrieval-augmented generation) over embeddings — nearest-neighbor search in high-dimensional space.

**Real cases:**
- AI products use vector stores to find "documents similar in meaning" for LLM context; **pgvector** lets teams add this to existing Postgres without a new system.
- Dedicated stores (**Pinecone, Milvus, Qdrant, Weaviate**) handle billions of vectors with ANN indexes (HNSW/IVF) when scale outgrows pgvector.

**Why chosen:** approximate nearest-neighbor (ANN) indexes make similarity search fast. **Interview line:** "Start with pgvector if you're already on Postgres and under ~tens of millions of vectors; graduate to a dedicated vector DB for scale/latency."

---

## Object Storage — S3 / MinIO

**What it's for:** blobs, files, backups, images/video, and as the storage layer for data lakes/lakehouses.

**Real cases:**
- **Netflix, Airbnb, Lyft** store assets and data-lake parquet on **S3**; analytics engines (Athena, Spark, Trino) query it directly.
- S3 is the durable backbone behind countless upload/download features (via presigned URLs) and the lake half of a "lakehouse."

**Why chosen:** near-infinite, cheap, durable (11 nines) storage. Not for low-latency random access or relational queries — pair with a metadata DB.

---

## Putting it together — Polyglot Persistence in real architectures

Real systems use several of the above at once ("right tool per job"), kept in sync via **CDC (Debezium) / Kafka** with one **source of truth**:

| Scenario | Typical stack |
|---|---|
| **E-commerce platform** | PostgreSQL (orders/payments) + Redis (cart/sessions/cache) + Elasticsearch (product search) + ClickHouse (BI/analytics) + S3 (images) |
| **Chat / messaging** | Cassandra/ScyllaDB (messages) + Redis (presence/online) + PostgreSQL (accounts) |
| **Fintech / ledger** | PostgreSQL or Spanner/Cockroach (strongly-consistent ledger) + Kafka (event log) + ClickHouse (reporting) |
| **Observability** | Prometheus (metrics) + ClickHouse/Loki (logs) + Elasticsearch (search) + object storage (long-term) |
| **AI / RAG product** | PostgreSQL + pgvector (or Pinecone) for embeddings + S3 (documents) + Redis (cache) |

**The senior framing:** choose the store from the *access pattern* (read/write ratio, query shape, consistency, scale), keep one authoritative source of truth, and propagate to specialized stores asynchronously via change data capture — accepting eventual consistency on the derived stores. Beware the operational tax: every extra datastore is another thing to run, back up, monitor, and staff.
