# Expression Parsing & Evaluation — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions: Alphabets, Grammars, Derivations
1b. The Lexer as a Regular Language
2. A Context-Free Grammar for Arithmetic Expressions
3. Precedence and Associativity, Formalized
4. Ambiguity and Its Resolution
5. Left Factoring and the LL(1) Grammar
6. Recursive Descent = LL(1) Parsing: Correctness
7. The Shunting-Yard Algorithm: Correctness
8. Reverse Polish Notation Evaluation: Correctness
8b. Prefix, Infix, Postfix: Three Linearizations of One Tree
9. Equivalence of the Parsing Strategies
10. Complexity Analysis: Linear Time
10b. Shunting-Yard as Bottom-Up (Shift-Reduce) Parsing
11. Beyond CFG: Pratt Parsing as an Operator-Precedence Method
12. A Fully Worked End-to-End Derivation
13. Error Detection as a Formal Property
14. Evaluation as a Homomorphism
15. Generalization to Richer Grammars
16. Summary

---

## 1. Formal Definitions: Alphabets, Grammars, Derivations

Let `Σ` be a finite **alphabet** of terminal symbols. For arithmetic expressions a convenient terminal set is

```
Σ = { num, +, -, *, /, ^, (, ) }
```

where `num` abstracts any numeric literal produced by the lexer (the lexer maps maximal digit runs to a single `num` terminal; this is the standard separation of **lexical** and **syntactic** analysis).

**Definition 1.1 (Context-free grammar).** A CFG is a 4-tuple `G = (N, Σ, P, S)` where `N` is a finite set of **nonterminals**, `Σ` the terminals (`N ∩ Σ = ∅`), `P ⊆ N × (N ∪ Σ)*` a finite set of **productions** written `A → α`, and `S ∈ N` the **start symbol**.

**Definition 1.2 (Derivation).** Write `αAβ ⇒ αγβ` when `A → γ ∈ P`. The reflexive-transitive closure `⇒*` defines derivability. A **leftmost** derivation `⇒*_lm` always rewrites the leftmost nonterminal. The **language** is `L(G) = { w ∈ Σ* : S ⇒* w }`.

**Definition 1.3 (Parse tree).** A parse (derivation) tree has `S` at the root, internal nodes labeled by nonterminals with children given by a production's right-hand side, and a frontier (left-to-right leaves) spelling the derived string. The **meaning** of an expression is read off its parse tree, so two trees for the same string are two different meanings — the crux of ambiguity (Section 4).

---

## 1b. The Lexer as a Regular Language

The split between lexing and parsing is itself a theorem about language classes: the *token* sublanguages are **regular**, while the *expression* language is properly **context-free** (it requires matched parentheses, which no finite automaton can count).

**Definition 1b.1 (Token regular expressions).** Over the character alphabet `Γ = {0..9, ., +, -, *, /, ^, (, ), space}`:

```
NUM   = [0-9]+ ( "." [0-9]+ )?          // integer or decimal literal
OP    = "+" | "-" | "*" | "/" | "^"
LP    = "("        RP = ")"
WS    = (" ")+                           // skipped, emits no token
```

Each is a regular expression, so each is recognized by a **deterministic finite automaton** (DFA). The lexer is the union DFA that, by the **maximal-munch** rule, at each position takes the *longest* matching token. Maximal munch is what makes `123` one `NUM` and not three; formally it is "run the DFA until it can no longer extend a match, emit the longest accepted prefix, repeat".

**Proposition 1b.2.** The set of valid token strings is regular and recognizable in `O(L)` time over source length `L`, with `O(1)` state.

*Proof.* A DFA processes each character once with constant work and constant memory (its current state); maximal munch adds only a "last accepting position" pointer, still `O(1)`. ∎

**Why the boundary matters.** Pushing number recognition into a regular lexer keeps the CFG's terminal `num` atomic, so the grammar of Section 2 has *no* character-level productions. This is the standard two-level architecture (regular lexer feeding a context-free parser) and it is *forced* by the Chomsky hierarchy: parentheses make expressions non-regular (a pumping-lemma argument on `(^n num )^n`), while literals are non-context-free-requiring, so each layer uses the weakest sufficient machine — a DFA for tokens, a pushdown (the operator/call stack) for structure.

**Lemma 1b.3 (Expressions are not regular).** `L(G)` is not a regular language.

*Proof.* Suppose it were, with pumping length `p`. The string `(^p num )^p ∈ L(G)` would be pumpable as `xyz` with `|xy| ≤ p`, so `y` consists only of `(`; pumping `y` up unbalances the parentheses, leaving the language — contradiction. Hence `L(G)` is context-free but not regular, which is exactly why the parser needs a stack. ∎

---

## 2. A Context-Free Grammar for Arithmetic Expressions

We give the standard **stratified** grammar, in which each precedence level is a nonterminal. Nonterminals `E` (expr), `T` (term), `P` (power), `U` (unary), `F` (factor/primary):

```
E → E + T | E - T | T
T → T * P | T / P | P
P → U ^ P | U
U → - U | + U | F
F → num | ( E )
```

This grammar encodes the entire precedence/associativity policy structurally:

- `E` and `T` are **left-recursive** (`E → E + T`), which produces **left-associative** `+ - * /`.
- `P → U ^ P` is **right-recursive**, producing **right-associative** `^`.
- Higher-precedence operators sit at deeper nonterminals (`F` deepest, `E` shallowest), so they bind tighter — a `*` can only appear *inside* an operand of `+`.

**Proposition 2.1.** `L(G)` is exactly the set of well-formed infix arithmetic expressions over `Σ` with balanced parentheses. *Sketch.* Balanced parentheses follow because every `(` introduced by `F → ( E )` is matched by the closing `)` of the same production; well-formedness (operators between operands, unary signs in legal positions) follows because the only productions are the listed ones, and a straightforward structural induction shows every derivation yields an operator strictly between two operands or a sign strictly before an operand.

---

## 3. Precedence and Associativity, Formalized

**Definition 3.1 (Precedence).** A precedence assignment is a function `prec : Op → ℕ`. In `G`, `prec(+) = prec(-) = 1`, `prec(*) = prec(/) = 2`, `prec(unary ±) = 3`, `prec(^) = 4`. Operator `o₁` *binds tighter than* `o₂` iff `prec(o₁) > prec(o₂)`.

**Definition 3.2 (Associativity).** An operator `o` of arity 2 is **left-associative** if `a o b o c` denotes `(a o b) o c`, and **right-associative** if it denotes `a o (b o c)`.

**Theorem 3.3 (Grammar realizes the policy).** In the unique parse tree assigned by the LL(1) grammar of Section 5, every binary operator groups according to its declared associativity, and whenever two operators `o₁, o₂` are adjacent in the operand sense with `prec(o₁) > prec(o₂)`, `o₁`'s subtree is nested below `o₂`'s.

*Proof idea.* Left-recursion `E → E + T` forces the parse of `a + b + c` to derive `(E + T)` with the left `E` itself deriving `a + b`, so the left `+` is deeper — i.e. evaluated first — giving `(a+b)+c`. Symmetrically, right-recursion `P → U ^ P` puts the right `^` deeper, giving `a^(b^c)`. The stratification (`E` calls `T` calls `P` calls `U` calls `F`) guarantees a higher-precedence operator can only be derived strictly within an operand of a lower-precedence one, so it occupies a deeper subtree and is applied first. ∎

The precedence-climbing parameter (`minPrec`, with `+1` for left-assoc and `+0` for right-assoc) and the Shunting-yard pop conditions (`>=` for left-assoc, `>` for right-assoc) are two operational encodings of exactly this theorem.

**Worked example (associativity from recursion direction).** Consider `8 / 4 / 2`. With the left-recursive `T → T / P` rule, the only derivation is

```
T ⇒ T / P ⇒ (T / P) / P ⇒ ((P) / P) / P ⇒ ... ⇒ (8 / 4) / 2
```

so the tree groups as `(8/4)/2 = 1`, the correct left-associative value. Now consider `2 ^ 3 ^ 2`. With the right-recursive `P → U ^ P` rule:

```
P ⇒ U ^ P ⇒ 2 ^ (U ^ P) ⇒ 2 ^ (3 ^ 2)
```

so the tree groups as `2 ^ (3 ^ 2) = 2^9 = 512`, the correct right-associative value. The *direction of recursion in the production* is the single switch that selects associativity; everything else (the pop rule, the `minPrec` bump) is a re-encoding of this fact.

**Precedence levels are a total preorder.** The map `prec : Op → ℕ` induces a preorder on operators; the grammar's nonterminal layering is an order-isomorphic chain `F ⊐ U ⊐ P ⊐ T ⊐ E` (deeper = higher precedence). Inserting a new operator at a new precedence level is exactly inserting a new nonterminal into this chain — which is why the stratified grammar grows one rule per level, the very cost that Pratt parsing (Section 11) amortizes into a table.

---

## 4. Ambiguity and Its Resolution

**Definition 4.1 (Ambiguity).** A grammar is **ambiguous** if some string has two distinct parse trees (equivalently, two distinct leftmost derivations).

The naive "flat" grammar

```
E → E + E | E - E | E * E | E / E | E ^ E | ( E ) | num
```

generates the same language `L(G)` but is **ambiguous**: `1 + 2 * 3` has a tree meaning `(1+2)*3` and a tree meaning `1+(2*3)`, and `1 - 2 - 3` has `(1-2)-3` and `1-(2-3)`. These trees evaluate to different numbers (`9` vs `7`; `-4` vs `2`), so ambiguity here is a *semantic* defect, not a cosmetic one.

**Counting parse trees.** The degree of ambiguity is itself a classic combinatorial quantity. For a purely associative chain `num o num o … o num` with `m` operators and no precedence distinctions, the number of distinct binary parse trees is the **Catalan number** `C_m = (1/(m+1)) · binom(2m, m)`: `1, 1, 2, 5, 14, 42, …`. So `a o b o c` (`m=2`) has `C_2 = 2` trees — exactly the two we exhibited — and `a o b o c o d` has `C_3 = 5`. The unambiguous stratified grammar collapses all `C_m` shapes to the single one selected by associativity. This is why ambiguity is not a minor wart: the number of *meanings* of a flat expression grows Catalan-exponentially in its length, and disambiguation is what pins it to one.

**Resolution.** Two standard remedies, both giving the *same* disambiguated language:

1. **Stratify by precedence** (the grammar of Section 2): one nonterminal per precedence level, recursion direction chosen for associativity. This produces an **unambiguous** grammar; every string has a unique parse tree.
2. **Disambiguation declarations** layered on the flat grammar (as in `yacc`/`bison`: `%left '+' '-'`, `%left '*' '/'`, `%right '^'`). The parser generator uses precedence to resolve shift/reduce conflicts deterministically, achieving the same trees without rewriting the grammar.

**Proposition 4.2.** The stratified grammar `G` of Section 2 is unambiguous. *Sketch.* Uniqueness is proved by induction on string length: the lowest-precedence top-level operator (the last `+`/`-` not enclosed in parentheses, leftmost for left-associativity) is forced to be the root by the left-recursive `E` productions, and the split into `E` and `T` operands is unique; recurse into the two operands. With no top-level `+`/`-`, control passes uniquely to `T`, then `P`, then `U`, then `F`, each forced. ∎

The famous **dangling-else** ambiguity is the conditional analogue; pure arithmetic avoids it but the same stratify-or-declare toolkit resolves it.

---

## 5. Left Factoring and the LL(1) Grammar

The grammar of Section 2 is **left-recursive** (`E → E + T`), which a top-down (recursive-descent / LL) parser cannot use directly — it would recurse on `E` forever. Standard **left-recursion elimination** rewrites each left-recursive rule into a right-recursive one with a tail:

```
E  → T E'
E' → + T E' | - T E' | ε
T  → P T'
T' → * P T' | / P T' | ε
P  → U P'                    (^ handled by right recursion)
P' → ^ P | ε                 (note: right operand is P, keeping ^ right-assoc)
U  → - U | + U | F
F  → num | ( E )
```

This is the grammar a recursive-descent parser actually implements. Crucially, **associativity is preserved**: although `E'` is now right-recursive in *form*, the canonical implementation folds the operands **left-to-right into an accumulator inside the loop** (`v = v + term()`), which restores left-associativity at the semantic level. The `P' → ^ P` rule keeps the right operand as the full `P`, preserving right-associativity for `^` both syntactically and semantically.

**Definition 5.1 (LL(1)).** A grammar is **LL(1)** if for every nonterminal `A` with productions `A → α₁ | … | α_m`, the sets `FIRST(αᵢ)` are pairwise disjoint, and whenever `ε ∈ FIRST(αᵢ)` (i.e. `αᵢ ⇒* ε`), `FIRST(α_j) ∩ FOLLOW(A) = ∅` for `j ≠ i`. Equivalently, one terminal of lookahead always selects the production.

**Proposition 5.2.** The left-factored grammar above is LL(1). *Sketch.* Compute `FIRST` and `FOLLOW`:

```
FIRST(F)  = { num, ( }
FIRST(U)  = { -, +, num, ( }
FIRST(P)  = FIRST(U)
FIRST(T)  = FIRST(P)
FIRST(E)  = FIRST(T)
FIRST(E') = { +, - }        FOLLOW(E') ⊇ { ), eof }
FIRST(T') = { *, / }        FOLLOW(T') ⊇ { +, -, ), eof }
FIRST(P') = { ^ }           FOLLOW(P') ⊇ { *, /, +, -, ), eof }
```

For each nonterminal, the `FIRST` sets of its alternatives are disjoint (`+/-` vs nothing for `E'`; `*//` vs nothing for `T'`; `^` vs nothing for `P'`; `num` vs `(` for `F`; the sign alternatives vs the fall-through for `U` are distinguished by the leading sign), and each ε-production's `FOLLOW` is disjoint from the corresponding `FIRST`. Hence one token of lookahead suffices. ∎

The disjointness is exactly why the recursive-descent code only ever inspects `peek()` (one token) to decide which branch to take.

**Worked FIRST/FOLLOW derivation.** To see the mechanics, take the rule `E → T E'` and `E' → + T E' | - T E' | ε`.

- `FIRST(E)`: since `E` begins with `T`, and `T` with `P`, … with `F`, we get `FIRST(E) = FIRST(F) = { num, ( }` (plus the unary signs `{ -, + }` introduced by `U`). The leading token of any expression is therefore always a sign, a number, or `(` — never an operator like `*`, which correctly makes `* 3` a syntax error.
- `FIRST(E')`: the non-ε alternatives start with `+` or `-`, so `FIRST(E') = { +, - }`; the ε alternative contributes nothing to `FIRST`.
- `FOLLOW(E')`: `E'` ends a production for `E`, and `E` is followed by `)` (from `F → ( E )`) or end-of-input, so `FOLLOW(E') = { ), eof }`.
- **LL(1) check at `E'`:** the predict set for `+ T E'` is `{+}`, for `- T E'` is `{-}`, and for `ε` is `FOLLOW(E') = { ), eof }`. These three sets are pairwise disjoint, so a single lookahead token decides the production: see `+` or `-` → keep looping; see `)` or eof → take ε and return. This is precisely the `while peek() in {"+","-"}` loop condition in the recursive-descent code.

The same calculation at `T'` (predict sets `{*}`, `{/}`, `FOLLOW(T') = {+,-,),eof}`) and `P'` (predict set `{^}` vs `FOLLOW(P')`) confirms LL(1) throughout.

---

## 6. Recursive Descent = LL(1) Parsing: Correctness

A recursive-descent parser is the **direct procedural encoding** of an LL(1) grammar: one function per nonterminal, an `if`/`while` on the one-token lookahead selecting the production (justified by Proposition 5.2), recursive calls for nonterminals on the right-hand side, and `match(t)` consuming a terminal.

**Theorem 6.1 (Soundness & completeness).** For input token string `w`, the recursive-descent parser for the LL(1) grammar succeeds and consumes all of `w` iff `w ∈ L(G)`, and the sequence of recursive calls traces exactly the (unique) leftmost derivation of `w`.

*Proof sketch.* By structural induction on the LL(1) property. Each procedure `parse_A` maintains the invariant: *called with the cursor at the first token of some `A`-derivable substring, it consumes exactly that substring and returns the value/AST of that subderivation.* The base case is `F → num` (consume one token) and `F → ( E )` (match `(`, recurse, match `)`). The inductive step uses LL(1) disjointness: the lookahead uniquely selects which alternative to expand, so the parser never has to backtrack, and by hypothesis each recursive call consumes precisely its nonterminal's substring. Completeness: any `w ∈ L(G)` has a unique leftmost derivation (Proposition 4.2), and the lookahead-driven choices reproduce it step for step. Soundness: any successful full-consumption run *is* a valid derivation, since every consumption corresponds to a production application. ∎

**Corollary 6.2.** Because the grammar is LL(1), the parser uses **O(1) lookahead** and runs without backtracking, hence in time linear in `|w|` (Section 10).

**The lookahead → production table.** Concretely, the parser's branching is a finite table mapping (nonterminal, lookahead token) to a production. For our grammar:

```
state \ token   num     (       +/-     */      ^       )       eof
  E             E→TE'   E→TE'   —       —       —       —       —
  E'            —       —       loop    —       —       ε       ε
  T             T→PT'   T→PT'   —       —       —       —       —
  T'            —       —       ε       loop    —       ε       ε
  P'            —       —       ε       ε       P'→^P   ε       ε
  U             U→F     U→F     U→±U    —       —       —       —
  F             F→num   F→(E)   ERR     ERR     ERR     ERR     ERR
```

Every cell is uniquely determined (no two productions compete) — that *is* the LL(1) property, and it is exactly the `if peek()==...` / `while peek() in {...}` dispatch in the recursive-descent code. The `ERR` cells (an operator or `)` where `F` expects an operand) are precisely the "missing operand" / "unexpected token" errors of Section 13.

---

## 7. The Shunting-Yard Algorithm: Correctness

Shunting-yard reads infix tokens left to right, maintaining an operator stack `S` and an output sequence `Q`, with the pop rule: on operator `o₁`, while the top `o₂` of `S` is an operator with `prec(o₂) > prec(o₁)`, or `prec(o₂) = prec(o₁)` and `o₁` is left-associative, pop `o₂` to `Q`; then push `o₁`. Parentheses are barriers.

**Theorem 7.1 (Shunting-yard produces the correct postfix).** For any `w ∈ L(G)`, Shunting-yard outputs the **postfix traversal of the unique parse tree** of `w` assigned by the precedence grammar `G`.

*Proof sketch.* We argue that an operator `o` is emitted to `Q` exactly when, in the parse tree, both of its operands' postfix sequences have already been emitted and no operator that must be applied **before** `o` (i.e. one that is its descendant in the tree) remains pending. Consider any operator `o` and the operator `o'` immediately to its left on the stack at the moment `o` is about to be pushed. The pop rule emits `o'` first precisely when `o'` must be applied before `o`:

- If `prec(o') > prec(o)`, `o'` binds tighter, so `o'` is a descendant in the tree of `o`'s left operand and must be emitted first — and the rule pops it.
- If `prec(o') = prec(o)` and the operators are left-associative, left grouping makes the left one apply first — and the rule pops it (`>=`). If right-associative, right grouping makes the right one apply first — and the rule keeps `o'` (`>` only).
- If `prec(o') < prec(o)`, `o` is a descendant of `o'`'s right operand and must be emitted before `o'` — and the rule keeps `o'`.

A `(` is a hard barrier: it blocks popping until its matching `)` flushes exactly the operators of the parenthesized subexpression, which is precisely the subtree rooted at that subexpression. By induction over the tree height, the emission order is exactly post-order, which is the definition of postfix (RPN). ∎

**Unary operators in the proof.** A prefix unary operator (unary `-`) is handled as a high-precedence, right-associative operator pushed when encountered in operand position. Its single operand is the subterm that follows, so in the postfix output it is emitted *after* that operand's block — matching its position as a unary node in the post-order traversal. The stack-height delta (Lemma 8.4) for a unary operator is `0` (consumes one value, produces one), so unary operators do not affect the validity certificate. This is why mixing unary and binary operators preserves both Theorem 7.1 and Lemma 8.4 without special cases.

**Determinism.** The pop rule is *deterministic* given `prec` and the associativity flag: at each step there is exactly one decision (pop or push), so Shunting-yard produces a unique output — consistent with the uniqueness of the parse tree (Proposition 4.2). There is no nondeterminism to resolve, which is what makes the single left-to-right pass sufficient.

**Corollary 7.2.** The pop condition `>=` for left-associative and `>` for right-associative operators is forced by Theorem 3.3 — it is not a heuristic but the operational form of the associativity policy. The two-stack direct evaluator is Shunting-yard with "emit `o`" replaced by "apply `o` to the value stack"; it is correct by the same argument plus Theorem 8.1.

**Worked trace (`1 + 2 * 3`).** Let us instrument the invariant on `1 + 2 * 3`:

```
read 1 : out=[1]              ops=[]        (number → output)
read + : out=[1]              ops=[+]       (stack empty → push)
read 2 : out=[1 2]           ops=[+]       (number → output)
read * : prec(+)=1 < prec(*)=2 → DON'T pop +; push *
         out=[1 2]           ops=[+ *]
read 3 : out=[1 2 3]         ops=[+ *]     (number → output)
end    : pop * then +         out=[1 2 3 * +]
```

The output `1 2 3 * +` is the post-order of the tree `+(1, *(2,3))`, i.e. `1 + (2*3)`. The single decisive moment is "read `*`": because `+` does **not** bind as tightly, it stays buried under `*`, guaranteeing `*` is emitted (and applied) first. Had we wrongly popped `+` there, we would have produced `1 2 + 3 *` = `(1+2)*3`, the classic precedence bug. The theorem's invariant ("emit `o` only when no operator that must precede it remains pending") is exactly what the `<` comparison enforces here.

---

## 8. Reverse Polish Notation Evaluation: Correctness

Let `R = r₁ r₂ … r_m` be the postfix (RPN) sequence of a parse tree. The evaluator scans `R` left to right with a value stack: push each `num`; on a binary operator pop `b` then `a` and push `a ⊙ b` (where `⊙` is the operator's function); on a unary operator pop one value and push its image.

**Theorem 8.1 (RPN evaluation is correct).** Scanning the postfix sequence of a parse tree `t` with the stack rule leaves the stack holding exactly one value, equal to the value of `t` under the operators' semantics.

*Proof (induction on tree structure).*

- *Leaf `num`.* `R = num`; the scan pushes its value; the stack holds the one correct value.
- *Internal node `op(t_L, t_R)`.* By the post-order property, `R = R_L · R_R · op` where `R_L, R_R` are the postfix of the subtrees. By the induction hypothesis, scanning `R_L` leaves `value(t_L)` on top of whatever was below; scanning `R_R` then pushes `value(t_R)` above it. Reading `op` pops `b = value(t_R)` (the later push, on top) and `a = value(t_L)` and pushes `a ⊙ b = value(t)`. The net effect on the pre-existing stack is to replace the operands' region by the single value `value(t)`. ∎

**Remark 8.2 (Operand order).** The proof pins the operand order: the **second** pop is the **left** operand `a`. For non-commutative operators (`-`, `/`, `^`) reversing the two pops is a real bug — `a - b` not `b - a`. The induction makes the correct order unavoidable.

**Concrete demonstration.** Evaluate the postfix of `8 - 3`, namely `8 3 -`:

```
8 : push 8        stack: [8]
3 : push 3        stack: [8, 3]   ← 3 is on top (pushed last)
- : b = pop() = 3 (the right operand)
    a = pop() = 8 (the left operand)
    push a - b = 8 - 3 = 5   ✓
```

Had the implementation computed `b - a = 3 - 8 = -5`, it would be wrong. The order is forced by the order of pushes: the right operand's postfix block (`3`) is emitted *after* the left operand's (`8`), so it sits on top and is popped first. This is the operational content of "post-order = left, right, op".

**Generalization to any binary operator.** The same trace structure holds for `/` and `^`: in `a b /` the divisor `b` is on top, so `pop()` gives the divisor first and the dividend `a` second, yielding `a / b`. In `a b ^` the exponent `b` is on top, giving `a ^ b`. The single rule "second pop = left operand" is therefore correct uniformly across all binary operators, commutative or not — a useful invariant to assert once in code and test on `8 3 -`, `8 2 /`, and `2 3 ^`.

**Corollary 8.3.** A postfix sequence is **valid** iff scanning it never underflows the stack and ends with exactly one value; equivalently iff it is the postfix traversal of some parse tree. This is the formal basis of the "too few / too many operands" error checks.

**Stack-height invariant (validity certificate).** Assign each `num` a "height delta" of `+1` and each binary operator a delta of `−1` (a binary operator consumes two operands and produces one). Let `h_t` be the running sum of deltas after reading the first `t` postfix tokens. Then:

**Lemma 8.4.** A postfix string of binary operators and numbers is valid iff `h_t ≥ 1` for every prefix `t ≥ 1` and `h_m = 1` for the full string of length `m`.

For example, `3 4 + 5` has heights `1, 2, 1, 2` ending at `2 ≠ 1` — invalid (a surplus operand, "too many values left"). And `3 + 4` (read as postfix) has heights `1, 0` — invalid (the `+` underflows at `h = 0 < 1`, "too few operands"). The lemma turns both error classes into a single running-counter check.

*Proof.* `h_t` is exactly the value-stack size after token `t`. An operator needs ≥ 2 items, i.e. `h_{t-1} ≥ 2`, equivalently `h_t = h_{t-1} − 1 ≥ 1`; underflow is precisely `h_t < 1`. Ending with a single value is `h_m = 1`. ∎

This gives an `O(m)` validity check independent of evaluation, and it generalizes to mixed arities: a `k`-ary operator has delta `1 − k`. It is the formal version of "count operands vs operators" sanity checks in production code.

The same delta accounting underlies a one-line corollary: a postfix string of `v` numbers and `b` binary operators is well-formed only if `v = b + 1` (the heights start at 0 and must end at 1, with each number `+1` and each binary operator `−1`). This `v = b + 1` identity is a fast necessary pre-check before the full scan.

---

## 8b. Prefix, Infix, Postfix: Three Linearizations of One Tree

Postfix is not special; it is one of three standard **linearizations** (tree traversals) of the same parse tree, each invertible back to the tree given operator arities.

| Notation | Traversal | `(1+2)*3` | Parens needed? | Evaluation machine |
|----------|-----------|-----------|----------------|--------------------|
| **Prefix** (Polish) | pre-order (op, left, right) | `* + 1 2 3` | no | right-to-left scan, value stack |
| **Infix** | in-order (left, op, right) | `( 1 + 2 ) * 3` | **yes** | needs precedence + parens |
| **Postfix** (RPN) | post-order (left, right, op) | `1 2 + 3 *` | no | left-to-right scan, value stack |

**Theorem 8b.1.** For a fixed-arity operator signature, prefix and postfix linearizations are each **uniquely decodable** back to the parse tree; infix is not (without parentheses/precedence).

*Proof idea.* For postfix, decode right-to-left: the last symbol is the root operator; recursively the symbol stream splits because each subtree's postfix is a *contiguous* block whose stack-height (Lemma 8.4) returns to a known value exactly at its boundary. Prefix is the mirror image (decode left-to-right). Infix fails because, e.g., `1 + 2 * 3` does not encode whether `+` or `*` is the root — the Catalan-many trees of Section 4 all share one parenthesis-free infix string. ∎

**Evaluating prefix.** Scan the prefix string **right to left** with a value stack: push numbers; on an operator pop two values `a` then `b` (note: for prefix the *first* pop is the **left** operand, mirroring postfix) and push `a ⊙ b`. The symmetry between prefix and postfix is exactly the symmetry of pre-order and post-order traversal.

**Why postfix dominates calculators.** Postfix is produced by Shunting-yard in a single left-to-right pass (the natural reading direction) and evaluated in a single left-to-right pass — no reversal, no parentheses, no precedence. Prefix would force either a right-to-left input scan or a reversal. This operational convenience, not any deeper property, is why RPN is the calculator standard.

---

## 9. Equivalence of the Parsing Strategies

**Theorem 9.1.** For a fixed precedence/associativity assignment, recursive-descent (LL(1)) parsing, the Shunting-yard algorithm, and precedence climbing / Pratt parsing all assign the **same parse tree** to every `w ∈ L(G)`.

*Proof idea.* By Proposition 4.2 the precedence grammar `G` is unambiguous: each `w ∈ L(G)` has a *unique* parse tree `t(w)`. Theorem 6.1 shows recursive descent reproduces the leftmost derivation of `t(w)`. Theorem 7.1 shows Shunting-yard outputs the postfix of `t(w)`, and post-order determines the tree uniquely (a tree is recoverable from its postfix plus operator arities). Precedence climbing's `minPrec` recursion was shown (Theorem 3.3 / Section 5) to realize the same associativity and precedence nesting. Three procedures, one tree. ∎

Thus the choice among them is engineering (iterative vs recursive, AST vs RPN vs direct value, ease of extension) and not semantic: they cannot disagree on a well-formed input.

---

## 10. Complexity Analysis: Linear Time

**Theorem 10.1.** Lexing, Shunting-yard conversion, RPN evaluation, and LL(1) recursive descent each run in `O(n)` time and `O(n)` space, where `n = |w|` is the number of tokens (itself `O(L)` in the source length `L`).

*Proof.*

- **Lexing.** Each source character is examined a constant number of times (the inner digit/identifier scan advances the cursor monotonically), so lexing is `O(L)`, producing `n = O(L)` tokens.
- **Shunting-yard.** Each token is pushed to the operator stack at most once and popped at most once; numbers are appended once. Total stack operations `≤ 2n`, so `O(n)` time. The stack and output are size `O(n)`.
- **RPN evaluation.** Each postfix token triggers `O(1)` stack operations (one push, or two pops + one push); total `O(n)`. Value stack size `≤ n`, so `O(n)` space.
- **Recursive descent.** Each `parse_*` call consumes at least one token before recursing on the *rest*, and the LL(1) property forbids backtracking, so the total number of calls is `O(n)`; each does `O(1)` work besides recursion. Recursion **depth** is `O(d)` where `d` is the maximum parenthesis-nesting plus the fixed number of precedence levels, bounded by `O(n)`. Hence `O(n)` time, `O(d) ⊆ O(n)` auxiliary space. ∎

There is no hidden super-linear factor: the precedence grammar's LL(1)-ness is exactly what rules out the backtracking that would make general top-down parsing exponential. (General CFG parsing is `O(n³)` via CYK/Earley; the restricted expression grammar is far cheaper precisely because it is LL(1).)

**Amortized accounting for Shunting-yard.** A tighter argument uses a potential function `Φ = |operator stack|`. Each input token does `O(1)` "real" work plus some number `p` of pops; each pop decreases `Φ` by 1 (so it is paid for by a prior push). Since every operator/paren is pushed exactly once, the total number of pops over the whole run is `≤` the total number of pushes `≤ n`. Hence the sum of all `p` across tokens is `O(n)`, and the whole conversion is `O(n)` — even though a single token (e.g. a `)` closing a deeply built-up group) can trigger `Θ(n)` pops, the cost is amortized to `O(1)` per token.

**Recursion-depth bound, precisely.** For recursive descent the call depth on input `w` is `D(w) = (max parenthesis nesting in w) × c + c'` for small constants `c, c'` (the fixed number of precedence-rule levels traversed between two `(`s). Thus `D(w) = O(nesting)`, independent of the *width* of the expression: `1 + 2 + 3 + … + n` parses at constant depth (the `expr` loop is iterative), whereas `((((…))))` parses at depth `Θ(n)`. This is the formal basis for the *depth cap* DoS guard in `senior.md`: bound `nesting`, not length, to bound stack usage.

---

## 10b. Shunting-Yard as Bottom-Up (Shift-Reduce) Parsing

Recursive descent is **top-down** (LL): it expands nonterminals from the start symbol. Shunting-yard is essentially **bottom-up** (LR-flavored): it recognizes operands and operators and *reduces* them into larger subexpressions, building the tree from the leaves up.

**The correspondence.** Map Shunting-yard's two actions to shift-reduce parsing:

- **Shift:** reading a token and pushing it (a number to output, an operator to the operator stack) corresponds to a *shift* — consuming an input symbol onto the stack.
- **Reduce:** popping an operator to the output (and, in the direct evaluator, combining two values) corresponds to a *reduce* by a production like `E → E + T` — replacing a recognized right-hand side with its nonterminal.

The pop decision ("does the stack-top operator bind at least as tightly as the incoming one?") is exactly a **shift-reduce conflict resolution** driven by precedence — the same mechanism `yacc`/`bison` use when you declare `%left '+' '-'`. A shift means "the incoming operator binds tighter, keep building its left operand"; a reduce means "the stacked operator binds at least as tightly, apply it now".

**Operator-precedence relations.** Classical operator-precedence parsing defines three relations between adjacent operators: `a ⋖ b` (`a` yields to `b`, shift), `a ⋗ b` (`a` takes precedence, reduce), and `a ≐ b` (equal, e.g. `(` and `)`). For our table:

```
        +    *    (    )
   +    ⋗    ⋖    ⋖    ⋗
   *    ⋗    ⋗    ⋖    ⋗
   (    ⋖    ⋖    ⋖    ≐
```

`+ ⋗ +` (left-assoc: reduce on equal), `+ ⋖ *` (`*` binds tighter: shift), `( ≐ )` (matched parens). Shunting-yard *is* an operator-precedence parser reading these relations off the `prec` function plus the associativity rule. This is the historical pedigree: Dijkstra's algorithm predates and inspired the operator-precedence parsing chapter of compiler theory.

**Why this matters.** Recognizing Shunting-yard as bottom-up explains its strengths (iterative, no recursion-depth limit, directly yields postfix = the reduce order) and clarifies Theorem 9.1: top-down LL and bottom-up operator-precedence are two traversal *directions* over the same unambiguous tree, so they cannot disagree.

---

## 11. Beyond CFG: Pratt Parsing as an Operator-Precedence Method

Pratt parsing (top-down operator precedence) is not usually presented as a CFG but as an **operator-precedence parser** parameterized by **binding powers**. Each token carries a left binding power `lbp` and, for prefix uses, a `nud` (null denotation); each infix operator carries an `led` (left denotation). The driver `expression(rbp)` loops while the next token's `lbp > rbp`.

**Proposition 11.1.** Assigning `lbp(o) = prec(o)` and, for the recursive `led` call, right binding power `prec(o)` for right-associative and `prec(o)` with a strict `<` test (equivalently `prec(o)+1` with `≤`) for left-associative operators, Pratt parsing yields the same tree as the precedence grammar `G`.

*Proof idea.* The condition `lbp(next) > rbp` is the operational form of "the next operator binds tighter than the context that called us, so it should attach to the current left operand rather than return". This is exactly the nesting rule of Theorem 3.3; the left/right binding-power asymmetry reproduces the `>=`/`>` associativity split. Hence Pratt's tree coincides with `t(w)`. ∎

Operator-precedence grammars are a proper subclass of CFGs with their own precedence relations (`⋖`, `≐`, `⋗`); Shunting-yard is historically an operator-precedence parser, and Pratt parsing is its top-down recursive cousin. All three are bound together by Theorem 9.1.

---

## 12. A Fully Worked End-to-End Derivation

To make Theorems 6.1, 7.1, and 8.1 concrete on one input, take `w = ( 1 + 2 ) * 3` and follow all three lenses to the *same* tree.

**Lexing.** `( 1 + 2 ) * 3` → terminals `( num + num ) * num`.

**LL(1) leftmost derivation** (Theorem 6.1), using the left-factored grammar:

```
E ⇒ T E'
  ⇒ P T' E'
  ⇒ U P' T' E'
  ⇒ F P' T' E'
  ⇒ ( E ) P' T' E'                 [F → ( E )]
  ⇒ ( T E' ) P' T' E'
  ⇒ ( num E' ) P' T' E'            [inner 1]
  ⇒ ( num + T E' ) P' T' E'        [E' → + T E']
  ⇒ ( num + num E' ) P' T' E'      [inner 2]
  ⇒ ( num + num ε ) ...            [E' → ε at ')']
  ⇒ ( 1 + 2 ) * num                [T' → * P, outer 3]
```

The recursive-descent parser reproduces this: outer `expr` calls `term` calls `power` calls `unary` calls `primary`, `primary` sees `(`, recurses into `expr` to parse `1 + 2`, matches `)`, returns to `term` which sees `*` and parses `3`.

**Shunting-yard** (Theorem 7.1):

```
(  : ops=[(]                       out=[]
1  : ops=[(]                       out=[1]
+  : top is ( barrier → push       ops=[( +]   out=[1]
2  : ops=[( +]                     out=[1 2]
)  : pop + ; discard (             ops=[]      out=[1 2 +]
*  : ops=[*]                       out=[1 2 +]
3  : ops=[*]                       out=[1 2 + 3]
end: pop *                          ops=[]      out=[1 2 + 3 *]
```

Postfix: `1 2 + 3 *` — the post-order of the parse tree `*( +(1,2), 3 )`.

**RPN evaluation** (Theorem 8.1):

```
1 : vals=[1]
2 : vals=[1 2]
+ : b=2, a=1 → push 3   vals=[3]
3 : vals=[3 3]
* : b=3, a=3 → push 9   vals=[9]
result = 9
```

All three lenses agree: the unique tree, its postfix, and its value `9 = (1+2)*3`. This is Theorem 9.1 made tangible — the strategies are different walks over one mathematical object.

---

## 13. Error Detection as a Formal Property

Parsing errors are not ad-hoc; each corresponds to a violated invariant of the formalism.

| Error | Violated formal property | Detection rule |
|-------|--------------------------|----------------|
| Illegal character | symbol `∉ Σ` | lexer rejects any char outside the terminal alphabet |
| Unbalanced `)` | parse cursor finds `)` where the LL(1) table predicts none | `primary`/`F` expects `num` or `(` but sees `)` |
| Unbalanced `(` | a `( E )` production's closing `)` never matched | after popping for a group, stack empties before `(` is found; or `(` remains at end |
| Missing operand | `FIRST` mismatch: an operator token in operand position | predict set of `F` is `{num, (}`; an operator there is rejected |
| Trailing input | full derivation completed but tokens remain | top-level `expr` returns yet `pos < len(tokens)` |
| Operand underflow (RPN) | `h_t < 1` (Lemma 8.4) | running stack-height drops below 1 |
| Surplus operands (RPN) | `h_m > 1` (Lemma 8.4) | final stack-height exceeds 1 |

**Proposition 13.1.** The LL(1) parser **rejects** every string outside `L(G)` and accepts every string inside it (Theorem 6.1), so the parser's accept set is *exactly* `L(G)` — there are no false accepts and no false rejects. Equivalently, the set of "valid expressions" is decidable in linear time, and the parser is a linear-time decider for it.

This is why a correctly built parser doubles as a **validator**: membership in the language and successful parsing are the same event. Error *recovery* (reporting several faults) is a separate, heuristic layer on top of this exact decision procedure, discussed in `senior.md`.

---

## 14. Evaluation as a Homomorphism

Parsing and evaluation factor cleanly: parsing maps a string to a **term** (an element of the free algebra over the operator signature), and evaluation is the unique **homomorphism** from that free algebra to the semantic domain (e.g. `ℝ` or `ℤ/pℤ`).

**Definition 14.1 (Term algebra).** Fix a signature `Ω` of operator symbols with arities (`+, -, *, /` binary; unary `-`; constants `num`). The set of well-formed *terms* `T_Ω(X)` over a set of variables/literals `X` is the smallest set containing `X` and closed under applying each operator symbol to the right number of subterms. The parse tree of a valid expression **is** an element of `T_Ω(X)`.

**Definition 14.2 (Evaluation homomorphism).** A semantic algebra interprets each operator symbol as an actual function on a carrier set `D` (e.g. `+ ↦ addition on ℝ`). The **evaluation map** `eval : T_Ω(X) → D` is defined recursively: `eval(num) = `its value, `eval(op(t₁,…,t_a)) = op_D(eval(t₁),…,eval(t_a))`.

**Proposition 14.3.** `eval` is the unique homomorphism extending the literal interpretation; in particular it does not depend on *how* the tree was produced (recursive descent vs Shunting-yard), only on the tree itself.

*Proof idea.* Homomorphisms out of a free algebra are uniquely determined by their action on generators (the literals) — this is the universal property of the term algebra. Since all parsing strategies yield the same tree (Theorem 9.1) and `eval` depends only on the tree, all strategies yield the same value. ∎

**Consequences.**

- **Re-targeting the carrier.** Swapping `D = ℝ` for `D = ℤ/pℤ` (modular arithmetic) or `D = ` matrices changes only the operator interpretations; the parser is untouched. This is the formal reason an AST can be evaluated against different *environments* and different *number systems* with one tree.
- **Constant folding is homomorphism evaluation on closed subterms.** A subtree with no variables is a closed term; `eval` on it is well-defined at parse time, justifying the optimization in `senior.md`.
- **Pretty-printing is another homomorphism**, into the algebra of strings; round-tripping `parse ∘ print = id` on the tree is a homomorphism-inverse property used in property tests.

---

## 15. Generalization to Richer Grammars

The framework extends verbatim to features common in production evaluators; each is a grammar/signature extension, and Theorems 6.1–10.1 carry over.

**Functions.** Add `F → ident ( args )` and `args → E { , E }`. `FIRST(args) = FIRST(E)`; the comma is a fresh terminal with `,` separating arguments. LL(1) is preserved because an `ident` followed by `(` uniquely signals a call (one extra token of lookahead, still constant). The signature `Ω` gains a symbol per function name with its arity; evaluation (Section 14) interprets it via the function registry.

**Comparisons and booleans.** Add lower precedence levels: `Bexpr → Bexpr (&& | ||) Cmp`, `Cmp → E ((==|!=|<|>) E)?`. This deepens the nonterminal chain (Section 3) but stays LL(1) after left-factoring. The carrier `D` becomes a tagged union of numbers and booleans, and `eval` checks operand types — a step toward a *typed* expression language.

**Conditionals.** A ternary `E → Cmp ? E : E` introduces the only classic ambiguity risk (the dangling-`?:`), resolved by declaring `?:` right-associative, mirroring the dangling-else resolution.

**Theorem 15.1.** Each of the above extensions yields an unambiguous, LL(1)-parseable grammar (after standard left-factoring), and the corresponding recursive-descent parser remains an `O(n)` exact decider for the extended language.

*Sketch.* Each extension adds productions whose `FIRST` sets are disambiguated by one token (the function `(`, the comparison/boolean operator, the `?`), preserving the LL(1) property of Proposition 5.2; the linear-time argument of Theorem 10.1 is unaffected since every added production still consumes ≥ 1 token per call. ∎

The takeaway: the small arithmetic core proven here is a *template*. Real formula languages are this template with more nonterminals and a richer carrier, and they inherit unambiguity, LL(1) parseability, linear time, and the evaluation-homomorphism semantics without new theory.

---

## 16. Summary

- Arithmetic expressions are generated by a **context-free grammar**; the everyday **flat** grammar is *ambiguous* (`1+2*3` has two trees with different values), and the standard fix is a **stratified** grammar with one nonterminal per precedence level, recursion direction chosen for associativity (left-recursion ⇒ left-assoc, right-recursion ⇒ right-assoc `^`).
- **Precedence and associativity** are formalized as `prec : Op → ℕ` plus a grouping rule; the grammar *realizes* this policy structurally (Theorem 3.3), and the `>=`/`>` (Shunting-yard) and `minPrec+1`/`+0` (precedence climbing) rules are its operational encodings.
- **Left-factoring** turns the left-recursive grammar into an **LL(1)** grammar with disjoint `FIRST`/`FOLLOW` sets; **recursive descent is the direct encoding of LL(1) parsing**, sound and complete with one-token lookahead and no backtracking (Theorem 6.1).
- **Shunting-yard** emits the **postfix traversal** of the unique parse tree (Theorem 7.1), and **RPN evaluation** computes that tree's value with a stack, with the second pop being the left operand (Theorem 8.1).
- All three strategies — LL(1) recursive descent, Shunting-yard, Pratt/precedence climbing — assign the **same parse tree** to every well-formed input (Theorem 9.1), differing only in engineering.
- Lexing, conversion, evaluation, and recursive descent all run in **`O(n)`** time and space (Theorem 10.1); the LL(1) restriction is exactly what avoids the super-linear cost of general CFG parsing, and the amortized/potential argument shows even a `)` that triggers `Θ(n)` pops is `O(1)` amortized per token.
- The **lexer is regular** (a DFA with maximal munch) while the **expression language is context-free but not regular** (Lemma 1b.3) — the two-level architecture is forced by the Chomsky hierarchy, each layer using the weakest sufficient machine.
- **Shunting-yard is bottom-up** (shift-reduce / operator-precedence), the dual of top-down recursive descent; its pop rule is precedence-driven conflict resolution, and the operator-precedence relations `⋖ ≐ ⋗` encode it.
- **Prefix, infix, postfix** are three linearizations of one tree; prefix and postfix are uniquely decodable, infix is not, and Catalan-many infix trees collapse to one under the unambiguous grammar.
- **Evaluation is the unique homomorphism** from the term algebra to the semantic carrier (Section 14): it depends only on the tree, so all parsers agree and re-targeting `ℝ → ℤ/pℤ` touches only operator interpretations.
- The arithmetic core is a **template**: functions, comparisons, booleans, and conditionals are grammar/signature extensions that inherit unambiguity, LL(1) parseability, `O(n)` time, and homomorphic semantics (Theorem 15.1).

### Master correspondence

```
regular lexer  →  tokens  →  context-free parser  →  parse tree  →  homomorphic eval  →  value
   (DFA)                        (pushdown stack)        (term)         (algebra hom)
                  ┌─────────────────────────────────────────────┐
   recursive descent (top-down, LL(1))   ──┐                     │
   Shunting-yard (bottom-up, op-prec)     ──┼── same unique tree ─┤
   Pratt / precedence climbing            ──┘                     │
                  └─────────────────────────────────────────────┘
```

References to study further: Aho, Lam, Sethi, Ullman, *Compilers: Principles, Techniques, and Tools* — the "Dragon Book" (CFGs, ambiguity, LL(1), FIRST/FOLLOW, operator precedence, LR parsing); Dijkstra's 1961 Shunting-yard note; Vaughan Pratt, "Top Down Operator Precedence" (1973); Theodore Norvell on precedence climbing; Hopcroft, Motwani & Ullman, *Introduction to Automata Theory* (regular vs context-free, pumping lemmas, the Chomsky hierarchy); Flajolet & Sedgewick, *Analytic Combinatorics* (Catalan numbers and tree enumeration); and the universal-algebra view of evaluation as a homomorphism out of a free term algebra. Sibling files `junior.md` (the tokenize → shunt → evaluate pipeline), `middle.md` (recursive descent and ASTs), and `senior.md` (Pratt parsing, error recovery, security) develop the engineering side of every theorem proved here.
