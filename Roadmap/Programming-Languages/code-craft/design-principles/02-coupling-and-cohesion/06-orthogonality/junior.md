# Orthogonality — Junior Level

> **Category:** [Coupling & Cohesion](../../README.md) — designing a system so that unrelated parts stay unrelated: a change in one place has no effect on the others.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Where the Word Comes From](#where-the-word-comes-from)
5. [The Definition](#the-definition)
6. [The Two Analogies From the Book](#the-two-analogies-from-the-book)
7. [Why Orthogonality Matters](#why-orthogonality-matters)
8. [A Worked Example: A Non-Orthogonal Design and Its Fix](#a-worked-example-a-non-orthogonal-design-and-its-fix)
9. [Global State: The Orthogonality Killer](#global-state-the-orthogonality-killer)
10. [How Orthogonality Relates to Coupling and Cohesion](#how-orthogonality-relates-to-coupling-and-cohesion)
11. [How to Achieve It](#how-to-achieve-it)
12. [Mental Models](#mental-models)
13. [Best Practices](#best-practices)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)
21. [Diagrams](#diagrams)

---

## Introduction

> Focus: **What is it?** and **How to use it?**

**Orthogonality** is the property of a system in which **unrelated things stay unrelated** — you can change one part without disturbing the others. The term was popularized for software by Andrew Hunt and David Thomas in *The Pragmatic Programmer*, who summed it up in five words:

> **"Eliminate effects between unrelated things."**
> — Hunt & Thomas, *The Pragmatic Programmer*

That's the whole idea. If your logging code and your business rules are orthogonal, you can rewrite the logger without touching a single business rule, and rewrite a business rule without touching the logger. If the database layer and the screen layout are orthogonal, swapping the database doesn't ripple into the UI. The opposite — a system where touching *anything* risks breaking *something else* — is **non-orthogonal**, and it's the source of an enormous amount of fear, bugs, and slow change.

### Why this matters

Most of the pain in maintaining software comes from **unexpected effects**: you fix a bug in the payment code and somehow the email receipts break; you change a date format in one report and three unrelated screens start showing wrong totals. Those surprises happen because parts that *should* have been independent were secretly wired together. Orthogonality is the discipline of keeping them apart on purpose, so a change's blast radius is small and predictable.

The payoff is concrete and immediate: **localized change** (you edit one place), **less risk** (a fault is contained), **easier testing** (you can test a part in isolation), and **parallel work** (two people change two orthogonal modules without colliding).

---

## Prerequisites

- **Required:** You can write functions and group code into modules/classes.
- **Required:** A basic sense of **dependencies** — when code A "uses" code B.
- **Helpful:** Exposure to **[Minimise Coupling](../01-minimise-coupling/junior.md)** and **[Maximise Cohesion](../02-maximise-cohesion/junior.md)**, because orthogonality is those two ideas viewed as a single property of the whole system.
- **Helpful:** A feel for **[Separation of Concerns](../../01-generic/03-separation-of-concerns/junior.md)** — keeping different kinds of work in different places.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Orthogonal** | Two things are orthogonal if a change in one has **no effect** on the other. Borrowed from geometry: perpendicular (independent) axes. |
| **Non-orthogonal** | The opposite — changing one thing forces changes in, or breaks, others. |
| **Effect** | An observable consequence: a broken test, a changed output, a required edit elsewhere. |
| **Independence** | The ability to vary one thing while everything else stays fixed. |
| **Cross-cutting concern** | A concern (logging, security, persistence) that, if not isolated, spreads across many unrelated modules and destroys orthogonality. |
| **Global state** | Data reachable and mutable from anywhere; the most common cause of hidden, non-orthogonal effects. |
| **Blast radius** | How many other parts a single change can affect. Orthogonality shrinks it. |

---

## Where the Word Comes From

"Orthogonal" is borrowed from **geometry and linear algebra**, where two vectors are orthogonal if they meet at a right angle — they are **independent axes**. Moving along the x-axis changes your horizontal position and *nothing* about your vertical position; the y-axis is unaffected. The axes don't interfere.

```
        y
        ▲
        │
        │        moving along x changes ONLY x.
        │        moving along y changes ONLY y.
        └─────────▶ x        the axes are INDEPENDENT.
```

Software borrows the metaphor directly. Each independent "axis" is a separate concern or feature — the database, the UI, the logging, a pricing rule. In an orthogonal system you can slide along one axis (change the database) without sliding along any other (the UI stays put). In a non-orthogonal system the axes are tilted into each other: pushing one drags the others along.

> Orthogonality is **independence made into a design goal**: arrange the system so its concerns sit on separate axes.

---

## The Definition

> **Two or more things are orthogonal if changes in one have no effect on the others.**

Spelled out for software:

- **Unrelated features should be independent.** A change to feature A should not require, or accidentally cause, a change to unrelated feature B.
- **Unrelated modules should be decoupled.** Touching module A shouldn't ripple into module B unless B genuinely depends on A's behavior.
- **The system has separate "control axes."** Each concern can be adjusted on its own dial.

Notice the word **unrelated**. Orthogonality is *not* the claim that nothing in the system depends on anything — that's impossible and undesirable. It's the claim that things which are **conceptually unrelated** are also **technically independent**. The shipping calculator and the login page are unrelated concepts; in a good design they're also unrelated in code.

---

## The Two Analogies From the Book

*The Pragmatic Programmer* gives two analogies that nail the idea. Memorize both — they appear in interviews and they're genuinely the clearest way to explain orthogonality.

### Non-orthogonal: helicopter controls

A helicopter has four primary controls: the **cyclic** (tilt), the **collective** (lift), the **throttle** (engine power), and the **anti-torque pedals** (yaw). The brutal fact is that **every input affects every axis.** Pull up on the collective to climb, and the aircraft tries to yaw and the engine bogs down, so you must simultaneously adjust the pedals and the throttle — which in turn change the lift again. Nothing can be adjusted in isolation; every control is coupled to every other.

> "When you pull up on the collective... you simultaneously roll, yaw, pitch, and adjust the throttle." Helicopters are famously hard to fly *because* their controls are **non-orthogonal**.

A non-orthogonal codebase flies like that helicopter: you can't touch one knob without fighting the other three.

### Orthogonal: a stereo system

Now picture a home stereo. The **volume** knob changes loudness and nothing else. The **balance** slides sound left/right and nothing else. The **tone** controls treble/bass and nothing else. You can set each one independently; turning up the bass never changes the volume. The controls are **orthogonal** — and as a result the system is effortless to operate, easy to reason about, and you can swap the speakers without re-tuning the amplifier.

```
NON-ORTHOGONAL (helicopter)        ORTHOGONAL (stereo)
  input ──┬──▶ pitch                 volume ─▶ loudness
          ├──▶ roll                   balance ─▶ left/right
          ├──▶ yaw                    tone    ─▶ treble/bass
          └──▶ lift                   (each input → one effect)
 (every input → every axis)
```

**Goal:** build systems whose controls behave like the stereo, not the helicopter.

---

## Why Orthogonality Matters

The benefits are practical and they compound:

| Benefit | Why orthogonality gives it to you |
|---|---|
| **Localized change** | A change to one concern lives in one place; you don't chase ripples across the codebase. |
| **Promotes reuse** | An independent component (with no hidden ties) can be lifted out and reused elsewhere. A component tangled with global state can't. |
| **Reduces risk** | A fault is **isolated** to its module instead of cascading. One broken part doesn't take the system down. |
| **Shrinks the test surface** | You can test one component alone, with a small, focused test, instead of standing up the whole world. |
| **Enables parallel work** | Two engineers edit two orthogonal modules at the same time without merge conflicts or stepping on each other. |
| **Easier to estimate** | When a change's blast radius is small and predictable, you can actually predict how long it takes. |

The single sentence to remember: **orthogonality turns "change the system" into "change one part of the system."** That difference — between editing one box and editing a tangle — is most of what makes a codebase pleasant or miserable to work in.

---

## A Worked Example: A Non-Orthogonal Design and Its Fix

Let's see a small change ripple across modules in a non-orthogonal design, then fix it.

### The requirement

We compute an order total, log it, and store it. Three concerns: **pricing** (business logic), **logging**, and **persistence**.

### Non-orthogonal version (TypeScript)

```typescript
// Everything is braided together in one function.
function processOrder(order: Order, db: Database, logFile: string): number {
  let total = 0;
  for (const item of order.items) {
    total += item.price * item.qty;
  }
  // logging is hard-wired into the pricing logic:
  appendFileSync(logFile, `Order ${order.id}: $${total}\n`);
  // persistence is hard-wired in too, with a literal SQL string:
  db.execute(`INSERT INTO orders VALUES (${order.id}, ${total})`);
  return total;
}
```

Now watch a change ripple. Product asks: **"Log as JSON instead of plain text, and write it to a logging service, not a file."** That's a *logging* change — it has nothing to do with pricing or persistence. But because everything is braided together:

- You must edit `processOrder` — the **pricing** function — to change logging.
- The function signature `logFile: string` is now wrong; **every caller** of `processOrder` must change.
- The pricing tests now break, because they were calling a function that touches the filesystem.
- You can't test pricing without a real (or faked) log file and database.

One unrelated change forced edits to pricing, callers, and tests. That's the helicopter.

```
   "Change the log format"  ──┬──▶  edit pricing function
                              ├──▶  change every caller's signature
                              ├──▶  break pricing tests
                              └──▶  touch persistence-adjacent code
        (one input → every axis = NON-ORTHOGONAL)
```

### Orthogonal redesign (TypeScript)

Put each concern on its own axis. Pricing computes; it does **not** log or store. Logging and persistence are passed in as collaborators the caller composes.

```typescript
// AXIS 1 — pricing: pure, knows nothing about logging or storage.
function orderTotal(order: Order): number {
  return order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

// AXIS 2 — logging: an interface; the implementation is independent.
interface Logger {
  record(event: string, data: object): void;
}

// AXIS 3 — persistence: an interface; swap the DB without touching pricing.
interface OrderStore {
  save(orderId: string, total: number): void;
}

// Composition root wires the axes together — the ONLY place they meet.
function processOrder(order: Order, log: Logger, store: OrderStore): number {
  const total = orderTotal(order);
  log.record("order_priced", { id: order.id, total });
  store.save(order.id, total);
  return total;
}
```

Now re-do the same change — **"log as JSON to a service":**

```typescript
// New logger implementation. Nothing else in the system changes.
class JsonServiceLogger implements Logger {
  record(event: string, data: object): void {
    fetch("https://logs.internal/ingest", {
      method: "POST",
      body: JSON.stringify({ event, ...data }),
    });
  }
}
```

The pricing function `orderTotal` is **untouched**. Its tests still pass. Every caller is untouched. We swapped one logger for another — exactly like turning the stereo's tone knob without changing the volume. **The change stayed on its own axis.**

| | Non-orthogonal | Orthogonal |
|---|---|---|
| Files touched to change logging | Pricing + all callers + tests | One new `Logger` class |
| Pricing testable in isolation? | No (needs file + DB) | Yes (pure function) |
| Swap the database? | Rewrite `processOrder` | New `OrderStore` impl |
| Two devs changing log + price at once? | Conflict | Independent |

---

## Global State: The Orthogonality Killer

The fastest way to destroy orthogonality is **global mutable state** — data that any code can read and write from anywhere. It creates *invisible* connections between modules that look completely unrelated.

```python
# A global "config" mutated from anywhere.
CONFIG = {"currency": "USD", "tax_rate": 0.0}

def checkout(cart):
    CONFIG["tax_rate"] = 0.20          # module A quietly mutates the global
    return total(cart) * (1 + CONFIG["tax_rate"])

def generate_report(orders):
    # module B reads the SAME global — and is silently affected by checkout()!
    return sum(o.amount * CONFIG["tax_rate"] for o in orders)
```

`checkout` and `generate_report` look unrelated. They live in different files; one is a sales flow, one is reporting. But they share `CONFIG["tax_rate"]`, so **running checkout changes what the report computes.** If a report is generated before any checkout, `tax_rate` is `0.0`; after a checkout it's `0.20`. The output depends on *invisible execution order*. That's the helicopter again — pulling the checkout knob moves the report axis.

The orthogonal fix: **pass what you need; don't reach into a global.**

```python
def checkout(cart, tax_rate):              # tax rate is an explicit input
    return total(cart) * (1 + tax_rate)

def generate_report(orders, tax_rate):     # its own explicit input
    return sum(o.amount * tax_rate for o in orders)
```

Now the two functions share nothing mutable. Calling one cannot affect the other. Each is independently testable (just pass a rate), independently reusable, and independently changeable. **Eliminating shared global state is the single highest-leverage move toward orthogonality.**

---

## How Orthogonality Relates to Coupling and Cohesion

Orthogonality isn't a *new* idea so much as **coupling and cohesion seen from one level up.** It's the system-wide property you get when coupling is low and cohesion is high:

- **[Low coupling](../01-minimise-coupling/junior.md)** means modules don't depend on each other's internals — so a change in one doesn't force a change in another. That's exactly "no effect between things."
- **[High cohesion](../02-maximise-cohesion/junior.md)** means each module groups things that belong together — so a single concern lives on a single axis instead of being smeared across many.

Put them together and you get orthogonality:

> **Orthogonality = system-level decoupling along feature axes.** It's coupling and cohesion viewed as *independent dimensions* of the whole system.

```
   Low coupling  ──┐
                   ├──▶  ORTHOGONALITY
   High cohesion ──┘     (unrelated things vary independently)
```

You don't need to re-learn coupling and cohesion here — see those topics for the mechanics. Orthogonality is the goal those two principles serve when you zoom out to the level of features and concerns.

---

## How to Achieve It

Concrete techniques, each of which keeps a concern on its own axis:

1. **Layering.** Put UI, business logic, and persistence in separate layers, each depending only downward. A UI change can't reach into persistence.
2. **Modular design.** Group each concern into a module with a narrow interface; let modules talk only through those interfaces, not by reaching into each other.
3. **Avoid global state.** Pass dependencies in (parameters, injection) instead of reaching into globals/singletons. (See the example above.)
4. **Keep cross-cutting concerns separate.** Logging, persistence, security, and business logic are different axes — don't braid them. (This is **[Separation of Concerns](../../01-generic/03-separation-of-concerns/junior.md)**; the techniques for isolating cross-cutting ones are explored at higher levels.)
5. **Decouple your toolkits and libraries.** Don't let a third-party library's types leak through your whole codebase. Wrap it so swapping it stays local.
6. **Don't rely on properties you can't control.** If your code depends on the exact internal field of someone else's object, you're coupled to a thing that can change without warning. Depend on stable, published interfaces.

---

## Mental Models

**The intuition:** *"I should be able to turn one knob without any other knob moving."*

```
   ┌──────────────────────────────────────────────┐
   │  ORTHOGONAL                  NON-ORTHOGONAL    │
   │                                                │
   │  ●──▶ pricing                ●─┐               │
   │  ●──▶ logging                  ├─▶ everything  │
   │  ●──▶ storage                ●─┘   tangled     │
   │  ●──▶ UI                                       │
   │  (each dial → one effect)   (any dial → chaos) │
   └──────────────────────────────────────────────┘
```

A second model: think of orthogonality as **keeping the wiring diagram readable.** In an orthogonal system the diagram is a few boxes with a few clearly labeled wires between them. In a non-orthogonal one it's a hairball — every box wired to every other — and no human can predict what a change will do.

---

## Best Practices

1. **Ask "what else will this change affect?"** before you make a change. In an orthogonal design the honest answer is "nothing else." If it's "lots of things," your design is tilted.
2. **Keep concerns on separate axes:** business logic separate from logging, persistence, and UI.
3. **Pass dependencies in; don't reach out to globals.** Explicit inputs keep modules independent.
4. **Hide libraries behind your own thin interface** so swapping them stays a local change.
5. **Give each module a narrow, intentional interface** and talk to it only through that.
6. **Test components in isolation.** If a component can *only* be tested with the whole system running, it isn't orthogonal yet — that's a design signal.

---

## Common Mistakes

1. **Braiding cross-cutting concerns into business logic** — `print`/log/SQL calls sprinkled through pricing code. Every such call ties two axes together.
2. **Global mutable state** — the silent killer; modules become coupled through shared data with no visible wire.
3. **Leaking a library's types everywhere** — now the whole codebase depends on that library; you can't change it without a system-wide edit.
4. **Reaching into another module's internals** — depending on a field or behavior you can't control couples you to its accidents.
5. **Confusing orthogonality with "no dependencies at all."** Some structure is shared on purpose; orthogonality is about keeping *unrelated* things independent, not banning all dependencies.

---

## Tricky Points

- **Orthogonality is about *unrelated* things.** Related things *should* depend on each other. The skill is telling related from unrelated — see [Middle](middle.md) for the contractor/team test that makes this concrete.
- **Perfect orthogonality is impossible.** Every system shares *some* infrastructure (a database, a config, a framework). The goal is to maximize independence where it matters, not to chase a 100% that doesn't exist. (Trade-offs at [Senior](senior.md).)
- **Orthogonality can tension with DRY.** Sometimes keeping two things independent is worth a little duplication, because merging them would couple things that should vary separately. The two principles pull against each other; knowing when to favor each is a senior skill — see [DRY](../../01-generic/07-dry/junior.md) and [Senior](senior.md).
- **A "small" change with a big blast radius is a *measurement* of non-orthogonality.** If a one-line logging tweak touches twenty files, the design — not the change — is the problem.

---

## Test Yourself

1. State the definition of orthogonality in one sentence.
2. Where does the word "orthogonal" come from, and what's the geometric intuition?
3. Explain the helicopter vs. stereo analogy. Which is orthogonal, and why?
4. Name three concrete benefits of orthogonality.
5. Why is global mutable state an enemy of orthogonality?
6. How does orthogonality relate to coupling and cohesion?

<details><summary>Answers</summary>

1. Two or more things are orthogonal if a change in one has **no effect** on the others — "eliminate effects between unrelated things."
2. From geometry/linear algebra: orthogonal vectors meet at right angles and are **independent axes**. Moving along one axis doesn't change your position on another — the software metaphor for "change one concern without affecting others."
3. Helicopter controls are **non-orthogonal**: every input (collective, throttle, pedals, cyclic) affects every axis, so nothing can be adjusted alone — hard to fly. A stereo is **orthogonal**: volume, balance, and tone each affect exactly one thing, so each can be set independently. Aim for the stereo.
4. (Any three) Localized change; reuse; reduced risk via fault isolation; smaller test surface; parallel team work; easier estimation.
5. Because it creates **invisible connections** between modules that look unrelated. Two functions sharing a global are silently coupled — running one changes what the other computes, and the effect depends on execution order. Passing data explicitly removes the hidden wire.
6. Orthogonality is coupling and cohesion **viewed at the system level**: low coupling (a change in A doesn't force a change in B) plus high cohesion (each concern lives on one axis) *is* orthogonality — "decoupling along feature axes."

</details>

---

## Cheat Sheet

```text
ORTHOGONALITY  =  "eliminate effects between unrelated things"
                  (change one part → no effect on the others)

ORIGIN         geometry: independent / perpendicular axes
ANALOGY        stereo (orthogonal) vs helicopter (non-orthogonal)

BENEFITS       localized change · reuse · isolated faults ·
               smaller test surface · parallel team work

ACHIEVE IT     layering · modular interfaces · NO global state ·
               separate cross-cutting concerns · wrap libraries ·
               depend only on things you control

KILLERS        global mutable state · braided cross-cutting concerns ·
               leaked library types · reaching into internals

RELATION       low coupling + high cohesion  =  orthogonality
TENSION        sometimes pulls against DRY (independence > dedup)
```

---

## Summary

- **Orthogonality** = unrelated things stay unrelated: a change in one has **no effect** on the others ("eliminate effects between unrelated things," Hunt & Thomas).
- The word is borrowed from **geometry** — independent, perpendicular axes. The **stereo** (each knob → one effect) is orthogonal; the **helicopter** (every input → every axis) is not.
- Benefits: **localized change, reuse, isolated faults, a smaller test surface, parallel work.**
- **Global mutable state** is the classic killer — it wires unrelated modules together invisibly. Pass dependencies in instead.
- Orthogonality is **coupling and cohesion at the system level**: low coupling + high cohesion = independence along feature axes.

---

## Further Reading

- Andrew Hunt & David Thomas, *The Pragmatic Programmer* — the "Orthogonality" topic, with the helicopter and stereo analogies.
- [Minimise Coupling](../01-minimise-coupling/junior.md) and [Maximise Cohesion](../02-maximise-cohesion/junior.md) — the two principles orthogonality is built from.
- [Separation of Concerns](../../01-generic/03-separation-of-concerns/junior.md) — keeping different kinds of work apart.
- [DRY](../../01-generic/07-dry/junior.md) — and where it tensions with orthogonality.

---

## Related Topics

- **Next:** [Orthogonality — Middle](middle.md)
- **Built from:** [Minimise Coupling](../01-minimise-coupling/junior.md), [Maximise Cohesion](../02-maximise-cohesion/junior.md).
- **Sibling principle:** [Separation of Concerns](../../01-generic/03-separation-of-concerns/junior.md).
- **Tensions with:** [DRY](../../01-generic/07-dry/junior.md), [Optimize for Deletion](../../01-generic/06-optimize-for-deletion/junior.md).

---

## Diagrams

```mermaid
flowchart TB
    subgraph NON["NON-ORTHOGONAL (helicopter)"]
        IN1[Any change] --> A1[pricing]
        IN1 --> A2[logging]
        IN1 --> A3[storage]
        IN1 --> A4[UI]
        A1 -.-> A2
        A2 -.-> A3
        A3 -.-> A4
    end
    subgraph ORT["ORTHOGONAL (stereo)"]
        C1[change pricing] --> B1[pricing only]
        C2[change logging] --> B2[logging only]
        C3[change storage] --> B3[storage only]
    end
```

[Coupling & Cohesion](../../README.md) · [Roadmap](../../../README.md) · **Next:** [Orthogonality — Middle](middle.md)
