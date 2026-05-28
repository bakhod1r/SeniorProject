# Stack -- Find the Bug Exercises

Each exercise contains code with one or more bugs. Your task is to identify the bug, explain why it causes incorrect behavior, and provide the fix.

---

## Exercise 1: Pop Returns Wrong Value (Go)

```go
func (s *ArrayStack) Pop() (int, error) {
    if s.IsEmpty() {
        return 0, errors.New("stack is empty")
    }
    s.data = s.data[:len(s.data)-1]
    return s.data[len(s.data)-1], nil
}
```

**Symptoms:** Pop sometimes returns the wrong value or panics with index out of range.

<details>
<summary>Hint</summary>
What happens to the last element after the slice is shortened?
</details>

<details>
<summary>Bug Explanation</summary>

The code shrinks the slice BEFORE reading the top value. After `s.data = s.data[:len(s.data)-1]`, the element at `len(s.data)-1` is now the SECOND-to-last element (or out of bounds if size was 1).

**Fix:** Read the value first, then shrink.

```go
func (s *ArrayStack) Pop() (int, error) {
    if s.IsEmpty() {
        return 0, errors.New("stack is empty")
    }
    top := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    return top, nil
}
```
</details>

---

## Exercise 2: IsEmpty Always Returns True (Java)

```java
public class LinkedStack {
    private Node top;
    private int size = 0;

    public void push(int val) {
        Node newNode = new Node(val, top);
        size++;
    }

    public boolean isEmpty() {
        return top == null;
    }
}
```

**Symptoms:** After pushing elements, `isEmpty()` still returns `true`.

<details>
<summary>Hint</summary>
Is the `top` pointer ever updated?
</details>

<details>
<summary>Bug Explanation</summary>

The `push` method creates a new node but never assigns it to `top`. The `top` field stays `null` forever.

**Fix:**

```java
public void push(int val) {
    top = new Node(val, top);
    size++;
}
```
</details>

---

## Exercise 3: Parentheses Checker Accepts Invalid Input (Python)

```python
def is_balanced(s: str) -> bool:
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}

    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif ch in pairs:
            if stack.pop() != pairs[ch]:
                return False
    return True
```

**Symptoms:**
- `is_balanced("(()")` returns `True` (should be `False`).
- `is_balanced(")")` crashes with `IndexError`.

<details>
<summary>Hint</summary>
Two bugs: one with empty stack, one at the end.
</details>

<details>
<summary>Bug Explanation</summary>

**Bug 1:** When a closing bracket is encountered and the stack is empty, `stack.pop()` raises an `IndexError`. Need to check `if not stack` first.

**Bug 2:** The function returns `True` at the end without checking if the stack is empty. Unmatched opening brackets are not detected.

**Fix:**

```python
def is_balanced(s: str) -> bool:
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}

    for ch in s:
        if ch in "([{":
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
    return len(stack) == 0
```
</details>

---

## Exercise 4: Min Stack Returns Stale Minimum (Go)

```go
type MinStack struct {
    data []int
    min  int
}

func (s *MinStack) Push(val int) {
    s.data = append(s.data, val)
    if val < s.min {
        s.min = val
    }
}

func (s *MinStack) Pop() int {
    val := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    return val
}

func (s *MinStack) GetMin() int {
    return s.min
}
```

**Symptoms:** After popping the minimum element, `GetMin()` still returns the old minimum.

<details>
<summary>Hint</summary>
There is no mechanism to restore the previous minimum after a pop.
</details>

<details>
<summary>Bug Explanation</summary>

The `min` field is a single value that is only updated downward. When the current minimum is popped, `min` is not updated to the next smallest value.

**Fix:** Use an auxiliary min-stack that tracks the minimum at each level.

```go
type MinStack struct {
    data    []int
    minData []int
}

func (s *MinStack) Push(val int) {
    s.data = append(s.data, val)
    if len(s.minData) == 0 || val <= s.minData[len(s.minData)-1] {
        s.minData = append(s.minData, val)
    } else {
        s.minData = append(s.minData, s.minData[len(s.minData)-1])
    }
}

func (s *MinStack) Pop() int {
    val := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    s.minData = s.minData[:len(s.minData)-1]
    return val
}

func (s *MinStack) GetMin() int {
    return s.minData[len(s.minData)-1]
}
```
</details>

---

## Exercise 5: Stack Queue Dequeue Returns Wrong Order (Java)

```java
public class StackQueue {
    private Deque<Integer> inStack = new ArrayDeque<>();
    private Deque<Integer> outStack = new ArrayDeque<>();

    public void enqueue(int val) {
        inStack.push(val);
    }

    public int dequeue() {
        while (!inStack.isEmpty()) {
            outStack.push(inStack.pop());
        }
        return outStack.pop();
    }
}
```

**Symptoms:** After multiple enqueue/dequeue sequences, elements come out in wrong order.

**Test case:**
```
enqueue(1), enqueue(2), dequeue() -> 1 (correct)
enqueue(3), dequeue() -> should be 2, but returns 3
```

<details>
<summary>Hint</summary>
The transfer happens every time, even when outStack already has elements.
</details>

<details>
<summary>Bug Explanation</summary>

The `dequeue` method always transfers ALL elements from `inStack` to `outStack`, even when `outStack` is not empty. This reverses the order of elements that were already correctly positioned in `outStack`.

In the test case: after dequeuing 1, outStack has [2]. Enqueuing 3 puts it in inStack [3]. Dequeuing transfers 3 on top of 2 in outStack, making outStack [2, 3], so pop returns 3 instead of 2.

**Fix:** Only transfer when outStack is empty.

```java
public int dequeue() {
    if (outStack.isEmpty()) {
        while (!inStack.isEmpty()) {
            outStack.push(inStack.pop());
        }
    }
    return outStack.pop();
}
```
</details>

---

## Exercise 6: Next Greater Element Off by One (Python)

```python
def next_greater(nums):
    n = len(nums)
    result = [-1] * n
    stack = []

    for i in range(n):
        while stack and nums[i] > nums[stack[-1]]:
            j = stack.pop()
            result[j] = j  # BUG
        stack.append(i)
    return result
```

**Input:** `[4, 5, 2, 25]`
**Expected:** `[5, 25, 25, -1]`
**Actual:** `[0, 1, 2, -1]`

<details>
<summary>Hint</summary>
Look at what value is stored in `result[j]`.
</details>

<details>
<summary>Bug Explanation</summary>

The code stores the INDEX `j` instead of the VALUE `nums[i]` (the next greater element).

**Fix:**

```python
result[j] = nums[i]  # store the value, not the index
```
</details>

---

## Exercise 7: Postfix Evaluator Operand Order (Go)

```go
func evalPostfix(tokens []string) int {
    stack := []int{}
    for _, tok := range tokens {
        switch tok {
        case "+", "-", "*", "/":
            a := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            b := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            switch tok {
            case "+": stack = append(stack, a+b)
            case "-": stack = append(stack, a-b)
            case "*": stack = append(stack, a*b)
            case "/": stack = append(stack, a/b)
            }
        default:
            num, _ := strconv.Atoi(tok)
            stack = append(stack, num)
        }
    }
    return stack[0]
}
```

**Input:** `["10", "3", "-"]`
**Expected:** `7` (10 - 3)
**Actual:** `-7` (3 - 10)

<details>
<summary>Hint</summary>
Which operand is popped first?
</details>

<details>
<summary>Bug Explanation</summary>

The first pop gives the SECOND operand (right side), and the second pop gives the FIRST operand (left side). The code uses `a - b` where `a` is the right operand and `b` is the left operand, resulting in `3 - 10 = -7`.

**Fix:** Swap the variable names or the operation order.

```go
b := stack[len(stack)-1]  // right operand (popped first)
stack = stack[:len(stack)-1]
a := stack[len(stack)-1]  // left operand (popped second)
stack = stack[:len(stack)-1]
// Now a - b = 10 - 3 = 7
```
</details>

---

## Exercise 8: Linked Stack Memory Leak (Java)

```java
public class LinkedStack {
    private Node top;

    public int pop() {
        if (top == null) throw new EmptyStackException();
        int val = top.val;
        top = top.next;
        return val;
    }
}
```

**Symptoms:** In a long-running application, memory usage grows even though elements are being popped.

<details>
<summary>Hint</summary>
Think about what happens to the popped node's references.
</details>

<details>
<summary>Bug Explanation</summary>

This is actually a subtle issue. The popped node still has its `next` reference pointing into the stack. In most cases, the GC handles this fine. However, if external code holds a reference to the popped node, it prevents the entire chain below from being garbage collected (a "loitering" reference).

The more significant memory leak pattern occurs if the Node holds a large payload or if references to old nodes are cached elsewhere. The defensive fix is to null out the node's references:

```java
public int pop() {
    if (top == null) throw new EmptyStackException();
    Node node = top;
    int val = node.val;
    top = node.next;
    node.next = null;  // help GC
    return val;
}
```

This is the same pattern used in `java.util.LinkedList`.
</details>

---

## Exercise 9: Decode String Fails on Multi-Digit Numbers (Python)

```python
def decode_string(s):
    stack = []
    current = ""
    k = 0

    for ch in s:
        if ch.isdigit():
            k = int(ch)
        elif ch == "[":
            stack.append((current, k))
            current = ""
            k = 0
        elif ch == "]":
            prev, count = stack.pop()
            current = prev + current * count
        else:
            current += ch
    return current
```

**Input:** `"12[a]"`
**Expected:** `"aaaaaaaaaaaa"` (12 a's)
**Actual:** `"aa"` (only 2 a's)

<details>
<summary>Hint</summary>
What happens when there are multiple digits before `[`?
</details>

<details>
<summary>Bug Explanation</summary>

When `k = int(ch)` is used, each digit overwrites `k` instead of appending to it. For `"12"`, when `ch = '1'`, `k = 1`. When `ch = '2'`, `k = 2`. The `1` is lost.

**Fix:** Accumulate digits.

```python
if ch.isdigit():
    k = k * 10 + int(ch)
```
</details>

---

## Exercise 10: Stack Sort Infinite Loop (Go)

```go
func sortStack(input []int) []int {
    temp := []int{}

    for len(input) > 0 {
        val := input[len(input)-1]
        input = input[:len(input)-1]

        for len(temp) > 0 && temp[len(temp)-1] > val {
            top := temp[len(temp)-1]
            temp = temp[:len(temp)-1]
            input = append(input, top)
        }
        temp = append(temp, val)
    }
    return input  // BUG
}
```

**Input:** `[5, 1, 4, 2, 3]`
**Expected:** `[1, 2, 3, 4, 5]` (smallest on top)
**Actual:** `[]` (empty slice)

<details>
<summary>Hint</summary>
Which stack contains the sorted result?
</details>

<details>
<summary>Bug Explanation</summary>

The algorithm sorts elements into `temp`, but the function returns `input`, which is empty after the loop finishes (all elements have been transferred to `temp`).

**Fix:** Return `temp`.

```go
return temp
```
</details>

---

## Exercise 11: Asteroid Collision Misses Same-Size Case (Java)

```java
public int[] asteroidCollision(int[] asteroids) {
    Deque<Integer> stack = new ArrayDeque<>();

    for (int a : asteroids) {
        boolean alive = true;
        while (alive && a < 0 && !stack.isEmpty() && stack.peek() > 0) {
            if (stack.peek() < -a) {
                stack.pop();
            } else {
                alive = false;
            }
        }
        if (alive) stack.push(a);
    }

    int[] result = new int[stack.size()];
    for (int i = result.length - 1; i >= 0; i--) {
        result[i] = stack.pop();
    }
    return result;
}
```

**Input:** `[8, -8]`
**Expected:** `[]`
**Actual:** `[8]`

<details>
<summary>Hint</summary>
What happens when two asteroids are the same size?
</details>

<details>
<summary>Bug Explanation</summary>

When `stack.peek() == -a` (same size), the code falls into the `else` branch, setting `alive = false`. This means the negative asteroid is destroyed but the positive one survives. Both should be destroyed.

**Fix:** Handle the equal case explicitly.

```java
if (stack.peek() < -a) {
    stack.pop();
} else if (stack.peek() == -a) {
    stack.pop();
    alive = false;
} else {
    alive = false;
}
```
</details>

---

## Exercise 12: Largest Rectangle Wrong Width Calculation (Python)

```python
def largest_rectangle(heights):
    stack = []
    max_area = 0

    for i, h in enumerate(heights):
        while stack and heights[stack[-1]] > h:
            height = heights[stack.pop()]
            width = i - stack[-1]  # BUG
            max_area = max(max_area, height * width)
        stack.append(i)
    return max_area
```

**Input:** `[2, 1, 5, 6, 2, 3]`
**Symptoms:** Crashes with `IndexError` when stack becomes empty during the while loop. Also gives incorrect width when stack is non-empty.

<details>
<summary>Hint</summary>
Two issues: empty stack check, and width formula off by one.
</details>

<details>
<summary>Bug Explanation</summary>

**Bug 1:** When the stack is empty after popping, `stack[-1]` causes `IndexError`. Need to handle the empty stack case.

**Bug 2:** The width formula should be `i - stack[-1] - 1` when the stack is non-empty (the bar at `stack[-1]` is NOT part of the rectangle).

**Bug 3:** Elements remaining in the stack after the loop are never processed. Need a sentinel or a final drain loop.

**Fix:**

```python
def largest_rectangle(heights):
    stack = []
    max_area = 0
    heights.append(0)  # sentinel

    for i, h in enumerate(heights):
        while stack and heights[stack[-1]] > h:
            height = heights[stack.pop()]
            width = i if not stack else i - stack[-1] - 1
            max_area = max(max_area, height * width)
        stack.append(i)

    heights.pop()  # restore
    return max_area
```
</details>
