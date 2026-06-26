# Lexers & Tokenizers — Hands-On Tasks

> **Topic:** [Lexers & Tokenizers](README.md)

---

## Introduction

You learn lexing by building one and then breaking it on the cases that break real
lexers — maximal munch, significant whitespace, interpolation. These tasks build a
hand-written lexer for a small language and explore the hard edges. Use any language
you like; the inner loop is the same `read char → classify → emit token` everywhere.

Tick a self-check box when you can explain *what automaton your code is* and *why a
case tokenizes the way it does*, not merely when it runs.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Tokenize by hand

Tokenize `x = 12 + foo_bar <= 3` on paper. List each token's type, lexeme, and start
position.

**Self-check:**
- [ ] I produced `IDENT(x) ASSIGN NUMBER(12) PLUS IDENT(foo_bar) LE NUMBER(3)`.
- [ ] I treated `<=` as one token (maximal munch).

### Task 2 — Number patterns

Write the predicate that decides whether a string is a valid number for: integers,
`1_000`, `.5`, `1.`, `1e10`, `0x1f`. Note which are surprisingly tricky.

**Self-check:**
- [ ] I handled leading/trailing dots and digit separators.
- [ ] I can explain why the number pattern is more than `[0-9]+`.

---

## Core

### Task 3 — A hand-written lexer

Write a lexer for a small language: identifiers/keywords, integers, `+ - * / = == <= < ( ) ;`,
whitespace, and `//` line comments. Emit `(type, lexeme, span)` tokens; end with `EOF`.

**Self-check:**
- [ ] Keywords are lexed as identifiers then retagged via a table.
- [ ] `<=`/`==` use maximal munch; `<`/`=` are the fallbacks.
- [ ] Every token carries a correct source span.

### Task 4 — Maximal munch experiments

Feed your lexer `i+++j`, `a<==b`, `1.2.3`. Predict the tokenization, then verify.

**Self-check:**
- [ ] My predictions match (e.g. `i ++ + j`).
- [ ] I can explain each via longest-match.

### Task 5 — Error tokens and recovery

Add error handling: an illegal character and an unterminated string each produce an
error token with a span (pointing at the opening for the string) and the lexer
*continues*.

**Self-check:**
- [ ] One bad character doesn't abort lexing.
- [ ] The unterminated-string error reports the opening quote's position.

---

## Advanced

### Task 6 — INDENT/DEDENT

Extend (or write) a lexer that emits synthetic `INDENT`/`DEDENT` tokens for an
indentation-based block syntax, using an indentation stack. Handle a dedent that
doesn't match any open level as an error.

**Self-check:**
- [ ] Increasing indentation emits `INDENT`; decreasing emits the right number of `DEDENT`s.
- [ ] An inconsistent dedent is a clear error.
- [ ] I can explain why this lexer is "a DFA with a stack."

### Task 7 — String interpolation modes

Add `"...${ expr }..."` interpolation: on `${`, switch to expression mode and emit
normal tokens; on the matching `}`, return to string mode. Test a nested case.

**Self-check:**
- [ ] The embedded expression tokenizes as normal code.
- [ ] Nested interpolation / braces inside the expression are handled or explicitly rejected.

### Task 8 — Performance pass

Make your lexer allocation-free in the inner loop: tokens store offsets into the source
buffer, and identifiers are interned. Lex a large generated file and compare timing
before/after.

**Self-check:**
- [ ] No per-token string allocation; identifiers interned.
- [ ] I measured a speedup and can explain the cause.

---

## Capstone

### Task 9 — A production-ish tokenizer

Combine everything into a tokenizer for a small but real-feeling language:

1. Identifiers/keywords (with a table), numbers (incl. separators/floats/hex), strings
   with escapes and interpolation, operators (maximal munch), comments (line + block),
   punctuation.
2. Significant-whitespace blocks via INDENT/DEDENT (or braces — your choice, documented).
3. Error tokens + recovery so multiple errors are reported per run, with accurate spans.
4. Allocation-free inner loop with interning.

Then write a short note on which features broke the clean "regular language" model and
how you handled them.

**Self-check:**
- [ ] The tokenizer handles all listed features with correct spans.
- [ ] It recovers from errors and reports several per run.
- [ ] My note correctly identifies the context-sensitive features (interpolation, indentation, any keyword context).

---

## Self-Assessment

You own this topic when you can:

- [ ] Explain a lexer as a finite automaton recognizing a regular language.
- [ ] Apply maximal munch and predict `<=`/`>>`/`i+++j`.
- [ ] Implement keyword tables, interning, spans, and error recovery.
- [ ] Handle significant whitespace (INDENT/DEDENT) and string interpolation modes.
- [ ] Explain the lexer hack, JS `/` ambiguity, and why production lexers are hand-written.
