# Contract Testing — Interview Level

> **Roadmap:** [Testing](../README.md) → Contract Testing
>
> *A question bank for proving you understand the seam between services — and its limits.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [CDC vs Provider-Driven](#cdc-vs-provider-driven)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering contract-testing questions with precision — especially the line between interface agreement and business behavior.**

Interviewers use contract testing to probe whether you understand distributed-system testing trade-offs: why E2E doesn't scale, how consumer-driven contracts prevent silent breakage, what `can-i-deploy` actually does, and — the differentiator — *what contract testing does not do*. Answers below use **Q** / *what's really being tested* / **A** format. Aim for crisp, concrete answers with the right vocabulary (consumer/provider, pact, broker, matcher, provider state, can-i-deploy).

---

## Prerequisites

- Read [junior.md](junior.md) through [professional.md](professional.md) — this file assumes that material.
- Be ready to sketch the Pact loop on a whiteboard from memory.
- Be able to state, in one sentence, what contract testing does *not* cover.

---

## Fundamentals

**Q1. What problem does contract testing solve?**
*Testing: do you understand the combinatorial cost of integrated testing?*
**A.** In microservices, gaining confidence via end-to-end testing means deploying every consumer against every provider in a shared environment — combinatorially expensive, slow, and flaky (the more services, the lower the chance they're all healthy at once, and the harder it is to attribute a failure). Contract testing replaces "test them together" with "test each side against a shared contract": the consumer proves it works against the contract, the provider proves it satisfies the contract, each in isolation. No shared environment, clear blame, fast.

**Q2. What exactly is a contract?**
*Testing: do you know the artifact, not just the buzzword?*
**A.** A machine-readable list of *interactions* a consumer expects from a provider — for HTTP: request (method, path, headers, body) and expected response (status, headers, body shape), plus named provider states. Crucially it captures the *shape and semantics at the boundary* (via matchers), not exact values and not internal logic. In Pact it's a JSON "pact file."

**Q3. Define consumer and provider.**
*Testing: basic vocabulary.*
**A.** The consumer *calls* the API and depends on the response shape; the provider *exposes* the API and owns the implementation. The same service can be a consumer of one API and a provider of another.

**Q4. What does contract testing NOT do?**
*Testing: the single most important distinction — many candidates miss it.*
**A.** It verifies the *interface agreement* — message shape and semantics at the boundary — not *business behavior*. It won't tell you a payment amount is computed correctly, that fraud rules ran, or that a workflow across multiple calls is right. It's not a replacement for the provider's own functional/unit tests, and it doesn't cover non-functional concerns (latency, auth correctness). It guards the seam's shape; behavior is covered by unit tests and a thin E2E layer.

---

## Technique

**Q5. Walk me through the full Pact loop.**
*Testing: end-to-end mechanical understanding.*
**A.** (1) The consumer test runs against Pact's *mock provider*, exercising real client code; it records expected interactions into a *pact file*. (2) The consumer's CI *publishes* the pact to a *Pact Broker*, tagged with version (git SHA) and branch. (3) The provider's CI *pulls* the consumer's pacts and *replays* each request against the *real* provider, using *state handlers* to set up each provider state. (4) It checks responses against the pact's *matching rules* and publishes the verification result to the broker. (5) Before deploy, each side runs *`can-i-deploy`* to confirm nothing in the target environment breaks.

**Q6. In a pact file, what's the difference between the response body and matchingRules?**
*Testing: do you know what's actually asserted?*
**A.** The body holds *example values* so the mock returns realistic data and the provider can shape its test fixtures. The `matchingRules` hold the *actual assertions* — type/shape/regex constraints. A field with an `integer` matcher passes for any integer, not the literal example. This is why you use matchers (`like`, `eachLike`, `integer`) instead of literals: the contract should test *shape*, not business values.

**Q7. What is a provider state and who owns it?**
*Testing: understanding the consumer/provider coordination point.*
**A.** A named precondition (e.g. `"payment 42 exists"`) that the provider sets up before verifying an interaction. The *consumer names it* (via `given(...)`); the *provider implements it* (a state handler that seeds the DB/mocks so the replayed request returns the expected shape). It's how verification stays deterministic without coupling the contract to specific data.

**Q8. What does `can-i-deploy` do, and why is it the killer feature?**
*Testing: the deployment-gate concept.*
**A.** Before deploying pacticipant version X to an environment, it queries the broker's *deployment matrix* (consumer versions × provider versions × verification results) and answers: "is every consumer *currently in that environment* still satisfied by version X?" It runs no tests — it's a lookup over recorded results, so it's fast and deterministic. It's the killer feature because it converts contract testing from a nicer integration test into a *release gate*: a provider change that would break a live consumer is blocked before deploy, replacing a shared pre-prod environment for catching interface breaks.

```bash
pact-broker can-i-deploy --pacticipant PaymentsService \
  --version "$GIT_SHA" --to-environment production
```

**Q9. Adding a new field to a provider response — does existing verification fail? What about removing a field a consumer reads?**
*Testing: compatibility intuition.*
**A.** Adding a field: *safe* — consumers ignore fields they don't reference, and matchers assert only on what the consumer reads. Removing or renaming a field a consumer reads: *verification fails* — the matching rule for that field no longer matches the live response. This asymmetry (additive = safe, subtractive = breaking) is the heart of compatible API evolution.

---

## CDC vs Provider-Driven

**Q10. Why "consumer-driven"? What does it buy you?**
*Testing: the load-bearing design decision.*
**A.** In consumer-driven contracts the *consumer* decides what's in the contract — only what it actually uses. Because the broker holds every consumer's contract, the provider's verification replays *all of them*, so the provider cannot drop a field that *some* consumer reads without verification failing — even a consumer the provider team forgot existed. That "no silent breakage" guarantee is the payoff, and it's why CDC suits internal, enumerable consumers.

**Q11. When would you NOT use consumer-driven Pact?**
*Testing: knowing the tool's boundary.*
**A.** When you can't enumerate consumers — a public or partner API with unknown clients. You can't run consumer-driven verification against consumers you can't list, so you switch to schema-based testing (validate against an OpenAPI/JSON Schema) plus formal API versioning and deprecation windows. Also, for gRPC, the schema *is* the contract — use `buf` breaking-change detection. Many orgs run a hybrid: Pact internally, schema-based at the public edge.

**Q12. Compare Pact, Spring Cloud Contract, and schema-based approaches.**
*Testing: landscape awareness.*
**A.** *Pact* is consumer-driven, interaction-based, supports HTTP and async messages — strongest "no silent break" guarantee, needs consumer participation. *Spring Cloud Contract* is provider-driven: the provider authors contracts and the tooling generates provider tests and consumer stubs — convenient in Spring shops but weaker guarantee (provider can drop unmentioned fields). *Schema-based* (OpenAPI/JSON Schema for REST, Protobuf/`buf` for gRPC, AsyncAPI for events) validates against a declared interface — no consumer participation needed, ideal for public/unknown consumers, but doesn't know who reads what.

**Q13. What is bi-directional contract testing?**
*Testing: a more advanced PactFlow concept.*
**A.** It statically cross-checks a consumer's pact against the provider's *published schema* (e.g. OpenAPI) instead of running provider verification — confirming every consumer interaction is *allowed* by the provider's spec. The benefit: no need to run the provider. The catch: it's only as trustworthy as the provider's evidence that its real API actually matches its published spec, so providers must back the schema with their own tests.

---

## Scenarios

**Q14. A consumer reads `amount` as cents; the provider quietly switches to dollars but keeps it an integer. Does contract testing catch it?**
*Testing: the behavior-vs-shape boundary, applied.*
**A.** No. The shape is unchanged — still an integer — so the matcher passes. This is *semantic* drift, not *structural*, and contract testing only guards shape/semantics at the boundary level it can express. Mitigations: encode the unit in the field name (`amountCents`) or type so a change *is* structural, and cover the semantic correctness in the provider's own functional tests. This is the classic interview trap that separates people who really understand contract testing's limits.

**Q15. How do you adopt contract testing across 30 services without breaking provider builds?**
*Testing: org-scale adoption judgment.*
**A.** Turn on *pending pacts* and *WIP pacts* on every provider. A newly published consumer contract that's never been verified is included *for information* but does **not fail** the provider's build; once the provider satisfies it the first time, it hardens and future regressions fail. This lets you enable contract testing everywhere at once without a coordination freeze. Combine with: broker as platform infra, `record-deployment` after every deploy (so `can-i-deploy` is accurate), standardized version/branch metadata, and a templated gate. Measure edge coverage and breaks-caught, not contract count.

**Q16. Your `can-i-deploy` gate gives wrong answers — it cleared a deploy that broke a live consumer. What's the likely cause?**
*Testing: operating the gate.*
**A.** Almost certainly missing or stale `record-deployment` calls — the broker's view of "what's in production" is wrong, so the gate compared against the wrong consumer versions. Other suspects: the provider never published verification results (`publishVerificationResult` off), or the contract uses literal/over-loose matchers that didn't actually assert the broken field. The gate runs no tests, so a wrong answer is a *data* problem, not a flaky-test problem.

**Q17. How does contract testing change your test pyramid and E2E suite?**
*Testing: strategic placement.*
**A.** It adds a broad contract layer that absorbs interface-drift checks previously done by slow, flaky E2E tests. As contract coverage rises you *deliberately delete* most of those E2E tests, keeping only a thin layer for true multi-service *behavior* of critical journeys. A shrinking E2E suite is the clearest ROI signal of the contract program. Contract tests are fast (consumer side runs against a mock; provider side against a single live service), so they sit low in the pyramid.

**Q18. How do contracts work for async/event-driven systems?**
*Testing: beyond HTTP.*
**A.** Via *message pacts*: the unit of contract is the message body/metadata, decoupled from transport. The consumer test asserts its handler works against the contracted message shape; the provider verifies it *produces* messages of that shape. Broker, versioning, and `can-i-deploy` work identically. Schema-based async uses AsyncAPI the way OpenAPI serves sync APIs.

---

## Rapid-Fire

**Q19. What artifact does the consumer test produce?** — A pact file (the contract).
**Q20. What does the provider do with it?** — Pulls it from the broker and replays its requests against the real provider, asserting via matching rules.
**Q21. What is the Pact Broker?** — The registry storing pacts and verification results; answers `can-i-deploy`; supports webhooks. PactFlow is the hosted version.
**Q22. Why matchers instead of literal values?** — So the contract tests *shape/type*, not business values (which would make it brittle and turn it into a behavior test).
**Q23. What's a pacticipant?** — A participant in a contract: a consumer or a provider, identified by name.
**Q24. Additive change = ?** — Safe (consumers ignore unknown fields). **Subtractive/rename of a read field = ?** — Breaking (verification fails).
**Q25. What does `buf breaking` enforce for Protobuf?** — Don't change field types, don't reuse field numbers, reserve removed fields — wire/JSON compatibility, statically, no consumer pacts needed.
**Q26. What makes the gate fast?** — It's a lookup over recorded results; no code runs.
**Q27. What enables blocker-free org rollout?** — Pending + WIP pacts.
**Q28. One sentence: what contract testing does NOT do?** — It verifies the interface agreement, not business behavior.

---

## Red Flags / Green Flags

**Green flags (strong candidate):**
- States crisply that contract testing checks *interface agreement, not business behavior* — unprompted.
- Knows matchers assert shape; the body is just an example.
- Explains *why* "consumer-driven" gives the no-silent-break guarantee.
- Describes `can-i-deploy` as a lookup over the deployment matrix, placed before deploy.
- Picks the right mechanism per boundary (Pact internal, schema/`buf` for public/gRPC).
- Mentions pending pacts for adoption and `record-deployment` for gate accuracy.
- Frames the payoff as *deleting E2E tests*.

**Red flags (weak candidate):**
- Thinks contract testing verifies that the API "works correctly" (behavior).
- Uses literal-value assertions in contracts.
- Believes it replaces *all* integration and E2E tests.
- Can't explain who owns the contract content (it's the consumer).
- Thinks `can-i-deploy` runs tests.
- Would use consumer-driven Pact for an unknown public API.
- Misses that adding a field is safe but removing a read field is breaking.

---

## Cheat Sheet

```
One-liner: test each side against a shared contract, not together.
Boundary: verifies INTERFACE AGREEMENT (shape/semantics), NOT business behavior.

Loop: consumer test vs mock → pact file → broker → provider replays vs real
      → publishVerificationResult → can-i-deploy gate → deploy → record-deployment.

Matchers assert SHAPE; body is an EXAMPLE.
Additive change = safe; remove/rename a READ field = breaking.

can-i-deploy = lookup over deployment matrix (no tests run); place BEFORE deploy.
Consumer-driven = no silent break (broker holds every consumer's needs).

Mechanism by boundary:
  internal svc↔svc → Pact/CDC | public/unknown → schema (OpenAPI)
  gRPC → buf breaking          | provider-owns → Spring Cloud Contract
  can't run provider → bi-directional | async → message pacts / AsyncAPI

Org rollout: enablePending + WIP pacts; record-deployment everywhere;
  measure edge coverage + breaks-caught (not contract count); shrink E2E suite.
```

---

## Summary

Strong contract-testing answers hinge on one distinction: it verifies the **interface agreement** at the seam — shape and semantics via matchers — **not business behavior**. Be able to walk the Pact loop end-to-end, explain why *consumer-driven* prevents silent provider breakage, describe `can-i-deploy` as a fast lookup over the deployment matrix that gates releases, and choose the right mechanism per boundary (Pact for internal, schema/`buf` for public/gRPC, message pacts for async). For seniority, talk org adoption (pending/WIP pacts, accurate `record-deployment`, edge-coverage metrics) and frame the payoff as *deleting most of a flaky E2E suite*.

---

## Further Reading

- Pact docs — *How Pact works*, *can-i-deploy*, *Pending pacts*, *Message pacts*.
- *Consumer-Driven Contracts* (Ian Robinson, martinfowler.com).
- PactFlow — *Bi-directional contract testing*.
- `buf` docs — *Breaking change detection*.
- The `api-versioning`, `api-testing`, and `microservice-communication` skills.

---

## Related Topics

- [Contract Testing — Senior](senior.md) — `can-i-deploy`, schema vs Pact, async contracts.
- [Contract Testing — Professional](professional.md) — org-wide adoption and governance.
- [End-to-End Testing](../04-end-to-end-testing/interview.md) — the layer contracts let you shrink.
- [Integration Testing](../03-integration-testing/interview.md) — in-service boundary tests.
- [Test Strategy and the Pyramid](../01-test-strategy-and-the-pyramid/interview.md) — where contract tests sit.
