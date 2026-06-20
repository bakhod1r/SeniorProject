# Identifying & Quantifying — Junior Level

> **Roadmap:** [Technical Debt Management](../README.md) → Identifying & Quantifying
> *You can't manage debt you can't see. Before you argue about paying it down, you have to find it — and the signs are hiding in plain sight, in the parts of the codebase everyone already complains about.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Everyday Signs of Debt](#core-concept-1--the-everyday-signs-of-debt)
5. [Core Concept 2 — Make It Visible](#core-concept-2--make-it-visible)
6. [Core Concept 3 — Hotspots: Where Debt Actually Hurts](#core-concept-3--hotspots-where-debt-actually-hurts)
7. [Core Concept 4 — Simple Signals Anyone Can Read](#core-concept-4--simple-signals-anyone-can-read)
8. [Core Concept 5 — "No Tests" Is Debt You Can Feel](#core-concept-5--no-tests-is-debt-you-can-feel)
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

> Focus: **How do you even find technical debt?**

Everyone on a team can *feel* technical debt. The change that should have taken an hour took three days. The same file breaks every other sprint. There's a corner of the code nobody will touch without a senior engineer holding their hand. That feeling is real — but a feeling is not something you can plan around, schedule, or argue for fixing.

This page is about turning that feeling into something concrete. You don't need fancy tools or a metrics dashboard to start. You need to learn the **everyday signs** that debt is present, and then do the one discipline that separates teams who manage debt from teams who just suffer it: **write it down where everyone can see it.**

There's a common trap junior engineers fall into. They notice the code is bad, they sigh, they work around it, and they keep that knowledge in their own head. Six months later they leave, and all that hard-won knowledge — *"don't touch `BillingService`, the refund logic is wrong and three places depend on the bug"* — walks out the door with them. Debt that lives only in your head is invisible to the team, and **invisible debt cannot be managed.** Nobody can prioritize it, fund it, or even avoid stepping on it.

This page teaches you the signals to look for, and the first habit that makes all the later, fancier work possible: making debt visible.

> **The mindset shift:** stop treating "this code is bad" as a private annoyance you silently route around. Start treating it as *information* — a fact about the system that the whole team needs, written down somewhere they'll see it. Naming the debt is the first and most important step in managing it.

---

## Prerequisites

- **Required:** You've written code in a real project with more than a handful of files — enough to have hit something confusing or scary.
- **Required:** You understand what a function, a file, and a parameter are.
- **Helpful:** You've read [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) and know debt is a *trade-off*, not just "code I don't like."
- **Helpful:** You've used `git` (even just `git log` and `git blame`) — we'll lean on your project's history to find debt.
- **Helpful:** You've experienced the specific frustration of "this small change is taking *forever*." That frustration is a sensor; this page calibrates it.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Technical debt** | The gap between the code you have and the code the problem now needs. Slows you down like interest on a loan. |
| **Code smell** | A surface symptom that hints at a deeper problem (a giant file, a function that does ten things). Not a bug — a warning sign. |
| **Hotspot** | A file you change *often* **and** that is *complicated*. Where debt hurts most because you keep paying the cost. |
| **Churn** | How often a file changes — measured from your git history (number of commits touching it). |
| **Complexity** | Roughly, how hard a piece of code is to follow — how many branches, nested conditions, and moving parts it has. |
| **TODO / FIXME** | Comments developers leave to mark "this isn't finished / this is wrong." A literal, in-code record of known debt. |
| **Debt register** | A simple, shared list of known debt items — a ticket label, a wiki page, a backlog tag. Where invisible debt becomes visible. |
| **"Here be dragons"** | A file or module everyone is afraid to touch because changing it tends to break things in surprising ways. |
| **Duplication** | The same logic copy-pasted in multiple places. Fix a bug in one copy, the other copies stay broken. |

---

## Core Concept 1 — The Everyday Signs of Debt

You will almost never find debt by *deciding* to go looking for it on a quiet afternoon. You find it by noticing the friction in your normal work. Train yourself to treat these everyday experiences as **signals**, not just bad luck:

**A small change takes way longer than it should.** You're asked to add one field to a form. It should be 20 minutes. Instead you spend a day because the form logic is tangled with validation, the validation is copy-pasted in three controllers, and changing one breaks the other two. That gap — *expected effort vs actual effort* — is the single most reliable sign of debt. The work was hard not because the *problem* was hard, but because the *code* made it hard.

**The same area keeps breaking.** Every release, a bug shows up in the same module. The team fixes it, it comes back in a slightly different shape next month. Code that produces repeated bugs is telling you its design can't comfortably hold the behavior you keep asking of it.

**Files everyone is scared to touch — "here be dragons."** On old maps, cartographers drew sea monsters over regions they hadn't explored. Every codebase has these regions: the file where, when a ticket lands in it, people quietly hope someone *else* picks it up. That fear is data. It usually means the code is hard to understand, has no tests to catch mistakes, and has surprising connections to other parts of the system.

**Piles of `// TODO` and `// FIXME`.** These are debt *the team already knew about and wrote down in the code* — and then forgot. A `// FIXME: this breaks for negative amounts` is a known defect sitting in the source, invisible to anyone not reading that exact line.

**Lots of copy-paste.** When you go to change behavior and realize the same chunk of logic exists in five places, you've found duplication. The danger isn't the typing — it's that the five copies *drift apart*. You fix a bug in one, miss the other four, and now they behave differently.

> **Key insight:** Debt announces itself through *friction during normal work*, not through a special audit. The most valuable debt-detector you own is the thought *"why is this taking so long?"* — that question, asked honestly, points straight at the debt. Don't suppress it. Follow it.

Here's a concrete one. You're adding a discount to checkout, and you find this:

```python
# in checkout.py
price = item.base_price
if user.is_premium:
    price = price * 0.9
price = price + price * 0.08   # tax

# in cart_summary.py  (copy-pasted, slightly different)
price = item.base_price
if user.is_premium:
    price = price * 0.9
# ...someone forgot the tax line here
```

The pricing rule lives in two places and they've already drifted — one applies tax, one doesn't. That's not a hypothetical. That's a bug waiting for a customer to find it, and you found it by *noticing the copy-paste*.

---

## Core Concept 2 — Make It Visible

This is the most important habit on this entire page, and it's the one juniors skip most often.

When you find debt, **write it down somewhere the team can see it.** Not in your head. Not in a private note. Somewhere shared.

Why does this matter so much? Because debt you keep in your head:

- **Can't be prioritized.** A team can only weigh and schedule problems it knows about. Your private knowledge is worth nothing to next sprint's planning.
- **Disappears when you do.** When you switch teams or leave, the knowledge leaves with you. The next person rediscovers every dragon the hard way.
- **Gets stepped on repeatedly.** If only you know `parseDate` mishandles timezones, every teammate who touches it will hit the same trap, one by one.

Making debt visible doesn't require a process or a tool. The cheapest version is genuinely good enough to start:

- **A ticket with a label.** File an issue in your tracker, tag it `tech-debt`. Now it's in the same place as everything else the team plans.
- **A comment that points somewhere durable.** A `// TODO` is better than nothing, but a bare `// TODO: fix this` rots. Link it to a ticket: `// TODO(#1423): pricing duplicated with cart_summary.py`. Now the comment and the tracked item reference each other.
- **A "Known Debt" page.** A single wiki/Markdown doc the team keeps, listing the big dragons in plain language: *what's wrong, why it hurts, how bad it is.*

A good written debt item answers three questions a teammate (or future you) will have:

1. **What** is wrong? ("Pricing logic is duplicated in `checkout.py` and `cart_summary.py`.")
2. **Why** does it hurt? ("They've already drifted — cart total omits tax. Any price change risks them disagreeing.")
3. **How bad / how often?** ("We touch checkout most sprints, so we keep paying this. Customer-facing money bug risk.")

```
TECH DEBT: Duplicated pricing logic
  What:  base price → premium discount → tax computed in 2 files
  Where: checkout.py, cart_summary.py
  Hurts: copies have already drifted (cart omits tax). Money bug risk.
  Often: checkout changes ~every sprint → we pay this repeatedly.
```

That's it. Four lines. But now it's *real* — it can be discussed, estimated, prioritized, and assigned. It exists outside your skull.

> **Key insight:** "Make it visible" is not bureaucracy — it's the act that converts a vague feeling into a manageable item. Every later skill in this roadmap (prioritizing in [04](../04-tracking-and-prioritizing/junior.md), paying down in [05](../05-paying-down-debt/junior.md)) *assumes the debt is already written down*. You can't prioritize an empty list. Visibility is the prerequisite for all of it.

---

## Core Concept 3 — Hotspots: Where Debt Actually Hurts

Here's a liberating truth: **not all bad code is worth worrying about.**

A messy file you *never touch* costs you almost nothing. It just sits there. Yes, it's ugly, but ugly-and-untouched doesn't slow anyone down. Meanwhile, a moderately messy file you edit *every single week* taxes the whole team constantly. Same "badness," wildly different cost.

This is the idea of a **hotspot**: the place where two things overlap —

1. **You change it often** (high churn), **and**
2. **It's complicated** (hard to understand and modify).

Code that is complex *and* frequently changed is where debt hurts most, because you keep paying the "this is hard to work in" tax over and over. A complex file nobody edits is a sleeping dragon — leave it sleeping. A complex file everybody edits is a dragon you poke daily.

You can spot churn with a tool you already have — `git`:

```bash
# Which files have changed most often? (most-churned at the bottom)
git log --pretty=format: --name-only | sort | uniq -c | sort -n
```

The files at the top of that count are your high-churn files. Now cross-reference: which of *those* are also the big, scary, complicated ones? That overlap is your hotspot list — and it's where your debt-fixing effort buys the most relief.

```
        complexity
          high │  sleeping dragon   │   🔥 HOTSPOT 🔥
               │  (messy, rarely    │   (messy AND touched
               │   touched —        │    constantly — fix
               │   leave it)        │    THIS first)
          ─────┼────────────────────┼──────────────────
           low │  fine              │   simple & busy
               │  (clean, ignored)  │   (clean, touched a lot
               │                    │    — already healthy)
               └────────────────────┴──────────────────
                    low churn            high churn
```

> **Key insight:** "Worst code" is the wrong target. **"Worst code that we keep touching"** is the right target. Churn × complexity tells you where your fixing effort converts into the most saved time. A junior who fixes a beautiful corner nobody visits feels productive and changes nothing; a junior who untangles the file the team edits weekly is a hero. Aim at hotspots.

(The grown-up version of this — measuring complexity precisely, scoring hotspots, putting numbers on remediation cost — is the [middle.md](middle.md) of this topic. For now, "big and scary *and* edited a lot" is a perfectly good eyeball test.)

---

## Core Concept 4 — Simple Signals Anyone Can Read

You don't need to measure anything formally to spot likely debt. Some signals are visible to the naked eye in thirty seconds. These are **code smells** — surface symptoms that *hint* at a deeper problem. A smell isn't proof of debt (sometimes a long function is genuinely fine), but it's a flag worth a second look. The most beginner-friendly ones:

**A giant file.** A single file with 2,000 lines is almost always doing too many jobs. When everything lives in one place, every change risks touching unrelated things, and nobody can hold the whole file in their head. Length isn't *bad* by itself, but it's a strong hint that responsibilities are tangled together.

**A function that does ten things.** A well-named function does *one* thing its name promises. When you read a function and it loads data, *and* validates it, *and* formats it, *and* emails someone, *and* writes a log, *and* updates a cache — its name can't possibly be honest, and you can't change one behavior without risking the others.

```python
# A function whose name is a lie — it does far more than "save"
def save_user(user):
    if not user.email:                 # validating
        raise ValueError("no email")
    user.email = user.email.lower()    # transforming
    db.insert(user)                    # saving
    send_welcome_email(user)           # emailing
    analytics.track("signup", user)    # analytics
    cache.invalidate("users")          # cache
    # ...what happens if the email send fails after the insert?
```

You can't reuse the "save" without also emailing. You can't test validation without a database. That's the smell.

**A function with eight parameters.** When a function needs a long list of arguments, it's usually a sign that it's juggling too many concerns, or that those arguments really belong grouped into one object. Long parameter lists are also error-prone — callers pass things in the wrong order, especially when several are the same type.

```python
def create_order(user_id, item_id, qty, price, discount,
                 tax, shipping, gift_wrap, note):  # 9 params
    ...
# the caller — which boolean is which? easy to swap by accident
create_order(7, 42, 2, 19.99, 0.0, 1.60, 5.00, True, "")
```

> **Key insight:** Code smells are *hints, not verdicts*. A 300-line file or a 6-parameter function might be perfectly reasonable. The skill isn't to ban them — it's to let them **trigger a second look**. When you see a smell *in a hotspot* (Concept 3), that's the combination that almost always means real, costly debt worth writing down.

These three — giant files, functions that do ten things, functions with too many parameters — are the easiest signals to teach a brand-new engineer to recognize. They're the front door to the wider catalog at [Code Smells](../../../code-craft/refactoring/01-code-smells/), which names dozens more.

---

## Core Concept 5 — "No Tests" Is Debt You Can Feel

There's one kind of debt so important and so beginner-visible it deserves its own concept: **the absence of tests.**

When a piece of code has no automated tests, you can't change it *safely*. Every edit is a gamble. Did you break something? You don't know — there's nothing to tell you except a user, in production, later. So what do people do with untested code? They avoid touching it. They tiptoe. They copy-paste a new variant rather than modify the existing one (because modifying is too scary), which creates *more* duplication, which creates *more* debt. The lack of tests doesn't just sit there — it actively breeds more debt around itself.

This is exactly why "files everyone is scared to touch" and "no tests" so often describe the *same* file. The fear *is* the missing safety net. A file with good tests isn't scary, even if it's complex — you can change it and the tests will catch your mistakes. A file with no tests is scary even if it's simple, because nothing has your back.

So when you're hunting for debt, ask of any risky area: **"If I change this, what tells me I broke it?"** If the honest answer is "nothing — I'd just have to be careful," you've found a real, costly form of debt, and it's worth writing down like any other.

> **Key insight:** Missing tests are debt with *compounding interest*. Untested code is hard to change safely, so people avoid it, so it rots, so it gets even harder to change. Of all the signals on this page, "no tests on code we need to change" is one of the highest-value items to make visible — because it explains *why* a hotspot is a hotspot.

---

## Real-World Examples

**1. The form field that took a day.** A junior is asked to add a "company name" field to the signup form — a half-hour job, surely. Instead it takes a full day: the form's validation is copy-pasted across three controllers, each slightly different, and adding the field to one broke the other two in subtle ways. The lesson wasn't "I'm slow." It was: *the expected-vs-actual effort gap is the signal.* They wrote a four-line debt item — "signup validation duplicated across 3 controllers, drifting" — and for the first time the team could see and plan the cleanup instead of everyone independently re-discovering it.

**2. The dragon nobody named.** Every new engineer on a team eventually got the same hallway warning: *"don't touch `PaymentProcessor` without asking Sara."* That warning lived entirely in people's heads and in Slack. When Sara went on leave, a routine change to payments became a week-long crisis because nobody else understood the file and it had no tests. The fix afterward was almost embarrassingly simple: they wrote a "Known Debt" page documenting *what* made `PaymentProcessor` dangerous and added it to the backlog. The dragon was still there — but now it was *named*, and the next person didn't walk in blind.

**3. The hotspot you find with `git log`.** A team felt vaguely that "the codebase is messy" but didn't know where to start. A junior ran `git log --name-only | sort | uniq -c | sort -n` and found that one file — `OrderService.java` — accounted for a startling share of all commits *and* was the longest file in the repo. That single overlap (high churn + high complexity) told them exactly where to aim. They'd been arguing about cleaning up beautiful, untouched corners; the data pointed at the one file the whole team actually fought with every week.

---

## Mental Models

- **Debt is interest you pay on every visit.** Like a loan, debt charges you a little *each time you work in that code*. That's why a hotspot (a place you visit constantly) is so expensive, and a sleeping dragon (a place you never visit) is nearly free. Count the visits, not just the mess.

- **Friction is a sensor, not bad luck.** The thought "why is this taking *forever*?" is your built-in debt detector going off. Most people dismiss it ("guess it's a hard task"). The skill is to *trust the sensor* and ask what about the *code* — not the problem — made it slow.

- **Debt in your head is a single point of failure.** Knowledge that lives only in one person is one resignation, one vacation, one bad day away from being lost. Writing it down isn't paperwork — it's *backing up the team's brain*.

- **Smells are smoke; hotspots tell you which fire to fight.** A code smell says "something might be burning here." Churn × complexity tells you "*this* fire is the one in the room you live in." Smoke alone doesn't earn a fix; smoke in a hotspot does.

- **"Here be dragons" is a missing map, usually a missing test.** The fear of a file is almost always the fear of changing it without a safety net. Add the net (tests), and the dragon shrinks to a lizard.

---

## Common Mistakes

1. **Keeping debt in your head.** The number-one junior mistake: you notice the problem, you work around it, you tell no one and write nothing down. Invisible debt can't be managed by anyone, including future-you. *Always* leave a durable, shared record.

2. **Calling all bad code "debt" and trying to fix it all.** A messy file you never touch costs almost nothing. Spreading your effort across every ugly corner — instead of the hotspots you actually work in — feels productive and changes nothing. Aim at churn × complexity.

3. **Treating a smell as a verdict.** A 400-line file or a 6-parameter function isn't *automatically* debt. Smells are hints that earn a second look, not crimes that demand an immediate rewrite. Confirm the cost (do we touch it? does it break? is it tested?) before acting.

4. **Leaving bare `// TODO`s and calling it visibility.** A `// TODO: fix later` with no ticket and no detail rots into noise — codebases accumulate thousands that everyone ignores. If it matters, link it to a tracked item: `// TODO(#1423): ...`. Otherwise you've recorded the debt somewhere no one looks.

5. **Ignoring "no tests" as a form of debt.** People log missing *features* and obvious *bugs* but forget that "we can't change this safely" is itself a costly debt — and the very thing that makes a file a dragon. If changing some code has nothing to catch your mistakes, that's a debt item worth writing down.

6. **Confusing "I find this hard" with "this code is bad."** Sometimes the code is fine and you're still learning the domain. Before logging debt, sanity-check: would a *teammate* also find this unreasonably hard? Debt is about the code making things harder than the *problem* warrants — not about your current familiarity.

---

## Test Yourself

1. You're asked to make a "one-line" change and it takes you two days because the logic is tangled. What signal is this, and what should you do *besides* finishing the change?
2. Why is debt that lives only in your head worse than debt written in a shared ticket — give two concrete reasons.
3. Define a **hotspot** in your own words. Why is a complex file nobody edits *not* a priority?
4. Name the three beginner-friendly code smells from this page. For each, say in one phrase what deeper problem it hints at.
5. A file has no automated tests. Explain how that single fact can *create more debt* over time.
6. Your teammate says "this 500-line file is technical debt, let's rewrite it." What two questions should you ask before agreeing?

<details>
<summary>Answers</summary>

1. It's the **expected-vs-actual effort gap** — the most reliable everyday sign of debt. Besides finishing the change, **write the debt down** somewhere shared (a ticket tagged `tech-debt`, or a line on the team's Known Debt page) describing what's tangled, where, and why it hurt.
2. (a) **It can't be prioritized** — the team can only plan problems it knows about, so your private knowledge contributes nothing to planning. (b) **It disappears when you do** — when you change teams or leave, the knowledge leaves too, and the next person rediscovers every trap the hard way. (Also acceptable: teammates keep stepping on the same trap one by one.)
3. A hotspot is code that is **both frequently changed (high churn) and complex (hard to understand)** — the overlap is where debt hurts most because you pay the cost on every visit. A complex file nobody edits isn't a priority because you never pay its cost — it just sits there; "ugly but untouched" slows no one down.
4. **Giant file** → too many responsibilities tangled in one place. **Function that does ten things** → its name can't be honest and you can't change one behavior without risking others. **Function with eight parameters** → it's juggling too many concerns and is error-prone for callers (wrong order, swapped args).
5. With no tests, you **can't change the code safely**, so people avoid touching it and instead **copy-paste new variants** rather than modify the original — creating *more* duplication and *more* debt. The missing test doesn't just sit there; it actively breeds debt around itself (compounding interest).
6. **(a) Do we actually touch this file?** (Is it a hotspot, or a sleeping dragon we can leave alone?) **(b) Does it cause real problems** — repeated bugs, slow changes, no tests? Length alone (500 lines) is a *smell*, not proof; confirm the cost before committing to a rewrite. (Also good: "could we improve it incrementally instead of a risky full rewrite?")

</details>

---

## Cheat Sheet

```
EVERYDAY SIGNS OF DEBT (notice the friction in normal work)
  small change takes way too long   → expected vs actual gap (the #1 sign)
  same area keeps breaking          → design can't hold the behavior
  "here be dragons" file            → scary to touch = usually no tests + tangled
  piles of // TODO / // FIXME       → debt the team wrote down and forgot
  lots of copy-paste                → copies drift → fix one, miss the rest
  no tests on code you must change   → can't change safely = compounding debt

THE FIRST DISCIPLINE: MAKE IT VISIBLE
  in your head        → useless to the team, lost when you leave
  shared & written    → can be prioritized, funded, avoided
  cheapest forms: ticket tagged `tech-debt`  |  // TODO(#1423): ...  |  Known-Debt page
  a good debt note answers:  WHAT is wrong · WHY it hurts · HOW bad / how often

HOTSPOTS = where debt actually hurts
  hotspot = HIGH CHURN  ×  HIGH COMPLEXITY  (touched often AND complicated)
  find churn:  git log --pretty=format: --name-only | sort | uniq -c | sort -n
  complex + never touched = sleeping dragon → LEAVE IT
  complex + touched weekly = 🔥 fix THIS first

SIMPLE SMELLS ANYONE CAN READ (hints, not verdicts)
  giant file (2000 lines)        → too many jobs in one place
  function does 10 things        → name is a lie; can't change one safely
  function with 8 parameters     → too many concerns; callers swap args

RULE OF THUMB
  worst code            = wrong target
  worst code we TOUCH   = right target   (smell + hotspot = real, costly debt)
```

---

## Summary

- Technical debt announces itself through **friction in everyday work**, not a special audit. The clearest sign is the **expected-vs-actual effort gap**: a "simple" change that takes far longer than the *problem* warrants. Other signs — repeated breakage in one area, files everyone fears ("here be dragons"), piles of `// TODO`/`// FIXME`, copy-paste, and missing tests.
- The first and most important discipline is to **make debt visible**: write it down somewhere shared (a tagged ticket, a linked `// TODO(#123)`, a Known-Debt page). Debt in your head can't be prioritized, funded, or avoided, and it vanishes when you do. A good note says *what* is wrong, *why* it hurts, and *how bad / how often*.
- Not all bad code matters. **Hotspots** — code that is *both* changed often (churn) *and* complex — are where debt actually hurts, because you pay the cost on every visit. A complex file nobody edits is a sleeping dragon; leave it. Find churn with a one-line `git log`.
- Some debt is visible in thirty seconds via **code smells**: giant files, functions that do ten things, functions with too many parameters. Smells are *hints, not verdicts* — they earn a second look, and they're most trustworthy when they appear *inside a hotspot*.
- **Missing tests** are a special, high-value form of debt: you can't change untested code safely, so people avoid it and copy-paste instead, breeding *more* debt. "No tests on code we need to change" is one of the best items to make visible.

You now have the eye and the habit: notice the friction, confirm it's a hotspot, and *write it down*. Everything later in this roadmap — putting numbers on debt ([middle.md](middle.md)), classifying it ([03 — The Debt Quadrant](../03-the-debt-quadrant/junior.md)), prioritizing and paying it down — depends on this one foundation: **the debt has to be visible before anyone can manage it.**

---

## Further Reading

- [middle.md](middle.md) of this topic — how to *quantify* what you've found: measuring complexity, scoring hotspots with churn × complexity, and putting a cost (remediation time, SQALE) on debt.
- [senior.md](senior.md) of this topic — translating debt into money and lead-time, and arguing for paydown in language leadership funds.
- Adam Tornhill, *Your Code as a Crime Scene* — the most approachable book on finding hotspots from version-control history. The whole "churn × complexity" idea, explained for engineers.
- Martin Fowler, ["Technical Debt"](https://martinfowler.com/bliki/TechnicalDebt.html) — a short, foundational essay; read it to keep the metaphor honest.
- [Code Smells](../../../code-craft/refactoring/01-code-smells/) — the fuller catalog of the surface symptoms introduced here, with dozens more named and explained.

---

## Related Topics

- [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) — the metaphor done right; *what* debt is before you go finding it.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/junior.md) — once debt is visible, *which* of it to act on first (this page is its prerequisite).
- [05 — Paying Down Debt](../05-paying-down-debt/junior.md) — what to actually *do* about the debt you've found and written down.
- [Code Smells](../../../code-craft/refactoring/01-code-smells/) — the catalog of surface signals; the front door to recognizing debt by sight.
- [Refactoring](../../../code-craft/refactoring/) — the *how* of safely cleaning up the debt you identify here.
