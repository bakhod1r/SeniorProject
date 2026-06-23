# N+1 in Code — Interview Questions

> **Category:** [Performance Anti-Patterns](../README.md) → **N+1 in Code** — *per-item work in a loop that should have been done once.*

---

This is a question bank for interviews — as the interviewee (preparing) and the interviewer (probing depth). Questions run from junior recognition to staff-level judgment on batch limits, fan-out, and backpressure. Each has a model answer. The strongest answers reason with the **latency math** (`n × cost`), distinguish **batch vs preload vs memoize vs fan-out**, and know **when N calls are fine**.

> **How to use this file:** answer out loud *before* expanding. A surface answer says "use the batch endpoint." A strong answer counts the round-trips, picks the cure to the shape, and names the scale trade-off.

---

## Table of Contents

- [Fundamentals (1–10)](#fundamentals)
- [Detection & Fixing (11–20)](#detection--fixing)
- [Scale & Trade-offs (21–30)](#scale--trade-offs)
- [Hard / Staff-Level (31–36)](#hard--staff-level)

---

## Fundamentals

### 1. What is the N+1 anti-pattern, in one sentence?

<details><summary>Answer</summary>

A loop that does `N` units of expensive per-item work — a call, query, syscall, or recomputation — on top of the **1** operation that fetched the list, when the same result could be obtained in one (or a constant number of) operations.

</details>

### 2. In the name "N+1," what are the N and the 1?

<details><summary>Answer</summary>

The **1** is the initial operation that loads the collection (e.g., `getOrders()` → one query). The **N** is the extra operation done *once per item* inside the loop to enrich each element (e.g., `getUser(orderId)` → N queries). Total: `1 + N`.

</details>

### 3. Do the latency math: a loop makes one 20 ms remote call per item, sequentially, over 500 items. How long? After batching into one call?

<details><summary>Answer</summary>

Sequential round-trips: `500 × 20 ms = 10 seconds`. One batched call is a single round-trip plus a little server work — on the order of **tens of milliseconds** (say 30–60 ms). Roughly a 150–300× improvement, and the batched version barely grows as `n` increases.

</details>

### 4. Why is the famous "N+1" usually associated with databases/ORMs, and how is the *general* shape broader?

<details><summary>Answer</summary>

ORMs popularized it: fetch a list of rows (1 query), then lazily load a related row per item (N queries). That SQL-specific case is what the `database-performance` skill covers. But the **shape is general** — *any* repeated per-item expensive operation that should be done once: an RPC per item, a syscall (`stat`/`read`) per file, a cache `GET` per key, a recomputation per iteration, a linear scan per item. Same anti-pattern, different boundary.

</details>

### 5. Why do N+1 bugs typically pass tests and code review, then surface in production?

<details><summary>Answer</summary>

The cost is `n × latency`. Tests and local runs use *small* data (a few fixture rows), so `N` is tiny and the loop feels instant. The bug only hurts once `n` is large — which happens with real production data volume, not the handful of rows in tests.

</details>

### 6. What's the first reflex cure, and what does it do to the call count?

<details><summary>Answer</summary>

**Batch it**: collect the distinct keys, make one bulk call (`findByIds` / `WHERE id IN (...)` / `MGET`), then resolve each item against an in-memory map. Call count drops from `1 + N` to `2` (one for the list, one batched).

</details>

### 7. After batching, the per-item lookup still happens inside the loop. Why is that now fine?

<details><summary>Answer</summary>

Because the lookup is now a **map lookup in memory** (`O(1)`, nanoseconds), not a network round-trip (milliseconds). You moved the slow boundary *outside* the loop and crossed it once; what remains in the loop is cheap.

</details>

### 8. Name the four common shapes of N+1 and the cure for each.

<details><summary>Answer</summary>

1. **Remote call per item** → **bulk call** (de-dupe keys first). 2. **Query per item** → **preload into a map** (`IN (...)`, Identity Map by hand). 3. **Invariant recomputed each iteration** → **hoist** it out of the loop. 4. **Linear membership scan in loop (`n×m`)** → **build a set once** (`O(n+m)`).

</details>

### 9. Why batch vs why preload vs why memoize — when does each apply?

<details><summary>Answer</summary>

- **Batch**: there's a bulk endpoint/`IN (...)` — fetch all keys in one call. - **Preload**: same idea for queries — load the needed rows once and index by key before the loop (Identity Map). - **Memoize**: the per-item work is a *pure recomputation* with repeated inputs — cache results so the second occurrence of a key is free. Batch/preload remove round-trips; memoize removes *repeated CPU* for duplicate inputs.

</details>

### 10. Is a `HashMap` lookup per item inside a loop an N+1?

<details><summary>Answer</summary>

No. The defining feature is *expensive* per-item work — crossing a slow boundary (network/disk) or `O(n)` work per item. An `O(1)` in-memory map lookup per item is just a normal, cheap loop. N+1 is about the *cost* of the per-item operation, not the mere presence of one.

</details>

---

## Detection & Fixing

### 11. You're told an endpoint is slow but every function reads as innocent `O(n)`. How do you find the N+1?

<details><summary>Answer</summary>

Instrument the system, don't re-read the code. Turn on a **per-request query/call counter** (warn past a threshold) or open a **trace**. N+1 hides behind getters, lazy ORM relations, and helpers, so the call isn't visible at the call site — only the I/O behavior reveals it.

</details>

### 12. What does an N+1 look like on a tracing flame graph?

<details><summary>Answer</summary>

A **wall of identical sibling spans** — dozens of `SELECT … WHERE id = ?` (or RPC) spans, one per item, stacked end to end under the handler. After batching, they collapse to a single `WHERE id IN (...)` span.

</details>

### 13. How do you write a test that *prevents* an N+1 regression?

<details><summary>Answer</summary>

Use a spy/counting wrapper around the DB or client and **assert the call count**: e.g., `assert queries ≤ 2` and `assert per_item_fetch.call_count == 0`, regardless of row count. The test fails in CI the moment someone reintroduces a per-item call.

</details>

### 14. Why assert query *count* rather than latency in that guard test?

<details><summary>Answer</summary>

Count is **deterministic** and is exactly the property that regresses (`1+N` vs `2`); it's independent of machine, cache, and network. Latency is flaky in CI and a fast box can hide an N+1. Count asserts the *algorithmic shape*.

</details>

### 15. Explain the dataloader pattern.

<details><summary>Answer</summary>

Callers request items one at a time (`load(id)`), but the loader **queues** the keys within a tick, fetches them all in **one batched call**, then dispatches results back to each caller. It batches transparently — callers keep natural per-item call sites (e.g., GraphQL resolvers) — and typically de-dupes keys and caches within the request.

</details>

### 16. What problem does dataloader solve that hand-batching doesn't?

<details><summary>Answer</summary>

Hand-batching forces every call site into "collect keys → bulk fetch → re-stitch," which is invasive in deep call trees where many independent functions each need one item (resolvers). Dataloader keeps those call sites simple and centralizes batching in one tested place — readability *and* one round-trip.

</details>

### 17. Why must a dataloader be scoped per request?

<details><summary>Answer</summary>

Its within-request cache must hold **fresh** data for that request only. A globally shared loader would serve stale results across requests and accumulate keys/memory unbounded.

</details>

### 18. You batched a per-item RPC into a bulk call but latency barely moved. The endpoint got 5,000 ids for a 200-row table. What went wrong?

<details><summary>Answer</summary>

You forgot to **de-duplicate** the keys: you sent one id per item (5,000) instead of the ~200 distinct ids. Collect a `set` of distinct keys before the bulk call.

</details>

### 19. How do you fix an N+1 that lives inside a JSON serializer / view layer?

<details><summary>Answer</summary>

First detect it by instrumenting the **whole request** end to end (the serializer fires queries at render time, after your service code "finished"). Then preload the relations the serializer needs *before* serialization (eager-load or a batched prefetch), or configure the serializer to use a prefetched map. The key insight: the N+1 isn't in your business logic — instrument past it.

</details>

### 20. An ORM offers `JOIN FETCH` / eager loading to kill the N+1. What new problem can it cause?

<details><summary>Answer</summary>

A one-to-many `JOIN FETCH` can cause a **cartesian/row explosion** (the parent row duplicated per child), and eager-loading everything can **over-fetch** large payloads — trading the N+1 for one huge slow query. Verify row count and payload size.

</details>

---

## Scale & Trade-offs

### 21. You replace `1 + 100,000` queries with one `WHERE id IN (...)` of 100,000 ids and it fails. Why, and what's the fix?

<details><summary>Answer</summary>

You exceeded the database's **bind-parameter limit** (Postgres ~65,535) and/or the query-text/packet size, and a huge `IN` list can also defeat the planner. Fix: **chunk** the ids into pages (e.g., 1,000 per `IN`), one batched query per chunk — `O(n/chunk)` queries, not `O(n)` and not one illegal monster.

</details>

### 22. A colleague "fixed" N+1 with `SELECT * FROM users` (2M rows) into a dict. Local is fast, prod OOMs. Diagnose.

<details><summary>Answer</summary>

They traded N+1 for **over-fetch** — the mirror-image bug. Preloading the entire table materializes millions of rows in memory to use a handful. Fix: preload **only the distinct keys the loop references** (`find_by_ids(ids)`) — same one-query win, tiny memory.

</details>

### 23. No batch endpoint exists — only `GET /item/{id}` — and you have 2,000 ids. Compare sequential, unbounded-concurrent, bounded-concurrent.

<details><summary>Answer</summary>

- **Sequential**: `2000 × latency`, too slow. - **Unbounded concurrent**: fast wall-clock, but 2,000 simultaneous calls exhaust your connection pool and can DDoS the downstream / trip its rate limit. - **Bounded concurrent** (worker pool / semaphore of, say, 8–32): ship this. Cut latency without overwhelming anyone; size the limit to the **downstream's capacity and your connection-pool ceiling**, not to `n`.

</details>

### 24. Batching vs fan-out: which reduces work, and which only parallelizes it?

<details><summary>Answer</summary>

**Batching reduces the work** — `N` operations become 1 (one round-trip, less downstream load). **Fan-out only parallelizes** — it still makes `N` calls, just concurrently instead of sequentially, cutting wall-clock latency but *amplifying* downstream load. Prefer batch; fan-out is the fallback when no batch endpoint exists.

</details>

### 25. Why does batching apply backpressure naturally while fan-out can defeat it?

<details><summary>Answer</summary>

A batch is **one request** the downstream queues and rate-limits like any other — it can slow or shed one request. Fan-out is `N` simultaneous requests; it multiplies your footprint on the dependency exactly when it's struggling, and naive retries on top turn a blip into an outage.

</details>

### 26. How do you size the worker count for a bounded fan-out?

<details><summary>Answer</summary>

To the **downstream's capacity and your connection-pool ceiling**, *not* to `len(ids)`. The width must stay below the connection pool (or threads just queue/deadlock) and within the downstream's rate limit. Often a small constant (8–32). Honor `429`/`Retry-After`.

</details>

### 27. Give three cases where leaving `N` per-item calls in place is the correct decision.

<details><summary>Answer</summary>

(1) `n` is small and bounded (3–10 items; sub-noise latency). (2) The per-item "call" is in-memory/`O(1)` — that's a normal loop. (3) The path is cold (fires rarely), so batching machinery isn't worth the readability cost. (Bonus: per-item semantics are required for correctness/freshness.) Confirm with a profiler before adding complexity — otherwise it's premature optimization.

</details>

### 28. When is batching *not* worth the readability cost?

<details><summary>Answer</summary>

When `n` is small and fixed, the call is cheap, and the path isn't hot. The batched form (collect → fetch → re-stitch with a map) is more indirect than a plain per-item loop; trading that clarity to save microseconds on a 3-iteration loop is a premature optimization. Use a dataloader if you want both readability and batching.

</details>

### 29. How is a `list.contains()` inside a loop *both* an N+1 and a Wrong-Data-Structure bug?

<details><summary>Answer</summary>

**N+1**: a linear scan done once per item is per-item expensive work that should be done once. **Wrong structure**: a slice gives `O(n)` membership where a set gives `O(1)`. One change — **build a set once before the loop** — turns `O(n×m)` into `O(n+m)` and resolves both framings.

</details>

### 30. What's the relationship between N+1 and the "preload everything" trap — are they opposites?

<details><summary>Answer</summary>

They're opposite failures on the same fetch axis. N+1 **under-fetches** (one row per item, `n` round-trips). Naive preload **over-fetches** (the whole table at once, gigabytes of memory). The correct middle is **preload exactly the working set** — the distinct keys the loop will touch — in one call.

</details>

---

## Hard / Staff-Level

### 31. Your fix batches the service layer, but the endpoint is *still* slow. Where else would you look?

<details><summary>Answer</summary>

Other N+1s the first fix didn't cover: the **serializer/view layer** lazily loading per row at render; a **helper function** called in a loop that fetches internally; a **recursive tree walk** loading children per node; a **second relation** still lazy-loaded. Instrument the *whole request* — the query counter will show remaining per-item queries no matter where they hide.

</details>

### 32. Design a batched cache read to fix `1 + N` Redis `GET`s. What are the failure modes?

<details><summary>Answer</summary>

Use `MGET` (or a pipeline) for all keys in one round-trip, then handle **partial hits**: some keys miss, so collect the misses, batch-load them from the source of truth, and `MSET` them back. Failure modes: a thundering-herd on the misses (batch-load them, don't loop), and large key sets exceeding pipeline/packet limits (chunk). The `caching-strategies` skill covers this.

</details>

### 33. You have N+1 across *microservices*: service A loops calling service B once per item. B has no batch endpoint. Options?

<details><summary>Answer</summary>

In priority order: (1) **add a batch endpoint to B** (best — reduces work, the right long-term fix); (2) **bounded fan-out** from A with a worker pool sized to B's capacity, plus rate-limit/backoff; (3) **cache** B's responses in A if data is reusable across items/requests; (4) **denormalize** — have A receive the needed fields up front (e.g., B publishes events A materializes), removing the per-item call entirely. The choice depends on B's ownership, data freshness needs, and call volume.

</details>

### 34. When is memoization the right cure rather than batching?

<details><summary>Answer</summary>

When the per-item work is a **pure recomputation with repeated inputs** — same function, same arguments, no I/O to batch. Caching results makes the second-and-later occurrences of a key free. Batching applies to *I/O* you can coalesce; memoization applies to *CPU* you can avoid repeating. If keys rarely repeat, memoization buys nothing — hoist or restructure instead.

</details>

### 35. A loop fires one independent point-in-time read per item (e.g., a freshness/lock check). Batching them into one snapshot changes results. How do you reason about this?

<details><summary>Answer</summary>

This is a case where **correctness beats round-trips**. Batching coalesces `N` reads into one snapshot, but if each item legitimately needs an *independent* point-in-time view (a per-item lock acquisition, a serializable read), one batched snapshot changes the semantics and can introduce a race. The reasoning: first ask whether the per-item independence is *required* by the contract or merely incidental. If required, leave the per-item reads (or batch within a single transaction/isolation level that preserves the guarantee); never trade correctness for latency. If incidental, batch freely.

</details>

### 36. A profiler shows a flat profile — no single hot function — yet the service is slow. How could N+1 explain it, and how do you confirm?

<details><summary>Answer</summary>

"Death by a thousand cuts": the time isn't in CPU at all — it's in **waiting on `N` round-trips** scattered across many small calls, so a CPU profiler shows nothing hot. Confirm with a **request/query counter** or a **trace** (wall-clock, I/O-aware), which surfaces the wall of per-item spans a CPU profiler misses. The lesson: profile the dimension that's actually slow — for N+1 that's I/O/latency, not CPU.

</details>

---

## Related Topics

- [N+1 in Code → junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) — the full progression.
- [N+1 in Code → tasks.md](tasks.md) — build the cures from scratch.
- [Wrong Data Structure → interview.md](../04-wrong-data-structure/interview.md) — the scan-in-loop overlap.
- [Premature Optimization Traps → interview.md](../01-premature-optimization-traps/interview.md) — measure-first; when N calls are fine.
- The `database-performance`, `big-o-analysis`, and `caching-strategies` skills — ORM N+1, the cost model, batched cache reads.