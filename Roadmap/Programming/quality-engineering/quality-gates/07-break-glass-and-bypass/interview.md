# Break-glass & Bypass — Interview Level

> **Roadmap:** [Quality Gates](../README.md) → Break-glass & Bypass
> *A break-glass interview almost never asks "what is an override." It asks "prod is down and the fix is blocked by a required check — what do you do," and then watches whether you reach for a sanctioned, logged path or for the admin button. The whole topic is one idea wearing many costumes: a gate you can't legitimately override gets illegitimately overridden. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Mechanisms](#mechanisms)
5. [Audit Integrity & Normalization of Deviance](#audit-integrity--normalization-of-deviance)
6. [Compliance & Incident Response](#compliance--incident-response)
7. [Judgement & Scenarios](#judgement--scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **good bypass vs bad bypass** (deliberate, logged, alerted, reviewed vs silent admin-merge)
- **bypassing the gate vs deleting the gate** (a controlled override keeps the gate; a silent override quietly removes it for everyone)
- **the human vs the gate** (a person who broke the rule vs a gate that forced them to)
- **the action vs the audit trail** (what you did vs the tamper-evident, out-of-band record that you did it)

Nearly every question in this bank is one of those distinctions in disguise. The candidates who do well are the ones who treat a *sanctioned* break-glass not as a failure of the gate but as part of the gate's design — and who reflexively ask "where's the log, and who reviews it?"

---

## Prerequisites

You'll answer better if you're comfortable with: required CI checks and branch protection (what a gate physically *is* on a platform like GitHub); the difference between an approval and an automated check; basic IAM (roles, STS/`AssumeRole`, JIT/PIM access); and the idea of an audit log as a control, not just a debugging aid. If "required status check," "CODEOWNERS approval," and "time-boxed credential" aren't familiar, read [junior.md](junior.md) first — this page assumes them.

---

## Fundamentals

### Q1.1 — What is "break-glass," and why would a quality gate ever need a sanctioned way to bypass it?

> **Testing:** Whether you see break-glass as designed-in safety or as cheating.

**A.** Break-glass is a **pre-authorized, deliberate, logged override** of a control for an emergency the control would otherwise block — named after the little glass-fronted fire-alarm box you smash in a crisis. A quality gate needs one because gates exist to stop *bad* changes, but occasionally the situation inverts: prod is down, the fix is correct, and the gate (a flaky required check, a reviewer who's asleep, a slow security scan) is the only thing standing between users and recovery. If there's no sanctioned override, people invent an *unsanctioned* one — an admin merge, a disabled check, a force-push — under stress, with no record. The line I use: **a gate you can't legitimately override gets illegitimately overridden, usually at 3 a.m., with nobody watching.** Designing the escape hatch is how you keep the gate; refusing to is how you lose it.

### Q1.2 — What separates a *good* bypass from a *bad* one?

> **Testing:** The core distinction of the entire topic.

**A.** It's not whether the gate was skipped — sometimes skipping is exactly right. It's *how*. A **good** bypass is deliberate (a human made an explicit decision), least-privilege (only the specific check needed, not "admin everything"), time-boxed (the elevated access expires), **logged** (an immutable record of who, what, when, why), **alerted** (someone other than the actor knows in real time), and **reviewed** (a mandatory after-the-fact look). A **bad** bypass is silent: an admin merges past a failing check with no ticket, no alert, no review, and the only evidence is a line in the merge history nobody reads. Same outcome on the surface — code shipped past a gate — but one is an auditable, defensible control and the other is an invisible hole. The properties spell it out: *pre-authorized, deliberate, least-privilege, time-boxed, logged, alerted, reviewed.* Drop any one and you've drifted toward the bad version.

### Q1.3 — Isn't the existence of a bypass an admission the gate is wrong?

> **Testing:** Whether you can hold "gates are necessary" and "gates must be escapable" at once.

**A.** No — it's an admission that *no gate is right 100% of the time*. A gate encodes a default ("don't ship without these checks") that's correct in the overwhelming majority of cases. Break-glass handles the rare tail where following the default does more harm than breaking it — classically, **the gate is blocking the fix to the very incident the gate's safety is meant to prevent.** A gate with no override is brittle: it's either so strict it gets bypassed illegitimately, or so loose it doesn't protect anything. The mature design is a strong default *plus* a controlled, expensive, visible exception. The exception being *expensive and visible* (paperwork, alerts, review) is what keeps it rare without making it impossible.

### Q1.4 — A teammate says "we don't need break-glass, we just give the leads admin." What's wrong with that?

> **Testing:** Standing access vs deliberate, scoped override.

**A.** That's standing privileged access masquerading as break-glass, and it fails most of the properties. Standing admin is *always on*, so there's no deliberate "I am breaking glass right now" moment — every merge a lead does *could* be a bypass and you can't tell the routine ones from the emergency ones. It's not least-privilege (admin can do far more than skip one check), not time-boxed (it never expires), and usually not specifically alerted or reviewed (admin actions blend into normal activity). The whole point of break-glass is that it's an **event** — a distinct, rare, high-signal action that lights up dashboards. Standing admin makes the bypass *ambient*, which is exactly how it becomes invisible. Better: leads have normal access, and break-glass is a separate, audited path they step into deliberately and step out of automatically.

---

## Mechanisms

### Q2.1 — Concretely, how do you implement break-glass for a GitHub branch-protection gate?

> **Testing:** Whether you know the actual platform mechanics, not just the theory.

**A.** A few layers, from least to most controlled:

- **Admin bypass** — branch protection has a "do not allow bypassing the above settings / include administrators" toggle. With admins *included*, even they are gated; the override is an admin temporarily merging via elevated permission. The honest version of this keeps `enforce_admins` on for normal work and treats any admin merge as a break-glass event.
- **Audit log** — every bypass, force-push, and protection change is recorded in the **organization audit log** (`protected_branch.policy_override`, `git.push` with force, settings changes). This is the record that makes the bypass *good* instead of silent.
- **A scripted break-glass action** — rather than humans clicking around, a workflow (triggered with a reason and an incident ID) uses a short-lived elevated token to merge, posts to an incident channel, files a review ticket, and re-locks the branch. The human never holds standing admin; they invoke a logged, single-purpose tool.

The key is that the *capability* (merge past the gate) is decoupled from *standing permission* and wrapped in logging + alerting.

### Q2.2 — Walk me through an emergency-deploy pipeline. How is it different from the normal one?

> **Testing:** "Skip the slow gates, keep the safe ones, log everything."

**A.** A normal deploy runs the full gate set: tests, coverage threshold, security scan, integration suite, staged rollout, manual approval. An **emergency pipeline** is a *separate, named* path that skips the **slow** gates (the 40-minute integration suite, the soak in staging) while keeping the **cheap and critical** ones (build, smoke test, the deploy itself being reversible). What makes it safe rather than reckless:

```yaml
# emergency-deploy.yml (sketch)
on:
  workflow_dispatch:
    inputs:
      incident_id: { required: true }      # forces a real incident to exist
      reason:      { required: true }
jobs:
  emergency:
    steps:
      - run: ./scripts/assert-incident-open.sh "${{ inputs.incident_id }}"
      - run: ./scripts/smoke-test.sh         # keep the fast safety net
      - run: ./scripts/deploy.sh             # reversible, canary-first
      - run: ./scripts/notify.sh "EMERGENCY DEPLOY by ${{ github.actor }} ref=${{ github.sha }} incident=${{ inputs.incident_id }}"
      - run: ./scripts/open-postmortem-task.sh "${{ inputs.incident_id }}" "${{ github.sha }}"
```

It demands an incident ID (so it can't be the casual fast lane), keeps a smoke test, alerts loudly, and *auto-files the review*. It skips slow gates; it never skips the *log*.

### Q2.3 — How does break-glass work for cloud IAM, and what's "JIT" versus "PIM"?

> **Testing:** That break-glass isn't only a merge concept — it's an access concept.

**A.** The same pattern shows up in access control. **Standing access** means an engineer permanently holds, say, prod-database write — always available, always an attack surface, the thing breaches abuse. **JIT (Just-In-Time) access** means they hold *nothing* by default and request elevation when needed: a system grants a **time-boxed credential** (e.g. AWS STS `AssumeRole` with a 1-hour session, or a JIT tool that adds you to a group for 60 minutes and removes you automatically). **PIM (Privileged Identity Management)** is Azure/Entra's productized version — "activate" an eligible role for a bounded window, optionally with approval and justification. Break-glass IAM is JIT with the emergency dial turned up: a *highly* privileged role, normally unreachable, that you can activate in a crisis — and activating it pages the security team, demands a reason, expires fast, and is reviewed afterward. The spectrum is **standing → JIT → break-glass**, trading convenience for ever-tighter scope, time-boxing, and scrutiny.

### Q2.4 — Where should the "reason" for a bypass live, and why does it matter?

> **Testing:** Whether you treat the justification as a first-class, queryable artifact.

**A.** It should be a **required, structured input** captured at the moment of the bypass and written to the immutable log — not a Slack message that scrolls away, not someone's memory. Required because optional fields go blank under stress; structured (incident ID, severity, what gate was skipped, who authorized) because the review and the metrics depend on querying it later ("show me every prod bypass last quarter and its incident ID"). It matters for three reasons: the reviewer needs context to judge whether the bypass was justified; the **bypass-rate-per-gate** metric is only meaningful if each bypass is tagged with *why*; and auditors will ask for exactly this — a controlled emergency-change process means each emergency change has a recorded justification linked to an incident. A bypass with no captured reason is, to an auditor, indistinguishable from an uncontrolled one.

---

## Audit Integrity & Normalization of Deviance

### Q3.1 — Why must the break-glass audit trail be tamper-evident and out-of-band?

> **Testing:** The differentiator — recognizing that the person bypassing is often the person who could erase the evidence.

**A.** Because the actor frequently has the power to alter the record. Think it through: break-glass often means *elevated* privilege — admin on the repo, a powerful IAM role. An admin who can merge past a gate can frequently also **edit branch-protection settings, rewrite history with a force-push, or in the worst case touch the logging itself.** If the audit log lives in the same system, under the same admin, then "logged" is theatre — the actor can cover their tracks. So the trail must be:

- **Tamper-evident** — append-only, or hash-chained, so deletion/edits are detectable even if not preventable.
- **Out-of-band** — shipped to a system the actor *doesn't* control: a separate logging/SIEM account, a write-only sink, a security team's tenant. AWS CloudTrail to a *separate* logging account with the bucket locked (Object Lock / WORM) is the canonical shape.

The design principle: **the person who can break the glass must not be the person who can sweep up the shards.** Separation of duty between *acting* and *recording* is what makes the log trustworthy. An in-band, editable log gives false comfort — it documents only the bypasses nobody bothered to hide.

### Q3.2 — What is "normalization of deviance," and how does it apply to gate bypasses?

> **Testing:** Whether you know the failure mode that quietly kills gates — and can name its source.

**A.** It's a concept from sociologist **Diane Vaughan's** analysis of the *Challenger* disaster: when a deviation from the rule is repeated without immediate catastrophe, people stop seeing it as a deviation. The unacceptable becomes routine, the safety margin silently erodes, and "we've always done it this way" replaces "this is a known risk." On *Challenger*, launching outside the O-rings' tested temperature range had been survived before, so it got re-coded as acceptable — until it wasn't. Applied to gates: the first admin-merge-past-a-failing-test feels transgressive; the tenth is muscle memory; by the hundredth the gate is *de facto* optional and nobody remembers it's being bypassed. Each individual bypass "worked" (nothing broke that day), so the team's sense of normal drifts. The gate still exists on paper and protects nothing in practice. The danger isn't the single emergency bypass — it's the **slow re-baselining of what's acceptable** until the exception is the rule.

### Q3.3 — How do you *fight* normalization of deviance on a gate?

> **Testing:** Concrete countermeasures, not just naming the problem.

**A.** Three levers, and the third is the real fix:

1. **Visibility** — make every bypass loud and counted. A bypass that pages a channel and increments a dashboard can't quietly become normal, because everyone keeps *seeing* it as an exception. Silence is what lets deviance normalize; high signal is the antidote.
2. **Mandatory review** — every break-glass triggers a required after-action review (blameless, but *not optional*). Review forces the team to re-confront each bypass as an event rather than letting it dissolve into background noise.
3. **Fix the gate** — and this is the one that actually ends the drift. If a gate is bypassed repeatedly, the bypasses are a *symptom*: the gate is too slow, too flaky, or too strict. Treat a high bypass rate as a **defect in the gate** and fix the gate so the bypass is no longer needed. Visibility and review keep deviance from hiding; fixing the gate removes the reason for the deviance. You can't willpower your way out of normalization — you remove the friction that drives people to deviate.

### Q3.4 — What single metric best tells you whether a gate is healthy?

> **Testing:** Whether you know the one number that surfaces silent rot.

**A.** **Bypass rate per gate** — how often each specific gate is overridden, over time, ideally tagged with the reason. It's the early-warning signal for normalization of deviance: a gate bypassed once a quarter during real SEV1s is healthy; a gate bypassed three times a week is *not a gate*, it's a speed bump with a justification field. Tracking it per-gate (not in aggregate) is what makes it actionable — it points at the *specific* control that's broken. And tracking it at all is what turns invisible drift into a number someone owns. The reframe I'd offer: a rising bypass rate isn't a discipline problem to be solved with a stern email; it's a product signal that says "this gate's design is wrong for how the team actually works — go fix it."

---

## Compliance & Incident Response

### Q4.1 — Auditors require change controls. Don't they forbid bypassing them?

> **Testing:** The common misconception that compliance bans emergencies.

**A.** No — and this surprises people. Frameworks like **SOC 2** and **SOX** don't demand that controls are *never* bypassed; they demand that bypasses are **controlled, justified, logged, and reviewed.** Every serious change-management standard has an explicit **emergency-change** path precisely because auditors know production emergencies happen. What an auditor actually wants to see is: an emergency change is *authorized* (someone with authority approved it, even retroactively within a defined window), *documented* (linked to an incident, with a reason), *logged* immutably, and *reviewed* after the fact (it went through the normal review/approval *post hoc*). A controlled, logged, reviewed break-glass isn't an audit *finding* — it's evidence the control framework is *working*, because it shows the org handles exceptions deliberately. The thing that fails an audit is the **uncontrolled** bypass: the admin merge with no ticket, no justification, no review. So break-glass done right is *pro-compliance*, not anti-compliance.

### Q4.2 — Why pre-plan a SEV1 fast-path in a runbook instead of improvising?

> **Testing:** Whether you've felt the cost of inventing process during an outage.

**A.** Because **3 a.m. during an outage is the worst possible time to design a safe override.** People are stressed, sleep-deprived, and optimizing for "make it stop" — which is exactly when someone reaches for `--force` or disables a check and forgets to re-enable it. A pre-planned fast-path in the runbook removes the improvisation: it spells out *which* gates can be skipped, *which* must not, who can authorize, the exact command/workflow to invoke (the emergency pipeline, the break-glass role), and what gets auto-logged and auto-reviewed. The decisions that need a clear head — "is skipping the integration suite acceptable here?" — were made *in advance*, in calm, by the people who own the gate. Responders then *execute* a known-safe procedure instead of *inventing* one under pressure. Pre-planning is how you get speed *and* safety in the moment instead of trading one for the other.

### Q4.3 — Describe the "gate that blocks the fix" problem.

> **Testing:** The specific failure where safety machinery becomes the hazard.

**A.** It's when the control designed to keep prod safe becomes the obstacle to *restoring* prod. Examples: a required security scan takes 30 minutes, and the one-line fix to a live outage can't merge until it finishes; a required two-reviewer approval, but it's 3 a.m. and the only awake engineer *is* the fix author; a "no deploy on red main" rule, but main is red *because of the incident* and the fix is what turns it green. In each case, **the gate is now extending the outage it exists to prevent.** This is the canonical justification for break-glass — not "I don't like the gate," but "the gate's cost has, in this specific moment, exceeded its benefit, and following it harms users more than skipping it." Recognizing this pattern is what separates a legitimate emergency override from convenience. And chronic occurrences of it are a design smell: if the gate *regularly* blocks fixes, the gate is too slow or too rigid for incident conditions and needs an emergency mode built in.

### Q4.4 — During the incident, who decides to break glass, and does that need approval up front?

> **Testing:** Balancing speed against authorization without grinding the response to a halt.

**A.** The decision sits with the incident commander or the responding senior engineer — someone with the authority and context to judge "the gate's cost now exceeds its benefit." The trap is requiring slow, synchronous *pre*-approval (a VP signs off before you can deploy the fix), which reintroduces exactly the delay break-glass exists to avoid. The usual resolution is **authorize-then-review**: the responder is *pre-authorized* by policy to break glass for a genuine SEV1, acts immediately, and the action is heavily logged and *reviewed after the fact* (sometimes with a "two-person rule" — a second responder acknowledges in-channel, which is fast and still adds a check). So approval is *structural and prior* (policy says "an IC may do this in a SEV1") rather than *synchronous and blocking* (waiting for a human to say yes mid-outage). The review is where the real scrutiny lives, after users are safe.

---

## Judgement & Scenarios

### Q5.1 — Prod is down. The fix is a one-line PR, but a required check (or required approval) blocks the merge. What do you do — and what makes it safe?

> **Testing:** The flagship scenario. Calm, sanctioned-path triage versus the admin button.

**A.** First I'd verify the fix is actually correct and minimal — a rushed wrong fix in an outage makes things worse. Then, rather than disabling the check or force-merging silently, I reach for the **sanctioned break-glass path**:

1. **Declare/confirm the incident** so there's an ID to attach everything to — the bypass must be tied to a real SEV1, not just "I'm in a hurry."
2. **Invoke the documented emergency procedure** — the emergency-deploy workflow or the break-glass merge action — which skips the *slow* gate (the long check / sleeping reviewer) but keeps the cheap safety net (smoke test, reversible/canary deploy) and captures a reason.
3. **It alerts automatically** — the action pages the incident channel: who, what SHA, which gate, which incident.
4. **It auto-files the review** — a postmortem/review task is created so the bypass gets a mandatory blameless look afterward.

What makes it safe is *not* that I skipped the gate — it's that I skipped it **deliberately, through a logged, alerted, pre-authorized path tied to an incident, with a review queued.** The contrast I'd draw explicitly: the unsafe version is identical in outcome (code shipped past a check) but invisible — clicking "merge without waiting for requirements" as an admin, no incident link, no alert, no review. Same merge; one is a defensible control, the other is the hole that gets the gate deleted.

### Q5.2 — Your team admin-merges past failing checks every Friday to hit the release. What's the problem, and how do you fix it?

> **Testing:** Recognizing normalization of deviance and applying "fix the gate, not the human."

**A.** The problem isn't (mainly) that people are breaking the rule — it's **normalization of deviance**: a weekly bypass has stopped registering as a bypass. The gate is *de facto* optional, the safety margin it was meant to provide is gone, and "we always merge red on Fridays" has become normal. Crucially, the bypass is now *routine and invisible* — the worst combination — so a genuinely dangerous change can slide through under the same habit. The fix is **not** a stern "stop admin-merging" email; that fights symptoms and ignores *why* people bypass. I'd:

1. **Measure it** — surface the bypass rate on this gate so the pattern is undeniable and owned.
2. **Diagnose the gate** — a *weekly* bypass means the gate is wrong: the checks are too **flaky** (people bypass because they're red for no real reason), too **slow** (they don't finish before the release window), or too **strict** (they block things that are actually fine).
3. **Fix the gate accordingly** — de-flake or quarantine the unreliable tests, speed up the slow check, or relax/right-size the threshold. Make the *safe* path the *fast* path so there's no incentive to bypass.
4. *If* a bypass is still occasionally legitimate, route it through a real break-glass (logged, reviewed) instead of silent admin-merge.

The frame: **chronic break-glass is a gate defect, not a people defect.** You fix the gate, not the human.

### Q5.3 — Design a break-glass mechanism for production deploys at a regulated company.

> **Testing:** Synthesizing every property into a concrete, audit-ready design.

**A.** I'd build it around the six properties and an out-of-band trail:

- **Pre-authorized & least-privilege** — a dedicated break-glass IAM role (e.g. STS `AssumeRole`, or PIM-eligible role) scoped to *exactly* the prod-deploy permissions needed, nothing more. Normal engineers hold *none* of it day-to-day (standing access is the thing we're avoiding).
- **Deliberate & time-boxed** — activating it is an explicit action that requires an **incident ID + written justification**, and the credential is short-lived (e.g. 1-hour STS session) so it can't linger.
- **Logged out-of-band** — every activation and every action taken under it streams to a **separate logging account** (CloudTrail → locked, WORM/Object-Lock bucket the role-holder can't edit). The actor cannot alter their own trail.
- **Alerted** — activation immediately pages the security/on-call team and posts to the incident channel; optionally a **two-person rule** so a second person acknowledges.
- **Reviewed** — activation auto-creates a mandatory review/postmortem ticket; a blameless-but-required review confirms it was justified and feeds the emergency-change evidence auditors expect (SOC 2 / SOX).
- **Measured** — every activation increments a per-gate bypass metric so chronic use surfaces as a gate-design problem.

I'd close by noting the deploy itself should be **reversible/canary-first even in break-glass** — emergency mode skips *slow* gates, never the ability to roll back. That design is both fast enough for a real outage and clean enough to hand an auditor.

### Q5.4 — How do you stop the break-glass admin from covering their tracks?

> **Testing:** The audit-integrity differentiator, asked head-on.

**A.** By making sure the person who can *act* cannot *erase the record of acting* — separation of duty between doing and logging. Concretely:

- **Out-of-band, append-only logs** — ship the audit trail to a system in a *different* trust boundary (a separate logging account / SIEM / security tenant) that the break-glass role has **no write or delete** permission on. Even with elevated prod access, they can't reach the log store.
- **Immutability at rest** — WORM / Object Lock / retention locks so even an account admin can't delete or rewrite entries within the retention window; hash-chaining so any tampering is *detectable*.
- **Log the meta-actions too** — changes to branch protection, to the logging config, to IAM policies, and force-pushes must themselves be logged out-of-band. The classic evasion is to disable logging *first*, so "logging was disabled" must be an alertable, recorded event.
- **Alert in real time** — push the bypass to a channel/SIEM the moment it happens, so even if someone later deletes a record, *humans already saw it*. Real-time fan-out beats after-the-fact log integrity alone.
- **No standing admin on the audit pipeline** — the security team that owns the logs is *not* the team that holds break-glass on prod.

The principle, stated plainly: **the one who breaks the glass must not own the broom.** If your audit log lives in the same account under the same admin who's bypassing, you don't have an audit log — you have a courtesy.

### Q5.5 — When is *refusing* to break glass the senior move?

> **Testing:** Judgment — that break-glass is a sharp tool, not a default.

**A.** When the override's cost outweighs its benefit, which is most of the time. Refusing is right when: the "emergency" is really just a deadline or convenience (break-glass is for incidents, not for skipping a slow CI run on a normal Tuesday); the skipped gate is the one *actually protecting against the current risk* (force-deploying past a security scan during a *security* incident is insane); or the fix is rushed and unverified, where shipping faster ships the wrong thing faster. The senior instinct is to treat break-glass as **expensive and rare on purpose** — every use spends trust and erodes the gate's meaning a little. So I'd push back on casual requests ("can we just admin-merge this, the check is annoying") and redirect to *fixing the annoying check*, while keeping the glass genuinely available for genuine emergencies. Knowing when *not* to use it is what keeps it credible for when you must.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: One-line definition of break-glass?** A: A pre-authorized, deliberate, logged, reviewed override of a control for an emergency the control would otherwise block.
- **Q: Good bypass vs bad bypass?** A: Deliberate + least-privilege + time-boxed + logged + alerted + reviewed, versus a silent admin-merge nobody sees.
- **Q: Standing vs JIT vs break-glass access?** A: Always-on, versus request-a-time-boxed-credential, versus a rare emergency-only highly-privileged activation that pages and is reviewed.
- **Q: What does PIM give you?** A: Azure/Entra time-boxed "activate an eligible role" with justification and optional approval — JIT for privileged roles.
- **Q: Why does the audit trail need to be out-of-band?** A: Because the break-glass admin may have permission to edit in-band logs and cover their tracks.
- **Q: One metric for gate health?** A: Bypass rate per gate over time — chronic bypass = a broken gate.
- **Q: Whose idea is normalization of deviance?** A: Diane Vaughan, from the *Challenger* disaster — repeated rule-breaking re-baselines what's "normal."
- **Q: Do SOC 2 / SOX forbid bypasses?** A: No — they require *controlled* bypasses (authorized, justified, logged, reviewed) via an emergency-change process.
- **Q: "Fix the gate, not the human" means?** A: Chronic break-glass is a gate defect (too slow/flaky/strict), not a discipline problem — fix the gate.
- **Q: The "gate that blocks the fix" problem?** A: A required check/approval delays the fix to the very outage the gate's safety exists to prevent.
- **Q: Why pre-plan a SEV1 fast-path?** A: So responders execute a known-safe procedure instead of improvising `--force` at 3 a.m.
- **Q: Skip which gates in an emergency deploy?** A: The slow ones (long integration suites, staging soak) — never the cheap safety net (smoke test, reversibility) and never the log.
- **Q: Authorize-then-review vs blocking approval?** A: Pre-authorize by policy and review after, so you get speed without waiting for a synchronous sign-off mid-incident.
- **Q: Where should the bypass "reason" live?** A: A required structured field written to the immutable log, linked to an incident — not a Slack message.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating any bypass as automatically a failure — missing that a *sanctioned* override is part of a gate's design.
- "We just give the leads admin" — standing privilege mistaken for break-glass.
- Forgetting the audit trail entirely, or assuming an in-band log under the same admin is trustworthy.
- Solving chronic bypassing with a stern email instead of fixing the gate.
- Skipping the *cheap* safety gates (smoke tests, reversibility) along with the slow ones in an emergency.
- Thinking compliance *forbids* emergency changes rather than *requiring them to be controlled*.
- Improvising overrides during the incident instead of having a pre-planned runbook path.
- Requiring slow synchronous approval before any emergency action can happen.

**Green flags:**
- Naming the *distinction* — good vs bad bypass — and listing the properties (pre-authorized, least-privilege, time-boxed, logged, alerted, reviewed) unprompted.
- Reaching for a **logged, alerted, incident-tied** path before the admin button.
- Bringing up **normalization of deviance** and *bypass-rate-per-gate* without being led there.
- Insisting the audit trail be **tamper-evident and out-of-band**, with separation between acting and logging.
- "Fix the gate, not the human" — treating chronic break-glass as a gate defect.
- Framing controlled break-glass as *pro-compliance* (the emergency-change process auditors expect).
- Pre-planning the SEV1 fast-path and using *authorize-then-review* for speed-with-safety.
- Knowing when **refusing** to break glass is the senior move.

---

## Cheat Sheet

| Concept | One-liner |
| --- | --- |
| **Break-glass** | Pre-authorized, deliberate, logged, reviewed override for a real emergency. |
| **Good vs bad bypass** | Same outcome; one is logged/alerted/reviewed, the other is silent. |
| **Six properties** | Pre-authorized · least-privilege · time-boxed · logged · alerted · reviewed. |
| **Standing → JIT → break-glass** | Always-on → time-boxed-on-request → rare emergency-only activation. |
| **Out-of-band log** | Audit trail in a system the actor *can't* edit (separate account, WORM). |
| **Tamper-evident** | Append-only / hash-chained so edits are detectable. |
| **Normalization of deviance** | Repeated bypass re-baselines "normal"; margin erodes silently (Vaughan/*Challenger*). |
| **Bypass rate per gate** | The health metric; chronic bypass = a broken gate. |
| **Fix the gate, not the human** | Chronic break-glass is a gate defect (too slow/flaky/strict). |
| **Gate-that-blocks-the-fix** | The control delays the fix to the outage it's meant to prevent. |
| **Emergency pipeline** | Skips *slow* gates, keeps cheap safety + logs; requires incident ID. |
| **Authorize-then-review** | Pre-authorized by policy, act now, review after — speed + safety. |
| **Compliance stance** | SOC 2 / SOX *accept* controlled, logged, reviewed emergency changes. |

---

## Summary

- The whole topic reduces to a few distinctions in costume: **good vs bad bypass**, **bypassing vs deleting the gate**, **the human vs the gate**, and **the action vs its audit trail**. Name the distinction first; the mechanism follows.
- **Break-glass is designed-in safety, not cheating.** A gate you can't legitimately override gets illegitimately overridden under stress — so you build a sanctioned escape hatch that's *pre-authorized, deliberate, least-privilege, time-boxed, logged, alerted, and reviewed*. Drop any property and it drifts toward the silent admin-merge.
- **Mechanisms:** GitHub admin/branch-protection bypass + the org audit log; a separate emergency-deploy pipeline that skips slow gates but keeps smoke tests, reversibility, and logging; and break-glass IAM (time-boxed STS `AssumeRole`, JIT, PIM) on the spectrum standing → JIT → break-glass.
- **Audit integrity is the differentiator:** the actor often *can* edit the logs, so the trail must be tamper-evident and **out-of-band** — separation of duty between acting and recording. Watch for **normalization of deviance** (Vaughan/*Challenger*): repeated bypass re-baselines normal and erodes the margin. Fight it with visibility, mandatory review, and — the real fix — fixing the gate. **Bypass rate per gate** is the early-warning signal.
- **Compliance & incident response:** auditors *accept* break-glass when it's controlled, justified, logged, and reviewed (the emergency-change process). Pre-plan the SEV1 fast-path in runbooks so responders execute rather than improvise, and recognize the **gate-that-blocks-the-fix** as the canonical justification.
- **Judgment (staff):** "fix the gate, not the human" — chronic break-glass is a gate defect; make the safe path the easy path; review blamelessly but mandatorily; and know when *refusing* to break glass is the senior move.

---

## Further Reading

- *Site Reliability Engineering* (Google) — the incident-management and "Managing Incidents" chapters: incident command, pre-planned response, and why improvising process mid-outage fails.
- Diane Vaughan, *The Challenger Launch Decision* — the origin of **normalization of deviance**; the canonical study of how repeated rule-breaking re-codes risk as normal.
- AWS guidance on **break-glass / emergency access** and **JIT** — temporary elevated access via STS `AssumeRole`, dedicated break-glass roles, and CloudTrail to a separate, locked logging account.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior grounds the mechanics this page assumes; senior goes deep on designing and operating break-glass at scale.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/interview.md) — the gate that break-glass overrides, and where admin-bypass settings live.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/interview.md) — the approval gate that an emergency fast-path must skip safely.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/interview.md) — "fix the gate, not the human": designing gates people don't need to bypass.
- [Release Engineering](../../release-engineering/) — emergency-deploy pipelines, rollback, and incident-time release controls.
- [Security](../../../../Security/) — IAM, JIT/PIM, least-privilege, and tamper-evident audit logging.
