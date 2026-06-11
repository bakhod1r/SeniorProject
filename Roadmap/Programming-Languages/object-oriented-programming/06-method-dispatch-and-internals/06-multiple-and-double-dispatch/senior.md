# Multiple & Double Dispatch — Senior

> The deep layer: *why* single dispatch is the design constraint it is, the expression problem that governs every Visitor-vs-switch decision, the asymmetry and fragility of double dispatch, how each encoding behaves under the JIT (inline caches, megamorphism, deopt), and the historical reasons Java chose static overload resolution while CLOS and Julia chose runtime multiple dispatch.

---

## 1. The expression problem — the real frame for this whole topic

Phil Wadler named it: you have a 2-D grid of *types* (rows) × *operations* (columns), and you want to add either a row or a column **without modifying or recompiling existing code** and **with static type safety**. No mainstream OO or functional language solves both axes for free; you trade.

| Encoding              | Add a new **operation**            | Add a new **type**                       |
| --------------------- | ---------------------------------- | ---------------------------------------- |
| Plain virtual methods | edit *every* class (expensive)     | one new class (cheap)                    |
| Visitor               | one new visitor (cheap)            | edit `Visitor` + *every* visitor (expensive) |
| Pattern switch        | one new method (cheap)             | edit *every* switch (expensive, but exhaustiveness check finds them) |
| `instanceof` chain    | one new method (cheap)             | edit every chain (expensive, *silent* miss) |

Visitor and pattern-switch are **duals**. Virtual dispatch is good at adding types; Visitor inverts that to be good at adding operations. The entire "Visitor vs switch" debate is just: *which axis do you expect to grow, and do you want the compiler to catch the expensive edits?*

The sealed-switch's edge over Visitor: when you add a type, the compiler flags every non-exhaustive switch (a compile error), so the "expensive" edits are *found for you*. With Visitor, adding a `visitXxx` to the interface also forces recompilation, but across a published API that is a binary-compatibility break, not a friendly compile error in *your* tree. That makes pattern switch the better choice for code you fully own, and Visitor better when the *element set is genuinely frozen* and operations are contributed by third parties.

---

## 2. Why Java chose static overload resolution

This was deliberate, and the reasoning is worth knowing. Static overload resolution gives:

- **Predictability.** The method invoked is determinable by reading the source and the declared types — no whole-program runtime analysis. A reviewer can point at the chosen overload.
- **Performance.** The target is a fixed constant-pool reference; no per-call argument-type inspection. The JIT inlines trivially.
- **Simplicity of the type system.** Return types, generics, and inference all key off the *statically chosen* method. Runtime overload selection would make type inference undecidable in the general case.

The cost is the trap from junior.md: `draw(s)` ignores that `s` is really a `Circle`. CLOS and Julia accepted the opposite trade — runtime cost and a more complex selection algorithm — to get multiple dispatch as a first-class tool. Julia's *entire* performance model depends on the JIT specializing each multimethod per concrete argument-type tuple; that only works because Julia compiles per call-site type combination. Java's JIT does something analogous *speculatively* (next section) but the *language* commits to one target at compile time.

---

## 3. Double dispatch is asymmetric — and that bites `equals`

Visitor's two hops are not symmetric: hop 1 dispatches the element, hop 2 dispatches the visitor. For *operations over a hierarchy* that asymmetry is fine. For genuinely **symmetric** interactions it is a problem.

Consider `equals` across a hierarchy, which is double dispatch in disguise. `a.equals(b)` dispatches on `a`, then must consider `b`. The symmetry contract (`a.equals(b) == b.equals(a)`) is *not* automatic:

```java
class Point      { int x, y; }
class ColorPoint extends Point { Color c; }
```

If `ColorPoint.equals` requires the other to be a `ColorPoint` but `Point.equals` only checks `x,y`, then `point.equals(colorPoint)` is `true` while `colorPoint.equals(point)` is `false` — a broken contract that corrupts `HashSet`. This is the classic *Effective Java* Item 10 problem, and at root it is the **fragility of emulated double dispatch over an inheritance hierarchy**. The robust fixes — favor composition over inheritance, or use `getClass()` equality — are really "don't try to double-dispatch across a subclassable hierarchy". This is one more reason sealed records (final, no subclassing) make double-dispatch problems tractable.

---

## 4. Symmetric multiple dispatch: the N² wall

For collisions, you want `collide(a, b)` to behave identically to `collide(b, a)`. Visitor encodes this as N elements × N visitor methods = **N² method bodies**, and you must keep `collide(Asteroid,Spaceship)` and `collide(Spaceship,Asteroid)` consistent by hand. Adding one element type adds a row *and* a column. This is where Java's emulation is genuinely painful and where a real multimethod language (Julia) or a 2-key dispatch table wins:

```java
record Pair(Class<?> a, Class<?> b) {}
Map<Pair, BiFunction<Body, Body, Event>> table = Map.of(
    new Pair(Asteroid.class, Spaceship.class), (x, y) -> shipHit(x, y),
    new Pair(Spaceship.class, Spaceship.class), (x, y) -> bothGone(x, y)
);
Event collide(Body a, Body b) {
    var f = table.get(new Pair(a.getClass(), b.getClass()));
    if (f == null) f = table.get(new Pair(b.getClass(), a.getClass())); // symmetry
    return f.apply(a, b);
}
```

The map makes the N² explicit and editable in one place, and the symmetry fallback is one line instead of N² hand-maintained mirror methods. The price is loss of compile-time exhaustiveness — no compiler tells you a pair is unhandled. Pick the map when the matrix is sparse and symmetric; pick Visitor/switch when it is dense and asymmetric.

---

## 5. JIT behaviour: how each encoding actually runs hot

The opcode is only the start; the JIT decides real cost.

**Visitor (two `invokeinterface`).** Each call site has an *inline cache*. If, at a given `accept` site, the receiver is always `Circle` (monomorphic), HotSpot inlines `Circle.accept` and then inlines the subsequent `visitCircle` — the two hops can collapse to nearly nothing. But Visitor call sites are frequently **megamorphic**: a tree walk feeds `Circle`, `Square`, `Group`, … through the *same* `accept` site, blowing past the inline-cache capacity (HotSpot's bimorphic/megamorphic threshold is small). A megamorphic `invokeinterface` falls back to a full itable lookup and does not inline — the expensive case. So Visitor's worst real-world cost is not the two opcodes but the *megamorphic* `accept` site in a heterogeneous loop.

**Pattern switch (`invokedynamic` → `lookupswitch`).** The `typeSwitch` bootstrap builds, on first run, a target that does the type tests; HotSpot then JITs the `lookupswitch` as a jump table. The type tests inside are ordinary `instanceof`-style class checks the JIT understands well. For a *sealed* hierarchy the JIT additionally knows the type set is closed (Class Hierarchy Analysis), enabling sharper speculation. In practice a sealed pattern switch is competitive with, and often beats, a megamorphic Visitor because there is no megamorphic virtual site to deoptimize.

**`instanceof` chain.** Linear in the number of arms, but each test is cheap and predictable; for 2–4 arms it can beat both, especially with good branch prediction. It loses as arm count grows.

> The counter-intuitive senior takeaway: the "elegant" Visitor can be the *slowest* on heterogeneous data precisely because its strength — virtual dispatch — turns megamorphic, while the "switch you were told to avoid" stays a flat jump table. Measure (see optimize.md); do not assume Visitor is faster because it is OO.

---

## 6. Sealing changes the optimization picture

Before sealed types, the JIT had to assume any class *might* be loaded that adds a `Shape`, so it guarded devirtualized calls with a check and kept a deopt path. With `sealed interface Shape permits Circle, Square, Group`, the permitted set is fixed *in the class file*. CHA can now prove the hierarchy is closed without speculation, which:

- lets pattern switches lower to a dense, un-guarded jump table;
- lets the compiler *prove* exhaustiveness, so you write no `default` (and a stale switch becomes a compile error when the `permits` list grows);
- makes the `MatchException` arm a genuine "should never happen / separate compilation skew" guard rather than dead code.

This is why "Java 21 sealed + records + pattern switch" is the modern answer to double dispatch on a closed model, and Visitor is increasingly reserved for *open* or *externally extended* element sets.

---

## 7. Historical context: CLOS, the origin of multimethods

CLOS (Common Lisp Object System, 1988) is where multiple dispatch entered the mainstream OO vocabulary. A *generic function* is a named bundle of *methods*; each method has *specializers* on any subset of its parameters. At call time the generic function computes the *applicable* methods for the actual argument classes, sorts them by specificity across *all* specialized parameters, and runs the most specific (with `call-next-method` for the chain). Critically, CLOS decouples methods from classes — a method is *not* owned by a class, which is exactly what lets it dispatch on several arguments symmetrically.

Java inherited the Smalltalk model instead: methods live *inside* one class, the receiver. That single design choice — message send to one receiver — is the root cause of single dispatch and therefore of this entire topic. Julia (2012) revived CLOS-style multiple dispatch as the *primary* paradigm and showed it scales with a specializing JIT. Clojure's `defmulti` is a deliberately CLOS-flavored multimethod facility on the JVM.

---

## 8. Subtle traps that separate seniors from middles

- **A Visitor that takes `Object` parameters silently degrades to overload resolution.** If someone writes `visit(Object o)` overloads instead of distinct `visitCircle/visitSquare` methods, hop 2 becomes static overload selection on `Object` — and you are back to single dispatch with extra steps. The whole pattern depends on *distinctly named* visit methods.
- **`super` in a Visitor element does not chain dispatch.** `super.accept(v)` is `invokespecial` — statically bound. Visitor composition across an inheritance chain of elements does not "double dispatch up the hierarchy"; it calls the exact parent body.
- **Generics give the *illusion* of dispatch.** `<T> void process(List<T> xs)` does not dispatch on `T` — erasure removed it. Any "dispatch on a type parameter" must be reified via a `Class<T>` token or a pattern switch.
- **Pattern switch over a non-sealed type needs a `default` and loses exhaustiveness.** Without `sealed`, the compiler cannot know the type set is closed, so you must write `default`, and adding a subtype compiles silently — re-introducing the `instanceof`-chain hazard.
- **Record deconstruction patterns are a *third* level of dispatch.** `case Group(var children)` dispatches on type *and* binds structure. Nested record patterns let one switch arm match a shape *and* its contents — something Visitor cannot do without manual unpacking.

---

## 9. When *not* to fake double dispatch at all

Sometimes the right answer is "don't". If the operation belongs naturally on the type and the type set is closed, a plain virtual method (`shape.area()`) is single dispatch and you need nothing fancier — Visitor here is over-engineering. The two-type problem only appears when the operation does *not* belong on the type (it lives in another module, it varies independently, it crosses a layer boundary). Reach for Visitor/switch only when single dispatch genuinely cannot reach the second type — not reflexively because "polymorphism".

---

## 10. What's next

| Topic                                                  | File              |
| ------------------------------------------------------ | ----------------- |
| Review vocabulary, error-prone/ArchUnit, refactoring    | `professional.md`  |
| JLS/JVMS/GoF/CLOS/Julia citations                       | `specification.md` |
| Overload puzzles, broken Visitors                       | `find-bug.md`      |
| JMH numbers behind §5                                   | `optimize.md`      |

Cross-references: inline caches and megamorphism in [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/); itable layout in [../02-vtable-and-itable/](../02-vtable-and-itable/); sealed types and pattern switch in [../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/](../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/); static vs dynamic binding in [../../02-more-about-oop/11-static-vs-dynamic-binding/](../../02-more-about-oop/11-static-vs-dynamic-binding/).

---

**Memorize this:** the expression problem is the master key — Visitor and pattern switch are duals trading the "add a type" axis against the "add an operation" axis, and sealed switches additionally get compiler-checked exhaustiveness. Java picked static overload resolution for predictability and speed; CLOS/Julia picked runtime multiple dispatch and pay for it with a specializing JIT. Emulated double dispatch is *asymmetric* (which is why `equals` symmetry breaks) and goes *megamorphic* on heterogeneous data (which is why elegant Visitors can run slower than the switch you avoided).
