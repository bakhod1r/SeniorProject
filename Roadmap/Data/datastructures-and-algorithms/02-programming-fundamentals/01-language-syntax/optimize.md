# Language Syntax — Optimize

> 10+ exercises. Show before/after in **all 3 languages** with complexity comparison and benchmarks.

---

## Exercise 1: String Concatenation — O(n^2) to O(n)

### Before (Slow)

#### Go

```go
func buildString(n int) string {
    s := ""
    for i := 0; i < n; i++ {
        s += "x" // O(n) copy each time → O(n²) total
    }
    return s
}
```

#### Java

```java
public static String buildString(int n) {
    String s = "";
    for (int i = 0; i < n; i++) {
        s += "x"; // O(n) copy each time → O(n²) total
    }
    return s;
}
```

#### Python

```python
def build_string(n):
    s = ""
    for _ in range(n):
        s += "x"  # O(n) copy each time → O(n²) total
    return s
```

### After (Optimized)

#### Go

```go
import "strings"

func buildString(n int) string {
    var sb strings.Builder
    sb.Grow(n) // pre-allocate
    for i := 0; i < n; i++ {
        sb.WriteByte('x')
    }
    return sb.String() // O(n) total
}
```

#### Java

```java
public static String buildString(int n) {
    StringBuilder sb = new StringBuilder(n); // pre-allocate
    for (int i = 0; i < n; i++) {
        sb.append('x');
    }
    return sb.toString(); // O(n) total
}
```

#### Python

```python
def build_string(n):
    return "".join("x" for _ in range(n))  # O(n) total

# Or even faster:
def build_string_v2(n):
    return "x" * n  # O(n) — single allocation
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n^2) | O(n^2) total allocations |
| After | O(n) | O(n) |

---

## Exercise 2: Duplicate Check — O(n^2) to O(n)

### Before (Slow)

#### Go

```go
func hasDuplicate(arr []int) bool {
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i] == arr[j] {
                return true
            }
        }
    }
    return false
}
```

#### Java

```java
public static boolean hasDuplicate(int[] arr) {
    for (int i = 0; i < arr.length; i++) {
        for (int j = i + 1; j < arr.length; j++) {
            if (arr[i] == arr[j]) return true;
        }
    }
    return false;
}
```

#### Python

```python
def has_duplicate(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return True
    return False
```

### After (Optimized)

#### Go

```go
func hasDuplicate(arr []int) bool {
    seen := make(map[int]bool, len(arr))
    for _, v := range arr {
        if seen[v] {
            return true
        }
        seen[v] = true
    }
    return false
}
```

#### Java

```java
import java.util.HashSet;

public static boolean hasDuplicate(int[] arr) {
    var seen = new HashSet<Integer>(arr.length);
    for (int v : arr) {
        if (!seen.add(v)) return true; // add returns false if already present
    }
    return false;
}
```

#### Python

```python
def has_duplicate(arr):
    return len(arr) != len(set(arr))

# Or explicit:
def has_duplicate_v2(arr):
    seen = set()
    for v in arr:
        if v in seen:
            return True
        seen.add(v)
    return False
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n^2) | O(1) |
| After | O(n) | O(n) |

---

## Exercise 3: Array Reversal — Extra Space to In-Place

### Before (Slow — extra space)

#### Go

```go
func reverse(arr []int) []int {
    result := make([]int, len(arr))
    for i, v := range arr {
        result[len(arr)-1-i] = v
    }
    return result // O(n) extra space
}
```

#### Java

```java
public static int[] reverse(int[] arr) {
    int[] result = new int[arr.length];
    for (int i = 0; i < arr.length; i++) {
        result[arr.length - 1 - i] = arr[i];
    }
    return result; // O(n) extra space
}
```

#### Python

```python
def reverse(arr):
    result = [0] * len(arr)
    for i, v in enumerate(arr):
        result[len(arr) - 1 - i] = v
    return result  # O(n) extra space
```

### After (Optimized — in-place)

#### Go

```go
func reverse(arr []int) {
    for i, j := 0, len(arr)-1; i < j; i, j = i+1, j-1 {
        arr[i], arr[j] = arr[j], arr[i]
    }
}
```

#### Java

```java
public static void reverse(int[] arr) {
    for (int i = 0, j = arr.length - 1; i < j; i++, j--) {
        int temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
}
```

#### Python

```python
def reverse(arr):
    left, right = 0, len(arr) - 1
    while left < right:
        arr[left], arr[right] = arr[right], arr[left]
        left += 1
        right -= 1

# Or Pythonic: arr.reverse() or arr[::-1]
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n) | O(n) |
| After | O(n) | O(1) |

---

## Exercise 4: Map/Dict Lookup vs Linear Search — O(n*m) to O(n+m)

### Before (Slow)

#### Go

```go
func findCommon(a, b []int) []int {
    var result []int
    for _, x := range a {
        for _, y := range b {
            if x == y {
                result = append(result, x)
                break
            }
        }
    }
    return result // O(n*m)
}
```

#### Java

```java
import java.util.ArrayList;
import java.util.List;

public static List<Integer> findCommon(int[] a, int[] b) {
    List<Integer> result = new ArrayList<>();
    for (int x : a) {
        for (int y : b) {
            if (x == y) {
                result.add(x);
                break;
            }
        }
    }
    return result; // O(n*m)
}
```

#### Python

```python
def find_common(a, b):
    result = []
    for x in a:
        for y in b:
            if x == y:
                result.append(x)
                break
    return result  # O(n*m)
```

### After (Optimized)

#### Go

```go
func findCommon(a, b []int) []int {
    set := make(map[int]bool, len(b))
    for _, v := range b {
        set[v] = true
    }
    var result []int
    for _, v := range a {
        if set[v] {
            result = append(result, v)
        }
    }
    return result // O(n+m)
}
```

#### Java

```java
import java.util.*;

public static List<Integer> findCommon(int[] a, int[] b) {
    Set<Integer> set = new HashSet<>();
    for (int v : b) set.add(v);
    List<Integer> result = new ArrayList<>();
    for (int v : a) {
        if (set.contains(v)) result.add(v);
    }
    return result; // O(n+m)
}
```

#### Python

```python
def find_common(a, b):
    set_b = set(b)
    return [x for x in a if x in set_b]  # O(n+m)

# Or one-liner with set intersection (doesn't preserve order/duplicates):
# return list(set(a) & set(b))
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n*m) | O(1) |
| After | O(n+m) | O(m) |

---

## Exercise 5: Preallocating Slice/ArrayList — Reduce Resizing

### Before (Slow — repeated resizing)

#### Go

```go
func generate(n int) []int {
    var result []int // starts empty, grows dynamically
    for i := 0; i < n; i++ {
        result = append(result, i*i) // may resize and copy
    }
    return result
}
```

#### Java

```java
public static List<Integer> generate(int n) {
    List<Integer> result = new ArrayList<>(); // default capacity 10
    for (int i = 0; i < n; i++) {
        result.add(i * i); // may resize and copy
    }
    return result;
}
```

#### Python

```python
def generate(n):
    result = []
    for i in range(n):
        result.append(i * i)  # may resize and copy
    return result
```

### After (Optimized — preallocate)

#### Go

```go
func generate(n int) []int {
    result := make([]int, 0, n) // preallocate capacity
    for i := 0; i < n; i++ {
        result = append(result, i*i) // no resizing needed
    }
    return result
}
// Or even better:
func generateDirect(n int) []int {
    result := make([]int, n)
    for i := 0; i < n; i++ {
        result[i] = i * i // direct index assignment
    }
    return result
}
```

#### Java

```java
public static List<Integer> generate(int n) {
    List<Integer> result = new ArrayList<>(n); // preallocate
    for (int i = 0; i < n; i++) {
        result.add(i * i);
    }
    return result;
}
// Or use array directly:
public static int[] generateArray(int n) {
    int[] result = new int[n];
    for (int i = 0; i < n; i++) {
        result[i] = i * i;
    }
    return result;
}
```

#### Python

```python
def generate(n):
    return [i * i for i in range(n)]  # list comprehension — preallocates internally

# Or if manual:
def generate_v2(n):
    result = [0] * n  # preallocate
    for i in range(n):
        result[i] = i * i
    return result
```

### Complexity

| | Time | Space | Notes |
|---|------|-------|-------|
| Before | O(n) amortized | O(n) | ~log(n) resizes, each copies |
| After | O(n) | O(n) | Zero resizes |

---

## Exercise 6: Reduce Allocations in Loop

### Before (Slow — allocates inside loop)

#### Go

```go
func processItems(items []string) []string {
    var results []string
    for _, item := range items {
        upper := strings.ToUpper(item)
        parts := strings.Split(upper, " ") // allocates every iteration
        results = append(results, parts[0])
    }
    return results
}
```

#### Java

```java
public static List<String> processItems(List<String> items) {
    List<String> results = new ArrayList<>();
    for (String item : items) {
        String upper = item.toUpperCase();
        String[] parts = upper.split(" "); // compiles regex every time!
        results.add(parts[0]);
    }
    return results;
}
```

#### Python

```python
def process_items(items):
    results = []
    for item in items:
        upper = item.upper()
        parts = upper.split(" ")
        results.append(parts[0])
    return results
```

### After (Optimized)

#### Go

```go
func processItems(items []string) []string {
    results := make([]string, 0, len(items))
    for _, item := range items {
        upper := strings.ToUpper(item)
        idx := strings.Index(upper, " ")
        if idx == -1 {
            results = append(results, upper)
        } else {
            results = append(results, upper[:idx]) // no Split allocation
        }
    }
    return results
}
```

#### Java

```java
import java.util.regex.Pattern;

// Pre-compile pattern ONCE
private static final Pattern SPACE = Pattern.compile(" ");

public static List<String> processItems(List<String> items) {
    List<String> results = new ArrayList<>(items.size());
    for (String item : items) {
        String upper = item.toUpperCase();
        // Use indexOf instead of split — avoids regex and array allocation
        int idx = upper.indexOf(' ');
        results.add(idx == -1 ? upper : upper.substring(0, idx));
    }
    return results;
}
```

#### Python

```python
def process_items(items):
    # Use list comprehension + split with maxsplit=1
    return [item.upper().split(" ", 1)[0] for item in items]
```

---

## Exercise 7: Map Initialization — Avoid Rehashing

### Before

#### Go

```go
func countChars(s string) map[rune]int {
    counts := make(map[rune]int) // default size
    for _, c := range s {
        counts[c]++
    }
    return counts // multiple rehashes for large strings
}
```

#### Java

```java
public static Map<Character, Integer> countChars(String s) {
    Map<Character, Integer> counts = new HashMap<>(); // default capacity 16
    for (char c : s.toCharArray()) {
        counts.merge(c, 1, Integer::sum);
    }
    return counts;
}
```

### After

#### Go

```go
func countChars(s string) map[rune]int {
    counts := make(map[rune]int, len(s)) // hint capacity — reduces rehashing
    for _, c := range s {
        counts[c]++
    }
    return counts
}
```

#### Java

```java
public static Map<Character, Integer> countChars(String s) {
    // Capacity = expected entries / load factor (0.75)
    Map<Character, Integer> counts = new HashMap<>((int)(s.length() / 0.75) + 1);
    for (char c : s.toCharArray()) {
        counts.merge(c, 1, Integer::sum);
    }
    return counts;
}
```

#### Python

```python
from collections import Counter

def count_chars(s):
    return Counter(s)  # Optimized C implementation

# Or:
def count_chars_v2(s):
    return dict.fromkeys(s, 0)  # pre-sized (CPython optimization)
```

---

## Exercise 8: Boolean Short-Circuit Optimization

### Before (Slow — expensive check first)

#### Go

```go
func isValid(data []int) bool {
    return expensiveCheck(data) && len(data) > 0 // BUG: expensive runs even if empty
}
```

#### Java

```java
public static boolean isValid(int[] data) {
    return expensiveCheck(data) && data.length > 0;
}
```

#### Python

```python
def is_valid(data):
    return expensive_check(data) and len(data) > 0
```

### After (Optimized — cheap check first)

#### Go

```go
func isValid(data []int) bool {
    return len(data) > 0 && expensiveCheck(data) // cheap check short-circuits
}
```

#### Java

```java
public static boolean isValid(int[] data) {
    return data.length > 0 && expensiveCheck(data);
}
```

#### Python

```python
def is_valid(data):
    return len(data) > 0 and expensive_check(data)
```

### Impact

Put the **cheapest check first** in `&&`/`and` chains. If the first operand is `false`, the second is never evaluated.

---

## Exercise 9: Repeated Method Calls — Cache Results

### Before

#### Go

```go
func process(s string) string {
    result := ""
    for i := 0; i < len(s); i++ {
        if strings.ToLower(string(s[i])) == "a" {
            result += strings.ToUpper(string(s[i]))
        } else {
            result += strings.ToLower(string(s[i])) // called twice for same char
        }
    }
    return result
}
```

### After

#### Go

```go
func process(s string) string {
    var sb strings.Builder
    sb.Grow(len(s))
    for _, c := range s {
        lower := strings.ToLower(string(c)) // compute once
        if lower == "a" {
            sb.WriteString(strings.ToUpper(string(c)))
        } else {
            sb.WriteString(lower) // reuse cached value
        }
    }
    return sb.String()
}
```

---

## Exercise 10: Switch vs If-Else Chain

### Before (Slow for many branches)

#### Go

```go
func getDay(n int) string {
    if n == 1 { return "Monday" }
    if n == 2 { return "Tuesday" }
    if n == 3 { return "Wednesday" }
    if n == 4 { return "Thursday" }
    if n == 5 { return "Friday" }
    if n == 6 { return "Saturday" }
    if n == 7 { return "Sunday" }
    return "Unknown"
}
```

### After (Optimized — table lookup)

#### Go

```go
var days = [...]string{
    0: "Unknown",
    1: "Monday", 2: "Tuesday", 3: "Wednesday",
    4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
}

func getDay(n int) string {
    if n >= 1 && n <= 7 {
        return days[n] // O(1) array lookup
    }
    return "Unknown"
}
```

#### Java

```java
private static final String[] DAYS = {
    "Unknown", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday", "Sunday"
};

public static String getDay(int n) {
    return (n >= 1 && n <= 7) ? DAYS[n] : "Unknown";
}
```

#### Python

```python
DAYS = {
    1: "Monday", 2: "Tuesday", 3: "Wednesday",
    4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday"
}

def get_day(n):
    return DAYS.get(n, "Unknown")  # O(1) dict lookup
```

---

## Optimization Summary

| Exercise | Before | After | Strategy |
|----------|--------|-------|----------|
| 1. String concat | O(n^2) | O(n) | Builder / join |
| 2. Duplicate check | O(n^2) | O(n) | Hash set |
| 3. Array reverse | O(n) space | O(1) space | Two-pointer in-place |
| 4. Common elements | O(n*m) | O(n+m) | Hash set lookup |
| 5. Slice growth | log(n) resizes | 0 resizes | Preallocate capacity |
| 6. Loop allocations | N allocations | 1 allocation | Avoid Split, pre-compile regex |
| 7. Map rehash | Multiple rehashes | 0 rehashes | Hint initial capacity |
| 8. Boolean eval | Expensive first | Cheap first | Short-circuit ordering |
| 9. Repeated calls | Compute twice | Compute once | Cache intermediate results |
| 10. If-else chain | O(n) branches | O(1) lookup | Array/map table |
