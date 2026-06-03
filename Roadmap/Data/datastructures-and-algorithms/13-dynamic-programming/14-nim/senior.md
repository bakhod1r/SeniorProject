# Nim and Impartial Game Theory Basics — Senior Level

> Nim is rarely the literal problem on a senior interview or in production — but its XOR fingerprint hides inside dozens of "who wins this game" problems. The senior skill is *recognizing* Nim-like structure beneath a disguised rule set, reducing it to Grundy numbers when the plain XOR rule fails, proving the outcome rather than guessing it, and verifying everything against a brute-force solver before trusting a closed form — because a single misread of normal-vs-misère or exact-vs-bounded-take silently flips every answer.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Recognizing Nim-Like Structure](#2-recognizing-nim-like-structure)
3. [Handling Big Pile Counts and Huge Values](#3-handling-big-pile-counts-and-huge-values)
4. [Proving Game Outcomes](#4-proving-game-outcomes)
5. [The Brute-Force Game Solver as Ground Truth](#5-the-brute-force-game-solver-as-ground-truth)
6. [Variant Engineering: One Engine, Many Games](#6-variant-engineering-one-engine-many-games)
7. [Performance and Scaling](#7-performance-and-scaling)
8. [Code Examples](#8-code-examples)
9. [Testing and Observability](#9-testing-and-observability)
10. [Failure Modes and Misconceptions](#10-failure-modes-and-misconceptions)
11. [Summary](#11-summary)

---

## 1. Introduction

At the senior level the question is no longer "what does the Nim-sum tell me" but "is this problem secretly Nim, and if so, in which guise, and how do I *prove* my answer is correct at scale?" Nim and its theory show up in three recurring guises:

1. **Direct Nim / disguised Nim** — a stone-removal game whose moves are exactly "decrease one pile arbitrarily," solved by XOR-of-sizes (Bouton).
2. **Grundy-reducible games** — the move set is restricted or structured (bounded take, take-and-split, graph games, staircase Nim), so the pile's value is a **Grundy number**, not its size; you compute Grundy numbers and *then* XOR.
3. **Generalized losing conditions** — multi-pile moves (Moore's Nimₖ), misère endings, or partizan twists that change the very definition of a P-position.

All three reduce to a single discipline: *identify the impartial-game structure, assign each independent component a Grundy value, combine by XOR, decide by "is the combined value `0`?", and verify against a brute-force oracle on small instances.* The senior decisions are: how to recognize the structure, how to handle astronomically large pile values without enumerating, how to prove the P/N classification, and how to keep the whole thing verifiable when the state space is too big to brute-force.

This document treats those decisions in practical, production/competitive terms.

---

## 2. Recognizing Nim-Like Structure

### 2.1 The recognition checklist

A problem is solvable by Nim/Grundy theory when **all** of these hold:

1. **Two players, alternating moves.** No simultaneity.
2. **Impartial.** From any position both players have the *same* legal moves (rules out chess-like partizan games — those need surreal-number / Conway theory, not Nim).
3. **Perfect information, no chance.** No hidden state, no dice.
4. **Finite and terminating.** Every play ends; the game is acyclic (a position cannot repeat). (Cyclic games need the more delicate theory of *loopy games*.)
5. **Last-move convention fixed.** Normal play (last move wins) or misère (last move loses), and you know which.

If 1–5 hold, the position decomposes into independent **components**, each gets a Grundy number, and the answer is the XOR.

### 2.2 Common disguises

| Disguise | Underlying Nim structure |
|----------|--------------------------|
| "Remove 1..m matchsticks" | subtraction game; Grundy `s mod (m+1)` |
| "Move a token toward 0 on a line" | a Nim pile = distance to 0 (sometimes mod something) |
| "Coins on a strip, flip/move left" | coin-turning game; XOR of single-coin Grundy values |
| **Staircase Nim** | only the **odd-indexed** stairs matter; XOR those |
| "Split a pile into two unequal piles" | Grundy via mex over split outcomes (Grundy's game) |
| "Cut a chocolate bar / break sticks" | independent components; XOR their Grundy values |
| Game on a DAG (move a token along edges) | Grundy of a vertex = mex of successors' Grundy |

### 2.1b A second recognition: "turning coins"

Coin-turning games (Mock Turtles, Ruler, Turning Turtles) place coins heads/tails in a row; a move turns over a set of coins subject to constraints, with the *rightmost* turned coin going head→tail. These decompose by a deep theorem into a XOR (disjunctive sum) of single-coin games, each a Nim-like value. The senior recognition is: "a position is the XOR of the Grundy values of its heads-up coins." This is a less obvious Nim structure than stone removal, but the same XOR-combination law applies — a reminder that "Nim-like" extends well beyond literal piles.

### 2.2b A worked recognition: "tokens racing to zero"

A frequent disguise: *"Each of `n` tokens sits at a position on a number line. A move slides one token strictly toward 0 by any amount; a token at 0 is frozen. The player who makes the last move wins."* Strip the narrative: each token is a pile whose size is its distance to 0, a move decreases one pile arbitrarily, last move wins — **this is standard Nim**, and the answer is `XOR of distances ≠ 0`. The senior skill is performing this translation in seconds and *naming the pile* (here: distance to 0) so the rest of the team can verify it. The common failure is to over-model: writing a game-tree search for what is a one-line XOR.

### 2.3 Staircase Nim — the canonical "disguised Nim"

Stones sit on stairs `0, 1, …, m`; a move slides any positive number of stones from stair `i` down to stair `i−1`; stones reaching stair `0` leave play; last move wins. The clean result: **this is equivalent to Nim on the odd-indexed stairs only.** Stones on even stairs are "free moves" your opponent can always mirror, so they do not affect the outcome. The Nim-sum is `XOR of counts on odd stairs`. Recognizing that "half the state is irrelevant" is a hallmark senior insight — and it is provable by the mirroring argument, not just observed.

```python
def staircase_nim_wins(stairs):
    # stairs[i] = number of stones on stair i (stair 0 is the exit)
    x = 0
    for i in range(1, len(stairs), 2):   # odd indices only
        x ^= stairs[i]
    return x != 0
```

---

## 3. Handling Big Pile Counts and Huge Values

### 3.1 Pile *values* can be astronomical — never enumerate

A pile of size `10^18` is no problem for standard Nim: the Nim-sum is a single XOR of 64-bit integers, `O(n)` total. The trap is reaching for a Grundy *table* indexed by pile size — that is `O(maxSize)` memory and dies instantly at `10^18`. Two escapes:

- **Closed form.** Standard Nim: `g(s) = s`. Max-take `m`: `g(s) = s mod (m+1)`. No table needed.
- **Periodicity.** Any finite subtraction set yields an *eventually periodic* Grundy sequence. Build a generous prefix, detect the period `π` and pre-period `λ`, then evaluate `g(huge)` in `O(1)` by indexing into the periodic pattern.

### 3.2 Many piles

`n` up to `10^6` piles is fine — the decision is one XOR pass, `O(n)`. The winning move is another `O(n)` pass. There is no quadratic blow-up in standard Nim; the cost is linear in the *number* of piles, independent of their sizes.

### 3.3 When the component count is the bottleneck

For games that decompose into *many* independent subgames each needing a Grundy computation, the cost is `Σ (cost to Grundy each component)`. Cache Grundy values (memoize by canonical component state), exploit symmetry, and use closed forms / periodicity wherever the subgame is a known family. If components repeat (common in cut/split games), memoization across components is the dominant win.

### 3.4 Modular / counting variants

Some problems ask not "who wins" but "how many starting positions are first-player wins." That is a *counting* problem over the XOR structure — typically solved with digit DP over the binary representations or linear algebra over GF(2), not by enumerating games. The Nim structure (XOR `= 0` ⇔ P-position) becomes a linear constraint over GF(2); counting solutions is a rank computation. This is a frequent senior-level escalation of the basic decision problem.

### 3.5 A counting worked sketch

"Count the positions `(p₁, …, pₙ)` with each `0 ≤ pᵢ < 2^d` that are P-positions (Nim-sum `0`)." The Nim-sum `σ` is a linear map from `(GF(2)^d)^n` to `GF(2)^d`. It is surjective for `n ≥ 1` (fix all but one pile and vary the last), so its kernel has size `(2^d)^n / 2^d = 2^{d(n−1)}`. Hence exactly `2^{d(n−1)}` of the `2^{dn}` positions are P-positions — a closed form obtained from rank/nullity, never enumeration. Add constraints (e.g. piles distinct, or bounded by varying limits) and the count becomes a digit DP over the `d` bit-columns carrying the XOR-parity state; the per-column transition is `O(1)`, so the whole count is `O(d · states)`. The senior point: "who wins" is `O(n)`, but "how many win" is a structured counting problem, and the linearity of the Nim-sum is exactly what makes it tractable.

---

## 4. Proving Game Outcomes

### 4.1 The P/N induction is the proof obligation

To *prove* a position is a P-position (mover loses), you must show **both**:

- **(closure)** every legal move leads to an N-position, and
- the terminal position is correctly classified as P.

To prove an N-position (mover wins), exhibit **one** move to a P-position. This is the universal proof template for impartial games; Bouton's theorem is its instance with "P ⇔ Nim-sum `0`" (full proof in [`professional.md`](./professional.md)).

### 4.2 Proving a *strategy*, not just an outcome

Senior answers prove a **strategy-stealing** or **pairing/mirroring** argument when possible — these are short and convincing:

- **Mirroring (two equal piles):** whatever the opponent does to one pile, copy it on the other; you always have a move, so they run out first. Proves `(a, a)` is a P-position without any XOR.
- **Strategy stealing:** if having an extra free move could only help, and the first player could "steal" the second player's winning strategy, then the first player cannot be losing — used to prove first-player-wins existence (e.g., in Chomp) even when the explicit move is unknown.
- **Symmetry / invariant maintenance:** show the winner can maintain an invariant (Nim-sum `0`, or Moore's per-column divisibility) after every opponent move; the opponent is forced to break it.

### 4.3 Reducing to Grundy and proving the reduction

When the game is a disjunctive sum, the Sprague-Grundy theorem (sibling `15-sprague-grundy`) lets you *prove* the outcome equals "XOR of component Grundy values `≠ 0`." The proof obligation splits into (a) each component's Grundy value is correct (by its own mex induction) and (b) the XOR-combination law (Sprague-Grundy). Stating this decomposition cleanly is the difference between a hand-wave and a proof.

### 4.4 A reusable proof template

When asked to prove a position class is losing (P), the standard senior write-up is exactly three bullets:

1. **Terminal base case** is correctly P (mover with no move loses under normal play).
2. **Closure:** from any candidate-P position, *every* legal move lands in a candidate-N position. (For Nim: changing one term of the XOR cannot keep it `0`.)
3. **Escape:** from any candidate-N position, *some* legal move lands in a candidate-P position. (For Nim: the top-bit `p ^ X` move.)

By uniqueness of the P/N labeling, the candidate classes *are* the true P/N classes. This template is game-agnostic: it works verbatim for Moore's Nimₖ (replace "XOR `0`" with "all columns divisible by `k+1`") and for subtraction games (replace with "Grundy `0`"). Memorize the three bullets — they are the universal proof skeleton.

### 4.5 Strategy-stealing in practice

Strategy stealing proves *existence* of a first-player win without constructing the move — useful when the explicit strategy is unknown (e.g. Chomp). The argument: suppose the second player had a winning strategy; the first player makes an arbitrary opening move, and whatever the second player would reply, the first player could have played *that* as the opening and then stolen the strategy — a contradiction, because an extra harmless move never hurts in these games. Therefore the first player wins. This is *non-constructive*: it names the winner, not the move. Deploy it when a constructive argument is hard, and flag clearly that no explicit move is produced.

---

## 5. The Brute-Force Game Solver as Ground Truth

A closed-form Nim answer is opaque — one wrong assumption (misère? bounded take? off-by-one in staircase parity?) yields a confidently wrong answer that *looks* right. The antidote is a **brute-force memoized solver** that decides win/loss from first principles, used as an oracle on small instances.

```python
from functools import lru_cache


def make_solver(moves, misere=False):
    """moves(state) -> iterable of next canonical states.
    Returns solve(state) = True iff player to move wins."""
    @lru_cache(maxsize=None)
    def win(state):
        children = list(moves(state))
        if not children:                  # terminal: no move
            # normal: mover loses (no last move); misere: mover WINS
            return True if misere else False
        return any(not win(c) for c in children)
    return win
```

You then assert, for every small position, `closed_form(pos) == solver(pos)`. This single test catches:

- normal/misère confusion (flip the terminal value),
- bounded-take / move-set transcription errors,
- staircase parity mistakes,
- Moore's `k+1` base errors.

The oracle is the most valuable artifact a senior produces for any game problem — write it *first*, derive the closed form *second*, and reconcile.

### 5.1 Designing the oracle for variants

The oracle's *only* game-specific inputs are the move generator and the terminal value:

- **Standard Nim:** `moves(state)` decreases one pile arbitrarily; terminal (`all zero`) returns `False` (normal) or `True` (misère).
- **Max-take `m`:** `moves(state)` removes `1..m` from one pile.
- **Splits:** `moves(state)` replaces a pile by two unequal piles.
- **DAG token:** `moves(state)` follows out-edges.

Keep the recursion `win(state) = any(not win(c) for c in moves(state))` and the memo keyed on the canonical state. Swapping games is swapping `moves` and the terminal value — nothing else. This discipline is what lets you reconcile *every* variant against the same trusted skeleton, and it is why a senior writes the oracle generically rather than per-game.

### 5.2 What the oracle catches that closed forms hide

A closed form like `XOR(pᵢ) != 0` is *silent* about which assumptions it encodes. The oracle makes them explicit and testable:

| Hidden assumption | Symptom if wrong | Why the oracle catches it |
|-------------------|------------------|---------------------------|
| Normal vs misère | endgame verdicts flip | terminal value differs |
| Move set = "any decrease" | bounded-take answers wrong | `moves` enumerates the real options |
| Last-move convention | off-by-one in who wins | terminal classification |
| Staircase parity (odd vs even) | inverted winner | oracle ignores the closed form entirely |

Run the reconciliation over *all* small positions, not a hand-picked few — bugs cluster at boundaries (single pile, all-ones, all-zero) that a few examples miss.

---

## 6. Variant Engineering: One Engine, Many Games

A production-grade game-theory utility is parameterized by a **move generator** and a **play convention** (normal/misère). The Grundy/`mex` skeleton never changes; only `moves(state)` does. This lets one tested engine serve:

| Game | `moves(state)` | Closed form (if any) |
|------|----------------|----------------------|
| Standard Nim | decrease one pile arbitrarily | `g(s) = s` |
| Max-take `m` | remove `1..m` from one pile | `g(s) = s mod (m+1)` |
| Subtraction set `S` | remove `t ∈ S` from one pile | eventually periodic |
| Grundy's game (split) | split a pile into two unequal piles | computed, no simple closed form |
| Staircase Nim | slide stones down one stair | XOR of odd stairs |
| Token on a DAG | follow an out-edge | `g(v) = mex(g(succ))` |
| Moore's Nimₖ | decrease up to `k` piles | base-`(k+1)` column rule |

The senior pattern: **encapsulate the convention in the terminal classification, encapsulate the rules in the move generator, and keep one Grundy/XOR core.** Never copy-paste a new solver per game; you will mis-port the modulus, the parity, or the terminal value.

---

## 7. Performance and Scaling

### 7.1 Standard Nim cost

Decision and winning move are both `O(n)` in the number of piles, independent of pile magnitude. There is nothing to optimize beyond using native 64-bit XOR. The Nim-sum fits in a single machine word for piles up to `2^63`; for arbitrary-precision piles, XOR is linear in the bit-width, still trivial. There is no benefit to parallelizing a single decision — the constant is so small that the bottleneck is reading the input.

### 7.2 Grundy-table cost and the periodicity escape

For a subtraction set of size `|S|`, a naive Grundy table to size `N` costs `O(N · |S|)` time and `O(N)` space. When pile values are huge, this is infeasible — but the sequence is eventually periodic, so:

1. Build the table to `O(period_bound)` (a safe bound is around `2·(max take)` plus a margin).
2. Detect pre-period `λ` and period `π`.
3. Answer `g(huge)` by `g(λ + (huge − λ) mod π)` in `O(1)`.

### 7.3 Memoization for decomposable games

Games that recurse into subgames (splits, cuts) memoize Grundy values keyed by canonical sub-state. Canonicalization (sorting piles, normalizing board orientation) collapses symmetric states and is often the single biggest speedup.

### 7.4 GF(2) view for counting/structural queries

"How many P-positions with constraints" or "is set of pile-values a basis" become **linear algebra over GF(2)**: the Nim-sum is a linear map, P-positions are its kernel. Rank/nullity over GF(2) answers counting and span questions in `O(n · bits)` without enumerating positions.

### 7.5 Caching Grundy across repeated subgames

Decomposable games (cuts, splits, board games that fragment into independent regions) repeatedly encounter the *same* sub-state. Memoizing Grundy values keyed by a **canonical** sub-state is the dominant optimization:

- **Canonicalize** before keying: sort piles, normalize board orientation/reflection, strip empty components. Symmetric states then share one cache entry.
- **Bound the cache** by the reachable sub-state space, not by raw pile values. For huge piles in a periodic family, key by the *periodic residue*, not the size.
- **Share the cache read-only** across worker threads once populated; recomputing per request is a classic latency/GC regression at scale.

A worked instance: in a "break a stick into pieces" game, a stick of length `L` decomposes into two independent sticks; the Grundy of `L` recurses into Grundy of the parts. Without memoization the recursion is exponential; with it, it is `O(L²)` (or better with periodicity). The canonicalization "a stick is determined only by its length" collapses all stick *positions* of the same length to one cache entry.

---

## 8. Code Examples

### 8.1 Go — recognizer + dispatcher across variants

```go
package main

import "fmt"

func nimSum(piles []int) int {
	x := 0
	for _, p := range piles {
		x ^= p
	}
	return x
}

// Standard normal-play Nim.
func standardNimWins(piles []int) bool { return nimSum(piles) != 0 }

// Max-take m: Grundy of a pile is p % (m+1).
func maxTakeWins(piles []int, m int) bool {
	x := 0
	for _, p := range piles {
		x ^= p % (m + 1)
	}
	return x != 0
}

// Staircase Nim: XOR of odd-indexed stairs.
func staircaseWins(stairs []int) bool {
	x := 0
	for i := 1; i < len(stairs); i += 2 {
		x ^= stairs[i]
	}
	return x != 0
}

// Moore's Nim_k: lose iff every bit-column count divisible by k+1.
func mooreWins(piles []int, k int) bool {
	for b := 0; b < 63; b++ {
		col := 0
		for _, p := range piles {
			col += (p >> uint(b)) & 1
		}
		if col%(k+1) != 0 {
			return true
		}
	}
	return false
}

func main() {
	fmt.Println(standardNimWins([]int{3, 4, 5}))     // true
	fmt.Println(maxTakeWins([]int{4, 8}, 3))         // false
	fmt.Println(staircaseWins([]int{0, 3, 0, 4}))    // 3 ^ 4 != 0 -> true
	fmt.Println(mooreWins([]int{1, 2, 3}, 2))        // base-3 columns
}
```

### 8.2 Java — periodic Grundy for an arbitrary subtraction set

```java
import java.util.*;

public class PeriodicGrundy {
    static int mex(Set<Integer> s) {
        int m = 0;
        while (s.contains(m)) m++;
        return m;
    }

    // Build Grundy prefix and detect (preperiod, period) for take-set S.
    static int[] grundyPrefix(int[] S, int N) {
        int[] g = new int[N + 1];
        for (int s = 1; s <= N; s++) {
            Set<Integer> r = new HashSet<>();
            for (int t : S) if (t <= s) r.add(g[s - t]);
            g[s] = mex(r);
        }
        return g;
    }

    // Evaluate g(huge) using a detected period.
    static int grundyAt(int[] prefix, int lambda, int pi, long s) {
        if (s <= lambda) return prefix[(int) s];
        long off = (s - lambda) % pi;
        return prefix[(int) (lambda + off)];
    }

    public static void main(String[] args) {
        int[] S = {1, 3, 4};
        int[] g = grundyPrefix(S, 40);
        // (period detection omitted for brevity; assume lambda=0, pi found = 7)
        System.out.println("g(10) = " + g[10]);
        System.out.println("g(1e9, periodic) = " + grundyAt(g, 0, 7, 1_000_000_000L));
    }
}
```

### 8.3 Python — closed form vs brute-force oracle reconciliation

```python
from functools import lru_cache


def standard_nim_wins(piles):
    x = 0
    for p in piles:
        x ^= p
    return x != 0


def brute_wins(piles):
    @lru_cache(maxsize=None)
    def win(state):
        if all(p == 0 for p in state):
            return False                 # normal play: no move => lose
        for i, p in enumerate(state):
            for take in range(1, p + 1):
                nxt = list(state)
                nxt[i] = p - take
                if not win(tuple(sorted(nxt))):
                    return True
        return False
    return win(tuple(sorted(piles)))


if __name__ == "__main__":
    import itertools
    # Reconcile closed form against the oracle on all small positions.
    ok = True
    for piles in itertools.product(range(4), repeat=3):
        if standard_nim_wins(list(piles)) != brute_wins(list(piles)):
            ok = False
            print("MISMATCH at", piles)
    print("All small positions agree:", ok)   # True
```

---

## 8.4 Python — staircase Nim with winning move

A senior implementation does not just decide the winner; it produces a *playable* winning move and asserts the move is legal and restores the invariant.

```python
def staircase_decision_and_move(stairs):
    """stairs[i] = stones on stair i; stair 0 is the exit.
    Returns (mover_wins, move) where move = (from_stair, count) or None."""
    x = 0
    for i in range(1, len(stairs), 2):
        x ^= stairs[i]
    if x == 0:
        return (False, None)                       # P-position
    # Treat odd stairs as Nim piles; find the one sharing X's top bit.
    for i in range(1, len(stairs), 2):
        target = stairs[i] ^ x
        if target < stairs[i]:
            count = stairs[i] - target             # slide these down to stair i-1
            return (True, (i, count))
    return (True, None)                            # unreachable when x != 0


def apply_staircase_move(stairs, move):
    i, count = move
    nxt = stairs[:]
    nxt[i] -= count
    nxt[i - 1] += count
    return nxt


if __name__ == "__main__":
    s = [0, 3, 0, 4]
    win, mv = staircase_decision_and_move(s)
    assert win and mv is not None
    after = apply_staircase_move(s, mv)
    # invariant: odd-stair XOR is now 0
    x_after = 0
    for i in range(1, len(after), 2):
        x_after ^= after[i]
    assert x_after == 0, "winning move must zero the odd-stair Nim-sum"
    print("win:", win, "move:", mv, "after:", after)
```

The assertions encode the two senior-grade guarantees: the emitted move is *legal* (it slides a positive count of stones down one stair) and *correct* (it restores the P-invariant). Shipping a "winner" without these checks is how parity bugs reach production.

---

## 9. Testing and Observability

A game-outcome result is a single boolean — easy to get wrong, hard to spot. Build verification in from the start.

| Check | Why |
|-------|-----|
| Closed form vs brute-force oracle on all small positions | Catches misère/normal, bounded-take, parity errors. |
| Terminal classification test | Normal: mover with no move loses; misère: wins. A flipped terminal flips everything. |
| Winning-move legality assertion | The emitted move must strictly decrease exactly one pile (or up to `k` for Moore). |
| Winning-move correctness | After the move, the position must be a P-position (Nim-sum `0` / divisibility restored). |
| Mirror invariant for `(a, a)` | A two-equal-pile position must be classified P. |
| Periodicity self-check | `g(s) == g(s + π)` for `s ≥ λ` across the built prefix. |
| Determinism across languages | Same inputs → identical Go/Java/Python verdicts and moves. |

The single most valuable test is the **closed-form vs oracle reconciliation** over all positions with small piles and few piles — it is cheap and catches the overwhelming majority of bugs.

---

## 10. Failure Modes and Misconceptions

### 10.0 The single most important habit

Before any of the specific failure modes below: **write the brute-force oracle and reconcile it against your closed form on all small positions, every time.** Nearly every failure mode in this section is caught by that one discipline. The closed form is the optimization; the oracle is the specification. Ship the oracle in tests, not just in your head.

### 10.1 Normal vs misère confusion
Applying the normal-play XOR rule to a misère game (or vice versa). Misère differs only in the all-ones endgame, which is exactly where it bites. Mitigation: encode the convention in the terminal value of the oracle and reconcile.

### 10.2 XOR-of-sizes on a non-Nim move set
Using `XOR(p₁, …, pₙ)` when moves are restricted (bounded take, splits). The pile's value is then a Grundy number, not its size. Mitigation: compute Grundy numbers first; only XOR Grundy values.

### 10.3 Combining win/loss booleans instead of Grundy numbers
A position's "winning?" boolean does **not** compose across independent subgames. You must XOR **Grundy numbers**. This is the deepest and most common conceptual error — it is why Sprague-Grundy (sibling `15`) is necessary.

### 10.4 Assuming the first player always wins
First-move does not imply a win. If the starting Nim-sum (or Grundy XOR) is `0`, the first player loses. Many problems are designed so the answer is "second player wins."

### 10.5 Grundy-table memory blow-up
Indexing a Grundy table by a huge pile value. Mitigation: closed forms and periodicity; never allocate `O(10^18)`.

### 10.6 Partizan games treated as impartial
If the two players have *different* moves (partizan), Sprague-Grundy and Nim theory **do not apply** — you need Conway's surreal-number / game-value theory. Mitigation: verify the impartiality condition before reaching for XOR.

### 10.7 Cyclic / loopy games
If positions can repeat (draws or infinite play possible), the standard P/N induction breaks (it assumes termination). Mitigation: confirm acyclicity; loopy games need specialized analysis.

### 10.8 Off-by-one in staircase / parity reductions
Staircase Nim uses **odd**-indexed stairs; choosing even (or 1-indexing differently) inverts the answer. Mitigation: re-derive the index parity from the mirroring argument and check against the oracle.

### 10.9 Trusting a memorized closed form
Closed forms (`g(s) = s mod (m+1)`, "odd stairs," misère parity) are easy to misremember under interview pressure. Mitigation: derive the small Grundy table or the mirroring argument on the spot, and sanity-check against two or three hand-computed positions before committing.

### 10.10 Ignoring the "second player wins" framing
Many problems are deliberately set so the answer is "second player wins" (Nim-sum `0`). A solver hard-wired to assume the first player always has a move/win will be wrong on exactly these adversarial inputs. Mitigation: always report both outcomes symmetrically and test all-equal-pile inputs, which are the canonical P-positions.

---

## 11. Summary

- Nim is the **recognition target**: many "who wins" problems are Nim or Grundy-reducible. The senior skill is spotting the impartial-game structure under a disguised rule set and decomposing into independent components.
- The decision is `O(n)` for standard Nim (one XOR), independent of pile magnitude. Huge pile *values* are fine; huge Grundy *tables* are the trap — escape via closed forms (`g(s)=s`, `g(s)=s mod (m+1)`) and **periodicity** of subtraction-game Grundy sequences.
- **Prove**, do not guess: the P/N induction (closure + terminal), mirroring/strategy-stealing arguments, and the Sprague-Grundy decomposition are the proof tools. State the decomposition explicitly.
- The **brute-force memoized oracle** is ground truth. Write it first, derive the closed form second, and reconcile over all small positions — it catches normal/misère, bounded-take, parity, and Moore-base errors.
- One **parameterized engine** (move generator + play convention + Grundy/`mex` core) serves standard Nim, max-take, subtraction sets, staircase, splits, DAG games, and Moore's Nimₖ. Never fork a solver per game.
- Beware the canonical misconceptions: XOR-ing booleans instead of Grundy numbers, applying the wrong play convention, assuming first-player wins, treating partizan or loopy games as impartial, and blowing up Grundy-table memory.

### Decision summary

- **Decrease-one-pile-arbitrarily, normal play** → Bouton XOR-of-sizes, `O(n)`.
- **Bounded / set-restricted take** → Grundy numbers (closed form or periodic), then XOR.
- **Multi-pile move (≤ k piles)** → Moore's base-`(k+1)` per-column divisibility.
- **Disjunctive sum of subgames** → XOR of component Grundy values (Sprague-Grundy, sibling `15`).
- **Misère** → normal rule until the all-ones endgame, then flip parity.
- **Partizan / loopy** → stop; Nim theory does not apply.
- **Unsure** → brute-force oracle on small instances, then derive and reconcile.

References to study further: Sprague-Grundy theorem and `mex` (sibling `15-sprague-grundy`); *Winning Ways for Your Mathematical Plays* (Berlekamp-Conway-Guy); Conway's *On Numbers and Games* for partizan theory; staircase Nim and coin-turning games; Grundy's game and the open question of its eventual periodicity; GF(2) linear algebra and the XOR-basis (linear basis) technique for counting P-positions and span queries; Plambeck-Siegel misère quotients for the general misère theory; and sibling topics `13-dynamic-programming/15-sprague-grundy` and the broader DP material on memoized game solvers.
