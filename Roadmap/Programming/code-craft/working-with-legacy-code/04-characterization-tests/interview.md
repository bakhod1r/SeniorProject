# Characterization Tests — Interview Q&A Bank

A graded bank of interview questions on characterization tests, from junior screening through staff-level design discussion. Each entry gives a strong model answer, the signal an interviewer is listening for, and follow-up probes. Use it to rehearse out loud, not to memorize verbatim.

## Table of Contents

- [Q1. What is a characterization test? (junior)](#q1-what-is-a-characterization-test-junior)
- [Q2. How does it differ from a normal unit test? (junior)](#q2-how-does-it-differ-from-a-normal-unit-test-junior)
- [Q3. Walk me through the recipe (junior→mid)](#q3-walk-me-through-the-recipe-juniormid)
- [Q4. Why assert a value you know is wrong? (junior→mid)](#q4-why-assert-a-value-you-know-is-wrong-juniormid)
- [Q5. You find a bug while characterizing — what do you do? (mid)](#q5-you-find-a-bug-while-characterizing--what-do-you-do-mid)
- [Q6. Characterization vs TDD (mid)](#q6-characterization-vs-tdd-mid)
- [Q7. What is a golden master / approval test? (mid)](#q7-what-is-a-golden-master--approval-test-mid)
- [Q8. The golden master fails every run on a timestamp (mid→senior)](#q8-the-golden-master-fails-every-run-on-a-timestamp-midsenior)
- [Q9. How do you choose inputs? (mid→senior)](#q9-how-do-you-choose-inputs-midsenior)
- [Q10. How do you know your safety net actually works? (senior)](#q10-how-do-you-know-your-safety-net-actually-works-senior)
- [Q11. The brittleness problem (senior)](#q11-the-brittleness-problem-senior)
- [Q12. When is characterization the wrong tool? (senior)](#q12-when-is-characterization-the-wrong-tool-senior)
- [Q13. The combinatorial explosion (senior)](#q13-the-combinatorial-explosion-senior)
- [Q14. CI integration and snapshot footguns (senior→staff)](#q14-ci-integration-and-snapshot-footguns-seniorstaff)
- [Q15. Reviewing a PR that changes a golden master (senior→staff)](#q15-reviewing-a-pr-that-changes-a-golden-master-seniorstaff)
- [Q16. Lifecycle: do these tests live forever? (staff)](#q16-lifecycle-do-these-tests-live-forever-staff)
- [Q17. Design a characterization strategy for a 1,400-line module (staff)](#q17-design-a-characterization-strategy-for-a-1400-line-module-staff)
- [Q18. Rapid-fire / sanity checks](#q18-rapid-fire--sanity-checks)

---

## Q1. What is a characterization test? (junior)

**Model answer.** A characterization test is a test that documents the *actual current behavior* of existing code — what it *does*, not what it *should* do. The term is from Michael Feathers' *Working Effectively with Legacy Code*. Its purpose is to be a safety net: before you change untested legacy code, you capture how it behaves today so that if your change accidentally alters that behavior, a test goes red and tells you. The analogy I like is a photograph: before renovating a room you photograph it exactly as it is — stains and crooked shelves included — so you can tell what changed afterward.

**Signal:** Does the candidate say *actual* behavior, not *correct* behavior? Do they connect it to legacy code and safety-during-change?

**Follow-up — "Why not just write normal tests?"** Because with legacy code you often do not know what the correct behavior is, and even if you did, the existing code may not produce it. You need a net *now*, around behavior you do not yet fully understand. Characterization gives you that without requiring you to know the spec first.

---

## Q2. How does it differ from a normal unit test? (junior)

**Model answer.** The difference is *where the truth lives*. In a normal unit test, the expected value comes from a specification — I know `add(2,3)` should be `5`, so I assert `5`, and if the code disagrees the code is wrong. In a characterization test, the expected value comes from *whatever the code actually produces*. The code is the source of truth and the assertion learns from it. So if the test and code disagree while I'm writing it, it's the *test* that's wrong — I recorded the value incorrectly. A normal test asserts the code does the *right* thing; a characterization test asserts the code does the *same* thing it did before.

**Signal:** The inversion of authority between test and code. Weak candidates describe them as the same thing with a different name.

**Follow-up — "So a passing characterization test means the code is correct?"** No — it only means the behavior is *unchanged* since capture. It is a difference detector, never a correctness oracle. A module can have hundreds of green characterization tests and still be full of bugs; the tests just guarantee nobody changed those bugs by accident.

---

## Q3. Walk me through the recipe (junior→mid)

**Model answer.** Feathers gives a deliberately mechanical loop:

1. Write a test that calls the function and asserts something you *know* is wrong — a sentinel like `assertEquals("CHANGE_ME", result)`.
2. Run it. The failure message reads "expected CHANGE_ME but was 12.5" — that `12.5` is the real current behavior, handed to you by the test runner.
3. Replace the sentinel with `12.5`. Run again — green.
4. Repeat for the other inputs and code paths near the change you're about to make.

The key phrase is *let the test tell you the answer*. You're using the runner as a measuring instrument to read the behavior off, rather than computing it in your head.

```python
def test_characterize_us_light():
    assert shipping_fee(2, "US") == -1      # step 1: deliberately wrong
    # run -> "assert 8.0 == -1" : the runner reveals 8.0
def test_characterize_us_light():
    assert shipping_fee(2, "US") == 8.0     # step 3: paste the real value
```

**Signal:** Mentions the deliberately-wrong assertion *and* the reason (measurement, not guessing). Mentions iterating over paths.

**Follow-up — "What does a mid-level engineer add to that loop?"** A fifth step: after pasting the value, ask "does this surprise me?" The surprises are signal — they reveal edge cases the original authors handled in ways you'd never have guessed. Characterization is a *learning* instrument, and the understanding you gain is often worth more than the tests themselves.

---

## Q4. Why assert a value you know is wrong? (junior→mid)

**Model answer.** Three reasons. First, *accuracy*: computing the expected value by hand introduces arithmetic mistakes into the test itself — the runner computes it correctly every time. Second, *speed*: typing `-1` and reading the failure takes seconds versus minutes of tracing logic. Third, and most importantly, *it works even when you don't understand the code*. Some legacy functions are genuinely incomprehensible. You never need to understand *why* the output is `31.5`; you only need to record *that* it is. The deliberately-wrong assertion is a measurement technique, not a trick.

**Signal:** The "works even when you don't understand it" point separates someone who's actually done this from someone who read about it.

**Follow-up — "Couldn't you just print the value and copy it?"** You could, and that's essentially the same idea — but baking the wrong-assert into the test means the test exists and is run from the very first moment, the value is captured in an assertion rather than transient console output, and you immediately have a regression check. It's the difference between *exploring* and *pinning*.

---

## Q5. You find a bug while characterizing — what do you do? (mid)

**Model answer.** I pin the buggy value anyway, with a comment explaining that it's a known defect, and I fix it *separately* later. The reason is that two different activities are in play: refactoring, which must preserve behavior, and bug-fixing, which deliberately changes behavior. If I "correct" the value inside my characterization test, the test no longer matches the code, it fails, and I've tangled the two activities together. So the discipline is: pin the actual (wrong) behavior now to make the code safe to change, refactor under that net, and then fix the bug as its own reviewed commit where a test value flips red→green *on purpose*. That makes the behavior change a visible, intentional decision in history instead of an accident buried in a refactor.

```python
def test_characterize_france():
    # NOTE: business wants rate 2.5 (-> 10.0); code uses 3.5 (-> 12.0).
    # PINNING the buggy value on purpose. Fix is a separate ticket/commit.
    assert shipping_fee(2, "FR") == 12.0
```

**Signal:** Separates refactoring from bug-fixing cleanly. Mentions a comment/tag and a separate deliberate fix.

**Follow-up — "Isn't pinning bugs dangerous at scale?"** Yes — it's the paradox of the technique. Characterization protects behavior indiscriminately, including behavior you'd want to fix, so a big golden master can make every captured bug *harder* to fix. I manage that by tagging suspected-buggy pins (e.g. `@Tag("pinned-bug")` with a ticket) so the team knows they aren't permanent contracts, and by not over-pinning incidental output that nobody actually depends on.

---

## Q6. Characterization vs TDD (mid)

**Model answer.** They're opposites in direction and intent, even though they use the same frameworks. TDD is *before-the-fact*: the code doesn't exist, the test encodes the behavior I *want*, and red→green means "I implemented the spec." Characterization is *after-the-fact*: the code already exists, the test encodes the behavior it *has*, and red→green means "I captured current behavior." TDD drives correct code into existence and catches bugs; characterization may *enshrine* existing bugs. The mnemonic: TDD writes the spec then makes the code obey; characterization reads the code then makes the test agree. They meet in the legacy change algorithm — you characterize old behavior to get a net, then TDD the new behavior you're adding.

**Signal:** "Direction of authority" — test commands code (TDD) vs code informs test (characterization).

**Follow-up — "Where do they meet in practice?"** In a legacy change: I characterize the existing module to make it safe to touch, refactor under that net to create a clean seam, and then use TDD to add the *new* feature with proper specification tests. Same change, both tools, different phases.

---

## Q7. What is a golden master / approval test? (mid)

**Model answer.** A golden master scales characterization to large outputs. Instead of pasting one value into an assertion, you run the code, capture its *entire* output — a big string, a file, a serialized object — and save it as an approved baseline. Every later run regenerates the output and diffs it against the approved file; match passes, mismatch fails and shows the diff so a human decides whether the change was intended (approve the new version) or a regression (fix the code). It's called approval testing or snapshot testing depending on the ecosystem — Jest's `toMatchSnapshot`, ApprovalTests, Verify, syrupy. A single-value characterization test is just a golden master with a one-line master pasted into code.

**Signal:** The expected value lives in a *checked-in file*, not in code; a *human* approves, the test only detects difference.

**Follow-up — "What's the riskiest moment in approval testing?"** Approving the first baseline. The master is only as trustworthy as your initial review of it. Tools like Jest *pass silently* when they write a new snapshot, so it's entirely on you to open the generated file and read it by eye. A garbage baseline that you bless gives you a test that faithfully defends garbage forever.

---

## Q8. The golden master fails every run on a timestamp (mid→senior)

**Model answer.** Two approaches. The quick fix is *scrubbing*: deterministically replace the volatile substring before comparison — a regex turning `2026-05-01T13:02:55` into `<TIMESTAMP>`. The better fix is *injection*: the timestamp comes from the clock, which is a hidden input; I introduce a seam so the clock is an injectable dependency and pass a fixed `Clock` in the test, making the output deterministic at the source. Injection is strictly preferable because it removes the non-determinism rather than papering over it, it doesn't risk a fragile regex accidentally masking a real change, and the seam I introduce is the same one my refactoring will use anyway. I scrub only when injecting is genuinely riskier than the change I came to make.

```java
Clock fixed = Clock.fixed(Instant.parse("2026-05-10T00:00:00Z"), ZoneOffset.UTC);
assertEquals(4.50, new LateFeeCalculator(fixed).fee(loan));  // deterministic
```

**Signal:** Knows both, *prefers injection*, can articulate why. Names other hidden inputs (RNG, locale, IDs, map ordering).

**Follow-up — "What's the danger of over-scrubbing?"** You blind the test to real changes. If you scrub every number to `<N>`, you can no longer detect a wrong total — the net now has a hole exactly where it matters. Scrub the narrowest thing that's genuinely non-deterministic, nothing more.

---

## Q9. How do you choose inputs? (mid→senior)

**Model answer.** I cover *paths and behaviors*, not values. Heuristics: one input per branch (`if`/`else`/`case`/early-return); boundary values just below, at, and just above every comparison, because that's where surprises cluster — a `> 100` check behaves differently at exactly 100; degenerate inputs like empty, null, zero, negative, which legacy code handles in unpredictable ways; and a coverage tool as a *map* to find lines I haven't photographed yet. The goal isn't 100% coverage for its own sake — it's a net around the region I'm about to change, dense near the change and sparse far from it, per the legacy change algorithm's inflection-point analysis.

**Signal:** "Paths not values," boundary emphasis, coverage-as-map-not-target, proximity to the change.

**Follow-up — "Show me a boundary catching a real surprise."** A VIP discount documented as "20% on large orders" but coded `subtotal > 100`. Testing exactly 100 reveals it falls in the 10% tier, not 20% — the boundary is exclusive. If I'd written the expected value from the spec I'd have been wrong; the runner corrected me. That note becomes critical when I later change the discount logic.

---

## Q10. How do you know your safety net actually works? (senior)

**Model answer.** A characterization suite is itself untested — a green suite that asserts nothing meaningful is as dangerous as no suite, because it gives false confidence. I validate it with *mutation testing*. A mutation tool — PIT for Java, mutmut for Python, Stryker for JS — injects small faults like flipping `>` to `>=` or `+` to `-`, then reruns my suite. If a test fails, the mutant is "killed" — my net caught that class of change. If all tests still pass, the mutant "survived" — meaning a real change of that kind would slip past undetected, so I have a blank spot in my photograph exactly there. For characterization work, surviving mutants point precisely at the boundaries and branches my pins fail to constrain. I scope mutation runs to the module under change since they're slow.

**Signal:** Recognizes the net is a hypothesis until tested; names mutation testing and interprets survivors correctly.

**Follow-up — "Cheaper alternative if mutation testing is too slow?"** Coverage gives a weaker but fast signal — uncovered lines are definitely unprotected. But coverage can't tell you whether a *covered* line's behavior is actually *constrained* by an assertion, which is exactly what mutation testing adds. For a high-stakes refactor I'd pay for mutation testing on the change region specifically.

---

## Q11. The brittleness problem (senior)

**Model answer.** Brittleness — failing for reasons unrelated to the behavior I care about — is the dominant failure mode, because once engineers learn to ignore or blindly re-approve failures, the net gives false confidence and is worse than nothing. The root cause is usually *over-specification*: coupling the test to representation rather than behavior. A byte-for-byte golden master of rendered HTML couples to every byte; a CSS tweak breaks 200 "pricing" tests. The cure is to pin the *narrowest semantic projection* that still captures the behavior — parse the HTML and assert on the computed total, not the markup. Other fixes: split one mega-master into focused masters by concern so a one-line change doesn't rewrite 2,000 lines of diff; sort before serializing to kill ordering noise; scrub volatile data narrowly.

```python
# Brittle: couples to every byte
assert received_html == approved_html
# Robust: couples only to the behavior that matters
d = parse_invoice(received_html)
assert (d.subtotal, d.total, d.tax) == (150.00, 120.00, 9.60)
```

**Signal:** Names over-specification as the disease, brittleness as the symptom. Mentions the broad-vs-narrow tension.

**Follow-up — "But broad masters catch regressions narrow assertions miss."** True — that's the real tension. Broad masters catch surprises I didn't anticipate but are brittle and unreadable; narrow assertions are robust but may miss a corner I didn't project onto. I go broad early, when I understand the code least and want maximum safety, then narrow toward focused specification tests as understanding grows and the code gets cleaner.

---

## Q12. When is characterization the wrong tool? (senior)

**Model answer.** Several cases. When the behavior is *already wrong and the spec is known* — don't pin a value you intend to fix this hour; write a failing specification test and fix the code. When the output is *genuinely non-deterministic and can't be made deterministic* — a golden master is permanently flaky there; use property/invariant assertions instead. When the code is *about to be deleted or rewritten wholesale* — line-level characterization of doomed internals guards a corpse, though a high-level contract test on external behavior may still pay off. When behavior is *trivial* — a two-line getter doesn't justify the recipe's overhead. And when the goal is *communicating intent* — characterization tests say *what* but never *why*, so they're poor documentation; a named specification test fits better.

**Signal:** Treats characterization as a default, not a universal; can name concrete disqualifiers.

**Follow-up — "Doomed code — really skip it?"** Skip *line-level* characterization of the internals you're throwing away. But I'd still pin the *external contract* the rewrite must preserve — the inputs/outputs callers depend on — because that's the behavior that has to survive the rewrite. The distinction is internals (waste) versus contract (valuable).

---

## Q13. The combinatorial explosion (senior)

**Model answer.** Combinatorial generation drives a function with a cross-product of value sets to broadly photograph behavior in one master — but it's exponential: `n` params with `k` values each is `kⁿ` rows. Five params, ten values, 100,000 rows: a master no human will ever review, slow, and illegible on failure. A golden master's value *collapses* when it stops being human-reviewable, so I keep masters small enough to read in a diff — that's a hard constraint. Tactics: use boundary values not dense grids (`{-1,0,1,99,100,101}` beats `{0,10,…,200}`); apply pairwise/combinatorial coverage since most defects are two-parameter interactions, not five; use equivalence partitioning to pick one representative per path; and reach for property-based testing where an invariant exists, since it explores the space far more cheaply than a static master.

**Signal:** Quantifies the explosion, prioritizes reviewability, knows pairwise and equivalence partitioning.

**Follow-up — "How do characterization and property-based testing relate?"** They're complementary. Characterization pins *specific* outputs for *specific* inputs; property-based testing pins *general rules* ("total is never negative," "scrub is idempotent") across generated inputs. On a legacy module I might use characterization for the concrete behavior I'm about to touch and a property test for invariants that should hold across the whole input space.

---

## Q14. CI integration and snapshot footguns (senior→staff)

**Model answer.** The core principle: on a developer's laptop, approval is interactive and human-reviewed; on CI, approval must be *impossible* — CI only checks, it never blesses. Concretely: run the suite in the normal job, tagged for visibility; fail the build on any received/snapshot mismatch since that *is* a behavior change demanding a human decision; disable `jest -u` / `--snapshot-update` / auto-rename on CI; and add a guard that fails if any `*.received.*` artifact survives the run, catching the "forgot to approve or fix" case. Because I injected the clock, currency service, and I/O, the suite is hermetic and fast enough to live in the main pipeline. The footgun is that snapshot tools make capturing trivial and reviewing skippable — someone runs `-u`, sees green, commits an unread baseline. The discipline is that a snapshot isn't approved until a human has read it, and re-approval is always a deliberate, reviewed act.

```yaml
- run: ./gradlew test          # CI=true prevents -u auto-update
- name: Reject un-approved artifacts
  run: 'if find . -name "*.received.*" | grep -q .; then exit 1; fi'
```

**Signal:** "CI checks, never blesses." Knows the auto-update footgun and guards against it.

**Follow-up — "A teammate keeps committing un-reviewed snapshots. Process fix?"** Make it structurally hard: CI guard rejecting stray received files; PR template requiring justification for any master diff; review convention that a "refactor" PR with a master diff is sent back; and pairing on the first few so the "read the snapshot before committing" habit transmits.

---

## Q15. Reviewing a PR that changes a golden master (senior→staff)

**Model answer.** A change to an approved master is a *behavior change*, so I review it as one. First question: what kind of PR is this? If it's labeled a refactor, the master diff should be *zero* — extract method, rename, move should not move behavior. A non-zero master diff on a refactor is a red flag that the refactor wasn't behavior-preserving, and I'd send it back, not rubber-stamp it. If the PR legitimately changes behavior — bug fix, new feature — then the diff should be *small and legible*: exactly the cells they intended. If a one-line logic change rewrote 800 master lines, the master is too coarse and is hiding the real change in noise; I'd ask them to split it. I review the *master diff itself*, not just the code, because the master diff is the clearest statement of what behavior actually changed.

**Signal:** Refactor ⇒ zero diff is the load-bearing insight. Diff legibility as a master-design signal.

**Follow-up — "The diff shows a wrong value becoming right, in a 'cleanup' PR."** That's a refactor that silently fixed a bug — two activities tangled together. I'd ask them to split it: keep the refactor with zero behavior change, and make the fix a separate commit/PR where the value flips on purpose, documented and reviewed as the intentional change it is.

---

## Q16. Lifecycle: do these tests live forever? (staff)

**Model answer.** No — many characterization tests are *scaffolding*, not permanent architecture. They're the safety harness you wear while the walls are open. Once the code is refactored clean and covered by intent-revealing specification tests, a test that pins `characterize_case_47 == "subtotal=60.00..."` is often dead weight: it couples to implementation detail, hides intent, and resists change. I delete that scaffolding deliberately — it's an *upgrade* from "behavior is frozen" to "behavior is specified," which is strictly better. The anti-pattern is treating every characterization test as sacred forever, which slowly converts the codebase into one where every implementation detail is frozen and nothing can improve without a wall of red. I keep the masters that still earn their place — say a money-formatting grid across locales that a spec test would express clumsily — and retire the rest.

**Signal:** Scaffolding metaphor; deliberate retirement; "frozen vs specified" framing; recognizes eternal scaffolding as a failure mode.

**Follow-up — "How do you decide which to keep?"** Keep a characterization/golden-master test if it expresses behavior a specification test *can't* express cleanly — large complex outputs, broad input grids, locale matrices. Retire it if an equivalent named specification test now covers the same behavior more readably. The test that says *why* always beats the one that only says *what*, where both are available.

---

## Q17. Design a characterization strategy for a 1,400-line module (staff)

**Model answer.** I'd sequence it as phases, optimizing for safety-under-deadline.

1. **Beachhead — seam first.** The module reads the clock and hits a currency service, so it's non-deterministic and can't be golden-mastered as-is. I introduce minimal seams — Parameterize Constructor to inject `Clock` and `CurrencyService`, with a delegating old constructor so every caller still compiles — and commit that *alone* as a reviewed pure-preparation refactor.
2. **Broad master before surgery.** With the module deterministic, generate a wide but *reviewable* golden master — a boundary-rich grid over quantity/currency/tier/coupon, maybe ~90 rows — and review it by eye, accepting current behavior bugs and all. This is maximum safety while my understanding is minimal.
3. **Validate the net.** Run mutation testing scoped to the module to confirm the master actually constrains the boundaries I'll touch; plug holes the survivors reveal.
4. **Refactor under the net.** Split into cohesive units (pricing, discount policy, money formatting); the master must stay green throughout — any diff means I broke behavior.
5. **Add the new feature via TDD,** with named specification tests for the loyalty tier.
6. **Retire scaffolding.** Delete the characterization tests now redundant with specification tests; keep the masters that still earn their place (e.g. locale-formatting grid).

Throughout: refactor PRs produce zero master diff, behavior changes are separate and documented, CI checks but never auto-approves, and suspected bugs are tagged not silently defended.

**Signal:** Seam-first, broad-then-narrow, validate the net, refactor under it, TDD the new behavior, retire scaffolding. Process discipline alongside technique.

**Follow-up — "Two days in, you realize the currency service is too deeply woven to inject cleanly. Now what?"** I de-risk: rather than a deep, risky injection, I scrub the currency-dependent portion of the output narrowly and pin the rest, documenting *why* injection was infeasible. If the currency logic is exactly what I need to change, I'd invest in the harder seam — possibly an Extract Interface plus a thin adapter — because I can't safely change what I can't hold still. The decision rule is: inject if it's a collaborator I can pass in; scrub if injecting is riskier than the change I came to make; but never characterize a moving target.

---

## Q18. Rapid-fire / sanity checks

**Does green mean the code is correct?** No — only unchanged since capture. Difference detector, not correctness oracle.

**Where does the expected value come from?** Whatever the code actually produces; the runner reveals it.

**Found a bug — fix it in the test?** No. Pin the buggy value with a comment, fix separately as a deliberate red→green commit.

**Scrub or inject for a flaky clock?** Inject if you can (removes non-determinism at the source); scrub only as fallback.

**One giant golden master?** No — split by concern so failures localize and diffs stay legible.

**Refactor PR changes the master — acceptable?** No — a refactor must produce zero master diff; a diff means behavior moved.

**Can CI auto-approve snapshots?** Never. CI checks; humans bless. Disable `-u` / `--snapshot-update` on CI.

**100% coverage the goal?** No — coverage is a map of unphotographed lines, not a target; pin around the change.

**How validate the net works?** Mutation testing — survivors mark blank spots in the photograph.

**Do these tests live forever?** No — they're scaffolding; retire them as specification tests take over.

**Characterization or property-based for invariants?** Property-based for general rules; characterization for specific captured outputs. Complementary.

**Best one-line definition?** A test that documents what the code *does*, not what it *should* do — a photograph of current behavior used as a safety net for change.
