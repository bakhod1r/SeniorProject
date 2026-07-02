# Pull CDN — Professional

A pull CDN is, mechanically, a distributed HTTP cache that populates itself lazily
from an origin on the first request for each object. At the *professional* tier the
interesting questions are not "what is a CDN" but "given the HTTP caching model as
specified, can I reason **formally** about when an edge serves a cached body, how it
computes an object's age, when it revalidates, and what hit ratio a finite cache
achieves against a given working set?" This document works through the RFC 9111
freshness model, the age-calculation pipeline (with the exact formula and a worked
number), conditional-request revalidation with strong vs weak validators (RFC 9110),
the stale-serving extensions (RFC 5861), `Vary` and secondary cache keys, and a
predictive hit-ratio / origin-QPS model.

---

## Table of Contents

1. [The Pull CDN as an RFC-9111 Cache](#1-the-pull-cdn-as-an-rfc-9111-cache)
2. [Freshness Lifetime — Where It Comes From](#2-freshness-lifetime--where-it-comes-from)
3. [Current Age — The Formula, Worked](#3-current-age--the-formula-worked)
4. [The Freshness / Age Decision, as a State Machine](#4-the-freshness--age-decision-as-a-state-machine)
5. [Revalidation: Conditional Requests, 304, and Validators](#5-revalidation-conditional-requests-304-and-validators)
6. [Strong vs Weak Validators](#6-strong-vs-weak-validators)
7. [stale-while-revalidate and stale-if-error (RFC 5861)](#7-stale-while-revalidate-and-stale-if-error-rfc-5861)
8. [Vary and Secondary Cache Keys](#8-vary-and-secondary-cache-keys)
9. [A Hit-Ratio Model: Working Set, Che's Approximation, Origin QPS](#9-a-hit-ratio-model-working-set-ches-approximation-origin-qps)
10. [Putting It Together — A Worked Capacity Slice](#10-putting-it-together--a-worked-capacity-slice)

---

## 1. The Pull CDN as an RFC-9111 Cache

A pull CDN edge is a *shared cache* in RFC 9111 terminology: one cache instance
serves many users, which changes the rules relative to a browser's *private* cache.
Two consequences matter throughout this document:

- **`s-maxage` and `private` apply.** `Cache-Control: s-maxage=N` sets the freshness
  lifetime for shared caches only and overrides `max-age` and `Expires` for them.
  `Cache-Control: private` forbids a shared cache from storing the response at all —
  which is why user-specific responses must never leak into a pull CDN without an
  explicit key that isolates them.
- **The edge stores a *response*, not a *representation truth*.** Everything it later
  decides — is this fresh, must I revalidate, may I serve it stale — is derived from
  the stored response's headers plus two clocks: when the edge *requested* the object
  and when it *received* it.

The lifecycle of one object through a pull edge:

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant E as Edge (shared cache)
    participant O as Origin
    U->>E: 1. GET /img/hero.jpg
    E-->>U: 2. MISS — nothing stored
    E->>O: 3. GET /img/hero.jpg
    O-->>E: 4. 200 + Cache-Control: s-maxage=600, ETag "v7", Date, Age
    Note over E: 5. store body + headers;<br/>record request_time / response_time
    E-->>U: 6. 200 (from origin)
    U->>E: 7. GET /img/hero.jpg (later)
    Note over E: 8. compute current_age;<br/>compare to freshness_lifetime
    E-->>U: 9. 200 (HIT) with Age: <current_age>
```

Steps 5 and 8 are where the formal model lives: the edge must *record* two timestamps
at store time so that later it can compute `current_age` correctly, including time the
response already spent aging in upstream caches.

---

## 2. Freshness Lifetime — Where It Comes From

RFC 9111 §4.2.1 defines a strict precedence for computing an object's
`freshness_lifetime`. A shared cache (the CDN edge) uses the first of these that is
present:

| Rank | Source | Directive / Header | Applies to | Notes |
|------|--------|--------------------|------------|-------|
| 1 | `s-maxage` | `Cache-Control: s-maxage=N` | **shared caches only** | Overrides `max-age` and `Expires` for the CDN. Ignored by private (browser) caches. |
| 2 | `max-age` | `Cache-Control: max-age=N` | all caches | Overrides `Expires` when both are present. |
| 3 | `Expires` | `Expires: <HTTP-date>` | all caches | `freshness_lifetime = Expires − Date`. Legacy; a malformed or past date means already stale. |
| 4 | Heuristic | *(no explicit freshness)* | all caches | Cache **may** guess. Common: 10% of `(Date − Last-Modified)`, per §4.2.2. Only for cacheable status codes. |

Key precision points:

- `s-maxage`/`max-age`/`Expires` are all **relative to `Date`**, the origin's
  timestamp for when the response was generated — not to the edge's clock. This is why
  a correct implementation stores the origin `Date`.
- `no-store` forbids storage entirely; `no-cache` **permits storage but forbids reuse
  without successful revalidation** — its `freshness_lifetime` is effectively zero,
  every reuse is a conditional round-trip.
- `must-revalidate` changes what happens *after* expiry: a stale response may not be
  served; `stale-while-revalidate`/`stale-if-error` are then disallowed.
- Heuristic freshness is a trap for a pull CDN: an origin that omits `Cache-Control`
  can have its objects cached for hours by the edge's 10%-of-age guess. Professionals
  disable heuristic caching or require explicit directives at the edge.

`freshness_lifetime` alone does not decide reuse. Reuse requires
`current_age < freshness_lifetime` (§4.2). The subtle half is `current_age`.

---

## 3. Current Age — The Formula, Worked

RFC 9111 §4.2.3 defines age precisely so that an object that has *already* been aging
in an upstream cache is not treated as fresh at the edge. The edge records, at the
moment it stores the response:

- **`request_time`** — the edge's clock when it *sent* the request to origin.
- **`response_time`** — the edge's clock when it *received* the full response.

And reads from the response:

- **`age_value`** — the numeric `Age:` header the origin/upstream returned (0 if absent).
- **`date_value`** — the origin's `Date:` header, as a timestamp.

The formula (verbatim structure from §4.2.3):

```
apparent_age      = max(0, response_time − date_value)
response_delay    = response_time − request_time
corrected_age     = age_value + response_delay
corrected_initial_age = max(apparent_age, corrected_age)

resident_time     = now − response_time
current_age       = corrected_initial_age + resident_time
```

- `apparent_age` uses the origin's `Date` and defends against a missing/low `Age`.
- `corrected_age` adds back the network transit time (`response_delay`) to the reported
  upstream age, so we never *undercount* how old the body is.
- `corrected_initial_age` takes the max — the safe (older) of the two estimates.
- `resident_time` is how long the body has sat in *this* edge since storage.

### Worked number

Origin response headers and edge clocks for one object:

| Quantity | Value |
|----------|-------|
| `Date` (origin generated) | `12:00:00` |
| `Age` returned by upstream | `30` s |
| `request_time` (edge sent) | `12:00:04` |
| `response_time` (edge received) | `12:00:06` |
| `now` (later user hit) | `12:03:06` |
| `Cache-Control` | `s-maxage=600` |

Compute:

```
apparent_age          = max(0, 12:00:06 − 12:00:00) = 6 s
response_delay        = 12:00:06 − 12:00:04         = 2 s
corrected_age         = 30 + 2                       = 32 s
corrected_initial_age = max(6, 32)                   = 32 s
resident_time         = 12:03:06 − 12:00:06          = 180 s
current_age           = 32 + 180                      = 212 s
```

`freshness_lifetime = s-maxage = 600 s`. Since `current_age (212) < 600`, the object
is **fresh**: the edge serves the stored body directly, emitting `Age: 212`. Note the
30 s of upstream age is correctly carried forward — a naive `resident_time`-only
implementation would have reported `Age: 180` and served this object ~32 s past its
true expiry near the boundary. The 600 s budget will be exhausted at
`now = 12:00:06 + (600 − 32) = 12:10:14` of resident time.

---

## 4. The Freshness / Age Decision, as a State Machine

Every request against a stored object walks this decision. The distinction between
"fresh → serve", "stale but reusable → serve + async revalidate", and "must go to
origin" is the whole professional model in one diagram.

```mermaid
stateDiagram-v2
    [*] --> Lookup
    Lookup --> Miss: no stored response<br/>(or Vary mismatch)
    Lookup --> Stored: matching stored response
    Stored --> ComputeAge: current_age = corrected_initial_age + resident_time
    ComputeAge --> Fresh: current_age < freshness_lifetime
    ComputeAge --> Stale: current_age >= freshness_lifetime
    Fresh --> ServeHit: 200 + Age header
    Stale --> SWR: within stale-while-revalidate window<br/>and not must-revalidate
    Stale --> Revalidate: otherwise
    SWR --> ServeStale: serve stale now
    ServeStale --> AsyncRevalidate: refresh in background
    Revalidate --> Conditional: send If-None-Match / If-Modified-Since
    Conditional --> Fresh304: origin 304 Not Modified
    Conditional --> Replaced: origin 200 (new body)
    Fresh304 --> ServeHit: reset age, serve stored body
    Miss --> Origin: fetch from origin, store
    Replaced --> Origin
    Origin --> ServeHit
    AsyncRevalidate --> [*]
    ServeHit --> [*]
```

> 🎞️ **See it animated:** [MDN — HTTP caching (interactive diagrams)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)

---

## 5. Revalidation: Conditional Requests, 304, and Validators

When an object is stale and cannot (or should not) be served stale, the edge does not
blindly re-download. It sends a **conditional request** (RFC 9110 §13) so the origin
can answer "still valid, keep your copy" in a few bytes:

- `If-None-Match: "<etag>"` — precondition using the stored `ETag`. The origin returns
  `304 Not Modified` if any listed entity-tag matches the current one.
- `If-Modified-Since: <HTTP-date>` — precondition using the stored `Last-Modified`.
  `ETag` is preferred; `If-Modified-Since` is the fallback when no `ETag` exists.

On **`304 Not Modified`** (RFC 9110 §15.4.5) the origin sends *no body*. The edge:

1. Updates the stored response's headers with those in the 304 (notably a fresh `Date`,
   `Cache-Control`, `Expires`) — this **resets `current_age` toward zero** because
   `resident_time` restarts and `date_value` advances.
2. Serves the previously stored body.

The bandwidth win is the entire point: a 304 is typically a few hundred bytes versus a
multi-megabyte asset. A pull CDN with `no-cache` (or expired) objects and stable
bodies spends most of its origin traffic on cheap 304s, not full transfers.

```mermaid
sequenceDiagram
    autonumber
    participant E as Edge
    participant O as Origin
    Note over E: object stale, ETag "v7" stored
    E->>O: GET /style.css<br/>If-None-Match: "v7"
    alt unchanged
        O-->>E: 304 Not Modified (no body) + new Date/Cache-Control
        Note over E: refresh headers → age resets;<br/>serve stored body
    else changed
        O-->>E: 200 + new body + ETag "v8"
        Note over E: replace stored response
    end
```

---

## 6. Strong vs Weak Validators

RFC 9110 §8.8 distinguishes **strong** and **weak** validators, and this distinction
governs *which* conditional requests are legal and what a match guarantees.

| Property | Strong validator | Weak validator |
|----------|------------------|----------------|
| Syntax | `ETag: "abc"` | `ETag: W/"abc"` (weak prefix) or `Last-Modified` |
| Guarantee | Byte-for-byte identical representation | *Semantically* equivalent (may differ byte-wise) |
| Changes on | Any change to the representation body | Only "significant" changes; equivalent renderings share a tag |
| Usable for | Range requests / `If-Range`, cache validation | Cache validation only — **not** `If-Range` |
| Typical source | Content hash, version id | Timestamp, "good enough" fingerprint |

Precise rules that trip people up:

- **Range/partial-content requires a strong validator.** `If-Range` with a weak
  validator is not allowed to yield a `206 Partial Content`; the origin must return the
  full `200`. This matters for a pull CDN doing range-based large-file delivery: weak
  ETags silently defeat efficient resume/segmented fetches.
- **`Last-Modified` is inherently weak** and has 1-second resolution. Two edits within
  the same second are indistinguishable — an origin that mutates sub-second must ship a
  strong `ETag` or the edge can serve a stale-but-"validated" body.
- **Comparison functions differ.** RFC 9110 defines *strong comparison* (both must be
  strong and equal) and *weak comparison* (equal ignoring the `W/`). `If-None-Match`
  uses weak comparison; `If-Range` uses strong comparison.

Operationally: emit content-addressed **strong ETags** (e.g. a hash of the body) at
origin. It costs a hash on origin but gives the CDN exact revalidation, correct range
support, and immunity to timestamp-resolution bugs.

---

## 7. stale-while-revalidate and stale-if-error (RFC 5861)

RFC 5861 adds two `Cache-Control` extensions that let a shared cache trade a bounded
amount of staleness for lower tail latency and higher availability — both are central
to a well-run pull CDN.

- **`stale-while-revalidate=N`** — for `N` seconds *after* an object becomes stale, the
  edge MAY serve the stale body **immediately** to the user while asynchronously
  revalidating in the background. The user pays zero revalidation latency; the next
  request gets the refreshed copy. This converts a synchronous origin round-trip on the
  request critical path into a background one.
- **`stale-if-error=N`** — for `N` seconds after staleness, if a revalidation attempt
  *fails* (origin 5xx, connection error, timeout), the edge MAY serve the stale body
  rather than propagate the error. This is a graceful-degradation lever: a brief origin
  outage becomes invisible to users for objects that were recently fresh.

Example header a resilient origin ships:

```
Cache-Control: s-maxage=60, stale-while-revalidate=600, stale-if-error=86400
```

Interpretation: fresh for 60 s; for the next 600 s serve-stale-then-refresh
(no user-facing origin latency at the edge); and for a full day, if the origin is
*down*, keep serving the last good copy rather than erroring. `must-revalidate` in the
same response would **disable** both behaviors — the two are mutually exclusive by
intent.

The availability math is why this matters: with `stale-if-error=86400`, an origin
outage of minutes affects only the *newly-published* objects and users hitting a
genuine miss; the long tail of already-cached, recently-fresh objects rides straight
through the outage.

---

## 8. Vary and Secondary Cache Keys

The primary cache key is the request method + effective URI. But a single URL can map
to *multiple* stored representations — gzip vs brotli, English vs French — selected by
request headers. `Vary` (RFC 9110 §12.5.5, RFC 9111 §4.1) tells the cache which request
headers form the **secondary cache key**.

```
Vary: Accept-Encoding
```

means: two requests for the same URL match a stored response only if their
`Accept-Encoding` values match under the cache's normalization. Consequences a
professional must control:

- **Cardinality explosion.** `Vary: User-Agent` is nearly fatal — the UA string is
  effectively unique per client, so every request is a miss and hit ratio collapses.
  Vary only on headers with a *small, normalized* value space (`Accept-Encoding`
  reduced to `gzip`/`br`/identity; `Accept-Language` reduced to a primary tag).
- **`Vary: *`** means the response is *uncacheable by key* — never reusable. Treat as
  effectively no-store for the CDN.
- **Normalization belongs at the edge.** A good pull CDN canonicalizes the varying
  header (sort/dedupe `Accept-Encoding`, collapse `Accept-Language` to `en`/`fr`)
  before forming the secondary key, or the raw header variety fragments the cache.
- **Cookies.** Varying on `Cookie` is almost always wrong for a shared cache — it makes
  responses per-user. Strip cookies at the edge for cacheable static paths instead.

Rule of thumb: the number of stored variants per URL is the product of the distinct
normalized values across all `Vary` headers. Keep that product tiny (2–6), or the cache
degenerates toward miss-per-request.

---

## 9. A Hit-Ratio Model: Working Set, Che's Approximation, Origin QPS

Hit ratio is not a vibe; it is predictable from the request popularity distribution and
the cache size. Two complementary models:

### TTL-driven origin QPS (freshness-limited)

For an object requested at rate `λ` (req/s) that is cacheable with `freshness_lifetime
= T` seconds, an LRU/TTL cache under steady traffic sends at most **one origin fetch per
`T` seconds** for that object (the first request after each expiry). So:

```
origin_QPS ≈ Σ over objects  (1 / T)   [freshness-limited term]
           = (number of distinct cacheable objects) / T   (uniform T)
```

If the CDN fronts `D = 1,000,000` distinct hot objects each with `T = 60 s`, the
*freshness* floor on origin traffic is `D / T = 1,000,000 / 60 ≈ 16,700` origin
fetches/s — independent of user QPS. This is the term you reduce by raising `T` (or
using revalidation so those fetches are cheap 304s).

### Che's approximation (capacity-limited, LRU)

When the cache **cannot hold the whole working set**, misses also come from eviction.
Che's approximation models an LRU cache of `C` objects via a **characteristic time**
`t_C` (the "cache eviction time"): an object survives in cache iff it is re-requested
within `t_C`. For object *i* with request rate `λ_i` (Poisson/IRM assumption), its hit
probability is:

```
h_i = 1 − e^(−λ_i · t_C)
```

and `t_C` is the unique solution of the capacity constraint:

```
Σ_i (1 − e^(−λ_i · t_C)) = C
```

The **overall hit ratio** is the request-weighted average:

```
H = ( Σ_i λ_i · h_i ) / ( Σ_i λ_i )
```

Intuition: popular objects (large `λ_i`) have `h_i → 1`; cold objects (small `λ_i`)
have `h_i → 0`. Under a Zipf popularity law — realistic for web/CDN traffic — a small
`C` covering the head already captures most requests, which is why real CDN hit ratios
sit at 85–98% with caches far smaller than the full catalog.

### Which term dominates?

Total origin traffic ≈ **capacity misses (Che)** + **freshness expirations (TTL)**. For
a cache large enough to hold the hot set, the freshness term dominates and the fix is
longer TTL + cheap revalidation. For an undersized edge, the capacity term dominates and
the fix is more edge storage or better admission (don't cache one-hit-wonders).

---

## 10. Putting It Together — A Worked Capacity Slice

Assume a pull CDN edge in front of an image origin:

| Parameter | Value |
|-----------|-------|
| User request rate at the edge | `λ_total = 50,000` req/s |
| Distinct hot objects | `D = 200,000` |
| Popularity | Zipf(α≈0.9); top 20k objects ≈ 80% of requests |
| Edge cache capacity | `C = 40,000` objects |
| Freshness lifetime | `T = 300 s`, with `stale-while-revalidate=300` |
| Revalidation outcome | mostly `304` (bodies stable) |

**Capacity-limited hit ratio (Che, order-of-magnitude):** `C = 40,000` comfortably
covers the ~20k-object head that drives 80% of traffic plus a long secondary band, so
`H ≈ 0.92`. Miss (capacity) traffic to origin ≈ `(1 − 0.92) × 50,000 = 4,000` req/s
worst case — but most of those are *warm re-fetches*, not truly cold.

**Freshness floor on true origin fetches:** the *distinct* cacheable objects that must
be refreshed on TTL expiry drive `≈ D_hot / T`. For the ~40k resident objects,
`40,000 / 300 ≈ 133` refreshes/s — and with `stale-while-revalidate` these happen
**off** the user critical path, and as `304`s they cost a few hundred bytes each, not a
full image.

**Net origin load:** dominated by the ~4,000 req/s of capacity misses (real body
transfers for the cold tail) plus ~133 req/s of cheap background 304 revalidations. The
levers are now explicit and quantified: increase `C` to shrink the 4,000 (capacity),
increase `T` to shrink the 133 (freshness), and keep strong `ETag`s so the 133 stay
cheap 304s. `stale-if-error` then converts an origin outage into invisible stale-serving
for the resident 40k objects — a fully specified, formally reasoned pull-CDN edge.

---

*Next step:* [Pull CDN — Staff](staff.md)
