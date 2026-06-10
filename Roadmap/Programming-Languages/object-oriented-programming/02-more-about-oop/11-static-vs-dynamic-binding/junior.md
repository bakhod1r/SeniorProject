# Static vs Dynamic Binding — Junior

> **What?** *Binding* is the process of associating a method call (or field access) with the actual code that runs. Java has two flavors: **static binding** is decided at *compile time* based on the declared type. **Dynamic binding** is decided at *runtime* based on the object's actual class.
> **How?** Most instance methods use dynamic binding (also called late binding or virtual dispatch). Fields, static methods, private methods, final methods, and constructors use static binding (also called early binding).

---

## 1. The two-line summary

```java
class Animal { void speak() { System.out.println("..."); } }
class Dog extends Animal { @Override void speak() { System.out.println("woof"); } }

Animal a = new Dog();
a.speak();                  // "woof" — dynamic binding (runtime)

class A { static String name = "A"; }
class B extends A { static String name = "B"; }

A x = new B();
System.out.println(x.name); // "A" — static binding (compile time)
```

The first call dispatches based on the *actual class* of `a`. The second access uses the *declared type* of `x`.

---

## 2. What gets static binding?

| Member type            | Binding |
|------------------------|---------|
| Static method          | Static  |
| Static field           | Static  |
| Instance field         | Static  |
| Private method         | Static  |
| Final method           | Static (effectively) |
| Constructor            | Static  |
| `super.method()`       | Static  |

Anything that doesn't participate in polymorphism is statically bound.

---

## 3. What gets dynamic binding?

| Member type           | Binding |
|-----------------------|---------|
| Instance method (non-final, non-private) | Dynamic |
| Interface method      | Dynamic |
| Default method        | Dynamic |
| Abstract method (when called on a concrete instance) | Dynamic |

Polymorphic calls — overridable methods — use dynamic binding.

---

## 4. Why the distinction matters

**Static binding** is fast and predictable: the compiler knows exactly which method runs.

**Dynamic binding** enables polymorphism: the same call expression can invoke different code based on the runtime type. This is the heart of OOP.

```java
List<Animal> zoo = List.of(new Dog(), new Cat(), new Bird());
for (Animal a : zoo) a.speak();    // each animal speaks differently
```

Without dynamic binding, you'd need a switch on type — losing the abstraction.

---

## 5. Field access — always static

```java
class A { int x = 1; }
class B extends A { int x = 2; }

A a = new B();
System.out.println(a.x);    // 1 — declared type wins
System.out.println(((B) a).x);  // 2 — cast to B
```

Fields are *not* polymorphic. The declared type determines which field is accessed. This is why we use methods (getters) instead of fields when polymorphism matters.

---

## 6. Static methods — always static

```java
class A { static String name() { return "A"; } }
class B extends A { static String name() { return "B"; } }

A a = new B();
System.out.println(a.name());    // "A" — bound at compile time via declared type
System.out.println(B.name());     // "B"
```

Static methods aren't dispatched polymorphically. They look like methods but behave like fields with respect to binding.

(Some IDEs warn about calling static methods via instance references — for clarity, always use `ClassName.staticMethod()`.)

---

## 7. Private methods — always static

```java
class A {
    private void compute() { System.out.println("A"); }
    public void run() { compute(); }
}
class B extends A {
    private void compute() { System.out.println("B"); }   // separate method, not override
}

new B().run();    // "A" — A.run sees A.compute (private)
```

Private methods are invisible to subclasses, so they can't be overridden. Calls to private methods are statically bound (using `invokespecial` in bytecode).

---

## 8. Final methods — effectively static binding

```java
class A { public final void m() { ... } }
```

`final` forbids overriding. The JIT can devirtualize calls to `final` methods, making dispatch effectively direct.

---

## 9. Constructors — always static

Constructors aren't inherited and aren't overridden. `new B()` always calls `B`'s constructor. The JVM uses `invokespecial` for constructor invocation — direct dispatch.

---

## 10. `super.method()` — static binding

Calling `super.m()` invokes the immediate parent's `m`, regardless of any further overrides:

```java
class A { void m() { System.out.println("A"); } }
class B extends A { @Override void m() { System.out.println("B"); super.m(); } }
class C extends B { @Override void m() { System.out.println("C"); super.m(); } }

new C().m();
// C
// B
// A
```

`super.m()` always means "the version in my immediate parent." This is `invokespecial` — a direct call, no vtable lookup.

---

## 11. Common newcomer mistakes

**Mistake 1: thinking field access is polymorphic**

```java
class Animal { int legs = 4; }
class Spider extends Animal { int legs = 8; }

Animal a = new Spider();
System.out.println(a.legs);   // 4 — surprised?
```

Use a method:
```java
class Animal { int legs() { return 4; } }
class Spider extends Animal { @Override int legs() { return 8; } }

Animal a = new Spider();
System.out.println(a.legs());   // 8 — dynamic binding
```

**Mistake 2: thinking static methods override**

```java
class Parent { static String f() { return "P"; } }
class Child extends Parent { static String f() { return "C"; } }

Parent p = new Child();
System.out.println(p.f());    // "P" — static dispatch via declared type
```

To get polymorphism, use instance methods.

**Mistake 3: relying on `private` for "polymorphic" behavior**

```java
class Parent {
    private void compute() { ... }
    public void run() { compute(); }
}
class Child extends Parent {
    private void compute() { ... }   // doesn't override; Parent.run won't see it
}
```

Make `compute` `protected` or `public` to enable overriding.

---

## 12. Quick reference

| Element                      | Binding | Mechanism            |
|------------------------------|---------|----------------------|
| Instance method (overridable)| Dynamic | `invokevirtual`/`invokeinterface` (vtable/itable) |
| Final/private method         | Static  | `invokespecial` or direct |
| Static method                | Static  | `invokestatic`       |
| Constructor                  | Static  | `invokespecial`      |
| `super.method()`             | Static  | `invokespecial`      |
| Instance field               | Static  | `getfield`           |
| Static field                 | Static  | `getstatic`          |

---

## 13. What's next

| Question                           | File              |
|------------------------------------|-------------------|
| Vtables, inline caches, JIT         | `senior.md`        |
| Bytecode of dispatch                | `professional.md`  |
| JLS rules                           | `specification.md` |
| Common dispatch bugs                | `find-bug.md`      |

---

**Memorize this**: instance methods use dynamic binding (polymorphic). Fields, static methods, private methods, final methods, constructors, and `super.m()` use static binding. Use methods, not fields, when polymorphism matters. Use `@Override` to catch dispatch surprises.
