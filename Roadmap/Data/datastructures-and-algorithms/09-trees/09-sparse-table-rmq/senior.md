# Sparse Table & RMQ — Senior Level

> **Audience:** Engineers building or maintaining systems where RMQ shows up as a subroutine — string indexing, compilers, version-control ancestry, geospatial analytics, time-series. Prerequisites: `junior.md`, `middle.md`.

This level focuses on **real production deployments** of RMQ and the sparse-table machinery: how the suffix-array + LCP + RMQ pipeline powers Apache **Lucene**'s suffix-based n-gram features and the **Burrows-Wheeler Transform** in genome assemblers, how Cartesian trees solve histogram and range-k-th-smallest problems in analytics, how 2D RMQ is used in GIS elevation datasets, how LCA reductions appear in **Git ancestry** and in **compiler type hierarchies**, and the historical detour from Berkman-Vishkin (1993) to Bender-Farach-Colton (2000) that made theoretically-optimal RMQ practical.

---

## 1. Production Usage: Suffix Arrays + LCP + RMQ

### 1.1 The pipeline

For a string `S` of length `n`:
1. Build the **suffix array** `SA[0..n-1]` — the indices of all suffixes of `S` sorted lexicographically. Built in O(n) via DC3/SA-IS.
2. Build the **LCP array** `LCP[0..n-2]` where `LCP[i]` is the longest common prefix between `S[SA[i]..]` and `S[SA[i+1]..]`. Built in O(n) via **Kasai's algorithm** (Kasai, Lee, Arimura, Arikawa, Park 2001).
3. Build a **sparse table** for range-min over `LCP`.

Now the **Longest Common Extension (LCE)** of two suffixes — the LCP of `S[i..]` and `S[j..]` — is computed in **O(1)**: find their ranks in `SA`, then min-query the LCP array between those ranks.

### 1.2 Where this is used

- **Apache Lucene** uses suffix-based structures for n-gram features and the `SuffixArrayTermsEnum`. RMQ over LCP enables fast longest-common-prefix lookups across terms.
- **Genome assemblers** (BWA, Bowtie, SOAP) use the **FM-index**, which internally relies on the BWT and a suffix-array-like structure with RMQ over LCP for fast pattern matching.
- **bzip2** and other **BWT compressors** use the Burrows-Wheeler Transform; the inverse transform requires sorting suffixes and is accelerated by RMQ-on-LCP techniques.
- **Plagiarism detection** and **near-duplicate detection** services build suffix arrays over corpora and use LCP+RMQ for fast substring-match scoring.
- **Code clone detection** (e.g., the Moss algorithm at Stanford) uses suffix-tree variants where RMQ-over-LCP gives O(1) substring-match queries.

### 1.3 Performance characteristics in production

A typical deployment:
- `n = 10^9` characters of source text.
- Suffix array + LCP: 16 GB on a server.
- Sparse table over LCP: O(n log n) cells — would be 300+ GB. **Infeasible.**
- Solution: **Fischer-Heun** succinct RMQ (2n + o(n) bits), bringing the RMQ structure to 250 MB instead of 300 GB.

This is the production reason succinct RMQ exists. Sparse table is for `n <= 10^8` or so; beyond that, Fischer-Heun or hybrid block-decomposition is required. The **sdsl-lite** C++ library (Simon Gog et al.) is the de-facto reference implementation.

---

## 2. Cartesian-Tree Applications

### 2.1 K-th smallest in a range

Given a static array and many queries "k-th smallest in `arr[l..r]`", a **persistent segment tree** indexed by value gives O(log n) per query. The Cartesian-tree-based approach: build the Cartesian tree, then a **persistent treap** on the in-order traversal, with the LCA of `l` and `r` rooting the relevant subtree. This appears in problems where range-k-th queries dominate — competitive systems, analytics OLAP cubes with quantile queries.

### 2.2 Largest rectangle in a histogram

Classical monotonic-stack O(n) solution. The Cartesian tree of the histogram heights gives the same answer via a single tree traversal: at each node `v` with value `h_v`, the largest rectangle anchored at `v` spans the entire subtree of `v`. The Cartesian-tree view generalizes to:

- **Maximum rectangle of 1s in a binary matrix** — Cartesian tree of histogram heights per row.
- **Skyline problems** — Cartesian tree captures the shape directly.

### 2.3 Range queries on intervals with priorities

In **task scheduling**, an interval has a priority and you want "highest-priority interval that contains time `t`". A Cartesian-tree-on-priorities indexed by interval midpoint answers this efficiently.

---

## 3. Geographic Information Systems — 2D RMQ on Elevation Grids

Digital Elevation Models (DEMs) store altitude as a 2D grid — every pixel has an integer elevation. A common query type:

> *"What is the lowest elevation inside this bounding box?"*

For a 30 m resolution DEM of the United States, the grid is roughly 100,000 × 50,000 = 5 × 10⁹ cells. Storing a full 2D sparse table is infeasible. Production solutions:

- **Tile the grid** into 1 km × 1 km blocks. Build a sparse table over the block minima.
- Inside each tile, store the raw elevations; answer the small-rectangle remnant queries by scanning.
- Or: build a **quadtree** with min-aggregated nodes. Quadtree RMQ is O(log n) per query but uses linear space.

Similar setups arise in:
- **Flood modeling** — minimum elevation along a watershed.
- **Drone routing** — minimum elevation needed for line-of-sight along a path.
- **Real-estate analytics** — fastest cell-tower coverage in a rectangle.

---

## 4. LCA Computation in Trees — Phylogenetic, VCS, Compiler

### 4.1 Phylogenetic trees

Evolutionary biologists ask "what is the most recent common ancestor of these two species?" — that is exactly LCA. Phylogenetic trees can have hundreds of millions of leaves (every catalogued species). The structure is built once at database load and queried millions of times by researchers. RMQ-via-Euler-tour with a sparse table gives O(1) per query.

### 4.2 Version control — Git merge-base

`git merge-base A B` finds the LCA of commits `A` and `B` in the commit DAG. The naive algorithm walks parents and is O(commits²) in the worst case. For monorepos with millions of commits (Linux kernel, Google's monorepo, Facebook's), this is too slow.

Modern accelerations:
- **Generation numbers** (the depth of each commit). A commit with smaller generation number cannot be a descendant of one with larger.
- For a tree-shaped subgraph (not a DAG), **Euler-tour + sparse-table RMQ** gives O(1) LCA after O(n log n) preprocessing.
- Git's **commit-graph** file precomputes generation numbers and ancestry indices to accelerate merge-base.

### 4.3 Compiler type hierarchies

Java/Kotlin/Scala class hierarchies are trees (single-inheritance) or DAGs (with interfaces). The compiler needs LCA-style queries:
- *"What is the most-derived common supertype of `T1` and `T2`?"* — required for `Object o = condition ? t1 : t2;` to infer the result type.
- *"Is `T1` a subtype of `T2`?"* — solved as "is `T2` an ancestor of `T1` in the hierarchy?"

For type hierarchies with tens of thousands of classes (a large enterprise codebase), the compiler precomputes a Euler tour + sparse table at startup and answers LCA in O(1) thereafter. The **HotSpot JIT** and **GraalVM** both use this kind of structure for type-profiling feedback.

---

## 5. Static Interval Aggregation in Time-Series

In **batch analytics** (Spark, Flink), time-series data is often immutable — the window of historical data is fixed, and you run thousands of "min CPU between 09:00 and 10:00" queries against the same data set. Sparse table is the textbook answer:

- Build at the start of the analytics job.
- Query thousands of intervals in parallel from worker tasks.
- Discard the sparse table when the job ends.

Real systems:
- **Prometheus** range queries — under the hood, the storage engine indexes per-chunk min/max for sparse-table-style fast aggregates.
- **InfluxDB** and **TimescaleDB** precompute "chunk metadata" (min, max, count per chunk) used to short-circuit queries; conceptually a one-level sparse table.
- **Apache Druid** segment metadata includes pre-aggregated min/max per dimension shard.

The "sparse table" terminology is rare in these systems, but the algorithmic idea — precompute power-of-two window aggregates for O(1) range queries — is structurally identical.

---

## 6. The Historical Detour — Berkman-Vishkin (1993) to Bender-Farach-Colton (2000)

### 6.1 Berkman-Vishkin 1993

The first **O(n) preprocessing, O(1) query** RMQ algorithm appeared in:

> Berkman, O. & Vishkin, U. "Recursive Star-Tree Parallel Data Structure." *SIAM Journal on Computing* 22(2), 1993.

Their algorithm is a marvel of recursion: a 4-level decomposition with block sizes `(log n)^(1/4)`. It is provably optimal in asymptotic complexity but has **astronomical constants** — for any realistic `n`, plain O(n log n) sparse table is faster by orders of magnitude. The Berkman-Vishkin result was viewed as a theoretical curiosity for nearly a decade.

### 6.2 Bender-Farach-Colton 2000

Bender and Farach-Colton's *"The LCA Problem Revisited"* re-derived RMQ ↔ LCA via the Cartesian-tree construction, then introduced the **block-decomposition + 4-Russians trick** that gives O(n) preprocessing and O(1) query with **small constants**. Their algorithm:

1. Block size `b = log(n) / 2`.
2. Cartesian-tree-signature of each block (one of `4^b` possible shapes).
3. Precompute the RMQ answer for every block shape (a small lookup table).
4. Sparse table over block minima for inter-block queries.

This was the first **practically usable** linear-time RMQ. Most modern implementations (sdsl-lite, libcds) descend from this design.

### 6.3 Fischer-Heun 2007

The succinct refinement: encode the RMQ structure as **2n + o(n) bits** by storing only the Cartesian-tree shape, exploiting the fact that the answers depend only on shape, not values. This is the basis of modern enhanced suffix arrays and FM-indexes — the same data structure underlying every short-read aligner in computational biology.

### 6.4 The lesson

A 7-year delay between "theoretical solution" (1993) and "practical solution" (2000) is typical in data-structures research. Optimal constants and practical constants are different beasts. For most senior engineers, this is the lesson: **don't confuse asymptotic optimality with production-readiness**. Sparse table at O(n log n) build is faster than Bender-Farach-Colton at O(n) build for `n < 10^7`, despite being asymptotically worse.

---

## 7. When to Reach For Sparse Table in Production

A senior engineer's decision tree:

1. **Is the data immutable for the lifetime of the structure?** If yes, sparse table is in play. If no — segment tree.
2. **Is the operation idempotent?** Min, max, gcd, AND, OR → yes. Otherwise → disjoint sparse table, prefix sums, or segment tree.
3. **What is `n log n` in memory?** If under your memory budget, build a sparse table. If not, drop down to **Fischer-Heun** or a hybrid block-decomposition.
4. **How many queries per build?** If queries dominate (≥ 100× build), sparse table wins. If updates are interleaved, switch to segment tree.
5. **Do you need 2D / nD?** Sparse table generalizes — `O(n^d · (log n)^d)` memory. Beyond `d = 2`, switch to k-d trees or range trees.

**Most production uses of "RMQ" in the wild are actually 1-D sparse tables**, hidden inside higher-level abstractions (suffix-array libraries, time-series engines, GIS query planners). Recognizing the pattern lets you debug performance issues at the right layer.

---

## Further Reading

- **Bender, M. A. & Farach-Colton, M.** "The LCA Problem Revisited." *LATIN 2000*.
- **Berkman, O. & Vishkin, U.** "Recursive Star-Tree Parallel Data Structure." *SIAM J. Comput.* 22(2), 1993.
- **Fischer, J. & Heun, V.** "A New Succinct Representation of RMQ-Information and Improvements in the Enhanced Suffix Array." *ESCAPE 2007*.
- **Kasai, T., Lee, G., Arimura, H., Arikawa, S., Park, K.** "Linear-Time Longest-Common-Prefix Computation in Suffix Arrays and Its Applications." *CPM 2001*.
- **Gog, S., Beller, T., Moffat, A., Petri, M.** "From Theory to Practice: Plug and Play with Succinct Data Structures." *SEA 2014*. The sdsl-lite paper.
- **Ferragina, P. & Manzini, G.** "Opportunistic Data Structures with Applications" (the FM-index). *FOCS 2000*.
- Continue with `professional.md` for low-level memory layout, SIMD, and GPU implementations.
