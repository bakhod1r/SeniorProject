# Lifecycle of a Java Program — Practical Tasks

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Compile and Run a Multi-Class Program

**Type:** 💻 Code

**Goal:** Practice the compile → run lifecycle with multiple files.

**Instructions:**
1. Create a file `Greeter.java` with a class that has a method `greet(String name)` returning `"Hello, <name>!"`
2. Create a file `Main.java` that uses `Greeter` to print greetings for 3 different names
3. Compile both files with `javac`
4. Run the program with `java`
5. List the `.class` files generated

**Starter code:**

```java
// File: Greeter.java
public class Greeter {
    // TODO: Add a method greet(String name) that returns "Hello, <name>!"
}

// File: Main.java
public class Main {
    public static void main(String[] args) {
        // TODO: Create a Greeter and print greetings for "Alice", "Bob", "Charlie"
    }
}
```

**Expected output:**
```
Hello, Alice!
Hello, Bob!
Hello, Charlie!
```

**Evaluation criteria:**
- [ ] Code compiles with `javac Greeter.java Main.java`
- [ ] Output matches expected
- [ ] Both `Greeter.class` and `Main.class` are generated
- [ ] Follows Java naming conventions (PascalCase for classes, camelCase for methods)

---

### Task 2: Explore Bytecode with javap

**Type:** 💻 Code

**Goal:** Understand what `javac` produces and learn to read basic bytecode.

**Instructions:**
1. Write a class `Calculator` with a static method `add(int a, int b)` that returns `a + b`
2. Write a `Main` class that calls `Calculator.add(15, 27)` and prints the result
3. Compile the program
4. Run `javap -c Calculator` and `javap -c Main`
5. Answer: What bytecode instruction performs the addition?

**Starter code:**

```java
// File: Calculator.java
public class Calculator {
    // TODO: static method add(int a, int b) returns a + b
}

// File: Main.java
public class Main {
    public static void main(String[] args) {
        // TODO: Call Calculator.add(15, 27) and print result
    }
}
```

**Expected output:**
```
42
```

**Evaluation criteria:**
- [ ] Code compiles and runs correctly
- [ ] Student can identify `iadd` instruction in bytecode
- [ ] Student can identify `invokestatic` for the `add` method call
- [ ] Student understands the operand stack concept

---

### Task 3: Observe Garbage Collection

**Type:** 💻 Code

**Goal:** See garbage collection in action and understand when objects become eligible for GC.

**Instructions:**
1. Write a program that creates 1 million `String` objects in a loop
2. Run it with `-verbose:gc` flag
3. Count how many GC events occur
4. Modify the program to hold references to all objects in an `ArrayList` — observe the difference

**Starter code:**

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        System.out.println("--- Phase 1: Objects eligible for GC ---");
        for (int i = 0; i < 1_000_000; i++) {
            String temp = "Object-" + i; // eligible for GC after each iteration
        }
        System.out.println("Phase 1 complete.");

        System.out.println("\n--- Phase 2: Objects retained in list ---");
        List<String> retained = new ArrayList<>();
        for (int i = 0; i < 1_000_000; i++) {
            retained.add("Object-" + i); // NOT eligible for GC — list holds reference
        }
        System.out.println("Phase 2 complete. List size: " + retained.size());
    }
}
```

**How to run:**
```bash
javac Main.java
java -verbose:gc Main
```

**Evaluation criteria:**
- [ ] Code compiles and runs
- [ ] Student can explain why Phase 1 generates more GC events
- [ ] Student can explain why Phase 2 uses more memory
- [ ] Student understands the concept of "reachable" objects

---

### Task 4: Understand Static Initialization Order

**Type:** 🎨 Design

**Goal:** Predict the output of programs with static initializers.

**Deliverable:** Write predictions and verify by running.

**Predict the output of each program:**

```java
// Program A
public class Main {
    static int x = 10;
    static int y = x * 2;
    static { System.out.println("static block: x=" + x + ", y=" + y); }

    public static void main(String[] args) {
        System.out.println("main: x=" + x + ", y=" + y);
    }
}
```

```java
// Program B
public class Main {
    static int y = getX() * 2;
    static int x = 10;

    static int getX() { return x; }

    public static void main(String[] args) {
        System.out.println("x=" + x + ", y=" + y);
    }
}
```

**Evaluation criteria:**
- [ ] Student correctly predicts Program A output
- [ ] Student correctly predicts Program B output (y=0 because x is 0 when getX() is called)
- [ ] Student can explain static initialization order (textual order in source code)

---

## Middle Tasks

### Task 5: Implement a Warmup Strategy

**Type:** 💻 Code

**Goal:** Build a simple application that warms up critical paths before accepting "requests."

**Scenario:** You have a service method that processes data. Build a program that:
1. Measures latency of the method WITHOUT warmup (first call)
2. Warms up the method with 50,000 iterations
3. Measures latency AFTER warmup
4. Prints the speedup ratio

**Requirements:**
- [ ] Measure time with `System.nanoTime()`
- [ ] Show before/after warmup latency in nanoseconds
- [ ] Calculate and print the speedup ratio
- [ ] Use `Blackhole`-style consumption to prevent dead code elimination

**Starter code:**

```java
public class Main {
    static long processRequest(long input) {
        long result = input;
        for (int i = 0; i < 1000; i++) {
            result = result * 31 + i;
            result = result ^ (result >>> 16);
        }
        return result;
    }

    public static void main(String[] args) {
        // TODO: Step 1 - Measure cold latency (first call)
        // TODO: Step 2 - Warmup with 50,000 calls
        // TODO: Step 3 - Measure warm latency
        // TODO: Step 4 - Print comparison and speedup ratio
    }
}
```

<details>
<summary>Hint 1</summary>

Use `System.nanoTime()` before and after each measurement. Store the result in a variable and print it to prevent the JIT from eliminating the call.

</details>

**Evaluation criteria:**
- [ ] Program compiles and runs
- [ ] Cold latency is measurably higher than warm latency
- [ ] Speedup ratio is reasonable (typically 5-30x)
- [ ] Student can explain why JIT makes the difference

---

### Task 6: ClassLoader Inspector

**Type:** 💻 Code

**Goal:** Build a utility that inspects and reports the ClassLoader hierarchy for any given class.

**Scenario:** You need to debug a `ClassNotFoundException` in production. Build a tool that:
1. Takes a class name as command-line argument
2. Tries to load it with `Class.forName()`
3. Prints the entire ClassLoader chain for that class
4. Handles `ClassNotFoundException` gracefully

**Requirements:**
- [ ] Accept class name from `args[0]`
- [ ] Print the ClassLoader hierarchy (including null for Bootstrap)
- [ ] Handle `ClassNotFoundException` with a helpful error message
- [ ] Test with `java.lang.String`, `Main`, and a non-existent class

**Expected output example:**
```
Class: java.lang.String
  ClassLoader chain:
    [0] Bootstrap ClassLoader (null)

Class: Main
  ClassLoader chain:
    [0] jdk.internal.loader.ClassLoaders$AppClassLoader
    [1] jdk.internal.loader.ClassLoaders$PlatformClassLoader
    [2] Bootstrap ClassLoader (null)

Class: com.nonexistent.Foo
  Error: Class not found on classpath!
  Tip: Check your -cp flag or Maven/Gradle dependencies.
```

**Evaluation criteria:**
- [ ] Handles all three test cases correctly
- [ ] Prints the full ClassLoader hierarchy
- [ ] Error message is helpful and actionable
- [ ] Code uses proper exception handling

---

### Task 7: Shutdown Hook Logger

**Type:** 💻 Code

**Goal:** Build a program with proper shutdown handling that logs its lifecycle events.

**Scenario:** Create a long-running program that:
1. Logs "Application started" on startup
2. Processes items every second (simulate with `Thread.sleep`)
3. Registers a shutdown hook that logs "Shutdown initiated" and saves a final status
4. Test by pressing Ctrl+C during execution

**Requirements:**
- [ ] Register at least one shutdown hook
- [ ] Log all lifecycle events with timestamps
- [ ] Write a "status.txt" file during shutdown with the number of items processed
- [ ] Handle `InterruptedException` properly

**Evaluation criteria:**
- [ ] Shutdown hook runs when Ctrl+C is pressed
- [ ] "status.txt" is written correctly
- [ ] All lifecycle events are logged with timestamps
- [ ] `InterruptedException` is handled (not swallowed)

---

## Senior Tasks

### Task 8: JVM Flags Optimization Report

**Type:** 💻 Code + 📊 Analysis

**Goal:** Analyze the impact of different JVM flags on a benchmark.

**Scenario:** You have a program that allocates many short-lived objects. Run it with different GC configurations and write a comparison report.

**Requirements:**
- [ ] Write a benchmark program that allocates 10 million objects of varying sizes
- [ ] Run with at least 3 GC configurations: G1GC (default), ZGC, ParallelGC
- [ ] Measure: total time, max GC pause, number of GC events
- [ ] Document your findings with a comparison table
- [ ] Recommend the best configuration for: (a) a web server, (b) a batch job

**Provided code to benchmark:**

```java
public class Main {
    static volatile Object sink; // Prevent optimization

    public static void main(String[] args) {
        long start = System.nanoTime();
        int gcCountBefore = getGCCount();

        for (int i = 0; i < 10_000_000; i++) {
            // Mix of small and large objects
            if (i % 1000 == 0) {
                sink = new byte[1024 * 100]; // 100KB — may be humongous in G1
            } else {
                sink = new byte[64]; // Small object
            }
        }

        long elapsed = (System.nanoTime() - start) / 1_000_000;
        int gcCountAfter = getGCCount();
        System.out.printf("Time: %d ms, GC events: %d%n", elapsed, gcCountAfter - gcCountBefore);
    }

    static int getGCCount() {
        int count = 0;
        for (java.lang.management.GarbageCollectorMXBean gc :
             java.lang.management.ManagementFactory.getGarbageCollectorMXBeans()) {
            count += gc.getCollectionCount();
        }
        return count;
    }
}
```

**Run configurations:**
```bash
javac Main.java
java -XX:+UseG1GC -Xms512m -Xmx512m -Xlog:gc*:file=gc-g1.log Main
java -XX:+UseZGC -Xms512m -Xmx512m -Xlog:gc*:file=gc-zgc.log Main
java -XX:+UseParallelGC -Xms512m -Xmx512m -Xlog:gc*:file=gc-parallel.log Main
```

---

### Task 9: ClassLoader Leak Detector

**Type:** 💻 Code

**Goal:** Build a program that demonstrates a ClassLoader leak and then fix it.

**Scenario:** Create a custom `URLClassLoader` that loads a class, then "undeploy" it. Verify whether the ClassLoader is garbage collected.

**Requirements:**
- [ ] Create a custom ClassLoader that loads a class from a JAR or directory
- [ ] Load a class, use it, then null out all references
- [ ] Use `WeakReference` to track the ClassLoader
- [ ] Call `System.gc()` and check if the ClassLoader was collected
- [ ] Demonstrate a leak (e.g., by registering a shutdown hook from the loaded class)
- [ ] Fix the leak and verify collection

**Evaluation criteria:**
- [ ] Correctly demonstrates a leak scenario
- [ ] Correctly fixes the leak
- [ ] Uses `WeakReference` to verify collection
- [ ] Explains why the leak occurs

---

## Questions

### 1. What is the purpose of bytecode verification?

**Answer:**
Bytecode verification ensures that `.class` files contain valid, safe instructions before execution. It checks stack consistency, type safety, branch targets, and access control. This prevents malicious or corrupted bytecode from crashing the JVM or accessing forbidden memory. The verifier uses StackMapTable frames (since Java 6) for efficient single-pass verification.

---

### 2. Why does Java use a two-step compilation model?

**Answer:**
Step 1 (`javac` → bytecode) provides platform independence. Step 2 (JIT → native code) provides near-native performance. This combination gives Java the benefit of "write once, run anywhere" without sacrificing speed for long-running applications.

---

### 3. What is the TLAB and why does it exist?

**Answer:**
TLAB (Thread Local Allocation Buffer) is a small region of Eden space dedicated to a single thread. Object allocation within a TLAB is just a pointer bump — no synchronization needed. This makes Java object allocation extremely fast (~5 nanoseconds). Without TLABs, every allocation would require a CAS or lock on the shared Eden pointer.

---

### 4. What happens if the Code Cache is full?

**Answer:**
When the Code Cache (`-XX:ReservedCodeCacheSize`, default 240MB) is full, the JIT compiler stops compiling new methods. A warning is logged. Existing compiled code continues to run, but new code paths fall back to interpretation — causing significant performance degradation. Fix: Increase the code cache size.

---

### 5. How does `invokedynamic` work?

**Answer:**
`invokedynamic` allows the call target to be determined at runtime by a bootstrap method. On first execution, the bootstrap method returns a `CallSite` with a `MethodHandle` pointing to the actual target. Subsequent calls go directly through the `CallSite`. Used for lambda expressions, string concatenation (Java 9+), and pattern matching.

---

### 6. What is escape analysis?

**Answer:**
Escape analysis is a C2 JIT optimization that determines if an object "escapes" the method where it was created. If an object is used only within the method (NoEscape), the JIT can:
- Stack-allocate it (instead of heap)
- Eliminate the allocation entirely (scalar replacement)
- Remove synchronization on it (lock elision)

This makes short-lived objects in tight loops essentially free.

---

### 7. Why is `System.gc()` unreliable?

**Answer:**
`System.gc()` is only a hint to the JVM. The JVM is free to ignore it, delay it, or perform a partial collection. In production, it is often disabled entirely with `-XX:+DisableExplicitGC`. Even when honored, it typically triggers a full GC (stop-the-world), which can cause significant latency spikes.

---

### 8. What is the safepoint problem?

**Answer:**
The JVM can only pause threads for GC at safepoints — specific points in code where the thread state is known. Counted loops with `int` counters do NOT have safepoints (HotSpot optimization). A long-running loop like `for (int i = 0; i < 2_000_000_000; i++)` with no method calls will delay GC for all threads until the loop finishes. Fix: Use `long` loop counter or add a method call.

---

## Mini Projects

### Project 1: JVM Lifecycle Monitor Dashboard

**Goal:** Build a console application that continuously displays JVM lifecycle metrics.

**Description:**
Build a Java program that displays a real-time dashboard (refreshed every 2 seconds) showing:

- **Class Loading:** Loaded classes, unloaded classes, total loaded
- **Memory:** Heap used/max, non-heap used, GC count, GC time
- **Runtime:** Uptime, JVM arguments, Java version
- **Compilation:** JIT compilation time, number of compilations

**Requirements:**
- [ ] Use `java.lang.management` MXBeans
- [ ] Display data in a formatted console table
- [ ] Refresh every 2 seconds
- [ ] Show trend arrows (up/down) for changing values
- [ ] Handle `Ctrl+C` gracefully with a shutdown hook

**Difficulty:** Middle
**Estimated time:** 3-4 hours

**Example output:**
```
╔══════════════════════════════════════════════════╗
║           JVM Lifecycle Monitor                  ║
╠══════════════════════════════════════════════════╣
║ Uptime:        45.2s                             ║
║ Classes:       1,245 loaded | 3 unloaded         ║
║ Heap:          128 MB / 512 MB (25%) ▲            ║
║ Non-Heap:      42 MB                             ║
║ GC Count:      12 (total 234 ms)                 ║
║ JIT Time:      1,456 ms                          ║
║ Threads:       14 live                           ║
╚══════════════════════════════════════════════════╝
```

---

## Challenge

### The Cold Start Challenge

**Problem:** Write a program that detects whether it is running "cold" (interpreted) or "warm" (JIT-compiled) and reports its own JIT compilation status.

**Constraints:**
- Must detect the transition from interpreted to JIT-compiled code
- Must report the approximate invocation count when JIT compilation occurred
- Must work without `-XX:+PrintCompilation` flag
- No external libraries beyond JDK
- Must complete in under 5 seconds

**Approach hint:** Measure method execution time in a loop. Detect the sharp decrease in latency that indicates JIT compilation.

**Scoring:**
- Correctness: 50% — accurately detects JIT compilation threshold
- Creativity: 30% — clever detection mechanism
- Code quality: 20% — clean, well-documented code

**Example output:**
```
Iteration 1: 4521 ns (interpreted)
Iteration 100: 3892 ns (interpreted)
Iteration 500: 3456 ns (interpreted)
Iteration 1500: 312 ns (C1 compiled!)
Iteration 5000: 45 ns (C2 compiled!)
Detected JIT transition at ~1200 iterations (C1) and ~4500 iterations (C2)
```
