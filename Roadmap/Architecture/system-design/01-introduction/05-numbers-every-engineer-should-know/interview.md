# Numbers Every Engineer Should Know — Interview Questions

A back-of-the-envelope estimate done out loud is the single highest-signal thing you can do in a system-design interview. It proves you can reason about *scale* instead of reciting buzzwords. This page drills the canonical latency, throughput, and storage numbers — and, more importantly, the *arithmetic* that turns "build me a Twitter" into "≈14k tweet-writes/s, ≈21 TB/day of media, ≈350 GB/day of text." Every answer shows its work.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)
6. [The Cheat Sheet](#the-cheat-sheet)

---

## Junior Questions

**Q1: What are the "latency numbers every programmer should know," and why memorize them?**

> They are Jeff Dean's canonical 2009 table of how long fundamental operations take, spanning roughly nine orders of magnitude. You memorize the *relative* magnitudes, not the exact nanoseconds, because they tell you instantly where the bottleneck in any design will be. The classic anchors:
>
> | Operation | Latency | Human-scale analogy (×10⁹) |
> |---|---|---|
> | L1 cache reference | 0.5 ns | 1 second |
> | Branch mispredict | 5 ns | 10 seconds |
> | L2 cache reference | 7 ns | 14 seconds |
> | Mutex lock/unlock | 25 ns | 25 seconds |
> | Main memory (RAM) reference | 100 ns | 1.5 minutes |
> | Compress 1 KB (Zippy/Snappy) | ~2 µs | ~30 minutes |
> | Send 1 KB over 1 Gbps network | ~10 µs | ~3 hours |
> | Read 1 MB sequentially from RAM | ~10 µs | ~3 hours |
> | Round trip within a datacenter | ~500 µs | ~5.8 days |
> | Read 1 MB sequentially from SSD | ~1 ms | ~11.6 days |
> | Disk seek (HDD) | ~10 ms | ~4 months |
> | Read 1 MB sequentially from HDD | ~20–30 ms | ~1 year |
> | Network round trip CA → Netherlands | ~150 ms | ~5 years |
>
> The human-scale column multiplies every latency by 1 billion so that 1 ns becomes 1 second. That re-scaling is the whole point: it makes "memory is fast, disk is slow, the network is *really* slow" something you *feel*. The lesson that falls out for free: a single cross-region round trip (150 ms) costs as much as **150,000 main-memory reads** — so chasing one extra network hop matters infinitely more than shaving a few cache misses.

> 🎞️ **See it animated:** [Latency Numbers Every Programmer Should Know — Colin Scott](https://colin-scott.github.io/personal_website/research/interactive_latency.html)

**Q2: How many seconds are in a day, and why does an engineer need that number cold?**

> **86,400 seconds.** (60 × 60 × 24 = 86,400.) It is the most-used number in capacity estimation because traffic is almost always quoted *per day* but systems are sized *per second*. The shortcut most engineers actually use is to round to **~100,000 (10⁵)** for fast division. So:
>
> - 1 million events/day ÷ 86,400 ≈ **11.6 events/s** (≈10/s with the 10⁵ round).
> - 1 billion events/day ÷ 86,400 ≈ **11,574 events/s** (≈10,000/s rounded).
>
> Memorize the chain: **1 M/day ≈ 12/s, 100 M/day ≈ 1,200/s, 1 B/day ≈ 11.6k/s.** If someone says "we do 2 billion requests a day," you should be able to say "~23k QPS average" without reaching for a calculator. Two related numbers worth holding: ~2.6 million seconds in a month (30 days) and ~31.5 million in a year (handy for cost-per-year math).

**Q3: What are the powers-of-two data-size units, and what's the trap?**

> Storage and memory grow in powers of two, but each step is a factor of 1024 (2¹⁰), not 1000:
>
> | Power | Exact value | Approx | Name |
> |---|---|---|---|
> | 2¹⁰ | 1,024 | ~1 thousand | Kilo (KB) |
> | 2²⁰ | 1,048,576 | ~1 million | Mega (MB) |
> | 2³⁰ | 1,073,741,824 | ~1 billion | Giga (GB) |
> | 2⁴⁰ | ~1.1 × 10¹² | ~1 trillion | Tera (TB) |
> | 2⁵⁰ | ~1.1 × 10¹⁵ | ~10¹⁵ | Peta (PB) |
> | 2⁶⁰ | ~1.15 × 10¹⁸ | ~10¹⁸ | Exa (EB) |
>
> The trap is **bits vs. bytes**. Network speeds are quoted in *bits* per second (Gbps), storage in *bytes*. A "1 Gbps" link moves 1,000,000,000 bits/s = **125 MB/s** (divide by 8). Confusing these is an 8× error — the most common back-of-envelope mistake there is. For estimation you can treat 1 KB ≈ 10³ bytes and 1 MB ≈ 10⁶ bytes; the 2.4% drift per step doesn't matter when your inputs are guesses anyway.

**Q4: Roughly how big is a tweet, a typical web image, and a minute of video? Why carry these around?**

> Rough working numbers — accurate enough for sizing:
>
> | Item | Size |
> |---|---|
> | A short text message / tweet (280 chars) | ~300 B (call it ~1 KB with metadata) |
> | A typical JSON API response | 1–10 KB |
> | A compressed web image (thumbnail/photo) | 100 KB – 1 MB |
> | One minute of standard-def video | ~5–10 MB |
> | One minute of 1080p video | ~30–50 MB |
> | One hour of 1080p streaming | ~1–3 GB |
>
> You carry them because every storage and bandwidth estimate is `count × size`. If you can't put a number on the *size* of one object, you can't size the system. A useful rule: text is cheap (bytes to kilobytes), images are 1000× heavier, video is another 100–1000× on top of that. The instant you hear "media," the storage budget jumps by orders of magnitude and the design pivots toward object stores and CDNs.

**Q5: What does "QPS" mean and how do you get from a daily user count to it?**

> QPS = queries (or requests) per second — the rate your system must serve. The standard derivation:
>
> 1. Start with **DAU** (daily active users).
> 2. Multiply by **actions per user per day** to get daily requests.
> 3. Divide by 86,400 for the **average** QPS.
> 4. Multiply by a **peak factor** (typically 2–5×) for the **peak** QPS you actually provision for.
>
> Worked example — 10 M DAU, each making 20 requests/day:
> - Daily requests = 10 M × 20 = **200 M/day**
> - Average QPS = 200 M ÷ 86,400 ≈ **2,315/s**
> - Peak QPS (×3) ≈ **~7,000/s**
>
> You always size for peak, not average, because the average is a lie that smooths over the dinner-time spike. Provisioning for the mean guarantees you fall over at the worst possible moment.

---

## Middle Questions

**Q6: Walk me through estimating storage for a photo-sharing app with 10 M DAU.**

> State assumptions out loud, then chain `count × size`:
>
> - **Assumptions:** 10 M DAU, 10% upload a photo daily → 1 M uploads/day. Average stored photo (after compression + thumbnails) ≈ 1.5 MB.
> - **Daily new storage** = 1 M × 1.5 MB = **1.5 TB/day**.
> - **Yearly** = 1.5 TB × 365 ≈ **548 TB/year**.
> - **With replication (3×)** for durability → ~1.6 PB/year of raw disk.
> - **Over 5 years** ≈ **8 PB**.
>
> Then sanity-check direction: 8 PB across 5 years is firmly "object store + lifecycle tiering to cold storage" territory, not "a bigger Postgres box." The number's job isn't precision — it's to tell you *which class of solution* you're in. If your back-of-envelope says "fits on one SSD," you're over-engineering; if it says "petabytes," you need sharding, tiering, and a CDN.

**Q7: How do you estimate bandwidth, and what's the read-vs-write asymmetry?**

> Bandwidth = `request_rate × payload_size`, done separately for ingress (writes) and egress (reads). For most consumer products **reads dwarf writes** — a read:write ratio of 100:1 or even 1000:1 is normal because each uploaded photo is viewed by many followers many times.
>
> Worked example — the photo app above (1 M uploads/day, 1.5 MB each, 100:1 read:write):
> - **Write bandwidth (ingress):** 1 M × 1.5 MB ÷ 86,400 s ≈ 17.4 MB/s ≈ **140 Mbps**.
> - **Reads:** 100 M views/day × 1.5 MB ÷ 86,400 ≈ 1,736 MB/s ≈ **~14 Gbps average**, and ×3 at peak ≈ **~42 Gbps**.
>
> The asymmetry is the single most important design driver: 42 Gbps of egress is *exactly* why you put a CDN in front. Offloading reads to edge caches turns a multi-terabit origin problem into a cache-hit-ratio problem. Always estimate reads and writes separately — collapsing them into one "QPS" number hides the design.

**Q8: Estimate the QPS and storage for a URL shortener like bit.ly.**

> A classic. Assumptions: 100 M new URLs/month, read:write ratio of 100:1 (links are clicked far more than created).
>
> - **Write QPS:** 100 M ÷ (30 × 86,400) = 100 M ÷ 2.6 M ≈ **40 writes/s**.
> - **Read QPS:** 40 × 100 = **4,000 reads/s** (peak maybe ~10k).
> - **Storage per record:** short code (7 chars) + long URL (~100 B) + metadata ≈ 500 B. Round to **~0.5 KB**.
> - **Storage/month:** 100 M × 0.5 KB = **50 GB/month**.
> - **Over 5 years:** 50 GB × 60 ≈ **3 TB**.
>
> Conclusions that fall out: 3 TB of key→value data fits comfortably in a sharded KV store or even a single beefy DB with a read replica; 4k read QPS is trivially cacheable (the hot 20% of links serve 80% of clicks), so a Redis cache absorbs nearly all reads. The numbers say: this is a *caching* problem, not a *storage* problem.

**Q9: How many characters do you need in a short code, and how do you compute it?**

> This is a sizing-by-encoding question. With a 7-character code using base-62 (a–z, A–Z, 0–9):
>
> - 62⁷ = 62×62×62×62×62×62×62 ≈ **3.5 × 10¹²** ≈ **3.5 trillion** unique codes.
>
> Check it against demand: at 100 M URLs/month you generate 1.2 B/year, so 3.5 trillion lasts **~2,900 years**. Six characters (62⁶ ≈ 56 billion) lasts only ~47 years at that rate — fine, but 7 gives generous headroom. The general formula: codes needed = `creation_rate × lifetime`, and characters = `ceil(log_base(codes_needed))`. Knowing `log₆₂` isn't required — just memorize that **base-62 gives ~2 characters per ~3,800×**, or simply that 62⁶ ≈ 5.6e10 and each extra char multiplies by 62.

**Q10: Compare disk, SSD, RAM, and network for sequential throughput. Why does this drive design?**

> | Medium | ~Sequential read of 1 MB | Relative to RAM |
> |---|---|---|
> | RAM | ~10 µs | 1× (baseline) |
> | NVMe SSD | ~50–100 µs | ~5–10× slower |
> | SATA SSD | ~1 ms | ~100× slower |
> | Network (1 Gbps, same DC) | ~10 ms incl. round trips | ~1000× slower |
> | HDD | ~20–30 ms | ~2000–3000× slower |
>
> The design consequence: **keep the hot working set in RAM, the warm set on SSD, the cold set on HDD/object storage**, and minimize how often you cross the network. Each tier down is roughly 10–100× slower, so a cache miss that forces a disk seek isn't a small regression — it's a 1000× cliff. This hierarchy is *why* caching exists, why we batch I/O, and why "sequential good, random bad" is a mantra: random HDD seeks (10 ms each) make you a hundred times slower than streaming.

**Q11: What's a read:write ratio and how does it change your architecture?**

> It's the ratio of read operations to write operations for a given workload. It dictates which side of the system you optimize:
>
> | Ratio | Typical workload | Architecture pivot |
> |---|---|---|
> | ~1:1 | Chat, collaborative editing | Balance both; careful with write contention |
> | ~10:1 | Social feeds (moderate) | Read replicas + caching |
> | ~100:1 | News, blogs, e-commerce browsing | Aggressive caching + CDN, denormalize for reads |
> | ~1000:1+ | Viral content, popular product pages | CDN does almost all the work; origin barely touched |
>
> A read-heavy system (100:1) wants read replicas, materialized views, denormalization, and CDN/edge caching — you *trade write complexity for read speed*. A write-heavy or balanced system (1:1) wants efficient write paths: LSM-tree storage, write batching, sharding by write key, async processing via queues. Asking "what's the read:write ratio?" early is how you avoid optimizing the wrong half of the system.

**Q12: Estimate the cache memory needed to hold the "hot" data for a system serving 1 M reads/s.**

> Apply the **80/20 (Pareto) rule**: roughly 20% of items get 80% of traffic, so cache the hot 20%. Suppose 100 M distinct items, each ~1 KB:
>
> - Hot set = 20% × 100 M = **20 M items**.
> - Memory = 20 M × 1 KB = **20 GB**.
>
> 20 GB fits in a single modern cache node (or a small Redis cluster with replication). At a typical **~90%+ cache hit ratio**, your 1 M reads/s collapses to ~100k reads/s hitting the database — a 10× reduction. The arithmetic justifies the cache: without it the DB sees 1 M QPS (impossible for a single instance); with 20 GB of RAM it sees a tenth of that. Always express the cache's value as the *origin load it removes*, not just "it's faster."

---

## Senior Questions

**Q13: Why is p99 latency not the same as the mean, and why do you design against the tail?**

> The mean is a single number that *hides the distribution*. Real latency distributions are heavily right-skewed: most requests are fast, but a long tail (GC pauses, cache misses, lock contention, retries, a slow disk) drags the high percentiles far out. A service can have a 10 ms mean and a 200 ms p99 simultaneously.
>
> | Percentile | Meaning | Typical multiple of median |
> |---|---|---|
> | p50 (median) | Half of requests faster than this | 1× |
> | p90 | 1 in 10 requests slower | ~2–3× |
> | p99 | 1 in 100 requests slower | ~5–10× |
> | p99.9 | 1 in 1,000 requests slower | ~10–50× |
>
> You design against the tail because **users experience the tail, not the mean.** A user who makes 100 requests in a session will almost certainly hit your p99 at least once. For internal services, tail latency is even worse because of fan-out (next question). The senior move is to set SLOs on *percentiles* (e.g. "p99 < 200 ms"), and to track them per-endpoint — averaging across endpoints re-hides the very tail you care about.

**Q14: Explain tail latency amplification under fan-out, with the math.**

> When one request fans out to many backends in parallel and must wait for *all* of them, the slowest backend determines the user's latency. So even a rare slow response becomes likely at the request level.
>
> If a single backend responds slower than its p99 latency 1% of the time, then with **N parallel calls**, the probability that *at least one* is slow is:
>
> - P(at least one slow) = 1 − (0.99)^N
> - N = 1 → 1%
> - N = 10 → 1 − 0.99¹⁰ ≈ **9.6%**
> - N = 100 → 1 − 0.99¹⁰⁰ ≈ **63%**
>
> So a service that fans out to 100 shards sees its *own* p99 (the thing the user feels) governed by the backends' p99 roughly **63% of the time**. The individual-server p99 has become the aggregate's *common case*.
>
> ```mermaid
> flowchart TD
>     subgraph STAGE1["Stage 1 — request arrives"]
>       U["Client request"] --> AGG["Aggregator / scatter"]
>     end
>     subgraph STAGE2["Stage 2 — parallel fan-out to N=100 shards"]
>       AGG --> S1["Shard 1 (fast)"]
>       AGG --> S2["Shard 2 (fast)"]
>       AGG --> S3["Shard ... (fast)"]
>       AGG --> S99["Shard 99 (fast)"]
>       AGG --> SLOW["Shard 100 (slow, hit its p99)"]
>     end
>     subgraph STAGE3["Stage 3 — must wait for ALL, slowest wins"]
>       S1 --> WAIT["Join: latency = max of all shards"]
>       S2 --> WAIT
>       S3 --> WAIT
>       S99 --> WAIT
>       SLOW --> WAIT
>       WAIT --> RESP["Response = governed by the slow shard"]
>     end
> ```
>
> Mitigations all follow from the math: **hedged requests** (send a duplicate after a short delay, take the first to return), **tied requests**, reducing fan-out width, and making each backend's tail tighter. This is the core insight from Dean & Barroso's "The Tail at Scale."

**Q15: What does the speed of light impose on cross-region latency, and can you beat it?**

> Light in fiber travels at roughly **⅔ of c**, i.e. ~200,000 km/s (≈ 5 µs per km, one way). That's a hard physical floor — no amount of engineering beats it. So for any two points you can compute a *minimum* round-trip time (RTT) from distance alone:
>
> - **New York ↔ London** ≈ 5,500 km. One way ≈ 5,500 × 5 µs = 27.5 ms; round trip ≈ **55 ms minimum** (real-world ~70–80 ms with routing/switching overhead).
> - **US East ↔ US West** ≈ 4,000 km → RTT floor ≈ **40 ms** (real ~60–70 ms).
> - **California ↔ Singapore** ≈ 14,000 km → RTT floor ≈ **140 ms** (real ~170–180 ms).
> - **Antipodal (halfway around Earth)** ≈ 20,000 km → RTT floor ≈ **~200 ms**.
>
> You cannot make a cross-Atlantic synchronous round trip faster than ~55 ms; you can only **avoid making the trip**. That's the entire justification for: edge caching/CDNs (serve from near the user), read replicas in each region, asynchronous replication (don't block writes on a transoceanic ack), and CRDTs/eventual consistency (let regions diverge and reconcile). Anyone who promises "globally strongly consistent with single-digit-ms latency" is selling physics-defying snake oil — strong global consistency *costs* at least one inter-region RTT.

**Q16: How have these numbers changed since the 2009 table, and what design assumptions broke?**

> The relative hierarchy holds, but two absolute shifts matter enormously:
>
> | Operation | 2009 era | ~2020s (NVMe / modern) | Change |
> |---|---|---|---|
> | Random read from "disk" | ~10 ms (HDD seek) | ~10–100 µs (NVMe SSD) | **~100–1000× faster** |
> | Sequential read 1 MB from SSD | ~1 ms | ~50–100 µs | ~10–20× faster |
> | DC round trip | ~500 µs | ~100–500 µs | modest improvement |
> | Network bandwidth | 1 Gbps common | 10–100 Gbps common | ~10–100× more |
> | Cross-region RTT | ~150 ms | ~150 ms | **unchanged (physics)** |
>
> The big break: **"disk is slow" stopped meaning "10 ms random seek."** NVMe SSDs collapsed random-read latency by ~3 orders of magnitude, which changed the calculus for B-trees vs LSM-trees, made "store it on disk" viable for latency-sensitive paths, and shrank the gap between RAM and storage from 100,000× to ~100–1000×. What *did not* change: the speed of light, so cross-region latency is exactly where it was. Designs built on "the network is the bottleneck across regions" are still correct; designs built on "random disk I/O is catastrophic" need re-examination on NVMe.

**Q17: Estimate the average and peak QPS for a system, then explain how you'd provision capacity.**

> Take a notification service: 50 M DAU, average 5 notifications received/day, plus a burst pattern.
>
> - Daily events = 50 M × 5 = **250 M/day**.
> - Average QPS = 250 M ÷ 86,400 ≈ **2,900/s**.
> - **Peak factor:** notifications spike (morning, lunch, evening) — use ×4 → peak ≈ **~11,600/s**.
>
> Provisioning math: if one server handles ~1,000 QPS comfortably (leaving headroom), peak needs ~12 servers. But you add **headroom for failures** (N+2 or 1.5× over peak), so ~18 servers. The principles:
>
> 1. **Size for peak, not average** — average traffic never fails you; the peak does.
> 2. **Add failure headroom** — a server can die mid-peak; you must absorb that without cascading.
> 3. **Account for retries** — a partial outage *increases* load via retry storms; bursty peak can be 2× the steady peak.
> 4. **Autoscale on a leading metric** (queue depth, CPU) but keep a warm floor — cold-start latency means you can't scale *during* a spike, only ahead of it.

**Q18: How do you estimate a cloud bill and cost-per-request for a service?**

> Decompose the bill into its big rocks and divide by traffic. Take a service doing 1 B requests/month:
>
> - **Compute:** 20 servers (e.g. 4-vCPU instances) at ~$0.20/hr × 730 hr ≈ **$2,920/mo**.
> - **Egress bandwidth** (usually the silent killer): say 50 TB/month out at ~$0.08/GB ≈ **$4,000/mo**.
> - **Storage:** 10 TB on object storage at ~$0.023/GB ≈ **$230/mo**.
> - **Database / managed services:** ~**$2,000/mo**.
> - **Total ≈ $9,150/mo.**
>
> **Cost per request** = $9,150 ÷ 1 B ≈ **$0.0000092**, i.e. ~**$0.0092 per 1,000 requests** (less than a cent per thousand). That per-unit number is the one that scales your thinking: at 100 B requests/month the bill is ~$915k/mo, and now a 20% bandwidth optimization is worth ~$183k/mo — suddenly engineering time on compression is obviously justified. The two lessons: **egress bandwidth usually dominates** at scale (which re-justifies the CDN), and **cost-per-request makes optimizations comparable to engineer salaries** so you can decide what's worth doing.

---

## Professional / Deep-Dive Questions

**Q19: Estimate the full design budget for a Twitter-like feed: writes, reads, storage, and bandwidth.**

> State assumptions, then run every axis. Assumptions: 200 M DAU, each posts 2 tweets/day, each reads 100 tweets/day; 10% of tweets include media (~1 MB), tweet text ~300 B + metadata ~700 B ≈ 1 KB.
>
> **Write QPS (tweets created):**
> - 200 M × 2 = 400 M tweets/day ÷ 86,400 ≈ **4,630 writes/s**; peak ×3 ≈ **~14k/s**.
>
> **Read QPS (timeline reads):**
> - 200 M × 100 = 20 B reads/day ÷ 86,400 ≈ **231,000 reads/s**; peak ×3 ≈ **~700k/s**.
> - Read:write ≈ **50:1** → heavily read-optimized → fan-out-on-write (precompute timelines) for most users.
>
> **Storage (text):**
> - 400 M × 1 KB = 400 GB/day → **~146 TB/year** of tweet text. With 3× replication ≈ **~440 TB/year**.
>
> **Storage (media):**
> - 10% × 400 M = 40 M media/day × 1 MB = 40 TB/day → **~14.6 PB/year** raw; with replication ≈ **~44 PB/year**. Media dominates storage by ~100×.
>
> **Read bandwidth (egress):**
> - 20 B reads/day, but most are cached text (~1 KB) with occasional media. Text egress: 20 B × 1 KB ÷ 86,400 ≈ **231 GB/s ≈ 1.85 Tbps** average. Media views drive far more. → **This is a CDN-and-edge problem**, full stop; origin cannot serve terabits.
>
> The synthesis: text is a *throughput/caching* problem (700k read QPS → precomputed timelines in Redis), media is a *storage + CDN* problem (petabytes/year, terabits of egress). The numbers force the architecture, not the other way around.

**Q20: When does fan-out-on-write break, and what number tells you to switch to fan-out-on-read?**

> Fan-out-on-write (push a new tweet into every follower's precomputed timeline) cost = `posts × average_followers`. It's great when followers are few, catastrophic when they're millions.
>
> - Normal user: 1 post × 500 followers = 500 timeline writes. Fine.
> - Celebrity: 1 post × 50,000,000 followers = **50 M timeline writes for a single tweet**. At even 10 µs per write that's 500 seconds of work and a massive write amplification spike.
>
> The number that triggers the switch is **follower count crossing a threshold (~10k–100k)**. Above it, fan-out-on-write's per-post cost explodes, so you go **hybrid**: push for normal users (cheap, keeps reads fast), but for celebrities *don't* fan out — instead pull their tweets at read time and merge into the follower's timeline. The total write amplification of the system = `Σ(followers)` over all posters; once a handful of accounts dominate that sum, the celebrity special-case pays for itself. The estimate ("50 M writes per tweet") is exactly what reveals the breakage.

**Q21: Estimate the number of servers needed and explain the load-per-server reasoning.**

> Servers = `peak_QPS ÷ per_server_capacity`, plus failure and headroom margins. Take the 700k read QPS feed system:
>
> - Assume each app server handles ~5,000 read QPS (mostly cache hits, lightweight): 700,000 ÷ 5,000 = **140 servers** at peak.
> - **Failure headroom (N+20%):** ~168 servers so losing a few doesn't cascade.
> - **Cache tier:** to hold the hot timeline data — say 50 GB hot set per Redis node, hot data ~2 TB → ~40 cache nodes + replicas.
> - **Database:** writes at 14k/s peak, ~2k writes/s per shard → ~7 write shards, ×3 for replicas = ~21 DB nodes.
>
> The reasoning that matters in an interview: **derive per-server capacity from the latency budget**, not a guess. If your SLA is p99 < 100 ms and each request does work taking ~5 ms of CPU, one core does ~200/s; an 8-core box does ~1,600/s before queueing theory says latency degrades (you keep utilization below ~70% to protect the tail). That's how you justify "5,000 QPS/server" rather than asserting it — Little's Law and utilization headroom, not vibes.

**Q22: How do you sanity-check a vendor's or colleague's claim in 30 seconds using these numbers?**

> Run a dimensional / order-of-magnitude check: convert the claim to a per-second or per-byte rate and compare against physical limits. Examples of the genre:
>
> - **"We serve 1 M requests/second from a single node."** Check: at 1 KB each that's 1 GB/s = 8 Gbps just in payload — plausible only on a 10/25 Gbps NIC doing trivial work; if each request hits disk (even NVMe at ~100 µs) one core caps near ~10k/s, so 1 M/s needs ~100 cores of pure I/O. → *Suspicious unless it's an in-memory cache.*
> - **"Our globally-distributed DB does strongly consistent writes in 5 ms across continents."** Check: cross-Atlantic RTT floor is ~55 ms (speed of light). Strong consistency needs at least one round trip. → *Physically impossible; they mean regional, or eventual.*
> - **"We store 1 PB in RAM."** Check: 1 PB ÷ ~1 TB/server = 1,000 servers of pure RAM, ~$millions. → *Either it's huge spend or they mean SSD.*
> - **"This single Postgres handles 500k writes/s."** Check: even at 10 µs/write that's the entire CPU, ignoring fsync (~1 ms for durable commit → ~1k/s/connection without batching). → *Needs batching/group-commit or it's not durable.*
>
> The technique: **pick the one number that's a hard floor** (speed of light, NIC bandwidth, fsync latency, RAM cost) and see if the claim violates it. If it does, the claim is wrong or redefined. This 30-second reflex catches most magical-thinking in design reviews.

---

## Staff / Judgment Questions

**Q23: When is a back-of-the-envelope estimate good enough, and when is it dangerously wrong?**

> An estimate is *good enough* when its job is to choose between architectural classes that differ by an order of magnitude — "does this fit in RAM or need a database?", "single region or multi?", "CDN or not?". Order-of-magnitude precision answers order-of-magnitude questions, and being off by 2× rarely flips the answer.
>
> It becomes *dangerous* in a few specific ways:
>
> 1. **Wrong shape of distribution.** Estimating with the *mean* when the tail or skew dominates: a "fits in one cache node" answer is wrong if 0.1% of keys are 1000× larger (hot-key / heavy-tail), or if traffic is 100× spikier than the daily average implies.
> 2. **Compounding optimism.** Each assumption rounded the "friendly" way (lower size, lower peak factor, higher cache hit) silently multiplies into a 10× under-estimate. Senior engineers deliberately round *pessimistically* on the dimensions they can't control.
> 3. **Ignoring the second-order load.** Retries, replication fan-out, write amplification, and re-balancing traffic can be a large multiple of the user-visible load. Estimating only the happy path under-provisions for the failure mode that actually takes you down.
> 4. **Treating it as a commitment.** The estimate sizes the *design*; it does not replace load testing the *implementation*. Staff judgment is knowing the envelope tells you *which way to build*, and the load test tells you *whether you built it right*.
>
> The mature stance: estimate to *eliminate wrong architectures cheaply*, then measure to *validate the chosen one*. Never ship capacity decisions on the envelope alone, and never start designing without one.

**Q24: Two designs both "work" on paper. How do the numbers help you choose, beyond just feasibility?**

> Feasibility is table stakes; the numbers let you compare designs on the axes that actually matter at scale — **cost, blast radius, and operational tail** — and to express trade-offs in commensurable units.
>
> - **Convert everything to $/request and $/GB.** Design A (denormalized, fan-out-on-write) costs more storage and write amplification; Design B (normalized, fan-out-on-read) costs more read-time compute. Put both into dollars at the *projected* traffic, not today's. The crossover point — the traffic level where A becomes cheaper than B — is a *number*, and it tells you when to migrate. Choosing without computing that crossover is choosing blind.
> - **Use the latency budget as a constraint, not an afterthought.** If the product SLO is p99 < 150 ms and the design includes a cross-region synchronous hop (≥55 ms floor) plus a DB query (~10 ms) plus app work (~20 ms) plus its own tail amplification, you may have *already spent the budget* before adding retries. The numbers reveal that one design is infeasible at the required percentile even though it "works" at the mean.
> - **Size the blast radius.** A design where one shard holds 50% of traffic (poor key distribution) has a number attached: losing it drops half your users. A well-distributed design caps single-node loss at `1/N`. Quantifying the worst-case node failure turns "more resilient" from an adjective into a comparison.
> - **Weigh the operational tail.** The cheaper-on-paper design might require 3× the shards, which is 3× the rebalancing events, backups, and on-call surface. Multiply by your team's real failure rate and the "expensive" design can be cheaper in incident-hours.
>
> The staff-level move is to refuse the binary "does it work?" and instead produce a small table — cost/request, p99 budget consumed, max single-node blast radius, operational unit count — for each candidate. That table, populated with the same back-of-envelope numbers from this page, is what turns an architecture debate into a decision. The engineer who can fill it in *during the meeting* is the one whose design ships.

---

## The Cheat Sheet

Keep these in muscle memory — they cover ~90% of estimation questions.

| Category | Number to remember |
|---|---|
| Seconds in a day | **86,400 (~10⁵)** |
| 1 M/day → /s | **~12/s** |
| 1 B/day → /s | **~11.6k/s** |
| L1 cache | 0.5 ns |
| Main memory (RAM) | ~100 ns |
| Read 1 MB from RAM | ~10 µs |
| SSD random read (NVMe) | ~10–100 µs |
| Datacenter round trip | ~0.5 ms |
| Read 1 MB from SSD | ~1 ms (NVMe ~0.1 ms) |
| HDD seek | ~10 ms |
| Read 1 MB from HDD | ~20–30 ms |
| Cross-US RTT | ~40–70 ms |
| Cross-Atlantic RTT | ~55–80 ms |
| Cross-Pacific RTT | ~150–180 ms |
| Speed of light in fiber | ~5 µs/km (≈⅔ c) |
| 1 Gbps in bytes | **125 MB/s** (÷8) |
| 1 KB / 1 MB / 1 GB | 10³ / 10⁶ / 10⁹ bytes |
| Peak factor over average | ×2 to ×5 |
| Pareto hot-set | 20% of data = 80% of traffic |
| Typical fan-out tail | 100 backends → p99 hit ~63% of the time |

**The estimation recipe, every time:**
1. State assumptions out loud (DAU, actions/user, object size).
2. Compute writes and reads *separately*; find the read:write ratio.
3. Divide daily counts by 86,400 for average; multiply by peak factor.
4. Storage = count × size × replication × retention.
5. Bandwidth = rate × payload, separated into ingress/egress.
6. Sanity-check against a hard physical floor (speed of light, NIC, fsync, $/GB).
7. Round pessimistically on what you can't control; keep one significant figure.

The goal is never a precise number — it's to land on the *right order of magnitude* fast enough to steer the design while everyone is still in the room.

*Next step:* [CAP Theorem](../../02-tradeoffs-framework/01-cap-theorem/junior.md)
