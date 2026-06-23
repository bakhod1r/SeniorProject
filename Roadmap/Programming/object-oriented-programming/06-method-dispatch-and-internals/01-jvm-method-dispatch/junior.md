# JVM Method Dispatch — Junior

> **What?** Every Java method call is compiled to one of five bytecodes — `invokestatic`, `invokespecial`, `invokevirtual`, `invokeinterface`, `invokedynamic`. Together they implement how the JVM decides *which* method body to run when you write `obj.doThing()`. The first four are old as Java itself; `invokedynamic` arrived in Java 7 and is what makes lambdas and modern `switch` work.
> **How?** When you read or write Java code, ask three questions: *who is the receiver?* (or is there one at all), *is the method overridable?*, and *does the answer change per call site?* The bytecode the compiler emits is mechanical once you know those three answers. `javap -c -v` shows it for any class.

---

## 1. Five bytecodes, one sentence each

Every method call in a `.class` file is exactly one of these instructions. There is no sixth.

| Bytecode          | Used for                                                            |
| ----------------- | ------------------------------------------------------------------- |
| `invokestatic`    | `static` methods. No receiver. Resolved at link time.               |
| `invokespecial`   | Constructors (`<init>`), `private` methods, explicit `super.m()`.   |
| `invokevirtual`   | Normal instance methods declared on a class. Virtually dispatched.  |
| `invokeinterface` | Instance methods declared on an interface. Virtually dispatched.    |
| `invokedynamic`   | Bootstrapped call sites: lambdas, string `+`, `switch` on patterns. |

The first four are *statically chosen* by `javac` — the bytecode tells the JVM which dispatch strategy to use. The actual *target* (which body to run) is decided at runtime for the virtual ones. `invokedynamic` is different: even the *strategy* is decided at runtime via a bootstrap method.

---

## 2. What "virtual dispatch" means

When you write:

```java
Animal a = new Dog();
a.speak();
```

the compile-time type of `a` is `Animal`, but the actual object is a `Dog`. *Virtual dispatch* means the JVM uses the runtime type (`Dog`) to choose the method body, not the compile-time type. So `Dog.speak()` runs, not `Animal.speak()`. This is what makes polymorphism work — and what makes `invokevirtual` and `invokeinterface` different from `invokestatic` and `invokespecial`.

Mechanically, the JVM holds a table per class (the *vtable* for classes, *itable* for interfaces — see [../02-vtable-and-itable/](../02-vtable-and-itable/)) and the call indexes into that table at the receiver's runtime class. Static and special calls skip the table — they go straight to a fixed target.

---

## 3. `invokestatic` — class-level methods

```java
public class MathBox {
    public static int doubled(int n) { return n * 2; }
}

class Caller {
    void use() {
        int x = MathBox.doubled(21);
    }
}
```

`javap -c Caller` shows:

```
0: bipush        21
2: invokestatic  #2 // Method MathBox.doubled:(I)I
5: istore_1
```

No receiver loaded, no `this`. The constant pool entry `#2` names `MathBox.doubled` directly. The JVM links once, then every subsequent call is essentially a direct function jump. This is the cheapest opcode of the five.

---

## 4. `invokespecial` — constructors, `private`, `super`

`invokespecial` is what you reach for when *the exact method to call is decided at compile time, even though there is a receiver*. Three cases trigger it:

```java
class Parent {
    public void greet() { System.out.println("parent"); }
}

class Child extends Parent {
    private void log() { /* ... */ }

    public Child() { super(); }              // (1) invokespecial — constructor

    void run() {
        log();                                // (2) invokespecial — private
        super.greet();                        // (3) invokespecial — super.m()
    }
}
```

`javap -c Child`:

```
public Child();
  0: aload_0
  1: invokespecial #1 // Method Parent."<init>":()V
  4: return

void run();
  0: aload_0
  1: invokespecial #7 // Method log:()V
  4: aload_0
  5: invokespecial #9 // Method Parent.greet:()V
  8: return
```

In every case the *exact* method body is known statically — no subclass can intercept. That is why `super.greet()` always runs the parent's version even if some sub-subclass overrode it: `invokespecial` does not consult the vtable.

---

## 5. `invokevirtual` — the normal case

Most instance method calls are `invokevirtual`. The compiler emits it whenever the method is *overridable* (not `static`, not `private`, not `<init>`).

```java
class Animal { public void speak() { System.out.println("..."); } }
class Dog extends Animal { @Override public void speak() { System.out.println("woof"); } }

class Demo {
    void run() {
        Animal a = new Dog();
        a.speak();
    }
}
```

`javap -c Demo`:

```
0: new           #2  // class Dog
3: dup
4: invokespecial #3  // Method Dog."<init>":()V         <-- constructor
7: astore_1
8: aload_1
9: invokevirtual #4  // Method Animal.speak:()V         <-- virtual call
12: return
```

Notice the constant pool entry names *`Animal.speak`*, not `Dog.speak`. At runtime, the JVM looks up `speak` on the receiver's actual class (`Dog`) and runs `Dog.speak`. The class file commits to "virtual dispatch on the `Animal.speak` slot"; the runtime fills in which body.

---

## 6. `invokeinterface` — virtual via interface

When the static type at the call site is an *interface*, you get `invokeinterface`:

```java
interface Speaker { void speak(); }
class Dog implements Speaker { public void speak() { System.out.println("woof"); } }

class Demo {
    void run() {
        Speaker s = new Dog();
        s.speak();
    }
}
```

`javap -c Demo`:

```
8: aload_1
9: invokeinterface #4, 1  // InterfaceMethod Speaker.speak:()V
14: return
```

The extra `, 1` is the *count* operand — the number of argument slots including the receiver. It's a JVMS quirk left over from the original itable design. Semantically `invokeinterface` is "virtual dispatch, but the receiver might be any class that implements this interface". Lookup goes through an *itable*, which is slightly more expensive than a vtable but still amortises to a constant-time lookup once the JIT warms up. See [../02-vtable-and-itable/](../02-vtable-and-itable/) for the table layout.

---

## 7. `invokedynamic` — lambdas and friends

This is the modern one. Introduced in Java 7 for dynamic languages on the JVM (JRuby, Nashorn), it became the workhorse for Java 8 lambdas.

```java
Runnable r = () -> System.out.println("hi");
r.run();
```

`javap -c -v`:

```
0: invokedynamic #2, 0  // InvokeDynamic #0:run:()Ljava/lang/Runnable;
5: astore_1
6: aload_1
7: invokeinterface #3, 1 // InterfaceMethod Runnable.run:()V
```

The *lambda creation* is `invokedynamic` (line 0). The first time this call site executes, the JVM runs a *bootstrap method* (`LambdaMetafactory.metafactory`) that builds a `Runnable` instance backed by the synthetic method `lambda$run$0`. Subsequent executions reuse the cached implementation.

The invocation of `r.run()` itself is still a plain `invokeinterface`. `invokedynamic` was only used to *create* the lambda. The two-stage model — bootstrap once, then a normal call — is the whole point: the JVM doesn't bake the strategy in at compile time, so future Java versions can change *how* lambdas are realized without breaking the bytecode.

`invokedynamic` is also used for:

- String concatenation (`"a" + b + "c"`) since Java 9, JEP 280.
- Pattern matching `switch` and record deconstruction since Java 21.
- Constant dynamic (`ConstantBootstraps`) since Java 11.

---

## 8. Reading a class with `javap -c -v`

`javap` is the JDK's bytecode disassembler. With `-c` it prints bytecode; `-v` adds the constant pool and method flags. Try it on anything:

```
$ javac Demo.java
$ javap -c -v Demo
```

Sample output for one method:

```
public void run();
  descriptor: ()V
  flags: (0x0001) ACC_PUBLIC
  Code:
    stack=2, locals=2, args_size=1
       0: new           #2     // class Dog
       3: dup
       4: invokespecial #3     // Method Dog."<init>":()V
       7: astore_1
       8: aload_1
       9: invokevirtual #4     // Method Animal.speak:()V
      12: return
```

What to look at:

- The **opcode column** (`new`, `dup`, `invokespecial`, `aload_1`, `invokevirtual`, `return`).
- The **constant-pool reference** (`#2`, `#3`, `#4`) — what symbolic name the bytecode points to.
- The **descriptor** (`:()V` = "no args, returns void"; `:(I)I` = "takes int, returns int").
- The **stack=N, locals=N** header — how many stack slots and local variables the method uses.

Once you can read three or four methods' worth of this, dispatch behaviour becomes mechanical: each call is exactly one of the five invokes, you can see which, and you can predict what runs.

---

## 9. `@Override` enforces a real override

A newcomer surprise: an `@Override` annotation isn't decorative. It tells `javac` to verify that the method actually overrides one in the parent. Without it, a typo silently becomes a *new* method:

```java
class Parent {
    public boolean equals(Object o) { return true; }
}

class Child extends Parent {
    public boolean equals(Child c) { return false; }   // NOT an override
}

// Caller:
Parent p = new Child();
p.equals(new Object());   // calls Parent.equals — returns true
```

`equals(Child)` is a *different* method from `equals(Object)`. There is no override; `invokevirtual` on `Parent.equals` resolves to the parent's body. Adding `@Override`:

```java
@Override public boolean equals(Child c) { ... }
```

makes `javac` fail with *method does not override or implement a method from a supertype*. Use `@Override` everywhere you intend to override.

---

## 10. `final` methods cannot be overridden

A `final` method is permanently bound to its declaring class. Subclasses cannot replace it.

```java
class Engine {
    public final int rpm() { return 800; }
}

class V8 extends Engine {
    public int rpm() { return 6000; }   // compile error: cannot override final
}
```

`javac` rejects the override. At the bytecode level, calls to a `final` method still emit `invokevirtual` (because the receiver is an instance), but the JIT knows the call is monomorphic by construction and inlines it as if it were `invokestatic`. We will explore this in [`senior.md`](./senior.md) and [`optimize.md`](./optimize.md). For now, the rule: marking a method `final` tells the compiler *and the JIT* that this method's body is its identity.

`private` methods are implicitly final — you can't override what you can't see. Static methods are not "overridden" either; a same-named static in a subclass *hides* the parent's static, and the call dispatches based on the compile-time type. None of these are virtual.

---

## 11. Common newcomer surprises

**Surprise 1 — `static` called via instance.**

```java
class C { static void hello() { } }
C c = new C();
c.hello();   // works, but it's NOT a virtual call
```

`javap -c` shows `invokestatic C.hello`. The receiver expression is evaluated for side effects, then discarded. Don't do this; it confuses readers into thinking dispatch happens.

**Surprise 2 — `private` is not virtual.**

```java
class Parent { private void log() { System.out.println("parent"); } public void run() { log(); } }
class Child extends Parent { private void log() { System.out.println("child"); } }

new Child().run();   // prints "parent"
```

`Parent.run` calls `log()` via `invokespecial`, not `invokevirtual`. `Child.log` is a different, unrelated method. This is exactly why `private` methods cannot be "overridden" — the bytecode never asks the receiver's class.

**Surprise 3 — `super.m()` is `invokespecial`, not `invokevirtual`.**

```java
class A { public void m() { System.out.println("A"); } }
class B extends A { public void m() { System.out.println("B"); super.m(); } }
class C extends B { public void m() { System.out.println("C"); super.m(); } }

new C().m();
// prints: C, B, A
```

Each `super.m()` is `invokespecial` pointing at the immediate parent's method. Even though `B.m()` is invoked on a `C` instance, `super.m()` from inside `B` always calls `A.m`. It is statically bound; no surprises.

**Surprise 4 — `invokeinterface` and a single implementer.**

A `List<String>` reference invokes `add` via `invokeinterface`, even if the runtime instance is always `ArrayList`. The compile-time type is `List`, so the bytecode is `invokeinterface`. The JIT figures out at runtime that only `ArrayList` ever shows up and inlines. The opcode is determined by the source-level *static* type, not by anything cleverer.

---

## 12. Quick rules

- [ ] One of five opcodes for every call. Memorize them: static / special / virtual / interface / dynamic.
- [ ] Compile-time decisions: static + special + virtual + interface. Runtime decision: dynamic (via bootstrap).
- [ ] Use `javap -c -v Foo` to see exactly which opcode is emitted — never guess.
- [ ] `@Override` everywhere you intend to override; it's free static checking.
- [ ] `final` and `private` methods are not virtual; the JIT inlines them.
- [ ] `super.m()` is always `invokespecial` — it doesn't look up the vtable.
- [ ] Calling a `static` method through an instance is legal but misleading; don't do it.
- [ ] Lambdas are created with `invokedynamic`; their actual `apply` / `run` call is normal `invokeinterface`.

---

## 13. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Reading `javap -c -v`, CHA, `invokedynamic` for lambdas     | `middle.md`        |
| Inline caches, deoptimization, megamorphic call sites       | `senior.md`        |
| Review vocabulary, ArchUnit, JFR for dispatch profiling     | `professional.md`  |
| JVMS §6.5 and §5.4.5 — where each opcode is defined         | `specification.md` |
| 10 buggy dispatch snippets and how to spot them             | `find-bug.md`      |
| Cost per opcode, CHA, sealed types, JMH benchmarks          | `optimize.md`      |
| Hands-on exercises with `javap`, JMH, `-XX:+PrintInlining`  | `tasks.md`         |
| 20 interview questions on dispatch internals                | `interview.md`     |

See also [../02-vtable-and-itable/](../02-vtable-and-itable/) for the underlying tables, and [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) for when virtual dispatch is the right tool at the *design* level.

---

**Memorize this:** five opcodes, one per call. `invokestatic` for `static`. `invokespecial` for `<init>`, `private`, and `super.m()` — statically bound. `invokevirtual` for normal class methods — virtually bound. `invokeinterface` for interface types — virtually bound through the itable. `invokedynamic` for bootstrapped sites — lambdas, string concat, pattern switches. Read the bytecode with `javap -c -v` and the picture is mechanical.
