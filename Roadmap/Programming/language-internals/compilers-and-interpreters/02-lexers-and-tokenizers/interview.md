# Lexers & Tokenizers — Interview Questions

> **Topic:** [Lexers & Tokenizers](README.md)

---

## Introduction

These questions test whether a candidate understands lexing as finite-automaton
recognition of a regular language, the maximal-munch rule, and the real-world breaches
of the clean lexer/parser separation (significant whitespace, interpolation, the C
lexer hack, JS `/`). Strong answers connect the theory to why production compilers
hand-write lexers and how they handle errors, performance, and Unicode.

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What does a lexer produce, and what's in a token?**

A token stream. Each token has a **type** (`IDENT`, `NUMBER`, `PLUS`, …), the
**lexeme** (the matched text), and a **source span** (start/end position) used by every
later phase for diagnostics. The lexer also skips whitespace/comments.

## Question 2

**Why is lexing a separate phase from parsing, in theory?**

Token structure is a **regular language** (recognizable by a finite automaton), while
program structure is **context-free** (nested, recursive, needs a stack/parser).
Separating the regular sub-problem keeps the parser simpler and the lexer fast.

## Question 3

**Explain maximal munch with an example.**

The lexer takes the **longest** matching token at each point. So `<=` is one token, not
`<` then `=`; `>>` is right-shift; and `i+++j` lexes as `i ++ + j` because at each
position the lexer greedily grabs the longest operator. It's purely local and greedy.

## Question 4

**How are keywords distinguished from identifiers?**

Lex anything that looks like a word as an identifier, then look it up in a **keyword
table**; if present, retag it as that keyword. This keeps the automaton small and the
keyword set easy to change.

## Question 5

**How does a regex become a working scanner?**

Thompson's construction → NFA; subset construction → DFA (one state per character,
O(n) scan); minimization → smaller table. A generated lexer emits this DFA; a
hand-written lexer encodes the same automaton implicitly as a `switch` loop.

---

## Tool-Specific

## Question 6

**flex/lex vs a hand-written lexer — trade-offs?**

Generators turn regexes into a DFA automatically — fast to build, formal, good for
DSLs. Hand-written lexers (GCC, Clang, rustc, Go, V8) win on speed, precise error
messages and spans, and the context-sensitivity real languages need. Most production
compilers hand-write for exactly those reasons.

## Question 7

**How does a lexer handle Python's significant whitespace?**

It keeps an **indentation stack** and emits synthetic `INDENT`/`DEDENT` tokens: more
indentation pushes and emits `INDENT`; less pops and emits a `DEDENT` per level;
inconsistent dedent is an error. Inside brackets, newlines/indentation are ignored. The
parser then sees explicit block delimiters.

## Question 8

**How is string interpolation lexed?**

With **lexer modes**: on `${`, push an expression mode and lex the embedded expression
as normal tokens; at the matching `}`, return to string mode. This entangles the lexer
with the parser's nesting and is a common bug source (nested interpolation, braces in
the expression).

## Question 9

**What is the C "lexer hack"?**

In C, `A * B;` is multiplication or a pointer declaration depending on whether `A` is a
`typedef` name — semantic info. The lexer consults the **symbol table** to emit
`TYPE_NAME` vs `IDENTIFIER`, making the lexer depend on parsing/semantics and breaking
clean phase ordering. It's the canonical context-sensitivity example.

---

## Tricky / Trap

## Question 10

**Why does `i+++j` parse the way it does?**

Maximal munch: the lexer greedily takes the longest operator, so it reads `++` then
`+`, giving `i ++ + j` (post-increment of `i`, plus `j`) — regardless of the
programmer's intent. The lexer has no notion of what would parse sensibly.

## Question 11

**In JavaScript, is `/` division or a regex? How does the lexer decide?**

It can't decide locally — `a / b` is division, `/ab+/` is a regex literal. The decision
depends on grammatical context (whether a value or an operator preceded it), so engines
use heuristics or parser-driven lexing. It's another break in the clean separation.

## Question 12

**Why did pre-C++11 require a space in `vector<vector<int> >`?**

Maximal munch lexed `>>` as the right-shift operator, so two adjacent template-closing
brackets collided with the operator token. C++11 changed parsing to treat `>>` as two
closing angle brackets in template context — parser feedback overriding tokenization.

## Question 13

**An unterminated block comment runs to EOF. What should the lexer do?**

Report an error that points at the **opening** `/*` position (not just "unexpected
EOF"), and recover so the rest of the file still produces useful diagnostics where
possible.

---

## Design

## Question 14

**Design a fast lexer for multi-megabyte files. Key decisions?**

Read into one contiguous buffer; advance by index. Represent tokens as (type, span)
slicing the buffer — no per-token string allocation. Intern identifiers for cheap
downstream comparison. Dispatch via a `switch`/256-entry classification table for
branch-predictable inner loops. Keep lookahead to a char or two (maximal munch, O(n)).
Profile on the largest real inputs.

## Question 15

**Design lexer error recovery so the compiler reports many errors per run.**

On an illegal character or malformed token, emit an **error token** with a span and
message, then resynchronize (skip to next whitespace/line/closing quote) and keep
lexing. Report opening positions for unterminated tokens. Never abort on the first bad
character — let the parser also report its errors.

## Question 16

**Design an incremental lexer for an editor. What's hard?**

Re-lex only a bounded window around the edit, reusing tokens before/after. The hard
part is that an edit can change tokenization arbitrarily far (typing `/*` comments out
the rest of the file), so you must bound how far a change can propagate and re-lex that
region — as Tree-sitter and Roslyn do — integrated with incremental parsing.
