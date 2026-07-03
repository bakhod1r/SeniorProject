# Pagination and Filtering — Middle

At the **middle** tier the question shifts from *"what is a page?"* to *"how does the database actually produce one, and why does the obvious approach fall apart under real load and concurrent writes?"* This file walks the mechanics: how `LIMIT/OFFSET` executes, why deep pages get slow and inconsistent, how keyset (cursor) pagination fixes both, how to encode an opaque cursor, and how to design filter/sort parameters that stay stable and bounded.

## Table of contents

1. [Offset/limit: the mechanics](#1-offsetlimit-the-mechanics)
2. [Why deep offset degrades](#2-why-deep-offset-degrades)
3. [Keyset (cursor) pagination mechanically](#3-keyset-cursor-pagination-mechanically)
4. [Stable sort and tie-breaking](#4-stable-sort-and-tie-breaking)
5. [Encoding an opaque cursor](#5-encoding-an-opaque-cursor)
6. [Tracing a keyset request → next cursor](#6-tracing-a-keyset-request--next-cursor)
7. [Filtering and sorting parameter design](#7-filtering-and-sorting-parameter-design)
8. [The total-count problem](#8-the-total-count-problem)
9. [Consistency under concurrent inserts](#9-consistency-under-concurrent-inserts)
10. [Comparison: offset vs keyset vs seek](#10-comparison-offset-vs-keyset-vs-seek)

---

## 1. Offset/limit: the mechanics

The classic page request maps directly to SQL:

```
GET /orders?sort=created_at&order=desc&page=42&size=20
```

```sql
SELECT id, created_at, total
FROM   orders
ORDER  BY created_at DESC
LIMIT  20 OFFSET 820;   -- page 42, size 20  → (42-1)*20 = 820
```

`OFFSET n` tells the database: *produce the sorted result, then skip the first `n` rows and return the next `LIMIT`.* The critical word is **skip** — the engine still has to *generate* those `n` rows in order before it can discard them. It cannot jump directly to row 820 unless something (an index counting rows, which standard B-trees do not provide) lets it.

`page` + `size` is a client-friendly surface, but under the hood it is pure `OFFSET/LIMIT`, and it inherits every weakness of it.

---

## 2. Why deep offset degrades

Consider the same query at `page=50000` → `OFFSET 999980`. Even with a perfect index on `created_at`, the plan is:

1. Walk the `created_at` index in order.
2. Fetch/count rows one by one until 999,980 have been passed.
3. Emit the next 20.

The cost is **O(offset + limit)**, not O(limit). The work grows linearly with how deep you page. Page 1 touches ~20 rows; page 50,000 touches ~1,000,000. The rows you paid to read are thrown away — this is the **scan-and-discard** tax.

```
offset=0      → read 20,   return 20    (cheap)
offset=1000   → read 1020, return 20
offset=999980 → read 1M,   return 20    (a full-ish scan for one page)
```

Two consequences:

- **Latency climbs with page depth** — deep pages can take seconds and blow your latency budget.
- **It invites abuse** — an attacker (or a naive crawler) requesting `page=1000000` forces a near-full scan per call.

This is why mature APIs either cap the maximum offset or, better, avoid offset entirely for large collections.

---

## 3. Keyset (cursor) pagination mechanically

Keyset pagination (also called *cursor* or *seek* pagination) replaces "skip N rows" with "start *after* the last row I saw." Instead of an offset, the client sends the **sort key value(s) of the last row** on the previous page. The next page is a range predicate:

```sql
SELECT id, created_at, total
FROM   orders
WHERE  (created_at, id) < ('2026-06-12 09:31:00', 84213)   -- DESC → "<"
ORDER  BY created_at DESC, id DESC
LIMIT  20;
```

Read `(created_at, id) < (last_val, last_id)` as **row-value (tuple) comparison**: it selects rows whose `created_at` is earlier, *or* equal `created_at` but a smaller `id`. That tuple predicate is exactly "everything strictly after the cursor in the sort order."

Why this is fast: with a composite index on `(created_at DESC, id DESC)`, the database **seeks** directly to the cursor position in the B-tree and reads forward `LIMIT` rows. Cost is **O(limit)** regardless of depth — page 1 and page 50,000 cost the same. Nothing is scanned-and-discarded.

The trade-off: you can only move **relative** to a known row (next/previous). There is no "jump to page 500" because there is no offset to compute — which for infinite-scroll and API cursors is exactly the access pattern you want anyway.

---

## 4. Stable sort and tie-breaking

Keyset correctness depends on a **total order**: every row must have a unique position. If you paginate on `created_at` alone and two orders share the same timestamp, `WHERE created_at < :last` will either **skip** rows sharing the boundary value or **duplicate** them, depending on which side of the comparison they land.

The fix is to append a **unique tie-breaker** (typically the primary key) to both the `ORDER BY` and the cursor predicate:

```sql
ORDER BY created_at DESC, id DESC        -- id makes the order total
WHERE  (created_at, id) < (:last_created_at, :last_id)
```

Now the `(created_at, id)` tuple is unique, so the boundary is unambiguous — no row can be on both sides. **Rule: the sort key used for pagination must end in a unique column.** The same discipline applies to offset pagination (an unstable sort makes page boundaries non-deterministic across queries), but keyset makes the requirement non-negotiable because the cursor *is* the sort-key value.

Also ensure your index column order matches the `ORDER BY` (including direction) so the engine can seek rather than sort.

---

## 5. Encoding an opaque cursor

Never expose raw column values (`?after_created_at=...&after_id=...`) in the API. Instead, serialize the cursor state and hand the client a single **opaque token**. Clients must treat it as a black box they echo back — they cannot construct or mutate it.

```
cursor state  = { "k": "2026-06-12T09:31:00Z", "id": 84213, "dir": "next" }
JSON          → {"k":"2026-06-12T09:31:00Z","id":84213,"dir":"next"}
base64url      → eyJrIjoiMjAyNi0wNi0xMlQwOTozMTowMFoiLCJpZCI6ODQyMTMsImRpciI6Im5leHQifQ
```

```
GET /orders?sort=created_at&order=desc&limit=20
             &cursor=eyJrIjoiMjAyNi0wNi0xMlQwOTozMTowMFoi...
```

Benefits of opacity:

- **Encapsulation** — you can change the internal cursor shape (add columns, switch sort key, add a version tag) without breaking clients.
- **Validation** — the server decodes, and can reject tampered or stale cursors (e.g. one whose sort field no longer matches the request).
- **Tamper resistance** — for sensitive APIs, sign the payload (HMAC) so a client cannot forge a cursor pointing at arbitrary data. Base64 alone is encoding, not protection.

Guardrail: bind the cursor to the request's sort/filter. If a client sends a cursor built for `sort=created_at` alongside `sort=total`, reject it (`400`) — silently mixing them produces wrong results.

---

## 6. Tracing a keyset request → next cursor

The sequence below traces one page: the server decodes the incoming cursor, builds the tuple predicate, seeks in the index, and mints the next cursor from the last row returned.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant S as API server
    participant DB as Database (index on created_at,id)

    C->>S: GET /orders?limit=20&cursor=eyJr...
    Note over S: base64url-decode → {k:"2026-06-12T09:31:00Z", id:84213}
    Note over S: validate cursor matches sort/filter of request
    S->>DB: SELECT ... WHERE (created_at,id) < ('...09:31',84213)<br/>ORDER BY created_at DESC, id DESC LIMIT 21
    Note over DB: SEEK to cursor position in composite index,<br/>read forward — O(limit), no scan-and-discard
    DB-->>S: 21 rows (20 to return + 1 probe for has_next)
    Note over S: has_next = (rows == 21); drop the 21st<br/>last = 20th row → build next cursor from its (created_at,id)
    Note over S: next = base64url({k:last.created_at, id:last.id})
    S-->>C: 200 { data:[20 items], page_info:{ next_cursor, has_next } }
    Note over C: to page again, echo next_cursor unchanged
```

Two mechanics worth naming:

- **Over-fetch by one** — requesting `LIMIT n+1` lets the server know whether a further page exists (`has_next`) without a separate `COUNT`. Return `n`, use the `(n+1)`th only as a probe.
- **Next cursor is derived from data** — it is the sort-key tuple of the last returned row, not an incremented counter. This is what makes it robust to inserts (see §9).

---

## 7. Filtering and sorting parameter design

Pagination rarely travels alone; clients also narrow and reorder. Design these as a **closed, allow-listed** vocabulary, not free-form passthrough.

**Filtering.** Expose a fixed set of filterable fields, each with an explicit set of operators:

```
GET /orders?status=shipped&total[gte]=100&created_at[lt]=2026-07-01
```

- **Allow-list fields.** Only columns you intend to support (and ideally that are indexed for the operator used). Anything else → `400`, never silently ignored.
- **Bound operators per field.** `status` might allow only `eq`/`in`; `total` and `created_at` allow range operators (`gte`, `lte`, `lt`, `gt`). Publish the matrix.
- **Always parameterize.** Filter values go into bound parameters (`WHERE status = $1`), never string-concatenated — this is the SQL-injection boundary.
- **Combine with AND** by default; if you support `OR` or nested logic, keep it explicit and shallow.

**Sorting.** Accept a small allow-list of sortable fields plus a direction, and map them to indexed columns:

```
?sort=created_at&order=desc      or      ?sort=-created_at   (leading '-' = desc)
```

- Reject unknown sort fields (`400`). Never interpolate the client's sort string into the query.
- The chosen sort field must be part of a usable index **together with the tie-breaker**, or keyset pagination cannot seek.
- Changing the sort invalidates any existing cursor — the cursor encodes the sort key it was built for.

The pagination, filter, and sort parameters together define the query; the cursor is only valid for one fixed combination of the three.

---

## 8. The total-count problem

Clients love `"total": 48213` so they can render "Page 42 of 2411." The problem: on a filtered collection, an exact count is `SELECT COUNT(*) FROM orders WHERE <filters>` — which, unlike the page query, **cannot stop early**. It must evaluate the predicate over the entire matching set, an O(N) scan that often costs more than the page itself and gets slower as the table grows.

Options, from cheapest to most expensive:

- **Omit it.** Return `has_next`/`has_prev` (from the over-fetch-by-one trick) instead of a total. This is the norm for cursor APIs and infinite scroll — the UI never needed the exact number.
- **Approximate it.** Use planner statistics (`reltuples` in Postgres, `EXPLAIN` row estimates) for a "≈ 48,000 results" label. Cheap, good enough for display, wrong for pagination math.
- **Cache it.** Compute periodically and serve a slightly stale total for common/unfiltered queries.
- **Exact, on demand only.** Support it as an opt-in flag (`?with_total=true`) so the expensive count is paid only when a client truly needs it — and document that it may be capped or timed out.

Note that keyset pagination and exact `total`/`page X of Y` are philosophically at odds: keyset has no page numbers. If the product genuinely needs jump-to-page-500 with a live total, that is an offset-shaped requirement — decide deliberately (senior tier explores this trade).

---

## 9. Consistency under concurrent inserts

This is where the two approaches diverge most sharply. Real collections change *between* page requests — new rows are inserted, old ones deleted.

**Offset drifts.** `OFFSET` is a positional index into a *live* result set. If a new row is inserted ahead of the current position between fetching page 1 and page 2:

```
Fetch page 1 (offset 0, 20 rows): rows A..T
   ← a new row inserted at the top (sorts before A)
Fetch page 2 (offset 20):         the insert pushed everything down by one
                                   → row T reappears as the first row of page 2  (DUPLICATE)
```

A deletion produces the mirror problem — everything shifts up, and one row is **skipped** entirely, never shown. So under writes, offset pagination silently yields duplicates and gaps. The user scrolling a busy feed sees the same item twice or misses one.

**Keyset is stable.** The cursor is anchored to an actual row's sort-key value, not a count. "Give me rows after `(created_at, id) = (T)`" returns the correct next window no matter how many rows were inserted before `T` in the meantime — those inserts are simply outside the requested range. A row inserted *after* the cursor will correctly appear on a later page; a row inserted *before* it doesn't shift the window. No duplicates, no skips from concurrent inserts.

Two caveats to state plainly:

- Keyset guarantees **no dupes/skips from inserts before the cursor**, not a frozen snapshot. A row inserted *within* the not-yet-read range will legitimately appear when you reach it (usually desirable). If you need a true point-in-time view, that requires a snapshot mechanism (senior tier).
- If the row a cursor points at is **deleted**, keyset still works — the tuple comparison is a *value* comparison, not a lookup, so pagination continues from the right position even though that exact row is gone.

---

## 10. Comparison: offset vs keyset vs seek

("Keyset" and "seek" are often used interchangeably; here *seek* denotes the hybrid where you keyset for depth but expose limited relative jumps.)

| Property | Offset / Limit | Keyset (cursor) | Seek / hybrid |
|---|---|---|---|
| Deep-page cost | O(offset + limit) — scan & discard | O(limit) — index seek | O(limit) for depth |
| Latency vs depth | grows linearly | flat | flat |
| Random access (jump to page N) | Yes (native) | No (relative only) | Limited / approximate |
| Stability under inserts | dupes & skips | stable (no dupes/skips from prior inserts) | stable |
| Requires unique tie-breaker | recommended | **required** | required |
| Exact total / "page X of Y" | natural fit | not native | not native |
| Cursor opacity | n/a (page number) | opaque token | opaque token |
| Best for | small/bounded sets, admin tables, jump-to-page | large collections, feeds, infinite scroll, public APIs | large sets needing *some* jumping |

**Default guidance:** use keyset for any collection that can grow large or is written concurrently (feeds, event logs, public list endpoints). Reserve offset for small, bounded, or human-browsed tables where jump-to-page is a genuine requirement — and even then, cap the maximum offset to prevent scan-and-discard abuse.

---

*Next step:* [Pagination and Filtering — Senior](senior.md)
