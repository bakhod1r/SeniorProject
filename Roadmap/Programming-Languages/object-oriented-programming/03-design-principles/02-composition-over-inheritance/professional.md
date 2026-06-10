# Composition Over Inheritance — Professional

> **What?** Driving "favour composition over inheritance" across a team and a codebase: the vocabulary you use in code review, the static checks that detect inheritance abuse before review, mentoring without dogma, when to call a refactor sprint that flattens a hierarchy, migrating legacy `extends` trees without breaking callers, and recognising the three populations of `extends` that demand different responses.
> **How?** Treat the rule as a *vocabulary*, not a *commandment*. Name the smell (`extends` for reuse, fragile base, leaked API), point to the specific cost, propose the smallest move (inline the parent, lift the field, introduce a role interface).

---

## 1. Code-review vocabulary

Three short phrases cover most reviews where the rule applies. Memorise them and use them precisely.

> **Reviewer:** This is `extends`-for-reuse. `OrderProcessor extends BaseProcessor` inherits five methods; only two are overridden, only one is actually called by `OrderProcessor`. Hold a `BaseProcessor` (or just the helper it gives you) as a field and delegate the one method. No more open API surface than the one you want.

> **Reviewer:** This subclass throws on three inherited methods. That's an LSP/ISP combo: the parent's API doesn't fit. Either implement a narrower interface that doesn't carry the three methods, or compose the parent and expose only the surface the caller needs.

> **Reviewer:** This chain is six decorators deep. Composition is right, the layering is too thick — collapse the cross-cutting concerns (retry, log, time, audit) into one wrapper that knows how to dispatch.

Each comment names the *specific cost* (leaked API, broken substitutability, unreadable chain) and ends with a concrete next step. "Use composition" without specifics is noise.

---

## 2. Static analysis: what tooling can catch

A handful of automated checks turn most `extends`-for-reuse cases into compile-time or CI-time failures.

**SonarQube** (rules that map to the principle):

- `java:S110` — *Inheritance trees deeper than N* (default N=5). A direct signal for deep "specialization" trees you should flatten.
- `java:S2972` — *Inner classes that should be static*. Static inner classes typically signal composition; non-static ones encode an implicit parent reference, an inheritance-ish coupling.
- `java:S1610` — *Abstract class with no abstract method*. Often a "base class" used purely for reuse.
- `java:S1185` — *Useless overriding methods*. Subclass that overrides the parent with `super.method(args)` — pointless inheritance.

**Checkstyle / PMD:**

- `FinalClass` (PMD) — flags classes with only private constructors that should be `final`.
- `MissingOverride` (Checkstyle) — every override is annotated, so silent API drift in forwarders fails to compile.

**ArchUnit** for codebase-wide policies:

```java
@ArchTest
static final ArchRule no_app_class_extends_jdk =
    noClasses().that().resideInAPackage("com.acme..")
               .should().beAssignableTo("java.util.ArrayList")
               .orShould().beAssignableTo("java.util.HashMap");
// Don't extend JDK collections — wrap them.

@ArchTest
static final ArchRule services_are_final =
    classes().that().resideInAPackage("..service..")
             .and().areNotInterfaces()
             .should().haveModifier(JavaModifier.FINAL);
// Service classes are final unless designed otherwise.
```

ArchUnit catches the codebase-wide rules; Sonar catches the line-level smells; Checkstyle/PMD catch the lexical proxies. None of them is enough alone; the combination frees reviewers from chasing mechanical violations.

---

## 3. Mentoring without dogma

A junior who has just read about composition will sometimes refuse `extends` for *everything*, including framework-mandated cases. The mentoring move is to anchor the rule to a concrete pain.

> **Mentor:** Remember when adding `sortByDate` to `OrderList` broke fifteen call sites because they had been using `List.sort()` with custom comparators on the same field? That's why we wrap collections instead of extending them. The pain was inherited API surface; the rule is "don't leak it".

> **Junior:** Should I also avoid `extends HttpServlet`?
> **Mentor:** No. That's framework-mandated inheritance; the Servlet API only knows how to dispatch through a class. The rule is "no `extends` for reuse"; framework hooks are a different category — see [`senior.md`](senior.md) §7.

The three categories — framework, type-family, reuse — are the mentoring scaffold. Juniors who learn to ask "which of the three is this?" stop applying the rule mechanically and start applying it where it pays.

Teach retrospectively, attached to a real diff that hurt. Never as a prescription for greenfield code.

---

## 4. Anti-patterns juniors will introduce

These appear in every codebase where "composition" was taught before it was felt.

**Decorator soup.**

```java
PaymentGateway g = new RetryingGateway(
    new LoggingGateway(
        new TimingGateway(
            new IdempotentGateway(
                new AuditingGateway(
                    new StripeGateway())))));
```

Six layers each adding three lines of cross-cutting code. Composition is right; the granularity is wrong. Collapse them. One dispatching wrapper plus an event/observer stream usually replaces five of the six.

**Forwarder factory of doom.**

A factory that returns a `T` by composing seven helpers, each of which holds three more helpers. The dependency graph is invisible because every "has-a" is private. The fix is to *name* the cohesive subset — instead of "the OrderService that holds seven things", introduce an `OrderPipeline` value object that the service holds.

**The new abstract base.**

```java
public abstract class BaseHandler {                   // (just to share `audit()` and `log()`)
    protected void audit(Event e) { ... }
    protected void log(String s)  { ... }
}
public class CheckoutHandler extends BaseHandler { ... }
public class RefundHandler   extends BaseHandler { ... }
```

A junior reads "composition over inheritance", then introduces a base class to share two utility methods. The base is *inheritance for reuse* — exactly what the rule rejects. Make the helpers a `final class AuditLogger` injected into both handlers.

**Anaemic split.**

The junior splits a 200-line `Customer` into `Customer` (data) plus `CustomerService` (behaviour). The data class has only getters; the service has every method that used to live on `Customer`. This is anaemic domain dressed as composition. The fix: methods that operate on a customer's own data belong on `Customer`. Composition is for *external collaborators*, not for stripping behaviour off the entity.

**Hidden field assignment.**

```java
public final class OrderService {
    private OrderRepository repo;
    public void setRepo(OrderRepository r) { this.repo = r; }
}
```

A setter on a "composed" field means the dependency is rewritable. The DI guarantees from `final` field publication (see [`specification.md`](specification.md)) are gone. Constructor injection, `final` field — every time, no exceptions.

---

## 5. When to call a "flatten the hierarchy" sprint

Most composition work happens in PR-sized increments. Occasionally you commit dedicated time. The signals:

1. **`git log` on a base class shows 8+ subclasses and 30+ commits in 6 months.** The base is being reshaped to fit subclasses — fragile-base territory.
2. **A new feature requires editing three levels of a hierarchy.** That's a hierarchy serving teams, not models.
3. **The same five interfaces are mocked together in every test.** They're coupled by reality, split only on paper. Likely a hidden cohesive unit.
4. **Onboarding time is dominated by "find where this actually happens" in the inheritance tree.**

Scope the sprint. *Bad:* "Apply composition to the codebase." *Good:* "Flatten the `BaseProcessor` tree (5 subclasses). Each direct subclass either becomes a `final` class composing a `ProcessingPipeline`, or is deleted as redundant. Existing tests pass; no public API changes."

> **Lead to team:** We touch only `processor.*`. Exit criteria: zero `extends BaseProcessor` in `main`, `ProcessingPipeline` injected as a `final` field, contract tests cover the four call sites that exercised the old base.

---

## 6. Migrating a legacy hierarchy — strangler with `final` markers

You inherited a six-level `AbstractFoo` chain. The temptation: rewrite. Don't. The strangler-fig move adapts cleanly:

1. **Mark every leaf class `final`.** It stops *future* extension. The compiler now refuses any new `extends`.
2. **Pick the highest layer where actual reuse happens.** Often the base class. Identify the two or three methods every subclass needs.
3. **Lift those methods into a `final class` collaborator.** Inject it into every subclass via constructor.
4. **Replace `super.method(...)` with `collaborator.method(...)`.** Each subclass now uses composition for the shared behaviour, while still extending the base.
5. **Now every subclass has redundant inheritance** — the base provides only methods that are also reachable via the collaborator. Remove `extends`.
6. **Delete the base.** Or keep it as a marker interface if other code uses it for type checks.

```java
// Before
abstract class BaseProcessor {
    protected final AuditLogger audit = new AuditLogger();
    protected void runWithAudit(Runnable r) { audit.before(); r.run(); audit.after(); }
}
final class OrderProcessor extends BaseProcessor {
    public void process(Order o) { runWithAudit(() -> doProcess(o)); }
}

// After step 3 — composition added, inheritance still present
final class OrderProcessor extends BaseProcessor {
    private final AuditLogger audit;                    // new
    public OrderProcessor(AuditLogger audit) { this.audit = audit; }
    public void process(Order o) {
        audit.before();
        doProcess(o);
        audit.after();
    }
}

// After step 5 — inheritance removed
final class OrderProcessor {                            // no extends
    private final AuditLogger audit;
    public OrderProcessor(AuditLogger audit) { this.audit = audit; }
    public void process(Order o) {
        audit.before();
        doProcess(o);
        audit.after();
    }
}
```

Each step is reviewable, testable, and revertible. No "big bang" required.

---

## 7. Architectural-level composition

At the module/architecture level, *composition over inheritance* maps to:

- **Module composition over module inheritance.** JPMS modules `requires` each other; they don't extend each other. The composition root for an application is a module that wires together `domain`, `infrastructure`, `web`.
- **Bounded contexts integrate via translation, not inheritance.** Two contexts that share a concept (`Customer` in `sales`, `Customer` in `support`) don't share a base class — they each define their own `Customer` and translate at the boundary. Inheritance across contexts couples the two; composition keeps each context closed.
- **Decorator chains as observability.** Logging, metrics, tracing wrap *the same* abstraction (a `Repository`, a `Gateway`) at the architecture root. Treat the chain as a single *cross-cutting concern* policy decision, not as five independent class designs.

```java
@Configuration
class CompositionRoot {
    @Bean OrderRepository orderRepository(DataSource ds, Tracer tracer) {
        return new TracingRepository(
                   new TimedRepository(
                       new JdbcOrderRepository(ds), Metrics.global()), tracer);
    }
}
```

One method, one decision, all the layers visible. The hidden alternative — five different beans wiring themselves up via `@Primary` and ordering tricks — distributes the decision across files for no benefit.

---

## 8. The "composition checklist" trap — performative compliance

The dangerous failure mode is *performative compliance*: every class is `final`, every collaborator is injected, every interface has one impl, and the design is still bad.

```java
public final class OrderService {
    private final OrderRepositoryImpl repo;
    private final UserRepositoryImpl  users;
    private final EmailGatewayImpl    email;
    private final InventoryClientImpl inventory;
    private final BillingClientImpl   billing;
    private final ShippingClientImpl  shipping;
    private final AuditLoggerImpl     audit;
    // ... 12 collaborators
}
```

Twelve injected `final` fields look like composition done right. Look harder: the class has 12 reasons to change (SRP), every "interface" has one impl (DIP cargo cult — see [../01-solid-principles/](../01-solid-principles/)), and the constructor is a barrier to creating the object.

> **Senior reviewer:** Composition isn't the question. The question is what this class is *for*. Twelve collaborators means twelve responsibilities. Split before composing.

Treat composition as a *means*, not an *end*. The end is a class whose responsibilities you can name.

---

## 9. Cross-team coordination: composition in shared libraries

When you publish a class to other teams, inheritance creates *implicit dependencies* you can't see from your own commit log. Other teams subclass, override one method, and ship. Your "trivial" change to a parent method breaks their build six weeks later.

Three policies a senior should push at the org level:

- **Default `final`.** Library classes ship `final` unless explicitly designed for extension. New code is `final`; legacy non-final classes get `final` added at the next major version.
- **Document the extension contract.** Where extension is allowed, write down: which methods are hooks, what each guarantees, what subclasses must preserve. Tests verify the contract on every subclass.
- **Prefer interfaces in the public API.** A consumer that implements your `Repository` interface depends on your contract, not your implementation. Your refactor of the implementation doesn't break them.

```java
public sealed interface PaymentGateway permits StripeGateway, AdyenGateway, MockGateway {
    Receipt charge(PaymentRequest req);
}
```

A sealed interface in a shared library says: the set of implementations is closed, you cannot extend it, you can only consume it. Composition at the org boundary is now mechanical.

---

## 10. Quick rules

- [ ] In review, **name the population** (framework, type-family, reuse) before suggesting a refactor. Only reuse is automatic.
- [ ] Wire SonarQube `S110`, `S2972`, `S1610`, and ArchUnit hierarchy-depth rules into CI.
- [ ] Teach composition attached to a *felt* pain — leaked API, broken substitutability, fragile base. Never as a greenfield mantra.
- [ ] Delete every `IThing/ThingImpl` pair where the interface has one implementation and no test substitutes it.
- [ ] If a class has 8+ injected collaborators, the problem is responsibility, not composition.
- [ ] Wire decorator chains once at the composition root. Reconfiguration mid-flight breaks JIT specialization.
- [ ] At org scale, default `final` for library classes; document extension contracts where allowed.
- [ ] Strangle legacy hierarchies — add composition first, remove inheritance second, delete base last.
- [ ] Performative `final` + `@Inject` everywhere is not composition; it is paperwork.
- [ ] When the rule fights cohesion (a domain class becoming anaemic), cohesion wins — pull behaviour back to the data.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| The slogan in plain English with one example                | `junior.md`        |
| Worked refactors from inheritance to composition            | `middle.md`        |
| Edge cases, framework inheritance, mixins                   | `senior.md`        |
| Where final/sealed/interface rules live in JLS              | `specification.md` |
| Spotting silent inheritance abuse                           | `find-bug.md`      |
| JIT, dispatch, allocation costs                             | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** *favour composition over inheritance* is a code-review vocabulary, not a checklist. Your job as a senior is to make review *short* by naming which of the three `extends` populations you see, to push enforcement into Sonar/ArchUnit where mechanical, to mentor by attaching the rule to felt pain, and to migrate legacy by strangler — composition first, inheritance removed second, base deleted last. The letters are prompts; the judgement is yours.
