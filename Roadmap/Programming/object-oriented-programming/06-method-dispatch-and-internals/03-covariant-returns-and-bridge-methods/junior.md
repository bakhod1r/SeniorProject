# Covariant Returns and Bridge Methods — Junior

> **What?** A *covariant return type* is the feature, added in Java 5, that lets a subclass override a method with a *more specific* return type than the parent declared. `Object.clone()` returns `Object`, but `Dog.clone()` may be declared to return `Dog`. A *bridge method* is a synthetic helper the compiler quietly generates so that the JVM can keep dispatching through the parent's signature even when the subclass advertised a narrower one.
> **How?** Write the override with the narrower type; let `javac` add the bridge for you. Then run `javap -p -v` on the class file and look for the second method with `flags: ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC` — that's the bridge. It just casts the result and forwards to the real method.

---

## 1. The feature in one example

Pre-Java 5, every override had to repeat the parent's exact return type. That meant downcasts everywhere:

```java
class Animal {
    public Animal copy() { return new Animal(); }
}

class Dog extends Animal {
    @Override public Animal copy() { return new Dog(); }   // forced to return Animal
}

// Caller pays for the design:
Dog d  = new Dog();
Dog d2 = (Dog) d.copy();    // cast or compile error
```

Java 5 added *covariant returns* (JLS §8.4.5). The subclass override may return a *subtype* of the parent's return type — anything assignable to it:

```java
class Animal {
    public Animal copy() { return new Animal(); }
}

class Dog extends Animal {
    @Override public Dog copy() { return new Dog(); }      // narrower return, legal
}

Dog d  = new Dog();
Dog d2 = d.copy();          // no cast — the compiler already knows it's a Dog
```

The caller's code is cleaner. The override still *substitutes* for the parent (you can still call `Animal a = new Dog(); a.copy();` and get back something that *is-a* `Animal`), so Liskov holds.

---

## 2. Why this is useful

Three places where covariant returns earn their keep:

- **Cloning.** `Object.clone()` returns `Object`. Without covariant returns, every `clone()` site outside the implementor's package needs a cast.
- **Builders and fluent APIs.** A `PersonBuilder` extending a generic `Builder` can return `PersonBuilder` from each setter so the chain stays typed.
- **Factory methods.** `AbstractFactory.create()` may return `Product`; `CarFactory.create()` can return `Car`, removing one cast at every call site.

The point is *not* that the new return type tells the JVM anything different. The JVM doesn't care — at the bytecode level, dispatch still works by the parent's signature. The point is that *the compiler* now knows the more specific type and threads it through every caller.

---

## 3. The first surprise — there are two methods in the class file

Compile the `Dog` class above and run `javap -p -v Dog`. You will see *two* methods named `copy`:

```
public Dog copy();
  descriptor: ()LDog;
  flags: (0x0001) ACC_PUBLIC
  Code:
    0: new           #2    // class Dog
    3: dup
    4: invokespecial #3    // Method Dog."<init>":()V
    7: areturn

public Animal copy();
  descriptor: ()LAnimal;
  flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
  Code:
    0: aload_0
    1: invokevirtual #4    // Method copy:()LDog;
    4: areturn
```

The first one is the method you wrote — it returns `Dog`. The second one is a **bridge method**: a synthetic helper the compiler generated. Its signature matches `Animal.copy()` (return type `Animal`), so the JVM can dispatch the parent's slot. Its body just calls the real `copy()` you wrote and returns the result. No cast is needed in the bytecode because `Dog` is already assignable to `Animal` — `areturn` is fine.

The flags `ACC_BRIDGE | ACC_SYNTHETIC` mark it as compiler-generated; the JVM uses them to skip the method in certain contexts (and so should you when reflecting).

---

## 4. Why the compiler needs the bridge

Java's overriding rules historically required *the same exact descriptor* — same parameter types *and* same return type. The JVM still uses the *descriptor* to find a slot in the vtable (see [../02-vtable-and-itable/](../02-vtable-and-itable/)). If `Dog.copy()` had only the descriptor `()LDog;` and `Animal.copy()` had `()LAnimal;`, those are *two different slots* — there would be no override happening at the JVM level.

The bridge bridges that gap. There are two methods in `Dog`:

- `()LDog;` — the real one, the one your source wrote.
- `()LAnimal;` — the bridge, generated to match the parent's descriptor.

At the JVM level, the bridge is what *overrides* `Animal.copy()`. The bridge then forwards to the real one via `invokevirtual`. Callers on an `Animal` reference end up in the bridge, which calls the real one; callers on a `Dog` reference go straight to the real one because `javac` resolved `Dog.copy()` to descriptor `()LDog;` at compile time.

---

## 5. Common confusion — "Why are there two methods?"

Three confusions trip newcomers:

**"I wrote one method, the class file shows two."** That second one is the bridge; you didn't write it; you can't avoid it; it is correct. Don't try to remove it.

**"Reflection sees two methods with the same name."** `Dog.class.getDeclaredMethods()` returns both. Filter with `Method.isBridge()` if you only want what you wrote:

```java
for (Method m : Dog.class.getDeclaredMethods()) {
    if (m.isBridge()) continue;
    System.out.println(m);
}
```

**"`@Override` complains about one but not the other."** You only see the real method in source; `@Override` applies to it; the bridge is invisible to source code. That's intentional.

---

## 6. The same mechanism shows up with generics

Even when *you* don't write a narrower return type, the compiler may still need a bridge — generics erase to `Object`, so a subclass overriding `compareTo(T)` ends up with `compareTo(MyType)` in source and `compareTo(Object)` in bytecode-from-the-parent's-view:

```java
public class Score implements Comparable<Score> {
    private final int value;
    public Score(int v) { this.value = v; }
    @Override public int compareTo(Score other) {
        return Integer.compare(value, other.value);
    }
}
```

`Comparable` itself, after erasure, has `compareTo(Object)`. So `Score` needs a `compareTo(Object)` bridge that casts to `Score` and forwards. We will look at the `javap` output for this in the next file.

---

## 7. The mental model to walk away with

- **Covariant returns** are a *source-language* convenience: you write the narrower type, callers see the narrower type, no cast at the call site.
- **Bridge methods** are a *bytecode-level* necessity: the JVM dispatches by descriptor; the compiler synthesises a method with the parent's descriptor so the override actually overrides.
- **You don't write them; you read them.** `javap -p -v` is the tool.
- **Reflection sees them.** That can cause real bugs in frameworks; we cover them at the senior level.

For now, when you see `ACC_BRIDGE` in `javap` output, you know exactly what happened: a covariant return (or a generic type parameter erased to something wider) forced the compiler to add a forwarder.

---

## 8. Quick rules

- [ ] Covariant returns are legal since Java 5 (JLS §8.4.5). The override's return type must be a subtype of the parent's.
- [ ] The compiler generates a *bridge method* with the parent's return type that forwards to your real method.
- [ ] Bridges carry the flags `ACC_BRIDGE | ACC_SYNTHETIC`. They are visible in `javap -p -v` and via reflection.
- [ ] Filter bridges out with `Method.isBridge()` when introspecting.
- [ ] Generics on a subclass usually create a bridge too — `compareTo(Object)` forwarding to `compareTo(MyType)`.
- [ ] Never try to remove or replace the bridge by hand; it is required for correct dispatch.

---

## 9. What's next

| Topic                                                              | File                |
| ------------------------------------------------------------------ | ------------------- |
| Reading `javap -v` for bridges; generics + Comparable in detail    | `middle.md`         |
| Erasure, reflection bugs, vtable slots, MethodHandle behaviour     | `senior.md`         |
| Code review, Mockito's bridge handling, ArchUnit checks            | `professional.md`   |
| JLS §8.4.5, JVMS §4.6, ACC_BRIDGE, Method.isBridge                 | `specification.md`  |
| Ten realistic bugs caused by bridge methods                        | `find-bug.md`       |
| Bridge invocation cost, JIT inlining, reflection filter cost       | `optimize.md`       |
| Hands-on exercises with `javap`, reflection, Mockito               | `tasks.md`          |
| Interview Q&A                                                      | `interview.md`      |

---

**Memorize this:** *covariant return* = subclass returns a more specific type; *bridge method* = synthetic forwarder with the parent's signature that makes the override real at the JVM level. You write one method, `javap` shows two, reflection finds two — that is correct and intentional.
