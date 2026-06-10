# Method Overloading / Overriding — Middle

> **What?** The detailed rules: overload resolution phases (strict → loose → varargs), most-specific method selection, covariant return types, exception narrowing, generic-induced bridge methods, and the interactions with autoboxing.
> **How?** By understanding how the compiler picks an overload at the call site (JLS §15.12) and how the JVM dispatches an override at runtime (JVMS §5.4.5).

---

## 1. Three-phase overload resolution

JLS §15.12.2 specifies that overload resolution proceeds in three phases:

1. **Strict invocation** — only direct subtype relations, no autoboxing, no varargs.
2. **Loose invocation** — allow autoboxing/unboxing.
3. **Variable-arity invocation** — allow varargs.

The first phase that finds an applicable method wins. Within a phase, the most specific method is chosen.

```java
void m(int x)     { ... }      // strict
void m(Integer x) { ... }      // strict (different params)
void m(int... x)  { ... }      // varargs

m(5);    // phase 1 finds m(int) — wins
```

```java
void m(Integer x) { ... }
void m(int... x)  { ... }

m(5);    // phase 1: nothing (m(Integer) needs boxing). phase 2: m(Integer) — wins.
```

```java
void m(int... x) { ... }

m(5);    // phase 3 — varargs match
```

---

## 2. Most-specific method

When multiple methods are applicable in the same phase, the *most specific* wins. Specificity rules:
- A method `m1` is more specific than `m2` if every argument that's valid for `m1` is also valid for `m2`.

```java
void m(Object x) { System.out.println("Object"); }
void m(String x) { System.out.println("String"); }

m("hi");    // "String" — String is more specific than Object
```

If neither is more specific than the other, it's ambiguous → compile error:

```java
void m(Number x, Object y) { ... }
void m(Object x, Number y) { ... }

m(1, 2);   // ambiguous — neither more specific
```

---

## 3. Covariant return types

Java 5+ allows the override's return type to be a subtype of the parent's:

```java
class Animal { Animal mate() { return null; } }
class Dog extends Animal {
    @Override
    Dog mate() { return new Dog(); }   // covariant: Dog <: Animal
}
```

The compiler synthesizes a bridge method on `Dog`:

```
Dog mate();        // user-written
Animal mate();     // synthetic bridge — calls mate() and returns as Animal
```

This preserves binary compatibility — code compiled against `Animal.mate()` still works.

Primitives don't have covariance: a `long` override can't return `int`, even though they're "compatible."

---

## 4. Exception narrowing

The override can throw fewer or narrower checked exceptions:

```java
class Parent { void m() throws IOException { } }

class Child extends Parent {
    @Override void m() throws FileNotFoundException { }    // narrower — OK
}

class Bad extends Parent {
    @Override void m() throws Exception { }    // ERROR — wider
}
```

Unchecked exceptions (`RuntimeException`, `Error` subclasses) are always allowed.

---

## 5. Access modifier widening

The override can have *wider* access, but not narrower:

```java
class Parent { protected void m() { } }
class Child extends Parent {
    @Override public void m() { }   // OK — public is wider
}

class Bad extends Parent {
    @Override private void m() { }   // ERROR — narrower
}
```

You can't make a public method private — that would break the LSP (callers expecting public access would fail).

---

## 6. Static methods don't override — they hide

```java
class Parent {
    static String name() { return "Parent"; }
}
class Child extends Parent {
    static String name() { return "Child"; }    // hides, not overrides
}

Parent p = new Child();
p.name();        // "Parent" — static dispatch via declared type
Child.name();    // "Child"
```

`static` methods are dispatched at compile time. The subclass version *hides* the parent's, but doesn't participate in polymorphism.

`@Override` doesn't apply to static methods (compile error if used).

---

## 7. Final methods can't be overridden

```java
class Parent { final void m() { } }
class Child extends Parent {
    @Override void m() { }   // ERROR — m is final
}
```

`final` is sometimes used to enforce template-method patterns: the parent declares `final void run()` and provides the algorithm, while letting subclasses override smaller `protected` hooks.

---

## 8. Private methods don't override

Private methods aren't visible to subclasses, so a same-named private method in a subclass is a *separate* method:

```java
class Parent {
    private String compute() { return "P"; }
    public String run() { return compute(); }    // calls Parent.compute (private)
}
class Child extends Parent {
    private String compute() { return "C"; }    // separate method
}

new Child().run();    // "P" — Parent.run sees Parent.compute
```

Same with `protected` if accessed from a different package — the protected method is visible only to subclasses, but if the subclass is in the same package, it's accessible to package-mates too.

---

## 9. Generics and bridge methods

```java
class Box<T> {
    T get() { return null; }
}
class IntBox extends Box<Integer> {
    @Override Integer get() { return 42; }
}
```

After erasure, `Box.get()` has signature `Object get()`. `IntBox.get(): Integer` doesn't directly match. The compiler generates a bridge:

```
IntBox class file:
  Integer get();        // user-written
  Object get();         // synthetic bridge — calls get():Integer, returns as Object
```

This is why type erasure is sometimes called the "elephant in the room" — it works, but the mechanism is bytecode-level.

---

## 10. Overloading with autoboxing

```java
void m(int x) { System.out.println("int"); }
void m(Integer x) { System.out.println("Integer"); }

m(5);                          // "int" — exact match
m(Integer.valueOf(5));         // "Integer" — exact match
m(null);                       // "Integer" — null is not assignable to int
```

Autoboxing happens only if no exact match exists. The compiler always prefers a method that doesn't require boxing/unboxing.

---

## 11. Overloading with widening

```java
void m(int x)    { System.out.println("int"); }
void m(long x)   { System.out.println("long"); }
void m(double x) { System.out.println("double"); }

byte b = 5;
m(b);    // "int" — byte widens to int
short s = 5;
m(s);    // "int" — short widens to int
long l = 5;
m(l);    // "long"
```

The compiler picks the smallest widening conversion that works.

---

## 12. Overload resolution gotchas

**Ambiguous overloads:**
```java
void m(Object x, Number y) { }
void m(Number x, Object y) { }
m(1, 2);   // ambiguous — both apply, neither more specific
```

**Generic vs raw:**
```java
void m(List<String> l) { }
void m(List l)         { }   // raw — "more specific" by certain rules
```

This produces unchecked warnings; avoid raw types.

**Varargs ambiguity:**
```java
void m(int... a)     { }
void m(Integer... a) { }
m(1);   // ambiguous in some configurations — boxing rules differ
```

---

## 13. Overriding with generic parameters

```java
class Container<T> { void add(T x) { } }
class StringContainer extends Container<String> {
    @Override void add(String x) { }
}
```

After erasure, `Container.add` has signature `add(Object)`. `StringContainer.add(String)` doesn't match directly. Bridge method:

```
StringContainer:
  void add(String);    // user override
  void add(Object);    // bridge: cast to String, dispatch to override
```

The bridge ensures dispatch works regardless of the static type at the call site.

---

## 14. Overloading vs overriding cheat sheet

| Behavior                       | Overloading       | Overriding        |
|--------------------------------|-------------------|-------------------|
| Resolution time                | Compile           | Runtime           |
| Polymorphic                    | No                | Yes               |
| Affects performance            | Marginal          | Vtable lookup     |
| Multiple in same class         | Yes               | No (one parent)   |
| Compiler can mistake for       | Override          | Overload          |
| Annotation                     | None              | `@Override`       |
| Static methods?                | Yes (overload)    | Hide, not override|

---

## 15. What's next

| Topic                          | File              |
|--------------------------------|-------------------|
| JIT view of dispatch           | `senior.md`        |
| Bytecode of overload/override  | `professional.md`  |
| JLS rules                      | `specification.md` |
| Common bugs                    | `find-bug.md`      |

---

**Memorize this**: overloading is compile-time selection of a method by argument types (three-phase resolution). Overriding is runtime dispatch to the receiver's method. Use `@Override`. Bridge methods bridge between erased generic signatures and covariant returns. Static methods hide; they don't override.
