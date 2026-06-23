# N+1 in Code — Find the Bug

> **Category:** [Performance Anti-Patterns](../README.md) → **N+1 in Code** — *per-item work in a loop that should have been done once.*

---

This file is **critical-reading practice**. Each snippet is plausible real-world code in Go, Java, or Python. Read it the way a performance-minded reviewer does and answer:

> **Is there an N+1 here? Where is the per-item expensive work? How would you fix it — and how many calls would the fix make?**

The catch: the expensive call is often **not visible at the call site** — it hides behind a getter, a lazy property, or a helper function. And **one snippet is a trap**: the per-item call looks like an N+1 but is actually correct — flagging it would be the mistake. Read slowly; count the round-trips; *then* open the answer.

> **How to use this file:** decide your verdict and predict the call count *before* expanding. The skill is seeing the I/O the syntax hides.

---

## Table of Contents

1. [The obvious one](#snippet-1--the-obvious-one)
2. [The helpful getter](#snippet-2--the-helpful-getter)
3. [The enrich helper](#snippet-3--the-enrich-helper)
4. [The lazy property](#snippet-4--the-lazy-property)
5. [The membership filter](#snippet-5--the-membership-filter)
6. [The recompute in the loop](#snippet-6--the-recompute-in-the-loop)
7. [The trap](#snippet-7--the-trap)

---

## Snippet 1 — The obvious one

```python
# Python — a dashboard endpoint
def build_dashboard(user_ids):
    cards = []
    for uid in user_ids:                       # 500 ids
        profile = profile_service.fetch(uid)   # remote call
        stats = stats_service.fetch(uid)       # another remote call
        cards.append(render_card(profile, stats))
    return cards
```

> Is there an N+1? Where? How would you fix it, and how many calls would the fix make?

<details>
<summary>Answer</summary>

**Yes — a double N+1.** Two remote calls per user: `2 × N` round-trips (1,000 calls for 500 users). At 15 ms each, ~15 seconds, all sequential.

**Fix:** batch both services. `profiles = profile_service.fetch_many(user_ids)` and `stats = stats_service.fetch_many(user_ids)`, index each by id, then render from the maps.

**Call count: `2N` → `2`** (one batch per service). For 500 users: 1,000 calls → 2.

```python
def build_dashboard(user_ids):
    profiles = {p.id: p for p in profile_service.fetch_many(user_ids)}
    stats    = {s.id: s for s in stats_service.fetch_many(user_ids)}
    return [render_card(profiles[uid], stats[uid]) for uid in user_ids]
```

</details>

---

## Snippet 2 — The helpful getter

```java
// Java — generating a shipping manifest
List<Shipment> shipments = shipmentRepo.findReadyToShip();   // 1 query
StringBuilder manifest = new StringBuilder();
for (Shipment s : shipments) {
    manifest.append(s.getId())
            .append(" → ")
            .append(s.getDestination().getCity())            // looks innocent...
            .append("\n");
}
```

> Is there an N+1? Where? How would you fix it, and how many calls would the fix make?

<details>
<summary>Answer</summary>

**Yes — hidden behind `getDestination()`.** If `Destination` is a `LAZY` ORM relation, `s.getDestination()` fires a query *per shipment*. The code reads like a field access; it's actually `1 + N` queries. This is the classic camouflaged N+1 — nothing in the loop *says* "database call."

**Fix:** eager-load the destination with a join fetch (`findReadyToShip()` → `... JOIN FETCH s.destination`) or preload destinations in a batched `WHERE id IN (...)` query and resolve from a map.

**Query count: `1 + N` → `1`** (join fetch) **or `2`** (separate batched preload). For 300 shipments: 301 → 1 or 2.

> The tell wasn't in this file — it was in the entity's fetch type two files away. Detect it with a per-request query counter (`senior.md`), not by reading the loop.

</details>

---

## Snippet 3 — The enrich helper

```go
// Go — building an activity feed
func buildFeed(ctx context.Context, posts []Post) []FeedItem {
    items := make([]FeedItem, 0, len(posts))
    for _, p := range posts {
        items = append(items, enrich(ctx, p))   // looks like pure CPU
    }
    return items
}

func enrich(ctx context.Context, p Post) FeedItem {
    author := userClient.GetUser(ctx, p.AuthorID)   // a remote call, inside the helper
    likes := likeClient.CountLikes(ctx, p.ID)       // another one
    return FeedItem{Post: p, Author: author, Likes: likes}
}
```

> Is there an N+1? Where? How would you fix it, and how many calls would the fix make?

<details>
<summary>Answer</summary>

**Yes — the N+1 is inside `enrich`, not in the loop you'd skim.** `buildFeed` looks like a clean `O(n)` map, but each `enrich` makes **two** remote calls, so the feed is `2 × N` round-trips. Helpers are a favorite hiding spot — the loop looks pure; the cost is one call away.

**Fix:** lift the batching to `buildFeed`. Collect author ids and post ids, call `userClient.GetUsers(ids)` and `likeClient.CountLikesBatch(postIDs)` once each, then build items from the maps. `enrich` becomes a pure in-memory function taking the prefetched maps.

**Call count: `2N` → `2`.** For 100 posts: 200 calls → 2.

> Rule: a helper called in a loop is an N+1 suspect. Open the helper before declaring the loop innocent.

</details>

---

## Snippet 4 — The lazy property

```python
# Python — exporting an invoice report
class Order:
    def __init__(self, row):
        self.id = row["id"]
        self._customer_id = row["customer_id"]

    @property
    def customer(self):
        return customer_repo.get(self._customer_id)   # I/O on every access!

def export(orders):
    rows = []
    for o in orders:
        rows.append(f"{o.id},{o.customer.name},{o.customer.tier}")  # accessed TWICE
    return rows
```

> Is there an N+1? Where? How would you fix it, and how many calls would the fix make?

<details>
<summary>Answer</summary>

**Yes — and worse than it looks.** The `customer` property does a DB read on *every access*, and the f-string accesses `o.customer` **twice** per order. So it's `2 × N` queries, not even `N` — `2 × N + 1` total. The `@property` syntax disguises I/O as attribute access.

**Fix (two parts):** (1) preload all customers once into a map keyed by id, before the loop; (2) at minimum, stop calling the property twice — bind it to a local. Best: pass the prefetched map and look up in memory.

```python
def export(orders):
    ids = {o._customer_id for o in orders}
    customers = {c.id: c for c in customer_repo.get_many(ids)}   # 1 query
    rows = []
    for o in orders:
        c = customers[o._customer_id]            # one in-memory lookup
        rows.append(f"{o.id},{c.name},{c.tier}")
    return rows
```

**Query count: `2N (+1)` → `1`.** For 1,000 orders: ~2,001 → 1. **Two lessons:** lazy properties hide I/O, and *repeated access* to a lazy property multiplies the N+1.

</details>

---

## Snippet 5 — The membership filter

```go
// Go — filtering orders down to VIP customers
func vipOrders(orders []Order, vipIDs []int64) []Order {
    var out []Order
    for _, o := range orders {                 // n
        for _, id := range vipIDs {            // × m
            if o.CustomerID == id {
                out = append(out, o)
                break
            }
        }
    }
    return out
}
```

> Is there an N+1? Where? How would you fix it, and how many comparisons would the fix make?

<details>
<summary>Answer</summary>

**Yes — a CPU-side N+1 (`n × m`).** No network here, but the *per-item expensive work* is a linear scan of `vipIDs` inside the loop. With 20k orders and 5k VIPs, that's up to 100,000,000 comparisons.

**Fix:** build a set from `vipIDs` once; membership becomes `O(1)`.

```go
func vipOrders(orders []Order, vipIDs []int64) []Order {
    vip := make(map[int64]struct{}, len(vipIDs))
    for _, id := range vipIDs {
        vip[id] = struct{}{}
    }
    out := make([]Order, 0)
    for _, o := range orders {
        if _, ok := vip[o.CustomerID]; ok {
            out = append(out, o)
        }
    }
    return out
}
```

**Comparisons: `n × m` → `n + m`.** ~100M → ~25k. This is simultaneously an N+1 *and* a [Wrong Data Structure](../04-wrong-data-structure/find-bug.md) bug — one set fixes both.

</details>

---

## Snippet 6 — The recompute in the loop

```python
# Python — scoring search results against a query
def rank(results, query):
    scored = []
    for r in results:                              # 50k results
        query_terms = set(query.lower().split())   # rebuilt every iteration
        idf = load_idf_table()                     # expensive load, every iteration
        score = sum(idf.get(t, 0) for t in query_terms if t in r.text)
        scored.append((score, r))
    return sorted(scored, reverse=True)
```

> Is there an N+1? Where? How would you fix it?

<details>
<summary>Answer</summary>

**Yes — an invariant-recompute N+1.** `query_terms` and `idf` don't depend on `r`, yet they're rebuilt/reloaded on **every** iteration. `load_idf_table()` is the killer — an expensive load done 50,000 times instead of once.

**Fix:** hoist both out of the loop.

```python
def rank(results, query):
    query_terms = set(query.lower().split())   # once
    idf = load_idf_table()                     # once
    scored = [(sum(idf.get(t, 0) for t in query_terms if t in r.text), r)
              for r in results]
    return sorted(scored, reverse=True)
```

**`load_idf_table()` calls: `N` → `1`.** For 50k results, 50,000 loads → 1. The body's `sum(...)` legitimately runs per result (it depends on `r.text`); only the invariant parts moved out.

</details>

---

## Snippet 7 — The trap

```python
# Python — processing a small set of payment providers at startup
def healthcheck(providers):           # providers = the 3 payment gateways we support
    statuses = {}
    for p in providers:
        statuses[p.name] = p.ping()    # one network call per provider
    return statuses
```

> Is there an N+1? Should you "fix" it?

<details>
<summary>Answer</summary>

**No — this is the trap. Leave it.** It *looks* like an N+1 (a network call per item in a loop), but:

- **`n` is tiny and bounded** — there are exactly 3 providers, fixed by the business, not growing with data. Three sequential 20 ms pings is ~60 ms, below the noise floor.
- **There's no batch endpoint** — each provider is a *different* third party; "ping all providers in one call" isn't a thing. You can't coalesce calls to unrelated services.
- **Per-item is semantically required** — a healthcheck must hit *each* provider independently; that's the point.

"Fixing" this by adding batching machinery would be a [premature optimization](../01-premature-optimization-traps/find-bug.md): more complexity, zero measurable gain, and there's nothing to batch *to*. The most you'd do — if 3 became 30 and latency mattered — is **bounded fan-out** (ping concurrently), and only after measuring.

> The lesson: N+1 is defined by *expensive per-item work that should be done once*. When `n` is small and fixed, no batch target exists, and per-item is required, there's no N+1 to fix. Recognizing the non-bug is as much a skill as spotting the bug.

</details>

---

## What These Snippets Teach

| Snippet | Where the N+1 hid | The lesson |
|---|---|---|
| 1 | In plain sight (×2) | Count *every* call in the body, not just one |
| 2 | Behind a lazy getter | `entity.getX()` can be a query — detect with a counter |
| 3 | Inside a helper | A helper in a loop is a suspect; open it |
| 4 | In a `@property` + double access | Lazy props hide I/O; repeated access multiplies it |
| 5 | A scan-in-loop (`n×m`) | N+1 also lives in CPU; a set is the cure |
| 6 | Invariant recomputed | Hoist what doesn't depend on the item |
| 7 | **Nowhere — it's correct** | Small fixed `n` + no batch target + required per-item = not a bug |

The reviewer's instinct: **find the expensive thing done once per item** — and equally, **know when leaving it alone is right.**

---

## Related Topics

- [N+1 in Code → tasks.md](tasks.md) — build the cures these snippets call for.
- [N+1 in Code → senior.md](senior.md) — detecting the hidden N+1s (Snippets 2–4) with query counters and traces.
- [N+1 in Code → professional.md](professional.md) — the trade-offs behind the trap (Snippet 7).
- [Wrong Data Structure → find-bug.md](../04-wrong-data-structure/find-bug.md) — the scan-in-loop overlap (Snippet 5).
- [Premature Optimization Traps → find-bug.md](../01-premature-optimization-traps/find-bug.md) — why "fixing" Snippet 7 would be the real mistake.
- The `database-performance`, `big-o-analysis`, and `caching-strategies` skills.
