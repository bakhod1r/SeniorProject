# Inheritance — Senior

> **What?** The runtime mechanics of inheritance: virtual method tables (vtables), `invokevirtual` vs `invokeinterface`, inline caches and devirtualization, the cost of deep hierarchies, the design choices of sealed types and the pattern-matching JIT, and why "favor composition over inheritance" is mechanical advice, not just stylistic.
> **How?** By tracing what the JVM does on each call and what the JIT can prove, then designing hierarchies that don't fight the optimizer.

---

## 1. Vtables and `invokevirtual`

When the JVM loads a class, it builds an internal **vtable** (virtual method table) — an array of method pointers indexed by *method slot number*. Subclasses inherit their parent's vtable layout and override slots for the methods they redefine.

```
Animal vtable:
  slot 0: speak  → Animal.speak

Dog vtable:
  slot 0: speak  → Dog.speak
  slot 1: bark   → Dog.bark
```

`invokevirtual` works by:

1. Read the receiver from the operand stack.
2. Read the receiver's klass pointer from its header.
3. Look up the klass's vtable at the resolved slot.
4. Jump to the function pointer at that slot.

Cost: 1 indirect load + 1 indirect call. ~5 ns on cold caches, ~1 ns when the cache lines are hot.

---

## 2. `invokeinterface` vs `invokevirtual`

`invokeinterface` is more expensive than `invokevirtual` because interface dispatch requires a *search* through the receiver's interface tables (itables). The JIT optimizes both, but `invokevirtual` has a slight edge.

```
itable layout (per class):
  interface Trainable: [methods...]
  interface Walker:    [methods...]
  ...
```

When you call `t.walk()` where `t` is `Trainable`, the JVM finds the `Trainable` itable for the receiver's class and looks up `walk`. Modern JVMs cache these lookups inline.

---

## 3. Inline caches and devirtualization

The JIT (HotSpot's C2) maintains *inline caches* at every virtual call site:

| State          | Action                                         |
|----------------|------------------------------------------------|
| Uninitialized  | First call: install the actual klass + target  |
| Monomorphic    | One klass seen ever — direct call, sometimes inlined |
| Bimorphic      | Two klasses — `if/else` branch on klass        |
| Megamorphic    | 3+ klasses — fallback to vtable lookup         |

A monomorphic call site is essentially free (the JIT can inline the body). A megamorphic one is full vtable cost.

**Practical implication:** if every test in your codebase passes a different mock subclass, your benchmark can be megamorphic where production is monomorphic. Always benchmark with realistic class diversity.

---

## 4. CHA — Class Hierarchy Analysis

When the JIT compiles a method, it consults the loaded classes. If a virtual call resolves to a class that has no overriding subclasses *currently loaded*, it can inline the call as if it were `final`.

Caveat: if a subclass that overrides the method is loaded later, the JIT *deoptimizes* — flushes the compiled code and falls back. This is rare in practice but possible.

`-XX:+PrintCompilation -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` to see this happen.

---

## 5. The cost of deep hierarchies

Each layer of inheritance adds:
- One vtable slot lookup is the same cost regardless of depth (it's an array index).
- But the *class loading* cost is proportional to depth.
- Field layout: each layer's fields are stored consecutively. Cache line behavior depends on field placement.

Where depth hurts:
- **Code locality.** A method dispatched through 5 vtable lookups across 5 different `.class` files reads 5 cold method bodies.
- **Method size.** JIT inlines methods up to a size limit (default 35 bytes for `MaxInlineSize`, 325 bytes for `FreqInlineSize`). Deep wrappers compose into long sequences that exceed inline budget.

Most production code stays under 5 levels deep. Beyond that, you're paying readability + JIT cost for diminishing structural benefit.

---

## 6. Final classes and methods

`final` does **not** make calls faster on its own. The JIT already devirtualizes when CHA proves there's no overrider. But `final` *guarantees* devirtualization — the JIT doesn't need to install a deoptimization trap.

```java
public final class Money { /* ... */ }       // hot path: every method call inlines
```

`final` also helps the human reader: signals "no, you can't extend this."

---

## 7. Sealed types and the JIT

A `sealed` class with a closed list of subclasses is in some ways better than `final` for the optimizer: the JIT knows the exact set of possible types and can emit a polymorphic-but-bounded dispatch.

For pattern-matching `switch`:

```java
sealed interface Shape permits Circle, Square, Triangle {}

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
        case Triangle t -> 0.5 * t.base() * t.height();
    };
}
```

The compiler generates a `lookupswitch`/`tableswitch` over class hashes or a trampoline. The JIT can specialize each branch with no virtual call at all.

---

## 8. Composition's mechanical advantages

Composition wraps an instance and forwards calls. The forwarder is usually inlined by the JIT (one-line method, calls one other method). Effective cost: zero, after JIT.

Inheritance forces tight coupling: the subclass holds the parent's full member set, including any new fields the parent adds. Field offsets become part of the binary contract — change the parent's fields, recompile every subclass.

In Java, composition's runtime cost is essentially identical to inheritance, but its evolution cost is much lower.

---

## 9. Hidden classes and the modern Java runtime

`MethodHandles.Lookup.defineHiddenClass` (Java 15+) lets you load a class that:
- Has no symbolic name in the system loader.
- Cannot be referenced by other classes.
- Can be unloaded when the lookup or method handle is GC'd.

Used internally for lambda metafactory, anonymous classes generated by `LambdaMetafactory`, and dynamic proxies. They participate in inheritance hierarchies just like normal classes; from the JIT's perspective, no difference.

---

## 10. Inheritance & GC

Inheritance affects GC indirectly:
- More fields → larger object → more bytes per allocation.
- Reference fields → more roots to trace.
- Deep hierarchies → more klass metadata in metaspace.

For data-heavy classes, prefer flat hierarchies + composition. For type hierarchies (sealed unions, polymorphic visitors), depth doesn't matter much.

---

## 11. The Open/Closed Principle in practice

OCP: "Software entities should be open for extension, closed for modification."

Naive interpretation: design every class to be extended. Result: a sea of abstract classes and protected hooks no one ever uses.

Mature interpretation: design the *seams* where extension is likely. Often this is interfaces, not class extension. The class itself can be `final` if its API is stable.

```java
public interface PaymentGateway { ... }   // open for extension via implementations
public final class StripeGateway implements PaymentGateway { ... }   // closed for modification
```

---

## 12. Refactoring out of bad inheritance

Patterns to extract:

- **Pull Up Method/Field** — move shared code to the parent.
- **Push Down Method/Field** — move parent code to the only subclass that uses it.
- **Replace Inheritance with Delegation** — convert `Stack extends ArrayList` to `Stack` containing an `ArrayList`.
- **Extract Interface** — split a fat parent into role interfaces.
- **Replace Subclass with Strategy** — turn vertical hierarchy into horizontal composition.
- **Tease Apart Inheritance** — when one hierarchy is doing two jobs, split into two hierarchies.

These all appear in the Refactoring section of this curriculum.

---

## 13. Hierarchies in real frameworks

| Framework            | Inheritance style                           |
|----------------------|---------------------------------------------|
| Spring               | Heavy abstract bases (`AbstractHandler...`); modern code prefers interfaces + Spring's bean composition |
| JDK collections      | Mostly interfaces (`Collection`, `List`); a couple of abstract bases (`AbstractList`) for code reuse |
| Java IO (legacy)     | Decorator-via-inheritance (`InputStream` → `FilterInputStream` → `BufferedInputStream`) — a constraint of pre-generic Java |
| NIO / NIO.2          | Deliberately moved to interfaces and composition |
| Servlet API          | Deep abstract bases (`HttpServlet`); modern alternatives (Jakarta, Helidon) prefer functional or interface-based |

The trend over 25 years is clear: less class inheritance, more interface-and-composition.

---

## 14. Multiple dispatch via visitor

Java has single dispatch (the receiver's type). For double dispatch, use the visitor pattern:

```java
interface Shape { <R> R accept(ShapeVisitor<R> v); }
interface ShapeVisitor<R> {
    R circle(Circle c);
    R square(Square s);
    R triangle(Triangle t);
}
class Circle implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.circle(this); }
}
```

Sealed types + pattern matching obsolete this for closed hierarchies. Visitor still useful for open hierarchies where you don't control the types.

---

## 15. Diagnostic flags to know

| Flag                                           | What it shows                            |
|------------------------------------------------|------------------------------------------|
| `-XX:+PrintCompilation`                        | When and what the JIT compiles           |
| `-XX:+PrintInlining`                           | Inlining decisions                       |
| `-XX:+PrintAssembly` (with hsdis)              | Generated machine code                   |
| `-XX:+PrintFlagsFinal`                         | All JVM flags                            |
| `-Xlog:class+init`                             | Class init events                        |
| `-Xlog:class+load`                             | Class load events                        |
| `-XX:+UnlockDiagnosticVMOptions -XX:+TraceClassResolution` | Resolution         |

---

## 16. Practical checklist

- [ ] Use `final` for classes you don't intend to subclass.
- [ ] Use `sealed` for closed hierarchies that benefit from pattern matching.
- [ ] Document any *self-use* contract on classes intended for extension.
- [ ] Prefer composition for code reuse; inheritance for type relationships.
- [ ] Avoid `protected` fields — use `protected` accessors instead.
- [ ] Use `@Override` everywhere.
- [ ] Profile dispatch sites with PrintInlining if performance matters.

---

**Memorize this**: At runtime, inheritance is a vtable + an inline cache. The JIT is excellent at devirtualizing monomorphic calls — meaning most of your "virtual" calls are actually direct calls after warmup. Sealed types give the optimizer extra information; deep hierarchies give it less. Design for monomorphism in hot paths.
