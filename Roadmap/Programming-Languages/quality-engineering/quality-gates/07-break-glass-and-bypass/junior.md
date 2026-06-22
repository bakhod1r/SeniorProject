# Break-glass & Bypass — Junior Level

> **Roadmap:** [Quality Gates](../README.md) → Break-glass & Bypass
> *Every gate you cannot defend will eventually be removed at 3 a.m. If there is no safe way to bypass a check in a real emergency, someone will find an unsafe one — or delete the check entirely.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Every Gate Needs an Escape Hatch](#core-concept-1--why-every-gate-needs-an-escape-hatch)
5. [Core Concept 2 — What "Break-glass" Actually Means](#core-concept-2--what-break-glass-actually-means)
6. [Core Concept 3 — The Four Properties of a Good Bypass](#core-concept-3--the-four-properties-of-a-good-bypass)
7. [Core Concept 4 — The Audit Trail: Who, What, When, Why](#core-concept-4--the-audit-trail-who-what-when-why)
8. [Core Concept 5 — Frequent Bypass Means the Gate Is Wrong](#core-concept-5--frequent-bypass-means-the-gate-is-wrong)
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

> Focus: **How do you safely bypass a gate when an emergency demands it — without quietly destroying the gate?**

You have spent the rest of this section learning to *add* checks: required reviews, passing tests, deploy approvals, branch protection. Gates exist to stop bad changes. But here is the uncomfortable truth nobody tells a junior engineer on day one: **sometimes the right move is to skip the gate.**

Production is down. Customers cannot log in. The fix is a one-line change, and you are certain of it. But the full test suite takes forty minutes, and the change-approval process needs two sign-offs from people who are asleep. Do you (a) wait forty minutes and chase two sleeping approvers while the outage burns money and trust, or (b) push the fix now?

This is not a trick question. In a real outage, the answer is often (b) — *push the fix now*. The danger is **how** you do it. If your only option is for an admin to quietly click "merge anyway" with no record, you have a problem that is worse than the outage: you have a gate that can be silently switched off, by anyone with the button, with nobody the wiser. Do that a few times and the gate becomes theatre — present on paper, ignored in practice.

The professional answer is a **break-glass** mechanism: a *deliberate, pre-arranged, loudly-logged* way to bypass a gate in a genuine emergency. The name comes from the little glass-fronted boxes next to fire alarms and emergency exits — *"break glass in case of fire."* The glass is there on purpose. You *can* break it. But breaking it is obvious, it makes noise, it triggers a response, and afterwards someone asks why it was broken.

This page teaches you to think about bypasses the way a senior engineer does: not as cheating, and not as a failure of discipline, but as a **planned-for safety valve** — one that must be rare, visible, and always followed by a calm, blameless look at what happened.

> **Mindset shift:** A bypass you *planned for* is a safety valve. A bypass you *didn't* plan for is a 3 a.m. disaster waiting to happen. The goal is never "no one can ever skip the gate" — that gate gets deleted the first time it blocks an emergency. The goal is "skipping the gate is possible, deliberate, logged, and reviewed."

---

## Prerequisites

- **Required:** You know what a **quality gate** is — a check or approval that must pass before a change can merge or deploy (tests, code review, branch protection). If not, start with [Quality Gates](../README.md).
- **Required:** You have used a pull-request workflow on GitHub, GitLab, or similar, and you have seen a "merge is blocked" message.
- **Helpful:** You have lived through (or watched) a production incident, even a small one.
- **Helpful:** You have ever been tempted to skip a slow check "just this once." (Almost everyone has. This page is partly about why that instinct is dangerous when it goes unrecorded.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Gate** | A check or approval that must pass before a change can proceed (merge, deploy, release). |
| **Bypass** | Letting a change proceed *without* satisfying a gate. |
| **Break-glass** | A pre-arranged, controlled, *logged* way to bypass a gate in an emergency. The "good" kind of bypass. |
| **Admin override** | A privileged user forcing a change through despite a failing gate. Becomes dangerous when it is silent and casual. |
| **Audit trail** | A permanent record of who did what, when, and why — so an action can be reconstructed later. |
| **Incident** | An unplanned event that disrupts a service (an outage, a data issue). The usual reason a real break-glass happens. |
| **Hotfix** | An urgent fix shipped fast to resolve a live problem, often outside the normal release process. |
| **Blameless review** | Looking back at what happened to learn and improve, *without* punishing the person — so people tell the truth. |
| **Normalization of deviance** | When breaking the rule slowly becomes the normal way of working, and risk quietly creeps up until something fails. |
| **Postmortem** | A written, blameless analysis after an incident: what happened, why, what we change. |

---

## Core Concept 1 — Why Every Gate Needs an Escape Hatch

Start with the principle, because it shapes everything else:

> **A gate with no safe bypass is a gate that will be bypassed unsafely.**

Picture a gate you cannot get around. The full test suite *must* pass. Two approvals *must* be collected. No exceptions, no override, ever. It sounds responsible. It sounds safe. Now run the outage scenario: prod is down, the fix is obvious, and the gate will not move for forty minutes plus two sleeping approvers.

Under that pressure, one of three things happens — and **none of them is "the team calmly waits forty minutes."**

1. **Someone finds a hole.** They push directly to a release branch, or temporarily disable the check in settings, or use a service account that isn't bound by the rule. The fix ships through an *undocumented, unmonitored* path — exactly the thing the gate was supposed to prevent, now happening invisibly.
2. **Someone with admin removes the gate** — "just for now" — to ship the fix, and forgets to put it back. The gate is gone, and nobody notices until the next bad change sails through.
3. **The gate gets a reputation** as "the thing that blocks us during incidents," and over the following weeks it gets quietly weakened or deleted in a planning meeting, killing its protective value even during normal operation.

The hard-won lesson, repeated across the industry, is this: **the existence of a controlled bypass is what keeps the gate alive.** When people know there is a legitimate, sanctioned way to handle the genuine emergency, they stop inventing illegitimate ones, and they stop campaigning to tear the gate down. The escape hatch protects the gate.

This flips a junior intuition. It *feels* like the safest gate is the one nobody can ever skip. In reality, the safest gate is the one with a clearly marked, well-lit emergency exit — because the alternative is people climbing out the window.

> **Key insight:** You are not choosing between "gate" and "no gate." You are choosing between "gate plus a *designed* emergency exit" and "gate plus an *improvised* emergency exit." The first is observable and rare. The second is invisible and, over time, routine. Design the exit, or someone else will improvise a worse one.

---

## Core Concept 2 — What "Break-glass" Actually Means

**Break-glass** is the designed emergency exit. It is a mechanism you set up *in advance*, while calm, so that during a real emergency an authorized person can bypass a gate in a way that is deliberate and leaves a loud trail.

The clearest way to understand it is to put the **bad** version next to the **good** version, because they can look superficially similar — both end with "a change shipped without passing the gate."

**The BAD bypass — silent admin override:**

```text
14:02  An admin opens a blocked pull request.
14:02  Clicks "Merge without waiting for requirements to be met."
14:02  It merges. No comment. No alert. No record beyond a line
       buried in the merge log that nobody will ever read.
       Three weeks later, doing it has become a reflex.
```

Nobody chose this *as an emergency action*. There was no statement of why. No one was notified. There is no follow-up. And — the real poison — because it was so easy and silent, it stopped feeling like a special event. It became "how we ship when CI is being annoying."

**The GOOD bypass — break-glass:**

```text
14:02  Engineer declares break-glass, explicitly:
       "Breaking glass to deploy hotfix #4821. Prod login is down
        (INC-219). Skipping the 40-min e2e suite; smoke tests pass.
        Approver: on-call lead @dana."
14:02  The action is recorded automatically: who, what, when, why.
14:02  A loud alert fires in #incidents and pages the on-call lead.
14:02  A follow-up review ticket is created automatically.
14:05  Fix ships. Outage ends.
Next day  Blameless review: Was it justified? (Yes.) Does the gate
          need changing so this is faster/safer next time?
```

The difference is not the *outcome of that one merge*. Both shipped a change past the gate. The difference is everything *around* it: **intent, authorization, a record, an alert, and a promise of review.**

So a working definition, in plain terms:

> **Break-glass** = a pre-arranged emergency override that lets an *authorized* person bypass a gate when it is *truly necessary*, in a way that is *logged*, *deliberate*, and *reviewed afterward*.

Notice what break-glass is **not**:

- It is **not** a way to skip checks because you're in a hurry on a normal Tuesday.
- It is **not** a permanent permission someone holds and uses casually.
- It is **not** secret. The whole point is that it is loud.
- It is **not** a punishment trap. Using it correctly during a real emergency is *good engineering*, not a black mark.

A common concrete form: a **break-glass role**. Normally you cannot deploy straight to production, or you cannot touch the production database. In an emergency you must *explicitly assume* a special role — "production-breakglass" — to get that power. Assuming the role is itself the act of breaking the glass: it is recorded, time-limited, and it alerts people. You don't *have* the dangerous power by default; you *consciously pick it up* when the building is on fire, and everyone sees you pick it up.

> **Key insight:** The merge or the deploy is the same in both stories. What makes one safe and one corrosive is the *ceremony around it*: a deliberate declaration, an automatic record, a loud alert, and a guaranteed look-back. Strip away the ceremony and "break-glass" decays into "silent override" — which is how good gates quietly die.

---

## Core Concept 3 — The Four Properties of a Good Bypass

If you remember nothing else from this page, remember these four properties. A bypass mechanism is only "break-glass" — only the *safe* kind — if it has all four. Drop any one and you slide toward the silent-override failure.

**1. Pre-defined — decided in advance, while calm.**

You do not invent the emergency process *during* the emergency. Before anything breaks, you have already answered: *Who* is allowed to break glass? *Under what conditions* (what counts as a real emergency)? *Which gates* can be bypassed this way, and which can never be? Writing this down ahead of time means that at 3 a.m., under stress, people follow a known path instead of improvising.

**2. Deliberate — you must consciously choose it.**

Breaking glass should require an *explicit, distinct action* — typing a reason, assuming a special role, adding a specific label, running a clearly-named command. It must feel different from normal work. The reason for the friction is psychological: if skipping the gate is one careless click, people will click it carelessly. If it requires you to stop and *declare* "I am breaking glass, and here is why," you only do it when you mean it. **A little friction is a feature here, not a bug.**

**3. Logged — it leaves a permanent, automatic record.**

The moment glass breaks, the system records *who* did it, *what* they bypassed, *when*, and *why* — automatically, not relying on the person to remember to write it down later. This is the **audit trail** (next section). Without it, you cannot tell justified emergencies from casual shortcuts, you cannot learn, and you cannot satisfy compliance.

**4. Reviewed afterward — blamelessly.**

Every break-glass event gets a look-back. Two questions: *Was it justified?* and *What does this teach us?* Crucially, this review is **blameless** — its purpose is to learn, not to punish the person who pulled the handle during a fire. (If using the emergency exit gets you yelled at, people stop using the exit and start climbing out windows — back to silent, unlogged bypasses.) The review often produces an action: fix the flaky test that forced the bypass, speed up the slow suite, clarify the approval rule.

Here is the contrast as a table — the same axis, two outcomes:

| Property | Silent admin override (BAD) | Break-glass (GOOD) |
|---|---|---|
| **Pre-defined?** | No rules — anyone with the button, anytime | Documented: who, when, which gates |
| **Deliberate?** | One casual click, feels like normal work | Explicit declaration / special role / typed reason |
| **Logged?** | Buried or absent; relies on memory | Automatic record: who / what / when / why |
| **Reviewed?** | Never looked at again | Blameless review every time; produces fixes |
| **Frequency over time** | Creeps up until it's routine | Stays rare *because* it's visible and reviewed |

> **Key insight:** The four properties are a *system*, not a menu. Pre-defined without deliberate becomes an unused document. Deliberate without logged is just polite improvisation. Logged without reviewed is a pile of records nobody learns from. Reviewed without blameless turns into a witch-hunt that drives the next bypass underground. You need all four, working together, or the mechanism rots back into silent override.

---

## Core Concept 4 — The Audit Trail: Who, What, When, Why

The **audit trail** is the heart of property 3, and it deserves its own look because juniors often underestimate it. An audit trail is simply a *permanent, trustworthy record of who did what, when, and why.* For break-glass, it is the thing that turns "trust me, it was an emergency" into "here is exactly what happened."

A good break-glass log entry answers four questions at a glance. Here is one written out:

```text
=== BREAK-GLASS EVENT ===
who      : priya.k@company.com
what     : Bypassed "2 approvals required" gate on repo payments-api,
           PR #4821, to merge hotfix into main.
when     : 2026-06-22 14:02:11 UTC
why      : INC-219 — production login outage. One-line config fix.
           Full e2e suite (40 min) skipped; smoke tests passed.
           Authorized by on-call lead: dana.m@company.com
links    : incident INC-219, PR #4821, follow-up review REV-77
=========================
```

In a real system this is usually emitted as structured data so it can be searched, alerted on, and reported. A configuration sketch for an emergency-deploy flow might read:

```yaml
# emergency-deploy: the break-glass path, defined IN ADVANCE
emergency_deploy:
  who_can_invoke:            # pre-defined: not just anyone
    - role: on-call-engineer
    - role: incident-commander
  requires:                  # deliberate: you must supply these
    - incident_id            # ties the bypass to a real incident
    - reason                 # forces a written justification
    - second_person_ack      # a human says "yes, go"
  on_invoke:                 # logged + loud, automatically
    - record_audit_event     # who / what / when / why → permanent log
    - alert_channel: "#incidents"
    - page: on-call-lead
    - open_review_ticket: true   # reviewed: created before you even finish
  expires_after: 60m         # the power is time-boxed, not permanent
```

Why does this record matter so much? Three reasons, and a junior should be able to name all three:

- **Accountability.** When a change ships outside the normal process, *someone* should be answerable for it. Not to be blamed — to own the decision. The trail makes ownership clear and prevents "I thought someone else approved it."
- **Learning.** You cannot improve what you cannot see. If every break-glass is recorded, you can later ask: *Which gate gets bypassed most? Why? Can we fix the underlying problem?* The trail is the raw material for making the gates better (Concept 5).
- **Compliance.** Many organizations are legally or contractually required to prove that changes to important systems are controlled and reviewable — think payments, health data, anything audited. "We bypassed a control" is acceptable to an auditor *if* you can show *who, what, when, why,* and *that it was reviewed.* "We bypassed it and kept no record" is not. The audit trail is often the difference between "a justified emergency" and "a finding in an audit report."

> **Key insight:** The log is what separates a *defensible* emergency from a *suspicious* one. The exact same merge — same code, same time — is good engineering if it carries a clear "who/what/when/why" and a follow-up, and a red flag if it appears from nowhere with no explanation. Make the system write the record automatically, so a stressed human in the middle of an outage never has to remember to do it.

---

## Core Concept 5 — Frequent Bypass Means the Gate Is Wrong

Here is the rule that ties the whole topic together, and the one most likely to actually change how you work:

> **If you are breaking glass on the same gate every week, the *gate* is wrong. Fix the gate — do not normalize the bypass.**

Break-glass is for the genuine, rare emergency. It is a fire exit, not a second front door. The moment a bypass becomes *routine*, something has gone wrong — and the wrong thing to do is shrug and keep bypassing. The right thing is to treat the *frequency itself* as a signal pointing at a broken gate.

Suppose your team breaks glass to skip the integration-test gate three times this month. Each time, the reason was "the tests are flaky and keep failing on unrelated changes." That is not three emergencies. That is **one broken gate, surfacing three times.** The fix is not "get faster at breaking glass." The fix is to repair the flaky tests so the gate stops blocking good changes. Bypassing repeatedly just hides the real problem while teaching everyone that the gate is optional.

This is your first encounter with a dangerous and very human pattern called **normalization of deviance**: when breaking the rule slowly becomes the normal way of working, and the perception of risk quietly fades — until the day it bites. Each individual bypass seems fine ("it worked last time, nothing bad happened"). So the next one seems fine too. The bar for "this counts as an emergency" drifts lower and lower. Eventually "break-glass" is just "how we ship on busy days," the gate protects nothing, and one day a genuinely bad change goes out the door that the gate would have caught — and everyone is shocked, even though they had been steadily dismantling the safeguard for months.

The defense against normalization of deviance is exactly the four properties from Concept 3, plus *watching the frequency*:

- Because every bypass is **logged**, you can *count* them. A spike is visible.
- Because every bypass is **reviewed**, someone keeps asking "was this really an emergency?" — which holds the bar in place.
- Because reviews are **blameless**, people honestly report "actually, I broke glass because the gate is annoying, not because of a real incident" — which is the exact data you need to fix the gate.

So the audit trail is not just for accountability after one event; it is the *early-warning system* that tells you a gate has stopped earning its place. A healthy team treats a rising bypass count the way a doctor treats a rising fever: not as the disease, but as the symptom that sends you looking for the cause.

> **Key insight:** Rare break-glass is a sign of a *healthy* system — the safety valve exists and is used only when it should be. *Frequent* break-glass is a sign of a *sick* gate. The bypass count is one of the most honest health metrics you have: it tells you whether your gates are protecting real value or just generating friction that everyone has learned to route around.

---

## Real-World Examples

**1. The 3 a.m. hotfix during an outage.** Login is broken in production; revenue and trust are draining by the minute. The fix is a one-line change, and the engineer is confident in it. The normal path — a forty-minute end-to-end suite plus two daytime approvals — would extend the outage by an hour. The engineer invokes the emergency-deploy break-glass path: they supply the incident ID and a written reason, the on-call lead acknowledges, smoke tests run (fast, targeted), and the fix ships in minutes. The system automatically logs who/what/when/why, alerts `#incidents`, and opens a review ticket. The next morning the team confirms it was justified — and notes that the e2e suite being a hard blocker during incidents is worth rethinking. *That last note is the system improving itself.*

**2. The production "break-glass" access role.** Engineers normally have *no* standing access to the production database — read-only at most, write access to no one. During an incident requiring a manual data fix, the on-call engineer must explicitly *assume* a `prod-breakglass` role. Assuming it requires a reason, pages a second person, grants the access for sixty minutes only, and records every command run under that role. They didn't *have* the dangerous power and use it quietly; they *consciously picked it up*, in the open, for exactly as long as the fire lasted.

**3. The silent override that became a habit (a cautionary tale).** A team set "require one approval" on their main branch. There was no break-glass path — but there *was* an "admin merge" button that ignored the requirement, and a couple of seniors had it. The first few uses were genuine: a typo fix on a Friday evening, no reviewer around. No record, no alert. Within two months, admin-merge was the *normal* way the seniors shipped anything they considered "obvious." The review gate now protected only the juniors' code. Then an "obvious" admin-merged change took down checkout for an hour — a change a second pair of eyes would have caught instantly. The postmortem's root cause was not the bad change. It was **normalization of deviance**: a silent, unlogged bypass that quietly became routine because nothing made it visible or rare.

**4. The audit that went fine — and the one that didn't.** Two companies in a regulated industry each bypassed a change-control gate during an incident. Company A's bypass was a break-glass event: logged with who/what/when/why, tied to an incident ticket, reviewed afterward. When the auditor asked "show me your emergency changes," they handed over a clean record and a postmortem. Pass. Company B bypassed via an untracked admin action; when the auditor asked the same question, they had nothing to show but a vague memory. **Same emergency. Same kind of fix. One was defensible because of the audit trail; the other was a finding.**

---

## Mental Models

- **Break the glass, set off the alarm.** A real fire-alarm box is *designed* to be broken — but breaking it is loud, obvious, and brings the fire brigade. Good break-glass is identical: you *can* do it, it *works*, but it makes noise and triggers a response. If your bypass is *quiet*, it isn't break-glass — it's a hole in the wall.

- **The fire exit, not the second front door.** A fire exit is essential; a building without one is a death trap. But you do not commute through the fire exit every morning. If people are using the emergency exit as a normal door, either the front door is broken (fix the gate) or the rules have slipped (normalization of deviance). Either way, that's the signal to investigate.

- **The boiling frog of deviance.** Normalization of deviance is the frog that doesn't notice the water slowly heating. No single bypass feels dangerous; each is a tiny step. The danger is the *trend*, not any one event. Watching the bypass count is how you take the water's temperature before it boils.

- **The bypass counter is a thermometer, not a thermostat.** A rising number doesn't *cause* the problem and you don't fix things by forcing the number down (that just pushes bypasses underground). It *measures* the health of the gate. High reading → go find the sick gate and treat *that*.

- **Logged-and-loud beats forbidden-and-quiet.** A bypass that is impossible-on-paper but happens silently in practice is far more dangerous than one that is allowed but always announced. Visibility, not prohibition, is what actually keeps you safe.

---

## Common Mistakes

1. **Building a gate with no emergency exit at all.** It feels maximally safe; it is the opposite. The first real incident forces an *unsafe* bypass (a direct push, a disabled check, a deleted gate). Always design the exit before you ship the gate.

2. **Making the bypass a silent, casual click.** An "admin merge" with no reason, no log, no alert is an invitation to normalization of deviance. The bypass must be *deliberate* and *loud*, or it decays into routine.

3. **Relying on humans to log the bypass afterward.** During an outage, a stressed engineer will not remember to write a tidy record later. The system must capture who/what/when/why *automatically*, at the moment glass breaks.

4. **Treating break-glass as cheating — and punishing it.** If using the emergency exit gets you scolded, people stop using the sanctioned exit and start improvising hidden ones. Reviews must be *blameless*: correct use during a real emergency is good engineering.

5. **Ignoring the frequency.** Bypassing the same gate weekly and just... continuing. Frequent break-glass is a *broken gate*, not a personal failing. Count the bypasses; when the count climbs, fix the gate (the flaky test, the slow suite, the unclear rule).

6. **No follow-up review.** Logging the event but never looking back wastes the whole point. The review is where you decide "was it justified?" and "what do we fix?" — without it, the audit trail is just a graveyard of records.

7. **Confusing "rare and visible" with "hard to do."** Break-glass should be *easy enough to use in a real emergency* — you don't want the fire exit welded shut. The friction is in the *declaration* (a reason, an acknowledgement), not in making the mechanism slow or obscure.

---

## Test Yourself

1. In one sentence, explain why a gate with *no* bypass mechanism is often *less* safe than a gate *with* a controlled one.
2. Both a "silent admin override" and a "break-glass deploy" end with a change shipping past the gate. Name three things that make one safe and the other corrosive.
3. List the four properties a bypass must have to count as proper break-glass.
4. What four questions must a good break-glass audit-log entry answer?
5. Your team has broken glass to skip the integration-test gate four times this month, each time because the tests are flaky. What is the actual problem, and what is the *wrong* response?
6. What is "normalization of deviance," and which of the four properties most directly helps you detect it early?
7. Why must the post-incident review of a break-glass event be *blameless*?

<details>
<summary>Answers</summary>

1. Because if there is no *safe* way to bypass it, a real emergency will force an *unsafe* one — a hidden direct push, a quietly disabled check, or the gate being deleted entirely — which is worse than a designed, visible exit.
2. Any three of: **intent/deliberateness** (a conscious declaration vs a casual click), **authorization** (a defined who/when vs anyone with the button), **a logged audit trail** (automatic who/what/when/why vs no record), **a loud alert** (the team is notified vs silence), and **a guaranteed blameless review afterward** (vs never looked at again).
3. **Pre-defined** (who/when/which gates, decided in advance), **deliberate** (an explicit, distinct action to invoke it), **logged** (automatic permanent record of who/what/when/why), and **reviewed afterward** (a blameless look-back that asks "was it justified?" and "what do we fix?").
4. **Who** did it, **what** gate/change was bypassed, **when** it happened, and **why** (the justification — ideally tied to an incident ID).
5. The actual problem is a **broken (flaky) gate** surfacing four times, not four emergencies. The *wrong* response is to keep bypassing it (normalizing the deviance); the right response is to fix the flaky tests so the gate stops blocking good changes.
6. It is when breaking the rule slowly becomes the normal way of working and the sense of risk fades until something fails. **Logging** every bypass most directly enables early detection, because it lets you *count* bypasses and see the frequency climbing (and the **review** keeps holding the bar).
7. Because if using the sanctioned emergency exit gets people punished, they stop using it and start improvising *hidden, unlogged* bypasses instead — destroying the very visibility that keeps the system safe. Blameless reviews keep people honest and keep the exit in the open.

</details>

---

## Cheat Sheet

```text
THE ONE-LINE PRINCIPLE
  A gate you cannot defend will be removed at 3 a.m.
  No safe bypass  →  someone invents an unsafe one (or deletes the gate).

BREAK-GLASS = the DESIGNED emergency exit
  Authorized person bypasses a gate in a real emergency,
  in a way that is DELIBERATE + LOGGED + REVIEWED.

THE FOUR PROPERTIES (need ALL four)
  1. PRE-DEFINED   who / when / which gates — decided in advance
  2. DELIBERATE    explicit action (reason, role, label) — not a casual click
  3. LOGGED        automatic record: who / what / when / why
  4. REVIEWED      blameless look-back: justified? what do we fix?

AUDIT LOG MUST ANSWER
  WHO · WHAT · WHEN · WHY   (+ link the incident & the follow-up review)

WHY THE LOG MATTERS
  Accountability  →  someone owns the decision
  Learning        →  count bypasses, find the sick gate
  Compliance      →  prove emergency changes were controlled

GOOD vs BAD (same merge, different ceremony)
  BAD  : silent admin override, no reason, no alert, never reviewed → becomes routine
  GOOD : declared, logged, alerted, reviewed → stays rare

FREQUENCY IS A THERMOMETER
  Rare break-glass   = healthy system (valve used only when needed)
  Frequent on ONE gate = the GATE is wrong → FIX THE GATE, not the bypass
  Bypass becoming normal = NORMALIZATION OF DEVIANCE → danger creeping up

GOLDEN RULE
  A bypass is a planned-for safety valve — keep it RARE and VISIBLE.
```

---

## Summary

- Every gate needs a **safe escape hatch**. A gate with *no* bypass will be bypassed *unsafely* the first time a real emergency hits — through hidden paths or by deleting the gate. The escape hatch is what keeps the gate alive.
- **Break-glass** is the designed exit: a pre-arranged way for an *authorized* person to bypass a gate in a *genuine emergency*, done *deliberately*, *logged automatically*, and *reviewed afterward*. The name is literal — like a fire-alarm box, you *can* break it, but doing so is loud and triggers a response.
- A bypass is only proper break-glass if it has **all four properties**: **pre-defined** (who/when/which gates), **deliberate** (an explicit, distinct action), **logged** (automatic who/what/when/why), and **reviewed** (a *blameless* look-back). Drop one and it decays into a silent admin override.
- The **audit trail** — who, what, when, why — is the heart of it. It gives you **accountability**, **learning**, and **compliance**, and it is what separates a *defensible* emergency from a *suspicious* one. Make the system write it automatically so a stressed human never has to.
- **Frequent bypass means the gate is wrong.** Break-glass is for rare emergencies; if you're breaking the same glass every week, fix the *gate*, don't normalize the *bypass*. Watch for **normalization of deviance** — when skipping the rule quietly becomes routine and risk creeps up until something breaks. The bypass count is your thermometer.

A bypass is not cheating. It is a planned-for safety valve. Keep it **rare** and keep it **visible** — that is the whole job.

---

## Further Reading

- *Site Reliability Engineering* (Google) — the chapters on **Managing Incidents** and **Postmortem Culture: Learning from Failure**. The clearest free treatment of incident response and *blameless* review, the culture break-glass depends on. Available online at [sre.google/books](https://sre.google/books/).
- **Diane Vaughan, *The Challenger Launch Decision*** — the origin of **"normalization of deviance."** You don't need the whole book; search the term and read a summary of how small, accepted deviations compounded into catastrophe. The single most important idea on this page.
- [GitHub Docs — "About protected branches"](https://docs.github.com/en/repositories/configuring-branches-and-merge-conflicts/managing-protected-branches/about-protected-branches) — see *"Allow specified actors to bypass required pull requests"* and how admin/bypass actions appear in the audit log. The concrete tooling behind the abstract idea.
- *The Phoenix Project* (Gene Kim et al.) — a novel about IT operations; vividly shows how unplanned, untracked emergency changes spiral, and why visibility matters.
- The [middle.md](middle.md) of this topic, which formalizes break-glass into roles and policies, time-boxed elevated access, automated audit pipelines, and the metrics you track to keep bypasses rare.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/junior.md) — the gate that break-glass most often has to bypass; where the "allow bypass" settings live.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/junior.md) — the approval gates an emergency hotfix skips, and the sign-off trail break-glass replaces.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/junior.md) — *why* a gate gets bypassed (too slow during incidents) and how to design it so break-glass stays rare.
- [Release Engineering](../../release-engineering/) — hotfixes, emergency releases, and how break-glass fits the release process.
- [Security](../../../../Security/) — break-glass access roles, least privilege, and audit trails as security controls.
