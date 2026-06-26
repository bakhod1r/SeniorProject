# Lexers & Tokenizers — Professional Level

> **Topic:** [Lexers & Tokenizers](README.md)
> **Focus:** Lexer performance, error recovery, and incremental/editor tokenization in production.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Lexer Is Often the Hot Path](#the-lexer-is-often-the-hot-path)
3. [Error Recovery in the Lexer](#error-recovery-in-the-lexer)
4. [Incremental and Editor Lexing](#incremental-and-editor-lexing)
5. [Unicode and Security](#unicode-and-security)
6. [Best Practices](#best-practices)
7. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
8. [War Stories](#war-stories)
9. [Summary](#summary)

---

## Introduction

In production the lexer is judged on three axes the textbook ignores: **speed** (it
touches every byte of every file, often repeatedly in an IDE), **error recovery**
(it must keep going past bad input to report many errors and to feed editor tooling),
and **incrementality** (re-lexing only what changed as a user types). On top of these
sit real Unicode and security concerns. This tier is about making a lexer fast,
resilient, and editor-ready.

---

## The Lexer Is Often the Hot Path

Because the lexer processes every character, it is frequently the single hottest phase
on large inputs, and small constant factors matter:

- **Avoid per-token allocation.** Don't allocate a new string per token; slice into the
  source buffer (store offsets/spans) and **intern** identifiers so each unique name is
  allocated once.
- **Buffer efficiently.** Read the whole file into one contiguous buffer where
  possible; pointer/index advancement beats stream abstractions with per-char overhead.
- **Branch-friendly dispatch.** A `switch` on the first character (or a 256-entry
  classification table) keeps the inner loop predictable; hand-written lexers win here
  over generic regex engines.
- **Minimize backtracking.** Maximal munch with at most a character or two of lookahead
  stays O(n); avoid patterns that force re-scanning.

For multi-megabyte generated files or monorepo-scale builds, these decisions move
total compile time measurably, which is part of why GCC/Clang/rustc/Go hand-write
lexers tuned for exactly this.

---

## Error Recovery in the Lexer

A compiler that stops at the first bad character is hostile. The lexer must **recover**
and continue:

- On an illegal character or malformed token, emit an **error token** (with a span and
  message) and skip forward to a plausible resynchronization point (next whitespace,
  next line, closing quote) so the rest of the file still lexes.
- Report the **opening position** for unterminated strings/comments, not just "EOF
  reached."
- Keep producing tokens so the parser can report *its* errors too — many real
  diagnostics depend on lexing surviving the first mistake.

Good recovery is what lets a compiler report a dozen real errors in one run instead of
one-at-a-time.

---

## Incremental and Editor Lexing

In an IDE the lexer runs on every keystroke, so re-lexing the whole file each time is
wasteful. Production editor tooling lexes **incrementally**: re-tokenize only the
region around an edit, reusing tokens before and after. The challenge is that an edit
can change tokenization arbitrarily far (typing `/*` comments out the rest of the
file), so incremental lexers track how far a change can propagate and re-lex a bounded
window, often integrated with an incremental parser.

- **Tree-sitter** re-lexes and re-parses incrementally for editor highlighting and
  structural selection across many languages.
- **Roslyn** (C#) uses red-green trees with incremental lexing/parsing for responsive
  IDE features.
- Syntax highlighting, semantic highlighting, and "expand selection" all sit on this
  incremental token stream.

---

## Unicode and Security

- **Identifiers in Unicode** must be handled per the language spec (e.g. UAX #31):
  which code points start/continue an identifier, and **normalization** (NFC) so
  visually identical identifiers compare equal.
- **Confusable/homoglyph attacks:** identifiers that look identical but differ in code
  points (Cyrillic `а` vs Latin `a`), and **bidi-override** characters (the *Trojan
  Source* attack) that make source render differently than it tokenizes — a real
  supply-chain risk. Lexers/linters increasingly reject or warn on dangerous code
  points.
- **Overlong/invalid UTF-8** must be rejected, not silently accepted.

---

## Best Practices

- **Slice, don't allocate; intern identifiers.** Keep the inner loop allocation-free.
- **Recover from errors** with error tokens and resynchronization; report opening
  positions.
- **Design for incrementality** if you'll power an editor — bound the re-lex window.
- **Follow the Unicode identifier spec and normalize**; warn/reject confusables and
  bidi controls.
- **Profile the lexer** on your largest real inputs — it's often the hot path.

---

## Edge Cases & Pitfalls

- **Per-token string allocation** quietly dominating compile time on big files.
- **A `/*` edit** invalidating tokenization to EOF, breaking naive incremental lexers.
- **Unterminated string/comment** errors that point at EOF instead of the opening
  delimiter.
- **Trojan Source / homoglyph** identifiers passing review because the editor renders
  them benignly.
- **Tabs/spaces and CRLF/LF** inconsistencies affecting indentation-sensitive lexers.

---

## War Stories

- **Trojan Source (2021):** bidi-override Unicode characters let source code render in
  one order while tokenizing/compiling in another, enabling invisible logic changes —
  prompting compilers and linters to add detection and forcing lexer-level Unicode
  vigilance.
- **C++ `>>` ergonomics:** the pre-C++11 requirement to write `vector<vector<int> >`
  with a space — a tokenization decision (maximal munch on `>>`) that annoyed a
  generation of programmers until parsing was changed to special-case template context.
- **IDE responsiveness:** moving from full re-lex to incremental lexing is what makes
  large-file editing feel instant; getting the invalidation bounds wrong produces
  flicker or stale highlighting.

---

## Summary

Professionally, a lexer must be fast (allocation-free inner loop, interning, buffered
scanning — it's often the hottest phase), resilient (error tokens + resynchronization so
one bad character doesn't abort the compile), and editor-ready (incremental re-lexing
bounded around edits, as in Tree-sitter and Roslyn). Layered on top are real Unicode
identifier rules and security concerns — homoglyphs and Trojan-Source bidi attacks —
that make tokenization a correctness *and* a security surface, which is why production
compilers hand-write and carefully tune their lexers.
