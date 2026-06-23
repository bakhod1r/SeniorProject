# Lifecycle of a Java Program — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What are the main stages of a Java program's lifecycle?

**Answer:**
A Java program goes through these stages:
1. **Write** source code in `.java` files
2. **Compile** with `javac` to produce `.class` bytecode files
3. **Load** — the ClassLoader loads `.class` files into JVM memory
4. **Verify** — the bytecode verifier checks safety and correctness
5. **Execute** — the JVM interpreter runs bytecode; the JIT compiler optimizes hot paths
6. **Garbage Collection** — the GC automatically reclaims memory from unreachable objects
7. **Terminate** — the program ends when `main()` returns, `System.exit()` is called, or an unhandled exception occurs

---

### 2. What is the difference between JDK, JRE, and JVM?

**Answer:**
```
JDK = JRE + Development Tools (javac, javap, jdb, jconsole)
JRE = JVM + Standard Libraries (java.lang, java.util, java.io)
JVM = The engine that loads, verifies, and executes bytecode
```

- You need the **JDK** to compile Java code
- You need at least the **JRE** to run compiled Java programs
- The **JVM** is the runtime engine that actually executes bytecode on a specific OS/CPU

---

### 3. What is bytecode and why does Java use it?

**Answer:**
Bytecode is an intermediate representation stored in `.class` files. It is not native machine code — it is a set of instructions designed for the JVM.

Java uses bytecode for **platform independence**: you compile once, and the bytecode runs on any operating system that has a JVM. This is the "write once, run anywhere" principle.

```java
// Source code (human-readable)
int sum = 10 + 20;

// Bytecode (JVM-readable, from javap -c)
bipush 10
bipush 20
iadd
istore_1
```

---

### 4. What does the `javac` compiler do?

**Answer:**
`javac` is the Java compiler. It takes `.java` source files and produces `.class` files containing bytecode. It also:
- Checks syntax and type correctness at compile time
- Reports compilation errors with line numbers
- Generates multiple `.class` files if the source contains inner classes
- Can target older Java versions with `--release` flag

```bash
javac Main.java          # Produces Main.class
javac --release 17 *.java  # Target Java 17 compatibility
```

---

### 5. What is garbage collection in Java?

**Answer:**
Garbage collection (GC) is the JVM's automatic memory management. When you create objects with `new`, the JVM allocates memory on the heap. When objects are no longer reachable (no variable references them), the GC automatically reclaims that memory.

Key points:
- You never need to call `free()` or `delete` like in C/C++
- `System.gc()` is a hint, not a command — the JVM may ignore it
- GC is non-deterministic — you cannot predict when it will run

```java
void example() {
    String s = new String("hello"); // Object created on heap
    s = null; // Object is now eligible for GC (no reference)
    // GC will reclaim this memory at some point
}
```

---

### 6. What is the role of the ClassLoader?

**Answer:**
The ClassLoader finds and loads `.class` files into JVM memory. Java has three built-in classloaders:

1. **Bootstrap ClassLoader** — loads core JDK classes (`java.lang.*`, `java.util.*`)
2. **Platform ClassLoader** — loads platform modules (`java.sql`, `javax.*`)
3. **Application ClassLoader** — loads your application classes from the classpath

Classes are loaded **lazily** — only when first referenced in your code.

---

### 7. What happens if the `main` method signature is wrong?

**Answer:**
The JVM requires the exact signature: `public static void main(String[] args)`. If any part is wrong, the JVM reports an error:

```java
// ❌ Missing static → "Main method is not static"
public void main(String[] args) { }

// ❌ Wrong parameter → "Main method not found"
public static void main(String args) { }

// ❌ Wrong return type → "Main method must return void"
public static int main(String[] args) { return 0; }

// ✅ Correct
public static void main(String[] args) { }
```

---

## Middle Level

### 4. How does JIT compilation work and why does it matter?

**Answer:**
JIT (Just-In-Time) compilation is the JVM's strategy to convert frequently executed bytecode into native machine code at runtime.

The JVM uses **tiered compilation** with two compilers:
- **C1 (Client Compiler):** Fast compilation, basic optimizations — kicks in early (~200 invocations)
- **C2 (Server Compiler):** Slower compilation, aggressive optimizations (escape analysis, inlining, loop unrolling) — kicks in for hot methods (~10,000 invocations)

**Why it matters in production:**
- The first few seconds after startup, code runs interpreted (slow)
- After warmup, JIT-compiled code can be as fast as C/C++
- Latency-sensitive services must warm up critical paths before accepting traffic

```bash
# Observe JIT activity
java -XX:+PrintCompilation MyApp
```

---

### 5. Explain the ClassLoader delegation model and why it matters.

**Answer:**
The ClassLoader uses **parent-first delegation**: when asked to load a class, each ClassLoader first delegates to its parent. Only if the parent cannot find the class does the child try to load it.

```
Application CL → delegates to → Platform CL → delegates to → Bootstrap CL
```

**Why it matters:**
1. **Security:** Your code cannot override `java.lang.String` or `java.lang.System` — the bootstrap loader always loads them first
2. **Consistency:** The same class is loaded only once across the hierarchy
3. **Isolation:** In containers like Tomcat, each web application gets its own ClassLoader, preventing library conflicts between apps

**Common issues:**
- `ClassNotFoundException` — class not found by any ClassLoader in the chain
- `NoClassDefFoundError` — class was found at compile time but missing at runtime (transitive dependency issue)

---

### 6. What is the difference between `ClassNotFoundException` and `NoClassDefFoundError`?

**Answer:**

| | `ClassNotFoundException` | `NoClassDefFoundError` |
|--|-------------------------|----------------------|
| **Type** | Checked exception | Error (unchecked) |
| **When** | Explicit loading: `Class.forName()`, `ClassLoader.loadClass()` | Implicit loading: using a class in code |
| **Cause** | Class not found on classpath | Class was available at compile time but missing at runtime |
| **Common fix** | Add the JAR to classpath | Fix transitive dependency in Maven/Gradle |

```java
// ClassNotFoundException
try {
    Class.forName("com.missing.MyClass"); // Not on classpath
} catch (ClassNotFoundException e) { ... }

// NoClassDefFoundError
// MyClass uses HelperClass, which is missing at runtime
MyClass obj = new MyClass(); // → NoClassDefFoundError for HelperClass
```

---

### 7. How do shutdown hooks work and what are their limitations?

**Answer:**
Shutdown hooks are threads registered via `Runtime.getRuntime().addShutdownHook()` that run when the JVM is shutting down.

**They run when:**
- `main()` exits normally
- `System.exit()` is called
- JVM receives SIGTERM or SIGINT (Ctrl+C)

**They do NOT run when:**
- `kill -9` (SIGKILL) terminates the process
- `Runtime.halt()` is called
- JVM crashes (segfault, OOM in native code)

**Limitations:**
- Hooks run concurrently — no guaranteed order
- Should be fast (< 5 seconds) — JVM may force exit
- Cannot call `System.exit()` inside a hook (deadlock)
- Cannot register new hooks from within a hook

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("Cleaning up...");
    // Close connections, flush logs
}, "shutdown-hook"));
```

---

### 8. What is the difference between JVM interpretation and JIT compilation?

**Answer:**

| Aspect | Interpretation | JIT Compilation |
|--------|---------------|-----------------|
| **How** | Decodes and executes bytecode one instruction at a time | Compiles bytecode to native machine code |
| **Speed** | Slower (20-30x) | Fast (comparable to C/C++) |
| **When** | First execution of any method | After method is "hot" (many invocations) |
| **Startup** | Instant — no compilation needed | Adds compilation overhead |
| **Memory** | No code cache needed | Stores native code in Code Cache |

The JVM uses both: interpret first (fast startup), then JIT-compile hot paths (peak performance). This is why Java needs a "warmup" period.

---

### 9. What is `ExceptionInInitializerError` and why is it dangerous?

**Answer:**
It is thrown when a static initializer or static field initialization throws an exception.

**Why it's dangerous:**
1. The class is permanently marked as failed
2. All subsequent references to that class throw `NoClassDefFoundError` (not the original exception)
3. This is irreversible without restarting the JVM

```java
public class Config {
    // If PORT env var is null, parseInt throws NumberFormatException
    // → wrapped in ExceptionInInitializerError
    // → Config class permanently unusable
    static final int PORT = Integer.parseInt(System.getenv("PORT"));
}
```

**Fix:** Handle exceptions inside static blocks with fallback values.

---

## Senior Level

### 7. How would you choose between G1GC and ZGC for a production service?

**Answer:**

| Factor | G1GC | ZGC |
|--------|------|-----|
| **Pause time** | 10-200ms (tunable via MaxGCPauseMillis) | < 1ms (almost always) |
| **Throughput** | Higher | ~5-15% lower |
| **Heap overhead** | ~5-10% | ~15% |
| **Best for** | General purpose, balanced workloads | Latency-sensitive (p99 < 10ms SLA) |
| **Java version** | 9+ (default) | 15+ (production-ready) |

**Decision framework:**
1. If p99 latency SLA < 10ms → ZGC
2. If throughput is primary concern (batch processing) → ParallelGC
3. If balanced latency/throughput → G1GC
4. If heap > 16GB and latency matters → ZGC (G1 pauses grow with heap)

Always benchmark with your actual workload using JMH and GC logging.

---

### 8. How do you handle JVM warmup in a Kubernetes deployment?

**Answer:**

The problem: Kubernetes routes traffic to new pods as soon as their readiness probe passes. If the probe passes before JIT warmup, the pod serves requests at interpreted speed (20-30x slower).

**Solution architecture:**
1. Start the JVM with health/readiness endpoints available immediately
2. Run warmup loop on critical code paths (50K+ iterations to trigger C2)
3. Only return 200 from readiness probe after warmup completes
4. Configure `startupProbe` with sufficient timeout (60-120 seconds)

```yaml
# Kubernetes manifest
startupProbe:
  httpGet:
    path: /ready
    port: 8081
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 20  # Up to 110 seconds for warmup
readinessProbe:
  httpGet:
    path: /ready
    port: 8081
  periodSeconds: 10
```

Additional techniques:
- **AppCDS:** Pre-share class data to reduce class loading time
- **CRaC:** Checkpoint a warmed JVM and restore instantly (~50ms)
- **GraalVM native-image:** Eliminate JVM warmup entirely (trade-off: lower peak perf)

---

### 9. Explain ClassLoader leaks and how to prevent them.

**Answer:**
A ClassLoader leak occurs when an old ClassLoader cannot be garbage collected after an application undeploy/redeploy. Since the ClassLoader holds references to all classes it loaded, this leaks the entire class hierarchy plus all static data.

**Common causes:**
1. JDBC drivers registered in `DriverManager` (static references)
2. `ThreadLocal` values referencing webapp classes
3. Shutdown hooks referencing webapp objects
4. Background threads started by the webapp
5. JMX MBeans registered with webapp class types

**How to prevent:**
```java
// In ServletContextListener.contextDestroyed():
@Override
public void contextDestroyed(ServletContextEvent event) {
    // 1. Deregister JDBC drivers
    Enumeration<Driver> drivers = DriverManager.getDrivers();
    while (drivers.hasMoreElements()) {
        try { DriverManager.deregisterDriver(drivers.nextElement()); }
        catch (SQLException e) { log.warn("Driver deregister failed", e); }
    }

    // 2. Stop background threads
    executor.shutdownNow();

    // 3. Clear ThreadLocals
    // (Use Tomcat's JreMemoryLeakPreventionListener)

    // 4. Deregister MBeans
    MBeanServer mbs = ManagementFactory.getPlatformMBeanServer();
    // ... deregister application MBeans
}
```

**Detection:** Take a heap dump, open in Eclipse MAT, and look for "Duplicate Classes" or find the GC root path for the old ClassLoader.

---

### 10. How does JIT deoptimization work and when does it happen?

**Answer:**
The JIT compiler makes **speculative optimizations** based on profiling data. When an assumption is invalidated, the JVM must **deoptimize** — replace the optimized native code with interpretation.

**Common causes:**
1. **Class hierarchy change:** JIT inlined a virtual call assuming only one implementation. A new subclass is loaded → assumption broken.
2. **Uncommon trap:** A branch that was never taken during profiling is suddenly taken.
3. **Type speculation failure:** JIT assumed a variable was always `Integer`, but `Long` appears.

**What happens internally:**
1. Compiled code is marked "not entrant" (cannot be entered again)
2. Currently executing threads finish their current activation
3. Method falls back to interpreter
4. JVM may recompile later with updated profile data

```bash
# Observe deoptimization
java -XX:+PrintCompilation MyApp 2>&1 | grep "made not entrant"
```

**Impact:** Sudden latency spike as hot methods are re-interpreted. In extreme cases (deoptimization storm), p99 latency can spike 10-50x.

---

### 11. What are the key JVM flags you would set for every production Java application?

**Answer:**

```bash
java \
  # Memory
  -Xms4g -Xmx4g \                          # Fixed heap (no resize pauses)
  -XX:MaxRAMPercentage=75 \                 # Container-aware (alternative to Xmx)
  -XX:+HeapDumpOnOutOfMemoryError \         # Auto heap dump on OOM
  -XX:HeapDumpPath=/var/dumps/ \

  # GC
  -XX:+UseG1GC \                            # Or UseZGC for low-latency
  -XX:MaxGCPauseMillis=200 \                # G1 pause target

  # Logging
  -Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags \

  # Security
  -XX:+DisableAttachMechanism \             # Prevent runtime agent injection

  # Diagnostics
  -XX:+UnlockDiagnosticVMOptions \
  -XX:+LogCompilation \                     # JIT compilation log

  -jar application.jar
```

**Rationale:** Each flag has a specific purpose. The key principle is: make the JVM predictable (fixed heap, explicit GC) and observable (GC logs, heap dumps, JIT logs).

---

## Scenario-Based Questions

### 12. Your Spring Boot application takes 8 seconds to start in Kubernetes. The team wants it under 3 seconds. How do you approach this?

**Answer:**

Step-by-step approach:

1. **Measure:** Profile startup with JFR to find the bottleneck:
   ```bash
   java -XX:StartFlightRecording=duration=30s,filename=startup.jfr -jar app.jar
   ```

2. **Identify:** Common startup bottlenecks:
   - Class loading (check with `-verbose:class` — how many classes?)
   - Component scanning (how many packages does `@SpringBootApplication` scan?)
   - Bean initialization (any `@PostConstruct` doing I/O?)

3. **Optimize (incremental):**
   - **AppCDS:** Create shared class archive → 30-40% improvement
   - **Lazy initialization:** `spring.main.lazy-initialization=true` → defers non-essential beans
   - **Reduce classpath:** Remove unused dependencies → fewer classes to scan
   - **Index scanning:** Use `spring-context-indexer` → skip runtime scanning

4. **If still not enough:**
   - **GraalVM native-image** (Spring Boot 3 AOT): ~100ms startup
   - **CRaC checkpoint/restore:** ~50ms startup with JIT performance

---

### 13. A Java microservice shows p99 latency spikes of 500ms every 30 seconds. Steady-state p50 is 2ms. What's your diagnosis?

**Answer:**

Pattern analysis: Regular 500ms spikes every 30 seconds → likely **GC pauses**.

Diagnosis steps:
1. **Enable GC logging:** `-Xlog:gc*:file=gc.log:time`
2. **Analyze GC log:** Look for STW pauses matching the pattern
3. **Check GC type:**
   - If G1GC Mixed Collection → Old Gen filling up, triggering mixed GC
   - If Full GC → Promotion failure or Metaspace exhaustion

Likely root causes:
- **Young Gen too small:** Objects promoted to Old too quickly → mixed GC
- **Allocation rate too high:** Increase heap or Young Gen ratio
- **Large allocations:** Humongous objects in G1 triggering concurrent marking

Fix (depending on root cause):
```bash
# If G1 pauses are too long:
java -XX:+UseZGC -Xms8g -Xmx8g -jar app.jar  # Sub-ms pauses

# If allocation rate is high:
java -XX:+UseG1GC -XX:NewRatio=1 -Xms8g -Xmx8g -jar app.jar  # Larger Young Gen
```

---

### 14. You deploy a new version of your Java app and requests fail with `NoClassDefFoundError` for a class that exists in your JAR. What happened?

**Answer:**

This is subtle: `NoClassDefFoundError` (not `ClassNotFoundException`) means the class WAS found at some point but failed to initialize.

Likely cause: The class has a static initializer that threw an exception on first load. The first thread got `ExceptionInInitializerError`, and all subsequent threads get `NoClassDefFoundError`.

Diagnosis:
1. Check application logs for `ExceptionInInitializerError` — it may have been logged once and then ignored
2. Common triggers: database connection in static block, missing environment variable, resource file not found in JAR

Fix:
```java
// ❌ Static initializer that can fail
static final DataSource DS = createDataSource(); // throws if DB is unreachable

// ✅ Lazy initialization with retry
private static volatile DataSource ds;
static DataSource getDataSource() {
    if (ds == null) {
        synchronized (Config.class) {
            if (ds == null) ds = createDataSource();
        }
    }
    return ds;
}
```

---

### 15. After upgrading from Java 17 to Java 21, your application runs 10% slower for the first minute, then performs the same. Why?

**Answer:**

The JIT compiler profile data from Java 17 is not compatible with Java 21. The first minute after startup, the JVM is collecting fresh profiling data and recompiling with the new JIT.

Additionally, Java 21 may use different default JVM flags:
- Default GC might have changed behavior
- Default tiered compilation thresholds may differ
- New JIT optimizations may take longer to kick in

Fixes:
- **Expected behavior:** The 10% slowdown during warmup is normal. Monitor steady-state performance.
- **If warmup is critical:** Extend warmup phase, use CRaC for instant restore with pre-compiled JIT code
- **Check flags:** `java -XX:+PrintFlagsFinal -version 2>&1 | diff` between Java 17 and 21 defaults

---

## FAQ

### Q: What's the difference between compile-time and runtime in Java?

**A:** Compile-time is when `javac` processes your `.java` files — it checks syntax, types, and generates bytecode. Runtime is when the JVM executes the bytecode — this is when `NullPointerException`, `ClassCastException`, and GC happen. Some errors only manifest at runtime (e.g., `ArrayIndexOutOfBoundsException`) even though the code compiles fine.

### Q: Can I run a Java program without the `main` method?

**A:** In Java 7 and earlier, you could use a static initializer with `System.exit(0)`. From Java 8+, the JVM checks for `main` before running initializers, so this no longer works. Java 21+ introduces `void main()` (JEP 463 preview) as a simpler entry point.

### Q: Is Java interpreted or compiled?

**A:** Both. Java source is **compiled** by `javac` to bytecode. The JVM then **interprets** bytecode initially and **JIT-compiles** hot bytecode to native code. So Java is a "compiled-then-interpreted-then-JIT-compiled" language.

### Q: What do interviewers look for when asking about the Java program lifecycle?

**A:** Key evaluation criteria:
- **Junior:** Can describe the basic flow (write → compile → run), knows what bytecode is, understands GC exists
- **Middle:** Can explain ClassLoader delegation, JIT warmup impact, common lifecycle errors (`ClassNotFoundException` vs `NoClassDefFoundError`), and shutdown hooks
- **Senior:** Can discuss GC algorithm selection with trade-offs, JVM flag tuning, warmup strategies for Kubernetes, ClassLoader leak prevention, and JIT deoptimization

### Q: How does the JVM handle multiple threads during GC?

**A:** During stop-the-world (STW) GC pauses, the JVM brings all application threads to a "safepoint" — a known state where the thread is not modifying the heap. All threads must reach a safepoint before GC can begin. This is why long loops without method calls can delay GC for all threads (the safepoint problem). Concurrent GC algorithms (G1, ZGC) minimize STW pauses by doing most work concurrently with application threads.
