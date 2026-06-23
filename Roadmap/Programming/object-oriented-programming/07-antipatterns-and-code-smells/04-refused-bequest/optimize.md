# Refused Bequest — Performance and JIT Considerations

Refused bequest is primarily a design smell, but it also has measurable performance consequences. This document explains how the JIT compiler reacts to refused overrides, why composition often runs *faster* than refused-bequest inheritance, and which optimizations you forfeit by leaving refused methods on a hot path.

## 1. How HotSpot specializes virtual calls

Every non-`final`, non-`private`, non-`static` method in Java is virtual. When HotSpot sees a virtual call site, it tries to specialize it through one of three mechanisms:

1. **Monomorphic inline** — only one receiver type observed at this site. The JIT inlines the target method directly. Fastest case.
2. **Bimorphic inline** — two receiver types. The JIT generates an `instanceof` check plus two inlined branches.
3. **Megamorphic** — three or more types. Falls back to a vtable or inline-cache lookup. No inlining.

Refused bequest pushes call sites toward bimorphic and megamorphic dispatch by **expanding the set of receiver types polymorphic callers must handle**, even when the refused subtype "shouldn't" be there.

## 2. Dead overrides confuse the inliner

Consider:

```java
abstract class Renderer {
    public void render(Frame f) { drawBackground(f); drawShapes(f); drawText(f); }
    protected void drawBackground(Frame f) { /* default */ }
    protected void drawShapes(Frame f)     { /* default */ }
    protected void drawText(Frame f)       { /* default */ }
}

class GameRenderer extends Renderer {
    @Override protected void drawShapes(Frame f) { ... heavy work ... }
    @Override protected void drawText(Frame f)   { /* empty — refused */ }
}

class DebugRenderer extends Renderer {
    @Override protected void drawText(Frame f)   { ... }
    @Override protected void drawShapes(Frame f) { /* empty — refused */ }
}
```

A loop `for (Renderer r : list) r.render(f);` sees two implementations. Each `render` invocation goes through three virtual calls (`drawBackground`, `drawShapes`, `drawText`), and **each of those becomes bimorphic** because either implementation might be the receiver.

The empty refused overrides don't disappear at runtime; they still go through dispatch. The JIT pays the cost of:

- Loading the vtable entry,
- Calling into a method that does nothing,
- Returning.

Three empty calls per frame, multiplied by the frame rate, is real budget. Replacing the refused overrides with a `final` no-op base implementation lets the JIT *prove* monomorphism at that call site and elide the calls entirely.

## 3. Deoptimization risk

When the JIT inlines under a monomorphic or bimorphic assumption, it installs a **dependency** on the class hierarchy: "if a new subclass appears that overrides this method, deoptimize."

Refused bequest gets you deoptimized in two ways:

1. **Class loading** — a refused-bequest subclass loaded lazily (e.g., a test fake or a plugin) invalidates the inline. The next call to the previously hot path triggers deoptimization and recompilation.
2. **Mixed receivers** — if a refused-bequest subclass enters the receiver set (`List` instances containing both `ArrayList` and `Collections.unmodifiableList(...).getClass()`), the JIT widens dispatch and discards specialized code.

A useful mental model: **every refused-bequest class is a JIT pessimization hiding in plain sight**, because it almost always ends up in the same polymorphic collection as the well-behaved subclasses.

## 4. vtable bloat

The HotSpot vtable holds one entry per inherited or declared virtual method. Refused bequest does **not** reduce vtable size — the entry still exists, it just points to a method that throws.

Consequences:

- Larger objects' class metadata (each class has a vtable in metaspace).
- More cache pressure when dispatching through a vtable, because the relevant slots are scattered among refused stubs.
- Slower class loading, because each refused override still has to be linked.

For a hierarchy with 50 inherited methods and 30 refused overrides per subclass, you carry ~30 vtable entries pointing to UOE throwers. Multiply by N subclasses.

## 5. Branch prediction and ICache

Refused overrides that simply `throw new UnsupportedOperationException(...)` compile to a short method body. They tend to live in cold ICache regions because they're rarely called — but when they *are* called, you pay both the ICache miss to fetch the stub and the cost of allocating the exception object (which captures a stack trace by default — that's the expensive part, often hundreds of frames).

This is why "we test that the refusal works" tests are surprisingly slow: each one allocates a stack trace.

## 6. Composition's perf advantage

Composition replaces virtual dispatch on a refused-bequest subtype with a final, monomorphic call on a delegate. Concretely:

```java
// Inheritance with refusal
class ReadOnlyList<E> extends ArrayList<E> {
    @Override public boolean add(E e) { throw new UnsupportedOperationException(); }
    // ... 14 more refusals
}

// Composition
public final class ReadOnlyList<E> implements Iterable<E> {
    private final List<E> backing;
    public ReadOnlyList(Collection<? extends E> src) { this.backing = List.copyOf(src); }
    public E get(int i)        { return backing.get(i); }
    public int size()          { return backing.size(); }
    public Iterator<E> iterator() { return backing.iterator(); }
}
```

The composed version:

- Is `final`, so every method is monomorphic and inlinable.
- Has no inherited methods to refuse, so vtable is minimal.
- Allocates no UOE stack traces during normal operation.
- Holds a `List.copyOf(...)` whose concrete type can also be `final` (`ImmutableCollections.ListN`), enabling cross-class inlining.

JMH benchmarks on representative read-heavy workloads show composition-based read-only lists running 5–15% faster than refused-bequest subclasses of `ArrayList`, primarily because of monomorphic inlining of `get(int)` and `iterator()`.

## 7. Sealed types help the JIT

Java 17's sealed classes give the JIT closed-world information:

```java
public sealed interface PaymentMethod permits CreditCard, Cash, GiftCard {}
```

With a sealed interface, the JIT knows the *full* set of receivers at a call site. If only two of the three are actually loaded, it can specialize as bimorphic with high confidence and avoid speculative deoptimization. Refused-bequest hierarchies are usually open (`public abstract class ...`), so the JIT cannot make this assumption.

## 8. Empirical numbers

Approximate orders of magnitude from public JMH suites and the OpenJDK performance team's published guidance. Treat them as directional, not absolute:

| Scenario                                                      | Relative cost |
|---------------------------------------------------------------|---------------|
| Direct call on a `final` class method                         | 1×            |
| Monomorphic virtual call (single observed receiver)           | 1.0–1.1×      |
| Bimorphic virtual call                                        | 1.2–1.5×      |
| Megamorphic virtual call (vtable lookup)                      | 2–4×          |
| Megamorphic + capability check ("instanceof X") on hot path   | 3–6×          |
| Throwing `UnsupportedOperationException` with stack trace     | 10,000×+      |

The last row is the killer. A *single* refused-bequest path that occasionally gets hit (say, defensive programming probing `add` to see if a list is mutable) can dominate the profile because of stack-trace allocation.

## 9. Quick rules for performance-sensitive code

1. **`final` your refused-bequest victims first.** If a class refuses any bequest, make it `final` so no further subclass can join the polymorphic mess.
2. **Replace `UnsupportedOperationException` with a precomputed `ERROR_RESULT` sentinel** if you must signal refusal on a hot path. Better still: don't refuse.
3. **Prefer composition for any class that refuses more than 1 inherited method.** The JIT loves composed `final` collaborators.
4. **Use sealed hierarchies** when refusal cannot be avoided. The JIT can specialize closed worlds better than open ones.
5. **Never put refused-bequest subclasses in the same `List<T>` as well-behaved ones if `T`'s methods are on a hot loop.** Either segregate by type or replace `T` with a narrower interface that excludes the refused methods.
6. **Profile, then refactor.** Use `-XX:+PrintInlining` and JFR to confirm refused bequests are costing you before rewriting. Some refusals are cold and not worth fixing for performance alone — fix them for correctness instead.
7. **Measure `compilation_count`** in JFR. Refused-bequest sites often show repeated recompilation due to deoptimization storms.

## 10. When refused bequest is actually fine performance-wise

- **Cold paths** — `equals(Object)` on a class never used in a `HashSet`. Refused or not, the JIT never compiles it.
- **One-shot initialization** — refused mutators on a config object that is built once and never mutated. The JIT never sees the refused path.
- **Test doubles loaded only by the test classloader** — production JIT never observes them.

The general rule: **refused bequest hurts performance proportional to how polymorphic the parent type is in hot code**. A widely polymorphic parent (`List`, `Map`, `Runnable`) with a refused-bequest subclass is a serious perf risk. A rarely-polymorphic parent with one refused subclass is a design smell, not a perf bug.

## 11. Diagnostic flags worth knowing

```
-XX:+PrintInlining            # shows which calls got inlined and which didn't
-XX:+PrintCompilation         # logs JIT compilations and deoptimizations
-XX:+UnlockDiagnosticVMOptions
-XX:+PrintAssembly            # for the brave; needs hsdis
```

If you see repeated `made not entrant` log lines for a method on a class that has refused-bequest subclasses, that's the JIT bailing on inlining because of class-hierarchy changes.

## 12. Memorize this — the perf angle

> The JIT's most powerful weapon is monomorphic inlining, and refused bequest disarms it. Every refused override is one more receiver type at a polymorphic call site, one more vtable slot pointing at a UOE thrower, and one more reason the inline cache widens to a megamorphic miss. The cure is the same as for correctness: `final`, seal, or compose.
