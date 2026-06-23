# N+1 in Code — Junior Level

> **Category:** [Performance Anti-Patterns](../README.md) → **N+1 in Code** — *per-item work in a loop that should have been done once.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Shape](#the-shape)
4. [The Latency Math](#the-latency-math)
5. [The Fix: Batch It](#the-fix-batch-it)
6. [It's Not Just Databases](#its-not-just-databases)
7. [A Spotting Checklist](#a-spotting-checklist)
8. [Common Mistakes](#common-mistakes)
9. [Test Yourself](#test-yourself)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does it look like?** and **Why is it bad?**

You have a list of `n` things. For each one, you do a piece of *expensive* work — a network call, a database query, a file read, a heavy recomputation. The loop runs, and what looked like one operation in your code becomes `n` operations against the slow thing. That is the **N+1** shape: **1** operation to get the list, plus **N** more — one per item — to enrich it.

```go
orders := getOrders()              // 1 call
for _, o := range orders {
    o.User = getUser(o.UserID)     // +N calls — one per order
}
```

If `getUser` is a 20 ms network round-trip and you have 200 orders, that loop costs **4 seconds** — for data you could have fetched in a single batched call in 25 ms. The work didn't get harder; you just did it the slow way, `n` times.

The name comes from the database/ORM world — fetch a list of rows (1 query), then lazily load a related row per item (N queries). That specific version belongs to the SQL layer; the `database-performance` skill covers it in depth. But the **shape is general**. Any repeated per-item operation that crosses an expensive boundary — an RPC, a syscall, a disk read, even a costly recomputation — is the same anti-pattern wearing different clothes. This file teaches the general shape so you recognize it everywhere, not just behind an ORM.

> **The mindset shift:** the cost of a loop is `n × (cost of the body)`. When the body touches something slow, `n` is a multiplier on slowness. The cure is almost always to **do the slow thing once** — batched — instead of `n` times.

---

## Prerequisites

- **Required:** You can write and read a `for` loop in at least one language (examples use Go, Java, Python).
- **Required:** You understand that a network call or database query is *thousands of times slower* than an in-memory operation — milliseconds vs nanoseconds.
- **Helpful:** Basic familiarity with maps/dictionaries (the fix often preloads data into one).
- **Helpful:** You've waited on a page that loads "a little slow" and wondered why — N+1 is one of the most common reasons.

---

## The Shape

Here is the canonical version in three languages. A list, then a per-item lookup against something slow:

```java
// Java — 1 query for orders, then N queries for users
List<Order> orders = orderRepo.findRecent();          // 1
for (Order o : orders) {
    User u = userRepo.findById(o.getUserId());        // +N
    o.setUser(u);
}
```

```python
# Python — same shape, calling a remote service per item
orders = order_service.recent()                       # 1 call
for o in orders:
    o.user = user_service.get(o.user_id)              # +N calls
```

```go
// Go — same shape, a syscall (file read) per item
files := listFiles(dir)                               // 1 readdir
for _, f := range files {
    f.Meta = readMetadata(f.Path)                     // +N reads
}
```

The tell is always the same: **a slow operation sits *inside* the loop**, parameterized by the current item. One call became one-plus-`n`.

---

## The Latency Math

This is the whole reason N+1 matters, so make it concrete. Suppose each remote call is a 20 ms round-trip and you have `n` items:

| n (items) | N+1 calls | Time @ 20 ms each | One batched call |
|---|---|---|---|
| 10 | 11 | 220 ms | ~25 ms |
| 100 | 101 | 2.0 s | ~30 ms |
| 1,000 | 1,001 | 20 s | ~60 ms |

The N+1 column grows **linearly with the data**; the batched column barely moves. Worse, the round-trips are usually **sequential** — call 2 can't start until call 1 returns — so you pay the full `n × latency`. The data set you tested with (5 items, "fast enough") becomes a production incident at 500 items. Nothing in the code got slower; the input got bigger and the multiplier did its job.

> **Round-trips, not CPU, are the cost.** Each remote call is mostly *waiting* — network flight time, the remote service's queue. Stacking `n` waits end-to-end is the expense, and batching collapses `n` waits into one.

---

## The Fix: Batch It

The cure is to do the expensive operation **once, for all items**, using a bulk interface. Collect the keys first, fetch them in a single call, then stitch the results back together with a map.

```java
// After — 1 query for orders + 1 batched query for all users = 2 total
List<Order> orders = orderRepo.findRecent();                 // 1

List<Long> userIds = orders.stream()
        .map(Order::getUserId).distinct().toList();
Map<Long, User> users = userRepo.findByIds(userIds).stream() // 1 (IN (...))
        .collect(toMap(User::getId, u -> u));

for (Order o : orders) {
    o.setUser(users.get(o.getUserId()));                     // in-memory, ~free
}
```

```python
# After — 1 + 1 instead of 1 + N
orders = order_service.recent()                              # 1
ids = {o.user_id for o in orders}
users = user_service.get_many(ids)                           # 1 batch call
by_id = {u.id: u for u in users}
for o in orders:
    o.user = by_id[o.user_id]                                # dict lookup, ~free
```

Two calls instead of 1,001. The per-item lookup inside the loop still happens — but now it's a **map lookup in memory** (nanoseconds), not a network round-trip (milliseconds). You moved the slow boundary *outside* the loop and crossed it once.

If there's no bulk endpoint or `IN (...)` query available, the same idea takes other forms (preload, memoize, restructure) — `middle.md` covers those. But "batch the call" is the first reflex.

---

## It's Not Just Databases

The ORM N+1 is famous, but the shape shows up far from any database. Train yourself to see it everywhere:

| Where it hides | The per-item expensive thing |
|---|---|
| Microservices | One HTTP/gRPC call per item to another service (use the batch endpoint) |
| Filesystem | One `stat`/`open`/`read` syscall per file (read once, or list with metadata) |
| Caching | One `GET` per key to Redis (use `MGET`/pipeline) — see `caching-strategies` |
| Recomputation | Recomputing the same invariant each iteration (compute once before the loop) |
| Membership | A linear `contains()` scan inside the loop → `n × m` (build a set once) |

All of these are the same anti-pattern: **per-item expensive work that should have been done once.** Different boundary, identical cure — batch, preload, or hoist.

---

## A Spotting Checklist

Run this over any loop you write or review this week:

- [ ] Is there a **network call, query, or syscall inside the loop body**, keyed by the item? → N+1.
- [ ] Does the slow thing have a **bulk / batch / `IN (...)` / `MGET` variant**? → batch it.
- [ ] Is something **recomputed every iteration** that doesn't depend on the item? → hoist it out.
- [ ] Is there a `contains()` / linear search **inside** the loop? → preload a set/map.
- [ ] Would this loop's cost **grow with production data size** the way it doesn't in your tests? → suspect N+1.

If you check the first box, you've almost certainly found an N+1.

---

## Common Mistakes

1. **"It's fast on my machine."** You tested with 5 rows; production has 5,000. N+1 is invisible at small `n` and catastrophic at large `n`. Always reason about the *multiplier*, not the demo.
2. **Hiding the call behind a getter.** `o.getUser()` looks free, but if it lazily fires a query, the loop is still N+1 — the cost is just camouflaged. (More in `senior.md`.)
3. **Optimizing the loop body's CPU instead of removing the round-trip.** Shaving microseconds off in-memory work is pointless when each iteration waits 20 ms on the network.
4. **Assuming "it's just a few extra calls."** A few per request, across thousands of requests, hammers the downstream service and exhausts connection pools.
5. **Reaching for parallelism first.** Firing 1,000 calls concurrently can *hide* the latency but multiplies load on the dependency and risks overwhelming it. Batching is one call; prefer it. (`professional.md` covers when fan-out is the right tool.)

---

## Test Yourself

1. In the name "N+1," what is the **1** and what is the **N**?
2. A loop makes one 15 ms remote call per item, sequentially, over 400 items. Roughly how long does it take? What does batching it into one call cost, roughly?
3. Why does an N+1 bug usually *pass* code review and testing, then surface in production?
4. Rewrite this to make 2 calls instead of 1+N:
   ```python
   posts = get_posts()
   for p in posts:
       p.author = get_author(p.author_id)   # remote call per post
   ```
5. Name three places **outside a database** where N+1 appears.

<details>
<summary>Answers</summary>

1. The **1** is the initial operation that fetches the list (e.g., `getOrders()`). The **N** is the one-extra-operation-per-item done inside the loop to enrich each element. Total operations: `1 + N`.
2. ~`400 × 15 ms = 6 seconds` (sequential round-trips). One batched call is a single round-trip plus a bit of server work — on the order of **tens of milliseconds**. Roughly a 100× improvement.
3. Tests and local runs use *small* data, where `N` is tiny and the loop feels instant. The cost is `n × latency`, so it only becomes painful once `n` is large — which happens with real production data, not the handful of fixture rows.
4. ```python
   posts = get_posts()                       # 1
   ids = {p.author_id for p in posts}
   authors = get_authors(ids)                # 1 batch call
   by_id = {a.id: a for a in authors}
   for p in posts:
       p.author = by_id[p.author_id]         # in-memory lookup
   ```
5. Any three of: one RPC/HTTP call per item to another service; one filesystem syscall (`stat`/`read`) per file; one cache `GET` per key (use `MGET`); recomputing an invariant each iteration; a linear `contains()` scan inside the loop (`n × m`).

</details>

---

## Cheat Sheet

| | |
|---|---|
| **Shape** | 1 op to get the list + N ops (one per item) inside the loop |
| **Spot it by** | A network call / query / syscall / heavy compute *inside* a loop, keyed by the item |
| **Why it's bad** | Cost is `n × latency`; grows with data; sequential round-trips stack up |
| **The math** | 1,000 items × 20 ms = 20 s vs ~1 batched call ≈ 30 ms |
| **First fix** | Batch: collect keys → one bulk call (`findByIds` / `IN (...)` / `MGET`) → map lookup in loop |
| **Beyond DBs** | RPC-per-item, syscall-per-item, cache-GET-per-item, recompute-per-item, scan-in-loop |

> **One rule to remember:** *If the loop body touches something slow, do the slow thing once — batched — not n times.*

---

## Summary

- **N+1 in code** is the shape where a loop does `N` units of expensive per-item work (a call, query, syscall, or recomputation) on top of the **1** operation that fetched the list.
- It's bad because the cost is `n × latency`: it scales with your data, the round-trips are usually sequential, and it's invisible at the small `n` you test with.
- The first cure is to **batch**: collect the keys, make **one** bulk call, and replace the per-item slow operation with a cheap in-memory map lookup.
- The database/ORM version is the famous one (`database-performance` skill), but the shape is **general** — RPCs, syscalls, cache reads, and recomputations all do it.
- Next: [`middle.md`](middle.md) — *the other shapes (preload, hoist, set-membership) and how to fix each one, with the call-count drop measured.*

---

## Further Reading

- **Patterns of Enterprise Application Architecture** — Martin Fowler (2002) — *Lazy Load* and the N+1 it causes; *Identity Map* (the preload-into-a-map cure).
- **Programming Pearls** — Jon Bentley (2nd ed., 1999) — Column 6–8, on the cost of doing work `n` times and the wins from doing it once.
- **Refactoring** — Martin Fowler (2nd ed., 2018) — *Split Loop*, *Replace Loop with Pipeline*, and extracting loop-invariant work.
- The `database-performance`, `big-o-analysis`, and `caching-strategies` skills — the SQL N+1, the cost model, and batched cache reads.

---

## Related Topics

- [N+1 in Code → middle.md](middle.md) — spotting and fixing each N+1 shape with measured call-count drops.
- [Premature Optimization Traps](../01-premature-optimization-traps/junior.md) — the sibling: don't optimize *unmeasured* code (but a confirmed N+1 *is* worth fixing).
- [Unnecessary Allocation](../03-unnecessary-allocation/junior.md) — allocating per item in a hot loop is the allocation cousin of N+1.
- [Wrong Data Structure](../04-wrong-data-structure/junior.md) — a `contains()` scan inside a loop (`n × m`) is both N+1 *and* a wrong-structure bug.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Split Loop, hoist invariant code, replace loop with pipeline.
