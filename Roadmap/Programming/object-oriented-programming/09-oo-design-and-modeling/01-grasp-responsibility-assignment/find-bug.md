# GRASP — Find the Misassigned Responsibility

> Ten snippets, each with a responsibility placed on the wrong class. For each: read the code, decide *which GRASP pattern is violated and where the responsibility should live*, then check the diagnosis. These are the misassignments you'll actually see in real PRs — Feature Envy, infra-coupled domain, type-switches, bloated controllers, missing experts, over-fabrication, and unearned indirection.

---

## Snippet 1

```java
class TaxReport {
    String render(Employee e) {
        return e.getFirstName() + " " + e.getLastName()
             + " | gross: " + e.getSalary()
             + " | net: " + e.getSalary().subtract(e.getSalary().multiply(e.getTaxRate()));
    }
}
```

<details><summary>What's wrong?</summary>

**Information Expert violation (Feature Envy).** `render` uses *only* `Employee`'s data and none of `TaxReport`'s own. The net-pay calculation in particular operates entirely on `Employee`'s salary and tax rate.

**Fix:** Move the calculation onto `Employee` (`Employee.netPay()`) and expose `e.fullName()`. The report then *asks* the expert instead of reaching into its fields. This also removes the repeated `getSalary()` chains and respects the Law of Demeter.
</details>

---

## Snippet 2

```java
class Order {
    private List<OrderLine> lines;
    void save() {
        var em = Persistence.createEntityManagerFactory("app").createEntityManager();
        em.getTransaction().begin();
        em.persist(this);
        em.getTransaction().commit();
    }
}
```

<details><summary>What's wrong?</summary>

**Low Coupling violation — Information Expert misapplied.** `Order` has the data, so Information Expert *tempts* you to put `save()` here. But this couples the domain entity to JPA, makes it untestable without a persistence unit, and lowers cohesion (entity + persistence).

**Fix:** Pure Fabrication — extract an `OrderRepository` interface (Indirection) with a `JpaOrderRepository` implementation. `Order` keeps zero persistence imports. Information Expert is the first guess; Low Coupling overrules it at infrastructure boundaries.
</details>

---

## Snippet 3

```java
class NotificationSender {
    void send(Notification n) {
        switch (n.getType()) {
            case "EMAIL": new SmtpClient().send(n.getTo(), n.getBody()); break;
            case "SMS":   new TwilioClient().text(n.getTo(), n.getBody()); break;
            case "PUSH":  new FcmClient().push(n.getTo(), n.getBody()); break;
        }
    }
}
```

<details><summary>What's wrong?</summary>

**Polymorphism violation.** Behaviour varies by `type`, expressed as a `switch` on a string discriminator. Every new channel edits this method (an OCP violation too).

**Fix:** A `sealed interface Channel { void send(String to, String body); }` with `EmailChannel`, `SmsChannel`, `PushChannel` implementations. The `switch` becomes a single polymorphic `channel.send(...)`. Adding a channel adds a class and edits nothing. Combine with Protected Variations since the channel set is a known variation point.
</details>

---

## Snippet 4

```java
class PlaceOrderController {
    Receipt place(CartDto dto) {
        BigDecimal total = BigDecimal.ZERO;
        for (var i : dto.items()) total = total.add(i.price().multiply(BigDecimal.valueOf(i.qty())));
        if (total.compareTo(new BigDecimal("100")) > 0) total = total.multiply(new BigDecimal("0.9"));
        new JdbcTemplate(ds).update("INSERT INTO orders ...", total);
        return new Receipt(total);
    }
}
```

<details><summary>What's wrong?</summary>

**Controller bloat — three misassignments.** A Controller should delegate, not compute. Here it (1) calculates the total (Information Expert: belongs on `Order`/`Sale`), (2) applies a discount rule inline (Protected Variations: belongs behind a `DiscountPolicy`), and (3) runs SQL (Pure Fabrication: belongs in a repository).

**Fix:** `Order` computes its total; a `DiscountPolicy` applies the discount; an `OrderRepository` persists. The controller becomes `order = Order.from(dto); discountPolicy.apply(order); repo.save(order); return Receipt.of(order);` — pure delegation.
</details>

---

## Snippet 5

```java
class Customer {
    String name; List<Order> orders;
    String getName() { return name; }
    List<Order> getOrders() { return orders; }
}
class CustomerService {
    boolean isVip(Customer c) {
        return c.getOrders().stream()
                .map(o -> o.getTotal())
                .reduce(BigDecimal.ZERO, BigDecimal::add)
                .compareTo(new BigDecimal("10000")) > 0;
    }
}
```

<details><summary>What's wrong?</summary>

**Anemic domain — Information Expert ignored, Pure Fabrication over-applied.** `isVip` is a *business rule* operating purely on `Customer`'s own data (its orders), yet it lives in a service while `Customer` is a getter-only struct.

**Fix:** Move `isVip()` (and a `lifetimeValue()` helper) onto `Customer` — it's the Expert. `CustomerService` is fine for *cross-aggregate* or *infrastructural* work, but a rule over a customer's own orders belongs on `Customer`. This is the anemic-domain anti-pattern: behaviour drained off the entity into a service.
</details>

---

## Snippet 6

```java
class ReportController {
    void daily() {
        var rows = jdbc.query("SELECT * FROM sales WHERE day = CURRENT_DATE");
        var csv = rows.stream().map(r -> r.get("id") + "," + r.get("total")).collect(joining("\n"));
        Files.writeString(Path.of("/reports/daily.csv"), csv);
        new SmtpClient().send("ops@acme.com", "Daily report", csv);
    }
}
```

<details><summary>What's wrong?</summary>

**High Cohesion violation + Controller bloat.** One method queries the database, formats CSV, writes a file, *and* emails — four unrelated responsibilities (low cohesion) all in a controller that should only coordinate.

**Fix:** `SalesQuery` (repository/Expert) fetches; `CsvFormatter` (Pure Fabrication) formats; a `ReportStore` writes; a `Notifier` (Indirection) emails. The controller delegates the four steps. Each fabrication is independently testable and changes for one reason.
</details>

---

## Snippet 7

```java
class Game {
    Board board;
    Game() { this.board = BoardFactory.getInstance().createStandardBoard(); }
}
class BoardFactory {
    private static final BoardFactory I = new BoardFactory();
    static BoardFactory getInstance() { return I; }
    Board createStandardBoard() { return new Board(8, 8); }
}
```

<details><summary>What's wrong?</summary>

**Creator misapplied + unnecessary Indirection (over-engineering).** A `BoardFactory` singleton for a single, parameterless construction is ceremony. Creator says: `Game` *aggregates* its `Board` and has the initializing data (the dimensions), so `Game` is the natural creator. The factory's global singleton adds a hidden static coupling for no variation.

**Fix:** `this.board = new Board(8, 8);` directly in `Game`. Introduce a factory *only* when creation becomes complex (variants, pooling, conditional logic) or when board type is a predicted variation point. Indirection has a cost; don't pay it on spec.
</details>

---

## Snippet 8

```java
class ShippingCalculator {
    BigDecimal cost(Order order) {
        BigDecimal weight = BigDecimal.ZERO;
        for (var line : order.getLines())
            weight = weight.add(line.getProduct().getWeight().multiply(BigDecimal.valueOf(line.getQty())));
        return weight.multiply(new BigDecimal("2.50"));
    }
}
```

<details><summary>What's wrong?</summary>

**Information Expert violation (Feature Envy) — the weight calculation is in the wrong place.** `ShippingCalculator` reaches three dots deep (`order.getLines()` → `line.getProduct()` → `getWeight()`) to compute *the order's total weight*, which `Order` is the Expert for.

**Fix:** `Order.totalWeight()` (recursive Expert: `OrderLine.weight()` asks its product). The calculator then does `order.totalWeight().multiply(rate)` — it owns only the *rate-application* responsibility, which is legitimately its own. This splits the responsibility correctly: weight to the Expert, rate logic to the calculator.
</details>

---

## Snippet 9

```java
interface IOrderValidator { boolean validate(Order o); }
class OrderValidator implements IOrderValidator { public boolean validate(Order o) { return o.total().signum() > 0; } }
interface IOrderMapper { OrderDto map(Order o); }
class OrderMapper implements IOrderMapper { public OrderDto map(Order o) { /* ... */ } }
interface IPriceFormatter { String format(BigDecimal p); }
class PriceFormatter implements IPriceFormatter { public String format(BigDecimal p) { /* ... */ } }
```

<details><summary>What's wrong?</summary>

**Unearned Indirection (speculative generality).** Every class has a single-implementor interface with no test-seam need and no predicted second implementation. Protected Variations/Indirection has a real cognitive cost and only pays off against *actual or predicted* variation. Here it's pure ceremony — an interface per concrete class.

**Fix:** Delete the interfaces; depend on the concrete classes directly. These are pure functions with no infrastructure to stub, so there's no test seam to justify. Extract an interface *when* a second implementation actually arrives (a five-minute IDE refactor). Reserve interfaces for genuine variation points (payment providers, storage backends) and un-mockable boundaries.
</details>

---

## Snippet 10

```java
class OrderService {
    boolean canPlace(Customer customer, Order order) {
        BigDecimal outstanding = customer.getOpenOrders().stream()
                                         .map(Order::getTotal)
                                         .reduce(BigDecimal.ZERO, BigDecimal::add);
        return outstanding.add(order.getTotal()).compareTo(customer.getCreditLimit()) <= 0;
    }
}
```

<details><summary>What's wrong?</summary>

**This one is *correct* — the trap is "fix" it by forcing it onto an entity.** The rule "can this customer place this order?" spans *two* equally-relevant objects: `Customer` (credit limit, open orders) and `Order` (its total). There is *no single Information Expert*. Forcing it onto `Customer` or `Order` would make one entity reach into the other's data.

**Verdict:** A Pure Fabrication / domain service (`OrderService.canPlace(...)`, or an `OrderPlacementPolicy`) is the *right* home for cross-aggregate logic — this is exactly the case Information Expert *doesn't* cover. The only refinement: name it for the rule (`OrderPlacementPolicy`) rather than a vague `OrderService`, and lean on each entity's own experts (`customer.outstandingTotal()`, `order.total()`) so the policy only *orchestrates*. The lesson: not every service method is an anemic-domain smell — cross-aggregate rules legitimately live in fabrications.
</details>

---

**Pattern recap of the ten:** Feature Envy → Expert (1, 8); infra-coupled entity → Low Coupling + Pure Fabrication (2); type-switch → Polymorphism (3); controller bloat → delegate to Expert/Policy/Repository (4, 6); anemic domain → Expert reclaimed (5); over-engineering → Creator + drop Indirection (7); unearned interfaces → drop Indirection (9); and the *correct* cross-aggregate service that you must *not* force onto an entity (10). The recurring senior lesson: Information Expert is the default, but Low Coupling, cross-aggregate reality, and YAGNI each overrule it in specific, recognisable situations.
