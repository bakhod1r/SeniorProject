# Testable & Executable Docs — Interview Questions

> **Roadmap:** [Documentation Quality](../README.md) → Testable & Executable Docs
> *This interview rarely asks "should examples be correct." It asks "your quickstart broke on the last release — make it stop, permanently," and watches whether you reach for discipline (review, more reviewers) or for a mechanism (run the example in CI so a broken one can't merge). The whole topic is one move: turn the example into a test, then decide where that move pays for itself and where it doesn't.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Why Executable Docs](#theme-1--why-executable-docs)
3. [Theme 2 — The Mechanisms](#theme-2--the-mechanisms)
4. [Theme 3 — Single Source of Truth](#theme-3--single-source-of-truth)
5. [Theme 4 — Doc Tests as a Testing Strategy](#theme-4--doc-tests-as-a-testing-strategy)
6. [Theme 5 — Notebooks, Literate Docs, and Reproducibility](#theme-5--notebooks-literate-docs-and-reproducibility)
7. [Theme 6 — Scenarios and Judgment](#theme-6--scenarios-and-judgment)
8. [Theme 7 — The Limit: Executable ≠ Good](#theme-7--the-limit-executable--good)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *moves* they keep returning to:

- **example as test** (the snippet isn't documentation *and* a test; it's one artifact that fails the build when it lies)
- **generate vs duplicate** (two copies of a fact drift; one source projected into two views can't)
- **deterministic vs flaky** (an executable example is only an asset if it produces the same output every run)
- **runs vs teaches** (passing CI proves the code is correct, not that the page is comprehensible)

Nearly every question in this bank is one of those four moves wearing a costume. The candidates who do well *name the move* before naming a tool — they say "I'd make the example fail the build" before they say "doctest."

---

## Theme 1 — Why Executable Docs

### Q1.1 — What problem do executable docs actually solve? Be concrete.

> **Testing:** Whether you can name the failure mode, or just like the buzzword.

**A.** They solve **silent example rot**. A code example in prose is a *copy* of a fact about the code — the function name, the argument order, the return shape. The real fact lives in the source and evolves; the copy in the docs does not, because nothing forces it to. So the example drifts: a parameter gets renamed, a return type changes from a tuple to a struct, a default flips — and the docs keep showing the old call. It still *looks* right, which is the trap. Nobody gets an error; a new user copies the snippet, it fails, and they conclude the library is broken or the docs are untrustworthy. Executable docs close the loop by making the example **run in CI**: if the documented call no longer compiles or no longer produces the documented output, the build goes red and a human fixes it *before* a user ever sees the lie. The value isn't "examples that run" — it's "broken examples that *can't merge*."

### Q1.2 — "We have code review, so our examples are fine." Push back.

> **Testing:** Whether you understand why review is the wrong tool for this specific decay.

**A.** Review catches the example when it's *written*, not when it *rots*. The break almost never happens in a PR that touches the docs — it happens three months later in a PR that renames a function, where the author changes 40 call sites and never opens the markdown file. No reviewer is diffing prose against a refactor in an unrelated directory. Review is a point-in-time gate against bad *new* examples; rot is a continuous force against *old, previously-correct* ones. You can't out-review entropy. The only thing that scales is a mechanism that re-checks every example on every change — which is exactly what running the example as a test does. Discipline ("be careful to update the docs") is a recurring tax that someone eventually skips; a failing build is enforced for free, forever.

### Q1.3 — What's the mental shift between "an example" and "a doc test"?

> **Testing:** Whether you see the duality, the core idea of the topic.

**A.** An ordinary example is *output-only*: it's text a human reads. A doc test is the *same snippet* read by two audiences at once — a human reads it as documentation, and a test runner executes it as a regression test. That duality is the whole point. It means the example is no longer a thing you *maintain in sync* with the code; it's a thing that *is verified against* the code automatically. The cost is a real constraint: because a machine runs it, the example must be **complete and deterministic** — it has to actually compile and produce a stable, assertable result, not a hand-wavy `foo(...)` with `# returns something useful`. That constraint is also a quality forcing-function: examples that can't be made to run are often examples that were subtly wrong or incomplete to begin with.

---

## Theme 2 — The Mechanisms

### Q2.1 — How does Python's `doctest` work, mechanically?

> **Testing:** Whether you know it's interactive-session matching, not arbitrary assertion.

**A.** `doctest` scans docstrings (and, with `testmod`/`testfile`, plain text files) for text that **looks like an interactive Python session**: lines beginning with the `>>>` prompt, continuation lines with `...`, and the *expected output* on the lines immediately following. It executes each `>>>` statement and compares the captured `stdout`/`repr` **as a string** against the expected text. If they differ, the test fails. That string-equality model is its defining strength and weakness: it's wonderfully readable — the docstring literally reads like a REPL transcript — but it's brittle, because it matches *text*. Dict ordering, `repr` of a float, a memory address in an object's default `repr`, a trailing space — any of these breaks the match even when the code is correct. The escape hatches are directives like `# doctest: +ELLIPSIS` (let `...` stand in for variable text), `+NORMALIZE_WHITESPACE`, `+SKIP`, and `+IGNORE_EXCEPTION_DETAIL`. You run it with `python -m doctest file.py -v`, `doctest.testmod()`, or — the usual production path — via the `pytest --doctest-modules` / `--doctest-glob` integration so it lives in the same suite as everything else.

### Q2.2 — How is Go's `Example` mechanism different, and what does `// Output:` do?

> **Testing:** Whether you know `go test` runs examples and that the Output comment is the assertion.

**A.** In Go, an **example function** is a real, compiled function named `Example`, `ExampleFoo`, or `ExampleType_Method`, placed in a `_test.go` file. Two things make it special. First, `go test` *compiles and runs* it like any test, so a documented example that no longer compiles is a **build failure** — Go's strictness means example rot often can't even reach runtime. Second, if the function ends with a magic comment:

```go
func ExampleReverse() {
    fmt.Println(Reverse("hello"))
    // Output: olleh
}
```

`go test` captures the example's `stdout` and asserts it equals the text after `// Output:`. No `// Output:` comment means the example is *compiled but not run for output* — still valuable, because it proves the code builds. There's also `// Unordered output:` for cases where line order isn't guaranteed (e.g. ranging a map). The payoff is integration with the toolchain: these examples are *extracted into the godoc / pkg.go.dev page automatically*, so the documentation a reader sees on the web is, by construction, the exact code that passed CI.

### Q2.3 — How do Rust's doc tests work, and what's the surprising default?

> **Testing:** Whether you know `cargo test` runs `///` code blocks as standalone binaries.

**A.** Rust extracts fenced code blocks (` ```rust ` or just ` ``` `) from `///` and `//!` doc comments, **wraps each one in its own `fn main`, compiles it as a separate crate that links against your library, and runs it** — all driven by `cargo test`, which runs unit tests, integration tests, *and* doc tests as distinct phases. The surprising default is that **a doc test that panics fails**, so an `assert_eq!` inside the example *is* the assertion:

```rust
/// ```
/// assert_eq!(mylib::add(2, 2), 4);
/// ```
```

That makes the example double as a checked spec. Rust adds rich block attributes for the cases prose needs: `` ```ignore `` (don't compile or run), `` ```no_run `` (compile but don't run — for examples that hit the network), `` ```should_panic `` (the example is *supposed* to panic), `` ```compile_fail `` (assert that this code does *not* compile — great for documenting type-safety guarantees), and a `# ` line prefix to *hide* boilerplate setup lines from the rendered docs while still compiling them. So Rust's docs can show a clean five-line example while secretly compiling the imports and scaffolding around it.

### Q2.4 — Markdown docs aren't a programming language. How do you test the snippets in an mdBook / a docs site?

> **Testing:** Whether you know the general pattern beyond the three batteries-included languages.

**A.** Two patterns. First, **import the snippet from real, tested source instead of pasting it.** mdBook's `{{#include file.rs}}` (and `{{#rustdoc_include}}`, and anchor ranges like `{{#include file.rs:anchor}}`) pulls the code from an actual file in an examples crate that `cargo test` already compiles — so the book can't show code that doesn't build, and there's *one* copy of the snippet. Many docs toolchains have an equivalent (Sphinx's `literalinclude`, Hugo/Docusaurus include shortcodes, AsciiDoc `include::`). The rule is: **the rendered snippet is a projection of tested source, never a hand-typed duplicate.** Second, for snippets that *must* be inline in the markdown, use an **extract-and-run** harness: tools like `mdbook-keeper`, `rust-skeptic`, Python's `pytest --doctest-glob='*.md'`, `mdoc`/`tut` (Scala), or `cog`/`byexample`/`doctest`-for-shell pull every fenced block out of the markdown, run it, and assert its output. Either way the principle holds — the markdown stops being a place where code goes to die and becomes another input to the test runner.

### Q2.5 — Across doctest, Go Example, and rustdoc — what's the one thing they all rely on, and where does each draw the assertion line?

> **Testing:** Synthesis — do you see the shared shape and the real differences?

**A.** They all rely on **captured, comparable output or a panic-on-failure contract** to turn a human-readable snippet into a pass/fail signal. The differences are *where the assertion lives*:
- **Python `doctest`** asserts on **stdout/repr string equality** against the expected REPL output — most readable, most brittle (text matching).
- **Go Example** asserts on **stdout string equality** against `// Output:` — and additionally gives you "compiles = passes" when you omit the comment.
- **Rust doc tests** assert via **panics** (`assert_eq!`, `?` on `Result`), i.e. arbitrary in-code logic, not output text — least brittle, most expressive, but the example must be valid compilable Rust.

The practical consequence: Python/Go examples break on *cosmetic* output changes (a reordered map, a float `repr`), while Rust examples break only on *semantic* changes — but Rust pays for it by requiring the snippet to be fully compilable code, not a loose transcript.

---

## Theme 3 — Single Source of Truth

### Q3.1 — Your REST API docs and your actual API disagree. How do you make that *structurally impossible*, not just "we'll be careful"?

> **Testing:** Whether you reach for generation/contract testing instead of process.

**A.** You stop maintaining the description by hand and make **one artifact authoritative**, then derive everything else from it. Two valid directions:
- **Spec-first:** the OpenAPI document is the source of truth. The human docs (Redoc/Swagger UI) are *rendered from it*, and the server is **contract-tested against it** — a tool like Schemathesis, Dredd, or a Pact provider verification hits the running service and asserts every response conforms to the schema. Now if the implementation drifts from the spec, the contract test fails; the docs can't be wrong without CI going red.
- **Code-first:** annotations on the handlers *generate* the OpenAPI document (FastAPI, springdoc, drf-spectacular), and the docs render from that generated spec. The schema can't lie about routes/types because it's produced from the code that serves them.

Either way the win is the same: **two copies of a fact drift; one fact projected into two views cannot.** The thing I'd refuse to ship is a hand-written OpenAPI file *and* a separate hand-written implementation with no test tying them together — that's just two documents waiting to disagree.

### Q3.2 — Where else does "generate the docs from the source of truth" apply besides HTTP APIs?

> **Testing:** Breadth — do you see the pattern, or just the OpenAPI instance of it?

**A.** Anywhere a documented fact has a machine-readable origin:
- **CLI help / man pages** generated from the argument parser (Cobra, Click, clap, argparse) so flags in the docs match flags in the binary.
- **Config reference** generated from the config struct/schema (JSON Schema, a Go struct with tags) so every option and default is real.
- **DB schema docs / ERDs** generated from migrations or the live schema (SchemaSpy, dbdocs, `tbls`) rather than a stale Confluence diagram.
- **GraphQL docs** generated from the SDL, which the server already enforces.
- **Protobuf/gRPC** API docs generated from the `.proto` (`protoc-gen-doc`).
- **Client SDKs** generated from the same OpenAPI/proto, so a contract change ripples into every language at once.

The unifying rule: **if a fact lives in a schema the program already executes, the docs for that fact should be a projection of the schema, not a parallel transcription.** Hand-transcribed reference material is the highest-rot, lowest-value documentation there is — it's exactly the part a machine should own.

### Q3.3 — Generated reference docs sound great. What's the catch, and what do you *not* generate?

> **Testing:** Whether you know generation's blind spot — it documents *what*, not *why*.

**A.** Generation produces accurate, complete, and **soulless** reference material. An auto-generated endpoint list tells you every route, every field, every type — and *nothing* about which call to make first, why the field exists, what the gotchas are, or how to accomplish a real task. It documents the *what* with perfect fidelity and the *why/how* not at all. So the split is: **generate the reference (the encyclopedia), hand-write the explanation and the tutorials (the guidebook).** In Diátaxis terms, generation owns *Reference*; humans own *Explanation*, *How-to*, and *Tutorial*. The failure mode I'd call out is teams that generate a Swagger UI, link it, and declare the API "documented" — they've shipped an accurate index with no narrative, and users still can't get started. Generation removes the rot from reference; it doesn't remove the need for someone to *teach*.

---

## Theme 4 — Doc Tests as a Testing Strategy

### Q4.1 — Should doc tests replace your unit tests? Argue both sides, then land it.

> **Testing:** Whether you understand doc tests are an *exemplar* layer, not a coverage layer.

**A.** No — and conflating them is a classic mistake. Doc tests optimize for **readability and being a good example**; unit tests optimize for **coverage of edge cases, failure paths, and weird inputs**. A doc test that wandered through null handling, boundary conditions, and three error branches would be a *terrible example* — nobody learns from it — and a *mediocre* test, because output-string matching is a clumsy way to assert rich behavior. Conversely, a thorough unit suite makes a confusing tutorial. So they're different jobs: doc tests prove the *happy-path example a human will copy actually works and stays working*; unit/property/integration tests prove the *implementation is correct across the input space*. Land it: keep doc tests **few, clean, and exemplary** — one per public concept — and put your real edge-case rigor in the normal suite. Use doc tests to guarantee the *documentation* is honest, not to chase a coverage number.

### Q4.2 — Doc tests have a reputation for being the flakiest, most brittle part of CI. Why, specifically?

> **Testing:** Whether you can name the concrete brittleness sources, not just "they're flaky."

**A.** Because most doc-test mechanisms assert on **exact output text**, and a lot of real output is *legitimately nondeterministic or environment-dependent*:
- **Unordered collections** — `print(my_dict)` or ranging a Go map yields different orderings across runs/versions.
- **Floating point** — `repr(0.1 + 0.2)` is `0.30000000000000004`; format width and rounding differ by platform.
- **Addresses / ids / hashes** — a default `repr` like `<Foo object at 0x7f...>`, a UUID, an autoincrement id.
- **Time and timezones** — `datetime.now()`, durations, "3 minutes ago."
- **Locale and encoding** — number/date formatting, currency, path separators.
- **Ambient state** — current working directory, env vars, network reachability, file ordering from `os.listdir`.

None of these are *bugs*; they're variability the test pins to one accidental snapshot. So the discipline is to **engineer determinism**: sort before printing, format floats explicitly (`f"{x:.2f}"`), inject a fixed clock/seed, use `+ELLIPSIS`/`Unordered output`/`+NORMALIZE_WHITESPACE` for genuinely variable parts, and mark network examples `no_run`/`+SKIP`. A flaky doc test is almost always an example that's printing something it shouldn't be asserting on.

### Q4.3 — How do you test a *tutorial* or a *CLI session* — multi-step things where matching one return value isn't enough?

> **Testing:** Whether you know golden/transcript testing exists and when to reach for it.

**A.** With **golden (snapshot) tests** and **transcript tests**. For a CLI or a multi-command tutorial, you record the entire interaction — the commands and their full output — as an approved "golden file," then in CI you *replay the commands and diff the actual output against the golden*. If they differ, the test fails and a human either fixes the tool or *re-approves* the new output (`UPDATE_SNAPSHOTS=1`, `cargo insta review`, `go test -update`). This is exactly what tools like `cram`, `bats`, Click's `CliRunner`, `expect`/`pexpect`, `insta`, `expecttest`, and testscript do. The reason transcript testing fits tutorials: a tutorial *is* a transcript — "run this, see this, then run that." Pinning the whole transcript catches the break that single-value doctests miss, like a changed prompt, a reordered output section, or a new warning line. The tradeoff is the same brittleness amplified across more output, so the determinism discipline from Q4.2 matters even more: scrub timestamps/paths/ids with normalization filters before the diff, or the golden file churns on every run.

### Q4.4 — A doc test passes but the underlying behavior is wrong (or vice versa). How does that happen?

> **Testing:** Whether you understand output-matching's epistemic limits.

**A.** Two ways. **Passes but wrong:** output-matching only checks what you *printed*. If the example prints a formatted summary but the function also silently corrupted a field you didn't print, the doc test is green and the behavior is broken — the assertion surface is exactly the stdout, nothing more. That's why doc tests aren't a substitute for unit tests that assert on the actual return value and side effects. **Fails but right:** the *behavior* is correct but the *output text* changed cosmetically — a dependency upgraded its `repr`, a map reordered, a float's last digit shifted — so the string match fails on a non-bug. This is the brittleness tax: doc tests conflate "the answer changed" with "the *presentation* of the answer changed," and can't tell you which. The senior framing: a doc test is a **change detector on observable output**, not a correctness oracle. It's superb at catching "the example no longer does what we said," and blind to anything you didn't surface in the printed output.

---

## Theme 5 — Notebooks, Literate Docs, and Reproducibility

### Q5.1 — Jupyter notebooks are the canonical "literate doc." What's the central reproducibility trap?

> **Testing:** Whether you know about hidden out-of-order state.

**A.** **Hidden, out-of-order execution state.** A notebook's cells can be run in *any* order, and the kernel keeps all the variables they defined. So the saved `.ipynb` — with its tidy top-to-bottom cells and their stored outputs — can show a result that is *not reproducible from a clean run*, because the author ran cell 7, then edited and re-ran cell 3, then deleted cell 5 whose variable cell 7 still depends on in memory. A reader who does "Restart Kernel and Run All" gets a `NameError` or, worse, a *different* answer. The execution-count numbers (`In [12]`) are the tell: if they're not monotonic 1,2,3…, the saved state doesn't correspond to a linear run. The defense is to treat **"Restart & Run All passes" as the only definition of a working notebook**, and enforce it in CI — execute the notebook headless with `nbconvert --execute`, `papermill`, `jupyter execute`, `nbmake` (a pytest plugin), or `treon`, which run every cell top-to-bottom in a fresh kernel and fail on any error. If it doesn't survive that, it isn't documentation; it's a screenshot of a session that no longer exists.

### Q5.2 — Beyond execution order, why do notebooks (and any executable doc) fail to reproduce months later?

> **Testing:** Whether you connect reproducibility to environment pinning, not just code.

**A.** Because the **environment isn't pinned**, so the *inputs* to the run silently changed:
- **Unpinned dependencies** — `pip install pandas` resolves to a newer version with changed behavior or a removed API; the notebook breaks though "nothing changed."
- **Python / runtime / OS / CUDA version drift** — kernel rebuilt on a new base image; a function's defaults or dtype handling moved.
- **External data** — a cell reads `s3://.../latest.csv` or hits a live API, so the "result" depends on data that mutated.
- **Hidden randomness** — no seed, so model training / sampling outputs differ each run.
- **Hardware/threading nondeterminism** — float reductions across GPU/threads aren't bit-identical.

The fix is the same discipline as any reproducible build: **pin everything that feeds the run.** Lock the dependency set (`requirements.txt` with hashes, `poetry.lock`, conda env export, or better, a pinned container image / `repo2docker`), pin the runtime version, *vendor or version the input data* instead of reading "latest," and set explicit seeds. Reproducibility is a property of the *whole environment*, not the code; an executable doc that doesn't pin its environment is reproducible only until the next `pip install`.

### Q5.3 — Notebooks are famously awful in version control and review. Why, and what do you do about it?

> **Testing:** Whether you know the JSON+output problem and the mitigations.

**A.** Two reasons. First, an `.ipynb` is a **JSON file that stores outputs inline** — including base64-encoded images, huge data frames, and execution metadata — so a one-line code edit produces a giant, unreadable diff, and the repo bloats with binary blobs and (sometimes) secrets baked into output. Second, that diff is *unreviewable*: you can't tell signal (a logic change) from noise (a re-rendered plot, a bumped execution count). Mitigations, in order of leverage: **strip outputs before commit** with `nbstripout` (a git filter) or `jupytext` so only code is versioned; **pair the notebook with a plain-text representation** (`jupytext` syncs `.ipynb` ↔ `.py`/`.md`, so review and diffs happen on the readable script); use a **notebook-aware differ** (`nbdime`) for the cases you must review as a notebook. The strategic version: many teams keep the *authored* logic in plain `.py` modules (tested normally) and use notebooks only as a thin *presentation* layer, precisely to dodge the review/VC pathologies while keeping the literate, runnable narrative.

---

## Theme 6 — Scenarios and Judgment

### Q6.1 — Your quickstart breaks on roughly every other release. Users complain, you patch it, it breaks again. Fix it permanently.

> **Testing:** Whether you reach for a mechanism or just promise to be more careful.

**A.** The permanent fix is to make a broken quickstart **unable to merge**, and the patch-and-repeat loop is the symptom of relying on humans to notice. Concretely:
1. **Turn the quickstart into an executed artifact.** Pull every snippet from real source via includes (so there's one copy), or extract-and-run the markdown's fenced blocks, or back the quickstart with a doctest/Example/golden transcript. The page must *run*, not just be proofread.
2. **Run it in CI on every PR**, against the *as-built* package — ideally install the package the way a user would (a fresh venv / clean container, the published artifact, not the dev tree) so it also catches packaging and import-path breaks.
3. **Make red block merge.** Now the rename that would have broken the quickstart fails the PR that introduces it, and the author fixes the doc *in the same change* — the break is caught at the source, not by a user weeks later.
4. **Pin the environment** so it doesn't break for reasons unrelated to your code (Q5.2).

The framing I'd give: stop treating quickstart rot as a *content* problem you fix repeatedly and start treating it as a *missing test* you add once. "Be careful" is a tax you'll eventually skip; a failing build is enforced for free.

### Q6.2 — Doc tests are now the single flakiest job in CI. People are adding `+SKIP` to make the build green. What do you do?

> **Testing:** Whether you fix the determinism root cause instead of disabling the signal.

**A.** First, name the anti-pattern: blanket `+SKIP` *deletes the signal* — a skipped doc test is an unverified example, i.e. exactly the rot we built this to prevent. So I don't normalize skipping. Instead:
1. **Triage the flakes by cause** (they cluster — see Q4.2): unordered output, floats, ids, time, locale, network. Most flaky doc tests are a handful of root causes repeated.
2. **Engineer determinism at the source:** sort before printing, format floats explicitly, inject a fixed clock and a fixed RNG seed, normalize ids/paths/timestamps in golden filters. This kills the flake *and* makes the example clearer.
3. **Use the right directive for genuine variability** — `+ELLIPSIS`/`Unordered output`/`+NORMALIZE_WHITESPACE` for parts that are legitimately variable, and `no_run`/`+SKIP` *only* for examples that hit the network or are inherently non-runnable, with a comment saying why.
4. **Quarantine, don't delete:** if a doc test is too unstable to fix immediately, move it to a separate, non-blocking job and file a ticket — visible debt, not silent skips.
5. **Push some examples down a layer:** if an example is rich enough to be flaky, maybe it shouldn't be a doc test at all — convert it to a normal unit test (assert on the value, not the text) and keep the *documentation* example minimal.

The principle: flaky doc tests are usually a *determinism bug in the example*, not a reason to stop checking examples.

### Q6.3 — Where would you deliberately *not* bother making docs executable?

> **Testing:** Judgment — whether you know the technique has a cost and a domain.

**A.** I'd skip it where the cost outweighs the rot risk or where it's infeasible:
- **Architecture/explanation/conceptual docs** — there's no code to run. A doc on "why we chose eventual consistency" has nothing to execute; forcing it would be theater.
- **Examples requiring expensive or external infrastructure** — a 30-minute GPU training run, a paid third-party API, a full Kubernetes cluster. Running these on every PR is slow, flaky, and costly; better to `no_run`/compile-only them (prove they *build*) and verify the real path in a periodic/nightly job, not per-PR.
- **Throwaway or rapidly-churning prototypes** — the rot horizon is shorter than the maintenance cost of the harness.
- **Inherently nondeterministic output that can't be normalized cheaply** — if pinning the output would distort the example into something unrepresentative, a screenshot plus a human-owned check may be more honest.
- **Inline snippets in marketing/landing pages** where a tiny, obviously-illustrative fragment ("```api.connect()```") isn't meant to be a complete program.

The judgment is **rot-risk × usage**: executable docs earn their keep for **load-bearing examples users copy** — quickstarts, README first-five-minutes, public API reference, SDK samples. They're overkill for prose that has nothing to assert. Spend the harness budget where a broken example actually burns a user.

### Q6.4 — A teammate wants 100% of code blocks across all docs to be executed in CI. Good idea?

> **Testing:** Whether you can resist a maximalist policy and reason about ROI and CI time.

**A.** Directionally good, dogmatically bad. The benefit curve is steep then flat: the first executable examples (quickstart, core API, the snippets users actually paste) eliminate the highest-impact rot. Forcing the *last* 100% — every illustrative one-liner, every conceptual fragment, every "pseudocode-ish" sketch — drags in the expensive long tail: network/infra examples that make CI slow and flaky, fragments that aren't complete programs, and conceptual snippets that were never meant to run. You also blow up CI time and turn doc-writing into a heavyweight chore, which *discourages* documentation. The mature policy: **executable-by-default for load-bearing examples, with an explicit, justified opt-out** (`no_run`/`ignore`/`+SKIP` *with a reason*) for the rest, and a periodic (not per-PR) job for the slow/external ones. Measure what matters — are user-facing examples verified? — not a vanity "100% of fenced blocks" number. A policy that makes people stop writing docs to avoid the tax is a net loss even at high coverage.

---

## Theme 7 — The Limit: Executable ≠ Good

### Q7.1 — An example compiles, runs, and passes its doc test. Is the documentation good?

> **Testing:** The most important caveat in the topic — runs vs teaches.

**A.** Not necessarily — "**runs**" and "**teaches**" are different properties, and executable docs only guarantee the first. A doc test proves the example is *correct and current*; it says nothing about whether it's *comprehensible, well-chosen, or pedagogically ordered*. You can have a perfectly green example that's useless: it demonstrates an obscure edge case instead of the common path, it's so loaded with setup boilerplate the actual point is buried, it uses meaningless names (`foo`, `bar`, `tmp`) that teach nothing, it shows *what* the call is but never *why* you'd make it, or it's technically the happy path but skips the one parameter every real user needs. CI is green; the reader is still lost. So executable docs solve **trust** (the example isn't lying) but not **clarity** (the example is illuminating). The second is a human editorial job — choosing the *right* example, naming things meaningfully, sequencing concepts, explaining the *why* — and no test catches its absence.

### Q7.2 — So how do you catch the failure executable docs *can't* — the "runs but doesn't teach" gap?

> **Testing:** Whether you know the human/process layer that complements the mechanism.

**A.** With the things a machine can't do: **human review for clarity, and real-user signal.** Concretely — doc review by someone who is *not* the author and ideally close to the target audience ("could a new hire follow this?"); **fresh-eyes / new-hire onboarding as a test** (have the next joiner do the quickstart cold and log every place they got stuck — those are doc bugs); usage telemetry and search analytics (which pages do people bounce off, what do they search for and not find); support-ticket and forum mining (every "how do I…" with a doc answer is a documentation gap, not a support gap); and dogfooding the SDK examples in a real sample app. These catch *comprehensibility and completeness*, which output-matching is blind to. The clean division of labor: **executable docs guarantee the example is true; humans and users guarantee it's useful.** A mature docs practice runs both layers and doesn't pretend the green build is the finish line.

### Q7.3 — Summarize the ceiling: what is the strongest claim you can make about a fully executable doc set?

> **Testing:** Whether you can state the guarantee *and* its boundary precisely.

**A.** The strongest honest claim is: **"Every example we ship compiles, runs, and produces the output we say it does, on every change."** That's a real and valuable guarantee — it eliminates silent rot, broken quickstarts, and lying reference material, which are the most common and most corrosive documentation failures. The boundary, stated just as precisely, is that it guarantees **correctness and currency, not comprehensibility, completeness, or good judgment about what to document.** Executable docs make your documentation *trustworthy*; they do not make it *good*. Good is the union of trustworthy (mechanism) and clear, well-chosen, well-explained (human craft). The candidate who states both halves — the guarantee and its ceiling — is the one who actually understands the technique rather than evangelizing it.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: What's the core idea of an executable doc in one line?** A: The example is simultaneously documentation a human reads and a test a machine runs, so a broken example fails the build instead of misleading a user.
- **Q: What does Go's `// Output:` comment do?** A: `go test` captures the example's stdout and asserts it equals the text after the comment; omit it and the example is compiled (proving it builds) but not run for output.
- **Q: How does a Rust doc test signal failure?** A: It panics — an `assert_eq!` (or a `?` returning `Err`) inside the `///` code block fails the test under `cargo test`.
- **Q: What's `doctest`'s matching model and its weakness?** A: It compares captured stdout/repr as a *string* against the expected REPL output — readable, but brittle to ordering, floats, addresses, and whitespace.
- **Q: Rust `no_run` vs `ignore` vs `compile_fail`?** A: `no_run` compiles but doesn't execute; `ignore` neither compiles nor runs; `compile_fail` asserts the code *fails* to compile.
- **Q: One way to make a doc test deterministic?** A: Sort collections before printing (or format floats explicitly, or inject a fixed clock/seed) so the output is stable across runs.
- **Q: What is a golden / snapshot test?** A: Record the full output as an approved file, then in CI diff actual against it; failures are fixed or the snapshot is re-approved.
- **Q: When is a golden test the right tool over a doctest?** A: For multi-step tutorials and CLI sessions, where you need to pin a whole transcript rather than one return value.
- **Q: Single source of truth for an HTTP API?** A: Make the OpenAPI spec authoritative, render docs from it, and contract-test the running server against it (or generate the spec from the code).
- **Q: What does generation give you and what does it *not*?** A: Accurate, complete reference (the *what*); not explanation, tutorials, or the *why* — those stay human-written.
- **Q: The one rule for a "working" notebook?** A: "Restart Kernel & Run All" passes from a clean state — enforced in CI via `nbconvert --execute`/`papermill`/`nbmake`.
- **Q: Why are `.ipynb` diffs unreviewable, and the fix?** A: They're JSON with inline outputs/images; strip outputs (`nbstripout`) or pair with a plain-text form (`jupytext`) and diff that.
- **Q: Executable doc that's green but bad — name a way.** A: It runs and asserts correctly but demonstrates an obscure path, buries the point in boilerplate, or never explains *why* — runs ≠ teaches.
- **Q: Where would you *not* make docs executable?** A: Pure conceptual/architecture prose (nothing to run) and examples needing expensive/external infra on every PR (run them nightly, compile-only per-PR).

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Fixing example rot with "we'll review more carefully" — reaching for discipline where only a mechanism scales.
- Thinking doc tests should replace unit tests, or chasing a coverage number with them.
- Not knowing that Go *runs* examples and Rust doc tests *panic-to-fail* — describing them as mere display snippets.
- Disabling flaky doc tests with blanket `+SKIP` instead of engineering determinism.
- Maintaining a hand-written OpenAPI file *and* a separate implementation with nothing tying them together.
- "We generated a Swagger UI, so the API is documented" — mistaking accurate reference for teaching.
- Claiming a green doc-test build means the docs are good — conflating *runs* with *teaches*.
- No mention of environment pinning when discussing notebook/reproducibility.

**Green flags:**
- Naming the *move* (example-as-test, generate-don't-duplicate, deterministic-or-it's-noise, runs-vs-teaches) before naming a tool.
- Getting the mechanism semantics right: stdout-match for doctest/Go, panic/`assert` for Rust, `// Output:` and `compile_fail` used correctly.
- Treating drift as a *missing test to add once*, not content to re-fix forever — and running examples against the *as-built* package.
- Framing single-source-of-truth as "one fact, two projections" and pairing generation with contract testing.
- Diagnosing flakiness by *root cause* (ordering, floats, time, ids) and fixing determinism at the source.
- Knowing the technique's ceiling and stating *both* halves — guarantees correctness/currency, not comprehensibility — and naming the human layer (fresh-eyes onboarding, telemetry) that fills the gap.
- Caveating where executable docs *don't* pay off (conceptual prose, expensive infra) instead of evangelizing 100% coverage.

---

## Summary

- The bank reduces to four moves in costumes: **example-as-test** (a broken example fails the build), **generate-don't-duplicate** (one fact projected into two views can't drift), **deterministic-or-it's-noise** (an executable example is only an asset if its output is stable), and **runs-vs-teaches** (green CI proves correct, not comprehensible). Name the move first; the tool follows.
- **Why:** executable docs kill *silent example rot* — the rename three months later that no reviewer diffs against the markdown. Discipline can't out-pace entropy; a failing build can.
- **Mechanisms:** Python `doctest` matches stdout/repr as text (readable, brittle); Go `Example` is a compiled function whose `// Output:` comment asserts stdout (and "compiles = passes" without it); Rust doc tests wrap `///` blocks in `fn main`, run them under `cargo test`, and **fail on panic**, with `no_run`/`ignore`/`compile_fail` for the edges; markdown is tested by *including tested source* or extract-and-run harnesses.
- **Single source of truth:** make the schema/spec authoritative and *project* docs from it — OpenAPI rendered to docs + contract-tested against the server, CLI help from the parser, schema docs from migrations. Generation owns *Reference*; humans own *Explanation/How-to/Tutorial*.
- **As a strategy:** doc tests are the *exemplar* layer (few, clean, happy-path), not the *coverage* layer; their brittleness is exact-output matching meeting nondeterminism (ordering, floats, ids, time, locale) — fix it by engineering determinism, and use golden/transcript tests for multi-step tutorials and CLI sessions.
- **Notebooks/literate docs:** the traps are hidden out-of-order state ("Restart & Run All" is the only definition of working) and unpinned environments (deps/runtime/data/seed) — enforce clean-kernel execution in CI and pin everything that feeds the run; strip outputs / use `jupytext` for sane diffs.
- **The limit:** executable ≠ good. The mechanism guarantees *correctness and currency*; it's blind to *comprehensibility, completeness, and choosing the right example*. Pair it with human review and real-user signal, and skip it where there's nothing to run or the infra cost dwarfs the rot risk.

---

## Further Reading

- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- Python `doctest` documentation and `pytest`'s `--doctest-modules` / `--doctest-glob` integration — the primary sources for the matching model and directives.
- The Go blog / `testing` package docs on **example functions** and `// Output:`; *The Go Programming Language* (Donovan & Kernighan), the testing chapter.
- *The Rust Programming Language* ("Documentation Comments as Tests") and the rustdoc book on doc-test attributes (`no_run`, `ignore`, `compile_fail`, hidden `#` lines).
- The mdBook documentation on `{{#include}}` / `{{#rustdoc_include}}`, and `nbmake`/`papermill`/`jupytext`/`nbstripout` docs for notebook reproducibility and versioning.
- The OpenAPI specification and contract-testing tools (Schemathesis, Dredd, Pact) — for the single-source-of-truth and API-contract answers.

---

## Related Topics

- [03 — Freshness and Rot Metrics](../03-freshness-and-rot-metrics/interview.md) — measuring *when* docs go stale, the metric layer behind "examples rot."
- [04 — Docs Coverage and Gaps](../04-docs-coverage-and-gaps/interview.md) — finding the *un*documented and *un*tested surface that executable docs should grow to cover.
- [Documentation Quality README](../README.md) — where testable docs sit in the broader documentation-quality landscape.
- [Quality Engineering README](../../README.md) — the testing-strategy framing that doc tests, golden tests, and contract tests plug into.
