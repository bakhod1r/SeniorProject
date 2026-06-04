# Bit-Parallel Techniques — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions and the Word-RAM Model
2. The Bitset and Its Operations as a Boolean Algebra
3. Correctness of Bitset Subset-Sum (`B |= B << w`)
4. Complexity: the `O(nT/w)` Bound and the `/w` Factor
5. Shift-Or Correctness (Automaton Encoded in Bits)
6. Boolean Matrix Multiplication and the `/w` Speedup
7. Myers' Bit-Vector Algorithm: Correctness Sketch
8. SWAR: Arithmetic in the Word-RAM
9. Lower Bounds and What `/w` Cannot Buy
10. The Four-Russians Connection
11. Summary

---

## 1. Formal Definitions and the Word-RAM Model

The entire topic lives in the **word-RAM model**, whose `w` is the source of every speedup here.

**Definition 1.1 (Word-RAM).** The word-RAM with word size `w` is a model in which memory is an array of `w`-bit words, and the operations `+, -, ·, AND, OR, XOR, NOT, <<, >>`, comparisons, and indexed load/store each cost `O(1)` on whole words. Standard assumptions take `w = Θ(log N)` for input size `N` (so an index fits in a word); in practice `w = 64`.

**Definition 1.2 (Bitset).** A **bitset** over universe `U = {0, 1, …, T-1}` is a map `B : U → {0,1}`, stored as an array of `⌈T/w⌉` words. Bit `s` resides in word `⌊s/w⌋` at position `s mod w`. The stored value of word `i` is `Σ_{r=0}^{w-1} B[iw + r] · 2^r`.

**Definition 1.3 (Whole-word operations).** For bitsets `A, B` of equal length, the operations `A ∧ B`, `A ∨ B`, `A ⊕ B`, `¬A` are defined bit-wise and implemented as the corresponding word-wise machine ops over the `⌈T/w⌉` words. The left shift `B << d` is the bitset `C` with `C[s] = B[s-d]` for `s ≥ d`, else `0`.

**Definition 1.4 (popcount, ffs).** `popcount(B) = Σ_{s} B[s]` (cardinality); `ffs(B) = min{s : B[s] = 1}` (least set element, `+∞` if empty). Both are `O(1)` per word (`POPCNT`, `CTZ`).

**Notation.** Throughout, `w` is the word size (the model's parallelism width, `64` in practice), `T` the universe size, `n` an item count, `m` a pattern length, `σ` the alphabet size. We write `W = ⌈T/w⌉` for the word count. "Bit `s` of `B`" and "element `s` ∈ `B`" are interchangeable.

The crucial point: **`w` is a model parameter that appears as a divisor**. Algorithms that touch `T` *bits* via whole-word ops cost `Θ(T/w)` word operations. This `/w` is the formal content of "the `/64` win".

### 1.1 The transdichotomous assumption

This topic operates in the **transdichotomous** word-RAM, where the word size `w` is assumed to grow with the input so an index fits in `O(1)` words (`w ≥ log N`). Two readings coexist and both are legitimate:

- **Theoretical (`w = Θ(log N)`):** the `/w` is a `/log N` factor — a genuine, if modest, asymptotic improvement within the polynomial classes (e.g. `O(n³/log n)` Boolean multiply). It cannot cross a polynomial boundary.
- **Practical (`w = 64` fixed):** the `/w` is a constant 64× — the framing used throughout the junior/middle/senior files, because real hardware has a fixed register width.

The two readings agree on the essential point of Section 9: bit-parallelism never changes a *complexity class* in the practical sense, and at most a `log` factor in the strict model. We use the practical `w = 64` framing as the default and flag the `log N` reading where the distinction matters (Section 10, Four Russians).

### 1.2 What counts as `O(1)`

The word-RAM's `O(1)` operations include the bitwise logic (`AND/OR/XOR/NOT`), shifts, integer arithmetic, comparisons, and — critically for this topic — `popcount` and `count-trailing-zeros` (available as hardware `POPCNT`/`TZCNT`/`BSF` on modern CPUs, and `O(log w)` via SWAR otherwise, Theorem 8.2). Indexed memory access is `O(1)` per word. The model deliberately abstracts away cache hierarchy; the senior-level treatment (`senior.md §3`) re-introduces cache as the gap between the model's `O(T/w)` and wall-clock time.

---

## 2. The Bitset and Its Operations as a Boolean Algebra

**Proposition 2.1.** The set of bitsets over `U` with `(∨, ∧, ¬, 0̄, 1̄)` — where `0̄` is the empty bitset and `1̄` the full bitset — forms a **Boolean algebra** isomorphic to the power set `(2^U, ∪, ∩, ∁)`.

**Proof.** The map `B ↦ {s : B[s] = 1}` is a bijection onto `2^U`, and it sends `∨ ↦ ∪`, `∧ ↦ ∩`, `¬ ↦ ∁`, `0̄ ↦ ∅`, `1̄ ↦ U` by Definition 1.3. These preserve all Boolean-algebra axioms (associativity, commutativity, distributivity, complement laws) because each holds bit-wise. ∎

**Corollary 2.2.** Set union, intersection, difference (`A ∧ ¬B`), and symmetric difference (`A ⊕ B`) on dense subsets of `U` each cost `Θ(⌈T/w⌉) = Θ(T/w)` word operations — a factor `w` below the `Θ(T)` element-wise cost.

This is the algebraic foundation: bitset acceleration is the realization of the power-set Boolean algebra in the word-RAM, where each Boolean connective is a single machine instruction per word.

### 2.1 Worked instance of the isomorphism

Take `U = {0,1,2,3,4,5}` and the subsets `S = {0, 2, 5}`, `T = {2, 3, 5}`. Their bitsets (low bit = element 0) are:

```
B_S = 100101₂ = 0x25     (bits 0, 2, 5)
B_T = 101100₂ = 0x2C     (bits 2, 3, 5)
B_S ∨ B_T = 101101₂      = {0,2,3,5} = S ∪ T
B_S ∧ B_T = 100100₂      = {2,5}     = S ∩ T
B_S ⊕ B_T = 001001₂      = {0,3}     = S △ T
B_S ∧ ¬B_T = 000001₂     = {0}       = S \ T
```

Each line is a single machine instruction, and each reproduces the set-theoretic operation exactly — the bijection of Proposition 2.1 in action. For a universe of `T = 4000` elements this is `⌈4000/64⌉ = 63` word ops per set operation rather than 4000 element comparisons, the `/w` factor made concrete.

### 2.2 Why associativity and distributivity survive packing

A subtle point: the *word boundaries* are an artifact of storage, not of the algebra. Because `∧`, `∨`, `⊕` act independently on each bit, an operation on word `i` never interacts with word `j ≠ i`. Hence the multi-word implementation is *literally* `⌈T/w⌉` independent copies of the single-word Boolean algebra, and every identity (De Morgan, absorption, distributivity) holds verbatim. This independence is exactly what *fails* for the shift operation — `<<` does cross word boundaries — which is why shift, not the logic ops, is the delicate part of the implementation (Section 4 of `middle.md`).

---

## 3. Correctness of Bitset Subset-Sum (`B |= B << w`)

We prove the central identity: the shift-OR update computes subset-sum reachability. (Here we use `d` for the item weight to avoid clashing with the word size `w`.)

**Definition 3.1 (Reachable-sum set).** Given multiset of weights `d_1, …, d_n`, define `R_0 = {0}` and `R_k = R_{k-1} ∪ (R_{k-1} + d_k)`, where `S + d = {s + d : s ∈ S}`. Then `R_n` is the set of all subset sums (each item used at most once).

**Lemma 3.2 (Shift = translation).** Let `B_{k-1}` be the bitset of `R_{k-1}`. Then `B_{k-1} << d_k` is the bitset of `R_{k-1} + d_k`.

**Proof.** By Definition 1.3, `(B_{k-1} << d_k)[s] = B_{k-1}[s - d_k]`, which is `1` iff `s - d_k ∈ R_{k-1}`, i.e. iff `s ∈ R_{k-1} + d_k`. ∎

**Theorem 3.3 (Subset-sum correctness).** Define `B_0 = {0}` (bit 0 set) and `B_k = B_{k-1} ∨ (B_{k-1} << d_k)`. Then for every `k`, `B_k` is the bitset of `R_k`; in particular `B_n` encodes exactly the set of subset sums.

**Proof (induction on `k`).** *Base:* `B_0 = {0} = R_0`. *Step:* assume `B_{k-1}` is the bitset of `R_{k-1}`. Then
```
B_k = B_{k-1} ∨ (B_{k-1} << d_k)
    = bitset(R_{k-1}) ∨ bitset(R_{k-1} + d_k)    (Lemma 3.2)
    = bitset(R_{k-1} ∪ (R_{k-1} + d_k))           (Prop 2.1: ∨ ↔ ∪)
    = bitset(R_k).                                 (Definition 3.1)
```
By induction the claim holds for all `k`, so `B_n` is the bitset of `R_n`, the set of all subset sums. ∎

**Remark 3.4 (Semantics of the shift).** The identity says precisely: *one left shift by `d` is the operation "add `d` to every reachable sum simultaneously"*, because translation of a set by `d` is bit-shift by `d`, and the OR fuses "take item `k`" with "skip item `k`". This is the formal justification of the running example. The order of items is irrelevant (union and translation commute appropriately), so any processing order yields the same `B_n`.

**Remark 3.5 (Bounded variant).** If only sums `≤ C` matter, intersect each `B_k` with `bitset({0,…,C})` (mask off high bits). Since `R_k ∩ [0, C]` is what the masked recurrence computes, correctness is preserved and the universe is bounded to `C+1` bits.

### 3.1 Worked correctness trace

Weights `(d_1, d_2, d_3) = (3, 1, 2)`, tracing `B_k`:

```
B_0 = {0}              = 0000001₂                       (R_0 = {0})
B_1 = B_0 ∨ (B_0<<3)   = 0000001 ∨ 0001000 = 0001001₂   (R_1 = {0,3})
B_2 = B_1 ∨ (B_1<<1)   = 0001001 ∨ 0010010 = 0011011₂   (R_2 = {0,1,3,4})
B_3 = B_2 ∨ (B_2<<2)   = 0011011 ∨ 1101100 = 1111111₂   (R_3 = {0,1,2,3,4,5,6})
```

Each step is one shift and one OR. The final `B_3 = {0,…,6}` matches direct enumeration of the `2³ = 8` subsets of `{3,1,2}`, whose sums are `{0,3,1,4,2,5,3,6} = {0,1,2,3,4,5,6}`. This is the empirical anchor for Theorem 3.3.

### 3.2 The 0/1 vs unbounded distinction, formally

Applying the update `B ← B ∨ (B << d_k)` **once per item** yields the **0/1** subset-sum set `R_n` of Definition 3.1 (each item used at most once), because item `k` is folded in exactly once. The **unbounded** variant (item `k` reusable arbitrarily often) requires the *fixpoint* `B ← B ∨ (B << d_k)` iterated until stable — equivalently `B ← B · (1 + x^{d_k} + x^{2d_k} + …)` in generating-function terms — which for a single item is the closure of translation by `d_k`. The two differ precisely in whether `R_{k-1} + d_k` is unioned once or transitively. Conflating them is a correctness bug, not a performance one: the single-application form simply computes a different (and usually intended) set.

### 3.3 Generating-function view

Encode the bitset `B` as the polynomial `B(x) = Σ_s B[s] x^s` over `GF(2)` (so `OR` of disjoint supports is `+`, and `<< d` is multiplication by `x^d`). Then 0/1 subset-sum *reachability* is the support of the product

```
Π_{k=1}^{n} (1 + x^{d_k})   over the Boolean semiring (coefficients clamped to {0,1}),
```

and `B |= B << d_k` is exactly the incremental multiplication by `(1 + x^{d_k})` with Boolean (saturating) coefficient arithmetic. (Over the integers the same product *counts* the number of subsets achieving each sum — but counts are not single bits and do not bit-pack; the bitset only tracks the Boolean "achievable or not".) This polynomial framing connects the shift-OR trick to the transfer-matrix / generating-function machinery and explains why FFT-based subset-sum counting is a distinct, heavier technique.

---

## 4. Complexity: the `O(nT/w)` Bound and the `/w` Factor

**Theorem 4.1.** Bitset subset-sum over `n` weights with maximum reachable sum `T` runs in `O(n · T / w)` word operations and `O(T/w)` words of space, where `w` is the word size.

**Proof.** Each item `k` performs one `B << d_k` and one `∨`, each touching all `W = ⌈T/w⌉` words (the cross-word shift reads each word `O(1)` times). Thus one item costs `Θ(T/w)` word ops, and `n` items cost `Θ(n·T/w)`. Space is the single bitset, `Θ(T/w)` words. ∎

**Corollary 4.2 (The `/w` factor is exactly the word-parallelism).** The scalar boolean DP performs `Θ(n·T)` *bit* operations. The bitset version performs the same `Θ(n·T)` *bit-level* work but packs `w` bits into each `O(1)` word operation, giving `Θ(n·T/w)` *word* operations. The speedup factor is exactly `w` (= 64), and it is a **constant** with respect to input size: `O(nT/w) = O(nT)` asymptotically — same complexity class, `w`-fold smaller constant.

**Proposition 4.3 (No class improvement).** Since `w = Θ(log N)` in the strict word-RAM (or a fixed constant 64 in practice), `O(nT/w)` and `O(nT)` denote the same complexity class up to a `Θ(log N)` (or constant) factor. Bit-parallelism is a constant-/logarithmic-factor optimization, never a polynomial speedup. The pseudo-polynomial nature of subset-sum (`T` can be exponential in the input bit-length) is unchanged.

This is the rigorous statement behind the senior-level insistence: the `/w` is real and large, but it is not a change of complexity class.

### 4.1 The cross-word shift cost, accounted precisely

A whole-bitset left shift by `d` reads each of the `W = ⌈T/w⌉` words `O(1)` times: output word `i` reads source word `i - ⌊d/w⌋` and (when `d mod w ≠ 0`) source word `i - ⌊d/w⌋ - 1`. Thus the shift is `Θ(W)` word ops, matching the OR's `Θ(W)`. Two operations per item, each `Θ(T/w)`, gives the `Θ(nT/w)` bound. The constant hidden in `Θ` is small (two reads, a shift, an OR, a store per word), which is why the measured speedup over the scalar `bool[]` DP is close to the theoretical `w = 64` when the bitset fits in cache.

### 4.2 Comparison with the FFT route

Subset-sum *counting* (how many subsets reach each sum) can be done with FFT polynomial multiplication in `O(T log T)` per item-group, or `O(nT log T)` naively — asymptotically *worse* than the bitset's `O(nT/w)` for reachability, and it computes a strictly harder quantity (counts, not just feasibility). The bitset shift-OR is therefore the method of choice when only *feasibility* is needed: it is both simpler and faster, precisely because it discards the count information that FFT preserves. This is a recurring theme: the right data type (one bit vs an integer count) is what unlocks the `/w` packing.

### 4.3 Space and the bounded universe

The bitset occupies `⌈(T+1)/w⌉` words `= Θ(T/w)`. For `T = sum(weights)` up to `4·10^6`, that is about `62{,}500` words `= 500` KB — comfortably resident. When only sums `≤ C` matter, capping to `C+1` bits (Remark 3.5) bounds both time `O(nC/w)` and space `O(C/w)`. The space, not the packing, is usually the operational limit at scale (Section 10.7 of `senior.md`).

### 4.4 Pseudo-polynomiality, made precise

Subset-sum is **weakly NP-hard**: it is `NP`-hard, yet solvable in `O(nT)` (scalar) or `O(nT/w)` (bitset) time, where `T` is the *numeric* target, not the input *bit-length*. Because `T` can be `2^{Θ(input bits)}`, the running time is exponential in the input size — a *pseudo-polynomial* algorithm. The bitset `/w` divides the pseudo-polynomial bound by a constant; it does **not** make the algorithm polynomial in the input bit-length, and could not, since that would imply `P = NP`. This is the sharpest possible statement of Proposition 4.3 applied to subset-sum: the `/w` is orthogonal to the `NP`-hardness, shaving a constant from a bound that is exponential in the encoding length.

### 4.5 Comparison table: subset-sum methods

| Method | Time | Space | Computes | Note |
|--------|------|-------|----------|------|
| Brute force | `O(2ⁿ)` | `O(n)` | all subsets | exact, tiny `n` only |
| Scalar boolean DP | `O(nT)` | `O(T)` | reachability | the baseline |
| **Bitset shift-OR** | `O(nT/w)` | `O(T/w)` | reachability | `/w` constant win |
| Meet-in-the-middle | `O(2^{n/2})` | `O(2^{n/2})` | reachability | good when `n` small, `T` huge |
| FFT count | `O(nT log T)` | `O(T)` | *counts* | harder quantity, slower |

The bitset shift-OR is the throughput leader for *feasibility* whenever `T` fits in memory; meet-in-the-middle takes over only when `T` is so large that `O(T/w)` exceeds `O(2^{n/2})` (i.e. tiny `n`, astronomical `T`).

---

## 5. Shift-Or Correctness (Automaton Encoded in Bits)

We prove Shift-Or recognizes all occurrences of a pattern `P[0..m-1]`, `m ≤ w`, in a text. Use the convention bit `= 0` ⇔ "matched".

**Definition 5.1 (Prefix-match state).** After reading `text[0..i]`, define the state word `R^{(i)}` by
```
R^{(i)}[j] = 0   iff   P[0..j] = text[i-j .. i]   (the length-(j+1) prefix matches the text ending at i).
```
A full occurrence of `P` ends at `i` iff `R^{(i)}[m-1] = 0`.

**Definition 5.2 (Character mask).** For character `c`, `mask[c][j] = 0` iff `P[j] = c`, else `1`.

**Theorem 5.3 (Shift-Or recurrence).** With `R^{(-1)} = 1̄` (all ones) and
```
R^{(i)} = (R^{(i-1)} << 1) | mask[text[i]],
```
`R^{(i)}` satisfies Definition 5.1 for all `i ≥ 0`.

**Proof (induction on `i`).** *Base `i = 0`:* `R^{(0)} = (1̄ << 1) | mask[text[0]]`. Bit 0 of `1̄ << 1` is `0` (the shift introduces a fresh `0` at position 0), so bit 0 of `R^{(0)}` is `mask[text[0]][0] = 0` iff `P[0] = text[0]` — exactly the length-1 prefix condition. Higher bits are `1` (no longer prefix can match after one character). 

*Step:* assume `R^{(i-1)}` is correct. Bit `j` of `R^{(i)}` is `0` iff *both* (a) bit `j-1` of `R^{(i-1)}` is `0` — by the `<< 1` — meaning `P[0..j-1]` matched `text[i-j..i-1]`, *and* (b) `mask[text[i]][j] = 0`, meaning `P[j] = text[i]`. Together: `P[0..j]` matches `text[i-j..i]`, which is precisely Definition 5.1 for `(i, j)`. The fresh `0` shifted into bit 0 re-arms a new length-1 match at every position. ∎

**Corollary 5.4 (Complexity).** Shift-Or runs in `O(σ + m)` preprocessing (masks) and `O(n)` search for `m ≤ w`, each text character costing one `<<`, one `|`, and one test — `O(1)` word ops. For `m > w` the state spans `⌈m/w⌉` words and each step is `O(m/w)`.

**Interpretation.** `R^{(i)}` is the bit-encoded configuration of the **nondeterministic prefix automaton** of `P` (the Knuth-Morris-Pratt automaton's set of active states). Each of the `m` automaton states occupies one bit lane; the simultaneous transition of all states is the single `<<`-then-`|`. This is the formal sense in which *the automaton lives in a register*: the power-set of active states is one machine word, and the global transition function is two word operations.

### 5.1 Worked Shift-Or trace

Pattern `P = "abab"` (`m = 4`), so masks (bit `j` = 0 iff `P[j] = c`):

```
mask['a'] = ...1010   (P[0]=a, P[2]=a → bits 0,2 cleared)
mask['b'] = ...0101   (P[1]=b, P[3]=b → bits 1,3 cleared)
mask[other] = ...1111
```

Scanning text `"ababcabab"`, with `R` shown in its low 4 bits (`R = …1111` initially), match when bit 3 is `0`:

```
i=0 'a': R=(1111<<1)|1010 = 11110|1010 = ...11110 -> bit3=1, no match
i=1 'b': R=(...0<<1)|0101 = ...0101              -> bit3=0? (low4=0101) bit3=0? no (bit3=0 means matched len4)
...
i=3 'b': low4 bits reach 0xxx with bit3=0  -> MATCH ending at i=3 (start 0): "abab"
i=8 'b': bit3=0 again                      -> MATCH ending at i=8 (start 5): "abab"
```

The two matches at start indices 0 and 5 confirm Theorem 5.3; the entire scan used one shift, one OR, and one test per character.

### 5.2 The Shift-And dual and approximate extension

The dual **Shift-And** uses the convention bit `=1` ⇔ "matched", with `R = ((R << 1) | 1) & mask[c]` and `mask[c][j] = 1` iff `P[j] = c`. It is logically equivalent; the choice is cosmetic but must be consistent. The **Bitap with `k` errors** (Wu-Manber) maintains `k+1` state words `R_0, …, R_k`, where `R_d` permits up to `d` edits. The update of `R_d` combines the matched transition of `R_d`, plus the insertion/deletion/substitution transitions derived from `R_{d-1}` and the previous `R_{d-1}`:

```
R_d^{(i)} = (R_d^{(i-1)} << 1 | mask[c])          // match (0 errors here)
          & (R_{d-1}^{(i-1)})                      // substitution
          & (R_{d-1}^{(i)} << 1)                    // insertion
          & (R_{d-1}^{(i-1)} << 1)                  // deletion
```

(under the 0=match convention with appropriate ANDs). The cost is `O(k)` word ops per character, `O(nk)` total — still bit-parallel across the pattern's `m ≤ w` positions. This is the algorithmic core of `agrep`/`tre` fuzzy search.

### 5.3 Generating function of the prefix automaton

The Shift-Or recurrence is the matrix form of the prefix automaton's transition system. Let `δ` be the automaton's `m × m` transition relation on character `c`. The state word `R^{(i)}` is the characteristic vector of the active-state set, and `(R << 1) | mask[c]` is the bit-encoded image `δ_c(R^{(i-1)})`. Counting *accepted words of length `n`* (rather than detecting matches) is the same automaton over the counting semiring — which is **not** bit-packable (counts need more than one bit), tying back to the `11-graphs` matrix-power material: feasibility packs into bits, counting does not. The bit-parallel Shift-Or is precisely the Boolean (existence) projection of that automaton, which is why it fits in a single register while the counting version needs full integer matrix powers.

### 5.4 Why `m ≤ w` is the natural limit

Each automaton state needs exactly one bit lane, so `m` states need `m` bits; a single word holds `w`. For `m > w` the state spans `⌈m/w⌉` words and the `<< 1` must carry bit `w-1` of word `j` into bit `0` of word `j+1` — the same cross-word-carry logic as subset-sum (Lemma 3.2 with `d = 1`). The per-character cost grows to `O(⌈m/w⌉)` word ops, still a `/w` improvement over the `O(m)` naive automaton step. Thus the `m ≤ w` "single-word" regime is not a fundamental limit but the case where the constant is smallest (one shift, one OR, one test).

---

## 6. Boolean Matrix Multiplication and the `/w` Speedup

**Definition 6.1 (Boolean matrix product).** For `A, B ∈ {0,1}^{n×n}`, `(A ⊙ B)[i][j] = ⋁_{t} (A[i][t] ∧ B[t][j])`.

**Proposition 6.2 (Row-bitset formulation).** `(A ⊙ B)[i] = ⋁_{t : A[i][t] = 1} B[t]`, where `A[i]` and `B[t]` are rows stored as bitsets.

**Proof.** `(A ⊙ B)[i][j] = 1` iff `∃ t` with `A[i][t] = 1` and `B[t][j] = 1`, iff bit `j` is set in the OR of those rows `B[t]` with `A[i][t] = 1`. ∎

**Theorem 6.3 (`/w` speedup for Boolean multiply).** Computing `A ⊙ B` via Proposition 6.2 costs `O(n³/w)` word operations.

**Proof.** For each of `n` output rows `i`, and each of `n` source rows `t` with `A[i][t] = 1`, OR the bitset `B[t]` (which is `⌈n/w⌉` words) into the accumulator. Worst case `n` source rows per output row, each OR costing `Θ(n/w)`, over `n` output rows: `Θ(n · n · n/w) = Θ(n³/w)`. ∎

**Corollary 6.4 (Transitive closure and exact-`k` reachability).** Warshall's reachability closure, expressed with row-bitset ORs, runs in `O(n³/w)`. Boolean matrix *power* `A^{⊙k}` (existence of a length-`k` walk) via repeated squaring costs `O((n³/w) log k)`. These are the bitset-accelerated forms of the reachability results in `11-graphs`.

**Remark 6.5.** This `/w` is *orthogonal* to the algebraic fast-matrix-multiply exponent `ω`. Strassen-style algorithms (`O(n^ω)`) require additive inverses (a ring); the Boolean semiring `({0,1}, ∨, ∧)` has none. The bitset `/w` is a word-RAM constant-factor win available *without* subtraction, which is why it is the practical method for Boolean matrix multiply at moderate `n`, while subcubic `ω`-algorithms dominate only the counting/ring case asymptotically.

### 6.1 Worked Boolean-multiply trace

Graph on `{0,1,2}` with edges `0→1, 1→2`. Adjacency rows as bitsets:

```
A[0] = 010₂  (edge 0→1)
A[1] = 100₂  (edge 1→2)
A[2] = 000₂
```

`(A ⊙ A)[0]` = OR of rows `B[t]` for `t` with `A[0]` bit `t` set. `A[0] = 010₂` has only bit 1 set, so `(A⊙A)[0] = A[1] = 100₂` — meaning a length-2 walk `0→1→2`. Likewise `(A⊙A)[1] = 000₂` (no length-2 walk from 1), `(A⊙A)[2] = 000₂`. The reflexive-transitive closure (OR over all powers, plus identity) gives `reach[0] = 111₂` (`0` reaches `0,1,2`), confirming Corollary 6.4. Each output row was one OR of `⌈3/64⌉ = 1` word — the `/w` packing.

### 6.2 Why exact-`k` reachability binary-exponentiates

`A^{⊙k}` is associative (the Boolean semiring satisfies the semiring axioms; cf. `11-graphs`), so `A^{⊙a} ⊙ A^{⊙b} = A^{⊙(a+b)}` and binary exponentiation applies. Each squaring is one bitset Boolean multiply at `O(n³/w)`, and there are `O(log k)` of them, giving `O((n³/w) log k)` for exact-length-`k` reachability — the bitset-accelerated form of the matrix-power walk result. The identity matrix is the reflexive bitset `I[i] = {i}`.

### 6.3 Warshall's closure as bitset row OR

The reflexive-transitive closure `A*` is computed by Warshall's algorithm in `O(n³)`, and the bitset form makes the inner relaxation a single word-parallel OR:

```
for k in 0..n-1:
    for i in 0..n-1:
        if reach[i] has bit k:            # i can already reach k
            reach[i] |= reach[k]           # then i reaches everything k reaches
```

The inner `reach[i] |= reach[k]` ORs `⌈n/w⌉` words, so the whole closure is `Θ(n³/w)`. Correctness is the standard Warshall invariant ("after iteration `k`, `reach[i]` holds all vertices reachable from `i` using intermediates `≤ k`"), unchanged by the representation — the bitset only accelerates the relaxation. This is the single most common production use of bitset acceleration outside string matching, and the row-OR pattern generalizes to any "if reachable, absorb the target's set" propagation.

---

## 7. Myers' Bit-Vector Algorithm: Correctness Sketch

Myers (1999) computes Levenshtein distance between pattern `P` (`m ≤ w`) and a text in `O(n)` for `m ≤ w` (`O(n⌈m/w⌉)` in general).

**The unit-difference property.** Let `D[i][j]` be the edit-distance DP. Adjacent cells differ by at most 1:
```
D[i][j] - D[i][j-1] ∈ {-1, 0, +1}   (vertical),
D[i][j] - D[i-1][j] ∈ {-1, 0, +1}   (horizontal).
```
**Proof.** Standard: inserting/deleting one symbol changes the optimal alignment cost by at most 1, and the DP recurrence `D[i][j] = min(D[i-1][j]+1, D[i][j-1]+1, D[i-1][j-1] + [P[j]≠c])` preserves this Lipschitz bound by induction. ∎

**Bit-vector encoding (column `i`).** Encode the *vertical* differences of column `i` by two bit vectors:
```
VP[j] = 1  iff  D[i][j] - D[i][j-1] = +1,
VN[j] = 1  iff  D[i][j] - D[i][j-1] = -1,
```
so a `0` in both means difference `0`. Because each difference is in `{-1,0,+1}`, `(VP, VN)` losslessly encodes the column up to the additive constant `D[i][0]`.

**Theorem 7.1 (Myers' update is correct).** Given the equality vector `Eq` (`Eq[j] = 1` iff `P[j] = text[i]`), the horizontal-difference vectors `(HP, HN)` and next column `(VP', VN')` are computed by
```
Xv = Eq | VN
Xh = (((Eq & VP) + VP) ^ VP) | Eq
HP = VN | ~(Xh | VP)
HN = VP & Xh
VP' = (HN << 1) | ~(Xv | (HP << 1))
VN' = (HP << 1) & Xv
```
and these reproduce the DP recurrence exactly; the running distance updates by `+1` if `HP` has its top bit set, `−1` if `HN` does.

**Proof sketch.** The key line is `Xh = (((Eq & VP) + VP) ^ VP) | Eq`. The integer **addition** `(Eq & VP) + VP` propagates a carry exactly along maximal runs where a diagonal match (`Eq`) can "win" against the vertical `+1` steps recorded in `VP`. The carry chain of binary addition is a **parallel prefix (scan)** operation: it computes, for every bit position simultaneously, whether a match-induced decrease can propagate up the column. XOR-ing out `VP` and OR-ing `Eq` isolates the positions where the horizontal difference is `0` after accounting for the diagonal. The remaining boolean formulas are direct transcriptions of "the new vertical/horizontal difference equals the min-recurrence outcome", verified case-by-case over the nine `(VP[j], VN[j], Eq[j])` combinations. The full case analysis is in Myers (1999, §3); the conceptual content is: **the ALU carry chain simulates the `min`-propagation of the DP column in `O(1)` word ops.** ∎

**Corollary 7.2 (Complexity).** Each text character is processed in a constant number of word operations (one add, several shifts/ANDs/ORs/XORs), so distance computation is `O(n)` for `m ≤ w`, versus `O(nm)` for the scalar DP — a `/w` speedup whose mechanism is the carry-as-scan trick, not mere boolean packing.

**LCS corollary.** LCS length equals `(m + n − edit_distance)/2` when only insert/delete are allowed (cost-1 indels, no substitution), so the same bit-vector machinery yields bit-parallel LCS; specialized bit-parallel LCS (Crochemore-Iliopoulos-Pinzon-Reid) uses an analogous match/shift recurrence.

### 7.1 Why the carry chain is a parallel prefix scan

The deep content of Theorem 7.1 deserves restatement. In an integer addition `X + Y`, the carry into bit `j` is `1` iff the sum of the low `j` bits of `X` and `Y` (plus incoming carries) overflowed — a quantity that depends on *all* lower bits. Hardware computes every bit's carry in `O(1)` via carry-lookahead, which is exactly a **prefix (scan) operation**: `carry[j] = OR over runs of "generate"/"propagate" signals`. Myers chose `(Eq & VP) + VP` so that the "generate" positions are where a diagonal match forces a decrease, and "propagate" positions are the `VP` (+1) steps. The carry therefore propagates a "the diagonal won here" signal upward across a maximal run of `+1` differences — precisely the chained `min` of the edit-distance DP. The whole column's `min`-propagation, which the scalar DP does in `m` sequential steps, the carry chain does in one addition. This is why Myers is `O(1)` per column for `m ≤ w`, not merely `O(m/w)` like the pure-Boolean methods: it offloads the *sequential* dependency of the DP onto the hardware adder.

### 7.2 The shape of the per-column work

The decisive structural fact is what the update *is not*: there is no loop over the `m` pattern positions. One text character triggers a fixed sequence — one integer add (`(Eq & VP) + VP`), a handful of `&`/`|`/`^`/`~`, two `<<`, and a top-bit test that nudges the running `score` by `±1`. For `m ≤ w` this is `O(1)`; for `m > w` it is `O(⌈m/w⌉)` because the add and shifts carry across `⌈m/w⌉` words. Contrast the scalar DP: an `m`-step inner loop per column. Myers replaces that inner loop with the hardware adder's carry chain, which is why a faithful implementation computes Levenshtein distance in `O(n)` for `m ≤ w`. The formulas are unforgiving — a single misplaced shift silently corrupts the distance — so always validate against the full `O(nm)` DP (Task 11 in `tasks.md`); the reference implementation in `senior.md §8.2` is the canonical correct form to diff against.

### 7.3 Distance recovery and banding

The running `score` tracks `D[i][m]` (the last DP row) as text columns advance; `HP`/`HN`'s top bit encodes whether that bottom-row value rose or fell. For *approximate search* (report positions with distance `≤ k`), one simply checks `score ≤ k` after each column — no extra structure. A **banded** variant restricts the bit vectors to the diagonal band of width `2k+1` around the main diagonal, since cells outside the band cannot reach distance `≤ k`; this caps the word count at `⌈(2k+1)/w⌉` and is how production fuzzy matchers (e.g. `edlib`) achieve `O(nk/w)` for small `k`.

---

## 8. SWAR: Arithmetic in the Word-RAM

Pure bitset acceleration uses 1-bit lanes (Boolean, carry-free). **SWAR** packs `b`-bit lanes and performs lane-parallel *arithmetic*, using masks to confine carries.

**Definition 8.1 (Packed field).** Partition a `w`-bit word into `w/b` fields of `b` bits. A SWAR operation computes a function on all `w/b` fields with `O(1)` whole-word instructions.

**Theorem 8.2 (Parallel popcount).** The Hamming weight of a `w`-bit word is computed in `O(log w)` word operations by the folding
```
x = x − ((x >> 1) & 0x5555…);                         // 1-bit fields → 2-bit counts
x = (x & 0x3333…) + ((x >> 2) & 0x3333…);              // → 4-bit counts
x = (x + (x >> 4)) & 0x0F0F…;                          // → 8-bit counts
popcount = (x · 0x0101…) >> (w − 8);                   // sum bytes via multiply
```

**Proof.** Each step computes, in parallel for every field of the current width, the sum of two adjacent sub-field counts; the masks `0x55…, 0x33…, 0x0F…` prevent a field's partial sum from overflowing into its neighbor. After `log₂ w − 2` folds the fields hold byte-wise counts; the final multiply-and-shift sums the `w/8` byte counts into the top byte (a SWAR horizontal add). Correctness is by induction on the field width: the invariant "field `f` holds the popcount of the original bits in field `f`" is preserved by each fold. ∎

**Theorem 8.3 (Zero-byte detection, the `strlen` trick).** A word `x` contains a zero byte iff
```
(x − 0x01010101…) & (~x) & 0x80808080… ≠ 0.
```
**Proof.** Subtracting `1` from a byte sets its high bit iff the byte was `0x00` (borrow), *unless* the byte already had its high bit set — which `& ~x` excludes; masking with `0x80…` isolates the per-byte high bits. The carry from one byte's subtraction is stopped from corrupting the next by the structure of the constant. ∎

**Significance.** SWAR is the rigorous generalization of bit-parallelism from `b = 1` (free, the bitset case) to `b > 1` (needs masking to block inter-field carry). Myers' algorithm (Section 7) is the inverse: it deliberately *uses* the carry chain as computation rather than blocking it. Both are word-RAM `O(1)`-per-word manipulations exploiting that `+`, `&`, `<<` act on all lanes at once.

### 8.1 The carry-blocking discipline

A SWAR lane add `X ⊞ Y` (packed `b`-bit lanes) must prevent each lane's carry from spilling into its neighbor. The standard technique masks off the high bit of each field, adds, then re-inserts the lane carry via XOR:

```
mask = 0x7F7F…             // clear the top bit of each byte
sum  = ((X & mask) + (Y & mask)) ^ ((X ^ Y) & ~mask)
```

The first term adds the low 7 bits per lane (carry cannot escape the cleared top bit); the second term restores the top bit per lane via XOR (which is addition mod 2 with no carry). This computes 8 independent byte additions in `O(1)`. Saturating, averaging (`(X & Y) + ((X ^ Y) >> 1)`), and compare operations follow the same clear-add-fix pattern.

### 8.2 Why 1-bit lanes are free

The reason the bitset case needs no masking is that a 1-bit field has *no room* for a carry: `OR`, `AND`, `XOR` on single bits never produce an inter-lane carry by definition (they are not addition). The instant the lane width exceeds 1 and the operation is arithmetic (`+`, `-`, `·`), carries appear and masking becomes mandatory. This is the precise boundary between "free bit-parallelism" (Boolean, the focus of this topic) and "SWAR arithmetic" (its multi-bit generalization). The subset-sum, Shift-Or, and reachability speedups all live on the free side; Myers straddles it by treating the carry as a feature.

### 8.3 The select / rank primitives

Beyond popcount, two SWAR-adjacent primitives complete the bitset toolkit and have `O(1)` or `O(log w)` realizations:

- **rank(B, s)** — number of set bits in positions `< s`. Computed as `popcount(B & ((1 << s) - 1))` for a single word, or with a prefix-sum of per-word popcounts for a multi-word bitset (`O(W)` precompute, `O(1)` query). Rank turns a bitset into a compact "how many reachable sums below `s`" oracle.
- **select(B, r)** — position of the `r`-th set bit. Solved by scanning words while subtracting their popcounts, then a within-word select (a known `O(log w)` SWAR sequence or a PDEP-based `O(1)` on x86 BMI2). Select enumerates the reachable sums in order without testing every bit.

Together with popcount and ffs (Definition 1.4), rank and select make the bitset a *succinct* data structure: it stores `T` booleans in `T/w` words and answers membership, count, rank, and select in `O(1)`/`O(log w)` — the foundation of succinct/compressed data structures (wavelet trees, FM-indexes) that build on exactly these word-parallel primitives.

---

## 9. Lower Bounds and What `/w` Cannot Buy

**Proposition 9.1 (Information-theoretic floor).** Any algorithm that must read all `T` bits of input or produce all `T` bits of output uses `Ω(T/w)` word operations — the bitset bound is optimal up to constants for problems that genuinely touch the whole universe.

**Proposition 9.2 (No polynomial speedup from `/w`).** Because `w = Θ(log N)` (strict model) or `w = 64` (practice), dividing by `w` reduces the running time by at most a `Θ(log N)` (or constant) factor. Hence bit-parallelism cannot move a problem between polynomial-time classes (e.g. it cannot make an `NP`-hard search polynomial), and subset-sum remains weakly `NP`-hard / pseudo-polynomial regardless of the `/w`.

**Proposition 9.3 (Boolean multiply has no free `ω`).** The bitset `/w` for Boolean matrix multiply is independent of the matrix-multiplication exponent `ω`; combining them (subcubic *and* word-packed) requires embedding Boolean into a ring (e.g. counting with `0/1`), which sacrifices the pure-Boolean packing. In the Boolean semiring alone, `O(n³/w)` is the practical state of the art for moderate `n`, with the Four-Russians method (Section 10) giving a further `O(n³ / (w log n))`-style improvement only via preprocessing tables.

These bounds frame bit-parallelism precisely: it is an `Θ(w)`-factor constant optimization, optimal for whole-universe problems, but powerless to change asymptotic difficulty classes.

**Proposition 9.4 (Sparse-input crossover).** For a set of `m` elements over a universe `T`, the bitset costs `Θ(T/w)` per scan while a sorted/hashed sparse representation costs `Θ(m)`. The bitset wins iff `T/w < m`, i.e. iff the **density** `m/T > 1/w`. Below density `1/w ≈ 1/64`, the sparse representation is asymptotically faster; this is the formal threshold behind the senior-level advice "use a hash set when the data is sparse".

**Proposition 9.5 (Cell-probe lower bound for membership).** In the cell-probe model with word size `w`, dynamic membership over a universe of size `T` with `m` elements requires `Ω(log(T/m)/log w)` probes per query in the worst case (Pătraşcu-style bounds for predecessor/membership). The static bitset answers membership in `O(1)` probes, so it is *optimal for the static dense case*, while sparse dynamic sets pay the logarithmic predecessor price — another lens on the same density crossover.

### 9.1 Putting the bounds together

The three results above pin bit-parallelism's role exactly:

1. It saves a factor of `w` (Cor 4.2) — real and large in practice.
2. It cannot cross a complexity class (Prop 9.2) — `NP`-hard stays `NP`-hard, pseudo-poly stays pseudo-poly.
3. It is the *optimal* representation only in the **dense** regime (Prop 9.4, 9.5) — below density `1/w`, sparse wins.

This is the rigorous version of the engineering rule of thumb: reach for bitsets when the universe is dense and moderate, the loop is boolean, and the algorithm class is already acceptable; otherwise the `/w` is the wrong lever.

---

## 10. The Four-Russians Connection

**The method of Four Russians** (Arlazarov-Dinic-Kronrod-Faradzhev) precomputes results for all `2^t` possible `t`-bit blocks and looks them up, achieving an extra `log`-factor beyond the raw bitset `/w`.

**Theorem 10.1 (Four-Russians Boolean multiply).** Boolean `n × n` matrix multiplication can be done in `O(n³ / (w log n))` (or `O(n³ / log² n)` in the classical RAM statement) by partitioning rows into blocks of `t = Θ(log n)` columns and table-lookup of precomputed block-ORs.

**Proof sketch.** Group the `n` columns of `A` into `n/t` blocks of width `t`. For each block, precompute a table indexed by the `2^t` possible bit-patterns, mapping each pattern to the OR of the corresponding rows of `B`. With `t = log n`, the table has `n` entries, built in `O(n · n/w)` per block. Each output row then ORs `n/t` looked-up bitsets, `O((n/t)(n/w))` per row, `O(n · (n/t)(n/w)) = O(n³/(t·w)) = O(n³/(w log n))` total. ∎

**Relation to bitset acceleration.** The plain bitset gives `/w`; Four Russians multiplies that by an extra `1/log n` via preprocessing. Both are word-RAM constant-/log-factor techniques on the *same* Boolean problem; the bitset is the simpler, allocation-free baseline, and Four Russians is the table-driven refinement. The same idea underlies the bit-parallel LCS / edit-distance speedups (Masek-Paterson applied Four-Russians to edit distance before Myers' cleaner bit-vector formulation).

### 10.1 When Four Russians beats the plain bitset

The extra `1/log n` factor of Four Russians comes at the cost of building `O(n/log n)` lookup tables of `n` entries each, `O(n²/log n)` preprocessing. This pays off only when `n` is large enough that `log n` is a meaningful divisor *and* the tables fit in cache — otherwise the table-lookup random access defeats the streaming advantage of the plain bitset. In practice:

| Regime | Method | Why |
|--------|--------|-----|
| `n ≤ ~1000` | plain bitset `O(n³/w)` | tables not worth building; streaming OR is cache-friendly |
| `n` large, dense, one-shot | Four Russians `O(n³/(w log n))` | the extra `log n` factor materializes |
| `n` large, ring/counting | Strassen / GEMM `O(n^ω)` | asymptotically better, needs subtraction |

The progression `bitset → Four Russians → Strassen` is a ladder of increasing sophistication and decreasing applicability: the bitset works on the bare Boolean semiring with no preprocessing; Four Russians adds tables; Strassen needs a ring. Choose the lowest rung that meets the performance need.

### 10.2 Historical note

Arlazarov-Dinic-Kronrod-Faradzhev (1970) introduced the method for Boolean matrix multiply and transitive closure; Masek-Paterson (1980) applied it to edit distance for an `O(nm/log²(min(n,m)))` bound; Myers (1999) later achieved the cleaner `O(nm/w)` by the bit-vector carry-chain formulation, which is both simpler to implement and (for `m ≤ w`) faster, since it avoids table construction entirely. The arc — from precomputed tables to a single clever use of the ALU adder — is a recurring pattern in bit-parallel algorithm design: the best word-RAM algorithms often replace data structures with arithmetic identities.

---

### 10.3 A unifying lens: the three speedup mechanisms

Every result in this document is one of three word-RAM mechanisms, and it is worth naming them explicitly:

1. **Lane parallelism (free, 1-bit).** `AND/OR/XOR` on packed booleans — the bitset Boolean algebra (Section 2). No carries, no masks: the `/w` is automatic. Powers subset-sum reachability, set algebra, transitive closure, Shift-Or.
2. **Carry-as-computation.** Integer addition's carry chain is a parallel prefix scan; Myers (Section 7) exploits it to collapse the sequential `min`-propagation of an edit-distance column into one `+`. SWAR (Section 8) is the dual — it *blocks* the carry to keep lanes independent.
3. **Precomputed tables (Four Russians, Section 10).** Trade `O(2^t)` preprocessing per `t`-bit block for an extra `1/log n` factor; the table-lookup replaces a loop with a memory read.

Mechanisms (1) and (2) are allocation-free and cache-friendly; (3) adds tables and is worth it only at scale. Almost every "bit trick" in the literature is one of these three (or a composition), which is why a small set of primitives — pack, shift, OR, add-with-carry, popcount, table-lookup — recurs across subset-sum, string matching, edit distance, and reachability alike.

### 10.4 Boundaries of the technique

To close the theory, the four hard boundaries (each proved or cited above):

- **No class change** (Prop 9.2): `/w` is constant/log, never polynomial.
- **Density floor** (Prop 9.4): below density `1/w`, sparse representations win.
- **No subtraction in the Boolean semiring** (Remark 6.5): blocks Strassen, leaves the bitset `/w` as the practical Boolean-multiply method.
- **Counts don't pack** (Sections 3.3, 5.3): only single-bit feasibility packs; counting needs full integer arithmetic and falls back to matrix powers / FFT.

These four are the rigorous fence around bit-parallelism's applicability.

## 11. Summary

- **Word-RAM model.** The word size `w` is the source of every speedup: whole-word ops are `O(1)`, so a bitset over `T` bits supports Boolean algebra in `O(T/w)` per operation (Prop 2.1, Cor 2.2). `w = 64` in practice.
- **Subset-sum correctness.** `B_k = B_{k-1} ∨ (B_{k-1} << d_k)` computes reachable subset sums because *shift = set translation* (Lemma 3.2) and *OR = union* (Prop 2.1); proved by induction (Thm 3.3). The shift is literally "add `d` to every reachable sum at once".
- **Complexity.** Bitset subset-sum is `O(n·T/w)` (Thm 4.1); the `/w` is exactly the word-parallelism and is a *constant factor*, not a complexity-class change (Prop 4.3, 9.2). Same pseudo-polynomial class as the scalar DP.
- **Shift-Or.** `R^{(i)} = (R^{(i-1)} << 1) | mask[c]` encodes the nondeterministic prefix automaton with one bit per state; the simultaneous transition is two word ops, proved correct by induction (Thm 5.3). The automaton lives in a register.
- **Boolean matrix multiply.** Row-bitset ORs give `O(n³/w)` (Thm 6.3); transitive closure and exact-`k` reachability inherit the `/w`. Orthogonal to Strassen's `ω` (no subtraction in the Boolean semiring).
- **Myers' edit distance.** Encodes column vertical-differences as two bit vectors and reuses the **ALU carry chain as a parallel scan** (Thm 7.1) to update a whole column in `O(1)` word ops — `O(n)` for `m ≤ w`. LCS follows.
- **SWAR.** Generalizes from 1-bit lanes (free) to `b`-bit lanes (masked) — parallel popcount (Thm 8.2) and zero-byte detection (Thm 8.3) are the canonical instances; Myers inverts the idea by *using* the carry.
- **Limits.** `/w` is optimal for whole-universe problems (Prop 9.1) but cannot change complexity classes (Prop 9.2). Four Russians (Thm 10.1) adds an extra `1/log n` via precomputed block tables.

### Complexity Cheat Table

| Problem | Scalar | Bit-parallel | Mechanism |
|---------|--------|--------------|-----------|
| Subset-sum reachability | `O(nT)` | `O(nT/w)` | `B \|= B << d` (Thm 3.3) |
| Set union/intersection (dense) | `O(T)` | `O(T/w)` | word-wise Boolean (Cor 2.2) |
| Substring search (`m ≤ w`) | `O(nm)` naive | `O(n)` Shift-Or | automaton in a word (Thm 5.3) |
| Boolean matrix multiply | `O(n³)` | `O(n³/w)`; `O(n³/(w log n))` 4-Russians | row-bitset OR (Thm 6.3, 10.1) |
| Edit distance / LCS (`m ≤ w`) | `O(nm)` | `O(n)` Myers | carry-chain scan (Thm 7.1) |
| popcount of a word | `O(w)` | `O(log w)` SWAR / `O(1)` HW | Hamming fold (Thm 8.2) |

### Worked Cross-Reference Table

| File | What it proves/shows about the same identity `B \|= B << d` |
|------|--------------------------------------------------------------|
| `junior.md` | the intuition (shift = add `d` to all sums) and a hand trace |
| `middle.md` | the multi-word cross-word-shift implementation |
| `senior.md` | representation choice (`std::bitset` vs `uint64[]`) and cache reality |
| `professional.md` (here) | Theorem 3.3 correctness, `O(nT/w)` complexity, the GF view |
| `interview.md` | the runnable challenge in Go/Java/Python |
| `tasks.md` | the cross-word-shift exercise (Task 3) and bounded variant (Task 6) |

The single identity threads through all six files at increasing rigor — a deliberate spiral from intuition to proof.

### Closing Notes

- The unifying theorem is **Proposition 2.1**: bitsets *are* the power-set Boolean algebra realized in the word-RAM, so every Boolean connective is one instruction per word, and the `/w` follows mechanically.
- **Shift = translation** (Lemma 3.2) is the one fact behind both subset-sum (`<< d`) and Shift-Or (`<< 1`): a left shift relabels positions, which models "add a constant" and "advance the match frontier" respectively.
- **Myers and SWAR** are dual views of the carry chain: SWAR blocks it to keep lanes independent; Myers exploits it as a parallel scan. Both are pure word-RAM `O(1)`-per-word algebra.
- **The honest limit** (Section 9): bit-parallelism is a `Θ(w)`-factor (constant in practice) optimization — optimal for whole-universe problems, but never a polynomial speedup and never a complexity-class change.

### Proof-Dependency Map

The theorems form a short dependency chain, all rooted in the word-RAM and the Boolean-algebra isomorphism:

```
Def 1.1 (word-RAM)
   └─ Prop 2.1 (bitset ≅ power-set Boolean algebra)
         ├─ Lemma 3.2 (shift = translation) ─ Thm 3.3 (subset-sum correct) ─ Thm 4.1 (O(nT/w))
         ├─ Thm 5.3 (Shift-Or = prefix automaton in a word)
         └─ Prop 6.2 (row-bitset multiply) ─ Thm 6.3 (O(n³/w)) ─ Thm 10.1 (Four Russians)
   └─ Thm 7.1 (Myers, carry-chain scan)  [uses integer add, not pure Boolean]
   └─ Thm 8.2 (SWAR popcount)            [carry-blocking, the dual of Myers]
   └─ Prop 9.2/9.4 (limits: no class change; density floor)
```

Everything above the line is "free" lane parallelism on the Boolean algebra; Myers and SWAR (below) add carry-aware arithmetic; the propositions of Section 9 fence the whole construction. A reader who internalizes Proposition 2.1, Lemma 3.2, and Theorem 7.1's carry insight has the conceptual core of every bit-parallel algorithm in this topic.

Foundational references: Baeza-Yates & Gonnet (1992) for Shift-Or/Bitap; Myers (1999) for the bit-vector edit distance; Wu-Manber (1992) for approximate Bitap; Arlazarov-Dinic-Kronrod-Faradzhev (1970) and Masek-Paterson (1980) for Four Russians; *Hacker's Delight* (Warren) for SWAR and popcount; Hopcroft-Ullman for the word-RAM and Boolean matrix multiply; Pătraşcu for cell-probe lower bounds. Sibling topics: `01-bitwise-operators`, `13/06-bitmask-dp`, `13/09-sum-over-subsets`, and the Boolean-reachability material in `11-graphs`.
