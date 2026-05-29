# Monotonic Stack -- Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Each solution must run in O(n) time using a monotonic stack.

---

## Beginner Tasks

### Task 1 -- Next Greater Element

Given an array `nums`, return an array where each entry is the next strictly greater value to the right, or `-1` if none exists.

**Example:** `[2, 1, 2, 4, 3]` -> `[4, 2, 4, -1, -1]`

#### Go

```go
package main

import "fmt"

func NextGreater(nums []int) []int {
    n := len(nums)
    res := make([]int, n)
    for i := range res {
        res[i] = -1
    }
    stack := make([]int, 0, n)
    for i, v := range nums {
        for len(stack) > 0 && nums[stack[len(stack)-1]] < v {
            top := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            res[top] = v
        }
        stack = append(stack, i)
    }
    return res
}

func main() { fmt.Println(NextGreater([]int{2, 1, 2, 4, 3})) }
```

#### Java

```java
import java.util.*;

public class Task1 {
    public static int[] nextGreater(int[] nums) {
        int n = nums.length;
        int[] res = new int[n];
        Arrays.fill(res, -1);
        Deque<Integer> stack = new ArrayDeque<>();
        for (int i = 0; i < n; i++) {
            while (!stack.isEmpty() && nums[stack.peek()] < nums[i]) {
                res[stack.pop()] = nums[i];
            }
            stack.push(i);
        }
        return res;
    }
    public static void main(String[] args) {
        System.out.println(Arrays.toString(nextGreater(new int[]{2,1,2,4,3})));
    }
}
```

#### Python

```python
def next_greater(nums):
    n = len(nums)
    res = [-1] * n
    stack = []
    for i, v in enumerate(nums):
        while stack and nums[stack[-1]] < v:
            res[stack.pop()] = v
        stack.append(i)
    return res

if __name__ == "__main__":
    print(next_greater([2, 1, 2, 4, 3]))
```

---

### Task 2 -- Previous Smaller Element

Return for each index the value of the previous strictly smaller element (or `-1` if none).

**Example:** `[3, 1, 4, 1, 5, 9, 2, 6]` -> `[-1, -1, 1, -1, 1, 5, 1, 2]`

#### Go

```go
func PrevSmaller(a []int) []int {
    n := len(a)
    res := make([]int, n)
    for i := range res { res[i] = -1 }
    stack := []int{}
    for i, v := range a {
        for len(stack) > 0 && a[stack[len(stack)-1]] >= v {
            stack = stack[:len(stack)-1]
        }
        if len(stack) > 0 { res[i] = a[stack[len(stack)-1]] }
        stack = append(stack, i)
    }
    return res
}
```

#### Java

```java
public static int[] prevSmaller(int[] a) {
    int n = a.length;
    int[] res = new int[n];
    java.util.Arrays.fill(res, -1);
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        while (!st.isEmpty() && a[st.peek()] >= a[i]) st.pop();
        if (!st.isEmpty()) res[i] = a[st.peek()];
        st.push(i);
    }
    return res;
}
```

#### Python

```python
def prev_smaller(a):
    n = len(a)
    res = [-1] * n
    stack = []
    for i, v in enumerate(a):
        while stack and a[stack[-1]] >= v:
            stack.pop()
        if stack:
            res[i] = a[stack[-1]]
        stack.append(i)
    return res
```

---

### Task 3 -- Daily Temperatures

For each day, output the number of days until a strictly warmer one. Output `0` for days with no warmer day after.

**Example:** `[73, 74, 75, 71, 69, 72, 76, 73]` -> `[1, 1, 4, 2, 1, 1, 0, 0]`

#### Go

```go
func DailyTemperatures(t []int) []int {
    n := len(t)
    ans := make([]int, n)
    stack := []int{}
    for i := 0; i < n; i++ {
        for len(stack) > 0 && t[stack[len(stack)-1]] < t[i] {
            j := stack[len(stack)-1]; stack = stack[:len(stack)-1]
            ans[j] = i - j
        }
        stack = append(stack, i)
    }
    return ans
}
```

#### Java

```java
public static int[] dailyTemperatures(int[] t) {
    int n = t.length;
    int[] ans = new int[n];
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        while (!st.isEmpty() && t[st.peek()] < t[i]) {
            int j = st.pop();
            ans[j] = i - j;
        }
        st.push(i);
    }
    return ans;
}
```

#### Python

```python
def daily_temperatures(t):
    n = len(t)
    ans = [0] * n
    stack = []
    for i, v in enumerate(t):
        while stack and t[stack[-1]] < v:
            j = stack.pop()
            ans[j] = i - j
        stack.append(i)
    return ans
```

---

### Task 4 -- Stock Span

For each day, count the number of consecutive prior days (including today) where the price was less than or equal to today's.

**Example:** `[100, 80, 60, 70, 60, 75, 85]` -> `[1, 1, 1, 2, 1, 4, 6]`

#### Go

```go
func StockSpan(p []int) []int {
    n := len(p)
    span := make([]int, n)
    stack := []int{} // indices, prices strictly decreasing
    for i, v := range p {
        for len(stack) > 0 && p[stack[len(stack)-1]] <= v {
            stack = stack[:len(stack)-1]
        }
        if len(stack) == 0 { span[i] = i + 1 } else { span[i] = i - stack[len(stack)-1] }
        stack = append(stack, i)
    }
    return span
}
```

#### Java

```java
public static int[] stockSpan(int[] p) {
    int n = p.length;
    int[] span = new int[n];
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        while (!st.isEmpty() && p[st.peek()] <= p[i]) st.pop();
        span[i] = st.isEmpty() ? i + 1 : i - st.peek();
        st.push(i);
    }
    return span;
}
```

#### Python

```python
def stock_span(p):
    n = len(p)
    span = [0] * n
    stack = []
    for i, v in enumerate(p):
        while stack and p[stack[-1]] <= v:
            stack.pop()
        span[i] = i + 1 if not stack else i - stack[-1]
        stack.append(i)
    return span
```

---

### Task 5 -- Validate a Monotonic Stack State

Given a stack snapshot (as a list of integers, bottom to top), return whether it satisfies the strictly-increasing or strictly-decreasing monotonic invariant.

#### Go

```go
func IsMono(s []int) bool {
    if len(s) < 2 { return true }
    inc, dec := true, true
    for i := 1; i < len(s); i++ {
        if s[i] <= s[i-1] { inc = false }
        if s[i] >= s[i-1] { dec = false }
    }
    return inc || dec
}
```

#### Java

```java
public static boolean isMono(int[] s) {
    if (s.length < 2) return true;
    boolean inc = true, dec = true;
    for (int i = 1; i < s.length; i++) {
        if (s[i] <= s[i-1]) inc = false;
        if (s[i] >= s[i-1]) dec = false;
    }
    return inc || dec;
}
```

#### Python

```python
def is_mono(s):
    if len(s) < 2: return True
    inc = all(s[i] > s[i-1] for i in range(1, len(s)))
    dec = all(s[i] < s[i-1] for i in range(1, len(s)))
    return inc or dec
```

---

## Intermediate Tasks

### Task 6 -- Largest Rectangle in Histogram

Return the area of the largest axis-aligned rectangle in a histogram of bar heights.

**Example:** `[2, 1, 5, 6, 2, 3]` -> `10`

#### Go

```go
func LargestRectangle(h []int) int {
    n := len(h); stack := []int{}; best := 0
    for i := 0; i <= n; i++ {
        cur := 0; if i < n { cur = h[i] }
        for len(stack) > 0 && h[stack[len(stack)-1]] > cur {
            top := stack[len(stack)-1]; stack = stack[:len(stack)-1]
            w := i; if len(stack) > 0 { w = i - stack[len(stack)-1] - 1 }
            if a := h[top]*w; a > best { best = a }
        }
        stack = append(stack, i)
    }
    return best
}
```

#### Java

```java
public static int largestRectangle(int[] h) {
    int n = h.length, best = 0;
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i <= n; i++) {
        int cur = (i == n) ? 0 : h[i];
        while (!st.isEmpty() && h[st.peek()] > cur) {
            int top = st.pop();
            int w = st.isEmpty() ? i : i - st.peek() - 1;
            best = Math.max(best, h[top] * w);
        }
        st.push(i);
    }
    return best;
}
```

#### Python

```python
def largest_rectangle(h):
    n = len(h); stack = []; best = 0
    for i in range(n + 1):
        cur = 0 if i == n else h[i]
        while stack and h[stack[-1]] > cur:
            top = stack.pop()
            w = i if not stack else i - stack[-1] - 1
            best = max(best, h[top] * w)
        stack.append(i)
    return best
```

---

### Task 7 -- Trapping Rain Water (Monotonic Stack version)

Compute total water trapped above an elevation map.

**Example:** `[0,1,0,2,1,0,1,3,2,1,2,1]` -> `6`

#### Go

```go
func Trap(h []int) int {
    n := len(h); water := 0; stack := []int{}
    for i := 0; i < n; i++ {
        for len(stack) > 0 && h[stack[len(stack)-1]] < h[i] {
            mid := stack[len(stack)-1]; stack = stack[:len(stack)-1]
            if len(stack) == 0 { break }
            left := stack[len(stack)-1]
            water += (min(h[left], h[i]) - h[mid]) * (i - left - 1)
        }
        stack = append(stack, i)
    }
    return water
}
func min(a, b int) int { if a < b { return a }; return b }
```

#### Java

```java
public static int trap(int[] h) {
    int water = 0;
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < h.length; i++) {
        while (!st.isEmpty() && h[st.peek()] < h[i]) {
            int mid = st.pop();
            if (st.isEmpty()) break;
            int left = st.peek();
            water += (Math.min(h[left], h[i]) - h[mid]) * (i - left - 1);
        }
        st.push(i);
    }
    return water;
}
```

#### Python

```python
def trap(h):
    water = 0
    stack = []
    for i, v in enumerate(h):
        while stack and h[stack[-1]] < v:
            mid = stack.pop()
            if not stack:
                break
            left = stack[-1]
            water += (min(h[left], v) - h[mid]) * (i - left - 1)
        stack.append(i)
    return water
```

---

### Task 8 -- Next Greater Element II (Circular)

Same as next greater, but the array is circular -- the search wraps around.

**Example:** `[1, 2, 1]` -> `[2, -1, 2]`

#### Go

```go
func NextGreaterCircular(a []int) []int {
    n := len(a); res := make([]int, n)
    for i := range res { res[i] = -1 }
    stack := []int{}
    for i := 0; i < 2*n; i++ {
        idx := i % n
        for len(stack) > 0 && a[stack[len(stack)-1]] < a[idx] {
            res[stack[len(stack)-1]] = a[idx]
            stack = stack[:len(stack)-1]
        }
        if i < n { stack = append(stack, idx) }
    }
    return res
}
```

#### Java

```java
public static int[] nextGreaterCircular(int[] a) {
    int n = a.length;
    int[] res = new int[n];
    java.util.Arrays.fill(res, -1);
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < 2 * n; i++) {
        int idx = i % n;
        while (!st.isEmpty() && a[st.peek()] < a[idx]) {
            res[st.pop()] = a[idx];
        }
        if (i < n) st.push(idx);
    }
    return res;
}
```

#### Python

```python
def next_greater_circular(a):
    n = len(a)
    res = [-1] * n
    stack = []
    for i in range(2 * n):
        idx = i % n
        while stack and a[stack[-1]] < a[idx]:
            res[stack.pop()] = a[idx]
        if i < n:
            stack.append(idx)
    return res
```

---

### Task 9 -- Remove K Digits

Given a non-negative integer as a string and an integer `k`, remove `k` digits to get the smallest possible result.

**Example:** `"1432219", k=3` -> `"1219"`

#### Go

```go
func RemoveKdigits(s string, k int) string {
    stack := []byte{}
    for i := 0; i < len(s); i++ {
        for len(stack) > 0 && k > 0 && stack[len(stack)-1] > s[i] {
            stack = stack[:len(stack)-1]; k--
        }
        stack = append(stack, s[i])
    }
    stack = stack[:len(stack)-k]
    i := 0
    for i < len(stack) && stack[i] == '0' { i++ }
    if i == len(stack) { return "0" }
    return string(stack[i:])
}
```

#### Java

```java
public static String removeKdigits(String s, int k) {
    StringBuilder st = new StringBuilder();
    for (char c : s.toCharArray()) {
        while (st.length() > 0 && k > 0 && st.charAt(st.length() - 1) > c) {
            st.deleteCharAt(st.length() - 1); k--;
        }
        st.append(c);
    }
    st.setLength(st.length() - k);
    int i = 0;
    while (i < st.length() && st.charAt(i) == '0') i++;
    String result = st.substring(i);
    return result.isEmpty() ? "0" : result;
}
```

#### Python

```python
def remove_k_digits(s, k):
    stack = []
    for c in s:
        while stack and k > 0 and stack[-1] > c:
            stack.pop(); k -= 1
        stack.append(c)
    if k > 0:
        stack = stack[:-k]
    return ''.join(stack).lstrip('0') or '0'
```

---

### Task 10 -- Sum of Subarray Minimums (mod 1e9+7)

For all contiguous subarrays, sum the minimum of each. Return result mod 10^9 + 7.

**Example:** `[3, 1, 2, 4]` -> `17`

#### Go

```go
const MOD = 1_000_000_007
func SumSubarrayMins(a []int) int {
    n := len(a); prev, next := make([]int, n), make([]int, n)
    for i := range prev { prev[i] = -1; next[i] = n }
    stack := []int{}
    for i, v := range a {
        for len(stack) > 0 && a[stack[len(stack)-1]] > v {
            next[stack[len(stack)-1]] = i
            stack = stack[:len(stack)-1]
        }
        if len(stack) > 0 { prev[i] = stack[len(stack)-1] }
        stack = append(stack, i)
    }
    total := 0
    for i, v := range a {
        total = (total + v*(i-prev[i])*(next[i]-i)) % MOD
    }
    return total
}
```

#### Java

```java
public static int sumSubarrayMins(int[] a) {
    int MOD = 1_000_000_007, n = a.length;
    int[] prev = new int[n], next = new int[n];
    java.util.Arrays.fill(prev, -1);
    java.util.Arrays.fill(next, n);
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        while (!st.isEmpty() && a[st.peek()] > a[i]) next[st.pop()] = i;
        if (!st.isEmpty()) prev[i] = st.peek();
        st.push(i);
    }
    long total = 0;
    for (int i = 0; i < n; i++) {
        total = (total + (long) a[i] * (i - prev[i]) % MOD * (next[i] - i)) % MOD;
    }
    return (int) total;
}
```

#### Python

```python
def sum_subarray_mins(a):
    MOD = 10**9 + 7
    n = len(a); prev = [-1]*n; nxt = [n]*n
    stack = []
    for i, v in enumerate(a):
        while stack and a[stack[-1]] > v:
            nxt[stack.pop()] = i
        if stack:
            prev[i] = stack[-1]
        stack.append(i)
    return sum(a[i] * (i - prev[i]) * (nxt[i] - i) for i in range(n)) % MOD
```

---

## Advanced Tasks

### Task 11 -- Maximal Rectangle in a Binary Matrix

Given a 2D binary matrix, return the area of the largest rectangle of 1s.

**Example:** `[["1","0","1","0","0"],["1","0","1","1","1"],["1","1","1","1","1"],["1","0","0","1","0"]]` -> `6`

#### Go

```go
func MaximalRectangle(m [][]byte) int {
    if len(m) == 0 { return 0 }
    cols := len(m[0])
    h := make([]int, cols)
    best := 0
    for _, row := range m {
        for j, c := range row {
            if c == '1' { h[j]++ } else { h[j] = 0 }
        }
        if a := LargestRectangle(h); a > best { best = a }
    }
    return best
}
```

#### Java

```java
public static int maximalRectangle(char[][] m) {
    if (m.length == 0) return 0;
    int cols = m[0].length, best = 0;
    int[] h = new int[cols];
    for (char[] row : m) {
        for (int j = 0; j < cols; j++) {
            h[j] = (row[j] == '1') ? h[j] + 1 : 0;
        }
        best = Math.max(best, largestRectangle(h));
    }
    return best;
}
```

#### Python

```python
def maximal_rectangle(matrix):
    if not matrix: return 0
    cols = len(matrix[0])
    h = [0] * cols
    best = 0
    for row in matrix:
        for j, c in enumerate(row):
            h[j] = h[j] + 1 if c == '1' else 0
        best = max(best, largest_rectangle(h))
    return best
```

---

### Task 12 -- Remove Duplicate Letters

Given a string, remove duplicate letters so every letter appears once and the result is lexicographically smallest.

**Example:** `"cbacdcbc"` -> `"acdb"`

#### Go

```go
func RemoveDuplicateLetters(s string) string {
    last := [26]int{}
    for i := range s { last[s[i]-'a'] = i }
    inStack := [26]bool{}
    stack := []byte{}
    for i := 0; i < len(s); i++ {
        c := s[i]
        if inStack[c-'a'] { continue }
        for len(stack) > 0 && stack[len(stack)-1] > c && last[stack[len(stack)-1]-'a'] > i {
            inStack[stack[len(stack)-1]-'a'] = false
            stack = stack[:len(stack)-1]
        }
        stack = append(stack, c); inStack[c-'a'] = true
    }
    return string(stack)
}
```

#### Java

```java
public static String removeDuplicateLetters(String s) {
    int[] last = new int[26];
    for (int i = 0; i < s.length(); i++) last[s.charAt(i) - 'a'] = i;
    boolean[] inStack = new boolean[26];
    StringBuilder st = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        if (inStack[c - 'a']) continue;
        while (st.length() > 0 && st.charAt(st.length()-1) > c
               && last[st.charAt(st.length()-1) - 'a'] > i) {
            inStack[st.charAt(st.length()-1) - 'a'] = false;
            st.deleteCharAt(st.length() - 1);
        }
        st.append(c); inStack[c - 'a'] = true;
    }
    return st.toString();
}
```

#### Python

```python
def remove_duplicate_letters(s):
    last = {c: i for i, c in enumerate(s)}
    in_stack = set()
    stack = []
    for i, c in enumerate(s):
        if c in in_stack: continue
        while stack and stack[-1] > c and last[stack[-1]] > i:
            in_stack.discard(stack.pop())
        stack.append(c); in_stack.add(c)
    return ''.join(stack)
```

---

### Task 13 -- Build Cartesian Tree

Given an array, build the (min-heap) Cartesian tree and return its root's index. Use a monotonic stack in O(n).

#### Go

```go
type Node struct{ Val int; Left, Right *Node }

func BuildCartesian(a []int) *Node {
    stack := []*Node{}
    for _, v := range a {
        node := &Node{Val: v}
        var last *Node
        for len(stack) > 0 && stack[len(stack)-1].Val > v {
            last = stack[len(stack)-1]
            stack = stack[:len(stack)-1]
        }
        node.Left = last
        if len(stack) > 0 { stack[len(stack)-1].Right = node }
        stack = append(stack, node)
    }
    if len(stack) == 0 { return nil }
    return stack[0]
}
```

#### Java

```java
static class Node { int val; Node left, right; Node(int v){val=v;} }

public static Node buildCartesian(int[] a) {
    java.util.Deque<Node> st = new java.util.ArrayDeque<>();
    for (int v : a) {
        Node node = new Node(v);
        Node last = null;
        while (!st.isEmpty() && st.peek().val > v) last = st.pop();
        node.left = last;
        if (!st.isEmpty()) st.peek().right = node;
        st.push(node);
    }
    Node root = null;
    while (!st.isEmpty()) root = st.pop();
    return root;
}
```

#### Python

```python
class Node:
    __slots__ = ('val', 'left', 'right')
    def __init__(self, v): self.val = v; self.left = None; self.right = None

def build_cartesian(a):
    stack = []
    for v in a:
        node = Node(v); last = None
        while stack and stack[-1].val > v:
            last = stack.pop()
        node.left = last
        if stack: stack[-1].right = node
        stack.append(node)
    return stack[0] if stack else None
```

---

### Task 14 -- Sum of Subarray Ranges

For each subarray, compute (max - min) of that subarray. Sum across all subarrays.

**Example:** `[1, 2, 3]` -> `4`

#### Go

```go
func SubArrayRanges(a []int) int {
    contrib := func(cmp func(int, int) bool) int {
        n := len(a); stack := []int{}; total := 0
        prev := make([]int, n); next := make([]int, n)
        for i := range prev { prev[i] = -1; next[i] = n }
        for i, v := range a {
            for len(stack) > 0 && cmp(a[stack[len(stack)-1]], v) {
                next[stack[len(stack)-1]] = i
                stack = stack[:len(stack)-1]
            }
            if len(stack) > 0 { prev[i] = stack[len(stack)-1] }
            stack = append(stack, i)
            _ = v
        }
        for i, v := range a {
            total += v * (i - prev[i]) * (next[i] - i)
        }
        return total
    }
    maxC := contrib(func(x, y int) bool { return x < y })
    minC := contrib(func(x, y int) bool { return x > y })
    return maxC - minC
}
```

#### Java

```java
public static long subArrayRanges(int[] a) {
    return contrib(a, true) - contrib(a, false);
}
private static long contrib(int[] a, boolean isMax) {
    int n = a.length;
    int[] prev = new int[n], next = new int[n];
    java.util.Arrays.fill(prev, -1);
    java.util.Arrays.fill(next, n);
    java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        while (!st.isEmpty() && (isMax ? a[st.peek()] < a[i] : a[st.peek()] > a[i])) {
            next[st.pop()] = i;
        }
        if (!st.isEmpty()) prev[i] = st.peek();
        st.push(i);
    }
    long total = 0;
    for (int i = 0; i < n; i++) total += (long) a[i] * (i - prev[i]) * (next[i] - i);
    return total;
}
```

#### Python

```python
def sub_array_ranges(a):
    def contrib(is_max):
        n = len(a); prev = [-1]*n; nxt = [n]*n; stack = []
        for i, v in enumerate(a):
            while stack and (a[stack[-1]] < v if is_max else a[stack[-1]] > v):
                nxt[stack.pop()] = i
            if stack: prev[i] = stack[-1]
            stack.append(i)
        return sum(a[i] * (i - prev[i]) * (nxt[i] - i) for i in range(n))
    return contrib(True) - contrib(False)
```

---

### Task 15 -- Largest Rectangle Under Skyline

Given an array of (x, height) building events sorted by x, compute the largest rectangle that fits under the skyline. (Use the histogram analogue after building a step function.)

#### Go

```go
func LargestRectangleSkyline(events [][2]int) int {
    if len(events) == 0 { return 0 }
    heights := []int{}
    for _, e := range events { heights = append(heights, e[1]) }
    return LargestRectangle(heights)
}
```

#### Java

```java
public static int largestRectangleSkyline(int[][] events) {
    if (events.length == 0) return 0;
    int[] h = new int[events.length];
    for (int i = 0; i < events.length; i++) h[i] = events[i][1];
    return largestRectangle(h);
}
```

#### Python

```python
def largest_rectangle_skyline(events):
    if not events: return 0
    return largest_rectangle([h for _, h in events])
```

---

## Benchmark Task

Compare the largest-rectangle-in-histogram performance across the three languages.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func main() {
    sizes := []int{100, 1_000, 10_000, 100_000, 1_000_000}
    for _, n := range sizes {
        data := make([]int, n)
        for i := range data { data[i] = rand.Intn(10000) }
        start := time.Now()
        for i := 0; i < 50; i++ {
            tmp := make([]int, n); copy(tmp, data)
            LargestRectangle(tmp)
        }
        elapsed := time.Since(start)
        fmt.Printf("n=%7d: %.3f ms\n", n, float64(elapsed.Milliseconds())/50.0)
    }
}
```

#### Java

```java
import java.util.Random;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {100, 1_000, 10_000, 100_000, 1_000_000};
        Random rnd = new Random(0);
        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = rnd.nextInt(10_000);
            long start = System.nanoTime();
            for (int i = 0; i < 50; i++) largestRectangle(data.clone());
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%7d: %.3f ms%n", n, elapsed / 50.0 / 1_000_000);
        }
    }
}
```

#### Python

```python
import random
import timeit

random.seed(0)
sizes = [100, 1_000, 10_000, 100_000]
for n in sizes:
    data = [random.randint(0, 10_000) for _ in range(n)]
    t = timeit.timeit(lambda: largest_rectangle(list(data)), number=50)
    print(f"n={n:>7}: {t/50*1000:.3f} ms")
```

> Note: Python lists are slower than slice/array primitives in Go and Java. Expect a 5x-10x gap on `n=100_000`.
</content>
</invoke>