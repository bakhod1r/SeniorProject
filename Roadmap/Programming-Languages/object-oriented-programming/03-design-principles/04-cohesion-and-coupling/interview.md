# Cohesion and Coupling — Interview Q&A

20 questions covering definitions, taxonomies (Constantine, Page-Jones, Martin), snippet critiques, and senior-level judgement.

---

## Q1. Define cohesion and coupling in one sentence each.

**Cohesion** measures how strongly the responsibilities *inside* a module belong together — a class is cohesive when its methods serve a single purpose. **Coupling** measures how strongly two modules depend on each other — low coupling means a change in one doesn't ripple into many others. The rule of thumb taught for fifty years: *high cohesion, low coupling*. Both are about *change cost*: cohesion limits the surface that changes when a concept evolves; loose coupling limits the cascade across modules.

**Follow-up:** "Who coined the terms?" — Larry Constantine and Edward Yourdon in *Structured Design* (1979). The vocabulary predates OO and applies broadly.

---

## Q2. Name Constantine's seven cohesion levels.

Worst-to-best: (1) **Coincidental** — methods in the same class for no reason (`Utils`, `Misc`). (2) **Logical** — same category, no workflow (`MathUtils`). (3) **Temporal** — called at the same lifecycle moment (`startup`). (4) **Procedural** — sequenced phases of a process. (5) **Communicational** — methods operating on the same data. (6) **Sequential** — output of one feeds the next. (7) **Functional** — every method contributes to one purpose. The senior move is to *name* the level you see; "bad cohesion" without a level is hand-waving.

**Trap:** Confusing communicational and functional. Communicational classes share data; functional classes share *purpose*. A `Customer` class with 20 methods that all read customer fields is communicational; a `PasswordHasher` with one method is functional.

---

## Q3. Define connascence and give two examples.

*Connascence* (Page-Jones, 1996) is a coupling taxonomy: two pieces of code are connascent if changing one requires changing the other. Examples: **Name connascence (CoN)** — two pieces refer to the same identifier (lowest, near-universal cost). **Position connascence (CoP)** — argument order matters; swapping `f(width, height)` to `f(height, width)` silently breaks callers. Connascence is *static* (compile-time: name, type, meaning, position, algorithm) or *dynamic* (run-time: execution order, timing, value, identity). Dynamic connascence is more expensive; both should be *strong but local* and *weak but distant*.

**Follow-up:** "What's the worst kind of connascence across a module boundary?" — algorithm or timing. Two services agreeing implicitly on a format string or a clock semantics is fragile.

---

## Q4. Critique this snippet for cohesion.

```java
public final class Utils {
    public static String formatDate(LocalDate d)         { /* ... */ }
    public static String slugify(String s)               { /* ... */ }
    public static byte[] hashPassword(String pwd)        { /* ... */ }
    public static int gcd(int a, int b)                  { /* ... */ }
}
```

Coincidental cohesion — four methods bagged together because the developer didn't know where to put them. Each serves a different stakeholder: localization, URL utilities, security, math. The cost shows up when one method's owner changes it (e.g., security upgrades hashing); the *recompilation surface* is every caller of `Utils`, not just the callers of `hashPassword`. Fix: four purpose-bearing classes — `DateFormatter`, `Slugifier`, `PasswordHasher`, `GcdComputer`.

**Trap:** Saying "it's fine, they're all static". Static helpers don't escape the cohesion question; the class name is still the design statement.

---

## Q5. What's the difference between stamp coupling and data coupling?

**Stamp coupling** — passing a fat object when only a few fields are needed: `taxFor(Order order)` reading only `order.subtotal()` and `order.country()`. **Data coupling** — passing exactly what's needed: `taxFor(Money subtotal, Country country)`. Stamp coupling makes the method's *real* dependencies invisible in its signature; data coupling makes them explicit. Stamp coupling pays back: changes to `Order` (a new field, a renamed accessor) ripple into every consumer; data coupling immunizes them.

**Trap:** Saying "pass the whole object to be safe". Wider arguments are stricter contracts; they break more callers when changed.

---

## Q6. What is "common coupling", and why is it dangerous?

Common coupling is two modules sharing a *global mutable state* — typically a singleton or a static field. The danger: the coupling is *invisible*. Nothing in either module's signature says "I depend on the same state as that other module"; the coupling lives in the global. Symptoms: tests that pass in isolation but fail in CI due to ordering; "fix" in one place breaks unrelated code; performance regressions because the singleton becomes a contention point. The fix: inject the abstraction through the constructor — the coupling becomes visible in the type system.

**Trap:** "Spring's `@Autowired` fixes this." It does — *if* you constructor-inject. Field injection (`@Autowired` on a non-final field) re-introduces hidden coupling because the dependency isn't in the constructor signature.

---

## Q7. Explain LCOM. What does LCOM4 = 3 mean?

*Lack of Cohesion of Methods* (LCOM4) counts the connected components of a method-and-field graph: nodes are methods, edges connect methods that share a field or call each other. **LCOM4 = 1** → fully cohesive; every method reaches every other through shared state. **LCOM4 = 3** → the class has three disconnected method groups; it's three classes glued together. The mechanical refactor: extract one class per connected component. Tools like SonarQube compute it; the human reading is the ground truth, but the metric catches the egregious cases reliably.

**Follow-up:** "Can LCOM4 = 1 still be a bad class?" — yes. The methods can be cohesive *and* the class can have too many reasons to change (the same shared state serves multiple stakeholders). LCOM measures *connectivity*, not *purpose*.

---

## Q8. Critique this snippet.

```java
public class OrderService {
    public void process(Order o, boolean async, boolean retry, boolean audit) {
        if (async) executor.submit(() -> doProcess(o, retry, audit));
        else       doProcess(o, retry, audit);
    }
}
```

Control coupling. The caller's flags directly steer the callee's branching. `process(o, true, false, true)` is illegible at the call site; reviewers can't tell what behaviour is invoked. Fix: explicit methods (`processSync`, `processAsyncWithRetry`) or a `ProcessOptions` record. The intent moves into the method name (or the option fields are named); the call site becomes readable; misuse becomes harder.

**Trap:** Saying "use enums instead of booleans". An improvement, but still control coupling — the receiver still branches. The cleaner fix is to remove the branch entirely by exposing one method per behaviour.

---

## Q9. Explain the Stable Dependencies Principle (SDP).

SDP (Robert Martin) says: *depend in the direction of stability*. A *stable* module is one with many incoming dependencies and few outgoing — it's hard to change because changes break many consumers. An *unstable* module has many outgoing dependencies — it changes often. SDP: stable modules don't depend on unstable ones; the arrows in your dependency graph should point from unstable to stable. Concretely: domain modules (`Money`, `Order`) are stable; service modules and infrastructure adapters are unstable. The arrows point inward toward the domain. Hexagonal/clean architecture is SDP written down.

**Follow-up:** "Where does business logic sit?" — in the stable core. Infrastructure orbits around it.

---

## Q10. What is the Common Closure Principle?

CCP (Martin): *classes that change together belong in the same package*. It's SRP applied to the package level. The pragma: if a feature spans three packages and you have to touch all three to ship it, those packages were drawn wrong — pull them together. Conversely, if two classes in the same package are edited by different teams for different reasons, split the package by team or by axis of change. `git log --pretty=format:%an -- src/main/java/com/acme/order/*.java` reveals whether the package is closed against one stakeholder.

**Follow-up:** "How does CCP interact with CRP?" — Common Reuse Principle says classes used together belong in the same package. CCP and CRP often agree; when they conflict, choose by which change axis is most active in your codebase.

---

## Q11. Critique this snippet.

```java
public class OrderService {
    public void process(Order o) {
        ConfigRegistry.getInstance().reloadIfStale();
        BigDecimal rate = TaxCache.INSTANCE.rateFor(o.country());
        Logger log = LoggerFactory.getLogger(OrderService.class);
        log.info("processing {}", o.id());
        MetricsRegistry.INSTANCE.increment("orders.processed");
        // ...
    }
}
```

Five hidden couplings to global state: `ConfigRegistry`, `TaxCache`, `LoggerFactory`, `MetricsRegistry`, and the `OrderService.class` literal (which couples to its own classname). None appear in the constructor signature. Tests can't substitute any of them without reflection. A change to `TaxCache.INSTANCE`'s class loader behavior can break `OrderService` invisibly. Fix: inject all five via constructor as interfaces.

**Trap:** Saying "it's fine, it's all 'utilities'". Hidden globals are coupling regardless of what we call them.

---

## Q12. When is duplication acceptable?

When the two copies serve different stakeholders or different change axes, even if they look identical today. *Apparent* duplication is OK; *meaning* duplication is not. Example: `OrderValidator.validateEmail` and `CustomerValidator.validateEmail` both call `email.contains("@")`. Merging into `Validators.isValidEmail` is wrong if the order team and customer team will diverge later (e.g., orders accept `+` aliases, customers don't). Sandi Metz: "duplication is far cheaper than the wrong abstraction." DRY is about *meaning*, not *syntax*.

**Follow-up:** "What signals that you should merge?" — when two copies always change together, in the same PR, by the same author. That's real duplication, not coincidental.

---

## Q13. How do you decide whether a class is "too big"?

Not by line count. The honest measure: list the *reasons it would be edited*. One reason → cohesive, leave it. Multiple unrelated reasons → split. A `TaxCalculator` with 800 lines all about tax is fine — its purpose is large. A 100-line `Utils` doing five unrelated things is broken. Constantine: cohesion is *purpose-shared*. The Sonar `java:S1448` (too many methods) is a *proxy*, not the truth.

**Trap:** Forcing every class under 200 lines. Uniform sizes encourage performative splits; the metric is *purpose-bound size*.

---

## Q14. What's the strongest decoupling mechanism in Java?

The Java Platform Module System (JPMS, Java 9+). A module's `module-info.java` declares which packages are exported and which modules are required. Non-exported packages are *strongly encapsulated*: even reflection can't access them without explicit `opens`. The runtime — not just the compiler — enforces the boundary. JPMS turns coupling into a declared property of the codebase: `requires com.acme.payments` is the explicit fan-out, not buried in import statements.

**Follow-up:** "What if a library doesn't use modules?" — the unnamed module reads every other module; coupling can leak in via reflection. JPMS only protects code that opts in.

---

## Q15. How does the constructor's parameter count signal cohesion?

A constructor with 8+ parameters is almost always a cohesion smell. Each parameter is a collaborator; many collaborators means many reasons for the class to change. The class is doing several jobs, not one. Fix: split the class by axis (orchestration, domain logic, infrastructure adapter). Each piece has 2–4 collaborators. The orchestrator at the top might still hold all the pieces, but each piece's surface is small.

**Trap:** Saying "use a builder for the constructor". Hiding the count doesn't reduce the cohesion problem — the class still has 12 collaborators.

---

## Q16. Critique this snippet for coupling and cohesion.

```java
public class CheckoutHelper {
    public static boolean isValidEmail(String e) { /* ... */ }
    public static BigDecimal calculateTax(Order o) { /* ... */ }
    public static String renderInvoicePdf(Order o) { /* ... */ }
}
```

Logical cohesion — three methods grouped by the "checkout" theme but sharing nothing. Worse: testing one method doesn't isolate the concerns. A tax-rate change shipped with a hollow PDF assertion can break invoice rendering without the test catching it. Fix: three focused classes — `EmailValidator`, `TaxCalculator`, `InvoiceRenderer`. Each gets its own tests with focused assertions. The grouping by theme was incidental, not functional.

**Trap:** Saying "it's a helper class, that's fine". Helpers grow the same anti-patterns as classes. Naming a class `Helper` doesn't exempt it.

---

## Q17. When can decoupling hurt readability?

When the indirection layer adds no swap-ability and the abstraction is invented to satisfy a rule, not to serve a real second implementation. Example: every domain class has `IThing/Thing` pairs with one implementation; every method is constructor-injected even if no test needs to substitute it. The interface adds a file, an indirection, a mental hop. The cure is to *delete* the interface until a real second implementation arrives. Decoupling is a means; readability is the end.

**Follow-up:** "How do you tell the difference?" — ask "would I ever need a second implementation?" If yes (infrastructure, time, randomness), keep the interface. If no, delete it.

---

## Q18. What is cyclic dependency, and why is it a smell?

Two modules that depend on each other (`A → B → A`). Three problems: (1) compile cascade — changing either forces both to recompile; (2) test isolation impossible — mocking one requires the other; (3) deployment cascade — neither can be released independently. The fix is to invert one edge — usually by introducing an *abstraction* both depend on (event bus, interface in a shared module). At the architecture level, ArchUnit's `slices().beFreeOfCycles()` catches them.

**Trap:** "Java has no header problem like C; cycles are fine." Java compiles them, yes — but the change-cost problem is independent of compile mechanics. Cycles are a *design* smell.

---

## Q19. When does cohesion lose to performance?

Rarely. Modern JITs inline through cohesive method splits at zero cost; CHA proves monomorphism; records get scalar-replaced. The real performance cost lives in *megamorphic call sites* (an interface field with many concretes across instances) and in *N+1 walks over lazy graphs*. Both are *coupling* issues, not cohesion issues. The common claim "smaller methods are slower" is folklore.

**Trap:** Inlining-by-hand for performance. Almost always wrong; the JIT does it better.

---

## Q20. What's the "uniform size" anti-pattern?

Splitting classes until they all have similar line counts — say, under 200 lines — regardless of whether the splits respect cohesion. Symptoms: a `OrderTotalCalculator`, `OrderSubtotalCalculator`, `OrderShippingCostAdder`, `OrderDiscountSubtractor` family where each has one method, and to understand "how an order's total is computed" you read twelve files. Cohesion *splits by purpose*, not by size. A class can be 1,000 lines and cohesive; it can be 30 lines and shattered cohesion.

**Follow-up:** "How do you spot it in review?" — look for class names that are *one verb on Order*. They are usually a one-method class that should be a method on `Order`.

---

**Use this list:** rotate one question per axis (definitions, taxonomies, snippet critiques, architectural-scale, performance). Strong candidates name the *kind* of cohesion or coupling (Constantine's seven, Page-Jones's nine), and balance the metrics against cohesion's pull, decoupling's tax, and the real change axes the codebase faces.
