# Linked Lists -- Find the Bug

## Instructions

Each exercise contains a linked list implementation or algorithm with one or more bugs. Your job is to:

1. Read the code carefully.
2. Identify the bug(s).
3. Explain what goes wrong (null pointer, lost nodes, infinite loop, etc.).
4. Fix the code.

---

## Exercise 1: Null Pointer on Empty List

**Language:** Go

```go
type Node struct {
    Data int
    Next *Node
}

type LinkedList struct {
    Head *Node
    Size int
}

func (ll *LinkedList) InsertAtTail(data int) {
    newNode := &Node{Data: data}
    ll.Head.Next = newNode  // BUG
    ll.Size++
}
```

**What happens:** If the list is empty, `ll.Head` is nil. Accessing `ll.Head.Next` causes a nil pointer dereference (panic/crash).

<details>
<summary>Solution</summary>

```go
func (ll *LinkedList) InsertAtTail(data int) {
    newNode := &Node{Data: data}
    if ll.Head == nil {
        ll.Head = newNode
    } else {
        current := ll.Head
        for current.Next != nil {
            current = current.Next
        }
        current.Next = newNode
    }
    ll.Size++
}
```

**Fix:** Check if `Head` is nil. If so, make the new node the head. Otherwise, traverse to the last node and append.

</details>

---

## Exercise 2: Lost Nodes During Deletion

**Language:** Java

```java
public boolean delete(int target) {
    if (head == null) return false;

    Node current = head;
    while (current != null) {
        if (current.data == target) {
            current = current.next;  // BUG
            size--;
            return true;
        }
        current = current.next;
    }
    return false;
}
```

**What happens:** The line `current = current.next` only moves the local variable. It does not actually remove the node from the list. The node with `target` remains in the list because no pointer was updated to skip over it.

<details>
<summary>Solution</summary>

```java
public boolean delete(int target) {
    if (head == null) return false;

    if (head.data == target) {
        head = head.next;
        size--;
        return true;
    }

    Node current = head;
    while (current.next != null) {
        if (current.next.data == target) {
            current.next = current.next.next;
            size--;
            return true;
        }
        current = current.next;
    }
    return false;
}
```

**Fix:** Track the predecessor node. When found, set `predecessor.next = target.next` to skip the deleted node. Handle the head case separately.

</details>

---

## Exercise 3: Infinite Loop in Traversal

**Language:** Python

```python
def print_list(self):
    current = self.head
    while current:
        print(current.data, end=" -> ")
        # BUG: forgot to advance the pointer
    print("None")
```

**What happens:** `current` is never updated inside the loop. The loop prints the head node's data forever (infinite loop).

<details>
<summary>Solution</summary>

```python
def print_list(self):
    current = self.head
    while current:
        print(current.data, end=" -> ")
        current = current.next  # advance the pointer
    print("None")
```

**Fix:** Add `current = current.next` inside the loop.

</details>

---

## Exercise 4: Wrong Pointer Update in Reversal

**Language:** Go

```go
func reverse(head *Node) *Node {
    var prev *Node
    current := head
    for current != nil {
        current.Next = prev  // BUG: overwrites Next before saving it
        prev = current
        current = current.Next
    }
    return prev
}
```

**What happens:** `current.Next` is overwritten to `prev` before saving the original next pointer. After the first iteration, `current = current.Next` follows the reversed pointer back to `prev` (nil on first iteration), effectively losing the rest of the list.

<details>
<summary>Solution</summary>

```go
func reverse(head *Node) *Node {
    var prev *Node
    current := head
    for current != nil {
        next := current.Next    // save next FIRST
        current.Next = prev     // reverse the pointer
        prev = current
        current = next           // move forward
    }
    return prev
}
```

**Fix:** Save `current.Next` in a temporary variable before overwriting it.

</details>

---

## Exercise 5: Off-by-One in insertAtPosition

**Language:** Java

```java
public void insertAtPosition(int index, int data) {
    if (index < 0 || index > size) {
        System.out.println("Invalid index");
        return;
    }

    Node newNode = new Node(data);
    Node current = head;
    for (int i = 0; i < index; i++) {  // BUG: should stop at index-1
        current = current.next;
    }
    newNode.next = current.next;
    current.next = newNode;
    size++;
}
```

**What happens:** The loop advances `current` to position `index` instead of `index - 1`. The new node is inserted one position too late. Also, this crashes when `index == 0` because we need the predecessor, not the node at the position.

<details>
<summary>Solution</summary>

```java
public void insertAtPosition(int index, int data) {
    if (index < 0 || index > size) {
        System.out.println("Invalid index");
        return;
    }

    Node newNode = new Node(data);

    if (index == 0) {
        newNode.next = head;
        head = newNode;
        size++;
        return;
    }

    Node current = head;
    for (int i = 0; i < index - 1; i++) {  // stop at predecessor
        current = current.next;
    }
    newNode.next = current.next;
    current.next = newNode;
    size++;
}
```

**Fix:** Handle index 0 separately. Loop to `index - 1` to land on the predecessor node.

</details>

---

## Exercise 6: Memory Leak / Tail Not Updated

**Language:** Python

```python
def delete_tail(self):
    if self.head is None:
        return

    if self.head.next is None:
        self.head = None
        # BUG: tail not updated
        self.size -= 1
        return

    current = self.head
    while current.next.next is not None:
        current = current.next
    current.next = None
    # BUG: tail not updated
    self.size -= 1
```

**What happens:** The `tail` pointer still references the deleted node. Future `insertAtTail` operations will append to the old (now disconnected) tail, losing the new nodes.

<details>
<summary>Solution</summary>

```python
def delete_tail(self):
    if self.head is None:
        return

    if self.head.next is None:
        self.head = None
        self.tail = None
        self.size -= 1
        return

    current = self.head
    while current.next.next is not None:
        current = current.next
    current.next = None
    self.tail = current  # update tail to the new last node
    self.size -= 1
```

**Fix:** Update `self.tail` to the new last node (or None if the list becomes empty).

</details>

---

## Exercise 7: Cycle Detection Returns Wrong Entry Point

**Language:** Go

```go
func detectCycleEntry(head *Node) *Node {
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            return slow  // BUG: this is the meeting point, not the entry
        }
    }
    return nil
}
```

**What happens:** The function returns the meeting point of slow and fast, which is NOT necessarily the cycle entry point. It is a point somewhere inside the cycle.

<details>
<summary>Solution</summary>

```go
func detectCycleEntry(head *Node) *Node {
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            // Phase 2: find the entry point
            slow = head
            for slow != fast {
                slow = slow.Next
                fast = fast.Next
            }
            return slow
        }
    }
    return nil
}
```

**Fix:** After detecting the meeting point, reset one pointer to head and advance both by 1 step until they meet again. That meeting point is the cycle entry.

</details>

---

## Exercise 8: Merge Sorted Lists Loses Remaining Elements

**Language:** Java

```java
public static Node mergeSorted(Node l1, Node l2) {
    Node dummy = new Node(0);
    Node curr = dummy;

    while (l1 != null && l2 != null) {
        if (l1.data <= l2.data) {
            curr.next = l1;
            l1 = l1.next;
        } else {
            curr.next = l2;
            l2 = l2.next;
        }
        curr = curr.next;
    }
    // BUG: remaining elements not attached
    return dummy.next;
}
```

**What happens:** When one list is exhausted, the remaining elements of the other list are never appended. The merged list ends prematurely.

<details>
<summary>Solution</summary>

```java
public static Node mergeSorted(Node l1, Node l2) {
    Node dummy = new Node(0);
    Node curr = dummy;

    while (l1 != null && l2 != null) {
        if (l1.data <= l2.data) {
            curr.next = l1;
            l1 = l1.next;
        } else {
            curr.next = l2;
            l2 = l2.next;
        }
        curr = curr.next;
    }
    // Attach whichever list still has elements
    curr.next = (l1 != null) ? l1 : l2;
    return dummy.next;
}
```

**Fix:** After the while loop, attach the non-null remainder with `curr.next = (l1 != null) ? l1 : l2`.

</details>

---

## Exercise 9: Doubly Linked List Delete Corrupts Pointers

**Language:** Python

```python
def delete_node(self, node):
    node.prev.next = node.next
    node.next.prev = node.prev
    # BUG: crashes if node is head or tail
    self.size -= 1
```

**What happens:** If `node` is the head, `node.prev` is None, and `node.prev.next` raises `AttributeError`. Same for tail: `node.next` is None, and `node.next.prev` raises an error.

<details>
<summary>Solution</summary>

```python
def delete_node(self, node):
    if node.prev:
        node.prev.next = node.next
    else:
        self.head = node.next  # deleting head

    if node.next:
        node.next.prev = node.prev
    else:
        self.tail = node.prev  # deleting tail

    self.size -= 1
```

**Fix:** Check for None before accessing `.next` or `.prev`. Update `self.head` or `self.tail` when deleting the head or tail node. Alternatively, use sentinel nodes to avoid these checks entirely.

</details>

---

## Exercise 10: Search Always Returns True

**Language:** Go

```go
func (ll *LinkedList) Search(target int) bool {
    current := ll.Head
    for current != nil {
        if current.Data == target {
            return true
        }
        return false  // BUG: returns false on first non-match
    }
    return false
}
```

**What happens:** The `return false` is inside the for loop but outside the if block. It executes after the first iteration regardless. The function only ever checks the head node.

<details>
<summary>Solution</summary>

```go
func (ll *LinkedList) Search(target int) bool {
    current := ll.Head
    for current != nil {
        if current.Data == target {
            return true
        }
        current = current.Next  // advance pointer
    }
    return false  // only return false after checking ALL nodes
}
```

**Fix:** Move `return false` outside the loop. Add `current = current.Next` to advance the pointer.

</details>

---

## Exercise 11: Recursive Reversal Stack Overflow

**Language:** Python

```python
def reverse_recursive(head):
    if head is None:
        return None
    new_head = reverse_recursive(head.next)
    head.next.next = head  # BUG: crashes when head.next is None
    head.next = None
    return new_head
```

**What happens:** The base case only checks `head is None`, but not `head.next is None`. When `head` is the last node, `head.next` is None, and `head.next.next = head` raises `AttributeError: 'NoneType' object has no attribute 'next'`.

<details>
<summary>Solution</summary>

```python
def reverse_recursive(head):
    if head is None or head.next is None:
        return head
    new_head = reverse_recursive(head.next)
    head.next.next = head
    head.next = None
    return new_head
```

**Fix:** The base case should be `head is None or head.next is None`. When `head` is the last node, return it directly as the new head.

</details>

---

## Exercise 12: Circular List Print Never Terminates

**Language:** Java

```java
public void print() {
    if (tail == null) return;
    Node curr = tail.next; // start at head
    while (curr != null) {  // BUG: will never be null in circular list
        System.out.print(curr.data + " -> ");
        curr = curr.next;
    }
    System.out.println();
}
```

**What happens:** In a circular linked list, no node has `next == null`. The while condition `curr != null` is always true, causing an infinite loop.

<details>
<summary>Solution</summary>

```java
public void print() {
    if (tail == null) return;
    Node curr = tail.next; // start at head
    do {
        System.out.print(curr.data + " -> ");
        curr = curr.next;
    } while (curr != tail.next);  // stop when we return to head
    System.out.println("(back to head)");
}
```

**Fix:** Use a do-while loop that terminates when `curr` returns to the starting node (`tail.next`).

</details>

---

## Bug Pattern Summary

| #  | Bug Type                    | Root Cause                                  |
|----|-----------------------------|---------------------------------------------|
| 1  | Null pointer dereference    | No empty-list check before accessing head   |
| 2  | Lost nodes                  | Moving local variable instead of re-linking  |
| 3  | Infinite loop               | Forgetting to advance the traversal pointer  |
| 4  | Wrong pointer update order  | Overwriting next before saving it            |
| 5  | Off-by-one                  | Traversing to position instead of predecessor|
| 6  | Stale tail pointer          | Not updating tail after deletion             |
| 7  | Wrong return value          | Returning meeting point instead of entry     |
| 8  | Truncated result            | Not attaching remaining list after merge     |
| 9  | Null pointer (DLL)          | No check for head/tail before accessing prev/next |
| 10 | Early return                | Return false inside loop instead of after    |
| 11 | Missing base case           | Not handling single-node case in recursion   |
| 12 | Infinite loop (circular)    | Using null check for circular list termination |
