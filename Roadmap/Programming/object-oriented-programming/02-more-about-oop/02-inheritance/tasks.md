# Inheritance — Practice Tasks

Twelve exercises covering hierarchy design, override correctness, LSP, sealed types, and dispatch behavior.

---

## Task 1 — Predict the dispatch

```java
class A { void m() { System.out.println("A"); } }
class B extends A { @Override void m() { System.out.println("B"); } }
class C extends B { /* no override */ }
class D extends C { @Override void m() { System.out.println("D"); } }

A a = new D();
a.m();    // ?
```

Predict the output, then run.

---

## Task 2 — Field hiding vs method override

```java
class Animal {
    int legs = 4;
    int legs() { return legs; }
}
class Spider extends Animal {
    int legs = 8;
    @Override int legs() { return legs; }
}

Animal a = new Spider();
System.out.println(a.legs);   // ?
System.out.println(a.legs()); // ?
```

Predict, then explain *why* one is 4 and the other is 8.

---

## Task 3 — LSP violation

Write a `Bird` class with method `fly()`. Add a subclass `Penguin extends Bird`. Discuss: how does this violate LSP? Refactor the hierarchy so it doesn't.

(Hint: not all birds fly. Maybe `Bird` shouldn't have `fly()`. Maybe there's a `Flyer` capability.)

---

## Task 4 — Sealed expression hierarchy

Define a sealed interface `Expr` with permitted record subtypes `Num(int v)`, `Add(Expr l, Expr r)`, `Mul(Expr l, Expr r)`. Implement `int eval(Expr e)` using exhaustive pattern-matching switch.

Then add `Sub(Expr l, Expr r)` to `permits`. Run `eval` — what error do you get? Fix the switch.

---

## Task 5 — Covariant return

```java
class Cell {
    Object get() { return null; }
}
class IntCell extends Cell {
    @Override ??? get() { return 42; }
}
```

Fill in the return type so the override is covariant. Verify with `javap` that a bridge method was generated.

---

## Task 6 — Override or overload?

Predict which of the following are overrides, which are overloads, which are compile errors.

```java
class A {
    void m(int x) { }
    void m(long x) { }
    int n(int x) { return 0; }
}
class B extends A {
    @Override void m(int x) { }     // a
    void m(int x, int y) { }        // b
    @Override double n(int x) { }   // c
    int n(long x) { return 0; }     // d
}
```

Identify each as override / overload / error and explain why.

---

## Task 7 — Constructor chaining puzzle

```java
class A {
    A() { System.out.println("A()"); }
    A(int x) { System.out.println("A(int)"); }
}
class B extends A {
    B() { this(0); System.out.println("B()"); }
    B(int x) { super(x); System.out.println("B(int)"); }
}

new B();
```

Predict the output. Then change `super(x)` to `super()`. Predict again.

---

## Task 8 — Composition via delegation

You have a `Stack<E>` that incorrectly `extends ArrayList<E>`. Refactor it to *contain* an `ArrayList<E>` instead. Ensure:
- Only `push`, `pop`, `peek`, `size`, `isEmpty` are public.
- `ArrayList` mutators are not exposed.
- Iteration still works.

---

## Task 9 — `protected` access surprise

This compiles in `package alpha`, but fails in `package beta`. Why?

```java
// alpha/A.java
package alpha;
public class A {
    protected void m() { }
}

// beta/B.java
package beta;
import alpha.A;
public class B extends A {
    void test(A other) {
        other.m();   // ERROR
    }
}
```

What is the rule? Find a way to make it work.

---

## Task 10 — Diamond with default methods

Define interfaces:
```java
interface X { default String hello() { return "X"; } }
interface Y { default String hello() { return "Y"; } }
```

Make a class `Z implements X, Y`. What does `new Z().hello()` return? (Hint: it doesn't compile. Fix it.)

---

## Task 11 — Visitor refactored to sealed

A toy AST has the visitor pattern:
```java
interface Expr { <R> R accept(ExprVisitor<R> v); }
interface ExprVisitor<R> {
    R num(NumExpr n);
    R add(AddExpr a);
}
class NumExpr implements Expr { /* ... */ }
class AddExpr implements Expr { /* ... */ }
```

Refactor to sealed types and pattern-matching switch. Compare lines of code, readability, and whether you've gained or lost extensibility.

---

## Task 12 — Equals & hashCode contract in a hierarchy

Implement `Point` with `x`, `y` and proper `equals`/`hashCode`. Then define `ColoredPoint extends Point` with an additional `color`. Try to write `equals` for `ColoredPoint` that satisfies all of:
- Reflexive
- Symmetric
- Transitive
- Consistent

Spoiler: you'll hit Effective Java Item 10. Discuss why this is impossible without breaking symmetry, and what alternatives exist (composition, `final`, `getClass()` checks vs `instanceof` checks).

---

## Validation

| Task | How |
|------|-----|
| 1, 2, 7 | Compile and run; compare predicted output |
| 3 | Code review your refactor; can `Bird b = new Penguin(); b.fly();` even compile after refactor? |
| 4 | Add Sub then run; observe compile error pinpointing the missing case |
| 5 | `javap -p -c IntCell.class` should show two `get()` methods |
| 6 | Compile each in isolation; let `@Override` annotations and javac do the labeling |
| 8 | Try `new MyStack<>().add("x")` — should not compile |
| 9 | `b.test(new B())` works; `b.test(new A())` doesn't (in package beta) |
| 10 | After fix, hello() should call your chosen interface's default explicitly |
| 11 | Lines of code: count before/after |
| 12 | Test reflexivity / symmetry / transitivity with all four cases (Point eq Point, Point eq CP, CP eq Point, CP eq CP) |

---

## Solutions sketch

**Task 1** answer: `D`. The hierarchy A→B→C→D; D overrides; receiver is D.

**Task 2** answer: 4 (field, static dispatch via `Animal`); 8 (method, dynamic dispatch).

**Task 3:** introduce a `Flyer` interface that `Sparrow` implements but `Penguin` does not. `Bird` becomes a class with shared bird state but no `fly()`.

**Task 4:** the switch must include `case Sub s ->`. Pattern matching exhaustiveness gives you a compile error pointing exactly at this.

**Task 5:** `Integer get()`. `javap` will show both `Integer get()` and a synthetic `Object get()` bridge.

**Task 6 (a)** override (b) overload (c) error — different return type, not covariant; void→double not allowed (d) overload; and depending on context (a) is fine, but (c) breaks override compatibility.

**Task 7** first run:
```
A(int)
B(int)
B()
```
Second run (super() instead of super(x)): `A() / A(int)` ... actually, super() has implicit argument resolution — compile would fail without an A() with no-args; if A has both, then the chain is `A() / B(int) / B()`. Use `javap` to verify.

**Task 9:** `protected` from outside the package only allows access via *this-typed* references. `other.m()` is not `this.m()`. To work around, call `((B) other).m()` if it actually IS a B.

**Task 10:** override `hello` and call `X.super.hello()` or `Y.super.hello()` explicitly.

**Task 12:** the canonical answer is "use composition, not inheritance" or "use `getClass()` instead of `instanceof`" (which breaks LSP). Effective Java Item 10 has the full discussion.

---

**Memorize this**: Inheritance puzzles usually trace back to (a) static vs dynamic dispatch, (b) override vs overload vs hide, or (c) constructor ordering. Always reach for `@Override`, prefer composition, use sealed types for closed unions.
