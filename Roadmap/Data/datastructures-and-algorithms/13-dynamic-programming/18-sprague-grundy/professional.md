# Sprague-Grundy Theorem and Grundy Numbers — Mathematical Foundations

## Table of Contents

1. [Formal Definitions](#1-formal-definitions)
2. [The mex Function: Well-Definedness and Properties](#2-the-mex-function-well-definedness-and-properties)
   - 2.1 Worked computation
   - 2.2 Why the recursion is well-founded
3. [Outcome Classes: P-positions and N-positions](#3-outcome-classes-p-positions-and-n-positions)
   - 3.1 The two structural laws
   - 3.2 Worked outcome reading
4. [Nimbers and Nim: The Prototype](#4-nimbers-and-nim-the-prototype)
   - 4.1 Worked Bouton example
   - 4.2 Nim as the universal prototype
5. [The Sprague-Grundy Theorem (Single Game)](#5-the-sprague-grundy-theorem-single-game)
6. [The XOR Sum Rule (Proof)](#6-the-xor-sum-rule-proof)
   - 6.1 Worked sum-rule computation
   - 6.2 Why XOR and not another operation
7. [Nimber Arithmetic](#7-nimber-arithmetic)
   - 7.1 Worked nim-product
8. [Periodicity of Subtraction Games (Proof)](#8-periodicity-of-subtraction-games-proof)
   - 8.1 A non-trivial periodic example
   - 8.2 Closed-form special case (proof)
9. [Splitting Games and the mex-over-XOR Recurrence](#9-splitting-games-and-the-mex-over-xor-recurrence)
10. [Misère Play and the Limits of the Theory](#10-misère-play-and-the-limits-of-the-theory)
11. [Complexity of Computing Grundy Values](#11-complexity-of-computing-grundy-values)
12. [Summary](#12-summary)

---

## 1. Formal Definitions

We work with finite **impartial** games under the **normal-play** convention.

**Definition 1.1 (Impartial game).** An impartial game is a finite directed acyclic graph `Γ = (V, E)` where vertices `V` are *positions* and an edge `(p, q) ∈ E` means there is a legal move from `p` to `q`. The same edge set applies to both players (impartiality): from `p`, *whoever* is to move may move to any out-neighbor of `p`. Acyclicity (no directed cycle) guarantees every play sequence terminates; finiteness bounds its length.

**Definition 1.2 (Terminal position).** A position `p` with no out-edges (no legal move). Under **normal play**, the player to move at a terminal position **loses**.

**Definition 1.3 (Options).** The set of *options* (successors) of `p` is `Opt(p) = { q : (p, q) ∈ E }`.

**Definition 1.4 (Outcome under optimal play).** Label each position `p` as **N** (the **N**ext player, i.e. the one to move, wins) or **P** (the **P**revious player wins, i.e. the mover loses), by the backward recursion:
- `p` is **P** if `Opt(p) = ∅` (terminal), or if **every** `q ∈ Opt(p)` is **N**.
- `p` is **N** if **some** `q ∈ Opt(p)` is **P**.

This is well-defined by induction on the (finite) longest play from `p`, since `Γ` is a DAG.

**Definition 1.5 (Sum of games).** Given games `Γ₁, …, Γ_m`, their **disjunctive sum** `Γ₁ + … + Γ_m` has positions `(p₁, …, p_m)` and a move consists of choosing one index `i` and replacing `p_i` by some `q_i ∈ Opt(p_i)`, leaving the other components fixed. A terminal position of the sum is one where *every* component is terminal.

**Notation.** `g(p)` (or `G(p)`) is the Grundy number of `p` (Definition 2.3). `⊕` denotes bitwise XOR (nim-sum). `[P]` is the Iverson bracket (`1` if `P` holds, else `0`). `mex S` is the minimum excludant (Definition 2.1). We write `*n` for a Nim pile of size `n` (a "nimber"). "Walk"/"path" terminology is irrelevant here; the only graph is the move DAG.

---

## 2. The mex Function: Well-Definedness and Properties

**Definition 2.1 (mex).** For a set `S ⊆ ℤ_{≥0}`, the **minimum excludant** is

```
mex(S) = min { n ∈ ℤ_{≥0} : n ∉ S }.
```

**Proposition 2.2 (Well-definedness and bound).** For any *finite* `S ⊆ ℤ_{≥0}`, `mex(S)` exists and `0 ≤ mex(S) ≤ |S|`.

**Proof.** The complement `ℤ_{≥0} ∖ S` is nonempty (it is infinite, since `S` is finite), so its minimum exists; that minimum is `mex(S)`. For the bound: the set `{0, 1, …, |S|}` has `|S| + 1` elements, more than `|S|`, so by pigeonhole at least one of them is not in `S`; hence the smallest missing value is `≤ |S|`. ∎

**Proposition 2.3 (mex is the key gadget).** Let `S` be finite and `v = mex(S)`. Then:
- (i) `v ∉ S` (it is excluded);
- (ii) for every `0 ≤ w < v`, `w ∈ S` (everything below `v` is present).

**Proof.** (i) is immediate from the definition. (ii): if some `w < v` were not in `S`, then `w` would be a smaller excludant, contradicting `v = min`. ∎

**Definition 2.4 (Grundy number).** Define `g : V → ℤ_{≥0}` over the move DAG by

```
g(p) = mex { g(q) : q ∈ Opt(p) }.
```

A terminal position has `Opt(p) = ∅`, so `g(p) = mex(∅) = 0`. By induction on the DAG (each `g(p)` depends only on options reachable by a strictly shorter remaining play), `g` is well-defined and unique.

Proposition 2.3 is the structural heart of everything below: from `p`, the mover can move to a position of every Grundy value `0, 1, …, g(p) − 1`, **but not** to a position of Grundy value `g(p)` itself.

### 2.1 Worked computation

Take the subtraction game `Sub({1,2,3})` and compute `g[0..4]` strictly from Definition 2.4:

```
g[0] = mex(∅)                = 0          (terminal: no moves)
g[1] = mex{g[0]}    = mex{0} = 1
g[2] = mex{g[1],g[0]} = mex{1,0} = 2
g[3] = mex{g[2],g[1],g[0]} = mex{2,1,0} = 3
g[4] = mex{g[3],g[2],g[1]} = mex{3,2,1} = 0   (0 is the smallest missing value)
```

Notice how `g[4] = 0` arises: the reachable values `{1,2,3}` *omit* `0`, so the mex is `0` (Proposition 2.3(i)), and the bound `mex ≤ |children| = 3` (Proposition 2.2) is respected throughout. The value `g[4] = 0` will, by Theorem 3.1, mark `4` as a losing position — consistent with the elementary fact that "take 1–3, lose if you cannot move" makes multiples of 4 losing.

Two reading habits this example instills. First, the mex is the smallest *missing* value, never the maximum plus one — at `g[4]` the children reach `{1,2,3}` whose max is `3`, yet the mex is `0`, not `4`. Second, a Grundy value of `0` is special (it marks losing positions) but the magnitudes `1, 2, 3` are *not* ordered by "how winning" — `g[3] = 3` and `g[1] = 1` are both winning, and `3` is not "more winning" than `1`; their only role is as XOR operands in sums (Section 6). Misreading magnitude as strength is a recurring conceptual error that the formal definition rules out.

### 2.2 Why the recursion is well-founded

Definition 2.4 is not circular because the move relation is a **strict** partial order on the (finite) DAG: each option `q ∈ Opt(p)` has a strictly shorter maximum remaining play than `p` (every edge advances toward a terminal). Formally, let `ℓ(p)` be the length of the longest directed path from `p` to a terminal; then `ℓ(q) < ℓ(p)` for every `q ∈ Opt(p)`. Induction on `ℓ(p)` makes `g(p)` depend only on already-defined values, so `g` exists and is unique. Acyclicity is essential: a directed cycle would give a position with `ℓ` undefined (infinite), and the recursion would fail to bottom out — the formal reason loopy games (Section 10) fall outside this theory.

---

## 3. Outcome Classes: P-positions and N-positions

**Theorem 3.1 (Grundy zero ⟺ P-position).** A position `p` is a P-position (mover loses) iff `g(p) = 0`.

**Proof (induction on the DAG).**
- *Base:* terminal `p` has `g(p) = 0` and is a P-position by definition. Consistent.
- *Step:* Assume the claim for all options of `p`.
  - If `g(p) = 0`: then `0 ∉ { g(q) : q ∈ Opt(p) }`... wait — `g(p) = mex` of the options' values being `0` means `0` is the *smallest missing* value, i.e. **no** option has Grundy `0`. By the inductive hypothesis, **every** option is an N-position. By Definition 1.4, `p` is then a P-position. ✓
  - If `g(p) = v > 0`: by Proposition 2.3(ii), `0 < v` implies some option `q` has `g(q) = 0`, hence (inductive hypothesis) `q` is a P-position. By Definition 1.4, `p` is an N-position. ✓

By induction the equivalence holds for all `p`. ∎

Theorem 3.1 already settles *single-game* win/loss: compute `g(p)`, and the mover loses iff it is `0`. The deeper content — *why a position behaves like a Nim pile in sums* — is Sections 5–6.

### 3.1 The two structural laws, made explicit

Theorem 3.1's proof factors into two laws that recur throughout combinatorial game theory and reappear (with XOR) in Theorem 4.3 and Theorem 6.1:

- **(L1) From a P-position, every move leads to an N-position.** If `g(p) = 0`, no child has value `0`, so by induction every child is an N-position. You cannot "stay losing"; any move you make hands your opponent a winning position.
- **(L2) From an N-position, some move leads to a P-position.** If `g(p) > 0`, the mex property guarantees a child of value `0`, i.e. a P-position. You can always "escape to losing-for-them."

These two laws are *equivalent* to the recursive outcome definition (Definition 1.4): any set `P` satisfying (L1) and (L2), with terminals in `P`, equals the set of P-positions. Most outcome proofs in this topic proceed by exhibiting a candidate set `P` and verifying (L1)–(L2) directly — that is exactly the structure of Bouton's proof below.

### 3.2 Worked outcome reading

Continuing the `Sub({1,2,3})` table `g = [0,1,2,3,0,1,2,3,…]`: the P-positions are `{0, 4, 8, 12, …}` (Grundy `0`), the multiples of 4. From `7` (an N-position, `g = 3`), law (L2) says a move to a P-position exists: indeed remove `3` to reach `4`, a P-position. From `4` (a P-position), law (L1) says every move loses: removing `1, 2, 3` reaches `3, 2, 1`, all N-positions (`g = 3, 2, 1 ≠ 0`). The Grundy labeling and the elementary win/loss analysis agree, as Theorem 3.1 guarantees.

---

## 4. Nimbers and Nim: The Prototype

**Definition 4.1 (Nim).** Nim has positions = finite multisets of pile sizes `(a₁, …, a_m)`; a move decreases exactly one `a_i` to any value `0 ≤ a_i' < a_i`. A single pile of size `n` is denoted `*n`.

**Lemma 4.2 (Grundy of a single Nim pile).** `g(*n) = n`.

**Proof (induction on `n`).** `g(*0) = mex(∅) = 0`. For `n ≥ 1`, the options of `*n` are `*0, *1, …, *(n−1)`, whose Grundy values are (inductive hypothesis) `0, 1, …, n−1`. Thus `g(*n) = mex{0, 1, …, n−1} = n`. ∎

**Theorem 4.3 (Bouton's theorem; Nim's XOR rule).** A Nim position `(a₁, …, a_m)` is a P-position iff `a₁ ⊕ a₂ ⊕ … ⊕ a_m = 0`.

**Proof.** Let `P = { positions with nim-sum 0 }`. We verify the two closure properties of Definition 1.4 directly, which characterize the P-positions.

(1) **Every move from a position in `P` leaves `P`.** Suppose `⊕ a_i = 0` and a move changes `a_k` to `a_k' < a_k`. The new nim-sum is `(⊕ a_i) ⊕ a_k ⊕ a_k' = 0 ⊕ a_k ⊕ a_k' = a_k ⊕ a_k'`. Since `a_k' ≠ a_k`, `a_k ⊕ a_k' ≠ 0`. So the new position is not in `P`.

(2) **From every position not in `P`, some move reaches `P`.** Suppose `x := ⊕ a_i ≠ 0`. Let `h` be the position of the highest set bit of `x`. Some pile `a_k` has bit `h` set (otherwise the XOR could not have bit `h`). Set `a_k' := a_k ⊕ x`. Because bit `h` of `a_k` is `1` and bit `h` of `x` is `1`, XOR clears it, and no higher bit changes, so `a_k' < a_k` — a legal move. The new nim-sum is `x ⊕ a_k ⊕ a_k' = x ⊕ a_k ⊕ (a_k ⊕ x) = 0 ∈ P`.

The terminal position `(0, …, 0)` is in `P`. Properties (1)–(2) say `P` is exactly the set of P-positions (a position is P iff all moves leave the P-set and... formally, define outcome by recursion; (1) shows `P`-positions have only `N`-options or are terminal, (2) shows non-`P` positions have a `P`-option, which is precisely Definition 1.4's characterization). ∎

Bouton's theorem is the concrete prototype; the next sections lift it to *all* impartial games.

### 4.1 Worked Bouton example

Consider the Nim position `(3, 5, 6)`. The nim-sum is

```
3 = 011₂
5 = 101₂
6 = 110₂
XOR = 000₂ = 0,
```

so by Theorem 4.3 it is a **P-position** — the mover loses with best play. Now perturb to `(3, 5, 7)`:

```
3 = 011
5 = 101
7 = 111
XOR = 001 = 1 ≠ 0,
```

an N-position. The proof's part (2) constructs the winning move: highest set bit of `x = 1` is bit `0`; a pile with bit `0` set is `3` (or `5` or `7`); set `a_k' = a_k ⊕ x`. Taking `a_k = 7`: `7 ⊕ 1 = 6 < 7`, a legal move (`7 → 6`). New position `(3, 5, 6)` has nim-sum `0` — back to the P-position above. This concrete descent is exactly the abstract argument that Theorem 6.1 generalizes to arbitrary impartial games via the mex property.

### 4.2 The role of Nim as the universal prototype

Lemma 4.2 (`g(*n) = n`) and Theorem 4.3 (XOR rule) together make Nim the *universal* impartial game: by the Sprague-Grundy theorem (Section 5) **every** impartial position is equivalent to some single Nim pile, so understanding Nim completely is understanding the additive structure of all impartial games. The Grundy value is precisely "which Nim pile am I?", and the XOR sum rule is inherited wholesale from Bouton. This is why the entire theory is sometimes phrased as "every impartial game is Nim in disguise."

---

## 5. The Sprague-Grundy Theorem (Single Game)

**Definition 5.1 (Game equivalence).** Two impartial games `G` and `H` are **equivalent**, written `G ≡ H`, if for *every* impartial game `X`, the sums `G + X` and `H + X` have the same outcome (both P or both N).

**Theorem 5.2 (Sprague-Grundy).** Every impartial game position `p` is equivalent to the single Nim pile `*g(p)`; that is, `p ≡ *g(p)`.

We prove this via the sum rule, which is the technical core. We first prove the sum rule (Section 6) and then deduce the equivalence. To keep the logic clean, we state the sum rule now and prove it next.

**Theorem 6.1 (Sum rule, restated here).** `g(G + H) = g(G) ⊕ g(H)`. Inductively, `g(G₁ + … + G_m) = g(G₁) ⊕ … ⊕ g(G_m)`.

**Proof of Theorem 5.2 from Theorem 6.1.** Fix any test game `X`. By the sum rule, `g(p + X) = g(p) ⊕ g(X)` and `g(*g(p) + X) = g(*g(p)) ⊕ g(X)`. By Lemma 4.2, `g(*g(p)) = g(p)`. Hence `g(p + X) = g(p) ⊕ g(X) = g(*g(p) + X)`. By Theorem 3.1, the outcome of a sum is determined by whether its Grundy value is `0`, so `p + X` and `*g(p) + X` have the same outcome for every `X`. Therefore `p ≡ *g(p)`. ∎

So once the XOR sum rule is proved, the equivalence to a Nim pile follows immediately. We now prove the sum rule.

### 5.1 What "equivalence to a Nim pile" buys you

Theorem 5.2 says `p ≡ *g(p)`: in *any* context, replacing the sub-game at `p` by a Nim pile of `g(p)` stones changes nothing about who wins. This is far stronger than Theorem 3.1 (which only decides `p` in isolation). The strength is *compositional*: it licenses you to compute each component's Grundy value separately and then treat the whole as multi-pile Nim. Concretely, a game that is "a Kayles row of 7 + a subtraction pile of 5 + a coin-turning row" can be collapsed to "a Nim position `(g_Kayles(7), g_Sub(5), g_Coins)`" and solved by Bouton's XOR. The Sprague-Grundy theorem is exactly the license to mix heterogeneous impartial games and still apply one uniform rule.

### 5.2 Worked equivalence

Consider Grundy's game on a pile of `5` (split into two unequal nonzero piles). Its options are the sums `(1,4)` and `(2,3)` (the split `(a,b)` with `a≠b`), with Grundy values `g(1)⊕g(4)` and `g(2)⊕g(3)`. From the Grundy's-game table `g = [0,0,0,1,0,2,…]`: `g(1)⊕g(4) = 0⊕0 = 0` and `g(2)⊕g(3) = 0⊕1 = 1`. So `g(5) = mex{0, 1} = 2`. By Theorem 5.2, a Grundy's-game pile of `5` is *equivalent to a Nim pile of size 2* — you may substitute `*2` for it in any sum without affecting outcomes. That substitution is what makes a position like "Grundy-pile-5 + Nim-pile-2" decidable as `2 ⊕ 2 = 0` (a loss), with no need to analyze the coupled product game.

---

## 6. The XOR Sum Rule (Proof)

**Theorem 6.1.** For impartial games `G, H`, `g(G + H) = g(G) ⊕ g(H)`.

**Proof.** It suffices to prove it for two summands; the general case follows by induction on the number of summands (associativity of `+` and of `⊕`). Fix a position `(p, q)` of `G + H`, and write `a = g(p)`, `b = g(q)`. We must show `g((p, q)) = a ⊕ b`, i.e. that the value `s := a ⊕ b` satisfies the mex characterization at `(p, q)`:

- (A) **No option of `(p, q)` has Grundy value `s`** (so `s` is excluded);
- (B) **For every `0 ≤ t < s`, some option of `(p, q)` has Grundy value `t`** (so everything below `s` is present).

Together (A) and (B) say `mex` of the options' Grundy values is exactly `s`. We use, as inductive hypothesis, that the sum rule holds for all positions strictly below `(p, q)` in the (product) DAG (i.e. all options of `(p, q)`), so the Grundy value of an option `(p', q)` is `g(p') ⊕ b` and of `(p, q')` is `a ⊕ g(q')`.

**Proof of (A).** An option of `(p, q)` is either `(p', q)` with `p' ∈ Opt(p)`, or `(p, q')` with `q' ∈ Opt(q)`.
- For `(p', q)`: its Grundy value is `g(p') ⊕ b`. If this equalled `s = a ⊕ b`, then `g(p') ⊕ b = a ⊕ b`, so `g(p') = a = g(p)`. But by Proposition 2.3(i), `g(p)` is *not* among the Grundy values of `p`'s options, so no `p' ∈ Opt(p)` has `g(p') = a`. Contradiction.
- Symmetrically for `(p, q')`: would force `g(q') = b = g(q)`, impossible.

So no option has Grundy value `s`. ✓

**Proof of (B).** Let `0 ≤ t < s = a ⊕ b`. Let `h` be the position of the highest bit where `t` and `s` differ. Because `t < s` and they first differ (from the top) at bit `h`, bit `h` of `s` is `1` and of `t` is `0`. Since `s = a ⊕ b`, bit `h` is set in exactly one of `a, b`; WLOG say it is set in `a` (the other case is symmetric, moving in `H`).

Consider `a' := a ⊕ (s ⊕ t)`. Note `s ⊕ t` has its highest set bit at `h` (since that is the top differing bit), and bit `h` of `a` is `1`, so XOR-ing clears bit `h` of `a` and changes no higher bit; hence `a' < a`. By Proposition 2.3(ii) applied to `p` (since `a' < a = g(p)`), there is an option `p' ∈ Opt(p)` with `g(p') = a'`. Move to `(p', q)`. Its Grundy value (inductive hypothesis) is `g(p') ⊕ b = a' ⊕ b = a ⊕ (s ⊕ t) ⊕ b = (a ⊕ b) ⊕ (s ⊕ t) = s ⊕ (s ⊕ t) = t`.

So an option with Grundy value `t` exists. ✓

By (A) and (B), `g((p, q)) = mex{ Grundy values of options } = a ⊕ b = g(p) ⊕ g(q)`. Induction over the DAG completes the proof. ∎

**Remark.** The proof is the abstract form of Bouton's argument (Theorem 4.3): "(A) you cannot keep the XOR fixed by a single-component move," "(B) you can reach any smaller target XOR." The mex property (Proposition 2.3) is exactly what makes a component reach every smaller Grundy value, which is the only fact about the components the proof uses.

**Remark (induction well-foundedness).** The induction in Theorem 6.1 is on the product DAG of `G + H`: the "size" of `(p, q)` is `ℓ(p) + ℓ(q)` (sum of the longest-remaining-play lengths, Section 2.2), and every move strictly decreases exactly one summand, hence the total. So the inductive hypothesis legitimately applies to every option, and the recursion bottoms out at the doubly-terminal position `(terminal, terminal)` with Grundy `0 ⊕ 0 = 0`. The same well-foundedness underlies the `m`-summand generalization, where the measure is `Σ_i ℓ(p_i)`.

**Corollary 6.2 (Compound-game decision).** A sum `G₁ + … + G_m` is a P-position (mover loses) iff `g(G₁) ⊕ … ⊕ g(G_m) = 0`. (Combine Theorem 6.1 with Theorem 3.1.)

### 6.1 Worked sum-rule computation

Take three independent `Sub({1,2,3})` piles of sizes `5, 6, 7` (the junior walkthrough's example), with Grundy values `g[5] = 1, g[6] = 2, g[7] = 3`. By Theorem 6.1,

```
g(5 + 6 + 7) = 1 ⊕ 2 ⊕ 3 = 0,
```

so by Corollary 6.2 the position is a P-position: the mover loses. Now trace the constructive content of the proof's part (B). Suppose instead the piles were `5, 6, 4` with values `1, 2, 0`, total `x = 1 ⊕ 2 ⊕ 0 = 3 ≠ 0` — an N-position. To win, find the winning move:

1. Highest set bit of `x = 3 = 11₂` is bit `1` (value 2).
2. A component with bit `1` set in its Grundy value: pile `6` (value `2 = 10₂`). 
3. Target Grundy `t = 2 ⊕ 3 = 1`, and `1 < 2`, so a legal move exists.
4. Move within the pile-of-`6` component to a child with Grundy `1`: remove `1` to reach pile `5` (`g[5] = 1`). New total: `1 ⊕ 1 ⊕ 0 = 0`, a P-position.

This is exactly the algorithm justified by part (B) of Theorem 6.1's proof: clear the top differing bit in a component that carries it, landing on the target Grundy value, which the mex property guarantees is reachable.

### 6.2 Why XOR and not another operation

A natural question: could some operation other than XOR satisfy the sum rule? No. The sum rule's proof used only (i) that a component reaches every smaller Grundy value but not its own (the mex property), and (ii) the bitwise structure that makes "clear the top differing bit" a valid descent. XOR is the unique binary operation `∗` on `ℤ_{≥0}` such that `(ℤ_{≥0}, ∗, 0)` is a group in which `a ∗ a = 0` and `mex` behaves as in Nim — concretely, it is the group operation of `⊕_{i} ℤ/2ℤ` under the binary encoding. Any candidate operation must agree with XOR on single Nim piles (since `g(*a + *b)` is forced by playing the two piles), and Nim's analysis pins it to XOR (Theorem 4.3). So XOR is not a choice; it is *derived*.

---

## 7. Nimber Arithmetic

Nimbers are the values `*0, *1, *2, …`. Theorem 6.1 shows they add by XOR. There is also a multiplication making them a field.

**Definition 7.1 (Nim-sum and nim-product).** Nim-sum `*a ⊕ *b = *(a XOR b)`. Nim-product `⊗` is defined by the recursive mex rule (Conway):

```
a ⊗ b = mex { (a' ⊗ b) ⊕ (a ⊗ b') ⊕ (a' ⊗ b') : a' < a, b' < b }.
```

**Theorem 7.2 (Field of nimbers).** Under `⊕` and `⊗`, the non-negative integers form a field `On₂` (the "nimber field"); restricted to `{0, …, 2^{2^k} − 1}` they form the finite field `GF(2^{2^k})`. In particular every nimber has an additive inverse (itself, since `a ⊕ a = 0`) and every nonzero nimber has a multiplicative inverse.

**Basic identities (all over `⊕`).**
- `a ⊕ a = 0` (self-inverse), `a ⊕ 0 = a`.
- `⊕` is associative and commutative.
- Cancellation: `a ⊕ x = a ⊕ y ⇒ x = y`.

These are exactly the properties the sum-rule proof used. The multiplicative structure (`⊗`) is needed for games like **Turning Turtles in 2D** and coin-turning games on grids, where the Grundy value of a product position is a nim-*product* of coordinates — but for the disjunctive sums of Sections 5–6, only `⊕` appears.

**Fermat-2-power fact.** `*a ⊗ *b` for `a, b < 2^{2^k}` stays within `GF(2^{2^k})`; e.g. on `{0,1,2,3} = GF(4)`, `2 ⊗ 2 = 3`, `2 ⊗ 3 = 1`. This finite-field structure is what makes 2-dimensional coin-turning games solvable in closed form.

### 7.1 Worked nim-product

Compute `2 ⊗ 3` from Definition 7.1 (so `a = 2`, `b = 3`):

```
2 ⊗ 3 = mex { (a'⊗b) ⊕ (a⊗b') ⊕ (a'⊗b') : a' < 2, b' < 3 }
```

The pairs `(a', b')` range over `a' ∈ {0,1}`, `b' ∈ {0,1,2}`. Using the smaller products `0⊗x = 0`, `1⊗x = x`, `2⊗0 = 0`, `2⊗1 = 2`, `2⊗2 = 3`:

```
(a'=0,b'=0): 0 ⊕ 0 ⊕ 0 = 0
(a'=0,b'=1): 0 ⊕ (2⊗1=2) ⊕ 0 = 2
(a'=0,b'=2): 0 ⊕ (2⊗2=3) ⊕ 0 = 3
(a'=1,b'=0): (1⊗3=3) ⊕ 0 ⊕ 0 = 3
(a'=1,b'=1): (1⊗3=3) ⊕ (2⊗1=2) ⊕ (1⊗1=1) = 3⊕2⊕1 = 0
(a'=1,b'=2): (1⊗3=3) ⊕ (2⊗2=3) ⊕ (1⊗2=2) = 3⊕3⊕2 = 2
```

The reachable set is `{0, 2, 3}`, so `2 ⊗ 3 = mex{0,2,3} = 1`. This matches the `GF(4)` multiplication table, where `{0,1,2,3}` form the field of order 4 with `2` a primitive element (`2² = 3`, `2³ = 2⊗3 = 1`). The nim-product is needed only for *2-dimensional* coin-turning games (turning coins on a grid, where the move's effect factors as a product of row and column single-coin games); the disjunctive sums of Sections 5–6 use only `⊕`.

---

## 8. Periodicity of Subtraction Games (Proof)

**Definition 8.1 (Subtraction game).** Fix a finite set `S = {s₁ < s₂ < … < s_r} ⊆ ℤ_{>0}` with `M := max(S) = s_r`. The game `Sub(S)` on a pile of `n` allows removing any `s ∈ S` with `s ≤ n`. Its Grundy sequence is `g[0] = 0`, `g[x] = mex{ g[x − s] : s ∈ S, s ≤ x }`.

**Lemma 8.2 (Value bound).** `0 ≤ g[x] ≤ r = |S|` for all `x` (Proposition 2.2: mex of at most `r` values is `≤ r`).

**Theorem 8.3 (Eventual periodicity).** The sequence `(g[x])_{x ≥ 0}` is eventually periodic: there exist `n₀ ≥ 0` and `π ≥ 1` with `g[x + π] = g[x]` for all `x ≥ n₀`.

**Proof.** For `x ≥ M`, the value `g[x]` is a deterministic function `F` of the *window* `W_x := (g[x − 1], g[x − 2], …, g[x − M])` — specifically `g[x] = mex{ g[x − s] : s ∈ S }`, and each `g[x − s]` is one of the `M` entries of `W_x` (since `s ≤ M`). By Lemma 8.2 each entry lies in `{0, 1, …, r}`, so there are at most `(r + 1)^M` distinct windows. Consider the infinite sequence of windows `W_M, W_{M+1}, W_{M+2}, …`; by pigeonhole two of them are equal: `W_a = W_b` for some `M ≤ a < b`. Let `π = b − a`.

Now we show `g[x + π] = g[x]` for all `x ≥ a` by strong induction. The base windows `W_a = W_{a+π}` give equality of the `M` entries `g[a−1..a−M] = g[a+π−1 .. a+π−M]`. For `x ≥ a`: the window `W_x` and `W_{x+π}` are equal by induction (their entries are previously-established equal values), and since `g[x] = F(W_x)` and `g[x+π] = F(W_{x+π})` with the same `F`, we get `g[x] = g[x + π]`. Taking `n₀ = a` completes the proof. ∎

**Corollary 8.4 (One-window certification).** If for some `n₀ ≥ M` and candidate period `π` we observe `g[n₀ + i] = g[n₀ + π + i]` for all `0 ≤ i < M` (one full window of length `M` matches), then `g[x + π] = g[x]` for **all** `x ≥ n₀`. (Same induction as Theorem 8.3, started from the matching window.)

This is the rigorous basis for the practical "detect the period, then look up `g[n₀ + (n − n₀) mod π]`" used in [`senior.md`](./senior.md): you must verify a *full* window of length `M`, after which periodicity is guaranteed forever.

**Corollary 8.5 (Period bound).** A period `π ≤ (r + 1)^M` always exists with pre-period `n₀ ≤ (r + 1)^M`. (Crude pigeonhole bound; observed periods are usually far smaller — e.g. `Sub({1,2,…,k})` has `g[x] = x mod (k+1)`, period `k + 1`.)

**Why the bound is rarely tight.** The pigeonhole count `(r+1)^M` treats every window in `{0,…,r}^M` as reachable, but the deterministic map `F` constrains which windows can follow which, so the *reachable* windows form a tiny subset of the `(r+1)^M` combinatorial possibilities. In practice the period of a subtraction game is small (often `≤ 2·max(S)`), which is why a modest tabulation bound like `50·max(S)+200` (used in [`senior.md`](./senior.md) and [`tasks.md`](./tasks.md)) reliably exposes it. The exponential bound matters only as a *termination guarantee*: it proves a period *exists* and is *findable*, justifying the search even though the search almost always halts far sooner. Octal games (Section 9) inherit the same "finite-window ⇒ eventual periodicity" structure, which is why so many of them have been resolved by finite computation — though, as noted, some (and Grundy's game in particular) resist a proof of periodicity entirely.

**Example 8.6.** `S = {1, 2, 3}`: `M = 3`, `r = 3`. The sequence is `0,1,2,3,0,1,2,3,…`, window `(3,2,1)` recurs immediately, period `π = 4 = k+1` with `k = 3`. Losing positions are multiples of 4, matching the junior walkthrough.

### 8.1 A non-trivial periodic example

`S = {2, 5, 7}` (`M = 7`, `r = 3`). Computing from Definition 8.1:

```
n   : 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 ...
g[n]: 0 0 1 0 1 1 0 1 0 1  2  0  1  0  1 ...
```

Each `g[n]` for `n ≥ 7` is `mex{ g[n-2], g[n-5], g[n-7] }`. The values stay in `{0,1,2}` (bounded by `r = 3`), the window of the last `7` values eventually recurs, and from that point the sequence is periodic. The crucial certification rule (Corollary 8.4) is that once a *full* window of length `M = 7` matches a later window, periodicity is locked in forever — checking only a handful of terms is unsound, because two windows can agree on a prefix yet diverge on the unexamined entries, producing different successors.

### 8.2 Closed-form special case (proof)

**Proposition 8.7.** For `S = {1, 2, …, k}`, `g[n] = n mod (k+1)` for all `n ≥ 0`.

**Proof (induction on `n`).** Base `n = 0`: `g[0] = 0 = 0 mod (k+1)`. Step: assume `g[m] = m mod (k+1)` for all `m < n`. The reachable values are `{ g[n-1], g[n-2], …, g[n-min(n,k)] } = { (n-1) mod (k+1), …, (n - min(n,k)) mod (k+1) }`. These are `min(n,k)` consecutive residues just below `n mod (k+1)` (cyclically). If `n mod (k+1) = 0`, the reachable set is `{ (k), (k-1), …, (k+1 - k) } = {1, 2, …, k}` (omitting `0`), so the mex is `0`. If `n mod (k+1) = j > 0`, the reachable set contains exactly `{0, 1, …, j-1}` (the `j` residues below `j`, since at least `j ≤ k` predecessors are available), so the mex is `j`. Either way `g[n] = n mod (k+1)`. ∎

This is the cleanest instance of "closed form beats table": queries are `O(1)` with no periodicity-detection step at all, and the losing positions are exactly the multiples of `k+1`.

**Generalization.** The same inductive technique proves closed forms for several other families: `Sub({1})` (alternate, `g[n] = n mod 2`, losing iff `n` even); `Sub({a})` for a single move `a` (`g[n] = ⌊n/a⌋ mod 2`); and "all-but" sets. Whenever the reachable residues form a contiguous block ending just below the target, the mex collapses to a simple modular expression. When they do not (e.g. `S = {2, 3}`), no such clean residue formula exists and you fall back to the *proven-periodic* description of Theorem 8.3. The hierarchy of preference is therefore: closed form (if provable) ⟶ proven period (Corollary 8.4) ⟶ direct tabulation within feasible `n` — each strictly weaker but more broadly applicable than the last.

---

## 9. Splitting Games and the mex-over-XOR Recurrence

**Definition 9.1 (Splitting move).** A move on a region `R` of "size" `n` may replace it by *two independent regions* of sizes `a` and `b` (with `a + b` determined by the move's rule). The resulting position is the **sum** of the two regions.

**Proposition 9.2.** For a game whose only moves split a size-`n` region into independent regions, with `m(n)` the set of reachable splits `(a, b)`,

```
g(n) = mex { g(a) ⊕ g(b) : (a, b) ∈ m(n) }.
```

**Proof.** Each split move leads to a position that is the disjunctive sum of the two regions. By the sum rule (Theorem 6.1), that position has Grundy value `g(a) ⊕ g(b)`. The set of options' Grundy values is therefore `{ g(a) ⊕ g(b) : (a,b) ∈ m(n) }`, and `g(n)` is its mex by Definition 2.4. ∎

**Instances.**
- **Grundy's game** (split into two *unequal* nonzero piles): `g(n) = mex{ g(a) ⊕ g(b) : a + b = n, a ≠ b, a,b ≥ 1 }`. Its long-term periodicity is a famous *open problem*.
- **Kayles** (remove 1 or 2 adjacent pins from a row, splitting it): an octal game with Grundy sequence eventually periodic of period `12` (after a finite prefix), a Guy-Smith result.
- **Dawson's chess** (octal game `0.137`): also eventually periodic.

The general class of take-and-break games encoded by **octal codes** (Guy-Smith) yields exactly such mex-over-XOR recurrences, and a large literature establishes (or conjectures) their periods.

### 9.1 Worked Grundy's-game derivation

Compute `g[0..6]` for Grundy's game (split into two unequal nonzero piles) directly from Proposition 9.2:

```
g[0] = mex(∅) = 0     (no split possible)
g[1] = mex(∅) = 0     (cannot split 1 into two positive parts)
g[2] = mex(∅) = 0     (only split is 1+1, but parts must be unequal)
g[3]: splits {1+2}        → {g1⊕g2} = {0⊕0} = {0}          → mex = 1
g[4]: splits {1+3}        → {g1⊕g3} = {0⊕1} = {1}          → mex = 0
g[5]: splits {1+4, 2+3}   → {0⊕0, 0⊕1} = {0,1}             → mex = 2
g[6]: splits {1+5, 2+4}   → {0⊕2, 0⊕0} = {2,0}             → mex = 1
```

So `g[0..6] = 0,0,0,1,0,2,1`. The XOR *inside* the mex is the visible fingerprint of Proposition 9.2: each split produces a disjunctive sum of two piles, whose joint Grundy value is the XOR (Theorem 6.1). Replacing `g(a) ⊕ g(b)` by `g(a)` or by `g(a) + g(b)` would give a different — and wrong — sequence, which is exactly the bug `senior.md` §10.3 warns against. Grundy's game is notable in that, despite this clean recurrence, no period has ever been proven for its Grundy sequence (an open problem since the 1930s), in sharp contrast to the *provably* periodic subtraction games of Section 8.

### 9.2 Octal games and the take-and-break framework

An **octal game** is specified by a code `0.d₁d₂d₃…` where digit `d_k ∈ {0,…,7}` encodes which of three outcomes are legal when removing `k` tokens from a heap: bit 1 = "remove the whole heap" (legal only if it leaves nothing), bit 2 = "remove `k`, leave one nonempty heap", bit 4 = "remove `k`, split the remainder into two nonempty heaps". Nim is `0.333…` (remove any number, leave 0/1/2 heaps), Kayles is `0.77`, Dawson's chess is `0.137`. Every octal game's Grundy recurrence is a mex over XORs of sub-heaps — the universal form of Proposition 9.2. Guy and Smith proved that *if* an octal game's Grundy sequence is ever periodic on a sufficiently long window (length `2·(period) + max-heap-effect`), it is periodic forever — the octal-game analog of Corollary 8.4 — reducing period verification to a finite computation.

**Coin-turning games (decomposition by single coins).** For coin-turning games, where a move turns a set of coins with the rightmost turning head→tail, the position decomposes as the XOR of single-coin positions:

**Theorem 9.3 (Coin-turning decomposition).** The Grundy value of a coin-turning position equals the XOR, over all "heads" coins, of the Grundy value of the position having a single head at that coordinate.

**Proof sketch.** Any move's effect on the whole position equals the XOR of its effects on the single-coin sub-positions (the "rightmost head→tail" rule makes the sub-games independent and the move set a sum), so the game is the disjunctive sum of single-coin games; apply Theorem 6.1. (Full treatment: Berlekamp-Conway-Guy.) ∎

**Worked instance ("Turning Turtles").** In Turning Turtles, a move turns over one coin, *or* turns over two coins where the rightmost goes heads→tails. The single-coin Grundy value at position `i` (1-indexed from the left) is `g_i = i`: a lone head at `i` can be turned to tails (reaching the terminal `0`) or paired with a flip of any coin `j < i` to its left, reaching a single-head position at `j` (Grundy `j`); so `g_i = mex{0, 1, …, i-1} = i`. Hence the Grundy value of a row is `⊕_{i : coin i is heads} i`, and the position is losing iff that XOR is `0`. For example heads at positions `{1, 2, 3}` give `1 ⊕ 2 ⊕ 3 = 0` — a P-position — even though three coins are face-up; this is precisely the Nim XOR on the head positions.

---

## 10. Misère Play and the Limits of the Theory

**Definition 10.1 (Misère play).** Same game, but the player who makes the **last** move *loses* (equivalently, the player who *cannot* move *wins*).

**The XOR rule fails under misère.** Theorem 3.1 and the sum rule are proved under normal play; the backward recursion's base case flips for misère, and the resulting outcome function is *not* captured by a single XOR of Grundy values in general.

**Theorem 10.2 (Misère Nim — Bouton's misère rule).** In misère Nim, the previous player (mover loses) wins iff: every pile has size `≤ 1` and the number of piles of size `1` is **odd**; OR some pile has size `≥ 2` and the nim-sum is `0`. Strategy: play normal Nim until your move would leave all piles `≤ 1`, then leave an *odd* number of `1`-piles.

**Proof idea.** Identical to normal Nim away from the all-small endgame; the only positions where misère differs from normal play are those with all piles `≤ 1`, handled by the parity rule. A short case analysis on the endgame completes it (Bouton 1901). ∎

**Worked misère contrast.** Position `(1, 1, 1)` (three piles of one stone).
- *Normal play:* nim-sum `1 ⊕ 1 ⊕ 1 = 1 ≠ 0`, an N-position — the mover **wins** (take one pile, leaving `(1,1)` with nim-sum `0`, a loss for the opponent).
- *Misère play:* all piles are `≤ 1` with an **odd** number (3) of 1-piles. By Theorem 10.2's all-small rule, the previous player wins iff the count of 1-piles is odd — so this is a P-position and the mover **loses**. (Whoever is forced to take the *last* stone loses; with three stones and forced single removals, the mover takes the 1st and 3rd, i.e. the last — a loss.)

The *same position* `(1,1,1)` is a win under normal play and a loss under misère. No fixed function of the normal-play Grundy values can produce both verdicts, which is the precise sense in which "misère = flip the answer" is false and why general misère theory (genus, misère quotients) is genuinely harder.

**General misère theory.** For arbitrary impartial games, misère analysis requires the **genus** of a game (a pair encoding normal Grundy value and misère-relevant data) or, in full generality, the **misère quotient** (Plambeck-Siegel): the monoid of game values under disjunctive sum modulo misère-indistinguishability. These can be enormous and have no simple closed form. The practical lesson: misère is *not* "normal-play with a flipped final answer"; only special ("tame") games admit a clean correction.

**Loopy and partizan games.** If `Γ` has a directed cycle, it is not a DAG, Definition 2.4's recursion need not terminate, and Grundy values may be undefined — **loopy game theory** assigns values including draws (`∞`). If the two players have *different* option sets (partizan), there is no Grundy number; one uses **surreal numbers** / the partizan theory of `On₂` with Left/Right options. Sprague-Grundy is *exactly* the theory of finite impartial normal-play games — no more.

---

## 11. Complexity of Computing Grundy Values

**Theorem 11.1 (DAG cost).** Computing `g(p)` for all positions of a move DAG `Γ = (V, E)` takes `O(|V| + |E| + Σ_p cost(mex at p))` time. With a mex implemented by a boolean array sized by the out-degree, the total mex cost is `O(Σ_p deg(p)) = O(|E|)`, giving `O(|V| + |E|)`.

**Proof.** Topologically sort `Γ` (or memoize via DFS); each position is processed once. At `p`, gather the Grundy values of its `deg(p)` options into a boolean scratch array of size `deg(p) + 1` and scan for the mex in `O(deg(p))` (Proposition 2.2 bounds the mex by `deg(p)`). Summing over `p` gives `O(|E|)` for all mex computations, plus `O(|V| + |E|)` for traversal. ∎

**Subtraction games.** `Sub(S)` on `0..n` costs `O(n · |S|)` time and `O(n)` space (Definition 8.1). For `n` beyond the period bound, periodicity (Theorem 8.3) gives `O(period)` precompute and `O(1)` per query.

**Hardness in general.** The *size* of `Γ` can be exponential in the natural input (e.g. a Nim position with `m` piles has Grundy computable in `O(m)` directly, but a game whose positions are subsets of an `n`-element ground set has `2^n` positions). Deciding the winner of some succinctly-described impartial games is **PSPACE-complete** (e.g. *Generalized Geography*, *Node Kayles* on general graphs). So while the *theory* assigns a Grundy value to every position, *computing* it can be intractable when the state space is exponential and lacks decomposition or periodicity structure. The tractable cases are precisely those that decompose (XOR over small components), are periodic (subtraction/octal), or have a closed form.

**Proposition 11.2 (Decomposition complexity).** If a position decomposes into `m` independent components each with a Grundy value computable in `T`, the whole position's outcome is computed in `O(mT + m)` (compute each, XOR). This is the source of all practical efficiency: it converts a product state space `∏ |V_i|` into a sum `Σ |V_i|`.

**Proof.** A position of the disjunctive sum is the tuple `(p₁, …, p_m)`. Naively, the sum's move DAG has `∏ |V_i|` positions (every combination), so a direct win/loss computation is `O(∏ |V_i|)` — exponential in `m`. By Theorem 6.1, however, `g((p₁,…,p_m)) = ⊕_i g(p_i)`, and each `g(p_i)` is computed independently within its own component DAG in time `T` (typically `O(|V_i| + |E_i|)` by Theorem 11.1). Summing the per-component costs and the `O(m)` XOR gives `O(mT + m)`. The exponential `∏` collapses to the additive `Σ` precisely because the sum rule lets each component be analyzed in isolation. ∎

**Remark (the practical dividing line).** Proposition 11.2 explains *why* some impartial games are easy and others are PSPACE-complete. The easy ones (Nim, subtraction games, Kayles, staircase Nim, coin-turning) admit a decomposition into small or periodic components, so the additive bound applies. The hard ones (Generalized Geography, Node Kayles on arbitrary graphs) have a single, irreducibly large, non-decomposable position whose Grundy value requires exploring an exponential DAG with no XOR shortcut. The theory assigns every position a Grundy value either way; tractability is entirely about whether the structure permits the `∏ → Σ` collapse, the period collapse (Theorem 8.3), or a closed form (Proposition 8.7).

### 11.1 Worked complexity comparison

Consider `m` independent `Sub({1,2,3})` piles, each of size at most `n`.

- **Monolithic:** the product DAG has `≈ (n+1)^m` positions; a direct win/loss memoization is `O((n+1)^m)` — for `n = 10, m = 6` that is `≈ 1.7 × 10⁶` and grows astronomically with `m`.
- **Decomposed:** one Grundy table `g[0..n]` in `O(n · 3)`, then `O(m)` XORs. For `n = 10, m = 6` that is `≈ 30 + 6` operations.

The gap is the entire reason the theory is used: Proposition 11.2's `∏ → Σ` collapse converts an intractable exponential into a trivial linear computation. For a *single* `Sub` pile with huge `n = 10^18`, even the `O(n)` table is infeasible, and periodicity (`g[n] = n mod 4`, Proposition 8.7) reduces it to `O(1)`. The three tractability mechanisms — decomposition (Prop 11.2), periodicity (Thm 8.3), closed form (Prop 8.7) — are precisely the tools that keep Grundy analysis polynomial (or constant) despite an exponential underlying state space.

### 11.2 Succinct games and PSPACE-completeness

When the game is presented *succinctly* (a graph, a formula) rather than as an explicit position list, deciding the winner can be PSPACE-complete:

| Game | Presentation | Winner-decision complexity |
|------|--------------|----------------------------|
| Nim | pile sizes | `O(m)` (XOR) |
| Subtraction `Sub(S)` | `S`, `n` | `O(n·|S|)` or `O(1)` (periodicity) |
| Kayles | row lengths | `O(N)` (precomputed periodic table) |
| Generalized Geography | a directed graph | **PSPACE-complete** |
| Node Kayles | a general graph | **PSPACE-complete** |

The PSPACE-complete cases are impartial and *have* Grundy values, but computing them is as hard as evaluating a quantified Boolean formula (the canonical PSPACE problem) — there is no decomposition, periodicity, or closed form to exploit. This is the formal ceiling of the theory: Sprague-Grundy is a *characterization*, not a free *efficient algorithm*; efficiency requires exploitable structure.

---

## 12. Summary

- **mex** (Definition 2.1) is well-defined on finite sets with `mex(S) ≤ |S|` (Proposition 2.2); its defining property (Proposition 2.3) — every value below `mex` is present, `mex` itself is absent — drives the entire theory.
- **Grundy number** `g(p) = mex{ g(q) : q ∈ Opt(p) }` (Definition 2.4) is well-defined on the move DAG; `g(p) = 0 ⟺ p` is a P-position (Theorem 3.1), settling single-game win/loss.
- **Nim** is the prototype: `g(*n) = n` (Lemma 4.2) and Bouton's XOR rule (Theorem 4.3) proved by the two closure properties.
- **Sprague-Grundy theorem** (Theorem 5.2): every position `p ≡ *g(p)`, a single Nim pile — proved as an immediate corollary of the sum rule.
- **XOR sum rule** (Theorem 6.1): `g(G + H) = g(G) ⊕ g(H)`, proved by the abstract Bouton argument — (A) no single-component move preserves the XOR, (B) any smaller target XOR is reachable, both via the mex property. This is the technical heart, and `*g(p)` equivalence follows from it.
- **Nimbers** form a field under `⊕` and the recursive nim-product `⊗` (Theorem 7.2); only `⊕` appears in disjunctive sums, while `⊗` governs grid coin-turning games.
- **Periodicity** of subtraction games (Theorem 8.3) follows from the finite window state space; **one full matching window** certifies the period forever (Corollary 8.4), with bound `≤ (r+1)^M`.
- **Splitting games** obey `g(n) = mex{ g(a) ⊕ g(b) }` (Proposition 9.2); coin-turning games decompose as XOR over single coins (Theorem 9.3).
- **Misère** breaks the naive XOR rule (Theorem 10.2 gives Nim's special misère rule; general misère needs genus / misère quotients); loopy games leave the DAG world; partizan games leave impartial theory entirely.
- **Complexity** is `O(|V| + |E|)` over the move DAG (Theorem 11.1), `O(n|S|)` for subtraction games, but **PSPACE-complete** for some succinct impartial games; tractability comes from decomposition, periodicity, or closed forms (Proposition 11.2).

### Theorem-Dependency Table

| Result | Depends on | Gives |
|--------|-----------|-------|
| mex properties (2.2, 2.3) | finiteness | the reach-every-smaller-value gadget |
| Grundy 0 ⟺ P (3.1) | 2.3, DAG induction | single-game win/loss |
| Nim pile `g(*n)=n` (4.2) | 2.4 | the prototype values |
| Bouton XOR (4.3) | bit arithmetic | concrete Nim rule |
| XOR sum rule (6.1) | 2.3, induction | compound-game decision |
| Sprague-Grundy (5.2) | 6.1, 4.2, 3.1 | `p ≡ *g(p)` |
| Periodicity (8.3, 8.4) | 2.2, pigeonhole | huge-`n` queries in `O(1)` |
| Splitting recurrence (9.2) | 6.1 | Grundy's game, Kayles |

### Logical Skeleton of the Theory

The whole edifice rests on one structural fact and one algebraic fact, composed:

```
mex property (Prop 2.3)
   |  every value below g(p) is reachable; g(p) itself is not
   v
single-game outcome (Thm 3.1):  g(p)=0  <=>  P-position
   |
   +--> Nim prototype (Lemma 4.2, Thm 4.3): g(*n)=n, XOR rule for piles
   |
   v
XOR sum rule (Thm 6.1):  g(G+H) = g(G) ⊕ g(H)
   |  proved by the abstract Bouton argument using only the mex property
   v
Sprague-Grundy (Thm 5.2):  p ≡ *g(p)   (every position is a Nim pile)
   |
   v
compound-game decision (Cor 6.2):  sum is a loss  <=>  ⊕ g(components) = 0
```

Everything downstream — periodicity (a finite-state consequence), splitting recurrences (a sum-rule consequence), nimber arithmetic (the algebraic closure), complexity (a decomposition consequence) — hangs off this spine. Remove the mex property and nothing stands; it is the single load-bearing lemma, which is why Proposition 2.3 is stated first and invoked in every subsequent proof.

Notice also the *direction* of the dependency: the abstract sum rule (Theorem 6.1) is proved using only the mex property, and the concrete Nim analysis (Theorem 4.3) is then recovered as the special case where each component is a single pile. So Nim is simultaneously the *motivating example* (historically first, Bouton 1901) and a *corollary* of the general theory — the two viewpoints are consistent precisely because both rest on the same mex property. This is why studying Nim deeply (sibling `14-nim`) and studying the general Sprague-Grundy machine are the same activity viewed at two altitudes.

### Practical Corollaries of the Theory

- **One number per position suffices** (Thm 5.2): you never need more than the Grundy value to play optimally in sums.
- **Heterogeneous games mix freely** (Thm 5.2 + Cor 6.2): a Kayles row, a Nim pile, and a coin-turning row combine by one XOR.
- **Huge parameters are tractable** when periodic (Thm 8.3 / Cor 8.4) or closed-form (Prop 8.7).
- **The hardness is structural, not algebraic** (Prop 11.2 + §11.2): the theory is always *correct*; efficiency depends solely on decomposition / periodicity / closed-form structure, with the worst case PSPACE-complete.
- **Conventions are not cosmetic** (§10): misère, loopy, partizan, and scored variants each leave the theory's domain and demand different machinery.
- **Magnitude is not strength** (§2.1): only `0` vs nonzero decides a single game; Grundy values are XOR operands, not an ordered quality score.

Foundational references: Bouton (1901, *Nim, a game with a complete mathematical theory*); Sprague (1935) and Grundy (1939), independently, for the theorem; Berlekamp, Conway, Guy, *Winning Ways for Your Mathematical Plays* (octal games, coin-turning, Kayles/Dawson periods, nimber arithmetic); Conway, *On Numbers and Games* (the nimber field `On₂`, partizan theory); Guy-Smith (1956) for octal-game periodicity; Plambeck-Siegel for misère quotients; Schaefer / Lichtenstein-Sipser for PSPACE-completeness of Geography and Node Kayles. Sibling topic `14-nim` develops the Nim arithmetic concretely.
