# Tracking & Prioritizing — Junior Level

> **Roadmap:** [Technical Debt Management](../README.md) → Tracking & Prioritizing
> *You will never run out of things that could be cleaner. The skill isn't finding debt — debt finds you. The skill is writing it down somewhere it won't rot, and then fixing the few pieces that are actually costing you money while ignoring the rest on purpose.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A `// TODO` Is Not Tracking](#core-concept-1--a--todo-is-not-tracking)
5. [Core Concept 2 — What Goes in a Debt Ticket](#core-concept-2--what-goes-in-a-debt-ticket)
6. [Core Concept 3 — Interest: Fix Debt You Touch, Ignore Debt You Don't](#core-concept-3--interest-fix-debt-you-touch-ignore-debt-you-dont)
7. [Core Concept 4 — The Impact × Effort Grid](#core-concept-4--the-impact--effort-grid)
8. [Core Concept 5 — Why "Fix All the TODOs" Is the Wrong Instinct](#core-concept-5--why-fix-all-the-todos-is-the-wrong-instinct)
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

> Focus: **Once you've found debt, where does it live — and how do you decide what to fix first?**

You've spotted something messy. A 400-line function. A copy-pasted block that exists in three files. A config value hard-coded where it should be a setting. Good — noticing is the first step. But noticing creates a question you weren't expecting: *now what?*

There are two wrong answers, and almost everyone reaches for one of them. The first is "I'll fix it right now," which derails the task you were actually doing and turns a 30-minute change into a 3-hour yak-shave. The second is "I'll leave a `// TODO` and come back to it," which feels responsible and is in fact how debt goes invisible — that comment will sit there, unread, for years.

The right answer is two separate skills, and this page is about both. **Tracking** is making the debt *durable and findable*: writing it down somewhere a human will actually look, in words a human can actually act on. **Prioritizing** is accepting that you cannot fix everything — there is always more debt than time — and choosing the few items worth the cost. The golden rule of prioritizing, which surprises every junior the first time they hear it, is this: *fix the debt in code you change often, and deliberately leave the debt in code you never touch.* A mess in a file nobody has opened in two years is costing you nothing. Fixing it is wasted effort that could have gone to the mess you trip over every single week.

> **The mindset shift:** stop trying to make the codebase *clean*. Start trying to make the codebase *cheap to change where you actually change it*. Debt you never touch has zero interest — leaving it is not laziness, it's correct prioritization. The goal was never spotless code; it was a low bill.

---

## Prerequisites

- **Required:** You can recognize "messy code" when you see it — a long function, duplication, a confusing name, a hack with a comment apologizing for itself.
- **Required:** You've used an issue tracker at least once (GitHub Issues, Jira, Linear, GitLab — any of them).
- **Helpful:** You've worked in one codebase long enough to know which files you keep coming back to and which you never open. That intuition *is* the prioritization signal.
- **Helpful:** You've read [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) and met the *principal vs interest* idea — this page is where "interest" becomes a decision rule.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Technical debt** | The gap between the code you have and the code the problem now needs; it makes future changes slower. |
| **Tracking** | Recording debt somewhere durable and findable — a ticket, a backlog item, a register — not a buried comment. |
| **Debt ticket / item** | One written, actionable entry describing a piece of debt: what, where, why it hurts, roughly how big. |
| **Debt register / backlog** | The single list where all the debt items live so they can be seen, compared, and chosen between. |
| **Prioritizing** | Deciding the *order* you'll pay debt down — what's worth doing now, later, or never. |
| **Interest** | The recurring cost debt charges you — extra time, bugs, risk — *every time you work near it*. |
| **Hot code / high-churn code** | Code that changes often. Debt here charges interest constantly. |
| **Cold code / stable code** | Code that almost never changes. Debt here charges (almost) no interest. |
| **Impact** | How much fixing this debt helps — saved time, fewer bugs, unblocked work. |
| **Effort** | How much it costs to fix — time, risk, coordination. |

---

## Core Concept 1 — A `// TODO` Is Not Tracking

Here is the single most common way junior engineers *think* they're tracking debt, and aren't:

```python
def calculate_invoice(order):
    # TODO: this doesn't handle discounts, fix later
    return order.subtotal * 1.2
```

That comment feels like progress. It is, in practice, a note written in invisible ink. Consider what has to happen for it to ever be acted on: someone must open *this exact file*, scroll to *this exact line*, read the comment, decide it's worth doing, and have time right then. None of that will happen. The comment is not on any list anyone reviews. It is not visible to your team lead planning the next two weeks. It does not show up when someone asks "what's the worst debt in the billing module?" It just sits there, accumulating company, until a codebase has 4,000 `TODO`s and everyone has learned to read straight past them.

**Tracking means the debt is durable and findable** — recorded somewhere a human will *actually look*, on a list that gets *reviewed*. Concretely, that usually means an entry in your issue tracker:

```
[TECH-DEBT] calculate_invoice ignores discounts
Where: billing/invoice.py, calculate_invoice()
Problem: hard-codes 1.2 tax multiplier, silently ignores discount field.
         Any order with a discount is overcharged.
Impact:  customer-facing correctness; billing is touched ~weekly.
Effort:  ~half a day (add discount handling + tests).
```

The difference is not the *amount* of text. The difference is that this entry lives in a place where it gets seen during planning, can be searched, can be assigned, can be prioritized against other work, and can be *closed* when done. A `// TODO` can do none of those things.

> **Key insight:** the test for "is this tracked?" is brutally simple — *will someone who isn't looking at this line of code ever find out it exists?* If the answer is no, it isn't tracked. A comment in a file is a reminder to yourself, today. A ticket is a record the whole team can act on, later.

A reasonable middle ground many teams use: keep a short comment *and* a ticket, with the comment pointing at the ticket — `# TODO(TECH-1234): ignores discounts`. The comment marks the spot in the code; the ticket carries the real, reviewable record. The comment alone is the trap.

---

## Core Concept 2 — What Goes in a Debt Ticket

A debt ticket that just says "clean up the user service" is barely better than the `// TODO`. Nobody can pick it up, because nobody can tell *what's wrong*, *how bad it is*, or *whether it's worth doing*. A useful debt ticket answers four questions, and you can write all four in a few minutes.

**1. What and where — be specific enough to find it.** Name the file, the function, the module. "The auth code is messy" is a feeling. "`AuthService.validateToken()` re-parses the JWT three times per request" is a thing someone can go look at.

**2. Why it hurts — the interest, in plain terms.** This is the part juniors skip and it's the most important. *Don't describe the mess; describe the pain the mess causes.* Not "this function is too long" but "this function is so tangled that every change to checkout takes a day and usually introduces a bug." The first is aesthetic. The second is a cost a manager can understand and fund.

**3. Roughly how big — a rough effort, not a precise estimate.** "An hour," "half a day," "a week-ish, and it touches the payment flow so it's risky." You are not committing to a deadline; you are giving future-you and your team enough to compare this against other items. Rough is fine. *Missing* is not.

**4. What "done" looks like — so it can actually be closed.** "Discounts are applied correctly and there's a test proving it." Without this, debt tickets become eternal — nobody knows when they're finished, so they never close.

Here is the shape, side by side — useless versus useful:

```
BAD                              GOOD
─────────────────────────       ──────────────────────────────────────────
Title: fix user service         Title: [DEBT] UserService loads full user
                                       row to check one boolean flag
(no body)                       Where: users/service.py, get_user_flags()
                                Why:   pulls 30 columns + 2 joins just to
                                       read is_active; called on every page
                                       load, ~40% of our DB time per traces
                                Effort: ~2 hours (add a narrow query)
                                Done:  is_active read via a single-column
                                       query; p95 page latency drops
```

> **Key insight:** a debt ticket is a *sales pitch to your future self and your team*, not a confession. Its job is to let someone who has never seen the code decide, in thirty seconds, whether fixing it is worth more than the next thing on the list. "What, where, why it hurts, how big, what done means" — answer those five and you've done it.

You do not need a heavyweight process for this. A label like `tech-debt` on a normal issue, in the tracker you already use, is plenty at the junior level. The discipline is in the *content*, not the tooling.

---

## Core Concept 3 — Interest: Fix Debt You Touch, Ignore Debt You Don't

This is the concept that changes how you work, so slow down here.

Recall the debt metaphor: debt has **principal** (the mess itself) and **interest** (the recurring cost it charges you). The crucial, non-obvious fact is that *interest is only charged when you go near the code.* A horrible function you never open, in a module nobody has changed in two years, charges you exactly nothing. It is principal with a zero interest rate. Paying it down — spending real hours to clean it — buys you *nothing*, because it wasn't costing you anything.

Contrast that with a messy function in code you edit every week. *Every* time you touch it, the mess slows you down: you re-understand the tangle, you work around it, you maybe introduce a bug. That's interest, charged weekly, forever. Cleaning *that* function pays off on the very next change, and every change after.

So the golden rule of prioritizing debt:

> **Fix the debt in code you change often. Leave the debt in code you never touch.**

How do you know which code you change often? You usually already know — it's the files you keep opening. But there's also an objective signal: how often a file has changed recently, which you can see straight from version control.

```bash
# Which files changed most in the last 6 months? (high churn = likely high interest)
git log --since="6 months ago" --name-only --pretty=format: \
  | sort | uniq -c | sort -rn | head -20
```

A file at the top of that list that is *also* messy is your highest-interest debt: it's painful *and* you keep paying for it. A messy file that isn't on the list at all is low priority no matter how ugly it is — you're not paying interest on it.

Make this concrete:

| File | How messy? | How often changed? | Interest | Verdict |
|---|---|---|---|---|
| `checkout.py` | Very | Weekly | **High** | Fix it — pays off immediately |
| `pdf_export.py` | Very | Once in 2 years | ~Zero | **Leave it** — clean code here is wasted |
| `auth.py` | A little | Daily | Medium | Worth a small tidy-up |
| `legacy_import.py` | Horrible | Never | Zero | Leave it, possibly forever |

Notice `pdf_export.py` and `legacy_import.py`: genuinely awful code that is correctly *low* priority. That feels wrong to a junior — the instinct screams "but it's terrible!" Terrible *and harmless*. Your time is the scarce resource. Spend it where interest is being charged.

> **Key insight:** "should I fix this debt?" is mostly answered by a question that has nothing to do with how ugly the code is — *how often does this code change?* Ugly + frequently-changed = fix now. Ugly + never-changed = leave it. The ugliness is a red herring; the change-frequency is the signal.

---

## Core Concept 4 — The Impact × Effort Grid

Interest tells you *which debt is expensive*. But "expensive to keep" is only half the decision — you also care about *how much it costs to fix*. Combine the two and you get a simple, powerful tool you'll use for the rest of your career: the **impact × effort grid**.

- **Impact** = how much fixing it helps. (High-interest debt is high-impact to fix — that's the link to Concept 3.)
- **Effort** = how much it costs to fix — time, and risk of breaking things.

Place each debt item into one of four boxes:

```
                 LOW EFFORT              HIGH EFFORT
            ┌────────────────────┬────────────────────┐
HIGH IMPACT │   ① DO FIRST       │   ② PLAN IT        │
            │   quick wins —     │   big payoff but   │
            │   just do them     │   needs a slot     │
            ├────────────────────┼────────────────────┤
 LOW IMPACT │   ③ MAYBE / LATER  │   ④ DON'T          │
            │   tidy if you're   │   expensive AND    │
            │   already in there │   barely helps     │
            └────────────────────┴────────────────────┘
```

Read the boxes:

- **① High impact, low effort — do these first.** The whole game is finding these. A confusing variable name in a hot function, a missing index causing a slow query you hit constantly, a five-minute extraction that untangles a daily headache. Cheap to fix, pays off immediately. *This is where your debt-fixing time should mostly go.*
- **② High impact, high effort — plan it.** Splitting a god-class that's central to the product, replacing a flaky core dependency. Worth doing, but not on a whim — it needs a real slot, maybe a ticket on the roadmap, maybe a senior to pair with. As a junior you usually *flag* these, you don't quietly start them.
- **③ Low impact, low effort — opportunistic only.** Fix it *if you're already editing that file for another reason* (this is the "boy-scout rule" you'll meet in [05 — Paying Down Debt](../05-paying-down-debt/junior.md)). Don't make a special trip.
- **④ Low impact, high effort — don't.** Expensive to fix, barely helps. The rewrite of the cold module nobody touches lives here. Saying "no" to this box is a skill, not a failure.

> **Key insight:** quadrant ④ and quadrant ① are where juniors go wrong in opposite directions — they spend days on ④ ("I rewrote the whole thing!") while walking past the ① quick wins that would've saved the team real time. Train yourself to *hunt for ①* and to *refuse ④ out loud*. "Doing the impressive hard cleanup" is often the wrong call; "doing five boring cheap fixes in hot code" is usually the right one.

This grid isn't precise math — you're eyeballing high/low, not computing scores. That's fine. At the junior level, getting an item into roughly the right box is 90% of the value. (The precise scoring methods — cost-of-delay, WSJF — come later, in [middle.md](middle.md).)

---

## Core Concept 5 — Why "Fix All the TODOs" Is the Wrong Instinct

Sooner or later, someone — maybe you — has the satisfying idea: "let's declare a cleanup week and fix *all* the `TODO`s / all the warnings / all the debt." It feels virtuous. It is almost always a mistake, and understanding *why* ties together everything above.

**It ignores interest.** "Fix all the TODOs" treats every piece of debt as equally worth fixing. But most of those `TODO`s are in cold code charging zero interest (Concept 3). You'd spend a week paying down principal on debts that weren't costing anything — effort with no return. Meanwhile the genuinely expensive debt, the daily-pain stuff, is a small fraction of the list and gets the same slice of attention as the harmless stuff.

**It ignores impact × effort.** A blanket "fix everything" makes no distinction between a ① quick win and a ④ money-pit (Concept 4). You'll burn the week on whichever items happen to be at the top of the file, not the ones that matter, and you'll likely *not even finish* — leaving you with a half-done cleanup and the high-impact items still untouched.

**It risks breaking working code for no reason.** Every change is a chance to introduce a bug. Changing code that *works* and that *nobody touches*, purely to make it prettier, is taking on risk to buy nothing. Cold code that runs correctly is doing its job. Leave it alone.

**It's demoralizing and never ends.** Debt is generated continuously; you will never reach zero, and a team that frames success as "zero debt" is signing up to always feel like it's failing. The realistic goal is not *no debt* — it's *the expensive debt, in the code we actually work in, kept under control.*

> **Key insight:** "fix all the TODOs" optimizes for a clean *list*, when the thing you actually care about is a low *bill*. A codebase with 500 harmless `TODO`s in cold code and zero debt in its hot paths is in great shape. A codebase with zero `TODO`s but a tangled, daily-edited checkout flow is in trouble. Chase the bill, not the list.

The better instinct: keep your tracked debt visible (Concept 1–2), watch which items are in hot code (Concept 3), and steadily knock out the ① quick wins (Concept 4) — especially in files you're already editing. That beats any heroic cleanup sprint, every time.

---

## Real-World Examples

**1. The 4,000-`TODO` codebase nobody trusts.** A team grew fast and "tracked" debt entirely via `// TODO` comments. A new hire greps for `TODO` and finds 4,000 hits dating back six years — some fixed long ago, some meaningless out of context, most in code nobody remembers. The comments are worse than useless: they're noise that hides the few that matter. The fix wasn't to "address the TODOs"; it was to *stop using comments as a tracker*. They created `tech-debt`-labelled issues for the handful of items in active code and deleted the rest of the comments. The lesson: untracked debt at scale doesn't just fail to help, it actively buries the signal.

**2. The beautiful rewrite of the dead module.** An eager junior spent a full sprint lovingly rewriting the report-export module — cleaner classes, full tests, gorgeous code. In review, a senior asked one question: "when did anyone last change this file?" Answer: fourteen months ago. The module worked fine and nobody touched it. The rewrite was quadrant ④ and zero-interest debt — a week of effort that saved the team nothing and introduced two new bugs in the process. Meanwhile the checkout flow they edited daily stayed a mess. Effort spent on the wrong axis entirely.

**3. The five-minute fix that saved an hour a week.** A developer, annoyed for the tenth time by a query that loaded a user's entire profile just to read one boolean, finally wrote a one-line debt ticket: *"`get_user_flags` pulls the whole row + 2 joins to read `is_active`; called on every page load; replace with a single-column query, ~30 min."* It sat in the backlog labelled `tech-debt`. At the next planning, it was visible, obviously high-impact and low-effort (quadrant ①), and got picked up. Thirty minutes of work cut measurable load off every page. *That's* the loop working: spotted → tracked durably → prioritized by impact/effort → fixed. Compare it to example 2 — same effort budget, wildly different return, because one targeted hot code and the other cold.

---

## Mental Models

- **A `// TODO` is a sticky note on the inside of a drawer.** It's a real note, but only the person who opens *that drawer* will ever see it — and nobody opens that drawer. A ticket is the same note pinned to the fridge the whole household walks past. Same words; one gets acted on.

- **Interest is a meter that only runs when you're in the room.** Debt in code you don't touch is a meter switched off — it ticks nothing. Debt in code you edit weekly is a meter spinning every time you walk in. Pay down the spinning meters; ignore the ones that are off, however ugly the room.

- **The grid is a triage nurse.** Not everyone gets treated, and not in arrival order. The nurse sorts by *how bad it is* (impact) against *how much it takes to treat* (effort). The quick, high-payoff cases go first; the expensive-but-minor ones wait, maybe forever. Debt triage is the same call.

- **"Fix all the TODOs" is cleaning the whole house before guests who'll only see the kitchen.** You'll exhaust yourself scrubbing rooms no one enters and run out of time for the room that's actually on show. Clean where it's seen and used. Let the spare-room dust be.

---

## Common Mistakes

1. **Treating a `// TODO` as "tracked."** It's a private reminder, not a record. If it's not on a list someone reviews, it doesn't exist as far as the team is concerned. Promote anything that matters to a real, labelled ticket.

2. **Writing tickets that describe the mess instead of the pain.** "This function is too long" gives a reader nothing to weigh. "This function makes every checkout change take a day and risks a bug" gives them a cost. Always write the *interest*, not the *aesthetics*.

3. **Prioritizing by ugliness instead of change-frequency.** The grossest code is often *not* the most important to fix, because nobody touches it. Ask "how often does this change?" before "how ugly is it?" Ugly-and-cold is low priority on purpose.

4. **Spending your effort in quadrant ④.** The big, impressive rewrite of code that barely matters *feels* like the most work and is therefore the most rewarding — which is exactly the trap. Impressive ≠ valuable. Hunt quadrant ①.

5. **Declaring a "fix everything" cleanup.** It ignores interest and impact/effort, risks breaking working code, rarely finishes, and chases a clean *list* instead of a low *bill*. Steady quick-wins in hot code beat a heroic sprint.

6. **Writing tickets with no "done" and no rough size.** A ticket with no definition of done never closes; one with no effort estimate can't be compared against other work. Both turn your backlog into a graveyard nobody can prioritize.

7. **Fixing debt in a file you're not otherwise touching, "while you're thinking about it."** Unless it's a true quick win, a special trip into code for a non-urgent cleanup adds risk and context-switching. Prefer to fix debt as you *naturally* pass through (the boy-scout rule), or schedule it deliberately.

---

## Test Yourself

1. Your teammate says "it's fine, I left a `// TODO` so we won't forget." Why is that probably wrong, and what would actually count as tracking it?
2. List the things a useful debt ticket should contain. Which one do juniors most often skip, and why does it matter most?
3. Two files are equally, horribly messy. `report_export.py` last changed 14 months ago; `checkout.py` changes weekly. Which debt do you fix first, and what's the one-word reason?
4. Sketch the impact × effort grid. Which quadrant should most of your debt-fixing time go to, and which should you refuse?
5. A senior proposes a "cleanup week to fix every `TODO` in the repo." Give two concrete reasons this is likely a bad use of the week.
6. You're editing `auth.py` for a feature and notice a badly-named variable two lines away — a 30-second fix. Do you fix it? What if the badly-named variable were in a different file you weren't touching?

<details>
<summary>Answers</summary>

1. A `// TODO` lives only in that file at that line; nobody who isn't already reading that code will ever find it, it's not on any reviewed list, and it can't be prioritized, assigned, or closed. Real tracking = an entry in the issue tracker (a labelled ticket) that gets seen during planning, can be searched and assigned, and can be closed when done.
2. **What/where** (specific file + function), **why it hurts** (the *interest* — the real pain it causes), **rough effort/size**, and **what "done" looks like**. Juniors skip **why it hurts** — and it matters most because without it nobody can judge whether the fix is worth funding; it's the difference between an aesthetic complaint and a cost.
3. **`checkout.py`.** One-word reason: **interest** (it's changed weekly, so the mess charges you constantly; the report module charges ~nothing because nobody touches it).
4. Two axes, four boxes: ① high-impact/low-effort (do first), ② high-impact/high-effort (plan it), ③ low-impact/low-effort (only if you're already there), ④ low-impact/high-effort (don't). Most of your time → **①, the quick wins**. Refuse → **④** (expensive and barely helps).
5. Any two: it ignores *interest* (most TODOs are in cold code costing nothing); it ignores *impact × effort* (treats quick wins and money-pits the same); it risks breaking working code for no benefit; it rarely finishes; it chases a clean list rather than a low bill.
6. **Yes, fix it** — it's a quick win (quadrant ①/③) *and* you're already in the file, so there's near-zero extra cost or context-switch (the boy-scout rule). If it were in a different file you weren't touching, **no** — don't make a special trip for a non-urgent cleanup; either leave it or write a quick ticket so it's tracked.

</details>

---

## Cheat Sheet

```
TRACKING — make debt durable & findable
  // TODO in a file        → NOT tracked (nobody finds it; can't prioritize/close)
  ticket in your tracker   → tracked (visible in planning, searchable, closable)
  TEST: "will someone NOT reading this line ever find it?" no → not tracked

A USEFUL DEBT TICKET = answer 5 questions
  WHAT/WHERE   specific file + function
  WHY IT HURTS the interest — the real pain, NOT "it's ugly"   ← most-skipped
  HOW BIG      rough effort ("~2h", "a risky week")
  DONE         what closing it looks like

INTEREST — the prioritization signal
  interest is charged ONLY when you touch the code
  ugly + changes OFTEN  → high interest → FIX
  ugly + changes NEVER  → ~zero interest → LEAVE (clean code here is wasted)
  find hot files: git log --since=... --name-only | sort | uniq -c | sort -rn

IMPACT × EFFORT GRID
                LOW EFFORT          HIGH EFFORT
  HIGH IMPACT   ① DO FIRST          ② PLAN IT
  LOW  IMPACT   ③ if already there  ④ DON'T
  → spend your time hunting ① ;  refuse ④ out loud

DON'T "FIX ALL THE TODOs"
  ignores interest + impact/effort, risks breaking working code, never ends
  chase a low BILL, not a clean LIST
```

---

## Summary

- **Tracking** means making debt *durable and findable*. A `// TODO` is a private note nobody finds — it is not tracking. A labelled ticket in your issue tracker is, because it's visible in planning, searchable, assignable, and closable.
- A **useful debt ticket** answers five questions: what, where, *why it hurts* (the interest — the real pain, not the ugliness), roughly how big, and what "done" means. Juniors skip "why it hurts"; it's the one that lets anyone judge whether the fix is worth funding.
- **Interest is only charged on code you touch.** The golden rule of prioritizing: *fix debt in code that changes often, leave debt in code you never change.* How ugly the code is matters far less than how often it changes — high-churn files (which `git log` can show you) are where your interest is.
- The **impact × effort grid** turns that into action: ① high-impact/low-effort quick wins are where most of your fixing time should go; ④ low-impact/high-effort cleanups are where juniors waste it. Hunt ①, refuse ④.
- **"Fix all the TODOs" is the wrong instinct** — it ignores interest and impact/effort, risks breaking working code for nothing, and never finishes. Optimize for a *low bill* (cheap-to-change hot code), not a *clean list*.

You now have the loop: spot debt → write it down durably → judge it by how often you touch it and how cheap it is to fix → knock out the quick wins where you actually work. Everything later — formal cost-of-delay scoring, the boy-scout rule, dedicated paydown budgets — is this same loop, sharpened.

---

## Further Reading

- [02 — Identifying & Quantifying](../02-identifying-and-quantifying/junior.md) — how to *find* debt and put rough numbers on it before you track it; the "hotspots = churn × complexity" idea behind "fix what you touch."
- [05 — Paying Down Debt](../05-paying-down-debt/junior.md) — once an item is prioritized, *how* you actually fix it (the boy-scout rule lives here).
- [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) — the principal-vs-interest metaphor this page turns into a decision rule.
- The [middle.md](middle.md) of this topic — formal prioritization: cost-of-delay, WSJF, and running a real debt register a team maintains.

---

## Related Topics

- [middle.md](middle.md) — cost-of-delay and WSJF scoring; debt registers as a maintained, team-owned artifact.
- [senior.md](senior.md) — making debt a funded line item: arguing paydown in money and lead-time to people who hold the budget.
- [02 — Identifying & Quantifying](../02-identifying-and-quantifying/junior.md) — the churn/complexity hotspots that feed your priority order.
- [05 — Paying Down Debt](../05-paying-down-debt/junior.md) — the techniques for actually paying off what you've prioritized.
