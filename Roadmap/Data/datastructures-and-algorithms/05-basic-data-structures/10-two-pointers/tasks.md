# Two Pointers — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python** in that order.
> For each task, **state the variant** (converging / slow-fast / merge), **write the invariant**, then code.

---

## Beginner Tasks

### Task 1 — Reverse Array In Place

Reverse the order of elements of `arr` in place. Do not allocate a second array.

**Variant:** converging. **Invariant:** `arr[0..l-1]` and `arr[r+1..n-1]` have been swapped; `arr[l..r]` is the still-to-reverse middle.

#### Go

```go
package main

import "fmt"

func reverse(arr []int) {
    l, r := 0, len(arr)-1
    for l < r {
        arr[l], arr[r] = arr[r], arr[l]
        l++
        r--
    }
}

func main() {
    a := []int{1, 2, 3, 4, 5}
    reverse(a)
    fmt.Println(a) // [5 4 3 2 1]
}
```

#### Java

```java
public class Task1 {
    public static void reverse(int[] arr) {
        int l = 0, r = arr.length - 1;
        while (l < r) {
            int t = arr[l]; arr[l] = arr[r]; arr[r] = t;
            l++; r--;
        }
    }

    public static void main(String[] args) {
        int[] a = {1, 2, 3, 4, 5};
        reverse(a);
        System.out.println(java.util.Arrays.toString(a)); // [5, 4, 3, 2, 1]
    }
}
```

#### Python

```python
def reverse(arr: list[int]) -> None:
    l, r = 0, len(arr) - 1
    while l < r:
        arr[l], arr[r] = arr[r], arr[l]
        l += 1
        r -= 1


if __name__ == "__main__":
    a = [1, 2, 3, 4, 5]
    reverse(a)
    print(a)  # [5, 4, 3, 2, 1]
```

---

### Task 2 — Squares of a Sorted Array

Given an array sorted in non-decreasing order which may contain negative numbers, return a new array of the squares, also sorted.

**Variant:** converging. **Invariant:** `out[k+1..]` is filled with the largest squares so far in sorted order.

#### Go

```go
package main

import "fmt"

func sortedSquares(nums []int) []int {
    n := len(nums)
    out := make([]int, n)
    l, r, k := 0, n-1, n-1
    for l <= r {
        ls, rs := nums[l]*nums[l], nums[r]*nums[r]
        if ls > rs {
            out[k] = ls
            l++
        } else {
            out[k] = rs
            r--
        }
        k--
    }
    return out
}

func main() {
    fmt.Println(sortedSquares([]int{-4, -1, 0, 3, 10})) // [0 1 9 16 100]
}
```

#### Java

```java
public class Task2 {
    public static int[] sortedSquares(int[] nums) {
        int n = nums.length;
        int[] out = new int[n];
        int l = 0, r = n - 1, k = n - 1;
        while (l <= r) {
            int ls = nums[l] * nums[l];
            int rs = nums[r] * nums[r];
            if (ls > rs) {
                out[k--] = ls; l++;
            } else {
                out[k--] = rs; r--;
            }
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(java.util.Arrays.toString(
            sortedSquares(new int[]{-4, -1, 0, 3, 10}))); // [0, 1, 9, 16, 100]
    }
}
```

#### Python

```python
def sorted_squares(nums: list[int]) -> list[int]:
    n = len(nums)
    out = [0] * n
    l, r, k = 0, n - 1, n - 1
    while l <= r:
        ls, rs = nums[l] * nums[l], nums[r] * nums[r]
        if ls > rs:
            out[k] = ls
            l += 1
        else:
            out[k] = rs
            r -= 1
        k -= 1
    return out


if __name__ == "__main__":
    print(sorted_squares([-4, -1, 0, 3, 10]))  # [0, 1, 9, 16, 100]
```

---

### Task 3 — Move Zeros To End

Move all zeros in `nums` to the end while preserving the relative order of non-zero elements. Modify in place.

**Variant:** slow/fast.

#### Go

```go
package main

import "fmt"

func moveZeros(nums []int) {
    slow := 0
    for fast := 0; fast < len(nums); fast++ {
        if nums[fast] != 0 {
            nums[slow], nums[fast] = nums[fast], nums[slow]
            slow++
        }
    }
}

func main() {
    a := []int{0, 1, 0, 3, 12}
    moveZeros(a)
    fmt.Println(a) // [1 3 12 0 0]
}
```

#### Java

```java
public class Task3 {
    public static void moveZeros(int[] nums) {
        int slow = 0;
        for (int fast = 0; fast < nums.length; fast++) {
            if (nums[fast] != 0) {
                int t = nums[slow]; nums[slow] = nums[fast]; nums[fast] = t;
                slow++;
            }
        }
    }

    public static void main(String[] args) {
        int[] a = {0, 1, 0, 3, 12};
        moveZeros(a);
        System.out.println(java.util.Arrays.toString(a)); // [1, 3, 12, 0, 0]
    }
}
```

#### Python

```python
def move_zeros(nums: list[int]) -> None:
    slow = 0
    for fast in range(len(nums)):
        if nums[fast] != 0:
            nums[slow], nums[fast] = nums[fast], nums[slow]
            slow += 1


if __name__ == "__main__":
    a = [0, 1, 0, 3, 12]
    move_zeros(a)
    print(a)  # [1, 3, 12, 0, 0]
```

---

### Task 4 — Valid Palindrome (Alphanumeric Only)

Return `true` if `s` reads the same forward and backward, ignoring non-alphanumeric characters and case.

**Variant:** converging with skip loops.

#### Go

```go
package main

import (
    "fmt"
    "unicode"
)

func isAlnum(b byte) bool {
    return unicode.IsLetter(rune(b)) || unicode.IsDigit(rune(b))
}

func toLower(b byte) byte {
    if b >= 'A' && b <= 'Z' {
        return b + 32
    }
    return b
}

func isValidPalindrome(s string) bool {
    l, r := 0, len(s)-1
    for l < r {
        for l < r && !isAlnum(s[l]) {
            l++
        }
        for l < r && !isAlnum(s[r]) {
            r--
        }
        if toLower(s[l]) != toLower(s[r]) {
            return false
        }
        l++
        r--
    }
    return true
}

func main() {
    fmt.Println(isValidPalindrome("A man, a plan, a canal: Panama")) // true
    fmt.Println(isValidPalindrome("race a car"))                     // false
}
```

#### Java

```java
public class Task4 {
    public static boolean isValidPalindrome(String s) {
        int l = 0, r = s.length() - 1;
        while (l < r) {
            while (l < r && !Character.isLetterOrDigit(s.charAt(l))) l++;
            while (l < r && !Character.isLetterOrDigit(s.charAt(r))) r--;
            if (Character.toLowerCase(s.charAt(l)) != Character.toLowerCase(s.charAt(r))) {
                return false;
            }
            l++; r--;
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isValidPalindrome("A man, a plan, a canal: Panama")); // true
        System.out.println(isValidPalindrome("race a car"));                     // false
    }
}
```

#### Python

```python
def is_valid_palindrome(s: str) -> bool:
    l, r = 0, len(s) - 1
    while l < r:
        while l < r and not s[l].isalnum():
            l += 1
        while l < r and not s[r].isalnum():
            r -= 1
        if s[l].lower() != s[r].lower():
            return False
        l += 1
        r -= 1
    return True


if __name__ == "__main__":
    print(is_valid_palindrome("A man, a plan, a canal: Panama"))  # True
    print(is_valid_palindrome("race a car"))                      # False
```

---

### Task 5 — Merge Two Sorted Arrays

Merge two sorted arrays `a` and `b` into a new sorted array.

**Variant:** merge-style.

#### Go

```go
package main

import "fmt"

func merge(a, b []int) []int {
    out := make([]int, 0, len(a)+len(b))
    i, j := 0, 0
    for i < len(a) && j < len(b) {
        if a[i] <= b[j] {
            out = append(out, a[i])
            i++
        } else {
            out = append(out, b[j])
            j++
        }
    }
    out = append(out, a[i:]...)
    out = append(out, b[j:]...)
    return out
}

func main() {
    fmt.Println(merge([]int{1, 4, 7}, []int{2, 3, 5, 8})) // [1 2 3 4 5 7 8]
}
```

#### Java

```java
public class Task5 {
    public static int[] merge(int[] a, int[] b) {
        int[] out = new int[a.length + b.length];
        int i = 0, j = 0, k = 0;
        while (i < a.length && j < b.length) {
            if (a[i] <= b[j]) out[k++] = a[i++];
            else              out[k++] = b[j++];
        }
        while (i < a.length) out[k++] = a[i++];
        while (j < b.length) out[k++] = b[j++];
        return out;
    }

    public static void main(String[] args) {
        System.out.println(java.util.Arrays.toString(
            merge(new int[]{1, 4, 7}, new int[]{2, 3, 5, 8}))); // [1, 2, 3, 4, 5, 7, 8]
    }
}
```

#### Python

```python
def merge(a: list[int], b: list[int]) -> list[int]:
    out: list[int] = []
    i = j = 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:
            out.append(a[i]); i += 1
        else:
            out.append(b[j]); j += 1
    out.extend(a[i:])
    out.extend(b[j:])
    return out


if __name__ == "__main__":
    print(merge([1, 4, 7], [2, 3, 5, 8]))  # [1, 2, 3, 4, 5, 7, 8]
```

---

## Intermediate Tasks

### Task 6 — Intersection of Two Sorted Arrays (Set Semantics)

Return the sorted intersection of two sorted arrays, with each common element appearing **once**, regardless of how many times it appears in either input.

**Variant:** merge-style. **Twist:** skip duplicates after each emit.

#### Go

```go
package main

import "fmt"

func intersect(a, b []int) []int {
    var out []int
    i, j := 0, 0
    for i < len(a) && j < len(b) {
        switch {
        case a[i] < b[j]:
            i++
        case a[i] > b[j]:
            j++
        default:
            if len(out) == 0 || out[len(out)-1] != a[i] {
                out = append(out, a[i])
            }
            i++
            j++
        }
    }
    return out
}

func main() {
    fmt.Println(intersect([]int{1, 2, 2, 3, 5}, []int{2, 2, 3, 4})) // [2 3]
}
```

#### Java

```java
import java.util.*;

public class Task6 {
    public static int[] intersect(int[] a, int[] b) {
        List<Integer> out = new ArrayList<>();
        int i = 0, j = 0;
        while (i < a.length && j < b.length) {
            if (a[i] < b[j]) i++;
            else if (a[i] > b[j]) j++;
            else {
                if (out.isEmpty() || out.get(out.size() - 1) != a[i]) {
                    out.add(a[i]);
                }
                i++; j++;
            }
        }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(
            intersect(new int[]{1, 2, 2, 3, 5}, new int[]{2, 2, 3, 4}))); // [2, 3]
    }
}
```

#### Python

```python
def intersect(a: list[int], b: list[int]) -> list[int]:
    out: list[int] = []
    i = j = 0
    while i < len(a) and j < len(b):
        if a[i] < b[j]:
            i += 1
        elif a[i] > b[j]:
            j += 1
        else:
            if not out or out[-1] != a[i]:
                out.append(a[i])
            i += 1
            j += 1
    return out


if __name__ == "__main__":
    print(intersect([1, 2, 2, 3, 5], [2, 2, 3, 4]))  # [2, 3]
```

---

### Task 7 — Is Subsequence

Return `true` if `s` is a subsequence of `t` (every character of `s` appears in `t` in the same relative order).

**Variant:** merge-style (asymmetric: always advance `t`).

#### Go

```go
package main

import "fmt"

func isSubsequence(s, t string) bool {
    i := 0
    for j := 0; i < len(s) && j < len(t); j++ {
        if s[i] == t[j] {
            i++
        }
    }
    return i == len(s)
}

func main() {
    fmt.Println(isSubsequence("ace", "abcde")) // true
    fmt.Println(isSubsequence("aec", "abcde")) // false
}
```

#### Java

```java
public class Task7 {
    public static boolean isSubsequence(String s, String t) {
        int i = 0;
        for (int j = 0; i < s.length() && j < t.length(); j++) {
            if (s.charAt(i) == t.charAt(j)) i++;
        }
        return i == s.length();
    }

    public static void main(String[] args) {
        System.out.println(isSubsequence("ace", "abcde")); // true
        System.out.println(isSubsequence("aec", "abcde")); // false
    }
}
```

#### Python

```python
def is_subsequence(s: str, t: str) -> bool:
    i = 0
    j = 0
    while i < len(s) and j < len(t):
        if s[i] == t[j]:
            i += 1
        j += 1
    return i == len(s)


if __name__ == "__main__":
    print(is_subsequence("ace", "abcde"))  # True
    print(is_subsequence("aec", "abcde"))  # False
```

---

### Task 8 — Remove Duplicates Allowing Up to 2 Copies

Given a sorted array, modify in place so each value appears at most twice. Return the new length.

**Variant:** slow/fast. **Trick:** compare against `nums[slow-2]` instead of `nums[slow-1]`.

#### Go

```go
package main

import "fmt"

func removeDuplicates2(nums []int) int {
    if len(nums) <= 2 {
        return len(nums)
    }
    slow := 2
    for fast := 2; fast < len(nums); fast++ {
        if nums[fast] != nums[slow-2] {
            nums[slow] = nums[fast]
            slow++
        }
    }
    return slow
}

func main() {
    a := []int{1, 1, 1, 2, 2, 3}
    k := removeDuplicates2(a)
    fmt.Println(k, a[:k]) // 5 [1 1 2 2 3]
}
```

#### Java

```java
public class Task8 {
    public static int removeDuplicates2(int[] nums) {
        if (nums.length <= 2) return nums.length;
        int slow = 2;
        for (int fast = 2; fast < nums.length; fast++) {
            if (nums[fast] != nums[slow - 2]) {
                nums[slow++] = nums[fast];
            }
        }
        return slow;
    }

    public static void main(String[] args) {
        int[] a = {1, 1, 1, 2, 2, 3};
        int k = removeDuplicates2(a);
        System.out.println(k); // 5
    }
}
```

#### Python

```python
def remove_duplicates2(nums: list[int]) -> int:
    if len(nums) <= 2:
        return len(nums)
    slow = 2
    for fast in range(2, len(nums)):
        if nums[fast] != nums[slow - 2]:
            nums[slow] = nums[fast]
            slow += 1
    return slow


if __name__ == "__main__":
    a = [1, 1, 1, 2, 2, 3]
    k = remove_duplicates2(a)
    print(k, a[:k])  # 5 [1, 1, 2, 2, 3]
```

---

### Task 9 — Sort Colors (Dutch Flag)

Sort an array consisting only of `0`, `1`, `2` in one pass.

**Variant:** three pointers. **Invariant:** see middle.md worked example.

#### Go

```go
package main

import "fmt"

func sortColors(nums []int) {
    lo, mid, hi := 0, 0, len(nums)-1
    for mid <= hi {
        switch nums[mid] {
        case 0:
            nums[lo], nums[mid] = nums[mid], nums[lo]
            lo++
            mid++
        case 1:
            mid++
        case 2:
            nums[mid], nums[hi] = nums[hi], nums[mid]
            hi--
        }
    }
}

func main() {
    a := []int{2, 0, 2, 1, 1, 0}
    sortColors(a)
    fmt.Println(a) // [0 0 1 1 2 2]
}
```

#### Java

```java
public class Task9 {
    public static void sortColors(int[] nums) {
        int lo = 0, mid = 0, hi = nums.length - 1;
        while (mid <= hi) {
            if (nums[mid] == 0) {
                int t = nums[lo]; nums[lo] = nums[mid]; nums[mid] = t;
                lo++; mid++;
            } else if (nums[mid] == 1) {
                mid++;
            } else {
                int t = nums[mid]; nums[mid] = nums[hi]; nums[hi] = t;
                hi--;
            }
        }
    }

    public static void main(String[] args) {
        int[] a = {2, 0, 2, 1, 1, 0};
        sortColors(a);
        System.out.println(java.util.Arrays.toString(a)); // [0, 0, 1, 1, 2, 2]
    }
}
```

#### Python

```python
def sort_colors(nums: list[int]) -> None:
    lo, mid, hi = 0, 0, len(nums) - 1
    while mid <= hi:
        if nums[mid] == 0:
            nums[lo], nums[mid] = nums[mid], nums[lo]
            lo += 1; mid += 1
        elif nums[mid] == 1:
            mid += 1
        else:
            nums[mid], nums[hi] = nums[hi], nums[mid]
            hi -= 1


if __name__ == "__main__":
    a = [2, 0, 2, 1, 1, 0]
    sort_colors(a)
    print(a)  # [0, 0, 1, 1, 2, 2]
```

---

### Task 10 — 3-Sum Closest

Given `nums` and a target `t`, find three elements whose sum is closest to `t`. Return that sum.

**Variant:** fixed first index + converging two-pointer (same skeleton as 3-sum, tracking best instead of exact match).

#### Go

```go
package main

import (
    "fmt"
    "sort"
)

func absInt(x int) int { if x < 0 { return -x }; return x }

func threeSumClosest(nums []int, target int) int {
    sort.Ints(nums)
    n := len(nums)
    best := nums[0] + nums[1] + nums[2]
    for i := 0; i < n-2; i++ {
        l, r := i+1, n-1
        for l < r {
            s := nums[i] + nums[l] + nums[r]
            if absInt(s-target) < absInt(best-target) {
                best = s
            }
            if s == target {
                return s
            }
            if s < target {
                l++
            } else {
                r--
            }
        }
    }
    return best
}

func main() {
    fmt.Println(threeSumClosest([]int{-1, 2, 1, -4}, 1)) // 2
}
```

#### Java

```java
import java.util.Arrays;

public class Task10 {
    public static int threeSumClosest(int[] nums, int target) {
        Arrays.sort(nums);
        int n = nums.length;
        int best = nums[0] + nums[1] + nums[2];
        for (int i = 0; i < n - 2; i++) {
            int l = i + 1, r = n - 1;
            while (l < r) {
                int s = nums[i] + nums[l] + nums[r];
                if (Math.abs(s - target) < Math.abs(best - target)) best = s;
                if (s == target) return s;
                if (s < target) l++; else r--;
            }
        }
        return best;
    }

    public static void main(String[] args) {
        System.out.println(threeSumClosest(new int[]{-1, 2, 1, -4}, 1)); // 2
    }
}
```

#### Python

```python
def three_sum_closest(nums: list[int], target: int) -> int:
    nums.sort()
    n = len(nums)
    best = nums[0] + nums[1] + nums[2]
    for i in range(n - 2):
        l, r = i + 1, n - 1
        while l < r:
            s = nums[i] + nums[l] + nums[r]
            if abs(s - target) < abs(best - target):
                best = s
            if s == target:
                return s
            if s < target:
                l += 1
            else:
                r -= 1
    return best


if __name__ == "__main__":
    print(three_sum_closest([-1, 2, 1, -4], 1))  # 2
```

---

## Advanced Tasks

### Task 11 — Trapping Rain Water (Two-Pointer)

Given heights `h`, compute the total water trapped after raining.

**Variant:** converging with `left_max` / `right_max` accumulators. The side with the smaller max determines how much water can sit above the current cell.

#### Go

```go
package main

import "fmt"

func trap(h []int) int {
    l, r := 0, len(h)-1
    lmax, rmax := 0, 0
    total := 0
    for l < r {
        if h[l] < h[r] {
            if h[l] >= lmax {
                lmax = h[l]
            } else {
                total += lmax - h[l]
            }
            l++
        } else {
            if h[r] >= rmax {
                rmax = h[r]
            } else {
                total += rmax - h[r]
            }
            r--
        }
    }
    return total
}

func main() {
    fmt.Println(trap([]int{0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1})) // 6
}
```

#### Java

```java
public class Task11 {
    public static int trap(int[] h) {
        int l = 0, r = h.length - 1, lmax = 0, rmax = 0, total = 0;
        while (l < r) {
            if (h[l] < h[r]) {
                if (h[l] >= lmax) lmax = h[l];
                else total += lmax - h[l];
                l++;
            } else {
                if (h[r] >= rmax) rmax = h[r];
                else total += rmax - h[r];
                r--;
            }
        }
        return total;
    }

    public static void main(String[] args) {
        System.out.println(trap(new int[]{0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1})); // 6
    }
}
```

#### Python

```python
def trap(h: list[int]) -> int:
    l, r = 0, len(h) - 1
    lmax = rmax = total = 0
    while l < r:
        if h[l] < h[r]:
            if h[l] >= lmax:
                lmax = h[l]
            else:
                total += lmax - h[l]
            l += 1
        else:
            if h[r] >= rmax:
                rmax = h[r]
            else:
                total += rmax - h[r]
            r -= 1
    return total


if __name__ == "__main__":
    print(trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]))  # 6
```

---

### Task 12 — Floyd's Tortoise and Hare (Cycle Start)

Given a linked list, return the node where the cycle begins, or `None`/`nil`/`null` if no cycle exists.

**Variant:** slow/fast in a linked list. Two phases: (1) detect cycle, (2) find start using the distance argument.

#### Go

```go
package main

import "fmt"

type Node struct {
    Val  int
    Next *Node
}

func detectCycle(head *Node) *Node {
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            // Phase 2
            p := head
            for p != slow {
                p = p.Next
                slow = slow.Next
            }
            return p
        }
    }
    return nil
}

func main() {
    // Build 1 -> 2 -> 3 -> 4 -> back to 2
    n1 := &Node{Val: 1}
    n2 := &Node{Val: 2}
    n3 := &Node{Val: 3}
    n4 := &Node{Val: 4}
    n1.Next = n2; n2.Next = n3; n3.Next = n4; n4.Next = n2
    fmt.Println(detectCycle(n1).Val) // 2
}
```

#### Java

```java
public class Task12 {
    static class Node {
        int val;
        Node next;
        Node(int v) { val = v; }
    }

    public static Node detectCycle(Node head) {
        Node slow = head, fast = head;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) {
                Node p = head;
                while (p != slow) {
                    p = p.next; slow = slow.next;
                }
                return p;
            }
        }
        return null;
    }

    public static void main(String[] args) {
        Node n1 = new Node(1), n2 = new Node(2), n3 = new Node(3), n4 = new Node(4);
        n1.next = n2; n2.next = n3; n3.next = n4; n4.next = n2;
        System.out.println(detectCycle(n1).val); // 2
    }
}
```

#### Python

```python
class Node:
    def __init__(self, val, nxt=None):
        self.val = val
        self.next = nxt


def detect_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            p = head
            while p is not slow:
                p = p.next
                slow = slow.next
            return p
    return None


if __name__ == "__main__":
    n1, n2, n3, n4 = Node(1), Node(2), Node(3), Node(4)
    n1.next = n2; n2.next = n3; n3.next = n4; n4.next = n2
    print(detect_cycle(n1).val)  # 2
```

---

### Task 13 — 4-Sum

Given `nums` and target `t`, find all unique quadruples `(a, b, c, d)` with `a + b + c + d == t`.

**Variant:** two nested loops + converging two-pointer; full dedup on all four positions.

#### Go

```go
package main

import (
    "fmt"
    "sort"
)

func fourSum(nums []int, t int) [][]int {
    sort.Ints(nums)
    n := len(nums)
    var out [][]int
    for i := 0; i < n-3; i++ {
        if i > 0 && nums[i] == nums[i-1] {
            continue
        }
        for j := i + 1; j < n-2; j++ {
            if j > i+1 && nums[j] == nums[j-1] {
                continue
            }
            l, r := j+1, n-1
            need := t - nums[i] - nums[j]
            for l < r {
                s := nums[l] + nums[r]
                switch {
                case s == need:
                    out = append(out, []int{nums[i], nums[j], nums[l], nums[r]})
                    l++
                    r--
                    for l < r && nums[l] == nums[l-1] { l++ }
                    for l < r && nums[r] == nums[r+1] { r-- }
                case s < need:
                    l++
                default:
                    r--
                }
            }
        }
    }
    return out
}

func main() {
    fmt.Println(fourSum([]int{1, 0, -1, 0, -2, 2}, 0))
    // [[-2 -1 1 2] [-2 0 0 2] [-1 0 0 1]]
}
```

#### Java

```java
import java.util.*;

public class Task13 {
    public static List<List<Integer>> fourSum(int[] nums, int t) {
        Arrays.sort(nums);
        int n = nums.length;
        List<List<Integer>> out = new ArrayList<>();
        for (int i = 0; i < n - 3; i++) {
            if (i > 0 && nums[i] == nums[i - 1]) continue;
            for (int j = i + 1; j < n - 2; j++) {
                if (j > i + 1 && nums[j] == nums[j - 1]) continue;
                int l = j + 1, r = n - 1;
                long need = (long) t - nums[i] - nums[j];
                while (l < r) {
                    long s = (long) nums[l] + nums[r];
                    if (s == need) {
                        out.add(List.of(nums[i], nums[j], nums[l], nums[r]));
                        l++; r--;
                        while (l < r && nums[l] == nums[l - 1]) l++;
                        while (l < r && nums[r] == nums[r + 1]) r--;
                    } else if (s < need) l++;
                    else r--;
                }
            }
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(fourSum(new int[]{1, 0, -1, 0, -2, 2}, 0));
    }
}
```

#### Python

```python
def four_sum(nums: list[int], t: int) -> list[list[int]]:
    nums.sort()
    n = len(nums)
    out: list[list[int]] = []
    for i in range(n - 3):
        if i > 0 and nums[i] == nums[i - 1]:
            continue
        for j in range(i + 1, n - 2):
            if j > i + 1 and nums[j] == nums[j - 1]:
                continue
            l, r = j + 1, n - 1
            need = t - nums[i] - nums[j]
            while l < r:
                s = nums[l] + nums[r]
                if s == need:
                    out.append([nums[i], nums[j], nums[l], nums[r]])
                    l += 1; r -= 1
                    while l < r and nums[l] == nums[l - 1]: l += 1
                    while l < r and nums[r] == nums[r + 1]: r -= 1
                elif s < need:
                    l += 1
                else:
                    r -= 1
    return out


if __name__ == "__main__":
    print(four_sum([1, 0, -1, 0, -2, 2], 0))
```

---

### Task 14 — Smallest Pair Difference Across Two Sorted Arrays

Given two sorted arrays `a` and `b`, find the pair `(x, y)` with `x` in `a` and `y` in `b` minimizing `|x - y|`. Return the pair.

**Variant:** merge-style. **Key insight:** advance the side with the smaller current value to potentially shrink the difference.

#### Go

```go
package main

import "fmt"

func smallestDiffPair(a, b []int) (int, int) {
    i, j := 0, 0
    bestX, bestY := a[0], b[0]
    bestDiff := abs(a[0] - b[0])
    for i < len(a) && j < len(b) {
        d := abs(a[i] - b[j])
        if d < bestDiff {
            bestDiff = d
            bestX, bestY = a[i], b[j]
        }
        if a[i] < b[j] {
            i++
        } else {
            j++
        }
    }
    return bestX, bestY
}

func abs(x int) int { if x < 0 { return -x }; return x }

func main() {
    x, y := smallestDiffPair([]int{1, 3, 15, 11, 2}, []int{23, 127, 235, 19, 8})
    // Note: arrays should be sorted for this to work; sort first if needed.
    fmt.Println(x, y)
}
```

#### Java

```java
public class Task14 {
    public static int[] smallestDiffPair(int[] a, int[] b) {
        int i = 0, j = 0;
        int bestX = a[0], bestY = b[0], bestDiff = Math.abs(a[0] - b[0]);
        while (i < a.length && j < b.length) {
            int d = Math.abs(a[i] - b[j]);
            if (d < bestDiff) {
                bestDiff = d; bestX = a[i]; bestY = b[j];
            }
            if (a[i] < b[j]) i++; else j++;
        }
        return new int[]{bestX, bestY};
    }

    public static void main(String[] args) {
        int[] a = {1, 2, 3, 11, 15};
        int[] b = {8, 19, 23, 127, 235};
        int[] p = smallestDiffPair(a, b);
        System.out.println(p[0] + " " + p[1]); // 11 8 (diff 3)
    }
}
```

#### Python

```python
def smallest_diff_pair(a: list[int], b: list[int]) -> tuple[int, int]:
    i = j = 0
    best_x, best_y = a[0], b[0]
    best_diff = abs(a[0] - b[0])
    while i < len(a) and j < len(b):
        d = abs(a[i] - b[j])
        if d < best_diff:
            best_diff = d
            best_x, best_y = a[i], b[j]
        if a[i] < b[j]:
            i += 1
        else:
            j += 1
    return best_x, best_y


if __name__ == "__main__":
    a = sorted([1, 3, 15, 11, 2])
    b = sorted([23, 127, 235, 19, 8])
    print(smallest_diff_pair(a, b))  # (11, 8)  diff = 3
```

---

### Task 15 — Boats To Save People

Each person has a weight `people[i]`. Each boat carries at most 2 people and a maximum weight `limit`. Return the minimum number of boats.

**Variant:** converging on sorted weights. Pair lightest with heaviest if they fit; otherwise the heaviest goes alone.

#### Go

```go
package main

import (
    "fmt"
    "sort"
)

func numRescueBoats(people []int, limit int) int {
    sort.Ints(people)
    l, r := 0, len(people)-1
    boats := 0
    for l <= r {
        if people[l]+people[r] <= limit {
            l++
        }
        r--
        boats++
    }
    return boats
}

func main() {
    fmt.Println(numRescueBoats([]int{3, 5, 3, 4}, 5)) // 4
    fmt.Println(numRescueBoats([]int{1, 2}, 3))       // 1
}
```

#### Java

```java
import java.util.Arrays;

public class Task15 {
    public static int numRescueBoats(int[] people, int limit) {
        Arrays.sort(people);
        int l = 0, r = people.length - 1, boats = 0;
        while (l <= r) {
            if (people[l] + people[r] <= limit) l++;
            r--;
            boats++;
        }
        return boats;
    }

    public static void main(String[] args) {
        System.out.println(numRescueBoats(new int[]{3, 5, 3, 4}, 5)); // 4
        System.out.println(numRescueBoats(new int[]{1, 2}, 3));        // 1
    }
}
```

#### Python

```python
def num_rescue_boats(people: list[int], limit: int) -> int:
    people.sort()
    l, r = 0, len(people) - 1
    boats = 0
    while l <= r:
        if people[l] + people[r] <= limit:
            l += 1
        r -= 1
        boats += 1
    return boats


if __name__ == "__main__":
    print(num_rescue_boats([3, 5, 3, 4], 5))  # 4
    print(num_rescue_boats([1, 2], 3))         # 1
```

---

## Self-Check

For every task above, confirm you can answer:

1. Which variant did I use?
2. What invariant did the loop maintain?
3. Why was advancing the chosen pointer safe?
4. What is the time and space complexity?
5. What edge case would break a naive solution?

If any of these is unclear, re-read the relevant section of `junior.md` or `middle.md` and rewrite the task without looking at the reference solution.
