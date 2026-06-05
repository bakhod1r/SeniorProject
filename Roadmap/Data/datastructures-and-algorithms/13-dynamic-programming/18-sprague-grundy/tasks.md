# Sprague-Grundy Theorem and Grundy Numbers — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Grundy / mex logic and validate against the evaluation criteria.
> **Always test against a brute-force win/loss oracle on small inputs: `grundy(p) == 0` must equal "the mover loses" for every small position.**

---

## Beginner Tasks (5)

### Task 1 — Implement mex

**Problem.** Implement `mex(values)` returning the smallest non-negative integer not present in `values`. `mex({}) = 0`, `mex({0,1,3}) = 2`, `mex({1,2}) = 0`.

**Input / Output spec.**
- Read `m`, then `m` integers.
- Print the single integer `mex`.

**Constraints.**
- `0 ≤ m ≤ 10^5`, values are non-negative.
- Target `O(m)` time using a boolean array sized by `m`.

**Hint.** The mex is at most `m`, so a boolean array of length `m+1` suffices; mark seen values in range, then scan for the first gap.

**Starter — Go.**
```go
package main

import "fmt"

func mex(values []int) int {
	// TODO: boolean array sized len(values)+1; mark; scan first gap
	return 0
}

func main() {
	var m int
	fmt.Scan(&m)
	vals := make([]int, m)
	for i := range vals {
		fmt.Scan(&vals[i])
	}
	fmt.Println(mex(vals))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    static int mex(int[] values) {
        // TODO
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int m = sc.nextInt();
        int[] vals = new int[m];
        for (int i = 0; i < m; i++) vals[i] = sc.nextInt();
        System.out.println(mex(vals));
    }
}
```

**Starter — Python.**
```python
import sys


def mex(values):
    # TODO
    return 0


def main():
    data = iter(sys.stdin.read().split())
    m = int(next(data))
    vals = [int(next(data)) for _ in range(m)]
    print(mex(vals))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct on the three examples above.
- `O(m)` time, no sorting needed.
- Handles the empty input (`mex = 0`).

---

### Task 2 — Grundy table for a subtraction game

**Problem.** Given an allowed removal set `S` and a bound `n`, output `g[0..n]` for the subtraction game (remove `s ∈ S` from a single pile; last to move wins).

**Input / Output spec.**
- Read `n`, then `|S|`, then the elements of `S`.
- Print `g[0], …, g[n]` space-separated.

**Constraints.** `0 ≤ n ≤ 10^5`, `1 ≤ |S| ≤ 20`.

**Hint.** `g[0] = 0`; `g[x] = mex{ g[x-s] : s ∈ S, s ≤ x }`. Size the mex array by `|S|`.

**Reference oracle (Python) — use this to validate.**
```python
from functools import lru_cache


def brute_win(n, S):
    S = tuple(S)
    @lru_cache(maxsize=None)
    def win(x):
        return any(not win(x - s) for s in S if s <= x)
    return win(n)
# grundy(n) == 0  <=>  not brute_win(n)
```

**Evaluation criteria.**
- For `S = {1,2,3}`, prints `0 1 2 3 0 1 2 3 …` (period 4).
- `g[x] == 0` iff `brute_win(x)` is `False`, for all small `x`.
- `O(n·|S|)`.

---

### Task 3 — Decide a sum of subtraction-game piles

**Problem.** Given `S` and an array of pile sizes, decide whether the **first** player wins the disjunctive subtraction game by XOR-ing the piles' Grundy values.

**Input / Output spec.**
- Read `|S|`, the set `S`, then `m` and the `m` pile sizes.
- Print `FIRST` or `SECOND`.

**Constraints.** `1 ≤ m ≤ 10^4`, pile sizes `≤ 10^5`, `1 ≤ |S| ≤ 20`.

**Hint.** Build the Grundy table to the max pile, then `x = ⊕ g[pile]`; first wins iff `x ≠ 0`. Use XOR, never `+`.

**Worked check.** For `S = {1,2,3}`, piles `{5,6,7}`: `g = {1,2,3}`, `XOR = 0` → `SECOND`. Piles `{4,5}`: `g = {0,1}`, `XOR = 1` → `FIRST`.

**Evaluation criteria.**
- Matches the worked check.
- Combines by XOR (a `+` implementation fails the check).
- `O(maxPile·|S| + m)`.

---

### Task 4 — Grundy of a token on a DAG

**Problem.** Given a DAG of positions (adjacency list of moves), output the Grundy value of each vertex and list the losing vertices (Grundy `0`). A token sits on a vertex; a move slides it along an out-edge; last to move wins.

**Input / Output spec.**
- Read `V`, `E`, then `E` directed edges `u v` (move `u → v`).
- Print `V` Grundy values, then the indices with Grundy `0`.

**Constraints.** `1 ≤ V ≤ 10^5`, `0 ≤ E ≤ 5·10^5`, graph is acyclic.

**Hint.** `g(v) = mex{ g(u) : v→u }`, terminal ⇒ `0`. Memoized DFS or reverse-topological order. `O(V + E)`.

**Evaluation criteria.**
- Terminal vertices have Grundy `0`.
- Matches a brute-force win/loss DFS (`g == 0` iff losing).
- Detects/assumes acyclicity (no infinite recursion).

---

### Task 5 — Take-1..k closed form

**Problem.** For the subtraction game `S = {1, 2, …, k}` (remove between `1` and `k`), answer `Q` queries each `(n)`: does the first player win? Use the closed form `g[n] = n mod (k+1)` rather than a table.

**Input / Output spec.**
- Read `k`, `Q`, then `Q` values of `n` (each up to `10^18`).
- For each, print `FIRST` (if `n mod (k+1) ≠ 0`) or `SECOND`.

**Constraints.** `1 ≤ k ≤ 10^9`, `1 ≤ Q ≤ 10^5`, `0 ≤ n ≤ 10^18`.

**Hint.** Losing positions are exactly multiples of `k+1`. `O(1)` per query — no table.

**Evaluation criteria.**
- `n = 0` → `SECOND` (terminal, losing).
- Correct for huge `n` (uses modulo, not a table).
- Matches a tabulated Grundy table for small `n`.

---

## Intermediate Tasks (5)

### Task 6 — Grundy's game (split into unequal piles)

**Problem.** A move splits one pile into two piles of *different* sizes. Given pile sizes, decide if the first player wins. Use `g(n) = mex{ g(a) ⊕ g(b) : a+b=n, a≠b, a,b≥1 }`.

**Constraints.** `1 ≤ m ≤ 100`, pile sizes `≤ 2000`.

**Hint.** A split makes a *sum*, so the mex ranges over `g(a) ⊕ g(b)` — not over single piles. Then XOR the input piles. Verify `g[0..8] = 0,0,0,1,0,2,1,0,2`.

**Reference oracle (Python).**
```python
from functools import lru_cache


def brute_win_grundys(n):
    @lru_cache(maxsize=None)
    def win(x):
        # split x into a != b, both >= 1; the resulting sum is a position (a,b)
        for a in range(1, x):
            b = x - a
            if a != b and not win_sum((a, b)):
                return True
        return False

    @lru_cache(maxsize=None)
    def win_sum(piles):
        for i, p in enumerate(piles):
            for a in range(1, p):
                b = p - a
                if a != b:
                    nxt = piles[:i] + (a, b) + piles[i + 1:]
                    if not win_sum(nxt):
                        return True
        return False
    return win((n,)) if False else win(n)
```

**Evaluation criteria.**
- `g[0..8] = 0,0,0,1,0,2,1,0,2`.
- Single pile `8` → first wins (`g[8] = 2`); piles `{3,3}` → second wins (`1^1 = 0`).
- Uses mex-over-XOR, not mex over single children.

---

### Task 7 — Staircase Nim

**Problem.** Coins sit on steps `1..k` (`c[i]` coins on step `i`). A move slides any positive number of coins from step `i` to step `i-1`; coins on step `0` are out of play; last to move wins. Decide if the first player wins.

**Input / Output spec.**
- Read `k`, then `c[1..k]`.
- Print `FIRST` or `SECOND`.

**Constraints.** `1 ≤ k ≤ 10^5`, `0 ≤ c[i] ≤ 10^9`.

**Hint.** The game is equivalent to Nim on the coins at **odd** steps: `XOR of c[i] for odd i`. First wins iff that XOR `≠ 0`.

**Reference oracle (Python).**
```python
def staircase_first_wins(c):  # c is 1-indexed list c[1..k]
    x = 0
    for i in range(1, len(c)):
        if i % 2 == 1:
            x ^= c[i]
    return x != 0
```

**Evaluation criteria.**
- Uses only odd-step coin counts.
- Matches a small brute-force game simulation.
- `O(k)`.

---

### Task 8 — Count length-k binary strings avoiding "11" via game framing

**Problem.** (Bridge to combinatorics.) Implement the subtraction game `S = {1, 2}` ("Nim with take 1 or 2"), output `g[0..n]`, and confirm `g[n] = n mod 3`. Then decide a sum of piles. This take-1-or-2 game's losing positions are the multiples of 3.

**Constraints.** `0 ≤ n ≤ 10^6`, pile sizes `≤ n`.

**Hint.** `g[x] = mex{ g[x-1], g[x-2] }`. The pattern is `0 1 2 0 1 2 …`. Losing iff `3 | x`.

**Reference oracle (Python).**
```python
def grundy_take12(n):
    g = [0] * (n + 1)
    for x in range(1, n + 1):
        seen = set()
        if x >= 1:
            seen.add(g[x - 1])
        if x >= 2:
            seen.add(g[x - 2])
        i = 0
        while i in seen:
            i += 1
        g[x] = i
    return g
# grundy_take12(6) == [0,1,2,0,1,2,0]
```

**Evaluation criteria.**
- `g[0..6] = 0,1,2,0,1,2,0`.
- Confirms `g[n] == n % 3`.
- A sum of piles is decided by XOR of `g[pile]`.

---

### Task 9 — Generic memoized Grundy engine

**Problem.** Implement a reusable `grundy(state, successors)` that memoizes by a canonical state key and computes `mex` of successors' Grundy values. Demonstrate it on a subtraction game with `S = {1,3,4}` and on a two-pile state `(a, b)` where a move reduces either pile by any positive amount (this is 2-pile Nim, so `g((a,b)) = a ⊕ b`).

**Constraints.** `1 ≤ a, b ≤ 100` for the Nim demo; subtraction `n ≤ 1000`.

**Hint.** Canonicalize the Nim state by sorting `(a, b)`. Verify `grundy((a, b)) == a ^ b` for all small `a, b`.

**Evaluation criteria.**
- The Nim demo produces `g((a,b)) == a ^ b` for all small `a, b`.
- The subtraction demo matches a direct table.
- States are canonicalized so symmetric positions share a cache entry.

---

### Task 10 — Constructive winning move in a sum

**Problem.** Given the Grundy values `g[1..m]` of `m` independent components (each equivalent to a Nim pile) with total XOR `x ≠ 0`, output a winning move: the component index `i` to move in and the target Grundy value `t = g[i] ⊕ x` (with `t < g[i]`).

**Input / Output spec.**
- Read `m`, then `g[1..m]`.
- If `XOR == 0`, print `LOSING`. Else print `i t` (1-indexed component and target value).

**Constraints.** `1 ≤ m ≤ 10^5`, `0 ≤ g[i] ≤ 10^9`.

**Hint.** `h` = highest set bit of `x`; pick any `i` with bit `h` set in `g[i]`; target `t = g[i] ⊕ x`, guaranteed `< g[i]`.

**Evaluation criteria.**
- Returns `LOSING` exactly when `XOR == 0`.
- The chosen `t` satisfies `t < g[i]` and makes the new XOR `0`.
- Matches the Nim winning-move construction for plain Nim piles.

---

## Advanced Tasks (5)

### Task 11 — Periodicity for huge n with full-window certification

**Problem.** For a subtraction game with set `S`, answer `Q` queries `(n)` with `n` up to `10^18`. Detect eventual periodicity, certify it with a **full window of length `max(S)`**, then answer each query in `O(1)`.

**Constraints.** `1 ≤ |S| ≤ 12`, `1 ≤ Q ≤ 10^5`, `0 ≤ n ≤ 10^18`.

**Hint.** Tabulate to `~50·max(S)+200`; find `(n₀, π)` such that `g[n₀+i] == g[n₀+π+i]` for all `0 ≤ i < max(S)`. That single full-window match guarantees periodicity forever (professional §8). Then `g[n] = g[n₀ + (n−n₀) mod π]`.

**Evaluation criteria.**
- Certifies the period by matching a full window of length `max(S)`, not a few terms.
- Correct for `n` far beyond the table (e.g. `10^18`).
- Matches a tabulated value for moderate `n`.

---

### Task 12 — Kayles (split-row game)

**Problem.** A row of `n` pins; a move removes `1` or `2` *adjacent* pins, splitting the row into two independent rows. Last to move wins. Compute the single-row Grundy values `g[0..n]` and decide a position given as a list of segment lengths.

**Constraints.** `1 ≤ n ≤ 5000`, segments sum `≤ 5000`.

**Hint.** Removing 1 pin at position `i` splits into rows `i` and `n-1-i`; removing 2 adjacent at `i` splits into `i` and `n-2-i`. So `g[n] = mex{ g[i] ⊕ g[n-1-i] } ∪ { g[i] ⊕ g[n-2-i] }`. Then a position is the XOR over its segment Grundy values. Kayles is eventually periodic with period 12.

**Reference oracle (Python).**
```python
def kayles(n):
    g = [0] * (n + 1)
    for x in range(1, n + 1):
        reach = set()
        for i in range(x):           # remove 1 pin at i
            reach.add(g[i] ^ g[x - 1 - i])
        for i in range(x - 1):       # remove 2 adjacent at i,i+1
            reach.add(g[i] ^ g[x - 2 - i])
        j = 0
        while j in reach:
            j += 1
        g[x] = j
    return g
# kayles(8) == [0,1,2,3,1,4,3,2,1]
```

**Evaluation criteria.**
- `kayles(8) = [0,1,2,3,1,4,3,2,1]`.
- A position (segments) is decided by XOR over `g[segment]`.
- Matches a brute-force win/loss simulation for small boards.

---

### Task 13 — Misère Nim

**Problem.** Implement misère Nim (last to move **loses**) using Bouton's misère rule, and contrast it with normal Nim on the same input.

**Input / Output spec.**
- Read `m`, then `m` pile sizes.
- Print two lines: `NORMAL: FIRST/SECOND` and `MISERE: FIRST/SECOND`.

**Constraints.** `1 ≤ m ≤ 10^5`, pile sizes `≤ 10^9`.

**Hint.** Normal: first wins iff `XOR ≠ 0`. Misère: if **every** pile is `≤ 1`, first wins iff the number of `1`-piles is **even** (so that the mover does not make the last move)... precisely: with all piles `≤ 1`, the position is a first-player win iff the count of size-1 piles is *even*. Otherwise (some pile `≥ 2`), first wins iff `XOR ≠ 0` — same as normal.

**Reference oracle (Python).**
```python
def misere_first_wins(piles):
    if all(p <= 1 for p in piles):
        ones = sum(1 for p in piles if p == 1)
        return ones % 2 == 0           # mover wins iff even number of 1-piles
    x = 0
    for p in piles:
        x ^= p
    return x != 0
```

**Evaluation criteria.**
- Normal and misère agree when some pile `≥ 2`.
- They differ in the all-small endgame (e.g. three 1-piles: normal FIRST, misère depends on parity).
- Matches a brute-force misère game simulation for small inputs.

---

### Task 14 — Coin-turning game (single-coin decomposition)

**Problem.** "Turning Turtles": a row of `n` coins (heads/tails). A move turns one or two coins, and the **rightmost** coin turned must go heads→tails. Last to move wins. Decide the winner from a heads/tails string.

**Constraints.** `1 ≤ n ≤ 10^5`.

**Hint.** The single-coin Grundy value at position `i` (0-indexed) for this game is `i + 1` (turning the single head at `i`, optionally flipping one coin to its left). The whole position's Grundy is the XOR of `(i+1)` over all head positions. First wins iff that XOR `≠ 0`.

**Reference oracle (Python).**
```python
def turning_turtles_first_wins(s):     # s is a string of 'H'/'T'
    x = 0
    for i, ch in enumerate(s):
        if ch == 'H':
            x ^= (i + 1)               # single-coin Grundy value at position i
    return x != 0
```

**Evaluation criteria.**
- Uses single-coin decomposition (XOR over head positions), not a `2^n` search.
- Matches a brute-force game simulation for small `n`.
- Correctly returns `SECOND` for the all-tails terminal position.

---

### Task 15 — Classify the game / pick the right tool

**Problem.** Given a problem description's parameters `(impartial?, normal_play?, decomposable?, huge_n?, has_closed_form?, coupled_move?)`, return one of: `GRUNDY_XOR` (decompose + XOR), `GRUNDY_TABLE` (single game, tabulate), `PERIODICITY` (huge `n`, periodic), `CLOSED_FORM`, `MISERE_SPECIAL` (misère), or `NOT_APPLICABLE` (partizan / loopy / scored / chance). Justify each.

**Constraints / cases to handle.**
- Impartial, normal, decomposable → `GRUNDY_XOR`.
- Impartial, normal, single game, small `n` → `GRUNDY_TABLE`.
- Impartial, normal, subtraction game, huge `n`, no closed form → `PERIODICITY`.
- Take-`1..k`, huge `n` → `CLOSED_FORM` (`n mod (k+1)`).
- Misère → `MISERE_SPECIAL`.
- Partizan / loopy / scored / chance → `NOT_APPLICABLE`.

**Hint.** Encode the decision rules from `middle.md` and `senior.md`. The traps: misère (flips the verdict) and partizan/loopy/scored (no Grundy number at all).

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `NOT_APPLICABLE` branch explicitly names *why* (partizan = different moves; loopy = no DAG; scored/chance = outside the theory).
- Justification references the right complexity (`O(V+E)`, `O(n·|S|)`, `O(period)`, `O(1)`).

---

## Benchmark Task

### Task B — Monolithic search vs Grundy decomposition crossover

**Problem.** Empirically compare two ways to decide a disjunctive subtraction game with `m` piles each up to `n`:

- **(a) Monolithic win/loss search:** memoize win/loss on the full tuple state `(p₁,…,p_m)` — state space `≈ (n+1)^m`.
- **(b) Grundy decomposition:** compute the 1-D Grundy table once `O(n·|S|)`, then XOR the `m` piles `O(m)`.

Measure wall-clock time for fixed `S = {1,2,3}` across `m ∈ {1,2,3,4,5}` with `n = 8`, and report where the monolithic approach becomes infeasible.

**Starter — Python.**
```python
import time
from functools import lru_cache
from typing import List

S = (1, 2, 3)


def grundy_table(n: int) -> List[int]:
    g = [0] * (n + 1)
    for x in range(1, n + 1):
        seen = set(g[x - s] for s in S if s <= x)
        i = 0
        while i in seen:
            i += 1
        g[x] = i
    return g


def decompose_first_wins(piles: List[int]) -> bool:
    g = grundy_table(max(piles))
    x = 0
    for p in piles:
        x ^= g[p]
    return x != 0


def monolithic_first_wins(piles):
    @lru_cache(maxsize=None)
    def win(state):
        for i, p in enumerate(state):
            for s in S:
                if s <= p:
                    nxt = state[:i] + (p - s,) + state[i + 1:]
                    if not win(nxt):
                        return True
        return False
    return win(tuple(piles))


def bench(fn, piles) -> float:
    start = time.perf_counter()
    fn(piles)
    return time.perf_counter() - start


def main() -> None:
    n = 8
    print("m   monolithic_ms   decompose_ms")
    for m in range(1, 6):
        piles = [n] * m
        td = bench(decompose_first_wins, piles) * 1000
        tm = bench(monolithic_first_wins, piles) * 1000
        print(f"{m}   {tm:<14.3f} {td:<12.3f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Both methods agree on the winner for every tested `(m, n)`.
- Decomposition time barely grows with `m`; monolithic time grows like `(n+1)^m`.
- Report the `m` at which the monolithic search becomes impractical (memory/time).
- Same fixed `S` and `n` produce identical winners across Go, Java, and Python.
- Writeup: a short note that decomposition converts a product state space `(n+1)^m` into `O(n·|S| + m)`.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every win/loss task above ships with (or references) a slow memoized win/loss recursion. Run it on small piles, assert `grundy == 0` iff "losing," and only then trust the fast version.
- **XOR, never `+`.** Disjunctive sums of impartial games combine by bitwise XOR. Writing `acc += g[...]` is the single most common bug.
- **Get the base case right.** A terminal position (no moves) has Grundy `0` — `mex{} = 0`. Returning anything else corrupts the whole table.
- **mex is the smallest *missing* value**, not `max + 1`. Size the mex scratch array by the branching factor.
- **Splitting moves create sums.** A move that splits a region contributes `g(a) ⊕ g(b)` to the mex set.
- **Pin the convention.** Normal play (last to move wins) is the default; misère (last move loses) needs the special rule (Task 13). Partizan / loopy / scored / chance games are out of scope (Task 15).
- **Certify periodicity with a full window** of length `max(S)` before trusting huge-`n` lookups (Task 11).
- **Canonicalize states** (sort piles, normalize orientation) so symmetric positions share a memo entry.

Each task must be implemented and tested in **Go, Java, and Python**, with identical winners across all three on the same inputs.
