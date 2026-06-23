# Java Loops — Find the Bug

> **Practice finding and fixing bugs in Java code related to Loops.**
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
| 🟢 | **Easy** — Common beginner mistakes, off-by-one, basic logic errors |
| 🟡 | **Medium** — ConcurrentModificationException, iterator misuse, break/continue confusion |
| 🔴 | **Hard** — Labeled break bugs, stream vs loop subtleties, JVM-level behavior |

### Scoring

| Difficulty | Points per bug |
|:----------:|:--------------:|
| Easy | 1 point |
| Medium | 2 points |
| Hard | 3 points |

**Total possible: 20 points**

| Score | Level |
|:-----:|:-----:|
| 0-6 | Beginner — review loop basics |
| 7-12 | Intermediate — good foundation |
| 13-17 | Advanced — strong understanding |
| 18-20 | Expert — you know loops deeply |

---

## Easy Bugs (3)

### Bug 1: Off-By-One in For Loop 🟢

**What the code should do:** Print numbers 1 through 5.

```java
public class Main {
    public static void main(String[] args) {
        for (int i = 1; i < 5; i++) {
            System.out.println(i);
        }
    }
}
```

**Expected output:**
```
1
2
3
4
5
```

**Actual output:**
```
1
2
3
4
```

<details>
<summary>💡 Hint</summary>

Look at the loop condition — when `i` equals 5, does the loop body execute?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The loop uses `i < 5` instead of `i <= 5`. When `i` reaches 5, the condition is false and the loop exits before printing 5.
**Why it happens:** Classic off-by-one error — confusing exclusive upper bound (`<`) with inclusive (`<=`).
**Impact:** The last value (5) is never printed.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        // Use <= to include the upper bound
        for (int i = 1; i <= 5; i++) {
            System.out.println(i);
        }
    }
}
```

**What changed:** `i < 5` changed to `i <= 5` to include 5 in the output.

</details>

---

### Bug 2: Infinite While Loop 🟢

**What the code should do:** Print even numbers from 0 to 10.

```java
public class Main {
    public static void main(String[] args) {
        int i = 0;
        while (i <= 10) {
            if (i % 2 == 0) {
                System.out.println(i);
            }
        }
        i++;
    }
}
```

**Expected output:**
```
0
2
4
6
8
10
```

**Actual output:**
```
0
0
0
0
... (infinite loop, prints 0 forever)
```

<details>
<summary>💡 Hint</summary>

Where is the increment statement `i++`? Is it inside or outside the loop body?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The `i++` statement is placed after the closing brace of the `while` loop, so `i` is never incremented inside the loop.
**Why it happens:** Misplaced increment — the curly brace placement puts `i++` outside the loop. The variable `i` stays 0 forever, making the condition `i <= 10` always true.
**Impact:** Infinite loop — the program never terminates, printing 0 endlessly.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int i = 0;
        while (i <= 10) {
            if (i % 2 == 0) {
                System.out.println(i);
            }
            i++; // Moved INSIDE the while loop
        }
    }
}
```

**What changed:** Moved `i++` inside the `while` loop body so the counter increments on each iteration.

</details>

---

### Bug 3: Wrong Do-While Condition 🟢

**What the code should do:** Read user input and sum positive numbers until 0 is entered. Print the sum.

```java
public class Main {
    public static void main(String[] args) {
        int[] inputs = {5, 3, 7, 0, 2}; // Simulating user input
        int index = 0;
        int sum = 0;

        do {
            int value = inputs[index];
            sum += value;
            index++;
        } while (inputs[index] != 0);

        System.out.println("Sum: " + sum);
    }
}
```

**Expected output:**
```
Sum: 15
```

**Actual output:**
```
Sum: 15
```
But this is misleading — the code adds 0 to sum and then checks `inputs[4]` which is 2, not 0, so it continues and eventually throws `ArrayIndexOutOfBoundsException` for some inputs. With `{5, 3, 7, 2, 0}`:
```
Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 5
```

<details>
<summary>💡 Hint</summary>

After incrementing `index`, you check `inputs[index]` — but you already consumed that value. What if the zero was the last element? What index do you check after incrementing past it?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The loop increments `index` before checking the condition, so (1) the value 0 gets added to the sum, and (2) the condition checks the *next* element after 0, which can cause `ArrayIndexOutOfBoundsException` if 0 is the last element.
**Why it happens:** In a `do-while` loop, the condition is evaluated after the body. The index is incremented inside the body, so the condition reads a different index than the one just processed.
**Impact:** Wrong sum (includes 0, but that's harmless) and potential `ArrayIndexOutOfBoundsException`.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int[] inputs = {5, 3, 7, 0, 2}; // Simulating user input
        int index = 0;
        int sum = 0;

        // Check the current value before adding
        while (inputs[index] != 0) {
            sum += inputs[index];
            index++;
        }

        System.out.println("Sum: " + sum);
    }
}
```

**What changed:** Replaced `do-while` with `while` to check the stop condition *before* processing the value, preventing out-of-bounds access and incorrect summation.

</details>

---

## Medium Bugs (4)

### Bug 4: ConcurrentModificationException 🟡

**What the code should do:** Remove all negative numbers from a list.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(List.of(3, -1, 4, -5, 2, -3, 8));

        for (Integer num : numbers) {
            if (num < 0) {
                numbers.remove(num);
            }
        }

        System.out.println(numbers);
    }
}
```

**Expected output:**
```
[3, 4, 2, 8]
```

**Actual output / exception:**
```
Exception in thread "main" java.util.ConcurrentModificationException
```

<details>
<summary>💡 Hint</summary>

The enhanced for loop uses an Iterator internally. What happens when you modify the collection while an Iterator is active?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Modifying an `ArrayList` with `remove()` while iterating over it with an enhanced for loop causes `ConcurrentModificationException`.
**Why it happens:** The enhanced for loop is syntactic sugar for an `Iterator`. The `ArrayList` tracks a `modCount` field; when `remove()` is called directly on the list (not through the iterator), the iterator detects the structural modification on its next `hasNext()`/`next()` call and throws.
**Impact:** `ConcurrentModificationException` at runtime — the program crashes.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(List.of(3, -1, 4, -5, 2, -3, 8));

        // Use Iterator.remove() for safe removal during iteration
        Iterator<Integer> it = numbers.iterator();
        while (it.hasNext()) {
            if (it.next() < 0) {
                it.remove();
            }
        }

        System.out.println(numbers);
    }
}
```

**What changed:** Used an explicit `Iterator` and called `it.remove()` instead of `numbers.remove()`. The iterator's own `remove()` method properly updates the internal `modCount` so no exception is thrown.

**Alternative fix (Java 8+):**
```java
numbers.removeIf(num -> num < 0);
```

</details>

---

### Bug 5: Break Only Exits Inner Loop 🟡

**What the code should do:** Search a 2D matrix for a target value and print its position. Stop searching after the first match.

```java
public class Main {
    public static void main(String[] args) {
        int[][] matrix = {
            {1, 2, 3},
            {4, 5, 6},
            {7, 8, 9}
        };
        int target = 5;

        for (int i = 0; i < matrix.length; i++) {
            for (int j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] == target) {
                    System.out.println("Found " + target + " at (" + i + ", " + j + ")");
                    break;
                }
            }
        }
    }
}
```

**Expected output:**
```
Found 5 at (1, 1)
```

**Actual output:**
```
Found 5 at (1, 1)
```

The output looks correct for this input, but the outer loop continues iterating rows 2 and beyond. If the matrix had duplicates (e.g., target=3 appearing in multiple rows), all matches would print instead of just the first one.

With this matrix and target = 3:
```java
int[][] matrix = {
    {1, 2, 3},
    {3, 5, 6},
    {7, 8, 3}
};
```

**Expected:** `Found 3 at (0, 2)` (only the first match)

**Actual:**
```
Found 3 at (0, 2)
Found 3 at (1, 0)
Found 3 at (2, 2)
```

<details>
<summary>💡 Hint</summary>

The `break` statement only exits the innermost loop it is contained in. The outer loop keeps running. How can you exit both loops at once?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `break` only exits the inner `for` loop. The outer loop continues searching subsequent rows.
**Why it happens:** In Java, an unlabeled `break` terminates only the nearest enclosing `switch`, `for`, `while`, or `do-while` statement (JLS 14.15).
**Impact:** The code finds and prints *all* matches instead of stopping at the first one.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int[][] matrix = {
            {1, 2, 3},
            {3, 5, 6},
            {7, 8, 3}
        };
        int target = 3;

        // Use a labeled break to exit both loops
        search:
        for (int i = 0; i < matrix.length; i++) {
            for (int j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] == target) {
                    System.out.println("Found " + target + " at (" + i + ", " + j + ")");
                    break search; // Exits BOTH loops
                }
            }
        }
    }
}
```

**What changed:** Added the label `search:` before the outer loop and used `break search;` to exit both loops when the target is found.

</details>

---

### Bug 6: Iterator Reuse After Exhaustion 🟡

**What the code should do:** Print all elements of a list twice — first their values, then their squares.

```java
import java.util.Iterator;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> nums = List.of(1, 2, 3, 4, 5);
        Iterator<Integer> it = nums.iterator();

        System.out.println("Values:");
        while (it.hasNext()) {
            System.out.println(it.next());
        }

        System.out.println("Squares:");
        while (it.hasNext()) {
            int n = it.next();
            System.out.println(n * n);
        }
    }
}
```

**Expected output:**
```
Values:
1
2
3
4
5
Squares:
1
4
9
16
25
```

**Actual output:**
```
Values:
1
2
3
4
5
Squares:
```

<details>
<summary>💡 Hint</summary>

After the first `while` loop finishes, what is the state of the iterator? Can you "rewind" it?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The iterator is exhausted after the first loop. `it.hasNext()` returns `false` for the second loop, so it never executes.
**Why it happens:** Java's `Iterator` is a one-pass, forward-only cursor. Once all elements have been consumed, `hasNext()` returns `false` permanently. There is no `reset()` method on the standard `Iterator` interface.
**Impact:** The second loop body never executes — squares are never printed.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> nums = List.of(1, 2, 3, 4, 5);

        System.out.println("Values:");
        for (int n : nums) {
            System.out.println(n);
        }

        // Each enhanced for loop creates a NEW iterator
        System.out.println("Squares:");
        for (int n : nums) {
            System.out.println(n * n);
        }
    }
}
```

**What changed:** Used two separate enhanced for loops instead of reusing one iterator. Each enhanced for loop implicitly calls `nums.iterator()`, creating a fresh iterator.

</details>

---

### Bug 7: Continue Skips Increment in While Loop 🟡

**What the code should do:** Print all numbers from 1 to 10, skipping multiples of 3.

```java
public class Main {
    public static void main(String[] args) {
        int i = 0;
        while (i < 10) {
            i++;
            if (i % 3 == 0) {
                continue;
            }
            System.out.println(i);
        }
    }
}
```

**Expected output:**
```
1
2
4
5
7
8
10
```

**Actual output:**
```
1
2
4
5
7
8
10
```

This version works. But now consider a common variation where the increment is at the bottom:

```java
public class Main {
    public static void main(String[] args) {
        int i = 0;
        while (i < 10) {
            if (i % 3 == 0) {
                continue; // BUG: skips the i++ below!
            }
            System.out.println(i);
            i++;
        }
    }
}
```

**Expected output:**
```
1
2
4
5
7
8
10
```

**Actual output:**
```
(hangs — infinite loop, i stays 0 forever)
```

<details>
<summary>💡 Hint</summary>

When `continue` executes, it jumps back to the loop condition. If the increment `i++` is after the `continue`, what happens to `i`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** When `i` is 0, `i % 3 == 0` is true, so `continue` executes. This skips `i++` at the bottom, so `i` remains 0. The loop never progresses — infinite loop.
**Why it happens:** `continue` in a `while` loop jumps directly to the condition check, bypassing any code after it. Unlike a `for` loop, where the update expression always runs after `continue`.
**Impact:** Infinite loop — the program hangs and never terminates.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        // Option 1: Use a for loop where the update always runs
        for (int i = 1; i <= 10; i++) {
            if (i % 3 == 0) {
                continue; // Safe: i++ in the for header always executes
            }
            System.out.println(i);
        }
    }
}
```

**What changed:** Replaced `while` with a `for` loop. In a `for` loop, the update expression (`i++`) runs after every iteration, even when `continue` is used. This prevents the infinite loop.

**Alternative fix (keeping while):**
```java
int i = 0;
while (i < 10) {
    i++; // Increment BEFORE the continue check
    if (i % 3 == 0) {
        continue;
    }
    System.out.println(i);
}
```

</details>

---

## Hard Bugs (3)

### Bug 8: Labeled Continue Targets Wrong Loop 🔴

**What the code should do:** For each row in a matrix, find the first negative number and skip to the next row. Print all non-negative numbers before the first negative in each row.

```java
public class Main {
    public static void main(String[] args) {
        int[][] matrix = {
            {1, 2, -3, 4},
            {5, -6, 7, 8},
            {9, 10, 11, -12}
        };

        outer:
        for (int i = 0; i < matrix.length; i++) {
            System.out.println("Row " + i + ":");
            inner:
            for (int j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] < 0) {
                    continue inner; // BUG: should be continue outer
                }
                System.out.println("  " + matrix[i][j]);
            }
        }
    }
}
```

**Expected output:**
```
Row 0:
  1
  2
Row 1:
  5
Row 2:
  9
  10
  11
```

**Actual output:**
```
Row 0:
  1
  2
  4
Row 1:
  5
  7
  8
Row 2:
  9
  10
  11
```

<details>
<summary>💡 Hint</summary>

`continue inner` just skips the current element in the inner loop and moves to the next column. It does not skip to the next row. Which label should the `continue` target?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `continue inner` skips only the current iteration of the inner loop, so elements after a negative number are still printed. The intent is to skip to the next row entirely.
**Why it happens:** Labeled `continue` with the inner loop's label behaves identically to an unlabeled `continue`. To skip the rest of the inner loop and advance the outer loop, you must use `continue outer`.
**Impact:** Elements after the first negative number in each row are incorrectly printed (e.g., 4 in row 0, 7 and 8 in row 1).

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int[][] matrix = {
            {1, 2, -3, 4},
            {5, -6, 7, 8},
            {9, 10, 11, -12}
        };

        outer:
        for (int i = 0; i < matrix.length; i++) {
            System.out.println("Row " + i + ":");
            for (int j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] < 0) {
                    continue outer; // Skip to the NEXT ROW
                }
                System.out.println("  " + matrix[i][j]);
            }
        }
    }
}
```

**What changed:** Changed `continue inner` to `continue outer` so that when a negative number is found, the entire inner loop is abandoned and execution continues with the next iteration of the outer loop.

</details>

---

### Bug 9: Stream Collect vs Loop — Side Effect in forEach 🔴

**What the code should do:** Filter a list of names, keeping only those longer than 3 characters, and collect them into a shared result list. This is done from multiple threads.

```java
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

public class Main {
    public static void main(String[] args) {
        List<String> names = List.of("Al", "Bob", "Charlie", "Dave", "Eve", "Franklin",
                "Gus", "Hannah", "Ivy", "Jack", "Kate", "Liam");

        List<String> result = new ArrayList<>();

        // Using parallel stream with side-effect in forEach
        names.parallelStream()
             .filter(name -> name.length() > 3)
             .forEach(name -> result.add(name)); // BUG: ArrayList is not thread-safe

        System.out.println("Count: " + result.size());
        System.out.println("Names: " + result);
    }
}
```

**Expected output:**
```
Count: 7
Names: [Charlie, Dave, Franklin, Hannah, Jack, Kate, Liam]
```

**Actual output (varies between runs):**
```
Count: 5
Names: [Charlie, null, Franklin, Hannah, Kate, Liam, null]
```
Or sometimes `ArrayIndexOutOfBoundsException`, or correct output (race condition).

<details>
<summary>💡 Hint</summary>

`ArrayList` is not thread-safe. `parallelStream()` processes elements on multiple threads via the ForkJoinPool. What happens when multiple threads call `add()` concurrently on a non-synchronized `ArrayList`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `ArrayList.add()` is not thread-safe. When called concurrently from `parallelStream().forEach()`, internal array resizing and index tracking can race, causing null entries, lost elements, or `ArrayIndexOutOfBoundsException`.
**Why it happens:** `parallelStream()` dispatches work to the common ForkJoinPool. The `forEach` terminal operation calls `result.add(name)` from multiple threads simultaneously. `ArrayList` has no internal synchronization — its `size` field and `elementData` array can be corrupted by concurrent writes.
**Impact:** Data corruption — missing elements, null entries, or runtime exceptions. This is a **heisenbug** that may not appear in every run.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.List;
import java.util.stream.Collectors;

public class Main {
    public static void main(String[] args) {
        List<String> names = List.of("Al", "Bob", "Charlie", "Dave", "Eve", "Franklin",
                "Gus", "Hannah", "Ivy", "Jack", "Kate", "Liam");

        // Use collect() instead of forEach() with a side-effect
        List<String> result = names.parallelStream()
             .filter(name -> name.length() > 3)
             .collect(Collectors.toList()); // Thread-safe reduction

        System.out.println("Count: " + result.size());
        System.out.println("Names: " + result);
    }
}
```

**What changed:** Replaced the side-effect-based `forEach` + `ArrayList.add()` with `collect(Collectors.toList())`. The `collect()` operation uses a thread-safe accumulation strategy internally (each thread collects into its own list, then they are merged).

**Alternative fix:**
```java
List<String> result = Collections.synchronizedList(new ArrayList<>());
names.parallelStream()
     .filter(name -> name.length() > 3)
     .forEach(result::add); // Now thread-safe, but collect() is still preferred
```

</details>

---

### Bug 10: Loop Variable Captured by Lambda — Effectively Final Trap 🔴

**What the code should do:** Create a list of Runnables where each one prints its index (0 through 4).

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Runnable> tasks = new ArrayList<>();

        int i = 0;
        while (i < 5) {
            tasks.add(() -> System.out.println("Task " + i)); // Compile error!
            i++;
        }

        for (Runnable task : tasks) {
            task.run();
        }
    }
}
```

**Expected output:**
```
Task 0
Task 1
Task 2
Task 3
Task 4
```

**Actual output:**
```
Compilation error: local variables referenced from a lambda expression must be final or effectively final
```

A developer might "fix" it like this, introducing a subtler bug:

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static int i; // Moved to a field to bypass the compile error

    public static void main(String[] args) {
        List<Runnable> tasks = new ArrayList<>();

        for (i = 0; i < 5; i++) {
            tasks.add(() -> System.out.println("Task " + i)); // Captures field, not snapshot
        }

        for (Runnable task : tasks) {
            task.run();
        }
    }
}
```

**Actual output of the "fix":**
```
Task 5
Task 5
Task 5
Task 5
Task 5
```

<details>
<summary>💡 Hint</summary>

Lambdas capture variables, not values. If the variable is a mutable field, all lambdas see the same final value of `i` (which is 5 after the loop ends). You need a snapshot per iteration.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The lambda captures the *variable* `i`, not its *value* at the time of creation. Since `i` is a mutable field, by the time the lambdas execute, `i` has already reached 5.
**Why it happens:** Java lambdas capture variables by reference for fields and by value for effectively-final locals. When `i` is a field, all lambdas share the same reference and see the final value. When `i` is a local variable that gets mutated (`i++`), it is not effectively final and the compiler rejects it — but moving it to a field bypasses the safety check without fixing the root cause.
**Impact:** All tasks print "Task 5" instead of their respective indices.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Runnable> tasks = new ArrayList<>();

        for (int i = 0; i < 5; i++) {
            // Create a final snapshot of i for each iteration
            final int index = i;
            tasks.add(() -> System.out.println("Task " + index));
        }

        for (Runnable task : tasks) {
            task.run();
        }
    }
}
```

**What changed:** Created a local `final int index = i` inside each loop iteration. Each lambda captures its own copy of `index`, which is effectively final. The for-loop variable `i` is never referenced by the lambda.

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

### Rating:
- **10/10 without hints** → Senior-level Java debugging skills
- **7-9/10** → Solid middle-level understanding
- **4-6/10** → Good junior, keep practicing
- **< 4/10** → Review the topic fundamentals first
