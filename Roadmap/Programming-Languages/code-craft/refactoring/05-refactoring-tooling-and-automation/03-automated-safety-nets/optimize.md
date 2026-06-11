# Automated Safety Nets for Refactoring — Optimize the Net

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

Each scenario is a **"before"**: a refactoring you've been asked to do, sitting over a weak or absent net. The optimization is not the refactoring itself — it's **designing the right net first**, sized to the change, so the refactoring becomes safe. For each: assess the net, design it, then refactor.

---

## Scenario 1 — Bold refactor of untested legacy

**Before.** You must split a 600-line `ReportBuilder.build()` god-method into focused pieces. There are no tests, no spec, and the original author is gone. The output is a 200-line text report.

**Assess the net.** Zero. Any extraction could silently change a number and nothing would notice. This is the #1 mistake: refactoring legacy with no net under it.

**Design the net (golden master).** The output is too large to hand-assert, so capture it whole:

```java
@Test
void characterizeBuild() {
    String report = new ReportBuilder().build(fixtureWithEveryBranch())
        .replaceAll("Run at: .*", "Run at: <TS>");   // scrub non-determinism
    Approvals.verify(report);   // approve current output as the master
}
```

Feed it inputs that exercise **every branch** (empty basket, single line, many lines, each region, each currency) — multiple fixtures, multiple approved files. Now refactor in small steps, re-running after each; a green master proves behavior is unchanged. If `build` is business-critical, run mutation testing on the master *first* to confirm it has teeth before you trust it. **Net before bold move.**

---

## Scenario 2 — Algorithm swap that "must be identical"

**Before.** A hot-path `dedupeAndSort(List<Event>)` is hand-rolled and slow. You want to replace it with a library implementation. The two examples in the suite both use 3-element lists.

**Assess the net.** Two tiny examples cannot cover the input space of a sort+dedupe — they'll miss duplicates-at-boundaries, already-sorted, reverse-sorted, all-equal, empty. A swap could differ on stability or tie-breaking and the net wouldn't see it.

**Design the net (oracle + invariants).** Keep the old implementation as the **oracle** and assert the new one always agrees, plus universal invariants:

```java
@Property
void newAgreesWithOld(@ForAll List<@From("events") Event> in) {
    assertEquals(oldDedupeAndSort(in), newDedupeAndSort(in));   // oracle
}
@Property
void resultIsSortedAndDeduped(@ForAll List<@From("events") Event> in) {
    var out = newDedupeAndSort(in);
    assertTrue(isSorted(out));
    assertEquals(out.size(), new HashSet<>(out).size());        // invariant
}
```

The framework throws thousands of generated lists at both and shrinks any disagreement to a minimal case. This is the strongest possible net for "rewrite without changing behavior" — far better than more hand-picked examples. Once green, delete the old implementation (and the oracle property with it).

---

## Scenario 3 — Refactoring across a service boundary

**Before.** You want to clean up `OrdersApi`'s response-building code — extract methods, rename internals, restructure the DTO assembly. Three other teams' services consume `GET /orders/{id}`. The only tests are `OrdersApi`'s own unit tests.

**Assess the net.** The unit tests protect `OrdersApi` internally, but **nothing pins the wire contract** the three consumers depend on. A refactor that accidentally renames a JSON field or drops a value compiles, passes all local tests, and breaks three services in production. No compiler crosses the network.

**Design the net (contract tests).** Stand up consumer-driven contracts so each consumer's expectation is verified against your provider:

```java
// provider verification runs each consumer's pact against the real OrdersApi
@Provider("orders-api")
@PactBroker
class OrdersApiContractTest { /* verifies status, fields, types per consumer */ }
```

Now your internal cleanup is free — extract, rename, restructure all you like — as long as the verified response shape is unchanged. If you do change the shape, the contract goes red *before* deploy, on your side. Add the contract net **before** touching the response code.

---

## Scenario 4 — High coverage, low confidence

**Before.** A `PricingEngine` module reports 92% line coverage. You're asked to refactor its tangled discount logic but the team is nervous — "we have coverage, why does it still feel risky?"

**Assess the net.** Coverage measures reach, not catch. The risk feeling is correct: many of those tests likely have weak assertions. You don't actually know if the net has teeth.

**Design the net (measure with mutation, then patch holes).** Run PIT on `PricingEngine` *before* refactoring:

```
> mvn org.pitest:pitest-maven:mutationCoverage -DtargetClasses=com.acme.pricing.*

>> 92% line coverage but 54% mutation score
>> 11 SURVIVED mutants: boundary <= vs <, negated discount condition, ...
```

The survivors are exactly the behaviors your refactor could break silently. Write tests to kill each survivor (boundary cases, each discount branch), pushing mutation score up. *Now* the net has teeth and the refactor is safe. The optimization: convert a misleading coverage number into a measured, hole-free net before the bold move.

---

## Scenario 5 — Slow net throttling the refactor loop

**Before.** Refactoring `InventoryService` requires running its tests after each small step, but the suite takes 9 minutes because every test spins up a real Postgres container and seeds it. So you batch ten edits before running — and when it goes red, the regression is buried among ten changes.

**Assess the net.** The net is *rich but too slow for the inner loop*. Net latency has throttled refactoring tempo; the small-step discipline that makes refactoring safe is gone because feedback is 9 minutes away.

**Design the net (tier it for speed).** Split into a fast inner loop and a slow outer loop:

```java
// FAST: in-memory fake, runs in milliseconds, run after every step
new InventoryService(new InMemoryInventoryRepo()) ...

// SLOW: real Postgres, runs in CI / before commit, keeps the boundary honest
@Tag("integration") class InventoryServicePostgresIT { ... }
```

Move the *logic* tests onto an in-memory repo (seconds for the whole set); keep a smaller set of integration tests on real Postgres in the outer loop / CI. Now you run the fast net after every step and catch a regression at the edit that caused it; the real-DB net still guards the boundary, just not on every keystroke. Don't mock the integration layer into a fast fake that passes when the real boundary is broken — keep it real, keep it outer-loop.

---

## Scenario 6 — Mutation testing that's too expensive to run

**Before.** Someone added a full-repo mutation run to the per-commit CI gate "to guarantee net quality." It takes 47 minutes, so people push less, and last week it was disabled "temporarily."

**Assess the net.** The intent was right (measure net quality) but the *cost placement* is wrong. Full-repo mutation per commit is `mutants × suite_runtime` over everything — unaffordable as a gate. An unaffordable gate gets disabled, leaving you with *no* mutation signal at all.

**Design the net (scope the cost).** Move mutation testing to where it pays:

```yaml
# PR gate: mutate ONLY the diff — fast, gates new code's net quality
mutation-incremental:
  run: mvn pitest:mutationCoverage -DhistoryInputLocation=... -DwithHistory
  on: pull_request           # scoped to changed classes

# Nightly: full mutation on critical packages only, as a tracked trend (non-blocking)
mutation-nightly:
  run: mvn pitest:mutationCoverage -DtargetClasses=com.acme.{payments,pricing}.*
  on: schedule
```

Plus the highest-value use: run targeted mutation on a module *once, before* refactoring it, to find holes. Don't chase 100% (equivalent mutants waste days). The optimization: keep the mutation signal by sizing its cost to the gate, instead of an all-or-nothing run that gets switched off.

---

## Scenario 7 — Snapshot net that's pure noise

**Before.** A component has a 400-line snapshot of fully-rendered HTML. It fails on ~70% of PRs — class renames, attribute reordering, an added analytics `<div>`. The team approves blindly to get green. You're about to refactor the component's *logic*.

**Assess the net.** The snapshot is so brittle and oversized it has become noise; nobody reads its diffs, so it protects nothing and actively trains rubber-stamping. Refactoring under it gains no safety and you'll have to re-approve a giant diff anyway.

**Design the net (snapshot the data, not the DOM).** Move the net down to the smallest meaningful unit — the *computed view-model*, not the rendered markup:

```javascript
// BEFORE: brittle full-DOM snapshot
expect(render(<Card {...props} />)).toMatchSnapshot();   // 400 noisy lines

// AFTER: pin the behavior (the data the component computes), not its styling
expect(toViewModel(props)).toMatchSnapshot();            // small, stable, readable
// plus targeted assertions for the few rendering facts that matter:
expect(screen.getByRole('button')).toHaveTextContent('Add to cart');
```

Now the net pins what the logic *computes* (prices, labels, flags) and survives cosmetic churn, so its diffs are rare, small, and actually read. Refactor the logic under this tight, low-noise net. The optimization: a small net that catches behavior beats a huge net that catches whitespace and gets ignored.
