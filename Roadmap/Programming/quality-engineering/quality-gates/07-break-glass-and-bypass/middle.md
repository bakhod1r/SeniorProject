# Break-glass & Bypass — Middle Level

> **Roadmap:** [Quality Gates](../README.md) → Break-glass & Bypass
> *The junior page argued that every gate needs a defensible escape hatch. This page formalizes it: the six design properties that make a break-glass safe, the mechanisms that implement them across GitHub/CI/IAM, and the insight that turns bypass from a confession into a measurement — because how often a gate gets broken is the most honest review that gate will ever get.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Six Design Properties of Safe Break-glass](#core-concept-1--the-six-design-properties-of-safe-break-glass)
5. [Core Concept 2 — The Audit Record, Concretely](#core-concept-2--the-audit-record-concretely)
6. [Core Concept 3 — The Mechanisms Across the Stack](#core-concept-3--the-mechanisms-across-the-stack)
7. [Core Concept 4 — Bypass as a Health Signal](#core-concept-4--bypass-as-a-health-signal)
8. [Core Concept 5 — Normalization of Deviance](#core-concept-5--normalization-of-deviance)
9. [Core Concept 6 — Compliance and Incident Response](#core-concept-6--compliance-and-incident-response)
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

> Focus: **How do I build a break-glass path that auditors accept, that can't be triggered by accident, and that tells me which gates are broken?**

At the junior level the argument was directional: a gate with no sanctioned override breeds worse, unsanctioned ones — deleted checks, shared admin passwords, a culture that learns to route around safety. The fix is to *design* the override. This page makes that design concrete.

Three things separate a real break-glass from a hole in the fence. First, it has **properties you can point at** — pre-authorized, deliberate, scoped, logged, alerting, reviewed — and each maps to a setting or a code path you can implement. Second, it leaves an **immutable record** that answers *who, what, when, why, and what-was-bypassed*, because an override no one can reconstruct is, to an auditor, indistinguishable from a breach. Third — the insight that elevates this from plumbing to engineering — **every break-glass event is a data point about the gate it bypassed.** A gate that gets broken once a quarter is doing its job; a gate that gets broken twice a week is mis-designed, and the bypass count is telling you so before any retrospective will. Read this page as the difference between *having* an escape hatch and *engineering* one.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain why a gate with no override is a liability.
- **Required:** You understand branch protection and required checks ([01 — Required CI Checks](../01-required-ci-checks/middle.md), [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md)).
- **Helpful:** Basic familiarity with cloud IAM roles (AWS/GCP) and the idea of assuming a role.
- **Helpful:** You've been on call during at least one incident where a process slowed the fix.

---

## Glossary

| Term | Meaning |
|---|---|
| **Break-glass** | A pre-authorized, high-friction path to bypass a control in an emergency, named for the "break glass to pull the fire alarm" box. |
| **Bypass** | The general act of advancing a change without satisfying a gate. Break-glass is *controlled* bypass; the unsanctioned kind is just risk. |
| **Just-in-time (JIT) access** | Privilege granted only for the moment it's needed, with approval, then auto-revoked — as opposed to standing access. |
| **Time-boxed** | Automatically expires after a fixed window (e.g., STS credentials valid for 1 hour), so the elevated state can't outlive the emergency. |
| **Least privilege** | Granting the minimum permission needed for the task — here, breaking *only the gate in the way*, not "admin everything." |
| **Audit log** | An append-only, tamper-evident record of security-relevant events. CloudTrail and the GitHub audit log are the canonical examples. |
| **Separation of duties (SoD)** | The person invoking an override should not also be its sole approver. A SOC 2 / SOX expectation. |
| **Normalization of deviance** | Diane Vaughan's term: when a deviation from the standard is repeated without consequence, it quietly becomes the new accepted normal. |

---

## Core Concept 1 — The Six Design Properties of Safe Break-glass

A break-glass mechanism is *correct* when it has all six of these properties. Drop any one and you've built a different, more dangerous thing — usually either an accident waiting to happen or a blind spot.

**1. Pre-authorized.** Who may break the glass, under what conditions, and over what scope are decided *in advance* and written down — not improvised mid-incident. Improvised overrides are unauditable by construction: there's no policy to check the action against. *Implement it* as an explicit allowlist of actors (a GitHub team, an IAM principal, an on-call group) plus a documented trigger condition ("Sev-1 or Sev-2 only").

**2. Deliberate / high-friction on purpose.** Invoking it must be an explicit, conscious act — a named flag, an assumed role, a required reason field — so it can never happen by accident or by default. The friction is a *feature*: it forces a human to acknowledge "I am bypassing a safety control right now." *Implement it* as a non-default path: `--break-glass` plus a mandatory `--reason`, a separate role you must `assume`, a checkbox that defaults to off.

**3. Least-privilege / scoped + time-boxed.** Break the *minimum* gate needed, for the *minimum* time. An emergency deploy should skip the slow integration suite — not also disable the secret scanner. Elevated access should expire on its own. *Implement it* as a role scoped to exactly the bypassed action and STS/JIT credentials with a short TTL (e.g., 60 minutes) so the privilege auto-revokes whether or not anyone remembers to.

**4. Logged.** Every invocation writes an immutable record: who, what, when, why, and what-was-bypassed. The log is the difference between a controlled override and an invisible one. *Implement it* against an append-only sink — CloudTrail, the GitHub audit log, a write-only audit table — never a file the actor can edit. (Schema in Core Concept 2.)

**5. Alerting.** It pages or notifies *loudly*. Visibility is the entire point: a break-glass that happens quietly defeats itself. The right people should know within seconds, not discover it in a quarterly review. *Implement it* as a high-priority notification to the security/on-call channel on every event, with the reason and actor inline.

**6. Reviewed after.** A **blameless** follow-up asks two questions: *was this use justified?* and *does the gate need fixing so the next person doesn't have to break it?* The review closes the loop from Concept 4. *Implement it* as a required item in the incident retro, or an auto-filed ticket on every break-glass event that can't be closed without sign-off.

> **Key insight:** These six are not a wishlist — they're a checklist with an AND between every item. A break-glass that is logged but not scoped grants too much; one that is scoped but not alerting hides the risk; one that is everything-but-reviewed silently normalizes itself. Audit your own mechanism against all six, and treat any missing property as a defect, not a nice-to-have.

---

## Core Concept 2 — The Audit Record, Concretely

"Logged" is meaningless without knowing *what* to log. A defensible break-glass record answers five questions, and an auditor will ask for every one of them. Here is a schema that holds up:

```yaml
# break-glass audit record (one per invocation)
event_id:        bg-2026-0042                  # stable, unique, referenceable
timestamp:       2026-06-22T03:14:07Z          # UTC, from the system, not the user
actor:           alice@corp.example            # WHO — a real identity, never a shared account
actor_role:      oncall-primary                # the capacity they acted in
action:          merge_bypass                  # WHAT — the specific control overridden
target:          repo=payments-api  pr=4821    # WHAT, scoped
gate_bypassed:   required-check:integration    # WHICH gate, by name (feeds Concept 4)
reason:          "Sev-1 INC-1190: checkout 500s; fix verified in staging; e2e suite stuck on flaky DB fixture"
incident_ref:    INC-1190                       # WHY, linked to the incident system
approver:        bob@corp.example              # SoD — distinct from actor where required
expires_at:      2026-06-22T04:14:07Z          # time-box for any elevated access granted
source_ip:       10.4.2.19
review_status:   pending                        # closes via Concept 6
```

Three properties make this record trustworthy rather than theatrical:

- **The identity is real.** `actor` is a named human or a uniquely-attributable service identity — *never* a shared `admin` account, because a shared account makes the most important field ("who?") unanswerable.
- **The reason is structured and linked.** A free-text `reason` plus a machine-readable `incident_ref` lets you both read the story and join break-glass events to incidents programmatically.
- **The sink is append-only.** If the actor can delete or edit their own record, the log proves nothing. Ship it to a store with object-lock / write-once semantics (e.g., an S3 bucket with versioning + object-lock, or the platform's native audit log), and alert on any gap in the `event_id` sequence.

> **Key insight:** The audit record is written *for the version of you that is being asked, six months later and under pressure, "why was the integration suite skipped on this deploy?"* If the record answers that without anyone needing to remember the night, it's complete. If it doesn't, no amount of "we have logging" will satisfy the question.

---

## Core Concept 3 — The Mechanisms Across the Stack

The same six properties show up at every layer; only the knobs differ. Here are the four you'll actually configure.

### GitHub branch-protection bypass

Branch protection rules can be bypassed by *specific* actors, and the configuration is itself a policy decision. The key controls:

- **`Allow specified actors to bypass required pull requests`** — an explicit allowlist (a team, an app), satisfying *pre-authorized* and *scoped*. Keep it tiny.
- **`Do not allow bypassing the above settings`** — when set, even repository admins are bound by the rules. Leaving this *off* is the silent default that lets any admin route around every gate with no friction. Turn it on, and force overrides through the deliberate path you actually designed.
- The **organization audit log** records every protected-branch override and setting change, giving you *logged* for free — provided you stream it somewhere durable and alert on it.

> **Key insight:** "Include administrators" / "Do not allow bypassing" is the single highest-leverage toggle in branch protection. With it off, you don't have a break-glass — you have a building with no walls that happens to have a fire-alarm box on it. Admins can simply walk through.

### Emergency-deploy pipeline

The right shape is **a separate, explicit pipeline that skips the slow / non-safety gates but keeps the safety-critical ones, and tags + logs the deploy.**

```yaml
# emergency-deploy (invoked deliberately, never the default path)
on:
  workflow_dispatch:
    inputs:
      reason:        { required: true }          # deliberate: no reason, no run
      incident_ref:  { required: true }
jobs:
  emergency-deploy:
    if: contains(github.event.inputs.reason, 'INC-')   # cheap guard
    steps:
      - run: ./scripts/audit-breakglass.sh \           # LOG before acting
          --actor "${{ github.actor }}" \
          --reason "${{ github.event.inputs.reason }}" \
          --incident "${{ github.event.inputs.incident_ref }}" \
          --gate-bypassed "integration-suite,perf-regression"
      - run: ./scripts/notify-security.sh "BREAK-GLASS deploy by ${{ github.actor }}: ${{ github.event.inputs.reason }}"
      # SKIPPED on purpose: slow integration suite, perf-regression gate
      # KEPT on purpose:    secret-scan, image-signing, SBOM  (never skip safety)
      - run: ./deploy.sh --tag "breakglass" --incident "${{ github.event.inputs.incident_ref }}"
```

Two design choices carry the weight: it is a *distinct* workflow you must consciously invoke (deliberate), and it **draws a hard line between "slow" gates it may skip and "safety" gates it must keep** (scoped). The deployed artifact is tagged `breakglass` so it's findable later and so a follow-up can verify the skipped gates retroactively.

### Break-glass IAM (time-boxed, JIT)

In the cloud, break-glass means a *privileged role you must explicitly assume*, granting short-lived credentials, with the assumption recorded in CloudTrail.

```bash
# Assume the break-glass role — explicit, scoped, and time-boxed to 1 hour.
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/break-glass-prod-dba \
  --role-session-name "INC-1190-alice" \   # session name carries identity + incident
  --duration-seconds 3600                   # TIME-BOX: credentials auto-expire in 60 min

# The role's trust policy enforces who/how (pre-authorized + deliberate):
#   - Principal: only the on-call group
#   - Condition: MFA present (aws:MultiFactorAuthPresent = true)
#   - Optionally: only assumable after an approval (JIT) workflow grants it
# CloudTrail records the AssumeRole event automatically (logged):
#   eventName=AssumeRole, who, when, sourceIPAddress, the session name above.
```

The role is scoped to exactly the emergency capability (here, a specific DB action), not blanket admin. The 1-hour TTL means the elevated state *cannot* outlive the incident — the privilege revokes itself. Mature setups add **JIT approval**: the role isn't assumable at all until a second person approves the request (separation of duties), often gated through PagerDuty/Opsgenie so only the *actually paged* on-call engineer can elevate. Database and direct prod-access break-glass follow the identical pattern: standing access is denied; emergency access is assumable, approved, short-lived, and logged.

---

## Core Concept 4 — Bypass as a Health Signal

This is the insight that distinguishes a middle-level engineer from a junior one on this topic.

**Track bypass frequency per gate.** Because every break-glass record names the `gate_bypassed`, you can aggregate them — and the aggregate is *gate telemetry* ([05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/middle.md)). The reading is direct:

| Pattern | What it means | Correct response |
|---|---|---|
| Rare break-glass, varied gates | The system is healthy; overrides are genuine emergencies. | Nothing. This is working. |
| **Frequent break-glass on the *same* gate** | That gate is mis-designed — too slow, too flaky, or testing the wrong thing. | **Fix the gate.** Do not normalize the bypass. |
| Rising bypass trend overall | Gates are drifting out of step with how the team works. | Review the gate set; some are theatre. |

The trap is to read a frequently-bypassed gate as *people being reckless* and respond by adding friction to the bypass. That's backwards. If a gate is broken twice a week, the gate is the problem: a 40-minute flaky integration suite that everyone skips during incidents isn't catching defects — it's manufacturing break-glass events. Fix the suite (make it fast, make it deterministic, or split safety-critical assertions into a fast gate and move the rest to advisory), and the bypasses stop because there's nothing left to route around.

> **Key insight:** Bypass frequency per gate is the most honest review a gate will ever receive. A retrospective asks people what they *think* of a gate; the bypass counter records what they *do* when it's 3 a.m. and the gate is in the way. When a single gate dominates your break-glass log, the log is not a record of bad behavior — it's a bug report against that gate. Treat it as one.

---

## Core Concept 5 — Normalization of Deviance

Diane Vaughan coined **normalization of deviance** in her study of the *Challenger* disaster: NASA repeatedly flew with O-ring erosion that exceeded the original safety spec. Each flight that didn't explode made the deviation feel a little more acceptable, until the out-of-spec condition *became* the spec in everyone's working mental model. The deviation was normalized — and the accumulated risk stayed invisible right up until it wasn't.

Break-glass is exactly the mechanism through which this happens in software:

1. A gate blocks something during an incident; someone breaks the glass. Justified.
2. The gate blocks something the next week; breaking it worked last time, so it's broken again. Slightly less justified.
3. Within a month, "just break-glass it" is the *normal* way past that gate. The override has stopped being an emergency action and become a routine workaround.
4. The risk the gate existed to catch is now silently un-caught on every bypassed change — and nobody decided that on purpose. It accumulated.

The deviation didn't announce itself. Each step was locally reasonable; the *sequence* is the failure. This is why Concept 6's after-action review is non-negotiable, and why Concept 4's telemetry matters: they are the two countermeasures that keep the deviation visible.

- **Visibility** (Concept 1.5 + 4): loud alerts and per-gate counts mean a rising bypass trend *shows up* instead of fading into routine.
- **Review** (Concept 6): a blameless follow-up on every break-glass forces the recurring question "should we have to do this?" — which is precisely the question normalization erases.
- **Fixing the root-cause gate** (Concept 4): removing the *reason* to bypass is the only durable cure. You cannot discipline your way out of normalization; you have to remove the friction that drives it.

> **Key insight:** Normalization of deviance is not a people problem you fix with policy reminders — it's a *systems* problem you fix by keeping the deviation visible and removing its cause. Every routine break-glass is a small O-ring erosion: individually survivable, collectively a countdown. The job is to notice the trend before the flight that doesn't come back.

---

## Core Concept 6 — Compliance and Incident Response

**Compliance: auditors accept break-glass — they reject the *undocumented* bypass.** This surprises engineers who assume any override is a finding. It isn't. SOC 2 and SOX both explicitly anticipate **emergency-change procedures**; what they require is that the emergency path be *controlled, logged, and reviewed* — the same six properties from Concept 1. A break-glass mechanism that is pre-authorized, recorded with who/what/when/why, separated by duty where required, and reviewed after the fact is precisely what an auditor wants to see as evidence of a mature change-management control. What gets you a finding is the *absence* of such a path — because then the inevitable real overrides happen as shared-credential, no-log, no-review events that you can neither produce nor explain.

| Framework | What it expects of break-glass |
|---|---|
| **SOC 2** (CC change-management & logical-access) | Emergency changes follow a *defined* procedure; access is least-privilege; events are logged and reviewed. |
| **SOX** (ITGC) | Emergency-access use is authorized, recorded, and reviewed; separation of duties between requester and approver. |

So building this well doesn't *fight* compliance — it *is* the compliance control. The audit record from Concept 2 is the artifact you hand the auditor.

**Incident response: pre-plan the emergency path so you don't invent it at 3 a.m.** During an outage, a gate that blocks the *fix* is no longer protecting you — it's a liability extending the outage. The failure mode is discovering this *during* the incident and improvising an override under pressure, with no log and no scope. The cure is to design the break-glass *before* you need it and put it in the **runbook**: the named flag, the role to assume, the reason format, who can approve. When the path is pre-planned, the on-call engineer executes a known, logged procedure instead of inventing an unlogged one while the revenue counter bleeds. This is the direct tie-in to incident response and runbooks — the emergency deploy/access path is a standard runbook entry, not tribal knowledge.

> **Key insight:** A gate that blocks the fix during an incident is a self-inflicted SLA wound. The choice is not "gate vs no gate" — it's "a *designed* break-glass you execute calmly" versus "an *improvised* bypass you'll have to explain later." Pre-plan it, put it in the runbook, and the 3 a.m. version of you executes a procedure instead of making a decision.

---

## Real-World Examples

**1. The flaky gate that became a routine bypass.** A payments team's required integration suite flaked ~15% of the time and took 35 minutes. During the third incident in a month, the on-call engineer used the admin-merge override to ship the fix — reasonable. By the next quarter, "admin-merge past the integration check" was the team's normal way to ship anything urgent; the per-gate bypass counter showed that one gate accounted for 80% of all break-glass events. The retro (Concept 6) caught it, read the telemetry correctly (Concept 4), and the fix was *to the gate*, not the people: the suite was split into a 4-minute deterministic safety subset (kept required) and a slower advisory job. Break-glass on that gate dropped to near zero — the normalization (Concept 5) had been caught before it caused a bad ship.

**2. Break-glass IAM that satisfied the auditor.** A fintech had no emergency DBA path, so during incidents engineers shared a long-lived admin credential — the exact thing SOX flags. They replaced it with a `break-glass-prod-dba` role: assumable only by the paged on-call, only with MFA, only after a second engineer approved via Opsgenie (SoD), issuing 1-hour STS credentials, every assumption in CloudTrail. At the next audit this *cleared* the prior finding: the auditor's concern was never that emergencies happen — it was that the previous mechanism was unattributable and unreviewed. The controlled version *was* the control.

**3. The gate with no escape hatch.** A team set branch protection with "do not allow bypassing" on and *no* designated bypass actors — feeling maximally safe. During a Sev-1 they could not merge the fix at all; under pressure, an admin temporarily *disabled the branch protection rule entirely*, shipped, and forgot to re-enable it for two days. The lesson is the junior page's thesis in production: a gate with no sanctioned override doesn't prevent bypass — it converts a small scoped bypass into a large unscoped one. The fix was a narrow break-glass actor list plus the emergency pipeline, so the next emergency skipped *one* gate, logged, instead of removing *all* of them, silently.

---

## Mental Models

- **Break-glass is a fire-alarm box, not an unlocked back door.** The glass is there to be broken in a real emergency — but breaking it is loud, leaves shards (a record), and someone always comes to ask why. A back door is silent, leaves nothing, and no one knows it was used. Build the alarm box; never build the back door.

- **The bypass log is a bug tracker for your gates.** A break-glass event isn't (only) a record of a human decision — it's a defect report filed *against the gate* that got in the way. One gate dominating the log is a high-priority ticket against that gate, not a disciplinary matter.

- **O-ring erosion is measured per flight, risk is realized all at once.** Every routine bypass is a small, survivable erosion of a safety margin. The danger isn't any single one — it's the slope. Watch the trend, not the instance.

- **Time-boxing is a dead man's switch for privilege.** Standing access assumes someone will remember to remove it; they won't. Short-TTL credentials revoke themselves whether or not anyone is paying attention — the safe default is the one that requires no follow-up action to stay safe.

- **Least-privilege applies to bypass too.** "Break the glass" should break *one specific pane* — the gate in the way — not the whole window. An emergency deploy skips the slow suite; it does not also turn off the secret scanner.

---

## Common Mistakes

1. **No bypass path at all.** The most common and most dangerous. People don't comply harder — they invent worse overrides (disable the whole rule, share an admin password) or quietly delete the gate. Absence of a sanctioned path *guarantees* unsanctioned ones.

2. **Bypass with no logging.** An override no one can reconstruct is invisible risk and an automatic audit finding. If you can't answer who/what/when/why/what-was-bypassed afterward, you don't have break-glass — you have a leak.

3. **Shared admin credentials as the "emergency" mechanism.** The single worst pattern: it makes the most important audit field — *who* — permanently unanswerable, and it's standing, unscoped, and untimed. Replace with named identities assuming a scoped, time-boxed role.

4. **Bypass-by-default.** If the override path is the easy path — the toggle that's on, the admin who's always exempt ("do not allow bypassing" left off) — it stops being deliberate and becomes the route everyone takes. The friction is the feature; don't sand it off.

5. **Skipping safety gates, not just slow ones.** An emergency deploy that skips the 35-minute integration suite is scoped; one that *also* skips the secret scanner and image signing is reckless. Draw the slow-vs-safety line explicitly and never cross it under pressure.

6. **Treating frequent bypass as a discipline problem.** Adding friction to a heavily-used break-glass attacks the symptom. Frequent bypass of one gate means *the gate* is wrong — fix the gate (Concept 4), don't punish the people routing around it.

7. **No after-action review.** Without the blameless follow-up, every justified bypass is one step toward normalization (Concept 5). The review is the countermeasure; skipping it is how routine deviance accumulates unnoticed.

---

## Test Yourself

1. Name the six design properties of a safe break-glass. Which single one, if missing, makes the event *unattributable*?
2. Why is the `actor` field required to be a named identity and never a shared `admin` account?
3. A gate accounts for 70% of your break-glass events over a quarter. What does this tell you, and what is the *correct* response?
4. Explain normalization of deviance using a recurring break-glass on the same gate. What two countermeasures keep it from happening?
5. An auditor sees that your team used break-glass eleven times last quarter. Is this automatically a finding? What would they actually check?
6. Why is "do not allow bypassing" (include administrators) the highest-leverage branch-protection toggle for break-glass design?
7. During a Sev-1, the only required check is flaky and blocking the fix. Walk through the *designed* response versus the *improvised* one.

<details>
<summary>Answers</summary>

1. Pre-authorized, deliberate, scoped/time-boxed, logged, alerting, reviewed-after. Missing **logged** makes the event unattributable — you can't reconstruct who/what/when/why, so it's indistinguishable from a breach.
2. Because *who?* is the most important audit question, and a shared account makes it permanently unanswerable. Named identities preserve attribution; SOX/SOC 2 require it.
3. That gate is mis-designed (too slow, flaky, or wrong) — the bypass counter is a bug report against it. The correct response is to **fix the gate** (speed it up, de-flake it, or split safety-critical assertions into a fast required gate), *not* to add friction to the bypass or discipline the people using it.
4. Each bypass of the gate that doesn't cause harm makes the next one feel more acceptable, until "break-glass it" is the routine way past that gate and the risk it guards is silently un-caught on every bypassed change. Countermeasures: **visibility** (loud alerts + per-gate telemetry so the trend shows up) and **review** (blameless after-action that re-asks "should we have to do this?"), plus the durable cure of **fixing the root-cause gate**.
5. No — not automatically. Auditors *expect* emergency-change procedures. They'd check that each use was pre-authorized, logged with who/what/when/why, separated by duty where required, and reviewed. A controlled, logged, reviewed break-glass *is* the control; the finding is when overrides are undocumented.
6. With it off, repository admins can bypass *every* gate with no friction and no special path — so you don't actually have a designed break-glass, you have a universal exemption. Turning it on binds admins to the rules and forces overrides through the deliberate, logged path you designed.
7. *Designed:* the on-call follows the runbook — invokes the emergency-deploy pipeline (or break-glass merge actor) with a required reason and incident ref, which logs the event, alerts security, skips only the slow gate while keeping safety gates, and tags the deploy. A follow-up review verifies it later. *Improvised:* under pressure, someone disables the whole branch-protection rule or shares an admin credential, ships with no log or scope, and the team discovers the disabled rule (or the un-caught risk) days later. Pre-planning converts a decision into a procedure.

</details>

---

## Cheat Sheet

```
THE SIX PROPERTIES (all required — AND, not OR)
  pre-authorized   who/when/scope decided in advance, written down
  deliberate       explicit flag / assumed role / reason field; never default
  scoped+timed     minimum gate, minimum time; STS/JIT auto-expires
  logged           immutable record: who/what/when/why/what-was-bypassed
  alerting         pages loudly — visibility is the point
  reviewed-after   blameless: was it justified? does the gate need fixing?

AUDIT RECORD MUST ANSWER
  who (named identity, never shared admin) · what (action + target)
  when (system UTC) · why (reason + incident_ref) · what-gate-bypassed
  → append-only sink (CloudTrail / GH audit log / object-lock), alert on gaps

MECHANISMS
  GitHub      allowlist bypass actors · "do not allow bypassing" ON · audit log
  CI/deploy   separate emergency pipeline · skip SLOW gates, KEEP safety gates · tag+log
  IAM         assume scoped role · MFA · JIT approval (SoD) · short STS TTL · CloudTrail
  prod/DB     deny standing access · assumable, approved, time-boxed, logged

BYPASS AS SIGNAL
  rare + varied        → healthy, do nothing
  frequent, ONE gate   → gate is broken → FIX THE GATE (not the bypass)
  rising trend         → gate set drifting → prune theatre

NORMALIZATION OF DEVIANCE (Vaughan / Challenger)
  routine bypass = O-ring erosion: survivable each time, fatal as a trend
  cure: visibility + review + remove the root-cause gate

COMPLIANCE: auditors ACCEPT controlled+logged+reviewed break-glass;
            they REJECT undocumented bypass. The control IS the break-glass.

ANTI-PATTERNS: no path · no log · shared admin · bypass-by-default
               · skipping safety gates · "discipline" instead of fixing the gate
```

---

## Summary

- A safe break-glass has **six properties at once** — pre-authorized, deliberate, scoped/time-boxed, logged, alerting, reviewed-after — and each maps to a concrete setting or code path. Missing any one turns it into either an accident or a blind spot.
- The **audit record** must answer who/what/when/why/what-was-bypassed, against a named identity and an append-only sink. It's the artifact that makes the override defensible — and the one you hand an auditor.
- The same properties recur across the stack: **GitHub** bypass allowlists plus "do not allow bypassing," a separate **emergency-deploy pipeline** that skips slow gates but keeps safety gates, and **break-glass IAM** — a scoped role you explicitly assume, MFA + JIT approval, short-TTL STS, CloudTrail.
- **Bypass is a health signal.** Per-gate bypass frequency is gate telemetry: frequent break-glass on one gate means *the gate* is mis-designed — fix the gate, never normalize the bypass.
- **Normalization of deviance** (Vaughan) is the failure mode where routine bypass quietly becomes the new normal and risk accumulates invisibly. Visibility, after-action review, and fixing the root-cause gate are the countermeasures.
- **Compliance accepts controlled break-glass and rejects undocumented bypass** — done right, the mechanism *is* the SOC 2 / SOX emergency-change control. And in incidents, a pre-planned, runbooked emergency path means you execute a procedure at 3 a.m. instead of inventing an unlogged one.

---

## Further Reading

- *Site Reliability Engineering* (Google) & *The Site Reliability Workbook* — incident response and managing emergency access; the operational frame for runbooked break-glass paths.
- *The Challenger Launch Decision* — Diane Vaughan. The origin and definitive treatment of normalization of deviance; read it as a manual for why routine bypass is dangerous.
- *AWS Well-Architected — Security Pillar* & AWS break-glass / just-in-time access guidance — scoped roles, short-lived STS credentials, MFA-conditioned trust policies, CloudTrail attribution.
- GitHub Docs — branch protection bypass actors, "do not allow bypassing," and the organization audit log.
- [senior.md](senior.md) — break-glass as an org-wide control plane: policy-as-code-enforced override paths, bypass telemetry as an SLO, and designing emergency access for multi-team, regulated environments.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/middle.md) — the gates break-glass overrides; where bypass actors and "do not allow bypassing" live.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/middle.md) — approvals and separation of duties, the same controls a JIT break-glass reuses.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/middle.md) — gate telemetry and the speed/safety line that decides which gates an emergency may skip.
- [Release Engineering](../../release-engineering/) — emergency deploys, freezes, and rollback as the release-time context for break-glass.
- [Security](../../../../Security/) — IAM, least privilege, and audit logging, the security foundations under break-glass IAM.
