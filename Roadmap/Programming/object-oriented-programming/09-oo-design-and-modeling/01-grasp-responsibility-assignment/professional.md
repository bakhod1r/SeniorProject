# GRASP — Professional

> **What?** The team lens: how to *use GRASP vocabulary in code review*, how to spot misassigned responsibilities mechanically, which tools surface the symptoms (coupling/cohesion metrics, ArchUnit, PMD, dependency analysers), and a concrete refactoring playbook for the common misassignments. GRASP's real value on a team is as *shared language* — it lets a reviewer say "this is an Information Expert violation" instead of "I dunno, this feels off."
> **How?** This file gives you review phrases that map to each pattern, the tool that detects each symptom, and a step-by-step fix for each of the four recurring misassignments. It ends with where GRASP rigour matters and where it's overkill.

---

## 1. GRASP as review vocabulary

The biggest professional win from GRASP is *precision in review comments*. Vague review feedback ("this class does too much") triggers defensiveness; named feedback ("this violates High Cohesion — the persistence responsibility belongs in a repository, Pure Fabrication") is actionable and impersonal.

| You see in the PR | Say this | Suggested fix |
| --- | --- | --- |
| A service reaching into another object's getters to compute something | "Information Expert violation — move this onto the data-holder" | push the method to the class that owns the data |
| `new Foo(...)` scattered across many classes | "Creator: concentrate construction in the aggregator/factory" | move creation to the container or a factory |
| A controller with calculations or SQL | "Controller should delegate, not compute" | extract logic to domain object / repository |
| `switch`/`instanceof` on a type code | "Polymorphism — replace the type test with dispatch" | sealed interface + per-type methods |
| Domain entity importing `java.sql` / a vendor SDK | "Low Coupling — fabricate a repository/gateway" | extract a Pure Fabrication behind an interface |
| A class named `...AndManager`, `Misc`, `Utils` | "Low Cohesion — split by responsibility" | one purpose per class |
| Domain code naming a concrete external service | "Indirection / Protected Variations — introduce an interface" | depend on an abstraction, inject the concrete |

Adopt these phrases as a team and reviews get faster and less personal.

---

## 2. The four misassignments and their mechanical tells

Most GRASP problems in real PRs are one of four, each with a *grep-able* or *metric-able* signature:

**1. Feature Envy → Information Expert violation.** A method uses another object's data more than its own.

```java
// Tell: a method calls other.getX() three+ times and this.field zero times.
class InvoicePrinter {
    String format(Invoice inv) {
        return inv.getCustomer().getName() + " owes " +
               inv.getTotal() + " due " + inv.getDueDate();   // all inv.*, nothing local
    }
}
```
*Detection:* PMD `LawOfDemeter`, IntelliJ "Feature Envy" inspection. *Fix:* move `format()` onto `Invoice` (or add `Invoice.summary()`).

**2. God class → High Cohesion violation.** *Detection:* high WMC (weighted methods per class), high LCOM4 (lack of cohesion). *Tools:* JArchitect, SonarQube `S1200` (too many dependencies), Metrics Reloaded plugin. *Fix:* split by responsibility cluster.

**3. Domain coupled to infrastructure → Low Coupling violation.** *Detection:* an `import` of `java.sql`, `javax.persistence`, or a vendor SDK *inside a domain package*. *Tool:* **ArchUnit** (see §3). *Fix:* Pure Fabrication + Indirection.

**4. Type-switch → Polymorphism violation.** *Detection:* `instanceof` chains, `switch` on an enum *type discriminator*. *Tools:* PMD, SonarQube `S6201`/`S1301`. *Fix:* polymorphic dispatch.

---

## 3. ArchUnit — encoding GRASP boundaries as tests

The most durable way to enforce Low Coupling and Pure Fabrication on a team is an executable architecture test. ArchUnit turns "the domain must not know about the database" into a failing build:

```java
@AnalyzeClasses(packages = "com.acme.orders")
class GraspArchitectureTest {

    // Low Coupling / Pure Fabrication: the domain must not import infrastructure.
    @ArchTest
    static final ArchRule domain_is_free_of_persistence =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage("java.sql..", "javax.persistence..", "..infrastructure..");

    // Controller pattern: controllers may only delegate to application/domain, not to JDBC.
    @ArchTest
    static final ArchRule controllers_do_not_touch_the_database =
        noClasses().that().haveSimpleNameEndingWith("Controller")
            .should().dependOnClassesThat().resideInAPackage("java.sql..");

    // Indirection: domain depends on repository *interfaces*, never on Jdbc* implementations.
    @ArchTest
    static final ArchRule domain_uses_repository_abstractions =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().haveSimpleNameStartingWith("Jdbc");
}
```

These three rules make the most important GRASP decisions *unbreakable* — a PR that drags JDBC into the domain fails CI, no human reviewer required. This is GRASP graduating from advice to *enforced invariant*.

---

## 4. Cohesion and coupling metrics that proxy the evaluators

The two evaluators have numeric proxies your tooling can compute (deep-dived in [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/)):

| Evaluator | Metric | Tool | Threshold heuristic |
| --- | --- | --- | --- |
| High Cohesion | **LCOM4** (lack of cohesion) | Metrics Reloaded, SonarQube | LCOM4 > 1 → class has disjoint method groups → split candidate |
| Low Coupling | **CBO** (coupling between objects) | JArchitect, ckjm | CBO > ~14 → too many collaborators |
| Low Coupling | **RFC** (response for class) | ckjm | rising RFC → growing surface |
| High Cohesion | **WMC** (weighted methods) | most metric tools | high WMC + high LCOM → god class |
| Low Coupling | **fan-in / fan-out** | dependency analysers | high fan-out → depends on too much |

Use these as *triggers for a human look*, not gates. A high-CBO orchestrator may be legitimately central; a high-LCOM utility class may be fine if it's truly stateless helpers. Metrics find candidates; judgement decides.

---

## 5. Refactoring playbook — the four fixes step by step

**Fix A — restore Information Expert (Move Method).**
1. Identify the method that envies another object's data.
2. Move it to the data-owning class (IntelliJ: *Move Members* / *Move Instance Method*).
3. Replace the now-redundant getters the method used with direct field access on the new home.
4. Delete getters that no longer have callers (improves encapsulation as a bonus).

**Fix B — extract a Pure Fabrication (Extract Class + Extract Interface).**
1. Identify the non-domain responsibility on the entity (persistence, mapping, integration).
2. *Extract Class* into `XxxRepository` / `XxxMapper`.
3. *Extract Interface* so the domain depends on the abstraction (Indirection).
4. Inject the concrete via constructor at the composition root.
5. Add an ArchUnit rule so it can't regress.

**Fix C — replace type-switch with Polymorphism (Replace Conditional with Polymorphism).**
1. Make the type discriminated a `sealed interface`.
2. Move each `case`/`if` branch into the corresponding implementation as an overridden method.
3. Replace the `switch` call site with a single virtual call.
4. The compiler's exhaustiveness check now guards against missed cases.

**Fix D — thin a bloated Controller (Extract + Delegate).**
1. List every responsibility the controller performs.
2. For each: find its rightful owner via GRASP (Expert? Fabrication? Policy?).
3. Move it there; leave a one-line delegation in the controller.
4. Target: the controller method reads as a sequence of delegations with no branching on business rules.

---

## 6. Reviewing the *evaluators*, not just the placements

Junior reviewers check placements ("should this be on `Order`?"). Senior reviewers check the *evaluators are still satisfied after the change*:

- **Did this PR raise coupling?** Look at the diff's new `import`s. New imports in a domain class are a coupling red flag. New imports of *interfaces* are usually fine; new imports of *concrete infra* are not.
- **Did this PR lower cohesion?** A method added to a class that doesn't touch any of the class's existing fields is a cohesion smell — it probably belongs elsewhere.
- **Is the new indirection earned?** A new interface with exactly one implementor and no test seam is ceremony — push back unless variation is genuinely predicted.

A useful review question that catches most misassignments: *"If requirement X changes, how many files does this design force me to touch?"* — that's the Low Coupling test phrased as change cost.

---

## 7. When GRASP rigour matters vs. when it's overkill

GRASP earns its ceremony in proportion to a system's longevity and change rate.

**Matters most:**
- Long-lived domain cores that many teams touch.
- Code with predicted variation points (multiple payment providers, pluggable tax regimes).
- Boundaries that need test seams (anything hitting a network or database).
- Code where the wrong placement compounds (an anemic domain spreads).

**Overkill:**
- One-off scripts and migrations.
- Thin CRUD endpoints with no domain logic — an "anemic" structure is *correct* when there genuinely is no behaviour to own.
- Prototypes whose lifespan is a sprint.
- Speculative interfaces for variation no one has named.

The professional move is to *right-size* GRASP. Over-applying it (an interface per class, a service per noun) produces an over-engineered codebase that's as hard to change as an under-designed one — just for the opposite reason. The evaluators apply to your *design process* too: a design that's correctly coupled but takes ten classes to express one CRUD operation has failed High Cohesion at the *package* level.

---

## 8. Quick rules

- [ ] Use GRASP names in reviews — "Information Expert violation," not "feels off."
- [ ] The four common misassignments (Feature Envy, god class, infra-coupled domain, type-switch) each have a tool that detects them — wire them into CI.
- [ ] Encode Low Coupling and Pure Fabrication boundaries as ArchUnit rules; humans forget, CI doesn't.
- [ ] Treat LCOM/CBO/RFC as *triggers for a look*, not as gates.
- [ ] Review the evaluators after each change: new domain imports raise coupling; methods that touch no existing fields lower cohesion.
- [ ] Right-size GRASP — full rigour for long-lived domain cores, minimal ceremony for CRUD and scripts.
- [ ] Push back on unearned indirection: one implementor + no test seam = delete the interface.

---

**Memorize this:** On a team, GRASP is *shared, enforceable vocabulary*. Name the misassignment (Expert / Cohesion / Coupling / Polymorphism), reach for the tool that detects it (PMD, ArchUnit, LCOM/CBO), and apply the matching refactor (Move Method, Extract Class+Interface, Replace Conditional with Polymorphism, thin the Controller). Then right-size it — the same evaluators that condemn an anemic god class also condemn an over-abstracted one.
