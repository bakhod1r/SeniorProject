# Initializer Block — Specification Deep-Dive

> JLS §8.6 (instance initializers), §8.7 (static initializers), §12.4 (class initialization), §12.5 (instance creation), JVMS §2.9 (`<clinit>`/`<init>`), JVMS §5.5 (init).

---

## 1. Where canonical text lives

| Topic                          | Source            |
|--------------------------------|-------------------|
| Instance initializers           | JLS §8.6          |
| Static initializers             | JLS §8.7          |
| Class initialization triggers   | JLS §12.4.1       |
| Initialization procedure        | JLS §12.4.2       |
| Instance creation procedure     | JLS §12.5          |
| Forward references              | JLS §8.3.3        |
| Constant variables              | JLS §4.12.4       |
| `<clinit>` and `<init>`         | JVMS §2.9          |
| Class state machine             | JVMS §5.5          |
| `ExceptionInInitializerError`    | `java.lang.ExceptionInInitializerError` Javadoc |
| `NoClassDefFoundError`           | `java.lang.NoClassDefFoundError` Javadoc |

---

## 2. JLS §8.6 — instance initializers

> An instance initializer declared in a class is executed when an instance of the class is created.

Syntax:
```
InstanceInitializer:
    Block
```

It's just a block of code in the class body, not preceded by any modifier or method header. Multiple instance initializers run in source order.

Restrictions:
- Cannot declare a return statement.
- Can throw checked exceptions only if every constructor declares them.
- Cannot reference instance fields declared *after* it (forward reference rules).

---

## 3. JLS §8.7 — static initializers

> A static initializer declared in a class is executed when the class is initialized.

Syntax:
```
StaticInitializer:
    static Block
```

Multiple static initializers run in source order, interleaved with static field initializers.

Restrictions:
- Cannot throw checked exceptions (`<clinit>` has no `throws` clause).
- Cannot reference `this` (no instance exists during class init).
- Cannot reference static fields declared after it without proper handling.

---

## 4. JLS §12.4.1 — when initialization occurs

A class or interface `T` is initialized just before:

> 1. T is a class and an instance of T is created.
> 2. T is a class and a static method declared by T is invoked.
> 3. A static field declared by T is assigned.
> 4. A static field declared by T is used and the field is not a constant variable.
> 5. T is a top-level class and an assert statement lexically nested within T is executed.

Subclass initialization initializes superclasses (but not superinterfaces, unless they have default methods).

---

## 5. JLS §12.4.2 — initialization procedure

The 12-step algorithm:

1. Synchronize on the initialization lock LC for class C.
2. If C is being initialized by current thread → release lock, complete recursively.
3. If C is being initialized by another thread → wait, go to 1.
4. If C is "initialized" → release, return.
5. If C is "erroneous" → release, throw `NoClassDefFoundError`.
6. Mark C as "being initialized." Release lock.
7. If C is a class, initialize direct superclass and any superinterfaces with default methods.
8. If exception in step 7, mark C erroneous, release, propagate.
9. (Informative: determine assertions enabled.)
10. Execute `<clinit>`. If exception, mark erroneous, release, propagate (wrapped in `ExceptionInInitializerError` for non-Error/RuntimeException).
11. Mark C as fully initialized, notify waiters, release.
12. Done.

This is what makes class initialization at-most-once and thread-safe.

---

## 6. JLS §12.5 — instance creation procedure

When you write `new C(args)`:

1. Resolve and check accessibility of C.
2. Verify C is not abstract.
3. Initialize C per §12.4 if not already initialized.
4. Allocate space for the new instance.
5. Initialize all fields to default values.
6. Evaluate constructor arguments left-to-right.
7. Select the constructor.
8. Invoke the constructor:
   - First statement is `super(...)` or `this(...)` (implicit if not given).
   - Then run instance initializers and instance field initializers in source order.
   - Then run the rest of the constructor body.
9. The result is a reference to the new instance.

---

## 7. JLS §4.12.4 — constant variables

> A constant variable is a final variable of primitive type or type String that is initialized with a constant expression.

Constant variables:
- Are inlined at compile time at use sites.
- Reading them does NOT trigger class initialization.
- Are stored in the class file's `ConstantValue` attribute.

```java
public static final int A = 5;          // constant variable
public static final int B = compute();   // not a constant variable
public static final Integer C = 5;       // not a constant variable (boxed)
public static final String S = "hi";     // constant variable
public static final Object O = "hi";     // not a constant variable (Object reference)
```

---

## 8. JLS §8.3.3 — forward references

A reference to a static field by simple name in the same class is restricted:

> The use of an instance variable can be on the left-hand side of an assignment expression. Otherwise, it must be a use that follows the variable's declaration.

The rule's spirit: don't read a field before it's been initialized.

```java
class C {
    int x = y;       // ERROR — illegal forward reference
    int y = 5;
}
```

But assignment via method bypasses (because methods aren't "simple names"):

```java
class C {
    int x = init();
    int y = 5;
    int init() { return y; }   // OK at compile, returns 0 at runtime
}
```

This is more about catching obvious bugs than enforcing semantics.

---

## 9. JVMS §2.9 — `<clinit>` and `<init>`

`<clinit>`:
- Synthesized by `javac` from static parts.
- Method descriptor `()V`.
- Access flags `0x0008` (static) and possibly `0x1000` (synthetic).
- Cannot declare exceptions.
- Optional: omitted if class has no static initialization.

`<init>`:
- One per constructor.
- Method descriptor matches the constructor's parameter types, return is `V`.
- First instruction must be `invokespecial` to `<init>` of the same class (`this(...)`) or superclass (`super(...)`).
- Verifier tracks "uninitializedThis" type until super() returns.

---

## 10. JVMS §5.5 — initialization triggers (machine view)

The JVM triggers initialization on the same events specified in JLS §12.4.1, mapped to bytecode operations:
- `new` instruction
- `getstatic`, `putstatic` (except for constant variables)
- `invokestatic`
- Initialization of subclass (recursive trigger)

The runtime maintains a per-class state: not-loaded → loaded → linked → initialized (or erroneous).

---

## 11. `ExceptionInInitializerError` and `NoClassDefFoundError`

Per the spec:
- First failure during `<clinit>`: `ExceptionInInitializerError` (wrapping the cause unless it's already an `Error`).
- Subsequent attempts to use the erroneous class: `NoClassDefFoundError`.

This makes the *first* failure informative; later failures are diagnostic-poor. Production lesson: always log the first error well.

---

## 12. Reading order

1. JLS §12.4.1 — when init occurs
2. JLS §12.4.2 — init procedure
3. JLS §8.6, §8.7 — initializer blocks
4. JLS §8.3.3 — forward references
5. JLS §4.12.4 — constant variables
6. JLS §12.5 — instance creation
7. JVMS §2.9 — `<clinit>`/`<init>` overview
8. JVMS §5.5 — init triggers

---

**Memorize this**: JLS §12.4 governs class init (lazy, at-most-once, thread-safe via per-class lock). JLS §12.5 governs instance creation (super → field inits → blocks → ctor body). The JVM enforces this at the bytecode level via `<clinit>`/`<init>` synthesized methods. Constant variables are inlined and don't trigger init. Failed static init produces `ExceptionInInitializerError` then `NoClassDefFoundError`.
