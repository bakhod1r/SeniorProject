# Testable & Executable Docs — Middle Level

> **Roadmap:** [Documentation Quality](../README.md) → Testable & Executable Docs
> *The junior page argued that a doc which can't run will eventually lie. This page is the toolbox: the exact mechanisms — doctests, Go examples, Rust doc tests, snippet extraction, spec-generated reference, link checking — that turn "trust me, this still works" into a CI job that fails loudly when it doesn't.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Python Doctests, in Depth](#python-doctests-in-depth)
4. [Go Testable Examples — the Canonical Doc=Test](#go-testable-examples--the-canonical-doctest)
5. [Rust Doc Tests — Prose That Compiles](#rust-doc-tests--prose-that-compiles)
6. [Snippet Testing for Prose Docs](#snippet-testing-for-prose-docs)
7. [API Docs Generated *From* the Spec](#api-docs-generated-from-the-spec)
8. [Link Checking & Reference Validation in CI](#link-checking--reference-validation-in-ci)
9. [Worked Example — A Doctest Catches a Drifted Example](#worked-example--a-doctest-catches-a-drifted-example)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the concrete techniques and tools that make a doc verifiable, and how do they run in CI?**

A doc rots because nothing forces it to stay true. The remedy is to make the doc *executable*: phrase the example as code that a test runner can run, compare its real output against the documented output, and **fail the build on a mismatch**. The example stops being a screenshot of behaviour and becomes a live assertion.

Four ecosystems converged on this from different angles. Python *retrofits* it — a doctest is an interactive-session transcript embedded in a docstring. Go *blesses* it — a testable example is a first-class part of the test framework that godoc also renders. Rust *fuses* it — every fenced code block in a doc comment is, by default, a compiled-and-run test. Prose docs (Markdown books, READMEs) get it *bolted on* via snippet extractors. And the whole API-reference layer gets a different treatment entirely: don't test the docs, *generate* them from the same spec the server is validated against, so they can't disagree. This page makes each mechanism concrete — the exact syntax, what the runner actually does, where it bites — plus the CI step that runs them and the link checker that guards the prose around them.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and accept *why* docs need to be testable.
- **Required:** You can write and run a basic unit test in at least one language.
- **Required:** You've seen a CI pipeline run `test` on push (GitHub Actions, GitLab CI, or similar).
- **Helpful:** Passing familiarity with Python, Go, or Rust — examples lean on all three, but each is self-contained.
- **Helpful:** You know what OpenAPI / a contract test is, in outline.

---

## Python Doctests, in Depth

A **doctest** is an interactive-interpreter transcript pasted into a docstring. The `doctest` module finds lines beginning with the `>>>` prompt, executes them, and checks that the text that follows matches what the expression actually printed.

```python
def add(a, b):
    """Add two numbers.

    >>> add(2, 3)
    5
    >>> add(-1, 1)
    0
    """
    return a + b
```

Run it two ways. Standalone: `python -m doctest mymodule.py -v`. Or — far more common in a real project — let pytest collect every docstring as a test:

```bash
pytest --doctest-modules        # docstrings in .py source
pytest --doctest-glob='*.md'    # >>> blocks inside Markdown too
```

The check is **exact string comparison** of the repr/printed output, and that exactness is the whole source of doctest's pain. Four pitfalls account for nearly every flaky doctest:

- **Output must match the `repr`, character for character.** `add(2, 3)` documented as `5.0` fails — `int` reprs as `5`. A trailing space, a quote style, a `u''` prefix from a Python-2-era doc: all hard failures.
- **Dict and set ordering.** A `dict`'s repr order is now insertion order (3.7+), but a `set` has no guaranteed order — `{1, 2, 3}` may repr differently across runs. Don't doctest a bare set; sort it: `>>> sorted(s)`.
- **Volatile values** — addresses, timestamps, temp paths, floats with long tails. Use the ellipsis directive:

  ```python
  """
  >>> object()                      # doctest: +ELLIPSIS
  <object object at 0x...>
  >>> 1 / 3                         # doctest: +ELLIPSIS
  0.333...
  """
  ```

  Enable it globally with `pytest --doctest-modules` plus `doctest_optionflags = ELLIPSIS` in `pytest.ini`.
- **Exceptions** match on the traceback's *last line* (the type and message); the stack frames are ignored, and `...` stands in for them:

  ```python
  """
  >>> int('nope')
  Traceback (most recent call last):
      ...
  ValueError: invalid literal for int() with base 10: 'nope'
  """
  ```

The other recurring trap is **environment**: each docstring runs in its own namespace, so a name defined in one docstring is *not* visible in the next. Every doctest must set up what it uses, which is also what keeps the example honest — a reader can copy it and run it as-is.

> **Key insight:** Doctest's strength and its weakness are the same property — it asserts on *exact textual output*. That makes the doc a runnable transcript a reader can trust verbatim, but it means any nondeterminism (ordering, addresses, floats, timestamps) is a false failure you must neutralise with `+ELLIPSIS`, normalisation, or by not documenting volatile output at all. Doctests are for illustrating an API, not for exhaustive testing — keep them short and deterministic, and put edge cases in real unit tests.

---

## Go Testable Examples — the Canonical Doc=Test

Go folds the doc-equals-test idea directly into its toolchain, and it is the cleanest realisation of the pattern in any mainstream language. An **example function** is named `Example`, `ExampleFoo` (for function `Foo`), or `ExampleType_Method`, lives in a `_test.go` file, and ends with an `// Output:` comment:

```go
// example_test.go
package stringsutil_test

import (
    "fmt"

    "example.com/stringsutil"
)

func ExampleReverse() {
    fmt.Println(stringsutil.Reverse("hello"))
    // Output: olleh
}
```

`go test` *runs* this function, captures everything written to stdout, and compares it — trimmed of leading/trailing whitespace — against the text after `// Output:`. Mismatch → the test fails, exactly like any other failing test. Three details make it powerful:

- **It is real test code.** It's compiled with the package. If `Reverse` is renamed or its signature changes, the example *stops compiling* and the build breaks — so an example can never silently reference an API that no longer exists. This is the property doctests can't offer: doctest text is inert until run, but a Go example is checked by the compiler too.
- **godoc renders it as the documentation.** The example shows up on the `pkg.go.dev` / `godoc` page for `Reverse`, formatted as runnable code with its output, and the playground "Run" button executes it. The same bytes are simultaneously the test *and* the published doc — there is no second copy to drift.
- **Unordered output** for maps and goroutines uses `// Unordered output:`, which compares the lines as a set:

  ```go
  func ExampleScores() {
      for name, n := range map[string]int{"amy": 1, "bob": 2} {
          fmt.Printf("%s: %d\n", name, n)
      }
      // Unordered output:
      // amy: 1
      // bob: 2
  }
  ```

An example with **no** `// Output:` comment is compiled but *not run* — useful when the output isn't deterministic but you still want the compile-time guarantee that the code is valid. That single rule (`// Output:` present ⇒ executed and asserted; absent ⇒ compiled only) is the entire contract.

> **Key insight:** Go's testable example is the gold standard because the *same artefact* is the test, the compiled-against-the-real-API check, and the rendered documentation — three guarantees, one source of truth, zero duplication. When you design a doc system in any language, this is the bar: can the published example *fail the build* when it goes wrong?

---

## Rust Doc Tests — Prose That Compiles

Rust goes furthest: by default, **every fenced code block inside a doc comment is a test**. Write a `///` comment with a ```` ```rust ```` block (or just ```` ``` ````, since `rust` is the default), and `cargo test` extracts it, wraps it in a `main`, compiles it, and runs it.

```rust
/// Adds two numbers.
///
/// ```
/// use mycrate::add;
/// assert_eq!(add(2, 3), 5);
/// ```
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

`cargo test` reports these under a `Doc-tests mycrate` section. Because each block is compiled against the real crate, a doc example referencing a removed function or a changed signature **breaks the build** — the same compile-time guarantee Go gives. Rust then adds fine-grained control through code-fence attributes:

- ```` ```no_run ```` — compile the block but **don't execute** it (for code that opens a socket, spawns a process, or loops forever). Still catches API drift; skips runtime.
- ```` ```ignore ```` — neither compile nor run. The escape hatch of last resort; use sparingly, because it disables the very protection you wanted. Prefer `no_run`.
- ```` ```should_panic ```` — the block is expected to panic; the test passes only if it does.
- ```` ```compile_fail ```` — the block is expected to *fail compilation* (handy for demonstrating that a misuse is rejected by the type system).

The signature feature is **hiding setup with `#`**. A line beginning with `# ` is compiled and run but *not shown* in the rendered docs — so the visible example stays minimal while the test still has everything it needs:

```rust
/// ```
/// # use mycrate::Config;
/// # let cfg = Config::default();   // hidden boilerplate
/// let timeout = cfg.timeout();     // the line the reader sees
/// assert_eq!(timeout, 30);
/// # assert!(timeout > 0);          // hidden extra assertion
/// ```
```

The reader sees a clean two-line snippet; `cargo test` runs all five lines. This is the cleanest answer to doctest's "every example must show its own setup" tax — Rust lets the example be *both* minimal for humans and complete for the compiler.

> **Key insight:** Rust inverts the default — docs are tested *unless you opt out* — which is why rustdoc examples rot far less than hand-maintained snippets elsewhere. The `#`-hidden-line trick resolves the eternal tension between "minimal enough to read" and "complete enough to run": optimise the visible text for the human, let the hidden lines satisfy the compiler.

---

## Snippet Testing for Prose Docs

Doctests, Go examples, and rustdoc cover code that lives *next to* source. But your tutorials, READMEs, and book chapters are prose Markdown, and their fenced code blocks are exactly the snippets most likely to drift. Three strategies, in increasing order of robustness:

**1. Extract and run the fenced blocks.** Tools pull ```` ``` ```` blocks out of Markdown and execute them:

- **mdBook** (`mdbook test`) compiles every Rust block in the book against your crate — the same rustdoc machinery, applied to prose.
- **Python `mktestdocs`** feeds Markdown code blocks to pytest so `>>>`-free example code is run for errors:

  ```python
  # test_docs.py
  import pytest
  from pathlib import Path
  from mktestdocs import check_md_file

  @pytest.mark.parametrize("fpath", Path("docs").glob("**/*.md"), ids=str)
  def test_docs_run(fpath):
      check_md_file(fpath=fpath)   # executes the code blocks; fails on exception
  ```

- For shell/CLI docs, **`pytest-codeblocks`** or tools like **`cram`** / **`mdsh`** run fenced `console` blocks and diff the output.

**2. Embed/transclude real, tested source instead of pasting it.** The most durable technique is to *not duplicate the code at all*. The doc references a region of an actual source file (which your real test suite already covers), and the build inlines it:

```markdown
<!-- mdBook: pull lines 10–18 of a tested example file -->
{{#include ../examples/quickstart.rs:10:18}}
```

Many static-site generators have an equivalent (`snippet`/`literalinclude` in Sphinx, `<<<` includes in VitePress, embed plugins in Docusaurus). Now there is **one** copy of the code, it lives in a file the test suite runs, and the doc is a *view* onto it — drift is structurally impossible because there's nothing to drift from.

**3. Wire it into CI** so prose snippets are checked on every push:

```yaml
# .github/workflows/docs.yml
name: docs
on: [push, pull_request]
jobs:
  snippet-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -e . pytest mktestdocs
      - run: pytest --doctest-modules --doctest-glob='*.md'   # docstrings + Markdown
      - run: pytest test_docs.py                              # extracted prose snippets
```

> **Key insight:** There is a ladder of trust for snippets: *pasted text* (rots freely) → *extracted-and-run* (catches errors, but the copy can still diverge from real usage) → *transcluded from a tested source file* (cannot diverge, because there is only one copy). Climb as high as the tooling allows. The best documentation code is the code you never wrote twice.

---

## API Docs Generated *From* the Spec

For an HTTP API, testing the docs is the wrong frame. You don't write reference docs and then verify them — you make a **machine-readable spec the single source of truth** and *generate* both the human docs and the machine artefacts from it. If they share one origin, they can't disagree.

With **OpenAPI** as that source:

```yaml
# openapi.yaml — the contract
paths:
  /users/{id}:
    get:
      summary: Fetch a user by ID
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        '200':
          description: The user
          content:
            application/json:
              schema: { $ref: '#/components/schemas/User' }
```

From this one file you generate the **reference site** (Redoc, Swagger UI, Stoplight), **client SDKs and server stubs** (`openapi-generator`), and runnable **example requests**. Nobody hand-writes the parameter table — so the doc and the SDK and the examples are the same statement in three renderings.

The discipline that keeps it honest is a **contract test in CI**: assert that the running server actually conforms to the spec the docs are built from. Otherwise the spec drifts from the implementation and the generated docs become confidently wrong.

```yaml
  contract-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @stoplight/spectral-cli lint openapi.yaml   # is the spec itself valid?
      - run: docker compose up -d api                        # boot the real service
      - run: npx schemathesis run openapi.yaml \             # property-test the API
               --base-url http://localhost:8080 \            # against its own spec
               --checks all
```

`schemathesis` reads the spec, generates requests from it, and flags any response whose status or shape the spec didn't promise — closing the loop. Two common topologies: **spec-first** (write `openapi.yaml`, generate code and docs from it) and **code-first** (annotate handlers, *emit* the spec, then run the same contract test). Either works; what matters is that **one** artefact is authoritative and a test proves reality matches it.

> **Key insight:** Don't test reference docs — *eliminate the second copy*. When the OpenAPI spec is the single source for the server's contract, the SDKs, and the published reference, "the docs are wrong" can only mean "the spec is wrong," and a contract test catches *that* on every push. The reference doc becomes a projection of a tested artefact, not a hand-maintained parallel truth.

---

## Link Checking & Reference Validation in CI

Executable examples guard the *code* in your docs; nothing above guards the *prose around it*. The highest-volume form of rot is the broken link — a renamed page, a deleted anchor, a moved external resource, a `#section-heading` that no longer exists. A link checker catches all of it mechanically.

- **lychee** (fast, Rust) — checks external URLs *and* local files/anchors, with caching and a retry/accept policy for flaky or rate-limited hosts:

  ```yaml
  link-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: lycheeverse/lychee-action@v2
        with:
          args: --no-progress --cache --max-retries 2 './**/*.md'
          fail: true        # non-zero exit on any dead link → build fails
  ```

- **markdown-link-check** (Node) — per-file, easy to scope to changed files; honours a config of ignore patterns and replacement rules.

Two refinements separate a useful link job from a noisy one:

1. **Validate internal anchors, not just whole pages.** A link to `./guide.md#configuration` should fail if the `## Configuration` heading was renamed. lychee resolves fragments against the target file's generated anchors; turn this on, because intra-doc fragment rot is silent and common.
2. **Validate code symbols referenced in prose.** When docs name a `ClassName.method`, a flag, or a config key, that reference can drift just like a link. Lighter-weight than a full checker: grep the docs for symbol patterns and assert each exists in the codebase, or use a docs linter (Vale with a custom rule, or a small script) in the same CI stage.

External links will occasionally fail for reasons unrelated to your repo (a host is down, rate-limits you, or hides behind a login). Handle that with **caching, retries, and a curated ignore/accept list** — never by deleting the check. A flaky external link is a tuning problem; a disabled link checker is a guarantee that dead links ship.

> **Key insight:** Executable examples protect the code blocks; a link checker protects everything *between* them. The two together are what let you claim a doc is verified end to end. Run link checking on a schedule (nightly cron) *in addition to* on PRs, so external rot — links that die after merge — surfaces on its own rather than failing an unrelated contributor's build.

---

## Worked Example — A Doctest Catches a Drifted Example

A team documents a `format_price` helper. The docstring shows the API in action:

```python
# pricing.py
def format_price(cents: int, currency: str = "USD") -> str:
    """Format an integer number of cents as a currency string.

    >>> format_price(1050)
    '$10.50'
    >>> format_price(1050, currency="EUR")
    '€10.50'
    """
    symbol = {"USD": "$", "EUR": "€"}[currency]
    return f"{symbol}{cents / 100:.2f}"
```

CI runs `pytest --doctest-modules` on every push; the doctests pass, and the docstring is also the published reference. Months later, a contributor changes the convention — the symbol now follows the amount with a space — and updates the function but forgets the docstring:

```python
    return f"{cents / 100:.2f} {symbol}"     # '10.50 $' now, not '$10.50'
```

The unit tests for the *new* behaviour pass. But the doctest still claims the old output, so CI fails with a precise, self-describing diff:

```
003     >>> format_price(1050)
Expected:
    '$10.50'
Got:
    '10.50 $'
```

This is the entire value proposition in one screen. The example didn't merely *look* outdated to a reviewer who happened to notice — it was a **live assertion that the build refused to let pass**. The contributor either fixes the docstring (the example was right, the prose convention changed) or reverts (the change was wrong); either way, the published doc and the code are reconciled *before* a reader is ever misled. The same mechanism, expressed in Go (`// Output:`) or Rust (a ```` ``` ```` block), and the same CI gate, would have caught it identically. **A doc that runs cannot quietly drift, because drift becomes a red build.**

---

## Mental Models

- **A testable doc is an assertion wearing prose.** `>>>`, `// Output:`, and a ```` ``` ```` block are all the same move: state the expected behaviour, run the real code, fail on mismatch. The "documentation" framing is for the reader; the runner sees a test.

- **The doc=test ladder has three rungs.** *Inert text* (rots freely) → *compiled-only* (`no_run`, example with no `// Output:`; catches API drift) → *compiled-and-asserted* (full doctest / `// Output:` / `assert_eq!`; catches behaviour drift too). Pick the highest rung the example's determinism allows.

- **Don't verify a second copy — delete it.** Transclusion (include a region of a tested source file) and spec-generation (OpenAPI → docs + SDK) both beat *testing* a duplicate, because they remove the duplicate. The most reliable example is the one that exists exactly once.

- **Exactness is a feature with a tax.** String-exact output comparison is what makes the doc trustworthy verbatim — and what makes nondeterminism (sets, addresses, floats, timestamps) a false failure. Budget for `+ELLIPSIS` / `// Unordered output:` / normalisation up front.

- **Code and prose need different guards.** Executable tests cover the snippets; link/anchor/symbol checking covers everything around them. "Verified docs" means *both* run in CI.

---

## Common Mistakes

1. **Doctesting nondeterministic output.** A bare `set`, an object's address, a float tail, or a timestamp makes the doctest flaky. Sort the set, use `+ELLIPSIS`, normalise the value, or don't document that output at all.

2. **Writing a Go example with no `// Output:` and assuming it's checked.** Without the comment the example is *compiled but never run* — it catches API drift but asserts nothing about behaviour. Add `// Output:` (or `// Unordered output:`) when you want the value verified.

3. **Reaching for ```` ```ignore ```` in Rust.** `ignore` disables both compilation and execution — the example can rot freely, defeating the purpose. Use `no_run` (still compiled, so API drift is caught) and reserve `ignore` for genuinely uncompilable pseudocode.

4. **Pasting snippets into prose docs and hoping.** Hand-copied code in a README or tutorial is the single most drift-prone artefact you own. Extract-and-run it, or — better — transclude it from a source file the test suite already exercises.

5. **Hand-writing API reference beside a generator.** Maintaining a parameter table *and* an OpenAPI spec guarantees they diverge. Generate the reference from the spec, and add a contract test so the spec can't drift from the running server.

6. **Disabling the link checker because external links flake.** A down or rate-limited host is a tuning problem — fix it with caching, retries, and an ignore list. Turning the checker off ships dead links with confidence.

7. **Checking pages but not anchors or symbols.** `./guide.md` resolving fine while `./guide.md#old-heading` is dead is the common silent failure. Validate fragments, and validate the code symbols the prose names.

---

## Test Yourself

1. In a Python doctest, what exactly is compared, and why does documenting a bare `set` cause flakiness?
2. A Go `Example` function has no `// Output:` comment. What does `go test` do with it, and what does that buy you?
3. What is the difference between Rust's `no_run` and `ignore` fence attributes, and which should you prefer?
4. What does a line beginning with `# ` do inside a rustdoc code block, and what problem does it solve?
5. Why is *transcluding* a snippet from a source file better than *extracting and testing* a copied snippet?
6. With OpenAPI as the single source of truth, "the docs are wrong" can only mean what — and which CI step catches it?
7. Your link checker passes on whole pages but readers still hit dead links. What two kinds of reference are you probably not validating?

<details>
<summary>Answers</summary>

1. Doctest does an **exact string comparison** of the expression's printed/`repr` output against the documented text. A `set` has no guaranteed iteration/repr order, so `{1, 2, 3}` may render differently across runs and fail the exact match — sort it (`sorted(s)`) or avoid documenting the raw set.
2. It **compiles the example but does not run it** (no output to assert against). The payoff is a *compile-time* guarantee: if the referenced API is renamed or its signature changes, the example stops compiling and the build breaks — even though no behaviour is asserted.
3. `no_run` **compiles** the block (catching API drift) but skips execution; `ignore` does **neither** (the block can rot freely). Prefer `no_run` — it keeps the compile-time protection. Reserve `ignore` for code that genuinely can't compile (pseudocode).
4. A `# `-prefixed line is **compiled and run but hidden from the rendered docs**. It solves the tension between a minimal, readable visible example and the full setup/assertions the compiler needs — the human sees the clean lines, `cargo test` runs all of them.
5. Extract-and-test catches errors but the copied snippet can still **diverge from real usage** — it's a second copy. Transclusion inlines a region of an actual, test-covered source file, so there is **only one copy**; the doc is a view onto it and structurally cannot drift.
6. It can only mean **the spec is wrong**, because the human docs, SDKs, and examples are all generated from that one spec. A **contract test** (e.g. `schemathesis`/Dredd against the running server, plus a spec linter like Spectral) catches the spec-vs-implementation drift on every push.
7. Internal **anchors/fragments** (`page.md#heading` where the heading was renamed) and **code symbols** referenced in prose (a `Class.method`, flag, or config key that was removed/renamed). Validate fragments against target anchors and assert named symbols still exist in the codebase.

</details>

---

## Cheat Sheet

```
PYTHON DOCTEST
  >>> expr / expected      transcript in a docstring; EXACT output match
  pytest --doctest-modules         run docstrings in .py
  pytest --doctest-glob='*.md'     run >>> blocks in Markdown
  # doctest: +ELLIPSIS  +  '...'   for addresses/floats/volatile output
  Traceback ... / LastLine         exceptions match type+message, frames as ...
  pitfalls: set order, dict repr, trailing space, per-docstring namespace

GO TESTABLE EXAMPLE
  func ExampleFoo() { ...; // Output: expected }   run + asserted by `go test`
  // Unordered output:             compare lines as a set (maps, goroutines)
  no // Output:                    COMPILED ONLY, not run (still catches drift)
  same bytes = test + godoc page + playground "Run"

RUST DOC TEST  (tested BY DEFAULT)
  /// ``` ... assert_eq!(...) ```   compiled + run by `cargo test`
  ```no_run        compile, don't execute   (prefer over ignore)
  ```ignore        neither (last resort)
  ```should_panic  passes iff it panics
  ```compile_fail  passes iff it fails to compile
  # hidden_line    compiled+run, not shown in rendered docs

PROSE SNIPPETS  (ladder of trust)
  pasted text        → rots freely (avoid)
  extract + run      → mdbook test, mktestdocs, pytest-codeblocks
  transclude         → {{#include file:start:end}} — ONE copy, can't drift

API DOCS FROM SPEC
  openapi.yaml = single source → Redoc/Swagger UI + SDKs + examples
  contract test: spectral lint + schemathesis run --checks all (vs live server)

LINK / REFERENCE CHECK IN CI
  lychee --cache --max-retries 2 './**/*.md'   (external + local + anchors)
  validate #fragments AND code symbols, not just whole pages
  flaky external link → cache/retry/ignore, NEVER disable the check
  run on PR + nightly cron (catch post-merge external rot)
```

---

## Summary

- A **doctest** is an interactive transcript in a docstring; `doctest` / `pytest --doctest-modules` runs it and compares **exact** output. Its exactness makes it trustworthy and brittle at once — neutralise nondeterminism with `+ELLIPSIS`, sorting, or normalisation, and remember each docstring has its own namespace.
- A **Go testable example** (`func Example…`, `// Output:`) is run by `go test`, compiled against the real API, *and* rendered by godoc — the same bytes are test and doc, the canonical doc=test pattern. No `// Output:` ⇒ compiled but not run.
- **Rust doc tests** run every fenced block in `///` comments by default via `cargo test`; `no_run`/`ignore`/`should_panic`/`compile_fail` tune behaviour, and `#`-hidden lines keep the visible example minimal while the compiler sees full setup.
- **Prose snippets** climb a ladder of trust: pasted (rots) → extracted-and-run (`mdbook test`, `mktestdocs`) → **transcluded from a tested source file** (one copy, can't drift). Climb as high as the tooling allows.
- **API reference** shouldn't be tested but **generated** from a single source — OpenAPI feeding docs, SDKs, and examples — with a **contract test** (`schemathesis`/Spectral) proving the running server matches the spec.
- **Link checking** (lychee / markdown-link-check) in CI guards the prose around the code: validate external URLs, internal **anchors**, and referenced **code symbols**, with caching/retries for flaky hosts and a nightly run for post-merge rot.
- Put together, executable examples + reference generation + link checking are what let you say a doc is **verified end to end** — drift becomes a red build, not a reader's discovery.

---

## Further Reading

- **Python `doctest`** — the standard-library docs: directives (`+ELLIPSIS`, `+SKIP`), option flags, and the exact-match rules. The primary source for every pitfall above.
- **Go `testing` package — Examples** — `pkg.go.dev/testing#hdr-Examples`: naming rules, `Output:` vs `Unordered output:`, and how godoc renders them.
- **The rustdoc book — "Documentation tests"** — fence attributes (`no_run`, `ignore`, `should_panic`, `compile_fail`) and `#`-hidden lines, from the official docs.
- **mdBook documentation — `mdbook test` and `{{#include}}`** — testing and transcluding code in prose books.
- **OpenAPI Specification** + **Schemathesis / Spectral** docs — spec-as-source, contract testing, and generation.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the maintenance chapter on keeping examples and references from drifting.

---

## Related Topics

- [junior.md](junior.md) — *why* a doc that can't run will eventually lie (the motivation behind every tool here).
- [senior.md](senior.md) — designing the verification system: where to set the trust bar, golden-file/snapshot strategy, and the cost model of executable docs at scale.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/middle.md) — measuring the drift these tools prevent: staleness age, broken-link rate, snippets that no longer compile.
- [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/middle.md) — *which* examples and symbols are tested at all, and the gap between "has a snippet" and "has a *verified* snippet."
- [Code Coverage](../../code-coverage/) — the same fail-the-build-on-a-gap discipline applied to source; executable docs are coverage's documentation analogue.
- [Code Craft → Documentation](../../../code-craft/documentation/) — how to *write* the docs (Diátaxis, references, docs-as-code) that the techniques here make verifiable.
