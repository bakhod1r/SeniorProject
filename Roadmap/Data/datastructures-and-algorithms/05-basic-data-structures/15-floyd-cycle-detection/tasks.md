# Floyd's Cycle Detection -- Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Each solution must run in O(mu + lambda) time using O(1) auxiliary memory unless otherwise stated.

---

## Beginner Tasks

### Task 1 -- Detect a Cycle in a Linked List (LeetCode 141)

Return true if the linked list contains a cycle, false otherwise.

**Example:** `1 -> 2 -> 3 -> 4 -> back to 2` -> `true`. `1 -> 2 -> 3 -> null` -> `false`.

#### Go

```go
package main

import "fmt"

type ListNode struct {
    Val  int
    Next *ListNode
}

func HasCycle(head *ListNode) bool {
    if head == nil {
        return false
    }
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            return true
        }
    }
    return false
}

func main() {
    n1, n2, n3, n4 := &ListNode{Val: 1}, &ListNode{Val: 2}, &ListNode{Val: 3}, &ListNode{Val: 4}
    n1.Next = n2; n2.Next = n3; n3.Next = n4; n4.Next = n2
    fmt.Println(HasCycle(n1)) // true
}
```

#### Java

```java
public class Task1 {
    static class ListNode { int val; ListNode next; ListNode(int v){val=v;} }

    public static boolean hasCycle(ListNode head) {
        if (head == null) return false;
        ListNode slow = head, fast = head;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        ListNode n1 = new ListNode(1), n2 = new ListNode(2), n3 = new ListNode(3), n4 = new ListNode(4);
        n1.next = n2; n2.next = n3; n3.next = n4; n4.next = n2;
        System.out.println(hasCycle(n1)); // true
    }
}
```

#### Python

```python
class ListNode:
    __slots__ = ('val', 'next')
    def __init__(self, val=0, nxt=None):
        self.val = val; self.next = nxt

def has_cycle(head):
    if head is None: return False
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            return True
    return False

if __name__ == "__main__":
    n1, n2, n3, n4 = ListNode(1), ListNode(2), ListNode(3), ListNode(4)
    n1.next = n2; n2.next = n3; n3.next = n4; n4.next = n2
    print(has_cycle(n1))  # True
```

**Constraints:** O(1) auxiliary memory. Validate on empty list, single node, single node with self-loop, two-node no-cycle.

---

### Task 2 -- Find Cycle Start (LeetCode 142)

Return the node where the cycle begins, or `null` / `nil` / `None` if no cycle.

**Example:** `1 -> 2 -> 3 -> 4 -> back to 2` -> node `2`.

#### Go

```go
func DetectCycle(head *ListNode) *ListNode {
    if head == nil { return nil }
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
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
```

#### Java

```java
public static ListNode detectCycle(ListNode head) {
    if (head == null) return null;
    ListNode slow = head, fast = head;
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) {
            ListNode p = head;
            while (p != slow) { p = p.next; slow = slow.next; }
            return p;
        }
    }
    return null;
}
```

#### Python

```python
def detect_cycle(head):
    if head is None: return None
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            p = head
            while p is not slow:
                p = p.next; slow = slow.next
            return p
    return None
```

**Constraints:** O(1) memory. Tests: cycle at index 0 (mu = 0), cycle at last index, no cycle, single self-loop.

---

### Task 3 -- Compute Cycle Length

After detecting a meeting point, walk around the cycle once to count lambda.

**Example:** for the list `1 -> 2 -> 3 -> 4 -> back to 2`, lambda = 3.

#### Go

```go
func CycleLength(head *ListNode) int {
    if head == nil { return 0 }
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            count := 1
            p := slow.Next
            for p != slow {
                p = p.Next; count++
            }
            return count
        }
    }
    return 0
}
```

#### Java

```java
public static int cycleLength(ListNode head) {
    if (head == null) return 0;
    ListNode slow = head, fast = head;
    while (fast != null && fast.next != null) {
        slow = slow.next;
        fast = fast.next.next;
        if (slow == fast) {
            int count = 1;
            ListNode p = slow.next;
            while (p != slow) { p = p.next; count++; }
            return count;
        }
    }
    return 0;
}
```

#### Python

```python
def cycle_length(head):
    if head is None: return 0
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            count = 1
            p = slow.next
            while p is not slow:
                p = p.next; count += 1
            return count
    return 0
```

**Constraints:** O(1) memory; output 0 if no cycle.

---

### Task 4 -- Happy Number (LeetCode 202)

A number is happy if iterating `f(x) = sum_of_squared_digits(x)` eventually reaches 1. Otherwise it loops in a cycle. Use Floyd's instead of a hash set.

**Example:** `19` -> `1*1 + 9*9 = 82` -> ... -> `1` (happy). `2` -> ... -> cycle (not happy).

#### Go

```go
func IsHappy(n int) bool {
    f := func(x int) int {
        s := 0
        for x > 0 {
            d := x % 10
            s += d * d
            x /= 10
        }
        return s
    }
    slow, fast := n, f(n)
    for slow != fast && fast != 1 {
        slow = f(slow)
        fast = f(f(fast))
    }
    return fast == 1
}
```

#### Java

```java
public static boolean isHappy(int n) {
    int slow = n, fast = next(n);
    while (slow != fast && fast != 1) {
        slow = next(slow);
        fast = next(next(fast));
    }
    return fast == 1;
}

private static int next(int x) {
    int s = 0;
    while (x > 0) { int d = x % 10; s += d * d; x /= 10; }
    return s;
}
```

#### Python

```python
def is_happy(n):
    def f(x):
        s = 0
        while x > 0:
            d = x % 10
            s += d * d
            x //= 10
        return s
    slow, fast = n, f(n)
    while slow != fast and fast != 1:
        slow = f(slow)
        fast = f(f(fast))
    return fast == 1
```

**Constraints:** O(1) memory.

---

### Task 5 -- Detect Self-Loop in Singly Linked List

Return true if any node's `next` pointer is to itself.

#### Go

```go
func HasSelfLoop(head *ListNode) bool {
    for n := head; n != nil; n = n.Next {
        if n.Next == n {
            return true
        }
    }
    return false
}
```

#### Java

```java
public static boolean hasSelfLoop(ListNode head) {
    for (ListNode n = head; n != null; n = n.next) {
        if (n.next == n) return true;
    }
    return false;
}
```

#### Python

```python
def has_self_loop(head):
    n = head
    while n is not None:
        if n.next is n:
            return True
        n = n.next
    return False
```

**Constraints:** O(1) memory. Note: this is a special case of cycle detection where `lambda = 1`.

---

## Intermediate Tasks

### Task 6 -- Find Duplicate in Array (LeetCode 287)

Given `nums` of `n + 1` integers in `[1, n]`, find the one duplicate. O(1) memory, read-only array.

**Example:** `[1, 3, 4, 2, 2]` -> `2`. `[3, 1, 3, 4, 2]` -> `3`.

#### Go

```go
func FindDuplicate(nums []int) int {
    slow, fast := nums[0], nums[0]
    for {
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast { break }
    }
    slow = nums[0]
    for slow != fast {
        slow = nums[slow]
        fast = nums[fast]
    }
    return slow
}
```

#### Java

```java
public static int findDuplicate(int[] nums) {
    int slow = nums[0], fast = nums[0];
    do { slow = nums[slow]; fast = nums[nums[fast]]; } while (slow != fast);
    slow = nums[0];
    while (slow != fast) { slow = nums[slow]; fast = nums[fast]; }
    return slow;
}
```

#### Python

```python
def find_duplicate(nums):
    slow = fast = nums[0]
    while True:
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast: break
    slow = nums[0]
    while slow != fast:
        slow = nums[slow]; fast = nums[fast]
    return slow
```

**Constraints:** Do not modify the array; O(1) extra memory.

---

### Task 7 -- Pollard's Rho Factorization

Given a composite n, return a non-trivial factor using Floyd's on `f(x) = (x^2 + c) mod n`.

**Example:** `8051` -> `83` or `97` (8051 = 83 * 97).

#### Go

```go
import "math/big"

func PollardRho(n int64) int64 {
    if n%2 == 0 { return 2 }
    f := func(x int64) int64 {
        return (x*x + 1) % n
    }
    gcd := func(a, b int64) int64 {
        for b != 0 { a, b = b, a%b }
        return a
    }
    for c := int64(1); ; c++ {
        x := int64(2)
        y := int64(2)
        d := int64(1)
        g := func(x int64) int64 { return (x*x + c) % n }
        for d == 1 {
            x = g(x)
            y = g(g(y))
            diff := x - y
            if diff < 0 { diff = -diff }
            d = gcd(diff, n)
        }
        if d != n { return d }
        _ = f
        _ = big.NewInt
    }
}
```

#### Java

```java
import java.math.BigInteger;
import java.util.Random;

public static long pollardRho(long n) {
    if (n % 2 == 0) return 2;
    Random rnd = new Random();
    while (true) {
        long c = 1 + (rnd.nextLong() & Long.MAX_VALUE) % (n - 1);
        long x = 2, y = 2, d = 1;
        while (d == 1) {
            x = (x * x + c) % n;
            y = (y * y + c) % n;
            y = (y * y + c) % n;
            long diff = Math.abs(x - y);
            d = gcd(diff, n);
        }
        if (d != n) return d;
    }
}

private static long gcd(long a, long b) {
    while (b != 0) { long t = b; b = a % b; a = t; }
    return a;
}
```

#### Python

```python
from math import gcd
import random

def pollard_rho(n):
    if n % 2 == 0: return 2
    while True:
        c = random.randint(1, n - 1)
        f = lambda x: (x * x + c) % n
        x = y = 2
        d = 1
        while d == 1:
            x = f(x)
            y = f(f(y))
            d = gcd(abs(x - y), n)
        if d != n:
            return d

if __name__ == "__main__":
    print(pollard_rho(8051))
```

**Constraints:** Avoid integer overflow (use big-integer types for n > 2^31). Verify the returned factor divides n.

---

### Task 8 -- PRNG Period Verification

Given a linear-congruential generator `f(x) = (a * x + c) mod m`, return its period (lambda) starting from `x_0`.

**Example:** `a = 5, c = 3, m = 16, x_0 = 0` -> period 16 (full period).

#### Go

```go
func PRNGPeriod(a, c, m, x0 int) int {
    f := func(x int) int { return (a*x + c) % m }
    // Phase 1: detection
    slow, fast := f(x0), f(f(x0))
    for slow != fast {
        slow = f(slow); fast = f(f(fast))
    }
    // Phase 3: measure lambda
    lambda := 1
    fast = f(slow)
    for slow != fast {
        fast = f(fast); lambda++
    }
    return lambda
}
```

#### Java

```java
public static int prngPeriod(int a, int c, int m, int x0) {
    java.util.function.IntUnaryOperator f = x -> (a * x + c) % m;
    int slow = f.applyAsInt(x0);
    int fast = f.applyAsInt(f.applyAsInt(x0));
    while (slow != fast) {
        slow = f.applyAsInt(slow);
        fast = f.applyAsInt(f.applyAsInt(fast));
    }
    int lambda = 1;
    fast = f.applyAsInt(slow);
    while (slow != fast) { fast = f.applyAsInt(fast); lambda++; }
    return lambda;
}
```

#### Python

```python
def prng_period(a, c, m, x0):
    f = lambda x: (a * x + c) % m
    slow, fast = f(x0), f(f(x0))
    while slow != fast:
        slow = f(slow); fast = f(f(fast))
    lam = 1
    fast = f(slow)
    while slow != fast:
        fast = f(fast); lam += 1
    return lam

if __name__ == "__main__":
    print(prng_period(5, 3, 16, 0))
```

**Constraints:** O(1) memory; output the exact period.

---

### Task 9 -- Detect Cycle in a Functional Graph

A functional graph has exactly one outgoing edge per node. Given the function as a 0-indexed array `successor[]` of length n, return (mu, lambda) starting from a given source `s`.

**Example:** `successor = [1, 2, 3, 1]`, source = 0 -> (mu = 1, lambda = 3).

#### Go

```go
func MuLambda(successor []int, s int) (int, int) {
    f := func(x int) int { return successor[x] }
    slow, fast := f(s), f(f(s))
    for slow != fast {
        slow = f(slow); fast = f(f(fast))
    }
    mu := 0
    slow = s
    for slow != fast {
        slow = f(slow); fast = f(fast); mu++
    }
    lambda := 1
    fast = f(slow)
    for slow != fast {
        fast = f(fast); lambda++
    }
    return mu, lambda
}
```

#### Java

```java
public static int[] muLambda(int[] successor, int s) {
    int slow = successor[s], fast = successor[successor[s]];
    while (slow != fast) {
        slow = successor[slow];
        fast = successor[successor[fast]];
    }
    int mu = 0;
    slow = s;
    while (slow != fast) {
        slow = successor[slow]; fast = successor[fast]; mu++;
    }
    int lambda = 1;
    fast = successor[slow];
    while (slow != fast) {
        fast = successor[fast]; lambda++;
    }
    return new int[]{mu, lambda};
}
```

#### Python

```python
def mu_lambda(successor, s):
    f = lambda x: successor[x]
    slow, fast = f(s), f(f(s))
    while slow != fast:
        slow = f(slow); fast = f(f(fast))
    mu = 0
    slow = s
    while slow != fast:
        slow = f(slow); fast = f(fast); mu += 1
    lam = 1
    fast = f(slow)
    while slow != fast:
        fast = f(fast); lam += 1
    return mu, lam

if __name__ == "__main__":
    print(mu_lambda([1, 2, 3, 1], 0))  # (1, 3)
```

**Constraints:** O(1) memory; correctness on mu = 0 (cycle at source).

---

### Task 10 -- Brent's Algorithm

Implement Brent's cycle-detection variant. Return (mu, lambda).

**Example:** `successor = [1, 2, 3, 1]`, source = 0 -> (1, 3).

#### Go

```go
func BrentCycle(successor []int, s int) (int, int) {
    f := func(x int) int { return successor[x] }
    power := 1
    lambda := 1
    tortoise := s
    hare := f(s)
    for tortoise != hare {
        if power == lambda {
            tortoise = hare
            power *= 2
            lambda = 0
        }
        hare = f(hare)
        lambda++
    }
    tortoise = s
    hare = s
    for i := 0; i < lambda; i++ { hare = f(hare) }
    mu := 0
    for tortoise != hare {
        tortoise = f(tortoise); hare = f(hare); mu++
    }
    return mu, lambda
}
```

#### Java

```java
public static int[] brentCycle(int[] successor, int s) {
    int power = 1, lambda = 1;
    int tortoise = s, hare = successor[s];
    while (tortoise != hare) {
        if (power == lambda) {
            tortoise = hare;
            power *= 2;
            lambda = 0;
        }
        hare = successor[hare];
        lambda++;
    }
    tortoise = s;
    hare = s;
    for (int i = 0; i < lambda; i++) hare = successor[hare];
    int mu = 0;
    while (tortoise != hare) {
        tortoise = successor[tortoise]; hare = successor[hare]; mu++;
    }
    return new int[]{mu, lambda};
}
```

#### Python

```python
def brent_cycle(successor, s):
    f = lambda x: successor[x]
    power = lam = 1
    tortoise = s
    hare = f(s)
    while tortoise != hare:
        if power == lam:
            tortoise = hare
            power *= 2
            lam = 0
        hare = f(hare); lam += 1
    tortoise = hare = s
    for _ in range(lam):
        hare = f(hare)
    mu = 0
    while tortoise != hare:
        tortoise = f(tortoise); hare = f(hare); mu += 1
    return mu, lam

if __name__ == "__main__":
    print(brent_cycle([1, 2, 3, 1], 0))  # (1, 3)
```

**Constraints:** Match Floyd's output but with ~36% fewer f-calls. Verify against Task 9.

---

## Advanced Tasks

### Task 11 -- Distributed Cycle Detection via Token Passing

Simulate distributed Floyd's: each node has a `next` reference. Run two virtual tokens (tortoise and hare) by exchanging messages through a queue. Detect cycle when both tokens carry matching origin IDs and round counters >= 1.

**Example:** simulate on a ring of 5 nodes with a back-edge from 4 to 1.

#### Go

```go
type Token struct {
    Origin int
    Round  int
    Role   string // "tortoise" or "hare"
    AtNode int
}

func DistributedDetect(successor []int, source int, maxRounds int) bool {
    queue := []Token{
        {Origin: source, Round: 0, Role: "tortoise", AtNode: source},
        {Origin: source, Round: 0, Role: "hare", AtNode: source},
    }
    visited := map[[3]int]bool{}
    for len(queue) > 0 {
        t := queue[0]; queue = queue[1:]
        if t.Round > maxRounds { continue }
        if t.Role == "tortoise" {
            next := successor[t.AtNode]
            queue = append(queue, Token{t.Origin, t.Round + 1, "tortoise", next})
        } else {
            next := successor[successor[t.AtNode]]
            queue = append(queue, Token{t.Origin, t.Round + 1, "hare", next})
        }
        key := [3]int{t.AtNode, t.Round, 0}
        if t.Role == "hare" {
            key[2] = 1
        }
        if visited[key] && t.Role == "hare" && t.Round > 0 {
            return true
        }
        visited[key] = true
    }
    return false
}
```

#### Java

```java
import java.util.*;

public static boolean distributedDetect(int[] successor, int source, int maxRounds) {
    record Token(int origin, int round, String role, int atNode) {}
    Deque<Token> queue = new ArrayDeque<>();
    queue.add(new Token(source, 0, "tortoise", source));
    queue.add(new Token(source, 0, "hare", source));
    Set<String> seen = new HashSet<>();
    while (!queue.isEmpty()) {
        Token t = queue.poll();
        if (t.round() > maxRounds) continue;
        String key = t.atNode() + "|" + t.round() + "|" + t.role();
        if (seen.contains(key) && t.role().equals("hare") && t.round() > 0) return true;
        seen.add(key);
        if (t.role().equals("tortoise")) {
            queue.add(new Token(t.origin(), t.round() + 1, "tortoise", successor[t.atNode()]));
        } else {
            queue.add(new Token(t.origin(), t.round() + 1, "hare", successor[successor[t.atNode()]]));
        }
    }
    return false;
}
```

#### Python

```python
from collections import deque

def distributed_detect(successor, source, max_rounds):
    queue = deque([
        (source, 0, 'tortoise', source),
        (source, 0, 'hare', source),
    ])
    seen = set()
    while queue:
        origin, rnd, role, at = queue.popleft()
        if rnd > max_rounds: continue
        key = (at, rnd, role)
        if key in seen and role == 'hare' and rnd > 0:
            return True
        seen.add(key)
        if role == 'tortoise':
            queue.append((origin, rnd + 1, 'tortoise', successor[at]))
        else:
            queue.append((origin, rnd + 1, 'hare', successor[successor[at]]))
    return False

if __name__ == "__main__":
    print(distributed_detect([1, 2, 3, 4, 1], 0, 100))  # True
```

**Constraints:** Bounded message budget; correct under reordering.

---

### Task 12 -- Cycle Detection in a Mutable List (Snapshot-Safe)

Wrap Floyd's in a snapshot mechanism: take a version number before scanning; abort and retry if the version changes mid-scan. Limit to K retries.

#### Go

```go
type VersionedList struct {
    Head    *ListNode
    Version int64
}

func DetectWithSnapshot(vl *VersionedList, k int) (bool, int) {
    for i := 0; i < k; i++ {
        v := vl.Version
        slow, fast := vl.Head, vl.Head
        cycle := false
        for fast != nil && fast.Next != nil {
            slow = slow.Next
            fast = fast.Next.Next
            if slow == fast { cycle = true; break }
        }
        if vl.Version == v { return cycle, i }
    }
    return false, k
}
```

#### Java

```java
static class VersionedList {
    ListNode head;
    volatile long version;
}

public static boolean detectWithSnapshot(VersionedList vl, int k) {
    for (int i = 0; i < k; i++) {
        long v = vl.version;
        ListNode slow = vl.head, fast = vl.head;
        boolean cycle = false;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) { cycle = true; break; }
        }
        if (vl.version == v) return cycle;
    }
    return false;
}
```

#### Python

```python
class VersionedList:
    def __init__(self, head=None):
        self.head = head
        self.version = 0

def detect_with_snapshot(vl, k):
    for _ in range(k):
        v = vl.version
        slow = fast = vl.head
        cycle = False
        while fast and fast.next:
            slow = slow.next
            fast = fast.next.next
            if slow is fast:
                cycle = True; break
        if vl.version == v:
            return cycle
    return False
```

**Constraints:** Bounded retries; return false (or "unknown") if version keeps changing.

---

### Task 13 -- Cycle Detection with Custom Speed Ratio

Implement Floyd's with a configurable hare speed (`fast = k * slow` for k >= 2). Verify that detection still works for k = 2, 3, 5; report the cycle-start finding correctness for each k.

#### Go

```go
func DetectKSpeed(successor []int, s, k int) bool {
    if k < 2 { return false }
    slow, fast := s, s
    for {
        slow = successor[slow]
        for i := 0; i < k; i++ {
            fast = successor[fast]
        }
        if slow == fast { return true }
        // Bound iterations to avoid infinite loop on bad k.
        // For correctness, k = 2 always works; higher k may not on certain cycle lengths.
    }
}
```

#### Java

```java
public static boolean detectKSpeed(int[] successor, int s, int k) {
    if (k < 2) return false;
    int slow = s, fast = s;
    int iter = 0;
    int cap = successor.length * 4;
    while (iter++ < cap) {
        slow = successor[slow];
        for (int i = 0; i < k; i++) fast = successor[fast];
        if (slow == fast) return true;
    }
    return false;
}
```

#### Python

```python
def detect_k_speed(successor, s, k):
    if k < 2: return False
    slow = fast = s
    cap = len(successor) * 4
    for _ in range(cap):
        slow = successor[slow]
        for _ in range(k):
            fast = successor[fast]
        if slow == fast:
            return True
    return False

# Test:
# k=2 always works.
# k=3 may fail on cycles where (k-1) shares a factor with lambda.
if __name__ == "__main__":
    print(detect_k_speed([1, 2, 0], 0, 2))  # True (lambda = 3, gcd(1, 3) = 1)
    print(detect_k_speed([1, 2, 0], 0, 3))  # True (lambda = 3, gcd(2, 3) = 1)
    print(detect_k_speed([1, 0], 0, 3))     # may fail (lambda = 2, gcd(2, 2) = 2)
```

**Constraints:** Bound iterations. Document which (k, lambda) pairs fail.

---

### Task 14 -- Find Cycle in Reference-Counted Object Graph

Simulate a refcount GC pre-check. Given an object graph where each object stores a `next_ref` (single outgoing reference for GC walk), apply Floyd's from each candidate root and report cyclic roots.

#### Go

```go
type Object struct {
    ID      int
    NextRef *Object
    Refcount int
}

func CyclicRoots(roots []*Object) []*Object {
    var cyclic []*Object
    for _, r := range roots {
        if r == nil { continue }
        slow, fast := r, r
        cycle := false
        for fast != nil && fast.NextRef != nil {
            slow = slow.NextRef
            fast = fast.NextRef.NextRef
            if slow == fast { cycle = true; break }
        }
        if cycle { cyclic = append(cyclic, r) }
    }
    return cyclic
}
```

#### Java

```java
static class Obj {
    int id;
    Obj nextRef;
    int refcount;
    Obj(int id) { this.id = id; }
}

public static java.util.List<Obj> cyclicRoots(java.util.List<Obj> roots) {
    java.util.List<Obj> out = new java.util.ArrayList<>();
    for (Obj r : roots) {
        if (r == null) continue;
        Obj slow = r, fast = r;
        boolean cycle = false;
        while (fast != null && fast.nextRef != null) {
            slow = slow.nextRef;
            fast = fast.nextRef.nextRef;
            if (slow == fast) { cycle = true; break; }
        }
        if (cycle) out.add(r);
    }
    return out;
}
```

#### Python

```python
class Obj:
    __slots__ = ('id', 'next_ref', 'refcount')
    def __init__(self, id_):
        self.id = id_; self.next_ref = None; self.refcount = 0

def cyclic_roots(roots):
    out = []
    for r in roots:
        if r is None: continue
        slow = fast = r
        cycle = False
        while fast is not None and fast.next_ref is not None:
            slow = slow.next_ref
            fast = fast.next_ref.next_ref
            if slow is fast:
                cycle = True; break
        if cycle:
            out.append(r)
    return out
```

**Constraints:** Each candidate root probed in isolation; reported separately. The full cycle-collector would still need to identify all members of each cycle.

---

### Task 15 -- Workflow Engine Loop Detection

Simulate a workflow scheduler. Workflows have a `parent_workflow_id`. When adding a parent edge, run Floyd's on the chain `wf -> parent -> parent.parent -> ...` to ensure no cycle. Reject the edge if a cycle would form.

#### Go

```go
type Workflow struct {
    ID       string
    ParentID string
}

func WouldCreateCycle(wfs map[string]*Workflow, childID, newParentID string) bool {
    // Tentatively follow parent chain starting from newParentID; if it ever reaches childID, cycle.
    f := func(id string) string {
        if w, ok := wfs[id]; ok { return w.ParentID }
        return ""
    }
    if newParentID == childID { return true }
    slow := f(newParentID)
    fast := f(f(newParentID))
    for slow != "" && fast != "" {
        if slow == childID || fast == childID { return true }
        if slow == fast { return true }
        slow = f(slow)
        fast = f(f(fast))
    }
    return false
}
```

#### Java

```java
import java.util.*;

static class Workflow {
    String id, parentId;
    Workflow(String id, String parentId) { this.id = id; this.parentId = parentId; }
}

public static boolean wouldCreateCycle(Map<String, Workflow> wfs, String childId, String newParentId) {
    if (newParentId.equals(childId)) return true;
    java.util.function.Function<String, String> f = id -> {
        Workflow w = wfs.get(id);
        return w == null ? null : w.parentId;
    };
    String slow = f.apply(newParentId);
    String fast = f.apply(f.apply(newParentId) == null ? "_" : f.apply(newParentId));
    while (slow != null && fast != null) {
        if (slow.equals(childId) || fast.equals(childId)) return true;
        if (slow.equals(fast)) return true;
        slow = f.apply(slow);
        String fNext = f.apply(fast);
        if (fNext == null) break;
        fast = f.apply(fNext);
    }
    return false;
}
```

#### Python

```python
def would_create_cycle(workflows, child_id, new_parent_id):
    if new_parent_id == child_id: return True
    def f(wf_id):
        wf = workflows.get(wf_id)
        return wf.parent_id if wf else None
    slow = f(new_parent_id)
    nxt = f(new_parent_id)
    fast = f(nxt) if nxt else None
    while slow is not None and fast is not None:
        if slow == child_id or fast == child_id:
            return True
        if slow == fast:
            return True
        slow = f(slow)
        nxt = f(fast)
        if nxt is None: break
        fast = f(nxt)
    return False
```

**Constraints:** O(1) extra memory; correctness when newParentId or any ancestor does not exist (return False).

---

## Benchmark Task

Compare Floyd's vs hash-set cycle detection performance across the three languages on a linked list with a cycle near the end.

#### Go

```go
package main

import (
    "fmt"
    "time"
)

func makeList(n, cycleAt int) *ListNode {
    if n == 0 { return nil }
    nodes := make([]*ListNode, n)
    for i := range nodes { nodes[i] = &ListNode{Val: i} }
    for i := 0; i < n-1; i++ { nodes[i].Next = nodes[i+1] }
    if cycleAt >= 0 { nodes[n-1].Next = nodes[cycleAt] }
    return nodes[0]
}

func hasCycleSet(head *ListNode) bool {
    seen := map[*ListNode]struct{}{}
    for n := head; n != nil; n = n.Next {
        if _, ok := seen[n]; ok { return true }
        seen[n] = struct{}{}
    }
    return false
}

func main() {
    sizes := []int{1000, 10000, 100000, 1000000}
    for _, n := range sizes {
        head := makeList(n, n/2)
        start := time.Now()
        for i := 0; i < 50; i++ { HasCycle(head) }
        floyd := time.Since(start)
        start = time.Now()
        for i := 0; i < 50; i++ { hasCycleSet(head) }
        set := time.Since(start)
        fmt.Printf("n=%7d Floyd=%6.3fms Set=%6.3fms ratio=%.1fx\n",
            n,
            float64(floyd.Microseconds())/50/1000.0,
            float64(set.Microseconds())/50/1000.0,
            float64(set)/float64(floyd))
    }
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    static ListNode makeList(int n, int cycleAt) {
        if (n == 0) return null;
        ListNode[] nodes = new ListNode[n];
        for (int i = 0; i < n; i++) nodes[i] = new ListNode(i);
        for (int i = 0; i < n - 1; i++) nodes[i].next = nodes[i + 1];
        if (cycleAt >= 0) nodes[n - 1].next = nodes[cycleAt];
        return nodes[0];
    }

    static boolean hasCycleSet(ListNode head) {
        Set<ListNode> seen = new HashSet<>();
        for (ListNode n = head; n != null; n = n.next) {
            if (!seen.add(n)) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        for (int n : sizes) {
            ListNode head = makeList(n, n / 2);
            long s = System.nanoTime();
            for (int i = 0; i < 50; i++) Task1.hasCycle(head);
            long floyd = System.nanoTime() - s;
            s = System.nanoTime();
            for (int i = 0; i < 50; i++) hasCycleSet(head);
            long set = System.nanoTime() - s;
            System.out.printf("n=%7d Floyd=%.3fms Set=%.3fms ratio=%.1fx%n",
                n, floyd / 50.0 / 1e6, set / 50.0 / 1e6, (double) set / floyd);
        }
    }
}
```

#### Python

```python
import time

def make_list(n, cycle_at):
    if n == 0: return None
    nodes = [ListNode(i) for i in range(n)]
    for i in range(n - 1):
        nodes[i].next = nodes[i + 1]
    if cycle_at >= 0:
        nodes[n - 1].next = nodes[cycle_at]
    return nodes[0]

def has_cycle_set(head):
    seen = set()
    n = head
    while n:
        if id(n) in seen: return True
        seen.add(id(n))
        n = n.next
    return False

for n in [1_000, 10_000, 100_000, 1_000_000]:
    head = make_list(n, n // 2)
    s = time.perf_counter()
    for _ in range(50): has_cycle(head)
    floyd = (time.perf_counter() - s) / 50 * 1000
    s = time.perf_counter()
    for _ in range(50): has_cycle_set(head)
    sset = (time.perf_counter() - s) / 50 * 1000
    print(f"n={n:>7} Floyd={floyd:6.3f}ms Set={sset:6.3f}ms ratio={sset/floyd:.1f}x")
```

> Expected outcome: Floyd's beats hash-set by 3-12x on Go/Java due to constant-space cache behavior. The gap widens with n because the hash set thrashes L3 while Floyd's stays in L1.
