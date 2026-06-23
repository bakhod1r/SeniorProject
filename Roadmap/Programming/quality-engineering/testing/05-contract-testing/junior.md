# Contract Testing — Junior Level

> **Roadmap:** [Testing](../README.md) → Contract Testing
>
> *Two services agree on an interface — prove it without ever starting them together.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The combinatorial problem](#core-concept-1--the-combinatorial-problem)
5. [Core Concept 2 — What a contract actually is](#core-concept-2--what-a-contract-actually-is)
6. [Core Concept 3 — Consumer and provider](#core-concept-3--consumer-and-provider)
7. [Core Concept 4 — A first Pact consumer test](#core-concept-4--a-first-pact-consumer-test)
8. [Core Concept 5 — What contract testing does NOT do](#core-concept-5--what-contract-testing-does-not-do)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **why testing every service against every other service does not scale, and how a shared contract replaces "test them together."**

Imagine an `Orders` service that calls a `Payments` service over HTTP. How do you make sure `Orders` and `Payments` still agree after either team ships a change?

The naive answer is: spin both up, fire a real request, assert. That is an *integration* or *end-to-end* test. It works for two services. It collapses at twenty, because every consumer must run against every provider in a shared environment, and any flaky dependency fails the whole run.

**Contract testing** replaces that. Instead of testing the two services *together*, you write down what the consumer expects — the **contract** — and test each side against the contract *independently*. `Orders` proves it sends/reads what the contract says; `Payments` proves it can satisfy that contract. Neither needs the other running.

This tier covers the problem and the shape of a contract. The full Pact loop, the broker, and the deployment gate come in [middle](middle.md) and [senior](senior.md).

---

## Prerequisites

- You can read and write a basic HTTP request/response (method, path, status, JSON body).
- You have written a [unit test](../02-unit-testing/junior.md) with assertions.
- You understand what a mock is at a basic level (see [test doubles](../10-test-doubles-mocks-fakes/junior.md)).
- You know what a microservice is: a separately deployed service that talks to others over a network.
- Helpful: skim [integration testing](../03-integration-testing/junior.md) and [end-to-end testing](../04-end-to-end-testing/junior.md) to feel the pain contract testing removes.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Consumer** | The service that *calls* an API and depends on its shape (e.g. `Orders`). |
| **Provider** | The service that *exposes* the API (e.g. `Payments`). |
| **Contract** | A machine-readable description of the interactions a consumer expects from a provider. |
| **Pact** | The most common contract-testing tool; also the name of the contract file it produces (a "pact"). |
| **Interaction** | One request/response pair the consumer expects (e.g. `GET /payments/42` → `200 {...}`). |
| **Mock provider** | A fake server Pact stands up during the consumer test to record interactions. |
| **Provider verification** | Replaying the contract against the *real* provider to prove it honors the expectations. |
| **Consumer-driven contract (CDC)** | A contract written from what the consumer actually needs, not from the provider's full API. |

---

## Core Concept 1 — The combinatorial problem

Say you have 5 consumers and 3 providers, and consumers chain through providers. To gain confidence with end-to-end tests, you'd deploy *all* of them into one environment and run scenarios. The cost grows with the number of pairs and the depth of the call graph:

```
Consumers:  Web, Mobile, Reporting, Fulfilment, Admin
Providers:  Catalog, Payments, Inventory

End-to-end "test them together":
  - Needs every service deployed and healthy at once
  - One flaky service fails the whole suite
  - Slow: real network, real DB, real startup
  - Hard to attribute failures: which pair broke?
  - Combinatorial: N consumers × M providers × scenarios
```

Three things make this hurt:

1. **Cost.** Standing up the full graph for every pipeline run is expensive and slow.
2. **Flakiness.** The probability that *all* services are healthy at once drops as the graph grows. A 1% per-service failure rate across 8 services is roughly an 8% chance the suite fails for reasons unrelated to your change.
3. **Blame.** When the run goes red, you don't know *which* boundary broke.

Contract testing breaks the combinatorics: each consumer–provider *pair* gets one contract, tested twice (once per side), in isolation. No shared environment, no full graph.

---

## Core Concept 2 — What a contract actually is

A contract is a list of **interactions**. Each interaction says: "given some provider state, when I send *this* request, I expect *that* response." It is data, not code — usually JSON.

Here is a minimal pact file fragment for `Orders` (consumer) calling `Payments` (provider):

```json
{
  "consumer": { "name": "OrdersService" },
  "provider": { "name": "PaymentsService" },
  "interactions": [
    {
      "description": "a request for payment 42",
      "providerState": "payment 42 exists",
      "request": {
        "method": "GET",
        "path": "/payments/42"
      },
      "response": {
        "status": 200,
        "headers": { "Content-Type": "application/json" },
        "body": { "id": 42, "status": "settled", "amount": 1999 }
      }
    }
  ]
}
```

Notice what the contract captures: the **shape and semantics at the boundary** — path, method, status, and the fields the consumer reads (`id`, `status`, `amount`). It does *not* capture *how* `Payments` computes the amount. That is the provider's own business — and the provider's own tests.

---

## Core Concept 3 — Consumer and provider

Every API boundary has two roles:

- **Consumer** — the side that *calls*. It depends on the response shape. If a field it reads disappears or changes type, it breaks.
- **Provider** — the side that *responds*. It owns the implementation.

Contract testing tests **both sides against the same contract**, separately:

```
Consumer side                          Provider side
-------------                          -------------
Run consumer test against a            Take the contract and replay
MOCK provider that behaves per         each request against the REAL
the contract. If the consumer          provider. If the real response
code works against the mock, it        matches the contract, the
records the contract.                  provider honors it.

   produces the contract  ─────────►   verifies the contract
```

If both sides pass, you have transitive confidence: the consumer works against *exactly what the contract says*, and the provider *produces exactly what the contract says* — so the consumer works against the real provider, without ever running them together.

---

## Core Concept 4 — A first Pact consumer test

The consumer test is where the contract is *born*. You declare the interaction, point your real client code at Pact's mock provider, and assert your client behaves. Pact records the interaction into a pact file.

```javascript
// orders/test/payments.consumer.pact.test.js
const { PactV3, MatchersV3 } = require('@pact-foundation/pact');
const { getPayment } = require('../src/paymentsClient');

const { like, integer, string } = MatchersV3;

const provider = new PactV3({
  consumer: 'OrdersService',
  provider: 'PaymentsService',
});

describe('Payments client', () => {
  it('fetches a payment by id', () => {
    provider
      .given('payment 42 exists')                 // provider state
      .uponReceiving('a request for payment 42')
      .withRequest({ method: 'GET', path: '/payments/42' })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: like({                              // matcher: shape, not exact value
          id: integer(42),
          status: string('settled'),
          amount: integer(1999),
        }),
      });

    return provider.executeTest(async (mockServer) => {
      const payment = await getPayment(mockServer.url, 42); // real client code
      expect(payment.status).toBe('settled');               // assert client works
    });
  });
});
```

Two things to internalize:

- **`getPayment` is your real client code**, not a stub. The test proves your code parses the response correctly.
- **Matchers** (`like`, `integer`, `string`) say "I need a field of this *type/shape*," not "this exact value." That keeps the contract about structure, which is what the consumer truly depends on.

When this test passes, Pact writes `OrdersService-PaymentsService.json` — the contract. That file is the artifact the provider will later verify against.

---

## Core Concept 5 — What contract testing does NOT do

This is the most misunderstood part, so learn it early:

- It does **not** test business behavior. The contract says "`/payments/42` returns a body with `status` and `amount`." It does **not** check that the amount is computed correctly, that fraud rules ran, or that the payment actually settled. That is the provider's functional/unit tests.
- It is **not** a replacement for the provider's own tests. It checks the *interface agreement* at the boundary — message shape and semantics — nothing inside.
- It does **not** prove the whole system works. You still want a thin layer of end-to-end checks for critical flows (see the [test pyramid](../01-test-strategy-and-the-pyramid/junior.md)).

A clean mental split: **contract testing protects the *seam* between services; unit and integration tests protect what happens *inside* each service.**

---

## Real-World Examples

- **Mobile app + backend.** A mobile app (consumer) and a backend (provider) ship on different schedules — you cannot redeploy the app on every backend change. A contract lets the backend team know, before deploy, whether removing a field will crash a shipped app version still in users' hands.
- **A field rename.** `Payments` renames `amount` → `amountCents`. Without contract testing, `Orders` silently reads `undefined` in production. With it, provider verification fails in CI because the contract still expects `amount`.
- **A new required field.** `Orders` starts reading a `currency` field. The consumer test records it into the contract; provider verification fails until `Payments` adds `currency`. The break surfaces in CI, on the right team's screen.

---

## Mental Models

- **Contract = handshake written down.** Two people agree on a handshake. Each can practice it alone in a mirror. They don't need to be in the same room to verify they'll match.
- **The consumer writes the spec it needs.** A restaurant order: the customer says exactly what they want; the kitchen proves it can make it. The customer doesn't describe the whole menu — only their order.
- **Seam vs. interior.** Contract tests guard the *doorway* between rooms. They say nothing about the furniture inside either room.

---

## Common Mistakes

- **Asserting exact values instead of shape.** Hard-coding `amount: 1999` in the contract makes it brittle and turns it into a behavior test. Use type matchers.
- **Putting everything the provider returns into the contract.** Only declare fields the consumer actually *reads*. Extra fields couple you to things you don't use.
- **Thinking it replaces all integration/E2E tests.** It removes the *combinatorial* ones; you still keep a few high-value end-to-end smoke tests.
- **Treating it as a behavior test.** "The payment settled correctly" is not a contract concern.

---

## Test Yourself

1. Why does end-to-end testing every consumer against every provider not scale? Name two distinct reasons.
2. In `Orders` → `Payments`, which is the consumer and which is the provider?
3. What artifact does the consumer test produce, and who consumes it next?
4. Why use a type matcher (`integer()`) instead of a literal value (`42`) in a contract?
5. The contract says `/payments/42` returns `status: "settled"`. Does contract testing verify the payment *actually* settled? Why or why not?

---

## Cheat Sheet

```
Contract testing = test each side against a shared contract, not together.

Roles:
  Consumer = calls the API, depends on response shape
  Provider = exposes the API, owns implementation

Two tests per contract:
  1. Consumer test  → produces the contract (runs vs mock provider)
  2. Provider verify → proves provider honors it (replays vs real provider)

Contract captures: path, method, status, field shapes at the boundary.
Contract does NOT capture: business behavior, internal logic.

Use matchers (like/integer/string) → shape, not exact values.
Declare only the fields the consumer reads.
```

---

## Summary

End-to-end testing every service pair is combinatorially expensive, slow, and flaky. Contract testing replaces "test them together" with "test each side against a shared contract." The **consumer** declares the interactions it needs (producing the contract), and the **provider** later verifies it can satisfy them — each side tested in isolation, with no shared environment. A contract captures the *shape and semantics at the boundary*, not business behavior. Next, [middle.md](middle.md) walks the full Pact loop end-to-end: broker, publishing, and provider verification.

---

## Further Reading

- Pact documentation — *Introduction* and *5-minute getting started*.
- *Consumer-Driven Contracts* (Ian Robinson, martinfowler.com) — the original pattern article.
- The `api-testing` skill — for the broader API-verification toolkit this fits into.
- *Building Microservices* (Sam Newman) — chapter on testing across service boundaries.

---

## Related Topics

- [Integration Testing](../03-integration-testing/junior.md) — what contract testing reduces the need for.
- [End-to-End Testing](../04-end-to-end-testing/junior.md) — the expensive layer contract testing trims.
- [Test Strategy and the Pyramid](../01-test-strategy-and-the-pyramid/junior.md) — where contract tests sit.
- [Test Doubles, Mocks, Fakes](../10-test-doubles-mocks-fakes/junior.md) — the mock provider concept.
- [Unit Testing](../02-unit-testing/junior.md) — what protects the interior of each service.
