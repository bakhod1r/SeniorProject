# Testable & Executable Docs — Junior Level

> **Roadmap:** [Documentation Quality](../README.md) → Testable & Executable Docs
> *The fastest way for documentation to lie is a code example that no longer works. The fix is radical and simple: make the computer run your examples, so the moment one breaks, a build turns red and someone fixes it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Examples Rot](#core-concept-1--why-examples-rot)
5. [Core Concept 2 — Doctests: The Example Runs Itself](#core-concept-2--doctests-the-example-runs-itself)
6. [Core Concept 3 — Go Examples and Rust Doc Tests](#core-concept-3--go-examples-and-rust-doc-tests)
7. [Core Concept 4 — Link Checking: The Other Silent Rot](#core-concept-4--link-checking-the-other-silent-rot)
8. [Core Concept 5 — Treat Every Example Like a Test Case](#core-concept-5--treat-every-example-like-a-test-case)
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

> Focus: **Why can't this doc lie to me?**

Open the README of almost any project that's a few years old and try the first code snippet. There's a real chance it doesn't work. The function was renamed. An argument was added. The output format changed. Nobody touched the doc — they touched the *code*, and the doc quietly drifted out of sync. The reader copies the snippet, it fails, and they lose trust in every other word on the page.

This is the single most common way documentation goes bad, and it has a name: **doc rot**. The most damaging kind of rot is a *wrong code example*, because the reader trusted it enough to paste it.

Here is the key move this whole topic is built on. A code example is, structurally, just a tiny program with an expected result. That is *exactly what a test is*. So instead of letting examples sit in a comment where nothing checks them, you make the computer **run them as part of your test suite**. If the example still works, the tests pass. If someone changes the code and forgets the doc, the example breaks, the tests fail, and the build goes red — which means a human is forced to look before the broken snippet ever reaches a reader.

This page teaches the beginner version of that idea: what an executable example is, how Python's `doctest`, Go's `Example` functions, and Rust's doc tests turn documentation into tests, and the one other rot you can automate away for free — broken links.

> **The mindset shift:** an example that runs in CI can't lie to your reader. Stop thinking "I'll write a snippet and hope it stays correct." Start thinking "I'll write a snippet the computer re-verifies on every commit." Correctness stops being a promise you make and becomes a property the machine enforces.

---

## Prerequisites

- **Required:** You can write and run a basic program in at least one language (examples use **Python**, **Go**, and a little **Rust**).
- **Required:** You've run a test at least once — `pytest`, `go test`, `cargo test`, or anything that prints "pass/fail."
- **Helpful:** You know what a **docstring** or a **doc comment** is (the text describing a function, written right above or inside it).
- **Helpful:** You've copied a code snippet from a README or Stack Overflow and had it *not work*. That frustration is the problem this topic kills.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Doc rot** | Documentation slowly going wrong as the code changes around it. |
| **Code example / snippet** | A short piece of sample code in docs that shows how to use something. |
| **Executable example** | A code example the computer can actually *run* (and check), not just display. |
| **Doctest** | An example written inside a docstring that the test tool runs and verifies. |
| **Docstring** | The text describing a function/module, written inside the source (Python `"""..."""`). |
| **Doc test** (Rust) | A code block inside a Rust doc comment that `cargo test` compiles and runs. |
| **Example function** (Go) | A Go function named `ExampleX` that is *both* documentation *and* a test. |
| **Link checker** | A tool that visits every link in your docs and reports the dead ones. |
| **CI** | Continuous Integration — the service that runs your tests automatically on every commit. |

---

## Core Concept 1 — Why Examples Rot

To fix rot you first have to see *why* it happens. Documentation and code live in different places but describe the same thing, and only one of them is checked by a machine.

Picture a function and its README example a year apart:

```python
# the code, version 1
def greet(name):
    return "Hello, " + name

# the README, written the same day
# >>> greet("Ada")
# 'Hello, Ada'
```

Six months later someone improves the function to take a greeting style:

```python
# the code, version 2  — signature changed!
def greet(name, style="Hello"):
    return f"{style}, {name}!"   # note the new "!"
```

The code is fine. The tests (if they exist) probably got updated. But the **README still says** `greet("Ada")` returns `'Hello, Ada'` — and now it actually returns `'Hello, Ada!'`. Nothing told anyone, because **nothing was watching the README.** The example didn't break loudly; it broke *silently*. That silence is the whole problem.

Why does this keep happening? Because of an asymmetry:

```
CODE        →  compiled, type-checked, unit-tested, linted   →  the machine watches it
DOC EXAMPLE →  sits in a string/comment, read by no tool      →  only humans watch it
```

Humans are unreliable watchers. They forget, they're busy, they don't run the tutorial when they fix a bug. The machine never forgets. So the entire strategy of this topic is: **move the example from the "only humans watch it" column into the "the machine watches it" column.** Once it's there, it cannot silently drift, because drift becomes a failing test.

> **Key insight:** Docs rot because the code is checked by a machine and the docs are checked by hope. The cure is not "try harder to update docs" — that has failed for decades. The cure is to put the docs *under the machine's watch*, so a stale example becomes a red build, not a quiet lie.

---

## Core Concept 2 — Doctests: The Example Runs Itself

A **doctest** is the most direct version of the idea: you write the example *inside the function's docstring*, exactly as it would look in an interactive session, and a tool runs it and checks the output.

Python has this built in. Here is a real, working example — copy it into `mathy.py`:

```python
def add(a, b):
    """Add two numbers and return the sum.

    >>> add(2, 3)
    5
    >>> add(-1, 1)
    0
    """
    return a + b
```

Those `>>>` lines aren't decoration. The `doctest` module reads them as instructions: *"run `add(2, 3)`, and check that it prints `5`."* Run it:

```bash
python -m doctest mathy.py -v
# Trying: add(2, 3)
# Expecting: 5
# ok
# Trying: add(-1, 1)
# Expecting: 0
# ok
```

Now break the function on purpose — change `return a + b` to `return a * b` — and run again:

```bash
python -m doctest mathy.py
# **********************************************************************
# File "mathy.py", line 4, in mathy.add
# Failed example:
#     add(2, 3)
# Expected:
#     5
# Got:
#     6
```

That failure is the entire point. The example in the docstring is *also* a test. The instant the code and the documented behavior disagree, you get a red failure that names the exact line. Wire `python -m doctest` (or `pytest --doctest-modules`) into CI and a stale example can never reach a reader — it gets stopped at the build.

Doctests shine for small, pure functions where the example reads like a conversation: call this, get that. The example is genuinely useful to a reader *and* it's a test. One piece of text, doing two jobs.

> **Key insight:** A doctest makes the example and the test *the same text*. You don't write the example once and a test separately and keep them in sync — there's nothing to keep in sync, because there's only one copy. Sameness, not synchronization, is what makes it impossible to drift.

---

## Core Concept 3 — Go Examples and Rust Doc Tests

Python isn't special here. Two of the most disciplined ecosystems make executable docs a first-class, built-in feature — proof this is an industry idea, not a Python trick.

**Go's `Example` functions.** In Go, a function named `ExampleSomething` that ends with an `// Output:` comment is *both documentation and a test*. The Go tooling shows it on the docs page **and** runs it under `go test`, comparing real output to the `// Output:` line. Here's a real one — put it in `stringutil/reverse_test.go`:

```go
package stringutil_test

import (
	"fmt"

	"example.com/stringutil"
)

func ExampleReverse() {
	fmt.Println(stringutil.Reverse("hello"))
	// Output: olleh
}
```

Run the test suite:

```bash
go test ./...
# ok      example.com/stringutil   0.002s
```

If someone changes `Reverse` so it returns `"olle"`, `go test` fails — the printed output no longer matches `// Output: olleh`. And this exact function appears, verbatim and verified, on the package's documentation page. A reader sees an example that is *guaranteed to compile and produce the stated output*, because the build refuses to pass otherwise. (Worth noting: a Go example **without** an `// Output:` comment is still compiled — so it can't reference a deleted function — it just isn't run.)

**Rust's doc tests.** In Rust, code inside a `///` doc comment, written as a fenced ```` ```rust ```` block, is compiled *and run* by `cargo test`:

```rust
/// Doubles the input.
///
/// ```
/// let result = mycrate::double(21);
/// assert_eq!(result, 42);
/// ```
pub fn double(x: i32) -> i32 {
    x * 2
}
```

Run the tests:

```bash
cargo test
#    Doc-tests mycrate
# test src/lib.rs - double (line 4) ... ok
```

The `assert_eq!` is the check. If `double` stops returning `42` for `21`, the doc test fails like any other test. Rust treats every example in its docs as a test by default — which is a big reason Rust's standard-library docs are famously trustworthy: the examples *can't* be wrong, or the library wouldn't have shipped.

The shape is identical across all three languages: **write the example where the reader will see it, and let the test runner execute it.** Different syntax, one principle.

---

## Core Concept 4 — Link Checking: The Other Silent Rot

Wrong code examples are the loudest lie. The *quietest* one is a broken link. Docs are full of them — links to other pages, to API references, to external articles — and links rot constantly: pages move, repos get renamed, sites disappear. A reader who clicks a dead link feels the same loss of trust as a reader whose snippet failed.

You don't fix this by carefully clicking every link by hand (you won't, and neither will anyone else). You automate it with a **link checker** — a tool that crawls your docs, follows every link, and reports the dead ones.

```bash
# example: a Markdown link checker run in CI
lychee ./docs/**/*.md
# ✓ 142 OK
# ✗ 3 errors
#   ./docs/setup.md  →  https://old.example.com/guide   (404 Not Found)
#   ./docs/api.md    →  ./reference/v1.md                (file not found)
```

Two kinds of links rot, and the checker catches both:

- **External links** — point to other websites. They break when the other site moves or dies (a `404`, or a host that no longer resolves).
- **Internal links** — point to other pages *in your own docs* (like the `[middle.md](middle.md)` link at the bottom of this page). They break when *you* rename or move a file. These are the most embarrassing, the most common, and the easiest to catch — the checker just looks for the target file on disk.

Run the link checker in CI on every change and a broken internal link becomes a failing build the moment it's introduced — before it ships, while the person who moved the file is still right there to fix it.

> **Key insight:** Broken links are doc rot you can eliminate for *free* — no test-writing, just one tool in CI. Internal links especially: a renamed file silently orphans every link to it, and a link checker turns that silence into a red build. It's the highest return-on-effort check in all of documentation quality.

---

## Core Concept 5 — Treat Every Example Like a Test Case

Step back from the specific tools and the real lesson appears: the reason all of this works is a *mindset*. **A documentation example is a test case that happens to be readable by humans.** Once you believe that, the tools are just the mechanics.

This reframing changes how you write examples:

- **Make them runnable, not illustrative-only.** Prefer an example the computer can execute (a doctest, a Go `Example`, a Rust doc test) over a snippet that only *looks* right in a code fence. A snippet no tool checks is a snippet that will eventually be wrong.
- **Give them a checkable result.** A test is "run X, expect Y." So is a good example: `>>> add(2, 3)` expects `5`; `assert_eq!(double(21), 42)`; `// Output: olleh`. The *expected result* is what makes it verifiable. An example with no shown output checks much less.
- **Run them where your tests run — in CI.** An executable example that nobody runs is no better than a comment. The value comes entirely from it executing automatically on every change. CI is what turns "should be correct" into "is correct, just now, on this commit."
- **Let red builds protect your readers.** When the example breaks, the failure isn't an annoyance — it's the system *working*. It caught a lie before a reader did. The red build is the whole product.

The same instinct covers links: a link is a claim ("this destination exists"), and a link checker is the test of that claim. Code examples and links are the two parts of your docs that make *checkable* claims — so they're exactly the two parts you can put under the machine's watch.

> **Key insight:** "Treat examples as tests" is the one sentence to remember. Every technique on this page is a mechanical consequence of it. If an example is a test, of course you run it in CI; of course you give it an expected output; of course a broken one fails the build. Adopt the mindset and the practices follow on their own.

---

## Real-World Examples

**1. The standard library you can actually trust.** Go's and Rust's standard-library docs are full of examples, and developers paste them with confidence — because both ecosystems *run* those examples as part of building the language itself. A Go `Example` with a wrong `// Output:` line, or a Rust doc test with a failing `assert_eq!`, would break the build and never ship. The trust isn't a writing achievement; it's a *testing* achievement. The examples are correct because they couldn't have been released otherwise.

**2. The README snippet that saved a release.** A team puts their quickstart's three-line example into a doctest run by CI. A refactor renames a parameter from `url` to `endpoint`. Unit tests pass (they were updated). But the *doctest* — the quickstart, the literal first thing every new user copies — fails, because it still says `url=`. CI goes red, the author updates the one snippet, and the change ships with a quickstart that still works. Without the doctest, the first experience of every new user that week would have been a crash.

**3. The renamed page that orphaned a dozen links.** A docs site reorganizes and `installation.md` becomes `setup/install.md`. Twelve other pages linked to the old path. With no link checker, those twelve links silently `404` and readers hit dead ends for months. With a link checker in CI, the move turns *red immediately* — twelve "file not found" errors — and the author fixes all twelve in the same pull request, before anyone reads a broken page.

---

## Mental Models

- **An example is a test wearing a friendly outfit.** Underneath the readable snippet is "run X, expect Y" — the exact shape of a test. Doctests, Go `Example`s, and Rust doc tests just stop pretending the two are different things and let one piece of text be both.

- **The two columns.** Everything in your project is either "watched by the machine" (code, tests) or "watched only by hope" (most docs). Rot happens in the hope column. Executable examples and link checkers *move docs into the machine's column* — and machines never forget to check.

- **The red build is a smoke detector for lies.** You don't want it to *never* go off — you want it to go off *the instant* an example or link becomes wrong, while the person responsible is still in the room. A red build on a broken doctest is the detector doing its job, not a nuisance.

- **One copy can't drift.** Drift needs two copies that disagree: the example and the reality. A doctest deletes one copy — the example *is* run against reality — so there's nothing left to fall out of sync. You can't desynchronize a thing from itself.

---

## Common Mistakes

1. **Writing examples no tool ever runs.** A snippet in a fenced code block that nothing executes is a snippet that *will* eventually be wrong. If the language offers executable examples (Python doctest, Go `Example`, Rust doc test), prefer them over decoration-only code.

2. **Examples with no expected output.** `>>> add(2, 3)` with no result line, or a Go example with no `// Output:`, checks far less. The *expected result* is what makes it verifiable — without it, the example might run but proves almost nothing.

3. **Writing the doctests but never running them in CI.** The value is *entirely* in automatic execution on every change. A doctest you only run manually (and therefore never) is just a comment with extra punctuation.

4. **Confusing "it compiled" with "it's correct."** A Go example without `// Output:` is compiled but not *run* — it can't reference a deleted function, but it won't catch a wrong *result*. Add the expected output when you care about behavior, not just that it builds.

5. **Ignoring internal links.** People worry about external links dying but forget that renaming their *own* file silently breaks every link to it. Internal links are the most common rot and the easiest to catch — a link checker finds them instantly.

6. **Over-fitting doctests to exact output.** A doctest that hard-codes a dictionary's print order, a memory address, or a timestamp will fail for reasons that aren't real rot. Keep executable examples on stable, deterministic output (and learn the tool's flags for the rest) so a red build always means a *real* problem.

---

## Test Yourself

1. In one sentence, why does a code example in a README tend to go wrong over time, even when nobody edits the README?
2. What does a Python doctest actually check? Point to the part of the docstring that makes it a test.
3. A Go function is named `ExampleReverse` and ends with `// Output: olleh`. Name the *two* jobs this single function does.
4. You add doctests to your project but never wire them into CI. Have you prevented doc rot? Why or why not?
5. What's the difference between an internal and an external link breaking, and which kind is a link checker most reliably able to catch?
6. Restate the core mindset of this whole topic in one sentence.

<details>
<summary>Answers</summary>

1. The **code** changes around it and is checked by a machine (tests, types), but the example sits in text that **no tool watches**, so it drifts silently while everything else stays correct.
2. It runs the expression after each `>>>` and checks that the real output matches the line written below it. The `>>>` line plus its **expected-output line** are what turn the example into a test.
3. It is **documentation** (shown on the package's docs page) *and* a **test** (run by `go test`, comparing real output to the `// Output:` comment).
4. **No.** The entire benefit comes from the examples being *run automatically on every change*. Doctests that are never executed are just comments — a stale one will still reach readers because nothing fails when it breaks.
5. An **external** link breaks when another website moves/dies; an **internal** link breaks when *you* rename or move one of your own files. The checker most reliably catches **internal** ones — it just checks whether the target file exists on disk.
6. **Treat every documentation example like a test case** — make it runnable, give it an expected result, and run it in CI so a broken example becomes a red build instead of a silent lie.

</details>

---

## Cheat Sheet

```
THE CORE IDEA
  An example IS a test ("run X, expect Y") → run it in CI → it can't silently lie.

WHY DOCS ROT
  code      → machine-checked (tests, types, lint)   → drift caught
  doc example → checked by hope                        → drift SILENT
  fix: move the example into the machine's column.

PYTHON — doctest
  def add(a, b):
      """
      >>> add(2, 3)
      5
      """
      return a + b
  run:  python -m doctest mathy.py -v
  or:   pytest --doctest-modules

GO — Example function (doc AND test)
  func ExampleReverse() {
      fmt.Println(stringutil.Reverse("hello"))
      // Output: olleh
  }
  run:  go test ./...
  no // Output:  → compiled but NOT run

RUST — doc test (run by default)
  /// ```
  /// assert_eq!(mycrate::double(21), 42);
  /// ```
  run:  cargo test   →   "Doc-tests" section

LINK CHECKING (free rot removal)
  internal link = points to YOUR file   → breaks when you rename it (easy to catch)
  external link = points to a website   → breaks when that site moves/dies
  run a link checker in CI on every change.

THE RED BUILD
  broken example / dead link → failing CI → fixed BEFORE a reader sees it.
  that's the system working, not a nuisance.
```

---

## Summary

- Docs rot most damagingly through **wrong code examples**, because the reader trusted the snippet enough to paste it. It happens silently because **code is machine-checked and docs usually aren't**.
- The cure is to **move examples into the machine's column**: make them *executable* and run them in CI. A stale example then becomes a **red build**, not a quiet lie — and a human fixes it before any reader hits it.
- **Doctests** (Python) put the example *inside the docstring* and check its output; **Go `Example` functions** are documentation *and* a test (verified against `// Output:`); **Rust doc tests** compile and run every example by default under `cargo test`. Same principle, three syntaxes.
- **Link checking** kills the other silent rot for almost no effort. Internal links (to your own renamed files) are the most common breakage and the easiest to catch automatically.
- The one idea under all of it: **treat every example like a test case** — make it runnable, give it an expected result, run it in CI. Every technique here is just a consequence of that sentence.

You now have the beginner's version of executable docs: the *why* (silent rot), the *how* (doctests, Go examples, Rust doc tests, link checkers), and the *mindset* (examples are tests). The next levels turn this into systematic practice — generating reference docs from the code itself, and *measuring* exactly how stale a doc set has become.

---

## Further Reading

- [Python `doctest` documentation](https://docs.python.org/3/library/doctest.html) — the official guide; short, and the directives section is worth a skim.
- [Go — "Testable Examples in Go"](https://go.dev/blog/examples) — the canonical explanation of `Example` functions as docs-and-tests.
- [The `rustdoc` book — Documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) — how and why Rust runs your doc examples.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the chapter on maintaining docs and fighting drift.
- The [middle.md](middle.md) of this topic — generating reference docs from source, executed snippets in real doc builders, and putting all of this into a CI pipeline.

---

## Related Topics

- [middle.md](middle.md) · [senior.md](senior.md) — the next tiers: spec-generated API docs, executed snippets at doc-build time, and the trade-offs of executable docs at scale.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/junior.md) — *accuracy* is one of the core quality attributes; executable docs are how you defend it.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/junior.md) — once examples *can* break loudly, you can start *measuring* how stale your docs are.
- [Code Coverage](../../code-coverage/) — the same "make the machine check it" instinct, applied to which code your tests exercise.
- [Code Craft → Documentation](../../../code-craft/documentation/) — how to *write* each kind of doc well; this topic is its quality-enforcement complement.
