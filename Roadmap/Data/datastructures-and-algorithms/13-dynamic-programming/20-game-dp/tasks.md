# Game DP — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the game-DP logic and validate against the evaluation criteria.
> **Always test against a brute-force (unmemoized) game solver on small inputs before trusting the DP result.**
> The universal template is `D(S) = max over legal moves m of [ g(m) - D(S') ]`, with `D(terminal) = 0`. The minus sign encodes the adversary.

---

## Beginner Tasks (5)

### Task 1 — Score difference on a pick-from-ends game

**Problem.** Implement `predictDiff(a)` returning `dp[0][n-1]`, the optimal score difference (player-to-move total minus opponent total) for the pick-from-ends coin game. Use the recurrence `dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])` with base `dp[i][i] = a[i]`.

**Input / Output spec.**
- Read `n`, then `a` (`n` integers).
- Print the single integer `dp[0][n-1]`.

**Constraints.** `1 <= n <= 1000`, `-10^7 <= a[i] <= 10^7`.

**Hint.** Fill by increasing interval length. Use 64-bit accumulation if values are large.

**Starter — Go.**
```go
package main

import "fmt"

func predictDiff(a []int) int {
	// TODO: interval DP, fill by increasing length
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	fmt.Println(predictDiff(a))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static long predictDiff(int[] a) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        System.out.println(predictDiff(a));
    }
}
```

**Starter — Python.**
```python
import sys


def predict_diff(a):
    # TODO
    return 0


def main():
    data = iter(sys.stdin.read().split())
    n = int(next(data))
    a = [int(next(data)) for _ in range(n)]
    print(predict_diff(a))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct difference, verified by hand on `[5, 3, 7, 10]` (expect `5`).
- Base case `dp[i][i] = a[i]` handled.
- Fill order is by increasing interval length.

---

### Task 2 — Who wins, and the raw scores

**Problem.** Given coin values `a`, output three things: the winner (`1`, `2`, or `0` for tie), player 1's score, and player 2's score, under optimal pick-from-ends play.

**Input / Output spec.**
- Read `n`, then `a`.
- Print `winner score1 score2` on one line.

**Constraints.** `1 <= n <= 1000`, values in `[0, 10^7]`.

**Hint.** Compute the difference `D = dp[0][n-1]` and the total `S`. Then `score1 = (S + D)/2`, `score2 = (S - D)/2`. Winner is `1` if `D > 0`, `2` if `D < 0`, `0` if `D == 0`.

**Worked check.** For `[5, 3, 7, 10]`: `D = 5`, `S = 25`, so `score1 = 15`, `score2 = 10`, winner `1`.

**Evaluation criteria.**
- `(S + D)` is even, so scores are exact integers.
- Tie reported as winner `0` when `D == 0`.
- Matches a brute-force recursion for small `n`.

---

### Task 3 — Stone Game III (take 1, 2, or 3 from the front)

**Problem.** Given stones `a` (values may be negative), Alice and Bob alternate taking the first 1, 2, or 3 stones. Both maximize their own total. Output `"Alice"`, `"Bob"`, or `"Tie"`.

**Input / Output spec.**
- Read `n`, then `a`.
- Print the result string.

**Constraints.** `1 <= n <= 5·10^4`, `-1000 <= a[i] <= 1000`.

**Hint.** 1-D difference DP from the back: `dp[i] = max over x in {1,2,3} of (sum(a[i..i+x-1]) - dp[i+x])`, `dp[n] = 0`. Compare `dp[0]` to `0`.

**Reference oracle (Python) — validate against this.**
```python
def brute_sg3(a, i):
    if i >= len(a):
        return 0
    take, best = 0, float("-inf")
    for x in range(1, 4):
        if i + x <= len(a):
            take += a[i + x - 1]
            best = max(best, take - brute_sg3(a, i + x))
    return best
# winner: brute_sg3(a, 0) > 0 -> Alice, < 0 -> Bob, == 0 -> Tie
```

**Evaluation criteria.**
- `[1,2,3,7] -> Bob`, `[1,2,3,-9] -> Alice`, `[1,2,3,6] -> Tie`.
- `O(n)` (constant moves per state).
- Handles negative values.

---

### Task 4 — Boolean "can the first player win" (single game)

**Problem.** Given coin values `a`, return `true` iff player 1 can win or tie the pick-from-ends game. Implement it as a boolean check on the difference DP (`dp[0][n-1] >= 0`).

**Input / Output spec.**
- Read `n`, then `a`.
- Print `true` or `false`.

**Constraints.** `1 <= n <= 1000`, values in `[0, 10^7]`.

**Hint.** Reuse Task 1's difference DP and check the sign. (You could store booleans directly, but the difference DP is cleaner and reusable.)

**Evaluation criteria.**
- `[1,5,2] -> false`, `[1,5,233,7] -> true`.
- A tie (`D == 0`) counts as a win for player 1 (`>= 0`).
- Matches brute force for small `n`.

---

### Task 5 — Reconstruct the optimal first move

**Problem.** Given coin values `a`, output which end player 1 should take on the first move: `"left"` or `"right"` (break ties toward `"left"`).

**Input / Output spec.**
- Read `n`, then `a`.
- Print `left` or `right`.

**Constraints.** `1 <= n <= 1000`.

**Hint.** Fill `dp`, then at `(0, n-1)` compare `a[0] - dp[1][n-1]` (take left) with `a[n-1] - dp[0][n-2]` (take right). Take left iff `left >= right`. Handle `n == 1` (only "left").

**Evaluation criteria.**
- For `[1,5,233,7]`, the optimal first move is `left` (forces the opponent to expose 233).
- Correct tie-break toward `left`.
- The reconstructed move's value equals `dp[0][n-1]`.

---

## Intermediate Tasks (5)

### Task 6 — Coins-in-a-row, maximum value collected

**Problem.** Given coin values `a`, return the maximum total value player 1 can collect under optimal pick-from-ends play. Use the difference DP plus the total sum.

**Constraints.** `1 <= n <= 2000`, values in `[0, 10^7]`.

**Hint.** `collected = (totalSum + dp[0][n-1]) / 2`. Verify against a direct value DP `val[i][j] = max(a[i] + min(val[i+2][j], val[i+1][j-1]), a[j] + min(val[i+1][j-1], val[i][j-2]))` for small `n`.

**Reference oracle (Python).**
```python
from functools import lru_cache

def brute_collect(a):
    @lru_cache(None)
    def diff(i, j):
        if i > j:
            return 0
        if i == j:
            return a[i]
        return max(a[i] - diff(i + 1, j), a[j] - diff(i, j - 1))
    return (sum(a) + diff(0, len(a) - 1)) // 2
```

**Evaluation criteria.**
- `[8,15,3,7] -> 22`, `[5,3,7,10] -> 15`.
- Matches the direct value DP for small `n`.
- `O(n²)`.

---

### Task 7 — Stone Game II (take 1..2M front piles)

**Problem.** Given piles `p`, Alice and Bob alternate; on a turn the player takes the first `x` piles with `1 <= x <= 2M` (gaining their sum), after which `M` becomes `max(M, x)`. `M` starts at 1. Return the maximum stones Alice (first player) can collect.

**Constraints.** `1 <= n <= 100`, `1 <= p[i] <= 10^4`.

**Hint.** Suffix sums + memo on `(i, M)`. `best(i, M) = suffix[i]` if `i + 2M >= n`, else `max over x in 1..2M of (suffix[i] - best(i+x, max(M, x)))`. Clamp `M <= n`. Answer `best(0, 1)`.

**Reference oracle (Python).**
```python
from functools import lru_cache

def brute_sg2(piles):
    n = len(piles)
    suf = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        suf[i] = suf[i + 1] + piles[i]
    @lru_cache(None)
    def best(i, m):
        if i + 2 * m >= n:
            return suf[i]
        return max(suf[i] - best(i + x, max(m, x)) for x in range(1, 2 * m + 1))
    return best(0, 1)
# brute_sg2([2,7,9,4,4]) == 10 ; brute_sg2([1,2,3,4,5,100]) == 104
```

**Evaluation criteria.**
- `[2,7,9,4,4] -> 10`, `[1,2,3,4,5,100] -> 104`.
- `M` clamped so the cache is `O(n²)`.
- Suffix sums make each transition `O(1)`.

---

### Task 8 — Divisor Game (boolean win DP)

**Problem.** Starting with integer `N`, a player picks `x` with `0 < x < N` and `N % x == 0`, replaces `N` with `N - x`; a player who cannot move (when `N == 1`) loses. Alice moves first. Return `true` iff Alice wins. Implement the boolean DP (do **not** hardcode the `N even` closed form, though you may assert it).

**Constraints.** `1 <= N <= 10^6`.

**Hint.** `win[1] = false`; `win[k] = any over divisors x of k (x < k) of (not win[k - x])`. Building all `win[1..N]` with divisor enumeration is `O(N log N)`.

**Reference oracle (Python).**
```python
def brute_divisor(N):
    from functools import lru_cache
    @lru_cache(None)
    def win(n):
        return any(not win(n - x) for x in range(1, n) if n % x == 0)
    return win(N)
# brute_divisor(2) == True ; brute_divisor(3) == False
```

**Evaluation criteria.**
- `N = 2 -> true`, `N = 3 -> false`.
- Result equals `(N % 2 == 0)` for all tested `N` (the closed form).
- Boolean recurrence `win[k] = OR over moves of NOT win[k - x]` used.

---

### Task 9 — Optimal play move sequence (full reconstruction)

**Problem.** Given coin values `a`, output the full sequence of moves under optimal pick-from-ends play, as a list of `L`/`R` characters (player 1 and player 2 alternate, both optimal), and the final scores.

**Input / Output spec.**
- Read `n`, then `a`.
- Print the move string (e.g., `RLLR`) then `score1 score2`.

**Constraints.** `1 <= n <= 2000`.

**Hint.** Fill `dp`, then replay from `(0, n-1)`: take left if `a[i] - dp[i+1][j] >= a[j] - dp[i][j-1]`, else right; alternate which player banks the coin; shrink the interval.

**Evaluation criteria.**
- The simulated final difference equals `dp[0][n-1]` (self-play consistency).
- `score1 + score2 == totalSum`.
- Move string length equals `n`.

---

### Task 10 — Brute-force oracle and fuzz harness

**Problem.** Implement both the `O(2ⁿ)` unmemoized recursion and the `O(n²)` DP for Predict the Winner, then a fuzz harness that generates random arrays (`n` up to 12, values in `[-50, 50]`) and asserts the two agree on the difference.

**Constraints.** Run at least 2000 random trials per language; the harness must pass.

**Hint.** The oracle is the unmemoized recurrence; the DP is Task 1's. Seed the RNG for reproducibility across languages.

**Evaluation criteria.**
- 2000+ random cases agree between oracle and DP.
- Includes negative values and `n == 0`/`n == 1` edge cases.
- Same seed yields the same cases across Go, Java, and Python.

---

## Advanced Tasks (5)

### Task 11 — Rolling-array O(n) space Predict the Winner

**Problem.** Solve Predict the Winner returning only the difference, using `O(n)` space via a rolling diagonal (no full `n × n` table).

**Constraints.** `1 <= n <= 2·10^5` (so the full table would be too large), values in `[-10^9, 10^9]`.

**Hint.** Initialize `dp[i] = a[i]` (length-1 intervals). For increasing length, update in place: for `i` ascending, `dp[i] = max(a[i] - dp[i+1], a[j] - dp[i])` where `j = i + length - 1`; `dp[i+1]` is the length-(L-1) value at `i+1` and `dp[i]` (before overwrite) is the length-(L-1) value at `i`. Use 64-bit.

**Evaluation criteria.**
- Uses `O(n)` space (one array), not `O(n²)`.
- Matches the full-table DP for small `n`.
- Handles large values without overflow (64-bit).

---

### Task 12 — Non-zero-sum two-player game (per-player vector)

**Problem.** Two players alternate taking an end of `a`. Each player's **score** is the sum of coins they take, but additionally taking the *last* coin of the array grants a fixed bonus `B` to whoever takes it (this breaks zero-sum: the total payoff now depends on who ends the game). Each player maximizes their own final score. Return `(score1, score2)` under optimal play.

**Constraints.** `1 <= n <= 500`, values in `[0, 10^4]`, `0 <= B <= 10^4`.

**Hint.** The difference scalar is **not** sufficient (the total varies with the bonus). Store, per state `(i, j, turn)` or per state with a vector value, the pair `(mover_best, other_best)`. The mover picks the move maximizing their own coordinate; add `B` on the move that empties the array. Document why the scalar fails here.

**Evaluation criteria.**
- Correctly accounts for the end-bonus changing the total.
- Uses a per-player payoff vector (or explicit two-score state), not the difference scalar.
- A comment explains the zero-sum failure (Senior §2.2, Professional §5).

---

### Task 13 — Stone Game with K choices and a closed-form check

**Problem.** Generalize Stone Game III: players take the first 1..K stones (`K` given). Return the winner. For `K >= n`, the first player takes everything; verify your DP against that and against the `K = 3` reference for small inputs.

**Constraints.** `1 <= n <= 10^5`, `1 <= K <= n`, values in `[-1000, 1000]`.

**Hint.** `dp[i] = max over x in 1..min(K, n-i) of (prefixSumFrom(i, x) - dp[i+x])`, `dp[n] = 0`. Use a running `take` to keep each transition `O(1)` within the `x` loop, giving `O(nK)`.

**Evaluation criteria.**
- `K = 3` reproduces Stone Game III answers exactly.
- `K >= n`: first player wins iff `sum(a) >= 0`... (actually `dp[0] = sum(a)`, mover wins iff `sum > 0`).
- `O(nK)` time.

---

### Task 14 — Many sub-game queries on one array

**Problem.** Given a fixed array `a` and `Q` queries, each `(i, j)`, answer the optimal score difference for the sub-game on `a[i..j]` for every query. Precompute once.

**Constraints.** `1 <= n <= 2000`, `1 <= Q <= 10^6`, `0 <= i <= j < n`.

**Hint.** Build the full `dp[i][j]` table once in `O(n²)`; each query is then an `O(1)` lookup `dp[i][j]`. Do not rebuild per query.

**Evaluation criteria.**
- Single `O(n²)` precompute, then `O(1)` per query.
- Total time `O(n² + Q)`, not `O(Q·n²)`.
- Each answer matches an independent per-query DP for spot checks.

---

### Task 15 — Decide whether game DP is the right tool

**Problem.** You are given a problem statement and must classify it. Implement `classify(problem)` (or write a short analysis) returning one of: `GAME_DP` (scored, small state), `GRUNDY` (impartial win/loss, sum of independent games — topic `15`), `MINIMAX` (large/irregular tree — topic `16`), `GREEDY_OK` (a structured game where greedy/closed-form is proven), or `INTRACTABLE` (state requires a visited-set or is exponential). Justify each.

**Constraints / cases to handle.**
- Pick-from-ends, both optimal, maximize score → `GAME_DP`.
- Nim / sum of independent piles, last move wins → `GRUNDY`.
- Chess-like tree, no small state → `MINIMAX`.
- Stone Game I (even piles, odd total) → `GREEDY_OK` (parity closed form).
- Optimal-play game whose state needs the set of visited cells → `INTRACTABLE`.

**Hint.** Encode the decision rules from `middle.md`, `senior.md`, and `professional.md`. The trap is conflating scored games (game DP) with impartial win/loss games (Grundy).

**Evaluation criteria.**
- Correctly classifies all five canonical cases.
- The `GRUNDY` vs `GAME_DP` distinction is explained (scored vs win/loss, XOR decomposition).
- Justification cites the right complexity (`O(n²)`, `O(n)`, etc.).

---

## Benchmark Task

### Task B — Brute force vs DP crossover

**Problem.** Empirically find the `n` at which the `O(n²)` DP overtakes the `O(2ⁿ)` unmemoized recursion for Predict the Winner. Implement both, measure wall-clock time on random arrays (fixed seed) for `n ∈ {5, 10, 15, 18, 20, 22}`, and report a table.

**Starter — Python.**
```python
import random
import time
from functools import lru_cache
from typing import List

def gen(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randint(0, 1000) for _ in range(n)]

def brute(a):
    def best(i, j):
        if i > j:
            return 0
        if i == j:
            return a[i]
        return max(a[i] - best(i + 1, j), a[j] - best(i, j - 1))
    return best(0, len(a) - 1) if a else 0

def dp(a):
    n = len(a)
    if n == 0:
        return 0
    t = [[0] * n for _ in range(n)]
    for i in range(n):
        t[i][i] = a[i]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            t[i][j] = max(a[i] - t[i + 1][j], a[j] - t[i][j - 1])
    return t[0][n - 1]

def mean_ms(samples):
    return sum(samples) / len(samples) * 1000.0

def main():
    print("n     brute_ms       dp_ms")
    for n in [5, 10, 15, 18, 20, 22]:
        a = gen(n, 42)
        # brute only for small n
        if n <= 22:
            rb = [(_t(lambda: brute(a))) for _ in range(3)]
        rd = [(_t(lambda: dp(a))) for _ in range(3)]
        bd = mean_ms(rb) if n <= 22 else float("nan")
        print(f"{n:<5d} {bd:<14.3f} {mean_ms(rd):<10.5f}")

def _t(fn):
    s = time.perf_counter()
    fn()
    return time.perf_counter() - s

if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same array across Go, Java, and Python.
- Brute force blows up around `n ≈ 20–25`; the DP stays in microseconds.
- Report the mean across at least 3 runs and exclude generation time.
- Writeup: note the measured crossover and that the DP's advantage is `2ⁿ / n²`.

---

### Task C — Top-down vs bottom-up correctness equivalence

**Problem.** Implement Predict the Winner *both* ways — top-down memoized recursion and bottom-up table — in all three languages, and a test asserting they return identical differences on the same random inputs (`n` up to 200). Then deliberately exceed the recursion limit (`n = 5000`) and show the top-down version fails (Python `RecursionError`, Java `StackOverflowError`) while the bottom-up version succeeds.

**Constraints.** Top-down test up to `n = 200`; bottom-up stress up to `n = 5000`.

**Hint.** Top-down: a `best(i, j)` with an `(i, j)`-keyed cache. Bottom-up: the increasing-length table. They must agree wherever both run.

**Evaluation criteria.**
- Both implementations agree for all `n <= 200` random cases.
- The bottom-up version handles `n = 5000`; the top-down version's failure is demonstrated and explained.
- A short note on why production code prefers bottom-up at scale.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every scored task ships with (or references) the unmemoized recursion. Run it on small `n`, diff against the DP, and only then trust the DP on large `n`.
- **Memorize the one template:** `D(S) = max over moves m of [g(m) - D(S')]`, `D(terminal) = 0`. The minus sign is the adversary.
- **Prefer the difference scalar** for zero-sum games; use a per-player vector only when the total is not conserved (Task 12).
- **Pick the smallest state.** Stone Game III needs only the front index; do not carry turn parity (the difference encodes it).
- **Get the base case right.** Empty interval → `0`; one coin → `a[i]`; "no move" → loss under normal play (boolean games).
- **Mind overflow and sentinels.** Use 64-bit; initialize `max`-sentinels to `MIN/4` (or `-inf`), never `Long.MIN_VALUE` (it underflows on the first subtraction).
- **Never use this for simple-path-style games requiring a visited-set.** That blows the state to `2^V` and leaves the DP regime (Task 15's `INTRACTABLE`).
- **Classify before you code.** Scored → game DP; single win/loss → boolean DP; sum of win/loss games → Grundy (topic `15`); huge/irregular tree → minimax + pruning (topic `16`). Misclassifying wastes effort and can produce silently wrong answers (Task 15).
- **Self-play is the second check.** Beyond the brute-force oracle, simulate the game following the reconstructed optimal moves and assert the final difference equals `dp[0][n-1]`. This catches reconstruction bugs the value-only oracle misses (Task 9).

### Cross-language determinism

For every task with random inputs, seed the RNG identically across Go, Java, and Python and verify the three produce byte-identical output. A divergence almost always means an integer-type or modulus difference, not a DP bug — but it must be reconciled before the task is considered done.

### Suggested completion order

1. **Beginner (1–5):** build the core difference DP, the winner/score readout, the 1-D Stone Game III, the boolean check, and move reconstruction. These cement the template.
2. **Intermediate (6–10):** coins-in-a-row, the two harder Stone Game variants, the divisor boolean game, full move sequences, and the fuzz harness. These exercise richer state and validation.
3. **Advanced (11–15):** rolling-array space, the non-zero-sum vector, the K-choice generalization, batched queries, and the classification meta-task. These cover the senior-level decisions.
4. **Benchmarks (B, C):** measure the brute-vs-DP crossover and demonstrate the top-down/bottom-up trade-off empirically.

Do not skip the oracle in any task: the brute-force comparison is what converts "it ran" into "it is correct."

### Common pitfalls to watch for across tasks

- **Sign error:** `g(m) + D(S')` instead of `g(m) - D(S')` — the single most frequent bug; caught by the oracle.
- **Wrong fill order:** filling by raw index instead of increasing interval length, so dependencies aren't ready.
- **Base-case slip:** returning `a` or zeros for the empty/terminal state instead of `0` (difference) — breaks the recursion.
- **Sentinel underflow:** `Long.MIN_VALUE` in a `max` underflows on the first subtraction; use `MIN/4` or `-inf`.
- **Difference vs score confusion:** outputting `dp[0][n-1]` where the problem wanted a raw score; convert with `(sum ± dp)/2`.
- **Greedy substitution:** "optimizing" with a greedy end-pick; keep `[1,5,233,7]` as a regression test.
- **Unclamped parameter:** letting `M` in Stone Game II grow past `n` blows up the cache; clamp `M = min(max(M, x), n)`.
- **Misclassification:** applying Grundy XOR to a scoring game, or boolean DP to a game with payoffs — the Task 15 trap.

### What "done" means for each task

A task is complete when:

1. all three languages compile/run and produce identical output on seeded inputs;
2. the brute-force oracle agrees on all random small cases;
3. the stated complexity is met (verify with a quick timing on the largest allowed input);
4. the edge cases in the evaluation criteria (empty array, single element, ties, negative values where applicable) are explicitly tested.

Skipping any of these four leaves a latent bug.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
