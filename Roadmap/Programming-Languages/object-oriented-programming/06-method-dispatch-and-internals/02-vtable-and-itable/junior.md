# vtable and itable — Junior

> **What?** A *vtable* (virtual method table) is a per-class array of method pointers the JVM uses to resolve `invokevirtual` calls. An *itable* (interface method table) is a per-interface lookup table used by `invokeinterface`. Both live inside HotSpot's `Klass` metadata in metaspace. Together they are the runtime machinery that turns `animal.speak()` into "call the right `speak` for whichever concrete class `animal` actually is".
> **How?** Each class loaded by the JVM gets a `Klass` structure. The `Klass` contains, among other things, a vtable (one slot per overridable method, including inherited ones) and an itable for each interface the class implements. `invokevirtual` becomes a fixed-offset array load: `vtable[slot]`. `invokeinterface` is a search into the right itable, accelerated by an inline cache at the call site.

---

## 1. The point of vtables and itables in one paragraph

When you write `shape.area()`, the JVM doesn't decide *at compile time* which `area()` runs — it depends on the actual class of `shape` at runtime. To make that decision fast, HotSpot doesn't search through the class's methods on every call. Instead, it builds a small array of method pointers per class — the vtable — and resolves `area()` to a *fixed index* into that array. At runtime, dispatch is just two memory loads: load the object's class pointer, then load the method at the precomputed slot. Itables do the same job for interface calls, with one extra step because a class may implement many interfaces.

This is the same idea C++ compilers use for `virtual` methods. The difference is that in Java the table is built by the JVM during class loading, not by the compiler at link time.

See [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) for the bytecode-level picture and [../04-object-memory-layout/](../04-object-memory-layout/) for how the `Klass` pointer sits in every object's header.

---

## 2. A simple vtable example — `Animal` hierarchy

```java
class Animal {
    public void speak()  { System.out.println("..."); }
    public void sleep()  { System.out.println("zzz"); }
}
class Dog extends Animal {
    @Override public void speak() { System.out.println("woof"); }
}
class Cat extends Animal {
    @Override public void speak() { System.out.println("meow"); }
}
```

Conceptually, after class loading, the vtables look like:

```
Animal.vtable    [0]=Animal.speak    [1]=Animal.sleep
Dog.vtable       [0]=Dog.speak       [1]=Animal.sleep   (inherited at same slot)
Cat.vtable       [0]=Cat.speak       [1]=Animal.sleep
```

The crucial property: `speak` lives at **slot 0** in every class in the hierarchy. When you call `animal.speak()` and `animal` happens to be a `Dog`, the JVM doesn't search — it loads `Dog`'s vtable and reads slot 0. The slot is decided once, when `Animal` is loaded; every subclass inherits the layout.

`sleep` is not overridden, so `Dog.vtable[1]` and `Cat.vtable[1]` both point back at `Animal.sleep`. The slot exists in every subclass even if it isn't overridden, because the parent must work too — code that has a `Animal a = new Dog()` and calls `a.sleep()` reads slot 1, and slot 1 had better contain *something*.

---

## 3. An everyday analogy — the elevator panel

Imagine an office building with floors 1 to 10. The elevator panel has a button for each floor. You don't "search" for floor 7 — you press the button at the known position, and the elevator goes. Now imagine a renovation adds a new wing on floors 5 and 6; the existing buttons keep working because the panel layout didn't change. New buttons (e.g., a "spa" button on floor 11) are *appended*.

That's the vtable. Existing slots are stable across inheritance; subclasses can override what a slot does (the destination behind the button), and new methods declared in subclasses get *new* slots appended.

---

## 4. itables — when interfaces enter the picture

An interface is not a class — it doesn't have a fixed slot in your class's vtable, because a class can implement many interfaces (`ArrayList implements List, RandomAccess, Cloneable, Serializable`). Each interface has its own table of methods, and each class implementing the interface keeps a per-interface mapping from "interface method" to "class method".

```java
interface Greeter { void greet(); }
interface Sweeper { void sweep(); }

class Robot implements Greeter, Sweeper {
    public void greet() { System.out.println("hello"); }
    public void sweep() { System.out.println("brush brush"); }
}
```

Conceptually:

```
Robot has two itables:
  itable for Greeter:  [0]=Robot.greet
  itable for Sweeper:  [0]=Robot.sweep
And the regular vtable contains Robot.greet and Robot.sweep too,
because they are concrete instance methods on Robot.
```

When you call `((Greeter) robot).greet()`, the JVM:

1. Looks up which itable belongs to `Greeter` (a small per-class search).
2. Reads slot 0 of that itable.
3. Calls the resulting method.

That's slower than a vtable call. HotSpot solves this by *caching* the result at the call site (an inline cache) so the second call onward is almost as fast as `invokevirtual`. We will see that in `middle.md`.

---

## 5. What lives in vtables vs not

Not every method goes into the vtable. The rule is "only methods that can actually be overridden". HotSpot uses static dispatch (no vtable) for:

- `private` methods — no subclass can see them, so there's nothing to override.
- `static` methods — they belong to the class, not the instance; resolved at link time.
- `final` methods — declared non-overridable.
- Constructors — never inherited.
- Methods on a `final` class — the whole class is closed.

Common newcomer question: **"Where do private methods go?"** They live in the class's method table (the `Klass` has all methods, public and private), but they are *not* given vtable slots. `invokeprivate`-style calls (actually `invokespecial` in bytecode) go straight to the method address — no array lookup. Same for `invokestatic` and constructor `invokespecial`.

```java
class Calculator {
    public  int  add(int a, int b)    { return a + b; }   // vtable slot
    private int  doubleIt(int x)      { return x * 2; }   // NOT in vtable
    static  int  zero()                { return 0; }       // NOT in vtable
    public final int answer()         { return 42; }      // NOT in vtable
}
```

---

## 6. Why this matters even at junior level

You almost never look at vtables directly. You don't need to. But a *mental model* of vtables explains things that otherwise look like magic:

- Why dispatch is fast despite Java being "polymorphic by default".
- Why overriding `equals` works even when the variable is typed `Object`.
- Why marking a method `final` is sometimes a real micro-optimization (no vtable indirection).
- Why deep inheritance hierarchies have a class-loading cost (each subclass builds a full vtable copy).
- Why a class with twenty interfaces costs more at startup than a class with one.

When a coworker says "the JIT will devirtualize this", they're saying "the JIT can prove the vtable slot has only one possible target and can call it directly, skipping the array load". That conversation is unintelligible without the vtable picture.

---

## 7. Common newcomer confusions

**Confusion 1: "Does an `@Override` method get a new slot?"**

No. It *reuses* the parent's slot. That's the whole point: slot N means "method N" across the hierarchy, and overriding means "replace what's at slot N for this class". A new method declared in the subclass (not overriding anything) gets an appended slot.

**Confusion 2: "Where does `Object.toString()` sit?"**

In a fixed slot near the start of every class's vtable, inherited from `Object`. That's why `myObj.toString()` works on every Java object — the slot is reserved in `Object.vtable` and inherited by every class.

**Confusion 3: "Are vtables in the object?"**

No — the object header only contains a pointer to the `Klass` (its class metadata), and the `Klass` holds the vtable. Putting the vtable in every object would waste memory.

**Confusion 4: "Records — do they have vtables?"**

Records are implicitly `final`. Their methods still go into a vtable for `Record` and `Object` inherited entries, but no subclass will ever override them, so the JIT freely devirtualizes.

**Confusion 5: "Lambdas and method references?"**

Each lambda is a tiny class implementing a functional interface. It has its own vtable + an itable for the functional interface. The JIT inlines them aggressively, but the underlying machinery is the same as any other class.

---

## 8. Quick rules

- [ ] vtable = per-class array of method pointers; one slot per overridable method.
- [ ] itable = per-interface table; one per interface a class implements.
- [ ] `invokevirtual` is an array load at a fixed slot; `invokeinterface` is a slower lookup, cached at the call site.
- [ ] `private`, `static`, `final`, and constructor methods do NOT go in the vtable.
- [ ] Subclasses share the parent's vtable layout — overriding *replaces* a slot, never appends to it.
- [ ] Each `Klass` in metaspace owns its vtable and itables; the object header just points to the `Klass`.

---

## 9. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Vtable layout across deeper hierarchies, itable mechanics   | `middle.md`        |
| Class loading, secondary super check, bridge methods        | `senior.md`        |
| Mentoring, tooling, ArchUnit guardrails                     | `professional.md`  |
| JVMS section references, HotSpot source pointers            | `specification.md` |
| Buggy dispatch patterns and how they surface                | `find-bug.md`      |
| Cost models, devirtualization, benchmarking                 | `optimize.md`      |
| Hands-on HSDB + JOL + JMH exercises                         | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the vtable is "an array of method pointers per class, indexed by slot"; the itable is "the same idea per interface, with a lookup step on top". `invokevirtual` is two cache-line loads; `invokeinterface` is a few more plus a cached lookup. Every other detail in this section is a refinement of those two sentences.
