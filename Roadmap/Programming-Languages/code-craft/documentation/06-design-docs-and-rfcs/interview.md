# Design Docs & RFCs — Interview Questions

> **Category:** [Documentation](../README.md) — writing a short proposal *before* building, so the team can review the plan while it's still cheap to change.

Conceptual and practical questions, graded junior → professional, plus trick and behavioral questions.

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

### J1. What is a design doc and why write one *before* building?

**Answer:** A design doc is a written plan for what you intend to build and how, shared before you build it. You write it before building to **align stakeholders, surface risks, and get review while the work is still cheap to change** — catching mistakes when they cost a comment instead of a rewrite.

### J2. What does "writing is thinking" mean here?

**Answer:** The act of writing the design in full sentences forces clarity and exposes gaps and edge cases your head was glossing over. The doc's biggest value is often the *thinking it forces while you write it*, not the artifact it leaves behind — which is why teams write docs even for work one person builds alone.

### J3. Name the standard sections of a design doc.

**Answer:** Context/Background, Goals & Non-Goals, the Design (overview + detailed), Alternatives Considered (with why-rejected), cross-cutting concerns (security, privacy, observability, testing, rollout, cost), Open Questions, and Timeline.

### J4. Which two sections are the highest-value, and why?

**Answer:** **Goals/Non-Goals** (defines success and scope, prevents scope creep) and **Alternatives Considered** (proves you weighed options and records *why* you rejected the others, so they aren't re-litigated). Engineers love the Design section and skip these two — that's backwards.

### J5. What are Non-Goals and what do they prevent?

**Answer:** The things a reader might reasonably expect the project to include but that you're *deliberately* excluding. They prevent scope creep ("can it also do X?" → "X is a Non-Goal") and set reviewer expectations.

### J6. What is an RFC and where does the term come from?

**Answer:** "Request for Comments" — a proposal published with a structured comment period and an explicit accept/reject decision. The term comes from the internet's origins: Steve Crocker wrote RFC 1 in 1969 for ARPANET, choosing the humble name to keep the tone open ("here's a proposal, please comment"). Companies and projects (Rust RFCs, Python PEPs) borrowed it for internal proposal processes.

### J7. What's the difference between a design doc, an RFC, and an ADR?

**Answer:** Design doc = the detailed *plan* for building something. RFC = that plan *explicitly opened for broad comment and a decision* (often heavier process). ADR = the short, *durable record* of the decision that results. They're a **pipeline**, not competitors: plan → opened for comment & decision → durable record.

### J8. How big should a design doc be?

**Answer:** **Right-sized to the risk.** Config rename → no doc. One feature → a one-pager. Cross-team or irreversible → a full RFC. A 20-page doc for a tiny change is *design-doc theater*. The cost of the doc must stay below the cost of getting the decision wrong.

### J9. Why is a design doc a *point-in-time* artifact?

**Answer:** It captures a plan and a discussion at one moment. Once the thing is built, reality diverges and keeping the doc perfectly in sync isn't worth it. Durable facts ("why we chose this", "how it works now") belong in ADRs and reference docs, not the design doc.

### J10. What goes in "Alternatives Considered"?

**Answer:** The other approaches you weighed and **why you rejected each one.** The why-rejected is the value — it proves you didn't grab the first idea and saves the next person from re-litigating a path you already ruled out.

---

## Middle Questions

### M1. When should you spike instead of write a doc?

**Answer:** When the central risk is a *technical unknown* ("does this library work / is this fast enough?") that you can *measure* in a short throwaway prototype faster than you can *guess* at it in prose. A spike replaces the doc's guess with a fact; you still write a short doc to align people, but now its content is true rather than speculative.

### M2. Walk through the RFC lifecycle states.

**Answer:** **Draft** (still writing, not for review) → **In Review** (published, comment period open) → **Revising** (incorporating feedback) → **Accepted/Rejected** (decider calls it) → **Implemented**; plus **Superseded** (a later RFC replaces it). The states answer "still up for debate, or decided?" at a glance.

### M3. Why must a comment period be time-boxed?

**Answer:** Without a deadline, people always have one more thought and the proposal stalls forever. A hard `Review-by` date forces engagement and lets the process close. Pair it with a named `Decider` so someone is responsible for actually calling it.

### M4. Async written review vs meeting-driven decisions — which does RFC culture prefer and why?

**Answer:** **Async written review** by default — writing forces clearer reasoning, it includes people a meeting would exclude (time zones, schedules), the loudest voice doesn't dominate, and the doc *produces its own record*. Meetings are reserved for *breaking a deadlock*, after which the outcome goes back into the doc. The meeting decides; the doc remembers.

### M5. What is "disagree and commit" and what does it require?

**Answer:** Once the decider makes the call, everyone — including those who argued the other way — supports it and moves on. It requires a *fair, heard* process: people commit to a decision they disagree with only if they believe their argument was genuinely weighed (hence comment-triage with reasons). It is *not* "the loudest wins."

### M6. What are the two outputs of a resolved RFC?

**Answer:** (1) An **implementable plan** — tickets, milestones, owners — and (2) an **ADR**, the durable one-page record of the decision (since the RFC itself goes stale after build). The RFC records the *debate*; the ADR records the *decision*.

### M7. Why are cross-cutting concerns the part juniors under-write?

**Answer:** Because the "Design" section is the fun part and the happy path. Security, privacy, observability, testing, rollout/rollback, and cost are exactly where review finds the real production problems — a doc that's all Design has only described the demo, not the system in production.

---

## Senior Questions

### S1. Which decisions deserve a doc, and which are killed by the process?

**Answer:** **Reversibility** is the dividing line. One-way doors (public APIs, schemas, wire/event formats, data-retention models, crypto) deserve an RFC — they're expensive to undo. Two-way doors (internal structure, reversible library choices) should be made by *building and refactoring if wrong*; forcing process on them is the bureaucracy engineers rightly resent. Spend the process budget on the one-way doors.

### S2. What is "decision-laundering" and how do you spot it?

**Answer:** Writing the Alternatives section with strawmen — options so obviously bad that the predetermined choice is the only conclusion — to use the doc's credibility to bless a decision already made. Tell: the rejected options are never the ones a smart skeptic would actually propose, and the chosen option's cons are absent. A real Alternatives section has at least one *genuinely tempting* rejected option, falsifiable rejection reasons, and honest cons on the chosen option.

### S3. Why is "a design doc is documentation" the wrong mental model?

**Answer:** A design doc is a **decision-forcing function** — its product is a better decision, made earlier, with risks surfaced; the artifact is a byproduct. Consequences: a doc that changed no one's mind (including the author's) was probably written too late; the best review outcome is sometimes "don't build this"; and a doc with no Open Questions and only strawman alternatives is a sales pitch, not a design exploration.

### S4. What is the shepherd/decider role and why does it matter?

**Answer:** A single named person who drives the RFC to a decision (shepherd) and makes the call (decider). It matters because **diffused ownership is the #1 cause of RFC death** — "the team will decide" decides nothing. The shepherd keeps it moving, *synthesizes* arguments rather than tallying votes (a well-reasoned objection from the affected team outweighs five "+1"s), makes a legitimate call, and is the addressee of "disagree and commit."

### S5. How does Goals/Non-Goals function as a scope contract?

**Answer:** Goals are measurable and few (held accountable: "p99 under 400ms", not "make it fast"). Non-Goals pre-answer every future "can it also…?" — the senior move is to anticipate scope-creep requests and fence them off ("multi-region failover is a Non-Goal for v1; the design must not preclude it"). A Non-Goal that *constrains* the design ("we will not store PII here") is the most valuable kind. Get agreement on this section *first* — if reviewers disagree with it, reviewing the Design is moot.

### S6. Name the three failure modes of a design-doc practice and the counter to each.

**Answer:** **Theater** (docs written/"reviewed" but nobody engages — counter: recruit reviewers who own the affected systems; measure whether docs *change* in review). **Analysis paralysis** (the doc becomes the project — counter: hard deadlines, an empowered decider, spike to resolve technical unknowns). **Over-process on reversible work** (RFCs for two-way doors — counter: the reversibility test). The meta-failure: mistaking the artifact for the value.

### S7. Why shouldn't you fight doc rot on a design doc?

**Answer:** Because a design doc is *point-in-time* by nature — it captured a plan and a discussion at one moment, and reality diverges the instant the build starts. Trying to keep it eternally accurate is a category error. Route durable facts to their right home: the *why* to an **ADR**, the *how-it-works-now* to **reference docs**. Date and status the design doc and let it become history.

---

## Professional Questions

### P1. How do you stand up an RFC process that survives instead of calcifying?

**Answer:** Make the *default* path genuinely lightweight (one-pager, one decider, 3-day window); heavy process is opt-up for one-way doors only. One obvious home for all RFCs. A template that's a checklist (empty Non-Goals/Alternatives headings teach). A named owner for the process itself. And visible early wins — adoption follows demonstrated value, not mandate. The failure mode is "too much ceremony for the common case," not "too few rules."

### P2. What metrics tell you the RFC process is healthy — or degrading?

**Answer:** **% of RFCs that change after first draft** (near 0% = theater), **time-in-review** (rising = paralysis, near-zero = rubber-stamping), **% rejected/redirected** (0% = sales pitches), **RFCs stuck past `Review-by`** (ownership problem), and **RFC→ADR conversion** (knowledge being banked). *Not* raw RFC count (rewards over-process). Ground truth: are major decisions sound, on time, and traceable later?

### P3. How do you scale the decider role beyond one person?

**Answer:** Distribute decision authority by domain (storage team decides storage RFCs); a small standing group for cross-cutting RFCs with a chair who breaks ties (without becoming a gatekeeping bottleneck); a default-decider rule to kill limbo ("if none named in 2 days, the author's manager decides"); and escalation as a *path*, not the default. Centralized deciding recreates the bottleneck engineers route around.

### P4. How do you make sure the durable knowledge survives the RFC?

**Answer:** Bake **ADR creation into the RFC close** — the template's `## Decision` block *is* the ADR draft; when the shepherd marks it Accepted, copy it into the ADR log and cross-link. The step teams skip is RECORD: an accepted RFC with no ADR means that years on, after the RFC has gone stale and authors have left, the *why* is gone. The RFC is the perishable full discussion; the ADR is the durable distillate.

### P5. Where should RFCs live — repo or doc tool?

**Answer:** Engineering RFCs often live **in the repo** (versioned, diffable, inline PR comments, CI can lint the template, diagrams-as-code — the docs-as-code approach) with broad non-engineer proposals in a doc tool. Whichever: one obvious home, lint the template (reject missing Decider/Review-by), automate stalled-RFC nudges, and keep a discoverable index.

### P6. A staff engineer's RFC has thin, strawman alternatives. What do you do?

**Answer:** Reject it for un-serious alternatives — review bar scales with *reversibility, not seniority*. Waving through a senior's doc because of rank is exactly how senior mistakes become production incidents. Ask for a genuinely-tempting alternative with a falsifiable rejection reason, and protect reviewers who challenge senior authors.

---

## Practical Tasks

### C1. Write a Non-Goals section for: "add full-text search to the docs site."

**Sample:**

```markdown
## Non-Goals
- Searching across *other* products' docs (this is scoped to this site only).
- Typo-tolerance / fuzzy matching in v1 (revisit if search-miss rate is high).
- Indexing non-doc content (blog, changelog) — separate request.
- Replacing the existing nav/TOC — search augments it, doesn't replace it.
```

Each line pre-answers a "can it also…?" a reviewer would otherwise raise, and the parenthetical re-evaluation triggers keep the door open without committing now.

### C2. Turn this strawman Alternatives entry into a real one.

**Before (strawman):**
```markdown
### B. Use Elasticsearch (rejected)
- Too heavy. Rejected.
```

**After (real):**
```markdown
### B. Elasticsearch (rejected, genuinely considered)
+ Best-in-class relevance, faceting, and scale headroom.
- Our corpus is ~2k pages, ~50 searches/day; running and operating an ES
  cluster (or paying for hosted) is disproportionate to that load.
- Adds an operational dependency our small team would have to learn/maintain.
Rejected: capability far exceeds need *at our scale*; revisit if corpus
grows ~100× or we need faceted search. Chose a static client-side index instead.
```

State the reasoning: the rejection is now *specific, scale-dependent, falsifiable*, and has a re-evaluation trigger — a reviewer can challenge it precisely.

### C3. Draft an RFC status block for a database-engine migration.

**Sample:**
```markdown
---
RFC: 0073
Title: Migrate primary store from MySQL to PostgreSQL
Author: B. Yashin Mansur
Status: In Review
Created: 2026-06-11
Review-by: 2026-06-20
Decider: @data-platform-lead
Reviewers: @dba, @sre-oncall, @backend-leads, @security
Supersedes: —
Tracking: DATA-2210
---
```

Call out: this is a **one-way door** (schema/storage migration) → an RFC is warranted; the `Decider` and `Review-by` fields are mandatory; required reviewers include the teams that *own the affected systems* (DBA, SRE), not just "anyone."

### C4. Map these decisions to "doc / RFC / no-doc / spike."

**Answer:**
- Rename an internal helper method → **no doc** (PR only; two-way door).
- Choose between two JSON libraries, unsure of perf → **spike**, then a short doc.
- Change the public webhook payload schema → **RFC** (one-way door — clients break).
- Add a feature flag to an existing service → **no doc / PR description**.
- Pick the company-wide service-mesh → **heavyweight RFC**, broad review, named decider.

---

## Trick Questions

### T1. "A design doc is the source of truth for how the system works." True?

**False.** A design doc is a *point-in-time* artifact — it captures a plan and a discussion *before* the build, and goes stale the moment reality diverges. The source of truth for "how it works now" is reference docs; the source of truth for "why we chose this" is an ADR. Treating a design doc as a living reference is how people build against architectures that no longer exist.

### T2. "If everyone approves the RFC quickly with no changes, the process is working great." Right?

**No — that's the alarm, not the goal.** A doc that never changes during review is usually *theater*: nobody engaged substantively. A healthy process *changes* docs (review caught something) and occasionally *rejects* them (a wrong build prevented cheaply). Zero rejections and zero changes means the process costs more than no process while delivering the same outcome.

### T3. "More design docs = a more mature engineering org." Agree?

**No.** Counting docs rewards *over-process* — docs for reversible, trivial work that didn't need them. Maturity is matching process to *reversibility*: heavy review for one-way doors, *build-and-refactor* for two-way doors. The metric to watch is decision quality and traceability, not doc count.

### T4. "We're agile, so we don't need design docs." Correct?

**Dangerously wrong on two counts.** (1) "Writing is thinking" — even agile teams benefit from forcing clarity before building anything non-trivial; the doc can be a one-pager. (2) Irreversible *one-way-door* decisions (schemas, public APIs, protocols) need deliberate review regardless of methodology — "we'll change it later" is true for internals and false for published contracts.

### T5. "The Alternatives section is where you justify your choice." True?

**Subtly wrong.** If you're *justifying* a predetermined choice with strawmen, that's decision-laundering. The Alternatives section is where you *make and stress-test* the choice — at least one rejected option should be genuinely tempting, the rejections falsifiable, and the chosen option's cons stated honestly. A reader should be *able* to disagree and pick differently; if not, it's a sales pitch.

### T6. "A meeting is faster than an async RFC, so prefer meetings." Always?

**No.** For *simple* decisions, a meeting can be faster. For *complex or contentious* ones, async written review is faster (parallel, no scheduling, no re-litigating) and produces a record a meeting doesn't. The right pattern: async by default; a short meeting only to *break a deadlock* — and the outcome goes back into the doc.

---

## Behavioral Questions

### B1. Tell me about a time a design doc caught a problem before you built the wrong thing.

**Sample:** "I proposed storing sessions in Redis with a TTL. In the comment period, our SRE asked what happens when Redis is down — with the old in-process store, sessions survived an outage. That single comment reframed the design: I switched to signed stateless cookies as a fallback. The review cost an afternoon and a few comment threads; finding that failure mode in production would have been an incident. It's my go-to example of why the cheapest moment to be wrong is *before* the code."

### B2. Describe an RFC that stalled. What went wrong?

**Sample:** "An RFC for a new internal platform sat 'In Review' for seven weeks — every comment round spawned new alternatives, the doc kept growing, and nobody was empowered to call it. Three of us were blocked the whole time. The root cause was no named decider and no deadline — textbook analysis paralysis. We fixed it by assigning a decider and a hard 3-day final window, and shipped a decision. Now I never open a comment period without a `Review-by` date and a named shepherd."

### B3. How do you push back on an over-engineered RFC without being adversarial?

**Sample:** "I ask specific, falsifiable questions about the *design*, never the *designer*: 'What's the present requirement that needs this extensibility? What's the second concrete case?' If the Alternatives section has strawmen, I name the genuinely-tempting option I'd expect to see and ask why it was rejected. I frame it as helping the doc do its job — surfacing risk — and I apply the same bar regardless of the author's seniority."

### B4. When did you decide a change *didn't* need a doc?

**Sample:** "A teammate started drafting a full RFC to rename an internal config key. I pushed back — it's a reversible, two-way-door change with no cross-team impact. A one-line PR description was the right-sized 'doc.' Spending RFC ceremony there is the bureaucracy that makes people resent process. I save the heavy review for one-way doors — schemas, public APIs — where being wrong is expensive."

### B5. How would you introduce or improve an RFC process on a team that has none?

**Sample:** "I'd start with the lightest viable thing: a one-page template in a `rfcs/` directory, with a named decider and a comment-period deadline as the only hard requirements. I'd seed it with two or three real decisions where the process *visibly* helped — a risk caught, a cross-team conflict resolved in writing — because adoption follows demonstrated value, not mandate. I'd guard the lightweight default path against creeping required sections, reserve heavy process for one-way doors, and make sure every accepted RFC produces an ADR so the *why* survives."

---

## Tips for Answering

1. **Lead with the purpose:** align stakeholders, surface risks, get review *while change is cheap.* And "writing is thinking."
2. **Nail the pipeline:** design doc → RFC (opened for comment + decision) → ADR (durable record). Not competitors.
3. **Name the two high-value sections:** Goals/Non-Goals and Alternatives Considered (with *why-rejected*).
4. **Tie process weight to reversibility:** one-way doors get RFCs; two-way doors get build-and-refactor.
5. **Distinguish the artifact from the function:** a doc is a *decision-forcing function*; the best outcome is sometimes "don't build this."
6. **Call out the failure modes by name:** theater, analysis paralysis, over-process, decision-laundering.
7. **Stress point-in-time:** design docs go stale by nature; durable facts live in ADRs and reference docs — don't fight doc rot on a design doc.

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md) · **Up:** [Documentation Roadmap](../README.md)
