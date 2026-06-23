# Java Language Specification — Lifecycle of a Java Program
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html

---

## 1. Spec Reference

- **JLS Chapter 12**: Execution — https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html
- **JLS §12.1**: Virtual Machine Start-Up
- **JLS §12.2**: Loading of Classes and Interfaces
- **JLS §12.3**: Linking of Classes and Interfaces
- **JLS §12.3.1**: Verification of the Binary Representation
- **JLS §12.3.2**: Preparation
- **JLS §12.3.3**: Resolution
- **JLS §12.4**: Initialization of Classes and Interfaces
- **JLS §12.4.1**: When Initialization Occurs
- **JLS §12.4.2**: Detailed Initialization Procedure
- **JLS §12.5**: Creation of New Class Instances
- **JLS §12.6**: Finalization of Class Instances
- **JLS §12.7**: Unloading of Classes and Interfaces
- **JLS §12.8**: Program Exit
- **JVMS §2.17**: Execution — https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-2.html

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §12.1: JVM Start-Up --
-- No BNF grammar; behavior is defined operationally.
-- The JVM starts by loading an initial class or interface
-- using the bootstrap class loader (JLS §12.1).

-- JLS §8.6: Instance Initializers --
InstanceInitializer:
    Block

-- JLS §8.7: Static Initializers --
StaticInitializer:
    static Block

-- JLS §8.8: Constructor Declarations --
ConstructorDeclaration:
    {ConstructorModifier} ConstructorDeclarator [Throws] ConstructorBody

ConstructorDeclarator:
    [TypeParameters] SimpleTypeName ( [ReceiverParameter ,] [FormalParameterList] )

ConstructorBody:
    { [ExplicitConstructorInvocation] [BlockStatements] }

ExplicitConstructorInvocation:
    [TypeArguments] this ( [ArgumentList] ) ;
    [TypeArguments] super ( [ArgumentList] ) ;
    ExpressionName . [TypeArguments] super ( [ArgumentList] ) ;
    Primary . [TypeArguments] super ( [ArgumentList] ) ;

-- JLS §14.18: The return Statement --
ReturnStatement:
    return [Expression] ;

-- JLS §14.19: The throw Statement --
ThrowStatement:
    throw Expression ;

-- JLS §11.1: Exception Types --
-- Exceptions are instances of Throwable or its subclasses.
-- Error: serious problems not expected to be caught
-- Exception: conditions that programs should catch
-- RuntimeException: unchecked exceptions

-- JLS §14.20: The try Statement --
TryStatement:
    try Block Catches
    try Block [Catches] Finally
    TryWithResourcesStatement

TryWithResourcesStatement:
    try ResourceSpecification Block [Catches] [Finally]

ResourceSpecification:
    ( ResourceList [;] )

ResourceList:
    Resource { ; Resource }

Resource:
    {VariableModifier} LocalVariableType Identifier = Expression
    VariableAccess

-- JLS §12.8: Program Exit --
-- System.exit(int status) initiates shutdown sequence.
-- Shutdown hooks are run, then finalizers if enabled.
```

---

## 3. Core Rules & Constraints

### 3.1 Loading (JLS §12.2)
- Loading finds the binary representation (`.class` file) and creates a `Class` object.
- The bootstrap class loader has no parent; all other class loaders have a parent (delegation model).
- Loading may be eager (before first use) or lazy (on first use) — the JVM decides.
- A class is loaded at most once per class loader.
- `ClassLoader.loadClass()` triggers loading; `Class.forName()` may also trigger initialization.

### 3.2 Linking (JLS §12.3)
**Verification** (§12.3.1):
- Ensures the binary representation is structurally correct.
- Bytecode verifier checks type safety, stack discipline, operand compatibility.
- Verification may occur during loading or later.

**Preparation** (§12.3.2):
- Allocates storage for static fields.
- Initializes static fields to default values (0, null, false).
- Does NOT execute any Java code.

**Resolution** (§12.3.3):
- Replaces symbolic references with direct references.
- May be lazy (deferred until first use of the reference).
- Throws `NoSuchFieldError`, `NoSuchMethodError`, `IllegalAccessError`, etc. on failure.

### 3.3 Initialization (JLS §12.4)
- Executes the class initializer (`<clinit>`), which runs static initializers and static field initializers.
- A class is initialized before its first active use.
- Active uses: instantiation, static method/field access, subclass initialization, `Class.forName()`.
- Initialization is thread-safe: only one thread initializes a class; others wait.

### 3.4 Object Creation (JLS §12.5)
Order of instance initialization:
1. Assign arguments to constructor parameters.
2. If first statement is explicit `this(...)` call, execute it (then go to step 10).
3. If first statement is explicit `super(...)` call, execute it; otherwise call `super()` implicitly.
4. Execute instance initializers and instance variable initializers in textual order.
5. Execute the rest of the constructor body.

### 3.5 Finalization (JLS §12.6)
- `finalize()` is deprecated since Java 9, removed in Java 18 (JEP 421).
- JVM may call `finalize()` before garbage collection — timing is unspecified.
- Finalization does not guarantee execution.

### 3.6 Program Exit (JLS §12.8)
- `Runtime.halt()` terminates JVM without running shutdown hooks.
- `System.exit(status)` runs registered shutdown hooks then terminates.
- Non-zero exit codes indicate abnormal termination by convention.

---

## 4. Type Rules

### 4.1 Class Initialization Order (JLS §12.4.1)
- Superclass is always initialized before subclass.
- Interface initialization does not trigger initialization of its implementing classes.
- Interfaces are initialized only when their fields are accessed or methods are invoked.

### 4.2 Object Construction Type Rules
- `this()` and `super()` calls must be the first statement in a constructor body (JLS §8.8.7).
- Recursive constructor invocations are compile-time errors (JLS §8.8.7.1).
- Constructors are not inherited (JLS §8.8).
- If no constructor is declared, the compiler inserts a default no-arg constructor.

### 4.3 Static vs Instance Initialization
- Static initializers run once per class, at class initialization time.
- Instance initializers run once per object, at construction time, after super() completes.
- The order of static/instance initializers is the textual order they appear in the class body.

---

## 5. Behavioral Specification

### 5.1 Detailed Initialization Procedure (JLS §12.4.2)
1. Lock `Class` object; if class is being initialized by current thread, proceed.
2. If another thread is initializing, wait until notification; recheck state.
3. If class is initialized, unlock and return.
4. If class is in erroneous state, throw `NoClassDefFoundError`.
5. Mark class as being initialized; unlock `Class` object.
6. Initialize superclass (if not already done); initialize superinterfaces with default methods.
7. Execute class variable initializers and static initializers in textual order.
8. If initialization completes normally: lock Class, mark as initialized, notify all waiting threads.
9. If initialization throws unchecked exception: lock Class, mark as erroneous, notify waiting threads, throw `ExceptionInInitializerError`.

### 5.2 Object Instantiation Sequence (JLS §12.5)
```
new Foo(args)
  → allocate memory
  → zero-initialize all fields
  → invoke constructor
      → invoke super constructor (directly or via super(...))
      → run instance initializers
      → run constructor body remainder
  → return reference
```

### 5.3 Thread Safety of Initialization
- JVM guarantees that class initialization is performed exactly once.
- Uses internal locks on `Class` objects.
- Deadlock is possible if two classes initialize each other circularly with multi-threading.

### 5.4 Shutdown Sequence (JLS §12.8)
1. Call all registered shutdown hooks (via `Runtime.addShutdownHook`).
2. If `runFinalizersOnExit` is enabled (deprecated, unsafe): call finalizers.
3. Halt the JVM with the given status code.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| Accessing static field of uninitialized class | Triggers initialization first |
| Circular class initialization | Partial initialization is visible; may cause subtle bugs (defined but dangerous) |
| Accessing instance field before constructor completes | Possible via `this` reference escape; sees default values (JLS §12.5) |
| `System.exit()` in shutdown hook | Deadlock — undefined/implementation-specific |
| Class loading by two different ClassLoaders | Two distinct `Class` objects are created |
| Throwing from static initializer | `ExceptionInInitializerError` wraps it; class permanently erroneous (JLS §12.4.2) |
| `finalize()` called after GC | Not guaranteed; timing unspecified; called at most once by JVM |
| `Runtime.halt()` | Terminates immediately; no shutdown hooks run |

---

## 7. Edge Cases from Spec

### 7.1 Class Initialization Deadlock
```java
// Thread A initializes ClassA, which triggers ClassB init
// Thread B initializes ClassB, which triggers ClassA init
// Both threads wait forever — JLS §12.4.2 step 2
class ClassA {
    static ClassB b = new ClassB();
}
class ClassB {
    static ClassA a = new ClassA();
}
```

### 7.2 Static Initializer Exception
```java
class BadInit {
    static int value;
    static {
        value = Integer.parseInt("not-a-number"); // throws NumberFormatException
    }
}
// First use: ExceptionInInitializerError
// Any subsequent use: NoClassDefFoundError (class permanently erroneous)
```

### 7.3 Superclass Initialization Before Subclass Field Access
```java
class Parent {
    static int x = compute();
    static int compute() {
        System.out.println("Parent static init");
        return 10;
    }
}
class Child extends Parent {
    static int y = 20;
    public static void main(String[] args) {
        System.out.println(Child.y);  // prints: Parent static init \n 20
    }
}
```

### 7.4 Instance Initializer Ordering
```java
class Demo {
    int a = 1;          // runs first
    { b = 2; }          // instance initializer runs second
    int b = 3;          // overwrites b=2; b is now 3
    Demo() {
        // a=1, b=3 here
    }
}
```

### 7.5 `this` Escape During Construction
```java
class Registry {
    static Registry instance;
    int value;
    Registry() {
        instance = this;   // 'this' escapes before construction complete
        value = 42;
    }
}
// Another thread accessing Registry.instance.value may see 0 (default) not 42
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | Basic loading/linking/initialization defined | JLS 1st ed. |
| Java 1.1 | Inner classes; anonymous class instantiation | JLS §15.9 |
| Java 5 | Generics affect class loading; type erasure | JSR 14 |
| Java 7 | Try-with-resources; AutoCloseable lifecycle | JEP 334 |
| Java 9 | Module system affects class loading delegation | JEP 261 |
| Java 9 | `finalize()` deprecated | JEP 421 (formalized in 18) |
| Java 11 | Epsilon GC (no-op GC); affects finalization | JEP 318 |
| Java 17 | Strong encapsulation of JDK internals | JEP 403 |
| Java 18 | `finalize()` for deprecation removal; `--finalization` flag | JEP 421 |
| Java 21 | Virtual threads; new thread lifecycle model | JEP 444 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 Class Loading Delegation (JVM Spec §5.3)
- Bootstrap class loader: loads JDK classes from `jdk.internal.*` and `java.*`.
- Platform class loader: loads Java SE platform APIs.
- Application (system) class loader: loads application classpath.
- Custom class loaders break delegation at will (plugin systems, hot reloading).

### 9.2 HotSpot JVM Initialization
- HotSpot performs lazy resolution by default.
- Static fields with constant values (compile-time constants) are inlined by javac — no runtime access.
- Class data sharing (CDS) can pre-load classes from a shared archive (`-Xshare:on`).

### 9.3 Garbage Collection and Object Lifecycle
- HotSpot uses generational GC: objects start in Young Generation (Eden space).
- Long-lived objects promoted to Old Generation.
- G1GC (default in Java 9+), ZGC, Shenandoah: concurrent collectors that minimize STW pauses.
- `PhantomReference`, `WeakReference`, `SoftReference` provide post-mortem lifecycle hooks.

### 9.4 JVM Exit Codes
- Exit code 0: normal termination.
- Exit code 1: uncaught exception.
- Exit code 137: killed by `SIGKILL` (OOM killer on Linux).
- Exit code 143: killed by `SIGTERM`.

---

## 10. Spec Compliance Checklist

- [ ] Static fields are accessible only after class initialization
- [ ] Superclass is initialized before subclass
- [ ] Constructor body begins with `super()` or `this()` (explicit or implicit)
- [ ] No circular constructor calls (`this()` chain terminating)
- [ ] Static initializers do not throw checked exceptions
- [ ] Instance initializers do not reference forward-declared instance variables (ordering matters)
- [ ] Shutdown hooks are registered before `System.exit()` is called
- [ ] `finalize()` is not relied upon for resource cleanup (use try-with-resources)
- [ ] `Class.forName()` is used with the correct ClassLoader for dynamic loading
- [ ] Object references not published before constructor completes

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Class Initialization Order Demo
// File: InitOrder.java
class Base {
    static int baseStatic = initBase();
    int instanceField = initInstance();

    static int initBase() {
        System.out.println("Base static initializer");
        return 1;
    }

    int initInstance() {
        System.out.println("Base instance initializer");
        return 2;
    }

    Base() {
        System.out.println("Base constructor");
    }
}

class Derived extends Base {
    static int derivedStatic = initDerived();

    static int initDerived() {
        System.out.println("Derived static initializer");
        return 3;
    }

    Derived() {
        super();
        System.out.println("Derived constructor");
    }
}

public class InitOrder {
    public static void main(String[] args) {
        System.out.println("Creating Derived instance:");
        new Derived();
    }
    // Output:
    // Base static initializer
    // Derived static initializer
    // Base instance initializer
    // Base constructor
    // Derived constructor
}
```

```java
// Example 2: Static Initializer with Error Handling
// File: SafeStaticInit.java
public class SafeStaticInit {

    static final int CONFIG_VALUE;

    static {
        int value;
        try {
            String envVal = System.getenv("CONFIG_VALUE");
            value = (envVal != null) ? Integer.parseInt(envVal) : 42;
        } catch (NumberFormatException e) {
            value = 42; // default fallback
        }
        CONFIG_VALUE = value;
    }

    public static void main(String[] args) {
        System.out.println("Config value: " + CONFIG_VALUE);
    }
}
```

```java
// Example 3: Try-With-Resources (AutoCloseable Lifecycle)
// File: ResourceLifecycle.java
public class ResourceLifecycle {

    static class ManagedResource implements AutoCloseable {
        private final String name;

        ManagedResource(String name) {
            this.name = name;
            System.out.println("Opening: " + name);
        }

        public void use() {
            System.out.println("Using: " + name);
        }

        @Override
        public void close() {
            System.out.println("Closing: " + name);
        }
    }

    public static void main(String[] args) {
        // Resources closed in reverse order of declaration (JLS §14.20.3)
        try (ManagedResource r1 = new ManagedResource("DB Connection");
             ManagedResource r2 = new ManagedResource("File Handle")) {
            r1.use();
            r2.use();
        }
        // Output:
        // Opening: DB Connection
        // Opening: File Handle
        // Using: DB Connection
        // Using: File Handle
        // Closing: File Handle    (closed first — reverse order)
        // Closing: DB Connection
    }
}
```

```java
// Example 4: Shutdown Hooks
// File: ShutdownDemo.java
public class ShutdownDemo {

    public static void main(String[] args) throws InterruptedException {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutdown hook 1: saving state...");
        }));

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutdown hook 2: closing connections...");
        }));

        System.out.println("Application running...");
        Thread.sleep(100);
        System.out.println("Calling System.exit(0)");
        System.exit(0);
        // Shutdown hooks run after exit() is called
    }
}
```

```java
// Example 5: Virtual Threads (Java 21)
// File: VirtualThreadLifecycle.java
public class VirtualThreadLifecycle {

    public static void main(String[] args) throws InterruptedException {
        // Virtual thread lifecycle: created → scheduled → mounted → running → unmounted → terminated
        Thread vThread = Thread.ofVirtual()
            .name("virtual-worker")
            .unstarted(() -> {
                System.out.println("Virtual thread started: " + Thread.currentThread().isVirtual());
                try {
                    Thread.sleep(10);  // Unmounts from carrier thread during sleep
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                System.out.println("Virtual thread finishing");
            });

        System.out.println("Thread state before start: " + vThread.getState()); // NEW
        vThread.start();
        System.out.println("Thread state after start: " + vThread.getState());  // RUNNABLE or TIMED_WAITING
        vThread.join();
        System.out.println("Thread state after join: " + vThread.getState());   // TERMINATED
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §12 | Execution | https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html |
| JLS §8.6 | Instance Initializers | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.6 |
| JLS §8.7 | Static Initializers | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.7 |
| JLS §8.8 | Constructor Declarations | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.8 |
| JLS §11 | Exceptions | https://docs.oracle.com/javase/specs/jls/se21/html/jls-11.html |
| JLS §14.20 | try Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.20 |
| JVMS §5 | Loading, Linking, Initializing | https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-5.html |
| JEP 444 | Virtual Threads | https://openjdk.org/jeps/444 |
| JEP 421 | Finalization Deprecation | https://openjdk.org/jeps/421 |
