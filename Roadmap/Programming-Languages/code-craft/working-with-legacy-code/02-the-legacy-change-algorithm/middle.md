# The Legacy Change Algorithm — Middle Level

## Table of Contents

- [From mnemonic to working practice](#from-mnemonic-to-working-practice)
- [Step 1 — Identifying change points precisely](#step-1--identifying-change-points-precisely)
- [Step 2 — Finding test points: sensing and interception](#step-2--finding-test-points-sensing-and-interception)
- [Step 3 — Breaking dependencies to reach the point](#step-3--breaking-dependencies-to-reach-the-point)
- [Step 4 — Writing characterization tests](#step-4--writing-characterization-tests)
- [Step 5 — Making the change and refactoring](#step-5--making-the-change-and-refactoring)
- [A realistic worked example](#a-realistic-worked-example)
- [When you can't get tests in cheaply: Sprout and Wrap](#when-you-cant-get-tests-in-cheaply-sprout-and-wrap)
- [What to do when you are stuck](#what-to-do-when-you-are-stuck)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## From mnemonic to working practice

At the junior level the algorithm is five verbs: Identify, Find, Break, Write, Make. That is enough to *recite*. To *execute* it on a real 400-line method that talks to four external systems, you need each step turned into concrete moves: how to actually locate the right change point, how to find a sensing point when the effect is buried, which dependency to break first, and how to write a test that pins behavior you don't fully understand.

This file walks each step at the level of real code. The two specialist topics — [seams](../03-seams-and-enabling-points/) and the full [dependency-breaking catalog](../05-dependency-breaking-techniques/) — go deeper on *techniques*; here we focus on *how the steps fit together as a workflow* and where the judgment calls live.

> **Key idea:** The algorithm is a loop you run per change, not a one-time ceremony. Most steps are fast; the slow ones (breaking dependencies) are exactly the ones that pay back fastest.

## Step 1 — Identifying change points precisely

A change point is the *minimal* set of locations whose behavior must differ. "Minimal" matters: the smaller the surface you commit to changing, the smaller the safety net you must build first.

Three useful tactics:

**Follow the data.** Start from the input or output mentioned in the task and trace it. Task says "premium customers get a discount" — find where price is finalized, where customer tier is known, and where those two meet. That intersection is your change point.

**Use the "effect sketch."** Feathers suggests sketching how methods and fields affect each other. For a method you must change, list what it *reads* and what it *writes*. The change point is wherever a written value must now depend on something it didn't before.

```
computeTotal()  reads: items, taxRate          writes: total
                                                ▲
   task adds:    reads: customer.tier  ─────────┘ (total must now depend on tier)
```

**Distinguish change points from *ripple* points.** When you change `computeTotal`, callers that *interpret* the total might also need to change. Identify those now so you don't discover them after you've shipped. They become additional change points or, at minimum, additional things your tests must cover.

A common middle-level error is identifying *too large* a change point ("the whole pricing module") because the code is tangled. Resist. Find the single seam where the new dependency enters. If you truly cannot, that tangle is a signal you may need Sprout (below) rather than an in-place edit.

## Step 2 — Finding test points: sensing and interception

A **test point** is where you observe the effect of the code under change. The easy case is a method that returns a value. The hard case is a method whose effect is a *side effect* — it mutates a field, writes a row, sends a message, or logs a line.

Two concepts from Feathers help you choose:

- **Sensing** — can you *detect* the effect at all? If the only effect is a hidden private field, you may need to expose it (via a getter, a sensing method, or a subclass) to sense it.
- **Interception point** — the closest place to your change point where you can sense the effect. Test as close to the change as you reasonably can; the further out you go, the more unrelated behavior your test drags in and the more brittle it becomes.

There's also the **pinch point**: a narrow place in the call graph through which many paths flow. A test written at a pinch point exercises a lot of code through one entry, which is efficient when you must cover a tangle and can't easily test each piece. The trade-off: pinch-point tests are coarse — when they fail, they don't tell you *where*. Use them to get *initial* coverage of a scary region, then push tests inward as you break dependencies.

```
          ┌── methodA ──┐
inputs ──▶│             │── pinch point ──▶ outputs
          └── methodB ──┘
                          ▲
              test here: one entry covers A and B (coarse but cheap)
```

| You want to sense... | Test point options |
| --- | --- |
| A returned value | Assert on the return — easiest |
| A mutated object passed in | Inspect the object after the call |
| A database write | Use an in-memory/fake repo and inspect it; or query the test DB |
| A network/email send | Inject a fake gateway and record calls |
| A private field | Add a sensing getter, or subclass to expose, or assert via observable behavior |

## Step 3 — Breaking dependencies to reach the point

This is where legacy code earns its name. The method you must test does something like this in its constructor or body:

```java
public class InvoiceService {
    public Invoice generate(long orderId) {
        Connection conn = DriverManager.getConnection(DB_URL);   // hard dependency
        Order order = new OrderDao(conn).load(orderId);
        TaxRate rate = new TaxApiClient().fetchRate(order.region()); // network
        Instant now = Instant.now();                              // clock
        // ... 80 lines of logic you actually care about ...
    }
}
```

You cannot unit-test 80 lines of pricing logic when running them opens a real DB connection and hits a real tax API. The two reasons to break these dependencies map exactly to the two words from the junior file:

- **Separation** — get the code to *build and run* in a test harness at all (the DB call must not execute).
- **Sensing** — get to *observe* the outcome (capture what was computed).

The lightest-touch technique that gets a seam in is usually **parameterize the dependency** or **extract and inject** the collaborator. For the example, introduce an interface and pass collaborators in:

```java
public class InvoiceService {
    private final OrderRepository orders;
    private final TaxRates taxRates;
    private final Clock clock;

    public InvoiceService(OrderRepository orders, TaxRates taxRates, Clock clock) {
        this.orders = orders;
        this.taxRates = taxRates;
        this.clock = clock;
    }

    public Invoice generate(long orderId) {
        Order order = orders.load(orderId);
        TaxRate rate = taxRates.fetchRate(order.region());
        Instant now = clock.instant();
        // ... same 80 lines, now testable ...
    }
}
```

Now a test can pass fakes and a fixed clock. The full menu of techniques — *Extract Interface*, *Parameterize Constructor*, *Subclass and Override Method*, *Extract and Override Call*, *Introduce Static Setter*, and more — lives in [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/). The *judgment* you need here is: **break the fewest dependencies needed to reach your test point, using the technique that edits the least risky logic.** Every dependency you break is itself a change to untested code, so prefer mechanical, IDE-assisted moves (see [refactoring](../../refactoring/)) over hand edits.

> **Key idea:** Break dependencies for *separation* (it runs in a harness) and *sensing* (you can see the result) — nothing more. Don't redesign the class while you're in there.

## Step 4 — Writing characterization tests

A characterization test documents reality. The technique, in full detail, is in [04-characterization-tests](../04-characterization-tests/); the workflow point here is *how it slots into the algorithm*.

The loop:

1. Write a test that calls the code under change with concrete inputs.
2. Assert on *something you don't yet know* — e.g. `assertEquals("PLACEHOLDER", result)`.
3. Run it. It fails and the message prints the *actual* value.
4. Replace the placeholder with the actual value. Now it's green.
5. Repeat with inputs that exercise the branches near your change point.

```java
@Test
void characterize_domesticOrder() {
    InvoiceService svc = new InvoiceService(fakeOrders, fakeRates, fixedClock);
    Invoice inv = svc.generate(42L);
    // first run printed: expected PLACEHOLDER but was 117.50
    assertEquals(new BigDecimal("117.50"), inv.total());
}
```

You are not judging whether `117.50` is *correct*. You are *recording* it. If your later change accidentally turns it into `120.00`, the test fails and asks you, "did you mean to do that?" That question is the entire value.

Aim coverage at the branches your change touches, plus the obvious neighbors. You do not need 100% coverage of a 400-line method to safely add a discount; you need the paths that the discount could plausibly affect.

## Step 5 — Making the change and refactoring

Now, and only now, you change behavior. Two sub-disciplines:

**Run tests after every small edit.** Not after the whole change — after each step. The tighter the loop, the smaller the haystack when something goes red.

**Separate the behavior change from the cleanup.** When green, you may want to clean up the 80-line method. Do it as a *distinct* activity, ideally a distinct commit, so a failure clearly attributes to either "the feature" or "the tidy." This is the heart of [06-tidy-first-when-and-how](../06-tidy-first-when-and-how/): structural changes and behavioral changes do not share a commit.

```
commit 1: break dependencies (no behavior change) — tests still green
commit 2: add characterization tests              — new tests, green
commit 3: implement discount (behavior change)    — new test green, old tests green
commit 4: extract methods / rename (tidy)         — all tests stay green
```

If commit 4 turns something red, you know it's a refactor bug, not a feature bug, because the feature already shipped green in commit 3.

## A realistic worked example

Task: **premium customers get free express shipping**. The legacy method:

```java
public class CheckoutService {
    public Receipt checkout(long cartId) {
        DbConnection db = ConnectionPool.global().borrow();   // hard dependency
        Cart cart = new CartRepo(db).find(cartId);
        double shipping = cart.isExpress() ? 15.0 : 5.0;
        double total = cart.subtotal() + shipping;
        new PaymentGateway().charge(cart.customerId(), total); // network side effect
        new ReceiptPrinter().print(cartId, total);             // another side effect
        return new Receipt(cartId, total, shipping);
    }
}
```

**Step 1 — Change point.** The `shipping` computation must become `0` for premium customers when express. One expression.

**Step 2 — Test point.** `checkout` returns a `Receipt` carrying `shipping` and `total`. That return is our sensing point — we don't need to peer inside the payment call to verify shipping cost.

**Step 3 — Break dependencies.** The `ConnectionPool.global()`, `PaymentGateway`, and `ReceiptPrinter` all execute real side effects. Inject them:

```java
public class CheckoutService {
    private final CartRepo carts;
    private final PaymentGateway payments;
    private final ReceiptPrinter printer;

    public CheckoutService(CartRepo carts, PaymentGateway payments, ReceiptPrinter printer) {
        this.carts = carts; this.payments = payments; this.printer = printer;
    }

    public Receipt checkout(long cartId) {
        Cart cart = carts.find(cartId);
        double shipping = cart.isExpress() ? 15.0 : 5.0;
        double total = cart.subtotal() + shipping;
        payments.charge(cart.customerId(), total);
        printer.print(cartId, total);
        return new Receipt(cartId, total, shipping);
    }
}
```

**Step 4 — Characterize.** Pin the current shipping math with fakes:

```java
@Test
void characterize_expressShipping() {
    Cart cart = new Cart(/*id*/1, /*subtotal*/100.0, /*express*/true, /*premium*/false);
    CheckoutService svc = new CheckoutService(repoReturning(cart), new FakeGateway(), new FakePrinter());
    Receipt r = svc.checkout(1);
    assertEquals(15.0, r.shipping(), 0.001);   // discovered, then pinned
    assertEquals(115.0, r.total(), 0.001);
}
```

**Step 5 — Change + verify.**

```java
double shipping = cart.isExpress()
        ? (cart.isPremium() ? 0.0 : 15.0)
        : 5.0;
```

```java
@Test
void premiumExpress_shipsFree() {
    Cart cart = new Cart(2, 100.0, true, true);
    CheckoutService svc = new CheckoutService(repoReturning(cart), new FakeGateway(), new FakePrinter());
    Receipt r = svc.checkout(2);
    assertEquals(0.0, r.shipping(), 0.001);
    assertEquals(100.0, r.total(), 0.001);
}
```

Old characterization test still green (non-premium express still $15), new test green. Shipped safely.

## When you can't get tests in cheaply: Sprout and Wrap

Sometimes breaking dependencies is genuinely expensive — the method is a thousand lines, dependencies are everywhere, and you have one day. Feathers gives two *first-move* techniques that let you add **new** behavior in **tested** code without first taming the whole legacy method.

**Sprout Method / Sprout Class.** Write the new logic as a fresh method (or class) that is *fully tested*, then call it from the legacy method at one spot.

```java
// New, tested unit — written test-first:
class DiscountPolicy {
    double discountFor(Customer c, double subtotal) {
        return c.isPremium() ? subtotal * 0.10 : 0.0;
    }
}

// Legacy method: one new line, calling tested code.
double total = cart.subtotal() + shipping;
total -= new DiscountPolicy().discountFor(customer, cart.subtotal()); // sprouted
```

The new behavior is covered; the legacy method gains exactly one untested line (the call). You isolate risk into a clean, tested island.

**Wrap Method / Wrap Class.** When you must run new behavior *before or after* existing behavior without altering it, wrap it. Rename the original and create a new method with the old name that calls the original plus the new code:

```java
// Original renamed:
private Receipt doCheckout(long cartId) { /* unchanged legacy body */ }

// New wrapper carries the old name:
public Receipt checkout(long cartId) {
    Receipt r = doCheckout(cartId);
    auditLog.record(cartId, r.total());  // new behavior, in a tested wrapper
    return r;
}
```

Wrap Class does the same at class granularity (a decorator around the legacy class).

| Technique | Use when | Strength | Weakness |
| --- | --- | --- | --- |
| Sprout | New logic can live in its own unit | New code fully tested, cleanly separated | Legacy method stays untested; the seam is one call |
| Wrap | New behavior runs before/after existing, untouched | Doesn't modify legacy logic at all | Can't change *internal* behavior; only book-ends it |

> **Key idea:** Sprout and Wrap don't make the legacy code tested — they let you add *new* tested code *beside* it. They are tactical retreats when full dependency-breaking is too costly *right now*. Use them, but log the remaining debt.

## What to do when you are stuck

| Stuck on... | Move |
| --- | --- |
| Can't find the change point | Trace the data from the task's input/output; sketch reads/writes |
| Effect is a hidden side effect | Find an interception point further out; add a sensing method |
| Too many dependencies to break | Test at a pinch point for coarse coverage first, then push inward |
| One dependency is brutal (static singleton, `new` in constructor) | Check [05](../05-dependency-breaking-techniques/) for the matching technique; or Sprout around it |
| Can't break deps in the time you have | Sprout/Wrap the new behavior; file the debt |
| Don't know what "correct" output is | You don't need to — characterize the *actual* output |
| Test is flaky (clock, randomness, order) | Inject the nondeterministic source (clock, RNG) so the test controls it |

## Mini Glossary

- **Interception point** — the place nearest your change point where you can sense its effect; prefer testing close to the change.
- **Pinch point** — a narrow spot in the call graph many paths flow through; a single test there covers much code, coarsely.
- **Sensing vs. separation** — *sensing* = observing the outcome; *separation* = getting the code to run in a harness at all. Both are reasons to break dependencies.
- **Sprout Method / Class** — add new behavior as a fresh, fully tested unit and call it from the legacy code at one point.
- **Wrap Method / Class** — keep the original behavior, wrap it to run new behavior before/after without editing the original.
- **Effect sketch** — a diagram of what a method reads and writes, used to locate change points.
- **Fake** — a lightweight working substitute for a real collaborator (e.g., an in-memory repository) used in tests.

## Review questions

1. Explain the difference between *sensing* and *separation*. Give a dependency you'd break for each reason.
2. What is an interception point, and why should you usually test *close* to the change point rather than far out?
3. When is a pinch-point test a good idea, and what is its main weakness?
4. Walk through breaking the dependencies in the `CheckoutService` example. Which technique did you use and why that one?
5. Contrast Sprout and Wrap: what does each let you do, and what does *neither* of them do for the legacy code?
6. Why should the dependency-breaking, the characterization tests, the behavior change, and the cleanup ideally be *separate* commits?
7. You have a 1,000-line method, four external dependencies, and one day. The task is "log every checkout to an audit service." Which approach do you reach for, and what debt do you record?
