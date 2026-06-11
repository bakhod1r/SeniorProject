# Why & What to Document — Interview Questions

> **Category:** [Documentation](../README.md) — what an engineer documents, where it belongs, and how to keep it alive.

Conceptual questions graded junior → professional, plus practical tasks, trick questions, and behavioral questions on *why* and *what* to document.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Practical Tasks](#practical-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What can documentation capture that source code cannot?

**Answer:** Code expresses *what* it does and *how* it does it. Documentation captures everything code can't: *why* it exists, *how to use it* correctly, *what was decided and rejected*, and *how to operate it*. The *why* is the key — code shows the chosen behavior but never the reasoning or rejected alternatives behind it.

### J2. Name the four modes of the Diátaxis framework.

**Answer:** **Tutorial** (learning-oriented — a guided lesson to a first success), **How-to guide** (task-oriented — a recipe for a specific real task), **Reference** (information-oriented — exhaustive, accurate lookup), and **Explanation** (understanding-oriented — the *why*, the background, the alternatives).

### J3. What are the two axes of the Diátaxis 2×2?

**Answer:** **Study vs. work** (whether the reader is acquiring the skill or applying it) and **practical vs. theoretical** (whether the content is action/steps or knowledge/cognition). Tutorial = study+practical, How-to = work+practical, Explanation = study+theoretical, Reference = work+theoretical.

### J4. Give three audiences an engineer's docs serve and a doc type each needs.

**Answer:** (Any three) End users → tutorials/how-tos; API consumers → reference + runnable examples; contributors → README/CONTRIBUTING; future maintainers → comments/ADRs; operators/on-call → runbooks; decision-makers → design docs/RFCs.

### J5. What is the "bus factor" and how does documentation affect it?

**Answer:** The number of people who can leave before a project stalls because only they understood it. Documentation *raises* it by converting tribal knowledge (in heads) into a durable asset the whole team owns.

### J6. What does it cost a team to *not* document?

**Answer:** Tribal knowledge (works only while specific people are present), repeated questions (the same setup question asked ten times), wrong assumptions (someone "fixes" code they misunderstood), slow onboarding, and incidents (the 3 a.m. page with no runbook).

### J7. Give an example of a doc that's not worth writing.

**Answer:** A comment that restates the code (`i = i + 1  # increment i`), a docstring that just repeats the signature, a list that mirrors an enum, or any value guaranteed to change (current version numbers). They add no information and become liabilities that rot.

### J8. What three things do good engineers document by instinct?

**Answer:** The **decisions** (the *why* and rejected alternatives), the **interfaces** (the contract others depend on), and the **surprises** (non-obvious gotchas and constraints). These are exactly what code can't convey.

### J9. Why is a tutorial different from a reference if they cover the same topic?

**Answer:** Different reader-need. A tutorial is for someone who *doesn't yet know* and needs a guided path; reference is for someone who *already knows* and needs an exhaustive lookup. Same subject, opposite reader — which is why Diátaxis keeps them in separate documents.

### J10. What is "minimum viable documentation"?

**Answer:** Google's idea: the *least* documentation that genuinely answers the reader's question, kept close to the code, beats a comprehensive doc nobody maintains. The volume you write should be the volume you can keep *true*.

---

## Middle Questions

### M1. A README contains setup steps, a config table, key-rotation instructions, and the database-choice rationale. What's wrong?

**Answer:** It blends all four Diátaxis modes (tutorial, reference, how-to, explanation) in one document, so it serves no reader well. Fix: split into a routing README + separate tutorial / how-to / reference / explanation files, linking between them. Each then has one job and is easy to keep true.

### M2. When deadline pressure forces you to document only what matters, what do you write?

**Answer:** Decisions, interfaces, and surprises — the high-cost, irrecoverable knowledge. Skip the unsurprising and anything the reader can get from reading the code. That triage is the "document decisions, interfaces, and surprises" heuristic.

### M3. "Good code is self-documenting, so I don't need docs." Where does that stop?

**Answer:** Self-documenting code covers *what* and *how* via names and structure (a comment restating those is a smell). It can *never* document *why* — the rejected alternative, the external constraint, the reasoning. Better code reduces docs but can't capture the *why*, which must always be written explicitly.

### M4. Why is keeping a doc *close to the code* often more important than how much you write?

**Answer:** A co-located doc (docstring, in-repo `docs/`) gets updated in the same PR that changes the behavior, so it stays true. A detached wiki drifts because nobody remembers it exists. Closeness fights doc rot, which is the dominant long-run cost.

### M5. Give two costs of *over*-documentation that under-documentation doesn't have.

**Answer:** (1) Ongoing **maintenance/rot** — docs you can't keep true become misleading. (2) **Distrust** — once readers learn the docs lie, they ignore even the true ones, and the one live doc gets buried among dead ones. Under-documentation's cost (re-explanation) is recoverable; over-documentation's is corrosive.

### M6. Why are "everyone already knows this" facts the most dangerous to leave undocumented?

**Answer:** They're tribal knowledge the team has internalized so deeply they no longer see them — which is exactly what a new hire lacks and trips on. Internalized obviousness is invisible to insiders and absent for newcomers. Test: did a new hire trip on it? Then document it.

### M7. How do you decide which Diátaxis mode a piece of writing belongs in?

**Answer:** It's a *reader* decision, not a *topic* one. Ask "which reader, doing what?" The same subject (e.g., auth) gets a tutorial, a how-to, reference, and explanation — one per reader-need. If a paragraph is "hard to place," it's usually because the doc is trying to serve two modes at once.

---

## Senior Questions

### S1. From first principles, how do you decide what's worth documenting?

**Answer:** Two axes: **recoverability** (can a competent engineer reconstruct it from code/tests/data?) and **cost-of-loss** (what does the org pay if it's gone?). Concentrate effort on knowledge that is both *irrecoverable and expensive to lose* — the *why* of critical decisions, incident-causing surprises, widely-depended-on contracts. Skip the recoverable, low-stakes. This *derives* "decisions, interfaces, surprises" — they're precisely the high-cost, low-recoverability knowledge.

### S2. Why is the *why* the one documentation you should never defer?

**Answer:** It's the only doc whose cost *rises* and recoverability *falls* over time. At decision-time it costs minutes (you hold the full context); six months later reconstructing it costs hours-to-days and is often impossible (people leave, context evaporates, rejected alternatives are invisible). Reference can be regenerated; a rationale not captured at decision-time is frequently gone for good. This is the economic argument for ADRs.

### S3. How can documentation be a net *liability* rather than an asset?

**Answer:** Every doc must be maintained, trusted, and found. A *stale* doc is worse than none (it sends the reader confidently to the wrong action). Knowledge left as prose that a type/test/generator could enforce will drift. A large doc set creates an *illusion of coverage* that masks the missing runbook. And heavy docs can ossify a bad design that should be simplified instead. Seniors delete net-negative docs without ceremony.

### S4. What does it mean to "push knowledge down the reliability stack"?

**Answer:** Prefer the most reliable representation that can carry the knowledge: type/compiler (can't drift) > test/CI (drift breaks the build) > generated docs (regenerated from source) > hand-written prose (drifts silently). "Always pass cents" as prose rots; a `Money` type that makes floats impossible never does. Document by hand only what *can't* be expressed more reliably as code — which shrinks the hand-written surface to the irreplaceable *why*.

### S5. How does Diátaxis apply at the level of a whole documentation estate, not a single page?

**Answer:** It's a diagnostic for structural gaps. Audit each *audience* × each *quadrant*: missing tutorials → adoption drop-off; missing how-tos → recurring support questions; missing reference → consumers guess the contract; missing explanation → decisions re-litigated; blended modes → docs nobody trusts or finds. Enforce the separation in the information architecture (folders, navigation, templates), not via author etiquette. Diátaxis is the modularity principle for docs.

### S6. Reconcile "code is the documentation" with "the why must be captured."

**Answer:** They're compatible if you minimize the hand-written surface to just the *why*. Make the code self-documenting for *what/how* (so you write fewer docs and generate the recoverable reference), and capture the *why* by hand in ADRs/explanations (because it's irrecoverable and code can't express it). Pure "code is the docs" fails because it loses the *why* and every reader who isn't a code-reader (users, operators, consumers).

---

## Professional Questions

### P1. How do you enforce "what to document" in code review?

**Answer:** Two highest-value questions on every PR: *"The code shows what — where's the why?"* (catches the most expensive, irrecoverable gap) and *"Who reads this doc, and is it true in six months?"* (catches over-documentation before it rots). Also: interface changes must update reference *in the same PR*; surprises get co-located notes; prose a type/test could enforce gets pushed into code. Push back on unnecessary docs as hard as on missing ones.

### P2. What team conventions make the right documentation the default?

**Answer:** "Where's the why?" as a standing review question; interface changes update reference in the same PR (CI-enforced); no on-call rotation without a runbook; generate (don't hand-write) anything derivable; one Diátaxis mode per doc with folder structure enforcing it; docs co-located with code, not on a wiki; delete stale docs without ceremony; tutorials/polished how-tos only for external/high-traffic surfaces.

### P3. How do you fix documentation gaps in a legacy system?

**Answer:** Audit by audience × quadrant (find empty cells, not page count). Recover the irrecoverable *why* first — interview the people who still hold context *before they leave*, capture retroactive ADRs (there's a clock on it). Generate the recoverable surface (API ref, config, diagrams) and delete the hand-written copies. Write runbooks from real incidents. Improve opportunistically as you touch files (Boy Scout Rule). Prune stale docs ruthlessly. Never run a "document everything" project.

### P4. Why is over-documentation sometimes more harmful than under-documentation?

**Answer:** It destroys *trust*. When half the docstrings drift, new hires learn to ignore *all* of them — including the few that record genuine, load-bearing *whys*, which then get "simplified away." Volume becomes camouflage for the real gaps (the missing runbook, the absent rationale). The fix is auditing by audience/quadrant and pruning, not adding.

### P5. A new engineer "simplifies" defensive code and causes an incident. What's the documentation lesson?

**Answer:** The *why* of the defensive code lived only in the original author's head — the code showed *what* (e.g., three jittered retries) but not *why three* or *why jitter* (a hard-won lesson from a prior outage). An undocumented decision is an invitation to re-cause the incident it solved. Fix: capture the rationale in a comment/ADR, linked to the originating incident, and make "where's the why?" a review gate.

### P6. How do you handle stakeholders who equate doc volume with doc health?

**Answer:** Educate that the metric is *outcome*, not page count: can a new hire onboard, can on-call recover, is the *why* retrievable. A 500-page wiki with no runbook and a stale setup guide is *under*-documented where it matters. Reframe pruning stale docs and "minimum viable, kept true" as the mature stance, not laziness.

---

## Practical Tasks

### C1. Place each item in its Diátaxis quadrant.

Given: (a) "Build your first dashboard, step by step"; (b) "`POST /charges` — params, returns, errors"; (c) "How to migrate from v1 to v2"; (d) "Why we chose eventual consistency."

**Answer:** (a) **Tutorial** (study+practical), (b) **Reference** (work+theoretical), (c) **How-to guide** (work+practical), (d) **Explanation** (study+theoretical). State that each belongs in a *separate* document, linked, not blended.

### C2. This docstring is a liability. Fix it.

```python
def get_order(id):
    """Gets an order by id. Takes an id, returns an order."""
    return db.orders.find(id)
```

**Answer:** Delete it — it restates the signature and will drift. The name already says *what*. Replace with a doc *only if* there's a *why* or a *surprise* worth recording, e.g.:

```python
def get_order(id):
    # Returns None (not raises) for missing orders — callers in the
    # checkout path depend on this; see ADR-0009 before changing.
    return db.orders.find(id)
```

### C3. Turn an undocumented decision into a documented one.

Given `MAX_BATCH = 500` with no comment.

**Answer:** The constant shows *what* but not *why*. Add the irrecoverable *why*:

```python
# DynamoDB BatchWriteItem caps at 25; our wrapper chunks internally, but
# 500 is the point where p99 latency crosses our 2s SLA in load tests.
# Raising this trades latency for throughput — re-test before changing.
MAX_BATCH = 500
```

### C4. Identify the missing audience.

A service ships with a polished user tutorial, full API reference, and a contributing guide. It's about to join on-call. What's missing and why does it matter?

**Answer:** The **operator/on-call** audience — there's no **runbook**. It matters because the operator is the most-forgotten audience and the gap surfaces exactly when it's most expensive: a 3 a.m. incident with no recovery procedure. Gate: no on-call rotation without a runbook.

### C5. Decide: document, generate, or skip?

For each, choose and justify: (a) the rationale for a retry count; (b) the list of supported currencies; (c) a standard CRUD endpoint's behavior; (d) the full REST API reference.

**Answer:** (a) **Document** — irrecoverable *why*, high cost-of-loss. (b) **Generate** from the source enum — recoverable, rots if hand-copied. (c) **Skip** the explanation (no decision to defend; nothing surprising) — just include it in generated reference. (d) **Generate** from the OpenAPI spec/code — large, drift-prone, fully recoverable.

---

## Trick Questions

### T1. "More documentation is always better." True?

**False.** Documentation is a bidirectional cost. Too much rots, breeds distrust (readers learn the docs lie and ignore even the true ones), and buries the live doc among dead ones. A stale doc is *worse* than no doc. The target is minimum viable, audience-matched, kept true — not maximum volume.

### T2. "Clean, self-documenting code means we don't need documentation." Right?

**No.** Self-documenting code removes *what/how* docs but *cannot* express *why* — the rejected alternative, the constraint, the reasoning. It also serves only code-readers, not users, operators, or API consumers. Better code reduces docs; it never eliminates the *why* or the audience-facing docs.

### T3. A reference page and a tutorial cover the same feature, so we can merge them to save effort. Sound?

**No — that's the central Diátaxis anti-pattern.** They serve opposite readers (someone who already knows vs. a beginner). Merged, the reference becomes un-scannable and the tutorial gets buried in exhaustive detail. Keep them separate and link between them.

### T4. "We'll document the why later, after we ship." Reasonable?

**Dangerously not.** The *why* is the one doc whose recoverability *falls* over time — it costs minutes now (you hold the context) and is often *impossible* later (people leave, alternatives are forgotten). "Later" is when the knowledge is already gone. Capture it at decision-time.

### T5. The team has a 500-page wiki, so they're well-documented. Agree?

**Not necessarily — and probably the opposite.** Volume is not coverage. A 500-page wiki can lack the one runbook on-call needs and any record of *why*, while 480 pages rot. Audit by audience × Diátaxis quadrant to find real gaps; page count measures liability, not health.

### T6. Documenting a confusing API thoroughly is the responsible move. Always?

**Not always.** Hard-to-document is often a design smell. Heavy docs can *ossify* the bad design ("but it's all documented") and become a reason not to fix it. Sometimes the right answer is to simplify the API so it needs less documentation — fix the code, not just the doc.

---

## Behavioral Questions

### B1. Tell me about a time missing documentation caused a problem.

**Sample:** "A new teammate 'simplified' a three-retry-with-jitter call to a single retry — there was no comment explaining why. Under a downstream blip, all clients retried in lockstep and amplified the outage. The *why* had lived only in the original author's head. I added a comment and an ADR linking the originating incident, and pushed for 'where's the why?' as a review question. The lesson I quote now: an undocumented decision invites re-causing the incident it solved."

### B2. Describe a time you decided *not* to write documentation.

**Sample:** "A teammate wanted a full step-by-step tutorial for a two-method internal helper. I pushed back — the audience was already-competent engineers who just needed the signature, so a tutorial was over-documentation that would rot. We wrote a three-line reference and the *why* of one non-obvious default, and stopped. Knowing what *not* to write is as much a skill as writing."

### B3. How do you handle a teammate over-documenting?

**Sample:** "I ask one non-confrontational question on the PR: 'Who reads this, and will it still be true in six months?' If it restates the code or duplicates generated reference, I suggest deleting it and keeping the words for the *why*. I cite our convention — minimum viable, generate the derivable — so it's a standard, not my opinion. I frame pruning as a win, not criticism."

### B4. How have you improved documentation in a legacy system?

**Sample:** "I didn't run a 'document everything' project — those never finish. I audited by audience and Diátaxis quadrant and found the real gaps: no runbook, no recorded *why*. I interviewed the two people still holding context before they left and wrote retroactive ADRs, stood up generated API reference to replace the drifting hand-written one, and fixed each stale doc opportunistically as I touched the code. I also deleted a lot of dead wiki pages — every one removed raised trust in what remained."

### B5. How do you make documentation stick on a team, not just for yourself?

**Sample:** "Make the right path the default and part of *done*: 'where's the why?' as a review gate, interface changes update reference in the same PR (CI-checked), no on-call without a runbook, generate the derivable, docs co-located with code. And model it — as a senior, if I capture my decisions and prune stale docs in passing, the team follows. Documentation discipline is set by example and enforced by convention, not by exhortation."

---

## Tips for Answering

1. **Lead with "code says *what/how*; docs say *why*"** — it frames almost every answer about *why* and *what* to document.
2. **Name the four Diátaxis modes and the 2×2**, and stress the cardinal rule: *don't mix modes in one doc.*
3. **Map doc *type* to *audience*** — and call out the forgotten ones (operator, maintainer).
4. **Use "decisions, interfaces, surprises"** as your triage for *what* to write under pressure.
5. **Hold the harder truth: documentation is bidirectional cost.** Too much rots and breeds distrust; a stale doc is worse than none.
6. **Tie the *why* to time-asymmetry:** cheapest at decision-time, often unrecoverable later — never defer it.
7. **For strategy, say "push knowledge down the reliability stack"** (type > test > generated > prose) and "minimum viable, kept close to the code."

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md)
