# Push CDN — Professional

A push CDN inverts the control flow of the pull model. Instead of edge Points of Presence (PoPs) lazily fetching objects from origin on the first miss, the operator *proactively distributes* content to the edge ahead of demand. That single inversion changes the theoretical footing of the whole system: correctness is no longer "did the origin answer?" but "has this version *converged* to every PoP that might serve it?" This document builds the distribution/propagation model formally — replication fan-out, propagation-time bounds, and the eventual-consistency window across edges — grounds immutability in content addressing and `Cache-Control: immutable` (RFC 8246, RFC 9111), computes the storage footprint of full replication, maps the tradeoff surface against tiered/on-demand fill, and analyzes the consistency model that a version swap must satisfy so a client observes read-your-writes at the edge.

## Table of Contents

1. [The Push Inversion and Why It Changes the Math](#1-the-push-inversion-and-why-it-changes-the-math)
2. [The Distribution Model: Replication Fan-Out](#2-the-distribution-model-replication-fan-out)
3. [Propagation-Time Bounds and the Convergence Window](#3-propagation-time-bounds-and-the-convergence-window)
4. [Content-Addressed, Fingerprinted, Immutable Naming](#4-content-addressed-fingerprinted-immutable-naming)
5. [`Cache-Control: immutable` and the Freshness Model](#5-cache-control-immutable-and-the-freshness-model)
6. [Storage Footprint Math: A Worked Calculation](#6-storage-footprint-math-a-worked-calculation)
7. [The Tradeoff Surface: Full Replication vs Tiered/On-Demand Fill](#7-the-tradeoff-surface-full-replication-vs-tieredon-demand-fill)
8. [Consistency Models for a Version Swap](#8-consistency-models-for-a-version-swap)
9. [Decision Framework](#9-decision-framework)
10. [Summary](#10-summary)

---

## 1. The Push Inversion and Why It Changes the Math

In a **pull CDN** the edge is a demand-driven cache. The first request for an object at a PoP misses, the PoP fetches from origin (or a mid-tier), stores the result subject to its freshness headers, and serves subsequent requests locally. The steady-state footprint at each PoP is not the catalog — it is the *working set* the local audience actually requests, bounded by the cache size and shaped by the eviction policy. Correctness is trivially "the response is fresh per RFC 9111"; nothing needs to have converged.

A **push CDN** distributes objects to PoPs *before* they are requested. The operator (or a pipeline triggered by a publish event) writes each object out to some set of PoPs so that the first user request is already a hit. This is the right model when a *cold miss is unacceptable* — a software update rollout where 50 million clients wake at 09:00 UTC and hit origin simultaneously (a thundering herd the pull model absorbs poorly), a game patch, a video segment for a scheduled premiere, or any launch where the "prime the cache" step must complete deterministically before traffic arrives.

The inversion moves the hard problem from **cache management** (eviction, TTL, revalidation) to **distributed state convergence**:

- The unit of correctness becomes *"has version `v` of object `O` reached every PoP in its target set?"*
- Between the publish instant and full convergence there is an unavoidable window in which different PoPs may hold different versions — a genuine eventual-consistency problem, not a caching detail.
- Storage is no longer working-set-bounded; if you replicate the full catalog everywhere, each PoP must hold the *entire* catalog, and the aggregate footprint multiplies by the PoP count.

Everything that follows is a consequence of these three facts.

---

## 2. The Distribution Model: Replication Fan-Out

The naive distribution topology is a **star**: origin (or a control plane) opens a connection to every PoP and streams the object. If there are `P` PoPs and the object is `S` bytes, origin must egress `P · S` bytes, and its uplink bandwidth `B_o` becomes the bottleneck. Total fan-out time is at least `P · S / B_o` — linear in the number of PoPs. At planetary scale (`P` in the hundreds) this saturates origin and starves the tail PoPs.

Production push systems therefore use a **tree (or DAG) fan-out through mid-tier hubs**, sometimes reinforced with peer-to-peer replication *inside* a region. Origin pushes to a small number of regional hubs; each hub fans out to the PoPs it parents. With a balanced tree of fan-out degree `k` and `P` leaf PoPs, the depth is `⌈log_k P⌉` and each internal node egresses only `k · S` bytes rather than `P · S`.

```mermaid
flowchart TD
    O["Origin / Control Plane<br/>publishes object O@v"]
    H1["Regional Hub — EU"]
    H2["Regional Hub — NA"]
    H3["Regional Hub — APAC"]
    P1["PoP: FRA"]
    P2["PoP: LHR"]
    P3["PoP: IAD"]
    P4["PoP: SJC"]
    P5["PoP: NRT"]
    P6["PoP: SIN"]
    O -->|"1. push O@v"| H1
    O -->|"1. push O@v"| H2
    O -->|"1. push O@v"| H3
    H1 -->|"2. fan-out"| P1
    H1 -->|"2. fan-out"| P2
    H2 -->|"2. fan-out"| P3
    H2 -->|"2. fan-out"| P4
    H3 -->|"2. fan-out"| P5
    H3 -->|"2. fan-out"| P6
```

The staged progression of one object through the tree — origin commit, hub receipt, leaf receipt, leaf acknowledgement — is the state machine each object traverses:

```mermaid
stateDiagram-v2
    [*] --> Committed: origin persists O@v
    Committed --> HubReplicated: all hubs ACK receipt
    HubReplicated --> Fanning: hubs push to leaf PoPs
    Fanning --> PartiallyConverged: some leaves ACK
    PartiallyConverged --> Converged: every target PoP ACK
    Converged --> Serving: version pointer flipped
    Serving --> [*]
```

The key theoretical property: an object is **safe to serve globally** only in the `Converged`/`Serving` states. In `PartiallyConverged`, a request routed to a lagging PoP either misses (if that PoP has no copy at all) or — worse — serves a *stale prior version*. Managing what happens in that window is the whole of §8.

---

## 3. Propagation-Time Bounds and the Convergence Window

Define the **propagation delay** `D_i` of PoP `i` as the wall-clock time from the origin commit of version `v` to the instant PoP `i` can serve `v`. The **convergence time** of the object is `D_max = max_i D_i` — the system has converged only when the slowest target PoP is done. This is the CDN analogue of "replication lag," and it is dominated by the tail, not the mean.

For the tree topology, `D_i` decomposes along the path from origin to leaf `i`:

```
D_i  =  Σ over each hop h on the path  ( T_prop_h + S / B_h + T_queue_h )
```

where `T_prop_h` is one-way propagation latency of hop `h` (speed-of-light + routing, ~tens of ms intercontinental), `S / B_h` is the transmission (serialization) time of an `S`-byte object over a link of bandwidth `B_h`, and `T_queue_h` is queueing/scheduling delay at the node (contention with other concurrent objects in the same push wave).

Two regimes fall out:

- **Small objects, many of them** (a manifest, thousands of tiny assets): `S / B_h → 0`, so `D_i ≈ depth · (T_prop + T_queue)` — **latency-bound**. Convergence time is set by tree depth and per-hop RTT, and by how well the control plane pipelines the many small transfers.
- **Large objects, few of them** (a 4 GB game patch): `T_prop` is noise next to `S / B_h`, so `D_i ≈ Σ S / B_h` — **bandwidth-bound**. The narrowest link on the path dictates convergence time, and the tree's value is that it keeps origin off that path.

The **convergence window** `W = D_max` is the interval during which the guarantees of §8 are at risk. A star topology has `D_max ≈ P · S / B_o` (origin-serialized); a depth-`d` tree has `D_max ≈ d · (T_prop + S/B_leaf)` plus tail queueing — the difference between minutes and seconds at scale. Because the window is a **tail quantity**, the operationally meaningful metric is not mean `D` but a high percentile — a PoP whose ACK is lost and must retry can dominate `D_max`, which is why push pipelines pair fan-out with per-PoP ACK tracking and bounded-retry timeouts, and why the version-swap protocol (§8) must never flip the global pointer until `D_max` has elapsed *with confirmation*, not merely on a timer.

---

## 4. Content-Addressed, Fingerprinted, Immutable Naming

The eventual-consistency window of §3 becomes tractable only if content is **immutable under a stable name**. The design rule that makes push CDNs safe: *never mutate the bytes behind a URL; publish a new URL instead.*

**Fingerprinted naming.** The build pipeline hashes each object's content and embeds a prefix of that digest in the filename or path:

```
app.js            →  app.4f9a2c1e.js
main.css          →  main.b73d0af5.css
sprite.png        →  sprite.9c1e77b0.png
```

The name is now a function of the bytes. Two consequences follow directly:

1. **Content addressing** — identical content deduplicates to one name; a byte change *forces* a new name. There is no such thing as "the same URL with different content," which is exactly the failure mode that makes cross-edge staleness observable.
2. **Immutability by construction** — because a change of bytes changes the name, the object at any given name can be declared *never-changing*, and therefore cached forever anywhere without revalidation.

This turns the version-swap problem into a **pointer-flip problem**. The immutable, fingerprinted assets are pushed and converge on their own timeline; a single small, *mutable* indirection — the HTML document, a manifest, or a version pointer — is what actually changes to reference the new fingerprints. Convergence of the large payload is decoupled from the atomic act of switching versions (see §8).

A companion technique is a **content-addressed manifest**: publish `manifest.json` (itself fingerprinted, e.g. `manifest.a1b2c3.json`) listing `{logical-name → fingerprinted-name}`. Clients resolve logical names through the manifest, so a release is atomic in the manifest even while individual assets stream to the edge independently.

---

## 5. `Cache-Control: immutable` and the Freshness Model

RFC 9111 defines HTTP caching freshness: a stored response is fresh while its age is below the freshness lifetime derived from `Cache-Control: max-age` (or `Expires`). But even within `max-age`, a client that *reloads* a page will typically send a conditional revalidation (`If-None-Match` / `If-Modified-Since`) — a wasted round-trip that yields `304 Not Modified` for content that, thanks to fingerprinting, *cannot* have changed.

**RFC 8246** defines the `immutable` extension to `Cache-Control` precisely for this case:

```
Cache-Control: public, max-age=31536000, immutable
```

`immutable` is a signal that the response body will *not* change during its freshness lifetime, and therefore a client **must not send a conditional revalidation request even on an explicit reload**. It is the exact semantic match for a fingerprinted asset: the name pins the bytes, so revalidation is provably pointless.

The correct freshness policy for a push CDN is thus a two-class split:

| Object class | Naming | Header | Rationale |
|---|---|---|---|
| Fingerprinted asset (`app.4f9a2c1e.js`) | content-addressed, immutable | `public, max-age=31536000, immutable` | bytes pinned to name → cache forever, never revalidate (RFC 8246) |
| Indirection (`index.html`, `manifest`) | stable, mutable | `no-cache` or short `max-age` + `ETag` | must revalidate to observe the version swap |

`no-cache` (per RFC 9111) does **not** mean "do not store" — it means "store, but revalidate before reuse." That is exactly what the mutable indirection needs: the client always checks whether the pointer moved, but the heavy immutable assets it points to are served from cache with zero validation traffic. This split is what lets the convergence window of §3 be hidden entirely from clients: they never see a half-swapped release because they only ever fetch a complete, self-consistent manifest and the immutable assets it names.

---

## 6. Storage Footprint Math: A Worked Calculation

Push, in its purest **full-replication** form, holds the entire catalog at every PoP. The aggregate storage is not the catalog size — it is the catalog multiplied by the replication factor and the PoP count.

Let:

```
C   = catalog size (logical bytes of distinct content)
R   = per-PoP replication factor (local redundancy: replicas/erasure within a PoP)
P   = number of PoPs holding a full copy
V   = number of live versions retained (for instant rollback)
```

The aggregate footprint of full replication is:

```
Footprint_full  =  C · R · P · V
```

**Worked example.** A media/software CDN with:

```
C = 20 TB   distinct current-catalog content
R = 1.4     local durability overhead (e.g. RAID-6 / erasure at each PoP ≈ 40% overhead)
P = 120     PoPs, each holding a full copy
V = 2       keep current + previous version for instant rollback
```

Aggregate stored bytes:

```
Footprint_full = 20 TB · 1.4 · 120 · 2
               = 20 · 1.4 · 120 · 2  TB
               = 6,720 TB
               ≈ 6.72 PB
```

That is **336×** the logical catalog (`1.4 · 120 · 2 = 336`). The `P` factor is the multiplier that makes naive full replication expensive: adding a PoP does not add a cache — it adds an entire catalog copy.

**Propagation cost of one release.** Suppose a release updates 15% of the catalog, `S_rel = 0.15 · 20 TB = 3 TB` of changed bytes, and each PoP is fed by a leaf link of `B_leaf = 10 Gb/s = 1.25 GB/s`. Bandwidth-bound convergence time per PoP:

```
D_leaf ≈ S_rel / B_leaf = 3 TB / 1.25 GB/s
       = 3,000,000 MB / 1250 MB/s
       = 2,400 s ≈ 40 min
```

Under a **star** topology origin would additionally serialize `P · S_rel = 120 · 3 TB = 360 TB` on its own uplink; at a 100 Gb/s (12.5 GB/s) origin link that is `360e6 MB / 12500 MB/s ≈ 28,800 s ≈ 8 hours` — origin-bound, and the reason star fan-out is untenable. A depth-2 tree keeps origin egress at `hubs · S_rel` (say 3 hubs → 9 TB, ~12 min) and lets the 40-min leaf transfers run in parallel across all PoPs, so `D_max ≈ 40 min + hub time`, not 8 hours. The lesson is quantitative: **the fan-out topology, not the raw byte count, sets the convergence window.**

---

## 7. The Tradeoff Surface: Full Replication vs Tiered/On-Demand Fill

Full replication buys guaranteed hit-on-first-request everywhere at the cost of `C · R · P · V` storage and a full-catalog transfer per release. Most catalogs have a heavy **Zipfian access skew**: a small hot set drives the overwhelming majority of requests, and a long cold tail is rarely (or never) requested at any given PoP. Paying to store the cold tail at *every* PoP is largely wasted.

**Tiered / on-demand fill** is the hybrid. The operator pushes only a designated **hot set** to every PoP (guaranteeing no cold miss for the content that matters), and lets the cold tail be **pulled** on demand from a nearby **mid-tier hub** that *does* hold a full copy. A PoP miss on cold content is a fast intra-region hub fetch (single-digit ms to low tens of ms), not an origin round-trip — so the tail latency penalty is small while the storage saving is large.

```mermaid
flowchart TD
    Origin["Origin"]
    Hub["Mid-tier Hub<br/>(full catalog copy)"]
    PoP["Edge PoP<br/>(hot set only)"]
    Client["Client"]
    Origin -->|push hot set + hub full copy| Hub
    Hub -->|push hot set| PoP
    Client -->|request| PoP
    PoP -->|"hot → HIT"| Client
    PoP -.->|"cold → miss, pull from hub"| Hub
    Hub -.->|fill| PoP
```

Let `f_hot` be the fraction of the catalog in the pushed hot set. A tiered PoP stores roughly `C · R · f_hot` (plus a bounded pull-cache for recently-fetched tail), and the mid-tier hubs hold the full copy shared across all PoPs in a region:

```
Footprint_tiered ≈ C · R · (f_hot · P  +  H)      where H = number of full-copy hubs
```

With the §6 numbers and `f_hot = 0.2`, `H = 6`:

```
Footprint_tiered ≈ 20 · 1.4 · (0.2 · 120 + 6) · V
                 = 20 · 1.4 · (24 + 6) · 2
                 = 20 · 1.4 · 30 · 2  TB
                 = 1,680 TB ≈ 1.68 PB
```

a **4× reduction** versus 6.72 PB, at the cost of a hub-fetch on the (rare) cold-tail request.

| Dimension | Full replication (push everything) | Tiered / on-demand fill (push hot set, pull tail) |
|---|---|---|
| Aggregate storage | `C·R·P·V` (grows linearly in P) | `C·R·(f_hot·P + H)·V` (P-term scaled by f_hot) |
| First-request latency | Hit everywhere, always | Hit for hot set; hub-fetch (~ms–tens ms) for cold tail |
| Per-release transfer | Full changed set to *every* PoP | Changed hot set to PoPs; full set to hubs only |
| Convergence window | Large (all bytes to all PoPs) | Small (hot set to PoPs; tail lazily filled) |
| Origin/hub load on miss | None (never misses) | Bounded hub load on cold-tail misses |
| Best fit | Small/critical catalogs; launch primes; cold-miss unacceptable | Large skewed catalogs; storage-cost-sensitive; tail-latency-tolerant |
| Failure mode | Wasted storage on cold content | Hub becomes hot-spot if skew estimate is wrong |

The decision is fundamentally the storage-vs-tail-latency knob `f_hot`: push more (toward 1) and you approach full replication's guarantees and cost; push less (toward the true hot set) and you approach pull's economics with a push floor under the content that must never cold-miss.

---

## 8. Consistency Models for a Version Swap

A **version swap** publishes version `v+1` of a logical object and must transition global reads from `v` to `v+1`. During the convergence window `W` (§3), PoPs disagree about which version they hold. The consistency question is: *what can a client observe, and what must it never observe?*

The floor requirement is **read-your-writes at the edge**: after the control plane reports the swap as committed, any client that observes `v+1` at one PoP must never subsequently observe `v` at another PoP (no going backwards in the client's timeline). A weaker but common target is **monotonic reads** (a session never regresses to an older version), and the strongest is **atomic global swap** (every PoP flips at the same logical instant — practically unachievable without freezing traffic).

Three implementable models, in increasing strength:

| Model | Mechanism | Client can observe during W | Guarantee |
|---|---|---|---|
| **Best-effort push, flip-on-arrival** | each PoP starts serving `v+1` the moment its copy converges | mix of `v` and `v+1` across PoPs; a session may flip-flop | eventual consistency only — *no* monotonicity |
| **Converge-then-flip (pointer gate)** | push immutable assets; flip a *versioned manifest pointer* only after `D_max` confirmed by all target PoPs | manifest reads see `v` until global flip, then all see `v+1` | monotonic + read-your-writes (via manifest gate) |
| **Two-phase publish** | phase 1: distribute + verify assets everywhere (they are dormant, addressed by fingerprint); phase 2: atomically flip the small manifest pointer at every PoP | never a half-swapped release; assets pre-positioned so flip is instant | closest to atomic swap; bounded flip skew |

The production pattern is **two-phase publish riding on immutable naming** (§4–5). Because assets are fingerprinted and immutable, `v` and `v+1` *coexist* at every PoP under different names — pushing `v+1`'s assets never disturbs `v`'s. The only thing that must swap is the tiny mutable indirection (manifest/pointer), served `no-cache` so clients always revalidate it. The flip is therefore cheap, near-atomic, and reversible.

```mermaid
sequenceDiagram
    autonumber
    participant CP as Control Plane
    participant PoP as Edge PoPs (all)
    participant Cl as Client
    Note over CP,PoP: Phase 1 — pre-position immutable assets (fingerprinted)
    CP->>PoP: push v+1 assets (new names, dormant)
    PoP-->>CP: ACK converged (wait for D_max, all PoPs)
    Note over CP,PoP: v assets still serving; v+1 present but unreferenced
    Note over CP,PoP: Phase 2 — atomic pointer flip
    CP->>PoP: flip manifest pointer → v+1
    Cl->>PoP: GET manifest (no-cache → revalidate)
    PoP-->>Cl: manifest v+1 (references v+1 fingerprints)
    Cl->>PoP: GET app.<v+1-hash>.js
    PoP-->>Cl: 200 (immutable, already local)
    Note over Cl,PoP: read-your-writes: once client sees v+1 manifest,<br/>every asset it names is present at every PoP
```

Why this delivers read-your-writes at the edge: the flip is gated on *global* convergence of the immutable assets (phase 1 completes only when all target PoPs ACK), so by the time *any* client can observe the `v+1` manifest, *every* PoP already holds every `v+1` asset the manifest names. A client that later routes to a different PoP therefore cannot regress: the worst case is that PoP still serves the `v` *manifest* (if the flip is mid-propagation), but never a `v+1` manifest pointing at assets some PoP lacks. Rollback is symmetric and instant — re-point the manifest to `v`, whose immutable assets were never deleted (that is the `V ≥ 2` factor in §6). The convergence window is thus *hidden behind the pointer*: expensive to close, but invisible to clients because reads only ever see complete, self-consistent versions.

---

## 9. Decision Framework

- **Cold miss unacceptable, small/critical catalog** (launches, patches, scheduled premieres) → **full replication**. Accept `C·R·P·V` storage; the guarantee is worth it.
- **Large, skew-heavy catalog, cost-sensitive** → **tiered fill**: push the hot set, pull the tail from mid-tier hubs. Tune `f_hot` to the measured access distribution.
- **Any push system** → make content **immutable and fingerprinted** so versions coexist and the swap reduces to a pointer flip; serve assets `immutable` (RFC 8246), indirection `no-cache` (RFC 9111).
- **Version swaps** → use **two-phase publish**: pre-position and confirm convergence to `D_max`, then flip a small manifest pointer. Never flip on a timer; flip on confirmed ACKs.
- **Topology** → never star at scale; fan out through regional hubs so origin egress is `O(hubs·S)` not `O(P·S)`, and the convergence window is depth-bounded, not P-bounded.
- **Retention** → keep `V ≥ 2` live versions so rollback is a pointer flip, not a re-distribution.

---

## 10. Summary

- Push inverts pull: correctness shifts from cache freshness to **distributed convergence** — "has version `v` reached every target PoP?"
- Distribution uses **tree fan-out through hubs**, not a star: origin egress drops from `O(P·S)` to `O(hubs·S)`, and the convergence window from P-bounded to depth-bounded.
- **Propagation time** `D_i` decomposes into per-hop propagation + serialization + queueing; the convergence window `W = D_max` is a *tail* quantity, so gate on confirmed ACKs, never a timer.
- **Fingerprinted, content-addressed naming** makes objects immutable by construction: a byte change forces a new name, so versions coexist and there is never "the same URL with different bytes."
- **`Cache-Control: immutable` (RFC 8246)** lets fingerprinted assets be cached forever with *zero* revalidation, while the mutable indirection is `no-cache` (RFC 9111 — store-but-revalidate) to observe swaps.
- Full replication costs `C·R·P·V` — the worked example is `20 TB · 1.4 · 120 · 2 = 6.72 PB`, a **336×** multiple of the logical catalog; tiered fill with `f_hot = 0.2` cuts it to ~1.68 PB (**4×** saving) at the cost of a fast hub-fetch on cold-tail misses.
- A **two-phase publish** — pre-position immutable assets to global convergence, then atomically flip a small manifest pointer — hides the convergence window and delivers **read-your-writes at the edge**, with instant, symmetric rollback because prior immutable versions are retained (`V ≥ 2`).

*Next step:* [Push CDN — Staff](staff.md)
