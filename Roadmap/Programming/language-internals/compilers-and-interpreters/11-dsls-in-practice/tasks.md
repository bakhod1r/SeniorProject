# DSLs in Practice — Hands-On Tasks

> **Topic:** [DSLs in Practice](README.md)

---

## Introduction

This file takes you from "I can read a calculator parser" to "I have designed,
built, sandboxed, and versioned a complete external DSL." The exercises build a
real little language end to end — lexer, parser, AST, interpreter, and a
transpiler — and then harden it the way a production DSL must be hardened.

Every external DSL is the same three stages with a bigger grammar, so the
capstone here (an external DSL with its own syntax, lexer, parser, and
evaluator) is the applied summary of the entire compilers-and-interpreters
section. Throughout, keep the internal/external distinction in mind: you are
building *external* DSLs — your own syntax — not method-chain DSLs embedded in a
host language.

How to use this file: attempt each task before reading the hints. Run your code
on the listed inputs *and* on inputs you invent to break it. Mark a self-check
only when you can explain the result to someone else, not when the program
merely runs. Sample solutions are intentionally sparse — they appear only where
the canonical answer teaches more than your first attempt would.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the pipeline and the three-stage mental model in the smallest
possible form.

### Task 1: Tokenize an expression

Write a `lex(src)` that turns `"12 + 3 * (4 - 1)"` into a token list
`[NUMBER(12), PLUS, NUMBER(3), STAR, LPAREN, NUMBER(4), MINUS, NUMBER(1), RPAREN, EOF]`.
Skip whitespace, read multi-digit numbers greedily, and reject unknown
characters with a clear error.

**Self-check:**
- [ ] `lex("3+4")` (no spaces) produces the same numbers and operators as `lex("3 + 4")`.
- [ ] `lex("12")` produces `NUMBER(12)`, *not* `NUMBER(1), NUMBER(2)`.
- [ ] `lex("3 @ 4")` raises an error naming `@` and ideally its position.
- [ ] The token list ends with an `EOF` sentinel.

**Hints:**
- Walk an index `i` over the string; on a digit, inner-loop while the next char is a digit.
- The `EOF` token lets your future parser always have "one more token" to peek at.

### Task 2: Hand-trace precedence

Without writing code, draw the AST for `3 + 4 * 2` and for `(3 + 4) * 2`.
Then predict the result of each.

**Self-check:**
- [ ] The first tree has `+` at the root with `4 * 2` as a subtree → `11`.
- [ ] The second has `*` at the root with `3 + 4` as a subtree → `14`.
- [ ] You can state *why* `*` ends up lower in the tree without parentheses.

### Task 3: A flat config DSL

Write `parse_config(text)` for a line-oriented DSL: `key = value` per line,
`#` starts a comment, blank lines ignored. Return a dict. Raise a
positioned error for a line with no `=`.

```text
# server
port = 8080
host = localhost   # inline comment
```

**Self-check:**
- [ ] Output is `{"port": "8080", "host": "localhost"}`.
- [ ] A line `oops` raises an error mentioning the line number.
- [ ] Inline comments after `#` are stripped from values.

**Hint:** This DSL is *flat* — no recursion needed. Recognising flat vs nested
tells you how much parser machinery you need.

---

## Core

These build the calculator into a real parser and add a second back end.

### Task 4: Recursive-descent calculator

Using Task 1's lexer, write a recursive-descent parser with three functions
(`expression` for `+`/`-`, `term` for `*`/`/`, `factor` for numbers and
parentheses) producing an AST, plus an `evaluate(node)` interpreter. Support
`+ - * /` and parentheses.

**Self-check:**
- [ ] `run("3 + 4 * 2") == 11` and `run("(3 + 4) * 2") == 14`.
- [ ] `run("10 / 4 - 1") == 1.5`.
- [ ] `run("(3 + 4")` raises a clear "expected `)`" error, not an index crash.
- [ ] `run("1 2 3")` is rejected because input remains after parsing (EOF check).

**Hint:** After parsing the top-level expression, assert the next token is `EOF`.
Otherwise `1 + 2 garbage` silently returns `3` and ignores the rest.

### Task 5: Left-associativity check

Confirm your parser computes `8 - 3 - 2 == 3` (left-associative), not `7`.
Then deliberately break it (make `-` right-associate) and observe `7`.

**Self-check:**
- [ ] You can explain why looping inside `expression` (rather than recursing on
      the right) gives left associativity.
- [ ] You can state which operators are conventionally right-associative
      (exponent `^`).

### Task 6: Add variables and `let`

Extend the language with `let x = <expr> in <expr>`. The interpreter now
threads an environment (a name→value map). Nested `let`s introduce nested
scopes; an inner `let` must not leak its variable to the outer scope.

```text
let x = 10 in x * 2            -> 20
let x = 5 in (let y = 3 in x + y)  -> 8
```

**Self-check:**
- [ ] Referencing an undefined variable raises "unknown variable `z`".
- [ ] The inner `let y` is not visible after its `in` body ends.
- [ ] Shadowing works: `let x = 1 in (let x = 2 in x)` is `2`.

**Hint:** Pass a fresh `dict(env)` (or a chained child scope) into the `let`
body; never mutate the parent environment.

### Task 7: Replace the expression core with a Pratt parser

Reimplement expression parsing as a Pratt parser driven by a binding-power
table `{"+":10, "-":10, "*":20, "/":20, "^":30}` with `^` right-associative.
The tower of `expression`/`term`/`factor` collapses into one loop.

**Self-check:**
- [ ] All Task 4 tests still pass.
- [ ] `2 ^ 3 ^ 2 == 512` (right-associative: `2^(3^2)`), not `64`.
- [ ] Adding a new operator (e.g. `%` at power 20) is a one-line table change.

<details>
<summary>Sparse solution sketch</summary>

The core loop: read a prefix (number, `(`, unary `-`), then
`while next operator's binding power >= min_bp: consume it, recurse with
bp+1 for left-assoc or bp for right-assoc, fold into a binop node`.
The whole precedence ladder lives in the table, not in the control flow.
</details>

---

## Advanced

These add the engineering that separates a toy from a usable DSL.

### Task 8: Positioned error messages

Carry `(line, column)` on every token from the lexer onward. On a parse error,
report the position, the unexpected token, and what was expected. Bonus: print
the offending source line with a caret `^` under the error.

**Self-check:**
- [ ] `1 + + 2` reports the position of the second `+`.
- [ ] The message names what was expected (a number or `(`).
- [ ] You cannot reconstruct positions after lexing — confirm you attached them
      *during* lexing.

### Task 9: Error recovery (report multiple errors)

When a parse error occurs, skip tokens until a synchronisation point (a newline
or `;`), record the error, and keep parsing so a multi-statement program reports
*all* its errors in one run.

**Self-check:**
- [ ] A program with three broken lines reports three errors, not one.
- [ ] Recovery doesn't cascade into a flood of spurious errors after the first.

**Hint:** Keep an `errors` list; after syncing, resume at the next statement.

### Task 10: Transpile a filter DSL to SQL

Build a small filter DSL: `age > 18 and country = "US"`. Parse it, then emit a
parameterised SQL `WHERE` clause plus a list of bound values. Enforce an
allow-list of fields; reject unknown ones.

```text
age > 18 and country = "US"
-> "(age > ? AND country = ?)", [18, "US"]
```

**Self-check:**
- [ ] Values are emitted as `?` placeholders, never concatenated into the SQL.
- [ ] `secret_field = 1` is rejected because the field isn't allow-listed.
- [ ] Nested `and`/`or` with parentheses produce correctly grouped SQL.
- [ ] You can articulate why string concatenation here would be SQL injection.

<details>
<summary>Sparse solution sketch</summary>

Walk the AST. For an `and`/`or` node, recurse and join with ` AND `/` OR `
inside parentheses. For a comparison node, check `field in ALLOWED`, append the
value to `params`, and emit `f"{field} {op} ?"`. The SQL string never contains a
user value — only placeholders.
</details>

### Task 11: Compile to bytecode and run on a VM

Compile the calculator AST to a flat opcode list (`PUSH`, `LOAD`, `OP`) and run
it on a stack-machine loop. Benchmark it against the tree-walking interpreter on
a moderately deep expression evaluated many times.

**Self-check:**
- [ ] The VM produces identical results to the interpreter on all Task 4 inputs.
- [ ] You can state *why* bytecode is faster (no recursion/pointer-chasing per run).
- [ ] You measured a speedup rather than assuming one.

### Task 12: Sandbox an untrusted rules DSL

Take the filter DSL and treat its input as hostile. Add: a step/fuel counter
that aborts past a budget; a wall-clock deadline as a backstop; an allow-list of
referenceable fields; and *no* node type that calls host code or does I/O.
Prove (by enumeration) that the language cannot escape into the host.

**Self-check:**
- [ ] A pathological input hits the step limit and aborts cleanly (no partial state).
- [ ] There is no AST node that reads files, makes network calls, or evals host code.
- [ ] You can list every operation the language can perform — the security argument
      is enumerable.
- [ ] Removing the step limit makes a crafted input hang (then put it back).

**Hint:** The evaluator's `switch`/`if` over node types *is* the security model.
If it has no path to host capabilities, there is nothing to escape into.

### Task 13: Version the grammar and write a migrator

Suppose v1 used the keyword `eq` for equality and v2 uses `=`. Add a version
marker to files (`version = 1`), keep parsing v1 files, and write an AST-to-source
printer plus a migrator that parses a v1 file, rewrites the AST, and prints v2.

**Self-check:**
- [ ] `parse(to_source(ast)) == ast` for representative programs (round-trip safe).
- [ ] The migrator upgrades a v1 file to v2 with no manual editing.
- [ ] A frozen corpus of files still produces expected results after the change.

**Hint:** The formatter and the migrator share one AST-to-source printer.
Build it once, well.

---

## Capstone

### Task 14: Build a complete external DSL end to end

Design and implement a small but real external DSL with its own syntax, lexer,
parser, AST, and *two* back ends (an interpreter and a transpiler). Pick one
domain:

- **A rules DSL:** `when total > 50 then discount 10` over an input record.
- **A query/filter DSL** transpiling to SQL.
- **A spreadsheet formula language:** `=IF(A1 > 10, A1 * 2, 0)` with cell refs and builtins.
- **A tiny templating language:** `Hello {{ name }}{{ if vip }} (VIP){{ end }}`.

Requirements:

1. **Grammar.** Write the grammar in EBNF (in comments or a doc) *before* coding.
   Decide deliberately whether the language is **total** (no unbounded loops/recursion).
2. **Lexer.** Tokens carry positions. Skip whitespace; handle multi-character
   operators if your syntax has them.
3. **Parser.** Recursive descent, with a Pratt core if you have rich expressions.
   Reject leftover input (EOF check). Positioned errors; recover at a sync point
   to report multiple errors.
4. **AST.** Back-end-agnostic — it must not know whether it will be interpreted
   or transpiled.
5. **Interpreter.** Tree-walk with an environment for variables/inputs.
6. **Transpiler.** Emit another language (SQL, host source, or rendered text)
   from the *same* AST. Parameterise/escape — never concatenate untrusted values.
7. **Sandbox.** Treat input as untrusted: step/time/memory limits, an allow-list
   of fields/builtins, no host access. The language's powers must be enumerable.
8. **Versioning.** A version marker, an AST-to-source printer, and a migrator
   stub.
9. **Tests.** A conformance corpus: programs + expected results, run on every
   change, including malformed and adversarial inputs.

**Self-check (capstone):**
- [ ] The same source runs through *both* back ends; the interpreter and the
      "obvious" meaning of the transpiled output agree.
- [ ] Malformed input produces positioned, helpful errors — never a stack trace.
- [ ] Multiple errors in one program are reported together.
- [ ] An adversarial input hits a resource limit and aborts cleanly.
- [ ] You can list every operation the language can perform (no host escape).
- [ ] A grammar change can be applied to the corpus by the migrator, not by hand.
- [ ] You can explain to a non-programmer what the language does and why it isn't
      "just a config file" or "just Python."

**Stretch goals:**
- [ ] A minimal language server: as-you-type errors and keyword/field completion.
- [ ] A formatter that canonicalises layout (reuse the AST-to-source printer).
- [ ] Compile the hot path to bytecode and benchmark vs the tree-walker.
- [ ] Write the same grammar in ANTLR (`.g4`), generate a parser, and compare its
      error messages and effort against your hand-written front end.
- [ ] Write the front end as parser combinators and compare readability and speed.

<details>
<summary>Design guidance (read after a first attempt)</summary>

Keep the three stages strictly separate — lexer, parser, evaluator/emitter as
distinct modules sharing only the token and AST types. The AST is the contract:
if either back end needs to know about the other, your AST is leaking concerns.

Scope ruthlessly. Resist adding loops, general recursion, or host-function
access to a "config" or "rules" language — that is the slide into an accidental
programming language, and it destroys your ability to sandbox and to guarantee
halting. If users truly need logic, expose a few reviewed builtins, not a way to
write arbitrary logic in the DSL.

Your security argument should be a *list*: enumerate every node type / opcode /
builtin and confirm none reaches host I/O or code execution. If you can't make
that list short and confidently complete, the language is doing too much.
</details>

### Task 15: Build-vs-buy write-up

Without code: for your capstone domain, write a one-page argument for whether a
bespoke external DSL was the right choice versus (a) a config schema, (b) a
library/internal DSL, or (c) embedding an existing sandboxable language (CEL,
Starlark, Lua, WASM). Estimate the lifetime cost — parser is the cheap 5%;
account for LSP, formatter, docs, security review, migration, support, and
onboarding.

**Self-check:**
- [ ] You named a concrete alternative that could have met the need.
- [ ] Your cost estimate includes tooling, support, and onboarding — not just the parser.
- [ ] You can state the *one* property (syntax, semantics, or a safety guarantee)
      that justifies a bespoke language over embedding an existing one — or you
      conclude honestly that embedding would have been better.
