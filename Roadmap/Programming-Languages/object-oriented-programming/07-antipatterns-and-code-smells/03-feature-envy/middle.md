# Feature Envy — Middle

> **What?** A working catalogue for detecting Feature Envy in real code and fixing it with the right refactoring. The junior file taught the smell; this file teaches you to *find* it consistently, *measure* it roughly, *choose* between Move Method / Extract+Move / Replace Data Value With Object, and apply *Tell Don't Ask* as the underlying design force.
> **How?** Walk through every method longer than ten lines and ask the four detection questions in section 2. When one answers "yes", pick the matching refactoring from section 4 and apply it as a small, reviewable diff — never as a sweeping rewrite.

---

## 1. Detection — the four questions

Open the method. Ask, in order:

1. **What does it touch?** Count the *distinct objects* the method reads from. If exactly one foreign object dominates, you're in classic Feature Envy territory. If two or three foreign objects share the load, you may have *Inappropriate Intimacy* across multiple classes instead.
2. **What is its locality?** Compute roughly: `local_accesses / (local_accesses + foreign_accesses)`. Below 1/3 is the formal threshold Lanza and Marinescu use for LAA (Locality of Attribute Accesses) — see `specification.md`. Below 1/2 is a gut-feel smell.
3. **What is its name?** Methods named `xFor(B)`, `xOf(B)`, `summariseB`, `processB`, `validateB` are advertising envy in their names.
4. **What is its return type?** A method on `A` that returns *something computed from `B`'s state* — a discount on `Customer`, a label from `Address`, a tax from `Region` — almost always belongs on `B`.

If two or more of the four answer "yes", schedule the refactor. If all four fire, do it now.

---

## 2. A worked example — three-stage refactor

We'll take a realistic envious method and refactor it in three passes: *Extract Method* to isolate the envy, *Move Method* to relocate it, then *clean up the getters* that the envy was using.

```java
// Stage 0 — original
public class InvoiceProcessor {
    public InvoiceSummary summarise(Invoice invoice, Customer customer) {
        // local scaffolding (this isn't envy)
        InvoiceSummary summary = new InvoiceSummary(invoice.getId());

        // foreign block — every line reads Customer
        BigDecimal tier;
        if (customer.getMembershipTier().equals("GOLD")) tier = new BigDecimal("0.15");
        else if (customer.getMembershipTier().equals("SILVER")) tier = new BigDecimal("0.10");
        else tier = BigDecimal.ZERO;
        BigDecimal loyalty = BigDecimal.ZERO;
        if (customer.getLoyaltyPoints() > 1000) loyalty = new BigDecimal("5");
        if (customer.getYearsActive() > 5) loyalty = loyalty.add(new BigDecimal("2.50"));
        BigDecimal discount = invoice.getSubtotal().multiply(tier).add(loyalty);

        // local: assembling the summary
        summary.setSubtotal(invoice.getSubtotal());
        summary.setDiscount(discount);
        summary.setTotal(invoice.getSubtotal().subtract(discount));
        return summary;
    }
}
```

Five getter calls on `Customer`, two on `Invoice`. The `Customer` block is the envious one — it's pure computation about `Customer`'s state. Refactor in three passes:

### Pass 1 — Extract Method

Isolate the envious block as a private method, *still on `InvoiceProcessor`*. This is a mechanical IDE refactor.

```java
public class InvoiceProcessor {
    public InvoiceSummary summarise(Invoice invoice, Customer customer) {
        InvoiceSummary summary = new InvoiceSummary(invoice.getId());
        BigDecimal discount = computeDiscount(invoice.getSubtotal(), customer);
        summary.setSubtotal(invoice.getSubtotal());
        summary.setDiscount(discount);
        summary.setTotal(invoice.getSubtotal().subtract(discount));
        return summary;
    }

    private BigDecimal computeDiscount(BigDecimal subtotal, Customer customer) {
        BigDecimal tier;
        if (customer.getMembershipTier().equals("GOLD")) tier = new BigDecimal("0.15");
        else if (customer.getMembershipTier().equals("SILVER")) tier = new BigDecimal("0.10");
        else tier = BigDecimal.ZERO;
        BigDecimal loyalty = BigDecimal.ZERO;
        if (customer.getLoyaltyPoints() > 1000) loyalty = new BigDecimal("5");
        if (customer.getYearsActive() > 5) loyalty = loyalty.add(new BigDecimal("2.50"));
        return subtotal.multiply(tier).add(loyalty);
    }
}
```

The envy is now in a single method, signposted as "this reads `Customer` extensively". The next move is mechanical.

### Pass 2 — Move Method

Move `computeDiscount` to `Customer`. The signature drops the `Customer` parameter (it becomes `this`); `subtotal` stays.

```java
public class Customer {
    private String membershipTier;
    private int loyaltyPoints;
    private int yearsActive;

    public BigDecimal discountOn(BigDecimal subtotal) {
        BigDecimal tier = switch (membershipTier) {
            case "GOLD"   -> new BigDecimal("0.15");
            case "SILVER" -> new BigDecimal("0.10");
            default       -> BigDecimal.ZERO;
        };
        BigDecimal loyalty = BigDecimal.ZERO;
        if (loyaltyPoints > 1000) loyalty = new BigDecimal("5");
        if (yearsActive > 5) loyalty = loyalty.add(new BigDecimal("2.50"));
        return subtotal.multiply(tier).add(loyalty);
    }
}

public class InvoiceProcessor {
    public InvoiceSummary summarise(Invoice invoice, Customer customer) {
        InvoiceSummary s = new InvoiceSummary(invoice.getId());
        BigDecimal discount = customer.discountOn(invoice.getSubtotal());
        s.setSubtotal(invoice.getSubtotal());
        s.setDiscount(discount);
        s.setTotal(invoice.getSubtotal().subtract(discount));
        return s;
    }
}
```

### Pass 3 — Clean up the getters

`getMembershipTier`, `getLoyaltyPoints`, `getYearsActive` were only used by the envious code. Check for other callers (`grep` or *Find Usages*). If none, delete the getters. If a few callers exist, evaluate whether each is also envious — usually they are, and you have a whole cluster of moves to do.

This three-pass discipline keeps each commit small and reviewable. The build passes after pass 1. The build passes after pass 2. The build passes after pass 3. No big-bang rewrite, no broken master, no scary diff.

---

## 3. The refactoring catalogue

Fowler's *Refactoring* (2nd ed., Addison-Wesley, 2018) lists the moves you'll use. The right move depends on *what's envious*.

| Symptom                                              | Refactoring                          | Fowler reference        |
| ---------------------------------------------------- | ------------------------------------ | ----------------------- |
| Whole method is envious of one class                 | **Move Method**                      | *Refactoring* ch. 8     |
| Part of a method is envious                          | **Extract Method**, then **Move Method** | *Refactoring* ch. 6, 8 |
| Envious of a primitive (e.g., a `String` representing a date) | **Replace Data Value with Object**, then Move Method | *Refactoring* ch. 7 |
| Envy is split across two classes equally             | **Move Method** *and* **Move Field** | *Refactoring* ch. 8     |
| Envious method passes the foreign object through many getters | Fix Law of Demeter first (Hide Delegate) | *Refactoring* ch. 7 |
| Many envious methods on many callers → field belongs elsewhere | **Move Field**                  | *Refactoring* ch. 8     |
| Foreign data is just a property bag with envy everywhere | Promote to a real class with behaviour (Replace Data Class) | — |

The cluster *Extract Method + Move Method + Move Field* together is the bread-and-butter combination. Most refactors need two of the three.

---

## 4. Tell Don't Ask — the underlying force

Feature Envy is a *symptom*. The disease is that the envious method is *asking* the foreign object for its raw fields and computing the answer outside, when it should *tell* the foreign object what to do and trust it to answer.

Andy Hunt and Dave Thomas put this in *The Pragmatic Programmer* (Addison-Wesley, 1999):

> "Don't ask an object for the information you need to do a job; instead, ask the object that has the information to do the job for you."

Practical translation: a method that reads `customer.getX()`, `customer.getY()`, `customer.getZ()` and then computes `f(x, y, z)` should be replaced by a method `customer.f()`. The information moves nowhere — the *responsibility* moves to where the information lives.

```java
// Asking — every caller knows the rule
if (account.getBalance().compareTo(amount) >= 0
        && account.getStatus() == Status.ACTIVE
        && !account.isFrozen()) {
    transfer(account, amount);
}

// Telling — Account decides whether it can
if (account.canDebit(amount)) {
    transfer(account, amount);
}
```

The second form has *one* place where the "can this account be debited" rule lives. The first has the rule splattered across every caller, each of which will drift independently when a new condition (`isUnderInvestigation`) is added.

Tell Don't Ask also helps thread-safety: `account.canDebit(amount)` can be synchronised internally; the asking form has the check-then-act race built in.

---

## 5. The Law of Demeter connection

Demeter's Law (Ian Holland, Karl Lieberherr, 1987): a method on `A` should only talk to (a) itself, (b) its parameters, (c) objects it creates, and (d) its own fields. *Not* to objects reached through chains.

```java
// Demeter violation — chain through three classes
String city = order.getCustomer().getAddress().getCity();

// Often co-occurs with Feature Envy on the same chain
String label = order.getCustomer().getName() + ", "
             + order.getCustomer().getAddress().getStreet() + ", "
             + order.getCustomer().getAddress().getCity();
```

When you see a long chain like this, two smells exist at once: Demeter violation (your code knows the internal shape of `Order → Customer → Address`) and Feature Envy (the formatting belongs on `Address`, possibly on `Customer`). Fix Demeter first — *Hide Delegate* introduces a method on `Order` that delegates inward:

```java
public class Order {
    public String shippingLabel() {
        return customer.shippingLabel();
    }
}
public class Customer {
    public String shippingLabel() {
        return name + ", " + address.singleLine();
    }
}
public class Address {
    public String singleLine() {
        return street + ", " + city;
    }
}
```

Each class now exposes a single high-level method and hides its internals. The chain is gone; the envy is gone.

---

## 6. False positives — methods that *look* envious but aren't

Three patterns that fire detection rules but are *correct* designs:

**Mappers and projectors.** A method whose job is to translate between layers (`OrderEntity → OrderDto`, `Aggregate → ReadModel`) will read every field of one object and assemble another. Tools flag this; reviewers shouldn't. The mapper is *intentionally* the seam between layers — moving the mapping onto the entity would couple the domain to the DTO format.

```java
// Looks envious, is correct — this is a mapper
public class OrderDtoMapper {
    public OrderDto toDto(Order order) {
        return new OrderDto(
            order.getId().toString(),
            order.getCustomer().getName(),
            order.getTotal().toPlainString(),
            order.getStatus().name()
        );
    }
}
```

**Comparators and policies.** A `Comparator<Order>` compares two `Order` instances. Of course it reads both objects' fields — that's its definition. The behaviour doesn't belong on `Order` because comparison criteria vary (by date, by total, by customer); each strategy is its own class.

**Visitors.** A `BalanceSheetVisitor.visit(Asset a)` reads every field of `a`. The Visitor pattern's whole point is to put *operations* on one class and *data* on another. Senior file (`senior.md`) treats this in detail.

If you've identified a method as one of these three, your detection was right — but the move is "leave alone", not "refactor".

---

## 7. When the envy is across an aggregate boundary

In Domain-Driven Design, an *aggregate* is a cluster of objects treated as one unit. Inside the aggregate, methods reading sibling objects' fields are normal — they're inside the encapsulation boundary. Cross-aggregate envy is the bug.

```java
// Inside one aggregate — not envy, just internal collaboration
public class Order {                          // aggregate root
    private final List<LineItem> items;       // owned by Order

    public BigDecimal total() {
        return items.stream()
                .map(LineItem::lineTotal)     // reads LineItem; both inside the aggregate
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}

// Across aggregates — this is real envy and a DDD violation
public class Order {
    public BigDecimal discountedTotal(Customer customer) {
        // Customer is a separate aggregate;
        // reaching into its loyalty fields is cross-boundary envy
    }
}
```

The rule of thumb: envy *inside* an aggregate is normal; envy *across* aggregates breaks the bounded context and is the real smell. The fix is either to bring the data inside (sometimes — usually wrong), or to pass a value object that captures *only* the relevant information (right — sometimes called a *parameter object*).

---

## 8. Detection tooling

| Tool          | What it flags                                                  |
| ------------- | -------------------------------------------------------------- |
| IntelliJ IDEA | Inspection "Feature Envy" under *Class structure* — configurable threshold for foreign vs local accesses. |
| SonarJava     | Indirect — rules `S1448` (Methods should not have too many lines), `S3776` (Cognitive Complexity), `S1188` (Anonymous classes too large) often fire together with envy. `S3398` flags methods that should be moved to a parameter's class. |
| PMD           | `LawOfDemeter` rule catches the chain-of-getters that often signals envy. |
| Checkstyle    | `ClassDataAbstractionCoupling` and `ClassFanOutComplexity` give cluster-level signals. |
| JArchitect / NDepend | `LCOM` (Lack of Cohesion of Methods) — high LCOM on `A` while `B`'s methods are short can hint that `A` is hoarding behaviour that should be on `B`. |

None of these tools *prove* envy — they raise candidates. The decision is always the reviewer's. A high-ATFD method (see `specification.md`) might be a mapper (false positive) or a critical envy hot spot. Tooling narrows the field; human judgement decides.

---

## 9. A common gotcha — envy on a record

Records (JEP 395, Java 14+) make Feature Envy easier to commit, because records *invite* outside computation by being pure data carriers.

```java
public record Customer(String tier, int loyaltyPoints, int yearsActive) {}

// Smelly — Order computing things from the record's fields
public class Order {
    public BigDecimal discount(Customer c) {
        if (c.tier().equals("GOLD")) ...
        if (c.loyaltyPoints() > 1000) ...
    }
}
```

Records can absolutely have methods. They are *value objects*, not anaemic DTOs. Add the behaviour:

```java
public record Customer(String tier, int loyaltyPoints, int yearsActive) {

    public BigDecimal discountOn(BigDecimal subtotal) {
        // ...
    }
}
```

The compiler-generated accessors stay (`tier()`, `loyaltyPoints()`); your domain methods join them. The record is still a value carrier — its single responsibility is "a customer's loyalty data plus the rules for using it". That's one responsibility, not two.

---

## 10. Quick rules

- **Detect:** more foreign accesses than local, suspicious method name, returns a computed property of the foreign object → schedule a move.
- **Fix small:** Extract Method first, Move Method second, clean up getters third. Three small commits, not one giant diff.
- **Demeter:** chains like `a.getB().getC().getD()` usually hide envy two classes deep. Fix Demeter first (Hide Delegate), then envy is often gone.
- **Tell Don't Ask:** prefer `account.canDebit(amount)` to `if (account.getBalance() ≥ amount && ...)`.
- **Records:** records can have methods. Anaemic records that exist only for outside code to read are still a smell.
- **Aggregates:** envy *inside* a DDD aggregate is internal collaboration; envy *across* aggregates is the real bug.
- **False positives:** mappers, comparators, visitors *intentionally* read another class's fields. Don't refactor them.

---

## 11. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Legitimate envy (Strategy, Visitor), IntelliJ + SonarJava in depth | `senior.md`        |
| Architectural variants — anaemic services, DTOs, DDD aggregates    | `professional.md`  |
| Metrics — ATFD, FDP, LAA — Lanza & Marinescu thresholds            | `specification.md` |
| 10 numbered scenarios — diagnose and fix                           | `find-bug.md`      |
| Performance angles — getter chains, JIT inlining, cache locality   | `optimize.md`      |
| 8 exercises with worked solutions                                  | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |

---

**Memorize this:** Extract the envious block, Move it to where its data lives, then delete the getters that supported it. Three commits, three letter grades up on the code review.
