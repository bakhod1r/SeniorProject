# Optimize For Deletion — Interview Questions

> **Category:** [Design Principles](../../README.md) — write code that is *easy to delete*, not code that is easy to extend, because most change is deletion or replacement.

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

### J1. State the principle in one sentence and name its source.

**Answer:** *Write code that is easy to delete, not easy to extend.* It's the title of tef's essay (programmingisterrible.com, 2016). The reasoning: most change is removing or replacing code, so deletability is the property that makes change cheap.

### J2. Why does "easy to delete" imply "easy to change"?

**Answer:** Most change *is* deletion or replacement — you retire a behavior, swap an implementation, drop a provider. If a piece removes cleanly (small ripple, clear boundary), replacing or changing it is also cheap, because you cut the same seam. Deletability and changeability are the same property seen from two directions.

### J3. Why is highly *reusable* code often *hard* to delete?

**Answer:** "Reusable" means "depended on by many places." Many dependents is exactly what makes removal expensive — every dependent must change. So high reuse usually means low deletability; they trade off.

### J4. What's a concrete test for whether code is deletable?

**Answer:** Ask: *"If I had to remove this next month, how many files (and migrations) would I touch?"* Few → good boundary (deletable). Many → tangled (rigid, will become dead code nobody dares remove).

### J5. Name three techniques from the essay for writing more-deletable code.

**Answer:** (Any three) Don't write it if you don't need it (YAGNI); copy a little before abstracting; separate code that changes for different reasons; prefer deletable boilerplate over a clever thing you can't remove; hide implementations behind thin layers/seams; keep features greppable; use feature flags/kill-switches.

### J6. What is "dead code nobody dares delete," and why is it a smell?

**Answer:** Code that's no longer used but stays because the team can't determine what depends on it. The *fear* is the smell — it signals unclear boundaries and high coupling. Deletable code can be removed confidently.

### J7. What does the Go proverb "a little copying is better than a little dependency" mean here?

**Answer:** A small duplicated snippet is independently deletable/changeable. A dependency is a wire to code you don't own; wires are what make code un-deletable. For small or likely-to-diverge logic, copying preserves independence; a shared dependency sacrifices it.

### J8. Does optimize-for-deletion mean "never abstract"?

**Answer:** No. It means *prefer designs where deletion is cheap*, and avoid *premature* abstraction. A good abstraction at a real seam (e.g., a vendor behind a thin interface) *increases* deletability by giving you a clean line to cut. It's anti-premature-abstraction, not anti-abstraction.

### J9. Give an example of a feature with a good boundary vs. a bad one.

**Answer:** Good: a Slack notification lives in one `notifications/slack.py` module called from one line — delete the file and the line, feature gone. Bad: the notification logic is sprinkled into `User`, the price calculator, the page renderer, and the email service — removal touches all four.

### J10. How does optimize-for-deletion relate to YAGNI?

**Answer:** YAGNI ("don't build it until you need it") is the first and strongest deletion technique — un-written code is the most deletable. Both fight speculative structure built for a future that may never arrive.

---

## Middle Questions

### M1. Why is deletability really a coupling property?

**Answer:** You can delete code exactly when nothing depends on it, so deletion cost is proportional to *afferent* (incoming) coupling. "Can I delete this cleanly?" is just the most concrete way to ask "how coupled is this?" — and it ends arguments, because "removal touches 14 files plus a migration" is a fact, not an opinion.

### M2. State the DRY-vs-deletability tension in terms of the risks each fights.

**Answer:** DRY fights **inconsistency** (change one copy, forget another → bug). Optimize-for-deletion fights **coupling** (everything depends on the shared thing → can't change/delete it independently). They're different risks; the right move depends on which risk is real for the code in question.

### M3. What single question decides whether to DRY two similar pieces of code?

**Answer:** *Would a change to one copy necessarily require the same change to every other copy?* Yes → same knowledge → DRY it (the coupling is real and inherent). No → coincidence or future divergence → keep them apart (merging would *manufacture* coupling and weld together things that should be independently deletable).

### M4. Why is a premature/wrong abstraction harder to delete than the duplication it replaced?

**Answer:** Because callers come to depend on it and accrete flags as they diverge. Removing it now means un-merging the divergent needs of every caller at once. The duplication would have let you delete each caller independently; the abstraction welded them together.

### M5. How does the rule of three referee the tension, and what's its exception?

**Answer:** Tolerate duplication on the 1st and 2nd occurrence (copies stay independent and deletable); extract on the 3rd, when you can *observe* what's truly invariant vs. incidental, so the abstraction fits instead of being a guess. Exception: if the knowledge is provably identical/regulated (a tax rule duplicated verbatim), DRY immediately — there's nothing to guess.

### M6. Why does the "a little copying" advice get *stronger* across a service boundary?

**Answer:** A shared library across services couples their *release cycles* — you can no longer change or delete one service's copy independently, and one team's freeze blocks the other. Deployment coupling is the most expensive kind, so across services copying almost always wins.

### M7. What's the "layers as seams" technique?

**Answer:** Build a stack where each layer is dumb enough to be rewritten or deleted without its neighbors caring. Hide a vendor/subsystem behind a thin seam; the layer behind the seam becomes throwaway — swap Stripe for Adyen by deleting one adapter, app code untouched.

### M8. Give three signals that a codebase's deletability is degrading.

**Answer:** (Any three) Dead code nobody dares delete; "we can't remove X, everything depends on it"; a catch-all `common`/`utils` module everyone imports; feature removal requiring a DB migration; can't find all the places a feature touches; a shared function growing many boolean flags.

---

## Senior Questions

### S1. Explain the trade-off between reuse and deletability.

**Answer:** Reusable code is depended-upon code; depended-upon code is hard to delete. So reuse and deletability are directly opposed — you can't maximize both. Reuse pays off for *stable invariants that genuinely belong to all dependents* (math libs, protocols, domain rules) and is a liability for things that should evolve independently (lookalike features, cross-service helpers). The senior stance: spend reuse deliberately on small, stable shared kernels; keep everything else bounded and independently deletable.

### S2. How does connascence reconcile DRY with optimize-for-deletion?

**Answer:** Connascence (Page-Jones) is the precise theory of coupling: two pieces are connascent if changing one requires changing the other. Real duplication is *pre-existing* connascence scattered across locations — DRYing it *localizes* it (more deletable). Coincidental similarity has *no* connascence — DRYing it *manufactures* connascence (less deletable). So DRY-done-right and optimize-for-deletion are the same goal: **minimize connascence.** They only appear to conflict when "DRY" is misapplied to mean "merge anything that looks alike."

### S3. Why can the wrong abstraction be worse than duplication, in deletability terms?

**Answer:** Duplication is visible, local, and independently deletable. The wrong abstraction is invisible coupling: as callers diverge you add flags, it becomes a maze, and it's load-bearing for N callers — so it's risky and expensive to remove, and gets worse every day. Sandi Metz: "duplication is far cheaper than the wrong abstraction." Recovery: re-introduce duplication (inline back to callers), then re-extract only genuinely shared atoms.

### S4. When must DRY win over deletability?

**Answer:** For genuine **shared kernels** — invariants that *must* stay consistent: domain rules (money rounding), wire/protocol formats (both sides must serialize identically), security/compliance checks. Duplicating these is the bug, because a change *must* propagate everywhere and a missed copy is a defect. The art is keeping the kernel *small and stable* — share the invariant, not the feature. Rule of thumb: **DRY the invariants; duplicate the features.**

### S5. How does the data layer change the deletability calculus?

**Answer:** Code is reversible (cheap to delete); a schema is a one-way door (deletion needs a migration — coordinated, risky, irreversible). A feature that leaks into a shared table/column is barely deletable. So optimize-for-deletion applies most aggressively to *code*, and yields to deliberate up-front design at *data and protocol boundaries*. Features should own their data behind a boundary, not bolt fields onto core tables.

### S6. What is strangler-fig, and how does it relate to deletability?

**Answer:** A pattern for replacing/removing an un-deletable subsystem: put a seam in front of it, route callers through the seam, build the new implementation behind the same seam, migrate callers slice by slice, then delete the legacy whole once its afferent coupling reaches zero. It's literally a *deletability-manufacturing machine* — it artificially drives the old subsystem's incoming coupling to zero so the un-deletable becomes deletable, without a big-bang rewrite.

### S7. How do you measure deletability?

**Answer:** Afferent coupling per module (direct); change-coupling from git history (files that change together = effectively one un-deletable unit — surfaces hidden connascence); and the ground-truth "deletion experiment" — sketch the PR that removes a representative feature; its size and blast radius *are* that area's deletability. Avoid optimizing duplication-% alone — it can *cause* the wrong abstraction.

---

## Professional Questions

### P1. How do you enforce deletability in code review?

**Answer:** Treat new coupling as harshly as new bugs. Two questions: *"If we deleted this feature next quarter, what would the removal PR touch?"* and *"What present need forces this shared dependency — could a copy keep the sites independent?"* "It's more reusable/DRY/future-proof" is a red flag, not a justification, because reuse is paid for in deletability. Push back on `common/` entries, one-impl interfaces, feature concepts leaking into core types, and flag-growing shared functions.

### P2. What metrics actually track deletability, and which mislead?

**Answer:** Track afferent coupling, change-coupling (git history), feature-removal blast radius, and dead-code volume. **Misleading:** duplication-%-alone — a low score can hide strong connascence and chasing it *causes* wrong abstractions; high duplication may be healthy independent copies. Pair duplication-% with change-coupling before acting.

### P3. How do you fight reuse-worship culturally?

**Answer:** Make "a little copying beats a little dependency" a stated value (especially across services); teach the connascence test so DRY targets knowledge not coincidence; require a present requirement for any "platform"/generality; and **celebrate deletions** — flip the incentive so removing an unneeded abstraction earns more respect than building one. Reframe: reuse is a cost (deletability), not a free virtue.

### P4. Walk through removing a live feature safely.

**Answer:** Deprecate (if external) → gate behind a kill-switch and turn it *off* in prod first (reversible soft-delete) → prove it's unused via telemetry → delete the bounded code (afferent coupling ≈ 0) → drop the schema later in a separate expand-contract migration (the one-way door) → remove the dead flag. Key cautions: kill-switch before delete (reversible first); separate code deletion from schema deletion.

### P5. How do you safely remove a wrong, load-bearing abstraction in legacy code?

**Answer:** Characterize all callers with tests (pin current behavior) → inline the abstraction back into each caller (temporarily more duplication, on purpose) → simplify each caller independently (delete the flags it never used) → re-extract only genuinely shared atoms → delete the old abstraction. The intermediate duplication is intentional: the wrong abstraction was worse because it was un-deletable.

### P6. A teammate wants to hoist a 4-line formatter into a shared library used by two services. Your call?

**Answer:** Push back. Across a service boundary, a shared library couples release cycles — a fix one service needs can be blocked by the other's freeze, and neither can change/delete its usage independently. For 4 lines, copy it into each service. Reserve shared libraries (across services) for genuinely stable invariants worth the deployment coupling.

---

## Coding Tasks

### C1. Make this feature deletable (Python).

**Before** — promo leaks across the system (un-deletable):

```python
class User:
    eligible_for_promo: bool
    promo_rate: float
def price(user, base):
    return base * (1 - user.promo_rate) if user.eligible_for_promo else base
# PageRenderer and EmailService also read user.eligible_for_promo
```

**After** — the promo owns its data and logic behind one boundary:

```python
# promo.py — the whole feature; delete this file + its call sites to remove it.
def promo_price(user, base):
    if not _is_eligible(user):     # promo owns eligibility; not on core User
        return base
    return base * (1 - PROMO_RATE)
```

State it: the promo no longer touches the core `User` type or four modules — removal is now "delete `promo.py` and its calls."

### C2. DRY or duplicate? Justify (Python).

```python
# Case A — SAME knowledge (one regulated rounding rule). DO DRY it.
def round_money(amount):                      # one home; a real invariant
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)

# Case B — COINCIDENTAL match (different rules sharing a value today). KEEP APART.
INVOICE_VAT_RATE = Decimal("0.20")
PAYROLL_TAX_RATE = Decimal("0.20")            # free to diverge; merging welds them
```

Reasoning: merge when a change to one *forces* the same change to all (connascence is real); keep apart when they merely coincide — merging manufactures coupling and destroys independent deletability.

### C3. Build a deletable vendor seam (Go).

```go
// Seam the app depends on — never the vendor SDK.
type Mailer interface{ Send(to, subject, body string) error }

// Deletable layer: all Sendgrid-specific code lives ONLY here.
type SendgridMailer struct{ key string }
func (m SendgridMailer) Send(to, subj, body string) error { /* sendgrid */ return nil }

// Switch providers = delete this struct, add another. App code untouched.
```

State it: the seam is a *good* abstraction — it sits at a real boundary (foreign, swappable code), so it *raises* deletability of the vendor layer.

### C4. Escape the wrong abstraction (Python).

**Before** — one flag-soup function coupling three features:

```python
def export(rows, fmt="csv", header=True, gzip=False, redact=()):
    data = [_redact(r, redact) for r in rows] if redact else rows
    out = _to_csv(data, header) if fmt == "csv" else _to_json(data)
    return _gz(out) if gzip else out
```

**After** — inline to independent, deletable callers; keep only shared atoms:

```python
def export_audit_csv(rows):   return _to_csv([_redact(r, PII) for r in rows], header=True)
def export_api_json(rows):    return _to_json(rows)
def export_archive_csv(rows): return _gz(_to_csv(rows, header=False))
# _to_csv / _to_json / _gz are the REAL shared knowledge; the flag soup wasn't.
```

State the recovery order: characterize → inline → simplify each → re-extract only shared atoms → delete the old one.

### C5. Spot the deletability hazard (TypeScript).

```typescript
// What's wrong here, deletability-wise?
function GenericList<T>(props: {
  items: T[];
  variant: "invoice" | "cart" | "search" | "admin";
  showTax?: boolean; compact?: boolean; redactPII?: boolean; legacyLayout?: boolean;
}) { /* if (variant === ...) maze */ }
```

**Answer:** Four unrelated features are welded into one component via a `variant` flag and option soup. To delete any one feature you must edit the component and risk the other three — un-deletable coupling from premature reuse. Fix: split into `InvoiceList`, `CartList`, `SearchList`, `AdminList` (each independently deletable) and share only a feature-agnostic `<Row>` if one genuinely exists.

---

## Trick Questions

### T1. "DRY is always good — remove every duplicate." True?

**False.** DRY targets duplicated *knowledge*, not duplicated *characters*. Merging coincidental similarity *manufactures* coupling between things that should evolve independently and destroys their deletability — and the wrong abstraction is worse (and harder to delete) than the duplication it replaced. DRY the invariants; duplicate the features.

### T2. "Reusable code is the goal of good design." Agree?

**No — at least not unconditionally.** Reuse is depended-upon-ness, which is exactly what makes code un-deletable and un-changeable. Reuse pays only for stable invariants genuinely shared by all dependents; applied uniformly it maximizes coupling. The goal is *deletability* (cheap change); reuse is a deliberate, costed exception for shared kernels.

### T3. "Optimize for deletion means delete code and never abstract." Right?

**No.** It means *prefer designs where deletion is cheap* and avoid *premature* abstraction. A good abstraction at a real seam (a vendor behind a thin interface) increases deletability. It's anti-premature-abstraction and anti-coupling, not anti-abstraction. Taken literally it becomes the opposite disaster: scattered invariants and inconsistency bugs.

### T4. "We reduced duplication 40% — the code is healthier." Sound?

**Suspicious.** A falling duplication-% can mean you manufactured coupling by consolidating coincidental similarity into wrong abstractions — *worse* for deletability. Duplication-% alone is the metric most likely to *cause* the wrong abstraction. Report afferent coupling, change-coupling, and feature-removal blast radius instead.

### T5. "It's a 4-line helper — obviously share it across both services." Obvious?

**No.** Across a service boundary, a shared library couples release cycles: a fix one service needs can be blocked by the other's freeze, and neither can change its copy independently. For 4 lines, copy it. *A little copying is better than a little dependency* — and the dependency here is the expensive, deployment-level kind.

### T6. "If nothing's calling it, just delete it." Safe in production?

**Not without proof.** "I'm pretty sure nothing calls this" is how outages happen — reflection, dynamic dispatch, external callers, and analytics jobs can depend on code that looks dead. Prove it with telemetry or characterization tests, and for live features, kill-switch it off first (reversible) before deleting (irreversible).

---

## Behavioral Questions

### B1. Tell me about a time you made code easier to delete (or deleted something hard to delete).

**Sample:** "We had a `renderDocument(type, ...flags)` function merging invoice, packing-slip, and receipt rendering 'for DRY.' When we killed the legacy invoice format, removal was estimated at three weeks because the three were entangled. I wrote characterization tests, inlined the function back into three independent renderers, then deleted the invoice one — and we re-extracted only the genuinely shared row helper. The lesson I quote now: a premature abstraction is *un-deletable coupling*; duplication would have let us delete each feature independently."

### B2. Describe a time reuse caused a problem.

**Sample:** "A 200-line formatting helper was shared by checkout and reporting 'to avoid duplication.' Reporting needed a fix, but checkout was frozen for a launch and couldn't take the new library version — reporting was blocked three weeks by four lines of code. We copied the helper into each service and deleted the shared lib. Now I treat shared dependencies *across service boundaries* as coupling two release cycles — a little copying beats it almost every time."

### B3. How do you push back when a teammate over-shares code?

**Sample:** "I ask two non-confrontational questions: 'If we deleted this feature next quarter, what would the removal PR touch?' and 'What present need forces this to be *shared* — could a local copy keep the two sites independent?' If the answer is 'it's more DRY/reusable,' I point out that reuse is paid for in deletability and suggest copying unless it's a genuine invariant — citing our team's 'copy beats dependency' convention so it's a standard, not my opinion."

### B4. When did you decide *not* to optimize for deletion — to DRY instead?

**Sample:** "After a bad over-merge, a team over-corrected and duplicated our money-rounding rule across nine endpoints 'for deletability.' A regulatory rounding change then had to land in nine places; one was missed and mis-rounded transactions for two weeks. I argued rounding is a genuine *invariant* — real connascence — so it belongs in one small DRY kernel. The rule I landed on: DRY the invariants, duplicate the features. Deletability favors duplicating *features*, never invariants."

### B5. How do you keep a large codebase deletable over years?

**Sample:** "Make the deletable path the default: 'copy beats dependency' (especially across services) as written policy, rule-of-three for extraction, no feature leaking into core types, every feature behind a boundary, and a cognitive check at review — 'what's the removal blast radius?' Culturally, we celebrate net-negative-LOC and feature-removal PRs, because un-deletability enters one reasonable-looking 'let's share this' PR at a time, so the defense is at review."

---

## Tips for Answering

1. **Lead with the one-liner and the *why*:** easy-to-delete = easy-to-change, because most change is removal/replacement (tef's essay).
2. **Frame deletability as a coupling property** — "how many files to remove this?" is the concrete test for coupling.
3. **Nail the DRY tension:** DRY fights inconsistency, deletion fights coupling; decide with *"would a change to one force the same change to all?"* — and mention **connascence** if pushed (they're the same goal: minimize connascence).
4. **Quote "the wrong abstraction is worse than duplication"** (Metz) and the recovery: inline back, then re-extract only shared atoms.
5. **State the balance explicitly:** *DRY the invariants; duplicate the features.* It shows you're not a zealot in either direction.
6. **Across service boundaries, copy > dependency** (Pike) — and say *why*: it couples release cycles.
7. **Tie data to one-way doors:** code is cheap to delete; schema is not — features should own their data behind a boundary.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md) · **Next:** [DRY](../07-dry/)
