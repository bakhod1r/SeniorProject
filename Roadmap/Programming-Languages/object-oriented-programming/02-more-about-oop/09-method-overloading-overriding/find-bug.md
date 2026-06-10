# Method Overloading / Overriding — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of an overload/override mistake.

---

## Bug 1 — Overload pretending to be override

```java
class Parent { void process(Object o) { System.out.println("Parent"); } }
class Child extends Parent {
    void process(String s) { System.out.println("Child"); }    // not an override!
}

Parent p = new Child();
p.process("hi");    // prints "Parent" — surprised?
```

**Why?** `process(String)` is a different method from `process(Object)`. `p` is `Parent`-typed; the call resolves to `Parent.process(Object)` at compile time.

**Fix:** override the actual method:
```java
class Child extends Parent {
    @Override void process(Object o) { System.out.println("Child"); }
}
```

The `@Override` annotation would have caught the original mistake.

---

## Bug 2 — Static "override"

```java
class Parent { static String name() { return "Parent"; } }
class Child extends Parent { static String name() { return "Child"; } }

Parent p = new Child();
System.out.println(p.name());    // "Parent" — not "Child"
```

**Why?** Static methods are dispatched at compile time via declared type, not actual class. Hidden, not overridden.

**Fix:** if polymorphism is needed, make them instance methods. If not, call directly: `Parent.name()` or `Child.name()`.

---

## Bug 3 — Wider throws on override

```java
class Parent { void m() throws IOException { } }
class Child extends Parent {
    @Override void m() throws Exception { }    // ERROR — wider
}
```

**Why?** The override's checked exception list must be a subset of the parent's. `Exception` is wider than `IOException`.

**Fix:** narrow the exception:
```java
@Override void m() throws IOException { }
// or
@Override void m() throws FileNotFoundException { }
```

---

## Bug 4 — Narrower access on override

```java
class Parent { public void m() { } }
class Child extends Parent {
    @Override protected void m() { }   // ERROR — narrower
}
```

**Why?** Access can be widened, not narrowed.

**Fix:** use `public`:
```java
@Override public void m() { }
```

---

## Bug 5 — Generic erasure conflict

```java
class C {
    void m(List<String> l) { }
    void m(List<Integer> l) { }    // ERROR — same erasure
}
```

**Why?** After erasure, both are `m(List)`. Compiler errors on clashing methods.

**Fix:** use different method names or wrap in distinct types.

---

## Bug 6 — Forgot `@Override`, typo

```java
class A { protected void compute() { } }
class B extends A {
    protected void Compute() { }    // capital C — separate method
}
```

**Why?** Without `@Override`, the typo is invisible. `B` has both `compute` (inherited) and `Compute` (declared).

**Fix:** add `@Override`:
```java
@Override protected void compute() { }   // typo would cause compile error
```

---

## Bug 7 — Override changing return to incompatible type

```java
class Parent { int compute() { return 0; } }
class Child extends Parent {
    @Override String compute() { return ""; }    // ERROR — String not subtype of int
}
```

**Why?** Return type must be same primitive or subtype reference.

**Fix:** keep `int` or rethink the design.

---

## Bug 8 — Overloaded constructor calling itself

```java
class C {
    C() { this(0); }
    C(int x) { this(); }    // infinite recursion!
}
```

**Why?** `this()` calls `C()`, which calls `C(0)`, which calls `C()`, ... StackOverflowError.

**Fix:** terminate the chain:
```java
C() { this(0); }
C(int x) { /* base case */ }
```

---

## Bug 9 — `private` method "override"

```java
class Parent {
    private void compute() { System.out.println("Parent"); }
    public void run() { compute(); }
}
class Child extends Parent {
    private void compute() { System.out.println("Child"); }
}

new Child().run();    // "Parent"
```

**Why?** Private methods aren't visible to subclasses. `Parent.run` calls `Parent.compute` (its own private method), not Child's same-named (but separate) method.

**Fix:** to override, `compute` must be visible. Make it `protected` or `public`:
```java
class Parent { protected void compute() { ... } }
class Child extends Parent { @Override protected void compute() { ... } }
```

---

## Bug 10 — Overload ambiguity with null

```java
void m(String s) { ... }
void m(Object o) { ... }

m(null);    // ambiguous? actually picks String — most specific
```

Then someone adds:
```java
void m(StringBuilder sb) { ... }

m(null);    // ERROR — String, StringBuilder, Object all apply, but neither String nor StringBuilder is more specific
```

**Why?** Adding overloads can introduce ambiguity for `null` arguments.

**Fix:** cast at call sites: `m((String) null)`. Or remove ambiguity in design.

---

## Bug 11 — Equals override breaking contract

```java
class Point {
    int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return p.x == x && p.y == y;
    }
    // hashCode NOT overridden!
}
```

**Why?** `equals` and `hashCode` must be consistent. Two equal points may have different hash codes → broken HashMap behavior.

**Fix:** override both:
```java
@Override public int hashCode() { return Objects.hash(x, y); }
```

Or use a record.

---

## Bug 12 — Overloading with `int` and `Integer` ambiguity

```java
void m(int x)     { System.out.println("int"); }
void m(Integer x) { System.out.println("Integer"); }

m(5);                          // int (exact)
m((Object) 5);                 // hmm — only Integer overload accepts Object? Let me think...
                                // Actually: Object is widening to Integer? No — Object isn't a subtype of int or Integer.
                                // Compile error: cannot apply int (5 boxed to Integer fits, but the cast forces Object)
```

Wait — `m((Object) 5)` would error because neither `m(int)` nor `m(Integer)` accepts `Object`.

**Fix:** add `m(Object)` overload, or stop casting unnecessarily.

---

## Pattern recap

| Bug | Family                                | Cure                              |
|-----|---------------------------------------|-----------------------------------|
| 1   | Overload pretending to be override     | `@Override`; correct signature    |
| 2   | Static "override"                      | Instance method, or call directly |
| 3   | Wider throws                           | Narrow to subtype                 |
| 4   | Narrower access                        | Match or widen access             |
| 5   | Generic erasure conflict               | Different names                   |
| 6   | Typo missed                            | `@Override`                       |
| 7   | Incompatible return                    | Keep type or restructure          |
| 8   | Constructor recursion                   | Terminate the chain               |
| 9   | Private "override"                     | Use protected/public              |
| 10  | Null ambiguity                         | Cast at call site                 |
| 11  | Equals without hashCode                | Override both; or use record      |
| 12  | Overload casting confusion              | Add overload or remove cast       |

---

**Memorize the shapes**: most overload/override bugs are caught by `@Override`. Static methods don't override. Private methods don't override. Generic erasure prevents some overloads. Always pair `equals` with `hashCode`.
