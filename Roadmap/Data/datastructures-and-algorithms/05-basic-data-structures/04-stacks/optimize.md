# Stack -- Optimization Exercises

Each exercise presents working but suboptimal code. Your task is to identify the performance bottleneck and provide an optimized solution.

---

## Exercise 1: O(n) getMin -- Reduce to O(1)

**Problem:** This MinStack scans the entire stack to find the minimum.

```go
type MinStack struct {
    data []int
}

func (s *MinStack) Push(val int) {
    s.data = append(s.data, val)
}

func (s *MinStack) Pop() int {
    val := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    return val
}

func (s *MinStack) GetMin() int {
    min := s.data[0]
    for _, v := range s.data {
        if v < min {
            min = v
        }
    }
    return min
}
```

**Current complexity:** GetMin is O(n).
**Target complexity:** GetMin in O(1).

<details>
<summary>Optimized Solution</summary>

Use an auxiliary stack that tracks the minimum at each level.

```go
type MinStack struct {
    data []int
    mins []int
}

func (s *MinStack) Push(val int) {
    s.data = append(s.data, val)
    if len(s.mins) == 0 || val <= s.mins[len(s.mins)-1] {
        s.mins = append(s.mins, val)
    } else {
        s.mins = append(s.mins, s.mins[len(s.mins)-1])
    }
}

func (s *MinStack) Pop() int {
    val := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    s.mins = s.mins[:len(s.mins)-1]
    return val
}

func (s *MinStack) GetMin() int {
    return s.mins[len(s.mins)-1]
}
```

**Improvement:** GetMin O(n) -> O(1). Space trade-off: O(n) additional space.
</details>

---

## Exercise 2: O(n) Search in Stack -- Use a Hash Set

**Problem:** Check if an element exists in the stack by scanning all elements.

```java
public class SearchableStack {
    private final Deque<Integer> stack = new ArrayDeque<>();

    public void push(int val) {
        stack.push(val);
    }

    public int pop() {
        return stack.pop();
    }

    public boolean contains(int val) {
        for (int item : stack) {
            if (item == val) return true;
        }
        return false;
    }
}
```

**Current complexity:** `contains` is O(n).
**Target complexity:** `contains` in O(1).

<details>
<summary>Optimized Solution</summary>

Maintain a HashMap (or HashMultiSet) alongside the stack to track element counts.

```java
public class SearchableStack {
    private final Deque<Integer> stack = new ArrayDeque<>();
    private final Map<Integer, Integer> counts = new HashMap<>();

    public void push(int val) {
        stack.push(val);
        counts.merge(val, 1, Integer::sum);
    }

    public int pop() {
        int val = stack.pop();
        int count = counts.get(val);
        if (count == 1) {
            counts.remove(val);
        } else {
            counts.put(val, count - 1);
        }
        return val;
    }

    public boolean contains(int val) {
        return counts.containsKey(val);
    }
}
```

**Improvement:** `contains` O(n) -> O(1). Extra O(n) space for the HashMap.
</details>

---

## Exercise 3: String Concatenation in Reverse (Python)

**Problem:** Reverse a string using a stack, but the string building is O(n^2) due to concatenation.

```python
def reverse_string_slow(s: str) -> str:
    stack = list(s)
    result = ""
    while stack:
        result = result + stack.pop()  # O(n) each time -- creates new string
    return result
```

**Current complexity:** O(n^2) due to string immutability.
**Target complexity:** O(n).

<details>
<summary>Optimized Solution</summary>

Use a list to collect characters, then join once at the end.

```python
def reverse_string_fast(s: str) -> str:
    stack = list(s)
    result = []
    while stack:
        result.append(stack.pop())
    return "".join(result)
```

Or even simpler -- just reverse the list:

```python
def reverse_string_fastest(s: str) -> str:
    return s[::-1]
```

**Improvement:** O(n^2) -> O(n). The `join` method allocates the final string in one pass.
</details>

---

## Exercise 4: Redundant Stack Operations in Parentheses Matching (Go)

**Problem:** This solution creates a new slice on every pop, causing unnecessary allocations.

```go
func isBalanced(s string) bool {
    stack := []byte{}
    for i := 0; i < len(s); i++ {
        ch := s[i]
        if ch == '(' || ch == '[' || ch == '{' {
            stack = append(stack, ch)
        } else if ch == ')' || ch == ']' || ch == '}' {
            if len(stack) == 0 {
                return false
            }
            top := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            // Verbose matching
            if (ch == ')' && top != '(') ||
                (ch == ']' && top != '[') ||
                (ch == '}' && top != '{') {
                return false
            }
        }
    }
    return len(stack) == 0
}
```

**Issue:** Not a complexity issue, but the matching logic is verbose and the function processes non-bracket characters needlessly.

<details>
<summary>Optimized Solution</summary>

Use a map for cleaner matching and pre-allocate the stack with expected capacity.

```go
func isBalanced(s string) bool {
    stack := make([]byte, 0, len(s)/2) // pre-allocate
    match := map[byte]byte{')': '(', ']': '[', '}': '{'}

    for i := 0; i < len(s); i++ {
        ch := s[i]
        switch ch {
        case '(', '[', '{':
            stack = append(stack, ch)
        case ')', ']', '}':
            if len(stack) == 0 || stack[len(stack)-1] != match[ch] {
                return false
            }
            stack = stack[:len(stack)-1]
        }
    }
    return len(stack) == 0
}
```

**Improvement:** Pre-allocation avoids repeated slice growth. Map-based matching is cleaner and extensible.
</details>

---

## Exercise 5: Naive Daily Temperatures O(n^2) (Java)

**Problem:** For each day, scan all future days to find the next warmer temperature.

```java
public int[] dailyTemperatures(int[] temps) {
    int n = temps.length;
    int[] result = new int[n];

    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (temps[j] > temps[i]) {
                result[i] = j - i;
                break;
            }
        }
    }
    return result;
}
```

**Current complexity:** O(n^2) worst case (descending temps).
**Target complexity:** O(n).

<details>
<summary>Optimized Solution</summary>

Use a monotonic decreasing stack of indices.

```java
public int[] dailyTemperatures(int[] temps) {
    int n = temps.length;
    int[] result = new int[n];
    Deque<Integer> stack = new ArrayDeque<>();

    for (int i = 0; i < n; i++) {
        while (!stack.isEmpty() && temps[i] > temps[stack.peek()]) {
            int j = stack.pop();
            result[j] = i - j;
        }
        stack.push(i);
    }
    return result;
}
```

**Improvement:** O(n^2) -> O(n). Each index is pushed and popped at most once.
</details>

---

## Exercise 6: Stack-Based DFS with Redundant Visited Checks (Python)

**Problem:** The DFS checks visited when popping but also adds duplicates to the stack.

```python
def dfs(graph, start):
    visited = set()
    stack = [start]
    order = []

    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        order.append(node)

        for neighbor in graph.get(node, []):
            stack.append(neighbor)  # may add duplicates
    return order
```

**Issue:** For dense graphs, the stack can grow to O(V^2) because unvisited neighbors are pushed every time, even if they are already on the stack.

<details>
<summary>Optimized Solution</summary>

Check visited before pushing to avoid redundant stack entries.

```python
def dfs_optimized(graph, start):
    visited = {start}
    stack = [start]
    order = []

    while stack:
        node = stack.pop()
        order.append(node)

        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                stack.append(neighbor)
    return order
```

**Improvement:** Stack size bounded by O(V) instead of O(V^2). Fewer set lookups.

**Note:** The traversal order may differ slightly because we mark visited on push rather than pop. Both are valid DFS orderings.
</details>

---

## Exercise 7: Largest Rectangle Using Sentinel vs Drain Loop (Go)

**Problem:** This solution requires a separate loop to drain remaining elements.

```go
func largestRectangle(heights []int) int {
    stack := []int{}
    maxArea := 0
    n := len(heights)

    for i := 0; i < n; i++ {
        for len(stack) > 0 && heights[stack[len(stack)-1]] > heights[i] {
            h := heights[stack[len(stack)-1]]
            stack = stack[:len(stack)-1]
            w := i
            if len(stack) > 0 {
                w = i - stack[len(stack)-1] - 1
            }
            if h*w > maxArea {
                maxArea = h * w
            }
        }
        stack = append(stack, i)
    }
    // Drain loop -- duplicates the inner logic
    for len(stack) > 0 {
        h := heights[stack[len(stack)-1]]
        stack = stack[:len(stack)-1]
        w := n
        if len(stack) > 0 {
            w = n - stack[len(stack)-1] - 1
        }
        if h*w > maxArea {
            maxArea = h * w
        }
    }
    return maxArea
}
```

**Issue:** Code duplication between the main loop and drain loop. Error-prone.

<details>
<summary>Optimized Solution</summary>

Append a sentinel value of 0 to force all elements to be processed in the main loop.

```go
func largestRectangle(heights []int) int {
    heights = append(heights, 0) // sentinel
    stack := []int{}
    maxArea := 0

    for i, h := range heights {
        for len(stack) > 0 && heights[stack[len(stack)-1]] > h {
            height := heights[stack[len(stack)-1]]
            stack = stack[:len(stack)-1]
            width := i
            if len(stack) > 0 {
                width = i - stack[len(stack)-1] - 1
            }
            if height*width > maxArea {
                maxArea = height * width
            }
        }
        stack = append(stack, i)
    }
    heights = heights[:len(heights)-1] // restore
    return maxArea
}
```

**Improvement:** Eliminates code duplication. Single clean loop.
</details>

---

## Exercise 8: Two Stacks Queue with Eager Transfer (Java)

**Problem:** Every dequeue transfers ALL elements even when unnecessary.

```java
public class EagerStackQueue {
    private Deque<Integer> in = new ArrayDeque<>();
    private Deque<Integer> out = new ArrayDeque<>();

    public void enqueue(int val) {
        in.push(val);
    }

    public int dequeue() {
        // Always transfers everything
        while (!in.isEmpty()) {
            out.push(in.pop());
        }
        int val = out.pop();
        // Transfer back
        while (!out.isEmpty()) {
            in.push(out.pop());
        }
        return val;
    }
}
```

**Current complexity:** O(n) per dequeue always.
**Target complexity:** O(1) amortized per dequeue.

<details>
<summary>Optimized Solution</summary>

Use lazy transfer: only move elements from `in` to `out` when `out` is empty.

```java
public class LazyStackQueue {
    private Deque<Integer> in = new ArrayDeque<>();
    private Deque<Integer> out = new ArrayDeque<>();

    public void enqueue(int val) {
        in.push(val);
    }

    public int dequeue() {
        if (out.isEmpty()) {
            while (!in.isEmpty()) {
                out.push(in.pop());
            }
        }
        return out.pop();
    }
}
```

**Improvement:** Each element is transferred at most once, giving O(1) amortized per operation. The eager version transfers O(n) on every single dequeue.
</details>

---

## Exercise 9: Recursive Tower of Hanoi -- Convert to Iterative (Python)

**Problem:** The recursive solution uses O(n) call stack space for n disks.

```python
def hanoi_recursive(n, source, target, auxiliary, moves):
    if n == 1:
        moves.append((source, target))
        return
    hanoi_recursive(n - 1, source, auxiliary, target, moves)
    moves.append((source, target))
    hanoi_recursive(n - 1, auxiliary, target, source, moves)
```

**Issue:** For large n (e.g., n=10000), this hits Python's recursion limit.

<details>
<summary>Optimized Solution</summary>

Use an explicit stack to simulate the recursion.

```python
def hanoi_iterative(n, source, target, auxiliary):
    moves = []
    # Stack stores (n, source, target, auxiliary, phase)
    stack = [(n, source, target, auxiliary, 0)]

    while stack:
        n, src, tgt, aux, phase = stack.pop()

        if n == 1:
            moves.append((src, tgt))
            continue

        if phase == 0:
            # We need to do three things in order:
            # 1. Move n-1 from src to aux
            # 2. Move 1 from src to tgt
            # 3. Move n-1 from aux to tgt
            # Push in reverse order (stack is LIFO)
            stack.append((n - 1, aux, tgt, src, 0))    # step 3
            stack.append((1, src, tgt, aux, 0))         # step 2
            stack.append((n - 1, src, aux, tgt, 0))     # step 1
    return moves
```

**Improvement:** No recursion limit. Stack lives on the heap. Works for any n.
</details>

---

## Exercise 10: Brute-Force Next Greater Element Circular (Python)

**Problem:** For a circular array, find the next greater element. Brute force uses O(n^2).

```python
def next_greater_circular_slow(nums):
    n = len(nums)
    result = [-1] * n
    for i in range(n):
        for j in range(1, n):
            idx = (i + j) % n
            if nums[idx] > nums[i]:
                result[i] = nums[idx]
                break
    return result
```

**Current complexity:** O(n^2).
**Target complexity:** O(n).

<details>
<summary>Optimized Solution</summary>

Traverse the array twice (simulating circularity) with a monotonic stack.

```python
def next_greater_circular(nums):
    n = len(nums)
    result = [-1] * n
    stack = []

    for i in range(2 * n - 1, -1, -1):
        idx = i % n
        while stack and stack[-1] <= nums[idx]:
            stack.pop()
        if stack and i < n:
            result[idx] = stack[-1]
        stack.append(nums[idx])
    return result
```

**Improvement:** O(n^2) -> O(n). The trick is iterating `2n` times from right to left and using modular indexing.
</details>

---

## Exercise 11: Naive Valid Parentheses with String Replace (Java)

**Problem:** Repeatedly scan and replace pairs of brackets.

```java
public boolean isValid(String s) {
    while (s.contains("()") || s.contains("[]") || s.contains("{}")) {
        s = s.replace("()", "");
        s = s.replace("[]", "");
        s = s.replace("{}", "");
    }
    return s.isEmpty();
}
```

**Current complexity:** O(n^2) -- each replace scans the string, and up to n/2 rounds.
**Target complexity:** O(n).

<details>
<summary>Optimized Solution</summary>

Use a stack -- single pass.

```java
public boolean isValid(String s) {
    Deque<Character> stack = new ArrayDeque<>();
    Map<Character, Character> map = Map.of(')', '(', ']', '[', '}', '{');

    for (char c : s.toCharArray()) {
        if (c == '(' || c == '[' || c == '{') {
            stack.push(c);
        } else if (stack.isEmpty() || stack.pop() != map.get(c)) {
            return false;
        }
    }
    return stack.isEmpty();
}
```

**Improvement:** O(n^2) -> O(n). Single pass, no string manipulation.
</details>
