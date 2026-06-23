# Duplication & Similarity — Junior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Duplication & Similarity
> *Copy-paste feels like the fastest way to reuse code. It is — right up until the day you fix a bug in one copy and ship a release that still carries the same bug in the other three.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Duplication Hurts](#core-concept-1--why-duplication-hurts)
5. [Core Concept 2 — The Duplication % Metric](#core-concept-2--the-duplication--metric)
6. [Core Concept 3 — DRY in Plain Terms](#core-concept-3--dry-in-plain-terms)
7. [Core Concept 4 — The Rule of Three: When NOT to Merge](#core-concept-4--the-rule-of-three-when-not-to-merge)
8. [Core Concept 5 — Finding It and Fixing It](#core-concept-5--finding-it-and-fixing-it)
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

> Focus: **Copy-paste as a measurable problem.**

Every developer copy-pastes code. You find a block that does almost what you need, paste it, tweak two lines, and move on. It works. The function passes its tests. The feature ships. Nothing is *wrong*, exactly — which is precisely why duplication is so easy to accumulate and so hard to notice.

The trouble is not the copy itself. The trouble is that a copy is a **promise you didn't know you made**: a promise that whenever the original logic changes, you will remember to change every copy too. You won't. Six weeks later someone finds a bug in the original, fixes it, writes a test, and closes the ticket — never knowing that three near-identical copies elsewhere still carry the exact same bug, untested and unfixed. The bug "comes back" in the next release and nobody understands why.

This page treats duplication as something you can **measure** and **reason about**, not just a vague code smell. You'll learn what the *duplication percentage* actually counts, how tools find copied blocks automatically, what **DRY** ("Don't Repeat Yourself") really means, and — just as important — the nuance most juniors learn too late: **not all duplication should be removed.** Two pieces of code that look identical today but exist for *different reasons* will need to change *separately* later, and forcing them to share code now is its own kind of bug. Knowing which is which is the whole skill.

> **The mindset shift:** the real cost of duplicated code is not the extra lines on disk — disk is free. The real cost is the bug you fix in three of four copies. Start seeing each copy as a *future divergence waiting to happen*, and the metric suddenly means something.

---

## Prerequisites

- **Required:** You can write and call a function or method in at least one language (examples use **Python** and a little **JavaScript**), and you understand parameters and return values.
- **Required:** You've used copy-paste to reuse code at least once. (Everyone has. That's the point.)
- **Helpful:** You've fixed a bug, only to have it reported again somewhere else in the same codebase.
- **Helpful:** You've heard the phrase "Don't Repeat Yourself" or "DRY" and want to know what it actually means in practice.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Duplication** | The same (or nearly the same) code appearing in more than one place. |
| **Clone** | A single duplicated block. A "code clone" is what a tool flags when it finds copy-paste. |
| **Duplication %** | The fraction of your codebase that is duplicated — e.g. "7% of our lines are copies." A health metric. |
| **DRY** | *Don't Repeat Yourself.* The principle that each piece of knowledge should live in exactly one place. |
| **Extract** | The fix: pull the repeated code out into one named function/method and call it from each old spot. |
| **Rule of three** | A guideline: don't extract on the second copy — wait until the *third* before you remove the duplication. |
| **Coincidental duplication** | Code that *looks* the same but exists for different reasons; merging it is a mistake. |
| **AHA** | "Avoid Hasty Abstractions" — the reminder that extracting too early can be worse than duplicating. |

---

## Core Concept 1 — Why Duplication Hurts

Imagine a `discount` calculation copied into four places in a shopping app — checkout, the cart preview, the email receipt, and the admin order view:

```python
# checkout.py
price = item.price * item.qty
if user.is_member:
    price = price * 0.9          # 10% member discount
total += price
```

The same four lines, give or take, appear in `cart.py`, `receipt.py`, and `admin.py`. Today they all agree. The app works.

Now the business changes the rule: members get **15%**, and there's a new **free-shipping-over-$50** rule. A developer opens `checkout.py`, updates it, tests checkout, and ships. Checkout is now correct. The cart preview, the email receipt, and the admin view still say **10%** and still charge shipping. The customer sees one price at checkout and a different one on the receipt. Support tickets roll in. The "bug" is impossible to reproduce for the developer — *their* code (checkout) is right.

This is the core harm, and it has a name worth internalizing: **duplication multiplies the cost of every future change and divides the chance you'll get it right.** With one copy, a rule change is one edit. With four copies, it's four edits you must *find*, *make consistently*, and *test* — and missing even one produces a silent inconsistency, the worst kind of bug because it's invisible until a user hits it.

Notice what duplication is *not* primarily about: it is not about saving keystrokes or disk space. A 10-line block copied four times "wastes" 30 lines, which costs nothing. The expense is entirely in the **future** — in the maintenance, the divergence, the bug fixed in three of four places.

> **Key insight:** duplicated code doesn't cost you when you *write* it. It costs you when you *change* it — and code that never changes is rare. The price is paid later, by someone (often you) who doesn't know all the copies exist.

---

## Core Concept 2 — The Duplication % Metric

You can't fix what you can't see, and copies hide. The **duplication percentage** turns "I think there's a lot of copy-paste" into a number you can track:

```
duplication % =  (lines of code that are duplicated)  ÷  (total lines of code)  × 100
```

If your project has 10,000 lines and a tool finds 700 of them inside duplicated blocks, your duplication is **7%**. Most teams aim to keep it in the low single digits; many CI setups fail a pull request if it *raises* the percentage past a threshold (say, 3–5%).

How does a tool find the duplicates? It doesn't read for meaning — it looks for **repeated runs of code**. The common approach:

1. **Tokenize** each file — break it into the meaningful pieces (keywords, names, operators), throwing away whitespace and comments.
2. **Slide a window** across the token stream looking for sequences that appear in more than one place.
3. **Report** any matching run longer than a minimum length (often "≥ 50 tokens" or "≥ 10 lines"), so trivial coincidences don't get flagged.

Because tools compare *tokens*, not raw characters, they catch copies even when you renamed a variable or reformatted the whitespace — `total += a * b` and `sum += x * y` can still be recognized as the same shape. Popular tools you'll meet: **CPD** (part of PMD, language-agnostic), **jscpd** (JavaScript/TypeScript and many others), and **Simian**. Platforms like SonarQube show the duplication % right on the dashboard.

> **Key insight:** the duplication % is a **smoke detector, not a judge.** A rising number says "go look — copy-paste is accumulating here." It does *not* say "this code is bad" or "delete all of it." Some of what it flags is duplication you should *keep* (next two concepts explain why). Treat the number as a prompt to investigate, never as a grade to optimize to zero.

A subtle trap, worth flagging now: if you make the duplication % a *target* and chase it to zero, people will "fix" it by merging code that only *looks* alike — and that's often worse than the duplication was. The metric is a diagnostic. The moment it becomes a goal, it starts lying. (More on dashboards as targets in [06 — Code Health Dashboards](../06-code-health-dashboards/junior.md).)

---

## Core Concept 3 — DRY in Plain Terms

**DRY** stands for *Don't Repeat Yourself*. People quote it as "never write the same code twice," but that's a sloppy paraphrase. The original definition (from *The Pragmatic Programmer*) is sharper and more useful:

> *Every piece of **knowledge** must have a single, unambiguous, authoritative representation within a system.*

The key word is **knowledge** — a rule, a fact, a decision — not lines of text. DRY is about not duplicating *a thing your system knows*. "Members get a 15% discount" is one piece of knowledge. If that rule lives in four places, you have a DRY violation, because changing your mind about the rule forces four edits and risks four-way disagreement.

The fix is to give that knowledge **one home**: a single function that everyone calls.

```python
# pricing.py — the single source of truth for "what does an item cost?"
def line_total(item, user):
    price = item.price * item.qty
    if user.is_member:
        price = price * 0.85       # 15% member discount — defined ONCE
    return price
```

Now checkout, cart, receipt, and admin all call `line_total(item, user)`. When the discount changes, you edit **one line, in one place**, and every screen updates together — automatically and consistently. The bug from Concept 1 becomes structurally impossible, because there's only one copy of the rule to get wrong.

That's the real value of DRY: it's not about tidiness, it's about making "change the rule everywhere" a *single, safe edit* instead of a *scavenger hunt*.

> **Key insight:** DRY is about deduplicating **knowledge**, not characters. Two lines of identical-looking code that encode *two different decisions* are not a DRY violation, even though they're textually the same. One decision written in two places *is* a violation, even if the two copies look a little different. Always ask "is this the **same knowledge**, or just the **same shape**?" — that question is the entire next concept.

---

## Core Concept 4 — The Rule of Three: When NOT to Merge

Here's the nuance that separates juniors from people who've been burned: **not all duplication should be removed.** Removing the wrong duplication creates a worse problem than the duplication did.

Why? Because the opposite of duplication is **coupling**. When you extract two blocks into one shared function, you have *tied them together*: from now on, anything that changes one must work for the other, because they share the same code. That's exactly what you *want* when the two blocks represent the **same knowledge** — but it's a trap when they only *look* alike and actually represent **different knowledge that happens to coincide today.**

Consider two functions that, right now, are byte-for-byte identical:

```python
# validation.py
def is_valid_username(s):
    return 3 <= len(s) <= 20      # looks identical to the rule below...

def is_valid_discount_code(s):
    return 3 <= len(s) <= 20      # ...but it's a DIFFERENT rule that just matches today
```

A tool flags these as a clone, and an eager "DRY it up!" instinct says: extract one `is_length_3_to_20(s)` helper and call it from both. **Don't.** These two rules are alike *by coincidence*. They will change for **different reasons**: a product decision might make usernames 3–30 characters, while discount codes stay fixed at 3–20 (or move to a strict 8). If you merged them, that first change forces you to *re-split* the function — and worse, a careless dev might edit the shared helper for the username rule and silently break discount-code validation. You'd have manufactured the exact "fix one, break another" bug that DRY was supposed to prevent.

The safeguard is the **rule of three**: *don't extract on the second occurrence — wait until the third.* The reasoning is empirical, not magic. With **one** copy there's nothing to dedupe. With **two**, you genuinely can't tell yet whether they're the same knowledge or a coincidence — the sample is too small. By the **third** independent appearance, a real pattern has revealed itself: it's now far more likely to be a true shared concept worth one home, and you've also seen enough variations to design the *right* shared function (the correct parameters, the correct name) instead of guessing.

This pairs with a memorable rule of thumb: **AHA — "Avoid Hasty Abstractions."** A little duplication is cheap to fix later (you can always extract on the third copy). A *wrong* abstraction is expensive to fix — everyone's already depending on it, and unwinding it is a refactor. When in doubt, **prefer duplicating for now over abstracting too early.**

> **Key insight:** duplication and coupling are a *trade-off*, not a one-way street. Extracting shared code removes duplication but *adds* coupling — and coupling is only good when the things truly belong together. Ask **"will these change together, for the same reason?"** If yes, extract. If they merely *look* the same today, leave them apart and let them evolve.

---

## Core Concept 5 — Finding It and Fixing It

Putting it together, here's the everyday workflow.

**Finding it.** Sometimes you spot duplication by eye — you go to copy a block and realize you've copied it before. More reliably, a tool finds it for you. A typical run:

```bash
# jscpd: scan a project, report duplicated blocks
npx jscpd ./src

# CPD (from PMD): find clones of 50+ tokens in Java
pmd cpd --minimum-tokens 50 --language java --files ./src
```

The tool prints each clone: *"these 14 lines in `cart.py` are identical to these 14 lines in `checkout.py`."* That's your prompt to investigate — not an order to merge.

**Deciding.** Before touching anything, ask the two questions from Concepts 3 and 4:

1. **Same knowledge?** Do both copies encode the *same rule/decision*, such that they should always change together? (If no — it's coincidental; leave it.)
2. **Seen it three times?** Is this the third+ appearance, so the pattern is real and you understand its shape? (If it's only the second, often *wait*.)

If both answers are yes, fix it.

**Fixing it — extract a function.** The basic, safe refactor is **Extract Function**: pull the repeated lines into one named function and replace each copy with a call.

*Before* — the same parsing logic copied in two endpoints:

```python
# users.py
def create_user(req):
    name = req.body.get("name", "").strip()
    if not name:
        raise BadRequest("name required")
    # ... use name ...

# teams.py
def create_team(req):
    name = req.body.get("name", "").strip()
    if not name:
        raise BadRequest("name required")
    # ... use name ...
```

*After* — one home for "read a required, trimmed name":

```python
# request_utils.py  ← the single source of truth
def required_name(req):
    name = req.body.get("name", "").strip()
    if not name:
        raise BadRequest("name required")
    return name

# users.py
def create_user(req):
    name = required_name(req)
    # ... use name ...

# teams.py
def create_team(req):
    name = required_name(req)
    # ... use name ...
```

Now the validation rule lives in one place. Fix a bug in `required_name` and *every* caller is fixed at once. The "fixed in three of four copies" failure can't happen anymore.

> **Key insight:** the standard fix for *true* duplication is **Extract Function** — give the repeated knowledge one named home and call it everywhere. Do it only after you've confirmed the copies are the *same knowledge*. Extraction is also reversible early and expensive late, which is exactly why the rule of three says *wait until you're sure.*

If the duplicated logic is *almost* the same but differs in one value, that difference usually becomes a **parameter** of the extracted function (e.g. `required_field(req, "name")`). The deeper mechanics of these moves — and dozens more — live in [Refactoring](../../../code-craft/refactoring/) and the catalog of [Code Smells](../../../code-craft/refactoring/01-code-smells/) that duplication is the most famous member of.

---

## Real-World Examples

**1. The discount that disagreed with itself.** A team copied a pricing formula into checkout, cart, receipt, and admin views. A "members get 15%" change landed only in checkout. For two weeks, customers saw one price at checkout and another on the emailed receipt — a silent inconsistency nobody could reproduce, because each developer only ever looked at *their* copy and each copy was internally fine. The fix was a single `line_total()` function. The bug was structurally a duplication bug, not a math bug.

**2. The validation that should have stayed split.** An eager refactor merged `is_valid_username` and `is_valid_discount_code` (both "3–20 characters") into one shared `validate_length` helper to "improve the DRY score." Three months later, product widened usernames to 30 characters. A developer edited the shared helper, the duplication checker stayed green — and discount codes silently started accepting 30-character input, breaking a downstream system that assumed ≤ 20. The "DRY improvement" *manufactured* the exact fix-one-break-another bug. Two functions that merely *looked* alike should have stayed apart.

**3. The CI gate that caught a paste.** A repo configured its pipeline to fail any pull request that pushed duplication above 4%. A developer, in a hurry, pasted a 60-line retry-and-logging block into a new service instead of importing the existing helper. The build went red with *"duplication increased: 3.1% → 4.6%."* They deleted the paste, imported the shared helper, and the build went green. Here the metric did its job perfectly — it was a *smoke detector* that caught a careless copy at the moment it was introduced, before it could diverge.

---

## Mental Models

- **A copy is an unwritten promise.** Every paste silently promises "I'll update all the copies whenever this changes." You will forget. The promise is broken by a future bug fix that touches only one copy. Extracting a function turns the promise into a guarantee the *compiler/runtime* keeps for you.

- **DRY is about knowledge, not text.** Picture each business rule as a fact that should have exactly one home address. Duplication is the same fact listed at four addresses; sooner or later they disagree. The fix isn't "delete repeated characters," it's "give the fact one address."

- **Duplication vs coupling is a seesaw.** Push down duplication (extract shared code) and you push up coupling (the callers are now tied together). That's a *good* trade when they belong together and a *bad* one when they don't. The rule of three is just "wait until you can tell which way the seesaw should tip."

- **Rule of three = wait for the pattern to prove itself.** One occurrence: nothing to see. Two: could be coincidence, too early to judge. Three: a real, recurring concept has revealed its shape — *now* extract, and you'll extract the *right* thing.

- **The metric is a smoke detector, not a scoreboard.** A rising duplication % means "go look over here." It does not mean "your code earned a C." Chase the *cause* it points to; never chase the *number* itself to zero.

---

## Common Mistakes

1. **Treating all duplication as a bug to eliminate.** Some duplication is correct — coincidental look-alikes that change for different reasons *should* stay separate. "Zero duplication" is not the goal; "no *unintended* duplication of *the same knowledge*" is.

2. **Over-DRYing — extracting on the second copy.** With only two copies you can't yet tell "same knowledge" from "same shape." Abstract too early and you often build the *wrong* abstraction, which is far costlier to undo than the duplication was to keep. Honor the rule of three.

3. **Merging code that only *looks* alike.** Two byte-identical blocks that encode *different rules* must not share a function. Merging them couples unrelated things and recreates the "fix one, break the other" bug — now in the shared helper. Always ask "same knowledge, or just same shape?"

4. **Gaming the duplication % instead of using it.** Making the metric a target invites bad merges and clever hiding (renaming, reformatting to dodge the token matcher) that lower the number without improving the code. The percentage is a diagnostic; the moment it's a goal, it stops measuring anything real.

5. **Copy-pasting "just this once" and forgetting it.** The first paste feels harmless, and it is — until it's pasted again, and again. By the time the duplication checker flags it, four copies have quietly drifted apart. If you catch yourself pasting code you've pasted before, that's the signal to extract.

6. **Thinking duplication is about disk or keystrokes.** It isn't. The cost is entirely in *future change* — finding every copy, editing them consistently, testing them all, and the silent bug when you miss one. Code that genuinely never changes is the only place duplication is truly cheap, and you can rarely know that in advance.

---

## Test Yourself

1. In one sentence, what is the *real* cost of duplicated code — and when do you pay it?
2. A tool reports your project is "8% duplicated." What does that number literally mean, and what decision should it drive (and *not* drive)?
3. State DRY in its precise form. Why is "never write the same code twice" a misleading paraphrase?
4. You find two identical 12-line blocks. What two questions do you ask before extracting them into a shared function?
5. What is the rule of three, and what's the reasoning behind waiting for the *third* occurrence rather than acting on the second?
6. Give an example of duplication you should **not** remove, and explain what bug merging it could create.

<details>
<summary>Answers</summary>

1. The real cost is **future change**: with N copies, every change to that logic is N edits you must find, make consistently, and test — and missing one produces a silent inconsistency bug. You pay when the code *changes*, not when you write it.
2. It means **8% of your lines sit inside blocks that also appear elsewhere** (as found by a token-matching tool). It should drive **"go investigate where copy-paste is accumulating"**; it should **not** drive "delete all duplication" or be treated as a grade to optimize to zero — some flagged duplication is correct to keep.
3. Precise DRY: *every piece of **knowledge** must have a single, unambiguous, authoritative representation in the system.* The paraphrase misleads because DRY is about not duplicating *a decision/rule*, not about textual sameness — two identical-looking blocks encoding *different* knowledge are not a violation.
4. (a) **Same knowledge?** — do both encode the same rule, so they should always change together? (b) **Seen it three times?** — is this the third+ appearance, so the pattern is real and its shape is clear? Extract only if both are yes.
5. The rule of three says **wait until the third occurrence before removing duplication.** Reasoning: one copy has nothing to dedupe; two copies are too small a sample to tell "same knowledge" from "coincidence"; by three, a genuine recurring concept has revealed itself *and* you've seen enough variation to design the *right* shared function.
6. Two functions like `is_valid_username` and `is_valid_discount_code` that are both "3–20 characters" **today** but exist for **different reasons**. Merging them couples unrelated rules: when one rule later changes (usernames → 30 chars), editing the shared helper silently breaks the other (discount codes), recreating the fix-one-break-another bug.

</details>

---

## Cheat Sheet

```
WHAT DUPLICATION COSTS
  NOT disk / keystrokes (those are free)
  YES future change: N copies → N edits to find, make, test
  the classic bug: fix it in 3 of 4 copies → silent inconsistency

THE METRIC
  duplication % = duplicated lines ÷ total lines × 100
  found by: tokenize → slide a window → report runs ≥ min length
  tools: CPD (PMD), jscpd, Simian, SonarQube dashboard
  it is a SMOKE DETECTOR ("go look"), NOT a grade ("you got a C")
  make it a target → people game it → it stops meaning anything

DRY (Don't Repeat Yourself)
  precise: every piece of KNOWLEDGE has ONE authoritative home
  it's about a RULE/DECISION, not about identical characters
  fix for TRUE duplication: Extract Function → call it everywhere

WHEN NOT TO MERGE
  duplication ↓ trades for coupling ↑  (good only if they belong together)
  ask: "SAME KNOWLEDGE, or just SAME SHAPE?"
  coincidental look-alikes change for DIFFERENT reasons → keep apart
  RULE OF THREE: don't extract on copy #2; wait for copy #3
  AHA = Avoid Hasty Abstractions (a wrong abstraction costs more than a copy)

THE FIX (Extract Function)
  1. confirm: same knowledge + seen 3×
  2. pull repeated lines into one named function
  3. replace each copy with a call
  4. a value that differs between copies → make it a PARAMETER
```

---

## Summary

- **Duplication is copy-paste, and its cost is in the future, not the present.** N copies turn every change into N edits; the signature failure is a bug fixed in three of four copies, leaving a silent inconsistency that's nearly impossible to reproduce.
- **The duplication %** = duplicated lines ÷ total lines. Tools find clones by *tokenizing* code and looking for repeated runs, so they catch copies even after renames and reformatting (CPD, jscpd, Simian, SonarQube). Treat the number as a **smoke detector that says "go look," never a grade** — and never as a target, or people will game it.
- **DRY means each piece of *knowledge* has one authoritative home** — it's about a *rule or decision*, not identical text. The fix for genuine duplication is **Extract Function**: one named home that every caller uses, so a change (or a bug fix) happens once and applies everywhere.
- **Not all duplication should be removed.** Extracting trades duplication for **coupling**; that's only worth it when the copies are the *same knowledge* and will change together. Code that merely *looks* the same but changes for *different reasons* must stay separate — merging it recreates the very bug DRY prevents.
- **The rule of three** — wait until the third occurrence before extracting — plus **AHA** (Avoid Hasty Abstractions) keep you from building the *wrong* abstraction too early. A little duplication is cheap to fix later; a wrong abstraction is expensive to unwind.

You now have the junior toolkit: see each copy as a future divergence, read the duplication % as a prompt to investigate, and apply DRY *and* the rule of three together — extracting true shared knowledge while leaving coincidental look-alikes apart.

---

## Further Reading

- *The Pragmatic Programmer* (Hunt & Thomas) — the chapter that defines DRY precisely as "one authoritative representation of every piece of knowledge." The source most people quote and few have read.
- *Refactoring* (Martin Fowler) — "Duplicated Code" as the canonical code smell, and the **Extract Function** recipe step by step.
- ["The Wet Codebase" / "AHA Programming"](https://kentcdodds.com/blog/aha-programming) — Kent C. Dodds on why over-DRYing hurts and how "Avoid Hasty Abstractions" balances it.
- [jscpd](https://github.com/kucherenko/jscpd) and [PMD CPD](https://pmd.github.io/) docs — try a duplication scan on your own project; seeing your real clones is more convincing than any prose.
- The [middle.md](middle.md) of this topic, which formalizes clone *types* (1–4), token-vs-AST detection, and how to tune a duplication tool so it flags what matters.

---

## Related Topics

- [middle.md](middle.md) — clone types 1–4, token vs AST detection, and tuning the tools beyond a single percentage.
- [senior.md](senior.md) — duplication as a *design* signal, cross-cutting duplication, and when a shared abstraction is the wrong answer at scale.
- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/junior.md) — the other foundational "is this code risky?" metric; duplication and complexity often cluster in the same files.
- [06 — Code Health Dashboards](../06-code-health-dashboards/junior.md) — where the duplication % shows up alongside other metrics, and why trends beat absolutes and targets corrupt the number.
- [Refactoring](../../../code-craft/refactoring/) — the mechanics of *fixing* duplication safely (Extract Function and the rest of the catalog).
- [Code Smells](../../../code-craft/refactoring/01-code-smells/) — "Duplicated Code" is the most famous smell; this is the catalog it belongs to.
