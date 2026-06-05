# Sprague-Grundy Theorem and Grundy Numbers — Interview Preparation

Sprague-Grundy is a favourite interview topic because it rewards a single crisp insight — *"every impartial position has a Grundy number `= mex` of its children's Grundy values, and sums combine by XOR"* — and then tests whether you can (a) compute Grundy values with DP/memoization, (b) decompose a compound game and decide it via XOR, (c) recognize disguised classics (subtraction, staircase Nim, splitting games), and (d) avoid the traps: `+` instead of XOR, the misère convention, and applying the theory to partizan or loopy games. This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Win/loss of a single position | `grundy(p)`; `0 ⇒ mover loses` | `O(V + E)` |
| Grundy of a subtraction game pile | `g[x] = mex{g[x-s]}` DP | `O(n·|S|)` |
| Decide a sum of `m` games | XOR component Grundy values | `O(m)` after values |
| Grundy of a splitting move | `mex{ g(a) ⊕ g(b) }` | depends on splits |
| Huge `n` subtraction game | detect period, then lookup | `O(period)` then `O(1)` |
| Staircase Nim | XOR coins on **odd** steps | `O(steps)` |
| Coin-turning game | XOR single-coin Grundy values | `O(coins)` |
| Nim (prototype) | XOR pile sizes (sibling `14-nim`) | `O(m)` |
| **Misère general game** | **genus / misère quotient — hard** | — |

Semiring-free core facts:

```text
mex(S)        = smallest non-negative integer not in S        (mex{} = 0)
grundy(p)     = mex { grundy(q) : p -> q }                     (terminal -> 0)
grundy(0)     ⇔ mover LOSES (P-position)                       (nonzero ⇒ win)
grundy(sum)   = XOR of component grundy values                 (NOT sum!)
winning move  = clear highest set bit of XOR in some component
```

Key facts:
- **Impartial + normal play** only: same moves for both players, last to move wins.
- `mex` is the smallest *missing* value, not `max + 1`.
- Combine games by **XOR**, never `+`.
- Subtraction-game Grundy sequences are **eventually periodic**.
- Misère, loopy, and partizan games are *outside* the plain XOR theory.

---

## Junior Questions (12 Q&A)

### J1. What is a Grundy number?
The Grundy number (nimber) of a position is `mex` of the Grundy numbers of all positions reachable in one move. It tags each position of an impartial game with a single integer that captures its "Nim-equivalent pile size."

### J2. What does `mex` mean?
Minimum excludant: the smallest non-negative integer not present in a set. `mex{} = 0`, `mex{0,1,3} = 2`, `mex{1,2} = 0`. It is the *smallest missing* value, not the maximum plus one.

### J3. What is the Grundy number of a terminal position?
`0`. A terminal position has no moves, so its children set is empty, and `mex{} = 0`. The player to move there loses.

### J4. How does the Grundy number decide who wins a single game?
The player about to move **loses** (with best play) iff the Grundy number is `0`. Any nonzero value means the mover wins. So you compute one number and compare to `0`.

### J5. What is an impartial game?
A two-player game where, from any position, *both* players have exactly the same legal moves (it does not matter whose turn it is). Nim is impartial; chess is not (you move only your own pieces).

### J6. What is normal play vs misère play?
Normal play: the player who cannot move loses (last to move wins) — the default for Sprague-Grundy. Misère play: the player who makes the last move loses. The two give different winners and need different analysis.

### J7. How do you combine several independent games?
XOR their Grundy numbers: `grundy(A + B + …) = grundy(A) ⊕ grundy(B) ⊕ …`. The compound game is a loss for the mover iff this XOR is `0`.

### J8. Why XOR and not addition?
Because every component is equivalent to a Nim pile of size equal to its Grundy number, and Nim positions are decided by XOR of pile sizes (Bouton's theorem). Adding would give the wrong winner.

### J9. What is the Sprague-Grundy theorem?
Every impartial-game position is equivalent to a single Nim pile whose size is the position's Grundy number — equivalent in the strong sense that you can swap it into any sum of games without changing who wins.

### J10. How do you compute Grundy values for a subtraction game?
Fill a table: `g[0] = 0`, and `g[x] = mex{ g[x - s] : s in S, s ≤ x }` for the allowed removal set `S`. This is an `O(n·|S|)` 1-D DP.

### J11. What is a losing position called, and what is its Grundy value?
A P-position ("Previous player wins" — the mover loses). Its Grundy value is `0`.

### J12 (analysis). Why is computing all Grundy values `O(V + E)` on a DAG?
Each position is processed once (memoization / topological order), and computing its mex costs proportional to its out-degree. Summed over all positions, the mex work is `O(E)`, plus `O(V + E)` for traversal.

---

## Middle Questions (12 Q&A)

### M1. Prove that `grundy(p) = 0` iff `p` is a losing position.
Induction on the DAG. If `g(p) = 0`, then `0` is the smallest missing child value, so **no** child has Grundy `0`; by hypothesis every child is winning, so `p` is losing. If `g(p) > 0`, some child has Grundy `0` (mex property), so a move reaches a losing position, making `p` winning.

### M2. Prove the XOR sum rule for two games.
Show `g((p,q)) = g(p) ⊕ g(q) =: s`. (A) No move keeps the XOR at `s`: a move in one component to value `v` gives XOR `v ⊕ other`, which equals `s` only if `v` equals the original component value — impossible by the mex property. (B) Every `t < s` is reachable: clear the top differing bit in the component that has it, landing on Grundy `t`. So mex of children is `s`.

### M3. What is the Grundy number of a single Nim pile of size `n`?
`n`. Its options are piles `0..n-1` with Grundy values `0..n-1`, so `mex{0,…,n-1} = n`. This is why Nim is the prototype.

### M4. How do you find the actual winning move in a sum?
Let `x = ⊕ g(componentᵢ) ≠ 0`, `h` = highest set bit of `x`. Pick a component `C` whose Grundy value has bit `h` set; its target is `t = g(C) ⊕ x < g(C)`. Move within `C` to a child of Grundy value `t` (it exists by the mex property). Now the XOR is `0`.

### M5. What is a splitting game and how is its Grundy computed?
A move splits a region into two independent regions. The resulting position is a *sum*, so its Grundy is `g(a) ⊕ g(b)`. Hence `g(n) = mex{ g(a) ⊕ g(b) : (a,b) reachable }`. Grundy's game and Kayles are examples.

### M6. Why are subtraction-game Grundy sequences periodic?
Each value depends only on the previous `max(S)` values, each bounded by `|S|`. So the sliding window lives in a finite set and must eventually repeat; once a full window repeats, the sequence is periodic forever.

### M7. How do you exploit periodicity for `n = 10^18`?
Tabulate to a safe bound, detect a repeating window of length `max(S)` after a pre-period `n₀`, then answer `g[n] = g[n₀ + (n - n₀) mod π]` in `O(1)`.

### M8. What is staircase Nim and its rule?
Coins on steps; a move slides coins down one step; off the bottom they leave play. The game is equivalent to Nim on the coins at **odd** steps, so its Grundy value is the XOR of odd-step coin counts.

### M9. How do coin-turning games decompose?
The Grundy value of the whole position is the XOR of the Grundy values of single-coin positions (one head at each head location). You precompute single-coin values and XOR over the heads — turning a `2^n` space into `n` numbers.

### M10. When is layered/brute analysis better than Grundy decomposition?
When the game does *not* decompose (a move couples multiple regions) or is tiny — then a direct win/loss DFS or minimax is simpler. Grundy decomposition wins precisely when components are independent and you must combine them.

### M11. Why can't you XOR Grundy values of *coupled* components?
The XOR rule requires that a single move affects exactly one component (a disjunctive sum). If a move can touch two regions at once, they are not independent, the sum-rule hypothesis fails, and XOR gives the wrong answer.

### M12 (analysis). What is the bound on the period of a subtraction game?
At most `(|S| + 1)^{max(S)}` (number of distinct windows), with pre-period under the same bound. Observed periods are usually far smaller — e.g. take-`1..k` has period `k+1`.

---

## Senior Questions (10 Q&A)

### S1. How do you recognize whether a game is decomposable?
Ask: can a single move ever affect more than one "region"? If no, it is a disjunctive sum — Grundy each component and XOR. If yes (a move splits or couples regions), either model splits as sums (mex over XOR) or, if truly coupled, you cannot decompose.

### S2. How would you solve a subtraction game for `n = 10^18`?
Detect periodicity: tabulate to a generous bound, verify a full window of length `max(S)` repeats after some `n₀` (which guarantees periodicity forever), then modular-lookup. If a closed form exists (e.g. `g[n] = n mod (k+1)` for take-`1..k`), use it — `O(1)` and pitfall-free.

### S3. How do you prove a claimed set of losing positions is correct?
Two parts: (1) from every claimed P-position, every move leaves the set (you cannot stay balanced); (2) from every N-position, some move enters the set (you can re-balance). Together these match the win/loss recursion and `grundy = 0`.

### S4. What is Wythoff's game and why is it a cautionary tale?
Two piles; remove any amount from one pile, or the same amount from both. It is impartial but its losing positions follow golden-ratio Beatty sequences `(⌊φd⌋, ⌊φ²d⌋)`, **not** XOR `= 0`. It shows that recognizing special structure can beat blindly tabulating Grundy values.

### S5. How do you handle misère play?
For Nim specifically, use Bouton's misère rule (play normal Nim until your move leaves all piles ≤ 1, then leave an odd number of 1-piles). For general games there is no simple XOR analog — you need genus theory or misère quotients (Plambeck-Siegel). Never reuse the normal-play verdict.

### S6. How do you keep the state space manageable?
Canonicalize symmetric states (sort piles, normalize orientation) so equivalent positions share a cache entry; memoize *segment* Grundy values for splitting games and XOR over segments; drop irrelevant state fields. Halving distinct states is a direct speedup.

### S7. How do you verify a Grundy implementation when answers are opaque?
Keep a brute-force win/loss oracle and assert `grundy(p) == 0` iff "losing" for all small positions. Property-test the decomposition (`grundy(sum) == XOR`), the base case (`terminal == 0`), and the constructive winning move (play it and confirm the opponent is now losing).

### S8. What games are intractable even with the theory?
Games whose state space is exponential and that neither decompose nor are periodic — some are PSPACE-complete (Generalized Geography, Node Kayles on general graphs). Sprague-Grundy assigns a value, but *computing* it can be infeasible.

### S9. How does a "split into two unequal piles" move change the recurrence?
The move yields a sum of two piles, so it contributes `g(a) ⊕ g(b)` to the mex set: `g(n) = mex{ g(a) ⊕ g(b) : a+b=n, a≠b }` (Grundy's game). Forgetting the XOR is a classic bug.

### S10 (analysis). Why does the magnitude of a Grundy number not measure "how winning" a single position is?
For a single game only `0` vs nonzero decides win/loss. Magnitude matters solely inside an XOR over a sum, where it determines how components cancel. A Grundy value of `7` is not "more winning" than `1` in isolation.

---

## Professional Questions (8 Q&A)

### P1. Design a service that decides arbitrary sums of a fixed game family.
Precompute the component Grundy table (or segment values) once at startup. Per query, XOR the component values — `O(m)`. Cache any detected period for huge parameters. The table is read-only and shareable across workers; never rebuild it per request.

### P2. How do you compute Grundy for a game with structured (non-integer) states?
Memoized DFS keyed by a canonical encoding of the state: enumerate successors, take the mex of their Grundy values, cache. Canonicalize to collapse symmetric states. Assert a strictly decreasing measure along moves to guarantee termination (DAG).

### P3. A teammate combined two games with `+` and shipped a wrong winner. How do you fix it and prevent recurrence?
Change `+` to XOR. Add a property test: `grundy(A ⊎ B) == grundy(A) ^ grundy(B)` on random small instances — this fails immediately for `+` and also catches coupled-components-mistaken-as-independent. Document that disjunctive sums combine by XOR.

### P4. How do you debug "the Grundy value is wrong"?
Run the brute-force win/loss oracle on the same small inputs and assert `grundy == 0` iff losing. Check the three suspects: wrong mex (smallest missing, not max+1), missing base case (terminal must be `0`), and `+`-instead-of-XOR in the combine. Verify the move set / convention matches the problem.

### P5. When is min-plus-style optimization relevant here? (trick question)
It is not — Sprague-Grundy is about *who moves last*, not shortest/longest anything. If a problem asks for optimal *score* or path length, it is a different DP (minimax / value DP), not Grundy. State this distinction explicitly; conflating them is a common error.

### P6. How would you parallelize deciding a huge batch of compound-game queries?
Components are independent, so compute each component's Grundy value on separate workers, then XOR. Across queries that share a game family, precompute once and reuse. The within-table subtraction DP is sequential, so parallelism lives across components and across queries.

### P7. How do automata / structured games connect to Grundy?
A token on a DAG is the literal Grundy definition (mex over out-neighbors). Coin-turning games decompose into single-coin sub-games (XOR). Take-and-break (octal) games yield mex-over-XOR recurrences with (often) periodic Grundy sequences — the combinatorial-game analog of the transfer-matrix method.

### P8 (analysis). Why does plain Grundy theory fail for misère, and what replaces it?
The win/loss base case flips (last move loses), breaking Theorem 3.1 and the sum rule; a single XOR no longer decides the outcome. Replacements: Bouton's special rule for misère Nim; genus theory for "tame" games; and misère quotients (a monoid of values modulo misère-indistinguishability) for the general case — far more complex than the normal-play XOR.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you replaced an exponential search with a clean decomposition.
Look for a concrete story: a multi-component game or puzzle analyzed monolithically (state space `n^m`), the insight that components were independent, the switch to per-component Grundy + XOR, and the measured speedup. Strong answers mention validating the XOR identity against a brute-force oracle.

### B2. A teammate used Grundy/XOR on a misère game and shipped the wrong winner. How do you handle it?
Calmly explain that misère flips the endgame and the normal-play XOR rule does not apply; show a tiny counterexample (misère Nim with all 1-piles). Offer the correct path: Bouton's misère rule for Nim, or genus / misère quotients in general. Frame it as the convention being the subtle part, not blame.

### B3. Design a feature that tells a user if a board game position is winning.
Clarify the game is impartial and normal-play (else stop — Grundy does not apply). Build the move generator, compute Grundy by memoized DFS over canonical states, return "winning" iff nonzero, and optionally surface the constructive winning move. Discuss state explosion and canonicalization for caching.

### B4. How would you explain Grundy numbers to a junior engineer?
Start with the deli-ticket analogy for mex (smallest free ticket), then "every position gets a score; score `0` means you're stuck." Show the subtraction game `S={1,2,3}` giving `n mod 4`. Then introduce XOR for combining games with multi-pile Nim. Lead with the two gotchas: it counts "who moves last" (normal play) and you XOR, never add.

### B5. Your game-analysis job is too slow / uses too much memory at scale. How do you investigate?
Profile distinct memoized states; the usual culprit is non-canonical keys multiplying the cache by symmetry. Confirm splitting games memoize segment lengths (not whole boards). For huge parameters, ensure you exploit periodicity instead of tabulating to `n`. The fix is usually canonicalization plus periodicity.

---

## Coding Challenges

### Challenge 1: Grundy of a Subtraction Game + Decide a Sum

**Problem.** Given an allowed removal set `S`, an array of pile sizes, decide whether the **first** player wins the disjunctive subtraction game (remove `s ∈ S` from one pile; last to move wins).

**Example.**
```text
S = {1,2,3}, piles = [5,6,7]  ->  g = [.,1,2,3], XOR = 1^2^3 = 0  ->  SECOND wins
S = {1,2,3}, piles = [4,5]    ->  g[4]=0, g[5]=1, XOR = 1         ->  FIRST wins
```

**Constraints.** `1 ≤ |S| ≤ 10`, pile sizes `≤ 10^5`.

**Approach.** Fill the Grundy table to the max pile, XOR the piles' values, nonzero ⇒ first wins. `O(maxPile·|S| + m)`.

**Go.**
```go
package main

import "fmt"

func mex(seen []bool) int {
	for i, v := range seen {
		if !v {
			return i
		}
	}
	return len(seen)
}

func grundyTable(n int, S []int) []int {
	g := make([]int, n+1)
	for x := 1; x <= n; x++ {
		seen := make([]bool, len(S)+1)
		for _, s := range S {
			if s <= x {
				if v := g[x-s]; v < len(seen) {
					seen[v] = true
				}
			}
		}
		g[x] = mex(seen)
	}
	return g
}

func firstWins(S, piles []int) bool {
	mx := 0
	for _, p := range piles {
		if p > mx {
			mx = p
		}
	}
	g := grundyTable(mx, S)
	x := 0
	for _, p := range piles {
		x ^= g[p]
	}
	return x != 0
}

func main() {
	S := []int{1, 2, 3}
	fmt.Println(firstWins(S, []int{5, 6, 7})) // false
	fmt.Println(firstWins(S, []int{4, 5}))    // true
}
```

**Java.**
```java
import java.util.*;

public class SubtractionSum {
    static int mex(boolean[] seen) {
        for (int i = 0; i < seen.length; i++) if (!seen[i]) return i;
        return seen.length;
    }

    static int[] grundyTable(int n, int[] S) {
        int[] g = new int[n + 1];
        for (int x = 1; x <= n; x++) {
            boolean[] seen = new boolean[S.length + 1];
            for (int s : S) if (s <= x) {
                int v = g[x - s];
                if (v < seen.length) seen[v] = true;
            }
            g[x] = mex(seen);
        }
        return g;
    }

    static boolean firstWins(int[] S, int[] piles) {
        int mx = 0;
        for (int p : piles) mx = Math.max(mx, p);
        int[] g = grundyTable(mx, S);
        int x = 0;
        for (int p : piles) x ^= g[p];
        return x != 0;
    }

    public static void main(String[] args) {
        int[] S = {1, 2, 3};
        System.out.println(firstWins(S, new int[]{5, 6, 7})); // false
        System.out.println(firstWins(S, new int[]{4, 5}));    // true
    }
}
```

**Python.**
```python
def mex(seen):
    for i, v in enumerate(seen):
        if not v:
            return i
    return len(seen)


def grundy_table(n, S):
    g = [0] * (n + 1)
    for x in range(1, n + 1):
        seen = [False] * (len(S) + 1)
        for s in S:
            if s <= x:
                v = g[x - s]
                if v < len(seen):
                    seen[v] = True
        g[x] = mex(seen)
    return g


def first_wins(S, piles):
    g = grundy_table(max(piles), S)
    x = 0
    for p in piles:
        x ^= g[p]
    return x != 0


if __name__ == "__main__":
    S = [1, 2, 3]
    print(first_wins(S, [5, 6, 7]))  # False
    print(first_wins(S, [4, 5]))     # True
```

---

### Challenge 2: Grundy of a General Game (token on a DAG)

**Problem.** Given a DAG of positions (adjacency list of moves), compute the Grundy value of every position and report which are losing (Grundy `0`).

**Approach.** Memoized DFS: `g(v) = mex{ g(u) : v→u }`, terminal ⇒ `0`. `O(V + E)`.

**Go.**
```go
package main

import "fmt"

func grundyDAG(adj [][]int) []int {
	n := len(adj)
	g := make([]int, n)
	done := make([]bool, n)
	var dfs func(v int) int
	dfs = func(v int) int {
		if done[v] {
			return g[v]
		}
		done[v] = true
		seen := make([]bool, len(adj[v])+1)
		for _, u := range adj[v] {
			if gv := dfs(u); gv < len(seen) {
				seen[gv] = true
			}
		}
		i := 0
		for i < len(seen) && seen[i] {
			i++
		}
		g[v] = i
		return i
	}
	for v := 0; v < n; v++ {
		dfs(v)
	}
	return g
}

func main() {
	// 0->1, 0->2, 1->2, 2 terminal, 3->0
	adj := [][]int{{1, 2}, {2}, {}, {0}}
	g := grundyDAG(adj)
	fmt.Println("grundy:", g)
	for v, gv := range g {
		if gv == 0 {
			fmt.Printf("position %d is LOSING\n", v)
		}
	}
}
```

**Java.**
```java
import java.util.*;

public class GrundyDAG {
    static int[] g;
    static boolean[] done;
    static List<List<Integer>> adj;

    static int dfs(int v) {
        if (done[v]) return g[v];
        done[v] = true;
        boolean[] seen = new boolean[adj.get(v).size() + 1];
        for (int u : adj.get(v)) {
            int gv = dfs(u);
            if (gv < seen.length) seen[gv] = true;
        }
        int i = 0;
        while (i < seen.length && seen[i]) i++;
        g[v] = i;
        return i;
    }

    public static void main(String[] args) {
        int n = 4;
        adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        adj.get(0).addAll(Arrays.asList(1, 2));
        adj.get(1).add(2);
        adj.get(3).add(0);
        g = new int[n];
        done = new boolean[n];
        for (int v = 0; v < n; v++) dfs(v);
        System.out.println("grundy: " + Arrays.toString(g));
        for (int v = 0; v < n; v++) if (g[v] == 0)
            System.out.println("position " + v + " is LOSING");
    }
}
```

**Python.**
```python
import sys
sys.setrecursionlimit(1 << 20)


def grundy_dag(adj):
    n = len(adj)
    g = [None] * n

    def dfs(v):
        if g[v] is not None:
            return g[v]
        g[v] = 0  # placeholder guards against accidental re-entry on a DAG
        seen = set()
        for u in adj[v]:
            seen.add(dfs(u))
        i = 0
        while i in seen:
            i += 1
        g[v] = i
        return i

    for v in range(n):
        dfs(v)
    return g


if __name__ == "__main__":
    adj = [[1, 2], [2], [], [0]]
    g = grundy_dag(adj)
    print("grundy:", g)
    for v, gv in enumerate(g):
        if gv == 0:
            print(f"position {v} is LOSING")
```

---

### Challenge 3: Stone Game — Split into Unequal Piles (Grundy's game)

**Problem.** A pile of `n` stones; a move splits one pile into two piles of *different* sizes. Last to move wins. Given piles, decide if the first player wins.

**Approach.** `g(n) = mex{ g(a) ⊕ g(b) : a+b=n, a≠b, a,b≥1 }`; XOR the piles' Grundy values.

**Python.**
```python
def mex(s):
    i = 0
    while i in s:
        i += 1
    return i


def grundys_game(n):
    g = [0] * (n + 1)
    for x in range(n + 1):
        reach = set()
        for a in range(1, x):
            b = x - a
            if a != b:
                reach.add(g[a] ^ g[b])
        g[x] = mex(reach)
    return g


def first_wins(piles):
    g = grundys_game(max(piles))
    x = 0
    for p in piles:
        x ^= g[p]
    return x != 0


if __name__ == "__main__":
    print(grundys_game(10))         # [0,0,0,1,0,2,1,0,2,1,0]
    print(first_wins([8]))          # True (g[8]=2)
    print(first_wins([3, 3]))       # False (1^1=0)
```

**Go.**
```go
package main

import "fmt"

func mexSet(m map[int]bool) int {
	for i := 0; ; i++ {
		if !m[i] {
			return i
		}
	}
}

func grundysGame(n int) []int {
	g := make([]int, n+1)
	for x := 0; x <= n; x++ {
		reach := map[int]bool{}
		for a := 1; a < x; a++ {
			b := x - a
			if a != b {
				reach[g[a]^g[b]] = true
			}
		}
		g[x] = mexSet(reach)
	}
	return g
}

func firstWins(piles []int) bool {
	mx := 0
	for _, p := range piles {
		if p > mx {
			mx = p
		}
	}
	g := grundysGame(mx)
	x := 0
	for _, p := range piles {
		x ^= g[p]
	}
	return x != 0
}

func main() {
	fmt.Println(grundysGame(10)) // [0 0 0 1 0 2 1 0 2 1 0]
	fmt.Println(firstWins([]int{8}))    // true
	fmt.Println(firstWins([]int{3, 3})) // false
}
```

**Java.**
```java
import java.util.*;

public class GrundysGame {
    static int mex(Set<Integer> s) {
        int i = 0;
        while (s.contains(i)) i++;
        return i;
    }

    static int[] grundysGame(int n) {
        int[] g = new int[n + 1];
        for (int x = 0; x <= n; x++) {
            Set<Integer> reach = new HashSet<>();
            for (int a = 1; a < x; a++) {
                int b = x - a;
                if (a != b) reach.add(g[a] ^ g[b]);
            }
            g[x] = mex(reach);
        }
        return g;
    }

    static boolean firstWins(int[] piles) {
        int mx = 0;
        for (int p : piles) mx = Math.max(mx, p);
        int[] g = grundysGame(mx);
        int x = 0;
        for (int p : piles) x ^= g[p];
        return x != 0;
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(grundysGame(10)));
        System.out.println(firstWins(new int[]{8}));     // true
        System.out.println(firstWins(new int[]{3, 3}));  // false
    }
}
```

---

### Challenge 4: Coin Game with Periodicity for Huge n

**Problem.** Single pile, allowed removals `S`. Given a possibly enormous `n` (up to `10^18`), decide if the first player wins, using periodicity.

**Approach.** Tabulate to a safe bound, detect a full-window repeat (length `max(S)`), then `g[n] = g[n₀ + (n-n₀) mod π]`. First wins iff `g[n] ≠ 0`.

**Python.**
```python
def grundy_table(N, S):
    g = [0] * (N + 1)
    for x in range(1, N + 1):
        seen = set(g[x - s] for s in S if s <= x)
        i = 0
        while i in seen:
            i += 1
        g[x] = i
    return g


def find_period(g, maxS):
    for p in range(1, (len(g) - maxS) // 2):
        for n0 in range(len(g) - p - maxS + 1):
            if all(g[n0 + i] == g[n0 + p + i] for i in range(maxS)):
                return n0, p
    return None


def first_wins(n, S):
    maxS = max(S)
    N = min(n, 50 * maxS + 200)
    g = grundy_table(N, S)
    if n <= N:
        return g[n] != 0
    n0, p = find_period(g, maxS)
    return g[n0 + (n - n0) % p] != 0


if __name__ == "__main__":
    S = [1, 2, 3]
    print(first_wins(10**18, S))      # False (10^18 % 4 == 0)
    print(first_wins(10**18 + 1, S))  # True
```

**Go.**
```go
package main

import "fmt"

func grundyTable(N int, S []int) []int {
	g := make([]int, N+1)
	for x := 1; x <= N; x++ {
		seen := map[int]bool{}
		for _, s := range S {
			if s <= x {
				seen[g[x-s]] = true
			}
		}
		i := 0
		for seen[i] {
			i++
		}
		g[x] = i
	}
	return g
}

func findPeriod(g []int, maxS int) (int, int) {
	for p := 1; p < (len(g)-maxS)/2; p++ {
		for n0 := 0; n0+p+maxS <= len(g); n0++ {
			ok := true
			for i := 0; i < maxS; i++ {
				if g[n0+i] != g[n0+p+i] {
					ok = false
					break
				}
			}
			if ok {
				return n0, p
			}
		}
	}
	return 0, 0
}

func firstWins(n int64, S []int) bool {
	maxS := 0
	for _, s := range S {
		if s > maxS {
			maxS = s
		}
	}
	N := int64(50*maxS + 200)
	if n < N {
		N = n
	}
	g := grundyTable(int(N), S)
	if n <= N {
		return g[n] != 0
	}
	n0, p := findPeriod(g, maxS)
	return g[int64(n0)+(n-int64(n0))%int64(p)] != 0
}

func main() {
	S := []int{1, 2, 3}
	fmt.Println(firstWins(1_000_000_000_000_000_000, S))   // false
	fmt.Println(firstWins(1_000_000_000_000_000_001, S))   // true
}
```

**Java.**
```java
import java.util.*;

public class HugeCoinGame {
    static int[] table(int N, int[] S) {
        int[] g = new int[N + 1];
        for (int x = 1; x <= N; x++) {
            Set<Integer> seen = new HashSet<>();
            for (int s : S) if (s <= x) seen.add(g[x - s]);
            int i = 0;
            while (seen.contains(i)) i++;
            g[x] = i;
        }
        return g;
    }

    static int[] findPeriod(int[] g, int maxS) {
        for (int p = 1; p < (g.length - maxS) / 2; p++)
            for (int n0 = 0; n0 + p + maxS <= g.length; n0++) {
                boolean ok = true;
                for (int i = 0; i < maxS; i++)
                    if (g[n0 + i] != g[n0 + p + i]) { ok = false; break; }
                if (ok) return new int[]{n0, p};
            }
        return null;
    }

    static boolean firstWins(long n, int[] S) {
        int maxS = Arrays.stream(S).max().getAsInt();
        long N = Math.min(n, 50L * maxS + 200);
        int[] g = table((int) N, S);
        if (n <= N) return g[(int) n] != 0;
        int[] pr = findPeriod(g, maxS);
        int n0 = pr[0], p = pr[1];
        return g[(int) (n0 + (n - n0) % p)] != 0;
    }

    public static void main(String[] args) {
        int[] S = {1, 2, 3};
        System.out.println(firstWins(1_000_000_000_000_000_000L, S)); // false
        System.out.println(firstWins(1_000_000_000_000_000_001L, S)); // true
    }
}
```

---

## Final Tips

- Lead with the one-liner: *"`grundy(p) = mex` of children's Grundy values; `0` means the mover loses; sums combine by XOR."*
- Immediately flag the gotchas: **XOR not `+`**, **impartial + normal play only**, and **misère/partizan need other theory**.
- For compound games, reach for **decomposition** — Grundy each independent component, XOR, compare to `0`, and produce the constructive winning move.
- For splitting moves, remember the mex ranges over `g(a) ⊕ g(b)`.
- For huge `n` in a subtraction game, mention **eventual periodicity** (or a closed form) and certify it with a full-window match.
- Always offer to verify against a brute-force win/loss oracle: `grundy == 0` iff losing.
