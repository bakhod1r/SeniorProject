# Dealing with Generalization — Interview Q&A

> 50+ questions on the 12 techniques.

---

## Conceptual (Q1–Q14)

**Q1.** What does Pull Up Field do?
A. Move a field from multiple subclasses up to a common superclass.

**Q2.** What does Pull Up Method do?
A. Move a duplicated method from subclasses up to the superclass.

**Q3.** What does Pull Up Constructor Body do?
A. Move duplicated initialization code from subclass constructors into the superclass constructor.

**Q4.** What does Push Down Method do?
A. Move a method from the superclass into the only subclass that uses it.

**Q5.** What does Push Down Field do?
A. Move a field from the superclass into the only subclass(es) that need it.

**Q6.** What does Extract Subclass do?
A. Split off a subclass to capture features used only sometimes.

**Q7.** What does Extract Superclass do?
A. Create a common superclass for two classes sharing features.

**Q8.** What does Extract Interface do?
A. Define an interface capturing operations shared by multiple classes (without sharing state).

**Q9.** What does Collapse Hierarchy do?
A. Merge a superclass and subclass that aren't different enough.

**Q10.** What's Form Template Method?
A. Two methods doing similar work in different ways → extract the common skeleton with hook methods for variants.

**Q11.** What's Replace Inheritance with Delegation?
A. Convert an "is-a" relationship to "has-a" + delegation when the inheritance was wrong.

**Q12.** What's Replace Delegation with Inheritance?
A. Convert pure pass-through delegation to actual inheritance.

**Q13.** What's the Liskov Substitution Principle?
A. Subclasses must be substitutable for their parent without breaking correctness.

**Q14.** What's the "is-a" test?
A. Before applying inheritance, ask: "Is the subclass really an instance of the parent?" — if not, use delegation.

---

## When to apply (Q15–Q30)

**Q15.** When is Pull Up Method wrong?
A. When the methods *look* identical but mean different things in each subclass; or when the methods rely on subclass-specific helpers.

**Q16.** When is Push Down Method right?
A. When a parent method is overridden as a no-op (or throws) in some subclasses — Refused Bequest.

**Q17.** When is Extract Superclass right?
A. When two classes share state and behavior, with a meaningful "is-a" relationship.

**Q18.** When is Extract Interface preferable to Extract Superclass?
A. When the classes share behavior but not state, or are otherwise unrelated.

**Q19.** When is Collapse Hierarchy right?
A. When the subclass adds nothing meaningful (no override, no fields), and tests pass with merged version.

**Q20.** When is Form Template Method right?
A. When two methods share a skeleton but vary in steps; the variation aligns naturally with subclass identity.

**Q21.** When is Replace Inheritance with Delegation right?
A. When the subclass uses only part of the parent (Refused Bequest), violates LSP, or exposes wrong API.

**Q22.** When is Replace Delegation with Inheritance right?
A. When every method on the wrapper just forwards to the same delegate, AND the relationship is genuinely "is-a."

**Q23.** When is "favor composition over inheritance" wrong?
A. When polymorphic dispatch is exactly what you need; when Template Method genuinely fits.

**Q24.** What's the fragile base class problem?
A. Changes to a base class can break subclasses invisibly.

**Q25.** When should you avoid mixins?
A. When mixins' expectations conflict (diamond problem); when method resolution becomes hard to trace.

**Q26.** When are sealed types preferable to open hierarchies?
A. When the variants are closed and you want exhaustive pattern matching.

**Q27.** Why does Java prevent records from extending other classes?
A. To preserve the simplicity of records as data carriers; "data inheritance" is intentionally avoided.

**Q28.** When does Pull Up Method break LSP?
A. When the method's contract (preconditions, postconditions) differs subtly across subclasses.

**Q29.** When should you Extract Subclass?
A. When some features are conditionally used (`if isInternal`), and the conditions persist across multiple methods.

**Q30.** When is the diamond problem actually a problem?
A. In multi-inheritance languages (Python, C++) when the diamond ancestors have conflicting state or methods.

---

## Code-smell mapping (Q31–Q40)

**Q31.** Which technique cures Duplicate Code in subclasses?
A. Pull Up Method, Pull Up Field, Form Template Method, Pull Up Constructor Body.

**Q32.** Which technique cures Refused Bequest?
A. Push Down Method, Push Down Field, Replace Inheritance with Delegation.

**Q33.** Which technique cures Lazy Class?
A. Collapse Hierarchy, Replace Subclass with Fields.

**Q34.** Which technique cures Alternative Classes with Different Interfaces?
A. Extract Superclass, Extract Interface (when class names differ but they do similar things).

**Q35.** Which technique cures Middle Man (when extreme)?
A. Replace Delegation with Inheritance.

**Q36.** Which technique cures Speculative Generality?
A. Collapse Hierarchy (when a parent class was created speculatively but never warranted).

**Q37.** What smell does "5-deep inheritance chain" indicate?
A. Often Speculative Generality + Refused Bequest at multiple levels.

**Q38.** Why is `Stack extends Vector` (in Java) a textbook bad inheritance?
A. Stack inherits Vector's full API (`add(int, E)`) which lets callers shove items into the middle, breaking stack semantics.

**Q39.** Which Generalization technique helps with the Visitor pattern?
A. Extract Interface (the visitor interface) + Form Template Method (the accept skeleton).

**Q40.** What's the relationship between Replace Conditional with Polymorphism and this category?
A. Replace Conditional gives you subclasses; Generalization techniques manage the resulting hierarchy (pull up, extract, etc.).

---

## Architecture & runtime (Q41–Q50)

**Q41.** What's the cost of virtual dispatch?
A. ~3-5 cycles uncached; ~1-2 cycles with branch prediction; effectively free post-JIT for monomorphic sites.

**Q42.** What's CHA?
A. Class Hierarchy Analysis — JIT analyzes the loaded class hierarchy to prove no overrides exist, enabling devirtualization.

**Q43.** What's an inline cache (IC)?
A. A small per-call-site cache mapping receiver type to method pointer; allows monomorphic dispatch to be ~as fast as direct call.

**Q44.** When does Form Template Method create a perf cost?
A. When the abstract step methods are megamorphic (4+ subclass types observed) — fall back to vtable lookup.

**Q45.** How do sealed types help JIT?
A. Closed hierarchies let JIT fully devirtualize because no new subtypes can appear.

**Q46.** What's the perf cost of Replace Inheritance with Delegation?
A. One extra pointer dereference; JIT inlines, eliminating it. Steady-state cost: zero.

**Q47.** Why does Pull Up Field sometimes hurt memory?
A. Subclasses that don't use the field still carry it — wasted bytes per instance.

**Q48.** What's the diamond problem and how does Java handle it?
A. Multiple inheritance ambiguity. Java disallows multi-class inheritance; default methods on interfaces require explicit resolution.

**Q49.** What's MRO in Python?
A. Method Resolution Order — the C3 linearization algorithm that determines which method wins in multi-inheritance.

**Q50.** How does Go's lack of inheritance affect this category?
A. Most techniques translate to embedding/composition idioms. Pull Up = move method to embedded; Replace Inheritance with Delegation = move from embedding to explicit field.

---

## Bonus (Q51–Q60)

**Q51.** What's Open-Closed Principle?
A. Modules should be open for extension, closed for modification. Polymorphism enables this.

**Q52.** How does pattern matching change OCP?
A. Pattern matching makes adding *operations* easy (open for new functions) but adding *types* hard (closed for new variants). Polymorphism is the reverse.

**Q53.** What's the expression problem?
A. The trade-off above: types-axis vs. operations-axis growth.

**Q54.** What does ArchUnit help with?
A. Encoding architectural rules (e.g., "no concrete extends in legacy package") as automated tests.

**Q55.** When does inheritance inherit the wrong API?
A. When the parent's full API is wider than what the subclass should expose (Stack-Vector example).

**Q56.** Why are tests with deep base-class inheritance fragile?
A. Changes to the base test cascade to all subclasses; setup is hard to trace.

**Q57.** What's a mixin?
A. A class designed to be inherited *with* another for shared capabilities; common in Python.

**Q58.** What's capability-based design?
A. Express each ability as an interface; classes implement multiple capabilities. Inheritance for polymorphism, interfaces for protocols.

**Q59.** How do Java records change the Generalization landscape?
A. Records are final, can't extend other classes. Many former Pull Up / Extract Superclass cases become "use sealed types + records."

**Q60.** What's the trajectory from inheritance to clean architecture?
A. Pull Up to dedupe → Extract Interface for capability → Replace Inheritance with Delegation when "is-a" doesn't fit → Sealed types for closed sets → Pattern matching for operations.

---

## Next

- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md)
- Recap: [junior.md](junior.md) → [middle.md](middle.md) → [senior.md](senior.md) → [professional.md](professional.md)
