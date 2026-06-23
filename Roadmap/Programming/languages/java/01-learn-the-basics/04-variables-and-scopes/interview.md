# Variables and Scopes — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What are the different types of variables in Java?

**Answer:**
Java has three types of variables:
- **Local variables** — declared inside methods, constructors, or blocks. They must be initialized before use and have no default values.
- **Instance variables (fields)** — declared inside a class but outside methods. Each object gets its own copy. They have default values (`0`, `null`, `false`).
- **Static (class) variables** — declared with the `static` keyword. Shared among all instances of the class.

```java
public class Example {
    static int classVar = 0;   // static variable
    int instanceVar = 0;       // instance variable

    public void method() {
        int localVar = 0;      // local variable
    }
}
```

---

### 2. What is the difference between `final` and `static final` in Java?

**Answer:**
- `final` on a local or instance variable means the variable can only be assigned once — it cannot be reassigned.
- `static final` makes a class-level constant — there is one copy shared by all objects, and it cannot be reassigned.

```java
final int x = 10;              // instance-level, one per object, cannot reassign
static final int MAX = 100;    // class-level, one copy total, cannot reassign
```

Convention: `static final` constants use `UPPER_SNAKE_CASE`.

---

### 3. What is variable scope in Java?

**Answer:**
Scope is the region of code where a variable is accessible. Java has three scope levels:
- **Block scope:** Variables declared inside `{}` are only visible within that block
- **Method scope:** Parameters and locals are visible throughout the method
- **Class scope:** Instance and static fields are visible throughout the class

```java
if (true) {
    int x = 5; // block scope — only visible inside this if
}
// x is NOT accessible here
```

---

### 4. Why do local variables not have default values?

**Answer:**
Local variables are stored on the stack and are cheap to create. Java requires explicit initialization to prevent bugs — using an uninitialized variable is almost always a programming error. The compiler catches this at compile time, which is safer than silently using a default value that might be incorrect.

Instance and static variables get defaults because they may be initialized through different code paths (constructors, setters, dependency injection).

---

### 5. What is variable shadowing?

**Answer:**
Shadowing occurs when a variable in an inner scope has the same name as a variable in an outer scope. The inner variable "hides" the outer one.

```java
public class Example {
    int x = 10;
    public void test() {
        int x = 20; // shadows the instance variable
        System.out.println(x);      // 20 (local)
        System.out.println(this.x); // 10 (instance)
    }
}
```

Note: Java allows shadowing instance variables with locals, but does NOT allow shadowing one local variable with another in a nested block.

---

### 6. What does the `final` keyword do when applied to a reference variable?

**Answer:**
`final` on a reference variable means the reference cannot point to a different object. However, the object itself can still be modified.

```java
final List<String> names = new ArrayList<>();
names.add("Alice");           // OK — modifying the object
// names = new ArrayList<>(); // COMPILE ERROR — reassigning the reference
```

---

### 7. Can you declare the same variable name in two separate `for` loops?

**Answer:**
Yes. Each `for` loop creates its own block scope. The variable from the first loop goes out of scope before the second loop starts.

```java
for (int i = 0; i < 5; i++) { }
for (int i = 0; i < 3; i++) { } // OK — no conflict
```

---

## Middle Level

### 1. What are effectively final variables and why do they matter?

**Answer:**
An effectively final variable is one whose value is never changed after initialization, even without the `final` keyword. Since Java 8, lambda expressions and anonymous classes can only capture local variables that are effectively final.

```java
String prefix = "Hello"; // effectively final
names.forEach(name -> System.out.println(prefix + " " + name)); // OK

String mutable = "Hi";
mutable = "Hey"; // no longer effectively final
// names.forEach(name -> System.out.println(mutable)); // COMPILE ERROR
```

This restriction exists because lambdas capture the **value**, not the variable. If the variable could change, the lambda's copy would be stale.

---

### 2. Explain the `var` keyword. Can it be used for fields?

**Answer:**
`var` (Java 10+) enables local variable type inference. The compiler determines the type from the initializer expression. It can only be used for:
- Local variables with an initializer
- `for` loop variables
- `try-with-resources` variables

It **cannot** be used for:
- Instance or static fields
- Method parameters
- Return types
- Declarations without initializers

```java
var list = new ArrayList<String>(); // inferred as ArrayList<String>
// var x; // COMPILE ERROR — no initializer to infer from
```

---

### 3. What happens if you use a mutable static variable in a Spring singleton bean?

**Answer:**
A Spring singleton bean has one instance shared across all requests and threads. A mutable static variable compounds the problem — it's shared across ALL beans, not just instances.

Problems:
- **Race conditions:** Multiple threads read/write without synchronization
- **Memory leaks:** Data accumulates if not cleared
- **Data leakage:** One user's data visible to another

```java
// ❌ Bug
@Service
public class OrderService {
    private static List<Order> processedOrders = new ArrayList<>(); // shared globally!
}
```

Fix: Use request-scoped local variables, or thread-safe bounded caches like `ConcurrentHashMap` with TTL.

---

### 4. How does `ThreadLocal` work and what are its pitfalls?

**Answer:**
`ThreadLocal` provides per-thread variable storage. Each thread gets its own isolated copy of the value.

```java
private static final ThreadLocal<DateFormat> formatter =
    ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));

// Each thread uses its own DateFormat instance
String date = formatter.get().format(new Date());
```

**Pitfalls:**
- **Memory leak with thread pools:** Threads are reused, so ThreadLocal values persist. Must call `remove()` after use.
- **Not compatible with virtual threads (Java 21):** Virtual threads may create millions of instances, wasting memory. Use `ScopedValue` instead.
- **Hidden coupling:** Data flow through ThreadLocal is invisible in method signatures.

---

### 5. What is the difference between `volatile` and `final` for variable visibility?

**Answer:**
Both provide visibility guarantees in multithreaded code, but differently:

- **`volatile`:** Every read goes to main memory; every write flushes to main memory. Provides happens-before ordering. The variable can be written multiple times.
- **`final`:** The value is set once during construction. The JMM guarantees that all threads see the correctly constructed final field value (safe publication).

```java
volatile boolean running = true; // can be changed; changes visible to all threads
final String name = "Alice";     // set once; guaranteed visible after construction
```

Use `volatile` for mutable shared state; use `final` for immutable fields.

---

### 6. Can `var` infer types that you can't write explicitly?

**Answer:**
Yes. `var` can infer intersection types and anonymous class types that are impossible to write in Java:

```java
// Intersection type — cannot be expressed explicitly
var x = (Comparable<String> & Serializable) "hello";
// x has type: Comparable<String> & Serializable

// Anonymous class with additional methods
var obj = new Object() {
    int customField = 42;
};
System.out.println(obj.customField); // works! — anonymous type retained
```

---

## Senior Level

### 1. Explain escape analysis and how it relates to variable storage.

**Answer:**
Escape analysis is a JIT (C2) optimization that determines whether an object reference "escapes" the method or thread where it was created.

If an object **does not escape:**
- **Stack allocation:** The object can be allocated on the stack instead of the heap
- **Scalar replacement:** The object is decomposed into its fields as local variables
- **Lock elimination:** Synchronization on the object can be removed

```java
public int sumPoint() {
    var p = new Point(3, 4); // doesn't escape — scalar replaced
    return p.x + p.y;        // becomes: return 3 + 4;
}
```

This is important for variable storage because local objects that don't escape never touch the heap, resulting in zero GC pressure.

Verify with: `java -XX:+PrintEscapeAnalysis -XX:+PrintEliminateAllocations`

---

### 2. How does the Java Memory Model handle `final` fields in terms of safe publication?

**Answer:**
JLS 17.5 guarantees that when a constructor completes, all final fields are visible to any thread that obtains a reference to the object — even without synchronization.

```java
public class ImmutableConfig {
    private final String host;
    private final int port;

    public ImmutableConfig(String host, int port) {
        this.host = host;
        this.port = port;
    }
}

// Thread A:
config = new ImmutableConfig("localhost", 8080);

// Thread B (sees config != null):
config.host; // guaranteed to see "localhost", not null
config.port; // guaranteed to see 8080, not 0
```

**Without `final`**, Thread B might see default values (`null`, `0`) due to instruction reordering. The `final` keyword creates a "freeze" at the end of the constructor that orders all writes before it.

---

### 3. What is the cost of `volatile` variable access compared to regular variables?

**Answer:**
A `volatile` read/write inserts memory barriers:
- **volatile write:** StoreStore + StoreLoad barriers (flushes write buffer)
- **volatile read:** LoadLoad + LoadStore barriers (invalidates cache)

Benchmark results:
```
Local variable access:   ~0.3 ns (register)
Instance field access:   ~1-2 ns (L1 cache)
Volatile field access:   ~5-20 ns (memory fence)
```

The cost varies by CPU architecture (x86 is cheaper due to TSO memory model; ARM is more expensive).

In practice, volatile is lightweight compared to `synchronized` (~20-50ns uncontended), but avoid it in tight loops.

---

### 4. How does thread stack size (`-Xss`) affect variable storage at scale?

**Answer:**
Each thread gets a fixed-size stack. The stack holds:
- Stack frames (one per method call)
- Local variable arrays (within each frame)
- Operand stacks

Default `-Xss` is typically 512KB-1MB. With 5000 threads: 5000 * 1MB = 5GB just for stacks.

**Optimization strategies:**
- Reduce `-Xss` to 256KB for shallow call stacks
- Use virtual threads (Java 21) — they use heap-backed stacks that grow dynamically
- Reduce local variable count in deeply recursive methods

---

### 5. What is the ScopedValue API and how does it improve upon ThreadLocal?

**Answer:**
`ScopedValue` (Java 21 preview) addresses ThreadLocal's problems:

| Feature | ThreadLocal | ScopedValue |
|---------|------------|-------------|
| Mutability | Mutable | Immutable within scope |
| Cleanup | Manual `remove()` | Automatic |
| Virtual threads | O(n) memory per carrier thread | Efficient — shared structure |
| Inheritance | `InheritableThreadLocal` | Built-in with structured concurrency |

```java
static final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();

ScopedValue.runWhere(CURRENT_USER, user, () -> {
    processRequest(); // can call CURRENT_USER.get()
}); // automatically cleaned up
```

---

## Scenario-Based Questions

### 1. Your Spring Boot application has a memory leak. Investigation shows ThreadLocal objects are accumulating. How do you fix it?

**Answer:**
Step-by-step approach:
1. **Identify the leak:** Take a heap dump with `jmap -dump:format=b,file=heap.hprof <pid>`. Open in Eclipse MAT and search for ThreadLocal$ThreadLocalMap$Entry objects.
2. **Find the source:** Look at which ThreadLocal keys are holding large objects. Check if `remove()` is called.
3. **Fix:** Add a servlet filter or Spring interceptor that calls `remove()` in a `finally` block:

```java
@Component
public class ThreadLocalCleanupFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } finally {
            RequestContext.clear(); // clean ALL ThreadLocals
        }
    }
}
```

4. **Prevent:** Consider migrating to `ScopedValue` (Java 21+) or passing context through method parameters.

---

### 2. A team reports that their test passes individually but fails when run together with other tests. The issue is related to static variables. What's happening?

**Answer:**
Static variables persist across test methods and test classes within the same JVM process. If a test modifies a static variable, subsequent tests see the modified state.

**Diagnosis:**
1. Run the failing test in isolation — if it passes, it's a state leak
2. Check for `static` mutable fields in the code under test

**Fixes:**
- Reset static state in `@BeforeEach` or `@AfterEach`
- Use `@DirtiesContext` in Spring tests to reload the context
- Better: refactor to eliminate mutable static state — use dependency injection

---

### 3. Your application processes 100K events/sec. Profiling shows excessive GC. JFR reveals many short-lived `Pair<String, Integer>` objects in a hot method. How do you optimize?

**Answer:**
1. **Check escape analysis:** Run with `-XX:+PrintEscapeAnalysis` to see if the `Pair` objects escape
2. **If they escape:** Refactor to pass the two values separately (avoid object creation)
3. **If they don't escape:** The JIT should eliminate allocations via scalar replacement — verify with JMH
4. **Structural fix:** Use primitive specialization — replace `Pair<String, Integer>` with two separate parameters or a custom struct-like class with primitive fields

```java
// ❌ Creates a boxed Pair object per event
Pair<String, Integer> result = process(event);

// ✅ Return via output parameters or split method
String key = processKey(event);
int value = processValue(event);
```

---

### 4. You need to share a database connection config across a Spring Boot application. What variable type and scope do you choose?

**Answer:**
Use Spring's `@ConfigurationProperties` with a `record` or `final` fields:

```java
@ConfigurationProperties(prefix = "db")
public record DatabaseConfig(String host, int port, String username) {}
```

This gives you:
- **Immutability** — record fields are inherently final
- **Type safety** — validated at startup
- **Singleton scope** — Spring manages the lifecycle
- **Testability** — can be injected as a constructor parameter

Avoid: `static` fields with hardcoded values, mutable `@Value` fields, ThreadLocal for config.

---

## FAQ

### Q: Should I use `var` in production Java code?

**A:** Yes, with guidelines. Use `var` when:
- The type is obvious from the right side: `var list = new ArrayList<String>()`
- The type is very long: `var entry = map.entrySet().iterator().next()`

Avoid `var` when:
- The type isn't clear: `var result = calculate()` — what type?
- In public API documentation examples

Most teams have a style guide — follow it. IntelliJ IDEA can be configured to flag inappropriate `var` usage.

### Q: What do interviewers look for when asking about variables and scopes?

**A:** Key evaluation criteria:
- **Junior:** Can explain the three variable types, knows about default values and scope
- **Middle:** Understands effectively final, lambda capture, ThreadLocal pitfalls, `var` limitations
- **Senior:** Can discuss JMM implications (volatile, final field semantics), escape analysis, thread stack sizing, and architectural implications of shared state

### Q: Is `final` an optimization hint for the JVM?

**A:** For **local variables**, `final` has no runtime effect — the bytecode is identical. For **instance fields**, `final` enables JMM guarantees (safe publication) and may help the JIT compiler with constant folding. The primary benefit of `final` is **code readability** and **preventing accidental reassignment**.
