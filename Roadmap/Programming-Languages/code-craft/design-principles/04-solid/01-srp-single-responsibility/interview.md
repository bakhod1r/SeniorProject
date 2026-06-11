# Single Responsibility Principle (SRP) — Interview Questions

> **Category:** [Design Principles → SOLID](../README.md) — a class should have one, and only one, reason to change.

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

### J1. State the Single Responsibility Principle.

**Answer:** A class should have one, and only one, **reason to change**. Most precisely (Uncle Bob's reframing): a class/module should be **responsible to one, and only one, actor** — one person or role who requests changes to it.

### J2. Is SRP "a class should do one thing"?

**Answer:** No — that's the common misconception. SRP counts *reasons to change* (actors), not *operations*. A `Stack` does five things (push/pop/peek/size/isEmpty) but has one reason to change, so it's SRP-compliant. The right substitution: "a class should answer to one *actor*."

### J3. What is a "responsibility" in SRP?

**Answer:** An **axis of change driven by a single actor** — a stakeholder/role (CFO/accounting, COO/operations, CTO/DBAs) who can request that the code be modified. One responsibility = one actor = one reason to change.

### J4. Give the canonical example of an SRP violation.

**Answer:** Uncle Bob's `Employee` class with `calculatePay()` (CFO/accounting), `reportHours()` (COO/operations), and `save()` (CTO/DBAs). Three actors, three reasons to change, in one class. The fix is one class per actor.

### J5. What goes wrong if a class has multiple responsibilities?

**Answer:** **Accidental coupling.** A change requested by one actor can silently break behaviour owned by another — e.g. if `calculatePay` and `reportHours` share a helper, an ops change to the helper corrupts the pay calculation. You also get cross-team merge conflicts and code that's hard to test in isolation.

### J6. How do you fix the `Employee` violation?

**Answer:** Extract one class per actor: `PayCalculator`, `HourReporter`, `EmployeeRepository`, with `EmployeeData` holding the shared data. Optionally front them with a **Facade** so callers keep one entry point.

### J7. What is a quick test for whether a class has one responsibility?

**Answer:** Ask *"Who would request a change to this class?"* If you can name only one role/stakeholder, it has one responsibility. Two or more roles → split along them.

### J8. Where does SRP sit among the SOLID principles?

**Answer:** It's the **"S"** — the first of the five (SRP, OCP, LSP, ISP, DIP), popularized by Robert C. Martin. ISP is essentially SRP applied to interfaces.

### J9. What's a symptom you can *feel* before naming an SRP violation?

**Answer:** Cross-team merge conflicts in one file; "why did *that* break when I only changed this?"; a class you can't name precisely (`Manager`/`Util`); needing a database and a mail server just to test one formula.

### J10. Does SRP mean models can't have behaviour?

**Answer:** No. A class may hold rich behaviour as long as it's *one actor's* behaviour. The mistake is mixing *actors* (e.g. domain rules + persistence + presentation), not having logic. SRP ≠ anaemic models.

---

## Middle Questions

### M1. How do you find the actors hidden in an existing god class?

**Answer:** Read the git history of the file; group its past changes by *kind* and tie each to a *requesting role* (finance, design, ops, DBA, security); group the methods by requester; the requester boundaries are your split lines. Vocabulary shifts inside the class (tax → HTML → SQL) are extra hints.

### M2. Why is "SRP is just cohesion" accurate?

**Answer:** Cohesion measures whether a module's elements belong together; SRP defines "belong together" as "change for the same reason (actor)." SRP targets **functional cohesion** — every element serving one purpose/actor. "Maximise cohesion" and "one reason to change" are the same instruction.

### M3. Is a facade/coordinator that calls three classes an SRP violation?

**Answer:** No. *Orchestration* is itself a single responsibility — its one reason to change is the *workflow's steps*. A class that *implements* three concerns violates SRP; a class that *delegates* to three single-responsibility classes does not.

### M4. What is the over-application failure mode of SRP?

**Answer:** The **class explosion** — splitting per *operation* instead of per *actor*, producing dozens of one-method classes. Understanding one feature then means chasing many files, and a single change becomes **shotgun surgery** — the inverse smell of the god class.

### M5. When should you NOT split a class?

**Answer:** When there's only one real actor (many methods, one requester — fine); when the second actor is speculative not real ([YAGNI](../../01-generic/02-yagni/)); when splitting would create worse coupling/shared state; or when the program is tiny with one change-source.

### M6. How does SRP differ across function, class, and module levels?

**Answer:** At the **function** level it shades into "do one thing / one level of abstraction." At the **class/module** level it's "responsible to one actor." Applying the function-level rule at the class level produces the wrong "one method per class" anti-pattern — use the *actor* test at class/module level.

### M7. Active Record puts `save()` on the model. SRP violation?

**Answer:** Technically yes — it mixes the domain actor and the DBA actor. But it's a *deliberate trade-off* (productivity vs. purity) that's often right for small/medium apps. The professional line: keep persistence on the model *if you've chosen AR*, but draw a hard boundary at *other* foreign actors (no email/PDF/reporting on the model).

### M8. Two methods look identical and you want to DRY them. How does SRP inform the decision?

**Answer:** Check whether they answer to the *same actor*. If two coincidentally-identical methods answer to *different* actors, merging them couples two things that will diverge — and an edit by one actor will silently break the other. SRP says keep them apart even at the cost of duplication.

---

## Senior Questions

### S1. Why is "one reason to change" considered ambiguous, and how do actors fix it?

**Answer:** "Reason" is subjective — engineers argue endlessly about whether two changes are "the same reason." Grounding "reason" in an **actor** (a person/role who requests changes) makes SRP *falsifiable in review*: "does a *different stakeholder* request this change?" is answerable where "is this a separate responsibility?" is not. It also reveals that responsibilities are defined by the *organisation*, not intrinsic to the code.

### S2. Explain SRP in terms of connascence.

**Answer:** Two elements are connascent if a change in one forces a change in the other. An SRP violation is **strong connascence (of meaning/algorithm/execution) that crosses an actor boundary** — that's how one actor's change propagates into another's behaviour. The fix is to *localise* strong connascence inside each actor's class and let only *weak* connascence (name/type) cross boundaries. So: don't "separate responsibilities" — localise and weaken cross-actor connascence.

### S3. How does SRP relate to the Common Closure Principle?

**Answer:** CCP ("group classes that change for the same reasons; a change should touch one component, not many") is SRP at the component level. SRP is CCP applied to a single class: draw the boundary so one reason-to-change is fully *closed inside* it — never split across boundaries (shotgun surgery) nor sharing a boundary with a different reason (god class). Both failures are *misaligned closure*.

### S4. How is SRP connected to Conway's Law?

**Answer:** Actors are *people/teams*, so "one actor per module" means **align code boundaries with team boundaries**. Do that and a change requested by one team touches code owned, reviewed, and deployed by that team — no cross-team coordination. Violate SRP and two teams share a file, taxing every change with coordination and merge conflicts. SRP is Conway's Law at the class level.

### S5. SRP says split; KISS/"fewest elements" says don't add classes. Reconcile them.

**Answer:** Splitting always *adds* elements, so SRP and simplicity are in real tension. The resolution: SRP earns its elements **only when there's a real second actor**. Splitting for an *imagined* actor is speculative generality — a YAGNI violation. Conversely, refusing to split when two real actors collide costs you accidental-coupling bugs. Split at the genuine actor boundary; not before, not past it.

### S6. Where does SRP bite hardest — classes or services?

**Answer:** **Services.** A misaligned class boundary causes local shotgun surgery; a misaligned *service* boundary (splitting by technical layer instead of business capability) causes the **distributed monolith** — one feature change ripples across many services and deploys, with distributed transactions. SRP at the service tier means "one *business capability* per service," not "one technical layer per service."

### S7. Can the same code be SRP-compliant in one company and a violation in another?

**Answer:** Yes. Responsibilities are defined by your *actual* sources of change. If two concerns are always changed by the *same* team at the *same* cadence, they're effectively one actor for you. If another company has two separate teams driving those concerns, the same class violates SRP there. There is no universal, context-free decomposition — which is why SRP is judgement, not a mechanical rule.

---

## Professional Questions

### P1. How do you enforce SRP in code review?

**Answer:** Review for **actors, not lines.** The highest-value question: *"Who requests changes to this class — one role or two?"* Catch *responsibility creep* (a change adding a new actor's concern), foreign actors on domain models, and helpers shared across two actors. Equally, push back on *over*-splitting (class-per-operation). Cite a policy, not a preference.

### P2. What metrics actually track SRP?

**Answer:** **Change-coupling** (git co-change — concerns that always change in separate commits by different teams are different actors) and **authors/teams-per-file** are the best proxies, because they measure the *real* thing: sources of change. LCOM is a useful static smell but blind to actors; lines-per-class is a weak trend signal. Ground truth is *blast radius* — does a change here break unrelated behaviour?

### P3. How do you refactor a legacy god class toward SRP?

**Answer:** Identify actors from git history → pin behaviour with characterization tests → *Extract Class* one actor at a time (move methods + their exclusive fields, leave delegating methods) → break any cross-actor shared helpers by duplicating them → Facade + Strangler to migrate callers → delete the god class. Opportunistic, small commits, never a big-bang rewrite, and don't over-split while you're in there.

### P4. How do you handle a shared helper used by two different actors' methods?

**Answer:** Duplicate it so each actor owns its copy, then let them diverge. The sharing was *coincidental* (the two methods looked identical but answer to different actors) and is exactly how one actor's edit silently breaks another's behaviour. Prefer the duplication to the cross-actor coupling.

### P5. What's the danger of measuring SRP only with LCOM or lines-of-code?

**Answer:** Both are blind to *actors*. LCOM finds structural incohesion but can't tell that two cohesive method-groups answer to different teams; a big one-actor class has high LOC but is fine. Quoting them to "prove" an SRP win is misleading — they can stay flat while you've genuinely separated actors. Use change-coupling and authors-per-file.

### P6. How do you fight SRP erosion culturally?

**Answer:** Make "place by actor, not by convenience" a stated value; ban grab-bag class names; require one-PR-one-concern; align one owning team per module (Conway); and reframe so that *removing* a misplaced concern is the respected move. Senior engineers must model it — if the staff engineer piles email and PDF onto a model "to ship," everyone will.

---

## Coding Tasks

### C1. Identify the actors and split this class (Java).

**Before:**

```java
class Employee {
    Money calculatePay()  { /* tax brackets, overtime */ }   // ?
    Hours reportHours()   { /* timesheet aggregation */ }    // ?
    void  save()          { /* SQL insert/update */ }        // ?
}
```

**Answer — name the actors, then split:**

```java
// calculatePay → CFO/accounting · reportHours → COO/operations · save → CTO/DBAs
class PayCalculator      { Money calculatePay(EmployeeData e) { /* ... */ } }
class HourReporter       { Hours reportHours(EmployeeData e)  { /* ... */ } }
class EmployeeRepository { void  save(EmployeeData e)         { /* ... */ } }
class EmployeeData       { /* fields only */ }
// Optional: EmployeeFacade delegating to the three, for a single entry point.
```

### C2. Spot the foreign actor and remove it (TypeScript).

**Before:**

```typescript
class Order {
  total(): number { /* pricing rules — business actor */ }
  save(): void { db.exec("INSERT ..."); }          // DBA actor
  sendConfirmation(): void { mailer.send(/*...*/); } // infra actor
  toCsvRow(): string { /*...*/ }                     // reporting actor
}
```

**Answer:**

```typescript
class Order { total(): number { /* domain rule stays */ } }
class OrderRepository       { save(o: Order): void { db.exec("INSERT ..."); } }
class OrderConfirmationMailer { send(o: Order): void { mailer.send(/*...*/); } }
class OrderCsvExporter      { toRow(o: Order): string { /*...*/ } }
// total() is the business actor's rule and may stay on Order; the other three
// are foreign actors and move out.
```

### C3. Decide whether to split, and justify (Python).

```python
class Money:
    def add(self, other): ...
    def subtract(self, other): ...
    def multiply(self, factor): ...
    def format(self, locale): ...
```

**Answer:** Do **not** split. All four methods serve **one actor** — whoever owns the money/value-object semantics — and change for one reason. This is a cohesive value object (many operations, one reason to change), so it's SRP-compliant. Splitting per operation would be the *class-explosion* anti-pattern. (Caveat: if `format(locale)` grows into a full localisation concern owned by a *different* team, that becomes a second actor and you'd extract a formatter then.)

### C4. Break the cross-actor shared helper (Python).

**Before — the silent-bug setup:**

```python
class Payroll:
    def _regular_hours(self, ts): ...                  # shared
    def calculate_pay(self, ts): return self._regular_hours(ts) * self.rate  # finance
    def report_hours(self, ts):  return Hours(self._regular_hours(ts))        # ops
```

**Answer — each actor owns its own computation:**

```python
class PayCalculator:      # finance actor
    def calculate_pay(self, ts): return self._payable_hours(ts) * self.rate
    def _payable_hours(self, ts): ...   # finance's overtime policy

class HourReporter:       # ops actor
    def report_hours(self, ts): return Hours(self._counted_hours(ts))
    def _counted_hours(self, ts): ...   # ops' counting rule
```

State the reasoning: the two `_…_hours` were *coincidentally* identical; sharing them coupled two actors so an ops edit would silently change pay. Duplicate-then-diverge is correct.

### C5. Is this a violation? Explain (Java).

```java
class Stack<T> {
    void push(T x) {...}  T pop() {...}  T peek() {...}
    int size() {...}      boolean isEmpty() {...}
}
```

**Answer:** **Not** a violation. Five operations, but **one** reason to change (the definition/behaviour of a stack), one actor. SRP counts reasons-to-change, not methods. Splitting this is the textbook over-application mistake.

---

## Trick Questions

### T1. "SRP means a class should have only one method." True?

**False.** SRP is about *one reason to change* (one actor), not one method. A `Stack`, a `Money` value object, a `Matrix` all have many methods and one responsibility. "One method per class" is the over-application anti-pattern that causes class explosion and shotgun surgery.

### T2. "More classes always means better SRP." Agree?

**No.** Past the *actor* boundary, more classes is *worse* — it smears one actor's logic across many files, destroying locality and causing shotgun surgery (the inverse of the god-class smell). SRP splits by *actor*; an unnecessary class is its own smell. Split by actor, then stop.

### T3. "A class that calls three other classes violates SRP." Right?

**No.** *Orchestration/delegation is itself one responsibility.* A facade or use-case that *coordinates* three single-responsibility classes has one reason to change (its workflow). The violation is *implementing* many concerns, not *delegating* to many.

### T4. "If two methods are identical, always extract a shared helper (DRY)." Correct under SRP?

**No.** If the two methods answer to *different actors*, they're *coincidentally* identical and will diverge. Sharing them couples two actors so one's edit silently breaks the other (the payroll-overpay bug). SRP says keep them apart — prefer duplication to cross-actor coupling.

### T5. "SRP has one correct answer for any given class." True?

**False.** Responsibilities are defined by your *organisation's* sources of change. The same class can be SRP-clean where one team owns both concerns and a violation where two teams drive them. SRP is context-dependent judgement, not a universal decomposition.

### T6. "Putting business logic on a model violates SRP." Agree?

**No.** A model may carry *one actor's* behaviour (the business's domain rules). The violation is mixing *actors* — adding persistence (DBA), rendering (design), or notification (infra). SRP ≠ anaemic models; the over-correction to logic-free data bags is its own mistake.

---

## Behavioral Questions

### B1. Tell me about a time you split a class that was doing too much.

**Sample:** "An `Order` model had grown `save()`, `sendConfirmation()`, `generateInvoicePdf()`, and `pushToWarehouseQueue()`. An email-templating change (infra) silently broke the invoice PDF because they shared a string-builder. I mapped each method to its actor, wrote characterization tests, and extracted `OrderConfirmationMailer`, `InvoiceRenderer`, and `WarehouseDispatcher` — leaving only domain rules and `save()` on the model. The cross-actor breakage class disappeared, and three teams stopped colliding in one file."

### B2. Describe a time mixing responsibilities caused a production bug.

**Sample:** "`calculatePay()` and `reportHours()` shared a `regularHours()` helper. Operations changed how breaks counted and edited the helper; it passed review as 'just the hours report.' It silently altered pay and we overpaid thousands of employees one cycle. The fix was to give each actor its own hour computation — they were never the same rule, just coincidentally identical. Now I treat any helper shared across two actors as a red flag."

### B3. How do you push back when a teammate piles a new concern onto an existing class?

**Sample:** "I ask one non-confrontational question: 'Who requests changes to this — is it the same team that owns the rest of this class?' If it's a different actor, I suggest routing it to (or creating) the class that actor owns, citing our place-by-actor policy so it's a standard, not my opinion. I frame it as keeping their future changes from breaking ours."

### B4. When did you decide *not* to apply SRP / not to split?

**Sample:** "A teammate wanted to split a `Pricing` class into `PriceFetcher`, `PriceRounder`, `PriceFormatter`, etc. — one method each. But they all served the finance actor and changed together. Splitting would have smeared one rule across many files and turned every tax change into shotgun surgery. I kept `Pricing` cohesive and explained that SRP splits by *actor*, not by *operation* — there was only one actor."

### B5. How do you keep a large codebase's responsibilities clean over years?

**Sample:** "Make the actor boundary the default: ban grab-bag class names, no foreign actors on models, one-PR-one-concern, and one owning team per module so code boundaries match teams (Conway). In review we ask 'who requests this change?' on every new method. We track authors-per-file and change-coupling to spot god classes forming, and we celebrate refactors that *remove* a misplaced concern as much as new features."

---

## Tips for Answering

1. **Lead with the actor framing** — "one reason to change = responsible to one actor" — it's the precise, modern statement and instantly signals depth.
2. **Debunk "do one thing" proactively** with the `Stack` counterexample; it shows you understand SRP rather than reciting it.
3. **Use the `Employee` example** (calculatePay/reportHours/save → CFO/COO/CTO) — it's the canonical illustration interviewers expect.
4. **Name the concrete bug** SRP prevents: a shared helper across two actors, where one actor's edit silently breaks the other.
5. **Show you know the limits** — over-application causes class explosion and shotgun surgery; know when *not* to split.
6. **Connect to theory if pushed** — SRP is cohesion (functional cohesion), is formalised by connascence, is the Common Closure Principle at class scale, and is Conway's Law applied to code boundaries.
7. **Mention the facade** as the way to keep a single entry point after splitting — and note that orchestration is itself one responsibility.

---

[← Professional](professional.md) · [SOLID](../README.md) · [Roadmap](../../../../README.md) · **Next:** [Open/Closed Principle](../02-ocp-open-closed/)
