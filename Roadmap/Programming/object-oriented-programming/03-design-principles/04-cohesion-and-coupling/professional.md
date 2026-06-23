# Cohesion and Coupling — Professional

> **What?** Driving "high cohesion, low coupling" across a team and codebase: the vocabulary you use in review (Constantine's seven, connascence levels, LCOM, Ce/Ca), the static checks that catch the obvious offenders, mentoring without dogma, knowing when to call a decoupling sprint, and recognising the three flavours of coupling that demand different responses.
> **How?** Treat the rule as a *vocabulary*, not a prescription. In review, name the cohesion level you see and the connascence type, point to the cost, propose the smallest move (split along a connected component, invert a dependency, replace stamp coupling with a slim record).

---

## 1. Code-review vocabulary

Three short phrases cover most reviews. Memorise them and use them precisely.

> **Reviewer:** This is *logical* cohesion — `MathUtils.sin/cos/sqrt/random` are all "math" but each is independent. Acceptable for stateless utilities. The new `validate()` method that takes `Order` and writes to the DB breaks the logical fit; it belongs in `OrderValidator`, not here.

> **Reviewer:** This is *position connascence* across a module boundary. `process(width, height, count)` will silently break the moment someone swaps the first two. Promote the three args to a `ProcessSpec` record; positional couplings stay local to the record.

> **Reviewer:** Ce on this class is 12 — it depends on three repositories, four gateways, two clocks, and three mailers. The class isn't one purpose; it's twelve coordinations. Split by axis.

Each comment names the *specific kind* of cohesion or coupling and ends with a concrete next step. "This is coupled" without specifics is noise; "this is position-connascent across a module boundary" is actionable.

---

## 2. Static analysis: what tooling catches

A handful of automated checks turn most coupling and cohesion smells into CI failures.

**SonarQube:**

- `java:S1200` — *Classes should not be coupled to too many other classes* (configurable threshold; default 20). Ce check.
- `java:S1448` — *Classes should not have too many methods* (cohesion proxy).
- `java:S1192` — *Duplicated literals* — name-connascence smells.
- `java:S107` — *Methods should not have too many parameters* (stamp coupling proxy).
- `java:S1604` — *Excessive coupling* — combined Ce + Ca alert.

**Checkstyle / PMD:**

- `ClassFanOutComplexity` (Checkstyle) — Ce metric.
- `CouplingBetweenObjects` (PMD) — same.
- `TooManyFields`, `TooManyMethods` (PMD) — cohesion proxies.

**ArchUnit** for codebase-wide rules — the *strongest* enforcement, because it expresses architectural intent:

```java
@ArchTest
static final ArchRule domain_does_not_depend_on_infrastructure =
    noClasses().that().resideInAPackage("..domain..")
               .should().dependOnClassesThat()
               .resideInAnyPackage("..infrastructure..", "..web..", "..persistence..");
// Architecture-level decoupling: domain at the centre.

@ArchTest
static final ArchRule no_class_depends_on_too_many_other_classes =
    classes().should().notDependOn(MoreThan.classes(15));
// Per-class fan-out cap.

@ArchTest
static final ArchRule no_god_packages =
    slices().matching("com.acme.(*)..").should().beFreeOfCycles();
// No circular dependencies between packages.
```

ArchUnit catches *structural* coupling problems; Sonar catches *line-level* proxies. Combined, they free reviewers for the harder cohesion judgements.

---

## 3. Mentoring without dogma

A junior who has just learned LCOM will sometimes split every class into one-method classes "for cohesion". The mentoring move is to anchor the rule to a concrete pain.

> **Mentor:** Remember when the tax change broke the PDF rendering test? That's why we separate the calculator from the renderer — different stakeholders, different reasons to change. The class is cohesive when the methods serve the *same stakeholder*. `MathUtils.sin/cos` is fine because they all serve "do math"; mixing tax and rendering is two stakeholders.

> **Junior:** Should every class have its own interface?
> **Mentor:** No. Interfaces earn their keep at infrastructure boundaries (DB, network, time, randomness). Don't invent an `IClock` if your code doesn't need to test time. Don't invent an `IFoo` for every `Foo`.

Teach cohesion attached to a *real refactor pain*: a class that grew unwieldy and produced bugs. Teach coupling attached to a *real test pain*: a class that needed six mocks to test.

---

## 4. Anti-patterns juniors will introduce

These appear in nearly every codebase where cohesion/coupling were taught before they were felt.

**The `Utils` graveyard.**

```java
public final class Utils {
    public static String formatDate(LocalDate d) { /* ... */ }
    public static String slugify(String s)       { /* ... */ }
    public static int gcd(int a, int b)          { /* ... */ }
    public static byte[] hash(byte[] data)       { /* ... */ }
    public static String escapeHtml(String s)    { /* ... */ }
    // ...60 more methods
}
```

Coincidental cohesion. Every method serves a different stakeholder. Split by *purpose-bearing name*: `DateFormatter`, `Slugifier`, `GcdComputer`, `Hasher`, `HtmlEscaper`. Five tiny classes beat one bag.

**Constructor explosion.**

```java
public OrderService(OrderRepo r, Validator v, Notifier n, Audit a, Metrics m, Tracer t,
                    Clock c, Settings s, FeatureFlags f, EventBus e, Cache cache, ...) {}
```

12 collaborators means 12 reasons to change — the cohesion is gone. Split by axis: `OrderPlacer` (placing) holds `repo`, `validator`, `events`; `OrderNotifier` (notifications) holds `notifier`, `audit`; etc. Each new class has 2–4 collaborators.

**God interface.**

```java
public interface OrderService {
    void place(Order o); void cancel(OrderId id); Receipt getReceipt(OrderId id);
    List<Order> findByCustomer(CustomerId c); void refund(OrderId id, Money amount);
    Report generateReport(LocalDate from, LocalDate to); void exportCsv(Path p);
    // ...
}
```

Same problem at the interface level. ISP (interface segregation) says: split by *client role*. `OrderPlacing`, `OrderQuery`, `OrderRefund`, `OrderReport`. Callers depend on the narrow role they need.

**Premature decoupling.**

```java
public interface IMoney { /* one method */ }
public class Money implements IMoney { ... }
public interface IOrderId { /* one method */ }
public class OrderId implements IOrderId { ... }
// ...30 more "interface per value object"
```

Every value class has a hollow interface. Decoupling is performative — there's no second impl, no plan for one. Delete the interfaces; `Money` and `OrderId` are stable values.

---

## 5. When to call a cohesion/coupling sprint

Most cohesion/coupling work happens in PR-sized increments. Occasionally you dedicate time. The signals:

1. **The same module produces 40% of incidents.** A class that keeps breaking has too many reasons to change, or too many things depending on it.
2. **A new feature touches 8+ classes.** That's coupling speaking.
3. **`git log --pretty='%an' -- src/main/java/com/acme/OrderService.java` shows 12 contributors in 6 months.** No cohesion.
4. **Tests require 5+ mocks for one method.** Coupling smell — the class talks to too many collaborators.
5. **Onboarding time on the codebase is dominated by "what does this class actually do?"**

Scope the sprint. *Bad:* "Improve cohesion and coupling across the codebase." *Good:* "For the `order.*` package, reduce per-class Ce to ≤ 6, eliminate `@Autowired` field injection, ensure each class has one connected component (LCOM4 = 1). Existing tests pass; no public API changes."

> **Lead to team:** This sprint, we touch only `order.*`. Exit criteria: each class is under 300 lines, no constructor has more than 5 parameters, no class is `@Autowired` (all constructor-injected), ArchUnit fan-out rule passes. We don't touch `shipment.*` even if tempted.

---

## 6. Cohesion and coupling at the architectural level

The package-level analogue of class cohesion is **Common Closure Principle (CCP)**: classes that change together belong in the same package. The architecture-level analogue of decoupling is **Stable Dependencies Principle (SDP)**: depend in the direction of stability.

ArchUnit enforces both:

```java
@ArchTest
static final ArchRule no_cycles_in_packages =
    slices().matching("com.acme.(*)..").should().beFreeOfCycles();

@ArchTest
static final ArchRule stable_dependencies =
    noClasses().that().resideInAPackage("..domain..")
               .should().dependOnClassesThat()
               .resideInAPackage("..infrastructure..");
```

The hexagonal architecture pattern is this principle written down: the *domain* at the centre (stable, high fan-in), *infrastructure* at the edges (unstable, high fan-out). Dependencies point inward. The compiler and ArchUnit enforce the direction.

---

## 7. The "uniform size" trap — performative compliance

The most dangerous failure mode is *performative cohesion*: every class is split until they're all 50 lines, and the codebase has 800 classes that nobody can navigate.

```java
public final class OrderTotalCalculator { public Money compute(Order o) { /* ... */ } }
public final class OrderTaxCalculator   { public Money compute(Order o) { /* ... */ } }
public final class OrderDiscountApplier { public Order apply(Order o, Discount d) { /* ... */ } }
public final class OrderValidator       { public void validate(Order o) { /* ... */ } }
public final class OrderPersister       { public void save(Order o) { /* ... */ } }
public final class OrderEventPublisher  { public void publish(OrderEvent e) { /* ... */ } }
// ...50 more "Order_____" classes
```

Each class is one method. LCOM = 1. Coupling looks low. The codebase is unreadable: to understand a single workflow you read twelve files.

> **Senior reviewer:** Splitting `Order` into 50 helpers doesn't increase cohesion — it scatters it. An order is *one concept*. Methods that operate on the same order should live on `Order`. The signal isn't class count; it's *whose methods edit this class*.

Treat the metrics as *prompts to look*, not *boxes to tick*. When a PR shows perfect LCOM scores, look at whether the *concepts* are coherent.

---

## 8. The dependency-direction rule

A senior eye on dependencies looks for *direction*, not just *count*. Three populations of incoming dependencies:

- **Stable consumers** (a domain `Money` used by 50 places) — fan-in is the *job*. Don't restructure to reduce it.
- **Cross-team dependencies** — when another team imports your internals, the team boundary is the API. Lock down internals; require API contracts.
- **Cyclic dependencies** (`A → B → A` through some path) — *always* a smell. Refactor to break the cycle, usually by inverting one of the edges.

```java
// ArchUnit catches cycles
@ArchTest
static final ArchRule no_package_cycles =
    slices().matching("com.acme.(*)..").should().beFreeOfCycles();
```

Cycles always pay back: the JVM still loads the classes (Java has no header-include problem), but the *change cost* through the cycle is unbounded — any class in the cycle changing forces all classes in the cycle to recompile.

---

## 9. Migrating a legacy module — strangler shaped by cohesion

You inherit a 3,000-line `OrderManager`. The temptation is a rewrite. Don't. Strangle by cohesion-axis:

1. **Identify the axes of change** from `git log`: payments, tax, shipping, audit, refunds.
2. **For the most-frequent axis (e.g., payments)**, create a new `PaymentHandling` class.
3. **Move the payment-related methods from `OrderManager` to `PaymentHandling`.** Replace original method bodies with delegation:

```java
public class OrderManager {
    private final PaymentHandling payments;
    public void processPayment(Order o) {
        payments.process(o);                  // was 100 lines of inline payment code
    }
}
```

4. **Tests for payments now exercise `PaymentHandling`** directly, with payment-specific fixtures and no `OrderManager` dependency.
5. **Repeat for the next axis.**
6. **When `OrderManager` is empty**, delete it. The five new classes are each cohesive.

The strangler-by-cohesion is iterative, reviewable, and each step is independently shippable.

---

## 10. Quick rules

- [ ] In review, name the *type* of cohesion (Constantine's 7) and *type* of connascence (Page-Jones's 9) before suggesting a refactor.
- [ ] Wire ArchUnit for layer dependencies, cycle detection, and per-class fan-out limits.
- [ ] Wire Sonar/PMD for line-level proxies (S1200, S1448, S107).
- [ ] Teach cohesion attached to a *real* bug the team felt — a class that grew unwieldy.
- [ ] Delete interfaces with one implementation unless they cross an infrastructure boundary.
- [ ] If a constructor has 8+ parameters, the class has too many reasons to change.
- [ ] If a test needs 5+ mocks, the class talks to too many collaborators.
- [ ] Beware uniform-size compliance; size should match purpose.
- [ ] `git log --author` mix on a class is the real cohesion test.
- [ ] Cycles are *always* a smell. Break them by inverting one edge.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| The two ideas in plain English with one example             | `junior.md`        |
| Worked refactors: split low cohesion, invert dependencies   | `middle.md`        |
| Connascence, Constantine's ladder, balance with other forces | `senior.md`       |
| JLS access control, modules, package design                 | `specification.md` |
| Spotting hidden coupling and cohesion drift                 | `find-bug.md`      |
| Performance impact of indirection layers                    | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** "high cohesion, low coupling" is a code-review vocabulary, not a checklist. Your job as a senior is to name the *kind* of cohesion or coupling (Constantine + Page-Jones), to push enforcement into ArchUnit/Sonar where mechanical, to mentor with felt pains, and to migrate legacy by strangling along the cohesion axes. Cycle-free, fan-out-bounded, infrastructure-at-the-edge — those are the architectural shapes you push toward.
