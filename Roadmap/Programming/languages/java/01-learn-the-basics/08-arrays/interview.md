# Java Arrays — Interview Questions

---

## Junior Level (5-7 Questions)

### Q1: What is an array in Java? How is it different from a variable?

<details>
<summary>Answer</summary>

An array is a fixed-size, ordered collection of elements of the same type stored in contiguous memory. A regular variable holds a single value, while an array holds multiple values accessible by index.

```java
int number = 42;           // single value
int[] numbers = {1, 2, 3}; // multiple values
```

Key characteristics:
- Fixed size (set at creation, cannot change)
- Zero-indexed (first element is at index 0)
- Type-safe (all elements must be the same type)
- Arrays are objects in Java — allocated on the heap
</details>

### Q2: What are the different ways to initialize an array in Java?

<details>
<summary>Answer</summary>

Three main ways:

```java
// 1. Declaration with size (elements get default values)
int[] a = new int[5]; // [0, 0, 0, 0, 0]

// 2. Array literal (inline initialization)
int[] b = {1, 2, 3, 4, 5};

// 3. new keyword with explicit values
int[] c = new int[]{10, 20, 30};
```

Default values by type:
- `int`, `long`, `short`, `byte` → `0`
- `float`, `double` → `0.0`
- `boolean` → `false`
- `char` → `'\u0000'`
- Object references → `null`
</details>

### Q3: What is `ArrayIndexOutOfBoundsException`? When does it occur?

<details>
<summary>Answer</summary>

It's a runtime exception thrown when you try to access an array element with an invalid index — either negative or >= array length.

```java
int[] arr = {10, 20, 30}; // valid indices: 0, 1, 2

arr[3];  // ArrayIndexOutOfBoundsException (index >= length)
arr[-1]; // ArrayIndexOutOfBoundsException (negative index)
```

Prevention:
```java
if (index >= 0 && index < arr.length) {
    System.out.println(arr[index]);
}
```
</details>

### Q4: What is the difference between `length` (arrays) and `length()` (Strings)?

<details>
<summary>Answer</summary>

- `arr.length` — a **field** (property) on arrays. No parentheses.
- `str.length()` — a **method** on Strings. Has parentheses.

```java
int[] arr = {1, 2, 3};
System.out.println(arr.length);    // 3 — field

String s = "hello";
System.out.println(s.length());    // 5 — method

List<Integer> list = List.of(1, 2);
System.out.println(list.size());   // 2 — method (different name!)
```

This is a common interview trap question.
</details>

### Q5: How do you print an array's contents?

<details>
<summary>Answer</summary>

```java
int[] arr = {1, 2, 3};

// ❌ Wrong — prints memory reference like [I@15db9742
System.out.println(arr);

// ✅ Correct — prints [1, 2, 3]
System.out.println(Arrays.toString(arr));

// ✅ For 2D arrays
int[][] matrix = {{1, 2}, {3, 4}};
System.out.println(Arrays.deepToString(matrix)); // [[1, 2], [3, 4]]
```
</details>

### Q6: What is a jagged array? Give an example.

<details>
<summary>Answer</summary>

A jagged array is a 2D array where each row can have a different number of columns.

```java
int[][] jagged = new int[3][];
jagged[0] = new int[]{1, 2};       // 2 columns
jagged[1] = new int[]{3, 4, 5};    // 3 columns
jagged[2] = new int[]{6};          // 1 column
```

Use cases: representing a triangle of numbers (Pascal's triangle), adjacency lists in graphs, or any tabular data with variable-length rows.
</details>

### Q7: How do you compare two arrays for equality?

<details>
<summary>Answer</summary>

```java
int[] a = {1, 2, 3};
int[] b = {1, 2, 3};

// ❌ Wrong — compares references
a == b;                    // false

// ❌ Wrong — same as ==
a.equals(b);               // false (Object.equals not overridden)

// ✅ Correct — compares element by element
Arrays.equals(a, b);       // true

// ✅ For 2D+ arrays
int[][] x = {{1, 2}, {3, 4}};
int[][] y = {{1, 2}, {3, 4}};
Arrays.deepEquals(x, y);   // true
```
</details>

---

## Middle Level (4-6 Questions)

### Q1: What is array covariance in Java? Why is it considered a design flaw?

<details>
<summary>Answer</summary>

Array covariance means that if `B extends A`, then `B[]` is a subtype of `A[]`. This allows:

```java
String[] strings = {"hello", "world"};
Object[] objects = strings;    // legal due to covariance
objects[0] = 42;               // compiles but throws ArrayStoreException at runtime!
```

It's considered a design flaw because:
1. The compiler accepts code that will definitely fail at runtime
2. Every `aastore` instruction must perform a runtime type check (performance cost)
3. Generics (introduced in Java 5) solved this properly — `List<String>` is NOT a subtype of `List<Object>` (invariant)

This was done before generics existed because methods like `Arrays.sort(Object[])` needed to accept any array type.
</details>

### Q2: Why can't you create a generic array like `new T[10]`?

<details>
<summary>Answer</summary>

Due to **type erasure**. At runtime, `T` is erased to `Object`, so `new T[10]` would actually create `new Object[10]`. This would be unsafe:

```java
// If this were allowed:
public <T> T[] createArray(int size) {
    T[] arr = new T[size]; // actually creates Object[]
    return arr;
}

String[] strings = createArray(10); // ClassCastException!
// Because Object[] can't be cast to String[]
```

Workarounds:
```java
// 1. Unchecked cast (use with caution)
@SuppressWarnings("unchecked")
T[] arr = (T[]) new Object[size];

// 2. Reflection
T[] arr = (T[]) Array.newInstance(clazz, size);

// 3. Prefer List<T> instead
List<T> list = new ArrayList<>();
```
</details>

### Q3: Explain `System.arraycopy` vs `Arrays.copyOf` vs `clone()`. Which is fastest?

<details>
<summary>Answer</summary>

All three ultimately use the same native memory copy, but differ in API:

```java
int[] src = {1, 2, 3, 4, 5};

// System.arraycopy — most flexible, copies into existing array
int[] dst = new int[5];
System.arraycopy(src, 1, dst, 0, 3); // copies indices 1-3 → [2, 3, 4, 0, 0]

// Arrays.copyOf — creates new array, copies from beginning
int[] copy = Arrays.copyOf(src, 3); // [1, 2, 3]

// clone — creates exact copy
int[] cloned = src.clone(); // [1, 2, 3, 4, 5]
```

Performance: Nearly identical. `Arrays.copyOf` and `clone()` internally call `System.arraycopy`. All are JVM intrinsics that use optimized memory copy (e.g., `rep movsq` on x86).

Choose based on readability:
- `clone()` for exact copy
- `Arrays.copyOf()` for copy with different length
- `System.arraycopy()` for partial copy into existing array
</details>

### Q4: What is the difference between `Arrays.sort()` for primitive arrays vs object arrays?

<details>
<summary>Answer</summary>

| Aspect | Primitive (`int[]`) | Object (`String[]`) |
|--------|-------------------|-------------------|
| Algorithm | Dual-Pivot Quicksort | TimSort |
| Stable? | No | Yes |
| Performance | O(n log n) average | O(n log n) guaranteed |
| Worst case | O(n²) (extremely rare) | O(n log n) |
| For small arrays | Insertion Sort (< 47) | Binary Insertion Sort (< 32) |

Why different algorithms?
- For primitives, stability doesn't matter (equal ints are identical)
- Quicksort has lower constant factors (no object overhead)
- For objects, stability matters (equal objects should keep original order)
- TimSort is adaptive — O(n) for nearly-sorted data
</details>

### Q5: How does `Arrays.asList()` behave differently with primitive arrays vs object arrays?

<details>
<summary>Answer</summary>

```java
// Object array — works as expected
String[] strings = {"a", "b", "c"};
List<String> list = Arrays.asList(strings);
System.out.println(list.size()); // 3

// Primitive array — treats entire array as one element!
int[] ints = {1, 2, 3};
List<int[]> list2 = Arrays.asList(ints);
System.out.println(list2.size()); // 1 (not 3!)

// Fix: use Integer[] or streams
Integer[] boxed = {1, 2, 3};
List<Integer> list3 = Arrays.asList(boxed); // size: 3

// Or with streams
List<Integer> list4 = Arrays.stream(ints)
    .boxed()
    .collect(Collectors.toList()); // size: 3
```

Why: `Arrays.asList(T... a)` uses varargs. Autoboxing doesn't work for arrays — `int[]` is treated as a single `Object`, not as 3 separate `int` values.
</details>

### Q6: What is the returned list from `Arrays.asList()` — can you add/remove elements?

<details>
<summary>Answer</summary>

`Arrays.asList()` returns a **fixed-size** list backed by the original array:

```java
String[] arr = {"a", "b", "c"};
List<String> list = Arrays.asList(arr);

// ✅ Modification works (modifies original array too!)
list.set(0, "x"); // arr is now {"x", "b", "c"}

// ❌ Structural modification fails
list.add("d");    // UnsupportedOperationException
list.remove(0);   // UnsupportedOperationException

// To get a fully mutable list:
List<String> mutable = new ArrayList<>(Arrays.asList(arr));

// Java 9+ alternative (immutable):
List<String> immutable = List.of("a", "b", "c");
```
</details>

---

## Senior Level (4-6 Questions)

### Q1: Explain the memory layout of a Java array object. What is the overhead?

<details>
<summary>Answer</summary>

On HotSpot 64-bit with compressed oops:

```
+0    Mark Word          (8 bytes) — hash, lock, GC age
+8    Klass Pointer      (4 bytes) — compressed pointer to [I, [B, etc.
+12   Array Length       (4 bytes) — int field
+16   Elements start     (N * sizeof(element))
      Padding            (to 8-byte alignment)
```

Overhead: 16 bytes per array object.

Examples:
- `new int[0]` → 16 bytes (just header)
- `new int[1]` → 24 bytes (16 header + 4 data + 4 padding)
- `new byte[1]` → 24 bytes (16 header + 1 data + 7 padding)
- `new long[1]` → 24 bytes (16 header + 8 data)

For `int[][]` (2D arrays), each inner array is a separate heap object with its own 16-byte header. A `int[1000][4]` uses 1001 objects × 16 bytes overhead = ~16 KB of pure overhead.
</details>

### Q2: How does the JIT compiler eliminate array bounds checks?

<details>
<summary>Answer</summary>

The C2 compiler performs **Bounds Check Elimination (BCE)** when it can prove the index is within valid range.

**Canonical loop pattern (BCE applies):**
```java
for (int i = 0; i < arr.length; i++) {
    arr[i] = 0; // bounds check eliminated
}
```

The compiler reasons: the loop variable `i` starts at 0, increments by 1, and the loop exits when `i >= arr.length`. Therefore `0 <= i < arr.length` is always true.

**BCE does NOT apply when:**
- Index comes from external source: `arr[userInput]`
- Non-standard loop: `for (int i = start; i < end; i++)`
- Multiple arrays: `a[i] = b[i]` (unless both have same length)
- Loop with complex exit conditions

The compiler also performs **range check hoisting** — moving the check before the loop:
```java
// Before optimization:
for (int i = from; i < to; i++) {
    // bounds check every iteration
    arr[i] = 0;
}

// After hoisting:
if (from >= 0 && to <= arr.length) {
    for (int i = from; i < to; i++) {
        arr[i] = 0; // no bounds check needed
    }
} else {
    // slow path with bounds checks
}
```
</details>

### Q3: When would you choose raw arrays over `ArrayList` in production code?

<details>
<summary>Answer</summary>

Raw arrays are justified in these scenarios:

1. **Primitive hot paths:** `int[]` avoids boxing. For 1M elements, `int[]` uses 4 MB vs `ArrayList<Integer>` using ~20 MB (object headers + references + boxed Integer objects).

2. **Custom data structures:** Ring buffers, heaps, tries, hash tables — where you control the memory layout.

3. **Binary I/O:** `byte[]` for reading/writing files, network protocols, serialization. No alternative exists.

4. **Performance-critical inner loops:** Sequential `int[]` access is ~7x faster than `ArrayList<Integer>` due to cache locality and no unboxing.

5. **Interop:** JNI, JDBC (`ResultSet.getBytes()`), and many Java APIs return/accept arrays.

6. **Memory-constrained environments:** Android, embedded systems where every MB counts.

Rule of thumb: Use `ArrayList` by default. Switch to arrays only when profiling shows it matters.
</details>

### Q4: Explain the difference between `Arrays.parallelSort()` and `Arrays.sort()`. When is `parallelSort` actually slower?

<details>
<summary>Answer</summary>

`parallelSort()` uses the ForkJoinPool to sort subarrays in parallel:

```java
// Uses ForkJoinPool.commonPool() threads
Arrays.parallelSort(largeArray);
```

Implementation details:
- Splits array recursively until subarrays < 8192 (MIN_ARRAY_SORT_GRAN)
- Each subarray sorted with Dual-Pivot Quicksort
- Subarrays merged in parallel

**When `parallelSort()` is SLOWER:**
1. **Small arrays (< 8192 elements):** Falls back to sequential sort. Fork/join overhead > sorting benefit.
2. **Nearly sorted data:** TimSort (used for objects) exploits existing order. Parallel overhead wastes this.
3. **ForkJoinPool exhaustion:** If other tasks are using the common pool, parallelSort competes for threads.
4. **Single-core machines:** No parallelism benefit, only overhead.
5. **High GC pressure:** Parallel merging creates temporary arrays, increasing memory and GC load.

Rule of thumb: Use `parallelSort()` only for arrays > 100K elements where sorting is the bottleneck.
</details>

### Q5: How do G1GC and ZGC handle large array allocations differently?

<details>
<summary>Answer</summary>

**G1GC:**
- Arrays > 50% of region size are "humongous objects"
- Allocated in contiguous old-gen regions
- Skips young generation entirely
- Can only be reclaimed during full marking cycles
- Can cause fragmentation and premature Full GC

**ZGC:**
- No concept of humongous objects
- All allocations go through the same path regardless of size
- Uses colored pointers and load barriers — handles any size
- Large arrays don't cause fragmentation
- Concurrent relocation handles large objects

**Practical impact:**
```bash
# G1GC with 2 GB heap, 1 MB regions
# An int[500_000] (2 MB) needs 2+ contiguous regions → humongous
java -XX:+UseG1GC -Xmx2g MyApp

# ZGC handles it like any other allocation
java -XX:+UseZGC -Xmx2g MyApp
```

For workloads with many large arrays (image processing, scientific computing), ZGC is significantly better.
</details>

### Q6: What is the Struct-of-Arrays pattern and when is it faster?

<details>
<summary>Answer</summary>

**Array of Structs (default Java):**
```java
class Particle { float x, y, z, vx, vy, vz; }
Particle[] particles = new Particle[N]; // N heap objects + refs
```

**Struct of Arrays:**
```java
float[] x = new float[N];
float[] y = new float[N];
float[] z = new float[N];
```

SoA is faster when:
- You process one field across all entities (e.g., update all X positions)
- CPU prefetcher can predict sequential access
- SIMD vectorization applies (process 8 floats at once with AVX)

AoS is better when:
- You process all fields of one entity together
- You need to pass entities to methods
- Object-oriented design clarity matters more than performance

The performance difference can be 3-10x for field-iteration workloads due to cache line efficiency: SoA puts 16 consecutive `float x` values in one 64-byte cache line, while AoS only puts 1 particle's fields, wasting space on y, z, vx, vy, vz.
</details>

---

## Scenario-Based Questions (3-5)

### Scenario 1: You need to store 10 million user IDs (integers) and frequently check if a given ID exists. What data structure would you use?

<details>
<summary>Answer</summary>

**Best approaches ranked:**

1. **`HashSet<Integer>`** — O(1) lookup, but ~280 MB memory (boxing + entry objects)

2. **Sorted `int[]` + `Arrays.binarySearch()`** — O(log n) lookup, only ~40 MB memory
   ```java
   int[] ids = loadAllIds();
   Arrays.sort(ids);
   boolean exists = Arrays.binarySearch(ids, targetId) >= 0;
   ```

3. **`BitSet`** — O(1) lookup, ~125 MB if max ID is ~1 billion. Best if IDs are dense.
   ```java
   BitSet ids = new BitSet(1_000_000_000);
   ids.set(userId);
   boolean exists = ids.get(targetId);
   ```

4. **Roaring Bitmap** (library) — compressed bitset, O(1) lookup, much less memory than BitSet for sparse data.

Decision depends on:
- Memory budget → sorted `int[]` is most compact
- Lookup frequency → `HashSet` or `BitSet` for O(1)
- ID range → `BitSet` if IDs are bounded
</details>

### Scenario 2: Your application processes 4K images (3840x2160 pixels, RGBA). Each image is represented as a 2D array. Users report the processing is slow. How do you optimize?

<details>
<summary>Answer</summary>

**Problem analysis:**
- 3840 × 2160 × 4 bytes = ~33 MB per image
- 2D array `int[2160][3840]` creates 2161 heap objects (one per row + outer array)
- Non-contiguous memory → poor cache performance

**Optimizations:**

1. **Use 1D array instead of 2D:**
   ```java
   int[] pixels = new int[3840 * 2160]; // single contiguous allocation
   int getPixel(int x, int y) { return pixels[y * 3840 + x]; }
   ```

2. **Process rows (not columns):** Row-major access matches memory layout.
   ```java
   // ✅ Fast — sequential memory access
   for (int y = 0; y < height; y++)
       for (int x = 0; x < width; x++)
           process(pixels[y * width + x]);

   // ❌ Slow — stride access (cache misses)
   for (int x = 0; x < width; x++)
       for (int y = 0; y < height; y++)
           process(pixels[y * width + x]);
   ```

3. **Use `parallelSort`/parallel streams for independent pixel operations**

4. **Consider off-heap (`ByteBuffer.allocateDirect`)** for zero-copy I/O and reduced GC pressure

5. **Use the Vector API** for SIMD pixel processing (process 8-16 pixels per instruction)
</details>

### Scenario 3: You have a multi-threaded application where multiple threads read from a shared array and one thread occasionally updates it. What approach would you use?

<details>
<summary>Answer</summary>

**Approaches ranked by complexity:**

1. **Copy-on-Write (for rare updates):**
   ```java
   private volatile int[] data;

   // Writer: create new array, then publish atomically
   public void update(int index, int value) {
       int[] newData = Arrays.copyOf(data, data.length);
       newData[index] = value;
       data = newData; // volatile write — visible to all readers
   }

   // Readers: just read — no synchronization needed
   public int read(int index) {
       return data[index]; // volatile read of reference
   }
   ```

2. **AtomicIntegerArray (for frequent updates):**
   ```java
   AtomicIntegerArray data = new AtomicIntegerArray(size);
   data.set(index, value);  // volatile write per element
   int val = data.get(index); // volatile read
   ```

3. **ReadWriteLock (for batch updates):**
   ```java
   ReadWriteLock lock = new ReentrantReadWriteLock();
   // Readers: lock.readLock().lock(); (multiple concurrent readers)
   // Writer: lock.writeLock().lock(); (exclusive access)
   ```

Decision:
- Updates very rare → Copy-on-Write (fastest reads)
- Individual element updates → AtomicIntegerArray
- Batch updates → ReadWriteLock
</details>

### Scenario 4: A developer proposes using `int[][]` to represent a sparse matrix (99% zeros) with 10,000 rows and 10,000 columns. What is wrong with this approach?

<details>
<summary>Answer</summary>

**Problems:**

1. **Memory waste:** `int[10000][10000]` = 400 MB + ~160 KB overhead for headers. 99% of this memory stores zeros.

2. **Heap pressure:** 10,001 separate heap objects (one per row + outer array). GC has to scan all of them.

3. **Cache inefficiency:** Most cache lines fetched contain only zeros.

**Better alternatives:**

1. **Coordinate List (COO):**
   ```java
   int[] rows, cols, values; // parallel arrays for non-zero entries
   ```

2. **Compressed Sparse Row (CSR):**
   ```java
   int[] values;    // non-zero values
   int[] colIndex;  // column index for each value
   int[] rowPtr;    // pointer to start of each row in values[]
   ```

3. **HashMap<Long, Integer>:**
   ```java
   Map<Long, Integer> sparse = new HashMap<>();
   long key = ((long) row << 32) | col;
   sparse.put(key, value);
   ```

For 1% density (100K non-zero elements), CSR uses ~1.2 MB vs 400 MB — a 300x reduction.
</details>

---

## FAQ

### What is the maximum size of an array in Java?

The maximum is `Integer.MAX_VALUE - 8` (2,147,483,639 elements). This is limited by the fact that `.length` is an `int`. The actual memory available may further restrict this. For `byte[]`, the max is ~2 GB per array.

### Can an array hold different types?

No, for primitive arrays. But `Object[]` can hold any reference type:
```java
Object[] mixed = {42, "hello", 3.14, true}; // autoboxing
```
However, this is generally bad practice. Use proper generics.

### Is `int[]` stored on the stack or the heap?

The array object is always on the heap. The reference variable (pointer) is stored on the stack (for local variables) or heap (for object fields). However, JIT's escape analysis may optimize small non-escaping arrays to the stack.

### Why does `System.out.println(arr)` not print the contents?

Because arrays don't override `Object.toString()`. The default `toString()` returns the type code + identity hash: `[I@15db9742`. Use `Arrays.toString(arr)` instead.

### What is the difference between `arr.clone()` and `Arrays.copyOf(arr, arr.length)`?

Functionally equivalent for 1D primitive arrays. Both create a new array with the same contents. For `Object[]`, both create shallow copies. `Arrays.copyOf` allows specifying a different length (truncating or padding).
