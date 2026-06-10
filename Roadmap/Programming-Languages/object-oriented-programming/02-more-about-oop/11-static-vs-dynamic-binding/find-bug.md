# Static vs Dynamic Binding — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of a binding misunderstanding.

---

## Bug 1 — Field "override"

```java
class Animal { int legs = 4; }
class Spider extends Animal { int legs = 8; }

Animal a = new Spider();
System.out.println(a.legs);    // 4 — surprised?
```

**Why?** Fields are statically bound. The declared type wins.

**Fix:** use a method:
```java
class Animal { int legs() { return 4; } }
class Spider extends Animal { @Override int legs() { return 8; } }
```

---

## Bug 2 — Static method "override"

```java
class P { static String f() { return "P"; } }
class C extends P { static String f() { return "C"; } }

P p = new C();
System.out.println(p.f());    // "P", not "C"
```

**Why?** Static methods are statically bound. Hidden, not overridden.

**Fix:** use instance methods if polymorphism is needed.

---

## Bug 3 — Constructor calling override

```java
class Parent {
    Parent() { initialize(); }
    void initialize() { /* default */ }
}
class Child extends Parent {
    private final String key = "default";
    @Override void initialize() {
        System.out.println("key=" + key);   // null!
    }
}

new Child();
```

**Why?** When `Parent.<init>` runs, `Child.key` hasn't been assigned. Polymorphism dispatches to `Child.initialize`, which sees `key = null`.

**Fix:** never call overridable methods from constructors. Use a factory or two-phase init.

---

## Bug 4 — `super.m()` and overrides

```java
class A { void m() { System.out.println("A"); } }
class B extends A { @Override void m() { System.out.println("B"); super.m(); } }
class C extends B { @Override void m() { System.out.println("C"); super.m(); } }

C c = new C();
c.m();
```

Output:
```
C
B
A
```

This is correct. The bug is when developers expect `super.m()` to skip a level — it doesn't:

```java
class C extends B {
    @Override void m() {
        super.m();   // calls B.m, not A.m
    }
}
```

**Fix:** to skip B and call A directly, you can't. Each level's `super.m()` is the immediate parent only. Refactor if you need different behavior.

---

## Bug 5 — Private dispatch confusion

```java
class Parent {
    private void compute() { /* parent impl */ }
    public void run() { compute(); }
}
class Child extends Parent {
    private void compute() { /* child impl */ }
}

new Child().run();    // calls Parent.compute, not Child.compute
```

**Why?** Private methods aren't visible to subclasses. Parent.run sees Parent.compute (the private one). Child has its own (unrelated) compute.

**Fix:** if you want polymorphic dispatch, make `compute` `protected` or `public`.

---

## Bug 6 — Casting changes dispatch?

```java
Animal a = new Dog();
((Object) a).toString();    // calls Dog.toString (if overridden)
```

**Why?** No bug here — `toString` is dynamic. The cast doesn't affect runtime dispatch. Common confusion: casting affects compile-time *static* method dispatch but not dynamic dispatch.

**Fix (when bug applies):**
```java
((Animal) a).speak();    // dynamic — still calls Dog.speak
A.staticMethod();         // doesn't cast — static call
```

---

## Bug 7 — `instanceof` then static dispatch

```java
if (s instanceof Circle) {
    Circle c = (Circle) s;
    c.area();   // static dispatch on Circle (compile time)
} else {
    s.area();   // dynamic dispatch via Shape
}
```

The branch is unnecessary if `area()` is virtual. The compiler resolves to `Shape.area()` in both branches; runtime dispatches to the actual implementation.

**Fix:** just call `s.area()` directly.

---

## Bug 8 — Overload pretending to be override

```java
class Parent { void process(Object o) { System.out.println("Parent"); } }
class Child extends Parent {
    void process(String s) { System.out.println("Child"); }   // overload!
}

Parent p = new Child();
p.process("hi");    // "Parent"
```

**Why?** Overload resolution is at compile time on the declared type's overloads. `Parent.process(Object)` is selected. Runtime dispatch goes via that signature.

**Fix:** make it a true override:
```java
@Override void process(Object o) { ... }
```

---

## Bug 9 — Final class subclass attempt

```java
public final class String { ... }
class MyString extends String { ... }    // ERROR
```

**Why?** Final classes can't be extended. The compiler enforces.

**Fix:** use composition or another approach.

---

## Bug 10 — Static field shadowing

```java
class A { static int x = 1; }
class B extends A { static int x = 2; }

System.out.println(A.x);    // 1
System.out.println(B.x);    // 2
```

No bug; just be aware that static fields are per-class. `B.x` and `A.x` are different fields.

The bug is when developers expect `B.x` to override `A.x`. They don't.

---

## Bug 11 — `invokespecial` for super in chain

```java
class A { void m() { System.out.println("A"); } }
class B extends A { @Override void m() { System.out.println("B"); } }
class C extends B {
    void doIt() {
        super.m();    // B.m via invokespecial
    }
}

new C().doIt();    // "B"
```

The bug is when developers expect `super.m()` to be polymorphic (call the most-derived `m`). It's not.

**Fix:** if you want polymorphic dispatch, call `this.m()` or just `m()`. `super.m()` is always direct to the immediate parent.

---

## Bug 12 — Generic method overriding confusion

```java
class Box<T> { void put(T x) { } }
class StringBox extends Box<String> {
    @Override void put(String x) { }
}

Box<String> box = new StringBox();
box.put("hi");    // dispatches via bridge to StringBox.put(String)
```

The bug isn't here, but: developers sometimes expect to call `box.put(Object)` and have it dispatch differently. The compile-time signature is `Box<String>.put(String)`, which the JVM bridges to `put(String)` on StringBox.

**Fix:** none needed if you understand. But beware of bridge method calls in profiling.

---

## Pattern recap

| Bug | Family                          | Cure                                |
|-----|---------------------------------|-------------------------------------|
| 1   | Field "override"                 | Use methods                         |
| 2   | Static "override"                | Use instance methods                |
| 3   | Overridable from ctor             | Static factory                      |
| 4   | `super` not polymorphic           | Aware of direct dispatch            |
| 5   | Private "override"               | Use protected/public                |
| 6   | Cast affects dispatch             | Casts don't change dynamic dispatch |
| 7   | Unneeded `instanceof` branch     | Trust virtual dispatch              |
| 8   | Overload vs override              | `@Override` annotation              |
| 9   | Subclass final class              | Compose                             |
| 10  | Static fields shadowing           | Aware they're separate              |
| 11  | `super` in chain                  | Direct, not polymorphic             |
| 12  | Generic dispatch                  | Bridge methods preserve dispatch     |

---

**Memorize the shapes**: most binding bugs are about confusing static and dynamic. Fields are static. Static methods are static. Private methods are static. `super.m()` is static (direct to parent). Use methods for polymorphism, fields for state, `@Override` for safety.
