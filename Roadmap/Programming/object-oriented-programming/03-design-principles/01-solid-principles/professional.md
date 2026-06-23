# SOLID Principles — Professional

> **What?** Driving SOLID across a team and a codebase: the vocabulary you use in code review, the tooling that catches violations before review, mentoring without dogma, knowing when to call a refactoring sprint, and migrating legacy modules without rewriting the world.
> **How?** Treat SOLID as a shared *language*, not a *checklist*. Wire enforcement into CI where you can. In review, name the letter, name the symptom, propose the smallest move that fixes it.

---

## 1. Code-review vocabulary: name the letter

When you review a PR, your job is not to rewrite the code in the comments. It is to point at a specific smell using a word the author already knows. SOLID gives you five such words. Use them precisely.

```java
// PR diff under review:
public class ShipmentService {
    public void ship(Order o) {
        validate(o);
        save(o);
        sendEmail(o);
        writeAuditLog(o);
        renderLabelPdf(o);
    }
}
```

> **Reviewer:** This is an SRP problem. `ShipmentService` is doing five jobs that change for five different reasons — validation rules, persistence, customer comms, audit, label layout. The audit team and the comms team will collide here within a month. Suggest extracting at least `ShipmentNotifier` and `ShipmentAuditor`.

Contrast with:

> **Reviewer:** This is an OCP problem. The `switch (carrierCode)` here means every new carrier touches this class. A `Carrier` interface with one `ship(Shipment)` method per carrier implementation closes this class to modification.

Both reviews are short, both name the letter, both end with a single concrete next step. That is the shape of useful SOLID review feedback. "This violates SOLID" without a letter is noise; "violates SRP" without a proposed split is finger-pointing.

---

## 2. Static analysis: what tooling can catch per letter

Not every letter is detectable by a tool, but several are. Wire what you can into CI so reviewers can spend their attention on the parts machines can't see.

**SonarQube** ships rules that map loosely to SOLID:

- `java:S138` (method length) and `java:S1448` (too many methods) — proxies for SRP.
- `java:S1200` (class coupled to too many others) — DIP/SRP proxy.
- `java:S1610` (abstract class with no abstract methods) — often an OCP smell.
- `java:S1185` (useless overriding methods) — LSP misuse signal.

**SpotBugs** catches LSP-adjacent bugs:

- `BC_UNCONFIRMED_CAST` and `BC_IMPOSSIBLE_CAST` — subtypes used where they shouldn't be substitutable.
- `EQ_DOESNT_OVERRIDE_EQUALS` on subclasses — covariant `equals` breaking substitutability.

**ArchUnit** is the most direct: you can encode SOLID-ish architectural rules as tests.

```java
@ArchTest
static final ArchRule services_depend_on_abstractions =
    classes().that().resideInAPackage("..service..")
             .should().onlyDependOnClassesThat()
             .resideInAnyPackage("..service..", "..domain..", "..port..", "java..");
// DIP: services don't reach into ..persistence.. or ..web.. directly.

@ArchTest
static final ArchRule no_fat_interfaces =
    classes().that().areInterfaces().and().resideInAPackage("..port..")
             .should(haveAtMostNMethods(5));
// ISP: ports stay small.
```

ArchUnit catches the architectural shape of DIP and ISP; SonarQube catches the symptom-level shape of SRP and OCP. SpotBugs catches semantic LSP traps. None of them catches *all* of SOLID — they catch enough to free reviewers for the hard cases.

---

## 3. Mentoring SOLID without dogma

A junior who has just discovered SOLID is dangerous. They will rename every interface to `IThing`, inject `IClock` everywhere, segregate a five-method repository into five interfaces, and present the result as "now it's SOLID". You will spend more time undoing this than you would have spent on the original mess.

The mentoring move is to anchor each letter to a *concrete pain* the junior has already felt.

> **Mentor:** You remember when the tax-rule change broke the PDF rendering test last sprint? That's why we separate the calculator from the renderer. The letter is S, but the lesson is "tax people shouldn't break the print team".

> **Junior:** Should I also extract a `Validator` and a `Logger` and a …?
> **Mentor:** Only when you can name the second stakeholder. If only one team edits a class, splitting it adds files without reducing pain.

The rule of thumb: teach SOLID *retrospectively*, attached to a specific bug or a specific painful diff. Teach it *prospectively* only in design reviews where the change axis is already named. Never teach it as a five-letter mantra to apply to greenfield code — that is how you produce abstraction-soaked codebases that nobody can navigate.

---

## 4. Anti-patterns juniors will introduce

These appear in nearly every codebase where SOLID was taught before it was felt. Recognise them early.

**The `I`-prefixed everything.**

```java
public interface IUserService { ... }
public class UserService implements IUserService { ... }
// Only one implementation exists. Ever.
```

The interface adds no abstraction — there is one impl, the IDE jumps through the interface to reach it, and tests that "depend on the abstraction" actually mock the only impl. The fix is to delete the interface until a *second* implementation (test double, alternate adapter) is actually needed. DIP is about boundaries, not about reflexive interfacing.

**Over-mocking.**

```java
@Mock OrderRepository repo;
@Mock Clock clock;
@Mock Logger logger;
@Mock MetricsRegistry metrics;
@Mock FeatureFlags flags;
@Mock EventPublisher events;
// Six mocks for a 30-line service method.
```

If you need six mocks to test one method, the class under test has six collaborators, and *that* is the smell — usually SRP. Don't congratulate yourself for "respecting DIP by mocking everything". Ask why the service has so many neighbours.

**Premature DI.**

```java
public class TaxCalculator {
    private final RoundingStrategy rounding;
    private final RateLookup lookup;
    private final HolidayCalendar holidays;
    private final CurrencyConverter converter;
    private final AuditSink audit;
    // ...12 ctor params
}
```

Every collaborator is "swappable for testing", but in production there is one impl of each. The constructor is now a barrier to using the class at all. DIP is for boundaries you cross; not every helper is a boundary.

**ISP taken to extremes.**

```java
interface UserReader  { Optional<User> find(long id); }
interface UserWriter  { void save(User u); }
interface UserDeleter { void delete(long id); }
interface UserCounter { long count(); }
```

If all four are always implemented together and always called together, you have invented bureaucracy. ISP segregates *by caller role*, not by method.

---

## 5. When to call a SOLID refactoring sprint

Most SOLID work happens in PR-sized increments. Occasionally, you call a dedicated sprint. The signals:

1. **The same module produces 40 percent of incidents.** A class or package that keeps breaking is telling you it has more reasons to change than it can absorb.
2. **Feature lead time is dominated by "afraid to touch X".** When estimates triple because of a single module, that's a SOLID debt indicator.
3. **New hires consistently flag the same area as confusing.** Their first impression captures coupling and cohesion you've gone numb to.
4. **A planned feature *cannot* be added without editing N existing files.** This is a textbook OCP failure waiting to bite.

When you call the sprint, scope it. "We will refactor the `OrderService` cluster: extract validation, extract notification, introduce an `OrderRepository` port" is a sprint. "Apply SOLID to the codebase" is not a sprint, it is a sabbatical.

> **Lead to team:** This sprint, we touch only `order.*`. The exit criteria are: `OrderService` is under 200 lines, persistence is behind a port, and the existing test suite plus the new contract test for the port both pass. We do not touch `shipment.*` even if it tempts us.

---

## 6. Architectural-level SOLID

SOLID started as a class-level vocabulary, but each letter has a package or module analogue. At the architecture level it overlaps heavily with hexagonal/clean-architecture rules.

- **SRP at the package level:** one package, one reason to change. `com.example.billing.tax` changes when tax law changes; `com.example.billing.invoice` changes when invoicing layout changes.
- **OCP at the module level:** the domain module is closed for modification; new adapters (REST, GraphQL, CLI) are added without editing the domain.
- **LSP at the contract level:** every implementation of a port (`OrderRepository`) honours the same behavioural contract, verified by a *shared* contract test that all impls must pass.
- **ISP at the port level:** each port is shaped for one driving actor, not "all things the database can do".
- **DIP at the layered level:** dependencies point *inward* toward the domain. The domain depends on no infrastructure; infrastructure depends on the domain's ports.

ArchUnit lets you encode all five.

```java
@ArchTest
static final ArchRule domain_does_not_depend_on_infrastructure =
    noClasses().that().resideInAPackage("..domain..")
               .should().dependOnClassesThat()
               .resideInAnyPackage("..infrastructure..", "..web..", "..persistence..");
```

This single rule blocks a class of DIP violations no matter how many juniors arrive. The tooling now does what a wandering mentor used to do.

---

## 7. The "SOLID checklist" trap — performative compliance

The most dangerous failure mode in a SOLID-aware team is *performative compliance*: code that looks SOLID, passes the checklist, and is still terrible.

```java
public interface IOrderService {
    void place(Order o);
}
public final class OrderService implements IOrderService {
    public void place(Order o) {
        validate(o);
        persist(o);
        publish(o);
        notify(o);
        audit(o);
        invoice(o);
        renderShipmentLabel(o);
    }
}
```

There is an interface (DIP, check). The interface has one method (ISP, check). The class is final (LSP, check, vacuously). It compiles, it passes review by anyone counting letters, and it still violates SRP by every meaningful measure.

> **Senior reviewer:** I don't care that there's an interface. I care that `place` does seven things, and the on-call engineer paged at 3am has to read all of them to find the failure. The letter we're missing is S. Add an interface only when it isolates a boundary; split the class because the work itself is split.

Treat the letters as *prompts to look*, not *boxes to tick*. When a PR shows perfect surface SOLID, look harder, not less.

---

## 8. Migrating a legacy module — strangler fig

You inherit a 3000-line `BillingManager` that nobody fully understands. The temptation is a rewrite. Don't. Use the *strangler fig* pattern: grow a SOLID structure around the legacy class and slowly redirect callers to the new structure until the old class has no remaining callers and can be deleted.

The phased move:

1. **Carve a port.** Pick one responsibility — say, computing tax. Define a small interface `TaxCalculator` in the domain. Implement it as `LegacyTaxCalculator` that delegates straight into `BillingManager.computeTax(...)`. No behaviour change, but a seam exists.

```java
public interface TaxCalculator {
    BigDecimal taxFor(Invoice invoice);
}

public class LegacyTaxCalculator implements TaxCalculator {
    private final BillingManager legacy;
    public LegacyTaxCalculator(BillingManager legacy) { this.legacy = legacy; }
    public BigDecimal taxFor(Invoice invoice) {
        return legacy.computeTax(invoice);   // exact existing behaviour
    }
}
```

2. **Migrate callers to the port.** All code that used to call `billingManager.computeTax(...)` now takes a `TaxCalculator` in its constructor. Callers no longer mention `BillingManager`.

3. **Write a contract test** that any `TaxCalculator` must satisfy. Run it against `LegacyTaxCalculator`. Green? Good — you have captured the contract.

4. **Implement `ModernTaxCalculator`** from scratch, against the same contract test. When it passes, flip the wiring in one place (the composition root). The legacy method is now dead code on this path.

5. **Repeat per responsibility** — pricing, discounting, invoicing, audit. Each pass extracts one port, migrates callers, and adds one modern adapter.

6. **Delete the legacy class** when its body shrinks to nothing.

> **Senior to team:** No big-bang rewrite. We carve one responsibility per sprint, behind a port. Each port has a contract test. We measure success by the line count of `BillingManager` going down, not by any aesthetic.

The strangler fig is SOLID applied as *motion through time*. SRP gives you the cuts; DIP gives you the seams; LSP gives you the contract tests; OCP keeps the new adapters from polluting the old class; ISP keeps each new port small.

---

## 9. Quick rules

- [ ] In review, **name the letter** and propose **one** concrete change. "Violates SOLID" without specifics is noise.
- [ ] Wire ArchUnit rules for layer dependencies (DIP) and port size (ISP). Wire Sonar/SpotBugs for SRP/LSP proxies.
- [ ] Teach SOLID *attached to a real bug the team felt*. Never as a mantra over greenfield code.
- [ ] Delete `IThing` until a second implementation exists. One impl + one interface is not DIP, it is paperwork.
- [ ] If a test needs six mocks, the smell is SRP on the SUT, not "good DIP".
- [ ] Call a refactoring sprint only with a scoped exit criterion. "Apply SOLID" is not scope.
- [ ] At architecture level, encode SOLID as ArchUnit rules — tooling outlasts mentors.
- [ ] Beware performative SOLID: interfaces and ports can hide a 500-line god method.
- [ ] Migrate legacy by strangler fig: one responsibility per sprint, behind a port, with a contract test.
- [ ] When two letters disagree (e.g., SRP wants split, DIP wants seam in *this* class), pick the one that names the *current pain*.

---

## 10. What's next

| Topic                                            | File              |
| ------------------------------------------------ | ----------------- |
| The letters in plain English with one example    | `junior.md`        |
| Worked refactors per letter, before/after        | `middle.md`        |
| Edge cases, anti-patterns, "SOLIDified to death" | `senior.md`        |
| Where SOLID-relevant rules live in JLS/JVMS      | `specification.md` |
| Spotting silent SOLID violations at runtime      | `find-bug.md`      |
| JIT, dispatch, allocation costs of SOLID idioms  | `optimize.md`      |
| Hands-on exercises                               | `tasks.md`         |
| Interview Q&A                                    | `interview.md`     |

---

**Memorize this:** SOLID is a shared vocabulary, not a checklist. Your job as a senior is to make code review *short* by naming letters precisely, to push enforcement into ArchUnit/Sonar/SpotBugs where letters are mechanically detectable, to mentor by anchoring each letter to a felt pain, to reject performative compliance, and to migrate legacy by strangler fig — one responsibility per sprint, behind one port, against one contract test. The letters are prompts; the judgement is yours.
