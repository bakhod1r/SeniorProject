# God Class — Senior

> **What?** The senior view of God Classes: which *metrics* nail them down (WMC, RFC, CBO, LCOM4, ATFD, TCC, NOM), which *tools* run those metrics in CI (PMD's `GodClass` rule, SonarQube, JDepend, NDepend, IntelliJ's *Metrics Reloaded*), and how to *disassemble* a real legacy God Class (5,000-line `OrderService`) over a sequence of safe steps without freezing feature delivery.
> **How?** By treating the God Class as a *measurable* defect — instrument the codebase, set thresholds, fail the build on regressions, then drive the metrics down PR by PR with characterisation tests and the standard refactoring catalog (Fowler 1999 + Feathers 2004).

---

## 1. The metrics that name the smell

Subjective judgement ("this feels too big") is fine for code review, but it does not survive an argument with a senior engineer or a product manager. Numbers do. The following metrics are well-defined, computable from source, and the basis for every God Class rule in PMD, SonarQube, and similar tools.

### 1.1 Lines of Code (LOC / NCLOC)

The crudest, most useful metric. Count non-comment, non-blank lines in the class. Above ~250 NCLOC the class deserves a look; above ~500 it deserves a fix.

```bash
cloc --by-file src/main/java/com/acme/OrderService.java
# OrderService.java   4,612 NCLOC
```

LOC alone does not prove a God Class — a `BigDecimalMath` library can legitimately be 800 lines — but combined with the metrics below, LOC is a reliable first filter.

### 1.2 Weighted Methods per Class (WMC)

Chidamber and Kemerer, 1994 (*Towards a Metrics Suite for Object Oriented Design*). The sum of cyclomatic complexities of all methods in a class. A class with 30 simple methods (WMC ~30) is different from 30 methods full of branches (WMC ~120).

**Threshold:** PMD's `GodClass` rule treats WMC > 47 as suspect. SonarQube's `S1448` checks "too many methods" with a default of 35.

### 1.3 Response For a Class (RFC)

Number of methods that can be invoked in response to a message on the class — including its own methods and the methods it calls. High RFC means the class is a *coordinator hub*: many things happen when you touch it.

**Threshold:** RFC > 50 is suspicious; RFC > 100 is a strong God Class signal.

### 1.4 Coupling Between Objects (CBO)

Number of *other* classes coupled to this one (either it uses them or they use it). High CBO means changing this class affects many others — Shotgun Surgery risk (`../06-shotgun-surgery/`).

**Threshold:** CBO > 14 in PMD's default `GodClass`; SonarQube `S1200` defaults to 20.

### 1.5 Lack of Cohesion of Methods, version 4 (LCOM4)

The classical cohesion metric. LCOM4 counts the number of *connected components* in a graph where:
- nodes = methods + fields,
- edges = "method m uses field f" or "method m calls method n in the same class".

A perfectly cohesive class has LCOM4 = 1 (one connected component). A God Class with five unrelated responsibilities typically has LCOM4 ≥ 3.

```
LCOM4 = 1  → cohesive, one responsibility
LCOM4 = 2  → suspicious, possibly two hidden classes
LCOM4 ≥ 3  → almost certainly a God Class
```

Henderson-Sellers (1996) defined LCOM*; LCOM4 is the most commonly tooled variant. PMD and SonarQube both expose it.

### 1.6 Access To Foreign Data (ATFD)

Marinescu (2002), in *Measurement and Quality in Object-Oriented Design*. Counts how many times the class accesses data on *other* classes' fields (via getters or directly). High ATFD signals Feature Envy embedded in a God Class.

**Threshold:** ATFD > 5 contributes to PMD's `GodClass` detector.

### 1.7 Tight Class Cohesion (TCC) and Loose Class Cohesion (LCC)

Bieman & Kang (1995). Ratio-based cohesion metrics from 0 (no cohesion) to 1 (perfect cohesion). TCC counts only directly-connected method pairs; LCC also counts indirectly connected ones. PMD uses both.

**Threshold:** TCC < 0.33 strongly suggests low cohesion (= God Class).

### 1.8 The PMD `GodClass` formula

PMD's `GodClass` rule fires when **all three** hold simultaneously:

- `WMC ≥ 47`,
- `ATFD > 5`,
- `TCC < 0.33`.

That conjunction matches Marinescu's *Detection Strategies* paper (2004). It is the closest thing the industry has to a canonical definition.

---

## 2. Running the detection in CI

You do not want God Classes argued in code review — you want them *failed in CI*. Every mainstream Java tool can do this. Pick one and wire it.

### 2.1 PMD

```xml
<!-- pom.xml -->
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-pmd-plugin</artifactId>
    <version>3.21.2</version>
    <configuration>
        <rulesets>
            <ruleset>/category/java/design.xml/GodClass</ruleset>
            <ruleset>/category/java/design.xml/TooManyMethods</ruleset>
            <ruleset>/category/java/design.xml/TooManyFields</ruleset>
            <ruleset>/category/java/design.xml/ExcessiveClassLength</ruleset>
            <ruleset>/category/java/design.xml/ExcessivePublicCount</ruleset>
        </rulesets>
        <failOnViolation>true</failOnViolation>
        <printFailingErrors>true</printFailingErrors>
    </configuration>
</plugin>
```

`mvn pmd:check` runs in CI. New God Classes fail the build; existing ones go on a suppression list and shrink quarter by quarter.

### 2.2 SonarQube

SonarQube's `Sonar Way` profile includes:

- `java:S1448` — Too many methods per class (default 35).
- `java:S1200` — Class coupled to too many classes (default 20).
- `java:S138` — Methods too long (default 100 lines).
- `java:S1820` — Class too many non-static fields (default 7).
- `java:S2972` — Inner classes too complex.

SonarQube also reports LCOM4-style cohesion under its *Complexity* and *Design* dimensions. Fail the *quality gate* on new code, accept tech debt on existing code, and trend it down.

### 2.3 JDepend (and javac --source-graph in modern toolchains)

JDepend computes package-level metrics (afferent and efferent coupling, instability) — useful for *Extract Module* decisions. If `OrderService.java` is the only file in a package and has 4,000 LOC, JDepend will not save you. But when you split it across a `shop.order.*` package, JDepend tells you whether your new packages are internally cohesive and loosely coupled with the rest.

### 2.4 IntelliJ's *Metrics Reloaded* plugin

For interactive exploration. Right-click the class, *Calculate Metrics*; the WMC, RFC, CBO, LCOM4 numbers appear in a panel. Use this during a refactoring session to see metrics fall as you extract.

### 2.5 ArchUnit (covered in `professional.md`)

For *structural* enforcement: no class in `domain.*` may exceed 300 LOC, no class may have more than 7 fields, etc. ArchUnit lets you encode team norms as JUnit tests.

---

## 3. The Marinescu/Lanza *Detection Strategy*

Radu Marinescu and Michele Lanza (*Object-Oriented Metrics in Practice*, 2006) formalised God Class detection as a *strategy* — a logical combination of metric thresholds:

```
GodClass(c) ⇔
    ATFD(c) > FEW
  ∧ WMC(c)  ≥ HIGH
  ∧ TCC(c)  < ONE_THIRD
```

Where `FEW = 5`, `HIGH = 47`, `ONE_THIRD = 0.33` for Java (tuned on industrial codebases).

Their insight: no single metric is sufficient. WMC alone catches large but cohesive math libraries (false positives). ATFD alone catches feature-envy but not god size. The conjunction targets the specific shape: *big + envious + uncohesive*.

PMD's `GodClass` rule is a direct implementation of this strategy.

---

## 4. A real legacy disassembly — `OrderService` (illustrative)

Suppose `com.acme.shop.OrderService` is 5,200 LOC, 38 fields, 64 public methods, 12 collaborators in the constructor. Six teams touch it. It is the worst file in the codebase.

You cannot rewrite it. You will refactor it over six months. Here is the sequence.

### Sprint 1 — Instrument and snapshot

- Add PMD with `GodClass`, `TooManyMethods`, `TooManyFields` to CI as **warnings** (do not fail the build yet).
- Snapshot the current metrics:

```
class                    NCLOC  WMC  RFC  CBO  LCOM4  fields  methods
shop.OrderService         5212  186  142   23      7      38       64
```

- Add a *baseline file* listing the current violations so new violations elsewhere fail the build but `OrderService` does not.
- Add characterisation tests (Feathers 2004, ch. 13) — at least one per public method.

### Sprint 2 — Sprout Method

The *Sprout Method* technique (Feathers 2004) is the safe entry: when adding new behaviour, **do not** modify the God Class — write a new method that takes the data it needs.

```java
// In OrderService — DO NOT TOUCH the old code, sprout a new method:
public RefundResult sproutPartialRefund(Order o, BigDecimal amount, String reason) {
    // new logic, no shared state with existing methods
    return new PartialRefundCalculator(taxRules).compute(o, amount, reason);
}
```

The new method has tests and no coupling to the rest of the God Class. You have stopped the bleeding.

### Sprint 3 — Extract Class: `CouponService`

Identify a cohesive cluster: 4 methods + 2 fields all about coupons.

```java
public final class CouponService {
    private final CouponRegistry registry;
    public BigDecimal apply(Order o, List<String> codes) { ... }
    public boolean isValid(String code) { ... }
    // ...
}
```

`OrderService` now holds a `CouponService`, loses 230 LOC and 2 fields.

**Metrics after sprint 3:**

```
shop.OrderService        4982  170  131   22      6      36       60
shop.CouponService        267   14   18    3      1       2        4
```

LCOM4 dropped from 7 to 6 on `OrderService`. Real progress.

### Sprint 4 — Move Method: tax calculation onto `Order`

The 220-line `calculateTax(Order o, Customer c, Country country)` method had 11 helpers, all in `OrderService`. After analysis, most of them only touch `Order` fields. Move them onto `Order` itself, or extract a `TaxCalculator` that takes an `Order`.

```java
public final class TaxCalculator {
    public Money compute(Order o, TaxRegime regime) { ... }
}
```

`OrderService` loses 270 LOC.

### Sprint 5 — Sealed type for `OrderType`

The 300-line `dispatch(Order o)` method switches on `OrderType`. Replace with `sealed interface OrderProcessor` and four implementations.

```java
public sealed interface OrderProcessor permits
        StandardProcessor, SubscriptionProcessor, PreOrderProcessor, DigitalProcessor {
    void process(Order o);
}
```

`OrderService` loses another 280 LOC.

### Sprint 6 — Final shape

```
class                    NCLOC  WMC  RFC  CBO  LCOM4  fields  methods
shop.OrderCoordinator     412   28   34    8      2       6       11
shop.CouponService        267   14   18    3      1       2        4
shop.TaxCalculator        198   11   12    2      1       1        2
shop.processor.*          ~250 each
```

The God Class is gone. The coordinator class is under 500 LOC. Each extracted class is cohesive, testable, and owned by a single team.

**Wall-clock cost:** six sprints of part-time refactoring. Feature delivery never paused.

---

## 5. The `Sprout Class` variant

Sometimes you can't even extract a method safely — the God Class's state is too tangled. *Sprout Class* (Feathers 2004) is the heavier sibling of *Sprout Method*: for the new feature, write an entire new class that holds whatever state it needs, and call into it from the God Class.

```java
// Instead of growing OrderService with the new "split shipment" feature,
// build it as a standalone class and call from one place.
public final class SplitShipmentPlanner {
    public List<Shipment> plan(Order o, WarehouseSnapshot snap) { ... }
}

// In OrderService:
public List<Shipment> splitShipment(Long orderId) {
    Order o = loadOrder(orderId);
    return new SplitShipmentPlanner().plan(o, warehouse.snapshot());
}
```

The new class is well-designed from day one and never enters the God Class. Over many sprints, more and more behaviour lives outside `OrderService` until extracting the rest is mechanical.

---

## 6. Characterisation tests as the safety net

You cannot refactor what you cannot test. Before any extraction, write characterisation tests for the method you are about to move.

```java
@Nested
class CharacterisationTests {

    @Test void cancellation_2024_07_15_case_4471_matches_golden_sample() {
        // setup mirrors a real production case
        Order o = givenOrderFromSnapshot("2024-07-15/case-4471.json");
        OrderService svc = newServiceWithMocks();
        svc.cancelOrder(o.id(), "customer_request");
        assertEquals(EXPECTED_REFUND, capturedStripeCall().amount());
        assertEquals(EXPECTED_EMAIL,  capturedSmtpCall().body());
    }
}
```

These tests pin the *current* behaviour, however weird. Refactoring must keep them green. If a customer-facing bug is encoded in the current behaviour, the characterisation test will keep encoding it — which is exactly what you want during a refactor. You will fix the bug *after* the refactor, in a separate PR with a clear "behaviour change" tag.

---

## 7. The "fear of refactoring" problem

The biggest blocker is not technical; it is psychological. A 5,000-line `OrderService` is *load-bearing*. Senior engineers know it works (mostly), and they fear that "small refactor" PR that will silently break the 11 PM cron job.

Counter-strategies:

- **Behavioural change vs. refactor PRs.** Tag every PR. A refactor PR must *not* change behaviour; reviewer checks the characterisation tests didn't change.
- **Feature flags.** Wrap the new code path in a flag (`if (FF.usesNewTaxCalculator()) ...`). Roll out gradually; roll back instantly if metrics regress.
- **Shadow mode.** Run old and new code in parallel for a week; log differences to a queryable store; ship only when the diff is empty.
- **Pair refactoring.** Two engineers, one keyboard, four eyes. Reduces both error rate and fear.
- **Public progress.** Post the metrics chart in the team channel every sprint. Watching LCOM4 fall from 7 to 2 over two quarters is morale.

---

## 8. Anti-patterns of God Class "cleanup"

Senior engineers have seen these failures. Avoid them.

- **The Façade Façade.** Adding `OrderFacade` *in front of* `OrderService` without shrinking `OrderService`. You added another file; the God Class is still there.
- **The Static Decomposition.** Splitting `OrderService` into 10 stateless utility classes (`OrderStatics`, `OrderValidationStatics`, …) that all take the same 6-argument signature. Now you have 10 God Helper Classes.
- **The Manager Manager.** `OrderService` becomes `OrderServiceManager` which delegates to `OrderServiceCoordinator` which delegates to `OrderServiceImpl`. Three files, same blob.
- **The Rewrite.** A team-wide quarter of "Order 2.0". Production bugs migrate untouched. Feature delivery stalls. Six months later, "Order 2.0" is also a God Class.
- **The Microservice Escape.** Splitting `OrderService` into 14 microservices. You now have 14 deployable God Services with network latency between them and a distributed transaction problem. Microservices do not cure God Classes — they magnify them across the network.

---

## 9. When a "big" class is not a God Class

Not every large class is a problem. Three legitimate large-class shapes:

- **Pure value class with many derived accessors.** A `MoneyExpression` ADT might have 40 small methods, all about manipulating a single value. WMC is moderate; LCOM4 = 1; CBO is low. Not a God Class.
- **State machine with many states.** A `WorkflowEngine` modelled as one class with explicit transitions can legitimately have many methods. If LCOM4 = 1 and CBO is bounded, leave it alone or convert to *State Pattern* only if it grows further.
- **Generated code.** ANTLR parsers, protobuf classes, JOOQ records — these are mechanically generated, often huge, and immune to manual refactoring. Exclude them from metrics tooling (`pmd-exclude.properties`).

The conjunctive metric strategy (Marinescu) handles all three: LOC alone flags them, but TCC + ATFD + WMC together do not.

---

## 10. Quick rules

- [ ] Adopt PMD's `GodClass` rule (WMC ≥ 47 ∧ ATFD > 5 ∧ TCC < 0.33).
- [ ] Track WMC, RFC, CBO, LCOM4 in SonarQube; trend them on a dashboard.
- [ ] Fail builds on *new* violations; baseline existing ones.
- [ ] Write characterisation tests before any extraction.
- [ ] Sprout Method / Sprout Class for new features in a God Class — never grow the god.
- [ ] Extract Class by *cohesive field cluster*, one per PR.
- [ ] Separate refactor PRs from feature PRs; tag them.
- [ ] Tag generated code in PMD/SonarQube excludes.
- [ ] Reject "Façade Façade" and "Manager Manager" attempts.
- [ ] Do not split a God Class into a Microservice. Refactor first.

---

## 11. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Architecture-level prevention, ArchUnit rules, Conway's Law        | `professional.md`  |
| Formal thresholds, sample Checkstyle/PMD/SonarQube configs         | `specification.md` |
| 10 buggy snippets to diagnose                                      | `find-bug.md`      |
| JIT inlining, code cache, megamorphic costs                        | `optimize.md`      |
| Hands-on exercises                                                 | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |
| Anemic Domain Model — the opposite extreme                         | `../02-anemic-domain-model/` |
| Feature Envy — the daily symptom                                   | `../03-feature-envy/` |
| Shotgun Surgery — the change-propagation smell                     | `../06-shotgun-surgery/` |
| SOLID — SRP is the principle being violated                        | `../../03-design-principles/01-solid-principles/` |
| Refactoring catalog — Fowler's moves                               | `../../../../../refactoring/` (if present) |

---

**Memorize this:** God Class is a *measurable* defect — instrument WMC, RFC, CBO, LCOM4 with PMD or SonarQube; the canonical detection strategy is *WMC ≥ 47 ∧ ATFD > 5 ∧ TCC < 0.33*. Disassemble with Sprout Method / Sprout Class / Extract Class along cohesive field clusters, behind characterisation tests, one PR per cluster. Refactor; never rewrite.
