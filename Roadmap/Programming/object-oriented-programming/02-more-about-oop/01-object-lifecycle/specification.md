# Object Lifecycle — Specification Deep-Dive

> Where the rules actually live: **JLS §12.4** (initialization of classes), **JLS §12.5** (creation of new class instances), **JLS §17.5** (final field semantics), **JVMS §5** (loading, linking, initialization), **JVMS §6.5** (`new` and related instructions), and **java.lang.ref** Javadoc for reachability.

---

## 1. Where to find the canonical text

| Concept                                  | Authoritative source                                  |
|------------------------------------------|-------------------------------------------------------|
| Class initialization triggers            | **JLS §12.4.1** — *When Initialization Occurs*        |
| Detailed initialization procedure        | **JLS §12.4.2** — twelve-step state machine           |
| Instance creation                        | **JLS §12.5**                                         |
| Constructor declarations                 | **JLS §8.8**                                          |
| Instance initializers                    | JLS §8.6                                              |
| Static initializers                      | JLS §8.7                                              |
| Final field semantics                    | **JLS §17.5**                                         |
| Class file format (`<init>`, `<clinit>`) | **JVMS §2.9.1, §2.9.2**                              |
| `new` bytecode                            | JVMS §6.5.new                                        |
| Verifier rules for ctors                 | JVMS §4.10.2.4 (uninitializedThis)                   |
| Loading/linking/initialization machinery | **JVMS §5**                                          |
| Garbage collection (informative)         | JVMS §3.5.5                                          |
| `java.lang.ref` reachability             | `java.lang.ref` package Javadoc                      |

---

## 2. JLS §12.4.1 — when class initialization occurs

A class or interface `T` is initialized just before the first occurrence of any of:

> - `T` is a class and an instance of `T` is created.
> - A static method declared by `T` is invoked.
> - A static field declared by `T` is assigned.
> - A static field declared by `T` is used and the field is **not** a constant variable (§4.12.4).
> - `T` is a top-level class (§7.6) and an assert statement (§14.10) lexically nested within `T` (§8.1.3) is executed.

Subclass initialization implicitly initializes superclasses, but **not** superinterfaces unless they declare default methods.

### Constant variable exception

> A *constant variable* (JLS §4.12.4) is a `final` variable of primitive type or type `String` that is initialized with a constant expression.

Reading such a variable does **not** initialize the class — `javac` inlines the constant.

```java
class Loader {
    static { System.out.println("init"); }
    static final int X = 42;        // constant variable
    static final String S = "hi";   // constant variable
    static final Integer I = 42;    // NOT a constant variable (boxed)
}

System.out.println(Loader.X);   // does NOT trigger init — prints 42
System.out.println(Loader.I);   // triggers init — prints "init" then 42
```

This is a common gotcha when configuration is held in `static final` boxed types.

---

## 3. JLS §12.4.2 — the twelve-step initialization procedure

Quoting the spec (paraphrased and condensed):

> 1. Synchronize on the initialization lock `LC` for class `C`.
> 2. If `C`'s state is "being initialized by current thread" → release lock, complete recursively.
> 3. If `C`'s state is "being initialized by some other thread" → wait, then go to 1.
> 4. If `C`'s state is "initialized" → release lock, return.
> 5. If `C`'s state is "erroneous" → release lock, throw `NoClassDefFoundError`.
> 6. Mark `C` as "being initialized by current thread". Release lock.
> 7. If `C` is a class (not interface), recursively initialize its direct superclass and any superinterfaces declaring default methods.
> 8. If exception during step 7 → re-acquire lock, mark `C` erroneous, notify waiters, release, propagate.
> 9. Determine assertions enabled (informative).
> 10. Execute either `<clinit>` or perform field initialization in textual order. If exception → re-acquire lock, mark erroneous, notify, release, propagate.
> 11. Re-acquire lock, mark `C` as fully initialized, notify waiters, release.
> 12. Done.

This algorithm is what guarantees **at-most-once** initialization across threads. It's also why reflection can observe `Class.isInitialized()` correctly.

---

## 4. JLS §12.5 — instance creation procedure

The twelve-step procedure for `new C(args)`:

> 1. Resolve and check that `C` is accessible.
> 2. Verify `C` is not abstract; otherwise `InstantiationError`.
> 3. Initialize `C` per §12.4 (if not already initialized).
> 4. Allocate space for new instance of `C`. If insufficient → `OutOfMemoryError`.
> 5. Initialize all fields to default values (§4.12.5).
> 6. Evaluate the arguments to the constructor, left to right.
> 7. Select the constructor of `C` to invoke (per §15.12.2 / §15.9.3 if implicit).
> 8. The selected constructor is invoked with `this` bound to the new instance.
>    a. Assign argument values to formal parameters.
>    b. If the first statement is an alternate constructor invocation (`this(...)`), evaluate per §15.9.3 and recurse on step 8.
>    c. Otherwise: implicit or explicit superclass invocation (`super(...)`) is processed.
>    d. Execute instance initializers and instance variable initializers in textual order.
>    e. Execute the rest of the constructor body.
> 9. The result is a reference to the new instance.

This is why **field initializers run after `super(...)` returns but before the constructor body** — they're step 8d, between 8c and 8e.

---

## 5. JLS §8.8 — constructors

Key rules:

- A constructor is invoked by `new`. It cannot be invoked directly otherwise.
- Constructor body may begin with an explicit constructor invocation (`super(...)` or `this(...)`); otherwise an implicit `super()` is inserted.
- Constructors cannot return a value; the return type is implicit and absent.
- A constructor that does not start with an explicit invocation but whose superclass has no accessible no-arg constructor is a compile error.
- A constructor can throw checked exceptions if declared.

Default constructor (§8.8.9) is provided when a class has none declared:

> The default constructor takes no parameters and simply invokes `super()`. It has the same access modifier as the class itself.

---

## 6. JLS §17.5 — final field semantics

The pivotal paragraph:

> An object is considered to be **completely initialized** when its constructor finishes. A thread that can only see a reference to an object after that object has been completely initialized is guaranteed to see the correctly initialized values for that object's `final` fields.
>
> The usage model for final fields is a simple one: Set the final fields for an object in that object's constructor; do not write a reference to the object being constructed in a place where another thread can see it before the object's constructor is finished. If this is followed, then when the object is seen by another thread, that thread will always see the correctly constructed version of that object's final fields.

The mechanism: the JVM emits a *freeze* action at the end of `<init>` for every final field. After the freeze, any subsequent read of the field (transitively, by any thread) sees the constructed value.

**Crucial**: this guarantee only applies if the reference doesn't escape during construction. Leaking `this` from the constructor invalidates the freeze guarantee for any thread that observes the leak.

---

## 7. JVMS §2.9 — `<init>` and `<clinit>`

Names with angle brackets are reserved by the JVM for these special methods:

> A class or interface has at most one `<clinit>` method, which is invoked by the JVM to perform class initialization. The method is implicit; it is not declared in source code.

> Each class has zero or more `<init>` methods, one per constructor. They are invoked by `invokespecial` after `new`.

The verifier (JVMS §4.10.2.4) enforces:
- An uninitialized class instance type, denoted `uninitialized(addr)`, where `addr` is the offset of the `new` instruction.
- This type cannot be passed to most operations; it can only be the target of `invokespecial <init>`.
- After `invokespecial`, all stack and local slots holding `uninitialized(addr)` are replaced with the initialized class type.

This is why `new Foo()` is two distinct verifier states separated by `invokespecial`.

---

## 8. JVMS §6.5 — the `new` bytecode

```
new
Operation: Create new object
Format:    new
           indexbyte1
           indexbyte2

Stack:     ... → ..., objectref

Description:
  The unsigned indexbyte1 and indexbyte2 are used to construct an index
  into the run-time constant pool of the current class, where the value
  must be a symbolic reference to a class or interface type. The named
  class or interface is resolved (§5.4.3.1) and should result in a class
  type. Memory for a new instance of that class is allocated from the
  garbage-collected heap, and the instance variables of the new object
  are initialized to their default initial values. The objectref, a
  reference to the instance, is pushed onto the operand stack.
```

The `new` instruction does **not** call any constructor. It only allocates and zero-fills. The constructor call is a separate `invokespecial`.

---

## 9. The default initialization values (JLS §4.12.5)

> Each class variable, instance variable, or array component is initialized with a default value when it is created:
> - For type `byte`, `short`, `int`, `long`: `0`
> - For type `float`: `+0f`
> - For type `double`: `+0d`
> - For type `char`: `' '`
> - For type `boolean`: `false`
> - For all reference types: `null`

The spec is explicit: this happens at object creation, before constructors run. Reading a field before assignment yields these defaults — never undefined behavior.

---

## 10. JVMS §5 — loading, linking, initialization

The three phases of class lifecycle from the JVM's view:

| Phase            | Sub-phases               | Spec section |
|------------------|--------------------------|--------------|
| **Loading**      | Find binary, define class | §5.3        |
| **Linking**      | Verification, preparation, resolution | §5.4 |
| **Initialization** | Run `<clinit>`         | §5.5        |

Each is performed lazily and at most once per class. Resolution of constant pool entries is itself lazy — references to types may not be resolved until first use.

`Class.forName("X")` triggers all three eagerly; `loadClass` (used by classloaders) typically only triggers loading + verification + preparation.

---

## 11. The `java.lang.ref` package — reachability formal definition

From the package Javadoc:

> Going from strongest to weakest, the different levels of reachability reflect the life cycle of an object. They are operationally defined as follows:
>
> - **Strongly reachable** if it can be reached by some thread without traversing any reference objects. A newly-created object is strongly reachable by the thread that created it.
> - **Softly reachable** if it is not strongly reachable but can be reached by traversing a soft reference.
> - **Weakly reachable** if it is neither strongly nor softly reachable but can be reached by traversing a weak reference. When the weak references to a weakly-reachable object are cleared, the object becomes eligible for finalization.
> - **Phantom reachable** if it is neither strongly, softly, nor weakly reachable, has been finalized, and some phantom reference refers to it.
> - **Unreachable**, and therefore eligible for reclamation, if it is not reachable in any of the above ways.

Crucial: **softly reachable objects can survive longer than weakly reachable ones**, even though all are not strongly reachable. The GC decides when to clear soft refs based on memory pressure heuristics; weak refs are cleared eagerly.

---

## 12. JEP 401 — value classes (preview)

Adds a `value` modifier to class declarations. Lifecycle differences:

- No identity → no `==` discrimination beyond field-equality
- No object header → flat memory layout
- Cannot be used as a monitor (`synchronized`)
- May be flattened in arrays and fields

Constructors still exist, but the JVM may execute them entirely on the stack. Lifecycle for value class instances becomes "computed → used → vanished."

---

## 13. JEP 471 — region pinning for ZGC, JEP 439 — generational ZGC

Specs / JEPs that recently affected the runtime side of object lifecycle:

- **JEP 439** (Java 21): Generational ZGC. Most objects stay in the young region.
- **JEP 271** (Java 9): Unified GC logging via `-Xlog:gc*`.
- **JEP 318** (Java 11): Epsilon GC for testing pure allocation cost.
- **JEP 421** (Java 18): Deprecate finalization for removal.

---

## 14. Recommended reading order for spec depth

1. JLS §12.4 — class init triggers
2. JLS §12.5 — instance creation
3. JLS §8.8 — constructors
4. JLS §8.6, §8.7 — initializer blocks
5. JLS §17.5 — final fields and JMM
6. JVMS §5 — loading and linking
7. JVMS §2.9, §4.10.2.4 — `<init>` / `<clinit>` / verifier
8. JVMS §6.5 (entries: `new`, `dup`, `invokespecial`)
9. `java.lang.ref` package docs
10. JEP 421 (finalization deprecation), JEP 401 (value classes)

---

## 15. Verification you can run yourself

```bash
javap -c -v -p YourClass.class
```

Things to confirm:
- `<init>` exists for every constructor
- `<clinit>` exists if and only if there are non-constant static initializers or `static {}` blocks
- Field initializers appear in every `<init>`'s prologue
- The first instruction of `<init>` is `aload_0` followed by `invokespecial #N // ... <init>(...)V`
- The verifier table reports `uninitializedThis` on entry

```bash
java -XX:+PrintFlagsFinal -version | grep -E '(TLAB|GC|Heap)'
java -Xlog:class+init=info MyApp                # see <clinit> as it runs
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations MyApp
```

---

**Memorize this**: The lifecycle is *specified*, not discovered. JLS §12.4 governs class init (lazy, at-most-once, twelve-step). JLS §12.5 governs instance creation (allocate → default → super → init → body). JLS §17.5 governs visibility of final fields. The bytecode is the contract; `javap` is your microscope.
