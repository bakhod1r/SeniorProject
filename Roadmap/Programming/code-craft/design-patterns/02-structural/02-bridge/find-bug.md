# Bridge — Find the Bug

> **Source:** [refactoring.guru/design-patterns/bridge](https://refactoring.guru/design-patterns/bridge)

Each section presents a Bridge that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Hard-coded implementor (no real bridge)](#bug-1-hard-coded-implementor-no-real-bridge)
2. [Bug 2: Implementor instance shared with state](#bug-2-implementor-instance-shared-with-state)
3. [Bug 3: Implementor leaking through abstraction's API](#bug-3-implementor-leaking-through-abstractions-api)
4. [Bug 4: instanceof in the abstraction (Java)](#bug-4-instanceof-in-the-abstraction-java)
5. [Bug 5: Bridge into a class that has no second implementor](#bug-5-bridge-into-a-class-that-has-no-second-implementor)
6. [Bug 6: Implementor pinned by long-lived abstraction](#bug-6-implementor-pinned-by-long-lived-abstraction)
7. [Bug 7: Re-entrant call between abstraction and implementor](#bug-7-re-entrant-call-between-abstraction-and-implementor)
8. [Bug 8: Stale implementor reference (Python)](#bug-8-stale-implementor-reference-python)
9. [Bug 9: Wrong dimension cut (coupled axes)](#bug-9-wrong-dimension-cut-coupled-axes)
10. [Bug 10: Bridge but with class adapter inheritance (Python)](#bug-10-bridge-but-with-class-adapter-inheritance-python)
11. [Bug 11: Implementor mutated through accessor (Go)](#bug-11-implementor-mutated-through-accessor-go)
12. [Bug 12: Bridge dispatch in tight loop with megamorphism (Java)](#bug-12-bridge-dispatch-in-tight-loop-with-megamorphism-java)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Hard-coded implementor (no real bridge)

```java
public abstract class Shape {
    protected final Renderer renderer = new VectorRenderer();   // hard-coded!
    public abstract void draw();
}
```

<details><summary>Reveal</summary>

**Bug:** The implementor is constructed inside the abstraction. The Bridge is structurally there, but you can never swap implementations. Tests can't fake the renderer; production can't switch to raster. The pattern's whole point is gone.

**Fix:** inject the implementor.

```java
public abstract class Shape {
    protected final Renderer renderer;
    protected Shape(Renderer renderer) { this.renderer = renderer; }
    public abstract void draw();
}
```

**Lesson:** A Bridge that constructs its own implementor is a Bridge in name only.

</details>

---

## Bug 2: Implementor instance shared with state

```java
public class GlyphRenderer implements Renderer {
    private int totalGlyphsRendered = 0;   // shared mutable state
    public void renderGlyph(int codepoint) { totalGlyphsRendered++; ... }
}

// Wired into many shapes
Renderer r = new GlyphRenderer();
List<Shape> shapes = List.of(new TextLine(r), new TextLine(r), new TextLine(r));
shapes.parallelStream().forEach(Shape::draw);   // race!
```

<details><summary>Reveal</summary>

**Bug:** The renderer counts glyphs in a non-thread-safe field. When many shapes render in parallel, `totalGlyphsRendered++` races. The total is undercounted; tests pass; production gives wrong numbers under load.

**Fix:** Either make the implementor thread-safe (`AtomicInteger`), or make it stateless, or one renderer per shape.

```java
private final AtomicInteger totalGlyphsRendered = new AtomicInteger();
```

**Lesson:** Sharing a stateful implementor across abstractions requires explicit thread-safety. Default to stateless implementors.

</details>

---

## Bug 3: Implementor leaking through abstraction's API

```java
public abstract class Shape {
    protected final Renderer renderer;
    protected Shape(Renderer r) { this.renderer = r; }
    public Renderer getRenderer() { return renderer; }   // !
    public abstract void draw();
}
```

<details><summary>Reveal</summary>

**Bug:** Exposing the implementor through `getRenderer()` lets clients call into it directly, bypassing the abstraction. The two hierarchies become coupled to clients, defeating the bridge.

**Fix:** Don't expose the implementor. If clients need a capability, route it through abstraction methods.

```java
// no getRenderer() — capabilities exposed via Shape methods only.
```

**Lesson:** The implementor is internal. Once it leaks into client code, you can't change the implementor side without breaking clients.

</details>

---

## Bug 4: instanceof in the abstraction (Java)

```java
public abstract class Shape {
    protected final Renderer renderer;
    public void specialDraw() {
        if (renderer instanceof VectorRenderer) {
            ((VectorRenderer) renderer).vectorOnlyMethod(...);
        } else {
            renderer.renderCircle(...);
        }
    }
}
```

<details><summary>Reveal</summary>

**Bug:** The abstraction is checking the concrete implementor type. Adding a new renderer requires changing `Shape`. The Bridge has degenerated into a `switch` statement.

**Fix:** Either expand the implementor interface so all implementors support the operation (perhaps as a no-op), or split into two interfaces (`BasicRenderer`, `AdvancedRenderer`) and have the abstraction declare which it needs.

```java
public interface AdvancedRenderer extends Renderer { void vectorOnlyMethod(...); }
public class VectorRenderer implements AdvancedRenderer { ... }

public class FancyShape extends Shape {
    private final AdvancedRenderer adv;
    public FancyShape(AdvancedRenderer r) { super(r); this.adv = r; }
}
```

**Lesson:** `instanceof` in the abstraction is a sign the Bridge cut is wrong (or the interface is too small).

</details>

---

## Bug 5: Bridge into a class that has no second implementor

```go
type Storage interface { Save(string, []byte) error }
type FileStorage struct{ path string }
func (f *FileStorage) Save(k string, v []byte) error { /* ... */ }

type UserRepo struct{ s Storage }   // only ever wired with *FileStorage
```

<details><summary>Reveal</summary>

**Bug:** The interface has only one implementor and there's no plan for a second. The bridge is overhead with no benefit. Worse, the indirection makes the code harder to read and debug.

**Fix:** Inline the dependency.

```go
type UserRepo struct{ fs *FileStorage }
```

**Lesson:** Don't pre-build interfaces "in case you need them." YAGNI. Add the interface when the second implementor arrives — refactoring then is cheap.

**Counter-exception:** if the interface enables fast tests via a fake, that's a real second "implementor" — keep it. Audit honestly.

</details>

---

## Bug 6: Implementor pinned by long-lived abstraction

```java
class Cache {
    private final Storage s;
    public Cache(Storage s) { this.s = s; }
    // long-lived; never closed
}

Storage s = new BigDiskStorage(/* opens file handles */);
Cache c = new Cache(s);
// ... s never closed; file handles leak
```

<details><summary>Reveal</summary>

**Bug:** The Bridge gives `Cache` a reference to `Storage`. As long as `Cache` lives, `Storage` lives — and any resources it holds (file handles, sockets, threads) leak.

**Fix:** Make the abstraction `AutoCloseable` (or equivalent) and propagate close.

```java
class Cache implements AutoCloseable {
    private final Storage s;
    public Cache(Storage s) { this.s = s; }
    public void close() throws Exception { if (s instanceof AutoCloseable) ((AutoCloseable) s).close(); }
}
```

**Lesson:** The Bridge link is also a *lifecycle* link. Decide who owns close.

</details>

---

## Bug 7: Re-entrant call between abstraction and implementor

```java
public abstract class Shape {
    protected final Renderer renderer;
    public final void draw() {
        renderer.renderShape(this);   // calls back into shape
    }
    public abstract Geometry geometry();
}

public class Circle extends Shape {
    public Geometry geometry() {
        // expensive: tessellation
        return ...;
    }
}

public class VectorRenderer implements Renderer {
    public void renderShape(Shape s) {
        Geometry g = s.geometry();   // 1st call
        if (looksWeird(g)) {
            g = s.geometry();         // recompute! 2nd call!
        }
        ...
    }
}
```

<details><summary>Reveal</summary>

**Bug:** The implementor calls `s.geometry()` multiple times. Each call retessellates. CPU goes up; cache hits don't help because the call sequence is inside the renderer.

**Fix:** Cache or pass the result as an argument.

```java
public void renderShape(Shape s) {
    Geometry g = s.geometry();
    if (looksWeird(g)) g = s.geometry();   // still wrong if you really need recompute
    // OR memoize on Shape:
}
```

Or memoize:

```java
public abstract class Shape {
    private Geometry cached;
    public final Geometry geometry() {
        if (cached == null) cached = computeGeometry();
        return cached;
    }
    protected abstract Geometry computeGeometry();
}
```

**Lesson:** Re-entrant call patterns across the bridge are a performance trap. Profile, then memoize on the side that owns the value.

</details>

---

## Bug 8: Stale implementor reference (Python)

```python
class Shape:
    def __init__(self, renderer): self.renderer = renderer
    def draw(self): self.renderer.draw_circle(self.r)

renderer = VectorRenderer()
shape = Shape(renderer)

# later, code reassigns the local:
renderer = RasterRenderer()
shape.draw()   # still uses VectorRenderer!
```

<details><summary>Reveal</summary>

**Bug:** Python's name binding doesn't change the reference held by `shape.renderer`. The user thought "I swapped the renderer" by reassigning a local; the Bridge holds the original. Easy to miss in dynamic code.

**Fix:** Either reassign explicitly:

```python
shape.renderer = RasterRenderer()
```

Or design swap as an explicit method:

```python
def set_renderer(self, r): self.renderer = r
```

**Lesson:** Bridge instances pin the implementor by reference. Mutating a local that *was* the implementor doesn't propagate. Be explicit about swaps.

</details>

---

## Bug 9: Wrong dimension cut (coupled axes)

```python
# Brief: split Order into Order × ShippingMethod.

class ShippingMethod(ABC):
    @abstractmethod
    def label_format(self) -> str: ...

class StandardShipping(ShippingMethod):
    def label_format(self): return "STD"

class ExpressShipping(ShippingMethod):
    def label_format(self): return "XPR"

class Order:
    def __init__(self, shipping: ShippingMethod, weight_kg: float, items: list):
        self.shipping = shipping
        self.weight_kg = weight_kg
        self.items = items

    def cost(self):
        if isinstance(self.shipping, StandardShipping):
            return 5 + self.weight_kg
        elif isinstance(self.shipping, ExpressShipping):
            return 12 + self.weight_kg * 2
```

<details><summary>Reveal</summary>

**Bug:** The "Bridge" was supposed to separate `Order` from `ShippingMethod`. But `Order.cost()` does `isinstance` and computes per-method — meaning every change to shipping methods requires changing `Order`. The dimensions weren't truly orthogonal.

**Fix:** push cost calculation into the implementor.

```python
class ShippingMethod(ABC):
    @abstractmethod
    def cost_for(self, weight_kg: float) -> float: ...

class StandardShipping(ShippingMethod):
    def cost_for(self, w): return 5 + w

class Order:
    def cost(self): return self.shipping.cost_for(self.weight_kg)
```

**Lesson:** If the abstraction has to switch on the implementor type, the cut is wrong. Either move the behavior into the implementor or rethink the dimensions.

</details>

---

## Bug 10: Bridge but with class adapter inheritance (Python)

```python
class Shape:
    def __init__(self, renderer): self.renderer = renderer

class Circle(Shape, VectorRenderer):   # multiple inheritance
    def draw(self): self.render_circle(self.r)
```

<details><summary>Reveal</summary>

**Bug:** Multiple inheritance from both `Shape` and `VectorRenderer` collapses the two hierarchies into one. Now `Circle` *is* a `VectorRenderer`. There's no bridge — just inheritance. Adding `RasterCircle` brings back class explosion.

**Fix:** Don't inherit from both. Hold the renderer as a field (composition).

```python
class Circle(Shape):
    def draw(self): self.renderer.render_circle(self.r)
```

**Lesson:** Bridge is composition, not multiple inheritance. Diamond inheritance for "two roles" is a different pattern (and usually a mistake).

</details>

---

## Bug 11: Implementor mutated through accessor (Go)

```go
type Renderer interface { Color() *Color; SetColor(c Color) }

type defaultRenderer struct{ c Color }
func (r *defaultRenderer) Color() *Color { return &r.c }   // returns pointer!
func (r *defaultRenderer) SetColor(c Color) { r.c = c }

type Shape struct{ r Renderer }
func (s Shape) Draw() {
    *s.r.Color() = Color{R: 255}   // mutates the renderer!
}
```

<details><summary>Reveal</summary>

**Bug:** `Color()` returns a pointer to the renderer's internal field. The shape mutates it directly through the pointer, bypassing `SetColor`. If the renderer is shared across shapes, every shape's color leaks into the others.

**Fix:** return by value.

```go
func (r *defaultRenderer) Color() Color { return r.c }
```

**Lesson:** Returning internal pointers from an implementor is a leaky abstraction. Return values or immutable views.

</details>

---

## Bug 12: Bridge dispatch in tight loop with megamorphism (Java)

```java
// 100 different shape types × 5 different renderer types
for (Shape s : allShapes) s.draw();
```

<details><summary>Reveal</summary>

**Bug:** The call site sees 100+ receiver types for `Shape.draw()` and 5 receiver types for `Renderer.render*` inside. Both are megamorphic; HotSpot's inline caches fail; every call is full vtable dispatch. Profiler shows surprisingly high CPU in `draw()`.

**Fix:** Group by type before iterating, or specialize the hot path.

```java
allShapes.stream()
    .collect(Collectors.groupingBy(Shape::getClass))
    .forEach((cls, group) -> group.forEach(Shape::draw));   // each lambda site is more monomorphic
```

For extreme cases, hand-write per-type loops.

**Lesson:** Both axes polymorphic at the same site → megamorphism. Only matters in measurably hot paths; profile first.

</details>

---

## Practice Tips

- Read each snippet, **stop**, write down what you think is wrong.
- For each bug, ask: "what does production failure look like?" Many Bridge bugs are dormant — wrong dimension cut, leaky abstraction, hidden megamorphism.
- After fixing, write a unit test that *would have caught* the bug. If you can't, the fix is incomplete.
- Repeat in a week with answers covered.
- These patterns repeat across codebases. Memorize the smells, not the specifics.

---

← Back to Bridge folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Bridge — Optimize](optimize.md)
