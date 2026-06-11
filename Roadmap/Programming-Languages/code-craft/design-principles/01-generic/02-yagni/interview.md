# YAGNI (You Aren't Gonna Need It) — Interview Questions

> **Category:** [Design Principles](../../README.md) — don't build a capability until a real, present requirement demands it.

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

### J1. What does YAGNI stand for, and what does it say?

**Answer:** "You Aren't Gonna Need It." Build a capability **when a real, present requirement needs it, not when you merely foresee you might need it.** It's a rule about *timing*. The XP phrasing: *"Always implement things when you actually need them, never when you just foresee that you need them."*

### J2. Where does YAGNI come from?

**Answer:** **Extreme Programming** (Kent Beck, Ron Jeffries), late 1990s. It's an expression of XP's *"do the simplest thing that could possibly work."*

### J3. Give three examples of things YAGNI tells you not to build yet.

**Answer:** A config option nobody asked for; an interface with one implementation; a "we might need a plugin system" framework with one plugin; an unused parameter/flag; infrastructure for imagined scale.

### J4. Is YAGNI an excuse to write sloppy code?

**Answer:** **No.** YAGNI is about *presumptive features*, not *current quality*. Clean code, good names, tests, and modularity are **present requirements** — YAGNI never trims them. It only stops you building for a future that isn't here.

### J5. How do YAGNI and refactoring relate?

**Answer:** They're **partners.** YAGNI keeps the design simple *now*, which is only a safe bet *because* refactoring makes "add it later" cheap. If adding later were expensive, YAGNI would be reckless — refactoring is what makes it smart.

### J6. What's the one question that tests for a YAGNI violation?

**Answer:** *"What real, present requirement makes this necessary?"* If the answer is "we might need it later," it's a YAGNI violation — cut it and add it when the need is real.

### J7. What is the rule of three?

**Answer:** Tolerate the first and second occurrence; extract the abstraction on the **third**. By the third case you've *observed* the real shared shape instead of *guessing* it. It's YAGNI applied to abstractions.

### J8. Why is building "just in case" usually wasteful?

**Answer:** Because requirements shift, so the guess is usually wrong; the speculative code still has to be read, maintained, and tested in the meantime; and when the real need arrives it rarely matches the guess, so you refactor *away* from the speculation first — slower than building nothing.

---

## Middle Questions

### M1. What are the four costs of a presumptive feature?

**Answer (Martin Fowler):** **Cost of build** (effort now), **cost of carry** (it drags on every future change near it), **cost of delay** (real features you didn't build instead), and **cost of repair** (if you guessed the shape wrong, unwind it then build the right thing). Carry and delay are paid *regardless* of whether the guess was right.

### M2. "It's cheaper to build it now while I'm in here." Rebut it.

**Answer:** That argument counts only the cost of build and ignores cost of *carry* (drag on every future change) and cost of *delay* (postponed real work) — both paid whether or not the guess is right. And since requirements shift, the guessed *shape* is usually wrong, adding cost of *repair*. Even if you *do* eventually need it, building early is usually a net loss.

### M3. YAGNI says "don't build for the future"; OCP says "build extension points ahead of need." Reconcile them.

**Answer:** They operate at different **reversibility scales**. OCP is *retrofittable* for cheap internal seams, so YAGNI wins — add the extension point the day the second variation is real. OCP becomes an *up-front* obligation only at **one-way doors** (public API, schema, protocol), where you can't retrofit without breaking clients. So most of the time YAGNI wins; at one-way doors anticipation wins.

### M4. What's the reversibility test for YAGNI vs. anticipation?

**Answer:** **Cheap to add the seam later → wait (YAGNI). Expensive/irreversible to add it later → invest early.** Reversibility, not certainty about the future, is the deciding factor.

### M5. Does YAGNI mean "don't think about the future"?

**Answer:** No. You think about it constantly; you just don't *encode* the guess in today's structure. Noting "SMS is probably coming" in a ticket is fine — shipping the `NotificationChannel` interface today is the violation.

### M6. Why isn't the *second* occurrence enough to justify an abstraction?

**Answer:** Two occurrences show one axis of similarity, but a two-point line fits infinitely many curves — extracting bakes in a guess about the abstraction's *shape*. The third case reveals what's truly invariant vs. incidental, so the boundary is observed, not guessed.

### M7. How is "avoid premature optimization" related to YAGNI?

**Answer:** It's a **special case** of YAGNI applied to performance: don't build speed (caches, indexes, sharding) ahead of a *measured* need. "You aren't gonna need that performance yet."

---

## Senior Questions

### S1. When is YAGNI the *wrong* rule to apply?

**Answer:** At **one-way doors** — decisions expensive or impossible to reverse: public/published APIs, data schemas with live data, wire protocols, security/crypto choices, user-visible identifiers. Deferring those isn't YAGNI, it's negligence, because *deferring is itself the expensive choice* once data is written or clients consume the contract.

### S2. Explain "the last responsible moment" and how it relates to YAGNI.

**Answer:** Defer a decision until *not* deciding would foreclose important options, then decide (Lean / Poppendieck). YAGNI is the same idea from the build side. They diverge at one-way doors: the last responsible moment for a *reversible* decision is **late** (YAGNI's domain), but for an *irreversible* one it's **soon**, because deferring shuts the door. Misapplying YAGNI to a one-way door means blowing past the last responsible moment.

### S3. Why is the *wrong abstraction* worse than duplication, and how does that justify YAGNI?

**Answer:** Sandi Metz: "duplication is far cheaper than the wrong abstraction." Speculation that guesses the shape wrong becomes a flag-ridden maze that's load-bearing and risky to undo — more expensive than the duplication it replaced. YAGNI's deepest justification is that **deferring until you have concrete cases lets you build the *right* abstraction the first time**, skipping the death spiral. Recovery from a wrong abstraction is to re-introduce duplication (inline to callers), then re-extract only genuinely shared knowledge.

### S4. How do you reconcile YAGNI with "Encapsulate What Changes"?

**Answer:** Encapsulate what *is* changing (or what's cheap to wrap, or what's irreversible) — not what you *predict* will change. "Likely to change" is a guess about shape, usually wrong. For reversible internal code, the seam is retrofittable, so YAGNI defers it until the variation is real. For one-way doors, encapsulation becomes an up-front obligation.

### S5. Give a concrete case where applying YAGNI backfires.

**Answer:** Inlining persistence calls throughout the domain "to keep it simple" instead of behind a repository seam. Storage is a one-way door; when a migration is forced, storage shape has leaked into hundreds of files and a swap-behind-an-interface becomes a multi-month rewrite. The repository seam wasn't speculation — it served a present need (testability) *and* guarded an irreversible decision.

---

## Professional Questions

### P1. How do you enforce YAGNI in code review?

**Answer:** Ask of every added element: *"What real, present requirement forces this?"* — "we might need it later" means cut it. Then the paired question: *"Is this reversible? If not, is the seam justified?"* — so you don't wave through under-engineering at a one-way door. Both questions catch over- *and* under-engineering.

### P2. How do you fight gold-plating culturally, not just technically?

**Answer:** Make YAGNI a stated team value (license to refuse speculation by policy, not opinion) and **celebrate deletions** — flip the incentive so removing an unneeded abstraction earns more respect than adding one. Reframe: simplicity is the achievement; *complexity* must be justified, not simplicity. Seniors model "simplest thing that works."

### P3. How do you remove a speculative, load-bearing abstraction from legacy code safely?

**Answer:** Characterization tests first → inline the abstraction into each caller (temporarily more duplication, but clear) → simplify each caller independently (delete flags it never used) → re-extract only genuinely shared knowledge → delete the old abstraction. *But* first run the reversibility gate: confirm the "speculative" seam isn't actually guarding a one-way door or a test seam.

### P4. A teammate wants to delete an "unused" interface to simplify. What do you check first?

**Answer:** Reversibility and present need. Is it the seam our tests mock (present requirement)? Does it localize a one-way door — persistence, a published-API adapter, a protocol (irreversible)? If either, keep it; it isn't speculation. YAGNI removes *guesses*, not seams that serve a present need or guard an irreversible boundary.

### P5. How do you keep a large codebase free of speculation over years?

**Answer:** Make the lean path the default: YAGNI as written policy, no one-impl interfaces in new code (test seams excepted), rule-of-three for extraction, a reversibility gate on "simplifications," domain-named (not `Manager`/`Generic`) abstractions, and — culturally — celebrate net-negative-LOC PRs. Speculation enters one reasonable-looking PR at a time, so the defense is at review.

---

## Coding Tasks

### C1. Remove the speculation (Python).

**Before** — built for channels, templates, and retries nobody asked for:

```python
class NotificationChannel(ABC):
    @abstractmethod
    def send(self, recipient, message): ...

class EmailChannel(NotificationChannel):
    def send(self, recipient, message): ...

class NotificationService:
    def __init__(self, channels, templates, retry_policy): ...
    def send_receipt(self, order, channel="email"): ...
```

**After** — the requirement is "email a receipt":

```python
def send_receipt(order):
    body = f"Thanks! You paid ${order.total}."
    email.send(to=order.email, subject="Receipt", body=body)
```

State the reasoning: one channel, one message, one caller — every other element is speculative. Add the channel abstraction the day a *second* channel is a real requirement, shaped by two concrete cases.

### C2. Drop the unused "flexibility" parameter (Java).

**Before:**

```java
double total(List<Item> items, String currency, boolean applyTax, Locale locale) {
    // currency, applyTax, locale are ALWAYS "USD", true, US — pure speculation
    return items.stream().mapToDouble(Item::lineTotal).sum() * 1.0;
}
```

**After:**

```java
double total(List<Item> items) {
    return items.stream().mapToDouble(Item::lineTotal).sum() * (1 + TAX_RATE);
}
```

The placeholder parameters did nothing; multi-currency, when it's a real requirement, gets built with real knowledge of currency handling.

### C3. Earn the interface; don't speculate it (Go).

**Before:**

```go
type PaymentGateway interface{ Charge(amt Money) (Receipt, error) }
type StripeGateway struct{ /* ... */ }   // the ONLY implementation
func (s StripeGateway) Charge(amt Money) (Receipt, error) { /* ... */ }
```

**After:**

```go
type StripeGateway struct{ /* ... */ }
func (s StripeGateway) Charge(amt Money) (Receipt, error) { /* ... */ }
// Use StripeGateway directly. When a 2nd gateway is REAL, extract the
// interface then — Go's structural typing lets you add it without
// touching StripeGateway.
```

*Caveat to state:* if a test needs to mock the gateway **now**, that's a present requirement and the interface is justified.

### C4. The trap — don't apply YAGNI to a one-way door (Python).

**Tempting "YAGNI" version** (wrong):

```python
class OrderHandler:
    def place(self, cmd):
        order = Order.create(cmd)
        db.execute("INSERT INTO orders(...) VALUES (...)", ...)   # storage leaks everywhere
        return order
```

**Correct** — the seam serves a present need (testability) and guards an irreversible decision (storage):

```python
class OrderRepository(Protocol):
    def save(self, order: Order) -> None: ...

class OrderHandler:
    def __init__(self, repo: OrderRepository):
        self._repo = repo
    def place(self, cmd):
        order = Order.create(cmd)
        self._repo.save(order)          # storage shape localized behind one seam
        return order
```

State the reasoning: persistence is a one-way door; "fewest elements" was the wrong rule there. This seam is the fewest elements that still survives the foreseeable irreversible change.

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

### T1. "YAGNI means write less code / write sloppy code." True?

**False.** YAGNI is about *presumptive features*, not *current quality*. Clean code, names, tests, and modularity are present requirements and are never trimmed. A clear ten-line function can be *more* YAGNI-compliant than a cryptic three-line one with a speculative flag.

### T2. "If you're sure you'll need it, build it now." Right?

**No — certainty about *existence* isn't certainty about *shape*, and it's the shape you'd be guessing.** Near-certainty a second case is coming still usually loses to YAGNI: defer until the concrete case pins the shape. The one exception is a one-way door, where deferral is itself expensive.

### T3. "OCP and YAGNI contradict each other, so one must be wrong." Agree?

**No.** They operate at different reversibility scales. OCP is retrofittable for cheap internal seams (YAGNI wins) and an up-front obligation at one-way doors (anticipation wins). No contradiction once you condition on reversibility.

### T4. "YAGNI says never add an interface with one implementation." Always?

**No.** A one-impl interface is justified when a *present* requirement forces it — most commonly a **test seam** (you need to mock it now) or a **one-way-door boundary** (persistence, a published-API adapter). YAGNI forbids *speculative* interfaces, not all of them.

### T5. "We're lean, so design just emerges — no need to think about irreversible decisions." Correct?

**Dangerously wrong.** YAGNI applies to *reversible* decisions. One-way doors (schema, public API, protocol, security) demand deliberate up-front design — deferring them is the most expensive mistake in the topic, not leanness.

### T6. "Building a scalable architecture before launch is just being responsible." True?

**Usually false.** Building for imagined scale is YAGNI's costliest violation: it pays the cost of *delay* (you ship late, maybe never) for performance you can't yet measure a need for. Build for current load; the scaling problem is one you *earn* by finding users. (Avoid premature optimization.)

---

## Behavioral Questions

### B1. Tell me about a time you removed speculative complexity.

**Sample:** "We had an internal 'rules engine' — generic, configurable, plugin-based — running about five business rules, all written by our own team. It was thousands of lines; the rules were a couple hundred. I rewrote the rules as plain functions and deleted the engine. 'Add a rule' went from a multi-day task to minutes. The line I quote now: *flexibility you don't use is pure cost* — we'd gold-plated for an extensibility that never arrived."

### B2. Describe a time anticipating the future was the right call.

**Sample:** "A teammate wanted to inline persistence into the domain 'for fewer elements.' I pushed back: storage is a one-way door — a forced migration would be brutal if it's entangled everywhere, and we *already* needed the seam to mock storage in tests. So we kept the repository interface. A year later a compliance migration landed behind that one seam instead of across 200 files. YAGNI is for reversible decisions; that boundary was irreversible."

### B3. How do you push back when a teammate over-engineers?

**Sample:** "One non-confrontational question: *'What present requirement makes this element necessary?'* If the answer is 'we might need it later,' I suggest the concrete version now and adding the seam when the need is real — citing our YAGNI policy so it's a standard, not my opinion. I frame deletion as the senior move, not as criticism."

### B4. Tell me about a time a 'just in case' addition caused a problem.

**Sample:** "Someone added a `legacy_mode` flag 'in case we need the old behavior.' Over three years it accreted 40 half-tested branches and one customer silently depended on it, so it couldn't be removed. I learned that an unused config option isn't free optionality — it's a liability that accretes branches. Now I build the one behavior needed and add a flag only when a real second behavior exists."

### B5. How do you keep a team from drifting into over-engineering?

**Sample:** "Make the lean path the default: YAGNI as written policy, no one-impl interfaces in new code (test seams excepted), rule-of-three for extraction, a reversibility check before deleting *or* adding a seam, and culturally we celebrate net-negative-LOC PRs. Speculation enters one reasonable PR at a time, so the defense is at review — every new abstraction has to cite a present requirement."

---

## Tips for Answering

1. **Lead with the timing framing:** *build it when you need it, not when you foresee you might.* Cite XP / Beck / Jeffries.
2. **Nail the biggest nuance:** YAGNI is about *presumptive features*, **not** an excuse to skip design, tests, or refactoring — those are present requirements.
3. **Quote Fowler's four costs** (build, carry, delay, repair) to rebut "it's cheap to build now."
4. **Resolve the OCP/Encapsulate tension on reversibility:** retrofittable seams → wait; one-way doors → invest early.
5. **Say "YAGNI and refactoring are partners"** — staying simple now is safe *because* adding later is cheap.
6. **Know when YAGNI backfires:** one-way doors (schema, public API, protocol, security) and scheduled near-term needs.
7. **Mention the rule of three** and that "avoid premature optimization" is YAGNI for performance.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)
