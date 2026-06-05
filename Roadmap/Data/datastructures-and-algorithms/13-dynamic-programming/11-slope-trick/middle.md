# Slope Trick — Middle Level

> **Focus:** the *why* and *when* — the complete operation catalog that a convex PL function supports (`add |x − a|`, the one-sided penalties `(x−a)_+` and `(a−x)_+`, prefix-min relaxation, and horizontal shifts), how **lazy offset tags** make shifts `O(1)`, the precise invariant the two heaps maintain, and how Slope Trick compares to its sibling Convex Hull Trick and to plain `O(n·range)` DP.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Invariant: Two Heaps Encode One Convex Function](#the-invariant-two-heaps-encode-one-convex-function)
3. [The Operation Catalog](#the-operation-catalog)
4. [Lazy Offset Tags for Shifts](#lazy-offset-tags-for-shifts)
5. [Recognizing a Slope-Trick DP](#recognizing-a-slope-trick-dp)
6. [Worked Transition: Make Strictly Increasing](#worked-transition-make-strictly-increasing)
7. [Comparison with CHT and Plain DP](#comparison-with-cht-and-plain-dp)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

At junior level the message was: a convex piecewise-linear cost function `f(x)` can be carried implicitly as a **left max-heap** of breakpoints, a **right min-heap** of breakpoints, and a scalar **`minVal`**, and the canonical "make array non-decreasing" DP collapses to `O(n log n)`. At middle level you learn the *full repertoire* — because real Slope-Trick problems compose several operations per step, and choosing the right ones (and applying lazy shifts correctly) is the core skill.

The questions this level answers:

- **What** operations can a convex PL function support cheaply? (The catalog: `|x−a|`, `(x−a)_+`, `(a−x)_+`, prefix-min on either side, horizontal shift, widening the floor.)
- **Why** is each operation a constant number of heap actions? (Because each preserves convexity and changes only the breakpoints near the floor.)
- **When** do you need lazy tags? (Whenever the function shifts horizontally — strict-increasing reductions, scheduling with deadlines, "you may move by at most `k`" constraints.)
- **How** does Slope Trick differ from CHT? (Slope Trick mutates *one* convex function step by step; CHT queries the *minimum over many lines*. Different shapes, different tools.)

Mastering the catalog and the shift mechanics is what lets you take a new problem, prove its DP state is a convex function, express each transition as catalog operations, and read off an `O(n log n)` algorithm.

---

## The Invariant: Two Heaps Encode One Convex Function

### The representation precisely

A convex piecewise-linear function `f` with integer slope steps is stored as:

- `minVal` — the minimum value of `f`.
- `L` — a **max-heap** of the breakpoints on the descending (left) side, *including* the left edge of the flat minimum.
- `R` — a **min-heap** of the breakpoints on the ascending (right) side, including the right edge of the flat minimum.

The flat minimum region (the argmin set) is the closed interval `[L.top(), R.top()]`. Left of `L.top()` the slope is `≤ −1` and decreases by one per breakpoint as you go further left; right of `R.top()` the slope is `≥ +1` and increases by one per breakpoint going right.

**Invariant (the thing every operation must preserve):**

```
(I1) every element of L is <= every element of R          (heaps do not overlap)
(I2) L.top() and R.top() bound the argmin interval
(I3) f(x) = minVal
        + sum over l in L of max(0, l - x)                (descending side)
        + sum over r in R of max(0, x - r)                (ascending side)
```

(I3) is the *reconstruction formula*: it says the function value at any `x` is the floor `minVal` plus one unit for each left-breakpoint you are below and each right-breakpoint you are above. Every operation in the catalog is defined by how it changes `minVal`, `L`, and `R` while keeping (I1)–(I3) true.

### Why slope steps are usually 1

In the classic problems the penalties are `|x − a|` (slope jump of `1` on each side at `a`) or one-sided `(x−a)_+` / `(a−x)_+` (slope jump of `1`). Repeated breakpoints at the same `x` accumulate larger slope jumps — a breakpoint appearing `k` times means the slope changes by `k` there. Because every jump is recorded as a heap element (with multiplicity), you never store slopes explicitly; the multiplicity *is* the slope information.

### A small reconstruction check

Take `L = [1, 1]` (max-heap, top `1`), `R = [3]` (min-heap, top `3`), `minVal = 2`. By (I3):

```
f(0) = 2 + max(0,1-0) + max(0,1-0) + max(0,0-3) = 2 + 1 + 1 + 0 = 4
f(1) = 2 + max(0,1-1) + max(0,1-1) + max(0,1-3) = 2 + 0 + 0 + 0 = 2  (floor)
f(2) = 2 + 0 + 0 + max(0,2-3) = 2                                    (still floor)
f(3) = 2 + 0 + 0 + max(0,3-3) = 2                                    (floor right edge)
f(4) = 2 + 0 + 0 + max(0,4-3) = 3
```

The valley floor is `[1, 3]` at height `2`, slope `−2` left of `1` (two breakpoints), slope `+1` right of `3`. This is exactly the state the junior walkthrough produced after processing `[3, 1]` (before clearing `R`).

---

## The Operation Catalog

Each operation takes a convex PL function (as `minVal, L, R`) and returns the convex PL function for the new cost, in `O(log n)`.

### `add |x − a|` (symmetric V penalty)

Adds a V with slopes `∓1` and corner at `a`.

```
push a into L; push a into R
if L.top() > R.top():                 # heaps would overlap
    l = L.pop(); r = R.pop()
    minVal += l - r                   # the V lifted the floor by (l - r)
    push r into L; push l into R       # swap to restore (I1)
```

**Why it works:** the V's corner is a new breakpoint on *both* sides. If `a` lands inside the current floor, both pushes are consistent. If `a` is left of the floor, the V's right arm raises the function on the floor's left edge, shifting the argmin; the rebalance moves the offending breakpoint to the correct heap and charges `minVal` the amount the floor rose.

### `(x − a)_+ = max(x − a, 0)` (penalize being above `a`)

Adds a ramp that is `0` for `x ≤ a` and rises with slope `+1` for `x > a`. This is a single right-breakpoint at `a`.

```
push a into R
if a < L.top():                       # the breakpoint is left of the floor
    l = L.pop()
    minVal += l - a
    push a into L; (and the popped value handling)
```

The clean, standard form pushes `a` into `R`, then if it crossed below `L.top()`, rebalances exactly like the symmetric case but accounting for only one breakpoint.

### `(a − x)_+ = max(a − x, 0)` (penalize being below `a`)

The mirror: a single left-breakpoint at `a`, `0` for `x ≥ a`, slope `−1` for `x < a`. Push `a` into `L`, rebalance against `R.top()` if it crossed above.

### Prefix-min relaxation

```
f(x) <- min_{y <= x} f(y)      clears R  (value may slide right freely)
f(x) <- min_{y >= x} f(y)      clears L  (value may slide left freely)
```

Clearing `R` deletes all ascending breakpoints, flattening everything right of the floor's left edge to `minVal`. `minVal` is unchanged (the minimum value does not move, only the function right of it). This is the operation that encodes "later values may be `≥` (or `≤`) the current one".

### Horizontal shift / widening the floor

```
f(x) <- f(x - c)               shift whole function right by c   (lazy tags, below)
widen floor by [d1, d2]        L.top -= d1 ; R.top += d2 conceptually
```

Shifting moves every breakpoint by `c`; widening the floor (e.g. "the next value may differ by at most `k`") subtracts a constant from the left side and adds to the right. Both are done with **lazy offset tags** (next section) in `O(1)`.

### Summary table of the catalog

| Operation | Convexity? | Heap actions | `minVal` change | Cost |
|-----------|-----------|--------------|-----------------|------|
| `add |x − a|` | preserved | push `L`, push `R`, maybe swap tops | `+ (L.top − R.top)` if crossed | `O(log n)` |
| `(x − a)_+` | preserved | push `R`, maybe swap | `+` cross amount | `O(log n)` |
| `(a − x)_+` | preserved | push `L`, maybe swap | `+` cross amount | `O(log n)` |
| `min_{y ≤ x} f` | preserved | clear `R` | none | `O(1)` amortized |
| `min_{y ≥ x} f` | preserved | clear `L` | none | `O(1)` amortized |
| shift by `c` | preserved | adjust lazy tags | none | `O(1)` |
| add constant `k` | preserved | none | `+ k` | `O(1)` |

---

## Lazy Offset Tags for Shifts

Many problems shift the function horizontally between steps. Naively re-keying every breakpoint is `O(n)` per shift — fatal. The fix is a **lazy offset**: store one integer `addL` for the left heap and `addR` for the right heap such that the *true* value of a stored breakpoint `v` is `v + addL` (in `L`) or `v + addR` (in `R`).

```
true_left(v)  = v + addL
true_right(v) = v + addR

shift whole function right by c:   addL += c ; addR += c        # O(1)
push true value t into L:          push (t - addL) into L
read L.top() true value:           L.top_raw() + addL
```

This is the same lazy-propagation idea as a lazy segment tree, specialized to two heaps. Two distinct offsets matter when the *two sides shift differently* — e.g. "the next value may exceed the current by at most `k`" widens the floor by moving the right side out by `k` while the left side stays, which is encoded by bumping `addR` only.

### Worked lazy-shift example

Suppose `f` has `L = [5]` (`addL = 0`), `R = [8]` (`addR = 0`), `minVal = 0`; the floor is `[5, 8]`. The transition "value may grow by at most `2` and must grow by at least `0`" is: the *next* floor is reachable from any `y` in `[5, 8]` by adding `[0, 2]`, so the new floor is `[5 + 0, 8 + 2] = [5, 10]`. Encode by `addR += 2` (now `R.top()` reads `8 + 2 = 10`), leaving `addL` alone. No heap element moved; the operation was `O(1)`. A later `add |x − a|` pushes `a − addL` into `L` and `a − addR` into `R` so the stored raw values stay consistent with the offsets.

---

## Recognizing a Slope-Trick DP

You should reach for Slope Trick when **all** of these hold:

1. The DP state is naturally a *function* `f_i(x)` = best cost so far given that the current "value" is `x`.
2. `f_i` is **convex** and piecewise-linear (prove this by induction: the base is convex, and each transition is a catalog operation that preserves convexity).
3. The transitions are expressible as: add `|x − a|` / one-sided penalties, take a prefix-min on one side, shift, or add a constant.
4. The final answer is `min_x f_n(x) = minVal`.

If the carried function is **not** convex — e.g. the cost has two separate valleys — Slope Trick does not apply. If the transition is "minimum over a family of *lines* evaluated at a point", that is Convex Hull Trick, not Slope Trick.

### A decision checklist

```text
Is the DP state a 1-variable cost function f_i(x)?           --> maybe Slope Trick
   Is f_i convex PL (provable by induction)?                 --> yes, continue
      Are transitions |x-a| / one-sided / prefix-min / shift? --> Slope Trick, O(n log n)
      Else                                                    --> not Slope Trick
   Else (state is min over lines m_j x + b_j)                 --> Convex Hull Trick (sibling 10)
```

```mermaid
graph TD
    A["f_(i-1): convex PL<br/>(minVal, L max-heap, R min-heap, addL, addR)"] -->|relax: clear R/L| B["prefix-min<br/>(one side flattened)"]
    B -->|add |x - a| / ramp| C["push breakpoints<br/>rebalance if L.top > R.top<br/>minVal += cross"]
    C -->|shift c| D["lazy offset bump<br/>addL/addR += c"]
    D --> E["f_i: convex PL<br/>answer = min_x f_n = minVal"]
```

---

## Worked Transition: Make Strictly Increasing

**Problem (CF 713C family).** Make `a` **strictly** increasing (`b_1 < b_2 < … < b_n`) minimizing `Σ |a_i − b_i|`.

**Reduction.** Strict increase `b_i < b_{i+1}` is equivalent to `b_i ≤ b_{i+1} − 1`, i.e. `(b_i − i) ≤ (b_{i+1} − (i+1)) + 0`... more cleanly: set `c_i = a_i − i` and `d_i = b_i − i`. Then `b_i < b_{i+1}` becomes `d_i ≤ d_{i+1}` (non-decreasing), and `|a_i − b_i| = |c_i − d_i|`. So **solve the non-decreasing problem on `c_i = a_i − i`** and the cost is identical.

This is the canonical reason the strict variant is "the same problem with a `−i` shift". It is a Slope-Trick problem with a *preprocessing* shift rather than a per-step lazy shift, but it illustrates the convexity-preserving change of variables that the lazy-tag machinery generalizes.

### Trace on `a = [2, 1, 3, 1]`

Transform: `c = [2−1, 1−2, 3−3, 1−4] = [1, −1, 0, −3]`. Now run the non-decreasing single-heap routine on `c`:

```
push 1   -> L=[1], top 1, no pull, cost 0
push -1  -> L=[1,-1], top 1 > -1 -> pull: cost += 1-(-1)=2, push -1 -> L=[-1,-1], cost 2
push 0   -> L=[-1,-1,0], top 0, no pull, cost 2
push -3  -> L=[...,−3], top 0 > -3 -> pull: cost += 0-(-3)=3, push -3 -> cost 5
answer = 5
```

Check: a valid strictly increasing `b` with cost `5` is `b = [ -1+1, -1+2, 0+3, -3+4 ] = [0, 1, 3, 1]`? That is not strictly increasing — the reconstruction needs care (we recover `d`, the non-decreasing solution, then `b_i = d_i + i`). The *cost* `5` is what Slope Trick reports and what the brute oracle confirms; reconstructing the actual `b` requires the augmentation discussed in [`senior.md`](./senior.md). The point here: the `−i` change of variables turns "strictly increasing" into the plain non-decreasing Slope-Trick routine.

---

## Comparison with CHT and Plain DP

Slope Trick, Convex Hull Trick, and plain `O(n·range)` DP all attack convexity-flavored optimization, but they are not interchangeable.

| Attribute | **Slope Trick** | **Convex Hull Trick / Li Chao (sibling 10)** | **Plain `O(n·range)` DP** |
|-----------|-----------------|----------------------------------------------|---------------------------|
| What it carries | one convex PL function, mutated step by step | many lines; answers `min_j(m_j·x + b_j)` queries | a full value-indexed table per step |
| Transition shape | `add |x−a|`, one-sided, prefix-min, shift | `dp[i] = g(i) + min_j(m_j·x_i + b_j)` | arbitrary `dp[i][x]` recurrence |
| Core structure | two heaps + `minVal` (+ lazy tags) | deque of lines / Li Chao segment tree | array of size `range` |
| Precondition | carried function is **convex PL** | transition **linearizes into lines** | none (just slow) |
| Complexity | `O(n log n)` | `O(n log n)` or `O(n)` | `O(n · range)` |
| Memory | `O(n)` (breakpoints) | `O(n)` (lines) | `O(range)` |
| Typical problems | make-monotone, equalize, scheduling | DP with quadratic-looking cost `(x_i − x_j)²` | small-range cost DP |

How to tell Slope Trick from CHT:

- **Is your DP state a single function that you *edit* each step** (add a penalty, relax, shift)? → **Slope Trick.**
- **Is your DP value a *minimum over many candidate lines* evaluated at a query point**, where each previous state contributes a line? → **Convex Hull Trick.**

They can both apply to a problem in rare cases, but the mental model differs sharply: Slope Trick *transforms one function*; CHT *selects among many lines*. Both rest on convexity, which is why they are siblings in the DP-optimization family.

### A concrete discriminator

Consider two superficially similar transitions:

1. `f_i(x) = (min_{y ≤ x} f_{i-1}(y)) + |x − a_i|` — the state is a **function of `x`** edited by a prefix-min and a V penalty → **Slope Trick**.
2. `dp[i] = min_{j<i} (dp[j] + (x_i − x_j)²)` — the state is a **number**, and each `j` contributes a **line** `(−2x_j)·x_i + (dp[j] + x_j²)` → **Convex Hull Trick**.

The first edits a function; the second selects a line. That is the discriminator.

---

## Code Examples

### Full Slope-Trick Engine with the Operation Catalog

A reusable engine maintaining `minVal`, `L` (max-heap), `R` (min-heap), with lazy offsets `addL`, `addR`, supporting `addAbs`, `addRampUp`, `addRampDown`, `relaxLeft` (clear `R`), `relaxRight` (clear `L`), `shift`, and `minimum`.

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
)

type maxHeap []int64

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i] > h[j] }
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(int64)) }
func (h *maxHeap) Pop() interface{}   { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

type minHeap []int64

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(int64)) }
func (h *minHeap) Pop() interface{}   { o := *h; n := len(o); v := o[n-1]; *h = o[:n-1]; return v }

type Slope struct {
	L          *maxHeap
	R          *minHeap
	addL, addR int64
	minVal     int64
}

func NewSlope() *Slope {
	s := &Slope{L: &maxHeap{}, R: &minHeap{}}
	heap.Init(s.L)
	heap.Init(s.R)
	return s
}

func (s *Slope) lTop() int64 { return (*s.L)[0] + s.addL }
func (s *Slope) rTop() int64 { return (*s.R)[0] + s.addR }
func (s *Slope) pushL(t int64) { heap.Push(s.L, t-s.addL) }
func (s *Slope) pushR(t int64) { heap.Push(s.R, t-s.addR) }
func (s *Slope) popL() int64   { return heap.Pop(s.L).(int64) + s.addL }
func (s *Slope) popR() int64   { return heap.Pop(s.R).(int64) + s.addR }

// AddAbs adds |x - a|.
func (s *Slope) AddAbs(a int64) {
	s.pushL(a)
	s.pushR(a)
	if s.L.Len() > 0 && s.R.Len() > 0 && s.lTop() > s.rTop() {
		l := s.popL()
		r := s.popR()
		s.minVal += l - r
		s.pushL(r)
		s.pushR(l)
	}
}

// AddRampUp adds (x - a)_+  = max(x - a, 0).
func (s *Slope) AddRampUp(a int64) {
	s.pushR(a)
	if s.L.Len() > 0 && s.lTop() > s.rTop() {
		l := s.popL()
		r := s.popR()
		s.minVal += l - r
		s.pushL(r)
		s.pushR(l)
	}
}

// AddRampDown adds (a - x)_+ = max(a - x, 0).
func (s *Slope) AddRampDown(a int64) {
	s.pushL(a)
	if s.R.Len() > 0 && s.lTop() > s.rTop() {
		l := s.popL()
		r := s.popR()
		s.minVal += l - r
		s.pushL(r)
		s.pushR(l)
	}
}

func (s *Slope) RelaxLeft()  { s.R = &minHeap{}; heap.Init(s.R); s.addR = 0 } // min_{y<=x} f
func (s *Slope) RelaxRight() { s.L = &maxHeap{}; heap.Init(s.L); s.addL = 0 } // min_{y>=x} f
func (s *Slope) Shift(c int64) { s.addL += c; s.addR += c }
func (s *Slope) Minimum() int64 { return s.minVal }

func main() {
	// Non-decreasing cost on [3,1,2] using the full engine.
	a := []int64{3, 1, 2}
	s := NewSlope()
	for _, v := range a {
		s.RelaxLeft() // later b may be >= current
		s.AddAbs(v)
	}
	fmt.Println("min cost non-decreasing [3 1 2]:", s.Minimum()) // 2
}
```

#### Java

```java
import java.util.*;

public class SlopeEngine {
    PriorityQueue<Long> L = new PriorityQueue<>(Collections.reverseOrder()); // max-heap
    PriorityQueue<Long> R = new PriorityQueue<>();                           // min-heap
    long addL = 0, addR = 0, minVal = 0;

    long lTop() { return L.peek() + addL; }
    long rTop() { return R.peek() + addR; }
    void pushL(long t) { L.add(t - addL); }
    void pushR(long t) { R.add(t - addR); }
    long popL() { return L.poll() + addL; }
    long popR() { return R.poll() + addR; }

    void addAbs(long a) {
        pushL(a); pushR(a);
        if (!L.isEmpty() && !R.isEmpty() && lTop() > rTop()) {
            long l = popL(), r = popR();
            minVal += l - r;
            pushL(r); pushR(l);
        }
    }

    void addRampUp(long a) {   // (x - a)_+
        pushR(a);
        if (!L.isEmpty() && lTop() > rTop()) {
            long l = popL(), r = popR();
            minVal += l - r;
            pushL(r); pushR(l);
        }
    }

    void addRampDown(long a) { // (a - x)_+
        pushL(a);
        if (!R.isEmpty() && lTop() > rTop()) {
            long l = popL(), r = popR();
            minVal += l - r;
            pushL(r); pushR(l);
        }
    }

    void relaxLeft()  { R.clear(); addR = 0; } // min over y <= x
    void relaxRight() { L.clear(); addL = 0; } // min over y >= x
    void shift(long c) { addL += c; addR += c; }
    long minimum() { return minVal; }

    public static void main(String[] args) {
        long[] a = {3, 1, 2};
        SlopeEngine s = new SlopeEngine();
        for (long v : a) { s.relaxLeft(); s.addAbs(v); }
        System.out.println("min cost non-decreasing [3 1 2]: " + s.minimum()); // 2
    }
}
```

#### Python

```python
import heapq


class SlopeEngine:
    """Convex PL function via two heaps + lazy offsets + minVal."""

    def __init__(self):
        self.L = []          # max-heap via negation (stores raw = true - addL)
        self.R = []          # min-heap            (stores raw = true - addR)
        self.addL = 0
        self.addR = 0
        self.min_val = 0

    def l_top(self):  return -self.L[0] + self.addL
    def r_top(self):  return self.R[0] + self.addR
    def push_l(self, t): heapq.heappush(self.L, -(t - self.addL))
    def push_r(self, t): heapq.heappush(self.R, t - self.addR)
    def pop_l(self):  return -heapq.heappop(self.L) + self.addL
    def pop_r(self):  return heapq.heappop(self.R) + self.addR

    def add_abs(self, a):                      # |x - a|
        self.push_l(a); self.push_r(a)
        if self.L and self.R and self.l_top() > self.r_top():
            l = self.pop_l(); r = self.pop_r()
            self.min_val += l - r
            self.push_l(r); self.push_r(l)

    def add_ramp_up(self, a):                  # (x - a)_+
        self.push_r(a)
        if self.L and self.l_top() > self.r_top():
            l = self.pop_l(); r = self.pop_r()
            self.min_val += l - r
            self.push_l(r); self.push_r(l)

    def add_ramp_down(self, a):                # (a - x)_+
        self.push_l(a)
        if self.R and self.l_top() > self.r_top():
            l = self.pop_l(); r = self.pop_r()
            self.min_val += l - r
            self.push_l(r); self.push_r(l)

    def relax_left(self):  self.R = []; self.addR = 0   # min_{y<=x} f
    def relax_right(self): self.L = []; self.addL = 0   # min_{y>=x} f
    def shift(self, c):    self.addL += c; self.addR += c
    def minimum(self):     return self.min_val


if __name__ == "__main__":
    a = [3, 1, 2]
    s = SlopeEngine()
    for v in a:
        s.relax_left()
        s.add_abs(v)
    print("min cost non-decreasing [3 1 2]:", s.minimum())  # 2
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Lazy offset not applied on push | New breakpoints land at the wrong true position. | Always push `true − add`; read `raw + add`. |
| Reset offset forgotten after clearing a heap | Stale `addR` corrupts future pushes. | When you clear a heap, reset its offset to `0`. |
| Reading top of an empty heap | Crash / undefined after a relaxation. | Guard `len > 0` before `top()`. |
| One-sided penalty rebalanced wrong direction | Pushed into the wrong heap. | `(x−a)_+` is a *right* breakpoint; `(a−x)_+` is a *left* breakpoint. |
| Non-convex function fed in | Two-heap invariant (I1) cannot hold. | Prove convexity; Slope Trick is invalid otherwise. |
| Strict vs non-strict mix-up | Off-by-one in the monotone constraint. | Apply the `−i` change of variables for strict. |
| Overflow in `minVal` | Accumulated cost exceeds 32-bit. | Use 64-bit everywhere. |

---

## Performance Analysis

| Operation | Heap actions | Time |
|-----------|--------------|------|
| `add |x − a|` | ≤ 2 pushes + ≤ 2 pops | `O(log n)` |
| one-sided penalty | ≤ 1 push + ≤ 1 swap | `O(log n)` |
| prefix-min (clear) | clear a heap | `O(1)` amortized (each element cleared once) |
| shift | adjust 2 integers | `O(1)` |
| read minimum / argmin | top / `minVal` | `O(1)` |

**Whole DP:** `n` steps, each `O(1)` catalog operations → **`O(n log n)`**, memory `O(n)`.

### Back-of-envelope comparison

For the make-monotone DP with `n` elements and value range `V`:

| `n`, `V` | naive `O(n·V)` | Slope Trick `O(n log n)` |
|----------|----------------|--------------------------|
| `n=10⁵`, `V=10⁹` | `10¹⁴` (infeasible) | `~1.7·10⁶` ops (ms) |
| `n=10⁶`, `V=10⁹` | `10¹⁵` (infeasible) | `~2·10⁷` ops (tens of ms) |
| `n=10³`, `V=100` | `10⁵` (fine) | `~10⁴` (fine) |

The naive table DP is killed by the value range `V`; Slope Trick's cost is independent of `V` because it stores breakpoints, not values. This is the decisive advantage: a huge coordinate range is free.

### Why the clear is amortized `O(1)`

A `relaxLeft` (clear `R`) deletes everything in `R`. Although a single clear can be `O(|R|)`, each breakpoint is pushed once and cleared at most once across the whole run, so the *total* clearing work over `n` steps is `O(n)` — amortized `O(1)` per step. This is the same accounting that makes the monotone CHT's pops amortized `O(1)`.

---

## Best Practices

- **Default to a single max-heap** when every step relaxes one side (the make-monotone family) — simpler and faster than the full two-heap engine.
- **Use lazy offsets** for any horizontal shift; never loop over a heap to re-key it.
- **Reset a heap's offset to `0` when you clear it.**
- **Prove convexity by induction** before coding: base case convex, each transition a convexity-preserving catalog operation.
- **Validate against the `O(n·range)` brute DP** on random small inputs.
- **Pick Slope Trick vs CHT by transition shape**, not habit — one edits a function, the other selects a line.
- **Keep `int64`/`long`** for `minVal`, breakpoints, and offsets.
- **Track the argmin if you need the actual values** — store enough to reconstruct (see [`senior.md`](./senior.md)).

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The convex polyline redrawing as each catalog operation is applied.
> - The two heaps (left max-heap, right min-heap) with their tops bounding the floor.
> - An `add |x − a|` step pushing breakpoints and **rebalancing** when the tops cross, with `minVal` incrementing.
> - A **prefix-min** step clearing the right heap and flattening the ascending side.

---

## Summary

A convex piecewise-linear function is carried implicitly as a **left max-heap** and **right min-heap** of breakpoints plus a scalar **`minVal`**, with the reconstruction formula (I3) tying them to actual function values. The **operation catalog** — `add |x − a|`, the one-sided ramps `(x−a)_+` and `(a−x)_+`, prefix-min relaxation (clearing a heap), horizontal shift, and constant add — each preserves convexity and costs `O(log n)` (or `O(1)`), so an `n`-step DP runs in `O(n log n)` with memory independent of the value range. **Lazy offset tags** make shifts and floor-widening `O(1)`. The strict-increasing variant reduces to non-decreasing by the `c_i = a_i − i` change of variables. Slope Trick is a sibling of **Convex Hull Trick** but optimizes a different shape: Slope Trick *edits one convex function*; CHT *selects the minimum over many lines*. The precondition is convexity, provable by induction, and the discipline is to validate against a brute `O(n·range)` DP.

### Quick reference

| If your transition is... | Catalog operation | Cost |
|--------------------------|-------------------|------|
| match this element to value `a` | `add |x − a|` | `O(log n)` |
| penalize exceeding `a` | `(x − a)_+` | `O(log n)` |
| penalize falling below `a` | `(a − x)_+` | `O(log n)` |
| later value may be `≥` current | prefix-min, clear `R` | `O(1)` |
| later value may be `≤` current | prefix-min, clear `L` | `O(1)` |
| function moves right by `c` | lazy shift | `O(1)` |
| maximize a concave function | mirror everything (negate) | same |

---

Next step: [`senior.md`](./senior.md) — where Slope Trick appears in practice (scheduling, logistics), its limits (the convexity requirement), engineering the heaps, and reconstructing the actual solution.
