# Amortized Analysis — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [The Aggregate Method, Recapped](#the-aggregate-method-recapped)
3. [The Accounting (Banker's) Method](#the-accounting-bankers-method)
   - [Dynamic Array: Charge 3 Per Push](#dynamic-array-charge-3-per-push)
   - [Binary Counter: Charge 2 Per Increment](#binary-counter-charge-2-per-increment)
   - [Multipop Stack](#multipop-stack)
4. [The Potential Method](#the-potential-method)
   - [Dynamic Array: Φ = 2·num − capacity](#dynamic-array-φ--2num--capacity)
   - [Binary Counter: Φ = number of 1-bits](#binary-counter-φ--number-of-1-bits)
   - [Multipop Stack: Φ = stack size](#multipop-stack-φ--stack-size)
   - [Why the Potential Method Is the Most Powerful](#why-the-potential-method-is-the-most-powerful)
5. [Table Doubling With Deletion](#table-doubling-with-deletion)
6. [Demonstration Code: Grow + Shrink Array](#demonstration-code-grow--shrink-array)
7. [Pitfalls](#pitfalls)
8. [Where Amortized Structures Live](#where-amortized-structures-live)
9. [Summary](#summary)

---

## Introduction

> Focus: turn the junior intuition ("expensive operations are rare, so they average out") into rigorous proof, then apply it to the three canonical examples.

At the [junior level](./junior.md) you met amortized analysis through the dynamic array: doubling makes `push` cost O(1) *on average over a sequence*, even though a single `push` can cost O(n). You also met the **aggregate method** — sum the true cost of *n* operations, divide by *n*.

The aggregate method works, but it gives every operation the *same* amortized cost and offers no machinery for designing data structures. The middle level introduces the two methods that practitioners and textbooks actually reach for:

- The **accounting method** (a.k.a. banker's method) — assign each operation a *chosen* amortized charge, bank the surplus as **credit**, and spend that credit on later expensive operations. The proof obligation is a single invariant: **credit never goes negative**.
- The **potential method** — define a function Φ that maps the *whole data-structure state* to a non-negative number ("stored energy"), and let the difference in Φ pay for expensive operations. This is the most general technique and the one you will see in proofs for splay trees, Fibonacci heaps, and union-find.

All three methods bound the **same** quantity — the total cost of a sequence — and a correct analysis with any of them yields a valid amortized bound. We will prove all three examples with both the accounting and the potential method, and watch the answers agree.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `c_i` | the **actual** (true) cost of the *i*-th operation |
| `ĉ_i` | the **amortized** cost we assign to the *i*-th operation |
| `D_i` | the state of the data structure **after** operation *i* (`D_0` = initial state) |
| `Φ(D)` | the **potential** of state `D` |

The whole game is to choose `ĉ_i` (accounting) or `Φ` (potential) so that **Σ ĉ_i ≥ Σ c_i** while each `ĉ_i` is small and easy to state.

---

## The Aggregate Method, Recapped

The aggregate method asks one question: *what is the worst-case total cost `T(n)` of any sequence of `n` operations?* The amortized cost per operation is then `T(n) / n`.

For a dynamic array that **doubles** on overflow, starting from capacity 1, the resizes during `n` pushes happen at sizes 1, 2, 4, …, up to the largest power of two below `n`. Each resize at size `k` copies `k` elements:

```text
copy cost = 1 + 2 + 4 + ... + 2^(⌊log₂ n⌋)  <  2n
push cost = n  (one slot write per push)
T(n) = n + (copies) < n + 2n = 3n  =  O(n)
amortized per push = T(n) / n < 3  =  O(1)
```

That is the whole aggregate argument, and the constant `3` is not a coincidence — it is exactly the charge the accounting method will assign next. The aggregate method's limitation: it tells us the *average* is O(1) but gives no per-operation bookkeeping and no way to handle structures where different operations deserve different charges (e.g. a stack with both `push` and `multipop`). For that we need the other two methods.

---

## The Accounting (Banker's) Method

The idea: pretend each operation is billed an **amortized charge** `ĉ_i` that may differ from its true cost `c_i`. When `ĉ_i > c_i`, the surplus `ĉ_i − c_i` is stored as **credit** on the data structure. When `ĉ_i < c_i`, the shortfall is paid by **spending** previously stored credit.

The single proof obligation:

> **Credit invariant.** At every point in time, the total stored credit is **≥ 0**.

Why this suffices: total credit after `n` operations equals `Σ(ĉ_i − c_i) = Σ ĉ_i − Σ c_i`. If credit is always ≥ 0, then `Σ ĉ_i ≥ Σ c_i`, so the sum of amortized charges is an upper bound on the true total cost. If we picked constant charges, `Σ ĉ_i = n · ĉ`, giving an amortized cost of `ĉ` per operation.

The art is **choosing the charge** and then **deciding which physical units of work carry which credit** — and proving you never try to spend credit you do not have.

### Dynamic Array: Charge 3 Per Push

Charge **`ĉ = 3`** for every `push`. The true cost of a `push` is `1` (write the element) plus, occasionally, the cost of copying every existing element during a resize.

Place the surplus of `2` credits *on the element just inserted*. The accounting story:

- A normal push: true cost `1`, charge `3`. Store `2` credits **on the new element**.
- A resize from capacity `m` to `2m`: it happens exactly when the array is full, i.e. holds `m` elements. We must copy all `m` of them. Where does the money come from? Since the last resize (which left the array half full, holding `m/2` elements), we have pushed `m/2` *new* elements, each carrying `2` credits → `m` credits banked. That is exactly enough to pay the `m` copies.

```text
After a resize to capacity m:  array holds m/2 elements,  credit = 0
Push m/2 more elements:        each banks 2 credits  →  credit = 2·(m/2) = m
Array is now full (m elements). Next push triggers copy of m elements.
Spend m credits to copy.       credit = 0.  Invariant held throughout (never < 0).
```

Every element that exists at resize time was pushed *after* the previous resize (the older half was already copied and its credit spent), so each carries its full 2 credits. The invariant holds, `ĉ = 3 = O(1)` amortized.

### Binary Counter: Charge 2 Per Increment

A `k`-bit binary counter supports `INCREMENT`. The true cost of one increment is the number of bits it flips. Incrementing `...0111` to `...1000` flips 4 bits; the worst case flips `k` bits. Naively, `n` increments look like `O(nk)`. Amortized analysis shows `O(n)` — i.e. **O(1) per increment**.

Charge **`ĉ = 2`** per increment. Bookkeeping rule: **store 1 credit on every bit that is currently 1.**

An increment does exactly one of: it flips a run of trailing `1`s to `0`, then flips one `0` to `1`.

- Flipping the trailing `1`s to `0`: each such flip is paid by the **1 credit sitting on that bit** (it was a 1, so it carried a credit). Cost to us: `0` from the charge — credit covers it.
- Flipping the single `0` to `1`: true cost `1`, paid by `1` of our `2` charged credits. The remaining `1` credit is **placed on the newly-set bit**, ready to pay for its own future reset.

```text
charge per increment      = 2
  1 credit → pay to set the one 0→1 bit, and leave 1 credit on it
  resets of trailing 1→0  → each paid by the credit already on that bit
credit invariant: #credits stored = #bits currently set to 1  ≥ 0   ✓
```

Each increment spends at most `2` credits regardless of how long the carry chain is, so `n` increments cost `≤ 2n = O(n)`, i.e. **O(1) amortized** per increment.

Watching a 4-bit counter from 0 makes the "credit = #1-bits" invariant visible — the credit column always equals the number of `1`s:

```text
value   bits    flips (c_i)   credit after (= #1-bits)
0       0000        -                 0
1       0001        1                 1
2       0010        2                 1
3       0011        1                 2
4       0100        3                 1
5       0101        1                 2
6       0110        2                 2
7       0111        1                 3
8       1000        4                 1
```

Total flips through value 8 = `1+2+1+3+1+2+1+4 = 15`, while `2 × 8 = 16 ≥ 15`. The charge bounds the work, and the credit stored is always exactly the bit count.

### Multipop Stack

A stack supporting:

- `PUSH(x)` — true cost `1`.
- `POP()` — true cost `1`.
- `MULTIPOP(k)` — pop `min(k, size)` items; true cost = number actually popped, up to `O(size)`.

A single `MULTIPOP` can cost O(n), so the worst-case-per-op bound is bad. But you cannot pop an element you never pushed: every pop (whether via `POP` or `MULTIPOP`) is matched against an earlier `PUSH`.

Charges: `ĉ(PUSH) = 2`, `ĉ(POP) = 0`, `ĉ(MULTIPOP) = 0`. Bookkeeping rule: **store 1 credit on every element currently on the stack.**

- `PUSH`: true cost `1`, charge `2`. Spend `1` on the push itself, bank `1` **on the pushed element**.
- `POP` / each pop inside `MULTIPOP`: true cost `1`, charge `0`. Pay it with the `1` credit sitting on the element being removed.

```text
credit invariant: #credits stored = #elements on stack ≥ 0   ✓
every pop is funded by the credit deposited at its push
```

Total amortized cost of any sequence of `n` operations is `≤ 2n = O(n)`, so every operation — including the scary `MULTIPOP` — is **O(1) amortized**.

#### A numeric trace

It helps to watch the credit move. Track `(true cost, charge, credit after)` through a short sequence on an initially empty stack:

```text
op            true c_i   charge ĉ_i   credit after   note
PUSH a            1           2            1          banked 1 on 'a'
PUSH b            1           2            2          banked 1 on 'b'
PUSH c            1           2            3          banked 1 on 'c'
MULTIPOP(2)       2           0            1          spent credit on c, b
PUSH d            1           2            2          banked 1 on 'd'
POP               1           0            1          spent credit on d
                 ----        ----
total             7           8                       8 ≥ 7  ✓ (credit ≥ 0 throughout)
```

The charges (8) bound the true cost (7), and the credit column never dips below zero — a concrete instance of the credit invariant.

---

## The Potential Method

The accounting method scatters credit onto individual elements; you have to track *where* the money sits. The potential method replaces that bookkeeping with **one number computed from the whole state**.

Define a **potential function** Φ that maps each state `D_i` to a real number, subject to:

```text
Φ(D_0) ≥ 0          (initial potential is non-negative — usually 0)
Φ(D_i) ≥ Φ(D_0)     for all i   (potential never drops below the start)
```

The standard, sufficient convention is `Φ(D_0) = 0` and `Φ(D_i) ≥ 0` for all `i`. Define the **amortized cost** of operation `i` as:

```text
ĉ_i = c_i + Φ(D_i) − Φ(D_{i-1})
```

The amortized cost is the true cost **plus the change in potential**. Now sum over a sequence and watch it **telescope**:

```text
Σ_{i=1}^{n} ĉ_i = Σ c_i + Σ (Φ(D_i) − Φ(D_{i-1}))
              = Σ c_i + (Φ(D_n) − Φ(D_0))
              = Σ c_i + Φ(D_n) − 0
              = Σ c_i + Φ(D_n)
```

Since `Φ(D_n) ≥ 0`, we get **`Σ ĉ_i ≥ Σ c_i`** — exactly the bound we need. Intuition: Φ is "stored energy". A cheap operation that *raises* Φ is charged extra (it is pre-paying); an expensive operation that *lowers* Φ is partly funded by releasing stored energy. Connection to accounting: **Φ(D_i) is just the total credit stored in state `D_i`.** The two methods are the same idea with different notation — potential makes the credit a single closed-form function of the state.

### Dynamic Array: Φ = 2·num − capacity

Let `num` be the number of stored elements and `cap` the current capacity. Define:

```text
Φ = 2 · num − cap
```

Check the boundary conditions. We keep the array between half-full and full (just after a doubling, `num = cap/2`; just before, `num = cap`), so `num ≥ cap/2`, hence `2·num ≥ cap` and **Φ ≥ 0**. Right after a resize Φ is at its minimum; just before the next resize (array full, `num = cap`) Φ = `2·cap − cap = cap` is at its maximum. Now the two cases:

**Ordinary push, no resize** (`num` grows by 1, `cap` unchanged): true cost `c_i = 1`.

```text
ΔΦ = (2·(num+1) − cap) − (2·num − cap) = 2
ĉ_i = c_i + ΔΦ = 1 + 2 = 3 = O(1)
```

**Push that triggers a resize** (array was full: `num_before = cap_before = m`; after, `num = m+1`, `cap = 2m`): true cost `c_i = m + 1` (copy `m` elements, write the new one).

```text
Φ_before = 2m − m = m
Φ_after  = 2(m+1) − 2m = 2
ΔΦ = 2 − m
ĉ_i = c_i + ΔΦ = (m + 1) + (2 − m) = 3 = O(1)
```

Both cases give amortized cost exactly `3`, matching the accounting analysis and the aggregate bound. The potential `Φ = 2·num − cap` is engineered so that the *huge* drop in Φ during a resize cancels the *huge* true copy cost.

### Binary Counter: Φ = number of 1-bits

Let `Φ = b_i` = the number of bits set to `1` after operation `i`. Clearly `Φ ≥ 0`, and if the counter starts at 0 then `Φ(D_0) = 0`.

Consider an increment that resets `t` trailing `1`-bits (to `0`) and sets one `0`-bit to `1` (assume no overflow). True cost `c_i = t + 1` (the `t` resets plus the one set). The bit count changes by `−t + 1`:

```text
ΔΦ = b_i − b_{i-1} = (1 − t)
ĉ_i = c_i + ΔΦ = (t + 1) + (1 − t) = 2 = O(1)
```

The `t` cancels exactly. (If the increment overflows the whole `k`-bit counter back to 0, `c_i = k`, `ΔΦ = −k`, so `ĉ_i = 0` — still ≤ 2.) Starting from 0, `n` increments cost `Σ c_i ≤ Σ ĉ_i = 2n = O(n)`.

### Multipop Stack: Φ = stack size

Let `Φ` = the number of elements currently on the stack. `Φ ≥ 0`, and an empty initial stack gives `Φ(D_0) = 0`.

| Operation | `c_i` | `ΔΦ` | `ĉ_i = c_i + ΔΦ` |
|-----------|-------|------|------------------|
| `PUSH(x)` | 1 | +1 | 2 |
| `POP()` | 1 | −1 | 0 |
| `MULTIPOP(k)`, pops `p = min(k, size)` | `p` | `−p` | 0 |

For `MULTIPOP` the expensive true cost `p` is *exactly* cancelled by the potential drop `−p`: `ĉ = p + (−p) = 0`. Every operation has amortized cost ≤ 2 = O(1), so a sequence of `n` operations costs `O(n)` — the same conclusion as accounting, reached with a single clean function `Φ = size`.

### Why the Potential Method Is the Most Powerful

The potential method dominates the others for several concrete reasons:

1. **No per-element bookkeeping.** Accounting forces you to track *which element* holds *which credit* and prove you never overdraw. Potential collapses all of that into one number `Φ(D)` you can read off any state.
2. **It handles operation-dependent and state-dependent costs.** Different operations simply produce different `ΔΦ`; you do not need separate "charge tables". This is essential for structures like splay trees where the cost of an access depends on the tree's shape.
3. **It composes with non-uniform amortized bounds.** Fibonacci heaps give `O(1)` amortized for `insert`/`decrease-key` but `O(log n)` amortized for `extract-min` — a single potential (number of trees + 2·number of marked nodes) yields all of these at once. No accounting scheme states that as cleanly.
4. **The telescoping is automatic.** Once `Φ ≥ 0` and `Φ(D_0) = 0` are checked, the bound `Σ ĉ_i ≥ Σ c_i` falls out mechanically. You never re-argue the global invariant per operation.

The recurring difficulty is **finding the right Φ**. A good potential is "high" exactly when the structure is in a state that is about to force an expensive operation (a full array, a counter full of 1-bits, a tall stack), so that the expensive operation's cost is paid by the drop in Φ. Designing Φ is the creative core of an amortized proof — the rest is arithmetic.

#### The three methods side by side

| | Aggregate | Accounting (banker's) | Potential |
|---|---|---|---|
| **Core object** | total `T(n)` | per-element credit `ĉ_i` | state function `Φ(D)` |
| **Proof obligation** | bound the sum | credit ≥ 0 always | `Φ ≥ 0`, `Φ(D_0)=0` |
| **Per-op costs differ?** | no (uniform) | yes | yes |
| **Bookkeeping burden** | none | track *where* credit sits | one number per state |
| **Best for** | quick uniform proofs | intuition, simple structures | self-adjusting / non-uniform structures |
| **Generality** | lowest | medium | highest |

All three are **provably equivalent** in the bounds they can establish for a given structure — they differ only in convenience. If you can do it with accounting, you can do it with potential by setting `Φ(D)` = total credit in state `D`; the converse is also true.

---

## Table Doubling With Deletion

So far we only grew the array. Real dynamic arrays (Go slices, Java `ArrayList`, C++ `vector`) also need to **shrink** so that memory is reclaimed after many deletions. The subtlety: a careless shrink rule destroys the O(1) amortized guarantee.

### The naive rule is a trap: halve at ½ full

Tempting symmetric rule: *double when full; halve the capacity when the array drops to ½ full.* This **thrashes**. Sit exactly at the boundary `num = cap/2` and alternate `push, pop, push, pop, …`:

```text
state: num = cap/2  (capacity cap)
PUSH  → num = cap/2 + 1 > cap/2 ... fine, until full → at the boundary a push to
        num = cap/2 makes it 'more than half', a pop back to cap/2 makes it 'half'
```

More precisely, if doubling triggers at "full" and halving triggers at "half full", then immediately after a grow-doubling the array is half full — so the very next deletion triggers a halve, and the next insertion triggers a double, and so on. Each such operation now copies `Θ(num)` elements, so a sequence of `n` alternating ops costs `Θ(n²)` — **amortized O(n) per operation, catastrophically worse than O(1).** The grow and shrink thresholds are touching, leaving no slack.

### The fix: halve when ¼ full

Standard rule that restores O(1) amortized:

> **Grow:** when an insert would overflow (`num = cap`), double the capacity to `2·cap`.
> **Shrink:** when a delete drops the load to `num = cap/4`, halve the capacity to `cap/2`.

The asymmetry is the point. After *either* a grow or a shrink, the array is exactly **half full** (`num = cap/2`). To trigger the next *grow* you must insert `cap/2` more elements; to trigger the next *shrink* you must delete `cap/4` elements. Either way, `Θ(cap)` cheap operations separate two consecutive expensive resizes, so each resize's `Θ(cap)` copy cost amortizes to O(1).

### Potential-method proof for grow + shrink

The growth-only potential `Φ = 2·num − cap` fails when shrinking, because after a delete `num` can fall well below `cap/2`, making it negative. We need a `Φ` that is large both when the array is **too full** (about to grow) and when it is **too empty** (about to shrink). The symmetric choice (Cormen et al., CLRS §17.4):

```text
Φ = 2·num − cap      if  num ≥ cap/2     (the "full half" regime)
Φ = cap/2 − num      if  num <  cap/2     (the "empty half" regime)
```

Check `Φ ≥ 0`:

- When `num ≥ cap/2`: `2·num − cap ≥ 2·(cap/2) − cap = 0`. ✓
- When `num < cap/2`: `cap/2 − num > cap/2 − cap/2 = 0`. ✓
- At the load factors we maintain (`cap/4 ≤ num ≤ cap`), Φ ranges from `0` (at `num = cap/2`) up to `cap/2` (at `num = cap` or `num = cap/4`). It is largest exactly when a resize is imminent — precisely the design goal.

Sketch of the four cases (all yield `ĉ_i = O(1)`):

| Operation | Regime | `c_i` | `ΔΦ` | `ĉ_i` |
|-----------|--------|-------|------|-------|
| `insert`, no resize | `num ≥ cap/2` | 1 | +2 | 3 |
| `insert`, triggers double | full, `num = cap` | `num+1` | `2 − num` | 3 |
| `delete`, no resize | `num ≤ cap/2` | 1 | +1 | 2 |
| `delete`, triggers halve | `num = cap/4` | `num` | `≈ 1 − num + …` | O(1) |

Working the halving case: before, `num = cap/4`, regime `num < cap/2`, so `Φ_before = cap/2 − cap/4 = cap/4`. The delete removes one element and copies the remaining `num − 1 = cap/4 − 1` into a new array of capacity `cap/2`; true cost `c_i = cap/4`. After, `num = cap/4 − 1`, `cap' = cap/2`, and `num < cap'/2 = cap/4`, so `Φ_after = cap'/2 − num = cap/4 − (cap/4 − 1) = 1`. Then `ΔΦ = 1 − cap/4` and `ĉ_i = cap/4 + (1 − cap/4) = 1 = O(1)`. The huge copy cost is again absorbed by the collapse in potential.

Conclusion: with **grow-at-full / shrink-at-quarter**, both `insert` and `delete` are **O(1) amortized**, and memory stays within a constant factor of `num`. This is exactly why production dynamic arrays shrink at a low load factor rather than at ½.

---

## Demonstration Code: Grow + Shrink Array

Below is an instrumented dynamic array with the grow-at-full / shrink-at-quarter policy. The instrumentation counts the **total element copies** across a long run; if the amortized cost is O(1), `total_copies / operations` stays bounded by a small constant no matter how large `n` is.

### Go

```go
package main

import "fmt"

// DynArray is a manually managed dynamic array with grow + shrink.
type DynArray struct {
	data   []int
	num    int   // number of stored elements
	copies int64 // instrumentation: total elements copied by resizes
}

func NewDynArray() *DynArray {
	return &DynArray{data: make([]int, 1), num: 0}
}

// resize copies all live elements into a new backing array of given capacity.
func (a *DynArray) resize(newCap int) {
	if newCap < 1 {
		newCap = 1
	}
	next := make([]int, newCap)
	for i := 0; i < a.num; i++ {
		next[i] = a.data[i]
		a.copies++ // count every element copy
	}
	a.data = next
}

// Push appends x, doubling capacity when full.  O(1) amortized.
func (a *DynArray) Push(x int) {
	if a.num == len(a.data) {
		a.resize(2 * len(a.data))
	}
	a.data[a.num] = x
	a.num++
}

// Pop removes the last element, halving capacity when 1/4 full.  O(1) amortized.
func (a *DynArray) Pop() (int, bool) {
	if a.num == 0 {
		return 0, false
	}
	a.num--
	x := a.data[a.num]
	a.data[a.num] = 0 // avoid leaking references
	if len(a.data) > 1 && a.num <= len(a.data)/4 {
		a.resize(len(a.data) / 2)
	}
	return x, true
}

func main() {
	a := NewDynArray()
	const ops = 1_000_000

	// Phase 1: a million pushes.
	for i := 0; i < ops; i++ {
		a.Push(i)
	}
	// Phase 2: a million pops.
	for i := 0; i < ops; i++ {
		a.Pop()
	}

	total := int64(2 * ops)
	fmt.Printf("operations    = %d\n", total)
	fmt.Printf("total copies  = %d\n", a.copies)
	fmt.Printf("copies / op   = %.3f  (bounded constant => O(1) amortized)\n",
		float64(a.copies)/float64(total))
}
```

Running this prints a `copies / op` ratio near `2` and *independent of* `ops` — push it to ten million and the ratio does not grow. That constant is the amortized cost made empirical.

### Java

```java
public class DynArray {
    private int[] data = new int[1];
    private int num = 0;
    private long copies = 0; // instrumentation: total element copies

    private void resize(int newCap) {
        if (newCap < 1) newCap = 1;
        int[] next = new int[newCap];
        for (int i = 0; i < num; i++) {
            next[i] = data[i];
            copies++;
        }
        data = next;
    }

    /** Append x; double capacity when full. O(1) amortized. */
    public void push(int x) {
        if (num == data.length) resize(2 * data.length);
        data[num++] = x;
    }

    /** Remove last element; halve capacity at 1/4 load. O(1) amortized. */
    public int pop() {
        if (num == 0) throw new IllegalStateException("empty");
        int x = data[--num];
        if (data.length > 1 && num <= data.length / 4) {
            resize(data.length / 2);
        }
        return x;
    }

    public long copies() { return copies; }

    public static void main(String[] args) {
        DynArray a = new DynArray();
        final int OPS = 1_000_000;

        for (int i = 0; i < OPS; i++) a.push(i);
        for (int i = 0; i < OPS; i++) a.pop();

        long total = 2L * OPS;
        System.out.printf("operations    = %d%n", total);
        System.out.printf("total copies  = %d%n", a.copies());
        System.out.printf("copies / op   = %.3f  (bounded => O(1) amortized)%n",
                (double) a.copies() / total);
    }
}
```

### Python (optional)

```python
class DynArray:
    def __init__(self):
        self._data = [None]      # backing store; we manage growth ourselves
        self._num = 0
        self.copies = 0          # instrumentation: total element copies

    def _resize(self, new_cap):
        new_cap = max(new_cap, 1)
        nxt = [None] * new_cap
        for i in range(self._num):
            nxt[i] = self._data[i]
            self.copies += 1
        self._data = nxt

    def push(self, x):           # double when full -> O(1) amortized
        if self._num == len(self._data):
            self._resize(2 * len(self._data))
        self._data[self._num] = x
        self._num += 1

    def pop(self):               # halve at 1/4 load -> O(1) amortized
        if self._num == 0:
            raise IndexError("empty")
        self._num -= 1
        x = self._data[self._num]
        self._data[self._num] = None
        if len(self._data) > 1 and self._num <= len(self._data) // 4:
            self._resize(len(self._data) // 2)
        return x


if __name__ == "__main__":
    a = DynArray()
    OPS = 1_000_000
    for i in range(OPS):
        a.push(i)
    for _ in range(OPS):
        a.pop()

    total = 2 * OPS
    print(f"operations   = {total}")
    print(f"total copies = {a.copies}")
    print(f"copies / op  = {a.copies / total:.3f}  (bounded => O(1) amortized)")
```

All three implementations confirm the proof: copies grow **linearly** in the number of operations, so the per-operation copy work is a bounded constant. (Note: Python lists already do amortized growth internally — here we manage a backing list manually to *observe* the resizes, which is why we track `copies` ourselves.)

---

## Pitfalls

**1. Amortized ≠ worst-case-per-operation.** Amortized O(1) means a *sequence* of `n` operations costs O(n). A *single* operation can still cost O(n) — the resize is real, it just happens rarely. Never tell a reader "this push is O(1)" without the word *amortized*; that single push that triggers a copy of a million elements is genuinely O(n).

**2. Amortized ≠ average-case.** Average-case analysis assumes a *probability distribution over inputs* and reports an *expected* cost; an unlucky input can blow the bound. Amortized analysis makes **no probabilistic assumption** — it is a worst-case guarantee on the *total* over any sequence chosen by an adversary. A hash table is average-case O(1) per lookup (assuming a good hash and random keys); a dynamic array push is amortized O(1) (guaranteed, no randomness). They are different kinds of claims and must not be conflated.

```text
worst-case (per op):   adversary picks the worst single operation
average-case (per op): expected cost over a distribution of inputs
amortized (per op):    worst-case total over a sequence, divided by n
```

**3. The "credit" / potential is conceptual, not real.** Φ and credit are accounting fictions used only in the proof. The data structure stores no extra numbers (our `copies` counter is just instrumentation). Beginners sometimes try to physically store credit — don't.

**4. Resetting the structure mid-sequence can break the bound.** Amortized bounds assume the credit/potential accumulated by cheap operations is available to pay later expensive ones. If something resets the state (or you call expensive ops back-to-back from a freshly worst-case-loaded structure), the *sequence* assumption still holds — but be careful when reasoning about *interleaved* uses or when an operation is repeated from the same expensive state.

**5. Amortized bounds are not enough for real-time systems.** A hard real-time controller, a frame-budgeted game loop, or a low-latency trading path needs a guarantee on **each individual operation**, not on the average. An amortized-O(1) `push` that occasionally stalls for O(n) to copy a 10-million-element array can blow a frame deadline or a latency SLO. When per-operation worst-case matters, you need *worst-case* O(1) (or O(log n)) structures — incremental/de-amortized resizing, real-time deques, and worst-case-balanced trees. This is the boundary where amortized analysis hands off to **worst-case and real-time data structures** (see the [senior level](./senior.md) for de-amortization techniques and worst-case-optimal structures).

---

## Where Amortized Structures Live

Amortized analysis is not a curiosity — it is the *only* reason several workhorse structures meet their advertised bounds. As you move through the DSA roadmap, watch for it:

- **Dynamic arrays** — `push`/`pop` amortized O(1) (this topic). Underlies Go slices, Java `ArrayList`, C++ `vector`.
- **[Fibonacci heaps](../../10-heaps/03-fibonacci-heap/)** — `insert` and `decrease-key` amortized O(1), `extract-min` amortized O(log n), proven with `Φ = #trees + 2·#marked-nodes`. The reason Dijkstra and Prim hit `O(E + V log V)`.
- **[Pairing heaps](../../10-heaps/06-pairing-heap/)** and **[binomial heaps](../../10-heaps/05-binomial-heap/)** — meld/insert bounds rely on amortized arguments.
- **Splay trees** (a self-adjusting BST) — every operation is O(log n) *amortized* via the access-cost potential argument; individual operations can be O(n).
- **Union-Find** with path compression — near-constant `O(α(n))` amortized per operation, the canonical inverse-Ackermann result.

For the foundational counting techniques these proofs build on, revisit [time vs space complexity](../01-time-vs-space-complexity/middle.md) and [how to calculate complexity](../02-how-to-calculate-complexity/middle.md).

---

## Summary

Amortized analysis proves that the **total** cost of a sequence of `n` operations is small even when individual operations are occasionally expensive. The middle level turns the junior intuition into three rigorous methods:

- **Aggregate** — bound the total `T(n)`, divide by `n`. Simple, but assigns every operation the same cost and offers no design leverage.
- **Accounting (banker's)** — assign a chosen amortized charge `ĉ_i`, bank surplus as credit on elements, spend it on expensive operations; prove the **credit invariant** (total credit ≥ 0). We charged 3/push (array), 2/increment (counter), 2/push (stack).
- **Potential** — define `Φ: states → ℝ≥0` with `Φ(D_0) = 0`; let `ĉ_i = c_i + Φ(D_i) − Φ(D_{i-1})` telescope to `Σ ĉ_i = Σ c_i + Φ(D_n) ≥ Σ c_i`. The same three examples succumb to `Φ = 2·num − cap`, `Φ = #1-bits`, and `Φ = stack size`. It is the **most general** method — one closed-form function replaces all per-element bookkeeping and handles operation- and state-dependent costs.

We also saw why dynamic arrays must **shrink at ¼ full, not ½**: the symmetric rule *thrashes* into Θ(n²), while the asymmetric rule leaves Θ(cap) slack between consecutive resizes and keeps both `insert` and `delete` at O(1) amortized — confirmed empirically by the grow+shrink code whose `copies / op` ratio stays a bounded constant.

Finally, never confuse amortized with worst-case-per-op or average-case. When a system needs a guarantee on *every* operation — real-time, latency-critical — amortized bounds are not enough, and you reach for the worst-case and de-amortized structures covered at the [senior level](./senior.md).
