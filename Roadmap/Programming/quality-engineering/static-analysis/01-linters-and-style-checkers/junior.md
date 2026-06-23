# Linters & Style Checkers — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Linters & Style Checkers
> *Your first contact with a tool that reads your code and points at the problems before you run it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- What a Linter Actually Does](#core-concept-1----what-a-linter-actually-does)
5. [Core Concept 2 -- Style vs. Bugs](#core-concept-2----style-vs-bugs)
6. [Core Concept 3 -- Running Your First Linter](#core-concept-3----running-your-first-linter)
7. [Core Concept 4 -- Reading a Diagnostic Message](#core-concept-4----reading-a-diagnostic-message)
8. [Core Concept 5 -- Fixing, Suppressing, and Autofix](#core-concept-5----fixing-suppressing-and-autofix)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **what a linter is, why your editor underlines code, and how to run one and read what it says.**

A linter reads your source code as *text and structure* — never by running it — and flags lines that look wrong. Some of those flags are about taste (a line is too long). Some are real bugs that would have cost you an hour in a debugger (you declared a variable and never used it, you compared two things with the wrong operator, you reassigned a value that nobody ever reads).

The squiggly underline in your editor is almost always a linter talking to you. Learning to read it — and to tell the "this is a bug" underlines from the "this is just style" underlines — is one of the cheapest skill upgrades in software. This page gets you from zero to running a linter and understanding its output.

---

## Prerequisites

**Required**

- You can edit and save a source file and run a command in a terminal.
- You know one language well enough to read a small function (JavaScript, Python, Go, Java, or Rust — examples here use all five).
- You have a project with a package manager set up (`npm`, `pip`, `go`, `cargo`, or Maven/Gradle).

**Helpful**

- A code editor with extension support (VS Code, GoLand, PyCharm) so you can see diagnostics inline.
- A basic idea of what an *error* vs. a *warning* means.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| Linter | A tool that reads source code without running it and reports likely problems. |
| Diagnostic | One message a linter emits: a file, line, rule name, and description. |
| Rule | A single check the linter runs (e.g. "no unused variables"). |
| Severity | How serious a diagnostic is: usually `error`, `warning`, or `info`. |
| Autofix | The linter rewriting your code to fix a diagnostic automatically. |
| Suppression | Telling the linter to ignore one specific diagnostic on purpose. |
| AST | Abstract Syntax Tree — the structured, tree-shaped form of your code the linter analyzes. |
| Style checker | A linter (or part of one) that only cares about formatting/convention, not bugs. |
| False positive | A diagnostic that is technically reported but isn't actually a problem. |
| Config file | The file (e.g. `.eslintrc`, `ruff.toml`) that says which rules are on. |

---

## Core Concept 1 -- What a Linter Actually Does

A linter does **not** run your program. It reads the source and inspects it in one of two ways:

1. **Pattern matching** — it scans the text for shapes it recognizes ("a line longer than 100 characters", "a `TODO` comment").
2. **AST analysis** — it parses your code into a tree (the same kind of tree a compiler builds) and then walks that tree asking structural questions ("is this declared variable ever read?", "does this `if` have an empty body?").

AST-based checks are the powerful ones. Because the linter understands the *structure*, it can tell that `err` on line 12 is the same `err` that gets overwritten on line 14 without ever being checked — a classic Go bug.

```go
func load() error {
    data, err := read()      // err assigned here
    process(data)
    _, err = write(data)     // err overwritten — the first err was never checked!
    return err
}
```

A linter walking the AST sees the first `err` is assigned and then immediately reassigned with no read in between. It reports an **ineffectual assignment**. The program would have *run fine* in tests where `read()` never fails — which is exactly why you need a tool that reads code instead of running it.

---

## Core Concept 2 -- Style vs. Bugs

Linter diagnostics live on a spectrum:

| End of spectrum | Example rule | What it catches |
|---|---|---|
| Pure style | "line ≤ 100 chars" | Formatting taste. Zero bugs. |
| Convention | "constants in `UPPER_CASE`" | Readability/consistency. |
| Suspicious | "this variable is unused" | Often a real mistake (typo, dead code). |
| Real bug | "`==` used where `===` expected" in JS | Behavior is genuinely wrong. |

The key mental shift for a junior: **not every underline means your code is broken.** A line-length warning is the linter expressing the team's taste. An "unused variable" warning is the linter telling you that you probably forgot something. Treat the two differently — but fix both, because warnings you ignore train you to ignore *all* warnings, including the one that matters.

In JavaScript, this is a real bug a linter catches:

```js
if (userId == null) { ... }   // == also matches undefined — sometimes intended
if (count == "0") { ... }     // type coercion! "0" == 0 is true, "0" === 0 is false
```

ESLint's `eqeqeq` rule flags both. The second one is a bug waiting to happen.

---

## Core Concept 3 -- Running Your First Linter

Pick the linter for your language and run it from the project root.

**JavaScript / TypeScript — ESLint**

```bash
npm install --save-dev eslint
npx eslint .
```

**Python — Ruff** (fast, increasingly the default)

```bash
pip install ruff
ruff check .
```

**Go — golangci-lint** (a runner that bundles many linters)

```bash
# install per https://golangci-lint.run/welcome/install/
golangci-lint run ./...
```

**Rust — Clippy** (ships with the toolchain)

```bash
cargo clippy
```

**Java — Checkstyle** (style) or SpotBugs (bugs), usually via Maven/Gradle

```bash
mvn checkstyle:check
```

Each prints a list of diagnostics or, if your code is clean, nothing at all. Silence is success.

---

## Core Concept 4 -- Reading a Diagnostic Message

Every linter message has the same anatomy. Here is real Ruff output:

```
app/users.py:42:5: F841 Local variable `result` is assigned to but never used
app/users.py:8:1: F401 `os` imported but unused
```

Break it down:

- `app/users.py:42:5` — **file, line, column.** Jump straight there.
- `F841` / `F401` — the **rule code.** You can look it up, disable it, or search for it.
- The text — a plain description of the problem.

Ruff rule codes have meaning: `F` = pyflakes (likely bugs), `E` = pycodestyle errors (style), `W` = warnings. ESLint uses readable rule names instead:

```
src/cart.js
  14:7   error  'total' is assigned a value but never used   no-unused-vars
  22:10  warning  Unexpected console statement               no-console
```

Note `error` vs `warning` and the trailing rule name (`no-unused-vars`). The rule name is your search key for everything else you'll want to do.

---

## Core Concept 5 -- Fixing, Suppressing, and Autofix

You have three honest responses to a diagnostic:

**1. Fix it.** Almost always the right answer. Delete the unused variable, use `===`, check the error.

**2. Autofix it.** Many *style* diagnostics can be fixed mechanically. The linter rewrites the file for you:

```bash
npx eslint . --fix        # ESLint
ruff check . --fix        # Ruff
cargo clippy --fix        # Clippy
```

Autofix is safe for formatting and obvious rewrites; the linter only autofixes rules it's confident won't change behavior.

**3. Suppress it — honestly.** Sometimes a diagnostic is a genuine false positive, or you have a deliberate reason. Suppress *that one line*, with a reason:

```js
// eslint-disable-next-line no-console -- intentional CLI output
console.log(report);
```

```python
import os  # noqa: F401  -- re-exported for the public API
```

```go
//nolint:errcheck // best-effort cleanup, error is irrelevant here
defer f.Close()
```

The dishonest version is suppressing a whole file or disabling the rule globally to make a real bug "go away." Suppress the narrowest scope, and write *why*.

---

## Real-World Examples

**The unused import that hid a refactor.** A dev deletes a function but forgets the import that fed it. `F401 imported but unused` flags it in one second. Without the linter, the dead import survives for months and confuses the next reader.

**The `==` that shipped a coupon bug.** A JS checkout compared `discountCode == 0`. Because `"" == 0` is `true` in JavaScript, an empty coupon field applied the "zero" discount tier. `eqeqeq` would have caught it on the first save.

**The shadowed error in Go.** A handler wrote `if err := validate(); err != nil { ... }` and then later used `err` from an outer scope, which was always `nil`. The `govet` shadow check flags the inner `err` shadowing the outer one.

**The green-but-noisy repo.** A team enabled *every* ESLint rule, got 4,000 warnings, and stopped reading them. The one new real bug scrolled past unseen. They learned: a linter is only useful if its output is short enough to read.

**The Python import that was never unused.** A module imported a symbol only to re-export it for the public API. Ruff's `F401` flagged it as unused — a true *false positive* for this case. The fix wasn't to disable `F401` everywhere; it was one honest line: `from .core import Engine  # noqa: F401 -- public re-export`. One line, one reason, the rest of the project still protected.

---

## Mental Models

- **The linter is a tireless reviewer who only knows rules.** It never gets bored, never misses an unused variable — but it has zero understanding of your intent. It flags shapes, not meaning.
- **Squiggle ≠ broken.** Some underlines are bugs; some are taste. Learn which is which by reading the rule name.
- **Silence is the goal.** A clean lint run means the tool found nothing to say. You want that to be the normal state, so that any output is worth reading.
- **Autofix is for style; your brain is for bugs.** Let the tool reformat; don't let it "fix" logic you don't understand.

---

## Common Mistakes

- **Ignoring warnings until there are hundreds.** Once output is unreadable, the linter is dead weight. Keep the count at zero.
- **Disabling a rule globally to silence one line.** That blinds you everywhere. Suppress the single line instead, with a reason.
- **Treating every diagnostic as equally urgent.** A line-length warning is not a `==`-vs-`===` bug. Triage by rule.
- **Running `--fix` and committing without reading the diff.** Autofix is usually safe, but you should still see what changed.
- **Assuming the linter ran your code.** It didn't. A clean lint does not mean your tests pass.

---

## Test Yourself

1. What is the one thing a linter never does to your code?
2. Given `F841 Local variable 'result' is assigned to but never used`, what are the file, line, and rule code?
3. Name one diagnostic that is pure style and one that is a real bug.
4. Why is suppressing a single line better than disabling a rule for the whole project?
5. Which is safe to autofix without much thought: a formatting rule or a logic rule?
6. Your lint run prints nothing. Did your code pass its tests?

---

## Cheat Sheet

```bash
# Run
npx eslint .            # JS/TS
ruff check .            # Python
golangci-lint run ./... # Go
cargo clippy            # Rust
mvn checkstyle:check    # Java

# Autofix (safe rules only)
npx eslint . --fix
ruff check . --fix
cargo clippy --fix

# Suppress ONE line, with a reason
# eslint-disable-next-line <rule> -- why
# noqa: <code>  -- why   (Python)
//nolint:<linter> // why  (Go)
```

| Severity | Meaning | What to do |
|---|---|---|
| `error` | Linter is confident it's wrong | Fix before merge |
| `warning` | Probably worth attention | Fix or justify |
| `info` | FYI / style nudge | Fix when convenient |

---

## Summary

- A linter reads source code **without running it**, using pattern matching or AST analysis to flag likely problems.
- Diagnostics range from pure style (line length) to real bugs (`==` vs `===`, unused variables, ineffectual assignments).
- Every diagnostic has a **file:line:column, a rule code/name, and a description** — learn to read all three.
- Respond honestly: **fix it**, **autofix it** (style only), or **suppress one line with a reason**.
- Keep the output short. A linter nobody reads catches nothing.

---

## Further Reading

- ESLint — *Getting Started* and the rules reference.
- Ruff — *The Ruff Linter* docs and rule index.
- golangci-lint — *Quick Start* and linters list.
- *Clippy Lints* (the Rust lint index).

---

## Related Topics

- [Formatters](../02-formatters/) — the sibling that rewrites layout so the linter doesn't have to argue about it.
- [Type Checkers & Gradual Typing](../03-type-checkers-and-gradual-typing/) — catching a different class of bug at the type level.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — running the linter automatically on every push.
- The `naming-conventions` and `code-smell-detection` skills cover the *style* and *smell* sides of what linters check.
- [Code Quality Metrics](../../code-quality-metrics/) — measuring the codebase the linter guards.
