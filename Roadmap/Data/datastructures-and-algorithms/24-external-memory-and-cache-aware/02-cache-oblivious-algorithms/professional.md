# Cache-Oblivious Algorithms — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [The CPU Cache Hierarchy Argument: One Algorithm, Every Level](#the-cpu-cache-hierarchy-argument-one-algorithm-every-level)
3. [Where Cache-Oblivious Actually Ships](#where-cache-oblivious-actually-ships)
   - [FFTW: Recursive Divide-and-Conquer Plus Autotuning](#fftw-recursive-divide-and-conquer-plus-autotuning)
   - [Recursive BLAS and Numerical Kernels](#recursive-blas-and-numerical-kernels)
   - [Cache-Oblivious B-Trees and Fractal Trees in Storage](#cache-oblivious-b-trees-and-fractal-trees-in-storage)
   - [Space-Filling-Curve and Morton Layouts](#space-filling-curve-and-morton-layouts)
4. [The Honest Trade-Off: Oblivious vs Aware](#the-honest-trade-off-oblivious-vs-aware)
5. [Engineering the Recursion](#engineering-the-recursion)
6. [Measuring: Are You Even Cache-Bound?](#measuring-are-you-even-cache-bound)
7. [Worked End-to-End: Three Matrix Kernels](#worked-end-to-end-three-matrix-kernels)
8. [Decision Framework](#decision-framework)
9. [Research Pointers](#research-pointers)
10. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

The senior tier ([`./senior.md`](./senior.md)) closes the theory: funnelsort hits the sorting bound obliviously via the `k`-funnel, the cache-oblivious B-tree makes the van Emde Boas layout dynamic over a packed-memory array, the tall-cache assumption `M = Ω(B²)` is provably necessary, and permuting provably separates cache-oblivious from cache-aware. That theory is correct and it is the right mental model. This tier answers the engineer's question: **when you have a hot kernel that misses cache, do you write a recursive cache-oblivious version or a hand-blocked cache-aware one — and how do you tell, with `perf`, which one actually won on this machine?**

The thesis is blunt and has two halves. First, the *real* value of cache-oblivious design is not asymptotic optimality — most production code never approaches the input sizes where the `log_{M/B}` factor matters — it is **portability across the whole cache hierarchy with zero tuning constants**. A modern CPU has L1, L2, L3, and a TLB, each with a *different* effective block size `B` and capacity `M`; you cannot pick one blocking factor that is right for all four, and you certainly cannot pick one that stays right when the binary ships to a different SKU. A recursive cache-oblivious algorithm is good at *all* levels at once, on every machine, with no `#define TILE 64`. Second, the honest counterweight: **on a single known machine, a cache-aware kernel hand-blocked to the measured L1/L2 size is routinely faster by a constant factor**, because it nails the exact block size and avoids recursion overhead. The professional knows both, measures, and usually ships a *hybrid* — recursive structure with a tuned base case.

This file works through the hierarchy argument, the handful of places cache-oblivious ideas genuinely ship (FFTW, recursive BLAS, fractal-tree storage, Morton layouts), the oblivious-vs-aware trade in detail, the engineering of the recursion (base-case cutoff, Z-order, SIMD, parallel false-sharing), how to measure cache-boundedness with hardware counters, and a runnable three-way matrix benchmark — naive vs cache-aware tiled vs cache-oblivious recursive — that shows the recursive one staying robust across sizes without a single tuned constant.

---

## The CPU Cache Hierarchy Argument: One Algorithm, Every Level

This is the load-bearing practical argument for the whole topic, so state it precisely. A contemporary server core sees roughly:

| Level | Capacity `M` | Line / block `B` | Latency | Notes |
| --- | --- | --- | --- | --- |
| L1d | 32–48 KiB | 64 B | ~4–5 cycles | per-core, 8-way typical |
| L2 | 256 KiB–2 MiB | 64 B | ~12–15 cycles | per-core or per-pair |
| L3 (LLC) | 8–64 MiB | 64 B | ~40–75 cycles | shared across cores |
| DRAM | (system) | 64 B burst | ~200–350 cycles | NUMA-dependent |
| **dTLB** | 64–2048 entries | **page (4 KiB / 2 MiB)** | walk = extra memory refs | a *fourth* `(M, B)` regime |

Notice two things. The line size is 64 B at L1/L2/L3 — but the *capacities* `M` differ by three orders of magnitude. And the **TLB is a cache too**, with a completely different block: its "line" is a page (4 KiB, or 2 MiB with hugepages), and its "capacity" is the number of translations it holds. A blocked algorithm that tiles for L2's 256 KiB is the *wrong* tile for L1 (too big, thrashes) and the *wrong* tile for the TLB (a 256 KiB tile spanning 64 pages can blow a 64-entry dTLB).

The cache-aware engineer's bind: **you cannot hand-tune one blocking factor for L1, L2, L3, and TLB simultaneously, because they have different `M` and different `B`.** The honest fix in high-performance code is *multi-level blocking* — nested tiles, one per level (register block inside L1 block inside L2 block inside L3 block), each with its own measured constant. That works and it is what tuned BLAS does, but it is a stack of machine-specific magic numbers that must be re-derived per microarchitecture.

The cache-oblivious answer dissolves the bind. A recursive divide-and-conquer that halves the problem until the base case **passes through every working-set size on the way down**. At *some* level of the recursion the subproblem fits in L3; deeper, a sub-subproblem fits in L2; deeper still, in L1; and the access pattern is contiguous enough that the TLB is happy too. The algorithm never names any of these sizes — the recursion *manufactures* the right tile at every scale for free. One source file, no constants, optimal (to within a constant factor) at L1, L2, L3, TLB, and the next machine's hierarchy you have not seen yet. *That portability is the core practical value*, and it is why the idea survives in libraries that must run well on hardware the author never tested.

---

## Where Cache-Oblivious Actually Ships

The literature is large; the production footprint is specific. These are the places the idea earns its keep.

### FFTW: Recursive Divide-and-Conquer Plus Autotuning

[FFTW](http://www.fftw.org/) ("Fastest Fourier Transform in the West," Frigo and Johnson — the same Frigo as the founding cache-oblivious paper) is the canonical real-world cache-oblivious success. The Cooley–Tukey FFT is already a divide-and-conquer: a size-`N = N₁N₂` transform recurses into `N₁` transforms of size `N₂` and vice versa. FFTW exploits this **recursively rather than iteratively**, so the recursion automatically blocks the transform to whatever cache level a subtransform fits in — a cache-oblivious access pattern with no tuned radix-per-level.

But FFTW is also the textbook lesson that *pure obliviousness is not the whole story in practice*. FFTW does not ship one fixed recursion; it ships a library of small hand-optimized straight-line kernels ("codelets") and a **planner** that, at runtime, empirically measures combinations on the *actual* machine and picks the fastest plan (`FFTW_MEASURE`). So FFTW = cache-oblivious recursive structure (gets the multi-level blocking for free) **+ autotuning** (nails the base-case codelet and the radix choices to the specific CPU). This pairing — oblivious for the macro-structure, tuned for the micro-structure — is the pattern you will see again and again, and it is the honest model of how the idea actually deploys.

### Recursive BLAS and Numerical Kernels

Dense linear algebra is where cache-oblivious recursion is most directly competitive with hand-blocking. **Recursive matrix multiply** and **recursive matrix transpose** (developed at the middle tier) split each dimension in half and recurse; the recursion tiles for every cache level at once. Production numerical libraries use recursive layouts and recursive blocking for exactly this reason:

- **Recursive / Morton-order matrix storage** (Gustavson and others at IBM) stores the matrix so that recursive submatrices are contiguous, making the recursive multiply's memory accesses sequential — a cache-oblivious *layout* paired with a cache-oblivious *algorithm*.
- **Tuned BLAS (OpenBLAS, BLIS, MKL)** are not purely oblivious — their innermost GEMM microkernel is hand-written assembly with register- and L1-blocking tuned per microarchitecture — but their *outer* loops are blocked recursively/hierarchically. The professional reality is a hybrid: oblivious-style recursion for the cache levels, a hand-tuned cache-aware (and SIMD-saturated) base case for peak throughput. This is the same FFTW pattern, and it is the honest answer to "does anyone ship pure cache-oblivious GEMM?" — no; they ship the recursion plus a tuned floor.
- **Recursive Cholesky / LU / QR** factorizations (the "recursive LAPACK" line of work) get multi-level blocking from the recursion for free, which is why recursive-blocked factorizations were a research and library win on deep hierarchies.

### Cache-Oblivious B-Trees and Fractal Trees in Storage

On the storage side, the cache-oblivious B-tree and its write-optimized cousins crossed from theory into a shipping product. **Tokutek's TokuDB / TokuMX** (MySQL and MongoDB storage engines, later acquired and continued in **PerconaFT**) were built on **Fractal Tree indexes** — an engineering realization of the **`B^ε`-tree** write-optimization curve. The connection to this topic is direct: the `B^ε`-tree, buffer-tree, and cache-oblivious B-tree all sit on the same buffered-update / Brodal–Fagerberg curve that trades a slightly slower search for dramatically faster (batched, sequential) inserts. The full I/O analysis of that curve lives in [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md); the point here is that the *cache-oblivious / buffered* family is not a blackboard exercise — it powered a commercial database whose pitch was "10–50× faster inserts than a B-tree" on the same disk. The packed-memory array's gapped, mostly-contiguous layout (senior tier) is the same idea that makes these structures' rebalances sequential.

### Space-Filling-Curve and Morton Layouts

A **Z-order (Morton) layout** interleaves the bits of a multidimensional index (`(x, y) → interleave(x, y)`) so that points close in space are usually close in memory. It is "cache-oblivious-flavored": like a recursive layout, it has *no tuned block size* yet keeps locality at every scale, because a Morton curve is self-similar — any prefix of the bits selects a contiguous quadrant. Morton (and Hilbert) layouts are used for matrix storage, spatial indexes, mesh and stencil codes, and GPU texture tiling, precisely because they give multi-level locality without committing to a tile size. They are a *layout* cousin of cache-oblivious *algorithms*: same parameter-free, self-similar locality principle, applied to data placement rather than control flow. The data-layout treatment — array-of-structs vs struct-of-arrays, blocking, Z-order, and when each wins — is in [`../05-cache-aware-data-layout/professional.md`](../05-cache-aware-data-layout/professional.md).

---

## The Honest Trade-Off: Oblivious vs Aware

This is the section that separates a professional treatment from a sales pitch. Both approaches target the *same* I/O bound; they differ in how they get there and what it costs you.

**Cache-aware** (explicitly blocked to a measured size): you query or hard-code the L1/L2 size, choose a tile `T` so the tile's working set fits, and loop over tiles. Because you *named the exact block size*, you get:

- **Tighter constants.** No recursion overhead — flat, predictable loops the compiler vectorizes and the hardware prefetcher loves. The tile boundary is exactly the cache boundary, so you neither under-fill nor thrash.
- **A specific level.** You optimize *the* level you blocked for. If one level dominates (say the kernel is L2-bound and L1/L3 are not on the critical path), nailing L2 is all that matters.

But you pay:

- **Per-machine, per-level tuning.** The constant is wrong on the next CPU, and wrong for the levels you did not block. True multi-level performance means *nested* tiles with several constants to maintain.
- **Fragility.** Change the SKU, the page size, the data type width, or the hyperthread sharing of L2, and your magic number is stale.

**Cache-oblivious** (recursive, parameter-free): you get the *opposite* profile.

- **Portability and multi-level optimality for free.** Good at L1, L2, L3, TLB, and the unknown future machine, with one constant-free source file.
- **No tuning.** Ship once, run well everywhere.

But you pay:

- **Recursion overhead.** Function-call cost, less predictable control flow, sometimes weaker auto-vectorization at the leaves — a real **constant-factor loss** versus the best hand-blocked code on a *fixed* machine. The famous and honest summary: cache-oblivious is **asymptotically optimal but can lose on the constant factor** to a cache-aware kernel that was allowed to know the machine.

The reconciliation is **base-case coarsening**: stop recursing at a tuned threshold (say, when the submatrix fits comfortably in L1 / a few KB) and run a flat, SIMD-friendly, possibly cache-*aware* base case there. This single change is enormous in practice — it amortizes the call overhead over a chunk of real work and recovers most of the constant-factor gap. The result is a **hybrid**: cache-oblivious recursion for the multi-level macro-blocking, a tuned cache-aware leaf for peak constants. That hybrid is what FFTW, recursive BLAS, and competitive sort implementations actually are.

The decision, stated plainly: **cache-aware when there is one known hot level on a known machine and you want maximum constant-factor speed; cache-oblivious when you need portability, the hierarchy is deep, the target is unknown, or you simply do not want to maintain per-CPU constants. In production, you usually want both at once — recursion with a coarsened base case.**

---

## Engineering the Recursion

Turning the textbook recursion into code that beats the naive loop requires a handful of moves.

**1. Base-case cutoff (the single most important knob).** Never recurse to `1×1`. Pick a threshold `T` — empirically, the largest base case that still fits in L1 with room for the working set, often a few tens to a couple hundred elements per dimension — and below `T` run a tight triple loop. The cutoff trades a *little* asymptotic blocking for a *lot* of recovered call overhead and vectorization. Tune `T` once with a sweep; it is forgiving (a broad plateau), which is itself a portability win over a brittle tile size.

```text
recmul(A, B, C, n):
    if n <= T:                       # coarsened base case
        flat_simd_kernel(A, B, C, n) # tight, vectorized, L1-resident
        return
    h = n / 2
    # 8 recursive products on the four quadrants (or Strassen's 7)
    recmul(A11,B11,C11,h); recmul(A12,B21,C11,h)   # C11 += A11·B11 + A12·B21
    ... (the remaining six quadrant products) ...
```

**2. Z-order / recursive storage so the recursion is contiguous.** A recursive algorithm over a *row-major* matrix still strides badly: the four quadrants are not contiguous, so each recursive call scatters across rows. Store the data in **Morton/Z-order (recursive bit-interleaved) layout** so that each recursive submatrix is a contiguous block. Now the recursion's memory accesses are sequential, the prefetcher engages, and the TLB stays warm. This is "iterative-deepening / Z-order storage to make the recursion cache-friendly" — pairing the oblivious *algorithm* with an oblivious *layout* (see [`../05-cache-aware-data-layout/professional.md`](../05-cache-aware-data-layout/professional.md)).

**3. Combine with SIMD/vectorization at the leaf.** The recursion handles inter-level blocking; the *base case* should be hand- or compiler-vectorized (AVX/NEON), with register blocking and an FMA-saturated inner loop. The oblivious recursion gets you to a cache-resident tile; SIMD extracts the FLOPs once you are there. The two are orthogonal and multiply.

**4. Parallel cache-obliviousness and false sharing.** A recursive fork-join (Cilk/TBB/`rayon`/OpenMP tasks) spawns the recursive calls; work-stealing (senior tier) turns the same recursion into parallelism *and* keeps locality. Two production hazards: **false sharing** — two cores writing to the same 64 B line on adjacent sub-blocks — which you avoid by ensuring base-case output blocks are line-aligned and disjoint; and **steal-induced cache pollution**, bounded but real, which argues for a coarse-enough base case that steals are rare relative to useful work. The senior tier's bound `Q(N; M, B) + O(P·(M/B)·S(N))` is the formal version: keep the span `S(N)` low and the base case fat.

---

## Measuring: Are You Even Cache-Bound?

Do not optimize cache behavior on a hunch. The whole exercise is worthless if the kernel is compute-bound, branch-bound, or already prefetch-saturated. Measure first.

**Step 0 — is it cache-bound at all?** Look at the roofline: if the kernel's arithmetic intensity (FLOPs per byte) is high and you are near peak FLOPs, more blocking buys nothing. If you are far below peak and the memory bus is busy, you are memory/cache-bound and blocking can help.

**Step 1 — read the cache-miss counters.** On Linux with `perf`:

```text
perf stat -e cycles,instructions,\
  L1-dcache-loads,L1-dcache-load-misses,\
  LLC-loads,LLC-load-misses,\
  dTLB-loads,dTLB-load-misses \
  ./bench

# Interpreting:
#   L1-dcache-load-misses / L1-dcache-loads   -> L1 miss rate
#   LLC-load-misses        / LLC-loads         -> last-level (≈ DRAM) miss rate; the expensive ones
#   dTLB-load-misses       / dTLB-loads        -> TLB pressure; high => your tile spans too many pages
```

A high **LLC-load-miss** rate means you are going to DRAM — the most expensive misses, and exactly what blocking should cut. A high **dTLB-load-miss** rate is the tell that your *aware* tile is wrong for the *TLB* level (too many pages per tile) — a problem the oblivious recursion tends not to have, because its sub-blocks shrink past the page-friendly size on the way down. Use `cachegrind` (`valgrind --tool=cachegrind`) for a deterministic, machine-independent simulated miss count when you want to compare algorithms without hardware noise; use `perf` for the real machine.

**Step 2 — compare the three variants on the same counters.** Run naive, cache-aware-tiled, and cache-oblivious-recursive through `perf stat` at several sizes. The signature you are looking for:

- **Naive** shows miss rates that *jump* once the working set exceeds each cache level — fine for small `N`, a cliff at every level boundary.
- **Cache-aware tiled** shows low misses *for the level it was tuned to*, but may still spike at other levels (e.g., great L2 numbers, poor TLB or L1 numbers if only L2 was blocked).
- **Cache-oblivious recursive** shows *uniformly* low misses across all sizes and all levels, with no cliffs — the visual proof of "good at every level without tuning." It may have slightly higher *instruction* count (recursion overhead) but lower and flatter *miss* curves.

That cross-over plot — miss rate (and wall-clock) vs `N`, three curves — is the deliverable that decides the engineering call.

---

## Worked End-to-End: Three Matrix Kernels

Here is a self-contained comparison of the three approaches on square matrix multiply. The point is not the absolute numbers (they depend on your CPU) but the *shape*: the cache-oblivious version stays robust across sizes with **no tuned tile**, while the cache-aware version needs the right `TILE` and the naive version falls off a cliff.

```python
import time, random

def make(n):
    return [[random.random() for _ in range(n)] for _ in range(n)]

# --- 1) NAIVE: ijk triple loop. Inner loop strides B by column -> cache-hostile. ---
def naive(A, Bm, n):
    C = [[0.0]*n for _ in range(n)]
    for i in range(n):
        Ai, Ci = A[i], C[i]
        for k in range(n):
            aik = Ai[k]
            Bk = Bm[k]
            for j in range(n):
                Ci[j] += aik * Bk[j]      # ikj order already helps; still no blocking
    return C

# --- 2) CACHE-AWARE TILED: one hand-chosen block size TILE, tuned to the machine. ---
def tiled(A, Bm, n, TILE):
    C = [[0.0]*n for _ in range(n)]
    for ii in range(0, n, TILE):
        for kk in range(0, n, TILE):
            for jj in range(0, n, TILE):
                for i in range(ii, min(ii+TILE, n)):
                    Ai, Ci = A[i], C[i]
                    for k in range(kk, min(kk+TILE, n)):
                        aik, Bk = Ai[k], Bm[k]
                        for j in range(jj, min(jj+TILE, n)):
                            Ci[j] += aik * Bk[j]
    return C

# --- 3) CACHE-OBLIVIOUS RECURSIVE: split largest dim, recurse, NO tile constant. ---
#     Base-case cutoff CUT amortizes call overhead (the hybrid fix).
CUT = 32
def recmul(A, Bm, C, n, ai, aj, bi, bj, ci, cj, rows, cols, inner):
    if rows <= CUT and cols <= CUT and inner <= CUT:
        for i in range(rows):
            Ci = C[ci+i]; Ai = A[ai+i]
            for k in range(inner):
                aik = Ai[aj+k]; Bk = Bm[bi+k]
                base = cj
                for j in range(cols):
                    Ci[base+j] += aik * Bk[bj+j]
        return
    # split the largest of the three dimensions in half (oblivious to M, B)
    if rows >= cols and rows >= inner:
        h = rows // 2
        recmul(A,Bm,C,n, ai,aj, bi,bj, ci,cj, h, cols, inner)
        recmul(A,Bm,C,n, ai+h,aj, bi,bj, ci+h,cj, rows-h, cols, inner)
    elif cols >= inner:
        h = cols // 2
        recmul(A,Bm,C,n, ai,aj, bi,bj, ci,cj, rows, h, inner)
        recmul(A,Bm,C,n, ai,aj, bi,bj+h, ci,cj+h, rows, cols-h, inner)
    else:
        h = inner // 2
        recmul(A,Bm,C,n, ai,aj, bi,bj, ci,cj, rows, cols, h)            # C += A_left · B_top
        recmul(A,Bm,C,n, ai,aj+h, bi+h,bj, ci,cj, rows, cols, inner-h)  # C += A_right · B_bot

def oblivious(A, Bm, n):
    C = [[0.0]*n for _ in range(n)]
    recmul(A, Bm, C, n, 0,0, 0,0, 0,0, n, n, n)
    return C

def timed(fn, *args):
    t = time.perf_counter(); fn(*args); return time.perf_counter() - t

if __name__ == "__main__":
    for n in (128, 256, 384, 512):
        A, Bm = make(n), make(n)
        tn = timed(naive, A, Bm, n)
        # the cache-aware kernel must be TUNED: a tile too big or too small loses.
        best_tile = min((TILE for TILE in (8, 16, 32, 64, 128)),
                        key=lambda T: timed(tiled, A, Bm, n, T))
        tt = timed(tiled, A, Bm, n, best_tile)
        to = timed(oblivious, A, Bm, n)
        print(f"n={n:4d}  naive={tn:7.3f}s  "
              f"tiled(TILE={best_tile:3d})={tt:7.3f}s  oblivious={to:7.3f}s")
```

What the run demonstrates (the lesson, not the exact seconds — and in CPython the interpreter overhead flattens the cache signal, so the *shape* is what to take in a compiled language):

1. **Naive** is competitive at `n=128` (fits in cache) and degrades disproportionately as `n` grows past a cache level — the cliff.
2. **Tiled** is fastest *only with the right `TILE`*; the program literally searches `(8,16,32,64,128)` for the best one *per size*, which is the whole cost of cache-awareness — that search is the per-machine tuning you must redo on new hardware. A fixed wrong tile loses badly.
3. **Oblivious** uses **no tile constant at all** (only the forgiving `CUT` base case) and tracks the best tiled time within a constant factor *across every size*, never falling off a cliff. That robustness-without-tuning is the entire pitch made executable.

To turn this into a real measurement in C/Rust/Go: store the matrices in Z-order, drop a SIMD-FMA kernel into the base case, and run all three under `perf stat -e LLC-load-misses,dTLB-load-misses` — you will see the oblivious miss curve stay flat across sizes while naive's spikes at each level boundary and tiled's spikes at whichever levels it did not block.

---

## Decision Framework

| Situation | Reach for | Why |
| --- | --- | --- |
| Deep hierarchy (L1/L2/L3/TLB), all levels matter | **Cache-oblivious recursive** + coarsened base case | One source tiles every level; no nested tile constants |
| Unknown / heterogeneous target hardware (ship-once library) | **Cache-oblivious** | Portable, constant-free; runs well on CPUs you never tested |
| One known dominant level on a known machine, need peak | **Cache-aware tiled** (tune to that level) | Nails the exact block; no recursion overhead; best constants |
| FFT, sort, dense linear algebra (production) | **Hybrid**: oblivious recursion + tuned/SIMD base case | FFTW / recursive BLAS pattern — multi-level *and* peak constants |
| Multidimensional / spatial data placement | **Z-order (Morton) layout** | Self-similar locality at every scale, no tile size ([`../05-cache-aware-data-layout/professional.md`](../05-cache-aware-data-layout/professional.md)) |
| Write-heavy on-disk index | **`B^ε` / fractal tree** (oblivious-family) | Buffered sequential inserts; the storage payoff ([`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md)) |
| Tiny inputs that fit in L1 always | **Naive / flat loop** | Blocking and recursion are pure overhead below cache size |
| Multicore, unknown private/shared split | **Cache-oblivious fork-join + work-stealing** | Recursion is locality *and* parallelism; mind false sharing |

Three rules of thumb:

1. **Default to the hybrid.** Recursive cache-oblivious structure for the macro-blocking, a tuned cache-aware (and SIMD) base case for the constants. This is what every shipping high-performance library actually does, and it captures the portability of obliviousness and most of the speed of awareness at once.
2. **Tune one forgiving constant, not a stack of brittle ones.** The base-case cutoff `T` has a broad plateau and survives across machines; a multi-level tile stack is a maintenance liability. Prefer the former.
3. **Measure cache-boundedness before and after.** Confirm with `perf stat` (`LLC-load-misses`, `dTLB-load-misses`) that you are memory-bound, then prove the win by the *flatness* of the oblivious miss curve across sizes and levels — not by a single benchmark point.

---

## Research Pointers

- **Frigo, M., Leiserson, C. E., Prokop, H., & Ramachandran, S. (1999). "Cache-Oblivious Algorithms."** *FOCS 1999 / ACM TALG 8(1), 2012.* The founding paper — ideal-cache model, tall-cache assumption, recursive matrix multiply/transpose, funnelsort. The source of the portability argument this tier is built on.
- **Prokop, H. (1999). "Cache-Oblivious Algorithms."** *M.S. thesis, MIT.* The original detailed development; still the clearest derivation of the recursive multiply/transpose I/O bounds.
- **Frigo, M., & Johnson, S. G. (2005). "The Design and Implementation of FFTW3."** *Proceedings of the IEEE 93(2).* How a real, dominant library combines cache-oblivious recursion with runtime autotuning (codelets + planner) — the canonical "oblivious macro-structure + tuned micro-structure" case study.
- **Gustavson, F. G. (1997). "Recursion Leads to Automatic Variable Blocking for Dense Linear-Algebra Algorithms."** *IBM J. R&D 41(6).* Recursive matrix storage and recursive blocking for BLAS/LAPACK — the recursive-numerical-kernel line.
- **Bender, M. A., Demaine, E. D., & Farach-Colton, M. (2000/2005). "Cache-Oblivious B-Trees."** *FOCS / SICOMP 35(2).* The dynamic oblivious dictionary; the theoretical root of the fractal-tree storage engines.
- **Brodal, G. S., & Fagerberg, R. (2003). "Lower Bounds for External Memory Dictionaries" / "On the Limits of Cache-Obliviousness."** *SODA / STOC.* The `B^ε`-tree curve and the tall-cache/permuting separations that bound what obliviousness can do — the honest limits behind the trade-off.
- **Bender, M. A., Farach-Colton, M., et al. — the Fractal-Tree / TokuDB line (Tokutek).** The `B^ε`-tree as a shipping write-optimized index (TokuDB/TokuMX/PerconaFT). See [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md) for the I/O analysis.
- **Yotov, K., et al. (2007). "An Experimental Comparison of Cache-Oblivious and Cache-Conscious Programs."** *SPAA.* The empirical, professional-tier study: where oblivious wins, where hand-tuned aware still wins, and by how much — the data behind "asymptotically optimal but constant-factor loses."

---

## Key Takeaways

1. **The core practical value is portability, not asymptotics.** A CPU has L1, L2, L3, and a TLB with *different* `M` and `B`; you cannot hand-tune one blocking factor for all four, and any tuned factor is wrong on the next machine. A recursive cache-oblivious algorithm tiles *every* level at once, on every machine, with zero tuned constants — that is why the idea ships in libraries targeting unknown hardware.
2. **It really ships, in a specific list:** FFTW (recursive Cooley–Tukey + autotuned codelets), recursive BLAS / Gustavson recursive-storage matrix kernels, recursive Cholesky/LU/QR, the cache-oblivious B-tree realized as **fractal / `B^ε` trees** in TokuDB/PerconaFT storage, and Morton/Z-order layouts as a cache-oblivious-flavored *data placement*.
3. **The honest trade-off:** cache-*aware* (explicitly blocked to a measured level) is usually **faster by a constant factor** on a fixed machine — it nails the exact tile and avoids recursion overhead — but is per-machine, per-level, and fragile. Cache-*oblivious* is **portable and multi-level** but pays recursion overhead, so it is *asymptotically optimal yet can lose on the constant factor*. The fix is **base-case coarsening** → a **hybrid**.
4. **Engineer the recursion:** a tuned (forgiving) base-case cutoff amortizes call overhead; **Z-order storage** makes the recursion's accesses contiguous; **SIMD** saturates the leaf; in parallel, use fork-join + work-stealing while guarding against **false sharing** (line-aligned, disjoint output blocks) and steal-induced pollution.
5. **Measure before you commit:** confirm memory-boundedness via the roofline, then `perf stat -e LLC-load-misses,dTLB-load-misses,L1-dcache-load-misses` (or `cachegrind` for deterministic counts). The oblivious win shows up as a **flat miss curve across all sizes and all levels** with no cliffs, versus naive's per-level cliffs and tiled's spikes at the levels it did not block.
6. **Default to the hybrid in production:** cache-oblivious recursion for the multi-level macro-blocking, a tuned cache-aware + SIMD base case for peak constants — the FFTW/recursive-BLAS pattern. Choose pure cache-aware only when one known hot level on a known machine demands maximum constant-factor speed.

---

> **See also:** [`./senior.md`](./senior.md) for funnelsort, the cache-oblivious B-tree, the packed-memory array, and the tall-cache/permuting limits · [`../01-the-io-model/professional.md`](../01-the-io-model/professional.md) for the disk-level I/O model this hands off from, and where it stops predicting below RAM · [`../04-b-tree-io-analysis/professional.md`](../04-b-tree-io-analysis/professional.md) for the `B^ε`/fractal-tree write-optimization curve behind TokuDB-style storage · [`../05-cache-aware-data-layout/professional.md`](../05-cache-aware-data-layout/professional.md) for AoS/SoA, blocking, and Z-order/Morton layouts as the data-placement counterpart to oblivious algorithms
