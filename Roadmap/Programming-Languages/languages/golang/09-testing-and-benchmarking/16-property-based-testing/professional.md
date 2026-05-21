---
layout: default
title: Property-Based Testing — Professional
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/professional/
---

# Property-Based Testing — Professional

[← Back](../)

Operating PBT at production scale — making it part of CI, dealing with
flakes, and treating it as living infrastructure rather than a one-off
experiment.

## Treat properties as specifications

A good property file is the closest you can get to a machine-checked
specification. When a junior developer reads `prop_sort.go`, they should
understand what `Sort` must do without reading the implementation.

Reviewers should ask: "are these the properties that define the contract?"
Adding or removing a property is as significant as editing a public
docstring — both express what the function promises.

## CI strategy: three tiers

A common pattern:

| Tier      | Trigger             | `-rapid.checks` | Time budget |
|-----------|---------------------|-----------------|-------------|
| PR        | every push          | 100             | < 30 s      |
| Main      | post-merge          | 1000            | < 5 min     |
| Nightly   | scheduled job       | 10000           | < 2 h       |

The PR tier catches obvious breakage fast. The nightly tier acts as a
slow fuzzer, surfacing rare counter-examples. Failing nightly seeds get
promoted to seed files committed to the repo so future PRs replay them.

## Seed corpus management

```
testdata/
  rapid/
    fail-TestSort-20260118.txt    // failed input replayed forever
    fail-TestParser-20260202.txt
```

Use `-rapid.failfile=testdata/rapid/...` in CI to always replay known
counter-examples. This converts PBT findings into permanent regression
tests.

## Counter-example reduction in pull requests

When a property fails, rapid reports a minimal counter-example and a seed.
The PR description should include:

- The seed.
- The minimal counter-example pretty-printed.
- The property name.
- A one-line hypothesis of why it fails.

This avoids the trap of "rapid found a bug — investigate later" tickets
that bit-rot.

## Dealing with non-determinism

PBT relies on determinism for replay. Common offenders:

- `time.Now()` inside the unit under test.
- Map iteration order leaking into output.
- Concurrent goroutines without synchronisation.
- `rand.Intn` without a seeded source.

Strategies:

1. Inject a clock (`clock.Clock` interface).
2. Sort map keys before serialising.
3. Use deterministic test execution (`-race`, `goleak`).
4. Pass `*rand.Rand` rather than using package-level `math/rand`.

## Coverage of generators

You can measure how often each generator path fires:

```go
rapid.Check(t, func(t *rapid.T) {
    x := rapid.OneOf(
        rapid.Just(0),
        rapid.IntRange(1, 100),
    ).Draw(t, "x")
    rapid.Label(t, "zero", x == 0)
    rapid.Label(t, "small-positive", x > 0 && x <= 100)
    // ...
})
```

`-rapid.v` prints the label distribution. If "zero" never fires you have
a generator bug, not a unit-under-test bug.

## Library choice in a real codebase

`rapid` is the default choice as of 2025-2026 because:

- Active maintenance.
- Generics, integrated shrinker.
- State machine support.
- Small dependency surface (no other transitive deps).

Reach for `gopter` only if you have an existing codebase using it; new
projects pick rapid.

`testing/quick` survives for quick smoke checks where the cost of an
external dependency is unjustified — e.g. in a library that wants to
remain dependency-free.

## Coexisting with `go test -fuzz`

Native fuzz fills a different niche: byte-level mutation, persistent
corpus, OSS-Fuzz integration. Keep both:

```
internal/parser/
  parse.go
  parse_test.go          // unit tests
  parse_property_test.go // PBT (rapid)
  parse_fuzz_test.go     // fuzz targets, FuzzParse
  testdata/fuzz/FuzzParse/   // OSS-Fuzz corpus
```

PBT catches "structured" bugs (you forgot to handle the empty case).
Fuzz catches "boundary" bugs (the input contains an invalid UTF-8 byte).
Together they cover the spec and the byte boundary.

## Ownership and rotation

Properties go stale. When the spec changes:

- Update the property in the same PR as the change.
- Reviewers should reject "skipped property" comments.
- Quarterly, run a "property review" where the team reads every property
  file and confirms it still reflects truth.

A property that no longer matches the implementation is worse than no
property — it ratchets the wrong invariant.

## Watch out for trivial properties

A property like `len(out) >= 0` always passes. Mutation testing (e.g.
`gremlins`) is a fast way to flag properties that fail to detect injected
bugs. If mutating the implementation does not break any property, the
property suite is broken.

## CI configuration: a worked example

A production-grade `.github/workflows/test.yml` fragment:

```yaml
name: Test
on: [push, pull_request]

jobs:
  fast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: {go-version: '1.22'}
      - run: go test ./... -rapid.checks=100 -timeout 5m

  thorough:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: {go-version: '1.22'}
      - run: go test ./... -rapid.checks=2000 -timeout 30m

  soak:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: {go-version: '1.22'}
      - run: go test ./... -rapid.checks=50000 -rapid.steps=300 -timeout 4h
```

The schedule trigger runs nightly; failures auto-create issues.

## Committing failed seeds

When PBT finds a real bug, save the seed and the minimal counter-example:

```
testdata/rapid/
  TestSort/
    seed-20260118.txt              # rapid.failfile format
    counter-example-readable.txt   # human notes
```

In code, register the failfile in the test:

```go
func TestSort(t *testing.T) {
    rapid.Check(t, ..., rapid.WithFailFile("testdata/rapid/TestSort/seed-20260118.txt"))
}
```

Future runs replay this seed first. Cheap regression protection.

## Failure triage workflow

1. **CI fails.** Note the seed and the minimal counter-example.
2. **Reproduce locally.** Run with `-rapid.seed=N`. If it doesn't
   reproduce, the property is non-deterministic — fix that first.
3. **Identify scope.** Is this a bug in the property, the generator, or
   the unit under test? Run with `-rapid.v` to see what was drawn.
4. **Fix the unit under test** (most common) or correct the property.
5. **Save the seed.** Add the failing seed to the regression set.

## Documenting properties for reviewers

A property file should answer three questions:

1. **What invariant?** A one-line docstring above each property.
2. **What inputs?** The generator name explains itself.
3. **What failure mode?** The `t.Fatalf` message includes context.

```go
// TestSortIsPermutation checks that sort.Ints produces a slice that
// is a permutation of the input — same elements, possibly reordered.
//
// Failure indicates that sort dropped, duplicated, or fabricated values.
func TestSortIsPermutation(t *testing.T) { ... }
```

Reviewers should be able to read the test file and reconstruct the spec
without opening the implementation.

## Property review meetings

Quarterly, schedule a 30-minute review:

- Walk through each property file.
- Confirm the property still matches the implementation.
- Update generators that have drifted from real production input shapes.
- Increase `-rapid.checks` for stable properties (more confidence).

This is the PBT equivalent of dependency review. It catches dead
properties that no longer protect what they should.

## Working with property failures across teams

When a property fails in CI on a PR, the reviewer should:

1. Identify whether the failure is regression or pre-existing.
2. If pre-existing, mention it in the PR but do not block.
3. If regression, request changes — the PR introduced the bug.
4. Capture the seed in the PR comments so the author can reproduce.

This makes property failures part of the normal code review flow rather
than a flaky CI annoyance.

## Property metrics

Track over time:

- Number of properties.
- Total checks per CI run.
- Number of failures caught in CI vs production.
- Mutation testing kill rate per property.

These metrics communicate the health of the suite. A team that has 20
properties killing 80% of mutants is in much better shape than one with
200 properties killing 30%.

## Capturing seeds in distributed CI

If your CI runs property tests on multiple architectures or Go versions,
each may find different seeds. Aggregate:

- Run with `-rapid.checks=1000` on each platform.
- On failure, capture the seed and the platform.
- Pin the seed in the failfile under a subdirectory per platform.

For codebases that target both amd64 and arm64, float and integer
overflow behaviour can differ at the edges. PBT exposes these
differences faster than any other technique.

## On-call response: property failure in production

A property test runs in CI, not production. So how does PBT help with
on-call?

When a bug surfaces in production:

1. Capture the input that triggered it.
2. Run that input through the existing property locally.
3. If the property passes, **the property is incomplete** — write a
   new one that fails on this input.
4. Fix the unit under test.
5. The new property is the regression test.

Each on-call incident grows the property suite. After a year of this,
your suite captures the institutional knowledge of every production
incident.

## Property suite as a recruiting signal

Engineers reading a codebase before joining a team look at the test
suite. Property tests signal:

- The team thinks rigorously about invariants.
- Refactors are safe.
- Onboarding is faster because tests document the spec.

This is a soft but real benefit.

## Cost accounting

The cost of PBT in a typical project:

- Initial setup (generators for domain types): 1-3 days per package.
- Per-property write time: 15-60 minutes.
- CI time: 5-30 seconds per property at 100 checks.

The savings:

- Fewer post-deploy hotfixes.
- Faster refactors (PBT proves equivalence to old impl).
- Less debugging time on edge cases.
- Onboarding documentation for free.

Break-even is typically 2-4 weeks after initial investment. After that
PBT is pure benefit.

## What to do when properties slow CI

If PBT dominates CI time:

1. Profile per-test: `go test -v -json | jq '.Test, .Elapsed'`.
2. Identify the slowest properties.
3. For each, ask: can I reduce input size without losing coverage? Can
   I parallelise? Can I move to nightly?
4. Move only the *slowest* to nightly. Keep representative properties
   in PR.

The goal: PR feedback under 5 minutes total; nightly within a few hours.

## Cross-language patterns

If your team writes services in multiple languages (Go + Python +
JavaScript), use the same PBT patterns:

- Go: `pgregory.net/rapid`.
- Python: `hypothesis`.
- JavaScript: `fast-check`.
- Scala: `ScalaCheck`.
- Haskell: `QuickCheck` (the original).

Properties translate across languages with minimal adaptation. A team
fluent in PBT moves between codebases more easily.

## Property: backward compatibility of binary format

For a serialisation format you publish:

```go
rapid.Check(t, func(t *rapid.T) {
    v := genValue.Draw(t, "v")
    serV1 := EncodeV1(v)
    parsedByV2, err := DecodeV2(serV1)
    if err != nil { t.Fatalf("v2 cannot decode v1: %v", err) }
    if !reflect.DeepEqual(v, parsedByV2) {
        t.Fatal("v2 decoded v1 incorrectly")
    }
})
```

Combined with the corresponding "v1 cannot decode v2 future fields,
but does not panic", this pins your migration story.

## Property: zero-downtime upgrade

For an upgrade procedure:

```go
rapid.Check(t, func(t *rapid.T) {
    oldState := genOldState.Draw(t, "old")
    requests := genConcurrentRequests.Draw(t, "reqs")
    log := simulateUpgrade(oldState, requests)
    for _, entry := range log {
        if entry.Code >= 500 {
            t.Fatalf("upgrade caused 5xx for %v", entry)
        }
    }
})
```

Synthesises a stream of requests overlapping the upgrade window and
asserts no server errors. This is end-to-end property testing.

## Properties as living architectural documentation

After a year, a mature PBT suite captures:

- Invariants of every public type.
- Round-trip guarantees of every codec.
- Algebraic laws of every combinator.
- State machine models of every stateful service.

Reading the test files is the fastest way to understand what a system
guarantees. Architectural diagrams go stale; properties do not, because
they fail when the system drifts away from them.

## Vendor lock-in: is rapid risky?

`pgregory.net/rapid` is a single-maintainer project. That carries some
risk. Mitigations:

- **Vendor-friendly API.** Most properties depend only on `Check`,
  `Draw`, and a handful of builtin generators. Migrating to another
  library is mechanical search-and-replace.
- **No external transitive dependencies.** Auditing is easy.
- **Mature.** rapid has been used in production at multiple companies
  since 2019.

If risk is unacceptable, fall back to `testing/quick` for critical paths
(no external dep). For most teams, rapid's leverage outweighs the risk.

## Migration: example tests to property tests

Practical migration path for a team adopting PBT:

1. **Identify high-value targets**: codecs, parsers, math-heavy code.
2. **Keep existing example tests**. They are documentation.
3. **Add one round-trip property per codec.** This catches most bugs.
4. **Repeat for permutation, idempotency, monotonicity** as you find
   functions where they apply.
5. **Convert stateful tests** (anything testing a `cache`, `queue`,
   `store`) to `rapid.StateMachine` over the next quarter.

Do not try to retrofit every function. PBT pays back on the structured
parts of your code; let it grow organically.

## Tracking property-found bugs

Maintain a `PBT_FINDINGS.md` (or label issues `pbt-found`). Each finding:

- The property that caught it.
- The minimal counter-example.
- The fix.
- Whether the bug was theoretical or had hit production.

After a year, you have evidence of PBT's ROI for budget conversations
and onboarding.

## Final thoughts

PBT pays back its cost most heavily in the long term: properties survive
refactors, replace dozens of brittle example tests, and continue to find
bugs years after they were written. A team that invests in PBT
infrastructure (CI tiers, failfiles, mutation testing) builds a moat
against regressions.

The operational discipline — seeds, replays, reviews — is what
distinguishes "we have some property tests" from "we have a property
test culture". Choose the latter.

## A 90-day adoption plan

**Days 1-7**: Add `pgregory.net/rapid` to one package. Write one
round-trip property. Demo to the team.

**Days 8-30**: Add round-trip properties for every codec. Add
permutation properties for sorting and dedup. Add idempotency properties
for normalisers.

**Days 31-60**: Stand up CI tiers (PR / main / nightly). Set up
failfiles for caught bugs.

**Days 61-90**: Tackle state machines for one stateful component
(cache, queue). Measure mutation kill rate.

After 90 days, the team has PBT muscle memory and a meaningful suite.

## Operations checklist

Print this. Stick it next to the team's CI dashboard.

- [ ] Every codec has a round-trip property.
- [ ] Every sort has sortedness + permutation.
- [ ] Every normaliser has idempotency.
- [ ] Every stateful service has a `StateMachine` model.
- [ ] CI runs three tiers (PR, main, nightly).
- [ ] Failed seeds are committed under `testdata/rapid/`.
- [ ] `-rapid.v` is enabled in CI for labelling.
- [ ] Mutation testing runs at least monthly.
- [ ] Quarterly property review on the calendar.

## Anti-patterns to retire

- "PBT is slow, so we lowered checks to 10." Lowering checks defeats the
  purpose. Instead, bound the input size and parallelise.
- "PBT failed but we couldn't reproduce, so we disabled it." This means
  the property or unit is non-deterministic. Fix the determinism first.
- "PBT replaced all example tests." Example tests document specific
  expectations; keep them.
- "We have 500 properties." Quantity is not quality. Mutation-test the
  suite; redundant properties add CI time without value.

## Property suite as a hiring filter

In interviews you can ask a candidate: "tell me about a property you
would write for this function." A senior engineer should reach for
round-trip / idempotency / permutation immediately. The fluency of the
answer reveals years of testing discipline in seconds.

## Building team consensus

The hardest part of PBT adoption is cultural. Engineers used to example
tests are skeptical of "random tests". Counter the skepticism with:

- A live demo: find a real bug with PBT in five minutes.
- Failed-seed regression count: "PBT caught N bugs this quarter".
- Mutation kill rate: PBT typically beats example tests at killing
  injected mutants.

Once one team uses PBT successfully, adjacent teams follow. The artefact
to share is not a slide deck — it is the first PBT-found bug fix in the
codebase.

## Closing on the operational side

Treat PBT as production infrastructure: monitor it, version it, document
it. Failed runs are incidents to triage, not noise to suppress. Seeds
are first-class artefacts to be committed and replayed. Properties are
specifications maintained alongside code.

Done right, PBT becomes invisible: it just keeps catching bugs.
Done wrong, it becomes flaky noise. The difference is the operational
posture described on this page.

## Recommended reading

- John Hughes, *QuickCheck — A Lightweight Tool for Random Testing*.
- David MacIver, *Hypothesis: A new approach to property-based testing*.
- `pgregory.net/rapid` README and examples directory.
- Jepsen reports on real-world model-based testing of databases.
- *Choosing Properties for Property-Based Testing* — Scott Wlaschin.

## Appendix: typical CI dashboard

| Metric                          | Healthy             | Investigate         |
|---------------------------------|---------------------|---------------------|
| PR-tier PBT runtime             | < 30 seconds        | > 60 seconds        |
| PR-tier failures per week       | 0                   | > 0 from same prop  |
| Nightly-tier failures per week  | 0-2                 | > 2 from same prop  |
| Mutation kill rate              | > 70%               | < 60%               |
| Properties per public function  | 1-3                 | 0                   |
| Average shrunk counter-ex size  | < 20 lines pretty   | > 100 lines         |

Dashboards are nudges, not scoreboards. Use them to focus property
review meetings.

## Appendix: properties suite folder layout

```
internal/
  cache/
    cache.go
    cache_test.go              # examples
    cache_property_test.go     # rapid properties
    cache_statemachine_test.go # rapid.StateMachine
    cache_fuzz_test.go         # fuzz targets feeding properties
testdata/
  rapid/
    TestCacheLRU/seed-2026-03-04.txt
    TestParser/seed-2026-02-19.txt
```

The convention separates concerns by file suffix. Anyone can find a
property suite in a foreign package by looking for `*_property_test.go`.

## Appendix: rapid flags cheat sheet

| Flag                   | Purpose                                  |
|------------------------|------------------------------------------|
| `-rapid.checks=N`      | Number of property runs (default 100)    |
| `-rapid.steps=N`       | Actions per state machine run (default 100) |
| `-rapid.seed=N`        | Pin the PRNG seed for replay             |
| `-rapid.failfile=PATH` | Load/save a failing input                |
| `-rapid.shrinktime=D`  | Cap on shrinking time                    |
| `-rapid.v`             | Verbose: log every draw and label        |
| `-rapid.nofailfile`    | Disable auto-save of failing seeds       |

Memorise the first three; they cover 90% of operational needs.
