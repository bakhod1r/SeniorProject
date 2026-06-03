# Game DP — Optimal Play in Turn-Based Scoring Games (Junior Level)

> **One-line summary:** When two players alternate turns and each plays *optimally* to maximize their own score, you do not track two separate scores — you track a single number, the **score difference** (current player's total minus opponent's total). The recurrence `dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])` says "the value I can secure from the sub-game on `[i..j]` is the best of taking the left coin or the right coin, minus the best the opponent can then secure from the rest."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

Imagine a row of coins laid out on a table, each with a printed value: `[5, 3, 7, 10]`. You and a friend take turns. On your turn you may take **either the leftmost or the rightmost** coin, then your friend takes either end of what remains, and so on until all coins are gone. Each of you keeps the coins you take. You go first. Both of you are perfectly smart and greedy — each move is chosen to maximize your *own* final total. The question: **what is the most you can guarantee for yourself, no matter how cleverly your friend plays?**

This is the classic **"Predict the Winner"** problem (LeetCode 486), and it is the running example for this entire file. It looks like it should be a greedy problem — "just take the bigger end" — but greedy is *wrong*. Taking the bigger coin now can hand your opponent an even bigger one. Real optimal play requires looking ahead at how the opponent will respond, and how you will respond to that, all the way down. That kind of look-ahead, where the answer to a big sub-game is built from answers to smaller sub-games, is exactly what **dynamic programming** is for.

The beautiful trick that makes game DP clean is the **score-difference** formulation. Instead of carrying around two numbers (my score, your score), you carry a single number: **how far ahead the player-to-move can get**, measured as *(my eventual total) − (your eventual total)* if we both play optimally from here. Why is one number enough? Because the game is **zero-sum and symmetric**: whatever I gain, you lose relative to me, and on your turn *you* become "the player to move" and the exact same logic applies to you. So the value the opponent secures from the remaining coins is subtracted from the coin I just took. That single observation collapses two-dimensional bookkeeping into the elegant recurrence:

```
dp[i][j] = max( a[i] - dp[i+1][j],     // I take the left coin a[i]
                a[j] - dp[i][j-1] )     // I take the right coin a[j]
```

Here `dp[i][j]` is the best score difference the current player can achieve on the sub-array `a[i..j]`. Once you have `dp[0][n-1]` — the difference for the whole row — you immediately know the winner: player 1 wins (or ties) if and only if `dp[0][n-1] >= 0`.

This score-difference idea is the heart of a whole family of problems: Stone Game, Optimal Strategy for a Game, Stone Game II/III, divisor games, and many "can the current player force a win?" puzzles. It is also a special, *scored* case of the general **minimax** algorithm you will meet in topic `16` (game trees / minimax). And it is distinct from **Grundy / Sprague-Grundy theory** (topic `15`), which answers pure *win-or-lose* games with no scores. Game DP is what you reach for when the game has **numeric payoffs** and you want the optimal *value*, not just who wins.

---

## Prerequisites

Before reading this file you should be comfortable with:

- **Recursion** — a function calling itself on smaller inputs. Game DP is recursion over shrinking sub-arrays.
- **Arrays and indexing** — we constantly talk about the sub-array `a[i..j]` (inclusive both ends).
- **2D arrays / tables** — `dp[i][j]` is a triangular table indexed by a left and a right boundary.
- **Big-O notation** — we will say `O(n²)` time and space; you should know what that means.
- **Basic min/max reasoning** — the current player maximizes; the opponent (one level down) also maximizes their own value, which appears as a subtraction.

Optional but helpful:

- A glance at **memoization** (top-down DP with a cache) — we show both top-down and bottom-up.
- Familiarity with **prefix sums**, used to recover each player's actual score from the difference.
- The idea of a **zero-sum game** (one player's gain is the other's loss) — that is *why* one number suffices.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Turn-based game** | Players alternate moves; here exactly two players, strictly alternating. |
| **Optimal play** | Each player, on their turn, chooses the move that maximizes their own final outcome, assuming the opponent does the same. |
| **Score difference** | `(player-to-move's total) − (opponent's total)` under optimal play from the current state. The quantity `dp` stores. |
| **State** | The information that fully describes a sub-game. Here it is the pair `(i, j)`: the remaining coins are `a[i..j]`. |
| **`dp[i][j]`** | Best score difference the **current player** can force on the sub-array `a[i..j]`. |
| **Zero-sum game** | A game where the players' payoffs are exact opposites relative to each other; total is fixed. |
| **Interval / range DP** | DP whose state is a contiguous interval `[i..j]`; solved by increasing interval length. |
| **Minimax** | The general algorithm: maximizing player and minimizing player alternate; topic `16`. Game DP is its scored, memoized form. |
| **Grundy number** | A value from Sprague-Grundy theory for *impartial win/loss* games (topic `15`); **not** used for scoring games. |
| **Boolean win DP** | A variant where states store `true`/`false` ("can current player win?") instead of a numeric difference. |
| **Memoization** | Caching the result of `dp[i][j]` so each state is computed once. |

---

## Core Concepts

### 1. The State Is an Interval `(i, j)`

In the pick-from-ends coin game, after some moves the remaining coins are always a **contiguous block** `a[i..j]`, because every move removes an end. So the entire situation is captured by two numbers: the left index `i` and the right index `j`. That is the **state**. There are about `n²/2` such states (all pairs with `i <= j`), which is why the algorithm is `O(n²)`.

Crucially, the state does **not** need to remember whose turn it is, nor the running scores. Whoever is to move is always "the current player," and `dp[i][j]` is always measured *from that player's point of view*. This symmetry is what lets us avoid a third dimension.

### 2. Why a Single Number (the Difference) Is Enough

Suppose on `a[i..j]` the current player takes the left coin `a[i]`. They immediately bank `a[i]`. Now it is the opponent's turn on `a[i+1..j]`. By definition, `dp[i+1][j]` is the best difference *that opponent* can force — i.e., (opponent's total) − (my total) on the rest. From *my* perspective, the rest of the game contributes the negative of that: `-dp[i+1][j]`. So my total difference if I take the left is:

```
a[i] - dp[i+1][j]
```

Symmetrically, taking the right coin `a[j]` gives `a[j] - dp[i][j-1]`. I pick whichever is larger. That is the whole recurrence. The subtraction is the key move: **the opponent's best advantage on the remaining coins counts against me.**

### 3. The Recurrence and Base Case

```
dp[i][j] = max( a[i] - dp[i+1][j],     // take left
                a[j] - dp[i][j-1] )     // take right

base: dp[i][i] = a[i]      // one coin left: current player takes it, difference = a[i]
```

When the interval has a single coin, the player to move simply takes it; the opponent gets nothing, so the difference is `a[i]`.

### 4. Reading the Answer

`dp[0][n-1]` is the score difference player 1 can force over the whole row. Then:

- **Player 1 wins or ties** ⇔ `dp[0][n-1] >= 0`.
- If you also know the total sum `S = Σ a[k]`, then player 1's actual score is `(S + dp[0][n-1]) / 2` and player 2's is `(S - dp[0][n-1]) / 2`. (Because score1 + score2 = S and score1 − score2 = dp.)

### 5. Filling Order (Bottom-Up)

`dp[i][j]` depends on `dp[i+1][j]` (smaller by one on the left) and `dp[i][j-1]` (smaller by one on the right) — both shorter intervals. So we fill by **increasing interval length**: first all length-1 intervals (the base case), then length-2, then length-3, up to the full length `n`. This is the signature of **interval DP**.

### 6. It Generalizes the Minimax Idea

If you have seen minimax for games like tic-tac-toe (topic `16`), this is the same skeleton: a maximizing player and a minimizing player alternate. The `-dp[...]` is precisely the "minimizing" layer rewritten as a maximizing layer from the opponent's own viewpoint (this is the "negamax" reformulation). Game DP is minimax plus memoization plus a numeric payoff.

### 7. It Is NOT Greedy

It bears repeating because it is the most common first mistake: you cannot solve this by "always take the bigger end." Consider `[1, 5, 233, 7]`. Greedy takes the right end `7` (since `7 > 1`), but that leaves `[1, 5, 233]`, and the opponent immediately grabs `233`. The DP discovers that taking the *smaller* left end `1` first is better, because it forces the opponent into a position where you can claim the `233` next. The lesson: in a two-player game, every move must account for the opponent's response — and that is exactly the look-ahead the DP performs.

---

## Big-O Summary

| Quantity | Value | Notes |
|----------|-------|-------|
| Number of states `(i, j)` | **O(n²)** | All pairs `0 <= i <= j < n`. |
| Work per state | O(1) | Just a `max` of two subtractions. |
| Total time (interval DP) | **O(n²)** | States × work-per-state. |
| Space (full table) | O(n²) | The triangular `dp` table. |
| Space (rolling, if only the value is needed) | O(n) | Keep one diagonal at a time. |
| Naive recursion (no memo) | **O(2ⁿ)** | Each call branches into two; exponential without caching. |
| Reconstructing the actual moves | O(n) extra | Walk the table once from `(0, n-1)`. |

The headline is **`O(n²)` time and space** with memoization — a dramatic improvement over the `O(2ⁿ)` blind recursion, achieved purely by caching the `n²` interval results.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Pick-from-ends coin game | Two siblings splitting a row of chocolates, each only allowed to grab from the two ends of the box, both being a little greedy. |
| Score difference `dp[i][j]` | A scoreboard that shows only the *gap* between you and your rival, not the two raw scores — all you really care about for "who's ahead." |
| The `- dp[...]` subtraction | "Whatever advantage I hand my opponent by leaving them these coins comes straight off my lead." |
| Optimal vs greedy | Greedy is grabbing the bigger end every time; optimal is a chess player thinking "if I take this, what does that let *them* take?" |
| Interval state `(i, j)` | A shrinking window: the game is always "what's left between marker `i` and marker `j`." |
| Filling by interval length | Solving all 1-coin games, then all 2-coin games, …, building up to the full board — small problems first. |

Where the analogy breaks: real chocolate-splitting siblings are rarely perfectly rational, and real games may let you take from the middle or take multiple pieces (Stone Game II/III) — those need richer states, covered in `middle.md`.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Collapses two-player optimal play into a single, clean `O(n²)` DP. | Only directly applies to **two-player, zero-sum, perfect-information** games. |
| The score-difference trick removes a whole dimension (no per-player scores). | The "difference" answer needs a small extra step (with the total sum) to recover raw scores. |
| Same skeleton solves many variants (Stone Game, coins-in-a-row, etc.). | The pick-from-ends structure is special; arbitrary-move games need bigger states. |
| Easy to memoize; turns exponential recursion into polynomial. | `O(n²)` space can be large for very long arrays (use rolling rows if only the value is needed). |
| Directly connects to minimax (topic `16`) and contrasts cleanly with Grundy (topic `15`). | Confusing it with greedy, or with Grundy win/loss theory, is a common conceptual trap. |

**When to use:** two players alternate, each maximizes their own numeric score, the game is zero-sum with perfect information, and the state is small (an interval, a prefix, or a small integer). Classic signals: "both play optimally," "predict the winner," "maximum score you can guarantee."

**When NOT to use:** games with hidden information or chance; non-zero-sum games; pure win/loss impartial games (use Grundy, topic `15`); or when greedy is provably correct (rare in adversarial games — verify, don't assume).

---

## Step-by-Step Walkthrough

Let us solve the coin row `a = [5, 3, 7, 10]` by hand. We fill the `dp` table by increasing interval length. Indices run `0..3`.

**Length 1 (base case): `dp[i][i] = a[i]`.**

```
dp[0][0] = 5
dp[1][1] = 3
dp[2][2] = 7
dp[3][3] = 10
```

**Length 2: `dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])`.**

```
dp[0][1] = max(a[0] - dp[1][1], a[1] - dp[0][0]) = max(5 - 3, 3 - 5) = max(2, -2) = 2
dp[1][2] = max(a[1] - dp[2][2], a[2] - dp[1][1]) = max(3 - 7, 7 - 3) = max(-4, 4) = 4
dp[2][3] = max(a[2] - dp[3][3], a[3] - dp[2][2]) = max(7 - 10, 10 - 7) = max(-3, 3) = 3
```

Read `dp[0][1] = 2`: on `[5, 3]`, the player to move takes 5, leaving 3 for the opponent; difference `5 - 3 = 2`. Correct.

**Length 3.**

```
dp[0][2] = max(a[0] - dp[1][2], a[2] - dp[0][1])
         = max(5 - 4, 7 - 2) = max(1, 5) = 5     // best to take the right coin (7)
dp[1][3] = max(a[1] - dp[2][3], a[3] - dp[1][2])
         = max(3 - 3, 10 - 4) = max(0, 6) = 6     // best to take the right coin (10)
```

**Length 4 (the full game).**

```
dp[0][3] = max(a[0] - dp[1][3], a[3] - dp[0][2])
         = max(5 - 6, 10 - 5) = max(-1, 5) = 5     // take the right coin (10)
```

So `dp[0][3] = 5 > 0`: **player 1 wins**, with a final lead of 5 points. Let us verify by recovering the actual scores. Total `S = 5 + 3 + 7 + 10 = 25`. Player 1's score `= (25 + 5) / 2 = 15`; player 2's `= (25 - 5) / 2 = 10`. Indeed `15 + 10 = 25` and `15 - 10 = 5`.

Let us trace the optimal line of play to confirm 15 vs 10:

```
Row [5,3,7,10]. P1 takes right (10).  P1=10.  Row [5,3,7].
Row [5,3,7].    P2 to move, dp[0][2]=5, best is take right (7). P2=7. Row [5,3].
Row [5,3].      P1 to move, dp[0][1]=2, take left (5). P1=15. Row [3].
Row [3].        P2 takes 3. P2=10.
Final: P1=15, P2=10, lead 5.  ✓
```

Every multiplication of effort paid off: the greedy first move would have been to take 10 anyway here, but on other inputs greedy diverges from optimal. The DP is what guarantees correctness.

---

## Code Examples

### Example: Predict the Winner (score difference, both bottom-up and top-down)

#### Go

```go
package main

import "fmt"

// predictWinnerDiff returns the optimal score difference dp[0][n-1].
// Player 1 wins or ties iff the result is >= 0.
func predictWinnerDiff(a []int) int {
	n := len(a)
	if n == 0 {
		return 0
	}
	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
		dp[i][i] = a[i] // base case: one coin
	}
	// fill by increasing interval length
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			takeLeft := a[i] - dp[i+1][j]
			takeRight := a[j] - dp[i][j-1]
			dp[i][j] = max(takeLeft, takeRight)
		}
	}
	return dp[0][n-1]
}

func max(x, y int) int {
	if x > y {
		return x
	}
	return y
}

func main() {
	a := []int{5, 3, 7, 10}
	diff := predictWinnerDiff(a)
	fmt.Println("score difference:", diff)        // 5
	fmt.Println("player 1 wins or ties:", diff >= 0) // true
}
```

#### Java

```java
public class PredictTheWinner {

    // Returns dp[0][n-1], the optimal score difference for player 1.
    static int predictWinnerDiff(int[] a) {
        int n = a.length;
        if (n == 0) return 0;
        int[][] dp = new int[n][n];
        for (int i = 0; i < n; i++) dp[i][i] = a[i]; // base case
        for (int length = 2; length <= n; length++) {
            for (int i = 0; i + length - 1 < n; i++) {
                int j = i + length - 1;
                int takeLeft = a[i] - dp[i + 1][j];
                int takeRight = a[j] - dp[i][j - 1];
                dp[i][j] = Math.max(takeLeft, takeRight);
            }
        }
        return dp[0][n - 1];
    }

    public static void main(String[] args) {
        int[] a = {5, 3, 7, 10};
        int diff = predictWinnerDiff(a);
        System.out.println("score difference: " + diff);          // 5
        System.out.println("player 1 wins or ties: " + (diff >= 0)); // true
    }
}
```

#### Python

```python
from functools import lru_cache


def predict_winner_diff(a):
    """Bottom-up: return dp[0][n-1], the optimal score difference."""
    n = len(a)
    if n == 0:
        return 0
    dp = [[0] * n for _ in range(n)]
    for i in range(n):
        dp[i][i] = a[i]                       # base case
    for length in range(2, n + 1):
        for i in range(0, n - length + 1):
            j = i + length - 1
            take_left = a[i] - dp[i + 1][j]
            take_right = a[j] - dp[i][j - 1]
            dp[i][j] = max(take_left, take_right)
    return dp[0][n - 1]


def predict_winner_diff_topdown(a):
    """Top-down memoized version of the same recurrence."""
    @lru_cache(maxsize=None)
    def best(i, j):
        if i == j:
            return a[i]
        return max(a[i] - best(i + 1, j), a[j] - best(i, j - 1))

    return best(0, len(a) - 1) if a else 0


if __name__ == "__main__":
    coins = [5, 3, 7, 10]
    diff = predict_winner_diff(coins)
    print("score difference:", diff)            # 5
    print("player 1 wins or ties:", diff >= 0)  # True
    assert predict_winner_diff_topdown(coins) == diff
```

**What it does:** builds the `dp` interval table for `[5, 3, 7, 10]`, returns the score difference `5`, and concludes player 1 wins. The Python file also shows the top-down memoized form computing the same answer.
**Run:** `go run main.go` | `javac PredictTheWinner.java && java PredictTheWinner` | `python predict.py`

---

## Coding Patterns

### Pattern 1: Brute-Force Recursion (the oracle you test against)

**Intent:** Before trusting the DP, compute the difference the slow, obvious way and check small cases agree.

```python
def best_diff_bruteforce(a, i, j):
    if i > j:
        return 0
    if i == j:
        return a[i]
    take_left = a[i] - best_diff_bruteforce(a, i + 1, j)
    take_right = a[j] - best_diff_bruteforce(a, i, j - 1)
    return max(take_left, take_right)
```

This is `O(2ⁿ)` because it re-explores overlapping intervals. It is perfect as a correctness oracle for `n <= ~20`. The memoized DP must match it.

### Pattern 2: Boolean "Can Current Player Win?"

**Intent:** Sometimes you only need a yes/no, not the margin. Then `dp[i][j]` can store `true` if the current player can force a win. But the cleanest implementation still computes the difference and checks `>= 0` at the end — fewer special cases.

### Pattern 3: Reconstructing the Moves

**Intent:** Report *which* coin to take, not just the value. After filling `dp`, walk from `(0, n-1)`: at each step, if `a[i] - dp[i+1][j] >= a[j] - dp[i][j-1]`, the optimal move is "take left," else "take right." Append and shrink the interval.

```mermaid
graph TD
    S["State (i, j): coins a[i..j]"] -->|take left a[i]| L["a[i] - dp[i+1][j]"]
    S -->|take right a[j]| R["a[j] - dp[i][j-1]"]
    L --> M["dp[i][j] = max(left, right)"]
    R --> M
    M -->|read dp[0][n-1]| W{">= 0 ? player 1 wins"}
```

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Wrong winner reported | Forgot the subtraction; added the opponent's value instead of subtracting it. | The recurrence subtracts: `a[i] - dp[i+1][j]`. |
| `IndexError` / out of bounds | Accessed `dp[i+1][j]` when `i == j`, or filled in the wrong order. | Handle the `i == j` base case first; fill by increasing length. |
| Off-by-one on interval length | Loop bound `i+length-1 < n` written incorrectly. | Use `for i := 0; i+length-1 < n; i++` (inclusive `j`). |
| Recovered scores are fractional | Used the difference but the sum's parity didn't match. | `(S + dp)/2` is always an integer for integer inputs; check you used the *correct* total `S`. |
| Exponential blowup / timeout | Plain recursion without memoization. | Memoize on `(i, j)` (top-down) or fill a table (bottom-up). |
| Stack overflow (deep recursion) | Top-down recursion on a very long array. | Use the iterative bottom-up version for large `n`. |

---

## Performance Tips

- **Always memoize.** Naive recursion is `O(2ⁿ)`; caching `(i, j)` makes it `O(n²)`. This is the single biggest win.
- **Fill bottom-up for large `n`** to avoid recursion depth limits and function-call overhead.
- **Use a rolling array** if you only need the final value: `dp[i][j]` needs only shorter intervals, so you can process diagonals and keep `O(n)` space.
- **Prefer the difference formulation** over carrying `(myScore, oppScore)` — it halves the state and the arithmetic.
- **Use `int64`/`long` if values are large.** Differences stay bounded by the sum of values; pick a wide enough integer type to avoid overflow for big coin values.

---

## Best Practices

- Always test the DP against the brute-force recursion (Pattern 1) on random small arrays before trusting it on large ones.
- State clearly in a comment that `dp[i][j]` is the **score difference for the player to move** on `a[i..j]` — this single sentence prevents most bugs.
- Decide up front whether you need the *value*, the *winner boolean*, or the *actual moves*, and write the minimal code for that.
- Keep the base case `dp[i][i] = a[i]` explicit and separate from the main loop.
- When the problem says "both play optimally," reach for game DP, not greedy — and prove greedy wrong with a tiny counterexample if tempted.
- Recover raw scores with `(S ± dp)/2` only when the problem actually asks for them; otherwise the difference is enough.

---

## Edge Cases & Pitfalls

- **Empty array (`n = 0`)** — no coins, difference is `0` (a tie). Guard against it.
- **Single coin (`n = 1`)** — player 1 takes it; difference `a[0]`, player 1 wins unless `a[0] == 0`.
- **All equal coins** — with an even count the game is a tie (`dp = 0`); with an odd count the first player wins by exactly one coin's value.
- **Negative coin values** — the recurrence still works (some games allow penalties); do not assume values are positive.
- **Ties (`dp[0][n-1] == 0`)** — "predict the winner" usually counts a tie as a win for player 1 (`>= 0`); read the problem's exact tie rule.
- **Greedy temptation** — taking the larger end is *not* always optimal; the DP is necessary. Verify with `[1, 5, 233, 7]` style inputs where greedy fails.
- **Confusing with Grundy** — this is a *scoring* game, not a win/loss impartial game; Grundy numbers (topic `15`) do not apply here.

---

## Common Mistakes

1. **Adding instead of subtracting the sub-result** — writing `a[i] + dp[i+1][j]`. The opponent's optimal difference works *against* you, so it must be subtracted.
2. **Treating it as greedy** — "always take the bigger end" gives wrong answers; adversarial look-ahead is required.
3. **Forgetting to memoize** — the recursion is exponential without a cache; the fix is one dictionary or 2D array.
4. **Wrong fill order** — filling `dp` by row/column index instead of by increasing interval length, so dependencies aren't ready yet.
5. **Misreading the answer** — `dp[0][n-1]` is a *difference*, not player 1's score; you must add the total and halve to get raw scores.
6. **Tracking turn parity in the state** — unnecessary; the difference formulation already encodes "whoever is to move," so `(i, j)` alone suffices.
7. **Applying Grundy theory** — using XOR of Grundy numbers on a scoring game; that machinery is for win/loss games only (topic `15`).
8. **Storing per-player scores when the difference suffices** — doubling the state and the arithmetic for a zero-sum game; one number (the difference) is enough.

---

## Cheat Sheet

| Question | Tool | Formula |
|----------|------|---------|
| Best difference on `a[i..j]` | interval DP | `dp[i][j] = max(a[i]-dp[i+1][j], a[j]-dp[i][j-1])` |
| Base case | one coin | `dp[i][i] = a[i]` |
| Does player 1 win/tie? | check sign | `dp[0][n-1] >= 0` |
| Player 1's actual score | from difference | `(S + dp[0][n-1]) / 2` |
| Player 2's actual score | from difference | `(S - dp[0][n-1]) / 2` |
| Which coin to take at `(i,j)` | compare branches | left if `a[i]-dp[i+1][j] >= a[j]-dp[i][j-1]` |
| Time / space | interval DP | `O(n²)` / `O(n²)` (or `O(n)` rolling) |

Core algorithm:

```
predictWinnerDiff(a):
    n = len(a)
    dp[i][i] = a[i]                       # base case
    for length in 2..n:
        for i in 0..n-length:
            j = i + length - 1
            dp[i][j] = max(a[i] - dp[i+1][j],
                           a[j] - dp[i][j-1])
    return dp[0][n-1]                      # >= 0  iff player 1 wins/ties
# cost: O(n^2) time, O(n^2) space
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization.
>
> The animation demonstrates:
> - Filling the `dp[i][j]` interval table by increasing interval length
> - At each cell, the `max(take-left, take-right)` choice with the chosen branch highlighted
> - Reading `dp[0][n-1]` and converting the difference into the winner and the raw scores
> - Step / Run / Reset controls to watch each diagonal of the table fill in

---

## Summary

Game DP turns "two players alternate, both play optimally for their own score" into a clean dynamic program by tracking a single number — the **score difference** the player-to-move can force. For the pick-from-ends coin game the state is the interval `(i, j)`, and the recurrence `dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])` says "take the left or the right coin, and subtract whatever the opponent can then force from the rest." The base case is `dp[i][i] = a[i]`, you fill by increasing interval length in `O(n²)`, and `dp[0][n-1] >= 0` tells you player 1 wins. The two ideas never to forget: **subtract** the opponent's sub-result (it counts against you), and this is a *scoring* game (minimax-style, topic `16`), not a *win/loss* impartial game (Grundy, topic `15`). Master the difference recurrence and a whole family of "predict the winner" problems falls out of one tiny table.

---

## Further Reading

- LeetCode 486 "Predict the Winner" and 877 "Stone Game" — the canonical pick-from-ends problems.
- *Introduction to Algorithms* (CLRS) — interval/matrix-chain DP as the template for range states.
- Sibling topic `16-minimax` — the general game-tree algorithm this specializes.
- Sibling topic `15-grundy-numbers` — Sprague-Grundy theory for *win/loss* impartial games (the contrast).
- cp-algorithms.com — "Games on arbitrary graphs" and "Dynamic programming on games".
- *Algorithmic Game Theory* (Nisan et al.) — for the broader theory of optimal play in games.
- GeeksforGeeks — "Optimal Strategy for a Game" (the coins-in-a-row variant) and "Game Theory in DP".
- LeetCode 1140 "Stone Game II" and 1406 "Stone Game III" — richer move sets for the same template.
- LeetCode 1025 "Divisor Game" — a boolean win/loss game DP (the contrast to scoring).
- Sibling topic on interval DP (matrix-chain, optimal BST) within `13-dynamic-programming` — the cooperative cousins of this adversarial recurrence.
- Competitive Programmer's Handbook (Laaksonen), "Game theory" chapter — a gentle bridge from this scoring DP to Grundy theory.
