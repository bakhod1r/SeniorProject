# Formatters — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Formatters
> *The deepest idea in formatting is a one-line equation: `format(format(x)) == format(x)`. Once a tool guarantees that, it can be a CI gate, an editor hook, and a refactoring substrate all at once — and the team stops voting on tabs forever. This page is about that guarantee and the deliberate, almost stubborn philosophy that makes it possible.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Determinism and Idempotency](#core-concept-1--determinism-and-idempotency)
5. [Core Concept 2 — The "No Config" Philosophy](#core-concept-2--the-no-config-philosophy)
6. [Core Concept 3 — Prettier's Middle Path](#core-concept-3--prettiers-middle-path)
7. [Core Concept 4 — The Tool Landscape, With Before/After](#core-concept-4--the-tool-landscape-with-beforeafter)
8. [Core Concept 5 — Formatter and Linter, Side by Side, No Fighting](#core-concept-5--formatter-and-linter-side-by-side-no-fighting)
9. [Core Concept 6 — The Three Integration Points](#core-concept-6--the-three-integration-points)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why formatters are deterministic and idempotent, why the best ones deliberately remove configuration, and what each ecosystem's tool actually does to your code.**

At the junior level you learned the split: formatters rewrite, linters report. Now we go one level down into *why* a formatter can be trusted to rewrite anything, anytime, in CI, on save, across a whole repo — and why the strongest formatters in the industry give you almost no options at all.

Two properties make a formatter load-bearing infrastructure rather than a convenience. The first is **determinism**: the same input always yields the same output. The second, stronger property is **idempotency**: running the formatter on already-formatted code changes nothing. Together they are the foundation of every workflow built on top of a formatter — check mode in CI only works if formatting is idempotent, and clean diffs only happen if formatting is deterministic.

The other big theme at this level is *configuration as a liability*. The most influential formatters — `gofmt`, Black — were designed with the explicit goal of having **no options**. This sounds like a limitation; it is the feature. Every option is a thing teams can argue about, a way two repos can drift apart, a knob someone will turn at 2 a.m. By removing the knobs, these tools convert a perpetual debate into a solved problem. We'll examine that trade-off honestly, including where Prettier chose a middle path.

By the end of this page you should understand the equation, be able to explain the no-config argument to a skeptic, know what each ecosystem's tool does to real code, and be able to wire a formatter into all three integration points without it becoming a nuisance.

---

## Prerequisites

- **Required:** [Junior Level](junior.md) — the formatter-vs-linter split, format-on-save, check mode.
- **Required:** You've used at least one formatter on a real project.
- **Required:** Comfort reading diffs and exit codes; you know what a non-zero exit code means to CI.
- **Helpful:** [01 — Linters & Style Checkers](../01-linters-and-style-checkers/middle.md) — so you understand the auto-fix overlap between the two tool classes.
- **Helpful:** Basic familiarity with a pre-commit framework (Husky, `pre-commit`, lefthook) or willingness to learn one here.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Determinism** | Same input → same output, on every machine, every run. No randomness, no environment dependence. |
| **Idempotency** | `format(format(x)) == format(x)`. Formatting already-formatted code is a no-op. |
| **Fixed point** | A piece of code that the formatter leaves unchanged because it's already canonical. |
| **Opinionated** | Designed to make decisions *for* you; few or no options by design. |
| **Bikeshedding** | Spending disproportionate energy arguing trivial decisions (the color of the bike shed) instead of important ones. |
| **Round-trip** | Parse → format → re-parse. A correct formatter's round-trip preserves the program's meaning exactly. |
| **AST (abstract syntax tree)** | The structured, whitespace-free representation a formatter parses your code into before printing it back out. |
| **isort / goimports** | Import-sorting tools, often run alongside the main formatter. |

---

## Core Concept 1 — Determinism and Idempotency

A formatter works by *throwing away your formatting* and reprinting from structure. Internally it parses your source into an **AST** — a tree that captures *what the code is* (a function with these parameters and this body) but not *how it was laid out* (the AST doesn't store your spaces). Then it walks the tree and *prints* it using a single set of layout rules. Because the layout comes entirely from the rules and the tree, not from your original whitespace, the output is fully determined by the input's meaning.

That gives **determinism**: same code in, same code out, everywhere.

The stronger and more useful property is **idempotency**:

```
format(format(x)) == format(x)
```

Once code is formatted, formatting it again does nothing. The formatted output is a *fixed point* of the function. You can verify this on any tool:

```bash
$ black messy.py            # first run reformats
reformatted messy.py
$ black messy.py            # second run: nothing left to do
All done! ✨ 🍰 ✨
1 file left unchanged.
```

Why does this matter so much? Because every workflow built on a formatter depends on it:

- **Check mode works** only because formatting is idempotent. `black --check` asks "would running the formatter change anything?" If formatting weren't idempotent, already-formatted code would still "need" formatting and the check would never pass.
- **No churn** comes from determinism. If two developers format the same file, they get byte-identical output, so there's no back-and-forth diff war.
- **CI and editor agree** because the tool isn't influenced by environment — no locale, no terminal width, no random seed. (This is also why a good formatter pins its line-width as a *rule*, not a terminal-dependent value.)

> **A subtle trap:** idempotency is a property the *tool authors must guarantee and test*. A formatter bug where `format(format(x)) != format(x)` (formatting oscillates between two shapes) is treated as a critical defect, because it breaks check mode and creates infinite churn. When you upgrade a formatter, this is one thing to watch for — though the major tools are extremely well-tested here.

---

## Core Concept 2 — The "No Config" Philosophy

`gofmt` has **no options for style**. None. You cannot configure indentation, line width, brace placement, or anything else about how Go code is formatted. Black launched with the tagline "uncompromising" and shipped with essentially one knob (line length) and a deliberate refusal to add more. This was not laziness. It was the entire design thesis.

The argument runs like this. Every formatting option is a decision. Every decision is something a team can argue about. The arguments are *unwinnable* because there is no objectively correct answer — two spaces vs four is genuinely arbitrary. So teams spend real, recurring energy **bikeshedding**: debating in PRs, writing style guides nobody reads, re-litigating the same question when a new hire joins. The cost is enormous and the value is zero, because *any consistent choice is fine* — consistency is the whole point, not the specific choice.

Remove the knob and the argument cannot happen. There is no "our project uses tabs" because the tool decided. There is no PR comment about brace placement because there's nothing to comment on. The decision is made once, by the tool author, for the entire ecosystem, and everyone gets on with their work.

The before/after isn't in the code — it's in the *team*:

```text
Before gofmt:        Style guide doc (12 pages), CI lint rules for spacing,
                     recurring PR comments, two devs reverting each other.
After gofmt:         `gofmt -w .` on save. Nobody has ever discussed Go
                     formatting again. The question does not exist.
```

The cost side is real and worth naming honestly: you lose the ability to express a *house preference*. If your team genuinely prefers two-space indent and the tool says four, you live with four. The trade is: give up the ability to have a preference, gain the permanent end of the argument. For the overwhelming majority of teams, that trade is wildly positive — the preference was never worth what defending it cost.

> **Why Go could do this and older languages couldn't:** gofmt shipped *with the language, on day one*. There was never a pre-gofmt Go style to defend. Languages that adopt an opinionated formatter decades in (Python with Black, JS with Prettier) face migration pain precisely because preferences already calcified. The lesson: adopt the opinionated tool as early as possible, before the bikeshed gets painted.

---

## Core Concept 3 — Prettier's Middle Path

Prettier is opinionated, but not *as* opinionated as gofmt. It exposes a small, deliberately bounded set of options:

```jsonc
// .prettierrc
{
  "printWidth": 80,      // line length target
  "tabWidth": 2,         // spaces per indent level
  "semi": true,          // statement-ending semicolons
  "singleQuote": false,  // " vs '
  "trailingComma": "all" // trailing commas where valid
}
```

That's most of the list. Prettier deliberately *refuses* requests for more options — its FAQ has a famous section titled "Option Philosophy" explaining that each new option is a maintenance burden and a new bikeshed, so the bar for adding one is extremely high. The handful that exist are the ones where ecosystems were genuinely, irreconcilably split (semicolons and quote style being the canonical JavaScript holy wars).

The lesson here is the *shape* of the trade-off, not the specific number of options:

- **Zero options (gofmt, rustfmt mostly):** maximum consistency, zero config files, zero arguments — but you must accept the tool's taste entirely.
- **A few options (Prettier, Black with line-length):** lets an ecosystem with deeply entrenched splits adopt a formatter at all, at the cost of a tiny config file and a one-time team decision.
- **Many options (older formatters, fully-configurable clang-format):** you can match any existing style, but you've reintroduced the bikeshed — now you argue about the *config* instead of the *code*.

The healthy pattern even with a configurable tool is to **pick a preset and stop**. `clang-format` can be tuned infinitely, but mature teams choose `BasedOnStyle: Google` (or LLVM) and resist per-team tweaks. The config file should be tiny and boring. The moment it grows, you've recreated the problem the formatter was supposed to solve.

```yaml
# .clang-format — the healthy version: pick a preset, stop.
BasedOnStyle: Google
```

---

## Core Concept 4 — The Tool Landscape, With Before/After

Here is each major ecosystem's tool with a concrete before/after, so you know what to expect.

**Go — `gofmt` + `goimports`.** gofmt aligns struct fields and normalizes everything; goimports additionally sorts and *removes unused* imports.

```go
// before
package main
import ("fmt";"os")
func main(){fmt.Println(os.Args)}
```
```go
// after gofmt -w
package main

import (
	"fmt"
	"os"
)

func main() { fmt.Println(os.Args) }
```

**JS/TS — Prettier (or Biome).** Biome is a Rust-based formatter+linter that's Prettier-compatible and dramatically faster.

```javascript
// before
const f=(x)=>{return x*2}
```
```javascript
// after prettier --write
const f = (x) => {
  return x * 2;
};
```

**Python — Black + isort, or Ruff format.** Ruff's formatter is a Black-compatible reimplementation in Rust, often 10–100× faster, increasingly the default.

```python
# before
import os,sys
x = {'a':1,'b':2}
```
```python
# after black + isort (or `ruff format` + `ruff check --select I --fix`)
import os
import sys

x = {"a": 1, "b": 2}
```

**Rust — `rustfmt` (`cargo fmt`).** Ships with the toolchain; near-zero config in practice.

```rust
// before
fn add(a:i32,b:i32)->i32{a+b}
```
```rust
// after cargo fmt
fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

**Java — `google-java-format`, usually via Spotless.** Spotless is a build-plugin that runs formatters (and other steps) as part of Gradle/Maven, with a `spotlessCheck` and `spotlessApply` task pair mirroring check/write mode.

**C/C++ — `clang-format`.** Style comes from a preset (`LLVM`, `Google`, `Mozilla`, `WebKit`) plus optional overrides.

| Ecosystem | Format (write) | Check | Imports |
|---|---|---|---|
| Go | `gofmt -w .` | `gofmt -l .` | `goimports -w .` |
| JS/TS | `prettier --write .` / `biome format --write .` | `prettier --check .` | (Biome/ESLint plugin) |
| Python | `black .` / `ruff format` | `black --check .` | `isort .` / `ruff check --select I --fix` |
| Rust | `cargo fmt` | `cargo fmt --check` | (rustfmt does it) |
| Java | `./gradlew spotlessApply` | `./gradlew spotlessCheck` | (google-java-format) |
| C/C++ | `clang-format -i` | `clang-format --dry-run --Werror` | n/a |

---

## Core Concept 5 — Formatter and Linter, Side by Side, No Fighting

The most common operational pain is a formatter and a linter that *both* think they own layout, so they reformat each other's output and CI flickers between two states. The fix is a clean ownership boundary: **the formatter owns whitespace and layout; the linter owns logic and correctness; neither touches the other's domain.**

In practice this means **turning off every layout rule in the linter** and letting the formatter handle all of it. In the JS world this is so common there's a dedicated package, `eslint-config-prettier`, whose only job is to disable all ESLint rules that conflict with Prettier:

```jsonc
// .eslintrc — Prettier owns layout, ESLint owns the rest
{
  "extends": [
    "eslint:recommended",
    "prettier"   // MUST be last: disables all formatting rules in ESLint
  ]
}
```

Ruff (Python) handles this internally — when you run `ruff format` and `ruff check` together, the formatter and linter are designed to agree. Even so, Ruff documents which lint rules it considers the formatter's responsibility and recommends disabling overlapping ones.

The mental model: a linter rule like "max-len" or "indent" is a *layout* rule wearing a linter costume. If a formatter is in play, those rules are not just redundant — they're harmful, because now two tools have an opinion about the same character and they will fight. Strip them out. Let the formatter be the single source of truth for layout, and let the linter focus on what it's uniquely good at: unused variables, possible bugs, complexity, API misuse. The full treatment of linter rule classes is in [01 — Linters & Style Checkers](../01-linters-and-style-checkers/middle.md).

> **One-liner for reviews:** "Is this a layout rule or a logic rule?" If layout, it belongs to the formatter and should not be a lint rule at all.

---

## Core Concept 6 — The Three Integration Points

A formatter can run at three points in the lifecycle. You want all three, each playing a distinct role.

**1. Editor, on save — where formatting *should* happen.** Instant, invisible, zero friction. Covered at the junior level. This is the primary integration point: if everyone formats on save, the other two rarely fire.

**2. Pre-commit hook — the local backstop.** Catches code that wasn't formatted on save (web editors, scripts, a misconfigured machine) before it even becomes a commit:

```yaml
# .pre-commit-config.yaml (using the `pre-commit` framework)
repos:
  - repo: https://github.com/psf/black
    rev: 24.4.2
    hooks:
      - id: black
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.4
    hooks:
      - id: ruff
        args: [--fix]
```

The trade-off: hooks add latency to `git commit` and can be bypassed with `--no-verify`, so they are a *convenience and a backstop*, not a guarantee. Keep them fast or developers will disable them.

**3. CI check mode — the real gate.** The only point that *cannot* be bypassed, because it runs on the server and blocks the merge:

```yaml
# CI step (any provider)
- run: black --check --diff .
- run: prettier --check .
- run: gofmt -l . | tee /dev/stderr | (! read)   # fail if gofmt -l prints anything
```

> **The "format on save is the only place that matters" argument, revisited.** It's *aspirationally* true: if save-time formatting were universal and reliable, you'd never need the other two. But the real world has unconfigured editors and bypassed hooks, so the CI gate is the only place that *enforces*. The right framing: editor = where it happens, hook = local safety net, CI = the wall that doesn't move. Each one catches what the previous one missed. The deep version is [09 — Static Analysis in CI](../09-static-analysis-in-ci/middle.md).

---

## Real-World Examples

**1. The flickering CI gate.** A team had ESLint's `indent` rule on *and* Prettier in CI. ESLint wanted one indent, Prettier wanted another, and `--fix` from each undid the other. The build was red on alternate runs. Adding `eslint-config-prettier` (which disables all of ESLint's layout rules) fixed it in one commit — Prettier got sole ownership of layout.

**2. Ruff replacing the Python toolchain.** A repo ran `black`, `isort`, and `flake8` as three separate, slow pre-commit hooks. They consolidated to Ruff (`ruff format` + `ruff check --fix`), cutting pre-commit time from ~9s to under 1s and removing two config files. Output was byte-identical to Black, so the migration produced no churn.

**3. The idempotency check that caught a tool bug.** During a formatter upgrade, a CI job that ran `format` twice and diffed the results (`format(x)` vs `format(format(x))`) caught a regression where one construct oscillated between two shapes. The upgrade was held until the patch release fixed it — proof of why the idempotency guarantee is worth verifying on upgrades.

---

## Mental Models

- **The formatter parses to meaning, then reprints.** It doesn't *edit* your whitespace; it *discards* it and regenerates from the AST. That's why output depends only on meaning.
- **Idempotency is the fixed point.** Formatted code is where the function stops moving. Check mode just asks "are we already at the fixed point?"
- **Every option is a future argument.** The no-config philosophy is conflict prevention, not feature poverty.
- **Layout has one owner.** The formatter. The linter is a tenant in a different room; if both reach for the whitespace, they fight.
- **Three nets, one fish.** Editor, hook, CI — each catches what slipped past the last. You want all three because each has a different failure mode.

---

## Common Mistakes

- **Leaving layout rules on in the linter.** `indent`, `max-len`, `quotes` in ESLint while Prettier is running = the two tools fight forever. Disable them (`eslint-config-prettier`).
- **Treating the config file as a feature to grow.** A 40-line `.prettierrc` recreates the bikeshed. Keep it minimal; ideally adopt the defaults.
- **Assuming determinism survives a version bump.** It does for *that* version. A new major version is a *new function* — its fixed point is different. (Senior level covers the version-pinning churn.)
- **Running only the editor hook and skipping CI.** Then one unconfigured machine pollutes the repo and nobody catches it until much later.
- **Slow pre-commit hooks.** If `git commit` takes 8 seconds, developers add `--no-verify` and your backstop is gone. Keep hooks fast (Ruff/Biome help) or scope them to changed files.
- **Confusing "no config" with "no setup."** gofmt has no *style* config, but you still wire it into save/hook/CI. The philosophy removes *taste* knobs, not *integration* work.

---

## Test Yourself

1. Write the idempotency equation and explain why check mode depends on it.
2. A formatter parses to an AST and reprints. Why does that guarantee determinism?
3. Give the strongest argument *for* the no-config philosophy and the strongest cost *against* it.
4. Why did Prettier add a `singleQuote` option when gofmt has no options at all?
5. Your CI flickers red/green between identical commits and you run both Prettier and ESLint. What's the likely cause and the fix?
6. Name the three integration points and the distinct role each plays.
7. Why is a slow pre-commit hook a self-defeating safety net?

---

## Cheat Sheet

```bash
# Idempotency check (paranoia for upgrades): format twice, expect no diff
black . && black --check .

# Disable linter layout rules (JS): add to .eslintrc "extends", LAST
"prettier"

# Consolidated Python (fast): replaces black + isort + much of flake8
ruff format . && ruff check --fix .

# CI gate one-liners
gofmt -l .                      # any output = fail
prettier --check .
black --check --diff .
cargo fmt --check
clang-format --dry-run --Werror src/*.cpp
```

| Property | What it buys you |
|---|---|
| Determinism | No churn; editor and CI agree |
| Idempotency | Check mode is possible at all |
| No config | The style argument cannot happen |
| Clean ownership | Formatter and linter stop fighting |
| Three nets | Defense in depth: save → hook → CI |

---

## Summary

- A formatter parses code to an **AST and reprints it**, so output depends only on meaning — giving **determinism** and, crucially, **idempotency** (`format(format(x)) == format(x)`).
- Idempotency is *why check mode exists*; determinism is *why there's no churn*. Every formatter workflow rests on these two properties.
- The **no-config philosophy** (gofmt, Black) deliberately removes options to end bikeshedding; the cost is giving up house preferences, a trade almost every team should take.
- **Prettier's middle path** keeps a tiny option set for ecosystems with entrenched splits — adopt a preset and stop growing the config.
- The **tool landscape**: gofmt/goimports, Prettier/Biome, Black/isort/Ruff, rustfmt, google-java-format/Spotless, clang-format — each with a write mode and a check mode.
- Give layout **one owner** (the formatter); disable the linter's layout rules so the two don't fight.
- Wire the formatter into **all three integration points** — editor (where it happens), hook (local net), CI (the gate that can't be bypassed).

---

## Further Reading

- [Prettier — Option Philosophy](https://prettier.io/docs/en/option-philosophy.html) — why they refuse most options.
- [The Why of Go's gofmt](https://go.dev/blog/gofmt) — the original case for opinionated, no-config formatting.
- [Black — The Black code style](https://black.readthedocs.io/en/stable/the_black_code_style/) — what "uncompromising" decides for you.
- [Ruff formatter](https://docs.astral.sh/ruff/formatter/) — the Black-compatible, faster reimplementation.
- [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier) — the canonical "stop the fight" config.
- The **code-smell-detection** skill — for the logic-level issues that are the *linter's* job, not the formatter's.

---

## Related Topics

- [01 — Linters & Style Checkers](../01-linters-and-style-checkers/middle.md) — the report-don't-rewrite tool, and the layout-rule overlap.
- [09 — Static Analysis in CI](../09-static-analysis-in-ci/middle.md) — check mode as a merge gate, in depth.
- [07 — Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/middle.md) — the AST machinery formatters and linters share.
- [Senior Level](senior.md) — CI enforcement at scale, version-pinning churn, legacy adoption.
