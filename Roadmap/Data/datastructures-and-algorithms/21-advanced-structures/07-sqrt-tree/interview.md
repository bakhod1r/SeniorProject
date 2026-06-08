# Sqrt Tree — Interview Preparation

> **Read time: ~45 minutes** · **Audience:** Candidates preparing for interviews where Sqrt Tree (or the broader "static O(1) range query for non-idempotent ops") is the elegant answer. Includes ~45 tiered Q&A and a full coding challenge in Go, Java, and Python.

The single most important sentence to be able to say in an interview: *"A Sqrt Tree answers range queries on any **associative** operation in **O(1)** after **O(n log log n)** build — including non-idempotent ops like sum, product, and xor that a sparse table cannot handle."* Everything below builds the depth to back that up.

---

## Table of Contents

1. [Junior Questions (1–12)](#junior)
2. [Middle Questions (13–26)](#middle)
3. [Senior Questions (27–38)](#senior)
4. [Professional Questions (39–45)](#professional)
5. [Coding Challenge — Build a Sqrt Tree](#challenge)
6. [Rapid-Fire Cheat Answers](#rapid)

---

<a name="junior"></a>
## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What problem does a Sqrt Tree solve? | Static range queries `op(arr[l..r])` for any associative op, O(1) per query. |
| 2 | What is the query complexity? | O(1) — at most three precomputed lookups, two combines. |
| 3 | What is the build complexity? | O(n log log n) time and space. |
| 4 | What three tables does each layer store? | prefix (per block), suffix (per block), between (over whole blocks). |
| 5 | How is a spanning query answered? | `op(suffix of l's block, between middle blocks, prefix of r's block)`. |
| 6 | How is a within-block query answered? | Recurse into that block's own sub-tree (next layer). |
| 7 | Why "sqrt"? | Each layer splits its segment into ~√(size) blocks of size ~√(size). |
| 8 | What op property is required? | Associativity. (Idempotence is **not** required.) |
| 9 | Name three ops a sparse table can't do but Sqrt Tree can. | sum, product, xor (also matrix product). |
| 10 | What is the update complexity? | O(√n) point update. |
| 11 | When is the three-piece trick NOT used? | When `l` and `r` are in the same block — then recurse. |
| 12 | What does the between table store? | The combined `op` over a contiguous run of *whole* blocks. |

**Q1 — model answer.** "Given a fixed array and an associative operation, a Sqrt Tree precomputes prefix, suffix, and between-block aggregates, so any range query combines at most three precomputed pieces in O(1). It works for *any* associative op, which is its edge over a sparse table."

**Q5 — model answer.** "Split `[l, r]` into three disjoint runs: the rest of `l`'s block (a stored suffix), the whole blocks in the middle (a between-table lookup), and the start of `r`'s block up to `r` (a stored prefix). Combine the three with `op`. They tile the range exactly once, so associativity makes it correct."

**Q8 — model answer.** "Only associativity. The three pieces don't overlap, so we never double-count, so we don't need `op(x,x)=x`. That is exactly why sum and product work here but not in a sparse table, whose two windows overlap."

---

<a name="middle"></a>
## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | Why is the recursion depth log log n, not log n? | Each layer square-roots the size (halves the bit-length); reaches constant in log log n steps. |
| 14 | Why does sparse table need idempotence but Sqrt Tree doesn't? | Sparse table's two windows overlap; Sqrt Tree's three pieces are disjoint. |
| 15 | Compare Sqrt Tree vs segment tree (query/update/build). | O(1)/O(√n)/O(n loglog n) vs O(log n)/O(log n)/O(n). |
| 16 | Compare Sqrt Tree vs sparse table (memory). | O(n log log n) vs O(n log n) — Sqrt Tree uses less. |
| 17 | When would you pick a segment tree over a Sqrt Tree? | Frequent updates (O(log n) vs O(√n)). |
| 18 | When pick a sparse table over a Sqrt Tree? | Idempotent op (min/max/gcd) — simpler, same O(1). |
| 19 | Why is each build layer O(n)? | prefix/suffix touch each position once; between is O(B²)=O(len) per segment summed to O(n). |
| 20 | What is the danger in the between table size? | Naive n×n is O(n²); correct is √n×√n=n per segment. |
| 21 | Is the O(1) query amortized or worst-case? | Worst-case, via an `onLayer` lookup that picks the separating layer in O(1). |
| 22 | Give a real use case for range matrix product. | Range evaluation of linear recurrences; only Sqrt Tree (of O(1) options) supports it. |
| 23 | How do you return the index of the min, not the value? | Store (value, index) and define op to keep the better pair. |
| 24 | What is the crossover where Sqrt Tree beats a segment tree end-to-end? | When queries ≳ n·loglog n / log n (≈ 200k for n=10^6). |
| 25 | Why can't a prefix-product array replace Sqrt Tree for range product? | Zeros / no modular inverse break division; Sqrt Tree never divides. |
| 26 | What changes if the op is non-associative (e.g., subtraction)? | Nothing in this family works; regrouping is invalid. |

**Q13 — model answer.** "Block size goes `n → √n → n^{1/4} → ...`, so the exponent halves each layer. It hits a constant after log₂(log₂ n) layers — about 4–5 for n=10⁶. That tiny depth is why a query is effectively O(1) and the build is O(n log log n) instead of O(n log n)."

**Q14 — model answer.** "Sparse table covers `[l,r]` with two length-2^k windows that overlap in the middle, so combining them double-counts — only harmless if `op(x,x)=x`. Sqrt Tree partitions `[l,r]` into suffix + whole-middle-blocks + prefix, which are disjoint, so no double-counting and only associativity is needed."

**Q24 — model answer.** "Total time is `build + Q·query`. Sqrt Tree is `O(n loglog n) + Q·O(1)`, segment tree is `O(n) + Q·O(log n)`. Setting them equal, Sqrt Tree wins once `Q > n·loglog n/log n`, roughly 200k queries for n=10⁶."

**Q19 — model answer.** "Prefix and suffix touch every array position exactly once per layer, so O(n). The between table for a segment of length `len` has about `√len × √len = len` cells, each filled in O(1) by extending the previous, and the segment lengths across a layer sum to n — so the between table is also O(n) per layer. Total per layer O(n)."

**Q25 — model answer.** "A prefix-product array answers `product(l..r) = total[r+1] / total[l]`, which needs division. If any element is 0 you can't divide it back out, and under a modulus there may be no inverse. Sqrt Tree composes products forward with the between/prefix/suffix tables and never divides, so zeros and non-invertible moduli are fine."

---

<a name="senior"></a>
## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 27 | Walk through an O(√n) point update. | Rebuild only i's block per layer (prefix/suffix + between row/col); costs telescope to O(√n). |
| 28 | Estimate memory for n=10^6, 8-byte values. | ~40–60 MB (≈ 15n cells); less than sparse table's ~160 MB. |
| 29 | How do you serve Sqrt Tree queries at scale? | Build-once per stateless replica from an immutable snapshot; O(1) queries need no coordination. |
| 30 | How do you handle very large n that won't fit one node? | Shard by index range; combine cross-shard partials with op (associative ⇒ correct). |
| 31 | How do you refresh data without O(√n) updates? | Blue-green: build a new tree off-side, atomically swap the pointer. |
| 32 | Why might a segment tree beat Sqrt Tree on small n despite worse asymptotics? | Cheaper build, fits in cache; few queries don't amortize the build. |
| 33 | What's the cache-behavior argument for Sqrt Tree? | Query = O(1) cache misses (≤3 lines) vs segment tree's O(log n) misses. |
| 34 | What metric tells you you've outgrown Sqrt Tree? | update_rate > queries/√n ⇒ switch to a segment tree. |
| 35 | How do you make queries thread-safe with updates? | RWMutex: many concurrent O(1) readers, exclusive O(√n) writer. |
| 36 | What's the #1 memory bug to avoid? | An n×n between table (O(n²)); must be O(n) per layer. |
| 37 | How do batched updates change the cost picture? | Coalesce dirty-block rebuilds; one O(√n) rebuild per query-epoch instead of per update. |
| 38 | Decouple call sites from the structure choice — how? | A `RangeAgg` interface; a factory picks Sqrt Tree / segment tree / sparse table by workload. |

**Q27 — model answer.** "Changing `arr[i]` only affects i's block at each layer. At layer 0 that block is size √n, so recomputing its prefix, suffix, and the between row/column for it is O(√n). Deeper layers have geometrically smaller blocks, so the series O(√n)+O(n^{1/4})+... sums to O(√n). Other blocks are untouched."

**Q28 — model answer.** "Roughly 15n cells: per layer a prefix array (n), a suffix array (n), and a between table that sums to ~n; times ~5 layers for n=10⁶. At 8 bytes each that's on the order of 40–60 MB after sensible allocation — clearly under a sparse table's ~160 MB, and the reason you'd accept Sqrt Tree's extra code over a sparse table when n is large."

**Q37 — model answer.** "If many updates hit the same block before any query, don't rebuild it each time. Mark the block dirty and rebuild it once — O(√n) — at the next query that reads it. Across u updates and q queries the dirty rebuilds total O((u+q)·√n), so updates stay amortized O(√n) and queries stay O(1) even under bursty clustered updates."

**Q33 — model answer.** "A query reads three compact, often-adjacent cells — O(1) cache misses regardless of n. A segment tree descends ~log n nodes on poorly-localized lines — O(log n) misses. At large n that memory-hierarchy difference is a real, measurable speedup beyond the instruction-count argument."

**Q30 — model answer.** "Shard the array into contiguous index ranges, one Sqrt Tree per shard. A query `[l, r]` that spans shards becomes a few per-shard sub-queries (each O(1) locally) plus a coordinator-side combine with `op`. Because `op` is associative, merging the disjoint partial results is correct — it's the same disjoint-pieces logic as the between table, lifted to the cluster."

**Q31 — model answer.** "Don't pay O(√n) per update for a bulk refresh. Build a brand-new tree from the new snapshot off to the side, then atomically swap the pointer readers use (blue-green). Readers see only a fully-built tree; no half-updated state is ever visible."

---

### Traps interviewers like to set

| Trap | The right reaction |
|---|---|
| "Use a sparse table for range sum." | Stop — sparse table needs idempotence; sum double-counts the overlap. Use Sqrt Tree (O(1)) or a prefix array. |
| "It's O(log log n) per query, right?" | No — it's worst-case O(1) via the `onLayer` lookup; only the naive descent variant is O(log log n). |
| "The between table is n×n, so O(n²) space." | No — it's `√n × √n = n` per segment, O(n) per layer, O(n log log n) total. |
| "Just rebuild the whole tree on each update." | That's O(n log log n); the correct point update is O(√n) (rebuild only i's block per layer). |
| "It beats a segment tree always." | Only when queries dominate and n is large; for few queries or many updates, segment tree wins. |
| "Average works (sum/count)." | Average isn't associative; no structure in this family applies directly. |

---

<a name="professional"></a>
## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 39 | State the algebraic requirement formally. | `(M, ⊕)` is a semigroup: ⊕ associative. No identity, no idempotence needed. |
| 40 | Prove the spanning-query correctness. | R1 ⊎ R2 ⊎ R3 = [l,r] disjoint; generalized associativity ⇒ equals Q(l,r). |
| 41 | Prove the depth is Θ(log log n). | b_{t+1}=⌈b_t/2⌉, b_0=⌈log₂ n⌉ ⇒ D=⌈log₂ b_0⌉=Θ(log log n). |
| 42 | Prove build is O(n log log n). | Each layer O(n) (between is O(B²)=O(len)/segment summed to O(n)); × Θ(log log n) layers. |
| 43 | Prove the query is worst-case O(1). | `onLayer[msb(l⊕r)]` selects the layer in O(1); ≤3 reads, ≤2 combines. |
| 44 | Why isn't Sqrt Tree space-optimal? | Theoretical frontier for static semigroup RMQ is ~O(n α(n)); idempotent case has O(n) (Fischer–Heun). |
| 45 | State the dynamic lower bound it's far from. | Cell-probe: t_query·t_update = Ω(log n) for group range-sum; Sqrt Tree's product is O(√n), static-leaning. |

**Q40 — model answer.** "Let `l ∈ G_p`, `r ∈ G_q`, `p<q`. Then `[l,r]` splits into R1=[l, p_hi] (suffix), R2=whole blocks p+1..q-1 (between), R3=[q_lo, r] (prefix). These are disjoint and union to `[l,r]` in order. Generalized associativity says the product is parenthesization-independent, so `Q(l,r) = suf[l] ⊕ bet[p+1][q-1] ⊕ pref[r]`. No element repeats, so idempotence is irrelevant — only associativity is used."

**Q42 — model answer.** "Per layer: prefix and suffix touch each of the n positions once (O(n)); the between table for a segment of length len has B(B+1)/2 = O(B²)=O(len) cells filled in O(1) each, and segment lengths sum to n, so O(n). Each layer is O(n); with Θ(log log n) layers, total is O(n log log n). Space follows identically."

**Q41 — model answer.** "The block size square-roots each layer, which means the *bit-length* of the size halves: `b_{t+1} = ⌈b_t/2⌉` with `b_0 = ⌈log₂ n⌉`. Halving from `b_0` reaches 1 in `⌈log₂ b_0⌉` steps, so the depth is `⌈log₂⌈log₂ n⌉⌉ = Θ(log log n)`. For n=10⁶, b_0≈20 and depth = ⌈log₂ 20⌉ = 5."

**Q43 — model answer.** "Two indices fall in different blocks of bit-length-b geometry iff they differ in a bit ≥ ⌈b/2⌉. So `h = msb(l XOR r)` (one CLZ instruction) determines the separating layer, read from a precomputed `onLayer[h]` table in O(1). Then it's a couple of shifts to get the block indices and at most three reads plus two combines — all O(1), worst case, independent of the range length."

**Q44 — model answer.** "For static range-semigroup queries in the arithmetic model, the theoretical space frontier for O(1) queries is closer to O(n·α(n)) (inverse Ackermann), and for the idempotent case Fischer–Heun gives O(n) space with O(1) query. Sqrt Tree's O(n log log n) is neither — it's a simple, practical point that beats sparse table's O(n log n) and uniquely handles non-idempotent semigroups in O(1), which the optimal idempotent structures don't."

---

<a name="challenge"></a>
## Coding Challenge — Build a Sqrt Tree

> **Task.** Implement a Sqrt Tree supporting `op(arr[l..r])` in O(1) for an arbitrary associative op, with O(n log log n) build. Demonstrate it on **sum** (a non-idempotent op a sparse table cannot handle). Validate against brute force.
>
> Required: pass `query(l, r) == sum(arr[l..r])` for all `0 ≤ l ≤ r < n`.

**Design notes before you code:**
- Carry `layers[]` = the bit-length per layer (`b₀ = ⌈log₂ n⌉`, then halve until ≤ 1). The number of entries is the depth, Θ(log log n).
- Per layer, `bShift = (bitLength + 1) >> 1` and `blk = 1 << bShift` give the block size.
- Store `pref` and `suf` as one value per array position per layer; store `between` flattened as `bet[base_i * stride + base_j]` for cache locality.
- The query: if `l, r` are in different blocks of this layer, combine `op(suf[l], bet[mid], pref[r])` (drop `bet` when blocks are adjacent); otherwise recurse into the shared block, bottoming out in a direct scan.
- Special-case `l == r` to return `arr[l]` immediately.

### Go

```go
package main

import (
	"fmt"
	"math/bits"
)

type SqrtTree struct {
	n      int
	op     func(a, b int) int
	v      []int
	layers []int     // bit-length per layer
	pref   [][]int
	suf    [][]int
	bet    [][]int   // flattened between table per layer
	stride []int
}

func New(arr []int, op func(a, b int) int) *SqrtTree {
	n := len(arr)
	t := &SqrtTree{n: n, op: op, v: append([]int{}, arr...)}
	if n <= 1 {
		return t
	}
	lg := bits.Len(uint(n - 1))
	for cur := lg; cur > 1; cur = (cur + 1) >> 1 {
		t.layers = append(t.layers, cur)
	}
	d := len(t.layers)
	t.pref = make([][]int, d)
	t.suf = make([][]int, d)
	t.bet = make([][]int, d)
	t.stride = make([]int, d)
	for i := 0; i < d; i++ {
		t.pref[i] = make([]int, n)
		t.suf[i] = make([]int, n)
	}
	t.build(0, 0, n-1)
	return t
}

func (t *SqrtTree) build(layer, lo, hi int) {
	if layer >= len(t.layers) {
		return
	}
	bShift := (t.layers[layer] + 1) >> 1
	blk := 1 << uint(bShift)
	nb := (hi-lo)/blk + 1
	if t.bet[layer] == nil {
		t.stride[layer] = (t.n / blk) + 2
		t.bet[layer] = make([]int, (t.stride[layer])*(t.stride[layer]))
	}
	base := lo / blk
	stride := t.stride[layer]
	for b := 0; b < nb; b++ {
		l := lo + b*blk
		r := min(l+blk-1, hi)
		t.pref[layer][l] = t.v[l]
		for j := l + 1; j <= r; j++ {
			t.pref[layer][j] = t.op(t.pref[layer][j-1], t.v[j])
		}
		t.suf[layer][r] = t.v[r]
		for j := r - 1; j >= l; j-- {
			t.suf[layer][j] = t.op(t.v[j], t.suf[layer][j+1])
		}
	}
	for i := 0; i < nb; i++ {
		acc := 0
		first := true
		for j := i; j < nb; j++ {
			agg := t.suf[layer][lo+j*blk]
			if first {
				acc = agg
				first = false
			} else {
				acc = t.op(acc, agg)
			}
			t.bet[layer][(base+i)*stride+(base+j)] = acc
		}
	}
	for b := 0; b < nb; b++ {
		l := lo + b*blk
		r := min(l+blk-1, hi)
		t.build(layer+1, l, r)
	}
}

func (t *SqrtTree) Query(l, r int) int {
	if l == r {
		return t.v[l]
	}
	return t.query(0, 0, t.n-1, l, r)
}

func (t *SqrtTree) query(layer, lo, hi, l, r int) int {
	bShift := (t.layers[layer] + 1) >> 1
	blk := 1 << uint(bShift)
	bl := (l - lo) / blk
	br := (r - lo) / blk
	if bl == br {
		blockLo := lo + bl*blk
		blockHi := min(blockLo+blk-1, hi)
		if layer+1 >= len(t.layers) {
			acc := t.v[l]
			for i := l + 1; i <= r; i++ {
				acc = t.op(acc, t.v[i])
			}
			return acc
		}
		return t.query(layer+1, blockLo, blockHi, l, r)
	}
	base := lo / blk
	stride := t.stride[layer]
	if br-bl > 1 {
		mid := t.bet[layer][(base+bl+1)*stride+(base+br-1)]
		return t.op(t.suf[layer][l], t.op(mid, t.pref[layer][r]))
	}
	return t.op(t.suf[layer][l], t.pref[layer][r])
}

func min(a, b int) int { if a < b { return a }; return b }

func main() {
	arr := []int{1, 3, 2, 7, 9, 11, 6, 4, 5, 1, 8, 2, 10, 3, 7, 5}
	st := New(arr, func(a, b int) int { return a + b })
	// brute-force validation
	ok := true
	for l := 0; l < len(arr); l++ {
		s := 0
		for r := l; r < len(arr); r++ {
			s += arr[r]
			if st.Query(l, r) != s {
				ok = false
			}
		}
	}
	fmt.Println("all sum queries correct:", ok) // true
	fmt.Println(st.Query(2, 13))                // 68
}
```

### Java

```java
import java.util.*;
import java.util.function.IntBinaryOperator;

public class SqrtTree {
    final int n;
    final IntBinaryOperator op;
    final int[] v;
    int[] layers;
    int[][] pref, suf, bet;
    int[] stride;

    public SqrtTree(int[] arr, IntBinaryOperator op) {
        this.n = arr.length;
        this.op = op;
        this.v = arr.clone();
        if (n <= 1) return;
        int lg = 32 - Integer.numberOfLeadingZeros(Math.max(1, n - 1));
        List<Integer> ls = new ArrayList<>();
        for (int cur = lg; cur > 1; cur = (cur + 1) >> 1) ls.add(cur);
        layers = ls.stream().mapToInt(Integer::intValue).toArray();
        int d = layers.length;
        pref = new int[d][n]; suf = new int[d][n];
        bet = new int[d][]; stride = new int[d];
        build(0, 0, n - 1);
    }

    void build(int layer, int lo, int hi) {
        if (layer >= layers.length) return;
        int bShift = (layers[layer] + 1) >> 1, blk = 1 << bShift;
        int nb = (hi - lo) / blk + 1;
        if (bet[layer] == null) {
            stride[layer] = (n / blk) + 2;
            bet[layer] = new int[stride[layer] * stride[layer]];
        }
        int base = lo / blk, str = stride[layer];
        for (int b = 0; b < nb; b++) {
            int l = lo + b * blk, r = Math.min(l + blk - 1, hi);
            pref[layer][l] = v[l];
            for (int j = l + 1; j <= r; j++) pref[layer][j] = op.applyAsInt(pref[layer][j - 1], v[j]);
            suf[layer][r] = v[r];
            for (int j = r - 1; j >= l; j--) suf[layer][j] = op.applyAsInt(v[j], suf[layer][j + 1]);
        }
        for (int i = 0; i < nb; i++) {
            int acc = 0; boolean first = true;
            for (int j = i; j < nb; j++) {
                int agg = suf[layer][lo + j * blk];
                acc = first ? agg : op.applyAsInt(acc, agg); first = false;
                bet[layer][(base + i) * str + (base + j)] = acc;
            }
        }
        for (int b = 0; b < nb; b++) {
            int l = lo + b * blk, r = Math.min(l + blk - 1, hi);
            build(layer + 1, l, r);
        }
    }

    public int query(int l, int r) {
        if (l == r) return v[l];
        return query(0, 0, n - 1, l, r);
    }

    int query(int layer, int lo, int hi, int l, int r) {
        int bShift = (layers[layer] + 1) >> 1, blk = 1 << bShift;
        int bl = (l - lo) / blk, br = (r - lo) / blk;
        if (bl == br) {
            int blockLo = lo + bl * blk, blockHi = Math.min(blockLo + blk - 1, hi);
            if (layer + 1 >= layers.length) {
                int acc = v[l];
                for (int i = l + 1; i <= r; i++) acc = op.applyAsInt(acc, v[i]);
                return acc;
            }
            return query(layer + 1, blockLo, blockHi, l, r);
        }
        int base = lo / blk, str = stride[layer];
        if (br - bl > 1) {
            int mid = bet[layer][(base + bl + 1) * str + (base + br - 1)];
            return op.applyAsInt(suf[layer][l], op.applyAsInt(mid, pref[layer][r]));
        }
        return op.applyAsInt(suf[layer][l], pref[layer][r]);
    }

    public static void main(String[] args) {
        int[] arr = {1, 3, 2, 7, 9, 11, 6, 4, 5, 1, 8, 2, 10, 3, 7, 5};
        SqrtTree st = new SqrtTree(arr, Integer::sum);
        boolean ok = true;
        for (int l = 0; l < arr.length; l++) {
            int s = 0;
            for (int r = l; r < arr.length; r++) {
                s += arr[r];
                if (st.query(l, r) != s) ok = false;
            }
        }
        System.out.println("all sum queries correct: " + ok); // true
        System.out.println(st.query(2, 13));                  // 68
    }
}
```

### Python

```python
class SqrtTree:
    def __init__(self, arr, op):
        self.v = list(arr); self.op = op; self.n = len(arr)
        if self.n <= 1:
            self.layers = []; return
        lg = (self.n - 1).bit_length()
        self.layers = []
        cur = lg
        while cur > 1:
            self.layers.append(cur); cur = (cur + 1) >> 1
        d = len(self.layers)
        self.pref = [[0] * self.n for _ in range(d)]
        self.suf = [[0] * self.n for _ in range(d)]
        self.bet = [dict() for _ in range(d)]
        self._build(0, 0, self.n - 1)

    def _build(self, layer, lo, hi):
        if layer >= len(self.layers):
            return
        bshift = (self.layers[layer] + 1) >> 1
        blk = 1 << bshift
        op = self.op
        starts = list(range(lo, hi + 1, blk))
        for l in starts:
            r = min(l + blk - 1, hi)
            self.pref[layer][l] = self.v[l]
            for j in range(l + 1, r + 1):
                self.pref[layer][j] = op(self.pref[layer][j - 1], self.v[j])
            self.suf[layer][r] = self.v[r]
            for j in range(r - 1, l - 1, -1):
                self.suf[layer][j] = op(self.v[j], self.suf[layer][j + 1])
        bw = self.bet[layer]
        for ii in range(len(starts)):
            acc = None
            for jj in range(ii, len(starts)):
                agg = self.suf[layer][starts[jj]]
                acc = agg if acc is None else op(acc, agg)
                bw[(ii, jj)] = acc
        for l in starts:
            r = min(l + blk - 1, hi)
            self._build(layer + 1, l, r)

    def query(self, l, r):
        if l == r:
            return self.v[l]
        return self._query(0, 0, self.n - 1, l, r)

    def _query(self, layer, lo, hi, l, r):
        bshift = (self.layers[layer] + 1) >> 1
        blk = 1 << bshift
        op = self.op
        bl = (l - lo) // blk
        br = (r - lo) // blk
        if bl == br:
            block_lo = lo + bl * blk
            block_hi = min(block_lo + blk - 1, hi)
            if layer + 1 >= len(self.layers):
                acc = self.v[l]
                for i in range(l + 1, r + 1):
                    acc = op(acc, self.v[i])
                return acc
            return self._query(layer + 1, block_lo, block_hi, l, r)
        ans = op(self.suf[layer][l], self.pref[layer][r])
        if br - bl > 1:
            mid = self.bet[layer][(bl + 1, br - 1)]
            ans = op(self.suf[layer][l], op(mid, self.pref[layer][r]))
        return ans


if __name__ == "__main__":
    arr = [1, 3, 2, 7, 9, 11, 6, 4, 5, 1, 8, 2, 10, 3, 7, 5]
    st = SqrtTree(arr, lambda a, b: a + b)
    ok = all(
        st.query(l, r) == sum(arr[l:r + 1])
        for l in range(len(arr)) for r in range(l, len(arr))
    )
    print("all sum queries correct:", ok)  # True
    print(st.query(2, 13))                  # 68
```

**Follow-up the interviewer may ask:**
- *"Make it work for range product mod 1e9+7."* → pass `lambda a, b: a * b % MOD` (or the Go/Java equivalent). No structural change — that is the point.
- *"What if updates are needed?"* → describe the O(√n) point update (rebuild i's block per layer) and note a segment tree is better if updates are frequent.
- *"Why not a sparse table?"* → it cannot do sum/product (non-idempotent overlapping windows double-count).

---

<a name="rapid"></a>
## Rapid-Fire Cheat Answers

- **Query:** O(1). **Build:** O(n log log n). **Space:** O(n log log n). **Update:** O(√n).
- **Requirement:** associativity (NOT idempotence).
- **Spanning query:** `op(suffix, between, prefix)` — three disjoint pieces.
- **Within-block query:** recurse a layer down.
- **Depth:** log log n (each layer square-roots the size).
- **Edge over sparse table:** handles sum/product/xor/matrix (non-idempotent).
- **Edge over segment tree:** O(1) query (vs O(log n)); fewer cache misses.
- **Weakness:** O(√n) updates; more code than alternatives.
- **Memory bug to avoid:** between table must be O(n)/layer, never O(n²).
- **Pick it when:** static array, non-idempotent associative op, query-dominant, large n.
- **Crossover vs segment tree:** ~`n·loglog n/log n` queries (≈ 200k for n=10⁶).
- **Cache argument:** O(1) cache misses per query vs a segment tree's O(log n).
- **Refresh trick:** blue-green rebuild + atomic pointer swap instead of O(√n) updates.

---

## Further Reading

- **One-line pitch to memorize:** "O(1) range queries for any *associative* op — including sum/product/xor that sparse tables can't — after O(n log log n) build, with O(√n) point updates."
- CP-Algorithms — *Sqrt Tree* (the canonical implementation).
- This roadmap: `09-trees/12-sparse-table-rmq` (idempotent O(1)), `09-trees/13-sqrt-decomposition-mos-algorithm` (the flat O(√n) idea), `09-trees/06-segment-tree` (O(log n) with cheap updates).
- Continue with `tasks.md` for hands-on practice.
