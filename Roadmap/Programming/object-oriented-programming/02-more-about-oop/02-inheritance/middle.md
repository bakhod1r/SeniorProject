# Inheritance — Middle

> **What?** The rules: how the compiler resolves member access, what overriding/hiding/shadowing actually mean, the Liskov Substitution Principle, why Java forbids multiple class inheritance, and how `protected`, `final`, and `abstract` shape what subclasses can do.
> **How?** By understanding the contract a parent makes with its subclasses, and the cost when subclasses violate it.

---

## 1. Overriding vs hiding vs shadowing

| Mechanism   | Applies to        | Dispatch     |
|-------------|-------------------|--------------|
| Overriding  | Instance methods  | **Dynamic** (runtime type) |
| Hiding      | Static methods    | **Static** (declared type) |
| Hiding      | Fields (any kind) | **Static** (declared type) |
| Shadowing   | Local variables, params (vs outer scope) | Lexical |

```java
class A {
    int x = 1;
    static String s = "A.s";
    static String desc() { return "A"; }
    String name() { return "A"; }
}
class B extends A {
    int x = 2;                    // hides A.x
    static String s = "B.s";      // hides A.s
    static String desc() { return "B"; }   // hides A.desc()
    @Override String name() { return "B"; } // OVERRIDES
}

A ab = new B();
System.out.println(ab.x);     // 1  — fields are static dispatch
System.out.println(ab.s);     // A.s — same
System.out.println(ab.desc()); // A — static methods are static dispatch
System.out.println(ab.name()); // B — instance methods are dynamic dispatch
```

> Only **instance methods** participate in polymorphism. Fields and static methods are always resolved at the declared type.

---

## 2. The override contract

A subclass method overrides the parent's method only when **all** of these hold:

1. Same name.
2. Same parameter types (after erasure for generics).
3. Return type is the **same or covariant** (a subtype of the parent's return type).
4. Throws clause is **narrower or equal** (no new checked exceptions).
5. Access modifier is **not weaker** (public stays public; can widen but not narrow).

If any rule is broken, you've created an overload, a compile error, or a hiding (for static methods).

```java
class A {
    Number compute(int n) throws IOException { return n; }
}
class B extends A {
    @Override
    Integer compute(int n) { return n * 2; }    // covariant return, narrower throws — OK
}
```

```java
class A { void m() throws IOException { } }
class B extends A {
    @Override
    void m() throws Exception { }    // ERROR: throws is wider
}
```

---

## 3. Liskov Substitution Principle (LSP)

> If `S` is a subtype of `T`, then objects of type `T` may be replaced with objects of type `S` without altering the correctness of the program.

In practice, an override must:

- **Pre-conditions:** not require *more* than the parent.
- **Post-conditions:** guarantee at least as much as the parent.
- **Invariants:** preserve everything the parent guarantees.
- **History:** preserve the parent's notion of object state evolution.

Classic violation: `Square extends Rectangle`. Setting `Square.width = 5` "should" also set height to 5, but `Rectangle`'s contract is `width` and `height` are independent. Code written against `Rectangle` will silently break when given a `Square`.

LSP is *the* reason inheritance is dangerous when overused. Whatever you publish in the parent's contract must hold in every subclass.

---

## 4. Access modifiers across inheritance

| Modifier        | Same class | Same package | Subclass | World |
|-----------------|-----------|--------------|----------|-------|
| `public`        | Y         | Y            | Y        | Y     |
| `protected`     | Y         | Y            | Y        | N     |
| (default)       | Y         | Y            | N        | N     |
| `private`       | Y         | N            | N        | N     |

`protected` is special: it lets subclasses (in any package) access the member, plus everyone in the same package. Use sparingly — every `protected` member is part of your public-to-subclasses contract.

---

## 5. Constructors and inheritance: detailed rules

- A subclass constructor's first statement is `super(...)` or `this(...)`. If neither, the compiler inserts `super()`.
- The parent's no-arg constructor must exist (or be accessible) for the implicit `super()` to compile.
- A subclass cannot reduce visibility of an inherited constructor — it isn't inherited at all; you write a new one.
- A subclass constructor can throw fewer or narrower exceptions than `super(...)` declares; widening would force callers to catch exceptions the subclass might not throw.

The classic chain pattern:

```java
class Vehicle {
    protected final int wheels;
    Vehicle(int wheels) { this.wheels = wheels; }
}
class Car extends Vehicle {
    Car() { super(4); }
}
class Motorbike extends Vehicle {
    Motorbike() { super(2); }
}
```

---

## 6. The fragile base class problem

A change in the parent that "should be safe" can break subclasses subtly.

**Example.** Parent class:

```java
class Counter {
    private int count;
    public void inc() { count++; }
    public void incBy(int n) {
        for (int i = 0; i < n; i++) inc();
    }
    public int get() { return count; }
}
```

Subclass:

```java
class LoggingCounter extends Counter {
    @Override public void inc() {
        super.inc();
        System.out.println("incremented");
    }
}
```

Now consider what `new LoggingCounter().incBy(3)` does. `incBy` calls `inc()` 3 times, each call dispatches to the override, prints. Fine.

If the parent author later "optimizes" `incBy` to set count directly without calling `inc()`, the subclass's logging stops working without warning. The contract that `incBy` calls `inc()` was never explicit — it was an *implementation detail* that the subclass relied on.

**Rule:** if your class is meant to be subclassed, document which methods call which (the *self-use* contract). If not, mark the class `final`.

---

## 7. Abstract classes

A class declared `abstract` cannot be instantiated. It may declare `abstract` methods (no body) that subclasses must implement.

```java
abstract class Shape {
    abstract double area();
    public String describe() { return "area = " + area(); }
}

class Circle extends Shape {
    private final double r;
    Circle(double r) { this.r = r; }
    @Override double area() { return Math.PI * r * r; }
}
```

Use `abstract` when you have:
- Common state or behavior to share among subclasses
- A method that *must* be implemented by subclasses but you can't write a sensible default

If you don't need shared state, prefer an interface with default methods (Java 8+).

---

## 8. Sealed classes (Java 17+)

A sealed class restricts which classes can extend it:

```java
public sealed class Shape permits Circle, Rectangle, Triangle { }

public final class Circle extends Shape { }
public final class Rectangle extends Shape { }
public non-sealed class Triangle extends Shape { }
```

Subclasses must be one of:
- `final` — no further extension
- `sealed` — itself permits-restricted
- `non-sealed` — extension reopened

Used with pattern-matching `switch`, sealed types let the compiler verify exhaustiveness:

```java
String describe(Shape s) {
    return switch (s) {
        case Circle c -> "round";
        case Rectangle r -> "square-ish";
        case Triangle t -> "pointy";
    };   // compiler knows these are the only cases
}
```

This combines the type-safety of `enum` with the data-richness of regular classes.

---

## 9. The diamond problem and why Java avoids it

If `B` and `C` both extend `A`, and `D` extends both `B` and `C` (in a hypothetical multi-inheritance Java), and `B` and `C` both override `A.m()`, then `D.m()` is ambiguous.

C++ has this problem and resolves it via virtual inheritance. Java sidesteps it by allowing only single class inheritance. For *interfaces*, Java permits multiple inheritance because, originally, interfaces couldn't have implementations.

After Java 8 added default methods, the diamond returned. Java handles it explicitly: if two implemented interfaces provide conflicting defaults, the implementing class must override:

```java
interface X { default String m() { return "X"; } }
interface Y { default String m() { return "Y"; } }
class Z implements X, Y {
    @Override
    public String m() {
        return X.super.m();   // pick which one to call, or write your own
    }
}
```

---

## 10. `instanceof` and pattern matching

Pre-Java 16:
```java
if (animal instanceof Dog) {
    Dog d = (Dog) animal;
    d.bark();
}
```

Java 16+:
```java
if (animal instanceof Dog d) {
    d.bark();          // d is in scope and bound
}
```

Java 21+ pattern matching for `switch`:
```java
String describe(Animal a) {
    return switch (a) {
        case Dog d when d.weight > 30 -> "big dog";
        case Dog d -> "dog";
        case Cat c -> "cat";
        case null -> "nothing";
        default -> "unknown";
    };
}
```

Use these features to replace fragile `instanceof` chains. Combined with sealed types, they make hierarchy-driven dispatch as type-safe as algebraic data types in ML.

---

## 11. Inheritance and visibility surprises

```java
package alpha;
public class Base {
    protected void m() { }
}

package beta;
import alpha.Base;
public class Derived extends Base {
    public void test(Base b) {
        b.m();    // ERROR — protected access only via 'this'-typed reference in subclass
    }
    public void test2(Derived d) {
        d.m();    // OK
    }
}
```

`protected` does not mean "all subclasses can call this on any instance" — it means "this subclass and its subclasses can call this on instances of *this subclass or below* (or in the same package)." Subtle and famously confusing.

---

## 12. Method resolution order

For `obj.m()` where `obj`'s static type is `T`:

1. Compiler resolves the method *signature* based on `T`'s class and its inherited methods. This is **overload resolution**.
2. JVM looks up the actual method to call based on the runtime class of `obj`. This is **dynamic dispatch**.

For a chain `Object → A → B → C` where `B` and `C` both override `m()`:
- `((A) c).m()` resolves to `A.m()` at compile time, then dispatches to `C.m()` at runtime.

This is why method *signature* differences (parameter types) matter at compile time, while *implementation* differences matter at runtime.

---

## 13. `super.method()` from a subclass

Calling `super.m()` always invokes the *direct parent's* implementation, not "the deepest parent that declares m()." If `super.m()` itself uses dynamic dispatch internally (calls `this.m()`), it goes back to your override.

```java
class A { void m() { } }
class B extends A { @Override void m() { System.out.println("B"); } }
class C extends B { @Override void m() {
    super.m();           // calls B.m(), prints "B"
    System.out.println("C");
}}

new C().m();   // B then C
```

---

## 14. Don't subclass third-party classes lightly

Whenever you `extend` a class you didn't write, you depend on its *implementation* (not just its API). The library author may change behavior in a minor release and silently break your code. Best practices:

- Compose, don't inherit, when wrapping a library type.
- If you must subclass, document which behaviors you rely on.
- Use unit tests that exercise both your subclass and the parent's contract.

---

## 15. What's next

| Topic                                | File              |
|--------------------------------------|-------------------|
| Vtables, invokevirtual, JIT inlining | `senior.md`        |
| Bytecode of `extends`                | `professional.md`  |
| JLS rules on subtyping               | `specification.md` |
| Common inheritance bugs              | `find-bug.md`      |

---

**Memorize this**: Inheritance is a contract. The parent promises invariants; the subclass must keep them (LSP). Methods override; fields and static methods hide. `protected` is a contract with all subclasses, not a relaxation of `private`. Sealed types make the hierarchy *closed*, allowing exhaustive pattern matching.
