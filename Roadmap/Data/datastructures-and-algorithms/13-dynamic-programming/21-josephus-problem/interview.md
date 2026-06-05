# The Josephus Problem — Interview Preparation

The Josephus problem is a favourite interview topic because it rewards a single crisp insight — *"the survivor follows `J(n) = (J(n-1) + k) mod n` from `J(1) = 0`"* — and then tests whether you can (a) derive that recurrence, (b) recognize the `O(1)` bit-rotation closed form for `k = 2`, (c) scale to huge `n` with the `O(k log n)` batching or to the full elimination order with a Fenwick tree, and (d) avoid the classic 0-/1-indexed off-by-one trap. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Survivor, any `k`, 0-indexed | `J(n) = (J(n-1)+k) mod n`, `J(1)=0` | `O(n)` |
| Survivor, `k = 2`, 1-indexed | `2·(n − 2^⌊log₂ n⌋) + 1` | `O(1)` |
| Survivor, huge `n`, small `k` | batched recurrence | `O(k log n)` |
| Full elimination order | list simulation / Fenwick + select | `O(n·k)` / `O(n log n)` |
| `m`-th person eliminated | simulate `m` removals (Fenwick) | `O(m log n)` |
| Position to survive | `J(n) + 1` | same as survivor |
| Variable step per round | `J(n) = (J(n-1) + k_n) mod n` | `O(n)` |

Core algorithm:

```text
josephus(n, k):              # 0-indexed survivor
    res = 0                  # J(1)
    for m in 2..n:
        res = (res + k) % m
    return res               # add 1 for a 1-indexed seat
# O(n) time, O(1) space
```

Key facts:
- **The recurrence is 0-indexed**; `J(1) = 0`. Humans want `J(n) + 1`.
- **`k = 2` ⇒ rotate the leading binary `1` of `n` to the end** (e.g. `41 = 101001₂ → 010011₂ = 19`).
- **Power-of-two `n` with `k = 2` ⇒ seat 1.**
- **The recurrence gives the survivor only**, not the elimination order.
- **`k = 1` ⇒ person `n` survives** (0-indexed `n − 1`).

---

## Junior Questions (12 Q&A)

### J1. What is the Josephus problem?
`n` people stand in a circle; starting the count somewhere, every `k`-th person is eliminated, and counting resumes from the next survivor. Eliminations continue until one person remains. The question is which position survives.

### J2. What is the survivor recurrence?
`J(1) = 0` and `J(n) = (J(n-1) + k) mod n`, where `J(n)` is the survivor's 0-indexed position for `n` people with step `k`. It runs in `O(n)` time and `O(1)` space.

### J3. Why is `J(1) = 0`?
With a single person, that person is trivially the survivor; its 0-indexed position is `0`. This is the base case the recurrence builds up from.

### J4. How do you convert the recurrence's answer to a human seat number?
Add `1`. The recurrence is 0-indexed (`0 … n−1`); the 1-indexed seat is `J(n) + 1`. Forgetting this is the most common Josephus bug.

### J5. What is special about `k = 2`?
There is an `O(1)` closed form: `J(n) = 2·(n − 2^⌊log₂ n⌋) + 1` (1-indexed). Equivalently, write `n` in binary and rotate the leading `1` to the rightmost position.

### J6. What survives when `k = 1`?
Person `n` (0-indexed `n − 1`). With step 1 you eliminate people in order `1, 2, …, n−1`, leaving the last one.

### J7. What is the brute-force way to solve it?
Simulate the circle: keep a list of people, count `k` around it, remove the chosen person, repeat. With an array and middle removal it is `O(n²)`; with a list and counting it is `O(n·k)`.

### J8. Does the recurrence give the order people are eliminated?
No. It gives only the final survivor. To get the order you must simulate (or use a Fenwick tree for efficiency).

### J9. What happens if `k > n`?
Nothing special — counting wraps around the circle multiple times. The `mod n` in the recurrence (and `mod len` in simulation) handles the wrap.

### J10. Why do we take `mod n` in the recurrence?
Because the circle is cyclic: after shifting the smaller-circle answer by `k`, the position may exceed `n − 1`, so we wrap it back with `mod n`.

### J11. What is the time complexity of the recurrence and what dominates?
`O(n)` — exactly `n − 1` cheap modular steps, one per circle size from `2` to `n`. Space is `O(1)` because each step needs only the previous value.

### J12 (analysis). Why is the recurrence `O(n)` while naive array simulation is `O(n²)`?
The recurrence does `O(1)` work per size. Array simulation removes from the middle, costing `O(n)` per removal across `n` removals — `O(n²)`. The recurrence avoids modeling the physical circle entirely.

---

## Middle Questions (12 Q&A)

### M1. Derive the recurrence `J(n) = (J(n-1) + k) mod n`.
The first eliminated person is at position `(k−1) mod n`. Afterward the `n−1` survivors, renumbered starting from the resume point, form exactly the `(n−1)`-person problem. The renumbering shifts positions by `k` (the resume point becomes new-position 0), so the original position of the smaller problem's survivor is `(J(n-1) + k) mod n`. Base case `J(1) = 0`.

### M2. Prove the `k = 2` closed form.
Strong induction splitting `n` even/odd. For `n = 2j`, the first sweep removes all even seats, leaving `j` people that recurse with `J₂(2j) = 2J₂(j) − 1`. For `n = 2j+1`, the sweep removes the evens then seat 1, giving `J₂(2j+1) = 2J₂(j) + 1`. Both reduce to `J₂(n) = 2ℓ + 1` where `ℓ = n − 2^⌊log₂ n⌋`.

### M3. Explain the bit-rotation interpretation for `k = 2`.
Write `n = (1 b_{a-1} … b_0)₂`. Then `ℓ = (b_{a-1} … b_0)₂` and `2ℓ + 1 = (b_{a-1} … b_0 1)₂` — the same bits with the leading `1` moved to the end. So `J₂(n)` is a one-bit cyclic left rotation of `n`.

### M4. How do you handle huge `n` (like `10^18`) when `k` is small?
Batch the non-wrapping steps of the recurrence: while `res + k < m`, many consecutive sizes add a plain `+k`, so jump `cnt = (m − res − 1)/k` sizes at once. This yields `O(k log n)`, sublinear for small `k`.

### M5. When does the `O(k log n)` method NOT help?
When `k` is also large. The method is sublinear only because each sweep removes a `1/k` fraction; for `k` comparable to `n` there is no known sublinear general algorithm, and you fall back to `O(n)`.

### M6. How do you find the full elimination order efficiently?
Simulation with a list/queue is `O(n·k)`. For scale, use a Fenwick tree storing `1` for living people: repeatedly find the `k`-th living person via a binary-search "Fenwick walk" (`O(log n)`), eliminate it (`update(idx, −1)`), giving `O(n log n)`.

### M7. What is the right base case and starting index?
`J(1) = 0`, and the loop runs `m` from `2` to `n`. Initializing `res = 1` or starting at `m = 1` are common bugs; the former gives wrong answers, the latter is harmless but pointless (`mod 1`).

### M8. How do you avoid overflow for large `n, k`?
Use 64-bit integers and reduce per step: `res = (res + k % m) % m`. This keeps the intermediate below `2m ≤ 2n`. Python's big integers avoid the issue entirely.

### M9. How is the Josephus recurrence a dynamic program?
`J(n)` depends only on `J(n−1)` — a single subproblem, a linear chain. The "optimal substructure" is the process isomorphism between the `n`-circle and the `(n−1)`-circle; only one scalar of memo is needed, so it is `O(n)` time, `O(1)` space.

### M10. What is the survivor for a power-of-two `n` with `k = 2`?
Seat 1. When `n = 2^a`, `ℓ = n − 2^a = 0`, so `2ℓ + 1 = 1`. Each full halving sweep brings the count cleanly back to the start.

### M11. How would you find the position to survive for a chosen `k`?
Compute `J(n, k)` via the recurrence and stand at seat `J(n, k) + 1`. If you may also choose `k`, search over candidate `k` values for one whose survivor seat equals your target.

### M12 (analysis). Why does general `k` lack a closed form while `k = 2` has one?
`k = 2` realigns to a power-of-two boundary after each halving sweep, letting the recurrence telescope into a bit rotation. For other `k`, a sweep removes a `1/k` fraction but does not realign to a clean power-of-`k` boundary, so no elementary closed form exists.

---

## Senior Questions (10 Q&A)

### S1. How do you compute the survivor for `n = 10^18`?
If `k = 2`, use the `O(1)` bit-rotation closed form. If `k` is small, use the `O(k log n)` batched recurrence. For general large `k`, there is no known sublinear method — the `O(n)` loop is infeasible, so you must rescope.

### S2. How do you produce the full elimination order at scale?
Fenwick tree over `n` slots (`1` = alive). Each step: convert "`k` ahead among the living, cyclically" to a rank, find that slot with the `O(log n)` Fenwick select-walk, eliminate it, decrement the living count. Total `O(n log n)`, replacing the `O(n²)` array-shift simulation.

### S3. What is the most error-prone part of the Fenwick approach?
Converting "`k` steps ahead among the living, cyclically" into the correct rank, and updating the pointer after deletion. An off-by-one yields a valid-looking but wrong order. Always test it entrywise against a list simulation for small `n`.

### S4. How do you guard against overflow in the batched method?
Cap `cnt` so `m + cnt ≤ n`; since `res < m ≤ n` and `k` is small in the batching regime, `cnt·k` stays within 64-bit. In the plain recurrence, normalize `res = (res + k % m) % m`.

### S5. How do you verify a Josephus implementation when `n` is too large to simulate?
Test every fast path (recurrence, batched, closed form, Fenwick order) against a brute-force list simulation for small `n` (≤ 60) and a spread of `k` (≤ 12). Add invariants: `J(1) = 0`, `J(n, 1) = n−1`, `k = 2` survivor is odd, and `order[-1] == survivor`.

### S6. How do you handle a variable step per round?
The closed form is gone, but the recurrence survives: at the transition from size `m` to `m−1`, use that round's step in `res = (res + k_m) mod m`. Cost stays `O(n)`.

### S7. How do you handle a different starting seat or counting direction?
Solve the canonical problem, then apply the inverse relabeling — a rotation (start offset) or reflection (direction), elements of the dihedral group on the circle. Encapsulate the transform and apply it exactly once.

### S8. What independent cross-checks exist for the `k = 2` formula?
Compute it two ways: the arithmetic `2(n − 2^⌊log₂ n⌋) + 1` and the bit rotation of `n`'s binary string; assert they agree across a range. Also assert the survivor is always odd and shares `n`'s popcount.

### S9. How would you answer the "`m`-th person eliminated" query?
Simulate the first `m` removals; with a Fenwick tree each is `O(log n)`, so `O(m log n)`. There is no known shortcut to jump to `e_m` for general `k`, because each removal's location depends on all prior ones.

### S10 (analysis). Why is `O(n log n)` essentially the practical floor for the elimination order?
The output is `n` labels, forcing `Ω(n)`. The per-step select-and-delete is a dynamic-rank query; Fenwick gives `O(log n)` portably. A van Emde Boas tree over the integer universe achieves `O(log log n)` per op (`O(n log log n)` total), optimal in the cell-probe model, but with large constants rarely worth it.

---

## Professional Questions (8 Q&A)

### P1. Design a service answering "which seat survives" for arbitrary `(n, k)` at high QPS.
Route by regime: `k = 2` → `O(1)` closed form; small `k`, huge `n` → `O(k log n)` batched; moderate `n` → `O(n)` recurrence. Validate `n ≥ 1, k ≥ 1`; assert the returned seat is in `[1, n]`. The closed-form and batched paths are stateless and trivially horizontally scalable.

### P2. How do you compute the exact survivor without overflow when `n` is near `10^18`?
Use 64-bit and normalize `res = (res + k % m) % m` so intermediates stay below `2n`. For the batched method, cap `cnt` so `m + cnt ≤ n`. If `n` exceeds 64-bit range, use big integers (Python natively, or a bignum library) — but then the `O(n)` loop is infeasible anyway, so only the closed form / batched path applies.

### P3. Your elimination-order job is `O(n²)` and too slow at `n = 10^6`. What do you do?
Replace array-middle removal (`O(n)` each) with a Fenwick tree: store `1` for alive, use the `O(log n)` select-walk to find the `k`-th living person, `update(idx, −1)` to delete. This is `O(n log n)`, feasible at `n = 10^6`. Validate the order against a small-`n` list simulation first.

### P4. How do you debug "the survivor is off by one" in production?
Check the index convention end to end: the recurrence is 0-indexed, the closed form is stated 1-indexed, humans want 1-indexed. Confirm you convert exactly once (`+1`). Cross-check the recurrence and the `k = 2` closed form against each other and against a small-`n` simulation; an off-by-one shows up immediately.

### P5. When is matrix-exponentiation or other heavy machinery NOT the answer here?
The Josephus survivor is a simple `O(n)` (or `O(1)`/`O(k log n)`) recurrence — there is no benefit to matrix exponentiation, segment trees, or DP tables for the survivor. Heavy structures (Fenwick) are warranted only for the *order* query. Reaching for more than needed is a red flag in an interview.

### P6. How do you parallelize a large batch of independent Josephus survivor queries?
Each `(n, k)` query is independent and stateless, so distribute them across workers. The closed-form and batched paths have no shared state. Order queries are heavier (per-query `O(n log n)`) but still independent across queries; shard by query.

### P7. How does the `k = 2` survivor relate to binary representations / automatic sequences?
`J₂(n)` is the one-bit cyclic left rotation of `n`'s binary string — a `2`-regular (automatic) sequence: a finite automaton reading the binary digits of `n` can output the survivor. This is the abstract face of the bit-rotation formula and explains the sawtooth, scale-invariant pattern of `J₂`.

### P8 (analysis). Why is there no general closed form, and what is the asymptotic behavior for `k = 3`?
Only `k = 2` (and trivial `k = 1`) telescope, because of exact power-of-two halving alignment. For `k = 3`, Knuth showed the survivor's relative position tends to a constant fraction governed by a transcendental relation — no elementary closed form — illustrating that even `k = 3` lacks the clean structure of `k = 2`.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced a slow simulation with a formula.
Look for a concrete story: a counting/elimination task simulated naively at `O(n²)`, a profile showing the removal cost dominating, the insight that the survivor follows a one-line recurrence (or the `k = 2` closed form), and a measured speedup. Strong answers mention validating the formula against the old simulation before switching.

### B2. A teammate's Josephus answer is consistently off by one. How do you help?
Calmly identify the 0-/1-indexed mismatch: the recurrence returns `0 … n−1`, humans expect `1 … n`. Show a tiny hand-simulation (`n = 5, k = 2 → seat 3`) and point to the single `+1` conversion boundary. Frame it as a convention-pinning issue, not a competence issue.

### B3. Design a fair "elimination" game feature (e.g. a giveaway where every k-th entrant is removed).
This is the Josephus problem. For the winner, use the recurrence (or `k = 2` closed form). If you must show the elimination sequence to users, use a Fenwick-based `O(n log n)` order. Discuss fairness (the start position and `k` determine the winner deterministically), and seeding/transparency so users trust it.

### B4. How would you explain the Josephus problem to a junior engineer?
Start with the counting-rhyme analogy ("eeny, meeny, miny, moe"): kids in a ring, every `k`-th is out, who's last? Then show the recurrence as "solve a smaller ring, then account for the one extra person shifting the answer by `k`." Lead with the two gotchas: 0-vs-1 indexing, and that it gives the survivor, not the order.

### B5. Your Josephus order job uses too much memory at `n = 10^7`. How do you investigate?
A Fenwick tree is `O(n)` integers — check it is not duplicated per request. Confirm you are not also keeping the full people list alongside it. For survivor-only queries, drop to the `O(1)`/`O(n)` recurrence with no array at all. Profile allocations; the fix is usually removing a redundant structure.

---

## Coding Challenges

### Challenge 1: Survivor for General k

**Problem.** Given `n` people in a circle and step `k`, return the 1-indexed seat that survives when every `k`-th person is eliminated.

**Example.**
```text
n = 5, k = 2  ->  3   (order: 2,4,1,5 ; survivor 3)
n = 7, k = 3  ->  4
```

**Constraints.** `1 ≤ n ≤ 10^7`, `1 ≤ k ≤ 10^9`.

**Optimal.** `O(n)` recurrence.

**Go.**
```go
package main

import "fmt"

func josephus(n, k int) int {
	res := 0 // J(1)
	for m := 2; m <= n; m++ {
		res = (res + k%m) % m
	}
	return res + 1 // 1-indexed
}

func main() {
	fmt.Println(josephus(5, 2)) // 3
	fmt.Println(josephus(7, 3)) // 4
}
```

**Java.**
```java
public class SurvivorGeneral {
    static int josephus(int n, int k) {
        int res = 0;
        for (int m = 2; m <= n; m++) res = (res + k % m) % m;
        return res + 1; // 1-indexed
    }

    public static void main(String[] args) {
        System.out.println(josephus(5, 2)); // 3
        System.out.println(josephus(7, 3)); // 4
    }
}
```

**Python.**
```python
def josephus(n: int, k: int) -> int:
    res = 0  # J(1)
    for m in range(2, n + 1):
        res = (res + k % m) % m
    return res + 1  # 1-indexed


if __name__ == "__main__":
    print(josephus(5, 2))  # 3
    print(josephus(7, 3))  # 4
```

---

### Challenge 2: k = 2 Closed Form (bit rotation)

**Problem.** For step `k = 2`, return the 1-indexed survivor in `O(1)`.

**Example.**
```text
n = 41 -> 19   (101001₂ -> 010011₂)
n = 8  -> 1    (power of two)
```

**Constraints.** `1 ≤ n ≤ 10^18`.

**Optimal.** Highest-set-bit closed form, `O(1)`.

**Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func josephus2(n int64) int64 {
	if n <= 0 {
		panic("n must be positive")
	}
	L := int64(1) << (bits.Len64(uint64(n)) - 1) // 2^floor(log2 n)
	return 2*(n-L) + 1
}

func main() {
	fmt.Println(josephus2(41)) // 19
	fmt.Println(josephus2(8))  // 1
}
```

**Java.**
```java
public class K2ClosedForm {
    static long josephus2(long n) {
        if (n <= 0) throw new IllegalArgumentException("n must be positive");
        long L = Long.highestOneBit(n); // 2^floor(log2 n)
        return 2 * (n - L) + 1;
    }

    public static void main(String[] args) {
        System.out.println(josephus2(41)); // 19
        System.out.println(josephus2(8));  // 1
    }
}
```

**Python.**
```python
def josephus2(n: int) -> int:
    if n <= 0:
        raise ValueError("n must be positive")
    L = 1 << (n.bit_length() - 1)  # 2^floor(log2 n)
    return 2 * (n - L) + 1


if __name__ == "__main__":
    print(josephus2(41))  # 19
    print(josephus2(8))   # 1
```

---

### Challenge 3: Full Elimination Order (Fenwick + binary search)

**Problem.** Return the full elimination order (1-indexed labels, in removal order) for `n` people, step `k`, in `O(n log n)`. The last element is the survivor.

**Example.**
```text
n = 5, k = 2  ->  [2, 4, 1, 5, 3]
```

**Constraints.** `1 ≤ n ≤ 10^6`, `1 ≤ k ≤ 10^9`.

**Optimal.** Fenwick tree with an `O(log n)` select-walk.

**Go.**
```go
package main

import "fmt"

type Fenwick struct {
	n   int
	bit []int
}

func NewFenwick(n int) *Fenwick {
	f := &Fenwick{n: n, bit: make([]int, n+1)}
	for i := 1; i <= n; i++ {
		f.update(i, 1) // all alive
	}
	return f
}

func (f *Fenwick) update(i, v int) {
	for ; i <= f.n; i += i & (-i) {
		f.bit[i] += v
	}
}

// smallest idx with prefix(idx) == rank
func (f *Fenwick) findKth(rank int) int {
	pos, log := 0, 0
	for (1 << (log + 1)) <= f.n {
		log++
	}
	for j := log; j >= 0; j-- {
		nxt := pos + (1 << j)
		if nxt <= f.n && f.bit[nxt] < rank {
			pos = nxt
			rank -= f.bit[nxt]
		}
	}
	return pos + 1
}

func eliminationOrder(n, k int) []int {
	f := NewFenwick(n)
	order := make([]int, 0, n)
	alive, cur := n, 0
	for alive > 0 {
		cur = (cur + k - 1) % alive // 0-indexed living rank of victim
		idx := f.findKth(cur + 1)
		order = append(order, idx)
		f.update(idx, -1)
		alive--
	}
	return order
}

func main() {
	fmt.Println(eliminationOrder(5, 2)) // [2 4 1 5 3]
}
```

**Java.**
```java
import java.util.*;

public class EliminationOrder {
    static int n;
    static int[] bit;

    static void update(int i, int v) {
        for (; i <= n; i += i & (-i)) bit[i] += v;
    }

    static int findKth(int rank) {
        int pos = 0, log = 0;
        while ((1 << (log + 1)) <= n) log++;
        for (int j = log; j >= 0; j--) {
            int nxt = pos + (1 << j);
            if (nxt <= n && bit[nxt] < rank) {
                pos = nxt;
                rank -= bit[nxt];
            }
        }
        return pos + 1;
    }

    static int[] order(int people, int k) {
        n = people;
        bit = new int[n + 1];
        for (int i = 1; i <= n; i++) update(i, 1);
        int[] out = new int[n];
        int alive = n, cur = 0;
        for (int step = 0; step < n; step++) {
            cur = (cur + k - 1) % alive;
            int idx = findKth(cur + 1);
            out[step] = idx;
            update(idx, -1);
            alive--;
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(order(5, 2))); // [2, 4, 1, 5, 3]
    }
}
```

**Python.**
```python
def elimination_order(n: int, k: int):
    bit = [0] * (n + 1)

    def update(i, v):
        while i <= n:
            bit[i] += v
            i += i & (-i)

    for i in range(1, n + 1):
        update(i, 1)  # all alive

    def find_kth(rank):
        pos, log = 0, 0
        while (1 << (log + 1)) <= n:
            log += 1
        for j in range(log, -1, -1):
            nxt = pos + (1 << j)
            if nxt <= n and bit[nxt] < rank:
                pos = nxt
                rank -= bit[nxt]
        return pos + 1

    order = []
    alive, cur = n, 0
    while alive > 0:
        cur = (cur + k - 1) % alive
        idx = find_kth(cur + 1)
        order.append(idx)
        update(idx, -1)
        alive -= 1
    return order


if __name__ == "__main__":
    print(elimination_order(5, 2))  # [2, 4, 1, 5, 3]
```

---

### Challenge 4: Huge-n, Small-k Survivor (O(k log n))

**Problem.** Return the 0-indexed survivor for very large `n` (up to `10^18`) and small `k`, in `O(k log n)`, without an `O(n)` loop.

**Example.**
```text
n = 1_000_000_000, k = 3  ->  (some position, computed instantly)
n = 5, k = 2              ->  2
```

**Constraints.** `1 ≤ n ≤ 10^18`, `2 ≤ k ≤ 10^4`.

**Optimal.** Batched recurrence, `O(k log n)`.

**Go.**
```go
package main

import "fmt"

func josephusFast(n, k int64) int64 {
	if k == 1 {
		return n - 1
	}
	res, m := int64(0), int64(2)
	for m <= n {
		if res+k < m {
			cnt := (m - res - 1) / k
			if m+cnt > n {
				cnt = n - m
			}
			res += cnt * k
			m += cnt
		} else {
			res = (res + k) % m
			m++
		}
	}
	return res
}

func main() {
	fmt.Println(josephusFast(5, 2))             // 2
	fmt.Println(josephusFast(1_000_000_000, 3)) // instant
}
```

**Java.**
```java
public class HugeNSmallK {
    static long josephusFast(long n, long k) {
        if (k == 1) return n - 1;
        long res = 0, m = 2;
        while (m <= n) {
            if (res + k < m) {
                long cnt = (m - res - 1) / k;
                if (m + cnt > n) cnt = n - m;
                res += cnt * k;
                m += cnt;
            } else {
                res = (res + k) % m;
                m++;
            }
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println(josephusFast(5, 2));             // 2
        System.out.println(josephusFast(1_000_000_000L, 3)); // instant
    }
}
```

**Python.**
```python
def josephus_fast(n: int, k: int) -> int:
    if k == 1:
        return n - 1
    res, m = 0, 2
    while m <= n:
        if res + k < m:
            cnt = (m - res - 1) // k
            if m + cnt > n:
                cnt = n - m
            res += cnt * k
            m += cnt
        else:
            res = (res + k) % m
            m += 1
    return res


if __name__ == "__main__":
    print(josephus_fast(5, 2))             # 2
    print(josephus_fast(1_000_000_000, 3))  # instant
```

---

## Final Tips

- Lead with the one-liner: *"The survivor follows `J(n) = (J(n-1) + k) mod n` from `J(1) = 0`, computable in `O(n)`."*
- Immediately flag the two gotchas: **0-indexed recurrence vs 1-indexed seats**, and that it gives **the survivor, not the order**.
- For `k = 2`, reach for the **`O(1)` bit-rotation closed form** (`2(n − 2^⌊log₂ n⌋) + 1`).
- For huge `n` with small `k`, mention the **`O(k log n)` batching**; for the full order, mention the **Fenwick + select** `O(n log n)`.
- Always offer to verify against a brute-force list-simulation oracle on small inputs — it catches the off-by-one every time.
