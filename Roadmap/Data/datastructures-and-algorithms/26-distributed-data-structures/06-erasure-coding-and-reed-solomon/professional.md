# Erasure Coding & Reed–Solomon — Professional Level

> You operate petabyte-scale storage. The question is no longer "how does Reed–Solomon work" — it's "what do I actually pay for that 1.4× overhead, where does the bandwidth go when a rack dies, and how do I keep eleven nines while the repair queue is on fire." This level is about the *economics* and the *operations* of erasure coding in production, with the math to back every decision.

This is the **professional** tier. For the encoding math and field arithmetic see [senior](senior.md); for first principles see [middle](middle.md) and [junior](junior.md); for rapid-fire recall see [interview](interview.md). The Galois-field arithmetic underpinning everything here is grounded in [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/professional.md) (or the broader [Number Theory](../../19-number-theory/) section).

---

## Table of Contents

1. [The one-paragraph mental model](#1-the-one-paragraph-mental-model)
2. [Where erasure coding actually ships](#2-where-erasure-coding-actually-ships)
3. [The economics: overhead vs. the bill you pay back](#3-the-economics-overhead-vs-the-bill-you-pay-back)
4. [Durability math: counting the nines](#4-durability-math-counting-the-nines)
5. [Why EC is for warm and cold data](#5-why-ec-is-for-warm-and-cold-data)
6. [The repair-traffic problem and why LRC exists](#6-the-repair-traffic-problem-and-why-lrc-exists)
7. [Placement: mapping n−k tolerance onto real failure domains](#7-placement-mapping-nk-tolerance-onto-real-failure-domains)
8. [Libraries and hardware: the GF(2^8) hot loop](#8-libraries-and-hardware-the-gf28-hot-loop)
9. [Operational reality: storms, scrubs, and partial writes](#9-operational-reality-storms-scrubs-and-partial-writes)
10. [Migration: replication ⇄ erasure coding](#10-migration-replication--erasure-coding)
11. [Observability, modeling, and testing](#11-observability-modeling-and-testing)
12. [Realistic code: an RS(k,m) codec with a failure harness and a Monte-Carlo durability estimate](#12-realistic-code)
13. [Decision tables and sizing](#13-decision-tables-and-sizing)
14. [Checklists](#14-checklists)
15. [Cheat sheet](#15-cheat-sheet)
16. [Summary](#16-summary)
17. [Further reading](#17-further-reading)

---

## 1. The one-paragraph mental model

Erasure coding splits an object into **k data shards**, computes **m parity shards** over a finite field, and stores all **n = k + m** shards on distinct failure domains. Any **k of the n** shards reconstruct the original. That single property — *survive any m losses* — is the entire value proposition. Reed–Solomon is the dominant code because it is **Maximum Distance Separable (MDS)**: it achieves the optimal trade-off, tolerating exactly m failures with exactly m parity shards and zero waste. Everything in production storage is a negotiation around three numbers: the **storage overhead** n/k, the **fault tolerance** m, and the **repair cost** of regenerating one lost shard. Replication is the degenerate case RS(1, r−1): cheap to repair, expensive to store. The art is choosing where on that curve your data lives.

> **One sentence to remember:** erasure coding trades cheap, abundant *storage* for expensive, scarce *repair bandwidth and CPU* — so it wins exactly where data is large, cold, and read sequentially, and loses where data is small, hot, and read randomly.

---

## 2. Where erasure coding actually ships

The following is what is publicly documented. Where a system is proprietary, the claim is hedged accordingly — be honest about what you don't know when you cite these in a design review.

### 2.1 HDFS Erasure Coding (Hadoop 3.0+)

HDFS historically used **3× replication**. Hadoop 3.0 (2017) shipped native erasure coding to cut the 200% overhead. Documented properties:

- **Codecs:** Reed–Solomon (default) and XOR. Built-in policies include **RS(6,3)**, **RS(10,4)**, **RS(3,2)**, and an XOR(2,1).
- **Striped layout, not contiguous.** Classic HDFS stores a 128 MB block contiguously on one DataNode. EC instead **stripes** a logical block across many DataNodes in small cells (default cell size 1 MB), so a single client read fans out across the stripe. This is the key architectural difference and it has consequences: striping is great for large sequential reads (parallel I/O), poor for small files (each small file still consumes a full stripe's worth of distinct nodes) and for locality-sensitive workloads (the old "move compute to data" assumption breaks because the data is everywhere).
- **Overhead:** RS(6,3) → 9/6 = **1.5×**; RS(10,4) → 14/10 = **1.4×**. Compare to 3× for replication.
- **Acceleration:** Hadoop ships an ISA-L native coder; without it you fall back to a pure-Java coder that is dramatically slower.

The HDFS-EC design document (HDFS-7285) is the canonical reference for the striped-vs-contiguous decision and the small-file caveat.

### 2.2 Azure Storage — Local Reconstruction Codes (LRC)

Huang et al., *"Erasure Coding in Windows Azure Storage"* (USENIX ATC 2012), is one of the most influential production EC papers. Azure introduced **LRC** specifically to attack repair cost. Instead of pure RS, LRC adds **local parities** over subsets of data fragments plus **global parities** over all of them. The published configuration is **LRC(12, 2, 2)**: 12 data fragments, 2 local parities, 2 global parities (14 fragments of payload, 16 total).

The trade is explicit: LRC is **not MDS**. It accepts slightly more storage overhead (1.33× in that config) than the equivalent RS in exchange for **a single-fragment repair touching only 6 fragments instead of 12**. That halving of repair traffic is the whole point — repair is the dominant operational cost at scale, and LRC buys it down. This idea — sacrifice a little MDS-optimality to slash repair I/O — recurs everywhere below.

### 2.3 Facebook / Meta — f4 and HDFS-RAID / Xorbas

Two distinct Facebook efforts:

- **f4** (Muralidhar et al., *"f4: Facebook's Warm BLOB Storage System,"* OSDI 2014). f4 is explicitly the **warm tier** for BLOBs (photos, videos) whose request rate has decayed. The published scheme uses **Reed–Solomon RS(10,4)** with a 1.4× overhead, plus geo-replication (XOR across data centers) for the highest durability. f4 is the textbook case of "old, rarely-changed, large objects → erasure code them."
- **HDFS-RAID / Xorbas.** Sathiamoorthy et al., *"XORing Elephants: Novel Erasure Codes for Big Data"* (VLDB 2013), introduced an **LRC for HDFS** at Facebook to reduce the repair bandwidth of the warehouse cluster. Same motivation as Azure LRC, different lineage.

### 2.4 Ceph erasure-coded pools

Ceph supports EC pools alongside replicated pools. The erasure code is **pluggable**:

- **jerasure** (the default plugin, wrapping Plank's Jerasure/GF-Complete) — flexible, supports many k/m and techniques (Reed–Solomon Vandermonde, Cauchy).
- **ISA-L** — Intel's library, faster on x86 with the right CPU.
- **clay** and **lrc** plugins for repair-efficient codes.

Operationally, Ceph EC pools historically had constraints: limited or no partial-overwrite support on certain pool types (so EC pools were paired with a replicated cache tier or used for object/RGW workloads rather than RBD random writes), and a CRUSH rule that must place the k+m shards across the intended failure domain. Confirm the exact constraints against your Ceph version's docs — they have evolved.

### 2.5 Backblaze Vaults — open-source Reed–Solomon

Backblaze open-sourced a clean, readable **Reed–Solomon implementation in Java** and wrote one of the best practitioner blog posts on the topic ("Backblaze Open-sources Reed-Solomon Erasure Coding Source Code," 2015). Their **Vault** architecture spreads a file across **20 shards in 20 storage pods across 20 racks**, using **RS(17, 3)** — 17 data, 3 parity — tolerating any 3 pod failures at a 20/17 ≈ **1.18×** overhead. It is the single best learning resource because the code is small, commented, and maps directly to the math.

### 2.6 The hyperscaler proprietary tier

- **Google Colossus** (successor to GFS) uses erasure coding extensively for its durability; the specifics are largely internal, but the architecture is well-known to be EC-based with Reed–Solomon-family codes and careful placement.
- **AWS S3** advertises **99.999999999% (eleven nines)** of object durability and states objects are redundantly stored across multiple devices and multiple Availability Zones. The exact coding scheme is proprietary; treat "EC-based with cross-AZ placement" as the safe, generic characterization.
- **Azure Blob Storage** uses the LRC family described above for its erasure-coded redundancy options.

When you cite these in a doc, write "EC-based durability, scheme proprietary" rather than inventing a specific k/m. The eleven-nines figure is a *durability* claim, not an *availability* claim — don't conflate them.

### 2.7 MinIO and OpenStack Swift

- **MinIO** uses Reed–Solomon (built on a Klauspost Go implementation with SIMD acceleration) with per-object **erasure sets**. Default behavior splits each object's drives into data and parity halves; you choose the parity count (e.g., `EC:4`). It is the most accessible production-grade EC object store to actually run on a laptop.
- **OpenStack Swift** added EC support via PyECLib, which wraps liberasurecode and backends like jerasure/ISA-L.

| System | Code | Typical config | Overhead | Notable design choice |
|---|---|---|---|---|
| HDFS EC (Hadoop 3) | RS | RS(6,3), RS(10,4) | 1.5×, 1.4× | Striped layout; small-file penalty |
| Azure Storage | LRC | (12,2,2) | ~1.33× | Local parity → half the repair I/O |
| Meta f4 | RS | RS(10,4) | 1.4× | Warm BLOB tier + geo XOR |
| Meta HDFS-RAID/Xorbas | LRC | — | — | Repair-efficient code for warehouse |
| Ceph EC pool | RS/Cauchy | k+m configurable | (k+m)/k | Pluggable: jerasure / ISA-L / clay |
| Backblaze Vault | RS | RS(17,3) | ~1.18× | 20 pods / 20 racks; OSS Java code |
| MinIO | RS | EC:N parity | configurable | Per-object erasure sets, SIMD |
| AWS S3 / Colossus / Azure | EC (proprietary) | — | — | Cross-AZ placement; 11 nines (S3) |

---

## 3. The economics: overhead vs. the bill you pay back

The headline that gets EC funded is storage overhead. Here is the comparison that lands in a budget meeting:

| Scheme | Fault tolerance | Storage overhead | Raw TB for 1 PB usable | Relative disk cost |
|---|---|---|---|---|
| 3× replication | 2 | 3.00× | 3.00 PB | 100% |
| RS(6,3) | 3 | 1.50× | 1.50 PB | 50% |
| RS(10,4) | 4 | 1.40× | 1.40 PB | 47% |
| RS(17,3) | 3 | 1.18× | 1.18 PB | 39% |
| LRC(12,2,2) | up to 4 | 1.33× | 1.33 PB | 44% |

RS(10,4) tolerates **more** failures than 3× replication (4 vs. 2) while using **less than half** the disk. At petabyte scale that is, directly, half the disks, half the rack units, roughly half the power and cooling for the cold tier. This is why every warm/cold storage system eventually erasure-codes.

But you don't get the overhead reduction for free. You pay it back in five currencies:

1. **Repair bandwidth and I/O.** To rebuild **one** lost shard in RS(k, m), you must **read k surviving shards** and decode. Reconstructing 1 TB of lost data in RS(10,4) means reading **~10 TB** across the network. Replication rebuilds 1:1 — read 1 TB, write 1 TB. EC repair is a **k× read amplification** on the network and the surviving disks. This is the single most important operational fact about erasure coding, and the reason LRC and clustered placement exist.

2. **CPU for encode and decode.** Every write encodes; every degraded read and every repair decodes. Without SIMD acceleration this is a real cost (see §8). With ISA-L it is largely free on modern x86, but "largely" is doing work — a multi-GB/s repair storm still burns cores.

3. **Write amplification and small-file overhead.** A write must compute m parity shards and place k+m fragments, each incurring its own RPC, metadata entry, and seek. For a small file this is brutal: a 4 KB object in RS(10,4) becomes 14 fragments scattered across 14 nodes, dominated by per-fragment fixed costs. Replication writes 3 copies of 4 KB — far cheaper per small object.

4. **Degraded-read latency.** When a shard is missing (node down, slow disk), a read must fetch k shards and **decode on the fly**, adding latency and, worse, **tail latency** — the read is gated by the slowest of k fetches plus decode. Replication just reads another full copy. This is why hot data hates EC.

5. **Update-in-place pain.** Overwriting part of an erasure-coded stripe means recomputing parity for the whole stripe (read-modify-write across the stripe). EC systems strongly prefer **append-only / immutable** objects for this reason (see §9.5).

> **The trade in one line:** EC cuts your storage bill roughly in half and *increases* your repair-bandwidth, CPU, small-write, and degraded-read bills. It pays off when storage dominates the cost — i.e., large, cold, immutable data.

---

## 4. Durability math: counting the nines

Durability is the probability that an object survives over a period. Two complementary models.

### 4.1 Static combinatorial bound (a single instant)

Let **p** = probability a given shard is unavailable/lost at a moment in time (independent failures). An RS(k, m) stripe of n = k + m shards is **lost** only if **more than m** shards fail simultaneously. Probability of data loss:

```
P(loss) = Σ_{i=m+1}^{n}  C(n, i) · p^i · (1−p)^(n−i)
```

For small p this is dominated by the first term, i = m+1:

```
P(loss) ≈ C(n, m+1) · p^(m+1)
```

The exponent **p^(m+1)** is everything: each extra parity shard multiplies durability by another factor of p. With p = 0.01 (1% of disks dead at any time) and RS(10,4), m+1 = 5:

```
P(loss) ≈ C(14, 5) · (0.01)^5 = 2002 · 1e-10 ≈ 2.0e-7
```

That's ~6.7 nines at a snapshot — and this static model is pessimistic about real systems (which repair quickly) but ignores correlated failures (which the math below assumes away). Reality lands between, hence the next model.

### 4.2 Markov / MTTF model (the standard durability calculation)

The industry-standard durability model is a continuous-time Markov chain over the number of healthy shards, parameterized by **MTTF** (mean time to failure of a disk) and **MTTR** (mean time to *repair* a shard — detect + rebuild). The intuition that matters:

```
Durability climbs with  (MTTF / MTTR)^(m)
```

- **More parity (m) → more nines, super-linearly.** Each extra parity adds another factor of the (huge) MTTF/MTTR ratio.
- **Faster repair (lower MTTR) → more nines.** Halving MTTR has the same first-order effect as one of the m factors. **This is why repair speed is a durability lever, not just a cost lever.** A system that is slow to repair after a node loss is *less durable*, full stop.
- **Correlated failures break the model.** The Markov chain assumes independent failures. Real outages are correlated: a power event, a bad firmware push, a rack-top switch failure, or a botched deploy can take out many shards of one stripe at once. **No amount of m saves you if all n shards share one failure domain.** This is the entire justification for placement (§7).

### 4.3 Worked example: disks for a durability target

Suppose you need ~11 nines and your operational reality is MTTF ≈ 3 years per disk, MTTR ≈ 1 hour (fast detection + parallel repair). Plug into the Markov approximation and you'll find that **m = 3 to 4** lands in the eleven-nines range *provided repair stays fast and failures stay independent across domains*. The dominant design levers, in order:

1. **Spread shards across independent failure domains** (so failures *are* independent) — placement.
2. **Keep MTTR low** (fast detection + high-bandwidth parallel repair) — repair throughput.
3. **Add parity m** — the brute-force lever, expensive in storage.

Note that (1) and (2) buy durability *without* adding overhead, which is why mature systems invest in them before reaching for more parity.

---

## 5. Why EC is for warm and cold data

Map the five repayment currencies (§3) onto a data-temperature axis:

| Workload trait | Favors | Why |
|---|---|---|
| Small objects (KB) | Replication | Per-fragment fixed cost dominates; EC scatters into k+m tiny fragments |
| Hot random reads | Replication | Degraded-read decode + k-fetch tail latency hurt; replication reads one copy |
| Frequent updates | Replication | EC stripe overwrite = read-modify-write parity recompute |
| Large objects (MB–GB) | EC | Stripe fixed cost amortized over a big payload; parallel sequential read shines |
| Cold / rarely read | EC | Degraded-read latency rarely paid; storage savings always paid |
| Immutable / append-only | EC | No partial-stripe overwrite; encode once, store forever |

This is exactly why **f4 is the warm tier** under a hot replicated tier, why **HDFS EC is recommended for cold/archival data** rather than hot working sets, and why the canonical tiering policy is:

```
HOT  (recent, small, mutable, frequently read)   → 3× replication
WARM (aging, large, immutable, occasionally read) → EC, e.g. RS(6,3)
COLD (archival, large, rarely read)               → wide EC, e.g. RS(10,4)/RS(17,3)
```

**Tiering policy in practice:** age-based or access-frequency-based. An object lands in the hot replicated tier on write, and a background job *converts* it to EC once it crosses an age or access threshold (e.g., "no reads in 30 days" or "older than 90 days"). This is the same lifecycle idea as S3 storage classes — keep hot data cheap to access, push cold data to cheap-to-store EC. See §10 for the conversion mechanics.

---

## 6. The repair-traffic problem and why LRC exists

Return to the central fact: **RS(k, m) repair of one shard reads k shards.** At scale this is the limiting resource.

### 6.1 The arithmetic of a node loss

Say a storage node holds 100 TB and dies. Every stripe that had a shard on that node now needs a repair. In RS(10,4), each lost shard's repair reads 10 shards. The cluster must read **~10 × 100 TB = ~1 PB** to fully restore redundancy for that one node. That 1 PB competes with foreground traffic for disk and network. If your repair bandwidth is throttled (it must be, or repair starves clients), the **MTTR balloons** — and from §4, longer MTTR means lower durability. A slow repair after one failure leaves the system in a degraded, less-durable state for longer, raising the odds a *second* failure tips a stripe into loss.

### 6.2 LRC: buy down the read amplification

**Local Reconstruction Codes** add **local parities** over subgroups so the common case — a *single* lost shard — repairs from a small local group, not the whole stripe.

- Azure LRC(12,2,2): split the 12 data fragments into two groups of 6, each with its own local parity, plus 2 global parities. A single lost data fragment reconstructs from its **6-fragment local group** — **half the repair I/O** of RS(12, x). Multi-failure cases fall back to the global parities.
- The cost: LRC is **non-MDS**. It stores a bit more parity for a given fault tolerance than RS would. You pay ~storage to save ~repair-bandwidth. At Azure/Facebook scale, repair bandwidth was the scarcer resource, so the trade won.

### 6.3 Clustering and regenerating codes

Two further directions you'll encounter:

- **Clustered placement** keeps a stripe's shards within a small set of racks so repair traffic stays local to a high-bandwidth domain (intra-rack), at the cost of correlating failures more — a tension with §7. The Clay codes / minimum-storage regenerating (MSR) codes (Ceph's `clay` plugin) reduce the *amount of data transferred per repair* below k shards, attacking the same problem from coding theory rather than placement.
- **Regenerating codes** (MSR/MBR) provably minimize repair bandwidth for a given storage point on the cut-set bound. They are more complex and less universally deployed, but they're the theoretical answer to "RS reads k shards to fix one, can we do better?" — yes, asymptotically.

> **Design heuristic:** if your dominant operational pain is repair bandwidth after node loss (it usually is at scale), reach for LRC or a regenerating code *before* you widen k.

---

## 7. Placement: mapping n−k tolerance onto real failure domains

The MDS guarantee "survive any m losses" is a statement about **shards**, not **disks** or **racks**. It only translates to real durability if the m+1 shards that would be lost together don't share a failure domain. Correlated failure is the silent killer of erasure-coded durability.

### 7.1 The failure-domain hierarchy

```
region → availability zone / data center → row → rack → node → disk
```

Each level is a correlated-failure boundary: a rack-top switch, a PDU, a cooling unit, a firmware rollout, a network partition. The placement rule:

> **Place the n shards of a stripe on n distinct failure domains at the level you must tolerate.**

If you must tolerate **a whole rack failing**, then no two shards of a stripe may live in the same rack — which means you need **at least n racks**. RS(10,4) needs ≥14 racks to be rack-fault-tolerant. Backblaze's Vault makes this concrete and beautiful: **20 shards across 20 pods across 20 racks**, so any 3 pod/rack failures are survivable because the parity m=3 maps exactly onto 3 independent racks.

### 7.2 AZ-level tolerance and the eleven-nines story

To survive an **AZ** outage, shards must span AZs such that no AZ holds more than m shards. S3's eleven-nines and Azure's cross-AZ EC are durability claims that *depend on this placement*. Note the cost: cross-AZ repair pays cross-AZ network egress, which is expensive and slower — another reason MTTR rises and another argument for LRC-style local repair within an AZ with global parity spanning AZs.

### 7.3 The placement vs. repair-locality tension

You have a genuine conflict:

- **Spread wide** (one shard per independent domain) → best durability against correlated failure, but repair traffic crosses domains (expensive, slow).
- **Cluster tight** (shards within a few racks) → cheap, fast intra-rack repair, but correlated-failure risk rises.

LRC is partly an answer: keep **local groups** within a domain for cheap common-case repair, while **global parities** span domains for correlated-failure survival. There is no free lunch; you're choosing where on the spectrum your blast radius and your repair bill sit.

### 7.4 Common placement mistakes

- **Too few failure domains.** Configuring RS(10,4) on a 10-rack cluster guarantees ≥2 shards per rack for some stripes, so a single rack failure can already cost you more than the m you think you have.
- **Hidden shared domains.** Two "different" racks behind the same PDU or switch are one failure domain. Audit the actual blast radius, not the labels.
- **Placement drift after rebalancing.** A rebalance or node addition can quietly co-locate shards. Continuous placement validation (a "shards-per-domain" invariant checker) belongs in your observability stack (§11).

---

## 8. Libraries and hardware: the GF(2^8) hot loop

Reed–Solomon arithmetic happens in **GF(2^8)** — bytes as field elements. Addition is XOR (free). The expensive operation is **multiplication**: encoding is `parity = Σ coeff_i · data_i` over the field, and decoding inverts a matrix and multiplies again. **GF(2^8) multiplication is the hot loop** of every encoder, decoder, and repair.

### 8.1 How the multiply gets fast

- **Log/exp tables.** `a·b = exp[(log[a] + log[b]) mod 255]` for a, b ≠ 0. Two table lookups + an add. This is what the textbook implementations (and §12's code) do. Simple, portable, but lookups limit throughput.
- **Multiply tables / split-table SIMD.** Precompute, for each coefficient, a 256-entry product table, then process many bytes at once. James Plank's **GF-Complete** and **Jerasure** pioneered the high-performance techniques here. The key trick is **"split" multiplication** that uses SIMD shuffle instructions (`PSHUFB` on x86) to do 16 (or 32 with AVX2) GF multiplies in parallel against a 4-bit nibble lookup.
- **Carry-less multiply (CLMUL / `PCLMULQDQ`).** Hardware carry-less multiply lets you implement GF multiplication and reduction with a few instructions instead of tables, used in high-throughput coders.

### 8.2 The libraries you'll actually deploy

| Library | Origin | Used by | Notes |
|---|---|---|---|
| **Intel ISA-L** | Intel | HDFS-EC native, Ceph, Swift, MinIO-adjacent | AVX2/AVX-512 + PSHUFB; multi-GB/s/core; the de facto fast path on x86 |
| **Jerasure / GF-Complete** | James Plank (UTK) | Ceph default plugin, research, Swift | Flexible (RS Vandermonde, Cauchy), well-documented, the academic reference |
| **klauspost/reedsolomon** | Go community | MinIO, many Go systems | SIMD (AVX2/AVX-512/NEON); excellent Go throughput |
| **liberasurecode / PyECLib** | OpenStack | Swift | Abstraction over jerasure/ISA-L backends |
| **Backblaze RS (Java)** | Backblaze | reference / learning | Clean, readable, not the fastest |

### 8.3 Throughput intuition

Order-of-magnitude figures (verify on your own hardware — they vary widely by CPU, k, m, and cache behavior):

- **Pure-Java / pure-scalar coder:** hundreds of MB/s — fine for ingest, painful for repair storms. The HDFS docs explicitly warn that without the ISA-L native coder you take a large performance hit.
- **SIMD (ISA-L / klauspost) on modern x86:** **several GB/s per core** for encode, with decode similar. AVX-512 and good cache locality push this higher.

The practical takeaway: **always deploy the native SIMD coder.** A repair storm with a scalar coder will either saturate CPU or extend MTTR (and thus reduce durability). On non-x86 (ARM server fleets), confirm NEON/SVE acceleration is enabled.

---

## 9. Operational reality: storms, scrubs, and partial writes

### 9.1 Reconstruction storms after a node loss

When a node (or rack) dies, **every stripe with a shard there needs repair simultaneously.** Uncontrolled, this saturates the network and disks and starves clients. Production systems must:

- **Throttle repair bandwidth** (a configurable cap), trading MTTR for client SLA. This is a direct durability-vs-availability knob: throttle too hard and a node loss leaves you degraded (less durable) for longer.
- **Prioritize by risk.** Repair the stripes closest to data loss **first**: a stripe that has already lost 3 of 4 parities (one shard from death) must be rebuilt before a stripe that lost 1 of 4. Risk-aware repair queues are essential — a FIFO repair queue is a durability bug.
- **Stagger and rate-limit detection** to avoid a thundering herd of decode jobs.

### 9.2 EC handles **erasures**, NOT silent corruption — pair with checksums

This is the single most important correctness caveat, and it's worth stating bluntly:

> **Reed–Solomon, as deployed for storage, corrects *erasures* — losses at *known* positions (a missing shard, a dead disk). It does NOT, by itself, detect or correct *silent* corruption (bit rot that returns wrong bytes without an error).**

If a disk silently returns flipped bits and you feed that corrupted shard into the decoder as if it were valid, you decode **garbage**, possibly without any error. (RS *can* correct errors at unknown positions too, but at half the rate — t errors needs 2t parity — and storage systems do not run in that mode; they run in erasure mode and assume each present shard is either correct or marked missing.)

The fix every real system uses: **store a checksum (CRC32C, etc.) per shard or per block.** On read/scrub, verify the checksum; if it fails, **treat that shard as an erasure** (mark it missing) and let RS reconstruct it from the others. Checksums turn silent corruption into a *known erasure*, which is exactly what RS handles. HDFS, Ceph, and the object stores all checksum at the block/shard level for precisely this reason. **EC without per-shard checksums is a silent-corruption time bomb.**

### 9.3 Scrubbing and bit-rot

**Background scrubbing** periodically reads every shard, verifies its checksum, and reconstructs any that fail — *before* they're needed to repair a real failure. Without scrubbing, latent bit rot accumulates: you discover the corruption only when a node dies and you go to repair, at which point a "good" shard you needed turns out to be silently bad — a **correlated latent failure** that the durability model didn't account for. Scrub cadence is a tuning parameter: too aggressive wastes I/O, too lax lets latent errors accumulate. Track **scrub-detected errors** as a leading indicator of failing media.

### 9.4 Rebuild prioritization recap

Combine §9.1 and §9.3: the repair scheduler should order by **proximity to data loss** (how many more shard losses until this stripe is unrecoverable), and scrubbing feeds it latent errors so they're fixed proactively. A healthy system spends most repair bandwidth on scrub-driven proactive fixes and reserves burst capacity for node-loss storms.

### 9.5 Partial-stripe writes and update-in-place

Overwriting *part* of an EC stripe forces a **read-modify-write**: read the old data (or old parity), compute the parity delta, write new parity. This is expensive and a source of write amplification and consistency hazards (a crash mid-update can leave parity inconsistent with data). Consequences in practice:

- EC systems strongly favor **immutable, append-only objects.** Write once, never modify. This is why EC fits BLOB/object stores and archival far better than random-write block storage.
- **Ceph EC pools** historically restricted partial overwrites; RBD on EC needed a replicated cache tier or specific configuration. Random-write workloads on EC are an anti-pattern.
- If you must support updates, **version the object** (write a new immutable EC stripe, flip a pointer) rather than mutating in place.

---

## 10. Migration: replication ⇄ erasure coding

### 10.1 The conversion

The standard lifecycle: data is written **3× replicated** (cheap to write, fast to read, cheap to repair) and a background job **converts cold data to EC** to reclaim storage. The conversion job:

1. Reads the k logical data units (already present as replicas).
2. Encodes m parity shards.
3. Places all n shards across failure domains per the placement policy.
4. Verifies (checksums, shard count, placement invariant).
5. **Only then** deletes the redundant replicas and flips the metadata to "EC."

Step 5 ordering is critical: never delete replicas before the EC stripe is fully written, verified, and placement-validated, or a crash mid-conversion loses data.

### 10.2 When it pays

Conversion pays when the **storage saved over the object's remaining lifetime** exceeds the **one-time CPU + I/O cost of encoding** plus the **ongoing higher repair/read costs**. Concretely, convert objects that are:

- **Large** (amortize the per-stripe fixed cost),
- **Cold** (few degraded reads to pay),
- **Immutable / stable** (no read-modify-write churn),
- **Long-lived** (storage savings accrue over time).

Don't convert small, hot, or short-lived objects — the conversion cost and the worse read/repair profile won't be repaid before the object is deleted.

### 10.3 Reversibility

EC → replication conversion is possible (decode to recover data, then replicate) but **costs a full decode** (read k shards). You'd do this if an object **heats up** again (gets promoted back to a hot tier) or if you're changing schemes. It's not free, so tiering policy should avoid thrashing objects across the boundary — add hysteresis (don't promote on a single read; demote/promote on sustained access trends).

---

## 11. Observability, modeling, and testing

You cannot operate EC on faith. Instrument and model it.

### 11.1 Durability modeling (Markov / Monte-Carlo)

Before committing a (k, m, placement) choice, **model its durability**:

- **Markov/MTTF model** (§4.2) for an analytic estimate parameterized by MTTF, MTTR, and number of failure domains.
- **Monte-Carlo simulation** (§12) for scenarios the Markov model can't capture cleanly — correlated failures, repair-bandwidth limits, scrub cadence. Simulate a fleet over time with injected failures and measure the loss rate.

Re-run the model whenever MTTR changes (new repair throughput, bigger disks → longer rebuilds) or the fleet's failure profile shifts.

### 11.2 Fault injection

Routinely **inject failures in pre-production** (and carefully in production, à la chaos engineering): kill nodes, fail disks, corrupt shards on disk, partition racks. Verify the system **detects, reconstructs, and re-validates placement** within the MTTR budget. A durability model is only as good as the assumption that repair actually works at the modeled speed — fault injection tests that assumption.

### 11.3 The dashboards that matter

| Metric | Why it matters |
|---|---|
| **Repair bandwidth (current vs. cap)** | The scarce resource; saturation extends MTTR → lowers durability |
| **MTTR (detect → reconstruct → revalidate)** | Direct durability input; the lever you tune |
| **Stripes-at-risk by remaining tolerance** | How many stripes are 1 / 2 / … shards from loss right now |
| **Scrub-detected errors / scrub coverage %** | Leading indicator of bit rot; ensures latent errors get fixed |
| **Shards-per-failure-domain violations** | Catches placement drift that silently erodes durability |
| **Encode/decode CPU and throughput** | Confirms SIMD path is engaged; spots scalar fallback |
| **Degraded-read rate and latency** | The cost EC imposes on reads; should be low for cold tiers |

Alert on **placement-invariant violations** and **MTTR exceeding budget** — both are *durability* incidents even when no data is lost yet.

---

## 12. Realistic code

A runnable, self-contained **RS(k, m) codec over GF(2^8)** with log/exp tables, a Vandermonde encode matrix, Gaussian-elimination decode for up to m erasures, a **failure-injection harness**, and a **Monte-Carlo durability estimate**. This is teaching code — correct and clear, not ISA-L-fast — but the structure mirrors production codecs.

```python
"""
RS(k, m) erasure code over GF(2^8) with:
  - log/exp tables (the multiply hot loop),
  - Vandermonde systematic-ish encode matrix,
  - erasure decode via Gaussian elimination (up to m erasures),
  - a failure-injection harness,
  - a Monte-Carlo durability estimate.

Educational: correctness and clarity over throughput. Pure Python, stdlib only.
"""

import random
from itertools import combinations

# ---------------------------------------------------------------------------
# GF(2^8) arithmetic. Primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1).
# Addition/subtraction == XOR. Multiplication via log/exp tables.
# ---------------------------------------------------------------------------
GF_EXP = [0] * 512
GF_LOG = [0] * 256


def _init_tables(primitive=0x11d):
    x = 1
    for i in range(255):
        GF_EXP[i] = x
        GF_LOG[x] = i
        x <<= 1
        if x & 0x100:           # overflow past 8 bits -> reduce mod primitive
            x ^= primitive
    # duplicate the exp table so (log[a]+log[b]) never needs a mod
    for i in range(255, 512):
        GF_EXP[i] = GF_EXP[i - 255]


_init_tables()


def gf_mul(a, b):
    if a == 0 or b == 0:
        return 0
    return GF_EXP[GF_LOG[a] + GF_LOG[b]]   # the hot loop: two lookups + an add


def gf_div(a, b):
    if b == 0:
        raise ZeroDivisionError("GF division by zero")
    if a == 0:
        return 0
    return GF_EXP[(GF_LOG[a] - GF_LOG[b]) % 255]


def gf_inv(a):
    return gf_div(1, a)


# ---------------------------------------------------------------------------
# Matrix helpers over GF(2^8).
# ---------------------------------------------------------------------------
def mat_mul(A, B):
    n, m, p = len(A), len(B), len(B[0])
    out = [[0] * p for _ in range(n)]
    for i in range(n):
        for j in range(p):
            acc = 0
            for t in range(m):
                acc ^= gf_mul(A[i][t], B[t][j])
            out[i][j] = acc
    return out


def mat_inverse(M):
    """Invert a square GF(2^8) matrix via Gauss-Jordan elimination."""
    n = len(M)
    A = [row[:] + [1 if i == j else 0 for j in range(n)] for i, row in enumerate(M)]
    for col in range(n):
        # find a pivot
        pivot = next((r for r in range(col, n) if A[r][col] != 0), None)
        if pivot is None:
            raise ValueError("matrix is singular; cannot invert")
        A[col], A[pivot] = A[pivot], A[col]
        inv = gf_inv(A[col][col])
        A[col] = [gf_mul(inv, v) for v in A[col]]
        for r in range(n):
            if r != col and A[r][col] != 0:
                f = A[r][col]
                A[r] = [a ^ gf_mul(f, b) for a, b in zip(A[r], A[col])]
    return [row[n:] for row in A]


# ---------------------------------------------------------------------------
# Reed-Solomon RS(k, m): build an (k+m) x k coding matrix whose top k rows are
# the identity (systematic: data shards stored verbatim) and whose bottom m
# rows are a Vandermonde block that produces the parity shards.
# ---------------------------------------------------------------------------
class RS:
    def __init__(self, k, m):
        self.k = k
        self.m = m
        self.n = k + m
        top = [[1 if i == j else 0 for j in range(k)] for i in range(k)]
        # Vandermonde parity rows: V[i][j] = (i+1)^j over GF(2^8)
        bottom = []
        for i in range(m):
            base = i + 1
            row, val = [], 1
            for _ in range(k):
                row.append(val)
                val = gf_mul(val, base)
            bottom.append(row)
        self.matrix = top + bottom            # (k+m) x k

    def encode(self, data_shards):
        """data_shards: list of k equal-length byte sequences -> n shards."""
        assert len(data_shards) == self.k
        length = len(data_shards[0])
        shards = [list(s) for s in data_shards] + [[0] * length for _ in range(self.m)]
        for p in range(self.m):
            coeffs = self.matrix[self.k + p]
            out = shards[self.k + p]
            for byte in range(length):
                acc = 0
                for j in range(self.k):
                    acc ^= gf_mul(coeffs[j], shards[j][byte])
                out[byte] = acc
        return [bytes(s) for s in shards]

    def decode(self, shards, present):
        """
        shards:  list of n entries; missing ones may be None.
        present: list of indices that are available (len >= k).
        Returns the reconstructed k data shards.
        """
        if len(present) < self.k:
            raise ValueError(f"only {len(present)} shards; need {self.k}")
        use = present[: self.k]                          # any k survivors
        sub = [self.matrix[i] for i in use]              # k x k
        inv = mat_inverse(sub)                           # decode matrix
        length = len(next(s for s in shards if s is not None))
        recovered = [[0] * length for _ in range(self.k)]
        for byte in range(length):
            col = [shards[i][byte] for i in use]
            for r in range(self.k):
                acc = 0
                for c in range(self.k):
                    acc ^= gf_mul(inv[r][c], col[c])
                recovered[r][byte] = acc
        return [bytes(r) for r in recovered]


# ---------------------------------------------------------------------------
# Failure-injection harness: encode, drop up to m random shards, decode,
# and assert exact recovery. Also proves that dropping m+1 shards is fatal.
# ---------------------------------------------------------------------------
def failure_harness(k=10, m=4, payload_len=64, trials=2000, seed=7):
    rng = random.Random(seed)
    rs = RS(k, m)
    for _ in range(trials):
        data = [bytes(rng.randrange(256) for _ in range(payload_len)) for _ in range(k)]
        shards = list(rs.encode(data))

        # drop a recoverable number of shards (0..m), at random positions
        to_drop = rng.randrange(0, m + 1)
        dropped = rng.sample(range(rs.n), to_drop)
        for d in dropped:
            shards[d] = None
        present = [i for i in range(rs.n) if shards[i] is not None]

        recovered = rs.decode(shards, present)
        assert recovered == data, f"recovery failed dropping {dropped}"

    # negative test: dropping m+1 shards must be unrecoverable
    data = [bytes(rng.randrange(256) for _ in range(payload_len)) for _ in range(k)]
    shards = list(rs.encode(data))
    for d in rng.sample(range(rs.n), m + 1):
        shards[d] = None
    present = [i for i in range(rs.n) if shards[i] is not None]
    try:
        rs.decode(shards, present)
        raise AssertionError("decoded with too few shards (should be impossible)")
    except ValueError:
        pass   # expected: not enough shards

    print(f"RS({k},{m}): {trials} trials passed; m+1 losses correctly unrecoverable.")


# ---------------------------------------------------------------------------
# Monte-Carlo durability estimate.
# Model: each shard independently unavailable with probability p at a snapshot.
# A stripe is LOST iff more than m of its n shards are unavailable.
# Compare the simulated loss probability to the combinatorial closed form.
# ---------------------------------------------------------------------------
def durability_monte_carlo(k, m, p, trials=2_000_000, seed=1):
    rng = random.Random(seed)
    n = k + m
    losses = 0
    for _ in range(trials):
        failed = sum(1 for _ in range(n) if rng.random() < p)
        if failed > m:
            losses += 1
    sim = losses / trials
    return sim


def durability_closed_form(k, m, p):
    """Exact P(more than m of n shards fail) under independence."""
    from math import comb
    n = k + m
    return sum(comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(m + 1, n + 1))


def nines(prob_loss):
    if prob_loss <= 0:
        return float("inf")
    import math
    return -math.log10(prob_loss)


if __name__ == "__main__":
    # 1) correctness + failure injection
    failure_harness(k=10, m=4, payload_len=64, trials=2000)
    failure_harness(k=6, m=3, payload_len=48, trials=2000)

    # 2) durability: closed form vs. Monte-Carlo, for a snapshot p
    p = 0.01   # 1% of shards unavailable at any instant (pessimistic snapshot)
    for (k, m) in [(10, 4), (6, 3), (17, 3), (3, 2)]:
        exact = durability_closed_form(k, m, p)
        # fewer trials for wide codes with tiny p just to keep runtime sane
        sim = durability_monte_carlo(k, m, p, trials=500_000)
        print(
            f"RS({k:>2},{m}) p={p}: "
            f"P(loss) closed-form={exact:.3e} (~{nines(exact):.1f} nines), "
            f"MC~{sim:.3e}"
        )
```

What to take from this code:

- **`gf_mul` is the hot loop.** In production this single function is replaced by SIMD/PSHUFB or CLMUL doing 16–32 lanes at once (§8). The log/exp version is correct and readable but is exactly the scalar path the HDFS docs warn against.
- **Systematic matrix** (identity on top) means data shards are stored verbatim — no decode needed unless a data shard is actually missing. This is what real systems do so the common "all shards present" read path is free.
- **`decode` picks any k survivors**, inverts that k×k submatrix, and multiplies — the general erasure-recovery procedure. Note it reads **k shards to recover** even a single lost one: that's the repair read-amplification (§6) made literal.
- **The Monte-Carlo and closed-form agree**, demonstrating the p^(m+1) durability scaling of §4. Swap in correlated failures (fail whole "racks" together) and you'll watch durability collapse — the §7 lesson in code.

---

## 13. Decision tables and sizing

### 13.1 Replication vs. EC vs. LRC

| Question | Replication | Reed–Solomon EC | LRC |
|---|---|---|---|
| Storage overhead | High (2–3×) | Low (1.2–1.5×) | Low-ish (~1.3×) |
| Single-shard repair I/O | 1× (read one copy) | **k× (read k shards)** | **~k/2× (local group)** |
| Fault tolerance per parity | linear, costly | **m, MDS-optimal** | m, slightly sub-optimal |
| Small-object friendly | **Yes** | No | No |
| Hot random reads | **Yes** | No (degraded-read tail) | No |
| In-place updates | **Yes** | No (RMW parity) | No |
| Best for | hot, small, mutable | warm/cold, large, immutable | cold at scale where repair I/O is the bottleneck |

### 13.2 Choosing k and m

| Goal | Lever | Trade-off |
|---|---|---|
| More fault tolerance | ↑ m | ↑ storage overhead; ↑ encode cost |
| Lower storage overhead | ↑ k (wider stripe) | ↑ repair I/O (read k); ↑ degraded-read fan-out; needs more failure domains |
| Cheaper repair | LRC / regenerating code | non-MDS (slightly more storage) or more complexity |
| Faster encode/decode | SIMD library (ISA-L) | x86/ARM-specific tuning |

Sizing rule of thumb: pick **m** from your durability/failure-domain target (and the number of domains you can tolerate losing together), pick **k** to hit your storage-overhead target *without exceeding the failure-domain count* (you need ≥ n distinct domains for domain-level tolerance), then confirm repair I/O at that k is affordable — if not, go LRC.

### 13.3 Overhead and tolerance quick reference

| Code | n | Overhead n/k | Tolerates | Min domains for domain-tolerance |
|---|---|---|---|---|
| 3× repl | 3 | 3.00× | 2 | 3 |
| RS(3,2) | 5 | 1.67× | 2 | 5 |
| RS(6,3) | 9 | 1.50× | 3 | 9 |
| RS(10,4) | 14 | 1.40× | 4 | 14 |
| RS(17,3) | 20 | 1.18× | 3 | 20 |
| LRC(12,2,2) | 16 | 1.33× | up to 4 | 16 |

---

## 14. Checklists

### 14.1 Design checklist (before you ship an EC tier)

- [ ] Chosen (k, m) **modeled** for durability (Markov + Monte-Carlo) against your real MTTF/MTTR.
- [ ] **≥ n distinct failure domains** at the level you must tolerate (rack/AZ), with placement enforced.
- [ ] **Per-shard checksums** (CRC32C or similar) so silent corruption becomes a known erasure — *EC alone does not handle bit rot.*
- [ ] **Background scrubbing** scheduled, with a cadence and a scrub-error metric.
- [ ] **Native SIMD coder** (ISA-L / klauspost / equivalent) deployed and verified engaged — no scalar fallback.
- [ ] **Risk-prioritized repair queue** (closest-to-loss first), not FIFO.
- [ ] **Repair-bandwidth cap** set, with the MTTR-vs-client-SLA trade understood and modeled.
- [ ] Workload is **large + cold + immutable** — small/hot/mutable data stays on replication.
- [ ] **Conversion job** writes-and-verifies EC stripe *before* deleting replicas (never the reverse).
- [ ] **Placement-invariant checker** (shards-per-domain) running continuously to catch drift.

### 14.2 Operational checklist (running the tier)

- [ ] Dashboards for repair bandwidth, MTTR, stripes-at-risk, scrub errors, placement violations, encode/decode throughput, degraded-read rate.
- [ ] Alerts on **placement-invariant violations** and **MTTR over budget** (treated as durability incidents).
- [ ] **Fault injection** exercised regularly (kill node, fail disk, corrupt shard, partition rack); MTTR validated.
- [ ] Tiering policy has **hysteresis** to avoid thrashing objects across the replication⇄EC boundary.
- [ ] Repair-storm runbook: known cap, prioritization, and "is durability degraded right now?" answer.
- [ ] Re-model durability whenever disk size grows (longer rebuild → higher MTTR) or repair throughput changes.

---

## 15. Cheat sheet

```
RS(k, m): k data + m parity = n shards; ANY k of n reconstruct. MDS-optimal.
Tolerates exactly m losses. Replication = RS(1, r-1).

OVERHEAD            n/k   | RS(10,4)=1.4x  RS(6,3)=1.5x  RS(17,3)=1.18x  3x repl=3x
DURABILITY          P(loss) ~ C(n,m+1) * p^(m+1)   ->  +1 parity ~ * p more nines
                    Markov: durability ~ (MTTF/MTTR)^m   -> faster repair = more nines
REPAIR (RS)         1 lost shard => READ k shards (k-x read amplification!)
REPAIR (LRC)        local parity => read ~local group, not all k  (Azure 12,2,2)

EC HANDLES ERASURES (known-missing), *NOT* silent corruption.
  -> per-shard CHECKSUMS turn bit-rot into a known erasure RS can fix. SCRUB.

PLACEMENT           spread n shards over n distinct failure domains
                    need >= n racks/AZs for rack/AZ-level tolerance
                    correlated failure (PDU/switch/firmware) defeats any m

HOT/SMALL/MUTABLE   -> replication      WARM/COLD/LARGE/IMMUTABLE -> EC
SMALL FILES         bad on EC (k+m tiny fragments, fixed cost dominates)
PARTIAL WRITES      bad on EC (read-modify-write parity) -> prefer append-only

HOT LOOP            GF(2^8) multiply. log/exp tables -> SIMD PSHUFB / CLMUL.
LIBS                ISA-L (x86 fast), Jerasure/GF-Complete, klauspost (Go), liberasurecode
THROUGHPUT          scalar: ~hundreds MB/s ; SIMD: several GB/s/core (verify locally)

OPS                 risk-prioritized repair, bandwidth cap (MTTR vs SLA),
                    reconstruction storms after node loss, scrub for bit-rot.
MIGRATION           repl->EC for cold/large/immutable; verify EC before deleting replicas.
MODEL               Markov + Monte-Carlo durability; fault-inject to validate MTTR.
```

---

## 16. Summary

Erasure coding is the lever that turns 3× replication into ~1.4× overhead at *better* fault tolerance — at petabyte scale, roughly half the disks, power, and cooling for your warm and cold tiers. Reed–Solomon dominates because it is MDS-optimal: m parity shards, m failures tolerated, zero waste. But the overhead reduction is bought with **repair bandwidth** (one lost shard costs k shard-reads), **CPU** (the GF(2^8) multiply hot loop, fast only with SIMD), **small-file and partial-write pain**, and **degraded-read latency**. That cost profile is exactly why EC belongs on **large, cold, immutable** objects and replication stays on **small, hot, mutable** ones — the f4/HDFS-EC tiering pattern.

Durability follows **p^(m+1)** combinatorially and **(MTTF/MTTR)^m** dynamically — which makes **fast repair** and **independent failure domains** durability levers, not just cost knobs. The two correctness traps that bite real operators: **EC corrects erasures, not silent corruption** — you *must* pair it with per-shard checksums and scrubbing — and **MDS tolerance is meaningless if shards share a failure domain**, so placement across racks/AZs is non-negotiable. LRC exists because repair bandwidth is the scarce resource at scale: trade a little MDS-optimality for half the single-shard repair I/O. Operate it with risk-prioritized repair, bandwidth caps, fault injection, durability modeling, and the dashboards that treat a placement violation or a blown MTTR as the durability incident it actually is.

---

## 17. Further reading

- **HDFS Erasure Coding** — Apache Hadoop documentation and the **HDFS-7285** design document (striped vs. contiguous layout, RS(6,3)/RS(10,4), ISA-L coder, small-file caveat).
- **Huang et al., "Erasure Coding in Windows Azure Storage,"** USENIX ATC 2012 — the canonical **LRC** paper; FAST/ATC line of Azure storage work.
- **Muralidhar et al., "f4: Facebook's Warm BLOB Storage System,"** OSDI 2014 — RS(10,4) warm tier + geo XOR; the textbook warm/cold tiering case.
- **Sathiamoorthy et al., "XORing Elephants: Novel Erasure Codes for Big Data,"** VLDB 2013 — Facebook/HDFS **Xorbas LRC** for repair-bandwidth reduction.
- **Backblaze, "Reed-Solomon Erasure Coding"** blog + open-sourced Java implementation — the best small, readable RS reference; Vault RS(17,3) over 20 pods/racks.
- **Plank et al., Jerasure / GF-Complete** — James Plank's library and papers; the academic reference for fast GF(2^8) arithmetic and code construction.
- **Intel ISA-L documentation** — the production SIMD erasure-coding library (AVX2/AVX-512, PSHUFB split-multiply).
- **Ceph documentation** — erasure-coded pools, jerasure/ISA-L/clay plugins, CRUSH placement, partial-overwrite constraints.
- **MinIO and OpenStack Swift docs** — accessible production EC object stores (per-object erasure sets; PyECLib/liberasurecode backends).
- Field-arithmetic foundations: [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/professional.md) and the broader [Number Theory](../../19-number-theory/) section.

---

*Continue across tiers:* [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · **professional** · [interview](interview.md)
