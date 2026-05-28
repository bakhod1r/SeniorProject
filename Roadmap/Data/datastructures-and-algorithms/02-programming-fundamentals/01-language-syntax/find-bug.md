# Language Syntax — Find the Bug

> 10+ exercises. Each shows buggy code in **all 3 languages** — find, explain, and fix.

---

## Exercise 1: Integer Division Surprise

### Go (Buggy)

```go
package main

import "fmt"

func average(a, b int) float64 {
    return float64(a + b / 2) // BUG
}

func main() {
    fmt.Println(average(3, 7)) // Expected: 5.0, Got: 6.0
}
```

### Java (Buggy)

```java
public class Bug1 {
    public static double average(int a, int b) {
        return (double)(a + b / 2); // BUG
    }

    public static void main(String[] args) {
        System.out.println(average(3, 7)); // Expected: 5.0, Got: 6.0
    }
}
```

### Python (Buggy)

```python
def average(a, b):
    return a + b // 2  # BUG

print(average(3, 7))  # Expected: 5.0, Got: 6
```

**Bug:** Operator precedence — `b / 2` is evaluated first, then added to `a`. Also, integer division truncates.

### Fix

#### Go

```go
func average(a, b int) float64 {
    return float64(a+b) / 2.0
}
```

#### Java

```java
public static double average(int a, int b) {
    return (a + b) / 2.0;
}
```

#### Python

```python
def average(a, b):
    return (a + b) / 2
```

---

## Exercise 2: String Comparison Trap (Java)

### Go (Works correctly)

```go
package main

import "fmt"

func main() {
    a := "hello"
    b := "hello"
    fmt.Println(a == b) // true — Go compares by value
}
```

### Java (Buggy)

```java
public class Bug2 {
    public static void main(String[] args) {
        String a = new String("hello");
        String b = new String("hello");
        System.out.println(a == b); // BUG: prints false!
    }
}
```

### Python (Works correctly)

```python
a = "hello"
b = "hello"
print(a == b)  # True — Python compares by value
```

**Bug:** In Java, `==` compares references for objects, not values. Two `new String()` creates different objects.

### Fix (Java)

```java
System.out.println(a.equals(b)); // true — compares by value
```

---

## Exercise 3: Missing Break in Switch (Go/Java)

### Go (Works correctly — no fallthrough by default)

```go
package main

import "fmt"

func main() {
    day := 3
    switch day {
    case 1:
        fmt.Println("Monday")
    case 2:
        fmt.Println("Tuesday")
    case 3:
        fmt.Println("Wednesday")
    default:
        fmt.Println("Other")
    }
    // Prints only: Wednesday (Go doesn't fall through by default)
}
```

### Java (Buggy)

```java
public class Bug3 {
    public static void main(String[] args) {
        int day = 3;
        switch (day) {
            case 1:
                System.out.println("Monday");
                // BUG: missing break — falls through!
            case 2:
                System.out.println("Tuesday");
            case 3:
                System.out.println("Wednesday");
            case 4:
                System.out.println("Thursday"); // BUG: also prints this!
            default:
                System.out.println("Other");    // BUG: and this!
        }
    }
}
```

### Python (No switch — uses if/elif)

```python
day = 3
# Python 3.10+ has match/case (no fallthrough by design)
match day:
    case 1:
        print("Monday")
    case 2:
        print("Tuesday")
    case 3:
        print("Wednesday")
    case _:
        print("Other")
```

**Bug:** Java `switch` falls through without `break`. Go and Python don't have this issue.

### Fix (Java)

```java
switch (day) {
    case 1:  System.out.println("Monday");    break;
    case 2:  System.out.println("Tuesday");   break;
    case 3:  System.out.println("Wednesday"); break;
    default: System.out.println("Other");     break;
}
// Or use switch expression (Java 14+):
// String name = switch (day) { case 1 -> "Monday"; ... };
```

---

## Exercise 4: Off-by-One in Loop

### Go (Buggy)

```go
package main

import "fmt"

func main() {
    arr := []int{10, 20, 30, 40, 50}
    for i := 0; i <= len(arr); i++ { // BUG: <= should be <
        fmt.Println(arr[i])
    }
}
```

### Java (Buggy)

```java
public class Bug4 {
    public static void main(String[] args) {
        int[] arr = {10, 20, 30, 40, 50};
        for (int i = 0; i <= arr.length; i++) { // BUG: <= should be <
            System.out.println(arr[i]);
        }
    }
}
```

### Python (Buggy)

```python
arr = [10, 20, 30, 40, 50]
for i in range(len(arr) + 1):  # BUG: +1 is wrong
    print(arr[i])
```

**Bug:** Loop goes one past the last valid index → `IndexOutOfBoundsException` / `panic` / `IndexError`.

### Fix

#### Go

```go
for i := 0; i < len(arr); i++ {
    fmt.Println(arr[i])
}
// Or idiomatic: for _, v := range arr { fmt.Println(v) }
```

#### Java

```java
for (int i = 0; i < arr.length; i++) {
    System.out.println(arr[i]);
}
// Or: for (int v : arr) { System.out.println(v); }
```

#### Python

```python
for v in arr:  # Pythonic — no index needed
    print(v)
# Or: for i in range(len(arr)):
```

---

## Exercise 5: Mutating List While Iterating

### Go (Buggy)

```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3, 4, 5, 6}
    for i, v := range nums {
        if v%2 == 0 {
            nums = append(nums[:i], nums[i+1:]...) // BUG: modifying slice while ranging
        }
    }
    fmt.Println(nums) // Unexpected result — skips elements
}
```

### Java (Buggy)

```java
import java.util.ArrayList;
import java.util.Arrays;

public class Bug5 {
    public static void main(String[] args) {
        var nums = new ArrayList<>(Arrays.asList(1, 2, 3, 4, 5, 6));
        for (int n : nums) {
            if (n % 2 == 0) {
                nums.remove(Integer.valueOf(n)); // BUG: ConcurrentModificationException
            }
        }
    }
}
```

### Python (Buggy)

```python
nums = [1, 2, 3, 4, 5, 6]
for n in nums:
    if n % 2 == 0:
        nums.remove(n)  # BUG: skips elements after removal
print(nums)  # [1, 3, 5, 6] — 6 was NOT removed!
```

**Bug:** Removing elements while iterating causes skipped elements or exceptions.

### Fix

#### Go

```go
result := []int{}
for _, v := range nums {
    if v%2 != 0 {
        result = append(result, v)
    }
}
fmt.Println(result) // [1 3 5]
```

#### Java

```java
nums.removeIf(n -> n % 2 == 0); // Safe — uses Iterator internally
// Or: use Iterator with iterator.remove()
```

#### Python

```python
nums = [n for n in nums if n % 2 != 0]  # List comprehension — creates new list
print(nums)  # [1, 3, 5]
```

---

## Exercise 6: Shadowed Variable

### Go (Buggy)

```go
package main

import "fmt"

func main() {
    x := 10
    if true {
        x := 20  // BUG: := creates NEW variable, doesn't modify outer x
        fmt.Println("inner:", x) // 20
    }
    fmt.Println("outer:", x) // Still 10!
}
```

### Java (No issue — Java doesn't allow same-name variable in inner scope)

```java
public class Bug6 {
    public static void main(String[] args) {
        int x = 10;
        if (true) {
            // int x = 20; // COMPILE ERROR in Java — cannot shadow local variable
            x = 20; // This modifies outer x
        }
        System.out.println(x); // 20
    }
}
```

### Python (No issue — Python doesn't have block scoping)

```python
x = 10
if True:
    x = 20  # Modifies outer x (Python has function scope, not block scope)
print(x)  # 20
```

**Bug:** Go's `:=` in inner scope creates a new variable instead of modifying the outer one.

### Fix (Go)

```go
x := 10
if true {
    x = 20  // = instead of := — modifies outer x
    fmt.Println("inner:", x)
}
fmt.Println("outer:", x) // Now 20
```

---

## Exercise 7: Nil/Null/None Method Call

### Go (Buggy)

```go
package main

import "fmt"

type Node struct {
    Value int
    Next  *Node
}

func main() {
    var head *Node // nil
    fmt.Println(head.Value) // BUG: panic — nil pointer dereference
}
```

### Java (Buggy)

```java
public class Bug7 {
    static class Node {
        int value;
        Node next;
    }

    public static void main(String[] args) {
        Node head = null;
        System.out.println(head.value); // BUG: NullPointerException
    }
}
```

### Python (Buggy)

```python
head = None
print(head.value)  # BUG: AttributeError: 'NoneType' has no attribute 'value'
```

**Bug:** Accessing a field/method on nil/null/None.

### Fix (all)

```go
// Go
if head != nil {
    fmt.Println(head.Value)
}
```

```java
// Java
if (head != null) {
    System.out.println(head.value);
}
```

```python
# Python
if head is not None:
    print(head.value)
```

---

## Exercise 8: Slice/Array Copy Confusion

### Go (Buggy)

```go
package main

import "fmt"

func main() {
    original := []int{1, 2, 3}
    copied := original  // BUG: not a real copy — shares underlying array
    copied[0] = 999
    fmt.Println(original) // [999 2 3] — original was modified!
}
```

### Java (Buggy)

```java
public class Bug8 {
    public static void main(String[] args) {
        int[] original = {1, 2, 3};
        int[] copied = original; // BUG: reference copy
        copied[0] = 999;
        System.out.println(java.util.Arrays.toString(original)); // [999, 2, 3]
    }
}
```

### Python (Buggy)

```python
original = [1, 2, 3]
copied = original  # BUG: reference copy
copied[0] = 999
print(original)  # [999, 2, 3]
```

**Bug:** Assigning a slice/array/list just copies the reference, not the data.

### Fix

#### Go

```go
copied := make([]int, len(original))
copy(copied, original)
// Or: copied := append([]int{}, original...)
```

#### Java

```java
int[] copied = original.clone();
// Or: int[] copied = Arrays.copyOf(original, original.length);
```

#### Python

```python
copied = original[:]       # Shallow copy
# Or: copied = original.copy()
# Or: copied = list(original)
# For nested: import copy; copied = copy.deepcopy(original)
```

---

## Exercise 9: Floating Point Comparison

### Go (Buggy)

```go
package main

import "fmt"

func main() {
    a := 0.1 + 0.2
    if a == 0.3 { // BUG: false!
        fmt.Println("Equal")
    } else {
        fmt.Println("Not equal:", a) // 0.30000000000000004
    }
}
```

### Java (Buggy)

```java
public class Bug9 {
    public static void main(String[] args) {
        double a = 0.1 + 0.2;
        if (a == 0.3) { // BUG: false!
            System.out.println("Equal");
        } else {
            System.out.println("Not equal: " + a);
        }
    }
}
```

### Python (Buggy)

```python
a = 0.1 + 0.2
if a == 0.3:  # BUG: False!
    print("Equal")
else:
    print(f"Not equal: {a}")  # 0.30000000000000004
```

**Bug:** IEEE 754 floating point cannot represent 0.1 exactly → `0.1 + 0.2 != 0.3`.

### Fix

#### Go

```go
import "math"

const epsilon = 1e-9
if math.Abs(a-0.3) < epsilon {
    fmt.Println("Equal")
}
```

#### Java

```java
final double EPSILON = 1e-9;
if (Math.abs(a - 0.3) < EPSILON) {
    System.out.println("Equal");
}
```

#### Python

```python
import math

if math.isclose(a, 0.3):  # Uses relative and absolute tolerance
    print("Equal")
# Or: if abs(a - 0.3) < 1e-9:
```

---

## Exercise 10: Goroutine/Thread Closure Bug

### Go (Buggy)

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i) // BUG: captures variable i by reference
        }()
    }
    wg.Wait()
    // Prints: 5 5 5 5 5 (not 0 1 2 3 4)
}
```

### Java (Buggy — pre-Java 10)

```java
import java.util.concurrent.*;

public class Bug10 {
    public static void main(String[] args) throws Exception {
        var executor = Executors.newFixedThreadPool(5);
        // Java effectively-final rule prevents this exact bug,
        // but using a mutable container causes the same issue:
        int[] counter = {0};
        for (int i = 0; i < 5; i++) {
            counter[0] = i;
            executor.submit(() -> {
                System.out.println(counter[0]); // BUG: reads shared mutable state
            });
        }
        executor.shutdown();
        executor.awaitTermination(1, TimeUnit.SECONDS);
    }
}
```

### Python (Buggy)

```python
import threading

threads = []
for i in range(5):
    t = threading.Thread(target=lambda: print(i))  # BUG: captures i by reference
    threads.append(t)
    t.start()

for t in threads:
    t.join()
# Likely prints: 4 4 4 4 4
```

**Bug:** Loop variable is captured by reference; by the time goroutine/thread runs, the loop has finished.

### Fix

#### Go

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(n int) {  // Pass i as parameter — captures by value
        defer wg.Done()
        fmt.Println(n)
    }(i)
}
```

#### Java

```java
for (int i = 0; i < 5; i++) {
    final int n = i;  // Capture in effectively-final variable
    executor.submit(() -> System.out.println(n));
}
```

#### Python

```python
for i in range(5):
    t = threading.Thread(target=lambda n=i: print(n))  # Default argument captures value
    threads.append(t)
    t.start()
```

---

## Exercise 11: Integer Overflow (Go/Java)

### Go (Buggy)

```go
package main

import (
    "fmt"
    "math"
)

func main() {
    var x int32 = math.MaxInt32  // 2147483647
    x = x + 1                    // BUG: wraps to -2147483648!
    fmt.Println(x)
}
```

### Java (Buggy)

```java
public class Bug11 {
    public static void main(String[] args) {
        int x = Integer.MAX_VALUE;  // 2147483647
        x = x + 1;                  // BUG: wraps to -2147483648!
        System.out.println(x);
    }
}
```

### Python (No bug — arbitrary precision)

```python
x = 2**31 - 1  # 2147483647
x = x + 1
print(x)  # 2147483648 — Python handles big integers natively
```

**Bug:** Go and Java 32-bit integers overflow silently. Python doesn't overflow.

### Fix

```go
// Go: use int64 or check before adding
if x < math.MaxInt32 {
    x = x + 1
}
// Or use math/big for arbitrary precision
```

```java
// Java: use long or Math.addExact
try {
    int result = Math.addExact(x, 1); // throws ArithmeticException on overflow
} catch (ArithmeticException e) {
    System.out.println("Overflow!");
}
```
