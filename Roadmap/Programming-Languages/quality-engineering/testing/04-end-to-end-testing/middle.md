# End-to-End Testing — Middle Level

> **Roadmap:** [Testing](../README.md) → End-to-End Testing
>
> *A small, sharp set of E2E tests buys confidence; a large, soft one buys pain. This tier is about the discipline of keeping it small.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Cost/Confidence Trade-off](#core-concept-1----the-costconfidence-trade-off)
5. [Core Concept 2 — Keeping E2E Small: Critical Journeys Only](#core-concept-2----keeping-e2e-small-critical-journeys-only)
6. [Core Concept 3 — The Tool Landscape: Playwright, Cypress, Selenium](#core-concept-3----the-tool-landscape-playwright-cypress-selenium)
7. [Core Concept 4 — Waits, Auto-Wait, and the End of sleep](#core-concept-4----waits-auto-wait-and-the-end-of-sleep)
8. [Core Concept 5 — Flakiness: The #1 Enemy](#core-concept-5----flakiness-the-1-enemy)
9. [Core Concept 6 — API-Level E2E: The Cheaper Variant](#core-concept-6----api-level-e2e-the-cheaper-variant)
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

> Focus: **why E2E is expensive and dangerous in bulk, how to choose the few journeys worth testing, the tools you'll meet, and the practical mechanics of beating flakiness.**

At the junior tier you wrote a working E2E test. At the middle tier the question changes from *"how do I write one?"* to *"how many should exist, which ones, and how do I stop them rotting?"* This is where most teams get it wrong: they keep adding E2E tests because each one "feels" like real testing, and a year later the suite takes 40 minutes, fails 1-in-5 for no reason, and nobody trusts a red build. We will make sure that doesn't happen to you.

---

## Prerequisites

- You can write a basic Playwright test (see [Junior Level](./junior.md)).
- Comfortable with `async/await` and Promises.
- You understand the [test pyramid](../01-test-strategy-and-the-pyramid/) and [integration testing](../03-integration-testing/).
- Basic CI familiarity (a pipeline runs your tests on push/PR).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Critical user journey (CUJ)** | A flow whose breakage directly costs money/users (login, checkout, signup). |
| **Implicit wait** | A global "retry for N seconds" applied to all element lookups (Selenium concept). |
| **Explicit wait** | Waiting for a *specific* condition (element visible, network idle). |
| **Auto-wait** | Built-in waiting Playwright/Cypress do before every action and assertion. |
| **Web-first assertion** | Assertion that retries until it passes or times out (`expect(locator)`). |
| **Test isolation** | Each test starts from a clean, known state, independent of others. |
| **Deterministic data** | Test data that's the same every run — no "today's date" or random IDs leaking in. |
| **Retry** | Re-running a failed test automatically; useful but can mask real bugs. |
| **Hermetic environment** | A self-contained env (seeded DB, stubbed third parties) that behaves identically each run. |
| **Headless** | Browser running without a UI window. |

---

## Core Concept 1 — The Cost/Confidence Trade-off

Every E2E test you own has running costs that unit tests don't:

| Property | Unit test | E2E test |
|----------|-----------|----------|
| Speed | ~1 ms | 2–60 s |
| Setup | none | whole app + DB + browser |
| Flakiness | near-zero | high (timing, network, env) |
| Debuggability | precise (one function) | "something on the page broke" |
| Blast radius of a UI change | none | many tests break at once |

The payoff is unmatched **confidence**: it proves the integrated product works. So the trade is real and asymmetric — high value *per test*, but high *marginal cost* as the count grows. That's why the right number is "a handful," not "hundreds."

The failure mode is the **ice-cream cone**: a fat layer of E2E on top of a thin base of unit tests. It happens because E2E "feels" more real. The result: a suite too slow to run on every PR and too flaky to believe.

---

## Core Concept 2 — Keeping E2E Small: Critical Journeys Only

The selection rule: **E2E covers critical user journeys (happy paths) + a few high-value risky flows. Everything else goes down the pyramid.**

A practical filter — write an E2E test only if **all** are true:

1. It's a journey a real user does and **the business loses money/trust if it breaks**.
2. It crosses **multiple systems** in a way unit/integration can't fully simulate.
3. The risk it covers **can't be cheaply covered lower down** (contract test, integration test).

Examples for an e-commerce app:

| Flow | E2E? | Why |
|------|------|-----|
| Browse → add to cart → checkout → pay | ✅ | Core revenue path, many systems |
| Sign up → verify email → onboard | ✅ | New-customer acquisition |
| Password field rejects < 8 chars | ❌ | Unit-test the validator |
| API returns 404 for missing order | ❌ | Integration/contract test |
| Discount-code edge cases (15 of them) | ❌ | Unit-test pricing; one E2E for "a code applies" |

> **Mantra: E2E for confidence, not coverage.** You are not trying to exercise every branch. You're proving the spine of the product holds.

Cross-link: deciding *what* to test where is the heart of [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/).

---

## Core Concept 3 — The Tool Landscape: Playwright, Cypress, Selenium

| Tool | Model | Strengths | Watch-outs |
|------|-------|-----------|------------|
| **Playwright** | Out-of-process driver (CDP/WebKit/Gecko) | Auto-wait, true parallelism, tracing, multi-browser, network interception, API testing built in | Newer; team must learn locator philosophy |
| **Cypress** | Runs *inside* the browser event loop | Superb DX, time-travel debugger, in-browser UI | Single tab/origin historically awkward; runs in-browser limits some scenarios |
| **Selenium / WebDriver** | W3C WebDriver protocol | Huge language/browser support, industry standard for years | Manual waits, more boilerplate, more flake without care |

**Default recommendation today: Playwright.** Its auto-waiting and web-first assertions remove the most common source of flakiness, parallel execution keeps the suite fast, and traces make CI failures debuggable.

The same login test in Playwright vs Cypress:

```ts
// Playwright
test('login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

```js
// Cypress
it('login', () => {
  cy.visit('/login');
  cy.findByLabelText('Email').type('ada@example.com');
  cy.findByRole('button', { name: 'Log in' }).click();
  cy.findByRole('heading', { name: 'Dashboard' }).should('be.visible');
});
```

For browser-driving tasks, the **browser-testing** skill is your friend; for API-level E2E, the **api-testing** skill.

---

## Core Concept 4 — Waits, Auto-Wait, and the End of sleep

Three waiting strategies — only two are acceptable:

- **Fixed sleep** (`waitForTimeout`, `Thread.sleep`) — ❌ guesses time; slow + flaky.
- **Implicit wait** — a global timeout for element lookups (Selenium). Better than sleep, but blunt: it can't wait for *"the spinner disappeared and the data rendered."*
- **Explicit / auto-wait** — wait for a *specific condition*. ✅ This is the goal.

Playwright **auto-waits before every action**: before clicking, it waits for the element to be attached, visible, stable, enabled, and not obscured. Its `expect` is **web-first**: it retries the assertion until it holds.

```ts
// You almost never call an explicit wait — the assertion does it:
await expect(page.getByTestId('order-total')).toHaveText('$42.00');

// When you do need an explicit condition (rare), be specific:
await page.waitForResponse(r => r.url().includes('/api/checkout') && r.ok());
await page.getByRole('status').waitFor({ state: 'visible' });
```

Internalize the rule: **"`sleep` is a bug."** If you're reaching for `waitForTimeout`, you haven't yet named the condition you're actually waiting for.

---

## Core Concept 5 — Flakiness: The #1 Enemy

A flaky test passes and fails without code changes. Flakiness is corrosive: it trains your team to ignore red builds, at which point the whole suite stops protecting you.

**Top causes and fixes:**

| Cause | Fix |
|-------|-----|
| Fixed sleeps / racing the UI | Web-first assertions, auto-wait |
| Shared state between tests | Test isolation: fresh data per test |
| Non-deterministic data (dates, randoms, autoincrement IDs) | Seed deterministic data; control the clock |
| Order dependence | Each test must run alone, in any order |
| Animations / transitions | Disable animations in test env |
| Third-party flakiness (payment, email) | Stub at the network layer; hermetic env |

A concrete flaky → stable fix:

```ts
// ❌ FLAKY: sleeps, then reads — races the render; depends on prior test's cart
test('cart shows total', async ({ page }) => {
  await page.goto('/cart');
  await page.waitForTimeout(1500);
  const total = await page.getByTestId('total').textContent();
  expect(total).toBe('$42.00');
});
```

```ts
// ✅ STABLE: seed known state via API, then assert with web-first expect
test('cart shows total', async ({ page, request }) => {
  // deterministic setup — not via the UI
  await request.post('/api/test/seed-cart', {
    data: { items: [{ sku: 'WIDGET', qty: 2, price: 2100 }] },
  });
  await page.goto('/cart');
  await expect(page.getByTestId('total')).toHaveText('$42.00'); // auto-retries
});
```

**Retries** (`retries: 2` in config) can stabilize CI, but treat them as a smoke alarm: if a test only passes on retry, log it and investigate — a blind retry can hide a genuine race condition in your *product*. Full treatment: [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/).

---

## Core Concept 6 — API-Level E2E: The Cheaper Variant

Not every end-to-end check needs a browser. If the *journey* lives behind an API, you can exercise the whole stack via HTTP — no rendering, no DOM, far faster and far less flaky.

```ts
test('order lifecycle end-to-end via API', async ({ request }) => {
  const create = await request.post('/api/orders', {
    data: { sku: 'WIDGET', qty: 2 },
  });
  expect(create.ok()).toBeTruthy();
  const { id } = await create.json();

  const fetched = await request.get(`/api/orders/${id}`);
  expect(fetched.ok()).toBeTruthy();
  expect((await fetched.json()).status).toBe('confirmed');
});
```

This still hits the real router, services, and database end-to-end — it just skips the browser. **Heuristic:** use browser E2E when the *UI itself* is the risk (a checkout form, a multi-step wizard); use API E2E when the risk is in the backend flow. See the **api-testing** skill and [Contract Testing](../05-contract-testing/) for verifying service boundaries cheaply.

---

## Real-World Examples

- **A team kills its 38-minute suite.** They had 220 E2E tests (ice-cream cone). They kept 12 critical-journey E2E tests, moved ~150 to integration, deleted duplicate-coverage ones, and dropped to a 6-minute, reliable suite.
- **Email verification, deterministically.** Onboarding E2E reads the verification link from a test mailbox (Mailpit/Mailhog) instead of a real inbox — deterministic and fast.
- **Stubbing the payment gateway.** Checkout E2E routes payment-provider calls to a sandbox via Playwright `page.route(...)`, removing third-party flakiness while still testing the team's own integration.

---

## Mental Models

- **The few load-bearing walls.** E2E tests cover the walls that hold the house up. You don't put one on every brick.
- **Confidence has a price tag.** Each E2E test is a subscription: it costs runtime and maintenance forever. Buy only the subscriptions worth it.
- **Flakiness is debt with compound interest.** One ignored flaky test trains the team to ignore red; soon nobody trusts the suite.
- **Push it down.** Whenever you're tempted to add an E2E test, first ask: *can a unit, integration, or contract test cover this risk?* Usually yes.

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Growing E2E for "coverage" | Slow, flaky suite (ice-cream cone) | Cap E2E at critical journeys |
| Seeding state through the UI | Slow, brittle setup | Seed via API / DB fixtures |
| Blind global retries | Hides real product races | Retry + alert + investigate |
| Tests depending on run order | Random failures | Enforce isolation |
| Relying on real third parties | External flakiness | Stub/route at network layer |
| Leaving sleeps in | Flake + slowness | Web-first assertions |

---

## Test Yourself

1. Give the three-part filter for deciding whether a flow deserves an E2E test.
2. Why is seeding cart state via the UI worse than via the API?
3. What's the difference between an implicit wait and auto-wait?
4. When would you choose API-level E2E over browser E2E?
5. A test passes only after a retry. Is that "fine"? Explain.
6. Name three causes of non-deterministic test data.

---

## Cheat Sheet

```ts
// Seed state out-of-band, assert with web-first expect
await request.post('/api/test/seed', { data: {...} });
await expect(page.getByTestId('x')).toHaveText('...');

// Explicit conditions when truly needed
await page.waitForResponse(r => r.url().includes('/api/...') && r.ok());

// Stub a flaky third party
await page.route('**/payments/charge', route =>
  route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) }));
```

**Selection:** critical journeys only · push the rest down.
**Stability:** no `sleep` · isolate · deterministic data · stub third parties.
**Tooling:** Playwright default · Cypress for in-browser DX · Selenium for legacy breadth.

---

## Summary

- E2E is **high value, high marginal cost**. Keep it small: **critical journeys + a few high-value flows.**
- Avoid the **ice-cream cone**; push edge cases to unit/integration/contract tests.
- **Playwright** is the modern default thanks to auto-wait, web-first assertions, parallelism, and tracing.
- **Flakiness is the #1 enemy.** Beat it with auto-wait, isolation, deterministic data, and third-party stubbing — not blind retries.
- **API-level E2E** is a cheaper, less flaky variant when the UI isn't the risk.

---

## Further Reading

- Playwright — *Best Practices* and *Auto-waiting*: https://playwright.dev/docs/best-practices
- Cypress — *Best Practices*: https://docs.cypress.io/app/core-concepts/best-practices
- Martin Fowler — *Eradicating Non-Determinism in Tests*: https://martinfowler.com/articles/nonDeterminism.html
- Ham Vocke — *The Practical Test Pyramid*: https://martinfowler.com/articles/practical-test-pyramid.html
- The **browser-testing** and **api-testing** skills.

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)
- [Integration Testing](../03-integration-testing/)
- [Contract Testing](../05-contract-testing/)
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/)
- [Test Data Management](../11-test-data-management/)
- [Acceptance & BDD](../14-acceptance-and-bdd/)
- [End-to-End Testing — Senior Level](./senior.md)
