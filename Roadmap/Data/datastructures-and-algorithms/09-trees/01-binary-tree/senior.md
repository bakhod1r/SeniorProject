# Binary Tree — Senior Level

> **Audience:** Engineers who already know traversals, serdes, LCA, and tree DP, and want to see where binary trees actually live in real production systems. Prerequisites: `junior.md`, `middle.md`.

The previous documents treat binary trees as an algorithmic toy. This one shows the **load-bearing systems** that depend on them: how a browser parses HTML into a DOM tree, how a compiler builds an AST and an IR, how a file system represents directories with inode trees, how Java's `HashMap` quietly turns into a tree when collisions get bad, how Merkle trees underpin Git and Bitcoin, and how database query planners build trees of `Plan` nodes that the executor walks. Reading the actual source of one of these systems is the fastest way to graduate from "I can solve LeetCode tree problems" to "I understand the systems that run the world".

---

## Table of Contents

1. [The HTML DOM in Blink and WebKit](#dom)
2. [ASTs and IRs in Compilers (LLVM, GCC, Babel, TypeScript)](#ast)
3. [File System Inode Trees (ext4, btrfs)](#fs)
4. [Java HashMap Treeification (since JDK 8)](#hashmap)
5. [Database Query Plan Trees (Postgres, MySQL)](#queryplan)
6. [Merkle Trees — Git, Bitcoin, Cassandra, IPFS](#merkle)
7. [Cache-Unfriendliness and the Pointer-Chasing Problem](#cache)
8. [Tree Iterators in Real APIs](#iterators)

---

<a name="dom"></a>
## 1. The HTML DOM in Blink and WebKit

When Chrome's Blink engine receives an HTML byte stream, it builds the **DOM tree**. Every element (`<html>`, `<head>`, `<body>`, `<div>`, `<p>`, text node, comment node) is a `Node` in C++ inheriting from `Node`, with `firstChild`, `lastChild`, `previousSibling`, `nextSibling`, `parentNode` pointers — strictly speaking an **n-ary tree** (an element can have any number of children), but each level is a doubly-linked list of siblings, so it's a *binary* representation in memory ("left child, right sibling"), which is the classical n-ary-to-binary conversion (Knuth TAOCP v1 §2.3.2).

The DOM lives in C++ in `third_party/blink/renderer/core/dom/node.h` (Blink) or `Source/WebCore/dom/Node.h` (WebKit). When JavaScript calls `document.querySelector('div.foo')`, Blink walks the tree in DFS order matching the selector. When the layout engine paints, it traverses the **render tree** (a parallel tree that drops invisible nodes and merges generated content) in another DFS. The browser does these tree walks **hundreds of times per second** during animations. Optimizing tree-walk performance is a permanent engineering effort at every browser team.

**Practical consequences for you:**

- The cost of `document.getElementsByClassName('x')` on a 100,000-node DOM is the cost of a tree walk — O(n). If you call it in a loop, you've quietly written O(n²).
- Frameworks like React build a **virtual DOM tree** in JS, diff it against the previous tree (LeetCode 100 + LCA pattern + keyed reconciliation), and apply minimal mutations. The "diff two trees" algorithm at React's heart is a classic CS tree problem.
- `MutationObserver` lets you subscribe to subtree changes. Internally, the browser walks the subtree once on registration to set up dirty-tracking flags.

If you read one source file from this section, read Blink's `node.cc` and `element.cc`.

---

<a name="ast"></a>
## 2. ASTs and IRs in Compilers (LLVM, GCC, Babel, TypeScript)

Every modern compiler builds at least one tree from source code.

### 2.1 Babel and Acorn (JavaScript)

The standard JavaScript AST format is **ESTree**, an open spec. Acorn (used by Webpack, Rollup, and originally Babel) emits ESTree nodes with `type`, `start`, `end`, and child fields. Babel plugins walk the tree with `@babel/traverse`, which is a generic visitor pattern over ESTree. Every Babel transform you've ever used — `arrow-functions` → ES5 functions, async/await → state machines, JSX → `React.createElement` calls — is **a tree-rewrite** implemented as a visitor.

### 2.2 TypeScript Compiler API

The TypeScript compiler exposes its AST via `ts.createSourceFile` + `ts.forEachChild(node, visitor)`. The recursive walk is identical to the universal DFS template from `junior.md`. The TypeScript type checker, the language service (powering autocomplete in VS Code), and the emitter all consume the same tree.

### 2.3 LLVM IR and the AST → IR pipeline

Clang (the C/C++ frontend of LLVM) builds a C++-specific AST (`clang::Stmt`, `clang::Expr` hierarchies in `clang/AST/*.h`), then walks it to emit **LLVM IR** — which is itself a graph of `Instruction`s grouped into `BasicBlock`s grouped into `Function`s. While IR is not strictly a tree (it has back-edges for loops, so it's a CFG), the **dominator tree** computed over IR is a real binary tree (well, n-ary), and every transformation pass (`-O2`, `-O3`, `mem2reg`, `inline`, `dce`) walks it.

### 2.4 GCC GIMPLE

GCC's middle-end IR, GIMPLE, is also tree-shaped. The `gimple.h` header defines the node types. Every optimization pass operates on this tree.

### 2.5 Why this matters

If you ever write a linter, a code formatter, a transpiler, a security analyzer, or a refactoring tool, you are walking ASTs. The recursion template you learned in `junior.md` is *literally* the code you write. Every plugin in ESLint is a visitor over a parse tree. Every static-analysis tool ships a tree walker as its core loop.

Read one of: ESTree's spec (github.com/estree/estree), Babel's `@babel/types` source, TypeScript's `parser.ts`, or Clang's `RecursiveASTVisitor.h`. Any of them will reinforce everything you already know about tree traversal.

---

<a name="fs"></a>
## 3. File System Inode Trees (ext4, btrfs)

The Unix file system is a tree. `/` is the root inode. Each directory is a node whose children are listed in its directory entry table. Each file is a leaf (mostly — symbolic links and hard links complicate the picture into a DAG).

### ext4 — the htree

When a directory has many entries, ext4 organizes them as a **htree** (hash tree), a height-bounded binary-ish tree indexed by the hash of the file name. This gives O(log n) lookup for `open()`. Daniel Phillips, "A Directory Index for Ext2" (2002), introduced this; it shipped in ext3 and was retained in ext4. The htree is at most 3 levels deep, by design, so the kernel never recurses dangerously.

### btrfs — copy-on-write B-trees

btrfs stores **everything** (file data, directory entries, snapshots, metadata) as keys in a forest of B-trees. Each tree is copy-on-write: when you modify a leaf, you allocate new leaves and inner nodes up to the root, leaving the old version intact (which is how snapshots work for free). The fundamental operation is "walk a B-tree from root to leaf" — the same algorithm as B-tree search, which is itself an extension of binary search.

### Walking the file system

`os.walk` in Python, `filepath.Walk` in Go, `Files.walk` in Java, the Unix `find` command — all do recursive DFS on the file system tree. They all suffer the same gotchas as any tree walk: deep nesting can stack-overflow naive recursion, cycles (from symlinks) can cause infinite walks (handle with a visited set of `(dev, inode)` pairs), and BFS vs DFS gives different orderings.

---

<a name="hashmap"></a>
## 4. Java HashMap Treeification (since JDK 8)

This is one of the cleverest cases of "general-purpose data structure secretly uses a tree". Until Java 7, `HashMap`'s buckets were singly-linked lists of `Entry`. Hash collisions degraded `get`/`put` to O(n) in the worst case — and adversarial inputs (e.g., string keys whose hashes collide) made this a DOS attack vector (`HashDoS`, disclosed at 28C3 in 2011 against many languages).

JDK 8 (release 2014, JEP 180 / JDK-8023463) changed `HashMap` so that when a single bucket accumulates **8 or more entries** (`TREEIFY_THRESHOLD = 8`) **and** the overall table has at least **64 buckets** (`MIN_TREEIFY_CAPACITY = 64`), the bucket is converted from a linked list to a **red-black tree**. When the bucket shrinks back below **6 entries** (`UNTREEIFY_THRESHOLD = 6`), it converts back. The thresholds 8 and 6 are not arbitrary — they sit on either side of 7, the boundary where the expected linked-list length under random hashing makes treeification statistically worthwhile (Doug Lea's analysis in the JDK source comments).

The relevant inner class is `java.util.HashMap.TreeNode`, which extends `LinkedHashMap.Entry` and adds `parent`, `left`, `right`, `prev`, and a `red` color bit. The class is in the JDK source under `java/util/HashMap.java`. It's a fully-featured red-black tree with rotations, fix-ups, and inorder iteration — sitting inside what you probably thought was "just a hash map".

**Takeaway:** even when you think you're using a hash structure, a tree may be running underneath when behavior gets bad. This is **graceful degradation**: hash-map fast path under random keys, log-n tree fallback when an attacker tries to collide everything.

`ConcurrentHashMap` did the same since JDK 8. The Linux kernel's `dcache` did something similar even earlier (its directory entry cache treeifies hot buckets).

---

<a name="queryplan"></a>
## 5. Database Query Plan Trees (Postgres, MySQL)

When you submit `SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id WHERE u.country = 'US'`, the database compiles your SQL into a **plan tree**. In Postgres, every node is a `Plan` struct (defined in `src/include/nodes/plannodes.h`), with type tags like `T_SeqScan`, `T_IndexScan`, `T_HashJoin`, `T_NestLoop`, `T_Sort`, `T_Limit`. Each plan node has `lefttree` and `righttree` fields — **literally a binary tree**. The executor (`src/backend/executor/`) walks this tree by calling `ExecProcNode(node)`, which polymorphically dispatches based on the type tag and recursively pulls tuples from `lefttree` and `righttree`.

A typical join plan looks like:

```
                    HashJoin
                   /        \
              SeqScan      Hash
              (orders)      |
                        IndexScan
                        (users)
```

The executor walks this tree in a **pull-based** model called the **Volcano iterator model** (Goetz Graefe, 1994) — each node has a `next()` method that returns one tuple at a time. The root's `next()` calls its children's `next()`, which call theirs, etc., all the way down to the scans that read from disk. This is *exactly* the iterator pattern from `std::map` extended to a tree.

`EXPLAIN ANALYZE SELECT ...` prints this tree. The thing on the left of the join in EXPLAIN is `lefttree`; the indentation is the tree's structure. Reading EXPLAIN output well is reading tree output well.

MySQL/InnoDB has a similar (less famous) `JOIN_TAB` tree. SQL Server, Oracle, and CockroachDB all have plan trees. Spark and Presto have logical and physical plan trees. **All modern query engines are tree walkers.**

---

<a name="merkle"></a>
## 6. Merkle Trees — Git, Bitcoin, Cassandra, IPFS

Ralph Merkle, "A Digital Signature Based on a Conventional Encryption Function" (CRYPTO 1987 / patent 1979), introduced **Merkle trees**: binary trees where each leaf holds a hash of a data block and each internal node holds a hash of its two children's hashes. The root hash uniquely fingerprints the entire data structure — a single 32-byte hash that vouches for terabytes of content.

### 6.1 Git

Every Git commit stores a **tree object** (a directory) whose hash is `SHA-1(content)`. The directory's tree object lists its children (files = blobs, subdirectories = subtrees) by their hashes. The commit's root tree hash uniquely identifies the entire working-tree snapshot. Two commits with the same root tree hash represent identical content, even if reached through different histories. This is how Git deduplicates storage and how `git status` can be fast.

### 6.2 Bitcoin

Each Bitcoin block contains a **Merkle root** of its transactions. To prove a transaction is in a block, you supply the transaction and a path of `log₂(n)` sibling hashes (a "Merkle proof") — verifiers can recompute the root in O(log n) hashes. This is the **SPV (Simple Payment Verification)** mechanism in Satoshi's 2008 paper, which lets light clients verify inclusion without downloading the whole block.

### 6.3 Cassandra / DynamoDB anti-entropy

Distributed databases like Cassandra use Merkle trees to compare replica states. Each replica builds a Merkle tree over its data; replicas exchange root hashes; if equal, they're in sync; if not, they descend into the children to find the differing range with O(log n) comparisons. This is the **anti-entropy** mechanism described in the Dynamo paper (DeCandia et al., SOSP 2007).

### 6.4 IPFS

The InterPlanetary File System addresses every file by the hash of a Merkle-DAG (a DAG, not strictly a tree, because of deduplication). Content-addressed storage rests on Merkle structures.

### Code sketch

```python
import hashlib

def merkle_root(blocks):
    if not blocks:
        return b""
    layer = [hashlib.sha256(b).digest() for b in blocks]
    while len(layer) > 1:
        if len(layer) % 2 == 1:
            layer.append(layer[-1])             # pad to even by duplicating last
        layer = [hashlib.sha256(a + b).digest()
                 for a, b in zip(layer[::2], layer[1::2])]
    return layer[0]
```

The structure that emerges is a perfect binary tree (after padding). Every modern blockchain, every content-addressed store, every distributed file synchronizer uses this idea.

---

<a name="cache"></a>
## 7. Cache-Unfriendliness and the Pointer-Chasing Problem

A binary tree of one million nodes stored as separately-allocated `Node` objects scatters its nodes all over the heap. Each child access is a pointer dereference, which on modern CPUs is:

| Access type | Latency | Notes |
|---|---|---|
| L1 cache hit | ~1 ns | 32 KB, 4-cycle latency typical |
| L2 cache hit | ~3 ns | 256 KB–1 MB |
| L3 cache hit | ~12 ns | 4–32 MB shared across cores |
| DRAM access | ~80–150 ns | A "cache miss" |

A tree walk of a tree larger than L3 (say, 10 million nodes × 40 bytes = 400 MB) misses cache *on every step*. Even though the algorithm is O(n) in operations, it can be O(n) **in DRAM accesses**, which makes the constant factor 100× larger than the equivalent array walk.

### Mitigations (full detail in `professional.md`):

- **Arena allocators**: pack nodes contiguously. Cache prefetchers can predict the next address.
- **van Emde Boas layout**: recursively split the tree into smaller subtrees and lay them out so each subtree fits in one cache line.
- **Eytzinger layout**: store a complete tree in an array with `left = 2i+1`, `right = 2i+2`. No pointers, full cache efficiency. Used in modern in-memory indexes like the **Adaptive Radix Tree** and Google's **B-tree map**.
- **Compressed pointers (compressed oops)**: Java uses 32-bit indices instead of 64-bit pointers when the heap is < 32 GB, halving the size of every reference and doubling cache density.

### NUMA effects

On multi-socket servers, memory is partitioned by socket. A tree walk that traverses nodes allocated on a different socket pays the **remote DRAM penalty** — easily 200 ns instead of 80 ns per access. Production systems that build huge trees (Postgres planner trees, JVM GC live-object trees) increasingly use **NUMA-aware allocators** to keep tree subtrees on the socket of the thread that walks them.

---

<a name="iterators"></a>
## 8. Tree Iterators in Real APIs

`std::map<K, V>` in C++ is a balanced binary tree (typically red-black). Its iterator is a **stateful inorder walker**. `iter++` finds the *inorder successor* of the current node, in O(amortized 1) time (O(log n) worst case but constant on average). The algorithm:

```
inorder_successor(node):
    if node.right != null:
        return leftmost(node.right)
    while node.parent != null and node == node.parent.right:
        node = node.parent
    return node.parent
```

This is the same algorithm used by Java's `TreeMap.Entry.next()`, Python's `SortedDict` from `sortedcontainers`, and `BTreeMap::iter()` in Rust's standard library.

**Why does this matter?** Every for-loop you write over a sorted map walks the tree using this routine. Knowing it exists means you understand why "range queries" on a `TreeMap` are O(log n + k) — one O(log n) seek plus O(k) inorder steps, each amortized O(1).

### Iterator invalidation

In C++, `std::map::insert` does **not** invalidate other iterators. The reason: the tree's *structure* changes (a rotation), but every pre-existing iterator still points to a valid node, and its inorder-successor algorithm still works. This is a load-bearing property — STL containers' iterator invalidation rules are written assuming this.

Compare with C++'s `std::vector::push_back`, which **does** invalidate all iterators on reallocation. Tree containers offer stronger iterator-stability guarantees than array containers. That alone is sometimes enough to choose `std::map` over `std::vector` even when the asymptotics favor the vector.

---

## Summary

- The HTML DOM, every AST in every compiler, every file system, Java's HashMap (above a threshold), every database plan tree, and every blockchain Merkle structure is a binary tree (or trivially generalizes to one).
- Reading the source of one production tree (Blink's `node.cc`, Postgres' `nodes/plannodes.h`, JDK's `HashMap.java`) closes the gap between "I can solve LeetCode" and "I understand systems".
- Pointer-chasing makes naive tree walks 10–100× slower than equivalent array walks on large trees. Production systems fix this with arena allocators, cache-conscious layouts, and compressed pointers — covered in `professional.md`.
- Tree iterators (`std::map::iterator`, `TreeMap` entry iterators) implement the inorder-successor algorithm. Knowing it lets you reason about iterator invalidation, range query cost, and amortized complexity properly.
- Merkle trees turn a binary tree into a content fingerprint mechanism. Git, Bitcoin, Cassandra, and IPFS all stand on this single idea.

If you have time for only one follow-up, open Postgres' `EXPLAIN ANALYZE` on a 3-way join and read the plan tree until you can predict the execution order. Then read `professional.md`.
