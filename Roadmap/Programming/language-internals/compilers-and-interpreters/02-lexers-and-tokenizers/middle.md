# Lexers & Tokenizers — Middle Level

> **Topic:** [Lexers & Tokenizers](README.md)
> **Focus:** The automaton behind a lexer, the maximal-munch rule, and the practical machinery of a real tokenizer.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Tokens as a Regular Language](#tokens-as-a-regular-language)
3. [From Regex to a Scanning Automaton](#from-regex-to-a-scanning-automaton)
4. [Maximal Munch](#maximal-munch)
5. [Keywords, Identifiers, and Interning](#keywords-identifiers-and-interning)
6. [Generators vs Hand-Written](#generators-vs-hand-written)
7. [Code Examples](#code-examples)
8. [Best Practices](#best-practices)
9. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
10. [Summary](#summary)

---

## Introduction

A lexer turns a flat stream of characters into a stream of tokens — the atoms the
parser works with. Each token carries a **type** (e.g. `IDENT`, `NUMBER`, `PLUS`), the
**lexeme** (the exact text), and a **source span** (start/end position) that every
later phase needs for diagnostics. Understanding the lexer at the middle tier means
understanding the small theory that makes it correct (regular languages and finite
automata) and the handful of rules and data structures that make it fast and usable.

---

## Tokens as a Regular Language

Token classes are describable by **regular expressions**: an identifier is
`[A-Za-z_][A-Za-z0-9_]*`, an integer is `[0-9]+`, and so on. Regular expressions
correspond to **regular languages**, which are exactly the languages a **finite
automaton** can recognize. This is why lexing is a separate, simpler phase than
parsing: token structure is regular (no nesting), while program structure is
context-free (nested, recursive) and needs a more powerful parser.

The practical upshot: you can specify all token classes as a set of regexes and
mechanically build a recognizer.

---

## From Regex to a Scanning Automaton

The classical construction:

1. **Thompson's construction** turns each regex into a **nondeterministic finite
   automaton (NFA)**.
2. **Subset construction** turns the NFA into a **deterministic finite automaton
   (DFA)** — at each character, the DFA is in exactly one state, so scanning is O(n).
3. **DFA minimization** collapses equivalent states for a smaller table.

A generated lexer (flex, re2c) literally builds this DFA as a transition table or a
`switch`-driven state machine. A hand-written lexer encodes the same automaton
*implicitly* in its control flow — a loop with a `switch` on the current character is a
DFA you wrote by hand. Either way the model is: read a character, transition, repeat,
emit a token at an accepting boundary.

---

## Maximal Munch

The defining rule of lexing: **the longest match wins** (maximal munch / longest
match). When several token patterns match a prefix, the lexer takes the longest one.
This is why:

- `<=` is one token, not `<` followed by `=`.
- `>>` is one token (right shift), even though `>` matches first.
- `i+++j` lexes as `i ++ + j` — at each point the lexer grabs the longest operator it
  can (`++`, then `+`), regardless of what the programmer meant.

Maximal munch is simple but occasionally surprising; the lexer is purely local and
greedy, with no idea of the parser's intent. A few languages add tie-breaking rules,
but longest-match-then-first-rule is the standard.

---

## Keywords, Identifiers, and Interning

Keywords (`if`, `while`, `return`) look exactly like identifiers, so the standard
trick is: **lex everything that looks like a word as an identifier, then look it up in
a keyword table**; if found, retag the token as that keyword. This keeps the automaton
simple and the keyword set easy to extend.

For performance, lexers often **intern** identifier strings — store each unique
identifier once and pass around a small integer/pointer — so later phases compare
names by pointer/id instead of string compare, and the symbol table keys are cheap.

---

## Generators vs Hand-Written

- **Lexer generators** (lex/flex, re2c, ANTLR's lexer): you write regexes, the tool
  emits the DFA. Fast to build, formal, good for prototypes and DSLs.
- **Hand-written lexers**: a loop + `switch`. Almost every production compiler
  (GCC, Clang, rustc, the Go compiler, V8) hand-writes its lexer — for raw speed,
  precise control over error messages and source spans, and the context-sensitivity
  real languages need (see pitfalls). The clarity of "this exact code runs per
  character" beats a generated table when the lexer is on the hot path.

---

## Code Examples

A hand-written lexer core (the implicit DFA):

```python
def next_token(src, i):
    while i < len(src) and src[i].isspace():     # skip whitespace
        i += 1
    if i >= len(src): return ('EOF', '', i)
    c = src[i]
    if c.isalpha() or c == '_':                  # identifier / keyword
        j = i
        while j < len(src) and (src[j].isalnum() or src[j] == '_'): j += 1
        word = src[i:j]
        kind = KEYWORDS.get(word, 'IDENT')       # keyword table lookup
        return (kind, word, j)
    if c.isdigit():                              # number
        j = i
        while j < len(src) and src[j].isdigit(): j += 1
        return ('NUMBER', src[i:j], j)
    if c == '<':                                 # maximal munch: <= vs <
        if src[i+1:i+2] == '=': return ('LE', '<=', i+2)
        return ('LT', '<', i+1)
    # ... other operators/punctuation ...
```

Note the explicit maximal-munch on `<` and the keyword-table retagging — the two
middle-tier essentials.

---

## Best Practices

- **Attach a source span to every token** — diagnostics across the whole compiler
  depend on it.
- **Lex words as identifiers, then look up keywords** — keep the automaton small.
- **Intern identifiers** for cheap downstream comparison.
- **Apply maximal munch consistently**, and document the few surprising cases.
- **Skip but optionally record comments/whitespace** (formatters and doc tools may
  need them, so a "trivia"-preserving mode helps).

---

## Edge Cases & Pitfalls

- **Maximal munch surprises:** `i+++j`, `a-->b`, and the historical C++ `>>` in
  `vector<vector<int>>` (pre-C++11 lexed as the `>>` operator).
- **Numeric edge cases:** `1.`, `.5`, `1_000`, `0x1p3` (hex float), `1e10` — the number
  pattern is trickier than `[0-9]+`.
- **Unterminated tokens:** an unclosed string or block comment must produce a clear
  error with the opening position, not run to EOF silently.
- **Comment nesting:** `/* ... */` doesn't nest in C but does in some languages; a
  naive scan mishandles it.
- **Whitespace significance:** in most languages whitespace is skipped, but not in
  Python/Haskell (see senior tier) — the lexer can't always discard it.

---

## Summary

A lexer is a finite automaton — built explicitly by a generator or implicitly in a
hand-written `switch` loop — that turns characters into tokens with types, lexemes,
and spans. The maximal-munch rule (longest match wins) governs tokenization and
explains `<=`, `>>`, and `i+++j`. Keywords are lexed as identifiers then retagged via a
table, and identifiers are interned for speed. Production compilers hand-write lexers
for speed, diagnostics, and the context-sensitivity that the clean regular-language
model doesn't quite cover.
