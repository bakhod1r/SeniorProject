# Sparse Table & RMQ — Professional Level

> **Audience:** Engineers working at the level of cache lines, CPU intrinsics, SIMD pipelines, succinct data structures, and GPU kernels. Prerequisites: `junior.md` through `senior.md`.

This level covers the **low-level implementation choices** that determine whether a sparse table runs at 200 M queries/sec or 2 M queries/sec on a modern x86 CPU: memory layout, branchless comparisons, hardware bit-count intrinsics for log, SIMD min-reduction inside blocks, the succinct **2n + o(n) bits** representation of Fischer-Heun, and GPU-friendly parallel construction.

---

## 1. Memory Layout — Row-Major vs Column-Major vs Flat Block

The 2-D sparse table can be stored in several layouts. The choice has a 3–5× speed impact on real workloads because of cache lines and TLB pressure.

### 1.1 Row-major: `st[k][i]`

The pedagogical layout: an outer slice indexed by `k`, each row stored as its own contiguous array. Queries read `st[k][l]` and `st[k][r - 2^k + 1]` — same row, often same cache line. Excellent for typical queries.

Memory: O(n log n) cells plus O(log n) pointer overhead per row.

### 1.2 Column-major: `st[i][k]`

Outer slice indexed by `i`. Useful if queries cluster on adjacent `i`s with varying `k` (rare for RMQ workloads). Generally **worse** for sparse table because queries vary `i` more than `k`.

### 1.3 Flat 1-D: `st[k * n + i]`

Single contiguous `int*` of size `(log n + 1) * n`. Pros: one allocation, no pointer indirection, minimum metadata. Cons: ~50% wasted cells (row `k` only has `n - 2^k + 1` valid columns).

Trade-off:
- For `n < 10^6`: row-major is the cleanest.
- For `n > 10^7` and tight inner loops: flat 1-D is faster because the address computation `base + k*n + i` is one `lea` instruction and the compiler can hoist `k*n` out of loops.

### 1.4 Cache-impact of power-of-2 indexing

A query `query(l, r)` reads two cells from the same row. If `r - l` is small, the two cells share a cache line (modern lines are 64 bytes = 16 ints). If `r - l` is large (millions of elements), the two cells are in different lines, different pages, possibly different NUMA nodes. In that case the query is dominated by **two L3 misses** at ~80 ns each — 160 ns total, or 6 M queries/sec.

If your workload has many huge-range queries, consider **packing the cells** by value-difference: store deltas from a row baseline, or **bit-pack** to fewer bits per cell if the value range is small (e.g., 8-bit elevations).

---

## 2. Bit Tricks for `floor(log2)`

The query path needs `k = floor(log2(r - l + 1))`. Three options:

### 2.1 Precomputed log table

```c
int log_table[N + 1];
log_table[1] = 0;
for (int i = 2; i <= N; i++) log_table[i] = log_table[i / 2] + 1;
// query: int k = log_table[r - l + 1];
```

One memory read. Adds O(n) memory.

### 2.2 Hardware count-leading-zeros

Modern CPUs have `lzcnt` / `clz` instructions returning the count of leading zero bits in a 32- or 64-bit value. `floor(log2(x)) = 63 - lzcnt(x)` for 64-bit, or `31 - lzcnt32(x)` for 32-bit.

**Go (1.9+):**
```go
import "math/bits"
k := bits.Len(uint(L)) - 1   // floor(log2(L))
```

**Java (5+):**
```java
int k = 31 - Integer.numberOfLeadingZeros(L);
```

**C/C++ (GCC/Clang):**
```c
int k = 31 - __builtin_clz(L);
```

**C# (.NET 5+):**
```csharp
int k = BitOperations.Log2((uint)L);
```

**Rust:**
```rust
let k = (L as u32).ilog2() as usize;
```

All compile to a single `lzcnt` or `bsr` instruction. Faster than the table lookup on cold caches, marginally slower on hot.

### 2.3 De Bruijn sequence (when `lzcnt` is unavailable)

On older CPUs without `lzcnt`, a 32-bit De Bruijn lookup gives `floor(log2)` in 4-5 ops. Rare in 2025; legacy embedded.

---

## 3. SIMD Min-Reduction Inside a Block

For the **block-decomposition variant** (Fischer-Heun) the inner-block partial-min queries can be vectorized.

### 3.1 AVX2 `vpminsd`

The `vpminsd` instruction computes the element-wise min of **eight 32-bit signed integers** in a single cycle. For a block of size `b = 32`, four `vpminsd` instructions reduce the block to a single 8-lane vector; one more horizontal min gives the answer in **5 cycles** — ten times faster than scalar.

```c
#include <immintrin.h>

int block_min_avx2(const int* p, int len) {
    __m256i acc = _mm256_loadu_si256((const __m256i*)p);
    for (int i = 8; i + 8 <= len; i += 8) {
        __m256i v = _mm256_loadu_si256((const __m256i*)(p + i));
        acc = _mm256_min_epi32(acc, v);
    }
    // Horizontal min:
    __m128i lo = _mm256_castsi256_si128(acc);
    __m128i hi = _mm256_extracti128_si256(acc, 1);
    __m128i m = _mm_min_epi32(lo, hi);
    m = _mm_min_epi32(m, _mm_shuffle_epi32(m, _MM_SHUFFLE(2,3,0,1)));
    m = _mm_min_epi32(m, _mm_shuffle_epi32(m, _MM_SHUFFLE(1,0,3,2)));
    return _mm_cvtsi128_si32(m);
}
```

### 3.2 AVX-512 `vpminsq`

For 64-bit ints, AVX-512 brings 8-lane wide `vpminsq` — 8 int64 mins per cycle. Doubles the throughput vs AVX2 on Ice Lake / Sapphire Rapids / Zen 4.

### 3.3 ARM NEON `vminq_s32`

The same pattern on ARM64. Four 32-bit ints per instruction.

### 3.4 When SIMD helps

SIMD min-reduction is only useful for the **block-decomposition** inner loop (Fischer-Heun) where you need to compute the min of a small contiguous segment. The plain sparse-table query is already only two memory reads — no SIMD opportunity. For workloads dominated by Fischer-Heun's small-block inner-block scans, SIMD is a 5-10× speedup.

---

## 4. Succinct RMQ — 2n + o(n) Bits via Fischer-Heun

### 4.1 The encoding

For an array of `n` distinct values, the **Cartesian tree** has `n` nodes. Its shape can be encoded as a **2n-bit balanced-parenthesis string** by writing `(` when entering a node and `)` when leaving (the standard succinct-tree encoding). This 2n-bit string is the **entire** information needed to answer RMQ — the values are irrelevant.

The decoded structure supports:
- **rank / select** on the parenthesis string in O(1) with o(n) auxiliary bits.
- **LCA** in O(1) using **range-min on the depth sequence**, which (because the tree is balanced parens) is itself a ±1-RMQ.

The ±1-RMQ on the balanced-paren depth sequence is built with O(n) preprocessing and o(n) auxiliary bits using the Bender-Farach-Colton block-decomposition.

### 4.2 Why succinct matters in production

For `n = 10^9`:
- Plain sparse table: ~16 GB (with 4-byte ints) or 32 GB (8-byte ints).
- Plain segment tree: ~8 GB.
- Succinct Fischer-Heun: ~250 MB.

Genomic data, web-scale text indexes, and modern compression libraries (zstd's dictionary lookup, brotli's prefix dictionary) all hit `n` of 10⁹ or higher. The succinct representation is the only practical option.

### 4.3 Reference implementation

The **sdsl-lite** C++ library (Simon Gog, U. Stuttgart) provides production-grade succinct RMQ. Its `rmq_succinct_sct<>` class implements Fischer-Heun's algorithm with hand-tuned bitwise code. Used by:
- The **bowtie2** and **BWA** short-read aligners.
- **DEXTER** and **SDX** semantic indexes.
- Various academic text-indexing prototypes that later became commercial products.

---

## 5. GPU-Friendly Sparse Table

A sparse table is unusually amenable to GPU construction because each row depends only on the previous row, with no irregular memory access patterns.

### 5.1 Parallel build kernel

For each `k` from 1 to `log n`:
- Launch a kernel with one thread per cell of row `k`.
- Each thread reads two cells from row `k-1` and writes one cell to row `k`.
- Synchronize between rows; no intra-row dependencies.

Pseudocode (CUDA):
```cuda
__global__ void build_row(int* st_k, const int* st_prev, int half, int row_len) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < row_len) {
        st_k[i] = min(st_prev[i], st_prev[i + half]);
    }
}
```

For `n = 10^7`, this builds in ~10 ms on an RTX 4090 — vs 50–100 ms CPU-side.

### 5.2 Batched queries

Queries are embarrassingly parallel: one thread per query, two memory reads, one min. With pinned memory and pipelining, a single GPU can sustain billions of RMQ queries per second.

This is useful in:
- **Bioinformatics** read-mapping at scale (gigabases of queries against a reference).
- **Streaming analytics** on time-series with the data sharded across GPU memory.

---

## 6. Persistent Sparse Table — Doesn't Make Sense

Persistent data structures preserve old versions after updates. **Sparse table doesn't support updates**, so there is nothing to "persist". If you find yourself wanting a "persistent sparse table", what you actually want is a **persistent segment tree** (a.k.a. functional segment tree), where each update copies O(log n) nodes and keeps the old version accessible.

A practical note: in competitive programming, when you see "persistent RMQ", interpret it as **persistent segment tree** — not as any kind of sparse-table descendant.

---

## 7. Compressed RMQ in Suffix-Tree / Suffix-Array Implementations

In modern suffix-array libraries (sdsl-lite, libcds, BIO++):

1. **Suffix array** stored compressed: O(n log n) → O(n log σ) bits via SAIS sampling + suffix-array compression.
2. **LCP array** stored compressed: O(n) → ~2n bits via succinct PLCP encoding.
3. **RMQ over LCP**: Fischer-Heun succinct RMQ, 2n + o(n) bits.

Total: ~6n bits for a fully-functional suffix-array-with-RMQ. For a 100 GB text corpus, that is ~75 GB of indexes — fits on one server. The same data structures in plain form would be ~600 GB.

This is the production state of the art in **full-text search at scale**: every byte saved in the index translates directly into denser servers, lower latency, and lower cost. The choice of "succinct sparse table" over "plain sparse table" is a multi-million-dollar architecture decision at companies running Lucene-class search at scale.

---

## 8. Production Checklist for Sparse-Table Implementations

When integrating a sparse table into a production codebase:

1. **Document the inclusive/exclusive query convention** in the type signature.
2. **Validate input sortedness or constraints** in debug builds; assert away in release.
3. **Use `bits.Len` / `__builtin_clz` / `numberOfLeadingZeros`** for log lookup unless you have a benchmark showing the log table is faster on your CPU.
4. **Pre-allocate the table contiguously** for cache locality and predictable allocator behavior.
5. **Test on adversarial inputs**: empty array, single element, `l == r`, all-equal array, alternating min/max patterns.
6. **Benchmark on representative query patterns**: short ranges vs long ranges hit different cache levels. Don't tune on a microbenchmark with only short ranges; production traffic differs.
7. **If `n > 10^7`, prefer Fischer-Heun.** The 5–10× constant slowdown vs sparse table is more than offset by the cache-friendliness when the table no longer fits in RAM.
8. **For 2D / nD**, consider whether a k-d tree or range tree is more appropriate — the `(log n)^d` factor in sparse-table memory becomes prohibitive past `d = 2`.

---

## Further Reading

- **Fischer, J. & Heun, V.** "A New Succinct Representation of RMQ-Information and Improvements in the Enhanced Suffix Array." *ESCAPE 2007*.
- **Gog, S., Beller, T., Moffat, A., Petri, M.** "From Theory to Practice: Plug and Play with Succinct Data Structures." *SEA 2014*. The sdsl-lite paper.
- **Cole, R., Gottlieb, L.-A., Lewenstein, M.** "Dictionary matching and indexing with errors and don't cares." *STOC 2004*. RMQ in approximate text matching.
- **Intel Intrinsics Guide** for `_mm256_min_epi32` and friends.
- **NVIDIA CUDA C++ Programming Guide**, parallel reduction patterns.
- **Knuth**, *TAOCP* Vol. 4A, Section 7.1.3 on bitwise tricks including count-leading-zeros.
- **Vigna, S.** "Broadword Implementation of Rank/Select Queries." *WEA 2008*. Broadword tricks underlying succinct structures.
