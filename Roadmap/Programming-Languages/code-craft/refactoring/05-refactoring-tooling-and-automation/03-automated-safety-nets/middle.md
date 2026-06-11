# Automated Safety Nets for Refactoring — Middle

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

You know *why* the net matters and have written a basic characterization test. This level is about **mechanics**: generating golden masters efficiently, using approval-testing frameworks instead of hand-copying values, pinning service boundaries with contract tests, and — the skill that separates competent from careless — **choosing the right net for the situation in front of you**.

---

## 1. Characterization tests, done properly

The junior loop (placeholder → read actual → pin) works but is slow and manual for anything beyond a handful of cases. Two upgrades make it practical.

### 1.1 Generate the pinned values instead of hand-copying

When a method takes a small, enumerable set of inputs, **drive it with a loop** and let the test print the current behavior, then freeze that output.

```java
@Test
void characterizeAcrossInputSpace() {
    ShippingCalculator calc = new ShippingCalculator();
    int[] weights = {300, 500, 501, 2000, 2001, 5000};
    String[] countries = {"US", "CA", "DE"};
    boolean[] express = {false, true};

    StringBuilder sb = new StringBuilder();
    for (int w : weights)
        for (String c : countries)
            for (boolean e : express)
                sb.append(String.format("%d,%s,%b => %.2f%n",
                          w, c, e, calc.cost(w, c, e)));

    Approvals.verify(sb.toString());   // ApprovalTests; see §2
}
```

This single test now pins **36 input combinations**. The first run produces a `*.received.txt` file; you eyeball it, rename it to `*.approved.txt`, and from then on any behavior change shows up as a diff. You traded 36 hand-written `assertEquals` lines for one generated, reviewable snapshot — and you covered the **branch boundaries** (500/501, 2000/2001) that hand-picking usually misses.

### 1.2 Pin behavior at the right seam

Characterization tests are only as good as the **seam** you test through. A *seam* (Feathers' term) is a place where you can sense behavior without modifying the production code path. If the legacy method writes to a database and returns nothing, you cannot pin a return value — you must pin the **effect**:

```java
@Test
void characterizeDbEffect() {
    InMemoryDb db = new InMemoryDb();
    new OrderProcessor(db).process(sampleOrder());
    // pin the observable effect, not internals
    Approvals.verify(db.dumpTableSortedByPk("order_lines"));
}
```

Pin the **observable effect** (rows written, message emitted, file produced), never the private call sequence. Pinning internals is over-pinning; it will block your refactoring later.

> **When NOT to characterize:** if the unit already has clear, intent-based unit tests, do not bury it under golden masters. Characterization is a tool for the *unspecified*. On well-specified code it just adds brittle, value-frozen tests that nobody can read.

## 2. Approval testing as a framework

Approval testing (ApprovalTests in Java/.NET/JS, or a hand-rolled equivalent) formalizes the golden-master loop:

1. The test produces output and hands it to `Approvals.verify(...)`.
2. The framework writes `TestName.received.txt`.
3. It compares `received` against `TestName.approved.txt`.
4. **No approved file or a mismatch → test fails** and (optionally) pops a diff tool.
5. You inspect the diff. If correct, you *approve* (rename received → approved). If wrong, you fix code.

```java
// Java, ApprovalTests
@Test
void rendersInvoice() {
    Invoice inv = sampleInvoice();
    Approvals.verify(new InvoiceRenderer().toHtml(inv));
}
```

```javascript
// JS, jest snapshot — same idea, different syntax
test('renders invoice', () => {
  expect(renderInvoice(sampleInvoice())).toMatchSnapshot();
});
```

The power: for a 2,000-line report you write **one assertion** and get **complete behavioral pinning** for free. The danger is in §4.

### Normalizing non-determinism

Real outputs contain noise — timestamps, UUIDs, run-specific paths. A raw snapshot of noisy output fails every run. **Scrub it before verifying:**

```java
String html = renderer.toHtml(inv)
    .replaceAll("\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z", "<TIMESTAMP>")
    .replaceAll("id=\"[0-9a-f-]{36}\"", "id=\"<UUID>\"");
Approvals.verify(html);
```

If you cannot scrub it, do not snapshot that field. A snapshot test that fails for non-behavioral reasons trains the team to ignore failures — and an ignored net is no net.

## 3. Contract tests for service boundaries

Inside one codebase the compiler guards the seams between modules. **Across a network boundary there is no compiler.** Service A calls service B over HTTP; refactor B's response shape and A breaks at runtime, in production, far from where the change was made.

A **contract test** pins the *agreement* — the request/response shape and meaning — so each side can refactor freely as long as it honors the contract.

The consumer-driven flavor (Pact-style): the **consumer** declares what it needs; the **provider** is verified against that expectation.

```java
// Consumer side: "I expect this shape from /orders/{id}"
@Pact(consumer = "checkout", provider = "orders-api")
public RequestResponsePact orderExists(PactDslWithProvider builder) {
    return builder.given("order 42 exists")
        .uponReceiving("get order 42")
        .path("/orders/42").method("GET")
        .willRespondWith()
        .status(200)
        .body(newJsonBody(o -> {
            o.numberType("id", 42);
            o.stringType("status", "PAID");
            o.numberType("totalCents", 1080);
        }).build())
        .toPact();
}
```

The consumer's test runs against a **mock** that obeys this contract; the provider runs the **same contract** against its real implementation. If the provider's team refactors and accidentally renames `totalCents` to `total_cents`, the *provider's* contract verification goes red — before deploy, on their side. That is the boundary net.

> **When NOT to:** contract tests cost coordination and a broker to share pacts. For two services owned by *one* team that deploy together, an integration test may be cheaper than the contract machinery. Reach for contract tests when consumer and provider deploy **independently** — that is the case the compiler cannot cover.

## 4. Approval/snapshot pitfalls

Snapshot testing is the most *abused* layer of the net. Two failure modes dominate.

### 4.1 Rubber-stamping

The workflow's weak point is step 5 — *human inspects the diff*. Under deadline pressure people stop inspecting and just re-approve:

```bash
jest -u   # "update snapshots" — accept whatever the code now produces
```

If you run `jest -u` (or rename every `.received` to `.approved`) without **reading** the diff, the snapshot now pins whatever the code does — *including the bug you just introduced*. The net silently re-shapes itself around the break. A snapshot you approve without reading is not a net; it is a recording of your last mistake.

Guardrails: review snapshot diffs in code review like any other change; keep snapshots small enough to actually read; never blanket-update.

### 4.2 Brittle, oversized snapshots

A snapshot of an entire rendered page fails on *any* change — a CSS class rename, a reordered attribute, a new analytics div. Each failure forces a human decision, most are non-behavioral, and the team learns to slam "approve." Symptoms: snapshots hundreds of lines long, snapshot diffs in 80% of PRs, nobody reads them.

Fix: snapshot the **smallest meaningful unit** (the computed data, not the rendered HTML; one component, not the page), and scrub volatile fields.

## 5. Choosing the right net per situation

This is the judgment that matters. Use the cheapest layer that catches the mistake you actually fear.

| Situation | Right net | Why |
|-----------|-----------|-----|
| Typed rename / move via IDE | Compiler only | Type system already verifies it |
| Extract method in tested unit | Existing unit tests | Intent already pinned, fast feedback |
| Refactor legacy, no tests, no spec | **Characterization first**, then refactor | You don't know intent; pin reality |
| Big generated output to preserve | Approval / golden master | One assertion pins the whole blob |
| Two independently-deployed services | Contract tests at the seam | No compiler across the network |
| Invariant must hold for all inputs | Property-based test | Examples can't cover the space |
| "Are my tests any good?" | Mutation testing (rarely) | Measures the net, not the code |

The anti-pattern is reaching for the **wrong cost**: hand-writing 200 `assertEquals` where an approval test pins it in one line, or standing up a contract-test broker for two services that ship together.

> **When NOT to add a layer at all:** if a cheaper layer already catches the class of mistake you fear, a richer layer is pure cost. The net's value is *marginal mistakes caught*, not lines of test code.

## 6. Common middle-level mistakes

- **Pinning internals** (private fields, log lines, call order) — blocks the refactoring it was meant to protect.
- **Snapshotting noise** — timestamps/UUIDs cause non-behavioral failures; scrub or exclude.
- **Approving without reading** — turns the net into a recorder of bugs.
- **Characterizing already-specified code** — adds brittle frozen-value tests where intent tests belong.
- **Skipping branch boundaries** — pinning `(300)` and `(1500)` but not `(500)`/`(501)` leaves the boundary logic unguarded; the loop-generated approach in §1.1 fixes this.

## Next

- [Mutation testing, property-based tests, designing the net for a big refactor](senior.md) — measure and scale the net.
- Related: [Code Smells: Bloaters](../../01-code-smells/01-bloaters/junior.md) (the large methods you most often characterize) and [Refactoring to Patterns: when to](../../03-refactoring-to-patterns/01-when-to-refactor-to-patterns/junior.md) (bold moves the net enables).
