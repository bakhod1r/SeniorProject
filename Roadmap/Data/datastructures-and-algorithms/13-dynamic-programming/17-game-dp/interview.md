# Game DP — Interview Preparation

Game DP is a favourite interview topic because it rewards one crisp insight — *"track the score **difference** the player-to-move can force: `dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])`"* — and then tests whether you can (a) explain why a single number (the difference) replaces two scores, (b) recognize the same `D(S) = max_m [g(m) - D(S')]` skeleton behind Stone Game II/III and coins-in-a-row, (c) place it correctly relative to minimax (topic `16`) and Grundy theory (topic `15`), and (d) avoid the classic trap of solving an adversarial game greedily. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Optimal score difference, pick from ends | `dp[i][j] = max(a[i]-dp[i+1][j], a[j]-dp[i][j-1])` | `O(n²)` |
| Does player 1 win/tie? | check `dp[0][n-1] >= 0` | `O(1)` after DP |
| Player 1's raw score | `(totalSum + dp[0][n-1]) / 2` | `O(1)` |
| Take 1/2/3 stones from front (Stone Game III) | 1-D diff DP `dp[i]=max_x(sum-dp[i+x])` | `O(n)` |
| Take 1..2M front piles (Stone Game II) | `(i, M)` state + suffix sums | `O(n³)` |
| Can current player win (no score) | `canWin(S)=OR_m[NOT canWin(S')]` | states × moves |
| **Sum of independent win/loss games** | **Grundy / XOR (topic `15`) — not this** | — |
| **Huge irregular game tree** | **minimax + alpha-beta (topic `16`)** | — |

The universal template (the *only* thing to memorize):

```text
D(S) = max over legal moves m of [ g(m) - D(S') ]
       where g(m) = gain of move m, S' = state after m (opponent to move)
base:  D(terminal) = 0
```

Pick-from-ends specialization:

```text
dp[i][j] = max( a[i] - dp[i+1][j],   # take left
                a[j] - dp[i][j-1] )   # take right
dp[i][i] = a[i]                       # one coin
```

Key facts:
- The **minus sign** encodes the adversary: the opponent's best difference counts against you.
- `dp[0][n-1]` is a **difference**, not a score; convert with `(S ± dp)/2`.
- Greedy ("take the bigger end") is **wrong** for adversarial games — verify with `[1,5,233,7]`.
- Scoring game ⇒ this DP. Win/loss sum-of-games ⇒ Grundy (topic `15`). Both play optimally is the signal.

---

## Junior Questions (12 Q&A)

### J1. What does `dp[i][j]` represent?
The best **score difference** — (current player's total) minus (opponent's total) — that the player to move can force on the sub-array `a[i..j]`, assuming both play optimally. It is one number, not a pair of scores.

### J2. Why is a single number (the difference) enough instead of two scores?
The game is **zero-sum**: the coins are a fixed pot, so what one player gains the other loses relative to the difference. On the opponent's turn they become "the player to move," so the same logic recurses. The difference plus the known remaining sum recovers both raw scores: `score = (sum ± diff)/2`.

### J3. What is the base case?
A single coin: `dp[i][i] = a[i]`. The player to move takes it, the opponent gets nothing, so the difference is `a[i]`. (Equivalently, the empty interval has difference `0`.)

### J4. Why is there a minus sign in `a[i] - dp[i+1][j]`?
After you take `a[i]`, it is the opponent's turn on `a[i+1..j]`, where `dp[i+1][j]` is the difference *they* can force in *their* favor. From your viewpoint that is negative, so it is subtracted from the coin you took.

### J5. Why can't you just be greedy and take the bigger end?
Because taking the bigger coin now can expose an even bigger one to your opponent. Example: `[1, 5, 233, 7]` — grabbing 7 lets the opponent take 233. Optimal play requires look-ahead, which is what the DP does.

### J6. How do you read off the winner?
Player 1 wins or ties iff `dp[0][n-1] >= 0`. If it is exactly `0`, it is a tie (read the problem's tie rule).

### J7. What is the time and space complexity?
`O(n²)` time and `O(n²)` space. There are `~n²/2` interval states `(i, j)`, each computed in `O(1)`. Space can be reduced to `O(n)` with a rolling diagonal if you only need the value.

### J8. In what order do you fill the table?
By **increasing interval length**: first all 1-coin intervals (the base case), then length 2, then 3, up to `n`. Each `dp[i][j]` needs the two shorter intervals `dp[i+1][j]` and `dp[i][j-1]`, which are already filled.

### J9. What kind of DP is this?
**Interval (range) DP** — the state is a contiguous range `[i..j]`, the same family as matrix-chain multiplication and palindrome partitioning.

### J10. How do you recover each player's actual score from the difference?
With the total `S = Σ a[k]`: player 1's score `= (S + dp[0][n-1])/2`, player 2's `= (S - dp[0][n-1])/2`. They sum to `S` and differ by the DP value.

### J11. Does this work for negative coin values?
Yes. The recurrence makes no assumption of positivity. Stone Game III, for instance, can have negative stones. Greedy shortcuts and "first player always wins" facts break, but the DP still holds.

### J12 (analysis). Why is the naive recursion exponential and the DP polynomial?
The naive recursion re-solves the same interval many times, branching two ways at each of `n` steps → `O(2ⁿ)`. There are only `O(n²)` distinct intervals, so memoizing each once gives `O(n²)`.

---

## Middle Questions (12 Q&A)

### M1. State and prove the recurrence.
`dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])`, `dp[i][i] = a[i]`. Induction on interval length: a length-1 interval is the base; for longer intervals, the mover takes an end, banking that coin's value minus the opponent's optimal difference on the remainder. Each move shrinks the interval, so the induction is well-founded.

### M2. What is the general game-DP template?
`D(S) = max over legal moves m of [g(m) - D(S')]`, `D(terminal) = 0`. Pick-from-ends, Stone Game II/III, and coins-in-a-row are all instances; only the state and move set change.

### M3. Solve Stone Game III (take 1, 2, or 3 from the front).
State is the front index `i`. `dp[i] = max over x in {1,2,3} of (sum(a[i..i+x-1]) - dp[i+x])`, `dp[n] = 0`. `dp[0] > 0` → Alice, `< 0` → Bob, `== 0` → Tie. `O(n)` because the state is 1-D with `O(1)` moves.

### M4. How does Stone Game II differ, and what is the state?
You may take `1..2M` front piles, and `M` becomes `max(M, x)`. State is `(i, M)`. Model the mover's *own best total* with a suffix sum: `best(i, M) = max over x (suffix[i] - best(i+x, max(M, x)))`. Answer `best(0, 1)`. Clamp `M <= n`; complexity `O(n³)` worst case.

### M5. When would you store an explicit `(myScore, oppScore)` instead of the difference?
Only for **non-zero-sum** payoffs or more than two players, where the difference is not conserved and loses information. For all standard zero-sum scoring games, the difference scalar is strictly better (half the state, fewer sign bugs).

### M6. How does game DP relate to minimax (topic `16`)?
It *is* minimax — specifically the **negamax** form, where the alternating max/min becomes one recurrence with a sign flip (`- D(S')`). Game DP is memoized minimax for a game whose state space is small and overlapping enough to tabulate; topic `16` handles large/irregular trees with alpha-beta pruning.

### M7. How does game DP differ from Grundy theory (topic `15`)?
Grundy is for **impartial win/loss** games and combines independent subgames by XOR. Game DP is for **scoring** games and produces a numeric value that does not decompose by XOR. Use the difference DP when there are scores; use Grundy when it is win/loss and the game splits into independent piles.

### M8. What is the boolean "can I win" recurrence?
`canWin(S) = OR over moves m of [NOT canWin(S')]` — "I win if some move leaves the opponent in a losing state." Terminal (no move) is a loss under normal play. Used for the Divisor Game and similar win/loss puzzles.

### M9. How do you reconstruct the optimal moves?
After filling `dp`, walk from `(0, n-1)`: at each interval, the optimal move is take-left if `a[i] - dp[i+1][j] >= a[j] - dp[i][j-1]`, else take-right. Append and shrink. `O(n)` after the `O(n²)` fill.

### M10. Why are suffix sums important for the front-take games?
Transitions need "sum of the rest after I take some prefix." Precomputing a suffix sum makes each such query `O(1)`, keeping Stone Game II/III efficient instead of recomputing sums in an inner loop.

### M11. How do you verify a game-DP solution?
Compare against an unmemoized brute-force recursion on random small inputs (`n <= 12`), and optionally run a self-play simulator that follows the reconstructed moves and checks the final difference equals `dp[0][n-1]`.

### M12 (analysis). Why does the difference formulation halve the work versus tracking both scores?
For a zero-sum game, `score1 + score2 = sum` is fixed, so `score1 - score2` (one number) carries all the decision-relevant information. Storing both is redundant: one coordinate is determined by the other and the conserved sum.

---

## Senior Questions (10 Q&A)

### S1. Difference scalar vs explicit two-score state — how do you decide?
Use the difference scalar iff the game is **two-player, zero-sum, perfect-information, alternating** (the total is conserved). If the payoff is not zero-sum, or there are more than two players, the difference loses information and you must store a per-player payoff vector. Diagnose the payoff structure before coding.

### S2. How do you handle very large `n` where `O(n²)` memory is too much?
If only the value is needed, use a rolling-diagonal reduction to `O(n)` space. If even `O(n²)` time is too much, look for a 1-D-state reformulation (Stone Game III is `O(n)`) or a closed-form shortcut (Stone Game I's even-piles/odd-total parity argument gives an `O(1)` answer).

### S3. Top-down memo or bottom-up table?
Prototype top-down — the recurrence maps directly to a memoized function and is cleanest for irregular move sets (Stone Game II). Switch to bottom-up for large `n` to avoid recursion-depth limits and to enable the rolling-array space cut. For interval DP the bottom-up order is "increasing interval length."

### S4. How do you keep the memo cache polynomial when a parameter looks unbounded?
Clamp it to its natural ceiling. In Stone Game II, `M = max(M, x)` can never usefully exceed `n` (you cannot take more piles than remain), so clamp `M <= n` and the `(i, M)` cache is `O(n²)`.

### S5. What numerical hazards bite in game DP?
Overflow with large values (use 64-bit), bad `max`-sentinels (`Long.MIN_VALUE` underflows on the first subtraction — use `MIN/4` or `-inf`), and fractional raw scores (a symptom of a wrong total or mis-signed difference; for integer inputs `(S±D)/2` is always exact).

### S6. How do you test a game DP when the answer is opaque?
Keep an independent brute-force game solver (the unmemoized recurrence) and assert equality on thousands of random small inputs. Add a self-play simulator, a reverse-array symmetry check (`dp` of the reversed array equals the original), and the sum/parity invariant.

### S7. What is the single most common correctness bug, and how do you catch it?
A **sign error** — adding the sub-result instead of subtracting it (`+ D(S')` instead of `- D(S')`). It produces a plausible but wrong winner. The brute-force oracle catches it immediately; a code comment stating "subtract the opponent's optimal difference" prevents it.

### S8. When is greedy actually correct for a two-player game?
Almost never for adversarial scoring games — assume it is wrong and prove otherwise. There are special structured cases (e.g., Stone Game I's parity shortcut), but those are theorems about the specific game, not general greedy. Keep `[1,5,233,7]` as a regression test against greedy.

### S9. How do you place this against topics 15 and 16 in an interview?
Scored, optimal-play game → game DP (this topic), which is memoized negamax. Win/loss game that splits into independent subgames → Grundy/XOR (topic `15`). Large or irregular game tree (chess-like) where you cannot tabulate states → minimax with alpha-beta pruning (topic `16`). Naming the right tool signals maturity.

### S10 (analysis). Why does alpha-beta pruning not help the interval game DP asymptotically?
Because the DP must evaluate every state to fill the table, and there are only `O(n²)` of them. Alpha-beta prunes branches in an unbounded tree where most states are never needed; here the subproblem DAG is small and fully reused, so memoization already gives the optimal `O(n²)`.

---

## Professional / Theory Questions (8 Q&A)

### P1. Prove that player 1 wins iff `dp[0][n-1] >= 0`.
`dp[0][n-1]` is player 1's optimal score difference by the score-difference theorem (induction on remaining moves). Difference `>= 0` means player 1's total is at least player 2's; `> 0` strict win, `== 0` tie. Player 1 can *guarantee* this against any opponent and achieves exactly it against an optimal one — it is the minimax value.

### P2. Why does the difference suffice only for zero-sum games?
Conservation `score1 + score2 = totalSum` plus the difference `score1 - score2 = dp` form a `2×2` system with unique solution `(totalSum ± dp)/2`. If the total can vary with the moves (non-zero-sum), two states with equal difference but different totals can have different optimal continuations, so a scalar cannot encode the value — you need the per-player vector.

### P3. Explain the negamax equivalence to minimax.
Minimax alternates `max` (mover) and `min` (opponent minimizing the mover's value). For a zero-sum game, minimizing the mover's value equals maximizing the opponent's, so measuring value always "from the player to move" turns the alternation into one recurrence with a sign flip: `value(S) = max_m [g(m) - value(S')]`. That is exactly the game-DP difference recurrence.

### P4. What gives this problem optimal substructure and overlapping subproblems?
Optimal substructure: an exchange argument shows each sub-interval must be played optimally (a suboptimal sub-play could be improved, contradicting optimality of the whole). Overlapping subproblems: a `Θ(2ⁿ)` game tree has only `Θ(n²)` distinct interval states, so memoization collapses it. These two properties license DP.

### P5. Why don't scoring games decompose by XOR like impartial games?
The XOR rule (Sprague-Grundy) summarizes each impartial subgame by a single nimber that fully determines win/loss combination. A scoring game's value is a real number, and the optimal interleaving of moves across two scoring subgames depends on the *magnitudes* of gains, not a per-game summary — so no fixed combinator (XOR or otherwise) exists. Hence the full numeric DP is required.

### P6. How does the boolean win DP relate to Grundy numbers?
For a *single* game, `canWin(S) = [Grundy(S) > 0]`. Grundy theory generalizes the boolean answer to *sums* of independent games via XOR. The boolean DP is the special case that handles one game without the nimber machinery.

### P7. Generalize the recurrence to an arbitrary acyclic game.
For any finite DAG of states with gain-labeled moves, `D(S) = max over (S → S') of [g(S, S') - D(S')]`, `D(terminal) = 0`, computed in reverse topological order in `Θ(|states| + |moves|)`. Interval and prefix games are always acyclic (every move shrinks the array), so this always applies.

### P8 (analysis). What is the complexity of each major variant, and why?
Time = `#states × moves-per-state`: Predict the Winner / Stone Game I `O(n²)` (n² intervals, 2 moves); Stone Game III `O(n)` (n front indices, 3 moves); Stone Game II `O(n³)` (n·M states, O(n) moves); divisor/boolean game `O(N log N)` (N states, O(#divisors) moves). The recurrence shape is constant; the state and move set set the cost.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential search with a polynomial DP.
Look for a concrete story: an adversarial or optimization problem solved by naive recursion that timed out, the realization that subproblems overlapped (only `O(n²)` distinct states), and the memoization that made it polynomial. Strong answers mention validating the DP against the original slow version on small inputs.

### B2. A teammate solved an "optimal play" problem greedily and shipped a wrong answer. How do you handle it?
Explain the adversarial look-ahead with a tiny counterexample (`[1,5,233,7]` where greedy loses to optimal). Frame the fix as the difference DP, and add the counterexample as a regression test. Keep it a teaching moment: greedy *feels* right but the opponent punishes it.

### B3. Design a feature that computes the optimal move for a two-player turn-based mini-game in a product.
Identify the state (interval? prefix? small integer?), confirm it is zero-sum and perfect-information, build the difference DP, precompute the table once if many sub-game queries are expected, and expose "best move" via reconstruction. Discuss memory (`O(n²)` table vs `O(n)` value-only) and validation via a brute-force oracle and self-play.

### B4. How would you explain game DP to a junior engineer?
Use the coin-row analogy: two siblings grabbing from the ends of a chocolate box. Track only the *gap* between them (the difference), and at each step "take an end, but subtract whatever the opponent can then force." Lead with the two gotchas: it is not greedy, and `dp` is a difference, not a score.

### B5. Your optimal-play service is too slow / memory-heavy at scale. How do you investigate?
Check whether the state carries an unneeded dimension (turn parity is never needed for zero-sum). Confirm `O(n²)` memory is necessary — switch to a rolling diagonal if only the value is needed. Look for a 1-D-state or closed-form variant. Profile whether you are rebuilding the table per query instead of once per array.

---

## Coding Challenges

### Challenge 1: Predict the Winner (score-difference interval DP)

**Problem.** Given an integer array `a`, two players alternate taking the leftmost or rightmost element (player 1 first), each maximizing their own total. Return `true` if player 1 can win or tie.

**Example.**
```text
a = [1, 5, 2]        -> false  (player 1 cannot force a win/tie)
a = [1, 5, 233, 7]   -> true
a = [5, 3, 7, 10]    -> true   (difference 5, scores 15 vs 10)
```

**Constraints.** `1 <= n <= 20` (or larger with the iterative DP), values up to `10^7`.

**Brute force.** Unmemoized recursion, `O(2ⁿ)` — the correctness oracle.

**Optimal.** Score-difference interval DP, `O(n²)`.

**Go.**
```go
package main

import "fmt"

func predictTheWinner(a []int) bool {
	n := len(a)
	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
		dp[i][i] = a[i]
	}
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			left := a[i] - dp[i+1][j]
			right := a[j] - dp[i][j-1]
			dp[i][j] = max(left, right)
		}
	}
	return dp[0][n-1] >= 0
}

func max(x, y int) int {
	if x > y {
		return x
	}
	return y
}

func main() {
	fmt.Println(predictTheWinner([]int{1, 5, 2}))      // false
	fmt.Println(predictTheWinner([]int{1, 5, 233, 7})) // true
	fmt.Println(predictTheWinner([]int{5, 3, 7, 10}))  // true
}
```

**Java.**
```java
public class PredictTheWinner {
    static boolean predictTheWinner(int[] a) {
        int n = a.length;
        int[][] dp = new int[n][n];
        for (int i = 0; i < n; i++) dp[i][i] = a[i];
        for (int len = 2; len <= n; len++)
            for (int i = 0; i + len - 1 < n; i++) {
                int j = i + len - 1;
                int left = a[i] - dp[i + 1][j];
                int right = a[j] - dp[i][j - 1];
                dp[i][j] = Math.max(left, right);
            }
        return dp[0][n - 1] >= 0;
    }

    public static void main(String[] args) {
        System.out.println(predictTheWinner(new int[]{1, 5, 2}));      // false
        System.out.println(predictTheWinner(new int[]{1, 5, 233, 7})); // true
        System.out.println(predictTheWinner(new int[]{5, 3, 7, 10}));  // true
    }
}
```

**Python.**
```python
def predict_the_winner(a):
    n = len(a)
    dp = [[0] * n for _ in range(n)]
    for i in range(n):
        dp[i][i] = a[i]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = max(a[i] - dp[i + 1][j], a[j] - dp[i][j - 1])
    return dp[0][n - 1] >= 0


if __name__ == "__main__":
    print(predict_the_winner([1, 5, 2]))       # False
    print(predict_the_winner([1, 5, 233, 7]))  # True
    print(predict_the_winner([5, 3, 7, 10]))   # True
```

---

### Challenge 2: Stone Game (even piles, return whether Alice wins)

**Problem.** Piles `p` (even length, odd total). Alice and Bob alternate taking a pile from either end, Alice first; both maximize their own stones. Return `true` if Alice wins. (LeetCode 877.)

**Example.**
```text
p = [5, 3, 4, 5]  -> true
```

**Note.** With an even count and odd total Alice always wins, but the general difference DP works for any input and is what an interviewer wants to see.

**Optimal.** Difference interval DP, `O(n²)` (or the `return true` parity shortcut, mentioned but not relied upon).

**Go.**
```go
package main

import "fmt"

func stoneGame(p []int) bool {
	n := len(p)
	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
		dp[i][i] = p[i]
	}
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			dp[i][j] = max(p[i]-dp[i+1][j], p[j]-dp[i][j-1])
		}
	}
	return dp[0][n-1] > 0
}

func max(x, y int) int {
	if x > y {
		return x
	}
	return y
}

func main() {
	fmt.Println(stoneGame([]int{5, 3, 4, 5})) // true
	fmt.Println(stoneGame([]int{3, 7, 2, 3})) // true
}
```

**Java.**
```java
public class StoneGame {
    static boolean stoneGame(int[] p) {
        int n = p.length;
        int[][] dp = new int[n][n];
        for (int i = 0; i < n; i++) dp[i][i] = p[i];
        for (int len = 2; len <= n; len++)
            for (int i = 0; i + len - 1 < n; i++) {
                int j = i + len - 1;
                dp[i][j] = Math.max(p[i] - dp[i + 1][j], p[j] - dp[i][j - 1]);
            }
        return dp[0][n - 1] > 0;
    }

    public static void main(String[] args) {
        System.out.println(stoneGame(new int[]{5, 3, 4, 5})); // true
        System.out.println(stoneGame(new int[]{3, 7, 2, 3})); // true
    }
}
```

**Python.**
```python
def stone_game(p):
    n = len(p)
    dp = [[0] * n for _ in range(n)]
    for i in range(n):
        dp[i][i] = p[i]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = max(p[i] - dp[i + 1][j], p[j] - dp[i][j - 1])
    return dp[0][n - 1] > 0


if __name__ == "__main__":
    print(stone_game([5, 3, 4, 5]))  # True
    print(stone_game([3, 7, 2, 3]))  # True
```

---

### Challenge 3: Coins in a Row — Maximum Value You Can Collect

**Problem.** Given coin values `a`, two players alternate taking from either end (you first); both play optimally for their own total. Return the **maximum total value** you (player 1) can collect.

**Example.**
```text
a = [8, 15, 3, 7]  -> 22   (you can collect 8 + 7 + ... optimally => 22)
a = [5, 3, 7, 10]  -> 15
```

**Approach.** Compute the difference DP `dp[0][n-1]`, then `(sum + dp[0][n-1]) / 2` is your collected value.

**Go.**
```go
package main

import "fmt"

func maxCollected(a []int) int {
	n := len(a)
	sum := 0
	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
		dp[i][i] = a[i]
		sum += a[i]
	}
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			dp[i][j] = max(a[i]-dp[i+1][j], a[j]-dp[i][j-1])
		}
	}
	return (sum + dp[0][n-1]) / 2
}

func max(x, y int) int {
	if x > y {
		return x
	}
	return y
}

func main() {
	fmt.Println(maxCollected([]int{8, 15, 3, 7})) // 22
	fmt.Println(maxCollected([]int{5, 3, 7, 10})) // 15
}
```

**Java.**
```java
public class CoinsInARow {
    static int maxCollected(int[] a) {
        int n = a.length, sum = 0;
        int[][] dp = new int[n][n];
        for (int i = 0; i < n; i++) { dp[i][i] = a[i]; sum += a[i]; }
        for (int len = 2; len <= n; len++)
            for (int i = 0; i + len - 1 < n; i++) {
                int j = i + len - 1;
                dp[i][j] = Math.max(a[i] - dp[i + 1][j], a[j] - dp[i][j - 1]);
            }
        return (sum + dp[0][n - 1]) / 2;
    }

    public static void main(String[] args) {
        System.out.println(maxCollected(new int[]{8, 15, 3, 7})); // 22
        System.out.println(maxCollected(new int[]{5, 3, 7, 10})); // 15
    }
}
```

**Python.**
```python
def max_collected(a):
    n = len(a)
    total = sum(a)
    dp = [[0] * n for _ in range(n)]
    for i in range(n):
        dp[i][i] = a[i]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = max(a[i] - dp[i + 1][j], a[j] - dp[i][j - 1])
    return (total + dp[0][n - 1]) // 2


if __name__ == "__main__":
    print(max_collected([8, 15, 3, 7]))  # 22
    print(max_collected([5, 3, 7, 10]))  # 15
```

---

### Challenge 4: Stone Game III — Take 1, 2, or 3 from the Front

**Problem.** Stones `a`. Alice and Bob alternate; on a turn a player takes the first 1, 2, or 3 stones (gaining their sum). Both maximize their own total. Return `"Alice"`, `"Bob"`, or `"Tie"`. (LeetCode 1406.) Values may be negative.

**Example.**
```text
a = [1, 2, 3, 7]   -> "Bob"
a = [1, 2, 3, -9]  -> "Alice"
a = [1, 2, 3, 6]   -> "Tie"
```

**Approach.** 1-D difference DP: `dp[i] = max over x in {1,2,3} of (sum(a[i..i+x-1]) - dp[i+x])`, `dp[n] = 0`. `O(n)`.

**Go.**
```go
package main

import "fmt"

func stoneGameIII(a []int) string {
	n := len(a)
	dp := make([]int, n+1)
	const NEG = -1 << 60
	for i := n - 1; i >= 0; i-- {
		take, best := 0, NEG
		for x := 1; x <= 3 && i+x <= n; x++ {
			take += a[i+x-1]
			if v := take - dp[i+x]; v > best {
				best = v
			}
		}
		dp[i] = best
	}
	switch {
	case dp[0] > 0:
		return "Alice"
	case dp[0] < 0:
		return "Bob"
	default:
		return "Tie"
	}
}

func main() {
	fmt.Println(stoneGameIII([]int{1, 2, 3, 7}))  // Bob
	fmt.Println(stoneGameIII([]int{1, 2, 3, -9})) // Alice
	fmt.Println(stoneGameIII([]int{1, 2, 3, 6}))  // Tie
}
```

**Java.**
```java
public class StoneGameIII {
    static String stoneGameIII(int[] a) {
        int n = a.length;
        long[] dp = new long[n + 1];
        final long NEG = Long.MIN_VALUE / 4;
        for (int i = n - 1; i >= 0; i--) {
            long take = 0, best = NEG;
            for (int x = 1; x <= 3 && i + x <= n; x++) {
                take += a[i + x - 1];
                best = Math.max(best, take - dp[i + x]);
            }
            dp[i] = best;
        }
        if (dp[0] > 0) return "Alice";
        if (dp[0] < 0) return "Bob";
        return "Tie";
    }

    public static void main(String[] args) {
        System.out.println(stoneGameIII(new int[]{1, 2, 3, 7}));  // Bob
        System.out.println(stoneGameIII(new int[]{1, 2, 3, -9})); // Alice
        System.out.println(stoneGameIII(new int[]{1, 2, 3, 6}));  // Tie
    }
}
```

**Python.**
```python
def stone_game_iii(a):
    n = len(a)
    dp = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        take, best = 0, float("-inf")
        for x in range(1, 4):
            if i + x <= n:
                take += a[i + x - 1]
                best = max(best, take - dp[i + x])
        dp[i] = best
    if dp[0] > 0:
        return "Alice"
    if dp[0] < 0:
        return "Bob"
    return "Tie"


if __name__ == "__main__":
    print(stone_game_iii([1, 2, 3, 7]))   # Bob
    print(stone_game_iii([1, 2, 3, -9]))  # Alice
    print(stone_game_iii([1, 2, 3, 6]))   # Tie
```

---

## Final Tips

- Lead with the one-liner: *"Track the score **difference** the player-to-move can force: `dp[i][j] = max(a[i] - dp[i+1][j], a[j] - dp[i][j-1])`; player 1 wins iff `dp[0][n-1] >= 0`."*
- Immediately flag the two gotchas: **it is not greedy** (show `[1,5,233,7]`) and **`dp` is a difference, not a score** (convert with `(sum ± dp)/2`).
- For richer move sets, generalize to `D(S) = max_m [g(m) - D(S')]` and pick the smallest state (Stone Game III needs only the front index).
- Place it correctly: scored → game DP (negamax); win/loss sum-of-games → Grundy (topic `15`); huge tree → minimax + alpha-beta (topic `16`).
- Always offer to verify against a brute-force game solver on small inputs, and mention self-play as a second independent check.
