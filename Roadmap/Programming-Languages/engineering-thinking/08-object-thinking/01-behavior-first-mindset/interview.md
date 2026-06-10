# Behavior-First Mindset — Interview Q&A

A focused set of questions on designing objects around what they *do*. The interviewer is testing whether you can defend the mindset under pressure, refactor an anemic class on a whiteboard, and recognize when behavior-first does not pay.

---

## Section A — Concepts (1-6)

**Q1. Explain the difference between data-first and behavior-first object design.**

A: Data-first opens a class file by typing fields — id, name, status, timestamps — and then bolts on getters, setters, and external services that do the real work. Behavior-first opens the same file by writing method signatures — `place()`, `cancel()`, `refund()` — and lets the fields appear only when a method demands them. The first produces structs surrounded by service classes; the second produces objects that own their rules. Same domain, same Java, opposite center of gravity.

Trap: a weak candidate says "it's the same thing, just different order." The order changes who owns the logic, which changes everything downstream — refactoring, testing, and where bugs accumulate.

---

**Q2. Why does David West call OOP a "culture of behavior"?**

A: Because West argues that OO was always meant to be about message-passing between agents with responsibilities, not about classifying nouns in a domain. In *Object Thinking* (2004) he points out that most "OO code" is procedural code wearing the keywords — classes, inheritance, methods — without the mindset. The mindset is: every object is a small actor that responds to messages and protects its own state. Strip that away and you have C with dot syntax.

Follow-up: cite Alan Kay's "I made up the term object-oriented and I can tell you I did not have C++ in mind." West is in the same camp. The cultural claim is that paradigm shifts are mental, not syntactic.

---

**Q3. What is the anemic domain model and why is it an anti-pattern?**

A: An anemic domain model is a set of classes that hold data and almost nothing else — fields, getters, setters, maybe `equals` — paired with a parallel set of `*Service` classes that contain all the logic. Martin Fowler named it as an anti-pattern in 2003 because it inverts OOP: the data is exposed, the rules are external, and invariants cannot be enforced at the source. Two services can apply contradictory rules to the same entity and neither one knows. The class loses the ability to say "no."

Trap: candidates often defend it as "separation of concerns." Separating *data* from *behavior* is not a concern — it is the negation of object thinking. Concerns separate by *responsibility*, not by *information vs operation*.

---

**Q4. When would you intentionally choose an anemic structure?**

A: Three honest cases. First, DTOs at the boundary — request bodies, response payloads, Kafka messages — where the type is a transport shape, not a domain object. Second, projections for read models in CQRS, where the type exists only to be serialized to the UI. Third, configuration carriers — POJOs whose only job is to be filled by a properties binder.

The rule: anemic is fine when the type is *not* a domain concept, just a data carrier crossing a boundary.

Follow-up: name them clearly — `OrderCreateRequest`, `OrderSummaryView`, `MailerProperties` — so the next reader knows they are not entities. A naming convention is cheap insurance against the wrong type drifting into the domain layer.

---

**Q5. What does "Tell, Don't Ask" mean? Give an example.**

A: Tell, Don't Ask says: send the object a command instead of pulling its state out and deciding externally. Asking version:

```java
if (account.getBalance().compareTo(amount) >= 0) {
    account.setBalance(account.getBalance().subtract(amount));
}
```

Telling version:

```java
account.withdraw(amount);
```

The first leaks the balance representation and scatters the overdraft rule across every caller. The second keeps the rule inside the account, where it can throw, log, or audit consistently.

Trap: candidates sometimes "tell" by passing a callback that reaches back in (`account.use(b -> ...)`). That is asking with extra steps. A real `tell` does not need to expose the state at all.

---

**Q6. Why does West call the noun-and-verb approach "paradigm tourism"?**

A: The folk teaching of OO says "underline the nouns in the requirements — those are your classes." That gives you `Customer`, `Order`, `Product`, `Invoice` and a parallel set of services. The classes are populated entirely from the domain dictionary; the verbs become method names on services, not on the nouns themselves. West calls this paradigm tourism because the codebase visits OO syntax without learning the mindset. A real OO design is built around *interactions* — what happens between objects — and lets the nouns drop out as participants in those interactions, not as the primary unit of design.

Follow-up: this is also why CRUD-flavored applications rarely benefit from heavy OO. CRUD has only four verbs and they all apply to every noun the same way. There is no behavior worth modeling.

---

## Section B — Applied design (7-14)

**Q7. How do you decide whether a method belongs on the object or on a service?**

A: Ask: does this operation need state that the object already owns, or does it coordinate *between* objects? If the operation reads or mutates one object's invariants, it belongs on that object — `order.cancel()`, `invoice.markPaid()`. If it choreographs several objects, talks to infrastructure, or owns a transaction boundary, it belongs in an application service — `CheckoutHandler.handle(cmd)`. The test: if you have to pass the object as the first argument to the service method, the method probably wanted to live on the object.

Follow-up: the service should orchestrate, not compute. Once the service starts containing `if/else` over the entity's state, the logic has drifted out and should be moved back.

---

**Q8. Critique this class.**

```java
public class Order {
    public Long id;
    public List<OrderLine> lines;
    public OrderStatus status;
    public BigDecimal total;
    public Long customerId;
    // getters and setters for all five
}
```

A: It is a struct, not an object. Five public fields means every caller can put the order into any state — `status = SHIPPED` without it ever being paid, `total` zero with twenty lines, `lines` mutated through the exposed list reference. The class cannot enforce a single invariant. There is no verb on it, so the rules live in `OrderService` and are duplicated across every call site that forgets to call it.

The fix is to make fields private, delete the setters, and introduce verbs — `addLine`, `place`, `pay`, `ship`, `cancel` — each guarded by a status check.

Trap: a weak candidate says "add validation in the setter." Validation in setters cannot enforce *transitions* — only single-field rules. `status = SHIPPED` is locally valid; only the verb `ship()` can check that the order was paid first.

---

**Q9. What is feature envy and how does it relate to behavior-first?**

A: Feature envy is a method in class A that uses data from class B more than its own — many calls to `b.getX()`, `b.getY()`, arithmetic on B's fields, decisions about B's state. It signals the method belongs on B. Behavior-first thinking prevents feature envy at the source: if you write `b.calculateDiscount()` rather than `b.getPrice()` and `b.getCustomer().getTier()`, the logic never wanders.

Feature envy is what an anemic codebase looks like under a refactoring lens. Every `*Service` class is, by definition, a collection of feature-envious methods.

Follow-up: IntelliJ and SonarQube both flag this. The fix is almost always Move Method into the envied class. The harder fix is to move the *responsibility*, which sometimes requires splitting the original class.

---

**Q10. How would you refactor a 30-getter, 2-method class?**

A: Step by step, not in one shot. First, list every external caller and group them by *intent* — "callers that compute total", "callers that check shippability", "callers that build the invoice line." Each cluster is a method that wants to exist on the class. Second, introduce those methods alongside the getters, copy the logic in, and have callers switch one at a time. Third, when a getter has no remaining callers, delete it. By the end the ratio inverts: fewer fields exposed, more verbs that say what the object does.

Trap: do not try to delete getters first. Frameworks, serializers, and tests will be reading them, and an atomic rewrite stalls. Strangle the getters, do not amputate them.

Follow-up: this is exactly the *Strangler Fig* pattern at the class level. The same principle that lets you replace a legacy system works inside a single file.

---

**Q11. Walk me through designing an `Order` class behavior-first. Start with the verbs.**

A: Verbs first, no fields. What does an order *do* in the world? It gets *placed* by a customer with some lines. It *adds* and *removes* lines while still a draft. It is *paid for*. It is *shipped*. It is *cancelled*, but only before shipping. It is *refunded* after delivery. That gives me:

```java
public class Order {
    public static Order place(Customer c, List<OrderLine> lines) { ... }
    public void addLine(Product p, int qty)                      { ... }
    public void removeLine(Product p)                            { ... }
    public Payment payWith(PaymentMethod pm)                     { ... }
    public Shipment ship(Carrier carrier)                        { ... }
    public void cancel(Reason r)                                 { ... }
    public Refund refund(Money amount, Reason r)                 { ... }
}
```

Only now do I ask what the order must remember: the lines, the current status, the customer reference, the payment if any. Those become private fields, sized to support exactly those verbs.

Follow-up: each verb encodes a state transition. The status field exists because `pay` must reject an already-paid order — not because "an order has a status." Fields are *consequences* of behavior, not the other way around.

---

**Q12. Is a `record` an anemic class? Defend your answer.**

A: It depends on what you put on it. A `record` with only auto-accessors and nothing else is anemic — a tuple. But records are not *required* to be anemic: you can add methods, you can validate in the compact constructor, and you can keep the type immutable. A record for `Money` with `add`, `subtract`, `multiply`, and `times(BigDecimal)` is a rich value object even though it is a record:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        if (amount.signum() < 0) throw new IllegalArgumentException("negative");
    }
    public Money plus(Money other)    { requireSame(other); return new Money(amount.add(other.amount), currency); }
    public Money times(BigDecimal n)  { return new Money(amount.multiply(n), currency); }
    private void requireSame(Money m) { if (!currency.equals(m.currency)) throw new IllegalStateException(); }
}
```

The shape is anemic; the contents need not be.

Trap: people assume "record == DTO." Records were introduced as a general-purpose nominal tuple, and Brian Goetz has been explicit that they are appropriate for rich value objects too.

---

**Q13. Name a Java framework that *fights* behavior-first design and explain why.**

A: JPA/Hibernate is the canonical example, though Jackson and Spring `@ConfigurationProperties` press in the same direction. Hibernate, in its classic configuration, expects a no-arg constructor, mutable fields it can populate by reflection, and getters/setters so it can manage proxies and dirty checking. That pressure pushes entities toward POJOs with setters everywhere, which is exactly the data-first shape. You can resist — field access, private setters, factory methods, `AccessType.FIELD` — but the path of least resistance is anemic.

Follow-up: name the alternatives — keep the JPA entity thin but wrap it in a domain object, or use a separate persistence model from the domain model (DDD's repository pattern). The cost is one more class; the gain is that the domain is no longer hostage to the ORM.

---

**Q14. How do you spot a hidden service-class problem during code review?**

A: Look for three signatures. First, a class named `*Service`, `*Manager`, `*Processor`, `*Handler` whose methods take the entity as the first argument — `orderService.cancel(order, reason)` is `order.cancel(reason)` in disguise. Second, repeated `if (entity.getStatus() == ...)` checks across multiple services — state machine logic that wants to live on the entity. Third, getters used immediately followed by setters with arithmetic in between — Tell, Don't Ask violations.

Each is a refactoring target: Move Method into the entity, Replace Conditional with Polymorphism, replace getter/setter pair with a verb.

Follow-up: name the smells out loud during review — "Feature Envy", "Anemic Domain Model", "Primitive Obsession" — so the next reviewer learns the vocabulary. A team that shares names for smells refactors faster.

---

## Section C — Pressure points (15-20)

**Q15. How does behavior-first thinking interact with JPA/Hibernate?**

A: Friction, but not a fight you have to lose. The compromises that work: use field access (`@Access(AccessType.FIELD)`) so you do not need public getters and setters; make setters package-private or remove them entirely and mutate through verbs; use a protected no-arg constructor that Hibernate can call but other code cannot; validate in the verbs, not in setters.

```java
@Entity
@Access(AccessType.FIELD)
public class Order {
    @Id private Long id;
    @Enumerated private OrderStatus status;
    @OneToMany(cascade = ALL) private List<OrderLine> lines = new ArrayList<>();

    protected Order() {}                              // for Hibernate
    public static Order place(Customer c) { ... }     // for everyone else
    public void cancel(Reason r) { ... }
}
```

The remaining tax is that the entity must be reconstitutable from the database, so some fields are technically settable by the framework. That is acceptable — the public API still tells, does not ask.

Trap: candidates either say "JPA forces anemic models" (false, just lazy) or "use DDD aggregates everywhere" (overkill for CRUD).

---

**Q16. How do you keep behavior in the domain when DTOs cross the wire?**

A: Treat DTOs as a translation layer, not as the domain. The controller accepts `OrderCreateRequest`, validates it shallowly (size, presence, format), then calls a domain factory `Order.place(customer, lines)` that owns the real rules. On the way out, the domain object is mapped to `OrderResponse` for the client. The DTOs are anemic on purpose; the domain object in the middle is rich.

Mapping libraries (MapStruct) or hand-written mappers do the bridging. The rule: rules live on the entity, shapes live on the DTO.

Follow-up: avoid the "DTO is also the entity" shortcut. Once one type plays both roles, validation rules leak into the controller and serialization concerns leak into the domain. Two types, one mapper, less drift.

---

**Q17. When does behavior-first hurt rather than help?**

A: Four cases. First, pure transport types — adding behavior to a DTO is noise. Second, frozen schemas owned by another team, where the type is a contract and any method is your guess at their semantics. Third, throwaway scripts and one-shot migrations, where ceremony costs more than it saves. Fourth, classes that genuinely *are* records of fact — an audit log entry, a metric sample — where the only legitimate operation is to read the fields. Forcing verbs onto these inflates code without protecting anything.

Trap: a weak candidate says "always behavior-first." Dogma at this level is a signal of inexperience. The senior answer names exceptions and justifies them by purpose, not by laziness.

---

**Q18. How does behavior-first interact with serialization frameworks like Jackson?**

A: Carefully. Jackson by default wants a no-arg constructor and setters, which is the anemic shape. The behavior-first answer is to use constructor binding (`@JsonCreator`) so the type is fully constructed in one step, or to serialize a separate DTO and keep the domain object untouched. Records work especially well here — Jackson supports them natively via canonical constructors.

```java
public record OrderCreateRequest(
    @NotNull Long customerId,
    @Size(min = 1) List<LineRequest> lines
) {}
```

The point is to keep Jackson's needs at the boundary, not let them dictate the shape of every entity in the system.

Follow-up: the same principle applies to Gson, Moshi, and protobuf-generated types. Boundary types serve the wire; domain types serve the model. Two layers, one mapper between them.

---

**Q19. What's the cost of going too far — making everything a rich object?**

A: Three real costs. Boilerplate: every primitive wrapped in a value object means more files and more constructors. Mapping pain: every boundary requires translation, so DTOs multiply. Cognitive load: contributors who expect getters and setters now have to learn the domain vocabulary before they can do anything.

The honest stance is: be rich where the rules live, be anemic where the data only passes through. Over-applying behavior-first turns a codebase into a private dialect that new hires need a week to read.

Trap: "Money over BigDecimal everywhere" is a classic over-rotation. Wrap when arithmetic and validation justify it, not as a tax. The threshold is "does this primitive participate in a rule?" — if not, leave it.

---

**Q20. A teammate says "fields first is faster, behavior emerges later." How do you respond?**

A: Empirically it does not. Starting with fields creates a gravitational pull toward exposing them — once they exist with a generated getter, every caller takes the path of least resistance and reads directly. The "behavior emerges later" promise becomes "behavior accrues in services later," which is the anemic shape. Starting with method signatures, even empty ones, costs five minutes and shapes the rest of the design.

The cost is not the typing; it is the missed invariants you only discover when you write the verb.

Trap: the teammate may be conflating "behavior-first" with "design up front." Behavior-first is local — about one class, one editing session — not a Big Design. It is a habit, not a methodology.

---

## Section D — Senior-level (21-26)

**Q21. How does behavior-first interact with Domain-Driven Design?**

A: It is the prerequisite. DDD's aggregate root, entity, value object, and domain service distinctions only make sense if you already think in terms of behavior — an aggregate is a *boundary of behavior*, not a boundary of data. Without behavior-first thinking, "aggregate root" becomes "the class with the `@Id` annotation," and the model collapses back to entities and services.

Behavior-first is the small daily habit; DDD is the architectural pattern language on top of it.

Follow-up: Eric Evans's *Domain-Driven Design* (2003) and West's *Object Thinking* (2004) cite each other's lineage — both descend from the same Smalltalk-era line. Reading them in that order is the canonical path.

---

**Q22. How does behavior-first thinking affect testability?**

A: It usually improves it, in a specific way. Tests against an anemic model end up exercising the service classes and have to mock or fake everything the service touches — repositories, mappers, clocks. Tests against a rich model can exercise the verb directly: construct the entity in a state, call `cancel(reason)`, assert the outcome.

```java
@Test
void cancelling_a_shipped_order_throws() {
    var order = Order.place(customer, lines).payWith(card).ship(carrier);
    assertThrows(IllegalStateException.class, () -> order.cancel(Reason.CHANGED_MIND));
}
```

No mocks, no Spring context, no database. The state machine is exercised in microseconds.

The trade is that some tests must reproduce setup that the database used to give you for free. That is a fair price for tests that do not flake on infrastructure.

Trap: "we cannot test rich models because they need persistence." If your entity needs persistence to be tested, the persistence has leaked into the entity.

---

**Q23. Sketch a class that has behavior but no fields.**

A: Plenty exist. A stateless strategy:

```java
public final class VatCalculator {
    public Money taxOn(Money amount, Country c) {
        return amount.times(c.vatRate());
    }
}
```

No fields, all behavior. This is fine — it is a service, named honestly. The point of behavior-first is not "every class must have fields" but "fields exist to support verbs." A pure-function class is the limit case, and it is still behavior-first because there is no exposed state to confuse the model.

Follow-up: this kind of stateless calculator is a legitimate use of a `*Calculator`, `*Policy`, or `*Strategy` class — far better than `*Service` classes that secretly hold mutable state.

---

**Q24. How would you onboard a team that has shipped an anemic codebase for years?**

A: Not with a lecture. Pick one painful entity — typically the order, account, or invoice — and run a refactoring kata in a pairing session, ending with a richer version that passes the same tests. Then introduce one review rule: every new entity ships with at least one verb beyond getters and setters. Track the ratio of methods to fields per class in a dashboard if you want a leading indicator.

Cultural change in code follows visible artifacts, not slides. One refactored class that everyone touches becomes a template by example.

Trap: declaring "no more services" overnight. Services are not the disease; the uncritical service-first reflex is. Some services are correct — orchestrators, schedulers, gateways. Distinguish the legitimate ones by name and purpose.

---

**Q25. Give a small snippet that violates behavior-first and rewrite it.**

A: Before:

```java
public BigDecimal totalFor(Cart cart) {
    BigDecimal total = BigDecimal.ZERO;
    for (CartItem item : cart.getItems()) {
        total = total.add(item.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
    }
    if (cart.getCustomer().isPremium()) {
        total = total.multiply(BigDecimal.valueOf(0.9));
    }
    return total;
}
```

The cart and customer are queried for everything; the rule lives in the caller. After:

```java
public Money totalFor(Cart cart) {
    return cart.total();    // cart.total() knows about premium discounts
}
```

The cart now owns the rule. If the discount changes, one place changes. If a new caller appears, it cannot get the rule wrong.

Trap: a weak candidate refactors by extracting `totalFor` into a method on `CartService`. That moves the smell, it does not fix it.

---

**Q26. The future of behavior-first in Java — what helps, what hurts?**

A: Helps: records and sealed types make it cheap to define rich value objects and closed hierarchies, both of which are behavior-first natural fits. Pattern matching reduces the temptation to switch on `getType()`. Java 21+ virtual threads make per-entity behavior cheaper to test in parallel. Project Valhalla, when it lands, will make value objects with verbs nearly free at the machine level.

Hurts: reflection-heavy frameworks (some JSON binders, some ORM defaults) keep pressing toward the anemic shape, and AI-generated code tends to produce the data-first template by default because that is what most of its training data looks like. The net trend is positive, but the discipline still has to be applied by hand.

Follow-up: if you have to name one feature that most changed everyday Java toward behavior-first, name records — they made immutable verbs-on-values cheap enough to default to. Before records, every `Money` and `Coordinate` class was a 40-line POJO most teams could not afford to write.

---

**How to use this list:** pick one from each section and you have a 30-minute interview. Strong candidates do not just define "anemic domain model" — they refactor one on the whiteboard, then defend where they would still leave the model anemic and why. The signal is judgment, not dogma.
