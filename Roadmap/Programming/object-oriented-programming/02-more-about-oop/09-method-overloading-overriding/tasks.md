# Method Overloading / Overriding — Practice Tasks

Twelve exercises in distinguishing the two mechanisms and reasoning about resolution.

---

## Task 1 — Predict resolution

Given:
```java
class A {
    void m(Object o) { System.out.println("Object"); }
    void m(String s) { System.out.println("String"); }
}

A a = new A();
String s = "hi";
Object o = s;

a.m(s);   // ?
a.m(o);   // ?
a.m((Object) s);   // ?
```

Predict each. Then run.

---

## Task 2 — Override correctly

```java
class Animal {
    public Number compute() throws IOException { return 0; }
}

class Dog extends Animal {
    // Add a covariant override that returns Integer and throws no checked exceptions
}
```

Use `@Override`. Verify with `javap -v` that a bridge method was generated.

---

## Task 3 — Detect missing override

```java
class Parent {
    void process(Object o) { }
}
class Child extends Parent {
    void process(String s) { }   // intended as override?
}
```

Add `@Override` to `Child.process`. What does the compiler say? Refactor to make it a true override.

---

## Task 4 — Static method "override"

```java
class Parent { static String name() { return "Parent"; } }
class Child extends Parent { static String name() { return "Child"; } }

Parent p = new Child();
p.name();   // ?
```

Predict. Why does it say "Parent"? What's the rule?

---

## Task 5 — Overload with autoboxing

```java
void m(int x)     { System.out.println("int"); }
void m(Integer x) { System.out.println("Integer"); }
void m(long x)    { System.out.println("long"); }

m(5);     // ?
m(Integer.valueOf(5));   // ?
m(5L);    // ?
m(null);  // ?
```

Predict each. Run.

---

## Task 6 — Final method override attempt

```java
class Base { public final void compute() { } }
class Derived extends Base {
    @Override public void compute() { }   // ?
}
```

Compile. What's the error? Why?

---

## Task 7 — Bridge method observation

Given:
```java
class Box<T> { void put(T x) { } }
class IntBox extends Box<Integer> {
    @Override void put(Integer x) { }
}
```

Compile and run `javap -p -v IntBox.class`. Find the bridge method. What's its signature?

---

## Task 8 — Diamond default conflict

```java
interface X { default String name() { return "X"; } }
interface Y { default String name() { return "Y"; } }
class Z implements X, Y { }
```

What's the compile error? Add code to disambiguate — return both names.

---

## Task 9 — Overloading with generics erasure

```java
class C {
    void m(List<String> l) { }
    void m(List<Integer> l) { }   // ?
}
```

Compile. What's the error? Why? How would you handle this if you really need to differentiate?

---

## Task 10 — Megamorphic dispatch

Create an interface `Op` with method `int apply(int a, int b)`. Implement it 5 ways: PLUS, MINUS, TIMES, DIVIDE, MOD. Loop through a `List<Op>` calling `apply` on each. Profile with `-XX:+PrintInlining`. Observe whether dispatch is monomorphic, bimorphic, or megamorphic.

---

## Task 11 — Pattern matching to replace dispatch

Convert:
```java
double area(Shape s) {
    if (s instanceof Circle) return Math.PI * ((Circle) s).r() * ((Circle) s).r();
    if (s instanceof Square) return ((Square) s).s() * ((Square) s).s();
    return 0;
}
```

…to use sealed types + pattern matching switch. What does this gain over polymorphic dispatch via `Shape.area()`?

---

## Task 12 — Overload that breaks LSP

Design two methods on a `Shape` class:
```java
class Shape {
    void resize(int factor) { ... }
}
class Circle extends Shape {
    void resize(double factor) { ... }   // intended as override?
}
```

Why doesn't this override? Demonstrate that calling `resize(2)` on a `Circle` reference dispatches differently than on a `Shape` reference.

---

## Validation

| Task | How |
|------|-----|
| 1 | "String", "Object", "Object" — explain why |
| 2 | Compiler accepts; bridge method `Number compute()` exists in Dog |
| 3 | `@Override` on `process(String)` produces error; rename to `process(Object)` to override correctly |
| 4 | Output is "Parent" — static dispatch via declared type |
| 5 | "int", "Integer", "long", "Integer" — explain phases |
| 6 | Compile error: "compute() is final in Base" |
| 7 | `javap` shows synthetic `void put(Object)` bridge |
| 8 | Compile error: "Z inherits unrelated defaults"; override returns "X / Y" |
| 9 | Compile error: same erasure; differentiate via wrapping or different method names |
| 10 | Loop is megamorphic; PrintInlining shows "callee not inlineable" |
| 11 | Pattern matching is exhaustive; adding a new shape errors at compile time |
| 12 | `circle.resize(2)` calls Circle.resize(double); `((Shape)circle).resize(2)` calls Shape.resize(int) |

---

**Memorize this**: overloading is compile-time, based on parameter types. Overriding is runtime, based on receiver class. `@Override` catches subtle bugs. Bridge methods preserve binary compatibility. Erasure prevents some overloads. Sealed types and pattern matching offer modern alternatives to inheritance-based polymorphism.
