# Erasure Coding & Reed–Solomon — Interview Questions

A question-and-answer bank for systems and storage interviews. The goal is not to make you recite the Reed–Solomon algorithm from memory, but to let you *reason* about the trade-offs an interviewer actually cares about: storage overhead, repair cost, durability math, and when erasure coding is the wrong tool.

Related tiers: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md). For the field arithmetic that underpins everything here, see [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md).

---

## Table of Contents

- [Conceptual](#conceptual)
- [Replication vs Erasure Coding](#replication-vs-erasure-coding)
- [XOR Parity & RAID](#xor-parity--raid)
- [(n,k) MDS Codes](#nk-mds-codes)
- [Reed–Solomon Mechanics (polynomial & matrix)](#reedsolomon-mechanics-polynomial--matrix)
- [Finite-Field GF(2^8)](#finite-field-gf28)
- [Repair Bandwidth, LRC & Regenerating Codes](#repair-bandwidth-lrc--regenerating-codes)
- [Production & Durability](#production--durability)
- [System Design](#system-design)
- [Gotcha / Trick](#gotcha--trick)
- [Rapid-Fire](#rapid-fire)
- [Common Mistakes](#common-mistakes)
- [Tips & Summary](#tips--summary)

---

## Conceptual

### Q1: What problem does erasure coding solve, in one sentence? *(Easy)*

**Answer**: Erasure coding lets you tolerate the loss of some pieces of your data while storing far less redundant data than full replication. You take `k` data fragments, compute `m` parity fragments, store all `n = k + m` on different failure domains, and you can reconstruct the original from *any* `k` of the `n` fragments. The "erasure" in the name refers to the failure model: a fragment is either present-and-correct or *known to be missing*. That known-missing assumption is the crucial subtlety, and it shows up repeatedly below.

---

### Q2: Why is it called an "erasure" code and not an "error-correcting" code? *(Medium)*

**Answer**: The distinction is about *whether you know where the failure is*.

- An **erasure** is a symbol whose *position* is known to be lost — a disk died, a node is unreachable, a fragment returned a read error. You know exactly which `m` of the `n` symbols are gone.
- An **error** is a symbol that is silently *wrong* but still present, with an unknown location.

Locating an unknown error costs you twice the redundancy of correcting a known erasure. A code with `m` parity symbols (an MDS code) can recover from `m` erasures but only `floor(m/2)` errors, because half the redundancy is spent *finding* the bad symbol and half is spent *fixing* it. Storage systems are designed around erasures: the layer below (disk, network, RPC) tells you *which* fragment is missing, so all `m` parities go toward recovery. This is exactly why erasure coding alone does not protect against silent corruption — see [Q34](#q34-does-erasure-coding-detect-silent-corruption-bit-rot).

---

### Q3: Give the intuition for "any k of n" without any math. *(Easy)*

**Answer**: Think of the classic "shared secret" picture. A straight line is fixed by any 2 points. If you hand out 5 points that all lie on one secret line, any friend who collects *any* 2 of them can redraw the whole line — and read off any other point, including ones they were never given. The line is your data (degree-1, so 2 coefficients = 2 data symbols), and the 5 points are your encoded fragments. Reed–Solomon generalizes this from a line to a degree-`(k-1)` polynomial: `k` points pin it down, and you can hand out `n > k` points so that *any* `k` survivors regenerate it.

---

### Q4: What are the three costs you "pay" for erasure coding's storage savings? *(Medium)*

**Answer**:

1. **Repair I/O (read amplification).** To rebuild one lost fragment in a classic RS(k,m) code you must read `k` other fragments — often from across the network — even though you only lost one. Replication reads exactly one copy to repair.
2. **CPU and encode/decode latency.** Encoding and decoding require finite-field matrix arithmetic. It is cheap per byte on modern hardware (SIMD/GF tables, ISA-L), but non-zero, and decode is on the read path when a fragment is missing.
3. **Reconstruction / tail latency on reads.** A degraded read (a fragment is missing) must fetch `k` fragments and decode, so it is slower and touches more nodes than reading a single replica. EC also makes small random writes expensive because of read-modify-write on parity.

The headline win — roughly 1.4×–1.5× overhead instead of 3× — is paid for in bandwidth and latency, not in dollars-per-byte. That is the whole trade.

---

## Replication vs Erasure Coding

### Q5: Compare 3× replication to RS(6,3) on storage overhead and fault tolerance. *(Easy)*

**Answer**:

| Scheme | Raw : Usable | Overhead | Failures tolerated |
|---|---|---|---|
| 3× replication | 3 : 1 | 200% (3.0×) | 2 |
| RS(6,3) | 9 : 6 | 50% (1.5×) | 3 |

RS(6,3) stores **half** the redundant bytes of 3× replication yet tolerates **one more** simultaneous failure (3 vs 2). That is the canonical pitch for EC in cold/warm storage. The catch is repair: losing one fragment in RS(6,3) means reading 6 fragments to rebuild, whereas a replication repair reads 1.

---

### Q6: If EC is so much cheaper, why does anyone still use replication? *(Medium)*

**Answer**: Replication wins where EC's costs bite hardest:

- **Hot data / low latency.** A replicated read is one round trip to one node. A degraded EC read fans out to `k` nodes and decodes.
- **Small objects and high write rates.** EC has a fixed per-object metadata and stripe overhead; for tiny objects the parity and bookkeeping can dwarf the data. Small in-place updates trigger parity read-modify-write.
- **Cheap, fast repair / rebalancing.** Replicas copy 1:1. EC repair amplifies I/O by `k`.
- **Simplicity and locality.** Replicas can be read locally; you can serve from the nearest copy.

The standard production answer is **tiered**: replicate hot/small/recently-written data, then erasure-code it as it cools or after it is sealed. HDFS, Ceph, and object stores all do variants of this.

---

### Q7: Does erasure coding always use *less* space than replication? *(Medium)*

**Answer**: No — it depends on the parameters and the object size.

- For a fixed durability target on large objects, EC almost always wins (e.g., RS(10,4) is 1.4× vs 3× replication).
- For **tiny objects**, the per-fragment overhead (each of `n` fragments has its own header, checksum, and metadata entry) plus padding to the stripe/symbol size can make EC *more* expensive than replication. Many systems set a minimum object size before they EC.
- A pathological choice like RS(2,2) is 2× overhead — same as 2× replication but with worse repair and read latency, so it is rarely worth it.

The savings come from a *large* `k` relative to `m`. Overhead is `n/k = (k+m)/k`; to get below 1.5× you need `k >= 2m`.

---

## XOR Parity & RAID

### Q8: How does single-parity XOR (RAID-5) work, and what is its hard limit? *(Easy)*

**Answer**: Lay out `k` data blocks `d1..dk` and compute one parity block `p = d1 XOR d2 XOR ... XOR dk`. XOR is its own inverse, so if any *one* block is erased you recover it by XOR-ing the survivors: `di = p XOR (all other dj)`. That is RS(k,1) and the basis of RAID-5.

The hard limit: a single XOR parity tolerates **exactly one** erasure. Lose two blocks and you have one equation (`p = XOR of all`) but two unknowns — unsolvable. To tolerate two failures you need a second, *independent* parity, which can no longer be plain XOR of all blocks (that would just duplicate the same equation). That second parity is where Reed–Solomon enters.

---

### Q9: Is RAID-6 just Reed–Solomon? *(Hard)*

**Answer**: Essentially yes — RAID-6 is an `m = 2` MDS code, and the standard construction *is* Reed–Solomon (or an equivalent like EVENODD/RDP). It computes two independent parities:

- **P** = the simple XOR of all data blocks (the same parity as RAID-5).
- **Q** = a Reed–Solomon syndrome: `Q = d1·g^0 XOR d2·g^1 XOR ... XOR dk·g^(k-1)`, where `g` is a generator of GF(2^8) and `·` is finite-field multiplication.

The two parities are independent because P weights every block by `1` while Q weights block `i` by a *distinct* field element `g^i`. With two independent linear equations you can solve for any two unknowns, so RAID-6 tolerates any two failures. So the precise answer is: RAID-6 is a *specific small instance* of Reed–Solomon coding (with `m=2`). RS is the general framework; RAID-6 is one point in it. (EVENODD and RDP are XOR-only RAID-6 codes that achieve the same fault tolerance without full GF multiplication — they are MDS but not literally Reed–Solomon.)

---

### Q10: Why can't you just use more XOR parities to tolerate more failures? *(Medium)*

**Answer**: Because additional parities must be *linearly independent*, and plain XOR can only give you one independent equation over the data. If your second parity is also a simple XOR of some subset of blocks, then over GF(2) it is just another sum and you can often combine equations to find a 2-failure pattern that is unrecoverable. To get `m` independent parities you must weight each data block by a *distinct, carefully chosen* coefficient for each parity — and to guarantee that *every* `k`-subset of the `n` equations is solvable, those coefficients must come from a finite field with the MDS property. That requirement is precisely what forces you out of plain XOR and into GF(2^8) arithmetic and a Vandermonde/Cauchy generator matrix.

---

## (n,k) MDS Codes

### Q11: What does "MDS" mean and why does it matter? *(Medium)*

**Answer**: **MDS = Maximum Distance Separable.** An (n,k) MDS code achieves the best possible fault tolerance for its redundancy: it can recover the original data from *any* `k` of the `n` fragments, equivalently it tolerates *any* `m = n − k` erasures. There is no "unlucky" combination of `m` failures that defeats it.

Why it matters: with an MDS code, durability math is clean. You do not have to reason about *which* fragments failed, only *how many*. "Survives any 4 failures" is a much stronger and simpler guarantee than "survives most 4-failure patterns." Reed–Solomon is the canonical MDS code, which is exactly why it is the default in durable storage.

---

### Q12: State the Singleton bound and relate it to MDS. *(Hard)*

**Answer**: The **Singleton bound** says that for a code over `n` symbols carrying `k` symbols of information, the minimum distance `d` satisfies `d <= n − k + 1`. Minimum distance `d` means any two valid codewords differ in at least `d` positions, which lets you correct up to `d − 1` *erasures*. So the bound says you can tolerate at most `n − k = m` erasures — you cannot tolerate more erasures than you have parity symbols, which is intuitively obvious (you cannot solve for more unknowns than you have equations).

A code is **MDS** precisely when it *meets* this bound with equality: `d = n − k + 1`. Reed–Solomon meets the Singleton bound, so it is MDS — it extracts the theoretical maximum fault tolerance from its parity. No code can tolerate `m+1` erasures with only `m` parity symbols; that would violate the bound.

---

### Q13: For RS(10,4), how many simultaneous failures can it survive — 4 or 5? *(Easy)*

**Answer**: **4.** `m = n − k = 14 − 10 = 4`. You need *any 10 of the 14* fragments to reconstruct, so you can lose up to 4. Lose 5 and only 9 survive — fewer than `k = 10` — and reconstruction is mathematically impossible (9 points cannot pin down a degree-9 polynomial). The "any k of n" framing makes this a one-line calculation: survivable failures = `n − k`. This is a favorite trap question; the answer is always `m`, never `m+1`.

---

### Q14: In RS(k,m), what do `n`, `k`, and `m` mean and how do you read the overhead off them? *(Easy)*

**Answer**:

- `k` = number of **data** fragments (the original data is split into `k` pieces).
- `m` = number of **parity** fragments computed from the data.
- `n = k + m` = total fragments stored.

Fault tolerance = `m` erasures. **Storage overhead = `n / k = (k + m) / k`.** Examples:

- RS(6,3): overhead `9/6 = 1.5×`, tolerates 3.
- RS(10,4): overhead `14/10 = 1.4×`, tolerates 4.
- RS(12,4): overhead `16/12 ≈ 1.33×`, tolerates 4.

Larger `k` lowers overhead but raises repair cost (you read `k` fragments to repair one) and widens the stripe across more failure domains.

---

## Reed–Solomon Mechanics (polynomial & matrix)

### Q15: Explain Reed–Solomon via the polynomial (evaluation/interpolation) view. *(Medium)*

**Answer**: Treat the `k` data symbols as the coefficients of a polynomial of degree `k − 1`:

```
P(x) = d0 + d1·x + d2·x^2 + ... + d_{k-1}·x^{k-1}
```

Pick `n` distinct evaluation points `x0, x1, ..., x_{n-1}` in the field. The `n` encoded fragments are the *evaluations* `P(x0), P(x1), ..., P(x_{n-1})`. Because a degree-`(k-1)` polynomial is uniquely determined by *any* `k` of its values (Lagrange interpolation), any `k` surviving fragments let you reconstruct `P` — and therefore all the original coefficients `d0..d_{k-1}` and any lost evaluations. Encoding = polynomial evaluation; decoding = polynomial interpolation. The "any k of n" MDS property falls out directly from the fundamental theorem that `k` points determine a degree-`(k-1)` polynomial.

---

### Q16: Now explain the generator-matrix (matrix) view. *(Medium)*

**Answer**: Both encode and decode are linear, so write them as matrix multiplication over the field. Let `D` be the `k`-vector of data symbols and `G` an `n × k` **generator matrix**. The codeword is:

```
C = G · D     (C is the n-vector of fragments)
```

Choose `G` so its top `k × k` block is the identity — then the first `k` fragments are the original data verbatim (a *systematic* code), and the bottom `m` rows produce the parity. The MDS magic is a property of `G`: **every `k × k` submatrix of `G` must be invertible.** Then for any set of `k` surviving fragments, take the corresponding `k` rows of `G`, invert that `k × k` submatrix, and multiply to recover `D`:

```
D = (G_survivors)^{-1} · C_survivors
```

The polynomial view and the matrix view are the same code: evaluating a degree-`(k-1)` polynomial at `n` points *is* multiplying the coefficient vector by a Vandermonde matrix.

---

### Q17: What is the Vandermonde matrix and why does it show up? *(Medium)*

**Answer**: A Vandermonde matrix is built from the evaluation points: row `i` is `[1, x_i, x_i^2, ..., x_i^{k-1}]`. Multiplying the data (coefficient) vector by this matrix *is* evaluating the polynomial at each `x_i` — so it is the natural generator matrix for the polynomial-view RS code. Its key property: a Vandermonde matrix with *distinct* `x_i` has every square submatrix invertible (its determinant is a product of `(x_i − x_j)` terms, non-zero when the points are distinct), which is exactly the MDS condition. So Vandermonde gives you an MDS code "for free" — *in principle*.

---

### Q18: What is the problem with a naive systematic Vandermonde code, and what's the fix? *(Hard)*

**Answer**: The trouble is making it *systematic*. To get the identity in the top `k` rows you perform row operations on the Vandermonde matrix, and over a finite field those operations can accidentally make some `k × k` submatrix **singular** for certain failure patterns — silently breaking the MDS guarantee for *those specific* failures. Some hand-built "Vandermonde-based" RS implementations have shipped with exactly this bug, recovering most failure patterns but not all.

Two common fixes:

1. **Cauchy Reed–Solomon.** Build the generator from a **Cauchy matrix**, whose entries are `1 / (x_i ⊕ y_j)` for two disjoint sets of field elements. *Every* submatrix of a Cauchy matrix is provably invertible, so the MDS property holds for *all* failure patterns by construction. Cauchy-RS also maps multiplication onto XOR of bit-matrices, which is fast (the Jerasure/ISA-L libraries use it).
2. **Use a proven systematic construction** rather than ad-hoc Gaussian elimination on a Vandermonde matrix.

The interview point: "Vandermonde gives MDS in theory, but the systematic form can hit singular submatrices; Cauchy guarantees every submatrix is invertible, so it is the safer/faster choice in practice."

---

### Q19: Walk through encoding a tiny stripe (conceptually). *(Medium)*

**Answer**: Take RS(2,2) — 2 data, 2 parity — over a small field. Data symbols `d0, d1` define `P(x) = d0 + d1·x`. Pick 4 distinct points `x = 1, 2, 3, 4`. Encode:

- frag0 = `P(1) = d0 + d1`
- frag1 = `P(2) = d0 + 2·d1`
- frag2 = `P(3) = d0 + 3·d1`
- frag3 = `P(4) = d0 + 4·d1`

(all arithmetic in the finite field, so `+` is XOR and `·` is field multiplication). Now lose any two, say frag1 and frag2. You still have `P(1)` and `P(4)` — two points on a line — and a line is fixed by two points, so you interpolate to recover `d0, d1`, then re-evaluate to regenerate frag1 and frag2. The decode is solving a 2×2 linear system; for general (k,m) it is inverting a `k × k` submatrix.

---

## Finite-Field GF(2^8)

### Q20: Why do Reed–Solomon codes use finite fields instead of ordinary integer or real arithmetic? *(Hard)*

**Answer**: Three reasons, all fatal to the integer approach:

1. **Closure / no overflow.** Bytes are 8-bit symbols. Ordinary multiplication of two bytes overflows 8 bits; you would need ever-growing word sizes. In `GF(2^8)` every element is exactly one byte and *every* operation (add, multiply, invert) yields another byte. The math is closed on the symbol size.
2. **Exact, reversible arithmetic.** Real/float arithmetic has rounding error; you cannot reconstruct data exactly after interpolation. Integer arithmetic has no multiplicative inverses (you cannot divide), so you cannot invert the decode matrix. A *field* guarantees every non-zero element has a multiplicative inverse, so Gaussian elimination / matrix inversion always works exactly.
3. **The MDS guarantee needs distinct elements with field structure.** Vandermonde/Cauchy invertibility relies on field axioms (distinct points, non-zero differences having inverses). Over the integers mod a *composite* you would have zero divisors and the determinants could vanish.

So: a finite field is the unique algebraic structure that is closed on a fixed symbol width, has exact inverses, and gives the MDS property. See [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md) for the inverse/closure intuition. (A *prime* field GF(p) is also a field, but GF(2^8) is chosen because its elements map perfectly onto 8-bit bytes and addition is just XOR.)

---

### Q21: How do addition and multiplication work in GF(2^8)? *(Hard)*

**Answer**:

- **Addition (and subtraction) = bitwise XOR.** Elements are polynomials over GF(2) with coefficients in {0,1}, represented as bytes. Adding them adds coefficients mod 2 — which is XOR. There is no carry. A neat consequence: `a + a = 0`, so add and subtract are the *same* operation, which is why XOR-only repair works.
- **Multiplication = polynomial multiply, then reduce modulo a fixed irreducible polynomial.** Multiply the two byte-polynomials (a carry-less multiply), which can produce up to 15 bits, then reduce modulo an irreducible degree-8 polynomial — for the common AES/storage field that is `x^8 + x^4 + x^3 + x + 1` (`0x11B`). The reduction keeps the result within 8 bits and makes the set a field.

In practice nobody does this bit by bit at runtime: implementations precompute log/antilog tables (multiply via `antilog[log[a] + log[b]]`) or use SIMD `pshufb`/GFNI instructions. The irreducible polynomial must be *irreducible* (no non-trivial factors) so that every non-zero element has an inverse — that is what makes it a field rather than just a ring.

---

### Q22: Why GF(2^8) specifically, rather than GF(2^16) or a prime field? *(Medium)*

**Answer**: GF(2^8) has `256` elements, so symbols are exactly one byte — the natural unit of storage and the natural granularity for SIMD table lookups. It supports up to `n = 255` fragments (255 distinct non-zero evaluation points), which is far more than any real stripe needs (typical `n` is 6–20). Lookup tables fit in cache (256-entry log/antilog tables). GF(2^16) would be used only if you needed more than ~255 fragments in a stripe (rare); it doubles symbol size and balloons table sizes. A prime field GF(p) works mathematically but wastes the clean byte mapping and free-XOR addition. So GF(2^8) is the sweet spot for byte-oriented storage; some HPC codes use GF(2^16) or GF(2^4) for specific reasons, but 2^8 is the default.

---

## Repair Bandwidth, LRC & Regenerating Codes

### Q23: What is the "repair bandwidth problem" in classic Reed–Solomon? *(Medium)*

**Answer**: In RS(k,m), reconstructing a *single* lost fragment requires reading `k` *full* surviving fragments and decoding. So to regenerate one fragment's worth of data you move `k`× that fragment's size across the network. In a large cluster where disk failures are routine, single-fragment loss is the *common* case — and paying a `k`× repair-traffic tax on every one of them saturates network and disk I/O. With wide stripes (large `k`, which you want for low overhead) the problem gets *worse*: lower storage cost, higher repair cost. This tension — overhead vs repair bandwidth — is what LRC and regenerating codes attack.

---

### Q24: How do Local Reconstruction Codes (LRC) reduce repair cost? *(Hard)*

**Answer**: LRC (used in Azure Storage, and HDFS-style variants) adds **local parities** so that the *common* single-failure case can be repaired by reading only a few nearby fragments instead of all `k`. The idea: split the `k` data fragments into local groups, give each group its own *local* parity, and keep a couple of *global* parities spanning everything.

Azure's classic LRC(12,2,2): 12 data fragments split into 2 groups of 6, each group gets 1 local parity (so 2 locals), plus 2 global parities — 16 fragments total. To repair one lost *data* fragment you read only the other 5 in its local group plus that group's local parity — **6 reads instead of 12**. The global parities are there to preserve strong fault tolerance for rarer multi-failure patterns. The trade-off: LRC stores slightly *more* parity than the equivalent RS for the same overhead point and is generally *not* MDS (it cannot tolerate *every* pattern of `m` failures), but it tolerates the failures that actually happen while slashing repair traffic. It trades a little durability/overhead for a big cut in repair I/O.

---

### Q25: What are regenerating codes (MSR/MBR), and what trade-off do they expose? *(Hard)*

**Answer**: Regenerating codes come from a network-coding result by Dimakis et al. that proved a fundamental **trade-off between storage per node and repair bandwidth**. Instead of reading `k` whole fragments to repair one, a regenerating code contacts *more* helper nodes but downloads only a small *function* (a partial combination) of each one's data — so total repair traffic drops well below `k`× the fragment size, approaching the information-theoretic minimum.

The trade-off curve has two extremes:

- **MSR (Minimum Storage Regenerating):** keep storage as low as RS (MDS-optimal storage) and minimize repair bandwidth *subject to* that. You still get the best storage overhead, with much cheaper repair than plain RS.
- **MBR (Minimum Bandwidth Regenerating):** minimize repair bandwidth absolutely, at the cost of storing *more* per node than MDS.

You cannot minimize both at once — that is the whole point of the cut-set bound. MSR is the more practical/popular target for storage (Clay codes, Butterfly codes, Facebook/HashTag-style deployments) because storage overhead is the dollar cost you most want to preserve. The interview takeaway: **regenerating codes attack repair *bandwidth*; LRC attacks repair *locality / I/O count*. Both fight the same RS weakness from different angles.**

---

### Q26: LRC vs regenerating codes — when would you reach for each? *(Hard)*

**Answer**:

- **LRC** is simpler to implement and reason about, and directly reduces the *number of fragments read* (disk I/O ops and seeks) during the common single-failure repair. It is the choice when repair I/O count, locality, and operational simplicity dominate — hence its use in Azure and Hadoop. Cost: extra parity storage, loss of strict MDS.
- **Regenerating (MSR) codes** reduce *total network bytes moved* during repair while preserving MDS-optimal storage. They are mathematically heavier and were slower to reach production, but they shine when cross-rack/cross-zone *network bandwidth* is the bottleneck rather than disk seeks.

In short: LRC = fewer fragments touched (great for disk-bound clusters and simplicity); MSR = fewer bytes moved (great for network-bound clusters that refuse to give up storage efficiency).

---

## Production & Durability

### Q27: How does failure-domain placement interact with erasure coding? *(Medium)*

**Answer**: Fault tolerance is only real if the `m` failures the code can survive map to the failures that actually *correlate* in production. If you spread RS(10,4)'s 14 fragments across only 7 racks (2 per rack), then a single rack outage takes out 2 fragments at once — and three correlated rack failures (or two racks plus one disk) can exceed `m=4` even though "only a few racks" died. The rule: **place each fragment in a distinct failure domain** (different disk, host, rack, power zone, or availability zone), so that any single physical failure removes at most one fragment. Many systems require `n` distinct racks or spread fragments so no failure domain holds more than `floor(m / something)` fragments. EC's durability math (`tolerates m failures`) assumes failures are independent across fragments — placement is what makes that assumption hold.

---

### Q28: Erasure coding gives you durability — does it give you availability? *(Medium)*

**Answer**: Not the same way replication does. A *read* under EC must assemble `k` fragments; if `m'` fragments are merely *slow or temporarily unreachable* (not lost), the read either does a degraded reconstruction (fetch `k` from a wider set, decode — higher latency, more fan-out) or stalls. Replication can serve a read from any single available copy with no decode. So EC optimizes **durability per dollar** but can *hurt tail-latency availability*, especially for hot data. This is another reason production systems keep hot data replicated and EC the cold tier, or use LRC so degraded reads stay local.

---

### Q29: How do you reason about "eleven nines" of durability with EC? *(Hard)*

**Answer**: Durability (probability an object survives a year) depends on `m` (failures tolerated before loss), the per-fragment annual failure rate, and — critically — the **repair speed** relative to the failure rate. The object is lost only if more than `m` fragments fail *within a single repair window* before the system rebuilds. Modeling it as a birth-death / Markov process: more parity `m` adds nines; faster repair (smaller window) adds nines; correlated failures (bad placement) *remove* nines. So "design for 11 nines" is not just "pick big `m`" — it is "pick `m` *and* guarantee detection + repair are fast enough that the probability of `m+1` failures inside the repair window is below `10^-11`." This is why repair bandwidth (Q23–Q26) is a *durability* lever, not just a cost lever: slow repair widens the window and burns nines. And it is why you need background scrubbing to *detect* failures promptly (Q34).

---

### Q30: How are reads served and writes performed in an EC'd object store? *(Medium)*

**Answer**:

- **Write path:** buffer/erasure-code the object into `n` fragments, then scatter them to `n` nodes in distinct failure domains, acknowledging once enough fragments are durable. For a systematic code, the `k` data fragments are the object itself sliced up, plus `m` computed parities. Small in-place updates are expensive — you must read old data + old parity, recompute, and write back (read-modify-write), so EC stores favor immutable/append or full-object rewrite.
- **Read path (normal):** for a systematic code, just read the `k` data fragments and concatenate — *no decode needed*. This is why systematic codes are the default: the happy path is free.
- **Read path (degraded):** if a data fragment is missing, fetch `k` available fragments (some parity), invert the decode submatrix, and reconstruct — higher latency, more nodes touched.

---

## System Design

### Q31: "Design a durable object store targeting 11 nines of durability." Walk me through the storage layer. *(Hard)*

**Answer**: Key decisions and how I'd justify them:

1. **Tier by temperature.** Recently written / hot / small objects → replication (3×) for low latency and cheap repair. As objects cool and are sealed (immutable), re-encode to erasure coding to cut cost from 3× to ~1.4×.
2. **Pick the code.** RS(10,4) or RS(12,4) as a baseline (1.4×–1.33× overhead, tolerates 4). Use **systematic** so normal reads need no decode. If repair traffic is the bottleneck, switch to **LRC** (e.g., 12+2+2) so single-fragment repair reads ~6 not ~12 fragments — this directly buys durability nines by shrinking the repair window.
3. **Placement.** One fragment per failure domain — distinct disks, hosts, racks, and ideally zones — so no single physical failure removes more than one fragment. The durability model assumes independence; placement enforces it.
4. **Integrity.** EC does *not* detect corruption, so checksum every fragment (and the object), verify on read, and run a **background scrubber** that re-reads and re-checksums fragments to catch bit-rot early. On checksum mismatch, treat the fragment as erased and reconstruct.
5. **Repair pipeline.** Detect missing/bad fragments fast (heartbeats + scrub), prioritize stripes that have dropped close to `k`, and throttle repair to avoid I/O storms. Repair speed is a durability parameter.
6. **Durability math.** Validate via a Markov model that `P(more than m failures within the repair window) < 10^-11`, given your AFR, fragment count, and measured repair time. Add parity or speed up repair until the model clears 11 nines.

The thread tying it together: durability = parity + fast repair + good placement + corruption detection, *not* parity alone.

---

### Q32: A team asks: "Should we use replication or EC for our new service?" What do you ask them? *(Medium)*

**Answer**: I'd drive it from the workload:

- **Object size?** Tiny objects → replication (EC overhead dominates). Large objects → EC.
- **Read latency SLO / hotness?** Tight latency, hot data → replication (single-copy reads, no decode). Tolerant of degraded-read latency / cold data → EC.
- **Mutability?** Frequent small in-place updates → replication (EC's parity read-modify-write is painful). Immutable/append-only/whole-object writes → EC.
- **Cost sensitivity / scale?** Petabytes where storage dollars dominate → EC (1.4× vs 3× is a 2× cost cut).
- **Repair / rebalance frequency and network budget?** Constant churn on a network-bound cluster → consider LRC or MSR, or replication if simplicity wins.
- **Durability target?** Both can hit high nines; EC reaches them more cheaply at scale, *if* repair and placement are sound.

The crisp recommendation is usually a **hybrid**: replicate the hot/small/mutable tier, erasure-code the cold/large/immutable tier.

---

### Q33: Your EC system's repair traffic is saturating the network during disk failures. What do you change? *(Hard)*

**Answer**: The root cause is classic RS's `k`× repair amplification (Q23). Options, roughly in order of effort:

1. **Narrow the stripe or adjust (k,m).** Smaller `k` means fewer fragments read per repair — at the cost of higher storage overhead. A direct overhead-vs-repair trade.
2. **Adopt LRC.** Add local parities so single-fragment repair reads only a local group (~6) instead of all `k` (~12). Biggest practical win for the common single-failure case; costs a bit of extra parity and strict MDS.
3. **Adopt a regenerating (MSR) code.** Keep MDS storage but download partial combinations from more helpers to minimize *total bytes* moved. Best when network bytes (not I/O ops) are the bottleneck and you refuse to give up storage efficiency.
4. **Throttle and prioritize repair.** Rate-limit repair I/O, and prioritize stripes closest to losing data (those at `k+1` survivors) so you spend bandwidth where durability risk is highest.
5. **Improve detection/placement** so failures are independent and you are not repairing correlated bursts.

I'd start with LRC if disk I/O count dominates, MSR if cross-rack network bytes dominate, and immediately add repair throttling/prioritization regardless.

---

## Gotcha / Trick

### Q34: Does erasure coding detect silent corruption (bit-rot)? *(Hard)*

**Answer**: **No.** This is the single most important gotcha. EC handles *erasures* — failures whose location you already know. It does **not** detect or locate a fragment that is silently *wrong* but still present. If a fragment's bits flip on disk and the system feeds that corrupted fragment into the decode as if it were valid, the decode produces *garbage* for the whole stripe — corruption *spreads*. EC has, in effect, no idea anything is wrong, because it assumes all the symbols it's given are correct.

The fix is to **pair EC with checksums**: store a checksum per fragment (and per object), verify it on every read and during background scrubbing, and when a checksum fails, *mark that fragment as erased* and reconstruct from the others. That converts a silent *error* (which EC can't handle) into a known *erasure* (which it can). Production systems (Ceph, HDFS, S3-class stores) always layer integrity checks under EC for exactly this reason. "EC for durability, checksums for integrity" — they are complementary, not interchangeable.

---

### Q35: RS(10,4) — can it survive 5 failures? *(Easy)*

**Answer**: **No.** It survives exactly `m = n − k = 4`. After 5 losses only 9 fragments remain, fewer than `k = 10`, so reconstruction is impossible. The trap is the temptation to "round up." Survivable failures equal the parity count `m`, never `m + 1`. (See Q13 — this is asked constantly because candidates reflexively say `m+1`.)

---

### Q36: Is RAID-6 the same thing as Reed–Solomon? *(Medium)*

**Answer**: RAID-6 is a *special case* of Reed–Solomon with `m = 2` (two parities, tolerates two failures), commonly implemented exactly as RS — though some RAID-6 codes (EVENODD, RDP) achieve the same fault tolerance with XOR-only constructions and are MDS without being literal Reed–Solomon. So: "RAID-6 is an `m=2` MDS code; the standard implementation is Reed–Solomon, but RAID-6 ⊂ MDS, and not every RAID-6 code is literally RS." Saying "RAID-6 *is* RS" is close enough for most interviews but the precise statement scores extra points.

---

### Q37: Why not just use ordinary integer arithmetic for Reed–Solomon? *(Medium)*

**Answer**: Two killers (full version in Q20): (1) integer multiplication of byte-sized symbols **overflows** — you need ever-larger words, while GF(2^8) keeps everything in one byte; and (2) integers have **no multiplicative inverses** (you can't always divide), so you cannot invert the decode matrix exactly — and floats introduce rounding so reconstruction isn't exact. A finite field is the structure that is closed on a fixed byte width *and* gives exact inverses, which is precisely what encode/decode require.

---

### Q38: If a code can correct `m` erasures, how many silent errors can it correct? *(Hard)*

**Answer**: At most `floor(m/2)`. Correcting an *error* (unknown location + unknown value) costs twice the redundancy of correcting an *erasure* (known location): you spend half your parity *finding* the bad symbol and half *fixing* it. So an MDS code with `m` parity symbols corrects `m` erasures but only `floor(m/2)` errors. Storage systems sidestep this by using lower-layer checksums to *locate* corruption (converting errors into erasures), so all `m` parities go toward recovery — see Q34.

---

### Q39: A fragment comes back, but you're not sure if it's stale. Does EC help? *(Medium)*

**Answer**: No — EC has no notion of *version* or *freshness*. A stale-but-internally-consistent fragment is, from EC's view, a silently wrong symbol (an error, not an erasure), and feeding it into decode corrupts the result just like bit-rot does. You need versioning/sequence numbers and checksums at the storage layer to detect staleness and treat a stale fragment as erased. EC is purely about *recovering missing-but-known* fragments; correctness/freshness/integrity all live in layers above it.

---

## Rapid-Fire

Short, sharp answers to warm up or close out.

1. **Overhead of RS(6,3)?** `n/k = 9/6 = 1.5×` (50%).
2. **Overhead of RS(10,4)?** `14/10 = 1.4×` (40%).
3. **Failures tolerated by RS(k,m)?** `m`.
4. **3× replication storage overhead?** `3×` (200%).
5. **RAID-5 is RS(?, ?)** — single parity, `m = 1`, tolerates one failure.
6. **RAID-6 parity count?** `m = 2` (tolerates two failures).
7. **Addition in GF(2^8)?** Bitwise **XOR** (no carry).
8. **Multiplication in GF(2^8)?** Polynomial multiply, then reduce mod an irreducible degree-8 poly (commonly `0x11B`).
9. **MDS stands for?** Maximum Distance Separable — meets the Singleton bound, recovers from *any* `m` erasures.
10. **Singleton bound?** `d <= n − k + 1`.
11. **Systematic code means?** The `k` data fragments appear verbatim in the codeword — normal reads need no decode.
12. **Encoding in the polynomial view?** Evaluating a degree-`(k-1)` polynomial at `n` points.
13. **Decoding in the polynomial view?** Interpolating the polynomial from any `k` points.
14. **Why Cauchy over Vandermonde?** Every Cauchy submatrix is invertible — no singular-submatrix surprises; also XOR-friendly.
15. **Repair reads in classic RS?** `k` fragments to rebuild one (the `k`× repair-bandwidth problem).
16. **What does LRC reduce?** The *number of fragments read* on a single-fragment repair (locality / repair I/O); not strictly MDS.
17. **What do MSR codes minimize?** Repair *bandwidth* (bytes moved) while keeping MDS-optimal storage.
18. **Does EC detect bit-rot?** No — pair it with checksums; treat a bad checksum as an erasure.
19. **Max fragments in a GF(2^8) RS code?** Up to `n = 255` (distinct non-zero points).
20. **One-line rule for placement?** One fragment per failure domain.

---

## Common Mistakes

- **Claiming RS(k,m) survives `m+1` failures.** It survives exactly `m`. Reconstruction needs *any* `k` of `n`; lose `m+1` and you're below `k`.
- **Believing EC detects or fixes silent corruption.** It only handles *known* erasures. Without checksums, a corrupted fragment fed into decode poisons the whole stripe.
- **Forgetting repair cost when bragging about storage savings.** RS's `k`× repair amplification can be the real bottleneck; that's why LRC/MSR exist.
- **Assuming any Vandermonde RS is automatically safe for all failure patterns.** A naively-built *systematic* Vandermonde code can hit singular submatrices; Cauchy guarantees invertibility for every pattern.
- **Treating durability as "just pick big `m`."** Durability also depends on repair speed (the failure window) and on placement (failure independence). Slow repair or correlated placement burns nines.
- **Using integer/float arithmetic in your mental model.** Overflow and the lack of exact inverses make integers/floats unusable; finite fields are mandatory.
- **Putting multiple fragments of one stripe in the same failure domain.** A single rack/zone outage then removes several fragments at once and breaks the independence the durability math assumes.
- **EC-ing tiny or hot objects.** Per-fragment overhead dominates small objects, and degraded-read latency/fan-out hurts hot data. Replicate those tiers.
- **Saying "RAID-6 is exactly Reed–Solomon" without nuance.** It's an `m=2` MDS code; the standard impl is RS, but EVENODD/RDP are XOR-only MDS RAID-6 codes that aren't literally RS.

---

## Tips & Summary

**The one-line model.** Reed–Solomon = "evaluate a degree-`(k-1)` polynomial at `n` points over GF(2^8); any `k` points reconstruct it." Storage overhead is `n/k`; fault tolerance is `m = n − k`.

**The trade you must articulate.** EC buys storage savings (≈1.4× vs 3×) and pays in repair I/O (`k`× amplification), CPU, and degraded-read latency. That is *the* interview point — never sell EC without naming its costs.

**The three orthogonal layers.** (1) EC gives *durability* for known erasures; (2) *checksums* give *integrity* against silent corruption (turning errors into erasures); (3) *placement* gives *failure independence* so the durability math holds. All three are required; none substitutes for another.

**The repair-cost family.** Plain RS reads `k` fragments per repair. **LRC** (Azure/HDFS) cuts the *number of fragments read* via local parities (loses strict MDS). **Regenerating/MSR codes** cut *bytes moved* while keeping MDS storage. Know which bottleneck — disk I/O ops vs network bytes — each one targets.

**Why finite fields.** Closed on one byte, exact multiplicative inverses, MDS-friendly. Add = XOR; multiply = poly-multiply mod an irreducible polynomial. Integers overflow and can't invert; floats round.

**Cauchy vs Vandermonde.** Vandermonde gives MDS in principle but its systematic form can hit singular submatrices; Cauchy guarantees every submatrix is invertible and is XOR-friendly — the safer/faster production choice.

**Design instinct.** Hybrid tiering: replicate hot/small/mutable data; erasure-code cold/large/immutable data; layer checksums + background scrubbing; place one fragment per failure domain; treat repair speed as a durability lever.

For deeper derivations and code, continue with [middle](middle.md), [senior](senior.md), and [professional](professional.md). For the field-arithmetic foundations (closure, inverses, modular reduction), see [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/junior.md).
