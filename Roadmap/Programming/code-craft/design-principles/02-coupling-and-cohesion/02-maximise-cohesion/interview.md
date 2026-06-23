# Maximise Cohesion — Interview Questions

> **Category:** [Design Principles → Coupling & Cohesion](../../README.md) — group things that change together; separate things that don't.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is cohesion?

**Answer:** Cohesion is how strongly the elements inside one module belong together. **High cohesion** means the module does one well-defined job and every part serves it; **low cohesion** means it's a grab-bag of unrelated things.

### J2. State the slogan that pairs cohesion with its partner. What's the partner?

**Answer:** **"High cohesion, low coupling."** The partner is **[coupling](../01-minimise-coupling/)** — how much one module depends on another. Cohesion is about what's *inside* a module; coupling is about what's *between* modules.

### J3. Give the quick "one-sentence test" for cohesion.

**Answer:** Can you describe the module in one sentence with *no "and"*? If you need "and," it's probably doing more than one job — a candidate split.

### J4. List the seven cohesion levels from worst to best.

**Answer:** Coincidental, Logical, Temporal, Procedural, Communicational, Sequential, Functional. (Stevens/Myers/Constantine.)

### J5. Why is functional cohesion the goal?

**Answer:** A functionally cohesive module has *one reason to exist* — all its parts serve one task. That makes it the easiest to name, test, reuse, and change, and a change to its job touches only it.

### J6. What name suffixes warn you a class is probably low-cohesion?

**Answer:** `Utils`, `Helpers`, `Common`, `Misc`, `Shared`, `Manager`, `Processor` — category names rather than concept names. They tend to mean "I had a function and didn't know where it belonged."

### J7. What is a God class?

**Answer:** One huge class that does many unrelated jobs, related only by a noun (e.g. `OrderManager` that validates, prices, persists, emails, and refunds). It's extreme low cohesion — un-testable, un-reusable, and dangerous to change.

### J8. How does maximising cohesion relate to the Single Responsibility Principle?

**Answer:** They're the same idea from two angles. A highly cohesive class does one job, so it has one reason to change — which is exactly [SRP](../../04-solid/01-srp-single-responsibility/). Cohesion looks at *what's grouped*; SRP looks at *why it would change*.

### J9. Is a small class always cohesive and a large one always not?

**Answer:** No. A small class can be incohesive (four unrelated methods); a large one can be cohesive (a rich `Matrix` with many operations all about matrices). Cohesion is about *relatedness of purpose*, not size.

### J10. What does the `static`-everything class usually signal?

**Answer:** Often a `Utils` grab-bag: if a class has only static methods and no shared instance fields, its methods share no data, so it's informationally incohesive by definition.

---

## Middle Questions

### M1. Restate cohesion in terms of *change*. What principle expresses this?

**Answer:** Cohesion = keeping the things that **change together**, together — so a single requirement change touches one module. The **Common Closure Principle** states it at the component level: "gather what changes for the same reasons at the same times; separate what changes for different reasons."

### M2. What is LCOM, and how does LCOM4 work?

**Answer:** LCOM ("Lack of Cohesion of Methods") measures how much a class's methods share its fields — higher = less cohesive. **LCOM4** builds a graph where methods are nodes and an edge joins two methods that share a field or call each other; LCOM4 = the number of **connected components**. LCOM4 = 1 means cohesive; ≥ 2 means the class is really that many classes fused — and each component *is* one of them, so it prescribes the split.

### M3. What is change-coupling, and how does it reveal misplaced cohesion?

**Answer:** Change-coupling = files frequently edited together in the same commits despite no static dependency. Files that change together but live apart reveal one concept split across two places (*misplaced* cohesion); a file change-coupled with many others is a low-cohesion God-hub. It's the empirical ground truth behind "things that change together should live together."

### M4. Give two cases where low-rung cohesion (temporal/logical) is acceptable.

**Answer:** Lifecycle hooks (`init()`, `setUp()`/`tearDown()`) are legitimately *temporal* — "runs at the same time" *is* the responsibility. A small closed set of true variants behind one name (a `Comparator` switch on sort order) is legitimately *logical*. An orchestrator sequencing workflow steps is legitimately *procedural*. The ladder ranks tendencies; fix *accidental* low cohesion, not intentional groupings.

### M5. How can chasing cohesion *increase* coupling?

**Answer:** Splitting "for purity" into many tiny modules makes each cohesive but forces them all to collaborate to do anything — replacing intra-module clutter with inter-module chatter, raising coupling and destroying locality. Cohesion and coupling must be optimised *jointly*.

### M6. Why is LCOM a "smell, not a gate"?

**Answer:** It has many false positives: data classes/DTOs (no shared-field methods), constructors, builders, and getter/setter-heavy classes all score "incohesive" while being fine. So it should flag classes to *inspect*, never fail a build. Trust the one-sentence test over the metric when they disagree.

### M7. What's "informational cohesion," and how does it apply to classes?

**Answer:** A class is informationally cohesive when its methods all operate on the **same internal fields** — communicational cohesion at the class level. It's the target for OO classes; a class whose methods touch disjoint field sets has high LCOM and is a split candidate.

---

## Senior Questions

### S1. Explain the sense in which cohesion and coupling are "dual."

**Answer:** They're the same measurement on opposite sides of a boundary: both ask "how strongly are these elements related?" — cohesion *inside* a module, coupling *across* it. Draw a boundary in a dependency graph: the relationships you enclose are cohesion; the ones you cut are coupling. So you can't maximise cohesion and minimise coupling independently — moving the boundary trades them. Good design draws the boundary to keep *strong* relationships inside and cut only *weak* ones (a minimum cut through the weak edges).

### S2. Define cohesion through connascence.

**Answer:** **High cohesion = strong [connascence](../03-connascence/) (algorithm, meaning, execution) kept *local*, inside a module. Low coupling = only *weak* connascence (name, type) crosses boundaries.** A functionally cohesive module contains strong connascence on purpose (that's the bond); a God class contains strong connascence between elements serving *different* actors (the bad kind — split it); a `Utils` class contains *no* connascence (arbitrary boundary). Split where strong connascence falls into clusters with no shared connascence; don't split where it would spread one strong connascence across boundaries.

### S3. When is maximising cohesion *wrong*?

**Answer:** Three pathologies: (1) **Fragmented locality** — splitting closely-related code so a feature becomes a manhunt across files; locality is a cohesion *benefit* you throw away. (2) **Wrong-axis split** — splitting by *mechanism* (all validators here, package-by-layer) instead of *change-reason*, so a feature change scatters (shotgun surgery). (3) **Premature cohesion** — decomposing before the change-profile is known, baking in a wrong guess. The pragmatic medium-sized module often beats the "pure" decomposition. Cohesion is a *direction*, not a maximisation; the goal is *alignment with axes of change*.

### S4. Relate the Common Closure Principle to SRP.

**Answer:** CCP ("gather what changes for the same reasons; separate what changes for different reasons") is cohesion at the component scale; **SRP is CCP applied to one class** — a class closed against one actor's changes (functional cohesion in change-terms). Both say: align boundaries with axes of change so each change is *closed* inside one boundary. Under-aligned → shotgun surgery; over-aggregated → God class.

### S5. Why is cohesion relative, not absolute?

**Answer:** Cohesion is defined by the *expected change profile*, not by topic or structure. Two methods "about pricing" belong in different modules if one changes with tax law and the other with the UI. Since change-reasons are often *who requests them* (actors), cohesion is partly an organisational fact ([Conway's Law](../../04-solid/01-srp-single-responsibility/)) — the same class can be cohesive in one org and a God class in another.

### S6. How is the package-by-feature vs. package-by-layer choice a cohesion decision?

**Answer:** A feature is an *axis of change*. Package-by-feature closes each package against one feature's changes (high cohesion — an order change stays in `order/`). Package-by-layer groups by *mechanism* (`controllers/`, `services/`, `repositories/`), so every feature change cuts across all layers (low cohesion, shotgun surgery). The same logic scales to services: a microservice should own a cohesive bounded context, not a technical tier — else it's a distributed monolith.

---

## Professional Questions

### P1. How do you enforce cohesion in code review?

**Answer:** Ask, of every new method on an existing class: *"Does this belong here — does it use this module's data and serve its one job, or was here just convenient?"* and *"One sentence for this module — any 'and' to split on?"* Watch both failures: methods accreting onto the wrong home (→ God class) **and** over-decomposition (tiny classes that are one concept fragmented). Be willing to say *"merge these,"* not only *"split this."*

### P2. What metrics actually track cohesion at scale?

**Answer:** **Change-coupling** (which files change together in git) is the best — it finds *misplaced* cohesion and God-hubs that field-based metrics miss. **LCOM4** is best for *prescribing* a split (components → classes), used as a smell not a gate. **Files-per-change** as a trend is the outcome signal. Avoid LCOM-as-a-build-gate (false positives on data classes/builders) and "size = incohesion" (big ≠ incohesive).

### P3. How do you split a God class in a legacy system safely?

**Answer:** Characterization tests first (pin current behaviour) → find LCOM4 field-clusters → Extract Class on the smallest, most independent cluster → have the old class **delegate** to the new one → re-point callers incrementally → repeat → delete the empty husk. Opportunistically, as you touch the code for features (Boy Scout Rule), never as a big-bang rewrite. Don't over-correct into per-method fragmentation.

### P4. A teammate wants to merge all `validate()` methods into a `ValidationManager`. Good idea?

**Answer:** Usually no. A **shared verb is not a shared concept**. Order, user, and payment validation change for different reasons and touch disjoint data — merging them gives *logical* cohesion (a category), near the bottom of the ladder, and creates a multi-team contention file where an order change risks payment validation. Keep each domain's validation in its feature package. (Real incident pattern; see [Professional](professional.md).)

### P5. How do you fight cohesion erosion culturally?

**Answer:** Make the cohesive home the *easy* default — package-by-feature structure, banned grab-bag names (linted), a "does it use the data?" placement rule. Tie God-class cleanups to operational pain stakeholders feel (merge conflicts, why-did-that-break bugs). Reward *alignment with change-axes*, not module count — celebrate a merge that restores locality as much as a split, so you don't train the team into over-decomposition.

### P6. Why report change-coupling rather than LCOM as a cohesion win?

**Answer:** LCOM moves for spurious reasons (you added a getter) and false-positives on data classes, so quoting it makes a report suspect. Change-coupling and files-per-change reflect the real maintainability gain — can a feature change now edit one place instead of scattering? That's the outcome stakeholders care about.

---

## Coding Tasks

### C1. Identify the cohesion level and fix it (Python).

**Before:**

```python
class Misc:
    def celsius_to_f(self, c): return c * 9/5 + 32
    def is_prime(self, n): ...
    def send_email(self, to, body): ...
```

**Answer:** **Coincidental cohesion** — three unrelated jobs sharing a class for no reason. Fix: move each next to its concept.

```python
class Temperature:
    def __init__(self, celsius): self.celsius = celsius
    def in_fahrenheit(self): return self.celsius * 9/5 + 32

def is_prime(n): ...           # belongs in a math/numbers module
class Mailer:
    def send(self, to, body): ...
```

### C2. Split a class by field clusters (Java).

**Before** (LCOM4 = 3):

```java
class Account {
    private String owner, email;       // identity
    private double balance;            // money
    private List<Txn> history;         // ledger
    String displayOwner()  { return owner; }
    void deposit(double a) { balance += a; }
    void log(Txn t)        { history.add(t); }
}
```

**After** — split along the three disjoint field-clusters:

```java
class AccountHolder { private String owner, email;  String displayOwner(){return owner;} }
class Balance       { private double balance;       void deposit(double a){balance += a;} }
class Ledger        { private List<Txn> history;    void log(Txn t){history.add(t);} }
```

State the reasoning: each method touched a disjoint field set (LCOM4 = 3), so the class was three classes fused; the components prescribe the split.

### C3. Spot the over-decomposition and merge it (TypeScript).

**Before** — five tiny classes that always change together:

```typescript
class PriceCalculator { calc(o: Order): number { /*...*/ return 0; } }
class DiscountApplier { apply(p: number, o: Order): number { /*...*/ return p; } }
class TaxAdder        { add(p: number, o: Order): number { /*...*/ return p; } }
class PriceRounder    { round(p: number): number { /*...*/ return p; } }
```

**After** — they share one pricing concept (strong connascence of algorithm/meaning); merge for real cohesion + lower coupling:

```typescript
class Pricing {
  total(o: Order): number {
    return this.round(this.addTax(this.applyDiscounts(this.calc(o), o), o));
  }
  private calc(o: Order): number { /*...*/ return 0; }
  private applyDiscounts(p: number, o: Order): number { /*...*/ return p; }
  private addTax(p: number, o: Order): number { /*...*/ return p; }
  private round(p: number): number { /*...*/ return p; }
}
```

Reasoning: splitting spread strong connascence across boundaries — *the same cohesion fragmented into coupling*. They change together, so they belong together.

### C4. Decide split-or-keep (Python).

```python
# Case A — DON'T split: encoder & decoder share connascence of algorithm + meaning
def to_wire(order):   return encode(order, WIRE_VERSION)
def from_wire(bytes): return decode(bytes, WIRE_VERSION)

# Case B — DO split: persistence & emailing change for different reasons (DB vs. provider)
class OrderRepository: ...   # connascent with the schema
class OrderNotifier: ...     # connascent with the email provider
```

State the single criterion: **keep strongly-connascent things together; separate things with no shared connascence.** It handles both "don't over-split" and "split the God class."

---

## Trick Questions

### T1. "More, smaller classes = more cohesion = better." True?

**False.** Cohesion is *strong connascence kept local*, not maximum module count. Over-decomposition fragments one concept into a coupled web — each piece looks cohesive, but the system's coupling rises and locality dies. Optimise cohesion *and* coupling jointly; sometimes the right move is to *merge*.

### T2. "DRY all duplicate methods together — e.g. all `validate()` into one class." Good?

**No.** A shared verb is not a shared concept. Merging order/user/payment validation gives *logical* cohesion (a category, near the bottom of the ladder) and couples three independent things through one file. Group by *change-axis*, not by method name.

### T3. "A class with high LCOM must be refactored." Agree?

**Not necessarily.** LCOM is a smell, not a verdict — data classes/DTOs, builders, constructors, and getter-heavy classes score "incohesive" while being fine. Inspect, don't auto-split. Never gate a build on LCOM.

### T4. "Cohesion is about how big or small a class is." Right?

**No.** Cohesion is about *relatedness of purpose*, not size. A small class can be incohesive (unrelated methods); a large one can be cohesive (all methods about one concept). Size is, at most, a weak hint to go look.

### T5. "High cohesion always means low coupling." Always?

**Usually, not always.** They usually align (group related things → fewer cross-boundary deps), but over-decomposition for "cohesion" can spread strong connascence across boundaries and *raise* coupling. They're dual; the goal is strong connascence inside, weak across — alignment, not blind maximisation of either.

### T6. "Functional cohesion means the module has only one method." True?

**No.** Functional cohesion means every part serves *one task/purpose* — a cohesive `String` or `Matrix` class has many methods, all about that one concept. It's about shared purpose, not method count.

---

## Behavioral Questions

### B1. Tell me about a time you broke up a God class.

**Sample:** "We had a 4,000-line `OrderManager` doing validation, pricing, tax, persistence, email, and refunds. It showed up in nearly every commit — change-coupling analysis showed 60+ coupled files — and two unrelated changes once merge-conflicted into a refund bug. I wrote characterization tests, found the field-clusters with LCOM4, and extracted classes smallest-first, delegating from the old class until callers migrated. We did it opportunistically over a quarter. Merge conflicts in that area dropped ~80%. The lesson I quote: low cohesion is an *operational* risk, not just ugliness — it serialises unrelated changes through one file."

### B2. Describe a time a refactor *hurt* cohesion.

**Sample:** "A teammate 'DRY'd' three domains' `validate()` methods into one `ValidationManager`. It looked tidy but had LCOM4 = 3 — three disjoint clusters merged only by a shared verb — and now an order-validation change risked payment validation, with three teams contending over one file. I split it back into each feature package. I learned that a shared verb isn't a shared concept; merging by topic creates logical cohesion, near the bottom of the ladder."

### B3. How do you push back when a teammate over-decomposes?

**Sample:** "I ask: 'Do these always change together and only make sense as a group?' If yes, they're one cohesive concept fragmented into a coupled web — I suggest merging and keeping internal methods cohesive. I frame it as 'this raises coupling and kills locality,' citing our convention that we reward alignment with change-axes, not module count — so it's a standard, not my taste. A merge that restores locality is as valuable as a split."

### B4. When did you decide *not* to split something?

**Sample:** "An encoder and decoder shared a wire-format version and algorithm — strong connascence of meaning and algorithm. A reviewer wanted them in separate modules 'for cohesion.' I pushed back: splitting would put two ends of one strong connascence in different modules, so every format change would edit both — that's coupling disguised as cohesion. We kept them in one `wire` module. The criterion I used: keep strongly-connascent things together."

### B5. How do you keep a large codebase cohesive over years?

**Sample:** "Make the cohesive home the easy default: package-by-feature, banned grab-bag names (linted), a 'does it use the data?' placement rule, and a one-sentence rule in PR descriptions. Run quarterly change-coupling analysis to catch misplaced cohesion and God-hubs before they hurt. And culturally, reward alignment with change-axes over module count — so people don't swing from God classes to over-decomposition."

---

## Tips for Answering

1. **Lead with the definition and the slogan:** cohesion = how strongly a module's parts belong together; **"high cohesion, low coupling."**
2. **Use the one-sentence test** as your quick diagnostic, and **"changes together"** as the deeper one (Common Closure).
3. **Name the ladder** (coincidental → functional) but stress functional is the goal *because* it gives one reason to change.
4. **Connect to [SRP](../../04-solid/01-srp-single-responsibility/)** — same idea, change-angle — and to **[connascence](../03-connascence/)** if pushed (strong connascence local).
5. **Know LCOM4** (connected components prescribe the split) and **change-coupling** (finds misplaced cohesion) — and that LCOM is a smell, not a gate.
6. **Show the senior nuance:** cohesion and coupling are *dual*; over-decomposition raises coupling; the goal is *alignment with change-axes*, not maximisation.
7. **Distinguish shared verb from shared concept** and **size from cohesion** — the two classic traps.

---

[← Professional](professional.md) · [Coupling & Cohesion](../../README.md) · [Roadmap](../../../README.md) · **Next:** [Minimise Coupling](../01-minimise-coupling/)
