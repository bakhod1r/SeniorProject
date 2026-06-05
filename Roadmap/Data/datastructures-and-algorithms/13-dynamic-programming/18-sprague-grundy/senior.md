# Sprague-Grundy Theorem and Grundy Numbers — Senior Level

> Grundy theory is rarely the hard part on a toy game — but the moment the state space is large, the game must be *recognized* as decomposable, the input `n` is astronomical, or someone quietly slips you a misère or loopy variant, every decision (state encoding, periodicity proof, decomposition correctness, brute-force verification, convention) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Recognizing Decomposable Games](#2-recognizing-decomposable-games)
3. [Big-State Grundy via Periodicity and Closed Forms](#3-big-state-grundy-via-periodicity-and-closed-forms)
4. [State Encoding and Memoization at Scale](#4-state-encoding-and-memoization-at-scale)
5. [Proving Outcomes](#5-proving-outcomes)
6. [Misère, Loopy, and Partizan Hazards](#6-misère-loopy-and-partizan-hazards)
7. [Performance Engineering](#7-performance-engineering)
8. [Code Examples](#8-code-examples)
9. [Testing via Brute Force](#9-testing-via-brute-force)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is `mex`" but "is this even a Sprague-Grundy problem, and if so, how do I make the computation feasible and the answer *defensible*?" Grundy analysis shows up in three guises that look different but share one engine:

1. **A compound game that must be decomposed** — the position is secretly a sum of independent sub-games, and the whole point is to *recognize* the decomposition so the `n^m` monolith collapses to a table plus an XOR.
2. **A single game with a huge parameter** — a subtraction or take-away game with `n = 10^18`, solved by detecting periodicity or deriving a closed form, not by filling a table to `n`.
3. **A disguised classic** — staircase Nim, Wythoff, Mock Turtles, Kayles — where the win is to *match* the position to a known game whose Grundy structure is already solved.

All three reduce to: *identify the independent components, compute or characterize their Grundy values cheaply, XOR, and decide.* The senior decisions are: how to keep the state space small and canonical, how to handle `n` too large to tabulate, how to *prove* the outcome (not just compute it), and how to verify against a brute-force oracle when the analytical claim is subtle.

This document treats those decisions in production and competitive terms.

---

## 2. Recognizing Decomposable Games

### 2.1 The decomposition reflex

The most valuable senior skill is asking, on first contact: *does a single move ever affect more than one "region" of the position?* If **no**, the game is a sum of independent components, and Sprague-Grundy applies component-wise with XOR. If **yes** (a move touches two regions at once), the components are coupled and you cannot XOR them — you must model the coupled state directly or find a cleverer decomposition.

Signals that a game decomposes:

- Multiple piles / rows / tokens where a move touches exactly one.
- A move that **splits** a region into two independent regions (the split children become a sum — XOR them *inside* the mex).
- A board that falls into disconnected pieces after some moves (Kayles, Dawson's chess, node/edge deletion games).

### 2.2 Splitting moves create sums

When a move on a region of size `n` yields two independent regions of sizes `a` and `b`, the resulting Grundy value is `g(a) ⊕ g(b)`, so

```
g(n) = mex { g(a) ⊕ g(b) : (a, b) reachable by a single move }
```

This is the structural reason Grundy's game, Kayles, and Dawson's chess have `mex`-over-XOR recurrences. Forgetting the XOR — taking `mex` over the *pair* or over a single child — is a classic senior-level bug that survives small tests if the splits happen to be trivial early on.

### 2.3 Disguised classics worth memorizing

| Disguise | Underlying structure | Grundy / outcome rule |
|----------|---------------------|------------------------|
| Coins sliding down steps | Staircase Nim | XOR of coins on **odd** steps |
| "Turning turtles" / coin rows | Coin-turning game | XOR of single-coin Grundy values over heads |
| Two-pile take-from-either-or-both equal | **Wythoff's game** | losing iff `(⌊φ·d⌋, ⌊φ²·d⌋)` Beatty pairs (not pure XOR) |
| Knock down adjacent pins | Kayles | precomputed, period 12 after a short prefix |
| Token on a DAG | Geography-style | `mex` of out-neighbors |

Wythoff is the cautionary tale: it is impartial but its losing positions are **not** characterized by XOR — they follow the golden-ratio Beatty sequence. Sprague-Grundy still assigns each position a Grundy value, but the *closed form* for losing positions is not "XOR = 0," reminding you that recognizing a game's special structure can beat blindly tabulating Grundy values.

### 2.4 A decomposition worked example

Suppose a problem hands you a "board" that is a row of pins where a move knocks down one or two adjacent pins (Kayles), and the row currently has gaps splitting it into independent segments of lengths `4, 7, 9`. The naive analysis treats the whole board as one coupled state — exponential. The decomposition reflex instead asks "does one move touch two segments?" No: a move stays within one contiguous segment (and may split *that* segment further). So the board is a disjunctive sum, and its Grundy value is

```
g(board) = g_Kayles(4) ⊕ g_Kayles(7) ⊕ g_Kayles(9)
```

where each `g_Kayles(len)` is a precomputed single-segment value. With the Kayles table `g = [0,1,2,3,1,4,3,2,1,4,2,…]`, this is `1 ⊕ 2 ⊕ 4 = 7 ≠ 0`, a win. The exponential coupled state collapsed to three table lookups and two XORs. *This* is the senior move: see the sum, never build the product.

### 2.5 When the reflex says "do not decompose"

Equally important is recognizing when components are *coupled*. If a single move can, say, remove a pin from segment A **and** add one to segment B, the segments are not independent, `g(A ⊎ B) ≠ g(A) ⊕ g(B)`, and XOR gives a wrong winner. The diagnostic is the property test from Section 9: compute `g` of the coupled position by brute force on small instances and compare to the XOR of the alleged components; a single mismatch proves the decomposition invalid. Trusting an unverified decomposition is one of the most insidious failures because it produces a plausible number.

---

## 3. Big-State Grundy via Periodicity and Closed Forms

### 3.1 Why periodicity is the whole game for large `n`

For a subtraction game with finite `S`, a Grundy value depends only on the previous `max(S)` values, and each value is in `[0, |S|]`. So the *window* of the last `max(S)` Grundy values lives in a finite set; by pigeonhole the window must recur, and once it recurs the entire sequence is periodic thereafter. This guarantees an eventually-periodic sequence with a computable (if sometimes large) period — the formal statement and bounds are in [`professional.md`](./professional.md).

Operationally: tabulate to `N = c · max(S)` for a generous `c`, detect a window that repeats for several full cycles, then answer `g[n] = g[n₀ + (n − n₀) mod π]`. This turns `n = 10^18` from impossible into `O(1)`.

### 3.2 When there is no clean period

Not every game is periodic. Grundy's game has no proven period (open problem). Octal games (a broad class of take-and-split games encoded by an "octal code") are *often* periodic — Guy and Smith's results, and a large body of computational searches, establish periods for many — but some remain unresolved. Senior judgment: if a take/split game is in the octal family, search for a period up to a safe bound; if none appears, fall back to direct tabulation within feasible `n`, and *do not* claim a period you have not verified.

### 3.3 Closed forms beat tables

Sometimes the Grundy sequence has an exact formula:

- Subtraction `S = {1, 2, …, k}` (take 1..k): `g[n] = n mod (k+1)`. Losing iff `(k+1) | n`.
- Nim pile: `g(n) = n`.
- "Take any number" (one pile, remove ≥ 1): `g(n) = n` for `n ≥ 1` essentially Nim.

When a closed form exists and you can prove it, it is `O(1)` per query and immune to the periodicity-detection pitfalls. Always look for one before tabulating.

### 3.4 Worked periodicity detection

For `S = {2, 3}` (`max(S) = 2`), tabulate and look for a repeating window of length `2`:

```
n   : 0 1 2 3 4 5 6 7 8 9 ...
g[n]: 0 0 1 1 2 0 0 1 1 2 ...
```

The window `(g[n], g[n+1])` returns to `(0, 0)` at `n = 5` after first appearing at `n = 0`, and the *full* window of length `max(S) = 2` matches: `(g[0], g[1]) = (0,0) = (g[5], g[6])`. By the one-window certification (professional §8, Corollary 8.4), this guarantees `g[n+5] = g[n]` for all `n ≥ 0` — period `π = 5`, pre-period `n₀ = 0`. So `g[10^18] = g[10^18 mod 5] = g[0] = 0` (a losing position) in `O(1)`. The discipline that makes this rigorous: verify the entire length-`max(S)` window, not just one term — `(0,0)` also appears to "match" `(0,0)` at index 1, but the *windows* `(g[1],g[2]) = (0,1)` differ, so the period is not 1.

---

## 4. State Encoding and Memoization at Scale

### 4.1 Canonicalization is the lever

Cost is dominated by the number of *distinct* states you memoize. Two states that are equivalent under a symmetry must map to the same cache key:

- **Sort** multiset states (pile collections) so `{3,1,2}` and `{2,3,1}` collide.
- **Normalize** board orientation (reflections/rotations) for grid games.
- **Drop irrelevant fields** that do not affect the move set.

Halving the state count is a direct 2× speedup (and often far more, since states fan out).

### 4.2 Encoding compact states

- Small piles → pack into an integer (base-`b` digits) or a tuple key.
- A row of cells with local moves (Kayles-like) → represent a position as a *multiset of segment lengths*; precompute single-segment Grundy values and XOR.
- Bitmask the board when cells are binary (heads/tails, occupied/empty) and the board is ≤ 64 cells.

### 4.3 Memoization discipline

- Use a hash map keyed by the canonical encoding; for dense integer states, an array.
- For splitting games, memoize **segment-length** Grundy values once, then any position is an XOR over its segments — never re-memoize whole boards.
- Beware unbounded recursion: assert the state strictly decreases along every move (the DAG property) before trusting memoized Grundy.

---

## 5. Proving Outcomes

Computing a Grundy value is not the same as *proving* who wins, which interviewers and rigorous write-ups demand.

### 5.1 The two-part outcome proof

To prove a set `P` of positions are exactly the losing (P) positions, show:

1. **From every `p ∈ P`, every move leads to a position not in `P`** (you cannot stay losing — equivalently, you cannot keep XOR at 0 with a single move). This is the "any move from balanced unbalances it" half.
2. **From every `q ∉ P`, some move leads to a position in `P`** (you can always re-balance). This is the "some move from unbalanced re-balances it" half.

Together these prove `P` is closed under the win/loss recursion and matches `grundy = 0`. This is exactly the structure of the Nim and Sprague-Grundy proofs in [`professional.md`](./professional.md).

### 5.2 Proving a constructive winning move

It is not enough to say "XOR ≠ 0 so you win"; produce the move:

- Highest set bit `h` of `x = ⊕ g(componentᵢ)`; pick a component with bit `h` set; target Grundy `t = g(C) ⊕ x < g(C)`; move within `C` to a child of Grundy `t`. Such a child exists by the mex property (every value below `g(C)` is reachable).

Demonstrating this move is the difference between "I computed a number" and "I solved the game."

### 5.2b Worked constructive move

Three components with Grundy values `g = (6, 9, 3)`. Total `x = 6 ⊕ 9 ⊕ 3 = 12 = 1100₂ ≠ 0`, so the mover wins. Construct the move:

```
x = 1100₂, highest set bit h = bit 3 (value 8).
Which component has bit 3 set in its Grundy value?  6=0110 no, 9=1001 yes, 3=0011 no.
=> pick component 2 (g = 9). Target t = 9 ⊕ 12 = 0101₂ = 5, and 5 < 9. ✓
Move within component 2 to a child of Grundy value 5.
New total: 6 ⊕ 5 ⊕ 3 = 0  → opponent now faces a P-position.
```

The existence of a child with Grundy exactly `5` is guaranteed by the mex property (Proposition 2.3 of `professional.md`): a position of Grundy `9` reaches every value `0..8`, including `5`. The senior deliverable is not "you win" but this explicit `(component, target)` pair, plus the proof-of-existence of the realizing move inside that component.

### 5.4 Proving a claimed closed form

When you conjecture a formula like `g[n] = n mod (k+1)`, prove it by induction: assume it for all `m < n`, show the reachable set of values is exactly `{0,…,(n mod (k+1)) − 1}` (so the mex hits the claimed value), handling the `n ≡ 0` case where the reachable set omits `0`. This is strictly stronger than empirical agreement on the first hundred terms, and immune to the periodicity-detection pitfalls. A proven closed form is the gold standard: `O(1)` per query with zero detection risk.

### 5.3 Proving periodicity rigorously

A claimed period `π` from index `n₀` is proven by the **window argument**: if `g[n₀ .. n₀ + max(S) − 1] = g[n₀ + π .. n₀ + π + max(S) − 1]` (one full window matches), then because each `g[x]` is a deterministic function of the previous `max(S)` values, the equality propagates forever by induction. So you only need *one window match* after `n₀` — but you must verify the *entire* window of length `max(S)`, not just a few terms. This is the rigorous replacement for "it looks periodic."

---

## 6. Misère, Loopy, and Partizan Hazards

### 6.1 Misère play breaks naive XOR

Under misère (last move *loses*), the rule "XOR = 0 is a loss" is **wrong** in general. For **Nim specifically**, there is a clean misère rule: play as in normal Nim *unless* your move would leave all piles of size ≤ 1, in which case leave an odd number of size-1 piles. But for general impartial games, misère analysis requires **genus theory** / **misère quotients** (Conway, Plambeck-Siegel) — substantially harder, and there is no simple Grundy-XOR analog. Senior takeaway: confirm the convention; if misère, do not reuse the normal-play Grundy verdict without the correction.

### 6.2 Loopy games have no DAG

If positions can repeat (draws or infinite play possible), the move graph has cycles, the mex recursion may not terminate, and Grundy values may not exist. These need **loopy game theory** (with values like ∞ / "draw"). Detect cycles before applying Grundy.

### 6.3 Partizan games have no Grundy number

If the two players have *different* move sets (the game is partizan), there is no single Grundy number; you need surreal-number / partizan combinatorial game theory (left/right options, game values). Sprague-Grundy is strictly for impartial games.

### 6.4 Scoring and chance break it entirely

Grundy theory answers only "who makes the last move" under perfect play with no chance. Games scored by points, or with randomness, are outside its scope — use minimax / expectiminimax instead.

### 6.5 A hazard-classification checklist

Before reaching for Grundy + XOR, run this checklist; any "no" routes you elsewhere:

1. **Impartial?** Both players share the same moves from every position. If no → partizan theory (surreal numbers, Left/Right options).
2. **Terminating (DAG)?** Every play sequence ends; no position repeats. If no → loopy game theory (draw values).
3. **Normal play?** Last to move wins. If no (misère) → Bouton's misère Nim rule, or genus / misère quotients in general.
4. **No score, no chance?** The outcome is purely "who moves last," deterministic. If no → minimax / expectiminimax.
5. **Decomposable?** A move touches exactly one component. If yes → Grundy each, XOR. If no → model the coupled state directly.

Only when all of 1–4 hold does the Sprague-Grundy machine apply at all; step 5 then decides whether you get the XOR shortcut or must analyze a single (possibly large) game.

---

## 7. Performance Engineering

### 7.1 The mex inner loop

`mex` over `m` children should use a reused boolean scratch array of size `m+1`, cleared lazily (e.g., with a "stamp"/version counter to avoid re-zeroing). Hash sets are convenient but allocate and chase pointers; for hot Grundy fills they are the dominant cost.

### 7.2 Precompute-once, reuse-many

- For a game family queried repeatedly, compute the Grundy table (or the segment-Grundy values) **once** and reuse across queries. Rebuilding per query is a classic latency regression.
- Cache the detected period; never re-detect per query.

### 7.3 Memory

- Subtraction tables are `O(n)` integers — but if `n` is huge you must *not* allocate to `n`; tabulate only to the period bound and switch to modular lookup.
- For board games, the memo map size is the real memory driver; canonicalization (Section 4.1) controls it.

### 7.4 Parallelism

Grundy of independent components is embarrassingly parallel: compute each component's value on a separate worker, then XOR. The within-table DP is inherently sequential (each value depends on earlier ones), so parallelism lives across *components* and across *independent queries*, not inside a single subtraction-table fill.

---

## 8. Code Examples

### 8.1 Go — generic memoized Grundy with canonicalized multiset state (splitting game)

```go
package main

import (
	"fmt"
	"sort"
	"strings"
)

// Kayles-like: a row of n pins; a move removes 1 or 2 adjacent pins,
// splitting the row into two independent rows. We memoize single-row
// Grundy by length, then any position is XOR over its segment lengths.

var memo = map[int]int{}

func mexSet(m map[int]bool) int {
	for i := 0; ; i++ {
		if !m[i] {
			return i
		}
	}
}

func rowGrundy(n int) int {
	if n <= 0 {
		return 0
	}
	if v, ok := memo[n]; ok {
		return v
	}
	reach := map[int]bool{}
	// remove 1 pin at position i (0..n-1): splits into i and n-1-i
	for i := 0; i < n; i++ {
		reach[rowGrundy(i)^rowGrundy(n-1-i)] = true
	}
	// remove 2 adjacent pins at i,i+1: splits into i and n-2-i
	for i := 0; i+1 < n; i++ {
		reach[rowGrundy(i)^rowGrundy(n-2-i)] = true
	}
	g := mexSet(reach)
	memo[n] = g
	return g
}

func canonKey(segs []int) string {
	sort.Ints(segs)
	parts := make([]string, len(segs))
	for i, s := range segs {
		parts[i] = fmt.Sprint(s)
	}
	return strings.Join(parts, ",")
}

func positionGrundy(segs []int) int {
	_ = canonKey(segs) // canonical key would index a position-level cache if needed
	x := 0
	for _, s := range segs {
		x ^= rowGrundy(s)
	}
	return x
}

func main() {
	for n := 0; n <= 14; n++ {
		fmt.Printf("Kayles row %2d -> grundy %d\n", n, rowGrundy(n))
	}
	pos := []int{4, 7, 9}
	g := positionGrundy(pos)
	fmt.Printf("position %v grundy=%d -> %s\n", pos, g,
		map[bool]string{true: "first wins", false: "second wins"}[g != 0])
}
```

### 8.2 Java — subtraction game with proven periodicity for huge n

```java
import java.util.*;

public class HugeSubtraction {
    static int mex(boolean[] seen, int upTo) {
        for (int i = 0; i <= upTo; i++) if (!seen[i]) return i;
        return upTo + 1;
    }

    // Returns g[0..N] for subtraction set S.
    static int[] table(int N, int[] S) {
        int[] g = new int[N + 1];
        for (int x = 1; x <= N; x++) {
            boolean[] seen = new boolean[S.length + 1];
            for (int s : S) if (s <= x) {
                int v = g[x - s];
                if (v < seen.length) seen[v] = true;
            }
            g[x] = mex(seen, S.length);
        }
        return g;
    }

    // Find (n0, period) by one-window match (rigorous: see senior 5.3).
    static int[] findPeriod(int[] g, int maxS) {
        for (int period = 1; period + maxS < g.length; period++) {
            for (int n0 = 0; n0 + period + maxS <= g.length; n0++) {
                boolean ok = true;
                for (int i = 0; i < maxS; i++)
                    if (g[n0 + i] != g[n0 + period + i]) { ok = false; break; }
                if (ok) return new int[]{n0, period};
            }
        }
        return null;
    }

    static int grundyHuge(long n, int[] S) {
        int maxS = Arrays.stream(S).max().getAsInt();
        int N = Math.min((int) n, 50 * maxS + 200);
        int[] g = table(N, S);
        if (n <= N) return g[(int) n];
        int[] p = findPeriod(g, maxS);
        if (p == null) throw new IllegalStateException("no period within bound");
        int n0 = p[0], period = p[1];
        return g[(int) (n0 + (n - n0) % period)];
    }

    public static void main(String[] args) {
        int[] S = {1, 2, 3};
        System.out.println("g[10^18] for S={1,2,3} = " + grundyHuge(1_000_000_000_000_000_000L, S)); // 0
        int[] S2 = {2, 5, 7};
        System.out.println("g[10^18] for S={2,5,7} = " + grundyHuge(1_000_000_000_000_000_000L, S2));
    }
}
```

### 8.3 Python — brute-force outcome oracle + Grundy cross-check

```python
from functools import lru_cache


def make_oracle(successors):
    @lru_cache(maxsize=None)
    def win(state):
        # mover wins iff SOME successor is losing
        return any(not win(s) for s in successors(state))
    return win


def make_grundy(successors):
    @lru_cache(maxsize=None)
    def g(state):
        ch = successors(state)
        if not ch:
            return 0
        seen = set(g(s) for s in ch)
        i = 0
        while i in seen:
            i += 1
        return i
    return g


def succ_subtraction(S):
    return lambda n: tuple(n - s for s in S if s <= n)


if __name__ == "__main__":
    S = (1, 3, 4)
    succ = succ_subtraction(S)
    win = make_oracle(succ)
    g = make_grundy(succ)
    # Cross-check: grundy(n) == 0  <=>  position is losing  <=>  not win(n)
    for n in range(40):
        assert (g(n) == 0) == (not win(n)), f"mismatch at {n}"
    print("oracle and Grundy agree for n in [0,40)")
    print("g[0..15]:", [g(n) for n in range(16)])
```

---

## 9. Testing via Brute Force

A Grundy value is opaque — one wrong number looks like any other. Build checks from day one.

| Check | Why |
|-------|-----|
| `grundy(p) == 0` ⟺ brute-force win/loss says "loss" | Catches mex bugs, base-case bugs, decomposition bugs. |
| `grundy(sum) == XOR of grundy(components)` on random small sums | Validates the decomposition and that components are truly independent. |
| Terminal positions give `grundy == 0` | Confirms the base case. |
| Constructive winning move actually wins (play it out) | Validates the "find the move" logic, not just the verdict. |
| Periodicity: full window matches after `n₀` | Rigorous period proof (Section 5.3), not "looks periodic." |
| Misère verdict vs misère oracle | Catches accidental normal-play reuse. |

The single most valuable test is the **brute-force outcome oracle** (Section 8.3): a memoized win/loss recursion compared against `grundy == 0` for all small states. It catches the overwhelming majority of bugs — wrong mex, missing base case, `+` instead of XOR, coupled components mistaken for independent.

### 9.1 A property-test battery

```text
for random small game family, random small positions:
    assert (grundy(p) == 0) == is_losing_bruteforce(p)        # the oracle
    assert grundy(A ⊎ B) == grundy(A) ^ grundy(B)             # decomposition
    assert grundy(terminal) == 0                              # base case
    if grundy(P) != 0:
        m = winning_move(P)
        assert is_losing_bruteforce(apply(P, m))              # the move works
for subtraction game:
    assert one-window match at n0 implies full-tail periodicity (sampled far out)
```

These five invariants, run on a few hundred random instances, give high confidence. The decomposition invariant is especially good at catching a game whose components are secretly *coupled* (a move touches two regions) — there the XOR identity fails and the assert fires.

---

## 10. Failure Modes

### 10.1 Coupled components treated as independent

The deadliest bug: assuming a position decomposes when a single move can touch two regions. The XOR identity silently fails. Mitigation: verify `grundy(sum) == XOR` on random instances; if it ever fails, the components are coupled.

### 10.2 `+` instead of XOR

Summing Grundy values instead of XOR-ing yields a plausible number and a wrong winner. Mitigation: code review the combine step; property-test the decomposition.

### 10.3 Splitting move without the inner XOR

A move that splits a region into two pieces must contribute `g(a) ⊕ g(b)` to the mex set, not `g(a)` or `g(a)+g(b)`. Mitigation: model splits as sums explicitly; test against the oracle on small sizes where splits occur.

### 10.4 Unverified periodicity

A guessed period that matches the first 30 terms but not later corrupts huge-`n` answers. Mitigation: the one-window propagation proof (Section 5.3); verify the full window of length `max(S)`.

### 10.5 Wrong convention (misère/normal)

Applying normal-play XOR to a misère game gives the wrong endgame verdict. Mitigation: pin the convention; use the misère Nim rule or genus theory as appropriate.

### 10.6 Loopy game, non-terminating recursion

A cyclic move graph makes the memoized Grundy recursion loop or return garbage. Mitigation: assert a strictly decreasing measure along moves; detect cycles; switch to loopy-game theory if needed.

### 10.7 State explosion from non-canonical keys

Memoizing un-normalized states multiplies the cache by the symmetry group, blowing memory and time. Mitigation: canonicalize (sort piles, normalize orientation) before caching.

### 10.8 Tabulating to a huge `n`

Allocating a Grundy array of size `10^18` OOMs. Mitigation: tabulate only to the period bound, then modular lookup.

### 10.9 Confusing Grundy magnitude with strength

A reviewer (or your past self) sometimes reads a Grundy value of `5` as "more winning" than `1`, or sorts positions by Grundy value as if it were a heuristic. For a *single* game only `0` vs nonzero is meaningful; magnitude has significance solely inside an XOR over a sum, where it determines cancellation. Sorting or thresholding by magnitude is meaningless and produces subtly wrong heuristics. Mitigation: treat the Grundy value as an opaque XOR operand, never as an ordered score.

### 10.10 Reusing a verdict across a changed rule set

The "same board" admits many different games depending on the move set and convention; a Grundy table computed for `S = {1,2,3}` is silently wrong if the actual game allows `S = {1,2,4}`, and a normal-play verdict is wrong under misère. This bites when code reuses a cached table across problem variants. Mitigation: key the cache (and any closed form / detected period) by the *full* game specification — move set, split rules, and convention — not just by pile sizes.

---

## 11. Summary

- The senior skill is **recognition**: is the position a sum of independent components (→ XOR), a splitting game (→ mex over XORs), a disguised classic (→ known rule), or coupled/misère/loopy/partizan (→ different machinery)?
- **Large `n`** is handled by **periodicity** (subtraction/octal games) or a **closed form** (`g[n] = n mod (k+1)` for take-1..k), proven by the one-window propagation argument — never tabulate to `10^18`.
- **State encoding** is the cost lever: canonicalize symmetric states, memoize *segment* Grundy values for splitting games, and XOR over segments rather than re-memoizing whole boards.
- **Proving outcomes** means the two-part argument (every move from a P-position leaves it; some move from an N-position reaches it) plus an explicit **constructive winning move** via the highest-set-bit / target-Grundy construction.
- **Hazards**: misère breaks naive XOR (use Nim's misère rule or genus theory), loopy games have no DAG, partizan games have no Grundy number, scoring/chance are out of scope entirely.
- **Performance** lives in the `mex` inner loop (reused boolean scratch with a stamp), precompute-once reuse, canonicalization for memory, and across-component / across-query parallelism.
- Always keep a **brute-force outcome oracle**; it catches the mex bug, the missing base case, the `+`-instead-of-XOR bug, and the coupled-components-as-independent bug that together account for nearly every real failure.

### Decision summary

- **Sum of independent components** → Grundy each, XOR, compare to 0; produce the constructive move.
- **Splitting moves** → `mex` over `g(a) ⊕ g(b)`.
- **Huge `n`, subtraction/octal** → periodicity (proven by one-window match) or closed form.
- **Disguised classic** → match to staircase Nim / coin-turning / Wythoff and use its rule.
- **Misère** → Nim misère rule, else genus theory; do not reuse normal-play verdict.
- **Loopy / partizan / scored / chance** → stop; Sprague-Grundy does not apply.

References to study further: Berlekamp-Conway-Guy *Winning Ways* (octal games, coin-turning, Kayles periods), Conway *On Numbers and Games* (nimber arithmetic, partizan theory), Plambeck-Siegel misère quotients, Guy-Smith on periodicity of octal games, Wythoff's game and Beatty sequences, and sibling topic `14-nim` for the prototype XOR analysis.
