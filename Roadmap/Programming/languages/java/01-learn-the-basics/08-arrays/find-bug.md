# Java Arrays — Find the Bug

> Find and fix the bugs in each code snippet. Each exercise has exactly one (or more) bugs. Try to find them before looking at the answer.

---

## Scoring

| Difficulty | Points per bug |
|:----------:|:--------------:|
| Easy | 1 point |
| Medium | 2 points |
| Hard | 3 points |

**Total possible: 28 points**

| Score | Level |
|:-----:|:-----:|
| 0-8 | Beginner — review array basics |
| 9-16 | Intermediate — good foundation |
| 17-23 | Advanced — strong understanding |
| 24-28 | Expert — you know arrays deeply |

---

## Easy Bugs (3)

### Bug 1: Array Initialization

```java
public class Bug1 {
    public static void main(String[] args) {
        int[] numbers;
        numbers[0] = 42;
        System.out.println(numbers[0]);
    }
}
```

<details>
<summary>Hint</summary>
Is the array actually created, or just declared?
</details>

<details>
<summary>Answer</summary>

**Bug:** The array is declared but never initialized. `int[] numbers;` only creates a reference variable — no array object exists.

**Error:** Compilation error: "variable numbers might not have been initialized"

**Fix:**
```java
public class Bug1 {
    public static void main(String[] args) {
        int[] numbers = new int[1]; // allocate the array
        numbers[0] = 42;
        System.out.println(numbers[0]);
    }
}
```
</details>

---

### Bug 2: Off-By-One Error

```java
public class Bug2 {
    public static void main(String[] args) {
        int[] data = {10, 20, 30, 40, 50};

        for (int i = 0; i <= data.length; i++) {
            System.out.println("Element " + i + ": " + data[i]);
        }
    }
}
```

<details>
<summary>Hint</summary>
What is the last valid index for an array of length 5?
</details>

<details>
<summary>Answer</summary>

**Bug:** The loop condition uses `<=` instead of `<`. When `i == 5`, `data[5]` throws `ArrayIndexOutOfBoundsException` because valid indices are 0-4.

**Fix:**
```java
for (int i = 0; i < data.length; i++) { // use < not <=
    System.out.println("Element " + i + ": " + data[i]);
}
```
</details>

---

### Bug 3: Printing an Array

```java
import java.util.Arrays;

public class Bug3 {
    public static void main(String[] args) {
        int[] scores = {95, 87, 73, 91, 68};

        System.out.println("Scores: " + scores);
        System.out.println("Equal? " + scores.equals(new int[]{95, 87, 73, 91, 68}));
    }
}
```

<details>
<summary>Hint</summary>
What does `toString()` and `equals()` do on arrays?
</details>

<details>
<summary>Answer</summary>

**Bugs (2):**
1. `scores` in string concatenation calls `Object.toString()` which prints something like `[I@15db9742` instead of the contents.
2. `scores.equals()` uses `Object.equals()` which compares references, not contents. Returns `false`.

**Fix:**
```java
System.out.println("Scores: " + Arrays.toString(scores));
System.out.println("Equal? " + Arrays.equals(scores, new int[]{95, 87, 73, 91, 68}));
```
</details>

---

## Medium Bugs (4)

### Bug 4: Array Copy Aliasing

```java
public class Bug4 {
    public static void main(String[] args) {
        int[] original = {1, 2, 3, 4, 5};
        int[] backup = original; // "backup" the array

        // Modify original
        original[0] = 999;

        System.out.println("Original[0]: " + original[0]); // 999
        System.out.println("Backup[0]: " + backup[0]);     // expected: 1
    }
}
```

<details>
<summary>Hint</summary>
Does `int[] backup = original` create a copy or an alias?
</details>

<details>
<summary>Answer</summary>

**Bug:** `int[] backup = original` copies the **reference**, not the array. Both variables point to the same array object. Modifying one modifies the other.

**Fix:**
```java
int[] backup = Arrays.copyOf(original, original.length); // or original.clone()
```
</details>

---

### Bug 5: Sorting and Searching

```java
import java.util.Arrays;

public class Bug5 {
    public static void main(String[] args) {
        int[] data = {42, 17, 93, 5, 68, 31};

        // Search for 42
        int index = Arrays.binarySearch(data, 42);
        System.out.println("42 found at index: " + index);
    }
}
```

<details>
<summary>Hint</summary>
What is the prerequisite for `Arrays.binarySearch()`?
</details>

<details>
<summary>Answer</summary>

**Bug:** `Arrays.binarySearch()` requires the array to be **sorted first**. The array `{42, 17, 93, 5, 68, 31}` is not sorted. The result is undefined (may return incorrect index or negative value).

**Fix:**
```java
int[] data = {42, 17, 93, 5, 68, 31};
Arrays.sort(data); // MUST sort first
int index = Arrays.binarySearch(data, 42);
System.out.println("42 found at index: " + index);
```
</details>

---

### Bug 6: For-Each Modification

```java
public class Bug6 {
    public static void main(String[] args) {
        int[] prices = {100, 200, 300, 400, 500};

        // Apply 10% discount
        for (int price : prices) {
            price = (int)(price * 0.9);
        }

        // Print discounted prices
        for (int price : prices) {
            System.out.println(price);
        }
    }
}
```

<details>
<summary>Hint</summary>
Does the for-each variable modify the original array element?
</details>

<details>
<summary>Answer</summary>

**Bug:** The for-each loop variable `price` is a **copy** of the array element. Modifying `price` does not modify `prices[i]`. The array remains unchanged.

**Output:** 100, 200, 300, 400, 500 (no discount applied)

**Fix:**
```java
for (int i = 0; i < prices.length; i++) {
    prices[i] = (int)(prices[i] * 0.9);
}
```
</details>

---

### Bug 7: 2D Array Initialization

```java
public class Bug7 {
    public static void main(String[] args) {
        int[][] matrix = new int[3][];

        // Fill with identity matrix
        for (int i = 0; i < 3; i++) {
            matrix[i][i] = 1;
        }

        // Print
        for (int[] row : matrix) {
            for (int val : row) {
                System.out.print(val + " ");
            }
            System.out.println();
        }
    }
}
```

<details>
<summary>Hint</summary>
When you create `new int[3][]`, what are the inner arrays initialized to?
</details>

<details>
<summary>Answer</summary>

**Bug:** `new int[3][]` creates an array of 3 `null` references. The inner arrays are never created. Accessing `matrix[i][i]` throws `NullPointerException`.

**Fix:**
```java
int[][] matrix = new int[3][];

// Initialize inner arrays first
for (int i = 0; i < 3; i++) {
    matrix[i] = new int[3]; // create each row
}

// Now fill
for (int i = 0; i < 3; i++) {
    matrix[i][i] = 1;
}
```

Or simply: `int[][] matrix = new int[3][3];` creates all inner arrays automatically.
</details>

---

## Hard Bugs (3)

### Bug 8: Array Covariance Trap

```java
public class Bug8 {
    public static void fillWithDefaults(Object[] arr) {
        for (int i = 0; i < arr.length; i++) {
            arr[i] = new Object(); // fill with default objects
        }
    }

    public static void main(String[] args) {
        String[] names = new String[5];
        fillWithDefaults(names); // should fill with defaults

        for (String name : names) {
            System.out.println(name.toUpperCase());
        }
    }
}
```

<details>
<summary>Hint</summary>
Can you store an `Object` into a `String[]` even when accessed through an `Object[]` reference?
</details>

<details>
<summary>Answer</summary>

**Bug:** `fillWithDefaults` stores `Object` instances into what is actually a `String[]` (passed as `Object[]` due to array covariance). This throws `ArrayStoreException` at runtime because `Object` is not a `String`.

**Fix (option 1):** Store the correct type:
```java
public static void fillWithDefaults(Object[] arr) {
    for (int i = 0; i < arr.length; i++) {
        arr[i] = ""; // empty string, compatible with String[]
    }
}
```

**Fix (option 2):** Use generics:
```java
public static <T> void fillWithDefaults(T[] arr, T defaultValue) {
    Arrays.fill(arr, defaultValue);
}

// Usage:
fillWithDefaults(names, "unknown");
```
</details>

---

### Bug 9: Arrays.asList Primitive Trap

```java
import java.util.Arrays;
import java.util.List;

public class Bug9 {
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};
        List<Integer> list = Arrays.asList(numbers);

        System.out.println("Size: " + list.size());
        System.out.println("Contains 3? " + list.contains(3));

        // Remove element
        list.remove(0);
        System.out.println("After remove: " + list);
    }
}
```

<details>
<summary>Hint</summary>
How does `Arrays.asList` handle primitive arrays? And can you structurally modify the returned list?
</details>

<details>
<summary>Answer</summary>

**Bugs (3):**

1. **Compilation error:** `Arrays.asList(int[])` returns `List<int[]>`, not `List<Integer>`. Cannot assign to `List<Integer>`.

2. **Size is 1, not 5:** Even if you fix the type, `Arrays.asList(numbers)` treats `int[]` as a single `Object`, not 5 individual integers.

3. **`list.remove(0)` throws `UnsupportedOperationException`:** The list returned by `Arrays.asList` is fixed-size.

**Fix:**
```java
int[] numbers = {1, 2, 3, 4, 5};

// Convert properly
List<Integer> list = new ArrayList<>(
    Arrays.stream(numbers).boxed().collect(Collectors.toList())
);

System.out.println("Size: " + list.size());       // 5
System.out.println("Contains 3? " + list.contains(3)); // true
list.remove(0);
System.out.println("After remove: " + list);       // [2, 3, 4, 5]
```
</details>

---

### Bug 10: Concurrent Array Modification

```java
import java.util.Arrays;

public class Bug10 {
    private static int[] sharedData = {0, 0, 0, 0, 0};
    private static boolean ready = false;

    public static void main(String[] args) throws InterruptedException {
        Thread writer = new Thread(() -> {
            for (int i = 0; i < sharedData.length; i++) {
                sharedData[i] = i + 1;
            }
            ready = true;
        });

        Thread reader = new Thread(() -> {
            while (!ready) {
                Thread.yield();
            }
            // At this point, writer is done, so all values should be set
            int sum = 0;
            for (int val : sharedData) {
                sum += val;
            }
            System.out.println("Sum: " + sum); // expected: 15
        });

        reader.start();
        writer.start();
        reader.join();
        writer.join();
    }
}
```

<details>
<summary>Hint</summary>
Are the array writes and the `ready` flag visible across threads? Consider the Java Memory Model.
</details>

<details>
<summary>Answer</summary>

**Bugs (2):**

1. **`ready` is not `volatile`:** The reader thread may never see `ready = true` because there is no happens-before relationship. The loop could run forever (or be optimized away by JIT).

2. **Array elements have no visibility guarantee:** Even if `ready` becomes visible, the array writes (`sharedData[i] = i + 1`) may not be visible to the reader thread. The reader could see stale values (all zeros or partial writes).

**Fix:**
```java
private static volatile int[] sharedData = {0, 0, 0, 0, 0};
private static volatile boolean ready = false;

// Or better: use AtomicIntegerArray
private static AtomicIntegerArray sharedData = new AtomicIntegerArray(5);

// Or best: use proper synchronization
private static final Object lock = new Object();
```

Making `ready` volatile establishes a happens-before edge: all writes before `ready = true` are visible after reading `ready == true`. But the cleanest solution uses `AtomicIntegerArray` or explicit synchronization.
</details>

---

### Bug 11: Deep Copy vs Shallow Copy

```java
import java.util.Arrays;

public class Bug11 {
    public static void main(String[] args) {
        int[][] original = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
        int[][] copy = original.clone(); // "deep copy"

        // Modify copy
        copy[0][0] = 999;

        // Check original
        System.out.println("Original[0][0]: " + original[0][0]);
        // Expected: 1, but prints 999!
    }
}
```

<details>
<summary>Hint</summary>
Does `clone()` perform a deep copy or a shallow copy for 2D arrays?
</details>

<details>
<summary>Answer</summary>

**Bug:** `clone()` on a 2D array creates a **shallow copy** — the outer array is new, but the inner arrays are shared references. `copy[0]` and `original[0]` point to the same `int[]` object.

**Fix — deep copy:**
```java
int[][] copy = new int[original.length][];
for (int i = 0; i < original.length; i++) {
    copy[i] = Arrays.copyOf(original[i], original[i].length);
}
```

Or using streams:
```java
int[][] copy = Arrays.stream(original)
    .map(int[]::clone)
    .toArray(int[][]::new);
```
</details>

---

### Bug 12: Generic Array Creation

```java
public class Bug12<T> {
    private T[] items;

    public Bug12(int capacity) {
        items = new T[capacity]; // create generic array
    }

    public void set(int index, T item) {
        items[index] = item;
    }

    public T get(int index) {
        return items[index];
    }

    public static void main(String[] args) {
        Bug12<String> container = new Bug12<>(10);
        container.set(0, "hello");
        System.out.println(container.get(0));
    }
}
```

<details>
<summary>Hint</summary>
Can you create a generic array with `new T[size]` in Java?
</details>

<details>
<summary>Answer</summary>

**Bug:** `new T[capacity]` is illegal in Java. Due to type erasure, `T` is erased to `Object` at runtime, and the JVM cannot verify the array type. This is a compilation error.

**Fix:**
```java
public class Bug12<T> {
    private Object[] items; // use Object[] internally

    public Bug12(int capacity) {
        items = new Object[capacity];
    }

    public void set(int index, T item) {
        items[index] = item;
    }

    @SuppressWarnings("unchecked")
    public T get(int index) {
        return (T) items[index]; // unchecked cast
    }

    public static void main(String[] args) {
        Bug12<String> container = new Bug12<>(10);
        container.set(0, "hello");
        System.out.println(container.get(0)); // hello
    }
}
```

This is exactly how `ArrayList<T>` is implemented internally.
</details>

---

## Score Card

| Bug # | Difficulty | Points | Found? |
|:-----:|:----------:|:------:|:------:|
| 1 | Easy | 1 | ☐ |
| 2 | Easy | 1 | ☐ |
| 3 | Easy | 2 (2 bugs) | ☐ |
| 4 | Medium | 2 | ☐ |
| 5 | Medium | 2 | ☐ |
| 6 | Medium | 2 | ☐ |
| 7 | Medium | 2 | ☐ |
| 8 | Hard | 3 | ☐ |
| 9 | Hard | 3 (3 bugs) | ☐ |
| 10 | Hard | 3 (2 bugs) | ☐ |
| 11 | Hard | 3 | ☐ |
| 12 | Hard | 3 | ☐ |
| **Total** | | **28** | |
