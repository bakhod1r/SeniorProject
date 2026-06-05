# Nim and Impartial Game Theory Basics — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code or a precise spec in all three languages. Implement the Nim / Grundy logic and validate against the evaluation criteria.
> **Always test against a brute-force memoized game solver on small inputs before trusting a closed-form rule.**

---

## Beginner Tasks (5)

### Task 1 — Compute the Nim-sum

**Problem.** Read `n` pile sizes and print their **Nim-sum** (the bitwise XOR of all sizes). This is the single number that decides standard Nim.

**Input / Output spec.**
- Read `n`, then `n` integers `p₀ … p_{n-1}`.
- Print the Nim-sum `p₀ ^ p₁ ^ … ^ p_{n-1}`.

**Constraints.**
- `1 ≤ n ≤ 10^6`, `0 ≤ pᵢ ≤ 10^18`.
- Use 64-bit integers.

**Hint.** Initialize `x = 0`, then `x ^= p` for every pile. Order does not matter.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(reader, &n)
	var x int64
	for i := 0; i < n; i++ {
		var p int64
		fmt.Fscan(reader, &p)
		// TODO: x ^= p
	}
	fmt.Println(x)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long x = 0;
        for (int i = 0; i < n; i++) {
            long p = sc.nextLong();
            // TODO: x ^= p;
        }
        System.out.println(x);
    }
}
```

**Starter — Python.**
```python
import sys


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    x = 0
    for i in range(1, n + 1):
        p = int(data[i])
        # TODO: x ^= p
    print(x)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correct XOR (not arithmetic sum), verified on `[3,4,5] -> 2`.
- Handles `0` piles correctly (they contribute `0`).
- `O(n)`.

---

### Task 2 — Decide the Nim winner (normal play)

**Problem.** Given pile sizes, print `FIRST` if the player to move wins, else `SECOND`. Use Bouton's theorem.

**Input / Output spec.**
- Read `n`, then the piles.
- Print `FIRST` (Nim-sum `≠ 0`) or `SECOND` (Nim-sum `= 0`).

**Constraints.** `1 ≤ n ≤ 10^6`, `0 ≤ pᵢ ≤ 10^18`.

**Hint.** Mover wins iff the Nim-sum is nonzero.

**Reference oracle (Python) — use this to validate on small inputs.**
```python
from functools import lru_cache


def brute_wins(piles):
    @lru_cache(maxsize=None)
    def win(state):
        if all(p == 0 for p in state):
            return False                      # no move -> lose (normal play)
        for i, p in enumerate(state):
            for take in range(1, p + 1):
                nxt = list(state)
                nxt[i] = p - take
                if not win(tuple(sorted(nxt))):
                    return True
        return False
    return win(tuple(sorted(piles)))
```

**Evaluation criteria.**
- `[1,1] -> SECOND`, `[3,4,5] -> FIRST`.
- Matches `brute_wins` for all positions with `n ≤ 3` and piles `≤ 4`.
- `O(n)`.

---

### Task 3 — Output the winning move

**Problem.** Given a winning Nim position (Nim-sum `≠ 0`), output one winning move as `pileIndex newValue` (set pile `pileIndex` to `newValue`, making the Nim-sum `0`). If the position is losing, print `NO MOVE`.

**Input / Output spec.**
- Read `n`, then the piles.
- Print `pileIndex newValue` or `NO MOVE`.

**Constraints.** `1 ≤ n ≤ 10^6`, `0 ≤ pᵢ ≤ 10^18`.

**Hint.** Let `X` be the Nim-sum. Find the first pile `p` with `p ^ X < p`; the move is `(i, p ^ X)`.

**Worked check.** For `[3,4,5]`, `X = 2`; pile `0 (=3)` has `3 ^ 2 = 1 < 3`, so output `0 1`. Verify `1 ^ 4 ^ 5 = 0`.

**Evaluation criteria.**
- The emitted move strictly decreases exactly one pile.
- After the move, the Nim-sum is `0` (assert this).
- Prints `NO MOVE` exactly when the Nim-sum is `0`.

---

### Task 4 — Misère Nim winner

**Problem.** Decide the winner of **misère** Nim (last stone taken **loses**). Print `FIRST` or `SECOND`.

**Input / Output spec.**
- Read `n`, then the piles.
- Print the winner.

**Constraints.** `1 ≤ n ≤ 10^6`, `0 ≤ pᵢ ≤ 10^18`.

**Hint.** If every nonempty pile is size 1: `FIRST` wins iff the count of 1-piles is **even**. Otherwise use the normal XOR rule (`FIRST` iff Nim-sum `≠ 0`).

**Reference oracle (Python).**
```python
from functools import lru_cache


def brute_misere(piles):
    @lru_cache(maxsize=None)
    def win(state):
        if all(p == 0 for p in state):
            return True                       # no move -> WIN (misere)
        for i, p in enumerate(state):
            for take in range(1, p + 1):
                nxt = list(state)
                nxt[i] = p - take
                if not win(tuple(sorted(nxt))):
                    return True
        return False
    return win(tuple(sorted(piles)))
```

**Evaluation criteria.**
- `[1,1,1] -> SECOND`, `[1,2,3] -> SECOND`, `[1,2,2] -> FIRST`.
- Matches `brute_misere` for all small positions.
- `O(n)`.

---

### Task 5 — Single Nim pile

**Problem.** Given a single pile of size `s`, print whether the mover wins (normal play) and, if so, the winning move (take all `s` stones).

**Input / Output spec.**
- Read `s`. Print `WIN s` (take `s` stones to reach 0) or `LOSE` (when `s = 0`).

**Constraints.** `0 ≤ s ≤ 10^18`.

**Hint.** Nim-sum of one pile is `s`. Mover wins iff `s ≠ 0`, by taking the whole pile.

**Evaluation criteria.**
- `s = 0 -> LOSE`; `s = 7 -> WIN 7`.
- `O(1)`.

---

## Intermediate Tasks (5)

### Task 6 — Subtraction game: max-take m

**Problem.** Each move removes `1` to `m` stones from one pile. Decide the winner (normal play), print `FIRST` or `SECOND`.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ pᵢ ≤ 10^18`, `1 ≤ m ≤ 10^9`.

**Hint.** Grundy of a pile is `pᵢ mod (m+1)`. XOR them; `FIRST` wins iff the XOR is nonzero. Verify the per-pile closed form against the `mex` DP for small piles.

**Reference oracle (Python).**
```python
from functools import lru_cache


def brute_maxtake(piles, m):
    @lru_cache(maxsize=None)
    def win(state):
        if all(p == 0 for p in state):
            return False
        for i, p in enumerate(state):
            for take in range(1, min(p, m) + 1):
                nxt = list(state)
                nxt[i] = p - take
                if not win(tuple(sorted(nxt))):
                    return True
        return False
    return win(tuple(sorted(piles)))
```

**Evaluation criteria.**
- `[4,8], m=3 -> SECOND`; `[5,8], m=3 -> FIRST`.
- Matches `brute_maxtake` for small piles.
- `O(n)`.

---

### Task 7 — Grundy table for an arbitrary subtraction set

**Problem.** Given a finite subtraction set `S` (allowed takes) and a max size `N`, compute the Grundy sequence `g(0..N)` using `mex`, and print it.

**Constraints.** `1 ≤ |S| ≤ 20`, `1 ≤ N ≤ 10^5`, takes in `[1, N]`.

**Hint.** `g(0) = 0`; `g(s) = mex { g(s - t) : t ∈ S, t ≤ s }`. Use a set/boolean array for `mex`.

**Worked check.** For `S = {1, 2}`, `g = 0,1,2,0,1,2,…` (period 3); P-positions are multiples of 3.

**Evaluation criteria.**
- For `S = {1,2,3}`, `g(s) = s mod 4`.
- For `S = {1,3,4}`, the sequence is eventually periodic; print at least one full period.
- `O(N · |S|)`.

---

### Task 8 — Detect the period of a Grundy sequence

**Problem.** Given a finite subtraction set `S`, compute a generous Grundy prefix, detect the pre-period `λ` and period `π`, and then answer `q` queries for `g(sᵢ)` with `sᵢ` up to `10^18` in `O(1)` each.

**Constraints.** `1 ≤ |S| ≤ 20`, `1 ≤ q ≤ 10^5`, `sᵢ ≤ 10^18`.

**Hint.** A safe prefix length is a few times `(max take)²`. Detect the smallest `π` such that `g[i] == g[i+π]` for all `i ≥ λ` in the prefix. Then `g(s) = g[λ + (s - λ) mod π]` for `s ≥ λ`.

**Reference period-detector (Python).**
```python
def detect_period(seq):
    n = len(seq)
    for lam in range(n):
        for pi in range(1, (n - lam) // 2 + 1):
            if all(seq[i] == seq[i + pi] for i in range(lam, n - pi)):
                return lam, pi
    return 0, n
```

**Evaluation criteria.**
- Correct `g(sᵢ)` for huge `sᵢ` against the periodic formula.
- For `S = {1,2,3}`, period `4`, pre-period `0`.
- Each query `O(1)` after precompute.

---

### Task 9 — Moore's Nimₖ winner

**Problem.** A move removes stones from up to `k` piles at once (at least one). Decide the winner (normal play). Print `FIRST` or `SECOND`.

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ pᵢ ≤ 10^18`, `1 ≤ k ≤ 10`.

**Hint.** `SECOND` (P-position) iff for **every** bit position the count of piles with a `1` there is divisible by `(k+1)`. Otherwise `FIRST`.

**Reference oracle (Python, small k and piles).**
```python
from functools import lru_cache
from itertools import combinations


def brute_moore(piles, k):
    @lru_cache(maxsize=None)
    def win(state):
        if all(p == 0 for p in state):
            return False
        idxs = [i for i, p in enumerate(state) if p > 0]
        for r in range(1, min(k, len(idxs)) + 1):
            for chosen in combinations(idxs, r):
                # each chosen pile must lose >=1 stone; enumerate reductions
                ranges = [range(state[i]) for i in chosen]  # new value < old
                from itertools import product
                for newvals in product(*ranges):
                    nxt = list(state)
                    for ci, nv in zip(chosen, newvals):
                        nxt[ci] = nv
                    if not win(tuple(sorted(nxt))):
                        return True
        return False
    return win(tuple(sorted(piles)))
```

**Evaluation criteria.**
- For `k = 1`, agrees with the ordinary XOR rule.
- Matches `brute_moore` for tiny piles and small `k`.
- `O(n · bits)`.

---

### Task 10 — Win/loss DP for a single-pile game

**Problem.** Given a move function `moves(s)` (a set of reachable new sizes from a pile of size `s`), build the win/loss table `win[0..N]` for a single pile under normal play, and print the P-positions (`win[s] == False`).

**Constraints.** `1 ≤ N ≤ 10^6`, `moves(s)` returns `O(deg)` states.

**Hint.** `win[s] = any(not win[t] for t in moves(s))`. P-positions are where `win[s]` is `False`.

**Evaluation criteria.**
- For standard Nim (`moves(s) = {0,…,s-1}`), the only P-position is `0`.
- For max-take `2` (`moves(s) = {s-1, s-2}`), P-positions are multiples of 3.
- Matches the Grundy table thresholded at `g(s) == 0`.

---

## Advanced Tasks (5)

### Task 11 — General impartial game solver (Grundy + XOR)

**Problem.** Implement a generic solver: given a single-component move generator `moves(state)` and a list of independent component states, compute each component's Grundy value (memoized by canonical state) and decide the disjunctive-sum winner by XOR.

**Constraints.** Components small enough to compute Grundy by recursion + memo; up to `10^4` components.

**Hint.** `grundy(state) = mex { grundy(c) : c in moves(state) }`. The overall position is a P-position iff `XOR of component Grundy values == 0`. Combine **Grundy numbers**, never win/loss booleans.

**Evaluation criteria.**
- Reproduces standard Nim (`grundy(pile s) = s`).
- Reproduces max-take and at least one split game (e.g. "split a pile into two unequal parts").
- Correctly XORs component Grundy values; documents why booleans cannot be combined.

---

### Task 12 — Grundy's game (split into two unequal piles)

**Problem.** A move splits one pile into two **unequal** nonempty piles (you cannot split a pile of size `< 3`). Decide the winner for given pile sizes (normal play). Use Grundy numbers.

**Constraints.** `1 ≤ n ≤ 50`, `0 ≤ pᵢ ≤ 2000`.

**Hint.** `grundy(s) = mex { grundy(a) ^ grundy(b) : a + b = s, a < b, a ≥ 1 }` for `s ≥ 3`, else `grundy(s) = 0` (no move). The position's value is the XOR of `grundy(pᵢ)`. Note: Grundy's game is *not* known to be eventually periodic — compute the table up to your bound.

**Reference (Python).**
```python
def grundy_split(N):
    g = [0] * (N + 1)
    for s in range(3, N + 1):
        reachable = set()
        for a in range(1, s):
            b = s - a
            if a < b:
                reachable.add(g[a] ^ g[b])
        m = 0
        while m in reachable:
            m += 1
        g[s] = m
    return g
```

**Evaluation criteria.**
- `grundy(1) = grundy(2) = 0`; small values match a brute-force solver.
- The multi-pile decision XORs `grundy(pᵢ)`.
- Documents that periodicity is an open question for this game.

---

### Task 13 — Staircase Nim

**Problem.** Stones on stairs `0..m`; a move slides ≥ 1 stones from stair `i ≥ 1` to stair `i−1`; stair 0 is the exit. Decide the winner (normal play) and, if `FIRST` wins, output a winning move `(fromStair, count)`.

**Constraints.** `1 ≤ m+1 ≤ 10^5`, `0 ≤ stairs[i] ≤ 10^18`.

**Hint.** Equivalent to Nim on **odd** stairs: `X = XOR of stairs at odd indices`. `FIRST` wins iff `X ≠ 0`. The winning move treats odd stairs as Nim piles: pick an odd stair `i` with `(stairs[i] ^ X) < stairs[i]`, slide `stairs[i] - (stairs[i] ^ X)` stones down to stair `i−1`.

**Reference oracle (Python, small).**
```python
from functools import lru_cache


def brute_staircase(stairs):
    @lru_cache(maxsize=None)
    def win(state):
        moved = False
        for i in range(1, len(state)):
            for cnt in range(1, state[i] + 1):
                nxt = list(state)
                nxt[i] -= cnt
                nxt[i - 1] += cnt
                moved = True
                if not win(tuple(nxt)):
                    return True
        return False if moved else False
    return win(tuple(stairs))
```

**Evaluation criteria.**
- `[0,3,0,4] -> FIRST`; `[5,2,0,2] -> SECOND`.
- The emitted move uses only odd stairs and reduces the odd-stair XOR to `0`.
- Matches `brute_staircase` for small inputs.

---

### Task 14 — Closed form vs brute-force reconciliation harness

**Problem.** Build a test harness that, for a chosen game (standard Nim, misère Nim, max-take), enumerates **all** positions with `n ≤ 3` piles and sizes `≤ 5`, and asserts the closed-form verdict equals the brute-force oracle verdict. Report any mismatch.

**Constraints.** Exhaustive over the small space; must finish quickly.

**Hint.** Loop over `itertools.product(range(6), repeat=3)` (Python), call both the closed form and the oracle, compare. A single mismatch usually means a normal/misère or move-set bug.

**Evaluation criteria.**
- Reports `0` mismatches for correct closed forms.
- Deliberately injecting a bug (e.g. using `+` instead of `^`) is caught and reported.
- Runs in well under a second.

---

### Task 15 — Decide whether Nim theory even applies

**Problem.** Given a textual description of a game's rules (encoded as flags), classify it as `NIM_XOR`, `GRUNDY`, `MOORE`, `MISERE`, or `NOT_IMPARTIAL` / `LOOPY` (Nim theory does not apply). Justify each decision.

**Constraints / cases to handle.**
- Two players, alternating, same moves, decrease-one-pile-arbitrarily, normal → `NIM_XOR`.
- Restricted move set (bounded take, splits) → `GRUNDY`.
- Up to `k` piles per move → `MOORE`.
- Last stone loses → `MISERE`.
- Players have different moves (partizan) → `NOT_IMPARTIAL`.
- Positions can repeat (cyclic) → `LOOPY`.

**Hint.** Encode the recognition checklist from `senior.md`. The traps are partizan games (need Conway theory) and loopy games (no termination guarantee, so the P/N induction fails).

**Evaluation criteria.**
- Correctly classifies all six canonical cases.
- The `NOT_IMPARTIAL` and `LOOPY` branches explicitly explain why Nim/Grundy theory does not apply.
- Justification cites the right rule (`XOR`, Grundy `mex`, base-`(k+1)`, misère parity).

---

## Benchmark Task

### Task B — XOR decision vs brute-force solver crossover

**Problem.** Empirically show that the XOR decision is `O(n)` while the brute-force memoized solver explodes. For standard Nim:

- **(a) XOR decision:** compute the Nim-sum, check `!= 0` — `O(n)`.
- **(b) Brute-force solver:** recursion + memo over sorted pile tuples — exponential in pile sizes.

Measure wall-clock time for both on random positions with `n = 3` piles and increasing maximum pile size `M ∈ {3, 5, 8, 12, 16, 20}` (use the solver only where it finishes). Report a table and the size at which the solver becomes impractical.

**Starter — Python.**
```python
import random
import time
from functools import lru_cache, reduce
from operator import xor


def xor_decision(piles):
    return reduce(xor, piles, 0) != 0


def brute_solver(piles):
    @lru_cache(maxsize=None)
    def win(state):
        if all(p == 0 for p in state):
            return False
        for i, p in enumerate(state):
            for take in range(1, p + 1):
                nxt = list(state)
                nxt[i] = p - take
                if not win(tuple(sorted(nxt))):
                    return True
        return False
    return win(tuple(sorted(piles)))


def bench(fn, piles) -> float:
    start = time.perf_counter()
    fn(piles)
    return time.perf_counter() - start


def main():
    rng = random.Random(42)
    print("M     xor_ms        brute_ms")
    for M in [3, 5, 8, 12, 16, 20]:
        piles = [rng.randint(0, M) for _ in range(3)]
        tx = min(bench(xor_decision, piles) for _ in range(5)) * 1000
        if M <= 16:
            tb = min(bench(brute_solver, piles) for _ in range(3)) * 1000
            print(f"{M:<5d} {tx:<13.4f} {tb:<12.4f}")
        else:
            print(f"{M:<5d} {tx:<13.4f} {'(skipped)':<12}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same positions across Go, Java, and Python.
- XOR decision is effectively instant for all `M`; the solver's time grows steeply with `M`.
- Both agree on the verdict wherever the solver finishes.
- Report includes the min across at least 3 runs and identifies where the solver becomes impractical.

---

## General Guidance for All Tasks

- **Always validate against the brute-force oracle first.** Every decision/variant task above ships with (or references) a slow recursion+memo solver. Run it on small `n` and small piles, compare verdicts, and only then trust the closed form on large inputs.
- **Use XOR, never arithmetic sum.** The Nim-sum is bitwise XOR.
- **Mover loses iff Nim-sum `= 0`.** The first player does not always win.
- **The winning move sets a pile `p` to `p ^ X`** — only legal when `p ^ X < p` (the pile shares `X`'s top set bit).
- **Restricted move set ⇒ use Grundy numbers, not pile sizes.** Compute `g(s)` by `mex`; for huge piles, exploit eventual periodicity.
- **Combine subgames by XOR of Grundy numbers, never win/loss booleans.**
- **State the play convention.** Normal (last move wins) vs misère (last move loses) — misère flips only the all-ones endgame parity.
- **Reject partizan and loopy games.** Nim/Grundy theory assumes impartial, perfect-information, finite, acyclic games.

Each task must be implemented and tested in **Go, Java, and Python**, with identical outputs across all three on the same seeded inputs.
