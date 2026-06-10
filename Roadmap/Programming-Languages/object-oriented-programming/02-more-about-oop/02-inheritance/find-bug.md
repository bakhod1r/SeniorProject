# Inheritance — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong in a way that's specifically about inheritance.

---

## Bug 1 — Subclass constructor doesn't compile

```java
class Vehicle {
    Vehicle(int wheels) { /* ... */ }
}
class Car extends Vehicle {
    Car() { /* ... */ }    // ERROR: implicit super() not found
}
```

**Why?** `Vehicle` has only a constructor that takes an `int`. The compiler tries to insert `super()` but no no-arg constructor exists.

**Fix:** call `super(4)` explicitly:

```java
Car() { super(4); }
```

---

## Bug 2 — Override doesn't override

```java
class Animal {
    void speak() { System.out.println("..."); }
}
class Dog extends Animal {
    void Speak() { System.out.println("Woof"); }   // capital S!
}

Animal a = new Dog();
a.speak();    // prints "..."
```

**Why?** `Speak` (uppercase) is a different method — not an override. Calling `a.speak()` finds the parent's `speak`.

**Fix:** add `@Override` annotation to catch this at compile time:

```java
@Override void speak() { System.out.println("Woof"); }
```

---

## Bug 3 — Constructor calls overridable method

```java
class Reader {
    Reader() { initialize(); }
    protected void initialize() { /* base */ }
}
class CSVReader extends Reader {
    private final String separator = ",";
    @Override protected void initialize() {
        System.out.println("sep=" + separator);
    }
}

new CSVReader();   // prints "sep=null"
```

**Why?** `Reader.<init>` runs first and dispatches `initialize()` to the override. But `CSVReader.separator` hasn't been initialized yet (field inits run after `super()` returns).

**Fix:** never call overridable methods from constructors. Use a factory or a separate `start()` method.

---

## Bug 4 — Static method "override"

```java
class A {
    static String desc() { return "A"; }
}
class B extends A {
    static String desc() { return "B"; }   // hides, not overrides
}

A a = new B();
System.out.println(a.desc());   // prints "A"
```

**Why?** Static methods are not polymorphic. Dispatch is based on declared type, not runtime type.

**Fix:** don't declare same-named static methods if you want polymorphism. Use instance methods. Or call `B.desc()` directly to avoid confusion.

---

## Bug 5 — Field hiding instead of override

```java
class Animal {
    int legs = 4;
}
class Spider extends Animal {
    int legs = 8;
}

Animal a = new Spider();
System.out.println(a.legs);   // 4
```

**Why?** Fields are accessed via static type. `a` is declared `Animal`, so `a.legs` finds `Animal.legs`.

**Fix:** use a method:

```java
class Animal {
    int legs() { return 4; }
}
class Spider extends Animal {
    @Override int legs() { return 8; }
}
```

---

## Bug 6 — Stack extends ArrayList

```java
class Stack<E> extends ArrayList<E> {
    public void push(E e) { add(e); }
    public E pop() { return remove(size() - 1); }
}

Stack<Integer> s = new Stack<>();
s.push(1);
s.push(2);
s.add(0, 99);   // !! breaks stack invariants
```

**Why?** `extends ArrayList` exposes every `ArrayList` method. Users can corrupt stack discipline.

**Fix:** compose, don't inherit:

```java
class Stack<E> {
    private final ArrayList<E> data = new ArrayList<>();
    public void push(E e) { data.add(e); }
    public E pop() { return data.remove(data.size() - 1); }
}
```

---

## Bug 7 — Square extends Rectangle

```java
class Rectangle {
    int width, height;
    public void setWidth(int w) { width = w; }
    public void setHeight(int h) { height = h; }
    public int area() { return width * height; }
}
class Square extends Rectangle {
    @Override public void setWidth(int w) { width = w; height = w; }
    @Override public void setHeight(int h) { width = h; height = h; }
}

Rectangle r = new Square();
r.setWidth(5);
r.setHeight(10);
System.out.println(r.area());   // 100, not 50 — surprise!
```

**Why?** `Square` violates LSP. Code that works with `Rectangle`'s independent-axes contract breaks.

**Fix:** don't make `Square` extend `Rectangle`. They're different shapes. Make both implement a common `Shape` interface.

---

## Bug 8 — Resource leak in subclass

```java
class A {
    A() throws IOException {
        // opens file
    }
}
class B extends A {
    final OutputStream out;
    B() throws IOException {
        super();
        out = new FileOutputStream("/tmp/x");
        validate();
    }
    void validate() { if (broken()) throw new IllegalStateException(); }
}
```

**Why?** If `validate()` throws, `out` is open but `B` is never returned. `out` is leaked. Worse, `super()` may have opened a file that's also leaked.

**Fix:** use a static factory + try/catch, or ensure validation happens before opening any resource.

---

## Bug 9 — Sealed exhaustiveness silently bypassed

```java
sealed interface Shape permits Circle, Square { }
record Circle(double r) implements Shape { }
record Square(double s) implements Shape { }

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.s() * sq.s();
        default -> 0.0;          // !! defeats exhaustiveness
    };
}
```

**Why?** Adding a `default` clause makes the switch always exhaustive, even if you add a new permitted subclass. Compiler will not warn you about new shapes.

**Fix:** remove the `default`. Let the compiler enforce that every shape is handled. If you genuinely want a fallback, use `case Shape s -> 0.0` (still pinpoints the new case as a warning in some compilers).

---

## Bug 10 — Diamond default conflict ignored

```java
interface X { default void m() { System.out.println("X"); } }
interface Y { default void m() { System.out.println("Y"); } }

class Z implements X, Y { }      // ERROR: "class Z inherits unrelated defaults for m()"
```

**Why?** Two unrelated interfaces provide conflicting defaults. Java forces explicit resolution.

**Fix:** override `m()` in `Z` and pick one (or both):

```java
class Z implements X, Y {
    @Override public void m() {
        X.super.m();
        Y.super.m();
    }
}
```

---

## Bug 11 — Equals symmetry broken

```java
class Point {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point p)) return false;
        return p.x == x && p.y == y;
    }
}
class CPoint extends Point {
    String color;
    CPoint(int x, int y, String c) { super(x, y); this.color = c; }
    @Override public boolean equals(Object o) {
        if (!(o instanceof CPoint c)) return false;
        return super.equals(o) && c.color.equals(color);
    }
}

Point p = new Point(1, 1);
CPoint c = new CPoint(1, 1, "red");
System.out.println(p.equals(c));   // true
System.out.println(c.equals(p));   // false — symmetry broken!
```

**Why?** `Point.equals` accepts any `Point` (including `CPoint`). `CPoint.equals` requires a `CPoint`. Asymmetric.

**Fix:** Effective Java Item 10. Either use `getClass()` instead of `instanceof` (breaks LSP), or favor composition (give Point a `color` via composition, not inheritance).

---

## Bug 12 — `instanceof` chain that misses subtypes

```java
String describe(Animal a) {
    if (a instanceof Dog) return "dog";
    if (a instanceof Cat) return "cat";
    return "unknown";
}
```

**Why?** When new `Animal` subclasses are added (e.g. `Hamster`), this method silently returns "unknown" without warning. There's no compile-time enforcement.

**Fix:** make `Animal` sealed and use pattern-matching switch:

```java
sealed interface Animal permits Dog, Cat, Hamster { }

String describe(Animal a) {
    return switch (a) {
        case Dog d -> "dog";
        case Cat c -> "cat";
        case Hamster h -> "hamster";
    };   // exhaustive — compile error if Animal gains a new permitted subtype
}
```

---

## Pattern recap

| Bug | Family                          | Cure                                         |
|-----|---------------------------------|----------------------------------------------|
| 1   | Missing super() ctor             | Explicit super(args)                          |
| 2   | Typo in override name           | `@Override` annotation                       |
| 3   | Override called from ctor       | No virtual calls in ctor                     |
| 4   | Static "override"               | Static methods aren't polymorphic            |
| 5   | Field hiding                    | Use methods                                  |
| 6   | Inheritance leaks parent API    | Compose                                      |
| 7   | LSP violation                   | Different abstractions                       |
| 8   | Resource leak in subclass ctor  | Static factory + try/catch                   |
| 9   | `default` defeats exhaustiveness| Remove default                               |
| 10  | Default-method diamond          | Explicit override + super calls              |
| 11  | Equals & inheritance            | Composition or final + LSP awareness         |
| 12  | Open instanceof chain           | Sealed + pattern matching                    |

---

**Memorize the shapes**: most inheritance bugs are LSP violations, dispatch confusion (static vs dynamic), or constructor-time visibility traps. Use `@Override`, sealed types, and composition by default.
