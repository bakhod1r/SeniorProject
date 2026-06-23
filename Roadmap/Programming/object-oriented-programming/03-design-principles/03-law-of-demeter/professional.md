# Law of Demeter — Professional

> **What?** Driving the Law of Demeter across a team and codebase: the vocabulary you use in review ("train wreck", "structural reach"), what static analysis can detect, mentoring without dogma, when LoD pays off in a refactor sprint, and how to apply it without turning every entity into a god class.
> **How?** Treat LoD as a *coupling vocabulary*, not a literal dot ban. Name the smell precisely, point at the cost, propose the smallest move (push the intent up, add a method, hide the structure behind an aggregate boundary).

---

## 1. Code-review vocabulary

Three short phrases cover most LoD review feedback. Memorise them and use them precisely.

> **Reviewer:** This is a train-wreck chain. `order.getCustomer().getAddress().getCountry().taxFor(order)` couples `CheckoutService` to four classes' internal structures. Push the intent up: `order.taxAmount()`. Each link should be a method on the owning object.

> **Reviewer:** This is structural reach. `Helpers.countryOf(order)` doesn't fix the chain, it moves it — `Helpers` now carries the four-class knowledge `CheckoutService` had. Eliminate the chain by giving `Order` the answer the caller wants.

> **Reviewer:** This is aggregate leakage. `order.lineItems().forEach(li -> li.applyDiscount(d))` reaches past the aggregate root to mutate an internal entity. Add `order.applyDiscount(d)`; let `Order` decide how its line items respond.

Each comment names the *specific cost* (coupling to N classes, knowledge migration, broken aggregate boundary) and ends with a concrete next step. "LoD violation" without a fix is noise; "violates LoD" with the proposed forwarder method is actionable.

---

## 2. Static analysis: what tooling can catch

LoD is mechanical enough to detect partly automatically. Three layers of enforcement that pay off in CI.

**SonarQube / Checkstyle:**

- `java:S2293` (Sonar) — *Method invocations should not be chained*. A blunt instrument — it flags streams too — but useful as a starting filter; configure exemptions for `Stream`, `Optional`, `Builder` types.
- `LawOfDemeter` (PMD) — flags method invocations on objects retrieved through other methods. Has known false positives on builders and streams; tune via `trustRadius` and exclusions.

**ArchUnit** for codebase-wide structural rules:

```java
@ArchTest
static final ArchRule services_dont_reach_into_aggregates =
    noClasses().that().resideInAPackage("..service..")
               .should().callMethodWhere(
                   target(rawParameterTypes(InternalEntity.class)).as("internal entity")
               );

@ArchTest
static final ArchRule no_external_use_of_internal_packages =
    noClasses().that().resideOutsideOfPackage("..order..")
               .should().dependOnClassesThat()
               .resideInAPackage("..order.internal..");
```

The second rule is more LoD-meaningful: it enforces that *internals are not reachable* — making package access the language-level LoD enforcer.

**JPMS module-info.java** is the strongest signal: an internal package not in `exports` cannot be navigated from outside, regardless of getter chains in the public surface.

None of these tools catches *every* LoD violation — chained getters that return the same type look like fluent APIs to a linter. But the combination of `ArchUnit + JPMS + tuned PMD` keeps the obvious failures out of review.

---

## 3. Mentoring without dogma

A junior who has just learned LoD will sometimes refuse every chain — including `Stream.filter().map().reduce()`. The mentoring move is to anchor the rule to the *cost it prevents*, not to dot count.

> **Mentor:** The reason we don't write `order.getCustomer().getAddress().getCountry()` is that next month, when `Address` changes to hold `Region` first and `Country` second, fifteen call sites break. The chain wasn't slow — it was *fragile*. The fix is `order.taxAmount()`, which doesn't care how addresses are structured.

> **Junior:** Should I also avoid `list.stream().filter().map().toList()`?
> **Mentor:** No — every dot returns a `Stream<T>`. You're not navigating an order's structure; you're driving a pipeline. The cost LoD prevents (fragility through structure) doesn't apply.

Teach LoD retrospectively, attached to a *real* refactor pain — the day a domain reshape broke six methods that walked it. Never as a "no more than one dot" rule applied to greenfield code.

The mentor's three checks:

1. *Which types does this chain touch?* (more than two → look harder)
2. *Are they pipeline types or domain types?* (pipeline OK; domain suspicious)
3. *What method on the first object would replace the chain?* (name it; it's usually the fix)

---

## 4. Anti-patterns juniors will introduce

These appear in every codebase where LoD was taught before it was felt.

**Forwarder explosion.**

```java
public class Order {
    public String customerName()        { return customer.name(); }
    public String customerEmail()       { return customer.email(); }
    public String customerAddressLine() { return customer.address().line(); }
    public String customerCity()        { return customer.address().city(); }
    // ...20 forwarders
}
```

Every call site that used to chain now calls a one-liner forwarder. LoD is technically respected; the *structural knowledge* is unchanged — `Order` now publishes the customer's address shape. Fix: don't expose customer details through `Order` at all. Either the operation belongs on `Order` (`order.invoiceLines()` returning a summary record), or the caller should ask the customer directly.

**Helper-class laundering.**

```java
public class OrderHelpers {
    public static Country countryOf(Order order) {
        return order.customer().address().country();   // chain in helper
    }
}
```

The chain moved from `CheckoutService` to `OrderHelpers`. `OrderHelpers` is now the coupling site. Real LoD compliance means *eliminating* the chain.

**Wrong-direction push.**

```java
public class Customer {
    public void sendWelcomeEmail() {
        Smtp.global().send(email, "Welcome", greeting());     // SMTP in domain
    }
}
```

Strict LoD said "push it to the owner". The student picked the wrong owner: SMTP is *infrastructure*, not a customer concern. The right shape is `Customer.welcomeMessage()` returning a value, and a `WelcomeMailer` sending it.

**Deep stubbing.**

```java
@Mock(answer = Answers.RETURNS_DEEP_STUBS) Order order;
when(order.customer().address().country()).thenReturn(germany);
```

The test passes; the production code is still LoD-broken. Deep stubbing is mock cheating — it hides the design problem rather than surfacing it.

---

## 5. When to call a LoD-driven refactor sprint

Most LoD work is PR-sized. Occasionally a dedicated sprint is justified. The signals:

1. **A model change broke 20+ methods.** Every method that walked the old structure had to be updated. The pain proves the structural coupling is real.
2. **Deep-stub mocking is the standard test idiom.** When `RETURNS_DEEP_STUBS` is in every test file, production has matching chains.
3. **The same five getters are called together in many places.** That's a hidden cohesive operation begging for a method name.
4. **New hires confuse "domain logic" with "service logic" because all behaviour lives in services.** Anaemic domain — fixable by pulling behaviour back to the entities (with LoD as the guide).

Scope the sprint. *Bad:* "Apply LoD to the codebase." *Good:* "For the `order.*` aggregate, eliminate every chain through `Order` deeper than one level. Add domain methods on `Order` for the five identified operations. Existing tests pass; no public API changes."

> **Lead to team:** We touch only `order.*`. Exit criteria: zero `order.customer().something()`, zero `order.lineItems().get(i).something()` in callers. Five new methods on `Order` cover the operations. Tests use the new methods, not deep stubs.

---

## 6. Aggregate-shaped enforcement

In a DDD codebase, LoD is enforceable at the *aggregate boundary*. The professional move:

- **Each aggregate lives in its own package** (e.g., `com.acme.order`).
- **Internal entities and value objects are package-private** — invisible to other packages.
- **Only the root (and a few documented value records) are `public`.**
- **ArchUnit enforces no external access to `*.internal.*` packages.**

```java
package com.acme.order;

public final class Order { /* aggregate root */ }
public record OrderId(UUID value) { }

// package-private — invisible outside this package
final class LineItem { /* ... */ }
final class ShippingPolicy { /* ... */ }
```

Now any caller who tries `order.lineItems().get(0).somemethod()` faces a compile error — `LineItem` is not imported and cannot be named. LoD is no longer a code-review topic; it's a compiler constraint.

This is the *professional* version of LoD: not "stop writing chains", but "design packages so chains aren't possible".

---

## 7. The Demeter Method (1989) — the original treatment

Karl Lieberherr's "Demeter Method" paper introduced LoD in 1989 as part of a broader system for *adaptive programming*. The core insight: software changes are rarely in algorithms; they're in *the shape of the data*. If your methods couple to data shape, every reshape is a code change. If your methods couple to *operations*, the shape can change beneath them.

The professional takeaway:

- LoD isn't a syntactic rule; it's a coupling minimizer.
- The "dot count" is a shorthand for *the number of types your method's source depends on shape-wise*.
- The original paper exempted "static, globally shared utility objects" — `Math`, `Files`, framework classes — from the rule. Tightening the rule to forbid these adds ceremony for no gain.

Cite the paper when juniors challenge the rule on stream pipelines: "Lieberherr exempted utility chains; you're chaining through `Stream<T>`, which is a utility type."

---

## 8. Architectural-level LoD

At the architecture level, LoD reads as:

- **Modules talk to modules' public APIs**, not their internals.
- **Bounded contexts don't share entities** — they exchange events or DTOs, not live objects.
- **Service interfaces expose intents** (verbs), not collaborator references (getters).
- **Adapters at the boundary may walk structure** (mappers, serializers) — the only exempt class.

A service whose API is `OrderService.placeOrder(...)`, `OrderService.cancelOrder(...)`, `OrderService.refundOrder(...)` is LoD-friendly. A service whose API is `OrderService.getRepository()`, `OrderService.getValidator()`, `OrderService.getPolicy()` is LoD-broken — every caller chains through it.

```java
// Architecture-level LoD violation
public final class OrderModule {
    public OrderRepository repository();         // exposes internals
    public ValidationPolicy validator();         // exposes internals
}

// LoD-compliant
public final class OrderModule {
    public void place(Order o)                   { /* uses repo + validator internally */ }
    public void cancel(OrderId id, Reason r)     { /* uses repo + validator internally */ }
}
```

The first module is a *getter facade*; callers chain through it. The second is an *intent facade*; callers ask for what they want.

---

## 9. The "LoD checklist" trap — performative compliance

The most dangerous failure mode is *performative LoD*: every method has one dot, every chain is wrapped in a forwarder, and the code is still over-coupled.

```java
// Looks LoD-compliant
public class CheckoutService {
    public Money totalDue(Order order) {
        Customer c = order.customer();
        Address a = c.address();
        Country country = a.country();
        return country.taxFor(order);
    }
}
```

The dots are split across local variables — same coupling, no chain syntax. A reviewer counting dots gives the thumbs-up; a reviewer counting *types touched* sees four.

> **Senior reviewer:** Splitting `a.b().c()` into `Foo a = x.a(); Bar b = a.b(); ...` doesn't reduce coupling. The number of types this method's source depends on is what matters. Push the call to `order.taxAmount()`.

Treat LoD as a *prompt to look*, not a *rule to satisfy syntactically*. When a PR shows perfect-looking LoD, look at the types — they're often unchanged.

---

## 10. Quick rules

- [ ] In review, name *which types* the chain couples to; "LoD violation" without specifics is noise.
- [ ] Configure PMD's `LawOfDemeter` with exemptions for `Stream`, `Optional`, `Builder`; combine with ArchUnit rules on aggregate packages.
- [ ] Teach LoD attached to a *felt* refactor pain — the day a model reshape broke 20 methods. Never as a greenfield mantra.
- [ ] Delete forwarders that publish internal structure. The fix is a new method on the root, not a getter chain.
- [ ] Use package access to make aggregate internals *unimportable*. Compiler-enforced LoD scales better than review.
- [ ] If tests use `RETURNS_DEEP_STUBS`, the production code has matching chains. Fix the design, not the mock.
- [ ] When strict LoD pushes domain into infrastructure (SMTP into `Customer`), cohesion wins — return values, don't reach.
- [ ] Cross-aggregate orchestration is exempt: a domain service knows multiple roots, not their internals.
- [ ] LoD-laundering helpers (`OrderHelpers.countryOf(order)`) move the smell. Eliminate the chain, don't relocate it.
- [ ] Count *types this method touches via navigation* before merging. That count is the coupling.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| The rule in plain English with one example                  | `junior.md`        |
| Worked refactors of train-wreck chains                      | `middle.md`        |
| Edge cases — streams, builders, value objects in depth      | `senior.md`        |
| JLS / module-level vocabulary for LoD                       | `specification.md` |
| Spotting subtle LoD violations and runtime symptoms         | `find-bug.md`      |
| Cost of indirection: dispatch, allocation, JIT inlining     | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** *Law of Demeter* is a code-review vocabulary that names structural coupling. Your job as a senior is to make review *short* by naming which types the chain touches, to push enforcement into package boundaries and module exports where compiler-enforceable, to mentor by attaching the rule to a felt refactor pain, and to reject performative compliance (splitting chains into local variables doesn't fix anything). Bend the rule for streams, builders, mappers, and cross-aggregate orchestration. Apply it strictly where structural reshape is a real cost.
