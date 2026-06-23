# When to Refactor to Patterns — Junior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

---

## Table of Contents

1. [The one idea to take away](#the-one-idea-to-take-away)
2. [Two ways to meet a pattern](#two-ways-to-meet-a-pattern)
3. [A real-world analogy: the desire path](#a-real-world-analogy-the-desire-path)
4. [The trigger is always a smell](#the-trigger-is-always-a-smell)
5. [Three directions: to, toward, away](#three-directions-to-toward-away)
6. [The smell → pattern table](#the-smell--pattern-table)
7. [A tiny worked example](#a-tiny-worked-example)
8. [Mechanics: the pattern emerges, you don't install it](#mechanics-the-pattern-emerges-you-dont-install-it)
9. [Over-engineering vs under-engineering](#over-engineering-vs-under-engineering)
10. [How this section differs from the design-patterns section](#how-this-section-differs-from-the-design-patterns-section)
11. [Mini Glossary](#mini-glossary)
12. [Review questions](#review-questions)
13. [Next](#next)

---

## The one idea to take away

A design pattern is a **destination you refactor toward** — driven by a problem already living in your code — **not a starting point you impose on a blank page.**

That single sentence is the whole reason this section exists. When most people learn the Gang of Four (GoF) patterns, they learn them as blueprints: "Here is Strategy, here is its class diagram, now go find a place to use it." That habit produces some of the worst code juniors write — code that is elaborate, abstract, and indirect *before it has any reason to be*.

Kerievsky's *Refactoring to Patterns* inverts the order. You don't decide to use a pattern. You write the simplest thing that works, you let the code grow, and when a specific pain appears — duplication, a swelling conditional, a class that changes for five unrelated reasons — *then* you reach for a pattern as the cure, and you get there in small, safe, behavior-preserving steps.

> **The discipline in one line:** the smell comes first, the pattern comes last, and the steps in between are tiny and reversible.

---

## Two ways to meet a pattern

| | **Design patterns (GoF) approach** | **Refactoring to patterns approach** |
|---|---|---|
| Starting point | "I'll use Strategy here." | "This method has a switch I keep editing." |
| Driven by | A catalog of solutions | A concrete smell in real code |
| Risk | You add structure you don't need | You add structure you've proven you need |
| When you arrive | Up front, by design | Gradually, by refactoring |
| If you were wrong | Hard to undo — it's load-bearing | Easy to undo — you refactor back |

Both are valuable. The GoF catalog teaches you *what the destinations look like*. This section teaches you *how to know you need one and how to walk there safely*. They are complementary, not competing.

---

## A real-world analogy: the desire path

Universities used to pour all the concrete walkways first, then plant grass, then watch students cut across the lawn anyway and wear a muddy diagonal line into it — a **desire path**. Smarter campuses do the opposite: they plant grass everywhere, *wait to see where people actually walk*, and pave those lines later.

Patterns are the same. If you pave every path you *imagine* someone might want, you get a maze of empty walkways nobody uses (over-engineering). If you wait until a path is worn into the grass — until the duplication, the repeated edits, the painful conditional is *visibly there* — you pave exactly the paths that earn their cost.

The worn line in the grass is the **smell**. The pavement is the **pattern**.

---

## The trigger is always a smell

You should never start a refactoring with "I want to use pattern X." You start with a *symptom*. The most common triggers:

- **Duplication** — the same logic copy-pasted, especially duplicated `switch`/`if-else` chains that branch on the same thing in several places.
- **Conditional complexity** — a method that grows a new `case` every time a requirement changes.
- **Divergent change** — one class edited for many unrelated reasons. (See [Change Preventers](../../01-code-smells/03-change-preventers/junior.md).)
- **Shotgun surgery** — one conceptual change forces edits across many files.
- **Primitive obsession / hard-coded structure** — a tree of objects faked with nested maps and flags.

If you can't name the smell, you don't yet have a reason to introduce a pattern. "It might be useful later" is not a smell — it's a guess. (That guess has its own name: **speculative generality**, a [dispensable smell](../../01-code-smells/04-dispensables/junior.md).)

---

## Three directions: to, toward, away

Most teaching covers only the first direction. All three matter.

### 1. Refactor **to** a pattern

You go all the way. The smell is bad enough and the pattern fits cleanly, so you finish the journey and arrive at a full Strategy / Decorator / Composite.

### 2. Refactor **toward** a pattern

You go *partway* and stop, because partway already removed the pain. Maybe you extracted two subclasses and a common interface — that's halfway to a full Template Method — but the third variation hasn't appeared yet, so you wait. **Stopping early is a legitimate, often correct outcome.** A half-built pattern that solves today's problem beats a full pattern built on a guess about tomorrow.

### 3. Refactor **away from** a pattern

A pattern someone added earlier no longer earns its keep. The Strategy has exactly one strategy. The Factory builds exactly one product. The Observer has one observer that never changes. The indirection costs more than it gives. So you **remove the pattern** and inline it back to something direct.

This third direction is the one almost everyone forgets, and it's a sign of real engineering maturity. Patterns are not trophies; an unused one is just overhead. We cover it in depth in [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/junior.md).

> **Caveat:** "away from" is not an excuse to rip out every pattern you don't immediately understand. Remove a pattern only when you can show it carries no variation it was meant to absorb — when it has exactly one of the thing it abstracts, and no concrete plan to grow.

---

## The smell → pattern table

This is the heart of the section: a decision table mapping a *symptom* to a likely *destination*. Treat it as a hypothesis generator, not a law. Each row links to the pattern's full definition in the design-patterns section.

| Smell you observe | Likely destination | Why |
|---|---|---|
| Duplicated conditional that branches on a type code, repeated in several methods | [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md), [State](../../../design-patterns/03-behavioral/07-state/junior.md), or plain **polymorphism** (Replace Conditional with Polymorphism) | Each branch becomes a class; the dispatch becomes a virtual call |
| Many similar algorithms that differ in **one** step | [Template Method](../../../design-patterns/03-behavioral/09-template-method/junior.md) | Hoist the common skeleton; leave the varying step abstract |
| Complex, error-prone object construction (telescoping constructors, half-built objects) | [Builder](../../../design-patterns/01-creational/03-builder/junior.md) or [Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md) | Move construction logic out of the caller into a dedicated place |
| Conditional logic that **adds optional behavior** ("if gift-wrapped, if express, if insured…") | [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md) | Stack each optional behavior as a wrapper instead of a flag |
| A tree faked with nested maps, flags, or `isLeaf` checks everywhere | [Composite](../../../design-patterns/02-structural/03-composite/junior.md) | Treat leaf and branch through one interface; recursion replaces the flags |
| `instanceof` ladder + downcasts that switch on object type | [Visitor](../../../design-patterns/03-behavioral/10-visitor/junior.md) or polymorphism | Move the per-type behavior onto the types |
| A growing `if/else` selecting one handler from a list | [Chain of Responsibility](../../../design-patterns/03-behavioral/01-chain-of-responsibility/junior.md) | Each handler decides whether to act or pass along |
| Two interfaces that should talk but don't match | [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md) | Wrap one to speak the other's language |

> **Read the table as:** "If I see *this*, *one of these* might be where I'm headed — let me confirm with the mechanics." Never as: "If I see this, install that immediately."

---

## A tiny worked example

A duplicated conditional dispatch — the most common road into a pattern.

### Before — the smell

```java
class Shipping {
    BigDecimal cost(Order o) {
        switch (o.method()) {
            case GROUND:  return o.weight().multiply(new BigDecimal("0.50"));
            case AIR:     return o.weight().multiply(new BigDecimal("2.00"));
            case OVERNIGHT: return o.weight().multiply(new BigDecimal("5.00"));
            default: throw new IllegalArgumentException();
        }
    }

    int estimatedDays(Order o) {
        switch (o.method()) {          // the SAME switch, again
            case GROUND:  return 5;
            case AIR:     return 2;
            case OVERNIGHT: return 1;
            default: throw new IllegalArgumentException();
        }
    }
}
```

The same `switch (o.method())` appears twice. Every new shipping method means editing *both* methods — and any other method that branches on the same thing. That's the smell: **duplicated conditional dispatch**. The table points to Strategy / polymorphism.

### After — refactored toward Strategy

```java
interface ShippingMethod {
    BigDecimal cost(BigDecimal weight);
    int estimatedDays();
}

class Ground implements ShippingMethod {
    public BigDecimal cost(BigDecimal w) { return w.multiply(new BigDecimal("0.50")); }
    public int estimatedDays() { return 5; }
}
class Air implements ShippingMethod {
    public BigDecimal cost(BigDecimal w) { return w.multiply(new BigDecimal("2.00")); }
    public int estimatedDays() { return 2; }
}
class Overnight implements ShippingMethod {
    public BigDecimal cost(BigDecimal w) { return w.multiply(new BigDecimal("5.00")); }
    public int estimatedDays() { return 1; }
}
```

Now `Shipping` just delegates: `o.method().cost(o.weight())`. A new method is **one new class**, not edits scattered across every `switch`. The duplicated dispatch is gone.

> **When NOT to do this:** if there's exactly one `switch` on `method()` in the whole codebase and it has three stable branches that haven't changed in two years, leave it. A single, small, stable conditional is *clearer* as a `switch` than as five files. The pattern earns its keep when the branching is *duplicated* or *churning* — not just because branching exists.

---

## Mechanics: the pattern emerges, you don't install it

You don't rewrite `Shipping` into Strategy in one big commit. You get there with a sequence of tiny, behavior-preserving moves, **running tests after every one**:

1. Extract the first branch's body into a method, run tests. (Green.)
2. Create the `ShippingMethod` interface and a `Ground` class, move the body in, run tests. (Green.)
3. Point one call site at `Ground`, run tests. (Green.)
4. Repeat for `Air`, `Overnight`.
5. Delete the now-dead `switch`, run tests. (Green.)
6. Commit.

Each step is reversible. If step 3 breaks a test, you've changed almost nothing and can see exactly what. This is the opposite of "rewrite it over the weekend." Kerievsky's book is fundamentally a *catalog of these step sequences* — one named sequence per pattern destination. The pattern is the result, not the plan.

This is the lineage of **Kent Beck and Martin Fowler**:

> **"Make the change easy, then make the easy change."** — refactor to a shape where the new requirement is trivial, *then* add it.

> **When NOT to take tiny steps:** never. Tiny steps are non-negotiable on code that has tests and matters. The only time you "install in one leap" is throwaway code or a spike you'll delete.

---

## Over-engineering vs under-engineering

Patterns live on a spectrum between two failure modes:

```
UNDER-ENGINEERED  <------------------ patterns live here ------------------>  OVER-ENGINEERED
   copy-paste,         the simplest design that absorbs            "pattern fever":
   one giant switch,   the change you actually have                Strategy with one strategy,
   no abstraction      ("just barely enough structure")            AbstractFactoryFactory,
                                                                    layers nobody asked for
```

- **Under-engineering** is the smell catalog: duplication, long methods, big conditionals. The cure is *adding* structure (refactor to a pattern).
- **Over-engineering** — also called **"patterns-happy"** or **pattern fever** — is adding structure nobody needs. Its named smells are **speculative generality** (built for an imagined future) and **needless complexity**. The cure is *removing* structure (refactor away from a pattern, [topic 05](../05-refactoring-away-from-patterns/junior.md)).

The guiding principle against over-engineering is **YAGNI** — "You Aren't Gonna Need It." (See [YAGNI](../../../design-principles/01-generic/02-yagni/junior.md).) Don't build the flexible thing until the inflexibility actually hurts. Refactoring to patterns is YAGNI's friend: it lets you stay simple *now* because you trust you can evolve to the pattern *later*, cheaply, when the need is real.

> **Caveat in the other direction:** YAGNI is not "never abstract." Once you have a *real, present* smell — duplicated dispatch you keep editing — refusing to extract the pattern is itself a failure (under-engineering). Judgment is knowing which side of the line you're on.

---

## How this section differs from the design-patterns section

A common confusion: "Didn't I already learn Strategy in the design-patterns section?" Yes — and these two sections do genuinely different jobs.

| | **design-patterns section** | **this section (refactoring-to-patterns)** |
|---|---|---|
| Teaches | **What** each pattern is — structure, participants, intent | **The journey** — smell → mechanical steps → pattern |
| Central artifact | The pattern's class diagram | The sequence of tiny refactorings |
| Question answered | "What does Strategy look like?" | "How do I know I need it, and how do I get there safely?" |
| Also teaches | — | The *judgment* of whether to take the trip at all (and when to turn back) |

So when this section needs to remind you what a Decorator *is*, it **links** to the design-patterns section rather than re-explaining it. Your job here is the *decision* and the *route*, not the destination's blueprint.

---

## Mini Glossary

- **Refactor to a pattern** — complete the journey from a smell to a full, recognizable pattern.
- **Refactor toward a pattern** — go partway and stop, because partway already removed the pain.
- **Refactor away from a pattern** — remove a pattern that no longer earns its indirection.
- **Smell** — a surface symptom (duplication, big conditional) hinting at a deeper design problem; the *trigger* for refactoring.
- **Behavior-preserving** — a change that doesn't alter what the program does, only its internal shape. Tests should stay green.
- **Speculative generality** — structure added for an imagined future need that never arrives; the core over-engineering smell.
- **Pattern fever / patterns-happy** — the habit of reaching for a pattern as a first move rather than a last resort.
- **YAGNI** — "You Aren't Gonna Need It": don't build flexibility until a real need demands it.
- **Mechanics** — the named, ordered sequence of tiny steps that takes you from smell to pattern.

---

## Review questions

1. **Is a design pattern a starting point or a destination?** A destination you refactor *toward*, driven by a real smell — not a blueprint you impose on a blank page.

2. **What must come before you introduce a pattern?** A named smell — duplication, a churning conditional, divergent change. "I want to use pattern X" is not a valid reason.

3. **Name the three directions.** *To* a pattern (finish the journey), *toward* a pattern (stop partway), and *away from* a pattern (remove one that no longer earns its keep).

4. **A `switch` on order type appears in five different methods. Where might you be headed?** Strategy / State / polymorphism — duplicated conditional dispatch is the classic road to Strategy. Confirm with the mechanics, don't install blindly.

5. **What is "pattern fever"?** Reaching for patterns as a first move, producing structure nobody needs — over-engineering. Its named smell is speculative generality; its antidote is YAGNI.

6. **Why take tiny steps instead of rewriting?** Each step is behavior-preserving and reversible; tests stay green; if something breaks you've changed almost nothing and can see exactly what.

7. **When should you stop *toward* a pattern?** When the partial refactoring already removes the pain and the remaining variation hasn't actually appeared. A half-pattern that solves today's problem beats a full pattern built on a guess.

8. **How is this section different from the design-patterns section?** That section teaches *what* a pattern is (its diagram); this section teaches the *journey* (smell → steps → pattern) and the *judgment* of whether to take it.

---

## Next

- [middle.md](middle.md) — when to actually pull the trigger: cost/benefit, the rule of three, partial refactoring, team considerations.
- [senior.md](senior.md) — judgment at scale: pattern density, evolutionary architecture, sequencing multiple refactorings.
- [professional.md](professional.md) — the economics: the cost of the wrong abstraction, measuring before/after, refactoring under deadline.
- [interview.md](interview.md) — interview questions and model answers.
- [tasks.md](tasks.md) — decide *if* and *which* pattern for real snippets.
- [find-bug.md](find-bug.md) — spot patterns applied too early or wrongly.
- [optimize.md](optimize.md) — propose the right refactoring-to-pattern for smelly code.
