# Architecture Decision Records (ADRs) — Interview Questions

> **Category:** [Documentation](../README.md) — a lightweight, append-only record of a single architecturally-significant decision: its context, the decision itself, and its consequences.

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

### J1. What is an ADR, in one sentence?

**Answer:** A short, version-controlled document that records *one* architecturally-significant decision — its **context**, the **decision** itself, and its **consequences** — so future engineers understand *why* the system is the way it is, not just *what* it is.

### J2. What problem does an ADR solve?

**Answer:** Decision **archaeology** — the lost reasoning behind a design. Code shows *what* the system does, never *why* it was built that way. Without ADRs, that "why" lives in people's heads and Slack threads, evaporates when they leave, and forces teams to re-investigate or re-litigate decisions that were already settled.

### J3. Name the five sections of the Nygard ADR template.

**Answer:** **Title, Status, Context, Decision, Consequences.** Michael Nygard's original, canonical format — deliberately tiny so it actually gets written.

### J4. What goes in the Context vs. the Decision vs. the Consequences?

**Answer:** **Context** = the facts and forces that demanded a choice (requirements, constraints, the situation), written for a stranger. **Decision** = what we chose, in active voice ("We will…"). **Consequences** = the trade-offs we knowingly accept — the good *and* the bad.

### J5. What statuses can an ADR have?

**Answer:** **Proposed** (under discussion), **Accepted** (in effect), **Deprecated** (no longer recommended, no replacement yet), **Superseded** (replaced by a specific newer ADR, whose number is recorded).

### J6. Where do ADRs live, and why there?

**Answer:** In the repository, conventionally `docs/adr/`, version-controlled and reviewed in PRs (docs-as-code) — so they travel and version with the code they explain and use the same review/history tooling.

### J7. How are ADRs named and numbered?

**Answer:** Sequentially and zero-padded, as `NNNN-kebab-case-title.md` (e.g. `0007-use-postgresql.md`). Numbers are permanent and never reused — the history is the value.

### J8. When should you write an ADR?

**Answer:** When a decision is architecturally significant. The quick test: **"Would a new senior engineer ask 'why is it like this?'"** If yes, write one. It applies to choices affecting structure, dependencies, interfaces, cross-cutting concerns, or anything expensive to reverse.

### J9. Give two examples of decisions you should *not* write an ADR for.

**Answer:** Trivial, easily-reversible choices: a variable name, a code-formatting/linter rule, an implementation detail inside one function — anything you could undo in an afternoon with no ripple effects.

### J10. Why must Consequences include the downsides?

**Answer:** An ADR with only benefits is advocacy, not a record — and the recorded downsides are what tell a future engineer *when the decision should be revisited.* Naming the costs is what makes the record honest and useful.

---

## Middle Questions

### M1. Why do you supersede an ADR instead of editing it?

**Answer:** ADRs are **append-only history**. Editing an accepted decision erases the fact that we once decided otherwise *and why* — making code from that era unintelligible and the lesson of *why we changed* lost. So you write a *new* ADR that supersedes the old one and change only the old one's **Status line** to `Superseded by ADR-00XX`.

### M2. What is the *only* part of an accepted ADR you may change?

**Answer:** The **Status line** (e.g. `Accepted` → `Superseded by ADR-0023` or `Deprecated`). The Context, Decision, and Consequences are frozen history. (Fixing a typo is fine; changing the substance is not.)

### M3. Compare the Nygard, MADR, and Y-statement templates.

**Answer:** **Nygard** — the five-field baseline (Title/Status/Context/Decision/Consequences); the default. **MADR** — adds explicit **Options Considered** with pros/cons per option and **Decision Drivers**; best when comparing alternatives is the point. **Y-statement** (Zimmermann) — compresses the decision into one structured sentence; best as a summary. Use the lightest template that captures the *why*.

### M4. Recite the Y-statement skeleton.

**Answer:** *In the context of* \<use case\>, *facing* \<concern\>, *we decided for* \<option\> *and against* \<alternatives\>, *to achieve* \<benefit\>, *accepting that* \<trade-off\>.

### M5. What's the difference between an ADR and a design doc / RFC?

**Answer:** A design doc/RFC **proposes** a design and aligns people **before** building (forward-looking, discussion, may go stale). An ADR **records a decision** as durable, immutable history (backward-looking, superseded not edited). They complement each other: **RFC → decision → ADR**, with the ADR distilling the outcome and linking back to the RFC for detail.

### M6. What's the difference between `Deprecated` and `Superseded`?

**Answer:** **Deprecated** = no longer recommended but nothing has replaced it yet (can stand alone). **Superseded** = a specific new ADR replaces it, and that replacing number is recorded. A decision can go `Accepted → Deprecated → Superseded`.

### M7. What is the decision log / index, and why does it matter?

**Answer:** An ordered list of all ADRs (often `docs/adr/README.md`, auto-generated) showing title, status, and date. It's the highest-value onboarding artifact — a new engineer reads it top-to-bottom to absorb the system's reasoning history — and it keeps superseded ADRs discoverable so dropped options aren't blindly re-proposed.

### M8. Can you write an ADR for a decision that was never formally made?

**Answer:** Yes — a **retroactive** ADR. If a choice was an accident of history ("the first person used X and it stuck"), document it now with status `Accepted` and a Context that honestly says it was the de-facto choice, to make it explicit and revisitable. Retroactive ADRs are legitimate and valuable.

---

## Senior Questions

### S1. Explain "architecture as a stream of decisions."

**Answer:** A system's architecture isn't its current diagram — it's the *sequence of decisions* that produced that diagram. The snapshot shows *what*; only the decision log explains *why*, telling you which constraints still hold, which decisions were tied to conditions that have since changed, and what was deliberate vs. accidental. The ADR log is the architecture's causal history, read top-to-bottom because each decision is comprehensible only in the light of the prior ones.

### S2. Why is the Consequences section the most valuable part?

**Answer:** Because it encodes the **trip-wire for revisiting the decision.** A decision is only valid while its accepted trade-offs remain acceptable. Recording "single-node writes are a future ceiling above N orders/min" is exactly what later *triggers* the superseding ADR — the team doesn't rediscover the bottleneck by accident; the ADR named the condition to watch. Write Consequences to name the conditions under which the decision flips.

### S3. How do you decide what's "architecturally significant" at senior level?

**Answer:** Score it on **blast radius** (how many components/teams), **reversibility** (one-way door?), **cross-cutting** reach (auth, consistency, error strategy), **contention** (was it debated?), and **surprise** (would a reader be puzzled?). High on any of these → ADR it. Contention and surprise are signals in themselves: a debated or surprising decision deserves a record even if it seems small, because its reasoning is non-obvious and re-litigation is likely.

### S4. Should ADRs live in each repo or in one central place?

**Answer:** Usually **both, by scope.** Service-level decisions live repo-local (`docs/adr/`, versioned with the code); cross-cutting/org-wide decisions live in a central architecture repo. A common pattern is repo-local ADRs plus a *generated central index* aggregating across repos — proximity *and* discoverability. The discriminator is the decision's scope.

### S5. How do ADRs relate to RFCs as a pipeline?

**Answer:** The RFC is the **deliberation** — broad, exploratory, builds consensus, may age after shipping. The ADR is the **verdict** — narrow, concise, permanent, the durable answer to "why?". The ADR distills the RFC's outcome and links back to it rather than copying the discussion. One RFC may yield several ADRs; a small decision needs no RFC at all (write the ADR directly).

### S6. How do ADRs support architectural governance?

**Answer:** They shift governance from *approval gates* to *transparency and review*. Teams make decisions close to the work, record them as ADRs, and the `Proposed` status is the async review hook for architects/security/compliance. The log becomes the audit trail and the source of cross-team consistency (read existing ADRs before choosing; write one to justify divergence). It scales because there's no central bottleneck, yet reasoning stays visible.

### S7. How are ADRs "to architecture what tests are to behavior"?

**Answer:** Tests pin behavior so you can change code fearlessly; ADRs pin *reasoning* so you can change architecture deliberately — knowing which constraints are load-bearing and which were tied to now-changed conditions. Principles like Clean Architecture describe the *shape* of a good system; ADRs record the *specific decisions* that realized or deliberately departed from that shape, with the context and trade-offs that justified each.

---

## Professional Questions

### P1. Why does the ADR practice so often die, and how do you prevent it?

**Answer:** It dies of **friction and forgetting** — a burst of ADRs, then a crunch, then silence (and a stalled log is worse than none, because it falsely signals completeness). Prevent it by **binding ADRs to PRs** (part of the definition of done, so they're never a separable task), defaulting to a light template, auto-generating the index, and — crucially — *citing ADR numbers* in reviews and onboarding so they're used, not just stored. Health metric: ADRs **referenced**, not ADRs written.

### P2. How do you enforce immutability at organizational scale?

**Answer:** Convention isn't enough — add a **CI check** that fails the build if an *Accepted* ADR's Context/Decision/Consequences changed (only Status edits allowed), plus a link check verifying `Supersedes`/`Superseded by` are bidirectional and no two Accepted ADRs contradict. One silent edit poisons trust in the *entire* log, so enforcement (not just a guideline) is what lets the org trust it without auditing every change.

### P3. What tooling supports ADRs in production?

**Answer:** **`adr-tools`** (CLI to scaffold numbered files, handle supersession bookkeeping, generate the index), **Log4brains** (generates a browsable/searchable ADR website), MADR templates, and CI checks for immutability, supersede-link validity, index freshness, and required-section linting.

### P4. How should an ADR be integrated into the development workflow?

**Answer:** A significant PR includes a **Proposed ADR** alongside the code that embodies the decision; reviewers review *both* the code and the decision; on merge the status flips to **Accepted**. If a Proposed ADR draws too much disagreement to settle in PR comments, escalate it to a full RFC, then return. This writes the ADR at decision time and makes the decision itself reviewable.

### P5. How do you review an ADR (vs. reviewing code)?

**Answer:** You're reviewing *reasoning* for a stranger who wasn't in the room and isn't on the team, in two years. Check: is it one decision? Is Context facts written for a stranger? Are Consequences honest, including the revisit trip-wire? Were real alternatives recorded (MADR)? Is it a one-way door (higher bar / maybe an RFC)? Does it conflict with an existing ADR (must explicitly supersede)? Does it meet the significance bar?

### P6. How do you fight both over-ADR-ing and under-ADR-ing?

**Answer:** Document a concrete **significance bar** (blast radius / reversibility / contention / surprise) with examples (database choice → yes; JSON library → usually no), gate ADRs on it in review, and bind the *trigger* to the PR ("does this change need an ADR?"). Over-ADR-ing trivia buries the significant ones and trains people to ignore the log; under-ADR-ing loses the big calls' reasoning. Both are calibration failures.

---

## Practical Tasks

### C1. Write a complete Nygard ADR for choosing a message queue.

**Sample answer:**

```markdown
# ADR-0014: Use RabbitMQ for task distribution

## Status
Accepted — 2026-05-10

## Context
The image-processing service needs to distribute resize/transcode jobs to
a pool of workers. We need: at-least-once delivery, simple work-queue
semantics (one job → one worker), and low operational overhead. We do NOT
need event replay or multi-consumer fan-out. Job volume is ~2,000/min.

## Decision
We will use **RabbitMQ** with a single work queue and competing consumers
for task distribution.

## Consequences
- Positive: simple, mature work-queue semantics; easy to operate; ack-based
  at-least-once delivery fits our retry needs.
- Negative: not a replayable log — if we later need event sourcing or
  fan-out to many independent consumers, this won't fit and we'll need a
  new decision (likely Kafka). We accept this; those needs don't exist today.
- Neutral: workers must be idempotent to tolerate at-least-once redelivery.
```

*Grading:* one decision; Context is facts for a stranger and names what they *don't* need; Decision is active-voice; Consequences are honest and name the revisit trip-wire (replay/fan-out → reconsider).

### C2. Convert this decision into a Y-statement.

*Decision: "We picked short-lived JWTs with refresh tokens over server-side sessions for the API, to stay stateless and horizontally scalable, knowing we lose easy instant revocation."*

**Sample answer:**

> *In the context of* the public API, *facing* the need for horizontal statelessness, *we decided for* short-lived JWTs with refresh tokens *and against* server-side sessions, *to achieve* stateless, easily-scaled auth, *accepting that* instant token revocation is harder and requires a denylist or short TTLs.

### C3. ADR-0009 (single PostgreSQL) must change because you're sharding. What do you do?

**Sample answer:** I do **not** edit ADR-0009. I write a **new ADR** (next number) stating the sharding decision, whose Context explains *what changed* (e.g., write throughput now exceeds a single node, the condition ADR-0009 flagged) and which notes `Supersedes ADR-0009`. Then I change *only* ADR-0009's **Status line** to `Superseded by ADR-00XX`, leaving its body frozen. The new ADR respects that ADR-0009 was correct for its time. The index regenerates to show both.

### C4. A teammate's PR adds a `PaymentProvider` interface with one implementation "for flexibility," plus an ADR mandating it. How do you review the ADR?

**Sample answer:** I'd question the *significance and present need*: the ADR's Decision encodes speculative flexibility (one implementation, no second provider yet), so its Consequences should honestly say "this adds indirection for a provider that doesn't exist." If there's no present requirement, the seam — and the ADR mandating it — is premature; I'd suggest the concrete type now and an ADR *when* a second provider is real. (This ties to YAGNI / simple design.) If they *do* anticipate a real second provider soon, I'd ask for MADR-style Options-Considered so the reasoning and rejected alternatives are on record.

---

## Trick Questions

### T1. "An ADR is a living document you keep up to date." True?

**False.** An ADR is **append-only history**, *not* a living doc. You never edit an accepted decision; when it changes you write a *new* ADR that supersedes it and change only the old one's Status line. Treating ADRs as living docs (editing them) destroys the historical record and is the cardinal ADR sin.

### T2. "ADRs and RFCs are the same thing." Right?

**No.** An RFC/design doc *proposes* and aligns *before* building (forward-looking, discussion, can go stale); an ADR *records* a decision as durable history (backward-looking, immutable). They complement: RFC → decision → ADR. Conflating them gives you either rotting RFCs pretending to be permanent or bloated ADRs full of stale debate.

### T3. "More ADRs means better documentation." Agree?

**No.** Over-ADR-ing trivial decisions buries the significant ones and trains the team to ignore the log. ADRs are for *architecturally-significant* decisions (blast radius / reversibility / contention / surprise). The health metric is ADRs *referenced*, not ADRs *written*.

### T4. "You should delete superseded ADRs to keep the log clean." Correct?

**No — never delete them.** Superseded ADRs are the historical record; they stay in the log, marked by their Status line and linked to the ADR that replaced them. Deleting them erases *why we once decided otherwise* — often the most valuable lesson. They only *look* like clutter.

### T5. "If two accepted ADRs contradict each other, just pick the newer one." Fine?

**No — that's a bug in the log.** The log must never have two live, contradicting decisions. Resolve it explicitly: write a new ADR that supersedes one (or both) and states the reconciliation. Leaving a silent contradiction means future readers can't tell which decision is in force.

### T6. "An ADR only needs to say what we decided." Sufficient?

**No.** Without the **Context** a future reader can't judge whether the decision still applies, and without honest **Consequences** they have no trip-wire for when to revisit it. "We use Kafka" is already visible in the code; the ADR's job is the *why* and the *trade-offs*.

---

## Behavioral Questions

### B1. Tell me about a time missing decision rationale cost you.

**Sample:** "I inherited a service that stored sessions in Redis with a 15-minute TTL and no explanation. I assumed it was arbitrary and bumped it to an hour — and broke a security requirement nobody had documented; short TTLs were a compliance control. We'd have avoided it with a two-minute ADR. After that I introduced ADRs on the team, starting by backfilling that exact decision."

### B2. Describe how you introduced ADRs to a team.

**Sample:** "I wrote ADR-0001 ('we record architecture decisions'), picked the lightweight Nygard template, and backfilled three existing decisions so people immediately saw the value ('oh, *that's* why we use Kafka'). Then I made it part of the definition of done — any significant PR includes a Proposed ADR reviewed with the code — and auto-generated the index. Binding it to the PR workflow is what kept it from fizzling out after the first month."

### B3. Tell me about a decision you superseded.

**Sample:** "We'd chosen single-primary PostgreSQL early, and the ADR explicitly flagged single-node write throughput as the future ceiling. Two years later we hit it, exactly as recorded. I wrote a new ADR adopting sharded storage, whose context referenced the old one and noted it was correct for its scale — then flipped the old ADR's status to Superseded. I framed it to the team as the log working as designed, not as anyone having decided wrong."

### B4. How do you handle a teammate who makes big decisions in Slack and never records them?

**Sample:** "I'd make the cost concrete — point to a recent case where lost rationale burned us — and lower the friction so there's no excuse: an ADR is a ten-minute Markdown file in the PR they're already making. I'd also lead by example and cite ADR numbers in reviews, so the norm becomes visible. If they're senior, I'd stress that the most senior people writing ADRs is the strongest signal that it matters."

### B5. How do you keep an ADR practice alive over years?

**Sample:** "Wire it into the workflow so it doesn't depend on willpower: ADRs bound to PRs as part of 'done,' a PR-template checkbox for significance, a light template, an auto-generated searchable index, and a CI immutability check so the log stays trustworthy. Culturally, I celebrate clean supersession as success and *cite* ADR numbers in design discussions — a log that's referenced stays alive; one that's only written becomes a fossil."

---

## Tips for Answering

1. **Lead with "ADRs capture the *why*"** — context + decision + consequences — and that code only shows the *what*.
2. **Name the Nygard five** (Title/Status/Context/Decision/Consequences) and that it's deliberately minimal so it gets written.
3. **Nail immutability:** append-only history; never edit a decision, supersede it; only the Status line may change.
4. **Get ADR-vs-RFC exactly right:** RFC proposes/aligns *before* (forward-looking); ADR records the decision as durable history (backward-looking); RFC → decision → ADR.
5. **Tie significance to blast radius and reversibility**, and quote the "would a new senior ask why?" test.
6. **Stress honest Consequences as the revisit trip-wire**, and the "architecture as a stream of decisions" framing for senior depth.
7. **For sustaining it, say: bind to PRs, light template, auto-index, CI immutability, and *cite* ADR numbers** — usage is the health metric.

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md)
