# Loop Variable Semantics (Go 1.22) — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where the Behavior Is Specified](#where-the-behavior-is-specified)
3. [The Specification Text](#the-specification-text)
4. [The Gating Rule (per `go` directive)](#the-gating-rule-per-go-directive)
5. [Both Loop Forms, Per the Spec](#both-loop-forms-per-the-spec)
6. [What Is Unchanged](#what-is-unchanged)
7. [The Compatibility Statement](#the-compatibility-statement)
8. [Version History](#version-history)
9. [References](#references)

---

## Introduction

Unlike a tooling feature, the loop variable change *is* a language change and therefore *is* described by the Go specification — specifically the "For statements" section — together with the Go 1.22 release notes and the compatibility documentation. This file separates "what the normative documents say" from convention and implementation.

Sources of truth, in decreasing formality:

1. **The Go Programming Language Specification**, section *For statements* — `go.dev/ref/spec#For_statements`.
2. **Go 1.22 Release Notes**, *Language changes* — `go.dev/doc/go1.22#language`.
3. **The Go compatibility documentation** — `go.dev/doc/go1compat` and the "Backward Compatibility and Go" material — which explains how a behavior change is gated by the `go` directive.
4. **The design proposal** (issue 60078 / the loopvar design doc) — the rationale and the precise transform, non-normative but authoritative.

---

## Where the Behavior Is Specified

The per-iteration behavior is normatively stated in the spec's *For statements* section. The spec was amended for Go 1.22 to say that each iteration has its own instances of the variables declared by the `for` clause, when the relevant `go` language version is 1.22 or later.

The release notes give the operative summary; the spec gives the normative rule; the compatibility doc gives the gating mechanism. Together they fully define the behavior. The proposal/design doc supplies the desugaring and the empirical justification but is not itself normative.

---

## The Specification Text

The Go spec's *For statements* section states the rule (paraphrased; consult the live spec for exact wording):

> Each iteration has its own separate declared variable (or variables). The variable used by the first iteration is declared by the init statement (for the three-clause form) or the range clause. Subsequent iterations declare their own variables, initialized to the value carried over from the previous iteration. The variable used in the last iteration's post statement and condition is carried back so the loop progresses as written.

And for the range form (paraphrased):

> For each entry it assigns iteration values to corresponding iteration variables ... and then executes the block. Each iteration has its own instances of the iteration variables.

The spec also notes the gating: this per-iteration behavior applies when the file's Go language version is **at least 1.22**; for earlier versions, the iteration variables are shared across all iterations (a single declaration reused).

The normative phrase to anchor on is "each iteration has its own ... variables," conditioned on the language version being ≥ 1.22.

---

## The Gating Rule (per `go` directive)

The compatibility documentation specifies how the change is gated:

- The behavior is selected by the **Go language version** in effect for the file being compiled.
- That version is determined by the **`go` directive** in the module's `go.mod`, optionally narrowed by a per-file `//go:build go1.NN` constraint.
- If the effective version is **≥ 1.22**, per-iteration semantics apply.
- If the effective version is **≤ 1.21**, the old shared-variable semantics apply.

This is normative: the spec and compatibility docs define behavior as a function of the language version, not of the toolchain version. A Go 1.22-or-later toolchain compiling code whose effective version is 1.21 must produce the old behavior.

The mechanism by which the `go` tool conveys the version to the compiler (the `-lang` flag) is an implementation detail, not part of the spec; the *rule* (behavior follows the language version) is normative.

---

## Both Loop Forms, Per the Spec

The spec applies the per-iteration rule to the variables declared by the `for` clause in both forms:

### ForClause (three-clause) form

```
ForStmt = "for" [ Condition | ForClause | RangeClause ] Block .
ForClause = [ InitStmt ] ";" [ Condition ] ";" [ PostStmt ] .
```

The variables declared by `InitStmt` using a short variable declaration (`:=`) are per-iteration under ≥ 1.22. The spec specifies that the value is carried from one iteration's variable into the next and that the post statement and condition see the carried-back value, preserving loop progression.

### RangeClause form

```
RangeClause = [ ExpressionList "=" | IdentifierList ":=" ] "range" Expression .
```

The variables declared via `:=` in the range clause are per-iteration under ≥ 1.22.

A loop that does **not** declare variables (`for {}`, `for cond {}`, or a range/for clause using `=` to assign to pre-existing variables rather than `:=` to declare new ones) is **not** affected — there are no newly-declared iteration variables to make per-iteration.

---

## What Is Unchanged

The specification is explicit that the change is narrow. Unchanged:

- **The number, order, and values of iterations.** The loop executes exactly as before.
- **Loops without declared variables** (`for {}`, `for cond {}`).
- **Assignment-form range/for clauses** using `=` (not `:=`) — these assign to existing variables and are not loop-declared.
- **The semantics of `break`, `continue`, labeled statements, and `goto`.**
- **`defer` timing** — deferred calls still run at function return, not iteration end.
- **Closure capture mechanics** — closures still capture by reference; only the identity of the captured variable (now per-iteration) changed.
- **Generated behavior for non-capturing loops** — observationally identical.

The single change is the *identity* (per-iteration vs. shared) of the variables declared by the `for` clause, gated on language version ≥ 1.22.

---

## The Compatibility Statement

Go's compatibility documentation addresses this change directly, because it alters observable behavior of existing programs. The normative position:

- The Go 1 compatibility promise is interpreted as guaranteeing consistent behavior for a given program **at a given language version**.
- A program keeps its old behavior as long as its `go` directive is unchanged. The directive functions as the program's declared language version.
- Raising the `go` directive opts the program into the language version's semantics, including per-iteration loop variables. This is a deliberate, author-controlled act.
- The toolchain must not silently apply newer-version semantics to a program declaring an older version (forward compatibility, hardened in Go 1.21).

This refinement — compatibility is per language version, selected by the `go` directive — is what makes the loopvar change conformant with the compatibility guarantee.

---

## Version History

- **Go 1.21** — `GOEXPERIMENT=loopvar` available as an opt-in preview that forces per-iteration semantics regardless of directive; `-d=loopvar=2` compiler diagnostic enumerates affected loops. Forward-compatibility handling of the `go` directive strengthened (the toolchain respects the declared language version more strictly). Not the default.
- **Go 1.22** — Per-iteration loop variables become the **default for modules whose `go` directive is ≥ 1.22**. The spec's *For statements* section is amended. Range-over-integer (`for i := range n`) is added, inheriting per-iteration semantics. `go vet`'s `loopclosure` analyzer becomes language-version-aware.
- **Go 1.23** — Range-over-function (`for v := range fn`) graduates to a stable feature; its iteration variables are per-iteration, composing with the loopvar rule.

Across these versions, the *rule* is stable since 1.22: behavior follows the language version; ≥ 1.22 means per-iteration. The 1.21 experiment and diagnostics existed solely to preview and migrate.

---

## References

- [The Go Programming Language Specification — For statements](https://go.dev/ref/spec#For_statements) — normative.
- [Go 1.22 Release Notes — Language changes](https://go.dev/doc/go1.22#language) — the operative summary.
- ["Fixing for loops in Go 1.22"](https://go.dev/blog/loopvar-preview) — the official blog post and rationale.
- [Loop Variable Scoping design doc (proposal 60078)](https://go.googlesource.com/proposal/+/master/design/60078-loopvar.md) — the transform and the data.
- [Go, Backwards Compatibility, and GODEBUG](https://go.dev/doc/godebug) — how language behavior is gated and migrated.
- [Go 1 and the Future of Go Programs (compatibility)](https://go.dev/doc/go1compat) — the compatibility promise.
- [`loopclosure` analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/loopclosure) — the version-aware vet check.
