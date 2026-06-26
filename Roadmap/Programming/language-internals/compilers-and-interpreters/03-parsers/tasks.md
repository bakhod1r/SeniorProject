# Parsers — Tasks

> **Topic:** [Parsers](README.md)
> **Focus:** Hands-on parsing exercises — from FIRST/FOLLOW by hand and recursive descent, through Pratt parsing, PEG, error recovery, and a recursive-descent + Pratt capstone for a small language.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up Tasks](#warm-up-tasks)
3. [Core Tasks](#core-tasks)
4. [Advanced Tasks](#advanced-tasks)
5. [Capstone](#capstone)
6. [Self-Check Rubric](#self-check-rubric)
7. [Summary](#summary)

---

## Introduction

These tasks build parsing skill by *writing parsers*, not just reading about them. They progress from grammar analysis you do on paper, through hand-written recursive descent and Pratt expression parsing, into PEG semantics and error recovery, and culminate in a capstone: a complete **recursive-descent + Pratt** parser for a small language with error recovery — the exact architecture every production compiler uses.

Work in any language you're comfortable in (examples lean on Python/pseudocode). Each task has a **goal**, **hints**, **self-checks**, and — for the harder ones — a **sparse solution sketch** (enough to unstick you, not a copy-paste answer). Resist reading the sketch until you've genuinely tried. The point is the muscle memory of building a parser, which no amount of reading delivers.

> Recommended order: do the warm-ups (they're quick and cement vocabulary), then the core tasks in sequence (each builds on the last), then advanced, then the capstone. The capstone reuses code from the Pratt and recovery tasks, so don't skip them.

---

## Warm-Up Tasks

### W1 — Classify these grammars (LL? LR? ambiguous?)

**Goal:** Build the reflex of looking at a grammar and naming its properties.

For each grammar, state: (a) is it left-recursive? (b) is it ambiguous? (c) could a naive recursive-descent parser handle it as written?

1. `E → E + T | T`, `T → id`
2. `S → if E then S | if E then S else S | other`
3. `A → a A | b`
4. `E → E + E | E * E | id`

**Self-check:**
- (1) Left-recursive (yes), not ambiguous, recursive descent **cannot** handle as written (infinite recursion on `E`).
- (2) Not left-recursive, **ambiguous** (dangling else), recursive descent can handle the structure but must resolve the ambiguity.
- (3) Not left-recursive (it's *right*-recursive), not ambiguous, recursive descent handles it fine.
- (4) Left-recursive **and** ambiguous (no precedence), recursive descent cannot handle it as written.

**Hint:** Left recursion = a production whose first symbol is the nonterminal itself. Ambiguity = some string has two parse trees.

### W2 — Compute FIRST and FOLLOW

**Goal:** Do the LL math by hand once so the code later makes sense.

For `S → A B`, `A → a | ε`, `B → b`, compute FIRST(S), FIRST(A), FIRST(B), FOLLOW(S), FOLLOW(A), FOLLOW(B). Then decide: is the grammar LL(1)?

**Self-check:** FIRST(A)={a,ε}, FIRST(B)={b}, FIRST(S)={a,b} (since A is nullable, S can start with B's FIRST). FOLLOW(S)={$}, FOLLOW(A)=FIRST(B)={b}, FOLLOW(B)={$}. It **is** LL(1): for `A → a | ε`, FIRST(a)={a} is disjoint from FOLLOW(A)={b}.

**Hint:** For a nullable nonterminal, the LL(1) test compares the FIRST of each non-empty alternative against the FOLLOW of the nonterminal.

### W3 — Eliminate left recursion, then code the loop

**Goal:** Connect the grammar rewrite to the code shape.

Take `E → E - T | T`, `T → id`. (a) Write the left-recursion-eliminated grammar. (b) Write the recursive-descent function for the new `E`. (c) Confirm it parses `id - id - id` **left**-associatively (i.e. `(id - id) - id`).

**Self-check:** Transformed: `E → T E'`, `E' → - T E' | ε`. The function parses one `T`, then loops `while next is '-': consume, parse T, fold left`. Folding *left* as you loop gives left-associativity. If you built the tree right-to-left you'd get the wrong associativity — verify by hand on three operands.

### W4 — Trace a shift-reduce parse

**Goal:** See the bottom-up machine actually run.

Using the expression grammar `E → E + T | T`, `T → T * F | F`, `F → ( E ) | id`, trace the shift-reduce parse of `id + id * id`. Show the stack and action at each step. Identify the one step where the parser faces a shift-vs-reduce choice and which it takes.

**Self-check:** The pivotal moment is at stack `E + T` facing `*`: the parser **shifts** `*` rather than reducing `E → E + T`, because reducing would compute `(id+id)*id` — wrong precedence. The table shifts because `*` binds tighter. Final reductions collapse to `E` and accept.

---

## Core Tasks

### C1 — A recursive-descent parser for a tiny grammar

**Goal:** Hand-write your first parser from a grammar.

Implement a recursive-descent parser for this grammar (assume a lexer gives you tokens):

```text
program → stmt* EOF
stmt    → "print" expr ";"
        | "let" id "=" expr ";"
expr    → term (("+" | "-") term)*
term    → factor (("*" | "/") factor)*
factor  → number | id | "(" expr ")"
```

Produce an AST (nested tuples/objects). Parse and print the tree for:
```
let x = 2 + 3 * 4; print x - 1;
```

**Self-checks:**
- `2 + 3 * 4` must group as `2 + (3 * 4)` (multiplication binds tighter — that's why `term` is *inside* `expr`).
- A missing `;` should produce an error mentioning the expected token.
- Parentheses must override precedence: `(2 + 3) * 4` groups the addition first.

**Hint:** One function per nonterminal. The `( ... )*` loops are your left-recursion-eliminated repetition — `parseExpr` parses one `term`, then `while next in (+,-): consume; parse term; fold left`.

### C2 — Implement FIRST-set computation in code

**Goal:** Turn the W2 hand-computation into an algorithm.

Represent a grammar as a map from nonterminal to a list of right-hand sides (each a list of symbols). Implement `compute_first(grammar)` using **fixed-point iteration** (loop until nothing changes). Test it on the classic expression grammar and confirm `FIRST(E) = {(, id}`, `FIRST(E') = {+, ε}`.

**Sparse solution sketch:**
```python
def compute_first(grammar, nonterminals):
    first = {nt: set() for nt in grammar}
    changed = True
    while changed:
        changed = False
        for nt, rhss in grammar.items():
            for rhs in rhss:
                nullable_prefix = True
                for sym in rhs:
                    f = set(first[sym]) if sym in nonterminals else {sym}
                    if (f - {"ε"}) - first[nt]:
                        first[nt] |= (f - {"ε"}); changed = True
                    if "ε" not in f:
                        nullable_prefix = False; break
                if nullable_prefix and "ε" not in first[nt]:
                    first[nt].add("ε"); changed = True
    return first
```

**Self-check:** Run it twice on the same grammar — the result must be identical (idempotent). Add a nullable rule and confirm ε propagates.

### C3 — A Pratt parser for expressions

**Goal:** Build the expression engine every production compiler uses. (You'll reuse this in the capstone.)

Implement a Pratt parser supporting: `+ - * /` (left-assoc), `^` (right-assoc), unary prefix `-`, and parentheses. Drive precedence from a **binding-power table**, not from `if`-chains.

Test all of these and verify the grouping:
- `2 + 3 * 4` → `(2 + (3 * 4))`
- `2 ^ 3 ^ 2` → `(2 ^ (3 ^ 2))` (right-assoc!)
- `1 - 2 - 3` → `((1 - 2) - 3)` (left-assoc!)
- `-2 ^ 2` → decide and justify: does unary minus bind tighter than `^`?

**Sparse solution sketch:**
```python
INFIX = {"+": (10,11), "-": (10,11), "*": (20,21), "/": (20,21), "^": (31,30)}
PREFIX = {"-": 40}

def parse(self, min_bp=0):
    tok = self.next()
    if tok.kind == "num":        left = ("num", tok.val)
    elif tok.kind in PREFIX:     left = ("neg", self.parse(PREFIX[tok.kind]))
    elif tok.kind == "(":        left = self.parse(0); self.expect(")")
    while True:
        op = self.peek().kind
        if op not in INFIX: break
        l_bp, r_bp = INFIX[op]
        if l_bp < min_bp: break
        self.next()
        left = ("bin", op, left, self.parse(r_bp))
    return left
```

**Self-checks:**
- Right-assoc `^` works because its right_bp (30) is *lower* than its left_bp (31), so a following `^` (left_bp 31 ≥ 30) gets absorbed into the right operand.
- Swap `^` to `(31, 32)` and confirm `2^3^2` flips to left-assoc `((2^3)^2)` — proves you understand the bp asymmetry.
- For `-2 ^ 2`: with PREFIX `-` at 40 > `^` at 31, you get `(-2)^2 = 4`; many languages instead make `-` looser than `^` so it's `-(2^2) = -4`. State which you chose.

### C4 — Hand-build a PEG and trip the prefix-capture trap

**Goal:** Internalize PEG ordered-choice semantics by feeling the trap.

Using simple parser combinators (`lit`, `seq`, `choice` where `choice` is **ordered** — first success commits), build a recognizer for the keywords `for`, `foreach`, `format`.

(a) First write it the *wrong* way (`choice(lit("for"), lit("foreach"), lit("format"))`) and feed it `foreach`. Observe what it matches.
(b) Then fix it and explain the rule.

**Self-check:** The wrong version matches just `for` on input `foreach` (and `format`!) because `"for"` is a prefix and ordered choice commits on first success — it never tries the longer alternatives. The fix: order **longest-first** (`choice(lit("foreach"), lit("format"), lit("for"))`), or anchor with a not-predicate so `for` only matches when not followed by an identifier character. The rule to memorize: **in a PEG, list the longer/more-specific alternative first.**

### C5 — Detect and report the dangling-else ambiguity

**Goal:** Recognize ambiguity and choose a resolution.

Take the grammar `S → if E then S | if E then S else S | other`. (a) Show, on the input `if a then if b then c else d`, the *two* valid parse trees. (b) Implement a recursive-descent parser that resolves it by the **nearest-if** rule (the universal C-family choice). (c) Then sketch the matched/unmatched grammar rewrite that makes the grammar unambiguous without relying on a default.

**Self-check:** Tree 1 attaches `else d` to the inner `if b` (nearest-if — correct/standard). Tree 2 attaches it to the outer `if a`. Your recursive-descent parser gets nearest-if "for free" by greedily consuming an `else` as soon as it sees one after parsing the inner statement. The unambiguous rewrite splits statements into `matched` (every `if` has an `else`) and `unmatched`, so the grammar itself forbids the ambiguous attachment.

---

## Advanced Tasks

### A1 — Add panic-mode error recovery

**Goal:** Make a parser that survives bad input and reports multiple errors. (Reused in the capstone.)

Extend your C1 parser so that on a syntax error it (a) records a diagnostic with the expected token and location, (b) does **not** abort, and (c) **synchronizes** to the next statement boundary (`;`) and resumes. Parse this deliberately-broken input and confirm you get **two** errors, not one:
```
let x = ;  print y
```

**Sparse solution sketch:**
```python
def synchronize(self):
    SYNC = {"SEMI", "PRINT", "LET", "EOF"}
    while self.peek().kind not in SYNC: self.advance()
    if self.peek().kind == "SEMI": self.advance()

def parse_program(self):
    stmts = []
    while not self.at("EOF"):
        mark = self.pos
        try: stmts.append(self.parse_stmt())
        except ParseAbort: self.synchronize()
        if self.pos == mark: self.advance()    # forced progress — never loop forever
    return stmts
```

**Self-checks:**
- You must report the missing expression after `=` **and** the missing `;` after `print y` — two errors from one parse run.
- Remove the `if self.pos == mark: self.advance()` guard and feed input where recovery can't progress; confirm it now infinite-loops. That demonstrates *why* the guard is mandatory.

### A2 — `expect()` returns an error node, not an exception

**Goal:** Build an *error-tolerant* parser that always produces a complete tree.

Refactor A1 so `expect(kind)` records a diagnostic and returns a `("MISSING", kind)` node instead of throwing. The parser should now produce a **full tree even for broken input**, with error/missing nodes where things went wrong — the way an IDE parser works.

**Self-check:** Parse `let x = ;` and confirm the AST has a `let` node whose value is a `MISSING` expression node — the tree is complete and walkable, not absent. This is the core difference between a batch parser (abort on error) and an IDE parser (always produce a tree).

### A3 — Bound recursion depth (parser security)

**Goal:** Stop a stack-overflow denial-of-service.

Add a depth counter to your recursive-descent parser that increments on each nested entry (parens, nested expressions) and raises a clean, *catchable* error past a bound (say 500). Then feed it pathologically nested input:
```
((((((( ... 100000 times ... 1 ... )))))))
```

**Self-check:** *Without* the bound, this input crashes the process with a native stack overflow (try it in a sandbox). *With* the bound, you get a clean "nesting too deep" error and the program keeps running. Explain in one sentence why this is a *security* issue: the parser is the first code to touch untrusted input, so a crash here is a denial-of-service vector.

### A4 — Differential test two implementations

**Goal:** Catch parser divergence the way real teams do.

Write a second, independent parser for your C1 grammar (e.g. a quick PEG/combinator version alongside your recursive-descent version). Generate or hand-write ~30 valid and ~20 invalid inputs. Feed every input to both parsers and assert they **agree** (both accept with the same tree shape, or both reject). Report any disagreement.

**Self-check:** Any input where one accepts and the other rejects is a **parser differential** — exactly the bug that causes "the compiler accepts it but the IDE flags an error." Note that even agreeing on *acceptance* isn't enough; they must agree on the *tree shape* (e.g. precedence/associativity), or downstream tools disagree.

---

## Capstone

### Capstone — A recursive-descent + Pratt parser for a small language, with error recovery

**Goal:** Build the exact architecture every production compiler uses — recursive descent for statements, Pratt for expressions, error-tolerant recovery — for a small but real language.

**The language (`miniscript`):**

```text
program   → declaration* EOF
declaration → "let" IDENT "=" expr ";"
            | statement
statement → "print" expr ";"
          | "if" "(" expr ")" block ( "else" block )?
          | "while" "(" expr ")" block
          | block
          | expr ";"
block     → "{" declaration* "}"
expr      → < Pratt-parsed: assignment, ||, &&, == != < > <= >=, + -, * /,
              unary ! -, call f(args), grouping ( ), literals, identifiers >
```

**Requirements:**

1. **Lexer** producing tokens with source positions (line/column) and attaching nothing fancy — but track positions so diagnostics can point at the right place.
2. **Statements via recursive descent** — one function per statement form (`parse_if`, `parse_while`, `parse_block`, `parse_let`, `parse_print`).
3. **Expressions via Pratt** — a single binding-power-driven function handling all the operators above with correct precedence and associativity (`=` right-assoc and lowest; `||` < `&&` < equality < comparison < `+ -` < `* /` < unary < call). Reuse your C3 Pratt parser.
4. **Error recovery** — `expect()` returns error/missing nodes (from A2), panic-mode synchronization to statement boundaries (from A1), a forced-progress guard, and a recursion-depth bound (from A3). The parser must **always** produce a complete tree.
5. **Resolve the dangling else** by the nearest-if rule and *comment that you did so*.
6. **Diagnostics** — collect a list of errors with positions; one broken statement must not suppress errors in later statements.

**Test program (valid):**
```
let n = 10;
let total = 0;
while (n > 0) {
  total = total + n;
  n = n - 1;
}
if (total == 55) { print total; } else { print 0; }
```

**Test program (broken — must yield a complete tree and multiple errors):**
```
let x = ;
print 1 + ;
if (x > ) { print x; }
let y = 2 * 3;
```

**Self-checks:**
- **Precedence:** `2 + 3 * 4 == 14` must parse as `(2 + (3*4)) == 14`, and `==` lower than `+`. Print the tree and verify grouping.
- **Right-assoc assignment:** `a = b = c` parses as `a = (b = c)`.
- **Dangling else:** `if (a) if (b) print 1; else print 2;` attaches `else` to the *inner* `if`.
- **Recovery:** the broken program produces a **complete tree** (with MISSING nodes) and **at least three** distinct errors — and crucially, the valid `let y = 2 * 3;` at the end still parses correctly despite the earlier breakage.
- **Security:** `((((...100k...))))` yields a clean depth-limit error, not a crash.
- **No infinite loop:** feed a token the parser can neither parse nor skip and confirm the forced-progress guard advances past it.

**Sparse solution sketch (structure only):**
```python
class Parser:
    MAX_DEPTH = 500
    def parse_program(self):
        decls = []
        while not self.at("EOF"):
            mark = self.pos
            decls.append(self.declaration())   # uses expect()->MISSING, never aborts
            if self.had_local_error: self.synchronize()
            if self.pos == mark: self.advance()
        return ("program", decls)

    def declaration(self):
        if self.at("LET"): return self.parse_let()
        return self.statement()

    def statement(self):
        if self.at("PRINT"): return self.parse_print()
        if self.at("IF"):    return self.parse_if()    # nearest-if: greedily take 'else'
        if self.at("WHILE"): return self.parse_while()
        if self.at("LBRACE"):return self.parse_block()
        e = self.expr(); self.expect("SEMI"); return ("exprstmt", e)

    def expr(self, min_bp=0):
        self.enter_depth()                    # recursion bound
        try:
            ... # Pratt loop from C3, with assignment/logical/comparison bps
        finally:
            self.leave_depth()
```

**Stretch goals (optional):**
- Add **function declarations** and **call** as a Pratt `led` (calls bind very tightly).
- Make the parser **incremental**: cache statement subtrees and re-parse only the edited statement on a small change.
- Add **error productions** for two common mistakes (e.g. `=` used in an `if` condition where `==` was meant) with a precise "did you mean `==`?" diagnostic.
- Keep **trivia** (comments/whitespace) attached to tokens and verify the round-trip property `print(parse(src)) == src`.

---

## Self-Check Rubric

Use this to judge your capstone honestly:

| Dimension | Minimum bar | Strong |
|-----------|-------------|--------|
| **Statements** | Recursive descent, one function per form | Clean, readable, positions on every node |
| **Expressions** | Pratt with correct precedence | Table-driven bps, right-assoc assignment, unary + call |
| **Precedence/assoc** | `*` over `+`, `^`/`=` right-assoc correct | Verified with printed trees, not just "it runs" |
| **Error recovery** | Doesn't abort; reports >1 error | Per-construct sync sets; later valid code still parses |
| **Always-a-tree** | Tree exists for broken input | MISSING nodes placed precisely where things broke |
| **Security** | Recursion bound stops deep-nesting crash | Clean catchable error + a test proving it |
| **No infinite loop** | Forced-progress guard present | Test that exercises the guard |
| **Dangling else** | Resolved (nearest-if) | Resolution commented and tested |

If you can't tick the "Strong" column for **precedence**, **error recovery**, and **always-a-tree**, you've built a toy, not the production architecture — go back and harden those three, because they're what separate a real parser from a tutorial one.

---

## Summary

- **Warm-ups** drilled the reflexes: classify a grammar (left-recursive? ambiguous?), compute FIRST/FOLLOW, eliminate left recursion into a loop, and trace a shift-reduce parse.
- **Core tasks** built the fundamentals by hand: a recursive-descent parser, FIRST-set computation via fixed-point iteration, a **Pratt expression parser** (binding powers, both associativities), a PEG that trips and then fixes the **prefix-capture trap**, and the **dangling-else** resolution.
- **Advanced tasks** added production realities: **panic-mode recovery** with a forced-progress guard, **error-tolerant** parsing where `expect()` returns a node so the tree is always complete, a **recursion-depth bound** to stop a stack-overflow DoS, and **differential testing** to catch parser divergence.
- **The capstone** assembled the exact production architecture — **recursive descent for statements + Pratt for expressions + error-tolerant recovery + security bounds** — for a small real language, and the rubric holds you to the three things that actually matter: correct precedence, real recovery, and an always-present tree.
- The meta-lesson across all tasks: a real parser is judged not on parsing *valid* input (the easy case) but on its **diagnostics, recovery, and resilience to broken and hostile input** — which is exactly why production compilers hand-write this architecture.

---
