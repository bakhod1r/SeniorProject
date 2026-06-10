# N+1 in Code — Optimize It

> **Category:** [Performance Anti-Patterns](../README.md) → **N+1 in Code** — *per-item work in a loop that should have been done once.*

---

These are not "spot the smell" puzzles — [`find-bug.md`](find-bug.md) does that. Here each endpoint or report is **N+1-shaped and working but slow**, and your job is to **batch or preload it and prove the win with numbers** — the call/query count *and* the latency, before and after, with the reasoning that connects them.

The discipline mirrors the rest of this chapter: **measure → fix → measure again.** Every optimization below leads with the instrumentation that *confirmed* the N+1 (a query/call counter or a trace), because fixing an unmeasured N+1 is itself a [premature optimization](../01-premature-optimization-traps/optimize.md). The numbers are illustrative but realistic — your real fix ships with your real profiler's numbers attached.

> **How to use this file:** predict the before/after call count and the latency drop *yourself*, then expand. The gap between your estimate and the measured numbers is the back-of-envelope skill (`system-design-estimation`) you're training.

---

## Table of Contents

| # | Target | Fix | Lang |
|---|---|---|---|
| 1 | [The orders report (query N+1)](#optimize-1--the-orders-report) | Preload into a map | Java |
| 2 | [The feed endpoint (RPC N+1)](#optimize-2--the-feed-endpoint) | Bulk call + de-dupe | Go |
| 3 | [The permissions check (n×m scan)](#optimize-3--the-permissions-check) | Set membership | Python |
| 4 | [The cache warmer (per-key GET)](#optimize-4--the-cache-warmer) | MGET + chunking | Go |

---

## Optimize 1 — The orders report

An admin "recent orders" report. Loads orders, then per order loads the customer and the shipping address. Reported as "takes ~6 seconds for the last 300 orders."

```java
// Before — 1 + N + N queries.
public List<ReportRow> recentOrdersReport() {
    List<Order> orders = orderRepo.findRecent(300);          // 1 query
    List<ReportRow> rows = new ArrayList<>();
    for (Order o : orders) {
        Customer c = customerRepo.findById(o.getCustomerId());   // +N
        Address  a = addressRepo.findById(o.getAddressId());     // +N
        rows.add(new ReportRow(o.getId(), c.getName(), a.getCity()));
    }
    return rows;
}
```

**Measure first.** A request-scoped query counter (`senior.md`) logs the truth:

```
recentOrdersReport: 601 queries, 6,040 ms
  (1 findRecent + 300 customer + 300 address)
```

<details>
<summary>Optimized</summary>

**Fix: preload both relations in one batched query each, resolve from maps.**

```java
// After — 1 + 1 + 1 = 3 queries.
public List<ReportRow> recentOrdersReport() {
    List<Order> orders = orderRepo.findRecent(300);                 // 1

    Set<Long> custIds = orders.stream().map(Order::getCustomerId).collect(toSet());
    Set<Long> addrIds = orders.stream().map(Order::getAddressId).collect(toSet());

    Map<Long, Customer> customers = customerRepo.findAllById(custIds).stream()  // 1
            .collect(toMap(Customer::getId, c -> c));
    Map<Long, Address> addresses = addressRepo.findAllById(addrIds).stream()    // 1
            .collect(toMap(Address::getId, a -> a));

    return orders.stream()
            .map(o -> new ReportRow(
                    o.getId(),
                    customers.get(o.getCustomerId()).getName(),
                    addresses.get(o.getAddressId()).getCity()))
            .toList();
}
```

**After measurement:**

```
recentOrdersReport: 3 queries, 48 ms
```

| Metric | Before | After | Change |
|---|---|---|---|
| Queries | 601 | 3 | **200× fewer** |
| Latency | 6,040 ms | 48 ms | **~125× faster** |
| Rows fetched | 300 + ≤300 + ≤300 | 300 + distinct + distinct | fewer (de-duped) |

**Reasoning.** The 601→3 drop is the proof the N+1 is gone — deterministic, independent of the box. The latency followed because 600 sequential ~10 ms round-trips collapsed to 2 batched ones. Collecting customer/address ids into `Set`s de-dupes, so the `IN (...)` lists hold the *distinct* ids (if 300 orders share 80 customers, we fetch 80). This stays correct at any volume because it's `O(1)` queries, not `O(n)`. Lock it with a guard test: `assert queries ≤ 3`.

</details>

---

## Optimize 2 — The feed endpoint

A social feed: load posts, then per post fetch the author (a remote user-service RPC) and a like count (another RPC). p99 latency ~4.5 s for a 200-post page.

```go
// Before — 1 + 2N RPCs.
func Feed(ctx context.Context, page int) ([]FeedItem, error) {
    posts, err := postStore.Page(ctx, page, 200)   // 1 (local DB)
    if err != nil {
        return nil, err
    }
    items := make([]FeedItem, 0, len(posts))
    for _, p := range posts {
        author, _ := userClient.GetUser(ctx, p.AuthorID)    // +N RPC
        likes, _ := likeClient.Count(ctx, p.ID)             // +N RPC
        items = append(items, FeedItem{Post: p, Author: author, Likes: likes})
    }
    return items, nil
}
```

**Measure first.** A trace shows a wall of 400 sibling RPC spans under the handler — the unmistakable N+1 signature. Counter:

```
Feed: 1 DB query + 400 RPCs, p50 2,800 ms / p99 4,520 ms
```

<details>
<summary>Optimized</summary>

**Fix: batch both RPCs (de-dupe author ids), resolve from maps.**

```go
// After — 1 DB query + 2 batched RPCs.
func Feed(ctx context.Context, page int) ([]FeedItem, error) {
    posts, err := postStore.Page(ctx, page, 200)   // 1
    if err != nil {
        return nil, err
    }

    authorIDs := distinct(posts, func(p Post) int64 { return p.AuthorID })
    postIDs := mapSlice(posts, func(p Post) int64 { return p.ID })

    authors, err := userClient.GetUsers(ctx, authorIDs)     // 1 batched RPC
    if err != nil {
        return nil, err
    }
    likes, err := likeClient.CountBatch(ctx, postIDs)       // 1 batched RPC
    if err != nil {
        return nil, err
    }
    byAuthor := indexBy(authors, func(u User) int64 { return u.ID })

    items := make([]FeedItem, 0, len(posts))
    for _, p := range posts {
        items = append(items, FeedItem{
            Post:   p,
            Author: byAuthor[p.AuthorID],
            Likes:  likes[p.ID],          // in-memory map lookups
        })
    }
    return items, nil
}
```

**After measurement:**

```
Feed: 1 DB query + 2 RPCs, p50 70 ms / p99 130 ms
```

| Metric | Before | After | Change |
|---|---|---|---|
| RPCs | 400 | 2 | **200× fewer** |
| p99 latency | 4,520 ms | 130 ms | **~35× faster** |
| Load on user-service | 200 req/page | 1 req/page | **200× less** |

**Reasoning.** The RPC count (400→2) is the proof; the latency followed because 400 sequential ~11 ms round-trips became 2. Note the *third* win — **downstream load** dropped 200×: the user-service now sees one batched request per feed page instead of 200, which matters when thousands of users load feeds at once. De-duping author ids means a feed where 200 posts come from 40 authors fetches 40 users. If `GetUsers` ever needs to handle huge id lists, chunk it (Optimize 4's lesson). Guard test: `assert userClient.GetUser` is never called and `GetUsers` is called once.

</details>

---

## Optimize 3 — The permissions check

A bulk action endpoint checks, for each selected document, whether the current user is in that document's allowed-editors list. Slow for large selections.

```python
# Before — for each doc, linearly scan its editors AND re-fetch the user's groups. O(n × m) + N calls.
def editable_docs(user, docs):
    out = []
    for d in docs:                              # n docs
        groups = group_service.for_user(user.id)   # +N remote calls (invariant!)
        for editor_id in d.allowed_editor_ids:      # × m scan
            if editor_id == user.id or editor_id in {g.id for g in groups}:
                out.append(d)
                break
    return out
```

**Measure first.**

```
editable_docs: 500 remote calls, 9,800 ms (500 docs)
  - group_service.for_user called 500× (same user every time!)
  - inner scan up to 500 × avg 12 editors = 6,000 comparisons
```

<details>
<summary>Optimized</summary>

**Fix: hoist the invariant call out (it never depended on `d`), and the membership becomes a set lookup.**

```python
# After — 1 remote call total; O(n × m) scan → O(n × m) but with O(1) set membership.
def editable_docs(user, docs):
    groups = group_service.for_user(user.id)          # ONCE (hoisted)
    allowed_ids = {user.id} | {g.id for g in groups}  # built once

    out = []
    for d in docs:                                    # n
        editors = set(d.allowed_editor_ids)           # per-doc set
        if allowed_ids & editors:                     # O(min(|a|,|e|)) intersection
            out.append(d)
    return out
```

**After measurement:**

```
editable_docs: 1 remote call, 95 ms (500 docs)
```

| Metric | Before | After | Change |
|---|---|---|---|
| Remote calls | 500 | 1 | **500× fewer** |
| Latency | 9,800 ms | 95 ms | **~100× faster** |
| Membership | linear scan in loop | set intersection | `O(m)` → `O(1)` per check |

**Reasoning.** Two N+1s in one function. The **dominant** one was the invariant `group_service.for_user(user.id)` — fetching the *same user's* groups 500 times. Hoisting it (it never depended on `d`) is the bulk of the 100× win: 500 remote calls → 1. The membership scan was the secondary issue; precomputing `allowed_ids` once and using set membership/intersection removes the per-editor linear scan. The call count (500→1) proves the primary fix; the set change is a CPU cleanup on top. **Order matters:** always hunt the *remote* N+1 first — it dwarfs CPU costs.

</details>

---

## Optimize 4 — The cache warmer

A startup job preloads a Redis cache: for each of ~50,000 product ids, it `GET`s the cached record and, on a miss, computes and `SET`s it. Takes minutes.

```go
// Before — 1 GET per id (+ a SET per miss). 50,000 round-trips.
func warmCache(ctx context.Context, ids []string) error {
    for _, id := range ids {                        // 50,000
        if _, err := rdb.Get(ctx, id).Result(); err == redis.Nil {  // +N GETs
            val := compute(id)
            rdb.Set(ctx, id, val, time.Hour)        // +M SETs
        }
    }
    return nil
}
```

**Measure first.**

```
warmCache: 50,000 GETs (+ ~6,000 SETs on misses), 142,000 ms
  (each round-trip ~2.5 ms; sequential)
```

<details>
<summary>Optimized</summary>

**Fix: `MGET` in chunks for the reads, batch the misses, `MSET` them back.**

```go
// After — ceil(n/chunk) MGETs + a few MSETs.
func warmCache(ctx context.Context, ids []string) error {
    const chunk = 1000
    for start := 0; start < len(ids); start += chunk {
        end := min(start+chunk, len(ids))
        batch := ids[start:end]

        vals, err := rdb.MGet(ctx, batch...).Result()   // 1 MGET per chunk
        if err != nil {
            return err
        }

        misses := map[string]any{}
        for i, v := range vals {
            if v == nil {                                // cache miss
                misses[batch[i]] = compute(batch[i])
            }
        }
        if len(misses) > 0 {
            if err := rdb.MSet(ctx, misses).Err(); err != nil {  // 1 MSET per chunk
                return err
            }
        }
    }
    return nil
}
```

**After measurement:**

```
warmCache: 50 MGETs + ≤50 MSETs, 1,900 ms
```

| Metric | Before | After | Change |
|---|---|---|---|
| Redis round-trips | ~56,000 | ~100 | **~560× fewer** |
| Latency | 142,000 ms | 1,900 ms | **~75× faster** |
| Chunk safety | — | ≤1,000 keys/call | within packet limits |

**Reasoning.** The round-trip count (56,000→100) is the proof. Latency followed: 56,000 sequential ~2.5 ms hops collapsed to ~100. **Chunking is mandatory here** — a single `MGET` of 50,000 keys risks exceeding Redis's protocol/packet limits and pins memory on both sides; 1,000-key chunks stay safe while keeping calls at `O(n/chunk)`, the middle ground between N+1 and one illegal giant call (`professional.md`). Misses are batched into one `MSET` per chunk rather than a `SET` per miss — don't fix one N+1 (`GET`) and leave another (`SET`). The `caching-strategies` skill covers `MGET`/pipeline patterns and miss handling.

</details>

---

## The Optimization Loop — Recap

Every fix above ran the same loop, and every one reports **two numbers**:

```text
measure (counter/trace) → confirm N+1 → batch / preload / hoist → measure again
                                         ↓
                    report: call-count drop  AND  latency drop
```

- **Call count is the proof; latency is the payoff.** The deterministic `1+N → constant` drop proves the *shape* changed; the latency drop is the consequence (sequential round-trips collapsing). Report both — latency alone could be noise; count alone hides the user-facing win.
- **Hunt the remote N+1 before the CPU one** (Optimize 3). A hoisted remote call dwarfs any set-membership cleanup.
- **De-dupe keys** before every batch (Optimize 1, 2) — fetch distinct, not one-per-item.
- **Chunk** when the key set is large (Optimize 4) — batching has limits; `O(n/chunk)` is the safe middle.
- **Don't leave a second N+1** in the same path (the `SET`-per-miss in Optimize 4, the second RPC in Optimize 2).
- **Lock it with a guard test** asserting the call count, so the win can't silently regress (`senior.md`).
- **Confirm the hot path first.** If the counter says the endpoint runs twice a day over 4 items, there's no win worth the indirection — that would be the premature-optimization trap.

| Target | N+1 type | Cure | Count drop | Latency drop |
|---|---|---|---|---|
| Orders report | query (×2 relations) | preload maps | 601 → 3 | 6.0 s → 48 ms |
| Feed endpoint | RPC (×2) | bulk call + de-dupe | 400 → 2 | 4.5 s → 130 ms |
| Permissions | invariant call + scan | hoist + set | 500 → 1 | 9.8 s → 95 ms |
| Cache warmer | per-key GET/SET | MGET + chunk | 56k → 100 | 142 s → 1.9 s |

---

## Related Topics

- [N+1 in Code → tasks.md](tasks.md) — build these cures from scratch.
- [N+1 in Code → senior.md](senior.md) — the counters/traces that produced the "before" numbers, and the guard tests that lock the "after."
- [N+1 in Code → professional.md](professional.md) — batch-size limits and chunking (Optimize 4), the over-fetch trap, fan-out vs batch.
- [Premature Optimization Traps → optimize.md](../01-premature-optimization-traps/optimize.md) — measure before you optimize; confirm the hot path.
- [Wrong Data Structure → optimize.md](../04-wrong-data-structure/optimize.md) — the set-membership win (Optimize 3) from the structure angle.
- The `database-performance`, `caching-strategies`, `big-o-analysis`, and `system-design-estimation` skills.
