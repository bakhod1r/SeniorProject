# System Design — Junior Interview Question Bank

A complete, ordered junior-level question bank for system design interviews — **42
sections, ~15,800 lines**. Each section file follows the same shape: every question
lists what the interviewer is **probing**, a concrete **model answer** (with real
products and back-of-envelope math), and the likely **follow-up**. Every file ends
with a **Rapid-Fire Self-Check** and a `Next step:` link, so you can read straight
through as one path.

> **Level:** Junior (0–2 years). Goal: correct, concrete, honest answers — the
> vocabulary and core-component reasoning, not deep internals. Middle / Senior /
> Professional banks live alongside this folder.

Start here → [01 · Introduction](01-introduction.md)

---

## Foundations
- [01 · Introduction](01-introduction.md) — what system design is, how to approach it, FRs vs NFRs, key characteristics, numbers to know
- [02 · Trade-offs Framework](02-tradeoffs-framework.md) — CAP, PACELC, consistency vs availability
- [03 · Capacity Estimation](03-capacity-estimation.md) — QPS, storage, bandwidth, latency budgets
- [04 · Back-of-Envelope](04-back-of-envelope.md) — number tables, Fermi estimation

## Networking
- [05 · Networking & Protocols](05-networking-protocols.md) — OSI/TCP-IP, TCP vs UDP, TLS, HTTP/1-2-3, WebSockets, SSE
- [06 · Domain Name System](06-domain-name-system.md) — resolution flow, record types, TTL, GeoDNS, Anycast
- [07 · Content Delivery Networks](07-content-delivery-networks.md) — pull/push, invalidation, edge, security
- [08 · Load Balancers](08-load-balancers.md) — L4/L7, algorithms, health checks, GSLB

## Compute & API
- [09 · Communication](09-communication.md) — HTTP, RPC, gRPC, REST, GraphQL, idempotency
- [10 · Application Layer](10-application-layer.md) — microservices, discovery, stateless, service mesh
- [11 · API Design at Scale](11-api-design-at-scale.md) — gateway, federation, versioning, pagination, webhooks, BFF

## Data
- [12 · Databases](12-databases.md) — RDBMS, KV, document, wide-column, OLAP, graph, vector, NewSQL, replication, sharding
- [13 · Storage Systems](13-storage-systems.md) — object/block/file, GFS/HDFS, LSM vs B-tree, lake vs warehouse
- [14 · Caching](14-caching.md) — cache-aside, write-through/behind, eviction, invalidation, stampede
- [15 · Data Streaming & Big Data](15-data-streaming.md) — batch/stream, Kafka, Lambda vs Kappa, CDC, ETL/ELT

## Async & Coordination
- [16 · Asynchronism](16-asynchronism.md) — message/task queues, back pressure, DLQ, delivery guarantees
- [17 · Background Jobs](17-background-jobs.md) — event/schedule-driven, returning results, retries
- [18 · Concurrency & Coordination](18-concurrency-coordination.md) — idempotency keys, leases/fencing, locking, coordination services

## Building Blocks & Patterns
- [19 · Building Blocks](19-building-blocks.md) — rate limiter, consistent hashing, unique IDs, distributed lock/cache/queue, typeahead
- [20 · Reliability Patterns](20-reliability-patterns.md) — circuit breaker, bulkhead, retry, throttling, leader election
- [21 · Cloud Design Patterns](21-cloud-design-patterns.md) — strangler, sidecar, CQRS, event sourcing, claim check
- [22 · Performance Antipatterns](22-performance-antipatterns.md) — chatty I/O, busy DB, retry storm, no caching

## Reliability & Ops
- [23 · Monitoring](23-monitoring.md) — health/availability/performance, instrumentation, alerts
- [24 · Observability](24-observability.md) — logs/metrics/traces, SLO/SLI, RED/USE, distributed tracing
- [25 · Chaos Engineering](25-chaos-engineering.md) — failure modes, fault injection, game days, blast radius
- [26 · Deployment & Infrastructure](26-deployment-infrastructure.md) — Docker, Kubernetes, blue-green/canary, CI/CD, IaC, DR
- [27 · Security at Scale](27-security-at-scale.md) — authn/authz, OAuth2/OIDC, JWT, encryption, DDoS, WAF
- [28 · Data Privacy & Compliance](28-data-privacy-compliance.md) — PII, GDPR, residency, audit logging, key lifecycle

## Specialized
- [29 · Multi-Tenancy & SaaS](29-multi-tenancy-saas.md) — isolation models, per-tenant partitioning, noisy neighbor
- [30 · Geospatial Systems](30-geospatial-systems.md) — geohashing, quadtrees, S2/H3, proximity search
- [31 · ML & Recommendation Systems](31-ml-recommendation-systems.md) — retrieve/rank funnel, feature store, online vs offline

## Capstone
- [32 · Classic Problems](32-classic-problems.md) — URL shortener, rate limiter, news feed, chat, typeahead, crawler
- [33 · Real-World Architectures](33-real-architectures.md) — Kafka, Cassandra, Redis, Spanner, S3, DynamoDB
- [34 · Interview Playbook](34-interview-playbook.md) — RESHADED, requirements, estimation, deep dives, wrap-up

## Staff-Track Awareness
- [35 · Architecture Decision-Making](35-architecture-decision-making.md) — ADRs, RFCs, fitness functions, build vs buy
- [36 · Large-Scale Migrations](36-large-scale-migrations.md) — strangler fig, zero-downtime, expand-contract, dual-write
- [37 · Sociotechnical & Org Design](37-sociotechnical-org-design.md) — Conway's Law, Team Topologies, cognitive load
- [38 · Cost & Efficiency (FinOps)](38-cost-efficiency-finops.md) — cost modeling, capacity planning, performance economics
- [39 · Global / Multi-Region](39-global-multi-region.md) — active-active, residency, geo-routing, conflict resolution
- [40 · SRE & Reliability Engineering](40-sre-reliability-engineering.md) — error budgets, incident mgmt, postmortems, load shedding
- [41 · Performance Engineering & Tail Latency](41-performance-engineering.md) — p99/p999, hedged requests, Little's Law, Amdahl
- [42 · Data Governance & Contracts](42-data-governance-contracts.md) — schema registry, data contracts, lineage, MDM

---

*Part of the [System Design](../README.md) interview collection.*
