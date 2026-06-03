# Game DP — Optimal Play in Turn-Based Scoring Games (Senior Level)

> Game DP is rarely the bottleneck on a short array — but the moment the state grows a third dimension, the payoffs stop being zero-sum, inputs reach the limits of `O(n²)` memory, or the recurrence is subtly mis-signed, every modeling decision (difference vs explicit two-score state, top-down memo vs bottom-up table, sentinel choice, testing strategy) becomes a correctness or performance incident.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Choosing the State: Difference vs Explicit (myScore, oppScore)](#2-choosing-the-state-difference-vs-explicit-myscore-oppscore)
3. [Memoization Architecture and Big Inputs](#3-memoization-architecture-and-big-inputs)
4. [The Move-Set Modeling Checklist](#4-the-move-set-modeling-checklist)
5. [Numerical and Type Hazards](#5-numerical-and-type-hazards)
6. [Testing Against a Brute-Force Game Solver](#6-testing-against-a-brute-force-game-solver)
7. [Performance Engineering](#7-performance-engineering)
8. [Code Examples](#8-code-examples)
9. [Observability and Validation](#9-observability-and-validation)
10. [Failure Modes](#10-failure-modes)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what is the recurrence" but "what game am I actually modeling, and what breaks when I scale it or change the payoff structure?" Game DP shows up in production and competitive settings in several guises that share one engine — `D(S) = max_m [ g(m) - D(S') ]` — but differ in the four decisions that determine whether your solution is correct and fast:

1. **State representation** — the score-difference scalar, an explicit `(myScore, oppScore)` pair, or a boolean win/lose. The wrong choice either loses correctness (non-zero-sum) or doubles the work (zero-sum with an explicit pair).
2. **Memoization architecture** — top-down with a hash/array cache vs bottom-up table; recursion depth, cache key design, and memory layout.
3. **Move-set complexity** — two end-moves (cheap), 1..K front-moves (linear state), or up to `2M` front-moves with an evolving cap (cubic). The move set drives the complexity, not the recurrence shape.
4. **Verification** — proving the DP matches an independent brute-force game solver, since a sign error in the recurrence produces plausible-but-wrong winners that pass casual inspection.

This document treats those four decisions in production terms, then enumerates the failure modes that actually bite.

---

## 2. Choosing the State: Difference vs Explicit (myScore, oppScore)

### 2.1 When the difference scalar suffices

For a **zero-sum** game (the only thing at stake is who ends with more, and the total is conserved), the single number `D(S) =` *(player-to-move total) − (opponent total)* is provably sufficient (proof in `professional.md`). It is the right default because:

- It removes a whole dimension: you store one number per state, not two.
- The arithmetic is a single `max` of subtractions — fewer chances to mis-sign.
- You recover both raw scores at any state via `score_to_move = (remainingSum + D) / 2`.

This is the formulation for Predict the Winner, Stone Game I/III, and coins-in-a-row.

### 2.2 When you need the explicit pair

Switch to an explicit `(myScore, oppScore)` (or "maximize my own collected value") state when:

- **The payoff is not zero-sum.** If each player optimizes a quantity that is *not* the negation of the other's (e.g., both want to maximize their own score but moves also create or destroy shared value), the difference is not conserved and a single scalar loses information. You then store, per state, the pair of optimal payoffs (each player maximizing their own), and the recurrence picks the move maximizing the *mover's* component.
- **The problem reports raw per-player scores at intermediate states** and you cannot cheaply reconstruct the remaining sum (e.g., moves that mutate values).
- **There are more than two players**, or asymmetric objectives. Then the value is a vector indexed by player, and each chooses the move maximizing their own coordinate (a Nash-style best response under perfect information).

### 2.3 Decision rule

```
Is the game two-player, zero-sum, perfect-information, alternating?
   YES → score-difference scalar D(S).            (default; smallest state)
   NO, but win/loss only → boolean canWin(S).
   NO, non-zero-sum or >2 players → vector of per-player optimal payoffs.
```

A frequent senior mistake is reaching for the explicit pair "to be safe" on a zero-sum game, doubling memory and inviting sign bugs. Equally bad is forcing the difference scalar onto a non-zero-sum game, which is silently wrong. Diagnose the payoff structure *first*.

### 2.4 A concrete non-zero-sum trap

Consider pick-from-ends where taking the *last* coin grants a fixed bonus to whoever takes it. The total payoff now depends on play (the bonus is collected only by the last mover), so the difference is not conserved. Two states with the *same* difference but different totals then have different optimal continuations — a scalar cannot distinguish them. The fix is a per-state pair `(moverBest, otherBest)` (or a per-player vector with a turn flag), where the mover picks the move maximizing their *own* coordinate and the bonus is added on the array-emptying move. The lesson: a single sentence in the problem ("bonus for the last move", "destroying value", "shared pot that grows") can break zero-sum and invalidate the scalar — read for it before coding.

### 2.5 Migration cost between formulations

If you start with the difference scalar and later discover the game is non-zero-sum, the migration is non-trivial: the recurrence changes from `max_m [g − D(S')]` to `argmax over the mover's own coordinate of a vector`, the cache value type changes, and every test must be re-derived. Because the migration touches every line, the senior practice is to spend the first two minutes classifying the payoff structure rather than committing to the scalar and refactoring later. When in genuine doubt (e.g., an ambiguous spec), prototype the vector form — it degrades gracefully to the scalar for zero-sum inputs (the two coordinates always sum to the conserved total), so it is the safe superset, at the cost of a constant factor in memory.

---

## 3. Memoization Architecture and Big Inputs

### 3.1 Top-down vs bottom-up

| Dimension | Top-down (recursion + cache) | Bottom-up (table) |
|-----------|------------------------------|-------------------|
| Code clarity for irregular moves | Excellent (Stone Game II) | Awkward (manual order) |
| Recursion depth | Risk of stack overflow at large `n` | None |
| Computes only reachable states | Yes (lazy) | No (fills all) |
| Cache-friendliness / constant factor | Worse (hashing, call overhead) | Better (array, sequential) |
| Easy to add a rolling-array space cut | Hard | Easy |

**Rule of thumb:** prototype top-down (the recurrence maps directly to a memoized function); switch to bottom-up for large `n` to avoid deep recursion and to enable the rolling-array space reduction. For interval DP specifically, the bottom-up fill order is "increasing interval length," which is mechanical once written.

### 3.2 Cache key design

For interval games the key is `(i, j)` → flatten to `i * n + j` for an array cache. For Stone Game II the key is `(i, M)`; bound `M` by `n` (taking more than `n` piles is meaningless) so the cache is `O(n²)`, not unbounded. **Always clamp unbounded-looking parameters** (like `M = max(M, x)`) to their natural ceiling, or the cache and complexity explode.

### 3.3 Memory at scale

A full `n × n` `int64` interval table is `8n²` bytes — 80 KB for `n = 100`, 8 MB for `n = 1000`, 800 MB for `n = 10000`. If only the *value* is needed (not move reconstruction), use a **rolling diagonal**: `dp[i][j]` depends only on length-`(L-1)` intervals, so two 1-D arrays suffice for `O(n)` space. Keep the full table only when you must reconstruct the optimal play.

### 3.4 Very large arrays

If `n` is in the hundreds of thousands, `O(n²)` is infeasible regardless of constant factors — you need either a 1-D-state variant (Stone Game III is `O(n)`) or problem-specific structure (e.g., the Stone Game I parity shortcut: with an even pile count and odd total, player 1 always wins, no DP needed). Recognizing when a closed-form or `O(n)` reformulation exists is the senior lever; do not reflexively build the `O(n²)` table.

### 3.5 Language-specific memoization gotchas

- **Python:** `functools.lru_cache` on a recursive `best(i, j)` is the fastest path to a correct prototype, but it hits the default recursion limit (~1000) for `n` beyond a few hundred. Raise `sys.setrecursionlimit` for prototyping, then port to an iterative table for submission. Tuple keys are fine; avoid mutable arguments in the key.
- **Java:** a 2-D `long[][]` plus a separate `boolean[][] computed` (or a sentinel like `Long.MIN_VALUE` meaning "uncomputed") avoids boxing. Prefer the iterative bottom-up loop; deep recursion risks `StackOverflowError` and the JIT optimizes the tight loop well.
- **Go:** no recursion-limit constant, but deep recursion still grows the goroutine stack; the idiomatic choice is a bottom-up `[][]int64`. Closures capturing the cache work for top-down but allocate; the iterative form is allocation-light.

Across all three, the iterative bottom-up table is the production default precisely because it sidesteps the recursion-depth and allocation issues that the elegant top-down memo introduces at scale.

---

## 4. The Move-Set Modeling Checklist

When adapting game DP to a new two-player scoring game, run this checklist:

1. **Identify the minimal state.** What information about the remaining game fully determines optimal future play? Interval `(i, j)`? Front index `i`? Front index plus a cap `(i, M)`? A small integer `N`? If the state needs an unbounded history or a visited-set, DP may be intractable.
2. **Enumerate the legal moves and their immediate gains.** For each move `m`: what does the mover collect (`g(m)`), and what state `S'` results (opponent to move)?
3. **Write the recurrence as `D(S) = max_m [ g(m) - D(S') ]`.** This single line, with the *subtraction*, encodes optimal adversarial play. Triple-check the sign.
4. **Nail the base/terminal case.** Empty interval → difference `0`; single coin → `a[i]`; "no moves" → depends on win/loss rule (last-move-wins vs cannot-move-loses).
5. **Choose the value type.** Difference scalar (zero-sum), boolean (win/loss), or vector (non-zero-sum) — per Section 2.
6. **Bound and clamp the state parameters** so the cache is polynomial (Section 3.2).
7. **Verify against a brute-force solver** for small inputs (Section 6).

The discipline of writing the recurrence as `g(m) - D(S')` often *reveals* whether the difference scalar is valid: if you cannot express the mover's outcome as "my gain minus the opponent's optimal response," the game is probably not zero-sum, and you need the vector formulation.

### 4.1 Modeling case studies

Three short studies showing the checklist in action:

- **"Take any number of stones from one of two ends, but the total taken from the left must never exceed the total from the right."** The constraint couples the two ends, so the state must track the running left/right gap — `(i, j, gap)`. If `gap` is unbounded the DP fails; if the problem bounds it, the third dimension is the cost of the constraint. The lesson: a coupling constraint adds a state dimension.
- **"Each turn, remove the smaller of the two ends; you score it; if they tie, you choose."** The move set is *forced* (no choice except on ties), so the "game" is nearly deterministic; the DP degenerates to an `O(n)` scan with branching only at ties. Recognizing a forced move set avoids over-engineering.
- **"Two players, each maximizes their own score, and a coin's value doubles if taken on an even turn."** The gain now depends on the turn index, so the state needs turn parity `(i, j, parity)` — the difference shortcut's "turn-free" advantage is lost because the payoff is turn-dependent. This is a case where the third dimension is genuinely necessary.

In each, step 1 of the checklist (identify the minimal state) is where the real modeling happens; the recurrence is mechanical once the state is right.

### 4.2 Smell tests for "this is a game DP"

Phrases in a problem statement that signal game DP: "both players play optimally," "predict the winner," "maximize the score you can guarantee," "Alice and Bob alternate." Phrases that signal a *different* tool: "last player to move wins" with independent piles (→ Grundy, topic `15`); "find the best move in this position" for a large board (→ minimax + pruning, topic `16`); "no player may revisit" (→ exponential visited-set state, often intractable). Training the ear for these phrases is faster than re-deriving the classification each time.

---

## 5. Numerical and Type Hazards

### 5.1 Overflow and sentinels

Score differences are bounded by the sum of absolute values; for large coin/stone values use 64-bit integers. When initializing a "no valid move" sentinel for a `max`, use `-(1<<60)` (Go/Java `Long.MIN_VALUE/4`, Python `float("-inf")`) so that subsequent subtractions cannot wrap or underflow. A common bug: `Long.MIN_VALUE` as the sentinel, then `take - Long.MIN_VALUE` overflows.

### 5.2 Parity of the difference

For integer inputs, `totalSum` and `D` always have the same parity (since `score1 + score2 = S` and `score1 - score2 = D` imply `S` and `D` differ by `2·score2`), so `(S + D)/2` is always an exact integer. If you ever get a fractional raw score, you used the wrong total or mis-signed `D`.

### 5.3 Negative values

Several games (Stone Game III with negative stones) allow negative gains. The recurrence is unchanged, but greedy intuitions and "first player always wins" shortcuts break. Never assume non-negative values unless the constraints guarantee it.

### 5.4 Ties

Define the tie rule explicitly. "Predict the Winner" treats `D >= 0` as a player-1 win; other problems return a distinct "Tie" for `D == 0`. Encode it as stated; do not assume `>=` vs `>`.

### 5.5 The "stops vs edges vs coins" off-by-one

Business or problem phrasings frequently use ambiguous counting words. "Take 3 piles" might mean 3 piles or "up to 3"; "the game lasts 5 rounds" might mean 5 of *your* moves (10 total) or 5 total. Because the DP is correct for *some* interpretation, these off-by-ones survive every algebraic test and only surface against human-specified expected outputs. The senior habit: pin down the exact counting before coding, encode it in a named constant or comment, and feed the *human-specified* inputs (not a re-derived index) to the brute-force oracle so the off-by-one cannot hide behind a self-consistent but wrong derivation.

### 5.6 Floating point and fractional payoffs

If gains are non-integer (probabilities, real-valued rewards), the parity guarantee of §5.2 no longer applies and raw-score reconstruction stays exact only in exact arithmetic. For real-valued zero-sum games, the difference DP still works numerically, but comparisons like `D == 0` for ties become `abs(D) < eps`. Prefer integer or rational arithmetic when the problem allows; reserve floating point for genuinely real-valued payoffs and document the tolerance.

---

## 6. Testing Against a Brute-Force Game Solver

A game-DP result is opaque — a wrong winner looks like a right one. Build verification in from the start.

### 6.1 The brute-force oracle

Implement the unmemoized recurrence (or a full game-tree search) as an independent oracle:

```python
def brute_diff(a, i, j):
    if i > j:
        return 0
    if i == j:
        return a[i]
    return max(a[i] - brute_diff(a, i + 1, j),
               a[j] - brute_diff(a, i, j - 1))
```

For Stone Game II/III write the analogous exhaustive search. Run the DP and the oracle on a few thousand random small inputs (`n <= 12`) and assert entrywise equality. This catches the dominant bug classes: sign errors, base-case errors, and off-by-one in the fill order.

### 6.2 Self-play simulation

A second, independent check: implement an *actual game simulator* where each player, on their turn, queries the DP for the best move, plays it, and you tally raw scores. The simulated final difference must equal `dp[0][n-1]`. This validates both the value and the move-reconstruction logic together — a self-play loop that disagrees with the DP value reveals a reconstruction bug.

### 6.3 Property tests

- **Symmetry:** reversing the array does not change `dp[0][n-1]` (the game is left-right symmetric for end-picking). Useful invariant.
- **Single coin:** `dp[i][i] == a[i]`.
- **All-equal even count:** difference is `0` (tie); odd count: difference is one coin's value.
- **Sum reconstruction:** `(S + D)` is even and `(S + D)/2 + (S - D)/2 == S`.

---

## 7. Performance Engineering

### 7.1 The state count dominates

Time is `(#states) × (moves per state)`. The levers:

- **Minimize the state.** Drop any dimension you don't need (turn parity is never needed for zero-sum; the difference encodes it).
- **`O(1)` transitions via prefix/suffix sums.** "Sum of the rest" must not be an inner loop.
- **Clamp parameters** (`M <= n`) to keep the cache polynomial.

### 7.2 Bottom-up cache behavior

The interval-DP fill order (`for length: for i:`) accesses `dp[i+1][j]` and `dp[i][j-1]` — both in already-computed shorter diagonals. A flat 1-D array indexed `i*n + j` with this order is cache-friendlier than a hash map and avoids per-call overhead. For the `O(n)` Stone Game III, a plain backward loop over one array is optimal.

### 7.3 Rolling-array space reduction

When only the value is needed, the interval DP collapses to `O(n)` space by keeping the previous diagonal. This matters for `n` in the thousands where `O(n²)` memory (and its allocation/GC churn) is the constraint, not time.

### 7.4 Avoiding recomputation across queries

If many queries share one array but differ in sub-range, the full `dp` table answers any `(i, j)` sub-game in `O(1)` after a single `O(n²)` build — do not rebuild per query. (Contrast: changing the *array* invalidates the table.) For batched evaluation this is the difference between `O(Q·n²)` and `O(n² + Q)`.

### 7.5 Constant-factor wins that matter

- **Flat array indexing.** Store `dp` as a single `int64` slice of length `n*n` indexed `i*n + j`, not a slice-of-slices. This removes a pointer dereference per access and improves locality; on hot `O(n²)` fills it is a measurable speedup.
- **Hoist `a[i]` out of the inner loop.** In `dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])`, `a[i]` is loop-invariant for fixed `i`; cache it in a local.
- **Avoid recomputing the total each query.** Keep a prefix-sum array so `Σ((i,j))` is an `O(1)` lookup when reconstructing raw scores for arbitrary sub-games.
- **Prefer iterative `max`** over a function call in the innermost loop in Go/Java where the call may not inline; a branch is reliably cheap.

None of these change the asymptotics, but on the largest feasible `n` (a few thousand) they compound into a 2–4× wall-clock difference, which is the gap between "fits the time limit" and "TLE" in a competitive setting.

---

## 8. Code Examples

### 8.1 Go — Predict the Winner with rolling-array O(n) space

```go
package main

import "fmt"

// O(n) space using a single rolling diagonal.
func predictDiffRolling(a []int) int {
	n := len(a)
	if n == 0 {
		return 0
	}
	dp := make([]int, n)
	copy(dp, a) // dp[i] currently = dp[i][i] (length-1 intervals)
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			// dp[i] holds dp[i][j-1] (length-1, same i);
			// dp[i+1] holds dp[i+1][j] (length-1, i+1) from this pass.
			left := a[i] - dp[i+1]
			right := a[j] - dp[i]
			dp[i] = max(left, right)
		}
	}
	return dp[0]
}

func max(x, y int) int {
	if x > y {
		return x
	}
	return y
}

func main() {
	fmt.Println(predictDiffRolling([]int{5, 3, 7, 10})) // 5
	fmt.Println(predictDiffRolling([]int{1, 5, 233, 7})) // 222
}
```

### 8.2 Java — explicit (myScore, oppScore) for a non-zero-sum-style readout

```java
public class ExplicitScores {
    // Returns {player1Score, player2Score} under optimal zero-sum play,
    // computed via the difference then split by the total sum.
    static long[] optimalScores(int[] a) {
        int n = a.length;
        long[][] dp = new long[n][n];
        long sum = 0;
        for (int i = 0; i < n; i++) { dp[i][i] = a[i]; sum += a[i]; }
        for (int len = 2; len <= n; len++)
            for (int i = 0; i + len - 1 < n; i++) {
                int j = i + len - 1;
                dp[i][j] = Math.max(a[i] - dp[i + 1][j], a[j] - dp[i][j - 1]);
            }
        long diff = dp[0][n - 1];
        long p1 = (sum + diff) / 2;
        long p2 = (sum - diff) / 2;
        return new long[]{p1, p2};
    }

    public static void main(String[] args) {
        long[] s = optimalScores(new int[]{5, 3, 7, 10});
        System.out.println("P1=" + s[0] + " P2=" + s[1]); // P1=15 P2=10
    }
}
```

### 8.3 Go — self-play simulator that must reproduce the DP value

```go
package main

import "fmt"

// Build the dp table, then simulate optimal self-play and assert the
// resulting score difference equals dp[0][n-1].
func selfPlayCheck(a []int) (int, int, int) {
	n := len(a)
	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
		dp[i][i] = a[i]
	}
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			dp[i][j] = max(a[i]-dp[i+1][j], a[j]-dp[i][j-1])
		}
	}
	// simulate
	i, j := 0, n-1
	scores := [2]int{}
	turn := 0
	for i <= j {
		if i == j || a[i]-dp[i+1][j] >= a[j]-dp[i][j-1] {
			scores[turn] += a[i]
			i++
		} else {
			scores[turn] += a[j]
			j--
		}
		turn ^= 1
	}
	diff := scores[0] - scores[1]
	if diff != dp[0][n-1] {
		panic(fmt.Sprintf("self-play %d != dp %d", diff, dp[0][n-1]))
	}
	return dp[0][n-1], scores[0], scores[1]
}

func max(x, y int) int {
	if x > y {
		return x
	}
	return y
}

func main() {
	d, p1, p2 := selfPlayCheck([]int{5, 3, 7, 10})
	fmt.Printf("diff=%d P1=%d P2=%d\n", d, p1, p2) // diff=5 P1=15 P2=10
}
```

The `panic` is the guardrail: if the reconstructed play and the DP value ever disagree, the program fails loudly rather than returning a wrong winner silently. This is the single most effective production check for game DP.

### 8.4 Python — DP validated against a brute-force oracle (the senior habit)

```python
import random
from functools import lru_cache


def predict_diff_dp(a):
    n = len(a)
    if n == 0:
        return 0
    dp = [[0] * n for _ in range(n)]
    for i in range(n):
        dp[i][i] = a[i]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = max(a[i] - dp[i + 1][j], a[j] - dp[i][j - 1])
    return dp[0][n - 1]


def predict_diff_brute(a):
    @lru_cache(None)  # cache only to keep the oracle usable up to ~20
    def best(i, j):
        if i > j:
            return 0
        if i == j:
            return a[i]
        return max(a[i] - best(i + 1, j), a[j] - best(i, j - 1))
    return best(0, len(a) - 1) if a else 0


def fuzz(trials=2000):
    for _ in range(trials):
        n = random.randint(0, 12)
        a = tuple(random.randint(-50, 50) for _ in range(n))
        assert predict_diff_dp(list(a)) == predict_diff_brute(a), a
    print("all", trials, "random cases agree")


if __name__ == "__main__":
    fuzz()
```

---

### 8.5 A debugging walkthrough: the sign bug in the wild

Suppose a teammate's Predict-the-Winner submission returns `true` for `[1, 5, 2]` (the correct answer is `false`). The senior diagnostic procedure:

1. **Run the oracle.** `brute_diff([1,5,2])` returns `-2` (player 1 loses). The DP returns `+2`. Mismatch confirmed; the bug is in the DP, not the test.
2. **Bisect the table.** Print `dp` and compare against a hand fill. Hand: `dp[0][0]=1, dp[1][1]=5, dp[2][2]=2`; `dp[0][1]=max(1-5,5-1)=4`; `dp[1][2]=max(5-2,2-5)=3`; `dp[0][2]=max(1-dp[1][2], 2-dp[0][1])=max(1-3, 2-4)=max(-2,-2)=-2`. If the buggy table shows `dp[0][2]=+2`, the length-3 row diverges.
3. **Inspect the recurrence.** The buggy line reads `dp[i][j] = max(a[i] + dp[i+1][j], a[j] + dp[i][j-1])` — a `+` instead of `-`. The opponent's advantage was *credited* to the mover.
4. **Fix and re-fuzz.** Change `+` to `-`, re-run 2000 random oracle comparisons; all pass.

This is the canonical game-DP bug. It is invisible on symmetric inputs (where both branches happen to agree) and on inputs where the wrong sign coincidentally yields the right winner, which is exactly why the random oracle — not a couple of hand-picked examples — is required to catch it reliably.

## 9. Observability and Validation

| Check | Why |
|-------|-----|
| Brute-force oracle on small `n` | Catches sign errors, base-case bugs, fill-order bugs. |
| Self-play simulator vs `dp[0][n-1]` | Validates value and move reconstruction together. |
| Reverse-array symmetry | `dp` of reversed input equals original (end-picking is symmetric). |
| Sum/parity invariant | `(S + D)` even; `(S±D)/2` reconstructs raw scores exactly. |
| Tie handling unit test | `dp == 0` mapped to the problem's exact tie rule. |
| Negative-value test | Recurrence must hold without assuming non-negative gains. |
| State-clamp assertion | `M <= n` so the cache stays polynomial. |

The single most valuable test is the **brute-force oracle**: an independent unmemoized solver that reproduces the answer the slow way for small inputs. It catches the overwhelming majority of game-DP bugs, all of which stem from a mis-signed or mis-based recurrence.

### 9.1 A property-test battery

In a real codebase, encode these as randomized property tests on every CI run:

```text
for random small array a (n in [0, 12], values in [-50, 50]):
    assert dp_diff(a) == brute_diff(a)              # the oracle
    assert dp_diff(a) == dp_diff(reversed(a))       # left-right symmetry
    assert (sum(a) + dp_diff(a)) % 2 == 0           # parity invariant
    assert self_play(a).diff == dp_diff(a)          # reconstruction consistency
for single-coin and empty arrays:
    assert dp_diff([x]) == x and dp_diff([]) == 0   # base cases
```

These five invariants on a few hundred random instances give high confidence. The symmetry test is especially good at catching an asymmetric indexing bug in the take-left/take-right branches.

### 9.2 Production guardrails

For a service answering optimal-play queries, add: an **input validator** (non-empty, numeric, within declared bounds); a **parity assertion** on every reconstructed raw score (a fractional score is a definitive bug signal); and a **self-play cross-check** sampled on a fraction of requests so a regression in reconstruction surfaces in monitoring rather than in a user-visible wrong winner. Log the difference and the chosen first move alongside each answer so an anomalous result is explainable after the fact.

---

## 10. Failure Modes

### 10.1 Sign error in the recurrence
Writing `g(m) + D(S')` instead of `g(m) - D(S')`. The reported winner is plausible but wrong on adversarial inputs. Mitigation: the oracle (Section 6) and a comment stating "subtract the opponent's optimal difference."

### 10.2 Difference scalar on a non-zero-sum game
Using `D(S)` when payoffs are not negations of each other silently loses information. Mitigation: diagnose the payoff structure first; use the per-player vector formulation if not zero-sum (Section 2).

### 10.3 Unclamped state parameter
Letting `M` in Stone Game II grow unbounded blows up the cache and complexity. Mitigation: clamp `M = min(max(M, x), n)`.

### 10.4 Wrong base/terminal case
`dp[n] != 0` for prefix games, or mishandling "no legal move" (last-move-wins vs cannot-move-loses). Mitigation: write the terminal explicitly and test the smallest instances.

### 10.5 Overflow / bad sentinel
`Long.MIN_VALUE` as a `max` sentinel underflows on the first subtraction. Mitigation: use `MIN/4` (or `-inf`), 64-bit types.

### 10.6 Greedy substitution
"Optimize" the DP away with a greedy "take the bigger end." Wrong for almost all adversarial games. Mitigation: keep a counterexample (`[1,5,233,7]`) in the test suite.

### 10.7 Recursion depth on large `n`
Top-down memo on a long array overflows the stack. Mitigation: switch to bottom-up; the interval fill order is mechanical.

### 10.8 Misclassifying the game type
Applying Grundy XOR (topic `15`) to a scoring game, or building a giant minimax tree (topic `16`) when a clean `O(n²)` interval DP exists. Mitigation: classify first (scored → game DP; win/loss sum-of-games → Grundy; large irregular tree → minimax + pruning), then choose the tool.

---

## 11. Summary

- The engine is always `D(S) = max_m [ g(m) - D(S') ]`. The **subtraction** encodes optimal adversarial play; a sign error is the single most common bug and is invisible without a brute-force oracle.
- **State choice is the first senior decision:** difference scalar for zero-sum (default, smallest), boolean for win/loss, per-player vector for non-zero-sum or multi-player. Forcing the scalar onto a non-zero-sum game is silently wrong; using a vector on a zero-sum game wastes memory and risks sign bugs.
- **Memoization architecture:** prototype top-down (clean for irregular move sets like Stone Game II), switch to bottom-up for large `n` (no stack risk, enables `O(n)` rolling-array space when only the value is needed).
- **The move set drives complexity:** two end-moves → `O(n²)`; 1..3 front-moves → `O(n)`; 1..2M front-moves with a clamped cap → `O(n³)`. Clamp every unbounded-looking parameter to keep the cache polynomial.
- **Numerical care:** 64-bit values, `MIN/4` sentinels, explicit tie rules, and the parity guarantee that `(S±D)/2` is exact.
- **Verification is non-negotiable:** a brute-force game solver on small random inputs plus a self-play simulator catch nearly every defect, because every game-DP bug reduces to a mis-signed, mis-based, or mis-ordered recurrence.
- **Language matters at scale:** prefer iterative bottom-up tables in all three languages to avoid recursion-depth (Python/Java) and allocation (Go) pitfalls; flat-array indexing and hoisting loop-invariants buy a 2–4× constant-factor win on the largest feasible `n`.
- **Read the spec for zero-sum-breakers and counting ambiguities:** a "bonus for the last move" silently invalidates the difference scalar; an ambiguous "rounds"/"stops" count silently introduces an off-by-one that passes every algebraic test. Both are caught only by feeding human-specified inputs to the oracle.

### Decision summary

- **Two-player, zero-sum, perfect-info, interval state** → difference interval DP, `O(n²)` (rolling to `O(n)` if value-only).
- **Prefix/front-move scored game** → 1-D difference DP (Stone Game III, `O(n)`).
- **Front-move with evolving cap** → `(i, M)` state with suffix sums, clamp `M <= n`.
- **Win/loss single game** → boolean `canWin` DP.
- **Win/loss sum of independent games** → Grundy / Sprague-Grundy (topic `15`).
- **Huge or irregular game tree** → minimax with alpha-beta pruning (topic `16`).
- **Non-zero-sum or >2 players** → per-player payoff vector; each maximizes their own coordinate.

### Production readiness checklist

Before shipping a game-DP solution, confirm:

- [ ] Payoff structure classified (zero-sum scalar vs vector vs boolean) before coding.
- [ ] Recurrence uses `g(m) − D(S')` (subtraction), commented as "subtract the opponent's optimal difference."
- [ ] Base/terminal case written explicitly and unit-tested on the smallest instances.
- [ ] State parameters clamped to polynomial bounds (e.g., `M <= n`).
- [ ] 64-bit values and `MIN/4` sentinels; no `Long.MIN_VALUE` in a `max`.
- [ ] Iterative bottom-up for large `n`; rolling-array space cut if value-only.
- [ ] Brute-force oracle and self-play simulator both pass on random small inputs.
- [ ] Tie rule and "stops vs edges vs coins" counting pinned to the spec.
- [ ] Table built once per array, reused across sub-game queries.

References to study further: minimax / negamax and alpha-beta (topic `16`), Sprague-Grundy theory (topic `15`), interval DP (matrix-chain, optimal BST), the LeetCode game series (486, 877, 1140 Stone Game II, 1406 Stone Game III, 1025 Divisor Game), and *Algorithmic Game Theory* for the optimal-play foundations.
