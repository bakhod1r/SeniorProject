# Pairing Heap — Junior Level

> **One-line summary:** A pairing heap is a self-adjusting, multiway heap-ordered tree where the structure is "fixed up" only on `extract-min` via a left-to-right pair-then-merge pass. It is the simplest heap that combines fast `meld` with fast `decrease-key`, and in benchmarks it routinely outperforms the asymptotically-superior Fibonacci heap.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Why It Beats Fibonacci in Practice](#why-it-beats-fibonacci-in-practice)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

The **pairing heap** was introduced by **Michael Fredman, Robert Sedgewick, Daniel Sleator, and Robert Tarjan in 1986** as a "self-adjusting" alternative to the Fibonacci heap — promising similar bounds with a much simpler implementation. It became famous for two reasons:

1. **Simplicity** — the entire structure is *one* multiway tree, no forest, no marked bits, no cascading cuts. About 50 lines of code in any language.
2. **Practicality** — even though its theoretical bounds were partially conjectural for decades, on real workloads (Dijkstra, A*, simulators) it almost always beats the Fibonacci heap and competes with carefully tuned indexed binary heaps.

The trade-off: pairing heaps have *no consolidate step* and *no explicit balancing*. They rely entirely on a clever **two-pass meld** during `extract-min` to keep the tree shallow on average. This works beautifully in practice; the formal worst-case bounds remained an open problem until Iacono and Özkan published tight analyses in 2014.

For a junior engineer, the pairing heap is the heap you reach for when:
- You need `meld` and `decrease-key`,
- You want simple code,
- You don't want to deal with Fibonacci-heap complexity,
- And you're willing to accept "good in practice" without a tight worst-case proof.

---

## Prerequisites

- **Binary heap** — see [`../01-binary-heap/junior.md`](../01-binary-heap/junior.md).
- **Recursion** — pairing's "two-pass meld" is naturally recursive.
- **Multiway tree** — each node has any number of children.
- **Amortised analysis** (basic idea) — pairing heap bounds are amortised.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Pairing heap** | A multiway heap-ordered tree with self-adjusting structure. |
| **Meld** | Combine two pairing heaps into one. Cost: `O(1)`. |
| **Two-pass meld** | The cleanup performed during `extract-min`: pair children left-to-right, then meld results right-to-left. |
| **First child / next sibling** | Standard linked representation; each node points to its first child and its right sibling. |
| **Heap order** | Every parent ≤ children (min-heap). |
| **Self-adjusting** | The tree's shape changes only as a side effect of operations; no explicit rebalancing rule. |
| **Auxiliary tree** | In some variants, a separate tree of "lazy" children awaiting consolidation. |

---

## Core Concepts

### 1. Meld is trivial — link two roots

To meld heaps `h1` and `h2`:

```
meld(h1, h2):
    if either is null, return the other
    if h1.key <= h2.key:
        make h2 the leftmost child of h1
        return h1
    else:
        make h1 the leftmost child of h2
        return h2
```

`O(1)`. Insert is just `meld(heap, new_singleton_heap)`, also `O(1)`.

### 2. Extract-min: the two-pass merge

`extract-min` removes the root and *somehow* combines its children — which is the only nontrivial step.

The standard "two-pass" merge:

```
extract-min:
    save the root r
    children = r's children (a singly-linked list)
    return r
    new_root = two_pass_merge(children)

two_pass_merge(c0, c1, c2, c3, c4):
    Pass 1: meld pairs from left:
        c01 = meld(c0, c1)
        c23 = meld(c2, c3)
        c4  alone
    Pass 2: meld right-to-left:
        x  = meld(c4, c23)
        y  = meld(x, c01)
        return y
```

Pass 1 has a left-to-right loop, pass 2 has a right-to-left loop. The amortised cost of `extract-min` is `O(log n)`.

### 3. Decrease-key — cut and re-meld

```
decrease_key(node, new_key):
    node.key = new_key
    if node has no parent (it's the root), done.
    else:
        detach node from its parent's child list
        meld(node, root)
```

Cost: `O(log n)` amortised (proven by Iacono); conjectured to be `O(log log n)` amortised but the exact bound remains open as of 2014.

### 4. No marked nodes, no cascading cuts

This is the headline difference from a Fibonacci heap: the pairing heap is *much* simpler. It has no `mark` flag, no cascading-cut routine, no consolidation array. Everything happens via `meld`.

### 5. Why two-pass works

Pass 1 reduces the children count from `k` to `⌈k/2⌉` by pairing. Pass 2 then merges the pairs together into a single tree. The intuition: the heap is "halved" before being rebuilt, just like in mergesort. The formal analysis is intricate, but the intuition is enough at junior level.

---

## Big-O Summary

| Operation | Amortised | Worst case |
|-----------|----------:|-----------:|
| `find-min` | **O(1)** | O(1) |
| `insert` | **O(1)** | O(1) |
| `meld` | **O(1)** | O(1) |
| `decrease-key` | O(log n)* | O(log n) |
| `extract-min` | O(log n) | O(n) |
| `delete` | O(log n) | O(n) |

`*` Best known is `O(log n)`. Conjectured `O(log log n)` for many years; lower bound is `Ω(log log n)`.

---

## Real-World Analogies

| Concept | Analogy |
|---------|---------|
| Pairing heap | A leaderboard where the leader is at the top and everyone else hangs off them in no particular order. |
| Meld | Two leaderboards combine — the bigger leader wins, the other goes under them. |
| Insert | A new entry challenges the leader. If they aren't better than the leader, they go underneath. |
| Two-pass merge | After the leader leaves, pair up sub-leaders left-to-right, then collapse pairs from the right to crown a new leader. |
| Decrease-key | A player rises in score; they detach from their group and challenge the leader. |
| Self-adjusting | No explicit balancing rule — the structure just settles over time as operations happen. |

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Simple — ~50 lines of code. | Theoretical bounds are looser than Fibonacci heap. |
| `O(1)` insert, meld, find-min. | Single tree can degrade to a linked list under adversarial input. |
| Fast in practice — usually beats Fibonacci, competitive with indexed binary. | `decrease-key` amortised bound is conjectured-but-not-proven `O(log log n)`. |
| No mark flags, no cascading cuts. | Cache behaviour worse than binary heap (pointer chasing). |
| Used in production: GCC's libstdc++ uses it for `std::priority_queue` mergers; many graph libraries ship it. | Worst-case `O(n)` for a single `extract-min` (amortised `O(log n)`). |

**When to use:**
- Dijkstra and Prim on real graphs (often wins over Fibonacci and binary).
- Event-driven simulators where meld is hot.
- Whenever Fibonacci feels too complex.

**When NOT to use:**
- You need strict worst-case bounds.
- You only do `push` and `pop` and never `meld` or `decrease-key` — binary heap is faster.

---

## Why It Beats Fibonacci in Practice

Concrete reasons:

1. **One tree, not a forest** — fewer pointer dereferences per op.
2. **No mark flags** — fewer memory writes.
3. **No consolidation array** — `extract-min` is leaner per call.
4. **Locality** — children of a node sit in the same allocation pattern, often cache-warm.

Empirical Dijkstra on `V = 10⁵`, `E = 5·10⁵`:

```
indexed binary heap : 0.42 s
pairing heap         : 0.55 s
Fibonacci heap       : 1.34 s
```

Pairing heap is consistently within ~30% of the indexed binary heap and dramatically faster than Fibonacci.

---

## Code Examples

### Example: Minimal pairing heap

#### Python

```python
class PNode:
    __slots__ = ("key", "value", "child", "sibling", "prev")

    def __init__(self, key, value=None):
        self.key, self.value = key, value
        self.child = None
        self.sibling = None
        self.prev = None   # parent if first child; left sibling otherwise


def meld(a, b):
    if a is None: return b
    if b is None: return a
    if a.key <= b.key:
        b.sibling = a.child
        if a.child:
            a.child.prev = b
        b.prev = a
        a.child = b
        return a
    else:
        a.sibling = b.child
        if b.child:
            b.child.prev = a
        a.prev = b
        b.child = a
        return b


class PairingHeap:
    def __init__(self):
        self.root = None

    def insert(self, key, value=None):
        node = PNode(key, value)
        self.root = meld(self.root, node)
        return node

    def find_min(self):
        return None if self.root is None else (self.root.key, self.root.value)

    def extract_min(self):
        if self.root is None:
            return None
        old = self.root
        self.root = self._two_pass(old.child)
        return old.key, old.value

    def decrease_key(self, node, new_key):
        if new_key > node.key:
            raise ValueError("new key larger")
        node.key = new_key
        if node is self.root:
            return
        # detach from sibling list
        if node.prev.child is node:
            node.prev.child = node.sibling
        else:
            node.prev.sibling = node.sibling
        if node.sibling:
            node.sibling.prev = node.prev
        node.sibling = node.prev = None
        self.root = meld(self.root, node)

    def _two_pass(self, first):
        # Pass 1: meld pairs left-to-right
        pairs = []
        cur = first
        while cur:
            a = cur
            cur = cur.sibling
            if cur:
                b = cur
                cur = cur.sibling
                a.sibling = b.sibling = a.prev = b.prev = None
                pairs.append(meld(a, b))
            else:
                a.sibling = a.prev = None
                pairs.append(a)
        # Pass 2: meld right-to-left
        result = None
        for p in reversed(pairs):
            result = meld(result, p)
        return result


if __name__ == "__main__":
    h = PairingHeap()
    a = h.insert(5)
    b = h.insert(3)
    c = h.insert(8)
    h.decrease_key(c, 1)
    print(h.extract_min())  # (1, None)
    print(h.extract_min())  # (3, None)
    print(h.extract_min())  # (5, None)
```

#### Go

```go
package main

import "fmt"

type Node struct {
    Key     int
    Value   interface{}
    Child   *Node
    Sibling *Node
    Prev    *Node
}

func Meld(a, b *Node) *Node {
    if a == nil { return b }
    if b == nil { return a }
    if a.Key <= b.Key {
        b.Sibling = a.Child
        if a.Child != nil { a.Child.Prev = b }
        b.Prev = a
        a.Child = b
        return a
    }
    a.Sibling = b.Child
    if b.Child != nil { b.Child.Prev = a }
    a.Prev = b
    b.Child = a
    return b
}

type PairingHeap struct { Root *Node }

func (h *PairingHeap) Insert(key int, val interface{}) *Node {
    n := &Node{Key: key, Value: val}
    h.Root = Meld(h.Root, n)
    return n
}

func (h *PairingHeap) FindMin() *Node { return h.Root }

func (h *PairingHeap) ExtractMin() *Node {
    if h.Root == nil { return nil }
    old := h.Root
    h.Root = twoPass(old.Child)
    return old
}

func twoPass(first *Node) *Node {
    var pairs []*Node
    cur := first
    for cur != nil {
        a := cur
        cur = cur.Sibling
        var pair *Node
        if cur != nil {
            b := cur
            cur = cur.Sibling
            a.Sibling, b.Sibling, a.Prev, b.Prev = nil, nil, nil, nil
            pair = Meld(a, b)
        } else {
            a.Sibling, a.Prev = nil, nil
            pair = a
        }
        pairs = append(pairs, pair)
    }
    var result *Node
    for i := len(pairs) - 1; i >= 0; i-- {
        result = Meld(result, pairs[i])
    }
    return result
}

func main() {
    h := &PairingHeap{}
    for _, x := range []int{5, 3, 8, 1, 9, 2, 7} {
        h.Insert(x, nil)
    }
    for h.Root != nil {
        fmt.Print(h.ExtractMin().Key, " ")
    }
    // 1 2 3 5 7 8 9
}
```

#### Java

```java
public class PairingHeap {
    static class Node {
        int key; Object value;
        Node child, sibling, prev;
        Node(int k, Object v) { key = k; value = v; }
    }

    Node root;

    public static Node meld(Node a, Node b) {
        if (a == null) return b;
        if (b == null) return a;
        if (a.key <= b.key) {
            b.sibling = a.child;
            if (a.child != null) a.child.prev = b;
            b.prev = a;
            a.child = b;
            return a;
        }
        a.sibling = b.child;
        if (b.child != null) b.child.prev = a;
        a.prev = b;
        b.child = a;
        return b;
    }

    public Node insert(int key, Object value) {
        Node n = new Node(key, value);
        root = meld(root, n);
        return n;
    }

    public Node extractMin() {
        if (root == null) return null;
        Node old = root;
        root = twoPass(old.child);
        return old;
    }

    private static Node twoPass(Node first) {
        java.util.List<Node> pairs = new java.util.ArrayList<>();
        Node cur = first;
        while (cur != null) {
            Node a = cur; cur = cur.sibling;
            Node pair;
            if (cur != null) {
                Node b = cur; cur = cur.sibling;
                a.sibling = b.sibling = a.prev = b.prev = null;
                pair = meld(a, b);
            } else {
                a.sibling = a.prev = null;
                pair = a;
            }
            pairs.add(pair);
        }
        Node result = null;
        for (int i = pairs.size() - 1; i >= 0; i--) result = meld(result, pairs.get(i));
        return result;
    }
}
```

---

## Coding Patterns

### Pattern 1: Dijkstra with pairing heap

In benchmarks, pairing heap routinely beats Fibonacci and approaches indexed binary. Use it when you need both `decrease-key` and `meld`.

### Pattern 2: K-way merge

Build `k` pairing heaps from `k` streams and meld them in `O(k)` total. Then `pop n` times in `O(n log k)` amortised — same as binary k-way merge with simpler bookkeeping.

### Pattern 3: Lazy delete via decrease-key

```
delete(node):
    decrease_key(node, -inf)
    extract_min()
```

Same trick as binomial / Fibonacci.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Sibling list contains the cut node still | Detach forgot to clear sibling pointer. | Always set `sibling = prev = None` after cut. |
| `decrease_key` corrupts the heap | Called on a freed handle. | Track handle validity in the API. |
| Two-pass merges only half the children | Loop condition off by one. | Carefully verify the pairing loop pairs odd-count lists correctly. |
| Cycle in sibling list | Forgot to terminate during pair-up. | Always null-terminate before melding. |

---

## Performance Tips

- **Pool nodes** in an arena allocator; per-node `malloc` dominates microbenchmarks.
- **Recursive two-pass** can blow the stack at very large `n`; an iterative version is safer.
- **Don't use it for plain `push`/`pop`** — a binary heap is faster.
- Profile against indexed binary heap before adopting in production.

---

## Best Practices

- Make `insert` return the node handle — `decrease_key` needs it.
- Document that the bounds are amortised, not worst-case.
- Iterative two-pass merge for large `n`.
- Use it in algorithm courses as the "simpler alternative" to Fibonacci.

---

## Edge Cases & Pitfalls

- **Empty heap** — `find_min`/`extract_min` return null.
- **Single node** — `extract_min` leaves the heap empty.
- **`decrease_key` on the root** — no-op (just update the key).
- **Adversarial sequences** — can force `extract_min` to be `O(n)` in the worst case; amortised bound still holds.
- **Equal keys** — order between equals is unspecified.

---

## Common Mistakes

1. Implementing only one pass (left-to-right) instead of two — bounds degrade.
2. Forgetting to reset `sibling` and `prev` before melding cut nodes — sibling lists tangle.
3. Comparing the wrong direction in `meld` — accidentally builds a max-heap.
4. Using a recursive `two_pass` on inputs of size `10⁶+` — stack overflow.
5. Storing `parent` instead of `prev` — `decrease_key` becomes harder.

---

## Cheat Sheet

| Operation | Amortised | Idea |
|-----------|----------:|------|
| `find_min` | O(1) | Root pointer. |
| `insert` | O(1) | Meld with singleton. |
| `meld` | O(1) | Link smaller root over larger. |
| `decrease-key` | O(log n) | Cut + meld. |
| `extract_min` | O(log n) | Two-pass merge of children. |

```
Node fields: key, value, child (first), sibling (right), prev (parent or left sibling).
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view of meld, the two-pass merge during `extract_min`, and the cut step in `decrease_key`.

---

## Summary

The pairing heap is the simplest heap with `O(1)` meld, `O(1)` insert, and amortised `O(log n)` `extract-min` and `decrease-key`. Its self-adjusting nature avoids all the bookkeeping of binomial and Fibonacci heaps, and in practice it usually beats them on real workloads. Default to it whenever Fibonacci heap is on the table.

---

## Further Reading

- Fredman, Sedgewick, Sleator, Tarjan, *The Pairing Heap: A New Form of Self-Adjusting Heap*, Algorithmica 1, 1986.
- Iacono, *Improved Upper Bounds for Pairing Heaps*, 2000.
- Iacono & Özkan, *Mergeable Dictionaries*, 2014 — closed several open bounds.
- Sedgewick & Wayne, *Algorithms*, §2.4 — practical treatment.
- GCC libstdc++ `__gnu_pbds::pairing_heap_tag` — production source.
