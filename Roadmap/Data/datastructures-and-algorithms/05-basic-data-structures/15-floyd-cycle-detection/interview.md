# Floyd's Cycle Detection -- Interview Preparation

## Junior Questions (1-15)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is Floyd's cycle detection algorithm? | Two pointers (tortoise and hare) at speeds 1 and 2; if they meet, there is a cycle. |
| 2 | Why call it the tortoise-and-hare algorithm? | Two runners on a track; the faster one (hare) laps the slower one (tortoise) if and only if the track is a loop. |
| 3 | What is the time complexity of Floyd's? | O(n) where n = mu + lambda (tail length + cycle length). |
| 4 | What is the space complexity of Floyd's? | O(1) -- just two pointers; no hash set, no stack. |
| 5 | How do you check that the hare can take two steps safely? | Test `fast != null && fast.next != null` before each iteration. |
| 6 | What goes wrong if you forget the `fast.next != null` check? | Null pointer dereference when computing `fast.next.next`. |
| 7 | What is the difference between detecting a cycle and finding the cycle's start? | Detection is one tortoise-hare pass; cycle-start needs a second pass after reset. |
| 8 | How do you find the cycle's start once you have a meeting point? | Reset one pointer to head; move both one step at a time; they meet at the cycle start. |
| 9 | Why is the cycle-start finding trick `mu = k*lambda - m`? | Equating slow's distance and hare's distance yields `mu + m = k*lambda`. |
| 10 | What is `mu` and what is `lambda`? | mu = tail length (steps before entering cycle); lambda = cycle length. |
| 11 | Can Floyd's detect a cycle of length 1 (self-loop)? | Yes -- one iteration: slow moves 1, hare moves 2 (lands on same self-looping node), they meet. |
| 12 | What does Floyd's return for an empty list? | False / null -- short-circuit on `head == null`. |
| 13 | Why use Floyd's over a hash set? | O(1) space vs O(n) space. Floyd's wins on memory; hash set is simpler. |
| 14 | What does "ρ-shape" mean? | The linked-list-with-cycle looks like the Greek letter ρ: straight tail leading into a loop. |
| 15 | Can Floyd's work on arrays? | Yes -- treat the array as a function `f(i) = a[i]`. LeetCode 287 is the canonical example. |

---

## Middle Questions (16-30)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 16 | Prove that Floyd's terminates within mu + lambda iterations. | After both pointers are inside the cycle, relative offset advances by 1 per iteration; cycles through every residue mod lambda; must hit 0 within lambda iterations. |
| 17 | Why does fast = 2 * slow work but fast = 3 * slow fail in general? | Relative offset advances by `k - 1` per step. For 2:1 the advance is 1 (coprime to every lambda). For 3:1 the advance is 2 -- fails on even cycle lengths. |
| 18 | Walk through LeetCode 142 (Linked List Cycle II). | Phase 1: detect meeting. Phase 2: reset slow to head; advance both 1 step; meet at cycle start. |
| 19 | Walk through LeetCode 287 (Find the Duplicate Number). | Treat `nums` as a function `f(i) = nums[i]`. Cycle exists by pigeonhole. Cycle start = duplicate. |
| 20 | How would you compute the cycle length lambda after detecting a cycle? | Fix one pointer at the meeting point; walk the other until they meet again; count steps. |
| 21 | What is Brent's algorithm and how does it differ from Floyd's? | Brent's uses one hare; snapshots tortoise at exponentially-growing intervals. ~36% fewer `f`-calls. Same asymptotic class. |
| 22 | When would you use Brent's over Floyd's? | Pollard's rho factorization or any hot loop where each `f`-call is expensive. |
| 23 | What is Pollard's rho? | Integer factorization using Floyd's on `f(x) = (x^2 + c) mod n`. Expected runtime `O(n^{1/4})`. |
| 24 | Why does Pollard's rho run in O(n^{1/4}) expected time? | Birthday paradox: the sequence modulo p (smallest prime factor) enters a cycle in O(sqrt(p)) = O(n^{1/4}) steps. |
| 25 | What is the difference between strict and non-strict cycle detection (handling self-loops, length-1 cycles)? | A self-loop is a length-1 cycle. Floyd's handles it naturally; a "find duplicate" hash-set approach also handles it but with O(n) memory. |
| 26 | How would you detect a cycle in a doubly-linked list? | Same algorithm -- Floyd's only uses next-pointers, ignores prev. Alternative: mark visited via prev-pointer XOR trick. |
| 27 | What happens if Floyd's is given a non-deterministic `f`? | Tortoise and hare see different sequences; they may never meet. The algorithm requires `f` to be a pure function. |
| 28 | How do you handle Floyd's when the list contains duplicate values? | Compare by pointer/reference identity, not by value. `slow == fast` must mean "same node," not "same value." |
| 29 | Implement Floyd's that returns (has_cycle, cycle_start, cycle_length, tail_length). | Three-phase algorithm: detect, find start, find length. |
| 30 | When does Floyd's algorithm fail to apply? | When `f` is not a pure function, or the graph has multiple out-edges per node (use DFS-with-coloring instead). |

---

## Senior Questions (31-42)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 31 | How do you make Floyd's safe under concurrent mutation of the list? | Snapshot before scan, hazard pointers, or bounded-retry with version counter. |
| 32 | What metrics would you emit for a production Floyd's pipeline? | iterations, detected (count), mu and lambda histograms, restart_count, scan_latency_p99. |
| 33 | Describe a workflow engine using Floyd's for cycle detection. | On adding a dependency edge that could close a cycle, run Floyd's on the parent chain. O(chain length) memory-free. |
| 34 | When would you use distributed Floyd's via message passing? | Graph sharded across machines; tortoise and hare are tokens that walk one and two edges per round. |
| 35 | What is the failure mode where Floyd's reports a false positive? | Concurrent mutation creates a transient cycle that disappears mid-scan -- aggregate K consecutive scans to filter. |
| 36 | What is the failure mode where Floyd's reports a false negative? | Concurrent mutation breaks a cycle just as the scan starts -- the scan walks the now-acyclic tail. Same mitigation. |
| 37 | How would you use Floyd's inside a reference-counting GC? | As a pre-check: "is this candidate root part of any cycle?" If no, refcounting suffices; if yes, schedule a full cycle-collection. |
| 38 | What is the adversarial input that hurts Floyd's latency? | Very long mu with tiny lambda -- Phase 2 walks mu steps before finding the cycle entry. |
| 39 | Why is Floyd's preferred over hash-set detection on large arrays? | The hash set thrashes cache (random hash slots); Floyd's walks sequential memory. Wall-clock 5-10x faster on n > 1e5. |
| 40 | When does Floyd's NOT detect a cycle that DFS would? | When the graph has multiple out-edges per node -- Floyd's only follows one (`f(node)` must be deterministic). |
| 41 | How would you instrument Floyd's for regulatory audit (gaming, finance)? | Emit lambda as a histogram across many runs; reject deploys where measured period is below a threshold. |
| 42 | Why might you cap Floyd's iteration count? | An adversarial or extremely deep tail could exceed the request budget; surface "unknown" outcome rather than block. |

---

## Professional Questions (43-50)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 43 | Prove that the relative-offset invariant `d_{i+1} = (d_i + 1) mod lambda` implies detection in <= lambda iterations after both pointers are inside the cycle. | The sequence d_0, d_1, ... cycles through every residue 0..lambda-1 in order; it must hit 0 within lambda steps. |
| 44 | Derive the cycle-start identity `mu = k*lambda - m` from scratch. | Tortoise walked T = mu + m; hare walked 2T = mu + m + k*lambda; subtract; mu + m = k*lambda. |
| 45 | What is the information-theoretic lower bound on cycle detection with O(1) memory? | Omega(mu + lambda) f-evaluations -- any algorithm must touch enough of the sequence to distinguish cycle from no-cycle. |
| 46 | Prove that fast = 2*slow is the smallest integer ratio that guarantees detection for every lambda. | Relative offset advance is k - 1; need gcd(k - 1, lambda) = 1 for all lambda; smallest such k is 2. |
| 47 | Derive the expected O(n^{1/4}) runtime of Pollard's rho. | Sequence modulo p behaves heuristically as random walk; birthday paradox: O(sqrt(p)) = O(n^{1/4}) steps to revisit. |
| 48 | Compare Floyd's and Brent's algorithm asymptotically and constant-wise. | Both O(mu + lambda); Brent's makes ~1.98 f-calls per step vs Floyd's ~3; Brent's is ~36% faster. |
| 49 | How does Floyd's behave on a non-deterministic `f`? | The proof's "same node at same offset" argument fails because tortoise and hare see different trajectories. The algorithm may never terminate. |
| 50 | Describe a persistent Floyd's. | Store every iteration state in an append-only log; query by index. O(mu + lambda) memory, O(1) query. Useful for debugging. |

---

## Coding Challenge -- Linked List Cycle II (LeetCode 142)

> Given the head of a linked list, return the node where the cycle begins, or `null` if there is no cycle.
>
> Constraints:
> - 0 <= number of nodes <= 10^4
> - Must use O(1) extra memory.
>
> Tests:
> - `[3, 2, 0, -4]`, cycle at index 1 -> node with value 2
> - `[1, 2]`, cycle at index 0 -> node with value 1
> - `[1]`, no cycle -> null
> - `[]` -> null
> - `[1, 2, 3, 4, 5]`, no cycle -> null

### Go

```go
package main

import "fmt"

type ListNode struct {
    Val  int
    Next *ListNode
}

// DetectCycle returns the node where the cycle begins, or nil if none.
// Two-phase Floyd's:
//   Phase 1: tortoise-hare detection -> meeting point m, where m is inside the cycle.
//   Phase 2: reset one pointer to head; advance both 1 step; they meet at cycle entry.
// Correctness: from mu = k*lambda - m, walking mu steps from head and from meeting
// both land on the cycle entry node.
// Time: O(mu + lambda). Space: O(1).
func DetectCycle(head *ListNode) *ListNode {
    if head == nil {
        return nil
    }
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            // Phase 2.
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
    // [3, 2, 0, -4] with cycle at index 1
    n3 := &ListNode{Val: 3}
    n2 := &ListNode{Val: 2}
    n0 := &ListNode{Val: 0}
    nM4 := &ListNode{Val: -4}
    n3.Next = n2
    n2.Next = n0
    n0.Next = nM4
    nM4.Next = n2 // cycle back to n2

    start := DetectCycle(n3)
    if start != nil {
        fmt.Printf("Cycle starts at node with value %d\n", start.Val) // 2
    } else {
        fmt.Println("No cycle")
    }

    // No cycle
    a := &ListNode{Val: 1}
    b := &ListNode{Val: 2}
    a.Next = b
    fmt.Println(DetectCycle(a)) // <nil>
}
```

### Java

```java
public class LinkedListCycleII {
    static class ListNode {
        int val;
        ListNode next;
        ListNode(int v) { this.val = v; }
    }

    /**
     * Detect the cycle's entry node, or null if none.
     *
     * Phase 1: tortoise-hare detection (1 vs 2 steps).
     * Phase 2: reset one to head; advance both 1 step; meet at cycle start.
     *
     * Correctness rests on the identity mu = k*lambda - m, where mu = tail length,
     * lambda = cycle length, and m = meeting offset inside the cycle. From this,
     * walking mu steps from head and mu steps from the meeting point both
     * land on the cycle entry.
     *
     * Time: O(mu + lambda). Space: O(1).
     */
    public static ListNode detectCycle(ListNode head) {
        if (head == null) return null;
        ListNode slow = head, fast = head;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) {
                ListNode p = head;
                while (p != slow) {
                    p = p.next;
                    slow = slow.next;
                }
                return p;
            }
        }
        return null;
    }

    public static void main(String[] args) {
        // [3, 2, 0, -4] with cycle at index 1
        ListNode n3 = new ListNode(3);
        ListNode n2 = new ListNode(2);
        ListNode n0 = new ListNode(0);
        ListNode nM4 = new ListNode(-4);
        n3.next = n2; n2.next = n0; n0.next = nM4; nM4.next = n2;

        ListNode start = detectCycle(n3);
        System.out.println(start == null ? "no cycle" : ("cycle at value " + start.val));
        // expected: cycle at value 2

        // No cycle
        ListNode a = new ListNode(1);
        ListNode b = new ListNode(2);
        a.next = b;
        System.out.println(detectCycle(a)); // null
    }
}
```

### Python

```python
"""LeetCode 142 -- Linked List Cycle II.

Return the node where the cycle begins, or None if no cycle exists.
Constant extra memory.
"""

from typing import Optional


class ListNode:
    __slots__ = ("val", "next")

    def __init__(self, val: int = 0, nxt: "Optional[ListNode]" = None) -> None:
        self.val = val
        self.next = nxt


def detect_cycle(head: Optional[ListNode]) -> Optional[ListNode]:
    """
    Two-phase Floyd's tortoise-and-hare:

    Phase 1 (detection): slow advances 1 step, fast advances 2 steps. If they
    meet at node m inside the cycle, a cycle exists.

    Phase 2 (cycle start): reset slow to head; advance both 1 step at a time.
    They meet at the cycle's entry.

    Correctness relies on mu = k*lambda - m where mu = tail length,
    lambda = cycle length, m = offset of meeting from cycle entry. After
    Phase 1 the hare has lapped the cycle k times; walking mu more steps from
    head and from the meeting point both land on the cycle entry.

    Time:  O(mu + lambda).
    Space: O(1).
    """
    if head is None:
        return None
    slow = fast = head
    while fast is not None and fast.next is not None:
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
    # [3, 2, 0, -4] with cycle at index 1
    n3, n2, n0, nM4 = ListNode(3), ListNode(2), ListNode(0), ListNode(-4)
    n3.next = n2
    n2.next = n0
    n0.next = nM4
    nM4.next = n2

    start = detect_cycle(n3)
    print(f"cycle at value {start.val}" if start else "no cycle")  # 2

    # No cycle
    a, b = ListNode(1), ListNode(2)
    a.next = b
    print(detect_cycle(a))  # None
```

---

## Whiteboard Walkthrough -- Find the Duplicate Number (LeetCode 287)

A classic follow-up that demonstrates Floyd's beyond linked lists.

**Problem.** Given an array `nums` of `n + 1` integers where each integer is in `[1, n]`, find the one duplicate. Constraints: O(1) extra memory; the array must not be modified.

**Idea.** Treat the array as a function `f(i) = nums[i]`. By the pigeonhole principle (n + 1 values mapping into n possible images), some pair `i != j` has `nums[i] = nums[j]`. The directed graph `i -> nums[i]` therefore has a cycle, and the cycle's entry point (the node with two incoming edges) is exactly the duplicate value.

```text
For nums = [1, 3, 4, 2, 2]:
  f(0) = 1
  f(1) = 3
  f(3) = 2
  f(2) = 4
  f(4) = 2  <-- cycle entry; duplicate = 2
```

### Go

```go
func FindDuplicate(nums []int) int {
    slow, fast := nums[0], nums[0]
    // Phase 1
    for {
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast {
            break
        }
    }
    // Phase 2
    slow = nums[0]
    for slow != fast {
        slow = nums[slow]
        fast = nums[fast]
    }
    return slow
}
```

### Java

```java
public static int findDuplicate(int[] nums) {
    int slow = nums[0], fast = nums[0];
    do {
        slow = nums[slow];
        fast = nums[nums[fast]];
    } while (slow != fast);
    slow = nums[0];
    while (slow != fast) {
        slow = nums[slow];
        fast = nums[fast];
    }
    return slow;
}
```

### Python

```python
def find_duplicate(nums):
    slow = fast = nums[0]
    while True:
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast:
            break
    slow = nums[0]
    while slow != fast:
        slow = nums[slow]
        fast = nums[fast]
    return slow
```

This is one of the few production-rare problems where Floyd's is the **only** acceptable answer because the constraints rule out sorting (mutates) and a hash set (O(n) memory).

---

## Mistakes Interviewers Watch For

| Mistake | What it tells the interviewer |
|---------|-------------------------------|
| Forgetting `fast.next != null` | Null-pointer bug; ask candidate to test on a 2-node no-cycle list. |
| Comparing values instead of references for meeting | Misunderstands the algorithm; ask "what if two distinct nodes have the same value?" |
| Skipping Phase 2 and returning meeting node as "cycle start" | Confuses meeting with entry; ask candidate to trace `[1, 2, 3, 4, 5]` cycle at index 1 by hand. |
| Using fast = 3 * slow | "Why 2 and not 3?" -- candidate cannot answer; the cycle-start formula breaks. |
| Mutating the list to mark visited | Defeats the purpose; ask if the input is read-only. |
| Recursive implementation | Stack overflow on long lists; junior signal. |
| Hash set when O(1) memory is required | Did not read the problem; ask candidate to re-read the constraints. |
| Returning incorrect type (int vs node) | Did not read the problem carefully. |

---

## How to Approach a New Floyd's Problem

A four-step recipe interviewers like to see verbalized:

1. **Identify the iterated-function structure.** "Can I define `f(state) = next_state` deterministically?" If yes, Floyd's is a candidate.
2. **Decide whether you need detection only or also the cycle start.** Detection is one phase; cycle start requires Phase 2.
3. **Pick the right starting positions.** Linked lists: `slow = fast = head`, then `slow = slow.next; fast = fast.next.next`. Function-on-arrays: `slow = fast = nums[0]`, then `do { slow = f(slow); fast = f(f(fast)) } while (slow != fast)`. The two styles differ by one iteration and the cycle-start formula adjusts accordingly.
4. **Validate on edge cases.** Empty input, single node, self-loop, cycle of length 1, cycle starting at head (mu = 0).

If you can verbalize these four steps before writing code, you will produce correct solutions and demonstrate clear thinking.

---

## Quick-Recall Cheat Sheet

| Problem | f | Cycle start meaning | LeetCode |
|---------|---|--------------------|---------|
| Linked list cycle | `f(node) = node.next` | First node in cycle | 141 (detect), 142 (find start) |
| Find duplicate | `f(i) = nums[i]` | The duplicate value | 287 |
| Happy number | `f(x) = sum_of_squared_digits(x)` | Cycle means not happy | 202 |
| Pollard's rho | `f(x) = (x^2 + c) mod n` | Step where gcd(diff, n) > 1 | -- |
| PRNG period | `f(x) = next_state(x)` | Period = lambda | -- |
| Workflow chain | `f(wf) = wf.parent_workflow` | Catastrophic config error | -- |

**Mnemonic:** *Slow steps, Fast leaps, Meet means loop, Reset head finds start.*

If you remember the table and the mnemonic, you can reconstruct any solution under interview pressure.
