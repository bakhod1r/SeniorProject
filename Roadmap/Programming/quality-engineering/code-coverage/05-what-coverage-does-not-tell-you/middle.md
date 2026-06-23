# What Coverage Does Not Tell You — Middle Level

> **Roadmap:** [Code Coverage](../README.md) → What Coverage Does Not Tell You
> *The junior page taught you that "covered" only means "executed." This page turns that one sentence into a working catalogue: the seven things a green coverage report hides, the symptom each one produces, and the complementary technique that actually closes the gap.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Blind Spot 1 — The Missing Oracle (Covered ≠ Asserted)](#blind-spot-1--the-missing-oracle-covered--asserted)
4. [Blind Spot 2 — Input-Space Blindness](#blind-spot-2--input-space-blindness)
5. [Blind Spot 3 — The Specification Gap](#blind-spot-3--the-specification-gap)
6. [Blind Spot 4 — What You Should *Not* Cover](#blind-spot-4--what-you-should-not-cover)
7. [Blind Spot 5 — Async & Concurrent Paths](#blind-spot-5--async--concurrent-paths)
8. [Blind Spot 6 — Integration vs Unit Coverage](#blind-spot-6--integration-vs-unit-coverage)
9. [Blind Spot 7 — The Dead-Code Illusion](#blind-spot-7--the-dead-code-illusion)
10. [Worked Example — 100% Covered, One Boundary Bug](#worked-example--100-covered-one-boundary-bug)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does a green coverage report fail to prove, and which technique closes each gap?**

The junior page gave you the one-line truth: coverage measures *execution*, not *correctness*. A line is "covered" the instant a test causes it to run, regardless of whether any assertion inspected the result. That single sentence is enough to be skeptical of a coverage number. It is not enough to *act*.

The middle level is the difference between "coverage can lie" and "here are the seven specific ways it lies, and here is what I run instead." Each blind spot below follows the same shape — **symptom** (what you observe in a real codebase) followed by **remedy** (the complementary technique that catches what coverage missed). The remedies are all real, established practices: mutation testing, boundary and property-based testing, integration tests, race detectors, intentional exclusion. Coverage is one instrument on the panel; this page is the rest of the panel.

The throughline: **coverage answers "did this code run under test?" and nothing else.** Every blind spot is a question it was never designed to answer — was the result checked, were the inputs varied, was the behaviour ever specified, was the interleaving exercised, is the wiring real. Treat coverage as the *floor* (it finds untouched code, reliably) and these techniques as the *building* you put on top.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state why "covered" ≠ "tested."
- **Required:** You understand line vs branch coverage from [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/middle.md).
- **Helpful:** You've written tests in at least one language with assertions (Go `testing`, JUnit, pytest).
- **Helpful:** You've seen a coverage report drop from "100%" to "the bug shipped anyway."

---

## Blind Spot 1 — The Missing Oracle (Covered ≠ Asserted)

An **oracle** is the part of a test that decides pass or fail — the assertion. Coverage instrumentation records that a line *executed*; it has no idea whether any oracle ever looked at what that line produced. A test with zero assertions covers exactly as many lines as a test with ten.

**Symptom:** Coverage is high and stable, yet bugs in covered code reach production. The smell is a test that calls the function and discards the result, or asserts something trivially true (`assert result != nil`) instead of the actual contract.

```go
func Discount(price, pct float64) float64 {
    return price * (1 - pct/100)  // "covered" — but is the math right?
}

func TestDiscount(t *testing.T) {
    Discount(100, 10)  // executes the line. asserts NOTHING.
}
```

Coverage for `Discount` is 100%. The function could `return price * pct` — a completely wrong formula — and this test would still pass with full coverage. The line ran; nobody checked the answer.

**Remedy: mutation testing + assertion discipline.** Mutation testing makes the gap *visible* by deliberately corrupting the code (changing `*` to `+`, `1 -` to `1 +`, deleting a line) and re-running your suite. If a mutant survives — the tests still pass with broken code — your assertions are too weak. A test that asserts `Discount(100, 10) == 90.0` *kills* the formula mutant; the assertion-free test kills nothing. Mutation score is the honest measure of oracle quality, and it is the only metric that punishes assertion-free tests. See [02 — Mutation Coverage](../02-mutation-coverage/middle.md) for operators, scoring, and making it practical on diffs.

> **Key insight:** Coverage rewards *reaching* a line. Mutation testing rewards *checking* it. A suite can max out the first while scoring near-zero on the second — and only the second correlates with catching real bugs. When coverage is high but you don't trust the suite, the missing ingredient is almost always assertions, and mutation testing is how you prove it.

---

## Blind Spot 2 — Input-Space Blindness

A line covered with *one* input tells you that line works for *that one input*. It says nothing about the boundaries, the empty case, the null, the negative, the overflow, or the Unicode string. Coverage counts the *line*, never the *equivalence class of inputs* that line should handle.

**Symptom:** 100% coverage, then a crash on an empty slice, a `nil` map, a zero, a max-int, or a leap-year date. The covering test used a comfortable "happy" value; the boundary that breaks was never fed in, yet the line is green because *some* input ran it.

```go
func Median(xs []int) int {
    sort.Ints(xs)
    return xs[len(xs)/2]   // covered by {1,2,3} → returns 2. fine.
}                          // Median([]) → index out of range. PANIC.
```

One test with `{1, 2, 3}` gives full coverage. The empty slice — a textbook boundary — panics, and coverage never hinted at it, because coverage measures whether `xs[len(xs)/2]` *ran*, not across *which inputs*.

**Remedy: boundary-value analysis and property-based testing.** Boundary analysis is the discipline of deliberately testing the edges of each input's range: empty, single-element, max, min, zero, off-by-one, the null. Property-based testing goes further — instead of hand-picking inputs, you state an *invariant* ("the median is always ≥ min and ≤ max") and the framework generates hundreds of random inputs, including the pathological ones it knows to try (empty, huge, zero). Go's native fuzzing (`go test -fuzz`), Hypothesis (Python), and jqwik (Java) all shrink a failing case to a minimal reproducer. These techniques explore the *input space* that coverage is structurally blind to.

> **Key insight:** Coverage has one dimension — *which lines ran*. Correctness has two — *which lines ran with which inputs*. Property-based and boundary testing add the missing dimension. A single happy-path input can paint the whole function green while leaving every edge untested.

---

## Blind Spot 3 — The Specification Gap

Coverage can only measure code that *exists*. It is computed by instrumenting the lines you wrote. The requirement you forgot to implement has no lines, so it contributes nothing to the denominator and never shows up as a gap. Coverage is silent about the most dangerous category of defect: behaviour that was specified but never built.

**Symptom:** Every line is covered, every test passes, and the feature is still wrong — because a rule from the spec was never coded. The classic case: the requirement says "reject orders over the credit limit," but no one wrote that check. There is no uncovered branch to flag, because there is no branch.

```go
func ApplyCoupon(order *Order, c Coupon) error {
    order.Total -= c.Amount
    return nil
}
// Spec also said: "a coupon cannot reduce the total below zero" and
// "expired coupons are rejected." Neither is implemented.
// Coverage: 100%. The missing rules are invisible — they have no lines.
```

Coverage of `ApplyCoupon` is 100%. The two unimplemented rules don't lower it, because coverage can't measure the absence of code. The negative total ships.

**Remedy: specification-driven tests and requirements traceability.** Write tests against the *specification*, not against the implementation. For each acceptance criterion or requirement, there should be a named test — `TestCoupon_CannotReduceBelowZero`, `TestCoupon_ExpiredIsRejected` — that *fails* until the behaviour exists (this is the heart of TDD and BDD). When the test is derived from the requirement rather than the code, a missing implementation shows up as a *failing* test, not as silently-absent coverage. Traceability (mapping each requirement to the test that verifies it) makes the gap auditable.

> **Key insight:** Coverage is computed *from the code*, so it can only ever critique the code that's there. It is structurally incapable of noticing missing requirements. The only defence is tests written from the spec — a coverage tool will never tell you about a feature you forgot to build.

---

## Blind Spot 4 — What You Should *Not* Cover

Not all code deserves a test, and chasing 100% forces you to write low-value tests for code whose failure modes are trivial, generated, or external. The pursuit *distorts* the suite: time spent testing autogenerated DTOs is time not spent testing the discount engine. The skill is distinguishing **intentional exclusion** (a documented decision) from sloppy `no cover` pragmas hiding real risk.

**Symptom:** Either (a) the suite is bloated with tests asserting that a getter returns the field it returns, or (b) a coverage report littered with `// coverage:ignore` / `# pragma: no cover` on code that *does* carry logic — exclusion used as a number-fixing hack rather than an honest decision.

Code that is reasonable to exclude — *with intent, documented*:

- **Generated code** — protobuf stubs, ORM-generated models, mocks. Tested by the generator's own suite; your tests would assert the generator works.
- **Vendored / third-party dependencies** — not your code, not your suite's job.
- **Trivial accessors** — a plain `func (u User) Name() string { return u.name }` has no logic to break.
- **`main` glue and wiring** — the entrypoint that parses flags and calls into tested packages; cover the packages, smoke-test the binary.

```go
//go:generate mockgen ...   ← generated; exclude with intent
type ServiceMock struct{ ... }

// vs. the dishonest version:
func ChargeCard(amt int) error {  // real money logic
    // coverage:ignore   ← NOT trivial. this is hiding an untested path.
    ...
}
```

**Remedy: a written exclusion policy + diff coverage.** Configure exclusions centrally (`.coverignore`, `covermode` paths, JaCoCo `excludes`) with a comment explaining *why* each is excluded — generated, vendored, trivial. Then enforce coverage on the *diff* of new, hand-written code (see [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/middle.md)), so the metric measures the code that matters and isn't diluted — in either direction — by code that shouldn't count. Intentional exclusion *raises* signal; ad-hoc `no cover` on logic *destroys* it.

> **Key insight:** "100% coverage" is the wrong goal partly because some code *shouldn't* be covered. The mature move is to exclude the right things *on purpose and in writing*, so the remaining number means "the code that can break is tested" — not "we wrote tests for `getName()` to hit a target."

---

## Blind Spot 5 — Async & Concurrent Paths

Coverage instruments lines. A line inside a goroutine, a callback, or an `async` function is marked covered the moment it executes *once*, under *one* interleaving. But concurrency bugs — races, deadlocks, lost updates, ordering violations — live in the *relationships between* interleavings, which coverage cannot see at all. A line being green says nothing about whether the dangerous schedule was ever exercised.

**Symptom:** Full coverage on concurrent code, intermittent failures in production. The goroutine ran during the test (so the line is covered), but the specific interleaving that corrupts shared state happened only under real load.

```go
var counter int
func Incr() { counter++ }   // covered: the line ran in the test.

func TestIncr(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); Incr() }()
    }
    wg.Wait()
    // counter++ is read-modify-write: a DATA RACE.
    // Coverage of Incr is 100%. The race is invisible to coverage.
}
```

`counter++` is covered — it ran 100 times. It is also a data race, and coverage has no opinion on that, because coverage counts line *executions*, not the *orderings* between them.

**Remedy: race detectors, deterministic scheduling, and stress runs.** Run the suite under a race detector: `go test -race`, ThreadSanitizer (C/C++/Go), Java's `jcstress` for concurrency stress testing. These instrument *memory access ordering*, not lines, and flag unsynchronised access even when no failure was observed. Add stress loops (`go test -race -count=1000`, `-cpu=1,4,8`) to vary scheduling, and design for determinism where possible (channels, immutable messages, single-writer ownership). The race detector finds the bug class coverage is constitutionally unable to.

> **Key insight:** Coverage measures *whether* a line ran; concurrency correctness depends on *in what order, relative to other lines*. These are different axes entirely. A 100%-covered concurrent function can be riddled with races — the `-race` flag, not the coverage report, is your instrument here.

---

## Blind Spot 6 — Integration vs Unit Coverage

Unit coverage measures lines exercised by *unit* tests — components in isolation, dependencies mocked. It says nothing about whether the components, when *wired together*, actually work. You can have 95% unit coverage and zero integration coverage, which means every brick is tested and the wall has never been assembled.

**Symptom:** Each module reports high coverage; the system breaks at the seams — wrong serialization between services, a mismatched SQL column, an HTTP handler that never registered its route, a mock that lied about the real dependency's behaviour. Every unit is green; the *integration* was never exercised, so the wiring is untested.

```go
// repo_test.go — DB layer mocked. 100% covered.
func TestSave(t *testing.T)  { svc.Save(mockDB, user) }
// handler_test.go — service mocked. 100% covered.
func TestPost(t *testing.T)  { handler(mockSvc, req) }

// Nobody tested handler → service → REAL database end-to-end.
// The column was renamed in a migration. Unit coverage: still 100%.
// First real INSERT in prod: "column \"name\" does not exist".
```

Both files report full coverage. The mocks stand in for the real collaborators, so the *contract* between layers — the thing that actually broke — is never checked. High unit coverage gave false confidence that the wiring was tested.

**Remedy: integration tests against real collaborators.** Add a layer of tests that run the components *together* against real (or realistic) dependencies — a real database in a container (Testcontainers), the actual HTTP router, a real message broker. These exercise the wiring that mocked unit tests skip. Track integration coverage *separately*; merging it into one number hides which kind of confidence you actually have. The broader testing taxonomy — the unit/integration/E2E pyramid and where each belongs — lives in [Testing](../../testing/).

> **Key insight:** Coverage is per-test-suite. High *unit* coverage proves the bricks are sound; it is silent on whether they were ever stacked. The wiring between components is a distinct surface that only integration tests cover — and a single blended percentage hides which one you're missing.

---

## Blind Spot 7 — The Dead-Code Illusion

It is tempting to read uncovered code as dead code and delete it. Sometimes that's correct. Often it is not — the code is *reachable*, just never reached *by the tests*. Coverage tells you "no test exercised this," which is ambiguous between "unreachable, delete it" and "reachable and untested, write a test." Conflating the two either deletes a live error-handler or keeps genuinely dead code forever.

**Symptom:** A red (uncovered) block. Two opposite wrong moves follow: deleting it (and removing a real, reachable path — often an error branch that only fires in production) or assuming it's fine because "it's probably dead anyway."

```go
func parse(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("bad input %q: %w", s, err)  // RED. uncovered.
    }
    return n, nil
}
```

That error branch is uncovered only because no test passed a non-numeric string — it is fully *reachable* in production. "Uncovered" here means "I forgot a test," not "dead code." Delete it and you've removed real error handling; coverage gave you no way to tell the difference.

**Remedy: reachability analysis + a deliberate test, not a guess.** To decide if code is truly dead, use static analysis built for it — Go's `deadcode` tool (`golang.org/x/tools/cmd/deadcode`) and `staticcheck`'s unused checks do call-graph reachability, which is a different question from coverage's "was it executed in this run." If the analyzer says *reachable*, the red block is a *missing test* — write the test (here: `parse("abc")`) and the branch goes green and verified. If the analyzer says *unreachable*, delete it. Coverage flags the suspect; reachability analysis delivers the verdict.

> **Key insight:** Uncovered ≠ dead. Coverage answers "did a test run this?"; deadness asks "can anything run this?" — a static, whole-program question coverage never addresses. Treat every red block as "test it or prove it dead," never as "probably safe to delete."

---

## Worked Example — 100% Covered, One Boundary Bug

A single function that reports 100% line *and* branch coverage and still ships a bug — caught not by coverage, but by a property test.

```go
// Clamp restricts v to the inclusive range [lo, hi].
func Clamp(v, lo, hi int) int {
    if v < lo {
        return lo
    }
    if v > hi {        // BUG: should be >, but the off-by-one is hidden
        return hi
    }
    return v
}
```

The example-based test suite:

```go
func TestClamp(t *testing.T) {
    if Clamp(-5, 0, 10) != 0  { t.Fail() }  // hits the v < lo branch
    if Clamp(99, 0, 10) != 10 { t.Fail() }  // hits the v > hi branch
    if Clamp(5,  0, 10) != 5  { t.Fail() }  // hits the fall-through
}
```

Run coverage: **100% line, 100% branch.** Every `if`, every `return`, both directions of both branches — all green. By every number on the report, `Clamp` is exhaustively tested. The suite looks done.

Now suppose the contract is "the result must always lie within `[lo, hi]`," and someone later "optimizes" `v > hi` into `v >= hi`. Coverage stays 100% — the same three inputs still traverse the same branches. But `Clamp(10, 0, 10)` now returns `hi` via the `>=` path instead of falling through to return `v` — still 10, still correct *for this input*. The bug hides because no chosen example sits exactly on the boundary in a way that distinguishes `>` from `>=` in the *output*. Coverage cannot help: it counts branch traversal, and the branch is traversed.

A property test states the *invariant* and lets the framework hunt the input space:

```go
func FuzzClamp(f *testing.F) {
    f.Add(5, 0, 10)
    f.Fuzz(func(t *testing.T, v, lo, hi int) {
        if lo > hi { return }            // precondition
        got := Clamp(v, lo, hi)
        if got < lo || got > hi {        // the invariant, checked
            t.Errorf("Clamp(%d,%d,%d)=%d escaped [%d,%d]", v, lo, hi, got, lo, hi)
        }
        if v >= lo && v <= hi && got != v {   // in-range values must pass through
            t.Errorf("Clamp(%d,%d,%d)=%d changed an in-range value", v, lo, hi, got)
        }
    })
}
```

`go test -fuzz=FuzzClamp` generates thousands of triples, including the boundary `v == hi` cases, and the second invariant fails the moment an in-range value is altered — pinning the off-by-one that 100% coverage waved through. The lesson is exact: **coverage proved every branch was reached; the property test proved the function was *correct*, and only one of those two is the thing you actually shipped to depend on.**

---

## Mental Models

- **Coverage is the smoke detector, not the fire inspection.** It reliably tells you which rooms have *no* detector (untouched code) — genuinely useful. It tells you nothing about whether the wiring in the covered rooms is up to code. You still need the inspection: assertions, boundaries, integration, races.

- **Every blind spot is a question coverage was never asked.** Was the result *checked*? (oracle) With *which inputs*? (input space) Was it ever *specified*? (spec gap) In *what order*? (concurrency) *Wired to what*? (integration) *Reachable at all*? (dead code). Coverage answers exactly one question — "did a test run this line?" — and pretends to answer none of the others.

- **A coverage number has a denominator you control.** Excluding generated and trivial code *raises* the signal; `no cover` on real logic *fakes* it. The same mechanism, opposite integrity. The question is always *why* something is excluded, in writing.

- **Red means "test it or prove it dead" — never "probably fine."** Uncovered code is a suspect, not a verdict. Coverage flags it; reachability analysis and a deliberate test deliver judgment.

---

## Common Mistakes

1. **Trusting a high number from an assertion-free suite.** Tests that call code but check nothing produce full coverage and zero confidence. If you can delete every assertion and coverage holds, mutation testing will show you the suite kills nothing.

2. **Reading one covered input as "this line is correct."** A line covered by `{1,2,3}` is not tested for `[]`, `nil`, negatives, or max-int. Coverage has no input-space dimension; boundary and property tests supply it.

3. **Assuming coverage can flag a missing requirement.** Unimplemented behaviour has no lines and cannot lower coverage. Only tests written from the *spec* surface it — as a failing test, not as a coverage dip.

4. **Chasing 100% by testing trivia.** Writing tests for getters and generated DTOs to hit a target inflates the number and starves the code that matters. Exclude the right things on purpose; enforce coverage on the diff of real code.

5. **Believing a covered goroutine is a tested goroutine.** A concurrent line marked green ran under *one* interleaving. Races and ordering bugs need `-race` / `jcstress` / stress loops, which measure ordering, not lines.

6. **Mistaking high unit coverage for a tested system.** Mocked units green ≠ wiring works. The seams between components are a separate surface that only integration tests against real collaborators cover.

7. **Deleting uncovered code as "dead."** Uncovered often means *untested*, not *unreachable* — frequently a real error branch. Use `deadcode`/`staticcheck` for the reachability verdict before deleting anything.

---

## Test Yourself

1. A function shows 100% coverage but a wrong-formula bug ships. What is missing from the tests, and which technique would have exposed it?
2. Why can a line covered by a single input still crash on an empty slice — and what kind of testing closes that gap?
3. The spec says "reject expired coupons," nobody implemented it, and coverage is 100%. Why didn't coverage flag the gap, and what would have?
4. Give two categories of code it is *reasonable* to exclude from coverage, and the one rule that separates honest exclusion from cheating the number.
5. A concurrent function reports full coverage and fails intermittently in production. What is coverage blind to here, and which tool sees it?
6. You have 95% unit coverage and a bug at the boundary between two services. Why didn't unit coverage catch it?
7. A red (uncovered) error branch appears in a PR. Why is "it's dead code, delete it" the wrong default, and how do you decide correctly?

<details>
<summary>Answers</summary>

1. **Assertions** (the oracle). The covering test executed the line but never checked the result. **Mutation testing** would corrupt the formula and reveal that the suite kills no mutants — proving the assertions are too weak.
2. Coverage records that the indexing line *ran* for some input; it has no notion of *which* inputs or their boundaries. The empty/`nil`/min/max cases are a separate dimension. **Boundary-value analysis and property-based testing** (Go fuzzing, Hypothesis, jqwik) explore that input space.
3. Coverage is computed *from existing code*; an unimplemented requirement has no lines, so it can't lower the denominator. **Specification-driven tests** (a test per acceptance criterion) surface it as a *failing* test rather than silently-absent coverage.
4. Any two of: **generated code** (protobuf/ORM/mocks), **vendored/third-party deps**, **trivial accessors**, **`main`/wiring glue**. The rule: exclusion must be **intentional and documented** (*why* it's excluded) — `no cover` slapped on real logic to fix the number is cheating.
5. Coverage sees that the line *ran*, never the **ordering/interleaving** between concurrent lines, where races live. A **race detector** (`go test -race`, ThreadSanitizer, `jcstress`) instruments memory-access ordering and flags the race even with no observed failure.
6. Unit tests mock the collaborators, so the **contract/wiring between the services** — serialization, the SQL column, the route — is never exercised. That seam is only covered by **integration tests against real dependencies** (e.g. Testcontainers).
7. "Uncovered" is ambiguous between *unreachable* (delete) and *reachable but untested* (write a test) — and error branches are usually the latter, fully reachable in production. Decide with **reachability/dead-code analysis** (`deadcode`, `staticcheck`): reachable → add the test; unreachable → delete.

</details>

---

## Cheat Sheet

```
THE 7 BLIND SPOTS — symptom → remedy
  1 missing oracle   high cov, bugs ship      → mutation testing + real assertions
  2 input-space      green, crashes on []/nil → boundary + property-based testing
  3 spec gap         100%, feature still wrong→ spec-driven tests + traceability
  4 wrong-to-cover   tests for getters/gen'd  → documented exclusions + diff coverage
  5 async/concurrent green, flaky in prod      → -race / ThreadSanitizer / jcstress
  6 unit vs integ.   units green, seams break → integration tests, real collaborators
  7 dead-code illus. red block, delete?        → deadcode/staticcheck reachability

THE ONE QUESTION COVERAGE ANSWERS
  "did a test run this line?"   ← that's it. nothing else.

THE QUESTIONS IT DOES NOT
  checked? (oracle)  which inputs? (space)  specified? (gap)
  what order? (race) wired to what? (integ.)  reachable? (dead code)

DECISION RULES
  high cov + low trust   → run mutation testing (assertion problem)
  uncovered block        → "test it OR prove it dead", never "probably fine"
  excluding code         → only with a written reason (why), enforce on the diff
  concurrent line green  → it ran ONCE, under ONE schedule → add -race + stress
```

---

## Summary

- Coverage answers exactly one question — **"did a test run this line?"** — and every blind spot on this page is a different question it was never built to answer.
- **Missing oracle:** covered ≠ asserted. A zero-assertion test hits full coverage and proves nothing. Remedy: **mutation testing** + assertion discipline ([02](../02-mutation-coverage/middle.md)).
- **Input-space blindness:** one input covers a line but ignores its boundaries/null/empty. Remedy: **boundary-value and property-based testing**.
- **Specification gap:** unimplemented requirements have no lines, so coverage can't see them. Remedy: **spec-driven tests** that fail until the behaviour exists.
- **What not to cover:** generated, vendored, trivial, and glue code distort the number; exclude them **intentionally and in writing**, enforce coverage on the diff ([06](../06-coverage-as-signal-not-target/middle.md)).
- **Async/concurrent:** a covered goroutine ran under one interleaving; races live in orderings coverage can't see. Remedy: **race detectors and stress runs**.
- **Integration gap:** high *unit* coverage with mocks proves nothing about the wiring. Remedy: **integration tests against real collaborators** ([Testing](../../testing/)).
- **Dead-code illusion:** uncovered ≠ dead; it's usually *untested*. Remedy: **reachability analysis**, then test or delete with evidence.
- The worked `Clamp` example is the whole page in miniature: **100% line and branch coverage, one boundary bug, caught only by a property test.** Coverage proved every branch was reached; the property test proved the function was correct — and correctness is the thing you ship.

---

## Further Reading

- *TestCoverage* — Martin Fowler (martinfowler.com). The canonical short essay: coverage finds untested code, and that is *all* it does well.
- *An Industrial Evaluation of Mutation Testing* — Petrović & Ivanković (Google, 2018). Why mutation results beat coverage percentages as a quality signal.
- *Property-Based Testing with PropEr / Hypothesis* — the case for invariants over examples; read alongside the `property-based-testing` skill.
- *Software Engineering at Google* — Winters, Manshreck, Wright. The testing chapters on why high coverage is necessary but nowhere near sufficient.
- `go doc cmd/vet`, `golang.org/x/tools/cmd/deadcode`, `staticcheck` docs — the reachability tooling that settles "is this dead?"

---

## Related Topics

- [02 — Mutation Coverage](../02-mutation-coverage/middle.md) — the technique that exposes the missing-oracle blind spot by scoring assertion quality.
- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/middle.md) — what the metrics count, so you know precisely what they leave out.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/middle.md) — Goodhart's law, exclusion policy, and why chasing the number distorts the suite.
- [Testing](../../testing/) — the full unit/integration/E2E taxonomy and assertion discipline that these remedies live in.
- [junior.md](junior.md) — the one-line foundation: "covered" only ever means "executed."
- [senior.md](senior.md) — coverage of coverage's limits at scale: org-wide policy, diff gates, and the metrics that actually predict defects.
