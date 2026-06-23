# Coupling & Cohesion Metrics — Junior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Coupling & Cohesion Metrics
> *Two files, one truth: every codebase is a web of things that depend on other things. Coupling measures how tangled that web is; cohesion measures whether each knot in it actually belongs together. Almost every "this code is hard to change" complaint is one of these two going wrong.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Coupling: How Much a Module Leans on Others](#core-concept-1--coupling-how-much-a-module-leans-on-others)
5. [Core Concept 2 — Cohesion: How Focused a Module Is](#core-concept-2--cohesion-how-focused-a-module-is)
6. [Core Concept 3 — Why Low Coupling + High Cohesion](#core-concept-3--why-low-coupling--high-cohesion)
7. [Core Concept 4 — Fan-In and Fan-Out You Can Actually Count](#core-concept-4--fan-in-and-fan-out-you-can-actually-count)
8. [Core Concept 5 — Spotting a Junk Drawer (the God Object)](#core-concept-5--spotting-a-junk-drawer-the-god-object)
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

> Focus: **What are coupling and cohesion, and how do you see them?**

Pick any file in a real project. Now ask two questions. First: *how many other files does this one need in order to work?* Second: *do the things inside this file actually belong together?* The first question is about **coupling**. The second is about **cohesion**. They are the two oldest, most repeated ideas in software design — coined in the 1970s by Larry Constantine and Edward Yourdon — and they are still the first two things a senior engineer feels when they open unfamiliar code.

Here's why they matter to *you*, today, as a junior. When someone says "this code is a nightmare to change," they almost never mean the syntax is wrong or the algorithm is slow. They mean one of two things: you change a single function and three unrelated features break (that's high coupling — too many connections), or you open one file expecting to find *the thing you need* and instead find a 2,000-line grab-bag of unrelated stuff (that's low cohesion — a junk drawer). Both make the code expensive to touch, and both can be *seen* with simple counting before you understand a single line of the logic.

The slogan everyone repeats — **low coupling, high cohesion** — is not a vague aesthetic preference. It is a concrete, observable property of code, and this page teaches you to observe it: to count the arrows between modules, to notice when a class's methods have nothing in common, and to recognize the smell of a God object from across the room.

> **The mindset shift:** stop reading code only as "does this work?" Start reading it as "how connected is this, and does it belong together?" Code with **low coupling and high cohesion** is code you can change *without fear* — touch one piece and the blast radius is small and predictable. That fearlessness is the entire payoff, and these two ideas are how you measure your way toward it.

---

## Prerequisites

- **Required:** You can read code in at least one language and you know what a **function**, a **class**, and a **module/file** are. (Examples use **Python** and a little pseudocode — the ideas are language-independent.)
- **Required:** You've seen one file `import` (or `require`, or `#include`) another, and you understand that this creates a dependency.
- **Helpful:** You've worked in a codebase big enough that you couldn't hold all of it in your head at once — that's where these ideas start to bite.
- **Helpful:** You've once made a "small" change and been surprised when something *elsewhere* broke. That surprise is high coupling introducing itself.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Module** | A unit of code grouped together — a file, a class, or a package. The thing we measure coupling and cohesion *of*. |
| **Dependency** | When module A needs module B to do its job (A imports, calls, or inherits from B). An arrow from A to B. |
| **Coupling** | How much a module depends on other modules. Many arrows in/out = high coupling. Lower is better. |
| **Cohesion** | How focused a module is — whether its parts all serve one clear purpose. Higher is better. |
| **Fan-out** | How many *other* modules this module depends on (arrows going **out**). |
| **Fan-in** | How many *other* modules depend on this one (arrows coming **in**). |
| **God object** | A single class/file that knows and does far too much — the classic low-cohesion, high-coupling offender. |
| **Blast radius** | How much of the system a single change can break. Small blast radius = easy to change safely. |

---

## Core Concept 1 — Coupling: How Much a Module Leans on Others

**Coupling** is the degree to which one module depends on others. Draw your modules as boxes and every "A needs B" relationship as an arrow between them. **Coupling is how many arrows there are, and how tightly they bind.** A pile of boxes with arrows crisscrossing everywhere is *highly coupled*. A few boxes with a handful of deliberate arrows is *loosely coupled*.

Why is high coupling bad? Because **an arrow is a path for change to travel**. If `OrderService` reaches deep into the internals of `PaymentGateway`, then changing `PaymentGateway` can break `OrderService` — even though you never touched `OrderService`. The more arrows, the more places a single change can ripple to. High coupling is what turns "I'll just rename this field" into a half-day of breakage across the codebase.

Look at two versions of the same idea. First, **tight coupling** — the order class reaches inside the gateway and depends on exactly how it works:

```python
class OrderService:
    def checkout(self, order):
        gateway = StripeGateway()          # hard-wired to ONE concrete class
        gateway.api_key = settings.STRIPE  # reaches into its internals
        gateway.endpoint = "/v1/charges"   # knows its private details
        gateway._charge_raw(order.total)   # calls a private-looking method
```

`OrderService` now depends on Stripe *specifically*, on its config fields, and on its internal method. Swap to PayPal, or change any of those details, and `checkout` breaks. The arrow is thick and rigid.

Now, **loose coupling** — the order class depends only on a small, stable promise:

```python
class OrderService:
    def __init__(self, gateway):           # given SOME gateway; doesn't care which
        self.gateway = gateway

    def checkout(self, order):
        self.gateway.charge(order.total)   # depends only on one simple method
```

`OrderService` no longer knows *which* gateway it uses or *how* it works — only that it has a `charge` method. Stripe, PayPal, or a fake one for tests all slot in. The arrow is thin and flexible. Same feature, far less coupling.

> **Key insight:** Coupling isn't just *how many* connections, but *how much each connection reveals*. Depending on a tiny, stable interface (`charge(amount)`) is loose coupling. Depending on another module's private fields, internal methods, or exact data shape is tight coupling — because now their *insides* can break you, not just their *promises*.

---

## Core Concept 2 — Cohesion: How Focused a Module Is

If coupling is about the arrows *between* modules, **cohesion** is about what's *inside* one module. A module is **cohesive** when everything in it serves one clear, single purpose — when the parts belong together. It has **low cohesion** when it's a junk drawer: a batteries-string-and-old-receipts collection of things that happen to live in the same file but have nothing to do with each other.

Here's a class with **low cohesion** — a `User` class that has quietly become a dumping ground:

```python
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email

    def full_name(self):            # about the user — fine
        return self.name

    def send_welcome_email(self):   # email infrastructure — different job
        smtp.connect(); smtp.send(self.email, "Welcome!")

    def export_to_csv(self):        # report formatting — different job again
        return f"{self.name},{self.email}"

    def validate_password(self, pw):# security/auth — yet another job
        return bcrypt.check(pw, self.hash)
```

Four methods, four *completely different responsibilities*: representing a user, sending email, generating reports, and checking passwords. The class is *about* nothing in particular — it's about everything. That's low cohesion. The tell: the methods don't really work together, and they'd each be at home in a different file.

Here's the same functionality split into **cohesive** pieces, each about exactly one thing:

```python
class User:                         # only: what a user IS
    def __init__(self, name, email): ...
    def full_name(self): ...

class WelcomeMailer:                # only: sending email
    def send(self, user): ...

class UserCsvExporter:              # only: formatting users as CSV
    def export(self, user): ...

class PasswordChecker:              # only: password verification
    def verify(self, user, pw): ...
```

Now each class has one job. Need to change how email is sent? You open `WelcomeMailer` and *nothing else is in there to distract or endanger you*. That's high cohesion paying off.

> **Key insight:** A quick, mechanical cohesion check — **do the methods share the same data?** In a cohesive class, most methods touch the same fields (they're all working on the same thing). In the low-cohesion `User`, `send_welcome_email` uses `email`, `validate_password` uses `hash`, `export_to_csv` uses both — they fan out over unrelated state. When a class's methods don't share fields, that's strong evidence each method belongs somewhere else. (The formal metric for this is called **LCOM** — *Lack of Cohesion of Methods* — and you'll meet it by name in [middle.md](middle.md).)

---

## Core Concept 3 — Why Low Coupling + High Cohesion

You'll hear "low coupling, high cohesion" so often it starts to sound like a chant. It's worth understanding *why* it's the goal, because the two together buy you three concrete things: code that's easy to **change**, easy to **test**, and easy to **understand**.

**Easy to change.** High cohesion means a given change lives in *one* place — all the email logic is in the mailer, so a change to email touches the mailer and stops. Low coupling means that change doesn't *leak* — because few modules depend on the mailer's internals, fixing it won't ripple out and break things elsewhere. Cohesion localizes the change; loose coupling contains it. Together: a **small, predictable blast radius**.

**Easy to test.** A loosely coupled module can be tested *in isolation*, because you can swap its dependencies for simple fakes. Recall the loose-coupling `OrderService` — you can hand it a fake gateway in a test and verify checkout logic without ever calling Stripe. A tightly coupled module drags its whole dependency web into every test; you can't test the order logic without a live payment system. (You'll see this connection again in [Refactoring](../../../code-craft/refactoring/) and in testing roadmaps — *untestable* is very often a polite word for *too tightly coupled*.)

**Easy to understand.** A cohesive module has a name that tells the whole truth: `PasswordChecker` checks passwords, full stop. You can understand it without reading it. A junk-drawer `User` class can only be understood by reading *all* of it, because the name promises nothing. Cohesion makes code *skimmable*; low coupling means you can understand one module without first understanding ten others.

> **Key insight:** Low coupling and high cohesion are two halves of the same goal: **keeping related things together and unrelated things apart.** Cohesion is the "keep related things together" half (inside a module). Low coupling is the "keep unrelated things apart" half (between modules). When you get both right, the code stops fighting you every time you change it.

A useful warning, though: these two pull against each other if you take either to an extreme. Chase *zero* coupling and you end up copy-pasting code so nothing depends on anything — which destroys cohesion and creates duplication. Chase *maximum* cohesion by splitting everything into one-method classes and you create a swarm of tiny modules with arrows everywhere — which spikes coupling. The goal is **balance**, not a maximum of either. Senior judgment is mostly knowing where that balance sits.

---

## Core Concept 4 — Fan-In and Fan-Out You Can Actually Count

Coupling sounds abstract until you realize you can literally *count* it. The two simplest, most useful counts are **fan-out** and **fan-in**.

- **Fan-out** = how many *other* modules this one depends on. Roughly: **count the imports** at the top of the file (the ones it actually uses). Arrows going **out**.
- **Fan-in** = how many *other* modules depend on *this* one. Roughly: **count how many files import this file**. Arrows coming **in**.

```
        ┌─────────┐
   A ──▶│         │──▶ X
   B ──▶│  utils  │──▶ Y       fan-in(utils)  = 3   (A, B, C depend on it)
   C ──▶│         │──▶ Z       fan-out(utils) = 3   (it depends on X, Y, Z)
        └─────────┘
```

You can compute fan-out for a file in about ten seconds, by hand, right now:

```python
# notifications.py
import smtplib          # ─┐
import requests         #  │  fan-out = 4
from .users import User #  │  (this file depends on 4 others)
from .config import URL # ─┘
```

Each tells a different story:

**High fan-out** = "this module is *needy*." It depends on many things, so it breaks when *any* of them changes, and it's hard to test (you must satisfy all those dependencies). A file with 25 imports is doing too much or is wired into too much. High fan-out is a coupling smell on the *consuming* side.

**High fan-in** = "this module is *popular*." Many things depend on it. That's not automatically bad — a well-designed `utils` or a core `User` model *should* be widely used. But it raises the stakes enormously: a change here has a *huge* blast radius, because everyone depends on it. High-fan-in modules must be **stable** — you change them rarely and very carefully. (The relationship between fan-in, fan-out, and how *stable* a module should be is formalized as **instability** in [middle.md](middle.md).)

> **Key insight:** Fan-in and fan-out mean opposite things about *risk*. **High fan-out** is usually a problem with *this* module (it's needy, fragile, hard to test). **High fan-in** is fine — even good — as long as the module is *stable*, but it makes the module *dangerous to change*. The combination to fear is a module that is both **high fan-in and frequently changed**: everyone depends on it *and* it keeps moving. That's where coupling does its worst damage. You'll see exactly this idea return as **churn × dependency** in [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/junior.md).

---

## Core Concept 5 — Spotting a Junk Drawer (the God Object)

Put coupling and cohesion together and you can recognize the single most common design failure on sight: the **God object** (also called a God class or "the blob"). It's the class that knows everything and does everything — and it's *both* the worst-cohesion *and* the worst-coupling offender in the system at once.

Here's a `ShoppingCart` that has eaten the entire application:

```python
class ShoppingCart:
    def add_item(self, item): ...            # cart logic        — belongs
    def remove_item(self, item): ...         # cart logic        — belongs
    def total(self): ...                      # cart logic        — belongs

    def charge_credit_card(self, card): ...   # payment           — doesn't belong
    def send_confirmation_email(self): ...    # email             — doesn't belong
    def update_inventory(self): ...           # inventory/db      — doesn't belong
    def apply_tax_rules(self, region): ...     # tax law           — doesn't belong
    def generate_pdf_receipt(self): ...       # PDF rendering     — doesn't belong
    def log_to_analytics(self): ...           # analytics         — doesn't belong
    def validate_shipping_address(self): ...  # shipping          — doesn't belong
```

How to recognize it — the **field-of-symptoms checklist**:

1. **It's huge.** Hundreds or thousands of lines, dozens of methods. Size alone is a hint.
2. **Its name lies.** It's called `ShoppingCart`, but it does payment, email, tax, PDF, and analytics. The name describes a *fraction* of what's inside — the classic low-cohesion tell.
3. **Its methods don't share data.** `apply_tax_rules` and `send_confirmation_email` touch totally different fields. (The cohesion check from Concept 2.)
4. **Everyone imports it (high fan-in) AND it imports everyone (high fan-out).** It sits at the center of the web with arrows in *and* out everywhere — maximum coupling in both directions.
5. **You're scared to touch it.** Every change risks breaking something unrelated, because everything is tangled together. The fear is the symptom you'll feel first.

The fix is the **before/after split** you already saw in Concept 2, applied at scale: pull each unrelated responsibility into its own cohesive class, and let the cart *coordinate* them through small interfaces instead of *containing* them.

```python
class ShoppingCart:                  # ONLY cart logic now
    def add_item(self, item): ...
    def remove_item(self, item): ...
    def total(self): ...

# extracted into focused, cohesive collaborators:
class PaymentProcessor: ...          # was charge_credit_card
class OrderMailer: ...               # was send_confirmation_email
class InventoryService: ...          # was update_inventory
class TaxCalculator: ...             # was apply_tax_rules
class ReceiptGenerator: ...          # was generate_pdf_receipt
```

Each new class is small, has an honest name, and has one job. The cart shrinks to *just* cart logic. Every class is now independently understandable and testable, and a change to tax rules touches `TaxCalculator` and nothing else.

> **Key insight:** A God object is what you get when low cohesion and high coupling compound. The cure is almost always the same move — **extract** each distinct responsibility into its own cohesive module — which simultaneously *raises cohesion* (each piece now has one job) and *lowers coupling* (pieces depend on small interfaces, not on one giant tangle). One refactoring, both metrics improve. That's why "extract a class" is the most valuable refactoring a junior can learn.

---

## Real-World Examples

**1. The rename that broke production.** A developer renames a field on a widely-used `User` class from `is_active` to `active` — a one-line, obviously-correct change. The build passes. Then three unrelated features break in production: billing, the admin dashboard, and an email job all read `user.is_active` directly. The `User` class had enormous **fan-in** (everything depends on it) and exposed its internals (tight coupling — callers touched the field directly). The change was tiny; the *blast radius* was the whole app. The real lesson isn't "be careful renaming" — it's that a high-fan-in module reached into by everyone is a coupling time bomb.

**2. The test that needed a database, a mail server, and a payment account.** A team tries to unit-test their `ShoppingCart.checkout()` and discovers they can't run it without a live database, an SMTP server, and a Stripe sandbox key — because the God-object cart does inventory, email, and payment all inside `checkout`. The *untestability* is a direct readout of the coupling. After extracting `PaymentProcessor`, `OrderMailer`, and `InventoryService` (each injectable), the cart's logic can be tested in milliseconds with three simple fakes. "We can't test this" was high coupling talking.

**3. The `utils.py` that ate the codebase.** Every project grows one file — `utils.py`, `helpers.js`, `common.go` — where anything that doesn't obviously belong elsewhere gets dumped. Six months in, it has 60 unrelated functions: date formatting, string parsing, a retry wrapper, some SQL helpers, an image resizer. It has near-total **fan-in** (everyone imports it) and the worst **cohesion** in the repo (the functions share *nothing*). It's a God object wearing a humble name. The fix is the same: split it by responsibility into `dates.py`, `text.py`, `retry.py` — cohesive modules with honest names.

---

## Mental Models

- **Arrows on a whiteboard.** Draw modules as boxes, dependencies as arrows. Coupling is *how many arrows and how thick*. Your goal is fewer, thinner arrows. If the diagram looks like a plate of spaghetti, the code feels like one too.

- **The junk drawer vs. the toolbox.** A low-cohesion module is the kitchen junk drawer: batteries, twist-ties, an old phone, takeout menus — related only by "we had nowhere else to put them." A high-cohesion module is a labeled toolbox: everything inside serves one job, and the label tells you exactly what's in there without opening it.

- **Fan-out = neediness, fan-in = popularity.** A needy module (high fan-out) depends on everyone and breaks easily — that's *its* problem. A popular module (high fan-in) is depended on by everyone — that's *everyone's* problem if it changes. Needy modules are fragile; popular modules must be stable.

- **Blast radius.** Every change has a blast radius — the set of things it can break. Low coupling + high cohesion shrinks the blast radius to something small and predictable. "I'm scared to change this" is your gut measuring a large blast radius.

- **Honest names.** A cohesive module can have a name that's *the whole truth* (`PasswordChecker` only checks passwords). When a name can only ever be vague (`Manager`, `Helper`, `Utils`, `Data`), it's usually because the thing inside has no single purpose — a cohesion warning written right on the label.

---

## Common Mistakes

1. **Treating "high fan-in" as automatically bad.** A core `User` model or a well-designed library *should* have high fan-in — being widely used is the point. The danger isn't fan-in itself; it's high fan-in on a module that *keeps changing* or *exposes its internals*. Don't refactor a stable, popular module just because many things import it.

2. **Chasing zero coupling.** Some coupling is necessary — modules have to talk to do anything useful. The goal is *low and deliberate* coupling through small interfaces, not *no* coupling. People who try to eliminate all dependencies end up duplicating code, which is worse.

3. **Confusing "small file" with "cohesive."** Cohesion is about *focus*, not *size*. A 500-line class can be perfectly cohesive (it all serves one job), and a 30-line file can be a junk drawer (three unrelated helpers). Count *responsibilities*, not lines.

4. **The `Manager` / `Helper` / `Util` trap.** These names are magnets for low cohesion — because they don't *commit* to a single responsibility, people feel free to dump anything into them. A vague name invites a junk drawer. If you can't name a class precisely, that's a sign it's doing too much.

5. **Splitting a God object into pieces that are still tangled.** Extracting ten classes that all reach into each other's internals doesn't *reduce* coupling — it just spreads the same tangle across more files. The split only helps if each new piece depends on *small interfaces*, not on the guts of its neighbors.

6. **Measuring coupling/cohesion and then *grading* with it.** These are *diagnostics that point you at risk* ("go look at this God object"), not *report-card grades* ("our cohesion score is a B"). A fan-in count tells you where to *look*; it doesn't tell you the code is good or bad on its own.

---

## Test Yourself

1. In one sentence each, define **coupling** and **cohesion**, and say which direction is "good" for each.
2. You have a file `notifications.py` with these imports: `smtplib`, `requests`, `from .users import User`, `from .config import URL`. What is its **fan-out**? How would you find its **fan-in**?
3. A class has five methods, and *no two of them touch the same field*. What does that tell you about its cohesion, and what's the likely fix?
4. Your team's `User` model has very high fan-in. Is that a problem? Under what condition does it *become* a problem?
5. Name three concrete benefits of "low coupling + high cohesion," and connect each to coupling or cohesion (or both).
6. You find a 1,500-line `OrderManager` class that handles orders, payments, email, inventory, and PDF receipts. Name it, list two symptoms that identify it, and describe the one refactoring that fixes it.

<details>
<summary>Answers</summary>

1. **Coupling** = how much a module depends on other modules; **lower is good**. **Cohesion** = how focused a module is (whether its parts serve one purpose); **higher is good**.
2. **Fan-out = 4** (it depends on four other modules). To find **fan-in**, search the codebase for how many files import `notifications` (e.g. grep for `import notifications` / `from .notifications`).
3. It has **low cohesion** — methods that share no data are probably unrelated responsibilities living in one class. Likely fix: **extract** each responsibility (or group of methods that *do* share data) into its own focused class.
4. **Not by itself** — a widely-used model *should* have high fan-in. It **becomes a problem** when that high-fan-in module also changes frequently or exposes its internals, because then every change has a huge blast radius (and the field-rename example bites).
5. Easy to **change** (cohesion localizes a change to one place; low coupling stops it leaking) — both. Easy to **test** (low coupling lets you swap dependencies for fakes and test in isolation) — coupling. Easy to **understand** (a cohesive module has an honest name and is skimmable; low coupling means you don't need to read ten others first) — both.
6. It's a **God object** (God class / blob). Two symptoms (any two): its name lies about how much it does; its methods don't share data; it's huge; it has both high fan-in and high fan-out; you're scared to touch it. Fix: **extract** each distinct responsibility (payment, email, inventory, receipts) into its own cohesive class and let the order class *coordinate* them through small interfaces — which raises cohesion and lowers coupling at once.

</details>

---

## Cheat Sheet

```
THE TWO IDEAS
  COUPLING   = how much a module depends on others   → want it LOW
  COHESION   = how focused a module is (one job?)     → want it HIGH
  the slogan = LOW coupling, HIGH cohesion
             = keep related things together (cohesion)
               keep unrelated things apart  (low coupling)

COUNT IT (fast, by hand)
  fan-out = # of OTHER modules this one depends on   ≈ count its imports
  fan-in  = # of modules that depend on THIS one     ≈ grep "import thisfile"

WHAT THE COUNTS MEAN
  high fan-out → NEEDY: fragile, hard to test        → usually a problem
  high fan-in  → POPULAR: fine IF the module is stable
  high fan-in + changes a lot → DANGER (huge blast radius)

QUICK COHESION CHECK
  Do the methods share the same fields?
    yes → probably cohesive (all about one thing)
    no  → probably a junk drawer → split it

GOD OBJECT (junk drawer) — recognize on sight
  [x] huge          [x] name lies about its job
  [x] methods share no data   [x] high fan-in AND fan-out
  [x] you're scared to touch it
  FIX: EXTRACT each responsibility into its own cohesive class
       → cohesion ↑ and coupling ↓ from one refactoring

TIGHT vs LOOSE COUPLING
  tight = depends on another module's internals/fields/private methods
  loose = depends only on a small, stable interface (charge(amount))
```

---

## Summary

- **Coupling** is how much a module depends on other modules — the arrows between boxes. You want it **low**, because every arrow is a path for change to ripple along.
- **Cohesion** is how focused a module is — whether everything inside serves one clear purpose. You want it **high**, because a focused module is changeable, testable, and understandable.
- The goal **low coupling + high cohesion** is just two halves of one idea: *keep related things together, keep unrelated things apart*. Getting both right gives you code with a small, predictable **blast radius** — code you can change without fear.
- You can **count** coupling: **fan-out** (≈ imports a file uses) is how needy a module is; **fan-in** (≈ files that import it) is how popular it is. High fan-out is usually a problem; high fan-in is fine *if* the module is stable, and dangerous if it changes often.
- A quick **cohesion check**: do a class's methods share the same fields? If not, they probably don't belong together. The worst case is the **God object** — huge, dishonestly named, methods sharing no data, high fan-in *and* fan-out — and the cure is always to **extract** each responsibility into its own cohesive class, which raises cohesion and lowers coupling in one move.

You now have the two foundational design qualities as things you can *see and count*. From here, [middle.md](middle.md) puts real metrics on them — Robert Martin's afferent/efferent coupling, instability, and abstractness, plus the LCOM cohesion metrics — so the eyeballing you just learned becomes numbers you can track over time.

---

## Further Reading

- *Structured Design* — Edward Yourdon & Larry Constantine. The 1970s book that coined "coupling" and "cohesion." Old, but the ideas are unchanged.
- *Clean Code* (Robert C. Martin) — the chapter on Classes; the Single Responsibility Principle is "high cohesion" stated as a rule.
- *Refactoring* (Martin Fowler) — the *Extract Class* and *Move Method* refactorings are exactly the God-object cure in this page, step by step.
- The [middle.md](middle.md) of this topic — turns these ideas into the Martin metrics (afferent/efferent coupling, instability, the main sequence) and LCOM, with formulas and thresholds.

---

## Related Topics

- [middle.md](middle.md) — the formal coupling/cohesion metrics: instability, abstractness, the main sequence, and LCOM.
- [senior.md](senior.md) — using these metrics at architecture scale, where they lie, and how to drive real decisions with them.
- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/junior.md) — the *other* core internal-quality metric: how complicated a single function is.
- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/junior.md) — where the "high fan-in *and* changes a lot" danger becomes the churn × complexity hotspot.
- [Code Craft → Refactoring](../../../code-craft/refactoring/) — the mechanics of actually fixing coupling and cohesion problems (Extract Class, dependency injection, and more).
