# Parsers — Middle Level

> **Topic:** [Parsers](README.md)
> **Focus:** The two parsing families in depth — LL (top-down) vs LR (bottom-up). FIRST/FOLLOW sets, left-recursion elimination, predictive parsing, shift-reduce, and Pratt parsing for expressions.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

> Focus: **Given a grammar, which parsing algorithm fits, and why?** And: **how do you parse expressions with precedence cleanly?**

At the junior level you hand-wrote a recursive-descent parser by following a grammar. That works beautifully for a carefully designed grammar — but it raises questions you can't answer yet. *Why* does left recursion break it? How does the parser *know* which rule to pick from the lookahead token? What grammars can recursive descent *not* handle, and what handles them instead? And is there a less repetitive way to parse expressions than writing a function for every precedence level?

This level answers all four. The central organizing idea is that parsing algorithms split into two families. **Top-down (LL)** parsers — recursive descent and its table-driven cousin — build the tree from the root down by *predicting* rules from lookahead. **Bottom-up (LR)** parsers — shift-reduce, the engine behind yacc and bison — build the tree from the leaves up by *recognizing* completed rules on a stack. LL is what you write by hand; LR is what tools generate and handles a strictly larger class of grammars, including the left-recursive ones that defeat LL.

In one sentence: **LL parsers decide what they're building before they've seen it; LR parsers decide what they built after they've seen it.** That single difference explains why LR is more powerful and why LL is easier to hand-write with great error messages.

> 🎓 **Why this matters at the middle level:** You will read grammars written for tools (`.y` files for bison, `.g4` files for ANTLR) and need to understand their constraints — "this grammar isn't LL(1)," "this has a shift-reduce conflict." You'll design your own grammars and need to know which rewrites make them parseable. And when you reach for a clean expression parser, **Pratt parsing** is the technique every senior reaches for — it deserves to be in your toolkit now.

This page covers: **FIRST and FOLLOW sets** (the math behind "which rule does the lookahead pick?"), **LL(1)** predictive parsing and what breaks it, **left-recursion elimination** and **left-factoring**, the **LR family** (LR(0), SLR, LALR(1), LR(1)) and the **shift-reduce** machine, the **dangling-else** ambiguity, and **Pratt parsing / precedence climbing** for expressions. `senior.md` goes into parser generators, PEG/packrat, GLR, and conflict resolution; `professional.md` covers production compiler architecture.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` — grammars, terminals/nonterminals, productions, parse tree vs AST, and a hand-written recursive-descent parser.
- **Required:** Comfort with recursion and with thinking about a call stack.
- **Required:** Basic set notation (union, membership) — FIRST/FOLLOW sets are literally sets.
- **Helpful but not required:** Having used a parser generator once, even just to see what a `.y` or `.g4` file looks like.
- **Helpful but not required:** A passing familiarity with finite-state machines — LR parsing is, under the hood, a state machine.

You do **not** need to know:

- How to *construct* LALR tables by hand (that's a tooling concern; we explain what they *do*, not the table-building algorithm in full).
- PEG/packrat, GLR, or parser-combinator internals (those are `senior.md`).
- Semantic analysis, type checking, or what happens to the AST after parsing.

---

## Glossary

| Term | Definition |
|------|-----------|
| **LL(k)** | Top-down parsing: **L**eft-to-right scan, **L**eftmost derivation, **k** tokens of lookahead. Recursive descent is hand-written LL. |
| **LR(k)** | Bottom-up parsing: **L**eft-to-right scan, **R**ightmost derivation (in reverse), **k** tokens of lookahead. |
| **FIRST(α)** | The set of terminals that can *begin* a string derived from α. Tells a top-down parser what to expect. |
| **FOLLOW(A)** | The set of terminals that can appear *immediately after* nonterminal A in some derivation. Needed for rules that can be empty. |
| **Nullable** | A nonterminal that can derive the empty string ε. Affects FIRST/FOLLOW computation. |
| **Predictive parsing** | LL parsing where one lookahead token uniquely selects the production — no backtracking. |
| **Left recursion** | A rule `A → A α` whose first symbol is itself. Kills naive top-down parsing. |
| **Left factoring** | Rewriting `A → α β1 | α β2` as `A → α (β1 | β2)` so a common prefix doesn't force a guess. |
| **Shift** | An LR action: push the next input token onto the parse stack. |
| **Reduce** | An LR action: pop a production's right-hand side off the stack and push its left-hand nonterminal. |
| **Handle** | The substring on top of the stack that matches a production's RHS and is ready to reduce. |
| **LR(0) / SLR / LALR(1) / LR(1)** | A ladder of bottom-up parsers of increasing power (and table size). LALR(1) is the yacc/bison sweet spot. |
| **Shift-reduce conflict** | The parser can't decide whether to shift or reduce. The dangling-else classic. |
| **Reduce-reduce conflict** | The parser can't decide *which* production to reduce by. Usually a grammar design problem. |
| **Ambiguous grammar** | A grammar where some input has more than one parse tree. |
| **Pratt parsing** | A top-down expression-parsing technique driven by per-token **binding powers**; also called precedence climbing. |
| **Binding power** | A numeric precedence assigned to an operator; higher binds tighter. The core of Pratt parsing. |
| **nud / led** | Pratt terms: **nud** = null denotation (token with nothing to its left, e.g. a literal or prefix `-`); **led** = left denotation (token with an expression to its left, e.g. infix `+`). |

---

## Core Concepts

### 1. The LL/LR Split, Precisely

Both families read input left-to-right. The difference is *when they commit to a rule*:

- **LL (top-down)** picks the production for a nonterminal *before* parsing that nonterminal's contents, using lookahead to predict. It produces a **leftmost derivation**: it always expands the leftmost nonterminal first.
- **LR (bottom-up)** parses the contents first and recognizes the completed production *after* seeing all of it. It produces a **rightmost derivation in reverse**: it reduces the rightmost handle.

Practical consequences:
- LL must avoid **left recursion** (it would loop) and needs the lookahead to disambiguate rules early.
- LR handles **left recursion naturally** (it just keeps shifting until a handle completes) and handles a *strictly larger* class of grammars. Every LL(k) grammar is LR(k), but not vice versa.
- LL is easy to write by hand and gives precise errors; LR is usually generated by a tool and gives more uniform (sometimes worse) errors.

### 2. FIRST and FOLLOW: The Math of Prediction

A predictive top-down parser, at each nonterminal, must choose a production from the next token. **FIRST** and **FOLLOW** are the sets that make this decision deterministic.

**FIRST(α)** = the set of terminals that can start a string derived from α.

```text
Grammar:  E → T E'
          E' → + T E' | ε
          T → F T'
          T' → * F T' | ε
          F → ( E ) | id

FIRST(F)  = { ( , id }
FIRST(T)  = FIRST(F) = { ( , id }
FIRST(E)  = FIRST(T) = { ( , id }
FIRST(E') = { + , ε }      (E' can be empty)
FIRST(T') = { * , ε }
```

**FOLLOW(A)** = the set of terminals that can appear right after A. We need it for nullable rules: if `E' → ε`, then to know when to *stop*, we look at what can follow `E'`.

```text
FOLLOW(E)  = { ) , $ }      ($ = end of input)
FOLLOW(E') = FOLLOW(E) = { ) , $ }
FOLLOW(T)  = { + , ) , $ }
FOLLOW(T') = FOLLOW(T) = { + , ) , $ }
```

**The LL(1) rule:** a grammar is **LL(1)** (parseable with one token of lookahead, no backtracking) if, for every nonterminal with multiple productions, the productions' FIRST sets are disjoint — and, for nullable productions, FIRST and FOLLOW don't overlap. When that holds, the next token uniquely selects a production. This is *exactly* the condition that makes your hand-written recursive descent's `if peek == ... else if peek == ...` work without guessing.

### 3. Why Left Recursion Kills Top-Down Parsing

Consider `E → E + T`. A recursive-descent `parseE()` would, as its very first action, call `parseE()` — with no token consumed. Infinite recursion, stack overflow. The parser can never make progress because it must "finish parsing E" before it has consumed anything.

**Left-recursion elimination** rewrites the rule into a right-recursive (or iterative) form:

```text
Left-recursive:     E → E + T | T
Transformed:        E  → T E'
                    E' → + T E' | ε
```

`E` now starts with `T` (which consumes a token), and the repetition moves into `E'`. In practice you implement `E'` as a **loop** rather than recursion — which is exactly the `while peek in (+, -)` loop from the junior calculator. So the junior trick "use a loop, not self-first recursion" *is* left-recursion elimination.

LR parsers need none of this: `E → E + T` is fine because LR builds bottom-up — it shifts `T`, then `+`, then another `T`, then *reduces* `E + T` to `E`. No infinite loop, because the parser recognizes the rule only after seeing the whole thing.

### 4. Left Factoring

When two productions share a prefix, one token of lookahead can't tell them apart:

```text
S → if E then S
S → if E then S else S
```

Both start with `if`. Seeing `if`, the parser can't choose. **Left factoring** pulls out the common prefix:

```text
S  → if E then S S'
S' → else S | ε
```

Now the parser commits to "an if-statement" and defers the `else`/no-`else` decision to `S'`, where a single lookahead (`else` vs anything else) decides. Left factoring and left-recursion elimination are the two standard grammar surgeries that turn a natural grammar into an LL(1) one.

### 5. The Bottom-Up Machine: Shift-Reduce

An LR parser is a state machine with a **stack**. At each step it consults a table (built from the grammar) and does one of:

- **Shift**: push the next input token onto the stack and move to a new state.
- **Reduce**: the top of the stack matches some production's right-hand side (the **handle**); pop it and push the production's left-hand nonterminal.
- **Accept**: the stack holds just the start symbol and input is exhausted.
- **Error**: no valid action.

Parsing `id + id * id` (with the expression grammar) sketches like this:

```text
Stack            Input          Action
                 id + id * id $  shift id
id               + id * id $     reduce F→id, then T→F, then E→T
E                + id * id $     shift +
E +              id * id $       shift id
E + id           * id * id $     reduce F→id, T→F
E + T            * id $          shift *          ← shift, not reduce E→E+T!
E + T *          id $            shift id
E + T * id       $              reduce F→id, T→T*F
E + T            $              reduce E→E+T
E                $              accept
```

The key moment is at `E + T` facing `*`: the parser **shifts** instead of reducing `E → E + T`, because reducing now would compute `(id + id) * id` — wrong precedence. The table "knows" to shift because `*` binds tighter. This is how LR encodes precedence: in the shift/reduce decisions. Notice LR handled `E → E + T` (left recursion) without complaint.

### 6. The LR Power Ladder: LR(0) → SLR → LALR(1) → LR(1)

These differ in how much information the parser states carry, which controls how many conflicts they avoid:

- **LR(0)**: no lookahead in reduce decisions. Weak; conflicts on almost any real grammar.
- **SLR (Simple LR)**: uses FOLLOW sets to decide when to reduce. Better, still limited.
- **LALR(1)**: merges LR(1) states with identical cores, using per-state lookahead. **This is what yacc and bison generate.** It's the sweet spot: handles essentially all practical programming-language grammars with compact tables. Its only downside is occasional spurious reduce-reduce conflicts from state merging.
- **LR(1)**: full one-token lookahead per state. Most powerful of the standard family, but tables can be huge — historically avoided for memory, now used by some modern generators.

The takeaway: when a tool says "LALR(1)," it means the bison-class parser. When you hit a "conflict" message, it's the parser saying "two actions are possible and I can't decide."

### 7. Shift-Reduce and Reduce-Reduce Conflicts

A **shift-reduce conflict**: in some state, the parser could either shift the next token or reduce a completed rule, and the grammar doesn't say which. The textbook case is the **dangling else**:

```text
S → if E then S
S → if E then S else S
```

Parsing `if a then if b then c else d`, at the point after `c` with `else` next, the parser can either shift `else` (attach it to the *inner* if) or reduce the inner `if b then c` to `S` (attach `else` to the *outer* if). Both are valid parses — the grammar is **ambiguous**. Tools default to **shift**, which attaches `else` to the nearest `if` — the rule every C-family language uses. You can also resolve it by rewriting the grammar (matched/unmatched statements) so it's unambiguous.

A **reduce-reduce conflict**: the parser could reduce by two different productions. This almost always signals a genuine grammar design flaw or an over-merged LALR state, and you fix it by restructuring the grammar.

### 8. Pratt Parsing: Expressions Done Right

Layering one function per precedence level (junior style) works but is verbose — ten precedence levels means ten near-identical functions. **Pratt parsing** (a.k.a. **precedence climbing**) collapses them into one elegant loop driven by **binding powers**.

Assign each operator a number — its binding power:

```text
+  -   : 10
*  /   : 20
^      : 30  (right-associative)
```

The algorithm parses an expression with a *minimum binding power* it's willing to absorb. It parses a leading operand (a **nud** — null denotation: a literal, a prefix `-`, a `(`), then loops: while the next operator's binding power is *higher* than the minimum, it consumes the operator and recursively parses the right side (a **led** — left denotation) with that operator's binding power as the new minimum. Higher binding power on the right = it grabs more; that's how precedence emerges from a single function. Associativity is controlled by whether the recursive call uses the operator's binding power (right-assoc) or binding power + 1 (left-assoc).

This is why nearly every modern hand-written compiler uses recursive descent for statements and **Pratt parsing for expressions** — it's the cleanest known way to handle many precedence levels with arbitrary prefix/infix/postfix operators.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **LL (top-down)** | Filling in an outline: you decide "this is a chapter, now its sections" before writing the content. |
| **LR (bottom-up)** | Assembling furniture: you build small subassemblies, then recognize "ah, these three pieces form a drawer." |
| **FIRST set** | The list of words that can legally *start* a particular kind of phrase. |
| **FOLLOW set** | The list of words that can legally come *right after* a phrase ends. |
| **Left recursion** | A dictionary defining a word using itself as the very first word — circular, you never get traction. |
| **Shift** | Picking up the next puzzle piece and setting it on your work table. |
| **Reduce** | Recognizing that several pieces on the table now form a complete edge, and snapping them into one unit. |
| **Shift-reduce conflict** | Two equally-licensed ways to read "I saw the man with the telescope" — who has the telescope? |
| **Binding power** | How "sticky" an operator is — `*` is stickier than `+`, so it grabs its neighbors first. |
| **Dangling else** | "Press the button if the light is red if you are ready" — which condition does the last clause attach to? |

---

## Mental Models

### The "Predict vs Recognize" Model

LL **predicts**: at a fork, it bets on a rule from the lookahead, then verifies the bet. LR **recognizes**: it accumulates tokens on a stack and waits until a complete rule is unmistakably present, then collapses it. Prediction is easier to write but needs a cooperative grammar; recognition is more powerful but needs a table you don't want to build by hand. Whenever you read a parser, ask: is it betting early (LL) or confirming late (LR)?

### The "Stack Is the Frontier" Model (for LR)

In an LR parser, the stack holds a mix of terminals and nonterminals representing *the part of the tree built so far, viewed at its growing edge*. Each reduce shrinks the frontier by one level (replacing a handle with its parent nonterminal); each shift extends it by one token. The whole parse is a sequence of "grow the frontier, then collapse a completed branch." When it finally collapses to just the start symbol, the tree is whole.

### The "Binding Power Tug-of-War" Model (for Pratt)

Picture each operand being pulled left and right by its neighboring operators, each pulling with a force equal to its binding power. `2 + 3 * 4`: the `3` is pulled left by `+` (force 10) and right by `*` (force 20). `*` wins, so `3` binds to `4` first. Pratt parsing is just this tug-of-war made into code: an operand goes to whichever operator pulls hardest, and the `min binding power` parameter is how much pull the current context can withstand before it has to stop and return.

---

## Code Examples

### A Pratt Parser for Expressions (Python)

This single function replaces the whole `expression → term → factor` chain and scales to any number of precedence levels, plus prefix operators and right-associativity.

```python
# Binding powers: (left_bp, right_bp). For left-assoc, right_bp = left_bp + 1.
# For right-assoc (like '^'), right_bp = left_bp - 1 so the same operator
# recurses into itself.
INFIX = {
    "+": (10, 11), "-": (10, 11),   # left-assoc, precedence 10
    "*": (20, 21), "/": (20, 21),   # left-assoc, precedence 20
    "^": (31, 30),                  # right-assoc, precedence 30
}
PREFIX = {"-": 40, "+": 40}         # unary minus/plus bind very tightly

class Pratt:
    def __init__(self, tokens):
        self.tokens, self.pos = tokens, 0

    def peek(self):  return self.tokens[self.pos] if self.pos < len(self.tokens) else ("EOF", None)
    def next(self):  t = self.peek(); self.pos += 1; return t

    def parse(self, min_bp=0):
        # --- nud: parse the leading operand / prefix ---
        kind, val = self.next()
        if kind == "NUMBER":
            left = ("num", val)
        elif kind in ("PLUS", "MINUS") and (op := {"PLUS": "+", "MINUS": "-"}[kind]) in PREFIX:
            r_bp = PREFIX[op]
            operand = self.parse(r_bp)
            left = ("unary", op, operand)
        elif kind == "LPAREN":
            left = self.parse(0)
            assert self.next()[0] == "RPAREN", "expected )"
        else:
            raise SyntaxError(f"unexpected {kind}")

        # --- led: absorb infix operators while they bind tightly enough ---
        while True:
            kind, _ = self.peek()
            op = {"PLUS": "+", "MINUS": "-", "STAR": "*", "SLASH": "/", "CARET": "^"}.get(kind)
            if op is None or op not in INFIX:
                break
            l_bp, r_bp = INFIX[op]
            if l_bp < min_bp:        # this operator binds looser than our caller wants → stop
                break
            self.next()              # consume the operator
            right = self.parse(r_bp) # recurse with the operator's right binding power
            left = ("binop", op, left, right)
        return left

def show(n):
    if n[0] == "num":   return str(n[1])
    if n[0] == "unary": return f"({n[1]}{show(n[2])})"
    return f"({n[2]} {n[1]} {n[3]})"

# 2 + 3 * 4 ^ 2 ^ 1     →  2 + (3 * (4 ^ (2 ^ 1)))  =  2 + 3*16 = 50
toks = [("NUMBER", 2), ("PLUS", None), ("NUMBER", 3), ("STAR", None),
        ("NUMBER", 4), ("CARET", None), ("NUMBER", 2), ("CARET", None), ("NUMBER", 1)]
print(show(Pratt(toks).parse()))   # (2 + (3 * (4 ^ (2 ^ 1))))
```

Trace the binding powers: when we reach `*` (left bp 20) we recurse with right bp 21; inside, `^` (left bp 31) is `>= 21`, so it gets absorbed; and because `^`'s right bp (30) is *lower* than its left bp (31), the second `^` (left bp 31 ≥ 30) also gets absorbed, giving right-associativity for free. One function, all precedence levels, both associativities. That economy is why Pratt parsing wins.

### Computing FIRST Sets (Python)

To make the LL math concrete, here's a small FIRST-set computer for a grammar:

```python
EPS = "ε"
# productions: nonterminal -> list of RHS (each RHS a list of symbols)
grammar = {
    "E":  [["T", "E'"]],
    "E'": [["+", "T", "E'"], [EPS]],
    "T":  [["F", "T'"]],
    "T'": [["*", "F", "T'"], [EPS]],
    "F":  [["(", "E", ")"], ["id"]],
}
nonterminals = set(grammar)

def first_of_symbol(sym, first):
    if sym not in nonterminals:        # terminal (or ε)
        return {sym}
    return set(first[sym])

def compute_first(grammar):
    first = {nt: set() for nt in grammar}
    changed = True
    while changed:                     # fixed-point iteration
        changed = False
        for nt, rhss in grammar.items():
            for rhs in rhss:
                # add FIRST of the sequence, skipping nullable prefixes
                nullable_prefix = True
                for sym in rhs:
                    f = first_of_symbol(sym, first)
                    new = (f - {EPS})
                    if not new.issubset(first[nt]):
                        first[nt] |= new; changed = True
                    if EPS not in f:
                        nullable_prefix = False
                        break
                if nullable_prefix:    # whole RHS can vanish
                    if EPS not in first[nt]:
                        first[nt].add(EPS); changed = True
    return first

for nt, s in compute_first(grammar).items():
    print(nt, "=", sorted(s))
# E = ['(', 'id']   E' = ['+', 'ε']   T = ['(', 'id']  ...
```

The **fixed-point iteration** (loop until nothing changes) is the standard way to compute FIRST/FOLLOW: each pass propagates a little more information until it stabilizes. The same algorithm shape computes FOLLOW.

### A Bison-Style Grammar with the Dangling-Else (sketch)

```text
%token IF THEN ELSE ID
%%
stmt : IF expr THEN stmt              /* unmatched */
     | IF expr THEN stmt ELSE stmt    /* matched   */
     | ID
     ;
%%
```

Running this through bison prints: `warning: 1 shift/reduce conflict`. Bison resolves it by **shifting** — binding `ELSE` to the nearest `IF` — which is what we want, but the warning is real. To silence it cleanly, rewrite into matched/unmatched statement nonterminals (shown in `senior.md`), or assign precedence to the `ELSE` and `THEN` tokens so the resolution is explicit rather than defaulted.

---

## Pros & Cons

| Aspect | LL / recursive descent | LR / shift-reduce (generated) | Pratt (for expressions) |
|--------|------------------------|-------------------------------|-------------------------|
| **Hand-writable** | Yes — natural and readable. | Painful by hand; use a tool. | Yes — one compact function. |
| **Grammar class** | LL(1)/LL(k): no left recursion, needs left-factoring. | Strictly larger; left recursion is fine. | Expressions only, but any precedence/assoc. |
| **Left recursion** | Must be eliminated. | Handled natively. | N/A — binding powers replace grammar layering. |
| **Error messages** | Excellent — you control them. | More uniform/generic; recovery is work. | Good, scoped to expressions. |
| **Precedence handling** | Via layered functions (verbose). | Via the table's shift/reduce choices. | Via binding-power numbers (elegant). |
| **Conflicts** | None (grammar is forced to be unambiguous). | Shift-reduce / reduce-reduce warnings to resolve. | None — binding powers are total. |
| **Used in production** | GCC, Clang, Go, rustc, V8 (statements). | Many DSLs, SQL, older Cfront/GCC eras, Ruby. | Inside those same hand-written compilers (expressions). |

---

## Use Cases

- **Designing a new language grammar** — knowing LL(1) constraints tells you which rules need rewriting before recursive descent will work.
- **Reading and fixing a `.y`/`.g4` file** — understanding shift-reduce conflicts lets you interpret and resolve generator warnings instead of guessing.
- **Building an expression evaluator with many operators** — Pratt parsing is the right tool: comparison, logical, arithmetic, bitwise, ternary, all in one function.
- **Choosing between hand-written and generated** — if your grammar is naturally left-recursive and you want it parsed quickly, an LR generator saves rewriting; if you want great diagnostics, recursive descent.
- **Understanding why a grammar is "ambiguous"** — the dangling-else and expression-precedence ambiguities show up constantly; recognizing them saves hours.

When the deeper machinery is overkill: a tiny config format with no nesting and no operators doesn't need FIRST/FOLLOW analysis or Pratt parsing — a flat hand-written reader is fine.

---

## Coding Patterns

### Pattern 1: Eliminate Left Recursion → Loop

`A → A op B | B` always becomes a function that parses one `B` then loops `while next is op`. This is left-recursion elimination realized as iteration. Memorize the shape.

### Pattern 2: Left-Factor Shared Prefixes

When two productions start the same way, parse the common prefix once, then branch on the next token. In code: parse the prefix, then `if peek == else: parseElse()`.

### Pattern 3: Pratt Loop with `min_bp`

The canonical expression pattern: parse a nud, then `while next operator's left_bp >= min_bp: consume; right = parse(right_bp); combine`. Pass `right_bp = left_bp + 1` for left-assoc, `left_bp - 1` for right-assoc.

### Pattern 4: Prefix/Infix/Postfix Tables

Instead of `if`-chains, drive Pratt parsing from lookup tables: `PREFIX[op]`, `INFIX[op] = (left_bp, right_bp)`, `POSTFIX[op]`. Adding an operator becomes adding a table entry — no new code path.

### Pattern 5: Fixed-Point for FIRST/FOLLOW

When you need to compute FIRST/FOLLOW (or any grammar analysis), use the loop-until-stable pattern: keep applying the rules until a full pass changes nothing. This is the universal shape for these set computations.

---

## Best Practices

- **Choose the parser family deliberately.** Hand-written recursive descent + Pratt for a real compiler you'll maintain; a generator for a quick or formally-specified grammar. Don't default; decide.
- **Keep statements recursive-descent, expressions Pratt.** This hybrid is the production standard. Statements have clear keyword prefixes (great for LL prediction); expressions have many precedence levels (great for Pratt).
- **Make precedence data, not code.** Encode operator binding powers in a table. A precedence change should be a one-line table edit, not a code restructure.
- **Treat every grammar conflict as a question, not noise.** A shift-reduce or reduce-reduce warning means *your grammar is ambiguous or near it*. Understand which input triggers it before suppressing it.
- **Resolve the dangling-else explicitly.** Either rely on the documented "shift = nearest if" default *and comment that you did*, or restructure into matched/unmatched rules. Don't leave it implicit.
- **Compute FIRST/FOLLOW when prediction feels unclear.** If you're unsure whether a grammar is LL(1), the sets give a definite answer instead of trial and error.
- **Build the AST during parsing, in both families.** In recursive descent, return nodes; in a generator, attach semantic actions (`{ $$ = makeBinop($1, $2, $3); }`). Never defer tree-building to a second pass without reason.

---

## Edge Cases & Pitfalls

- **Hidden left recursion through nullable rules.** `A → B A`, where `B` can be empty (`B → ε`), is *effectively* left-recursive. FIRST-set analysis catches it; eyeballing often misses it.
- **Forgetting FOLLOW for empty productions.** If a rule can be ε, you can't decide when to stop using FIRST alone — you need FOLLOW. Skipping this makes the parser over- or under-consume.
- **Off-by-one in binding powers.** Swapping `left_bp + 1` and `left_bp - 1` silently flips associativity. `1 - 2 - 3` becoming `1 - (2 - 3) = 2` instead of `-4` is the symptom. Test associativity explicitly.
- **Treating an LALR reduce-reduce conflict as benign.** Unlike shift-reduce (which has a sane default), reduce-reduce usually means a real grammar bug. Fix the grammar; don't suppress it.
- **Assuming the generator's default conflict resolution is what you want.** Bison resolves shift-reduce by shifting and reduce-reduce by earliest rule. Sometimes correct, sometimes not — verify against test inputs.
- **Mixing precedence layering and Pratt inconsistently.** If part of your expression grammar is layered functions and part is Pratt, precedence at the seam gets confusing. Pick one approach for all expressions.
- **Lookahead that isn't enough.** Some constructs need 2+ tokens of lookahead (LL(1) isn't sufficient). Either left-factor, add lookahead, or fall back to a small backtracking probe. Don't pretend one token always suffices.
- **The classic expression-grammar ambiguity.** `E → E + E | E * E | id` *with no layering* is ambiguous — `id + id * id` has two trees. The fix is either the layered grammar (LL/LR) or binding powers (Pratt). Never ship a flat ambiguous expression grammar.

---

## Test Yourself

1. Compute FIRST and FOLLOW for the grammar `S → A B`, `A → a | ε`, `B → b`. Is the grammar LL(1)? Justify using the sets.
2. Eliminate the left recursion from `E → E - T | T`, `T → id`. Write the transformed grammar, then write the recursive-descent function for the new `E`. Does it parse `id - id - id` left-associatively?
3. Left-factor the grammar `cmd → go north | go south | stop`. Show the rewritten productions.
4. Trace the shift-reduce parse of `id * id + id` against the expression grammar from Core Concept 5. At which step does the parser face a shift-vs-reduce choice, and which does it pick?
5. In the Pratt parser, what binding powers would you assign to make `==` lower precedence than `+` and `&&` lower than `==`? Add them and trace `1 + 2 == 3 && true`.
6. Explain in one sentence why LR(0) is too weak for most grammars but LALR(1) is enough. What does the lookahead buy you?
7. The dangling-else grammar has a shift-reduce conflict. Describe the exact input position where the conflict occurs and what each action (shift vs reduce) would mean for the resulting tree.
8. Change the Pratt parser's `^` binding power from `(31, 30)` to `(31, 32)`. Predict how `2 ^ 3 ^ 2` now parses and why.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                   LL vs LR (and Pratt)                           │
├──────────────────────────────────────────────────────────────────┤
│ LL (top-down)   predict rule from lookahead, build root→leaves   │
│   leftmost derivation │ recursive descent │ hand-written         │
│   ✗ left recursion  ✗ ambiguity  needs FIRST/FOLLOW disjoint     │
│ LR (bottom-up)  recognize handle on a stack, build leaves→root   │
│   rightmost-in-reverse │ shift-reduce │ yacc/bison generate it   │
│   ✓ left recursion  larger grammar class  conflicts to resolve   │
├──────────────────────────────────────────────────────────────────┤
│ FIRST(α)  = terminals that can BEGIN α                           │
│ FOLLOW(A) = terminals that can come right AFTER A                │
│ LL(1) ⇔ productions' FIRST sets disjoint (+ FIRST/FOLLOW for ε)  │
├──────────────────────────────────────────────────────────────────┤
│ Grammar surgery for LL:                                          │
│   left recursion  A→Aα|β  ⇒  A→βA' , A'→αA'|ε   (then loop)      │
│   left factoring  A→γβ1|γβ2  ⇒  A→γ(β1|β2)                       │
├──────────────────────────────────────────────────────────────────┤
│ LR ladder: LR(0) < SLR < LALR(1) < LR(1)                         │
│   LALR(1) = the yacc/bison default sweet spot                    │
│   shift-reduce conflict = dangling else (default: SHIFT)         │
│   reduce-reduce conflict = usually a real grammar bug            │
├──────────────────────────────────────────────────────────────────┤
│ Pratt parsing (expressions):                                     │
│   binding power per operator; higher = binds tighter             │
│   parse(min_bp): nud, then while op.left_bp >= min_bp absorb led │
│   left-assoc: recurse with left_bp+1 │ right-assoc: left_bp-1    │
│   ONE function for all precedence levels + prefix/infix          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Parsing splits into **LL (top-down)** and **LR (bottom-up)**. LL **predicts** a rule from lookahead and builds root-to-leaves; LR **recognizes** a completed handle on a stack and builds leaves-to-root.
- **FIRST(α)** is what can begin α; **FOLLOW(A)** is what can come after A. A grammar is **LL(1)** when the lookahead token uniquely picks a production — exactly what makes hand-written recursive descent deterministic.
- **Left recursion** (`A → A α`) crashes naive top-down parsing; eliminate it by rewriting into a right-recursive form that you implement as a **loop**. **Left factoring** removes shared prefixes that defeat one-token lookahead. LR needs neither — it handles left recursion natively and a strictly larger grammar class.
- An **LR/shift-reduce** parser is a stack machine that **shifts** tokens and **reduces** handles, guided by a table. Precedence lives in its shift-vs-reduce decisions. The power ladder is **LR(0) < SLR < LALR(1) < LR(1)**, with **LALR(1)** being the yacc/bison sweet spot.
- **Conflicts** are the parser saying it can't decide: **shift-reduce** (the dangling-else classic; default resolution is to shift = bind to the nearest `if`) and **reduce-reduce** (usually a genuine grammar bug).
- **Pratt parsing / precedence climbing** parses expressions with one function driven by per-operator **binding powers**, handling any number of precedence levels and both associativities elegantly. It's why production compilers pair **recursive descent for statements with Pratt for expressions**.
- A middle engineer's habit: **read a grammar and immediately ask "is this LL(1)? does it have left recursion? where are the conflicts?"** — and reach for **binding powers, not stacked functions**, when parsing expressions.

---
