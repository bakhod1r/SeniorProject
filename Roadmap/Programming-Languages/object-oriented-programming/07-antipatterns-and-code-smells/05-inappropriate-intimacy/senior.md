# Inappropriate Intimacy — Senior

> **What?** Inappropriate Intimacy as the *failure of information hiding* (Parnas, 1972). The senior view sees the smell not as a refactoring task but as a *system property*: how knowledge leaks across boundaries, how Java's access modifiers fail to enforce hiding, how dependency graphs reveal intimacy before code review, and where intimacy is a *consequence* of deeper architectural mistakes — wrong module boundaries, missing aggregates, leaky abstractions.
> **How?** By treating every cross-class read or write as a *claim of knowledge*. If class `A` claims knowledge of `B`'s internals, *both* are now liable for changes to that internal. Reduce intimacy = reduce the liability surface.

---

## 1. Parnas, 1972 — the original argument

David Parnas's 1972 paper *On the Criteria to Be Used in Decomposing Systems into Modules* is the source. His central claim, paraphrased: **a module's interface should expose only the design decisions that are unlikely to change; everything likely to change should be hidden**.

Inappropriate Intimacy is the *direct violation* of that claim. When `Order` reads `Customer.lastOrderTotal`, `Order` has claimed knowledge of a *design decision inside* `Customer` (that the customer caches its last total, in this format, on this field). Every future change to that design decision — caching it elsewhere, removing the cache, changing the type — becomes a change to `Order` as well.

Parnas's reframing turns the smell from "feels coupled" to a measurable proposition: **count the design decisions class `A` has claimed of class `B`**. Each claim is a unit of liability. The senior code reviewer's job is to keep that count near zero across module boundaries.

```java
// Three claims of knowledge in one expression:
order.customer.address.street.toUpperCase()
//    ^^^^^^^^                  Order knows Customer has an `address` field
//             ^^^^^^^^         Order knows Address exposes a `street`
//                      ^^^^^^^^Order knows the street is a String
```

Hide one of the three (say, `Customer.shippingStreetForLabel()`) and `Order` loses two claims at once.

---

## 2. Java's access modifiers — designed to fail

Java has four visibilities: `private`, package-private (default), `protected`, `public`. Three of them leak.

- **`private`** is the only one that actually hides. Anything else is visible to *some other class*.
- **Package-private** is the most common Inappropriate Intimacy vector. Two classes in the same package have full read/write access to each other's package-private members. This is Java's silent `friend` keyword.
- **`protected`** exposes the field to subclasses *and* to the same package. Anyone can become a subclass; subclasses can read your state forever.
- **`public`** is global. Everyone is intimate.

```java
package com.acme.shop;
public class Order {
    private   BigDecimal subtotal;   // hidden from everyone
    BigDecimal           discount;   // visible to every class in com.acme.shop
    protected BigDecimal tax;        // visible to subclasses AND com.acme.shop
    public    BigDecimal total;      // visible everywhere
}
```

A typical Java codebase has hundreds of package-private fields. Each one is a license for *anyone in the package* to be intimate with that class. The license is implicit, undocumented, and impossible to audit by reading `Order` in isolation — you have to read every class in the package to find out who is using it.

A defensible default: **everything `private` unless a sibling has a documented reason to need access**. The reason should appear in a comment or a `@VisibleForTesting`-style marker.

---

## 3. Encapsulation breaks below the language level

Even when fields are `private`, encapsulation can leak. Three common holes:

**Returning a mutable reference.**

```java
public class Order {
    private final List<LineItem> items = new ArrayList<>();
    public List<LineItem> getItems() { return items; }   // caller can items.add(...)
}
```

`Order` is now intimate with every caller of `getItems`. Anyone holding the returned list can mutate `Order`'s internals. Return `List.copyOf(items)`, an unmodifiable wrapper, or a stream — the type tells the caller whether mutation is permitted.

**Storing a passed-in reference.**

```java
public class Order {
    private final List<LineItem> items;
    public Order(List<LineItem> items) { this.items = items; }   // aliased!
}

// Caller:
var src = new ArrayList<LineItem>();
var order = new Order(src);
src.add(extra);                  // modifies order from outside
```

`Order` is intimate with whoever built the list. Defensive copy in the constructor: `this.items = List.copyOf(items)`.

**Exposing a builder that mutates after `build()`.**

```java
public class Order {
    public static Builder builder() { return new Builder(); }
    private Order(Builder b) {
        this.items = b.items;        // shares reference with the still-mutable builder
    }
}
```

The builder must either freeze its state at `build()` or copy it into the constructed object. Otherwise `Order` and the builder are intimate forever.

Encapsulation isn't an access modifier — it's a *property of the object graph at runtime*. `private` plus reference aliasing equals zero encapsulation.

---

## 4. Detection — dependency graphs and intimacy edges

Static analysis can't read intent, but it can count *who-references-whom*. Two metrics, used together, reveal intimacy without reading any code:

- **CBO (Coupling Between Objects)** — the number of other classes a given class references. High CBO is a coupling smell, not necessarily intimacy.
- **Bidirectional reference count** — the number of *pairs* `(A, B)` where `A` references `B` *and* `B` references `A`. Each pair is a candidate for intimacy.

A small tool you can write in 50 lines of `javaparser` or `asm` produces a graph where:

- Nodes are classes.
- Edges are field/method/parameter references.
- Bidirectional edges are intimacy candidates.

Sort the bidirectional edges by *number of fields touched on each side*. The top-N is your intimacy hotspot list — usually 3 to 8 pairs out of thousands of classes. Each one is a refactor candidate.

```text
Pair                                 Bidir touches   Verdict
com.acme.Order ↔ com.acme.Customer        14         intimate; refactor
com.acme.Driver ↔ com.acme.Vehicle         9         intimate; pick owner
com.acme.Tree ↔ com.acme.Node              5         legitimate parent-child
com.acme.UserService ↔ com.acme.UserDto    3         DTO mapping; ignore
```

The graph also makes *transitive* intimacy visible: a chain `A → B → C → A` is a 3-cycle that no individual pair would flag, but cycles in a domain graph are nearly always a sign of unclear ownership.

ArchUnit and JDepend produce variants of this view; integrate them into CI so the metric trends are visible across releases. (More on this in `professional.md`.)

---

## 5. Intimacy as a symptom of missing aggregates

In Domain-Driven Design vocabulary, an *aggregate* is a cluster of objects with a single root through which all access happens. Inappropriate Intimacy is *frequently* the symptom of a missing aggregate boundary:

```java
// Before — Customer and ShippingAddress are intimate because there's no aggregate:
public class Customer {
    private ShippingAddress address;
    public ShippingAddress getAddress() { return address; }
    public void setAddress(ShippingAddress a) { this.address = a; }
}
public class ShippingAddress {
    private Customer owner;     // back-reference for "who lives here"
    public Customer getOwner() { return owner; }
}
```

The fix isn't "remove the back-reference". It's *recognise the aggregate*. `Customer` is the aggregate root; `ShippingAddress` is owned by `Customer` and has no identity outside it:

```java
public class Customer {
    private ShippingAddress address;
    public void moveTo(ShippingAddress newAddress) {
        this.address = newAddress;
    }
    public String labelForShipping() {
        return address.formatted();
    }
}

public final class ShippingAddress {
    private final String street;
    private final String city;
    // No back-reference. Owned by some Customer; the address itself doesn't care which.
    public String formatted() { return street + ", " + city; }
}
```

Once you've named the aggregate, the intimacy *can't* re-occur: `ShippingAddress` has no way to refer to its owner because the aggregate root never gives it one.

A senior heuristic: **whenever you find intimacy, ask whether one side is actually a *value object* or *entity within an aggregate*, not a peer**. The right access pattern follows from the right ownership model.

---

## 6. Leaky abstractions and intimacy through interfaces

Intimacy isn't restricted to concrete classes. An interface can leak its implementation in ways that force callers to be intimate:

```java
public interface Order {
    List<LineItem> getItems();          // mutable list — implementation detail
    void setStatus(OrderStatus s);      // setter pair on the interface
    OrderStatus getStatus();
    Customer getCustomer();             // exposes the customer object directly
}
```

Implementing this interface anywhere forces you to expose internal state. Calling it anywhere forces you to walk the graph. The interface itself encodes intimacy.

Tighten the interface:

```java
public interface Order {
    String orderNumber();
    BigDecimal total();
    OrderStatus status();
    void confirm();                     // commands instead of setters
    void cancel(String reason);
    Stream<LineItem> items();           // unmodifiable stream
}
```

Now no implementer can leak its `items` list, and no caller can mutate state directly. *Interfaces should hide design decisions just as classes should* — the smell applies one level up.

---

## 7. Intimacy across architectural layers

Inappropriate Intimacy doesn't only happen between two domain classes. It happens between *layers* — and that's usually worse, because a layer leak corrupts the whole system, not just two classes.

Typical layer intimacy in a Spring application:

```java
// Domain layer:
public class Order {
    public BigDecimal total;
}

// Persistence layer:
@Entity
public class OrderEntity {
    @Id Long id;
    BigDecimal total;
    public OrderEntity(Order o) {
        this.total = o.total;          // domain's package-private field
    }
}

// Web layer:
public class OrderController {
    public OrderDto get(Long id) {
        OrderEntity e = repo.findById(id);
        Order o = new Order();
        o.total = e.total;             // mutating domain's package-private field
        return new OrderDto(o);
    }
}
```

The domain layer is now intimate with *both* persistence and web layers. Any of them changing forces edits to the others. The cure is the same as before — but the *enforcement* moves to architecture-level tools: JPMS module boundaries, ArchUnit rules, hexagonal ports/adapters (covered in `professional.md`).

---

## 8. When intimacy is okay

A senior view also recognises legitimate exceptions. Not every cross-class reference is intimacy:

- **Parent-child within an aggregate.** A `Tree.Node` legitimately references its parent. The cycle exists *by design*, the aggregate scopes it, and no other class can poke at the nodes.
- **Value-object equality.** Two `Money` values compare component-by-component; reading each other's amounts and currencies is the *whole point*.
- **Builders mutating their target.** A `OrderBuilder` legitimately writes into the `Order` under construction — for the duration of the build, the two are the same conceptual object.
- **Iterators over a collection.** An `Iterator<E>` returned by `List<E>` knows the list's internal structure on purpose.
- **Inner classes.** A non-static inner class is *defined as* having access to the enclosing instance. That's a deliberate trust relationship.

The test for *legitimate* intimacy is: **the two classes ship together, ship as one concept, and cannot be substituted independently**. If you'd never replace `Order.Builder` without also replacing `Order`, the intimacy is fine. If you could imagine `Order` with a different `Customer` implementation, the intimacy across that boundary is not.

---

## 9. Intimacy debt across a codebase

Most legacy Java codebases carry years of accumulated intimacy. You cannot refactor it all in one sprint. A senior approach treats intimacy as *technical debt with a known interest rate*:

- **Inventory** the pairs (the bidirectional-edge graph above).
- **Score** each pair by *change frequency* (how often both classes are edited in the same commit, via `git log --name-only`).
- **Triage**: high-frequency pairs go first; low-frequency pairs can wait or stay.
- **Budget** a small refactor allowance per release — one pair per release is enough to make trend visible.

Intimacy debt resembles SQL N+1: any single instance is cheap to fix, but a whole codebase of them is overwhelming. Pace the cleanup. Add a *no-new-intimacy* gate (ArchUnit) so the inventory doesn't grow.

---

## 10. Quick rules

- [ ] Every cross-class field access is a *claim of knowledge*; count the claims, not the lines.
- [ ] `private` is the only access modifier that actually hides — start there, raise only with reason.
- [ ] Returned collections, stored references, and post-build builders are the three encapsulation leaks below the access modifier.
- [ ] Bidirectional edges in your class graph are intimacy candidates; sort them by touch count and triage.
- [ ] If two classes are intimate, ask first whether they're really one aggregate.
- [ ] Interfaces hide design decisions too — `getItems(): List` is a leak.
- [ ] Cross-layer intimacy is worse than cross-class intimacy; enforce layer boundaries with architecture tests.
- [ ] Some intimacy is legitimate — aggregates, value-object equality, builders, iterators, inner classes.

---

## 11. What's next

| Topic                                                                       | File              |
|-----------------------------------------------------------------------------|-------------------|
| JPMS, ArchUnit, hexagonal architecture for enforcing boundaries             | `professional.md`  |
| CBO/MPC metrics, JLS access rules, and how the spec backs hiding            | `specification.md` |
| Bugs from intimate code (bidirectional JPA, serialization cycles, leaks)    | `find-bug.md`      |
| Runtime cost of bidirectional fetches and equals/hashCode cycles            | `optimize.md`      |
| Practice refactors                                                          | `tasks.md`         |
| Interview Q&A                                                               | `interview.md`     |

---

**Memorize this:** Inappropriate Intimacy is a *failure of information hiding*. Every cross-class read or write is a claim that *both* classes are now liable for. Java's access modifiers don't enforce hiding — `private` plus rigorous reference discipline does. Detect intimacy with bidirectional-edge graphs, fix it by naming the missing aggregate, and budget the cleanup as ongoing debt service.
