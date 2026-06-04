# Bitmask Enumeration (Iterating Over Sets as Integers) — Interview Preparation

Bitmask enumeration is a high-frequency interview topic because it packs several crisp, testable ideas into a tiny amount of code: representing a subset of `{0..n-1}` as an integer, enumerating all `2^n` subsets, iterating set bits with `m & -m`, walking submasks with `(s-1) & mask`, and recognizing the `O(3^n)` total. Interviewers use it to probe whether you can (a) pick the right loop for the shape of the problem, (b) reason about feasibility (`2^n` vs `3^n`), (c) avoid the classic bugs (off-by-one on the full mask, the missing empty submask, the raw-`~` complement), and (d) map set operations onto bitwise operations fluently. This file is a question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Task | Tool | Complexity |
|------|------|------------|
| Enumerate all subsets of `{0..n-1}` | `for mask in 0..2^n-1` | `O(2^n)` |
| Iterate present elements of a mask | `while m: b=m&-m; m&=m-1` | `O(popcount)` |
| Iterate submasks of a fixed mask | `s = (s-1) & mask` | `O(2^popcount)` |
| Submasks over all masks | nested submask loop | `O(3^n)` |
| Iterate supersets of a fixed mask | `s = (s+1) \| mask` | `O(2^(n-popcount))` |
| Aggregate over all submasks of all masks | SOS DP | `O(n·2^n)` |
| Fixed-size subsets in order | Gosper's hack (sibling 05) | `O(C(n,k))` |

Set operations:

```text
union A∪B          a | b
intersection A∩B   a & b
difference A\B     a & ~b
symmetric diff     a ^ b
complement (n)     a ^ ((1<<n)-1)      # NOT raw ~a
membership i∈A     (a >> i) & 1
subset A⊆B         (a & b) == a
size |A|           popcount(a)
add / remove / toggle i   a|(1<<i) / a&~(1<<i) / a^(1<<i)
```

Key facts:
- Empty set = `0`; full set = `(1 << n) - 1`; loop bound is `mask < (1 << n)`.
- `m & -m` = lowest set bit (a value); `m &= m-1` clears it.
- The submask loop `while s:` **excludes** `0` — handle it separately.
- `Σ_mask 2^popcount(mask) = 3^n` (binomial theorem), so submasks-of-all-masks is `O(3^n)`, not `O(4^n)`.
- Feasibility: `2^n` to `n ≈ 22–25`; `3^n` to `n ≈ 16–18`.

---

## Junior Questions (12 Q&A)

### J1. How do you represent a subset of `{0..n-1}` as an integer?
Set bit `i` to `1` iff element `i` is in the subset. So the integer is `Σ_{i∈S} 2^i`. For example `0b1010 = 10` represents `{1, 3}`.

### J2. How do you enumerate all subsets?
`for mask in range(1 << n)` — the integers `0 .. 2^n - 1` *are* the `2^n` subsets, each exactly once.

### J3. How do you test whether element `i` is in `mask`?
`mask & (1 << i)` is non-zero iff bit `i` is set, i.e. `i ∈ S`. Equivalently `(mask >> i) & 1`.

### J4. What does `1 << n` equal, and why isn't it the full mask?
`1 << n = 2^n`, which is **one past** the last subset. The full set `{0..n-1}` is `(1 << n) - 1` (all `n` low bits set). The loop bound is `mask < (1 << n)`.

### J5. How do you add / remove / toggle element `i`?
Add: `mask | (1 << i)`. Remove: `mask & ~(1 << i)`. Toggle: `mask ^ (1 << i)`.

### J6. What is the empty set and the full set as masks?
Empty set is `0`; full set is `(1 << n) - 1`.

### J7. How do you compute the size of the subset a mask represents?
`popcount(mask)` — the number of set bits. Use `Integer.bitCount` / `bits.OnesCount` / `int.bit_count()`.

### J8. How do you iterate only the elements that are present?
`m = mask; while m: b = m & -m; i = log2(b); use i; m &= m - 1`. Runs `popcount(mask)` times.

### J9. What does `m & -m` give you?
The lowest set bit of `m` as a value (a power of two), e.g. `0b1100 & -0b1100 = 0b0100`.

### J10. Union and intersection of two sets as bitmasks?
Union is `a | b`; intersection is `a & b`.

### J11. How many subsets does a set of `n` elements have?
`2^n`. Each element is independently in or out.

### J12. What is the running example here and its complexity?
"Enumerate all subsets and their sums": loop all `2^n` masks, sum the selected values. With a bit scan per mask it is `O(2^n · n)`.

---

## Middle Questions (10 Q&A)

### M1. Explain the submask enumeration idiom and why it terminates.
`s = mask; while s: process(s); s = (s-1) & mask`. Each step strictly decreases `s` (since `(s-1)&mask ≤ s-1 < s`), so it reaches `0` and stops. It visits every submask once in decreasing order.

### M2. Why is the empty submask not visited by `while s:`?
Because the loop condition is `s != 0`, the body never runs with `s = 0`. Handle `0` explicitly before or after, or use `for(;;){ …; if(s==0) break; s=(s-1)&mask; }`.

### M3. Prove the submask loop visits each submask exactly once.
Identify `mask`'s `p` set positions with a `p`-bit number (order-isomorphism). The step is a decrement on those positions, so it counts down through `[0, 2^p)` once each — every submask, no repeats.

### M4. Why is "submasks of all masks" `O(3^n)` and not `O(4^n)`?
`Σ_mask 2^popcount(mask) = Σ_k C(n,k) 2^k = (1+2)^n = 3^n` by the binomial theorem. Equivalently, each element is in one of three states across a (mask, submask) pair: out of mask, in mask but out of submask, or in submask.

### M5. How do you enumerate supersets of a mask?
`s = mask; loop: process(s); if s==full break; s = (s+1) | mask`. There are `2^(n-popcount(mask))` of them.

### M6. How do you compute the complement of a set, and what's the trap?
`mask ^ ((1<<n)-1)`. The trap is using raw `~mask`, which flips all word bits (including positions `≥ n`), giving a wrong/negative value.

### M7. How would you enumerate only subsets of size `k`?
Either filter all `2^n` masks by `popcount == k`, or use Gosper's hack to jump directly between equal-popcount masks in `O(C(n,k))` (sibling 05).

### M8. When do you prefer the lowbit loop over scanning all `n` bits?
When masks are sparse: the lowbit loop runs `popcount` times and is branchless, versus `n` iterations with a ~50%-mispredicted branch.

### M9. What's the feasibility ceiling for `2^n` and `3^n`?
`2^n` to roughly `n = 22–25`; `3^n` to roughly `n = 16–18`, given ~`10^8`–`10^9` ops/sec.

### M10. How does this connect to bitmask DP?
The mask becomes a DP *state* (which elements are used/covered). All-subsets and submask loops are the transition loops. See sibling `13/06-bitmask-dp`.

---

## Senior Questions (8 Q&A)

### S1. What's the Java shift trap with masks?
`<<` on `int` masks the shift count mod 32, so `1 << 32 == 1` and `1 << 35 == 1 << 3`. Use `1L << n` for `n ≥ 31` and assert `n < 31` for int masks.

### S2. What is the integer-width ceiling on `n`?
30 for signed 32-bit, 62–63 for 64-bit. Beyond 64 you need a bitset (array of words) and lose the single-instruction lowbit/submask tricks; but `2^n` is hopeless there anyway.

### S3. When should you avoid the `O(3^n)` submask loop entirely?
When you only need an *aggregate* (sum/min/max) over each mask's submasks — use SOS (sum-over-subsets) DP in `O(n·2^n)` instead.

### S4. What's the meet-in-the-middle escape for large `n`?
Split the universe into two halves, enumerate `2^(n/2)` subsets each, and combine — turning `2^40` into two `2^20` passes.

### S5. How do you test enumeration code with `2^n` outputs?
By properties and oracles: assert exact counts (`2^n`, `2^popcount`, `3^n`), uniqueness/coverage via a set, and compare submask output to the brute-force filter `{t : t & mask == t}`.

### S6. What memory limit bites first in bitmask DP?
`dp[2^n]` of 8-byte entries: `n=24 → 128MB`, `n=26 → 512MB`. Memory often caps `n` before time does.

### S7. Iteration order and cache — what matters?
Increasing-mask sweeps over `dp[]` are sequential and cache-friendly; submask loops scatter accesses, which is the real `3^n` cost. SOS DP keeps the sweep sequential.

### S8. What silent bugs pass small tests and break later?
Signed/wide shifts (`1 << 31`), raw-`~` complement, missing empty submask, and under-sizing `3^n` feasibility — all look fine on `n ≤ 4`.

---

## Behavioral Prompts

- **"Tell me about a time you optimized a brute-force solution."** Frame: recognized the search was over subsets; replaced nested-loop/recursive include-exclude with a bitmask enumeration, then with bitmask DP, citing the `2^n`/`3^n` feasibility analysis you did up front.
- **"Describe a subtle bug you found in code review."** Frame: a colleague used raw `~mask` for set complement; on a 6-element universe it leaked high bits and corrupted a subset comparison. You proposed `mask ^ ((1<<n)-1)` and a property test `complement(complement(x)) == x`.
- **"How do you communicate a tricky algorithm to teammates?"** Frame: wrapped `(s-1)&mask` in a documented `forEachSubmask` helper with the one-line invariant and a count assertion, so the trick is explained once and reused safely.
- **"When did you choose *not* to use a clever trick?"** Frame: needed an aggregate over submasks for `n=20`; `3^n` was 3.5 billion, so you used SOS DP `O(n·2^n)` instead — clever where it pays, simple where it doesn't.

---

## Coding Challenges

### Challenge 1 — Sum Over All Subsets

**Problem.** Given `value[0..n-1]`, print the maximum subset sum that does not exceed a budget `B` (subset sums via full enumeration). `n ≤ 20`.

#### Go

```go
package main

import "fmt"

func maxSumUnder(value []int, B int) int {
	n := len(value)
	best := 0
	for mask := 0; mask < (1 << n); mask++ {
		sum := 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				sum += value[i]
			}
		}
		if sum <= B && sum > best {
			best = sum
		}
	}
	return best
}

func main() {
	fmt.Println(maxSumUnder([]int{3, 1, 4, 1, 5}, 9)) // 9
}
```

#### Java

```java
public class MaxSumUnder {
    static int maxSumUnder(int[] value, int B) {
        int n = value.length, best = 0;
        for (int mask = 0; mask < (1 << n); mask++) {
            int sum = 0;
            for (int i = 0; i < n; i++)
                if ((mask & (1 << i)) != 0) sum += value[i];
            if (sum <= B && sum > best) best = sum;
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(maxSumUnder(new int[]{3, 1, 4, 1, 5}, 9)); // 9
    }
}
```

#### Python

```python
def max_sum_under(value, B):
    n = len(value)
    best = 0
    for mask in range(1 << n):
        s = sum(value[i] for i in range(n) if mask & (1 << i))
        if s <= B and s > best:
            best = s
    return best


if __name__ == "__main__":
    print(max_sum_under([3, 1, 4, 1, 5], 9))  # 9
```

### Challenge 2 — Partition Into Two Groups (Minimize Difference)

**Problem.** Split `value[0..n-1]` into two groups; minimize `|sumA − sumB|`. Enumerate every assignment of group membership as a mask. `n ≤ 20`.

#### Go

```go
package main

import "fmt"

func minDiff(value []int) int {
	n := len(value)
	total := 0
	for _, v := range value {
		total += v
	}
	best := 1 << 62
	for mask := 0; mask < (1 << n); mask++ {
		a := 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				a += value[i]
			}
		}
		d := total - 2*a
		if d < 0 {
			d = -d
		}
		if d < best {
			best = d
		}
	}
	return best
}

func main() {
	fmt.Println(minDiff([]int{3, 1, 4, 2, 2})) // 0
}
```

#### Java

```java
public class MinDiff {
    static int minDiff(int[] value) {
        int n = value.length, total = 0;
        for (int v : value) total += v;
        int best = Integer.MAX_VALUE;
        for (int mask = 0; mask < (1 << n); mask++) {
            int a = 0;
            for (int i = 0; i < n; i++)
                if ((mask & (1 << i)) != 0) a += value[i];
            best = Math.min(best, Math.abs(total - 2 * a));
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(minDiff(new int[]{3, 1, 4, 2, 2})); // 0
    }
}
```

#### Python

```python
def min_diff(value):
    n = len(value)
    total = sum(value)
    best = float("inf")
    for mask in range(1 << n):
        a = sum(value[i] for i in range(n) if mask & (1 << i))
        best = min(best, abs(total - 2 * a))
    return best


if __name__ == "__main__":
    print(min_diff([3, 1, 4, 2, 2]))  # 0
```

### Challenge 3 — Submasks for a Set Cover

**Problem.** Given a target `mask` and sets `cover[j]` (each a bitmask), count the submasks `s ⊆ mask` such that `s` equals the union of some single `cover[j]` intersected with `mask`. Simpler form: for a fixed `mask`, iterate all its submasks and count those that are also a superset of a given required core `req ⊆ mask`. Demonstrates the `(s-1)&mask` loop.

#### Go

```go
package main

import "fmt"

func countSubmasksContaining(mask, req int) int {
	count := 0
	for s := mask; ; s = (s - 1) & mask {
		if s&req == req { // req ⊆ s
			count++
		}
		if s == 0 {
			break
		}
	}
	return count
}

func main() {
	// submasks of 0b111 that contain 0b001: {001,011,101,111} => 4
	fmt.Println(countSubmasksContaining(0b111, 0b001)) // 4
}
```

#### Java

```java
public class SubmaskCover {
    static int countSubmasksContaining(int mask, int req) {
        int count = 0;
        for (int s = mask; ; s = (s - 1) & mask) {
            if ((s & req) == req) count++;
            if (s == 0) break;
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countSubmasksContaining(0b111, 0b001)); // 4
    }
}
```

#### Python

```python
def count_submasks_containing(mask, req):
    count = 0
    s = mask
    while True:
        if s & req == req:   # req subset of s
            count += 1
        if s == 0:
            break
        s = (s - 1) & mask
    return count


if __name__ == "__main__":
    print(count_submasks_containing(0b111, 0b001))  # 4
```

### Challenge 4 — Count Subsets With a Property

**Problem.** Count subsets of `value[0..n-1]` whose sum is divisible by `k`. Enumerate all `2^n` subsets. `n ≤ 20`.

#### Go

```go
package main

import "fmt"

func countDivisible(value []int, k int) int {
	n := len(value)
	count := 0
	for mask := 0; mask < (1 << n); mask++ {
		sum := 0
		m := mask
		for m != 0 {
			i := m & -m // lowest set bit value
			idx := 0
			for (1 << idx) != i {
				idx++
			}
			sum += value[idx]
			m &= m - 1
		}
		if sum%k == 0 {
			count++
		}
	}
	return count
}

func main() {
	fmt.Println(countDivisible([]int{1, 2, 3}, 3)) // subsets with sum%3==0: {},{3},{1,2} => 3
}
```

#### Java

```java
public class CountDivisible {
    static int countDivisible(int[] value, int k) {
        int n = value.length, count = 0;
        for (int mask = 0; mask < (1 << n); mask++) {
            int sum = 0, m = mask;
            while (m != 0) {
                int idx = Integer.numberOfTrailingZeros(m);
                sum += value[idx];
                m &= m - 1;
            }
            if (sum % k == 0) count++;
        }
        return count;
    }

    public static void main(String[] args) {
        System.out.println(countDivisible(new int[]{1, 2, 3}, 3)); // 3
    }
}
```

#### Python

```python
def count_divisible(value, k):
    n = len(value)
    count = 0
    for mask in range(1 << n):
        s, m = 0, mask
        while m:
            idx = (m & -m).bit_length() - 1
            s += value[idx]
            m &= m - 1
        if s % k == 0:
            count += 1
    return count


if __name__ == "__main__":
    print(count_divisible([1, 2, 3], 3))  # 3
```

---

## Rapid-Fire Round (quick answers)

- **Full mask for `n`?** `(1 << n) - 1`.
- **Loop bound for all subsets?** `mask < (1 << n)`.
- **Lowest set bit value?** `m & -m`.
- **Clear lowest set bit?** `m &= m - 1`.
- **Index of lowest set bit?** trailing-zero count of `m`.
- **Complement within `n`?** `mask ^ ((1<<n)-1)`, never `~mask`.
- **Number of submasks of `mask`?** `2^popcount(mask)`.
- **Submasks of all masks total?** `3^n`.
- **Number of supersets of `mask` in `n` bits?** `2^(n-popcount(mask))`.
- **Empty set / full set?** `0` / `(1<<n)-1`.
- **Is `a` a subset of `b`?** `(a & b) == a`.
- **Are `a`, `b` disjoint?** `(a & b) == 0`.
- **Add element `i`?** `mask | (1<<i)`. **Remove?** `mask & ~(1<<i)`. **Toggle?** `mask ^ (1<<i)`.
- **Why `3^n` and not `4^n`?** Three states per element across a (mask, submask) pair.
- **SOS DP cost?** `O(n · 2^n)`.
- **Feasible `n` for `2^n`?** ~22–25. **For `3^n`?** ~16–18.

## Common Follow-Up Probes

Interviewers often deepen a question to test whether you actually understand the idiom rather than memorized it. Be ready for:

- **"Walk me through `(s-1) & mask` on a concrete mask."** Take `mask = 0b110`. `s=6 → (5)&6=4 → (3)&6=2 → (1)&6=0`, then stop. That is `{1,2},{2},{1},{}` — all four submasks. Showing the trace convinces the interviewer instantly.
- **"What if I forget the `s == 0` break?"** After `s=0`, `(0-1)&mask = (-1)&mask = mask`, so it wraps to the start and loops forever. The break is mandatory.
- **"How do you include the empty subset cleanly?"** Use `for(;;){ work(s); if(s==0) break; s=(s-1)&mask; }` so `0` is processed exactly once.
- **"Why is increasing-mask order safe for submask DP?"** Every proper submask is a strictly smaller integer, so it is already computed when you reach `mask` — increasing order is a topological order of the subset lattice.
- **"Scale it: `n = 40`?"** `2^40` is ~10^12, infeasible. Switch to meet-in-the-middle: split into two halves of 20, enumerate `2^20` each, combine.

## Interview Tips

- **State the representation first:** "I'll encode each subset as an integer, bit `i` = element `i` present." This signals fluency immediately.
- **Announce feasibility:** quote `2^n`/`3^n` and the `n` ceiling before coding; it shows you sized the problem.
- **Pick the loop deliberately:** all-subsets vs submasks vs supersets — say which and why.
- **Call out the two classic bugs proactively:** full mask is `(1<<n)-1`, and the `while s:` loop omits the empty submask.
- **Mention the `3^n` insight** when a submask-of-all-masks pattern appears — interviewers love the binomial / three-states explanation.
- **Offer the upgrade path:** "if `n` were larger I'd use meet-in-the-middle or SOS DP" demonstrates range.
- **Use built-in popcount/trailing-zeros** rather than hand loops; note the single-instruction cost.
- **Trace a tiny case aloud** (e.g. submasks of `0b110`) when explaining `(s-1)&mask`; a concrete walk lands the point far better than the formula alone.
- **Name the lattice connection** if pressed on ordering: increasing integer order is a topological sort of the subset lattice, so submask-dependent DP just sweeps `0 .. 2^n-1`.

---

## Mock Interview Walkthrough

A realistic 30-minute flow on Challenge 2 (two-group partition), showing how to narrate:

1. **Restate and clarify (1 min).** "We split the array into two groups to minimize the absolute difference of sums. May elements be empty groups? Any size limit on `n`?" — Interviewer: `n ≤ 20`, groups may be empty.
2. **Identify the search space (2 min).** "Each element independently goes to group A or B — that is a binary choice per element, so `2^n` assignments. With `n ≤ 20` that is about a million, well within budget. I'll encode each assignment as a bitmask: bit `i` set means element `i` is in group A."
3. **State the formula (1 min).** "If `a` is group A's sum, group B's sum is `total - a`, and the difference is `|total - 2a|`. So I just minimize that over all masks."
4. **Code it (8 min).** Write the all-subsets loop with a lowbit inner accumulation; mention `long`/`int64` for the sums.
5. **Test (4 min).** "Balanced multiset `[3,1,4,2,2]` totals 12; a `0` difference partition exists, so the answer should be `0`." Trace one mask to confirm the formula.
6. **Discuss scaling (4 min).** "At `n = 40` this `2^40` is infeasible; I'd meet-in-the-middle: enumerate `2^20` subset sums of each half, sort one half, and binary-search the closest complement — `O(2^{n/2} · n/2)`."
7. **Edge cases (2 min).** Empty input, all-zero values, a single element (difference is that element).

The pattern generalizes: *restate → size the search space → encode as masks → state the per-mask formula → code → test with a known answer → discuss the scaling escape hatch.*

## Pitfalls Interviewers Watch For

- Using `1 << n` as the full mask (off by the top bit) or as the loop's inclusive bound.
- Writing `~mask` for complement and not masking to `n` bits.
- A submask loop that omits `0` when the empty subset is part of the answer, or that never terminates.
- Quoting `O(4^n)` for the submask double loop instead of the correct `O(3^n)`.
- Recomputing a subset's sum from scratch when a lowbit or Gray-code incremental update would do.
- Ignoring overflow on subset sums (32-bit) for large values.

## Summary

Interviewers reward one crisp insight — *a subset is an integer, bit `i` = element `i`* — and then test whether you can choose among the three loops (all subsets `2^n`, set bits `popcount`, submasks `2^popcount`), reason about feasibility (`2^n` to ~22, `3^n` to ~17), map set algebra to bitwise ops (with `mask ^ ((1<<n)-1)` for complement, never raw `~`), and dodge the classic bugs (full mask `(1<<n)-1`, the missing empty submask, Java's shift-count masking). Know the `3^n = Σ C(n,k)2^k` derivation cold, and know when to escape to SOS DP (`O(n·2^n)`) or meet-in-the-middle. The four challenges above — subset sums, two-group partition, submask cover counting, and counting subsets by property — exercise every idiom in Go, Java, and Python.
