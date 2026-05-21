# Backend Performance Best Practices

- Roadmap: https://roadmap.sh/best-practices/backend-performance

## 1. Architecture and Design
- 1.1 Architectural Styles (monolith, microservices, modular monolith)
- 1.2 Scaling Strategies (vertical, horizontal, sharding)
- 1.3 Use DB Sharding for Massive Scale
- 1.4 Critical Paths Identification

## 2. Caching
- 2.1 Caching Locations (client, CDN, app, DB)
- 2.2 Caching Strategies (cache-aside, write-through, write-behind)
- 2.3 Cache Invalidation
- 2.4 Utilize Caching Layers
- 2.5 CDNs

## 3. Database Performance
- 3.1 DB Indexes (correct columns, composite, covering)
- 3.2 Avoid `SELECT *`
- 3.3 Join Operations (when to denormalize)
- 3.4 Denormalize for Read-Heavy Workloads
- 3.5 ORM Queries (N+1, lazy vs eager)
- 3.6 Lazy vs Eager Loading
- 3.7 Implement Pagination
- 3.8 Pagination for Large Datasets (cursor-based)
- 3.9 Replication (read replicas)
- 3.10 Cleanup Old Data (TTL, archiving)
- 3.11 Slow Query Logging

## 4. Connections and Network
- 4.1 Connection Pooling
- 4.2 Connection Pool Settings (min/max, timeouts)
- 4.3 Connection Timeouts
- 4.4 Keep-Alive
- 4.5 Network Latency Awareness

## 5. Concurrency and Async
- 5.1 Async Logging
- 5.2 Offload Heavy Work (background jobs)
- 5.3 Message Brokers (Kafka, RabbitMQ, SQS)
- 5.4 Request Throttling
- 5.5 Streaming for Large Responses

## 6. Payload and Transport
- 6.1 Enable Compression (gzip, brotli)
- 6.2 Reasonable Payload Size
- 6.3 Prefetch / Preload Resources
- 6.4 Avoid Similar/Duplicate Requests

## 7. Compute Efficiency
- 7.1 Optimize Algorithms (Big-O awareness)
- 7.2 Avoid Unnecessary Computation
- 7.3 Compiled Languages for Hot Paths
- 7.4 Profile Code (find real bottlenecks)
- 7.5 Profiling Tools

## 8. Security and Auth Impact
- 8.1 Authentication / Authorization (efficient, cached)

## 9. Monitoring and Continuous Improvement
- 9.1 Monitoring and Logging
- 9.2 Prometheus / Grafana
- 9.3 Performance Testing (load, stress, soak)
- 9.4 Regular Audits
- 9.5 Keep Software Up-to-Date
- 9.6 Load Balancing
