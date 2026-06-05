# Burrows-Wheeler Transform (BWT) and the FM-index — Senior Level

> The BWT is rarely the bottleneck on a toy string — but the moment you are compressing terabytes (`bzip2`), aligning billions of short reads against a 3-gigabase genome (BWA/bowtie), or indexing thousands of near-identical genomes, every detail (block size, rank representation, suffix-array sampling rate, memory layout, alphabet mapping, failure on non-ACGT bytes) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [The bzip2 Compression Pipeline](#2-the-bzip2-compression-pipeline)
3. [Genomics Aligners: BWA and bowtie](#3-genomics-aligners-bwa-and-bowtie)
4. [Wavelet Trees for Rank](#4-wavelet-trees-for-rank)
5. [Sampling the Suffix Array for Locate](#5-sampling-the-suffix-array-for-locate)
6. [Run-Length BWT and the r-index](#6-run-length-bwt-and-the-r-index)
7. [Memory and Layout Engineering](#7-memory-and-layout-engineering)
8. [Code Examples](#8-code-examples)
9. [Observability and Testing](#9-observability-and-testing)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "how does the LF-mapping invert the BWT" but "what system am I building, and what breaks when I scale it?". The BWT shows up in three production guises that look different but share one engine:

1. **Lossless compression** — `bzip2` BWTs fixed-size blocks, then squeezes the runs with Move-To-Front, run-length, and Huffman coding. The decisions are block size, fallback for incompressible data, and CRC integrity.
2. **Short-read alignment** — BWA and bowtie build an FM-index over a reference genome and align millions of reads by backward search plus a mismatch/gap search on top. The decisions are the rank representation, the suffix-array sampling rate, and how to handle inexact matches.
3. **Repetitive-collection indexing** — the `r`-index stores an FM-index in `O(r)` space (runs of the BWT) to index thousands of genomes. The decisions are run encoding, sampling at run boundaries, and locate cost.

All three reduce to: *build the BWT (from a suffix array), wrap it with `C` + a rank structure (FM-index), sample the SA for locate, and either feed the runs to a compressor or search them.* The senior-level decisions are how to keep memory bounded, how to make rank `O(1)`-ish, how to locate without storing the full SA, and how to verify correctness on adversarial inputs.

This document treats those decisions in production terms: the compression pipeline, the genomics search stack, the rank and locate structures that make the index small and fast, and the failure modes that turn a correct algorithm into an incorrect system. The recurring theme is that the BWT's *asymptotics* are settled (`O(n)` build, `O(m)` count) — the engineering is all in the *constants and the memory*: alphabet packing, cache-resident checkpoints, SA sampling rate, run-length representation, and a serialization format that survives being loaded on a different machine.

---

## 2. The bzip2 Compression Pipeline

`bzip2` is the canonical BWT-based compressor. It does **not** transform the whole file at once; it splits the input into **blocks** (selectable from 100 KB to 900 KB) and runs a four-stage pipeline per block.

### 2.1 The four stages

```
input block
   │  (1) Burrows-Wheeler Transform
   ▼      sort rotations, take last column  ->  clustered runs
   │  (2) Move-To-Front (MTF)
   ▼      recode each byte by its rank in a moving alphabet  ->  many small (often 0) values
   │  (3) Run-Length Encoding (RLE) of zeros
   ▼      collapse runs of MTF-0 into compact run codes
   │  (4) Huffman coding
   ▼      entropy-code the now-skewed symbol distribution
output
```

- **Stage 1 (BWT)** clusters identical bytes into runs (the property from `junior.md`).
- **Stage 2 (MTF)** maintains a list of the alphabet ordered by recency; each input byte is replaced by its current position, then moved to the front. After the BWT's runs, the same byte repeats, so MTF emits long stretches of `0`.
- **Stage 3 (RLE)** collapses those `0`-runs (and `bzip2` also does an initial RLE before the BWT to tame pathological inputs).
- **Stage 4 (Huffman)** entropy-codes the highly skewed distribution (lots of small values), achieving the actual size reduction.

The BWT itself compresses nothing; it *makes the data compressible* for stages 2–4. This staged design is why `bzip2` typically beats `gzip` (LZ77 + Huffman) on text, at the cost of being slower and block-bounded.

### 2.1b The initial RLE and pathological inputs

Before the BWT, `bzip2` applies a preliminary RLE that caps any run of 4+ identical bytes at 4 (encoding the extra count). This guards against inputs that would otherwise make the suffix sort quadratic or produce degenerate BWTs (e.g. a file of a million identical bytes). It is a small but important robustness detail: the BWT's sort can be a worst case on highly repetitive runs, and the pre-RLE tames that before the expensive stage. A production BWT pipeline should always consider whether its sort handles long runs gracefully, or pre-process them away.

### 2.2b Practical compression-ratio comparison

| Compressor | Method | Typical text ratio | Speed | Memory |
|------------|--------|--------------------|-------|--------|
| `gzip` | LZ77 + Huffman | ~3:1 | fast | low |
| `bzip2` | BWT + MTF + RLE + Huffman | ~3.5–4:1 | medium | block-bounded |
| `xz`/LZMA | LZ77 + range coding | ~4–5:1 | slow | high |
| `zstd -19` | LZ77 + FSE/Huffman | ~4:1 | fast decode | tunable |

`bzip2`'s niche is good ratio on text at moderate speed without huge memory; it lost ground to `zstd` and `xz` for many uses, but the BWT idea lives on in genomics indexing rather than general compression. The senior lesson: the BWT's enduring impact is as an *index* (FM-index), not primarily as a compressor.

### 2.2 Block size trade-offs

Larger blocks group more context, improving the BWT's clustering and thus the ratio — but cost more memory and CPU for the sort. `bzip2 -9` uses 900 KB blocks. The block boundary is also the recovery granularity: a corrupt block does not poison the rest of the file, and `bzip2` stores a per-block CRC for integrity.

### 2.2c Block size, memory, and recovery

The block size sets three coupled budgets: **ratio** (bigger blocks group more context, so the BWT clusters better), **memory** (the suffix sort needs `O(block)` working space), and **recovery granularity** (a corrupt block is isolated, and each carries its own CRC). `bzip2 -9` uses 900 KB; `-1` uses 100 KB. There is no benefit to blocks larger than the file, and very small blocks waste the BWT's advantage. For a streaming variant you would pick the block size to bound latency and memory while keeping ratio acceptable — the classic throughput-vs-ratio knob.

### 2.3 Why MTF after BWT

MTF is the bridge between "runs of bytes" and "skewed integer distribution that Huffman loves." Without it, the BWT's runs would still need a run-aware coder; MTF converts run structure into a frequency skew that a standard entropy coder exploits directly. Modern variants sometimes replace MTF with direct run-length + range coding, but the classic `bzip2` chain is BWT → MTF → RLE → Huffman.

### 2.4 Decompression

Decompression reverses the chain: Huffman decode → un-RLE → inverse-MTF → **inverse BWT (LF-mapping)** → block. The inverse BWT is the `O(n)` LF walk from `middle.md`; `bzip2` stores the primary index (the row of the original rotation) so the inverse knows where to start. Correctness hinges on that index and on the per-block CRC matching.

---

## 3. Genomics Aligners: BWA and bowtie

Short-read alignment is the killer application. A sequencer emits hundreds of millions of short DNA reads (50–250 bases); each must be located in a reference genome of ~3 billion bases. Storing a suffix tree of the genome would need tens of gigabytes; the FM-index fits the **indexed, searchable** genome in a few gigabytes (often ~2–4 GB for human), small enough for a workstation.

### 3.1 The index

Both BWA and bowtie build an FM-index over the reference (and usually its reverse complement). The DNA alphabet is tiny (`A, C, G, T` plus `N` and `$`), so `σ ≈ 4`, which makes the rank structure compact and `Occ` extremely fast. Exact matches are found by the `O(m)` backward search of `middle.md`.

### 3.2 Inexact matching

Reads contain sequencing errors and biological variants, so aligners must tolerate **mismatches and gaps**. The trick: backward search becomes a **search tree**. At each pattern position you may (a) match the read base, or (b) substitute/insert/delete, branching the `[sp, ep)` range and accumulating a penalty, pruned by a bound on allowed differences. bowtie1 uses a backtracking FM-index search; BWA uses bounded-difference backward search; bowtie2 and BWA-MEM seed with exact FM-index matches (maximal exact matches) and then extend with Smith-Waterman (sibling alignment topics). The FM-index supplies the fast **seeding**; dynamic programming supplies the gapped **extension**.

### 3.3 Why the BWT/FM-index won genomics

- **Memory:** a few GB for an indexed human genome vs tens of GB for a suffix tree.
- **Speed:** `O(m)` exact seeding; small-alphabet rank is cache-friendly.
- **Reverse strand:** indexing the reverse complement lets one structure align both strands.
- **Locate sampling:** report genomic coordinates with a tunable space/time knob (Section 5).

The combination — compressed self-index + backward search + seed-and-extend — is what made aligning a full human resequencing run on commodity hardware routine.

### 3.4 The seed-and-extend workflow in detail

A modern aligner (BWA-MEM, bowtie2) processes each read roughly as:

1. **Seed.** Find maximal exact matches (MEMs) or fixed-length seeds of the read against the reference using FM-index backward search. Each seed is an exact substring with a small `[sp, ep)` range — cheap to count, located via the sampled SA.
2. **Chain.** Group seeds that are collinear (consistent genomic positions and read offsets) into candidate alignment regions, discarding spurious isolated seeds.
3. **Extend.** Run banded Smith-Waterman (sibling alignment topics) between seeds and at the read ends to produce a full gapped alignment with a score.
4. **Score and report.** Pick the best-scoring alignment(s), compute a mapping quality, and emit SAM/BAM.

The FM-index dominates step 1 (and the locate in it); dynamic programming dominates step 3. The split matters operationally: seeding is memory-bound on the index, extension is CPU-bound on the DP, so the two phases are tuned and parallelized differently.

### 3.5 Why index both strands

DNA is double-stranded; a read may originate from either strand. Aligners index the reference's **reverse complement** as well (or search the read's reverse complement against the forward index). This roughly doubles index size but is essential — omitting it silently fails to align half the reads. A bidirectional FM-index (Section 7.4) is a further refinement that lets a single structure extend matches in both directions for efficient MEM finding.

---

## 4. Wavelet Trees for Rank

The naive `Occ` table is `O(n·σ)` integers — unacceptable for large `σ` and merely wasteful for small. The **wavelet tree** is the standard production rank structure: it stores the BWT in `O(n log σ)` **bits** and answers `rank(c, i)` (= `Occ(c, i)`) in `O(log σ)` time, with `access` and `select` also supported.

### 4.1 Structure

A wavelet tree recursively partitions the alphabet. The root holds a bitvector marking, for each text position, whether its character falls in the lower or upper half of the alphabet; children recurse on each half. A `rank(c, i)` query walks `log σ` levels, doing one `O(1)` **bitvector rank** per level (constant-time rank on a bitvector is a classic succinct-structure result: store sampled cumulative popcounts plus a small lookup). For DNA (`σ = 4`) the tree is 2 levels deep, so rank is effectively `O(1)`.

### 4.2 Why it matters

The wavelet tree is what makes the FM-index a true *compressed* self-index: it is within a lower-order term of the text's entropy yet supports the rank queries that drive both LF-mapping and backward search. Alternatives include **sampled `Occ` blocks** (store cumulative counts every `b` positions, scan the remainder) which trade a slightly larger constant for simpler code — common in practice for `σ = 4` DNA, where a few precomputed checkpoint arrays beat a wavelet tree's overhead.

### 4.3 Choosing a rank representation

| Representation | Space | rank time | Best for |
|----------------|-------|-----------|----------|
| Plain `Occ` table | `O(n·σ)` ints | `O(1)` | tiny `σ`, ample memory |
| Sampled checkpoints | `O(n)` ints + scan | `O(b)` worst | DNA (`σ=4`), simple & fast |
| Wavelet tree | `O(n log σ)` bits | `O(log σ)` | large `σ`, compressed text |
| RRR / compressed bitvectors | entropy-bounded | `O(1)` | maximum compression |

### 4.4 A concrete DNA rank layout

For a genome with `σ = 4`, a common production choice is **two-level checkpoints**: store, every 64 positions, a cumulative count of each of the 4 symbols (a tiny 4-int record), and pack the BWT itself as 2 bits/base. `rank(c, i)` reads the nearest checkpoint and popcounts the at-most-64 packed bases between the checkpoint and `i`, masked to symbol `c`. The whole structure is `~2n` bits for the BWT plus `~(4·32·n/64)` bits for checkpoints — small enough to keep a human-genome index in a few GB. The checkpoint stride is tuned so a checkpoint record plus its scan window fits a cache line, making `rank` effectively `O(1)` with excellent locality. This is why DNA aligners often skip the wavelet tree entirely: at `σ = 4` the simpler checkpoint scheme wins on constants.

---

## 5. Sampling the Suffix Array for Locate

Backward search gives you the **range** `[sp, ep)` of matching rows — that is the **count**. To report **where** (text positions), you need `SA[i]` for `i ∈ [sp, ep)`. Storing the full suffix array defeats the FM-index's space advantage. The solution is **suffix-array sampling**.

### 5.1 The technique

Store `SA[i]` only for a sampled subset of rows (e.g. every position whose text offset is a multiple of `s`, or every `s`-th row). To locate an unsampled row `i`, repeatedly apply `LF` until you reach a sampled row after `t` steps; then the answer is `SA[sampled] + t`. Because each `LF` step moves one position backward in the text, `t < s`, so **locate costs `O(s)` per occurrence**. The sampled SA uses `O((n/s) log n)` bits.

```
locate(i):
    steps = 0
    while i is not sampled:
        i = LF(i)
        steps += 1
    return SA_sample[i] + steps
```

### 5.2 The space/time knob

`s` is the single most important tuning parameter for a locate-heavy workload:

- Small `s` → more samples → more memory, faster locate.
- Large `s` → fewer samples → less memory, slower locate.

Aligners pick `s` to balance index size against per-occurrence reporting cost. For counting-only workloads you can store **no** SA samples at all.

### 5.3 Sampling at run boundaries (r-index)

For the `r`-index (Section 6), samples are placed at **run boundaries** of the BWT, giving `O(r)` samples and `O(1)`-amortized locate per occurrence even when `r ≪ n`. This is the breakthrough that made locate efficient on highly repetitive collections.

### 5.4 Two sampling strategies

There are two natural ways to choose which SA values to keep:

- **Text-order sampling.** Store `SA[i]` whenever the text position `SA[i]` is a multiple of `s`. Guarantees `< s` LF steps to a sample (each LF moves one text position), so locate is `O(s)` worst case. Simpler to reason about.
- **BWT-order (suffix-order) sampling.** Store `SA[i]` for every `s`-th *row*. Simpler to build but gives weaker per-occurrence guarantees, since LF steps move by one text position regardless of row spacing.

Text-order sampling is the usual choice for predictable locate latency. For the `r`-index, sampling is at run boundaries (neither uniform scheme) so that the affine behavior of LF inside runs lets locate jump across whole runs. The senior decision is to match the sampling scheme to the locate-latency SLA and the data's repetitiveness.

---

## 6. Run-Length BWT and the r-index

For repetitive data — thousands of human genomes that differ by <1%, or every version of a source file — the BWT has very few runs `r` relative to `n`. Storing the BWT as runs (`(char, length)` pairs) is `O(r)` space.

### 6.1 The r-index

Gagie, Navarro, and Prezza's **`r`-index** supports the full FM-index interface — backward search `count` in `O(m log log n)` and `locate` in `O(occ + ...)` — in `O(r)` space, by cleverly sampling the SA at run boundaries so that locate can "jump" across runs. For a collection where `r` is thousands of times smaller than `n`, this is the difference between an index that fits in RAM and one that does not.

### 6.2 When to reach for it

| Data | `r/n` | Index choice |
|------|-------|--------------|
| Random / high-entropy text | `r/n ≈ 1` | plain FM-index (RLBWT no help) |
| Natural-language text | moderate | FM-index; RLBWT modest win |
| Many similar genomes / versions | `r/n ≪ 1` | **r-index** (huge win) |
| Single genome | moderate | FM-index with SA sampling |

The senior judgment is to **measure `r`** on your actual data before choosing. RLBWT/`r`-index pays off only when repetitiveness is real; on incompressible data it adds overhead for nothing.

### 6.3 Pangenome indexing

The motivating application is the **pangenome**: instead of one reference genome, index a collection representing population diversity (thousands of human genomes, or many bacterial strains). Concatenating them yields a huge but highly repetitive string — each genome differs from the reference by a fraction of a percent. The `r`-index (and relatives like the move-`r` index and grammar-based indexes) keeps the structure RAM-resident by exploiting that `r` scales with the number of *distinct variants*, not the total sequence length. This is an active research area; the practical takeaway for an engineer is that "index 1000 genomes" is feasible precisely because repetitiveness collapses `r`.

### 6.4 Building the RLBWT directly

Crucially, you do not build a full FM-index and then run-length it — that would need `O(n)` peak memory. Incremental builders (`ropebwt2`, BCR for read collections, `pfp`/prefix-free parsing for genomes) construct the run-length BWT **directly** in `O(r)`-ish working memory, never materializing the dense form. For a pangenome where `n` is hundreds of gigabases but `r` is small, this is the difference between buildable and not. Choosing a construction algorithm that produces the RLBWT natively is as important as choosing the index itself.

---

## 7. Memory and Layout Engineering

### 7.1 Alphabet mapping

Map the alphabet to dense integers `0..σ-1` so `C` is a length-`σ` array and rank structures index compactly. For DNA, pack `A,C,G,T` into 2 bits each; the genome's 3 billion bases fit in ~750 MB before any index overhead.

### 7.2 Cache behavior

Backward search's two `rank` calls per character are the hot path. With small `σ`, checkpoint arrays sized to fit L2/L3 cache dramatically cut latency. Lay out the BWT and checkpoints contiguously; random `LF` jumps during locate are cache-unfriendly, which is another reason to keep `s` (and thus locate work) small for hot queries.

### 7.3 Construction memory

Building the BWT needs a suffix array first. SA-IS builds the SA in `O(n)` time and `O(n)` space, but the constant matters: a naive `int32` SA of a 3 Gb genome is 12 GB. Production builders (e.g. `ropebwt2`, `bwa index`) build the BWT incrementally or in external memory to bound peak RAM, sometimes never materializing the full SA.

### 7.4 Bidirectional FM-index

Some aligners build a **bidirectional** FM-index (forward and backward) so they can extend a match in *either* direction — essential for efficient maximal-exact-match seeding. This roughly doubles index size but enables search strategies a unidirectional index cannot.

### 7.5 Serialization and warm starts

Building an index over a 3-gigabase genome takes minutes to hours; you build once and load many times. A production index format therefore needs: a versioned header (format version, alphabet map, `n`, `r`, sampling rate), the BWT and rank structures in a `mmap`-friendly layout so the OS pages them in on demand, and an integrity checksum. Memory-mapping lets multiple aligner processes share one read-only index in RAM rather than each loading its own copy — a major footprint win on multi-core servers running many alignment jobs. Rebuilding the index per run, or loading non-shared copies, is a classic scaling regression.

### 7.6 NUMA and cache considerations

On large servers the index may exceed a single NUMA node's memory. Random `LF` jumps during locate then incur cross-node latency. Mitigations: pin alignment threads to the node holding the index, replicate small hot structures (the `C` array, the top checkpoint level) per node, and keep the SA sampling rate small enough that locate walks stay short. These are the kinds of constant-factor concerns that dominate once the asymptotics (`O(m)` count) are fixed.

---

## 8. Code Examples

### 8.1 Python — FM-index with sampled suffix array for locate

```python
def suffix_array(s):
    return sorted(range(len(s)), key=lambda i: s[i:])


def build_index(text, sa_sample_rate=4):
    s = text + "$"
    n = len(s)
    sa = suffix_array(s)
    L = "".join(s[(sa[i] - 1) % n] for i in range(n))  # BWT
    chars = sorted(set(L))
    C, running = {}, 0
    for c in chars:
        C[c] = running
        running += L.count(c)
    occ = {c: [0] * (n + 1) for c in chars}
    for i, ch in enumerate(L):
        for c in chars:
            occ[c][i + 1] = occ[c][i] + (1 if ch == c else 0)
    # Sample SA: store SA[i] only where SA[i] % rate == 0.
    sample = {i: sa[i] for i in range(n) if sa[i] % sa_sample_rate == 0}
    return {"L": L, "C": C, "occ": occ, "n": n, "sample": sample}


def lf(idx, fm):
    c = fm["L"][idx]
    return fm["C"][c] + fm["occ"][c][idx]


def count(P, fm):
    sp, ep = 0, fm["n"]
    for c in reversed(P):
        if c not in fm["C"]:
            return (0, 0)
        sp = fm["C"][c] + fm["occ"][c][sp]
        ep = fm["C"][c] + fm["occ"][c][ep]
        if sp >= ep:
            return (0, 0)
    return (sp, ep)


def locate(P, fm):
    sp, ep = count(P, fm)
    positions = []
    for i in range(sp, ep):
        steps, idx = 0, i
        while idx not in fm["sample"]:
            idx = lf(idx, fm)
            steps += 1
        positions.append(fm["sample"][idx] + steps)
    return sorted(positions)


if __name__ == "__main__":
    fm = build_index("banana")
    print(count("ana", fm))   # (sp, ep) range; width 2
    print(locate("ana", fm))  # [1, 3] -> 'ana' starts at positions 1 and 3
```

### 8.2 Go — BWT from suffix array (the production forward method)

```go
package main

import (
	"fmt"
	"sort"
)

func suffixArray(s string) []int {
	n := len(s)
	sa := make([]int, n)
	for i := range sa {
		sa[i] = i
	}
	sort.Slice(sa, func(a, b int) bool { return s[sa[a]:] < s[sa[b]:] })
	return sa
}

func bwtFromSA(text string) string {
	s := text + "$"
	n := len(s)
	sa := suffixArray(s)
	out := make([]byte, n)
	for i := 0; i < n; i++ {
		out[i] = s[(sa[i]-1+n)%n]
	}
	return string(out)
}

func main() {
	fmt.Println(bwtFromSA("banana"))      // annb$aa
	fmt.Println(bwtFromSA("mississippi"))
}
```

### 8.3 Java — Move-To-Front encode/decode (the bzip2 bridge stage)

```java
import java.util.*;

public class MoveToFront {
    static int[] encode(byte[] data) {
        List<Integer> alphabet = new ArrayList<>();
        for (int i = 0; i < 256; i++) alphabet.add(i);
        int[] out = new int[data.length];
        for (int k = 0; k < data.length; k++) {
            int b = data[k] & 0xff;
            int idx = alphabet.indexOf(b);
            out[k] = idx;                 // emit current rank
            alphabet.remove(idx);
            alphabet.add(0, b);           // move to front
        }
        return out;
    }

    static byte[] decode(int[] codes) {
        List<Integer> alphabet = new ArrayList<>();
        for (int i = 0; i < 256; i++) alphabet.add(i);
        byte[] out = new byte[codes.length];
        for (int k = 0; k < codes.length; k++) {
            int idx = codes[k];
            int b = alphabet.get(idx);
            out[k] = (byte) b;
            alphabet.remove(idx);
            alphabet.add(0, b);
        }
        return out;
    }

    public static void main(String[] args) {
        byte[] in = "annb$aa".getBytes();
        int[] mtf = encode(in);
        System.out.println(Arrays.toString(mtf)); // many small / zero values after BWT
        System.out.println(new String(decode(mtf)));
    }
}
```

---

## 9. Observability and Testing

A BWT/FM-index result is opaque — one wrong rank looks like any other index. Build in checks from day one.

| Check | Why |
|-------|-----|
| Round-trip `inverse(forward(s)) == s` | Catches off-by-one in LF, `C`, or `Occ`. |
| BWT is a permutation of `s$` | `sorted(L) == sorted(s + "$")`; catches construction bugs. |
| Count vs brute-force substring scan | `count(P)` must equal a naive `s.count(P)` (overlapping) on small inputs. |
| Locate positions verified | Each reported position `p` must satisfy `s[p:p+m] == P`. |
| Exactly one `$` in `L` | Sentinel invariant; inversion depends on it. |
| `C[c]` monotone non-decreasing | `C` is a prefix sum of counts; a dip signals a bug. |
| SA-derived BWT == rotation BWT | Cross-check the fast method against the naive one for small `n`. |

The single most valuable test is the **round-trip**: forward then inverse must reproduce the input exactly. Combined with a brute-force `count` oracle, it catches the overwhelming majority of bugs.

### 9.0 Differential testing across implementations

When two independent BWT builders exist (e.g. an SA-based one and an incremental one), run both on the same inputs and assert byte-identical `L`. Because `L` is a deterministic function of the input (uniqueness, `professional.md` §11), any divergence is a bug in one of them. This **differential test** is especially valuable for the fast/memory-bounded builders whose correctness is hard to reason about directly: validate them against the simple rotation method on small inputs and against each other on large ones.

### 9.1 A property-test battery

```text
for random string s over a small alphabet (no '$'):
    L = bwt(s)
    assert sorted(L) == sorted(s + "$")          # permutation
    assert inverse_bwt(L) == s + "$"             # round trip
    assert L.count("$") == 1                      # one sentinel
    fm = build_index(s)
    for random pattern P (substring or not):
        sp, ep = count(P, fm)
        assert ep - sp == naive_overlap_count(s, P)
        for pos in locate(P, fm):
            assert s[pos:pos+len(P)] == P
```

### 9.2 Production guardrails

For a service answering search queries at scale: validate input bytes against the indexed alphabet (reject or map `N`/non-ACGT for DNA); assert the index's stored `n`, `r`, and sampling rate at load; log the locate `steps` distribution (a long tail signals a too-large sampling rate); and checksum the serialized index so a corrupt load fails loudly rather than returning wrong positions.

---

## 10. Failure Modes

### 10.1 Sentinel collision

The input already contains the sentinel byte, producing two `$`s and a non-invertible transform. Mitigation: reserve a byte outside the data alphabet (`\x00`) and validate, or store the primary index instead of relying on `$`.

### 10.2 Wrong `C` / off-by-one in `Occ`

`C[c]` must count chars **strictly less** than `c`; `Occ(c, i)` must count over `L[0..i-1]`, exclusive of `i`. Either error shifts every LF step and corrupts both inversion and search. Mitigation: the round-trip test plus the brute-force count oracle.

### 10.3 Non-ACGT bytes in genomics

Reads and references contain `N` (ambiguous base) and occasionally lowercase or IUPAC codes. An aligner that assumes `σ = 4` mis-indexes them. Mitigation: explicit alphabet mapping with a dedicated `N` symbol and a policy (skip, mask, or treat as mismatch).

### 10.4 Suffix-array construction blowup

Building the SA naively is `O(n² log n)` or needs `O(n)` ints (12 GB for a genome with `int32`). Mitigation: use SA-IS / DC3, or an incremental/external-memory BWT builder; never sort rotations at scale.

### 10.5 Over-large SA sampling rate

A huge `s` shrinks the index but makes `locate` walk many `LF` steps per occurrence; a locate-heavy workload then crawls. Mitigation: tune `s` from the measured locate-step distribution; use no SA samples for count-only services.

### 10.6 RLBWT on non-repetitive data

Choosing an `r`-index when `r ≈ n` adds run-encoding overhead with no compression benefit and slower constants. Mitigation: measure `r/n` on real data before selecting the structure.

### 10.7 Block-boundary effects in bzip2

Tiny blocks waste the BWT's context-grouping advantage; corrupt blocks (without CRC checks) silently produce garbage on inverse. Mitigation: use large blocks for ratio, keep per-block CRCs, and fail loudly on CRC mismatch.

### 10.8 Endianness / serialization drift

An FM-index built on one machine and loaded on another with different integer widths or endianness returns wrong positions. Mitigation: a versioned, endianness-explicit serialization format with a header checksum and an alphabet/`n`/`r` manifest.

### 10.9 Rank checkpoint stride mismatch

A checkpoint stride tuned for one CPU's cache line may thrash on another (or after a data-layout change), turning "effectively `O(1)`" rank into a cache-miss per query. Symptom: search latency that degrades on a new machine despite identical asymptotics. Mitigation: make the stride a build-time parameter recorded in the header, and benchmark rank latency as part of index acceptance.

### 10.10 Off-by-one between count range and locate

Backward search returns a half-open `[sp, ep)`; iterating it as `[sp, ep]` reports a phantom occurrence, and `[sp+1, ep)` drops a real one. Symptom: occurrence counts off by exactly one, intermittently. Mitigation: the locate-verification guardrail (every reported `p` must satisfy `s[p:p+m] == P`) catches phantom positions immediately; a count that disagrees with the range width catches the dropped one.

---

## 11. Summary

- The BWT itself compresses nothing; it **reorders** bytes into runs so a downstream pipeline can compress them. `bzip2` is the canonical chain: **BWT → MTF → RLE → Huffman**, applied per block, with a stored primary index and per-block CRC for the LF-mapping inverse.
- In genomics, the **FM-index** over a reference genome (small DNA alphabet `σ ≈ 4`) gives `O(m)` exact seeding; **BWA/bowtie** layer mismatch/gap search (backtracking or seed-and-extend with Smith-Waterman) on top. The index fits an indexed human genome in a few GB versus tens of GB for a suffix tree.
- **Rank** (`Occ`) is the hot primitive. Use **wavelet trees** (`O(n log σ)` bits, `O(log σ)` rank) for large alphabets, or **sampled checkpoints** for DNA. The choice is the central space/speed lever for the index.
- **Locate** needs the suffix array; **sample** it at rate `s` so locate costs `O(s)` per occurrence in `O((n/s) log n)` bits — tune `s` to the workload, or skip samples entirely for count-only.
- For **repetitive collections**, the **run-length BWT / r-index** stores the FM-index in `O(r)` space (`r` = number of BWT runs), enabling RAM-resident indexes over thousands of genomes — but only when `r ≪ n`, which you must measure.
- Engineering levers: dense alphabet mapping, cache-resident checkpoints, SA-IS / external-memory construction, and optionally a bidirectional index for two-way seeding.
- Always keep a **round-trip test** and a **brute-force count oracle**; together they catch the off-by-one in `C`/`Occ`, the sentinel collision, and the SA-vs-rotation mismatch that account for nearly every real bug.
- **Differential-test** independent builders against each other (`L` is deterministic), and verify every located position with a direct substring compare.
- The BWT's lasting impact is as a **compressed self-index** (FM-index) for genomics and full-text search, more than as a general-purpose compressor — choose it accordingly.

### Decision summary

- **Compress general files** → BWT pipeline (`bzip2`): large blocks, CRC, MTF+RLE+Huffman.
- **Align short reads to a genome** → FM-index seeding + DP extension; small `σ`, sampled checkpoints, bidirectional index for MEMs.
- **Index many similar genomes** → r-index (`O(r)` space) — after confirming `r ≪ n`.
- **Count-only search** → FM-index with no SA samples.
- **Locate-heavy search** → small SA sampling rate `s`; measure the locate-step tail.
- **Build at scale** → SA-IS / incremental / external-memory BWT; never sort rotations.
- **Multi-process serving** → memory-map a shared read-only index; never load per-process copies.
- **New target machine** → re-benchmark rank latency; the checkpoint stride and endianness must be validated, not assumed.

### Operational checklist

Before shipping a BWT/FM-index service, confirm:

1. Round-trip and brute-force count tests pass in CI on every build.
2. The serialized index has a versioned header, alphabet manifest, and checksum.
3. Locate verification (`s[p:p+m] == P`) is enabled in staging.
4. `r/n` was measured to justify (or rule out) the run-length representation.
5. The SA sampling rate is set from the measured locate-step distribution, not guessed.
6. The index is memory-mapped and shared across worker processes.
7. Non-alphabet bytes (`N`, lowercase, IUPAC) have an explicit handling policy.

References to study further: Burrows-Wheeler (1994) original report; Ferragina-Manzini (2000) opportunistic FM-index; Grossi-Gupta-Vitter wavelet trees; Gagie-Navarro-Prezza `r`-index; Li-Durbin (BWA) and Langmead et al. (bowtie); Nong-Zhang-Chan SA-IS; and sibling topics `04-suffix-array` and `09-suffix-automaton`.
