# Traits, Mixins and Multiple Inheritance — Interview Q&A

Grouped by difficulty. Answers are tuned to be correct *and* concise — say the precise thing, not the long thing. The unifying theme to return to: **inheritance bundles type, behavior, and state; multiple inheritance is about which of the three you can have from many parents.**

---

## Warm-up (conceptual)

**Q1. "Does Java support multiple inheritance?"**
Of **type** and **behavior**, yes — a class can implement many interfaces, and since Java 8 those interfaces can ship default-method bodies. Of **state**, no — a class has exactly one superclass, and interfaces have no instance fields. The precise answer separates the three.

**Q2. What is the diamond problem?**
Two inheritance paths into the same member through a shared ancestor. For *state*, the question is "one copy or two?" (two means divergent values — a bug). For *behavior*, the question is "which path's method wins?". Every language allowing any MI must answer it.

**Q3. Why does Java forbid multiple inheritance of state but allow multiple interface inheritance?**
State MI brings three hard problems: ambiguous object layout (two parents both want offset 0), ambiguous constructor ordering, and the divergent-value diamond. Behavior and type have none of these once state is excluded. So Java forbids exactly the one thing (multiple state) and gets all the safe parts (multiple type + behavior) for free.

**Q4. What's the difference between a trait and a mixin?**
A **trait** (Schärli et al. 2003) is stateless behavior with explicit conflict resolution and a *flattening* guarantee — no hidden dispatch semantics. A **mixin** is broader: it may carry state and resolves conflicts by an automatic linear order. Traits ⊂ mixins. Java's default-method interfaces are *traits* in the formal sense; Scala `trait`s are actually *mixins* (they hold state and linearize).

**Q5. Are Java's default-method interfaces mixins?**
They are the *restricted* form — a formal **trait**: behavior + type, no state, explicit `X.super.m()` resolution. They lack the trait calculus's aliasing/exclusion operators, so "traits minus rename/exclude".

---

## Core (mechanics & cross-language)

**Q6. Two interfaces give conflicting defaults. What does Java do?**
Compile error: the class inherits unrelated override-equivalent defaults and must override the method, choosing a path with `Interface.super.method()` (or writing fresh behavior). Java never picks automatically for *unrelated* interfaces.

**Q7. When does Java resolve a default conflict *without* an error?**
When one interface is more specific — `B extends A`, both define `m()`, `B`'s wins ("more specific interface wins"). And when a class/superclass method exists — it beats any default ("classes win"). Only *unrelated* interfaces produce the must-override error.

**Q8. What does `Loud.super.greet()` mean and what are its constraints?**
"The `greet` default declared on `Loud`." `Loud` must be a **direct** superinterface of the current class; the call binds statically to exactly that method (no re-dispatch). You cannot reach an indirect superinterface's default this way.

**Q9. How does Scala resolve a trait diamond differently from Java?**
By **linearization** — a deterministic total order over all mixed-in traits. The right-most trait wins, and `super` walks left along that order. So `extends Polite with Loud` enters `Loud` first; its `super` goes to `Polite`, not directly to the base. Order is significant; Java's isn't (Java has no order — you name the interface).

**Q10. What does this Scala print?**
```scala
trait Base { def m = "b" }
trait X extends Base { override def m = "x" + super.m }
trait Y extends Base { override def m = "y" + super.m }
class C extends X with Y
new C().m
```
`"yxb"`. Linearization is `C, Y, X, Base`: `Y.m` runs first, its `super.m` is `X.m`, whose `super.m` is `Base.m`. Right-most (`Y`) is most specific.

**Q11. What does this Python print?**
```python
class A:
    def m(self): return "a"
class B(A):
    def m(self): return "b" + super().m()
class C(A):
    def m(self): return "c" + super().m()
class D(B, C): pass
D().m()
```
`"bca"`. The C3 MRO of `D` is `[D, B, C, A, object]`. `B.m`'s `super()` is `C` (next in MRO, *not* `A`), `C.m`'s `super()` is `A`. The shared base `A` is visited once, after both children — that's C3's job.

**Q12. In Python, why does `super()` in `B` call `C`, a class `B` doesn't inherit from?**
Because `super()` follows the **MRO of the actual object** (`D`), not `B`'s lexical parents. This is cooperative multiple inheritance — each method calls `super()` and the MRO threads them. It's also why you can't fully understand `B.m` in isolation.

**Q13. How does Ruby decide which mixed-in module wins?**
Last `include` wins — it's inserted just above the class in the ancestor chain, so its methods are found first and `super` walks down the chain. `prepend` inserts *below* the class (wrapping its own methods); `extend` mixes into the singleton class.

**Q14. How does C++ handle the state diamond, and what does `virtual` change?**
By default the shared base is **duplicated** — two subobjects, ambiguous member access, must qualify (`p.Polite::id`). `virtual` inheritance makes it **one shared subobject**, at the cost of an indirection pointer and a rule that the most-derived class constructs the virtual base (intermediate initializers ignored). Java avoided all of this by forbidding state MI.

**Q15. Map Scala `trait`, Ruby `module`, Python mixin base, and C++ base onto Java.**
All four → Java interface + default methods for the *behavior+type* part. What doesn't map: any *state* (move it to a field / composition) and any *automatic linearization* (make the order explicit via override or decorators). Java keeps behavior, drops state and implicit ordering.

---

## Deep (design & judgement)

**Q16. Why are Scala's "traits" not traits by the formal definition?**
Two violations of Schärli 2003: they can hold state (`val`/`var`), and they resolve conflicts by *linearization*, which adds hidden `super`-chain semantics — breaking the trait calculus's *flattening* property (a trait should add no new dispatch behavior). So Scala traits are mixins; Java default-method interfaces are the actual traits.

**Q17. What is the *flattening property* and why does Java approximately have it?**
Flattening: a class using a trait behaves identically to the same class with the trait's methods inlined — no hidden dispatch. Java approximates it because a default method is just an inherited method with no implicit `super` chain to other interfaces; you reason about the class from its own (flattened) method set. Linearized languages lose flattening because `super` reroutes through the computed order.

**Q18. When is a default method safe vs. dangerous?**
Safe for **derivation** — computing one thing from a single hook (`isEmpty()` from `size()`): stateless, self-contained. Dangerous for **coordination** — a default driving a multi-method protocol (`run() { open(); process(); close(); }`): it smuggles a cross-method invariant the interface can't enforce, and one overridden method can break it. The boundary is "does it need its own state or assume other methods' behavior?"

**Q19. Can C3 linearization fail? Give an example.**
Yes — at class-creation time, with `TypeError: Cannot create a consistent MRO`. It happens when subclasses impose contradictory base orders, e.g. `class X(A, B)` and `class Y(B, A)` then `class Z(X, Y)`: `X` requires A-before-B, `Y` requires B-before-A, no consistent total order exists. This is the MI analog of a fragile-base failure — an unrelated mixin can break a distant class.

**Q20. If interfaces can now have behavior, why not let them have fields too?**
Because instance fields reintroduce every problem state MI was forbidden to avoid: the layout/aliasing diamond (one slot or two?), constructor-ordering ambiguity (who initializes the field, when?), and divergent values. The `default` keyword is deliberately the boundary of "safe to share from many parents" — behavior yes, state never. `static final` interface constants are class-level, not per-instance, so they don't participate.

**Q21. You see `class Report implements DateUtils` purely to use a default `today()`. What's wrong and what's the fix?**
Type/behavior confusion: `Report` is not a `DateUtils`, so this is behavior reuse masquerading as subtyping (mixin abuse). Fix: inject a `Clock`/utility collaborator and call it; the capability becomes a swappable, mockable field. Use `implements` only for genuine is-a relationships.

**Q22. How would you implement stackable behavior (Scala-style) in Java?**
Not by simulating linearization with chained `X.super.m()`. Use the **decorator pattern** over composition: each modifier is a wrapper holding the next `Greeter`, and the "linearization" becomes the explicit nesting order at construction (`new Loudly(new Politely(base))`). The order is visible in code, not in a computed table — Java's no-surprise philosophy.

**Q23. Why does Kotlin (and Java) name the interface in `super` rather than linearize?**
Both chose *programmer disambiguation over implicit ordering*. Kotlin's `super<Interface>.m()` and Java's `Interface.super.m()` make the choice explicit and order-independent, eliminating the linearization hazards (lost local reasoning, order-dependence, possible non-existence). It's verbose but never surprises — the right default for large multi-team codebases. Two independent language designs landing on the same choice is evidence it's considered, not accidental.

---

**Closing frame for any of these:** keep returning to the three-way split. "Multiple inheritance" is never one question — it's three (type, behavior, state) with different costs. Java said *many for type and behavior, one for state*, resolved behavior conflicts *explicitly* rather than by linearization, and thereby converged on the 2003 trait calculus. Every other language is a different point on that same trade-off surface.
