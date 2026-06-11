# Designing for Extension & Polymorphism — Interview Q&A

A bank of ~20 questions grouped by difficulty. Answers are tight and correct; expand only where the nuance is the point.

---

## Easy / conceptual

**1. State the Open/Closed Principle and the mechanism that realizes it.**
A software unit should be *open for extension, closed for modification*: you add behaviour without editing existing, tested code. The modern mechanism is **abstraction + polymorphism** — callers depend on an interface; new behaviour is a new implementation. (Meyer's original mechanism was subclassing; Martin reframed it around interfaces.)

**2. What is an "extension seam"?**
A deliberately placed point — an interface, abstract method, or SPI — where new behaviour can plug in without changing callers. It names the *variation point* (the thing predicted to change) and isolates it behind a stable contract.

**3. "Replace conditional with polymorphism" — when does it apply, and when not?**
Apply it when the *same* `switch`/`if`-chain branching **on a type or kind** repeats across multiple methods and the set of cases grows over time. Don't apply it to value checks (`if (x > 0)`), to a single local stable branch, or when the operation legitimately lives *outside* the type (then prefer an exhaustive switch over a sealed type).

**4. Strategy vs Template Method — one-line distinction.**
Strategy swaps a *whole algorithm* via composition (an interface field). Template Method fixes the *skeleton* and lets subclasses fill specific *steps* via overriding. Whole varies → Strategy; only steps vary → Template Method.

**5. Why mark the template method `final` in Template Method?**
So subclasses fill the gaps but cannot reorder or skip steps. The control flow is the invariant; only the designated `protected` hooks are extensible.

**6. What is an SPI and how does Java discover providers?**
A Service Provider Interface is a published interface third parties implement. `ServiceLoader.load(Type.class)` discovers them at runtime via `META-INF/services/` files or JPMS `provides … with …`. The consumer is compiled and closed yet open to providers it never named.

---

## Medium / trade-off

**7. Bloch's Item 19 — what does "design and document for inheritance, or else prohibit it" demand?**
If you allow subclassing: document the class's *self-use* (which overridable methods it calls, in what order), provide minimal meaningful `protected` hooks, and never call an overridable method from a constructor/`clone`/`readObject`. Otherwise mark the class `final`. The default for an ordinary class is `final`.

**8. Why can't you call an overridable method from a constructor?**
JLS §12.5: the superclass constructor runs *before* the subclass's fields are initialized. The override fires against a half-built subclass and sees `null`/zero fields — a classic NPE. The base must not invoke overridable methods during construction.

**9. When should you `seal` a hierarchy instead of leaving it open?**
When the set of variants is *complete and known to you* (e.g. `Result = Ok | Err`, `PaymentMethod = Card | Bank | Crypto`). Sealing gives exhaustive `switch` (compiler proves all cases handled) and clear reasoning. Never seal a plugin point — that forbids the outsider extension it exists for.

**10. You publish an interface implemented by other teams. How do you add a method without breaking them?**
Add it as a `default` method with a real, safe body (binary-compatible, JLS §13.5.6) — never as a new `abstract` method (breaks every implementer with `AbstractMethodError`). For an opt-in capability, add a separate capability sub-interface and `instanceof`-check. For a hard boundary, ship a versioned `XV2 extends X`.

**11. What is a "leaky abstraction" and how do you spot one?**
A seam whose contract exposes its implementation: implementation types in signatures (`GzipOutputStream` instead of `OutputStream`), under-specified behaviour that forces implementers to mimic quirks, or `UnsupportedOperationException` in half the implementers. Spot it by asking whether a fresh implementer can satisfy the contract from the *domain vocabulary* alone, without reading the original source.

**12. Does polymorphism cost more than a switch at runtime?**
Usually not. HotSpot inlines monomorphic and bimorphic call sites (one or two receiver types) to direct calls via CHA and inline caches — effectively free. Only *megamorphic* sites (3+ types, hot) pay a real vtable/itable lookup and block inlining. Decide polymorphism-vs-switch on the design axis, not imagined dispatch cost.

**13. Two implementations exist today and you expect a third. Add a seam now or wait?**
Add it now — that's a *real, evidenced* variation point (Protected Variations: predicted variation with evidence). The mistake is adding a seam for a single implementation with no concrete second on the horizon (speculative generality / YAGNI).

**14. What is "Protected Variations" and how does it relate to OCP?**
A GRASP principle (Larman): identify points of *predicted* variation/instability and wrap a stable interface around them. It generalizes OCP — Strategy, Adapter, Facade, polymorphism, and data-driven designs are all PV instances. The key word is *predicted*: PV is not "wrap everything".

---

## Hard / design & "what happens"

**15. Explain why "polymorphism vs conditional" is fundamentally an axis choice (the Expression Problem).**
Two growth axes: new *types* and new *operations*. Polymorphism (behaviour inside each type) makes adding a *type* cheap but adding an *operation* expensive (touch every class). Sealed + exhaustive switch (behaviour outside) makes adding an *operation* cheap but adding a *type* expensive (touch every switch — though the compiler flags each). No plain-Java design makes both cheap. So you choose the cheap axis for the change you actually expect: types grow → polymorphism; operations grow → sealed + switch.

**16. What does this print, and why?**

```java
class Base { Base() { hook(); } protected void hook() {} }
class Sub extends Base {
    private final String name = "x";
    @Override protected void hook() { System.out.println(name); }
}
new Sub();
```
It prints `null`. `super()` (Base's constructor) runs `hook()` *before* `Sub`'s field initializer assigns `name`. The override sees the still-zeroed `name` field. This is exactly why Item 19 forbids overridable calls in constructors.

**17. A `switch` over a sealed type compiles fine today; you add a 7th variant. What happens, and why is that desirable?**
Every *exhaustive* `switch` over that sealed type (those without a `default`) becomes a **compile error** until you add the new case. That's the desired behaviour: the compiler hands you an exact, complete checklist of every place that must handle the new variant — impossible with an open hierarchy, where you'd silently get a missing or wrong branch at runtime.

**18. You have a hot call site dispatching over 40 `Channel` implementations and it's megamorphic. The seam is right; do you remove it?**
No — the seam is correct (real, open variation). You reduce *receiver types at that site*: partition/bucket so each hot loop sees few types, cache the resolved provider per message kind, or split the megamorphic loop. Abandoning the seam trades a localized perf issue for a global design regression. Optimize the dispatch shape, keep the abstraction.

**19. Design an extensible pricing engine where new pricing rules arrive monthly and outside teams may contribute rules. Sketch the seam(s).**
A `PricingRule` SPI: `interface PricingRule { boolean applies(Cart c); Money apply(Cart c, Money running); }`. Discover via `ServiceLoader`/DI so contributors add a rule jar without touching the engine (closed engine, open rule set — *not* sealed, because outsiders extend). Evolve the interface only via `default` methods. Keep the contract domain-phrased (`Cart`, `Money`) with no engine-internal types. A reference TCK proves new rules conform. The engine folds rules in order; rule ordering/priority is itself a small explicit contract.

**20. When is leaving an `if/else` chain the *correct* design over polymorphism?**
When the branching is local and stable (one site, unlikely to grow), when it branches on values rather than types, or when the operation lives outside the type over a *closed, known* set — then a `sealed` type + exhaustive `switch` is clearer and safer than scattering the operation into the model (avoids polluting types with foreign concerns, the Expression Problem). Polymorphism is a tool, not a reflex.

**21. Why is "adding a method breaks implementers but not callers" the central asymmetry of seam evolution?**
Callers *use* an interface; new methods are simply available to them — no break. Implementers must *satisfy* the interface; a new `abstract` method means they no longer do (compile error / `AbstractMethodError`). So the more an interface is implemented by code you don't control, the more conservatively it must evolve — hence `default` methods, capability interfaces, and versioned SPIs.

**22. How do you *measure* whether a seam actually improved extensibility?**
Track files-touched-per-feature for the seam's feature kind (a working seam drives this toward "one new file"), git change-coupling (does a "closed" caller still change with every variant?), and CK NOC on the abstraction (NOC=1 after months = speculative seam). "Feels rigid" is not evidence; the change-cost trend is.

---

## Rapid-fire

- **Default modifier for an ordinary class?** `final`.
- **Strategy with one method in modern Java?** A lambda / functional interface.
- **Abstract Factory extends what unit?** A whole *family* of related objects.
- **Adding an `abstract` method to a published interface is…?** A binary-incompatible breaking change.
- **`super.step()` dispatches how?** Statically (`invokespecial`) — always the parent's exact body.
- **Sealed permitted subtypes must be where?** Same module (or same package in the unnamed module).
- **Tool to fail the build on an SPI binary break?** japicmp / revapi.
