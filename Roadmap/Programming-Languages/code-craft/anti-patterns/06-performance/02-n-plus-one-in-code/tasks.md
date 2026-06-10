# N+1 in Code — Practice Tasks

> **Category:** [Performance Anti-Patterns](../README.md) → **N+1 in Code** — *per-item work in a loop that should have been done once.*

---

These are **build-the-cure** exercises. Each gives you an N+1 (or its setup) and asks you to apply the right move — batch, preload, hoist, set-membership, or a guard test. Every solution states the **call/comparison count before and after**, because that deterministic number is how you *prove* the N+1 is gone, not merely sped up.

> **How to use this file:** write your solution *and predict the call-count drop* before expanding. The gap between your prediction and the measured count is where the learning is.

---

## Table of Contents

| # | Exercise | Cure | Lang |
|---|---|---|---|
| 1 | [Convert per-item calls to a batch](#exercise-1--convert-per-item-calls-to-a-batch) | Bulk call + de-dupe | Go |
| 2 | [Preload a lookup map before a loop](#exercise-2--preload-a-lookup-map-before-a-loop) | Preload (Identity Map) | Java |
| 3 | [Hoist the loop-invariant work](#exercise-3--hoist-the-loop-invariant-work) | Hoist | Python |
| 4 | [Replace a nested-loop scan with a set](#exercise-4--replace-a-nested-loop-scan-with-a-set) | Set membership | Go |
| 5 | [Write a test that asserts the call count](#exercise-5--write-a-test-that-asserts-the-call-count) | Guard test | Python |
| 6 | [Chunk an oversized batch](#exercise-6--chunk-an-oversized-batch) | Paginated batching | Go |

---

## Exercise 1 — Convert per-item calls to a batch

**Cure:** bulk call + key de-duplication. **Goal:** turn `1 + N` RPCs into `2`. **Constraint:** identical enrichment result; fetch each distinct user only once.

```go
// Before — one GetUser RPC per order. 400 orders, 12 ms each ≈ 4.8 s.
func enrich(ctx context.Context, orders []Order) error {
    for i := range orders {
        u, err := userClient.GetUser(ctx, orders[i].UserID)  // +N RPCs
        if err != nil {
            return err
        }
        orders[i].User = u
    }
    return nil
}
```

Write the batched version (assume `userClient.GetUsers(ctx, []int64) ([]User, error)` exists).

<details>
<summary>Solution</summary>

```go
// After — 1 batched RPC regardless of order count.
func enrich(ctx context.Context, orders []Order) error {
    seen := make(map[int64]struct{})
    ids := make([]int64, 0, len(orders))
    for _, o := range orders {
        if _, ok := seen[o.UserID]; !ok {     // de-dupe: distinct ids only
            seen[o.UserID] = struct{}{}
            ids = append(ids, o.UserID)
        }
    }

    users, err := userClient.GetUsers(ctx, ids)  // 1 batched RPC
    if err != nil {
        return err
    }
    byID := make(map[int64]User, len(users))
    for _, u := range users {
        byID[u.ID] = u
    }

    for i := range orders {
        orders[i].User = byID[orders[i].UserID]  // in-memory, O(1)
    }
    return nil
}
```

**Call count: `N` → `1`.** For 400 orders referencing 40 distinct users, the before makes 400 RPCs (~4.8 s); the after makes **1** (~12 ms server-side). The de-dupe is essential — without it you'd pass 400 ids (with duplicates) instead of 40. The per-item work that remains (`byID[...]`) is an `O(1)` map lookup, not a round-trip.

</details>

---

## Exercise 2 — Preload a lookup map before a loop

**Cure:** preload into a map (Fowler's Identity Map, by hand). **Goal:** turn `1 + N` queries into `2`. **Constraint:** no batch *method* exists, but you can widen a query to `WHERE id IN (...)`.

```java
// Before — 1 query for products + N queries for categories.
List<Product> products = productRepo.findAll();             // 1
for (Product p : products) {
    Category c = categoryRepo.findById(p.getCategoryId());  // +N
    p.setCategory(c);
}
```

Rewrite assuming `categoryRepo.findAllById(Collection<Long>)` runs one `WHERE id IN (...)` query.

<details>
<summary>Solution</summary>

```java
// After — preload all needed categories once; index by id.
List<Product> products = productRepo.findAll();             // 1
Set<Long> ids = products.stream()
        .map(Product::getCategoryId)
        .collect(Collectors.toSet());                       // distinct keys

Map<Long, Category> categories = categoryRepo.findAllById(ids).stream()  // 1
        .collect(Collectors.toMap(Category::getId, c -> c));

for (Product p : products) {
    p.setCategory(categories.get(p.getCategoryId()));       // in-memory
}
```

**Query count: `1 + N` → `2`.** With 1,000 products spanning 30 categories, the before runs 1,001 queries; the after runs 2 (and fetches only 30 category rows, not 30,000). Collecting into a `Set` first de-dupes the keys, so the `IN (...)` list stays at 30, not 1,000. This is the Identity Map idea: load each entity once, resolve references against the map.

</details>

---

## Exercise 3 — Hoist the loop-invariant work

**Cure:** hoist invariant computation out of the loop. **Goal:** stop recomputing a value that doesn't depend on the item. **Constraint:** identical output; only move work that's truly loop-invariant.

```python
# Before — recompiles the regex AND reloads the config every iteration.
import re

def filter_messages(messages, config):
    out = []
    for m in messages:
        pattern = re.compile(config.get_banned_regex())   # recompiled N times
        max_len = config.get_max_length()                 # re-fetched N times
        if len(m.text) <= max_len and not pattern.search(m.text):
            out.append(m)
    return out
```

<details>
<summary>Solution</summary>

```python
# After — compute the loop-invariants ONCE, before the loop.
def filter_messages(messages, config):
    pattern = re.compile(config.get_banned_regex())   # once
    max_len = config.get_max_length()                 # once
    return [m for m in messages
            if len(m.text) <= max_len and not pattern.search(m.text)]
```

**Regex compilations: `N` → `1`; config reads: `N` → `1`.** For 100k messages this is 100k regex compilations down to one. The body still runs `n` times (the `len`/`search` are genuinely per-item) — only the *invariant* parts moved out. **Watch for the trap:** anything that depends on `m` (the loop variable) cannot be hoisted; moving it out would be a correctness bug, not an optimization.

</details>

---

## Exercise 4 — Replace a nested-loop scan with a set

**Cure:** set membership. **Goal:** turn `O(n × m)` into `O(n + m)`. **Constraint:** same filtered result.

```go
// Before — for each event, linearly scan the blocked-IP slice. O(n × m).
func allowedEvents(events []Event, blockedIPs []string) []Event {
    var out []Event
    for _, e := range events {                  // n
        blocked := false
        for _, ip := range blockedIPs {         // × m
            if e.SourceIP == ip {
                blocked = true
                break
            }
        }
        if !blocked {
            out = append(out, e)
        }
    }
    return out
}
```

<details>
<summary>Solution</summary>

```go
// After — build the blocked set once; membership is O(1). Total O(n + m).
func allowedEvents(events []Event, blockedIPs []string) []Event {
    blocked := make(map[string]struct{}, len(blockedIPs))
    for _, ip := range blockedIPs {             // m, once
        blocked[ip] = struct{}{}
    }
    out := make([]Event, 0, len(events))
    for _, e := range events {                  // n
        if _, isBlocked := blocked[e.SourceIP]; !isBlocked {  // O(1)
            out = append(out, e)
        }
    }
    return out
}
```

**Comparisons: `n × m` → `n + m`.** With 50k events and 10k blocked IPs, the before does up to 500,000,000 comparisons; the after does ~60,000 — a ~8,000× drop. This is the N+1 shape (per-item linear scan) and a [Wrong Data Structure](../04-wrong-data-structure/tasks.md) bug (slice where a set belongs) at once — one change cures both.

</details>

---

## Exercise 5 — Write a test that asserts the call count

**Cure:** a guard test that locks the batched shape. **Goal:** a test that fails if an N+1 regresses. **Constraint:** assert *count*, not latency.

You've batched `enrich_orders` to call `user_service.get_many(ids)` once and never `user_service.get(id)` per item. Write a test that protects this.

<details>
<summary>Solution</summary>

```python
# Guard test — asserts the SHAPE: one batch call, zero per-item calls.
def test_enrich_orders_is_batched(mocker):
    batch = mocker.spy(user_service, "get_many")   # the batched call
    per_item = mocker.spy(user_service, "get")     # must NOT be used in a loop

    orders = make_orders(count=200)                # 200 orders, 25 distinct users
    enrich_orders(orders)

    assert batch.call_count == 1, \
        f"expected 1 batched call, got {batch.call_count}"
    assert per_item.call_count == 0, \
        f"N+1 regressed: {per_item.call_count} per-item calls"
    # Optional: prove de-dupe — the batch received distinct ids only.
    (ids_arg,), _ = batch.call_args
    assert len(ids_arg) == len(set(ids_arg)) == 25
```

**Why this works.** The assertions pin the **algorithmic shape** — `1` batch call, `0` per-item calls — independent of machine or network. The test stays green at any row count and goes **red the instant** someone reintroduces `user_service.get(id)` inside the loop. Asserting *count* (deterministic) rather than *milliseconds* (flaky in CI) is what makes this a durable regression guard. The optional de-dupe check catches the "passed 200 ids instead of 25" mistake from Exercise 1.

</details>

---

## Exercise 6 — Chunk an oversized batch

**Cure:** paginated (chunked) batching. **Goal:** one `IN (...)` would exceed the parameter limit; split it. **Constraint:** same result; no query exceeds the chunk size.

```go
// Before — one giant IN with potentially 100k+ ids: hits the param cap, errors.
func loadUsers(ctx context.Context, ids []int64) (map[int64]User, error) {
    users, err := userRepo.FindByIDs(ctx, ids)  // breaks if len(ids) > ~65k
    if err != nil {
        return nil, err
    }
    byID := make(map[int64]User, len(users))
    for _, u := range users {
        byID[u.ID] = u
    }
    return byID, nil
}
```

Rewrite so no single query exceeds 1,000 ids.

<details>
<summary>Solution</summary>

```go
// After — chunked batching: O(n / chunk) queries, none over the limit.
func loadUsers(ctx context.Context, ids []int64) (map[int64]User, error) {
    const chunk = 1000
    byID := make(map[int64]User, len(ids))
    for start := 0; start < len(ids); start += chunk {
        end := min(start+chunk, len(ids))
        users, err := userRepo.FindByIDs(ctx, ids[start:end])  // 1 query per chunk
        if err != nil {
            return nil, err
        }
        for _, u := range users {
            byID[u.ID] = u
        }
    }
    return byID, nil
}
```

**Query count: `1` impossible (errors) → `ceil(n/1000)` valid queries.** For 50,000 ids: **50** queries, each safely under the parameter cap — not 50,001 (N+1) and not one illegal 50k-parameter statement. Chunked batching is the middle of the spectrum between N+1 and "one giant call." Tune `chunk` by benchmarking (typically 500–2,000); the optimum depends on row width and driver overhead. For best results, de-dupe `ids` before chunking (Exercise 1's lesson).

</details>

---

## The Pattern Behind All Six

Every exercise answers one question: **"What expensive thing am I doing once per item that I could do once for all items?"**

| Move | Turns | Into | Exercise |
|---|---|---|---|
| Bulk call + de-dupe | `N` RPCs | `1` RPC | 1 |
| Preload into map | `1+N` queries | `2` queries | 2 |
| Hoist invariant | `N` computations | `1` | 3 |
| Set membership | `n×m` comparisons | `n+m` | 4 |
| Guard test | (locks the win) | red on regression | 5 |
| Chunked batching | one illegal giant call | `n/chunk` valid calls | 6 |

The deterministic before/after **count** is the proof. If the count didn't drop from `O(n)` to `O(1)` (or `O(n/chunk)`), you didn't fix the N+1 — you just moved it.

---

## Related Topics

- [N+1 in Code → middle.md](middle.md) — the four shapes worked through (the cures practiced here).
- [N+1 in Code → senior.md](senior.md) — detection and the guard-test discipline behind Exercise 5.
- [N+1 in Code → find-bug.md](find-bug.md) — spot the hidden N+1 (the counterpart skill).
- [Wrong Data Structure → tasks.md](../04-wrong-data-structure/tasks.md) — the set-vs-scan exercise behind Exercise 4.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Split Loop, hoist invariant, replace loop with pipeline.
- The `database-performance`, `big-o-analysis`, and `caching-strategies` skills.
