# Huffman Coding — Interview Preparation

> Tiered question bank (junior → middle → senior → professional/theory → behavioral) plus coding challenges in Go, Java, and Python.
> Core facts to hold ready: greedy merge of the two smallest via a **min-heap**, **prefix-free** property from leaf placement, optimality by **exchange + induction**, the entropy band `H ≤ L < H + 1`, **canonical** Huffman ships lengths only, and real use in **DEFLATE/JPEG**.

## Table of Contents

1. [Quick-Reference Cheat Sheet](#quick-reference-cheat-sheet)
2. [Junior Questions (12 Q&A)](#junior-questions-12-qa)
3. [Middle Questions (12 Q&A)](#middle-questions-12-qa)
4. [Senior Questions (10 Q&A)](#senior-questions-10-qa)
5. [Professional / Theory Questions (8 Q&A)](#professional--theory-questions-8-qa)
6. [Behavioral Questions (5)](#behavioral-questions-5)
7. [Coding Challenges](#coding-challenges)
8. [Common Pitfalls](#common-pitfalls)

---

## Quick-Reference Cheat Sheet

```
GOAL:      shortest prefix-free binary code for given symbol frequencies
ENGINE:    min-heap; pop two smallest, merge (sum freq), push; n-1 times
TREE:      symbols at leaves; left=0, right=1; path = codeword; depth = length
OPTIMAL:   greedy-choice (two lightest are deepest siblings) + optimal substructure
BUILD:     O(n log n) unsorted; O(n) if weights pre-sorted (two-queue)
WPL:       Σ freq(s)·len(s)   ← minimized
ENTROPY:   H = −Σ p log₂ p;   H ≤ L < H + 1   (≤1 bit integer-length slack)
KRAFT:     prefix code exists ⇔ Σ 2^(−len) ≤ 1; = 1 for a complete code
CANONICAL: ship lengths only; code = (prev+1) << Δlen
LIMITED:   package-merge O(n·L); DEFLATE cap 15, JPEG 16
EDGE:      1 symbol → code "0";  empty → nothing
USED IN:   DEFLATE (gzip/zlib/PNG/ZIP), JPEG, MP3
VS:        arithmetic/ANS reach ~H (fractional bits); Huffman simpler/faster
```

| Symbol | Meaning |
|--------|---------|
| `n` | number of distinct symbols |
| `N` | total input length |
| `wᵢ / pᵢ` | frequency / probability of symbol `i` |
| `ℓᵢ` | codeword length (= leaf depth) |
| `L` | average / weighted length `Σ pᵢ ℓᵢ` |
| `H` | Shannon entropy `−Σ pᵢ log₂ pᵢ` |

---

## Junior Questions (12 Q&A)

### J1. What does Huffman coding compute?
The optimal (minimum total bits) **prefix-free binary code** for a set of symbols given their frequencies — common symbols get short codewords, rare ones long.

### J2. What is a prefix-free code and why do we need it?
A code where **no codeword is a prefix of another**. It lets a concatenated bit stream be decoded unambiguously with no separators — you read bits until they exactly spell a codeword.

### J3. State the construction algorithm.
Put all symbols in a **min-heap** keyed by frequency. Repeatedly pop the two smallest, create a parent whose frequency is their sum (the two popped are its children), and push it back. After `n − 1` merges one node remains — the tree root. Read codes: left = `0`, right = `1`.

### J4. Why a min-heap?
To efficiently get the two **lowest-frequency** nodes at each step. Each pop/push is `O(log n)`, and there are `n − 1` merges, giving `O(n log n)`.

### J5. How do you get codewords from the tree?
One DFS carrying a path string: append `0` going left, `1` going right; each **leaf's** root-to-leaf path is its codeword. Frequent symbols are near the root (short), rare ones deep (long).

### J6. What is the time and space complexity?
`O(n log n)` time and `O(n)` space for construction, where `n` is the number of distinct symbols. Encoding and decoding are linear in the message/bit length.

### J7. Why is Huffman a *greedy* algorithm?
At each step it makes the locally optimal choice — merge the two cheapest nodes — and that local choice provably leads to the global optimum. It exemplifies greedy with optimal substructure.

### J8. Walk through `"abracadabra"`.
Frequencies `a:5, b:2, r:2, c:1, d:1`. Merge `c+d=2`, then `b+r=4`, then `(cd)+(br)=6`, then `a+6=11` (root). One optimal code: `a→0, c→100, d→101, b→110, r→111`. Total 23 bits vs 33 for fixed 3-bit codes.

### J9. How do you decode?
Start at the root; for each bit go left on `0`, right on `1`; on reaching a leaf, emit its symbol and return to the root. No length table needed — the tree resolves boundaries.

### J10. How is Huffman different from ASCII or fixed-length codes?
Fixed-length spends the same bits on every symbol regardless of frequency. Huffman is **variable-length**, spending fewer bits on frequent symbols, so the total shrinks for skewed distributions.

### J11. What happens with a single distinct symbol?
There is no left/right distinction, so you special-case it: assign the code `"0"` (1 bit). Otherwise you would emit empty codewords and an undecodable stream.

### J12. How would you verify your implementation?
Round-trip test: encode then decode must reproduce the input exactly. Also check the total bits equal `Σ freq·len`, and that the average length lands in `[H, H+1)`.

---

## Middle Questions (12 Q&A)

### M1. Prove (sketch) that merging the two smallest is optimal.
Two lemmas. **Greedy choice:** the two lowest-frequency symbols can be made the deepest siblings (swapping a rare-shallow with a common-deep symbol never increases cost). **Optimal substructure:** merging them into one super-symbol gives a smaller instance whose optimum, expanded, is optimal for the original (cost differs by the fixed `w(x)+w(y)`). Induction finishes it.

### M2. How close does Huffman get to the entropy?
`H ≤ L < H + 1`. The lower bound is Shannon's; the upper bound holds because Shannon-code lengths `⌈−log₂ pᵢ⌉` satisfy Kraft and average `< H + 1`, and Huffman is no worse. The up-to-1-bit slack is from **integer** code lengths.

### M3. How do you close the entropy gap?
**Block** symbols (code pairs/triples as super-symbols): the ≤1-bit overhead spreads over `k` symbols, so per-symbol slack → 0 as `k → ∞`, at the cost of an `nᵏ` alphabet. Or switch to **arithmetic/ANS** coding, which uses fractional bits.

### M4. What is the Kraft inequality and why does it matter?
A prefix code with lengths `ℓᵢ` exists iff `Σ 2^(−ℓᵢ) ≤ 1`. It characterizes achievable lengths; Huffman solves "minimize `Σ wᵢℓᵢ` subject to Kraft" over integers. The sum equals 1 for a complete (full-tree) code.

### M5. What is canonical Huffman and why use it?
A standard codeword assignment determined **only by code lengths**: sort by `(length, symbol)` and assign consecutive integers, shifting left when length grows. It lets you transmit just the **lengths** (tiny header), kills tie ambiguity, and enables fast table decoding. DEFLATE and JPEG use it.

### M6. What is adaptive Huffman and when is it used?
A one-pass variant (FGK/Vitter) where encoder and decoder update an identical tree after each symbol (sibling property). No pre-scan and no transmitted table — good for streaming — but more CPU per symbol and slightly worse compression than static.

### M7. What is length-limited Huffman and why is it needed?
The optimal prefix code subject to a maximum codeword length (DEFLATE 15 bits, JPEG 16). Plain Huffman on skewed data can exceed the cap; **package-merge** (`O(n·L)`) finds the optimal capped code.

### M8. Huffman vs arithmetic coding — trade-offs?
Huffman: integer bits, `[H, H+1)`, simple, fast, patent-free. Arithmetic: effectively fractional bits, `≈ H`, handles any probability, but slower and historically patent-encumbered. ANS bridges them (near-`H` at table speed).

### M9. How do ties affect the output?
Ties produce multiple optimal trees with the **same total bits** but different shapes. Use a deterministic tie-breaker (insertion counter / symbol order) for reproducibility; canonical form removes the ambiguity entirely.

### M10. What is the weighted path length and how does it relate to compressed size?
`WPL = Σ freq(s)·len(s)` = total encoded bits. Huffman minimizes it. Dividing by total symbols gives the average length `L`.

### M11. When does Huffman barely help?
Near-**uniform** distributions: every symbol needs ~`log₂ n` bits, so Huffman approaches the fixed-length code and saves little. The savings come from **skew**.

### M12. Can you build Huffman in linear time?
Yes, if the weights are **already sorted**: use two queues (sorted leaves, and merged nodes which arrive in non-decreasing order). Each step takes the two smallest fronts — `O(n)`, no heap. Unsorted input needs `O(n log n)` (sorting lower bound).

---

## Senior Questions (10 Q&A)

### S1. Where does Huffman sit in a real codec like gzip?
After a **modeling** stage. DEFLATE runs LZ77 to produce `(literal|length, distance)` tokens, then Huffman-codes those tokens with **canonical, length-limited (≤15-bit)** codes — even Huffman-coding the code lengths themselves. Huffman never sees raw bytes.

### S2. How do you transmit the code compactly?
**Canonical Huffman**: send only the per-symbol code lengths; both sides reconstruct identical codewords deterministically. Far smaller than serializing a tree, and it enables table decoding. DEFLATE further RLE+Huffman-codes the length list.

### S3. How do you guarantee codewords fit a format's length cap?
**Length-limited** construction via **package-merge** (`O(n·L_max)`), which yields the optimal prefix code with `max len ≤ cap`. A plain Huffman + "flatten overlong leaves" hack is faster but suboptimal.

### S4. How do you decode at multi-GB/s?
**Table-driven decoding**, not bit-by-bit tree walks. Build a `2^MAX_BITS` lookup table mapping the next bits to `(symbol, length)`; advance the cursor by `length`. For 15-bit caps use **multi-level** (root + sub) tables (zlib's approach) to balance memory and reads.

### S5. What do you instrument in production?
Compression ratio per block, `L − H` (table staleness), **max codeword length** vs cap (compliance), decode throughput, the **Kraft sum** (must be ≤ 1), and header-overhead fraction on small blocks. The key alarm: `max_len > cap`.

### S6. When is Huffman the wrong choice?
When the last fraction of a bit matters (use **arithmetic/ANS**), when the source has strong context dependence (use context modeling/CABAC/PPM), or when the distribution is near-uniform (Huffman barely helps).

### S7. How does JPEG use Huffman?
It Huffman-codes `(run, size)` symbols from run-length-encoded quantized DCT coefficients (plus DC differences), with **canonical (≤16-bit)** tables stored in the `DHT` marker as a `BITS` count-per-length array and a symbol list — canonical lengths-only form.

### S8. Why store code lengths instead of the tree?
Lengths are a few bytes per symbol and fully determine a canonical code; a serialized tree is larger, format-specific, and ambiguous under ties. Lengths also drive `first_code[L]` table decoding.

### S9. How do you size decode-table memory?
Single-level: `2^MAX_BITS` entries (32K for a 15-bit cap ≈ 64–128 KB, fits L2). Multi-level shrinks the hot root table to L1 with sub-tables for rare long codes. Two codes per DEFLATE block (literals/lengths + distances) → budget a few hundred KB.

### S10. What is the build-vs-decode cost balance?
Build is `O(n log n)` in distinct symbols (≤256 for bytes → microseconds); decode runs once per output symbol. For read-heavy data, **decode throughput dominates**, so optimize the lookup table, not the build.

---

## Professional / Theory Questions (8 Q&A)

### P1. Give the full optimality proof.
Exchange argument (Lemma A): in any optimal full tree the two deepest leaves are siblings; swapping the two minimum-weight symbols into those positions has cost change `(w_b − w_x)(depth_x − depth_b) ≤ 0`, so an optimal tree exists with `x,y` deepest siblings. Substructure (Lemma B): merging `x,y` into `z` changes cost by exactly `w(x)+w(y)` regardless of the rest. Induct: `L(Huffman) = L(Huffman') + w(x)+w(y) ≤ L(T') + w(x)+w(y) = L(T)` for optimal `T`. (Full version in `professional.md`.)

### P2. State and use the Kraft–McMillan inequality.
A prefix code with lengths `ℓᵢ` exists iff `Σ 2^{−ℓᵢ} ≤ 1` (Kraft). McMillan: the same bound is necessary for **any uniquely decodable** code, so prefix codes lose nothing in length. Optimization over prefix codes is the integer program "minimize `Σ wᵢℓᵢ` s.t. `Σ 2^{−ℓᵢ} ≤ 1`," which Huffman solves exactly.

### P3. Prove `H ≤ L`.
Set `qᵢ = 2^{−ℓᵢ}/Z`, `Z = Σ 2^{−ℓⱼ} ≤ 1`. Then `L − H = D(p‖q) − log₂ Z ≥ 0` since KL divergence `≥ 0` and `log₂ Z ≤ 0`. Equality iff `ℓᵢ = −log₂ pᵢ` (powers of two).

### P4. Prove `L < H + 1`.
Shannon lengths `ℓᵢ = ⌈−log₂ pᵢ⌉` satisfy Kraft (`Σ 2^{−⌈−log₂ pᵢ⌉} ≤ Σ pᵢ = 1`) and average `Σ pᵢ⌈−log₂ pᵢ⌉ < Σ pᵢ(−log₂ pᵢ + 1) = H + 1`. Huffman, being optimal, is ≤ this, so `< H + 1`.

### P5. Explain package-merge and its complexity.
The length-limited problem is reframed as a "coin collector" choosing the cheapest `2(n−1)` coins of dyadic widths `2^{−d}` under a width-`(n−1)` budget. Sweeping widths fine→coarse, **package** adjacent pairs and **merge** with originals, keeping cheapest. Runs in `O(n·L_max)`, returns the optimal code with `max len ≤ L_max` (Larmore–Hirschberg 1990).

### P6. Generalize to `k`-ary codes.
Merge the `k` smallest each step. A full `k`-ary tree needs `(n−1) ≡ 0 (mod k−1)`; if not, pad with zero-weight dummy leaves. Binary (`k=2`) never needs padding.

### P7. Why is Huffman only optimal among *prefix* codes, and what beats it?
It minimizes over integer codeword lengths; the true optimum length `−log₂ pᵢ` is fractional. **Arithmetic coding** and **ANS** encode the whole message as one number / state machine, realizing fractional lengths and reaching `≈ H`, removing the `< H+1` slack.

### P8. Linear-time construction conditions.
With sorted weights, the **two-queue** method is `Θ(n)` (merged weights are produced in sorted order, so no heap is needed). Unsorted input is `Θ(n log n)` by a sorting lower bound in the comparison model.

---

## Behavioral Questions (5)

### B1. Tell me about a time you chose a simpler algorithm over a theoretically better one.
Structure: explain you picked Huffman over arithmetic/ANS because the ≤1-bit slack was acceptable, the implementation/maintenance cost was far lower, decode was faster, and there were no patent/compatibility concerns. Quantify the actual compression difference you measured.

### B2. Describe debugging a decoder that produced garbage.
Walk through: confirmed encoder/decoder used the *same* code (root cause: non-canonical tree serialization under ties), switched to canonical lengths-only transmission, added a Kraft-sum assertion and a round-trip test in CI. Emphasize the systematic isolation.

### B3. How did you decide between transmitting a tree vs lengths?
Explain measuring header overhead: a serialized tree dominated tiny blocks; switching to canonical lengths (and a fixed/standard table for the smallest blocks) recovered the loss. Show you used data, not intuition.

### B4. Explain a hard concept (entropy) to a non-expert teammate.
Use the analogy: entropy is the "true information content" floor; Huffman gets within a bit by spending fewer bits on common symbols, like Morse code. Then show the `H ≤ L < H + 1` band on a concrete example.

### B5. A time you wrote a verification harness before trusting your code.
Describe the brute-force optimality oracle (try all Kraft-valid length vectors on a tiny alphabet) and the round-trip + entropy-band assertions, mirroring how a spanning-tree brute force validates a determinant. Stress "trust but verify."

---

## Coding Challenges

### Challenge 1 — Build a Huffman Code and Encode/Decode

**Problem.** Given a string, build a Huffman code, return the `symbol → codeword` table, encode the string, and decode it back. Verify the round trip.

**Constraints.** `1 ≤ |text| ≤ 10⁶`, ASCII. Deterministic tie-breaking.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"sort"
	"strings"
)

type node struct {
	freq, order int
	sym         byte
	leaf        bool
	left, right *node
}
type mh []*node

func (h mh) Len() int { return len(h) }
func (h mh) Less(i, j int) bool {
	if h[i].freq != h[j].freq {
		return h[i].freq < h[j].freq
	}
	return h[i].order < h[j].order
}
func (h mh) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *mh) Push(x any)   { *h = append(*h, x.(*node)) }
func (h *mh) Pop() any     { o := *h; n := len(o); x := o[n-1]; *h = o[:n-1]; return x }

func buildCodes(text string) (*node, map[byte]string) {
	freq := map[byte]int{}
	for i := 0; i < len(text); i++ {
		freq[text[i]]++
	}
	syms := make([]int, 0, len(freq))
	for s := range freq {
		syms = append(syms, int(s))
	}
	sort.Ints(syms)
	h := &mh{}
	ord := 0
	for _, s := range syms {
		heap.Push(h, &node{freq: freq[byte(s)], sym: byte(s), leaf: true, order: ord})
		ord++
	}
	var root *node
	if h.Len() == 1 {
		only := heap.Pop(h).(*node)
		root = &node{freq: only.freq, left: only, order: ord}
	} else {
		for h.Len() > 1 {
			a := heap.Pop(h).(*node)
			b := heap.Pop(h).(*node)
			heap.Push(h, &node{freq: a.freq + b.freq, left: a, right: b, order: ord})
			ord++
		}
		root = heap.Pop(h).(*node)
	}
	codes := map[byte]string{}
	var walk func(n *node, path string)
	walk = func(n *node, path string) {
		if n == nil {
			return
		}
		if n.leaf {
			if path == "" {
				path = "0"
			}
			codes[n.sym] = path
			return
		}
		walk(n.left, path+"0")
		walk(n.right, path+"1")
	}
	walk(root, "")
	return root, codes
}

func main() {
	text := "abracadabra"
	root, codes := buildCodes(text)
	var enc strings.Builder
	for i := 0; i < len(text); i++ {
		enc.WriteString(codes[text[i]])
	}
	bits := enc.String()
	var dec strings.Builder
	cur := root
	for _, b := range bits {
		if b == '0' {
			cur = cur.left
		} else {
			cur = cur.right
		}
		if cur.leaf {
			dec.WriteByte(cur.sym)
			cur = root
		}
	}
	fmt.Println(bits, len(bits), "bits, match:", dec.String() == text)
}
```

#### Java

```java
import java.util.*;

public class Challenge1 {
    static class N { int freq, order; char sym; boolean leaf; N left, right;
        N(int f, int o, char s, boolean l) { freq=f; order=o; sym=s; leaf=l; } }

    static N root;
    static Map<Character, String> buildCodes(String text) {
        Map<Character, Integer> freq = new HashMap<>();
        for (char c : text.toCharArray()) freq.merge(c, 1, Integer::sum);
        List<Character> syms = new ArrayList<>(freq.keySet());
        Collections.sort(syms);
        PriorityQueue<N> h = new PriorityQueue<>(
            (a, b) -> a.freq != b.freq ? a.freq - b.freq : a.order - b.order);
        int[] ord = {0};
        for (char s : syms) h.add(new N(freq.get(s), ord[0]++, s, true));
        if (h.size() == 1) {
            N only = h.poll(); root = new N(only.freq, ord[0]++, '\0', false); root.left = only;
        } else {
            while (h.size() > 1) {
                N a = h.poll(), b = h.poll();
                N m = new N(a.freq + b.freq, ord[0]++, '\0', false);
                m.left = a; m.right = b; h.add(m);
            }
            root = h.poll();
        }
        Map<Character, String> codes = new HashMap<>();
        walk(root, "", codes);
        return codes;
    }
    static void walk(N n, String p, Map<Character, String> c) {
        if (n == null) return;
        if (n.leaf) { c.put(n.sym, p.isEmpty() ? "0" : p); return; }
        walk(n.left, p + "0", c); walk(n.right, p + "1", c);
    }
    public static void main(String[] args) {
        String text = "abracadabra";
        Map<Character, String> codes = buildCodes(text);
        StringBuilder enc = new StringBuilder();
        for (char c : text.toCharArray()) enc.append(codes.get(c));
        String bits = enc.toString();
        StringBuilder dec = new StringBuilder(); N cur = root;
        for (char b : bits.toCharArray()) {
            cur = b == '0' ? cur.left : cur.right;
            if (cur.leaf) { dec.append(cur.sym); cur = root; }
        }
        System.out.println(bits + " " + bits.length() + " bits, match: " + dec.toString().equals(text));
    }
}
```

#### Python

```python
import heapq
from collections import Counter
from itertools import count


def build_codes(text):
    freq = Counter(text)
    tie = count()
    heap = [[freq[s], next(tie), s, None, None] for s in sorted(freq)]
    heapq.heapify(heap)
    if len(heap) == 1:
        only = heap[0]
        root = [only[0], next(tie), None, only, None]
    else:
        while len(heap) > 1:
            a, b = heapq.heappop(heap), heapq.heappop(heap)
            heapq.heappush(heap, [a[0] + b[0], next(tie), None, a, b])
        root = heap[0]
    codes = {}
    def walk(node, path):
        _, _, sym, left, right = node
        if sym is not None:
            codes[sym] = path or "0"
        else:
            walk(left, path + "0"); walk(right, path + "1")
    walk(root, "")
    return root, codes


if __name__ == "__main__":
    text = "abracadabra"
    root, codes = build_codes(text)
    bits = "".join(codes[c] for c in text)
    out, node = [], root
    for b in bits:
        node = node[3] if b == "0" else node[4]
        if node[2] is not None:
            out.append(node[2]); node = root
    print(bits, len(bits), "bits, match:", "".join(out) == text)
```

---

### Challenge 2 — Canonical Code Lengths Only

**Problem.** Given symbol frequencies, output each symbol's **canonical** codeword, derived only from its Huffman code *length*. (This is what a real format transmits.)

**Constraints.** `1 ≤ n ≤ 10⁵`.

#### Python (reference; Go/Java mirror it)

```python
import heapq
from itertools import count


def code_lengths(freq):
    tie = count()
    heap = [[freq[s], next(tie), s, None, None] for s in sorted(freq)]
    heapq.heapify(heap)
    if len(heap) == 1:
        return {heap[0][2]: 1}
    while len(heap) > 1:
        a, b = heapq.heappop(heap), heapq.heappop(heap)
        heapq.heappush(heap, [a[0] + b[0], next(tie), None, a, b])
    lengths = {}
    def walk(node, d):
        _, _, s, left, right = node
        if s is not None:
            lengths[s] = d
        else:
            walk(left, d + 1); walk(right, d + 1)
    walk(heap[0], 0)
    return lengths


def canonical(lengths):
    out, code, prev = {}, 0, 0
    for s in sorted(lengths, key=lambda x: (lengths[x], x)):
        L = lengths[s]
        code <<= (L - prev)
        out[s] = format(code, "0{}b".format(L))
        code += 1
        prev = L
    return out


freq = {"a": 5, "b": 2, "r": 2, "c": 1, "d": 1}
table = canonical(code_lengths(freq))
for s in sorted(table):
    print(s, "->", table[s])
# Kraft check
assert abs(sum(2 ** -len(c) for c in table.values()) - 1) < 1e-9
```

#### Go

```go
// codeLengths via heap (as in Challenge 1, recording depth instead of path).
// canonical: sort symbols by (length, symbol); code=0; for each, code <<= (L-prev);
//   emit fmt.Sprintf("%0*b", L, code); code++; prev=L.
// Verify Kraft: sum of 2^-len == 1.
```

#### Java

```java
// Same structure: compute lengths with a PriorityQueue, sort by (length, symbol),
// build canonical codewords with shift-and-increment, assert Kraft sum == 1.
```

---

### Challenge 3 — Decode From a Canonical Table

**Problem.** Given canonical code lengths and a bit stream, decode the original symbols using `first_code` / boundary tables (no tree).

**Constraints.** Lengths form a valid canonical code; stream is well-formed.

#### Python

```python
def decode_canonical(lengths, bits):
    # Build canonical codes.
    order = sorted(lengths, key=lambda s: (lengths[s], s))
    code, prev, table = 0, 0, {}
    for s in order:
        L = lengths[s]
        code <<= (L - prev)
        table[(L, code)] = s
        code += 1
        prev = L
    out, acc, length = [], 0, 0
    for b in bits:
        acc = (acc << 1) | (b == "1")
        length += 1
        if (length, acc) in table:
            out.append(table[(length, acc)])
            acc, length = 0, 0
    return "".join(out)


lengths = {"a": 1, "b": 3, "r": 3, "c": 3, "d": 3}
# encode "abracadabra" with these canonical codes, then decode
from itertools import count
def canon(lengths):
    out, code, prev = {}, 0, 0
    for s in sorted(lengths, key=lambda x: (lengths[x], x)):
        L = lengths[s]; code <<= (L - prev); out[s] = format(code, f"0{L}b"); code += 1; prev = L
    return out
table = canon(lengths)
bits = "".join(table[c] for c in "abracadabra")
print(decode_canonical(lengths, bits))   # abracadabra
```

#### Go / Java

```text
// Build canonical codes from lengths (shift-and-increment). Decode by accumulating
// bits into (length, value); when (length, value) maps to a symbol, emit and reset.
// This mirrors first_code[L] table decoding used by zlib/JPEG.
```

---

### Challenge 4 — Verify the Entropy Bound

**Problem.** For a given distribution, build the Huffman code, compute `L` and `H`, and assert `H ≤ L < H + 1`.

#### Python

```python
import math


def verify_entropy_bound(freq):
    total = sum(freq.values())
    lengths = code_lengths(freq)           # from Challenge 2
    L = sum((freq[s] / total) * lengths[s] for s in freq)
    H = -sum((freq[s] / total) * math.log2(freq[s] / total) for s in freq)
    assert H - 1e-9 <= L < H + 1, (H, L)
    return H, L


for f in [{"a": 5, "b": 2, "r": 2, "c": 1, "d": 1},
          {"x": 1, "y": 1, "z": 1, "w": 1},          # uniform
          {"p": 1, "q": 1}]:                          # tiny
    H, L = verify_entropy_bound(f)
    print(f"H={H:.4f} L={L:.4f} OK")
```

#### Go / Java

```text
// Build lengths via heap; L = Σ (freq/total)*len; H = −Σ p log2 p; assert H ≤ L < H+1.
```

---

## Common Pitfalls

1. **No tie-breaker** — non-deterministic trees (or a Python heap crash comparing node payloads). Always carry an insertion counter.
2. **Single-symbol alphabet** — must special-case to code `"0"`; an empty codeword breaks decoding.
3. **Transmitting a serialized tree** — bigger and ambiguous; ship **canonical lengths** instead.
4. **No length/EOB marker** — bit padding gets decoded as phantom symbols; store the bit count or emit an end-of-block symbol.
5. **Ignoring the length cap** — plain Huffman can exceed DEFLATE's 15 / JPEG's 16 bits; use package-merge when a cap exists.
6. **Assuming Huffman = entropy** — it is within a bit, not exact; integer lengths leave slack. Use arithmetic/ANS to close it.
7. **Encoding and decoding with mismatched tables** — guarantee identical codes via canonical reconstruction from the same lengths.
8. **Bit-by-bit decode in hot paths** — too slow; use lookup tables.
9. **Recomputing codeword strings per symbol** — build the table once and index it.
10. **Counting the wrong unit** — characters vs bytes vs tokens change the optimal code; be explicit about the symbol.
