# Java Arrays — Practice Tasks

---

## Junior Tasks (3-4)

### Task 1: Array Statistics Calculator

**Difficulty:** Easy
**Estimated time:** 20 minutes

Write a program that takes an array of integers and computes:
- The minimum value
- The maximum value
- The sum
- The average (as a double)

**Requirements:**
- Do NOT use `Arrays.stream()` — use manual loops
- Handle the case where the array is empty (print an error message)
- Print all results formatted to 2 decimal places

**Starter code:**

```java
public class ArrayStats {
    public static void main(String[] args) {
        int[] data = {45, 23, 67, 12, 89, 34, 56, 78, 90, 11};

        // TODO: Calculate min, max, sum, average
        // TODO: Handle empty array case
        // TODO: Print results
    }
}
```

**Expected output:**
```
Min: 11
Max: 90
Sum: 505
Average: 50.50
```

<details>
<summary>Solution</summary>

```java
public class ArrayStats {
    public static void main(String[] args) {
        int[] data = {45, 23, 67, 12, 89, 34, 56, 78, 90, 11};

        if (data.length == 0) {
            System.out.println("Error: array is empty");
            return;
        }

        int min = data[0];
        int max = data[0];
        int sum = 0;

        for (int value : data) {
            if (value < min) min = value;
            if (value > max) max = value;
            sum += value;
        }

        double average = (double) sum / data.length;

        System.out.println("Min: " + min);
        System.out.println("Max: " + max);
        System.out.println("Sum: " + sum);
        System.out.printf("Average: %.2f%n", average);
    }
}
```
</details>

---

### Task 2: Reverse an Array In-Place

**Difficulty:** Easy
**Estimated time:** 15 minutes

Write a method `reverse(int[] arr)` that reverses the array in-place (without creating a new array).

**Requirements:**
- Must modify the original array
- Use the two-pointer swap technique
- Test with both odd-length and even-length arrays

**Starter code:**

```java
import java.util.Arrays;

public class ReverseArray {
    public static void reverse(int[] arr) {
        // TODO: Implement in-place reversal
    }

    public static void main(String[] args) {
        int[] odd = {1, 2, 3, 4, 5};
        int[] even = {10, 20, 30, 40};

        reverse(odd);
        reverse(even);

        System.out.println(Arrays.toString(odd));  // [5, 4, 3, 2, 1]
        System.out.println(Arrays.toString(even)); // [40, 30, 20, 10]
    }
}
```

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;

public class ReverseArray {
    public static void reverse(int[] arr) {
        int left = 0;
        int right = arr.length - 1;
        while (left < right) {
            int temp = arr[left];
            arr[left] = arr[right];
            arr[right] = temp;
            left++;
            right--;
        }
    }

    public static void main(String[] args) {
        int[] odd = {1, 2, 3, 4, 5};
        int[] even = {10, 20, 30, 40};

        reverse(odd);
        reverse(even);

        System.out.println(Arrays.toString(odd));  // [5, 4, 3, 2, 1]
        System.out.println(Arrays.toString(even)); // [40, 30, 20, 10]
    }
}
```
</details>

---

### Task 3: Frequency Counter

**Difficulty:** Easy-Medium
**Estimated time:** 25 minutes

Given an array of integers (values 0-9 only), count the frequency of each digit and print a histogram.

**Requirements:**
- Use a `int[10]` array to store frequencies
- Print a simple text histogram using `*` characters
- Handle empty arrays

**Starter code:**

```java
public class FrequencyCounter {
    public static void main(String[] args) {
        int[] data = {1, 3, 5, 3, 7, 3, 1, 5, 7, 7, 7, 9, 1};

        // TODO: Count frequencies
        // TODO: Print histogram
    }
}
```

**Expected output:**
```
0:
1: ***
3: ***
5: **
7: ****
9: *
```

<details>
<summary>Solution</summary>

```java
public class FrequencyCounter {
    public static void main(String[] args) {
        int[] data = {1, 3, 5, 3, 7, 3, 1, 5, 7, 7, 7, 9, 1};

        if (data.length == 0) {
            System.out.println("Array is empty");
            return;
        }

        int[] freq = new int[10];
        for (int value : data) {
            freq[value]++;
        }

        for (int i = 0; i < 10; i++) {
            if (freq[i] > 0) {
                System.out.print(i + ": ");
                for (int j = 0; j < freq[i]; j++) {
                    System.out.print("*");
                }
                System.out.println();
            }
        }
    }
}
```
</details>

---

### Task 4: Matrix Transposition

**Difficulty:** Medium
**Estimated time:** 20 minutes

Write a method that takes a 2D array (matrix) and returns its transpose (rows become columns).

**Starter code:**

```java
import java.util.Arrays;

public class MatrixTranspose {
    public static int[][] transpose(int[][] matrix) {
        // TODO: Return the transposed matrix
        return null;
    }

    public static void main(String[] args) {
        int[][] matrix = {
            {1, 2, 3},
            {4, 5, 6}
        };

        int[][] result = transpose(matrix);
        // Expected: {{1, 4}, {2, 5}, {3, 6}}

        for (int[] row : result) {
            System.out.println(Arrays.toString(row));
        }
    }
}
```

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;

public class MatrixTranspose {
    public static int[][] transpose(int[][] matrix) {
        if (matrix.length == 0) return new int[0][0];

        int rows = matrix.length;
        int cols = matrix[0].length;
        int[][] result = new int[cols][rows];

        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++) {
                result[j][i] = matrix[i][j];
            }
        }

        return result;
    }

    public static void main(String[] args) {
        int[][] matrix = {
            {1, 2, 3},
            {4, 5, 6}
        };

        int[][] result = transpose(matrix);

        for (int[] row : result) {
            System.out.println(Arrays.toString(row));
        }
        // [1, 4]
        // [2, 5]
        // [3, 6]
    }
}
```
</details>

---

## Middle Tasks (2-3)

### Task 5: Merge Two Sorted Arrays

**Difficulty:** Medium
**Estimated time:** 30 minutes

Write a method that merges two sorted arrays into one sorted array without using `Arrays.sort()`.

**Requirements:**
- Time complexity must be O(n + m), where n and m are the lengths of the two arrays
- Handle edge cases: empty arrays, arrays of different lengths
- Use the two-pointer merge technique

**Starter code:**

```java
import java.util.Arrays;

public class MergeSorted {
    public static int[] merge(int[] a, int[] b) {
        // TODO: Merge two sorted arrays in O(n+m)
        return null;
    }

    public static void main(String[] args) {
        int[] a = {1, 3, 5, 7, 9};
        int[] b = {2, 4, 6, 8, 10, 12};

        int[] result = merge(a, b);
        System.out.println(Arrays.toString(result));
        // [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]

        // Edge cases
        System.out.println(Arrays.toString(merge(new int[]{}, new int[]{1, 2})));
        System.out.println(Arrays.toString(merge(new int[]{5}, new int[]{})));
    }
}
```

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;

public class MergeSorted {
    public static int[] merge(int[] a, int[] b) {
        int[] result = new int[a.length + b.length];
        int i = 0, j = 0, k = 0;

        while (i < a.length && j < b.length) {
            if (a[i] <= b[j]) {
                result[k++] = a[i++];
            } else {
                result[k++] = b[j++];
            }
        }

        while (i < a.length) {
            result[k++] = a[i++];
        }

        while (j < b.length) {
            result[k++] = b[j++];
        }

        return result;
    }

    public static void main(String[] args) {
        int[] a = {1, 3, 5, 7, 9};
        int[] b = {2, 4, 6, 8, 10, 12};

        int[] result = merge(a, b);
        System.out.println(Arrays.toString(result));
        // [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]

        System.out.println(Arrays.toString(merge(new int[]{}, new int[]{1, 2})));
        // [1, 2]
        System.out.println(Arrays.toString(merge(new int[]{5}, new int[]{})));
        // [5]
    }
}
```
</details>

---

### Task 6: Rotate Array by K Positions

**Difficulty:** Medium
**Estimated time:** 35 minutes

Write a method that rotates an array to the right by `k` positions **in-place** using O(1) extra space.

**Hint:** Use the reversal algorithm — reverse the whole array, then reverse the first k elements, then reverse the rest.

**Requirements:**
- O(n) time, O(1) space
- Handle k > array length
- Handle negative k (rotate left)

**Starter code:**

```java
import java.util.Arrays;

public class RotateArray {
    public static void rotate(int[] arr, int k) {
        // TODO: Rotate array right by k positions in-place
    }

    public static void main(String[] args) {
        int[] arr1 = {1, 2, 3, 4, 5, 6, 7};
        rotate(arr1, 3);
        System.out.println(Arrays.toString(arr1)); // [5, 6, 7, 1, 2, 3, 4]

        int[] arr2 = {1, 2, 3};
        rotate(arr2, 5); // k > length
        System.out.println(Arrays.toString(arr2)); // [2, 3, 1]
    }
}
```

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;

public class RotateArray {
    public static void rotate(int[] arr, int k) {
        if (arr == null || arr.length <= 1) return;

        int n = arr.length;
        k = k % n;
        if (k < 0) k += n; // handle negative rotation
        if (k == 0) return;

        reverse(arr, 0, n - 1);     // reverse entire array
        reverse(arr, 0, k - 1);     // reverse first k elements
        reverse(arr, k, n - 1);     // reverse remaining elements
    }

    private static void reverse(int[] arr, int left, int right) {
        while (left < right) {
            int temp = arr[left];
            arr[left] = arr[right];
            arr[right] = temp;
            left++;
            right--;
        }
    }

    public static void main(String[] args) {
        int[] arr1 = {1, 2, 3, 4, 5, 6, 7};
        rotate(arr1, 3);
        System.out.println(Arrays.toString(arr1)); // [5, 6, 7, 1, 2, 3, 4]

        int[] arr2 = {1, 2, 3};
        rotate(arr2, 5);
        System.out.println(Arrays.toString(arr2)); // [2, 3, 1]
    }
}
```
</details>

---

### Task 7: Sliding Window Maximum

**Difficulty:** Medium-Hard
**Estimated time:** 40 minutes

Given an array and a window size `k`, find the maximum value in each sliding window position.

**Requirements:**
- Return an array of maximums
- Handle edge cases (k > array length, k = 1)
- Aim for O(n) solution using a Deque (bonus), O(n*k) is acceptable

**Starter code:**

```java
import java.util.Arrays;

public class SlidingWindowMax {
    public static int[] maxSlidingWindow(int[] nums, int k) {
        // TODO: Find maximum in each window of size k
        return null;
    }

    public static void main(String[] args) {
        int[] nums = {1, 3, -1, -3, 5, 3, 6, 7};
        int[] result = maxSlidingWindow(nums, 3);
        System.out.println(Arrays.toString(result)); // [3, 3, 5, 5, 6, 7]
    }
}
```

<details>
<summary>Solution</summary>

```java
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;

public class SlidingWindowMax {
    public static int[] maxSlidingWindow(int[] nums, int k) {
        if (nums == null || nums.length == 0 || k <= 0) return new int[0];
        if (k == 1) return Arrays.copyOf(nums, nums.length);
        if (k >= nums.length) {
            int max = nums[0];
            for (int n : nums) max = Math.max(max, n);
            return new int[]{max};
        }

        int[] result = new int[nums.length - k + 1];
        Deque<Integer> deque = new ArrayDeque<>(); // stores indices

        for (int i = 0; i < nums.length; i++) {
            // Remove indices outside window
            while (!deque.isEmpty() && deque.peekFirst() < i - k + 1) {
                deque.pollFirst();
            }

            // Remove indices of elements smaller than current
            while (!deque.isEmpty() && nums[deque.peekLast()] < nums[i]) {
                deque.pollLast();
            }

            deque.offerLast(i);

            // Window is fully formed starting at i >= k - 1
            if (i >= k - 1) {
                result[i - k + 1] = nums[deque.peekFirst()];
            }
        }

        return result;
    }

    public static void main(String[] args) {
        int[] nums = {1, 3, -1, -3, 5, 3, 6, 7};
        int[] result = maxSlidingWindow(nums, 3);
        System.out.println(Arrays.toString(result)); // [3, 3, 5, 5, 6, 7]
    }
}
```
</details>

---

## Senior Tasks (2-3)

### Task 8: Custom Dynamic Array (ArrayList Clone)

**Difficulty:** Hard
**Estimated time:** 60 minutes

Implement a generic dynamic array class with automatic resizing, similar to `ArrayList`.

**Requirements:**
- Generic type support (`DynamicArray<T>`)
- Methods: `add(T)`, `get(int)`, `set(int, T)`, `remove(int)`, `size()`, `isEmpty()`
- Automatic doubling when capacity is reached
- Shrink to half when usage drops below 25%
- Proper bounds checking with exceptions
- Override `toString()`, `equals()`, `hashCode()`

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;
import java.util.Objects;

public class DynamicArray<T> {
    private static final int DEFAULT_CAPACITY = 10;

    private Object[] data;
    private int size;

    public DynamicArray() {
        this(DEFAULT_CAPACITY);
    }

    public DynamicArray(int initialCapacity) {
        if (initialCapacity < 0) {
            throw new IllegalArgumentException("Capacity cannot be negative: " + initialCapacity);
        }
        this.data = new Object[initialCapacity];
        this.size = 0;
    }

    public void add(T element) {
        ensureCapacity();
        data[size++] = element;
    }

    @SuppressWarnings("unchecked")
    public T get(int index) {
        checkBounds(index);
        return (T) data[index];
    }

    public void set(int index, T element) {
        checkBounds(index);
        data[index] = element;
    }

    @SuppressWarnings("unchecked")
    public T remove(int index) {
        checkBounds(index);
        T removed = (T) data[index];
        System.arraycopy(data, index + 1, data, index, size - index - 1);
        data[--size] = null; // help GC
        shrinkIfNeeded();
        return removed;
    }

    public int size() { return size; }
    public boolean isEmpty() { return size == 0; }

    private void ensureCapacity() {
        if (size == data.length) {
            int newCapacity = data.length == 0 ? DEFAULT_CAPACITY : data.length * 2;
            data = Arrays.copyOf(data, newCapacity);
        }
    }

    private void shrinkIfNeeded() {
        if (data.length > DEFAULT_CAPACITY && size < data.length / 4) {
            data = Arrays.copyOf(data, Math.max(data.length / 2, DEFAULT_CAPACITY));
        }
    }

    private void checkBounds(int index) {
        if (index < 0 || index >= size) {
            throw new IndexOutOfBoundsException(
                String.format("Index: %d, Size: %d", index, size));
        }
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < size; i++) {
            if (i > 0) sb.append(", ");
            sb.append(data[i]);
        }
        return sb.append("]").toString();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof DynamicArray<?> that)) return false;
        if (this.size != that.size) return false;
        for (int i = 0; i < size; i++) {
            if (!Objects.equals(this.data[i], that.data[i])) return false;
        }
        return true;
    }

    @Override
    public int hashCode() {
        int result = size;
        for (int i = 0; i < size; i++) {
            result = 31 * result + Objects.hashCode(data[i]);
        }
        return result;
    }

    public static void main(String[] args) {
        DynamicArray<String> arr = new DynamicArray<>();
        arr.add("hello");
        arr.add("world");
        arr.add("java");
        System.out.println(arr);          // [hello, world, java]
        System.out.println(arr.get(1));    // world
        arr.remove(1);
        System.out.println(arr);          // [hello, java]
        System.out.println(arr.size());   // 2
    }
}
```
</details>

---

### Task 9: Sparse Matrix Using Arrays

**Difficulty:** Hard
**Estimated time:** 45 minutes

Implement a sparse matrix in CSR (Compressed Sparse Row) format using arrays.

**Requirements:**
- Constructor takes a 2D `int[][]` and compresses it
- `get(row, col)` — retrieve value at position
- `multiply(int[])` — multiply matrix by a vector
- Memory usage should be O(nnz) where nnz = number of non-zero elements

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;

public class SparseMatrix {
    private final int[] values;    // non-zero values
    private final int[] colIndex;  // column index of each value
    private final int[] rowPtr;    // start index of each row in values[]
    private final int rows;
    private final int cols;

    public SparseMatrix(int[][] dense) {
        this.rows = dense.length;
        this.cols = dense.length > 0 ? dense[0].length : 0;

        // Count non-zero elements
        int nnz = 0;
        for (int[] row : dense) {
            for (int val : row) {
                if (val != 0) nnz++;
            }
        }

        values = new int[nnz];
        colIndex = new int[nnz];
        rowPtr = new int[rows + 1];

        int idx = 0;
        for (int i = 0; i < rows; i++) {
            rowPtr[i] = idx;
            for (int j = 0; j < cols; j++) {
                if (dense[i][j] != 0) {
                    values[idx] = dense[i][j];
                    colIndex[idx] = j;
                    idx++;
                }
            }
        }
        rowPtr[rows] = idx;
    }

    public int get(int row, int col) {
        for (int i = rowPtr[row]; i < rowPtr[row + 1]; i++) {
            if (colIndex[i] == col) return values[i];
            if (colIndex[i] > col) break; // columns are sorted
        }
        return 0;
    }

    public int[] multiply(int[] vector) {
        if (vector.length != cols) {
            throw new IllegalArgumentException("Vector length must equal number of columns");
        }

        int[] result = new int[rows];
        for (int i = 0; i < rows; i++) {
            for (int j = rowPtr[i]; j < rowPtr[i + 1]; j++) {
                result[i] += values[j] * vector[colIndex[j]];
            }
        }
        return result;
    }

    public int getNonZeroCount() { return values.length; }

    public static void main(String[] args) {
        int[][] dense = {
            {0, 0, 3, 0, 4},
            {0, 0, 5, 7, 0},
            {0, 0, 0, 0, 0},
            {0, 2, 6, 0, 0}
        };

        SparseMatrix sm = new SparseMatrix(dense);
        System.out.println("Non-zero count: " + sm.getNonZeroCount()); // 5
        System.out.println("get(0,2): " + sm.get(0, 2)); // 3
        System.out.println("get(1,3): " + sm.get(1, 3)); // 7
        System.out.println("get(2,0): " + sm.get(2, 0)); // 0

        int[] vector = {1, 2, 3, 4, 5};
        int[] result = sm.multiply(vector);
        System.out.println("Matrix * vector: " + Arrays.toString(result));
        // [29, 43, 0, 22]
    }
}
```
</details>

---

## Questions (5-10)

1. What is the time complexity of accessing an element by index in an array? Why?
2. Why are Java arrays zero-indexed?
3. What happens when you assign one array variable to another (`int[] b = a`)?
4. How does `Arrays.sort()` handle arrays with duplicate values?
5. What is the difference between `int[]` and `Integer[]` in terms of memory usage?
6. Why does `Arrays.asList(new int[]{1,2,3}).size()` return 1?
7. How would you remove duplicates from a sorted array in-place?
8. What is the difference between a rectangular 2D array and a jagged array?
9. Why is `System.arraycopy` faster than a manual copy loop?
10. How can you check if two arrays have the same elements in different orders?

---

## Mini Project: Grade Management System

**Difficulty:** Medium
**Estimated time:** 90 minutes

Build a command-line grade management system using arrays (no ArrayList).

**Features:**
- Store student names (`String[]`) and their grades (`int[][]` — multiple grades per student)
- Add a student with initial grades
- Add a grade for an existing student
- Calculate each student's average grade
- Find the student with the highest average
- Print a formatted report card
- Sort students by average grade (descending)

**Constraints:**
- Maximum 50 students (pre-allocate arrays)
- Track actual count with a separate variable
- All operations must use arrays only

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;
import java.util.Scanner;

public class GradeManager {
    private static final int MAX_STUDENTS = 50;
    private static final int MAX_GRADES = 20;

    private String[] names = new String[MAX_STUDENTS];
    private int[][] grades = new int[MAX_STUDENTS][MAX_GRADES];
    private int[] gradeCount = new int[MAX_STUDENTS]; // grades per student
    private int studentCount = 0;

    public int addStudent(String name, int... initialGrades) {
        if (studentCount >= MAX_STUDENTS) {
            System.out.println("Error: maximum students reached");
            return -1;
        }
        names[studentCount] = name;
        for (int i = 0; i < initialGrades.length && i < MAX_GRADES; i++) {
            grades[studentCount][i] = initialGrades[i];
        }
        gradeCount[studentCount] = initialGrades.length;
        return studentCount++;
    }

    public void addGrade(int studentIndex, int grade) {
        if (studentIndex < 0 || studentIndex >= studentCount) {
            System.out.println("Error: invalid student index");
            return;
        }
        if (gradeCount[studentIndex] >= MAX_GRADES) {
            System.out.println("Error: maximum grades reached for student");
            return;
        }
        grades[studentIndex][gradeCount[studentIndex]++] = grade;
    }

    public double getAverage(int studentIndex) {
        if (gradeCount[studentIndex] == 0) return 0;
        int sum = 0;
        for (int i = 0; i < gradeCount[studentIndex]; i++) {
            sum += grades[studentIndex][i];
        }
        return (double) sum / gradeCount[studentIndex];
    }

    public int findTopStudent() {
        int topIndex = 0;
        double topAvg = getAverage(0);
        for (int i = 1; i < studentCount; i++) {
            double avg = getAverage(i);
            if (avg > topAvg) {
                topAvg = avg;
                topIndex = i;
            }
        }
        return topIndex;
    }

    public void printReport() {
        System.out.println("=== Grade Report ===");
        System.out.printf("%-15s %-30s %s%n", "Name", "Grades", "Average");
        System.out.println("-".repeat(55));

        for (int i = 0; i < studentCount; i++) {
            int[] studentGrades = Arrays.copyOf(grades[i], gradeCount[i]);
            System.out.printf("%-15s %-30s %.2f%n",
                names[i],
                Arrays.toString(studentGrades),
                getAverage(i));
        }

        if (studentCount > 0) {
            int top = findTopStudent();
            System.out.println("\nTop student: " + names[top] +
                " (avg: " + String.format("%.2f", getAverage(top)) + ")");
        }
    }

    public void sortByAverage() {
        // Simple selection sort by average (descending)
        for (int i = 0; i < studentCount - 1; i++) {
            int maxIdx = i;
            for (int j = i + 1; j < studentCount; j++) {
                if (getAverage(j) > getAverage(maxIdx)) {
                    maxIdx = j;
                }
            }
            if (maxIdx != i) {
                // Swap names
                String tempName = names[i];
                names[i] = names[maxIdx];
                names[maxIdx] = tempName;

                // Swap grade arrays
                int[] tempGrades = grades[i];
                grades[i] = grades[maxIdx];
                grades[maxIdx] = tempGrades;

                // Swap grade counts
                int tempCount = gradeCount[i];
                gradeCount[i] = gradeCount[maxIdx];
                gradeCount[maxIdx] = tempCount;
            }
        }
    }

    public static void main(String[] args) {
        GradeManager gm = new GradeManager();

        gm.addStudent("Alice", 95, 88, 92);
        gm.addStudent("Bob", 78, 85, 80);
        gm.addStudent("Charlie", 90, 92, 88, 95);
        gm.addStudent("Diana", 72, 68, 75);

        gm.addGrade(1, 90); // Add a grade for Bob

        System.out.println("Before sorting:");
        gm.printReport();

        gm.sortByAverage();

        System.out.println("\nAfter sorting by average (descending):");
        gm.printReport();
    }
}
```
</details>

---

## Challenge: Implement Merge Sort from Scratch

**Difficulty:** Hard
**Estimated time:** 45 minutes

Implement the merge sort algorithm for `int[]` from scratch. Your implementation must:

1. Be recursive (divide and conquer)
2. Use a helper method `merge(int[] arr, int left, int mid, int right)`
3. Be stable (equal elements maintain their relative order)
4. Print each merge step for arrays of size <= 16 (for debugging)
5. Count and return the total number of comparisons made

**Bonus:** Implement an optimization where you switch to insertion sort for subarrays smaller than 10 elements.

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;

public class MergeSort {
    private int comparisons = 0;

    public int sort(int[] arr) {
        comparisons = 0;
        if (arr == null || arr.length <= 1) return 0;
        int[] temp = new int[arr.length];
        mergeSort(arr, temp, 0, arr.length - 1, arr.length <= 16);
        return comparisons;
    }

    private void mergeSort(int[] arr, int[] temp, int left, int right, boolean debug) {
        if (right - left < 10) {
            // Insertion sort for small subarrays
            insertionSort(arr, left, right);
            return;
        }

        int mid = left + (right - left) / 2;
        mergeSort(arr, temp, left, mid, debug);
        mergeSort(arr, temp, mid + 1, right, debug);
        merge(arr, temp, left, mid, right, debug);
    }

    private void merge(int[] arr, int[] temp, int left, int mid, int right, boolean debug) {
        // Copy to temp
        System.arraycopy(arr, left, temp, left, right - left + 1);

        int i = left, j = mid + 1, k = left;

        while (i <= mid && j <= right) {
            comparisons++;
            if (temp[i] <= temp[j]) { // <= for stability
                arr[k++] = temp[i++];
            } else {
                arr[k++] = temp[j++];
            }
        }

        while (i <= mid) {
            arr[k++] = temp[i++];
        }
        // remaining elements from right half are already in place

        if (debug) {
            int[] segment = Arrays.copyOfRange(arr, left, right + 1);
            System.out.printf("Merged [%d..%d]: %s%n", left, right, Arrays.toString(segment));
        }
    }

    private void insertionSort(int[] arr, int left, int right) {
        for (int i = left + 1; i <= right; i++) {
            int key = arr[i];
            int j = i - 1;
            while (j >= left && arr[j] > key) {
                comparisons++;
                arr[j + 1] = arr[j];
                j--;
            }
            if (j >= left) comparisons++;
            arr[j + 1] = key;
        }
    }

    public static void main(String[] args) {
        MergeSort ms = new MergeSort();

        int[] arr = {38, 27, 43, 3, 9, 82, 10};
        System.out.println("Before: " + Arrays.toString(arr));
        int comps = ms.sort(arr);
        System.out.println("After:  " + Arrays.toString(arr));
        System.out.println("Comparisons: " + comps);

        // Verify with larger array
        int[] large = new int[1000];
        for (int i = 0; i < large.length; i++) large[i] = (int)(Math.random() * 10000);
        ms.sort(large);

        // Check sorted
        boolean sorted = true;
        for (int i = 1; i < large.length; i++) {
            if (large[i] < large[i - 1]) { sorted = false; break; }
        }
        System.out.println("Large array sorted correctly: " + sorted);
    }
}
```
</details>
