# Multiple & Double Dispatch — Junior

> **What?** *Single dispatch* means the method body is chosen from the runtime type of **one** object — the receiver. That is all Java has. *Multiple dispatch* would choose the body from the runtime types of **two or more** objects at once. Languages like CLOS, Clojure, and Julia have it built in; Java does not. *Double dispatch* is the trick we use to fake dispatch on two types in Java — the Visitor pattern is the famous example.
> **How?** Remember one hard rule: in Java, **only the receiver's runtime type is consulted; every argument is matched by its compile-time type**. Method *overloading* (two methods, same name, different parameters) is resolved entirely by `javac` at compile time — it is *not* polymorphism. When you need to branch on two runtime types, you either bounce through two virtual calls (Visitor) or, since Java 21, use a pattern-matching `switch`.

---

## 1. Single dispatch — what `obj.m(arg)` actually picks

Take the canonical polymorphic call:

```java
Animal a = new Dog();
a.speak();
```

The JVM picks `Dog.speak()` because the *receiver* `a` is a `Dog` at runtime. This is **single dispatch**: one object's runtime type drives the choice. (The mechanics — `invokevirtual`, the vtable — are covered in [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) and [../02-vtable-and-itable/](../02-vtable-and-itable/).)

Now add an argument:

```java
collide(Asteroid a, Spaceship s) { ... }
```

If `collide` is itself an instance method, the receiver (`this`) is dispatched dynamically — but `a` and `s` are **not**. The JVM never looks at the runtime type of an argument when choosing a method body. That asymmetry between receiver and arguments is the entire topic.

---

## 2. Multiple dispatch — the thing Java does not have

*Multiple dispatch* (a.k.a. *multimethods*) chooses the method body from the runtime types of **several** arguments together. The textbook example is a collision system:

```
collide(Asteroid,  Asteroid)   -> small bang
collide(Asteroid,  Spaceship)  -> ship damaged
collide(Spaceship, Spaceship)  -> both destroyed
```

In a multiple-dispatch language you write three `collide` definitions and the runtime picks the right one based on what the two objects *actually are* at runtime. In Java you cannot do this directly — and the reason is the trap in the next section.

| Term              | Dispatches on                       | Java has it? |
| ----------------- | ----------------------------------- | ------------ |
| Single dispatch   | receiver runtime type               | Yes (`invokevirtual`) |
| Double dispatch   | two objects' runtime types          | No — emulate with Visitor |
| Multiple dispatch | N objects' runtime types            | No — other languages do |

---

## 3. The trap: overloading is resolved at compile time

Here is the single most important fact in this topic. Overloaded methods are picked by `javac` using the **compile-time (static) type** of the arguments, not the runtime type.

```java
class Painter {
    String draw(Shape s)  { return "shape"; }
    String draw(Circle c) { return "circle"; }   // Circle extends Shape

    void run() {
        Shape s = new Circle();
        System.out.println(draw(s));   // prints "shape", NOT "circle"
    }
}
```

The variable `s` has compile-time type `Shape`, so `javac` hard-wires the call to `draw(Shape)`. The fact that `s` *is* a `Circle` at runtime is irrelevant — overload selection already happened, permanently, when the code compiled. This is *static binding*; see [../../02-more-about-oop/11-static-vs-dynamic-binding/](../../02-more-about-oop/11-static-vs-dynamic-binding/).

Contrast with *overriding*, which is dynamic:

```java
class Shape  { String name() { return "shape"; } }
class Circle extends Shape { @Override String name() { return "circle"; } }

Shape s = new Circle();
s.name();   // prints "circle" — overriding IS dynamic
```

> **Memorize the difference:** *overriding* (same signature, subclass body) is dynamic — runtime receiver wins. *Overloading* (same name, different parameters) is static — compile-time argument types win. They look similar; they are opposites.

---

## 4. Proving it with `javap`

You never have to guess which overload was chosen — the bytecode names it. Compile this:

```java
class Over {
    static String pick(Object o) { return "Object"; }
    static String pick(String s) { return "String"; }
    void run() {
        Object o = "hi";       // runtime value is a String
        String r = pick(o);
    }
}
```

`javap -c -p Over`:

```
void run();
   0: ldc           #11   // String hi
   2: astore_1
   3: aload_1
   4: invokestatic  #13   // Method pick:(Ljava/lang/Object;)Ljava/lang/String;
   7: astore_2
   8: return
```

The constant-pool descriptor reads `pick:(Ljava/lang/Object;)`. The compiler baked in `pick(Object)` even though the value at line 0 is literally the string `"hi"`. The runtime type never gets a vote. This is the whole proof: overload choice is frozen into the `invokestatic`/`invokevirtual` constant-pool reference at compile time.

---

## 5. Why `visit(Shape, Shape)` cannot dispatch on both

Suppose you try to build the collision system the naive way:

```java
void collide(Body a, Body b) {
    handle(a, b);   // hope this picks the right overload
}
void handle(Asteroid a, Asteroid b)  { ... }
void handle(Asteroid a, Spaceship b) { ... }
// ...
```

It does not work. Inside `collide`, the compile-time types of `a` and `b` are both `Body`. `javac` looks for `handle(Body, Body)` — which does not exist — and the code fails to compile (or, if a `handle(Body, Body)` overload exists, it always wins regardless of the real runtime types). The arguments are matched statically, so you can never reach the specific overloads. Single dispatch means **one** runtime type is available, and you have already spent it on the receiver.

---

## 6. Double dispatch — bouncing through two virtual calls

The fix is to turn each "argument dispatch" into a *receiver dispatch*, because receivers *are* dynamic. You do it in two hops. This is the **Visitor pattern** (Gang of Four).

```java
interface Shape {
    <R> R accept(Visitor<R> v);              // hop 1: dispatch on the shape
}
interface Visitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
}

final class Circle implements Shape {
    public <R> R accept(Visitor<R> v) { return v.visitCircle(this); }   // hop 2
}
final class Square implements Shape {
    public <R> R accept(Visitor<R> v) { return v.visitSquare(this); }   // hop 2
}

class AreaVisitor implements Visitor<Double> {
    public Double visitCircle(Circle c) { /* circle area */ return Math.PI * 1; }
    public Double visitSquare(Square s) { /* square area */ return 4.0; }
}
```

Call it:

```java
Shape s = new Circle();
double area = s.accept(new AreaVisitor());
```

Two dynamic dispatches happen, in order:

1. **`s.accept(v)`** dispatches on the runtime type of `s` → lands in `Circle.accept`.
2. Inside `Circle.accept`, **`v.visitCircle(this)`** dispatches on the runtime type of `v` → lands in `AreaVisitor.visitCircle`.

The combination of *(shape type, visitor type)* selected the final body — that is **double dispatch** built from two single dispatches. Note the crucial detail: in hop 2, `v.visitCircle(this)` is *not* relying on overload resolution to figure out that `this` is a `Circle`. The method name `visitCircle` is fixed at compile time inside `Circle.accept`, where the static type of `this` is exactly `Circle`. We chose the right `visitXxx` method *by virtue of being in the right `accept`*.

---

## 7. The bytecode proof of the two hops

Compile the Visitor above and look at `Circle.accept`:

```
public <R> R accept(Visitor<R>);
   0: aload_1
   1: aload_0
   2: invokeinterface #7,  2   // InterfaceMethod Visitor.visitCircle:(LCircle;)Ljava/lang/Object;
   7: areturn
```

That single `invokeinterface` is hop 2. And the client:

```
double area(Shape);
   8: invokeinterface #10, 2   // InterfaceMethod Shape.accept:(LVisitor;)...
   ...
```

is hop 1. **Two `invokeinterface` instructions, two virtual dispatches.** Count them and you can see, mechanically, why Visitor achieves double dispatch — it pays for two table lookups instead of one.

---

## 8. The modern alternative — pattern-matching `switch` (Java 21)

Since Java 21 (JEP 441), a pattern-matching `switch` over a `sealed` hierarchy lets you branch on the runtime type directly, with the compiler checking that you covered every case:

```java
sealed interface Shape permits Circle, Square {}
record Circle(double r)    implements Shape {}
record Square(double side) implements Shape {}

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
    };
    // no default needed — the sealed permits list is exhaustive
}
```

This reads far better than Visitor for the two-type case and needs no `accept` boilerplate. Under the hood it compiles to an `invokedynamic` call to a `typeSwitch` bootstrap plus a `lookupswitch` — we will dissect that in [`middle.md`](./middle.md). For one runtime type, prefer pattern switch. Visitor still earns its keep when the operations (not the types) change often, and across module boundaries — also covered later.

The pre-21 version of the same idea is the `instanceof` pattern (Java 16+):

```java
if (s instanceof Circle c) return Math.PI * c.r() * c.r();
else if (s instanceof Square sq) return sq.side() * sq.side();
else throw new IllegalStateException();
```

---

## 9. How other languages do multiple dispatch natively

Java's restriction is a *language* choice, not a law of nature. Several languages dispatch on more than one argument:

| Language  | Mechanism                                                      |
| --------- | ------------------------------------------------------------- |
| CLOS (Lisp) | `defmethod` with *specializers* on multiple parameters; the generic function picks by all of them. |
| Clojure   | `defmulti` + `defmethod`, dispatching on an arbitrary key function of *all* args. |
| Julia     | Multiple dispatch is *the* core paradigm; `collide(::Asteroid, ::Spaceship)` is a real method. |
| Groovy    | Default runtime dispatch resolves overloads by **runtime** argument types — the opposite of Java. |

A taste of Julia:

```julia
collide(a::Asteroid,  b::Asteroid)  = "small bang"
collide(a::Asteroid,  b::Spaceship) = "ship hit"
collide(a::Spaceship, b::Spaceship) = "both gone"
```

Each `collide` is dispatched on *both* argument runtime types. Java needs the Visitor dance to approximate exactly this.

> A subtle one: **Groovy** runs on the JVM but resolves overloads at *runtime*. The same `pick(o)` from §4, written in Groovy, prints `"String"` — because Groovy looks at the runtime type. This is the clearest illustration that overload-resolution timing is a language policy layered on top of the JVM, not a JVM constraint.

---

## 10. Quick rules

- [ ] Java has **single dispatch only**: the receiver's runtime type, nothing else.
- [ ] **Overriding is dynamic; overloading is static.** Never confuse them.
- [ ] Overload selection uses the **compile-time** types of the arguments — prove it with `javap`.
- [ ] You cannot dispatch on two runtime types in one call; you have already spent your one dynamic slot on the receiver.
- [ ] **Visitor = double dispatch** = two chained virtual calls (`accept` then `visitXxx`).
- [ ] In Java 21+, prefer a **pattern-matching `switch`** over a `sealed` hierarchy for the two-type case.
- [ ] CLOS / Clojure / Julia have real multiple dispatch; Groovy resolves overloads at runtime.

---

## 11. What's next

| Topic                                                            | File                |
| --------------------------------------------------------------- | ------------------- |
| `javap` of pattern switch, Visitor variants, real codebases      | `middle.md`         |
| Visitor trade-offs, expression problem, perf internals           | `senior.md`         |
| Review vocabulary, ArchUnit/error-prone, refactoring playbook    | `professional.md`   |
| JLS §15.12, JVMS §5.4.6, GoF Visitor, CLOS/Julia model           | `specification.md`  |
| "What does this overloaded call invoke?" + broken Visitor        | `find-bug.md`       |
| Visitor vs pattern-switch vs handler-map (JMH)                   | `optimize.md`       |
| `javap` overload-resolution drills, build a 2-type dispatcher    | `tasks.md`          |
| 20 interview questions                                           | `interview.md`      |

See also [../../02-more-about-oop/09-method-overloading-overriding/](../../02-more-about-oop/09-method-overloading-overriding/) for the overloading/overriding distinction at the language level, and [../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/](../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/) for sealed types and switch patterns.

---

**Memorize this:** Java dispatches on exactly one runtime type — the receiver. Overriding is dynamic; **overloading is compile-time and matches arguments by their static type** (`javap` shows the frozen descriptor). To branch on two runtime types you fake it: Visitor chains two virtual calls (`accept` → `visitXxx`) for *double dispatch*, or — Java 21+ — a pattern `switch` over a `sealed` type does it directly. True multiple dispatch lives in CLOS, Clojure, and Julia.
