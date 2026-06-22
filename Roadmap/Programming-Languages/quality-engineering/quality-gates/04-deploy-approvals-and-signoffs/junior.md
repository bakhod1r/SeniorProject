# Deploy Approvals & Sign-offs — Junior Level

> **Roadmap:** [Quality Gates](../README.md) → Deploy Approvals & Sign-offs
> *The earlier gates decide whether code gets into `main`. This one decides whether a build gets into production — and it's the gate where a human, on purpose, gets the last word before real users are touched.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Deploy Approval Is a Pause](#core-concept-1--a-deploy-approval-is-a-pause)
5. [Core Concept 2 — Environments Are a Promotion Path](#core-concept-2--environments-are-a-promotion-path)
6. [Core Concept 3 — A Sign-off Is a Recorded "Yes"](#core-concept-3--a-sign-off-is-a-recorded-yes)
7. [Core Concept 4 — Separation of Duties](#core-concept-4--separation-of-duties)
8. [Core Concept 5 — Manual vs Automated: Judgement vs Theatre](#core-concept-5--manual-vs-automated-judgement-vs-theatre)
9. [Core Concept 6 — Freezes, Break-glass, and the CAB](#core-concept-6--freezes-break-glass-and-the-cab)
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

> Focus: **What stops a green build from going straight to production — and when that stop is worth it.**

You've seen a CI pipeline: push code, tests run, the checkmark turns green. Earlier topics in this section gate that green checkmark — branch protection, required reviews, merge policies — all of which decide whether your code is allowed *into the main branch*. This topic is about a different gate, one stage later and a lot scarier: deciding whether a build is allowed *out into production*, where real customers will hit it.

A **deploy approval** is the simplest possible answer to that question. Before the pipeline pushes to prod, it **stops** and waits for a human to click "Approve." Nothing ships until someone does. That human click — with their name and a timestamp attached — is a **sign-off**: a recorded "yes, ship it." It exists for two reasons. First, **judgement**: a person can look at a half-deployed canary's error rate, glance at the calendar, and say "not right now." Second, **accountability**: when something breaks at 2 a.m., or when an auditor shows up a year later, there's a record of who approved the change and when.

Here's the tension you need to feel early. A human gate is genuinely valuable for a risky, unusual change — and genuinely worthless when it's a **rubber stamp**: an approval that someone clicks without looking, just to make the pipeline move. A rubber stamp adds delay and a false sense of safety, which is worse than no gate at all. The whole craft of this topic is telling those two apart: automate the checks a computer can decide, and save the human gate for decisions that actually need a human.

> **Mindset shift:** an approval is not a button you press to unblock the pipeline. It is you putting your name on the statement *"I looked at this, and I believe it's safe to ship."* If you clicked Approve without looking, you didn't approve anything — you removed a safety gate while leaving the *paperwork* that says the gate worked. That's worse than having no gate, because now everyone trusts a check that nobody actually performed.

---

## Prerequisites

- **Required:** You've seen a CI/CD pipeline run — push code, tests run, something gets built. You don't need to have written one.
- **Required:** You know what "production" means (the live system real users use) versus a test environment.
- **Helpful:** You've used GitHub Actions or GitLab CI, even just by watching a pipeline go green on a pull request.
- **Helpful:** You've heard the words "staging," "deploy," or "rollback" and weren't 100% sure what they meant. (You will be.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Deploy** | Pushing a built version of your app onto a running environment so it actually serves traffic. |
| **Environment** | A running copy of your system — `dev`, `staging`, `production` — each with its own data and its own rules. |
| **Deploy approval** | A pipeline pause that waits for a human to click "Approve" before deploying (usually to prod). |
| **Sign-off** | A recorded human "yes, ship it" — a name plus a timestamp, kept as evidence. |
| **Required reviewer** | A person (or group) who must approve a deploy before it proceeds. |
| **Separation of duties** | A rule that the person who *made* a change can't be the one who *approves* its deploy. |
| **Promotion** | Moving the *same* build forward through environments: dev → staging → production. |
| **Freeze** | A period when deploys are blocked on purpose (e.g., Black Friday). |
| **Break-glass** | The emergency escape hatch to deploy *during* a freeze or *around* a gate, with extra logging. |
| **CAB** | Change Advisory Board — a committee that reviews and approves changes before they ship. |
| **Audit** | An outside check that asks you to *prove* your process happened (e.g., "show me a human approved this"). |
| **SOC 2** | A common compliance standard; one of its controls is "production changes are approved." |

---

## Core Concept 1 — A Deploy Approval Is a Pause

Strip away the jargon and a deploy approval is just this: **the pipeline gets to the "deploy to production" step, stops, and refuses to continue until a human says go.**

A normal pipeline flows straight through:

```
build  →  test  →  deploy to staging  →  deploy to production
  ✓        ✓             ✓                      ✓  (no human involved)
```

A pipeline *with* a deploy approval inserts a wall right before prod:

```
build  →  test  →  deploy to staging  →  [ ⏸ WAIT FOR HUMAN ]  →  deploy to production
  ✓        ✓             ✓                  ⬑ someone clicks "Approve"        ✓
```

The pause is not a failure. The pipeline isn't broken or red — it's *parked*, deliberately, waiting. It can sit there for ten minutes or three days. When an approver clicks the button, the deploy runs. If they click "Reject," it stops for good.

The concrete mechanism on **GitHub** is called an **Environment** with **required reviewers**. You declare an environment named `production` in your repo settings and tick "Required reviewers," listing the people allowed to approve. Then a deploy job simply *targets* that environment, and GitHub does the pausing for you:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment: production   # ← this one line triggers the approval gate
    steps:
      - uses: actions/checkout@v4
      - name: Ship it
        run: ./scripts/deploy.sh
```

That single line — `environment: production` — is the whole trick. Because the `production` environment is configured (in **Settings → Environments**) with required reviewers, GitHub will *not* run the job's steps until a listed reviewer approves. The pipeline shows "Waiting" and emails the reviewers. Nothing in the YAML says "pause" — the pause lives in the environment's *protection rules*, and the job just opts into them by naming the environment.

**GitLab** has the same idea under a different name: **protected environments** with **deploy approvals**. You protect the `production` environment and set how many approvals a deploy needs and who can give them. A `production` deploy job then waits for that many approvals before running.

> **Key insight:** the pause is configured on the **environment**, not buried in the pipeline script. This is on purpose. It means the rule ("prod needs an approval") is set *once, centrally*, by someone who owns the environment — and every pipeline that deploys to prod inherits it automatically. A developer can't quietly delete the gate by editing their own YAML, because the gate isn't *in* the YAML. That separation — rule on the environment, opt-in from the job — is what makes the gate trustworthy.

---

## Core Concept 2 — Environments Are a Promotion Path

You can't talk about deploy approvals without **environments**, because the whole point is that *production is special* and gets stricter rules than the others.

An **environment** is a running copy of your system. Most teams have three:

```
   dev                staging              production
   "my playground"    "dress rehearsal"    "the real thing"
   fake data          prod-like data       real customer data
   deploy freely      deploy freely-ish    deploy with approval
```

- **dev** (sometimes "development" or per-developer sandboxes) — where you try things. Breaking it bothers nobody. Deploy whenever.
- **staging** — a *rehearsal* of production: same shape, similar (but not real-customer) data, used to catch problems before they reach users. Often deploys automatically.
- **production** — the live system real users depend on. This is the one that gets the approval gate, because this is the one where a mistake costs real money, real trust, or real data.

The arrow between them is **promotion**: you take *the exact same build* and move it forward — dev, then staging, then prod. You don't rebuild for prod; you promote the artifact that already passed the earlier stages. (Rebuilding would mean prod runs *different bytes* than the ones you tested — a classic way to ship a surprise.)

Each environment can have **its own rules**. That's the design that makes this work:

| Environment | Who can deploy | Approval needed? | Why |
|---|---|---|---|
| `dev` | anyone | no | breaking it is free |
| `staging` | anyone / automatic | usually no | it's a rehearsal, not real users |
| `production` | a restricted group | **yes** | real users, real consequences |

So a pipeline that's "green" all the way through test and staging can still **stop dead** at the prod gate — and that's the system working as designed, not a bug. Green means "the code is fine and the rehearsal went well." The prod gate adds a separate question: "*should we ship this, right now, to real people?*" — and that question is reserved for a human.

> **Key insight:** "passed all the tests" and "approved for production" are two different statements, exactly like "compile" and "link" are two different stages. Tests answer *is the code correct?* The approval answers *should we release it right now?* A change can be perfectly correct and still be a terrible thing to deploy at 5 p.m. on a Friday before a holiday. Keeping the two questions separate is the entire reason the prod gate exists.

---

## Core Concept 3 — A Sign-off Is a Recorded "Yes"

When a human clicks "Approve," two things happen. The deploy proceeds — *and* the system writes down **who** clicked, **when**, and often **what they were approving**. That written-down record is the **sign-off**.

A sign-off is just a small, durable fact:

```text
Approved by:  alice@company.com
Approved at:  2026-06-22 14:03 UTC
Deployment:   web-app v2.7.1  →  production
Source:       commit a1b2c3d  ("add export-to-CSV")
```

This sounds bureaucratic until you hit the two moments it earns its keep:

1. **An incident.** The new release breaks checkout at 2 a.m. The on-call engineer needs to know *what* shipped and *who* okayed it — not to blame Alice, but to ask her "what did you see when you approved? was there anything odd?" The sign-off is the thread you pull to reconstruct what happened.

2. **An audit.** Some companies are legally or contractually required to **prove** that a human approved every production change. Standards like **SOC 2** have a control that's essentially "changes to production are reviewed and approved by an authorized person." An auditor doesn't take your word for it — they ask for *evidence*. "GitHub recorded that Alice, an authorized reviewer, approved this deploy on June 22" *is* that evidence. No record, no proof, failed control.

The good news for you as a junior: with GitHub Environments or GitLab protected environments, **you get the sign-off for free.** You don't build a separate approval system or fill in a spreadsheet. The platform records the approval as part of the deployment, with the name and timestamp baked in. The recorded sign-off is a *side effect* of using the built-in gate — which is one more reason to use the built-in gate instead of inventing your own.

> **Key insight:** a sign-off is not paperwork for its own sake — it's the *memory* of a decision. Humans forget who approved what within days; a system doesn't. The value isn't the click, it's the **durable, attributable record** the click leaves behind: a name, a time, and a thing approved. That record is what makes accountability and audits possible, and it's why "approve in Slack with a thumbs-up emoji" is *not* a sign-off — nobody can prove it later.

---

## Core Concept 4 — Separation of Duties

Here's a rule that surprises people the first time they hit it: **often, the person who wrote the change is not allowed to approve its deploy.** Someone *else* has to click Approve.

That rule is called **separation of duties** (you'll also hear "segregation of duties," same thing). The reasoning is plain: a second pair of eyes catches what the first pair missed, and — bluntly — it stops one person from quietly pushing whatever they want to production. If the author can also self-approve, the approval gate is just the author clicking twice. That's not a check; it's a formality.

```text
   ✗  WRONG: author approves their own deploy
      Bob writes the change  →  Bob clicks "Approve"  →  ships
      (the gate added nothing — one person, no second look)

   ✓  RIGHT: someone else approves
      Bob writes the change  →  Carol reviews & clicks "Approve"  →  ships
      (a second person actually looked before real users were touched)
```

Some compliance standards *require* this separation — it's not just a nice-to-have, it's a box an auditor checks. The platforms support it directly: GitHub's environment protection has a **"Prevent self-review"** option, so if Bob pushed the change, GitHub won't let Bob be the approver; it forces someone else on the reviewer list to do it.

As a junior, two practical consequences:

- **Your deploys will sometimes wait on a teammate**, and that's normal and intended — not a sign anyone distrusts you personally. The rule is about *roles*, not about you.
- **When you're the approver of someone else's change, you are the second pair of eyes.** That means the approval is only worth something if you actually look. Which leads straight to the next concept.

> **Key insight:** separation of duties only delivers value if the second person *genuinely reviews*. "Someone else clicked the button" is the letter of the rule; "someone else actually checked and judged it safe" is the spirit. A team that satisfies the letter while ignoring the spirit — two people both rubber-stamping — has the *cost* of the gate (delay, ceremony) and *none* of the benefit (a real second look). The rule is a container; you have to put real review inside it.

---

## Core Concept 5 — Manual vs Automated: Judgement vs Theatre

This is the most important judgement in the whole topic, and it's worth getting your head around it early because a lot of teams get it wrong.

A human approval gate is **valuable** in roughly these situations:

- The change is **risky or novel** — a database migration, a big architectural change, the first deploy of a new service. Something where a human's broader context ("we tried this last year and it went badly") matters.
- A **go/no-go look at live signals** — for example, you deploy to a small slice of traffic first (a *canary*), watch its error rate and latency for a few minutes, and a human decides "metrics look healthy, roll it out to everyone" or "errors are climbing, roll it back."
- The blast radius is **large** — touching payments, auth, or anything where being wrong is expensive and a calm human sanity-check is cheap insurance.

A human approval gate is **theatre** — pure cost, no benefit — when it's a **rubber stamp**: an approval nobody actually reviews. The classic shape is a low-risk, routine change (a copy tweak, a config flag) that has *already* passed every automated check, now sitting in a queue waiting for a manager to click "Approve" between meetings without reading a thing. That click adds hours of delay and *zero* safety, because the human added no judgement the computer hadn't already applied. Worse, it trains everyone to treat approvals as meaningless paperwork — so when a *genuinely* risky change comes along, it gets the same reflexive click.

The principle the best teams follow:

> **Automate the checks a computer can decide. Reserve human gates for decisions that actually need a human.**

A computer is *better* than a human at deciding "do all the tests pass," "is coverage above 80%," "did the security scan find a known-bad dependency," "is the error budget healthy." Those should be **automated gates** — fast, consistent, unbiased, and they never get tired or click-through. A human is better at "this migration is irreversible and it's the day before a holiday — let's wait" or "the canary's p99 latency just doubled, abort." Those are **human gates**.

```text
   COMPUTER decides (automate it):           HUMAN decides (gate it):
     all tests green?                           is this the right moment to ship?
     coverage threshold met?                    does the canary look healthy?
     no known-vulnerable dependencies?          is this irreversible & high-stakes?
     linter / type-check clean?                 do we trust this on a holiday weekend?
     error budget not exhausted?                go / no-go on a risky migration
```

> **Key insight:** every gate has a cost (delay, interruption, queueing) and is only worth it if it catches something. A human gate on a change a computer already fully validated catches nothing — it's *all* cost. The skill isn't "more gates = safer"; it's matching each decision to whoever can actually make it well. Push the decidable down to the machine; lift the genuinely-judgement-y up to a person. A gate that nobody-actually-reads is not a safety feature — it's a speed bump with a safety *sticker* on it.

---

## Core Concept 6 — Freezes, Break-glass, and the CAB

Three more terms you'll meet around deploy approvals. You don't need to *implement* these as a junior, but you need to recognise them.

**Deployment freeze.** Sometimes a team blocks *all* deploys for a window on purpose. The classic example: a retailer freezes deploys over **Black Friday** week — the system is making the most money it'll make all year, and *any* change is a risk that isn't worth taking, even a "safe" one. During a freeze, the deploy gate effectively says "no, not even with approval." Freezes are blunt but sometimes exactly right: when the downside of *any* change vastly outweighs the upside of *this particular* change, the safest change is none.

**Break-glass.** A freeze (or any hard gate) creates a problem: what about a real emergency *during* the freeze — say, a security hole that has to be patched *now*? You need an escape hatch. That's **break-glass**: a deliberate, logged way to deploy *around* the normal gate in an emergency. The name comes from the "break glass in case of fire" alarm — using it is allowed, but it's loud, it's logged, and you'd better have a real reason. (The whole discipline of doing this *safely* — who can, how it's recorded, what review happens afterward — is its own topic: [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md).)

**Change Advisory Board (CAB).** This is the *heavyweight* end of approvals. A CAB is a **committee** — often including managers and people outside the team that wrote the change — that meets to review and approve changes before they ship. It's the traditional, big-company way to control risk: nothing goes to prod without the board's blessing.

It sounds safe. The surprising part: **research suggests it usually isn't.** The long-running [DORA](https://dpsdorter.example) program (the people behind the *Accelerate* book and the annual State of DevOps reports) studied this directly. Their finding: **heavyweight external approval — like a CAB — slows teams down without making them safer.** It increases lead time (changes wait around for the meeting) and shows *no improvement* in failure rate. What *does* help is **lightweight peer review** — a knowledgeable teammate reviewing the change close to when it's made (which is exactly what branch protection and the deploy approvals in this section give you).

> **Key insight:** the instinct "important change → make more, higher-up people approve it" feels safe but the evidence says it backfires. The approver who actually reduces risk is someone *close to the change* who *understands it* — a teammate, not a distant committee meeting once a week. Lightweight, local, knowledgeable review beats heavyweight, distant, ceremonial approval. More signatures is not more safety; *better-informed* signatures is.

---

## Real-World Examples

**1. The green pipeline that stopped before prod.** A team's pipeline runs build → test → deploy-to-staging, all green, in eight minutes. Then it parks on a "Waiting" status. A new engineer panics — "is it broken?" It isn't. The `production` deploy job names `environment: production`, which has required reviewers. It's *waiting for a human*, exactly as designed. A senior glances at the staging deploy, confirms it looks healthy, clicks Approve, and it ships. The "stop" was the gate doing its job — green meant *the code is fine*, and the gate added *should we ship it now?*

**2. The audit that needed proof.** A startup signs an enterprise customer, who demands a SOC 2 report. The auditor asks: "Show me that production changes are approved by an authorized person." Because the team uses GitHub Environments with required reviewers, every prod deploy already has a recorded approver and timestamp. They export the deployment history; the control passes. A neighbouring team that approved deploys via Slack thumbs-up had *no durable record* — and spent two stressful weeks reconstructing evidence from chat history. Same approval, but only one form of it counted.

**3. The rubber stamp that taught the wrong lesson.** A company required a director to approve *every* prod deploy — including one-line copy changes. The director, swamped, approved everything within seconds, unread. For months it felt "safe." Then a genuinely risky change slipped through with the same reflexive click, broke checkout, and cost real money. The gate hadn't been adding safety — it had been training everyone, including the director, that approvals are meaningless. They fixed it by *automating* the checks for low-risk changes (which then shipped with no human gate at all) and reserving the human approval for changes flagged risky — at which point the director actually read them.

**4. The freeze and the fire.** A retailer freezes all deploys for Black Friday week. Mid-week, a serious security vulnerability is disclosed in a library they use. They can't wait until the freeze lifts. They use the documented **break-glass** path: an on-call lead deploys the patch around the freeze, the action is logged loudly, and the change is reviewed first thing the next morning. The freeze protected them from *routine* risk; the escape hatch let them handle a *real emergency* without throwing out the whole safety policy.

---

## Mental Models

- **The gate is a tollbooth, not a wall.** Traffic (your deploy) flows up to it and *waits*. A human raises the barrier. A wall stops everything forever; a tollbooth stops each car briefly so someone can check it through. A deploy approval is a tollbooth — and a *rubber stamp* is a tollbooth where the attendant waves every car through without looking. Same barrier, no actual check.

- **Environments are stages of a play.** `dev` is rehearsal in your bedroom, `staging` is the dress rehearsal on the real stage, `production` is opening night with a paying audience. You promote the *same performance* forward; you don't write a new play for opening night. And opening night gets a final "are we ready?" that rehearsals don't — that's the prod approval.

- **A sign-off is a receipt.** When you approve, you're not just unblocking — you're signing a receipt that says "I, Alice, at this time, okayed *this*." Months later the receipt is the only proof the transaction happened the way you remember. "Trust me, I approved it" is not a receipt.

- **Automate the decidable, judge the rest.** Think of every check as a question. If the answer is a *fact* a computer can compute (tests pass? coverage met? scan clean?), let the computer answer it — instantly, every time. If the answer is a *judgement call* under uncertainty (is now the right time? does this canary look healthy?), give it to a human. Putting a human on a fact-question is theatre; putting a computer on a judgement-question is reckless.

- **More approvers ≠ more safety.** A distant committee signing off is like asking five strangers to proofread a letter in a language none of them read well — lots of signatures, little actual checking. One knowledgeable teammate who reads it carefully catches more. Depth of review beats breadth of signatures.

---

## Common Mistakes

1. **Treating a parked pipeline as a failure.** A pipeline "Waiting" on a prod approval is *not* broken or red — it's parked by design, waiting for a human. Re-running it or "fixing" it just resets the wait. Find the approval gate and either approve it or get the right person to.

2. **Rubber-stamping.** Clicking "Approve" without looking. This is the cardinal sin of this topic. It removes the safety the gate was supposed to add while leaving behind a *record* that says the gate worked — so everyone now trusts a check nobody performed. If you're not going to look, the honest move is to remove the gate, not fake it.

3. **Putting a human gate on a fully-automatable check.** Making a person manually approve "the tests passed" when a computer already decided that, instantly and perfectly. That's all delay, no judgement. Let the machine gate the facts; reserve humans for the judgement calls.

4. **Letting the author approve their own deploy.** If the person who wrote the change is also the one who approves it, the "second pair of eyes" is the same pair of eyes. Turn on "prevent self-review" / require a different approver — and *mean* it.

5. **Approving in chat instead of the system.** A Slack thumbs-up is not a sign-off. It's not durable, not attributable, and an auditor won't accept it. Approve through the platform's actual gate (GitHub Environments, GitLab protected environments) so the record exists where it counts.

6. **Confusing "all tests green" with "approved to ship now."** Green means the code is correct and staging looked fine. It does *not* mean it's the right moment to release — that's a separate question, and the approval gate exists precisely to ask it.

7. **Assuming a freeze means no possible deploys, ever.** Freezes block *routine* deploys, but a real emergency needs an escape hatch. That's break-glass — using it isn't "cheating," it's the policy's intended emergency path (covered in [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md)).

8. **Believing a CAB makes you safer.** A heavyweight, distant approval committee feels rigorous, but the DORA research found it slows teams without lowering failure rates. Lightweight review by someone who understands the change is what actually helps.

---

## Test Yourself

1. In one sentence, what does a "deploy approval" do to a pipeline, and what is it waiting for?
2. Your pipeline goes green through build, test, and staging, then shows "Waiting." A teammate says "the build is broken." Are they right? What's actually happening?
3. What is a *sign-off*, and name the two situations where having one recorded actually matters.
4. What does *separation of duties* require, and why does it make an approval gate worth more?
5. Give one example of a check a **computer** should decide automatically, and one decision a **human** should make at a deploy gate. Why split them that way?
6. Define a *rubber stamp* approval and explain why it can be *worse* than having no approval gate at all.
7. What did the DORA research find about heavyweight external approval (like a CAB), and what works better?

<details>
<summary>Answers</summary>

1. A deploy approval **pauses** the pipeline right before it deploys (usually to production) and waits for a **human to click "Approve"**; nothing ships until they do.
2. **They're wrong** — the pipeline isn't broken. It deployed to staging fine and is now *parked* at the production approval gate, waiting for an authorized human to approve the prod deploy. "Waiting" is by design, not a failure.
3. A sign-off is a **recorded human "yes, ship it"** — a name plus a timestamp (plus what was approved). It matters (a) during an **incident**, to reconstruct what shipped and who okayed it, and (b) during an **audit**, where you must *prove* an authorized human approved each prod change (e.g., SOC 2).
4. It requires that **someone other than the author** approves the deploy — the author can't self-approve. It's worth more because it guarantees a genuine *second pair of eyes* looked before real users were touched, instead of one person clicking twice.
5. **Computer:** "do all the tests pass?" / "is coverage above the threshold?" / "did the security scan come back clean?" — facts it can decide instantly and consistently. **Human:** "is this the right moment to ship?" / "does the canary look healthy enough to roll out to everyone?" — judgement calls under uncertainty. Splitting them puts each decision with whoever can make it well: machines never tire on facts; humans add context machines lack.
6. A rubber stamp is an approval someone clicks **without actually reviewing**. It's worse than no gate because it adds delay *and* leaves a record claiming the gate worked — so the whole team trusts a safety check that nobody actually performed, and the false confidence eventually lets a real problem through.
7. DORA found heavyweight external approval (like a CAB) **slows teams down (longer lead time) without reducing failure rates** — no safety benefit for the cost. What works better is **lightweight peer review** by someone close to and knowledgeable about the change.

</details>

---

## Cheat Sheet

```text
WHAT IT IS
  deploy approval = pipeline PAUSES before prod, waits for a human to click "Approve"
  sign-off        = the RECORDED "yes" → name + timestamp + what was approved
  the pause lives on the ENVIRONMENT, not in the pipeline YAML (so it can't be edited away)

ENVIRONMENTS = a promotion path
  dev  →  staging  →  production
  free    rehearsal   real users  ← gets the approval gate
  promote the SAME build forward; don't rebuild for prod

GITHUB (the mechanism)
  Settings → Environments → "production" → Required reviewers (+ "Prevent self-review")
  job:  environment: production   ← one line opts the job into the gate
  → GitHub parks the job until a listed reviewer approves; records who + when

GITLAB
  Protected environments + deploy approvals (set count + who can approve)

SEPARATION OF DUTIES
  author of the change  ≠  approver of the deploy   (a real second pair of eyes)
  enable "prevent self-review"; some compliance REQUIRES this

MANUAL vs AUTOMATED  → automate the decidable, reserve humans for judgement
  computer decides:  tests pass? coverage met? scan clean? error budget ok?
  human decides:     right moment? canary healthy? risky/irreversible? holiday?
  rubber stamp = approve without looking = ALL cost, NO safety (worse than no gate)

FREEZE / BREAK-GLASS / CAB
  freeze      = block all deploys on purpose (e.g. Black Friday)
  break-glass = logged emergency escape hatch around a gate  (→ topic 07)
  CAB         = heavyweight approval committee; DORA: slower, NOT safer
  lightweight peer review  >  heavyweight distant approval
```

---

## Summary

- A **deploy approval** is a deliberate **pause**: before the pipeline deploys (usually to **production**), it stops and waits for a human to click "Approve." Nothing ships until they do. The pause is configured on the **environment**, not in the pipeline script, so it's set centrally and can't be edited away by the job.
- **Environments** (`dev` → `staging` → `production`) are a **promotion path** for the *same* build, and each can have its own rules. Production gets the approval gate because it's the one with real users and real consequences. "All tests green" and "approved to ship now" are two different statements.
- A **sign-off** is the **recorded** "yes" — a name and a timestamp — and it's what makes **accountability** (during incidents) and **audits** (proving a human approved, e.g. SOC 2) possible. With the built-in platform gates, you get the record for free.
- **Separation of duties** means the author of a change usually can't approve its own deploy — a genuine second pair of eyes — and some compliance standards require it. It only adds value if the second person *actually reviews*.
- The key judgement: **automate the checks a computer can decide; reserve human gates for real judgement.** A rubber-stamp approval — clicked without looking — is *worse* than no gate, because it adds delay and false confidence. **Freezes** block routine deploys on purpose; **break-glass** is the logged emergency escape hatch; a heavyweight **CAB** tends to slow teams without making them safer, while lightweight peer review does.

The throughline: a prod deploy often needs a human's blessing — but the blessing is only worth something if the human *actually looked*. Put the facts on the machine, the judgement on the person, and keep a record of the call.

---

## Further Reading

- [GitHub Docs — Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) — how to create an environment and target it from a job.
- [GitHub Docs — Required reviewers & deployment protection rules](https://docs.github.com/en/actions/deployment/protecting-deployments/configuring-protection-rules-for-deployments) — required reviewers, wait timers, and "prevent self-review."
- [GitLab Docs — Protected environments & deployment approvals](https://docs.gitlab.com/ee/ci/environments/protected_environments.html) — the GitLab equivalent: who can deploy and how many approvals are needed.
- *Accelerate* (Forsgren, Humble, Kim) and the annual **DORA / State of DevOps** reports — the "Change Approval" findings: why heavyweight external approval (CAB) slows teams without improving stability, and why lightweight peer review wins.
- The [middle.md](middle.md) of this topic, which formalizes approval *as a gate type* — designing it so it adds judgement, not theatre — and goes deeper on compliance controls and canary-based go/no-go.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/junior.md) — the gate one stage *earlier*: controlling what gets into `main` (vs. what gets deployed).
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/junior.md) — the broader skill of deciding which gates are worth their cost.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md) — the emergency escape hatch for deploying *around* a gate or freeze, safely and with a record.
- [Release Engineering](../../release-engineering/) — the bigger picture of how builds become releases: promotion, canaries, rollbacks.
- [Security](../../../../Security/) — separation of duties and approval controls from the security-and-compliance angle.
