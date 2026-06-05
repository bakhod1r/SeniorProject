# Nim and Impartial Game Theory Basics — Interview Preparation

Nim is a favourite interview topic because it rewards a single crisp insight — *"the mover loses iff the XOR of pile sizes is `0`"* — and then tests whether you can (a) derive the explicit winning move, (b) adapt to misère play, (c) recognize Nim/Grundy structure beneath a disguised rule (subtraction games, staircase Nim), and (d) avoid the classic traps (XOR-of-sizes on a restricted move set, applying the normal rule to misère, assuming the first player always wins). This file is a curated question bank by seniority, behavioral prompts, and four end-to-end coding challenges with runnable Go, Java, and Python solutions.

---

## Quick-Reference Cheat Sheet

| Question | Tool | Complexity |
|----------|------|------------|
| Who wins standard Nim (normal play)? | `XOR(p₁..pₙ) != 0` → mover wins | `O(n)` |
| What is the winning move? | target pile with `p ^ X < p`; set to `p ^ X` | `O(n)` |
| Who wins misère Nim? | normal rule unless all piles ≤ 1; then win iff even # of 1-piles | `O(n)` |
| Max-take `m` game (remove 1..m)? | XOR of `pᵢ mod (m+1)`; mover wins iff `≠ 0` | `O(n)` |
| Arbitrary subtraction set `S`? | XOR of Grundy `g(pᵢ)` (compute by mex; eventually periodic) | `O(n + N·|S|)` |
| Moore's Nimₖ (≤ k piles per move)? | lose iff every bit-column count `≡ 0 (mod k+1)` | `O(n · bits)` |
| Staircase Nim? | XOR of stones on **odd** stairs | `O(n)` |
| Grundy of a single Nim pile of size `s`? | `g(s) = s` | `O(1)` |
| Combine independent subgames? | XOR their **Grundy** values (not win/loss booleans) | `O(#games)` |

Core decision (standard Nim):

```text
solveNim(piles):
    X = 0
    for p in piles: X ^= p       # Nim-sum, O(n)
    return "mover WINS" if X != 0 else "mover LOSES"
```

Winning move:

```text
if X != 0:
    for (i, p) in piles:
        if (p ^ X) < p:          # p shares X's top set bit
            return "set pile i to p^X"
```

Key facts:
- **Nim-sum = XOR**, never arithmetic sum.
- **Mover loses iff Nim-sum `= 0`** (P-position). First player does *not* always win.
- **Winning move** sets a pile `p` to `p ^ X` (only legal when `p ^ X < p`).
- **Misère** differs only in the all-ones endgame.
- **Restricted move set** ⇒ pile value is a **Grundy number**, not its size.

---

## Junior Questions (12 Q&A)

### J1. What is the game of Nim?
Several piles of stones; players alternate; a move removes one or more stones from exactly one pile. Under normal play, the player who takes the last stone **wins**. Equivalently, a player who cannot move (all piles empty) loses.

### J2. What is the Nim-sum?
The bitwise XOR of all pile sizes: `X = p₁ ^ p₂ ^ … ^ pₙ`. It is "addition without carry" — each result bit is `1` iff an odd number of piles have a `1` in that bit.

### J3. State Bouton's theorem.
A Nim position is a P-position (losing for the player to move, under optimal play) **iff** its Nim-sum is `0`. If the Nim-sum is nonzero, the mover wins.

### J4. For piles `(3, 4, 5)`, who wins?
`3 ^ 4 ^ 5 = 011 ^ 100 ^ 101 = 010 = 2 ≠ 0`, so the **first player wins**.

### J5. What is a P-position vs an N-position?
A **P**-position is losing for the player about to move (the **P**revious player is winning). An **N**-position is winning for the player about to move (the **N**ext player can force a win). P ⇔ Nim-sum `0`; N ⇔ Nim-sum `≠ 0`.

### J6. How do you find the winning move when the Nim-sum `X ≠ 0`?
Find any pile `p` with `p ^ X < p` (equivalently, `p` has the highest set bit of `X`). Reduce that pile to `p ^ X`. The new Nim-sum becomes `0`.

### J7. Why does reducing a pile to `p ^ X` make the Nim-sum `0`?
Replacing `p` by `p ^ X` changes the total XOR from `X` to `X ^ p ^ (p ^ X) = 0`, because XOR is its own inverse (`a ^ a = 0`).

### J8. Does the order of piles matter?
No. XOR is commutative and associative, so the Nim-sum — and the winner — is independent of pile order.

### J9. Does the first player always win?
No. The first player wins iff the starting Nim-sum is nonzero. If it is `0` (e.g. two equal piles), the first player loses.

### J10. What happens with two equal piles `(a, a)`?
`a ^ a = 0`, a P-position; the first player loses. The second player mirrors every move on the other pile.

### J11. Must a move remove at least one stone?
Yes. A "pass" is illegal; every move strictly decreases exactly one pile (to any value `≥ 0`).

### J12 (analysis). What is the time complexity of solving standard Nim?
`O(n)` for `n` piles — a single XOR pass — independent of how large the piles are. Finding the winning move is another `O(n)` pass.

---

## Middle Questions (12 Q&A)

### M1. Prove the "from Nim-sum 0, every move makes it nonzero" direction.
Changing pile `i` from `p` to `p' ≠ p` makes the new Nim-sum `0 ^ p ^ p' = p ^ p'`, which is `0` only if `p = p'`. A real move requires `p' < p`, so `p ≠ p'`, hence the new Nim-sum is nonzero.

### M2. Prove the "from Nim-sum ≠ 0, some move makes it 0" direction.
Let `b` be the top set bit of `X ≠ 0`. Some pile `p` has bit `b` set (odd count there). Then `p ^ X < p` (the top differing bit drops `1→0`), so reducing `p` to `p ^ X` is legal and yields Nim-sum `0`.

### M3. State the misère Nim rule.
If some pile has `≥ 2` stones: play normal Nim (win iff Nim-sum `≠ 0`). If all piles are `≤ 1`: the mover wins iff the number of size-1 piles is **even**.

### M4. Why does misère differ from normal only in the endgame?
While a pile `≥ 2` exists, a player has the freedom to set the eventual all-ones parity, so the P-positions coincide with normal play. Only when every pile is `≤ 1` is the game forced, flipping the winning parity.

### M5. A move may remove 1 to `m` stones (max-take). Who wins?
The Grundy value of a pile is `g(s) = s mod (m+1)`. The mover wins iff `⊕ᵢ (pᵢ mod (m+1)) ≠ 0`. Plain XOR-of-sizes is wrong here because the move set is restricted.

### M6. Why can't you XOR the pile sizes directly in a subtraction game?
Because the pile's *game value* is its Grundy number, not its size, once moves are restricted. You compute Grundy numbers (via `mex`) and XOR **those**.

### M7. What is `mex`, and what is the Grundy value of a Nim pile?
`mex(A)` is the minimum non-negative integer not in `A`. For a Nim pile of size `s`, options have Grundy values `{0,…,s−1}`, so `g(s) = mex{0,…,s−1} = s`.

### M8. How do you combine independent subgames?
XOR their **Grundy numbers** (Sprague-Grundy). Combining win/loss *booleans* is wrong — booleans do not compose. This is why you need Grundy numbers, not just per-game winners.

### M9. What is staircase Nim and how is it solved?
Stones on stairs; a move slides stones down one stair; stones off the bottom leave play. It reduces to ordinary Nim on the **odd-indexed** stairs: XOR the odd stairs; mover wins iff `≠ 0`. Even-stair stones are mirrorable "free moves."

### M10. What is Moore's Nimₖ and its losing condition?
A move removes stones from up to `k` piles at once. The mover **loses** iff, for every bit position, the count of piles with a `1` there is divisible by `k+1`. For `k=1` this is the ordinary XOR `= 0`.

### M11. How do you build a win/loss table for a single-pile game?
`win[s] = any(not win[t] for t in moves(s))`: the mover wins at `s` iff some move leads to a losing state for the opponent. It is the P/N recurrence as DP.

### M12 (analysis). Are subtraction-game Grundy sequences periodic?
Yes, *eventually*. A finite subtraction set forces eventual periodicity (the Grundy value depends only on a bounded window of recent values, which must eventually repeat by pigeonhole). So you can evaluate `g(huge)` in `O(1)` after detecting the period.

---

## Senior Questions (10 Q&A)

### S1. How do you recognize that a problem is "secretly Nim"?
Check: two players, alternating, impartial (same moves for both), perfect information, no chance, finite and acyclic, and a fixed last-move convention. If so, decompose into independent components, assign Grundy numbers, and XOR.

### S2. How do you handle pile values up to `10^18`?
Standard Nim: a single XOR of 64-bit ints, `O(n)`. Never build a Grundy table indexed by pile size — use closed forms (`g(s)=s`, `g(s)=s mod (m+1)`) or detect the period and evaluate `g(huge)` in `O(1)`.

### S3. How do you prove a position is a P-position?
Show the P/N closure: every legal move leaves an N-position, with the terminal correctly classified. For two equal piles, the mirroring argument; for Nim generally, Bouton via the XOR algebra.

### S4. When does plain XOR-of-sizes fail, and what replaces it?
When the move set is restricted (bounded take, splits, graph games) or generalized (Moore's multi-pile). Replace it with Grundy numbers (then XOR) or, for Moore's Nimₖ, the base-`(k+1)` column-divisibility condition.

### S5. How do you verify a closed-form game result?
Write a brute-force memoized solver from first principles and reconcile it with the closed form over **all** positions with small piles and few piles. This catches misère/normal, bounded-take, and parity errors.

### S6. How does misère change the implementation?
Only the terminal classification flips (a player with no move *wins* under misère) and the all-ones endgame uses the even-parity rule. Encapsulate the convention in the terminal value of the oracle so the rest is shared.

### S7. How do you count how many starting positions are first-player wins?
The Nim-sum is a `GF(2)`-linear map; P-positions are its kernel. Counting becomes rank/nullity over `GF(2)` (or digit DP over the binary representations) — never enumerate games.

### S8. Why XOR specifically, and not ordinary addition?
Because a single Nim pile of Grundy value `v` behaves like the bit-vector `v` under disjunctive sum, and XOR is the group operation that makes "every nonzero total is correctable in one move" hold (self-inverse: `a ^ a = 0`). Sprague-Grundy formalizes this.

### S9. How do you analyze a game on a DAG (token moving along edges)?
The Grundy value of a vertex is `mex` of the Grundy values of its successors; `g(v) = 0` marks P-positions. Memoize over the DAG. Combine independent tokens by XOR.

### S10 (analysis). Why does the P/N induction require acyclicity?
The recursion labels each position from its options, which must be strictly "closer to terminal." If positions can repeat (a cycle/loopy game), termination is not guaranteed and draws/infinite play become possible — the standard P/N theory does not apply.

---

## Professional Questions (8 Q&A)

### P1. Design a service that, given a game position, returns the winner and an optimal move.
Parameterize by a **move generator** and a **play convention**. For standard Nim, the winner is `XOR != 0` and the move is the `p ^ X` target — both `O(n)`. For variants, compute (and cache, with periodicity) Grundy numbers, then XOR. Always run the brute-force oracle in tests to validate the closed form.

### P2. How do you support many different games with one codebase?
A single Grundy/`mex` core with a pluggable `moves(state)` function and a terminal classifier (normal/misère). Standard Nim, max-take, subtraction sets, staircase, splits, DAG games, and Moore's Nimₖ all reuse the same engine; only the rules differ.

### P3. Pile values are astronomically large in a subtraction game. What do you do?
Build a generous Grundy prefix, detect the pre-period `λ` and period `π`, then evaluate `g(huge) = g(λ + (huge − λ) mod π)` in `O(1)`. Never allocate a table sized to the actual pile values.

### P4. How do you debug "wrong winner" reports in production?
Reconcile the closed form against the brute-force oracle on the exact small inputs. Check the usual suspects: normal vs misère terminal value, XOR-of-sizes used on a restricted move set, win/loss booleans XOR-ed instead of Grundy numbers, and staircase parity (odd vs even index).

### P5. When is Nim theory the wrong tool entirely?
Partizan games (players have different moves — need Conway's surreal-number theory), games with chance/hidden information, and loopy (cyclic) games where draws/infinite play are possible. Verify impartiality and acyclicity first.

### P6. How would you count P-positions subject to constraints at scale?
Model the Nim-sum as a `GF(2)`-linear constraint and count kernel elements with rank/nullity, or run a digit DP over the binary expansions of pile values. Both avoid enumerating positions and run in time polynomial in `n` and the bit-width.

### P7. How does Nim connect to the Sprague-Grundy theorem?
Every impartial game position is equivalent to a single Nim pile of size equal to its Grundy value, and disjunctive sums XOR Grundy values. Nim is the special case where each component is already a pile (`g(s)=s`), so "Nim on the Grundy values" *is* Bouton's theorem (sibling `15-sprague-grundy`).

### P8 (analysis). Why is a single boolean "who wins" insufficient to compose subgames?
Because the winning player of a *sum* of games is determined by the XOR of component **Grundy numbers**, which carries strictly more information than each component's win/loss bit. Two losing components can combine to a *winning* sum, and vice versa — booleans cannot capture that; Grundy values can.

---

## Behavioral / System-Design Questions (5 short)

### B1. Tell me about a time you reduced a "search the game tree" approach to a closed form.
Look for: a "who wins" feature initially solved by minimax/search that timed out; the realization the game was impartial and decomposable; the switch to Grundy/XOR; the measured speedup (search → `O(n)`); and crucially the brute-force oracle kept around to validate the closed form.

### B2. A teammate applied XOR-of-pile-sizes to a bounded-take game and shipped a wrong answer. How do you handle it?
Explain calmly that restricting the moves changes the pile's *Grundy value*, so XOR-of-sizes no longer applies; show a tiny counterexample (max-take 2 on a pile of 3 is a P-position because `3 mod 3 = 0`, not because of its size). Pair on adding the Grundy computation and the oracle test. Frame it as teaching, not blame.

### B3. Design a feature that tells a player the optimal move in a stone-removal mini-game.
Identify the move set, classify normal/misère, build the Grundy function (closed form or periodic table), compute the position's XOR, and if nonzero return the move that re-zeroes it. Discuss validating with the oracle, handling huge pile values via periodicity, and clearly surfacing "you are in a losing position" when the XOR is `0`.

### B4. How would you explain Bouton's theorem to a junior engineer?
Start concrete: stones in piles, last stone wins. Show that XOR of the sizes is the magic number — `0` means the mover is doomed, nonzero means they can win by making it `0`. Demonstrate the `p ^ X` move on `(3,4,5)`. Lead with the two gotchas: it is XOR (not sum), and the first player does not always win.

### B5. Your game-analysis job is producing inconsistent results across services. How do you investigate?
Check that every service uses the same play convention (normal vs misère) and the same move set; a single mismatch flips outcomes. Verify they XOR Grundy numbers (not booleans) and use identical periodicity bounds. Add a cross-service determinism test: same inputs must yield identical verdicts and moves.

---

## Coding Challenges

### Challenge 1: Decide Nim Winner and Output the Winning Move

**Problem.** Given pile sizes, decide whether the first player wins (normal play), and if so output one winning move as `(pileIndex, newValue)`.

**Example.**
```text
piles = [3, 4, 5]  ->  WIN; set pile 0 (=3) to 1   (Nim-sum 2, top bit in pile 3)
piles = [1, 1]     ->  LOSE                          (Nim-sum 0)
```

**Constraints.** `1 ≤ n ≤ 10^6`, `0 ≤ pᵢ ≤ 10^18`.

**Approach.** Nim-sum `X = ⊕ pᵢ`. Win iff `X ≠ 0`. The move: first pile with `p ^ X < p`, set to `p ^ X`. `O(n)`.

**Go.**
```go
package main

import "fmt"

func nimSum(piles []int64) int64 {
	var x int64
	for _, p := range piles {
		x ^= p
	}
	return x
}

// returns (win, pileIndex, newValue)
func solve(piles []int64) (bool, int, int64) {
	x := nimSum(piles)
	if x == 0 {
		return false, -1, -1
	}
	for i, p := range piles {
		if (p ^ x) < p {
			return true, i, p ^ x
		}
	}
	return true, -1, -1 // unreachable
}

func main() {
	for _, piles := range [][]int64{{3, 4, 5}, {1, 1}} {
		win, i, v := solve(piles)
		if win {
			fmt.Printf("%v -> WIN; set pile %d to %d\n", piles, i, v)
		} else {
			fmt.Printf("%v -> LOSE\n", piles)
		}
	}
}
```

**Java.**
```java
public class NimWinnerMove {
    static long nimSum(long[] piles) {
        long x = 0;
        for (long p : piles) x ^= p;
        return x;
    }

    // returns {win(1/0), pileIndex, newValue}
    static long[] solve(long[] piles) {
        long x = nimSum(piles);
        if (x == 0) return new long[]{0, -1, -1};
        for (int i = 0; i < piles.length; i++) {
            if ((piles[i] ^ x) < piles[i]) return new long[]{1, i, piles[i] ^ x};
        }
        return new long[]{1, -1, -1};
    }

    public static void main(String[] args) {
        long[][] tests = {{3, 4, 5}, {1, 1}};
        for (long[] piles : tests) {
            long[] r = solve(piles);
            if (r[0] == 1)
                System.out.printf("WIN; set pile %d to %d%n", r[1], r[2]);
            else
                System.out.println("LOSE");
        }
    }
}
```

**Python.**
```python
from functools import reduce
from operator import xor


def nim_sum(piles):
    return reduce(xor, piles, 0)


def solve(piles):
    x = nim_sum(piles)
    if x == 0:
        return (False, None, None)
    for i, p in enumerate(piles):
        if (p ^ x) < p:
            return (True, i, p ^ x)
    return (True, None, None)  # unreachable


if __name__ == "__main__":
    for piles in ([3, 4, 5], [1, 1]):
        win, i, v = solve(piles)
        if win:
            print(f"{piles} -> WIN; set pile {i} to {v}")
        else:
            print(f"{piles} -> LOSE")
```

---

### Challenge 2: Subtraction Game (Max-Take m)

**Problem.** Each move removes between `1` and `m` stones from one pile. Decide whether the first player wins (normal play).

**Example.**
```text
piles = [4, 8], m = 3  ->  4%4 ^ 8%4 = 0 ^ 0 = 0 -> LOSE
piles = [5, 8], m = 3  ->  5%4 ^ 8%4 = 1 ^ 0 = 1 -> WIN
```

**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ pᵢ ≤ 10^18`, `1 ≤ m ≤ 10^9`.

**Approach.** Grundy of a pile is `pᵢ mod (m+1)`. XOR them; win iff `≠ 0`. `O(n)`.

**Go.**
```go
package main

import "fmt"

func maxTakeWins(piles []int64, m int64) bool {
	var x int64
	for _, p := range piles {
		x ^= p % (m + 1)
	}
	return x != 0
}

func main() {
	fmt.Println(maxTakeWins([]int64{4, 8}, 3)) // false
	fmt.Println(maxTakeWins([]int64{5, 8}, 3)) // true
}
```

**Java.**
```java
public class MaxTakeGame {
    static boolean wins(long[] piles, long m) {
        long x = 0;
        for (long p : piles) x ^= p % (m + 1);
        return x != 0;
    }

    public static void main(String[] args) {
        System.out.println(wins(new long[]{4, 8}, 3)); // false
        System.out.println(wins(new long[]{5, 8}, 3)); // true
    }
}
```

**Python.**
```python
def max_take_wins(piles, m):
    x = 0
    for p in piles:
        x ^= p % (m + 1)
    return x != 0


if __name__ == "__main__":
    print(max_take_wins([4, 8], 3))  # False
    print(max_take_wins([5, 8], 3))  # True
```

---

### Challenge 3: Misère Nim

**Problem.** Decide the winner of **misère** Nim (the player taking the last stone **loses**).

**Example.**
```text
piles = [1, 1, 1]  ->  all <=1, three 1-piles (odd) -> first player LOSES
piles = [1, 2, 3]  ->  a pile >=2 exists, Nim-sum = 0 -> first player LOSES
piles = [1, 2, 2]  ->  a pile >=2 exists, Nim-sum = 1 -> first player WINS
```

**Constraints.** `1 ≤ n ≤ 10^6`, `0 ≤ pᵢ ≤ 10^18`.

**Approach.** If all nonempty piles are size 1: win iff the count of 1-piles is even. Otherwise use the normal XOR rule. `O(n)`.

**Go.**
```go
package main

import "fmt"

func misereWins(piles []int64) bool {
	allOnes := true
	count1 := 0
	var x int64
	for _, p := range piles {
		x ^= p
		if p > 1 {
			allOnes = false
		}
		if p == 1 {
			count1++
		}
	}
	if allOnes {
		return count1%2 == 0 // win iff EVEN number of 1-piles
	}
	return x != 0
}

func main() {
	fmt.Println(misereWins([]int64{1, 1, 1})) // false
	fmt.Println(misereWins([]int64{1, 2, 3})) // false
	fmt.Println(misereWins([]int64{1, 2, 2})) // true
}
```

**Java.**
```java
public class MisereNim {
    static boolean wins(long[] piles) {
        boolean allOnes = true;
        int count1 = 0;
        long x = 0;
        for (long p : piles) {
            x ^= p;
            if (p > 1) allOnes = false;
            if (p == 1) count1++;
        }
        if (allOnes) return count1 % 2 == 0;
        return x != 0;
    }

    public static void main(String[] args) {
        System.out.println(wins(new long[]{1, 1, 1})); // false
        System.out.println(wins(new long[]{1, 2, 3})); // false
        System.out.println(wins(new long[]{1, 2, 2})); // true
    }
}
```

**Python.**
```python
def misere_wins(piles):
    all_ones = all(p <= 1 for p in piles)
    if all_ones:
        count1 = sum(1 for p in piles if p == 1)
        return count1 % 2 == 0          # win iff EVEN count of 1-piles
    x = 0
    for p in piles:
        x ^= p
    return x != 0


if __name__ == "__main__":
    print(misere_wins([1, 1, 1]))  # False
    print(misere_wins([1, 2, 3]))  # False
    print(misere_wins([1, 2, 2]))  # True
```

---

### Challenge 4: Staircase Nim

**Problem.** Stones sit on stairs indexed `0, 1, …, m`. A move slides any positive number of stones from stair `i` (with `i ≥ 1`) down to stair `i−1`. Stones reaching stair `0` are out of play. Last move wins (normal play). Decide the winner.

**Example.**
```text
stairs = [0, 3, 0, 4]  ->  odd stairs are indices 1,3 -> 3 ^ 4 = 7 != 0 -> WIN
stairs = [5, 2, 0, 2]  ->  odd stairs 1,3 -> 2 ^ 2 = 0 -> LOSE
```

**Constraints.** `1 ≤ m+1 ≤ 10^5`, `0 ≤ stairs[i] ≤ 10^18`.

**Approach.** Equivalent to ordinary Nim on the **odd-indexed** stairs. XOR stones on odd stairs; win iff `≠ 0`. `O(m)`.

**Go.**
```go
package main

import "fmt"

func staircaseWins(stairs []int64) bool {
	var x int64
	for i := 1; i < len(stairs); i += 2 { // odd indices
		x ^= stairs[i]
	}
	return x != 0
}

func main() {
	fmt.Println(staircaseWins([]int64{0, 3, 0, 4})) // true
	fmt.Println(staircaseWins([]int64{5, 2, 0, 2})) // false
}
```

**Java.**
```java
public class StaircaseNim {
    static boolean wins(long[] stairs) {
        long x = 0;
        for (int i = 1; i < stairs.length; i += 2) x ^= stairs[i];
        return x != 0;
    }

    public static void main(String[] args) {
        System.out.println(wins(new long[]{0, 3, 0, 4})); // true
        System.out.println(wins(new long[]{5, 2, 0, 2})); // false
    }
}
```

**Python.**
```python
def staircase_wins(stairs):
    x = 0
    for i in range(1, len(stairs), 2):  # odd indices only
        x ^= stairs[i]
    return x != 0


if __name__ == "__main__":
    print(staircase_wins([0, 3, 0, 4]))  # True
    print(staircase_wins([5, 2, 0, 2]))  # False
```

---

## Final Tips

- Lead with the one-liner: *"In normal-play Nim the mover loses iff the XOR of pile sizes is `0`; otherwise they win by reducing some pile `p` to `p ^ X`."*
- Immediately flag the gotchas: **XOR, not sum**; **first player does not always win**; and **a restricted move set means you must use Grundy numbers, not pile sizes**.
- For misère, recall it equals normal play until the all-ones endgame, then flip the parity (win iff **even** number of 1-piles).
- For disguised games (subtraction, staircase, splits, DAG), reach for **Grundy numbers + XOR**; mention the eventual **periodicity** of subtraction-game Grundy sequences for huge piles.
- Always offer to verify against a brute-force memoized oracle on small inputs — it catches normal/misère and move-set mistakes.
- If the game is partizan or loopy, say so: Nim theory does **not** apply.
