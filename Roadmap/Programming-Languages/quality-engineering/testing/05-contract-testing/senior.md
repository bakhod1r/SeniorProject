# Contract Testing — Senior Level

> **Roadmap:** [Testing](../README.md) → Contract Testing
>
> *The can-i-deploy gate, schema-based vs Pact, bi-directional contracts, and async/event contracts.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — can-i-deploy and the deployment matrix](#core-concept-1--can-i-deploy-and-the-deployment-matrix)
5. [Core Concept 2 — Wiring can-i-deploy into CD](#core-concept-2--wiring-can-i-deploy-into-cd)
6. [Core Concept 3 — Pact vs schema-based contract testing](#core-concept-3--pact-vs-schema-based-contract-testing)
7. [Core Concept 4 — Protobuf/gRPC compatibility with buf](#core-concept-4--protobufgrpc-compatibility-with-buf)
8. [Core Concept 5 — Bi-directional contract testing](#core-concept-5--bi-directional-contract-testing)
9. [Core Concept 6 — Async and event-driven message contracts](#core-concept-6--async-and-event-driven-message-contracts)
10. [Core Concept 7 — Spring Cloud Contract and provider-driven flows](#core-concept-7--spring-cloud-contract-and-provider-driven-flows)
11. [Core Concept 8 — Boundaries: what contracts will not catch](#core-concept-8--boundaries-what-contracts-will-not-catch)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **turning verified contracts into a deployment gate, and choosing the right contract mechanism per protocol.**

By now you know the Pact loop. The senior question is: *what do you do with the verification results?* The answer — and contract testing's killer feature — is **`can-i-deploy`**: before releasing provider vX, ask the broker whether every consumer *currently in production* is still satisfied. If yes, deploy; if no, block. This converts contract testing from "a nicer integration test" into a *release safety mechanism*.

This tier also surveys the landscape beyond Pact — schema-based testing (OpenAPI/JSON Schema, Protobuf/gRPC, `buf` breaking-change detection), bi-directional contracts, and message contracts for async systems — so you can pick the right tool per boundary.

---

## Prerequisites

- You completed [middle.md](middle.md): the Pact loop, broker, provider states, versioning.
- You operate a CD pipeline and understand deploy gates.
- You've worked with at least one of: OpenAPI, JSON Schema, gRPC/Protobuf.
- Familiar with event-driven systems (queues/streams); see the `microservice-communication` skill.
- Familiar with [API versioning](../README.md) concepts (the `api-versioning` skill).

---

## Glossary

| Term | Meaning |
|------|---------|
| **can-i-deploy** | A broker query: is it safe to deploy pacticipant version X to environment E, given what's already there? |
| **Deployment matrix** | The cross-product of consumer versions × provider versions × verification results. |
| **Schema-based testing** | Validating messages against a schema (OpenAPI/JSON Schema/Protobuf) rather than recorded interactions. |
| **Bi-directional contract testing** | Cross-checking a provider's published schema against each consumer's pact, without running provider verification. |
| **Message pact** | A contract over an async message (event/command) rather than an HTTP request/response. |
| **buf** | A Protobuf tooling suite that includes wire/source breaking-change detection. |
| **Provider-driven** | Contract derived from the provider's own spec/tests (e.g. Spring Cloud Contract). |
| **Wire compatibility** | Whether a serialized message produced by old code can be read by new code, and vice versa. |

---

## Core Concept 1 — can-i-deploy and the deployment matrix

The broker tracks, for every interaction, *which provider versions have verified which consumer versions*. That table is the **deployment matrix**:

```
                 PaymentsService versions
                 v1 (prod)   v2 (staging)   v3 (candidate)
OrdersService
  v7 (prod)         ✅            ✅              ✅
  v8 (staging)      ✅            ✅              ❌   ← v3 drops a field v8 reads
MobileApp
  v3 (prod)         ✅            ✅              ✅
```

`can-i-deploy` answers a precise question against this matrix:

> "If I deploy **PaymentsService v3** to **production**, is every consumer version *currently in production* still verified?"

It looks up the consumers in `production` (`OrdersService v7`, `MobileApp v3`), checks the column for `v3`, and sees both ✅ — so the deploy is safe. `OrdersService v8` is ❌ against v3, but v8 isn't in production yet, so it doesn't block *this* deploy (it does mean v8 can't deploy until v3 ships *and* v8 adapts — the gate stays consistent).

```bash
# Can I deploy PaymentsService at this commit to production?
pact-broker can-i-deploy \
  --pacticipant PaymentsService \
  --version "$GIT_SHA" \
  --to-environment production \
  --broker-base-url "$PACT_BROKER_URL" \
  --broker-token "$PACT_BROKER_TOKEN"
```

A passing run prints the satisfied matrix and exits `0`; a failing run names the unsatisfied consumer and exits non-zero — which is exactly what a pipeline needs.

---

## Core Concept 2 — Wiring can-i-deploy into CD

The gate belongs *immediately before deploy*, after the artifact is built and (for providers) after verification has run. The sequence:

```
Provider pipeline (PaymentsService):
  build → unit tests → publish provider version + branch
        → run Pact verification (records results in broker)
        → can-i-deploy --to-environment production   ← GATE
        → deploy
        → record-deployment --environment production

Consumer pipeline (OrdersService):
  build → consumer pact test → publish pact (version + branch)
        → can-i-deploy --to-environment production   ← GATE
        → deploy
        → record-deployment --environment production
```

Two operational details that separate a working gate from a decorative one:

- **`record-deployment` after every deploy.** The gate is only as accurate as the broker's view of "what's in production." If you forget to record deployments, `can-i-deploy` reasons about the wrong set of consumer versions.
- **`--retry-while-unknown`** for async pipelines. When a consumer publishes a brand-new contract that the provider hasn't verified yet, `can-i-deploy` can wait (with a timeout) for verification to land, rather than failing on a transient "unknown" state:

```bash
pact-broker can-i-deploy --pacticipant OrdersService --version "$GIT_SHA" \
  --to-environment production \
  --retry-while-unknown 30 --retry-interval 10
```

This is where contract testing pays back the ceremony: a single broker query, in both pipelines, replaces an entire shared pre-prod environment for catching interface breaks.

---

## Core Concept 3 — Pact vs schema-based contract testing

Pact records *concrete interactions*. Schema-based testing validates against a *declared schema*. They make different trade-offs:

| Dimension | Pact (interaction-based) | Schema-based (OpenAPI/JSON Schema) |
|-----------|--------------------------|------------------------------------|
| Source of truth | What consumers actually use | The provider's declared interface |
| Catches unused-field removal | Yes (if a consumer reads it) | No (schema doesn't know who reads what) |
| Catches *over*-promising | Yes (consumer-scoped) | Partially |
| Requires consumer participation | Yes | No |
| Best for | Internal services, known consumers | Public/partner APIs, many/unknown consumers |
| Async support | Yes (message pacts) | Schema only (e.g. AsyncAPI) |

The decision hinges on **who your consumers are**:

- **Known, internal consumers** → Pact/CDC. You get the strong "no silent break" guarantee because the broker knows every consumer's exact needs.
- **Unknown/public consumers** → schema-based. You can't run consumer-driven verification against consumers you can't enumerate, so you validate against the published schema and apply compatibility rules (additive-only changes, deprecation windows — see the `api-versioning` skill).

Many orgs run *both*: schema validation for the public edge, Pact for internal service-to-service.

---

## Core Concept 4 — Protobuf/gRPC compatibility with buf

For gRPC, the contract *is* the `.proto` schema, and the relevant property is **wire/source compatibility**: can new code read messages from old code, and vice versa? `buf` detects breaking changes mechanically — perfect for a CI gate.

```yaml
# buf.yaml
version: v2
breaking:
  use:
    - WIRE_JSON   # catches changes that break wire OR JSON compatibility
```

```protobuf
// payment.proto — original
message Payment {
  int64 id = 1;
  string status = 2;
  int64 amount = 3;
}
```

```protobuf
// payment.proto — proposed change
message Payment {
  int64 id = 1;
  string status = 2;
  string amount = 3;   // ⚠️ changed type AND reused field number 3
}
```

```bash
# Compare working tree against the version on main:
buf breaking --against '.git#branch=main'
```

```
payment.proto:5:3: Field "3" on message "Payment" changed type
  from "int64" to "string". (FIELD_SAME_TYPE)
```

`buf` enforces Protobuf's compatibility rules: don't change a field's type, don't reuse field numbers, don't remove fields that may still be on the wire (reserve them instead). This is *provider-driven, schema-based contract testing* specialized to Protobuf — no consumer pacts required, because Protobuf's field-number discipline makes compatibility a static property of the schema.

---

## Core Concept 5 — Bi-directional contract testing

Pact verification requires *running the provider*. Sometimes you can't or don't want to — the provider already has a high-quality OpenAPI spec, or it's a third party. **Bi-directional contract testing** (a PactFlow feature) cross-checks two independently produced artifacts:

```
Consumer side:   produces a pact (what it needs)            ─┐
                                                             ├─►  PactFlow compares them
Provider side:   produces/uploads an OpenAPI spec +         ─┘     "Is every consumer
                 evidence its API matches the spec                  interaction allowed
                 (its own functional tests)                         by the provider spec?"
```

The broker statically checks that **every interaction in the consumer pact is permitted by the provider's schema**. No provider replay needed. The trade-off: it's only as good as the provider's evidence that its real API matches its published spec — so providers must back the spec with their own tests. Use it when running provider verification is impractical but a trustworthy schema exists.

---

## Core Concept 6 — Async and event-driven message contracts

Contract testing isn't only for HTTP. In event-driven systems the "interface" is the **message** on a queue/topic — and the same consumer-driven logic applies. Pact calls these **message pacts**: the contract is over the message *body and metadata*, decoupled from transport.

```javascript
// consumer: an OrderEvents handler that consumes "payment.settled" messages
const { MessageConsumerPact, MatchersV3 } = require('@pact-foundation/pact');
const { like, integer, string } = MatchersV3;
const { handlePaymentSettled } = require('../src/handlers');

const messagePact = new MessageConsumerPact({
  consumer: 'OrdersService',
  provider: 'PaymentsService',
  dir: './pacts',
});

describe('payment.settled consumer', () => {
  it('handles a settled-payment event', () => {
    return messagePact
      .given('a payment has settled')
      .expectsToReceive('a payment.settled event')
      .withContent(like({
        type: string('payment.settled'),
        paymentId: integer(42),
        amount: integer(1999),
      }))
      .verify(async (message) => {
        // real handler logic runs against the contracted message shape
        await handlePaymentSettled(message.contents);
      });
  });
});
```

The provider then verifies it *produces* messages of that shape (a provider-side message verification that invokes the code path which emits the event). The broker, `can-i-deploy`, and versioning all work identically — the only change is that the unit of contract is a message, not a request/response. For the broader async landscape, see the `microservice-communication` skill; schema-based async work uses **AsyncAPI** the way OpenAPI serves sync APIs.

---

## Core Concept 7 — Spring Cloud Contract and provider-driven flows

Pact is consumer-driven by default. **Spring Cloud Contract (SCC)** inverts it: the *provider* authors contracts (Groovy/YAML DSL), and the tooling generates (a) provider-side verification tests and (b) consumer-side stubs published to a stub repository.

```groovy
// provider-authored contract (Spring Cloud Contract DSL)
Contract.make {
  request {
    method 'GET'
    url '/payments/42'
  }
  response {
    status 200
    headers { contentType(applicationJson()) }
    body([ id: 42, status: 'settled', amount: 1999 ])
    bodyMatchers {
      jsonPath('$.id', byType())
      jsonPath('$.status', byRegex('settled|pending|failed'))
    }
  }
}
```

Trade-off vs Pact/CDC: SCC is convenient when the provider team wants to own the contract and ship stubs for consumers, and it fits Spring shops well. But because it's provider-authored, it gives a weaker "no silent break" guarantee than true consumer-driven Pact — the provider can still drop a field no contract happens to mention. Choose based on *who should own the contract* (the deep org trade-off is in [professional.md](professional.md)).

---

## Core Concept 8 — Boundaries: what contracts will not catch

Senior judgment is knowing the gaps and covering them elsewhere:

- **Business behavior.** A contract says `/payments/42` returns a `status` field. It cannot tell you the status is *correct*. That's the provider's functional/unit tests.
- **Semantic drift within a stable shape.** If `amount` silently switches from cents to dollars while staying an integer, the contract still passes. Encode units in the field name or type, and cover semantics with the provider's own tests.
- **Cross-interaction workflows.** "Create payment, then refund it" spans multiple calls and state — that's a job for a thin layer of [end-to-end](../04-end-to-end-testing/senior.md) tests.
- **Non-functional concerns.** Latency, throughput, auth correctness — out of scope (see [performance and load testing](../09-performance-and-load-testing/senior.md)).

Contract testing guards the *seam's shape*. Keep a small, deliberate E2E layer for end-to-end *behavior* of critical journeys — see the [test pyramid](../01-test-strategy-and-the-pyramid/senior.md).

---

## Real-World Examples

- **Release gate in CD.** A payments team runs `can-i-deploy --to-environment production` before every deploy. A change that drops `currency` is blocked because `OrdersService v7` (in prod) reads it — the deploy never happens, no incident.
- **gRPC monorepo gate.** A platform team runs `buf breaking --against '.git#branch=main'` on every PR touching `.proto` files. A junior reuses a field number; the gate fails the PR with a precise message before any service rebuilds.
- **Public API + internal services.** A company validates its public REST API against an OpenAPI schema (bi-directional, since consumers are external) while using Pact/CDC for the dozen internal services behind it.
- **Event stream.** A `payment.settled` event adds a field — safe. A later change renames `paymentId` → `id`; the message pact for `OrdersService` fails verification, caught before the producer deploys.

---

## Mental Models

- **can-i-deploy is a question to the matrix, not a test run.** No code executes; it's a lookup over recorded results. That's why it's instant and reliable.
- **Pact = "what's used"; schema = "what's offered."** Pick by whether you can enumerate your consumers.
- **Protobuf makes compatibility static.** Field numbers turn wire compatibility into a property a tool (`buf`) can prove without running anything.
- **Messages are just interactions without a synchronous response.** Everything else about contract testing carries over.

---

## Common Mistakes

- **Running `can-i-deploy` without recording deployments.** The gate reasons about the wrong production set and silently gives wrong answers.
- **Putting the gate after deploy.** It must block *before* the artifact reaches the environment.
- **Using Pact for unknown public consumers.** You can't verify consumers you can't list; use schema-based testing there.
- **Reusing Protobuf field numbers / changing types.** The classic gRPC break; `reserve` removed numbers instead.
- **Trusting bi-directional results without provider evidence.** If the provider's OpenAPI spec lies, the static check passes while production breaks.
- **Expecting contracts to catch unit/cents semantic bugs.** Same shape, wrong meaning — out of scope.

---

## Test Yourself

1. Explain `can-i-deploy` in terms of the deployment matrix. What exactly does it look up?
2. Why must `record-deployment` run after every deploy for the gate to be correct?
3. Give one boundary where Pact/CDC fits and one where schema-based testing fits, and justify each.
4. What property does `buf breaking` enforce that makes consumer pacts unnecessary for gRPC?
5. How does bi-directional contract testing avoid running provider verification, and what's the catch?
6. A message pact passes but the producer emits `amount` in dollars instead of cents. Why doesn't the contract catch it, and where should it be caught?

---

## Cheat Sheet

```
can-i-deploy (the killer feature):
  pact-broker can-i-deploy --pacticipant P --version $SHA --to-environment production
  → checks: is every consumer CURRENTLY IN prod still verified against this version?
  Place BEFORE deploy. Always record-deployment AFTER deploy.
  --retry-while-unknown for async pipelines awaiting verification.

Choosing a mechanism:
  Known internal consumers  → Pact / CDC (strong no-silent-break)
  Unknown/public consumers  → schema-based (OpenAPI/JSON Schema)
  gRPC/Protobuf             → buf breaking --against '.git#branch=main'
  Provider owns contract    → Spring Cloud Contract (provider-driven)
  Can't run provider verify → bi-directional (needs provider spec + evidence)
  Async events              → message pacts (or AsyncAPI schemas)

Protobuf rules buf enforces:
  don't change field type · don't reuse field numbers · reserve removed fields

NOT covered by contracts: business behavior, units/semantics, multi-step
workflows, latency/auth → cover with unit + thin E2E + perf tests.
```

---

## Summary

`can-i-deploy` is contract testing's payoff: a broker lookup over the **deployment matrix** that blocks a release if any consumer *currently in production* would break — replacing a shared pre-prod environment for interface safety. Place it before deploy and keep the broker's deployment records accurate. Beyond Pact, choose per boundary: Pact/CDC for known internal consumers, schema-based (OpenAPI/JSON Schema) for public/unknown ones, `buf` breaking-change detection for gRPC, message pacts (or AsyncAPI) for events, and bi-directional checks when you can't run provider verification. Contracts guard the *shape of the seam* — not business behavior — so keep a thin E2E layer for journeys. [professional.md](professional.md) covers adopting all this across an org.

---

## Further Reading

- Pact docs — *can-i-deploy*, *Message pacts*, *Deployments and environments*.
- PactFlow — *Bi-directional contract testing* guide.
- `buf` docs — *Breaking change detection*, *Protobuf compatibility rules*.
- Spring Cloud Contract reference; AsyncAPI specification.
- The `api-versioning`, `api-testing`, and `microservice-communication` skills.

---

## Related Topics

- [End-to-End Testing](../04-end-to-end-testing/senior.md) — the thin behavior layer contracts don't replace.
- [Integration Testing](../03-integration-testing/senior.md) — boundary tests inside one service.
- [Test Strategy and the Pyramid](../01-test-strategy-and-the-pyramid/senior.md) — balancing contract vs E2E.
- [Performance and Load Testing](../09-performance-and-load-testing/senior.md) — the non-functional concerns contracts ignore.
- [Contract Testing — Professional](professional.md) — org-wide adoption, governance, versioning at scale.
