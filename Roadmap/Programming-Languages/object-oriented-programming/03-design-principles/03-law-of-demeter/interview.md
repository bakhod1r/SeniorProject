# Law of Demeter — Interview Q&A

20 questions covering the law's statement, trade-offs, snippet critiques, and senior-level judgement calls.

---

## Q1. What is the Law of Demeter, and who coined it?

The Law of Demeter (LoD), also called the **Principle of Least Knowledge**, says a method `m` of object `O` should only call methods on: (1) `O` itself, (2) parameters of `m`, (3) objects `m` creates locally, and (4) `O`'s direct fields. It forbids reaching *through* one object to call methods on another (`a.getB().getC().doX()`). Karl Lieberherr and Ian Holland introduced it in a 1989 IEEE paper from Northeastern University's "Demeter" project. The point isn't the dot count — it's *structural coupling*: every dot through a collaborator binds your method to that collaborator's shape.

**Follow-up:** "Why 'Demeter'?" — named after the project, which itself was named after the Greek goddess of grain growth, an oblique reference to "growing software systems".

---

## Q2. Give the standard train-wreck example and the fix.

```java
order.getCustomer().getAddress().getCountry().taxFor(order);
```

Four classes' internals leak into one method. Fix by pushing the intent to the topmost object: `order.taxAmount()`. Inside `Order`, write `customer.taxAmount(this)`; inside `Customer`, `address.taxAmount(order)`; inside `Address`, `country.taxFor(order)`. Each method now talks to one collaborator. A reshape of `Address` (e.g., inserting `Region`) is one method change inside `Address`, not 20 across the codebase.

**Trap:** Saying "use a helper class to hide the chain." That just moves the smell; the helper now carries the same four-class coupling.

---

## Q3. Are streams and `Optional` chains LoD violations?

No. `list.stream().filter(...).map(...).toList()` chains through `Stream<T>` — the same collaborator type at every step. The dot count is high, but you're not navigating internal structure; you're driving a pipeline the API publishes deliberately. Same for `Optional.map().orElse()`, `CompletableFuture.thenApply()`, builder chains, and reactive `Mono`/`Flux`. The rule applies to *structural reach through entities*, not to repeated calls on the same pipeline type.

**Follow-up:** "What if the stream operations reach into items?" — `stream.map(li -> li.customer().address().city())` is back to LoD violation territory, inside the map lambda.

---

## Q4. What does "tell, don't ask" have to do with LoD?

They're two faces of the same coin. **Tell, Don't Ask** says: don't ask an object for data and then act on it — *tell* the object to perform the action. **LoD** says: don't navigate through collaborators to reach data. Both end at the same place: behaviour lives on the object that owns the data; callers send messages, they don't reach.

```java
// Ask + reach (LoD violation, Tell-Don't-Ask violation)
if (order.getStatus() == OPEN) order.getPayment().getProvider().refund(...);

// Tell (both fixed)
order.refund(reason);
```

**Trap:** Saying they're synonyms. Tell-Don't-Ask focuses on the *style of message*; LoD focuses on the *graph of acquaintances*.

---

## Q5. Critique this snippet for LoD.

```java
public class ReportService {
    public List<ReportRow> report(LocalDate from, LocalDate to) {
        return orderRepo.findByPlacedAtBetween(from, to).stream()
            .map(o -> new ReportRow(
                o.getCustomer().getName(),
                o.getCustomer().getAddress().getCity(),
                o.getLineItems().size(),
                o.getTotal()))
            .toList();
    }
}
```

Multiple violations. The `map` lambda reaches through `customer` and through `address`, and calls `getLineItems()` purely to count. The runtime symptom: with lazy JPA associations, this issues an N+1 storm — one SELECT per order for customer, one for address, one for line-item count. Fix: push the projection to the repository (`@Query` returning `ReportRow` directly with JOIN-based aggregation). The service stops walking; the database does the work. LoD violation gone, N+1 gone.

**Follow-up:** "What if you can't change the repository?" — at least add an entity graph (`@EntityGraph(attributePaths = {"customer.address", "lineItems"})`) to make one query. Better than the lazy chain.

---

## Q6. When does strict LoD push behaviour into the wrong object?

When the operation crosses an *infrastructure boundary*. Example: "send a welcome email" — strict LoD says push it to `Customer.sendWelcomeEmail()`. But SMTP is infrastructure, not a customer concern; binding `Customer` to the mail subsystem violates DIP. The compromise: `Customer.welcomeMessage()` returns a value (`WelcomeMessage(to, subject, body)`), and a `WelcomeMailer` consumes the value. LoD on data is preserved (no chain through `Customer`'s internals), DIP on infrastructure is preserved (the domain doesn't depend on SMTP).

**Trap:** Pushing the SMTP code onto `Customer` because "LoD says so". LoD is one force among several; cohesion and DIP also matter.

---

## Q7. What's the relationship between LoD and DDD aggregate boundaries?

LoD applied at the design scale is *the aggregate root pattern*. The aggregate root is the only entry point; internal entities and value objects are accessed only through the root. External code calls `order.applyDiscount(d)`, never `order.getLineItems().forEach(li -> li.applyDiscount(d))`. The root enforces invariants ("no more than one active discount"); external code can't bypass them by reaching past the root. In Java this becomes: root is `public`, internals are package-private (or in a non-exported package).

**Follow-up:** "How do two aggregates communicate?" — through identifiers (IDs), not references. The `Order` holds a `CustomerId`, not a `Customer` reference. Crossing the boundary requires looking up the other aggregate.

---

## Q8. Is `LawOfDemeter` checking by PMD reliable?

Partially. PMD's `LawOfDemeter` flags method invocations on objects retrieved from other methods. It catches obvious chains but has false positives on streams, builders, and `Optional`. Configure with exemptions for those types, combine with ArchUnit rules on package access, and treat it as a *first-pass filter*, not the truth. The real enforcement is package-private internals — making chains structurally impossible by hiding the types that would be returned.

**Follow-up:** "What's a better enforcement?" — JPMS module exports plus package-private classes. Compile-time impossibility scales better than lint rules.

---

## Q9. Critique this snippet.

```java
public class Order {
    private final List<LineItem> lineItems = new ArrayList<>();
    public List<LineItem> getLineItems() { return lineItems; }   // returns backing list
}
```

Two problems. First, callers can mutate the list directly (`order.getLineItems().clear()`) — bypassing any invariant. Second, every caller now knows `Order` has line items as a list, what `LineItem` looks like, and can navigate freely through it. The aggregate boundary is open. Fix: return `Collections.unmodifiableList(lineItems)`, or — preferably — don't return collaborators at all. Provide intent methods (`order.add(item)`, `order.remove(itemId)`, `order.totalQuantity()`) and let the list stay private.

**Trap:** Saying "the list is final, so it's immutable". `final` makes the *reference* immutable, not the list's contents.

---

## Q10. When is a getter LoD-acceptable?

When it returns a *value*, not a *collaborator*. `order.total()` returning `Money` is fine — `Money` is a value, callers can read it without coupling to anything else. `order.placedAt()` returning `LocalDate` is fine. `order.customer()` returning a `Customer` entity is suspicious — the caller will probably navigate further. The rule: returns of immutable values are LoD-friendly; returns of live entities invite chains.

**Follow-up:** "What about records?" — records of pure values are fine. Records that hold entity references (`record Cart(Customer c, List<LineItem> items)`) re-introduce the smell; entity records should be classes.

---

## Q11. Explain LoD-laundering.

"LoD-laundering" is when a developer hides a chain inside a helper method and considers the LoD violation fixed:

```java
public class OrderHelpers {
    public static Country countryOf(Order order) {
        return order.getCustomer().getAddress().getCountry();   // chain still here
    }
}

// At the call site:
checkout.taxFor(OrderHelpers.countryOf(order));                 // looks clean
```

The chain hasn't gone away; it's relocated. `OrderHelpers` now carries the same four-class coupling `CheckoutService` had. The real fix eliminates the chain by giving the responsibility to `Order` (e.g., `order.taxAmount()`).

**Trap:** Doing this routinely. Helper classes that walk domain structure become god classes — and they're the new LoD violators.

---

## Q12. What's the relationship between LoD and the Facade pattern?

Done right, Facade is LoD-compliant: callers talk to the facade, the facade talks to subsystem components, callers never reach into the subsystem. Done wrong, Facade is LoD-laundering: the facade exposes getters for every subsystem service, and callers chain through it. The test: a Facade should expose *intents* (verbs — `placeOrder`, `cancelOrder`), not *structure* (getters — `getOrderService`, `getRepository`). Intents are LoD-friendly; structure is not.

**Follow-up:** "What if the consumer needs flexibility?" — expose multiple intent methods, not getters. A 30-method intent facade is fine; a 10-getter structural facade is broken.

---

## Q13. How does LoD interact with testing?

A LoD-respecting method is straightforward to test: it has a small set of collaborators, each is a parameter or field, mocks are tiny. A LoD-violating method needs *deep stubbing* — chains of `when()` calls to mock each link of `a.b().c().d()`. Mockito's `RETURNS_DEEP_STUBS` makes this easy and is exactly the wrong tool — it hides the design problem rather than surfacing it. If your test file imports `RETURNS_DEEP_STUBS`, the production code under test has a chain problem.

**Follow-up:** "Are integration tests an alternative to deep stubbing?" — sometimes. But if integration tests are the only way to exercise a unit, the unit's API is too structural.

---

## Q14. What is "structural reach", and why does dot-counting miss it?

*Structural reach* is the set of distinct types a method's source navigates through, regardless of syntactic shape. A method that does:

```java
Customer c = order.customer();
Address a = c.address();
Country country = a.country();
return country.taxFor(order);
```

…has zero dots-on-one-line, and four-class structural reach — the same coupling as the train-wreck version. LoD's real metric is *types reached via navigation*, not dot count. Performative LoD compliance (splitting chains into local variables) doesn't reduce coupling.

**Trap:** Bragging about "no chains in our codebase" while every method has six local-variable steps.

---

## Q15. How does LoD relate to CQRS?

CQRS separates *write* (commands) from *read* (queries). LoD applies strictly on the write side: commands mutate aggregate state, and aggregates enforce invariants — external code must not reach past the root. LoD relaxes on the read side: queries are *projections*, and projections by definition walk the model to flatten it. The cleaner architecture: read models live in a separate denormalized store (CQRS-extreme), so the projection happens in the persistence layer, not in code that walks live entities.

**Follow-up:** "When is non-CQRS LoD-violation acceptable?" — at mappers and serializers, by design. They're the seam where structure-walking is the *job*.

---

## Q16. Critique this snippet for LoD.

```java
public class OrderReader {
    public Order fromJson(JsonNode node) {
        return new Order(
            node.get("id").asText(),
            node.get("customer").get("name").asText(),
            node.get("customer").get("address").get("city").asText());
    }
}
```

The chain through `node.get(...).get(...).get(...)` reaches deep into the JSON structure. Strictly speaking, it's LoD-violating — but in *this* role, it's acceptable. `OrderReader` is a *mapper*, a class whose explicit job is to know both the JSON shape and the domain shape. Mappers at system boundaries are the canonical LoD exemption. The hazard is mappers metastasizing into general-purpose helpers; keep them at boundaries and don't let them grow domain behaviour.

**Trap:** Saying "fix the mapper to respect LoD". You'd be requiring `JsonNode` to know about `Order`, which is worse.

---

## Q17. Should every chain be refactored?

No. Three classes of chain are exempt: (1) chains through pipeline types (`Stream`, `Optional`, builders, futures) — same collaborator throughout; (2) chains through value records (`address.city().substring(0, 3)`) — values have public meaning; (3) chains in mappers / serializers / DTO builders at system boundaries. The chains that need refactoring are: entity-graph walks (`a.entityB().entityC().mutate()`), structural reads (`a.entityB().getInternalState()`), and singleton chains (`Locator.getInstance().getX().getY()`).

**Follow-up:** "How do you know which is which?" — list the *types* the chain touches. Same type or value types → likely fine. Different entity types → LoD violation.

---

## Q18. How do package-private classes enforce LoD?

A package-private class cannot be *imported* from outside its package. Callers in other packages cannot bind variables of that type, cannot pass it as a parameter, cannot navigate to it through any getter. The class is *unreachable*. If an aggregate's internal entities are package-private, external code physically cannot chain through them — the compiler refuses. This is the *strongest* enforcement of LoD that Java offers at the language level (the next step up is JPMS module exports, which enforces at the linker level).

```java
package com.acme.order;
public final class Order { ... }
final class LineItem { ... }       // package-private — invisible outside
```

**Follow-up:** "What about reflection?" — JPMS with strong encapsulation refuses reflection too, unless the package is explicitly `opens`.

---

## Q19. When does LoD lose to performance?

When the LoD-compliant code requires many short forwarding calls in a hot inner loop, the JIT can't keep up with megamorphic dispatch, and profiling proves the chain is the bottleneck. The rare case. Most "LoD is slow" claims are folklore — modern JITs inline monomorphic forwarders for free. When measurement proves a cost, mitigations include: making forwarders `final` (helps CHA), holding the chain monomorphic (don't reconfigure), or accepting a controlled LoD violation at the leaf with a documented comment. Document trade-offs; don't preemptively break design.

**Trap:** "We don't do LoD because it's slow." Almost certainly false in practice.

---

## Q20. What is the "LoD checklist" anti-pattern?

Treating LoD as a syntactic check — "one dot per line" — and shipping code that satisfies the literal rule but doesn't reduce coupling. Symptoms: methods that walk the same four classes' shapes through local variables; helpers that wrap chains and become the new coupling points; "facades" that publish every collaborator as a getter; performative refactoring that adds forwarders without thinking about ownership. LoD's value is *contextual*: count the distinct entity types your method touches via navigation, and reduce *that* number. Dot count is a proxy that some teams optimize to no benefit.

**Follow-up:** "How do you spot it in review?" — look for methods whose *imports* list five entity classes; that's the real coupling. The chain syntax is secondary.

---

**Use this list:** rotate one question per axis (definition, refactor recipe, exemptions, DDD alignment, performance). Strong candidates can name *when not to apply LoD* (mappers, projections, value records) and back the choice with a concrete cost.
