# Linked Lists -- Optimize the Code

## Instructions

Each exercise contains working but suboptimal linked list code. Your job is to:

1. Identify the performance issue (time complexity, space complexity, or practical inefficiency).
2. Explain why it is slow or wasteful.
3. Rewrite the code with the optimal approach.

---

## Exercise 1: O(n) Insert at Tail Without Tail Pointer

**Language:** Go

```go
func (ll *LinkedList) InsertAtTail(data int) {
    newNode := &Node{Data: data}
    if ll.Head == nil {
        ll.Head = newNode
        return
    }
    current := ll.Head
    for current.Next != nil {
        current = current.Next
    }
    current.Next = newNode
}
```

**Problem:** Every tail insertion traverses the entire list -- O(n) per insertion. Inserting n elements at the tail is O(n^2) total.

<details>
<summary>Optimized Solution</summary>

```go
type LinkedList struct {
    Head *Node
    Tail *Node
}

func (ll *LinkedList) InsertAtTail(data int) {
    newNode := &Node{Data: data}
    if ll.Tail != nil {
        ll.Tail.Next = newNode
    } else {
        ll.Head = newNode
    }
    ll.Tail = newNode
}
```

**Improvement:** Maintain a `Tail` pointer. Insertion at tail becomes O(1). Inserting n elements goes from O(n^2) to O(n).

</details>

---

## Exercise 2: O(n^2) List Length Calculation Inside Loop

**Language:** Java

```java
public void printWithIndex() {
    for (int i = 0; i < getLength(); i++) {
        Node node = getNodeAt(i);
        System.out.println("Index " + i + ": " + node.data);
    }
}

private int getLength() {
    int count = 0;
    Node curr = head;
    while (curr != null) { count++; curr = curr.next; }
    return count;
}

private Node getNodeAt(int index) {
    Node curr = head;
    for (int i = 0; i < index; i++) curr = curr.next;
    return curr;
}
```

**Problem:** `getLength()` is called every iteration of the outer loop -- O(n) each time. `getNodeAt(i)` also traverses from head -- O(i). Total: O(n) * (O(n) + O(i)) = O(n^2).

<details>
<summary>Optimized Solution</summary>

```java
public void printWithIndex() {
    Node curr = head;
    int index = 0;
    while (curr != null) {
        System.out.println("Index " + index + ": " + curr.data);
        curr = curr.next;
        index++;
    }
}
```

**Improvement:** Single traversal -- O(n). No repeated length calculation. No repeated traversal to reach each index.

</details>

---

## Exercise 3: Creating New Nodes During Reversal

**Language:** Python

```python
def reverse(self):
    new_list = LinkedList()
    current = self.head
    while current:
        new_list.insert_at_head(current.data)
        current = current.next
    return new_list
```

**Problem:** Creates n new Node objects. Uses O(n) extra space. The original list's nodes become garbage.

<details>
<summary>Optimized Solution</summary>

```python
def reverse(self):
    prev = None
    current = self.head
    self.tail = self.head  # old head becomes new tail
    while current:
        next_node = current.next
        current.next = prev
        prev = current
        current = next_node
    self.head = prev
```

**Improvement:** In-place reversal using O(1) extra space. No new nodes created. Reuses existing node objects.

</details>

---

## Exercise 4: O(n) Delete When You Have the Node Reference (Singly Linked)

**Language:** Go

```go
func (ll *LinkedList) DeleteByReference(target *Node) {
    if ll.Head == nil { return }
    if ll.Head == target {
        ll.Head = ll.Head.Next
        return
    }
    curr := ll.Head
    for curr.Next != nil {
        if curr.Next == target {
            curr.Next = curr.Next.Next
            return
        }
        curr = curr.Next
    }
}
```

**Problem:** Even with a direct reference to the node, deletion is O(n) because you must find the predecessor in a singly linked list.

<details>
<summary>Optimized Solution -- Option A: Use a Doubly Linked List</summary>

```go
type DNode struct {
    Data int
    Prev *DNode
    Next *DNode
}

func (dll *DoublyLinkedList) DeleteByReference(target *DNode) {
    if target.Prev != nil {
        target.Prev.Next = target.Next
    } else {
        dll.Head = target.Next
    }
    if target.Next != nil {
        target.Next.Prev = target.Prev
    } else {
        dll.Tail = target.Prev
    }
}
```

**Improvement:** O(1) deletion with a doubly linked list.

</details>

<details>
<summary>Optimized Solution -- Option B: Copy-and-Delete Trick</summary>

```go
// Only works if target is NOT the tail node.
func deleteNodeTrick(target *Node) {
    target.Data = target.Next.Data
    target.Next = target.Next.Next
}
```

**Improvement:** Copy the next node's data into the target, then delete the next node. O(1) time. Caveat: does not work for the tail node.

</details>

---

## Exercise 5: O(n^2) Remove Duplicates Using Nested Loop

**Language:** Java

```java
public void removeDuplicates() {
    Node outer = head;
    while (outer != null) {
        Node inner = outer;
        while (inner.next != null) {
            if (inner.next.data == outer.data) {
                inner.next = inner.next.next;
            } else {
                inner = inner.next;
            }
        }
        outer = outer.next;
    }
}
```

**Problem:** Nested loop makes this O(n^2). For 100,000 elements with many duplicates, this is noticeably slow.

<details>
<summary>Optimized Solution</summary>

```java
public void removeDuplicates() {
    HashSet<Integer> seen = new HashSet<>();
    Node curr = head;
    Node prev = null;
    while (curr != null) {
        if (seen.contains(curr.data)) {
            prev.next = curr.next;
        } else {
            seen.add(curr.data);
            prev = curr;
        }
        curr = curr.next;
    }
}
```

**Improvement:** O(n) time using O(n) extra space (hash set). Each element is checked and inserted into the set exactly once.

</details>

---

## Exercise 6: Recursive Length Calculation (Stack Overflow Risk)

**Language:** Python

```python
def length(self, node=None, first_call=True):
    if first_call:
        node = self.head
    if node is None:
        return 0
    return 1 + self.length(node.next, False)
```

**Problem:** For a list of 100,000 nodes, this creates 100,000 stack frames. Python's default recursion limit is 1,000. Even if raised, deep recursion is slow due to function call overhead.

<details>
<summary>Optimized Solution</summary>

```python
def length(self):
    count = 0
    current = self.head
    while current:
        count += 1
        current = current.next
    return count
```

**Improvement:** Iterative approach uses O(1) stack space. Handles any list size. Faster due to no function call overhead.

Better yet, maintain a `size` counter that is updated on every insert/delete, making length a O(1) operation.

</details>

---

## Exercise 7: Repeated Traversal in Palindrome Check

**Language:** Go

```go
func isPalindrome(head *Node) bool {
    length := 0
    curr := head
    for curr != nil { length++; curr = curr.Next }

    for i := 0; i < length/2; i++ {
        left := getAt(head, i)
        right := getAt(head, length-1-i)
        if left.Data != right.Data { return false }
    }
    return true
}

func getAt(head *Node, index int) *Node {
    curr := head
    for i := 0; i < index; i++ { curr = curr.Next }
    return curr
}
```

**Problem:** For each pair comparison, `getAt` traverses from head. Accessing the right element at index `n-1-i` costs O(n). Total: O(n^2).

<details>
<summary>Optimized Solution</summary>

```go
func isPalindrome(head *Node) bool {
    if head == nil || head.Next == nil { return true }

    // Find middle
    slow, fast := head, head
    for fast.Next != nil && fast.Next.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
    }

    // Reverse second half
    secondHalf := reverse(slow.Next)
    slow.Next = nil

    // Compare
    p1, p2 := head, secondHalf
    result := true
    for p1 != nil && p2 != nil {
        if p1.Data != p2.Data { result = false; break }
        p1 = p1.Next
        p2 = p2.Next
    }

    // Restore (optional)
    slow.Next = reverse(secondHalf)
    return result
}
```

**Improvement:** O(n) time, O(1) space. Find middle with fast/slow, reverse second half, compare in one pass.

</details>

---

## Exercise 8: Inefficient Sorted Insert

**Language:** Java

```java
public void insertSorted(int data) {
    insertAtTail(data);
    // Bubble sort the entire list after every insertion
    boolean swapped;
    do {
        swapped = false;
        Node curr = head;
        while (curr != null && curr.next != null) {
            if (curr.data > curr.next.data) {
                int temp = curr.data;
                curr.data = curr.next.data;
                curr.next.data = temp;
                swapped = true;
            }
            curr = curr.next;
        }
    } while (swapped);
}
```

**Problem:** Sorting the entire list after every insertion is O(n^2) per insert. For n insertions, total cost is O(n^3).

<details>
<summary>Optimized Solution</summary>

```java
public void insertSorted(int data) {
    Node newNode = new Node(data);

    if (head == null || head.data >= data) {
        newNode.next = head;
        head = newNode;
        return;
    }

    Node curr = head;
    while (curr.next != null && curr.next.data < data) {
        curr = curr.next;
    }
    newNode.next = curr.next;
    curr.next = newNode;
}
```

**Improvement:** O(n) per insert -- traverse to the correct position and insert directly. For n insertions, total O(n^2) instead of O(n^3).

</details>

---

## Exercise 9: Wasteful Cycle Detection Using Hash Set

**Language:** Python

```python
def has_cycle(head):
    visited = set()
    current = head
    while current:
        if id(current) in visited:
            return True
        visited.add(id(current))
        current = current.next
    return False
```

**Problem:** This works correctly but uses O(n) extra space for the hash set. For very large lists, this wastes memory.

<details>
<summary>Optimized Solution</summary>

```python
def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            return True
    return False
```

**Improvement:** Floyd's algorithm uses O(1) space. Same O(n) time complexity but no extra memory allocation.

</details>

---

## Exercise 10: Inefficient Nth-from-End with Two Passes

**Language:** Go

```go
func nthFromEnd(head *Node, n int) *Node {
    // First pass: count total length
    length := 0
    curr := head
    for curr != nil {
        length++
        curr = curr.Next
    }

    // Second pass: traverse to (length - n)th node
    target := length - n
    curr = head
    for i := 0; i < target; i++ {
        curr = curr.Next
    }
    return curr
}
```

**Problem:** Requires two full passes over the list. For a list coming from a stream or network, you may not be able to traverse it twice.

<details>
<summary>Optimized Solution</summary>

```go
func nthFromEnd(head *Node, n int) *Node {
    first, second := head, head
    for i := 0; i < n; i++ {
        if first == nil { return nil } // n > list length
        first = first.Next
    }
    for first != nil {
        first = first.Next
        second = second.Next
    }
    return second
}
```

**Improvement:** Single pass using two pointers separated by n nodes. When `first` reaches the end, `second` is at the target. Works with streaming data where you cannot rewind.

</details>

---

## Exercise 11: Unrolled Linked List with Too-Small Blocks

**Language:** Python

```python
class UnrolledNode:
    def __init__(self, capacity=4):  # Only 4 elements per block
        self.data = []
        self.capacity = capacity
        self.next = None

class UnrolledLinkedList:
    def __init__(self):
        self.head = UnrolledNode(4)

    def insert(self, value):
        node = self.head
        while node.next and len(node.data) >= node.capacity:
            node = node.next
        if len(node.data) >= node.capacity:
            new_node = UnrolledNode(4)
            new_node.next = node.next
            node.next = new_node
            # Move half the elements to the new node
            mid = len(node.data) // 2
            new_node.data = node.data[mid:]
            node.data = node.data[:mid]
            if value >= new_node.data[0]:
                new_node.data.append(value)
            else:
                node.data.append(value)
        else:
            node.data.append(value)
```

**Problem:** Block size of 4 is far too small. The overhead of node pointers and metadata per block dominates. Cache benefits are negligible because each block fits in a fraction of a cache line.

<details>
<summary>Optimized Solution</summary>

```python
class UnrolledNode:
    def __init__(self, capacity=64):  # Match typical cache line
        self.data = [0] * capacity
        self.count = 0
        self.capacity = capacity
        self.next = None

class UnrolledLinkedList:
    def __init__(self, block_size=64):
        self.head = UnrolledNode(block_size)
        self.block_size = block_size

    def insert(self, value):
        node = self.head
        while node.next and node.count >= node.capacity:
            node = node.next
        if node.count >= node.capacity:
            new_node = UnrolledNode(self.block_size)
            new_node.next = node.next
            node.next = new_node
            mid = node.count // 2
            for i in range(mid, node.count):
                new_node.data[new_node.count] = node.data[i]
                new_node.count += 1
            node.count = mid
        node.data[node.count] = value
        node.count += 1
```

**Improvement:** Block size of 64 (or more) amortizes the per-node overhead and fits well with CPU cache lines (typically 64 bytes). Pre-allocate the array to avoid dynamic resizing within blocks.

</details>

---

## Optimization Pattern Summary

| #  | Original Complexity | Optimized Complexity | Technique                          |
|----|--------------------|-----------------------|------------------------------------|
| 1  | O(n) per tail insert | O(1) per tail insert | Maintain tail pointer              |
| 2  | O(n^2) traversal    | O(n) traversal       | Single-pass iteration              |
| 3  | O(n) extra space    | O(1) space           | In-place pointer reversal          |
| 4  | O(n) delete         | O(1) delete          | Doubly linked list or copy trick   |
| 5  | O(n^2) dedup        | O(n) dedup           | Hash set for seen values           |
| 6  | O(n) stack risk     | O(1) stack           | Iterative instead of recursive     |
| 7  | O(n^2) palindrome   | O(n) palindrome      | Reverse second half in place       |
| 8  | O(n^3) sorted insert| O(n^2) sorted insert | Insert at correct position directly|
| 9  | O(n) space cycle    | O(1) space cycle     | Floyd's two-pointer algorithm      |
| 10 | Two passes          | One pass             | Two-pointer gap technique          |
| 11 | Tiny blocks (4)     | Large blocks (64+)   | Match cache line size              |
