# Variables and Scopes — Practical Tasks

## Junior Tasks

### Task 1: Variable Types Explorer

**Type:** 💻 Code

**Goal:** Practice declaring and using all three types of variables

**Instructions:**
1. Create a class `Student` with instance variables: `name` (String), `age` (int), `gpa` (double)
2. Add a static variable `totalStudents` that increments each time a new Student is created
3. Add a `static final` constant `MAX_GPA` with value `4.0`
4. Create a method `displayInfo()` that uses a local variable to format the output
5. In `main`, create 3 students and display their info plus total count

**Starter code:**

```java
public class Main {
    // TODO: Add instance variables, static variable, and constant

    public Main(String name, int age, double gpa) {
        // TODO: Initialize instance variables, increment counter
    }

    public void displayInfo() {
        // TODO: Use a local variable to format and print info
    }

    public static void main(String[] args) {
        // TODO: Create 3 students, display info, print total
    }
}
```

**Expected output:**
```
Student: Alice, Age: 20, GPA: 3.8 (Max GPA: 4.0)
Student: Bob, Age: 22, GPA: 3.5 (Max GPA: 4.0)
Student: Carol, Age: 21, GPA: 3.9 (Max GPA: 4.0)
Total students: 3
```

**Evaluation criteria:**
- [ ] Code compiles and runs
- [ ] Uses all three variable types correctly
- [ ] `static final` constant follows UPPER_SNAKE_CASE naming
- [ ] Local variable used in `displayInfo()`

---

### Task 2: Scope Detective

**Type:** 💻 Code

**Goal:** Understand block scope by predicting and verifying output

**Instructions:**
1. Read the code below, predict the output WITHOUT running it
2. Write your predictions
3. Run the code and compare
4. Fix any compilation errors

```java
public class Main {
    static int x = 100;

    public static void main(String[] args) {
        int x = 10;
        System.out.println("A: " + x);

        {
            int y = 20;
            System.out.println("B: " + x + ", " + y);
        }

        // System.out.println("C: " + y); // What happens if uncommented?

        for (int i = 0; i < 3; i++) {
            int z = i * 10;
            System.out.println("D: i=" + i + ", z=" + z);
        }

        // System.out.println("E: " + i); // What happens if uncommented?

        System.out.println("F: " + Main.x);
    }
}
```

**Expected output:**
```
A: 10
B: 10, 20
D: i=0, z=0
D: i=1, z=10
D: i=2, z=20
F: 100
```

**Evaluation criteria:**
- [ ] Correctly predicted the output
- [ ] Can explain why lines C and E would cause errors
- [ ] Understands the difference between local `x` and `Main.x`

---

### Task 3: Final Variable Practice

**Type:** 💻 Code

**Goal:** Master the `final` keyword for different variable types

**Instructions:**
1. Create a `BankAccount` class with a `final` account number (set in constructor)
2. Add a non-final balance field
3. Create a method that uses `final` local variables for a transfer calculation
4. Demonstrate that final reference types can still be mutated

```java
public class Main {
    // TODO: final instance variable for account number
    // TODO: non-final balance

    public static void main(String[] args) {
        // TODO: Create account, demonstrate final behavior
        // TODO: Show final List can be modified
    }
}
```

**Evaluation criteria:**
- [ ] `final` account number set in constructor, never reassigned
- [ ] Balance can be modified via deposit/withdraw
- [ ] Demonstrates that `final List` contents can change
- [ ] Comments explain the behavior

---

### Task 4: Variable Naming Cleanup

**Type:** 🎨 Design

**Goal:** Apply Java naming conventions to poorly named variables

**Instructions:** Rewrite these variable declarations with proper Java naming conventions:

```java
// Fix all naming issues:
int NUMBER = 5;
String user_name = "Alice";
static int Max_Value = 100;
final double pi_value = 3.14;
boolean IsActive = true;
List<String> DATA = new ArrayList<>();
static final String app_name = "MyApp";
```

**Deliverable:** The corrected code with explanations for each change.

---

## Middle Tasks

### Task 4: Lambda Capture Challenge

**Type:** 💻 Code

**Goal:** Understand effectively final variables and lambda capture

**Scenario:** You're building a text processing pipeline that filters and transforms strings using Stream API.

**Requirements:**
- [ ] Create a list of strings (names)
- [ ] Use a local variable to set a minimum length filter (must be effectively final)
- [ ] Use a lambda to filter names longer than the minimum
- [ ] Use another lambda to add a prefix (captured from local variable)
- [ ] Try to modify the filter variable after the lambda — observe the error
- [ ] Find a workaround using `AtomicInteger` or an array

**Hints:**
<details>
<summary>Hint 1</summary>
An `AtomicInteger` is a mutable object reference — the reference is effectively final even though the value inside changes.
</details>

**Evaluation criteria:**
- [ ] Stream pipeline works correctly
- [ ] Demonstrates effectively final concept
- [ ] Shows workaround for mutable capture
- [ ] Code follows Java conventions

---

### Task 5: ThreadLocal User Context

**Type:** 💻 Code

**Goal:** Implement a safe request context using ThreadLocal

**Scenario:** Build a simplified request processing system where each "request" is handled by a thread. The current user must be accessible throughout the processing chain without passing it as a parameter.

**Requirements:**
- [ ] Create a `RequestContext` class with ThreadLocal storage for user and request ID
- [ ] Implement `set()`, `get()`, and `clear()` methods
- [ ] Process 5 simulated requests using threads
- [ ] Always clear the ThreadLocal in a finally block
- [ ] Print output showing each thread has its own context

**Evaluation criteria:**
- [ ] ThreadLocal properly isolated between threads
- [ ] `clear()` called in finally block
- [ ] Output demonstrates isolation
- [ ] No resource leaks

---

### Task 6: `var` Usage Audit

**Type:** 🎨 Design

**Goal:** Decide where `var` improves or hurts code readability

**Instructions:** For each code snippet, decide: should `var` be used? Write the better version.

```java
// 1
HashMap<String, List<Map<Integer, String>>> complexMap = new HashMap<>();

// 2
int count = getActiveUserCount();

// 3
BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));

// 4
Object result = performOperation();

// 5
String name = "Alice";

// 6
Map.Entry<String, List<Integer>> entry = map.entrySet().iterator().next();
```

---

## Senior Tasks

### Task 7: Volatile vs Synchronized Benchmark

**Type:** 💻 Code

**Goal:** Measure performance difference between volatile, synchronized, and AtomicInteger

**Scenario:** You need to choose the right concurrency mechanism for a high-throughput counter.

**Requirements:**
- [ ] Implement three counter versions: volatile (broken for increment), synchronized, AtomicInteger
- [ ] Run each with 4 threads doing 1,000,000 increments each
- [ ] Measure total time and verify correctness (final count should be 4,000,000)
- [ ] Document which approach is fastest and why

**Provided code to review/optimize:**

```java
public class Main {
    // Version 1: volatile (will it work?)
    private static volatile int volatileCounter = 0;

    // Version 2: synchronized
    private static int syncCounter = 0;
    private static final Object lock = new Object();

    // Version 3: AtomicInteger
    private static final AtomicInteger atomicCounter = new AtomicInteger(0);

    public static void main(String[] args) throws InterruptedException {
        // TODO: Run benchmarks, compare results
    }
}
```

---

### Task 8: Memory Leak Detection

**Type:** 💻 Code

**Goal:** Find and fix a ThreadLocal memory leak in a simulated web server

**Scenario:** The following code simulates request processing with a thread pool. After running for a while, it leaks memory.

```java
import java.util.concurrent.*;

public class Main {
    private static final ThreadLocal<byte[]> requestBuffer = new ThreadLocal<>();
    private static final ExecutorService pool = Executors.newFixedThreadPool(4);

    static void processRequest(int requestId) {
        // Allocate 1MB buffer per request
        requestBuffer.set(new byte[1_024_000]);

        // Process...
        System.out.println("Processing request " + requestId +
            " on thread " + Thread.currentThread().getName());

        // BUG: forgot to clear ThreadLocal!
    }

    public static void main(String[] args) throws Exception {
        for (int i = 0; i < 100; i++) {
            pool.submit(() -> processRequest((int)(Math.random() * 1000)));
        }
        pool.shutdown();
        pool.awaitTermination(10, TimeUnit.SECONDS);
        System.out.println("Done. Each thread still holds a 1MB buffer!");
    }
}
```

**Requirements:**
- [ ] Identify the memory leak
- [ ] Fix it with proper cleanup
- [ ] Add monitoring to verify cleanup
- [ ] Document the fix

---

## Questions

### 1. Why can't you use `var` for method parameters in Java?

**Answer:**
Method parameters are part of the method's public contract (its signature). Using `var` would make the signature ambiguous — callers and documentation tools need to know the exact type. Additionally, method overloading resolution depends on parameter types, which would be impossible with inferred types.

---

### 2. What is the difference between a blank final variable and a regular final variable?

**Answer:**
A blank final is declared without initialization and must be assigned exactly once before use. For instance fields, this must happen in every constructor path. For local variables, the compiler ensures definite assignment.

```java
final int x;      // blank final
x = computeValue(); // assigned once — OK
// x = 10;        // COMPILE ERROR — already assigned
```

---

### 3. Can a local variable and a method parameter have the same name?

**Answer:**
No. Parameters are essentially local variables with method scope. You cannot redeclare a variable with the same name in the method body:

```java
public void test(int x) {
    // int x = 5; // COMPILE ERROR — x already defined as parameter
    if (true) {
        // int x = 5; // ALSO COMPILE ERROR — still in x's scope
    }
}
```

---

### 4. What happens to static variables when a class is unloaded?

**Answer:**
Static variables are destroyed when the class is unloaded. Classes are unloaded when their ClassLoader is garbage collected (which requires all classes loaded by that ClassLoader to be unreachable). In typical applications using the system ClassLoader, classes are never unloaded. In application servers (Tomcat, JBoss), class unloading happens during redeployment.

---

### 5. Why is `String` concatenation with `+` in a loop bad for local variable performance?

**Answer:**
Each `+` creates a new `String` object. In a loop, this creates N intermediate strings that are immediately garbage. Use `StringBuilder`:

```java
// ❌ O(n²) — creates n intermediate String objects
String result = "";
for (String s : items) result += s;

// ✅ O(n) — one StringBuilder, no intermediates
StringBuilder sb = new StringBuilder();
for (String s : items) sb.append(s);
String result = sb.toString();
```

---

### 6. How does `final` affect bytecode generation for local variables?

**Answer:**
`final` on local variables has NO effect on the bytecode. The bytecode for `final int x = 5;` and `int x = 5;` is identical. The `final` keyword is checked only at compile time and does not exist in the class file (no `ACC_FINAL` flag on local variables). It is purely a compile-time check.

---

### 7. Can you access a variable before it's declared in Java?

**Answer:**
For **local variables**: No — forward references are not allowed.
For **instance/static fields**: Limited. You can reference a field in a method before its declaration, but you cannot use it in a field initializer that appears before the declaration:

```java
class Test {
    int a = b;  // COMPILE ERROR — forward reference for field initializer
    int b = 10;

    void method() {
        System.out.println(b); // OK — methods can reference any field
    }
}
```

---

## Mini Projects

### Project 1: Variable Inspector Tool

**Goal:** Build a command-line tool that demonstrates all Java variable concepts

**Description:**
Build a Java application that creates objects, modifies variables, and prints a report showing:
- All variable types and their current values
- Variable scopes (which variables are accessible where)
- Memory estimates (local vs instance vs static)
- Final variable enforcement

**Requirements:**
- [ ] At least 3 classes with different variable types
- [ ] Demonstrates shadowing, scope, and final behavior
- [ ] Outputs a formatted report
- [ ] JUnit 5 tests verifying behavior

**Difficulty:** Junior
**Estimated time:** 2-3 hours

---

## Challenge

### Scope Escape Room

**Problem:** Write a single Java class where:
1. A `static final` variable is used as a compile-time constant
2. A `static` variable tracks the number of method calls
3. An instance variable stores object-specific state
4. A `final` instance variable is set in the constructor
5. A `volatile` variable is used as a shutdown flag between threads
6. A `ThreadLocal` variable holds per-thread state
7. A lambda captures an effectively final local variable
8. Variable shadowing occurs (instance vs local)

All of this must work together in a meaningful program (not just declarations).

**Constraints:**
- Must be a single file runnable with `javac Main.java && java Main`
- Must use at least 2 threads
- Must print output demonstrating each variable type's behavior
- Total code under 100 lines

**Scoring:**
- Correctness: 50% (all 8 variable scenarios work)
- Clarity: 30% (code is readable and well-commented)
- Conciseness: 20% (under 100 lines, no unnecessary code)
