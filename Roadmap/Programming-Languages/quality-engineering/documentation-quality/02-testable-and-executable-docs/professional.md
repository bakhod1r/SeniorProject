# Testable & Executable Docs — Professional Level

> **Roadmap:** [Documentation Quality](../README.md) → Testable & Executable Docs
> *The senior page taught you the mechanics — doctests, testable examples, doc tests, spec-generated reference. This page is about rolling them out across an org without creating a flaky, hated, eventually-deleted test suite. The hard questions here aren't "how do I assert on output?" They're "which docs are worth the CI minutes?", "who gets paged when the quickstart goes red?", and "how do I avoid mandating doctests everywhere and watching it backfire like a 100% coverage rule?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Where Executable Docs Earn Their Keep — and Where They Don't](#where-executable-docs-earn-their-keep--and-where-they-dont)
4. [The CI Cost and Flakiness Problem at Scale](#the-ci-cost-and-flakiness-problem-at-scale)
5. [Making Executable Docs a Paved Path](#making-executable-docs-a-paved-path)
6. [The Developer-Experience ROI](#the-developer-experience-roi)
7. [Ownership and Process](#ownership-and-process)
8. [Governance — Don't Mandate Doctests Everywhere](#governance--dont-mandate-doctests-everywhere)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Rolling out doc-testing across an organization, and the cost/benefit calculus that decides where it's worth it.**

The senior page framed executable docs as a quality mechanism: a snippet that runs in CI can't silently rot. That's true, and it's the easy part. The professional problem is that the mechanism has a *cost* — CI minutes, flakiness, maintenance, the cognitive tax on every engineer who now has to keep an example green — and that cost is not uniform. A broken quickstart on your public SDK can lose a customer in the ninety seconds before they bounce to a competitor. A slightly-stale code fragment buried in an internal architecture explainer costs essentially nothing until someone trips over it, and even then the blast radius is one confused colleague who pings you on Slack.

If you apply executable docs uniformly — "all snippets must run in CI" — you get the documentation equivalent of a 100% line-coverage mandate: technically green, expensively maintained, and quietly gamed. Engineers stop writing illustrative examples because every example is now a liability. The doc-test job becomes the flakiest thing in the pipeline, someone marks it `allow_failure: true` during a release crunch, and within a quarter it's decorative. The skill at this tier is *triage*: spending your doc-testing budget where a broken example has real downstream cost, building a paved path so the high-value cases are cheap to author and maintain, and explicitly *not* testing the prose where the maintenance cost exceeds the rot risk. This page is the pragmatic, organizational layer — the economics, the rollout, and the politics.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — doctests, Go testable examples, Rust doc tests, executed snippets, spec-generated reference, and how each detects drift.
- **Required:** You've owned a CI pipeline and felt the pain of a flaky job that erodes trust in the whole suite.
- **Helpful:** You've operated a public API, SDK, or developer product and seen the support-ticket cost of a broken getting-started flow.
- **Helpful:** You've watched a well-intentioned quality mandate (a coverage gate, a lint rule) backfire because it was applied uniformly.

---

## Where Executable Docs Earn Their Keep — and Where They Don't

The single most important professional judgment is **not testing everything**. Executable docs have a maintenance cost per example; you spend that budget where a broken example causes real downstream harm. The dividing line is *blast radius × discovery latency*: how many people a wrong snippet hurts, and how long the rot stays invisible before someone notices.

**High-value — make these executable, always:**

- **Public API and SDK reference examples.** Customers copy-paste these verbatim into their own code. A method signature that drifted, a renamed parameter, a removed return field — and every reader's first experience of your product is a stack trace they didn't write. These are also the examples with the *longest* discovery latency: nobody on your team runs them, so they rot silently until a customer files a ticket.
- **Getting-started tutorials and quickstarts.** This is the highest-stakes document you own. It sits at the top of the activation funnel; a reader is deciding *in real time* whether your product works. A broken quickstart doesn't generate a polite bug report — it generates a silent bounce. (See the war story; this is not hypothetical.)
- **Anything a customer copy-pastes to run.** Install commands, curl examples against your API, config snippets, `docker run` lines, migration scripts. If a reader pastes it into a terminal expecting it to work, it must work.
- **Examples that encode a non-obvious contract.** A snippet demonstrating the *exact* call ordering an API requires, or the one correct way to handle a paginated response, is load-bearing documentation. If it drifts, readers cargo-cult the wrong pattern at scale.

**Low-value — usually leave these as plain prose:**

- **Internal explanatory prose.** An architecture doc that says "the scheduler debounces events on a 200ms window" with an illustrative fragment doesn't need that fragment compiled in CI. The maintenance cost (keeping a synthetic example wired into a build) exceeds the rot risk (a colleague notices the number is stale and fixes it, or asks). The reader is an insider with context and a Slack channel, not an anonymous customer with a competitor's tab open.
- **Conceptual pseudocode.** A fragment illustrating an algorithm's *shape* loses its value if you contort it into something compilable. Forcing it executable often makes it *worse* documentation — more boilerplate, less clarity.
- **Throwaway or one-off snippets** in design docs, RFCs, and postmortems. These are point-in-time artifacts; nobody expects a two-year-old RFC's code to still run, and wiring it into CI is pure cost.
- **Examples in deprecated or soon-to-be-removed docs.** Don't pay to verify something you're about to delete.

The asymmetry is the whole point: **a broken public quickstart loses users; a stale internal fragment loses one engineer five minutes.** Spend accordingly.

> **The professional reality:** the instinct of a quality-minded engineer is to test everything, because "untested = can rot." Resist it. Every executable example is a small permanent liability — it can break the build, it needs an owner, it shows up in every refactor's blast radius. You are not maximizing coverage; you are maximizing *value per CI-minute and per maintenance-hour*. The docs a customer pastes into a terminal are worth real money to keep green. The prose an insider skims is usually not.

---

## The CI Cost and Flakiness Problem at Scale

Executable docs have a dirty secret that only shows up at scale: **running every documented example against real services is slow and flaky**, and a flaky doc-test suite is worse than no doc-test suite — because the team learns to ignore red, and that habit leaks into the rest of CI.

Think about what a "realistic" SDK example actually does: authenticate, create a resource, poll until it's ready, read it back, tear it down. Run a hundred of those against your real staging API on every PR and you've built a load test that runs on every commit — slow, rate-limited, and dependent on staging being healthy. Staging hiccups, a token expires, a downstream service is mid-deploy, and your docs go red for reasons that have nothing to do with the docs. The author of an unrelated PR sees a red "doc-tests" check, shrugs, and re-runs it. After the third shrug, doc-tests have lost their meaning.

**The tiering that keeps doc tests trustworthy:**

| Tier | What it tests | When it runs | How it stays fast/stable |
|---|---|---|---|
| **Compile/parse-only** | The snippet *compiles* and types check (no execution) | Every PR | Milliseconds; catches the most common rot (renamed symbols, signature drift) with zero flakiness |
| **Run against mocks/fakes** | The snippet executes against a recorded fixture or in-memory fake | Every PR | Fast and deterministic; catches logic drift without touching the network |
| **Run against real services** | Full end-to-end against staging/prod-like | Nightly / pre-release | Tolerated to be slow; failures are triaged by an owner, not blocking every PR |

The governing principle: **put the fast, deterministic check on the PR path and the slow, flaky check on a schedule.** Compile-only verification alone catches the overwhelming majority of doc rot — the renamed function, the changed signature, the deleted field — because most drift is *structural*, not behavioral. You don't need to hit the network to learn that `client.CreateWidget` is now `client.NewWidget`. Reserve real-service execution for a nightly job that an owner watches, where a flaky failure annoys one person instead of blocking the whole org.

**Tactics for keeping doc tests off the "flakiest job" list:**

- **Default to mocks/recorded fixtures** (VCR-style cassettes, `httptest` servers, contract stubs) for examples that hit external systems. The example still proves the call shape and the happy path; it just doesn't depend on staging's mood.
- **Never make doc tests block the PR if they require live infra.** Live-infra checks belong on a nightly schedule with a named owner, not the merge gate. A doc test that can fail because *staging* is down is not testing your docs.
- **Set aggressive timeouts and retries-with-jitter** on the nightly real-service tier, and **quarantine** a flaky example (move it to a watched bucket) rather than letting it redden the shared signal. A known-flaky test that blocks merges gets the *whole suite* disabled.
- **Budget the CI minutes explicitly.** If doc tests add ten minutes to every PR, engineers will route around them. Compile-only is seconds; that's why it's the PR-path default.

> **The hard-won principle:** the failure mode isn't "doc tests don't catch enough." It's "doc tests catch rot *and* infra noise indiscriminately, the team can't tell which, trust collapses, and the job gets disabled." Protect the *signal*. A doc-test suite that's green 99% of the time and red only when a doc is actually wrong is worth ten times one that's red twice a week for reasons nobody can act on. Flakiness is not a minor annoyance here — it is the thing that kills the entire practice.

---

## Making Executable Docs a Paved Path

The reason executable docs fail to stick is rarely the *concept* — it's that authoring and maintaining them is annoying enough that engineers don't, or do it badly. The fix is to make the testable path the **paved path**: the easiest thing to do is also the correct thing. This is platform/DX-team work, not something each product team should reinvent.

**The three levers, in order of leverage:**

**1. Generate examples from the spec — make this the default.** The highest-leverage move is to stop hand-maintaining examples at all where you can. If your API has an OpenAPI/gRPC/GraphQL schema, generate the reference examples *from* it. Generated examples can't drift from the contract because they *are* the contract, rendered. When the spec changes, the examples regenerate; there is no human in the loop to forget. This is the single biggest win available, and it's why "spec-first" API teams have a structural advantage in doc quality — drift is impossible by construction, not by diligence.

**2. Ship a docs-test harness owned by a platform/DX team.** Individual teams should not each invent how to extract snippets from Markdown, run them, mock the backend, and report failures. A shared harness — one that knows how to find fenced code blocks, run them in the right tier (compile / mock / live), and surface a clean failure — turns "set up doc testing" from a multi-day project into adding a tag. Own it centrally; the marginal team adopts it in an afternoon. (Tools like `mdBook`'s rustdoc integration, Python's `doctest`/`pytest --doctest-glob`, Go's example test convention, and Markdown-runners like `mdtest`/`runme` are the building blocks; the *org* value is wrapping them in one supported, opinionated path.)

**3. Templates and scaffolding.** A `cookiecutter`/`copier` template for a new tutorial that comes pre-wired with a runnable, tested example block means the default new doc is *already* testable. The lazy path produces a tested doc. Compare this to a world where making a doc testable is extra work bolted on afterward — in that world it doesn't happen.

The meta-point: **executable docs are an infrastructure investment, not a per-doc discipline.** When the platform team owns the harness, the generation pipeline, and the templates, an individual engineer writing a tutorial gets tested docs almost for free. When every team is on its own, you get a patchwork of half-maintained, flaky bespoke setups that each rot independently. Centralize the capability; decentralize the authoring.

> **The principle:** discipline doesn't scale; infrastructure does. "Engineers should keep their examples up to date" is a wish. "The examples are generated from the spec and the new-doc template ships a tested block" is a system. Build the system. The goal is that the *easiest* way to add an example is also the *tested* way — at which point you stop relying on anyone's diligence.

---

## The Developer-Experience ROI

Executable docs are usually justified as a *quality* investment, but at the professional level the stronger argument is *developer experience and adoption* — and that argument has a number attached.

**The activation case.** A quickstart is the top of the adoption funnel for any developer product. The metric that matters is **time-to-first-success** (sometimes "time to hello world" or "time to first API call"): how long from landing on the docs to the reader having something working. A quickstart that *always works* — because it's executed in CI on every release — protects that metric. A quickstart with one broken step doesn't degrade time-to-first-success; it *truncates the funnel*, because the reader who hits a broken step often doesn't debug it. They conclude the product is broken and leave. The conversion you lose is invisible — it's a bounce, not a ticket — which is exactly why teams under-invest until they instrument it.

**The support-cost case.** A broken example is a support-ticket generator, and tickets have a fully-loaded cost (engineer time to triage, context-switch, reproduce, respond — frequently estimated in the tens of dollars *each*, often far more for an escalation). One wrong snippet in a popular SDK page can generate a steady drip of identical tickets for *months* until someone notices the pattern. An executed example would have failed in CI the day the drift was introduced, at near-zero cost. The ROI math is stark: the marginal cost of keeping a quickstart executable (some CI minutes, a maintained harness) is trivially small against even a modest reduction in repeat tickets — to say nothing of the churn from developers who never filed a ticket at all.

**Framing it for the people who fund it.** "We added doc tests" is an engineering sentence and it does not get headcount. "A verified quickstart that always works improves activation and deflects the SDK-onboarding tickets that are our top support category" is a business sentence, and it does. The professional skill is connecting the executable-docs investment to **activation/adoption and support deflection** — metrics a product or DX leader already cares about — rather than to an abstract "docs quality" that no budget owner is measured on. This is also the argument that wins the *triage* battle: it tells you precisely which docs to spend the budget on (the ones on the activation path) and which to leave alone.

> **The professional reality:** the value of executable docs is not "the docs are correct." It's "the developer's first ten minutes with our product succeed, every time, and the tickets that don't get filed." Tie the work to time-to-first-success and ticket deflection — see [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md) for how to actually measure those — and executable docs stop being a nice-to-have an engineer slips in and become a funded, prioritized investment with a leader's name on it.

---

## Ownership and Process

A doc test with no owner is a doc test that gets disabled. The two organizational questions you must answer *before* rollout, not after the first red build, are: **who fixes a red doc test, and at what point in an API change is the doc test non-negotiable?**

**Who fixes a red doc test?** The default that works is: **the doc test belongs to whoever broke it** — the author of the change that caused the drift, exactly like any other failing test. This is the entire leverage of executable docs: they convert "documentation maintenance" (a chore nobody owns, that happens long after the change, if ever) into "a failing test in your PR" (a thing engineers already know how to handle and fix before merge). The anti-pattern is routing red doc tests to a docs team or a tech writer; that reintroduces the lag and the ownership gap that executable docs existed to eliminate. The whole point is that the person changing the API is the person who sees, and fixes, the now-wrong example — *while the change is fresh in their head*, not three weeks later when a writer notices.

**Doc tests in the definition-of-done for an API change.** The process that makes this stick is putting "public-facing examples updated and passing" into the **definition of done / PR checklist / merge gate** for any change to a public API surface. Concretely:

- A change to a public API **cannot merge** if its doctests are red. (For the *public* surface — this is where the gate belongs, not everywhere; see governance.)
- The PR template for API changes asks: *did you update the reference examples?* — and the compile-only doc-test tier on the PR path answers it automatically when they forgot.
- Generated-from-spec examples make this nearly free: change the spec, examples regenerate, done — there's nothing to forget.

**Escalation for the slow tier.** The nightly real-service tier needs a clear owner too — typically the DX/platform team that owns the harness, or a rotation. A nightly doc-test failure should page or ticket *that* owner, who triages whether it's real drift (route to the responsible team) or infra flake (quarantine and fix the test). Without a named owner, the nightly job's failures pile up unread, and you're back to a decorative suite.

> **The hard-won lesson:** executable docs are an *ownership* mechanism as much as a correctness one. Their value is that they make documentation drift fail *loudly, in the right person's PR, while the change is fresh*. If you let red doc tests be someone else's problem — a docs team's, a rotation's backlog — you've thrown away the mechanism's entire advantage and kept only its cost. Bind the doc test to the code change. The author who renamed the field fixes the example.

---

## Governance — Don't Mandate Doctests Everywhere

The failure mode that kills executable-docs programs is the same one that discredits coverage gates: **a blanket mandate.** "All code examples in all docs must be executable and pass in CI" *sounds* like rigor and behaves like a 100% coverage rule — it optimizes the metric and degrades the thing the metric was a proxy for.

**Why the blanket mandate backfires, concretely:**

- **It makes examples a liability, so people stop writing them.** If every illustrative fragment must be compiled, mocked, owned, and kept green forever, the rational engineer writes *fewer* examples — including the genuinely helpful, slightly-informal ones. You mandated executable docs and got *less documentation*. This is the exact dynamic of a coverage gate that makes people write trivial tests and avoid hard-to-test code.
- **It floods CI with low-value tests.** Forcing the internal architecture explainer's pseudocode to be executable adds maintenance and flakiness for a fragment whose rot would have cost one engineer five minutes. You've spent the expensive resource (CI stability, maintenance attention) on the cheapest-to-rot content.
- **It invites gaming.** People satisfy the rule with trivial, meaningless "examples" that pass but teach nothing — the doc equivalent of a test that asserts `true == true` to make the coverage gate green.

**What good governance looks like instead:**

- **Mandate executable docs only where the blast radius justifies it** — the public API/SDK reference and the quickstart/getting-started path. There, a gate is appropriate and the cost is justified.
- **Make it a *paved path*, not a *mandate*, everywhere else.** The platform team makes testable docs the easy default (templates, generation, harness); teams opt in because it's the path of least resistance, not because a linter fails their build. Adoption through ease beats adoption through coercion — and it doesn't suppress example-writing.
- **Measure outcomes, not example counts.** Track time-to-first-success, quickstart pass rate, and onboarding ticket volume — not "percentage of code blocks that are executable." The latter is a gameable proxy; the former is the thing you actually want. (This is the [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/) coverage-trap lesson applied to executability.)

> **The principle:** the same judgment that tells a senior engineer "100% coverage is a smell" tells them "100% executable docs is a smell." Rigor is *targeted*, not uniform. Gate the docs whose breakage costs users real money; pave the path for the rest and let value, not policy, drive adoption. A mandate produces compliance and resentment; a paved path produces adoption and better docs. Pick the second one.

---

## War Stories

**The quickstart that quietly tanked sign-ups.** A developer-tools company shipped an SDK whose getting-started guide had a six-step quickstart. A refactor renamed a constructor argument; the reference docs were regenerated but the *quickstart* (hand-written, separate from the reference) was missed. Step three now threw on copy-paste. Nobody filed a bug — they just left. Activation (developers reaching their first successful API call) sagged for weeks before anyone connected it to the docs, because the failure was a *bounce*, not a ticket: the people it hurt most were precisely the ones who never showed up in any inbox. The fix was to make the quickstart an *executed* test in CI — the same six steps, run end-to-end against a fake on every PR and against staging nightly — so the next such drift would have turned a step red the day it was introduced. The lesson: the quickstart is the single highest-stakes doc you own, its failures are silent, and "we regenerate the reference" does not protect the hand-written tutorial sitting next to it.

**The doc tests so flaky the team deleted them.** A team enthusiastically made *every* SDK example an end-to-end test against real staging, on every PR. It worked beautifully for a month. Then staging's intermittent slowness, token expiries, and a noisy-neighbor service meant the "doc-tests" check went red two or three times a week for reasons that had nothing to do with the docs. Engineers learned to re-run it reflexively; then someone added `allow_failure: true` during a release crunch "temporarily." A quarter later the team deleted the suite entirely — it had become pure noise, and worse, the reflex of ignoring its red had bled into how people treated *other* red checks. The rebuild moved compile-only checks to the PR path (fast, deterministic, caught most real drift) and full end-to-end to a nightly job with a named owner. The lesson: a doc-test suite that's flaky doesn't just fail to add value — it *destroys* value, by training the org to ignore red. Protect the signal or don't run the test.

**Generating examples from the spec, eliminating drift.** An API team was drowning in doc-drift bugs — every release, *some* reference example referred to a renamed field or a changed default, caught (if at all) by a customer. The root cause was structural: examples were hand-maintained in Markdown, decoupled from the OpenAPI spec, so keeping them correct depended on every engineer remembering to update two places. They moved to *generating* the reference examples from the spec: the spec became the single source, and examples were rendered from it in the build. Drift didn't get *reduced* — it became *impossible*, because there was no longer a second, hand-maintained copy to fall out of sync. The class of "stale example" bug went to zero, and the engineers stopped spending diligence on a problem the system now prevented. The lesson: where you *can* generate from a spec, that beats any amount of testing-the-hand-written-version, because it removes the drift by construction instead of detecting it after the fact.

---

## Decision Frameworks

**Should this doc be executable? Ask, in order:**
1. **Will a reader copy-paste it to run?** (Quickstart step, install command, API curl, SDK example.) → **Yes, make it executable.** This is the highest-value category, full stop.
2. **Is it on the activation path** (getting-started, first-API-call tutorial)? → **Yes, executable, and gate it** — a red here blocks the release.
3. **Does it encode a non-obvious contract** readers will cargo-cult (exact call ordering, pagination handling)? → **Yes, executable** — drift here propagates the wrong pattern at scale.
4. **Is it internal explanatory prose, conceptual pseudocode, or a point-in-time artifact** (RFC, postmortem)? → **No.** The maintenance cost exceeds the rot risk; leave it as prose. Forcing it executable often makes it *worse* documentation.
5. **Is the doc deprecated or about to be deleted?** → **No.** Don't pay to verify what you're removing.

**Which tier should this executable doc run in? Ask:**
- Is structural drift (renamed symbol, changed signature) the main risk? → **Compile-only, on every PR.** Catches most rot, zero flakiness.
- Does it need to prove behavior but not real infra? → **Run against a mock/fake, on every PR.** Fast, deterministic.
- Does it genuinely require a live service to be meaningful? → **Nightly/pre-release against staging, with a named owner.** Never on the PR merge gate.

**Should I mandate or pave? Ask:**
- Is this the public API surface or the quickstart? → **Mandate + gate.** Breakage costs users money.
- Everything else? → **Pave the path** (templates, generation, harness) and let teams opt in. A blanket mandate suppresses example-writing and floods CI — the coverage-gate failure mode.

**Hand-maintained or generated? Ask:**
- Is there a spec (OpenAPI/gRPC/GraphQL/schema) the example could be rendered from? → **Generate it.** Drift becomes impossible, not merely detectable. This beats testing the hand-written version.

---

## Mental Models

- **Executable docs are an investment with a cost, not a free correctness win.** Every tested example is a small permanent liability (CI, ownership, refactor blast radius). Spend the budget where breakage hurts users — public, copy-pasted docs — and skip the prose an insider skims.

- **Blast radius × discovery latency decides what to test.** A public quickstart hurts many readers and rots invisibly (no insider runs it) — highest priority. An internal fragment hurts one colleague who notices fast — lowest. Triage by the product, not by a blanket rule.

- **Flakiness is the thing that kills the practice, not insufficient coverage.** A doc-test suite that's red for infra reasons trains the org to ignore red, and that habit spreads. Put fast/deterministic checks on the PR path; quarantine the slow/flaky ones to a watched nightly job. Protect the signal above all.

- **Discipline doesn't scale; infrastructure does.** "Keep your examples updated" is a wish. "Examples are generated from the spec; the new-doc template ships a tested block" is a system. Make the easiest path the tested path.

- **The value is activation and deflected tickets, not 'correct docs.'** A verified quickstart protects time-to-first-success and stops a silent ticket drip. Frame the work in those terms and it gets funded; frame it as "docs quality" and it doesn't.

- **A mandate is a coverage gate in disguise.** "All examples must be executable" suppresses example-writing, floods CI, and invites gaming — exactly like a 100% line-coverage rule. Gate the high-blast-radius docs; pave the path for the rest.

---

## Common Mistakes

1. **Testing everything uniformly.** Treating an internal architecture fragment like a public SDK example wastes the expensive resources (CI stability, maintenance attention) on the cheapest-to-rot content. Triage by blast radius × discovery latency; the public, copy-pasted docs are where the budget belongs.

2. **Running every example against real services on every PR.** This builds a slow, flaky load test that runs on every commit and depends on staging's mood. Default to compile-only and mocks on the PR path; reserve live-service execution for a nightly, owned job.

3. **Letting doc tests become the flakiest job in CI.** A doc-test check that goes red for infra reasons trains the team to ignore red — and then someone adds `allow_failure: true` and it's dead. Quarantine flaky examples; never block the merge gate on a check that can fail because staging is down.

4. **Routing red doc tests to a docs team instead of the author who broke it.** This reintroduces the exact lag and ownership gap executable docs existed to remove. Bind the doc test to the code change; the person who renamed the field fixes the example in their PR.

5. **Hand-maintaining examples when a spec exists.** Keeping a second, hand-written copy in sync depends on everyone remembering. Generate examples from the OpenAPI/gRPC/GraphQL spec — drift becomes impossible by construction, not merely detectable after the fact.

6. **Mandating executable docs everywhere.** The blanket rule backfires like a 100% coverage gate: people write fewer examples, CI fills with low-value tests, and the rule gets gamed. Mandate only the public/quickstart surface; pave the path elsewhere.

7. **Selling it as "docs quality" to the people who fund it.** That sentence buys no headcount. Tie executable docs to activation/time-to-first-success and support-ticket deflection — metrics a product or DX leader is already measured on.

---

## Test Yourself

1. You have CI budget to make *some* docs executable, not all. Give the rule you'd use to decide which docs make the cut, and name the two highest-value categories.
2. A team made every SDK example an end-to-end test against staging on every PR. Six weeks later the suite is being ignored. Diagnose what went wrong and describe the tiering you'd put in place instead.
3. Why is "compile-only" verification, with no execution, often the right *default* for the PR path? What class of doc rot does it catch, and what does it miss?
4. A red doc test appears in a PR that renamed a public API field. Who should fix it, and why is routing it to a separate docs team an anti-pattern?
5. Leadership won't fund "doc testing." Reframe the request in terms of metrics a product/DX leader already cares about.
6. Explain why mandating "all code examples must be executable" backfires the same way a 100% line-coverage rule does. What do you do instead?
7. Your API has an OpenAPI spec. Why is *generating* reference examples from it strictly better than *testing* hand-written ones?

<details>
<summary>Answers</summary>

1. Decide by **blast radius × discovery latency**: how many readers a wrong snippet hurts, and how long the rot stays invisible. Make executable anything a reader **copy-pastes to run**, prioritizing the two highest-value categories: **public API/SDK reference examples** and the **getting-started quickstart** (top of the activation funnel; its failures are silent bounces, not tickets). Leave internal explanatory prose and conceptual pseudocode as plain text — there the maintenance cost exceeds the rot risk.
2. The suite became **flaky** — staging slowness, token expiries, noisy neighbors turned "doc-tests" red for reasons unrelated to the docs, the team learned to ignore red, and eventually it was disabled (often via `allow_failure: true`). Fix with **tiering**: compile-only on every PR (fast, deterministic, catches most structural drift), mock/fake execution on every PR where behavior matters, and **full end-to-end against staging only nightly/pre-release with a named owner** — never on the merge gate.
3. Most doc rot is **structural** — a renamed function, a changed signature, a deleted field — and compile/type-checking catches all of that in milliseconds with **zero flakiness** and no network dependency. It's the cheapest check with the highest catch rate, which is why it's the PR-path default. It **misses behavioral drift** (the code compiles but now does the wrong thing / returns a different value) — which is what the mock and nightly real-service tiers are for.
4. **The author who renamed the field fixes it**, in the same PR, while the change is fresh. That's the entire point of executable docs: they convert documentation maintenance into a failing test in the responsible person's PR. Routing it to a **separate docs team reintroduces the lag and ownership gap** the mechanism existed to eliminate — you'd keep the cost and throw away the advantage.
5. Don't say "doc testing." Say: a **verified quickstart that always works protects time-to-first-success / activation** (broken steps cause silent bounces, truncating the adoption funnel) and **deflects the onboarding support tickets** a broken example generates for months. Those are metrics a product/DX leader owns and is measured on; "docs quality" is not.
6. A blanket mandate optimizes the proxy and degrades the goal, exactly like 100% coverage: engineers write **fewer examples** (each is now a liability), CI **fills with low-value, flaky tests** on content that barely rots, and people **game it** with trivial passing examples that teach nothing. Instead: **gate only the public API surface and the quickstart**; everywhere else **pave the path** (templates, spec-generation, a shared harness) so testable docs are the easy default and adoption is driven by value, not policy.
7. Generated examples **can't drift from the contract because they *are* the contract, rendered** — when the spec changes, they regenerate, with no human in the loop to forget. Testing hand-written examples only **detects** drift after it's introduced and still relies on someone maintaining a second copy. Generation **removes the drift by construction** rather than catching it after the fact; the whole class of "stale example" bug goes to zero.

</details>

---

## Cheat Sheet

```
WHAT TO MAKE EXECUTABLE (blast radius × discovery latency)
  YES  public API / SDK reference examples      (copied verbatim; rot invisibly)
  YES  getting-started quickstart               (activation funnel; silent bounces)
  YES  anything a customer copy-pastes to run   (install, curl, docker run, config)
  YES  examples encoding a non-obvious contract (call order, pagination)
  NO   internal explanatory prose               (rot cost = 1 engineer, 5 min)
  NO   conceptual pseudocode                     (forcing it compilable = worse docs)
  NO   RFC/postmortem/one-off snippets           (point-in-time artifacts)
  NO   deprecated / about-to-delete docs

CI TIERING (fast+deterministic on PR; slow+flaky on a schedule)
  compile-only          every PR     ms; catches structural rot; zero flake  ← default
  run vs mock/fake       every PR     fast, deterministic; catches logic drift
  run vs real service    nightly/pre  slow; named owner triages; NEVER the merge gate

KEEP DOC TESTS OFF THE "FLAKIEST JOB" LIST
  default to mocks / recorded cassettes for anything hitting external systems
  live-infra checks → nightly, owned — not the PR gate
  quarantine flaky examples; don't redden the shared signal
  flaky doc tests train the org to ignore red → eventual deletion

PAVED PATH (infra > discipline)
  generate examples from the spec (OpenAPI/gRPC/GraphQL)  ← drift impossible
  shared docs-test harness owned by platform/DX team
  new-doc templates ship a pre-wired tested block

ROI FRAMING (what gets it funded)
  verified quickstart  → time-to-first-success / activation
  executed example     → support-ticket deflection (tickets cost $$ each)
  NOT "docs quality"   → buys no headcount

OWNERSHIP & GOVERNANCE
  red doc test → fixed by the author who broke it, in their PR
  public-API change → doctests-pass in definition-of-done / merge gate
  DON'T mandate executable docs everywhere → backfires like 100% coverage
  gate the high-blast-radius docs; pave the path for the rest
```

---

## Summary

- **Don't test everything.** Executable docs cost CI minutes, maintenance, and ownership. Spend that budget by **blast radius × discovery latency**: public, copy-pasted docs (API/SDK reference, quickstarts) earn it; internal prose and conceptual pseudocode usually don't — there the maintenance cost exceeds the rot risk.
- **Flakiness is the existential threat, not insufficient coverage.** Run **fast, deterministic checks (compile-only, mocks) on the PR path** and **slow, flaky real-service checks nightly with a named owner**. A doc-test suite that goes red for infra reasons trains the org to ignore red and gets deleted — protect the signal.
- **Make executable docs a paved path, not a per-doc chore.** Generate examples from the spec (drift becomes impossible), ship a platform-owned docs-test harness, and template new docs with a tested block. Discipline doesn't scale; infrastructure does.
- **The ROI is developer experience, not abstract correctness.** A verified quickstart protects **time-to-first-success / activation**; an executed example **deflects support tickets** that otherwise drip for months. Frame the work in those terms to get it funded — see [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md).
- **Bind the doc test to the code change.** The author who broke the example fixes it in their PR; doctests-pass goes in the definition-of-done for public-API changes. Routing red doc tests to a docs team throws away the mechanism's whole advantage.
- **Govern by triage, not mandate.** "All examples must be executable" backfires exactly like a 100% coverage rule — fewer examples, flaky CI, gaming. Gate the high-blast-radius docs; pave the path everywhere else and let value drive adoption.

You can now roll out executable docs as an organizational program with a defensible cost/benefit story. The final tier — [interview.md](interview.md) — consolidates the whole topic into the questions that test whether someone understands both the mechanics and this economics.

---

## Further Reading

- [Diátaxis](https://diataxis.fr/) — the genre lens that tells you *which* docs (tutorials, how-tos) sit on the activation path and most need to be executable.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the developer-docs lifecycle, including testing and maintaining examples at a product level.
- [Google's developer-documentation guidance on measuring quality](https://developers.google.com/style) — connecting docs to outcomes rather than volume; the framing behind the ROI section.
- Your CI platform's docs on **test quarantine, flaky-test detection, and scheduled (nightly) pipelines** — the machinery that keeps doc tests off the merge gate and protects the signal.
- OpenAPI / gRPC / GraphQL codegen and example-rendering tooling — the spec-to-example generation that makes drift impossible by construction.
- Markdown-snippet runners and doc-test harnesses (`pytest --doctest-glob`, Go example tests, rustdoc/mdBook, `runme`/`mdtest`) — the building blocks of a paved-path harness.

---

## Related Topics

- [junior.md](junior.md) · [senior.md](senior.md) · [interview.md](interview.md) — the mechanics this page assumes (how doctests, testable examples, and spec-generated reference actually work).
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/professional.md) — the complementary signal for the docs you *didn't* make executable: measuring drift you can't prevent.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md) — time-to-first-success, ticket deflection, and the metrics that fund executable-docs work.
- [Code Coverage](../../code-coverage/) — the sibling discipline whose "100% is a smell" lesson maps directly onto why you don't mandate executable docs everywhere.
