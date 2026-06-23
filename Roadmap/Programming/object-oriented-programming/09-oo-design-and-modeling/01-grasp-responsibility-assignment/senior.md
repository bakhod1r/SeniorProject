# GRASP — Senior

> **What?** The senior view of GRASP is about the *tensions*: the nine patterns frequently pull in opposite directions, and design skill is knowing which one wins in a given context. This file covers the genuine conflicts (Information Expert vs. Low Coupling, Pure Fabrication vs. anemic domain), the historical relationship between GRASP, GoF, SOLID and connascence, and the failure modes that come from applying GRASP without judgement.
> **How?** Each section names a conflict, shows both horns of it in code, and gives the heuristic Larman and the wider literature use to resolve it. The meta-skill: GRASP patterns are *forces*, and forces are balanced, not satisfied absolutely.

---

## 1. The master tension: Information Expert vs. Low Coupling

Information Expert says "put the behaviour where the data is." Low Coupling says "don't make this class depend on more things." These collide constantly.

Consider computing a shipping cost that depends on the order's items *and* live carrier rates from an external service.

```java
// Information Expert's pull: Order has the items, so Order computes shipping.
public class Order {
    private final List<OrderLine> lines;
    private final CarrierRateService rates;   // ← coupling leaked into the domain

    public BigDecimal shippingCost() {
        BigDecimal weight = totalWeight();           // Order's own data — fine
        return rates.quote(weight, destination());   // external call — NOT fine on Order
    }
}
```

The pure expert is `Order` — but pulling `CarrierRateService` onto `Order` couples the domain entity to a network service, makes it un-unit-testable without a stub, and lowers cohesion (entity + integration concern). Low Coupling wins. The resolution is to *split the responsibility*: `Order` is the expert for what it knows (weight, destination), and a Pure Fabrication owns the part that needs the carrier.

```java
public class ShippingCalculator {
    private final CarrierRateService rates;
    public ShippingCalculator(CarrierRateService rates) { this.rates = rates; }

    public BigDecimal costFor(Order order) {
        return rates.quote(order.totalWeight(), order.destination());  // asks the expert
    }
}
```

**The heuristic:** Information Expert is about *which object knows the data*; when fulfilling the responsibility *also* requires knowing about infrastructure, split it — the entity keeps the pure-data part (it stays the expert for `totalWeight()`), and a fabrication owns the impure part. Larman calls this respecting Expert *without* dragging coupling into the domain.

---

## 2. Pure Fabrication vs. the anemic domain model

Pure Fabrication is the most *abused* GRASP pattern, because the slope from "fabricate a repository" to "drain all logic into services" is slippery and feels productive.

```java
// Anemic: Order is a struct; OrderService holds ALL behaviour.
public class Order {
    private List<OrderLine> lines;
    public List<OrderLine> getLines() { return lines; }   // getters only
    public void setLines(List<OrderLine> l) { this.lines = l; }
}
public class OrderService {
    public BigDecimal total(Order o)        { /* reaches into o.getLines() */ }
    public boolean isEligibleForDiscount(Order o) { /* business rule, wrong home */ }
    public void applyDiscount(Order o, ...) { /* mutates o through setters */ }
}
```

Every one of these `OrderService` methods is a *missed* Information Expert. The business logic that *belongs* on `Order` (it owns the data those rules operate on) has been exiled to a service. Martin Fowler's name for this is the anemic domain anti-pattern; in GRASP terms, it's Pure Fabrication *over-applied*, suppressing Information Expert.

**The line:** fabricate for responsibilities that are genuinely *not* about any single domain object's data — persistence, transaction management, cross-aggregate orchestration, protocol mapping, integration. Keep on the domain object any responsibility that operates purely on *that object's own data and invariants*. `total()` and `isEligibleForDiscount()` operate on `Order`'s lines → they're Expert's, not the service's. A `SaleRepository.save()` operates on a database → fabrication's.

---

## 3. Controller bloat — the cohesion failure mode

The Controller pattern has a built-in attractor toward god objects, because "handle the system event" is vague enough that *everything* feels like it could go there.

The two sub-patterns degrade differently:

- A **facade controller** (`Register` handling all events) degrades into a god class as use cases multiply — low cohesion.
- A **use-case controller** stays cohesive but you can end up with one per use case, which is fine until they start sharing state and you've reinvented a stateful session badly.

The senior judgement: a controller's *only* legitimate responsibilities are (1) receive the event, (2) delegate to domain objects, (3) translate between the UI/transport representation and the domain. Anything else — validation rules, calculations, persistence decisions — is misassigned.

```java
// Smell: a "controller" that is actually doing the work.
public class CheckoutController {
    public Receipt checkout(CartDto dto) {
        // validation logic (belongs in domain / a validator)
        if (dto.items().isEmpty()) throw new IllegalArgumentException();
        // pricing logic (belongs on Sale — Information Expert)
        BigDecimal total = dto.items().stream().map(i -> i.price().multiply(...)).reduce(...);
        // tax logic (belongs behind a TaxPolicy — Protected Variations)
        BigDecimal tax = total.multiply(new BigDecimal("0.20"));
        // persistence (belongs in a repository — Pure Fabrication)
        jdbc.insert("INSERT INTO receipts ...");
        return new Receipt(total.add(tax));
    }
}
```

Four misassignments in one method, each fixable by a different GRASP pattern. The controller should have *delegated* each line. A useful review metric: a method on a controller that contains arithmetic, SQL, or `if` chains on business rules is almost always a misassignment.

---

## 4. GRASP, GoF, and the "patterns are forces" view

A senior insight that reframes both catalogues: **GoF patterns are the recurring *solutions*; GRASP patterns are the *forces* that select them.** Each GoF pattern is an instance of one or more GRASP patterns:

| GoF pattern | GRASP forces it embodies |
| --- | --- |
| Strategy | Polymorphism + Protected Variations + Pure Fabrication |
| Factory Method / Abstract Factory | Creator + Pure Fabrication + Protected Variations |
| Adapter | Indirection + Protected Variations |
| Facade | Controller + Indirection + Low Coupling |
| Observer | Indirection + Low Coupling |
| Command | Pure Fabrication + Polymorphism |
| Decorator | Polymorphism + Protected Variations |
| Bridge | Indirection + Protected Variations |
| Proxy | Indirection + Protected Variations |

This is why GRASP is taught *before* GoF in Larman's book: once you can reason in forces, the 23 GoF patterns stop being 23 things to memorise and become *named precipitates* of the same handful of forces. When you "discover" you need a pattern, what actually happened is a GRASP force (usually Protected Variations or Low Coupling) demanded a boundary, and the GoF catalogue named the shape.

---

## 5. GRASP vs. SOLID — same map, different projection

GRASP (1997, Larman) and SOLID (acronym coined by Michael Feathers ~2004 from Robert Martin's 1990s principles) overlap heavily because they describe the same underlying goal — change-tolerant OO — from different angles.

| GRASP | Closest SOLID | Relationship |
| --- | --- | --- |
| High Cohesion | Single Responsibility (SRP) | nearly identical at the class level |
| Polymorphism | Open/Closed (OCP) | OCP *is* GRASP Polymorphism + Protected Variations |
| Protected Variations | Open/Closed + Dependency Inversion (DIP) | PV is the superset; OCP & DIP are tactics for it |
| Indirection | Dependency Inversion (DIP) | DIP is Indirection toward an abstraction |
| Low Coupling | (implicit in all of SOLID) | SOLID's *purpose*; GRASP names it directly |
| Information Expert | — | no direct SOLID equivalent; closest to "Tell, Don't Ask" |
| Creator / Controller / Pure Fabrication | — | structural placement, orthogonal to SOLID |

The key difference in *level*: SOLID is mostly about *class structure and dependency direction*; GRASP includes *placement* patterns (Information Expert, Creator, Controller) that SOLID doesn't address at all. They're complementary — GRASP tells you *where to put a thing*, SOLID tells you *how to shape the dependencies* once it's placed. Protected Variations is the unifying superpattern: Larman explicitly frames OCP, DIP, polymorphism, and information hiding as *special cases of Protected Variations*.

---

## 6. GRASP and connascence — the precise version of coupling

Low Coupling is a *direction*, not a *measurement*. Connascence (Meilir Page-Jones, *What Every Programmer Should Know About OO Design*) is the metric system underneath it. Two elements are *connascent* if changing one requires changing the other. The forms, weakest to strongest:

- **Connascence of Name** — both refer to the same name. (weakest)
- **Connascence of Type / Meaning / Position** — agree on type, on the meaning of a value, on argument order.
- **Connascence of Algorithm** — both must implement the same algorithm (e.g. hashCode/equals).
- **Connascence of Execution / Timing / Value / Identity** — dynamic, order-dependent. (strongest)

GRASP's Low Coupling, made precise, means: *prefer weaker connascence, and keep strong connascence local* (within one class, where it's cheap to manage). When Information Expert puts data and behaviour on the same class, it's *localising connascence of algorithm* — the rule that depends on the data lives next to the data. When you scatter that rule into a service, you create connascence-at-a-distance, the expensive kind. This is the rigorous reason Information Expert reduces change cost. (See [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/) for CBO/RFC, the *measured* cousins of coupling.)

---

## 7. When Information Expert is the *wrong* default

Three situations where the data-holder should *not* get the responsibility, beyond the infrastructure case:

**(a) Cross-aggregate responsibilities.** A rule spanning two equally-relevant objects has no single expert. "Can this customer place this order?" needs `Customer` (credit limit) and `Order` (total). Neither is *the* expert. Resolution: a Pure Fabrication (`OrderPolicy` / domain service) that consults both — a DDD *domain service*, which is a Pure Fabrication for cross-aggregate logic.

**(b) Stable-interface needs.** If a responsibility is a known variation point (Protected Variations), it belongs behind an interface even if a concrete domain object "has the data." Tax computation has data on `Order`, but tax *rules* are volatile → wrap in `TaxPolicy`, don't bake into `Order`.

**(c) The expert would violate a layering boundary.** A domain object computing something that needs the *current user's permissions* or the *HTTP request context* would reach upward through layers. That responsibility belongs in the application layer, not on the entity, regardless of where the raw data sits.

The senior pattern: Information Expert is the *first guess*, overruled by Low Coupling (infrastructure), no-single-expert (cross-aggregate), Protected Variations (volatility), and layering. Knowing the overrides *is* the skill.

---

## 8. The cost of Indirection — every layer has a tax

Indirection and Protected Variations both *add* a class (an interface, a mediator) to *remove* a coupling. This is never free:

- **Cognitive cost** — every interface is one more hop a reader must follow to find the real implementation. A codebase with an interface per class (each with exactly one implementor) is *harder* to navigate, not easier.
- **Indirection that protects nothing** — `OrderServiceImpl implements OrderService` where there will only ever be one implementation buys you nothing but ceremony. The variation it "protects" doesn't exist.
- **The YAGNI counterweight** — Protected Variations explicitly says protect *predicted* variation. Wrapping unpredicted variation is speculative generality (see [../../03-design-principles/05-dry-kiss-yagni/](../../03-design-principles/05-dry-kiss-yagni/)).

The senior calibration: insert Indirection when (1) there are *already* multiple implementations, or (2) the variation is *concretely predicted* (a second payment provider is on the roadmap), or (3) the boundary is a *test seam* you genuinely need. Otherwise, a direct dependency is the honest, readable default — and you extract the interface *when the second implementation actually arrives* (a five-minute IDE refactor).

---

## 9. Historical context

GRASP debuted in the first edition of Larman's *Applying UML and Patterns* (1997), predating the widespread SOLID acronym. Larman's framing was deliberately pedagogical: he observed that students could memorise the 23 GoF patterns yet still produce terrible designs because they couldn't *decide where responsibilities go*. GRASP was the missing layer — the *principles* beneath the *patterns*. The "P" originally stood for "Principles" in some early writing before settling on "Patterns" (Larman argues they *are* patterns: recurring problem/solution pairs in the assignment of responsibility).

Protected Variations is the one Larman credits to others — he attributes the core idea to David Parnas's *information hiding* (1972) and James Coplien's writing, generalising "Open/Closed" (Meyer/Martin), "information hiding" (Parnas), and "interface, not implementation" (GoF) into a single named force. That lineage is why PV feels like an umbrella: it *is* one, by design.

---

## 10. Quick rules

- [ ] Information Expert is the first guess; override it for infrastructure (Low Coupling), cross-aggregate logic (no single expert), volatility (Protected Variations), and layering.
- [ ] Pure Fabrication is for non-domain concerns; the moment it drains *business* logic off entities, you've built an anemic domain.
- [ ] A controller with arithmetic, SQL, or business `if`-chains is a misassignment — delegate each to the right expert/fabrication.
- [ ] GoF patterns are GRASP forces precipitated into named solutions — cite the force, not just the pattern.
- [ ] Protected Variations is the superpattern: OCP, DIP, polymorphism, and information hiding are its special cases.
- [ ] Low Coupling = weak, localised connascence. Strong connascence belongs inside one class.
- [ ] Indirection has a cognitive tax; add it for *existing* multiplicity, *predicted* variation, or a *needed* test seam — not on spec.

---

**Memorize this:** GRASP patterns are balanced *forces*, not satisfiable rules. The defining senior skill is resolving their conflicts — Information Expert yielding to Low Coupling at infrastructure boundaries, Pure Fabrication staying on the right side of the anemic-domain line, and Indirection being paid for only where variation is real. Protected Variations is the umbrella that unifies the lot, and connascence is the ruler you measure coupling with.
