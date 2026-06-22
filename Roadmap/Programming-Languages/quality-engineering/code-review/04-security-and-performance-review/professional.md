# Security & Performance Review — Professional Level

> **Roadmap:** [Code Review](../README.md) → Security & Performance Review
> *The senior page taught you how to spot the IDOR, the N+1, the timing leak. This page is about the uncomfortable truth that spotting them by hand does not scale and was never going to — and that your job at staff level is to build the system that catches the vulnerability before a human ever opens the diff, so that the review you do perform is the last line, not the only one.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Human Review Is a Layer, Not a Control](#core-concept-1--human-review-is-a-layer-not-a-control)
5. [Core Concept 2 — The Paved Road: Make the Safe Path the Default](#core-concept-2--the-paved-road-make-the-safe-path-the-default)
6. [Core Concept 3 — Security at Scale: Routing, Triggers, and Champions](#core-concept-3--security-at-scale-routing-triggers-and-champions)
7. [Core Concept 4 — Performance at Scale: Gates, Observability, and the Two Failure Modes](#core-concept-4--performance-at-scale-gates-observability-and-the-two-failure-modes)
8. [Core Concept 5 — Threat Modeling at Design Time, Not PR Time](#core-concept-5--threat-modeling-at-design-time-not-pr-time)
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

> Focus: **Building a system where security and performance review is one layer atop automation, ownership, and safe-by-default tooling — not the heroics of a sharp-eyed reviewer.**

The senior page framed security and performance review as a skill: read the diff, find the authz gap, find the unbounded query, name the timing leak. That skill is real and you need it. But at the professional level the operative question changes from *"can I catch this in review?"* to *"why is review the place we're catching this at all?"*

Here is the core truth that separates a staff engineer from a very good senior one: **ad-hoc human security and performance review does not scale and is not reliable as a primary control.** A reviewer is tired on Friday, the diff is 800 lines, the IDOR is on line 612, and the authz check is *absence* — there is no line to point at, only a line that should exist and doesn't. Humans miss absence. Humans miss the third nested loop that becomes an N+1 only when the result set is non-empty in production. Humans approve hand-rolled crypto because it "looks right." Across thousands of PRs a year, "review harder" is a strategy that loses on a long enough timeline, and the loss is a breach or an outage.

So the staff engineer does something different. They treat review as the *last* layer of a defence-in-depth stack and spend their leverage building the layers underneath: SAST and secret-scanning and dependency-scanning as gates; CODEOWNERS routing the dangerous paths to the people who understand them; a trigger rubric so the team knows when a PR genuinely *needs* a security review instead of guessing; threat modeling pushed back to design time where it's cheap; and — the unifying idea — a **paved road** where the safe, fast way is the *default* way, so the average engineer can't easily introduce the vuln even if every human misses it. This page is that system.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — spotting IDOR/BOLA, injection, SSRF, the N+1, unbounded queries, timing leaks, and the security/perf reviewer's eye on a single diff.
- **Required:** You've reviewed enough security- or performance-sensitive code to have *missed* something that later mattered.
- **Helpful:** You've owned a service in production through a security incident or a latency regression.
- **Helpful:** You've set up or operated CI gates ([Quality Gates](../../quality-gates/)) and static analysis tooling.

---

## Glossary

- **SAST** — Static Application Security Testing. Tools (Semgrep, CodeQL, Snyk Code) that scan source for vulnerability patterns without running it. The shift-left workhorse.
- **DAST** — Dynamic Application Security Testing. Scans a *running* app from the outside. Complements SAST; catches what static can't see.
- **SCA / dependency scanning** — Software Composition Analysis. Flags known-vulnerable dependency versions (Dependabot, Snyk, `osv-scanner`) against an advisory database.
- **Paved road / golden path** — The blessed, safe-by-default way to do a thing (the sanctioned HTTP client, auth middleware, query builder) so the easy path is also the secure/fast one.
- **CODEOWNERS** — A file mapping repo paths to required reviewers, so changes to sensitive paths auto-route to the right owners.
- **AppSec** — The application-security function/team. The specialists you escalate genuinely risky changes to.
- **Security champion** — An embedded engineer on a product team trained to be the first-line security reviewer and the bridge to AppSec.
- **IDOR / BOLA** — Insecure Direct Object Reference / Broken Object Level Authorization: the request is authenticated but the server never checks the object *belongs to* the caller. OWASP API #1.
- **ReDoS** — Regular-expression Denial of Service: a pathological (often user-supplied) regex with catastrophic backtracking that pins a CPU.
- **Perf gate / regression gate** — A CI check that runs a benchmark on a hot path and fails the build if a metric regresses past a threshold.
- **Backstop** — The control that catches what everything upstream missed: pen-test and bug-bounty for security, load/capacity testing for performance.

---

## Core Concept 1 — Human Review Is a Layer, Not a Control

The single most expensive belief in code review is that a security or performance bug "should have been caught in review." It treats the reviewer as a *control* — a reliable mechanism that, if operating correctly, prevents the defect. Reviewers are not that. They are a probabilistic filter with a non-trivial false-negative rate that *rises* with diff size, reviewer fatigue, time pressure, and the subtlety of the defect. The defects that matter most — missing authorization, a logic-only timing oracle, an N+1 that only fires at scale — are exactly the ones with the highest miss rate, because they're *invisible by construction*: the bug is something that isn't there.

The staff move is to model review as one layer in defence-in-depth and ask, for each class of defect, *which layer should own it?*

```
        cheap, fast, deterministic  ───────────►  expensive, slow, judgement-heavy
  ┌────────────┬──────────────┬──────────────┬───────────────┬──────────────┐
  │  Paved     │   SAST /      │  Targeted    │   Human       │  Pen-test /  │
  │  road      │   secret /    │  automated   │   review      │  bug-bounty /│
  │ (can't     │   dep-scan    │  perf gate   │ (judgement,   │  load test   │
  │  express   │   (known      │  (regression │  novel risk,  │  (backstop;  │
  │  the bug)  │   patterns)   │  on hot path)│  design)      │  finds what  │
  │            │               │              │               │  slipped)    │
  └────────────┴──────────────┴──────────────┴───────────────┴──────────────┘
```

Read it left to right: **every defect you can push left to a cheaper layer, you should.** A secret in a commit should never reach a human — secret-scanning blocks the push. A known-vulnerable `lodash` should never reach a human — SCA fails the PR. A 30% regression on the checkout path should never *rely* on a human noticing — a benchmark gate fails the build. What's *left* for the human is the residue: the novel logic flaw, the design smell, the "this is technically fine but creates a footgun for the next person." That residue is where human judgement is irreplaceable — and it's a far smaller, far more reviewable surface than "find every vuln in every diff."

> **The reframe that matters:** you do not improve security/perf review by reviewing harder. You improve it by *shrinking what review has to catch* — pushing every mechanizable class of defect down to a gate and every structural class down to the paved road, until the human is left with the genuinely judgement-bound remainder. A staff engineer's output is not better reviews; it's a smaller, sharper review surface.

This connects directly to [Static Analysis](../../static-analysis/) and [Quality Gates](../../quality-gates/): SAST, secret-scanning, and dependency-scanning are not "nice to have alongside review" — they are the layers that *make review tractable* by removing the mechanizable defects from a human's plate.

---

## Core Concept 2 — The Paved Road: Make the Safe Path the Default

If Concept 1 is the diagnosis, the **paved road** is the cure, and it is the single highest-leverage idea on this page. The principle:

> You don't scale quality by reviewing harder. You scale it by making the safe/fast path the *default* — so the average PR can't easily introduce the vuln, because the insecure way is harder than the secure way.

The failure mode of relying on review is that it asks every engineer to *remember* to do the safe thing on every change, and asks every reviewer to *verify* it on every diff. That's two human reliability bets per PR, multiplied by thousands of PRs. The paved road replaces both bets with structure: the framework does the safe thing by default, and doing the *unsafe* thing requires deliberate, conspicuous, reviewable effort.

Concretely, paving the road means:

| Defect class | The review-harder approach (fragile) | The paved-road approach (structural) |
|---|---|---|
| SQL injection | Reviewer checks every query for string concatenation | Query builder / parameterized ORM is the *only* sanctioned data path; raw SQL requires a lint-flagged escape hatch |
| Missing authorization (IDOR) | Reviewer checks every handler for an ownership check | Authz middleware that **fails closed** — endpoints are deny-by-default; accessing an object goes through a policy layer that requires the owner check |
| XSS | Reviewer checks every template for unescaped output | Auto-escaping templates by default; emitting raw HTML requires an explicit, greppable `dangerouslySetInnerHTML`-style marker |
| SSRF | Reviewer checks every outbound call for user-controlled URLs | One sanctioned HTTP client with an allowlist/metadata-endpoint block built in; ad-hoc clients are lint-banned |
| Hand-rolled crypto | Reviewer evaluates the crypto (and gets it wrong) | A single vetted crypto library exposes high-level primitives (`seal`/`open`); raw cipher APIs are restricted |
| N+1 queries | Reviewer mentally traces loops for per-iteration queries | Dataloader/batching is the default access pattern; the ORM warns/errors on lazy-load-in-loop in dev and test |
| Unbounded queries | Reviewer checks for missing `LIMIT` | The data layer requires an explicit page size; an unbounded fetch is a typed, conspicuous call |

The deep point: **the real fix for a recurring class of vuln is almost never "train reviewers to catch it" — it's "make it un-introducible by default."** When you find the same defect class in review three times, that's not three review wins; it's a signal that the road isn't paved. The staff response to "we keep catching IDORs in review" is not "good, keep catching them" — it's "why can our framework express an endpoint without an authz check at all?"

> **Typed APIs and fail-closed defaults are paved road.** A function that takes a `UserId` instead of an `int`, an authz layer where forgetting the check *denies* rather than *allows*, a config that's secure unless you opt out — these encode the safe choice into the type system and the control flow, where neither the author nor the reviewer can forget it. This is the same instinct as making illegal states unrepresentable, applied to security.

---

## Core Concept 3 — Security at Scale: Routing, Triggers, and Champions

The paved road handles the *common* case. But some changes are genuinely security-critical and need a specialist's eyes — and the failure mode at scale is *both* directions: every PR pinging AppSec (so AppSec drowns and becomes a rubber stamp) **or** no PR pinging AppSec (so the auth rewrite ships unreviewed). The system needs to route the right changes to the right depth of review, automatically.

**Routing via CODEOWNERS.** The security-sensitive paths are *known* — and ownership of them belongs to AppSec or security champions, enforced mechanically:

```gitignore
# CODEOWNERS — security-relevant paths require AppSec review
/services/auth/**            @org/appsec
/libs/crypto/**              @org/appsec
/services/payments/**        @org/appsec @org/payments-leads
**/*serializ*                @org/appsec   # deserialization is a classic RCE vector
/infra/iam/**                @org/appsec
/services/*/middleware/authz.* @org/appsec
```

This turns "remember to ask security" — a human reliability bet — into a *merge requirement*. A change to crypto cannot merge without an AppSec approval, full stop.

**The security-review trigger rubric.** CODEOWNERS catches changes to *known* sensitive files, but security-relevant changes also happen in ordinary files (a new endpoint that takes untrusted input lives in a feature directory). So the team needs a shared, explicit rubric for *when a PR needs a security review*, applied by the author and the first-line reviewer. A change needs security review when it:

- touches **authentication or authorization** logic (login, session, permission checks, role assignment);
- handles **untrusted input** at a new trust boundary (a new endpoint, a new file/upload parser, a new webhook);
- touches **cryptography** (anything involving keys, hashing, signing, encryption, randomness);
- handles **PII / regulated data** (new field, new export, new log line that might leak it);
- adds or upgrades a **dependency** (new transitive supply-chain surface);
- performs **deserialization**, **SSRF-adjacent outbound calls**, **`eval`/dynamic execution**, or **SQL/command construction**;
- changes **security controls** themselves (CSP, CORS, rate limits, auth middleware, secrets handling).

The rubric appears as a PR-template checklist so it's *in front of* the author, not in a wiki nobody reads. This is the human counterpart to the trigger gate: it makes "does this need security?" a decision with a rule, not a vibe.

**Security champions.** AppSec teams are tiny relative to the number of product engineers; routing *everything* to a central team doesn't scale. The **security champions program** embeds a trained engineer on each product team as the first-line security reviewer and the escalation bridge to AppSec. The champion handles the routine security-relevant PR locally and escalates the genuinely novel or high-blast-radius change. This is how you get security-aware review coverage without a 200-person AppSec org — you push the *first* line of review into the teams and reserve the specialists for the hard cases.

**The backstop.** Even with all of the above, things slip. **Pen-testing** (scheduled, scoped adversarial assessment) and **bug-bounty** (continuous, crowd-sourced) are the layer that catches what shift-left and human review missed — and, critically, every finding from the backstop should generate a *paved-road or gate improvement*, not just a patch. A bug-bounty IDOR isn't done when you fix that endpoint; it's done when the authz layer makes that class of IDOR un-introducible.

> **The org-design insight:** security at scale is a *routing* problem, not a *reviewing* problem. The question isn't "is our review good enough to catch auth bugs?" — it's "does every auth change provably reach someone who understands auth, and does our framework prevent the auth bug the rest of the time?" CODEOWNERS + the trigger rubric + champions + paved road answer that; "review harder" doesn't.

---

## Core Concept 4 — Performance at Scale: Gates, Observability, and the Two Failure Modes

Performance review has the same scaling problem as security and one extra twist: it fights a *two-front war*. Under-attention lets real perf regressions ship (the N+1 that's fine in the test DB and melts in production). Over-attention breeds a premature-optimization culture (reviewers demanding micro-optimizations on cold paths, adding complexity and bugs to defend against load that will never come). The staff engineer has to suppress *both*, and the tool for both is **data**.

**Perf-regression gates on hot paths.** The structural fix for under-attention is the same as for security: don't rely on a human noticing. For the genuinely hot paths — the request handler on the critical route, the serialization in the inner loop, the query on the checkout flow — wire a **benchmark into CI** and **fail the build on regression past a threshold**:

```yaml
# CI perf gate (conceptual): fail if a hot-path benchmark regresses > 10%
perf-gate:
  run: |
    go test -bench=BenchmarkCheckoutHandler -benchmem -count=10 > new.txt
    benchstat baseline.txt new.txt | tee delta.txt
    # benchstat reports a statistically significant delta; fail if regression exceeds budget
    fail-if-regression --budget=10% --metric=ns/op --metric=allocs/op delta.txt
```

This makes a class of perf regression *un-shippable* without a human in the loop — exactly parallel to a SAST gate. It also defuses the politics: the gate, not a reviewer's opinion, says the change is too slow. (See [Quality Gates](../../quality-gates/) for wiring thresholds into the pipeline.)

**The "require a benchmark for changes to X" policy.** You can't benchmark everything, so you designate the *perf-sensitive* code (CODEOWNERS-style ownership applies here too) and adopt a rule: **a change to this module must come with a benchmark.** No benchmark, no merge. This forces the author to *measure* rather than the reviewer to *guess*, and it makes the perf conversation reference real numbers.

**Make performance observable.** The deepest enabler is that review should reference *real data, not guesses*. If production latency, query counts per request, and allocation profiles are observable (tracing, profiling, query logging in staging), then a reviewer can say "this endpoint is in the p99 hot path, here's the trace, this added query shows up — let's batch it" instead of "this *feels* slow." Observability turns perf review from speculation into evidence, and it's the antidote to *both* failure modes: it reveals the real regression *and* it proves the cold path is cold (so you can reject a premature optimization with "this runs 40 times a day, leave it simple").

**Fighting premature optimization.** Over-attention is the subtler failure. The staff engineer actively *defends simplicity* on cold paths: the review comment "is this path actually hot? show me" kills most premature optimization, and the cultural norm "we optimize what the profiler says, not what intuition says" keeps the codebase from accreting complexity in defence of imaginary load. A perf "fix" that adds a cache, a pool, or a hand-tuned loop to code that runs occasionally is a *net negative* — more code, more bugs, more cognitive load, zero measurable benefit.

**The backstop.** **Load and capacity testing** is to performance what pen-testing is to security: the layer that catches the regression that only manifests under real concurrency and data volume — lock contention, connection-pool exhaustion, GC pressure, the cache that thrashes at scale. Hot-path benchmarks catch per-operation regressions; load tests catch *systemic* ones.

> **The two-front discipline:** a mature perf-review culture is defined as much by what it *declines* to optimize as by what it catches. Gate the hot paths with benchmarks; make everything observable so the conversation is evidence-based; and ruthlessly protect the cold paths from premature optimization. "Show me the profile" is the most important four words in performance review — it both surfaces real regressions and disarms imaginary ones.

---

## Core Concept 5 — Threat Modeling at Design Time, Not PR Time

The most expensive place to discover a security flaw is a PR; the cheapest is a design doc. By the time a flawed design reaches code review, the reviewer is looking at *thousands of lines implementing an insecure architecture* — and the only honest review feedback is "this whole approach is wrong," which is the most expensive, most demoralizing, most-likely-to-be-overridden comment there is. The diff is the wrong altitude to catch an architectural security flaw.

**Threat modeling at design time** moves the security conversation *upstream* of the code, where changing the design costs a paragraph instead of a sprint. When a feature touches a trust boundary, the design doc should answer — *before code exists*:

- **What are the trust boundaries?** Where does untrusted data enter, and what's authorized to cross?
- **What can go wrong?** (STRIDE is a useful checklist: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.)
- **What's the blast radius** if this component is compromised? What does it have access to?
- **What are we trusting, and is that trust justified?** (The dependency, the upstream service, the client.)

The output is a set of *requirements* the implementation must satisfy — and those requirements become the things review actually checks. Review then verifies "does the code meet the threat model?" (a tractable, concrete question) instead of "is this secure?" (an unbounded one).

> **The altitude principle:** architectural security flaws are caught at design time or not at all — by the time they're in a diff, the cost to fix has already been paid and the reviewer is reduced to objecting to a sunk cost. Push the security conversation to the design doc, and let PR review verify conformance to a model rather than discover the model. This is the security analogue of the broader truth that design review beats code review for design problems — see [03 — Correctness & Design Review](../03-correctness-and-design-review/professional.md).

---

## War Stories

**The IDOR that passed a dozen reviews.** A SaaS product had an endpoint, `GET /api/v1/invoices/:id`, that loaded an invoice by ID and returned it. It was authenticated — you had to be logged in — and it passed code review repeatedly, because every reviewer saw the auth check (`requireLogin`) at the top of the handler and moved on. What no reviewer caught, across a dozen PRs that touched nearby code, was that the handler *never checked the invoice belonged to the caller's organization*. Any logged-in user could enumerate IDs and read every customer's invoices. It surfaced via bug-bounty. The patch was one line. But the staff engineer's real fix was structural: object loads were moved behind a policy layer (`authz.load(Invoice, id, forUser: ctx.user)`) that *required* an ownership predicate and *failed closed* if none was supplied. After that change, an IDOR of this class was no longer expressible — you physically could not load an object without stating who was allowed to. Twelve human reviews missed it; the framework default made the thirteenth impossible. *Lesson: the recurring miss wasn't a review failure to fix with more diligence — it was a paved-road gap.*

**The N+1 that only existed at scale.** A feature loaded a list of orders and, for each, the customer's name. In the test database — twenty seed orders — it ran in 12ms and sailed through review; the per-iteration query was invisible in a 400-line diff. In production, with lists of 500+ orders, it issued 500+ sequential queries per request, the endpoint's p99 went from 40ms to 4 *seconds*, and it took down the database connection pool under load. The reviewer hadn't done anything wrong by the standards of human review — tracing every loop for a hidden query across every diff is exactly the un-scalable expectation Concept 1 warns about. The fix was a dataloader to batch the lookups. The *durable* fix was a policy: changes to the order-serving path now require a benchmark, and the ORM was configured to *error in test* when a lazy load fires inside a loop — turning a class of N+1 into a test failure rather than a production incident. *Lesson: perf bugs that only manifest at scale must be caught by gates and tooling, because the human reviewer literally cannot see them at review-time data volumes.*

**The hand-rolled crypto nobody could evaluate.** An engineer needed to encrypt a field and wrote a tidy-looking routine using a cipher in ECB mode with a static IV. It passed review — three senior engineers approved it because it *looked* careful, had tests, and the math "seemed right." None of them were cryptographers, and ECB-with-a-static-IV leaks structure in the ciphertext: identical plaintexts produce identical ciphertext, defeating the entire point. It was found in a later security audit. The patch swapped in an authenticated-encryption primitive. The staff fix was to *remove the ability to make the mistake*: raw cipher APIs were restricted behind a lint rule, and a single vetted library exposed only high-level `seal`/`open` primitives that chose the mode, IV, and authentication correctly. *Lesson: review cannot evaluate crypto that the reviewers aren't qualified to evaluate — the only scalable control is a safe-by-default library and a ban on the raw primitives. The fix a safe library would have prevented should never have depended on a reviewer's crypto expertise.*

**The ReDoS from a user-supplied pattern.** A search feature let users provide a filter that was compiled into a regular expression server-side. A reviewer approved it; the regex handling looked fine. Months later a single crafted input — a pathological pattern triggering catastrophic backtracking — pinned a CPU core to 100% per request and a handful of concurrent requests took the service down. A textbook ReDoS denial-of-service, from *user-controlled regex*. The immediate fix was to stop compiling user input as a regex (use a literal/substring match) and to run regexes under a timeout. The structural fix: the sanctioned input-handling layer never compiles user input as a regex, and a SAST rule flags any `regexp.Compile` on a tainted source. *Lesson: "user-supplied regex" is a trust-boundary red flag the trigger rubric should name explicitly — and the durable control is making user-controlled regex compilation un-introducible.*

**The premature optimization that added a bug.** A reviewer, perf-conscious, pushed hard for an admin report-generation endpoint to be rewritten with a hand-tuned concurrent pipeline and a result cache "for performance." The author complied. The endpoint was used by *internal admins, a few dozen times a day.* The added concurrency introduced a subtle race in cache population that produced occasionally-stale reports — a real bug — in service of optimizing a path that was never hot. The staff engineer reverted it to the simple sequential version with a one-line comment: "this runs ~40×/day; the simple version is correct and fast enough — show me a profile if that changes." *Lesson: over-attention to performance is a real failure mode that ships complexity and bugs to defend against imaginary load. "Is this path actually hot?" is a load-bearing review question in both directions.*

---

## Decision Frameworks

**Does this PR need a security review? (trigger rubric)**

| The change… | Security review? | Route to |
|---|---|---|
| Touches auth/authz logic (login, session, permissions, roles) | **Required** | AppSec / champion |
| Adds a new trust boundary (new endpoint, parser, upload, webhook) | **Required** | Champion → AppSec if novel |
| Touches cryptography (keys, hashing, signing, randomness) | **Required** | AppSec |
| Handles PII / regulated data (new field, export, or log) | **Required** | Champion + privacy/AppSec |
| Adds or upgrades a dependency | **Required** (at least SCA + a look) | SCA gate + champion |
| Does deserialization, `eval`, SSRF-adjacent calls, SQL/command construction | **Required** | AppSec |
| Changes a security control (CSP, CORS, rate limit, secrets) | **Required** | AppSec |
| Pure UI/copy/refactor with no trust-boundary contact | Not required | Normal review |

**Catch it with: which layer owns this defect class?**

| Defect class | SAST | Secret-scan | Dep-scan | Human | Pen-test/bounty |
|---|:---:|:---:|:---:|:---:|:---:|
| Hardcoded secret in commit | — | **✔ block** | — | — | — |
| Known-vulnerable dependency | — | — | **✔ gate** | — | — |
| SQL injection (pattern) | **✔ flag** | — | — | confirm | catch leftovers |
| Missing authorization / IDOR (logic) | weak | — | — | **✔** | **✔ backstop** |
| XSS (unescaped output) | **✔ flag** | — | — | confirm | ✔ |
| Hand-rolled crypto misuse | partial | — | — | weak (need expert) | **✔** |
| Business-logic flaw | — | — | — | **✔** | **✔** |
| Novel/chained vulnerability | — | — | — | partial | **✔ backstop** |

> The pattern: deterministic, known-shape defects belong to gates (cheap, reliable). Logic and design defects belong to humans (judgement). Novel and chained defects belong to the backstop (adversarial). Don't ask a human to do a gate's job, and don't ask a gate to do a human's.

**Flag in review vs require a benchmark (performance)**

| Situation | Action |
|---|---|
| Change to a designated hot path | **Require a benchmark** (gate); numbers, not opinions |
| Plausible regression, path heat unknown | Ask "is this hot? show me a trace" before flagging |
| Change to a clearly cold path | Don't flag perf; protect simplicity |
| New unbounded query / loop-with-query on a served path | Flag **and** require a bound/batch; consider a gate |
| Micro-optimization proposed on a cold path | **Reject**; "show me the profile justifying the complexity" |

**Review harder vs pave the road**

| Signal | Response |
|---|---|
| Same defect class caught in review 3+ times | **Pave the road** — make it un-introducible by default |
| One-off novel flaw, unlikely to recur | Fix it; a focused review is fine |
| Reviewers asked to evaluate something they're not qualified for (crypto) | **Pave the road** — safe library + ban raw primitives |
| Defect is *absence* of a control (missing authz check) | **Pave the road** — fail-closed default so absence = deny |
| Defect is a mechanizable pattern | **Add a gate** (SAST/lint), don't rely on eyes |

**When to escalate to AppSec / a perf specialist**

| Escalate to AppSec when… | Escalate to a perf specialist when… |
|---|---|
| New auth/crypto *architecture* (not just a tweak) | A regression is systemic (lock contention, pool exhaustion, GC) |
| Untrusted input meets a high-blast-radius component | A hot path needs design-level rework, not a local fix |
| A bounty/pen-test finding reveals a class of flaw | A capacity/load test fails and the cause is non-obvious |
| The change is novel and the champion is unsure | The fix requires profiling expertise the team lacks |
| Compliance/regulatory data handling is involved | Premature-optimization pressure needs an authoritative "no" |

---

## Mental Models

- **Review is the last layer, not the only one.** Every mechanizable defect pushed left to a gate, and every structural defect pushed down to the paved road, shrinks what the human must catch. A staff engineer's output is a smaller review surface, not better eyesight.

- **The real fix is making the bug un-introducible.** When you catch the same vuln class three times, that's not three wins — it's a paved-road gap. The cure for recurring IDORs is fail-closed authz, not vigilance.

- **Security at scale is routing, not reviewing.** The question is "does every auth change provably reach someone who understands auth?" — answered by CODEOWNERS + trigger rubric + champions — not "are our reviewers good enough?"

- **Humans miss absence.** A reviewer can spot a bad line; they reliably miss a *missing* line. Missing authz, missing bound, missing validation — these are why fail-closed defaults beat review for whole classes of defect.

- **Performance review is a two-front war fought with data.** Gate the hot paths so regressions can't ship; protect the cold paths from premature optimization. "Show me the profile" wins both fights.

- **Catch security flaws at design time or not at all.** By the time an architectural flaw is in a diff, the cost is sunk and the reviewer is objecting to a fait accompli. Threat-model upstream; let review verify conformance.

- **The paved road is the strategy; everything else is tactics.** You don't scale quality by reviewing harder — you scale it by making the safe, fast way the default way.

---

## Common Mistakes

1. **Treating human review as the primary security control.** It's a probabilistic filter with a miss rate that climbs with diff size and subtlety — and the worst defects (missing authz, logic flaws) are the highest-miss. Push mechanizable defects to gates and structural ones to the paved road; reserve humans for judgement.

2. **Fixing the instance instead of the class.** Patching the one IDOR and moving on guarantees the next one. When a defect class recurs, change the *default* (fail-closed authz, safe-by-default library) so the class can't be introduced.

3. **Routing everything — or nothing — to AppSec.** Both fail: everything drowns the team into a rubber stamp; nothing ships the auth rewrite unreviewed. Route by CODEOWNERS + a trigger rubric, with champions as the first line and specialists for the hard cases.

4. **Asking reviewers to evaluate crypto (or anything) they're not qualified for.** Three seniors approving ECB-with-a-static-IV is the predictable result. The only scalable control is a vetted library exposing safe high-level primitives and a ban on the raw ones.

5. **Relying on review to catch perf regressions that only appear at scale.** The N+1 is invisible at test data volumes. Gate hot paths with benchmarks, require benchmarks for perf-sensitive modules, and make lazy-load-in-loop a *test* failure.

6. **Letting perf review become premature-optimization culture.** Demanding micro-optimizations on cold paths ships complexity and bugs to defend against load that never comes. "Is this actually hot? show me a profile" is the discipline — in both directions.

7. **Discovering architectural security flaws in the diff.** By then the cost is sunk and "this whole approach is wrong" is the only honest comment. Threat-model at design time; let PR review verify the implementation meets the model.

8. **Not closing the loop from the backstop.** A bug-bounty IDOR isn't done when the endpoint is patched — it's done when the framework makes that IDOR class un-introducible. Every backstop finding should become a gate or paved-road improvement.

---

## Test Yourself

1. Explain why "this security bug should have been caught in review" is the wrong frame at staff level, and what the right frame replaces it with.
2. An IDOR has now been caught in review three separate times this quarter. A teammate says "great, our review process is working." Why is that the wrong conclusion, and what's the actual fix?
3. Give the trigger rubric: name five categories of change that *require* a security review, and explain how you enforce routing for the ones that live in known files vs. ordinary files.
4. A perf regression (an N+1) sailed through review and only melted production at scale. Was the reviewer negligent? Justify your answer in terms of Concept 1, and give the durable fix.
5. Contrast the two failure modes of performance review and name the single tool/practice that fights both.
6. Three senior engineers approved a hand-rolled crypto routine that turned out to be badly broken. What's the systemic fix, and why isn't "train reviewers on crypto" the answer?
7. When should an architectural security concern be raised — at design time or PR time — and what does PR review's job become if you do it right?
8. For each of: a hardcoded secret, a known-vulnerable dependency, a missing ownership check, and a novel chained exploit — name the layer that should own catching it.

<details>
<summary>Answers</summary>

1. Human review is a **probabilistic filter, not a control** — its false-negative rate rises with diff size, fatigue, and subtlety, and the worst defects (missing authz, logic flaws, scale-only N+1s) are the highest-miss because the bug is *absence* or only manifests in production. The right frame: review is the **last layer of defence-in-depth**; the staff job is to push mechanizable defects to gates (SAST/secret/dep-scan) and structural defects to the **paved road**, shrinking what review must catch to the genuine judgement residue.

2. Catching the same class three times is a **paved-road gap, not a process win** — it means the framework still *lets* you write an endpoint without an ownership check. The fix is structural: route object loads through a policy layer that **fails closed** and requires an ownership predicate, so an IDOR of that class becomes inexpressible. Three "wins" via vigilance will become a loss the first time a reviewer is tired.

3. Any change that: touches **auth/authz**; introduces a **new trust boundary** (endpoint/parser/upload/webhook); touches **crypto**; handles **PII/regulated data**; **adds/upgrades a dependency**; does **deserialization/`eval`/SSRF/SQL-or-command construction**; or **changes a security control** (CSP/CORS/rate-limit/secrets). Enforce *known-file* routing with **CODEOWNERS** (auth/crypto/payments/serialization paths require AppSec to merge); enforce *ordinary-file* routing with a **PR-template trigger checklist** applied by the author and first-line reviewer/champion.

4. **Not negligent** — tracing every loop for a hidden per-iteration query across every diff, where the bug is invisible at test-data volumes, is exactly the un-scalable expectation Concept 1 warns against. The durable fix: a **dataloader/batch**, plus a **"benchmark required for changes to this path"** policy and configuring the ORM to **error in test** on lazy-load-in-loop — turning a scale-only defect into a test failure.

5. **Under-attention** (real regressions ship) vs **over-attention** (premature-optimization culture adds complexity/bugs for imaginary load). Both are fought with **data/observability**: profiles and traces reveal the real regression *and* prove a cold path is cold so you can reject the needless optimization. "Show me the profile" is the unifying practice.

6. The systemic fix is a **safe-by-default crypto library** exposing only high-level `seal`/`open` primitives (correct mode/IV/authentication chosen for you) and a **lint ban on raw cipher APIs**. "Train reviewers on crypto" fails because most reviewers aren't cryptographers and ECB-with-static-IV *looks* fine — you can't review what you're not qualified to evaluate, so you remove the ability to make the mistake.

7. At **design time** — by PR time the cost of an architectural flaw is sunk and "this whole approach is wrong" is the only honest (and most-overridden) comment. Threat-model upstream (trust boundaries, STRIDE, blast radius); then PR review's job becomes **verifying the code conforms to the threat model** (a concrete, tractable question) rather than discovering the model (an unbounded one).

8. Hardcoded secret → **secret-scanning gate** (block the push). Known-vulnerable dependency → **dependency-scanning gate** (fail the PR). Missing ownership check → **paved road / fail-closed authz** (and human as confirmation), because it's *absence* a human reliably misses. Novel chained exploit → the **backstop** (pen-test / bug-bounty), since no upstream layer is shaped to catch the novel composition.

</details>

---

## Cheat Sheet

```
THE CORE TRUTH
  Ad-hoc human security/perf review does NOT scale and is NOT a reliable
  primary control. Build a SYSTEM: review is the LAST layer atop automation.

DEFENCE-IN-DEPTH (push every defect as far LEFT as it'll go)
  paved road → SAST/secret/dep-scan → targeted perf gate → human → pen-test/bounty
  (un-introducible) (known patterns)   (regression)        (judgement) (backstop)

PAVED ROAD (the unifying idea — make the safe/fast way the DEFAULT)
  SQLi    → parameterized query builder is the only sanctioned path
  IDOR    → authz middleware that FAILS CLOSED; load via policy layer
  XSS     → auto-escaping templates; raw HTML needs a greppable marker
  SSRF    → one sanctioned HTTP client w/ allowlist; ad-hoc clients banned
  crypto  → vetted library, high-level seal/open; raw ciphers lint-banned
  N+1     → dataloader default; lazy-load-in-loop ERRORS in test
  unbounded → data layer requires explicit page size

SECURITY AT SCALE = ROUTING, not reviewing
  CODEOWNERS    → auth/crypto/payments/*serializ* require AppSec to merge
  trigger rubric → authz | untrusted input | crypto | PII | new dep | deserialize
  champions     → first-line review in-team; escalate novel/high-blast-radius
  backstop      → pen-test + bug-bounty; every finding → a gate/paved-road fix

PERF AT SCALE = two-front war, fought with DATA
  hot path  → benchmark GATE in CI, fail on regression > budget
  policy    → "changes to X require a benchmark"
  observable → trace/profile so review cites data, not guesses
  cold path → PROTECT simplicity; "is this hot? show me a profile"
  backstop  → load/capacity test for systemic (contention/pool/GC) regressions

THREAT MODEL at DESIGN time, not PR time
  doc answers: trust boundaries? STRIDE? blast radius? what are we trusting?
  → review then VERIFIES conformance instead of discovering the model
```

---

## Summary

- **The core truth:** ad-hoc human security/perf review does not scale and is not a reliable primary control. The staff engineer builds a **system** where review is one layer atop automation, ownership, and safe-by-default tooling — see [Static Analysis](../../static-analysis/) and [Quality Gates](../../quality-gates/) for the layers underneath.
- **Human review is the last layer, not the only one.** Push every mechanizable defect left to a gate (SAST, secret-scanning, dependency-scanning) and every structural defect down to the paved road, until the human is left with the genuine judgement residue — a smaller, sharper review surface.
- **The paved road is the unifying idea:** you don't scale quality by reviewing harder, you scale it by making the safe/fast path the *default* — parameterized queries, fail-closed authz, auto-escaping templates, a vetted crypto library, dataloaders. The real fix for a recurring vuln class is making it un-introducible.
- **Security at scale is a routing problem:** CODEOWNERS routes known sensitive paths (auth, crypto, payments, deserialization) to AppSec; a trigger rubric catches security-relevant changes in ordinary files; security champions are the first line; pen-test and bug-bounty are the backstop — and every backstop finding becomes a gate or paved-road improvement.
- **Performance at scale is a two-front war fought with data:** benchmark-gate the hot paths, require benchmarks for perf-sensitive modules, make performance observable so review cites traces not guesses — and ruthlessly protect cold paths from premature optimization. Load/capacity testing is the backstop for systemic regressions.
- **Threat-model at design time, not PR time:** architectural security flaws are caught upstream or not at all; by diff-time the cost is sunk. Push the security conversation to the design doc and let review verify conformance to the model.

You can now operate security and performance review as an org-scale system rather than a personal skill. The remaining tier — [interview.md](interview.md) — consolidates this into the questions that probe whether someone actually thinks at this level.

---

## Further Reading

- [OWASP SAMM](https://owaspsamm.org/) — the Software Assurance Maturity Model: how to assess and build out an org's security practices, including review and threat modeling.
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) — the Application Security Verification Standard: a concrete checklist of what "secure" means, ideal for turning threat-model output into reviewable requirements.
- *Building Secure and Reliable Systems* (Google/O'Reilly) — the definitive text on security and reliability as system properties, including safe-by-default design and the paved-road philosophy.
- *Systems Performance* by Brendan Gregg — the authoritative reference on performance methodology, observability, and profiling — the foundation for making perf review evidence-based.
- [Semgrep](https://semgrep.dev/) and [CodeQL](https://codeql.github.com/) docs — writing custom SAST rules to turn a recurring review finding into an automated gate.
- The OWASP Top 10 and API Security Top 10 — the canonical taxonomy of the defect classes your paved road and gates should target.
- [interview.md](interview.md) — the same material distilled into interview questions and what strong answers reveal.

---

## Related Topics

- [03 — Correctness & Design Review](../03-correctness-and-design-review/professional.md) — the design-review altitude where architectural security flaws are caught before they reach a diff.
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/professional.md) — prioritizing review attention, of which the security/perf trigger rubric is a specialization.
- [Security](../../../../Security/) — the deep treatment of the vulnerability classes (IDOR, injection, SSRF, crypto, ReDoS) your paved road and gates are built to neutralize.
- [Performance](../../performance/) — profiling, benchmarking, and the observability that makes perf review evidence-based rather than speculative.
- [Quality Gates](../../quality-gates/) — wiring SAST, dependency-scanning, and perf-regression benchmarks into CI as enforced merge gates.
