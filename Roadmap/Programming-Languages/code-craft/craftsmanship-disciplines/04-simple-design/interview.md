# Simple Design — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — Kent Beck's four rules for writing code that is no more complicated than it needs to be, in strict priority order.

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

### J1. What are the four rules of simple design, in order?

**Answer:** (1) Passes all the tests, (2) Reveals intention (is clear), (3) No duplication (DRY), (4) Fewest elements (no needless classes/methods/abstractions). They come from Kent Beck.

### J2. Why is the order important?

**Answer:** It's a priority order, not a checklist of equals. When two rules conflict, the higher one wins — tests beat clarity, clarity beats DRY, and everything beats element-count.

### J3. What does "reveals intention" mean?

**Answer:** A reader can tell *what* the code does and *why* from names and structure, without tracing every line. Good names, structure that mirrors the problem, no cryptic magic numbers.

### J4. What does "no duplication" mean?

**Answer:** Each piece of *knowledge* (a rule, formula, constant) lives in exactly one place, so a change to that knowledge is made once. It's the DRY principle.

### J5. What does "fewest elements" mean, and why is it last?

**Answer:** The minimum number of classes, methods, fields, and abstractions needed to satisfy the first three rules. It's last because it's a tiebreaker — you only remove elements that aren't needed for correctness, clarity, or DRY.

### J6. What is YAGNI?

**Answer:** "You Aren't Gonna Need It" — don't build a capability until a real, present requirement demands it. It keeps Rule 4 satisfied by stopping speculative elements before they're added.

### J7. In which step of TDD do you apply simple design?

**Answer:** The **Refactor** step (the third of Red-Green-Refactor). You make the test pass (Green), then apply clarity, DRY, and minimalism with the tests guarding you.

### J8. Is "simple" the same as "short"?

**Answer:** No. Cramming logic into a dense one-liner can hurt clarity (Rule 2). Simple means the fewest *concepts* to understand, not the fewest characters.

### J9. Give an example of a needless element.

**Answer:** An interface with one implementation, a pass-through method that just forwards a call, an unused parameter, a config option nobody sets, an abstract class with one subclass.

### J10. What's the difference between simple and easy?

**Answer:** *Simple* is a property of the design (few, clear, decoupled parts). *Easy* is about effort or familiarity. Finding the simple solution is often hard work — they're not the same thing (Rich Hickey, *Simple Made Easy*).

---

## Middle Questions

### M1. When clarity and DRY conflict, which wins?

**Answer:** Clarity ("reveals intention") — it's the higher rule. A confusing-but-DRY design is harder to maintain than a clear one with a little duplication. So if the only way to remove duplication makes the code less clear, keep the duplication.

### M2. What's the rule of three?

**Answer:** Tolerate duplication on the first and second occurrence; extract the abstraction on the third. By the third case you've seen the real shape of the commonality, so the abstraction fits instead of being a guess.

### M3. What's the difference between knowledge duplication and coincidental similarity?

**Answer:** Knowledge duplication = the same rule/formula in two places (a change to one means the same change to the other) — Rule 3 targets it. Coincidental similarity = code that looks alike but encodes different decisions. Merging coincidence couples things that should be independent — a bug source. Test: *would a change to one force the same change to the other?*

### M4. What is emergent design?

**Answer:** Letting the design grow out of repeated small refactorings as real requirements appear, rather than fixing it all up front. It's design distributed across every refactor step — and it requires refactoring discipline to work.

### M5. What is speculative generality?

**Answer:** Flexibility added for a future that hasn't arrived — one-impl interfaces, unused parameters, "just in case" hooks, configurability nobody uses, over-general "Manager/Base" names. It's the named smell Rule 4 removes.

### M6. Does YAGNI mean "don't think about the future"?

**Answer:** No. You think about the future constantly; you just don't *encode* the guess in today's structure. Keeping the design simple is precisely how you stay ready for the future cheaply.

### M7. Why does emergent design require refactoring discipline?

**Answer:** Emergent design keeps the code at "simplest that works" so it can absorb the next change cheaply — but that only stays true if you actually refactor each cycle. Without the Refactor step, "emergent" is just accumulating mess.

### M8. Are rules 2 and 3 ever swapped?

**Answer:** Yes — Beck and others have listed "reveals intention" and "no duplication" in either order, and noted they're deeply intertwined. Corey Haines' reading: they form a feedback loop (naming exposes duplication; removing duplication forces naming). When they truly conflict, clarity wins.

---

## Senior Questions

### S1. Where does emergent/simple design end and up-front design begin?

**Answer:** At **reversibility.** Emergent design handles reversible decisions (internal class structure, method signatures) — cheap to refactor later. Up-front design handles irreversible "one-way doors" (public APIs, database schemas, wire protocols, crypto choices) — expensive to migrate. The art is drawing that line correctly; misapplying either kind at the wrong scale is the real failure.

### S2. When does "fewest elements" become under-engineering?

**Answer:** When the missing element forces a Rule 2 or 3 violation (collapsing classes into a mode-flag tangle), crosses a reversibility boundary (inlining a vendor seam), or denies a *present* need for variation. Rule 4 is bounded above by the higher rules and outward by reversibility — it's the weakest rule, not a license to crush necessary seams.

### S3. Why can the wrong abstraction be worse than duplication?

**Answer:** Duplication is visible, local, and cheap to fix later. The wrong abstraction is invisible coupling: as requirements diverge, you add flags/params, it becomes a maze, and it's load-bearing so it's risky to undo. Sandi Metz: "duplication is far cheaper than the wrong abstraction." The recovery is to re-introduce duplication (inline back to callers) then re-extract only genuinely shared knowledge.

### S4. What is connascence, and how does it relate to Rule 3?

**Answer:** Connascence (Page-Jones) is the precise theory of coupling: two pieces of code are connascent if changing one requires changing the other. It comes in kinds ordered by severity (name < type < meaning < position < algorithm < timing < identity). "Knowledge duplication" is just strong connascence (often connascence of meaning — the same magic value that must change together). Naming a constant *weakens* it to connascence of name. The senior reframing of Rule 3: don't "remove duplication" — *reduce connascence* (weaken, localize, lower degree).

### S5. How do simple design and SOLID relate?

**Answer:** They mostly agree (SRP/ISP are "reduce coupling / clarify intent," same as rules 2–3). The conflict is in *timing*: SOLID taught as up-front ("always program to an interface") produces speculative generality. Simple design's correction: *earn* the SOLID shape through emergence — add the interface the day a second implementation is real, not when a principle says you "should."

### S6. Justify the rule of three from first principles.

**Answer:** One occurrence tells you nothing about variation; two lets you fit infinitely many abstractions (a guess about shape); three lets you *observe* what's truly invariant vs. incidental, so the abstraction's boundary is data, not a guess. It's a defense against premature/wrong abstraction. Exception: if the knowledge is provably identical (a regulated rule duplicated verbatim), DRY it immediately — there's nothing to guess.

### S7. How do you reconcile "embrace change" with "get the architecture right"?

**Answer:** They live at different reversibility scales. Apply the four rules + refactoring aggressively to reversible internals (embrace change cheaply); reserve deliberate up-front design for one-way doors (get the irreversible foundations right). YAGNI is risk-adjusted insurance: cheap when reversal is cheap, dangerous when reversal is expensive.

---

## Professional Questions

### P1. How do you enforce simple design in code review?

**Answer:** Check the four rules in order, and push back on *additions* as hard as on bugs. The highest-value question: *"What real, present requirement makes this element necessary?"* asked of every speculative interface, flag, and layer. "It's more flexible/future-proof" is a red flag, not a justification.

### P2. What metrics actually track simplicity?

**Answer:** Cognitive complexity (SonarQube), element-count-per-feature (over-engineering trend), and change-coupling (which files change together — surfaces *real* duplication). **Not** cyclomatic-complexity-alone (blind to nesting/naming/over-abstraction) and **not** duplication-%-alone (can't tell knowledge from coincidence). The ground-truth metric is the outcome: can the team change the code quickly and safely (DORA lead time, change-failure rate)?

### P3. How do you refactor a legacy system toward simple design?

**Answer:** Characterization tests *first* (you can't satisfy Rule 1 with no tests), then apply rules 2–4 smallest-first in small commits, opportunistically as you touch files (Boy Scout Rule), and strangle over-engineered subsystems rather than big-bang rewriting. Never simplify without tests; never replace one over-engineered structure with a different one.

### P4. How do you remove a wrong, load-bearing abstraction safely?

**Answer:** Characterize all callers with tests → inline the abstraction back into each caller (temporarily more duplication, but clear) → simplify each caller independently (delete the flags it never used) → re-extract only the genuinely shared knowledge → delete the old abstraction. The intermediate duplication is intentional and correct.

### P5. How do you fight gold-plating culturally, not just technically?

**Answer:** Make YAGNI a stated team value (license to refuse speculation), and *celebrate deletions* — flip the incentive so removing an unneeded abstraction earns more respect than adding one. Reframe: simplicity is the achievement; complexity must be justified, not simplicity. Senior engineers model "simplest thing that works."

### P6. Why is reporting "cyclomatic complexity dropped" after a clarity refactor a mistake?

**Answer:** Because it usually *didn't* drop — flattening/renaming/de-abstracting doesn't change branch count. Quoting it makes the whole report suspect. Report cognitive complexity, element count, and change-coupling, which actually move with the readability win.

---

## Coding Tasks

### C1. Evolve this through the four rules (Python).

**Before** — works but obscure and over-built for one case:

```python
class GreetingStrategy:
    def greet(self, n): raise NotImplementedError
class StandardGreeting(GreetingStrategy):
    def greet(self, n): return "Hi " + n
def welcome(s: GreetingStrategy, n): return s.greet(n)
```

**After** — Rule 1 kept (same behavior), Rule 2 (clear), Rule 4 (no one-impl interface):

```python
def welcome(name):
    return f"Hi {name}"
```

The strategy interface, the impl class, and the parameter were speculative — one behavior, one caller. Reintroduce the seam if a second greeting style becomes a real requirement.

### C2. Reveal intent without changing behavior (Java).

**Before:**

```java
double f(double p, int q) { return p * q * 1.2; }
```

**After:**

```java
static final double TAX_MULTIPLIER = 1.2;   // 20% tax
double lineTotalWithTax(double unitPrice, int quantity) {
    return unitPrice * quantity * TAX_MULTIPLIER;
}
```

Names reveal what `p`, `q`, and `1.2` were; the magic number gets a single, named home.

### C3. DRY real duplication — but not coincidence (Python).

```python
# These two share a value but encode DIFFERENT rules — DON'T merge.
INVOICE_VAT_RATE = 0.20
PAYROLL_TAX_RATE = 0.20

def invoice_tax(amount): return amount * INVOICE_VAT_RATE
def payroll_tax(amount): return amount * PAYROLL_TAX_RATE

# This IS the same knowledge in two places — DO DRY it.
# before: "line = price * qty" written in 3 methods
def line_total(price, qty): return price * qty   # one home for the rule
```

State the reasoning: merge when a change to one *forces* the same change to the other; keep apart when they merely coincide.

### C4. Spot the speculative generality and remove it (Go).

**Before:**

```go
type Repo interface{ Save(o Order) error }
type SQLRepo struct{ db *sql.DB }
func (r SQLRepo) Save(o Order) error { /* ... */ return nil }
// SQLRepo is the only implementation, used in one place.
```

**After:**

```go
type SQLRepo struct{ db *sql.DB }
func (r SQLRepo) Save(o Order) error { /* ... */ return nil }
// Use SQLRepo directly. When a 2nd repo (or a test fake) is REAL,
// extract the interface then — Go's structural typing lets you add it
// later without touching SQLRepo.
```

*(Caveat to state in the interview: if you need a test double right now, the test seam is a present requirement — then the interface is justified.)*

### C5. Escape the wrong abstraction (Python).

**Before** — one "DRY" function serving three divergent callers via flags:

```python
def export(rows, fmt="csv", header=True, gzip=False, redact=()):
    data = [_redact(r, redact) for r in rows] if redact else rows
    out = _to_csv(data, header) if fmt == "csv" else _to_json(data)
    return _gz(out) if gzip else out
```

**After** — inline to clear callers; keep only genuinely shared helpers:

```python
def export_audit_csv(rows):   return _to_csv([_redact(r, PII) for r in rows], header=True)
def export_api_json(rows):    return _to_json(rows)
def export_archive_csv(rows): return _gz(_to_csv(rows, header=False))
# _to_csv / _to_json / _gz are the REAL shared knowledge; the flag soup wasn't.
```

---

## Trick Questions

### T1. "DRY is always good — remove every duplicate." True?

**False.** DRY targets duplicated *knowledge*, not duplicated *characters*. Merging coincidental similarity manufactures coupling between things that should evolve independently — a bug source. And when removing duplication hurts clarity, clarity (the higher rule) wins. The wrong abstraction is worse than duplication.

### T2. The four rules are a checklist you can satisfy in any order. Right?

**No.** They're a strict *priority* order. A lower-rule change must never break a higher rule: you don't sacrifice a passing test to remove duplication, and you don't crush a needed abstraction to win on element count.

### T3. More design patterns and interfaces = more senior code. Agree?

**No.** Speculative patterns/interfaces (one implementation, no present need) are gold-plating — Rule 4 violations. The senior move is often *removing* an abstraction. Complexity must be justified by a present requirement; simplicity is the default.

### T4. Does a clarity/de-abstraction refactor lower cyclomatic complexity?

**Usually not** — branch count is largely unchanged. It lowers *cognitive* complexity, element count, and coupling. Quoting cyclomatic complexity to "prove" a simplicity win is a classic mistake.

### T5. "We're agile, so design just emerges — no need to think about it." Correct?

**Dangerously wrong on two counts.** (1) Emergent design requires *more* ongoing thought (continuous refactoring), not less — without it you get a mud ball. (2) Emergent design applies to *reversible* decisions; irreversible one-way doors (schema, public API, protocol) still need deliberate up-front design.

### T6. Should you always extract a method the second time you see a duplicate?

**No — default to the rule of three.** Two occurrences don't show you the abstraction's real shape; extracting then risks the wrong abstraction. Exception: if the knowledge is provably identical (a regulated rule), DRY immediately.

---

## Behavioral Questions

### B1. Tell me about a time you removed complexity from a system.

**Sample:** "We had an internal 'rules engine' — generic, configurable, plugin-based — running about five business rules all written by our own team. It was thousands of lines; the rules were a couple hundred. I rewrote the rules as plain functions and deleted the engine. 'Add a rule' went from a multi-day task to minutes. The lesson I quote now: flexibility you don't use is pure cost — we'd gold-plated for an extensibility that never arrived."

### B2. Describe a time a DRY refactor went wrong.

**Sample:** "I merged two `calculateFee` methods that looked identical — but one rounded half-up and the other half-even, a regulatory difference nobody had documented. The merged version mis-rounded thousands of transactions. I learned to ask *would a change to one force the same change to the other?* before merging — coincidental similarity isn't duplication — and to pin behavior with characterization tests first."

### B3. How do you push back when a teammate over-engineers a solution?

**Sample:** "I ask one non-confrontational question: 'What present requirement makes this element necessary?' If the answer is 'we might need it later,' I suggest the concrete version now and adding the seam when the need is real — citing our YAGNI policy so it's a standard, not my opinion. I frame deletion as the senior move, not as criticism."

### B4. When did you decide *not* to simplify something?

**Sample:** "A teammate wanted to inline our persistence calls into the domain 'for fewer elements.' I pushed back: storage is a one-way door — a future migration would be brutal if it's entangled everywhere. YAGNI applies to reversible decisions; that boundary was irreversible, so keeping the repository seam was the *simpler* choice in the sense that matters — fewest elements that still passes rules 1–3 *and* survives the foreseeable irreversible change."

### B5. How do you keep a large codebase simple over years?

**Sample:** "Make the simple path the default: YAGNI as written policy, rule-of-three for extraction, no one-impl interfaces, a cognitive-complexity gate (not cyclomatic), and — culturally — we celebrate net-negative-LOC PRs. Complexity enters one reasonable-looking PR at a time, so the defense is at review: every new abstraction must cite a present requirement."

---

## Tips for Answering

1. **Lead with the four rules in order**, and stress that the order is a *priority* (higher beats lower).
2. **Nail the rules-2-vs-3 nuance:** they reinforce each other; when they conflict, clarity wins.
3. **Distinguish knowledge duplication from coincidence** — the senior signal for Rule 3 (and mention connascence if pushed).
4. **Quote "the wrong abstraction is worse than duplication"** and the escape (inline, then re-extract).
5. **Tie emergent design to reversibility:** YAGNI for reversible, up-front for one-way doors.
6. **Say "simple ≠ easy" and "simple ≠ simplistic"** — they're the classic distinctions.
7. **For metrics, name cognitive complexity, not cyclomatic.**

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
