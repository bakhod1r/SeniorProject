# God Class — Junior

> **What?** A *God Class* (also called *Blob* or *Large Class*) is a single class that has grown so big it knows too much, does too much, and depends on too much. It typically has thousands of lines, dozens of fields, dozens of methods, and references to every other corner of the system. When you open it in your editor, the scrollbar shrinks to a sliver.
> **How?** Spot it by file size, field count, method count, and import count first, then by the way changes ripple out of it. If you have to scroll for fifteen seconds to find a method, if the constructor takes nine arguments, if the test class is longer than the class itself — you have a God Class on your hands.

---

## 1. The point of avoiding God Classes in one sentence

Software is supposed to be a *graph* of small, focused collaborators. A God Class collapses that graph into a single fat node — every change goes through it, every test depends on it, every team touches it. The God Class is not just "a big class"; it is the *gravity well* of the codebase, and code keeps falling into it because adding-to-the-existing is always cheaper in the short term than extracting-a-new-class.

This is the most common antipattern in legacy Java code. You will meet it within your first month on any non-trivial codebase. Learning to *name* it ("this is a God Class") is the first step to fixing it.

---

## 2. A textbook God Class

```java
public class OrderManager {
    private Connection db;
    private SmtpClient mailer;
    private StripeClient stripe;
    private RedisClient cache;
    private KafkaProducer kafka;
    private S3Client s3;
    private Map<Long, Order> sessionCache;
    private List<Order> pendingShipments;
    private BigDecimal totalRevenueToday;
    private Map<String, Integer> couponUsage;
    private Logger logger;
    private MeterRegistry metrics;
    // ... 18 more fields

    public Order createOrder(Long customerId, List<Long> productIds) { /* 120 lines */ }
    public void payOrder(Long orderId, String token)                 { /* 90 lines  */ }
    public void shipOrder(Long orderId)                              { /* 70 lines  */ }
    public void cancelOrder(Long orderId, String reason)             { /* 80 lines  */ }
    public void refundOrder(Long orderId)                            { /* 110 lines */ }
    public byte[] generateInvoicePdf(Long orderId)                   { /* 60 lines  */ }
    public void sendShippingNotification(Long orderId)               { /* 40 lines  */ }
    public String renderOrderHtml(Long orderId)                      { /* 55 lines  */ }
    public List<Order> findOrdersByCustomer(Long customerId)         { /* 30 lines  */ }
    public BigDecimal calculateTax(Order order)                      { /* 65 lines  */ }
    public BigDecimal applyDiscounts(Order order, List<String> codes){ /* 85 lines  */ }
    public void exportToWarehouse(LocalDate day)                     { /* 95 lines  */ }
    public void runDailyReport()                                     { /* 130 lines */ }
    // ... 22 more methods
}
```

Look at this and ask: **who edits this class?** The accounting team for tax, the warehouse team for export, the marketing team for discounts, the finance team for refunds, the design team for PDF, the DevOps team for reporting, the data team for cache and metrics. Seven teams, one file. Every push touches it. Every merge conflicts on it.

That is a God Class.

---

## 3. Signs you have one — the quick checklist

A class is suspicious when **two or more** of these hit:

- **Lines of code (LOC)** — over 500 LOC. Over 1,000 LOC is almost certain trouble.
- **Field count** — more than 7 instance fields. A class with 25 fields cannot have one responsibility.
- **Method count** — more than 15 public methods. The class is doing too many things.
- **Constructor arity** — more than 5 parameters. The class needs too many collaborators.
- **Import count** — more than 30 imports. The class is too broadly coupled.
- **Test class size** — your `OrderManagerTest.java` is over 2,000 lines and uses 12 mocks per test.
- **Merge conflicts** — every PR touches the same file.
- **Fear** — nobody wants to be the one to refactor it.

The last one is the strongest tell. When a class becomes too scary to refactor, it has won — it survives forever by intimidation.

---

## 4. Why is it called "God"?

The class *knows everything*. It can reach into customer data, payment systems, the database, the mail server, the warehouse export, the analytics pipeline. From its point of view there is no problem it cannot solve. Like an omniscient deity, it has unlimited access — and like a single point of failure, when it breaks, *everything* breaks.

The original name *Blob* (Brown, Malveau, McCormick, Mowbray, *AntiPatterns*, 1998) emphasises the visual: an amoeba of code that has engulfed everything around it. *God Class* (Riel, *Object-Oriented Design Heuristics*, 1996, Heuristic 3.3) emphasises the moral: no class should be a god; classes should collaborate as peers.

Both names point at the same shape. Use whichever your team uses.

---

## 5. How God Classes are born

Nobody sits down to write a God Class. They grow.

1. A small class `OrderManager` is created with three methods.
2. The next ticket asks for "one more small thing", which is naturally added to `OrderManager`.
3. The next ticket adds another thing, because the previous two were also "small".
4. Over six months, the class triples in size. Each individual commit looks reasonable.
5. At month nine, somebody notices the class is 1,200 lines — but it now has eight callers, and "we don't have time to refactor".
6. At year two, the class is 4,500 lines, and you are reading this guide.

Every step seems locally rational. The global outcome is a disaster. This is why senior engineers say: **the time to extract a class is when you add the second responsibility, not when you have ten**.

---

## 6. Why a God Class hurts (concretely)

You will feel the pain in five places, in roughly this order:

- **Testing.** To unit-test one method you must mock ten collaborators, even those the method doesn't use, because they are constructor arguments.
- **Onboarding.** A new hire reads the class for two days and still can't say what it does.
- **Merge conflicts.** Every team touches it, so every PR collides on it.
- **Risk of change.** Editing one method risks breaking nine unrelated callers, because they share fields and helper methods.
- **Compile and start-up time.** A 5,000-line class with 50 imports drags Maven, IntelliJ, and your CI.

The pain is not linear with size. Past a threshold (somewhere near 1,000 LOC or 15 methods) every new feature *costs more than the last*. That is the moment to refactor; sadly it is also the moment people are too scared to.

---

## 7. A tiny fix you can do today — Extract Class

You do not refactor a God Class in one PR. You shave it down one slice at a time. The simplest slice is *Extract Class*: pull out a cohesive subset of fields and methods into a new class.

```java
// Before: OrderManager.generateInvoicePdf is buried inside the 4,500-line class.
public class OrderManager {
    public byte[] generateInvoicePdf(Long orderId) {
        Order o = loadOrder(orderId);
        // 60 lines of PDF rendering
        return bytes;
    }
    // ... 39 other methods
}

// After: a new, single-responsibility class.
public final class InvoicePdfRenderer {
    public byte[] render(Order order) {
        // the same 60 lines
        return bytes;
    }
}

// OrderManager loses 60 lines and one collaborator concern.
public class OrderManager {
    private final InvoicePdfRenderer pdfRenderer = new InvoicePdfRenderer();

    public byte[] generateInvoicePdf(Long orderId) {
        return pdfRenderer.render(loadOrder(orderId));
    }
}
```

Five minutes of work. The class is 60 lines smaller. The PDF code can now be tested without any `Connection`, `SmtpClient`, or `StripeClient`. The next ticket about PDF formatting touches a 60-line class instead of a 4,500-line one.

Do this once a week and the God Class shrinks. **Refactoring is a verb in present continuous tense.**

---

## 8. Common newcomer mistakes around God Classes

**Mistake 1: thinking "big class = God Class".** A 600-line `BigDecimalMath` library that does only arithmetic on big decimals is *not* a God Class — it has one responsibility, however many methods. Size is a *signal*, not the definition.

**Mistake 2: thinking the fix is "split everything in half".** Cutting a 4,000-line class into two 2,000-line classes that still share state and still collaborate constantly is not progress. You need *cohesive* splits along change axes — see `middle.md` for the SRP angle.

**Mistake 3: rewriting from scratch.** "Let's throw it away and start over" is almost always a mistake. The God Class has years of bug fixes encoded in its weirdness. Refactor in small, tested steps; do not rewrite.

**Mistake 4: blaming the previous developer.** They were under the same deadline pressure you are under now. The lesson is *systemic* (we let a class grow unchecked), not personal.

---

## 9. The minimum vocabulary

You should be able to use these terms in a code review:

- **God Class / Blob** — the antipattern itself.
- **Single Responsibility Principle (SRP)** — the design rule a God Class violates most directly.
- **Extract Class** — the refactor that splits one class into two.
- **Move Method** — the refactor that relocates a method to where its data lives.
- **Feature Envy** — when a method on class A keeps reaching into class B; often a clue that the method belongs on B.
- **Cohesion** — how tightly the members of a class belong together. A God Class has low cohesion.
- **Coupling** — how many other classes a class depends on. A God Class has very high coupling.

You will see all of these again in `middle.md` and `senior.md`.

---

## 10. Quick rules

- [ ] If a class has **more than 500 LOC**, ask hard questions.
- [ ] If a class has **more than 7 fields**, ask harder ones.
- [ ] If a class has **more than 15 public methods**, ask the hardest.
- [ ] If two teams keep editing the same class, it has two responsibilities — split.
- [ ] If a test needs more than 5 mocks, the system under test is too big.
- [ ] Extract one class per week; never rewrite.
- [ ] Name the smell out loud in code review — "this is becoming a God Class" is enough.

---

## 11. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Why God Classes grow, refactoring sketches                         | `middle.md`        |
| Detection metrics, tooling (PMD, SonarQube, JDepend), legacy cases | `senior.md`        |
| Architecture-level prevention, ArchUnit rules, Conway's Law        | `professional.md`  |
| Formal thresholds, LCOM4, sample PMD/Checkstyle configs            | `specification.md` |
| 10 buggy snippets to diagnose                                      | `find-bug.md`      |
| JIT inlining, code cache, megamorphic costs                        | `optimize.md`      |
| Hands-on exercises                                                 | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |
| Anemic Domain Model — the opposite extreme                         | `../02-anemic-domain-model/` |
| Feature Envy — the daily symptom                                   | `../03-feature-envy/` |
| Shotgun Surgery — the change-propagation smell                     | `../06-shotgun-surgery/` |
| SOLID — SRP is the principle being violated                        | `../../03-design-principles/01-solid-principles/` |

---

**Memorize this:** A God Class is the class that *knows too much, does too much, and depends on too much* — over 500 LOC, more than 7 fields, more than 15 methods, more than 5 constructor parameters. The fix is not one big rewrite; it is one *Extract Class* per week along the cohesion lines you can name.
