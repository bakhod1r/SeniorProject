# Connascence — Interview Questions

> **Category:** [Design Principles](../../README.md) — a precise vocabulary for the *kinds* and *strengths* of coupling, so you can reason about it instead of just sensing it.

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

### J1. Define connascence in one sentence.

**Answer:** Two components are connascent if a change in one would require a change in the other to maintain the overall correctness of the system. (Meilir Page-Jones.) It's a precise vocabulary for coupling — it names the *kind* and measures the *strength*.

### J2. List the five static forms of connascence, weakest to strongest.

**Answer:** **Name (CoN) → Type (CoT) → Meaning/Convention (CoM) → Position (CoP) → Algorithm (CoA).** Static means visible by reading the code.

### J3. List the four dynamic forms.

**Answer:** **Execution (order) → Timing → Value → Identity.** Dynamic means visible only at runtime, and these are generally stronger than the static forms.

### J4. What is Connascence of Meaning, and how do you weaken it?

**Answer:** Two components must agree on the meaning of a value that isn't named — a magic number or magic string (e.g. `status == 1` meaning "active"). Weaken it to **Connascence of Name** by introducing a named constant or enum (`Status.ACTIVE`), so the convention is explicit and lives in one place.

### J5. What's the difference between Connascence of Name and Connascence of Position?

**Answer:** CoN means components agree on a *name* (the weakest, fine to have everywhere — a rename tool fixes it). CoP means they agree on an *order* of values (positional arguments); it's stronger because mis-ordering compiles, runs, and fails silently. You weaken CoP to CoN with named/keyword arguments or a parameter object.

### J6. Why is Connascence of Name the *weakest* form — and why don't you try to remove it?

**Answer:** It's weakest because the agreement is explicit and mechanically refactorable (rename everything atomically). You don't remove it because every cooperating piece of code shares at least a name — it's the form all stronger forms should be refactored *into*, not eliminated.

### J7. Why is Connascence of Meaning stronger than Connascence of Type?

**Answer:** Type connascence is usually checked by the compiler and visible in signatures; meaning connascence is an *invisible convention* that nothing enforces, so a change to it silently breaks distant code.

### J8. Can you ever reduce connascence to zero?

**Answer:** No, and you shouldn't try. Any two cooperating components agree on at least a name (CoN), which is cheap and good. The goal is *weaker, more local, lower-degree* connascence — not zero.

### J9. Give a quick refactoring that lowers connascence.

**Answer:** Replace a magic number with a named constant — that converts Connascence of Meaning into Connascence of Name (CoM → CoN). Or replace positional arguments with a parameter object (CoP → CoN).

### J10. What does "static" vs. "dynamic" connascence mean?

**Answer:** Static forms are visible by *reading the source* (names, types, argument order, shared algorithms). Dynamic forms appear only when the code *runs* (execution order, timing, shared values that must stay in sync, shared object identity). Dynamic forms are generally stronger because you can't catch them by inspection.

---

## Middle Questions

### M1. Name the three properties for evaluating connascence, and what each measures.

**Answer:** **Strength** — how hard the connascence is to discover and refactor (the weak→strong ladder). **Degree** — how many components are entangled. **Locality** — how close together the connascent components are (same scope → across services). You rank an instance by all three, not strength alone.

### M2. State Page-Jones's three guidelines in order.

**Answer:** (1) **Minimise overall connascence** by breaking the system into encapsulated elements. (2) **Minimise the connascence that crosses encapsulation boundaries.** (3) **Maximise the connascence within a boundary** — the rule of locality.

### M3. Why is strong-but-local connascence often *better* than weak-but-distant connascence?

**Answer:** Locality multiplies risk. Local connascence is visible, changeable in one edit, and maintained together. Distant connascence is invisible at each end, evolves independently, and breaks silently. Splitting strong-but-local connascence apart just turns it into strong-but-distant — strictly worse. That's the point of Guideline 3.

### M4. How does connascence sharpen DRY?

**Answer:** DRY stated as "don't repeat *text*" wrongly merges code that only *looks* alike. Connascence restates real duplication as *high-strength connascence* — the same knowledge that must change together. The test: **"would a change to one force the same change to the other?"** Yes → DRY it. No → it's coincidental similarity; merging it manufactures coupling.

### M5. You see `chargeCard(token, 4999, "gbp", true)` called across a module boundary. Diagnose and fix it.

**Answer:** **Connascence of Position** (argument order is load-bearing) made dangerous by **locality** — it crosses a module boundary, so the contract is invisible at the call site. Fix: pass a named/structured request object (`ChargeRequest{...}`) → converts CoP to CoN.

### M6. How do you weaken Connascence of Execution?

**Answer:** Make the illegal order *unrepresentable* — bundle the ordered steps so the wrong order can't be expressed (e.g., return a connected handle that only then exposes `query()`, or require the first step's result as a constructor argument to the second). Don't rely on a "call X first" comment.

### M7. When should you *not* weaken connascence?

**Answer:** When it's already weak and local (don't add a parameter object to a two-arg local helper); when weakening hurts clarity; when the components genuinely belong together (strong local connascence inside a cohesive class is correct — Guideline 3); or when it's coincidental similarity (there's no connascence to remove).

---

## Senior Questions

### S1. How does connascence unify and refine the classic coupling taxonomy?

**Answer:** The classic taxonomy (content/common/control/stamp/data) describes coupling between *modules* in coarse bands with no refactoring operation. Connascence generalises it: every classic relationship is a *kind* of connascence (content ≈ Identity/Value; control ≈ Meaning + Algorithm; data ≈ Name/Type/Position), the ordering is preserved (content worst → strongest; data best → weakest), and connascence *also* names couplings the classic taxonomy couldn't — Connascence of Algorithm and the whole dynamic family. Classic coupling is connascence at low resolution.

### S2. In what sense does connascence give refactoring a *direction*?

**Answer:** Before connascence, "reduce coupling" was a goal without an operation. Connascence defines "better" as a vector along three axes: **weaker strength, greater locality, lower degree.** Every coupling refactoring is a directed move along that vector — weaken the form (CoA→CoN, CoP→CoN, CoM→CoN) or, when you can't weaken it (a client/server contract), localise it (shared schema, single owner). That directedness is why connascence is a better *reasoning* tool than symptom-level heuristics like DRY or Demeter.

### S3. How do connascence, cohesion, and SRP relate?

**Answer:** They're the same idea at different angles. **Cohesion** is Guideline 3 stated positively — strongly-connascent things kept local. **SRP** ("one reason to change") means the connascence to each change-driver is contained in one element, so a change touches one place. **Law of Demeter** caps the *degree and locality* of connascence (a long `a.b().c().d()` chain makes you connascent with three types' structures). Connascence is the substrate those principles are special cases of.

### S4. Why is dynamic connascence the dominant concern in distributed systems?

**Answer:** Across a network you *cannot* make execution order, timing, or identity structural — the things that localise dynamic connascence in a monolith are unavailable. So microservice design *is* connascence management: you defend cross-service Connascence of Execution with sagas/idempotency, Timing with idempotent ops and event ordering, and Identity with shared stable IDs (UUIDs, correlation keys) instead of object references. A service boundary drawn through *strong* connascence is a bad boundary — it'll drift.

### S5. Give the architectural rule connascence implies about service boundaries.

**Answer:** **A strong form of connascence must never span a service boundary.** Two services sharing an algorithm (e.g., "compute the total") or a meaning (a magic status code) have a hidden, undeclared contract that *will* drift silently. Either weaken it to a named, versioned contract (CoA → CoN via a single owner both call) or keep the connascent logic inside one service (Guideline 3 at architectural scale).

### S6. What are the limits of connascence as a theory?

**Answer:** It's an *analysis lens, not a fully automatable metric* — tools can flag CoP and CoM but can't tell real connascence from coincidental similarity (that needs the domain "would changing one force the other?"). The strength ladder is a heuristic, not a total order (a high-degree CoP can beat a benign CoExecution). Weakening connascence costs elements, so it's bounded by YAGNI. And some strong connascence is correct and irreducible (a `Money(amount, currency)` *should* be strongly connascent internally) — the theory says minimise *across* boundaries, maximise *within*.

---

## Professional Questions

### P1. How do you use connascence in code review?

**Answer:** Name three things in the comment: the **form**, the **property** that makes it risky (usually locality or degree), and the **weaker target form**. e.g., "This is Connascence of Position across a module boundary — pass a request object so it becomes Connascence of Name." Naming the form depersonalises the critique and cites a standard instead of a preference, so coupling discussions get shorter and more decisive.

### P2. What metric best tracks *real* connascence, and why not textual duplication?

**Answer:** **Change-coupling / co-change analysis** from git history — files that repeatedly change together are *empirically* connascent, a signal no static text-matcher can produce. Textual-duplication-% is unreliable: a high score may be coincidental similarity that must *not* be merged; a low score can hide strong Connascence of Meaning or Algorithm the tool can't see. No tool decides "real vs. coincidental" — that needs the domain question. Ground truth is the outcome: does a small change force edits across many files?

### P3. How do you refactor a legacy system toward weaker connascence?

**Answer:** Find the worst first (strong × high-degree × cross-boundary, via change-coupling analysis), characterise behavior with tests — *especially order/timing for dynamic forms, which are invisible in diffs* — then weaken in priority order in small commits (CoM→named constants, CoP→parameter objects, cross-boundary CoA→single owner), localise what you can't weaken (Guideline 3), and do it opportunistically as you touch files (Boy Scout Rule), never as a big-bang project.

### P4. A team promises to "keep two services' total calculations in sync by being careful." What do you say?

**Answer:** That's cross-service Connascence of Algorithm — a strong form spanning a boundary. Human discipline doesn't hold it; the copies *will* drift the moment one side changes (and the failure is silent — wrong money). The structural fix is one owner of the algorithm that both call (CoA → CoN), with a contract test. Don't accept a discipline answer to a structural problem.

### P5. How do you prevent the classic "DRY refactor that flipped a behavior" incident?

**Answer:** Gate every "merge these duplicates" change behind the connascence test: *would a change to one force the same change to the other?* If no, the similarity is coincidental — merging manufactures coupling between things that should evolve independently (the half-up vs. half-even rounding incident). Make this the team's written DRY rule, and require characterization tests pinning *both* behaviors before any merge.

### P6. What team conventions encode good connascence practice?

**Answer:** No strong form (Meaning/Position/Algorithm) crossing a boundary; magic values named at boundaries; positional arg lists capped and never cross-boundary; one owner per shared algorithm; execution-order requirements structural (constructor/type), never a comment; and the connascence test as the official DRY test. These turn senior reasoning into the default path so reviewers cite policy, not taste.

---

## Coding Tasks

### C1. Weaken the strongest connascence (Python).

**Before** — Connascence of Position, cross-boundary, plus a magic flag (CoM):

```python
create_shipment("A1", "09:00", "17:00", 2)   # what is 2? what's the order?
```

**After** — CoP → CoN and CoM → CoN:

```python
class Priority:        # name the meaning (CoM → CoN)
    STANDARD = 1
    EXPRESS  = 2

create_shipment(       # name the positions (CoP → CoN)
    origin="A1",
    open_time="09:00",
    close_time="17:00",
    priority=Priority.EXPRESS,
)
```

State the diagnosis: positional order was load-bearing and `2` was a hidden convention; both are now Connascence of Name.

### C2. Eliminate Connascence of Value (TypeScript).

**Before** — `area` must be hand-synced with `width`/`height` (CoV):

```typescript
class Rect { constructor(public w: number, public h: number, public area: number) {} }
const r = new Rect(10, 5, 50);   // change w/h, forget area → silently wrong
```

**After** — derive it; the invariant can't be violated:

```typescript
class Rect {
  constructor(public w: number, public h: number) {}
  get area() { return this.w * this.h; }   // always correct, no sync needed
}
```

### C3. Make Connascence of Execution structural (Python).

**Before** — order required, enforced only by convention:

```python
p = Parser()
p.set_source(text)   # MUST run first; nothing enforces it
result = p.parse()   # fails silently if skipped
```

**After** — wrong order becomes unrepresentable:

```python
result = Parser(text).parse()   # you can't parse without a source
```

### C4. Decide whether to DRY (Python) — the connascence test.

```python
def invoice_vat(amount):  return amount * 0.20
def payroll_levy(amount): return amount * 0.20
```

**Answer:** Ask *"if the VAT rate changes to 0.21, must the payroll levy also change?"* **No** — they're different rules sharing a value by coincidence. There is **no connascence** here; merging them into one `tax(amount)` would *manufacture* Connascence of Meaning between independent rules. **Don't DRY.** Name them separately (`INVOICE_VAT_RATE`, `PAYROLL_LEVY_RATE`) so each can change alone.

### C5. Kill cross-service Connascence of Algorithm (pseudocode).

**Before** — two services each compute the total (CoA across a boundary; will drift):

```text
checkout:   total = sum(line) * (1 - LOYALTY) + SHIPPING
invoicing:  total = sum(line) * (1 - LOYALTY)            # missing shipping — drift!
```

**After** — one owner; both call it (CoA → CoN across the boundary):

```text
pricing-service: computeTotal(orderId)   # single source of the computation
checkout  → pricing.computeTotal(orderId)
invoicing → pricing.computeTotal(orderId)
```

State: a strong static form (Algorithm) must never span a service boundary — give it one owner.

---

## Trick Questions

### T1. "Less coupling is always better, so minimise *all* connascence." True?

**False.** You can't reach zero (cooperating code shares at least a name), and you shouldn't want to. Page-Jones's actual rule is to minimise connascence *across boundaries* and **maximise** it *within* a boundary (Guideline 3). Strong connascence kept local — like `Money(amount, currency)` — is correct, not a defect.

### T2. "These two methods are identical, so DRY them." Right?

**Not necessarily.** Identical *text* isn't connascence. Apply the test: would a change to one force the same change to the other? If no, the similarity is coincidental and merging manufactures coupling between things that should evolve independently — a classic incident source (e.g., two fee rules sharing a rate today).

### T3. "It's only Connascence of Name, so it's harmless." Always?

**No.** Strength is one of *three* axes. A public API method name is Connascence of Name at *maximal degree and maximal-distance locality* — renaming it is a breaking change across every external caller. Weak-but-high-degree-and-distant can be a versioning event. Never read strength off the ladder alone.

### T4. Is dynamic connascence always worse than static connascence?

**Generally, but not by rule.** Dynamic forms are stronger because they're invisible in the source. But a high-degree, cross-boundary Connascence of Position can be more dangerous than a benign, local Connascence of Execution. Rank by *strength × degree × locality*, not by the static/dynamic label alone.

### T5. "We made it a microservice, so it's loosely coupled now." Correct?

**No — a boundary can hide *strong* connascence.** If two services share an algorithm or a synchronized invariant, you've created *distributed, undeclared, drifting* connascence — worse than the monolithic version. "Loosely coupled services" specifically means *weak, low-degree connascence across the boundary, and no dynamic connascence the network can silently break.* Drawing the boundary through strong connascence is the mistake.

### T6. "A connascence linter flagged duplication, so I'll merge it." Sound?

**Unsafe.** Tools detect *textual* patterns; they cannot tell real connascence from coincidence — that needs the domain question. Trusting the linter to auto-merge reproduces the over-DRY incident at scale. Keep a human applying the connascence test.

---

## Behavioral Questions

### B1. Tell me about a time you reduced coupling in a system.

**Sample:** "Two services each computed order totals — cross-service Connascence of Algorithm. They matched until a promo feature landed in one and not the other, so customers were charged a discounted total but invoiced the full amount. I moved the calculation into a single pricing service both called, added a contract test, and the drift class of bug disappeared. The lesson I quote: a strong form like Algorithm must never span a service boundary — give it one owner."

### B2. Describe a time a DRY refactor went wrong.

**Sample:** "I merged two `calculateFee` methods that looked identical — but one rounded half-up and the other half-even, a regulatory difference nobody had documented. There was no real connascence; the similarity was coincidental, and the merge mis-rounded thousands of transactions. I learned to gate every 'merge duplicates' on the connascence test — *would a change to one force the same change to the other?* — and to pin both behaviors with characterization tests first."

### B3. How do you push back when a teammate writes coupling you think is risky?

**Sample:** "I name it precisely instead of saying I dislike it: 'This is Connascence of Position across a module boundary — the order's invisible at the call site and will break silently. Can we pass a request object so it's Connascence of Name?' Naming the form and the weaker target makes it a technical standard, not a personal critique — discussions get shorter and nobody feels judged."

### B4. When did you decide *not* to decouple something?

**Sample:** "A teammate wanted to split a `Money` type's amount and currency into separate fields 'to reduce coupling.' I pushed back: they're strongly connascent by design — you can't change one meaningfully without the other — and that connascence is *local* inside `Money`, which is exactly where strong connascence belongs (Page-Jones's rule of locality). Splitting them would have turned safe local coupling into scattered, error-prone coupling. Keeping them together was the lower-coupling choice in the sense that matters."

### B5. How do you keep coupling under control on a large team over years?

**Sample:** "Make the weak-and-local path the default: written conventions (no strong form across a boundary, one owner per algorithm, magic values named, order enforced structurally), the connascence test as our official DRY rule, and change-coupling analysis in CI to catch files that keep changing together across boundaries. Coupling enters one reasonable PR at a time, so the defense is at review — and connascence gives everyone the same words to point at it."

---

## Tips for Answering

1. **Lead with the precise definition** (Page-Jones: change one → must change the other to stay correct) and that connascence names the *kind* and measures the *strength* of coupling.
2. **Recite both ladders in order:** static **Name → Type → Meaning → Position → Algorithm**; dynamic **Execution → Timing → Value → Identity** (generally stronger).
3. **Name the three properties** — strength, degree, locality — and stress that you rank by all three, never strength alone.
4. **Quote Page-Jones's three guidelines**, especially Guideline 3 (maximise connascence *within* a boundary) — it's the most misunderstood.
5. **Give a refactoring with a *direction*:** CoP→CoN, CoM→CoN, CoA→single owner — "weaker, more local, lower degree."
6. **Distinguish real connascence from coincidental similarity** with the one-question test — the senior signal for DRY.
7. **For systems, say "microservice design is connascence management"** and "a strong form must not cross a boundary."

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)
