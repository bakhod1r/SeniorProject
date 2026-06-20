# What Is Technical Debt — Junior Level

> **Roadmap:** [Technical Debt Management](../README.md) → What Is Technical Debt
> *Every time you write "I'll clean this up later" you are borrowing time from your future self. Technical debt is the name for that loan — and like any loan, the dangerous part isn't the borrowing, it's the interest you pay until you repay it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Debt Metaphor: Principal and Interest](#core-concept-1--the-debt-metaphor-principal-and-interest)
5. [Core Concept 2 — Debt Is Not Always Bad](#core-concept-2--debt-is-not-always-bad)
6. [Core Concept 3 — Debt Is Not Bugs, and Not "Code I Dislike"](#core-concept-3--debt-is-not-bugs-and-not-code-i-dislike)
7. [Core Concept 4 — The Everyday Debt a Junior Creates](#core-concept-4--the-everyday-debt-a-junior-creates)
8. [Core Concept 5 — Why Debt Compounds](#core-concept-5--why-debt-compounds)
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

> Focus: **What is technical debt, really — and why does the metaphor matter?**

A teammate looks at a piece of code and sighs: "Ugh, technical debt." You nod, but if you're honest you're not entirely sure what they mean. Do they mean it's buggy? Ugly? Old? Written by someone who left the company? The phrase gets thrown at almost anything an engineer doesn't like, which is exactly why most people never learn what it actually is.

The term was coined by **Ward Cunningham** in 1992, and he meant something precise. **Technical debt is a shortcut you take in the code to ship something now, in exchange for extra work later.** You trade long-term cleanliness for short-term speed — just like borrowing money lets you buy something today and pay for it over time. The shortcut itself is the **principal**. The "extra work later" — every future change being a little slower and harder because of the shortcut — is the **interest**.

That financial framing is the whole point, and it's what this page teaches. Once you see debt as a *loan with interest* rather than a *synonym for bad code*, three things become clear that confuse people for years: why a deliberate shortcut to hit a deadline can be a perfectly good decision; why the real danger is debt that's never repaid; and why debt **compounds** — each shortcut quietly makes the next change harder, until a one-line feature somehow takes a week.

> **The mindset shift:** technical debt is a **financial decision**, not a synonym for "bad code." Bad code written out of carelessness or inexperience is just bad code. *Debt* is a shortcut taken with awareness, to gain something — speed, a deadline, a chance to learn — that you intend to pay back. Asking "what did we *get* for this shortcut, and what is it *costing* us now?" is the question that separates engineers who manage debt from engineers who just complain about it.

---

## Prerequisites

- **Required:** You can write a small program with functions, and you've copy-pasted a block of code at least once because it was faster than thinking of something cleaner. (Everyone has.)
- **Required:** You've gone back to code — your own or someone else's — and found it confusing or annoying to change.
- **Helpful:** You've written a `// TODO: fix this later` comment. (We'll talk about what those really are.)
- **Helpful:** You understand, roughly, what a loan and interest are — you borrow now, you pay back more over time.

No financial background is needed. If you've ever paid for something with a credit card, you already understand the core idea.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Technical debt** | A shortcut in the code, taken to move faster now, that you'll have to "pay back" later by fixing it. |
| **Principal** | The shortcut itself — the work it would take to do the thing properly. |
| **Interest** | The *extra* effort every future change costs *because* the shortcut is still there. |
| **Paying down debt** | Doing the cleanup work so the shortcut is gone and the interest stops. |
| **Compounding** | When debt makes new debt — each shortcut makes the next change harder, so more shortcuts pile up. |
| **Refactoring** | Improving the *structure* of code without changing what it does — the main way debt gets paid down. |
| **Code smell** | A surface symptom that hints debt might be hiding underneath (e.g., a function that's 400 lines long). |
| **Cruft** | Low-quality code that just *accrued* over time — often confused with debt, but it isn't the same thing. |
| **Hardcoded value** | A fixed value written directly into the code (like `0.08` for a tax rate) instead of being named or configured. |

---

## Core Concept 1 — The Debt Metaphor: Principal and Interest

Cunningham's metaphor maps onto real money almost exactly, and getting the two halves straight is the foundation for everything else.

**Principal** is the shortcut. It's the difference between the quick version you shipped and the proper version you skipped. If doing it right would have taken four extra hours, those four hours *are* the principal — the amount you "borrowed."

**Interest** is subtler and far more important: it's the *extra cost you pay on every future interaction with that code*, for as long as the shortcut lives. Not a one-time fee — a recurring tax.

Make it concrete. You're building a checkout page and you hardcode the sales tax rate directly into three different functions:

```python
# Shortcut: the tax rate is written directly into the math, in three places.
def cart_total(items):
    return sum(i.price for i in items) * 1.08   # 0.08 = tax

def line_item_total(item):
    return item.price * 1.08

def receipt_summary(items):
    subtotal = sum(i.price for i in items)
    return {"subtotal": subtotal, "total": subtotal * 1.08}
```

- **Principal:** the work you skipped — pulling the rate into one named place, like `TAX_RATE = 0.08` or a config value. Maybe twenty minutes.
- **Interest:** now imagine the tax rate changes to 8.5%. You must find and update *every* `1.08`, hope you found them all, and pray no one wrote `1.080` or `* 0.08 + price` somewhere. You pay that cost *every time* the rate changes, *every time* a new developer wonders "wait, what's this 1.08?", and *every time* someone adds a fourth place and forgets to keep it in sync. That recurring pain is the interest.

The proper version pays the principal once and the interest drops to nearly zero:

```python
TAX_RATE = 0.08   # one named source of truth — change it here, everywhere updates

def cart_total(items):
    return sum(i.price for i in items) * (1 + TAX_RATE)
```

> **Key insight:** Principal is paid **once**; interest is paid **every single time you touch the code**, forever, until you pay the principal. This is why a "small" shortcut can become enormously expensive — not because the principal is large, but because the interest never stops accruing until someone finally pays it down. Cheap debt isn't debt with a small principal; it's debt with low interest *and* a short life before repayment.

---

## Core Concept 2 — Debt Is Not Always Bad

Here is the part that surprises most juniors: **taking on technical debt can be the right decision.** Debt is a tool, not a sin. Cunningham invented the metaphor *to defend* shipping imperfect code — because, exactly like financial debt, borrowing lets you get value *now* that you couldn't otherwise afford.

Consider real situations where a deliberate shortcut is the *smart* call:

- **A real deadline with real stakes.** A demo for an investor is Friday. A cleaner architecture would take two more weeks. Shipping a slightly hacky version that *works* on Friday, with a plan to clean it up next sprint, may be exactly right — the deadline is worth more than the cleanliness, *this once*.
- **You don't yet know if the feature matters.** Why build a beautiful, fully-general system for a feature that might be deleted in a month because users hate it? Ship the rough version, learn whether anyone wants it, *then* invest in doing it properly if they do. Building it perfectly first would be spending money to polish something you might throw away.
- **Learning.** Sometimes the only way to understand the right design is to build the wrong one first and see where it hurts. The "wrong" version is a deliberate, temporary loan that buys you understanding.

The thing that makes debt *good* or *bad* is not whether you took the shortcut — it's **whether you pay it back**. Cunningham's own warning:

> *"The danger occurs when the debt is not repaid. Every minute spent on not-quite-right code counts as interest on that debt."*

Debt taken deliberately, understood clearly, and repaid promptly is just smart financing. Debt that's taken and then *forgotten* — left to accrue interest sprint after sprint, year after year — is the kind that sinks projects. The same hardcoded tax rate is a reasonable shortcut if you fix it next week and a slow disaster if it's still there (now in eight places) two years later.

> **Key insight:** The question is never "is there debt?" — every real codebase has some. The question is **"is this debt deliberate, understood, and going to be repaid?"** A shortcut with a plan is financing. A shortcut everyone forgets is a leak. Your job as you grow is not to avoid all debt — that's as impossible as never borrowing money — it's to take debt *consciously* and *track* it so it gets paid.

---

## Core Concept 3 — Debt Is Not Bugs, and Not "Code I Dislike"

Because the term gets used so loosely, you have to learn what technical debt *isn't*. Three things constantly get mislabeled as debt, and confusing them leads to bad decisions.

**Debt is not a bug.** A bug is code that produces the *wrong behavior* — a crash, a wrong total, a button that does nothing. Technical debt code produces the *right behavior*; it's just *hard to change*. The hardcoded tax example above works perfectly — it computes correct totals. It's debt because it's *fragile to change*, not because it's *broken*. You fix bugs to make the program *correct*; you pay down debt to make the program *easier to evolve*. They go in different lists and get prioritized differently.

```python
# This is a BUG — wrong behavior. Tax should be added, not subtracted.
def total(price):
    return price - (price * 0.08)   # produces the wrong number

# This is DEBT — correct behavior, hard to change. The number is right;
# the structure (a magic 0.08 buried in code) is what costs you later.
def total(price):
    return price * 1.08
```

**Debt is not "code I personally dislike."** You'll look at code and think "I would never write it this way." That's a *taste* disagreement, not debt. Maybe the author used a different but valid style; maybe they knew a constraint you don't. Real debt has a *cost you can point to* — "every time we add a payment method we have to edit five files" — not just "this offends me." If you can't name the interest, it might not be debt; it might just be unfamiliar.

**Debt is not the same as cruft.** This is the subtlest one. *Cruft* is low-quality code that simply *accumulated* — written badly out of inexperience or haste, with no conscious trade-off behind it. Cunningham was clear that a tangled mess written by someone who didn't know better isn't really "debt" in his sense, because no one deliberately *borrowed* anything. Calling careless code "technical debt" is flattering — it makes a mistake sound like a savvy financial decision. The honest framing: deliberate, understood shortcuts are *debt*; messes from not knowing better are *cruft*. Both need cleaning, but only one was a decision.

> **Key insight:** Run every "that's technical debt" claim through one test: **"What did we get for it, and what does it cost us now?"** If there was a real benefit (we shipped on time) and a nameable ongoing cost (changes are slower), it's debt. If it's a crash, it's a bug. If it's just not your style, it's taste. If it's a mess no one chose, it's cruft. Naming it correctly is the first step to handling it correctly.

---

## Core Concept 4 — The Everyday Debt a Junior Creates

You don't need to be an architect to create technical debt. Juniors create it constantly, through small, ordinary choices — and that's fine, as long as you *recognize* them. Here are the most common sources, the ones you'll produce this month.

**The quick hack.** The "just make it work" change — a special `if` to handle the one weird case, a value nudged until the test passes. It works *now*; it leaves the code a little stranger for the next person.

```python
# The quick hack: a special case bolted on to ship.
def shipping_cost(order):
    if order.customer_id == 4471:   # this one big client gets free shipping
        return 0
    return order.weight * 1.5
```

That `4471` is debt: business logic hardcoded against a specific ID, invisible to anyone reading later, and guaranteed to surprise someone when client 4471 churns or a *second* client needs the same deal.

**Copy-paste instead of a function.** You need the same logic in a second place, so you copy the block rather than extracting a function. Now the same logic lives in two spots — and when it needs to change, you have to remember to change *both* (and you won't).

```python
# Copy-pasted validation — now there are two copies to keep in sync.
def create_user(email):
    if "@" not in email or "." not in email:   # copy 1
        raise ValueError("bad email")
    ...

def update_user(email):
    if "@" not in email or "." not in email:   # copy 2 — forgot the new rule here
        raise ValueError("bad email")
    ...
```

**The skipped test.** "I'll write the test later." The code ships untested. The interest: every future change to this code is scarier and slower because nothing catches you if you break it — so people change it *timidly*, or avoid changing it at all.

**The `// TODO: clean up later`.** Be honest about what this comment is: it's an *IOU you wrote to yourself and almost certainly will not pay*. A `TODO` with no ticket, no owner, and no date is debt that's been *acknowledged but not scheduled* — which means it will quietly live in the codebase for years. The comment doesn't reduce the debt; it just documents that you knew.

```python
# TODO: this whole function is a mess, refactor before launch  (added 2 years ago)
def process(data): ...
```

**Hardcoded values.** Magic numbers and strings baked into the logic — the `1.08`, the `4471`, a file path like `/home/me/data.csv`, a URL, a retry count of `3`. Each one is a small landmine: invisible meaning, and painful to change because it's not named or centralized.

> **Key insight:** None of these make you a bad engineer — *everyone* does them, and sometimes they're the right call under pressure. The difference between a junior who's learning and one who's accumulating problems is **awareness**: knowing in the moment "this is a shortcut, this is debt" instead of believing you wrote it the right way. You can't manage debt you don't notice you're creating.

---

## Core Concept 5 — Why Debt Compounds

The most dangerous property of technical debt — and the reason small shortcuts become big crises — is that it **compounds**: each shortcut makes the *next* change harder, which makes the next shortcut more tempting, which makes the change after that harder still.

Walk through how it snowballs:

1. You hardcode the tax rate in one function. Tiny debt. Barely noticeable.
2. A teammate needs tax math elsewhere. The clean path (a shared `TAX_RATE`) doesn't exist, so the easy thing is to *copy your line*. Now it's in two places. Your shortcut *made their shortcut the path of least resistance.*
3. A third feature needs it. Same story — copy again. Three places.
4. Now the rate must change. Someone updates two of the three places and misses the third. A subtle, correct-looking bug ships. Time is lost hunting it down.
5. The codebase now has a *reputation*: "the checkout code is scary, touch it carefully." People start adding *more* special cases rather than restructuring, because restructuring the tangle feels risky. The mess deepens.

Each step's shortcut didn't just add its own cost — it **lowered the quality of the ground** the next person built on, making *their* shortcut more likely. That's compounding: debt breeding debt. The graph of "effort to add a feature" doesn't rise in a straight line; it curves upward, which is why teams describe codebases as fine "until suddenly everything took forever."

The reverse is also true, which is the hopeful part: paying down debt **compounds in your favor**. Extract that `TAX_RATE` and the next person finds the clean path *easier* than copy-pasting, so they use it, so the code stays clean. Good structure makes the *next* good choice the easy one.

> **Key insight:** Compounding is why "we'll deal with the debt later" is so dangerous: *later, there's more of it, and it's more tangled, and it's scarier to touch* — so "later" keeps getting pushed. The cheapest moment to pay any debt is almost always **now**, while it's small and you still remember why it's there. The interest rate on ignored debt only goes up.

---

## Real-World Examples

**1. The hardcoded discount that became a six-hour bug hunt.** A junior ships a Black Friday sale by writing `price * 0.8` (20% off) directly into the cart code — a reasonable shortcut for a one-day event. The sale "ends" but the line is never removed; six months later it's been copy-pasted into the mobile checkout and the email receipt generator. Marketing launches a *new* 15% sale through the proper config system, but customers still see 20% off in the app because of the forgotten hardcoded `0.8`. The fix is one line; *finding* all three copies and proving they're the cause takes most of a day. Principal: five minutes. Interest paid: a day of debugging plus refunded orders.

**2. The skipped test that froze a feature.** A payment-retry function ships without tests because the deadline was tight — a deliberate, defensible shortcut. A year later it needs a small change, but *no one will touch it*: there are no tests, it handles money, and breaking it means failed charges. The team routes *around* it instead, bolting on a second, parallel retry path. Now there are two retry systems, neither fully understood. The skipped test didn't just cost a test — it made the code *un-changeable*, which spawned a whole second pile of debt.

**3. The deliberate debt that was actually smart.** A startup needs to prove investors will fund them. They hardcode support for exactly one payment provider, skip multi-currency, and write a blunt, inflexible checkout — fast and ugly *on purpose*. They get the funding. *Then*, with money and validated demand, they spend two sprints replacing the hacks with a proper payment abstraction. This is debt done *right*: a conscious loan, taken to buy something real (survival), repaid promptly once the bet paid off. The same hacks left in place for three years would have been a different story.

---

## Mental Models

- **Debt = a loan; interest = a recurring tax.** You borrow time to ship now (principal) and pay a tax on every future change until you repay it (interest). A small loan with a high recurring tax, left unpaid, dwarfs a large loan you settle quickly.

- **A `// TODO: clean up later` is an unpaid IOU.** It's you, writing a promissory note to your future self, that you will almost certainly default on. Acknowledging debt in a comment doesn't pay it — only a ticket with an owner and a date moves it from "forgotten" toward "repaid."

- **Compounding debt is a snowball rolling downhill.** Each shortcut adds a little mass *and* smooths the path for the next one. Left alone it grows faster than linearly; that's why codebases feel "fine, fine, fine, suddenly unworkable."

- **Bug vs debt = wrong vs rigid.** A bug gives the *wrong answer* (fix it to be correct). Debt gives the *right answer but resists change* (pay it down to stay flexible). Two different problems, two different lists.

- **Cruft vs debt = accident vs decision.** Cruft is a mess that *accumulated*; debt is a shortcut someone *chose*. Calling careless code "debt" is flattery — it dresses up a mistake as a savvy trade. Be honest about which one you're looking at.

---

## Common Mistakes

1. **Calling every piece of code you dislike "technical debt."** If you can't name the *interest* — the concrete, recurring cost of changing it — it's probably taste, not debt. Debt has a price tag you can point to.

2. **Confusing debt with bugs.** A crash is a bug (wrong behavior); a working-but-rigid design is debt (hard to change). They belong in different lists and get prioritized by different rules. Mixing them muddies both.

3. **Believing all debt is bad and must be avoided.** Every real project carries debt, and *some of it is the right call*. The goal is conscious, repaid debt — not zero debt, which is as unrealistic as never borrowing money.

4. **Taking on debt *unconsciously*.** The problem isn't the shortcut — it's not *noticing* it's a shortcut. Debt you don't realize you created can't be tracked, and untracked debt is the kind that's never repaid.

5. **Trusting `// TODO: fix later` to actually get it fixed.** A bare TODO is a note, not a plan. Without a ticket, an owner, and a date, it's debt you've merely *documented*, and it'll outlive everyone who could explain it.

6. **Forgetting that debt compounds.** "We'll clean it up later" ignores that *later there's more of it and it's more tangled*. The cheapest time to pay a debt is usually now, while it's small and you still remember why it exists.

7. **Letting one shortcut justify the next.** "The code's already messy, so a little more mess won't hurt" is exactly how compounding wins. Each clean choice you make is also clearing the path for the next person — that's the broken-windows effect in reverse.

---

## Test Yourself

1. In your own words, what is the difference between the **principal** and the **interest** of a technical debt? Which one do you pay repeatedly?
2. Your code computes the correct shipping cost, but the rate `1.5` is hardcoded in four functions. Is this a **bug** or **debt**? Why?
3. Give one realistic situation where deliberately taking on technical debt is the *right* decision. What makes it right rather than reckless?
4. A teammate points at some working code and says "that's technical debt." What single question should you ask to check whether they're right?
5. Explain why copy-pasting a block of logic (instead of writing a shared function) tends to *compound* into more debt over time.
6. What's the honest difference between **technical debt** and **cruft**?

<details>
<summary>Answers</summary>

1. The **principal** is the shortcut itself — the work it would take to do the thing properly, paid *once*. The **interest** is the *extra* effort every future change costs because the shortcut is still there, paid *every single time you touch the code*. You pay the interest repeatedly; that's why even a tiny principal can become expensive if it's never repaid.
2. **Debt.** The code produces the *correct* result, so it isn't a bug — it's just *hard to change* (changing the rate means finding and editing four places and hoping you got them all). Bugs are about wrong behavior; debt is about rigidity.
3. Any reasonable example: shipping a hacky-but-working feature to hit an investor demo on Friday; building a rough version of a feature you're not sure users even want, to learn before investing more. What makes it *right* is that the debt is **deliberate, understood, and going to be repaid** — there's a real benefit and a plan to clean it up. It's *reckless* when it's taken carelessly and then forgotten.
4. **"What did we get for it, and what does it cost us now?"** If there was a real benefit and you can name an ongoing cost (changes are slower/riskier), it's debt. If you can't name the cost, it might just be code they don't like (taste), or it might be a bug (wrong behavior), or cruft (a mess no one chose).
5. Copy-pasting means the same logic now lives in multiple places that must be kept in sync. The next person who needs that logic finds copy-pasting *easier* than extracting a shared function (because the clean path still doesn't exist), so they copy it again. Each copy makes the next copy more likely and every change riskier — debt breeding more debt.
6. **Debt** is a shortcut someone *deliberately chose* for a benefit, intending to repay it — a financial decision. **Cruft** is low-quality code that simply *accumulated* out of haste or inexperience, with no conscious trade-off behind it. Both need cleaning, but only debt was actually a *decision*; calling cruft "debt" flatters a mistake into sounding like savvy financing.

</details>

---

## Cheat Sheet

```
THE METAPHOR
  technical debt = a shortcut taken to ship NOW, paid back LATER
  principal      = the shortcut itself (work skipped) — paid ONCE
  interest       = extra cost on EVERY future change — paid until you repay

IS IT DEBT? — run the test: "What did we get, what does it cost now?"
  wrong behavior (crash, wrong total)      → BUG    (fix to be correct)
  right behavior but hard to change        → DEBT   (pay down to stay flexible)
  "I just don't like this style"           → TASTE  (not debt)
  a mess nobody deliberately chose         → CRUFT  (clean, but it wasn't a "loan")

DEBT IS NOT ALWAYS BAD
  deliberate + understood + repaid soon    → GOOD financing
  taken carelessly OR never repaid         → DANGER (interest forever)
  goal is not zero debt — it's CONSCIOUS, TRACKED, REPAID debt

EVERYDAY SOURCES (the ones you create)
  the quick hack         if customer_id == 4471: ...
  copy-paste vs function same logic in 2+ places, drift apart
  the skipped test       "I'll test it later" → code becomes un-changeable
  // TODO: clean up later an IOU you'll probably never pay
  hardcoded values       1.08, 4471, "/home/me/data.csv", retries=3

WHY IT COMPOUNDS
  each shortcut makes the next change harder
  → makes the next shortcut more tempting
  → debt breeds debt; effort curves UP, not straight
  cheapest time to pay any debt = NOW (smallest, freshest)
```

---

## Summary

- **Technical debt is a shortcut taken to ship now, paid back later** — a financial decision, not a synonym for bad code. The **principal** is the shortcut itself (paid once); the **interest** is the extra cost on every future change (paid until you repay the principal).
- **Debt is not always bad.** A deliberate, understood shortcut to hit a real deadline or to learn cheaply can be the *right* call. The danger is never the borrowing — it's debt that's taken and then *forgotten*, accruing interest forever.
- **Debt is not bugs** (wrong behavior — fix to be correct), **not "code I dislike"** (taste — no nameable cost), and **not cruft** (a mess that accumulated, not a shortcut anyone chose). Run every claim through "what did we get, what does it cost now?"
- **Juniors create debt daily** through quick hacks, copy-paste instead of functions, skipped tests, `// TODO: clean up later`, and hardcoded values. That's normal — the skill is *noticing* you're doing it, because you can't manage debt you don't see.
- **Debt compounds:** each shortcut makes the next change harder and the next shortcut more tempting, so codebases feel "fine, fine, suddenly unworkable." The cheapest time to pay a debt is almost always *now*, while it's small and you still remember why it exists.

You now have the metaphor done right. The rest of this roadmap builds on it: how to **make debt visible and measure it**, how to **classify** it so you respond to each kind correctly, and how to **decide what to pay down and when** — turning "this code is gross" into "this debt costs us X, and here's the plan."

---

## Further Reading

- **Ward Cunningham — "Debt Metaphor" (2009, ~5-min video)** — the inventor of the term explaining, in plain words, what he *did* and *didn't* mean. The single best five minutes on this topic.
- **Martin Fowler — "TechnicalDebt"** (martinfowler.com) — a short, clear essay; the natural next step once the basics here click.
- **Steve McConnell — "Technical Debt" (2007 blog post / talk)** — an early, practical taxonomy that distinguishes intentional from unintentional debt.
- The [middle.md](middle.md) of this topic, which sharpens the definition, separates the *types* of debt, and connects the metaphor to how teams actually decide.

---

## Related Topics

- [middle.md](middle.md) — the same topic, deeper: types of debt, intentional vs unintentional, and how the metaphor drives real decisions.
- [senior.md](senior.md) — debt as an economic and architectural force you steer across a whole system.
- [02 — Identifying & Quantifying](../02-identifying-and-quantifying/junior.md) — once you know *what* debt is, how to *find* it and put a number on it.
- [03 — The Debt Quadrant](../03-the-debt-quadrant/junior.md) — sorting debt into kinds (deliberate vs accidental, prudent vs reckless) so you respond to each correctly.
- [05 — Paying Down Debt](../05-paying-down-debt/junior.md) — the practical playbook for actually repaying what you owe.
- [Refactoring](../../../code-craft/refactoring/) — the *how* of paying down debt: improving structure without changing behavior.
- [Code Smells](../../../code-craft/refactoring/01-code-smells/) — the surface symptoms that hint debt is hiding underneath.
