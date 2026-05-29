# Floyd's Cycle Detection -- Senior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Production Use Cases](#production-use-cases)
   - [Workflow Engine Loop Detection](#workflow-engine-loop-detection)
   - [Distributed Task Graph Validation](#distributed-task-graph-validation)
   - [Garbage Collector Cycle Detection with Hazard Pointers](#garbage-collector-cycle-detection-with-hazard-pointers)
   - [Replication-Lag Stall Detection](#replication-lag-stall-detection)
   - [PRNG Period Diagnostics in Production](#prng-period-diagnostics-in-production)
3. [Concurrent Floyd's -- Where It Breaks](#concurrent-floyds----where-it-breaks)
4. [Distributed Cycle Detection](#distributed-cycle-detection)
5. [Observability of the Tortoise-Hare Pipeline](#observability-of-the-tortoise-hare-pipeline)
6. [Adversarial Inputs](#adversarial-inputs)
7. [Architecture Patterns](#architecture-patterns)
8. [Capacity Planning](#capacity-planning)
9. [Comparison with Alternatives](#comparison-with-alternatives)
10. [Failure Modes](#failure-modes)
11. [Summary](#summary)

---

## Introduction

> Focus: "Where does Floyd's cycle detection show up in real production systems, and how does it degrade?"

At senior level, Floyd's algorithm stops being a linked-list trick and starts being a load-bearing primitive inside workflow engines, garbage collectors, replication monitors, and number-theoretic libraries. The interesting questions change shape:

- What inputs make the technique degrade in practice (latency tails, false negatives)?
- How do you observe a tortoise-hare scan at runtime so you can detect adversarial workloads?
- When does the single-pointer-pair assumption break and you need a distributed variant?
- How do you reconcile the read-only invariant with concurrent mutation of the graph?

The single biggest senior-level realization is that Floyd's was designed for a static, sequentially-walkable, single-threaded sequence. Every real-world deployment violates at least one of those assumptions, and the engineering work is in restoring them or weakening the algorithm to tolerate the violation.

---

## Production Use Cases

### Workflow Engine Loop Detection

Workflow engines (Airflow, Temporal, Argo, Cadence) define DAGs of tasks. A misauthored workflow can introduce a cycle -- task A depends on B which depends on A -- and the scheduler must detect this before execution starts or it will spin forever.

The naive solution is full topological sort. For workflows with millions of edges (think a fan-out template applied per tenant), the constant factor of Kahn's algorithm dominates startup. A Floyd-style probe per "suspicious" task -- triggered only when an edge addition closes a back-edge candidate -- is O(1) memory per probe and runs in time proportional to the cycle length, not the whole graph.

In Temporal's child-workflow handling, the relevant primitive is "does the call chain `parent -> child -> child -> ...` ever loop back?" The chain is walked lazily by the scheduler. Floyd's on `f(node) = node.parent_workflow_id` detects the loop in O(chain depth) memory-free, even when the chain itself is paginated across multiple DB queries.

The senior point: Floyd's is the right tool when **the graph is too large to materialize** but each node has a deterministic single successor (a function, not a multi-edge relation). DAG cycle detection on arbitrary multi-edge graphs needs DFS-with-coloring; Floyd's only handles the iterated-function shape.

### Distributed Task Graph Validation

Spark, Flink, and other distributed schedulers build a task DAG per job. The DAG is constructed by transforming user code through a series of optimizer passes. Each pass can theoretically introduce a cycle (a rewrite rule that creates a back edge), so post-pass validation is required.

Production schedulers split this across two strategies:

1. **Hash-set traversal** for the optimizer output -- runs once, allocates O(n) but n is bounded by the optimizer's node budget (~10^5).
2. **Floyd's probe on suspicious paths** -- triggered when a specific rewrite rule is known to risk a cycle (e.g. "join reordering with self-references"). The probe walks O(cycle-length) and avoids the full sweep.

Spark's Catalyst optimizer uses the first strategy throughout. The Floyd-style probe shows up in custom planners written on top of Spark -- companies adding domain-specific rewrite rules use it as a cheap guard.

### Garbage Collector Cycle Detection with Hazard Pointers

Reference-counting garbage collectors (CPython, Objective-C with weak refs, Swift) cannot collect cycles natively because every node in a cycle has refcount >= 1 from another node in the cycle. CPython solves this with a periodic cycle collector that walks the heap.

A senior-level alternative is **Floyd's-on-roots**: starting from a candidate root, walk the reference graph treating each node as a function `f(node) = node.next_reference_for_inspection`. If Floyd's reports a cycle, the candidate is part of a cyclic garbage set; if it reports none, the candidate's transitive closure is acyclic and standard refcounting suffices.

The hazard-pointer angle: in a concurrent GC, the tortoise and hare each maintain a **hazard pointer** on their current node so the mutator cannot free the node out from under them. Two hazard pointers per probe, O(1) memory.

Production note: full GC implementations do not use raw Floyd's because they need the entire cyclic set, not just one node from it. Floyd's is used as a fast pre-check: "is there any cycle at all reachable from this root?" If the answer is no, skip the expensive trace.

### Replication-Lag Stall Detection

Replication monitors watch the slave's apply-position relative to the master's commit-position. A stall manifests as the slave's position oscillating between a small set of values without making forward progress -- effectively, the apply pointer entered a cycle in (state, log_offset) space.

The detection algorithm:

```text
f(state) = next_state_after_one_apply_attempt
```

Floyd's on `f` detects whether the slave is in a productive forward walk or trapped in a cycle (e.g. constraint violations that keep rolling back the same transaction batch).

PostgreSQL's logical replication monitor uses a coarser variant: it tracks log-position deltas and alerts when the delta is zero for K consecutive intervals. The Floyd-style refinement -- "the slave is making local-state moves but the position is cycling" -- catches deadlock-with-retry stalls that the coarse delta misses.

### PRNG Period Diagnostics in Production

Cryptographic and statistical PRNGs have a period (the sequence repeats eventually). A well-designed generator has period 2^128 or more, but **misseeded** or **truncated** generators can have surprisingly short periods. Floyd's algorithm on `f(x) = next_state(x)` measures the actual period in O(period) time and O(1) memory.

Production usage: at deployment time, a smoke test runs Floyd's against the configured RNG with a budget of 10^9 iterations. If a cycle is detected within the budget, the deploy is blocked -- the generator's effective period is dangerously short.

This is used in slot machines, lottery systems, and online casinos where regulators mandate period verification. Brent's algorithm is preferred in these tests because of its slightly lower constant factor, but Floyd's is acceptable and easier to audit.

---

## Concurrent Floyd's -- Where It Breaks

The tortoise-hare invariant requires both pointers to walk a **fixed** sequence. If the graph mutates between iterations, the algorithm can:

| Mutation | Effect on Floyd's |
|----------|-------------------|
| Node insertion after tortoise, before hare | Hare walks new path; tortoise walks old path; they may never meet |
| Node deletion in cycle | Cycle shrinks; tortoise may enter cycle late and miss the meeting |
| Edge redirection inside cycle | Cycle becomes acyclic mid-scan; algorithm reports "no cycle" wrongly |
| Concurrent append (no cycle creation) | Safe -- tortoise sees the new tail; hare may overshoot but still reaches null |

Three production patterns to make Floyd's tolerant of concurrent mutation:

1. **Snapshot isolation.** Take a logical snapshot of the linked structure (epoch-based reclamation, COW pointers, or a frozen version number). Run Floyd's on the snapshot. Used by Java's `ConcurrentHashMap` traversal-on-snapshot.

2. **Hazard-pointer Floyd's.** Maintain two hazard pointers (tortoise and hare). The mutator checks hazard pointers before freeing a node. The scan is allowed to see logically-deleted-but-not-freed nodes. Used in lock-free linked list implementations.

3. **Bounded-retry Floyd's.** Run Floyd's; if it reports no cycle but the structure was modified during the scan (detected via a version counter), restart up to K times. Eventually consistent: under steady-state mutation pressure the scan may never complete; tune K to the actual mutation rate.

In practice, the snapshot approach is the most common. Hazard pointers add ~30% overhead per pointer dereference and are reserved for ultra-hot paths.

---

## Distributed Cycle Detection

When the graph is sharded across N machines, Floyd's-on-a-single-thread does not work because the tortoise and hare cannot physically be in two places at once.

The standard distributed variants:

### Distributed Floyd's via Message-Passing

Each node sends a **token** representing the tortoise that walks one edge per round. Each node also sends a hare token that walks two edges per round (one immediate, one round-trip). When a node receives both tokens with matching origin IDs, a cycle is detected.

```text
Token format: { origin, round, role: tortoise|hare }
At each node n on receiving token t:
  if role == hare and n == origin and round > 0:
    -> hare has lapped; cycle through n
  forward t to next(n)
```

This is implementable on top of any RPC mesh. The latency is O(rounds * inter-node-RPC), not O(n) wall-clock, so it is much slower than a single-machine Floyd's. Used in distributed workflow validators when the workflow's task graph spans data centers.

### Snapshot-Based Distributed Detection

A coordinator takes a global snapshot of the graph (Chandy-Lamport style for active graphs; just-read for passive graphs) and ships partitions to a single machine that runs vanilla Floyd's. Simpler to implement; trades memory at the coordinator for correctness.

For graphs that fit on one machine after compression (most workflow DAGs do), this is the preferred approach.

### Probabilistic Cycle Detection at Scale

For very large graphs (web-scale, knowledge graphs), exact cycle detection is impractical. Use **HyperLogLog cardinality estimates** along the tortoise-hare paths: if the union of visited nodes by the two pointers grows more slowly than the union of fresh visits, a cycle is likely. False positive rate is ~2%; sufficient for "alert and investigate" pipelines.

---

## Observability of the Tortoise-Hare Pipeline

Floyd's emits little signal under normal operation -- it walks a sequence and returns true or false. Production observability targets the **edge cases**:

| Metric | What it tells you | Alert threshold |
|--------|-------------------|-----------------|
| `floyd.iterations` | Steps until detection or termination | > expected upper bound |
| `floyd.detected` | Cycle found (boolean / counter) | Spike == new class of bug |
| `floyd.tail_length_mu` | mu measured in phase 2 | Outlier vs distribution |
| `floyd.cycle_length_lambda` | lambda measured in phase 3 | Sudden drop (cycle shrunk) |
| `floyd.restart_count` | Concurrent restarts in bounded-retry variant | > 3 means mutation rate too high |
| `floyd.scan_latency_p99` | Wall-clock per scan | Tracks cache/IO regressions |

The two most diagnostic metrics:

- **iterations** -- a Floyd's scan that did not detect a cycle should hit the natural endpoint in mu + lambda steps. A scan that runs much longer than the historical p99 is either probing a pathologically deep chain or has been disturbed by concurrent mutation.
- **tail_length distribution** -- in a workflow engine, sudden growth in mu means user workflows are nesting deeper. Operationally interesting even when no cycle is detected.

For Pollard's-rho-style applications (PRNG period checks), the **cycle_length_lambda** distribution across runs is the headline metric: regulators in regulated industries (gaming, finance) require an audit log of measured periods.

### Example: structured logging in Go

```go
type Scan struct {
    Iterations  int
    Detected    bool
    Mu, Lambda  int
    Restarts    int
    Latency     time.Duration
}

func (s *Scan) Emit(m MetricsClient, tag string) {
    m.Counter(tag+".scans").Inc()
    m.Histogram(tag+".iterations").Observe(float64(s.Iterations))
    m.Histogram(tag+".latency_us").Observe(float64(s.Latency.Microseconds()))
    if s.Detected {
        m.Counter(tag+".detected").Inc()
        m.Histogram(tag+".mu").Observe(float64(s.Mu))
        m.Histogram(tag+".lambda").Observe(float64(s.Lambda))
    }
    if s.Restarts > 0 {
        m.Histogram(tag+".restarts").Observe(float64(s.Restarts))
    }
}
```

The same shape in Java uses Micrometer; in Python use `prometheus_client`. The key is to emit `mu` and `lambda` as histograms, not gauges -- the cardinality matters across many scans.

---

## Adversarial Inputs

Floyd's is robust to nearly all inputs, but three shapes are pathological in practice:

| Input | Effect | Mitigation |
|-------|--------|-----------|
| Very long tail (mu) with tiny cycle (lambda = 1) | Phase 2 walks mu steps -- can dominate wall-clock | Acceptable; the algorithm cannot do better with O(1) space |
| Linked list of length 10^9 with no cycle | Algorithm walks the full list | Set an iteration cap and abort to a "likely no cycle" verdict |
| Concurrent mutation creating cycles repeatedly | Detection succeeds on transient cycles that disappear | Snapshot first; do not run on a live structure |

Note: there is **no input that breaks correctness** -- only inputs that breaks latency. This is unlike the monotonic stack, where strictly monotone input degrades to O(n) memory. Floyd's stays O(1) space on any input. The latency degradation is purely walk-time.

A subtle case: **non-deterministic `f`**. If the function `f(x) = next_state` depends on something outside the iteration (a wall clock, a random salt, a global counter), the tortoise and hare will compute different sequences and may never meet. This is not adversarial input so much as algorithm misuse -- always verify `f` is pure before applying Floyd's.

---

## Architecture Patterns

In a service-oriented architecture, Floyd's lives inside one of four pipeline shapes:

**Request-scoped probe.** A single request handler walks a chain (parent workflow, dependency chain, retry escalation chain) and applies Floyd's inline. Lifetime is microseconds. The only operational concern is bounding the iteration count so a degenerate chain does not exceed the request budget.

**Pre-commit validator.** A control-plane operation (DAG creation, schema migration, policy deployment) runs Floyd's as a gate. The operation is rejected if a cycle is detected. The trade-off here is latency-vs-strength: full DFS-with-coloring is stronger (detects all cycle types) but slower; Floyd's-on-suspicious-edge is faster but only handles iterated-function shapes.

**Background diagnostic.** A cron-style sweeper runs Floyd's against critical data structures (replication state, GC roots, distributed locks) and alerts on detection. Catches drift that the inline probes miss because the cycle was created across multiple events.

**Periodic deep-scan.** Once per day, a comprehensive scan walks the entire graph applying Floyd's at every candidate root. Reserved for audit-grade systems (compliance, financial reporting). Designed to be slow and thorough.

The choice between these shapes is driven by the cost of a missed cycle. Workflow engines use shape 2 (pre-commit) because executing a cyclic workflow is catastrophic. Replication monitors use shape 3 (background) because false negatives are recoverable on the next scan.

---

## Capacity Planning

Floyd's is cheap in memory by design -- two pointers and a couple of integers, ~32 bytes per probe regardless of input size. The capacity question is CPU and IO, not memory.

For request-scoped probes:

| Workload | Expected iterations | Latency budget on cold cache |
|----------|---------------------|------------------------------|
| Workflow chain validation | < 1000 | <1 ms |
| Reference-counting GC pre-check | < 10^4 | <10 ms |
| PRNG period verification | up to 10^9 | minutes (offline only) |
| Distributed cycle (RPC-paced) | bounded by graph diameter | seconds |

For PRNG diagnostics specifically, the algorithm is iteration-bound: walking 10^9 steps at ~10 ns per step is 10 seconds wall-clock. This is acceptable for a deploy gate but not for a request handler.

Capacity for background diagnostics is set by **frequency * graph size**. A daily Floyd's sweep over a graph of 10^7 nodes touches each twice per day -- 2 * 10^7 reads/day, ~230 reads/sec average, negligible.

The hidden capacity cost is **cache pollution**. A Floyd's scan over 10^7 cold pointers reads 80 MB of pointer data, evicting hot working sets from the L3. Schedule the scan during low-traffic windows or pin it to a dedicated core if the host serves real-time traffic.

---

## Comparison with Alternatives

For "is there a cycle in this iterated-function sequence?" Floyd's competes with:

| Approach | Time | Space | When better |
|----------|------|-------|-------------|
| Floyd's (tortoise-hare) | O(mu + lambda) | O(1) | Memory tight; read-only; single thread |
| Hash set | O(mu + lambda) | O(mu + lambda) | Memory cheap; need set of cycle nodes |
| Brent's algorithm | O(mu + lambda), ~36% fewer f-calls | O(1) | Hot loops where every f-call costs (Pollard's rho) |
| DFS with colors | O(V + E) | O(V) | Arbitrary multi-edge graph, not iterated function |
| Tarjan SCC | O(V + E) | O(V) | Need all strongly connected components, not just cycle yes/no |
| Distributed token passing | O(graph diameter * RPC) | O(1) per node | Sharded across machines |
| Probabilistic (HyperLogLog) | O(n) approximate | O(log log n) | Web-scale, false-positive tolerable |

Floyd's wins on the specific "iterated function on memory-resident data" question where the answer is yes/no and memory is the constraint. Switch to a hash set when you need the set of cycle nodes; switch to DFS-with-coloring when the graph is not a function (multiple out-edges); switch to Tarjan when you need all SCCs.

The Brent vs Floyd comparison is interesting: they are asymptotically equal but Brent's constant factor is lower. The pragmatic answer is **Brent's for tight loops (Pollard's rho), Floyd's everywhere else** because Floyd's is simpler to read in code review.

---

## Failure Modes

| Failure mode | Symptom | Fix |
|--------------|---------|-----|
| Concurrent mutation during scan | False positives or false negatives intermittently | Snapshot first; or bounded-retry with version counter |
| Non-deterministic `f` | Algorithm hangs or returns wrong answer | Audit `f`; ensure no hidden state |
| Hare overshoot on near-end-of-list cycle | Crash on null pointer access | Check both `fast != nil` and `fast.Next != nil` before each step |
| Cycle created and destroyed mid-scan | Detection unstable; flapping alerts | Aggregate K consecutive scans; alert on persistent detection |
| Pollard's rho returns trivial factor (n itself) | Bad starting value or unlucky c | Retry with different c; fall back to a different factorization method |
| Scan budget exhausted before cycle found | Inconclusive verdict | Surface "unknown" instead of "no cycle"; log iteration count for tuning |
| Distributed token loss | Cycle goes undetected | Add per-token TTL and retry; coordinate via reliable channel |
| GC pre-check too aggressive | Refcounting GC starves under load | Throttle probe frequency by heap-pressure metric |
| Hot loop on PRNG period scan | CPU saturation on production node | Move to dedicated host or offline batch |

For latency-critical paths the most common failure mode is **scan budget exhausted before termination**. Surface "unknown" as a distinct outcome from "no cycle." A monitor that aggregates over many request scans can then alert when the "unknown" rate exceeds a threshold without being deceived by every long-but-acyclic chain.

---

## Summary

At senior level Floyd's is a **production primitive** -- a memory-free probe that drops into workflow validators, GC pre-checks, replication monitors, and PRNG audits. The senior responsibilities are: pick the right pipeline shape (request-scoped vs background vs deep-scan); observe iteration counts, mu, and lambda as histograms; handle concurrent mutation via snapshot or hazard pointers; and recognize when the iterated-function assumption fails and a heavier algorithm (DFS, Tarjan) is required.

The algorithm itself is small enough to fit on a napkin. The senior-level work is around it: instrumentation, snapshot semantics, distributed coordination, and capacity planning. Recognizing where Floyd's fits in a system architecture -- often as a fast pre-check before an expensive deep operation -- is the senior skill the rest of this document was about.
