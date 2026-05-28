# Control Structures — Find the Bug

> 10+ exercises. Each shows buggy code in **all 3 languages** — find, explain, and fix.

---

## Exercise 1: Infinite Loop — Missing Update

### Go

```go
func countdown(n int) {
    for n > 0 {
        fmt.Println(n)
        // BUG: n is never decremented
    }
}
```

### Java

```java
public static void countdown(int n) {
    while (n > 0) {
        System.out.println(n);
        // BUG: n is never decremented
    }
}
```

### Python

```python
def countdown(n):
    while n > 0:
        print(n)
        # BUG: n is never decremented
```

**Bug:** Loop variable `n` never changes → infinite loop.
**Fix:** Add `n--` / `n -= 1` inside the loop.

---

## Exercise 2: Off-by-One in Range

### Go

```go
arr := []int{1, 2, 3, 4, 5}
for i := 1; i <= len(arr); i++ { // BUG: starts at 1, goes to len(arr)
    fmt.Println(arr[i])           // index out of range at i=5
}
```

### Java

```java
int[] arr = {1, 2, 3, 4, 5};
for (int i = 1; i <= arr.length; i++) { // BUG
    System.out.println(arr[i]);
}
```

### Python

```python
arr = [1, 2, 3, 4, 5]
for i in range(1, len(arr) + 1):  # BUG: goes to index 5
    print(arr[i])
```

**Bug:** Loop starts at 1 (misses first element) and goes one past the end.
**Fix:** `for i := 0; i < len(arr); i++`

---

## Exercise 3: Switch Fallthrough (Java)

### Java

```java
int grade = 85;
String letter;
switch (grade / 10) {
    case 10:
    case 9:
        letter = "A";
    case 8:              // BUG: no break — falls through
        letter = "B";
    case 7:
        letter = "C";
    default:
        letter = "F";
}
System.out.println(letter); // Always prints "F"!
```

**Bug:** Missing `break` statements — every case falls through to `default`.
**Fix:** Add `break;` after each case, or use switch expressions (`->`).

---

## Exercise 4: Wrong Condition in While

### Go

```go
func findFirst(arr []int, target int) int {
    i := 0
    for i < len(arr) || arr[i] != target { // BUG: should be &&
        i++
    }
    return i
}
```

### Java

```java
public static int findFirst(int[] arr, int target) {
    int i = 0;
    while (i < arr.length || arr[i] != target) { // BUG: || should be &&
        i++;
    }
    return i;
}
```

### Python

```python
def find_first(arr, target):
    i = 0
    while i < len(arr) or arr[i] != target:  # BUG: or should be and
        i += 1
    return i
```

**Bug:** Using `||`/`or` means: continue if EITHER condition is true. When `i >= len(arr)`, it still checks `arr[i]` → index out of bounds.
**Fix:** Use `&&`/`and` — continue only while BOTH conditions are true.

---

## Exercise 5: Else Attached to Wrong If

### Go

```go
if x > 0 {
    if x > 100 {
        fmt.Println("big positive")
    }
} else {                         // BUG? Actually correct in Go due to braces
    fmt.Println("non-positive")  // But confusing — looks like it belongs to inner if
}
```

### Java

```java
if (x > 0)
    if (x > 100)
        System.out.println("big positive");
else                              // BUG: else belongs to INNER if, not outer!
    System.out.println("non-positive"); // This prints when x > 0 AND x <= 100
```

### Python

```python
# Python's indentation makes this unambiguous
if x > 0:
    if x > 100:
        print("big positive")
else:                             # Correctly belongs to outer if
    print("non-positive")
```

**Bug:** In Java (without braces), `else` binds to the nearest `if` — the inner one.
**Fix:** Always use braces `{}` in Java.

---

## Exercise 6: Boolean Logic Error

### All Languages

```python
# Task: check if x is between 1 and 10 (inclusive)
if 1 < x < 10:    # Python: works! (chained comparison)
    print("in range")
```

```go
// BUG in Go/Java: you can't chain comparisons
if 1 < x < 10 { // COMPILE ERROR in Go
}
// Fix:
if x > 1 && x < 10 {
}
```

```java
// Java: 1 < x < 10 doesn't compile
if (x > 1 && x < 10) { /* correct */ }
```

**Bug:** Python supports chained comparisons; Go and Java don't.

---

## Exercise 7: Loop Variable Scope

### Go

```go
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i) // BUG: all goroutines print 5
    }()
}
```

### Java

```java
for (int i = 0; i < 5; i++) {
    final int n = i; // Must capture in effectively-final variable
    new Thread(() -> System.out.println(n)).start();
}
```

### Python

```python
funcs = []
for i in range(5):
    funcs.append(lambda: print(i))  # BUG: all lambdas capture same i

for f in funcs:
    f()  # Prints: 4 4 4 4 4
```

**Fix:** Capture loop variable by value:
- Go: `go func(n int) { ... }(i)`
- Python: `lambda n=i: print(n)`

---

## Exercise 8: Nested Break Only Exits Inner Loop

### Go

```go
for i := 0; i < 10; i++ {
    for j := 0; j < 10; j++ {
        if i*j > 20 {
            break // BUG: only exits inner loop, outer continues
        }
    }
}
```

**Fix:** Use labeled break: `break outer` (Go/Java) or extract to a function (Python).

---

## Exercise 9: Do-While vs While

### Java

```java
int n = 0;
do {
    System.out.println(n); // Prints 0 even though condition is false!
    n++;
} while (n > 0 && n < 5);
// BUG: do-while always executes once
```

**Bug:** `do-while` runs the body at least once. If the initial condition is supposed to prevent execution, use `while`.
**Fix:** Use `while (n > 0 && n < 5) { ... }` if body shouldn't run when n=0.

---

## Exercise 10: Modifying Collection During Iteration

### Go

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k, v := range m {
    if v < 2 {
        delete(m, k) // Go: actually safe for maps during range!
    }
}
// Note: Go allows delete during range, but NOT insert (undefined behavior)
```

### Java

```java
var map = new HashMap<>(Map.of("a", 1, "b", 2, "c", 3));
for (var entry : map.entrySet()) {
    if (entry.getValue() < 2) {
        map.remove(entry.getKey()); // BUG: ConcurrentModificationException
    }
}
// Fix: use Iterator with iterator.remove() or map.entrySet().removeIf(...)
```

### Python

```python
d = {"a": 1, "b": 2, "c": 3}
for k, v in d.items():
    if v < 2:
        del d[k]  # BUG: RuntimeError: dictionary changed size during iteration
# Fix: d = {k: v for k, v in d.items() if v >= 2}
```

---

## Exercise 11: Early Return in Finally

### Java

```java
public static int getValue() {
    try {
        return 1;
    } finally {
        return 2;  // BUG: finally's return OVERRIDES try's return!
    }
}
// Returns 2, not 1!
```

### Python

```python
def get_value():
    try:
        return 1
    finally:
        return 2  # BUG: overrides the return from try
# Returns 2
```

**Bug:** `finally` block's return overrides `try` block's return.
**Fix:** Never return from `finally` — use it only for cleanup.
