# van Emde Boas Tree (vEB) — Interview Preparation

> **Audience:** Engineers preparing for interviews that touch advanced data structures, integer ordered dictionaries, or the predecessor problem. Prerequisite: `junior.md` through `professional.md`. Below are **45 tiered questions** (Junior → Middle → Senior → Professional) with model-answer focus, followed by a **coding challenge** implemented in Go, Java, and Python.

---

## Table of Contents

1. [Junior Questions (1–12)](#junior)
2. [Middle Questions (13–25)](#middle)
3. [Senior Questions (26–37)](#senior)
4. [Professional Questions (38–45)](#professional)
5. [Coding Challenge — Build a vEB Integer Ordered Set](#coding-challenge)

---

<a name="junior"></a>
## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a van Emde Boas tree and what problem does it solve? | An **ordered dictionary** over a bounded integer universe `{0..u-1}` supporting insert/delete/member/min/max/successor/predecessor in `O(log log u)`. |
| 2 | What is the time complexity of each operation? | All of insert/delete/member/successor/predecessor are `O(log log u)`; `min`/`max` are `O(1)`. |
| 3 | What does `log log u` mean concretely for `u = 2^32`? | `log u = 32`, `log log u = 5`. Five recursion levels — versus ~20 for `O(log n)` on a million keys. |
| 4 | How is a key `x` split? | `high(x) = x / sqrt(u)` (which cluster), `low(x) = x % sqrt(u)` (position inside), `index(h,l) = h·sqrt(u)+l` rebuilds `x`. |
| 5 | What are the "summary" and "clusters"? | `sqrt(u)` **clusters**, each a `vEB(sqrt(u))` holding keys with a given `high`. The **summary** is a `vEB(sqrt(u))` recording which clusters are non-empty. |
| 6 | Why are `min` and `max` stored on the node itself? | `min`/`max` in `O(1)` (no recursion); and storing `min` *aside* keeps each insert/successor to one recursive call → `O(log log u)`. |
| 7 | What is the base case of the recursion? | `u = 2`: stores everything in `min`/`max`, no summary or clusters. |
| 8 | Walk through `successor(7)` on `u=16` with keys {2,3,13}. | `high(7)=1`; cluster 1 empty/no larger → ask `summary.successor(1)` → cluster 3 → read `cluster[3].min=1` → `index(3,1)=13`. |
| 9 | What is the space cost of a basic vEB tree? | `O(u)` — clusters allocated whether used or not, independent of `n`. |
| 10 | Can a vEB tree store strings or floats? | No. Keys must be **bounded integers** in `{0..u-1}`; the high/low split is integer arithmetic. |
| 11 | What does `NIL` (or `-1`) represent? | An empty `min`/`max`, or "no such key" returned by successor/predecessor. |
| 12 | How does `member(x)` work? | Check `x == min || x == max`; if `u==2` return false; else recurse into `cluster[high(x)].member(low(x))`. |

**Q8 detailed model answer.** With `u=16`, `sqrt(u)=4`. Keys 2,3 are in cluster 0 (`high=0`), key 13 in cluster 3 (`high=3`). The summary contains {0,3}. For `successor(7)`: `high(7)=1, low(7)=3`. Cluster 1 is empty, so we cannot stay; we ask `summary.successor(1)`, which returns 3 (the next non-empty cluster). The answer is `index(3, cluster[3].min)`. `cluster[3].min = 1` (since 13 = index(3,1)), so the result is `index(3,1) = 4·3+1 = 13`. Total: one recursion into the summary, then an `O(1)` field read.

---

<a name="middle"></a>
## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | Derive the recurrence for vEB operations. | `T(u) = T(sqrt(u)) + O(1)`; substitute `m=log u` → `S(m)=S(m/2)+O(1)=O(log m)` → `O(log log u)`. |
| 14 | Why exactly **one** recursive call per operation? | The summary (I4) tells whether the target cluster is empty, so insert/successor recurse into the summary **or** a cluster, never both. |
| 15 | What breaks if you store the min inside a cluster instead of aside? | Insert into an empty cluster would have to recurse to place it → two recursions → `T(u)=2T(sqrt u)+O(1)=O(log u)`. |
| 16 | Why is the **max** kept inside its cluster but the min is not? | `successor` tests `low(x) < cluster.max` in `O(1)` to decide whether to stay in the cluster; the min is held out to save a recursion. |
| 17 | Compare vEB with a balanced BST. | BST: `O(log n)`, any comparable keys, `O(n)` space, cache-OK. vEB: `O(log log u)`, integer keys, `O(u)` space, cache-hostile. |
| 18 | Why can't a hash table replace a vEB tree? | Hashing destroys order, so `successor`/`predecessor`/`min` are impossible; vEB is for *ordered* integer queries. |
| 19 | What makes `delete` the trickiest operation? | Deleting the aside-min requires promoting a new min from a cluster; emptying a cluster forces a summary delete — two textual recursive calls. |
| 20 | Why is `delete` still `O(log log u)` despite two recursive calls? | The summary delete only runs when the cluster delete emptied a one-element cluster (an `O(1)` path), so only one call does real work. |
| 21 | How do you handle a universe that is not a perfect square? | Split into upper sqrt `2^ceil(k/2)` (number of clusters) and lower sqrt `2^floor(k/2)` (cluster size); asymptotics unchanged. |
| 22 | How would you sort `n` integers with a vEB tree? | Insert all, then walk `min, successor, successor, ...` → `O(n log log u)` plus `O(u)` build. |
| 23 | How does vEB serve as an integer priority queue? | `push=insert`, `peekMin=min` (O(1)), `popMin=min then delete`; also gives successor/predecessor/max free. |
| 24 | What is the predecessor "min-aside" special case? | When no smaller cluster exists, you must still check `x > min` and return `min`, because the min lives in no cluster. |
| 25 | When does vEB lose to a sorted array in practice despite better Big-O? | `log log u` is a tiny constant (4–6); the array's contiguous, cache-friendly binary search often beats vEB's pointer chasing. |

**Q15 detailed model answer.** The whole `O(log log u)` result rests on the recurrence `T(u) = T(sqrt(u)) + O(1)`. If insert had to recurse into a cluster to *place* a key even when that cluster was empty, then inserting into an empty cluster would cost a summary recursion (to mark it non-empty) **plus** a cluster recursion (to store the element) → `T(u) = 2·T(sqrt(u)) + O(1)`. By the Master Theorem that solves to `T(u) = O(log u)`, identical to a balanced BST. Storing the min aside lets us set `cluster.min = cluster.max = low(x)` in `O(1)` without descending, keeping the single-recursion property.

---

<a name="senior"></a>
## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 26 | How do you reduce vEB space from `O(u)` to `O(n)`? | Replace dense cluster array with a **hash map** (lazy clusters) → `O(n)` space, `O(log log u)` *expected* time. |
| 27 | What is a y-fast trie and why prefer it? | x-fast trie over `O(n/log u)` representatives + balanced-BST bags of size `~log u`; `O(log log u)` time in deterministic `O(n)` space. |
| 28 | What is an x-fast trie and its space cost? | A depth-`log u` bit-trie with each level in a hash table; `O(log log u)` query via binary search over levels, but `O(n log u)` space. |
| 29 | Name real systems where vEB-style structures fit. | Timer/event schedulers, packet/QoS schedulers, IP-address indexing, integer-weight Dijkstra PQs. |
| 30 | Why is cache behavior the practical Achilles' heel? | Tiny scattered nodes → one cache miss per level; with `log log u ≈ 5`, a flat B-tree/array usually wins wall-clock despite worse Big-O. |
| 31 | How would you shard a vEB index across nodes? | **Range-shard on the high bits** (order-preserving) so successor stays cheap; never hash-shard (breaks ordered queries). |
| 32 | How do you make a vEB tree thread-safe? | Coarse reader-writer lock, or single-writer shards; the recursive mutation paths (esp. delete's min-promotion) aren't lock-free-friendly. |
| 33 | vEB vs hierarchical timing wheel for a scheduler? | Timing wheel: `O(1)` amortized, bucketed firing. vEB: exact ordered successor across the whole horizon. Pick by whether you need exact ordering. |
| 34 | vEB vs radix heap for Dijkstra? | Both exploit bounded integer weights; radix heap is cache-friendlier and usually faster in practice; vEB gives the cleaner `O(log log C)` bound. |
| 35 | What metrics would you alert on in production? | universe utilization `n/u`, node count (memory), op p99 latency, cache-miss rate, cluster fill ratio. |
| 36 | Failure mode: universe overflow. How handle? | Validate `0 <= x < u`; rebase/rescale keys, or use a wraparound-friendly timing wheel for time horizons. |
| 37 | When would you deliberately NOT use any vEB variant? | Sparse huge universe without hashing; cache-bound workload; non-integer keys; small `n` where `O(log n)` is already trivially fast. |

**Q30 detailed model answer.** vEB's asymptotic edge is `log log u` vs `log n`, but the *constant* matters enormously. For `u = 2^32`, `log log u = 5`: the structure does 5 levels of work. The catch is that each level dereferences a fresh, tiny, heap-scattered node — roughly one cache miss per level. A cache-friendly competitor like a flat sorted array does `log n ≈ 20` comparisons but all within a few contiguous cache lines, so it may incur *fewer* cache misses overall. Since memory latency dominates modern performance, the vEB tree frequently *loses* in wall-clock time. Seniors benchmark on the real universe and access pattern before deploying, and often choose a B-tree, radix heap, or timing wheel instead.

---

<a name="professional"></a>
## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 38 | State and prove the time recurrence solution. | `T(u)=T(sqrt u)+O(1)`; `m=log u`, `S(m)=S(m/2)+O(1)`, unroll `t=log m` steps → `O(log m)=O(log log u)`. |
| 39 | Prove the single-recursive-call property for insert. | Three mutually exclusive branches; (I4) makes summary-recursion XOR cluster-recursion; ≤1 recursive call. |
| 40 | Prove `delete` is worst-case `O(log log u)`. | When summary-delete fires, cluster-delete hit a one-element node (`O(1)` path); recursive work ≤ `T(sqrt u)+O(1)`. |
| 41 | Derive the `O(u)` space bound. | `P(u)=1+P(sqrt u)+sqrt(u)·P(sqrt u)`; guess `P(u)≤cu−d`, induction gives `P(u)=O(u)`. |
| 42 | Prove hashed clusters give `O(n)` space. | Charge each allocated record to the first key entering its subtree; injective per subtree; ≤ `O(n)` non-empty subtrees. |
| 43 | Why does the y-fast trie need the BST bags? | Grouping `n` keys into `Θ(n/log u)` reps shrinks x-fast space from `O(n log u)` to `O(n)`; bag search is `O(log log u)` since `|bag|=O(log u)`. |
| 44 | State the relevant lower bound. | Pătraşcu–Thorup: for `w=Θ(log u)` predecessor, vEB's `O(log log u)` is optimal when `n` is poly-related to `u`; fusion trees (`O(log_w n)`) win when `u≫n`. |
| 45 | How does vEB beat the comparison `Ω(log n)` bound? | It is a **word-RAM / integer** structure: it uses bit-splitting and array/hash indexing, not comparisons, so the comparison lower bound does not apply. |

**Q40 detailed model answer.** `delete` contains two textual recursive calls: (R1) `cluster[high(x)].delete(low(x))` and (R2) `summary.delete(high(x))`. (R2) executes only when (R1) leaves `cluster[high(x)]` empty. A vEB node becomes empty only if it held exactly one element, and deleting from a one-element node hits the first guard `if min==max { min=max=NIL; return }` — `O(1)`, no recursion. So whenever (R2) does real work, (R1) was `O(1)`. The min-promotion preamble (reading `summary.min` and `cluster[summary.min].min`) is `O(1)` field reads. Therefore the recursive work obeys `C(u) ≤ C(sqrt u) + O(1)` in every case, and by the §4 substitution `C(u) = O(log log u)` worst-case — no amortization needed.

---

<a name="coding-challenge"></a>
## Coding Challenge — Build a vEB Integer Ordered Set

> **Problem.** Implement an ordered set over the universe `{0 .. u-1}` (with `u` a power of two) supporting `insert(x)`, `member(x)`, `successor(x)`, and `min()`/`max()` in `O(log log u)` / `O(1)`. Then use it to solve: given `u` and a list of operations, process them and return the outputs of all `successor` and `member` queries in order.
>
> Operations: `["insert 2", "insert 3", "insert 13", "succ 7", "member 3", "min", "succ 13"]`
> Expected output: `[13, true, 2, NIL]` (successor of 7 is 13; member 3 is true; min is 2; successor of 13 is NIL).
>
> Constraints: `0 <= x < u`, `u` up to `2^16`. All four core ops must be `O(log log u)` / `O(1)`. Solve in all three languages.

#### Go

```go
package main

import (
	"fmt"
	"strconv"
	"strings"
)

const NIL = -1

type VEB struct {
	u, lower, upper int
	min, max        int
	summary         *VEB
	cluster         []*VEB
}

func bits(u int) int { b := 0; for (1 << b) < u { b++ }; return b }

func New(u int) *VEB {
	t := &VEB{u: u, min: NIL, max: NIL}
	if u <= 2 {
		return t
	}
	k := bits(u)
	t.lower = 1 << (k / 2)
	t.upper = 1 << ((k + 1) / 2)
	t.summary = New(t.upper)
	t.cluster = make([]*VEB, t.upper)
	for i := range t.cluster {
		t.cluster[i] = New(t.lower)
	}
	return t
}

func (t *VEB) high(x int) int     { return x / t.lower }
func (t *VEB) low(x int) int      { return x % t.lower }
func (t *VEB) index(h, l int) int { return h*t.lower + l }

func (t *VEB) Member(x int) bool {
	if x == t.min || x == t.max {
		return true
	}
	if t.u <= 2 {
		return false
	}
	return t.cluster[t.high(x)].Member(t.low(x))
}

func (t *VEB) Insert(x int) {
	if t.min == NIL {
		t.min, t.max = x, x
		return
	}
	if x < t.min {
		x, t.min = t.min, x
	}
	if t.u > 2 {
		h, l := t.high(x), t.low(x)
		if t.cluster[h].min == NIL {
			t.summary.Insert(h)
			t.cluster[h].min, t.cluster[h].max = l, l
		} else {
			t.cluster[h].Insert(l)
		}
	}
	if x > t.max {
		t.max = x
	}
}

func (t *VEB) Successor(x int) int {
	if t.u <= 2 {
		if x == 0 && t.max == 1 {
			return 1
		}
		return NIL
	}
	if t.min != NIL && x < t.min {
		return t.min
	}
	h, l := t.high(x), t.low(x)
	if t.cluster[h].max != NIL && l < t.cluster[h].max {
		return t.index(h, t.cluster[h].Successor(l))
	}
	c := t.summary.Successor(h)
	if c == NIL {
		return NIL
	}
	return t.index(c, t.cluster[c].min)
}

func process(u int, ops []string) []string {
	t := New(u)
	var out []string
	for _, op := range ops {
		f := strings.Fields(op)
		switch f[0] {
		case "insert":
			x, _ := strconv.Atoi(f[1])
			t.Insert(x)
		case "member":
			x, _ := strconv.Atoi(f[1])
			out = append(out, strconv.FormatBool(t.Member(x)))
		case "succ":
			x, _ := strconv.Atoi(f[1])
			r := t.Successor(x)
			if r == NIL {
				out = append(out, "NIL")
			} else {
				out = append(out, strconv.Itoa(r))
			}
		case "min":
			out = append(out, strconv.Itoa(t.min))
		case "max":
			out = append(out, strconv.Itoa(t.max))
		}
	}
	return out
}

func main() {
	ops := []string{"insert 2", "insert 3", "insert 13", "succ 7", "member 3", "min", "succ 13"}
	fmt.Println(process(16, ops)) // [13 true 2 NIL]
}
```

#### Java

```java
import java.util.*;

public class Solution {
    static final int NIL = -1;

    static final class VEB {
        final int u, lower, upper;
        int min = NIL, max = NIL;
        VEB summary; VEB[] cluster;

        VEB(int u) {
            this.u = u;
            if (u <= 2) { lower = upper = 0; return; }
            int k = bits(u);
            lower = 1 << (k / 2);
            upper = 1 << ((k + 1) / 2);
            summary = new VEB(upper);
            cluster = new VEB[upper];
            for (int i = 0; i < upper; i++) cluster[i] = new VEB(lower);
        }
        static int bits(int u){ int b=0; while((1<<b)<u) b++; return b; }
        int high(int x){ return x / lower; }
        int low(int x){ return x % lower; }
        int index(int h,int l){ return h*lower+l; }

        boolean member(int x){
            if (x==min || x==max) return true;
            if (u<=2) return false;
            return cluster[high(x)].member(low(x));
        }
        void insert(int x){
            if (min==NIL){ min=max=x; return; }
            if (x<min){ int t=min; min=x; x=t; }
            if (u>2){
                int h=high(x), l=low(x);
                if (cluster[h].min==NIL){ summary.insert(h); cluster[h].min=cluster[h].max=l; }
                else cluster[h].insert(l);
            }
            if (x>max) max=x;
        }
        int successor(int x){
            if (u<=2) return (x==0 && max==1) ? 1 : NIL;
            if (min!=NIL && x<min) return min;
            int h=high(x), l=low(x);
            if (cluster[h].max!=NIL && l<cluster[h].max)
                return index(h, cluster[h].successor(l));
            int c=summary.successor(h);
            if (c==NIL) return NIL;
            return index(c, cluster[c].min);
        }
    }

    static List<String> process(int u, String[] ops) {
        VEB t = new VEB(u);
        List<String> out = new ArrayList<>();
        for (String op : ops) {
            String[] f = op.split("\\s+");
            switch (f[0]) {
                case "insert": t.insert(Integer.parseInt(f[1])); break;
                case "member": out.add(Boolean.toString(t.member(Integer.parseInt(f[1])))); break;
                case "succ": {
                    int r = t.successor(Integer.parseInt(f[1]));
                    out.add(r == NIL ? "NIL" : Integer.toString(r));
                    break;
                }
                case "min": out.add(Integer.toString(t.min)); break;
                case "max": out.add(Integer.toString(t.max)); break;
            }
        }
        return out;
    }

    public static void main(String[] args) {
        String[] ops = {"insert 2","insert 3","insert 13","succ 7","member 3","min","succ 13"};
        System.out.println(process(16, ops)); // [13, true, 2, NIL]
    }
}
```

#### Python

```python
NIL = -1

class VEB:
    def __init__(self, u):
        self.u = u
        self.min = self.max = NIL
        if u <= 2:
            self.lower = self.upper = 0
            self.summary = None; self.cluster = []
            return
        k = (u - 1).bit_length()
        self.lower = 1 << (k // 2)
        self.upper = 1 << ((k + 1) // 2)
        self.summary = VEB(self.upper)
        self.cluster = [VEB(self.lower) for _ in range(self.upper)]

    def high(self, x): return x // self.lower
    def low(self, x):  return x % self.lower
    def index(self, h, l): return h * self.lower + l

    def member(self, x):
        if x == self.min or x == self.max: return True
        if self.u <= 2: return False
        return self.cluster[self.high(x)].member(self.low(x))

    def insert(self, x):
        if self.min == NIL: self.min = self.max = x; return
        if x < self.min: x, self.min = self.min, x
        if self.u > 2:
            h, l = self.high(x), self.low(x)
            if self.cluster[h].min == NIL:
                self.summary.insert(h); self.cluster[h].min = self.cluster[h].max = l
            else:
                self.cluster[h].insert(l)
        if x > self.max: self.max = x

    def successor(self, x):
        if self.u <= 2:
            return 1 if (x == 0 and self.max == 1) else NIL
        if self.min != NIL and x < self.min: return self.min
        h, l = self.high(x), self.low(x)
        if self.cluster[h].max != NIL and l < self.cluster[h].max:
            return self.index(h, self.cluster[h].successor(l))
        c = self.summary.successor(h)
        if c == NIL: return NIL
        return self.index(c, self.cluster[c].min)


def process(u, ops):
    t = VEB(u)
    out = []
    for op in ops:
        f = op.split()
        if f[0] == "insert":
            t.insert(int(f[1]))
        elif f[0] == "member":
            out.append("true" if t.member(int(f[1])) else "false")
        elif f[0] == "succ":
            r = t.successor(int(f[1]))
            out.append("NIL" if r == NIL else str(r))
        elif f[0] == "min":
            out.append(str(t.min))
        elif f[0] == "max":
            out.append(str(t.max))
    return out


if __name__ == "__main__":
    ops = ["insert 2", "insert 3", "insert 13", "succ 7", "member 3", "min", "succ 13"]
    print(process(16, ops))  # ['13', 'true', '2', 'NIL']
```

**Discussion.** Every query runs in `O(log log u)` (`successor`, `member`) or `O(1)` (`min`/`max`). The interviewer may follow up with: *reduce the space to `O(n)`* (hash the clusters — see `senior.md`), *add `delete`* (handle the aside-min promotion — see `middle.md`), or *why not a TreeSet?* (`O(log n)` and cache-friendlier, but `O(log log u)` is the headline win for bounded integer universes; in practice benchmark both).

---

## Follow-up Challenge — Add `delete` and `predecessor`

> **Problem.** Extend the ordered set from the main challenge with `delete(x)` and `predecessor(x)`, both `O(log log u)`. Then verify, with a randomized harness, that a mixed sequence of insert/delete/successor/predecessor stays consistent with a language-native sorted set. The delete must correctly **promote a new min** when the aside-min is removed and **clean up the summary** when a cluster empties.

The critical edge cases the interviewer is probing:

1. **Deleting the aside-min** — you cannot just clear a cluster bit, because the min is stored on the node, not in a cluster. You must promote the smallest real element (`index(summary.min, cluster[summary.min].min)`) to be the new `min`, *then* delete that promoted value from its cluster (where it still resides as a duplicate of the new min — careful: after promotion the value is the new `min` and must be removed from the cluster so it lives only aside).
2. **Emptying a cluster** — when the last key leaves a cluster, you must `summary.delete(high(x))`, and if you deleted the `max`, patch it from the new summary max.
3. **Predecessor's aside-min special case** — when no earlier non-empty cluster exists, you must still return `min` if `x > min`, because the min is in no cluster.

#### Go

```go
func (t *VEB) Predecessor(x int) int {
	if t.u <= 2 {
		if x == 1 && t.min == 0 {
			return 0
		}
		return NIL
	}
	if t.max != NIL && x > t.max {
		return t.max
	}
	h, l := t.high(x), t.low(x)
	if t.cluster[h].min != NIL && l > t.cluster[h].min {
		return t.index(h, t.cluster[h].Predecessor(l))
	}
	c := t.summary.Predecessor(h)
	if c == NIL {
		if t.min != NIL && x > t.min { // the aside-min special case
			return t.min
		}
		return NIL
	}
	return t.index(c, t.cluster[c].max)
}

func (t *VEB) Delete(x int) {
	if t.min == t.max {
		t.min, t.max = NIL, NIL
		return
	}
	if t.u <= 2 {
		if x == 0 {
			t.min = 1
		} else {
			t.min = 0
		}
		t.max = t.min
		return
	}
	if x == t.min { // promote a new min from the first non-empty cluster
		first := t.summary.min
		x = t.index(first, t.cluster[first].min)
		t.min = x
	}
	h := t.high(x)
	t.cluster[h].Delete(t.low(x))
	if t.cluster[h].min == NIL { // cluster emptied
		t.summary.Delete(h)
		if x == t.max {
			sm := t.summary.max
			if sm == NIL {
				t.max = t.min
			} else {
				t.max = t.index(sm, t.cluster[sm].max)
			}
		}
	} else if x == t.max {
		t.max = t.index(h, t.cluster[h].max)
	}
}
```

#### Java

```java
int predecessor(int x) {
    if (u <= 2) return (x == 1 && min == 0) ? 0 : NIL;
    if (max != NIL && x > max) return max;
    int h = high(x), l = low(x);
    if (cluster[h].min != NIL && l > cluster[h].min)
        return index(h, cluster[h].predecessor(l));
    int c = summary.predecessor(h);
    if (c == NIL) return (min != NIL && x > min) ? min : NIL;
    return index(c, cluster[c].max);
}

void delete(int x) {
    if (min == max) { min = max = NIL; return; }
    if (u <= 2) { min = (x == 0) ? 1 : 0; max = min; return; }
    if (x == min) {
        int first = summary.min;
        x = index(first, cluster[first].min);
        min = x;
    }
    int h = high(x);
    cluster[h].delete(low(x));
    if (cluster[h].min == NIL) {
        summary.delete(h);
        if (x == max) {
            int sm = summary.max;
            max = (sm == NIL) ? min : index(sm, cluster[sm].max);
        }
    } else if (x == max) {
        max = index(h, cluster[h].max);
    }
}
```

#### Python

```python
def predecessor(self, x):
    if self.u <= 2:
        return 0 if (x == 1 and self.min == 0) else NIL
    if self.max != NIL and x > self.max:
        return self.max
    h, l = self.high(x), self.low(x)
    if self.cluster[h].min != NIL and l > self.cluster[h].min:
        return self.index(h, self.cluster[h].predecessor(l))
    c = self.summary.predecessor(h)
    if c == NIL:
        return self.min if (self.min != NIL and x > self.min) else NIL
    return self.index(c, self.cluster[c].max)

def delete(self, x):
    if self.min == self.max:
        self.min = self.max = NIL
        return
    if self.u <= 2:
        self.min = 1 if x == 0 else 0
        self.max = self.min
        return
    if x == self.min:                      # promote new min
        first = self.summary.min
        x = self.index(first, self.cluster[first].min)
        self.min = x
    h = self.high(x)
    self.cluster[h].delete(self.low(x))
    if self.cluster[h].min == NIL:         # cluster emptied
        self.summary.delete(h)
        if x == self.max:
            sm = self.summary.max
            self.max = self.min if sm == NIL else self.index(sm, self.cluster[sm].max)
    elif x == self.max:
        self.max = self.index(h, self.cluster[h].max)
```

**Randomized verification (pseudocode the interviewer wants to hear):**

```text
ref = native_sorted_set()
t   = VEB(u)
for 100000 random ops:
    pick op ∈ {insert, delete, successor, predecessor} and random x in [0,u)
    apply to both (delete only if member; insert only if not member)
    assert t.successor(x)   == ref.successor(x)   (NIL ↔ none)
    assert t.predecessor(x) == ref.predecessor(x)
    assert t.min == ref.min and t.max == ref.max
```

If this passes for 100k ops across many seeds, the delete/predecessor logic — including the two subtle aside-min cases — is almost certainly correct. The single most common bug it catches is `predecessor` returning `NIL` for small keys because the implementer forgot the `x > min` aside-min branch.

**Why delete stays `O(log log u)`** (the interviewer's final probe): although `delete` contains two recursive calls (`cluster.delete` then possibly `summary.delete`), the summary delete fires only when the cluster delete emptied a one-element cluster — an `O(1)` path. So only one recursive call ever does super-constant work, preserving `T(u) = T(sqrt(u)) + O(1) = O(log log u)`.

---

> Continue practicing with [`tasks.md`](./tasks.md) for graded implementation and benchmarking exercises.
