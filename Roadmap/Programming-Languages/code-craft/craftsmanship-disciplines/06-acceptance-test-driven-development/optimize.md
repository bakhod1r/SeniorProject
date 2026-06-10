# Acceptance Test-Driven Development — Optimization Drills

> **Category:** [Craftsmanship Disciplines](../README.md) — drive development from executable acceptance criteria agreed with the business.

10 drills to make an acceptance suite faster, stabler, and cheaper to maintain. The dominant optimizations here are **wall-clock time**, **flakiness**, and **maintenance cost** — an acceptance suite that's slow or brittle is a suite the team stops trusting.

---

## Table of Contents

1. [Drill 1: Push a UI Test Down the Pyramid](#drill-1-push-a-ui-test-down-the-pyramid)
2. [Drill 2: Make a Scenario Declarative](#drill-2-make-a-scenario-declarative)
3. [Drill 3: Collapse Duplicate Scenarios into an Outline](#drill-3-collapse-duplicate-scenarios-into-an-outline)
4. [Drill 4: Deduplicate Step Definitions](#drill-4-deduplicate-step-definitions)
5. [Drill 5: Isolate Data for Parallel Execution](#drill-5-isolate-data-for-parallel-execution)
6. [Drill 6: Replace sleep() with Wait-for-Condition](#drill-6-replace-sleep-with-wait-for-condition)
7. [Drill 7: Stub Slow External Dependencies](#drill-7-stub-slow-external-dependencies)
8. [Drill 8: Tag and Stage the Suite in CI](#drill-8-tag-and-stage-the-suite-in-ci)
9. [Drill 9: Shrink E2E with Contract Tests](#drill-9-shrink-e2e-with-contract-tests)
10. [Drill 10: Prune Low-Value Scenarios](#drill-10-prune-low-value-scenarios)
11. [Optimization Tips](#optimization-tips)
12. [Summary](#summary)

---

## Drill 1: Push a UI Test Down the Pyramid

### Before — business rule verified through a real browser

```python
@when('a gold member checks out a $200 cart')
def step(context):
    context.browser.visit("/cart")              # ~3s: launch, load, render
    context.browser.click("#checkout")
    context.total = parse_money(context.browser.text("#grand-total"))
```

### After — same rule at the service layer

```python
@when('a gold member checks out a $200 cart')
def step(context):
    cart = Cart(subtotal=200, member=gold_member())
    context.total = Checkout().total_for(cart)  # ~1ms, in-process
```

**Gain:** ~3 seconds → ~1 millisecond per scenario, and it stops flaking on DOM/timing. Across 100 rule scenarios that's ~5 minutes → instant. The discount *math* never needed a browser; the browser proved nothing about it. Keep one separate UI smoke test that the total *displays* — not what it equals.

---

## Drill 2: Make a Scenario Declarative

### Before — imperative, brittle, unreadable

```gherkin
Scenario: Reset password
  Given I open "/forgot"
  When I type "ada@x.com" into "#email"
  And I click "#send"
  And I open the latest email and click the first link
  And I type "newpass" into "#pw" and "#pw2" and click "#save"
  Then "#flash" shows "Password updated"
```

### After — declarative business intent

```gherkin
Scenario: User resets a forgotten password
  Given a registered user "ada@x.com"
  When she completes the password-reset flow with a new password
  Then she can sign in with the new password
```

**Gain:** Not a runtime win — a **maintenance** win. The declarative version survives every UI redesign (the original breaks on any of five selector changes) and is readable by the business, restoring it as living documentation. Mechanism moves into one step definition, where it changes in one place.

---

## Drill 3: Collapse Duplicate Scenarios into an Outline

### Before — five copy-pasted scenarios

```gherkin
Scenario: $99 no discount
  Given a $99 cart
  When I check out
  Then I pay $99
# ... four more near-identical scenarios ...
```

### After — one Scenario Outline

```gherkin
Scenario Outline: Volume discount
  Given a $<subtotal> cart
  When I check out
  Then I pay $<total>

  Examples:
    | subtotal | total  |
    | 99       | 99.00  |
    | 100      | 100.00 |
    | 101      | 90.90  |
    | 500      | 450.00 |
```

**Gain:** Five blocks → one, with the rule expressed as a reviewable table (Specification by Example). Adding a case is a new row, not a new scenario. Each row still runs and reports separately, so you keep granular signal while killing duplication and drift.

---

## Drill 4: Deduplicate Step Definitions

### Before — near-identical steps spawn divergent definitions

```python
@given('a user "{name}"')
def step_a(context, name): context.user = make_user(name)

@given('a registered user "{name}"')
def step_b(context, name): context.user = make_user(name, registered=True)

@given('an existing user "{name}"')
def step_c(context, name): context.user = db.find_or_create(name)   # subtly different!
```

### After — one canonical step, consistent phrasing

```python
@given('a registered user "{name}"')
def step(context, name):
    context.user = make_user(name, registered=True)
```

Then normalize the Gherkin across the suite to use the single phrasing.

**Gain:** Three definitions that were quietly diverging (`find_or_create` vs `make_user` had different behavior) collapse to one. Removes a class of "why does this scenario behave differently?" bugs and cuts maintenance — a fix or change happens once. Periodically audit for duplicate/overlapping step regexes.

---

## Drill 5: Isolate Data for Parallel Execution

### Before — shared DB, serial-only, flaky

```python
def before_all(context):
    db.seed_fixtures()      # one shared dataset for the whole run
```

### After — per-scenario isolation enables parallelism

```python
def before_scenario(context, scenario):
    context.tx = db.begin()           # fresh transaction per scenario
    context.svc = Service(db)
def after_scenario(context, scenario):
    context.tx.rollback()             # nothing leaks; no cross-contamination
```

**Gain:** Independent scenarios can now run **in parallel** across N workers — a 6-minute serial suite becomes ~90 seconds on 4 cores — *and* the chronic order-dependent flakiness disappears. Data isolation is the prerequisite for both the speed (parallelism) and the stability (no leftover state). This is usually the single highest-leverage optimization.

---

## Drill 6: Replace sleep() with Wait-for-Condition

### Before — fixed sleeps: slow and flaky at once

```python
context.browser.click("#submit")
time.sleep(3)                          # always waits 3s; still flakes on slow runs
assert context.browser.text("#status") == "Done"
```

### After — wait for the actual condition

```python
context.browser.click("#submit")
wait_until(lambda: context.browser.text("#status") == "Done", timeout=10)
```

**Gain:** On a fast machine the wait returns in ~50ms instead of always burning 3s — and it no longer flakes on a slow CI runner where 3s wasn't enough. Fixed sleeps are simultaneously the slowest and least reliable choice; condition-waits fix both. (Better still: avoid the UI entirely per Drill 1.)

```text
100 UI steps × sleep(3s)        = 300s of pure waiting per run
100 UI steps × wait (~50ms avg) =   5s, and zero timing flakes
```

---

## Drill 7: Stub Slow External Dependencies

### Before — every scenario calls real email/payment over the network

```python
@when('she requests a reset')
def step(context):
    context.auth.request_reset(context.user)   # real SES call: ~800ms, flaky, costs money
```

### After — fake the external boundary; verify behavior against it

```python
def before_scenario(context, scenario):
    context.mailer = FakeMailer()
    context.auth = AuthService(mailer=context.mailer)

@then('she receives a reset email')
def step(context):
    assert context.mailer.last_to(context.user.email) is not None
```

**Gain:** ~800ms network round-trip → microseconds, no external flakiness, no live emails sent, no spend. The *contract* with the real provider is verified separately by a single contract/integration test, keeping that slow check out of the main suite — integration confidence pushed down the pyramid.

---

## Drill 8: Tag and Stage the Suite in CI

### Before — the whole suite runs on every push

```yaml
test:
  script: behave            # runs all 300 scenarios, 8 min, on every commit
```

### After — staged, tagged execution

```yaml
fast-gate:
  script: behave --tags=@smoke        # ~30s, runs on every push, blocks merge
full-suite:
  script: behave --tags="not @smoke"  # full run, parallel, on PR + nightly
  parallel: 4
```

```gherkin
@smoke
Scenario: A shopper can complete a purchase
  ...
```

**Gain:** Developers get a 30-second smoke signal on every push instead of waiting 8 minutes; the full suite still runs (parallelized) before merge and nightly. Fail-fast on the cheapest, highest-value subset; reserve the slow full run for where it matters. Tags (`@smoke`, `@slow`, `@wip`, `@regression`) make the suite *selectable*.

---

## Drill 9: Shrink E2E with Contract Tests

### Before — a slow cross-service E2E acceptance test

```text
Scenario spins up Orders service + Payments service + a real network,
places an order end-to-end to verify they integrate.
→ 25s, flaky on network, needs both services deployed.
```

### After — each service verified against a shared contract

```text
• Orders (consumer) defines a Pact: "I send POST /charge {amount} and expect 200 {id}".
• Payments (provider) runs the Pact against itself in its own fast suite.
• Each service tests independently, no cross-network call.
→ each ~50ms, isolated, catches the same integration break.
```

**Gain:** A 25-second flaky two-service E2E becomes two fast isolated tests that still catch "we broke our caller / our provider changed." Keep one or two true E2E smoke tests for ultimate wiring confidence, but verify the *interface agreement* with contract tests — the same down-the-pyramid economics applied to integration.

---

## Drill 10: Prune Low-Value Scenarios

### Before — 300 scenarios, many never catching anything

```text
• 40 scenarios re-verifying the same happy path through different entry points
• 25 testing framework behavior (does the ORM save? does routing work?)
• 30 duplicating exhaustive edge cases better suited to unit tests
```

### After — a pruned, intentional sampler

```text
• Keep representative happy paths + key boundaries at the acceptance level
• Move exhaustive edge cases DOWN to fast unit tests
• Delete scenarios that test the framework, not your behavior
→ ~120 high-signal scenarios; faster run, every red means something
```

**Gain:** A passing scenario that never catches a bug is **pure carrying cost** — run time + maintenance on every change, zero value. Pruning is a real optimization: the suite gets faster *and* more trustworthy (no noise from low-signal tests). The acceptance suite is a *sampler* of representative behavior, not an exhaustive checker — exhaustiveness lives in the unit layer.

---

## Optimization Tips

### Where acceptance-suite optimization actually pays off

1. **Drive the service layer, not the UI** — the biggest single win on speed *and* flakiness (Drills 1, 6).
2. **Isolate data** — unlocks parallelism and removes order-dependent flakiness in one move (Drill 5).
3. **Stub external deps; use contract tests** — removes network latency and cross-service flakiness (Drills 7, 9).
4. **Stage and tag in CI** — fast feedback on every push, full run where it counts (Drill 8).
5. **Prune ruthlessly** — fewer, higher-signal scenarios beat more low-value ones (Drill 10).

### Optimization checklist

- [ ] Move business-rule verification from UI → service layer.
- [ ] Rewrite imperative scenarios as declarative intent.
- [ ] Collapse duplicate scenarios into Scenario Outlines.
- [ ] Deduplicate and normalize step definitions.
- [ ] Isolate per-scenario data (transactional rollback) → parallel-safe.
- [ ] Replace every `sleep()` with a wait-for-condition.
- [ ] Stub external services; verify contracts separately.
- [ ] Tag (`@smoke`/`@slow`) and stage the suite in CI; parallelize.
- [ ] Shrink cross-service E2E with consumer-driven contract tests.
- [ ] Delete scenarios that never catch anything or test the framework.

### Anti-optimizations

- ❌ **Auto-retrying flaky tests** to make the build green — hides rot instead of fixing it.
- ❌ **`@Ignore`-ing red scenarios** to unblock — quarantine with an owner and ticket, or delete.
- ❌ **Adding more UI tests "for confidence"** — inverts the pyramid; confidence has steep diminishing returns at the top.
- ❌ **Distorting a business-readable scenario** to make automation easier — push the mechanism into step definitions instead.
- ❌ **Optimizing run time by deleting *valuable* coverage** — prune low-signal tests, not the ones that catch bugs.

---

## Summary

Acceptance-suite optimization is overwhelmingly about **moving work down the pyramid** (UI → service → unit), **isolating data** (for parallelism and stability), and **removing nondeterminism** (waits, stubs, fixed clocks). The pattern is essentially the same economic move everywhere: verify each behavior at the cheapest, stablest layer that can prove it, and reserve the slow, brittle top of the pyramid for the *one* thing only it verifies — that the system is wired together. A fast, stable suite is one the team trusts and runs; a slow, flaky one is one they route around, which is the same as having no suite at all while still paying to maintain it.

---

[← Find-Bug](find-bug.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md)

**Acceptance Test-Driven Development suite complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next discipline:** [Kata & Deliberate Practice](../07-kata-and-deliberate-practice/junior.md).
