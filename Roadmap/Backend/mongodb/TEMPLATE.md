# MongoDB Roadmap — Universal Template

> Guides content generation for **MongoDB** topics.
> Primary code fences: `javascript` for queries, `json` for documents.

---

## Overview

| | Description |
|---|---|
| **Purpose** | Universal template for all MongoDB roadmap topics |
| **Files per topic** | 9 files: `junior.md`, `middle.md`, `senior.md`, `professional.md`, `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md`, `specification.md` |
| **Language** | All content must be generated in **English** |
| **Table of Contents** | **REQUIRED** on the four level files (`junior.md`, `middle.md`, `senior.md`, `professional.md`) as a numbered TOC linking each section. **OPTIONAL** on practice files (`tasks.md`, `find-bug.md`, `optimize.md`) |
| **Depth / Length** | Each level file (`junior.md`, `middle.md`, `senior.md`, `professional.md`) is substantial — target at least ~520 lines of genuine content (no filler), with multiple worked code examples, at least one Mermaid diagram, and at least one comparison table where the topic allows |
| **Level handoff** | Every level file ends with a **`Next step:`** line linking to the next level in the progression (junior → middle → senior → professional → …) |

### Topic Structure

```
XX-topic-name/
├── junior.md          ← "What?" and "How?" — CRUD, documents, basic indexing
├── middle.md          ← "Why?" and "When?" — aggregation, transactions, index strategy
├── senior.md          ← "How to operate?" — sharding, replication, backup/recovery
├── professional.md    ← "Under the Hood" — WiredTiger, oplog, execution plans
├── interview.md       ← Interview prep across all levels
├── tasks.md           ← Hands-on practice tasks
├── find-bug.md        ← Find and fix bugs in queries and schemas (10+ exercises)
├── optimize.md        ← Optimize slow queries and schemas (10+ exercises)
└── specification.md   ← Official spec / documentation deep-dive
```

---

## Level Comparison Matrix

| Aspect | Junior | Middle | Senior | Professional |
|:------:|:------:|:------:|:------:|:------------:|
| **Depth** | Documents, collections, basic CRUD | Aggregation, indexes, transactions | Sharding, replication, ops | WiredTiger internals, oplog, execution engine |
| **Code** | Simple `insertOne` / `find` | `$lookup`, multi-stage pipelines | Shard key design, replica set config | Explain plans, chunk balancing, journal |
| **Tricky Points** | Schema design basics | Index selectivity, write concern | Split/move chunks, failover | Oplog window, WiredTiger cache, MMAP vs WT |
| **Focus** | "What?" and "How?" | "Why?" and "When?" | "How to operate?" | "What happens under the hood?" |

---

# TEMPLATE 1 — `junior.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Error Handling and Transaction Patterns](#error-handling-and-transaction-patterns)
11. [Security Considerations](#security-considerations)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Tricky Points](#tricky-points)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)
21. [Related Topics](#related-topics)

---

## Introduction

> Focus: "What is {{TOPIC_NAME}}?" and "How do I use it with MongoDB?"

Brief explanation of what {{TOPIC_NAME}} is and why a developer working with MongoDB needs to understand it.
Keep it accessible — assume the reader knows basic programming but is new to MongoDB and document databases.

---

## Prerequisites

What you should know before studying this topic:

- **Required:** Basic JSON syntax — MongoDB documents are stored as BSON (Binary JSON)
- **Required:** Basic command-line usage — you will run `mongosh` commands
- **Helpful but not required:** SQL familiarity — useful for drawing analogies to relational tables

> Link to related roadmap topics where available.

---

## Glossary

Key terms used in this topic:

| Term | Definition |
|------|-----------|
| **Document** | A JSON-like record stored in MongoDB (analogous to a row in SQL) |
| **Collection** | A group of documents (analogous to a table in SQL) |
| **BSON** | Binary JSON — the wire format MongoDB uses internally |
| **ObjectId** | MongoDB's default unique identifier for each document |
| **Field** | A key-value pair inside a document |
| **Index** | A data structure that speeds up queries on a collection |
| **`mongosh`** | The MongoDB interactive shell used to run commands |
| **{{Term 8}}** | {{Definition specific to TOPIC_NAME}} |

> 6-10 terms. Keep definitions beginner-friendly.

---

## Core Concepts

### Concept 1: Documents and Collections

MongoDB stores data as **documents** — flexible, JSON-like objects that can have nested fields and arrays.
Unlike relational databases, MongoDB does not enforce a strict schema by default.

### Concept 2: CRUD Operations

The four fundamental operations — Create, Read, Update, Delete — map to:
`insertOne` / `insertMany`, `find` / `findOne`, `updateOne` / `updateMany`, `deleteOne` / `deleteMany`.

### Concept 3: {{TOPIC_NAME}} Specific Concept

{{Explain the primary concept of the topic in 3-5 sentences. Connect it to documents and collections.}}

> Each concept: 3-5 sentences, bullet points for lists, inline code snippets where helpful.

---

## Real-World Analogies

| Concept | Analogy |
|---------|--------|
| **Collection** | A folder of forms — each form (document) can have different fields |
| **Document** | A sticky note with labeled fields — flexible, self-describing |
| **Index** | A library card catalog — lets you jump straight to what you need |
| **{{TOPIC_NAME concept}}** | {{Everyday analogy}} |

> 3-5 analogies. Mention where the analogy breaks down.

---

## Mental Models

**The intuition:** Think of a MongoDB collection as a box of JSON files on a shelf.
Each file is independent, can have different fields, and you find files by scanning or by using an index card.

**Why this model helps:** It explains why queries without indexes scan every document (full collection scan)
and why schema flexibility is both a power and a responsibility.

> 1-2 mental models focused on {{TOPIC_NAME}}.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Flexible schema — no migrations for adding fields | No joins — related data must be embedded or looked up manually |
| Horizontal scaling built-in (sharding) | Transactions added late — not as mature as PostgreSQL |
| Rich query language with aggregation pipeline | Large documents can cause memory pressure |
| Native support for arrays and nested objects | Default `_id` index always present — extra storage |

### When to use {{TOPIC_NAME}}:
- {{Scenario where this feature shines}}

### When NOT to use {{TOPIC_NAME}}:
- {{Scenario where another approach is better}}

---

## Use Cases

- **E-commerce catalog:** Products with varying attributes fit naturally in flexible documents
- **Content management:** Blog posts, comments, tags stored as nested arrays
- **Real-time analytics:** Write-heavy event streams with time-series collections
- **{{TOPIC_NAME use case}}:** {{Brief description}}

---

## Code Examples

### Example 1: Basic Insert

```javascript
// Insert a single document
db.users.insertOne({
  name: "Alice",
  email: "alice@example.com",
  age: 30,
  createdAt: new Date()
});
```

### Example 2: Basic Query

```javascript
// Find all users older than 25
db.users.find({ age: { $gt: 25 } });

// Find one user by email
db.users.findOne({ email: "alice@example.com" });
```

### Example 3: Document Structure for {{TOPIC_NAME}}

```json
{
  "_id": { "$oid": "507f1f77bcf86cd799439011" },
  "field1": "value1",
  "nested": {
    "subfield": "value"
  },
  "tags": ["mongodb", "database"],
  "createdAt": { "$date": "2026-03-26T00:00:00Z" }
}
```

### Example 4: {{TOPIC_NAME}} — Core Usage

```javascript
// {{Describe what this example demonstrates}}
db.{{collection}}.{{operation}}({
  // {{TOPIC_NAME}} specific query
});
```

> Provide 4-6 examples. Start simple, build toward the topic.

---

## Error Handling and Transaction Patterns

Common errors encountered at junior level with {{TOPIC_NAME}}:

```javascript
try {
  const result = await db.collection("users").insertOne({ name: "Bob" });
  console.log("Inserted:", result.insertedId);
} catch (err) {
  if (err.code === 11000) {
    console.error("Duplicate key error — unique index violated");
  } else {
    console.error("Unexpected error:", err.message);
  }
}
```

| Error Code | Meaning | Fix |
|------------|---------|-----|
| `11000` | Duplicate key — unique index violated | Check existing documents before insert |
| `121` | Document failed schema validation | Review `$jsonSchema` validator rules |
| `{{code}}` | {{Description}} | {{Fix}} |

---

## Security Considerations

- Always enable authentication (`--auth` flag or `security.authorization: enabled` in `mongod.conf`)
- Never expose `mongod` port (27017) directly to the internet
- Use least-privilege roles — prefer built-in roles like `readWrite` over `root`
- Sanitize user input to prevent NoSQL injection (`{ $where: ... }` can execute JavaScript)

---

## Performance Tips

- Always create an index on fields used in `find()` filters
- Use `projection` to return only needed fields: `db.users.find({}, { name: 1, email: 1, _id: 0 })`
- Avoid `$where` — it disables index usage and executes JavaScript per document
- Prefer `insertMany` over looped `insertOne` for bulk inserts

---

## Best Practices

- Design documents around your application's access patterns, not around normalization
- Keep documents under 16 MB (BSON limit) — avoid unbounded array growth
- Use `ObjectId` as `_id` unless you have a natural unique key
- Always set `createdAt` / `updatedAt` fields for auditability

---

## Edge Cases & Pitfalls

- **Field name with dot:** `"user.name"` in a query means nested field; use `$literal` to store a literal dot
- **`null` vs missing field:** `{ field: null }` matches both documents where `field` is `null` AND documents where `field` doesn't exist
- **32-bit integer overflow:** JavaScript numbers are 64-bit floats; use `Long` for large integers in BSON

---

## Common Mistakes

| Mistake | Why it Happens | Fix |
|---------|---------------|-----|
| `find()` returns a cursor, not an array | Forgetting to call `.toArray()` or iterate | Use `for await (const doc of cursor)` |
| Updating wrong documents | Using `update` without `$set` — replaces the whole document | Always use `$set`, `$inc`, etc. |
| Forgetting index on filter field | No query plan awareness | Run `explain("executionStats")` on every new query |

---

## Tricky Points

- MongoDB's `_id` field is **indexed automatically** — you never need to create an index for it
- `updateOne` without `$set` **replaces** the document body entirely (upsert-style replacement)
- `find()` is **lazy** — it returns a cursor, not data; nothing is fetched until you iterate

---

## Tricky Questions

1. What is the difference between `findOne` and `find().limit(1)` in terms of performance?
2. Why does `{ field: null }` also match documents where the field is absent?
3. What happens when you call `insertOne` without specifying `_id`?
4. Can two documents in the same collection have different fields? What are the implications?

---

## Cheat Sheet

```javascript
// CREATE
db.col.insertOne({ key: "value" })
db.col.insertMany([{ a: 1 }, { a: 2 }])

// READ
db.col.find({ key: "value" })
db.col.findOne({ _id: ObjectId("...") })
db.col.find({}, { field: 1, _id: 0 })   // projection

// UPDATE
db.col.updateOne({ _id: id }, { $set: { field: "new" } })
db.col.updateMany({ status: "old" }, { $set: { status: "new" } })

// DELETE
db.col.deleteOne({ _id: id })
db.col.deleteMany({ status: "inactive" })

// INDEX
db.col.createIndex({ field: 1 })         // ascending
db.col.createIndex({ field: 1 }, { unique: true })
db.col.getIndexes()
```

---

## Summary

{{TOPIC_NAME}} at the junior level is about understanding {{core concept}} and being able to perform
basic operations confidently. Key takeaways:

- MongoDB stores data as flexible BSON documents inside collections
- CRUD operations are the foundation of all MongoDB interactions
- Always think about access patterns before designing a schema
- Use indexes on every field you filter or sort by

---

## Further Reading

- [MongoDB CRUD Operations — Official Docs](https://www.mongodb.com/docs/manual/crud/)
- [MongoDB Data Modeling Introduction](https://www.mongodb.com/docs/manual/core/data-modeling-introduction/)
- [mongosh Reference](https://www.mongodb.com/docs/mongodb-shell/)

---

## Related Topics

- `02-data-modeling` — embedding vs referencing
- `03-indexing-basics` — creating and using indexes
- `04-aggregation-pipeline` — next step after basic queries

</details>

---

# TEMPLATE 2 — `middle.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Deep Dive](#deep-dive)
4. [Aggregation Pipeline](#aggregation-pipeline)
5. [Index Strategy](#index-strategy)
6. [Transactions](#transactions)
7. [Replication Concepts](#replication-concepts)
8. [Error Handling and Transaction Patterns](#error-handling-and-transaction-patterns)
9. [Comparison with Alternative Databases](#comparison-with-alternative-databases)
10. [Query Debugging and Performance Diagnosis](#query-debugging-and-performance-diagnosis)
11. [Best Practices](#best-practices)
12. [Tricky Points](#tricky-points)
13. [Tricky Questions](#tricky-questions)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction

> Focus: "Why does {{TOPIC_NAME}} work this way?" and "When should I use it?"

At the middle level, you move beyond basic CRUD into advanced querying, deliberate index design, and
understanding MongoDB's consistency and replication model. The goal is to make production-ready decisions.

---

## Prerequisites

- **Required:** Junior-level CRUD and basic index knowledge
- **Required:** Understanding of the aggregation pipeline stages (`$match`, `$group`, `$sort`, `$lookup`)
- **Helpful:** Familiarity with replica sets and the concept of a primary node

---

## Deep Dive

### {{TOPIC_NAME}} — How It Really Works

{{Explain the mechanism behind TOPIC_NAME at a deeper level. Cover the "why" — why MongoDB implements
it this way, what trade-offs were made, and how it behaves under concurrent load.}}

### Write Concern and Read Preference

```javascript
// w: "majority" — waits for most replica set members to acknowledge
db.orders.insertOne(
  { orderId: "ABC123", status: "pending" },
  { writeConcern: { w: "majority", j: true, wtimeout: 5000 } }
);

// Read from secondary — potentially stale but reduces primary load
db.orders.find({ status: "pending" }).readPref("secondary");
```

### Compound Indexes

```javascript
// Index supports: { status: 1 }, { status: 1, createdAt: 1 }, but NOT { createdAt: 1 } alone
db.orders.createIndex({ status: 1, createdAt: -1 });

// Partial index — only index active users (smaller, faster)
db.users.createIndex(
  { email: 1 },
  { partialFilterExpression: { active: true } }
);
```

---

## Aggregation Pipeline

The aggregation pipeline processes documents through a sequence of stages.
Each stage transforms the stream of documents.

```javascript
// {{TOPIC_NAME}} — multi-stage aggregation example
db.orders.aggregate([
  { $match: { status: "completed", createdAt: { $gte: new Date("2026-01-01") } } },
  { $group: {
      _id: "$customerId",
      totalSpent: { $sum: "$amount" },
      orderCount: { $count: {} }
    }
  },
  { $sort: { totalSpent: -1 } },
  { $limit: 10 },
  { $lookup: {
      from: "customers",
      localField: "_id",
      foreignField: "_id",
      as: "customerInfo"
    }
  },
  { $project: {
      customerInfo: { $arrayElemAt: ["$customerInfo", 0] },
      totalSpent: 1,
      orderCount: 1
    }
  }
]);
```

**Pipeline execution flow:**

```mermaid
flowchart LR
    A[Collection Scan / Index Scan] --> B["$match"]
    B --> C["$group"]
    C --> D["$sort"]
    D --> E["$limit"]
    E --> F["$lookup"]
    F --> G["$project"]
    G --> H[Result Cursor]
```

---

## Index Strategy

| Index Type | Use Case | Syntax |
|------------|---------|--------|
| Single field | Simple equality / range queries | `createIndex({ field: 1 })` |
| Compound | Multi-field filters and sorts | `createIndex({ a: 1, b: -1 })` |
| Multikey | Queries on array fields | Automatic when field is an array |
| Text | Full-text search | `createIndex({ body: "text" })` |
| TTL | Auto-expire documents | `createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })` |
| Wildcard | Dynamic / unknown field names | `createIndex({ "attributes.$**": 1 })` |

**ESR Rule for compound indexes:** Equality → Sort → Range fields in that order.

---

## Transactions

Multi-document transactions in MongoDB require a replica set or sharded cluster.

```javascript
const session = client.startSession();
session.startTransaction({
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" }
});

try {
  await db.accounts.updateOne(
    { _id: fromId },
    { $inc: { balance: -amount } },
    { session }
  );
  await db.accounts.updateOne(
    { _id: toId },
    { $inc: { balance: amount } },
    { session }
  );
  await session.commitTransaction();
} catch (err) {
  await session.abortTransaction();
  throw err;
} finally {
  session.endSession();
}
```

---

## Replication Concepts

```mermaid
graph TD
    P[Primary Node<br/>Accepts Writes] -->|oplog replication| S1[Secondary 1<br/>Read replica]
    P -->|oplog replication| S2[Secondary 2<br/>Read replica]
    P -->|oplog replication| A[Arbiter<br/>Votes only]
    S1 -.->|election vote| P
    S2 -.->|election vote| P
    A -.->|election vote| P
```

- **Oplog:** A capped collection (`local.oplog.rs`) that records every write operation
- **Replica set election:** Triggered when primary is unreachable; requires majority of votes
- **Read preference:** `primary`, `primaryPreferred`, `secondary`, `secondaryPreferred`, `nearest`

---

## Error Handling and Transaction Patterns

```javascript
// Retry transient transaction errors (TransientTransactionError label)
async function runTransactionWithRetry(txnFunc, session) {
  while (true) {
    try {
      await txnFunc(session);
      break;
    } catch (err) {
      if (err.hasErrorLabel("TransientTransactionError")) {
        continue; // retry
      }
      throw err;
    }
  }
}

// Retry commit on UnknownTransactionCommitResult
async function commitWithRetry(session) {
  while (true) {
    try {
      await session.commitTransaction();
      break;
    } catch (err) {
      if (err.hasErrorLabel("UnknownTransactionCommitResult")) {
        continue;
      }
      throw err;
    }
  }
}
```

---

## Comparison with Alternative Databases

| Feature | MongoDB | PostgreSQL | Cassandra |
|---------|---------|-----------|-----------|
| Data model | Document (BSON) | Relational (rows/columns) | Wide-column |
| Schema | Flexible | Strict | Flexible |
| Transactions | Multi-doc (replica set) | Full ACID | Lightweight (LWT) |
| Horizontal scale | Native sharding | Requires extensions (Citus) | Native |
| Query language | MQL + aggregation | SQL | CQL |
| Full-text search | Built-in text index | `tsvector` / `pg_trgm` | External (Solr) |

---

## Query Debugging and Performance Diagnosis

```javascript
// Always run explain before deploying a new query to production
db.orders.find({ status: "pending", createdAt: { $gt: new Date("2026-01-01") } })
  .explain("executionStats");

// Key fields to check in the output:
// executionStats.executionTimeMillis  — total time
// executionStats.totalDocsExamined   — should be close to totalDocsReturned
// queryPlanner.winningPlan.stage      — "IXSCAN" is good, "COLLSCAN" needs an index
```

---

## Best Practices

- Use the **ESR rule** when designing compound indexes (Equality → Sort → Range)
- Prefer `$lookup` with indexed `localField` and `foreignField` to avoid full collection scans
- Set `maxTimeMS` on all user-facing queries to prevent runaway operations
- Use **change streams** instead of polling for real-time data feeds

---

## Tricky Points

- `$lookup` does NOT use an index on the joined collection unless the pipeline is structured carefully
- Transactions have a **60-second timeout** by default; keep them short
- A secondary with `readPreference: secondary` may return **stale data** — acceptable for analytics, not for financial reads
- Multikey indexes **cannot** be compound with another multikey field

---

## Tricky Questions

1. Why does the ESR rule improve compound index performance?
2. What is the difference between `w: 1` and `w: "majority"` write concern? When does it matter?
3. Can you run a transaction across two different collections? Across two shards?
4. How does MongoDB choose between two candidate indexes? What is the "tournament"?
5. What happens to open change streams when a primary failover occurs?

---

## Cheat Sheet

```javascript
// Aggregation stages quick reference
$match    // filter (like WHERE) — put early to use indexes
$project  // reshape documents (include/exclude/rename fields)
$group    // aggregate ($sum, $avg, $min, $max, $count)
$sort     // sort (uses index if early in pipeline)
$limit / $skip
$lookup   // left outer join to another collection
$unwind   // flatten array field into separate documents
$addFields / $set   // add computed fields
$facet    // multiple pipelines in one pass

// Write concerns
{ w: 0 }           // fire and forget
{ w: 1 }           // primary acknowledged
{ w: "majority" }  // majority of replica set acknowledged
{ j: true }        // journal write (on-disk durability)
```

---

## Summary

At the middle level, {{TOPIC_NAME}} requires understanding the aggregation pipeline, deliberate index
strategy using the ESR rule, multi-document transactions, and how replica sets maintain consistency.
Always use `explain("executionStats")` to validate query performance before deploying.

---

## Further Reading

- [Aggregation Pipeline — MongoDB Docs](https://www.mongodb.com/docs/manual/aggregation/)
- [Indexing Strategies](https://www.mongodb.com/docs/manual/applications/indexes/)
- [Transactions in MongoDB](https://www.mongodb.com/docs/manual/core/transactions/)
- [Replication Introduction](https://www.mongodb.com/docs/manual/replication/)

</details>

---

# TEMPLATE 3 — `senior.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Production Operations](#production-operations)
3. [Sharding Architecture](#sharding-architecture)
4. [High Availability and Failover](#high-availability-and-failover)
5. [Backup and Recovery](#backup-and-recovery)
6. [Capacity Planning](#capacity-planning)
7. [Error Handling and Transaction Patterns](#error-handling-and-transaction-patterns)
8. [Query Debugging and Performance Diagnosis](#query-debugging-and-performance-diagnosis)
9. [Security Hardening](#security-hardening)
10. [Runbooks and Operational Checklists](#runbooks-and-operational-checklists)
11. [Tricky Points](#tricky-points)
12. [Summary](#summary)
13. [Further Reading](#further-reading)

---

## Introduction

> Focus: "How do I operate {{TOPIC_NAME}} reliably at scale?" and "How do I architect for failure?"

Senior-level MongoDB knowledge is about operating clusters in production — sharding, monitoring,
backup/recovery strategies, and building systems that survive node failures without data loss.

---

## Production Operations

### Monitoring Key Metrics

| Metric | Tool | Alert Threshold |
|--------|------|----------------|
| Replication lag | `rs.printReplicationInfo()` | > 10 seconds |
| Page faults | `mongostat` `faults` column | Rising trend |
| WiredTiger cache dirty % | `serverStatus` `wiredTiger.cache` | > 20% |
| Oplog window | `rs.printReplicationInfo()` | < 24 hours |
| Connection pool saturation | `serverStatus.connections.current` | > 80% of max |

```javascript
// Check replica set health
rs.status();

// Check oplog window (how far back a secondary can lag)
rs.printReplicationInfo();

// Server diagnostics
db.serverStatus({ wiredTiger: 1, connections: 1, opcounters: 1 });
```

---

## Sharding Architecture

```mermaid
graph TD
    App[Application] --> MR1[mongos Router 1]
    App --> MR2[mongos Router 2]
    MR1 --> CS[Config Server Replica Set<br/>Stores chunk metadata]
    MR2 --> CS
    CS --> SH1[Shard 1 Replica Set<br/>Chunks A-M]
    CS --> SH2[Shard 2 Replica Set<br/>Chunks N-Z]
    CS --> SH3[Shard 3 Replica Set<br/>Overflow chunks]
```

### Shard Key Selection

Good shard key properties:
- **High cardinality** — many distinct values (avoid boolean or low-cardinality fields)
- **Even distribution** — avoids hot shards (avoid monotonically increasing keys like timestamps alone)
- **Query isolation** — most queries include the shard key so mongos routes to one shard

```javascript
// Enable sharding on a database
sh.enableSharding("mydb");

// Shard a collection with a hashed shard key (even distribution)
sh.shardCollection("mydb.events", { userId: "hashed" });

// Check shard distribution
db.events.getShardDistribution();

// Check chunk map
use config;
db.chunks.find({ ns: "mydb.events" }).sort({ min: 1 });
```

### Chunk Balancing

- The **balancer** runs on config servers and moves chunks to equalize shard sizes
- Disable balancer during maintenance windows: `sh.stopBalancer()`
- Monitor balancer rounds: `db.getSiblingDB("config").actionlog.find().sort({ time: -1 }).limit(5)`

---

## High Availability and Failover

### Replica Set Election Process

1. Primary stops responding (network partition or crash)
2. Secondaries detect missed heartbeats (default: `electionTimeoutMillis = 10000`)
3. A secondary calls an election — requires **majority of votes** to win
4. New primary applies any oplog entries the old primary had not yet replicated
5. Clients with retryable writes automatically re-issue the write to the new primary

```javascript
// Force a manual failover (for planned maintenance)
rs.stepDown(60); // step down for 60 seconds

// Freeze a secondary so it cannot become primary
rs.freeze(120);

// Check which member is primary
rs.isMaster(); // or rs.hello() in newer versions
```

### Retryable Writes

```javascript
// Enable retryable writes in the connection string
const client = new MongoClient(uri, { retryWrites: true });
// Retryable writes automatically retry once on network errors or primary failover
```

---

## Backup and Recovery

| Strategy | RTO | RPO | Best For |
|----------|-----|-----|---------|
| `mongodump` / `mongorestore` | Hours | Hours | Small datasets, dev/staging |
| File system snapshot (LVM/EBS) | Minutes | Seconds | Production with brief lock |
| MongoDB Ops Manager / Atlas Backup | Minutes | Seconds | Enterprise production |
| Continuous backup (oplog tailing) | Minutes | Near-zero | Mission-critical |

```bash
# Logical backup — dump all databases
mongodump --uri="mongodb+srv://user:pass@cluster/db" --out=/backup/$(date +%Y%m%d)

# Restore from dump
mongorestore --uri="mongodb+srv://user:pass@cluster/db" --dir=/backup/20260326

# Point-in-time restore using oplog replay
mongorestore --oplogReplay --dir=/backup/20260326
```

---

## Capacity Planning

- **WiredTiger cache:** Default 50% of (RAM - 1 GB). Monitor `wiredTiger.cache.bytes currently in cache`
- **Oplog size:** Target 24-72 hours of oplog window. Check: `rs.printReplicationInfo()`
- **Disk IOPS:** Each write generates oplog entries — budget 2-3x your write rate
- **Connection overhead:** Each MongoDB connection uses ~1 MB RAM; use connection pooling

```javascript
// Resize oplog (requires replica set member restart)
// In mongod.conf:
// replication:
//   oplogSizeMB: 51200   ← 50 GB oplog
```

---

## Error Handling and Transaction Patterns

```javascript
// Production-grade transaction with retry logic and timeout
async function transferFunds(fromId, toId, amount) {
  const session = client.startSession();
  const transactionOptions = {
    readPreference: "primary",
    readConcern: { level: "local" },
    writeConcern: { w: "majority" },
    maxCommitTimeMS: 2000
  };

  try {
    await session.withTransaction(async () => {
      const from = await db.accounts.findOne({ _id: fromId }, { session });
      if (from.balance < amount) throw new Error("Insufficient funds");

      await db.accounts.updateOne(
        { _id: fromId }, { $inc: { balance: -amount } }, { session }
      );
      await db.accounts.updateOne(
        { _id: toId }, { $inc: { balance: amount } }, { session }
      );
    }, transactionOptions);
  } finally {
    await session.endSession();
  }
}
```

---

## Query Debugging and Performance Diagnosis

```javascript
// Full explain with execution stats
const plan = db.orders.explain("executionStats").find({
  customerId: ObjectId("..."),
  status: { $in: ["pending", "processing"] },
  createdAt: { $gte: new Date("2026-01-01") }
});

// What to look for:
// - stage: "IXSCAN"          → index used (good)
// - stage: "COLLSCAN"        → no index (bad)
// - totalDocsExamined >> totalDocsReturned → low selectivity index
// - indexBounds               → which part of the index was used

// Profile slow queries
db.setProfilingLevel(1, { slowms: 100 }); // log queries > 100ms
db.system.profile.find().sort({ ts: -1 }).limit(10);
```

---

## Security Hardening

- Enable **TLS/SSL** for all client and inter-node connections
- Use **x.509 certificate authentication** for intra-cluster communication
- Enable **field-level encryption** for PII fields
- Restrict `mongod` to `localhost` or private network interfaces (`net.bindIp`)
- Rotate credentials using `db.updateUser()` without downtime

---

## Runbooks and Operational Checklists

### Pre-deployment checklist for {{TOPIC_NAME}}

- [ ] Explain plan reviewed — no `COLLSCAN` on large collections
- [ ] Write concern set to `w: "majority"` for critical writes
- [ ] Index created before deploying the feature (not after)
- [ ] TTL index set for any time-bounded data
- [ ] Monitoring alert added for oplog lag

### Post-incident checklist

- [ ] Identify root cause via `system.profile` and slow query log
- [ ] Check oplog window was not exhausted during incident
- [ ] Verify all secondaries re-synced and replica set is healthy (`rs.status()`)
- [ ] Review chunk balancer state if sharded

---

## Tricky Points

- **Chunk migration** locks the chunk range briefly — can cause latency spikes in write-heavy collections
- **Orphaned documents** can exist after a failed chunk migration — use `cleanupOrphaned` to remove them
- **Oplog is a capped collection** — if a secondary falls too far behind, it will need a full resync
- **`w: "majority"` + `j: true`** is the only write concern that guarantees no data loss on primary failure
- Retryable writes protect against **at-most-once** delivery but not **at-least-once** — check for idempotency

---

## Summary

Senior-level {{TOPIC_NAME}} mastery means operating MongoDB clusters with confidence:
choosing appropriate shard keys, sizing the oplog, designing failover-safe write patterns,
and diagnosing performance issues with `explain("executionStats")` and the slow query profiler.

---

## Further Reading

- [MongoDB Sharding](https://www.mongodb.com/docs/manual/sharding/)
- [Production Notes](https://www.mongodb.com/docs/manual/administration/production-notes/)
- [Backup and Restore](https://www.mongodb.com/docs/manual/core/backups/)
- [Security Checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)

</details>

---

# TEMPLATE 4 — `professional.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Database/System Internals

## Table of Contents

1. [Introduction](#introduction)
2. [WiredTiger Storage Engine Internals](#wiredtiger-storage-engine-internals)
3. [Oplog Structure and Replication Mechanics](#oplog-structure-and-replication-mechanics)
4. [Aggregation Pipeline Execution Plan](#aggregation-pipeline-execution-plan)
5. [Sharding Chunk Balancing Algorithm](#sharding-chunk-balancing-algorithm)
6. [Query Debugging and Performance Diagnosis](#query-debugging-and-performance-diagnosis)
7. [Tricky Points](#tricky-points)
8. [Summary](#summary)
9. [Further Reading](#further-reading)

---

## Introduction

> Focus: "What happens under the hood when MongoDB processes {{TOPIC_NAME}}?"

Professional-level knowledge means understanding how MongoDB's storage engine, replication protocol,
and query execution engine actually work — not just how to use them, but why they behave the way they do
under failure scenarios, concurrency, and extreme load.

---

## WiredTiger Storage Engine Internals

### B-Tree and Document Storage

WiredTiger stores collections in a **B-tree** on disk. Each leaf page holds multiple documents.
The default page size is 4 KB for leaf pages, 4 KB for internal pages.

```
WiredTiger B-Tree Structure:
┌─────────────────────────────────────┐
│          Internal Pages             │
│  [key range] → [page pointer]       │
├─────────────────────────────────────┤
│            Leaf Pages               │
│  [BSON doc] [BSON doc] [BSON doc]   │
│  RecordId → BSON offset             │
└─────────────────────────────────────┘
```

### MVCC (Multi-Version Concurrency Control)

WiredTiger uses **snapshot-based MVCC**:
- Each write creates a **new version** of the document at a new position
- Readers see a consistent snapshot from their transaction start time
- Old versions are cleaned up by the **eviction** thread once no active reader needs them

```javascript
// Each document version is stamped with a transaction ID (snapshot timestamp)
// db.serverStatus().wiredTiger.transaction shows active snapshot count

db.serverStatus().wiredTiger.transaction;
// {
//   "transaction begins": 12345,
//   "transactions committed": 12300,
//   "transactions rolled back": 45,
//   "transaction checkpoint most recent time (msecs)": 60000
// }
```

### WiredTiger Cache

- Cache size: `(RAM - 1 GB) * 0.5` by default
- **Dirty eviction** triggers when dirty cache exceeds 20% of cache size
- **Read eviction** triggers when total cache exceeds 80%
- Cache pressure causes write stalls — the most common cause of unexpected MongoDB latency spikes

```javascript
// Monitor cache pressure
db.serverStatus().wiredTiger.cache;
// Key fields:
// "bytes currently in the cache"
// "tracked dirty bytes in the cache"
// "pages evicted by application threads"  ← non-zero means you have cache pressure
```

### Journaling and Durability

```
Write path:
Application → mongod buffer → WiredTiger journal (fsync every 100ms) → B-tree pages (checkpoint every 60s)

Journal location: <dbPath>/journal/
Checkpoint: atomic snapshot of all B-tree pages, enables crash recovery without replaying full journal
```

---

## Oplog Structure and Replication Mechanics

### Oplog as a Capped Collection

The oplog (`local.oplog.rs`) is a special **capped collection** with a fixed size.
Every write operation on the primary is translated into one or more idempotent oplog entries.

```json
{
  "ts": { "$timestamp": { "t": 1711411200, "i": 1 } },
  "t": 42,
  "h": 0,
  "v": 2,
  "op": "i",
  "ns": "mydb.orders",
  "ui": { "$binary": "..." },
  "wall": { "$date": "2026-03-26T00:00:00Z" },
  "o": {
    "_id": { "$oid": "507f1f77bcf86cd799439011" },
    "status": "pending",
    "amount": 150.00
  }
}
```

| Field | Meaning |
|-------|---------|
| `ts` | BSON Timestamp — (Unix seconds, ordinal) — globally ordered |
| `op` | `i` = insert, `u` = update, `d` = delete, `c` = command, `n` = no-op |
| `ns` | Namespace (database.collection) |
| `o` | The operation document (new document for insert, update spec for update) |
| `o2` | For updates: the query predicate used to find the document |

### Replication Pull Model

```mermaid
sequenceDiagram
    participant Secondary
    participant Primary
    Secondary->>Primary: oplogFetch — "give me ops after ts X"
    Primary-->>Secondary: stream of oplog entries
    Secondary->>Secondary: apply ops to local WiredTiger
    Secondary->>Primary: heartbeat (every 2s) — report lastAppliedOpTime
```

- Secondaries **pull** from the primary (not pushed to)
- The **oplog window** = time span from oldest to newest oplog entry
- If a secondary falls behind beyond the oplog window, it needs a **full initial sync**

---

## Aggregation Pipeline Execution Plan

### Pipeline Optimization Rules

MongoDB's query planner applies these optimizations before executing a pipeline:

1. **`$match` + `$sort` coalescence:** If `$match` precedes `$sort` on an indexed field, the planner may use an index-scan that is already sorted
2. **`$sort` + `$limit` coalescence:** Merged into a single top-K sort (avoids full sort of all documents)
3. **`$match` push-down:** `$match` stages are pushed as early as possible to reduce documents in subsequent stages
4. **`$lookup` + `$match` push-down:** A `$match` immediately after `$lookup` is pushed into the lookup's pipeline

```javascript
// Force the query planner to show the optimized pipeline
db.orders.explain("executionStats").aggregate([
  { $match: { status: "completed" } },
  { $sort: { createdAt: -1 } },
  { $limit: 100 },
  { $lookup: { from: "customers", localField: "customerId", foreignField: "_id", as: "customer" } }
]);

// In the explain output, look for:
// "optimizedPipeline": true
// "stages[0].stage": "IXSCAN"  ← index used for $match + $sort
```

### Execution Stages

```
COLLSCAN        → full collection scan (no index)
IXSCAN          → index scan
FETCH           → fetch full document after index scan
SORT            → in-memory sort (watch: allowDiskUse if > 100 MB)
LIMIT           → limit stage
PROJECTION      → field projection
$lookup         → hash join (small) or nested-loop join (large)
```

---

## Sharding Chunk Balancing Algorithm

### Chunk Lifecycle

```
1. Collection sharded → initial chunks created based on shard key range
2. Writes accumulate → chunk size grows → split threshold (default 128 MB) reached
3. mongos / config server splits the chunk into two
4. Balancer checks shard chunk counts → if max - min > migration threshold → initiates move
5. Chunk move: donor shard streams documents to recipient → updates config server → cleans up orphans
```

### Balancer Migration Threshold

| Number of Shards | Migration Threshold (chunk count difference) |
|:----------------:|:------------------------------------------:|
| < 3 | 2 |
| 3-7 | 4 |
| ≥ 8 | 8 |

```javascript
// Check balancer status
sh.getBalancerState();
sh.isBalancerRunning();

// View active migrations
db.getSiblingDB("config").migrations.find();

// Check chunk imbalance
db.getSiblingDB("config").chunks.aggregate([
  { $group: { _id: "$shard", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);
```

### Zone Sharding

```javascript
// Pin specific data ranges to specific shards (GDPR, data locality)
sh.addShardToZone("shard0001", "EU");
sh.updateZoneKeyRange("mydb.users", { region: "EU", _id: MinKey }, { region: "EU", _id: MaxKey }, "EU");
```

---

## Query Debugging and Performance Diagnosis

```javascript
// Full executionStats explain — the professional's primary tool
db.collection.explain("executionStats").find({ ... });

// Key metrics in executionStats:
// executionTimeMillis     — wall clock time
// totalKeysExamined       — index entries scanned
// totalDocsExamined       — documents fetched from disk
// totalDocsReturned       — documents returned to client
// Efficiency = totalDocsReturned / totalDocsExamined (aim for > 0.9)

// allPlansExecution — see why winning plan was chosen over rejected plans
db.collection.explain("allPlansExecution").find({ ... });

// System-level profiling
db.setProfilingLevel(2); // log ALL operations (dev only)
db.system.profile.find({ millis: { $gt: 200 } }).sort({ ts: -1 });

// currentOp — find running operations consuming time
db.currentOp({ active: true, secs_running: { $gt: 5 } });
// Kill a long-running operation
db.killOp(opId);
```

---

## Tricky Points

- **WiredTiger eviction stalls** occur when the cache is 100% dirty — mongod will stall all writes until eviction catches up. Mitigation: increase cache size or reduce write rate
- **Oplog holes:** A primary can have gaps in oplog timestamps during concurrent writes. Secondaries handle this with the **"no hole" wait** mechanism before reporting `lastAppliedOpTime`
- **Chunk migration and write latency:** During a chunk migration, writes to the moved range are briefly blocked while the config server is updated. This is the main source of P99 latency spikes in sharded clusters
- **Aggregation `allowDiskUse`:** Required when sort or group stage exceeds 100 MB. Uses temp files in `--dbpath/\_tmp`. Can be significantly slower — design pipelines to avoid it
- **`$lookup` is not parallelized** across shards in most cases — for large join workloads consider pre-joining at write time (denormalization)

---

## Summary

At the professional level, {{TOPIC_NAME}} understanding means being able to trace a write from the
application layer through WiredTiger's MVCC, into the oplog, across the replication pull model to
secondaries, and back. For sharded clusters, understanding the balancer's migration threshold and
chunk lifecycle allows you to predict and prevent latency spikes. The aggregation pipeline's
optimizer rules let you write queries that take full advantage of indexes and avoid disk spills.

---

## Further Reading

- [WiredTiger Architecture Guide](https://source.wiredtiger.com/develop/arch-index.html)
- [MongoDB Oplog Internals](https://www.mongodb.com/docs/manual/core/replica-set-oplog/)
- [Aggregation Pipeline Optimization](https://www.mongodb.com/docs/manual/core/aggregation-pipeline-optimization/)
- [Sharding Balancer](https://www.mongodb.com/docs/manual/core/sharding-balancer-administration/)

</details>

---

# TEMPLATE 5 — `interview.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Interview Preparation

## Structure

Cover questions across four levels: Junior, Middle, Senior, Professional.
Include answers with code snippets where relevant.

---

## Junior Questions

**Q1: What is the difference between a MongoDB document and a SQL row?**
A document is a self-describing JSON-like object that can have nested fields and arrays.
A SQL row is flat and must conform to a fixed schema defined by `CREATE TABLE`.

**Q2: How do you create an index in MongoDB?**
```javascript
db.users.createIndex({ email: 1 }); // ascending index on email
```

**Q3: What is a capped collection?**
A fixed-size collection that automatically overwrites the oldest documents when it reaches its size limit.
Used for logs, audit trails, and the oplog.

**Q4: What does `ObjectId` contain?**
A 12-byte value: 4-byte Unix timestamp, 5-byte random value, 3-byte incrementing counter.

**Q5: {{Junior question specific to TOPIC_NAME}}**
{{Answer}}

---

## Middle Questions

**Q1: Explain the ESR rule for compound indexes.**
Equality fields first, then Sort fields, then Range fields. This order maximizes index utilization because
equality conditions narrow the range, sorted fields allow index-ordered scans, and range filters are applied last.

**Q2: What is the difference between `w: 1` and `w: "majority"`?**
`w: 1` means only the primary acknowledged the write — a failover before replication means data loss.
`w: "majority"` means most replica set members have the write — safe against single-node failure.

**Q3: When would you use a partial index?**
When only a subset of documents is queried — e.g., only active users. A partial index is smaller, faster,
and uses less memory than a full index on the same field.

**Q4: What are TransientTransactionError and UnknownTransactionCommitResult?**
`TransientTransactionError` means the transaction can be safely retried.
`UnknownTransactionCommitResult` means the commit's outcome is unknown — retry the commit only.

**Q5: {{Middle question specific to TOPIC_NAME}}**
{{Answer}}

---

## Senior Questions

**Q1: How do you choose a shard key?**
High cardinality, even write distribution (avoid monotonically increasing keys), and alignment with
the application's most frequent query predicates to enable targeted (single-shard) queries.

**Q2: What causes an oplog window to shrink?**
High write throughput on the primary fills the capped oplog faster. Solutions: increase `oplogSizeMB`,
reduce write volume, or scale the oplog on disk.

**Q3: How do you perform a zero-downtime MongoDB version upgrade?**
Rolling upgrade: upgrade one secondary at a time, then step down the primary, upgrade it last.
The replica set remains operational throughout.

**Q4: What is an orphaned document and how do you remove them?**
Documents that remain on a shard after a failed chunk migration. Remove with `cleanupOrphaned`.

**Q5: {{Senior question specific to TOPIC_NAME}}**
{{Answer}}

---

## Professional Questions

**Q1: How does WiredTiger's MVCC differ from PostgreSQL's MVCC?**
WiredTiger stores new versions as entirely new B-tree entries and cleans up old versions via eviction.
PostgreSQL stores multiple row versions in the heap and uses VACUUM to reclaim dead tuples.

**Q2: Why can aggregation pipelines stall writes?**
`$sort` and `$group` with `allowDiskUse` write temporary files. If `_tmp` is on the same disk as the
data files, the I/O contention can increase write latency cluster-wide.

**Q3: Explain how the chunk balancer decides to migrate a chunk.**
The balancer compares the chunk count between the most-loaded and least-loaded shards.
If the difference exceeds the migration threshold (2, 4, or 8 depending on shard count), it initiates
a migration from the most-loaded to the least-loaded shard.

**Q4: {{Professional question specific to TOPIC_NAME}}**
{{Answer}}

</details>

---

# TEMPLATE 6 — `tasks.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Hands-on Tasks

> 10+ practice tasks across all levels. Each task includes a goal, instructions, and acceptance criteria.

---

## Junior Tasks

### Task 1: Set Up a Local Replica Set
**Goal:** Run a 3-member replica set on localhost.
**Instructions:**
1. Start three `mongod` instances on ports 27017, 27018, 27019 with `--replSet rs0`
2. Connect with `mongosh` and run `rs.initiate()`
3. Add the two secondaries: `rs.add("localhost:27018")`, `rs.add("localhost:27019")`
**Acceptance criteria:** `rs.status()` shows one PRIMARY and two SECONDARY members.

### Task 2: Design and Insert a Product Catalog
**Goal:** Model an e-commerce product with variants.
**Instructions:** Design a document schema for a product with multiple variants (size, color) and insert 5 products.
**Acceptance criteria:** Schema avoids unbounded arrays, uses embedded subdocuments for variants.

### Task 3: Index and Query
**Goal:** Create an index and verify it is used.
**Instructions:** Insert 10,000 users, create an index on `{ email: 1 }`, run a query, check `explain()`.
**Acceptance criteria:** `explain("executionStats").queryPlanner.winningPlan.stage === "IXSCAN"`.

---

## Middle Tasks

### Task 4: Write an Aggregation Pipeline Report
**Goal:** Compute top 10 customers by revenue for the last 30 days.
**Instructions:** Use `$match`, `$group`, `$sort`, `$limit`, `$lookup` to join customer names.
**Acceptance criteria:** Pipeline runs under 100ms on 100K orders with proper indexes.

### Task 5: Implement a Safe Money Transfer
**Goal:** Transfer funds between two accounts using a multi-document transaction.
**Instructions:** Use `session.withTransaction()`, handle `TransientTransactionError`.
**Acceptance criteria:** Balance consistency is maintained even when the test runner simulates a crash mid-transaction.

### Task 6: Design a Compound Index for a Specific Query
**Goal:** Apply the ESR rule to a given query.
**Instructions:** Given `db.events.find({ userId: id, type: "click" }).sort({ timestamp: -1 })`, design the optimal index.
**Acceptance criteria:** `explain()` shows IXSCAN covering all three fields.

---

## Senior Tasks

### Task 7: Shard a Collection
**Goal:** Shard `mydb.events` on a hashed `userId` key.
**Instructions:** Enable sharding, choose shard key, shard the collection, verify chunk distribution.
**Acceptance criteria:** `db.events.getShardDistribution()` shows even distribution across 3 shards.

### Task 8: Simulate and Recover from Primary Failover
**Goal:** Verify application resilience to primary failure.
**Instructions:** Kill the primary `mongod`, observe election, verify retryable writes succeed.
**Acceptance criteria:** Application resumes writes within 15 seconds with zero data loss.

### Task 9: Set Up Continuous Backup with Oplog Tailing
**Goal:** Implement point-in-time recovery capability.
**Instructions:** Script a `mongodump --oplog` backup and verify `--oplogReplay` restore works.
**Acceptance criteria:** Can restore to within 1 second of any point in time within the backup window.

---

## Professional Tasks

### Task 10: Analyze WiredTiger Cache Pressure
**Goal:** Identify and mitigate cache pressure under write load.
**Instructions:** Generate heavy write load, monitor `db.serverStatus().wiredTiger.cache`, identify eviction stalls.
**Acceptance criteria:** Document: dirty cache %, eviction rate, and a tuning recommendation.

### Task 11: Trace an Aggregation Pipeline Through the Execution Engine
**Goal:** Understand pipeline optimization.
**Instructions:** Write a 5-stage pipeline, run with `explain("allPlansExecution")`, identify which stages were coalesced or pushed down.
**Acceptance criteria:** Written analysis of each optimization applied by the query planner.

### Task 12: {{Custom task for TOPIC_NAME}}
**Goal:** {{Specific professional-level goal}}
**Instructions:** {{Step-by-step instructions}}
**Acceptance criteria:** {{Measurable outcome}}

</details>

---

# TEMPLATE 7 — `find-bug.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Find the Bug

> 10+ exercises. Each shows buggy code/schema. Find the bug, explain why it is a problem, and fix it.

---

## Exercise 1: Missing Index on Shard Key

**Buggy schema:**
```javascript
sh.shardCollection("mydb.events", { createdAt: 1 }); // monotonically increasing key
```

**What is the bug?**
Using a monotonically increasing field (timestamp) as a shard key causes all new writes to hit the same
"hot" shard — the one holding the highest chunk. This creates a write bottleneck and an uneven shard distribution.

**Fix:**
```javascript
// Option 1: Hashed shard key for even distribution
sh.shardCollection("mydb.events", { userId: "hashed" });

// Option 2: Compound shard key with hashed component
sh.shardCollection("mydb.events", { userId: 1, createdAt: 1 });
```

---

## Exercise 2: Unbounded Array Causing Document Bloat

**Buggy schema:**
```json
{
  "_id": "user123",
  "name": "Alice",
  "activityLog": [
    { "action": "login", "at": "2026-01-01T00:00:00Z" },
    { "action": "view",  "at": "2026-01-01T00:01:00Z" }
  ]
}
```

**What is the bug?**
The `activityLog` array grows without bound. Over time, a single document can exceed MongoDB's 16 MB
BSON limit and cause severe read/write amplification — the entire document is loaded into WiredTiger
cache even when only the user's `name` is needed.

**Fix:**
```javascript
// Store activity events in a separate collection, referenced by userId
db.activityLogs.insertOne({
  userId: "user123",
  action: "login",
  at: new Date()
});
// Index for fast lookup by user
db.activityLogs.createIndex({ userId: 1, at: -1 });
```

---

## Exercise 3: Wrong Write Concern for Durability

**Buggy code:**
```javascript
await db.payments.insertOne(
  { orderId: "X1", amount: 500 },
  { writeConcern: { w: 0 } } // fire and forget
);
```

**What is the bug?**
`w: 0` means the driver does not wait for any acknowledgment. If `mongod` crashes between the write
arriving in the network buffer and being written to the journal, the payment record is silently lost.

**Fix:**
```javascript
await db.payments.insertOne(
  { orderId: "X1", amount: 500 },
  { writeConcern: { w: "majority", j: true } }
  // w: "majority" — survives primary failover
  // j: true — waits for journal flush (on-disk durability)
);
```

---

## Exercise 4: `$set` Missing in Update — Accidental Document Replacement

**Buggy code:**
```javascript
db.users.updateOne(
  { _id: userId },
  { status: "active" } // missing $set!
);
```

**What is the bug?**
Without `$set`, `updateOne` **replaces** the entire document body with `{ status: "active" }`.
All other fields (`name`, `email`, `createdAt`, etc.) are permanently deleted.

**Fix:**
```javascript
db.users.updateOne(
  { _id: userId },
  { $set: { status: "active" } } // only updates the status field
);
```

---

## Exercise 5: No TTL Index on Session Cache

**Buggy schema:**
```javascript
db.sessions.insertOne({
  token: "abc123",
  userId: "user1",
  createdAt: new Date()
  // no TTL — sessions accumulate forever
});
```

**What is the bug?**
Without a TTL index, expired sessions are never cleaned up. The collection grows indefinitely,
consuming disk space and slowing down queries that scan the collection.

**Fix:**
```javascript
db.sessions.createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 86400 } // auto-delete after 24 hours
);
```

---

## Exercise 6: `$where` Used for Filtering — Disables Indexes

**Buggy code:**
```javascript
db.orders.find({
  $where: "this.amount > 100 && this.status === 'pending'"
});
```

**What is the bug?**
`$where` executes JavaScript for every document — it cannot use any index, causes a full collection scan,
and is a security risk if any user input reaches this clause.

**Fix:**
```javascript
db.orders.find({
  amount: { $gt: 100 },
  status: "pending"
});
db.orders.createIndex({ status: 1, amount: 1 });
```

---

## Exercise 7: Querying Inside Array Without Multikey Index

**Buggy code:**
```javascript
// No index — collection scan on every query
db.products.find({ "tags": "electronics" });
```

**What is the bug?**
Without an index on `tags`, every query requires a full collection scan. For large collections this is
unacceptably slow.

**Fix:**
```javascript
// MongoDB automatically creates a multikey index for array fields
db.products.createIndex({ tags: 1 });
// Now queries on array elements use IXSCAN
```

---

## Exercise 8: Transaction Across Unsharded and Sharded Collections

**Buggy code:**
```javascript
// unshardedDb is standalone; shardedDb is in a sharded cluster
const session = client.startSession();
session.startTransaction();
await unshardedDb.orders.insertOne({ ... }, { session });
await shardedDb.inventory.updateOne({ ... }, { session });
await session.commitTransaction();
```

**What is the bug?**
Multi-document transactions that span a sharded collection and a standalone instance are not supported.
This will throw an `IllegalOperation` error at commit time.

**Fix:**
Ensure all collections involved in a transaction are part of the same sharded cluster or the same replica set.

---

## Exercise 9: Large `$in` Array Causing Performance Issues

**Buggy code:**
```javascript
db.products.find({ _id: { $in: hugeArray } }); // hugeArray has 50,000 elements
```

**What is the bug?**
A `$in` with 50,000 elements generates 50,000 individual index lookups. The BSON query document
itself may approach the 16 MB limit, and the query takes seconds instead of milliseconds.

**Fix:**
```javascript
// Batch into chunks of 1000
for (let i = 0; i < hugeArray.length; i += 1000) {
  const batch = hugeArray.slice(i, i + 1000);
  const results = await db.products.find({ _id: { $in: batch } }).toArray();
  // process results
}
```

---

## Exercise 10: Missing Projection — Fetching Entire Documents When Only One Field Is Needed

**Buggy code:**
```javascript
// Returns entire documents; only name is used downstream
const users = await db.users.find({ active: true }).toArray();
users.forEach(u => sendEmail(u.name));
```

**What is the bug?**
Every document (potentially with large embedded arrays and nested objects) is transferred from MongoDB
to the application, consuming network bandwidth and WiredTiger cache unnecessarily.

**Fix:**
```javascript
const users = await db.users.find({ active: true }, { projection: { name: 1, _id: 0 } }).toArray();
users.forEach(u => sendEmail(u.name));
```

---

## Exercise 11: {{Custom bug for TOPIC_NAME}}

**Buggy code:**
```javascript
// {{Show a realistic bug specific to TOPIC_NAME}}
```

**What is the bug?** {{Explanation}}

**Fix:**
```javascript
// {{Corrected code}}
```

</details>

---

# TEMPLATE 8 — `optimize.md`

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Optimize

> 10+ exercises. Each shows a slow query or schema. Identify the bottleneck, explain root cause, and optimize it.
> Always include `explain("executionStats")` output before and after.

---

## Exercise 1: Full Collection Scan on High-Traffic Query

**Before (slow):**
```javascript
db.orders.find({ customerId: "cust_001", status: "pending" });
```

```
// explain("executionStats") BEFORE
{
  "queryPlanner": { "winningPlan": { "stage": "COLLSCAN" } },
  "executionStats": {
    "executionTimeMillis": 1450,
    "totalDocsExamined": 2500000,
    "totalDocsReturned": 12
  }
}
```

**Root cause:** No index on `customerId` or `status`. Every query scans 2.5M documents to find 12.

**Fix:**
```javascript
// Compound index following ESR rule: Equality (customerId, status)
db.orders.createIndex({ customerId: 1, status: 1 });
```

```
// explain("executionStats") AFTER
{
  "queryPlanner": { "winningPlan": { "stage": "IXSCAN",
    "indexName": "customerId_1_status_1" } },
  "executionStats": {
    "executionTimeMillis": 2,
    "totalDocsExamined": 12,
    "totalDocsReturned": 12
  }
}
```

**Result:** 1450ms → 2ms. DocsExamined: 2,500,000 → 12.

---

## Exercise 2: Aggregation Pipeline — Missing Early `$match`

**Before (slow):**
```javascript
db.events.aggregate([
  { $group: { _id: "$userId", count: { $sum: 1 } } },
  { $match: { count: { $gt: 100 } } }
]);
```

**Root cause:** `$group` processes all 10M documents before `$match` filters. The `$match` cannot use an index
because it is after `$group` and operates on a computed field.

**Fix:**
```javascript
// Add an early $match to reduce input documents
db.events.aggregate([
  { $match: { createdAt: { $gte: new Date("2026-01-01") } } }, // uses index — reduces to 500K docs
  { $group: { _id: "$userId", count: { $sum: 1 } } },
  { $match: { count: { $gt: 100 } } }
]);
db.events.createIndex({ createdAt: 1, userId: 1 });
```

**Result:** Pipeline input: 10M docs → 500K docs. Execution time: 45s → 3s.

---

## Exercise 3: `$lookup` Without Index on Foreign Field

**Before (slow):**
```javascript
db.orders.aggregate([
  { $lookup: {
      from: "customers",
      localField: "customerId",
      foreignField: "_id",
      as: "customer"
  }}
]);
// customers collection: 500,000 documents, no index on _id beyond the default
```

**Root cause:** The default `_id` index IS present, but `customerId` in `orders` holds string IDs while
`customers._id` is `ObjectId`. Type mismatch means MongoDB cannot use the index — results in COLLSCAN on `customers` for every order.

**Fix:**
```javascript
// Ensure types match — store customerId as ObjectId in orders
db.orders.updateMany(
  {},
  [{ $set: { customerId: { $toObjectId: "$customerId" } } }]
);
// Or create a string _id in customers collection at insert time
```

**Result:** Each `$lookup` COLLSCAN (500K reads) → IXSCAN (1 read). Execution: 120s → 0.8s.

---

## Exercise 4: Sort Without Index — In-Memory Sort on Large Result Set

**Before (slow):**
```javascript
db.products.find({ category: "electronics" }).sort({ price: -1 });
```

```
// explain BEFORE
{
  "queryPlanner": { "winningPlan": { "stage": "SORT",
    "inputStage": { "stage": "COLLSCAN" } } },
  "executionStats": {
    "executionTimeMillis": 3200,
    "memUsage": 104857600  // 100MB — hit the in-memory sort limit
  }
}
```

**Fix:**
```javascript
// Compound index: equality (category) + sort (price)
db.products.createIndex({ category: 1, price: -1 });
```

```
// explain AFTER
{
  "queryPlanner": { "winningPlan": { "stage": "IXSCAN",
    "indexName": "category_1_price_-1" } },
  "executionStats": {
    "executionTimeMillis": 15,
    "totalDocsExamined": 8500,
    "totalDocsReturned": 8500
  }
}
```

**Result:** 3200ms → 15ms. Eliminates in-memory sort entirely.

---

## Exercise 5: N+1 Problem — Loop of `findOne` Calls

**Before (slow):**
```javascript
const orders = await db.orders.find({ status: "pending" }).toArray();
for (const order of orders) {
  order.customer = await db.customers.findOne({ _id: order.customerId });
}
```

**Root cause:** 1 query to get orders, then N individual `findOne` queries for customers.
With 1,000 pending orders, that is 1,001 round trips.

**Fix:**
```javascript
// Single aggregation with $lookup
const ordersWithCustomers = await db.orders.aggregate([
  { $match: { status: "pending" } },
  { $lookup: {
      from: "customers",
      localField: "customerId",
      foreignField: "_id",
      as: "customer"
  }},
  { $unwind: "$customer" }
]).toArray();
```

**Result:** 1,001 round trips → 1 round trip. Latency: 4.2s → 180ms.

---

## Exercise 6: Inefficient Pagination with `skip()` on Large Offsets

**Before (slow):**
```javascript
db.articles.find().sort({ createdAt: -1 }).skip(50000).limit(20);
// Page 2500 of a result set
```

**Root cause:** MongoDB must scan and discard the first 50,000 documents before returning 20.
Performance degrades linearly with page depth.

**Fix:**
```javascript
// Cursor-based pagination using the last seen _id
db.articles.find({ createdAt: { $lt: lastSeenCreatedAt } })
  .sort({ createdAt: -1 })
  .limit(20);
db.articles.createIndex({ createdAt: -1 });
```

**Result:** O(offset) scan → O(log n) index seek. Page 2500 latency: 8s → 3ms.

---

## Exercise 7: Querying a Function on an Indexed Field

**Before (slow):**
```javascript
// Trying to find users whose email domain is "example.com"
db.users.find({ $where: "this.email.split('@')[1] === 'example.com'" });
// Or using $regex with leading wildcard
db.users.find({ email: { $regex: /example\.com$/ } });
```

**Root cause:** `$where` cannot use indexes. `$regex` with no leading anchor performs a full index scan
(not an index seek) because the prefix is unknown.

**Fix:**
```javascript
// Store domain as a separate field at write time
db.users.updateMany({}, [{ $set: { emailDomain: { $arrayElemAt: [{ $split: ["$email", "@"] }, 1] } } }]);
db.users.createIndex({ emailDomain: 1 });
db.users.find({ emailDomain: "example.com" });
```

**Result:** COLLSCAN (1.8s) → IXSCAN (< 5ms).

---

## Exercise 8: Write Amplification from Large Documents in Capped Collection

**Before (memory-inefficient):**
```json
{
  "_id": "log_001",
  "userId": "user123",
  "action": "purchase",
  "rawRequestPayload": "<10KB JSON blob>",
  "createdAt": "2026-03-26T00:00:00Z"
}
```

**Root cause:** Storing large `rawRequestPayload` in every log document causes:
- WiredTiger cache fills with large pages
- Oplog entries are large — replication lag increases
- Capped collection rolls over faster than expected

**Fix:**
```javascript
// Store only essential fields in the log collection; archive raw payloads to object storage
db.auditLogs.insertOne({
  userId: "user123",
  action: "purchase",
  createdAt: new Date(),
  payloadRef: "s3://bucket/logs/2026/03/26/log_001.json"
});
```

**Result:** Avg document size: 10 KB → 200 bytes. Cache efficiency improved 50x.

---

## Exercise 9: Unindexed `$or` Query

**Before (slow):**
```javascript
db.products.find({
  $or: [
    { name: "Widget" },
    { sku: "WDG-001" }
  ]
});
```

**Root cause:** For `$or` to use indexes, **each branch** of the `$or` must have its own index.
If either branch lacks an index, MongoDB falls back to a COLLSCAN for the entire query.

**Fix:**
```javascript
db.products.createIndex({ name: 1 });
db.products.createIndex({ sku: 1 });
// Now each branch of $or uses its own index (index union)
```

**Result:** COLLSCAN → index union plan. Execution: 2.1s → 8ms.

---

## Exercise 10: Aggregation `$unwind` on Large Array Before `$match`

**Before (slow):**
```javascript
db.orders.aggregate([
  { $unwind: "$items" },           // explodes each order into N documents
  { $match: { "items.sku": "WDG" } }
]);
```

**Root cause:** `$unwind` on an array of 50 items multiplies the document count 50x before `$match` filters.
A collection of 100K orders becomes 5M intermediate documents.

**Fix:**
```javascript
db.orders.aggregate([
  { $match: { "items.sku": "WDG" } }, // filter BEFORE $unwind using multikey index
  { $unwind: "$items" },
  { $match: { "items.sku": "WDG" } }  // re-filter after unwind for precision
]);
db.orders.createIndex({ "items.sku": 1 }); // multikey index
```

**Result:** Intermediate documents: 5M → 10K. Execution: 38s → 400ms.

---

## Exercise 11: {{Custom optimize exercise for TOPIC_NAME}}

**Before:**
```javascript
// {{Slow query or schema related to TOPIC_NAME}}
```

**Root cause:** {{Explanation of why it is slow}}

**Fix:**
```javascript
// {{Optimized version}}
```

**Result:** {{Before metric}} → {{After metric}}.

</details>

---

## Universal Requirements

- 8 files per topic: `junior.md`, `middle.md`, `senior.md`, `professional.md`, `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md`
- Keep `{{TOPIC_NAME}}` placeholder throughout — replace with actual topic name when generating
- Primary code fence: ` ```javascript ` for queries, ` ```json ` for documents
- Include Mermaid diagrams for replication topology and query execution flow
- All `find-bug.md` exercises must reference: missing index on shard key, unbounded array causing document bloat, wrong write concern for durability
- All `optimize.md` exercises must include `explain("executionStats")` output before and after
---
---

# TEMPLATE 9 — `specification.md`

> **Focus:** Official documentation deep-dive — API reference, configuration schema, behavioral guarantees, and version compatibility.
>
> **Source:** Always cite the official documentation with direct section links.
> - Blockchain: https://bitcoin.org/bitcoin.pdf | https://ethereum.org/en/whitepaper/
> - Software Design/Architecture: https://refactoring.guru/design-patterns
> - Computer Science: https://en.wikipedia.org/wiki/List_of_data_structures
> - Software Architect: https://www.oreilly.com/library/view/fundamentals-of-software/9781492043447/
> - System Design: https://github.com/donnemartin/system-design-primer
> - MongoDB: https://www.mongodb.com/docs/manual/reference/
> - PostgreSQL: https://www.postgresql.org/docs/current/
> - API Design: https://swagger.io/specification/ (OpenAPI 3.x)
> - Backend: https://developer.mozilla.org/en-US/docs/Learn/Server-side
> - Elasticsearch: https://www.elastic.co/guide/en/elasticsearch/reference/current/
> - Redis: https://redis.io/docs/latest/commands/
> - Full-Stack: https://developer.mozilla.org/en-US/

<details open>
<summary><strong>Template Content</strong></summary>

# {{TOPIC_NAME}} — Specification

> **Official Documentation Reference**
>
> Source: [{{TOOL_NAME}} Official Docs]({{DOCS_URL}}) — {{SECTION}}

---

## Table of Contents

1. [Docs Reference](#docs-reference)
2. [API / Configuration Reference](#api--configuration-reference)
3. [Core Concepts & Rules](#core-concepts--rules)
4. [Schema / Options Reference](#schema--options-reference)
5. [Behavioral Specification](#behavioral-specification)
6. [Edge Cases from Official Docs](#edge-cases-from-official-docs)
7. [Version & Compatibility Matrix](#version--compatibility-matrix)
8. [Official Examples](#official-examples)
9. [Compliance Checklist](#compliance-checklist)
10. [Related Documentation](#related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Docs** | [{{TOOL_NAME}} Documentation]({{DOCS_URL}}) |
| **Relevant Section** | {{SECTION_NAME}} — {{SECTION_TITLE}} |
| **Version** | {{TOOL_VERSION}} |
| **Direct URL** | {{DOCS_URL}}/{{PATH}} |

---

## 2. API / Configuration Reference

> From: {{DOCS_URL}}/{{API_SECTION}}

### {{RESOURCE_OR_ENDPOINT_NAME}}

| Field / Parameter | Type | Required | Default | Description |
|------------------|------|----------|---------|-------------|
| `{{FIELD_1}}` | `{{TYPE_1}}` | ✅ | — | {{DESC_1}} |
| `{{FIELD_2}}` | `{{TYPE_2}}` | ❌ | `{{DEFAULT_2}}` | {{DESC_2}} |
| `{{FIELD_3}}` | `{{TYPE_3}}` | ❌ | `{{DEFAULT_3}}` | {{DESC_3}} |

---

## 3. Core Concepts & Rules

The official documentation defines these key rules for {{TOPIC_NAME}}:

### Rule 1: {{RULE_NAME}}

> *Docs: [{{DOCS_URL}}/{{SECTION}}]({{DOCS_URL}}/{{SECTION}}) — "{{DOC_QUOTE}}"*

{{RULE_EXPLANATION}}

```{{CODE_LANG}}
# ✅ Correct — follows official guidance
{{VALID_EXAMPLE}}

# ❌ Incorrect — violates official guidance
{{INVALID_EXAMPLE}}
```

### Rule 2: {{RULE_NAME}}

> *Docs: [{{DOCS_URL}}/{{SECTION}}]({{DOCS_URL}}/{{SECTION}})*

{{RULE_EXPLANATION}}

```{{CODE_LANG}}
{{CODE_EXAMPLE}}
```

---

## 4. Schema / Options Reference

| Option | Type | Allowed Values | Default | Docs |
|--------|------|---------------|---------|------|
| `{{OPT_1}}` | `{{TYPE_1}}` | `{{VALUES_1}}` | `{{DEFAULT_1}}` | [Link]({{URL_1}}) |
| `{{OPT_2}}` | `{{TYPE_2}}` | `{{VALUES_2}}` | `{{DEFAULT_2}}` | [Link]({{URL_2}}) |
| `{{OPT_3}}` | `{{TYPE_3}}` | `{{VALUES_3}}` | `{{DEFAULT_3}}` | [Link]({{URL_3}}) |

---

## 5. Behavioral Specification

### Normal Operation

{{NORMAL_OPERATION}}

### Performance Characteristics

| Operation | Time Complexity | Space | Notes |
|-----------|----------------|-------|-------|
| {{OP_1}} | {{TIME_1}} | {{SPACE_1}} | {{NOTES_1}} |
| {{OP_2}} | {{TIME_2}} | {{SPACE_2}} | {{NOTES_2}} |

### Error / Failure Conditions

| Error | Condition | Official Resolution |
|-------|-----------|---------------------|
| `{{ERROR_1}}` | {{COND_1}} | {{FIX_1}} |
| `{{ERROR_2}}` | {{COND_2}} | {{FIX_2}} |

---

## 6. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| {{EDGE_1}} | {{BEHAVIOR_1}} | [Docs]({{URL_1}}) |
| {{EDGE_2}} | {{BEHAVIOR_2}} | [Docs]({{URL_2}}) |
| {{EDGE_3}} | {{BEHAVIOR_3}} | [Docs]({{URL_3}}) |

---

## 7. Version & Compatibility Matrix

| Version | Change | Backward Compatible? | Notes |
|---------|--------|---------------------|-------|
| `{{VER_1}}` | {{CHANGE_1}} | {{COMPAT_1}} | {{NOTES_1}} |
| `{{VER_2}}` | {{CHANGE_2}} | {{COMPAT_2}} | {{NOTES_2}} |

---

## 8. Official Examples

### Example from Docs: {{EXAMPLE_TITLE}}

> Source: [{{DOCS_URL}}/{{ANCHOR}}]({{DOCS_URL}}/{{ANCHOR}})

```{{CODE_LANG}}
{{OFFICIAL_EXAMPLE_CODE}}
```

**Expected result:**

```
{{EXPECTED_RESULT}}
```

---

## 9. Compliance Checklist

- [ ] Follows official recommended patterns for {{TOPIC_NAME}}
- [ ] Uses supported version ({{TOOL_VERSION}}+)
- [ ] Handles all documented error conditions
- [ ] Follows official security recommendations
- [ ] Compatible with listed dependencies
- [ ] Configuration validated against official schema

---

## 10. Related Documentation

| Topic | Doc Section | URL |
|-------|-------------|-----|
| {{RELATED_1}} | {{SECTION_1}} | [Link]({{URL_1}}) |
| {{RELATED_2}} | {{SECTION_2}} | [Link]({{URL_2}}) |
| {{RELATED_3}} | {{SECTION_3}} | [Link]({{URL_3}}) |

---

> **Content Rules for `specification.md`:**
> - Always link directly to the relevant doc section (not just the homepage)
> - Use official examples from the documentation when available
> - Note breaking changes and deprecated features between versions
> - Include official security recommendations
> - Minimum 2 Core Rules, 3 Schema fields, 3 Edge Cases, 2 Official Examples

</details>
