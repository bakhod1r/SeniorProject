# Domain Modeling from Requirements — Professional

> **What?** At the professional level, domain modeling stops being a one-person sketching exercise and becomes a *team practice*: workshops with experts, a glossary that lives next to the code, ArchUnit rules that defend bounded contexts, onboarding rituals that hand the model down, and the courage to call a "model refactoring" sprint when the language has decayed.
> **How?** Run the workshop, capture the language, encode the boundaries, walk new hires through it, watch for decay, document the why. Treat the model as a living artifact owned by the whole team — not a diagram that lives on someone's hard drive.

This page is for the tech lead, staff engineer, or modeling steward who is responsible for the *quality of the domain model across a team or a service portfolio*. Junior covered the basics; middle covered Event Storming; senior covered legacy and microservice boundaries. Here we cover the leadership rituals.

---

## 1. Running a domain-modeling workshop — a 2-hour script

A modeling workshop is the single highest-leverage activity a tech lead can run. Two hours with the right people in the room beats two weeks of solo design.

**Before the meeting** (the day before):

- Pick **one** business process. *"How an insurance claim moves from FNOL to payout."* Not "the whole claims domain."
- Invite at most eight people: two or three domain experts (claims handler, underwriter, fraud analyst), three engineers, and one facilitator (you).
- Print a one-page scenario: a concrete example, e.g. *"Maria's car is rear-ended on March 3. She files a claim by app. The claim is approved on March 7. Payout reaches her account March 10."*
- Have stickies and a wide wall, or a Miro board if remote.

**Hour 1 — diverge.**

- **0–10 min** — Read the scenario aloud. Ask each expert to add one fact you didn't know. ("If the damage is under EUR 1500, it doesn't need an adjuster.")
- **10–40 min** — Place orange stickies for *domain events*, past tense: `ClaimFiled`, `EvidenceUploaded`, `DamageAssessed`, `PayoutAuthorized`. Time-order them left to right. No discussion yet; just capture.
- **40–60 min** — Walk the timeline. For each event, ask: *who triggered it?*, *what decision happened just before it?*, *what could go wrong?* Add red stickies for problems and hot spots.

**Hour 2 — converge.**

- **60–80 min** — Group events into *aggregates* and *bounded contexts*. The claim itself is one aggregate; the payout might be another. Disagreements here are gold — they reveal language drift.
- **80–100 min** — Pick the two thorniest hot spots and ask: *"If we modeled this rule correctly, what would the code look like?"* Sketch one class header on the whiteboard. No methods yet, just names.
- **100–115 min** — Capture *open questions* on a separate column. These become Slack threads or follow-up interviews.
- **115–120 min** — Assign one engineer to write up the model and one expert to review it within 48 hours. Then end on time.

> *Code review:* "Did the workshop output ever make it into the repo, or is it still on a Miro board no one looks at?"
> *Author:* "Yeah, I'll add the glossary entries today and link the ADR."

The workshop's deliverable is not consensus — it's a shared vocabulary and a list of disagreements worth fighting about.

---

## 2. A ubiquitous-language glossary that lives in the repo

Glossaries on Confluence go stale within a quarter. Glossaries in the repo, reviewed in PRs, stay alive.

Layout:

```
/docs/domain/
  glossary.md
  context-map.md
  adr/
    0007-split-policy-from-claim.md
    0011-rename-customer-to-policyholder.md
```

Sample `glossary.md` entry:

```markdown
### Claim
A request by a policyholder for compensation under their policy. Lifecycle:
*Filed -> UnderReview -> Approved | Rejected -> PaidOut | Closed*.

- Aggregate root: `claims.domain.Claim`
- Identifier: `ClaimNumber` (format: `CLM-YYYY-######`)
- NOT to be confused with *Incident* — an Incident is the underlying event
  (e.g. a car crash). One Incident may produce zero, one, or many Claims.

Source: agreed in 2025-11 workshop with Maria K. (claims ops).
Last reviewed: 2026-02-14.
```

Three rules that make the glossary survive:

1. **Every new domain class requires a glossary entry in the same PR.** Enforce in code review. No entry, no merge.
2. **Renames go through an ADR.** If `Customer` becomes `Policyholder`, write a short ADR explaining why the experts asked for the change, and link it from both the old and the new entry.
3. **The glossary owns the truth.** When a Slack debate breaks out over a term, the answer is "what does the glossary say?" — and if the glossary is wrong, update it.

> *Code review:* "There's a new `Settlement` class but no glossary entry. What does it mean, and how is it different from `Payout`?"

A glossary entry is cheaper than a meeting. Train the team to write them.

---

## 3. Code-review phrases that defend the model

The model decays one PR at a time. Tech leads keep it alive through *consistent vocabulary in reviews*. Memorize and reuse these phrases — they teach by repetition.

- **"Does this name match what the experts say?"** — When you see `PaymentTransaction` and the business says "payout", flag it. Cheap to fix on day one, expensive after twenty references.
- **"Where in the bounded context does this live?"** — When you see a class in `com.acme.shared`, ask which context owns it. "Shared" is usually a euphemism for "we didn't decide."
- **"Which aggregate enforces this invariant?"** — If validation is in a service, ask why the aggregate doesn't own it.
- **"Whose decision is this?"** — When a service makes a domain decision, push it into the aggregate that owns the data.
- **"Is this a domain event or a database update?"** — Distinguish things the business cares about from incidental persistence.
- **"What word would the expert use here?"** — Reach for ubiquitous language instead of inventing one.

> *Code review:* "This `OrderProcessor.process(order)` — whose decision is `process()`? I can't picture an expert saying it. Can we name the actual transition: `confirm`, `authorize`, `dispatch`?"
> *Author:* "Right. I'll split it into `confirmPayment` and `scheduleDispatch`."

Use the same phrases for a year. Juniors will start using them on each other's PRs. That's when the practice has stuck.

---

## 4. ArchUnit rules for context boundaries

Documents drift; tests don't. ArchUnit lets you encode the context map as executable rules.

```java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

@AnalyzeClasses(packages = "com.acme.claims")
class ContextBoundaryTest {

    @ArchTest
    static final ArchRule claims_must_not_depend_on_billing =
        noClasses().that().resideInAPackage("..claims.domain..")
                   .should().dependOnClassesThat()
                   .resideInAPackage("..billing.domain..");

    @ArchTest
    static final ArchRule claims_talks_to_billing_via_acl =
        classes().that().resideInAPackage("..claims..")
                 .and().dependOnClassesThat().resideInAPackage("..billing..")
                 .should().resideInAPackage("..claims.acl..");

    @ArchTest
    static final ArchRule domain_must_not_depend_on_spring =
        noClasses().that().resideInAPackage("..domain..")
                   .should().dependOnClassesThat()
                   .resideInAPackage("org.springframework..");

    @ArchTest
    static final ArchRule no_jpa_in_domain =
        noClasses().that().resideInAPackage("..domain..")
                   .should().dependOnClassesThat()
                   .resideInAPackage("jakarta.persistence..");
}
```

What these rules buy you:

- A junior who tries to inject a `BillingRepository` into a `Claim` aggregate gets a red build, not a polite comment three days later.
- A refactor that accidentally exposes JPA annotations on the domain fails CI.
- The Anti-Corruption Layer becomes the *only* path between contexts, by construction.

> *Code review:* "ArchUnit is failing on `ClaimsService.computeBilling`. Looks like a cross-context import. Do we need an ACL adapter here, or did we mean to extract a shared kernel?"

Add a new rule whenever you fix a violation manually. The test suite is the model's immune system.

---

## 5. Onboarding new hires with model walk-throughs

The fastest way to make a new hire dangerous (in a good way) is a 90-minute *model walk-through* in their first week. Skip the org chart. Skip the AWS account tour. Open the code.

Suggested flow:

1. **Pick one user-facing scenario.** *"A policyholder files a claim through the app."* Same one the workshop used.
2. **Open the API endpoint that starts it.** Walk down: controller -> application service -> aggregate. Pause at each layer and ask, *"What's this layer's job?"*
3. **Stop at the aggregate's command method** (`claim.file(...)`). Read it aloud. Point out the invariants. Ask the new hire to predict what would happen if you removed one.
4. **Pull up the glossary.** Show how every name in the code traces back to a term the experts use. Read three entries.
5. **Open the context map.** Point at the bounded context the code belongs to. Show one ACL adapter to a neighboring context.
6. **Show one ADR** that captures a hard past decision. Explain the trade-off. ("We renamed `User` to `Policyholder` in Q3 because legal needed the distinction.")
7. **Give them a starter task that requires touching the model.** Not infra. Not docs. The model. Pair with them on the PR.

> *New hire (day 4):* "I want to add a `claim.escalate(reason)` method. Does that match what experts say, or do they call it something else?"
> *You:* "Great question — let's go ask Maria before we name it."

This routine turns the model into shared property within a week.

---

## 6. When to call a model-refactoring sprint

Domain models decay slowly, then suddenly. A tech lead's job is to *notice the slow phase* and call a model-refactoring sprint before the sudden one (a multi-month rewrite).

Symptoms that the model has drifted:

- **Vocabulary drift.** Engineers say one word in standup; the business says another for the same concept. Slack search shows the disagreement going back six months.
- **God aggregates.** `Claim` is now 1400 lines, and every new feature is "add a field on Claim and a flag."
- **Service-layer creep.** Domain logic is migrating into `*Service` and `*Manager` classes. Aggregates are shrinking to anemic data holders.
- **"Helper" packages.** `claims.util`, `claims.misc`, `claims.shared` have started accumulating logic with no clear owner.
- **ArchUnit silence.** No new boundary rules in a year, but lots of new cross-package dependencies. The immune system has gone quiet.
- **PR template drift.** Reviews stop mentioning the glossary or asking "whose decision is this?"
- **Onboarding lag.** New hires take three months instead of three weeks to ship safely.

Two or three of these together is a yellow light. Four or more is red.

How a refactoring sprint works:

- One or two weeks, dedicated. Not "as we have time."
- Outcome: one or two aggregates split, glossary refreshed, ADRs written, ArchUnit rules added, one workshop rerun with experts to re-align vocabulary.
- *Do not ship features during the sprint.* Defend the time aggressively. The cost of decay compounds.

> *Tech lead to engineering manager:* "We're going to spend next sprint splitting `Claim` into `Claim` and `Settlement`. We had four PRs in the last month touching unrelated parts of `Claim` and breaking each other. We'll come back faster."

---

## 7. Anti-patterns juniors will introduce

Predict these. Catch them in review. Teach the principle, not just the fix.

**Schema-driven design.** Junior opens the database, sees a `claims` table with twelve columns, writes a `Claim` class with twelve fields and getters. The model now mirrors the schema, not the domain.

- **Phrase:** "What does a `Claim` *do*? Show me a method that isn't a getter."

**Technical names.** `ClaimEntity`, `ClaimDTO`, `ClaimManager`, `AbstractClaimHelper`. None of these are words a claims handler would use.

- **Phrase:** "Strip the `Entity` and `Manager` suffixes. What's left? If it's a verb, it might be a method, not a class."

**Primitive obsession in the domain.** `String claimNumber`, `BigDecimal amount`, `int statusCode`. Every primitive is a missed value object.

- **Phrase:** "Wrap it. `ClaimNumber`, `Money`, `ClaimStatus`. Each wrapper validates on construction."

**Service-as-default.** Every new behavior becomes a method on `ClaimService`. Aggregates stay empty.

- **Phrase:** "Move this into the aggregate. The service should orchestrate; it shouldn't decide."

**Optional everywhere.** `Optional<Address>`, `Optional<Policyholder>`, `Optional<Money>`. A sign the invariants aren't clear.

- **Phrase:** "When is this actually absent? If always-present, drop the `Optional`. If sometimes-absent, model the two states explicitly."

**Anemic events.** `ClaimUpdated(claimId, fieldName, oldValue, newValue)`. This is a database changelog, not a domain event.

- **Phrase:** "What did the *business* see happen? `ClaimApproved`, `ClaimRejected`, `EvidenceRequested` — name the moment, not the diff."

**Cross-context references.** `Claim` holds a `BillingAccount` field directly.

- **Phrase:** "What does Claim need from Billing — the whole account, or just an identifier? Almost always: an identifier and an ACL."

---

## 8. Documenting the model — context maps, ADRs, glossary

Three artifacts, kept in sync, are enough.

**Context map.** One diagram in `/docs/domain/context-map.md`, updated by hand when boundaries change. Show contexts as boxes and the relationship type on each arrow (Customer/Supplier, Shared Kernel, ACL, Conformist). Avoid auto-generated diagrams — they over-detail and lose the *intent*.

**ADRs (Architecture Decision Records).** One per significant modeling decision. Template:

```markdown
# ADR-0011: Rename Customer to Policyholder

## Status
Accepted (2026-02-04)

## Context
Legal and claims ops use "policyholder" for someone with an active policy and
"customer" for any registered user — including those who have churned. Our
codebase used `Customer` everywhere, causing ambiguity in claims workflows.

## Decision
Rename `Customer` to `Policyholder` in the claims and billing bounded contexts.
Keep `Customer` only in the marketing context, where the broader meaning
applies. Cross-context references use a `PolicyholderId` value object.

## Consequences
- Glossary updated.
- ArchUnit rule added: marketing.Customer may not be referenced from claims.
- API path `/customers/{id}/claims` kept for backward compatibility (deprecation
  notice in v3, removal in v4).
```

**Glossary.** As described in section 2. The single source of truth for what each domain word means.

What *not* to produce:

- UML diagrams with 60 classes. Nobody reads them, they go stale, and they implicitly endorse schema-driven thinking.
- "Domain documentation" wikis with screenshots of code. Code is the documentation; the wiki is duplication waiting to lie.
- Auto-generated entity-relationship diagrams. They show the schema, not the model.

> *Code review:* "This PR renames `Customer` to `Policyholder`. Where's the ADR? And the glossary update?"

---

## 9. Quick rules

- [ ] Run a 2-hour modeling workshop before any major new feature; capture events, decisions, and disagreements.
- [ ] Keep the glossary in the repo; every new class needs an entry in the same PR.
- [ ] Drill code-review phrases until the team uses them on each other: *"What word would the expert use?"*, *"Whose decision is this?"*
- [ ] Encode context boundaries in ArchUnit; treat boundary violations as build failures.
- [ ] Onboard new hires with a 90-minute model walk-through in their first week.
- [ ] Watch for vocabulary drift, god aggregates, and service-layer creep — call a refactoring sprint before they compound.
- [ ] Document with a context map, ADRs, and a glossary. Skip the 60-class UML.
- [ ] Catch schema-driven design, technical names, and primitive obsession early; teach the principle behind the fix.
- [ ] Treat the model as a team-owned artifact, not a lead's private sketch.

---

## 10. What's next

| Topic                                                          | File                                              |
| -------------------------------------------------------------- | ------------------------------------------------- |
| CRC cards, the technique behind workshop sketching             | `../05-crc-cards-technique/professional.md`       |
| Tactical DDD — aggregates, repositories, domain services       | `../../08-tactical-ddd/professional.md`           |
| Refactoring techniques applied to legacy domain models         | `../../../../../06-refactoring/`                  |
| Architecture decision records as a team discipline             | `../../../../../11-architecture/adr/`             |
| Hands-on workshop exercises                                    | `tasks.md`                                        |
| Interview Q&A on running modeling practices                    | `interview.md`                                    |

---

**Memorize this:** the model is a team artifact, not a personal sketch. Run the workshop, write the glossary into the repo, encode boundaries in ArchUnit, walk new hires through the model in week one, and call a refactoring sprint the moment vocabulary drift, god aggregates, or service-layer creep appear. The leader's job is to keep the language alive — because the day the team stops speaking the domain, the system stops being the domain.
