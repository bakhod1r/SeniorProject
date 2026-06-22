# Databases Roadmap

The **vendor-agnostic concept layer** for databases — the one canonical home for
the ideas that apply *regardless* of engine: the relational model, transactions,
consistency, indexing, replication, sharding, and the SQL-vs-NoSQL decision.

- Reference roadmaps: [roadmap.sh/postgresql-dba](https://roadmap.sh/postgresql-dba) · [roadmap.sh/sql](https://roadmap.sh/sql) · [roadmap.sh/mongodb](https://roadmap.sh/mongodb) · the *Databases* node of [roadmap.sh/computer-science](https://roadmap.sh/computer-science)

## How this fits with the rest of the repo

Databases live at several altitudes. To avoid duplication, each altitude has one
home and links to the others:

| Layer | Home | What it covers |
|-------|------|----------------|
| **Concepts** (this roadmap) | `Backend/databases/` | Vendor-agnostic theory: ACID, normalization, CAP, indexing, replication, sharding |
| **Specific engines** | [postgresql-dba](../postgresql-dba/) · [mongodb](../mongodb/) · [redis](../redis/) · [elasticsearch](../elasticsearch/) | How a concrete engine implements & operates these concepts |
| **Engine internals** | [computer-science/20-database-internals](../../Architecture/computer-science/20-database-internals/) | How storage works inside: LSM vs B-tree, MVCC implementation, WAL, query planner |
| **At system-design altitude** | [system-design/12-databases](../../Architecture/system-design/12-databases/) | Choosing a datastore for a system; sharding/replication *as scaling & availability strategies*; CAP tradeoffs in distributed design |
| **On-disk data structures** | [DSA · trees](../../Data/datastructures-and-algorithms/09-trees/) · [advanced](../../Data/datastructures-and-algorithms/21-advanced-structures/) | B-tree, B+ tree, LSM-tree, Merkle tree as data structures |

> Rule of thumb: *"What is ACID / how does an index work"* → here.
> *"Should I shard this service / which DB for this system"* → system-design.

---

## Topics

### Data modeling
1. [Relational Model](01-relational-model/) — relations, keys, constraints, relational algebra
2. [Normalization & Denormalization](02-normalization-and-denormalization/) — 1NF→BCNF, when to denormalize
3. [ER Modeling](03-er-modeling/) — entities, relationships, cardinality, ER → schema
4. [SQL: DDL / DML / DQL / DCL](04-sql-ddl-dml-dql-dcl/) — the four sublanguages
5. [Views](05-views/) — virtual & materialized views
6. [Stored Procedures & Triggers](06-stored-procedures-and-triggers/) — server-side logic, pros/cons

### Transactions & consistency
7. [Transactions & ACID](07-transactions-and-acid/) — atomicity, consistency, isolation, durability
8. [Isolation Levels](08-isolation-levels/) — read phenomena, the four SQL levels, snapshot isolation
9. [Locking & Concurrency Control](09-locking-and-concurrency-control/) — pessimistic vs optimistic, deadlocks
10. [MVCC](10-mvcc/) — multi-version concurrency (concept; impl in engine-internals)
11. [BASE & Eventual Consistency](11-base-and-eventual-consistency/) — the NoSQL relaxation
12. [CAP Theorem](12-cap-theorem/) — consistency / availability / partition tolerance
13. [PACELC](13-pacelc/) — the latency-vs-consistency extension of CAP

### Performance
14. [Indexing](14-indexing/) — B-tree/hash/GIN/GiST concepts, composite indexes, when *not* to index
15. [Query Optimization](15-query-optimization/) — EXPLAIN, join strategies, statistics

### Scaling & distribution
16. [Replication](16-replication/) — leader-follower, multi-leader, sync vs async, lag
17. [Partitioning & Sharding](17-partitioning-and-sharding/) — horizontal/vertical, shard keys, rebalancing
18. [Database Federation](18-database-federation/) — splitting by function
19. [SQL vs NoSQL](19-sql-vs-nosql/) — the decision and its tradeoffs
20. [NoSQL Data Models](20-nosql-data-models/) — key-value, document, wide-column, graph

### Operations & analytics
21. [OLTP vs OLAP & Warehousing](21-oltp-vs-olap-and-warehousing/) — transactional vs analytical, star schema
22. [Connection Pooling](22-connection-pooling/) — sizing, PgBouncer/HikariCP
23. [Caching at the DB Layer](23-caching-at-the-db-layer/) — buffer pool, query cache, read-through
24. [Backup & Recovery](24-backup-and-recovery/) — WAL archiving, PITR, RTO/RPO

---

## roadmap.sh coverage (Computer Science → Databases)

Every subtopic of the roadmap.sh CS *Databases* node maps here:

| roadmap.sh | Here |
|---|---|
| SQL vs NoSQL | 19 |
| Normalization / Denormalization | 02 |
| Entity-Relationship Model | 03 |
| DDL, DML, DQL, DCL | 04 |
| Locking | 09 |
| ACID Model | 07 |
| BASE | 11 |
| CAP Theorem | 12 |
| PACELC | 13 |
| Indexes | 14 |
| Views | 05 |
| Transactions | 07 |
| Stored Procedures | 06 |
| Database Federation | 18 |
| Replication | 16 |
| Sharding | 17 |

> Status: skeleton — folders created, content to be written.
