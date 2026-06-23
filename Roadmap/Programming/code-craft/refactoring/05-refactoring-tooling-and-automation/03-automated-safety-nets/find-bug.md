# Automated Safety Nets for Refactoring — Find the Bug

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

Each scenario shows a **false safety net** — a suite that is green and looks protective but would not catch a real behavior change. Your job: diagnose *why* it's a false net, then fix it. The "bug" is in the net, not (only) the code.

---

## Scenario 1 — High coverage, weak assertions

```java
@Test
void testCalculate() {
    BillingService svc = new BillingService();
    Invoice result = svc.calculate(sampleAccount());
    assertNotNull(result);                 // (a)
    assertTrue(result.getTotal() >= 0);    // (b)
}
```

Coverage report: `BillingService.calculate` — 100% lines, 100% branches.

**Diagnose.** Both assertions are nearly content-free. `(a)` only fails if the method returns null — it almost never does. `(b)` passes for *any* non-negative total, so if `calculate` returns `0.0`, or double-charges, or drops a line item, the test stays green as long as the result is `≥ 0`. This is the canonical false net: maximum coverage, near-zero catch. A mutant changing `+ tax` to `- tax` survives (still non-negative), so the suite proves nothing about correctness.

**Fix.** Assert the *specific* expected value (and the branches that produce it). If intent is known, pin intent; if this is legacy, pin actual via characterization.

```java
@Test
void calculatesTotalWithTaxAndDiscount() {
    Invoice r = new BillingService().calculate(accountWith(subtotal(100.0), gold()));
    assertEquals(100.0 - 15.0 + taxOn(85.0), r.getTotal(), 1e-9); // exact
    assertEquals(2, r.getLineItems().size());
}
```

The lesson: coverage measured *reach*; the assertions decide *catch*. A weak assertion makes high coverage a lie.

---

## Scenario 2 — Snapshot rubber-stamping

A teammate's PR refactors `ReportRenderer`. CI was red on a snapshot test, so the diff includes:

```
$ git log -p -- __snapshots__/report.snap
+ Total: 0.00          // was: Total: 1,840.00
+ Lines: 0             // was: Lines: 14
```
…produced by:
```bash
jest -u && git add -A   # "tests failing, just update snapshots"
```

**Diagnose.** The snapshot is a golden master — its value is the human reading the diff before approving. Running `jest -u` blindly **re-pinned the net to whatever the code now produces**, which here is obviously broken output (`Total: 0.00`, zero lines). The net didn't fail to detect the regression; it detected it, and the human overrode the net by mass-approving without reading. The bug — the refactoring zeroed the report — is now *recorded as correct*. The next person sees a green suite.

**Fix.** Never blanket-update snapshots. Restore the approved file, read the diff, and treat a snapshot change as a behavior-change claim:

```bash
git checkout HEAD -- __snapshots__/report.snap   # restore the real net
npm test                                          # see the genuine failure
# then FIX ReportRenderer so output matches the approved snapshot
```

Team guardrail: review `.snap`/`.approved` diffs in code review like production code; keep snapshots small enough to actually read; ban CI jobs that run `-u`.

---

## Scenario 3 — A test that cannot fail

```java
@Test
void discountApplied() {
    Cart cart = new Cart(200.0, "GOLD");
    double total = new DiscountPolicy().apply(cart);
    double expected = new DiscountPolicy().apply(cart);  // (!)
    assertEquals(expected, total, 1e-9);
}
```

**Diagnose.** `expected` is computed by calling **the very method under test**. The assertion reduces to `apply(cart) == apply(cart)` — true for any deterministic implementation, *including a completely wrong one*. The test is a tautology; it can never fail (short of nondeterminism). It contributes coverage and a green check while protecting nothing. This is the "test that can't fail" anti-pattern, often born from copy-pasting the implementation into the test to "get the expected value."

**Fix.** The expected value must come from an **independent source** — a hand-computed constant, a spec, or (for legacy) a pinned characterization value:

```java
@Test
void goldGetsFifteenPercentOverHundred() {
    double total = new DiscountPolicy().apply(new Cart(200.0, "GOLD"));
    assertEquals(170.0, total, 1e-9);   // 200 - 15%, computed independently
}
```

Rule of thumb: if the expected value is derived by running the production code, you have a mirror, not a net.

---

## Scenario 4 — Over-mocked test pinning the old design

```java
@Test
void processesOrder() {
    Repo repo = mock(Repo.class);
    Mailer mailer = mock(Mailer.class);
    new OrderService(repo, mailer).place(order);

    verify(repo).beginTx();
    verify(repo).insertOrder(order);
    verify(repo).insertLine(line1);
    verify(repo).insertLine(line2);
    verify(repo).commit();
    verify(mailer).send(confirmationFor(order));
}
```

You refactor `OrderService` to batch the line inserts (`insertLines(List.of(line1, line2))`) — behavior-preserving. The test fails on `verify(repo).insertLine(...)`.

**Diagnose.** This is an **over-mocked interaction test**: it asserts the *exact sequence of calls* on collaborators, i.e. the *internal structure*, not the *observable outcome*. The refactoring changed how the data is written (batched) but not *what* ends up persisted or emailed — yet the net failed. The net is pinning the old design and **blocking a legitimate refactoring**, which is the opposite of its job. Over-mocking couples the test to implementation; every structural change becomes a test edit.

**Fix.** Replace interaction-pinning with **outcome-pinning** against a fake (in-memory) collaborator:

```java
@Test
void processesOrder() {
    InMemoryRepo repo = new InMemoryRepo();
    RecordingMailer mailer = new RecordingMailer();
    new OrderService(repo, mailer).place(order);

    assertEquals(List.of(line1, line2), repo.lineItemsFor(order.id())); // final state
    assertTrue(mailer.sentTo(order.customerEmail()));                    // effect occurred
}
```

Now batching, reordering, or upserting all pass as long as the persisted result and the email are unchanged. Keep mocks for *true* boundaries (assert "an email was sent"); don't mock the internals you intend to refactor.

---

## Scenario 5 — Flaky test silently disabling the net

CI history for `OrderExpiryTest`:

```
run #812 PASS   run #813 FAIL   run #814 PASS (re-run)   run #815 FAIL   ...
```

The team added to the pipeline:

```yaml
test:
  retries: 3        # "it's just flaky, retry till green"
```

And the test:

```java
@Test
void orderExpiresAfterTtl() {
    Order o = service.place(order);
    Thread.sleep(1000);                 // wait for TTL
    assertTrue(service.isExpired(o));   // sometimes false under load
}
```

**Diagnose.** The flakiness comes from a real `sleep` racing a real clock — under CI load 1000ms isn't always enough. The "fix" — `retries: 3` — masks it, but the cost is catastrophic for a *safety net*: a red bar now sometimes means "noise," so the team re-runs and stops reading failures. A genuine regression in expiry logic would fail, get retried, occasionally pass, and **merge**. One flaky test plus retries has quietly disabled the net's authority for everything it gates.

**Fix.** Remove the nondeterminism so the test is deterministic, and drop the blanket retry from gating:

```java
@Test
void orderExpiresAfterTtl() {
    var clock = new MutableClock();
    var service = new OrderService(clock);
    Order o = service.place(order);
    clock.advance(Duration.ofSeconds(ttl + 1));   // no sleep, no race
    assertTrue(service.isExpired(o));
}
```

Inject the clock (or poll with awaitility instead of sleeping). Quarantine flakes on sight, never retry-to-green in the gate. The net's value is trust; a flaky gate has none.

---

## Scenario 6 — Characterization test that pins nothing useful

Legacy `PriceEngine` is about to be refactored. The "golden master":

```java
@Test
void characterize() {
    PriceEngine e = new PriceEngine();
    String out = e.priceReport(sampleBasket()).toString();
    assertTrue(out.length() > 0);     // (!)
    assertTrue(out.contains("Total")); // (!)
}
```

**Diagnose.** This *looks* like characterization but pins almost nothing: any non-empty string containing the word "Total" passes. Refactor `PriceEngine` to compute every price wrong and, as long as it still prints a non-empty report with the header "Total", the test is green. It's a characterization test in name only — it captures the *shape* of the output, not the *behavior*. A real golden master pins the **full content**.

**Fix.** Capture and approve the entire (scrubbed) output so any value change is a diff:

```java
@Test
void characterize() {
    String out = new PriceEngine().priceReport(sampleBasket()).toString()
        .replaceAll("Generated: .*", "Generated: <TS>");
    Approvals.verify(out);   // pins every line, every number
}
```

Now a refactoring that changes any computed price fails. Lesson: a characterization test must pin the *actual values*, not merely that *some* output exists.

---

## Scenario 7 — Coverage gate gamed by a no-assert test

PR adds this to clear a "new code must be 90% covered" gate:

```java
@Test
void touchRefundPath() {
    try { new RefundService().refund(order, -50.0); } catch (Exception ignored) {}
}
```

**Diagnose.** The gate demanded coverage, so the cheapest compliance is a test that *executes* `refund` (even with a nonsense negative amount) inside a swallow-everything `try/catch` and asserts nothing. Coverage hits 90%, the gate goes green, and the net catches zero behavior changes on the refund path — in fact it hides exceptions. This is Goodhart's law: the coverage measure became a target and stopped measuring net quality. Worse, swallowing the exception means even a *crash* wouldn't fail the test.

**Fix.** Delete the gaming test; write tests that assert refund behavior and *expect* the right failure mode:

```java
@Test
void refundCreditsAccount() {
    RefundService svc = new RefundService();
    Account before = order.account().copy();
    svc.refund(order, 50.0);
    assertEquals(before.balance() + 50.0, order.account().balance(), 1e-9);
}
@Test
void negativeRefundRejected() {
    assertThrows(IllegalArgumentException.class,
        () -> new RefundService().refund(order, -50.0));
}
```

And at the policy level: stop gating on absolute coverage %, gate on mutation score for critical paths (a no-assert test kills no mutants), and read tests in review. The metric that can't be gamed by assertion-free tests is the one to trust.
