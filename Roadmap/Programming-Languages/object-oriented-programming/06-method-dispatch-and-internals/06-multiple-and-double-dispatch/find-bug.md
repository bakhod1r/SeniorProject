# Multiple & Double Dispatch — Find the Bug

Each snippet compiles (unless noted) and looks reasonable. Find the dispatch bug before reading the diagnosis. The recurring culprit: **someone expected dynamic behavior from static overload resolution**, or **broke one of the two Visitor hops**.

---

## Bug 1 — The classic overloading trap

```java
class Renderer {
    String render(Shape s)  { return "generic"; }
    String render(Circle c) { return "circle"; }   // Circle extends Shape

    String renderAll(List<Shape> shapes) {
        return shapes.stream().map(this::render).collect(joining(","));
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`renderAll` streams `Shape` elements, so `this::render` binds to `render(Shape)` at compile time for *every* element. Even the `Circle`s render as `"generic"`. Overload resolution is static; the runtime type never gets a vote. **Fix:** make the second dispatch real — a pattern switch (`switch (s) { case Circle c -> ...; ... }`) or push `render()` onto the `Shape` hierarchy as a virtual method. Prove the bug with `javap -c`: the lambda body's call is `render:(LShape;)`.
</details>

---

## Bug 2 — Broken Visitor: wrong `this` forwarding

```java
final class Circle implements Shape {
    public <R> R accept(Visitor<R> v) { return v.visitSquare(this); }  // !
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`Circle.accept` calls `visitSquare` instead of `visitCircle`. It compiles only if `visitSquare` accepts a `Circle` (it usually takes `Square`, so this actually fails to compile) — but if the visitor methods take a common supertype it compiles and silently mis-dispatches. Hop 2 must call the visit method *matching the element type*. **Fix:** `v.visitCircle(this)`. This is the most common hand-written Visitor bug; a copy-paste from another element class.
</details>

---

## Bug 3 — Visitor with `Object`-typed visit methods

```java
interface Visitor {
    void visit(Object o);            // single method, Object param
}
final class Circle implements Shape {
    public void accept(Visitor v) { v.visit(this); }
}
final class Square implements Shape {
    public void accept(Visitor v) { v.visit(this); }
}
class AreaVisitor implements Visitor {
    public void visit(Object o) {
        if (o instanceof Circle c) { /* ... */ }
        else if (o instanceof Square s) { /* ... */ }
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

This isn't double dispatch at all — it's single dispatch plus a hand-rolled `instanceof` chain. The Visitor pattern's whole point is *distinctly named* `visitCircle`/`visitSquare` methods so hop 2 selects by the visitor's runtime type without type tests. With one `visit(Object)`, hop 2 collapses to static overload selection on `Object`, and you're back to `instanceof`. **Fix:** either give the visitor real per-type methods (true Visitor) or drop the ceremony entirely and use a pattern switch — don't pay for `accept` and *still* write `instanceof`.
</details>

---

## Bug 4 — `equals` asymmetry across a hierarchy

```java
class Point {
    int x, y;
    public boolean equals(Object o) {
        return o instanceof Point p && p.x == x && p.y == y;
    }
}
class ColorPoint extends Point {
    int color;
    public boolean equals(Object o) {
        return o instanceof ColorPoint cp && cp.color == color && super.equals(cp);
    }
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

Symmetry is broken — the double-dispatch-over-hierarchy hazard. `new Point(1,2).equals(new ColorPoint(1,2,RED))` is `true` (Point.equals only checks x,y), but `colorPoint.equals(point)` is `false` (requires `instanceof ColorPoint`). A `HashSet` containing both can return inconsistent `contains` results. **Fix:** either use composition (a `ColorPoint` *has* a `Point`) instead of inheritance, or use `getClass()` equality so a `Point` and `ColorPoint` are never equal. *Effective Java* Item 10.
</details>

---

## Bug 5 — Expecting a switch to dispatch on subtype it doesn't know

```java
sealed interface Event permits Click, Key {}
record Click(int x) implements Event {}
record Key(char c)  implements Event {}

String describe(Event e) {
    return switch (e) {
        case Event ev -> "event";        // !
        case Click c  -> "click";
        case Key k    -> "key";
    };
}
```

**What's wrong?**

<details><summary>Diagnosis</summary>

This does not compile: `case Event ev` *dominates* the later, more specific cases (JLS §14.11.1 dominance rule). A pattern that matches everything must come last (or not at all). The author thought cases were tried most-specific-first like overloads — they are tried *in order*, and a dominating pattern shadows the rest. **Fix:** remove the `case Event ev` (the switch is already exhaustive over the sealed type) or move it to a `default`-like final position. Order matters in pattern switches; specificity does not auto-sort.
</details>

---

## Bug 6 — Megamorphic Visitor in a hot loop, "optimized" wrong

```java
double totalArea(List<Shape> shapes) {
    AreaVisitor v = new AreaVisitor();
    double sum = 0;
    for (Shape s : shapes) sum += s.accept(v);   // accept site goes megamorphic
    return sum;
}
```

**What's "wrong" (performance)?**

<details><summary>Diagnosis</summary>

Nothing is *incorrect*, but if `shapes` interleaves many subtypes, the single `s.accept(v)` call site sees `Circle`, `Square`, `Group`, … and becomes **megamorphic** — HotSpot can't inline it and falls back to an itable lookup per iteration. The "elegant" Visitor is now slower than a sealed pattern switch, which lowers to a flat jump table. **Fix (if profiling shows it):** replace with a pattern switch over a sealed `Shape`; there's no megamorphic virtual site to deoptimize. Don't assume Visitor is faster because it's OO — measure (see optimize.md).
</details>

---

## Bug 7 — Varargs overload silently swallowing calls

```java
void log(String msg)            { System.out.println("one: " + msg); }
void log(String msg, Object... a) { System.out.println("vararg"); }

log("hello");
```

**What prints, and is it the bug?**

<details><summary>Diagnosis</summary>

Prints `one: hello`. Phase 1 (strict, no varargs) finds `log(String)` applicable, so the search stops *before* the varargs overload is considered (varargs is Phase 3). That's correct here — but the bug appears when someone *intended* the varargs version to be the catch-all and is surprised it's bypassed for the exact-arity call. The trap is assuming varargs overloads compete equally; they're a last resort. **Lesson:** know the phase ordering — strict beats loose beats varargs.
</details>

---

## Bug 8 — Generic method "dispatching" on a type parameter

```java
<T> String handle(T value) {
    if (value instanceof Integer) return "int";
    return "other";
}
// caller hopes the method is "specialized" per T
```

**What's wrong?**

<details><summary>Diagnosis</summary>

`T` is erased to `Object` at runtime — there is no per-`T` dispatch and no specialization. The method is compiled once; the `instanceof` is the only runtime discrimination. Authors sometimes write `<T>` thinking it gives Julia-style multiple dispatch on `T`. It does not. **Fix:** if you need runtime type discrimination, pass a `Class<T>` token or switch on the value — generics provide compile-time safety, not runtime dispatch.
</details>

---

## Bug 9 — Acyclic Visitor silently no-ops

```java
interface CircleVisitor extends Visitor { void visitCircle(Circle c); }

final class Circle implements Shape {
    public void accept(Visitor v) {
        if (v instanceof CircleVisitor cv) cv.visitCircle(this);
        // else: nothing happens
    }
}

class SquareOnlyVisitor implements SquareVisitor { /* no CircleVisitor */ }
circle.accept(new SquareOnlyVisitor());   // does nothing
```

**What's wrong?**

<details><summary>Diagnosis</summary>

Acyclic Visitor's `instanceof` capability check means a visitor that doesn't implement the matching sub-interface produces a **silent no-op** — the circle is never visited, no error. This is the inherent risk of the acyclic variant: partial visitors are a feature, but unintended partiality is invisible. **Fix:** add an `else` branch that throws or logs for required-coverage cases, or use a base `visitDefault`. Don't use Acyclic Visitor when every element *must* be handled.
</details>

---

## Bug 10 — `super.accept` doesn't chain dispatch

```java
class Node implements Element {
    public void accept(Visitor v) { v.visitNode(this); }
}
class DecoratedNode extends Node {
    public void accept(Visitor v) {
        v.visitDecorated(this);
        super.accept(v);          // hope: also dispatch as a Node
    }
}
```

**What's the subtlety?**

<details><summary>Diagnosis</summary>

`super.accept(v)` is `invokespecial` — statically bound to `Node.accept`, which calls `v.visitNode(this)` where `this` is a `DecoratedNode` but typed (via the `Node.accept` body) as `Node`. So `visitNode` receives the object as a `Node`. This *works* if you intend the decorated node to be visited *both* ways, but authors often expect `super.accept` to re-dispatch dynamically — it never does; `invokespecial` skips the vtable. **Lesson:** Visitor composition up an inheritance chain is statically bound at each `super` hop, not a fresh dynamic dispatch.
</details>

---

## Bug 11 — Overload added later breaks `null` call sites

```java
// v1
void notify(Listener l) { ... }
notify(null);            // compiled fine in v1

// v2 — someone adds:
void notify(Channel c) { ... }
// now notify(null) at the old call site no longer compiles
```

**What's wrong?**

<details><summary>Diagnosis</summary>

Adding a sibling overload turned `notify(null)` *ambiguous* — `Listener` and `Channel` are incomparable, so there's no most-specific method (JLS §15.12.2.5). This is a **source-incompatible** change that breaks downstream callers passing `null`. **Fix:** avoid overloads whose parameter types are unrelated reference types when `null` is a realistic argument; or have callers cast. A subtle API-evolution hazard — overloading is part of your binary/source contract.
</details>

---

## Bug 12 — Boxing changes which overload runs

```java
void process(int i)     { System.out.println("int"); }
void process(Integer i) { System.out.println("Integer"); }

Integer boxed = 42;
int prim = 42;
process(boxed);   // ?
process(prim);    // ?
```

**What prints?**

<details><summary>Diagnosis</summary>

`process(boxed)` → `Integer` (exact match, Phase 1, no unboxing needed). `process(prim)` → `int` (exact match, Phase 1). No surprise *here* — but the bug surfaces when a refactor changes a field from `int` to `Integer` (or vice versa): the *same call site* silently re-binds to a different overload at the next compile, changing behavior with no code edit at the call. **Lesson:** overloading on `int`/`Integer` makes call behavior depend on the static type of the argument expression — brittle under refactoring. *Effective Java* Item 52: avoid overloads that differ only by box/primitive.
</details>

---

**Pattern across all twelve:** the bug is almost always *"expected runtime behavior from a compile-time decision"* (Bugs 1, 7, 8, 11, 12), *"broke a Visitor hop"* (Bugs 2, 3, 9, 10), or *"misunderstood pattern-switch ordering / equals symmetry"* (Bugs 4, 5). Prove every one with `javap -c` — the bytecode never lies about which method was bound.
