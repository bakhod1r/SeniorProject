# Count-Min Sketch — Interview Preparation

The Count-Min Sketch (CMS) is a favourite interview topic because it rewards one crisp insight — *"keep a `d × w` grid; add 1 to one cell per row on update; report the **minimum** of an item's `d` cells on query; every cell is `≥` the true count, so the answer **overcounts only**"* — and then tests whether you can (a) **size** the grid from `eps`/`delta` (`w = ceil(e/eps)`, `d = ceil(ln(1/delta))`), (b) **prove** the `â ≤ f + eps·N` bound via Markov-on-a-row × independence-across-rows, (c) explain the **conservative update** and **heavy-hitters-with-a-heap** extensions, and (d) place CMS among its relatives — it **over**counts where Misra-Gries **under**counts, where Space-Saving **over**counts-but-ranks, and where a Bloom filter only tests **membership**. This file is a tiered question bank (45 questions) plus a runnable coding challenge in Go, Java, and Python.

---

## Quick-Reference Cheat Sheet

| Question | Answer |
|----------|--------|
| What does it answer? | Per-key frequency `≈ f(x)`, for any key you name, in `O(d)` time, `O(d·w)` space. |
| Update rule? | For each row `i`: `C[i][h_i(x) % w] += c` (one cell per row). |
| Query rule? | `â(x) = min over rows i of C[i][h_i(x) % w]`. |
| Error direction? | **Overcount only:** `f(x) ≤ â(x) ≤ f(x) + eps·N`. |
| Why min, not avg? | Each cell `≥ f(x)`; the min is the least-polluted cell and still a valid upper bound. |
| Size width `w`? | `ceil(e/eps)` — controls error *magnitude*. |
| Size depth `d`? | `ceil(ln(1/delta))` — controls failure *probability*. |
| Proof in one line? | Markov per row (`E[overflow] ≤ N/w ≤ eps·N/e` → `1/e`) × `d` independent rows (`(1/e)^d ≤ delta`). |
| Conservative update? | Raise each cell only to `estimate + c` (`max`); lower bias, breaks mergeability. |
| Find heavy hitters? | Pair CMS with a min-heap of top-`k` candidates. |
| Mergeable? | Yes — element-wise add of same-shaped sketches. |
| vs Misra-Gries? | MG is deterministic and **under**counts; CMS is randomized and **over**counts. |
| vs Bloom filter? | Bloom = membership via bits + AND; CMS = frequency via counters + MIN. |
| vs HyperLogLog? | HLL counts *distinct* items (cardinality); CMS counts *occurrences* (frequency). |

The update/query core (memorize this):

```text
add(x, c):       for i in 0..d-1: C[i][h_i(x) % w] += c
estimate(x):     return min over i of C[i][h_i(x) % w]
# space O(d*w); update/query O(d); estimate >= true count (overcount only)
```

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a Count-Min Sketch and when would you use it? | A `d×w` grid of counters + `d` hashes that estimates per-item frequencies in fixed memory; use for stream frequency estimation when an exact hash map won't fit. |
| 2 | How do you record (update) an item? | Hash with each of the `d` hash functions; add 1 (or weight `c`) to that one cell in each row — `d` cells total. |
| 3 | How do you query an item's count? | Read the `d` cells it maps to and return the **minimum**. |
| 4 | Why is the estimate never too low? | Every occurrence increments all `d` of the item's cells, so each cell ≥ the true count; the min of values each ≥ true is still ≥ true. |
| 5 | Why does the estimate overcount sometimes? | Different items collide into the same cell, so a cell may include other items' counts. |
| 6 | Why take the minimum instead of the average? | The min is the least-polluted cell and is still a valid upper bound; averaging breaks the overcount-only guarantee. |
| 7 | What does each row use that's different? | Its own independent hash function, so collisions in one row are unlikely to repeat in another. |
| 8 | What's the space cost? | `O(d·w)` — fixed, independent of stream length or number of distinct items. |
| 9 | What's the time per update and per query? | `O(d)` — one hash + access per row; `d` is small (4–8). |
| 10 | Can a never-inserted item report a nonzero count? | Yes — collisions from other items can leave nonzero values; the min keeps it small. |
| 11 | Does stream order affect the result? | No — updates are additions (commutative), so the final table and all estimates are order-independent. |
| 12 | What two parameters control accuracy and how? | `w` (width) controls error size; `d` (depth) controls the probability the bound fails. |

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Given `eps` and `delta`, how big is the grid? | `w = ceil(e/eps)`, `d = ceil(ln(1/delta))`; guarantee `â ≤ f + eps·N` w.p. `1-delta`. |
| 2 | Why does width scale as `1/eps` but depth as `ln(1/delta)`? | Error magnitude `~N/w` is linear in `1/w`; failure probability `(1/e)^d` shrinks exponentially in `d`. |
| 3 | What is the conservative (minimal-increment) update? | Read estimate `m`, then set each cell to `max(cell, m+c)` instead of blindly `+c`; reduces bias on skewed data. |
| 4 | Why does conservative update stay correct? | It only ever raises cells, and `m+c ≥ f_new`, so every cell stays ≥ true count → still no undercount. |
| 5 | What does conservative update cost you? | Mergeability (the `max` isn't additive) and deletions; plus one `estimate()` read per update. |
| 6 | How do you find heavy hitters with CMS? | Pair it with a min-heap of top-`k` candidates: on each update, query the estimate and update/replace the heap's smallest. |
| 7 | CMS vs Misra-Gries — key difference? | CMS is randomized and **over**counts (point queries for any key); MG is deterministic, **under**counts, and enumerates heavy hitters in `O(k)`. |
| 8 | CMS vs Bloom filter? | Bloom answers membership (bits + AND, false positives); CMS answers frequency (counters + MIN, overcount). |
| 9 | CMS vs Space-Saving? | Both overcount; Space-Saving is deterministic, `O(k)`, and ranks the top-`k`, but only tracks `k` keys; CMS answers any key. |
| 10 | What is the Count-Min-Mean variant? | Subtract each cell's estimated noise `(N-cell)/(w-1)` and take the **median** of residuals; lower bias, loses the strict upper bound. |
| 11 | When is CMS a poor choice? | When you need exact counts, when undercounting is the safer error, or when you must *list* heavy hitters without a heap. |
| 12 | Why is CMS great for skewed (Zipfian) data? | A few elephants give near-exact estimates; conservative update keeps them from inflating mice. |
| 13 | How does the absolute error grow with the stream? | As `eps·N` — it grows with total volume `N`; that's why long streams need windowing/decay. |
| 14 | How do you get `d` hashes cheaply? | Double hashing: `h_i(x) = a + i·b` from two base hashes, with `b` not a multiple of `w`. |

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What makes CMS ideal for distributed stream monitoring? | **Mergeability:** identically-shaped sketches add element-wise; agents count locally, an aggregator sums to reconstruct global counts. |
| 2 | What must all agents agree on to merge? | Same `d`, `w`, and hash seeds; epoch-fence config rollouts; mismatched shapes make merges meaningless. |
| 3 | Why can't you merge conservative-update sketches? | The `max`-based update isn't additive — `max(A,B)` doesn't reconstruct the union; use additive updates at the edge. |
| 4 | How do you keep error bounded on an infinite stream? | Windowing (per-bucket sketches you merge/drop) or exponential decay (multiply cells by `γ<1`) so `N` stays bounded. |
| 5 | How do you handle a single elephant flow dominating the tail? | Split: exact top-`k` heap for elephants + CMS for the tail; and/or conservative update. |
| 6 | How do range queries work on CMS? | A dyadic hierarchy of `log U` sketches; decompose `[lo,hi]` into `O(log U)` dyadic intervals and sum their min-estimates. |
| 7 | What's the error of a range query? | About `eps·N·log U`, since error accumulates across the `O(log U)` summed cells. |
| 8 | How would you observe CMS health in production? | Track `N`, `fill_ratio` (nonzero cells), merge lag, top-key share, and a sampled shadow exact counter to verify the bound. |
| 9 | CMS vs HyperLogLog — when each? | CMS for per-item frequency; HLL for distinct-count (cardinality); often run both on the same stream. |
| 10 | How is CMS used in a query optimizer? | Continuously refreshed per-value frequency stats feed selectivity estimates for join ordering and index decisions. |
| 11 | Where is CMS used in production systems? | Redis `CMS.*`, network telemetry, Apache Druid/Spark approximate aggregations, hot-key detection. |
| 12 | Adversarial collisions — what's the risk and fix? | An attacker who learns the seeds can craft colliding keys to blow up estimates; salt/secret per-deployment seeds. |

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Prove `â(x) ≥ f(x)` always. | Each cell = `f(x)` + nonnegative collision noise ≥ `f(x)`; min of such values ≥ `f(x)`. |
| 2 | Prove `â(x) ≤ f(x)+eps·N` w.p. `1-delta`. | Per-row overflow `E[X_i] ≤ N/w ≤ eps·N/e`; Markov → `Pr[X_i ≥ eps·N] ≤ 1/e`; independence → `(1/e)^d ≤ delta` for `d=ln(1/delta)`. |
| 3 | Why exactly the constant `e` in `w = e/eps`? | It makes the one-row Markov bound come out to exactly `1/e`, minimizing width for that per-row failure. |
| 4 | What independence do the hashes need? | Pairwise (2-universal) independence: `Pr[h_i(x)=h_i(y)] = 1/w` — full independence is not required. |
| 5 | Is CMS space-optimal? | Yes up to lower-order factors: `Ω(1/eps)` from an INDEXING reduction, `Ω(log(1/delta))` from repetition — matches `Θ((1/eps)log(1/delta))`. |
| 6 | Prove conservative update never undercounts. | Before update each cell ≥ `f_old`; new value `max(cell, m+c)` with `m ≥ f_old` ⇒ `m+c ≥ f_new` ⇒ cell ≥ `f_new`. |
| 7 | Prove conservative ≤ plain pointwise. | Induction: conservative raises to `max(cell, m+c)` ≤ the plain cell which received full `+c` on a value at least as large. |
| 8 | What error norm does CMS guarantee, and why does it matter? | L₁ (`eps·‖f‖₁`); same slack for every key, good for heavy hitters, poor for ranking the tail. |
| 9 | How does Count Sketch differ in its guarantee? | Signed hashes + median give an **unbiased** estimator with **L₂** error (`eps·‖f‖₂`, tighter on skew) and support deletions, at `1/eps²` space. |
| 10 | Why is plain CMS biased even at the min? | `E[min_i X_i] > 0` — every cell carries some nonnegative noise; CMM de-biases by subtracting estimated noise. |
| 11 | Can CMS handle deletions? | Not plain CMS (subtraction breaks the min/no-undercount); use Count Sketch (signed) or a turnstile-safe variant. |
| 12 | Summarize the guarantee directions across summaries. | CMS & Space-Saving overcount; Misra-Gries undercounts; Bloom false-positives; Count Sketch is two-sided/unbiased. |

---

## Coding Challenge (3 Languages)

### Challenge: Top-K Frequent Words via Count-Min Sketch + Heap

> Given a stream of words and an integer `k`, return the `k` most frequent words using a Count-Min Sketch (sized from `eps`/`delta`) paired with a min-heap — without storing every distinct word. Your solution must:
> 1. Size the grid as `w = ceil(e/eps)`, `d = ceil(ln(1/delta))`.
> 2. Update one cell per row; estimate via the **min** across rows.
> 3. Maintain a min-heap of the top-`k` candidates by estimated count.
> 4. Return the top-`k` words sorted by estimated frequency (descending).
>
> Test: stream `["a","b","a","c","a","b","a","d","b","a"]`, `k=2` → top-2 should be `a` (≈5) then `b` (≈3).

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"hash/fnv"
	"math"
	"sort"
)

type CMS struct {
	d, w int
	t    [][]uint64
}

func NewCMS(eps, delta float64) *CMS {
	w := int(math.Ceil(math.E / eps))
	d := int(math.Ceil(math.Log(1 / delta)))
	t := make([][]uint64, d)
	for i := range t {
		t[i] = make([]uint64, w)
	}
	return &CMS{d, w, t}
}

func (c *CMS) cols(s string) []int {
	a := fnv.New64a()
	a.Write([]byte(s))
	x := a.Sum64()
	b := fnv.New64()
	b.Write([]byte(s))
	y := b.Sum64() | 1
	cs := make([]int, c.d)
	for i := range cs {
		cs[i] = int((x + uint64(i)*y) % uint64(c.w))
	}
	return cs
}

func (c *CMS) Add(s string) {
	for i, col := range c.cols(s) {
		c.t[i][col]++
	}
}

func (c *CMS) Est(s string) uint64 {
	min := ^uint64(0)
	for i, col := range c.cols(s) {
		if c.t[i][col] < min {
			min = c.t[i][col]
		}
	}
	return min
}

func TopK(stream []string, k int, eps, delta float64) []string {
	cms := NewCMS(eps, delta)
	best := map[string]uint64{} // candidate -> est
	for _, w := range stream {
		cms.Add(w)
		est := cms.Est(w)
		if _, ok := best[w]; ok {
			best[w] = est
		} else if len(best) < k {
			best[w] = est
		} else {
			// find current min candidate
			var mk string
			var mv uint64 = ^uint64(0)
			for kk, vv := range best {
				if vv < mv {
					mv, mk = vv, kk
				}
			}
			if est > mv {
				delete(best, mk)
				best[w] = est
			}
		}
	}
	keys := make([]string, 0, len(best))
	for kk := range best {
		keys = append(keys, kk)
	}
	sort.Slice(keys, func(i, j int) bool { return best[keys[i]] > best[keys[j]] })
	return keys
}

// (heap import kept to show the production approach; map-based top-k above is O(k) per step)
var _ = heap.Init

func main() {
	stream := []string{"a", "b", "a", "c", "a", "b", "a", "d", "b", "a"}
	fmt.Println(TopK(stream, 2, 0.001, 0.01)) // [a b]
}
```

#### Java

```java
import java.util.*;
import java.util.zip.CRC32;

public class Solution {
    static int d, w;
    static long[][] t;

    static void init(double eps, double delta) {
        w = (int) Math.ceil(Math.E / eps);
        d = (int) Math.ceil(Math.log(1 / delta));
        t = new long[d][w];
    }

    static int[] cols(String s) {
        long a = Integer.toUnsignedLong(s.hashCode());
        CRC32 c = new CRC32();
        c.update(s.getBytes());
        long b = c.getValue() | 1L;
        int[] cs = new int[d];
        for (int i = 0; i < d; i++) cs[i] = (int) (((a + (long) i * b) % w + w) % w);
        return cs;
    }

    static void add(String s) {
        int[] cs = cols(s);
        for (int i = 0; i < d; i++) t[i][cs[i]]++;
    }

    static long est(String s) {
        int[] cs = cols(s);
        long m = Long.MAX_VALUE;
        for (int i = 0; i < d; i++) m = Math.min(m, t[i][cs[i]]);
        return m;
    }

    static List<String> topK(String[] stream, int k, double eps, double delta) {
        init(eps, delta);
        Map<String, Long> best = new HashMap<>();
        for (String s : stream) {
            add(s);
            long e = est(s);
            if (best.containsKey(s) || best.size() < k) {
                best.put(s, e);
            } else {
                String mk = null; long mv = Long.MAX_VALUE;
                for (Map.Entry<String, Long> en : best.entrySet())
                    if (en.getValue() < mv) { mv = en.getValue(); mk = en.getKey(); }
                if (e > mv) { best.remove(mk); best.put(s, e); }
            }
        }
        List<String> keys = new ArrayList<>(best.keySet());
        keys.sort((x, y) -> Long.compare(best.get(y), best.get(x)));
        return keys;
    }

    public static void main(String[] args) {
        String[] stream = {"a","b","a","c","a","b","a","d","b","a"};
        System.out.println(topK(stream, 2, 0.001, 0.01)); // [a, b]
    }
}
```

> Note: `cols(s)` is computed once per call and reused across rows; in a hot loop you would cache it rather than recompute per row.

#### Python

```python
import hashlib
import math


class CMS:
    def __init__(self, eps, delta):
        self.w = math.ceil(math.e / eps)
        self.d = math.ceil(math.log(1 / delta))
        self.t = [[0] * self.w for _ in range(self.d)]

    def _cols(self, s):
        h = hashlib.md5(s.encode()).digest()
        a = int.from_bytes(h[:8], "big")
        b = int.from_bytes(h[8:], "big") | 1
        return [(a + i * b) % self.w for i in range(self.d)]

    def add(self, s):
        for i, col in enumerate(self._cols(s)):
            self.t[i][col] += 1

    def est(self, s):
        cols = self._cols(s)
        return min(self.t[i][cols[i]] for i in range(self.d))


def top_k(stream, k, eps=0.001, delta=0.01):
    cms = CMS(eps, delta)
    best = {}  # candidate -> estimate
    for w in stream:
        cms.add(w)
        e = cms.est(w)
        if w in best or len(best) < k:
            best[w] = e
        else:
            mk = min(best, key=best.get)
            if e > best[mk]:
                del best[mk]
                best[w] = e
    return sorted(best, key=best.get, reverse=True)


if __name__ == "__main__":
    stream = ["a", "b", "a", "c", "a", "b", "a", "d", "b", "a"]
    print(top_k(stream, 2))  # ['a', 'b']
```

**Expected output:** `[a b]` / `[a, b]` / `['a', 'b']` — `a` (true 5) and `b` (true 3) are the two heaviest. Validate by also building an exact `Counter`/`map` on small inputs and confirming each CMS estimate is **≥** the true count and within `eps·N`.

**Follow-ups an interviewer may ask:**
- Add **conservative update** and show estimates drop toward the true counts.
- Make the sketch **mergeable** and merge two partial sketches; confirm the result equals one sketch over the concatenated stream.
- Add **decay** so the top-`k` reflects a recent window.
- Explain why the heap can hold a false positive but never miss an item far above the cutoff.

---

## Worked Whiteboard Example (Talk Through This Out Loud)

Interviewers love watching you trace a tiny sketch by hand. Use `d = 2`, `w = 4`, and two toy hashes:

```text
h0(x) = (sum of letter positions) mod 4        (a=1, b=2, ..., z=26)
h1(x) = (3*len(x) + first letter position) mod 4
```

Stream: `cat cat dog cat bird dog`. Precomputed columns: `cat → (0,0)`, `dog → (2,1)`, `bird → (1,2)`.

After processing all six items the grid is:

```text
row0 (h0): [ 3, 1, 2, 0 ]
row1 (h1): [ 3, 2, 1, 0 ]
```

Now answer queries out loud, always *taking the min*:

- `estimate(cat) = min(row0[0]=3, row1[0]=3) = 3` — true is 3, **exact**.
- `estimate(dog) = min(row0[2]=2, row1[1]=2) = 2` — true is 2, **exact**.
- `estimate(act)` (never inserted; anagram of `cat` so `h0=0`, but `h1(act)=(9+1)%4=2`): `min(row0[0]=3, row1[2]=1) = 1` — true is **0**, reported **1**: a pure collision **overcount**, but the min pulled it from 3 down to 1.

**The point to verbalize:** every real occurrence of an item bumps *all* its cells, so each cell is `≥` true; the min is the least-polluted of them, still `≥` true. That single sentence is the whole correctness story.

---

## Common Interview Pitfalls to Avoid

| Pitfall | Why it's wrong | What to say instead |
|---------|----------------|---------------------|
| "Take the average of the cells." | Average is not a valid upper bound; it breaks the overcount-only guarantee. | "Take the **minimum** — it's the least-polluted cell and stays `≥` true." |
| "Use `d` rows with one hash function." | Every row collides identically; depth gives nothing. | "Each row needs an **independent** hash (or double-hashing `a + i·b`)." |
| "CMS can list the top keys." | CMS only does point queries; it stores no keys. | "Pair it with a **min-heap** to discover heavy hitters." |
| "Subtract to delete an item." | Subtraction breaks the min / no-undercount invariant and can underflow. | "Plain CMS has no delete; use a **Count Sketch** (signed) for turnstile streams." |
| "Error is fixed." | Absolute error is `eps·N` and grows with stream volume. | "Error grows with `N`; long streams need **windowing or decay**." |
| "Bigger `d` lowers the error a lot." | Depth mainly lowers the *failure probability* `(1/e)^d`, not the error size. | "**Width** fights error magnitude; **depth** fights failure odds." |

---

## Second Coding Challenge (3 Languages)

### Challenge: Conservative-Update Sketch with Error Verification

> Implement a CMS with both `add` (plain) and `conservativeAdd`. Stream a skewed dataset, then for one chosen key print the **plain estimate**, the **conservative estimate**, and the **true count**, asserting both estimates are `≥` true and conservative `≤` plain.

#### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
)

type S struct{ d, w int; t [][]uint64 }

func NewS(d, w int) *S {
	t := make([][]uint64, d)
	for i := range t { t[i] = make([]uint64, w) }
	return &S{d, w, t}
}
func (s *S) cols(k string) []int {
	a := fnv.New64a(); a.Write([]byte(k)); x := a.Sum64()
	b := fnv.New64(); b.Write([]byte(k)); y := b.Sum64() | 1
	c := make([]int, s.d)
	for i := range c { c[i] = int((x + uint64(i)*y) % uint64(s.w)) }
	return c
}
func (s *S) est(c []int) uint64 {
	m := ^uint64(0)
	for i, col := range c { if s.t[i][col] < m { m = s.t[i][col] } }
	return m
}
func (s *S) Add(k string)            { for i, c := range s.cols(k) { s.t[i][c]++ } }
func (s *S) ConsAdd(k string) {
	c := s.cols(k); tgt := s.est(c) + 1
	for i, col := range c { if s.t[i][col] < tgt { s.t[i][col] = tgt } }
}
func (s *S) Est(k string) uint64 { return s.est(s.cols(k)) }

func main() {
	plain, cons := NewS(4, 64), NewS(4, 64)
	stream := []string{}
	for i := 0; i < 50; i++ { stream = append(stream, "hot") }   // elephant
	for i := 0; i < 5; i++ { stream = append(stream, fmt.Sprintf("m%d", i)) } // mice
	stream = append(stream, "mouse")
	truth := map[string]int{}
	for _, k := range stream { plain.Add(k); cons.ConsAdd(k); truth[k]++ }
	fmt.Printf("mouse: true=%d plain=%d cons=%d\n", truth["mouse"], plain.Est("mouse"), cons.Est("mouse"))
	// conservative should be <= plain and both >= true(=1)
}
```

#### Java

```java
import java.util.*;
import java.util.zip.CRC32;

public class Conservative {
    int d, w; long[][] t;
    Conservative(int d, int w){ this.d=d; this.w=w; this.t=new long[d][w]; }
    int[] cols(String k){
        long a = Integer.toUnsignedLong(k.hashCode());
        CRC32 c = new CRC32(); c.update(k.getBytes());
        long b = c.getValue() | 1L;
        int[] cs = new int[d];
        for(int i=0;i<d;i++) cs[i]=(int)(((a+(long)i*b)%w+w)%w);
        return cs;
    }
    long est(int[] cs){ long m=Long.MAX_VALUE; for(int i=0;i<d;i++) m=Math.min(m,t[i][cs[i]]); return m; }
    void add(String k){ int[] cs=cols(k); for(int i=0;i<d;i++) t[i][cs[i]]++; }
    void consAdd(String k){ int[] cs=cols(k); long tg=est(cs)+1; for(int i=0;i<d;i++) if(t[i][cs[i]]<tg) t[i][cs[i]]=tg; }
    long estimate(String k){ return est(cols(k)); }

    public static void main(String[] a){
        Conservative plain=new Conservative(4,64), cons=new Conservative(4,64);
        List<String> stream=new ArrayList<>();
        for(int i=0;i<50;i++) stream.add("hot");
        for(int i=0;i<5;i++) stream.add("m"+i);
        stream.add("mouse");
        Map<String,Integer> truth=new HashMap<>();
        for(String k:stream){ plain.add(k); cons.consAdd(k); truth.merge(k,1,Integer::sum); }
        System.out.printf("mouse: true=%d plain=%d cons=%d%n",
            truth.get("mouse"), plain.estimate("mouse"), cons.estimate("mouse"));
    }
}
```

#### Python

```python
import hashlib


class S:
    def __init__(self, d, w):
        self.d, self.w = d, w
        self.t = [[0] * w for _ in range(d)]

    def _cols(self, k):
        h = hashlib.md5(k.encode()).digest()
        a = int.from_bytes(h[:8], "big")
        b = int.from_bytes(h[8:], "big") | 1
        return [(a + i * b) % self.w for i in range(self.d)]

    def _est(self, cols):
        return min(self.t[i][cols[i]] for i in range(self.d))

    def add(self, k):
        for i, c in enumerate(self._cols(k)):
            self.t[i][c] += 1

    def cons_add(self, k):
        cols = self._cols(k)
        tgt = self._est(cols) + 1
        for i, c in enumerate(cols):
            if self.t[i][c] < tgt:
                self.t[i][c] = tgt

    def est(self, k):
        return self._est(self._cols(k))


if __name__ == "__main__":
    plain, cons = S(4, 64), S(4, 64)
    stream = ["hot"] * 50 + [f"m{i}" for i in range(5)] + ["mouse"]
    truth = {}
    for k in stream:
        plain.add(k)
        cons.cons_add(k)
        truth[k] = truth.get(k, 0) + 1
    t = truth["mouse"]
    p, c = plain.est("mouse"), cons.est("mouse")
    print(f"mouse: true={t} plain={p} cons={c}")
    assert c <= p and p >= t and c >= t, "invariants violated"
```

**Expected behavior:** `mouse` has true count 1; both estimates are `≥ 1`; the conservative estimate is `≤` the plain estimate (often strictly less when `mouse` collides with the `hot` elephant). This is the empirical demonstration of the sandwich `true ≤ conservative ≤ plain` proved in `professional.md`.

---

## Final Tips

- Lead with the **min** and the **overcount-only** invariant — it's the one idea everything else hangs on.
- Be ready to **size the grid** on the spot: `w = e/eps`, `d = ln(1/delta)`, and explain *why* width fights error size and depth fights failure odds.
- Know the **proof skeleton**: Markov on one row (`1/e`) × `d` independent rows (`(1/e)^d ≤ delta`).
- Always name the **direction** of error when comparing: CMS over, Misra-Gries under, Bloom false-positive, HLL distinct-count.
- Mention **conservative update** and **CMS+heap** as the two upgrades that turn the toy into a production tool.

## Next step: [tasks.md](./tasks.md) — graded practice tasks (beginner, intermediate, advanced) in Go, Java, and Python.
