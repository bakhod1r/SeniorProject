# Cohesion and Coupling — Senior

> **What?** The edge cases of *high cohesion, low coupling*: the connascence taxonomy, Constantine's seven levels of cohesion, how cohesion fights SRP and DRY in practice, where decoupling becomes performative, the costs of indirection (testability vs readability vs runtime), and module/architecture-scale applications. The senior view treats both metrics as *forces among many*, balanced against cohesion's pull and decoupling's tax.
> **How?** By naming the *specific kind* of cohesion or coupling each piece of code has (using connascence or Constantine's ladder), then judging whether the alternative shape would be cheaper. A class with stamp coupling and procedural cohesion can be acceptable; the same class with control coupling and coincidental cohesion cannot.

---

## 1. Constantine's seven levels of cohesion

Larry Constantine (1974, with Glenford Myers) ranked cohesion on a seven-step ladder, worst-first:

1. **Coincidental** — methods are in the same class for no reason. `Utils`, `Helpers`, `Misc`. Almost always wrong.
2. **Logical** — methods share a category but not a workflow. `MathUtils.sin/cos/sqrt/random` — they're all "math", but each is independent. Acceptable for stateless utility classes.
3. **Temporal** — methods called at the same lifecycle moment. `Initializer.openDb`/`openCache`/`bindNetwork` — all run at startup. Common and acceptable.
4. **Procedural** — methods participating in a sequence: `Pipeline.parse`, `Pipeline.validate`, `Pipeline.transform`. Coupling is order-of-execution; cohesion is "phases of one process".
5. **Communicational** — methods that operate on the same data. `Order.total()`, `Order.taxAmount()`, `Order.discountAmount()` — all read the same line items. Healthy.
6. **Sequential** — output of one method is input of the next. `Compiler.lex` → `Compiler.parse` → `Compiler.compile`. Strong cohesion.
7. **Functional** — every method contributes to a single, well-defined purpose. `PrimaryKeyGenerator.next()`. The ideal.

Senior-level use: name the level you see. "This class is logical-cohesive; it should be functional" is a precise diagnosis. "This class has bad cohesion" is hand-waving.

---

## 2. Connascence — the modern coupling taxonomy

*Connascence* (Page-Jones, 1996) categorizes coupling by *what needs to change together*. Worst-to-best:

**Static (compile-time) connascence:**

- **Name (CoN)** — two pieces use the same identifier. Lowest-cost coupling; most universal.
- **Type (CoT)** — two pieces agree on a type. `add(int)` vs `add(long)`.
- **Meaning (CoM)** — two pieces share a "magic" value (`status == 1` for active). Replace with named constants or enums.
- **Position (CoP)** — argument order matters. `foo(width, height)` vs `foo(height, width)`. Reduce by using named arguments or records.
- **Algorithm (CoA)** — two pieces implement the same algorithm and must stay in sync (two parsers that must accept the same grammar). Hard to spot; survive only by tests.

**Dynamic (run-time) connascence:**

- **Execution Order (CoEO)** — two methods must be called in a specific order.
- **Timing (CoTm)** — two methods must be called within a specific time window.
- **Value (CoV)** — two variables must hold consistent values (`startDate < endDate`).
- **Identity (CoI)** — two references must point at the same object.

The senior heuristic: dynamic connascence is more expensive than static; both should be *strong but local* and *weak but distant*. The worst combination is a strong dynamic connascence (e.g., timing) crossing a module boundary.

---

## 3. Cohesion vs DRY — when not to deduplicate

DRY says *one source of truth*. Cohesion says *related code lives together*. They agree most of the time. They fight when:

- Two classes look alike but change for different reasons. DRY would merge them; cohesion would keep them separate.
- A "helper" extracts behaviour from a focused class to satisfy DRY. The original class loses cohesion (one of its responsibilities is gone, leaving the rest a less-tight unit).

Example: `OrderValidator` and `CustomerValidator` both check `email != null && email.contains("@")`. A DRY enthusiast extracts `EmailValidator.isValid(email)`. Now both validators depend on it. If `OrderValidator`'s email rule diverges from `CustomerValidator`'s (different teams, different requirements), the extraction was wrong — the apparent duplication was *coincidental*, not *real*.

**Senior rule:** deduplicate when the duplicated code has *one source of meaning* (one stakeholder, one reason to change). Keep duplicate when the two copies serve different stakeholders, even if they look identical *today*.

```java
// Wrong — coincidental duplication merged
public class Validators {
    public static boolean isValidEmail(String e) { return e != null && e.contains("@"); }
}

// Right — each context owns its rule
public class OrderValidator    { boolean validEmail(String e) { /* order's rule */ } }
public class CustomerValidator { boolean validEmail(String e) { /* customer's rule */ } }
```

The two rules will diverge. Letting them diverge is cheaper than merging them and later un-merging.

---

## 4. Coupling vs encapsulation — when indirection over-pays

Decoupling has a cost: every introduced interface is one file, one indirection, one mental hop. *Excessive* decoupling looks like:

```java
public interface IClock              { Instant now(); }
public interface IStringFormatter    { String format(Object o); }
public interface ILocalDateProvider  { LocalDate today(); }
public interface IUuidGenerator      { UUID newId(); }
```

Each is an interface with one implementation, injected via constructor. The class's constructor balloons to ten parameters, all interfaces. None will ever have a second implementation. None is mocked in tests because mocking `IUuidGenerator.newId()` is busywork.

The senior corrective: an interface earns its keep when (a) it has more than one *real* implementation, (b) it crosses an *infrastructure boundary* (database, network, time, randomness — all worth abstracting), or (c) it isolates code you don't own. `Clock` deserves the abstraction (you want to test time without sleeping); `UuidGenerator` doesn't (no test needs deterministic UUIDs in 99% of contexts).

---

## 5. Cohesion at the package level

A class's cohesion is one scale; a package's cohesion is another. Robert Martin's package cohesion principles:

- **Reuse-Release Equivalence (REP)** — the *granule* of reuse is the package; what's in a package should be released together.
- **Common Reuse (CRP)** — classes used together should be in the same package; classes used separately should be in different packages.
- **Common Closure (CCP)** — classes that change together should be in the same package; classes that change for different reasons should be in different packages.

CCP is the deepest: it's SRP applied to packages. A package whose classes are edited by four different teams is not cohesive. Split.

```
com.acme.order                 # the order aggregate — one team owns it
com.acme.order.api             # public types — exported via module-info
com.acme.order.internal        # private types — not exported
```

Each package has one purpose and (ideally) one team. Module exports enforce the boundary at the linker.

---

## 6. Coupling at the architecture level — fan-out, fan-in

The architecture-scale equivalent of Ce/Ca is *fan-out* (how many other modules this one depends on) and *fan-in* (how many depend on it).

- **High fan-in, low fan-out** → a *stable* module (e.g., a shared `Money` library). Don't change carelessly.
- **Low fan-in, high fan-out** → an *unstable* module (e.g., an application's composition root). Changes are local.

The *Stable Dependencies Principle*: depend in the direction of stability. Stable modules don't depend on unstable ones. In Java, the convention is: domain modules (stable) live at the centre; infrastructure modules (unstable) live at the edges; the dependency arrows point inward (hexagonal/clean architecture).

```
com.acme.order               (domain, stable, fan-in high)
   ↑                ↑
com.acme.order.jpa     com.acme.order.web    (infrastructure, fan-out high)
```

The opposite shape — domain depending on JPA — couples the stable to the unstable. Reorganize so the arrows point toward the stable centre.

---

## 7. The "balanced classes" trap

Senior reviewers sometimes overreact to "too many lines per class" or "too few methods per class" and demand uniform sizes. Both miss the point.

A class's size should match its *purpose*. A `PrimeNumberSieve` with one method is fine — its purpose is small. An `OrderAggregate` with thirty methods is also fine — orders are complex domain objects. *Coincidence of size* across the codebase is a code-smell signal that the team is optimizing for the wrong metric.

**Senior rule:** measure cohesion by *how cleanly the class's name captures its methods*, not by line count. A 1,500-line class with functional cohesion is healthy; a 30-line class with coincidental cohesion (three unrelated static methods in a `Utils`) is not.

---

## 8. CUPID and cohesion — Dan North's view

Dan North's *CUPID* properties (2022) reframe cohesion at the *outcome* level:

- **Unix-philosophy** — does one thing well. (Cohesion.)
- **Composable** — plays well with others. (Decoupling.)
- **Predictable** — does what you expect. (No hidden coupling.)

CUPID's contribution: cohesion and coupling are *experiences*, not metrics. A class can be "low LCOM" on paper and still feel incohesive to read; a class can be "highly coupled" on paper and feel intuitive in use. Both numeric tools (LCOM, Ce/Ca) and code-feel are valid signals; senior judgement weighs both.

When the LCOM is good but the *feel* is bad, the problem is usually a naming or abstraction issue — the methods belong together but the class's name doesn't capture the unity.

---

## 9. Anti-patterns and "fake cohesion / fake decoupling"

Codebases that *claim* high cohesion and low coupling but don't have it:

- **The "service layer" hairball.** Every class extends `AbstractService<T>` and has the same methods. LCOM scores well because they all do the same things; coupling scores poorly because they all use the same shared utilities.
- **The interface-per-class.** Every `Foo` has `IFoo`. Decoupling is performative — no second implementation exists. The codebase has 2× the files for no design benefit.
- **The shared base class.** Five classes extend `BaseValidator` to share `validateNotNull(...)`. They're now coupled through inheritance, even though their actual validation rules diverge.
- **The DTO with logic.** A "data class" has 30 getters and 12 helper methods. LCOM is poor because the helpers don't share state, just data.
- **The microservice with internal coupling.** Two microservices share a database. Network-level coupling looks loose; data-level coupling is tight.
- **The configuration sprawl.** A `Settings` singleton with 200 keys. Every class that reads three keys is coupled to the 200-key surface — name connascence at scale.

The honest test: read the *change history*. If a feature lands across N classes, those classes are coupled. If a class has commits from M different stakeholders, it's incohesive.

---

## 10. Quick rules

- Cohesion type (Constantine's 7 levels) and connascence type (Page-Jones's 9 levels) are the *names*; "good coupling" alone is hand-waving.
- LCOM4 > 1 means the class has connected-component-many cohesive units; split.
- Interfaces earn their keep at infrastructure boundaries, not in pure-Java helper code.
- DRY beats cohesion only when the duplication shares *meaning*, not just shape.
- Stable depends on unstable, not the reverse. Domain at the centre, infrastructure at the edge.
- Common Closure Principle: classes that change together belong in the same package.
- The `git log --author` mix on a single class is a real-world cohesion metric.
- Decoupling has a tax: indirection, file count, mental hop. Pay it where the cost is justified.
- Read the *experience* (CUPID-style) as well as the numbers — both signals matter.
- "Microservice" doesn't lower coupling automatically; shared DB / shared API / shared event schema can re-introduce it.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving cohesion/coupling reviews across a team             | `professional.md`  |
| JLS access control, modules, package design                 | `specification.md` |
| Spotting hidden coupling and cohesion drift                 | `find-bug.md`      |
| Performance impact of indirection layers                    | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** cohesion and coupling are *forces*, not commandments. Name the *kind* you see (Constantine's seven for cohesion, Page-Jones's nine for connascence). Apply DRY only where meaning, not shape, is shared. Pay the decoupling tax only at infrastructure boundaries. Read `git log` and CUPID-style "feel" alongside LCOM and Ce/Ca; both signals matter. The senior toolkit: name precisely, balance against other forces, optimize at the right scale (class, package, module).
