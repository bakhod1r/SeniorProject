# Trie — Professional Level

> **Audience:** Library and infrastructure authors who need tries to scale to billions of keys, fit in tens of MB, and run at memory-bandwidth speed.

The plain trie's pointer-per-edge representation is fine up to a few million keys. Past that, you pay 8 bytes per pointer × hundreds of pointers per node and watch your dictionary outgrow main memory. Production-scale tries reach for **succinct encodings**, **cache-conscious layouts**, **on-the-fly minimization**, **SIMD batch traversal**, and **persistent functional sharing**. This document is the survey of those techniques.

---

## 1. Succinct Tries — O(n) Bits

A pointer-based trie uses Θ(n log n) bits to store n nodes (each pointer is log₂(n) bits in an idealized model, but 64 bits in practice). **Succinct data structures** (Jacobson 1989, Munro & Raman 1998) achieve a near-information-theoretic 2.07n + o(n) bits and still support O(1) navigation.

### LOUDS — Level-Order Unary Degree Sequence

Jacobson's LOUDS encodes a tree as follows:

1. Visit nodes in **level order (BFS)**.
2. For each visited node, emit `1` repeated by its number of children, then a `0` separator.

Example: a tree with degrees (2, 2, 0, 0, 0, 0) (root has 2 children, those have 2 each, leaves) encodes as `10 1 1 0 0 1 1 0 0 0 0 ...` (concatenated). Navigation operations:

- **first_child(i)** = `select_0(rank_1(i)) + 1`
- **next_sibling(i)** = `i + 1` if bit i is `1`
- **parent(i)** = `select_1(rank_0(i))`

With **rank/select** preprocessing in o(n) extra bits (Clark 1996, Vigna 2008), each operation is O(1). For a trie with 10⁹ nodes, LOUDS encodes the structure in ~250 MB — far less than the 80+ GB a pointer trie would need.

### Practical implementations

- **MARISA-trie** (Yata, Tamura, Morita, Fuketa, Aoe 2007) — recursive LOUDS-encoded **MA-FSA** (DAWG). Used at Google for input-method engines, Japanese morphological analyzers (MeCab dictionary), and several open-source spell checkers. Often 5–10× smaller than a plain DAWG.
- **`sdsl-lite`** (Gog, Beller, Moffat, Petri) — C++ library of succinct data structures including LOUDS and balanced-parenthesis tries.
- **`darts-clone`** — double-array trie variant, very fast at the cost of more memory than MARISA.

The Python `marisa-trie` binding (`pip install marisa-trie`) gives you Google's implementation in three lines.

---

## 2. HAT-Trie and Cache-Conscious Variants

Askitis & Sinha, "HAT-trie: A Cache-Conscious Trie-Based Data Structure for Strings" (ACSC 2007), refined the **burst trie** (`middle.md` §6) with **cache-conscious hash tables** as the bottom-level containers.

The HAT-trie maintains:

- **Upper levels**: dense trie nodes (small alphabet, hot path).
- **Bottom containers**: open-addressing hash tables sized to fit in one or two cache lines.
- **Burst rule**: when a container exceeds ~1024 entries or its load factor crosses a threshold, replace it with a trie node whose children are smaller containers re-partitioned by next character.

Empirically, HAT-tries:

- Match the lookup throughput of high-quality hash tables (1.5–2× faster than `std::unordered_map`).
- Use 20–40% less memory than `std::unordered_map<std::string, V>`.
- Retain prefix queries and sorted iteration (with a slight constant-factor cost).

Used in: **TileDB** for array dimension labels, several research search engines, and Rust's `qp-trie` crate (a different but related design).

---

## 3. Double-Array Tries

Aoe (1989) introduced **double-array tries**: encode a trie as two parallel arrays `base[]` and `check[]`.

To find the child of state `s` via character `c`: index `t = base[s] + c`. Check `check[t] == s`. If yes, you're at the child; if no, the child doesn't exist.

This is O(1) per step, has excellent cache locality (two contiguous int arrays), and uses ~4 + 4 bytes per node — far less than a pointer trie. The cost: **insertion is hard** because finding a `base[]` value such that the children don't conflict with existing entries is a packing problem.

Production uses:

- **Darts** and **darts-clone** — implementations widely used in Japanese morphological analysis (Kuromoji, MeCab, IPADIC).
- **CRF++** part-of-speech tagger.
- The original Aho-Corasick implementation in `cdb`.

Best when the trie is built once from a known dataset (e.g., a dictionary) and queried billions of times — read-mostly workloads.

---

## 4. Compressed Sparse Row (CSR) and Static Tries

For an **immutable** trie (built once, queried forever), you can serialize it to a **compressed sparse row** layout:

- One array of nodes in BFS order.
- For each node, a `(start, count)` pointer into a children array.
- The children array is a flat list of `(char, child_index)` pairs, sorted by char.

Lookup: at each step, binary-search the children sub-range for the next character. Two contiguous int arrays, no pointer chases, perfect cache utilization for hot prefixes.

This is the layout used in many **embedded** dictionary lookups (mobile spell-check, on-device LLM tokenization) and is what `tiktoken` compiles its BPE merges into.

---

## 5. SIMD-Accelerated Trie Traversal

Modern CPUs offer **SIMD intrinsics** (SSE, AVX2, AVX-512, NEON) that compare 16–64 bytes in one instruction. For trie nodes with small fan-out (≤16 children), you can:

1. Pack the children's characters into one 16-byte register.
2. Broadcast the input character to a register.
3. Compare in parallel (`_mm_cmpeq_epi8`).
4. Extract the matching slot via `_mm_movemask_epi8` and `__builtin_ctz`.

One iteration covers 16 candidate children in a few cycles. Combined with a CSR layout, hot tries achieve **billions of nodes traversed per second per core**.

The HAT-trie and `qp-trie` crates use this trick on AVX2-capable CPUs. ClickHouse's column-store engine has SIMD trie walks for short-string dictionary encoding.

---

## 6. Persistent / Functional Tries — HAMT and CHAMP

Bagwell's **HAMT** (Hash Array Mapped Trie, 2001) makes the trie the foundation of **persistent immutable maps**:

- Keys are hashed.
- The trie branches on **5-bit chunks** of the hash (32 children per node, exactly one machine word for the bitmap).
- Updates copy the path from root to leaf — O(log₃₂ n) new nodes — and share everything else with the previous version (structural sharing).

Result: **immutable maps with O(log n) updates and persistence (every version remains queryable)**. Foundational for:

- **Clojure**'s `PersistentHashMap`, `PersistentVector`, `PersistentHashSet`.
- **Scala**'s `immutable.HashMap` (HAMT until 2.13, **CHAMP** from 2.13 onward).
- **Haskell**'s `Data.HashMap.Strict`.
- **Immutable.js** (Facebook) — JS implementation used in Redux state trees.

**CHAMP** (Compressed Hash-Array Mapped Prefix-tree, Steindorfer & Vinju 2015) refines HAMT to keep **data** (key-value pairs) and **node pointers** in **separate arrays** within each node. This drops cache misses for both lookups and iteration, often by 1.5–3×. Modern Scala and Java's `io.vavr.HashMap` use CHAMP.

For library authors: if you need a persistent map, **don't reinvent HAMT** — port a known-good implementation. The bit-fiddling and cache-tuning are subtle.

---

## 7. Front Coding and Other Compression

For **read-only** sorted dictionaries, **front coding** stores each key as `(shared_prefix_length, remaining_suffix)`:

```
words                front-coded
"abacus"             (0, "abacus")
"abandon"            (3, "ndon")
"abandoned"          (7, "ed")
"abate"              (3, "te")
```

This is conceptually a trie with edge labels but encoded as a flat sorted list. Lookup: binary-search the entry table, decode the few neighbors needed. Used by:

- **DAFSA / `cdb`** dictionary formats.
- **Lucene's terms dictionary** — adjacent terms in a block share prefixes.
- **Wikipedia search dumps** ship with front-coded title indexes.

Combine front coding with a coarse **block index** (one entry per 64 keys) and lookups stay O(log B + L) where B is the block index size, L the key length.

---

## 8. Tokenizer Tries — Production Lessons

Modern LLM tokenizer libraries (HuggingFace `tokenizers`, `tiktoken`) must:

- Handle UTF-8 input as raw bytes — alphabet of 256.
- Match against vocabularies of 50k–250k token-byte-sequences.
- Achieve gigabytes-per-second throughput per core.
- Boot in milliseconds (no per-startup trie construction).

The standard recipe:

1. **Offline**: build a DAWG / FST from the vocabulary, serialize to a binary blob.
2. **Boot**: `mmap` the blob; the trie is queryable in O(1) startup.
3. **Hot path**: byte-level walks with SIMD comparison; fall back to scalar at branchy spots.
4. **Greedy match**: at each position, walk as far as possible and emit the longest matched token. (BPE then re-emits sub-tokens for unmatched runs.)
5. **Caching**: hash-cache recent token boundaries for repeated input patterns.

These optimizations matter: at trillion-tokens-per-day inference scale, a 2× tokenizer slowdown is meaningful in dollar terms.

---

## 9. LSM-Tree Integration — Prefix-Encoded Keys

LSM-tree key-value stores (RocksDB, LevelDB, CockroachDB's Pebble, ScyllaDB) often store **sorted runs of keys**. Storing adjacent keys with **shared prefixes** is a one-level trie compression: each key is `(shared_with_previous, remaining)`. RocksDB's BlockBasedTable uses this; Pebble uses a variant.

For workloads with prefix-heavy keys (timestamps, UUIDs, user-id-then-event-id) the savings are substantial — sometimes 5–10× index size reduction.

---

## 10. Alphabet Remapping

If your trie's alphabet is much larger than necessary — e.g., 256 bytes but the actual data uses only 30 distinct values — **remap** the alphabet to a dense [0, 30) range and shrink the children array proportionally. This is the trie equivalent of **column dictionary encoding** in databases.

Typical applications: DNA tries (4 bases instead of 256 bytes), domain-name tries (~40 characters instead of full Unicode), URL path tries (~70 printable characters).

The cost is a 256-byte mapping table; the benefit is an 8–60× memory reduction at the leaf level.

---

## 11. Cache-Oblivious Tries

Brodal & Fagerberg's **cache-oblivious dictionary** (2002) and **Cole's compact tries** lay out trie nodes such that traversal is asymptotically optimal across the entire memory hierarchy (L1, L2, L3, RAM, SSD) **without** knowing block sizes. The technique uses a recursive van Emde Boas–style layout.

These are mostly of theoretical interest; in practice, hand-tuning for a specific cache-line size (64 bytes on x86) yields better measured performance.

---

## 12. Engineering Checklist for Production Tries

Before shipping a trie:

- [ ] **Profile the workload.** Are you read-heavy or write-heavy? Prefix-query-heavy or exact-match-heavy?
- [ ] **Measure memory** with realistic data, not toy inputs. Include allocator overhead.
- [ ] **Pick the variant** that matches the workload (HAMT for persistent, HAT-trie for cache, MARISA for static dictionary).
- [ ] **Document the alphabet** in the type. Normalize input at the boundary.
- [ ] **Serialize and `mmap`** for read-only deployments to avoid boot cost.
- [ ] **Add a fallback** to linear scan for tiny sub-problems (≤16 children) — branch prediction is faster than indirection.
- [ ] **Benchmark against `std::unordered_map` / `HashMap` / `dict`** — if you don't beat them on your actual workload, drop the trie.
- [ ] **Property-test** insert/delete/lookup against a reference set implementation. Tries are subtle; bugs hide for years.
- [ ] **Plan for resize/reload**. Static tries can't grow; mutable ones may rebalance. Either way, design for it.

---

## Further Reading

- **Jacobson, G.** (1989), "Space-Efficient Static Trees and Graphs", FOCS — LOUDS encoding.
- **Munro, J. I. & Raman, V.** (1998), "Succinct Representation of Balanced Parentheses, Static Trees and Planar Graphs", FOCS.
- **Yata, S. et al.** (2007), "A Compact Static Double-Array Keeping Character Codes", Information Processing and Management — MARISA / darts.
- **Bagwell, P.** (2001), "Ideal Hash Trees", EPFL — HAMT.
- **Steindorfer, M. J. & Vinju, J. J.** (2015), "Optimizing Hash-Array Mapped Tries for Fast and Lean Immutable JVM Collections", OOPSLA — CHAMP.
- **Askitis, N. & Sinha, R.** (2007), "HAT-trie: A Cache-Conscious Trie-Based Data Structure for Strings", ACSC.
- **Aoe, J.** (1989), "An Efficient Digital Search Algorithm by Using a Double-Array Structure", IEEE TSE — original double-array trie.
- **Mihov, S. & Maurel, D.** (2001), "Direct Construction of Minimal Acyclic Subsequential Transducers".
- The source of **`marisa-trie`**, **`tiktoken`**, **Clojure's `PersistentHashMap`**, and **Lucene's FST** — all open and worth reading.
