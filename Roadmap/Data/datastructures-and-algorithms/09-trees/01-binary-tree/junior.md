# Binary Tree — Junior Level

> **Read time: ~45 minutes** · **Audience:** First-year CS students, bootcamp grads, anyone who has just learned arrays, linked lists, and basic recursion. This is your first encounter with a tree.

A **binary tree** is the moment computer science stops being "lists of things" and becomes "things that point to other things in a structured way". Once you understand binary trees, an enormous amount of practical software suddenly opens up to you — the HTML in your browser is a tree, the file system on your disk is a tree, the abstract syntax tree (AST) the compiler builds from your source code is a tree, the JSON you parse from an HTTP response is a tree, the directory of every Git repository is a Merkle tree of commit trees. Trees are *everywhere* because they are the natural shape of recursive, nested, hierarchical data — and a vast amount of real-world data is exactly that.

This document teaches you the **plain binary tree** — the foundational abstract structure. We deliberately leave the *binary search tree* property (the rule that left children are smaller and right children are larger) for the next topic at `02-bst`. Here we focus on what a tree **is**, how to define one in code, how to walk one in four different orders, and how to do basic measurements like size and height. Everything else in the trees roadmap — BSTs, AVL trees, red-black trees, B-trees, tries, heaps, segment trees — is layered on top of this foundation.

---

## Table of Contents

1. [Introduction — What is a Tree?](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary — Root, Leaf, Depth, Height, and Friends](#glossary)
4. [Core Concepts — Node, Recursion, Pointers](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons](#pros-and-cons)
8. [Step-by-Step — Build a Small Tree by Hand](#walkthrough)
9. [Code Examples — Node, Insert, Size, Height, Traversals](#code-examples)
10. [Coding Patterns — Recursion Template and BFS with a Queue](#patterns)
11. [Error Handling — Null Roots and Stack Overflow](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — What is a Tree?

Think about a family tree. At the top is one ancestor. That ancestor has children. Each child can have their own children. Each of those can have more children. There is no cycle — your great-grandfather is not also one of your grandchildren — and every person (except the top ancestor) has exactly one immediate parent. The whole structure spreads downward, branching out, and ends at the youngest descendants who themselves have no children yet.

That is *literally* what a tree is in computer science. Formally:

> A **tree** is a connected, acyclic graph in which one node is designated as the **root**. Every other node has exactly one **parent**. Every node may have zero or more **children**.

A **binary tree** is the special case where every node has at most **two** children, conventionally called the **left child** and the **right child**. The "binary" comes from "at most 2".

```
            10
           /  \
          5    15
         / \    \
        3   7    20
```

That picture is a binary tree. The node `10` is the root. The node `15` has only a right child (no left). The nodes `3`, `7`, and `20` have no children at all and are called **leaves**. Notice that the structure is **self-similar**: if you cut off the subtree rooted at `5`, what you cut off is itself a binary tree (root `5`, left child `3`, right child `7`). This **recursive self-similarity** is the single most important mental model for trees. Almost every tree algorithm you will ever write is "do something at the root, then recurse on the left subtree, then recurse on the right subtree".

### Contrast with arrays and linked lists

- An **array** is one-dimensional: `[3, 5, 7, 10, 15, 20]`. To go from one element to the "next", you increment an index. There is no notion of parent or child, no branching, no hierarchy.
- A **linked list** is also one-dimensional but uses pointers instead of indices: each node has *one* `next` pointer. You can only go forward (or in a doubly-linked list, forward and back). There is still no branching.
- A **binary tree** generalizes the linked list: each node has *two* pointers (left and right). It can **branch**. This single change — from one `next` to a `left` and a `right` — gives trees their explosive expressive power. A linear list of `n` items has depth `n`. A balanced binary tree of `n` items has depth `log₂(n)`. For `n = 1,000,000` that is depth 20 instead of 1,000,000. This is why trees underlie most O(log n) data structures.

### Why does this matter in practice?

Almost every piece of structured data you touch in real software is hierarchical. A file system has folders containing folders containing folders containing files. An HTML page has a `<body>` containing `<div>`s containing `<p>`s containing `<span>`s. A function call stack has a `main` calling `parseInput` calling `tokenize` calling `consumeChar`. A 3D scene graph has a world containing rooms containing furniture containing legs. The natural way to represent all of these is a tree, and the natural way to process all of them is recursion that descends the tree.

If you cannot work with binary trees fluently, you cannot write a compiler, you cannot write an HTML parser, you cannot write a query planner, you cannot do graph algorithms (since most graph algorithms reduce to spanning-tree traversal), and you cannot understand databases. Mastering this topic is the gateway to genuine systems competence.

---

<a name="prerequisites"></a>
## 2. Prerequisites

Before this topic clicks, you should be comfortable with:

1. **Pointers / references in your language.** In Go, that means knowing that `*Node` is a pointer to a `Node` struct, that the zero value is `nil`, and that dereferencing nil panics. In Java, every object reference is implicitly a pointer; `null` is the absence of one. In Python, every variable is a reference; `None` is the absence-of-object value.

2. **Recursion.** You should be able to read a function that calls itself with a smaller input. Trees and recursion are deeply intertwined; every tree algorithm in this document is recursive (with a few iterative alternatives we present for completeness). If recursion still feels mystical, take an afternoon to practice with factorial, Fibonacci, and array sum-of-elements first.

3. **Basic Big-O.** You should know that O(n) means "time proportional to input size", O(log n) means "halving each step", and you should be able to recognize them from code.

4. **A queue (FIFO) and a stack (LIFO).** Level-order traversal uses a queue; iterative DFS uses a stack. These don't need to be from-scratch implementations — using `collections.deque` in Python, `java.util.ArrayDeque`, or a Go slice with `append` and slicing is fine. (See the `04-linked-list` and `06-sets` topics for primitive implementations if needed.)

If any of these feels shaky, revisit it before reading further; trees magnify small confusions into large ones.

---

<a name="glossary"></a>
## 3. Glossary — Root, Leaf, Depth, Height, and Friends

This vocabulary is non-negotiable. Every textbook, paper, and interviewer assumes you know it. Memorize this table.

| Term | Definition |
|---|---|
| **Node** | A single element of the tree. Contains a value and references to its children. |
| **Root** | The unique top node of the tree. Has no parent. Every non-empty tree has exactly one root. |
| **Parent** | The node directly above a given node (`P` is the parent of `C` if `C` is a child of `P`). Every node except the root has exactly one parent. |
| **Child** | The node directly below a given node. In a binary tree, at most two: **left child** and **right child**. |
| **Leaf** (a.k.a. **external node**) | A node with **no** children. The "tips" of the tree. |
| **Internal node** | A node with **at least one** child. The opposite of a leaf. |
| **Sibling** | Two nodes that share the same parent. |
| **Ancestor** | Any node on the path from `node` up to the root, inclusive of itself by convention (sometimes exclusive — be explicit). |
| **Descendant** | The mirror of ancestor: any node in the subtree rooted at `node`, inclusive of itself by convention. |
| **Subtree** | A node plus all its descendants, treated as a standalone tree. The whole tree is the subtree rooted at the root. |
| **Depth of a node** | The number of edges from the **root** down to that node. The root has depth 0. |
| **Height of a node** | The number of edges from that node down to its **deepest descendant leaf**. A leaf has height 0. Conventionally, the height of an empty tree is `-1` (so that height of a single-node tree is 0, matching depth). |
| **Height of the tree** | The height of the root. Equivalently, the maximum depth of any node. Equivalently, the length of the longest root-to-leaf path. |
| **Level** | Same as depth + 1 in some texts, same as depth in others. Always clarify. CLRS uses depth; some Indian textbooks count levels starting at 1 (root is level 1). We use **depth, starting at 0**. |
| **Path** | A sequence of nodes where each consecutive pair is connected by an edge. A **root-to-leaf path** starts at the root and ends at a leaf. |
| **Edge** | A parent-child connection. A tree with `n` nodes has exactly `n - 1` edges. |
| **Degree of a node** | The number of children it has. In a binary tree, degree is 0, 1, or 2. |
| **Full binary tree** (a.k.a. **proper** or **strict**) | Every node has either 0 or 2 children — never 1. Internal nodes are always "full". |
| **Complete binary tree** | Every level is fully filled except possibly the last, and the last level is filled from left to right. This is the shape of a binary heap. Heaps store complete trees in arrays. |
| **Perfect binary tree** | Every internal node has exactly two children **and** every leaf is at the same depth. A perfect tree of height `h` has exactly `2^(h+1) - 1` nodes. |
| **Balanced binary tree** | Loose meaning: heights of left and right subtrees of every node differ by at most some small constant (usually 1, as in AVL). Tight meaning depends on the tree variant. |
| **Degenerate tree** (a.k.a. **pathological** or **skewed**) | Each parent has only one child. Effectively a linked list. Height = n - 1. This is the worst case for any tree operation. |

### Picture them:

```
Full (every node has 0 or 2):       Complete (filled left-to-right):
        1                                    1
       / \                                  / \
      2   3                                2   3
     / \                                  / \  /
    4   5                                4  5 6

Perfect (all leaves at same depth):  Degenerate (skewed right):
        1                                    1
       / \                                    \
      2   3                                    2
     /|   |\                                    \
    4 5   6 7                                    3
                                                  \
                                                   4
```

---

<a name="core-concepts"></a>
## 4. Core Concepts — Node, Recursion, Pointers

### 4.1 The node — one struct, two pointers

A binary tree node is the simplest possible recursive data type: it stores **a value** and **two references to other nodes of the same type**.

```
struct Node:
    value      : T
    left       : pointer to Node (or null)
    right      : pointer to Node (or null)
```

That's it. The `null`s at the bottom of the tree mark "no child here". The whole tree is just nodes pointing to other nodes, with the references forming a branching downward graph.

A `null` left or right is **not** an error — it's a normal, expected value that means "this subtree is empty". Empty subtrees are how a tree "ends". Algorithmically, **every recursive tree function must handle the null case as its base case**.

### 4.2 The recursive definition

A binary tree is recursively defined:

> A binary tree is **either**:
> - the empty tree (no nodes), **or**
> - a node with a value, a left binary tree, and a right binary tree.

This definition is unbelievably useful because it gives you the structure of every tree algorithm for free:

```
function process(tree):
    if tree is empty:
        return base_case_answer
    left_answer  = process(tree.left)
    right_answer = process(tree.right)
    return combine(tree.value, left_answer, right_answer)
```

This four-line template — base case, recurse left, recurse right, combine — describes traversal, height computation, sum, max, min, mirror, serialization, deserialization, and dozens more. Once you internalize it, you can write half of LeetCode's "easy tree" problems in 30 seconds.

### 4.3 Why pointers/references?

Why not store children inline in the parent? Because tree shapes are **irregular**. One subtree might have 1 node; its sibling might have 10,000. If we stored children inline, every node would have to reserve enough room for the worst case — wasteful and rigid. Pointers let each subtree allocate just what it needs, on demand. The cost: each child access is a pointer dereference, which is *potentially* a cache miss (see `professional.md`). The benefit: arbitrary, dynamic, irregular shapes.

For **complete** binary trees (heaps), this trade reverses: because the shape is regular, we can store the tree in an array and use index arithmetic instead of pointers — see the heap topic. For ordinary binary trees with no shape guarantees, pointers are the right choice.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

Operations on a *generic* binary tree (no BST ordering, no balancing). `n` is the node count, `h` is the height.

| Operation | Time | Space |
|---|---|---|
| Traverse all nodes (any order) | O(n) | O(h) recursion stack, O(n) worst case |
| Find a value (no ordering) | O(n) — must check every node | O(h) |
| Insert a value (e.g., at next BFS slot) | O(n) to find a slot | O(h) |
| Delete an arbitrary node | O(n) | O(h) |
| Compute size (count nodes) | O(n) | O(h) |
| Compute height | O(n) | O(h) |
| Mirror / invert | O(n) | O(h) |
| Serialize | O(n) | O(n) |
| Deserialize | O(n) | O(n) |
| BFS / level-order | O(n) | O(w), where w is max width of the tree |

**Height bounds:**
- **Balanced** tree of `n` nodes: `h = ⌊log₂(n)⌋` — tight.
- **Worst case** (degenerate, skewed) tree of `n` nodes: `h = n - 1`. Recursion stack can blow up.

For a generic binary tree with no shape guarantees, every operation that needs the entire tree is O(n) — there is no shortcut. The whole point of *specialized* trees (BST, AVL, B-tree, etc.) is to add structural rules that let you skip parts of the tree, reducing operations to O(log n). That's the subject of the next topics.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 The file system

Your hard drive is a tree. `/` is the root. `/Users` is a child of `/`. `/Users/mrb` is a child of `/Users`. `/Users/mrb/Desktop/SeniorProject` is a great-grandchild of `/`. Files (`junior.md`) are leaves. Folders are internal nodes. Walking a directory recursively with `find /` is a textbook DFS. The Unix `tree` command is literally a tree printer.

The big difference from a *binary* tree: file system trees are **n-ary** — a folder can have any number of children, not just two. But conceptually it's the same. Many tree algorithms generalize from binary to n-ary by replacing "for each of left, right" with "for each child in children".

### 6.2 The HTML DOM

When your browser parses a web page, it builds a **DOM tree**. The `<html>` element is the root. Its children are `<head>` and `<body>`. Each of those has children, and so on down to `<span>`s containing text nodes (which are leaves). CSS selectors like `div > p` are queries on this tree. JavaScript's `document.querySelector` walks the tree. Chrome's Blink, Firefox's Gecko, and Safari's WebKit all maintain this tree in memory and re-paint when it changes. We cover this in detail in `senior.md`.

### 6.3 Abstract Syntax Trees (ASTs)

When the JavaScript engine V8, the TypeScript compiler `tsc`, or Babel parses your source code, it produces an **AST** — a tree representation of the program's structure. The expression `x + y * 2` becomes:

```
       (+)
       / \
      x   (*)
          / \
         y   2
```

The compiler then walks this tree to do type checking, optimization, and code generation. Every compiler and most static analyzers (ESLint, Pylint, golangci-lint) operate on ASTs. Understanding tree traversal is understanding how compilers work.

### 6.4 Family trees

Genealogy software stores ancestor and descendant relationships as trees. (Strictly speaking, family trees are **DAGs** because two distant cousins can have a common ancestor, but the "ancestor tree" of one person is a real tree if you ignore that.)

### 6.5 Decision trees

A flowchart of "if X, do A, else do B" branches like a tree. The decision-tree learning algorithm in machine learning (CART, C4.5, used inside random forests and gradient-boosted trees like XGBoost) literally builds binary trees where internal nodes are feature tests and leaves are class labels.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons

### Pros

- **Naturally hierarchical.** If your data is hierarchical, a tree is the *correct* shape, not a workaround.
- **Recursive algorithms are short and clear.** Most tree operations are 3–6 lines of code.
- **Excellent for divide-and-conquer.** A problem on a tree splits into two subproblems on each subtree.
- **Foundation for O(log n) data structures.** BST, AVL, red-black, B-tree, segment tree, Fenwick tree, trie — all built on tree concepts.
- **Memory grows on demand.** Unlike a fixed-size array, the tree allocates one node at a time.

### Cons

- **Cache-unfriendly.** Pointer chasing scatters node memory. A million-element tree can cause a million cache misses; a million-element array might cause a few thousand. Real numbers and mitigations in `professional.md`.
- **No O(1) random access.** To get the k-th node in some order, you walk part of the tree — O(k) or worse.
- **Recursive code risks stack overflow on skewed trees.** A 100,000-node skewed tree calls itself 100,000 times deep. Most language runtimes blow up before then.
- **More memory per element.** A `Node{value, left, right}` is at least 3 pointers + the value. For a tree of 64-bit ints in 64-bit Java, that's 16 bytes of header + 8 bytes value + 16 bytes for two pointers ≈ 40 bytes. The same int in an array takes 4 bytes. 10× overhead is typical.
- **Operations are O(n) without extra structure.** Plain binary trees with no ordering or balancing don't give you any asymptotic edge over a linked list for search.

The cons explain why generic binary trees are *almost never* used directly in production — you reach for a BST, heap, or trie. But you cannot understand those specialized trees without first understanding the bare binary tree.

---

<a name="walkthrough"></a>
## 8. Step-by-Step — Build a Small Tree by Hand

Let's build this tree in our head, node by node:

```
Goal:
            10
           /  \
          5    15
         / \    \
        3   7    20
```

**Step 1.** Allocate a node with value 10. Both children are null. We call this `root`.
```
root → Node{10, null, null}
```

**Step 2.** Allocate a node with value 5. Attach it as `root.left`.
```
root → Node{10, Node{5, null, null}, null}
```

**Step 3.** Allocate a node with value 15. Attach it as `root.right`.
```
root → Node{10, Node{5,_,_}, Node{15,_,_}}
```

**Step 4.** Allocate `Node{3}` and attach as `root.left.left`. Allocate `Node{7}` and attach as `root.left.right`.

**Step 5.** Allocate `Node{20}` and attach as `root.right.right`. Note: `root.right.left` stays null. That's fine — node 15 just doesn't have a left child.

Final shape, with explicit nulls written as `·`:

```
                10
              /     \
            5        15
           / \       / \
          3   7     ·   20
         /|  /|        /|
         · · · ·       · ·
```

Now let's *use* the tree: compute its size, height, and list its values in inorder.

- **Size:** Count nodes. By inspection: 10, 5, 15, 3, 7, 20 → **6 nodes**.
- **Height:** Longest root-to-leaf path counted in edges. Root → 5 → 3 has 2 edges. Root → 5 → 7 has 2. Root → 15 → 20 has 2. **Height = 2**.
- **Inorder traversal** (left, self, right): 3, 5, 7, 10, 15, 20. (Notice they come out sorted — this happens because the tree *happens* to satisfy the BST property. For a generic binary tree, inorder is just one of four orders, not necessarily sorted.)
- **Preorder** (self, left, right): 10, 5, 3, 7, 15, 20.
- **Postorder** (left, right, self): 3, 7, 5, 20, 15, 10.
- **Level-order** (BFS, top to bottom, left to right): 10, 5, 15, 3, 7, 20.

Internalize this small example. Every traversal in this document, every interview problem, every production use of trees — all of them are variations on what we just did.

---

<a name="code-examples"></a>
## 9. Code Examples — Node, Insert, Size, Height, Traversals

### 9.1 The Node struct

**Go:**
```go
package tree

// Node is a node in a binary tree of ints.
// For generic value types, use Go generics: type Node[T any] struct { ... }.
type Node struct {
    Val   int
    Left  *Node
    Right *Node
}
```

**Java:**
```java
public class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;

    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
}
```

**Python:**
```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class TreeNode:
    val: int
    left:  Optional["TreeNode"] = None
    right: Optional["TreeNode"] = None
```

These three definitions are the same idea expressed in each language: a value plus two child pointers. In Java the children default to `null` automatically; in Go they default to the zero value `nil`; in Python we explicitly default them to `None`.

### 9.2 Build the example tree by hand

**Go:**
```go
func buildExample() *Node {
    return &Node{
        Val:  10,
        Left: &Node{Val: 5,
            Left:  &Node{Val: 3},
            Right: &Node{Val: 7},
        },
        Right: &Node{Val: 15,
            Right: &Node{Val: 20},
        },
    }
}
```

**Java:**
```java
TreeNode buildExample() {
    return new TreeNode(10,
        new TreeNode(5,
            new TreeNode(3, null, null),
            new TreeNode(7, null, null)),
        new TreeNode(15,
            null,
            new TreeNode(20, null, null)));
}
```

**Python:**
```python
def build_example() -> TreeNode:
    return TreeNode(10,
        TreeNode(5, TreeNode(3), TreeNode(7)),
        TreeNode(15, None, TreeNode(20)))
```

### 9.3 Recursive size (count nodes)

The classic recursive template: base case `nil → 0`, recursive case `1 + size(left) + size(right)`.

**Go:**
```go
func Size(root *Node) int {
    if root == nil {
        return 0
    }
    return 1 + Size(root.Left) + Size(root.Right)
}
```

**Java:**
```java
public static int size(TreeNode root) {
    if (root == null) return 0;
    return 1 + size(root.left) + size(root.right);
}
```

**Python:**
```python
def size(root: Optional[TreeNode]) -> int:
    if root is None:
        return 0
    return 1 + size(root.left) + size(root.right)
```

Time O(n), space O(h) for the recursion stack.

### 9.4 Recursive height

Conventions vary: some textbooks call the height of a single node `1`, others call it `0`. We use **edges, single node = 0, empty tree = -1**. This convention is friendly to balanced-tree code (AVL etc.) because `height(node) = 1 + max(height(left), height(right))` always holds, including for the empty-child base case.

**Go:**
```go
func Height(root *Node) int {
    if root == nil {
        return -1
    }
    l := Height(root.Left)
    r := Height(root.Right)
    if l > r {
        return 1 + l
    }
    return 1 + r
}
```

**Java:**
```java
public static int height(TreeNode root) {
    if (root == null) return -1;
    return 1 + Math.max(height(root.left), height(root.right));
}
```

**Python:**
```python
def height(root: Optional[TreeNode]) -> int:
    if root is None:
        return -1
    return 1 + max(height(root.left), height(root.right))
```

### 9.5 Preorder traversal — root, left, right

**Go:**
```go
func Preorder(root *Node, visit func(int)) {
    if root == nil {
        return
    }
    visit(root.Val)
    Preorder(root.Left, visit)
    Preorder(root.Right, visit)
}
```

**Java:**
```java
public static void preorder(TreeNode root, java.util.function.IntConsumer visit) {
    if (root == null) return;
    visit.accept(root.val);
    preorder(root.left, visit);
    preorder(root.right, visit);
}
```

**Python:**
```python
def preorder(root: Optional[TreeNode], visit) -> None:
    if root is None:
        return
    visit(root.val)
    preorder(root.left, visit)
    preorder(root.right, visit)
```

On our example tree this prints `10, 5, 3, 7, 15, 20`. Preorder is used for **serialization** (write parent before children → you can reconstruct on read), **directory printing**, and **copying a tree**.

### 9.6 Inorder traversal — left, root, right

**Go:**
```go
func Inorder(root *Node, visit func(int)) {
    if root == nil {
        return
    }
    Inorder(root.Left, visit)
    visit(root.Val)
    Inorder(root.Right, visit)
}
```

**Java:**
```java
public static void inorder(TreeNode root, java.util.function.IntConsumer visit) {
    if (root == null) return;
    inorder(root.left, visit);
    visit.accept(root.val);
    inorder(root.right, visit);
}
```

**Python:**
```python
def inorder(root, visit) -> None:
    if root is None:
        return
    inorder(root.left, visit)
    visit(root.val)
    inorder(root.right, visit)
```

On our example: `3, 5, 7, 10, 15, 20`. For a **BST**, inorder yields the keys in sorted order — this is the single most useful property of BSTs and the reason "give me the next value" (`std::map::iterator::operator++`) is O(amortized 1) in C++.

### 9.7 Postorder traversal — left, right, root

**Go:**
```go
func Postorder(root *Node, visit func(int)) {
    if root == nil {
        return
    }
    Postorder(root.Left, visit)
    Postorder(root.Right, visit)
    visit(root.Val)
}
```

**Java:**
```java
public static void postorder(TreeNode root, java.util.function.IntConsumer visit) {
    if (root == null) return;
    postorder(root.left, visit);
    postorder(root.right, visit);
    visit.accept(root.val);
}
```

**Python:**
```python
def postorder(root, visit) -> None:
    if root is None:
        return
    postorder(root.left, visit)
    postorder(root.right, visit)
    visit(root.val)
```

On our example: `3, 7, 5, 20, 15, 10`. Postorder visits a parent **after** all descendants. This is the order to use when **freeing nodes** (you can't free a parent before its children, or you'd leak the children), **computing subtree aggregates** (sum, max, etc.), and **bottom-up DP on trees**.

### 9.8 Level-order traversal (BFS) — top to bottom, left to right

Unlike the three orders above, level-order is **not** naturally recursive. We use an iterative queue.

**Go:**
```go
func LevelOrder(root *Node, visit func(int)) {
    if root == nil {
        return
    }
    queue := []*Node{root}
    for len(queue) > 0 {
        n := queue[0]
        queue = queue[1:]
        visit(n.Val)
        if n.Left != nil {
            queue = append(queue, n.Left)
        }
        if n.Right != nil {
            queue = append(queue, n.Right)
        }
    }
}
```

**Java:**
```java
public static void levelOrder(TreeNode root, java.util.function.IntConsumer visit) {
    if (root == null) return;
    java.util.Deque<TreeNode> q = new java.util.ArrayDeque<>();
    q.offer(root);
    while (!q.isEmpty()) {
        TreeNode n = q.poll();
        visit.accept(n.val);
        if (n.left  != null) q.offer(n.left);
        if (n.right != null) q.offer(n.right);
    }
}
```

**Python:**
```python
from collections import deque

def level_order(root, visit) -> None:
    if root is None:
        return
    q = deque([root])
    while q:
        n = q.popleft()
        visit(n.val)
        if n.left  is not None:
            q.append(n.left)
        if n.right is not None:
            q.append(n.right)
```

On our example: `10, 5, 15, 3, 7, 20`. Level-order is what you want for **finding the shallowest node satisfying a condition** (BFS finds shortest distance from root), **printing the tree top to bottom**, and **inserting at the next available slot** (see 9.9).

### 9.9 Level-order insert — fill the tree like a heap

A common interview shape: take a list `[10, 5, 15, 3, 7, null, 20]` and build a tree by filling positions left-to-right, level by level. This is how LeetCode encodes trees in its examples.

**Go:**
```go
// Sentinel for "null" positions in the input.
// In real code, use a pointer-to-int with nil sentinel or a struct with a presence flag.
func BuildFromLevelOrder(vals []*int) *Node {
    if len(vals) == 0 || vals[0] == nil {
        return nil
    }
    root := &Node{Val: *vals[0]}
    queue := []*Node{root}
    i := 1
    for len(queue) > 0 && i < len(vals) {
        n := queue[0]
        queue = queue[1:]
        // left child
        if i < len(vals) && vals[i] != nil {
            n.Left = &Node{Val: *vals[i]}
            queue = append(queue, n.Left)
        }
        i++
        // right child
        if i < len(vals) && vals[i] != nil {
            n.Right = &Node{Val: *vals[i]}
            queue = append(queue, n.Right)
        }
        i++
    }
    return root
}
```

**Java:**
```java
public static TreeNode buildFromLevelOrder(Integer[] vals) {
    if (vals.length == 0 || vals[0] == null) return null;
    TreeNode root = new TreeNode(vals[0]);
    java.util.Deque<TreeNode> q = new java.util.ArrayDeque<>();
    q.offer(root);
    int i = 1;
    while (!q.isEmpty() && i < vals.length) {
        TreeNode n = q.poll();
        if (i < vals.length && vals[i] != null) {
            n.left = new TreeNode(vals[i]);
            q.offer(n.left);
        }
        i++;
        if (i < vals.length && vals[i] != null) {
            n.right = new TreeNode(vals[i]);
            q.offer(n.right);
        }
        i++;
    }
    return root;
}
```

**Python:**
```python
def build_from_level_order(vals: list[Optional[int]]) -> Optional[TreeNode]:
    if not vals or vals[0] is None:
        return None
    root = TreeNode(vals[0])
    q = deque([root])
    i = 1
    while q and i < len(vals):
        n = q.popleft()
        if i < len(vals) and vals[i] is not None:
            n.left = TreeNode(vals[i])
            q.append(n.left)
        i += 1
        if i < len(vals) and vals[i] is not None:
            n.right = TreeNode(vals[i])
            q.append(n.right)
        i += 1
    return root
```

Now you can build any tree from a list, the way LeetCode does in its problem statements.

---

<a name="patterns"></a>
## 10. Coding Patterns — Recursion Template and BFS with a Queue

### 10.1 The universal DFS template

```
function dfs(node):
    if node is null:                # base case
        return identity_value
    left_result  = dfs(node.left)
    right_result = dfs(node.right)
    return combine(node.value, left_result, right_result)
```

Pick the right `identity_value` and `combine`:

| Goal | identity | combine |
|---|---|---|
| Count nodes | 0 | `1 + L + R` |
| Sum of values | 0 | `node.val + L + R` |
| Height | -1 | `1 + max(L, R)` |
| Number of leaves | 0 | `1 if leaf else L + R` |
| Max value | `-∞` | `max(node.val, L, R)` |
| Check structural symmetry | true | depends — see `interview.md` |

Memorize this template. Most "easy" tree problems are a 30-second adaptation of it.

### 10.2 The BFS template

```
function bfs(root):
    if root is null: return
    queue = [root]
    while queue not empty:
        node = queue.pop_front()
        process(node)
        if node.left:  queue.push_back(node.left)
        if node.right: queue.push_back(node.right)
```

To process **level by level** (knowing which nodes belong to the same depth), record the size of the queue at the top of each iteration:

```
while queue not empty:
    levelSize = len(queue)
    for _ in range(levelSize):
        node = queue.pop_front()
        ...
    # now you've finished one whole level
```

This pattern is the core of LeetCode 102, 103, 107, 199, 314, 429, 515, 637, 662, 993, 1161, 1302, 1382. Once you see it, you see it everywhere.

### 10.3 Iterative DFS with an explicit stack

For deep trees you may want to avoid the recursion stack. Use a list/deque as a stack.

**Python iterative preorder:**
```python
def preorder_iter(root):
    if root is None:
        return
    stack = [root]
    while stack:
        n = stack.pop()
        yield n.val
        # push right first so left is processed first (LIFO)
        if n.right: stack.append(n.right)
        if n.left:  stack.append(n.left)
```

Iterative inorder and postorder are trickier (state machine with a "visited" flag, or two stacks). We cover them in `middle.md` and Morris traversal — which uses **zero extra memory** by temporarily rewiring null right pointers as **threads** back up the tree — in `middle.md` and in `tasks.md` task 8.

---

<a name="errors"></a>
## 11. Error Handling — Null Roots and Stack Overflow

### Null root

Every public tree function should treat `null` root as a valid input meaning "empty tree". Throwing an exception for a null root is almost always wrong — empty is a normal case.

```java
public int size(TreeNode root) {
    if (root == null) return 0;   // not an error — empty tree has size 0
    ...
}
```

The mistake is to write `return 1 + size(root.left.left)` somewhere, which dereferences null when `root.left` is null. **Always check before dereferencing**, or rely on the recursion to handle null at the top.

### Stack overflow on deep trees

A recursive walk on a degenerate (skewed) tree of `n` nodes calls itself `n` times deep. Runtime stack sizes are typically 1–8 MB; one Java stack frame is ~100 bytes; you can blow up around `n = 10,000–100,000`. Real systems do see this:

- **JSON.parse** in Node.js had a known crash on adversarial nested input until V8 added an iterative fallback (CVE-2017-15396 area).
- **Postgres parse trees** for absurdly nested `SELECT (SELECT (SELECT ...))` could SIGSEGV the backend; the fix is `max_stack_depth` GUC plus iterative reconstruction in some paths.
- **Linux ext4 `htree`** is a height-bounded variant precisely so the kernel never recurses deep enough to stack-overflow.

Mitigations:

1. **Iterative with an explicit stack.** You can hold a 10-MB stack data structure on the heap when you can't hold a 1-MB call stack.
2. **Convert to tail recursion** where possible. Limited in JVM/Go (no TCO); works in Scheme, OCaml, and modern Scala.
3. **Bound the recursion** via a depth counter and refuse pathological input.
4. **Increase stack size** for the thread (Java `-Xss8m`, Go `runtime.Stacks` auto-grows up to 1 GB by default), but this only buys a constant.

For interview answers, mention "I'd switch to an iterative stack-based traversal for trees of unknown depth in production". Interviewers love this.

### Other failure modes

| Error | Cause | Mitigation |
|---|---|---|
| Cycle in "tree" | Bug elsewhere created a back-pointer | DFS with a visited set; should never see the same node twice |
| Sharing a subtree | Same node referenced from two parents | Same — use visited set; in production, deep-copy on insert |
| Modifying tree during iteration | Producer thread mutating while consumer iterates | Snapshot, copy-on-write, or external locking |
| Memory leak (Java retaining tree) | A live reference to the root prevents GC of any node | `root = null` when done; weak references for caches |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Prefer iterative for production code.** Even if recursive is shorter, the iterative form avoids stack overflow and is often a bit faster (no call setup per node).

2. **Allocate from a pool / arena when building many trees.** A tree of 1 million nodes built one `new` at a time scatters across the heap and trashes the cache. An arena (see `professional.md`) packs nodes contiguously and traversals become 5–10× faster.

3. **Avoid pointless wrappers.** A `Node<Integer>` in Java pays for boxing on every `Integer`. Use a primitive `int` if you can.

4. **Cache `size` and `height` if you query them often.** Recomputing height every time is O(n). Storing it in the node and updating on insert/delete makes queries O(1) — at the cost of more code on mutation. AVL trees do this.

5. **Use level-order for "find shortest" problems.** BFS is the right tool for "fewest steps from root" — DFS often finds a longer path first.

6. **Pre-allocate the BFS queue's backing array** if you know the tree's max width. `ArrayDeque<>(expectedCapacity)` in Java saves repeated resizes.

7. **Watch out for accidentally O(n²) recursion.** Computing `isBalanced` naively recomputes height inside `isBalanced(left)` and `isBalanced(right)` — call it once per node and return both pieces of info as a pair. Pattern in `interview.md`.

8. **For read-heavy trees, consider an array layout.** A complete binary tree fits in an array (`left = 2i+1`, `right = 2i+2`). No pointers means cache-friendly traversal. This is how heaps and segment trees achieve their famous constant-factor speed.

---

<a name="best-practices"></a>
## 13. Best Practices

- **One canonical traversal direction per file.** Mixing preorder and postorder in the same module confuses readers.
- **Document height/depth conventions.** "Single-node tree: height 0 or 1?" Choose one explicitly. We use `single-node height = 0`, `empty = -1`.
- **Treat null as a valid empty tree** in every public function. Don't throw.
- **Avoid parent pointers unless you need them.** They double memory per node, add bookkeeping on every insert/delete, and trap GC in cyclic-reference scenarios in some languages. Add them only for specific operations like "successor by inorder".
- **Encapsulate the tree in a struct/class** when the tree owns invariants. `TreeOfInts.insert(x)` is better than asking the caller to walk and link nodes.
- **Test on degenerate trees.** Code that works on the example "balanced" tree often blows up on a 100,000-deep skewed one. Always include a skewed test case.
- **Don't share subtrees** by accident. Pointer aliasing leads to use-after-free or invalidated iterators.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Concrete tree | Expected behavior |
|---|---|---|
| Empty tree | `nil` | size=0, height=-1, all traversals output nothing |
| Single node | `Node{42}` | size=1, height=0, all 4 traversals output `42` |
| Left-skewed (linked list down-left) | 1→2→3 via left only | height=2, recursion depth=3, beware stack |
| Right-skewed | 1→2→3 via right only | same as above mirrored |
| Only-left tree at level 2 | root, left only at depth 1, deeper still only left | height = depth of deepest leaf |
| Tree with negative values | Node{-5}, etc. | size/height/traversals unchanged; max-sum problems must initialize with -∞ |
| Tree with duplicate values | Two nodes both value 7 | structurally distinct, both visited |
| Pathological 100k deep | bench skewed input | iterative or increased stack required |
| Tree with one giant subtree | left subtree has 99% of nodes | BFS queue grows to width of widest level |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Forgetting the null base case.** `1 + size(root.left) + size(root.right)` without `if root == nil return 0` infinitely recurses or null-derefs. **Always handle null first.**

2. **Confusing depth and height.** Depth grows downward (root = 0). Height grows upward (leaf = 0). They are not the same number except for single-node trees. Confusing them gives off-by-one errors in balanced-tree algorithms.

3. **Wrong traversal order for the semantics you want.** "Print the tree" usually means preorder. "Sort the BST" requires inorder. "Free / aggregate / fold" needs postorder. Using inorder when you needed postorder is a silent bug — the code runs, the output is just wrong.

4. **Returning the wrong thing from a recursive helper.** A height function returns `1 + max(...)`, not `max(...)`. A sum function returns `node.val + left + right`, not just `left + right`. Re-derive the recurrence each time.

5. **Mutating the tree while iterating with BFS.** Adding nodes during iteration can confuse the queue. Take a snapshot or finish the traversal first.

6. **Using `==` on tree references when you meant value equality.** Two distinct nodes with the same value are unequal by identity. For "are these trees the same?" you need recursive structural equality (LeetCode 100).

7. **Counting edges where you should count nodes (or vice versa).** Height in edges vs height in nodes is a +1 difference. Pick one.

8. **Forgetting parents when you needed them.** "Find LCA" with no parent pointers requires a recursive search; with parent pointers, it's a two-list intersection. Decide up-front whether you need parent pointers — adding them later is invasive.

9. **Recursive deletion order bug.** Freeing a parent before its children leaks the children. Postorder, not preorder, frees memory correctly. (Languages with GC hide this — but it shows up in C/C++ instantly.)

10. **`stack` vs `queue` confusion in iterative traversal.** Use a *queue* for level-order, a *stack* for DFS. Mixing them gives a wrong order silently.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
NODE
    struct Node { val; left *Node; right *Node }

DEFINITION
    A binary tree is either empty, OR a node with a value, a left tree, and a right tree.

UNIVERSAL DFS TEMPLATE
    f(node):
        if node == null: return identity
        L = f(node.left)
        R = f(node.right)
        return combine(node.val, L, R)

SIZE       identity=0,  combine = 1 + L + R
HEIGHT     identity=-1, combine = 1 + max(L, R)
SUM        identity=0,  combine = val + L + R

TRAVERSAL ORDERS
    Preorder   self → L → R           use for: serialize, copy, print
    Inorder    L → self → R           use for: BST sorted output
    Postorder  L → R → self           use for: free, aggregate, bottom-up DP
    Level      BFS with queue         use for: shortest distance, level grouping

BFS
    q = [root]; while q: n=q.pop_front(); visit(n);
                if n.left: q.push(n.left); if n.right: q.push(n.right)

DEPTH vs HEIGHT
    depth(root)=0, increases downward
    height(leaf)=0, increases upward, height(empty)=-1

COMPLEXITY (generic binary tree, n nodes, height h)
    traverse:  O(n) time, O(h) stack
    height of balanced tree: log₂(n)
    height of degenerate tree: n - 1
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders a binary tree as an SVG with circles for nodes and lines for edges. You can paste a level-order array like `1,2,3,null,4,5,6` to build any tree, pick a traversal mode (Preorder, Inorder, Postorder, Level-order), and watch the algorithm walk the tree node by node. The currently visited node is yellow; visited nodes are green with a numeric order label showing the visit sequence; pending nodes in the BFS queue or DFS stack are listed on the side. A speed slider, Step button, and Reset let you control the pace.

Watching DFS preorder versus DFS inorder on the same tree is the single fastest way to internalize why the four orders give different sequences. Spend 10 minutes with the animation — it's worth more than 10 pages of code.

---

<a name="summary"></a>
## 18. Summary

- A **binary tree** is a recursive structure of nodes, each with a value and up to two child pointers (left and right). The top is the **root**; the empty children at the bottom are `null`.
- A tree is **either empty or a node with two subtrees**. This recursive definition gives a universal **DFS template** that solves most tree problems in a few lines.
- The four traversals: **preorder** (root, left, right — serialize/print), **inorder** (left, root, right — sorted on BSTs), **postorder** (left, right, root — free/aggregate), **level-order** (BFS top-down — shortest distance).
- Time for any full-tree operation: **O(n)**. Space for recursion: **O(h)** — `log n` for balanced, `n` for skewed.
- **Depth** starts at 0 from the root; **height** starts at 0 from a leaf; empty tree has height -1.
- Watch out for: null base case (always handle), stack overflow on skewed trees (consider iterative), confusing depth vs height, wrong traversal order for the semantics.
- Generic binary trees are not used much in production directly — they are the **foundation** that BSTs, heaps, AVLs, B-trees, tries, segment trees, and the rest of the trees roadmap are built on. Master this and the rest will come easy.

Walk every example in this document by hand on paper, code the size/height/traversals from scratch in your language of choice, and run the animation. Then you are ready for BSTs.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Knuth**, *The Art of Computer Programming, Volume 1: Fundamental Algorithms*, §2.3 "Trees" (1968, 3rd ed. 1997). The definitive treatment. Defines all the terminology used to this day. §2.3.1 covers traversals; §2.3.4 covers mathematical properties.
- **Cormen, Leiserson, Rivest, Stein (CLRS)**, *Introduction to Algorithms*, 4th ed. (2022), Chapter 10 ("Elementary Data Structures") for the basic representation; Chapter 12 ("Binary Search Trees") for the next step.
- **Sedgewick & Wayne**, *Algorithms*, 4th ed. (2011), §3.2 "Binary Search Trees". The classic Java treatment with excellent visualizations.
- **Aho, Hopcroft, Ullman**, *Data Structures and Algorithms* (1983). The classic Bell Labs textbook — terse but precise on tree definitions.
- **Goodrich, Tamassia, Mount**, *Data Structures and Algorithms in Java/Python*. Friendlier than CLRS for the first read.
- **LeetCode** — "Tree" tag. Start with 104, 100, 101, 226, 543, then move to 102, 297, 236, 105, 124. We work through these in `interview.md`.
- Continue with `middle.md` for iterative traversals, Morris traversal, serialization, LCA, tree DP, and reconstruction from preorder+inorder. Then `02-bst` for the binary search tree property and its applications.
