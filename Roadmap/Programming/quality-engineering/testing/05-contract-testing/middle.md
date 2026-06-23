# Contract Testing — Middle Level

> **Roadmap:** [Testing](../README.md) → Contract Testing
>
> *The full Pact loop: consumer test → pact file → broker → provider verification → deploy.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Consumer-driven contracts](#core-concept-1--consumer-driven-contracts)
5. [Core Concept 2 — The consumer side, with matchers and states](#core-concept-2--the-consumer-side-with-matchers-and-states)
6. [Core Concept 3 — The pact file, dissected](#core-concept-3--the-pact-file-dissected)
7. [Core Concept 4 — The Pact Broker as a contract registry](#core-concept-4--the-pact-broker-as-a-contract-registry)
8. [Core Concept 5 — The provider side: verification](#core-concept-5--the-provider-side-verification)
9. [Core Concept 6 — Versioning contracts and tags](#core-concept-6--versioning-contracts-and-tags)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the end-to-end Pact loop and why "consumer-driven" is the load-bearing word.**

In [junior.md](junior.md) you saw that a contract is a list of interactions, and that each side is tested separately. This tier connects the pieces into a working pipeline: the consumer test *generates* a pact file, that file is *published* to a **Pact Broker**, and the provider *pulls and verifies* it. The broker is the shared point of exchange — the place the contract lives between the two sides.

The key idea to absorb here is **consumer-driven**: the consumer dictates what the contract contains, based on what it *actually uses*. That single decision is what stops a provider from breaking consumers without knowing.

---

## Prerequisites

- You completed [junior.md](junior.md): roles, what a contract is, the consumer test.
- You can run tests in CI and understand build artifacts.
- Comfortable with HTTP clients and JSON parsing in your language.
- Familiar with [integration testing](../03-integration-testing/middle.md) and the cost of shared environments.
- Helpful background: the `microservice-communication` skill for sync vs async patterns.

---

## Glossary

| Term | Meaning |
|------|---------|
| **CDC** | Consumer-driven contract: contract content is determined by consumer needs. |
| **Pact Broker** | A server that stores pacts, tracks which versions were verified, and answers `can-i-deploy`. |
| **PactFlow** | The hosted, commercial Pact Broker (adds bi-directional contracts, SSO, etc.). |
| **Provider state** | A named precondition the provider sets up before verifying an interaction (e.g. "payment 42 exists"). |
| **Matcher** | A rule that asserts on the *shape/type* of a value rather than its literal content. |
| **Pacticipant** | A participant in a contract — a consumer or a provider, identified by name. |
| **Verification result** | The broker record of whether provider version X satisfied consumer contract Y. |
| **Tag / branch** | A label on an application version (e.g. `main`, `prod`) used to select which contracts matter. |

---

## Core Concept 1 — Consumer-driven contracts

There are two philosophies for who writes the contract:

- **Consumer-driven (CDC).** The consumer states *what it needs*. The contract contains only the interactions and fields the consumer actually exercises. The provider must satisfy the union of all its consumers' contracts.
- **Provider-driven.** The provider publishes its full interface (e.g. an OpenAPI spec), and consumers validate against it.

Pact is **consumer-driven**. This matters for one reason: it makes provider-side breakage *visible before deploy*. Because the broker holds every consumer's contract, the provider's verification step replays *all of them*. If a provider change drops a field that *some* consumer reads, verification fails — even if the provider team had no idea that consumer existed.

```
Provider-driven:   "Here is everything I offer. Good luck."
                   Consumer may depend on things the provider
                   doesn't know are load-bearing.

Consumer-driven:   "Here is exactly what each consumer uses."
                   Provider verifies the union → cannot silently
                   break a consumer it forgot about.
```

CDC trades a little ceremony (consumers must publish contracts) for a strong guarantee (no silent provider breakage).

---

## Core Concept 2 — The consumer side, with matchers and states

The consumer test does three jobs: declare a **provider state**, declare the **interaction**, and run **real client code** against Pact's mock. Matchers keep the contract about shape.

```javascript
// orders/test/payments.consumer.pact.test.js
const { PactV3, MatchersV3 } = require('@pact-foundation/pact');
const { getPayment } = require('../src/paymentsClient');
const { like, integer, string, eachLike, regex } = MatchersV3;

const provider = new PactV3({
  consumer: 'OrdersService',
  provider: 'PaymentsService',
  dir: './pacts',           // where the generated pact lands
});

describe('Payments client', () => {
  it('fetches a payment with line items', () => {
    provider
      .given('payment 42 exists with two line items') // provider state
      .uponReceiving('a request for payment 42')
      .withRequest({
        method: 'GET',
        path: '/payments/42',
        headers: { Accept: 'application/json' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': regex('application/json.*', 'application/json') },
        body: like({
          id: integer(42),
          status: string('settled'),
          amount: integer(1999),
          currency: regex('[A-Z]{3}', 'USD'),
          lines: eachLike({ sku: string('ABC'), qty: integer(1) }),
        }),
      });

    return provider.executeTest(async (mock) => {
      const p = await getPayment(mock.url, 42);
      expect(p.status).toBe('settled');
      expect(p.lines.length).toBeGreaterThan(0);
    });
  });
});
```

Matcher vocabulary you'll reach for constantly:

- `like(x)` — a value of the same *type/structure* as `x`.
- `eachLike(x)` — an array where *every* element matches `x` (so the array shape is fixed, the length is not).
- `integer()`, `string()`, `regex(pattern, example)` — type/pattern constraints with an example value used to drive the mock.

The **provider state** string (`"payment 42 exists with two line items"`) is a contract between the two teams about *how the provider will set itself up* before verifying this interaction. The consumer names the state; the provider implements it (Concept 5).

---

## Core Concept 3 — The pact file, dissected

Running the consumer test writes a pact file. Read it like a senior engineer — every field has a job:

```json
{
  "consumer": { "name": "OrdersService" },
  "provider": { "name": "PaymentsService" },
  "interactions": [
    {
      "description": "a request for payment 42",
      "providerStates": [
        { "name": "payment 42 exists with two line items" }
      ],
      "request": {
        "method": "GET",
        "path": "/payments/42",
        "headers": { "Accept": "application/json" }
      },
      "response": {
        "status": 200,
        "headers": { "Content-Type": "application/json" },
        "body": {
          "id": 42,
          "status": "settled",
          "amount": 1999,
          "currency": "USD",
          "lines": [{ "sku": "ABC", "qty": 1 }]
        },
        "matchingRules": {
          "body": {
            "$.id": { "matchers": [{ "match": "integer" }] },
            "$.currency": { "matchers": [{ "match": "regex", "regex": "[A-Z]{3}" }] },
            "$.lines": { "matchers": [{ "match": "type", "min": 1 }] }
          }
        }
      },
      "metadata": { "pactSpecification": { "version": "3.0.0" } }
    }
  ]
}
```

The body holds **example values** (so the provider can return realistic data), while `matchingRules` holds the **actual assertions** (so verification checks shape, not literals). When `$.id` has an `integer` matcher, the provider passes as long as it returns *any* integer there — not specifically `42`.

---

## Core Concept 4 — The Pact Broker as a contract registry

The broker is the system of record. It stores pacts, records verification results, and tracks which application versions exist on which branches/environments.

Publish from the consumer's CI after the consumer test passes:

```bash
# Consumer CI: publish the generated pact, tagged with the git branch + commit
pact-broker publish ./pacts \
  --broker-base-url "$PACT_BROKER_URL" \
  --broker-token "$PACT_BROKER_TOKEN" \
  --consumer-app-version "$GIT_SHA" \
  --branch "$GIT_BRANCH"
```

What the broker buys you:

- **A single source of truth** for every consumer–provider contract, versioned by application version.
- **Decoupling in time.** The consumer publishes today; the provider verifies whenever it next builds. They never need to be online together.
- **A matrix** of which consumer versions have been verified by which provider versions — the data behind `can-i-deploy` (see [senior.md](senior.md)).
- **Webhooks** so that publishing a new pact can trigger the provider's verification build automatically.

**PactFlow** is the hosted commercial broker — same core, plus bi-directional contracts, access control, and a nicer UI.

---

## Core Concept 5 — The provider side: verification

Verification fetches the consumer's pact(s) from the broker and replays each request against the *real* provider, asserting the live response matches the contract's matching rules.

```javascript
// payments/test/provider.verify.pact.test.js
const { Verifier } = require('@pact-foundation/pact');
const app = require('../src/app');

let server;
beforeAll(() => { server = app.listen(8080); });
afterAll(() => server.close());

describe('Pact verification', () => {
  it('honors all consumer contracts', () => {
    return new Verifier({
      provider: 'PaymentsService',
      providerBaseUrl: 'http://localhost:8080',
      pactBrokerUrl: process.env.PACT_BROKER_URL,
      pactBrokerToken: process.env.PACT_BROKER_TOKEN,
      providerVersion: process.env.GIT_SHA,
      providerVersionBranch: process.env.GIT_BRANCH,
      publishVerificationResult: true,   // record pass/fail in the broker

      // Implement each named provider state the consumer asked for:
      stateHandlers: {
        'payment 42 exists with two line items': async () => {
          await db.payments.insert({
            id: 42, status: 'settled', amount: 1999, currency: 'USD',
            lines: [{ sku: 'ABC', qty: 1 }, { sku: 'XYZ', qty: 2 }],
          });
        },
      },
    }).verifyProvider();
  });
});
```

The **state handlers** are the provider's half of the provider-state agreement: for each named state, set the world up so the replayed request returns the expected shape. The verifier then sends the real `GET /payments/42`, gets the *real* response, and checks it against the matching rules. `publishVerificationResult: true` records the pass/fail back to the broker, completing the loop.

---

## Core Concept 6 — Versioning contracts and tags

Contracts are versioned by **application version** (usually the git SHA), and labeled with **branches** or **environments**. This is how the broker knows *which* contracts and verifications are relevant.

```bash
# Mark a consumer version as deployed to an environment:
pact-broker record-deployment \
  --pacticipant OrdersService \
  --version "$GIT_SHA" \
  --environment production
```

Why this matters: when the provider asks "can I deploy?", it must compare against the consumer versions *currently in production*, not against some stale branch. Branches and environment records are what make that question answerable. The full deployment gate is [senior.md](senior.md)'s topic.

---

## Real-World Examples

- **Two teams, two pipelines.** The `Orders` team publishes a new pact on Monday. The `Payments` team's next build (Wednesday) automatically verifies it via a broker webhook. Neither team coordinated a shared environment.
- **A consumer that started using a new field.** `Orders` adds `currency` to its contract and publishes. The provider's next verification fails because `Payments` returns no `currency`. The break lands on the *provider's* CI, with a precise diff.
- **An array shape change.** `Payments` changes `lines` from objects to strings. `eachLike({ sku, qty })` in the contract fails verification immediately — caught before deploy.

---

## Mental Models

- **The broker is a contract clearing-house.** Consumers deposit contracts; providers withdraw and verify them; the ledger records who satisfied whom.
- **Publish/verify is async by design.** Like message passing — the two sides communicate through the broker, never directly, never simultaneously.
- **Matchers are the assertions; the body is just an example.** Read every pact with that lens.

---

## Common Mistakes

- **Forgetting `publishVerificationResult`.** Without it the broker never learns the provider passed, and `can-i-deploy` can't work.
- **State handlers that don't actually set state.** If the handler is a no-op, verification tests against whatever data happens to exist — flaky and meaningless.
- **Publishing pacts without a version/branch.** The broker can't build the matrix, so the deployment gate degrades to guessing.
- **Over-specifying the body with literals.** Turns the contract brittle and accidentally tests business values.
- **One giant interaction.** Prefer several small, well-named interactions — they fail with clearer diagnostics.

---

## Test Yourself

1. Why does "consumer-driven" prevent a provider from silently breaking a consumer?
2. In a pact file, what is the difference between the response `body` and `matchingRules`?
3. What does the consumer publish to the broker, and what does the provider pull from it?
4. What is a provider state, and which side names it vs. implements it?
5. Why must `publishVerificationResult` be true for the deployment gate to function?
6. The provider adds a *new* field to its response. Does existing consumer verification fail? Why or why not?

---

## Cheat Sheet

```
The Pact loop:
  1. Consumer test runs vs MOCK provider → writes pact file
  2. Consumer CI: pact-broker publish (--consumer-app-version, --branch)
  3. Provider CI: Verifier pulls pacts, replays vs REAL provider
  4. Provider implements stateHandlers for each providerState
  5. publishVerificationResult: true → broker records pass/fail

Matchers (the real assertions):
  like(x)        → same type/structure
  eachLike(x)    → array of elements shaped like x
  integer()/string()/regex(pat, example)

Versioning:
  --consumer-app-version $GIT_SHA   (identity)
  --branch / record-deployment      (which contracts matter)

Adding a field to provider response → safe (consumers ignore extras).
Removing/renaming a field a consumer reads → verification fails.
```

---

## Summary

The Pact loop ties the two sides together through a **broker**: the consumer test generates a pact and publishes it; the provider pulls every consumer's pact and verifies its real responses against the matching rules, recording results back. **Consumer-driven** is the load-bearing property — because the broker holds what each consumer actually uses, the provider can't silently break a consumer it forgot about. Matchers keep contracts about *shape*, and version/branch labels set up the deployment gate. [senior.md](senior.md) turns those labels into `can-i-deploy`, compares Pact to schema-based approaches, and handles async/event contracts.

---

## Further Reading

- Pact docs — *How Pact works*, *Pact Broker*, *Provider states*, *Matchers*.
- *Consumer-Driven Contracts* (Ian Robinson) — the foundational pattern.
- PactFlow docs — hosted broker and bi-directional contracts.
- The `api-testing` and `microservice-communication` skills.

---

## Related Topics

- [Integration Testing](../03-integration-testing/middle.md) — the layer contract testing thins out.
- [End-to-End Testing](../04-end-to-end-testing/middle.md) — kept minimal once contracts cover the seams.
- [Test Strategy and the Pyramid](../01-test-strategy-and-the-pyramid/middle.md) — where contract tests sit.
- [Test Doubles, Mocks, Fakes](../10-test-doubles-mocks-fakes/middle.md) — the mock provider in the consumer test.
- [Contract Testing — Senior](senior.md) — `can-i-deploy`, schema vs Pact, async contracts.
