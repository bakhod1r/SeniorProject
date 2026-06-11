# GRASP — Interview Q&A

> Twenty questions on responsibility assignment, grouped by difficulty. Strong answers are concise, name the pattern, and — at senior level — name the *tension* between patterns. Interviewers use GRASP questions to test whether you can *justify* a class diagram, not just draw one.

---

## Warm-up / conceptual

**Q1. What does GRASP stand for, and what single question does it answer?**
General Responsibility Assignment Software Patterns. It answers: *which class should own this responsibility (this method, field, or piece of logic)?* It's a vocabulary for the most common OO design decision — deciding where things go — coined by Craig Larman in *Applying UML and Patterns*.

**Q2. Name the nine patterns and group them by role.**
Five *placement* patterns — Information Expert, Creator, Controller, Polymorphism, Pure Fabrication. Two *evaluators* — Low Coupling, High Cohesion. Two *decoupling* patterns — Indirection, Protected Variations. The placement patterns nominate an owner; the evaluators score the nomination; the decoupling patterns insert boundaries when the evaluators demand them.

**Q3. State Information Expert and give the one-sentence justification for why it works.**
Assign a responsibility to the class that has the information needed to fulfil it. It works because it *localises connascence*: the rule that depends on data lives next to the data, so a change to the data and a change to the rule touch one class instead of two-at-a-distance.

**Q4. What's the difference between a GRASP Controller and a Spring `@Controller`?**
The GRASP Controller is a *design role* — the first non-UI object that handles a system event and *delegates* to the domain. A Spring `@Controller` is one *implementation* of that role at the HTTP layer. The mistake is putting domain logic in the Spring class; it should stay thin and call a use-case object.

**Q5. Low Coupling and High Cohesion aren't placement patterns — what are they?**
They're *evaluators* (Larman's word: "evaluative patterns"). You don't "apply" them to produce a design; you use them to *score* a candidate placement that another pattern produced. They're the tie-breakers when Information Expert or Creator offers more than one option.

---

## Core / practical

**Q6. Information Expert says put `save()` on `Order` because it has the data. Why is that usually wrong?**
Because Low Coupling overrules it. Putting `save()` on `Order` couples the domain entity to JDBC/the database, lowers its cohesion (entity + persistence), and makes it un-unit-testable without a database. The fix is a Pure Fabrication — `OrderRepository` — behind an interface (Indirection). Information Expert is the *first guess*, not a law.

**Q7. What is Pure Fabrication and when do you reach for it?**
A class invented for design cleanliness that has *no* real-world domain counterpart — `Repository`, `Mapper`, `Gateway`, `Service`. You reach for it when a responsibility belongs to *no* domain object, usually because it's infrastructural (persistence, integration) or cross-cutting. It exists to keep domain objects cohesive and uncoupled.

**Q8. How do you tell a healthy Pure Fabrication from an anemic domain model?**
A healthy fabrication owns *infrastructural or cross-aggregate* responsibilities (a repository saving to a DB). An anemic domain is what you get when you fabricate too aggressively and drain *business* logic — rules that operate on an object's own data — into services, leaving the entities as getter/setter structs. Rule: business logic that operates on an object's own data stays on the object; only non-domain concerns get fabricated.

**Q9. Give the GRASP justification for choosing the Strategy pattern.**
Strategy is Protected Variations (a stable interface around a predicted variation) implemented via Polymorphism (each variation is its own type), with the strategies themselves being Pure Fabrications. So: "I used Strategy because discount logic is a predicted variation point (PV), and polymorphic dispatch lets me add a discount type without editing existing code (OCP)."

**Q10. What's the relationship between GRASP Polymorphism and SOLID's Open/Closed Principle?**
They're the same move from two angles. GRASP Polymorphism says "when behaviour varies by type, use polymorphic dispatch, not type tests." OCP says "open for extension, closed for modification." Polymorphic dispatch *is* the mechanism that makes a type open for extension (add a class) and closed for modification (don't edit existing code). OCP = GRASP Polymorphism + Protected Variations.

**Q11. When should a Controller be a facade vs. a use-case controller?**
Facade controller (one object for the whole system / a root entity) when there are *few* system events. Switch to use-case controllers (one per use case) when a single facade would grow bloated — i.e., when High Cohesion is at risk, or when different use cases need different state. The deciding evaluator is cohesion.

**Q12. Indirection adds a class to remove a coupling. What's the cost, and when isn't it worth it?**
Every indirection is a hop a reader must follow and a class to maintain. It isn't worth it when there's exactly one implementation, no predicted second one, and no test seam need — that's ceremony, not design. Add indirection for *existing* multiplicity, *concretely predicted* variation, or a *needed* test boundary; otherwise keep the direct dependency and extract the interface when the second implementation actually arrives.

---

## Code-reading / "what's wrong"

**Q13. What GRASP violation is this, and what's the fix?**
```java
class InvoicePrinter {
    String format(Invoice inv) {
        return inv.getCustomer().getName() + " owes " + inv.getTotal()
             + " due " + inv.getDueDate();
    }
}
```
Information Expert violation (Feature Envy): `format` uses only `Invoice`'s data and none of its own. The fix: move `format()` (or a `summary()` method) onto `Invoice`, where the data lives. Bonus: this also satisfies the Law of Demeter by not chaining through `inv.getCustomer().getName()`.

**Q14. Identify every misassignment:**
```java
class CheckoutController {
    Receipt checkout(CartDto dto) {
        if (dto.items().isEmpty()) throw new IllegalArgumentException();
        BigDecimal total = dto.items().stream().map(...).reduce(...);
        BigDecimal tax = total.multiply(new BigDecimal("0.20"));
        jdbc.insert("INSERT INTO receipts ...");
        return new Receipt(total.add(tax));
    }
}
```
Four. (1) Validation — belongs in the domain/a validator. (2) Total calculation — Information Expert says it belongs on `Sale`/`Order`. (3) Hard-coded tax — Protected Variations says wrap in a `TaxPolicy`. (4) SQL in the controller — Low Coupling/Pure Fabrication says move to a repository. The controller should *delegate* all four; it should compute nothing.

**Q15. What pattern replaces this, and what does the compiler give you for free?**
```java
double area(Shape s) {
    if (s instanceof Circle c) return Math.PI * c.radius() * c.radius();
    else if (s instanceof Square q) return q.side() * q.side();
    else throw new IllegalArgumentException();
}
```
Polymorphism: make `Shape` a `sealed interface` with an `area()` method and move each branch into the implementing record. With a sealed type + pattern `switch`, the compiler enforces *exhaustiveness* — adding a new shape that doesn't implement `area()` won't compile, replacing the runtime `IllegalArgumentException` with a compile error.

---

## Trade-off / senior design

**Q16. When do Information Expert and Low Coupling genuinely conflict, and how do you resolve it?**
When fulfilling a responsibility requires *both* an object's own data *and* something external (infrastructure, another aggregate). Example: shipping cost needs `Order`'s weight (Expert points to `Order`) *and* a live carrier-rate service (coupling we don't want on `Order`). Resolution: split the responsibility — `Order` stays the expert for `totalWeight()`/`destination()`, and a Pure Fabrication (`ShippingCalculator`) owns the part that talks to the carrier. Expert applies to the *data* part; coupling decides the *infrastructure* part.

**Q17. Why is Protected Variations called a "superpattern"?**
Because OCP, DIP, polymorphism, and information hiding are all *special cases* of it. PV's instruction — "identify predicted points of variation and wrap them in a stable interface" — generalises Parnas's information hiding (1972), Meyer's Open/Closed, GoF's "program to an interface," and Martin's Dependency Inversion. Larman makes this explicit: those are tactics; PV is the strategy.

**Q18. How do GRASP and GoF relate? Pick a pattern and show it.**
GoF patterns are recurring *solutions*; GRASP patterns are the *forces* that select them. Adapter, for instance, is GRASP Indirection (an intermediate mediates between incompatible interfaces) plus Protected Variations (it shields callers from a volatile third-party interface). When you "realise you need an Adapter," what actually happened is Low Coupling + PV demanded a boundary and the GoF catalogue named its shape.

**Q19. You're reviewing a PR that adds an interface with exactly one implementor. What's your GRASP reasoning?**
Indirection/Protected Variations has a real cognitive cost and only pays off against *actual or predicted* variation. One implementor, no predicted second, no test-seam need → it's speculative generality (YAGNI). I'd push back and suggest a direct dependency, with the note that extracting the interface later is a five-minute IDE refactor *when* the second implementation arrives. The exception: if the interface is the test seam for something un-mockable (network/DB), it's earned even with one production impl.

**Q20. How would you encode a GRASP decision as an automated, enforceable rule?**
With an ArchUnit test. The most valuable one encodes Low Coupling + Pure Fabrication: "no class in `..domain..` may depend on `java.sql..`, `javax.persistence..`, or `..infrastructure..`." That makes the "domain must not know about the database" decision a build failure rather than a review opinion — GRASP graduating from advice to enforced invariant. CK metrics (CBO/LCOM) thresholds in SonarQube are a softer, trigger-a-look version.

---

**Closing pointer:** the strongest GRASP answers never stop at naming the pattern — they name the *force* and the *tension*. "Information Expert, but overruled by Low Coupling here, so I split it" beats "put it on Order" every time. Interviewers are testing whether you can *defend* a placement under pushback, which is exactly what GRASP vocabulary is for.
