# DRY (Don't Repeat Yourself) — Interview Questions

> **Category:** [Design Principles](../../README.md) — every piece of *knowledge* in a system should have a single, unambiguous, authoritative representation.

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

### J1. What does DRY stand for, and what's the *real* definition?

**Answer:** "Don't Repeat Yourself." The real definition (Hunt & Thomas, *The Pragmatic Programmer*): **"Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."** The key word is **knowledge** — DRY is about facts/rules/decisions, not about textual code similarity.

### J2. Is "don't copy-paste code" an accurate statement of DRY?

**Answer:** It's the slogan, not the principle. DRY is about not duplicating *knowledge*. Plenty of copy-pasted-looking code is *not* duplicated knowledge (it just happens to look alike), and plenty of duplicated knowledge isn't copy-pasted (the same rule written three different ways in three files).

### J3. What's the test for whether two pieces of code are a DRY violation?

**Answer:** The change test: *if the rule/fact behind one changes, must the other change in exactly the same way?* Yes → true duplication, DRY it. No → coincidence, leave them apart.

### J4. What problem does duplicated knowledge cause?

**Answer:** Every change to that knowledge must find and update all copies. Miss one and the copies disagree — a silent bug (a "divergent copy"). The pattern of "one change, many edits" is called shotgun surgery. A single source of truth makes the change a one-line, atomic edit.

### J5. Give a non-code example of duplicated knowledge.

**Answer:** Any of: the same validation rule in client and server; a version number in `package.json`, a Dockerfile, and a README; an API documented by hand *and* in code; the same config value in app config and a deploy script. DRY spans code, schema, config, docs, and build scripts.

### J6. What does WET stand for?

**Answer:** "Write Everything Twice" (or jokingly "We Enjoy Typing") — the anti-pattern DRY opposes: the same knowledge copied repeatedly.

### J7. What's a single source of truth?

**Answer:** The one authoritative place a piece of knowledge lives (a constant, a function, a config value, a schema). Everything else refers to or is generated from it, so the copies can never disagree.

### J8. Two functions are byte-for-byte identical. Must you merge them?

**Answer:** Not necessarily. Identical code is only a *hint*. Apply the change test — if they encode different knowledge that can diverge (e.g., username length vs. room-code length), merging is a mistake.

### J9. Name three techniques for removing true duplication.

**Answer:** Extract a constant (a magic number → one named constant); extract a function (a repeated rule → one function); parameterize (near-copies differing in one value → one function with a parameter). Larger: extract a module, or single-source-and-generate across layers.

### J10. Where does the DRY principle come from?

**Answer:** Andy Hunt and Dave Thomas, *The Pragmatic Programmer*.

---

## Middle Questions

### M1. Explain the difference between true and coincidental duplication.

**Answer:** True duplication = the *same* knowledge in two places (change one ⇒ change both, for the same reason) — DRY's actual target. Coincidental duplication = code that *looks* alike but encodes *different* decisions that may diverge. Merging coincidental similarity couples things that should be independent — a bug source. The change test distinguishes them.

### M2. What is the rule of three, and why three?

**Answer:** Don't abstract on the first or second duplication; wait for the third. One occurrence shows no variation; two fit infinitely many abstractions (a guess about shape); three let you *observe* what's truly invariant vs. incidental, so the abstraction is data-driven. It's a defense against premature/wrong abstraction. Exception: provably-identical knowledge (a regulated rule) → DRY immediately.

### M3. What does AHA stand for, and what does it warn against?

**Answer:** "Avoid Hasty Abstractions" (Kent C. Dodds). It warns against DRYing too eagerly. Its companion line is Sandi Metz's: "Duplication is far cheaper than the wrong abstraction." Prefer duplication until the right abstraction is obvious.

### M4. Give the canonical cross-layer duplication and its single-source fix.

**Answer:** Validation rules duplicated in client and server. Fix: define the rules once in a shared schema (Zod, JSON Schema, protobuf) and derive the client check, server check, and types from it. One source; the copies can't drift.

### M5. Walk through how a hasty DRY merge degrades over time.

**Answer:** Two coincidentally-similar functions get merged behind a `kind`/`mode` flag → a requirement makes one caller differ → you add a flag → more requirements, more flags, each applying to only one branch → the function becomes a maze where a change for one case risks the others → it's now load-bearing and risky to remove. Escape by inlining back to clear functions, then re-extracting only genuinely shared helpers.

### M6. When is keeping duplication the *right* call?

**Answer:** Coincidental similarity; across service/bounded-context boundaries ("a little copying is better than a little dependency"); when the abstraction would hurt clarity; trivially small duplication where extraction costs more than it saves; and test setup that should stay self-contained.

### M7. Does DRY mean "fewest characters"?

**Answer:** No — it means "fewest *representations of a fact*." A clearer, slightly longer version with one source of truth beats a terse one with hidden copies. DRY is about knowledge, not keystrokes.

---

## Senior Questions

### S1. How does connascence make DRY precise?

**Answer:** Two pieces of code are connascent if changing one requires changing the other. A DRY violation is just strong, scattered connascence — usually *connascence of meaning* (the same magic value that must change together but isn't enforced). Naming a constant *weakens* it to connascence of name (compiler-enforceable) and *localizes* it. The senior reframing of DRY: don't "remove duplication" — *manage connascence* (weaken it, localize it, lower its degree). And: two things sharing *no* connascence aren't duplication — merging them *manufactures* connascence, the opposite of the goal.

### S2. Why is the wrong abstraction worse than duplication?

**Answer:** Duplication is visible, local, has its own callers, is cheap to consolidate any day, and doesn't get worse on its own. The wrong abstraction is hidden coupling: many callers depend on it, removal requires understanding and re-testing all of them, and it accretes flags so the cost *rises* daily. Sandi Metz: "duplication is far cheaper than the wrong abstraction." Recovery: inline back to callers (re-introduce duplication), then re-extract only genuinely shared knowledge.

### S3. How does DRY conflict with orthogonality, and which wins?

**Answer:** DRY pushes toward consolidation (sharing); orthogonality pushes toward independence (a change to one thing shouldn't ripple to another). A shared abstraction is anti-orthogonal when its callers aren't truly related. Reconcile via SRP: consolidate things that change together *for the same reason* (DRY *and* orthogonal); keep apart things that change for *different* reasons (DRYing would break orthogonality). When DRY would couple two distinct reasons-to-change, orthogonality wins — keep the duplication.

### S4. Should you apply DRY across microservices? Why or why not?

**Answer:** Usually no. A shared library that owns a business rule couples the services' deployments and teams into lockstep releases. Bounded contexts legitimately duplicate concepts (Billing's "Customer" ≠ Shipping's "Customer" — same word, different model). "A little copying is better than a little dependency." DRY *within* a service/context; duplicate *across* them. The exception is genuine cross-service contracts (wire protocols, schemas, error codes) — and those should be *generated from one spec*, not shared as mutable logic.

### S5. How does DRY relate to "optimize for deletion"?

**Answer:** Sharing creates dependents, and code with many dependents is hard to delete — so DRY is in tension with deletability. DRYing *true* knowledge is an acceptable trade (you rarely want to delete a genuinely shared rule). DRYing *coincidental* similarity is pure loss: you couple independent things and the abstraction is now sticky, whereas the duplication was deletable. When in doubt, bias toward the more deletable (reversible) design — which usually agrees with AHA.

### S6. Justify "prefer duplication to the wrong abstraction" in terms of reversibility.

**Answer:** Deferring (keeping duplication) is cheap to reverse: if it turns out to be shared knowledge, you consolidate later, *once*, with more information. Abstracting is expensive to reverse: if it turns out coincidental, you pay twice — to remove the wrong abstraction *and* build the right design — plus the bug risk while flags accrete. The asymmetry biases the default toward patience: DRY when the evidence (three real cases) is in; duplicate while it isn't.

---

## Professional Questions

### P1. How do you enforce DRY in code review — in both directions?

**Answer:** Move 1: flag *true* duplication that should be single-sourced (one rule in three files). Move 2 (the one reviewers miss): block *hasty* merges of coincidental similarity. The key question for a merge: "If the rule behind one changes, must the other change the same way, for the same reason?" If no, don't merge. For a new shared abstraction: "How many real, present callers, and do they share one reason to change?"

### P2. Can a duplication-detection tool decide DRY violations for you? 

**Answer:** No. CPD/jscpd/SonarQube duplication % match *tokens*; DRY is about *knowledge*. They flag coincidental look-alikes (false positives) and miss the same rule written differently in different files (false negatives). Use them to find *candidates*; a human applies the change test to decide. Pair the metric with **change-coupling** (git co-change history) — files that always change together are the real duplication signal.

### P3. Why is chasing "0% duplication" a mistake?

**Answer:** Because the metric can't tell knowledge from coincidence, a zero-duplication gate forces engineers to merge coincidental look-alikes — manufacturing wrong abstractions (flag-laden god-functions). 0% is a red flag, not a trophy. Make the duplication metric a *prompt* that opens a "same knowledge?" conversation, not a build-failing gate.

### P4. What's the highest-leverage DRY in a large system?

**Answer:** Single-source-and-generate for knowledge that spans layers/services: define validation, API contracts, shared enums/types once (Zod/JSON Schema/OpenAPI/protobuf) and generate the client check, server check, types, and docs from it. This makes drift *impossible*, versus a CI diff that only *detects* drift after the fact. Caveat: generate contracts across services; don't share mutable business-logic libraries (deployment coupling).

### P5. How do you safely remove a wrong, load-bearing abstraction from legacy code?

**Answer:** Characterize all callers with tests (pin current behavior, including each flag's quirks) → inline the abstraction back into each caller (temporarily *more* duplication, intentionally) → simplify each caller (delete the flags it never used) → re-extract only the genuinely shared knowledge (verified by the change test) → delete the old abstraction. The intermediate increase in duplication — and in the duplication metric — is correct; explain it to stakeholders beforehand.

### P6. A DRY refactor merged two methods and caused a production incident. What likely happened, and how do you prevent it?

**Answer:** The two methods *looked* identical but encoded different rules (classic: two `calculateFee` with different rounding modes). The merge used one behavior for both, breaking the other. The change test ("would a change to one force the same change to the other?") would have said "no — coincidental." Prevention: change-test before merging, characterization tests pinning *both* behaviors first, and a review norm that look-alike ≠ duplication.

---

## Coding Tasks

### C1. Fix the true DRY violation (Python).

**Before** — one rule ("members get 10% off") in two places, as `0.9` and `0.1`:

```python
def cart_total(items, member):
    sub = sum(i.price * i.qty for i in items)
    return sub * 0.9 if member else sub          # 10% off

def receipt_savings(items, member):
    sub = sum(i.price * i.qty for i in items)
    return sub * 0.1 if member else 0            # 10% off — SAME fact
```

**After** — one authoritative home:

```python
MEMBER_DISCOUNT_RATE = 0.10
def member_discount(subtotal, member):
    return subtotal * MEMBER_DISCOUNT_RATE if member else 0.0

def cart_total(items, member):
    sub = sum(i.price * i.qty for i in items)
    return sub - member_discount(sub, member)

def receipt_savings(items, member):
    sub = sum(i.price * i.qty for i in items)
    return member_discount(sub, member)
```

State the reasoning: the discount rule is one fact; a change to it must hit both — true duplication. (We did *not* merge the two functions themselves; they answer different questions.)

### C2. Spot and *reject* the false DRY (TypeScript).

```typescript
// These LOOK identical — are they the same knowledge?
const isValidUsername = (s: string) => s.length >= 3 && s.length <= 20;
const isValidRoomCode = (s: string) => s.length >= 3 && s.length <= 20;
```

**Answer to give:** Do *not* merge into `isValidLength`. Apply the change test: would a change to the username rule force the same change to room codes? No — they're independent product decisions that share numbers today. The `3` and `20` are coincidental. Merging creates a wrong abstraction you'd have to un-merge the day usernames go to 30 chars. Keep them separate, named for their distinct rules.

### C3. Single-source cross-layer validation (TypeScript).

**Before** — rules duplicated in client and server (they will drift):

```typescript
// client
if (form.username.length < 3 || form.username.length > 20) reject();
// server
if (body.username.length < 3 || body.username.length > 20) throw new Error();
```

**After** — one schema, both derived from it:

```typescript
const SignupSchema = z.object({ username: z.string().min(3).max(20) });
type Signup = z.infer<typeof SignupSchema>;          // types generated too
SignupSchema.safeParse(form);   // client
SignupSchema.parse(body);       // server — SAME source of truth
```

### C4. Escape the wrong abstraction (Python).

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

### C5. DRY real duplication but not coincidence (Python).

```python
# COINCIDENTAL — same value, DIFFERENT rules → keep apart, name separately
INVOICE_VAT_RATE = 0.20
PAYROLL_TAX_RATE = 0.20
def invoice_tax(amount): return amount * INVOICE_VAT_RATE
def payroll_tax(amount): return amount * PAYROLL_TAX_RATE

# TRUE — same knowledge ("line = price * qty") in 3 methods → one home
def line_total(price, qty): return price * qty
```

State the rule: merge when a change to one *forces* the same change to the other; keep apart when they merely coincide.

---

## Trick Questions

### T1. "DRY means remove every duplicate line of code." True?

**False.** DRY targets duplicated *knowledge*, not duplicated *characters*. Two identical-looking pieces that encode different decisions are *not* a violation, and merging them manufactures coupling — a bug source. Identical code is a hint to investigate, never proof.

### T2. "A 0% duplication score means the code is well-DRYed." Right?

**No — it's a red flag.** Token-matching tools can't tell knowledge from coincidence, so reaching 0% usually means coincidental look-alikes were merged into wrong abstractions (flag-laden god-functions). Aim for single-sourced *knowledge*, not a zero metric. Pair the metric with change-coupling.

### T3. "Microservices should share a common library to stay DRY." Agree?

**Usually no.** Sharing a business-logic library couples the services' deployments and teams into lockstep releases, and bounded contexts legitimately model the same word differently. "A little copying is better than a little dependency." DRY within a service; duplicate across them; share only *generated contracts* (protocols, schemas).

### T4. "If two functions are identical now, merging them is always safe." Correct?

**No.** Apply the change test. If they encode different knowledge that can diverge (username vs. room-code length; invoice VAT vs. payroll tax), merging them is a latent bug — you'll have to un-merge painfully when one changes, and un-merging a wrong abstraction is harder than the duplication ever was.

### T5. "DRY always beats other principles — it's a hard rule." True?

**No.** DRY is a heuristic that conflicts with clarity, orthogonality, locality, and deletability. When removing duplication hurts clarity or couples independent things, those usually win. ([Simple Design](../../../craftsmanship-disciplines/04-simple-design/) deliberately ranks "reveals intention" *above* "no duplication.")

### T6. "You should DRY on the second occurrence." Always?

**No — default to the rule of three.** Two occurrences don't reveal the abstraction's real shape; extracting then risks the wrong abstraction. Exception: if the knowledge is *provably identical* (a regulated rule), DRY immediately — there's nothing to guess.

---

## Behavioral Questions

### B1. Tell me about a time duplicated knowledge caused a bug.

**Sample:** "'Free shipping over $50' was hard-coded in checkout, the confirmation email, and billing. Marketing raised it to $75; I updated checkout and email but missed billing. For weeks customers saw 'free shipping' but were charged. I moved the threshold into one pricing-config value all three read. Lesson: the most expensive DRY failures are *real* duplication that crosses layers, because the copies are owned by different people and drift unseen."

### B2. Describe a DRY refactor that went wrong.

**Sample:** "I merged two `calculateFee` methods that looked identical — but one rounded half-up, the other half-even, an undocumented regulatory difference. The merged version mis-rounded thousands of transactions. I learned to ask 'would a change to one force the same change to the other?' before merging — coincidental similarity isn't duplication — and to pin both behaviors with characterization tests first."

### B3. How do you push back when a teammate wants to merge two look-alike functions?

**Sample:** "I ask the change test out loud: 'If the rule behind one of these changes, does the other have to change the same way?' If the answer is no, I explain they're coincidentally similar and merging couples two things that should evolve independently — citing our team policy so it's a standard, not my opinion. If they *are* the same knowledge, I support single-sourcing it."

### B4. When did you decide *not* to apply DRY?

**Sample:** "A teammate wanted both our Billing and Shipping services to share a `common-domain` library that owned the `Customer` model and some rules. I pushed back: that couples the two services into lockstep releases, and the two contexts actually model 'Customer' differently. We kept separate models — a little duplication — and shared only the generated wire contract. A little copying beat the dependency."

### B5. How do you keep knowledge single-sourced across a large codebase over years?

**Sample:** "Make the change test the team's definition of duplication; single-source-and-generate cross-layer knowledge (validation, API contracts) so it *can't* drift; treat duplication-% as a prompt, not a gate (0% creates wrong abstractions); 'a little copying beats a little dependency' across services; and celebrate the right cleanups — including re-introducing duplication to escape a wrong abstraction."

---

## Tips for Answering

1. **Lead with the real definition** — "every piece of *knowledge* has a single authoritative representation" — and stress that it's about knowledge, not look-alike code.
2. **Always state the change test:** "change one ⇒ must the other change the same way, for the same reason?"
3. **Nail true vs. coincidental duplication** — the signal that you understand DRY rather than the slogan.
4. **Quote "duplication is far cheaper than the wrong abstraction"** (Metz) and AHA, and describe the inline-then-re-extract escape.
5. **Mention connascence** if pushed for the precise theory (DRY = managing connascence: weaken, localize, lower degree).
6. **For services, say "a little copying is better than a little dependency"** — DRY within, duplicate across.
7. **For tooling, say duplication-% finds candidates, not defects** — and 0% is a red flag.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)
