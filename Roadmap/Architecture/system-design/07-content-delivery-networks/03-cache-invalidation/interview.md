# Cache Invalidation — Interview

Cache invalidation is the discipline of making a CDN forget or refresh content that
has changed at the origin. It is famously hard because the edge and the origin are
loosely coupled, replicated across hundreds of PoPs, and eventually consistent by
design. This file gives crisp, senior-grade answers to the questions interviewers
actually ask — the three invalidation mechanisms, why versioned/immutable assets beat
purging, purge granularity and propagation, soft vs hard purge, post-purge stampede,
`stale-while-revalidate`, and one full deploy-gone-wrong scenario.

## Table of Contents
1. [Q1: What are the three ways to invalidate CDN content?](#q1-what-are-the-three-ways-to-invalidate-cdn-content)
2. [Q2: Why is cache invalidation called "one of the two hard things"?](#q2-why-is-cache-invalidation-called-one-of-the-two-hard-things)
3. [Q3: TTL expiry vs explicit purge — when do you use each?](#q3-ttl-expiry-vs-explicit-purge--when-do-you-use-each)
4. [Q4: Purge-by-URL vs tag / surrogate-key vs purge-all?](#q4-purge-by-url-vs-tag--surrogate-key-vs-purge-all)
5. [Q5: What is a surrogate key and how does tag-based purge work?](#q5-what-is-a-surrogate-key-and-how-does-tag-based-purge-work)
6. [Q6: Soft purge vs hard purge — what's the difference?](#q6-soft-purge-vs-hard-purge--whats-the-difference)
7. [Q7: How long does a purge take to propagate globally?](#q7-how-long-does-a-purge-take-to-propagate-globally)
8. [Q8: Why are immutable, fingerprinted assets the preferred approach?](#q8-why-are-immutable-fingerprinted-assets-the-preferred-approach)
9. [Q9: What is post-purge stampede and how do you prevent it?](#q9-what-is-post-purge-stampede-and-how-do-you-prevent-it)
10. [Q10: Explain stale-while-revalidate and stale-if-error.](#q10-explain-stale-while-revalidate-and-stale-if-error)
11. [Q11: How do conditional requests (ETag / If-None-Match) fit in?](#q11-how-do-conditional-requests-etag--if-none-match-fit-in)
12. [Q12: Scenario — you deployed new CSS but users see the old style.](#q12-scenario--you-deployed-new-css-but-users-see-the-old-style)
13. [Q13: How do you invalidate HTML that references fingerprinted assets?](#q13-how-do-you-invalidate-html-that-references-fingerprinted-assets)
14. [Q14: How do you handle invalidation for personalized or authenticated content?](#q14-how-do-you-handle-invalidation-for-personalized-or-authenticated-content)
15. [Q15: What metrics tell you invalidation is healthy?](#q15-what-metrics-tell-you-invalidation-is-healthy)

---

## Q1: What are the three ways to invalidate CDN content?

> There are exactly three primitives, and mature systems lean on them in a specific order of preference:
>
> 1. **TTL expiry (passive)** — the object carries a freshness lifetime via `Cache-Control: max-age` / `s-maxage` (or `Expires`). The edge simply stops serving it as fresh once the TTL elapses and revalidates or refetches. No coordination needed; it just costs staleness up to one TTL window.
> 2. **Explicit purge / invalidation (active)** — you tell the CDN *now* to drop or mark-stale a specific object, a set of objects (by tag), or everything. Used when content changed and you cannot wait for TTL.
> 3. **Versioning (avoid the problem)** — you never invalidate; you change the URL. A new content version gets a new key (`app.4f3a9b.css`), so the old cached entry is irrelevant and the new one is a guaranteed miss-then-cache.
>
> **Preference order:** version > TTL > purge. Versioning is deterministic and needs no CDN API call; TTL is cheap and self-healing; purge is a synchronization operation across a distributed fleet and is the most error-prone. Good architectures make purge the exception, not the workhorse.

---

## Q2: Why is cache invalidation called "one of the two hard things"?

> The Phil Karlton quip — *"There are only two hard things in Computer Science: cache invalidation and naming things"* — captures a real difficulty. A cache is a **replicated, eventually-consistent copy** of truth that lives at hundreds of edge PoPs. To invalidate correctly you must answer:
>
> - **What exactly changed?** One object, or every page that embedded it (a product image appears on the product page, the category page, the homepage carousel, the search results…)? Under-invalidate and users see stale data; over-invalidate and you cold-start half your cache.
> - **Where are all the copies?** They are spread across global PoPs, and within a PoP across a cluster of cache nodes; a purge must fan out to all of them.
> - **When is it safe / consistent?** Purge is not atomic globally. During propagation, some PoPs serve new content and some serve old — a brief split-brain the user can observe (e.g., a hard refresh in Tokyo shows new, in Frankfurt shows old).
>
> So it is hard not because deleting a key is hard, but because you are doing a **distributed, fan-out, eventually-consistent state change** under latency, partial failure, and imperfect knowledge of the dependency graph. The senior insight is to *design so you rarely need it* — hence immutable versioned assets.

---

## Q3: TTL expiry vs explicit purge — when do you use each?

> They solve different problems:
>
> | | TTL expiry | Explicit purge |
> |---|---|---|
> | Trigger | Passive — time elapses | Active — you call the CDN API |
> | Coordination | None | Fan-out to all PoPs |
> | Freshness bound | Up to one `max-age` window | Near-immediate (seconds) |
> | Cost / risk | Cheap, self-healing | API call, propagation lag, stampede risk |
> | Good for | Content with tolerable staleness (feeds, listings) | Corrections, takedowns, breaking news, security fixes |
>
> **Rule of thumb:** set the shortest TTL you can tolerate as the *default* so most changes heal automatically, and reserve purge for cases where "wait up to TTL" is unacceptable (a legal takedown, a wrong price, a leaked secret). If you find yourself purging on every deploy, the real fix is usually versioned URLs, not more purging. A short TTL plus `stale-while-revalidate` often removes the need for purge entirely.

---

## Q4: Purge-by-URL vs tag / surrogate-key vs purge-all?

> Three granularities, trading precision against blast radius:
>
> | Method | Scope | Blast radius | When to use |
> |---|---|---|---|
> | **Purge by URL** | One exact object (path + often query/variant) | Minimal — 1 object | You know precisely which asset changed |
> | **Tag / surrogate-key purge** | Every object tagged with a key (e.g., `product-123`) | Bounded, semantic | One entity appears on many pages; invalidate them all in one call |
> | **Purge-all (wildcard/everything)** | The entire cache (or a whole property) | Maximal — cold start | Emergency only; broad config/template change |
>
> **URL purge** is surgical but requires you to enumerate every affected URL — brittle when one entity fans out to many pages, and it must account for variants (query strings, `Vary` on `Accept-Encoding`/device). **Tag purge** decouples *what changed* (an entity) from *where it appears* (URLs) — you attach a `Surrogate-Key: product-123 category-42` header at the origin and later purge the tag; the CDN invalidates every object carrying it. **Purge-all** is the sledgehammer: it works but triggers a fleet-wide cold cache and an origin load spike, so it is a last resort, not a deploy step.

---

## Q5: What is a surrogate key and how does tag-based purge work?

> A **surrogate key** (Fastly's name; also "cache tag" in Cloudflare/Varnish) is a label the origin attaches to a response so the CDN can later invalidate by *meaning* rather than by URL. The origin sets a header the client never sees:
>
> ```
> Surrogate-Key: product-123 category-42 homepage-hero
> ```
>
> The CDN indexes each cached object under all its keys. When product 123 changes, a single call `PURGE key=product-123` invalidates *every* cached object that referenced it — the product page, the category listing, the homepage hero — regardless of their URLs. This is the answer to the fan-out dependency problem in Q2: you tag at write time, purge at change time.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant Origin
>     participant CDN as CDN (tag index)
>     participant U as User
>     Origin-->>CDN: Response, Surrogate-Key: product-123 category-42
>     Note over CDN: index object under both keys
>     U->>CDN: GET /category/42  (HIT)
>     Note over Origin: product 123 price changes
>     Origin->>CDN: PURGE key=product-123
>     Note over CDN: drop/stale ALL objects tagged product-123
>     U->>CDN: GET /category/42  (MISS → refetch fresh)
> ```
>
> Design tip: tag with the **entities** a page depends on, not the page itself, so the same purge naturally covers every place that entity appears.

---

## Q6: Soft purge vs hard purge — what's the difference?

> Both invalidate, but they differ in what happens to the *next* request:
>
> - **Hard purge** — the object is evicted immediately. The very next request is a guaranteed **MISS** and must go to origin. Fastest to full consistency, but every purged key becomes a synchronized origin fetch — the classic stampede/thundering-herd risk (Q9).
> - **Soft purge** — the object is only *marked stale*, not evicted. The next request can still be served the stale copy **while** the edge asynchronously revalidates in the background (this is essentially forced `stale-while-revalidate`). Users keep getting fast (slightly stale) responses; origin sees a smooth trickle of revalidations instead of a spike.
>
> **Interview point:** soft purge is the safer default for high-traffic properties because it converts a cliff (mass MISS) into a ramp (background revalidation), protecting the origin at the cost of a brief, bounded window of staleness. Use hard purge when correctness must be immediate and staleness is unacceptable (wrong price, takedown, security).

---

## Q7: How long does a purge take to propagate globally?

> Not instantaneous — it is a fan-out to every PoP, so there is a propagation window:
>
> - **Typical:** single-URL and tag purges on modern CDNs land in a few hundred milliseconds to a few seconds across the global fleet.
> - **Purge-all** is slower and heavier because it touches the entire cache and can trigger a fleet-wide cold start.
> - During the window the system is **eventually consistent**: some PoPs already serve new content, others still serve old. A user can observe this if they hit different PoPs (VPN, mobile vs office network) or if anycast routing shifts.
>
> Consequences to call out:
> 1. **Never treat purge as synchronous** in your deploy/publish flow — don't assume "purge returned 200" means every user worldwide sees new content. Poll/verify or, better, use versioned URLs so correctness doesn't depend on propagation timing.
> 2. **Ordering matters.** Publish the new origin content *before* purging; if you purge first, an in-window MISS may refetch the *old* origin content and re-cache staleness.
> 3. For truly atomic cutover, version the URL — the switch happens the instant the referencing HTML points at the new key, with no propagation race.

---

## Q8: Why are immutable, fingerprinted assets the preferred approach?

> Because they **make invalidation unnecessary** — the hardest problem is avoided rather than solved. You embed a content hash in the filename (`app.4f3a9b2c.css`, `bundle.9d81ff.js`) at build time and serve it with:
>
> ```
> Cache-Control: public, max-age=31536000, immutable
> ```
>
> Properties:
> - **Different content ⇒ different URL.** New CSS produces a new hash, hence a new key. The old file is never *invalidated*; it simply stops being referenced. No purge, no propagation race, no fan-out.
> - **`immutable`** tells the browser not to even revalidate on reload — the file for a given hash can never change, so `max-age` of a year is safe.
> - **Atomic deploys.** A deploy flips one small, short-TTL HTML document to reference the new hashes; every fingerprinted asset switches over at once with zero purge coordination.
> - **Instant rollback.** Old hashed files still exist at the origin/CDN, so rolling back is just re-pointing HTML at the old hashes.
>
> The trade-off is that the **HTML (or asset manifest) that references the hashes is the one thing you cannot fingerprint** — it must have a short TTL or be purged/versioned on deploy. That is the single mutable "pointer" that the whole scheme hangs on (see Q13). This pattern — long-lived immutable assets behind a short-lived mutable index — is the canonical CDN answer and is what interviewers want to hear over "we purge on every deploy."

---

## Q9: What is post-purge stampede and how do you prevent it?

> A **post-purge stampede** (thundering herd) is what happens right after a hard purge of a hot object: every edge simultaneously has a MISS, and all in-flight requests for that key rush to the origin at once. A single popular URL can hammer the origin with thousands of concurrent identical fetches in the instant after purge — potentially overloading it exactly when you least want to.
>
> Mitigations:
> - **Request coalescing / collapsed forwarding** — the edge lets only *one* request per key go to origin and holds the rest, serving them all from the single fetched response. This is the primary defense and is on by default in most CDNs/Varnish.
> - **Soft purge + `stale-while-revalidate`** — keep serving the stale copy while a *single* background request revalidates. Converts the MISS cliff into a smooth ramp (Q6, Q10).
> - **Stagger / tiered caching** — a shield/origin-shield layer absorbs edge misses so only one request per region (not per PoP) reaches origin.
> - **Jittered TTLs** — avoid many objects expiring at the same instant by adding randomness to `max-age`, so natural expiry doesn't synchronize into its own stampede.
>
> ```mermaid
> stateDiagram-v2
>     [*] --> Fresh
>     Fresh --> Stale: hard purge / TTL elapse
>     Stale --> Revalidating: first request triggers ONE origin fetch
>     Revalidating --> Fresh: origin responds, re-cache
>     Revalidating --> Revalidating: other requests coalesced (wait or served stale)
>     note right of Revalidating: coalescing + SWR prevent the herd
> ```

---

## Q10: Explain stale-while-revalidate and stale-if-error.

> Both are `Cache-Control` extensions (RFC 5861) that let the edge serve a *slightly* stale copy to keep latency low and origin load smooth:
>
> ```
> Cache-Control: max-age=60, stale-while-revalidate=600, stale-if-error=86400
> ```
>
> - **`stale-while-revalidate=600`** — for up to 600 s *after* the object goes stale (past `max-age`), the edge may serve the stale copy **immediately** to the user while it revalidates with the origin **in the background**. The user never pays the revalidation latency; the next user gets the fresh copy. This is what makes short TTLs cheap: freshness without a MISS on the critical path.
> - **`stale-if-error=86400`** — if the origin is down or errors (5xx/timeout) during revalidation, the edge may keep serving the stale copy for up to a day rather than surfacing the error. It is a resilience valve — cached content shields users from an origin outage.
>
> Together they turn caching from a hard fresh/stale switch into a graceful degradation: fast-and-current normally, fast-and-slightly-stale during revalidation, fast-and-stale-but-available during an origin outage. They also directly defuse the stampede (Q9), because only the background revalidation touches origin, and it is coalesced.

---

## Q11: How do conditional requests (ETag / If-None-Match) fit in?

> Conditional requests make **revalidation cheap** — they are how the edge (or browser) asks "has this changed?" without re-downloading the body:
>
> 1. Origin sends `ETag: "abc123"` (a content fingerprint) and/or `Last-Modified` with the response.
> 2. On revalidation the cache sends `If-None-Match: "abc123"` (or `If-Modified-Since`).
> 3. If unchanged, origin replies **`304 Not Modified`** with headers only — no body. The edge refreshes the object's freshness and reuses the stored bytes.
> 4. If changed, origin replies `200` with the new body and a new ETag.
>
> This is complementary to invalidation, not a replacement: TTL/`stale-while-revalidate` decides *when* to revalidate; ETag makes each revalidation almost free (a 304 saves the transfer of a possibly large body). For fingerprinted immutable assets you don't even need this — the URL guarantees the content — but for mutable objects with short TTLs, ETags dramatically cut bandwidth and let you revalidate frequently without cost.

---

## Q12: Scenario — you deployed new CSS but users see the old style.

> **Diagnosis.** Users hitting stale CSS means a cached copy — at the CDN edge, in the browser, or both — is still being served under the *same URL* the HTML references. Classic cause: `style.css` was overwritten in place but is cached with a long `max-age` and no versioning, so nothing tells the edge/browser it changed.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant Dev
>     participant Origin
>     participant CDN
>     participant Browser
>     Dev->>Origin: deploy new style.css (same URL)
>     Browser->>CDN: GET /style.css
>     CDN-->>Browser: HIT — OLD css (still within max-age)
>     Note over Browser: also cached locally under same URL
>     Note over CDN,Browser: same URL + long TTL ⇒ change is invisible
> ```
>
> **Immediate fix (stop the bleeding):**
> 1. Purge `style.css` at the CDN (by URL or its surrogate key). Publish the new file to origin *first*, then purge, so an in-window MISS refetches the new content (Q7).
> 2. The browser copy still won't budge until *its* TTL expires — you can't purge a user's browser. A hard refresh helps individuals but not the fleet.
>
> **Prevent recurrence (the real answer interviewers want):**
> - **Fingerprint the asset:** ship `style.4f3a9b.css` with `Cache-Control: public, max-age=31536000, immutable`. New CSS ⇒ new hash ⇒ new URL ⇒ guaranteed fresh fetch, no purge, no propagation race, no stale browser copy (Q8).
> - **Keep the referencing HTML mutable and short-TTL** (e.g., `max-age=0, must-revalidate` or a small `s-maxage` with `stale-while-revalidate`) so the pointer to the new hash propagates promptly (Q13).
> - Result: deploys become atomic — flip the HTML, every asset switches at once, rollback is re-pointing at old hashes. You never purge CSS/JS again.

---

## Q13: How do you invalidate HTML that references fingerprinted assets?

> The fingerprinting scheme has exactly one mutable link: the **HTML (or JSON asset manifest)** that maps logical names to hashed URLs. It cannot be fingerprinted because its URL must be stable (`/`, `/index.html`). So you treat it as the *pointer* and invalidate only it:
>
> - Serve HTML with a **short TTL** — often `Cache-Control: no-cache` (revalidate every time) or a small `s-maxage` (e.g., 30–60 s) paired with `stale-while-revalidate` so it updates quickly without a MISS on the hot path.
> - On deploy, either let the short TTL heal it or **purge just the HTML/manifest** (one object, tiny blast radius). Everything it references is immutable and already at the edge.
>
> ```mermaid
> stateDiagram-v2
>     [*] --> AssetsImmutable
>     AssetsImmutable --> AssetsImmutable: max-age=1yr, immutable (never invalidated)
>     [*] --> HtmlPointer
>     HtmlPointer --> HtmlUpdated: deploy flips references to new hashes
>     HtmlUpdated --> HtmlPointer: short TTL / purge propagates new pointer
>     note right of HtmlPointer: only the pointer is mutable — invalidate ONLY this
> ```
>
> This is the whole trick: **long-lived immutable content behind a short-lived mutable index.** You concentrate all invalidation risk into one tiny, cheap-to-purge object.

---

## Q14: How do you handle invalidation for personalized or authenticated content?

> Personalized responses shouldn't sit in a shared edge cache under a shared key at all — invalidation of "user 7's cart" across a public cache is meaningless and dangerous. Approach:
>
> - **Mark it uncacheable at the shared layer:** `Cache-Control: private, no-store` (or `private, max-age=…` for browser-only caching). `private` forbids shared CDN caching but permits the browser's own cache.
> - **Cache the shell, not the data:** cache the static/immutable page skeleton at the edge and hydrate personalized fragments via a separate uncached API call (or edge-side includes). Invalidation then only ever touches the shared, non-personal parts.
> - **Use `Vary` carefully** for variant-but-cacheable responses (`Vary: Accept-Encoding` is fine; `Vary: Cookie` usually fragments the cache into near-uselessness — avoid it as a personalization hack).
> - **Segment, don't personalize per-user, when you can:** cache a small number of *cohorts* (e.g., locale, currency, A/B bucket) via surrogate keys, and purge a cohort's key when its content changes.
>
> The senior point: don't try to *invalidate* per-user state in a shared cache; **keep per-user state out of the shared cache** and cache only what is genuinely shared.

---

## Q15: What metrics tell you invalidation is healthy?

> Watch the signals that reveal both correctness (are users seeing stale content?) and cost (is invalidation hurting the origin?):
>
> | Metric | Healthy signal | What a bad value means |
> |---|---|---|
> | **Cache hit ratio** | High and stable | A dip after a deploy = over-purging / cold start |
> | **Origin request rate / egress** | Smooth | Spikes right after purges = stampede (Q9) |
> | **Origin p99 latency & 5xx** | Flat across deploys | Rises at purge time = herd overwhelming origin |
> | **Purge frequency & scope** | Rare, narrow (URL/tag) | Frequent purge-all = missing versioning strategy |
> | **Purge propagation time** | Within SLA (secs) | Long tail = users on some PoPs see stale content |
> | **Stale-served ratio (SWR)** | Small, bounded | Growing = origin can't keep up with revalidation |
>
> Two red flags an interviewer listens for: **purge-all on every deploy** (you're missing fingerprinting) and an **origin CPU/latency spike correlated with purges** (you're missing soft purge, coalescing, or `stale-while-revalidate`). A healthy system deploys via immutable versioned URLs, purges rarely and narrowly, and shows *no* visible origin disturbance when it does.

---

*Next step:* [Edge Locations — Junior](../04-edge-locations/junior.md)
