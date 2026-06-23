# Refactoring Toward Structural Patterns — Senior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

At the senior level the question shifts from "which refactoring?" to "what *invariants* does this structure impose, and what does it interact with?" Structural patterns rarely live alone. Composite begs for Visitor. Decorator chains carry ordering rules that are easy to violate. Bridge and Strategy look alike until you have *two* varying axes. Proxy is where cross-cutting concerns go to hide. And the interface you design up front decides whether any of these refactorings are even *possible*. This file is about those interactions and the design discipline that makes them clean.

---

## Contents

- [Composite + Visitor: separating operations from structure](#composite--visitor-separating-operations-from-structure)
- [Decorator ordering and invariants](#decorator-ordering-and-invariants)
- [Bridge: decoupling two varying dimensions](#bridge-decoupling-two-varying-dimensions)
- [Proxy for cross-cutting concerns](#proxy-for-cross-cutting-concerns)
- [Flyweight: when identity is shareable](#flyweight-when-identity-is-shareable)
- [Interface design that enables these refactorings](#interface-design-that-enables-these-refactorings)
- [Next](#next)

---

## Composite + Visitor: separating operations from structure

> References: [Composite](../../../design-patterns/02-structural/03-composite/junior.md), [Visitor](../../../design-patterns/03-behavioral/10-visitor/junior.md).

A Composite is great until you have **many unrelated operations** over the tree: render, validate, compute cost, export to JSON, count nodes. If each operation is a method on the component interface, the interface bloats and every node class must implement every operation — even operations that conceptually belong to a different module (a `pricing` operation cluttering a `ui` node class). This is *Divergent Change*: the node classes change for unrelated reasons.

**Visitor** inverts this. The tree exposes one `accept(Visitor)` method; each operation is a separate Visitor object. Adding an operation means adding a Visitor, not editing every node.

### The refactoring (Composite → Composite+Visitor)

```java
// BEFORE: operations crammed onto the component
interface Node {
    BigDecimal price();
    String toHtml();
    int validateAndCount();   // interface keeps growing
}

// AFTER: one accept(); operations become Visitors
interface Node {
    <R> R accept(Visitor<R> v);
}
interface Visitor<R> {
    R visitFile(FileNode f);
    R visitDir(DirNode d);
}
final class FileNode implements Node {
    @Override public <R> R accept(Visitor<R> v) { return v.visitFile(this); }
}
final class DirNode implements Node {
    final List<Node> children = new ArrayList<>();
    @Override public <R> R accept(Visitor<R> v) { return v.visitDir(this); }
}

// A new operation = a new visitor, no node edits
final class SizeVisitor implements Visitor<Long> {
    @Override public Long visitFile(FileNode f) { return f.size(); }
    @Override public Long visitDir(DirNode d) {
        long sum = 0;
        for (Node c : d.children) sum += c.accept(this);  // recurse via accept
        return sum;
    }
}
```

### The trade-off you must name

Visitor and the "method-per-operation" Composite sit on opposite sides of the **expression problem**:

- **Composite (operations as methods):** cheap to add a *node type* (one new class), expensive to add an *operation* (edit every node).
- **Composite + Visitor:** cheap to add an *operation* (one new visitor), expensive to add a *node type* (edit every visitor).

Refactor to Visitor only when **operations vary faster than node types** — a stable AST with a growing list of passes (type-check, optimize, emit) is the canonical fit. If your node *types* churn but operations are few, Visitor makes every change worse. Don't add it speculatively.

### Caveat

`visit` methods break encapsulation: the visitor reaches into node internals (`f.size()`, `d.children`). Keep the visited state deliberately exposed and stable, or you trade interface bloat for a fragile dependency on node internals.

---

## Decorator ordering and invariants

> Reference: [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md).

Decorators *stack*, and the stack order is **semantically load-bearing**. Two invariants govern correctness:

**1. Order changes meaning.** Consider an I/O stream with `Buffering` and `Encrypting` decorators:

```java
new EncryptingStream(new BufferingStream(raw));   // encrypt the buffered plaintext
new BufferingStream(new EncryptingStream(raw));   // buffer already-encrypted bytes
```

These are not equivalent. The first encrypts after buffering; the second buffers ciphertext. A compression decorator must wrap *inside* an encryption decorator (compress-then-encrypt — encrypted data is incompressible). The refactoring that introduces decorators must **pin the legal orderings**, because flag-based code often had the order implicit and "correct by accident."

**2. Each decorator must honor the component contract.** A decorator that filters, rate-limits, or short-circuits can silently violate the wrappee's invariant. Example: a `read()` contract promises "returns -1 at EOF". A decorator that returns `0` on a slow read breaks every client written to the contract — even though it "still implements the interface." This is a Liskov violation hiding in a wrapper. (See [find-bug.md](find-bug.md) for a worked instance.)

### Enforcing order without exposing it

Free-form `new A(new B(new C(x)))` lets callers build illegal stacks. The senior move is to **encapsulate composite/decorator construction with a Builder** so only valid orderings are expressible:

```java
Stream s = StreamBuilder.from(raw)
                        .compress()      // builder enforces compress-before-encrypt
                        .encrypt(key)
                        .buffer()
                        .build();
```

The Builder owns the ordering invariant; callers can't get it wrong. This is Kerievsky's *Encapsulate Composite with Builder* applied to a decorator chain — a structural pattern made safe by a creational one. (Builder mechanics live in the [creational sibling](../02-creational/junior.md).)

---

## Bridge: decoupling two varying dimensions

> Reference: [Bridge](../../../design-patterns/02-structural/02-bridge/junior.md).

The smell is a hierarchy that multiplies along **two independent axes**:

```
Shape × Renderer  ->  VectorCircle, RasterCircle, VectorSquare, RasterSquare, ...
```

`M` shapes × `N` renderers = `M × N` classes, and adding one renderer means adding `M` classes. The two axes — *what to draw* and *how to draw it* — vary independently but the inheritance tree couples them.

**Bridge** splits the hierarchy into two: an abstraction (`Shape`) that *holds* an implementor (`Renderer`) by composition instead of inheriting from it.

```java
interface Renderer { void drawCircle(double r); }       // implementor axis
class VectorRenderer implements Renderer { /* ... */ }
class RasterRenderer implements Renderer { /* ... */ }

abstract class Shape {                                   // abstraction axis
    protected final Renderer renderer;                   // the "bridge"
    protected Shape(Renderer renderer) { this.renderer = renderer; }
    abstract void draw();
}
class Circle extends Shape {
    private final double r;
    Circle(Renderer renderer, double r) { super(renderer); this.r = r; }
    @Override void draw() { renderer.drawCircle(r); }    // delegate across the bridge
}
```

Now it's `M + N` classes, and each axis grows independently.

### Bridge vs. Strategy — the senior distinction

They share a structure (an object holding a pluggable collaborator), but they differ in *intent and granularity*:

- **Strategy** swaps **one algorithm** behind a single operation (a `SortStrategy`, a `PricingPolicy`). It's behavioral; the host has *a* behavior it delegates.
- **Bridge** decouples **a whole abstraction hierarchy** from **a whole implementation hierarchy**. It's structural; *both sides* are expected to grow into families.

Rule of thumb: if only one side varies and it's a single algorithm, it's Strategy. If *both* sides are hierarchies that evolve independently, it's Bridge. Refactor toward Bridge specifically when you observe the `M × N` class explosion — not before.

### Caveat

Bridge front-loads abstraction. If one axis will realistically never have a second member (you'll only ever have one renderer), Bridge adds an interface and an indirection for nothing. Two axes must *actually* vary.

---

## Proxy for cross-cutting concerns

> Reference: [Proxy](../../../design-patterns/02-structural/07-proxy/junior.md).

A Proxy implements the *same interface* as the real subject and controls access to it. Unlike a Decorator (which adds *feature* behavior), a Proxy manages *access*: when the real object is created, whether the caller is allowed, what gets cached or logged. The refactorings that land on Proxy:

**Lazy loading (Virtual Proxy).** A heavy object is constructed eagerly even when rarely used. The smell: a constructor that loads a 50 MB image or opens a DB connection that 80% of requests never touch.

```java
interface Image { void render(); }
class RealImage implements Image {
    RealImage(String path) { /* expensive decode */ }
    @Override public void render() { /* ... */ }
}
class LazyImage implements Image {                      // virtual proxy
    private final String path;
    private RealImage real;                             // created on first use
    LazyImage(String path) { this.path = path; }
    @Override public void render() {
        if (real == null) real = new RealImage(path);  // defer cost
        real.render();
    }
}
```

**Access control (Protection Proxy).** Authorization checks scattered across call sites collapse into one proxy that gates the subject. **Remote/caching proxies** similarly centralize network or memoization concerns.

### The discipline: same contract, transparent substitution

A Proxy must be a drop-in for the subject — clients hold the *interface*, never the concrete type. The moment a caller needs `RealImage`-specific methods, the proxy leaks. And lazy proxies introduce a hidden concern: **thread safety** of the lazy init (the `if (real == null)` above is a race under concurrency — you'd need a guarded/holder idiom). Proxies that add caching must also answer invalidation. These are not free; they're *relocated* complexity.

### Proxy vs. Decorator vs. Adapter (one line each)

- **Adapter** changes the interface (incompatible → compatible).
- **Decorator** keeps the interface, adds *behavior/features*.
- **Proxy** keeps the interface, controls *access/lifecycle* — same interface, but the intent is gatekeeping, not enrichment.

---

## Flyweight: when identity is shareable

> Reference: [Flyweight](../../../design-patterns/02-structural/06-flyweight/junior.md).

The smell: **vast numbers of objects that are mostly identical**. A text editor with one `Character` object per glyph holds millions of objects whose *intrinsic* state (the font, the glyph shape for 'a') repeats endlessly. Memory balloons; GC thrashes.

Flyweight splits state into:

- **Intrinsic** (shared, immutable): the glyph 'a' in Times 12pt — stored once, in a pool.
- **Extrinsic** (per-use, passed in): the position of *this* 'a' on the page.

```java
final class Glyph {                       // intrinsic, shared, immutable
    private final char c; private final Font font;
    Glyph(char c, Font font) { this.c = c; this.font = font; }
    void drawAt(int x, int y) { /* uses x,y extrinsic */ }
}
final class GlyphFactory {
    private final Map<String, Glyph> pool = new HashMap<>();
    Glyph get(char c, Font font) {
        return pool.computeIfAbsent(c + "|" + font, k -> new Glyph(c, font));
    }
}
```

A document with a million 'a's now references **one** `Glyph('a', timesNew)`; position lives in the layout, not the glyph.

### Hard preconditions (don't skip)

- **Intrinsic state must be immutable.** Shared mutable state is a bug factory — a Flyweight that lets a caller mutate the shared glyph corrupts every reference. Enforce immutability.
- **Extrinsic state must be cheap to supply per call.** If callers must reconstruct heavy context to pass in, you've moved the cost, not removed it.
- **The sharing must be real.** Flyweight pays only when the *same* intrinsic value recurs at scale. Pooling a handful of distinct objects just adds a map lookup.

Measured wins and the latency of pool lookups are covered in [professional.md](professional.md).

---

## Interface design that enables these refactorings

Every structural refactoring above depends on a **stable, sufficient interface** existing — or being extractable. The senior skill is shaping interfaces so these moves stay open:

1. **Program to a role, not a class.** If clients depend on `Image` rather than `RealImage`, you can later slip in a Proxy or Decorator with zero client changes. Concrete-type dependencies *forbid* structural refactoring.
2. **Keep component interfaces narrow.** A Decorator must delegate *every* method; a Composite leaf must implement *every* method. A 3-method interface decorates cleanly; a 25-method "fat interface" makes every wrapper a boilerplate factory and tempts decorators to no-op methods (an [Interface Segregation](../../../object-oriented-programming/) violation surfacing as structural friction).
3. **Separate child-management from leaf operations** (transparent vs. safe, from [junior.md](junior.md)). The choice constrains what callers can do uniformly and what the compiler catches.
4. **Make intrinsic state explicit and final.** Flyweight is only possible if the shareable state is *already* immutable, or trivially made so. Mutable value objects close that door.
5. **Design `accept` before you need Visitor.** Retrofitting `accept(Visitor)` onto a sealed hierarchy you don't control is painful. If you anticipate operation growth on a stable type set, leave the door open.

The throughline: **structural refactorings are interface refactorings in disguise.** You can only wrap, compose, or proxy behind an interface that is narrow, role-based, and stable. Get the interface right and the patterns become a one-evening refactoring; get it wrong and every one of them requires touching the whole client base first.

---

## Next

- [junior.md](junior.md) — Decorator and Composite basics.
- [middle.md](middle.md) — One/Many Composite, Extract Composite, Adapter refactorings.
- [professional.md](professional.md) — Performance & memory cost of structural indirection; when to inline.
- [interview.md](interview.md) — Interview Q&A.
- [tasks.md](tasks.md) — Hands-on exercises.
- [find-bug.md](find-bug.md) — Diagnose broken structural patterns.
- [optimize.md](optimize.md) — Propose (or reject) structural refactorings.
