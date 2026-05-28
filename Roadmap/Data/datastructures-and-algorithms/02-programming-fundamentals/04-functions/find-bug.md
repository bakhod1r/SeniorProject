# Functions — Find the Bug

> 12 exercises. Each shows buggy code in **all 3 languages** — find, explain, and fix.

---

## Exercise 1: Missing Return Value

### Go

```go
func max(a, b int) int {
    if a > b {
        return a
    }
    // BUG: no return if a <= b
}
```

### Java

```java
public static int max(int a, int b) {
    if (a > b) {
        return a;
    }
    // BUG: missing return statement — compilation error in Java
}
```

### Python

```python
def max_val(a, b):
    if a > b:
        return a
    # BUG: returns None when a <= b
```

**Bug:** Missing `return b` in the else path. Go won't compile. Java won't compile. Python silently returns `None`.

**Fix:** Add `return b` after the if block (or use an else clause).

---

## Exercise 2: Wrong Return in Recursive Base Case

### Go

```go
func factorial(n int) int {
    if n == 0 {
        return 0  // BUG: should return 1
    }
    return n * factorial(n-1)
}
// factorial(5) returns 0 because everything multiplies by 0
```

### Java

```java
public static int factorial(int n) {
    if (n == 0) {
        return 0;  // BUG: should return 1
    }
    return n * factorial(n - 1);
}
```

### Python

```python
def factorial(n):
    if n == 0:
        return 0  # BUG: should return 1
    return n * factorial(n - 1)

# factorial(5) = 5 * 4 * 3 * 2 * 1 * 0 = 0
```

**Bug:** Base case returns `0` instead of `1`. Since `1 * 0 = 0`, the entire chain multiplies to 0.

**Fix:** Change `return 0` to `return 1`.

---

## Exercise 3: Variable Scope — Shadowing

### Go

```go
func increment(x int) int {
    x := x + 1  // BUG: := declares a NEW variable, shadowing the parameter
    return x
}
// Actually, this doesn't compile: "no new variables on left side of :="
// But a subtler version:

func process() int {
    result := 0
    if true {
        result := 10  // BUG: declares new block-scoped variable, doesn't modify outer
        _ = result
    }
    return result  // returns 0, not 10
}
```

### Java

```java
public static int process() {
    int result = 0;
    if (true) {
        int result = 10;  // BUG: compilation error — duplicate variable in Java
    }
    return result;
}
// Java catches this at compile time, unlike Go
```

### Python

```python
def process():
    result = 0
    def inner():
        result = 10  # BUG: creates LOCAL variable, doesn't modify outer
    inner()
    return result  # returns 0, not 10

print(process())  # 0
```

**Bug:** Variable shadowing / scope confusion. Inner `result` is a different variable.

**Fix:**
- Go: use `=` instead of `:=`
- Python: use `nonlocal result` inside `inner()`

---

## Exercise 4: Mutation of Input Parameter

### Go

```go
func removeLast(s []int) []int {
    s = s[:len(s)-1]  // BUG: modifies the original slice's view
    return s
}

func main() {
    original := []int{1, 2, 3, 4, 5}
    shorter := removeLast(original)
    fmt.Println(shorter)   // [1 2 3 4]
    fmt.Println(original)  // [1 2 3 4 5] — looks fine...

    // But the underlying array is shared!
    original = append(original[:4], 99)
    fmt.Println(shorter)   // [1 2 3 99] — BUG: shorter was affected!
}
```

### Java

```java
public static List<Integer> removeLast(List<Integer> list) {
    list.remove(list.size() - 1);  // BUG: modifies the original list!
    return list;
}

public static void main(String[] args) {
    List<Integer> original = new ArrayList<>(List.of(1, 2, 3, 4, 5));
    List<Integer> shorter = removeLast(original);
    System.out.println(original);  // [1, 2, 3, 4] — BUG: original was mutated!
}
```

### Python

```python
def remove_last(lst):
    lst.pop()  # BUG: modifies the original list!
    return lst

original = [1, 2, 3, 4, 5]
shorter = remove_last(original)
print(original)  # [1, 2, 3, 4] — BUG: original was mutated!
```

**Bug:** Function mutates the caller's data instead of working on a copy.

**Fix:** Make a copy first:
- Go: `copy := append([]int{}, s...)` then modify copy
- Java: `new ArrayList<>(list)` then modify copy
- Python: `lst = lst[:]` or `lst.copy()` then modify copy

---

## Exercise 5: Closure Bug — Loop Variable Capture

### Go

```go
func makeMultipliers() []func(int) int {
    var fns []func(int) int
    for i := 1; i <= 3; i++ {
        fns = append(fns, func(x int) int {
            return x * i  // BUG (pre-Go 1.22): captures variable i, not its value
        })
    }
    return fns
}

// In Go < 1.22:
// fns[0](10) = 40 (i=4 after loop)
// fns[1](10) = 40
// fns[2](10) = 40
// In Go 1.22+: fixed — each iteration gets its own i
```

### Java

```java
// Java prevents this bug — loop variable must be effectively final
List<Function<Integer, Integer>> fns = new ArrayList<>();
for (int i = 1; i <= 3; i++) {
    // fns.add(x -> x * i);  // BUG: compilation error — i is not effectively final
    int captured = i;
    fns.add(x -> x * captured);  // FIX: capture in final variable
}
```

### Python

```python
def make_multipliers():
    fns = []
    for i in range(1, 4):
        fns.append(lambda x: x * i)  # BUG: all lambdas share the same i
    return fns

fns = make_multipliers()
print(fns[0](10))  # 30 (i=3 after loop)
print(fns[1](10))  # 30
print(fns[2](10))  # 30
```

**Bug:** All closures capture the same loop variable, which has its final value.

**Fix:**
- Go (pre-1.22): `i := i` inside loop
- Java: already forced to copy
- Python: `lambda x, i=i: x * i` (capture via default parameter)

---

## Exercise 6: Off-by-One in Recursion

### Go

```go
func binarySearch(arr []int, target, lo, hi int) int {
    if lo > hi {
        return -1
    }
    mid := (lo + hi) / 2  // BUG: integer overflow for large arrays
    if arr[mid] == target {
        return mid
    } else if arr[mid] < target {
        return binarySearch(arr, target, mid, hi)  // BUG: should be mid+1
    }
    return binarySearch(arr, target, lo, mid)  // BUG: should be mid-1
}
// Infinite loop when target not found — mid never changes
```

### Java

```java
public static int binarySearch(int[] arr, int target, int lo, int hi) {
    if (lo > hi) return -1;
    int mid = (lo + hi) / 2;  // BUG: overflow for large arrays
    if (arr[mid] == target) return mid;
    if (arr[mid] < target)
        return binarySearch(arr, target, mid, hi);      // BUG: should be mid+1
    return binarySearch(arr, target, lo, mid);           // BUG: should be mid-1
}
```

### Python

```python
def binary_search(arr, target, lo, hi):
    if lo > hi:
        return -1
    mid = (lo + hi) // 2  # Python handles big ints, no overflow
    if arr[mid] == target:
        return mid
    elif arr[mid] < target:
        return binary_search(arr, target, mid, hi)   # BUG: should be mid+1
    return binary_search(arr, target, lo, mid)        # BUG: should be mid-1
```

**Bugs:**
1. `mid = (lo + hi) / 2` can overflow in Go/Java. Fix: `mid = lo + (hi - lo) / 2`
2. Recursive calls use `mid` instead of `mid+1` and `mid-1`, causing infinite recursion.

**Fix:** `binarySearch(arr, target, mid+1, hi)` and `binarySearch(arr, target, lo, mid-1)`

---

## Exercise 7: Stack Overflow — No Base Case

### Go

```go
func fibonacci(n int) int {
    return fibonacci(n-1) + fibonacci(n-2)
    // BUG: no base case — infinite recursion → stack overflow
}
```

### Java

```java
public static int fibonacci(int n) {
    return fibonacci(n - 1) + fibonacci(n - 2);
    // BUG: no base case — StackOverflowError
}
```

### Python

```python
def fibonacci(n):
    return fibonacci(n - 1) + fibonacci(n - 2)
    # BUG: no base case — RecursionError: maximum recursion depth exceeded
```

**Bug:** Missing base case. The function calls itself forever.

**Fix:** Add `if n <= 1: return n` at the beginning.

---

## Exercise 8: Python Mutable Default Argument

### Go

```go
// Go doesn't have default parameters, so this bug doesn't exist.
// But similar bug with package-level slice:

var defaultList []int  // shared across calls — same class of bug

func addItem(item int) []int {
    defaultList = append(defaultList, item)
    return defaultList
}
// Every call mutates the same slice
```

### Java

```java
// Java doesn't have default parameters either.
// Similar bug with static field:

public class BuggyList {
    private static List<Integer> defaultList = new ArrayList<>();  // shared!

    public static List<Integer> addItem(int item) {
        defaultList.add(item);  // BUG: mutates shared state
        return defaultList;
    }
}

// BuggyList.addItem(1) → [1]
// BuggyList.addItem(2) → [1, 2]  — BUG: accumulated across calls
```

### Python

```python
def add_item(item, lst=[]):  # BUG: default list shared across all calls
    lst.append(item)
    return lst

print(add_item(1))  # [1]
print(add_item(2))  # [1, 2] — BUG! Expected [2]
print(add_item(3))  # [1, 2, 3] — BUG! Expected [3]
```

**Bug:** Python evaluates default arguments **once** at function definition time. All calls share the same list object.

**Fix:**

```python
def add_item(item, lst=None):
    if lst is None:
        lst = []
    lst.append(item)
    return lst
```

---

## Exercise 9: Wrong Use of `return` in Loop

### Go

```go
func contains(arr []int, target int) bool {
    for _, v := range arr {
        if v == target {
            return true
        }
        return false  // BUG: returns false after checking ONLY the first element
    }
    return false
}

// contains([]int{1, 2, 3}, 3) returns false!
```

### Java

```java
public static boolean contains(int[] arr, int target) {
    for (int v : arr) {
        if (v == target) {
            return true;
        }
        return false;  // BUG: only checks first element
    }
    return false;
}
```

### Python

```python
def contains(arr, target):
    for v in arr:
        if v == target:
            return True
        return False  # BUG: only checks first element (wrong indentation)
    return False

print(contains([1, 2, 3], 3))  # False — should be True
```

**Bug:** `return false` is inside the loop, so it returns after checking only the first element.

**Fix:** Move `return false` outside the loop (after the for-loop ends).

---

## Exercise 10: Accidentally Returning Function Instead of Result

### Go

```go
func makeGreeter(name string) func() string {
    return func() string {
        return "Hello, " + name
    }
}

func main() {
    greeter := makeGreeter("Alice")
    fmt.Println(greeter)    // BUG: prints function address, not the greeting
    // Fix: fmt.Println(greeter())
}
```

### Java

```java
Supplier<String> greeter = () -> "Hello, Alice";
System.out.println(greeter);    // BUG: prints object reference
// Fix: System.out.println(greeter.get());
```

### Python

```python
def make_greeter(name):
    def greet():
        return f"Hello, {name}"
    return greet

greeter = make_greeter("Alice")
print(greeter)    # BUG: <function make_greeter.<locals>.greet at 0x...>
# Fix: print(greeter())
```

**Bug:** Printing the function object instead of calling it.

**Fix:** Add `()` to call the function: `greeter()`.

---

## Exercise 11: Recursive Function Modifies Shared State

### Go

```go
func permutations(arr []int, start int, result *[][]int) {
    if start == len(arr) {
        *result = append(*result, arr)  // BUG: appends reference to same slice
        return
    }
    for i := start; i < len(arr); i++ {
        arr[start], arr[i] = arr[i], arr[start]
        permutations(arr, start+1, result)
        arr[start], arr[i] = arr[i], arr[start]
    }
}
// All entries in result point to same underlying array — all show final state
```

### Java

```java
public static void permutations(int[] arr, int start, List<int[]> result) {
    if (start == arr.length) {
        result.add(arr);  // BUG: adds reference to same array
        return;
    }
    for (int i = start; i < arr.length; i++) {
        swap(arr, start, i);
        permutations(arr, start + 1, result);
        swap(arr, start, i);
    }
}
```

### Python

```python
def permutations(arr, start, result):
    if start == len(arr):
        result.append(arr)  # BUG: appends reference, not copy
        return
    for i in range(start, len(arr)):
        arr[start], arr[i] = arr[i], arr[start]
        permutations(arr, start + 1, result)
        arr[start], arr[i] = arr[i], arr[start]

result = []
permutations([1, 2, 3], 0, result)
print(result)  # [[1, 2, 3], [1, 2, 3], ...] — all same!
```

**Bug:** Appending a reference to the array instead of a copy. Since the array is mutated in-place, all stored references point to the same (final) state.

**Fix:** Append a copy:
- Go: `*result = append(*result, append([]int{}, arr...))`
- Java: `result.add(arr.clone())`
- Python: `result.append(arr[:])`

---

## Exercise 12: Forgetting to Handle Error Return in Go

### Go

```go
func readConfig(path string) map[string]string {
    data, _ := os.ReadFile(path)  // BUG: ignoring error
    config := make(map[string]string)
    json.Unmarshal(data, &config)  // BUG: ignoring error again
    return config
}
// If file doesn't exist: data is nil, Unmarshal gets nil → returns empty map
// No way for caller to know something went wrong
```

### Java

```java
public static Map<String, String> readConfig(String path) {
    try {
        String data = Files.readString(Path.of(path));
        // Process data...
        return Map.of("key", "value");
    } catch (Exception e) {
        return Map.of();  // BUG: silently swallows error
    }
}
```

### Python

```python
def read_config(path):
    try:
        with open(path) as f:
            return json.load(f)
    except:  # BUG: bare except catches everything (even KeyboardInterrupt)
        return {}  # silently returns empty dict
```

**Bug:** Ignoring or silently swallowing errors.

**Fix:**
- Go: `if err != nil { return nil, err }` — always check and propagate errors
- Java: Catch specific exceptions, log or rethrow
- Python: Catch specific exceptions (`except FileNotFoundError:`), never use bare `except`
