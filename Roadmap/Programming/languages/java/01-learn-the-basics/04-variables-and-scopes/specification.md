# Java Language Specification — Variables and Scopes
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.12

---

## 1. Spec Reference

- **JLS §4.12**: Variables — https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.12
- **JLS §4.12.1**: Variables of Primitive Type
- **JLS §4.12.2**: Variables of Reference Type
- **JLS §4.12.3**: Kinds of Variables
- **JLS §4.12.4**: `final` Variables
- **JLS §4.12.5**: Initial Values of Variables
- **JLS §4.12.6**: Types, Classes, and Interfaces
- **JLS §6.3**: Scope of a Declaration
- **JLS §6.4**: Shadowing and Obscuring
- **JLS §14.4**: Local Variable Declaration Statements
- **JLS §14.14.1**: The Basic `for` Statement
- **JLS §6.5**: Determining the Meaning of a Name
- **JLS §16**: Definite Assignment

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §4.12: Variable Declarations --
-- Variables are declared via FieldDeclaration, LocalVariableDeclaration,
-- FormalParameter, ExceptionParameter, PatternVariable, etc.

-- JLS §8.3: Field Declarations --
FieldDeclaration:
    {FieldModifier} UnannType VariableDeclaratorList ;

FieldModifier:
    Annotation
    public | protected | private
    static | final | transient | volatile

UnannType:
    UnannPrimitiveType
    UnannReferenceType

VariableDeclaratorList:
    VariableDeclarator { , VariableDeclarator }

VariableDeclarator:
    VariableDeclaratorId [= VariableInitializer]

VariableDeclaratorId:
    Identifier [Dims]

VariableInitializer:
    Expression
    ArrayInitializer

-- JLS §14.4: Local Variable Declaration Statements --
LocalVariableDeclaration:
    {VariableModifier} LocalVariableType VariableDeclaratorList

LocalVariableDeclarationStatement:
    LocalVariableDeclaration ;

LocalVariableType:
    UnannType
    var

VariableModifier:
    Annotation
    final

-- JLS §8.4.1: Formal Parameters --
FormalParameter:
    {VariableModifier} UnannType VariableDeclaratorId
    VariableArityParameter

VariableArityParameter:
    {VariableModifier} UnannType {Annotation} ... Identifier

-- JLS §14.20: Exception Parameters --
CatchFormalParameter:
    {VariableModifier} CatchType VariableDeclaratorId

CatchType:
    UnannClassType { | ClassType }

-- JLS §4.12.4: Final Variables --
-- A variable is effectively final if:
-- 1. It is declared final, OR
-- 2. It is not declared final but is never assigned after initial assignment.

-- JLS §16: Definite Assignment --
-- Every local variable must be definitely assigned before its value is accessed.
-- This is tracked via flow analysis at compile time.
```

---

## 3. Core Rules & Constraints

### 3.1 Kinds of Variables (JLS §4.12.3)
Java has **eight** kinds of variables:
1. **Class variables** — `static` fields; exist from class initialization until unloading.
2. **Instance variables** — non-static fields; exist from object creation until GC.
3. **Array components** — unnamed; created with array; destroyed with array.
4. **Method parameters** — scoped to method body; new binding per invocation.
5. **Constructor parameters** — scoped to constructor body; new binding per invocation.
6. **Lambda parameters** — scoped to lambda body.
7. **Exception parameters** — in `catch` clause; scoped to catch block.
8. **Local variables** — declared in method body, constructor body, or initializer block.

### 3.2 Default Initial Values (JLS §4.12.5)
| Type | Default Value |
|------|--------------|
| `byte`, `short`, `int` | `0` |
| `long` | `0L` |
| `float` | `0.0f` |
| `double` | `0.0d` |
| `char` | `'\u0000'` |
| `boolean` | `false` |
| any reference type | `null` |

**Only class/instance variables and array components have default initial values.**
Local variables do NOT have defaults — using them before assignment is a compile error.

### 3.3 `final` Variables (JLS §4.12.4)
- A `final` variable may be assigned exactly once.
- A `final` local variable can be assigned in different branches if only one executes.
- A `final` field with a compile-time constant is a **constant variable**.
- Constant variables with primitive or `String` types are inlined by `javac`.
- Blank `final` fields must be definitely assigned by the end of every constructor.

### 3.4 Scope Rules (JLS §6.3)
- **Class variable / instance variable**: scope is the entire class body (can refer to it before declaration textually, with restrictions on forward references in initializers).
- **Method/constructor parameter**: scope is the method/constructor body.
- **Local variable**: scope from the declaration point to the end of the enclosing block.
- **For-loop init variable**: scope is the for statement (init + condition + update + body).
- **Exception parameter**: scope is the catch block only.
- **Pattern variable** (Java 16+): scope is the "true" part of the enclosing `instanceof` expression.

### 3.5 Shadowing (JLS §6.4.1)
- A local variable can shadow a field with the same name.
- Inside an instance method, `this.fieldName` accesses the shadowed field.
- A local variable in an inner block can shadow a local variable in an outer block.
- A local variable cannot have the same name as another local variable in the same scope.

### 3.6 `var` — Local Variable Type Inference (JLS §14.4, Java 10+)
- `var` is a reserved type name, not a keyword; it can still be used as an identifier in older code (but should not be).
- `var` is only valid for local variables with initializers, for-loop variables, and try-with-resources variables.
- The inferred type is the type of the initializer expression (not `Object`).
- `var` cannot be used for fields, method return types, or parameters.

---

## 4. Type Rules

### 4.1 Definite Assignment (JLS Chapter 16)
- The compiler ensures every local variable is **definitely assigned** before use.
- Definite assignment is tracked through all control flow paths.
- A variable is definitely assigned after `if (x != null)` in the `then` branch.
- Definite assignment uses conservative analysis — false negatives may cause errors even when logically sound.

### 4.2 Effectively Final (JLS §4.12.4, §15.27.2)
- Local variables and parameters used in lambda expressions or inner classes must be **effectively final** (or explicitly `final`).
- A variable is effectively final if it is never assigned after initialization.
- This prevents issues with variable capture in closures.

### 4.3 Variable Re-use in Nested Blocks
```
// JLS §6.3: It is illegal to declare a local variable with the same
// name as a local variable or parameter in an enclosing scope:
void foo(int x) {
    int x = 0;          // compile error: x already defined
    {
        int x = 1;      // compile error: x already defined
    }
}
// But: in for-loop init, the variable is a new scope
for (int i = 0; i < 10; i++) { }
for (int i = 0; i < 10; i++) { }  // OK: each for creates new scope
```

### 4.4 `volatile` Variables (JLS §8.3.1.4)
- `volatile` on an instance or class variable ensures visibility across threads.
- Reads and writes of `volatile` variables are atomic for all types except `long` and `double`.
- For `long` and `double`: the JVM may split read/write into two 32-bit operations unless `volatile`.
- `volatile` does NOT make compound operations (i++) atomic.

### 4.5 `transient` Variables (JLS §8.3.1.3)
- `transient` is a hint to serialization mechanisms to skip this field.
- Has no effect on normal Java code execution.
- Cannot be `static transient` and also `final` (the combination is pointless).

---

## 5. Behavioral Specification

### 5.1 Local Variable Lifetime
- Local variables are allocated on the stack frame (or heap via escape analysis).
- They are created when the block is entered and destroyed when the block is exited.
- JVM may optimize and keep locals in registers.

### 5.2 Field Initialization Order (JLS §12.5, §8.3.2)
- Instance variables are initialized in **textual order** within the class body.
- Initializers and instance initializer blocks are interleaved in textual order.
- Forward references to instance variables in instance initializers are restricted (JLS §8.3.2.3).

### 5.3 Thread Visibility (JLS §17.4)
- Without synchronization, changes to shared variables may not be visible to other threads.
- `volatile` guarantees visibility but not atomicity of compound operations.
- `synchronized` guarantees both mutual exclusion and visibility (memory barrier).
- `final` fields are safely published once constructor completes (JLS §17.5).

### 5.4 Pattern Variable Scope (JLS §6.3.2, Java 16+)
- `instanceof` pattern variables are scoped to the branch where the pattern holds.
- In `if (obj instanceof String s)`, `s` is in scope in the if-body.
- In `if (!(obj instanceof String s))`, `s` is in scope in the else-body.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| Using local variable before assignment | Compile-time error (JLS §16) |
| Instance field not explicitly initialized | Default value assigned automatically |
| `volatile long` on 32-bit JVM | Guaranteed atomic read/write (JLS §17.7) |
| Non-volatile `long` on 32-bit JVM | May be read/written as two 32-bit words (torn read/write) |
| `final` field written after construction | Behavior is unspecified (data race — JLS §17.5) |
| Effectively final check | Conservative: if compiler can't prove it, it's not effectively final |
| Two local vars with same name in same scope | Compile-time error |
| `var` with `null` initializer | Compile-time error (cannot infer type) |
| `var` without initializer | Compile-time error |

---

## 7. Edge Cases from Spec

### 7.1 Blank Final Field
```java
class Config {
    final int timeout;
    Config(boolean fast) {
        if (fast) {
            timeout = 100;
        } else {
            timeout = 5000;
        }
        // OK: exactly one branch assigns timeout in every constructor path
    }
}
```

### 7.2 Forward Reference Restriction
```java
class Broken {
    int a = b + 1;  // compile error: illegal forward reference
    int b = 2;
}

class OK {
    int b = 2;
    int a = b + 1;  // fine: b declared before a
}
```

### 7.3 `var` Type Inference
```java
var list = new java.util.ArrayList<String>(); // inferred: ArrayList<String>
var n = 42;          // inferred: int (NOT Integer)
var x = null;        // COMPILE ERROR: cannot infer type
var y;               // COMPILE ERROR: var requires initializer
```

### 7.4 Effectively Final Capture
```java
void example() {
    int x = 10;  // effectively final
    Runnable r = () -> System.out.println(x);  // OK

    int y = 10;
    y++;  // y is reassigned → no longer effectively final
    // Runnable r2 = () -> System.out.println(y);  // COMPILE ERROR
}
```

### 7.5 Pattern Variable Scope
```java
Object obj = "hello";
if (obj instanceof String s && s.length() > 3) {
    // s is in scope here — pattern match succeeded
    System.out.println(s.toUpperCase());
}
// s is NOT in scope here
```

### 7.6 `volatile` vs `synchronized`
```java
class Counter {
    private volatile int count = 0;

    // NOT atomic: count++ is read-modify-write
    void increment() { count++; }  // thread-unsafe despite volatile

    // Atomic with synchronized
    synchronized void safeIncrement() { count++; }
}
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | All 8 variable kinds defined; definite assignment analysis | JLS 1st ed. |
| Java 1.1 | `final` local variables allowed | JLS 2nd ed. |
| Java 5 | Enhanced for loop variables; varargs parameters | JSR 201 |
| Java 8 | Effectively final (relaxed requirement for lambda capture) | JEP 126 |
| Java 10 | `var` for local variable type inference | JEP 286 |
| Java 11 | `var` in lambda parameters | JEP 323 |
| Java 14 | Pattern matching `instanceof` (preview): pattern variables | JEP 305 |
| Java 16 | Pattern matching `instanceof` (standard) | JEP 394 |
| Java 17 | Pattern variable scope refinements | JLS updates |
| Java 21 | Pattern matching for `switch` — extends pattern variable scope rules | JEP 441 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 Local Variable Storage
- HotSpot JVM stores local variables in the stack frame's local variable table.
- The JIT compiler may eliminate variables entirely (store in registers or inline constants).
- The JVM debug format (`LineNumberTable`, `LocalVariableTable`) records variable scope for debuggers.

### 9.2 Escape Analysis and Stack Allocation
- HotSpot's JIT (C2 compiler) performs escape analysis.
- If an object does not escape a method, it may be stack-allocated (not heap-allocated).
- This makes `var obj = new Foo()` inside a tight loop potentially free of GC pressure.

### 9.3 `volatile` Memory Model
- On x86/x64: `volatile` reads are normal loads; writes use `LOCK XCHG` or `MFENCE` instructions.
- On ARM: `volatile` uses load-acquire / store-release barriers.
- The JVM abstracts this; code is portable but performance varies.

### 9.4 `long`/`double` Tearing
- On 32-bit JVMs: non-volatile `long` and `double` reads/writes may be non-atomic.
- On 64-bit JVMs (modern): typically atomic even without `volatile`, but not guaranteed by spec.
- Always use `volatile` for shared `long`/`double` fields.

---

## 10. Spec Compliance Checklist

- [ ] All local variables initialized before use
- [ ] Blank final fields assigned in all constructor paths
- [ ] Variables used in lambdas/inner classes are `final` or effectively final
- [ ] No two local variables with the same name in the same scope
- [ ] `var` used only for local variables with non-null initializers
- [ ] `volatile` applied to shared mutable `long`/`double` fields
- [ ] Field initialization order matches intended semantics (textual order)
- [ ] Pattern variables used only within their proven scope
- [ ] `final` fields not written after constructor completes
- [ ] Forward references to instance variables avoided in initializers

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Variable Kinds Demonstration
// File: VariableKinds.java
public class VariableKinds {

    // Class variable (static field)
    static int instanceCount = 0;

    // Instance variable
    private final String name;
    private int value;

    // Constructor parameter
    public VariableKinds(String name, int value) {
        this.name = name;      // 'name' is constructor parameter
        this.value = value;
        instanceCount++;
    }

    // Method with local variables and method parameter
    public int compute(int multiplier) {  // 'multiplier' is method parameter
        int result = value * multiplier;  // 'result' is local variable
        return result;
    }

    public static void main(String[] args) {  // 'args' is method parameter
        VariableKinds v1 = new VariableKinds("first", 10);
        VariableKinds v2 = new VariableKinds("second", 20);
        System.out.println("instances: " + instanceCount);  // 2

        // Local variable with var (Java 10+)
        var result = v1.compute(5);
        System.out.println("result: " + result);  // 50

        // Exception parameter
        try {
            int[] arr = new int[0];
            int x = arr[5];  // throws
        } catch (ArrayIndexOutOfBoundsException e) {  // 'e' is exception parameter
            System.out.println("Caught: " + e.getMessage());
        }
    }
}
```

```java
// Example 2: Scope and Shadowing
// File: ScopeDemo.java
public class ScopeDemo {

    private int x = 100;  // instance variable

    public void scopeTest() {
        int x = 200;  // local variable shadows instance variable

        System.out.println("local x: " + x);       // 200
        System.out.println("field x: " + this.x);   // 100

        {  // inner block
            int y = 300;  // y scoped to this block
            System.out.println("inner y: " + y);
        }
        // y not accessible here

        // For-loop creates its own scope
        for (int i = 0; i < 3; i++) {
            int loopLocal = i * 2;
            System.out.println(loopLocal);
        }
        // i and loopLocal not accessible here

        // Can reuse i in a new for-loop
        for (int i = 0; i < 2; i++) {
            System.out.println("second loop i: " + i);
        }
    }

    public static void main(String[] args) {
        new ScopeDemo().scopeTest();
    }
}
```

```java
// Example 3: final and Effectively Final
// File: FinalDemo.java
import java.util.function.Supplier;

public class FinalDemo {

    // Blank final field
    final int maxRetries;

    FinalDemo(boolean strict) {
        maxRetries = strict ? 3 : 10;  // assigned in constructor
    }

    public Supplier<String> makeGreeter(String name) {
        // 'name' is effectively final (never reassigned)
        return () -> "Hello, " + name;  // captures effectively final
    }

    public void demonstrateVar() {
        // var type inference
        var message = "Inferred String";    // type: String
        var number = 42;                    // type: int
        var list = new java.util.ArrayList<Integer>();  // type: ArrayList<Integer>

        list.add(1);
        list.add(2);

        for (var item : list) {  // item: Integer
            System.out.println(item);
        }
    }

    public static void main(String[] args) {
        FinalDemo demo = new FinalDemo(true);
        System.out.println("maxRetries: " + demo.maxRetries);

        Supplier<String> greeter = demo.makeGreeter("World");
        System.out.println(greeter.get());

        demo.demonstrateVar();
    }
}
```

```java
// Example 4: Pattern Variables (Java 16+)
// File: PatternVariables.java
public class PatternVariables {

    sealed interface Shape permits Circle, Rect {}
    record Circle(double radius) implements Shape {}
    record Rect(double width, double height) implements Shape {}

    static double area(Shape shape) {
        // Pattern matching instanceof (JEP 394)
        if (shape instanceof Circle c) {
            return Math.PI * c.radius() * c.radius();
        } else if (shape instanceof Rect r) {
            return r.width() * r.height();
        }
        return 0;
    }

    // Pattern matching switch (JEP 441, Java 21)
    static String describe(Object obj) {
        return switch (obj) {
            case Integer i when i < 0 -> "negative int: " + i;
            case Integer i            -> "positive int: " + i;
            case String s             -> "string of length " + s.length();
            case null                 -> "null value";
            default                   -> "other: " + obj.getClass().getSimpleName();
        };
    }

    public static void main(String[] args) {
        System.out.println(area(new Circle(5.0)));
        System.out.println(area(new Rect(3.0, 4.0)));
        System.out.println(describe(-5));
        System.out.println(describe("hello"));
        System.out.println(describe(null));
    }
}
```

```java
// Example 5: volatile and Thread Safety
// File: VolatileDemo.java
public class VolatileDemo {

    // volatile ensures visibility across threads
    private volatile boolean running = true;
    private volatile int counter = 0;

    // For true atomicity, use AtomicInteger
    private final java.util.concurrent.atomic.AtomicInteger atomicCounter
        = new java.util.concurrent.atomic.AtomicInteger(0);

    public void start() throws InterruptedException {
        Thread worker = new Thread(() -> {
            while (running) {
                counter++;  // NOT atomic (read-modify-write), but visible
                atomicCounter.incrementAndGet();  // atomic
            }
        });

        worker.start();
        Thread.sleep(10);
        running = false;  // volatile write — visible to worker thread
        worker.join();

        System.out.println("counter (may be imprecise): " + counter);
        System.out.println("atomicCounter (precise): " + atomicCounter.get());
    }

    public static void main(String[] args) throws InterruptedException {
        new VolatileDemo().start();
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §4.12 | Variables | https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.12 |
| JLS §6.3 | Scope of a Declaration | https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.3 |
| JLS §6.4 | Shadowing and Obscuring | https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.4 |
| JLS §14.4 | Local Variable Declarations | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.4 |
| JLS §16 | Definite Assignment | https://docs.oracle.com/javase/specs/jls/se21/html/jls-16.html |
| JLS §17 | Threads and Locks | https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html |
| JEP 286 | Local-Variable Type Inference | https://openjdk.org/jeps/286 |
| JEP 323 | var in Lambda Parameters | https://openjdk.org/jeps/323 |
| JEP 394 | Pattern Matching instanceof | https://openjdk.org/jeps/394 |
| JEP 441 | Pattern Matching switch | https://openjdk.org/jeps/441 |
