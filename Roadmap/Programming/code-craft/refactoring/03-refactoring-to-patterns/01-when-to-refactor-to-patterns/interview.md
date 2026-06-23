# When to Refactor to Patterns — Interview Q&A

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

Each question has a strong model answer. The bar isn't reciting a pattern's diagram — it's demonstrating the *judgment* of when to apply one, when not to, and how to get there safely.

---

### Q1. What's the core difference between "design patterns" (GoF) and "refactoring to patterns"?

A pattern in the GoF sense is often taught as a *starting point*: pick it from a catalog and build to its blueprint. Refactoring-to-patterns treats a pattern as a **destination you refactor toward**, driven by a concrete smell already in the code. The GoF section answers "what does Strategy look like?"; this approach answers "how do I know I need it, and how do I get there safely, in tiny steps?" They're complementary — one teaches the destinations, the other the journey and the judgment of whether to take it.

---

### Q2. What is the *trigger* for refactoring to a pattern? What is explicitly *not* a trigger?

The trigger is always a **smell**: duplicated conditional dispatch, conditional complexity that keeps growing, divergent change, shotgun surgery, a hard-coded structure. What's *not* a trigger: "I want to use pattern X." If your only justification is the pattern's name, you're about to over-engineer. You must be able to name the pain without naming the pattern.

---

### Q3. Name and explain the three directions.

1. **Refactor *to* a pattern** — complete the journey to a full, recognizable pattern.
2. **Refactor *toward* a pattern** — go partway and stop, because partway already removed the pain (e.g., extract polymorphism without building a full runtime-configurable Strategy).
3. **Refactor *away from* a pattern** — remove a pattern that no longer earns its indirection (a Strategy with one strategy, a Factory building one product).

The third is the one most people forget, and the maturity signal in this question. Patterns aren't trophies; an unused one is pure overhead.

---

### Q4. Give a concrete example of when you would *not* refactor to a pattern.

A `switch` on shipping method that exists in exactly one place, has three stable branches, and hasn't changed in two years. A single small stable conditional is *more* readable as a `switch` than as an interface plus three classes. The pattern earns its keep when the dispatch is *duplicated* or *churning* — not merely because branching exists. Replacing it would be over-engineering: more files, more indirection, no payoff.

---

### Q5. What is Sandi Metz's rule about duplication, and why does it dominate the pattern catalog?

**"Duplication is far cheaper than the wrong abstraction."** Removing duplication has a known, bounded cost (you can always re-duplicate). Removing a *wrong* abstraction has an unbounded cost: callers grow around it, special-case it with flags, and bend it to fit cases it was never shaped for, until nobody dares delete it. So when you're unsure whether an abstraction is right, prefer the duplication and wait — duplication shows you the true shape of the variation. Extract only when the shape has stopped wobbling.

---

### Q6. How does the "rule of three" apply to patterns?

First instance: just write it. Second: wince and duplicate. Third: refactor. Two implementations of an algorithm don't justify a Strategy — they justify small, readable duplication. The *third* variant is the evidence that variation is a real, recurring axis rather than a coincidence, so the pattern now pays. The number three isn't magic; it's the point where *evidence of recurrence* usually becomes undeniable. (Exception: if upcoming variants are already written down in the next sprints, you may pull the trigger at two — the standard is evidence, not the number.)

---

### Q7. What are the signs of over-engineering with patterns?

"Pattern fever" / patterns-happy: reaching for a pattern as a *first* move. Concrete signs — an interface with exactly one implementor, a Strategy with one strategy, a Factory building one product, an Observer with one fixed observer, abstraction layers nobody asked for, and the justification being "for future flexibility" rather than a present smell. The named smell is **speculative generality**; the antidote is **YAGNI**. The fix is to refactor *away* from the pattern back to something direct.

---

### Q8. Same surface smell — a `switch` — could lead to Strategy or State. How do you tell them apart?

Ask whether the branch variable *changes over the object's lifetime and whether the branches transition between each other*. If it's fixed and the branches never become one another (shipping method per order), it's **Strategy**. If the object moves through the values and each value decides the *next* one (an order going `PLACED → PAID → SHIPPED → DELIVERED`), it's **State**. Same `switch (x)` on the surface; different destination because the underlying motion differs.

---

### Q9. Why do tiny, behavior-preserving steps matter? Why not just rewrite into the pattern?

Each tiny step keeps tests green and is reversible. If step 3 of a 6-step sequence breaks a test, you've changed almost nothing and can see exactly what. A big-bang rewrite into a pattern fails silently and is hard to bisect. Kerievsky's book is essentially a catalog of these *step sequences*, one per destination. The pattern is the *result* of the steps, not a plan you execute in one leap. Rewriting in one go is acceptable only for throwaway code or a spike you'll delete.

---

### Q10. A conditional adds *optional* behavior — gift-wrap, insurance, express. What pattern, and why not subclassing?

**Decorator.** Subclassing every combination is `2^n` classes (`GiftWrappedInsuredExpress`, etc.) — combinatorial explosion, which is the tell. Decorator lets each option be an independent wrapper you *stack* at runtime, so three options compose without a class per combination. The discriminator vs Strategy: Decorator *augments* behavior; Strategy *replaces* it.

---

### Q11. You introduced a Strategy, but choosing the right strategy is now a big `switch`. What happened, and how do you fix it?

You **relocated** the smell rather than removing it — the duplicated dispatch moved into the factory. Fixes: a self-registering map keyed by type (`Map<Type, Strategy>`) populated by each strategy, or polymorphic creation, so there's no central `switch`. If the only `switch` left is a *single* small one in the factory and it's not duplicated, that's often fine — a factory is allowed one creation conditional. The smell was the *duplication* across many methods, and that's gone.

---

### Q12. What does "make the change easy, then make the easy change" mean for patterns?

First refactor the code (possibly to/toward a pattern) into a shape where the new requirement is a trivial addition — no behavior change, tests green. *Then* make the now-easy change. The pattern, when one is involved, belongs in step one — it's *how* you make the change easy. If the change is already easy in the current shape, skip the refactor entirely; refactoring "to be safe" before an already-simple change is wasted motion and a path into speculative generality.

---

### Q13. When is a smell actually a symptom of a *deeper* design problem that a local pattern won't fix?

When the same conditional branches on the same type code across many *unrelated* modules (a missing domain concept, not a local Strategy), when shotgun surgery *survives* the refactoring (the module boundary is wrong), or when the "variation" is really a misshapen data model (fix the data and the conditional evaporates). The test: ask "if this pattern works, will the *next* similar requirement be easy?" If the honest answer is "no, I'll be applying the same pattern next door," the pattern is premature — step back to the model.

---

### Q14. How would you justify a refactoring-to-pattern to a skeptical product manager under deadline?

Translate the smell into business cost, not pattern names: "Every new payment method currently takes three days and touches five files because the logic is duplicated; after this refactor it's a half-day and one file." Then keep the refactor as its *own* low-risk, behavior-preserving PR with green tests, and follow it with a tiny PR adding the next variant to *demonstrate* the payoff. PMs buy cycle-time and risk reduction, not OCP.

---

### Q15. When should you refactor *away* from a pattern, and what's the danger in doing so?

When the pattern carries no variation it was meant to absorb — exactly one strategy, one product, one observer — and no concrete plan to grow. The indirection then costs more than it gives, so you inline it back to something direct. The danger: using "away from" as an excuse to rip out patterns you simply don't understand. Remove a pattern only when you can *show* it has one of the thing it abstracts and no real growth coming — not because it looks unfamiliar.

---

### Q16. You're adding a feature to untested legacy code that clearly wants a pattern. What's your sequence?

Tests first, always. Add **characterization tests** that pin down the current behavior (even if that behavior is weird), get them green, *then* refactor toward the pattern in tiny steps with the tests as a safety net, *then* add the feature. Refactoring untested code toward a pattern is how you introduce silent regressions. Under deadline, the fallback is: characterization tests → minimal feature change → defer the pattern as a logged debt ticket with a trigger condition.
