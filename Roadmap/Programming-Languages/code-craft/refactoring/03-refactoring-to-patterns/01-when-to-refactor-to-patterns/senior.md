# When to Refactor to Patterns — Senior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

At the senior level the unit of concern is no longer "should this `switch` become a Strategy?" It's "what does the *density* of patterns in this module say about its design, and in what *order* do I apply a series of refactorings so the system gets simpler at every step rather than worse in the middle?" This file is about judgment across many refactorings, many modules, and time.

---

## Pattern density: too few, too many, just right

A useful diagnostic is **pattern density** — roughly, how many patterns are packed into a unit of code relative to the variation it actually absorbs.

- **Density too low** in a module that *churns*: every requirement is a `switch` edit, duplication is everywhere, change is expensive. This is under-engineering — the module is starving for structure.
- **Density too high** in a module that's *stable*: Factory → Strategy → Decorator → Observer all stacked to handle variation that never materializes. Reading one request means traversing six files. This is over-engineering — the module is drowning in structure it doesn't use.
- **Right density** tracks **change**: structure concentrates exactly where the code actually varies, and stays flat where it doesn't.

The senior insight: **density should be a function of observed change, not of the architect's taste.** Audit it by overlaying the pattern map on the *git churn* map. Where they agree, the design is healthy. Where you have heavy patterns over cold, stable code — that's a candidate for refactoring *away* from patterns. Where you have hot, churning code with no structure — that's a candidate for refactoring *to* one.

> **When the diagnostic lies:** churn can be low because a module is so painful nobody dares touch it (avoidance, not stability). Don't conclude "stable, remove the structure" without asking whether low churn means *settled* or *feared*.

---

## Designing for changeability without speculation

The senior tension is real: you want code that's *easy to change*, but the cheapest way to be easy-to-change in the moment is to over-generalize, which is exactly the trap. The resolution is a stance, not a rule:

> **Build for the change you have; design so the change you don't have yet is cheap to add later.**

Refactoring-to-patterns *is* this stance operationalized. You stay simple now (YAGNI — [YAGNI](../../../design-principles/01-generic/02-yagni/junior.md)) precisely *because* you trust your team's refactoring discipline to evolve the simple thing into the pattern *when* the need is real and *cheaply*, in tiny green steps. The thing that makes deferral safe is **a strong test suite + small reversible steps**. Without those, deferral becomes "we'll never be able to change this," and teams over-engineer up front out of fear.

So the senior move isn't choosing flexibility-now vs simplicity-now. It's **investing in the capability to evolve** (tests, refactoring fluency, CI) so that simplicity-now stops being risky.

This connects to the Open/Closed Principle ([OCP](../../../design-principles/04-solid/02-ocp-open-closed/junior.md)): OCP is the *destination* (open for extension, closed for modification), but you reach it by refactoring *to* it under the pressure of a second or third change — not by predicting every extension point on day one. Premature OCP is just speculative generality wearing a SOLID badge.

---

## How patterns interact (and compound)

At scale, patterns rarely arrive alone. Knowing how they combine is part of sequencing them:

- **Factory + Strategy.** Once you have a family of strategies, *something* must choose one. That choice tends to become a Factory ([Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md)) or a registry. Watch for the choice degenerating back into the `switch` you just removed — if the factory is one big `switch (type)`, you've relocated the smell, not cured it. Sometimes the right fix is a self-registering map keyed by type.
- **Composite + Visitor.** A [Composite](../../../design-patterns/02-structural/03-composite/junior.md) tree invites operations that traverse it; piling those operations onto the node classes causes divergent change. [Visitor](../../../design-patterns/03-behavioral/10-visitor/junior.md) externalizes them — but only once you have *several* such operations. One traversal doesn't justify a Visitor.
- **Decorator + Strategy.** Decorators add behavior; strategies swap it. Confusing them produces decorators that replace rather than augment, or strategies that wrap. The discriminator is *augment vs replace*.
- **Template Method → Strategy.** [Template Method](../../../design-patterns/03-behavioral/09-template-method/junior.md) uses inheritance to vary a step; when the inheritance hierarchy gets rigid or you need to vary the step at runtime, the natural next refactoring is *from* Template Method *to* Strategy (composition over inheritance). Kerievsky catalogs this exact migration.

The lesson: a pattern is rarely a final state. It's a node in a graph of designs, and good seniors know which neighboring nodes a given pattern tends to lead to next.

---

## Sequencing multiple refactorings

When a module needs several changes, the order matters because the wrong order leaves the code worse *in the middle* — a half-done state that's harder to reason about than where you started, and dangerous to ship.

Heuristics for sequencing:

1. **Remove duplication before extracting abstractions.** Duplication tells you *where the seams are*. If you abstract before consolidating, you abstract the wrong shape and have to redo it.
2. **Simplify conditionals before introducing polymorphism.** A [Decompose Conditional](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md) and Consolidate Conditional clarify *what actually varies*; only then is "Replace Conditional with Polymorphism" a clean move rather than a guess.
3. **Add characterization tests first** if the code is legacy and untested. You cannot refactor safely toward a pattern in code whose behavior you can't pin down. The tests are step zero, always.
4. **Each refactoring must leave green tests and a coherent shape.** Never sequence two refactorings such that you *must* ship the intermediate. If you can't avoid a messy middle, branch it or break the journey differently.
5. **Land each named refactoring as its own commit/PR.** Reviewability and revertability are part of the design, not an afterthought.

```
BAD order:  introduce Strategy ─► then notice the branches were duplicated ─► redo the Strategy
GOOD order: consolidate duplicated branches ─► see the real axis of variation ─► extract Strategy once
```

---

## When a smell is a symptom of a deeper design problem

The trap of refactoring-to-patterns is treating a *systemic* problem with a *local* pattern. A pattern applied to a symptom can entrench the disease.

Signals that the smell is deeper than the method in front of you:

- **The same conditional branches on the same type code in many unrelated modules.** That's not "extract a Strategy here" — it's a missing domain concept. The type code wants to *become a polymorphic type* across the whole system, or the model is missing an entity. Patching each site with a local pattern multiplies the indirection without curing the root.
- **Shotgun surgery survives the refactoring.** If after introducing the pattern, a new requirement *still* touches many files, the boundary is wrong. The pattern was a band-aid over a misplaced module seam. (See [Change Preventers](../../01-code-smells/03-change-preventers/senior.md).)
- **The "variation" is really a missing abstraction in the data, not the behavior.** Sometimes a long conditional exists because the data is shaped wrong (primitive obsession). Fix the data model and the conditional evaporates — no behavioral pattern needed.

> **The senior discipline:** before applying a pattern, ask *"if this works, will the next similar requirement be easy?"* If the honest answer is "no, I'll be back here applying the same pattern again next door," you have a deeper design problem and the pattern is premature. Step back to the model.

---

## Evolutionary architecture: patterns as fitness, not fixtures

At the architectural scale, the same philosophy holds: you don't design the final structure up front; you let it *emerge* under guard-rails. Patterns are local instances of this — each one is an evolutionary step the code took *because a real force pushed it there*.

Two practices keep the evolution honest:

- **Fitness functions / guard-rails.** Tests, architecture-fitness checks, and CI are what make it safe to defer structure. They're the immune system that lets you stay simple without fear.
- **Reversibility budget.** Track which patterns are load-bearing (carry real variation) and which are dead weight. Periodically refactor *away* from the dead-weight ones. A codebase that only ever accretes patterns and never sheds them is not evolving — it's calcifying. (See [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/senior.md) and the [abstraction-failures](../../../anti-patterns/02-design/03-abstraction-failures/senior.md) anti-patterns.)

> **When NOT to evolve incrementally:** some structural changes genuinely can't be reached by small steps from where you are (e.g., a fundamental data-model or boundary error). Recognizing the rare case that needs a deliberate, planned redesign — rather than another local pattern — is itself a senior judgment. Don't refactor-to-pattern your way around a foundation that's cracked.

---

## Next

- [junior.md](junior.md) — the core idea, the smell→pattern table, the three directions.
- [middle.md](middle.md) — pulling the trigger: cost/benefit, the rule of three, partial refactoring.
- [professional.md](professional.md) — the economics: the cost of the wrong abstraction, measuring impact, deadline pressure, buy-in.
- [interview.md](interview.md) — interview questions and model answers.
- [tasks.md](tasks.md) — decide *if* and *which* pattern for real snippets.
- [find-bug.md](find-bug.md) — spot patterns applied too early or wrongly.
- [optimize.md](optimize.md) — propose the right refactoring-to-pattern.
