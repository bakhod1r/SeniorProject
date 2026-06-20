# Testable & Executable Docs — Senior Level

> **Roadmap:** [Documentation Quality](../README.md) → Testable & Executable Docs
> *The professional page showed you the tools — doctests, Go examples, rustdoc, a link checker in CI. This page is about architecture: how to design a documentation system so that a doc and the thing it describes* **cannot diverge by construction** *, what the failure modes of that design are, and the hard truth at the end — that you can mechanically prove an example* runs *, never that it* teaches *.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Single Source of Truth — Generate, Don't Duplicate](#single-source-of-truth--generate-dont-duplicate)
4. [Contract & Consumer-Driven Testing as Doc Assurance](#contract--consumer-driven-testing-as-doc-assurance)
5. [Doc Tests as a Testing Strategy — and Its Trade-offs](#doc-tests-as-a-testing-strategy--and-its-trade-offs)
6. [Golden & Transcript Testing for CLIs and Tutorials](#golden--transcript-testing-for-clis-and-tutorials)
7. [Literate Programming & Notebooks — Executable, Not Reproducible](#literate-programming--notebooks--executable-not-reproducible)
8. [Architecting a Docs Pipeline That Fails Closed](#architecting-a-docs-pipeline-that-fails-closed)
9. [The Limits — Executable Is Not Correct, and Correct Is Not Good](#the-limits--executable-is-not-correct-and-correct-is-not-good)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Architecting documentation so correctness is mechanically guaranteed — at system scale, not one snippet at a time.**

By the professional level you can make an individual doc verifiable: a fenced snippet runs in CI, a Go `Example` function asserts its own output, rustdoc compiles every code block, a link checker fails the build on a 404. That stops *those* artifacts from rotting. The senior jump is to stop treating verification as a per-snippet retrofit and start treating it as a *property of the system*. You ask a different question: not "is this example tested?" but "**is it structurally possible for this doc to be wrong?**" — and if the answer is "yes, someone would just have to forget to update it," you redesign so the answer becomes "no."

That redesign has a name in disguise: it is the same single-source-of-truth, fail-closed, contract-tested thinking you already apply to code, pointed at prose. The function signature in the docs is *generated from the function*. The API reference is *generated from the spec the server validates against*. The CLI's usage text is *generated from the argument parser the CLI actually runs*. The example in the tutorial is *replayed against a real service in CI*, and if the service's behavior changed, the contract test for the doc goes red. Documentation drift stops being a discipline problem (remember to update the docs) and becomes a build problem (the build won't go green until you do).

This page is that architecture — its patterns, its real pipelines, its sharp edges (notebooks that "work on my machine," doc tests that bloat the suite, golden files that ossify), and the boundary it can never cross.

---

## Prerequisites

- **Required:** You've internalized [professional.md](professional.md) — you can wire doctests, Go testable examples (`func Example…` with `// Output:`), rustdoc tests, and a link checker into CI, and you know why each one passes or fails.
- **Required:** You understand contract testing at least in outline — the [api-testing](../../code-coverage/) family of ideas: provider/consumer, schema validation, Pact-style verification.
- **Required:** Comfort with CI as a gate — required checks, fail-closed vs fail-open, caching, and why a flaky gate is worse than no gate.
- **Helpful:** You've owned an API with a published OpenAPI/proto spec, and felt the gap between "the spec says X" and "the server does Y."
- **Helpful:** You've debugged a Jupyter notebook that ran top-to-bottom for the author and threw `NameError` for everyone else.

---

## Single Source of Truth — Generate, Don't Duplicate

The root cause of nearly all doc drift is the same as the root cause of nearly all code bugs: **duplicated state with no mechanism to keep the copies in sync.** A function's signature lives in the code *and* is retyped in the reference docs. An endpoint's request shape lives in the server's validation *and* is retyped in the API guide. A CLI's flags live in the argument parser *and* are listed by hand in the man page. Each duplicate is a fact that can silently disagree with its source the instant either side changes — and prose has no compiler to catch it.

The senior move is to **eliminate the duplicate, not police it.** Pick the artifact that is *already verified by something else* and generate the doc *from* it. Now the doc cannot diverge, because there is only one copy of the fact.

The choice of source artifact is the whole design decision. Rank candidates by how strongly they're already checked:

| Doc fact | Generate from | Already verified by |
|---|---|---|
| Function signatures, types, docstrings | the source code (godoc, rustdoc, TypeDoc, Sphinx autodoc) | the compiler / type checker |
| REST request/response shapes, status codes | the OpenAPI spec the server validates against | request validation + contract tests |
| gRPC messages and services | the `.proto` files | the protobuf compiler + the wire format |
| CLI usage, flags, defaults | the argument parser (`cobra`, `clap`, `argparse`) | the program that actually parses them |
| Config keys, types, defaults | the config schema (JSON Schema, a struct with tags) | schema validation at startup |
| Example outputs in tutorials | a real run captured in CI | the run itself (golden/transcript tests) |

> **Key insight:** The strength of a generated doc equals the strength of the check on its *source*. Generating the API reference from a hand-maintained OpenAPI file that nobody validates against the server is theater — you've moved the drift, not removed it. Generation only buys correctness when the source is the same artifact the *running system* depends on. Always trace the generated fact back to the thing that would break if it were wrong.

A worked example: the *spec-first* server, where one OpenAPI document is simultaneously (a) the server's request/response validator, (b) the source of the published reference docs, and (c) the contract the client SDK is generated from.

```yaml
# openapi.yaml — the single source of truth
paths:
  /widgets/{id}:
    get:
      operationId: getWidget
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200':
          description: The widget
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Widget' }
        '404': { description: No widget with that id }
```

```bash
# 1. The SERVER enforces this spec at runtime (drift = a failing request in tests)
#    e.g. express-openapi-validator / connexion / a Go middleware that validates
#    every request+response against openapi.yaml.

# 2. The DOCS are generated from the same file (drift is impossible — same source)
redoc-cli build openapi.yaml -o public/api.html
#   or: npx @redocly/cli build-docs openapi.yaml

# 3. The CLIENT SDK is generated from the same file (so the SDK examples match too)
openapi-generator-cli generate -i openapi.yaml -g typescript-axios -o sdk/
```

The same pattern for the CLI, where the parser *is* the spec:

```bash
# cobra: the command tree that runs IS the command tree documented
mytool gen-docs --output ./docs/cli   # cobra/doc emits one .md per command from the live parser
# clap (Rust): clap_mangen / clap_complete derive man pages + completions from the #[derive(Parser)] struct
# Python: sphinx-argparse renders the live argparse parser into the reference
```

When you generate CLI docs from the parser, a new `--retries` flag *appears in the docs the moment it appears in the code*, with its real default and help text, because both are reads of the same `Flags()` registration. There is no second place to forget.

The discipline this imposes on a team is subtle but important: **the source artifact must carry enough metadata to render good prose.** A bare `type` and field name make a thin reference. So single-source-of-truth pushes documentation *into* the code and schema — doc comments on struct fields, `description` on every OpenAPI property, help strings on every flag. The docs improve because the only way to improve them is to enrich the verified source. (This is where it meets [Code Craft → Documentation](../../../code-craft/documentation/): *what* to write in those doc comments is that roadmap's subject; *that they're the single source* is this one's.)

---

## Contract & Consumer-Driven Testing as Doc Assurance

Single-source generation guarantees the docs match the *spec*. It does **not** guarantee the spec matches the *running service* — and a perfectly-rendered reference for an endpoint the server no longer implements that way is worse than no docs, because it's confidently wrong. Closing that last gap is what contract testing does, and reframing it as *documentation assurance* is the senior insight: **the API your docs describe is the API your contract tests verify against the live service. Doc drift becomes a failing contract test.**

There are two complementary mechanisms.

**Spec-validation testing** asserts the running provider conforms to the spec the docs are built from. You replay the spec's own examples and schema against a real (or test-instance) server, in CI:

```bash
# Dredd: read openapi.yaml, fire each documented request at a running server,
#        assert the real response matches the documented status + schema.
dredd openapi.yaml http://localhost:8080
#   → if the server now returns 422 where the spec (and docs) say 400, this FAILS.

# Schemathesis: property-based — generates many inputs from the spec and checks
#        the server never violates its own documented contract.
schemathesis run openapi.yaml --base-url http://localhost:8080 --checks all
```

The moment the server's behavior diverges from the documented contract, this gate goes red — *before* the wrong docs ship. The doc is no longer a static claim; it's an assertion under continuous test.

**Consumer-driven contract testing (Pact-style)** flips the direction and answers a question pure spec-validation can't: *which* documented behaviors are actually depended on. Each consumer records the requests it makes and the responses it needs; those expectations become a contract the provider must satisfy:

```
consumer test run ──► writes a pact (consumer's real expectations)
                          │
                     published to a broker
                          │
provider CI ──► "can I deploy?" ──► replays every consumer pact against the provider
                          │
            green = no consumer's documented assumption is broken
```

```bash
# Provider side, in CI, before deploy:
pact-provider-verifier \
  --provider-base-url http://localhost:8080 \
  --pact-broker-url https://broker.internal \
  --provider-app-version "$GIT_SHA"
# can-i-deploy gate: refuse to ship if any consumer contract would break
pact-broker can-i-deploy --pacticipant widget-service --version "$GIT_SHA" --to-environment production
```

> **Key insight:** Spec-validation and consumer-driven testing protect different doc failures. Spec-validation catches *"the docs describe behavior the server no longer has."* Consumer-driven contracts catch *"a behavior the docs/spec quietly dropped is one a real client depends on."* The first keeps the reference honest; the second keeps you from documenting away something load-bearing. A mature API docs program runs both, and treats a red contract as a documentation incident, not just a test failure.

The organizational payoff is that "the docs are wrong" stops being a bug report a human files weeks later and becomes a CI signal the author gets in minutes. That is the entire game: move the detection of drift from *human, eventually* to *machine, immediately* — the same shift [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/senior.md) makes for staleness, here for *correctness*.

---

## Doc Tests as a Testing Strategy — and Its Trade-offs

A senior owns the *test suite* as a whole, so the question isn't "can docs be tested?" (yes) but "**when are doc tests the right tool, and when do they quietly degrade the suite?**" Doc tests — doctests, Go examples, rustdoc tests — are a real and unusual category: their *primary* purpose is to teach, and their test value is a side effect. That dual nature is exactly their trade-off profile.

What they're genuinely good at:

- **Guaranteeing the example is real.** A copy-pasteable snippet that's in the test suite *cannot* be subtly broken; the canonical Python win is `>>> ` examples checked by `doctest`, and Go's `Example` functions that are both godoc examples *and* `go test` cases.
- **Documenting behavior at the call site,** where a reader looking at the function also sees a verified usage.
- **Catching signature/behavior drift in the public API** — if you rename a parameter, the example stops compiling.

Where they go wrong — and why a senior rations them:

- **They're integration-ish and slow.** A doctest often needs more setup than its one assertion justifies; a suite of hundreds runs the doc machinery (parse, build an environment, execute, diff text) for each. They are not unit tests and shouldn't be treated as the bulk of your fast feedback loop.
- **They're brittle on *exact output*.** `doctest` and Go's `// Output:` compare stdout *textually*. A map printed in nondeterministic order, a timestamp, a pointer address, a float's last digit, a `0x…` id — any of these makes the test flake or fail for reasons that have nothing to do with the code being wrong. (Go's `// Unordered output:` exists *precisely* because map ordering broke too many examples.)
- **They invite over-fitting.** To make the output deterministic, authors trim the example down to something artificial — and now it passes CI but no longer resembles real usage. The test value and the teaching value start to fight.

The senior rule is to keep doc tests **minimal and deterministic, and to use them for the public surface, not as a general test strategy.** Make the example small enough that its output is obviously stable; push everything that needs real fixtures, edge cases, and exhaustive assertions into ordinary unit/integration tests.

```python
def chunk(seq, n):
    """Split seq into lists of length n (last may be shorter).

    >>> chunk([1, 2, 3, 4, 5], 2)
    [[1, 2], [3, 4], [5]]
    >>> chunk([], 3)
    []
    """
    return [seq[i:i + n] for i in range(0, len(seq), n)]
# `python -m doctest -v module.py` — the docstring is now executable, tested documentation.
# Note what was AVOIDED: no dict in the output (order!), no float, no object repr.
```

```go
// Deterministic by construction — the example teaches AND tests.
func ExampleChunk() {
    fmt.Println(Chunk([]int{1, 2, 3, 4, 5}, 2))
    // Output: [[1 2] [3 4] [5]]
}
// If Chunk's output depended on map iteration, you'd use `// Unordered output:`
// — a signal that the example is fighting nondeterminism, often a smell.
```

> **Key insight:** Doc tests are *first* documentation and *second* tests — so optimize them for the reader and accept the testing they give you as a bonus, never the reverse. The failure mode of treating them as a serious test strategy is a slow, flaky suite full of artificially-trimmed examples that teach badly *and* test badly. Right tool: one or two clean examples on each public function. Wrong tool: edge-case coverage, anything needing heavy fixtures, anything whose output isn't trivially deterministic.

This is the same coverage-trap lesson from [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/senior.md), aimed at the test suite: a high *count* of doc tests is not a goal. A small number of clean, deterministic, genuinely illustrative ones beats a wall of brittle ones, exactly as a few good integration tests beat a thousand redundant unit tests in [Code Coverage](../../code-coverage/).

---

## Golden & Transcript Testing for CLIs and Tutorials

Some documentation isn't a single snippet with one output — it's a *walkthrough*: a CLI session, a getting-started tutorial, a sequence of commands whose whole point is the end-to-end experience. Asserting each line by hand is hopeless. The technique is **golden (a.k.a. snapshot or approval) testing**: run the real thing, capture its entire output, and on every subsequent run *diff against the recorded "golden" file*. The test passes if output is byte-identical; it fails by *showing you the diff*, and you either fix the code or, if the change is intended, re-record.

For a CLI, this means recording a whole transcript — commands and their outputs — and replaying it:

```bash
# A transcript fixture: input commands interleaved with expected output.
$ mytool init demo
Created project "demo"
$ mytool add task "write docs"
Added task #1: write docs
$ mytool list
[ ] #1  write docs
```

Tools that automate exactly this record-and-verify loop for command-line docs and tutorials:

- **`cram` / `prysk`** — the transcript above *is* the test; the tool runs each `$` line and checks the following lines match. This is how Mercurial tests much of its CLI, and it doubles as runnable documentation.
- **Go `golden` files** — the standard Go idiom: compare output to `testdata/*.golden`, with a `-update` flag to re-record.
- **`insta` (Rust), `jest` snapshots, `syrupy` (Python)** — inline or file snapshots with a review/accept workflow.

```go
// The canonical Go golden pattern: one flag toggles "verify" vs "re-record".
var update = flag.Bool("update", false, "update golden files")

func TestTutorialOutput(t *testing.T) {
    got := runTutorialStep(t)                  // run the real command path
    golden := filepath.Join("testdata", t.Name()+".golden")
    if *update {                               // `go test -update` re-records
        os.WriteFile(golden, got, 0o644)
    }
    want, _ := os.ReadFile(golden)
    if !bytes.Equal(got, want) {
        t.Errorf("output drifted from golden:\n%s", diff(want, got)) // SHOW the diff
    }
}
```

Golden testing's superpower for docs is that **it makes the entire tutorial a single regression test.** Change the `init` banner and forget to update the getting-started guide, and the golden test fails with a precise diff of the exact lines that drifted. The tutorial cannot silently lie about what the tool prints.

Its failure modes are the mirror image of that power, and a senior manages them deliberately:

- **Over-broad goldens ossify.** If you snapshot output containing timestamps, durations, temp paths, version strings, or random ids, every benign run fails. **Normalize before comparing** — scrub volatile fields to placeholders (`<TIMESTAMP>`, `/tmp/<RANDOM>`) so the golden captures *structure*, not noise.
- **Rubber-stamped updates defeat the test.** If `-update` becomes a reflex (`output changed → re-record → commit`), the golden stops asserting anything. The review of a golden diff *is the test*; treat a changed golden in a PR like a changed assertion — it must be read and justified, not blindly accepted.
- **Huge goldens are unreviewable.** A 2,000-line snapshot that nobody can meaningfully diff is theater. Keep each golden small and focused, like any good assertion.

> **Key insight:** A golden test's value lives entirely in someone *reading the diff*. The technique converts "did this walkthrough still work?" into "is this diff intended?" — which is only a real check if the answer is actually considered. Normalize away nondeterminism so the only diffs that ever appear are *meaningful* ones; then a green golden suite is a genuine guarantee that every documented session still produces what the docs claim.

---

## Literate Programming & Notebooks — Executable, Not Reproducible

Literate programming (Knuth's idea: a document that *is* the program, prose and code woven together) and its modern mass-market form — computational notebooks (Jupyter, Quarto, Observable, R Markdown) — are the most *executable* documentation there is: the narrative and the runnable code are the same file. For data work, ML, and analysis tutorials they're often the right medium. But a senior must internalize one hard distinction the format actively hides: **executable is not reproducible.** A notebook that ran for the author can fail, or worse *silently produce different results*, for everyone else. The traps are structural, not incidental.

**Hidden, out-of-order state.** A notebook's cells share one long-lived kernel, and you can run them in *any* order — then re-run some, then delete a cell whose variable is still bound in the kernel. The saved `.ipynb` shows cells `[1], [2], [3]`, but the author may have executed `3, 1, 2, 1` and deleted the cell that defined `df`. The document is a *lie about its own execution order*. The only defense is **"restart kernel and run all"** as the definition of "does this notebook work" — and enforcing it in CI:

```bash
# Execute top-to-bottom in a FRESH kernel; non-zero exit if any cell errors.
jupyter nbconvert --to notebook --execute --ExecutePreprocessor.timeout=120 nb.ipynb
#   This is the ONLY honest test of a notebook. "It ran for me" with a warm kernel proves nothing.
papermill nb.ipynb out.ipynb -p date 2024-01-01   # parameterized, fresh-kernel execution

# Strip outputs before commit so the repo stores INPUTS, not stale rendered state:
nbstripout --install        # git filter: never commit cell outputs / execution counts
# (otherwise diffs are noise and the committed outputs drift from what the code now produces)
```

**Nondeterministic outputs.** Notebooks routinely embed results that aren't stable: `df.head()` after a shuffle, an unseeded model's metrics, a plot whose legend order depends on a dict, "today's" date, a sampled subset. Commit those as the canonical output and every reader sees a mismatch. The fix is the same determinism discipline as doc tests and goldens — **seed every RNG, pin "now" to a fixed date, sort before display** — plus *not committing outputs at all* and instead re-rendering them in CI from a fixed seed.

**Unpinned environment.** "Works on my machine" is the notebook's native failure. The code is identical; the pandas version isn't, and a default changed. Reproducibility requires **environment pinning** travel with the document: a lockfile (`requirements.txt` with hashes, `poetry.lock`, `conda-lock`, `uv.lock`), ideally a container, and for true bit-reproducibility, pinned data and library versions. Tools like **Quarto** and **Jupyter Book** lean into this by rendering the notebook *in CI from pinned deps*, so the published artifact is provably the output of the stated code + stated environment.

```yaml
# A reproducible notebook-as-docs pipeline (CI)
- run: pip install -r requirements.lock        # PINNED, hashed deps
- run: jupyter nbconvert --to notebook --execute --inplace tutorials/*.ipynb   # fresh kernel, fails on error
- run: quarto render                            # render to HTML from the just-executed, pinned run
# Result: the PUBLISHED tutorial is, by construction, the output of this exact code in this exact env.
```

> **Key insight:** A notebook's saved outputs are a *claim* about what its code produces, and the format makes that claim trivially false — through stale kernels, out-of-order execution, and unpinned environments. The discipline that makes a notebook trustworthy documentation is to stop trusting the file and re-derive it: **fresh kernel, top to bottom, seeded, pinned, in CI.** If you can't reproduce it that way, it isn't documentation — it's a screenshot with extra steps.

---

## Architecting a Docs Pipeline That Fails Closed

The individual techniques above are necessary but not sufficient; what makes them *systemic* is wiring them into a pipeline that **fails closed** — one where a broken example, an unresolved link, or a drifted API response *blocks the merge*, the same way a failing unit test does. "Fail open" (warn, but ship anyway) is how every docs-quality initiative dies: warnings are ignored, drift accumulates, and within a quarter the checks are noise. The senior deliverable is a gate, not a report.

A complete fail-closed docs pipeline has these stages, each a *required* check:

```
                         ┌─────────────────────────────────────────────┐
   PR opened ──►         │  1. BUILD: docs site builds with zero errors │
                         │     (broken include / bad ref = hard fail)   │
                         ├─────────────────────────────────────────────┤
                         │  2. SNIPPETS COMPILE/RUN: every fenced code  │
                         │     block extracted & executed (mdBook test, │
                         │     rustdoc, doctest, embedded-code checks)   │
                         ├─────────────────────────────────────────────┤
                         │  3. API EXAMPLES REPLAYED: documented        │
                         │     requests fired at a REAL test server     │
                         │     (Dredd/Schemathesis) — drift = red       │
                         ├─────────────────────────────────────────────┤
                         │  4. LINKS RESOLVE: internal + external link  │
                         │     check (lychee/htmltest) — 404 = red      │
                         ├─────────────────────────────────────────────┤
                         │  5. GENERATED DOCS MATCH SOURCE: regenerate  │
                         │     CLI/API/config docs; `git diff` must be  │
                         │     empty (stale generated doc = red)        │
                         └─────────────────────────────────────────────┘
   all green ──► merge allowed ; any red ──► merge blocked
```

The most underused stage is **#5 — the "regenerate and diff" gate**, which is what actually *enforces* single-source-of-truth. Generation alone doesn't help if someone hand-edits the generated file or forgets to re-run the generator. The pattern: regenerate in CI, then fail if the working tree changed.

```bash
# Enforce that committed generated docs are up to date with their source.
make docs-generate                       # re-run godoc/cobra-doc/openapi→md/config→md
if [ -n "$(git status --porcelain docs/generated)" ]; then
  echo "::error::Generated docs are stale. Run 'make docs-generate' and commit."
  git --no-pager diff docs/generated     # show exactly what drifted
  exit 1
fi
```

Two stages need a *running service*, and getting that right is the difference between a real gate and a flaky one. Stage 3 must spin up an actual instance (a container, a test server) and replay the documented calls against it — verifying an example *against a live server*, not a mock, because a mock is just another copy of the spec that can drift:

```yaml
# CI: replay documented API examples against a REAL server instance
services:
  api: { image: widget-service:${{ github.sha }}, ports: ['8080:8080'] }
steps:
  - run: ./scripts/wait-for http://localhost:8080/healthz
  - run: schemathesis run openapi.yaml --base-url http://localhost:8080 --checks all
  - run: dredd openapi.yaml http://localhost:8080   # every documented request, real response
```

Two design rules keep the gate from rotting:

- **Determinism is a precondition, not a nice-to-have.** A fail-closed gate is only viable if it's *not flaky* — one false red and the team starts merging past it ("the docs check is always broken"), which is functionally fail-open. Everything above (normalized goldens, seeded notebooks, pinned envs, deterministic doc-test output) exists so this gate can be trusted enough to *block on*.
- **External links are the eternal flake source** (sites go down, rate-limit, 403 bots). Split the link check: **internal links fail closed** (you control them; a broken cross-reference is a real bug), **external links run with retries/caching and on a schedule**, reported but not blocking on the critical path. `lychee --cache` plus an allowlist is the usual compromise.

> **Key insight:** "Fail closed" is the entire difference between a docs-quality *system* and a docs-quality *aspiration*. A report that drift exists changes nothing; a *gate* that won't let drift merge changes everything — but a gate you can't trust (flaky, slow, false-positive) gets routed around and is worse than none. So the architecture is two coupled commitments: **block the merge on doc correctness, and earn the right to do so by making every check deterministic.**

---

## The Limits — Executable Is Not Correct, and Correct Is Not Good

Everything above is powerful and seductive — and a senior's most important contribution is knowing exactly where it stops. There are two distinct walls, and conflating them is a classic mistake.

**Wall one: executable ≠ correct.** A passing doc test proves the snippet *runs and produces the asserted output*. It does **not** prove the snippet does something *useful*, *idiomatic*, or *representative*. You can have a green example that:

- demonstrates an *anti-pattern* (it compiles and "works," but no one should write code that way);
- is trivially artificial — trimmed until its output went deterministic, now bearing no resemblance to real usage;
- asserts the *wrong* behavior confidently (the code and the example are consistently broken — the test is green because both agree, like a unit test that codifies a bug);
- shows the *happy path only*, while every real caller hits the error handling the example omits.

Mechanical verification checks *consistency between the example and the code*, not *fitness of the example for a human's purpose*. Green means "not lying about the output," nothing more.

**Wall two: correct ≠ good.** Even a correct, idiomatic, representative example can sit in documentation that *fails to teach*: it's findable by no one, it's at the wrong altitude for the audience, it explains *what* the code does (which the reader can see) instead of *why* and *when* to use it, it has no narrative connecting the snippets, it answers a question nobody asked. None of that is detectable by any pipeline in this page. A docs suite can be 100% green and still be bad documentation.

This is precisely the boundary [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/senior.md) and [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/senior.md) live next to, and why "what makes docs *good*" is a separate topic of its own: the qualities that *matter most* — clarity, audience-fit, the right information at the right moment, "did the reader succeed?" — are the ones machines can't check.

> **Key insight:** Mechanical verification eliminates one specific, important failure mode — *the doc that lies* — and *only* that one. It says nothing about whether the doc is clear, well-placed, idiomatic, or useful. Treat executable-docs infrastructure as a *floor*, not a *ceiling*: it frees human review to stop checking "does this still compile?" and spend its attention on "does this actually help someone?" The danger is the green-suite mirage — concluding the docs are *good* because they're *verified*. They're not the same property, and the one that matters more has no CI check. (This is the documentation twin of [Code Coverage → What Coverage Does Not Tell You](../../code-coverage/): high coverage and green doc tests both certify *exercise*, never *value*.)

---

## Mental Models

- **The single-copy rule.** Every fact that lives in two places will eventually disagree. The cure for doc drift is the cure for any duplicated state: delete the copy and *generate* it from the one source that's already verified. A doc you generated from tested code cannot lie about that code.

- **Strength flows from the source.** A generated doc is exactly as trustworthy as the check on its source artifact. Generating from a spec nobody validates against the server moves the drift; it doesn't remove it. Always trace the fact back to "what would break if this were wrong?"

- **Drift detection: human-eventually → machine-immediately.** Every technique here is the same move — convert "a person will notice the docs are wrong, someday" into "CI is red, now." Contract tests do it for API correctness; golden tests for tutorials; regenerate-and-diff for generated docs; freshness metrics ([03](../03-freshness-and-rot-metrics/senior.md)) for staleness.

- **Determinism is the tax on automated docs.** Doc tests, goldens, and notebooks all break on nondeterministic output. The price of a *trustworthy* fail-closed gate is paid in seeds, fixed clocks, sorted output, pinned environments, and normalized snapshots. Skip the tax and your gate flakes, gets ignored, and dies.

- **A notebook's outputs are a claim, and the format makes it easy to lie.** Stale kernels, out-of-order execution, and unpinned deps mean the saved cells may not be what the code produces. Trust only "restart, run all, seeded, pinned, in CI."

- **Executable is a floor, not a ceiling.** Verification kills exactly one failure mode — the doc that lies about output. Clarity, audience-fit, findability, and "did it teach?" are untouched by any pipeline, and they're the properties that matter most.

---

## Common Mistakes

1. **Generating docs from an unverified source.** Rendering a beautiful API reference from a hand-maintained OpenAPI file that the server doesn't validate against just relocates the drift into the spec. Generation only buys correctness when the source is the artifact the *running system* depends on. Pair generation with a spec-validation contract test.

2. **Treating doc tests as a general test strategy.** Doc tests are *documentation first*. Loading them with edge cases, heavy fixtures, and exhaustive assertions yields a slow, brittle suite of artificially-trimmed examples that teach badly and test badly. Keep them minimal and deterministic; put real testing in unit/integration tests.

3. **Snapshotting nondeterministic output into goldens.** Timestamps, durations, temp paths, random ids, version strings, and unordered maps make every benign run fail. Normalize volatile fields to placeholders *before* comparing, so the only diffs that appear are meaningful.

4. **Rubber-stamping golden updates.** If `-update` / "accept snapshot" is a reflex, the golden asserts nothing. The *review of the diff* is the test — treat a changed golden like a changed assertion that must be read and justified.

5. **Committing notebook outputs and trusting them.** Saved cells lie under out-of-order execution and warm kernels. Strip outputs from version control (`nbstripout`), and define "works" as restart-and-run-all in a fresh, pinned kernel in CI.

6. **Building the docs pipeline to fail open.** A check that warns but lets the merge proceed is ignored within a quarter. Make snippet-compilation, internal links, API-example replay, and regenerate-and-diff *required* checks that block the merge.

7. **Validating API examples against a mock instead of a real server.** A mock is just another copy of the spec — it can drift from the real service exactly like the docs can. Replay documented requests against an actual running instance in CI.

8. **The green-suite mirage — concluding verified docs are good docs.** Mechanical checks certify the docs don't *lie about output*; they say nothing about clarity, audience-fit, or whether anyone can find or learn from the page. Don't let a green pipeline end the conversation about quality.

---

## Test Yourself

1. Doc drift and code bugs share a root cause. Name it, and state the structural fix that single-source-of-truth applies.
2. You generate your API reference from an OpenAPI file. What additional check is required before that reference can be trusted as *correct*, and why isn't generation alone enough?
3. Distinguish what *spec-validation testing* (Dredd/Schemathesis) catches from what *consumer-driven contract testing* (Pact) catches, in terms of documentation failures.
4. Give two reasons doc tests are the wrong tool for edge-case coverage, and state what they *are* the right tool for.
5. A golden test for your getting-started tutorial fails on every run even though the tool works. What's the most likely cause and the fix? Separately, what makes a golden test *worthless* even when it passes?
6. Why is a Jupyter notebook that "ran fine for me" not evidence that the notebook works? Name the three structural traps and the single CI command that addresses the first one.
7. What does "fail closed" mean for a docs pipeline, and why is determinism a *precondition* for it rather than a separate concern?
8. Your entire docs test suite is green. State precisely what that does and does not prove about documentation quality.

<details>
<summary>Answers</summary>

1. **Duplicated state with no sync mechanism** — the same fact stored in two places (code *and* prose) that can silently disagree when either changes; prose has no compiler to catch it. Single-source-of-truth *eliminates the duplicate*: generate the doc from the one verified source (code, spec, parser, schema) so there is only one copy of the fact and divergence is impossible by construction.
2. A **spec-validation / contract test** that replays the spec against a *running* server (Dredd, Schemathesis) — and, ideally, consumer-driven contracts. Generation only guarantees the docs match the *spec*; it can't guarantee the *spec* matches the *running service*. A perfectly-rendered reference for behavior the server no longer has is confidently wrong, so you must verify the spec against the live service in CI.
3. **Spec-validation** catches *"the docs describe behavior the server no longer has"* — it asserts the running provider conforms to the documented contract. **Consumer-driven contracts** catch *"a documented/spec behavior that was quietly dropped is one a real client depends on"* — they encode actual consumer expectations and fail the provider if it breaks them. First keeps the reference honest; second stops you documenting away something load-bearing.
4. (a) They're **integration-ish and slow** — each runs the doc machinery (parse, build env, execute, diff text), so they're poor fast feedback. (b) They're **brittle on exact textual output** — nondeterminism (map order, timestamps, floats, ids) flakes them, and forcing determinism over-fits the example into something artificial. They *are* the right tool for one or two minimal, deterministic, illustrative examples on each **public-API** function — guaranteeing the example is real and catching signature/behavior drift.
5. Most likely the golden captured **nondeterministic output** (timestamp, duration, temp path, random id, version, unordered map); fix by **normalizing volatile fields to placeholders** (`<TIMESTAMP>`, `/tmp/<RANDOM>`) before comparing. A passing golden is **worthless when its updates are rubber-stamped** — if `-update`/"accept" is reflexive, the golden no longer asserts anything; the *review of the diff* is the actual test.
6. Because a notebook's saved state is a **claim that's easy to falsify**: (1) **hidden/out-of-order execution state** — cells share a long-lived kernel run in any order, so saved counts lie about real order; (2) **nondeterministic outputs** — unseeded RNGs, shuffles, "today", sampling; (3) **unpinned environment** — same code, different library versions/defaults. "Restart kernel and run all" is the only honest test; in CI: `jupyter nbconvert --to notebook --execute …` in a fresh kernel (non-zero exit on any cell error) addresses the first.
7. **Fail closed** = a broken snippet, unresolved internal link, drifted API example, or stale generated doc *blocks the merge* (a required check), rather than emitting a warning that ships anyway. **Determinism is a precondition** because a flaky gate produces false reds; the first false red trains the team to merge past it, which makes the gate functionally fail-open. You can only *block* on a check you can *trust*.
8. It proves exactly one thing: the docs **don't lie about output** — every snippet compiles/runs, every documented API call matches a real response, every link resolves, generated docs match source. It proves **nothing** about clarity, audience-fit, findability, idiomaticity, narrative, or whether anyone can actually *learn* from the page. Executable ≠ correct (a green example can be an anti-pattern or assert a shared bug); correct ≠ good (the property that matters most has no CI check).

</details>

---

## Cheat Sheet

```
SINGLE SOURCE OF TRUTH (generate, don't duplicate)
  signatures/types   → godoc / rustdoc / typedoc / sphinx-autodoc   (checked by: compiler)
  REST shapes        → OpenAPI the SERVER validates against → redoc/redocly  (checked by: contract tests)
  gRPC               → .proto → protoc-gen-doc                      (checked by: wire format)
  CLI usage/flags    → the arg parser (cobra/clap/argparse)         (checked by: the running program)
  config keys        → JSON Schema / struct tags                    (checked by: startup validation)
  rule: a generated doc is only as trustworthy as the CHECK ON ITS SOURCE.

CONTRACT TESTING AS DOC ASSURANCE (docs drift → red CI)
  dredd openapi.yaml http://localhost:8080          replay documented requests at REAL server
  schemathesis run openapi.yaml --checks all        property-based spec conformance
  pact-broker can-i-deploy ...                       consumer-driven: don't break a real client
  spec-validation = "server lost a documented behavior"; pact = "dropped behavior is depended on"

DOC TESTS (documentation FIRST, tests second — keep minimal + deterministic)
  python -m doctest -v mod.py      Go: func Example…(){ … // Output: }      rustdoc: ``` blocks
  AVOID in examples: maps (order), floats, timestamps, object reprs, ids   (use // Unordered output: as last resort)
  right tool: 1-2 clean examples per public fn   wrong tool: edge cases / heavy fixtures

GOLDEN / TRANSCRIPT (record-and-verify whole walkthroughs)
  cram / prysk           CLI transcript IS the test
  go test -update         re-record *.golden   (review the diff — that's the test!)
  insta / syrupy / jest snapshots
  ALWAYS normalize volatile fields → <TIMESTAMP> /tmp/<RANDOM> <UUID> before diffing

NOTEBOOKS (executable ≠ reproducible)
  jupyter nbconvert --to notebook --execute nb.ipynb   fresh kernel, fails on cell error (ONLY honest test)
  nbstripout --install      never commit outputs/exec counts
  pin deps (requirements.lock / uv.lock) + seed RNGs + fix the clock; render via quarto in CI

FAIL-CLOSED PIPELINE (block the merge, don't warn)
  1 build (bad ref = fail)  2 snippets compile/run  3 API examples replayed at real server
  4 links resolve (internal=hard, external=retry/schedule)  5 regenerate generated docs; git diff must be EMPTY

THE LIMIT
  green proves: docs don't LIE about output.   green does NOT prove: clear / findable / idiomatic / teaches.
  executable ≠ correct ; correct ≠ good. Verification is a FLOOR, not a ceiling.
```

---

## Summary

- The root cause of doc drift is **duplicated state with no sync** — the same fact in code *and* prose. The architectural cure is **single source of truth**: generate the doc from the one already-verified artifact (code → signatures, OpenAPI → API reference, arg parser → CLI docs, schema → config docs) so divergence is impossible by construction. A generated doc is only as trustworthy as the *check on its source*.
- Generation makes docs match the *spec*; **contract testing** makes the spec match the *running service*. Reframed as doc assurance: spec-validation (Dredd/Schemathesis) catches docs describing behavior the server lost; consumer-driven contracts (Pact) catch dropped behavior a real client depends on. **Doc drift becomes a failing test** — detection moves from *human-eventually* to *machine-immediately*.
- **Doc tests are documentation first, tests second.** They guarantee an example is real and catch public-API drift, but they're slow, brittle on exact output, and the wrong tool for edge cases. Keep them minimal and deterministic; the value is teaching, the testing is a bonus.
- **Golden/transcript testing** turns a whole CLI session or tutorial into one regression test — but its value lives entirely in *reading the diff*. Normalize away nondeterminism, and never rubber-stamp updates.
- **Notebooks are executable but not reproducible** — hidden out-of-order state, nondeterministic outputs, and unpinned environments make their saved cells lie. Trust only restart-run-all, seeded, pinned, in CI.
- A docs system is a **fail-closed pipeline**: snippets compile, API examples replay against a *real* server, links resolve, and generated docs are regenerated-and-diffed — every stage a *required* check, every check *deterministic* enough to block on.
- The wall: **executable ≠ correct, and correct ≠ good.** Verification eliminates exactly one failure mode — the doc that lies about its output — and nothing about clarity, audience-fit, or whether anyone learns. It's a floor for human review, never a ceiling.

You now design documentation the way you design systems: with a single source of truth, contracts under continuous test, and a gate that fails closed — while keeping clear-eyed about the one property that matters most and that no pipeline can certify.

---

## Further Reading

- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the "maintaining documentation" and automation chapters on keeping docs honest at scale.
- *Diátaxis* — Daniele Procida ([diataxis.fr](https://diataxis.fr/)) — *why* a verified reference can still be the wrong genre for the reader's need; the "correct ≠ good" wall, formalized.
- [*Pact* documentation](https://docs.pact.io/) and Ham Vocke's *Consumer-Driven Contract Testing* — the canonical treatment of contracts as the verified interface (and, reframed here, of the docs they protect).
- [Schemathesis](https://schemathesis.readthedocs.io/) and [Dredd](https://dredd.org/) — property-based and example-based ways to assert a running server conforms to its documented spec.
- *The Go Programming Language* (Donovan & Kernighan), §11 — testable examples (`Example…` + `// Output:`) as documentation that compiles and runs.
- [The rustdoc book — documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) — how every fenced block in a Rust doc becomes a test, and the attributes that control it.
- *Ten Simple Rules for Reproducible Computational Research* (Sandve et al., PLOS) and the [Quarto](https://quarto.org/) / [Jupyter Book](https://jupyterbook.org/) docs — the discipline that turns a notebook from a screenshot into reproducible documentation.

---

## Related Topics

- [What Makes Docs Good](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set; professional covers wiring the individual tools, this page covers the system around them.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/senior.md) — the same human-eventually → machine-immediately move, aimed at *staleness* instead of *correctness*.
- [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/senior.md) — why a high *count* of tested examples (the coverage trap) isn't quality, and how to find what's *missing*.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *what* to put in the doc comments, specs, and tutorials that this page makes the single source of truth.
- [Code Coverage](../../code-coverage/) — the code-side analog: green tests and high coverage both certify *exercise*, never *value*; the "what coverage does not tell you" lesson, applied to docs.
