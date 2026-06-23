# Class Loading and Initialization — Specification Reading Guide

> The JLS and JVMS treat class loading and initialization with unusual precision because the JVM's safety guarantees depend on these rules being unambiguous. JLS §12.4 prescribes *when* a class is initialized and what must happen first; JLS §12.5 prescribes the same for instances. JVMS §5 covers loading, linking, and initialization from the JVM's point of view. JVMS §2.9 names the two synthetic methods (`<clinit>`, `<init>`) the JVM relies on. The JPMS layer is JEP 261; AppCDS is JEP 310; dynamic CDS is JEP 350; default CDS archives are JEP 388.

---

## 1. Where to find the canonical text

| Concept                                              | Authoritative source                                  |
|------------------------------------------------------|-------------------------------------------------------|
| Initialization of classes and interfaces             | **JLS §12.4**                                         |
| When initialization occurs                           | JLS §12.4.1                                           |
| Detailed initialization procedure                    | **JLS §12.4.2** — the per-class lock protocol         |
| Initializers in class and interface declarations     | JLS §8.7 (instance), §9 (interfaces), §8.10 (records) |
| Static fields and initialization                     | JLS §8.3.1.1 (`static`), §8.3.3 (forward references)  |
| Compile-time constants                               | JLS §4.12.4, §15.28                                   |
| Creation of new class instances                      | **JLS §12.5**                                         |
| Loading, linking, and initialization (JVM view)      | **JVMS §5**                                           |
| Loading                                              | JVMS §5.3                                             |
| Linking — verification, preparation, resolution      | JVMS §5.4                                             |
| Initialization (JVM perspective)                     | JVMS §5.5                                             |
| `<clinit>` and `<init>` synthetic methods            | **JVMS §2.9**                                         |
| Method invocation instructions                       | JVMS §6.5 (`invokestatic`, `invokespecial`, ...)      |
| Errors related to class loading                      | JVMS §5.4, §5.5; `java.lang.LinkageError` hierarchy   |
| Class loaders and named modules                      | **JLS §7.7**, JVMS §5.3.6 (with modules)              |

The two specs split the work: **JLS** governs what the language guarantees a program will see; **JVMS** governs how the runtime makes that true. The classloading topic sits squarely in both.

---

## 2. JLS §12.4 — when a class is initialized

JLS §12.4.1 enumerates the *triggers* of initialization. A class `T` is initialized on first occurrence of any of:

1. Creating an instance of `T` (`new T()`).
2. Invoking a static method declared by `T`.
3. Assigning a static field declared by `T`.
4. Using a static field declared by `T`, **except** when the field is a *constant variable* (JLS §4.12.4).
5. Invoking an assertion that mentions `T`.
6. A reflective call that initializes `T`, e.g. `Class.forName(name)` with `initialize=true` (the default).
7. The class being the main class of the JVM startup.

For interfaces, an interface `I` is initialized only when:

1. A `default` method of `I` is invoked. (Added in Java 8 — interfaces without default methods are not initialized by implementor initialization.)
2. A static field of `I` is used (with the same constant-variable exemption).

A subtle consequence: implementing an interface does **not** initialize the interface. Only invoking a `default` method (or touching a non-constant static field) does. Marker interfaces (`Serializable`, `Cloneable`) never initialize.

JLS §12.4.1 also lists *non-triggers*:

- Reading a *compile-time constant*. Javac has inlined the value at the use site.
- Loading the class via `ClassLoader.loadClass(name)` (no initialization).
- Use of `T.class` literal — triggers loading, not initialization.
- A reference to a static method through a method handle without calling it.

---

## 3. JLS §12.4.2 — the initialization procedure

This is the single most important section in the chapter. It defines the per-class-lock protocol that makes `<clinit>` thread-safe and well-ordered. Read it once verbatim; the prose is dense but unambiguous.

The procedure (paraphrased):

1. Synchronize on the `Class<?>` object's initialization lock.
2. If `C` is being initialized by the current thread, release the lock and return (this allows recursive triggers from `<clinit>` itself).
3. If `C` is being initialized by another thread, wait on the lock until that thread completes initialization.
4. If `C` is already initialized, release the lock and return.
5. If `C` is in an erroneous state (a prior `<clinit>` threw), throw `NoClassDefFoundError`.
6. Otherwise, mark `C` as being initialized by this thread, release the lock.
7. If `C` is a non-interface class, initialize its direct superclass *and* all super-interfaces that declare a default method.
8. Acquire the lock, run `<clinit>` (static field initializers and static blocks, in textual order — JLS §8.7).
9. If `<clinit>` completes normally, mark `C` initialized, notify all waiting threads, release the lock.
10. If `<clinit>` throws, mark `C` erroneous, wrap the exception in `ExceptionInInitializerError`, notify and release.

Two facts that follow:

- **Happens-before guarantee.** Any thread that observes `C` as initialized has a happens-before relationship with the write of every static field in `<clinit>`. This is why the Holder idiom is thread-safe without any explicit synchronization.
- **Permanent failure.** Step 5: once `<clinit>` throws, the class is *permanently* in an erroneous state. Every subsequent attempt throws `NoClassDefFoundError`. The original cause is in the *first* error (`ExceptionInInitializerError`); later `NoClassDefFoundError`s carry no cause.

---

## 4. JLS §12.5 — instance creation order

For `new T(args)`:

1. Allocate space for the new instance (JVMS `new` bytecode).
2. Call `<init>` of `T`:
   - Evaluate constructor arguments.
   - Explicitly or implicitly invoke a superclass constructor (`super(...)`) or another `this(...)` constructor of the same class.
   - Execute instance field initializers and instance `{ ... }` initializer blocks in textual order. (JLS §8.6, §8.7)
   - Execute the body of `<init>`.
3. Return the reference.

Crucially, **instance initialization is not the same as class initialization**. Instance initializers run every `new`; static initializers run once per loader. Confusing the two is the source of "why is my static field being reset?" questions.

JVMS §2.9 defines:

- `<clinit>()V`, `ACC_STATIC` — class initialization.
- `<init>(args)V`, `ACC_PUBLIC | ACC_PROTECTED | ACC_PRIVATE | (nothing)` — instance initialization.

Both have angle-bracketed names that are *not* valid Java identifiers but *are* valid in the JVM (JVMS §4.2.2). That mismatch is why you can't write `static <clinit>() {}` yourself — javac generates them.

---

## 5. JVMS §5 — loading, linking, initialization

The JVM's view of the lifecycle:

**Loading (§5.3).** A classloader produces a `Class<?>` object from a byte array (typically by reading a `.class` file or by `defineClass(byte[], int, int)`). Verifier prerequisites are checked (`magic == 0xCAFEBABE`, valid version, etc.). The class is now *loaded*.

The JVM tracks classes by `(loader, name)` pairs — the **initiating loader** is the one that called `loadClass`, the **defining loader** is the one that actually defined the class (called `defineClass`). Two classes with the same name but different defining loaders are *different* classes — this is the `Class<?>` identity rule from `senior.md`.

**Linking (§5.4).** Three substeps, in order:

- **Verification (§5.4.1).** Bytecode is statically verified for safety. Failures: `VerifyError`. CDS archives can skip this step (the archive includes verification results).
- **Preparation (§5.4.2).** Memory for static fields is allocated and zero-initialized (`0`, `null`, `false`). No application code runs.
- **Resolution (§5.4.3).** Symbolic references in the constant pool are resolved to direct references. Resolution may be lazy. Failures: `NoClassDefFoundError`, `NoSuchFieldError`, `NoSuchMethodError`, `IllegalAccessError`, `IncompatibleClassChangeError`.

**Initialization (§5.5).** Same as JLS §12.4 — the JVM and the language agree on when `<clinit>` runs and what guarantees it makes. (The wording differs slightly; the rules are identical in substance.)

---

## 6. The `LinkageError` hierarchy

`java.lang.LinkageError` is the abstract parent of every error the JVM throws for class-loading anomalies. Knowing the hierarchy helps you read stack traces.

```
LinkageError
├── BootstrapMethodError              (invokedynamic bootstrap failed)
├── ClassCircularityError             (cyclic class definition — extremely rare)
├── ClassFormatError                  (malformed .class file)
├── ExceptionInInitializerError       (<clinit> threw — JLS §12.4.2 step 10)
├── IncompatibleClassChangeError      (resolution-time interface/class confusion)
│   ├── AbstractMethodError
│   ├── IllegalAccessError
│   ├── InstantiationError
│   ├── NoSuchFieldError
│   └── NoSuchMethodError
├── NoClassDefFoundError              (loading failed, OR <clinit> previously failed)
├── UnsatisfiedLinkError              (native method resolution failed)
└── VerifyError                       (bytecode verification failed)
```

Two pairings to memorise:

- **`ClassNotFoundException` vs `NoClassDefFoundError`.** `ClassNotFoundException` is a *checked* exception thrown by classloader APIs (`Class.forName`, `ClassLoader.loadClass`). `NoClassDefFoundError` is an *error* thrown by the JVM during linking when the class was promised at compile time but cannot be loaded at link time — often because `<clinit>` previously failed.
- **`NoSuchMethodException` vs `NoSuchMethodError`.** Same split. The exception is reflective lookup failure; the error is resolution failure (the JVM expected a method that the loaded class doesn't have).

---

## 7. JEP references

| JEP        | Feature                                                               | Relevance                                            |
|------------|------------------------------------------------------------------------|------------------------------------------------------|
| **JEP 261** | Java Platform Module System (JDK 9)                                   | Module layer, classloader-per-module, ServiceLoader integration |
| **JEP 310** | Application Class-Data Sharing (JDK 10)                               | Extended CDS to user classes — startup optimisation  |
| **JEP 341** | Default CDS Archives (JDK 12)                                         | Ships with a precomputed CDS archive for JDK classes |
| **JEP 350** | Dynamic CDS Archives (JDK 13)                                         | `-XX:ArchiveClassesAtExit` creates archive automatically |
| **JEP 387** | Elastic Metaspace (JDK 16)                                            | Releases unused class metadata back to the OS — relevant to classloader leak diagnostics |
| **JEP 388** | Windows/AArch64 Port + Default CDS class lists (JDK 15+ tracking)     | Removes the manual class-list step                   |
| **JEP 396** | Strongly Encapsulate JDK Internals (JDK 17)                           | Affects which classes a custom loader can reflectively reach |
| **JEP 483** | Ahead-of-Time Class Loading & Linking (JDK 24)                        | Caches linking results in addition to metadata        |
| **JEP 122** | Remove the Permanent Generation (JDK 8)                               | Moved class metadata to Metaspace — changed the leak profile |
| **JEP 158** | Unified JVM Logging (JDK 9)                                           | `-Xlog:class+load=info` replaces `-verbose:class`     |

These are the JEPs that someone working on classloading should be able to cite by number. For a fuller list, see `openjdk.org/jeps`.

---

## 8. `ClassLoader` Javadoc — the API contract

`java.lang.ClassLoader` is small but carries an unusual amount of contractual weight. The methods to read with the spec open:

- `loadClass(String)` and `loadClass(String, boolean resolve)` — the entry point. The default implementation in `ClassLoader` does **parent-first delegation**: check loaded, ask parent, then `findClass`. Override `findClass` for the simple case; override `loadClass` only when you need to change delegation policy.
- `findClass(String)` — your hook. Read the bytes, call `defineClass`.
- `defineClass(String, byte[], int, int)` — turns bytes into a `Class<?>`. Triggers verification of the format.
- `resolveClass(Class<?>)` — explicitly invokes the link step. Rarely needed.
- `getParent()` — the parent in the delegation chain.
- `getSystemClassLoader()` — the application loader.
- `getPlatformClassLoader()` (Java 9+) — replaces the old extension loader.

Read the JLS §12.2 paragraph on "Loading of Classes and Interfaces" alongside the Javadoc — the spec defines the *contract*, the Javadoc shows the *interface*.

---

## 9. JLS §7.7 — modules and classloaders

JEP 261 introduced **named modules** and the **module layer**. The relevant sections:

- **JLS §7.7** — module declarations (`module-info.java`).
- **JLS §7.7.1** — dependences (`requires`).
- **JLS §7.7.2** — exported and opened packages.
- **JLS §7.7.4** — uses and provides directives.

Every named module belongs to exactly one classloader. The boot layer has three loaders (bootstrap, platform, application); user-created layers can have one loader per module (strict) or one loader for the whole layer (loose).

The module system affects classloading in three ways:

- **Strong encapsulation.** A class in an unexported package of a named module is *invisible* to other modules at runtime, not just at compile time. Reflection respects this (modulo `--add-opens`).
- **ServiceLoader integration.** A modular `ServiceLoader.load(C.class)` finds providers via module `provides` declarations, not `META-INF/services` (for named modules).
- **`Class<?>.getModule()`.** Every class now has an associated `Module`. `Class.forName(Module, name)` is the loader-free way to ask "is `Foo` in module `M`?".

For application code that does not use JPMS (most current Java code), the platform loader still loads JDK classes from named modules — your application classes are loaded by the application loader, unnamed, and the difference is invisible.

---

## 10. Reading list

1. **JLS §12** — Execution. §12.4 (class initialization), §12.5 (instance initialization). The two anchor sections.
2. **JVMS §5** — Loading, linking, initialization. §5.3 (loading), §5.4 (linking), §5.5 (initialization).
3. **JVMS §2.9** — Special methods `<clinit>` and `<init>`. Short, foundational.
4. **JVMS §6.5** — Method invocation instructions. Connects classloading to the dispatch mechanism in `04-object-memory-layout`.
5. **JLS §7.7** — Module declarations. Read alongside JEP 261.
6. **JEP 310** — Application CDS. The starting point for runtime optimisation.
7. **JEP 350** — Dynamic CDS. The "one command line flag" build flow.
8. **JEP 261** — JPMS. The module system in full.
9. **`java.lang.ClassLoader` Javadoc** — the API surface for custom loaders.
10. **Bracha & Liang** — *Dynamic Class Loading in the Java Virtual Machine* (OOPSLA '98). The original academic treatment.
11. **Hans Boehm & Sarita Adve** — *Foundations of the C++ Concurrency Memory Model* (PLDI '08). Not Java per se, but the concurrent-initialization arguments apply.
12. **Frank Yellin (Sun)** — *The JIT Compiler API* (early JDK docs). Includes a careful description of resolution timing.
13. **Stephen Colebourne** — "Java 9 modules and classloaders" (blog series). Good practitioner-level pairing with JEP 261.

---

## 11. Spec hooks per common bug

| Bug symptom                                       | Spec section that explains it                              |
|---------------------------------------------------|-------------------------------------------------------------|
| `ExceptionInInitializerError`                     | JLS §12.4.2 step 10                                         |
| Subsequent `NoClassDefFoundError` after the above | JLS §12.4.2 step 5; JVMS §5.5                               |
| Static field reads as 0 (forward reference)       | JLS §8.3.3 (definite assignment), §8.7 (textual order)      |
| Static field reads as 0 (cyclic init)             | JLS §12.4.2 step 2 (re-entry returns immediately)           |
| `ClassCastException: X cannot be cast to X`       | JVMS §5.3 (defining vs initiating loader); JLS §4.3.4       |
| Init deadlock between two threads                 | JLS §12.4.2 step 3 (waiting on lock)                        |
| `NoSuchMethodError` weeks after deploy            | JVMS §5.4.3 (resolution is lazy)                            |
| Driver registered, then not found post-redeploy   | JLS §12.4 (init runs per loader); JDBC service spec         |
| ServiceLoader returns empty list in modular app   | JLS §7.7.4 (`provides`); `ServiceLoader` Javadoc            |

A reviewer who knows where to point will save the team hours of "what could possibly go wrong" exploration.

---

**Memorize this:** **JLS §12.4** for *when* classes initialize and the per-class lock protocol; **JLS §12.5** for instance creation; **JVMS §5** for the JVM's load → link → init view; **JVMS §2.9** for `<clinit>` and `<init>` as named synthetic methods. **JEP 261** introduces the module system; **JEP 310 / 341 / 350 / 388** trace the CDS evolution from manual archives to automatic dynamic CDS to ship-with-the-JDK defaults. When a stack trace shows `LinkageError` or one of its descendants, the spec section explaining it is in this file.
