# Java Language Specification — Loops
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html

---

## 1. Spec Reference

- **JLS Chapter 14**: Blocks, Statements, and Patterns — https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html
- **JLS §14.12**: The `while` Statement
- **JLS §14.13**: The `do-while` Statement
- **JLS §14.14**: The `for` Statement
- **JLS §14.14.1**: The Basic `for` Statement
- **JLS §14.14.2**: The Enhanced `for` Statement
- **JLS §14.15**: The `break` Statement
- **JLS §14.16**: The `continue` Statement
- **JLS §14.7**: Labeled Statements
- **JLS §16**: Definite Assignment (interaction with loops)
- **JLS §6.3.1**: Scope of Local Variable Declarations in Blocks

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §14.12: while Statement --
WhileStatement:
    while ( Expression ) Statement

WhileStatementNoShortIf:
    while ( Expression ) StatementNoShortIf

-- JLS §14.13: do-while Statement --
DoStatement:
    do Statement while ( Expression ) ;

-- JLS §14.14.1: Basic for Statement --
BasicForStatement:
    for ( [ForInit] ; [Expression] ; [ForUpdate] ) Statement

BasicForStatementNoShortIf:
    for ( [ForInit] ; [Expression] ; [ForUpdate] ) StatementNoShortIf

ForInit:
    StatementExpressionList
    LocalVariableDeclaration

ForUpdate:
    StatementExpressionList

StatementExpressionList:
    StatementExpression { , StatementExpression }

-- JLS §14.14.2: Enhanced for Statement --
EnhancedForStatement:
    for ( {VariableModifier} LocalVariableType VariableDeclaratorId :
          Expression ) Statement

EnhancedForStatementNoShortIf:
    for ( {VariableModifier} LocalVariableType VariableDeclaratorId :
          Expression ) StatementNoShortIf

-- JLS §14.15: break Statement --
BreakStatement:
    break [Identifier] ;

-- JLS §14.16: continue Statement --
ContinueStatement:
    continue [Identifier] ;

-- JLS §14.7: Labeled Statements --
LabeledStatement:
    Identifier : Statement

LabeledStatementNoShortIf:
    Identifier : StatementNoShortIf

-- Note: Labels are used with break and continue for nested loop control.
```

---

## 3. Core Rules & Constraints

### 3.1 `while` Statement Rules (JLS §14.12)
- Condition must be a `boolean` (or `Boolean`, which is unboxed).
- Condition is evaluated before each iteration.
- If condition is initially `false`, the body never executes.
- `while (true)` is an infinite loop — requires `break`, `return`, or `throw` to exit.

### 3.2 `do-while` Statement Rules (JLS §14.13)
- Body executes **at least once** before condition is checked.
- Condition is evaluated after each iteration.
- Terminates when condition becomes `false`.
- Trailing semicolon `;` is required: `do { } while (cond);`

### 3.3 Basic `for` Statement Rules (JLS §14.14.1)
- **ForInit**: executed once before loop begins. Can declare local variable(s).
- **Condition** (middle expression): evaluated before each iteration. If omitted, always `true`.
- **ForUpdate**: executed after each iteration. Can have multiple expressions separated by `,`.
- Variables declared in ForInit are scoped to the entire `for` statement (init + condition + update + body).
- Multiple variables in ForInit must all be of the same type: `for (int i=0, j=10; i<j; i++, j--)`.

### 3.4 Enhanced `for` Statement Rules (JLS §14.14.2)
- Works on arrays and `Iterable<T>` only.
- For arrays: behaves as index-based loop from 0 to `arr.length - 1`.
- For `Iterable`: calls `iterator()`, then uses `hasNext()` and `next()`.
- The loop variable is a **new local variable** per iteration — not an alias to the array element.
- Cannot modify the array/collection via the loop variable (for reference types, can modify the object the variable points to, but not the slot itself).
- `final` modifier is allowed for the loop variable: `for (final int x : arr)`.

### 3.5 `break` Statement Rules (JLS §14.15)
- Unlabeled `break`: exits the **innermost** enclosing `switch`, `for`, `while`, or `do-while`.
- Labeled `break`: exits the statement with the matching label.
- `break` cannot exit a method or constructor body.
- Unreachable code after `break` is a compile error.

### 3.6 `continue` Statement Rules (JLS §14.16)
- Unlabeled `continue`: skips the rest of the body of the **innermost** enclosing loop.
- In `for` loop: jumps to the ForUpdate expression, then re-checks condition.
- In `while`/`do-while`: jumps directly to re-checking the condition.
- Labeled `continue`: applies to the enclosing loop with the matching label.
- `continue` inside a `switch` inside a loop: applies to the enclosing loop, not the switch.

### 3.7 Labeled Statement Rules (JLS §14.7)
- Any statement can be labeled with an identifier followed by `:`.
- Labels follow identifier naming rules.
- A label's scope is the statement it labels.
- Label identifiers do not conflict with variable identifiers (different namespaces).

---

## 4. Type Rules

### 4.1 Loop Condition Type Rules
- `while` and `do-while`: condition must be of type `boolean`.
- `for` condition: must be of type `boolean` (if present).
- `for (;;)` is equivalent to `for (;true;)` — infinite loop without `true` literal.

### 4.2 Enhanced for Loop Element Type
- For `T[]`: loop variable type must be assignment-compatible with `T`.
- Widening is allowed: `for (double d : intArray)` is legal.
- For `Iterable<T>`: loop variable must be assignment-compatible with `T`.
- `var` is allowed: `for (var item : collection)` infers the element type.

### 4.3 Definite Assignment in Loops (JLS §16.2)
- Variables declared before a loop and used after must be definitely assigned on all paths.
- Variables assigned in a loop body are not considered definitely assigned after the loop (the loop may never execute).
- `while (true)` loops: if the only exit is `return`/`throw`, code after is unreachable.

---

## 5. Behavioral Specification

### 5.1 `for` Loop Execution Order (JLS §14.14.1)
1. Execute ForInit (once).
2. Evaluate condition; if `false` (or omitted and `true`), proceed or exit.
3. Execute loop body.
4. Execute ForUpdate.
5. Go to step 2.

### 5.2 Enhanced `for` Array Expansion (JLS §14.14.2)
The enhanced for:
```java
for (int x : array) { body }
```
is equivalent to:
```java
for (int i = 0, len = array.length; i < len; i++) {
    int x = array[i];
    body
}
```
The array expression is evaluated **once** before the loop starts.

### 5.3 Enhanced `for` Iterable Expansion (JLS §14.14.2)
```java
for (T x : iterable) { body }
```
is equivalent to:
```java
Iterator<T> iter = iterable.iterator();
while (iter.hasNext()) {
    T x = iter.next();
    body
}
```
The iterable expression is evaluated **once**.

### 5.4 Labeled `break`/`continue` Semantics
- `break label;` transfers control to just after the labeled statement.
- `continue label;` transfers control to the update/condition of the labeled loop.
- The label must lexically enclose the `break`/`continue` statement.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| `while (true)` with no exit | Infinite loop; terminates only by exception/return/break |
| `for (int i=0; i<10; i++)` | Executes exactly 10 times |
| `for (;;)` | Infinite loop (condition omitted = always true) |
| `break` outside loop/switch | Compile error |
| `continue` outside loop | Compile error |
| Enhanced for over null array | `NullPointerException` |
| Enhanced for over null `Iterable` | `NullPointerException` |
| Modifying list during enhanced for | `ConcurrentModificationException` (for most `List` implementations) |
| `for (int i=0, long j=0; ...)` | Compile error: all ForInit vars must be same type |
| Infinite loop before unreachable code | Unreachable code compile error only if JLS-detectable |

---

## 7. Edge Cases from Spec

### 7.1 for Loop Variable Scope
```java
for (int i = 0; i < 5; i++) {
    // i is in scope here
}
// i is NOT in scope here

// Two for loops can reuse same variable name:
for (int i = 0; i < 3; i++) { }
for (int i = 0; i < 3; i++) { }  // OK — each for creates new scope
```

### 7.2 ForInit with Multiple Variables
```java
// Legal: multiple variables of same type
for (int i = 0, j = 10; i < j; i++, j--) {
    System.out.println(i + " " + j);
}
// Illegal: mixed types in ForInit
// for (int i = 0, long j = 0; ...) { }  // COMPILE ERROR
```

### 7.3 Enhanced for Does Not Reflect Writes
```java
int[] numbers = {1, 2, 3};
for (int n : numbers) {
    n = n * 2;  // modifies local copy only — does NOT change numbers array
}
System.out.println(java.util.Arrays.toString(numbers));  // [1, 2, 3] unchanged
```

### 7.4 Labeled `break` for Nested Loops
```java
outer:
for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
        if (i == 1 && j == 1) {
            break outer;  // exits BOTH loops
        }
        System.out.println(i + "," + j);
    }
}
// Prints: 0,0  0,1  0,2  1,0  (stops here)
```

### 7.5 `continue` in `for` vs `while`
```java
// In for: continue goes to ForUpdate
for (int i = 0; i < 5; i++) {
    if (i == 3) continue;  // jumps to i++
    System.out.print(i + " ");  // 0 1 2 4
}

// In while: continue goes to condition check
int j = 0;
while (j < 5) {
    j++;
    if (j == 3) continue;  // jumps to condition
    System.out.print(j + " ");  // 1 2 4 5
}
```

### 7.6 Infinite Loop with `break`
```java
int n = 1;
while (true) {
    if (n > 100) break;
    n *= 2;
}
System.out.println(n);  // 128 — variable n is definitely assigned after loop
// because break guarantees the loop exits with n defined
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | `while`, `do-while`, basic `for`, `break`, `continue`, labels | JLS 1st ed. |
| Java 5 | Enhanced `for` loop (for-each); works on arrays and `Iterable` | JSR 201 |
| Java 8 | Stream API as alternative to loops; `forEach()` method | JEP 107 |
| Java 9 | `Stream.iterate(seed, predicate, step)` — bounded infinite stream | JDK 9 API |
| Java 10 | `var` in enhanced for loop variable | JEP 286 |
| Java 11 | `var` in lambda parameters | JEP 323 |
| Java 16 | Records reduce boilerplate in loop bodies | JEP 395 |
| Java 21 | Virtual threads make thread-per-task loops scalable | JEP 444 |
| Java 21 | Sequenced collections (`reversed()`) improves reverse-order iteration | JEP 431 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 JVM Bytecode for Loops
- `while` and `do-while` compile to a combination of `goto` and `ifeq`/`ifne` instructions.
- `for` loop ForInit compiles to pre-loop code; ForUpdate appends to loop body.
- `break` compiles to `goto` (jump to after the loop).
- `continue` compiles to `goto` (jump to the ForUpdate or condition check).

### 9.2 JIT Loop Optimization
- **Loop unrolling**: JIT may unroll small loops to reduce branch overhead.
- **Loop invariant code motion**: expressions that don't change in loop body are hoisted out.
- **Vectorization**: JIT may use SIMD instructions for numeric array loops.
- **Counted loops**: JIT detects `for (int i=0; i<n; i++)` form for optimized treatment.
- **Intrinsification**: `Arrays.fill`, `System.arraycopy` in loops are intrinsified.

### 9.3 `ConcurrentModificationException`
- `ArrayList`, `HashMap` iterators check a `modCount` field.
- Structural modification during iteration throws `ConcurrentModificationException`.
- Use `Iterator.remove()` for safe removal during iteration.
- `CopyOnWriteArrayList` does not throw; iterates over snapshot.

### 9.4 Virtual Threads and Loop Scalability (Java 21)
- Traditional thread-per-connection server with `while(true)` loop: limited by thread count.
- Virtual threads (JEP 444): millions of loops can run concurrently in virtual threads.
- `Thread.sleep()` inside virtual thread loop parks the virtual thread, freeing carrier thread.

---

## 10. Spec Compliance Checklist

- [ ] Loop condition is `boolean`; not `int` or unboxed nullable `Boolean`
- [ ] `for` ForInit variables have correct type; no mixed types
- [ ] `break`/`continue` only inside appropriate enclosing statement
- [ ] Enhanced `for` loop variable mutations do not affect the original array
- [ ] Null check before enhanced `for` over array/`Iterable` reference
- [ ] No `ConcurrentModificationException` from collection modification during iteration
- [ ] Infinite loops have a definite exit path (`break`, `return`, `throw`)
- [ ] Variables assigned only inside loop body are not relied on after loop (may never execute)
- [ ] Labeled `break`/`continue` targets correct enclosing loop
- [ ] `do-while` trailing semicolon is present

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: All Loop Types
// File: LoopTypes.java
import java.util.List;

public class LoopTypes {
    public static void main(String[] args) {
        // while loop
        int i = 1;
        int product = 1;
        while (i <= 5) {
            product *= i;
            i++;
        }
        System.out.println("5! = " + product);  // 120

        // do-while (executes at least once)
        int n = 10;
        do {
            System.out.print(n + " ");
            n -= 3;
        } while (n > 0);
        System.out.println();  // 10 7 4 1

        // Basic for loop
        int sum = 0;
        for (int j = 1; j <= 100; j++) {
            sum += j;
        }
        System.out.println("Sum 1-100: " + sum);  // 5050

        // for with multiple variables
        for (int lo = 0, hi = 10; lo < hi; lo++, hi--) {
            System.out.print("[" + lo + "," + hi + "] ");
        }
        System.out.println();  // [0,10] [1,9] [2,8] [3,7] [4,6]

        // Enhanced for — array
        int[] primes = {2, 3, 5, 7, 11};
        for (int p : primes) {
            System.out.print(p + " ");
        }
        System.out.println();  // 2 3 5 7 11

        // Enhanced for — Iterable
        List<String> fruits = List.of("apple", "banana", "cherry");
        for (String fruit : fruits) {
            System.out.println(fruit.toUpperCase());
        }
    }
}
```

```java
// Example 2: break and continue
// File: BreakContinue.java
public class BreakContinue {
    public static void main(String[] args) {
        // break: exit loop early
        for (int i = 0; i < 100; i++) {
            if (i * i > 50) {
                System.out.println("First i where i*i > 50: " + i);
                break;
            }
        }  // 8

        // continue: skip current iteration
        System.out.print("Odd numbers: ");
        for (int i = 0; i < 10; i++) {
            if (i % 2 == 0) continue;  // skip even
            System.out.print(i + " ");
        }
        System.out.println();  // 1 3 5 7 9

        // Labeled break for nested loops
        outer:
        for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) {
                if (i + j == 5) {
                    System.out.println("First pair summing to 5: " + i + "+" + j);
                    break outer;
                }
            }
        }

        // Labeled continue
        outer:
        for (int i = 1; i <= 3; i++) {
            for (int j = 1; j <= 3; j++) {
                if (j == 2) continue outer;  // skip rest of outer iteration
                System.out.println(i + "," + j);
            }
        }
        // Prints: 1,1   2,1   3,1  (j=2 triggers continue outer each time)
    }
}
```

```java
// Example 3: Common Loop Patterns
// File: LoopPatterns.java
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class LoopPatterns {

    // Binary search
    static int binarySearch(int[] arr, int target) {
        int lo = 0, hi = arr.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;  // avoids overflow vs (lo+hi)/2
            if (arr[mid] == target) return mid;
            if (arr[mid] < target) lo = mid + 1;
            else hi = mid - 1;
        }
        return -1;
    }

    // Safe removal during iteration
    static List<Integer> removeEvens(List<Integer> nums) {
        List<Integer> copy = new ArrayList<>(nums);
        Iterator<Integer> it = copy.iterator();
        while (it.hasNext()) {
            if (it.next() % 2 == 0) {
                it.remove();  // safe: via iterator
            }
        }
        return copy;
    }

    public static void main(String[] args) {
        int[] sorted = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
        System.out.println("Index of 23: " + binarySearch(sorted, 23));   // 5
        System.out.println("Index of 50: " + binarySearch(sorted, 50));   // -1

        List<Integer> nums = new ArrayList<>(List.of(1, 2, 3, 4, 5, 6, 7, 8));
        System.out.println("After removing evens: " + removeEvens(nums));  // [1, 3, 5, 7]

        // Fibonacci with while
        long a = 0, b = 1;
        System.out.print("Fibonacci: ");
        while (b < 1000) {
            System.out.print(b + " ");
            long next = a + b;
            a = b;
            b = next;
        }
        System.out.println();

        // Triangle pattern with nested loops
        for (int row = 1; row <= 5; row++) {
            for (int col = 1; col <= row; col++) {
                System.out.print("* ");
            }
            System.out.println();
        }
    }
}
```

```java
// Example 4: Loop with Streams (Alternative, Java 8+)
// File: StreamLoops.java
import java.util.stream.IntStream;
import java.util.stream.Stream;

public class StreamLoops {
    public static void main(String[] args) {
        // for(int i=0; i<10; i++) equivalent
        IntStream.range(0, 10).forEach(i -> System.out.print(i + " "));
        System.out.println();

        // for(int i=1; i<=10; i++) equivalent
        IntStream.rangeClosed(1, 10)
            .filter(i -> i % 2 != 0)
            .forEach(i -> System.out.print(i + " "));
        System.out.println();  // odd numbers 1-10

        // while (condition) with Stream.iterate (Java 9+)
        Stream.iterate(1, n -> n <= 1000, n -> n * 2)
            .forEach(n -> System.out.print(n + " "));
        System.out.println();  // 1 2 4 8 ... 512

        // Sum with reduce
        int sum = IntStream.rangeClosed(1, 100).sum();
        System.out.println("Sum 1-100: " + sum);  // 5050

        // Parallel stream (automatic parallelism for large data)
        long count = IntStream.rangeClosed(2, 1_000_000)
            .parallel()
            .filter(StreamLoops::isPrime)
            .count();
        System.out.println("Primes up to 1M: " + count);
    }

    static boolean isPrime(int n) {
        if (n < 2) return false;
        for (int i = 2; i * i <= n; i++) {
            if (n % i == 0) return false;
        }
        return true;
    }
}
```

```java
// Example 5: Advanced Loop Usage — Virtual Threads (Java 21)
// File: VirtualThreadLoop.java
import java.util.concurrent.Executors;

public class VirtualThreadLoop {
    public static void main(String[] args) throws InterruptedException {
        // Traditional: blocking loop in platform thread
        int[] counter = {0};
        for (int i = 0; i < 10; i++) {
            counter[0] += computeValue(i);
        }
        System.out.println("Sequential result: " + counter[0]);

        // Virtual threads: parallel loop-like pattern
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = new java.util.concurrent.Future[10];
            for (int i = 0; i < 10; i++) {
                final int idx = i;
                futures[idx] = executor.submit(() -> computeValue(idx));
            }
            // Collect results
            long total = 0;
            for (var f : futures) {
                try {
                    total += (Integer) f.get();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
            System.out.println("Parallel result: " + total);
        }

        // do-while for retry pattern
        int attempts = 0;
        boolean success;
        do {
            success = tryOperation(++attempts);
            System.out.println("Attempt " + attempts + ": " + (success ? "ok" : "retry"));
        } while (!success && attempts < 5);
    }

    static int computeValue(int i) {
        return i * i;
    }

    static boolean tryOperation(int attempt) {
        return attempt >= 3;  // succeeds on 3rd attempt
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §14.12 | while Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.12 |
| JLS §14.13 | do Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.13 |
| JLS §14.14 | for Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.14 |
| JLS §14.15 | break Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.15 |
| JLS §14.16 | continue Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.16 |
| JLS §14.7 | Labeled Statements | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.7 |
| JLS §16 | Definite Assignment | https://docs.oracle.com/javase/specs/jls/se21/html/jls-16.html |
| JEP 444 | Virtual Threads | https://openjdk.org/jeps/444 |
| JEP 431 | Sequenced Collections | https://openjdk.org/jeps/431 |
