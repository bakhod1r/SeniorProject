# Erasure Coding & Reed–Solomon — Senior Level

> You have read the [middle](middle.md) tier: a Reed–Solomon code is a set of evaluations of a degree-`<k` polynomial, parities live in a finite field, and decoding is "solve a linear system." This tier is about *engineering* that idea at petabyte scale. We build GF(2^8) arithmetic the way Jerasure and ISA-L actually build it (log/antilog tables), see why **Cauchy** matrices beat naive **Vandermonde** ones, write a byte-exact RS codec in Python and Go, and then confront the single fact that reshaped storage codes in the 2010s: **classic RS repair of one lost chunk costs `k×` the lost data in I/O and network.** That cost is what **Local Reconstruction Codes** (Azure) and **regenerating codes** (Dimakis) exist to fix.

---

## Table of Contents

1. [Where this sits](#1-where-this-sits)
2. [GF(2^8) arithmetic in detail](#2-gf28-arithmetic-in-detail)
3. [Vandermonde vs Cauchy generator matrices](#3-vandermonde-vs-cauchy-generator-matrices)
4. [Systematic encoding & decoding](#4-systematic-encoding--decoding)
5. [The repair-bandwidth problem](#5-the-repair-bandwidth-problem)
6. [Local Reconstruction Codes (LRC)](#6-local-reconstruction-codes-lrc)
7. [Regenerating codes](#7-regenerating-codes)
8. [Comparison table](#8-comparison-table)
9. [Code: byte-exact RS in Python and Go + an LRC sketch](#9-code-byte-exact-rs-in-python-and-go--an-lrc-sketch)
10. [Pitfalls](#10-pitfalls)
11. [Cheat sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further reading](#13-further-reading)

---

## 1. Where this sits

An RS(`n`, `k`) erasure code splits an object into `k` data chunks, computes `n − k = m` parity chunks, and stores all `n` on distinct fault domains (disks, nodes, racks). Any `k` of the `n` chunks reconstruct the original. This is **Maximum Distance Separable (MDS)**: with `m` parities you tolerate any `m` simultaneous erasures, which is provably the most fault tolerance achievable per unit of redundancy.

The senior-level questions are not "does it work" but:

- How is the field arithmetic implemented so encoding runs at GBps, not MBps?
- Which generator matrix do you pick, and why does the *wrong* choice silently corrupt decoding for some erasure patterns?
- When a disk dies in a 1000-node cluster, how much data crosses the network to heal it — and how do modern codes cut that by an order of magnitude?

The math leans on three companions you should keep open:

- [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/senior.md) — finite-field reduction is modular reduction by an irreducible polynomial.
- [Gaussian Elimination](../../19-number-theory/19-gaussian-elimination/senior.md) — decoding is inverting a `k×k` matrix over GF(2^8).
- [Polynomial Operations](../../19-number-theory/22-polynomial-operations/senior.md) — field multiplication is polynomial multiplication mod an irreducible polynomial.

---

## 2. GF(2^8) arithmetic in detail

### 2.1 Why a field, and why GF(2^8) specifically

Erasure coding needs arithmetic where every nonzero element has a multiplicative inverse, so linear systems are always solvable. The integers mod 256 are **not** a field (256 is not prime; e.g. 2 has no inverse). We instead use the **Galois field** `GF(2^8)`, the field with exactly 256 elements. Its elements are bytes — perfect for storage — and:

- **Addition is XOR.** No carries, no overflow, addition equals subtraction (`a + a = 0`). This is what makes coding cheap.
- **Multiplication** is multiplication of polynomials over GF(2), reduced modulo a fixed irreducible polynomial of degree 8.

GF(2^8) is the standard for storage codes because a symbol is exactly one byte, the field is large enough that `n` can be up to 255 (every nonzero element is a usable matrix coefficient), and SIMD tricks make byte-wise multiply fast.

### 2.2 Elements as polynomials

Interpret a byte `b = b7 b6 … b1 b0` as the polynomial

```
b7·x^7 + b6·x^6 + … + b1·x + b0   over GF(2)   (coefficients are 0 or 1)
```

So `0x53 = 0101 0011` is `x^6 + x^4 + x + 1`.

**Addition** of two such polynomials adds coefficients mod 2 = XOR of the bytes:

```
0x53 ⊕ 0xCA = (x^6+x^4+x+1) + (x^7+x^6+x^3+x) = x^7 + x^4 + x^3 + 1 = 0x99
```

### 2.3 Multiplication and the irreducible polynomial

Multiply the two polynomials normally (over GF(2): partial-product XORs), then reduce modulo a fixed **irreducible** degree-8 polynomial — the analogue of reducing integers mod a prime. Two are common:

- `0x11B` = `x^8 + x^4 + x^3 + x + 1` — the AES / Rijndael polynomial.
- `0x11D` = `x^8 + x^4 + x^3 + x^2 + 1` — used by many RS libraries (Jerasure's default, QR codes).

The leading `1` is the implicit `x^8` bit; the low byte (`0x1B` or `0x1D`) is what you XOR in during reduction. **Both parties must agree on the same polynomial** or decoding produces garbage that still *looks* like valid bytes — a vicious silent bug.

### 2.4 Worked multiplication by hand: `0x57 · 0x83` mod `0x11B`

This is the classic AES example. `0x57 = x^6+x^4+x^2+x+1`, `0x83 = x^7+x+1`.

**Step 1 — polynomial product over GF(2).** Multiply `0x57` by each set bit of `0x83` (bits 7, 1, 0), i.e. shift `0x57` left by 7, 1, 0 and XOR:

```
0x57 << 7 = x^13+x^11+x^9+x^8+x^7
0x57 << 1 = x^7 +x^5 +x^3+x^2+x
0x57 << 0 = x^6 +x^4 +x^2+x +1
```

XOR them (cancel duplicate terms: the two `x^7` cancel, the two `x^2` cancel, the two `x` cancel):

```
x^13 + x^11 + x^9 + x^8 + x^6 + x^5 + x^4 + x^3 + 1
```

**Step 2 — reduce mod `0x11B` (`x^8+x^4+x^3+x+1`).** Repeatedly XOR a shifted copy of the modulus to kill the highest term ≥ x^8.

- Kill `x^13`: XOR `x^5·M = x^13+x^9+x^8+x^6+x^5`. Result:
  `x^11 + x^4 + x^3 + 1`
  (Let me redo carefully — track every term.)

Doing the reduction term-by-term from the degree-13 product is error-prone by hand, so here is the disciplined version. Product `P = x^13+x^11+x^9+x^8+x^6+x^5+x^4+x^3+1`.

```
P                                  x^13 x^11 x^9 x^8     x^6 x^5 x^4 x^3       1
⊕ x^5·M  (x^13+x^9+x^8+x^6+x^5)    x^13      x^9 x^8     x^6 x^5
  ----------------------------------------------------------------------------
  =                                     x^11             x^4 x^3       1        (kills x^13,x^9,x^8,x^6,x^5)
⊕ x^3·M  (x^11+x^7+x^6+x^4+x^3)    x^11          x^7 x^6     x^4 x^3
  ----------------------------------------------------------------------------
  =                                          x^7 x^6                   1
```

Now everything is below `x^8`, so reduction stops. The remainder is

```
x^7 + x^6 + 1 = 1100 0001 = 0xC1
```

So `0x57 · 0x83 = 0xC1` in GF(2^8) with polynomial `0x11B`. (This matches FIPS-197's AES worked example — a great sanity check that your `gf_mul` is correct.)

### 2.5 The fast way: log/antilog (exp) tables

Doing shift-and-reduce per multiply is slow. The classic speedup uses the fact that the **multiplicative group** of GF(2^8) is cyclic of order 255, generated by a primitive element `g` (a *generator*). For the `0x11D` polynomial, `g = 0x02` is primitive; for `0x11B`, `0x02` is **not** primitive but `0x03` is. Pick a `g` that *is* primitive for your polynomial.

Build two tables once:

- `exp[i] = g^i` for `i = 0 … 254` (and replicate to 510 to avoid a mod on the index).
- `log[v]` = the `i` such that `g^i = v`, for every nonzero `v`.

Then multiplication becomes addition of logs:

```
a · b = exp[ (log[a] + log[b]) mod 255 ]      (and a·b = 0 if a==0 or b==0)
a⁻¹   = exp[ 255 − log[a] ]
a / b = exp[ (log[a] − log[b] + 255) mod 255 ]
```

This turns each multiply into two lookups + an add — orders of magnitude faster than shift/reduce, and the entire codec's hot loop becomes table lookups. (Production libraries go further with SIMD "split-table" / `pshufb` multiply, but log/antilog is the correct, simple baseline and is what we implement in §9.)

Building `exp` is just repeated multiply by `g` using the slow `gf_mul`:

```
x = 1
for i in 0..254:
    exp[i] = x
    log[x] = i
    x = gf_mul_slow(x, g)        # one shift-and-reduce step
```

---

## 3. Vandermonde vs Cauchy generator matrices

The generator matrix `G` (size `n×k`) maps the `k` data symbols to `n` coded symbols: `coded = G · data`. For an MDS code we need a property far stronger than "G has rank k":

> **Every `k×k` submatrix of `G` must be invertible.**

Why? Decoding takes whichever `k` chunks survived, which means whichever `k` rows of `G` survived. We must invert exactly that submatrix. If *any* `k`-subset of rows forms a singular matrix, then losing the complementary chunks is **unrecoverable** even though only `m` chunks were lost — breaking the MDS promise.

### 3.1 Vandermonde matrices and their trap

A Vandermonde matrix uses distinct field elements `x_1, …, x_n`:

```
V[i][j] = x_i^(j-1)      (row i is 1, x_i, x_i^2, …, x_i^(k-1))
```

Over a field, *square* Vandermonde matrices with distinct `x_i` are invertible (determinant = product of `(x_a − x_b)` ≠ 0). So full-square Vandermonde is fine. **The trap:** practical RS uses a *systematic* form, obtained by transforming `V` so the top `k×k` block is the identity (multiply by `V_top⁻¹`). After that transformation, the resulting matrix's *other* `k×k` submatrices are **no longer guaranteed invertible** over a small field like GF(2^8). For specific `(n, k)` and specific erasure patterns, you get a **singular submatrix** and decoding fails — a defect that hid in early RS libraries until certain failure combinations triggered it.

You *can* fix it by hand-searching for "good" Vandermonde matrices (and many libraries ship vetted ones), but you're then trusting a numerical search rather than a theorem.

### 3.2 Cauchy matrices: invertibility by construction

A **Cauchy matrix** sidesteps the trap with a guarantee. Pick two disjoint sets of distinct field elements `X = {x_1,…,x_n}` and `Y = {y_1,…,y_k}` (disjoint so no denominator is zero). Define

```
C[i][j] = 1 / (x_i ⊕ y_j)      (subtraction = XOR in GF(2^m))
```

**Theorem.** *Every* square submatrix of a Cauchy matrix is invertible (its determinant is a nonzero product/ratio of distinct-element differences). Therefore *every* `k×k` submatrix is invertible — exactly the MDS condition, for free, for all erasure patterns, no search required.

This is why **Cauchy Reed–Solomon (CRS)** — popularized by Blaum–Roth and implemented in **Jerasure** — is the preferred construction for general `(n, k)`. Two further wins:

- A Cauchy matrix over GF(2^w) can be "binarized": each GF(2^w) element becomes a `w×w` binary matrix, so the whole multiply turns into **XORs only** (no table lookups), and Jerasure optimizes the bit-matrix to minimize XOR count. That is the real performance reason CRS dominated for years.
- Constructing it is trivial and total: any disjoint `X`, `Y` works.

### 3.3 Constructing a Cauchy matrix (GF(2^8))

With `n + k ≤ 256` you can always pick disjoint sets. The simplest scheme:

```
let X = {0, 1, 2, …, n-1}          (the n "row" elements)
let Y = {n, n+1, …, n+k-1}         (the k "column" elements, disjoint from X)
C[i][j] = gf_inv( i ⊕ (n + j) )    # 1 / (x_i XOR y_j)
```

We use a systematic variant in code (§9): identity on top for the data, a Cauchy block for the parities, so data passes through uncoded and only parities cost arithmetic.

---

## 4. Systematic encoding & decoding

### 4.1 Systematic generator matrix

A code is **systematic** when the data symbols appear verbatim in the output — you don't pay to "decode" when nothing is lost (the common case). The generator is

```
G = [ I_k ]      ← k×k identity: rows 0..k-1 reproduce the data
    [  P  ]      ← m×k parity (Cauchy) block: rows k..n-1 are the parities

coded = G · data        (an n-vector of field symbols, per byte-position)
```

Rows `0…k-1` of `coded` are literally `data`; rows `k…n-1` are parity = `P · data`.

### 4.2 Encoding

For each byte position independently (each "stripe column"), compute the `m` parity bytes as

```
parity[r] = Σ_j  P[r][j] · data[j]      (Σ is XOR, · is gf_mul)   for r in 0..m-1
```

In practice you process whole chunks: parity chunk `r` = XOR over `j` of `gf_mul_chunk(P[r][j], data_chunk[j])`. Vectorized, this is the encoder's entire hot path.

### 4.3 Decoding after erasures: invert and recover

Suppose some chunks are lost (erased — we *know which*, unlike random errors). Erasure decoding:

1. Identify the set `S` of surviving chunk indices. We need `|S| ≥ k`; pick any `k` of them.
2. Form `G_S`, the `k×k` submatrix of `G` from those `k` surviving rows.
3. Invert `G_S` over GF(2^8) via [Gaussian elimination](../../19-number-theory/19-gaussian-elimination/senior.md) with field arithmetic.
4. Recover the original data: `data = G_S⁻¹ · coded_S`, where `coded_S` are the surviving symbols for those rows.
5. Re-encode any still-missing parity chunks from the recovered data if you need to fully heal the stripe.

Because we chose Cauchy, `G_S` is *always* invertible for any choice of `k` survivors — that is the whole point.

### 4.4 Full worked decode (RS(5,3) sketch)

Take `k = 3`, `m = 2`, so `n = 5`: chunks `D0, D1, D2, P0, P1`. The generator is

```
        D0 D1 D2
G =  [   1  0  0 ]   row 0  (= D0)
     [   0  1  0 ]   row 1  (= D1)
     [   0  0  1 ]   row 2  (= D2)
     [  a  b  c  ]   row 3  (= P0, Cauchy coeffs)
     [  d  e  f  ]   row 4  (= P1)
```

Encode once: `P0 = a·D0 ⊕ b·D1 ⊕ c·D2`, `P1 = d·D0 ⊕ e·D1 ⊕ f·D2`.

Now lose `D0` and `D1` (two erasures, within budget `m = 2`). Survivors are `D2, P0, P1` → surviving rows `{2, 3, 4}`:

```
G_S = [ 0  0  1 ]    (D2 row)
      [ a  b  c ]    (P0 row)
      [ d  e  f ]    (P1 row)

known vector  v = [ D2, P0, P1 ]ᵀ
unknown       data = [ D0, D1, D2 ]ᵀ = G_S⁻¹ · v
```

Invert `G_S` over GF(2^8) (Gaussian elimination, all ops via `gf_mul`/`gf_inv`), multiply by `v`, and you recover `D0, D1` exactly (and `D2` falls out unchanged). The codec in §9 does precisely this and asserts byte-equality. The same machinery handles losing parities, or one-data-one-parity — only the surviving-row set changes.

---

## 5. The repair-bandwidth problem

Here is the fact that broke classic RS at scale.

> To rebuild **one** lost chunk, RS(`n`, `k`) must read **`k` full chunks** from `k` other nodes, transfer all of them, and recompute. Repairing a 256 MB chunk in RS(10,6) means reading and shipping **6 × 256 MB = 1.5 GB** across the network — `k×` the size of the data you're trying to restore.

Why is it `k`, not 1? RS is MDS and *non-local*: every coded symbol is a function of *all* `k` data symbols. There is no shortcut that recovers one symbol from a small neighborhood — you must reconstruct enough of the polynomial, which needs `k` evaluations.

Why this dominates cost in real clusters:

- **Failures are constant.** In a cluster with tens of thousands of disks, single-disk failures happen continuously (often >90% of repair events are *single* failures). The repair traffic is not a rare disaster — it's a steady background load.
- **Repair I/O competes with serving traffic.** That `k×` read amplification eats disk IOPS and rack/network bandwidth that you'd rather spend on user requests. Operators found repair could consume a large fraction of cross-rack bandwidth.
- **Degraded reads.** If a client wants a chunk that's currently missing, it must do an on-the-fly `k`-chunk reconstruct — a slow ("degraded") read — until background repair finishes.

The 2010s storage-codes literature is largely a response to this one number. Two families attack it:

- **LRC** — keep MDS-ish fault tolerance but add *locality* so the *common* single-failure repair touches few chunks.
- **Regenerating codes** — accept reading from *many* helpers but only a *fraction* of each, minimizing total bytes transferred to the theoretical optimum.

---

## 6. Local Reconstruction Codes (LRC)

**Source:** Cheng Huang et al., *"Erasure Coding in Windows Azure Storage,"* USENIX ATC / FAST 2012. Deployed in Azure Storage; the Facebook/HDFS analogue is **Xorbas** (Sathiamoorthy et al.).

### 6.1 The idea: trade a little storage for cheap single-failure repair

Pure RS optimizes storage overhead but pays `k×` repair. Replication optimizes repair (read 1 copy) but pays `3×` storage. LRC sits in between: add **local parities** over subgroups of data chunks so that the *overwhelmingly common* single-chunk failure is repaired by reading just a few **local** chunks — not all `k`.

### 6.2 The (k, l, r) construction

Azure's LRC has three parameters:

- `k` data chunks,
- split into `l` **local groups** of `k/l` chunks each; each group gets **one local parity** (a XOR/RS parity over just that group),
- plus `r` **global parities** computed over *all* `k` data chunks (the RS-style parities that give strong fault tolerance).

Total chunks: `n = k + l + r`. Azure's flagship is **LRC(12, 2, 2)**: 12 data, 2 local parities (groups of 6), 2 global parities → 16 chunks, `1.33×` overhead.

```
group A: D0 D1 D2 D3 D4 D5  ──► L0 = local parity of A
group B: D6 D7 D8 D9 D10 D11 ─► L1 = local parity of B
all data:  D0…D11           ──► G0, G1 = global (RS) parities

stored: D0…D11, L0, L1, G0, G1   (16 chunks)
```

### 6.3 The repair win

- **Single data-chunk failure (the 90%+ case):** to rebuild `D3` (in group A), read only the *other 5 chunks of group A plus its local parity* — **6 chunks**, not 12. The local parity is a XOR over the group, so the lost chunk is the XOR of the 5 survivors and `L0`. Repair I/O is roughly `k/l` (here 6), about **half** of plain RS(16,12)'s 12-chunk read, and far less network/rack pressure.
- **Single local-parity failure:** recompute from its group — cheap.
- **Multiple / global failures:** fall back to the global parities and decode RS-style. LRC(12,2,2) tolerates *any* 3 simultaneous failures and *most* 4-failure patterns — close to (not exactly) the fault tolerance of MDS RS(16,12), at the same overhead, but with half the single-failure repair cost.

### 6.4 The tradeoff, stated plainly

LRC is **not MDS** — it gives up a sliver of worst-case fault tolerance (some specific 4-erasure patterns are unrecoverable) in exchange for cutting the cost of the failures that actually happen all day. Azure's paper frames this as the right economic trade: you don't optimize for the once-a-decade quadruple failure; you optimize the cost of the relentless single-failure repairs. The **(k, l, r)** knobs let you slide along the storage-vs-repair curve: more local groups (`l↑`) → cheaper local repair but more parity storage; more global parities (`r↑`) → stronger fault tolerance at higher overhead.

Facebook's **Xorbas / HDFS-RAID LRC** applied the same idea to RS(10,4) in HDFS, adding local parities so single-block repair read ~5 blocks instead of 10 — reported roughly halving repair network and disk I/O in production.

---

## 7. Regenerating codes

**Source:** Alexandros G. Dimakis, P. Brian Godfrey, Yunnan Wu, Martin Wainwright, Kannan Ramchandran, *"Network Coding for Distributed Storage Systems"* (2007/2010). This is the information-theoretic framing of repair cost.

### 7.1 A different question

LRC asks "how few *chunks* can I read?" Regenerating codes ask "how few *bytes* must cross the network?" — and they allow reading from *many* helpers but only a **partial** amount from each. The key insight (from network coding): a helper can send a *computed function* of its stored data, not the raw chunk, so the total transferred can be far below `k` chunks even while contacting more than `k` nodes.

### 7.2 The storage–repair tradeoff curve

Dimakis et al. proved a fundamental tradeoff between:

- **α** — storage per node (how many bytes each node keeps), and
- **γ = d · β** — **repair bandwidth**: when a node dies, a new node contacts `d` helpers (`d ≥ k`) and downloads `β` bytes from each, for total `γ`.

You cannot minimize both at once. The optimal `(α, γ)` pairs trace a curve. Two endpoints are famous:

- **MSR — Minimum Storage Regenerating.** Keep storage as low as MDS RS (`α = M/k`, the optimal point), and *then* minimize repair bandwidth. MSR repair downloads roughly `M/k · d/(d−k+1)` total — for large `d` this approaches `M/k` (≈ the size of *one* chunk!) instead of `M` (`k` chunks). MSR is the "same storage as RS, dramatically less repair traffic" point. (Practical near-MSR codes: **Clay codes**, **Hashtag**, **Butterfly**.)
- **MBR — Minimum Bandwidth Regenerating.** Minimize repair bandwidth *first* (down to exactly the size of one chunk), accepting somewhat *more* storage per node than MDS. MBR is the "cheapest possible repair, slightly more storage" point.

Everything between MSR and MBR is an achievable interior tradeoff.

### 7.3 The mechanism: partial reads from many helpers

The intuition: instead of one node sending you a whole chunk (RS), `d` nodes each send you a *small linear combination* of their stored sub-symbols. The combinations are designed so that, together, they span exactly the lost node's content — no more bytes downloaded than information-theoretically required. This is why a node stores *sub-packetized* data (each chunk split into many sub-symbols) so partial functions are meaningful.

The cost is complexity: MSR codes need high **sub-packetization** (chunks split into many pieces), more sophisticated repair logic, and more helper nodes contacted. That engineering complexity is why LRC (simpler, "just add local parities") shipped first in big clouds, while MSR-family codes (Clay) appeared later in systems like Ceph.

---

## 8. Comparison table

For a representative "tolerate 3–4 failures" configuration, contrasting the four strategies. Let `M` = object size.

| Property | 3× Replication | RS(9,6) (MDS) | LRC(12,2,2) | MSR (near-min-storage) |
|---|---|---|---|---|
| Storage overhead | 3.00× | 1.50× | 1.33× | ~1.5× (≈ RS) |
| Fault tolerance | any 2 | any 3 | any 3 (+most 4) | any `m` (MDS) |
| Repair I/O, single chunk | 1 chunk (copy) | **6 chunks (`k×`)** | ~6 chunks (local group) | partial reads from `d` nodes |
| Repair **bytes on network**, single | `M/k` | `M` (≈ `k×` data) | ~`M·(local/k)` ≈ half RS | **≈ `M/k`** (near one chunk) |
| Degraded-read latency | low (read a replica) | high (reconstruct `k`) | medium (local group) | medium–high (gather helpers) |
| Helpers contacted on repair | 1 | `k` | `k/l` (≈ few) | `d` (`d ≥ k`, often many) |
| Implementation complexity | trivial | moderate | moderate | high (sub-packetization) |
| Where deployed | everywhere (hot data) | HDFS-EC, Ceph, cold tiers | **Azure Storage**, Xorbas/HDFS | Ceph Clay, research/newer |

Reading the table: **replication** wins on simplicity and repair but is brutal on storage; **plain RS** wins on storage but its `k×` repair is the headline problem; **LRC** keeps RS-like storage and roughly halves single-failure repair by sacrificing a sliver of worst-case fault tolerance; **MSR** keeps RS-like storage *and* slashes repair bytes to near-optimal, at the price of real implementation complexity. There is no universally best code — you pick a point on the storage/fault-tolerance/repair triangle to match your workload's failure profile and bandwidth budget.

---

## 9. Code: byte-exact RS in Python and Go + an LRC sketch

Both implementations build GF(2^8) log/antilog tables, use a **systematic Cauchy** generator (identity on top, Cauchy parity block), encode, erase up to `n − k` chunks, decode via GF Gaussian elimination, and assert byte-exact recovery. Polynomial: `0x11D`, generator `0x02` (primitive for `0x11D`).

### 9.1 Python

```python
"""Byte-exact Reed-Solomon erasure code over GF(2^8).
Field poly 0x11D, generator 0x02. Systematic Cauchy generator matrix.
Encode -> erase up to (n-k) chunks -> decode via GF Gaussian elimination.
"""

PRIM = 0x11D      # x^8 + x^4 + x^3 + x^2 + 1  (irreducible)
GEN  = 0x02       # primitive element for 0x11D

# ---- build log / antilog (exp) tables ----
GF_EXP = [0] * 512
GF_LOG = [0] * 256

def _build_tables():
    x = 1
    for i in range(255):
        GF_EXP[i] = x
        GF_LOG[x] = i
        # multiply x by GEN (=0x02): shift left, reduce if bit 8 set
        x <<= 1
        if x & 0x100:
            x ^= PRIM
    for i in range(255, 512):       # duplicate to avoid mod on index
        GF_EXP[i] = GF_EXP[i - 255]

_build_tables()

def gf_mul(a, b):
    if a == 0 or b == 0:
        return 0
    return GF_EXP[GF_LOG[a] + GF_LOG[b]]

def gf_div(a, b):
    if b == 0:
        raise ZeroDivisionError("GF division by zero")
    if a == 0:
        return 0
    return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255]

def gf_inv(a):
    return GF_EXP[(255 - GF_LOG[a]) % 255]

# ---- systematic Cauchy generator matrix (n x k) ----
def make_generator(n, k):
    """Top k rows = identity. Bottom (n-k) rows = Cauchy block,
    every k-subset of which (together with identity rows) is invertible."""
    assert n + k <= 256, "need disjoint X,Y sets in GF(2^8)"
    G = [[0] * k for _ in range(n)]
    for i in range(k):                       # identity block (data passes through)
        G[i][i] = 1
    # Cauchy block: X = {0..m-1} mapped to row index, Y = {m..m+k-1}
    m = n - k
    X = list(range(m))                       # disjoint from Y below
    Y = list(range(m, m + k))
    for r in range(m):
        for j in range(k):
            G[k + r][j] = gf_inv(X[r] ^ Y[j])   # 1 / (x_r XOR y_j)
    return G

def encode(data, n, k):
    """data: list of k byte-arrays (chunks), all same length. Returns n chunks."""
    G = make_generator(n, k)
    length = len(data[0])
    coded = [bytearray(length) for _ in range(n)]
    for row in range(n):
        out = coded[row]
        for pos in range(length):
            acc = 0
            for j in range(k):
                c = G[row][j]
                if c:
                    acc ^= gf_mul(c, data[j][pos])
            out[pos] = acc
    return coded

# ---- GF Gaussian elimination: invert a k x k matrix ----
def gf_invert_matrix(mat):
    k = len(mat)
    a = [row[:] for row in mat]
    inv = [[1 if i == j else 0 for j in range(k)] for i in range(k)]
    for col in range(k):
        # find pivot
        if a[col][col] == 0:
            for r in range(col + 1, k):
                if a[r][col] != 0:
                    a[col], a[r] = a[r], a[col]
                    inv[col], inv[r] = inv[r], inv[col]
                    break
            else:
                raise ValueError("singular submatrix (should not happen for Cauchy)")
        # normalize pivot row
        p = gf_inv(a[col][col])
        a[col]   = [gf_mul(p, v) for v in a[col]]
        inv[col] = [gf_mul(p, v) for v in inv[col]]
        # eliminate other rows
        for r in range(k):
            if r != col and a[r][col] != 0:
                f = a[r][col]
                a[r]   = [a[r][c]   ^ gf_mul(f, a[col][c])   for c in range(k)]
                inv[r] = [inv[r][c] ^ gf_mul(f, inv[col][c]) for c in range(k)]
    return inv

def decode(coded, erased, n, k):
    """coded: list of n chunks; chunks at indices in `erased` are unusable.
    Returns the recovered k data chunks (indices 0..k-1)."""
    G = make_generator(n, k)
    survivors = [i for i in range(n) if i not in erased]
    if len(survivors) < k:
        raise ValueError("too many erasures: cannot decode")
    use = survivors[:k]                       # pick any k survivors
    G_S = [G[i][:] for i in use]              # k x k surviving submatrix
    Ginv = gf_invert_matrix(G_S)              # invert over GF(2^8)

    length = len(coded[use[0]])
    data = [bytearray(length) for _ in range(k)]
    for pos in range(length):
        v = [coded[i][pos] for i in use]      # surviving symbols at this position
        for row in range(k):                  # data = Ginv * v
            acc = 0
            for j in range(k):
                c = Ginv[row][j]
                if c:
                    acc ^= gf_mul(c, v[j])
            data[row][pos] = acc
    return data

# ---------------- demonstration / self-test ----------------
if __name__ == "__main__":
    import os, itertools

    # AES worked example sanity check: 0x57 * 0x83 should be 0xC1 *only* under 0x11B.
    # Under 0x11D our gf_mul differs; verify the field laws instead:
    for _ in range(10000):
        a, b, c = os.urandom(3)
        assert gf_mul(a, b) == gf_mul(b, a)                       # commutative
        assert gf_mul(a, gf_mul(b, c)) == gf_mul(gf_mul(a, b), c) # associative
        if a:
            assert gf_mul(a, gf_inv(a)) == 1                      # inverses
    print("GF(2^8) field laws hold.")

    n, k = 9, 6                # RS(9,6): tolerate any 3 erasures
    chunk_len = 1024
    data = [bytearray(os.urandom(chunk_len)) for _ in range(k)]
    coded = encode(data, n, k)

    # data chunks must pass through unchanged (systematic property)
    for i in range(k):
        assert bytes(coded[i]) == bytes(data[i]), "systematic property broken"

    # Try EVERY erasure pattern of size m = n-k and confirm exact recovery.
    m = n - k
    tested = 0
    for erased in itertools.combinations(range(n), m):
        recovered = decode(coded, set(erased), n, k)
        for i in range(k):
            assert bytes(recovered[i]) == bytes(data[i]), f"mismatch, erased={erased}"
        tested += 1
    print(f"RS({n},{k}): all {tested} erasure patterns of size {m} recovered byte-exactly.")
```

Run it: every nonzero field element has an inverse (field laws pass), the data chunks pass through unchanged (systematic), and **all** `C(9,3)=84` triple-erasure patterns recover byte-for-byte — the Cauchy guarantee in action (no singular submatrix ever occurs).

### 9.2 Go

```go
// Byte-exact Reed-Solomon erasure code over GF(2^8).
// Field poly 0x11D, generator 0x02. Systematic Cauchy generator matrix.
package main

import (
	"bytes"
	"crypto/rand"
	"fmt"
)

const (
	prim = 0x11D
	gen  = 0x02
)

var (
	gfExp [512]byte
	gfLog [256]byte
)

func init() {
	x := 1
	for i := 0; i < 255; i++ {
		gfExp[i] = byte(x)
		gfLog[x] = byte(i)
		x <<= 1
		if x&0x100 != 0 {
			x ^= prim
		}
	}
	for i := 255; i < 512; i++ {
		gfExp[i] = gfExp[i-255]
	}
}

func gfMul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	return gfExp[int(gfLog[a])+int(gfLog[b])]
}

func gfInv(a byte) byte {
	return gfExp[(255-int(gfLog[a]))%255]
}

// makeGenerator returns the n x k systematic Cauchy generator matrix.
func makeGenerator(n, k int) [][]byte {
	if n+k > 256 {
		panic("need disjoint X,Y in GF(2^8)")
	}
	G := make([][]byte, n)
	for i := range G {
		G[i] = make([]byte, k)
	}
	for i := 0; i < k; i++ {
		G[i][i] = 1 // identity block
	}
	m := n - k
	for r := 0; r < m; r++ {
		xr := byte(r)             // X = {0..m-1}
		for j := 0; j < k; j++ {
			yj := byte(m + j)     // Y = {m..m+k-1}, disjoint from X
			G[k+r][j] = gfInv(xr ^ yj)
		}
	}
	return G
}

func encode(data [][]byte, n, k int) [][]byte {
	G := makeGenerator(n, k)
	length := len(data[0])
	coded := make([][]byte, n)
	for r := 0; r < n; r++ {
		coded[r] = make([]byte, length)
		for pos := 0; pos < length; pos++ {
			var acc byte
			for j := 0; j < k; j++ {
				if c := G[r][j]; c != 0 {
					acc ^= gfMul(c, data[j][pos])
				}
			}
			coded[r][pos] = acc
		}
	}
	return coded
}

// gfInvertMatrix inverts a k x k matrix over GF(2^8) via Gaussian elimination.
func gfInvertMatrix(mat [][]byte) [][]byte {
	k := len(mat)
	a := make([][]byte, k)
	inv := make([][]byte, k)
	for i := range mat {
		a[i] = append([]byte(nil), mat[i]...)
		inv[i] = make([]byte, k)
		inv[i][i] = 1
	}
	for col := 0; col < k; col++ {
		if a[col][col] == 0 {
			swapped := false
			for r := col + 1; r < k; r++ {
				if a[r][col] != 0 {
					a[col], a[r] = a[r], a[col]
					inv[col], inv[r] = inv[r], inv[col]
					swapped = true
					break
				}
			}
			if !swapped {
				panic("singular submatrix (impossible for Cauchy)")
			}
		}
		p := gfInv(a[col][col])
		for c := 0; c < k; c++ {
			a[col][c] = gfMul(p, a[col][c])
			inv[col][c] = gfMul(p, inv[col][c])
		}
		for r := 0; r < k; r++ {
			if r != col && a[r][col] != 0 {
				f := a[r][col]
				for c := 0; c < k; c++ {
					a[r][c] ^= gfMul(f, a[col][c])
					inv[r][c] ^= gfMul(f, inv[col][c])
				}
			}
		}
	}
	return inv
}

// decode recovers the k data chunks given coded chunks with some erased.
func decode(coded [][]byte, erased map[int]bool, n, k int) [][]byte {
	G := makeGenerator(n, k)
	use := make([]int, 0, k)
	for i := 0; i < n && len(use) < k; i++ {
		if !erased[i] {
			use = append(use, i)
		}
	}
	if len(use) < k {
		panic("too many erasures")
	}
	GS := make([][]byte, k)
	for i, idx := range use {
		GS[i] = append([]byte(nil), G[idx]...)
	}
	gInv := gfInvertMatrix(GS)

	length := len(coded[use[0]])
	data := make([][]byte, k)
	for r := range data {
		data[r] = make([]byte, length)
	}
	for pos := 0; pos < length; pos++ {
		for r := 0; r < k; r++ {
			var acc byte
			for j := 0; j < k; j++ {
				if c := gInv[r][j]; c != 0 {
					acc ^= gfMul(c, coded[use[j]][pos])
				}
			}
			data[r][pos] = acc
		}
	}
	return data
}

func combinations(n, m int) [][]int {
	var res [][]int
	idx := make([]int, m)
	var rec func(start, depth int)
	rec = func(start, depth int) {
		if depth == m {
			res = append(res, append([]int(nil), idx...))
			return
		}
		for i := start; i < n; i++ {
			idx[depth] = i
			rec(i+1, depth+1)
		}
	}
	rec(0, 0)
	return res
}

func main() {
	// field laws
	check := []byte{1, 2, 3, 200, 255, 127}
	for _, a := range check {
		if a != 0 && gfMul(a, gfInv(a)) != 1 {
			panic("inverse law broken")
		}
	}

	n, k := 9, 6
	chunkLen := 1024
	data := make([][]byte, k)
	for i := range data {
		data[i] = make([]byte, chunkLen)
		rand.Read(data[i])
	}
	coded := encode(data, n, k)

	for i := 0; i < k; i++ { // systematic property
		if !bytes.Equal(coded[i], data[i]) {
			panic("systematic property broken")
		}
	}

	m := n - k
	tested := 0
	for _, erased := range combinations(n, m) {
		set := map[int]bool{}
		for _, e := range erased {
			set[e] = true
		}
		rec := decode(coded, set, n, k)
		for i := 0; i < k; i++ {
			if !bytes.Equal(rec[i], data[i]) {
				panic(fmt.Sprintf("mismatch erased=%v", erased))
			}
		}
		tested++
	}
	fmt.Printf("RS(%d,%d): all %d erasure patterns of size %d recovered byte-exactly.\n",
		n, k, tested, m)
}
```

### 9.3 LRC sketch: local repair without touching all `k`

A minimal LRC(`k=6`, `l=2`, `r=2`) on top of the same field, showing the *single-failure* repair shortcut: a data chunk in a group is the XOR of its group-mates and that group's local parity — no need to read the other group or the global parities.

```python
# LRC(k=6, l=2, r=2): 6 data, 2 local parities (groups of 3), 2 global parities.
# Demonstrates: single data-chunk repair reads only its local group (4 chunks), not 6.
import os

def xor_chunks(chunks):
    out = bytearray(len(chunks[0]))
    for c in chunks:
        for i in range(len(out)):
            out[i] ^= c[i]
    return out

L = 1024
data = [bytearray(os.urandom(L)) for _ in range(6)]
groupA = [0, 1, 2]          # local group A
groupB = [3, 4, 5]          # local group B

localA = xor_chunks([data[i] for i in groupA])   # L0 = XOR of group A
localB = xor_chunks([data[i] for i in groupB])   # L1 = XOR of group B
# (global parities G0,G1 would be RS parities over all 6 — omitted; used only
#  for multi-failure / global decoding, exactly like the RS codec above.)

# --- single-failure local repair: D1 is lost (it lives in group A) ---
# D1 = XOR(localA, D0, D2)  -- reads only 3 chunks from group A, NOT all 6 data.
lost = 1
helpers = [i for i in groupA if i != lost]       # {0, 2}
recovered = xor_chunks([localA] + [data[i] for i in helpers])
assert bytes(recovered) == bytes(data[lost])
print(f"LRC: recovered D{lost} from local group only "
      f"({len(helpers)+1} chunks read, vs 6 for plain RS).")
```

The point: the relentless single-chunk failure is healed by reading the *local group* (here 3 chunks) instead of `k = 6`. Multi-chunk or global-parity failures fall back to the full RS decode of §9.1/§9.2. That asymmetry — cheap common case, full-power rare case — is the entire LRC value proposition.

---

## 10. Pitfalls

1. **Singular submatrix from naive Vandermonde.** A systematic Vandermonde code over GF(2^8) can produce non-invertible `k×k` submatrices for specific `(n,k)` and erasure patterns — decoding silently fails for *some* failures while passing your happy-path tests. **Fix:** use a Cauchy matrix (every square submatrix invertible by theorem) or a vetted Vandermonde, and *test every erasure pattern* (as the demos do).

2. **Mismatched irreducible polynomial.** Encoding with `0x11D` and decoding with `0x11B` produces byte output that is *valid-looking garbage* — no exception, just wrong data. The polynomial (and the generator) are part of the on-disk format and must be pinned and versioned. AES's `0x57·0x83 = 0xC1` only holds under `0x11B`; use known test vectors to assert you're in the field you think you are.

3. **Generator not primitive for the chosen polynomial.** `g = 0x02` is primitive for `0x11D` but **not** for `0x11B` (you'd need `0x03`). A non-primitive generator makes the log/antilog tables fail to cover all 255 nonzero elements — some `gf_mul` results are wrong. Verify `log[]` is a permutation of `0..254`.

4. **Endianness / bit-order of the polynomial-to-byte mapping.** Treating the high bit as the constant term (instead of `x^7`) flips every multiply. Fix a convention (`bit i ↔ x^i`) and keep it consistent across languages and the wire format — a frequent cross-implementation interop bug.

5. **Forgetting GF subtraction = XOR.** In Cauchy construction `x_i − y_j` is `x_i ⊕ y_j`; using integer subtraction gives wrong coefficients (and can hit a zero denominator). Likewise `a − a = 0` and `−a = a`.

6. **`gf_mul(0, ·)` and the log table.** `log[0]` is undefined; multiply must short-circuit on a zero operand before any table lookup. The most common GF bug is forgetting that guard.

7. **Repair amplification ignored in capacity planning.** Sizing a cluster on *steady-state* read/write bandwidth but forgetting that plain RS repair reads `k×` the lost data can saturate cross-rack links during failure storms. This is precisely why you reach for LRC/MSR — model repair traffic, not just user traffic.

---

## 11. Cheat sheet

```
FIELD GF(2^8)
  add / sub        : a ^ b              (XOR; sub == add; -a == a)
  mul (slow)       : poly mult, reduce mod irreducible (0x11D or 0x11B)
  mul (fast)       : exp[(log[a]+log[b]) mod 255], 0 if either is 0
  inv              : exp[(255 - log[a]) mod 255]
  div              : exp[(log[a]-log[b]+255) mod 255]
  build tables     : x=1; x = (x<<1) ^ (PRIM if x&0x100 else 0), repeat 255×
  irreducible poly : 0x11D (g=0x02)  |  0x11B (AES, g=0x03)  -- PIN IT

GENERATOR MATRIX (n×k)
  systematic       : top k rows = I_k (data passes through), bottom = parity
  Cauchy           : C[i][j] = 1 / (x_i ^ y_j), X,Y disjoint distinct sets
  Cauchy guarantee : EVERY square submatrix invertible -> MDS for free
  Vandermonde      : V[i][j]=x_i^j; systematic form may have SINGULAR submatrix

ENCODE  : parity[r] = XOR_j  gf_mul(P[r][j], data[j])
DECODE  : survivors S; G_S = k surviving rows; data = inv(G_S) · coded_S
          inv via Gaussian elimination over GF(2^8)

REPAIR COST (single lost chunk)
  3× replication   : read 1 chunk           overhead 3.0×, tolerate 2
  RS(n,k) MDS      : read k chunks  (k× !)   overhead n/k,  tolerate n-k
  LRC(k,l,r)       : read ~k/l chunks (local) overhead (k+l+r)/k
  MSR regenerating : ~M/k BYTES total (partial reads from d helpers)

PICK THE CODE
  hot / latency-critical            -> replication
  cold, storage-bound, simple       -> RS
  steady single-failure repair load -> LRC (Azure, Xorbas)
  minimize repair bytes, keep RS storage -> MSR (Clay)
```

---

## 12. Summary

- **GF(2^8)** makes bytes a field: add = XOR, multiply = polynomial multiply mod an irreducible degree-8 polynomial (`0x11D` or AES's `0x11B`). Production codecs do multiply via **log/antilog tables** over a primitive generator, turning each multiply into two lookups and an add. We verified by hand that `0x57·0x83 = 0xC1` under `0x11B`.
- The generator matrix must have **every `k×k` submatrix invertible**, or some erasure patterns are unrecoverable despite being within the fault budget. **Cauchy matrices guarantee this by theorem** (`C[i][j] = 1/(x_i ⊕ y_j)`), which is why **Cauchy-Reed-Solomon** (Jerasure, Blaum–Roth) is preferred over naive Vandermonde, whose systematic form can hide **singular submatrices**.
- **Systematic encoding** (`G = [I; P]`) passes data through unchanged; **decoding** assembles the `k` surviving rows, inverts that submatrix over GF(2^8) by **Gaussian elimination**, and recovers the data exactly. Our Python and Go codecs prove byte-exact recovery for *every* erasure pattern within budget.
- The dominant operational cost of classic RS is **repair bandwidth**: rebuilding one lost chunk reads **`k` full chunks** — `k×` the lost data — and that single-failure repair runs constantly at cluster scale.
- **LRC** (Azure, FAST 2012; Facebook Xorbas) adds **local parities** over subgroups via the **(k, l, r)** construction so a single failure heals from `~k/l` local chunks, roughly halving repair I/O for a sliver of worst-case fault tolerance.
- **Regenerating codes** (Dimakis et al.) chart the optimal **storage–repair-bandwidth tradeoff curve**, with **MSR** (RS-like storage, near-minimal repair bytes) and **MBR** (minimal repair bytes, slightly more storage) endpoints, achieved by downloading *partial* data from *many* helpers.
- There is no single best code: pick a point on the storage / fault-tolerance / repair triangle to fit your failure profile and bandwidth budget. See [professional](professional.md) for production deployment (HDFS-EC, Ceph, ISA-L/Jerasure tuning, rack-aware placement), or revisit [junior](junior.md) and [middle](middle.md) for the foundations.

---

## 13. Further reading

- **I. S. Reed & G. Solomon (1960)** — *"Polynomial Codes over Certain Finite Fields,"* J. SIAM. The original code.
- **J. S. Plank** — *"A Tutorial on Reed–Solomon Coding for Fault-Tolerance in RAID-like Systems"* (and the **Jerasure** library) — the canonical engineering tutorial on GF(2^w) RS, Vandermonde/Cauchy, and bit-matrix optimization.
- **M. Blaum & R. M. Roth** — work on **Cauchy/array codes** underpinning Cauchy-Reed-Solomon.
- **C. Huang, H. Simitci, Y. Xu, A. Ogus, B. Calder, P. Gopalan, J. Li, S. Yekhanin (2012)** — *"Erasure Coding in Windows Azure Storage,"* USENIX ATC/FAST 2012 — the **LRC (k, l, r)** paper.
- **M. Sathiamoorthy et al. (2013)** — *"XORing Elephants: Novel Erasure Codes for Big Data,"* VLDB — **Xorbas** LRC for HDFS-RAID.
- **A. G. Dimakis, P. B. Godfrey, Y. Wu, M. Wainwright, K. Ramchandran (2007/2010)** — *"Network Coding for Distributed Storage Systems"* — the **regenerating codes** storage–repair tradeoff, MSR/MBR.
- **K. Rashmi et al.** — *Hitchhiker* and the **Clay code** (near-MSR, deployed in Ceph) for practical low-repair erasure coding.
- **FIPS-197 (AES)** — Appendix on GF(2^8) arithmetic with the `0x57·0x83 = 0xC1` worked example.
- Companion topics: [Modular Arithmetic](../../19-number-theory/02-modular-arithmetic/senior.md), [Gaussian Elimination](../../19-number-theory/19-gaussian-elimination/senior.md), [Polynomial Operations](../../19-number-theory/22-polynomial-operations/senior.md).
