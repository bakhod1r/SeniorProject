# Multiple & Double Dispatch — Interview Q&A

Strong, concise, correct answers. Grouped by difficulty. The recurring theme: *overloading is static, overriding is dynamic; Java is single dispatch; double dispatch is emulated.*

---

## Warm-up / conceptual

**1. What is single dispatch, and is it all Java has?**
Single dispatch chooses the method body from the runtime type of exactly one object — the receiver (`this`). Yes, it is all Java has: `invokevirtual`/`invokeinterface` consult the receiver's class only. Argument types are matched at compile time and never re-examined at runtime.

**2. What is multiple dispatch?**
Choosing the method body from the runtime types of two or more arguments *together*. Java lacks it; CLOS, Clojure, and Julia have it natively. Example: `collide(Asteroid, Spaceship)` selecting a different body than `collide(Spaceship, Spaceship)` based on both runtime types.

**3. Is overloading polymorphism?**
No. Overload resolution (picking among same-named methods by parameter types) is done by `javac` at compile time using the **static** types of the arguments. It is *static binding*, not polymorphism. Overriding is the dynamic, polymorphic mechanism.

**4. What's the difference between overloading and overriding in one sentence each?**
Overloading: same name, *different parameters*, chosen at **compile time** by static argument types. Overriding: same signature, subclass body, chosen at **runtime** by the receiver's class.

**5. What is double dispatch?**
Selecting a method body based on the runtime types of *two* objects, achieved in a single-dispatch language by chaining two virtual calls. The Visitor pattern is the standard encoding: `element.accept(visitor)` dispatches on the element, then `visitor.visitX(this)` dispatches on the visitor.

---

## "What does this print?"

**6.**
```java
class Shape {}
class Circle extends Shape {}
String f(Shape s)  { return "shape"; }
String f(Circle c) { return "circle"; }
Shape s = new Circle();
System.out.println(f(s));
```
**`shape`.** `s` has compile-time type `Shape`, so `javac` binds the call to `f(Shape)`. The runtime type `Circle` is irrelevant — overloading is static.

**7.**
```java
void g(long x)    { print("long"); }
void g(Integer x) { print("Integer"); }
g(1);
```
**`long`.** `1` is an `int`. Phase 1 of overload resolution allows primitive widening (`int → long`) but not boxing, so `g(long)` is applicable before `g(Integer)` is even considered. Widening beats boxing.

**8.**
```java
void h(String s) { print("String"); }
void h(Object o) { print("Object"); }
h(null);
```
**`String`.** `null` is assignable to both, but `String` is the more specific reference type, so it wins (JLS §15.12.2.5). Add a third sibling overload `h(Integer)` and `h(null)` no longer compiles — ambiguous.

**9.**
```java
Shape s = new Circle();
s.area();   // area() is overridden in Circle
```
**Circle's `area`.** Overriding is dynamic; the receiver's runtime type `Circle` selects the body. Contrast with Q6 — same setup, opposite result, because that was overloading.

**10. The same `f(s)` from Q6, but written in Groovy. What prints?**
**`circle`.** Groovy resolves overloads by runtime argument types by default. Same JVM, opposite policy. This shows overload-resolution timing is a language choice, not a JVM constraint.

---

## Mechanics / trade-offs

**11. Why can't `visit(Shape, Shape)` dispatch on both arguments?**
Inside the method, both arguments have a static type (e.g., `Shape`). Overload resolution matches by static type, so it always picks the `(Shape, Shape)` overload regardless of runtime types. You only get *one* dynamic dispatch — on the receiver — and the arguments don't get one.

**12. Walk through the two dispatches in Visitor.**
`shape.accept(v)` — hop 1, dispatches on the runtime type of `shape`, landing in e.g. `Circle.accept`. Inside, `v.visitCircle(this)` — hop 2, dispatches on the runtime type of `v`. The method name `visitCircle` is statically fixed because inside `Circle.accept` the static type of `this` is `Circle`. The product (shape type × visitor type) selects the final body.

**13. How does Visitor look in bytecode?**
Two `invokeinterface` instructions: one for `accept` at the call site, one for `visitXxx` inside each `accept`. Two virtual dispatches, two itable lookups. `javap -c` shows exactly this.

**14. What is the expression problem and how does it apply here?**
You want to add new types (rows) and new operations (columns) to a type×operation grid without editing existing code, keeping type safety. Plain virtual methods make adding types cheap, operations expensive. Visitor is the dual: operations cheap, types expensive. Pattern switch is like Visitor but the compiler enforces exhaustiveness. Choose by the axis you expect to grow.

**15. When would you choose pattern switch over Visitor (Java 21)?**
When you own all the call sites and the type set is closed (sealed). Pattern switch needs no `accept` boilerplate, is exhaustiveness-checked, and avoids megamorphic virtual sites. Choose Visitor when operations are contributed by code that cannot edit your switches (a published plugin API) and the element set is frozen.

**16. How does a pattern switch compile?**
To a single `invokedynamic` calling `java.lang.runtime.SwitchBootstraps.typeSwitch` (with the case labels as static arguments), which returns a `CallSite` mapping the scrutinee to an `int` index, followed by an ordinary `lookupswitch`. Not a chain of `instanceof` checks.

**17. Why might an "elegant" Visitor be slower than a switch?**
A `accept` call site fed many element types in a loop becomes *megamorphic* — it exceeds HotSpot's inline-cache capacity, can't inline, and falls back to a full itable lookup. A pattern switch over a sealed type lowers to a flat jump table with no megamorphic virtual site. Measure; don't assume OO is faster.

**18. How is `equals` a double-dispatch problem?**
`a.equals(b)` dispatches on `a` (single dispatch), but the body must then consider `b`'s runtime type, which arrives typed as `Object`. The `instanceof` test inside `equals` is the hand-written second dispatch. Getting it wrong across a subclassable hierarchy breaks the symmetry contract (`a.equals(b) != b.equals(a)`), corrupting hash collections — *Effective Java* Item 10.

---

## Design / deeper

**19. Why did Java choose static overload resolution?**
Predictability (the target is determinable from source and declared types), performance (a fixed constant-pool reference, trivially inlined), and a tractable type system (return-type and generic inference key off a statically-chosen method; runtime selection would make inference undecidable). The cost is the overloading trap.

**20. How do CLOS / Julia differ structurally that lets them dispatch on multiple args?**
They decouple methods from classes: a *generic function* owns a set of methods, each specializing on any subset of parameters, and selection considers the whole argument tuple. There is no single privileged receiver. Java inherited Smalltalk's "message to one receiver" model, which structurally limits it to single dispatch.

**21. How would you implement symmetric two-type dispatch (collisions) cleanly in Java?**
A `Map<Pair<Class,Class>, Handler>` keyed on both runtime classes, with a symmetry fallback that tries the swapped pair. This localizes the N² matrix and the symmetry rule to one place. The trade-off is loss of compile-time exhaustiveness — no compiler check that every pair is handled. Visitor's N² mirror methods are the alternative but are dense and hand-synchronized.

**22. You ship a `Visitor` as public API. How do you keep adding a `visitXxx` from breaking downstream visitors?**
Give the interface `default` methods that delegate to a `visitDefault(Element)`. Adding a new `visitTriangle` with a `default` body calling `visitDefault` is source- and binary-compatible — existing visitors inherit the default. This is the key technique for an evolvable public Visitor.

**23. Does sealing the hierarchy change anything for dispatch performance?**
Yes. A sealed `permits` list closes the type set in the class file, so Class Hierarchy Analysis can prove closure without speculation: pattern switches lower to un-guarded jump tables, the compiler enforces exhaustiveness (no `default`), and adding a subtype turns stale switches into compile errors. Sealed + records + pattern switch is the modern double-dispatch answer for closed models.

---

**One-line closer for interviews:** *Java dispatches on one runtime type — the receiver. Overriding is dynamic; overloading is compile-time on static argument types. To branch on two runtime types you chain two virtual calls (Visitor) or, since Java 21, use a sealed pattern switch. True multiple dispatch lives in CLOS, Clojure, and Julia.*
