# Default Methods and the Diamond Problem — Optimize

> Default methods are *just* interface methods with bodies. At the bytecode level they compile to ordinary instance methods on the interface class file. At the dispatch level they go through `invokeinterface`. At the JIT level they inline exactly the same way any virtual call does. This file walks the cost model: where defaults are free, where they're slightly slower than `invokevirtual`, when `static` helpers beat them, and what happens when a class-side override gets in the way of an interface default. All numbers are illustrative; verify in your environment with JMH.

---

## 1. Default methods compile to ordinary interface method bytecode

A `default` method is, at the class-file level, just an instance method on the interface with a `Code` attribute. There is no `default` flag in the class-file format — the compiler emits the method with `ACC_PUBLIC` and a body. The presence of a body is what makes a class implementing the interface inherit it.

```java
public interface Greeter {
    String name();
    default String greet() { return "Hello, " + name() + "!"; }
}
```

`javap -p -v Greeter.class` shows the default as:

```
public java.lang.String greet();
  descriptor: ()Ljava/lang/String;
  flags: (0x0001) ACC_PUBLIC
  Code:
    stack=3, locals=1, args_size=1
       0: aload_0
       1: invokeinterface #4, 1   // InterfaceMethod Greeter.name:()Ljava/lang/String;
       6: invokedynamic #8, 0     // makeConcatWithConstants:()Ljava/lang/String;
      11: areturn
```

Two observations:

- The default's body uses `invokeinterface` to reach `name()` — because at the bytecode level `name()` is just another interface method, and the receiver type is the interface.
- String concatenation lowers to `invokedynamic` (`StringConcatFactory`) — the same as any modern `+`.

When a class implements `Greeter` without overriding `greet`, its method table includes a slot for `greet` that points to the interface's bytecode. There is no copy — the JVM links the implementor's vtable entry to the interface's `Code` attribute.

---

## 2. `invokeinterface` and the itable

Calls to interface methods compile to `invokeinterface`. The JVM resolves them through the receiver class's *interface method table* (itable):

```
0: aload_1
1: invokeinterface #6, 1   // Greeter.greet:()Ljava/lang/String;
```

The classical lookup is:

1. Take the receiver's class.
2. Find the entry in its itable corresponding to the resolved interface.
3. Within that entry, jump to the slot for the resolved method.

The cost compared to `invokevirtual` (which goes through a *fixed-offset* vtable slot):

- `invokevirtual`: one indirect load (vtable[receiver][slot]).
- `invokeinterface`: roughly two loads + a possible itable cache check (itable[receiver][interface][slot]).

In modern HotSpot the difference for a *cached* call is a handful of cycles. For a *first-call* the difference can be twice as much. The JIT erases both for monomorphic and bimorphic call sites — the comparison only matters in megamorphic hot paths.

For deeper coverage of dispatch costs, see `SOLID/01-solid-principles/optimize.md` §3.

---

## 3. JIT inlines monomorphic defaults

When a call site sees only one concrete receiver class for a default-method call, HotSpot's C2 compiler inlines the default's body directly into the caller.

```java
public interface Greeter {
    String name();
    default String greet() { return "Hello, " + name() + "!"; }
}
public final class EnglishGreeter implements Greeter {
    public String name() { return "Sam"; }
}

void run(Greeter g) {
    for (int i = 0; i < 10_000_000; i++) g.greet();   // monomorphic if g is always EnglishGreeter
}
```

After enough invocations C2 sees that `g.greet()` only ever dispatches to `Greeter.greet` (the default) on `EnglishGreeter`. It inlines `greet` into `run`, then inlines `name()` (which it can prove resolves to `EnglishGreeter.name` since `EnglishGreeter` is `final`), then folds the constant `"Sam"` into the concatenation. The resulting compiled code does no virtual calls at all.

**Inspect:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` shows entries like:

```
@ 1   Greeter::greet (10 bytes)   inline (hot)
  @ 1   EnglishGreeter::name (4 bytes)   inline (hot)
```

Two factors gate this:

- The default method's body must be small enough to inline (default threshold ~35 bytes of bytecode, tunable with `-XX:MaxInlineSize`).
- The call must be monomorphic (one receiver type) or bimorphic (two types).

For megamorphic call sites — three or more receiver classes — C2 falls back to a real `invokeinterface` and inlining stops. This is the same shape as any polymorphic call; defaults don't introduce new performance characteristics.

---

## 4. Default method vs `static` method on the same interface

A subtle cost comparison: should a small helper be a `default` or a `static`?

```java
public interface Maths {
    static  int squareS(int x) { return x * x; }
    default int squareD(int x) { return x * x; }
}
```

- `Maths.squareS(3)` compiles to `invokestatic` — a direct call, no receiver lookup.
- `someMaths.squareD(3)` compiles to `invokeinterface` — receiver lookup through the itable.

For a monomorphic call site both inline to the same machine code. For a megamorphic one, `invokestatic` wins by a few nanoseconds. More importantly: `invokestatic` has no receiver, so the JIT never has to consider receiver-type variance. If a helper does not need `this` (does not read instance state through abstract methods), prefer `static`.

```java
public interface Comparator<T> {
    int compare(T a, T b);

    // GOOD: factory belongs on the namespace, not the instance.
    static <T extends Comparable<? super T>> Comparator<T> naturalOrder() {
        return (a, b) -> a.compareTo(b);
    }

    // GOOD: combinator depends on `this`.
    default Comparator<T> reversed() {
        return (a, b) -> compare(b, a);
    }
}
```

Use the receiver only when you need it. Pure functions belong as `static`; behaviour built on the implementor's state belongs as `default`.

---

## 5. Class-side override eliminates the virtual dispatch through default

A class that overrides a default method removes the entire interface-default code path from the call site:

```java
public interface Greeter {
    default String greet() { return "Hello"; }
}

// Slow path: implementor inherits the default
public class A implements Greeter { }
// Fast path: implementor overrides
public final class B implements Greeter {
    @Override public String greet() { return "Hi"; }
}

void useA(A a) { a.greet(); }   // invokeinterface → Greeter.greet (default)
void useB(B b) { b.greet(); }   // invokevirtual → B.greet (concrete, final-class)
```

For `B`, the call site emits `invokevirtual` against the class type, the receiver is final, and the call is essentially a direct call after inlining. For `A`, the call goes through `invokeinterface` and dispatches to the default's body. In a monomorphic profile both are inlined; in a megamorphic profile the `B` path is faster because `invokevirtual` is slightly cheaper than `invokeinterface` *and* because `B` being `final` lets the JIT prove no further subclassing can change the dispatch.

**Practical implication:** if a default method is in a hot path and the implementor is known to be final, overriding it on the implementor class (even if the body is identical) can help the JIT pick a cheaper dispatch. This is a *micro*-optimization — only worth doing when you have a profile that points at it.

---

## 6. `Interface.super.method()` compiles to `invokespecial`

Calls to a specific superinterface's default use a different bytecode:

```java
public class Duck implements Walker, Swimmer {
    @Override
    public String describe() {
        return Walker.super.describe();
    }
}
```

The body compiles to:

```
0: aload_0
1: invokespecial #4   // InterfaceMethod Walker.describe:()Ljava/lang/String;
4: areturn
```

`invokespecial` dispatches *statically* — it goes to *exactly* the method declared in `Walker`, with no further virtual lookup. That's what makes `Walker.super.describe()` deterministic — even if a sub-interface or a sub-class later overrides `describe`, this specific call still reaches `Walker`'s body.

Cost-wise, `invokespecial` is the cheapest of the dispatch instructions — equivalent to a static call after resolution. If you find yourself making many `Interface.super.method()` calls in a hot path (uncommon), they cost less than the corresponding `invokeinterface`.

---

## 7. Default methods and escape analysis

A default that builds intermediate objects looks like an allocation hot spot, but HotSpot's escape analysis (EA) can often eliminate them:

```java
public interface Money {
    long cents();
    default Money plus(Money other) { return new Money.Concrete(cents() + other.cents()); }
    record Concrete(long cents) implements Money { }
}

long sumPrices(Money a, Money b, Money c) {
    return a.plus(b).plus(c).cents();   // allocates two intermediate Money.Concrete?
}
```

If `sumPrices` is monomorphic in `Money`'s concrete type (only `Money.Concrete` is ever seen), C2 can:

1. Inline `plus` (small default body).
2. Inline the `Concrete` constructor.
3. Prove that the intermediate `Concrete` references never escape `sumPrices`.
4. Scalar-replace the records — the `long cents` lives in a register, no heap allocation.

The result: zero allocations per call, even though the source code looks allocation-heavy. Records and small final classes are the easiest shapes for EA to optimise (`SOLID/01-solid-principles/optimize.md` §2).

**Verify:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` shows scalar-replaced allocation sites. If your default method's allocations don't appear, EA proved they don't escape.

The shape that *defeats* EA is a default that stores its result somewhere visible (a static field, a returned collection that lives across method boundaries). Once the intermediate escapes, EA bails and you pay the full allocation cost.

---

## 8. Interface dispatch vs class dispatch — the megamorphic case

When a call site sees many different receiver classes, `invokeinterface` costs more than `invokevirtual` by a measurable margin. Concretely (illustrative JDK 21 numbers on a modern x64):

| Shape                                   | Inlined? | ns/op (illustrative) |
| --------------------------------------- | -------- | -------------------- |
| Monomorphic `invokeinterface` (default) | Yes      | ~1                   |
| Bimorphic `invokeinterface` (default)   | Yes      | ~1.5                 |
| Megamorphic `invokeinterface` (default) | No       | ~6                   |
| Monomorphic `invokevirtual` (class)     | Yes      | ~1                   |
| Megamorphic `invokevirtual` (class)     | No       | ~5                   |

The differences are small. They matter only for hot loops on dispatch-bound work — most application code spends time elsewhere (I/O, allocation, GC, lock contention).

If you genuinely hit a megamorphic interface call site in a profile, options:

1. **Specialize the loop.** Pull the dispatch out, take the strategy once, run the loop with a single concrete type.
2. **Convert to a `sealed` type + pattern matching.** The closed set lets the JIT generate a `typeswitch` rather than a real virtual call.
3. **Use a `static` factory + concrete `final` class** for the call site. `invokevirtual` on a final class effectively becomes a direct call after inlining.

See [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/) for the sealed alternative.

---

## 9. Microbenchmark — default vs static helper vs class method

A JMH harness comparing four ways to express the same small computation.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
@Fork(value = 2)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class DefaultDispatchBench {

    interface Maths {
        int x();
        default int squareDefault() { return x() * x(); }
        static int squareStatic(int v) { return v * v; }
    }

    static final class M implements Maths {
        private final int x;
        M(int x) { this.x = x; }
        public int x() { return x; }
        public int squareClass() { return x * x; }
    }

    M m;
    Maths mi;

    @Setup public void init() { m = new M(7); mi = m; }

    @Benchmark public int viaDefault()  { return mi.squareDefault(); }
    @Benchmark public int viaStatic()   { return Maths.squareStatic(m.x()); }
    @Benchmark public int viaClass()    { return m.squareClass(); }
    @Benchmark public int viaInline()   { int x = m.x(); return x * x; }
}
```

Typical results on JDK 21:

| Bench         | ns/op  | Notes                                              |
| ------------- | ------ | -------------------------------------------------- |
| `viaInline`   | ~1.0   | baseline, no virtual call                          |
| `viaClass`    | ~1.0   | `invokevirtual`, inlined (M is `final`)           |
| `viaDefault`  | ~1.0   | `invokeinterface`, inlined (monomorphic)           |
| `viaStatic`   | ~1.0   | `invokestatic`, inlined                            |

All four collapse to the same compiled code when monomorphic. The four-times-faster comparison appears only when you make the call site megamorphic (multiple `Maths` implementations sharing the same call site). At that point the relative cost ordering becomes `viaInline` ≤ `viaStatic` < `viaClass` < `viaDefault` — but the absolute cost is still in nanoseconds and rarely dominates real workloads.

**Run `-prof gc` too** — none of these should allocate per call. If your bench shows allocations, escape analysis didn't fire and you have a different problem to investigate.

---

## 10. Quick rules

- [ ] Default methods compile to ordinary interface methods with a `Code` attribute — there is no special bytecode for them.
- [ ] Calls to defaults emit `invokeinterface`; the JIT inlines monomorphic and bimorphic sites just like any virtual call.
- [ ] For helpers that don't need `this`, prefer `static` interface methods (`invokestatic`) over defaults.
- [ ] A class-side override eliminates the default code path; useful in hot paths against `final` classes.
- [ ] `Interface.super.method()` compiles to `invokespecial` — the cheapest dispatch.
- [ ] Escape analysis can eliminate allocations inside defaults *if* the intermediates don't escape.
- [ ] Megamorphic interface call sites cost a few ns more than megamorphic virtual call sites — fix it with `sealed` + pattern matching or by hoisting dispatch out of the loop.
- [ ] Don't denormalise defaults for performance without a profile. The default/static/class-method difference is invisible in 99% of code.
- [ ] Document inline-killing patterns: large default bodies (>35 bytes), many implementations sharing a call site, defaults that allocate-and-escape.
- [ ] Verify with `-XX:+PrintInlining` and `-XX:+PrintEliminateAllocations` before claiming a hotspot is "the default's fault".

---

The general law: default-method cost is *the same as virtual-method cost*. If you're worried about your defaults, you're really worried about polymorphism. Optimize the call-site shape (monomorphic-ish, sealed if possible, hoisted out of inner loops), not the keyword you used to declare the method.
