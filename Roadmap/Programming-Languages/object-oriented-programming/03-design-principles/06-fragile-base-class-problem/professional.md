# Fragile Base Class Problem — Professional

> **What?** Driving FBCP awareness across a team: the code-review vocabulary ("designed for inheritance vs accidentally extensible", "self-use contract", "binary compatibility"), the static checks that catch the obvious risks, mentoring teams that inherited a deep hierarchy, when to call a "kill the abstract base" sprint, and the policies that keep new code FBCP-resistant.
> **How?** Treat FBCP as a *vocabulary*, not a one-time refactor. In review, name the specific risk (open class without inheritance design, self-use without documentation, subclass overriding `equals`). Propose the smallest move: add `final`, document `@implSpec`, refactor to composition, sealed-ify the hierarchy.

---

## 1. Code-review vocabulary

Four short phrases cover most reviews. Memorise them and use them precisely.

> **Reviewer:** This is an accidentally extensible class. There's no inheritance design, no `@implSpec`, no contract tests. Mark it `final` until you have a documented extension plan.

> **Reviewer:** This override depends on the parent's self-use. `process` calls `validate` then `save` today; if either changes, your override stops firing. At minimum, add an `@implSpec` to the parent declaring the call order; at best, refactor to composition.

> **Reviewer:** Sealed-able. The variants of `Result` are `Success` and `Failure` — that's a closed set. Use `sealed permits` so the compiler verifies exhaustiveness and forbids unknown subclasses.

> **Reviewer:** Binary-incompatible. Removing this protected method from `BaseService` breaks every subclass that called `super.method`. Deprecate for one minor version with `@Deprecated(since="5.0", forRemoval=true)`, then remove in 6.0.

Each comment names the *specific* FBCP risk and ends with a concrete next step. "Inheritance is risky" without specifics is noise.

---

## 2. Static analysis: what tooling can catch

A handful of automated checks turn most FBCP risks into CI signals.

**SonarQube:**

- `java:S2972` — *Inner classes that should be static*. Non-static inner classes encode an implicit parent reference, an inheritance-style coupling.
- `java:S110` — *Inheritance trees deeper than N* (default 5). Deep chains are FBCP factories.
- `java:S1610` — *Abstract class with no abstract methods*. Often a "base for reuse" — fragile.
- `java:S1185` — *Useless overriding methods* (a `super.method()` no-op override). Bloated subclasses often hide FBCP.

**Checkstyle:**

- `MissingOverride` — every override must be annotated. Catches accidental matches (FBCP form 2).
- `FinalClass` — flags classes with only private constructors that should be `final`.

**ArchUnit:**

```java
@ArchTest
static final ArchRule new_classes_are_final =
    classes().that().resideInAPackage("com.acme..")
             .and().areNotInterfaces()
             .and().doNotHaveModifier(JavaModifier.ABSTRACT)
             .should().haveModifier(JavaModifier.FINAL);
// Default-final policy enforced at the codebase level.

@ArchTest
static final ArchRule abstract_classes_have_design_documented =
    classes().that().haveModifier(JavaModifier.ABSTRACT)
             .should().beAnnotatedWith(DesignedForInheritance.class);
// Custom annotation marks abstract classes that have the @implSpec etc. — others fail.
```

**Binary compatibility (CI gate):**

- `japicmp-maven-plugin` or `revapi` runs on every release.
- Fails the build if a binary-incompatible change ships without a major-version bump.

These tools turn FBCP from "occasionally bites us in prod" to "blocked at PR review or CI".

---

## 3. Mentoring without dogma

A junior who has just learned FBCP will refuse all inheritance — including `extends HttpServlet` (framework-mandated) or `extends RuntimeException` (idiomatic). Anchor the rule to the *cost*, not to the keyword.

> **Mentor:** Last quarter when we changed `BaseProcessor.run()` to add the audit step, three subclasses broke silently — they had overridden a private hook that's no longer called. That's why we mark `run()` `final` and document hooks explicitly. The cure isn't "no inheritance"; it's "no inheritance without a designed contract".

> **Junior:** Should I make `extends RuntimeException` `final` too?
> **Mentor:** `RuntimeException` is designed for extension (every Java exception hierarchy uses it). Its public API is stable, its self-use is documented in the JDK. Frameworks earn extension trust. Your `OrderService` doesn't yet.

The mentor's three checks:

1. *Was this class designed for inheritance?* (Documented hooks, contract tests, stable parent.) → extending it is fine.
2. *Are we writing a new extension point?* → apply the design-for-inheritance recipe.
3. *None of the above?* → `final` + composition.

---

## 4. Anti-patterns juniors will introduce

Predictable patterns in codebases where FBCP was taught before it was felt.

**Open by accident.**

```java
public class OrderHandler {
    public void handle(Order o) { ... }
    protected void validate(Order o) { ... }
    protected void save(Order o) { ... }
}
```

No `final`, no docs, no extension plan. Six months later, three "specialized handlers" extend it. The author wants to refactor `handle` and discovers FBCP.

Fix: default `final` policy. Author marks the class `final`; if extension is needed, the requesting team writes the design-for-inheritance changes (docs, contract tests, hook explicit-ness).

**Deep "specialization" trees.**

```java
abstract class BaseHandler { ... }
abstract class DomainHandler extends BaseHandler { ... }
abstract class CommandHandler extends DomainHandler { ... }
class OrderCommandHandler extends CommandHandler { ... }
```

Four levels. Each level adds two methods. The leaf class is testable only through the chain; FBCP cascades through every level.

Fix: flatten. Each leaf becomes a `final` class composed of role objects. The "base" responsibilities (logging, audit, transaction) become injected collaborators, not inherited code.

**Inheritance-for-DRY of one line.**

```java
abstract class BaseValidator {
    protected void notNull(Object o, String name) {
        if (o == null) throw new IllegalArgumentException(name);
    }
}
```

Every subclass inherits the one-line helper. Fragile across changes to `notNull`'s signature. Real fix: `Objects.requireNonNull` is already the JDK's canonical null check.

**Subclasses-of-subclasses leaking implementation.**

```java
class Repository<T> {
    public void save(T entity) { ... }
    protected void preSave(T entity) { /* hook */ }
}
class TimedRepository<T> extends Repository<T> {
    @Override public void save(T entity) {
        long start = System.nanoTime();
        super.save(entity);
        recordTime(System.nanoTime() - start);
    }
}
class OrderRepository extends TimedRepository<Order> {
    @Override protected void preSave(Order o) { /* validate */ }
}
```

`OrderRepository` overrides a hook that `TimedRepository` doesn't override but `Repository` calls. A change in `Repository.save`'s call to `preSave` affects `OrderRepository` through `TimedRepository`. Two-hop FBCP. Composition flattens.

---

## 5. When to call a "kill the abstract base" sprint

Most FBCP work is PR-sized. Occasionally a dedicated sprint pays off. The signals:

1. **Production bug: "a parent class change broke X subclasses silently."** Every such incident is the cost of FBCP.
2. **A framework version upgrade requires touching every subclass.** Framework-mandated inheritance accumulates risk; consider whether to migrate to a composition-friendly alternative.
3. **`git log` on an abstract class shows 3+ different teams editing it.** No single owner means no coherent contract evolution.
4. **The codebase has 10+ subclasses of one abstract class.** That's a lot of FBCP surface.
5. **A new dev's first task takes a week because the inheritance chain is unreadable.**

Scope the sprint. *Bad:* "Eliminate inheritance." *Good:* "Replace the `BaseProcessor` 4-level chain with composition. Each former subclass becomes a `final` class composed of a `ProcessingPipeline`. Existing tests pass; no public API changes."

> **Lead to team:** This sprint we touch only `processor.*`. Exit criteria: zero `extends BaseProcessor` in `main`, no `protected` methods on what was the base, ArchUnit rules pass. The four former subclasses are `final` classes composing a `ProcessingPipeline`. Production behaviour unchanged.

---

## 6. Inheritance policy at the org level

Mature teams adopt a written *inheritance policy*. Sample text:

> ### Inheritance Policy (effective 2025-01)
> 1. **New classes are `final` by default.** Un-`final` requires a design document covering: extension surface (which methods are hooks), self-use contract (which hooks are called by which methods), default behaviour for non-hook methods (typically `final`), contract test suite.
> 2. **Existing abstract classes** that don't satisfy (1) are documented as "legacy"; we deprecate inheritance in favour of composition over the next 4 quarters.
> 3. **Framework-mandated extension** (Spring, JPA, Servlets) is acceptable but the subclass must be ≤ 30 lines, delegating all logic to composed collaborators.
> 4. **`equals` / `hashCode` / `compareTo` overrides** in extensible classes require code-owner review; we prefer `final` classes for these.
> 5. **Binary compatibility:** all library modules are checked by `japicmp` in CI. A binary-incompatible change requires a major version bump.
> 6. **Sealed types** are preferred for closed variant sets; `permits` lists are reviewed quarterly.

The policy makes the trade-offs explicit. Code review now has a reference to point at.

---

## 7. Architectural-level FBCP

At the architecture level, FBCP shows up as *cross-module inheritance*:

- A platform module exposes `AbstractIntegration`; consumer modules extend.
- A version bump of the platform module is binary-incompatible for the extensions.
- Coordinating release across teams blocks every team's roadmap.

The senior corrective: cross-module *contracts* are interfaces, not classes. The platform exposes `Integration` (interface), perhaps with default methods for convenience. Consumers `implements`, not `extends`. Default methods can evolve (with care); abstract classes drag their internals into every consumer.

```java
// Platform module
public interface Integration {
    void invoke(Request req);
    default boolean supports(Request req) { return true; }       // safe to evolve
}

// Consumer module
public final class StripeIntegration implements Integration {
    @Override public void invoke(Request req) { /* ... */ }
}
```

The platform owns the contract; consumers own their implementation. FBCP eliminated at the architecture seam.

---

## 8. The "no abstract bases in our public API" rule

For *library* code published to other teams or other companies, abstract bases are FBCP traps. The senior policy:

- **Public API**: interfaces and `final` records/classes only. No abstract bases consumers are expected to extend.
- **Default methods** on interfaces are acceptable convenience helpers but treated as breaking changes when modified.
- **Sealed interfaces** for closed variant sets.
- **Internal**: abstract bases are fine within the library (the library owns all subclasses) but `non-exported` so consumers can't reach them.

```java
module com.acme.payment {
    exports com.acme.payment;
    // com.acme.payment.internal — not exported
}

package com.acme.payment;
public sealed interface PaymentGateway permits StripeGateway, AdyenGateway { /* ... */ }

package com.acme.payment.internal;
abstract class AbstractRetryingGateway { /* fine — internal only */ }
```

External code uses `PaymentGateway` (sealed interface) — extension is forbidden. Internal code uses the abstract base — extension is bounded by the module's own classes.

---

## 9. Quick rules

- [ ] In review, name the *specific* FBCP risk (open class, undocumented self-use, accidental override, binary-incompatible change).
- [ ] Wire ArchUnit `default-final` policy and Sonar `S110` (deep inheritance) into CI.
- [ ] Wire `japicmp` or `revapi` for binary-compat checks on every release.
- [ ] Teach FBCP attached to a real incident — the parent change that broke X subclasses.
- [ ] Default `final` on new classes; un-`final` only with documented inheritance design.
- [ ] Frameworks that demand `extends`: minimize the subclass, delegate via composition.
- [ ] Sealed types for closed variants; interfaces (no abstract classes) at cross-team boundaries.
- [ ] Deprecation cycle for any hook removal: `@Deprecated(forRemoval=true)` for one minor version, then remove in the next major.
- [ ] No abstract bases in the public API of a library; sealed interfaces or `final` classes only.
- [ ] Refactor sprints: scope tightly ("replace BaseProcessor's 4-level chain") with exit criteria.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| The problem in plain English with one example               | `junior.md`        |
| Worked refactors and design-for-inheritance recipes         | `middle.md`        |
| Edge cases, framework FBCP, binary compatibility            | `senior.md`        |
| JLS rules on overriding, sealed types, final                | `specification.md` |
| Spotting FBCP-shaped runtime bugs                           | `find-bug.md`      |
| Performance: virtual calls, devirtualization                | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** FBCP is a *coupling vocabulary*. Your job as a senior is to make review short by naming the specific risk, to push enforcement into ArchUnit/Sonar/japicmp where mechanical, to mentor by attaching the rule to felt incidents, and to adopt org-level policy (default `final`, no public abstract bases) that keeps new code FBCP-resistant. Inheritance is one tool; reach for it only when the parent is designed, documented, and you're prepared to maintain the contract through versions.
