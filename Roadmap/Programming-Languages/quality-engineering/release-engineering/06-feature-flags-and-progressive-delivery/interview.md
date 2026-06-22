# Feature Flags & Progressive Delivery — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Feature Flags & Progressive Delivery

*A question bank that separates "I've used LaunchDarkly" from "I understand that a flag flip is an unreviewed production change."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Progressive Delivery](#progressive-delivery)
6. [Scenarios](#scenarios)
7. [More Scenarios](#more-scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Design Discussion](#design-discussion)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Quick Comparisons](#quick-comparisons)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering feature-flag and progressive-delivery questions the way a senior engineer does — leading with deploy≠release, the flag-type lifecycle, flags-as-rollback, and the unflinching truth that flag config is production config.**

Interviewers use this topic to probe whether you think about *release risk*, not just whether you can call an SDK. The strongest answers connect flags to rollback speed, to the consistency window across a fleet, to flag debt, and to Knight Capital as a concrete failure. Each question below states what's really being tested so you can calibrate depth.

---

## Prerequisites

- The four tier pages (junior → professional) of this topic.
- Comfort discussing deploys, rollbacks, canaries, and SLOs.
- One real example you can narrate: a feature you shipped behind a flag, or an incident a kill-switch resolved.

---

## Fundamentals

**Q1. What's the difference between a deploy and a release, and why does it matter?**
*What's really being tested: the foundational mental model — do you see release as a decision separate from shipping code.*
**A.** A **deploy** means the code is present and running on the server — a technical event. A **release** means users actually experience the new behavior — a business decision. Feature flags decouple them: code ships switched off, and the release is a separate flag flip you make when ready. This matters because it lets you ship unfinished work safely (merged but off, so it stays integrated and CI-tested), release one feature at a time from a deploy that contained ten, and turn a bad feature off in seconds without a rollback. Welding deploy to release means every ship is a release whether or not you're ready for it.

**Q2. Name the main flag types and explain why distinguishing them matters.**
*What's really being tested: Fowler's taxonomy and whether you reason about lifecycle and ownership.*
**A.** Four types: **release toggles** (short-lived, hide unfinished work, owned by dev, *meant to be deleted*), **ops toggles / kill-switches** (long-lived, disable a subsystem in emergencies, owned by SRE, *meant to live*), **experiment toggles** (A/B, owned by product/data, must give a consistent per-user value during the run), and **permission/entitlement toggles** (gate by plan/account, owned by billing, effectively permanent). It matters because they have opposite lifecycles and different owners: a release toggle still around at 100% is debt; deleting a kill-switch removes your emergency brake. Before creating a flag you should be able to name its type — if you can't, you don't yet know when to remove it.

**Q3. Why does every flag read take a default value, and what should the default be?**
*What's really being tested: resilience thinking — the flag system can fail.*
**A.** The default is what the SDK returns when it has nothing — flag service unreachable on a cold start, flag doesn't exist. It's your contract during an outage. The default must be the **safe / old** behavior, so that a failure of the flag system degrades to the known-good path rather than silently force-enabling an unfinished feature. The full resilience order is last-known-good cache → bootstrapped local file → hardcoded default; the default is the floor everything falls back to, so build the floor out of the survivable value.

**Q4. What is flag debt and why is it dangerous, not just untidy?**
*What's really being tested: do you treat flags as a liability with real failure modes.*
**A.** Flag debt is accumulated stale flags — release toggles that hit 100% but were never removed. It's dangerous for three reasons: **combinatorial test surface** (*n* boolean flags imply 2ⁿ behavioral combinations; nobody tests them all), **dead code paths** that rot behind long-on flags and are one bad flip from running in production, and **cognitive load** on everyone reading the code. The cure is lifecycle discipline: release toggles carry an owner and an `expiresAt`, CI escalates overdue flags, an inventory reconciles platform flags against code references, and cleanup deletes the flag *and* the dead code it guarded.

**Q4b. When does a release toggle's life actually end, and why is timing it badly so common?**
*What's really being tested: lifecycle discipline as a practiced habit, not a slogan.*
**A.** It ends the moment the feature is at 100% and stable — that's when you delete the flag *and* the old code path. It's commonly mistimed because at 100% the feature "works," the team has moved on to the next thing, and removing a flag has no visible payoff, so it slides. The fix is to make cleanup part of the feature, not optional homework: add the flag with an expiry date and an owner when you create it, and let CI escalate (ticket → warning → failing build) when it goes overdue. The cleanest moment is the day it hits 100%; defer it and it tends to live forever.

---

## Technique

**Q5. Walk me through evaluating a flag. Local vs remote evaluation — which and why?**
*What's really being tested: understanding of the data plane and the latency/availability coupling.*
**A.** Server-side SDKs do **local (in-process) evaluation**: the SDK downloads the entire ruleset once and evaluates rules against the request's context in memory — microseconds, no per-request network call, and user attributes never leave the process. The ruleset is refreshed off the hot path via **streaming** (sub-second propagation, best for kill-switches) or **polling** (every N seconds, simpler, but a flip takes up to one interval to land). **Remote evaluation** sends context to a server per call — used by lightweight/edge/browser SDKs where you can't ship the ruleset client-side — but it costs a round trip and exposes context. The rule: evaluation must be local on the hot path. If your p99 latency moves when the flag *vendor* has a bad day, you've put evaluation on the wrong side of the network.

**Q6. How do you test code that has flags? You can't test 2ⁿ combinations.**
*What's really being tested: pragmatic test strategy under combinatorial explosion.*
**A.** The contract is that any flag can be on or off and the system must work in every combination you actually ship. You can't test the cartesian product, so: test **both paths of each flag in isolation** (on-test and off-test per flag), test the **realistic combinations** that will coexist in production rather than all 2ⁿ, and make flags **injectable** so tests pin values explicitly via a fake/in-memory provider instead of reading prod config. Crucially, don't stop testing the old path once the new one works — until the flag is deleted, both paths are production code.

**Q7. How do flags relate to rollback?**
*What's really being tested: the senior insight that flags are your fastest revert — with a caveat.*
**A.** For anything gated behind a flag, the **flag kill-switch is your fastest rollback** — seconds, no build, no deploy — versus a traffic shift (minutes) or a binary redeploy (tens of minutes). Speed bounds the damage, so seniors deliberately ship risky changes behind flags they can *kill*. The caveat: a flag is only a rollback **while the old code path still exists and works**. The moment you delete the legacy path, the flag is no longer a revert — both positions run new code. So a kill-switch's off-path must stay alive and tested for the flag's whole life.

**Q8. What does it mean to design a flag that's "safe to flip"?**
*What's really being tested: that flag safety is design work, not config, especially across a fleet.*
**A.** Both values must be safe *simultaneously*, including during the consistency window when a flip hasn't reached the whole fleet. Concretely: if a flag changes a data-write format, the reader must accept both formats before the writer flag can move (the expand/contract pattern). No flag should trigger irreversible state on flip — if flipping deletes data or runs a one-way migration, you can't flip back, so decouple the destructive action. The default must be the survivable value, and a kill-switch's off-path must be kept warm and tested so it doesn't bit-rot.

---

## Progressive Delivery

**Q9. Explain canary, percentage rollout, and ring deployment. How do they differ?**
*What's really being tested: precision about the mechanisms, especially traffic vs users.*
**A.** A **canary** routes a small percentage of *traffic* to a new *deployment* of the service — infrastructure-level, flag-independent. A **percentage rollout** keeps one deployment but turns a *flag* on for a growing percentage of *users* — finer-grained and needs no second deployment. A **ring/cohort deployment** releases to named audiences in sequence — internal → beta opt-in → GA — each ring a gate to catch problems before the next larger group. They compose: a flag controls *behavior*; a canary controls *which binary serves traffic*. The bucketing for a percentage rollout hashes a stable user key, so the same user stays in the same bucket and the percentage is meaningful.

**Q10. What do Argo Rollouts and Flagger add over a manual percentage rollout?**
*What's really being tested: automated, metric-driven progressive delivery.*
**A.** They turn the rollout from a button a human presses into a process the system runs: they advance the traffic weight step by step *only if guardrail metrics stay healthy* (success rate, latency, custom SLIs) and **automatically roll back** when a metric breaches its threshold. So a canary that trips an error-budget-burn guardrail at 2am self-aborts before users are widely affected, with no human watching a graph. The critical design point is choosing guardrails that actually *see the change* — a global success-rate can green-light a feature-specific bug, so you add a metric scoped to the new behavior.

**Q11. Tell me about Knight Capital.**
*What's really being tested: whether you know the canonical flag disaster and can extract the lessons.*
**A.** In August 2012 Knight Capital deployed new trading code that **reused an old flag**; on one of eight servers that flag still activated long-dead code (*Power Peg*), and the deploy wasn't applied to all eight, so one server ran the new flag meaning wired to the old dead path. At market open it fired millions of unintended orders, losing roughly **$460 million in about 45 minutes** and bankrupting the firm. The lessons: **never reuse a flag's meaning** (flag identity is permanent and singular), **delete dead code** (a stale flag kept a defunct path reachable — a loaded gun), **apply config consistently across the whole fleet** (the one-of-eight inconsistency was the fault), and **have a fast, rehearsed kill-switch** (there was no quick way to stop it). It's why this topic harps on those four things — the cost of skipping them is a company.

---

## Scenarios

**Q12. Your new pricing logic ships and starts producing wrong totals in production. Walk me through your response.**
*What's really being tested: incident instinct and flag-as-rollback in practice.*
**A.** First, **flip the kill-switch** for the pricing flag to revert behavior in seconds — assuming I shipped it behind one with the legacy path intact (if not, that's the real lesson). That stops the bleeding far faster than a redeploy. Then assess blast radius from the flag's audit/targeting data (how many users, how long), check whether any wrong totals were *persisted* (irreversible state needing data correction beyond the flag flip), and only then debug calmly with the bad path disabled. Postmortem actions: confirm the off-path was actually safe, verify the default was the safe value, and check why this wasn't caught by the canary/guardrails — likely a guardrail metric that didn't see the pricing error specifically.

**Q13. A PM says "let anyone on the team flip any flag from the dashboard instantly." What's your reaction?**
*What's really being tested: the flag-config-is-production-config reframing.*
**A.** I'd push back, because **a flag change is a production change with the same blast radius as a deploy and usually none of the controls** — no review, no canary, no audit. The asymmetry of rigorous deploy gates next to a free-for-all flag UI concentrates unreviewed production risk in the channel we watch least. I'd scale controls to blast radius: self-serve for a 1% experiment, but a **two-person rule, mandatory blast-radius preview, immutable audit with a reason string, and staged change** (internal → canary → all) for high-risk/global flags. Flags should also obey change freezes. The goal isn't bureaucracy — it's making the safe path the easy path.

**Q14. You flip a flag that changes a data-write format. It propagates across the fleet over 30 seconds of polling. What can go wrong?**
*What's really being tested: the consistency window and expand/contract design.*
**A.** During the ~30-second **consistency window**, half the fleet writes the new format and half the old one — a split-brain. If readers only understand one format, you corrupt or fail on records written by the other half. The safe design is expand/contract: deploy readers that accept *both* formats *before* the writer flag can move, so any mix during the window is fine. For correctness-sensitive flags you also prefer streaming (sub-second skew) over slow polling. This is a small Knight Capital — inconsistent fleet state — defused by deliberate design.

**Q15. How would you decide whether to build or buy a feature-flag platform for a 300-engineer org?**
*What's really being tested: platform judgment and honest cost reasoning.*
**A.** Default to **buy a SaaS or adopt OSS (Unleash/Flagsmith) behind OpenFeature**, not build. Building underestimates the long tail: multi-language SDKs with consistent bucketing, streaming with bounded skew, RBAC, immutable audit, statistically correct experiment analysis, a usable UI, and tier-0 reliability — that's a product, not a sprint. The honest cost comparison is license fee vs (engineers + permanent on-call + opportunity cost) of running tier-0 infra forever. OpenFeature in front keeps the vendor decision reversible (swap a provider, not every call site) and gives org-wide evaluation telemetry via hooks. I'd build only if genuine hyperscale or unique constraints break every vendor.

**Q16. The flag vendor has a regional outage. What happens to your services, and what should you have designed?**
*What's really being tested: tier-0 reliability thinking and the difference between fail-static and fail-open.*
**A.** Nothing user-facing should happen, if it's designed right. Server-side SDKs evaluate locally from a cached ruleset, so a backend outage means the ruleset just stops *refreshing* — the SDK keeps serving the **last-known-good** values it already has (and persists to disk, so even a cold start during the outage has values). The dangerous anti-pattern is **fail-open to defaults**: if an outage flips every flag to its hardcoded default, you get a silent mass behavior change everywhere at once — worse than the service simply being down. So the design is **fail-static on last-known-good**, plus a "default-served-rate" alarm that spikes as a leading indicator when the backend starts failing, and never making the flag backend a hard dependency for service startup (bootstrap from a local file, refresh after).

**Q17. How do you make a flag change as safe and reviewable as a deploy without grinding the team to a halt?**
*What's really being tested: scaling controls to blast radius rather than one-size-fits-all bureaucracy.*
**A.** You scale the controls to the change's blast radius rather than gating everything equally. A 1% experiment flip stays self-serve. A global kill-switch flip gets the full deploy-grade treatment: a **two-person rule**, a **mandatory blast-radius preview** ("this affects ~4M users") computed from real targeting data, an **immutable audit entry with a reason string**, and a **staged change** (internal → canary cohort → all) with pause-and-observe, plus respecting change freezes. The principle is to make the safe path the easy path: the platform should default to the careful flow for high-risk flags so an operator who doesn't have a deploy mindset still can't fire a global change with one careless click.

---

## More Scenarios

**Q18. A targeting rule edit accidentally enables a heavy new feature for 100% of users instead of the intended 5%. How should the platform have stopped this, and how do you respond now?**
*What's really being tested: blast-radius containment and the "bad config push is a mass outage" insight.*
**A.** Three platform mechanisms should have contained it: a **blast-radius preview** before commit ("this affects 4.2M users") that would have made the 5%→100% mistake obvious; **staged config rollout** (canary the *ruleset push itself* to a small cohort before the fleet) so the bad rule never reaches everyone at once; and **guardrail metrics** on the rollout that auto-halt and roll back the config when latency/error rate regress. A bad ruleset push is the flag platform's own Knight Capital — a change that hits every SDK simultaneously — so config changes deserve the same staging as code. Right now: roll back the *ruleset* immediately (or flip the specific flag to its prior targeting), confirm from the audit log who changed what and why, and check whether the surge caused any persisted/irreversible effects.

**Q19. Your team wants to run an A/B experiment on checkout. What does it take to trust the result?**
*What's really being tested: experimentation rigor — does the candidate know flags-as-measurement can lie.*
**A.** Trust requires statistical hygiene the platform should enforce, not just a flag split. **Deterministic, uniform assignment** (hash the unit id plus a per-experiment salt so buckets are stable and independent across concurrent experiments). A **Sample Ratio Mismatch check** — if you intended 50/50 but observe 53/47 at scale, assignment or logging is broken and the result is *invalid*; fix it, don't read it. **No peeking**: either fix the sample size and horizon up front, or use sequential testing that stays valid under continuous monitoring, otherwise repeatedly checking "significant yet?" inflates false positives. **Guardrail metrics** that auto-abort if latency/error/churn regress even when the primary metric wins. And a **single primary metric** (or multiple-comparison correction) so twenty metrics at p<0.05 don't manufacture a false win. A measurement instrument that lies is worse than no data.

---

## Rapid-Fire

*Short questions, crisp answers — the kind that fill the gaps between deep ones.*

- **Q: Default value for a flag read?** A: The safe/old behavior — it's the floor during a flag-system outage.
- **Q: Streaming vs polling?** A: Streaming = sub-second propagation (use for kill-switches); polling = up to one interval of lag, simpler/more resilient.
- **Q: What makes a percentage rollout stable per user?** A: Hashing a stable user key into a fixed bucket — same user, same bucket every time.
- **Q: Fastest rollback lever?** A: A flag kill-switch (seconds) — but only if the old path still exists and works.
- **Q: What's OpenFeature?** A: A CNCF vendor-neutral evaluation API; backends plug in as providers, so you swap vendors without rewriting call sites.
- **Q: Fail-static vs fail-open?** A: Fail-static serves last-known-good on outage; fail-open flips everything to defaults — a silent mass behavior change, so fail-static is safer.
- **Q: When does a release toggle die?** A: The day it hits 100% and is stable — delete the flag and the old code path.
- **Q: SRM?** A: Sample Ratio Mismatch — observed split ≠ intended; the experiment is invalid, fix it, don't read the result.
- **Q: Why not call the flag vendor per request?** A: It couples your latency and availability to the vendor; evaluate locally from a cached ruleset.
- **Q: Two flag types meant to live, not die?** A: Ops/kill-switches and permission/entitlement toggles.
- **Q: Canary vs percentage rollout — one-word difference?** A: Traffic (canary, infra-level) vs users (rollout, flag-level).
- **Q: Why a per-experiment salt in the assignment hash?** A: So two concurrent experiments don't systematically overlap their buckets.
- **Q: What's a relay/proxy (ld-relay, Unleash Edge) for?** A: Fan out one upstream connection to thousands of SDKs — cuts vendor load and coupling.
- **Q: Reuse a flag key for a new purpose?** A: Never — it's the literal Knight Capital mistake; new purpose = new flag.
- **Q: Single biggest sign a flag is *not* a valid rollback?** A: The old code path was deleted, so both positions run new code.
- **Q: One leading indicator the flag backend is failing?** A: A spike in the default-served-rate across the fleet.

---

## Design Discussion

**Q20. Design how a flag change at high blast radius should flow through your system, end to end. What are the components and the checks?**
*What's really being tested: synthesis — can the candidate assemble the whole safe-change pipeline, not just recite parts.*
**A.** Start at intent: an operator proposes a change in the platform UI/API. The platform **computes blast radius** from live targeting data and shows "~N users / ~M req/s affected" — a surprising number stops the change here. For a **high-risk** flag, **policy-as-code** enforces a **two-person rule** and a required **reason string**; the change is rejected without them. On approval, the change becomes an **immutable audit event** (who/what/before→after/why) shipped to the same pipeline as deploys. Propagation is **staged**: the new ruleset rolls to an internal cohort, then a canary cohort, then the fleet — *the config push itself is canaried*, because a bad ruleset is a mass outage. At each stage **guardrail metrics** (tied to SLOs, scoped to see the change) gate progression and **auto-roll-back the ruleset** on breach. SDKs evaluate the new ruleset **locally** from a streamed update; if the backend is unreachable they **fail-static on last-known-good**. Finally, change freezes apply: during a freeze, high-risk flag changes are blocked just like deploys. The throughline is that a flag change is a deploy-equivalent production change, so it gets a deploy-equivalent pipeline — preview, review, audit, staged rollout, guardrails, and reversibility.

---

## Red Flags / Green Flags

**Red flags (weak answers):**
- Treats "flag" as one thing with no notion of types or lifecycle.
- Thinks deploy and release are the same event.
- Defaults a flag to the *new* path "so the feature works."
- Never mentions deleting flags; no awareness of flag debt or combinatorial test surface.
- Calls the flag vendor on every request; surprised that vendor latency becomes their latency.
- Sees flags as harmless config, not a production-change risk surface.
- Can't name a single failure mode (Knight Capital, split-brain, fail-open).

**Green flags (strong answers):**
- Leads with deploy ≠ release and connects flags to *release risk*.
- Names the four flag types with owners and lifecycles unprompted.
- Reaches for the kill-switch as the fastest rollback, *and* notes the old-path-must-survive caveat.
- States "flag config is production config" and proposes controls scaled to blast radius.
- Designs both flag values to be safe across the consistency window (expand/contract).
- Cites Knight Capital precisely and extracts the right lessons.
- Defaults to buy-behind-OpenFeature and reasons about tier-0 reliability and fail-static.

---

## Quick Comparisons

*Tables interviewers love to see you produce from memory — they prove you've internalized the distinctions rather than memorized definitions.*

**Flag types at a glance:**

| Type | Lifespan | Value changes | Owner | Deleted? |
|---|---|---|---|---|
| Release toggle | days–weeks | once (off→on) | dev team | yes, at 100% |
| Ops / kill-switch | months–years | rarely, in emergencies | SRE | no — kept as a brake |
| Experiment | weeks (one run) | per-user, fixed during run | product / data | yes, after the run |
| Permission / entitlement | permanent | when a plan changes | billing / product | no — it's business logic |

**Rollback levers, fastest first:**

| Lever | Speed | Precondition |
|---|---|---|
| Flag kill-switch | seconds | old code path still exists & works |
| Traffic shift / canary abort | minutes | a previous version still receiving traffic |
| Binary redeploy | tens of minutes | previous artifact available; re-runs pipeline |

**Config delivery: streaming vs polling:**

| | Streaming | Polling |
|---|---|---|
| Propagation latency | sub-second | up to one interval |
| Best for | kill-switches, urgent flips | most flags; flaky networks |
| Resilience | needs a stable connection | tolerant of intermittent connectivity |

**Failure behavior: fail-static vs fail-open:**

| | Fail-static (correct) | Fail-open to defaults (dangerous) |
|---|---|---|
| On backend outage | serves last-known-good | flips everything to hardcoded defaults |
| Effect | no behavior change | silent mass behavior change at once |
| Verdict | the only acceptable mode | worse than the service being down |

---

## Cheat Sheet

```text
CORE            deploy = code on server | release = users get behavior | flag = the switch between

TYPES           release(dev, dies) | ops/kill-switch(SRE, lives) |
                experiment(data, consistent) | permission(billing, permanent)

EVALUATION      local in-proc from cached ruleset (µs) | stream(<1s) vs poll(N s) |
                unreachable → LKG cache → local file → SAFE default

PROGRESSIVE     canary(traffic %) | rollout(flag %, stable hash bucket) | rings(internal→beta→GA) |
                Argo/Flagger: advance on guardrail metrics, auto-rollback on breach

ROLLBACK        flag kill-switch (s) > traffic shift (min) > redeploy (10s min)
                valid ONLY IF off-path still exists & works

KNIGHT CAPITAL  reused flag + dead code + inconsistent fleet + no kill-switch → ~$460M / 45 min
                → never reuse a flag | delete dead code | apply config atomically | fast kill-switch

CONFIG=PROD     flag change = deploy-risk, fewer controls → audit + reason, blast-radius preview,
                two-person rule (high risk), staged change, fail-STATIC not fail-open

DEBT            2^n combos | dead paths rot | release toggles get owner+expiry | delete flag AND code
```

---

## Summary

Interviewers probe this topic for release-risk thinking. Anchor every answer in deploy ≠ release, then layer the flag-type taxonomy (and its lifecycle/ownership consequences), local evaluation with safe defaults, progressive delivery via canaries/rollouts/rings driven by guardrail metrics, and flags as your fastest rollback — with the caveat that the old path must survive. The senior differentiators are stating that **flag config is production config** and proposing controls scaled to blast radius, designing flags safe across the consistency window, and citing Knight Capital precisely. At the platform level, default to buy-behind-OpenFeature and reason about tier-0 fail-static reliability and experiment statistical rigor. The candidate who only "used a flag SDK" stops at Q1; the one who understands flags as an unreviewed production-change surface carries the whole interview.

---

## Further Reading

- Martin Fowler & Pete Hodgson — *Feature Toggles* (taxonomy, lifecycle, management)
- Knight Capital SEC release & postmortems — the canonical disaster
- OpenFeature (CNCF) — the vendor-neutral standard
- Argo Rollouts / Flagger docs — automated progressive delivery
- *Trustworthy Online Controlled Experiments* — Kohavi et al. (experiment rigor)
- *Continuous Delivery* (Humble & Farley) and *SRE* (Google) — release decisions, error budgets
- The `monitoring-alerting`, `circuit-breaker-pattern`, and `ci-cd-pipeline-design` skills

---

## Related Topics

- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — flags as fastest revert; revert vs roll-forward; expand/contract
- [Release Branching & Trains](../03-release-branching-and-trains/) — flags enable trunk-based release and decouple cadence from readiness
- [Release Automation](../08-release-automation/) — flag/rollout changes inside the pipeline
- [Supply-Chain Security](../09-supply-chain-security/) — trusting the artifact you progressively expose
- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) — provenance of the build behind the rollout
