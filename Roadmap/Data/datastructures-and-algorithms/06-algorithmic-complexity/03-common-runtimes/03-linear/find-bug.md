# Linear Time O(n) — Find the Bug

## Table of Contents

1. Bug 1: Linear Search Off-by-One
2. Bug 2: Find Maximum with Wrong Initial Value
3. Bug 3: Counting Even Numbers — Wrong Operator
4. Bug 4: Two Sum Missing Complement Check
5. Bug 5: Kadane's Algorithm Wrong Initialization
6. Bug 6: Sliding Window Wrong Update
7. Bug 7: Remove Duplicates Skipping Elements
8. Bug 8: Move Zeroes Losing Order
9. Bug 9: Prefix Sum Off-by-One
10. Bug 10: Merge Sorted Arrays Missing Remainder
11. Bug 11: Reverse Array Overshooting
12. Bug 12: Anagram Check Missing Length Check

---

## Bug 1: Linear Search Off-by-One

**Go — Find the bug:**

```go
func linearSearch(arr []int, target int) int {
    for i := 1; i < len(arr); i++ {
        if arr[i] == target {
            return i
        }
    }
    return -1
}
```

**Java — Find the bug:**

```java
public static int linearSearch(int[] arr, int target) {
    for (int i = 1; i < arr.length; i++) {
        if (arr[i] == target) {
            return i;
        }
    }
    return -1;
}
```

**Python — Find the bug:**

```python
def linear_search(arr: list[int], target: int) -> int:
    for i in range(1, len(arr)):
        if arr[i] == target:
            return i
    return -1
```

**Test case that fails:** `linear_search([5, 3, 7], 5)` returns `-1` instead of `0`.

<details>
<summary>Bug Explanation</summary>

**Bug:** The loop starts at index `1` instead of `0`. The first element is never checked.

**Fix:** Start the loop at index `0`:

```go
for i := 0; i < len(arr); i++ {
```

```java
for (int i = 0; i < arr.length; i++) {
```

```python
for i in range(len(arr)):
```

</details>

---

## Bug 2: Find Maximum with Wrong Initial Value

**Go — Find the bug:**

```go
func findMax(arr []int) int {
    max := 0
    for _, v := range arr {
        if v > max {
            max = v
        }
    }
    return max
}
```

**Java — Find the bug:**

```java
public static int findMax(int[] arr) {
    int max = 0;
    for (int v : arr) {
        if (v > max) {
            max = v;
        }
    }
    return max;
}
```

**Python — Find the bug:**

```python
def find_max(arr: list[int]) -> int:
    max_val = 0
    for v in arr:
        if v > max_val:
            max_val = v
    return max_val
```

**Test case that fails:** `find_max([-5, -2, -8, -1])` returns `0` instead of `-1`.

<details>
<summary>Bug Explanation</summary>

**Bug:** Initializing `max` to `0` fails for arrays with only negative numbers. The function returns `0` which is not even in the array.

**Fix:** Initialize to the first element or to the minimum possible integer:

```go
max := arr[0]  // or math.MinInt64
```

```java
int max = arr[0];  // or Integer.MIN_VALUE
```

```python
max_val = arr[0]  # or float("-inf")
```

</details>

---

## Bug 3: Counting Even Numbers — Wrong Operator

**Go — Find the bug:**

```go
func countEven(arr []int) int {
    count := 0
    for _, v := range arr {
        if v % 2 == 1 {
            count++
        }
    }
    return count
}
```

**Java — Find the bug:**

```java
public static int countEven(int[] arr) {
    int count = 0;
    for (int v : arr) {
        if (v % 2 == 1) {
            count++;
        }
    }
    return count;
}
```

**Python — Find the bug:**

```python
def count_even(arr: list[int]) -> int:
    count = 0
    for v in arr:
        if v % 2 == 1:
            count += 1
    return count
```

**Test case that fails:** `count_even([2, 4, 6])` returns `0` instead of `3`.

<details>
<summary>Bug Explanation</summary>

**Bug:** The condition `v % 2 == 1` checks for **odd** numbers, not even numbers. Additionally, for negative numbers in some languages, `v % 2` can be `-1` (not `1`), so this also misses negative odd numbers.

**Fix:** Check for `v % 2 == 0`:

```go
if v % 2 == 0 {
```

```java
if (v % 2 == 0) {
```

```python
if v % 2 == 0:
```

</details>

---

## Bug 4: Two Sum Missing Complement Check

**Go — Find the bug:**

```go
func twoSum(nums []int, target int) (int, int) {
    seen := make(map[int]int)
    for i, v := range nums {
        seen[v] = i
        complement := target - v
        if j, ok := seen[complement]; ok {
            return j, i
        }
    }
    return -1, -1
}
```

**Java — Find the bug:**

```java
public static int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        seen.put(nums[i], i);
        int complement = target - nums[i];
        if (seen.containsKey(complement)) {
            return new int[]{seen.get(complement), i};
        }
    }
    return new int[]{-1, -1};
}
```

**Python — Find the bug:**

```python
def two_sum(nums: list[int], target: int) -> tuple[int, int]:
    seen = {}
    for i, v in enumerate(nums):
        seen[v] = i
        complement = target - v
        if complement in seen:
            return (seen[complement], i)
    return (-1, -1)
```

**Test case that fails:** `two_sum([3, 2, 4], 6)` returns `(0, 0)` instead of `(1, 2)`.

<details>
<summary>Bug Explanation</summary>

**Bug:** The value is added to `seen` **before** checking for the complement. When `target = 6` and `v = 3`, the function stores `seen[3] = 0`, then looks for `complement = 3`, finds it at index `0`, and returns `(0, 0)` — pairing element 3 with itself.

**Fix:** Check for the complement **before** adding the current value:

```go
for i, v := range nums {
    complement := target - v
    if j, ok := seen[complement]; ok {
        return j, i
    }
    seen[v] = i  // add AFTER checking
}
```

```java
for (int i = 0; i < nums.length; i++) {
    int complement = target - nums[i];
    if (seen.containsKey(complement)) {
        return new int[]{seen.get(complement), i};
    }
    seen.put(nums[i], i);  // add AFTER checking
}
```

```python
for i, v in enumerate(nums):
    complement = target - v
    if complement in seen:
        return (seen[complement], i)
    seen[v] = i  # add AFTER checking
```

</details>

---

## Bug 5: Kadane's Algorithm Wrong Initialization

**Go — Find the bug:**

```go
func maxSubArray(nums []int) int {
    currentSum := 0
    maxSum := 0

    for _, v := range nums {
        if currentSum + v > v {
            currentSum = currentSum + v
        } else {
            currentSum = v
        }
        if currentSum > maxSum {
            maxSum = currentSum
        }
    }
    return maxSum
}
```

**Java — Find the bug:**

```java
public static int maxSubArray(int[] nums) {
    int currentSum = 0;
    int maxSum = 0;

    for (int v : nums) {
        currentSum = Math.max(v, currentSum + v);
        maxSum = Math.max(maxSum, currentSum);
    }
    return maxSum;
}
```

**Python — Find the bug:**

```python
def max_sub_array(nums: list[int]) -> int:
    current_sum = 0
    max_sum = 0

    for v in nums:
        current_sum = max(v, current_sum + v)
        max_sum = max(max_sum, current_sum)

    return max_sum
```

**Test case that fails:** `max_sub_array([-1, -2, -3])` returns `0` instead of `-1`.

<details>
<summary>Bug Explanation</summary>

**Bug:** Both `currentSum` and `maxSum` are initialized to `0`. When all elements are negative, `maxSum` never gets updated (all subarray sums are negative, which are less than 0), so it returns `0` — which is not a valid subarray sum.

**Fix:** Initialize both to `nums[0]` and start the loop from index 1:

```go
currentSum := nums[0]
maxSum := nums[0]
for i := 1; i < len(nums); i++ {
```

```java
int currentSum = nums[0];
int maxSum = nums[0];
for (int i = 1; i < nums.length; i++) {
```

```python
current_sum = nums[0]
max_sum = nums[0]
for v in nums[1:]:
```

</details>

---

## Bug 6: Sliding Window Wrong Update

**Go — Find the bug:**

```go
func maxSumWindow(arr []int, k int) int {
    windowSum := 0
    for i := 0; i < k; i++ {
        windowSum += arr[i]
    }
    maxSum := windowSum

    for i := k; i < len(arr); i++ {
        windowSum += arr[i] - arr[i-k+1]
        if windowSum > maxSum {
            maxSum = windowSum
        }
    }
    return maxSum
}
```

**Java — Find the bug:**

```java
public static int maxSumWindow(int[] arr, int k) {
    int windowSum = 0;
    for (int i = 0; i < k; i++) windowSum += arr[i];
    int maxSum = windowSum;

    for (int i = k; i < arr.length; i++) {
        windowSum += arr[i] - arr[i - k + 1];
        maxSum = Math.max(maxSum, windowSum);
    }
    return maxSum;
}
```

**Python — Find the bug:**

```python
def max_sum_window(arr: list[int], k: int) -> int:
    window_sum = sum(arr[:k])
    max_sum = window_sum

    for i in range(k, len(arr)):
        window_sum += arr[i] - arr[i - k + 1]
        max_sum = max(max_sum, window_sum)

    return max_sum
```

**Test case that fails:** `max_sum_window([2, 1, 5, 1, 3, 2], 3)` returns wrong answer.

<details>
<summary>Bug Explanation</summary>

**Bug:** When sliding the window, the element to remove is `arr[i - k]`, not `arr[i - k + 1]`. The expression `i - k + 1` removes the wrong element, making the window size incorrect.

When `i = 3` and `k = 3`: should remove `arr[0]` (i.e., `arr[3-3] = arr[0]`), but instead removes `arr[1]` (i.e., `arr[3-3+1] = arr[1]`).

**Fix:** Use `arr[i - k]`:

```go
windowSum += arr[i] - arr[i-k]
```

```java
windowSum += arr[i] - arr[i - k];
```

```python
window_sum += arr[i] - arr[i - k]
```

</details>

---

## Bug 7: Remove Duplicates Skipping Elements

**Go — Find the bug:**

```go
func removeDuplicates(nums []int) int {
    if len(nums) == 0 {
        return 0
    }
    slow := 0
    for fast := 1; fast < len(nums); fast++ {
        if nums[fast] != nums[slow] {
            nums[slow] = nums[fast]
            slow++
        }
    }
    return slow + 1
}
```

**Java — Find the bug:**

```java
public static int removeDuplicates(int[] nums) {
    if (nums.length == 0) return 0;
    int slow = 0;
    for (int fast = 1; fast < nums.length; fast++) {
        if (nums[fast] != nums[slow]) {
            nums[slow] = nums[fast];
            slow++;
        }
    }
    return slow + 1;
}
```

**Python — Find the bug:**

```python
def remove_duplicates(nums: list[int]) -> int:
    if not nums:
        return 0
    slow = 0
    for fast in range(1, len(nums)):
        if nums[fast] != nums[slow]:
            nums[slow] = nums[fast]
            slow += 1
    return slow + 1
```

**Test case that fails:** `remove_duplicates([1, 1, 2, 3])` returns 3 with array `[2, 3, 2, 3]`. Expected: `[1, 2, 3, ...]`.

<details>
<summary>Bug Explanation</summary>

**Bug:** The assignment `nums[slow] = nums[fast]` overwrites the current unique element **before** advancing `slow`. The first unique element (at index 0) gets overwritten.

**Fix:** Advance `slow` first, then assign:

```go
if nums[fast] != nums[slow] {
    slow++
    nums[slow] = nums[fast]  // advance THEN assign
}
```

```java
if (nums[fast] != nums[slow]) {
    slow++;
    nums[slow] = nums[fast];  // advance THEN assign
}
```

```python
if nums[fast] != nums[slow]:
    slow += 1
    nums[slow] = nums[fast]  # advance THEN assign
```

</details>

---

## Bug 8: Move Zeroes Losing Order

**Go — Find the bug:**

```go
func moveZeroes(nums []int) {
    left, right := 0, len(nums)-1
    for left < right {
        if nums[left] == 0 {
            nums[left], nums[right] = nums[right], nums[left]
            right--
        } else {
            left++
        }
    }
}
```

**Java — Find the bug:**

```java
public static void moveZeroes(int[] nums) {
    int left = 0, right = nums.length - 1;
    while (left < right) {
        if (nums[left] == 0) {
            int temp = nums[left];
            nums[left] = nums[right];
            nums[right] = temp;
            right--;
        } else {
            left++;
        }
    }
}
```

**Python — Find the bug:**

```python
def move_zeroes(nums: list[int]) -> None:
    left, right = 0, len(nums) - 1
    while left < right:
        if nums[left] == 0:
            nums[left], nums[right] = nums[right], nums[left]
            right -= 1
        else:
            left += 1
```

**Test case that fails:** `move_zeroes([0, 1, 0, 3, 12])` produces `[12, 1, 3, 0, 0]` instead of `[1, 3, 12, 0, 0]`.

<details>
<summary>Bug Explanation</summary>

**Bug:** This approach swaps zeroes with elements from the end, which destroys the relative order of non-zero elements. The requirement is to maintain relative order.

**Fix:** Use a single-direction two-pointer approach. The `slow` pointer marks where the next non-zero should go:

```go
func moveZeroes(nums []int) {
    slow := 0
    for fast := 0; fast < len(nums); fast++ {
        if nums[fast] != 0 {
            nums[slow], nums[fast] = nums[fast], nums[slow]
            slow++
        }
    }
}
```

```java
public static void moveZeroes(int[] nums) {
    int slow = 0;
    for (int fast = 0; fast < nums.length; fast++) {
        if (nums[fast] != 0) {
            int temp = nums[slow];
            nums[slow] = nums[fast];
            nums[fast] = temp;
            slow++;
        }
    }
}
```

```python
def move_zeroes(nums: list[int]) -> None:
    slow = 0
    for fast in range(len(nums)):
        if nums[fast] != 0:
            nums[slow], nums[fast] = nums[fast], nums[slow]
            slow += 1
```

</details>

---

## Bug 9: Prefix Sum Off-by-One

**Go — Find the bug:**

```go
func prefixSum(arr []int) []int {
    result := make([]int, len(arr))
    result[0] = arr[0]
    for i := 1; i <= len(arr); i++ {
        result[i] = result[i-1] + arr[i]
    }
    return result
}
```

**Java — Find the bug:**

```java
public static int[] prefixSum(int[] arr) {
    int[] result = new int[arr.length];
    result[0] = arr[0];
    for (int i = 1; i <= arr.length; i++) {
        result[i] = result[i - 1] + arr[i];
    }
    return result;
}
```

**Python — Find the bug:**

```python
def prefix_sum(arr: list[int]) -> list[int]:
    result = [0] * len(arr)
    result[0] = arr[0]
    for i in range(1, len(arr) + 1):
        result[i] = result[i - 1] + arr[i]
    return result
```

**Test case that fails:** `prefix_sum([1, 2, 3])` crashes with index out of bounds.

<details>
<summary>Bug Explanation</summary>

**Bug:** The loop condition uses `<=` instead of `<`, causing an out-of-bounds access at `i = len(arr)`.

**Fix:** Use `< len(arr)`:

```go
for i := 1; i < len(arr); i++ {
```

```java
for (int i = 1; i < arr.length; i++) {
```

```python
for i in range(1, len(arr)):
```

</details>

---

## Bug 10: Merge Sorted Arrays Missing Remainder

**Go — Find the bug:**

```go
func mergeSorted(a, b []int) []int {
    result := make([]int, 0, len(a)+len(b))
    i, j := 0, 0
    for i < len(a) && j < len(b) {
        if a[i] <= b[j] {
            result = append(result, a[i])
            i++
        } else {
            result = append(result, b[j])
            j++
        }
    }
    return result
}
```

**Java — Find the bug:**

```java
public static int[] mergeSorted(int[] a, int[] b) {
    int[] result = new int[a.length + b.length];
    int i = 0, j = 0, k = 0;
    while (i < a.length && j < b.length) {
        if (a[i] <= b[j]) result[k++] = a[i++];
        else result[k++] = b[j++];
    }
    return result;
}
```

**Python — Find the bug:**

```python
def merge_sorted(a: list[int], b: list[int]) -> list[int]:
    result = []
    i, j = 0, 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:
            result.append(a[i])
            i += 1
        else:
            result.append(b[j])
            j += 1
    return result
```

**Test case that fails:** `merge_sorted([1, 3, 5], [2, 4])` returns `[1, 2, 3, 4]` instead of `[1, 2, 3, 4, 5]`.

<details>
<summary>Bug Explanation</summary>

**Bug:** After the main merge loop, the remaining elements of whichever array is not exhausted are never appended. The element `5` from array `a` is lost.

**Fix:** Append remaining elements after the loop:

```go
result = append(result, a[i:]...)
result = append(result, b[j:]...)
```

```java
while (i < a.length) result[k++] = a[i++];
while (j < b.length) result[k++] = b[j++];
```

```python
result.extend(a[i:])
result.extend(b[j:])
```

</details>

---

## Bug 11: Reverse Array Overshooting

**Go — Find the bug:**

```go
func reverseInPlace(arr []int) {
    left, right := 0, len(arr)-1
    for left <= right {
        arr[left], arr[right] = arr[right], arr[left]
        left++
        right--
    }
}
```

**Java — Find the bug:**

```java
public static void reverseInPlace(int[] arr) {
    int left = 0, right = arr.length - 1;
    while (left <= right) {
        int temp = arr[left];
        arr[left] = arr[right];
        arr[right] = temp;
        left++;
        right--;
    }
}
```

**Python — Find the bug:**

```python
def reverse_in_place(arr: list[int]) -> None:
    left, right = 0, len(arr) - 1
    while left <= right:
        arr[left], arr[right] = arr[right], arr[left]
        left += 1
        right -= 1
```

**Test case:** `reverse_in_place([1, 2, 3])` actually works correctly and produces `[3, 2, 1]`.

<details>
<summary>Bug Explanation</summary>

**Trick question:** This code is actually **correct**. The condition `left <= right` causes an extra swap when `left == right` (the middle element swaps with itself), which is harmless. The condition `left < right` is slightly more efficient (avoids one unnecessary swap), but both produce correct results.

**Lesson:** Not every code that looks slightly off is actually buggy. In interviews, always verify with test cases before declaring a bug.

</details>

---

## Bug 12: Anagram Check Missing Length Check

**Go — Find the bug:**

```go
func isAnagram(s, t string) bool {
    counts := make(map[rune]int)
    for _, ch := range s {
        counts[ch]++
    }
    for _, ch := range t {
        counts[ch]--
    }
    for _, v := range counts {
        if v != 0 {
            return false
        }
    }
    return true
}
```

**Java — Find the bug:**

```java
public static boolean isAnagram(String s, String t) {
    int[] counts = new int[26];
    for (char ch : s.toCharArray()) counts[ch - 'a']++;
    for (char ch : t.toCharArray()) counts[ch - 'a']--;
    for (int c : counts) {
        if (c != 0) return false;
    }
    return true;
}
```

**Python — Find the bug:**

```python
def is_anagram(s: str, t: str) -> bool:
    counts = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    for ch in t:
        counts[ch] = counts.get(ch, 0) - 1
    return all(v == 0 for v in counts.values())
```

**Observation:** This code is actually **logically correct** and handles different-length strings properly (if lengths differ, some count will be non-zero). However, it can be optimized.

<details>
<summary>Discussion</summary>

**This code works correctly** but is suboptimal. Adding an early length check avoids unnecessary processing:

```go
if len(s) != len(t) {
    return false
}
```

```java
if (s.length() != t.length()) return false;
```

```python
if len(s) != len(t):
    return False
```

**Also note:** The Java version assumes only lowercase letters. If the input contains uppercase or non-ASCII characters, `ch - 'a'` will cause an array index out of bounds. Use a `HashMap<Character, Integer>` or a 128-element array for full ASCII support.

</details>
