# Formatters — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Formatters
> *A formatter is the most relaxing tool you will ever adopt. You stop caring where the brace goes, where the comma lands, whether the import list is sorted — because a machine decides, the same way, every time, and the decision is final. This page is about handing that decision over and never thinking about it again.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Formatter Rewrites, A Linter Reports](#core-concept-1--a-formatter-rewrites-a-linter-reports)
5. [Core Concept 2 — Layout Is Not Behavior](#core-concept-2--layout-is-not-behavior)
6. [Core Concept 3 — Format on Save](#core-concept-3--format-on-save)
7. [Core Concept 4 — Check Mode Catches Unformatted Code](#core-concept-4--check-mode-catches-unformatted-code)
8. [Core Concept 5 — One Tool Per Language](#core-concept-5--one-tool-per-language)
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

> Focus: **What a formatter is, why it is different from a linter, and how to wire it into your editor so you never format code by hand again.**

You have almost certainly spent time arguing — with yourself, or in a pull request — about layout. Two spaces or four? Trailing comma or not? Should this function call wrap onto three lines or stay on one? Where does the opening brace go? These questions have no correct answer. They have *conventions*, and every project picks slightly different ones, and humans are bad at applying them consistently.

A **formatter** ends the argument by force. It is a program that reads your source code and writes it back out in a single, canonical style. You type whatever you like — crammed onto one line, indented with random spaces, no blank lines anywhere — and the formatter rewrites it into the official shape. It does this *deterministically*: the same input always produces the same output, on your machine and on your teammate's machine and in CI.

The single most important fact about a formatter is what it is **not**: it is not a linter. A linter reads your code and *tells you about problems* — an unused variable, a possible null dereference, a function that's too complex. A formatter does not have opinions about your logic at all. It only rearranges whitespace, line breaks, and punctuation. It never changes what your code *does*. Get this distinction straight and the rest of the topic falls into place.

This page covers the junior-level essentials: the formatter-vs-linter split, why reformatting is safe, how to turn on format-on-save, how CI uses "check mode" to keep unformatted code out of the repo, and the standard tools for the common languages. By the end you should be able to set up a formatter on your own project and stop thinking about layout forever.

---

## Prerequisites

- **Required:** You can edit code in an editor like VS Code, GoLand, PyCharm, or Neovim.
- **Required:** You can run a command in a terminal (`prettier --version`, `gofmt --help`).
- **Required:** You have used `git` enough to make a commit and see a diff.
- **Helpful:** You have seen a pull request where half the diff was just whitespace and wondered why.
- **Helpful:** You have read [01 — Linters & Style Checkers](../01-linters-and-style-checkers/junior.md), so the word "linter" means something. If not, this page will draw the line for you.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Formatter** | A tool that rewrites source code into a fixed, canonical layout. Changes whitespace and line breaks, never behavior. |
| **Linter** | A tool that reads code and reports problems (bugs, smells, style violations). Some can auto-fix a subset; most just warn. |
| **Canonical style** | The one "official" shape the formatter produces. There is exactly one, regardless of how you wrote the input. |
| **Deterministic** | Same input always gives the same output, on every machine, every time. |
| **Format on save** | Editor setting that runs the formatter automatically each time you save a file. |
| **Check mode** | Running the formatter in "tell me if anything is unformatted" mode without changing files. Used by CI. |
| **gofmt / Prettier / Black / rustfmt** | The standard formatters for Go, JS/TS, Python, and Rust respectively. |
| **Diff** | The set of changes between two versions of a file, the way `git diff` shows it. |

---

## Core Concept 1 — A Formatter Rewrites, A Linter Reports

The cleanest way to understand a formatter is to put it next to a linter and watch them behave differently on the same file.

Here is a small, ugly Python function:

```python
def add(a,b):
        x=a+b
        return  x
```

Run a **formatter** (Black) on it and the file is *rewritten in place*:

```bash
black messy.py
# reformatted messy.py
# All done! ✨ 🍰 ✨
# 1 file reformatted.
```

```python
def add(a, b):
    x = a + b
    return x
```

The formatter fixed the spacing around the comma, the indentation, the spaces around `=` and `+`, and the double space before `x`. It did not comment on anything. It just made the file correct and moved on.

Now run a **linter** (Pyflakes/Ruff) on that same rewritten file:

```bash
ruff check messy.py
# messy.py:2:5: F841 Local variable `x` is assigned to but never used
```

The linter doesn't touch the layout — it points out that `x` is assigned and then returned but is a pointless intermediate, the kind of logic observation a formatter would never make. (You could simplify to `return a + b`.)

That is the whole division of labor:

| | Formatter | Linter |
|---|---|---|
| **What it does** | Rewrites layout | Reports problems |
| **Touches behavior?** | Never | Never (but it talks about behavior) |
| **Output** | A reformatted file | A list of warnings |
| **Has opinions about logic?** | No | Yes — that's its whole job |

> **Rule of thumb:** if the change is about *where the characters go*, it's a formatter's job. If the change is about *what the code means*, it's a linter's (or a human's) job.

---

## Core Concept 2 — Layout Is Not Behavior

The reason you can trust a formatter to rewrite your code unsupervised is that it only changes things the language doesn't care about. In almost every modern language, whitespace between tokens, the choice of where to break a long line, and trailing commas are *invisible to the compiler*. They are there for humans.

Consider this JavaScript:

```javascript
const user={name:"Ada",roles:["admin","editor"],active:true}
```

Prettier rewrites it as:

```javascript
const user = {
  name: "Ada",
  roles: ["admin", "editor"],
  active: true,
};
```

The program does *exactly* the same thing. `user.name` is still `"Ada"`. The object has the same keys and values. Prettier added spaces, broke the object across lines, and added a trailing comma after `true` — none of which the JavaScript engine notices. The code is now easier for a person to read, and that is the only thing that changed.

This is why "the formatter touched my whole file" is not scary. The behavior is identical; only the shape moved. The compiler or interpreter sees the same program before and after.

> **One real exception to know about:** in Python, indentation *is* meaningful — it defines blocks. A formatter like Black understands this and will never change indentation in a way that alters which block a line belongs to. It normalizes *style* (tabs vs spaces, 4 spaces per level) but preserves *structure*. Formatters are written by people who know the language's grammar; they don't blindly shuffle characters.

---

## Core Concept 3 — Format on Save

The best place to run a formatter is *your editor, on every save*. When format-on-save is on, you type code however it comes out of your fingers, hit save, and the file snaps into canonical shape instantly. You never look at unformatted code, and you never have to remember to run a command.

In **VS Code**, add this to your settings (`.vscode/settings.json`, committed to the repo so the whole team gets it):

```json
{
  "editor.formatOnSave": true,
  "[python]": { "editor.defaultFormatter": "ms-python.black-formatter" },
  "[go]": { "editor.defaultFormatter": "golang.go" },
  "[javascript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[typescript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" }
}
```

In **GoLand / PyCharm**, it's a checkbox: *Settings → Tools → Actions on Save → Reformat code*.

In **Neovim** (with `conform.nvim` or an LSP), you bind a `BufWritePre` autocommand.

The payoff is that formatting becomes invisible. You stop thinking about it. Diffs stay clean because every file is always already formatted. Code review never has a "fix your indentation" comment again.

> **The "format on save is the only place that matters" argument:** some teams say the editor hook is enough and you don't need anything else. The reasoning: if everyone formats on save, no unformatted code ever gets written. It's a nice idea, but it has one hole — *people who forget to configure their editor*, or who use a tool that doesn't have the hook. That's why you also want the CI check (next concept) as a backstop. Format-on-save is where formatting *should* happen; CI is where you *prove* it happened.

---

## Core Concept 4 — Check Mode Catches Unformatted Code

Every good formatter has a mode that doesn't rewrite anything — it just answers the question "is this code already formatted?" with a yes-or-no exit code. This is what CI uses to *block* unformatted code from merging, without the CI machine editing your files.

The flags differ by tool but the idea is identical:

```bash
gofmt -l .                 # lists files that are NOT formatted; empty output = all good
prettier --check .         # prints which files would change; exits non-zero if any
black --check .            # exits non-zero if any file would be reformatted
black --check --diff .     # also shows the exact diff it would apply
rustfmt --check src/*.rs   # exits non-zero and prints the diff if unformatted
```

What this looks like when something is wrong:

```bash
$ black --check --diff app.py
--- app.py  2026-06-22 10:00:00
+++ app.py  2026-06-22 10:00:00
@@ -1,2 +1,2 @@
-def add(a,b):
-    return a+b
+def add(a, b):
+    return a + b
would reformat app.py
Oh no! 💥 💔 💥
1 file would be reformatted.
```

The exit code is non-zero, so the CI job fails, so the pull request can't merge until the author runs the formatter and commits the result. The fix is always the same one command (`black .`), so the failure is annoying for about ten seconds and then gone.

> **Why check mode and not auto-format in CI?** A CI machine that edits your code and pushes it back is surprising and hard to trust — whose commit is that? Check mode keeps CI as a *gate*, not an *author*. It tells you something is wrong and makes you fix it locally, where you can see it. The deeper version of this lives in [09 — Static Analysis in CI](../09-static-analysis-in-ci/junior.md).

---

## Core Concept 5 — One Tool Per Language

You don't get to pick your formatter from a shelf of competitors and tune it to taste. For most languages there is *one* community-standard formatter, and the whole point is that you use it with as few options as possible. Here's the map:

| Language | Formatter | Notes |
|---|---|---|
| **Go** | `gofmt` (+ `goimports`) | Ships with Go. Zero options. `goimports` also sorts/removes imports. |
| **JS / TS / CSS / Markdown** | **Prettier** (or **Biome**) | A handful of options. Biome is a faster newer alternative. |
| **Python** | **Black** (+ **isort**) or **Ruff format** | Black is "uncompromising"; Ruff is a faster drop-in. isort sorts imports. |
| **Rust** | `rustfmt` | Ships with Rust (`cargo fmt`). |
| **Java** | `google-java-format`, often via **Spotless** | Spotless orchestrates formatters in the build. |
| **C / C++** | `clang-format` | Style chosen by a config preset (LLVM, Google, etc.). |

The commands you'll run most:

```bash
gofmt -w .          # Go: rewrite all files in place
goimports -w .      # Go: also fix import blocks
prettier --write .  # JS/TS/etc: rewrite in place
black .             # Python: rewrite in place
isort .             # Python: sort imports
cargo fmt           # Rust: rewrite the whole crate
clang-format -i src/*.cpp   # C/C++: rewrite in place
```

Notice the pattern: `-w` / `--write` / `-i` all mean "write the changes to disk." Without that flag, many tools print to stdout or just check. **Learn your tool's write flag and its check flag** — those are the two you use daily.

---

## Real-World Examples

**1. The pull request that was 80% whitespace.** A teammate opened a PR that changed three lines of logic, but the diff was 400 lines because their editor used tabs and the repo used spaces. Nobody could review it. The fix: adopt a formatter, run it once across the whole repo in a separate commit, and turn on format-on-save. After that, diffs only show real changes.

**2. The "it works on my machine" indentation fight.** Two developers kept un-doing each other's indentation in the same file because their editors disagreed. A formatter ended it in one afternoon — both editors now run the same tool on save, so the file converges to one shape no matter who touches it.

**3. CI caught the unformatted commit.** A developer pushed a quick fix from a web editor that had no formatter. The `prettier --check .` job failed in CI with a clear message. They ran `prettier --write .` locally, committed, and the gate went green. No human had to notice the bad formatting in review.

---

## Mental Models

- **The formatter is a printing press.** You hand it a messy manuscript; it prints the book in the house style. The words are yours; the typesetting is the machine's.
- **Layout is paint, behavior is structure.** A formatter repaints; it never moves a wall. That's why it's safe to run unsupervised.
- **Format-on-save is a dishwasher.** You don't hand-wash each dish (hand-format each file). You load it and the machine does the boring work the same way every time.
- **Check mode is a metal detector at the door.** It doesn't fix you; it just refuses to let unformatted code through and tells you exactly what set it off.

---

## Common Mistakes

- **Thinking the formatter changed your logic.** It didn't. If behavior changed, something else changed too — look again. Formatters only move whitespace and breaks.
- **Running the formatter by hand and forgetting half the time.** Turn on format-on-save. Manual formatting is a habit you will lose under deadline pressure.
- **Fighting the formatter's output.** It wrapped your line "ugly"? That's the canonical shape. Arguing with it wastes the time the tool exists to save. (If it's truly unreadable, that's a *code* smell — the line is doing too much.)
- **Committing unformatted code and blaming CI.** CI's check-mode failure is doing its job. Run the write command, commit, move on.
- **Mixing up the write flag and the check flag.** `gofmt -w` rewrites; `gofmt -l` lists. `black .` rewrites; `black --check` checks. Run the wrong one in CI and you either edit files you shouldn't or fail to catch anything.
- **Using two formatters that disagree on the same files.** Pick one per language. Two formatters will reformat each other's output forever.

---

## Test Yourself

1. In one sentence each, what does a formatter do and what does a linter do?
2. Why is it safe to let a formatter rewrite a file you never read?
3. What does `--check` mode do, and why does CI use it instead of `--write`?
4. Your editor uses tabs but the repo uses spaces, and your diffs are full of whitespace noise. What's the fix?
5. Name the standard formatter for Go, for Python, for JavaScript, and for Rust.
6. A teammate says "the formatter broke my code." What's the most likely real explanation?

---

## Cheat Sheet

```bash
# --- rewrite in place (what you run, or format-on-save runs for you) ---
gofmt -w .            # Go
goimports -w .        # Go (imports too)
prettier --write .    # JS/TS/CSS/MD
black .               # Python
isort .               # Python imports
cargo fmt             # Rust
clang-format -i f.cpp # C/C++

# --- check mode (what CI runs) ---
gofmt -l .            # lists unformatted files; empty = OK
prettier --check .    # non-zero exit if any file would change
black --check .       # non-zero exit if any file would change
black --check --diff . # also shows the diff
rustfmt --check       # non-zero exit + diff
```

| If you want to… | Do this |
|---|---|
| Never format by hand again | Turn on format-on-save in your editor |
| Stop unformatted code merging | Add a `--check` job to CI |
| Fix a CI formatting failure | Run the write command, commit, push |
| Know if a change is formatter's job | Ask: is it about *where* the characters go, or *what they mean*? |

---

## Summary

- A **formatter rewrites** code into one canonical layout; a **linter reports** problems. They are different tools with different jobs.
- A formatter only changes **layout, never behavior** — that's why it's safe to run unsupervised on a whole file.
- The best place to format is **your editor, on save**. You stop thinking about layout entirely.
- **Check mode** (`--check` / `-l`) lets CI block unformatted code without editing your files.
- Most languages have **one standard formatter**: gofmt (Go), Prettier/Biome (JS/TS), Black/Ruff (Python), rustfmt (Rust), clang-format (C/C++), google-java-format (Java).
- Learn your tool's **write flag** and **check flag** — those are the two you use every day.

---

## Further Reading

- [gofmt documentation](https://pkg.go.dev/cmd/gofmt) — the original "no options" formatter.
- [Prettier — Why Prettier?](https://prettier.io/docs/en/why-prettier.html) — the case for opinionated formatting.
- [Black — The uncompromising code formatter](https://black.readthedocs.io/) — Python's canonical formatter.
- [rustfmt](https://github.com/rust-lang/rustfmt) — Rust's standard formatter.
- The **naming-conventions** skill — for the source-level style decisions formatters *don't* make (identifiers).

---

## Related Topics

- [01 — Linters & Style Checkers](../01-linters-and-style-checkers/junior.md) — the other half of the split: tools that report instead of rewrite.
- [09 — Static Analysis in CI](../09-static-analysis-in-ci/junior.md) — where check-mode formatting becomes a merge gate.
- [Middle Level](middle.md) — determinism, the "no config" philosophy, and the full tool landscape.
- [Static Analysis Roadmap](../README.md) — the whole category in context.
