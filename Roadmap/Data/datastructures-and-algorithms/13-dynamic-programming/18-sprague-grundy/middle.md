# Sprague-Grundy Theorem and Grundy Numbers — Middle Level

> **Focus:** Why the XOR rule for sums of games is the heart of the technique, how to compute Grundy values with DP/memoization over arbitrary games, how subtraction-game Grundy sequences become *periodic* (and how to exploit that for huge inputs), and a tour of classic games — Grundy's game, staircase Nim, coin-turning games — each decomposed and decided. Nim itself lives in sibling `14-nim`.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Game and DAG Applications](#game-and-dag-applications)
6. [Classic Games, Decomposed](#classic-games-decomposed)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single recursion: `grundy(p) = mex{ grundy(q) : p→q }`, with `0` meaning "mover loses." At middle level you start asking the questions that separate "I can fill a Grundy table" from "I can take an unfamiliar compound game apart and decide it fast":

- *Why* does XOR — and not, say, sum or max — combine independent games? What exactly is "independent"?
- How do I compute Grundy values when positions are not integers (multi-component states, splitting moves)?
- Subtraction-game Grundy sequences look periodic. Is that guaranteed? How do I detect and exploit it for `n = 10^18`?
- What do the classic games look like through the Grundy lens — Grundy's game, staircase Nim, "turning turtles" / coin-turning games?
- When does the elegant XOR theory *not* apply (misère, loopy games, partizan games)?

These are the engineering questions of combinatorial game theory.

---

## Deeper Concepts

### The Grundy recurrence, restated as DP

Positions form a directed acyclic graph: an edge `p → q` for each legal move. Grundy is the unique function satisfying

```
g(p) = mex { g(q) : p → q }       and       g(terminal) = mex{} = 0.
```

Because the graph is acyclic and finite, this has a unique solution computed bottom-up (topological order) or top-down with memoization. Two evaluation styles:

1. **Tabular** — when states are small integers (subtraction games): fill `g[0], g[1], …` in order, `O(states · branching)`.
2. **Memoized DFS** — when states are structured (tuples, sets): recurse on successors, cache by a canonical key.

This is exactly dynamic programming over a DAG; the only game-specific part is "what are the successors of a state."

### Sums of games and the XOR rule

A **sum** `A + B + …` is the game where a position is a tuple `(a, b, …)` of component positions, and a move picks **one** component and makes a legal move there (the others stay put). The player who cannot move in *any* component loses.

> **Theorem (Sprague-Grundy, sum form).** `g(A + B + …) = g(A) ⊕ g(B) ⊕ …` where `⊕` is bitwise XOR.

Why XOR specifically? Because every component is equivalent to a Nim pile of size `g(component)` (the single-game theorem), and a sum of Nim piles is decided by Nim's XOR rule (sibling `14-nim`). The proof that XOR is the right operation for Nim — and hence for any sum of impartial games — is in [`professional.md`](./professional.md). The intuition: XOR is the unique operation making "all components balanced" (`⊕ = 0`) a position your opponent can always restore after any single-component move.

### From XOR back to a winning move

Knowing the position is winning (`⊕ ≠ 0`) is not the same as knowing *which* move wins. The constructive rule mirrors Nim:

1. Let `x = g(A) ⊕ g(B) ⊕ … ≠ 0`. Let `h` be the highest set bit of `x`.
2. Find a component `C` whose Grundy value `g(C)` has bit `h` set. (One must exist.)
3. The target Grundy value for that component is `t = g(C) ⊕ x`, and `t < g(C)`.
4. Make a move *within* `C` to a position whose Grundy value is `t`. (Such a move exists because `t < g(C)` and a position can reach every smaller Grundy value below its own — the mex property.)

After this, the new XOR is `0`, handing your opponent a losing position.

### Periodicity of subtraction games

For a subtraction game with a **finite** allowed set `S`, the Grundy sequence `g[0], g[1], g[2], …` is **eventually periodic**: there exist a pre-period `n₀` and a period `π > 0` with `g[n + π] = g[n]` for all `n ≥ n₀`. Both `n₀` and `π` are bounded (a value depends only on the previous `max(S)` values, and a window of `max(S)` Grundy values — each bounded by `|S|` — has finitely many states, so a window must recur). The full argument and bounds are in [`professional.md`](./professional.md).

Practically: compute `g[0 .. N]` for `N` a few times `max(S)` past where you *see* a repeating window, confirm the window repeats for several cycles, then answer huge `n` by

```
g[n] = g[n0 + (n - n0) mod π]      for n ≥ n0.
```

### What is *not* covered by plain Grundy

- **Misère play** (last move loses): the XOR-of-Grundy rule is wrong in general. There is a partial fix for "tame" games and a full theory (genus theory / misère quotients) that is much harder.
- **Loopy games** (positions can repeat): no DAG, so the mex recursion may not terminate; needs different tools.
- **Partizan games** (players have different moves): Grundy numbers do not exist; use surreal-number / partizan theory.

---

## Comparison with Alternatives

### Plain win/loss labeling vs Grundy numbers

| Approach | What it gives | Cost | Good when |
|----------|---------------|------|-----------|
| Win/loss DFS | Boolean per position | `O(V + E)` | Single game, you only need the winner |
| **Grundy numbers** | An integer per position | `O(V + E)` (plus mex) | **Sums** of games, or reusable analysis |
| Minimax / game tree | Full strategy, any game | exponential | Tiny games, partizan/scored games |
| Closed-form pattern | Instant per query | `O(1)` after derivation | You proved a formula (e.g. `g[n]=n mod 4`) |

The decisive advantage of Grundy over plain win/loss: **win/loss does not compose**. Knowing each component is "winning" tells you nothing about the sum, but knowing each component's Grundy value tells you everything via XOR.

### When XOR decomposition beats analyzing the whole game

| Situation | Monolithic analysis | Grundy decomposition |
|-----------|--------------------|----------------------|
| `m` independent piles, each up to `n` | state space `n^m` (blows up) | `O(n · branching)` once, then `O(m)` XOR |
| A move that *splits* a region into two | huge coupled state | each region's Grundy XOR-ed |
| Many queries on the same game family | recompute each time | compute Grundy table once, reuse |

Decomposition turns an exponential `n^m` into a linear table plus an `O(m)` XOR. That is the whole reason the theory is used in practice.

---

## Advanced Patterns

### Pattern: Grundy with splitting moves (Grundy's game)

In **Grundy's game**, a move splits one pile into two *unequal* nonzero piles. A single pile's Grundy value depends on Grundy values of *sums* of the two resulting piles:

```
g(n) = mex { g(a) XOR g(b) : a + b = n, a != b, a,b >= 1 }
```

Note the XOR *inside* the mex — splitting creates a sum of two independent piles, so their combined Grundy is `g(a) ⊕ g(b)`.

#### Go

```go
package main

import "fmt"

func mexInts(vals map[int]bool) int {
	for i := 0; ; i++ {
		if !vals[i] {
			return i
		}
	}
}

// Grundy's game: split a pile into two unequal nonzero piles.
func grundysGame(n int) []int {
	g := make([]int, n+1)
	for x := 0; x <= n; x++ {
		reach := map[int]bool{}
		for a := 1; a < x; a++ {
			b := x - a
			if a != b { // unequal split required
				reach[g[a]^g[b]] = true
			}
		}
		g[x] = mexInts(reach) // x with no valid split -> mex{} = 0
	}
	return g
}

func main() {
	g := grundysGame(12)
	fmt.Println("Grundy's game g[0..12]:", g)
	// piles of {7, 9}: XOR decides the sum
	x := g[7] ^ g[9]
	fmt.Printf("piles {7,9}: XOR=%d -> %s\n", x, map[bool]string{true: "first wins", false: "second wins"}[x != 0])
}
```

#### Java

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
                if (a != b) reach.add(g[a] ^ g[b]); // unequal split
            }
            g[x] = mex(reach); // no valid split -> 0
        }
        return g;
    }

    public static void main(String[] args) {
        int[] g = grundysGame(12);
        System.out.println("Grundy's game: " + Arrays.toString(g));
        int x = g[7] ^ g[9];
        System.out.println("piles {7,9}: XOR=" + x +
            (x != 0 ? " -> first wins" : " -> second wins"));
    }
}
```

#### Python

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
            if a != b:                 # unequal split required
                reach.add(g[a] ^ g[b])
        g[x] = mex(reach)              # no valid split -> mex{} = 0
    return g


if __name__ == "__main__":
    g = grundys_game(12)
    print("Grundy's game g[0..12]:", g)
    x = g[7] ^ g[9]
    print(f"piles {{7,9}}: XOR={x} ->",
          "first wins" if x else "second wins")
```

The first few Grundy values of Grundy's game are `g[0..8] = 0,0,0,1,0,2,1,0,2` — notice it is *not* obviously periodic (its long-run periodicity is famously unknown), unlike subtraction games.

### Pattern: Periodicity detection for subtraction games

```python
def grundy_subtraction(N, S):
    g = [0] * (N + 1)
    for x in range(1, N + 1):
        g[x] = mex({g[x - s] for s in S if s <= x})
    return g


def find_period(g, S):
    """Find (pre-period n0, period p) by scanning windows of size max(S)."""
    w = max(S)
    for p in range(1, len(g) // 2):
        for n0 in range(len(g) - 2 * p):
            if all(g[i] == g[i + p] for i in range(n0, len(g) - p)):
                # confirm it holds for the whole tail from n0
                return n0, p
    return None


def grundy_huge(n, S, sample=2000):
    g = grundy_subtraction(min(n, sample), S)
    if n <= sample:
        return g[n]
    n0, p = find_period(g, S)
    return g[n0 + (n - n0) % p]
```

Always confirm the candidate window repeats for *several* full periods before trusting it (see Best Practices); a naive `find_period` can lock onto a coincidental short repeat.

### Pattern: Staircase Nim reduction

In **staircase Nim**, coins sit on steps `1..k`; a move slides any number of coins from step `i` down to step `i-1`; coins reaching step `0` leave play; last to move wins. The clean result: **the game is equivalent to ordinary Nim on the coins at *odd-numbered* steps**. Coins on even steps don't matter (a "mirroring" argument). So:

```
grundy(staircase) = XOR of (coin counts on odd steps)
```

This is a beautiful example of recognizing a known game in disguise rather than computing Grundy from scratch.

---

## Game and DAG Applications

```mermaid
graph TD
    SG[Sprague-Grundy machine] --> SUB[Subtraction games: g[x]=mex over removals]
    SG --> SPLIT[Splitting games: Grundy's game, Kayles]
    SG --> STAIR[Staircase Nim: XOR of odd steps]
    SG --> COIN[Coin-turning games: XOR of single-coin Grundy values]
    SG --> NIM[Nim and Nim variants -> sibling 14-nim]
    SG --> COMPOSITE[Any sum of independent components via XOR]
```

### Coin-turning games

A large family ("Turning Turtles", "Mock Turtles", "Ruler", "Twins") shares a remarkable structure: a position is a row (or grid) of coins, a move turns some coins over subject to rules, and **the rightmost coin turned must go heads→tails**. The key theorem: *the Grundy value of a whole position is the XOR of the Grundy values of the positions with a single heads coin at each heads location.* So you precompute the single-coin Grundy values and XOR over the heads. This reduces a `2^n` position space to `n` precomputed numbers — another decomposition triumph.

### Games on graphs

A token on a vertex of a DAG, a move slides it along an out-edge, last to move wins: the Grundy value of a vertex is `mex` of its out-neighbors' Grundy values — literally the definition. Multiple tokens on independent graphs (or independent components) XOR together.

---

## Classic Games, Decomposed

| Game | Move | Grundy / winning rule |
|------|------|------------------------|
| Nim | remove any positive count from one pile | `g(pile) = pile size`; sum = XOR of sizes (sibling `14-nim`) |
| Subtraction `S` | remove `s ∈ S` from one pile | `g[x] = mex{g[x-s]}`; eventually periodic |
| Staircase Nim | slide coins down a step | XOR of coins on **odd** steps |
| Grundy's game | split a pile into two unequal piles | `g(n) = mex{ g(a)⊕g(b) : a+b=n, a≠b }` |
| Kayles | knock down 1 or 2 adjacent pins (splits the row) | precomputed, eventually periodic (period 12 after a short prefix) |
| Coin-turning | turn coins, rightmost head→tail | XOR of single-coin Grundy values over heads |

The recurring theme: **decompose, compute small Grundy values, XOR**. When a move splits a region into independent pieces, the resulting position's Grundy is the XOR of the pieces — so the mex ranges over XORs (as in Grundy's game and Kayles).

---

## Code Examples

### Reusable mex + memoized Grundy engine (general game)

This factors the engine so any game plugs in by supplying `successors`.

#### Python

```python
from functools import lru_cache


def mex(values):
    s = set(values)
    i = 0
    while i in s:
        i += 1
    return i


def make_grundy(successors):
    @lru_cache(maxsize=None)
    def g(state):
        nxt = successors(state)
        if not nxt:
            return 0
        return mex(g(s) for s in nxt)
    return g


# Example: subtraction game S={1,3,4} on a single integer pile.
S = (1, 3, 4)


def succ(n):
    return tuple(n - s for s in S if s <= n)


grundy = make_grundy(succ)

if __name__ == "__main__":
    seq = [grundy(n) for n in range(16)]
    print("g[0..15] for S={1,3,4}:", seq)
    # Sum of piles {5, 8, 11}: XOR decides it.
    x = 0
    for p in (5, 8, 11):
        x ^= grundy(p)
    print("sum {5,8,11}:", "first wins" if x else "second wins", "(XOR =", x, ")")
```

#### Go

```go
package main

import "fmt"

var S = []int{1, 3, 4}

func mexSet(m map[int]bool) int {
	for i := 0; ; i++ {
		if !m[i] {
			return i
		}
	}
}

func grundyTable(n int) []int {
	g := make([]int, n+1)
	for x := 1; x <= n; x++ {
		reach := map[int]bool{}
		for _, s := range S {
			if s <= x {
				reach[g[x-s]] = true
			}
		}
		g[x] = mexSet(reach)
	}
	return g
}

func main() {
	g := grundyTable(15)
	fmt.Println("g[0..15] for S={1,3,4}:", g)
	x := 0
	for _, p := range []int{5, 8, 11} {
		x ^= g[p]
	}
	if x != 0 {
		fmt.Println("sum {5,8,11}: first wins (XOR =", x, ")")
	} else {
		fmt.Println("sum {5,8,11}: second wins")
	}
}
```

#### Java

```java
import java.util.*;

public class GrundyEngine {
    static final int[] S = {1, 3, 4};

    static int mex(Set<Integer> m) {
        int i = 0;
        while (m.contains(i)) i++;
        return i;
    }

    static int[] grundyTable(int n) {
        int[] g = new int[n + 1];
        for (int x = 1; x <= n; x++) {
            Set<Integer> reach = new HashSet<>();
            for (int s : S) if (s <= x) reach.add(g[x - s]);
            g[x] = mex(reach);
        }
        return g;
    }

    public static void main(String[] args) {
        int[] g = grundyTable(15);
        System.out.println("g[0..15] for S={1,3,4}: " + Arrays.toString(g));
        int x = 0;
        for (int p : new int[]{5, 8, 11}) x ^= g[p];
        System.out.println("sum {5,8,11}: " +
            (x != 0 ? "first wins (XOR=" + x + ")" : "second wins"));
    }
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Combined games with `+` not XOR | "Winning" positions reported as losing and vice versa | Always `acc ^= g[component]`. |
| Splitting move ignored the sum | Grundy of split state computed as `mex` of single piles | A split makes a sum: use `mex{ g(a) ⊕ g(b) }`. |
| Period guessed too early | Wrong `g[n]` for large `n` | Confirm the window repeats for several full periods. |
| Misère game via normal-play XOR | Wrong winner near the endgame | Apply the misère correction (middle/professional). |
| Cycle in move graph | Memoized recursion never terminates | Sprague-Grundy needs a DAG; detect/break cycles or use loopy-game theory. |
| Non-canonical states bloat the cache | Slow, memory blow-up | Canonicalize (sort piles, normalize) before caching. |
| mex sized by max value | Wasted memory; still correct but slow | Size the mex array by the number of children. |

---

## Performance Analysis

| Task | Cost | Notes |
|------|------|-------|
| Subtraction table `g[0..n]`, moves `|S|` | `O(n·|S|)` | mex bounded by `|S|` |
| Grundy's game `g[0..n]` | `O(n²)` | each `x` scans all splits |
| Memoized general game | `O(V + E)` calls | plus mex cost per node |
| Decide a sum of `m` components | `O(m)` | after Grundy values known |
| Huge `n` via periodicity | `O(period)` precompute, `O(1)` query | once period proven |

```python
import time


def bench_subtraction(n, S):
    start = time.perf_counter()
    g = [0] * (n + 1)
    for x in range(1, n + 1):
        seen = [False] * (len(S) + 1)
        for s in S:
            if s <= x:
                v = g[x - s]
                if v < len(seen):
                    seen[v] = True
        i = 0
        while i < len(seen) and seen[i]:
            i += 1
        g[x] = i
    return time.perf_counter() - start

# A boolean array sized by |S| (not by max Grundy value) keeps mex O(|S|).
```

The single biggest constant-factor win is using a small **boolean array** sized by the branching factor for `mex`, instead of a hash set — sets dominate the runtime of tight Grundy loops.

---

## Best Practices

- **Decompose first.** If a position is a sum of independent components, compute each component's Grundy value and XOR; never analyze the coupled monolith.
- **XOR, not add.** Burn this in: sums combine by bitwise XOR.
- **Verify periodicity over several cycles** before relying on it; better, use the proven bound from `professional.md`.
- **Canonicalize states** (sort piles, normalize orientation) so symmetric positions share one cache entry.
- **Test against the win/loss oracle:** `grundy(p) == 0` must equal "mover loses" for every small position.
- **Document the convention** (normal vs misère) and the move set explicitly — the same board admits different games.
- **Keep `mex` cheap** with a branching-sized boolean array.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The **position DAG** with bottom-up Grundy labeling — terminals at `0`, then each node's **mex** chosen from its children.
> - A **sum** of two or three independent games, with their Grundy values combined by **XOR**, and the result classified as a win (`≠0`) or loss (`0`).
> - The constructive **winning move**: which component to move in and to which target Grundy value, when the XOR is nonzero.

---

## Summary

The middle-level payoff is **decomposition by XOR**. A single position's Grundy value is the `mex` of its children's Grundy values (DP over a DAG), and the Sprague-Grundy theorem makes each component equivalent to a Nim pile, so a **sum** of independent games has Grundy value equal to the **XOR** of the components — turning an exponential `n^m` analysis into a linear table plus an `O(m)` XOR. Subtraction-game Grundy sequences are **eventually periodic**, so huge `n` is answered in `O(1)` after detecting the period. Classic games yield to the same playbook: staircase Nim is XOR over odd steps, coin-turning games are XOR over single-coin values, and splitting games (Grundy's game, Kayles) take the `mex` over XORs of the resulting pieces. The theory's limits — misère, loopy, and partizan games — mark where plain Grundy stops and harder machinery begins. The prototype Nim and its XOR arithmetic are in sibling `14-nim`; the proofs are in `professional.md`.
