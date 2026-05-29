# Introduction to Data Structures & Algorithms — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [What is a Data Structure?](#what-is-a-data-structure)
3. [What is an Algorithm?](#what-is-an-algorithm)
4. [Why DSA Matters](#why-dsa-matters)
5. [A Concrete Motivating Example](#a-concrete-motivating-example)
6. [The DSA Mindset](#the-dsa-mindset)
7. [How a Problem Becomes a Data Structure Choice](#how-a-problem-becomes-a-data-structure-choice)
8. [Common Data Structures at a Glance](#common-data-structures-at-a-glance)
9. [Common Algorithms at a Glance](#common-algorithms-at-a-glance)
10. [Big-O Notation in One Page](#big-o-notation-in-one-page)
11. [How to Read This Roadmap](#how-to-read-this-roadmap)
12. [How to Study DSA Effectively](#how-to-study-dsa-effectively)
13. [Code Examples — Same Problem, Three Solutions](#code-examples--same-problem-three-solutions)
14. [DSA in Real Software You Use Every Day](#dsa-in-real-software-you-use-every-day)
15. [Beginner Pitfalls](#beginner-pitfalls)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: "What is DSA?" and "Why should I care?"

Data Structures and Algorithms (DSA) is the discipline of **organizing data and writing procedures over that data so a computer can solve problems efficiently**. It sits at the intersection of mathematics and software engineering: the math tells you what is possible, and the engineering tells you what is practical on real hardware running real workloads.

This is the first document of the roadmap. By the time you finish reading it you should be able to answer four questions in your own words:

1. What is a data structure, and what is an algorithm?
2. Why is the right choice of structure usually more important than fast code?
3. How does Big-O notation let us compare two algorithms without running them?
4. What is the path through this roadmap, and how should I study?

No prior algorithms background is assumed. You only need basic programming knowledge: variables, loops, functions, arrays, and the ability to read short snippets in Go, Java, or Python.

---

## What is a Data Structure?

A **data structure** is a deliberate way of arranging data in a computer's memory so that specific operations on that data are fast and correct. Two parts matter:

- **Layout.** How is the data physically stored — one block in memory, scattered with pointers, in a tree shape, in a hash bucket?
- **Operations.** Which questions can you ask quickly — "give me the i-th element", "is X in the set", "what is the smallest item right now"?

Every data structure is a trade. You spend memory or insertion time in exchange for fast lookups. You spend lookup time in exchange for cheap inserts. There is no universal winner — only structures that fit a particular access pattern.

### A Helpful Definition

> A data structure is a logical model of how data is organized so that a chosen set of operations can be implemented with predictable cost in time and memory.

### Examples in One Sentence Each

| Structure | What it stores | Strongest operation |
|---|---|---|
| **Array** | Fixed-size contiguous block of values | Read at index `i` in O(1) |
| **Linked list** | Nodes connected by `next` pointers | Insert at the head in O(1) |
| **Stack** | A pile where only the top is reachable | Last-in / first-out (LIFO) push and pop in O(1) |
| **Queue** | A line where the front leaves first | First-in / first-out (FIFO) enqueue and dequeue in O(1) |
| **Hash table** | Key → value lookups by hashing | Insert / lookup / delete in O(1) average |
| **Tree** | Hierarchical parent → children relationships | Search by key in O(log n) when balanced |
| **Graph** | Vertices connected by edges | Model relationships (friends, roads, dependencies) |

These are not the only structures, but they are the vocabulary every programmer eventually learns.

---

## What is an Algorithm?

An **algorithm** is a finite, unambiguous procedure that transforms input into output. It is a recipe: a fixed sequence of well-defined steps that always terminates and always produces the correct answer for valid inputs.

A useful algorithm has five properties:

1. **Input.** Zero or more well-defined inputs.
2. **Output.** At least one well-defined output.
3. **Definiteness.** Each step is precise and unambiguous.
4. **Finiteness.** The procedure terminates after a finite number of steps.
5. **Effectiveness.** Each step is simple enough to be carried out exactly.

### Data Structures vs Algorithms

| | Data structure | Algorithm |
|---|---|---|
| Concerned with | **Where** data lives | **What** to do with data |
| Example | Hash table | Binary search |
| Lifetime | Persistent across operations | A single procedure invocation |
| Measured by | Memory used + cost of operations | Time and memory consumed by one run |

They are inseparable: an algorithm only makes sense in the context of how its data is stored, and a data structure is only useful because algorithms can act on it.

---

## Why DSA Matters

A short answer: **the right data structure can turn an impossible task into an instant one.**

Suppose you must answer the question "Is this username taken?" on a website with 100 million users.

- A naive list scan looks at every record — about 100,000,000 comparisons per request.
- A hash table jumps straight to the bucket — about **1** comparison per request.

For a single user this is irrelevant. For a million concurrent sign-ups this is the difference between a working service and a crashed one. DSA is the discipline that lets you tell, **before you write any code**, which approach will survive contact with production scale.

A longer answer:

- **Performance.** Algorithm choice can change a 10-hour computation into a 10-millisecond computation. No amount of "fast code" recovers from an algorithm that is fundamentally too slow.
- **Correctness.** Some bugs are not careless typos — they are the wrong data structure (a list where a set was needed, a queue where a stack was needed). Picking the right structure prevents whole classes of bugs.
- **Communication.** Talking about a system at the level of *"a write-through cache backed by an LSM tree"* is faster than talking about loops and arrays. DSA is the shared vocabulary of software engineers.
- **Interviews.** Every major tech company tests DSA. The reason is not nostalgia — it is the cheapest available signal that a candidate can reason about cost and structure under pressure.
- **System design.** Caches, databases, file systems, compilers, browsers, networks — every interesting piece of software is built out of data structures and algorithms that someone deliberately chose.

---

## A Concrete Motivating Example

You are given a list of integers and must answer many queries of the form "is `x` in the list?".

### Approach 1 — Linear scan

For each query, walk through the list and compare. Cost per query: **O(n)**.

For 1,000,000 numbers and 1,000,000 queries: about 10¹² comparisons. On a typical laptop this is **minutes to hours**.

### Approach 2 — Sort once, then binary search

Sort the list one time (O(n log n)). For each query, repeatedly halve the search range. Cost per query: **O(log n)**.

For 1,000,000 numbers and 1,000,000 queries: about 1,000,000 × 20 ≈ 2 × 10⁷ comparisons. **Under a second**.

### Approach 3 — Insert into a hash set

Build a hash set in O(n) time. Each query is **O(1)** average.

Total: about 2,000,000 hash operations. **Tens of milliseconds.**

Same problem, same hardware. The difference is which **data structure** holds the input and which **algorithm** answers the query. That is what DSA is.

| Approach | Build | Per query | 1M numbers, 1M queries |
|---|---|---|---|
| Linear scan | 0 | O(n) | ~hours |
| Sorted array + binary search | O(n log n) | O(log n) | < 1 second |
| Hash set | O(n) | O(1) avg | tens of ms |

---

## The DSA Mindset

Before any code, an engineer who has internalized DSA asks four questions:

1. **What is the input?** Size, shape, ordering, value range, mutability.
2. **What operations must be fast?** Reads vs writes? Lookups vs scans? Updates in the middle?
3. **What are the constraints?** Memory, latency, distribution, concurrency, persistence.
4. **What is the price I am willing to pay?** Extra memory, slower writes, an offline rebuild, weaker consistency.

The data structure falls out of the answers. You do not memorize which structure to use — you derive it from the access pattern.

### "Choosing the structure" is the design decision

A senior engineer rarely writes a tree from scratch. What they do every day is **pick** the structure: "this should be a deque, not a list"; "this is a set, not a list of unique items"; "this needs to be a min-heap, not a sorted slice". The implementations are in the standard library. The judgement is in choosing.

---

## How a Problem Becomes a Data Structure Choice

A short worked example for each access pattern.

| Problem | Access pattern | Right structure |
|---|---|---|
| Undo / redo in a text editor | Last action reverts first | **Stack** |
| Print jobs in order received | First job in is first job out | **Queue** |
| Username uniqueness check | "is this string already taken?" | **Hash set** |
| Spell checker — fast prefix lookup | "are there words starting with `cat`?" | **Trie** |
| Friend-of-friend on a social graph | Reach all vertices within k edges | **Graph + BFS** |
| Find the smallest pending task | "give me the minimum right now" | **Heap (priority queue)** |
| Range queries — "sum of array between i and j" | Many overlapping ranges | **Prefix-sum array** |
| Track an ordered history of 10 most recent items | Bounded FIFO | **Ring buffer / deque** |
| Detect duplicate emails in a 100 GB log | "have I seen this before, approximately?" | **Bloom filter** |
| Lookup of country by IP address | "which range does this number fall into?" | **Interval tree / sorted ranges** |

You will recognize most of these patterns after one careful pass through this roadmap.

---

## Common Data Structures at a Glance

The roadmap covers each of these in depth. At this stage you only need a one-line mental model.

| Structure | Mental model | Strength |
|---|---|---|
| **Array** | A row of labeled boxes | Random access by index |
| **Linked list** | A chain of nodes, each pointing to the next | Cheap insert/remove at known points |
| **Stack** | A stack of plates — only the top is reachable | LIFO order |
| **Queue** | A line at the cashier — first come, first served | FIFO order |
| **Deque** | A line you can join from either end | Double-ended queue |
| **Hash table** | A coatroom where each ticket points to a coat | Average O(1) lookup |
| **Set** | A bag that refuses duplicates | Membership tests |
| **Map / dictionary** | Keys that resolve to values | Lookup by name, not position |
| **Tree** | A family tree | Hierarchy and ordered lookups |
| **Heap** | A tree where the root is the smallest (or largest) | Fast "give me the minimum" |
| **Graph** | A network of nodes and edges | Relationships and paths |
| **Trie** | A tree where edges are letters | Prefix-based search |

We will spend an entire roadmap section on most of these.

---

## Common Algorithms at a Glance

| Algorithm | What it does | Typical cost |
|---|---|---|
| **Linear search** | Walk the data looking for `x` | O(n) |
| **Binary search** | Halve the search range until found | O(log n) on sorted data |
| **Sorting (merge / quick / heap)** | Arrange data in order | O(n log n) |
| **BFS** | Explore a graph in layers | O(V + E) |
| **DFS** | Explore a graph as deep as possible first | O(V + E) |
| **Dijkstra** | Shortest path on a weighted graph | O((V + E) log V) |
| **Dynamic programming** | Solve problems by reusing answers to subproblems | Problem-specific |
| **Greedy** | Make locally optimal choices and hope they add up | Problem-specific |
| **Divide and conquer** | Split, solve, combine | Often O(n log n) |
| **Hashing** | Map a key to a fixed-size slot | O(1) average |

The roadmap dedicates a section to each family.

---

## Big-O Notation in One Page

Big-O notation describes **how the cost of an algorithm grows as the input grows**. You will spend an entire section on it later — this is the working summary for now.

### Mental model

If your input has size `n`, Big-O answers the question: **roughly, how many operations do I need?**

```text
O(1)         — constant.       Hash lookup, array index.
O(log n)     — logarithmic.    Binary search, balanced tree lookup.
O(n)         — linear.         Walk the array once.
O(n log n)   — linearithmic.   Efficient sorts (merge, heap, quick).
O(n²)        — quadratic.      Nested loops; naive sorts.
O(2ⁿ)        — exponential.    Brute-force subset enumeration.
O(n!)        — factorial.      All permutations (the travelling salesman, naively).
```

### How the costs really compare

| n | O(log n) | O(n) | O(n log n) | O(n²) | O(2ⁿ) |
|---|---|---|---|---|---|
| 10 | ~3 | 10 | ~33 | 100 | 1,024 |
| 100 | ~7 | 100 | ~664 | 10,000 | ≈ 10³⁰ |
| 1,000 | ~10 | 1,000 | ~10,000 | 1,000,000 | astronomical |
| 1,000,000 | ~20 | 1,000,000 | ~20,000,000 | 10¹² (~hours) | unrunnable |

**Read this table once.** It is the entire reason an O(n) algorithm and an O(n²) algorithm look different in production at scale.

### Three working rules

1. **Drop constants.** `5n` and `n` are both O(n).
2. **Keep the dominant term.** `n² + n` is O(n²), because for large `n` the smaller term is negligible.
3. **Big-O describes the worst case unless stated otherwise.** Average and best cases get their own notation (Θ and Ω) — we cover them in section 6.

---

## How to Read This Roadmap

The folder you are sitting in is organized into 22 numbered sections. Each section contains topics, and each topic contains six files plus, for algorithm/data-structure topics, an interactive `animation.html`.

```
datastructures-and-algorithms/
├── 01-introduction-to-dsa/          ← you are here
├── 02-programming-fundamentals/     ← brush up syntax, OOP, control flow
├── 03-what-are-data-structures/
├── 04-why-are-data-structures-important/
├── 05-basic-data-structures/        ← array, linked list, queue, stack, hash, ...
├── 06-algorithmic-complexity/       ← Big-O properly
├── 07-sorting-algorithms/
├── 08-search-algorithms/
├── 09-trees/  10-heaps/  11-graphs/ ...
└── README.md                        ← master index of every topic
```

### Each topic has six files, sometimes seven

| File | Audience | Use it when |
|---|---|---|
| `junior.md` | First-timer | You have never seen the topic. Start here. |
| `middle.md` | Mid-level engineer | You want the trade-offs and edge cases. |
| `senior.md` | Senior engineer | You are deciding which structure to use in a system. |
| `professional.md` | Researcher / staff | You need formal proofs, amortized analysis, tight bounds. |
| `interview.md` | Candidate | You have an interview next week. |
| `tasks.md` | Practitioner | You want hands-on problems in Go / Java / Python. |
| `animation.html` | Visual learner | You want to *see* the structure move. |

> Code samples are always given in **Go, Java, and Python** in that order.

### Suggested order

If you are completely new: read `01-introduction-to-dsa` → `02-programming-fundamentals` → `03-what-are-data-structures` → `04-why-are-data-structures-important` → `05-basic-data-structures` → `06-algorithmic-complexity` in order. After that you can branch by interest.

If you are preparing for interviews: read this file, then `06-algorithmic-complexity`, then jump straight into `05`, `07`, `08`, `09`, `11`, `13`, `17` (basic structures → sorting → search → trees → graphs → DP → strings) and practice from each `tasks.md`.

---

## How to Study DSA Effectively

DSA rewards a particular learning style. The advice below is concentrated experience.

### 1. Implement, do not just read

You cannot truly learn a stack by reading. Write a stack from scratch — once in Go, once in Java, once in Python. The act of typing out the indices and pointers is what builds the mental model.

### 2. Solve the same problem more than once

A typical learner sees a problem, struggles, eventually solves it, then never returns. A successful learner re-solves the same problem a week later **without looking** at their previous solution. The second time is when it becomes muscle memory.

### 3. Re-derive the complexity yourself

Every time you write an algorithm, **before** you check the answer, ask: "What is the Big-O?" Then verify. After fifty problems, this becomes automatic.

### 4. Read other people's solutions

After you solve a problem, read two or three other solutions. You will routinely find a one-line tighter trick you missed.

### 5. Space your repetition

Schedule a 15-minute review block once a week. Re-read your own past notes; re-solve one old problem; explain one topic out loud to an empty room. Spaced repetition turns short-term learning into long-term knowledge.

### 6. Use the visual animations

Every algorithm/data-structure topic in this roadmap has an `animation.html`. Open it. Move slowly through the steps. Watching a binary search shrink the search range is worth ten paragraphs of text.

### 7. Do not skip the easy material

Arrays and linked lists are the foundation of everything else. Senior engineers fail interviews not on red-black trees but on off-by-one bugs in array problems. Practice the basics until they are boring.

---

## Code Examples — Same Problem, Three Solutions

Find the first duplicate in an array. Three approaches, increasing in cleverness. Each is shown in all three languages.

### Approach A — Brute force (O(n²))

#### Go

```go
package main

import "fmt"

func firstDuplicateBrute(arr []int) int {
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i] == arr[j] {
                return arr[i]
            }
        }
    }
    return -1
}

func main() {
    fmt.Println(firstDuplicateBrute([]int{3, 1, 4, 1, 5, 9, 2, 6}))
}
```

#### Java

```java
public class FirstDuplicateBrute {
    public static int firstDuplicate(int[] arr) {
        for (int i = 0; i < arr.length; i++) {
            for (int j = i + 1; j < arr.length; j++) {
                if (arr[i] == arr[j]) return arr[i];
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(firstDuplicate(new int[]{3, 1, 4, 1, 5, 9, 2, 6}));
    }
}
```

#### Python

```python
def first_duplicate_brute(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return arr[i]
    return -1

if __name__ == "__main__":
    print(first_duplicate_brute([3, 1, 4, 1, 5, 9, 2, 6]))
```

### Approach B — Sort, then scan adjacent pairs (O(n log n))

#### Go

```go
package main

import (
    "fmt"
    "sort"
)

func firstDuplicateSort(arr []int) int {
    cp := append([]int(nil), arr...)
    sort.Ints(cp)
    for i := 1; i < len(cp); i++ {
        if cp[i] == cp[i-1] {
            return cp[i]
        }
    }
    return -1
}

func main() {
    fmt.Println(firstDuplicateSort([]int{3, 1, 4, 1, 5, 9, 2, 6}))
}
```

#### Java

```java
import java.util.Arrays;

public class FirstDuplicateSort {
    public static int firstDuplicate(int[] arr) {
        int[] cp = arr.clone();
        Arrays.sort(cp);
        for (int i = 1; i < cp.length; i++) {
            if (cp[i] == cp[i - 1]) return cp[i];
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(firstDuplicate(new int[]{3, 1, 4, 1, 5, 9, 2, 6}));
    }
}
```

#### Python

```python
def first_duplicate_sort(arr):
    s = sorted(arr)
    for i in range(1, len(s)):
        if s[i] == s[i - 1]:
            return s[i]
    return -1

if __name__ == "__main__":
    print(first_duplicate_sort([3, 1, 4, 1, 5, 9, 2, 6]))
```

### Approach C — Hash set (O(n))

#### Go

```go
package main

import "fmt"

func firstDuplicateHash(arr []int) int {
    seen := map[int]struct{}{}
    for _, v := range arr {
        if _, ok := seen[v]; ok {
            return v
        }
        seen[v] = struct{}{}
    }
    return -1
}

func main() {
    fmt.Println(firstDuplicateHash([]int{3, 1, 4, 1, 5, 9, 2, 6}))
}
```

#### Java

```java
import java.util.HashSet;

public class FirstDuplicateHash {
    public static int firstDuplicate(int[] arr) {
        HashSet<Integer> seen = new HashSet<>();
        for (int v : arr) {
            if (!seen.add(v)) return v;
        }
        return -1;
    }

    public static void main(String[] args) {
        System.out.println(firstDuplicate(new int[]{3, 1, 4, 1, 5, 9, 2, 6}));
    }
}
```

#### Python

```python
def first_duplicate_hash(arr):
    seen = set()
    for v in arr:
        if v in seen:
            return v
        seen.add(v)
    return -1

if __name__ == "__main__":
    print(first_duplicate_hash([3, 1, 4, 1, 5, 9, 2, 6]))
```

### Compare the three

| Approach | Time | Space | When you would actually use it |
|---|---|---|---|
| Brute force | O(n²) | O(1) | Tiny inputs only |
| Sort + scan | O(n log n) | O(n) (or O(1) if mutation allowed) | If you cannot allocate a hash set |
| Hash set | O(n) avg | O(n) | The default for almost all real cases |

This single example contains in miniature **everything DSA is about**: the same problem has many correct solutions; the choice of data structure changes the cost; engineers earn their salary by picking the right one.

---

## DSA in Real Software You Use Every Day

| You touched today | The DSA underneath |
|---|---|
| Browser back button | Stack of visited URLs |
| Phone contacts list | Sorted array or B-tree |
| Search autocomplete | Trie + ranking heap |
| Spotify "next up" queue | Queue |
| GPS directions | Dijkstra / A* over a road graph |
| Spell checker | Trie + edit-distance DP |
| Photo gallery thumbnails | LRU cache |
| Git history | Merkle DAG (directed acyclic graph) |
| Filesystem | Tree of inodes |
| Database query | B+ tree index + hash join + query plan tree |
| TCP / IP routing | Trie (CIDR longest-prefix match) |
| Spam folder | Bloom filter + classifier |

None of these were "academic". Every one is a real engineering trade-off that some team made.

---

## Beginner Pitfalls

- **Reading instead of coding.** You will forget any topic you only read about. Implement it once.
- **Memorizing without understanding.** Memorized code falls apart at the first variation of the problem. Understand the invariant the structure preserves, and the code follows.
- **Skipping Big-O.** "It worked on my laptop" is not an answer. Until you can state the complexity of your code, you do not understand it yet.
- **Choosing a structure before stating the access pattern.** The pattern decides the structure, not the other way around.
- **Writing tree / graph code without drawing.** Draw the structure on paper or a whiteboard before touching the keyboard. Five minutes of drawing saves an hour of debugging.
- **Confusing "fast in Python" with "good algorithm".** A `dict` lookup feels free. It is O(1) average — and O(n) worst case under adversarial input. Knowing the difference is the entire point of DSA.

---

## Cheat Sheet

```text
Data structure        = how data is laid out + which operations are cheap
Algorithm             = a finite, unambiguous, terminating procedure
Big-O                 = how cost grows with input size (worst case)

Default toolkit:
  Need O(1) lookup by key             → hash map
  Need ordered iteration / range      → balanced tree / sorted array
  Need FIFO                           → queue (deque, channel)
  Need LIFO                           → stack
  Need "smallest pending"             → min-heap
  Need duplicate detection            → hash set
  Need prefix lookup                  → trie

Approach to any problem:
  1. State input shape and size.
  2. State the operations you need fast.
  3. Pick the structure whose strengths match those operations.
  4. Estimate Big-O before coding.
  5. Code, test edge cases (empty, single, duplicate, sorted, reversed).
  6. Reread, measure, revise.
```

---

## Summary

Data Structures and Algorithms is the discipline of choosing **how data is organized** and **what procedure runs over it** so that a program is fast, correct, and clear. The same problem can be solved in many ways; DSA gives you the vocabulary and the math to pick the right one before you write a line of code.

The rest of this roadmap takes you through the building blocks (arrays, lists, stacks, queues, hash tables), the measuring stick (Big-O and complexity), the workhorse algorithms (sorting, searching, graph traversal, dynamic programming), and the senior-level concerns (system design, distributed structures, formal correctness). At every level the same three skills compound: implement it yourself, state the complexity, and choose the structure from the access pattern.

Take it slowly, code along, and revisit. DSA rewards the patient student more than the clever one.

---

## Further Reading

- *Introduction to Algorithms* (Cormen, Leiserson, Rivest, Stein — "CLRS") — the standard reference, Chapter 1 covers exactly the material above.
- *The Algorithm Design Manual* (Steven Skiena) — friendlier, more practical, full of war stories.
- *Algorithms* (Robert Sedgewick & Kevin Wayne) — paired with the excellent free online course (Coursera).
- *Grokking Algorithms* (Aditya Bhargava) — illustrated and beginner-friendly; complements this roadmap well for the first few sections.
- [visualgo.net](https://visualgo.net) — interactive animations of nearly every classical structure and algorithm.
- [cp-algorithms.com](https://cp-algorithms.com) — competitive-programming reference, deeper than this roadmap and excellent for senior topics.
- Go standard library: `container/list`, `container/heap`, `sort` packages.
- Java standard library: `java.util.*` (Collections, Map, Queue, PriorityQueue, TreeMap).
- Python standard library: `collections`, `heapq`, `bisect`, `array`.
