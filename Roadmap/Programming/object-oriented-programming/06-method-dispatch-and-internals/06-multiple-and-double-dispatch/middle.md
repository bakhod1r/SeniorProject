# Multiple & Double Dispatch — Middle

> Practical, working command of double dispatch in Java: the exact mechanics of Visitor, the four ways the two-type problem shows up in real codebases, how Java 21's pattern switch compiles, and the rules for predicting which overload `javac` picks under inheritance, autoboxing, varargs, and generics.

This file assumes you have the [`junior.md`](./junior.md) model: Java is single dispatch; overloading is static, overriding is dynamic; Visitor chains two virtual calls.

---

## 1. The overload-resolution algorithm `javac` actually runs

When `javac` sees `f(a, b)`, it does not "pick the obvious one". It runs the three-phase applicability search of JLS §15.12.2:

1. **Phase 1** — applicable by *strict invocation*: no boxing, no varargs. Subtyping only.
2. **Phase 2** — applicable by *loose invocation*: boxing/unboxing allowed, still no varargs.
3. **Phase 3** — applicable by *variable-arity invocation*: varargs considered.

The compiler stops at the first phase that yields at least one applicable method, then picks the **most specific** among that phase's candidates (§15.12.2.5). This explains a pile of "surprising" results:

```java
void g(long x)    { System.out.println("long"); }
void g(Integer x) { System.out.println("Integer"); }

g(1);   // prints "long"
```

`1` is an `int`. Phase 1 can widen `int → long` (a primitive widening, allowed without boxing), so `g(long)` is applicable in Phase 1. `g(Integer)` requires boxing → only Phase 2. Phase 1 wins, so `long` prints. Widening beats boxing. This is a famous interview trap and it falls straight out of the phase ordering.

| Conversion needed at the call site | Earliest phase |
| ---------------------------------- | -------------- |
| subtype / identity / primitive widening | Phase 1   |
| autoboxing / unboxing              | Phase 2        |
| varargs spread                     | Phase 3        |

Key consequence for *this* topic: every one of these decisions uses the **static type** of the arguments. None of it is dynamic. The runtime never re-runs this search.

---

## 2. Null and overload resolution

`null` has no runtime type, and its compile-time type is the null type, which is a subtype of every reference type. So:

```java
void h(String s) { System.out.println("String"); }
void h(Object o) { System.out.println("Object"); }

h(null);   // prints "String" — most specific reference type wins
```

If you add a third, sibling overload `h(Integer)`, the call `h(null)` no longer compiles — `String` and `Integer` are *incomparable*, so there is no single most-specific method. This is a real, occasional compile break when someone adds an overload. The fix is an explicit cast: `h((String) null)`.

---

## 3. Visitor, fully assembled

The complete classic shape. Note the generic return type `R` so visitors can compute *anything* (area, a string, a new tree) without casts or shared mutable state:

```java
public interface Shape {
    <R> R accept(Visitor<R> v);
}
public interface Visitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
    R visitGroup(Group g);
}

public record Circle(double r)            implements Shape {
    public <R> R accept(Visitor<R> v) { return v.visitCircle(this); }
}
public record Square(double side)         implements Shape {
    public <R> R accept(Visitor<R> v) { return v.visitSquare(this); }
}
public record Group(List<Shape> children) implements Shape {
    public <R> R accept(Visitor<R> v) { return v.visitGroup(this); }
}
```

Two operations, no `instanceof`, no casts:

```java
final class AreaVisitor implements Visitor<Double> {
    public Double visitCircle(Circle c) { return Math.PI * c.r() * c.r(); }
    public Double visitSquare(Square s) { return s.side() * s.side(); }
    public Double visitGroup(Group g)   {
        return g.children().stream().mapToDouble(s -> s.accept(this)).sum();
    }
}

final class SvgVisitor implements Visitor<String> {
    public String visitCircle(Circle c) { return "<circle r='" + c.r() + "'/>"; }
    public String visitSquare(Square s) { return "<rect side='" + s.side() + "'/>"; }
    public String visitGroup(Group g)   {
        return g.children().stream().map(s -> s.accept(this))
                .collect(Collectors.joining("", "<g>", "</g>"));
    }
}
```

`Group.visitGroup` recursing with `s.accept(this)` is the idiomatic way to walk a tree — each child re-enters the double-dispatch dance. This is exactly how AST-walking compilers and serializers are built.

---

## 4. The two hops, named precisely

The two dispatches are not symmetric, and naming them avoids confusion:

| Hop | Call            | Dispatches on  | Resolves to        |
| --- | --------------- | -------------- | ------------------ |
| 1   | `shape.accept(v)` | runtime type of `shape` | `Circle.accept` etc. |
| 2   | `v.visitCircle(this)` | runtime type of `v` | `AreaVisitor.visitCircle` etc. |

Hop 2's *method name* (`visitCircle`) is **statically** fixed inside `Circle.accept`, where `this` is known to be a `Circle`. So no overload resolution decides the shape — the position in the code does. The visitor's runtime type is the only dynamic part of hop 2. The product of two runtime types (shape × visitor) selects the final body. That product is double dispatch.

---

## 5. Pattern-matching `switch` — and its bytecode

For a closed (sealed) type set where the *types* are stable but you keep adding *operations*, Java 21's switch is dramatically less code:

```java
sealed interface Shape permits Circle, Square, Group {}
record Circle(double r)            implements Shape {}
record Square(double side)         implements Shape {}
record Group(List<Shape> children) implements Shape {}

static double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
        case Group g  -> g.children().stream().mapToDouble(Mid::area).sum();
    };
}
```

`javap -c` of `area` shows how it lowers:

```
 9: aload_2
10: iload_3
11: invokedynamic #13, 0   // InvokeDynamic #0:typeSwitch:(Ljava/lang/Object;I)I
16: lookupswitch  { 0:54  1:78  2: ...  default:44 }
44: new           #17      // class java/lang/MatchException
```

And `javap -v` reveals the bootstrap:

```
BootstrapMethods:
  0: REF_invokeStatic java/lang/runtime/SwitchBootstraps.typeSwitch:(...)LCallSite;
    Method arguments:  #22 Circle  #30 Square  #34 Group
```

What happens: `invokedynamic` calls `SwitchBootstraps.typeSwitch` once, passing the list of case labels (the permitted subtypes). The bootstrap returns a `CallSite` whose target maps the scrutinee to an `int` index (`0`, `1`, `2`, or `-1`/default). The `int` then drives an ordinary `lookupswitch`. So a pattern switch is **one** `invokedynamic` (amortised to a fast indexed lookup) plus a jump table — not a chain of `instanceof` checks. The `MatchException` arm handles the "sealed hierarchy changed under you" case at runtime.

Compare the dispatch budgets:

| Strategy            | Per-call dynamic operations                       |
| ------------------- | ------------------------------------------------- |
| Visitor             | 2 virtual calls (`accept`, `visitXxx`)            |
| Pattern switch (21) | 1 `invokedynamic` → indexed `lookupswitch`        |
| `instanceof` chain  | up to N `instanceof` tests (linear)               |
| Map-of-handlers     | 1 hash lookup + 1 virtual call                    |

---

## 6. The four real-world shapes of the two-type problem

You will meet "dispatch on two types" in these guises:

1. **AST / IR walkers** — compilers, linters, query planners. Visitor dominates here because there are *many* operations (type-check, optimize, emit) over a *stable* node set. ANTLR generates a Visitor and a Listener for exactly this.
2. **Serialization / rendering** — turning a domain object graph into JSON/SVG/protobuf. Either Visitor or pattern switch; pattern switch wins for small, sealed models.
3. **Collision / interaction matrices** — the asteroid/spaceship case. This is genuinely *symmetric* double dispatch and is awkward in all Java encodings (see senior.md); a 2-key handler map is often clearest.
4. **`equals` across a hierarchy** — `a.equals(b)` is single dispatch on `a`, then must consider `b`'s type. This is *exactly* a double-dispatch problem in disguise, and getting it wrong breaks the symmetry contract (see [../../02-more-about-oop/09-method-overloading-overriding/](../../02-more-about-oop/09-method-overloading-overriding/)).

---

## 7. The double-dispatch encoding of `equals`

`equals` is the most common double-dispatch problem nobody calls double dispatch. The receiver is dispatched (`a.equals(b)`); the argument `b` arrives as `Object` and must be type-checked. The careful pattern:

```java
public sealed interface Money permits Cash, Card {}

record Cash(int cents) implements Money {
    public boolean equals(Object o) {
        return o instanceof Cash other && other.cents == cents;
    }
}
```

The `instanceof` pattern *is* the second dispatch, done by hand. Records generate exactly this for you — another reason records pair naturally with sealed hierarchies and pattern switches.

---

## 8. The Acyclic Visitor variant

Classic Visitor forces every `Visitor` to know *every* element type (`visitCircle`, `visitSquare`, …). Adding an element breaks all visitors — recompilation cascades. The **Acyclic Visitor** (Robert Martin) breaks the cycle: each element type has its *own* visitor interface, and `accept` uses `instanceof` to test capability:

```java
interface Visitor {}                                  // empty marker
interface CircleVisitor extends Visitor { void visitCircle(Circle c); }
interface SquareVisitor extends Visitor { void visitSquare(Square s); }

record Circle(double r) implements Shape {
    public void accept(Visitor v) {
        if (v instanceof CircleVisitor cv) cv.visitCircle(this);
    }
}
```

Now a visitor can implement only the cases it cares about, and adding an element does not force every visitor to recompile. The cost: you reintroduce an `instanceof`, partly defeating the "no type tests" selling point, and silent no-ops when a visitor lacks the relevant interface. Use it when the element set is large and visitors are partial.

---

## 9. Multimethods on the JVM — Clojure and Groovy

Two JVM languages give you real runtime multiple dispatch without the Visitor ceremony.

**Clojure** — `defmulti` takes a dispatch function of *all* arguments; `defmethod` registers an implementation per dispatch value:

```clojure
(defmulti collide (fn [a b] [(:type a) (:type b)]))
(defmethod collide [:asteroid :spaceship] [a b] "ship hit")
(defmethod collide [:asteroid :asteroid]  [a b] "small bang")
```

The dispatch value is computed from both args at call time — arbitrary multiple dispatch, even on values not types.

**Groovy** resolves *ordinary* method overloads by **runtime** argument types by default. The same `pick(o)` that prints `"Object"` in Java prints `"String"` in Groovy. This is the cleanest demonstration that overload-resolution *timing* is a language policy on top of the unchanged JVM — both compile to `invokevirtual`/`invokedynamic`, but Groovy's runtime re-selects the target.

---

## 10. When to choose what

| Situation                                        | Use                          |
| ------------------------------------------------ | ---------------------------- |
| Closed type set, operations change often, Java 21+ | **Pattern switch**         |
| Closed types, want exhaustiveness checked        | **Pattern switch** (sealed)  |
| Operations span modules; types added rarely; many ops | **Visitor**             |
| Open type set, partial handling                  | **Acyclic Visitor** or map   |
| Symmetric two-type interaction (collisions)      | **2-key handler map**        |
| You control the language                         | Clojure `defmulti` / Julia   |

The decisive axis is the *expression problem* (senior.md): Visitor makes adding **operations** cheap and adding **types** expensive; pattern switch and `instanceof` chains make adding **types** cheap and adding **operations** expensive. Pick the one whose cheap axis matches your expected change.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Expression problem, symmetry, deopt, megamorphic Visitors    | `senior.md`        |
| Review checklist, error-prone, ArchUnit, refactoring         | `professional.md`  |
| JLS §15.12.2/.4, JVMS §5.4.6, GoF, SwitchBootstraps          | `specification.md` |
| Overload-resolution puzzles + broken Visitors                | `find-bug.md`      |
| JMH: Visitor vs switch vs handler-map                        | `optimize.md`      |

---

**Remember:** overload resolution is a static, three-phase, most-specific search over *compile-time* argument types — widening beats boxing beats varargs. Visitor = two `invokeinterface` hops. Pattern switch = one `invokedynamic` to `SwitchBootstraps.typeSwitch` plus a `lookupswitch`. Clojure `defmulti` and Groovy's runtime dispatch give true multiple dispatch on the same JVM; the difference is pure language policy.
