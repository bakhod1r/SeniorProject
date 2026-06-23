# Java Language Specification — Arrays
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-10.html

---

## 1. Spec Reference

- **JLS Chapter 10**: Arrays — https://docs.oracle.com/javase/specs/jls/se21/html/jls-10.html
- **JLS §10.1**: Array Types
- **JLS §10.2**: Array Variables
- **JLS §10.3**: Array Creation
- **JLS §10.4**: Array Access
- **JLS §10.5**: Array Store Exception
- **JLS §10.6**: Array Initializers
- **JLS §10.7**: Array Members
- **JLS §4.10.3**: Subtyping among Array Types
- **JLS §15.10**: Array Creation and Access Expressions
- **JLS §15.10.1**: Array Creation Expressions
- **JLS §15.10.2**: Array Access Expressions
- **JVMS §6**: `newarray`, `anewarray`, `multianewarray` instructions

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §10.1: Array Types --
ArrayType:
    PrimitiveType Dims
    ClassOrInterfaceType Dims
    TypeVariable Dims

Dims:
    {Annotation} [ ] {{Annotation} [ ]}

-- JLS §15.10.1: Array Creation Expression --
ArrayCreationExpression:
    new PrimitiveType DimExprs [Dims]
    new ClassOrInterfaceType DimExprs [Dims]
    new PrimitiveType Dims ArrayInitializer
    new ClassOrInterfaceType Dims ArrayInitializer

DimExprs:
    DimExpr {DimExpr}

DimExpr:
    {Annotation} [ Expression ]

-- JLS §10.6: Array Initializers --
ArrayInitializer:
    { [VariableInitializerList] [,] }

VariableInitializerList:
    VariableInitializer { , VariableInitializer }

VariableInitializer:
    Expression
    ArrayInitializer

-- JLS §15.10.2: Array Access Expression --
ArrayAccess:
    ExpressionName [ Expression ]
    PrimaryNoNewArray [ Expression ]

-- JLS §14.14.2: Enhanced for Statement (used with arrays) --
EnhancedForStatement:
    for ( {VariableModifier} LocalVariableType VariableDeclaratorId :
          Expression ) Statement

-- JLS §10.7: Array Members --
-- The members of an array type T[] are:
--   public final field length
--   public method clone(), overrides Object.clone()
--   All members inherited from class Object
```

---

## 3. Core Rules & Constraints

### 3.1 Array Creation Rules (JLS §10.3)
- Array creation allocates a new array object with a specified number of components.
- Component type determines default initialization (0, null, false, etc.).
- Length is always non-negative; negative length → `NegativeArraySizeException`.
- Length is fixed at creation; arrays are not resizable.
- The `length` field is a `public final int` — read-only.

### 3.2 Array Types (JLS §10.1)
- `int[]` is a distinct type from `int[][]`, `Integer[]`, `int[][][]`, etc.
- Array types are reference types — arrays are objects on the heap.
- An array of type `T[]` stores components of type `T`.
- Multi-dimensional arrays are arrays of arrays: `int[][]` is an array of `int[]` references.

### 3.3 Array Access (JLS §10.4)
- Index must be `int` (or a type implicitly promotable to `int`: `byte`, `short`, `char`).
- `long` index is a compile error: `arr[longIndex]` — must cast to `int`.
- Valid indices: `0` to `array.length - 1`.
- Accessing index < 0 or >= `length` → `ArrayIndexOutOfBoundsException`.
- Access to `null` array → `NullPointerException`.

### 3.4 Array Store Exception (JLS §10.5)
- For reference arrays, the JVM checks that stored values are compatible with the actual component type.
- Storing wrong type → `ArrayStoreException` at runtime.
- This is a consequence of array covariance (JLS §4.10.3).

### 3.5 Array Covariance (JLS §4.10.3)
- If `S` is a subtype of `T`, then `S[]` is a subtype of `T[]`.
- This allows `String[]` to be assigned to `Object[]`.
- But storing a non-`String` into `String[]` via `Object[]` reference → `ArrayStoreException`.

### 3.6 Multi-Dimensional Arrays (JLS §10.3)
- `new int[3][4]` creates a 3-element array of `int[4]` arrays.
- `new int[3][]` creates a 3-element array of null `int[]` references (jagged array possible).
- Not required to be rectangular: `int[][]` rows can have different lengths.

---

## 4. Type Rules

### 4.1 Array Type Hierarchy (JLS §10.7)
- Every array type `T[]` is a subtype of:
  - `Object`
  - `Cloneable`
  - `java.io.Serializable`
- Primitive array types (`int[]`, `double[]`, etc.) are NOT subtypes of each other, even if the primitives are related by widening.
  - `int[]` is NOT a subtype of `long[]`.

### 4.2 Enhanced for Loop Types (JLS §14.14.2)
- Enhanced for works on:
  1. Arrays: iterates over each component.
  2. `Iterable<T>`: iterates using `iterator()`.
- For arrays, the loop variable type must be compatible with the component type.
- Widening is allowed: `for (double d : intArray)` is legal.

### 4.3 Array Initializer Types (JLS §10.6)
- An array initializer creates and initializes an array in one expression.
- The type of each element in `{ e1, e2, e3 }` must be assignment-compatible with the component type.
- Trailing comma in initializer is legal: `{ 1, 2, 3, }`.
- Array initializers without `new` keyword are only valid in declaration context or in another initializer.

### 4.4 Generic Arrays
- Cannot create arrays of generic types: `new T[10]` is a compile error for type parameter `T`.
- Cannot create arrays of parameterized types: `new List<String>[10]` is a compile error.
- `new List<?>[10]` is allowed (wildcard).
- Workaround: `(T[]) new Object[10]` — generates unchecked cast warning.

---

## 5. Behavioral Specification

### 5.1 Default Initialization (JLS §10.3, §4.12.5)
When an array is created:
| Component Type | Default Value |
|----------------|---------------|
| `byte`, `short`, `int` | `0` |
| `long` | `0L` |
| `float` | `0.0f` |
| `double` | `0.0d` |
| `char` | `'\u0000'` |
| `boolean` | `false` |
| Reference types | `null` |

### 5.2 Array Copy Operations
- `System.arraycopy(src, srcPos, dst, dstPos, length)`: native, most efficient array copy.
- `Arrays.copyOf(original, newLength)`: creates new array, copies up to `newLength` elements.
- `Arrays.copyOfRange(original, from, to)`: copies a range.
- Shallow copy only — nested reference arrays are not deep-copied.
- `Object.clone()` on arrays: returns a shallow copy.

### 5.3 Arrays Utility Class (java.util.Arrays)
| Method | Description |
|--------|-------------|
| `Arrays.sort(arr)` | Sorts in-place; uses dual-pivot quicksort (primitives), timsort (objects) |
| `Arrays.binarySearch(arr, key)` | Binary search in sorted array; result is undefined if not sorted |
| `Arrays.fill(arr, val)` | Fills all elements with `val` |
| `Arrays.equals(a, b)` | Element-by-element comparison |
| `Arrays.deepEquals(a, b)` | Deep comparison for multi-dimensional arrays |
| `Arrays.toString(arr)` | String representation like `[1, 2, 3]` |
| `Arrays.deepToString(arr)` | For nested arrays |
| `Arrays.asList(T... a)` | Fixed-size `List` backed by array |
| `Arrays.stream(arr)` | Returns a stream over the array |
| `Arrays.copyOf(arr, n)` | Copy with new length |
| `Arrays.copyOfRange(arr, from, to)` | Copy subrange |

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| `arr[-1]` | `ArrayIndexOutOfBoundsException` |
| `arr[arr.length]` | `ArrayIndexOutOfBoundsException` |
| `null[0]` | `NullPointerException` |
| `new int[-1]` | `NegativeArraySizeException` |
| `new int[0]` | Legal: zero-length array with `length == 0` |
| Storing wrong type in reference array | `ArrayStoreException` at runtime |
| `int[]` assigned to `long[]` | Compile error (not covariant) |
| `String[]` assigned to `Object[]` | Legal at compile time (covariant) |
| `Arrays.binarySearch()` on unsorted array | Undefined result (no exception, wrong answer) |
| `arr.clone()` for multidimensional array | Shallow copy — inner arrays are shared |

---

## 7. Edge Cases from Spec

### 7.1 Array Length Zero
```java
int[] empty = new int[0];
System.out.println(empty.length);   // 0 — legal, not null
for (int x : empty) {               // zero iterations — no error
    System.out.println(x);
}
```

### 7.2 Primitive Array Covariance Does NOT Exist
```java
int[] ints = {1, 2, 3};
// long[] longs = ints;  // COMPILE ERROR: int[] is not a subtype of long[]
// Object[] objs = ints; // COMPILE ERROR: int[] is not a subtype of Object[]
Object obj = ints;       // OK: int[] IS a subtype of Object
```

### 7.3 ArrayStoreException
```java
String[] strings = new String[3];
Object[] objects = strings;         // widening reference
objects[0] = "hello";               // OK: String into String[]
try {
    objects[1] = new Integer(42);   // ArrayStoreException: Integer, not String
} catch (ArrayStoreException e) {
    System.out.println(e.getMessage());
}
```

### 7.4 Multidimensional Jagged Arrays
```java
int[][] triangle = new int[5][];
for (int i = 0; i < triangle.length; i++) {
    triangle[i] = new int[i + 1];  // row 0: length 1, row 1: length 2, etc.
}
System.out.println(triangle[4].length);  // 5
```

### 7.5 Array Clone is Shallow
```java
int[][] original = {{1, 2}, {3, 4}};
int[][] cloned = original.clone();     // shallow copy

cloned[0][0] = 99;                     // modifies original[0][0] too!
System.out.println(original[0][0]);    // 99

cloned[1] = new int[]{5, 6};           // does NOT affect original[1]
System.out.println(original[1][0]);    // 3
```

### 7.6 Generic Array Creation Workaround
```java
@SuppressWarnings("unchecked")
<T> T[] createArray(int size) {
    return (T[]) new Object[size];  // unchecked cast — safe if T is not reified
}
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | Arrays defined; `length` field; array types | JLS 1st ed. |
| Java 1.1 | `System.arraycopy()` | JDK 1.1 API |
| Java 2 | `java.util.Arrays` introduced (`sort`, `binarySearch`, `fill`, `equals`) | JDK 1.2 |
| Java 5 | Enhanced for loop over arrays; varargs | JSR 201 |
| Java 5 | `Arrays.copyOf()`, `Arrays.copyOfRange()`, `Arrays.toString()` | JDK 5 API |
| Java 6 | `Arrays.copyOf` (actually 6) | JDK 6 |
| Java 8 | `Arrays.stream()`, `Arrays.parallelSort()`, `Arrays.parallelSetAll()` | JEP 103 |
| Java 9 | `Arrays.mismatch()` | JDK 9 API |
| Java 11 | No major array changes | — |
| Java 21 | No major array changes; `sequenced collections` affect array-list interop | JEP 431 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 JVM Bytecode for Arrays
| Operation | Bytecode |
|-----------|---------|
| `new int[n]` | `newarray T_INT` |
| `new String[n]` | `anewarray java/lang/String` |
| `new int[m][n]` | `multianewarray [[I 2` |
| `arr[i]` (int[]) | `iaload` |
| `arr[i] = v` (int[]) | `iastore` |
| `arr.length` | `arraylength` |

### 9.2 Array Memory Layout
- Array header contains: class pointer, identity hash, array length.
- On HotSpot 64-bit with compressed oops: header = 16 bytes.
- `int[]` of length N: 16 + 4*N bytes (aligned to 8 bytes).
- `Object[]` of length N: 16 + 4*N bytes (with compressed oops) or 16 + 8*N (without).

### 9.3 `Arrays.sort` Algorithms (HotSpot)
- Primitive arrays: dual-pivot quicksort (introduced Java 7) — O(n log n) average.
- Object arrays: timsort (merge of merge sort + insertion sort) — O(n log n) worst case, stable.
- `Arrays.parallelSort()`: parallel merge sort using ForkJoinPool — beneficial for large arrays.

### 9.4 `System.arraycopy` vs Manual Loop
- `System.arraycopy` uses JVM intrinsic — compiles to `memmove`/`memcpy` at JIT level.
- Significantly faster than a manual loop for large arrays.
- Handles overlapping source/destination correctly.

---

## 10. Spec Compliance Checklist

- [ ] Array index is within `[0, length - 1]`; bounds checked before access
- [ ] Array reference checked for null before access
- [ ] `NegativeArraySizeException` prevented (validate size before `new T[n]`)
- [ ] `ArrayStoreException` prevented by checking actual type before storing in covariant reference
- [ ] Multi-dimensional arrays: inner arrays initialized before access
- [ ] Generic array workaround uses `@SuppressWarnings("unchecked")` with documentation
- [ ] `Arrays.binarySearch()` only called on sorted arrays
- [ ] Array clone is shallow — deep copy performed manually or via `Arrays.copyOf` for each sub-array
- [ ] `long` index cast to `int` before use as array index
- [ ] Arrays.sort is stable only for reference types (use TimSort); primitives use quicksort (not stable)

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Array Fundamentals
// File: ArrayFundamentals.java
import java.util.Arrays;

public class ArrayFundamentals {
    public static void main(String[] args) {
        // 1D primitive array
        int[] numbers = new int[5];           // default: all zeros
        numbers[0] = 10;
        numbers[1] = 20;
        numbers[2] = 30;
        System.out.println("Length: " + numbers.length);   // 5
        System.out.println(Arrays.toString(numbers));       // [10, 20, 30, 0, 0]

        // Array initializer
        String[] fruits = {"apple", "banana", "cherry"};
        System.out.println(fruits[1]);          // banana

        // Enhanced for loop
        int sum = 0;
        for (int n : numbers) {
            sum += n;
        }
        System.out.println("Sum: " + sum);      // 60

        // Sorting
        int[] unsorted = {5, 2, 8, 1, 9, 3};
        Arrays.sort(unsorted);
        System.out.println(Arrays.toString(unsorted));  // [1, 2, 3, 5, 8, 9]

        // Binary search (on sorted array)
        int idx = Arrays.binarySearch(unsorted, 5);
        System.out.println("Index of 5: " + idx);       // 3

        // Filling and copying
        int[] filled = new int[5];
        Arrays.fill(filled, 42);
        System.out.println(Arrays.toString(filled));     // [42, 42, 42, 42, 42]

        int[] copy = Arrays.copyOf(numbers, 3);
        System.out.println(Arrays.toString(copy));       // [10, 20, 30]
    }
}
```

```java
// Example 2: Multi-Dimensional Arrays
// File: MultiDimensionalArrays.java
import java.util.Arrays;

public class MultiDimensionalArrays {
    public static void main(String[] args) {
        // 2D rectangular array
        int[][] matrix = new int[3][4];
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 4; j++) {
                matrix[i][j] = i * 4 + j;
            }
        }
        System.out.println(Arrays.deepToString(matrix));
        // [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]]

        // 2D jagged array
        int[][] triangle = new int[4][];
        for (int i = 0; i < 4; i++) {
            triangle[i] = new int[i + 1];
            Arrays.fill(triangle[i], i + 1);
        }
        System.out.println(Arrays.deepToString(triangle));
        // [[1], [2, 2], [3, 3, 3], [4, 4, 4, 4]]

        // Inline 2D initializer
        int[][] grid = {
            {1, 2, 3},
            {4, 5, 6},
            {7, 8, 9}
        };
        System.out.println("Center: " + grid[1][1]);  // 5

        // Matrix multiplication
        int[][] a = {{1, 2}, {3, 4}};
        int[][] b = {{5, 6}, {7, 8}};
        int[][] result = multiply(a, b);
        System.out.println(Arrays.deepToString(result));
        // [[19, 22], [43, 50]]
    }

    static int[][] multiply(int[][] a, int[][] b) {
        int n = a.length;
        int[][] result = new int[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                for (int k = 0; k < n; k++)
                    result[i][j] += a[i][k] * b[k][j];
        return result;
    }
}
```

```java
// Example 3: Array Covariance and ArrayStoreException
// File: ArrayCovariance.java
public class ArrayCovariance {
    public static void main(String[] args) {
        // Legal widening (covariance)
        String[] strings = {"hello", "world"};
        Object[] objects = strings;           // String[] is-a Object[]

        // Safe write
        objects[0] = "new value";
        System.out.println(strings[0]);       // new value

        // ArrayStoreException: writing wrong type
        try {
            objects[1] = 42;                  // Integer is NOT a String
        } catch (ArrayStoreException e) {
            System.out.println("ArrayStoreException: " + e.getMessage());
        }

        // Safe pattern: instanceof check
        Object[] mixed = new Object[3];
        mixed[0] = "hello";
        mixed[1] = 42;
        mixed[2] = 3.14;

        for (Object obj : mixed) {
            if (obj instanceof String s) {
                System.out.println("String: " + s.toUpperCase());
            } else if (obj instanceof Integer i) {
                System.out.println("Integer: " + (i * 2));
            }
        }
    }
}
```

```java
// Example 4: Arrays and Streams (Java 8+)
// File: ArrayStreams.java
import java.util.Arrays;
import java.util.stream.IntStream;

public class ArrayStreams {
    public static void main(String[] args) {
        int[] numbers = {5, 3, 8, 1, 9, 2, 7, 4, 6};

        // Stream operations on array
        int sum = Arrays.stream(numbers).sum();
        System.out.println("Sum: " + sum);          // 45

        double avg = Arrays.stream(numbers).average().orElse(0);
        System.out.printf("Average: %.1f%n", avg);  // 5.0

        int max = Arrays.stream(numbers).max().orElse(0);
        System.out.println("Max: " + max);           // 9

        long count = Arrays.stream(numbers).filter(n -> n > 5).count();
        System.out.println("Count > 5: " + count);  // 4

        int[] filtered = Arrays.stream(numbers)
            .filter(n -> n % 2 == 0)
            .sorted()
            .toArray();
        System.out.println("Even sorted: " + Arrays.toString(filtered));
        // [2, 4, 6, 8]

        // Generate array with streams
        int[] squares = IntStream.rangeClosed(1, 10)
            .map(n -> n * n)
            .toArray();
        System.out.println("Squares: " + Arrays.toString(squares));

        // Parallel sort (large arrays benefit from this)
        int[] large = IntStream.range(0, 1_000_000)
            .map(i -> (int)(Math.random() * 1_000_000))
            .toArray();
        Arrays.parallelSort(large);
        System.out.println("Parallel sorted. First: " + large[0] + ", Last: " + large[large.length-1]);

        // mismatch (Java 9+)
        int[] arr1 = {1, 2, 3, 4, 5};
        int[] arr2 = {1, 2, 99, 4, 5};
        int mismatchIdx = Arrays.mismatch(arr1, arr2);
        System.out.println("First mismatch at index: " + mismatchIdx);  // 2
    }
}
```

```java
// Example 5: Practical Array Algorithms
// File: ArrayAlgorithms.java
import java.util.Arrays;

public class ArrayAlgorithms {

    // Reverse an array in-place
    static void reverse(int[] arr) {
        int left = 0, right = arr.length - 1;
        while (left < right) {
            int tmp = arr[left];
            arr[left++] = arr[right];
            arr[right--] = tmp;
        }
    }

    // Rotate array left by k positions
    static int[] rotateLeft(int[] arr, int k) {
        int n = arr.length;
        if (n == 0) return arr;
        k = k % n;
        int[] result = new int[n];
        System.arraycopy(arr, k, result, 0, n - k);
        System.arraycopy(arr, 0, result, n - k, k);
        return result;
    }

    // Two-sum: find indices with target sum
    static int[] twoSum(int[] nums, int target) {
        for (int i = 0; i < nums.length; i++) {
            for (int j = i + 1; j < nums.length; j++) {
                if (nums[i] + nums[j] == target) {
                    return new int[]{i, j};
                }
            }
        }
        return new int[]{-1, -1};
    }

    public static void main(String[] args) {
        int[] arr = {1, 2, 3, 4, 5};

        reverse(arr);
        System.out.println(Arrays.toString(arr));   // [5, 4, 3, 2, 1]

        int[] rotated = rotateLeft(new int[]{1, 2, 3, 4, 5}, 2);
        System.out.println(Arrays.toString(rotated)); // [3, 4, 5, 1, 2]

        int[] indices = twoSum(new int[]{2, 7, 11, 15}, 9);
        System.out.println(Arrays.toString(indices)); // [0, 1]

        // 2D array: find maximum element
        int[][] grid = {{3, 1, 4}, {1, 5, 9}, {2, 6, 5}};
        int max = Arrays.stream(grid)
            .flatMapToInt(Arrays::stream)
            .max()
            .orElse(Integer.MIN_VALUE);
        System.out.println("Grid max: " + max);  // 9
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §10 | Arrays | https://docs.oracle.com/javase/specs/jls/se21/html/jls-10.html |
| JLS §4.10.3 | Subtyping among Array Types | https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.10.3 |
| JLS §15.10 | Array Creation and Access | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.10 |
| JLS §14.14.2 | Enhanced for Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.14.2 |
| JVMS §6 | Instruction Set (array ops) | https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-6.html |
| JEP 431 | Sequenced Collections | https://openjdk.org/jeps/431 |
