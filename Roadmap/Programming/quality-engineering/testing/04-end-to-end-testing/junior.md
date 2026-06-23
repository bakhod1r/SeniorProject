# End-to-End Testing — Junior Level

> **Roadmap:** [Testing](../README.md) → End-to-End Testing
>
> *The only test that proves the whole thing actually works — the way a real user touches it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What End-to-End Testing Is](#core-concept-1----what-end-to-end-testing-is)
5. [Core Concept 2 — Where E2E Sits in the Test Pyramid](#core-concept-2----where-e2e-sits-in-the-test-pyramid)
6. [Core Concept 3 — Your First Playwright Test](#core-concept-3----your-first-playwright-test)
7. [Core Concept 4 — Finding Elements with Stable Selectors](#core-concept-4----finding-elements-with-stable-selectors)
8. [Core Concept 5 — Why You Should Never Use sleep](#core-concept-5----why-you-should-never-use-sleep)
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

> Focus: **what an end-to-end (E2E) test is, why it gives the highest confidence, and how to write your first one without it becoming flaky.**

A unit test checks one function. An integration test checks a few pieces working together. An **end-to-end test** checks the *entire system* — the real frontend, the real backend, the real database, talking over the real network — by driving it the same way a user would: clicking buttons in a browser, calling the public API, or typing into a CLI.

E2E is the only level of testing that can honestly say: *"A user can sign up, log in, add an item to their cart, and check out — and it works."* No mocks, no shortcuts. That is its superpower. It is also why E2E tests are slow, occasionally flaky, and expensive — so you write *few* of them, only for the journeys that matter most.

This page teaches you the mental model and gets you to a working Playwright test that opens a real browser.

---

## Prerequisites

- You can read and write basic JavaScript/TypeScript (the examples use Playwright in TS).
- You understand what a web app is: a browser, an HTTP request, a server, a response.
- You have met unit and integration tests — see [Unit Testing](../02-unit-testing/) and [Integration Testing](../03-integration-testing/).
- You have seen the [test pyramid](../01-test-strategy-and-the-pyramid/).
- Node.js installed (Playwright needs it).

---

## Glossary

| Term | Meaning |
|------|---------|
| **End-to-end (E2E) test** | A test that exercises the whole, fully-integrated system through its real interface. |
| **User journey** | A complete task a real user performs, e.g. "search → add to cart → checkout". |
| **Browser automation** | Driving a real (or headless) browser from code: click, type, navigate. |
| **Headless** | Running a browser with no visible window — faster, used in CI. |
| **Selector / locator** | A way to find an element on the page (by id, role, test id, text). |
| **Flaky test** | A test that sometimes passes and sometimes fails *without any code change*. |
| **Auto-wait** | The tool automatically waiting for an element to be ready before acting on it. |
| **Web-first assertion** | An assertion that retries until the condition is true or times out (Playwright's `expect`). |
| **`data-testid`** | A custom HTML attribute added purely so tests can find an element reliably. |
| **Happy path** | The main successful flow, with no errors or edge cases. |

---

## Core Concept 1 — What End-to-End Testing Is

Imagine your app as a black box. You don't look inside. You only do what a user does, and you check what a user would see.

```
   ┌──────────────────────────────────────────────┐
   │                  Your System                   │
   │                                                │
 You → [ Browser ] → [ Frontend ] → [ API ] → [ DB ] │
   │            ← rendered page ←                    │
   └──────────────────────────────────────────────┘
   ↑ the test acts here, from the outside
```

An E2E test:

1. Opens the real app (often a real browser).
2. Performs a real action sequence (type email, click "Log in").
3. Asserts on what the user sees (dashboard appears, name shows).

Everything in between — JavaScript bundles, API routes, database queries, authentication — runs for real. That is why a passing E2E test is the strongest evidence your software works.

**Key idea:** E2E tests answer *"does the whole product work for the user?"* — not *"is this function correct?"* (that's a unit test's job).

---

## Core Concept 2 — Where E2E Sits in the Test Pyramid

The **test pyramid** says: write many fast, cheap tests at the bottom and few slow, expensive tests at the top.

```
          /\
         /E2E\        ← few   (slow, high confidence, fragile)
        /------\
       / integr.\     ← some  (medium)
      /----------\
     /   unit      \  ← many  (fast, cheap, precise)
    /--------------\
```

E2E is the **top**: the smallest slice. A common, painful anti-pattern is the **ice-cream cone** — lots of E2E tests, few unit tests. It feels safe ("we test like a user!") but the suite becomes slow, flaky, and impossible to maintain.

The discipline you'll learn: **use E2E for confidence, not for coverage.** Cover the few critical journeys end-to-end; push everything else (validation rules, edge cases, error formatting) down into unit and integration tests where they run in milliseconds.

See [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) for the full picture.

---

## Core Concept 3 — Your First Playwright Test

[Playwright](https://playwright.dev) is the modern default for browser E2E. It drives real Chromium, Firefox, and WebKit, and it **auto-waits** for elements — which kills most flakiness for free.

Install and scaffold:

```bash
npm init playwright@latest
```

A first test — log in and see the dashboard:

```ts
// tests/login.spec.ts
import { test, expect } from '@playwright/test';

test('user can log in and reach the dashboard', async ({ page }) => {
  // 1. Go to the real app
  await page.goto('https://staging.example.com/login');

  // 2. Act like a user
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Log in' }).click();

  // 3. Assert on what the user sees
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard/);
});
```

Run it:

```bash
npx playwright test                 # headless
npx playwright test --headed        # watch the browser
npx playwright test --ui            # interactive UI mode (great for learning)
```

Notice: you never told Playwright to "wait." `expect(...).toBeVisible()` is a **web-first assertion** — it keeps re-checking until the heading appears or it times out. That is the foundation of stable E2E tests.

---

## Core Concept 4 — Finding Elements with Stable Selectors

How you locate elements decides whether your test survives next week's CSS refactor.

**Bad** — brittle, tied to styling or DOM structure:

```ts
await page.click('.btn.btn-primary.css-1x9f');     // breaks when class changes
await page.click('div > form > button:nth-child(3)'); // breaks when layout changes
```

**Good** — prefer how a *user* identifies things (role, label, text), then a dedicated test id:

```ts
await page.getByRole('button', { name: 'Log in' });   // accessible role + name
await page.getByLabel('Email');                        // form label
await page.getByText('Welcome back');                  // visible text
await page.getByTestId('checkout-submit');             // explicit test hook
```

To use `getByTestId`, add a `data-testid` attribute in your app:

```html
<button data-testid="checkout-submit">Place order</button>
```

**Rule of thumb (Playwright's own guidance):** prefer **role/label/text** selectors because they also verify accessibility; fall back to **`data-testid`** when text is ambiguous or changes often. Avoid CSS-class and positional selectors — they're the #1 cause of brittle tests.

---

## Core Concept 5 — Why You Should Never Use sleep

The single most common rookie mistake is "the page is slow, so I'll wait 3 seconds."

**Flaky — uses a fixed sleep:**

```ts
test('shows order confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForTimeout(3000);                  // ❌ guessing
  expect(await page.getByTestId('confirmation').textContent())
    .toContain('Thank you');
});
```

Why this is broken:
- On a slow CI machine, 3 seconds isn't enough → **fails randomly**.
- On a fast machine, you waste 3 seconds every run → **slow suite**.
- It hides the real timing of your app.

**Stable — wait for the actual condition (auto-wait):**

```ts
test('shows order confirmation', async ({ page }) => {
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByTestId('confirmation'))     // ✅ retries until true
    .toContainText('Thank you');
});
```

The web-first assertion waits *exactly* as long as needed and no longer. **"`sleep` is a bug"** — engrave it. We'll go deeper on flakiness in [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/).

---

## Real-World Examples

- **E-commerce checkout.** One E2E test: search a product → add to cart → enter shipping → pay (test card) → see confirmation. This single test catches "checkout is down" — the most expensive bug a shop can ship.
- **SaaS onboarding.** Sign up → verify email (read from a test mailbox) → complete profile → land on the empty dashboard. Proves a new customer can actually start.
- **API-level E2E.** Not every E2E needs a browser. Hitting the public REST API end-to-end (`POST /orders` then `GET /orders/{id}`) is a *cheaper, faster* E2E variant — see the **api-testing** skill.

---

## Mental Models

- **Black box.** You only know inputs (clicks, keystrokes) and outputs (what's on screen). If you find yourself peeking at internal state, you've drifted toward an integration test.
- **A robot user.** Picture a careful intern clicking through your app exactly the same way every time. Your test *is* that intern.
- **The summit of the pyramid.** Highest view (most confidence), thinnest air (most expensive to climb). Don't build your house up there.
- **Confidence, not coverage.** Each E2E test buys you confidence in one journey. You don't need many to feel safe.

---

## Common Mistakes

| Mistake | Why it hurts | Do instead |
|---------|--------------|------------|
| Using `waitForTimeout`/`sleep` | Slow + flaky | Use web-first assertions / auto-wait |
| CSS-class or `nth-child` selectors | Break on any UI change | Use role/label/text or `data-testid` |
| Writing E2E for every edge case | Slow, flaky, unmaintainable suite | Push edge cases to unit/integration |
| Testing against production | Pollutes real data, risky | Use a staging / hermetic environment |
| Asserting internal HTML structure | Brittle | Assert what the *user* sees |
| No screenshot/trace on failure | Can't debug CI failures | Enable Playwright traces (next tier) |

---

## Test Yourself

1. In one sentence, what does an E2E test prove that a unit test cannot?
2. Why is the "ice-cream cone" shape an anti-pattern?
3. Rewrite this to be stable: `await page.waitForTimeout(2000); expect(...)`.
4. Rank these selectors best→worst: `.css-3f2`, `getByRole('button',{name:'Save'})`, `div:nth-child(2)`, `getByTestId('save')`.
5. Name one reason an API-level E2E can be preferable to a browser E2E.

---

## Cheat Sheet

```ts
// Navigate
await page.goto('/login');

// Find (best → fallback)
page.getByRole('button', { name: 'Log in' });
page.getByLabel('Email');
page.getByText('Welcome');
page.getByTestId('checkout-submit');

// Act
await locator.click();
await locator.fill('value');
await locator.check();

// Assert (web-first, auto-retrying)
await expect(locator).toBeVisible();
await expect(locator).toContainText('Thank you');
await expect(page).toHaveURL(/\/dashboard/);

// Run
npx playwright test --ui      // learn
npx playwright test --headed  // watch
```

**Golden rules:** few E2E tests · happy paths only · stable selectors · never `sleep`.

---

## Summary

- An **E2E test** drives the whole, real, integrated system from the outside, like a user — the highest-confidence test you can write.
- It sits at the **top of the pyramid**: few, slow, expensive. Avoid the **ice-cream cone**.
- Use **Playwright**: `getBy*` locators + web-first `expect` give you auto-waiting and stability for free.
- Prefer **role/label/text** selectors, fall back to **`data-testid`**; never CSS-class or positional.
- **Never `sleep`.** Wait for conditions, not clocks. "`sleep` is a bug."

---

## Further Reading

- Playwright docs — *Getting Started* and *Best Practices*: https://playwright.dev/docs/best-practices
- Cypress docs — *Introduction*: https://docs.cypress.io
- Martin Fowler — *Test Pyramid*: https://martinfowler.com/bliki/TestPyramid.html
- The **browser-testing** skill (for driving real browsers) and the **api-testing** skill (for API-level E2E).

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)
- [Integration Testing](../03-integration-testing/)
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/)
- [Test Data Management](../11-test-data-management/)
- [Acceptance & BDD](../14-acceptance-and-bdd/)
- [End-to-End Testing — Middle Level](./middle.md)
