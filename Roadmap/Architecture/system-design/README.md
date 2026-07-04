# System Design Roadmap

- Roadmap: https://roadmap.sh/system-design

A single, logically ordered learning path: **Foundations → Networking → Compute & API → Data → Async & Coordination → Building Blocks → Reliability & Ops → Security & Governance → Specialized → Capstone**. Every topic follows [TEMPLATE.md](TEMPLATE.md) (9 files: `junior`, `middle`, `senior`, `professional`, `interview`, `tasks`, `find-bug`, `optimize`, `specification`).

**Companion roadmaps** (not duplicated here):
- [Distributed Systems](../../Backend/distributed-systems/) — consensus, replication, sharding, sagas, CRDTs, service mesh, tracing
- [Architecture / DDD](../ddd/) — bounded contexts, aggregates, hexagonal, event storming
- [Computer Science](../computer-science/) — OS, networking internals, DB internals

---

## Foundations

### 1. Introduction
- 1.1 What is System Design?
- 1.2 How to Approach System Design
- 1.3 Functional vs Non-Functional Requirements
- 1.4 Key Characteristics — scalability, availability, reliability, maintainability
- 1.5 Numbers Every Engineer Should Know

### 2. Trade-offs Framework
- 2.1 CAP Theorem
- 2.2 PACELC
- 2.3 Consistency vs Availability — weak / eventual / strong, fail-over, replication

### 3. Capacity Estimation
- 3.1 QPS
- 3.2 Storage
- 3.3 Bandwidth
- 3.4 Latency Budgets

### 4. Back-of-Envelope
- 4.1 Number Tables
- 4.2 Fermi Estimation

## Networking

### 5. Networking & Protocols
- 5.1 OSI & TCP/IP
- 5.2 TCP vs UDP
- 5.3 TLS & HTTPS
- 5.4 HTTP Evolution — HTTP/1.1, HTTP/2, HTTP/3, QUIC
- 5.5 WebSockets
- 5.6 Server-Sent Events
- 5.7 Long-Polling & Streaming
- 5.8 Network Proxies & NAT

### 6. Domain Name System
- 6.1 DNS Resolution Flow
- 6.2 Record Types
- 6.3 DNS Load Balancing
- 6.4 DNS Caching & TTL
- 6.5 GeoDNS & Anycast

### 7. Content Delivery Networks
- 7.1 Pull CDN
- 7.2 Push CDN
- 7.3 Cache Invalidation
- 7.4 Edge Locations
- 7.5 CDN Security

### 8. Load Balancers
- 8.1 LB vs Reverse Proxy
- 8.2 Load Balancing Algorithms
- 8.3 Layer 4 Load Balancing
- 8.4 Layer 7 Load Balancing
- 8.5 Health Checks & Failover
- 8.6 Horizontal Scaling
- 8.7 Global Server Load Balancing

### 9. Communication
- 9.1 HTTP
- 9.2 TCP
- 9.3 UDP
- 9.4 RPC
- 9.5 gRPC
- 9.6 REST
- 9.7 GraphQL
- 9.8 Idempotent Operations — HTTP method semantics (mechanics → §18.1)

## Compute & API

### 10. Application Layer
- 10.1 Microservices
- 10.2 Monolith vs Microservices
- 10.3 Service Discovery
- 10.4 API Composition
- 10.5 Stateless Design
- 10.6 Service Mesh (intro)

### 11. API Design at Scale
- 11.1 API Gateway *(canonical home for gateway patterns)* — routing, aggregation, offloading
- 11.2 REST Design at Scale
- 11.3 GraphQL Federation
- 11.4 gRPC & Streaming
- 11.5 Versioning & Deprecation
- 11.6 Pagination & Filtering
- 11.7 Idempotency & Retries — API request dedup (mechanics → §18.1)
- 11.8 Webhooks
- 11.9 Backends for Frontend (BFF)

## Data

### 12. Databases

**Data models / types** (each topic explains the model, trade-offs & representative engines — engine internals live in their own roadmaps: [Redis](../../Backend/redis/), [MongoDB](../../Backend/mongodb/), [PostgreSQL](../../Backend/postgresql-dba/), [Elasticsearch](../../Backend/elasticsearch/)):
- 12.1 Relational (RDBMS) — PostgreSQL, MySQL
- 12.2 Key-Value — Redis, DynamoDB, etcd
- 12.3 Document — MongoDB, Couchbase
- 12.4 Wide-Column — Cassandra, ScyllaDB, HBase, Bigtable
- 12.5 Column-Oriented (OLAP) — ClickHouse, Druid, Pinot
- 12.6 Graph — Neo4j, JanusGraph
- 12.7 Time-Series — InfluxDB, TimescaleDB, Prometheus
- 12.8 Search Engine — Elasticsearch, OpenSearch, Solr
- 12.9 Vector — pgvector, Milvus, Pinecone, Weaviate
- 12.10 NewSQL / Distributed SQL — CockroachDB, Spanner, Vitess, TiDB

**Cross-cutting concepts:**
- 12.11 Replication
- 12.12 Sharding & Partitioning
- 12.13 Indexing
- 12.14 Transactions & Isolation
- 12.15 Denormalization
- 12.16 SQL Tuning
- 12.17 SQL vs NoSQL
- 12.18 OLTP vs OLAP
- 12.19 Polyglot Persistence
- 12.20 Choosing a Database — decision framework
- 12.21 Connection Pooling — PgBouncer, ProxySQL, pool sizing, transaction vs session pooling

### 13. Storage Systems
*Low-level storage only — database data models live in §12.*
- 13.1 Object vs Block vs File
- 13.2 Distributed File Systems — GFS, HDFS
- 13.3 Blob Storage — S3-like
- 13.4 LSM-Trees vs B-Trees — RocksDB, LevelDB
- 13.5 Data Warehouse vs Data Lake
- 13.6 File Formats — Parquet, ORC, Iceberg
- 13.7 Erasure Coding & Durability — Reed-Solomon, replication vs parity

### 14. Caching
- 14.1 Cache-Aside
- 14.2 Write-Through
- 14.3 Write-Behind
- 14.4 Refresh-Ahead
- 14.5 Eviction Policies
- 14.6 Types of Caching — client, CDN, web, DB, application
- 14.7 Cache Invalidation
- 14.8 Cache Stampede & Hot Keys

### 15. Data Streaming & Big Data
- 15.1 Batch Processing — MapReduce
- 15.2 Apache Spark
- 15.3 Stream Processing
- 15.4 Apache Kafka
- 15.5 Lambda vs Kappa Architecture
- 15.6 Data Lake & Warehouse
- 15.7 Change Data Capture
- 15.8 ETL vs ELT
- 15.9 Apache Flink — stateful stream processing, event time, watermarks, checkpointing
- 15.10 Apache Pulsar — segmented storage, multi-tenancy, tiered storage
- 15.11 Trino / Presto — distributed SQL query engine over lakes/federated sources
- 15.12 Workflow Orchestration — Airflow, Dagster, DAG scheduling for data pipelines

## Async & Coordination

### 16. Asynchronism
- 16.1 Message Queues
- 16.2 Task Queues
- 16.3 Back Pressure
- 16.4 Dead-Letter Queues
- 16.5 Delivery Guarantees
- 16.6 RabbitMQ — AMQP broker, exchanges, routing
- 16.7 NATS — lightweight pub/sub, JetStream

### 17. Background Jobs
- 17.1 Event-Driven
- 17.2 Schedule-Driven
- 17.3 Returning Results
- 17.4 Retries & Idempotency — job re-runs (mechanics → §18.1)
- 17.5 Durable Execution — Temporal, workflow-as-code, long-running sagas, replay

### 18. Concurrency & Coordination
- 18.1 Idempotency Keys *(canonical: idempotency & exactly-once mechanics — referenced by §9.8 HTTP, §11.7 API, §17.4 jobs)*
- 18.2 Leases & Fencing
- 18.3 Exactly-Once Semantics
- 18.4 Optimistic vs Pessimistic Locking
- 18.5 Coordination Services — ZooKeeper, etcd, Consul

## Building Blocks

### 19. Building Blocks

> **Use vs Build:** §19 is the canonical home for *building* each component from scratch. Other sections use them as ready components and link here — no algorithm is re-taught: message queue (use §16.1 ↔ build §19.6), blob store (use §13.3 ↔ build §19.8), search/typeahead (type §12.8 ↔ build §19.9), pub-sub (pattern §21.13 ↔ build §19.7), distributed lock (concept §18.4 ↔ build §19.11).

- 19.1 Rate Limiter *(canonical home)* — token bucket, leaky bucket, fixed window, sliding-window log/counter, distributed rate limiting
- 19.2 Consistent Hashing — hash ring, virtual nodes
- 19.3 Unique ID Generator — UUID, Snowflake, ticket server
- 19.4 Distributed Key-Value Store — quorum, vector clocks
- 19.5 Distributed Cache — sharding, eviction, hot keys
- 19.6 Distributed Message Queue — delivery, ordering, DLQ
- 19.7 Pub-Sub System — topics, fan-out, retention
- 19.8 Blob / Object Store — chunking, metadata, lifecycle
- 19.9 Distributed Search / Typeahead — inverted index, trie
- 19.10 Distributed Task Scheduler — cron at scale, leasing
- 19.11 Distributed Lock — fencing tokens, Redlock
- 19.12 Distributed Logging — ingestion, indexing, sampling
- 19.13 Sharded Counters / Leaderboard — write contention

## Reliability & Operations

### 20. Reliability Patterns
- 20.1 Circuit Breaker
- 20.2 Bulkhead
- 20.3 Retry
- 20.4 Throttling — server-side load shedding angle (algorithms → §19.1; see also §40.6 Load Shedding)
- 20.5 Health Endpoint Monitoring
- 20.6 Leader Election
- 20.7 Compensating Transaction
- 20.8 Deployment Stamps & Geodes
- 20.9 Queue-Based Load Leveling

### 21. Cloud Design Patterns
- 21.1 Strangler Fig — pattern definition (org-scale application → §36.2)
- 21.2 Sidecar
- 21.3 Ambassador
- 21.4 Anti-Corruption Layer
- 21.5 CQRS
- 21.6 Event Sourcing
- 21.7 Materialized View
- 21.8 Pipes and Filters
- 21.9 External Config Store
- 21.10 Valet Key
- 21.11 Claim Check
- 21.12 Competing Consumers
- 21.13 Publisher/Subscriber — pattern (build a pub-sub system → §19.7)

> Gateway routing/aggregation/offloading moved into §11.1; Backends-for-Frontend lives in §11.9.

### 22. Performance Antipatterns
- 22.1 Busy Database
- 22.2 Busy Frontend
- 22.3 Chatty I/O
- 22.4 Extraneous Fetching
- 22.5 Improper Instantiation
- 22.6 Monolithic Persistence
- 22.7 Noisy Neighbor
- 22.8 Synchronous I/O
- 22.9 Retry Storm
- 22.10 No Caching

### 23. Monitoring
- 23.1 Health Monitoring
- 23.2 Availability Monitoring
- 23.3 Performance Monitoring
- 23.4 Security Monitoring
- 23.5 Usage Monitoring
- 23.6 Instrumentation
- 23.7 Visualization & Alerts

### 24. Observability
- 24.1 Logs, Metrics, Traces
- 24.2 SLO / SLI / Error Budgets
- 24.3 RED & USE Methods
- 24.4 Distributed Tracing
- 24.5 Metrics Pipelines
- 24.6 Log Aggregation
- 24.7 Alerting & On-Call
- 24.8 OpenTelemetry — unified traces/metrics/logs, collector, semantic conventions, instrumentation

### 25. Chaos Engineering
- 25.1 Failure Modes
- 25.2 Fault Injection
- 25.3 Game Days
- 25.4 Resilience Testing
- 25.5 Blast Radius & Recovery

### 26. Deployment & Infrastructure
- 26.1 Containers & Docker
- 26.2 Kubernetes Orchestration
- 26.3 Deployment Strategies — blue-green, canary, rolling
- 26.4 CI/CD Pipelines
- 26.5 Infrastructure as Code
- 26.6 Multi-Region Deployment
- 26.7 Disaster Recovery
- 26.8 Autoscaling
- 26.9 Cloud Network Architecture — VPC, subnets, security groups, NAT gateway, peering, PrivateLink
- 26.10 GitOps — ArgoCD, Flux, declarative continuous delivery, drift detection

## Security & Governance

### 27. Security at Scale
- 27.1 Authentication
- 27.2 Authorization — RBAC, ABAC
- 27.3 OAuth2 & OIDC
- 27.4 JWT & Tokens
- 27.5 Encryption at Rest & in Transit
- 27.6 Secrets Management
- 27.7 DDoS Mitigation
- 27.8 WAF & API Security
- 27.9 Rate Limiting for Abuse — bot / DDoS / login-abuse angle (algorithms → §19.1)
- 27.10 DevSecOps & Supply-Chain Security — shift-left, SAST/DAST in CI, container scanning, SBOM, dependency/supply-chain

### 28. Data Privacy & Compliance
- 28.1 PII & Data Classification
- 28.2 GDPR & Right to Be Forgotten
- 28.3 Data Residency
- 28.4 Audit Logging
- 28.5 Encryption Key Lifecycle

### 29. Multi-Tenancy & SaaS
- 29.1 Tenant Isolation Models
- 29.2 Data Partitioning per Tenant
- 29.3 Noisy-Neighbor Mitigation
- 29.4 Per-Tenant Scaling & Limits
- 29.5 Tenant Onboarding & Config

## Specialized

### 30. Geospatial Systems
- 30.1 Geohashing
- 30.2 Quadtrees
- 30.3 S2 & H3
- 30.4 Proximity Search
- 30.5 Map Tiling & Routing

### 31. ML, Recommendation & GenAI Systems
- 31.1 Recommendation Architecture
- 31.2 Feature Store
- 31.3 Candidate Generation
- 31.4 Ranking & Scoring
- 31.5 Online vs Offline Inference
- 31.6 A/B Testing & Feedback Loops
- 31.7 LLM Inference & Serving — batching, KV cache, GPU, token streaming
- 31.8 Retrieval-Augmented Generation (RAG) — embeddings, vector search, grounding
- 31.9 LLM Application Architecture — prompt orchestration, guardrails, evaluation
- 31.10 AI Agents & Orchestration — tool use, planning, multi-agent

## Capstone

### 32. Classic Problems
URL shortener · Twitter/news-feed timeline · WhatsApp/chat · YouTube/Netflix video · Uber dispatch · Dropbox/Drive sync · Instagram feed · Stack Overflow · ad click counter · payment system · digital wallet · hotel reservation · Gmail/email service · web crawler & search engine · recommendation engine · key-value store · Google Docs collab editor · proximity/Maps · Ticketmaster booking · notification system · live streaming · distributed job scheduler · stock exchange · S3 object storage · online judge · distributed analytics counter

### 33. Real-World Architectures
Google Spanner · Facebook TAO · Amazon DynamoDB · Netflix stack · Apache Kafka · Apache Cassandra · Redis internals · Discord realtime · Slack messaging · Uber/Lyft dispatch

### 34. Interview Playbook
- 34.1 RESHADED Framework
- 34.2 Requirements Clarification
- 34.3 Capacity Estimation in the Interview
- 34.4 API Design Step
- 34.5 High-Level Design
- 34.6 Data Model & Storage Choice
- 34.7 Deep Dives & Bottlenecks
- 34.8 Trade-offs & Wrap-up
- 34.9 Common Mistakes
- 34.10 Mock Interview Walkthroughs

## Staff / Principal

> Beyond building systems — org-scale judgment, evolution over time, cost, and sociotechnical design. Each topic can carry a 5th `staff.md` tier above `professional.md`.

### 35. Architecture Decision-Making
- 35.1 Architecture Decision Records (ADRs)
- 35.2 RFC Process
- 35.3 Evolutionary Architecture
- 35.4 Fitness Functions
- 35.5 Tech Radar
- 35.6 Build vs Buy
- 35.7 Trade-off Analysis Frameworks

### 36. Large-Scale Migrations
- 36.1 Monolith to Microservices
- 36.2 Strangler Fig at Scale
- 36.3 Zero-Downtime Migration
- 36.4 Expand-Contract Pattern
- 36.5 Dual-Write & Backfill
- 36.6 Data Migration at Scale
- 36.7 Deprecation Strategy

### 37. Sociotechnical & Org Design
- 37.1 Conway's Law
- 37.2 Team Topologies
- 37.3 Platform Engineering / IDP
- 37.4 Ownership & Boundaries
- 37.5 Cognitive Load

### 38. Cost & Efficiency (FinOps)
- 38.1 Cost Modeling
- 38.2 Capacity Planning
- 38.3 Efficiency as a Feature
- 38.4 Hardware-Aware Design
- 38.5 Performance Economics

### 39. Global / Multi-Region Architecture
- 39.1 Active-Active Architecture
- 39.2 Data Sovereignty & Residency
- 39.3 Geo-Routing
- 39.4 Global Consistency
- 39.5 Conflict Resolution
- 39.6 Follow-the-Sun

### 40. SRE & Reliability Engineering
- 40.1 Error Budgets
- 40.2 SLO Ownership
- 40.3 Incident Management
- 40.4 Postmortems
- 40.5 Toil Reduction
- 40.6 Load Shedding
- 40.7 Graceful Degradation

### 41. Performance Engineering & Tail Latency
- 41.1 Tail Latency — p99 / p999
- 41.2 Coordinated Omission
- 41.3 Hedged Requests
- 41.4 Backpressure (deep)
- 41.5 Queueing Theory — Little's Law
- 41.6 Universal Scalability Law
- 41.7 Amdahl's Law

### 42. Data Governance & Contracts
- 42.1 Schema Registry
- 42.2 Data Contracts
- 42.3 Data Lineage
- 42.4 Data Quality
- 42.5 Master Data Management
- 42.6 Privacy by Design

## Domain Deep-Dives

### 43. Payments & Fintech
*Payment domain building-blocks — the "design a payment system / digital wallet" problems live in §32; this section is the underlying money-movement knowledge.*
- 43.1 Payments Ecosystem & Rails — issuer, acquirer, network, PSP; how Visa/Mastercard clear & settle
- 43.2 Card Payments & Networks — authorization/capture/settlement, swipe/tap flow
- 43.3 Bank Transfers — ACH & Wire
- 43.4 Digital Wallets & Mobile Pay — Apple/Google Pay, scan-to-pay, QR
- 43.5 Real-Time Payments — UPI (India), FPS, instant rails
- 43.6 Ledgers & Double-Entry Accounting — money movement, balance integrity
- 43.7 Reconciliation — matching internal ledger vs external statements
- 43.8 Idempotency & Exactly-Once Payments — avoiding double charges
- 43.9 Hotspot Accounts & Contention — hot-account write contention
- 43.10 Cross-Border & FX — SWIFT, multi-currency, foreign exchange
- 43.11 Fraud, Risk & PCI Compliance — fraud detection, PCI-DSS
