# Characterization Tests — Senior Level

## Table of Contents

- [What characterization tests actually guarantee](#what-characterization-tests-actually-guarantee)
- [The pinned-bug dilemma](#the-pinned-bug-dilemma)
- [Brittleness: the cost of photographing too much](#brittleness-the-cost-of-photographing-too-much)
- [Coverage strategy: where to spend your pins](#coverage-strategy-where-to-spend-your-pins)
- [Feedback on the net itself: mutation testing](#feedback-on-the-net-itself-mutation-testing)
- [Non-determinism and hidden inputs](#non-determinism-and-hidden-inputs)
- [The combinatorial input space](#the-combinatorial-input-space)
- [Lifecycle: characterization tests are scaffolding](#lifecycle-characterization-tests-are-scaffolding)
- [When characterization is the wrong tool](#when-characterization-is-the-wrong-tool)
- [Related Topics](#related-topics)

---

## What characterization tests actually guarantee

A characterization test makes exactly one promise: **"the observed behavior on this input is the same as it was when I captured it."** It says nothing about correctness, completeness, or intent. Senior judgment begins with taking that statement literally and reasoning about its consequences.

Three properties follow directly:

- **It is a *difference detector*, not a *correctness oracle*.** Green means "no observable change," not "right." A suite of 400 green characterization tests over a fraud-detection module tells you the module behaves as it did yesterday — and yesterday it may have approved every fraudulent transaction.
- **Its value is asymmetric in time.** The suite is most valuable *during* a refactoring window and decays afterward. Once the code is clean and has proper specification tests, many characterization tests become redundant noise that pins implementation details nobody should care about.
- **It encodes no rationale.** Unlike a specification test named `rejects_orders_over_credit_limit`, a characterization test named `characterize_case_47` carries no explanation of *why* the value is what it is. The "why" lives only in your head and, if you are disciplined, in a comment.

> **Key idea:** A characterization test is a regression *tripwire*, not a *judge*. Treat its green as "unchanged," never as "correct," and most senior-level mistakes with this tool disappear.

---

## The pinned-bug dilemma

At the junior level, "pin the bug on purpose" sounded simple. At scale it becomes a genuine engineering judgment with real downside risk.

Consider a legacy module with hundreds of pinned behaviors, generated largely via golden masters over thousands of inputs. Some unknown fraction of those pinned values are *bugs* — wrong outputs that the original code happened to produce. By characterizing, you have just made every one of those bugs **harder to fix**, because now any fix trips a test and looks like a regression.

This is the paradox at the heart of the technique:

> **Key idea:** Characterization tests protect behavior indiscriminately — including the behavior you would *want* to change. The very thing that makes them a safety net for refactoring makes them a *barrier* to correction.

How seniors manage it:

1. **Separate the two transitions in time and in commits.** Refactoring (behavior-preserving) and bug-fixing (behavior-changing) are different activities. Pin first, refactor under the net, *then* fix bugs as deliberate, reviewed commits where a test value flips red→green on purpose. Never let a bug-fix hide inside a refactor; never let a refactor silently fix a bug.
2. **Tag suspected-buggy pins.** Mark them (`@Tag("pinned-bug")`, a naming convention, a tracking ticket) so the team knows these are *not* contracts to defend forever — they are notes saying "this is what it does today, and we suspect it is wrong."
3. **Resist over-pinning incidental output.** If a golden master captures a typo in a log line, you have now made fixing the typo a "behavior change." Decide what is *contract* (must be defended) versus *incidental* (free to change). Scrub or exclude the incidental.
4. **Know the blast radius before you trust a master.** A 3,000-line golden master that nobody has read line-by-line is a liability dressed as an asset. You do not know how many of those lines are wrong, so you do not know what you are defending.

---

## Brittleness: the cost of photographing too much

Brittleness is the dominant failure mode of characterization suites, especially golden masters. A brittle test fails for reasons unrelated to the behavior you care about, so engineers learn to ignore or blindly re-approve failures — at which point the net is worse than useless because it gives *false confidence*.

Sources and mitigations:

| Brittleness source | What it looks like | Mitigation |
|---|---|---|
| Capturing volatile data unscrubbed | Fails every run on timestamps/IDs | Scrub narrowly; inject fixed clock/RNG at a seam |
| Capturing output *format* not *behavior* | Reformatting JSON whitespace breaks 200 tests | Compare *parsed structure*, not raw string |
| One giant master for everything | A one-line logic change rewrites 2,000 lines of diff | Split into focused masters per concern |
| Over-broad combinatorial grids | 5,000-line masters nobody reviews | Shrink to boundary-rich, reviewable sets |
| Asserting incidental ordering | Map iteration order flips the diff | Sort before serializing |

The deepest cause of brittleness is **coupling the test to representation rather than to behavior**. A string-equality golden master couples to *every byte* of the output. If you only care that the computed total is correct, comparing the rendered HTML byte-for-byte over-specifies massively. Prefer asserting on the *parsed, semantically meaningful* projection of the output:

```python
# Brittle: couples to every byte of rendering
assert received_html == approved_html

# Less brittle: couples only to the behavior you care about
data = parse_invoice(received_html)
assert (data.subtotal, data.discount_pct, data.total, data.tax) == \
       (150.00, 20, 120.00, 9.60)
```

> **Key idea:** Brittleness is the symptom; *over-specification* is the disease. Pin the narrowest projection of output that still captures the behavior you need to protect, and no more.

There is a real tension here. A *broad* golden master catches more regressions (including ones you did not anticipate) but is brittle and unreadable. A *narrow* assertion is robust and clear but may miss a regression in some corner you did not project onto. Choosing the projection is a judgment call: broad masters early (when you understand the code least and want maximum safety), narrowing toward focused specification tests as understanding grows.

---

## Coverage strategy: where to spend your pins

You cannot pin everything, and you should not try. Pins cost time to write and, worse, cost maintenance forever. Allocate them with a risk model.

```
                 HIGH ──────────────── change frequency ─────────────▶ HIGH
        HIGH ┌───────────────────────────┬───────────────────────────┐
          │  │  PIN HEAVILY              │  PIN HEAVILY + plan to     │
   blast  │  │  (stable but dangerous —  │  REPLACE with spec tests   │
  radius  │  │   the scary core)         │  (hot, dangerous core)     │
   of a   │  ├───────────────────────────┼───────────────────────────┤
   defect │  │  Pin lightly / on demand  │  Pin around your change    │
          │  │  (stable, low impact)     │  only (churny, low impact) │
        LOW └───────────────────────────┴───────────────────────────┘
```

Concretely, a senior allocates characterization effort by:

- **Proximity to the change.** The [legacy change algorithm](../02-the-legacy-change-algorithm/) localizes the *inflection point* — the set of methods whose behavior your change can affect. Pin that region densely. Pin the far reaches of the module sparsely or not at all.
- **Blast radius.** Code whose failure corrupts money, data, or safety earns more pins than code whose failure shows a cosmetic glitch.
- **Comprehensibility.** Paradoxically, the code you understand *least* often deserves the most pins, because you are least able to predict the consequences of touching it.
- **Coverage as a map, not a target.** Use a coverage tool to find unphotographed lines in the change region, then decide which are worth a pin. Chasing 100% global coverage with characterization tests is a waste — you would be pinning behavior you will never touch.

---

## Feedback on the net itself: mutation testing

A characterization suite is itself untested. How do you know your golden master would actually *catch* a behavior change? A green suite that asserts nothing meaningful gives the same false confidence as no suite at all.

**Mutation testing** answers this. A mutation tool (PIT for Java, `mutmut`/`cosmic-ray` for Python, Stryker for JS) deliberately introduces small faults — flip a `>` to `>=`, change a `+` to `-`, replace a return with a constant — and reruns your suite. If a test fails, the mutant is "killed" (your net caught the injected change). If all tests still pass, the mutant "survived" — meaning a real change of that kind would *also* slip past your suite undetected.

```
   mutate `discount > 100`  →  `discount >= 100`
        │
        ▼  run characterization suite
   ┌─────────────┐
   │ a test fails│ → mutant KILLED   → the net guards that boundary ✅
   └─────────────┘
   ┌─────────────┐
   │ all green   │ → mutant SURVIVED → you have a HOLE at that boundary ⚠
   └─────────────┘
```

For characterization work specifically, surviving mutants tell you exactly *where your photograph is blank* — which boundaries and branches your pins fail to constrain. It is the most rigorous way to validate that a safety net is real before you trust your refactoring to it. (Cost: mutation runs are slow; scope them to the module under change, not the whole codebase.)

> **Key idea:** A safety net you have not stress-tested is a hypothesis, not a guarantee. Mutation testing is how you turn "I think these tests would catch a regression" into "I have evidence they would."

A practical caution: mutation results on a *characterization* suite must be read with the technique's purpose in mind. A surviving mutant tells you "this change would not be caught" — but you only care about the mutants in the *region you intend to refactor*. A survivor in a far corner of the module that you will never touch is not a hole you need to plug; it is simply behavior you chose not to pin. So scope mutation reporting to the change region, and treat survivors there as a prioritized to-do list of pins to add, not as a global quality score to maximize. Chasing a perfect mutation score across the whole legacy module would have you pinning behavior you have no reason to protect — the same over-investment trap as chasing global line coverage.

---

## Non-determinism and hidden inputs

The function signature lies. A method declared `total(Order o)` may secretly also depend on `System.currentTimeMillis()`, `Random`, environment variables, the file system, the network, locale, or thread scheduling. These **hidden inputs** are the enemy of characterization, because a test that cannot control the inputs cannot reproduce the output, and a golden master over uncontrolled inputs is brittle by construction.

The senior move is not to scrub the *output* but to **eliminate the non-determinism at its source by making hidden inputs explicit and injectable**, via a seam ([03](../03-seams-and-enabling-points/), [05](../05-dependency-breaking-techniques/)).

```java
// Hidden input: the clock is baked in, output depends on "now"
class LateFeeCalculator {
    double fee(Loan loan) {
        long daysLate = DAYS.between(loan.dueDate(), LocalDate.now()); // hidden!
        return Math.max(0, daysLate) * 0.50;
    }
}

// Seam introduced: the clock becomes an explicit, injectable dependency
class LateFeeCalculator {
    private final Clock clock;
    LateFeeCalculator(Clock clock) { this.clock = clock; }

    double fee(Loan loan) {
        long daysLate = DAYS.between(loan.dueDate(), LocalDate.now(clock));
        return Math.max(0, daysLate) * 0.50;
    }
}

@Test
void characterizeLateFee() {
    Clock fixed = Clock.fixed(Instant.parse("2026-05-10T00:00:00Z"), ZoneOffset.UTC);
    Loan loan = new Loan(/* dueDate */ LocalDate.parse("2026-05-01"));
    // now deterministic: 9 days late * 0.50 = 4.50 (revealed by the runner)
    assertEquals(4.50, new LateFeeCalculator(fixed).fee(loan));
}
```

| Hidden input | Make it injectable as | Why injection beats scrubbing |
|---|---|---|
| Wall clock | `Clock` / time provider | Output becomes reproducible at the source; no fragile regex |
| Randomness | Seeded RNG / RNG interface | Same seed → same output every run |
| Environment / config | Passed-in config object | Tests independent of the machine |
| File system / network | Injected gateway / fake | Fast, hermetic, no flakiness |
| Locale / time zone | Explicit locale param | No surprise formatting differences across CI machines |

Scrubbing the output is the fallback when you *cannot* introduce a seam cheaply. Injection is strictly better because it removes the non-determinism rather than papering over it — and because the seam you introduce is the same seam your future refactoring will use anyway.

> **Key idea:** Don't characterize a function that secretly reads the clock. Inject the clock first, *then* characterize. The seam is not overhead — it is the prerequisite that makes the behavior pin-able at all.

---

## The combinatorial input space

Combinatorial generation (driving a function with a cross-product of value sets) is powerful and dangerous. The danger is exponential: `n` parameters with `k` values each is `kⁿ` combinations. Five parameters with ten values each is 100,000 rows — a golden master no human will ever review, that takes minutes to run, and that fails illegibly.

Senior tactics for taming the space:

- **Use boundary values, not dense grids.** For an integer compared against thresholds 0 and 100, the values `{-1, 0, 1, 99, 100, 101}` exercise every boundary behavior; `{0, 10, 20, …, 200}` mostly re-tests the same branches.
- **Apply pairwise / combinatorial-coverage thinking.** Most defects are triggered by the interaction of *two* parameters, not five. Pairwise generation covers every pair of values with far fewer rows than the full cross-product (tooling: ACTS, AllPairs, PICT).
- **Equivalence partitioning.** If quantities 2 through 9 all take the same code path, one representative stands for all of them. Pick representatives, not enumerations.
- **Reach for property-based testing where invariants exist.** If you can state an invariant ("total is never negative," "scrubbed output is idempotent"), a property-based tool ([property-based-testing](../../../)) explores the space far more cheaply than a static master. Characterization and property tests are complementary: characterization pins *specific* outputs; properties pin *general* rules.

> **Key idea:** A golden master's value collapses when it stops being human-reviewable. Keep masters small enough to read in a diff — that is a hard constraint, not a nicety.

There is also a subtler failure that large grids invite: **silent coverage drift**. You generate a 2,000-row master, it goes green, and you assume it exercises everything. But if some branch is only reachable on an input combination your value sets never produce, that branch is *not* in the master at all — and no amount of staring at 2,000 green rows will tell you it is missing. This is why the combinatorial grid is not a substitute for the path-coverage map: generate the grid, then run it under a coverage tool and confirm the branches you care about actually lit up. A large master gives a false impression of thoroughness precisely because its size implies completeness it may not have.

```
   2,000 green rows  ──►  feels exhaustive
        │
        ▼  but a coverage run shows:
   branch X (refund path) never executed  ──►  NOT pinned, despite the huge master
```

The fix is not a bigger grid; it is a *better-chosen* one informed by coverage — add the specific input that reaches the refund path, not another 500 rows of the paths you already cover.

---

## Lifecycle: characterization tests are scaffolding

A subtle senior insight: many characterization tests are *temporary*. They are scaffolding erected to make a renovation safe, not permanent architecture.

```
   legacy code (no tests)
        │  characterize → SAFETY NET
        ▼
   refactor under the net  ────────────┐
        │                              │ net holds behavior steady
        ▼                              │
   code now clean & testable           │
        │  add SPECIFICATION tests       │
        ▼  (named for intent, assert correctness)
   retire the now-redundant            │
   characterization scaffolding ◀──────┘
```

Once the code is clean and covered by intent-revealing specification tests, a characterization test that pins `characterize_case_47 == "subtotal=60.00..."` is often dead weight: it couples to implementation detail, obscures intent, and resists change. Seniors *delete* such scaffolding deliberately, the same way you remove the actual scaffolding once the building stands. Keep characterization tests that still earn their place (e.g. a golden master guarding a genuinely complex output a spec test cannot express); retire the rest.

The anti-pattern is treating every characterization test as sacred forever, which slowly converts a codebase into one where every implementation detail is frozen and nothing can be improved without a wall of red.

---

## When characterization is the wrong tool

Characterization is a default, not a universal. Reach for something else when:

- **The behavior is already wrong and the spec is known.** If you have a clear specification and the code violates it, you do not want to pin the wrong behavior — write a *failing specification test* (TDD-style) and fix the code. Pinning a known-wrong value you intend to fix this hour is pure waste.
- **The output is genuinely non-deterministic and cannot be made deterministic** (e.g. depends on real external state you cannot inject). A golden master here is permanently flaky; prefer property/invariant assertions.
- **The code is about to be deleted or rewritten wholesale.** Pinning the behavior of code you will throw away next sprint is effort spent guarding a corpse. (A high-level *contract* test on the rewrite's external behavior may still be worth it; line-level characterization of the doomed internals is not.)
- **The behavior is trivial and obvious.** A two-line getter does not need a characterization test; the recipe's overhead exceeds its value.
- **You need to communicate intent.** Characterization tests are poor documentation — they say *what* but never *why*. Where a test's purpose is to explain the contract to future readers, a named specification test is the right tool.

> **Key idea:** Characterization tests are for *unknown* behavior you must *preserve while changing structure*. When behavior is known, wrong-and-to-be-fixed, doomed, or trivial, a different tool fits better.

---

## Related Topics

- [01-what-is-legacy-code](../01-what-is-legacy-code/) — Why "code without tests" is the problem characterization solves.
- [02-the-legacy-change-algorithm](../02-the-legacy-change-algorithm/) — The inflection-point analysis that tells you *where* to spend your pins.
- [03-seams-and-enabling-points](../03-seams-and-enabling-points/) — How to make hidden inputs and side effects observable so they can be characterized.
- [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/) — Concrete moves (parameterize constructor, extract interface) to introduce the seams characterization needs.
- [../../craftsmanship-disciplines/](../../craftsmanship-disciplines/) — TDD and testing fundamentals; the before-the-fact counterpart to characterization.
- [../../refactoring/](../../refactoring/) — The behavior-preserving transformations the safety net protects.
