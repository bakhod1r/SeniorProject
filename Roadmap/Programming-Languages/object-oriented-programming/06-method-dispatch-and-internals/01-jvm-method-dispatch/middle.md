# JVM Method Dispatch — Middle

> **What?** Reading `javap -c -v` output well enough to predict performance, understanding how the JIT performs class hierarchy analysis (CHA), recognising when a call site is monomorphic vs polymorphic, knowing how `final` and `sealed` give the JIT permission to inline, and tracing exactly how a lambda becomes bytecode via `invokedynamic`.
> **How?** Compile a class, run `javap -c -v`, then walk every `invoke*` and ask: what type does the constant pool reference, can a subclass intercept, and would the JIT have to consult a vtable? Once you can answer those for any call site by reading the disassembly, dispatch is no longer magic.

---

## 1. Why this matters once you're past basics

A junior knows the five opcodes. A middle-level developer knows *which one their code emitted, and why*. The reason this matters in day-to-day work is twofold.

First, **code review** — reviewers who can predict the bytecode shape of a change can call out a regression before profiling catches it. An interface with one production implementation that suddenly grew to four implementations changes every call site from monomorphic to megamorphic; the JIT goes from inlining everything to falling back to a real interface lookup. The diff looks innocent.

Second, **debugging** — when a method "doesn't get called" or "calls the wrong override", the answer is almost always at the bytecode level: a missing `@Override`, a `private` method shadowing a parent's, a `super.m()` going to the wrong ancestor. `javap -c -v` is the truth.

---

## 2. Refactoring toward monomorphic call sites

A call site is *monomorphic* if only one receiver class is ever seen at runtime, *bimorphic* if two are seen, and *megamorphic* if three or more are seen. HotSpot's C2 compiler inlines monomorphic and bimorphic calls aggressively; megamorphic calls fall back to a real vtable / itable lookup and the inlining cascade behind them collapses.

```java
// Megamorphic: any of dozens of formatters can flow through this call site.
public interface Formatter { String format(Event e); }

class Pipeline {
    public List<String> run(List<Event> events, Formatter f) {
        return events.stream().map(f::format).toList();
    }
}

// One site (`f::format`), many implementations of Formatter in production.
```

The first refactor is to give the JIT a stable type per call site:

```java
// Monomorphic per pipeline instance: each Pipeline holds one concrete formatter,
// the JIT specializes the type profile of `this.formatter` separately for each.
public final class Pipeline {
    private final Formatter formatter;
    public Pipeline(Formatter f) { this.formatter = f; }
    public List<String> run(List<Event> events) {
        return events.stream().map(formatter::format).toList();
    }
}
```

The shape is subtle: `formatter::format` still passes through the `Formatter` interface, so the call site type is `Formatter`. But because each `Pipeline` instance only ever holds one concrete formatter, HotSpot's *inline cache* keyed on the call site sees one type per `Pipeline`. Across many `Pipeline` instances with different concretes, the call site can still go megamorphic — but C2 can split the call site per inlining context, recovering monomorphism.

The second refactor is to make the concrete class `final`:

```java
public final class JsonFormatter implements Formatter { ... }
```

Once `JsonFormatter` is `final`, CHA proves no subclass can intercept. Even if the call site is typed as `Formatter`, the JIT can devirtualize if it can prove the receiver is always `JsonFormatter`.

---

## 3. Reading `javap -c -v` for a virtual call

Take a method that calls into a service:

```java
public class CheckoutFlow {
    private final PaymentMethod method;
    public CheckoutFlow(PaymentMethod method) { this.method = method; }
    public void run(BigDecimal amount) {
        method.charge(amount);
    }
}
```

`javap -c -v CheckoutFlow` (trimmed):

```
Constant pool:
   #2 = Class              #21       // PaymentMethod
   #3 = Methodref          #20.#22   // CheckoutFlow.method:LPaymentMethod;
   #4 = InterfaceMethodref #2.#23    // PaymentMethod.charge:(Ljava/math/BigDecimal;)V

public void run(java.math.BigDecimal);
  descriptor: (Ljava/math/BigDecimal;)V
  flags: (0x0001) ACC_PUBLIC
  Code:
    stack=2, locals=2, args_size=2
       0: aload_0
       1: getfield      #3         // Field method:LPaymentMethod;
       4: aload_1
       5: invokeinterface #4, 2    // InterfaceMethod PaymentMethod.charge
      10: return
```

Three facts the disassembly tells you:

- The constant pool slot `#4` is an *InterfaceMethodref* — the bytecode commits to interface dispatch through the itable. If `PaymentMethod` were an abstract class, the same slot would be a `Methodref` and the opcode would be `invokevirtual`.
- The `, 2` after `#4` is the argument-count operand (receiver + 1 BigDecimal). It is a historical artifact specified in JVMS §6.5.invokeinterface.
- The call site reads `method` from the field (instruction 1), pushes the argument (instruction 4), and dispatches (instruction 5). At the JIT level, after escape analysis confirms `method` is a `final` field, instruction 1 becomes a constant load — the receiver type is fixed for the lifetime of this `CheckoutFlow`.

---

## 4. Class Hierarchy Analysis (CHA) and `final` / `sealed`

CHA is HotSpot's static analysis of the loaded class hierarchy: at any moment during execution, the JIT knows which subclasses of a given class exist. If only one implementation of `Formatter` has been loaded, every `invokeinterface` on `Formatter` can be devirtualized to a direct call into that implementation. If a second implementation gets loaded later, the JIT *deoptimizes* the affected code (we cover this in [`senior.md`](./senior.md) and [`optimize.md`](./optimize.md)).

`final` and `sealed` make CHA's job easier:

```java
public final class JsonFormatter implements Formatter { ... }     // <-- final
```

With `final`, CHA doesn't need to scan the hierarchy — it knows by construction that no subclass exists. The JIT can devirtualize on the first compilation pass without setting up a deoptimization guard.

```java
public sealed interface Formatter permits JsonFormatter, CsvFormatter, XmlFormatter { ... }
```

With `sealed`, CHA still has to handle three subtypes, but the set is *closed*. C2 can emit a small type-switch chain (three `instanceof` checks) and inline each branch's body — known as a polymorphic inline cache. No fall-back to the itable.

A practical guideline: classes that you don't plan to subclass should be `final`. Interfaces that have a closed, known set of implementations should be `sealed`. Both are JIT hints with real runtime payoff. See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) for the design rationale.

---

## 5. Default methods at the bytecode level

A default method on an interface is an interesting case. The interface itself has a method body — but it must be invokable through any implementing class.

```java
public interface Counter {
    int value();
    default int doubled() { return value() * 2; }
}

public class Box implements Counter {
    private int n;
    public Box(int n) { this.n = n; }
    public int value() { return n; }
}

class Caller {
    void use() {
        Counter c = new Box(7);
        int x = c.doubled();
    }
}
```

`javap -c Caller`:

```
8: aload_1
9: invokeinterface #5, 1   // InterfaceMethod Counter.doubled:()I
```

Same `invokeinterface` you'd see for any method on `Counter`. The trick happens at *resolution time*: when the JVM resolves `Counter.doubled` for receiver `Box`, the itable search finds no override in `Box`, then climbs to `Counter`'s default and uses that body. Inside `default doubled()`, the call to `value()` is itself `invokeinterface Counter.value`, which resolves to `Box.value`.

The dispatch story is: default methods are looked up exactly the same way as any other interface method; the only difference is that the lookup may *land* on the interface itself rather than a class. This is governed by JVMS §5.4.3.4 (interface method resolution) and §5.4.5 (selection of an instance method).

---

## 6. Lambdas and `invokedynamic` in depth

Compile this:

```java
public class Lambdas {
    public Runnable make() {
        return () -> System.out.println("hi");
    }
}
```

`javap -c -v Lambdas` (trimmed):

```
public java.lang.Runnable make();
  Code:
       0: invokedynamic #2, 0  // InvokeDynamic #0:run:()Ljava/lang/Runnable;
       5: areturn

BootstrapMethods:
  0: #21 REF_invokeStatic java/lang/invoke/LambdaMetafactory.metafactory:(...)
    Method arguments:
      #22 ()V
      #23 REF_invokeStatic Lambdas.lambda$make$0:()V
      #22 ()V
```

What's happening:

1. **`invokedynamic #2, 0`** — calls into the bootstrap method at *BootstrapMethods #0*.
2. The bootstrap method is `LambdaMetafactory.metafactory`. The JVM passes it the call-site descriptor (return type `Runnable`), the functional interface's method signature (`run()V`), the target method handle (`lambda$make$0`), and the dynamic-invocation signature.
3. `LambdaMetafactory` synthesizes a class at runtime (via `Unsafe.defineAnonymousClass` historically, or `MethodHandles.Lookup.defineHiddenClass` since Java 15) that implements `Runnable` and delegates `run` to `lambda$make$0`.
4. The bootstrap returns a `CallSite` holding a `MethodHandle` to a constructor for that synthetic class. The JVM caches the call site — every subsequent execution of this `invokedynamic` instruction reuses the cached `MethodHandle`.

The synthetic method `lambda$make$0` is a private static method `javac` generated in `Lambdas`:

```
private static void lambda$make$0();
  Code:
       0: getstatic     #4 // Field java/lang/System.out
       3: ldc           #5 // String hi
       5: invokevirtual #6 // Method java/io/PrintStream.println:(...)V
       8: return
```

The lambda body is just a normal method, called through a generated `Runnable` adapter. The dispatch story for `r.run()` afterwards is plain `invokeinterface Runnable.run` — the synthetic class implements it, the JIT inlines it once the call site is monomorphic on the synthetic type.

`invokedynamic`'s point is **decoupling**: the bytecode does not name a specific implementation strategy for lambdas. If a future Java release decides lambdas should be implemented differently (e.g., as value classes once Valhalla ships), the `.class` files don't change — only `LambdaMetafactory` does. See [JEP 181](https://openjdk.org/jeps/181) for the original design.

---

## 7. String concatenation via `invokedynamic`

A modest example shows how `+` on strings looks since Java 9 (JEP 280):

```java
public String greet(String name, int age) {
    return "Hello, " + name + "! Age " + age;
}
```

`javap -c -v`:

```
0: aload_1
1: iload_2
2: invokedynamic #2, 0
                  // InvokeDynamic #0:makeConcatWithConstants:(Ljava/lang/String;I)Ljava/lang/String;
7: areturn

BootstrapMethods:
  0: #19 REF_invokeStatic
    java/lang/invoke/StringConcatFactory.makeConcatWithConstants:(...)
    Method arguments:
      #20 Hello, ! Age 
```

The bootstrap is `StringConcatFactory.makeConcatWithConstants`. The recipe string `Hello, ! Age ` tells the factory how to interleave the constants and the dynamic arguments. The factory builds (and caches) a MethodHandle that does the right concatenation, sized for these particular argument types. Before Java 9, the same code emitted a `StringBuilder` chain — now it's a single `invokedynamic` and the JIT picks the best strategy. See [JEP 280](https://openjdk.org/jeps/280) for details.

---

## 8. CHA across modules and ClassLoaders

CHA's invariant — *I know every loaded subclass* — has a subtlety: the JIT only knows subclasses *that have been loaded so far*. New classes can arrive at any time:

- A user-defined `ClassLoader` defines a new class.
- A modular app loads a service implementation via `ServiceLoader`.
- A dynamic agent attaches at runtime.

When a new class loads that subclasses a class CHA already optimised against, HotSpot **invalidates** the affected compiled code and falls back to the interpreter for that method until a new compilation reflects the updated hierarchy. This is called **deoptimization**. The senior file covers the mechanics; here, just note that CHA-based devirtualization is *speculative* — it can be undone.

The takeaway for middle-level code: prefer `final` and `sealed` for receivers in hot paths. They give the JIT a *non-speculative* guarantee — no future class load can invalidate the assumption.

---

## 9. A worked refactor — open hierarchy to sealed

Suppose you have:

```java
public abstract class Event {
    public abstract void handle();
}
public class LoginEvent  extends Event { public void handle() { ... } }
public class LogoutEvent extends Event { public void handle() { ... } }
public class ClickEvent  extends Event { public void handle() { ... } }

public void process(List<Event> events) {
    for (Event e : events) e.handle();
}
```

Three concretes, no `final`, no `sealed`. The call site `e.handle()` is `invokevirtual Event.handle`. The JIT sees three receiver types — it goes polymorphic with an inline cache for three types. C2 can still inline up to two types via bimorphic inlining; the third type falls back to a vtable call.

Refactor:

```java
public sealed abstract class Event permits LoginEvent, LogoutEvent, ClickEvent {
    public abstract void handle();
}
public final class LoginEvent  extends Event { public void handle() { ... } }
public final class LogoutEvent extends Event { public void handle() { ... } }
public final class ClickEvent  extends Event { public void handle() { ... } }
```

Two changes: `sealed` on the abstract, `final` on every concrete. The bytecode of `process` is unchanged — still `invokevirtual Event.handle`. But CHA now knows the entire hierarchy is closed at three implementers, and each implementer is `final`. C2 emits a fast type-switch and inlines all three `handle` bodies directly into the loop. We will measure the speedup with JMH in [`optimize.md`](./optimize.md); typical numbers are 2-3× throughput on a tight loop.

---

## 10. Patterns that go megamorphic by accident

Three recurring shapes that turn a once-fast call site into a megamorphic one:

**Pattern 1 — a shared utility called from many sites.**

```java
public final class Logger {
    public void log(LogFormatter f, Event e) {
        out.println(f.format(e));
    }
}
```

Every caller passes a different `LogFormatter`. The single call site `f.format(e)` sees every implementation. Fix: parameterize on the concrete formatter (one class per caller), or push the call site into the caller.

**Pattern 2 — a stream chain in shared code.**

```java
events.stream().map(transformer::apply).filter(filter::test).forEach(handler::accept);
```

`transformer`, `filter`, and `handler` come from outside. Inside the stream's pipeline, the three call sites for `apply`, `test`, and `accept` accumulate types across every caller. Inlining collapses. Fix: build the stream inside the class that owns the concrete functions, not a shared utility.

**Pattern 3 — a heterogeneous collection.**

```java
List<Animal> zoo = List.of(new Dog(), new Cat(), new Bear(), new Lion());
for (Animal a : zoo) a.speak();
```

A loop over a heterogeneous collection naturally goes megamorphic on the call site. Sometimes that's fine; sometimes the right move is to group by concrete type first and run a tight loop per group. The JIT can't do this grouping for you.

---

## 11. Bytecode trail of an `equals` call

`equals` is a good study because every class has it and the dispatch is non-obvious:

```java
boolean same(String a, Object b) {
    return a.equals(b);
}
```

`javap -c`:

```
0: aload_1
1: aload_2
2: invokevirtual #2  // Method java/lang/String.equals:(Ljava/lang/Object;)Z
5: ireturn
```

The constant pool slot resolves to `String.equals`, not `Object.equals`. Why? Because at compile time, `a` is typed as `String`, and `String` overrides `equals`. `javac` picks the most specific declaring class it can see. At runtime, `invokevirtual` still looks up the actual class's vtable slot — but here `String` is `final`, so no surprise is possible.

Now flip it:

```java
boolean same(Object a, Object b) {
    return a.equals(b);
}
```

```
0: aload_1
1: aload_2
2: invokevirtual #2  // Method java/lang/Object.equals:(Ljava/lang/Object;)Z
5: ireturn
```

Same opcode, but the constant pool points at `Object.equals`. The vtable lookup at runtime selects the *actual* class's override (which is what you wanted). Both forms produce the same observable behaviour; the bytecode shape differs only in which class is named statically.

---

## 12. Tools beyond `javap`

`javap` is the starting point. For deeper analysis:

- **`-XX:+PrintInlining`** (requires `-XX:+UnlockDiagnosticVMOptions`) — logs every inlining decision the JIT makes. You'll see lines like `Method::foo (4 bytes) inline (hot)` or `(too big)` or `(virtual call)`. Tasks 6 in [`tasks.md`](./tasks.md) walks through reading this output.
- **`-XX:+PrintCompilation`** — logs each compilation event and deoptimization. Cheap and fast; useful for spotting deoptimization cascades.
- **`async-profiler`** or **JFR** — both can sample call-site profiles and show you the live distribution of receiver types per call site. Megamorphism becomes visible.
- **JOL (Java Object Layout)** — for `instanceof` and vtable internals; useful but adjacent.

These tools live at the professional level, but knowing they exist saves hours of guessing once you reach a performance problem the bytecode alone doesn't explain.

---

## 13. Quick rules

- [ ] When in doubt, run `javap -c -v ClassName` and read the actual bytecode.
- [ ] Prefer `final` on concrete classes and `sealed` on closed hierarchies — both help CHA.
- [ ] A hot call site that sees one or two receiver types is essentially free; three or more pays vtable / itable cost.
- [ ] Default methods dispatch through the itable; they're not statically bound.
- [ ] Lambdas are bytecode-cheap: one `invokedynamic` to make, one `invokeinterface` to call.
- [ ] String concatenation since Java 9 uses `invokedynamic` and `StringConcatFactory` — don't manually `StringBuilder` short concatenations.
- [ ] CHA is speculative — new class loads can deoptimize hot code. `final` / `sealed` make CHA's assumptions permanent.
- [ ] If a stream pipeline sees many concrete functions, build the pipeline near the concretes, not in shared infrastructure.

---

## 14. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Inline caches, deoptimization, megamorphic profiling           | `senior.md`        |
| Code review vocabulary, ArchUnit, JFR for dispatch             | `professional.md`  |
| JVMS §6.5 + §5.4.5; JEP 181, 280, 309                          | `specification.md` |
| 10 buggy dispatch snippets                                     | `find-bug.md`      |
| Cost per opcode, CHA, sealed types, JMH                        | `optimize.md`      |
| Hands-on exercises                                             | `tasks.md`         |
| 20 interview questions                                         | `interview.md`     |

See also [../02-vtable-and-itable/](../02-vtable-and-itable/) for the table layout the JIT walks at each call site.

---

**Memorize this:** the bytecode commits to a dispatch *strategy* (one of the five opcodes); the runtime + JIT decide the *target* and how cheaply to reach it. CHA, `final`, and `sealed` give the JIT permission to skip the table lookup. Megamorphic call sites are the failure mode — they don't show up in the bytecode, only in the receiver-type distribution at runtime. Read disassembly first, profile second; don't guess.
