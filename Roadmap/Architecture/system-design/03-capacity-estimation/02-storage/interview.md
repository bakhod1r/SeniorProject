# Storage Estimation — Interview Questions

A capacity interview lives or dies on storage. Bandwidth and QPS reset to zero
every second; storage only ever goes up. A single byte of overhead per row,
multiplied across a few hundred billion rows, three replicas, and seven years
of retention, becomes petabytes that someone pays for every month forever. This
file drills the arithmetic, the unit discipline, and the judgment that separate
a candidate who "knows the formula" from one who can defend a multi-petabyte bill
in front of a finance partner.

Every answer shows the arithmetic explicitly. Round aggressively in interviews
(powers of ten, `10^9 ≈ 2^30`), but never hand-wave the multipliers — the
multipliers are where the petabytes hide.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is the core storage-estimation formula, and what does each term mean?**

> Storage is a product of five independent factors:
>
> ```
> total_bytes = object_size × new_objects_per_day × retention_days × replication_factor × overhead_multiplier
> ```
>
> - **object_size** — average bytes per record *including* per-row and index overhead, not just the payload.
> - **new_objects_per_day** — write rate × seconds per day. 1 write/s ≈ 86,400/day ≈ 10^5/day.
> - **retention_days** — how long you keep it. The single biggest lever and a policy decision, not a technical one.
> - **replication_factor (RF)** — copies for durability/availability, typically 3.
> - **overhead_multiplier** — backups, snapshots, secondary indexes, write amplification, free-space headroom.
>
> The discipline is to estimate each factor independently and out loud, then
> multiply. A wrong answer is almost always a *missing factor* (forgot RF,
> forgot indexes), not a multiplication error.

**Q2: Walk through the unit ladder. How many bytes is a kilobyte, megabyte, gigabyte, terabyte, petabyte?**

> Each step is ×1000 in the decimal (SI) convention that estimation uses:
>
> | Unit | Bytes | Power | Mnemonic |
> |------|-------|-------|----------|
> | KB | 10^3 | thousand | a short text message |
> | MB | 10^6 | million | one minute of MP3, a small photo |
> | GB | 10^9 | billion | a movie, a small database |
> | TB | 10^12 | trillion | a consumer SSD, a large user table |
> | PB | 10^15 | quadrillion | the whole product at scale |
> | EB | 10^18 | quintillion | hyperscaler-fleet territory |
>
> Binary units (KiB = 2^10 = 1024) differ by ~2.4% at TB and ~12.6% by EB.
> For back-of-envelope work, treat `2^10 ≈ 10^3` and move on; just be
> consistent. State which convention you are using so the interviewer isn't
> guessing.

**Q3: Give typical sizes for common objects you'd use as estimation anchors.**

> Memorize a short table of anchors so you never stall:
>
> | Object | Typical size |
> |--------|-------------|
> | One char / ASCII byte | 1 B |
> | UUID (binary / string) | 16 B / 36 B |
> | int64 / timestamp | 8 B |
> | A tweet / short post (text) | ~300 B (140 chars + metadata) |
> | A typical DB row | ~1 KB |
> | A web page (HTML) | ~100 KB |
> | A JPEG photo (compressed) | ~200 KB – 2 MB |
> | One minute of 1080p video | ~50 MB (~6–8 Mbps) |
> | One hour of 1080p video | ~3–4 GB |
>
> These are *order-of-magnitude* anchors. The interviewer cares that a photo is
> "hundreds of KB to a few MB," not whether you said 1.5 MB or 1.8 MB.

**Q4: A service writes 100 records/second, each 2 KB, kept for 1 year. How much raw storage (RF=1)?**

> Work the factors in order:
>
> ```
> records/day = 100 × 86,400 ≈ 8.64 × 10^6 ≈ 10^7 /day
> bytes/day   = 10^7 × 2 KB = 2 × 10^7 KB = 2 × 10^10 B = 20 GB/day
> per year    = 20 GB × 365 ≈ 7,300 GB ≈ 7.3 TB
> ```
>
> So ~7 TB raw at RF=1. The follow-up to volunteer immediately: at RF=3 plus a
> ~30% backup/overhead multiplier, the provisioned footprint is closer to
> `7.3 × 3 × 1.3 ≈ 28 TB`. Never quote the RF=1 number as the final answer.

**Q5: Why do we multiply by a replication factor? What is a typical RF?**

> A single copy means one disk failure equals data loss. Distributed stores keep
> **N copies on independent failure domains** (different disks, racks, often
> availability zones) so the system survives hardware death and stays readable
> during a node outage. RF=3 is the industry default — it tolerates the loss of
> two replicas while a third still serves, and gives time to re-replicate before
> a correlated failure wipes the last copy.
>
> Storage cost scales linearly with RF: RF=3 means you provision and pay for 3×
> the raw logical data. That's why RF lives in the formula as an explicit
> multiplier — forgetting it under-counts the bill by 3×.

**Q6: What's the difference between raw/logical data size and provisioned/billed size?**

> - **Logical size** — the bytes your application conceptually owns (the rows, the photos).
> - **Provisioned/billed size** — what you actually pay for after every multiplier:
>
> ```
> billed = logical × RF × (1 + backup% + index% + free_space% + write_amplification%)
> ```
>
> A clean rule of thumb: **billed ≈ logical × 4–5** once you stack RF=3, a
> backup copy, secondary indexes, and ~25–30% free-space headroom (you never run
> a disk to 100%). Interviewers love watching a candidate quote logical size and
> then *forget* it isn't the bill. Always land on the provisioned number.

---

## Middle Questions

**Q7: Estimate end-to-end storage for a Twitter-like service: 500M daily active users, each posting 2 tweets/day, kept 5 years.**

> **Step 1 — write volume.**
> ```
> tweets/day = 500M × 2 = 10^9 tweets/day
> ```
>
> **Step 2 — object size.** A tweet is text (~280 chars) plus metadata (IDs,
> timestamps, counters, user ref). Call it ~300 B payload; with per-row + index
> overhead round to ~1 KB stored.
> ```
> bytes/day = 10^9 × 1 KB = 10^12 B = 1 TB/day
> ```
>
> **Step 3 — retention.**
> ```
> 5 years ≈ 1,825 days → 1 TB × 1,825 ≈ 1.8 PB logical
> ```
>
> **Step 4 — multipliers.**
> ```
> × RF (3)          → 5.5 PB
> × overhead (~1.3) → ~7 PB provisioned for tweet text alone
> ```
>
> The headline: **tweet *text* is single-digit petabytes over 5 years.** The
> punchline you must deliver: the text is the cheap part — media attached to
> those tweets dominates by 1–2 orders of magnitude. That sets up Q8.

**Q8: Now add media. Each tweet has a 10% chance of an attached photo (~1.5 MB). What does media add?**

> ```
> photos/day = 10^9 tweets × 10% = 10^8 photos/day
> bytes/day  = 10^8 × 1.5 MB = 1.5 × 10^8 MB = 1.5 × 10^14 B = 150 TB/day
> ```
>
> Compare to 1 TB/day for text — media is **150× larger per day**.
>
> ```
> 5 years: 150 TB × 1,825 ≈ 270 PB logical
> ```
>
> Media is usually stored in an object store (S3/GCS) where durability comes
> from **erasure coding (~1.3–1.5× overhead)** rather than RF=3, so:
> ```
> 270 PB × ~1.4 ≈ ~380 PB provisioned
> ```
>
> This is the lesson of the whole topic in one slide: **the metadata database is
> a rounding error; the blob store is the system.** Optimizing tweet-row layout
> saves megabytes; choosing the right media tier and compression saves hundreds
> of petabytes.

**Q9: Why split the estimate into "metadata store" and "blob store" — and how does it change the math?**

> Because they have completely different size profiles, durability mechanisms,
> and cost curves:
>
> | Dimension | Metadata DB | Blob / object store |
> |-----------|-------------|---------------------|
> | Per-object size | bytes–KB | KB–GB |
> | Durability mechanism | RF=3 replication | erasure coding (1.3–1.5×) |
> | Overhead multiplier | high (indexes, WAL) | low (no indexes) |
> | Dominant cost | IOPS / latency | raw capacity |
> | Tiering | rare | essential (hot/warm/cold) |
>
> Estimating them together hides the real cost driver. The blob store sizing
> decision is *capacity × tier price*; the metadata store decision is *IOPS and
> index footprint*. They get different optimization strategies, so you size them
> separately.

**Q10: A DB row holds two int64s, a UUID, and a 50-char varchar. What's the *real* stored size per row?**

> Logical payload first:
> ```
> 2 × int64 (8 B)   = 16 B
> UUID (binary)     = 16 B
> varchar (~50 B + length prefix) ≈ 52 B
> ----------------------------------
> payload           ≈ 84 B
> ```
>
> Then the overhead nobody counts in their first pass:
> - **Row header / tuple metadata** (Postgres ~23 B/row, plus alignment padding).
> - **Null bitmap, transaction/MVCC fields** — visibility info, xmin/xmax.
> - **Per-page free space** — pages aren't packed to 100% (fillfactor).
> - **Secondary indexes** — each index on this table is its own B-tree; a single
>   index can cost 30–100% of the table size.
>
> Realistic stored size: ~84 B payload becomes **~150–200 B/row in the heap**,
> and with two secondary indexes the *table footprint* is closer to
> **400–500 B per logical row**. Rule of thumb: **a "1 KB row" usually means
> ~200–400 B of payload plus overhead and indexes.**

**Q11: How do backups multiply storage, and how do snapshots differ?**

> - A **full backup** is a second complete copy: +1× the data, before retention
>   of multiple backup generations. Keeping 30 daily fulls = 30× — which nobody
>   does, hence incrementals.
> - **Incremental / differential backups** store only changes since the last
>   backup, so 30 days of dailies might be `1 full + 29 small deltas ≈ 1.3–2×`.
> - **Snapshots** (copy-on-write, e.g. EBS/LVM/ZFS) initially cost almost
>   nothing — they share blocks with the live volume and only diverge as data
>   changes. A snapshot's *real* cost is the churn rate × retention, not the
>   volume size.
>
> Estimation shorthand: add **+20–40%** for a backup strategy, and remember
> snapshots are cheap to take but accumulate with churn, so cap snapshot
> retention explicitly.

**Q12: What compression ratios should you assume for different data types?**

> Compression depends entirely on entropy/redundancy. Reasonable estimation defaults:
>
> | Data type | Typical ratio | Stored fraction |
> |-----------|---------------|-----------------|
> | Plain text / JSON / logs | 5–10× | 10–20% |
> | Structured columnar (analytics) | 5–20× | 5–20% |
> | Already-compressed media (JPEG/H.264/MP3) | ~1× | ~100% |
> | Encrypted data | ~1× | ~100% (random-looking) |
> | Sparse / repetitive blobs | 10–100× | 1–10% |
>
> Two interview traps: (1) **media is already compressed** — assuming gzip helps
> on photos/video is wrong and inflates savings. (2) **encrypted data doesn't
> compress** — if you encrypt before storing, model the compression *before*
> encryption or not at all. State your ratio assumption out loud; a 5× vs 10×
> guess swings a multi-PB warehouse by half.

---

## Senior Questions

**Q13: Explain hot/warm/cold tiering and how it changes a 100 PB estimate's cost (not its size).**

> Tiering exploits a near-universal access pattern: data is hot when fresh and
> goes cold fast (a tweet from 2014 is read essentially never). Storage *size*
> is unchanged; storage *cost* drops by moving cold bytes to cheaper, slower media.
>
> ```mermaid
> flowchart LR
>   subgraph STAGE1["Stage 1 — all data on hot tier"]
>     direction TB
>     H1["100 PB hot (SSD-class)<br/>$0.023/GB-mo<br/>= ~$2.3M/mo"]
>   end
>   subgraph STAGE2["Stage 2 — apply 5/15/80 access split"]
>     direction TB
>     H2["5 PB hot · $0.023"]
>     W2["15 PB warm · $0.0125"]
>     C2["80 PB cold/archive · $0.004"]
>   end
>   subgraph STAGE3["Stage 3 — blended monthly bill"]
>     direction TB
>     R3["hot  5PB×$23k  = $115k<br/>warm 15PB×$12.5k = $188k<br/>cold 80PB×$4k   = $320k<br/><b>≈ $0.62M/mo (−73%)</b>"]
>   end
>   STAGE1 --> STAGE2 --> STAGE3
> ```
>
> Same 100 PB, but the bill falls from ~$2.3M/mo to ~$0.6M/mo — a 73% cut — purely
> from tier placement driven by an age-based lifecycle policy. The trade is
> retrieval latency and per-GB retrieval fees on archive, which is fine for cold
> data that's almost never read.

**Q14: When do you choose replication (RF=3) vs erasure coding for durability, and what's the overhead difference?**

> Both protect against device loss; they trade storage overhead against
> recovery/latency characteristics.
>
> | Property | Replication (RF=3) | Erasure coding (e.g. 10+4 RS) |
> |----------|--------------------|-------------------------------|
> | Storage overhead | 3.0× (200% extra) | 1.4× (40% extra) |
> | Failures tolerated | 2 lost copies | 4 lost shards |
> | Read latency | low (read any copy) | higher (reconstruct from shards) |
> | Recovery I/O | copy one object | read many shards, recompute |
> | Best for | small, hot, latency-sensitive | large, warm/cold, cost-sensitive |
>
> The math that matters: at 100 PB logical, RF=3 provisions **300 PB**; a 10+4
> erasure code provisions **140 PB** — a **160 PB difference** (over half the
> footprint). So hot metadata and small objects stay on RF=3 for latency; large
> media and cold data go to erasure coding for cost. Choosing EC for the blob
> store in Q8 is why it's 1.4× and not 3×.

**Q15: Express durability in "nines." What does eleven nines (99.999999999%) actually buy you?**

> Durability nines describe the probability an object survives a year.
> Eleven nines = a 10^-11 annual loss probability per object.
>
> ```
> Expected annual losses = stored_objects × (1 − durability)
> ```
>
> If you store **10 billion objects** at 11 nines:
> ```
> 10^10 × 10^-11 = 0.1 objects/year → ~1 object lost every 10 years
> ```
>
> Contrast with a single un-replicated disk (~2–4% annual failure rate, roughly
> "1.5 nines" of durability): the same 10^10 objects would see catastrophic loss.
> The point for estimation: **durability is a function of replica/shard count and
> independence of failure domains**, and each additional nine costs storage
> overhead. You buy nines with multipliers, so know how many nines the
> requirement actually demands — over-provisioning durability is real money.

**Q16: At what point does data volume *force* sharding or archival rather than vertical scaling?**

> When the working set or total volume crosses a single-node ceiling:
>
> - **Single-node disk ceiling** — even large instances cap around tens of TB of
>   fast local storage; once the *hot* dataset can't fit on one node's
>   disk/RAM-cache economically, you shard.
> - **Index-in-RAM ceiling** — B-tree indexes want to live in memory. When the
>   index alone exceeds available RAM, latency collapses and you must shard or
>   archive to shrink the active index.
> - **Backup/restore window** — if a full restore would take longer than your RTO
>   (you can't restore 50 TB inside a 1-hour recovery target), the dataset is too
>   big for one node operationally, independent of whether it fits.
> - **Maintenance pain** — vacuum, reindex, and migrations that take days are a
>   forcing function on their own.
>
> Rule of thumb: think hard about sharding around **single-digit TB of hot data
> or low-thousands of write IOPS per node**, and push old data to cheaper archive
> *before* you shard, since archival is cheaper than re-sharding.

**Q17: How does write amplification inflate storage, and where does it bite?**

> Write amplification = bytes physically written ÷ logical bytes written. It
> doesn't grow *resident* size directly but inflates the device wear, the WAL,
> and transient space you must provision.
>
> - **LSM trees (RocksDB, Cassandra)** — compaction rewrites data multiple times
>   across levels; WA of **10–30×** is common. You must provision extra space for
>   compaction scratch and un-compacted overlap (often +25–50% transient).
> - **B-trees (Postgres/MySQL)** — page splits, full-page writes to WAL, and
>   fillfactor headroom inflate both writes and resident size.
> - **SSD flash translation** — erase-block granularity adds device-level WA
>   under the application.
>
> For capacity estimation, model it as a **+20–50% free-space and scratch
> multiplier** on top of logical+RF, and never plan to run an LSM store above
> ~70–80% disk utilization — compaction needs the room or it stalls.

---

## Professional / Deep-Dive Questions

**Q18: Estimate storage for a video platform: 500 hours of video uploaded per minute (YouTube-scale), kept indefinitely, with multiple transcoded renditions.**

> **Step 1 — ingest volume per day.**
> ```
> 500 hours/min × 60 min × 24 h = 720,000 hours/day ≈ 7.2 × 10^5 hours/day
> ```
>
> **Step 2 — bytes per hour, source.** 1080p at ~6 Mbps:
> ```
> 6 Mbps × 3,600 s = 21,600 Mb/hour ÷ 8 = 2,700 MB ≈ 2.7 GB/hour source
> ```
>
> **Step 3 — transcoding fan-out.** Each upload becomes a ladder of renditions
> (240p…4K, multiple codecs). Total stored ≈ **3–5× the source** for the ladder.
> Take 4×.
> ```
> stored_per_hour = 2.7 GB × 4 ≈ 11 GB/hour delivered+source
> ```
>
> **Step 4 — daily, then annual.**
> ```
> per day  = 7.2 × 10^5 hours × 11 GB ≈ 7.9 × 10^6 GB ≈ 7.9 PB/day
> per year = 7.9 PB × 365 ≈ 2,900 PB ≈ ~2.9 EB/year
> ```
>
> **Step 5 — durability.** Video is large, warm-to-cold, latency-tolerant on
> storage → erasure coding (~1.4×):
> ```
> ~2.9 EB × 1.4 ≈ ~4 EB/year of new provisioned capacity
> ```
>
> This is why video is an *exabyte* problem and tweet text is a *petabyte*
> problem. The transcoding fan-out (×4) and indefinite retention are the two
> terms that dominate — cut either and you cut the bill proportionally. It also
> explains why such platforms aggressively tier old, rarely-watched videos to
> the cheapest cold storage and re-transcode on demand instead of storing every
> rendition hot.

**Q19: How do you turn a storage estimate into a dollar figure, and what's the "silent PB" cost trap at scale?**

> Convert capacity to monthly cost by tier, then annualize and project growth:
>
> ```
> monthly_$ = Σ (PB_in_tier × price_per_GB-mo × 10^6 GB/PB)
> ```
>
> Worked, for 1 PB held one year at common list-ish prices:
>
> | Tier | $/GB-mo | $/PB-mo | $/PB-year |
> |------|---------|---------|-----------|
> | Hot object | $0.023 | ~$23,000 | ~$276,000 |
> | Infrequent-access | $0.0125 | ~$12,500 | ~$150,000 |
> | Cold archive | $0.004 | ~$4,000 | ~$48,000 |
> | Deep archive | $0.001 | ~$1,000 | ~$12,000 |
>
> **The silent PB trap:** storage cost is *recurring and cumulative*. Capacity
> you write this year you keep paying for every month next year too, on top of
> next year's new data. So a service adding 1 PB/month on hot storage isn't
> paying $23k/mo — by month 12 it's paying for 12 PB (~$276k/mo) and rising
> linearly forever until retention caps it. The forgotten factors — egress
> fees, per-request costs, retrieval fees on archive, cross-region replication —
> often *double* the headline storage bill. Always present cost as a
> **trajectory** (cumulative over retention), never a single month, and always
> name the non-capacity line items.

**Q20: A 200 B logical row gets 4 secondary indexes. Estimate the table's real footprint and explain the over-indexing risk.**

> Each secondary index is an independent B-tree storing the indexed column(s)
> plus a row pointer (TID/PK ~ 6–16 B) per row, plus B-tree node overhead. A
> rough per-row index cost is **(indexed key bytes + ~16 B pointer + node
> overhead)**, often **50–120 B per index per row** depending on key width.
>
> ```
> heap (payload + tuple overhead) ≈ 200 B/row
> 4 indexes × ~80 B/row           ≈ 320 B/row
> ----------------------------------------------
> total                            ≈ 520 B/row  (indexes ≈ 1.6× the heap)
> ```
>
> So **indexes more than double the table footprint**, and that doubling
> propagates through RF=3 and backups. The over-indexing risk is threefold:
> (1) storage — indexes can exceed the table itself; (2) write amplification —
> every insert updates all 4 trees; (3) maintenance — bloat and reindex time.
> The estimation takeaway: **count indexes as first-class storage**, and in a
> design review, an unused index is pure recurring cost across RF and backups.

**Q21: Compression saves storage but costs CPU and complicates random access. How do you decide where to apply it?**

> Decide per data segment by access pattern, not globally:
>
> | Segment | Compress? | Why |
> |---------|-----------|-----|
> | Hot, randomly-read rows | usually no / block-level only | decompress-on-read latency hurts |
> | Cold archive | yes, aggressively | rarely read, capacity is the cost |
> | Logs / analytics columns | yes (columnar codecs) | high redundancy, scan-heavy, 5–20× wins |
> | Already-compressed media | no | ~1× ratio, wasted CPU |
> | Encrypted blobs | no (or compress before encrypt) | random-looking, ~1× |
>
> The estimation move: apply the compression multiplier **only to the segments
> where it's real**, and model the CPU as a *bandwidth/cost* line, not free.
> A common senior mistake is applying a flat 5× to the whole dataset — including
> the media that dominates and doesn't compress — producing a fantasy number.
> Compress text and cold/columnar data; leave hot random-access and media alone.

**Q22: Retention is described as "a legal and cost decision." Unpack how you'd actually set it.**

> Retention is the highest-leverage term in the formula — halving it halves the
> bill — but you don't get to choose freely. It's the intersection of three forces:
>
> 1. **Legal / regulatory floor.** GDPR/CCPA can *forbid* keeping personal data
>    past its purpose (a maximum); SOX, HIPAA, and financial regs can *require*
>    retention (a minimum, e.g. 7 years for financial records). Litigation holds
>    can freeze deletion entirely. These set hard bounds you cannot cost-optimize through.
> 2. **Product value curve.** How far back do users/analytics actually read?
>    If 99% of reads are within 90 days, hot retention beyond that is waste;
>    push the long tail to archive rather than deleting.
> 3. **Cost.** Within the legal min/max and product needs, retention is a tier +
>    duration knob: keep the legally-required-but-rarely-read data in deep
>    archive, not hot storage.
>
> The clean policy is a **per-data-class retention matrix**: PII deleted at
> purpose-end, financial records archived 7 years, operational logs hot 30 days /
> warm 90 / deleted, media kept indefinitely but cold-tiered by age. State the
> matrix; never quote a single global retention number for a real product.

---

## Staff / Judgment Questions

**Q23: A team proposes RF=5 across three regions "for safety." Talk them down (or up) with numbers.**

> Quantify what each replica buys versus costs before debating philosophy.
>
> **Cost side.** RF=5 vs RF=3 is a **+67% storage bill** on the entire dataset,
> forever. On a 50 PB store at ~$0.02/GB-mo:
> ```
> RF=3: 150 PB × $20k/PB-mo = $3.0M/mo
> RF=5: 250 PB × $20k/PB-mo = $5.0M/mo  → +$2.0M/mo, +$24M/year
> ```
>
> **Benefit side.** Marginal durability from the 4th and 5th replica is
> minuscule — RF=3 across independent failure domains already buys ~11 nines for
> most workloads. The 4th/5th replica mostly improves *read availability /
> locality*, which is often better solved by **read replicas or caching in the
> read path**, not by inflating the durable copy count.
>
> **The judgment.** Separate the two requirements: durability (RF=3 + erasure
> coding for cold + cross-region async backup) and read-availability (caches,
> regional read replicas you can rebuild). RF=5 conflates them and pays storage
> prices for an availability problem. Counter-propose: RF=3 + 1 async cross-region
> copy for DR + read caches — better availability, ~half the marginal cost.
> RF goes *up* only when a specific compliance or quorum requirement names it.

**Q24: Your estimate says 8 PB; finance budgeted for 3 PB. The gap is real. How do you close it without lying to either side?**

> Don't negotiate the arithmetic — negotiate the *requirements that drive the
> multipliers*. Decompose the 8 PB and attack each factor explicitly:
>
> ```
> 8 PB = logical(2 PB) × RF(3) × backup(1.3)  ≈ 7.8 PB
> ```
>
> Levers, each with a numbered trade-off you put in front of finance and product:
>
> 1. **Retention** — cut hot retention 5y→1y, archive the rest. Logical hot drops
>    ~5×; total falls toward 3 PB. *Trade:* slower access to old data. Biggest lever.
> 2. **Tiering** — move 80% to cold/archive. Size unchanged but **cost** drops
>    ~70% — often this is what finance actually cares about, not PB.
> 3. **Durability** — move large/cold data RF=3 → erasure coding (3×→1.4×).
>    Saves ~50% on that segment. *Trade:* higher recovery latency.
> 4. **Compression** — apply real ratios to compressible segments only.
> 5. **Index/schema** — drop unused indexes, tighten row layout.
>
> Then reframe: present finance a **cost trajectory under each policy choice**,
> not a single number, so *they* own the retention/durability decisions that set
> the bill. The staff-level move is recognizing the 8-vs-3 gap is a **policy
> disagreement wearing a math costume** — the numbers are correct; what's
> unresolved is how long, how durable, and how fast-to-access the business is
> willing to pay for. Surface that decision; don't quietly shave multipliers to
> hit a target, because the shaved bytes show up later as a 2 a.m. capacity page.

---

*Next step:* [Bandwidth](../03-bandwidth/junior.md)
