# When to Refactor to Patterns — Middle Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

You know *what* the move is — smell first, pattern last, tiny steps. The middle-level question is sharper and harder: **given a real smell, do I pull the trigger now, or not yet, or not at all?** Introducing a pattern is never free. This file is about pricing the trade and reading the smell well enough to make the call.

---

## The cost side of the ledger

Every pattern you introduce buys flexibility and pays for it in **indirection**. Before you refactor *to* a pattern, name what it costs:

- **More moving parts.** A Strategy turns one 15-line method into an interface plus N classes. A reader now jumps across files to follow one request.
- **A harder "where does this happen?" question.** Polymorphic dispatch hides *which* code runs behind a virtual call. Great when there are ten variants; pure overhead when there are two.
- **A wiring problem.** Someone has to *choose* and *inject* the right strategy/decorator/handler. That choice often becomes a new factory or a new `switch` — sometimes you've just moved the conditional, not removed it.
- **A learning tax.** The next person must recognize the pattern to navigate the code. A named pattern pays this back; a half-recognized one doesn't.

The benefit must beat that cost *for the change pressure you actually have* — not the pressure you imagine.

```
Worth it when:  variation is real + recurring + likely to grow
Not worth it:   variation is hypothetical, or stable at 2 cases that never change
```

---

## The rule of three, applied to patterns

Fowler's **rule of three**: the first time you do something, just do it. The second time you do something similar, wince but duplicate. The **third** time, refactor.

Applied to patterns: **don't extract a pattern at the first or even second instance of variation.** Two implementations of an algorithm don't justify a Strategy — they justify a small duplication you can read at a glance. The *third* variant is the signal that variation is a real axis, not a coincidence, and now the pattern pays.

```java
// One payment type. No pattern. A method.
BigDecimal fee(Payment p) { return p.amount().multiply(CARD_RATE); }

// Two payment types. Still no pattern — a small switch reads fine.
BigDecimal fee(Payment p) {
    return switch (p.type()) {
        case CARD -> p.amount().multiply(CARD_RATE);
        case WIRE -> WIRE_FLAT;
    };
}

// Third type arrives, and the same switch is now duplicated in fee(), limit(), and settleTime().
// THREE call sites branching on type() = duplicated conditional dispatch. NOW extract to Strategy.
```

> **The exception to the rule of three:** when you already *know* — not guess — that more variants are coming because they're written down in the next three sprints, you may pull the trigger at two. The standard isn't a magic number; it's *evidence of recurrence*. The number three is just the most common point where evidence becomes undeniable.

---

## Reading the smell correctly

The biggest middle-level mistake is mapping a smell to the *wrong* pattern because you read the smell shallowly. Two examples:

### Strategy vs State — both come from a conditional, and they're different

A duplicated `switch` could point to either. The discriminator: **does the branch variable change over the object's lifetime, and do the branches *transition between each other*?**

- Shipping method per order doesn't change mid-flight, and Ground never "becomes" Air → **Strategy** ([Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md)).
- An order moves `PLACED → PAID → SHIPPED → DELIVERED`, and each state decides the *next* state → **State** ([State](../../../design-patterns/03-behavioral/07-state/junior.md)).

Same surface smell (`switch (something)`), different destination, because the underlying *motion* differs.

### "Optional behavior" → Decorator, not subclass explosion

A conditional that *adds* behavior ("if gift-wrapped, add wrapping cost; if insured, add insurance; if express, add surcharge") looks like it wants a subclass per combination — but that's `2^n` subclasses. The combinatorial explosion is the tell that you want [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md): stack each option as an independent wrapper.

> **When NOT to map at all:** if the smell is a *single* small conditional that isn't duplicated and isn't growing, no pattern applies. The right "refactoring" is [Decompose Conditional](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md) — extract the branches into well-named methods and stop. Not every conditional is a latent pattern.

---

## Partial refactoring is a first-class outcome

Refactoring *toward* a pattern — and stopping — is not a failure of nerve; it's often the correct read of the evidence.

Suppose you have the shipping `switch` duplicated across two methods. You extract an interface and two classes (`Ground`, `Air`). You've now removed the *duplication* — the dispatch lives in one place per type. You have *not* built a configurable, plugin-style Strategy with a registry and runtime selection, because nobody has asked to add methods at runtime. You stopped at "polymorphism," which is *toward* Strategy.

```
smell ──► extract interface + classes ──► [STOP HERE] ──► registry/DI ──► full plugin Strategy
          (removes duplication)          (today's pain gone)            (only if runtime
                                                                          extensibility is needed)
```

The skill is recognizing when "toward" has already paid for itself. Going further than the smell justifies is just over-engineering with extra steps.

> **When NOT to stop early:** if you stop in a *visibly half-built* state that's now *harder* to read than either endpoint — an interface with one implementor, a factory that builds one thing — you've created a new smell. Either finish the journey or refactor back. "Toward" must leave the code in a clean, coherent shape, not a construction site.

---

## Team and review considerations

Refactoring to a pattern is a communication act as much as a code change. The pattern's *name* is a shared vocabulary — if your reviewer recognizes "this is now a Strategy," the diff explains itself.

Practical guidance:

- **Separate the refactoring from the feature.** Land "refactor `Shipping` to Strategy (no behavior change)" as its own PR; land "add Overnight shipping" as the next. A reviewer can verify the first is behavior-preserving (tests unchanged, all green) and the second is tiny. Mixing them hides both.
- **Name the destination in the PR title.** "Replace shipping-cost `switch` with Strategy" tells the reviewer the *shape* to expect and lets them judge whether the trade is worth it.
- **Make the smell visible in the description.** "This `switch` is duplicated in `cost()`, `estimatedDays()`, and `validate()`; adding a method currently means editing three places." That's the justification, and it pre-empts "why are you adding all these classes?"
- **Be ready to be told no.** A reviewer who says "two cases, leave the `switch`" may be right. The rule of three is a team agreement, not a personal preference.

---

## Cost/benefit, as a checklist

Before you commit to refactoring *to* a pattern, you should be able to answer yes to most of these:

1. **Can I name the smell** without saying the pattern's name? (If the only justification is "to use Strategy," stop.)
2. **Is the variation real and recurring** — at least three instances, or written-down upcoming ones?
3. **Will the indirection pay back** — i.e., is "add a new case" genuinely frequent, or a once-a-year event?
4. **Can I get there in tiny green steps**, or does it require a risky big-bang? (If big-bang, the code isn't ready — add tests first.)
5. **Will a reviewer recognize the destination** as a known pattern? (Recognizability is what makes the indirection cheap to navigate.)
6. **Is there a simpler refactoring** — Extract Method, Decompose Conditional — that removes the pain without a pattern? (Prefer it.)

If you can't answer yes to #1 and #2, you're about to over-engineer. Don't.

---

## A note on "make the change easy, then make the easy change"

When a new requirement lands and the current shape fights you, you have two moves and an order:

1. **First**, refactor (possibly to/toward a pattern) so the code is in a shape where the new requirement is a trivial addition. No behavior change. Tests green.
2. **Then** make the now-easy change.

The pattern, when one is involved, belongs in step 1 — it's how you *make the change easy*. If a requirement doesn't actually need a pattern to land easily, step 1 might just be an Extract Method, and you never reach for a pattern at all. The requirement, not the catalog, decides.

> **When NOT to refactor-first:** if the easy change is genuinely easy *right now* in the current shape, skip step 1. Refactoring "to be safe" before a change that's already simple is wasted motion — and a sneaky path into speculative generality.

---

## Next

- [junior.md](junior.md) — the core idea, the smell→pattern table, the three directions.
- [senior.md](senior.md) — judgment at scale: pattern density, sequencing, when a smell is a deeper design problem.
- [professional.md](professional.md) — the economics: the cost of the wrong abstraction, measuring impact, deadline pressure.
- [interview.md](interview.md) — interview questions and model answers.
- [tasks.md](tasks.md) — decide *if* and *which* pattern for real snippets.
- [find-bug.md](find-bug.md) — spot patterns applied too early or wrongly.
- [optimize.md](optimize.md) — propose the right refactoring-to-pattern.
