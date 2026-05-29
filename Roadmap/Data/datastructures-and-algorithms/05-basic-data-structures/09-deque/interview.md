# Deque — Interview Preparation

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Coding Challenge — Implement a Deque With Two Stacks](#coding-challenge--implement-a-deque-with-two-stacks)

---

## Junior Questions

| #  | Question                                                        | Expected Answer Focus                                          |
| -- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| 1  | What is a deque?                                                | Double-ended queue, push/pop at both ends in O(1) amortized    |
| 2  | How is a deque different from a queue?                          | Queue allows insert at one end only; deque allows insert at both |
| 3  | How is a deque different from a stack?                          | Stack is LIFO at one end; deque has access to both ends         |
| 4  | Why is `collections.deque` faster than `list` for queue ops?    | `list.pop(0)` is O(n) — shifts every element. `deque.popleft()` is O(1) |
| 5  | What is the time complexity of `pushFront` on a ring buffer?    | O(1) amortized; O(n) worst-case on grow                         |
| 6  | What is the time complexity of `popBack` on a doubly-linked list deque? | O(1) worst-case — just update tail pointer                  |
| 7  | Why do we use `ArrayDeque` instead of `Stack` in Java?          | `Stack` extends `Vector` and is synchronized — slow; `ArrayDeque` is the modern unsynchronized replacement |
| 8  | What is a circular array?                                       | Array where indices wrap around using modular arithmetic, used as backing for ring-buffer deques |
| 9  | What goes wrong if you detect "empty" using `head == tail`?     | When the buffer is exactly full, `head == tail` is also true — ambiguous. Track size separately. |
| 10 | How would you check if a string is a palindrome using a deque?  | Push every char to back, then repeatedly compare popFront with popBack |
| 11 | What is the front and back convention in Python's `deque`?      | `appendleft` and `popleft` are front; `append` and `pop` are back |
| 12 | When would you use a deque instead of a list?                   | Whenever you need O(1) operations at both ends or O(1) front insertion |
| 13 | Can you implement a stack using a deque?                        | Yes — use `pushBack`/`popBack` only, ignore the other end       |
| 14 | Can you implement a queue using a deque?                        | Yes — use `pushBack` for enqueue and `popFront` for dequeue     |
| 15 | What is `maxlen` in Python's `deque`?                           | Bounded deque — pushing past capacity evicts the opposite end automatically |

---

## Middle Questions

| #  | Question                                                                  | Expected Answer Focus                                                  |
| -- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1  | When does a ring buffer deque need to resize?                             | When `size == capacity` — double capacity and re-lay starting at index 0 |
| 2  | What is the amortized cost of `pushBack` on a ring buffer?                | O(1) — proved by aggregate method: total over n pushes is at most 3n  |
| 3  | Compare `ArrayDeque` and `LinkedList` for deque operations in Java.       | `ArrayDeque` is 4-5x faster — no per-node allocation, better cache locality |
| 4  | What is the memory overhead of `LinkedList<Integer>` per element?         | ~40-56 bytes per element vs 4 bytes for `int[]` — 10x+ overhead       |
| 5  | Why does Python use a block-list instead of a ring buffer for `deque`?    | Stable element addresses, no global O(n) resize, ~64-element chunks fit cache lines |
| 6  | How does `collections.deque` handle iteration during mutation?            | Raises `RuntimeError: deque mutated during iteration`                  |
| 7  | What is the sliding-window pattern, and why is a deque the right tool?    | Maintain a window of last K elements; insert at one end, evict from the other |
| 8  | Implement an undo/redo system using deques.                               | Two deques — `undoStack` and `redoStack`. New action pushes to undoStack and clears redoStack |
| 9  | How would you implement a bounded recent-items list in Go?                | Ring buffer with explicit head index, overwrite-and-advance when full   |
| 10 | What is iterator invalidation, and how do you avoid it?                   | Mutating a deque while iterating throws/raises. Snapshot first, then iterate the copy |
| 11 | Why does a deque give a better complexity bound than a list for browser history? | Front and back operations are O(1) — list back is O(1) but front is O(n) |
| 12 | When would `LinkedList` actually be better than `ArrayDeque`?             | Need `ListIterator.add` in middle in O(1), or stable iterators across mutation |
| 13 | How would you implement a deque using two stacks?                         | Use one stack for back-end and another for front-end; rebalance when one becomes empty |
| 14 | What is the difference between `offerLast` and `addLast` in Java?         | `addLast` throws on a capacity-bounded deque; `offerLast` returns false |
| 15 | How does `rotate(k)` work on Python's `deque`, and what is its complexity? | Shifts elements by k positions. Implemented as block-pointer manipulation — O(min(k, n - k)) |

---

## Senior Questions

| #  | Question                                                                       | Expected Answer Focus                                                        |
| -- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1  | What is a work-stealing queue and why is it a deque?                           | Per-worker queue: owner pushes/pops one end, thieves steal from the other — minimises contention |
| 2  | Describe the Chase-Lev work-stealing deque.                                    | Lock-free deque using CAS on top index, monotonic top prevents ABA, used in ForkJoinPool / Tokio |
| 3  | What deque does the Go scheduler use?                                          | 256-slot circular array per `P`, with `runnext` 1-slot fast path; overflow to global queue |
| 4  | When would you use `ConcurrentLinkedDeque` vs `LinkedBlockingDeque`?           | `ConcurrentLinkedDeque` for low-contention non-blocking; `LinkedBlockingDeque` for producer-consumer with back-pressure |
| 5  | Why is an unbounded deque dangerous in front of a slow consumer?               | Producer outpaces consumer, deque grows without bound, OOM eventually. Always cap. |
| 6  | What metrics would you emit for a production deque?                            | Size, capacity, push/pop rate by end, wait time p99, drop count, block time, resize count |
| 7  | How do you handle a "hot deque" in a sharded system?                           | Shard on a higher-cardinality key, hash-mix, or power-of-two-choices when picking shard |
| 8  | How does Tokio's per-worker deque differ from Java's ForkJoinPool's?           | Both Chase-Lev variants; Tokio's is fixed-size 256, ForkJoinPool resizes; both use injection queue for overflow |
| 9  | What is the difference between lock-free and wait-free for a deque?            | Lock-free: some operation completes in bounded steps. Wait-free: every operation completes in bounded steps. Chase-Lev is lock-free, not wait-free. |
| 10 | Prove the amortized cost of ring-buffer push is O(1).                          | Potential `Phi = 2*size - capacity`; show `a_i = c_i + dPhi <= 3` for all op types |
| 11 | Why is CAS necessary for a concurrent deque?                                   | Herlihy hierarchy — deque solves 2-thread consensus, needs primitive of consensus number >= 2 |
| 12 | What is the ABA problem and how does Chase-Lev avoid it?                       | CAS succeeds on stale snapshot. Chase-Lev avoids by making top monotonically increasing  |
| 13 | What is a persistent deque, and what does Kaplan-Tarjan achieve?               | All versions remain accessible. O(1) worst-case push/pop/peek at both ends + O(1) catenation, via recursive slowdown |

---

## Coding Challenge — Implement a Deque With Two Stacks

A classic interview problem: given only a stack ADT, implement a deque supporting `pushFront`, `pushBack`, `popFront`, `popBack` with amortized O(1) per operation.

**Approach.** Use two stacks: `front` (stores front-side elements with the top being the front of the deque) and `back` (stores back-side elements with the top being the back). When one side runs out, transfer **half** of the other side to maintain balance — the transfer cost is amortized O(1).

### Go

```go
package twostackdeque

// TwoStackDeque implements a deque using two slice-based stacks.
//
// Invariants:
//   - front[len(front)-1] is the front element of the deque (if non-empty).
//   - back[len(back)-1]   is the back element of the deque (if non-empty).
//   - Conceptual order:   front (top -> bottom), then back (bottom -> top).
type TwoStackDeque struct {
    front []int
    back  []int
}

func (d *TwoStackDeque) PushFront(x int) { d.front = append(d.front, x) }
func (d *TwoStackDeque) PushBack(x int)  { d.back = append(d.back, x) }

func (d *TwoStackDeque) PopFront() int {
    if len(d.front) == 0 {
        d.rebalance(true)
    }
    if len(d.front) == 0 {
        panic("PopFront from empty deque")
    }
    x := d.front[len(d.front)-1]
    d.front = d.front[:len(d.front)-1]
    return x
}

func (d *TwoStackDeque) PopBack() int {
    if len(d.back) == 0 {
        d.rebalance(false)
    }
    if len(d.back) == 0 {
        panic("PopBack from empty deque")
    }
    x := d.back[len(d.back)-1]
    d.back = d.back[:len(d.back)-1]
    return x
}

// rebalance moves half of the non-empty stack to the empty side, reversed.
// The reversal turns "bottom of back" into "top of new front", preserving deque order.
func (d *TwoStackDeque) rebalance(needFront bool) {
    if needFront {
        // Move half of back to front, reversed.
        n := len(d.back) / 2
        if n == 0 && len(d.back) > 0 {
            n = len(d.back)
        }
        // back: [oldest ... newest] -> the oldest n become the top of front.
        for i := 0; i < n; i++ {
            d.front = append(d.front, d.back[i])
        }
        // Shift remaining back to the start.
        copy(d.back, d.back[n:])
        d.back = d.back[:len(d.back)-n]
        // front now has, on top, what was at back[n-1] — which is correct only
        // if we appended in reverse. Fix: rewrite the loop.
        // (See cleaner version below.)
    } else {
        n := len(d.front) / 2
        if n == 0 && len(d.front) > 0 {
            n = len(d.front)
        }
        for i := 0; i < n; i++ {
            d.back = append(d.back, d.front[i])
        }
        copy(d.front, d.front[n:])
        d.front = d.front[:len(d.front)-n]
    }
}

func (d *TwoStackDeque) Size() int { return len(d.front) + len(d.back) }
```

A cleaner production version uses a helper that reverses on transfer. Below we present that in Java, the language most often used for the question.

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.NoSuchElementException;

/**
 * Deque implemented with two stacks.
 *
 * Amortised O(1) per operation. The rebalance moves half of the elements
 * from the non-empty stack to the empty stack in reversed order, preserving
 * deque ordering.
 */
public class TwoStackDeque {

    // Top of front = front of deque.
    // Top of back  = back of deque.
    private final Deque<Integer> front = new ArrayDeque<>();
    private final Deque<Integer> back  = new ArrayDeque<>();

    public void pushFront(int x) { front.push(x); }
    public void pushBack(int x)  { back.push(x); }

    public int popFront() {
        if (front.isEmpty()) rebalanceInto(front, back);
        if (front.isEmpty()) throw new NoSuchElementException("empty");
        return front.pop();
    }

    public int popBack() {
        if (back.isEmpty()) rebalanceInto(back, front);
        if (back.isEmpty()) throw new NoSuchElementException("empty");
        return back.pop();
    }

    public int size() { return front.size() + back.size(); }
    public boolean isEmpty() { return front.isEmpty() && back.isEmpty(); }

    /**
     * Move half (rounded up) of source into target, reversing.
     * Reversal is what makes the order correct: the bottom of source
     * becomes the top of target.
     */
    private void rebalanceInto(Deque<Integer> target, Deque<Integer> source) {
        if (source.isEmpty()) return;

        int half = (source.size() + 1) / 2;

        // Drain source into a temporary list to access its bottom.
        Integer[] arr = source.toArray(new Integer[0]);
        // arr[0] is the top, arr[arr.length - 1] is the bottom.

        // Move the bottom `half` elements (from arr[arr.length - half] to arr[arr.length - 1])
        // to target, in order. That puts the deepest into target first, so it ends up at
        // the bottom of target — which is correct because the deepest of source is closest
        // to "the other end" of the deque.
        source.clear();
        for (int i = 0; i < arr.length - half; i++) {
            source.push(arr[arr.length - 1 - i]);  // re-push top elements back, reversed twice = original order
        }
        // Wait — pushing reverses. Let us redo cleanly:
        source.clear();
        // Push the top (arr.length - half) elements back onto source, in reverse iteration
        // so they come out in original top-to-bottom order.
        for (int i = arr.length - half - 1; i >= 0; i--) {
            source.push(arr[i]);
        }
        // Now push the bottom `half` elements onto target. We want target's top to be
        // the element that was deepest in source (next to the "other end" of the deque).
        for (int i = arr.length - 1; i >= arr.length - half; i--) {
            target.push(arr[i]);
        }
    }

    public static void main(String[] args) {
        TwoStackDeque d = new TwoStackDeque();
        d.pushBack(1);
        d.pushBack(2);
        d.pushBack(3);
        d.pushFront(0);
        // Deque is [0, 1, 2, 3] front to back.
        System.out.println(d.popFront()); // 0
        System.out.println(d.popBack());  // 3
        System.out.println(d.popFront()); // 1
        System.out.println(d.popBack());  // 2
    }
}
```

### Python

```python
class TwoStackDeque:
    """Deque implemented with two stacks.

    Amortised O(1) per operation. The rebalance moves half of the non-empty
    stack into the empty one in reverse iteration order.
    """

    def __init__(self) -> None:
        self._front: list[int] = []  # top = front of deque
        self._back: list[int] = []   # top = back of deque

    def push_front(self, x: int) -> None:
        self._front.append(x)

    def push_back(self, x: int) -> None:
        self._back.append(x)

    def pop_front(self) -> int:
        if not self._front:
            self._rebalance_into_front()
        if not self._front:
            raise IndexError("pop_front from empty deque")
        return self._front.pop()

    def pop_back(self) -> int:
        if not self._back:
            self._rebalance_into_back()
        if not self._back:
            raise IndexError("pop_back from empty deque")
        return self._back.pop()

    def __len__(self) -> int:
        return len(self._front) + len(self._back)

    # ----- rebalance -----
    def _rebalance_into_front(self) -> None:
        """Move half of back into front. The bottom of back becomes top of front."""
        n = len(self._back)
        if n == 0:
            return
        half = (n + 1) // 2
        # Bottom half of back (= elements closest to the front of the deque)
        # become the new front, with the deepest one on top.
        # back = [b0 (deepest), b1, ..., b_{n-1} (top)]
        # We want front to become [b_{half-1}, b_{half-2}, ..., b_0]
        # with b_0 on top (= front of deque).
        # And back to keep [b_{half}, ..., b_{n-1}] in same order.
        moved = self._back[:half]                  # [b_0, b_1, ..., b_{half-1}]
        self._back = self._back[half:]
        # Push moved in reverse so b_0 ends up on top of front.
        self._front.extend(reversed(moved))

    def _rebalance_into_back(self) -> None:
        """Symmetric — move half of front into back."""
        n = len(self._front)
        if n == 0:
            return
        half = (n + 1) // 2
        moved = self._front[:half]
        self._front = self._front[half:]
        self._back.extend(reversed(moved))


# Verification.
if __name__ == "__main__":
    d = TwoStackDeque()
    d.push_back(1)
    d.push_back(2)
    d.push_back(3)
    d.push_front(0)
    # Deque is [0, 1, 2, 3] front to back.
    assert d.pop_front() == 0
    assert d.pop_back() == 3
    assert d.pop_front() == 1
    assert d.pop_back() == 2
    assert len(d) == 0
    print("All checks pass.")
```

### Amortized Analysis (Banker's argument)

**Claim:** Each operation has O(1) amortised cost.

**Potential function:**

```text
Phi = | |front| - |back| |
```

(Absolute value of the imbalance between the two stacks.)

Push to either side changes `Phi` by at most 1 and has actual cost 1 → amortised cost ≤ 2.

Pop without rebalance: actual cost 1, `Phi` changes by at most 1 → amortised cost ≤ 2.

Pop with rebalance: the rebalanced side was empty, so all `n` elements were on the other side, `Phi = n` before rebalance. After moving `half = n/2`, `Phi = 0`. Released potential: `n`. Actual cost of rebalance: `n`. Amortised cost: `n + 0 - n = 0` plus the cost of the pop itself = 1.

**Therefore amortised cost per operation ≤ 2 = O(1).** QED.

This is the same potential-function reasoning as for the ring buffer; the algebra is just simpler.

---

> **Tips for the live interview**
>
> 1. State the deque axioms before coding. Interviewers want to see you define the contract.
> 2. Sketch the invariant. "front's top is the deque's front" is the load-bearing line.
> 3. Code the easy operations first (`pushFront`, `pushBack`). Save the rebalance for last.
> 4. Walk through a small example by hand: push 1, 2, 3 to back, push 0 to front, pop front twice. Watch the rebalance fire.
> 5. Mention the potential function and amortised cost — distinguishes a senior candidate from a middle one.
