# N+1 in Code — Senior Level

> **Category:** [Performance Anti-Patterns](../README.md) → **N+1 in Code** — *per-item work in a loop that should have been done once.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Why N+1 Hides in a Real System](#why-n1-hides-in-a-real-system)
4. [Detecting It: Counters, Spans, Logs](#detecting-it-counters-spans-logs)
5. [The Guard Test: Assert ≤1 Query](#the-guard-test-assert-1-query)
6. [The Dataloader Pattern: Batching Without Rewriting Callers](#the-dataloader-pattern-batching-without-rewriting-callers)
7. [The Readability vs Batching Trade-off](#the-readability-vs-batching-trade-off)
8. [Where It Hides](#where-it-hides)
9. [Common Mistakes](#common-mistakes)
10. [Test Yourself](#test-yourself)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Finding and killing N+1 across a system you didn't fully write — and keeping it dead.**

A junior writes an N+1; a senior *inherits forty of them* spread across services, hidden behind getters, ORM relations, and innocent-looking helper functions. The hard part at this level isn't the cure — `middle.md` covered batch/preload/hoist/set. The hard part is **finding** N+1 in code where the expensive call is invisible at the call site, and **preventing regressions** once you've fixed it.

This file is about three skills:

1. **Detection** — instrumenting the system so N+1 *announces itself* (query counters, tracing spans, call-count logging in tests).
2. **Structural batching** — the **dataloader** pattern, which batches transparently so callers keep their natural per-item shape while the I/O happens once.
3. **Regression-proofing** — a test that fails the build if a code path's query count exceeds a threshold, so a fixed N+1 stays fixed.

> **The senior insight:** N+1 is an *emergent* property of how components compose, not a property of one function. A loop here calls a helper there that lazily loads a relation — no single file looks wrong. You catch it by **observing the system's I/O**, not by reading code. Make the invisible visible, then it's easy.

---

## Prerequisites

- **Required:** `junior.md` and `middle.md` — all four shapes and their cures.
- **Required:** Familiarity with an ORM's lazy loading, request tracing/spans, and writing tests with mocks/spies.
- **Helpful:** The `database-performance` skill (ORM-level N+1 detection) and `observability-stack` (spans, metrics).
- **Helpful:** You've debugged a "mysteriously slow endpoint" that turned out to fire hundreds of queries.

---

## Why N+1 Hides in a Real System

The four shapes from `middle.md` are obvious when the expensive call is right there in the loop. In a real codebase it almost never is. It's wrapped:

```java
// This loop looks O(n) and innocent. Each getDepartment() secretly fires a query.
for (Employee e : team.getMembers()) {     // getMembers() lazy-loaded a list (query 1)
    String dept = e.getDepartment().getName();   // getDepartment() = +N queries
    report.add(e.getName() + ": " + dept);
}
```

Nothing in this loop *says* "database call." `getDepartment()` reads like a field access. The N+1 is an artifact of the ORM's lazy-loading configuration two files away. This is why **reading code doesn't reliably find N+1** — the cost is hidden behind an abstraction designed to hide it. You need the system to *report* its I/O.

---

## Detecting It: Counters, Spans, Logs

Three layers of detection, cheapest first.

**1. A request-scoped query counter.** Wrap your DB driver/ORM to count queries per request and log a warning past a threshold. This is the single highest-leverage detector.

```python
# Python — a counting wrapper that flags suspicious per-request query counts.
class CountingCursor:
    def __init__(self, inner, counter):
        self._inner, self._counter = inner, counter
    def execute(self, sql, params=None):
        self._counter.n += 1
        return self._inner.execute(sql, params)

# in a request middleware:
counter = QueryCounter()
process_request(...)
if counter.n > 20:
    log.warning("possible N+1: %d queries on %s", counter.n, request.path)
```

**2. Tracing spans.** With distributed tracing, an N+1 is *unmistakable* on a flame graph: a row of dozens of identical sibling spans (`SELECT * FROM users WHERE id = ?`), one per item, stacked end to end. The visual is the diagnosis.

```mermaid
gantt
    title Trace of an N+1 endpoint (each bar = one query)
    dateFormat X
    axisFormat %s
    section handler
    findOrders        :0, 1
    getUser #1        :1, 2
    getUser #2        :2, 3
    getUser #3        :3, 4
    getUser ...×N     :4, 9
```

A wall of identical sibling spans = N+1. After batching, those collapse into one `WHERE id IN (...)` span. The `observability-stack` skill covers wiring this up.

**3. Call-count logging in tests.** The detector that *stays*: assert the count in a test so a regression breaks the build (next section).

> **Detection beats inspection.** A grep for "query in loop" misses every lazy-load and helper-wrapped N+1. A query counter catches *all* of them because it observes behavior, not syntax. Instrument once; catch the whole class forever.

---

## The Guard Test: Assert ≤1 Query

The durable fix isn't just batching the call — it's a test that **fails if the query count regresses**. This freezes the win. Someone "innocently" adds a getter call inside the loop six months later → the test goes red in CI.

```go
// Go — a spy DB that counts calls; the test asserts the batched path stays batched.
type countingDB struct {
    inner Queryer
    n     int
}
func (c *countingDB) Query(ctx context.Context, q string, args ...any) (Rows, error) {
    c.n++
    return c.inner.Query(ctx, q, args...)
}

func TestEnrichOrders_BatchesUserLookups(t *testing.T) {
    db := &countingDB{inner: testDB(t)}
    svc := NewOrderService(db)

    _, err := svc.EnrichRecent(ctx)   // 50 orders across 8 distinct users
    require.NoError(t, err)

    // 1 query for orders + 1 batched query for users = 2. NOT 1 + 50.
    require.LessOrEqual(t, db.n, 2,
        "expected ≤2 queries; got %d — an N+1 regressed", db.n)
}
```

```python
# Python — same idea with a mock spy and pytest.
def test_enrich_is_batched(mocker):
    spy = mocker.spy(user_service, "get_many")
    per_item = mocker.spy(user_service, "get")     # must NOT be called in a loop
    enrich_orders(make_orders(count=50))
    assert spy.call_count == 1                      # one batch call
    assert per_item.call_count == 0                 # zero per-item calls
```

This test asserts the *shape* (`≤ 2` queries, `0` per-item calls), not a latency number — so it's stable and meaningful. It's the regression-proofing layer the `database-performance` skill recommends for ORM N+1, applied to any expensive boundary.

---

## The Dataloader Pattern: Batching Without Rewriting Callers

Sometimes the per-item call site is *natural* and you don't want to rewrite every caller into "collect keys, bulk fetch, map." This is exactly the problem GraphQL resolvers have: each resolver independently asks for one item's relation. The **dataloader** pattern solves it — callers request items one at a time, but the loader **coalesces** requests within a tick into a single batched fetch, then fans the results back out.

```python
# A minimal dataloader: collect keys during a tick, batch-fetch once, dispatch.
class UserLoader:
    def __init__(self, batch_fn):
        self._batch_fn = batch_fn          # batch_fn(ids) -> {id: user}
        self._queue = []                   # pending (id, future) pairs

    def load(self, user_id):
        fut = Future()
        self._queue.append((user_id, fut))
        return fut                         # caller awaits; we haven't fetched yet

    def dispatch(self):
        ids = list({uid for uid, _ in self._queue})  # distinct keys
        result = self._batch_fn(ids)                 # ONE batched call
        for uid, fut in self._queue:
            fut.set_result(result.get(uid))
        self._queue.clear()
```

Callers write `await loader.load(id)` per item — the readable per-item shape — and the loader turns `N` `load()` calls into **one** `batch_fn` call. The `graphql-schema-design` skill covers this as the canonical fix for resolver N+1. Key properties: **per-request scope** (don't share a loader across requests — stale data), **de-duplication** (distinct keys), and a **cache** within the request so the same key isn't fetched twice.

> **Why dataloader over hand-batching?** Hand-batching forces every call site into the collect-fetch-map shape, which is invasive in deep call trees (resolver → resolver → resolver). Dataloader keeps the call sites simple and centralizes batching in one tested place — readability *and* one round-trip.

---

## The Readability vs Batching Trade-off

Batching is not free in clarity. Compare:

```python
# Readable, per-item — the obvious code, but N+1.
for order in orders:
    order.user = user_repo.get(order.user_id)
```

```python
# Batched — faster, but the data flow is now indirect (collect → fetch → re-stitch).
ids = {o.user_id for o in orders}
users = {u.id: u for u in user_repo.get_many(ids)}
for order in orders:
    order.user = users[order.user_id]
```

The batched version is three steps and a map; the intent ("each order gets its user") is less immediate. The senior judgment:

- **Worth the indirection** when `n` is variable and can be large, or the call crosses a network/DB boundary. The latency win dominates.
- **Not worth it** when `n` is small and fixed, the call is cheap (in-memory), and the readable loop is clearer. Don't obfuscate a 3-iteration loop to save microseconds — that's a [premature optimization](../01-premature-optimization-traps/senior.md).
- **Best of both** when a **dataloader** is available: keep the readable per-item call site *and* get one round-trip.

The decision is the same measure-first discipline as everywhere in this chapter: confirm the N+1 is on a real hot path (counter/trace) before trading readability to fix it.

---

## Where It Hides

A checklist of the camouflage to look behind:

| Hiding spot | The tell |
|---|---|
| **Lazy-loaded ORM relations** | `entity.getX()` that's actually a query; `LAZY` fetch type |
| **Lazy properties / computed getters** | A Python `@property` or Java getter that does I/O on access |
| **Helper functions** | `enrich(item)` called in a loop — the call is *inside the helper* |
| **Recursive traversals** | Loading children per node while walking a tree (N+1 per level) |
| **Serializers / view layers** | A response serializer that fetches a relation per row during render |
| **"Convenience" facades** | A method that looks like one operation but loops internally |

The common thread: an abstraction *designed to hide a call* also hides the N+1. The query counter sees through all of them.

---

## Common Mistakes

1. **Fixing the N+1 you can see, missing the one in the serializer.** You batch the service layer, then the JSON serializer lazily loads a relation per row at render time. Instrument the *whole request*, end to end.
2. **No regression test.** You fix it, it regresses in three sprints when someone adds a getter. Without the query-count guard test, you'll fix the same N+1 twice.
3. **Sharing a dataloader across requests.** A request-scoped loader caches within a request; share it globally and you serve stale data and leak memory. New loader per request.
4. **Batching everything reflexively.** Some per-item calls are genuinely fine (small fixed `n`, cheap call). Confirm the hot path with a trace before adding batching machinery.
5. **Asserting latency instead of count in the guard test.** Latency is flaky in CI. Assert the **query/call count** — it's deterministic and it's what actually regressed.
6. **Trusting the ORM's eager-fetch to scale.** `JOIN FETCH` / eager loading fixes the N+1 but can cause a cartesian explosion or over-fetch. It's a real tool, but verify the row count and payload size (`database-performance`).

---

## Test Yourself

1. You're told an endpoint is slow but every function you read looks `O(n)` and innocent. What's your *first* diagnostic move, and why is reading the code not enough?
2. What does an N+1 look like on a tracing flame graph?
3. Write the assertion (in words) for a guard test that prevents an N+1 regression. Why assert count, not milliseconds?
4. Explain the dataloader pattern in two sentences. What problem does it solve that hand-batching doesn't?
5. Why must a dataloader be scoped per-request rather than shared globally?
6. An ORM offers `JOIN FETCH` to eager-load a relation and kill the N+1. Name one new problem it can introduce.

<details>
<summary>Answers</summary>

1. Instrument the system: turn on a **per-request query/call counter** (or open a trace). Reading code misses N+1 because the expensive call hides behind getters, lazy relations, and helpers — the cost isn't visible at the call site. Behavior-based detection catches the whole class.
2. A **wall of identical sibling spans** — dozens of `SELECT … WHERE id = ?` (or RPC) spans, one per item, stacked end to end under the handler. After batching they collapse to a single `IN (...)` span.
3. "Calling this endpoint/path issues **≤ K queries** (e.g., ≤2) regardless of row count, and makes **zero per-item** fetch calls." Assert the **count**, not latency, because count is deterministic and is exactly the property (`1+N` vs `2`) that regresses; latency is flaky in CI.
4. Callers request one item at a time (`load(id)`), but the loader queues keys within a tick and fetches them all in **one batched call**, then dispatches results back. Unlike hand-batching, it preserves natural per-item call sites in deep call trees (e.g., GraphQL resolvers) — no rewrite of every caller.
5. Per-request scope ensures the loader's within-request cache holds **fresh** data for that request only. A globally shared loader would serve stale results across requests and accumulate keys/memory unbounded.
6. Cartesian/row explosion (a one-to-many `JOIN FETCH` multiplies rows) or **over-fetching** large payloads — trading the N+1 for a single huge, slow query. Verify row count and payload size.

</details>

---

## Cheat Sheet

| Concern | Senior move |
|---|---|
| **Find hidden N+1** | Per-request query/call counter + tracing spans (wall of sibling spans) |
| **Keep it fixed** | Guard test: assert `≤ K` queries / `0` per-item calls — count, not latency |
| **Batch without rewriting callers** | Dataloader: per-request, de-duped, request-scoped cache |
| **Readability trade-off** | Batch when `n` large/variable & crosses a boundary; keep the readable loop when `n` is small & cheap |
| **Where it hides** | Lazy relations, computed getters, helpers, serializers, tree walks |

> **One rule:** *Make the I/O observable (counter/trace), batch the proven hot path (often via dataloader), then lock it with a count-asserting test.*

---

## Summary

- N+1 in a real system is **emergent and hidden** — behind lazy relations, computed getters, helpers, and serializers. Reading code doesn't reliably find it.
- **Detect by observing I/O:** a per-request query/call counter is the highest-leverage tool; tracing shows N+1 as a wall of identical sibling spans.
- **The dataloader pattern** batches transparently — callers keep per-item `load(id)` calls, the loader coalesces them into one fetch — solving resolver-style N+1 without rewriting every call site. Scope it per request, de-dupe keys, cache within the request.
- **Lock the fix** with a guard test that asserts query/call **count** (`≤ K`, deterministic), not latency (flaky).
- Batching trades readability for round-trips; make that trade only on a **confirmed hot path** — same measure-first discipline as the rest of the chapter.
- Next: [`professional.md`](professional.md) — *trade-offs at scale: batch-size limits and pagination, latency vs throughput, the preload-everything memory trap, bounded-concurrency fan-out vs batching, backpressure, and when N small calls are genuinely fine.*

---

## Further Reading

- **Patterns of Enterprise Application Architecture** — Martin Fowler (2002) — *Lazy Load*, *Identity Map*; the architectural roots of N+1 and its cures.
- **Programming Pearls** — Jon Bentley (2nd ed., 1999) — instrumentation and measuring where the time goes before optimizing.
- **GraphQL & the dataloader pattern** — Facebook's `dataloader` (Lee Byron) — the canonical batching/caching loader; mirror it in any language.
- The `database-performance`, `observability-stack`, `graphql-schema-design`, and `caching-strategies` skills — ORM N+1 detection, tracing, resolver batching, and `MGET`.

---

## Related Topics

- [N+1 in Code → professional.md](professional.md) — batch-size limits, fan-out concurrency, the preload memory trap, backpressure.
- [N+1 in Code → middle.md](middle.md) — the four shapes and their cures (the batching this file detects and guards).
- [Wrong Data Structure → senior.md](../04-wrong-data-structure/senior.md) — scan-in-loop as both N+1 and a structure choice.
- [Premature Optimization Traps → senior.md](../01-premature-optimization-traps/senior.md) — confirm the hot path before trading readability for batching.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Split Loop and pipeline refactors used when batching.
