# Static vs Dynamic Binding — Practice Tasks

Twelve exercises in distinguishing dispatch types and reasoning about behavior.

---

## Task 1 — Predict dispatch

```java
class A { int x = 1; void m() { System.out.println("A.m, x=" + x); } }
class B extends A { int x = 2; @Override void m() { System.out.println("B.m, x=" + x); } }

A a = new B();
System.out.println(a.x);    // ?
a.m();                       // ?
((B) a).m();                 // ?
B b = (B) a;
System.out.println(b.x);    // ?
```

Predict each. Run and verify.

---

## Task 2 — Static method "override"

```java
class P { static String f() { return "P"; } }
class C extends P { static String f() { return "C"; } }

P p = new C();
System.out.println(p.f());    // ?
System.out.println(C.f());     // ?
System.out.println(((P) new C()).f());    // ?
```

Predict. Why does each produce its result?

---

## Task 3 — Private method dispatch

```java
class Parent {
    private void compute() { System.out.println("Parent"); }
    public void run() { compute(); }
}
class Child extends Parent {
    private void compute() { System.out.println("Child"); }
}

new Child().run();    // ?
```

Predict. What's the rule about private methods and dispatch?

---

## Task 4 — Constructor dispatch

```java
class A {
    A() { print("A.ctor"); print(); }
    void print() { System.out.println("A.print"); }
}
class B extends A {
    String name = "B";
    @Override void print() { System.out.println("B.print, name=" + name); }
}

new B();
```

Predict the output. (Trick: A's ctor calls `print()` polymorphically; B.print runs but B.name isn't yet set.)

---

## Task 5 — `super` is static

```java
class A { void m() { System.out.println("A"); } }
class B extends A { @Override void m() { System.out.println("B"); super.m(); } }
class C extends B { @Override void m() { System.out.println("C"); super.m(); } }

new C().m();
```

Predict.

---

## Task 6 — `final` method optimization

Write `class Money { public final long cents() { return cents; } }`. Use `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` to verify the JIT inlines `cents()` calls.

---

## Task 7 — Megamorphic dispatch

Create an interface `Op` with `int apply(int a, int b)`. Implement 5 ways. Loop calling `apply` on a list with mixed types. Profile with `PrintInlining`. Observe "callee not inlineable, megamorphic."

---

## Task 8 — Sealed type dispatch

Define `sealed interface Shape permits Circle, Square, Triangle { double area(); }` with 3 record impls. Pattern-match in a switch. Compare with the megamorphic version from Task 7.

---

## Task 9 — Static binding via `final` class

Create `class Money { public Money plus(Money) { ... } }` (non-final). Then `final class Money2 { ... }`. Benchmark `plus` calls in a loop with JMH. Compare.

---

## Task 10 — Pattern matching vs polymorphism

Refactor:
```java
double area(Shape s) {
    if (s instanceof Circle c) return Math.PI * c.r() * c.r();
    if (s instanceof Square sq) return sq.s() * sq.s();
    return 0;
}
```

…to use polymorphism (`Shape.area()` abstract method). Then to pattern matching switch. Benchmark all three.

---

## Task 11 — `super.method` chain

```java
class A { void m() { System.out.print("A "); } }
class B extends A { @Override void m() { System.out.print("B "); super.m(); } }
class C extends B { @Override void m() { System.out.print("C "); super.m(); } }
class D extends C { @Override void m() { System.out.print("D "); super.m(); } }

new D().m();
```

Predict.

---

## Task 12 — `MethodHandle` direct vs reflection

Compare:
- `Method.invoke(...)` (reflection)
- `MethodHandle.invokeExact(...)` (typed handle)
- Direct method call

Benchmark with JMH for the same operation. Compare timing.

---

## Validation

| Task | How |
|------|-----|
| 1 | a.x=1 (field static), a.m()="B.m, x=2" (method dynamic; B.x), b.x=2 |
| 2 | "P", "C", "P" — static dispatch via declared type |
| 3 | "Parent" — Parent.run sees Parent.compute (private) |
| 4 | "A.ctor", "B.print, name=null" — overridable from ctor |
| 5 | C, B, A — super chains up |
| 6 | PrintInlining shows `inline (hot)` on cents() |
| 7 | PrintInlining shows "callee not inlineable, megamorphic" |
| 8 | Pattern match dispatch is faster (or comparable) and more readable |
| 9 | Final class likely faster (or no difference if JIT devirtualizes anyway) |
| 10 | Polymorphism wins on small monomorphic; pattern match wins on closed sets; instanceof chain is slowest |
| 11 | "D C B A " — chain runs top-down via super calls |
| 12 | Direct < MethodHandle < Reflection (orders of magnitude) |

---

**Memorize this**: dispatch is the language's mechanism for choosing which code runs. Static binding is fast, predictable, but rigid. Dynamic binding enables polymorphism. JIT collapses well-warmed dynamic dispatch to direct calls. Pattern matching is the modern alternative for closed hierarchies.
