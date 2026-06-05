# The Josephus Problem — Senior Level

> The Josephus recurrence is rarely the bottleneck on a small circle — but the moment `n` is astronomically large, `k` is large, you need the full elimination order at scale, or the result must be exact and overflow-free, every detail (the `O(k log n)` batching, Fenwick-based order finding, integer overflow, the 0-/1-indexed off-by-one, and testing against simulation) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Scaling the Survivor Query](#2-scaling-the-survivor-query)
3. [Large k and Overflow Budget](#3-large-k-and-overflow-budget)
4. [The m-th Elimination at Scale: Fenwick + Binary Search](#4-the-m-th-elimination-at-scale-fenwick--binary-search)
5. [The k = 2 Closed Form in Production](#5-the-k--2-closed-form-in-production)
6. [Variant Engineering](#6-variant-engineering)
7. [Code Examples](#7-code-examples)
8. [Observability and Testing](#8-observability-and-testing)
9. [Failure Modes](#9-failure-modes)
10. [Worked Incident Walkthroughs](#10-worked-incident-walkthroughs)
11. [Reference Implementation Notes](#11-reference-implementation-notes)
12. [Summary](#12-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is the recurrence" but "what am I actually computing, at what scale, and what breaks?". The Josephus problem shows up in several guises that share one core:

1. **Survivor-only queries** — "which seat survives", where `n` may be `10^18` and `k` may be small or large. The answer must be exact.
2. **Full elimination order** — "list everyone in removal order", inherently `Ω(n)`, where the naive `O(n²)` is unacceptable and you need `O(n log n)`.
3. **The `m`-th elimination** — "who is removed `m`-th", a rank query over the shrinking set of survivors.
4. **Variants** — variable step, different start/direction, choose-your-seat — each a relabeling or a small generalization of the core.

All of them reduce to one of three engines: the `O(n)` / `O(k log n)` survivor recurrence, the `O(1)` `k = 2` closed form, or a Fenwick-tree order-statistic structure. The senior-level decisions are: how to keep the time sublinear when `n` is huge, how to keep the arithmetic exact and overflow-free, how to produce the order at `O(n log n)`, and how to verify the result when `n` is too large to simulate.

This document treats those decisions in production terms.

---

## 2. Scaling the Survivor Query

### 2.1 The three regimes

| Regime | Best method | Cost |
|--------|-------------|------|
| `k = 2`, any `n` | bit-rotation closed form | `O(1)` |
| small `k`, huge `n` | batched recurrence | `O(k log n)` |
| any `k`, moderate `n` (≤ ~10⁷) | plain recurrence | `O(n)` |
| large `k`, huge `n` | no sublinear general method known | `O(n)` (or accept the limit) |

The uncomfortable truth: for **general large `k` and huge `n`** there is no known `O(polylog)` algorithm. The `O(k log n)` batching is sublinear only when `k` is small relative to `n`. If both are huge, you are stuck at `O(n)` — at which point `n = 10^18` is simply infeasible and you must question whether the problem really has both large.

### 2.2 Why `O(k log n)` batching works

The recurrence `res ← (res + k) mod m` only *wraps* (the `mod` actually subtracts `m`) about `O(k log_{k/(k-1)} n) = O(k log n)` times across all sizes. Between wraps, `res` grows by a plain `+k` per size, so you can batch a whole run of sizes `m, m+1, …` in one arithmetic step by computing how many sizes fit before the next wrap. Each "round" of the circle removes roughly a `1/k` fraction, so the number of distinct wrap events is logarithmic in `n` with a `k` factor — hence `O(k log n)`.

### 2.3 The danger of the batching off-by-one

The batched method (shown in [`middle.md`](./middle.md) and Section 7) has a fragile inner computation: `cnt = (m − res − 1) / k` sizes can be skipped before the next wrap. Get this bound wrong by one and you either skip a wrap (silently wrong answer) or never terminate. **The non-negotiable guardrail is to test the batched version against the plain `O(n)` recurrence for all small `n` and a spread of `k`.** This catches the off-by-one that no amount of staring at the formula reliably does.

---

## 3. Large k and Overflow Budget

### 3.1 Overflow in the recurrence

In the recurrence `res = (res + k) % m`, with `res < m ≤ n` and `k` possibly up to `~n`, the intermediate `res + k` is at most `~2n`. For `n ≤ 10^18`, `res + k` can reach `~2·10^18`, which is within `int64` range (`~9.2·10^18`) but uncomfortably close if `k` itself is near `10^18`. **Normalize `k` per step: `res = (res + (k % m)) % m`.** This keeps the intermediate strictly below `2m ≤ 2n` and removes any doubt.

### 3.2 The batched `cnt·k` term

In the `O(k log n)` method, `res += cnt·k` can be large. Bound `cnt` so that `m + cnt ≤ n`, and since `res` stays `< m ≤ n`, the running `res` never exceeds `n`. But the *product* `cnt·k` is computed before the add — ensure it fits. With `cnt ≤ n` and `k` small (the only regime where batching is used), `cnt·k` is comfortably within `int64`. If `k` were large you would not be batching, so the product stays bounded.

### 3.3 Choosing the integer type

| Scenario | Type |
|----------|------|
| `n ≤ 2·10^9` | 32-bit is risky (`res + k` may overflow); prefer 64-bit. |
| `n ≤ ~9·10^18` | 64-bit (`int64` / `long`) with per-step `k mod m`. |
| `n > 9·10^18` | big integers, or reconsider — the `O(n)` loop is infeasible anyway. |

Python's arbitrary-precision integers sidestep overflow entirely, at a constant-factor cost; Go and Java need explicit 64-bit and the `k mod m` normalization.

---

## 4. The m-th Elimination at Scale: Fenwick + Binary Search

### 4.1 The order-statistic view

Producing the full elimination order, or answering "who is the `m`-th eliminated?", is a sequence of **order-statistic** operations over the dynamic set of living people: repeatedly "find and delete the `r`-th living person from the current pointer". A Fenwick (Binary Indexed) tree over `n` slots — each `1` for alive, `0` for dead — supports:

- **prefix sum** `sum(i)` = number of living people in slots `1..i`, in `O(log n)`,
- **find the `r`-th living slot** by binary-searching on the Fenwick (the "Fenwick walk"), in `O(log n)`,
- **delete** a slot via `update(idx, −1)`, in `O(log n)`.

Each elimination is `O(log n)`, so the entire order is `O(n log n)` — the scalable replacement for the `O(n²)` array-shift or `O(n·k)` list simulation.

### 4.2 The pointer arithmetic

The subtle part is converting "`k` steps ahead among the living, cyclically" into a target rank. If `alive` people remain and the pointer sits just before the count at living-rank `cur` (0-indexed among the living), the victim's living-rank is `(cur + k − 1) mod alive`. Convert that 0-indexed living-rank to a 1-indexed rank (`+1`), find that slot via the Fenwick walk, eliminate it, decrement `alive`, and set `cur` to the victim's living-rank (so the next count resumes correctly). **This is the single most error-prone arithmetic in the whole topic; test it against the list simulation entrywise.**

### 4.3 Alternatives to Fenwick

- **Order-statistics tree / balanced BST** — same `O(n log n)`, more code, but supports richer queries.
- **Policy-tree (`__gnu_pbds::tree`)** in C++ — a built-in order-statistic tree; no direct equivalent in Go/Java/Python standard libraries, so Fenwick is the portable choice.
- **Segment tree** — equivalent to Fenwick here; Fenwick is lighter for the "count + find-k-th" pair.

The Fenwick walk (descending powers of two, accumulating prefix sums) gives the `O(log n)` find without a separate `O(log² n)` binary search — prefer it.

---

## 5. The k = 2 Closed Form in Production

### 5.1 Why it is bulletproof

`J(n) = 2·(n − 2^⌊log₂ n⌋) + 1` (1-indexed) is `O(1)`, branch-light, and overflow-safe for any `n` within the integer type. The only computation is the highest set bit. Use the hardware/intrinsic:

- Go: `1 << (bits.Len(uint(n)) − 1)` gives `2^⌊log₂ n⌋`.
- Java: `Integer.highestOneBit(n)` / `Long.highestOneBit(n)`.
- Python: `1 << (n.bit_length() − 1)`.

### 5.2 The edge case: `n` a power of two

When `n = 2^a`, `m = n − 2^a = 0`, so the survivor seat is `1`. This is correct (after a full clean sweep the start position survives) but is exactly the case people get wrong by hand — assert it in tests (`josephus2(8) == 1`, `josephus2(16) == 1`).

### 5.3 The bit-rotation form as a sanity check

The "rotate the leading `1` to the end" interpretation is a free cross-check: implement the formula one way and the rotation the other, then assert they agree across all `n` in a range. Two independent derivations agreeing is strong evidence of correctness.

---

## 6. Variant Engineering

### 6.1 Variable step per round

If the step changes each round (`k_1, k_2, …, k_{n−1}`), the closed form is gone but the reindexing recurrence survives: at the transition from size `m` to `m−1`, use that round's step in `res = (res + k_m) mod m`. Cost stays `O(n)`. There is no `k = 2`-style shortcut because the per-round variation breaks the power-of-two alignment.

### 6.2 Different start / direction

A different starting seat is a rotation of the labels; a reversed direction is a reflection. Solve the canonical problem, then apply the inverse transform to the answer. Encapsulate the transform so it is applied exactly once — applying it twice (or not at all) is a classic regression.

### 6.3 Choose-your-seat / inverse query

"Given `k`, where do I stand to survive?" is just `J(n) + 1`. "Given `n`, which `k` lets seat `s` survive?" is an inverse search: there is no closed form, so search `k` over a sensible range and pick one whose `J(n, k) + 1 = s`. For large `n`, evaluating each candidate `k` via the recurrence is `O(n)`; bound the search range from the problem.

### 6.4 Counting survivors of multiple eliminations / last-`r` standing

If the process stops when `r` people remain (not `1`), the recurrence generalizes: stop building when the circle reaches size `r`, and the *set* of survivors corresponds to the last `r` positions. This is most cleanly handled by the Fenwick simulation, which yields the order and hence the last `r` directly.

---

## 7. Code Examples

### 7.1 Go — survivor: closed form (k=2), batched (small k), plain (general)

```go
package main

import (
	"fmt"
	"math/bits"
)

// 1-indexed survivor for k = 2, O(1).
func survivorK2(n int64) int64 {
	L := int64(1) << (bits.Len64(uint64(n)) - 1)
	return 2*(n-L) + 1
}

// 0-indexed survivor, O(n), overflow-safe.
func survivorPlain(n, k int64) int64 {
	res := int64(0)
	for m := int64(2); m <= n; m++ {
		res = (res + k%m) % m
	}
	return res
}

// 0-indexed survivor, O(k log n) for small k.
func survivorFast(n, k int64) int64 {
	if k == 1 {
		return n - 1
	}
	res := int64(0)
	m := int64(2)
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
	fmt.Println(survivorK2(41))            // 19
	fmt.Println(survivorPlain(5, 2) + 1)   // 3
	fmt.Println(survivorFast(1_000_000_000, 3))
}
```

### 7.2 Java — Fenwick-based full elimination order, O(n log n)

```java
public class JosephusOrder {
    int n;
    int[] bit;

    JosephusOrder(int n) {
        this.n = n;
        this.bit = new int[n + 1];
        for (int i = 1; i <= n; i++) update(i, 1); // all alive
    }

    void update(int i, int v) {
        for (; i <= n; i += i & (-i)) bit[i] += v;
    }

    // smallest index idx with prefix(idx) == rank (Fenwick walk).
    int findKth(int rank) {
        int pos = 0, log = Integer.numberOfTrailingZeros(Integer.highestOneBit(n));
        for (int j = log; j >= 0; j--) {
            int nxt = pos + (1 << j);
            if (nxt <= n && bit[nxt] < rank) {
                pos = nxt;
                rank -= bit[nxt];
            }
        }
        return pos + 1;
    }

    int[] order(int k) {
        int[] out = new int[n];
        int alive = n, cur = 0;
        for (int step = 0; step < n; step++) {
            cur = (cur + k - 1) % alive;     // 0-indexed living rank of victim
            int idx = findKth(cur + 1);       // 1-indexed slot
            out[step] = idx;
            update(idx, -1);
            alive--;
        }
        return out;
    }

    public static void main(String[] args) {
        int[] ord = new JosephusOrder(5).order(2);
        System.out.print("order: ");
        for (int x : ord) System.out.print(x + " "); // 2 4 1 5 3
        System.out.println();
    }
}
```

### 7.3 Python — testing all three survivor methods against simulation

```python
import math


def survivor_k2(n):
    L = 1 << (n.bit_length() - 1)
    return 2 * (n - L) + 1


def survivor_plain(n, k):
    res = 0
    for m in range(2, n + 1):
        res = (res + k % m) % m
    return res


def survivor_fast(n, k):
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


def survivor_simulate(n, k):
    people = list(range(n))
    idx = 0
    while len(people) > 1:
        idx = (idx + k - 1) % len(people)
        people.pop(idx)
    return people[0]


if __name__ == "__main__":
    for n in range(1, 60):
        for k in range(1, 12):
            sim = survivor_simulate(n, k)
            assert survivor_plain(n, k) == sim, (n, k)
            assert survivor_fast(n, k) == sim, (n, k)
            if k == 2:
                assert survivor_k2(n) == sim + 1, (n, k)
    print("all survivor methods agree with simulation")
```

---

## 8. Observability and Testing

A Josephus result is a single integer — one wrong answer looks like any other plausible seat number. Build checks from day one.

| Check | Why |
|-------|-----|
| Brute-force simulation oracle (`n ≤ 60`, `k ≤ 12`) | Catches the 0-/1-indexed off-by-one and the batching bound bug. |
| Plain recurrence vs batched (`O(k log n)`) | The batched method's skip-count is the fragile part. |
| `k = 2` closed form vs simulation | Confirms the highest-bit math and the power-of-two edge. |
| Two derivations of the `k = 2` form (formula vs bit rotation) | Independent agreement is strong evidence. |
| Fenwick order vs list-simulation order | The pointer arithmetic is the most error-prone code. |
| `n = 1` (survivor seat 1), `k = 1` (person `n` survives) | Boundary base cases. |
| Power-of-two `n` with `k = 2` (seat 1) | The classic hand-computation trap. |

The single most valuable test is the **simulation oracle**: a `O(n·k)` list simulation for `n ≤ 60` across a spread of `k`, compared to every fast method. It catches the overwhelming majority of bugs.

### 8.1 A property-test battery

Encode these as randomized property tests on every CI build:

```text
for n in 1..60, k in 1..12:
    sim = simulate(n, k)                       # the oracle (1-indexed survivor)
    assert recurrence(n, k) + 1 == sim
    assert batched(n, k) + 1 == sim
    assert fenwick_order(n, k)[-1] == sim       # last eliminated = survivor
    if k == 2:
        assert closed_form(n) == sim
        assert bit_rotation(n) == closed_form(n)
assert recurrence(1, anyK) == 0                 # base case
assert recurrence(n, 1) == n - 1                # k=1 person n survives
```

The `fenwick_order(...)[-1] == survivor` invariant is especially good: it ties the order-statistic structure to the independent recurrence, catching pointer-arithmetic bugs that pass casual inspection.

### 8.2 Production guardrails

For a service answering Josephus queries: an **input validator** asserting `n ≥ 1` and `k ≥ 1`; a **regime router** that dispatches `k = 2` to the closed form, small-`k`/huge-`n` to the batched recurrence, and order requests to the Fenwick path; and a **magnitude assertion** that the returned seat is in `[1, n]` (a result outside this range is an immediate, loud bug).

---

## 9. Failure Modes

### 9.1 The 0-/1-indexed off-by-one

The recurrence is 0-indexed; the closed form is stated 1-indexed; humans want 1-indexed. Mixing them yields an answer off by exactly one — plausible and easy to ship. Mitigation: pick one convention, convert at exactly one boundary, and assert the recurrence and closed form agree on `k = 2`.

### 9.2 Batched-method skip-count error

`cnt = (m − res − 1) / k` is the fragile bound. Off by one either skips a wrap (wrong survivor) or loops forever. Mitigation: cap `cnt` so `m + cnt ≤ n`, and test exhaustively against the plain recurrence for small `n`.

### 9.3 Integer overflow at huge `n, k`

`res + k` or `cnt·k` overflowing 64-bit silently corrupts the answer. Mitigation: `res = (res + k % m) % m`; keep `cnt` bounded; use 64-bit throughout (or Python big ints).

### 9.4 `O(n)` used for infeasible `n`

Running the linear recurrence for `n = 10^18` simply never finishes. Mitigation: route `k = 2` to the closed form and small-`k` to the batched method; recognize that general large-`k` huge-`n` has no known sublinear method and reject or rescope the request.

### 9.5 Fenwick pointer arithmetic

Converting "`k` ahead among the living, cyclically" to a rank is the single most error-prone code in the topic. An off-by-one produces a *valid-looking* but wrong order. Mitigation: test the Fenwick order against the list simulation entrywise for small `n`.

### 9.6 Wrong start / direction unhandled

A problem that starts the count at a non-zero seat or counts in the other direction needs a relabeling transform. Forgetting it (or double-applying it) shifts every answer. Mitigation: encapsulate the transform and apply it once, verified against a tiny hand-simulation.

### 9.7 Closed form misapplied for `k ≠ 2`

The bit-rotation form is `k = 2` only. Using it for other `k` gives confidently wrong results. Mitigation: guard the closed-form path with `k == 2`.

---

## 10. Worked Incident Walkthroughs

Concrete, production-flavored scenarios that exercise the failure modes above and show how the guardrails catch them.

### 10.1 Incident: the giveaway picked the wrong winner

A "every k-th entrant wins" promotion shipped with `k = 2` and reported winner seat `J₂(n) = 2(n − 2^⌊log₂ n⌋)` — note the missing `+ 1`. For `n = 100`: correct `2(100 − 64) + 1 = 73`, shipped `72`. The result was off by exactly one for every `n`, a textbook 0-/1-indexed slip. The bug survived unit tests that compared against a *also-0-indexed* helper (both wrong the same way). The guardrail that would have caught it: comparing the closed form against an **independent** brute-force list simulation that is unambiguously 1-indexed.

```python
# the catch: simulation is 1-indexed by construction
def sim(n, k):
    people = list(range(1, n + 1)); idx = 0
    while len(people) > 1:
        idx = (idx + k - 1) % len(people); people.pop(idx)
    return people[0]

for n in range(1, 200):
    assert josephus2(n) == sim(n, 2)   # fires immediately at n where +1 is missing
```

### 10.2 Incident: the batched method hung at n = 10^15

A small-`k` service used the batched recurrence with `cnt = (m − res) / k` (missing the `− 1`). For certain `(res, m, k)` the computed `cnt` was `0` when a single non-wrapping step was actually available, so `m` never advanced and the loop spun forever at huge `n`. The corrected bound is `cnt = (m − res − 1) / k`, and the cap `m + cnt ≤ n`. The guardrail: an exhaustive equality test against the plain `O(n)` recurrence for all `n ≤ 2000` and `k ≤ 50` — the hang reproduces instantly at small `n` once you assert progress (`m` strictly increases each iteration).

### 10.3 Incident: the order list was subtly permuted

A Fenwick-based order job updated the pointer with `cur = (cur + k) % alive` (using `k` rather than `k − 1`, then not re-aligning after the delete). The survivor came out correct (it is the last element, robust to mid-stream permutations of equal-cardinality sets in this particular off-by-one), but the *intermediate* order was wrong — users saw an implausible elimination sequence. Because the survivor matched, the survivor-only tests passed; only the **entrywise** order comparison against the list simulation exposed it. Lesson: test the *whole* order, not just `order[-1]`.

### 10.4 Incident: 32-bit overflow at n ≈ 1.5·10^9

A Java service used `int` for `res` and `k`. With `n = 1_500_000_000` and `k` near `n`, the intermediate `res + k` overflowed `Integer.MAX_VALUE` before the `% m`, producing a negative `res` and a nonsensical seat. The fix was `long` throughout plus `res = (res + k % m) % m`. The guardrail: the magnitude assertion `1 ≤ seat ≤ n` fired loudly in staging — a negative or out-of-range seat is an immediate, unmissable signal.

---

## 11. Reference Implementation Notes

### 11.1 A single dispatching entry point

In production, wrap the regimes behind one function so callers never pick the wrong method:

```python
def josephus_survivor(n, k):
    """1-indexed survivor, routed by regime."""
    if n < 1 or k < 1:
        raise ValueError("n>=1 and k>=1 required")
    if k == 2:
        L = 1 << (n.bit_length() - 1)
        seat = 2 * (n - L) + 1
    elif n <= 10_000_000:
        res = 0
        for m in range(2, n + 1):
            res = (res + k % m) % m
        seat = res + 1
    elif k <= 10_000:
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
        seat = res + 1
    else:
        raise NotImplementedError("general large k with huge n has no sublinear method")
    assert 1 <= seat <= n
    return seat
```

The trailing `assert 1 <= seat <= n` is cheap and catches overflow, off-by-one, and regime-routing bugs in one line. The `NotImplementedError` is deliberate: failing loudly on the infeasible regime is better than silently running an `O(n)` loop that never returns.

### 11.2 Choosing thresholds

The `n ≤ 10^7` cutoff for the plain recurrence and `k ≤ 10^4` for batching are tuning knobs, not laws. Measure on your hardware: the plain recurrence does ~`n` modular ops; at ~`10^8`–`10^9` ops/second in Go/Java, `10^7` is comfortably sub-second. The batched method's cost is ~`k log n`, so the `k` cutoff trades the batching's per-wrap overhead against the linear loop. Profile both at the boundary and set the threshold where they cross.

### 11.3 Why not memoize across queries

Each `(n, k)` survivor is independent and cheap to recompute; there is no overlap to exploit across distinct queries (unlike a fixed graph reused across many path-length queries). Caching survivor results by `(n, k)` is only worth it if the same pairs repeat often — usually a thin LRU suffices. The *order* job, by contrast, is `O(n log n)` and worth caching per `(n, k)` if repeated.

### 11.4 Batched-method invariants to assert in code

The batched `O(k log n)` loop is the most fragile path. Encode its invariants as runtime assertions (cheap, since they run `O(k log n)` times, not `O(n)`):

```python
def josephus_fast_checked(n, k):
    assert k >= 1
    if k == 1:
        return n - 1
    res, m = 0, 2
    prev_m = 1
    while m <= n:
        assert m > prev_m or res < m       # progress: m advances or res shrinks via wrap
        assert 0 <= res < m                 # res is always a valid index in size m
        prev_m = m
        if res + k < m:
            cnt = (m - res - 1) // k
            assert cnt >= 1                 # batching must make progress
            if m + cnt > n:
                cnt = n - m
            res += cnt * k
            m += cnt
        else:
            res = (res + k) % m
            m += 1
    assert 0 <= res < n or n == 1
    return res
```

The `cnt >= 1` assertion is the one that fires on the infamous "missing `− 1`" hang (Section 10.2): if `cnt` can be `0`, the loop stalls, and the assertion converts a silent infinite loop into a loud, located failure. Ship the checked variant in staging; strip the asserts only in the hot production path once the fixture suite is green.

### 11.5 Language-specific overflow notes

- **Go / Java:** use `int64` / `long` for `n, k, res, m`. The product `cnt * k` in the batched path must be computed in 64-bit; with `cnt ≤ n` and `k` small (batching regime), it stays under `9·10^18`. Normalize `res = (res + k % m) % m` in the plain loop.
- **Python:** arbitrary-precision integers make overflow a non-issue, but the constant factor of big-int arithmetic shows up at `n` near `10^8` in the plain loop — prefer the batched path or closed form there.
- **Rust / C++ (for reference):** prefer `u64`/`i64`; the same `cnt * k` bound applies, and a debug-build `checked_mul` is a free overflow tripwire.

---

## 12. Summary

- The survivor query has three production regimes: **`O(1)` closed form for `k = 2`**, **`O(k log n)` batched recurrence for small `k` and huge `n`**, and the **`O(n)` plain recurrence** for moderate `n` and any `k`. General large-`k`, huge-`n` has no known sublinear method.
- **Overflow** is real at `n ≤ 10^18`: normalize `res = (res + k % m) % m` and bound `cnt·k`; use 64-bit (or Python big ints).
- The **full elimination order** (and the `m`-th elimination) is an order-statistic workload: a **Fenwick tree** with a `O(log n)` find-`k`-th walk gives `O(n log n)`, replacing the `O(n²)` array-shift simulation. The pointer-to-rank arithmetic is the most error-prone code — test it against the list simulation.
- The **`k = 2` closed form** `2·(n − 2^⌊log₂ n⌋) + 1` is bulletproof; mind the power-of-two edge (seat 1), and use the bit-rotation interpretation as a free cross-check.
- **Variants** (variable step, different start/direction, choose-your-seat, last-`r` standing) are relabelings or small generalizations of the core; the recurrence survives variable steps, the closed form does not.
- **Always keep a simulation oracle.** It catches the 0-/1-indexed off-by-one, the batching skip-count bug, and the Fenwick pointer bug that together account for nearly every real defect.

### Decision summary

- **`k = 2`, any `n`** → bit-rotation closed form (`O(1)`).
- **small `k`, huge `n`, survivor only** → batched recurrence (`O(k log n)`).
- **any `k`, `n ≤ ~10⁷`, survivor only** → plain recurrence (`O(n)`).
- **full elimination order / `m`-th eliminated** → Fenwick + binary search (`O(n log n)`).
- **variable step** → plain recurrence with per-round `k_m` (`O(n)`).
- **general large `k` and huge `n`** → no sublinear method; rescope.

References to study further: *Concrete Mathematics* (Graham-Knuth-Patashnik) for the `k = 2` derivation and bit rotation, cp-algorithms.com for the `O(k log n)` method, the Fenwick / order-statistic literature for scalable order finding, and sibling topics `13-dynamic-programming`, `04-linked-lists`, and the Binary Indexed Tree material under the data-structures track.
