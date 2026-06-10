# Premature Abstraction at Scale — Junior Level

> **Category:** [Anti-Patterns at Scale](../README.md) → **Premature Abstraction at Scale** — *the "clean", generic, decoupled design nobody needed — when over-abstraction is itself the anti-pattern, and how to unwind it at scale.*
> **Covers (collectively):** Speculative Generality · Wrapper-itis & needless indirection · Premature decoupling & one-implementation interfaces · The Wrong Abstraction · AHA / Rule of Three / YAGNI as the cure

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Shapes at a Glance](#the-shapes-at-a-glance)
5. [The One-Implementation Interface](#the-one-implementation-interface)
6. [A Config Option Nobody Sets](#a-config-option-nobody-sets)
7. [A Generic Framework for a Single Use Case](#a-generic-framework-for-a-single-use-case)
8. [Wrapper-itis: Layers That Only Forward](#wrapper-itis-layers-that-only-forward)
9. [The Rule You Will Hear Most: "Duplication Is Cheaper Than the Wrong Abstraction"](#the-rule-you-will-hear-most-duplication-is-cheaper-than-the-wrong-abstraction)
10. [A Spotting Checklist](#a-spotting-checklist)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What premature abstraction looks like.**

Most of the anti-patterns in this roadmap are failures of *too little* — too little structure, too little care. This one is the opposite: a failure of **too much**. The code is clean. It has interfaces, factories, generics, a config file, neat little layers. It looks like *good* engineering. And yet, when you try to read it or change it, you find that every interface has exactly one implementation, every config option has exactly one value nobody ever changes, and the "flexible framework" has exactly one user. The flexibility was built for a future that never arrived — and you pay for it on every read, forever.

That is **premature abstraction**: a generic, decoupled, "reusable" design built before there was any real need for it. At the junior level your job is simply to **recognize these shapes** and to feel comfortable writing the *boring, direct* version instead.

> **The distinction that defines this whole topic.** A sibling topic — [Over-Engineering](../../01-development/03-over-engineering/junior.md) — teaches you to spot speculative generality *in a single file* you're reading. **This topic is the staff / at-scale angle:** what happens when a wrong abstraction has already spread across a large codebase, and the judgment and mechanics for unwinding it. You're at the start of that ladder. This file is recognition only; the cost-at-scale and the unwinding come in [`senior.md`](senior.md) and [`professional.md`](professional.md).

> **The mindset shift:** an abstraction is a *bet* that variation will appear. Built too early, against an imagined future, it's a bet that usually loses — and you carry the losing ticket as code you must read and maintain forever. The cure is patience: wait for the real, repeated need, then abstract against the evidence.

---

## Prerequisites

- **Required:** You can write and use interfaces, classes, generics, and configuration in at least one language (examples here use Go, Java, Python, and TypeScript).
- **Required:** You understand what an *abstraction* is — a layer that hides detail so callers can ignore it.
- **Helpful:** You've read [Over-Engineering → junior](../../01-development/03-over-engineering/junior.md) — **YAGNI** and **Speculative Generality** are the file-level roots of everything here.
- **Helpful:** You've once opened a "flexible" piece of code and found it had exactly one real use.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Abstraction** | A layer that hides detail (an interface, a base class, a config knob, a generic type) so callers don't depend on the specifics. |
| **Premature abstraction** | An abstraction added *before* there's real, repeated evidence it's needed — a guess about the future encoded as code. |
| **Speculative generality** | Building flexibility for a use case nobody has asked for. (Fowler's name for the smell.) |
| **YAGNI** | "You Aren't Gonna Need It" — don't build flexibility until a real requirement demands it. |
| **DRY** | "Don't Repeat Yourself" — remove *knowledge* duplication. Often misapplied to remove harmless *code* similarity. |
| **The Wrong Abstraction** | An abstraction that doesn't actually fit the problem, so callers bend, flag, and special-case it. Sandi Metz's term. |
| **AHA** | "Avoid Hasty Abstractions" — prefer waiting until the right abstraction is obvious over guessing early. (Kent C. Dodds / Sandi Metz.) |
| **Rule of Three** | Don't abstract until you have *three* real, different uses. Two might be coincidence; three is a pattern. |
| **Indirection** | A layer that points to another layer instead of doing the work. A little helps; a lot is noise. |

---

## The Shapes at a Glance

| Shape | One-line symptom | The smell you feel |
|---|---|---|
| **One-implementation interface** | An `interface` with a single `impl` | "Why is there an interface here? There's only one." |
| **Config nobody sets** | A knob with one value, forever | "It's configurable, but everyone uses the default." |
| **Generic framework, single user** | A "platform" with one consumer | "This is built to support N things; N is 1." |
| **Wrapper-itis** | Layers that only forward calls | "I opened five files and none of them did anything." |
| **The wrong abstraction** | A shared thing everyone special-cases | "Every caller passes a flag to opt out of half of it." |

These are **abstraction** shapes: you spot them by noticing that the *flexibility costs more than it returns* — there's a seam, a knob, or a layer, but nothing on the other side of it.

---

## The One-Implementation Interface

### What it looks like

Someone created an interface "to decouple" or "to make it testable," but there is, and has only ever been, **one implementation**.

```go
// Go — an interface with exactly one implementation, and exactly one caller.
type EmailSender interface {
    Send(to, subject, body string) error
}

type smtpSender struct{ host string }

func (s *smtpSender) Send(to, subject, body string) error { /* the only impl */ }

// Nobody ever has a second sender. The interface adds a layer of indirection,
// a name to keep in sync, and a "go to definition" that lands on a method
// signature instead of the actual code.
```

### Why it's premature

An interface is a **promise of substitutability** — it says "more than one thing can go here." When only one thing ever goes there, the promise is empty. You've paid for a seam (extra file, extra indirection, a jump every time you read it) and gotten nothing back, because nothing varies.

### The boring, better version

Use the concrete type directly. If you later get a *second, real* sender, extracting the interface then is a five-minute, mechanical refactor — and now you'll design it against two real shapes instead of guessing.

```go
type SMTPSender struct{ host string }
func (s *SMTPSender) Send(to, subject, body string) error { /* just the code */ }
// Callers depend on SMTPSender directly. Extract the interface the day a
// second sender actually exists — not before.
```

> **"But I need it for testing!"** Usually you don't. Many languages let you fake a concrete type, and a one-method interface extracted *only for a mock* often means the test is over-mocking. Extract for a *real* second implementation; reach for a test double only when the dependency is genuinely external (network, clock, payment gateway).

---

## A Config Option Nobody Sets

### What it looks like

A setting, feature flag, or parameter that is "configurable" — but in practice every environment uses the same value, and the other branch has never run in production.

```python
# Python — a knob with one real value.
def render(report, *, format="pdf", compress=True, watermark=False,
           retries=3, locale="en", theme="default"):
    ...

# In reality every call site is render(report). The five knobs encode futures
# that never arrived: nobody passes a non-"pdf" format, nobody turns off
# compression, no caller has ever set watermark=True.
```

### Why it's premature

Each option is an *axis of variation you promised to support.* Every one multiplies the states the code can be in, the branches you must read, and the combinations you'd have to test — but the variation is imaginary. A config option nobody sets is a [Boat Anchor](../../01-development/01-bad-structure/junior.md) with a settings UI.

### The boring, better version

Delete the knobs nobody uses. Hard-code the one real value. Add a parameter back the day a *second* real value appears — driven by a requirement, not a hunch.

```python
def render(report):
    ...  # one behavior, the one anybody actually needs
```

---

## A Generic Framework for a Single Use Case

### What it looks like

A "platform," "engine," or "framework" built to handle many cases generically — serving exactly one case.

```java
// Java — a plugin framework with exactly one plugin.
public interface ReportPlugin {
    boolean supports(ReportType t);
    Report  generate(ReportContext ctx);
}

public class PluginRegistry {        // discovery, ordering, lifecycle, priorities…
    private final List<ReportPlugin> plugins = new ArrayList<>();
    public void register(ReportPlugin p) { plugins.add(p); }
    public Report run(ReportContext ctx) { /* find the supporting plugin… */ }
}

// There is one plugin: SalesReportPlugin. The registry, the supports() dance,
// the lifecycle — all of it exists to dispatch to a single class.
```

### Why it's premature

You built the *machinery* for variation (registration, discovery, dispatch, priorities) before any variation existed. A reader has to understand the whole framework to find the one thing it actually does. The simple version — *call the function* — is hidden behind a system designed for a crowd of one.

### The boring, better version

```java
// One report, called directly. No registry, no plugin contract, no dispatch.
Report report = SalesReport.generate(ctx);
```

When a *third* report type genuinely shows up (Rule of Three), you'll extract a small abstraction that fits the three real shapes you now understand — not the imagined ten you didn't.

---

## Wrapper-itis: Layers That Only Forward

### What it looks like

A chain of classes or functions where each one just calls the next and adds nothing — no validation, no transformation, no decision. Pure pass-through.

```typescript
// TypeScript — four layers, zero behavior. Each just forwards.
class UserController {
  constructor(private svc: UserService) {}
  getUser(id: string) { return this.svc.getUser(id); }       // forwards
}
class UserService {
  constructor(private repo: UserRepository) {}
  getUser(id: string) { return this.repo.getUser(id); }      // forwards
}
class UserRepository {
  constructor(private dao: UserDao) {}
  getUser(id: string) { return this.dao.getUser(id); }       // forwards
}
class UserDao {
  getUser(id: string) { return db.query("…", id); }          // the only real line
}
```

### Why it's premature

Each wrapper was added "in case we need to put logic here later." Until that logic exists, the wrapper is a tax on every read: to follow one call you open four files, none of which does anything. This is sometimes called **Lasagna Code** — too many thin layers.

### The boring, better version

Keep the layers that hold *real* responsibility (e.g., a repository that maps DB rows to domain objects, a controller that handles HTTP concerns). Collapse the ones that only forward. A layer earns its place by *doing something*, not by existing in a diagram.

---

## The Rule You Will Hear Most: "Duplication Is Cheaper Than the Wrong Abstraction"

This is the single most important sentence in this whole topic, from Sandi Metz:

> **"Duplication is far cheaper than the wrong abstraction."**

Here's the intuition. Imagine two pieces of code that *look* similar today:

```python
# Looks like duplication — but are these the SAME knowledge, or a coincidence?
def invoice_total(items):  return sum(i.price for i in items) * 1.20   # 20% VAT
def quote_total(items):    return sum(i.price for i in items) * 1.20   # 20% margin
```

The numbers match, so the eager move is to "DRY it up" into one shared `total(items, rate)`. But these are **two different ideas** that happen to share a number today. The day VAT changes to 21% but margins stay at 20%, the shared function can't express that — so every caller starts passing flags (`total(items, rate, is_tax=True)`) to bend it back apart. That's the **wrong abstraction**: a shared thing that no longer fits, kept alive by special cases.

The trap: removing a wrong abstraction is *much* harder than tolerating a little duplication, because by the time you notice, dozens of call sites depend on its (wrong) shape. Duplication, by contrast, is cheap to fix — you can always merge it *later*, once you're sure the two things really are the same knowledge.

> **The junior takeaway:** when two things look similar, ask **"is this the same *knowledge*, or just the same *shape* today?"** If you can't tell, **wait.** Two copies you can merge later are far safer than one abstraction you'll have to tear apart. This is **AHA — Avoid Hasty Abstractions** — and the **Rule of Three**: wait for three real, *different* uses before you generalize.

---

## A Spotting Checklist

Run this over any "clean, flexible" code you read this week:

- [ ] An `interface`/abstract class with exactly **one** implementation? → one-implementation interface.
- [ ] A config option / flag / parameter that has the **same value everywhere**? → config nobody sets.
- [ ] A "framework"/"engine"/"registry" with exactly **one** consumer? → generic framework, single user.
- [ ] A layer that only **forwards** to the next layer, adding nothing? → wrapper-itis.
- [ ] A shared helper where callers pass **flags to opt out** of half of it? → the wrong abstraction.

Each check is a place where flexibility was built ahead of need. The fix is almost always *less* code, not more.

---

## Common Mistakes

Mistakes juniors make *about* abstraction:

1. **Treating "more abstract" as "more advanced."** Adding interfaces and generics feels senior. But the senior move is often the *opposite*: the simplest thing that solves today's real problem. Indirection is a cost, not a badge.
2. **Extracting an interface for one mock.** A one-method interface that exists only so a test can fake it is usually over-mocking — see mocking-strategies. Test the concrete thing; abstract for a *real* second implementation.
3. **"DRYing up" code that only *looks* the same.** Same shape ≠ same knowledge. Merging two coincidentally-similar pieces creates the wrong abstraction. Ask whether they'd change *together* before you merge.
4. **Building the framework before the second case.** "We'll need a plugin system eventually" → you build the system, and the second plugin never comes. Wait for the third real case (Rule of Three).
5. **Confusing "flexible" with "good."** Flexibility you don't use is pure cost: more to read, more to test, more to break. Unused flexibility is a [Boat Anchor](../../01-development/01-bad-structure/junior.md).
6. **Thinking abstraction is free to keep "just in case."** Every layer is read thousands of times. "Just in case" is a guess; you pay for it on every read whether or not the case ever arrives.

---

## Test Yourself

1. What does Sandi Metz's rule *"duplication is far cheaper than the wrong abstraction"* mean, and why is the wrong abstraction so expensive to remove later?
2. You find an `interface PaymentProvider` with one implementation, `StripeProvider`, and one caller. Is this premature abstraction? What would make it *not* premature?
3. What's the difference between two pieces of code that are the **same knowledge** vs the **same shape**? Why does it matter before you "DRY them up"?
4. State the **Rule of Three**. Why three and not two?
5. A function has parameters `compress=True, watermark=False, theme="default"`, and every call site uses the defaults. What's the shape, and what should you do?
6. Your teammate says "I added an interface so it'll be easy to swap later." What one question tells you whether the interface is earning its keep *today*?

<details>
<summary>Answers</summary>

1. It means a little repeated code is cheaper to live with than an abstraction that doesn't actually fit the problem. The wrong abstraction is expensive because callers wire themselves into its shape; by the time you realize it's wrong, dozens of call sites depend on it, and unwinding it touches all of them. Duplication, by contrast, is fixable any time — you can merge it *later* once you're sure it's the same knowledge.
2. As written, **yes** — one impl, one caller, the interface promises substitutability that doesn't exist. It stops being premature the moment there's a *second real* implementation (e.g., `PayPalProvider`) — then the interface fits two real shapes instead of guessing.
3. **Same knowledge** = the two pieces encode one idea and will always change together (change one → must change the other). **Same shape** = they happen to look alike today but are different ideas (VAT vs profit margin) that will diverge. Merging same-shape-but-different-knowledge code creates the wrong abstraction. It matters because the merge is easy and the un-merge is hard.
4. **Don't abstract until you have three real, different uses.** Two could be coincidence (same shape, different knowledge); a third makes a genuine pattern likely and gives you three real examples to design the abstraction *against* instead of guessing.
5. A **config option nobody sets** — speculative flexibility. Delete the unused knobs and hard-code the one real behavior; add a parameter back when a *second* real value is actually required.
6. **"Where's the second implementation?"** If there isn't one (and none is concretely planned for a real, current requirement), the interface is a promise of substitutability with nothing on the other side — premature. Use the concrete type; extract the interface when the second thing actually exists.

</details>

---

## Cheat Sheet

| Shape | Spot it by | Boring, better version |
|---|---|---|
| **One-impl interface** | One `impl`, one caller, indirection with nothing behind it | Use the concrete type; extract when a 2nd real impl exists |
| **Config nobody sets** | A knob with the same value everywhere | Delete the knob; hard-code the one real value |
| **Generic framework, 1 user** | Registry/engine/plugin system with one consumer | Call the function directly; build machinery at the 3rd case |
| **Wrapper-itis** | Layers that only forward, adding nothing | Collapse pass-through layers; keep layers that *do* something |
| **The wrong abstraction** | Callers pass flags to opt out of half of it | Inline it back to duplication, then find the *real* seam |

> **One rule to remember:** *An abstraction is a bet that variation will appear. Built too early, it usually loses — and you carry the losing ticket forever. Wait for the real, repeated need (Rule of Three), then abstract against the evidence.*

---

## Summary

- **Premature abstraction** is the anti-pattern of *too much* design too early: interfaces with one implementation, config nobody sets, frameworks with one user, layers that only forward, and shared helpers that don't actually fit.
- It's dangerous *because* it looks like good engineering — it's clean, decoupled, "flexible." But flexibility you never use is pure cost: more to read, more to test, more to maintain, paid on every read forever.
- The cure is patience: **YAGNI** (don't build flexibility until a real need demands it), **AHA** (avoid hasty abstractions), and the **Rule of Three** (wait for three real, *different* uses).
- Sandi Metz's rule anchors it: **"duplication is far cheaper than the wrong abstraction"** — when in doubt, tolerate the duplication, because merging later is easy and un-merging a wrong abstraction is hard.
- At the junior level your job is **recognition**: notice these shapes and write the boring, direct version instead of guessing at the future.
- Next: [`middle.md`](middle.md) — *how to actively resist these as you write, and how to tell when an abstraction has truly earned its keep.*

---

## Further Reading

- **["The Wrong Abstraction"](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)** — Sandi Metz (2016) — the canonical essay; "duplication is far cheaper than the wrong abstraction."
- **["AHA Programming"](https://kentcdodds.com/blog/aha-programming)** — Kent C. Dodds — "Avoid Hasty Abstractions" and the cost of premature DRY.
- **Refactoring** — Martin Fowler (2nd ed., 2018) — the *Speculative Generality* smell; *Inline Function* / *Inline Class* / *Collapse Hierarchy* as the cures.
- **The Pragmatic Programmer** — Hunt & Thomas (20th anniv. ed., 2019) — what DRY *actually* means (duplication of *knowledge*, not of text).
- **A Philosophy of Software Design** — John Ousterhout (2018) — deep vs shallow modules; why a thin pass-through layer is a *liability*.

---

## Related Topics

- [Over-Engineering → junior](../../01-development/03-over-engineering/junior.md) — the file-level sibling: YAGNI, KISS, Speculative Generality, Lasagna Code.
- [Abstraction Failures → senior](../../02-design/03-abstraction-failures/senior.md) — Golden Hammer, Inner-Platform Effect, Interface Bloat, and the wrong abstraction at design scale.
- [Clean Code → Abstraction & Information Hiding](../../../clean-code/22-abstraction-and-information-hiding/README.md) — what a *good* abstraction is, and when to draw the line.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — cohesion and the cost of needless indirection.
- [Bad Structure → junior](../../01-development/01-bad-structure/junior.md) — Boat Anchor: unused flexibility kept "just in case."
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings (Inner-Platform, Distributed Monolith).
