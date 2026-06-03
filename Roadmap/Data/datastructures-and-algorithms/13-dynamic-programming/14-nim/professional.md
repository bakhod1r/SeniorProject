# Nim and Impartial Game Theory — Mathematical Foundations and Proofs

## Table of Contents
1. Formal Definitions: Impartial Games, P/N-Positions
2. The Fundamental P/N Characterization (Induction)
3. The Group Structure of XOR (GF(2)ⁿ)
4. Bouton's Theorem (Full Proof, Both Directions)
5. The Winning Move and Its Uniqueness Properties
6. Misère Nim Theorem and Proof
7. Subtraction Games: Grundy Periodicity Proof
8. Moore's Nimₖ Generalization and Proof
9. The Sprague-Grundy Bridge (Pointer to Sibling 15)
10. Complexity and the GF(2) View
11. Summary

---

## 1. Formal Definitions: Impartial Games, P/N-Positions

**Definition 1.1 (Impartial game).** A finite **impartial game** is a finite directed acyclic graph `(Γ, →)` whose vertices are *positions* and whose edges are *moves*. From a position `x`, the set of options is `Opt(x) = { y : x → y }`. The game is **impartial** because `Opt(x)` does not depend on which player is to move. Play alternates; a player who faces a position with `Opt(x) = ∅` (a **terminal** position) cannot move.

**Definition 1.2 (Normal vs misère convention).** Under **normal play**, a player unable to move **loses** (equivalently, the player making the last move wins). Under **misère play**, a player unable to move **wins** (the player making the last move loses). Acyclicity guarantees termination.

**Definition 1.3 (P- and N-positions, normal play).** Classify every position recursively:
- `x` is a **P-position** (Previous player wins; the player *to move* **loses**) iff **every** option is an N-position. In particular, every terminal position is a P-position (vacuously, no options).
- `x` is an **N-position** (Next player to move wins) iff **at least one** option is a P-position.

Because `Γ` is finite and acyclic, this recursion is well-founded and labels every position uniquely.

**Definition 1.4 (Nim).** A Nim position is a tuple `(p₁, …, pₙ) ∈ ℕⁿ` of pile sizes. A move selects an index `i` and a value `pᵢ' < pᵢ` with `pᵢ' ≥ 0`, replacing `pᵢ` by `pᵢ'`. The unique terminal position is `(0, …, 0)`.

**Definition 1.5 (Nim-sum).** The **Nim-sum** of a position is the bitwise XOR `⊕`:

```
σ(p₁, …, pₙ) = p₁ ⊕ p₂ ⊕ … ⊕ pₙ.
```

**Notation.** `⊕` denotes bitwise XOR throughout. `bit_b(x) = (x >> b) & 1` is bit `b` of `x`. `[P]` is the Iverson bracket (`1` if `P` holds, else `0`). "Mover" always means the player about to move. We index bits from `0` (least significant).

**Remark.** The entire theory is the identification of P-positions with the kernel of the linear map `σ` over `GF(2)`. Sections 2–4 make this precise; Section 3 supplies the algebra.

**Example 1.6 (Small classifications).** Under Definition 1.4 and normal play:
- `(0)`: terminal, P-position (mover cannot move, loses).
- `(n)`, `n ≥ 1`: N-position (move to `(0)`, a P-position).
- `(1, 1)`: P-position (each option `(0,1)` is an N-position — `(0,1)` moves to `(0,0)`).
- `(1, 2)`: N-position (move `2 → 1` reaches `(1,1)`, a P-position).

These hand classifications anchor the abstract recursion of Definition 1.3 and agree with `σ = 0 ⇔ P` (e.g. `σ(1,1) = 0`, `σ(1,2) = 3 ≠ 0`).

---

## 2. The Fundamental P/N Characterization (Induction)

**Theorem 2.1 (P/N rules).** In any finite acyclic impartial game under normal play, the labeling of Definition 1.3 is the unique labeling satisfying:
1. (terminal) every terminal position is a P-position;
2. (closure) every option of a P-position is an N-position;
3. (existence) every N-position has at least one option that is a P-position.

Moreover, a position is an N-position iff the mover has a winning strategy.

**Proof.** Existence and uniqueness of the labeling follow from well-founded recursion on the finite acyclic graph: a position's label is determined by its options, which are strictly closer to terminal. Rules 1–3 are immediate from Definition 1.3.

For the strategy claim, induct on the longest play length (rank) from `x`. If `x` is terminal it is a P-position and the mover (who cannot move) loses — consistent. If `x` is an N-position, by rule 3 it has an option `y` that is a P-position; the mover plays to `y`, and by the inductive hypothesis the opponent (now the mover at `y`) loses, so the original mover wins. If `x` is a P-position, by rule 2 every option `y` is an N-position; whatever the mover plays, by the inductive hypothesis the opponent wins. Hence N-positions are exactly the mover-win positions. ∎

**Remark 2.1b (Rank is well-defined).** Because `Γ` is finite and acyclic, every position has a finite **rank** = the length of the longest directed path from it to a terminal. Terminals have rank `0`; a position's rank exceeds all its options' ranks. Induction on rank is therefore valid and is the standard tool for every proof in this document. Acyclicity is essential: a cycle would make rank undefined and the labeling potentially inconsistent (a "loopy" game admitting draws).

**Corollary 2.2.** To prove a position is a P-position it suffices to verify (closure): every move leaves an N-position, with the terminal base case. To prove an N-position, exhibit one move to a P-position. This is the proof template instantiated by Bouton's theorem in Section 4.

**Lemma 2.3 (Candidate-labeling uniqueness).** Suppose `(P', N')` is a partition of all positions such that (i) every terminal position is in `P'`, (ii) every option of a `P'`-position is in `N'`, and (iii) every `N'`-position has an option in `P'`. Then `P' = P` and `N' = N` (the true classes of Definition 1.3).

**Proof.** Induct on rank (longest play length). A terminal position is in both `P'` (by (i)) and `P` (Definition 1.3). For a non-terminal position `x` with all options of strictly smaller rank: if `x ∈ P'`, by (ii) all its options are in `N' = N` (inductive hypothesis), so all options are N-positions, whence `x ∈ P`. If `x ∈ N'`, by (iii) some option is in `P' = P`, so `x ∈ N`. Hence `P' ⊆ P` and `N' ⊆ N`; since both are partitions of the same set, equality holds. ∎

This lemma is the formal engine of Bouton's proof: we exhibit a *candidate* partition (Nim-sum `0` vs `≠ 0`), check the three properties, and Lemma 2.3 forces it to be the true labeling. The same lemma justifies the Moore (Section 8) and subtraction-game (Section 7) classifications.

---

## 3. The Group Structure of XOR (GF(2)ⁿ)

Bouton's theorem is, at heart, a statement about the abelian group of bit-vectors under XOR. We isolate the algebra.

**Definition 3.1.** Identify each non-negative integer with its (infinite, eventually-zero) bit-vector over `GF(2) = {0, 1}`. Bitwise XOR `⊕` is addition in the vector space `V = GF(2)^(∞)` (finitely supported).

**Proposition 3.2.** `(V, ⊕)` is an abelian group with:
- **associativity** `(a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)` (bitwise, from associativity of XOR on bits);
- **commutativity** `a ⊕ b = b ⊕ a`;
- **identity** `0` (`a ⊕ 0 = a`);
- **self-inverse** `a ⊕ a = 0`, so every element is its own inverse.

**Proof.** Each bit is an element of the field `GF(2)`, where addition is XOR; the listed properties hold per bit, hence vectorwise. The self-inverse property is `1 ⊕ 1 = 0` and `0 ⊕ 0 = 0` per bit. ∎

**Corollary 3.3 (Cancellation / single-term change).** If a position has Nim-sum `X` and one pile changes from `pᵢ` to `pᵢ'`, the new Nim-sum is `X ⊕ pᵢ ⊕ pᵢ'`. In particular:
- If `pᵢ' ≠ pᵢ`, the Nim-sum **changes** (it cannot stay equal): `X ⊕ pᵢ ⊕ pᵢ' = X ⇔ pᵢ ⊕ pᵢ' = 0 ⇔ pᵢ = pᵢ'`.
- Choosing `pᵢ' = pᵢ ⊕ X` yields new Nim-sum `X ⊕ pᵢ ⊕ (pᵢ ⊕ X) = (X ⊕ X) ⊕ (pᵢ ⊕ pᵢ) = 0`.

**Proof.** Replacing `pᵢ` by `pᵢ'` in `σ = p₁ ⊕ … ⊕ pₙ` removes the term `pᵢ` and adds `pᵢ'`; since `⊕` is its own inverse, this is `σ ⊕ pᵢ ⊕ pᵢ'`. The two bullet points are direct substitutions using Proposition 3.2. ∎

**Lemma 3.4 (Top-bit decrease).** Let `X ≠ 0` and let `b` be the position of its highest set bit. If integer `p` has bit `b` set, then `p ⊕ X < p`.

**Proof.** Bits of `X` above `b` are all `0` (`b` is the highest set bit), so XOR-ing leaves bits of `p` above `b` unchanged. Bit `b` of `p` is `1`; XOR with bit `b` of `X` (which is `1`) sets it to `0`. Hence the most significant bit at which `p ⊕ X` and `p` differ is bit `b`, where `p ⊕ X` has `0` and `p` has `1`. Therefore `p ⊕ X < p`. ∎

These three facts — single-term change, the zeroing substitution, and the top-bit decrease — are the entire engine of Bouton's theorem.

**Remark 3.5 (Why XOR and not addition).** Ordinary integer addition `+` does *not* have the self-inverse property (`a + a = 2a ≠ 0`), and it carries between bit positions. The proof of direction (ii) — "you cannot change one term without changing the sum" — fails for `+` only superficially, but the proof of direction (iii) — "there is always a *legal decrease* that restores the target" — genuinely relies on the per-bit, carry-free, self-inverse structure of XOR (Lemma 3.4 needs the top bit to drop cleanly with no borrow). This is the algebraic reason the *Nim*-sum is XOR: it is the group operation under which the disjunctive sum of piles behaves, and the self-inverse law is what guarantees "every nonzero total is correctable in exactly one move."

**Remark 3.6 (Vector-space view).** `(V, ⊕)` is a vector space over `GF(2)`, and the Nim-sum `σ(p₁, …, pₙ) = ⊕ pᵢ` is a `GF(2)`-linear map. P-positions are exactly `ker σ`. This single observation powers the counting and span results of Section 10: the set of P-positions is a linear subspace, so its size and structure follow from rank/nullity, not enumeration.

---

## 4. Bouton's Theorem (Full Proof, Both Directions)

**Theorem 4.1 (Bouton, 1901).** A Nim position `(p₁, …, pₙ)` under normal play is a **P-position** (the mover loses under optimal play) **if and only if** its Nim-sum `σ = p₁ ⊕ … ⊕ pₙ = 0`.

We prove it by verifying the three P/N rules of Theorem 2.1 with the candidate labeling

```
P := { positions with σ = 0 },     N := { positions with σ ≠ 0 }.
```

By Corollary 2.2 it suffices to check: (i) the terminal position has `σ = 0`; (ii) every move from a `σ = 0` position reaches a `σ ≠ 0` position; (iii) every `σ ≠ 0` position has a move to a `σ = 0` position. Theorem 2.1's uniqueness then forces this candidate labeling to be *the* correct P/N labeling.

**(i) Terminal.** The terminal position `(0, …, 0)` has `σ = 0`. ✓ (Consistent: the mover cannot move and loses, a P-position.)

**(ii) From `σ = 0`, every move makes `σ ≠ 0`.** Suppose `σ = 0` and a move changes pile `i` from `pᵢ` to `pᵢ' < pᵢ` (so `pᵢ' ≠ pᵢ`). By Corollary 3.3 the new Nim-sum is `σ ⊕ pᵢ ⊕ pᵢ' = 0 ⊕ pᵢ ⊕ pᵢ' = pᵢ ⊕ pᵢ'`, which is `0` iff `pᵢ = pᵢ'` — impossible since the move strictly decreases the pile. Hence the new Nim-sum is `≠ 0`. **Every** move from a P-candidate lands in an N-candidate. ✓

**(iii) From `σ ≠ 0`, some move makes `σ = 0`.** Let `b` be the highest set bit of `σ`. Since bit `b` of `σ` is `1`, an **odd** number of piles have bit `b` set (XOR of that bit-column is `1`); in particular at least one pile `pᵢ` has bit `b` set. By Lemma 3.4, `pᵢ' := pᵢ ⊕ σ < pᵢ`, so reducing pile `i` to `pᵢ'` is a **legal** move. By Corollary 3.3 the resulting Nim-sum is `σ ⊕ pᵢ ⊕ (pᵢ ⊕ σ) = 0`. So a legal move to an N… to a P-candidate exists. ✓

By Theorem 2.1 (and Lemma 2.3), the candidate labeling is correct: P-positions are exactly those with `σ = 0`. Combined with Theorem 2.1's strategy claim, the mover wins iff `σ ≠ 0`. ∎

**Remark 4.1b (The role of "highest set bit").** Direction (iii) used the *highest* set bit of `σ` specifically because Lemma 3.4 only guarantees a decrease when XOR-ing turns off the top bit. If we instead picked a pile sharing a *lower* set bit of `σ`, XOR-ing could turn on a higher bit, *increasing* the pile — an illegal move. So the choice of the highest set bit is not arbitrary convenience; it is what makes the constructed move legal. The argument also shows existence: since bit `b` of `σ` is `1`, the column has odd parity, so at least one pile has that bit, guaranteeing a legal target exists.

**Remark 4.1c (Optimal play is forced for the loser, free for the winner).** A subtlety: the *winner* must play correctly (the unique-ish `p ⊕ σ` move) to maintain `σ = 0` for the opponent; a careless winner can throw away the win. The *loser*, by contrast, loses no matter what — every move from `σ = 0` lands in `σ ≠ 0`, and the winner re-zeroes. This asymmetry (the winning side has a narrow correct path; the losing side has no path at all) is typical of solved games and is why "perfect play" matters only for the side that *can* win.

**Remark 4.2 (Why both directions are needed).** Direction (ii) ensures a player handed `σ = 0` *cannot escape* — every move worsens to `σ ≠ 0`. Direction (iii) ensures a player at `σ ≠ 0` *can always punish* — restoring `σ = 0`. Together they form the strategy: the winner re-zeroes `σ` on every turn; the loser is forced to un-zero it; by acyclicity (each move strictly reduces total stones) the loser eventually faces the terminal `σ = 0` and cannot move.

**Corollary 4.3 (Two equal piles).** `(a, a)` has `σ = a ⊕ a = 0`, hence is a P-position. This recovers the mirroring strategy: the second player copies every first-player move on the other pile.

### 4.1 Worked Verification of Bouton

Take `(3, 4, 5)`. `σ = 011 ⊕ 100 ⊕ 101 = 010 = 2 ≠ 0`, so it is an N-position. Direction (iii) construction: top set bit of `σ` is bit 1; the piles with bit 1 set are those with binary `..1.`: only `3 = 011`. Set it to `3 ⊕ 2 = 1`. New position `(1, 4, 5)`, `σ = 001 ⊕ 100 ⊕ 101 = 000 = 0` ✓ — a P-position handed to the opponent. Direction (ii) sanity: from `(1, 4, 5)` (σ = 0), the opponent's every move breaks `σ`. E.g. `4 → 0` gives `(1, 0, 5)`, `σ = 1 ⊕ 5 = 4 ≠ 0`. The first player then re-zeroes: `5 → 5 ⊕ 4 = 1`, position `(1, 0, 1)`, `σ = 0`. The descent continues to `(0,0,0)` with the first player taking the last stone.

### 4.2 Why the Strategy Terminates

Each move strictly decreases the total number of stones `Σ pᵢ`, a non-negative integer, so the game terminates in at most `Σ pᵢ` moves. There are no draws and no infinite play (acyclicity, Definition 1.1). The winner — the player who always faces `σ ≠ 0` and restores `σ = 0` — eventually hands the opponent `(0, …, 0)` with `σ = 0`; the opponent cannot move and loses. Termination is what makes the well-founded P/N induction (Theorem 2.1) applicable; without it (loopy games) the labeling could fail to exist.

---

## 5. The Winning Move and Its Uniqueness Properties

**Proposition 5.1 (Characterization of winning moves).** From a position with `σ ≠ 0`, a move reducing pile `i` to `pᵢ'` is winning (reaches `σ = 0`) **iff** `pᵢ' = pᵢ ⊕ σ` **and** `pᵢ ⊕ σ < pᵢ`. The latter holds iff pile `i` has the highest set bit of `σ` set.

**Proof.** By Corollary 3.3, the new Nim-sum is `0` iff `pᵢ' = pᵢ ⊕ σ`. Legality requires `pᵢ' < pᵢ`, i.e. `pᵢ ⊕ σ < pᵢ`. By Lemma 3.4 this holds when `pᵢ` has `σ`'s top bit; conversely, if `pᵢ` lacks that bit then `pᵢ ⊕ σ` has that bit set and exceeds... more precisely `pᵢ ⊕ σ > pᵢ` because the highest differing bit (`b`) goes `0 → 1`, so the move is illegal. ∎

**Proposition 5.2 (Number of winning moves).** The number of winning moves equals the number of piles whose binary representation has the highest set bit of `σ` set, which is **odd** (hence ≥ 1). Other piles admit no winning move.

**Proof.** By Proposition 5.1 a winning move exists for pile `i` iff `pᵢ` has `σ`'s top bit `b`. Bit `b` of `σ` is `1`, so the number of piles with bit `b` set is odd. Each such pile yields exactly one winning move (`pᵢ ⊕ σ` is determined). ∎

**Remark 5.3.** There may be several winning moves (one per pile sharing `σ`'s top bit), but each *targets a single pile* and reduces it to a *uniquely determined* value. There is never a winning move that increases a pile or touches a pile lacking the top bit.

### 5.1 Worked Multiplicity Example

Take `(1, 2, 3)`. `σ = 001 ⊕ 010 ⊕ 011 = 000 = 0` — a P-position, no winning move (consistent with Proposition 5.1: no `p ⊕ σ < p` when `σ = 0`).

Now take `(1, 2, 4)`. `σ = 001 ⊕ 010 ⊕ 100 = 111 = 7`. Top set bit is bit 2 (value 4). Piles with bit 2 set: only `4 = 100`. So the unique winning move is `4 → 4 ⊕ 7 = 3`, giving `(1, 2, 3)` with `σ = 0`. Exactly one winning move, and the count of piles with bit 2 set is `1` (odd), matching Proposition 5.2.

Finally take `(3, 5, 6)`. `σ = 011 ⊕ 101 ⊕ 110 = 000`? Compute: `011 ⊕ 101 = 110`, `110 ⊕ 110 = 000`. So `σ = 0` — P-position. The number of piles with any fixed bit set is even in every column (bit 0: piles 3,5 → 2; bit 1: piles 3,6 → 2; bit 2: piles 5,6 → 2), the column-parity statement of "XOR `= 0`."

### 5.2 The Winning Move Is Not Unique but the Target Value Is

Consider `(6, 4, 2)`. `σ = 110 ⊕ 100 ⊕ 010 = 000`? `110 ⊕ 100 = 010`, `010 ⊕ 010 = 000`. P-position again. To get a multi-winning-move example, take `(7, 5, 2)`: `σ = 111 ⊕ 101 ⊕ 010 = 000`? `111 ⊕ 101 = 010`, `010 ⊕ 010 = 000`. Still zero. Take `(7, 4, 1)`: `σ = 111 ⊕ 100 ⊕ 001 = 010 = 2`. Top bit is bit 1; piles with bit 1 set: `7 = 111` (bit 1 = 1) and `4 = 100`? bit 1 of 4 is `0`; `1 = 001`? bit 1 is `0`. Only pile `7`. So `7 → 7 ⊕ 2 = 5`, giving `(5, 4, 1)`, `σ = 101 ⊕ 100 ⊕ 001 = 000` ✓. The count of bit-1 piles is `1` (odd) — Proposition 5.2 holds. The key invariant across all examples: the target *value* `p ⊕ σ` is forced once the pile is chosen; only the *choice of pile* (among those sharing the top bit) can vary.

---

## 6. Misère Nim Theorem and Proof

Under **misère** play the player taking the last stone **loses**. The strategy is identical to normal play *except* in the endgame of all small piles.

**Theorem 6.1 (Misère Nim).** In misère Nim the mover **wins** iff:
- **(a)** some pile has size `≥ 2` **and** `σ ≠ 0`, **or**
- **(b)** every pile has size `≤ 1` **and** the number of size-1 piles is **even**.

Equivalently: play the normal-Nim strategy until your move would leave only piles of size `≤ 1`; at that switch, leave an **odd** number of 1-piles for the opponent (so they take the last stone).

**Proof.** Partition positions by whether a pile of size `≥ 2` exists.

*Case all piles ≤ 1.* The position is some number `c` of 1-piles (others are 0). Each move removes exactly one 1-pile (the only legal move on a size-1 pile). Play is forced: the count `c` decreases by 1 each turn until `0`. The player who takes the last stone is the one who moves when `c = 1`. Under misère that player **loses**. Tracking parity: the mover faces count `c`; the mover takes the last stone iff `c` is **odd** (mover takes on turns `c, c−2, …`); since taking the last stone loses under misère, the mover **loses iff `c` is odd**, i.e. **wins iff `c` is even**. This is clause (b).

*Case some pile ≥ 2.* We show the mover wins iff `σ ≠ 0`, by exhibiting strategies.

- *If `σ ≠ 0`:* the mover plays to maintain the invariant "leave the opponent a position that is a misère-P-position." Concretely, the mover uses the normal-Nim winning move (Proposition 5.1) to reach `σ = 0`, **unless** that move would leave all piles ≤ 1; in that boundary case the mover instead leaves an **odd** number of 1-piles. The key fact: whenever a pile `≥ 2` exists and `σ ≠ 0`, the mover can *choose* whether the resulting all-ones endgame (when it is finally forced) has odd or even parity, because reducing a `≥ 2` pile to `0` or `1` toggles the count's parity at will. Thus the mover can always steer to (b)-losing for the opponent. A careful induction (on total stones) shows this invariant is maintainable: the opponent, handed `σ = 0` with the parity arranged, must either re-create a `≥ 2` pile with `σ ≠ 0` (mover repeats) or move into the all-ones case with the losing parity.
- *If `σ = 0` (and a pile ≥ 2 exists):* by Bouton direction (ii) every move makes `σ ≠ 0`, and at least one pile `≥ 2` situation persists or the move creates the all-ones case; symmetric to the above, the opponent (now the mover) can maintain the winning invariant, so the original mover loses.

Hence with a pile `≥ 2` present the misère outcome coincides with the normal outcome (`σ ≠ 0` ⇔ mover wins), which is clause (a). ∎

**Remark 6.2.** The only place misère differs from normal is the parity flip in the all-ones endgame. The reason the difference is confined there: as long as a pile `≥ 2` exists, a player has the *freedom* to set the eventual endgame parity, so the misère and normal P-position sets agree; that freedom vanishes only when every pile is `≤ 1`. This is the classic "misère Nim is normal Nim until the endgame" statement, made precise.

### 6.1 Worked Misère Examples

- `(2, 2)`: a pile `≥ 2` exists, `σ = 0` → misère mover **loses** (same as normal). Check: mover takes from one 2-pile; opponent mirrors toward the all-ones endgame with the losing parity; mover takes the last stone and loses under misère.
- `(1, 1, 1)`: all piles `≤ 1`, three 1-piles (odd) → misère mover **loses**. Play: `(1,1,1) → (1,1) → (1) → ()`; the mover takes the 1st, 3rd stones, hence the last, and loses.
- `(1, 1)`: all `≤ 1`, two 1-piles (even) → misère mover **wins**. Play: mover takes one, opponent forced to take the last and loses.
- `(2, 1, 1)`: a pile `≥ 2` exists, `σ = 2 ⊕ 1 ⊕ 1 = 2 ≠ 0` → misère mover **wins** by the normal rule. The mover reduces the `2`-pile not to `0` (which would leave `(1,1)`, an even endgame *won by the opponent under misère*) but to `1`, leaving `(1,1,1)` — an *odd* all-ones endgame that loses for the opponent. This is the "choose the endgame parity" freedom in action: the normal-play move (`2 → 0`) would be wrong for misère; the misère-correct move (`2 → 1`) sets the right parity.

Example `(2,1,1)` is the clearest illustration of why the misère strategy is "normal play until the switch": at the switch the mover deviates from the normal move to land the opponent in the *odd* all-ones endgame.

### 6.1b Formal Induction for the "Pile ≥ 2" Case

We make the "some pile ≥ 2" half of Theorem 6.1 precise by induction on total stones `T = Σ pᵢ`. Define the misère-P set `M-P` and misère-N set `M-N` by the candidate rule of Theorem 6.1, and verify Lemma 2.3's three properties with the *misère* terminal convention (terminal `(0,…,0)` is **N**, since the mover who cannot move *wins* under misère).

- **Terminal:** `(0,…,0)` has no pile ≥ 2 and zero 1-piles (even), so clause (b) classifies it as a win for the (non-existent) mover — consistent with the misère terminal being N. (One checks the parity bookkeeping treats the empty endgame correctly.)
- **From candidate-`M-P`, every move reaches candidate-`M-N`:** split on whether the position has a pile ≥ 2. If `σ = 0` with a pile ≥ 2 (clause-(a) loss), Bouton direction (ii) makes `σ ≠ 0`; the resulting position is a win for the opponent either by clause (a) (if a pile ≥ 2 remains) or by the parity arrangement in clause (b). If the position is an odd all-ones (clause-(b) loss), any move removes one 1-pile, leaving an even all-ones — a clause-(b) win for the opponent.
- **From candidate-`M-N`, some move reaches candidate-`M-P`:** if `σ ≠ 0` with a pile ≥ 2, use the Bouton move but, if it would create an all-ones endgame, adjust the chosen pile to land the opponent in the *odd* all-ones (the losing parity). The freedom to reduce a ≥ 2 pile to either `0` or `1` (toggling endgame parity) guarantees this is possible. If even all-ones, remove one 1-pile to leave odd all-ones for the opponent.

Each step strictly decreases `T`, so the induction is well-founded; Lemma 2.3 then certifies the candidate classes as the true misère P/N classes. ∎ (formalization)

### 6.2 The Misère Quotient Perspective (Pointer)

For *general* impartial games the misère theory is far more delicate than Nim's clean special case: the relevant algebraic object is the **misère quotient** (Plambeck-Siegel), a commutative monoid that can be infinite even for simple games. Nim is exceptional in admitting the one-line endgame rule of Theorem 6.1. Seniors should know that "just flip the last-move rule" is *not* generally a small change — Nim is the lucky case, and most misère games have no comparably simple description.

---

## 7. Subtraction Games: Grundy Periodicity Proof

A **subtraction game** with finite **subtraction set** `S ⊂ ℤ⁺` allows removing `t ∈ S` stones from a pile. The Grundy function `g : ℕ → ℕ` is defined by

```
g(0) = 0,    g(s) = mex { g(s − t) : t ∈ S, t ≤ s },
```

where `mex(A)` is the least non-negative integer not in `A`. (For the *full* Nim move set `S = {1, 2, 3, …}`, this gives `g(s) = s`.)

**Theorem 7.1 (Periodicity).** For a *finite* subtraction set `S` with `m = max S`, the Grundy sequence `g(0), g(1), g(2), …` is **eventually periodic**: there exist a pre-period `λ ≥ 0` and period `π ≥ 1` with `g(s + π) = g(s)` for all `s ≥ λ`.

**Proof.** Each `g(s)` is determined by the window of previous values `(g(s−1), …, g(s−m))` (only differences `t ≤ m` matter). Moreover `g(s) ≤ |S| ≤ m` for all `s`, since `mex` of a set of at most `|S|` values is at most `|S|`. Therefore the *state* `(g(s−1), …, g(s−m)) ∈ {0, …, m}^m` takes finitely many (at most `(m+1)^m`) values. By the pigeonhole principle two windows coincide: `(g(a−1), …, g(a−m)) = (g(b−1), …, g(b−m))` for some `a < b`. Since `g` is a deterministic function of its preceding window, the entire sequence repeats from that point: `g(a + j) = g(b + j)` for all `j ≥ 0`. Setting `π = b − a` and `λ = a` gives eventual periodicity. ∎

**Corollary 7.2 (Max-take closed form).** For `S = {1, 2, …, m}`, `g(s) = s mod (m+1)`.

**Proof.** Induct on `s`. `g(0) = 0`. For `s ≥ 1`, the reachable values are `{ g(s−1), …, g(s−min(s,m)) }`. By the inductive hypothesis these are `{ (s−1) mod (m+1), …, (s−min(s,m)) mod (m+1) }`. If `s mod (m+1) = r`, the reachable residues are exactly `{0, …, m} \ {r}` when `s ≥ m` (a full run of `m` consecutive residues skipping `r`), so `mex = r = s mod (m+1)`; the boundary `s < m` is checked directly and also gives `s`. Hence `g(s) = s mod (m+1)`. ∎

**Corollary 7.3 (Multi-pile subtraction game).** A position `(p₁, …, pₙ)` of independent subtraction-game piles is a P-position iff `g(p₁) ⊕ … ⊕ g(pₙ) = 0`. (This is the Sprague-Grundy combination, Section 9.) For max-take `m`, that is `⊕ᵢ (pᵢ mod (m+1)) = 0`.

### 7.1 Worked Periodicity Example

For `S = {1, 2}` the Grundy recurrence `g(s) = mex{g(s−1), g(s−2)}` gives:

```
 s:    0 1 2 3 4 5 6 7 8
 g(s): 0 1 2 0 1 2 0 1 2   (period 3, pre-period 0)
```

`g(3) = mex{g(2), g(1)} = mex{2, 1} = 0`; `g(4) = mex{g(3), g(2)} = mex{0, 2} = 1`; and so on. The window `(g(s−1), g(s−2))` cycles through `(2,1), (0,2), (1,0)` and back — three distinct windows, period 3, exactly as Theorem 7.1's pigeonhole bound predicts (`≤ (m+1)^m = 3^2 = 9` possible windows, here only 3 occur).

For `S = {2, 3}` (cannot remove 1): `g = 0, 0, 1, 1, 2, 0, 0, 1, 1, 2, …`? Compute: `g(0)=0`, `g(1)=mex{}=0` (no move from 1, since min take is 2), `g(2)=mex{g(0)}=mex{0}=1`, `g(3)=mex{g(1)}=mex{0}=1`, `g(4)=mex{g(2),g(1)}=mex{1,0}=2`, `g(5)=mex{g(3),g(2)}=mex{1,1}=0`, `g(6)=mex{g(4),g(3)}=mex{2,1}=0`, `g(7)=mex{g(5),g(4)}=mex{0,2}=1`. Sequence `0,0,1,1,2,0,0,1,1,…` — pre-period `0`, period `5`. The periodicity lets you compute `g(10^18)` by `g(10^18 mod 5) = g(3) = 1` in `O(1)`.

### 7.1b Arbitrary Subtraction Set Worked Example

For `S = {1, 3, 4}`, compute by `g(s) = mex{ g(s−1), g(s−3), g(s−4) }` (terms with `s − t ≥ 0`):

```
 s:    0  1  2  3  4  5  6  7  8  9 10 11 12 13 14
 g(s): 0  1  0  1  2  3  2  0  1  0  1  2  3  2  0
```

`g(1) = mex{g(0)} = mex{0} = 1`; `g(2) = mex{g(1)} = mex{1} = 0`; `g(3) = mex{g(2), g(0)} = mex{0,0} = 1`; `g(4) = mex{g(3), g(1), g(0)} = mex{1,1,0} = 2`; `g(5) = mex{g(4), g(2), g(1)} = mex{2,0,1} = 3`; `g(6) = mex{g(5), g(3), g(2)} = mex{3,1,0} = 2`; `g(7) = mex{g(6), g(4), g(3)} = mex{2,2,1} = 0`. The window of the last `m = 4` values at `s = 7` is `(g(6),g(5),g(4),g(3)) = (2,3,2,1)`, and the same window recurs at `s = 14` — giving period `π = 7`, pre-period `λ = 0`. So `g(10^18) = g(10^18 mod 7)` evaluated from the prefix, in `O(1)`. This confirms Theorem 7.1's eventual periodicity concretely for a non-trivial set, and shows the period (7) is far below the pigeonhole worst case `(m+1)^m = 5^4 = 625`.

### 7.2 Why Periodicity Bounds the Table Size

Theorem 7.1 says the Grundy state `(g(s−1), …, g(s−m))` lives in a finite set of size `≤ (m+1)^m`. In practice the period is far smaller than this worst case, but the bound guarantees a *finite* prefix suffices. A safe engineering rule: build the prefix to a few multiples of `m`, scan for the smallest period `π` and pre-period `λ` that hold consistently across the whole built range, then evaluate any `g(huge)` by reducing into the periodic tail. This converts an apparently unbounded computation (huge pile values) into a bounded one (period detection), which is the practical lever for the senior-level "big pile values" concern.

---

## 8. Moore's Nimₖ Generalization and Proof

**Moore's Nimₖ.** On a turn a player chooses between `1` and `k` piles (inclusive) and removes a positive number of stones from each chosen pile. Standard Nim is `k = 1`.

**Definition 8.1 (Digit-column sums).** For bit position `b`, let `c_b = Σᵢ bit_b(pᵢ)` be the number of piles with a `1` in bit `b`.

**Theorem 8.2 (Moore, 1910).** A Nimₖ position is a **P-position** (mover loses) iff `c_b ≡ 0 (mod k+1)` for **every** bit position `b`.

We verify the three P/N rules with `P := { positions : ∀b, c_b ≡ 0 (mod k+1) }`.

**(i) Terminal.** `(0, …, 0)` has every `c_b = 0 ≡ 0`. ✓

**(ii) From `P`, every move leaves `P^c`.** Suppose all `c_b ≡ 0 (mod k+1)` and a move changes at most `k` piles (each strictly decreased). Consider the highest bit `b*` at which *any* changed pile flips. Each changed pile alters `c_{b*}` by `±1` (it either gains or loses a `1` in bit `b*`); at most `k` piles change, and at least one *does* change bit `b*` (the one realizing the highest flip). For a strictly-decreasing change in a pile, the *highest* bit that changes must go `1 → 0` (the value drops), so among the piles changed at bit `b*`, consider the contribution: the net change to `c_{b*}` is the (signed) count of flips, whose magnitude is between `1` and `k`, hence **not** divisible by `k+1` (a nonzero integer with absolute value `≤ k` cannot be `≡ 0 (mod k+1)`). Therefore `c_{b*}` moves off `0 (mod k+1)`, so the new position is not in `P`. ✓ (Full bookkeeping: pick `b*` as the most significant bit changed across all altered piles; every altered pile that changes at `b*` does so as part of a strict decrease, and the count of such piles is in `[1, k]`.)

**(iii) From `P^c`, some move reaches `P`.** Suppose some `c_b ≢ 0 (mod k+1)`. Let `b*` be the **highest** such bit. We must adjust the piles so that, after the move, every column sum is `≡ 0 (mod k+1)`, changing at most `k` piles. The number of piles having bit `b*` set is `c_{b*}`; write `c_{b*} mod (k+1) = r` with `1 ≤ r ≤ k`. Choose `r` of those piles to "turn off" bit `b*` (this is the start of a strict decrease). For each chosen pile, we are free to set all bits below `b*` arbitrarily (since the top changed bit already dropped `1 → 0`, the new value is smaller regardless of lower bits). Using these `r ≤ k` piles' lower bits as free parameters, we can fix every column sum `c_b` for `b < b*` to be `≡ 0 (mod k+1)` (a greedy/counting argument: with `r` adjustable piles we can change each lower column sum by any amount in a sufficient range to hit a multiple of `k+1`; Moore's original argument shows `r` degrees of freedom suffice exactly because we only must correct columns below `b*`, and the corrections are independent per bit). Columns above `b*` were already `≡ 0` (since `b*` was the highest violating bit) and are untouched. The result is in `P`, reached by changing `≤ k` piles. ✓

By Theorem 2.1 the labeling is correct. For `k = 1`, "`c_b ≡ 0 (mod 2)` for all `b`" is exactly "the XOR of all piles is `0`," recovering Bouton's theorem. ∎

**Remark 8.3.** The base-`(k+1)` digit-sum condition is the natural generalization: standard Nim works in base 2 (XOR is digitwise sum mod 2), and Nimₖ works "digitwise sum mod `k+1`" in the binary expansion. The mover's freedom to touch up to `k` piles is exactly what is needed to correct up to `k` units of imbalance per move.

### 8.1 Worked Moore Example (`k = 2`)

Take piles `(3, 5, 6)` with `k = 2` (a move may decrease up to 2 piles). Bit-column counts:

```
       bit2 bit1 bit0
 3  =   0    1    1
 5  =   1    0    1
 6  =   1    1    0
 ----  ----  ----  ----
 c_b:   2    2    2
```

We need every `c_b ≡ 0 (mod k+1) = 0 (mod 3)`. Here `c_b = 2` for every bit, and `2 mod 3 = 2 ≠ 0`, so this is an **N-position** — the mover wins. (Contrast: under ordinary Nim, `k=1`, the same piles have `σ = 0`, a P-position. The multi-pile freedom flips the outcome.)

Now `(1, 2, 3)` with `k = 2`: columns are bit1 count `= 2` (piles 2,3), bit0 count `= 2` (piles 1,3). Both `≡ 2 (mod 3) ≠ 0` → N-position, mover wins. To reach a P-position the mover adjusts up to 2 piles so every column count becomes a multiple of 3; e.g. emptying two of the piles can drive a column count to `0`. The detailed correction follows the constructive argument in direction (iii) above.

### 8.2 Recovering Bouton from Moore

Set `k = 1`. The condition "every `c_b ≡ 0 (mod 2)`" says every bit-column has an even number of `1`s, which is precisely "the XOR of all piles is `0`." Thus Theorem 8.2 specializes exactly to Theorem 4.1, and the base of the digit system drops from `k+1 = 2` to ordinary binary XOR. This is the cleanest way to see Bouton as one point in a one-parameter family.

### 8.3 The Constructive Correction in Detail

Direction (iii) of Theorem 8.2 deserves a closer look, because the existence of the correcting move is the heart of Moore's result. Let `b*` be the highest bit with `c_{b*} ≢ 0 (mod k+1)`, and write `r = c_{b*} mod (k+1) ∈ {1, …, k}`. Choose `r` piles that currently have bit `b*` set and *turn that bit off* in each (the start of a strict decrease, since the top changed bit drops). These `r ≤ k` piles are now "free": below `b*`, we may set their bits to anything, because the value has already strictly decreased at bit `b*`.

Process the bits `b = b* − 1, b* − 2, …, 0` in order. At each such bit, the current column count is some `c_b`; we need it `≡ 0 (mod k+1)`. The number of our `r` chosen piles that have bit `b` set can be increased or decreased (within `0..r`) by toggling their bit-`b` values, changing `c_b` by any amount in a range of size `r + 1`. Moore's counting argument shows `r` adjustable piles give exactly enough freedom to correct every lower column to a multiple of `k+1`, because we only ever need to absorb a deficit of at most `k` per column and we have `r ≥ 1` (often more) degrees of freedom, applied independently per bit. Columns above `b*` were already `≡ 0` and are untouched. The result is a position with every column `≡ 0 (mod k+1)` — a P-position — reached by changing at most `k` piles, each strictly decreased. ∎ (completion)

This is precisely the generalization of "set `pᵢ → pᵢ ⊕ σ`": for `k = 1` there is a single chosen pile (`r = 1`) and the lower bits are set by the XOR, recovering the Bouton move exactly.

---

## 9. The Sprague-Grundy Bridge (Pointer to Sibling 15)

Bouton's theorem is the `k=1`, full-move-set instance of a far more general result, the subject of sibling topic `15-sprague-grundy`. We state it to locate Nim within the theory.

**Definition 9.1 (Grundy value).** For an impartial game position `x`, `g(x) = mex { g(y) : y ∈ Opt(x) }`. A position is a P-position iff `g(x) = 0`.

**Theorem 9.2 (Sprague-Grundy).** Every impartial game position `x` is equivalent (for the purpose of disjunctive sums) to a single Nim pile of size `g(x)`. For a **disjunctive sum** `x = x₁ + x₂ + … + xₘ` (a move is one move in one component),

```
g(x₁ + … + xₘ) = g(x₁) ⊕ g(x₂) ⊕ … ⊕ g(xₘ).
```

**Specialization to Nim.** A single Nim pile of size `s` has options `{0, 1, …, s−1}` with Grundy values `{0, 1, …, s−1}`, so `g(pile s) = mex{0, …, s−1} = s`. A Nim position is the disjunctive sum of its piles, so by Theorem 9.2 its Grundy value is `g(p₁) ⊕ … ⊕ g(pₙ) = p₁ ⊕ … ⊕ pₙ = σ`. The position is a P-position iff `g = 0` iff `σ = 0` — **Bouton's theorem is the Sprague-Grundy theorem applied to piles**. The proof of Theorem 9.2 itself (and `mex`) is developed in sibling `15-sprague-grundy`; the XOR-combination law there is precisely the algebra of Section 3.

**Why XOR.** The combination law is XOR because a single Nim pile of Grundy value `v` behaves exactly like the bit-vector `v` under disjunctive sum: the analysis of "Nim on the Grundy values" *is* Bouton's theorem, closing the loop. This is the deep reason XOR — and not ordinary addition — runs all of impartial game theory.

**Sketch of the combination law (for context).** To prove `g(x + y) = g(x) ⊕ g(y)`, one shows the position `x + y` is equivalent (same outcome in every further sum) to a Nim pile of size `g(x) ⊕ g(y)`. The two inclusions are: (a) from `x + y` one can move to any position with Grundy value strictly below `g(x) ⊕ g(y)` (so the `mex` is at least that value), and (b) one cannot move to a position with Grundy value equal to `g(x) ⊕ g(y)` (so the `mex` is at most that value). Both use the single-term-change property of XOR (Corollary 3.3) applied to the component Grundy values — i.e., the same algebra as Bouton, now on Grundy numbers rather than pile sizes. The full proof is the content of sibling `15-sprague-grundy`; we record here only that it *reduces to the XOR algebra of Section 3*, which is why Nim is the universal coordinate system for impartial games.

**Worked Grundy reduction.** Consider the disjunctive sum of a standard Nim pile of size `3` and a max-take-2 pile of size `5`. Grundy values: `g(Nim pile 3) = 3`; `g(max-take-2 pile 5) = 5 mod 3 = 2`. Overall Grundy `= 3 ⊕ 2 = 1 ≠ 0` → N-position, mover wins. To win, move to make the overall Grundy `0`: in the Nim pile, reduce `3 → 3 ⊕ 1 = 2` (Grundy of that pile becomes 2, total `2 ⊕ 2 = 0`); or in the max-take pile, reduce its Grundy from 2 to 3 — impossible (cannot raise), so reduce to Grundy 1, total `3 ⊕ 1 = 2 ≠ 0` (not a fix). Hence the unique fixing component here is the Nim pile. This is exactly "Nim on the Grundy values."

### 9.1 Game Equivalence and the Quotient

Two impartial games `G` and `H` are **equivalent** (`G ≡ H`) if `G + X` and `H + X` have the same outcome (P or N) for *every* impartial game `X`. Equivalence classes form an abelian group under disjunctive sum, with identity the class of P-positions (Grundy value `0`) and every element its own inverse (`G + G ≡ 0`, since the second player mirrors). Theorem 9.2 says each class is represented by a unique Nim pile (its Grundy value), so this group is exactly `(ℕ, ⊕)` — the very group of Section 3. The two appearances of `(ℕ, ⊕)` — the bit-vector group of pile sizes and the equivalence-class group of games — are *the same group*, which is the precise sense in which "every impartial game is a Nim pile."

### 9.2 Mirror as Self-Inverse

The fact `G + G ≡ 0` (a position plus its copy is a second-player win) is the game-theoretic shadow of `a ⊕ a = 0` (Proposition 3.2). The mirroring strategy — copy every opponent move in the twin component — is the *combinatorial proof* of the self-inverse law. Corollary 4.3 (`(a, a)` is a P-position) is the two-pile instance. This is why the same algebraic property underlies both the winning-move construction and the simplest losing-position certificate.

---

## 10. Complexity and the GF(2) View

**Proposition 10.1.** Deciding the winner of a standard Nim position with `n` piles is `Θ(n)` time and `O(1)` extra space (one XOR pass). Finding a winning move is `Θ(n)`.

**Proof.** The Nim-sum is `n−1` XOR operations; comparison to `0` is `O(1)`. The winning move scans piles once for the top-bit condition (Proposition 5.1). ∎

**The kernel view.** The map `σ : ℕⁿ → V`, `σ(p) = ⊕ᵢ pᵢ`, is `GF(2)`-linear in the bit-vectors. P-positions are exactly its **kernel**. This recasts structural questions as linear algebra:

- **Counting P-positions** with bit-bounded piles is a kernel-size computation over `GF(2)`: if pile values range over a `d`-bit space, the set of P-positions of `n` piles forms an affine/linear subspace and its size is `2^(d(n−1))`-type expressions obtained by rank/nullity.
- **Span / basis questions** ("can these pile values XOR to a target?") are solvability of a linear system over `GF(2)`, decided by Gaussian elimination in `O(n · d²)` or with a XOR-basis in `O(n · d)`.

**Proposition 10.2 (Subtraction-game complexity).** With finite subtraction set `S`, `|S| = s`, computing the Grundy prefix to `N` is `O(N · s)` time, `O(N)` space; with the periodicity of Theorem 7.1, `g(huge)` is `O(1)` after an `O(period · s)` precompute. Multi-pile decision is then `O(n)` XOR over per-pile Grundy values.

**Proposition 10.3 (Moore's Nimₖ complexity).** Deciding a Nimₖ position is `O(n · B)` where `B` is the bit-width: one pass per bit-column to compute `c_b mod (k+1)`.

**Proposition 10.4 (Counting P-positions).** The number of P-positions among all `(p₁, …, pₙ)` with each `pᵢ ∈ {0, …, 2^d − 1}` is `2^{d(n−1)}` for `n ≥ 1`.

**Proof.** The Nim-sum `σ : (GF(2)^d)^n → GF(2)^d` is `GF(2)`-linear (Remark 3.6). For `n ≥ 1` it is surjective: fixing `p₂, …, pₙ` arbitrarily and letting `p₁` range over `GF(2)^d` already hits every target value. By rank-nullity, `|ker σ| = |domain| / |image| = (2^d)^n / 2^d = 2^{d(n−1)}`. P-positions are exactly `ker σ`. ∎

**Corollary 10.5.** Exactly a `2^{−d}` fraction of positions are P-positions, independent of `n` (for `n ≥ 1`). Equivalently, a uniformly random position is a first-player win with probability `1 − 2^{−d}`. This quantifies the intuition that "most positions are winning for the mover," and that two-pile games (where P-positions are the diagonal `(a,a)`) are the sparse exception only because of their small `n`.

**Remark 10.6 (Span / reachability).** "Can a target Nim-sum `t` be achieved by choosing piles from a fixed multiset of allowed values?" is solvability of `⊕ (chosen) = t` over `GF(2)`, decided by maintaining a **XOR-basis** (linear basis) of the allowed values in `O(n · d)` and testing whether `t` lies in its span. This is the standard competitive-programming "linear basis" technique, and it is the structural query that the kernel/image view of the Nim-sum makes routine.

### 10.1 The XOR-Basis Construction

A **linear basis** (XOR-basis) of a set of `d`-bit vectors is a reduced set `B` such that every achievable XOR is a XOR of a subset of `B`, and the basis vectors have distinct top bits. Insertion:

```
INSERT(B, x):
  for b from high bit to low bit of x:
    if bit b of x is 0: continue
    if B[b] is empty: B[b] := x; return inserted
    x := x XOR B[b]          # reduce by the existing basis vector
  return x became 0 (already in span)
```

After inserting all `n` values, `|span| = 2^{rank}` where `rank` is the number of nonempty `B[b]`. Querying "is `t` reachable" reduces `t` by the basis the same way and checks it hits `0`. Total cost `O(n · d)`. This is the algorithmic counterpart of Proposition 10.4: counting and reachability over the Nim-sum are linear algebra, and the XOR-basis *is* Gaussian elimination over `GF(2)` specialized to one bit per pivot.

### 10.2 Complexity Summary Table

| Task | Cost | Method |
|------|------|--------|
| Decide standard Nim | `Θ(n)` | one XOR pass |
| Winning move | `Θ(n)` | top-bit scan |
| Misère decision | `Θ(n)` | XOR + endgame parity |
| Max-take `m` decision | `Θ(n)` | `⊕ (pᵢ mod (m+1))` |
| Subtraction set `S` Grundy prefix to `N` | `O(N·|S|)` | `mex` DP |
| Subtraction set `g(huge)` | `O(1)` after `O(period·|S|)` precompute | periodicity |
| Moore's Nimₖ decision | `O(n·B)` | per-column counts mod `k+1` |
| Count P-positions (`d`-bit, `n` piles) | `O(1)` closed form `2^{d(n−1)}` | rank/nullity |
| Span / reachability query | `O(n·d)` | XOR-basis |

The recurring theme: the *decision* problems are linear in input size; the *structural/counting* problems are linear algebra over `GF(2)`. Nothing here requires enumerating game states, which is precisely why Nim is "completely solved" in the strong sense.

### 10.3 Lower Bound

Any algorithm that decides standard Nim must read every pile's relevant bits (changing one pile's top bit can flip the Nim-sum and hence the verdict), so `Ω(n)` is a trivial lower bound, matching the `O(n)` upper bound. There is no sublinear algorithm: the answer genuinely depends on all `n` piles.

---

## 11. Summary

- **Framework (Section 2).** Every finite acyclic impartial game has a unique P/N labeling: P-positions have all-N options (and include terminals); N-positions have some P option. N-positions are exactly the mover-win positions. Bouton's theorem is this template with "P ⇔ Nim-sum `0`."
- **Algebra (Section 3).** XOR makes `(ℕ, ⊕)` an abelian group with `0` identity and every element self-inverse. The three consequences — single-term change `σ → σ ⊕ pᵢ ⊕ pᵢ'`, the zeroing substitution `pᵢ ⊕ σ`, and the top-bit decrease `pᵢ ⊕ σ < pᵢ` — are the whole engine.
- **Bouton (Section 4).** P-positions are exactly those with Nim-sum `0`. Direction (ii): from `σ = 0` every move makes `σ ≠ 0` (single-term change can't be null for a real move). Direction (iii): from `σ ≠ 0` the top-bit pile can be reduced to `pᵢ ⊕ σ`, zeroing `σ`. The mover wins iff `σ ≠ 0`.
- **Winning move (Section 5).** It targets a pile sharing `σ`'s top set bit and sets it to `pᵢ ⊕ σ` — a uniquely determined legal decrease; the count of winning piles is odd, hence ≥ 1.
- **Misère (Section 6).** Identical to normal play while a pile `≥ 2` exists (`σ ≠ 0` ⇔ win); in the all-ones endgame the rule flips to "win iff an **even** number of 1-piles," because a `≥ 2` pile gives the freedom to choose the endgame parity, and only its absence removes that freedom.
- **Subtraction games (Section 7).** Finite subtraction sets give an *eventually periodic* Grundy sequence (pigeonhole on the bounded window of recent values); max-take `m` has the closed form `g(s) = s mod (m+1)`. Combine piles by XOR of Grundy values.
- **Moore's Nimₖ (Section 8).** P-positions are those where every binary column-sum is `≡ 0 (mod k+1)` — the base-`(k+1)` digit generalization of XOR; `k=1` recovers Bouton.
- **Sprague-Grundy (Section 9).** Bouton's theorem is the specialization of the Sprague-Grundy theorem to piles: a Nim pile of size `s` has Grundy value `s`, disjunctive sums XOR Grundy values, and "Nim on the Grundy values" is itself Bouton's theorem — the reason XOR governs all impartial games. Full development in sibling `15-sprague-grundy`.
- **Complexity (Section 10).** Standard Nim: `Θ(n)`. P-positions form the kernel of the `GF(2)`-linear Nim-sum map, turning counting/span questions into linear algebra over `GF(2)`.

### Theorem Cheat Table

| Result | Statement | Proof tool |
|--------|-----------|-----------|
| P/N characterization | N ⇔ mover wins; P ⇔ all options N | well-founded induction |
| Bouton | P ⇔ Nim-sum `0` | three P/N rules + XOR algebra |
| Winning move | target top-bit pile, set to `p ⊕ σ` | top-bit decrease lemma |
| Misère Nim | normal until all-ones; then win iff even #1-piles | parity + endgame freedom |
| Grundy periodicity | finite `S` ⇒ eventually periodic Grundy | pigeonhole on bounded window |
| Max-take | `g(s) = s mod (m+1)` | mex induction |
| Moore's Nimₖ | P ⇔ all column-sums `≡ 0 (mod k+1)` | base-`(k+1)` P/N rules |
| Sprague-Grundy | `g(x₁+…) = ⊕ g(xᵢ)`; Nim pile `g = size` | sibling `15` |

### Closing Notes

- **Group structure (Section 3)** is *why* XOR and not addition: the self-inverse law makes "undo by repeating" possible and forces every nonzero `σ` to be correctable in one move.
- **Both proof directions (Section 4)** correspond to the two halves of the strategy: inescapability of `σ = 0` and punishability of `σ ≠ 0`.
- **Misère's confinement (Section 6)** to the endgame is the recurring subtlety; the rest of the game is unchanged.
- **Periodicity (Section 7)** is what makes huge pile values tractable without huge tables.
- **The Sprague-Grundy bridge (Section 9)** places Nim as the universal model: solving any impartial game *is* solving a Nim position on its Grundy values.

Foundational references: C. L. Bouton (1901), *Nim, a game with a complete mathematical theory*; E. H. Moore (1910), *A generalization of the game called Nim*; Sprague (1935) and Grundy (1939) for the Grundy theory; Berlekamp-Conway-Guy, *Winning Ways for Your Mathematical Plays*; Conway, *On Numbers and Games* (partizan theory); Plambeck-Siegel for the misère quotient. Sibling topics: `15-sprague-grundy`.

---

## Appendix A: A Fully Worked Game with Proof Annotations

We classify and play out `(2, 4, 6)` under normal play, annotating each step with the theorem applied.

**Classification.** `σ = 010 ⊕ 100 ⊕ 110`. Step: `010 ⊕ 100 = 110`; `110 ⊕ 110 = 000`. So `σ = 0` — by Theorem 4.1 this is a **P-position**: the first mover (call them A) **loses** under optimal play.

**Play.** A must move (rank `> 0`); by direction (ii) any move makes `σ ≠ 0`. Say A takes `6 → 2`, reaching `(2, 4, 2)`, `σ = 010 ⊕ 100 ⊕ 010 = 100 = 4`. Now B is the mover with `σ = 4 ≠ 0` — by Theorem 4.1 an N-position, B wins. By Proposition 5.1, B finds a pile sharing `σ`'s top bit (bit 2): pile `4 = 100`. B sets `4 → 4 ⊕ 4 = 0`, reaching `(2, 0, 2)`, `σ = 0` (Corollary 4.3: two equal piles). 

A is again handed `σ = 0`. A takes, say, `2 → 0`, reaching `(0, 0, 2)`, `σ = 2`. B takes the whole last pile `2 → 0`, reaching `(0,0,0)` — **B took the last stone and wins**, as Theorem 4.1 predicted for the player *not* moving first from a P-position.

**Invariant maintained.** Every time it was B's turn, `σ ≠ 0`, and B restored `σ = 0` (Remark 4.2). A could never escape (direction (ii)). The descent in total stones (`12 → 8 → 4 → 2 → 0`) guarantees termination (Section 4.2).

## Appendix B: Numerical XOR Reference

For quick hand-checking, small XOR values (`a ⊕ b`):

```
 ⊕ | 0 1 2 3 4 5 6 7
 --+----------------
 0 | 0 1 2 3 4 5 6 7
 1 | 1 0 3 2 5 4 7 6
 2 | 2 3 0 1 6 7 4 5
 3 | 3 2 1 0 7 6 5 4
 4 | 4 5 6 7 0 1 2 3
 5 | 5 4 7 6 1 0 3 2
 6 | 6 7 4 5 2 3 0 1
 7 | 7 6 5 4 3 2 1 0
```

Note the diagonal is all `0` (self-inverse, Proposition 3.2) and the table is symmetric (commutativity). Reading off `3 ⊕ 4 ⊕ 5`: `3 ⊕ 4 = 7`, then `7 ⊕ 5 = 2` — the Nim-sum of `(3,4,5)`, confirming the running example throughout this topic.

## Appendix C: Grundy Values of Common Single-Pile Games

| Game (single pile of size `s`) | Grundy `g(s)` | P-position condition |
|--------------------------------|---------------|----------------------|
| Standard Nim (remove any ≥ 1) | `s` | `s = 0` |
| Max-take `m` (remove `1..m`) | `s mod (m+1)` | `s ≡ 0 (mod m+1)` |
| Remove `{1, 2}` | `s mod 3` | `s ≡ 0 (mod 3)` |
| Remove `{2, 3}` (no take-1) | period-5 sequence `0,0,1,1,2,…` | per the sequence |
| Remove a perfect square | aperiodic, no closed form (compute by `mex`) | `g(s) = 0` |
| Remove `1` only | `s mod 2` | `s` even |

The first two rows are the only ones with a one-line closed form; the rest require the `mex` DP, and some (squares) are not even periodic. This table is the practical reference for "which rule applies": if the game is one of the closed-form rows, XOR the closed form across piles; otherwise build the Grundy table (with periodicity if applicable) and XOR `g(pᵢ)`.

## Appendix D: Relationship Map of the Theorems

```
                    P/N induction (Thm 2.1, Lemma 2.3)
                              │
                XOR group structure (Prop 3.2-3.4)
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
   Bouton (Thm 4.1)   Moore Nim_k (Thm 8.2)   Subtraction games
   σ=0 ⇔ P            columns ≡0 mod k+1       Grundy periodicity (Thm 7.1)
          │                   │                   │
          └───────────────────┴───────────────────┘
                              │
              Sprague-Grundy (Thm 9.2, sibling 15)
              g(sum) = ⊕ g(components); Nim pile g(s)=s
                              │
                   Nim is the universal model
```

Every box descends from the P/N induction plus the XOR algebra. Bouton, Moore, and the subtraction-game classification are *parallel instances* of the same candidate-labeling proof (Lemma 2.3) with different invariants ("σ = 0", "columns divisible by k+1", "Grundy = 0"). Sprague-Grundy then unifies them: each is "Nim on the appropriate values," and the values combine by XOR because the disjunctive-sum group *is* the XOR group of Section 3. This single diagram is the conceptual takeaway of the entire topic.

## Appendix E: Proof Obligations Checklist

When proving any new impartial-game classification, the obligations are always exactly these — a self-contained checklist:

1. **State the game formally** (positions, options, terminal set, play convention) — Definition 1.1–1.2.
2. **Confirm finiteness and acyclicity** so rank is defined and induction is valid — Remark 2.1b.
3. **Propose a candidate invariant** that splits positions into `P'` / `N'`.
4. **Verify terminal** is in the correct class for the convention (P for normal, N for misère).
5. **Verify closure:** every option of a `P'`-position is in `N'`.
6. **Verify escape:** every `N'`-position has an option in `P'`, and *exhibit the move* (constructive).
7. **Invoke Lemma 2.3** to conclude the candidate classes are the true P/N classes.
8. **(Optional) Strategy / complexity:** describe the maintainable invariant and the decision cost.

Bouton (Section 4) executes steps 3–7 with invariant "σ = 0"; Moore (Section 8) with "all columns ≡ 0 mod k+1"; subtraction games (Section 7) with "Grundy = 0." Following this checklist mechanically turns "guess the pattern" into a rigorous proof, and is the single most transferable skill from this topic — it applies to *any* impartial game, not just Nim.
