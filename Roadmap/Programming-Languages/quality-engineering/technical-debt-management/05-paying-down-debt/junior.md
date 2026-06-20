# Paying Down Debt — Junior Level

> **Roadmap:** [Technical Debt Management](../README.md) → Paying Down Debt
> *Nobody clears a credit card by waiting for the magical month they pay it all off at once. They pay a little, every month, on the balance they already carry. Code debt works the same way — and the everyday version is far more powerful than any heroic cleanup.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Boy Scout Rule](#core-concept-1--the-boy-scout-rule)
5. [Core Concept 2 — Test Before You Change](#core-concept-2--test-before-you-change)
6. [Core Concept 3 — Refactor in Tiny Steps](#core-concept-3--refactor-in-tiny-steps)
7. [Core Concept 4 — Fix on Touch, Not on Schedule](#core-concept-4--fix-on-touch-not-on-schedule)
8. [Core Concept 5 — When NOT to Pay Debt Down](#core-concept-5--when-not-to-pay-debt-down)
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

> Focus: **How do you actually reduce debt — safely, and without grand gestures?**

You've learned what technical debt *is* ([01](../01-what-is-technical-debt/junior.md)) and maybe seen how teams *track* which debt to attack first ([04](../04-tracking-and-prioritizing/junior.md)). This page is about the part you'll do every single day: **the act of paying it down.**

Here's the trap most juniors fall into. You open a file, it's a mess, and you think: *"This whole thing needs to be rewritten. I'll set aside next sprint and fix it properly."* That sprint never comes. The mess stays. Six months later it's worse, and now *you're* the person who "didn't have time to fix it."

The engineers who actually keep a codebase healthy don't work that way. They pay debt down in tiny amounts, continuously, in the code they were *already* touching for another reason. A function rename here. One extracted helper there. A duplicated block collapsed into one. None of it is heroic. All of it compounds.

This page teaches that everyday discipline — and, just as importantly, the two safety rules that keep "improving the code" from becoming "breaking the code": **test before you change**, and **change in steps so small you can't get lost.**

> **The mindset shift:** stop waiting for permission to do a big cleanup that will never be scheduled. Start paying a little *while you're already in the file*. The best time to improve code is when you have it open anyway and you understand what it does *right now*. Debt paid in passing is debt that actually gets paid.

---

## Prerequisites

- **Required:** You can write and run a program, and you've used `git` to make a commit.
- **Required:** You've written at least one automated test (any framework — `pytest`, `go test`, JUnit, Jest). If "test" is fuzzy, skim a unit-testing intro first.
- **Helpful:** You've read [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) so "debt," "principal," and "interest" mean something concrete.
- **Helpful:** You've opened a file you didn't write, felt the urge to "clean it all up," and weren't sure if you were allowed to. (You'll get a clear answer here.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Refactoring** | Changing the *shape* of code without changing what it *does*. Same behavior, cleaner structure. |
| **Boy Scout Rule** | "Leave the code a little better than you found it." Clean up small things in passing. |
| **Characterization test** | A test that records what messy code *currently* does — so you'll notice if a change breaks it. |
| **Regression** | A bug you *re-introduce* — something that used to work and now doesn't. |
| **Extract function** | Pulling a chunk of code out into its own named function. The most common small refactoring. |
| **Duplication** | The same logic copy-pasted in two or more places. Fix a bug in one, forget the others. |
| **Rewrite** | Throwing code away and writing it again from scratch. Rarely the right first move. |
| **Scope creep** | A small task quietly growing into a huge one. The enemy of "pay a little." |

---

## Core Concept 1 — The Boy Scout Rule

The Boy Scouts have a rule: *leave the campsite cleaner than you found it.* Robert C. Martin borrowed it for code: **leave the code a little better than you found it.**

The key word is **little**. You are not here to fix the whole file. You found it because you were doing something *else* — fixing a bug, adding a small feature — and while you had it open, you tidied *one* thing on your way through.

Say you open this to add a feature, and you spot a variable that tells you nothing:

```python
# before — you came here for something else, but `d` made you wince
def process(d):
    for x in d:
        if x[2] > 0:
            send(x[0], x[1])
```

You don't rewrite it. You rename two things so the *next* person (probably future-you) isn't lost:

```python
# after — one small, safe improvement, made in passing
def process(orders):
    for order in orders:
        if order.amount > 0:
            send(order.email, order.subject)
```

That's the whole rule. A rename. A clearer name. One ugly nested `if` flattened. You leave, and the file is *slightly* better than you found it. Do this for a year across a team and the codebase quietly heals — without a single "cleanup sprint" ever being scheduled.

> **Key insight:** The Boy Scout Rule works *because* it's bounded. "Improve one small thing in code I'm already touching" is safe, reviewable, and ships today. "Improve everything" is unbounded, scary, and ships never. The power is in the smallness, not in spite of it.

---

## Core Concept 2 — Test Before You Change

Here is the rule that separates a safe cleanup from a 2 a.m. incident: **before you change messy code, make sure you can tell whether you broke it.**

Messy code is often messy code that *works*. Customers depend on its exact current behavior — including the weird parts. If you "clean it up" and silently change what it does, you've turned debt into a *bug*. That's a worse trade than leaving it alone.

The safety net is a test that pins down the current behavior *before* you touch anything. When you write a test for code you *didn't* design — a test whose job is to **describe what the code does today**, not what it *should* do — that's called a **characterization test**. The name sounds fancy; the idea is dead simple: *capture reality, then refactor against it.*

Suppose you're about to refactor this and you have no idea what edge cases it handles:

```python
def format_phone(raw):
    # nobody knows why it does all this. it just... works in prod.
    s = raw.strip().replace("-", "").replace(" ", "")
    if len(s) == 10:
        return f"({s[0:3]}) {s[3:6]}-{s[6:]}"
    return s
```

**Don't touch it yet.** First, write tests that record what it actually does right now:

```python
def test_characterize_format_phone():
    # not "what it should do" — what it DOES do, today
    assert format_phone("123-456-7890") == "(123) 456-7890"
    assert format_phone("  1234567890 ") == "(123) 456-7890"
    assert format_phone("12345")        == "12345"   # short input: passes through
    assert format_phone("")             == ""        # empty: passes through
```

Run them. They pass — because they describe reality. *Now* you have a net. Refactor the function however you like; if a test goes red, you changed behavior and you'll know *immediately*, while the change is still small and in your head.

> **Key insight:** A characterization test doesn't ask "is this code correct?" It asks "did my change keep the behavior the same?" That's exactly the question refactoring needs answered. Without it, "I refactored safely" is a hope. With it, it's a fact the test suite confirms in seconds.

---

## Core Concept 3 — Refactor in Tiny Steps

"Refactor" sounds like a big, scary operation. Done well, it's the opposite: a sequence of **tiny, mechanical, individually-safe steps**, running your tests between each one. If something breaks, you broke it in the *last little step* — so you know exactly where to look, and `git` can undo it in one command.

The everyday moves — the ones you'll use 90% of the time — are small:

- **Rename** — give a variable, function, or class a name that says what it is.
- **Extract function** — pull a confusing chunk into a named helper.
- **Remove duplication** — collapse copy-pasted logic into one place.

Watch duplication get removed in steps. Here's the before — the same discount math, copy-pasted:

```python
def price_for_member(base):
    return base - (base * 0.10)   # 10% off

def price_for_employee(base):
    return base - (base * 0.10)   # 10% off — copy-pasted
```

**Step 1** — extract the shared logic into one named function (run tests — green):

```python
def apply_discount(base, rate):
    return base - (base * rate)
```

**Step 2** — point both callers at it (run tests — green):

```python
def price_for_member(base):
    return apply_discount(base, 0.10)

def price_for_employee(base):
    return apply_discount(base, 0.10)
```

Now the discount rule lives in *one* place. Change it once, both callers update. Fix a bug once, it's fixed everywhere. Each step was tiny and verified by the tests, so at no point were you "in the middle of a big risky change."

This page deliberately won't drill into the dozens of named refactorings and the smells that trigger them — that's a whole discipline of its own. When you want the full catalog of *how*, go to **[Refactoring](../../../code-craft/refactoring/)** and the **[Code Smells](../../../code-craft/refactoring/01-code-smells/)** that tell you *where* to apply them. This roadmap's job is the *when* and *why*; refactoring's job is the *how*.

> **Key insight:** The size of the step is your safety dial. Big step = if it breaks, you're hunting through a pile of changes. Tiny step + tests between each = if it breaks, it's the thing you just did, and undo is one keystroke away. Slow is smooth, smooth is fast.

---

## Core Concept 4 — Fix on Touch, Not on Schedule

There's an endless debate among teams about *how* to schedule debt paydown — dedicated "cleanup sprints," a fixed slice of every sprint, and so on. As a junior, you can skip most of that debate, because the highest-value strategy needs no schedule at all: **fix debt in the code you're already touching.**

Why "on touch" beats "on schedule":

- **You already understand it.** You're in this file for a reason; you've just loaded its logic into your head. That context is the expensive part of any cleanup, and right now it's free.
- **It's the code that matters.** Code you keep touching is code that keeps changing — which means its debt keeps charging you *interest*. Code nobody touches charges nothing. (More on that in [04](../04-tracking-and-prioritizing/junior.md).)
- **It rides along with a real change.** Your cleanup is part of a feature or fix that's already getting reviewed and shipped. No separate approval, no "is this worth it?" meeting.

So the practical rule is: **when a task takes you into a file, leave that part of it a little better — and stop there.** You don't go hunting across the codebase for things to fix. You don't open files you have no reason to be in. You improve *the bit you touched*, and you move on.

```text
Task: "add a 'phone' field to the signup form."
While you're in signup.py anyway:
  ✓ rename `tmp` → `validated_email`          (you're reading this code right now)
  ✓ extract the 12-line validation block       (you need to understand it for the new field)
  ✗ refactor the unrelated payments module      ← NO. You're not in there. Leave it.
```

> **Key insight:** "Fix on touch" turns debt paydown from a *project* (needs planning, budget, buy-in) into a *habit* (free, continuous, invisible). A project competes with features for time and usually loses. A habit just happens. Bet on the habit.

---

## Core Concept 5 — When NOT to Pay Debt Down

Cleaning up code feels virtuous, which makes it easy to do at the *wrong* time. Restraint is part of the skill. Here's when to leave it alone — at least for now.

**1. When you can't tell if you broke it.** No tests, and the code is too tangled to characterize safely? Don't go in swinging. Either invest in a characterization test first (Concept 2) or leave it. An untested "improvement" to critical code is how you cause an outage while *trying to help*.

**2. When it's not the code you're touching.** The urge to fix the whole module is strong. Resist it. Stick to fix-on-touch (Concept 4). Wandering off to refactor unrelated code bloats your change, confuses your reviewer, and risks code you don't understand.

**3. When the deadline is real and the change is risky.** If the release is in an hour, this is not the moment to restructure a payments path. Note the debt, ship the fix, clean up next time you're in there with room to breathe.

**4. The big one — "let's just rewrite the whole thing."** This is the most expensive mistake a junior can make, so it gets its own treatment:

```text
The rewrite trap:
  "This code is awful. I'll rewrite it from scratch — it'll be faster than understanding it."
WHAT ACTUALLY HAPPENS:
  • The old code handles 100 edge cases nobody remembers — bugs found and fixed over YEARS.
  • Your clean rewrite handles the 5 cases you thought of. The other 95 come back as new bugs.
  • The rewrite takes 4× your estimate. Meanwhile, no features ship.
  • You end up with TWO things to maintain until the old one is finally killed (if ever).
```

That "ugly" code is often **ugly *because* it's correct** — every weird branch is a scar from a real bug. A rewrite throws away that hard-won knowledge and re-learns it the painful way. Almost always, the right move is **incremental refactoring**: keep the code working the whole time, improve it in small safe steps (Concept 3), with tests guarding behavior. You get a cleaner result *and* you never have a broken, un-shippable system.

There are real cases for a rewrite — but they're a senior call involving cost, risk, and strategy (the senior tier covers refactor-vs-rewrite, and patterns like the *strangler fig* for replacing systems gradually). As a junior, your default is: **refactor, don't rewrite.**

> **Key insight:** "Rewrite it all" *feels* like the bold, competent move. It's usually the opposite — it discards years of embedded bug fixes and trades a working system for a risky promise. Boring, incremental, test-backed paydown wins almost every time. Be boring on purpose.

---

## Real-World Examples

**1. The bug fix that left the file better.** A junior is sent to fix an off-by-one in `pagination.py`. While reading it, they hit a variable named `n` and a duplicated "calculate total pages" expression in two spots. They fix the bug, *and* — in the same PR — rename `n` to `total_items` and extract `total_pages(total_items, page_size)`. The diff is still small and obviously focused on the bug. The reviewer approves in two minutes. The next person to touch pagination inherits clearer code. That's the Boy Scout Rule doing its quiet work.

**2. The refactor that didn't become an outage.** Before restructuring a gnarly `parse_csv_row` function with no tests, an engineer writes six characterization tests capturing exactly what it does today — including that it silently drops malformed rows (weird, but customers rely on it). Mid-refactor, one test goes red: their "cleaner" version had started *raising* on malformed rows instead of dropping them. The test caught the behavior change in seconds. They fix it to match the old behavior, ship safely. Without those tests, that change is a production incident discovered by an angry customer.

**3. The rewrite that ate a quarter.** A team decided their "messy" reporting module should be rewritten from scratch — estimated three weeks. The old module quietly handled timezones, daylight-saving edges, leap years, and three legacy data formats. The rewrite shipped two months late and re-introduced bugs in *all four* areas that the old code had solved years earlier. The lesson the team took away: that ugliness was *accumulated correctness*. They should have refactored it in place, behind tests, a piece at a time.

---

## Mental Models

- **Debt is a credit card, not a loan you clear in one payment.** You don't wait for the month you pay the whole balance — you pay a little, regularly, on what you're already carrying. Fix-on-touch *is* the minimum monthly payment, and it's what keeps the balance from compounding.

- **Tests are the seatbelt; refactoring is the driving.** You can drive without a seatbelt and be fine — until the one time you aren't. A characterization test costs you a few minutes and saves you the crash. Buckle up *before* you change messy code, not after.

- **Tiny steps are a trail of breadcrumbs.** Refactor in small steps with tests between, and if you get lost (something breaks) you only have to walk back *one* breadcrumb. Refactor in one giant leap and a break leaves you stranded with no idea which change did it.

- **Ugly code is often a scar, not a wound.** A wound is a fresh mistake worth fixing. A scar is a healed-over bug fix — weird-looking, but load-bearing. Before you "clean up" something strange, ask whether it's ugly *because it's correct*. That question alone prevents most bad rewrites.

---

## Common Mistakes

1. **Waiting for the big cleanup that never comes.** "I'll fix it properly next sprint" is where debt goes to grow. The sprint doesn't materialize; the mess compounds. Pay a little *now*, in the file you have open.

2. **"Let's just rewrite the whole thing."** The classic junior trap. A rewrite throws away years of embedded bug fixes, blows past its estimate, and leaves you maintaining two systems. Default to incremental refactoring; treat a full rewrite as a rare senior decision, not your first instinct.

3. **Refactoring code with no safety net.** Changing tangled, untested, critical code by hand and hoping you didn't break it. Write a characterization test first — or don't touch it. An "improvement" that causes an outage isn't an improvement.

4. **Letting a small cleanup eat the whole PR (scope creep).** You came to rename one variable and now you're 600 lines into restructuring three modules. Your reviewer can't tell the bug fix from the cleanup, and you're editing code you don't understand. Keep cleanups small and *adjacent to what you're already doing*.

5. **Refactoring in giant leaps.** Twenty changes, then run the tests, then red — and now you have no idea which of the twenty did it. One small change, run tests, repeat. The step size is your blast radius.

6. **Mixing behavior changes into a "refactoring."** Refactoring means *same behavior, cleaner shape*. If you also fix a bug or tweak logic in the same breath, you can no longer trust "the tests still pass" to mean "I changed nothing." Refactor *or* change behavior — one at a time, separate commits.

7. **Hunting for debt to fix in code you have no reason to touch.** Virtuous-feeling, but it's unbounded work on code you don't understand. Fix on *touch* — improve what your real task already brought you into, and stop there.

---

## Test Yourself

1. State the Boy Scout Rule in one sentence. What's the most important word in it, and why?
2. You're about to refactor a messy 40-line function that has no tests and runs in production. What's the *first* thing you do — and what is that kind of test called?
3. A characterization test fails halfway through your refactoring. What does that tell you, and is it good or bad news?
4. Why is "fix debt in the code you're already touching" usually better than scheduling a dedicated cleanup sprint? Give two reasons.
5. A teammate says, "This module is a mess — let's rewrite it from scratch, it'll be faster than understanding it." Give two concrete reasons that usually goes badly.
6. You start out renaming one variable and 90 minutes later you've restructured three files. What rule did you break, and what should you have done?

<details>
<summary>Answers</summary>

1. **"Leave the code a little better than you found it."** The key word is **little** — the rule is safe and actually happens *because* it's bounded to small, in-passing improvements. "Fix everything" is unbounded and never ships.
2. **Write a characterization test first** — a test that records what the function *currently does* (including its quirks), so you'll instantly know if your refactoring changes behavior. Don't change the code until you have that net.
3. It tells you your "refactoring" **changed the behavior** — you didn't just reshape the code, you altered what it does. It's **good news**: the test caught a regression in seconds, while the change is small, instead of a customer catching it in production.
4. Any two of: (a) you already understand the code because you're in it for another reason — the expensive context is free; (b) code you keep touching is the code that's still charging interest, so it's the highest-value debt; (c) the cleanup rides along with a real change that's already being reviewed and shipped — no separate planning or buy-in needed.
5. Any two of: the old code encodes years of bug fixes and edge cases the rewrite will silently drop; rewrites routinely blow past their estimates; the "ugly" parts are often ugly *because they're correct*; you end up maintaining two systems until the old one is (maybe) retired. Incremental refactoring keeps the system working the whole time.
6. You let a small cleanup turn into **scope creep**, and you wandered out of the code you were actually touching. You should have made the one small improvement *adjacent to your real task* and stopped — keeping the PR small, focused, and reviewable.

</details>

---

## Cheat Sheet

```text
THE EVERYDAY RULE
  Boy Scout Rule → leave code a LITTLE better than you found it.
  Pay a little, often, in the code you're ALREADY touching. Not a big future cleanup.

SAFETY FIRST (before changing messy code)
  1. Can I tell if I break it?  No tests → write a CHARACTERIZATION test.
       (records what the code DOES today — quirks and all — not what it SHOULD do)
  2. Refactor in TINY steps. Run tests between each one.
  3. Test goes red → you changed behavior → undo the last small step (git).

REFACTOR vs REWRITE
  refactor  = same behavior, cleaner shape, code stays working   ← your default
  rewrite   = throw it away, start over                          ← rarely; senior call
  "ugly code" is often ACCUMULATED CORRECTNESS — don't discard the scars.

WHEN TO LEAVE IT ALONE
  • can't tell if you broke it (no tests, too tangled)
  • it's not the code you're touching  → don't go hunting
  • real deadline + risky change       → note it, ship, clean up next time
  • the urge to "rewrite it all"        → almost always: refactor instead

THE TINY MOVES (90% of paydown)
  rename · extract function · remove duplication
  → for the full HOW: code-craft/refactoring

KEEP IT SMALL
  refactor OR change behavior — never both in one commit.
  cleanup stays adjacent to your real task. scope creep is the enemy.
```

---

## Summary

- **Pay debt down a little, continuously, in the code you're already touching** — the Boy Scout Rule. This everyday habit beats the heroic "cleanup sprint" that never gets scheduled, because small in-passing improvements actually ship.
- **Test before you change messy code.** A **characterization test** records what the code *does today* (quirks included), so any behavior change shows up red in seconds instead of as a production incident. It answers the only question refactoring needs: *did my change keep the behavior the same?*
- **Refactor in tiny, mechanical steps** — rename, extract function, remove duplication — running tests between each. The step size is your blast radius: small steps + tests mean a break is the thing you just did, and `git` undo is one keystroke. For the full catalog of *how*, go to [Refactoring](../../../code-craft/refactoring/).
- **Fix on touch, not on schedule.** Improve the part of the code your real task brought you into — you already understand it, it's the code that's still charging interest, and the cleanup rides along with a change that's already being reviewed. Then stop; don't go hunting.
- **Default to refactor, not rewrite.** "Ugly" code is often *accumulated correctness* — years of embedded bug fixes. A from-scratch rewrite discards that knowledge, overruns its estimate, and re-introduces solved bugs. Boring, incremental, test-backed paydown wins almost every time.

You now have the everyday discipline of reducing debt safely. The next tiers scale this up — *strategies* for paydown at team scale (dedicated vs. continuous vs. %-capacity), refactor-vs-rewrite as a real decision, the strangler-fig pattern, and how to *measure* the payoff so you can prove the cleanup was worth it.

---

## Further Reading

- *Clean Code* (Robert C. Martin) — the chapter that popularized the **Boy Scout Rule**; short and quotable.
- *Working Effectively with Legacy Code* (Michael Feathers) — the source of **characterization tests** and the discipline of changing code you don't fully understand, safely.
- *Refactoring* (Martin Fowler) — the definitive catalog of small, safe, named refactorings. Skim the early chapters for *how to take tiny steps*.
- *Tidy First?* (Kent Beck) — a short book making the case for small, continuous tidyings over big rewrites.
- The [middle.md](middle.md) of this topic, which turns these habits into team-level *strategies* (continuous vs. dedicated vs. %-capacity paydown) and introduces refactor-vs-rewrite as a deliberate decision.

---

## Related Topics

- [middle.md](middle.md) — paydown *strategies* at team scale: continuous vs. dedicated vs. capacity-based, and measuring the payoff.
- [senior.md](senior.md) — refactor vs. rewrite as an economic decision, the strangler-fig pattern, and leading paydown across a codebase.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/junior.md) — *which* debt to pay first (high-interest, high-touch) before you pay it down here.
- [06 — Preventing Accumulation](../06-preventing-accumulation/junior.md) — stopping new debt from landing, so paydown isn't a losing battle.
- [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) — the principal-vs-interest foundation this page pays down.
- [Refactoring](../../../code-craft/refactoring/) — the full discipline of *how* to safely change code's shape.
- [Code Smells](../../../code-craft/refactoring/01-code-smells/) — *where* the code is telling you it needs one of those refactorings.
