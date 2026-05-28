# Linear Time O(n) — Optimize

## Table of Contents

1. Exercise 1: Contains Duplicate — O(n^2) to O(n)
2. Exercise 2: Two Sum — O(n^2) to O(n)
3. Exercise 3: Maximum Subarray Sum — O(n^3) to O(n)
4. Exercise 4: Find Missing Number — O(n log n) to O(n)
5. Exercise 5: Intersection of Two Arrays — O(n*m) to O(n+m)
6. Exercise 6: String Compression — O(n^2) to O(n)
7. Exercise 7: First Duplicate — O(n^2) to O(n)
8. Exercise 8: Maximum Sliding Window Sum — O(n*k) to O(n)
9. Exercise 9: Sort Array of 0s, 1s, 2s — O(n log n) to O(n)
10. Exercise 10: Product Except Self — O(n^2) to O(n)
11. Exercise 11: Majority Element — O(n log n) to O(n)
12. Exercise 12: Longest Consecutive Sequence — O(n log n) to O(n)

---

## Exercise 1: Contains Duplicate — O(n^2) to O(n)

### Slow Version — O(n^2)

**Go:**

```go
func containsDuplicate(nums []int) bool {
    for i := 0; i < len(nums); i++ {
        for j := i + 1; j < len(nums); j++ {
            if nums[i] == nums[j] {
                return true
            }
        }
    }
    return false
}
```

**Java:**

```java
public static boolean containsDuplicate(int[] nums) {
    for (int i = 0; i < nums.length; i++) {
        for (int j = i + 1; j < nums.length; j++) {
            if (nums[i] == nums[j]) return true;
        }
    }
    return false;
}
```

**Python:**

```python
def contains_duplicate(nums: list[int]) -> bool:
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] == nums[j]:
                return True
    return False
```

### Your Task

Optimize to O(n) using a hash set.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func containsDuplicate(nums []int) bool {
    seen := make(map[int]bool)
    for _, v := range nums {
        if seen[v] {
            return true
        }
        seen[v] = true
    }
    return false
}
```

**Java:**

```java
public static boolean containsDuplicate(int[] nums) {
    Set<Integer> seen = new HashSet<>();
    for (int v : nums) {
        if (!seen.add(v)) return true;
    }
    return false;
}
```

**Python:**

```python
def contains_duplicate(nums: list[int]) -> bool:
    seen = set()
    for v in nums:
        if v in seen:
            return True
        seen.add(v)
    return False
```

**Why O(n):** Each element is processed once. Hash set insertion and lookup are O(1) average.

</details>

---

## Exercise 2: Two Sum — O(n^2) to O(n)

### Slow Version — O(n^2)

**Go:**

```go
func twoSum(nums []int, target int) (int, int) {
    for i := 0; i < len(nums); i++ {
        for j := i + 1; j < len(nums); j++ {
            if nums[i]+nums[j] == target {
                return i, j
            }
        }
    }
    return -1, -1
}
```

**Java:**

```java
public static int[] twoSum(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++) {
        for (int j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] == target) {
                return new int[]{i, j};
            }
        }
    }
    return new int[]{-1, -1};
}
```

**Python:**

```python
def two_sum(nums: list[int], target: int) -> tuple[int, int]:
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return (i, j)
    return (-1, -1)
```

### Your Task

Optimize to O(n) using a hash map to store complements.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func twoSum(nums []int, target int) (int, int) {
    seen := make(map[int]int) // value -> index
    for i, v := range nums {
        if j, ok := seen[target-v]; ok {
            return j, i
        }
        seen[v] = i
    }
    return -1, -1
}
```

**Java:**

```java
public static int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        if (seen.containsKey(complement)) {
            return new int[]{seen.get(complement), i};
        }
        seen.put(nums[i], i);
    }
    return new int[]{-1, -1};
}
```

**Python:**

```python
def two_sum(nums: list[int], target: int) -> tuple[int, int]:
    seen = {}
    for i, v in enumerate(nums):
        complement = target - v
        if complement in seen:
            return (seen[complement], i)
        seen[v] = i
    return (-1, -1)
```

**Why O(n):** Single pass. For each element, we check if its complement exists in O(1) via hash map lookup.

</details>

---

## Exercise 3: Maximum Subarray Sum — O(n^3) to O(n)

### Slow Version — O(n^3)

**Go:**

```go
func maxSubArray(nums []int) int {
    n := len(nums)
    maxSum := nums[0]
    for i := 0; i < n; i++ {
        for j := i; j < n; j++ {
            sum := 0
            for k := i; k <= j; k++ {
                sum += nums[k]
            }
            if sum > maxSum {
                maxSum = sum
            }
        }
    }
    return maxSum
}
```

**Java:**

```java
public static int maxSubArray(int[] nums) {
    int maxSum = nums[0];
    for (int i = 0; i < nums.length; i++) {
        for (int j = i; j < nums.length; j++) {
            int sum = 0;
            for (int k = i; k <= j; k++) {
                sum += nums[k];
            }
            maxSum = Math.max(maxSum, sum);
        }
    }
    return maxSum;
}
```

**Python:**

```python
def max_sub_array(nums: list[int]) -> int:
    max_sum = nums[0]
    n = len(nums)
    for i in range(n):
        for j in range(i, n):
            current = sum(nums[i:j+1])
            max_sum = max(max_sum, current)
    return max_sum
```

### Your Task

Optimize to O(n) using Kadane's algorithm.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func maxSubArray(nums []int) int {
    currentMax := nums[0]
    globalMax := nums[0]
    for i := 1; i < len(nums); i++ {
        if currentMax+nums[i] > nums[i] {
            currentMax += nums[i]
        } else {
            currentMax = nums[i]
        }
        if currentMax > globalMax {
            globalMax = currentMax
        }
    }
    return globalMax
}
```

**Java:**

```java
public static int maxSubArray(int[] nums) {
    int currentMax = nums[0], globalMax = nums[0];
    for (int i = 1; i < nums.length; i++) {
        currentMax = Math.max(nums[i], currentMax + nums[i]);
        globalMax = Math.max(globalMax, currentMax);
    }
    return globalMax;
}
```

**Python:**

```python
def max_sub_array(nums: list[int]) -> int:
    current_max = global_max = nums[0]
    for v in nums[1:]:
        current_max = max(v, current_max + v)
        global_max = max(global_max, current_max)
    return global_max
```

**Improvement:** O(n^3) -> O(n). For n=10,000: from 10^12 ops to 10^4 ops.

</details>

---

## Exercise 4: Find Missing Number — O(n log n) to O(n)

### Slow Version — O(n log n)

Given an array containing n distinct numbers from 0 to n, find the missing number.

**Go:**

```go
import "sort"

func missingNumber(nums []int) int {
    sort.Ints(nums)
    for i, v := range nums {
        if v != i {
            return i
        }
    }
    return len(nums)
}
```

**Java:**

```java
public static int missingNumber(int[] nums) {
    Arrays.sort(nums);
    for (int i = 0; i < nums.length; i++) {
        if (nums[i] != i) return i;
    }
    return nums.length;
}
```

**Python:**

```python
def missing_number(nums: list[int]) -> int:
    nums.sort()
    for i, v in enumerate(nums):
        if v != i:
            return i
    return len(nums)
```

### Your Task

Optimize to O(n) using the sum formula or XOR.

<details>
<summary>Optimized Solution — O(n) with Sum</summary>

**Go:**

```go
func missingNumber(nums []int) int {
    n := len(nums)
    expectedSum := n * (n + 1) / 2
    actualSum := 0
    for _, v := range nums {
        actualSum += v
    }
    return expectedSum - actualSum
}
```

**Java:**

```java
public static int missingNumber(int[] nums) {
    int n = nums.length;
    int expectedSum = n * (n + 1) / 2;
    int actualSum = 0;
    for (int v : nums) actualSum += v;
    return expectedSum - actualSum;
}
```

**Python:**

```python
def missing_number(nums: list[int]) -> int:
    n = len(nums)
    return n * (n + 1) // 2 - sum(nums)
```

**Alternative O(n) with XOR:** XOR all indices 0..n with all array elements. The missing number remains because every other number cancels out (x XOR x = 0).

</details>

---

## Exercise 5: Intersection of Two Arrays — O(n*m) to O(n+m)

### Slow Version — O(n*m)

**Go:**

```go
func intersection(nums1, nums2 []int) []int {
    var result []int
    for _, a := range nums1 {
        for _, b := range nums2 {
            if a == b {
                // Check if already in result
                found := false
                for _, r := range result {
                    if r == a {
                        found = true
                        break
                    }
                }
                if !found {
                    result = append(result, a)
                }
                break
            }
        }
    }
    return result
}
```

**Python:**

```python
def intersection(nums1: list[int], nums2: list[int]) -> list[int]:
    result = []
    for a in nums1:
        for b in nums2:
            if a == b and a not in result:
                result.append(a)
                break
    return result
```

### Your Task

Optimize to O(n + m) using sets.

<details>
<summary>Optimized Solution — O(n + m)</summary>

**Go:**

```go
func intersection(nums1, nums2 []int) []int {
    set1 := make(map[int]bool)
    for _, v := range nums1 {
        set1[v] = true
    }
    seen := make(map[int]bool)
    var result []int
    for _, v := range nums2 {
        if set1[v] && !seen[v] {
            result = append(result, v)
            seen[v] = true
        }
    }
    return result
}
```

**Java:**

```java
public static int[] intersection(int[] nums1, int[] nums2) {
    Set<Integer> set1 = new HashSet<>();
    for (int v : nums1) set1.add(v);
    Set<Integer> result = new HashSet<>();
    for (int v : nums2) {
        if (set1.contains(v)) result.add(v);
    }
    return result.stream().mapToInt(Integer::intValue).toArray();
}
```

**Python:**

```python
def intersection(nums1: list[int], nums2: list[int]) -> list[int]:
    return list(set(nums1) & set(nums2))
```

</details>

---

## Exercise 6: String Compression — O(n^2) to O(n)

### Slow Version — O(n^2) due to string concatenation

**Python:**

```python
def compress(s: str) -> str:
    result = ""
    i = 0
    while i < len(s):
        count = 1
        while i + count < len(s) and s[i + count] == s[i]:
            count += 1
        result += s[i] + str(count)  # O(n) string copy each time!
        i += count
    return result
```

**Java:**

```java
public static String compress(String s) {
    String result = "";
    int i = 0;
    while (i < s.length()) {
        int count = 1;
        while (i + count < s.length() && s.charAt(i + count) == s.charAt(i)) {
            count++;
        }
        result += s.charAt(i) + "" + count;  // O(n) string copy each time!
        i += count;
    }
    return result;
}
```

### Your Task

Optimize to O(n) using StringBuilder / list.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
import (
    "fmt"
    "strings"
)

func compress(s string) string {
    var sb strings.Builder
    i := 0
    for i < len(s) {
        count := 1
        for i+count < len(s) && s[i+count] == s[i] {
            count++
        }
        sb.WriteByte(s[i])
        fmt.Fprintf(&sb, "%d", count)
        i += count
    }
    return sb.String()
}
```

**Java:**

```java
public static String compress(String s) {
    StringBuilder sb = new StringBuilder();
    int i = 0;
    while (i < s.length()) {
        int count = 1;
        while (i + count < s.length() && s.charAt(i + count) == s.charAt(i)) {
            count++;
        }
        sb.append(s.charAt(i)).append(count);
        i += count;
    }
    return sb.toString();
}
```

**Python:**

```python
def compress(s: str) -> str:
    parts = []
    i = 0
    while i < len(s):
        count = 1
        while i + count < len(s) and s[i + count] == s[i]:
            count += 1
        parts.append(s[i])
        parts.append(str(count))
        i += count
    return "".join(parts)  # single O(n) join
```

**Why O(n):** StringBuilder/list append is amortized O(1). The final join/toString is O(n). Total: O(n).

</details>

---

## Exercise 7: First Duplicate — O(n^2) to O(n)

### Slow Version — O(n^2)

**Go:**

```go
func firstDuplicate(arr []int) int {
    for i := 0; i < len(arr); i++ {
        for j := 0; j < i; j++ {
            if arr[i] == arr[j] {
                return arr[i]
            }
        }
    }
    return -1
}
```

**Python:**

```python
def first_duplicate(arr: list[int]) -> int:
    for i in range(len(arr)):
        for j in range(i):
            if arr[i] == arr[j]:
                return arr[i]
    return -1
```

### Your Task

Optimize to O(n) using a hash set.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func firstDuplicate(arr []int) int {
    seen := make(map[int]bool)
    for _, v := range arr {
        if seen[v] {
            return v
        }
        seen[v] = true
    }
    return -1
}
```

**Java:**

```java
public static int firstDuplicate(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    for (int v : arr) {
        if (!seen.add(v)) return v;
    }
    return -1;
}
```

**Python:**

```python
def first_duplicate(arr: list[int]) -> int:
    seen = set()
    for v in arr:
        if v in seen:
            return v
        seen.add(v)
    return -1
```

</details>

---

## Exercise 8: Maximum Sliding Window Sum — O(n*k) to O(n)

### Slow Version — O(n*k)

**Go:**

```go
func maxSumWindow(arr []int, k int) int {
    maxSum := 0
    for i := 0; i <= len(arr)-k; i++ {
        sum := 0
        for j := i; j < i+k; j++ {
            sum += arr[j]
        }
        if i == 0 || sum > maxSum {
            maxSum = sum
        }
    }
    return maxSum
}
```

**Python:**

```python
def max_sum_window(arr: list[int], k: int) -> int:
    max_sum = float("-inf")
    for i in range(len(arr) - k + 1):
        current = sum(arr[i:i+k])
        max_sum = max(max_sum, current)
    return max_sum
```

### Your Task

Optimize to O(n) using the sliding window technique.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func maxSumWindow(arr []int, k int) int {
    windowSum := 0
    for i := 0; i < k; i++ {
        windowSum += arr[i]
    }
    maxSum := windowSum
    for i := k; i < len(arr); i++ {
        windowSum += arr[i] - arr[i-k]
        if windowSum > maxSum {
            maxSum = windowSum
        }
    }
    return maxSum
}
```

**Java:**

```java
public static int maxSumWindow(int[] arr, int k) {
    int windowSum = 0;
    for (int i = 0; i < k; i++) windowSum += arr[i];
    int maxSum = windowSum;
    for (int i = k; i < arr.length; i++) {
        windowSum += arr[i] - arr[i - k];
        maxSum = Math.max(maxSum, windowSum);
    }
    return maxSum;
}
```

**Python:**

```python
def max_sum_window(arr: list[int], k: int) -> int:
    window_sum = sum(arr[:k])
    max_sum = window_sum
    for i in range(k, len(arr)):
        window_sum += arr[i] - arr[i - k]
        max_sum = max(max_sum, window_sum)
    return max_sum
```

**Why O(n):** Instead of recomputing the sum of k elements for each window position, we add the new element and remove the old one in O(1).

</details>

---

## Exercise 9: Sort Array of 0s, 1s, 2s — O(n log n) to O(n)

### Slow Version — O(n log n)

**Python:**

```python
def sort_colors(nums: list[int]) -> None:
    nums.sort()  # General-purpose sort, O(n log n)
```

### Your Task

Optimize to O(n) using the Dutch National Flag algorithm (three pointers).

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func sortColors(nums []int) {
    low, mid, high := 0, 0, len(nums)-1
    for mid <= high {
        switch nums[mid] {
        case 0:
            nums[low], nums[mid] = nums[mid], nums[low]
            low++
            mid++
        case 1:
            mid++
        case 2:
            nums[mid], nums[high] = nums[high], nums[mid]
            high--
        }
    }
}
```

**Java:**

```java
public static void sortColors(int[] nums) {
    int low = 0, mid = 0, high = nums.length - 1;
    while (mid <= high) {
        if (nums[mid] == 0) {
            int tmp = nums[low]; nums[low] = nums[mid]; nums[mid] = tmp;
            low++; mid++;
        } else if (nums[mid] == 1) {
            mid++;
        } else {
            int tmp = nums[mid]; nums[mid] = nums[high]; nums[high] = tmp;
            high--;
        }
    }
}
```

**Python:**

```python
def sort_colors(nums: list[int]) -> None:
    low, mid, high = 0, 0, len(nums) - 1
    while mid <= high:
        if nums[mid] == 0:
            nums[low], nums[mid] = nums[mid], nums[low]
            low += 1
            mid += 1
        elif nums[mid] == 1:
            mid += 1
        else:
            nums[mid], nums[high] = nums[high], nums[mid]
            high -= 1
```

**Why O(n):** Single pass with three pointers. Each element is swapped at most twice.

</details>

---

## Exercise 10: Product Except Self — O(n^2) to O(n)

### Slow Version — O(n^2)

**Go:**

```go
func productExceptSelf(nums []int) []int {
    n := len(nums)
    result := make([]int, n)
    for i := 0; i < n; i++ {
        product := 1
        for j := 0; j < n; j++ {
            if j != i {
                product *= nums[j]
            }
        }
        result[i] = product
    }
    return result
}
```

**Python:**

```python
def product_except_self(nums: list[int]) -> list[int]:
    n = len(nums)
    result = [1] * n
    for i in range(n):
        for j in range(n):
            if j != i:
                result[i] *= nums[j]
    return result
```

### Your Task

Optimize to O(n) using prefix and suffix products.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func productExceptSelf(nums []int) []int {
    n := len(nums)
    result := make([]int, n)

    // Left pass: result[i] = product of all elements to the left of i
    result[0] = 1
    for i := 1; i < n; i++ {
        result[i] = result[i-1] * nums[i-1]
    }

    // Right pass: multiply by product of all elements to the right
    rightProduct := 1
    for i := n - 1; i >= 0; i-- {
        result[i] *= rightProduct
        rightProduct *= nums[i]
    }

    return result
}
```

**Java:**

```java
public static int[] productExceptSelf(int[] nums) {
    int n = nums.length;
    int[] result = new int[n];

    result[0] = 1;
    for (int i = 1; i < n; i++) {
        result[i] = result[i - 1] * nums[i - 1];
    }

    int rightProduct = 1;
    for (int i = n - 1; i >= 0; i--) {
        result[i] *= rightProduct;
        rightProduct *= nums[i];
    }

    return result;
}
```

**Python:**

```python
def product_except_self(nums: list[int]) -> list[int]:
    n = len(nums)
    result = [1] * n

    # Left pass
    for i in range(1, n):
        result[i] = result[i - 1] * nums[i - 1]

    # Right pass
    right_product = 1
    for i in range(n - 1, -1, -1):
        result[i] *= right_product
        right_product *= nums[i]

    return result
```

**Why O(n):** Two passes, each O(n). No division used. O(1) extra space (output array excluded).

</details>

---

## Exercise 11: Majority Element — O(n log n) to O(n)

### Slow Version — O(n log n)

**Python:**

```python
def majority_element(nums: list[int]) -> int:
    nums.sort()
    return nums[len(nums) // 2]
```

### Your Task

Optimize to O(n) using Boyer-Moore Voting Algorithm.

<details>
<summary>Optimized Solution — O(n) time, O(1) space</summary>

**Go:**

```go
func majorityElement(nums []int) int {
    candidate := nums[0]
    count := 1
    for i := 1; i < len(nums); i++ {
        if count == 0 {
            candidate = nums[i]
            count = 1
        } else if nums[i] == candidate {
            count++
        } else {
            count--
        }
    }
    return candidate
}
```

**Java:**

```java
public static int majorityElement(int[] nums) {
    int candidate = nums[0], count = 1;
    for (int i = 1; i < nums.length; i++) {
        if (count == 0) { candidate = nums[i]; count = 1; }
        else if (nums[i] == candidate) count++;
        else count--;
    }
    return candidate;
}
```

**Python:**

```python
def majority_element(nums: list[int]) -> int:
    candidate, count = nums[0], 1
    for v in nums[1:]:
        if count == 0:
            candidate, count = v, 1
        elif v == candidate:
            count += 1
        else:
            count -= 1
    return candidate
```

**Why O(n):** Single pass with O(1) space. Boyer-Moore Voting works because the majority element's count survives all cancellations.

</details>

---

## Exercise 12: Longest Consecutive Sequence — O(n log n) to O(n)

### Slow Version — O(n log n)

**Python:**

```python
def longest_consecutive(nums: list[int]) -> int:
    if not nums:
        return 0
    nums.sort()
    longest = 1
    current = 1
    for i in range(1, len(nums)):
        if nums[i] == nums[i-1]:
            continue
        if nums[i] == nums[i-1] + 1:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest
```

### Your Task

Optimize to O(n) using a hash set.

<details>
<summary>Optimized Solution — O(n)</summary>

**Go:**

```go
func longestConsecutive(nums []int) int {
    numSet := make(map[int]bool)
    for _, v := range nums {
        numSet[v] = true
    }

    longest := 0
    for num := range numSet {
        // Only start counting from the beginning of a sequence
        if !numSet[num-1] {
            current := num
            length := 1
            for numSet[current+1] {
                current++
                length++
            }
            if length > longest {
                longest = length
            }
        }
    }
    return longest
}
```

**Java:**

```java
public static int longestConsecutive(int[] nums) {
    Set<Integer> numSet = new HashSet<>();
    for (int v : nums) numSet.add(v);

    int longest = 0;
    for (int num : numSet) {
        if (!numSet.contains(num - 1)) {  // start of sequence
            int current = num;
            int length = 1;
            while (numSet.contains(current + 1)) {
                current++;
                length++;
            }
            longest = Math.max(longest, length);
        }
    }
    return longest;
}
```

**Python:**

```python
def longest_consecutive(nums: list[int]) -> int:
    num_set = set(nums)
    longest = 0

    for num in num_set:
        if num - 1 not in num_set:  # start of a sequence
            current = num
            length = 1
            while current + 1 in num_set:
                current += 1
                length += 1
            longest = max(longest, length)

    return longest
```

**Why O(n):** Each number is visited at most twice: once in the outer loop and once in the inner while loop (only when it is part of a sequence started by the outer loop). The key insight is that we only start counting from numbers that have no predecessor in the set.

</details>
