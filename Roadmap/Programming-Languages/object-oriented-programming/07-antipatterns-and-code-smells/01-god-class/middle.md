# God Class — Middle

> **What?** A working knowledge of *why* God Classes appear, *how* they hurt your team's velocity, and *which* refactoring moves shrink them without breaking production. We move from "I can spot a God Class" to "I can disassemble one safely over multiple PRs".
> **How?** By understanding the social and design forces that grow God Classes (organic growth, utility-class convenience, "just one more thing"), then by sequencing *Extract Class*, *Move Method*, *Extract Module*, and *Replace Conditional with Polymorphism* in the right order with the right safety nets.

---

## 1. Three forces that grow God Classes

You will recognise all three of these in legacy code you inherit. None of them is malice; all of them are rational under deadline.

**Force 1: organic growth ("just one more thing").** A ticket comes in: "add a 'last login' timestamp to user". The smallest possible patch is to add a field and a getter to `UserService`. Done in five minutes. Next week another ticket: "users need a password-reset flow". Smallest patch — add a method to `UserService`. Each ticket grows the class by 1–2%; over two years the class is 10x its original size.

**Force 2: utility classes.** `StringUtils`, `DateUtils`, `OrderUtils`. Helpful at first. But "utility" is not a responsibility — it is a *parking lot*. Anyone with a method that doesn't have an obvious home drops it in. Eventually the utility class has 80 unrelated static methods and is imported everywhere. It is a God Class with the static modifier.

**Force 3: facade ambition.** A team builds `OrderFacade` to "hide the complexity" of the order subsystem. The facade has fifteen methods on day one. Then it grows, because every new caller asks for one more method. The hidden complexity wasn't reduced; it was relocated *into the facade* — and now the facade is the God Class.

The lesson: God Classes do not appear from bad intent. They appear from the absence of a counter-force. The team's job is to provide that counter-force in code review — "this method does not belong on this class".

---

## 2. The damage, in priority order

When the class hits ~1,000 LOC, you start paying these costs every day:

### 2.1 Testing nightmare

```java
@Test
void cancellingOrderRefundsCard() {
    OrderManager m = new OrderManager(
        mock(Connection.class),
        mock(SmtpClient.class),
        mock(StripeClient.class),
        mock(RedisClient.class),
        mock(KafkaProducer.class),
        mock(S3Client.class),
        mock(MeterRegistry.class),
        mock(InvoiceTemplate.class),
        mock(CouponRegistry.class));
    // ... 40 lines of stubbing
    m.cancelOrder(42L, "customer_request");
    // ... 30 lines of verification
}
```

You needed nine mocks to test *one method*. Most of them have nothing to do with `cancelOrder`. They are there because the *class* needs them — not because the method does. The test is brittle: any new constructor argument added by anyone breaks every test.

### 2.2 Merge conflicts

Run `git log --pretty=format:%an OrderManager.java | sort -u` on a real God Class. You will see twelve names. Twelve people editing one file means that any pair of PRs touching it will conflict. Code review queues lengthen; rebases become hours of pain.

### 2.3 Fear of change

The class has 50 public methods and 30 private ones. Many of them share fields. Editing one method may break another in a way the type checker won't catch. Engineers grow afraid to touch it, so they wrap it in *yet another layer* of code that goes around the God Class. The dependency graph grows; the God Class survives.

### 2.4 Slow compile and IDE pain

A 5,000-line `.java` file with 60 imports re-triggers `javac` on every edit. IntelliJ inspections, code analysis, hot reload — all slow down. You feel it in your fingers: typing has perceptible lag in the worst files.

### 2.5 Onboarding cost

A new engineer cannot read a 4,500-line class and understand it. They read the smallest method first, then have to chase fields up and down the file, then trace helper methods. After two days they ask a teammate, "what does this class even do?" — and that question alone tells you the class has failed SRP.

---

## 3. The refactoring sequence

Disassembling a God Class is a *sequence*, not a single move. The order matters because each step needs the previous one to be safe.

### Step 1 — Add characterisation tests

Before you touch a line, write tests that pin down the *current* behaviour. These are not specifications of correct behaviour; they are *photographs* of what the class does right now. Michael Feathers calls them *characterisation tests* (*Working Effectively with Legacy Code*, 2004).

```java
@Test
void cancellationFlow_matchesGoldenSample_2024_07_15() {
    // Setup mirrors a real, recorded production case.
    Order o = givenOrderAsItWasOnThatDay();
    OrderManager m = newOrderManagerWithMocks();
    m.cancelOrder(o.id(), "customer_request");
    assertEquals(EXPECTED_REFUND_AMOUNT, capturedStripeRefund().amount());
    assertEquals(EXPECTED_EMAIL_SUBJECT, capturedEmail().subject());
}
```

This test fails when refactoring *changes* behaviour — even accidentally. The goal is *behaviour-preserving* refactor.

### Step 2 — Extract Method until the file shrinks visually

Long methods (≥40 lines) hide cohesive sub-units. Extract them into private methods first; you have not yet decided where they belong.

```java
// Before: one 120-line method
public Order createOrder(Long customerId, List<Long> productIds) {
    // 30 lines of validation
    // 25 lines of price calculation
    // 20 lines of inventory reservation
    // 25 lines of persistence
    // 20 lines of notification
}

// After: a coordinator with named steps
public Order createOrder(Long customerId, List<Long> productIds) {
    validateRequest(customerId, productIds);
    Pricing p = calculatePricing(productIds);
    reserveInventory(productIds);
    Order o = persistOrder(customerId, p);
    notifyOrderCreated(o);
    return o;
}
```

The class is no smaller, but its *shape* is now legible. Each private method becomes a candidate for *Move Method* in the next step.

### Step 3 — Move Method by cohesive cluster

Now find clusters of methods that share fields. Tools (PMD's `LCOM4`, SonarQube, the IDE's "Members" view) help here. A cluster is a candidate for Extract Class.

```java
// In OrderManager, these methods only touch couponUsage and discountRegistry:
private BigDecimal applyDiscounts(Order o, List<String> codes) { ... }
private boolean isCouponValid(String code) { ... }
private void recordCouponUsage(String code, Long orderId) { ... }
```

That cluster wants to be a `CouponService`.

### Step 4 — Extract Class

Pull the cluster out:

```java
public final class CouponService {
    private final CouponRegistry registry;
    private final Map<String, Integer> usage;

    public CouponService(CouponRegistry registry) {
        this.registry = registry;
        this.usage = new ConcurrentHashMap<>();
    }

    public BigDecimal apply(Order o, List<String> codes) { ... }
    public boolean isValid(String code) { ... }
    public void recordUsage(String code, Long orderId) { ... }
}

// OrderManager now holds a CouponService, not coupon-shaped fields and methods.
public class OrderManager {
    private final CouponService coupons;
    // ...
    public Order createOrder(...) {
        // ...
        BigDecimal discounted = coupons.apply(o, codes);
        // ...
    }
}
```

The God Class loses ~150 lines and 3 fields in one PR. Tests for `CouponService` no longer need a `Connection` or `StripeClient`.

### Step 5 — Repeat

Every God Class contains 5–10 hidden cohesive units. Extract them one at a time, each in its own PR, with passing characterisation tests at each step. After a quarter of work the God Class is a thin coordinator that orchestrates a half-dozen real classes.

---

## 4. Extract Module — when one class is several packages

Sometimes the cohesive clusters aren't even one class apart; they are one *package* apart. A 3,000-line `WarehouseManager` might want to become a `warehouse` package with `WarehouseInventory`, `WarehousePicker`, `WarehouseShipping`, `WarehouseReport` — four classes under one package. This is *Extract Module*: the refactor that separates *bounded contexts* hiding inside one class.

```
shop/
├── warehouse/                  (new package, the extracted module)
│   ├── WarehouseInventory.java
│   ├── WarehousePicker.java
│   ├── WarehouseShipping.java
│   └── WarehouseReport.java
└── order/
    └── OrderCoordinator.java   (was: OrderManager, now ~200 lines)
```

In Java 9+, you can further package the warehouse code into its own *module* (`module-info.java`) so the rest of the system cannot accidentally reach into its internals. See `professional.md` for the architecture-level discussion.

---

## 5. Replace Conditional with Polymorphism

A God Class often has a single method with a 200-line `switch` over an `OrderType` enum. Each case has its own validation, pricing, and lifecycle.

```java
// God Class internals — one method, multiple unrelated behaviours
public void processOrder(Order o) {
    switch (o.type()) {
        case STANDARD -> {
            // 40 lines specific to standard orders
        }
        case SUBSCRIPTION -> {
            // 50 lines specific to subscriptions
        }
        case PRE_ORDER -> {
            // 30 lines specific to pre-orders
        }
        case DIGITAL -> {
            // 35 lines specific to digital downloads
        }
    }
}
```

The fix is *polymorphism*: replace the switch with a strategy hierarchy.

```java
public sealed interface OrderProcessor permits
        StandardOrderProcessor, SubscriptionProcessor,
        PreOrderProcessor, DigitalOrderProcessor {
    void process(Order o);
}

public final class StandardOrderProcessor implements OrderProcessor {
    @Override public void process(Order o) { /* 40 lines */ }
}
// ...three more classes
```

The 155-line method shrinks to a dispatch:

```java
public void processOrder(Order o) {
    processors.get(o.type()).process(o);
}
```

The God Class has just shed 155 lines and four distinct change axes. Each `OrderProcessor` can evolve independently and is testable on its own.

---

## 6. The "Utility class" trap

`StringUtils`, `OrderUtils`, `DateUtils` — every codebase has at least one. The smell is the suffix *Utils* itself: it announces "I do not have a responsibility".

```java
public final class OrderUtils {
    public static BigDecimal calculateTax(Order o) { ... }
    public static String formatOrderId(Long id) { ... }
    public static byte[] renderInvoicePdf(Order o) { ... }
    public static boolean isExportable(Order o) { ... }
    public static Order parseFromCsv(String line) { ... }
    public static List<Order> filterByStatus(List<Order> all, OrderStatus s) { ... }
    // ... 30 more methods that share nothing but the noun "Order"
}
```

Each of these belongs on a different class with a real responsibility:

- `calculateTax` → `TaxCalculator`
- `formatOrderId` → `OrderId` (a value type)
- `renderInvoicePdf` → `InvoicePdfRenderer`
- `isExportable` → method on `Order` itself (where the data lives)
- `parseFromCsv` → `OrderCsvParser`
- `filterByStatus` → method on `List<Order>` callers via `Stream.filter(o -> o.status() == s)` — no helper needed at all

If you delete `OrderUtils` and distribute its methods, the codebase gets *more readable*, not less. The Utils class was hiding the design.

---

## 7. Behaviour belongs near data

The deepest reason God Classes hurt is that they *separate behaviour from the data it operates on*. The class holds a hundred fields and a hundred methods that mostly mutate those fields — the result is procedural code wearing OO clothes.

```java
// Anaemic + God: data and behaviour split awkwardly
public class Order {                              // anaemic — just fields
    public Long id;
    public BigDecimal subtotal;
    public List<LineItem> items;
}

public class OrderManager {                        // god — all behaviour
    public BigDecimal calculateTotal(Order o)            { ... }
    public boolean canBeCancelled(Order o)               { ... }
    public void applyLoyaltyDiscount(Order o, Customer c){ ... }
    // ... 47 more methods that take Order
}
```

The fix is to push behaviour onto `Order` itself (and into helper value objects):

```java
public final class Order {
    private final OrderId id;
    private final List<LineItem> items;
    private OrderStatus status;

    public Money total() { ... }              // moved from OrderManager
    public boolean cancellable() { ... }      // moved from OrderManager
    public Order applyDiscount(Discount d) { ... }   // returns a new Order
}
```

`OrderManager` shrinks dramatically because half its methods belonged on `Order`. This is the antidote to *Feature Envy* (`../03-feature-envy/`) and the bridge to *rich domain model* design.

---

## 8. The safety net during refactoring

You will be tempted to do a "small cleanup" in the same PR as a feature. Don't. Refactor and feature work belong in separate commits, and ideally separate PRs:

```
feat-xxx-1: add characterisation tests for OrderManager.cancelOrder
refactor-xxx-2: extract CouponService from OrderManager
refactor-xxx-3: move tax calculation to TaxCalculator
feat-xxx-4: support partial refunds            ← only now, on the cleaned class
```

This keeps each diff readable; if a regression appears, `git bisect` points at exactly the step that broke it.

---

## 9. What "done" looks like

You have successfully tamed a God Class when:

- It is under ~300 lines.
- It has under 7 fields.
- It has under 10 public methods.
- It coordinates real collaborators rather than holding all the logic itself.
- A new engineer can read it in 10 minutes and tell you what it does.
- A unit test needs ≤3 mocks.
- Two unrelated teams stop touching it in the same PR.

You will rarely get from "4,500-line god" to that state in one quarter. Aim for "20% smaller every quarter" — at that rate a God Class is gone within two years, while the team keeps shipping features.

---

## 10. Quick rules

- [ ] Refactor in small, characterised, tested steps — never rewrite.
- [ ] Extract by *cohesive cluster of fields*, not by file-half.
- [ ] Push behaviour onto the data it touches (kill *Feature Envy*).
- [ ] Replace `switch` over a type code with polymorphism (`sealed` + pattern match in modern Java).
- [ ] Delete the `*Utils` class and find real homes for its methods.
- [ ] Separate the *refactor PR* from the *feature PR*.
- [ ] Target: 300 LOC, 7 fields, 10 public methods, 3 mocks per test.

---

## 11. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Detection metrics (LCOM4, WMC, CBO), PMD/SonarQube, legacy cases   | `senior.md`        |
| Architecture-level prevention, ArchUnit rules, Conway's Law        | `professional.md`  |
| Formal thresholds, sample Checkstyle/PMD configs                   | `specification.md` |
| 10 buggy snippets to diagnose                                      | `find-bug.md`      |
| Inlining limits, code cache, megamorphic costs                     | `optimize.md`      |
| Hands-on exercises                                                 | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |
| Anemic Domain Model — the opposite extreme                         | `../02-anemic-domain-model/` |
| Feature Envy — the daily symptom                                   | `../03-feature-envy/` |
| Shotgun Surgery — the change-propagation smell                     | `../06-shotgun-surgery/` |
| SOLID — SRP is the principle being violated                        | `../../03-design-principles/01-solid-principles/` |

---

**Memorize this:** A God Class grows from three forces (organic growth, utility-class convenience, facade ambition) and dies from one discipline: *Extract Class along cohesive field clusters, one per PR, with characterisation tests as a safety net.* Refactor incrementally; never rewrite.
