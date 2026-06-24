# Senior Go Backend Interview — Question Bank

A complete, interview-ready question bank for a **Senior Golang Backend Engineer** role (≈ 5+ years of experience). Targets the exact stack hiring teams probe today: **Go runtime & concurrency, PostgreSQL, MongoDB, Kafka/RabbitMQ, distributed systems, gRPC/REST, security, Docker/Kubernetes, AWS, and observability** — plus algorithms and behavioral rounds.

Each section is a graded list of questions, ordered from *warm-up* to *deep / staff-level*. The goal is not trivia recall — at this level interviewers want **why**, **trade-offs**, and **what breaks in production**. For every question, be ready to answer in three layers: *definition → mechanism → real-world trade-off*.

> How to use this: cover the answer, say it out loud as if to an interviewer, then check yourself. If you can't explain the *failure mode* of a thing, you don't know it well enough yet.

---

## Table of Contents

1. [Golang Language & Runtime](#1-golang-language--runtime)
2. [Concurrency](#2-concurrency)
3. [Algorithms & Data Structures](#3-algorithms--data-structures)
4. [Databases (PostgreSQL & SQL)](#4-databases-postgresql--sql)
5. [NoSQL (MongoDB)](#5-nosql-mongodb)
6. [Messaging (Kafka / RabbitMQ / NATS)](#6-messaging-kafka--rabbitmq--nats)
7. [Distributed Systems](#7-distributed-systems)
8. [System Design](#8-system-design)
9. [API Design (REST / gRPC / WebSocket)](#9-api-design-rest--grpc--websocket)
10. [Security](#10-security)
11. [Testing (TDD / BDD / DDD)](#11-testing-tdd--bdd--ddd)
12. [DevOps (Docker / Kubernetes / CI-CD)](#12-devops-docker--kubernetes--cicd)
13. [Observability](#13-observability)
14. [Cloud (AWS / GCP)](#14-cloud-aws--gcp)
15. [Behavioral & Leadership](#15-behavioral--leadership)

---

## 1. Golang Language & Runtime

### Goroutines, Scheduler & the GMP Model
1. Explain the GMP model (G, M, P). What does each component do and why does P exist between G and M?
2. What is `GOMAXPROCS` and how does changing it affect scheduling? What's a sane production value?
3. How does Go's work-stealing scheduler balance load across Ps? What is the global run queue vs. local run queue?
4. What is a goroutine's initial stack size, and how does it grow? What's stack copying and when does it happen?
5. How does the scheduler handle a goroutine making a **blocking syscall**? (hand-off of P, creation of a new M)
6. What is goroutine preemption? Difference between cooperative and asynchronous (signal-based) preemption introduced in Go 1.14?
7. A goroutine runs a tight `for {}` loop with no function calls — what happened before 1.14 and what happens now?
8. How is a goroutine cheaper than an OS thread? Quantify it (stack size, scheduling cost).
9. How do you detect and debug a **goroutine leak**? What tools and signals point to one?

### Channels & select
10. What's the difference between buffered and unbuffered channels in terms of synchronization guarantees?
11. What happens on send/receive to a `nil` channel? A closed channel? Why is this useful in `select`?
12. How do you implement a timeout on a channel operation? (`time.After`, `context`)
13. Explain the "send on closed channel panics" rule. Who should own closing a channel and why?
14. How does `select` choose among multiple ready cases? What does `default` do?
15. Implement a fan-out/fan-in pipeline. How do you propagate cancellation and avoid leaking the producers?

### Synchronization primitives
16. When do you reach for a channel vs. a `sync.Mutex`? "Share memory by communicating" — when does that advice *not* apply?
17. `sync.Mutex` vs `sync.RWMutex` — when does RWMutex actually help, and when does it hurt?
18. What problem does `sync.Map` solve, and what are its two optimized access patterns? When is a plain map + mutex better?
19. What does `sync.Once` guarantee, and how is it implemented (fast path with atomic load)?
20. What is `sync.Pool` for? What are its gotchas (GC clears it, no guarantees, per-P pools)?
21. When is `sync/atomic` the right tool? Compare-and-swap example and the ABA problem.
22. What is false sharing and how would you avoid it with padding?

### Context & cancellation
23. What problems does `context.Context` solve? Why is it passed as the first argument by convention?
24. Difference between `WithCancel`, `WithTimeout`, `WithDeadline`, and `WithValue`. When is `WithValue` an anti-pattern?
25. If a parent context is cancelled, what happens to children? How is the cancellation propagated?
26. Why must you always call the `cancel` function returned by `context.WithCancel`, even on the happy path?
27. How do you respect context cancellation inside a CPU-bound loop with no I/O?

### Memory: stack vs heap, escape analysis, GC
28. What is escape analysis? Give three cases that force a variable to escape to the heap.
29. How do you inspect escape decisions? (`go build -gcflags='-m'`)
30. Walk through Go's GC: tri-color mark-and-sweep, write barriers, concurrent marking. Why is it low-latency rather than low-throughput?
31. What is `GOGC` and what does setting it to 50 vs 200 trade off? What is `GOMEMLIMIT` (1.19+) and when do you use it?
32. What is a "stop-the-world" pause in modern Go and roughly how long is it?
33. How do you reduce allocations in a hot path? (reuse buffers, `sync.Pool`, avoid interface boxing, preallocate slices)

### Interfaces, types, generics
34. How is an interface value represented internally? (type pointer + data pointer / `iface` vs `eface`)
35. Why does a `nil` pointer stored in an interface make the interface non-nil? (the classic typed-nil bug)
36. Explain type assertion vs type switch. What's the two-return-value form for?
37. What changed with generics (Go 1.18)? What are type parameters, constraints, and `~` (underlying type)?
38. When should you NOT use generics? What's the performance/readability trade-off vs interfaces?
39. What is the empty interface `any`, and what's the cost of using it everywhere?

### Internals: slices, maps, strings
40. Explain a slice header (ptr, len, cap). What happens to the underlying array on `append` when cap is exceeded?
41. The classic slice-aliasing bug: two slices sharing a backing array — how does it bite you and how do you avoid it (`copy`, full slice expression `a[low:high:max]`)?
42. How is a Go map implemented (buckets, overflow buckets, load factor)? Why is map iteration order randomized?
43. Why can't you take the address of a map element? Why are concurrent map writes a fatal error, not a recoverable panic?
44. How are strings represented? Cost of `string([]byte)` conversion and how to avoid copies.

### Errors, reflection, profiling
45. Idiomatic error handling: sentinel errors, `errors.Is`/`errors.As`, wrapping with `%w`. When do you wrap vs. annotate?
46. When are panics acceptable? How does `recover` work and why only inside a deferred function?
47. What is `reflect` good for, and what's the cost? Name a library that depends on it (encoding/json).
48. How do you profile a Go service? Walk through CPU, heap, block, mutex, and goroutine profiles via `pprof`.
49. How do you read a flame graph? What does a wide vs. tall frame tell you?
50. What is the race detector, how does it work (shadow memory / happens-before), and why can't it run in production?

---

## 2. Concurrency

### Patterns
1. Implement a **worker pool** with a bounded number of workers and a job channel. How do you signal completion and collect results?
2. Implement **fan-out / fan-in**. How do you cancel the whole pipeline if one stage errors? (`errgroup`)
3. Producer–consumer with backpressure — how does a bounded channel naturally apply backpressure?
4. Implement a **rate limiter**: token bucket vs leaky bucket. How does `golang.org/x/time/rate` work?
5. Implement a **circuit breaker** (closed → open → half-open). What metrics drive the transitions?
6. Implement a **semaphore** with a buffered channel and with `golang.org/x/sync/semaphore`.
7. Pipeline with cancellation: use `context` + `errgroup` so the first error tears down the rest.

### Hazards
8. What is a data race vs a race condition? Are all data races also race conditions?
9. What causes a **deadlock**? Walk through the four Coffman conditions and how Go's runtime detects "all goroutines are asleep".
10. What is a **livelock**? Give a realistic example (two goroutines politely retrying).
11. What is goroutine starvation, and how did Go's mutex "starvation mode" address it?
12. What is backpressure and what are your options when a downstream consumer can't keep up? (drop, buffer, block, shed load)
13. How do you bound concurrency so you don't spawn 100k goroutines hitting a database?
14. Explain the Go memory model: what does "happens-before" mean, and what synchronization establishes it?

---

## 3. Algorithms & Data Structures

> Senior loops still include a coding screen. Expect 1–2 medium/hard problems with a focus on *clean Go*, complexity analysis, and edge cases — plus follow-ups that turn the problem into a system-design discussion.

### Core topics to drill
1. Arrays & strings: two pointers, sliding window, prefix sums.
2. Hash maps & sets: frequency counting, dedup, two-sum family, LRU cache (map + doubly linked list).
3. Stacks & queues: monotonic stack (next greater element), min-stack, queue via two stacks.
4. Linked lists: reverse, cycle detection (Floyd), merge k sorted lists (heap).
5. Trees: BFS/DFS, level-order, lowest common ancestor, BST validation, serialize/deserialize.
6. Heaps / priority queues: top-k, median of a stream, `container/heap` usage in Go.
7. Graphs: BFS/DFS, topological sort, Dijkstra, union-find (cycle detection, connected components).
8. Recursion & backtracking: permutations, combinations, subsets, N-queens, word search.
9. Dynamic programming: knapsack, coin change, longest common subsequence, edit distance, LIS.
10. Sorting & searching: quicksort/mergesort trade-offs, binary search on answer, `sort.Search`.

### Complexity & Go-specific
11. State and justify the time/space complexity of your solution. What's the worst case vs amortized?
12. Implement an LRU cache in O(1). Why a doubly linked list + map?
13. Why is `container/heap` an interface you implement rather than a generic container? Implement a min-heap.
14. How does Go's `sort.Slice` work, and why is it slower than `sort.Sort` with a typed slice (reflection / closures)?
15. Design a rate limiter / sliding-window counter — bridges algorithms into backend design.

---

## 4. Databases (PostgreSQL & SQL)

### Internals & storage
1. How does PostgreSQL store rows on disk? (heap files, pages, tuples, the visibility map)
2. Explain MVCC. How are row versions kept, what is `xmin`/`xmax`, and why do you need `VACUUM`?
3. What is table bloat and how does autovacuum fight it? What is the transaction-ID wraparound problem?
4. What is the WAL (write-ahead log)? How does it give you durability and enable replication & PITR?
5. What are TOAST tables and when do they kick in?

### Indexes
6. Compare B-Tree, Hash, GIN, GiST, BRIN. Give a use case for each.
7. When does a GIN index help (jsonb, full-text, array containment)? What's the write-amplification cost?
8. Composite index column order — why does `(a, b)` not serve a query filtering only on `b`? (left-prefix rule)
9. What is a covering index / index-only scan? What is a partial index? A functional/expression index?
10. When does the planner *ignore* an index and choose a seq scan? Is that always wrong?

### Query optimization
11. Read this `EXPLAIN ANALYZE` output: distinguish estimated vs actual rows, seq scan vs index scan, nested loop vs hash join vs merge join. Where's the bottleneck?
12. What is the N+1 query problem and how do you fix it in a Go service?
13. How do you diagnose a slow query in production? (`pg_stat_statements`, `auto_explain`, `EXPLAIN (ANALYZE, BUFFERS)`)
14. When do CTEs hurt performance, and what changed about CTE inlining in PostgreSQL 12?
15. Keyset (cursor) pagination vs `OFFSET/LIMIT` — why does OFFSET degrade at scale?

### Transactions, ACID, isolation, locks
16. Define ACID precisely. Which letter does replication threaten?
17. Walk through the four isolation levels and the anomalies each prevents (dirty read, non-repeatable read, phantom, serialization anomaly). What does PostgreSQL actually implement for "Read Committed"?
18. What is Serializable Snapshot Isolation (SSI) and what's its cost?
19. Explain row-level vs table-level locks. What's `SELECT ... FOR UPDATE` vs `FOR SHARE`?
20. What is a deadlock in Postgres, how does the DB detect & resolve it, and how do you prevent them (consistent lock ordering)?
21. Optimistic vs pessimistic locking — implement optimistic locking with a `version` column.
22. What is `SKIP LOCKED` and how does it let you build a job queue in Postgres?

### Scaling
23. Table partitioning: range vs list vs hash. What problems does it solve and what does it complicate?
24. Streaming replication: synchronous vs asynchronous. What is replication lag and how do you handle read-after-write consistency with read replicas?
25. When do you shard, and what makes a good shard key? How do cross-shard joins and transactions become hard?
26. Connection pooling: why is it essential for Postgres, and what does PgBouncer do (session vs transaction pooling)?
27. How do you do a zero-downtime schema migration (expand-contract / online migration)? Why is adding a NOT NULL column with a default dangerous on old Postgres versions?

---

## 5. NoSQL (MongoDB)

1. When do you choose MongoDB over PostgreSQL? When is choosing it a mistake?
2. Embedding vs referencing — how do you decide? What are the document size limits (16 MB) and how do they shape modeling?
3. How do MongoDB indexes work? Compound indexes, multikey indexes (on arrays), the ESR (Equality, Sort, Range) rule.
4. What are the consistency guarantees? Explain read concern, write concern, and read preference.
5. How does replication work (replica set, primary election via Raft-like protocol)? What happens during failover?
6. How does sharding work (shard key, chunks, balancer, mongos)? What makes a bad shard key (monotonic keys → hot shard)?
7. What does the aggregation pipeline do? Walk through `$match`, `$group`, `$lookup`, `$unwind`. Why put `$match` first?
8. Are multi-document transactions supported, and what's their cost vs a relational DB?
9. How do you avoid the "massive array" / unbounded document growth anti-pattern?
10. How do you diagnose a slow MongoDB query? (`explain()`, covered queries, `COLLSCAN` vs `IXSCAN`)

---

## 6. Messaging (Kafka / RabbitMQ / NATS)

### Kafka fundamentals
1. Explain Kafka's core concepts: topic, partition, offset, broker, producer, consumer, consumer group.
2. How does partitioning give you parallelism and ordering? Why is ordering guaranteed only **within a partition**?
3. How does a consumer group divide partitions among consumers? What triggers a rebalance and why is it disruptive?
4. What determines which partition a message goes to (key hashing, round-robin)? How do you guarantee per-entity ordering?
5. What is the replication factor and ISR (in-sync replicas)? What is `acks=0/1/all` and the durability trade-off?
6. What are `min.insync.replicas` and how does it interact with `acks=all` to prevent data loss?

### Delivery semantics
7. Explain at-most-once, at-least-once, and exactly-once. Which is the default and why is exactly-once "hard"?
8. How does Kafka achieve exactly-once (idempotent producer + transactions)? What's the cost?
9. If you have at-least-once delivery, how do you make your **consumer idempotent**? (dedup keys, upserts)
10. When do you commit offsets — before or after processing? What bug does each choice cause (lost vs duplicate messages)?
11. What is a Dead Letter Queue (DLQ) and what's your retry strategy (retry topic, backoff, max attempts)?

### Operations & design
12. What is consumer lag, how do you monitor it, and what does growing lag tell you?
13. How do you scale consumers? Why can't you have more consumers than partitions in a group?
14. How do you choose the number of partitions? What's painful about changing it later?
15. Kafka vs RabbitMQ vs NATS — when do you pick each? (log/streaming vs smart broker/routing vs lightweight pub-sub)
16. What is log compaction and when do you use it (changelog topics, CDC)?
17. How does the **Transactional Outbox** pattern guarantee you publish an event iff the DB write committed?

---

## 7. Distributed Systems

1. State the CAP theorem precisely. Why is "CA" not a real choice for a distributed system? Give an AP and a CP system.
2. CAP vs PACELC — what does PACELC add (latency vs consistency when there's no partition)?
3. Define the consistency spectrum: strong, linearizable, sequential, causal, eventual. Give an example of each.
4. What is consensus? Explain Raft: leader election, log replication, terms, commit index. How does it differ from Paxos in practice?
5. How does leader election work and what is split-brain? How does a quorum (majority) prevent it?
6. What is idempotency and why is it the backbone of reliable distributed systems? How do you make a payment API idempotent (idempotency keys)?
7. What is eventual consistency, and how do you give users read-your-writes despite it?
8. Explain the **Saga pattern** for distributed transactions. Orchestration vs choreography — trade-offs. How do compensating transactions work?
9. Explain the **Outbox pattern** and how it pairs with CDC (Debezium) to avoid dual-write problems.
10. Explain **CQRS** — when is splitting read/write models worth the complexity?
11. Explain **Event Sourcing** — what do you store, how do you rebuild state, what are snapshots, and what's the hardest part (schema evolution of events)?
12. The two-generals / dual-write problem: why can't you atomically write to a DB *and* publish to Kafka? How do you solve it?
13. How do you handle distributed time? Why are wall clocks unreliable; what are logical clocks, Lamport timestamps, and vector clocks?
14. What is a distributed lock, when do you actually need one, and why is it dangerous? (fencing tokens, Redlock controversy)
15. How do you design for failure: timeouts, retries with exponential backoff + jitter, circuit breakers, bulkheads, graceful degradation?

---

## 8. System Design

> Expect a 45–60 min open-ended design. Drive it: clarify requirements → estimate scale (QPS, storage, bandwidth) → define APIs → high-level diagram → deep-dive on 1–2 components → discuss bottlenecks, failure modes, and trade-offs. Always state your assumptions.

### Classic prompts
1. **URL shortener** — key generation (counter+base62 vs hash), collision handling, read-heavy caching, redirect latency, analytics.
2. **Notification service** — multi-channel (push/email/SMS), fan-out, rate limiting, user preferences, retries & idempotency, template rendering.
3. **Payment system** — idempotency, double-spend prevention, the saga across payment/ledger/inventory, exactly-once charging, audit log, PCI concerns.
4. **Chat system** — WebSocket fan-out, presence, message ordering & delivery receipts, online/offline, storage, group chat fan-out.
5. **Distributed cache** — consistent hashing, replication, eviction (LRU/LFU), cache invalidation, hot keys, thundering herd / cache stampede.
6. **Message queue / broker** — durability, ordering, at-least-once delivery, consumer groups, backpressure.
7. **API gateway** — routing, auth, rate limiting, request aggregation, retries, observability.
8. **Rate limiter (distributed)** — token bucket in Redis, sliding window, handling clock skew and races.
9. **Newsfeed / timeline** — fan-out-on-write vs fan-out-on-read, the celebrity problem, ranking.
10. **File storage / S3-like** — chunking, metadata service, replication, consistency.

### Cross-cutting design questions
11. How do you estimate capacity? Walk through QPS, storage/day, bandwidth, and memory for a cache.
12. Where do you add caching and what are the invalidation strategies (write-through, write-back, write-around, TTL)?
13. How do you achieve **high availability** (active-active vs active-passive, health checks, failover, multi-AZ)? What's the difference between 99.9% and 99.99% in real downtime?
14. How do you keep a service **stateless** so it scales horizontally? Where does the state actually go?
15. Load balancing: L4 vs L7, algorithms (round-robin, least-connections, consistent hashing), session affinity — when is each right?

---

## 9. API Design (REST / gRPC / WebSocket)

1. REST maturity: resource naming, correct HTTP verbs & status codes, idempotency of PUT/DELETE vs POST.
2. How do you design pagination? Offset vs cursor/keyset — pros, cons, and stability under inserts.
3. API versioning strategies (URI, header, media-type). How do you ship a breaking change safely with deprecation?
4. gRPC vs REST — when do you choose gRPC? What does HTTP/2 multiplexing buy you?
5. Protocol Buffers: how does wire compatibility work? Rules for evolving a schema without breaking clients (never reuse field numbers, reserved fields).
6. The four gRPC modes (unary, server-stream, client-stream, bidi). Give a use case for streaming.
7. How do gRPC deadlines/cancellation propagate, and how does that map to Go's `context`?
8. WebSocket vs SSE vs long-polling — when do you pick each?
9. How do you handle partial failure and retries safely at the API layer? (idempotency keys, `Retry-After`)
10. Rate limiting & throttling at the API edge — where do you enforce it and how do you communicate limits (429, headers)?

---

## 10. Security

1. JWT: structure (header.payload.signature), signing (HS256 vs RS256), and the common pitfalls (`alg: none`, no expiry, storing sensitive data in the payload).
2. How do you revoke a JWT before it expires? (short TTL + refresh tokens, denylist, token versioning)
3. Access token vs refresh token — storage (httpOnly cookie vs localStorage), rotation, and theft detection.
4. OAuth2 grant types — authorization code + PKCE, client credentials. When is each used?
5. OIDC vs OAuth2 — what does OIDC add (authentication, the ID token)? Where does Keycloak fit?
6. What is HMAC and where do you use it (webhook signature verification)?
7. TLS handshake at a high level — what does it establish, and what's mutual TLS (mTLS) for service-to-service?
8. Prevent **SQL injection** — parameterized queries / prepared statements; why string concatenation is never safe even with escaping.
9. Prevent **XSS** (output encoding, CSP) and **CSRF** (SameSite cookies, anti-CSRF tokens) — and why CSRF mostly doesn't apply to token-in-header APIs.
10. How do you store passwords? (bcrypt/argon2, salt, never MD5/SHA-1). How do you manage secrets (Vault, KMS) and rotate them?

---

## 11. Testing (TDD / BDD / DDD)

1. Walk through the TDD cycle (red-green-refactor). Where does it pay off and where does it slow you down?
2. Table-driven tests in Go — show the idiom. How do you use subtests (`t.Run`) and `t.Parallel`?
3. Unit vs integration vs end-to-end — the test pyramid. What's the "ice cream cone" anti-pattern?
4. How do you test code that depends on a DB or Kafka? (testcontainers, fakes, the trade-off vs mocks)
5. Mocks vs stubs vs fakes vs spies — when do you use each, and what does over-mocking cost you?
6. How do you make Go interfaces testable without a mocking framework? (accept interfaces, return structs; hand-written fakes)
7. What is BDD and Gherkin (Given/When/Then)? How does it change *who* writes the spec?
8. What is DDD? Define entity, value object, aggregate, aggregate root, bounded context, ubiquitous language.
9. How do bounded contexts map to microservices, and how do they communicate (context mapping, anti-corruption layer)?
10. What is property-based testing and when does it beat example-based tests? How do you measure & interpret code coverage without gaming it?

---

## 12. DevOps (Docker / Kubernetes / CI-CD)

1. Write a production-grade Go Dockerfile: multi-stage build, static binary, distroless/scratch base, non-root user. Why is the image so small?
2. What's the difference between `CMD` and `ENTRYPOINT`? `COPY` vs `ADD`? How does build-cache layering affect rebuild speed?
3. Kubernetes objects: Pod, ReplicaSet, Deployment, Service, Ingress, ConfigMap, Secret — what does each do?
4. Liveness vs readiness vs startup probes — what breaks if you confuse liveness and readiness?
5. Requests vs limits (CPU & memory). What is an OOMKill, and what happens when a container exceeds its CPU limit (throttling, not killing)?
6. How does a rolling update work, and how do you do blue-green or canary deploys?
7. How does service discovery and load balancing work inside Kubernetes (kube-proxy, ClusterIP, DNS)?
8. What goes in a CI/CD pipeline for a Go service (lint, test, race, build, scan, push, deploy)? How do you keep it fast?
9. How do you handle graceful shutdown in Go on `SIGTERM` so Kubernetes can drain you cleanly?
10. What is the role of nginx / a reverse proxy in front of your service, and what do you tune?

---

## 13. Observability

1. The three pillars: metrics, logs, traces. What question does each answer, and why do you need all three?
2. Instrument a Go service with Prometheus — what are the four metric types (counter, gauge, histogram, summary) and when do you use each?
3. What are the RED and USE methods for choosing what to measure?
4. Why are histograms better than averages for latency? What's the danger of averaging percentiles across instances?
5. What is distributed tracing? How does a trace/span/context propagate across services (W3C trace-context, OpenTelemetry)?
6. How do you correlate a log line with a trace and a metric spike? (trace IDs in structured logs)
7. Structured logging in Go (`slog`) — why structured over printf, and what do you put in vs leave out (no secrets/PII)?
8. How do you design alerts that page humans without causing alert fatigue? What is an SLO, SLI, and error budget?
9. How do you debug high p99 latency that doesn't show up in p50? (tail latency, GC pauses, lock contention, noisy neighbor)
10. What is sampling and why do you need it for traces and high-cardinality metrics at scale?

---

## 14. Cloud (AWS / GCP)

1. Core AWS building blocks you've used: EC2, S3, RDS/Aurora, ECS/EKS, Lambda, SQS/SNS, ElastiCache. What's the use case for each?
2. S3 consistency model, storage classes, and how you'd design uploads/downloads (presigned URLs, multipart upload).
3. How does an Application Load Balancer work, and how does it integrate with auto-scaling and health checks?
4. What is auto-scaling (target tracking vs step scaling)? What metric do you scale a Go API on?
5. Managed database (RDS/Aurora) vs self-hosted Postgres — what do you give up and gain? How do read replicas and Multi-AZ work?
6. How do you manage secrets & config in the cloud (Secrets Manager, Parameter Store, IAM roles vs static keys)?
7. IAM basics: roles vs users vs policies, least privilege, and why you never bake credentials into an image.
8. How would you architect a highly available, multi-AZ Go microservice on AWS end to end?
9. SQS vs Kafka (MSK) vs SNS — when do you choose each?
10. How do you control cloud cost (right-sizing, spot instances, S3 lifecycle policies, egress awareness)?

---

## 15. Behavioral & Leadership

> Use STAR (Situation, Task, Action, Result). Be specific, quantify impact, and own both wins and mistakes. Seniors are judged as much on judgment and communication as on code.

1. Tell me about the **hardest technical problem** you've solved. What made it hard and how did you approach it?
2. Describe a **production outage** you handled. How did you detect, mitigate, find root cause, and prevent recurrence? What did the postmortem look like?
3. Tell me about a time you **refactored legacy code**. How did you de-risk it (tests first, strangler fig, incremental)?
4. Describe a time you **disagreed with a teammate or manager** on a technical decision. How did you resolve it?
5. How do you approach **code review** — as an author and as a reviewer? How do you give feedback that lands?
6. Tell me about a time you **mentored a junior engineer**. What changed for them?
7. Describe a project where you **owned the architecture** end to end. What trade-offs did you make and what would you do differently?
8. Tell me about a time you **shipped something under a tight deadline**. What did you cut, and how did you manage the debt?
9. How do you make a decision when you have **incomplete information** and the team is split?
10. Tell me about a **technical mistake you made**. How did you handle it and what did you learn?
11. How do you keep learning and stay current? What did you go deep on recently?
12. Why do you want to work on **event-driven systems / this product**, and what do you want to grow into?

---

## Final-mile checklist before the interview

- Can you explain Go's scheduler, GC, and memory model from memory, including failure modes?
- Can you read an `EXPLAIN ANALYZE` and a `pprof` flame graph cold?
- Can you reason about delivery semantics and idempotency for Kafka end to end?
- Can you take any system-design prompt from requirements → estimates → diagram → deep-dive → trade-offs?
- Do you have 6–8 polished STAR stories covering outages, conflict, mentorship, ownership, and failure?
- Can you say all of the above clearly in English (C1) under time pressure?
