# Lifecycle of a Java Program — Find the Bug

> **Practice finding and fixing bugs in Java code related to the program lifecycle.**
> Each exercise contains buggy code — your job is to find the bug, explain why it happens, and fix it.

---

## How to Use

1. Read the buggy code carefully
2. Try to find the bug **without** looking at the hint
3. Write the fix yourself before checking the solution
4. Understand **why** the bug happens — not just how to fix it

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — Common beginner mistakes, wrong commands, missing methods |
| 🟡 | **Medium** — Static initialization issues, classloading subtleties, lifecycle ordering |
| 🔴 | **Hard** — ClassLoader leaks, JIT deoptimization traps, shutdown hook races |

---

## Bug 1: Wrong Class Name in Command 🟢

**What the code should do:** Print "Hello, World!" when run.

```java
// File: HelloWorld.java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

```bash
javac HelloWorld.java
java HelloWorld
```

**Expected output:**
```
Hello, World!
```

**Actual output:**
```
HelloWorld.java:1: error: class Main is public, should be declared in a file named Main.java
```

<details>
<summary>Hint</summary>

Look at the file name and the class name — do they match?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The file is named `HelloWorld.java` but the public class is named `Main`. In Java, the public class name must match the file name.
**Why it happens:** Java requires this convention so the ClassLoader can find classes by name.
**Impact:** Compilation fails — `javac` refuses to compile.

</details>

<details>
<summary>Fixed Code</summary>

```java
// File: Main.java (rename the file)
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

```bash
javac Main.java
java Main
```

**What changed:** Renamed file from `HelloWorld.java` to `Main.java` to match the public class name.

</details>

---

## Bug 2: Running with .class Extension 🟢

**What the code should do:** Print "Program running" when executed.

```java
// File: Main.java
public class Main {
    public static void main(String[] args) {
        System.out.println("Program running");
    }
}
```

```bash
javac Main.java
java Main.class
```

**Expected output:**
```
Program running
```

**Actual output:**
```
Error: Could not find or load main class Main.class
Caused by: java.lang.ClassNotFoundException: Main.class
```

<details>
<summary>Hint</summary>

The `java` command expects a class name, not a file name.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Running `java Main.class` tells the JVM to look for a class named `Main.class` (with a literal dot and "class" as part of the name). The JVM then looks for `Main/class.class`, which does not exist.
**Why it happens:** The `java` command takes a fully qualified class name, not a file path. The JVM appends `.class` internally.
**Impact:** `ClassNotFoundException` — program does not run.

</details>

<details>
<summary>Fixed Code</summary>

```bash
javac Main.java
java Main          # Correct: class name without .class extension
```

**What changed:** Removed `.class` from the `java` command.

</details>

---

## Bug 3: Missing main Method Signature 🟢

**What the code should do:** Print "Application started".

```java
public class Main {
    public void main(String[] args) {
        System.out.println("Application started");
    }
}
```

**Expected output:**
```
Application started
```

**Actual output:**
```
Error: Main method is not static in class Main, please define the main method as:
   public static void main(String[] args)
```

<details>
<summary>Hint</summary>

The JVM requires a very specific signature for the entry point method.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The `main` method is missing the `static` keyword. The JVM requires `public static void main(String[] args)` exactly.
**Why it happens:** The JVM needs to call `main` without creating an instance of the class. Only `static` methods can be called without an object.
**Impact:** JVM reports the error and does not execute the program.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {  // Added 'static'
        System.out.println("Application started");
    }
}
```

**What changed:** Added `static` to the `main` method declaration.

</details>

---

## Bug 4: Static Initialization Order Bug 🟡

**What the code should do:** Print `"Max connections: 200"` (MULTIPLIER * BASE).

```java
public class Main {
    static final int MAX_CONNECTIONS = MULTIPLIER * BASE;
    static final int BASE = 100;
    static final int MULTIPLIER = 2;

    public static void main(String[] args) {
        System.out.println("Max connections: " + MAX_CONNECTIONS);
    }
}
```

**Expected output:**
```
Max connections: 200
```

**Actual output:**
```
Max connections: 0
```

<details>
<summary>Hint</summary>

Static fields are initialized in the order they appear in the source code. What are the values of `MULTIPLIER` and `BASE` when `MAX_CONNECTIONS` is computed?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `MAX_CONNECTIONS` is computed before `BASE` and `MULTIPLIER` are initialized. At that point, both have their default `int` value of `0`, so `MAX_CONNECTIONS = 0 * 0 = 0`.
**Why it happens:** JLS 12.4.2 — static fields are initialized in textual order. `static final` fields with compile-time constant values (literals) are exceptions, but here `MAX_CONNECTIONS` depends on runtime computation.
**Impact:** Wrong configuration value — could cause application to reject all connections.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    static final int BASE = 100;                          // Initialize first
    static final int MULTIPLIER = 2;                      // Initialize second
    static final int MAX_CONNECTIONS = MULTIPLIER * BASE; // Now = 2 * 100 = 200

    public static void main(String[] args) {
        System.out.println("Max connections: " + MAX_CONNECTIONS);
    }
}
```

**What changed:** Reordered static field declarations so dependencies are initialized before dependents.

</details>

---

## Bug 5: Static Initializer Kills the Class 🟡

**What the code should do:** Load configuration from environment variable with a fallback default.

```java
public class Main {
    static final int PORT;

    static {
        PORT = Integer.parseInt(System.getenv("APP_PORT"));
    }

    public static void main(String[] args) {
        System.out.println("Server starting on port: " + PORT);
    }
}
```

**Expected output (when APP_PORT is not set):**
```
Server starting on port: 8080
```

**Actual output:**
```
Exception in thread "main" java.lang.ExceptionInInitializerError
Caused by: java.lang.NumberFormatException: null
```

<details>
<summary>Hint</summary>

What happens when `System.getenv("APP_PORT")` returns `null`? And what happens to the class after the static initializer fails?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** When `APP_PORT` is not set, `System.getenv()` returns `null`, and `Integer.parseInt(null)` throws `NumberFormatException`. This is wrapped in `ExceptionInInitializerError`, and the class is permanently marked as failed.
**Why it happens:** Static initializers run during class loading. Any exception permanently poisons the class.
**Impact:** The class cannot be used — any future reference throws `NoClassDefFoundError`.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    static final int PORT;

    static {
        String portStr = System.getenv("APP_PORT");
        if (portStr != null && !portStr.isEmpty()) {
            PORT = Integer.parseInt(portStr);
        } else {
            PORT = 8080; // Fallback default
        }
    }

    public static void main(String[] args) {
        System.out.println("Server starting on port: " + PORT);
    }
}
```

**What changed:** Added null check with fallback default value. The static initializer no longer throws.

</details>

---

## Bug 6: Stale Class Files 🟡

**What the code should do:** Print the updated message after code change.

```java
// Version 1: Main.java
public class Main {
    public static void main(String[] args) {
        System.out.println("Version 1");
    }
}
```

Developer compiles and runs:
```bash
javac Main.java
java Main          # Prints "Version 1" ✅
```

Then developer changes the code:
```java
// Version 2: Main.java (updated)
public class Main {
    public static void main(String[] args) {
        System.out.println("Version 2 — with new features!");
    }
}
```

Developer runs again WITHOUT recompiling:
```bash
java Main          # What prints?
```

**Expected output:**
```
Version 2 — with new features!
```

**Actual output:**
```
Version 1
```

<details>
<summary>Hint</summary>

The JVM runs `.class` files, not `.java` files. Did the developer rebuild?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The developer edited `Main.java` but forgot to run `javac` again. The JVM still uses the old `Main.class`.
**Why it happens:** `.class` files are not automatically regenerated when `.java` files change. You must recompile explicitly (or use a build tool like Maven/Gradle that handles this).
**Impact:** Running an outdated version of the code — can cause confusion and "it works on my machine" issues.

</details>

<details>
<summary>Fixed Code</summary>

```bash
javac Main.java   # Recompile after changes
java Main          # Now prints "Version 2 — with new features!"
```

**What changed:** Added the `javac` recompilation step before running.

</details>

---

## Bug 7: Version Mismatch Between Compile and Runtime 🟡

**What the code should do:** Run a program compiled with Java 21 on a Java 17 runtime.

```java
// Compiled with JDK 21
public class Main {
    public static void main(String[] args) {
        System.out.println("Running on Java " + Runtime.version());
    }
}
```

```bash
# Compiled with JDK 21
/opt/jdk-21/bin/javac Main.java

# Run with JDK 17
/opt/jdk-17/bin/java Main
```

**Expected output:**
```
Running on Java 17...
```

**Actual output:**
```
Error: LinkageError: class Main has been compiled by a more recent version of the Java Runtime
(class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0
```

<details>
<summary>Hint</summary>

Each Java version has a class file version number. What is the version for Java 17 and Java 21?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The `.class` file compiled with JDK 21 has class file version 65. JDK 17 only supports up to version 61. The JVM refuses to load the class.
**Why it happens:** Java maintains backward compatibility (new JVM runs old classes) but NOT forward compatibility (old JVM cannot run new classes).
**Impact:** `UnsupportedClassVersionError` — application cannot start.

</details>

<details>
<summary>Fixed Code</summary>

```bash
# Option 1: Compile targeting Java 17
/opt/jdk-21/bin/javac --release 17 Main.java
/opt/jdk-17/bin/java Main

# Option 2: Use matching JDK version
/opt/jdk-21/bin/java Main
```

**What changed:** Either compile with `--release 17` to target the older runtime, or upgrade the runtime to match the compiler version.

</details>

---

## Bug 8: Shutdown Hook Race Condition 🔴

**What the code should do:** Save the counter value to a file during shutdown.

```java
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    static int counter = 0;

    public static void main(String[] args) throws InterruptedException {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            // Bug: counter may not have the final value
            try (FileWriter fw = new FileWriter("counter.txt")) {
                fw.write("Final count: " + counter);
                System.out.println("Saved counter: " + counter);
            } catch (IOException e) {
                System.err.println("Failed to save: " + e.getMessage());
            }
        }));

        for (int i = 0; i < 100; i++) {
            counter++;
            System.out.println("Count: " + counter);
            Thread.sleep(100);
        }
    }
}
```

**Expected output (when Ctrl+C pressed at count 50):**
```
Saved counter: 50
```

**Actual output:**
```
Saved counter: 49    (or 50, or 51 — unpredictable!)
```

<details>
<summary>Hint</summary>

The shutdown hook runs in a separate thread. Is `counter` safely visible across threads? What about the race between the main loop and the hook?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Two issues:
1. **Visibility:** `counter` is not `volatile`, so the shutdown hook thread may see a stale value from its CPU cache.
2. **Atomicity:** The main thread may be in the middle of `counter++` when the hook reads it.

**Why it happens:** The JMM (Java Memory Model) does not guarantee visibility of non-volatile writes across threads without synchronization.
**Impact:** The saved counter value may be stale or inconsistent.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.io.FileWriter;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

public class Main {
    static final AtomicInteger counter = new AtomicInteger(0);
    static volatile boolean running = true;

    public static void main(String[] args) throws InterruptedException {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            running = false;
            // Small delay to let main thread finish current iteration
            try { Thread.sleep(50); } catch (InterruptedException e) { }

            int finalCount = counter.get(); // Atomic read
            try (FileWriter fw = new FileWriter("counter.txt")) {
                fw.write("Final count: " + finalCount);
                System.out.println("Saved counter: " + finalCount);
            } catch (IOException e) {
                System.err.println("Failed to save: " + e.getMessage());
            }
        }));

        while (running && counter.get() < 100) {
            counter.incrementAndGet(); // Atomic increment
            System.out.println("Count: " + counter.get());
            Thread.sleep(100);
        }
    }
}
```

**What changed:** Used `AtomicInteger` for thread-safe counter operations and `volatile boolean` for the running flag. Added a small delay in the hook to let the main thread complete its current iteration.

</details>

---

## Bug 9: ClassLoader Leak via ThreadLocal 🔴

**What the code should do:** Load a plugin class, use it, then unload it (ClassLoader should be GC'd).

```java
import java.lang.ref.WeakReference;

public class Main {
    static ThreadLocal<Object> cache = new ThreadLocal<>();

    public static void main(String[] args) throws Exception {
        WeakReference<ClassLoader> clRef = loadAndUsePlugin();

        // Try to GC the ClassLoader
        System.gc();
        Thread.sleep(100);

        if (clRef.get() == null) {
            System.out.println("ClassLoader was garbage collected (no leak)");
        } else {
            System.out.println("ClassLoader LEAKED! Still in memory.");
        }
    }

    static WeakReference<ClassLoader> loadAndUsePlugin() throws Exception {
        // Simulate a custom ClassLoader
        ClassLoader pluginCL = new ClassLoader(Main.class.getClassLoader()) {
            @Override
            public Class<?> loadClass(String name) throws ClassNotFoundException {
                return super.loadClass(name); // Delegate to parent
            }
        };

        Class<?> stringClass = pluginCL.loadClass("java.lang.String");
        Object instance = "plugin-data";

        // Bug: Store object loaded by plugin's classloader in ThreadLocal
        cache.set(instance);

        return new WeakReference<>(pluginCL);
    }
}
```

**Expected output:**
```
ClassLoader was garbage collected (no leak)
```

**Actual output:**
```
ClassLoader LEAKED! Still in memory.
```

<details>
<summary>Hint</summary>

`ThreadLocal` stores values in a map attached to the current thread. If the value references an object loaded by the plugin ClassLoader, the ClassLoader cannot be GC'd.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The `ThreadLocal` holds a reference to an object that (in a real scenario) would be loaded by the plugin ClassLoader. The ThreadLocal's internal map is attached to the thread, which is a GC root. This prevents the plugin ClassLoader from being garbage collected.
**Why it happens:** `ThreadLocal` values are stored in `Thread.threadLocals` (a `ThreadLocalMap`). As long as the thread is alive and the ThreadLocal is reachable, the value is retained.
**Impact:** `OutOfMemoryError: Metaspace` after repeated plugin load/unload cycles.
**How to detect:** Heap dump analysis with Eclipse MAT → find GC root path for the ClassLoader.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.lang.ref.WeakReference;

public class Main {
    static ThreadLocal<Object> cache = new ThreadLocal<>();

    public static void main(String[] args) throws Exception {
        WeakReference<ClassLoader> clRef = loadAndUsePlugin();

        // Clean up ThreadLocal before expecting GC
        cache.remove();  // ← Critical fix: remove ThreadLocal value

        System.gc();
        Thread.sleep(100);

        if (clRef.get() == null) {
            System.out.println("ClassLoader was garbage collected (no leak)");
        } else {
            System.out.println("ClassLoader LEAKED! Still in memory.");
        }
    }

    static WeakReference<ClassLoader> loadAndUsePlugin() throws Exception {
        ClassLoader pluginCL = new ClassLoader(Main.class.getClassLoader()) {
            @Override
            public Class<?> loadClass(String name) throws ClassNotFoundException {
                return super.loadClass(name);
            }
        };

        Class<?> stringClass = pluginCL.loadClass("java.lang.String");
        Object instance = "plugin-data";

        cache.set(instance);

        return new WeakReference<>(pluginCL);
    }
}
```

**What changed:** Added `cache.remove()` after the plugin is "unloaded" to clear the ThreadLocal reference. In production, always call `ThreadLocal.remove()` in a `finally` block or use `try-with-resources` patterns for ThreadLocal cleanup.

</details>

---

## Bug 10: System.exit() Bypasses Finally Block 🔴

**What the code should do:** Always close the resource, even when exiting early.

```java
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) {
        FileWriter writer = null;
        try {
            writer = new FileWriter("output.txt");
            writer.write("Processing data...\n");

            // Simulate a fatal error condition
            boolean fatalError = true;
            if (fatalError) {
                System.out.println("Fatal error detected. Exiting.");
                System.exit(1);  // Bug: finally block NEVER runs!
            }

            writer.write("Processing complete.\n");
        } catch (IOException e) {
            System.err.println("IO Error: " + e.getMessage());
        } finally {
            System.out.println("Finally: closing writer...");
            try {
                if (writer != null) {
                    writer.flush();
                    writer.close();
                }
            } catch (IOException e) {
                System.err.println("Error closing writer: " + e.getMessage());
            }
        }
    }
}
```

**Expected output:**
```
Fatal error detected. Exiting.
Finally: closing writer...
```

**Actual output:**
```
Fatal error detected. Exiting.
```

The `finally` block never executes, and the file may have unflushed data.

<details>
<summary>Hint</summary>

`System.exit()` initiates JVM shutdown immediately. It does NOT unwind the call stack or execute `finally` blocks. It does run shutdown hooks, though.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `System.exit(1)` terminates the JVM immediately without executing `finally` blocks. The file writer is never flushed or closed, potentially losing data.
**Why it happens:** `System.exit()` calls `Runtime.getRuntime().exit()`, which initiates the shutdown sequence (runs hooks, runs finalizers) but does NOT return to the calling method. The `finally` block is on the call stack, which is never unwound.
**Impact:** Resource leak, data loss (unflushed buffers).
**JLS reference:** JLS 14.20.2 — `try-finally` only executes if control reaches it normally or via exception. `System.exit()` bypasses this.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    static FileWriter writer;

    public static void main(String[] args) {
        // Register shutdown hook for cleanup
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutdown hook: closing writer...");
            try {
                if (writer != null) {
                    writer.flush();
                    writer.close();
                }
            } catch (IOException e) {
                System.err.println("Error closing writer: " + e.getMessage());
            }
        }));

        try {
            writer = new FileWriter("output.txt");
            writer.write("Processing data...\n");

            boolean fatalError = true;
            if (fatalError) {
                System.out.println("Fatal error detected. Exiting.");
                System.exit(1);  // Now the shutdown hook handles cleanup
            }

            writer.write("Processing complete.\n");
        } catch (IOException e) {
            System.err.println("IO Error: " + e.getMessage());
        }
    }
}
```

**What changed:** Moved resource cleanup from `finally` block to a shutdown hook. Shutdown hooks DO run when `System.exit()` is called. Alternatively, avoid `System.exit()` and throw an exception instead, which would allow the `finally` block to execute.

**Alternative fix:** Replace `System.exit(1)` with `throw new RuntimeException("Fatal error")` — this allows the `finally` block to execute normally.

</details>

---

## Bug 11: Circular Static Dependency Deadlock 🔴

**What the code should do:** Initialize two classes that reference each other.

```java
// File: A.java
public class A {
    static final int VALUE;
    static {
        System.out.println("A: initializing...");
        VALUE = B.VALUE + 1;  // Triggers B initialization
        System.out.println("A: VALUE = " + VALUE);
    }
}

// File: B.java
public class B {
    static final int VALUE;
    static {
        System.out.println("B: initializing...");
        VALUE = A.VALUE + 1;  // Triggers A initialization
        System.out.println("B: VALUE = " + VALUE);
    }
}

// File: Main.java
public class Main {
    public static void main(String[] args) {
        System.out.println("A.VALUE = " + A.VALUE);
        System.out.println("B.VALUE = " + B.VALUE);
    }
}
```

**Expected output:**
```
A.VALUE = 2
B.VALUE = 1
```

**Actual output:**
```
A: initializing...
B: initializing...
B: VALUE = 1
A: VALUE = 2
A.VALUE = 2
B.VALUE = 1
```

Wait — the output looks correct? **No!** `B.VALUE` is `1` because when B reads `A.VALUE`, class A is still being initialized (the JVM detects the circular initialization and returns the default value `0` for `A.VALUE`). So `B.VALUE = 0 + 1 = 1`, then `A.VALUE = 1 + 1 = 2`.

If you expected both to be 2, the circular dependency silently produces wrong results.

<details>
<summary>Hint</summary>

When class A triggers B's initialization, and B tries to read A.VALUE, what value does it see? Class A is not finished initializing yet.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Circular static dependency. When A is initializing and triggers B, B reads `A.VALUE` which is still `0` (default int value, because A hasn't finished its `<clinit>` yet). The JVM does NOT deadlock in the single-threaded case — it returns the default value, which produces silently wrong results.
**Why it happens:** JLS 12.4.1 — if a class is currently being initialized by the same thread, the initialization is considered complete (to prevent deadlock). The default value is returned for uninitialized fields.
**Impact:** Silent data corruption — both values are wrong (expected 2 and 2, got 2 and 1).

</details>

<details>
<summary>Fixed Code</summary>

```java
// Break the circular dependency
public class Constants {
    static final int BASE_VALUE = 1;
}

public class A {
    static final int VALUE = Constants.BASE_VALUE + 1; // 2
}

public class B {
    static final int VALUE = Constants.BASE_VALUE + 1; // 2
}

public class Main {
    public static void main(String[] args) {
        System.out.println("A.VALUE = " + A.VALUE);  // 2
        System.out.println("B.VALUE = " + B.VALUE);  // 2
    }
}
```

**What changed:** Extracted the shared base value into a separate `Constants` class, eliminating the circular dependency.

</details>

---

## Score Card

Track your progress:

| Bug | Difficulty | Found without hint? | Understood why? | Fixed correctly? |
|:---:|:---------:|:-------------------:|:---------------:|:----------------:|
| 1 | 🟢 | ☐ | ☐ | ☐ |
| 2 | 🟢 | ☐ | ☐ | ☐ |
| 3 | 🟢 | ☐ | ☐ | ☐ |
| 4 | 🟡 | ☐ | ☐ | ☐ |
| 5 | 🟡 | ☐ | ☐ | ☐ |
| 6 | 🟡 | ☐ | ☐ | ☐ |
| 7 | 🟡 | ☐ | ☐ | ☐ |
| 8 | 🔴 | ☐ | ☐ | ☐ |
| 9 | 🔴 | ☐ | ☐ | ☐ |
| 10 | 🔴 | ☐ | ☐ | ☐ |
| 11 | 🔴 | ☐ | ☐ | ☐ |

### Rating:
- **11/11 without hints** → Senior-level Java debugging skills
- **8-10/11** → Solid middle-level understanding
- **5-7/11** → Good junior, keep practicing
- **< 5/11** → Review the lifecycle fundamentals first
