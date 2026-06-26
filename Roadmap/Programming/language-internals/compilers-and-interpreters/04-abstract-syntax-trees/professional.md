# Abstract Syntax Trees — Professional Level

> **Topic:** [Abstract Syntax Trees](README.md)
> **Focus:** AST memory layout as a first-order design decision — pointer trees vs arena/flat index-based (data-oriented) representations, red-green trees for incremental reuse, and how rustc, Zig, Carbon, and Roslyn make these choices to hit performance and incrementality targets.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> 🎓 At senior level the AST was a *pipeline of trees* and a *phase interface*. At professional level the question is about the bytes: **how is the tree laid out in memory, and what does that layout cost?** For a hobby interpreter the answer is "who cares — `Box<Expr>` everywhere." For a compiler that must parse a million-line crate, or an IDE that must re-analyze on every keystroke, the layout *is* the architecture. The difference between a pointer-chasing tree and a flat, index-addressed arena is the difference between a tool that feels instant and one that doesn't.

This level is data-oriented. A classic AST — `Box<Expr>` / `unique_ptr<Node>` / one heap object per node, children reached by pointer — is the obvious, teachable representation, and it is fine until it isn't. At scale it has three problems: each node is a separate allocation (slow to build, slow to free), pointer-chasing destroys cache locality (each child is a likely cache miss), and the pointers themselves are fat (8 bytes each, plus allocator headers). The professional alternative is the **flat / arena / index-based AST**: store all nodes in one contiguous array (or a few), and let "children" be small integer indices into that array. This is the **data-oriented design** turn, and it is why modern performance-focused compilers — **rustc** (arena-allocated, interned), **Zig** (a struct-of-arrays AST and a flat MultiArrayList), and **Carbon** (explicitly data-oriented, parse-tree-as-array) — abandoned the textbook pointer tree.

The second half is **incrementality**. An IDE cannot reparse and re-type-check the whole file on every keystroke; it must *reuse* the unchanged 99%. The canonical answer is **Roslyn's red-green tree**: an immutable, position-free, shareable "green" tree that survives edits intact, wrapped by a cheap, lazily-built "red" tree that supplies parent links and absolute positions. Edit one character, and a green tree's unchanged subtrees are *reused by reference* while only the spine to the edit is rebuilt. We will dissect both the flat-arena and the red-green designs, because together they are how professional ASTs hit their performance and latency budgets.

## Prerequisites

- The [senior](senior.md) level: the AST as a phase interface, lowering staircases (HIR/MIR), typed/annotated ASTs, span propagation, and the real ASTs (Python, Babel, Clang, Roslyn, rustc).
- The [middle](middle.md) level: representation, the visitor pattern, transformers, immutable vs in-place.
- Comfort with memory-level reasoning: cache lines, allocation cost, pointer size, structure padding. The shared-memory concurrency material on cache locality is the right mental background.
- Familiarity with the idea of *interning* (deduplicating identical values into a single shared instance).

You do **not** need to have written a production compiler — but this level assumes you care about *why* the production ones are built the way they are.

## Glossary

| Term | Meaning |
| --- | --- |
| **Pointer tree** | The classic AST: one heap allocation per node, children reached via pointers (`Box`, `unique_ptr`, object references). |
| **Arena** | A single large allocation from which all nodes are bump-allocated; freed all at once. No per-node `free`. |
| **Flat / index-based AST** | Nodes stored in a contiguous array; "children" are integer indices (`u32`) into that array, not pointers. |
| **Data-oriented design (DOD)** | Organizing data by how it is *accessed* (contiguous, cache-friendly) rather than by object identity. |
| **Struct-of-arrays (SoA)** | Storing each field of a node type in its own parallel array (all tags together, all spans together) instead of array-of-structs. |
| **Interning** | Deduplicating equal values (identifiers, types, literals) so each unique value is stored once and referenced by a small id. |
| **Node id / handle** | A small integer that names a node in a flat AST; the index-based analogue of a pointer. |
| **Red-green tree** | Roslyn's two-layer design: immutable position-free "green" nodes + lazy parent/position-aware "red" wrappers. |
| **Green node** | Immutable, width-only (no absolute position), parent-less, fully shareable; the reusable substance of the tree. |
| **Red node** | Lazily created facade over a green node that adds parent pointer and absolute offset; recomputed per tree version. |
| **Structural sharing** | Reusing unchanged subtrees by reference across versions; the basis of cheap incremental edits. |
| **Cache miss** | A memory access not served by cache; pointer-chasing a scattered tree triggers many. The thing flat ASTs minimize. |
| **Bump allocation** | Allocate by incrementing a pointer; the arena's near-free allocation strategy. |

## Core Concepts

### 1. The cost model of a pointer tree

Start with the obvious AST and count the costs honestly. Each node is a separate heap object:

```rust
enum Expr {
    Lit(i64),
    BinOp { op: Op, lhs: Box<Expr>, rhs: Box<Expr> },  // two heap pointers
}
```

For a tree of N nodes:

- **N allocations** to build it, **N frees** to tear it down. malloc/free are not free; at N in the millions this is a measurable slice of compile time.
- **Poor locality.** `lhs` and `rhs` are wherever the allocator happened to put them — likely different cache lines, possibly different pages. Walking the tree is a tour of cache misses; the CPU stalls waiting on memory it cannot prefetch (the next address is only known *after* the current load completes — pointer chasing defeats the prefetcher).
- **Fat nodes.** Each `Box` is 8 bytes; each heap object carries an allocator header and alignment padding. A node that holds 2 bytes of real data may occupy 48.
- **Recursive drop / free** can blow the stack on deep trees and is itself a pointer-chasing walk.

None of this matters for a 200-node script. All of it matters for a compiler. The pointer tree optimizes for *programmer convenience* (it looks like the grammar) at the expense of *machine sympathy*.

### 2. The flat / arena / index-based AST

The data-oriented alternative: put every node in one contiguous array, and replace pointers with indices.

```rust
type NodeId = u32;                 // 4 bytes, not 8; an index, not a pointer

enum Node {
    Lit(i64),
    BinOp { op: Op, lhs: NodeId, rhs: NodeId },   // indices into `nodes`
}

struct Ast {
    nodes: Vec<Node>,              // ONE allocation, grows by doubling
    spans: Vec<Span>,             // parallel array: span of nodes[i]
}
```

What this buys:

- **One allocation (amortized).** Building the tree is pushing onto a `Vec`. Tearing it down is one `free`. No per-node malloc.
- **Cache locality.** Nodes are adjacent in memory; a traversal streams through the array, and the prefetcher actually works. Children are *nearby* indices, not random addresses.
- **Smaller handles.** A `u32` index halves the 8-byte pointer and, in a 4-billion-node ceiling that no real program approaches, costs nothing.
- **Cheap serialization and parallelism.** A flat array of POD nodes can be `memcpy`'d, mmap'd, or sent to another thread without pointer fix-ups.

The costs: you lose the borrow-checker's help (an index can dangle or point at the wrong node — it is a manual pointer), you need the `Ast` in hand to dereference any node (`ast.nodes[id]`), and recursive algorithms become "follow this index" instead of "follow this pointer," which is a small ergonomic tax. But for a compiler the locality and allocation wins dominate. **rustc** arena-allocates and interns; **Zig's** parser produces a flat `Ast` with a `MultiArrayList` of nodes; **Carbon** was explicitly designed around a flat parse tree stored as an array, citing data-oriented performance as a core goal.

### 3. Struct-of-arrays: pushing locality further

The flat AST above is still *array-of-structs* (AoS): each `Node` holds its tag, operands, and maybe a span inline, so the struct is as wide as its biggest variant. **Struct-of-arrays (SoA)** splits each field into its own parallel array:

```text
AoS (array of structs):        SoA (struct of arrays):
 nodes: [ {tag,a,b,span},        tags:  [tag, tag, tag, ...]
          {tag,a,b,span},        lhs:   [a,   a,   a,   ...]
          ... ]                  rhs:   [b,   b,   b,   ...]
                                 spans: [span,span,span,...]
```

Why bother? Because a pass that only reads tags (say, "count all `Call` nodes") streams through the `tags` array touching *only* tags — no span bytes pollute the cache lines. Each pass pays for exactly the fields it uses. **Zig's `MultiArrayList`** is precisely this: the AST is stored SoA, so the tokenizer/parser and later passes each touch only the columns they need. The cost is ergonomic — you index three arrays instead of dereferencing one struct — and SoA only pays off when passes are field-selective. It is the most aggressive locality move and the one most tied to a specific compiler's access patterns.

### 4. Interning: store each unique thing once

A million-line program mentions the identifier `i`, the type `i32`, and the literal `0` countless times. Storing each occurrence as its own string/heap allocation is wasteful and makes comparison expensive (string compare). **Interning** deduplicates: each unique value is stored once in a table, and everywhere else holds a small integer id into that table.

```rust
// Instead of String everywhere:
struct Symbol(u32);              // an interned-string id
// `i` is always Symbol(7); comparing two names is comparing two u32s.
```

Interning turns identifier and type equality from O(length) string/structural comparisons into O(1) integer comparisons, shrinks memory dramatically, and is foundational to fast name resolution. rustc interns symbols, types, and many other things; the `Ty` you compare in type checking is an interned pointer, so type equality is a pointer/id comparison, not a deep structural walk. Interning is the natural companion to a flat AST: both replace fat, scattered, deeply-compared data with small, dense, cheaply-compared ids.

### 5. Red-green trees: immutability + incrementality

IDEs have a brutal constraint: **re-analyze on every keystroke, within a frame.** Reparsing and re-type-checking the whole file each time is impossible for large files. The reuse strategy must be: keep the unchanged 99% and rebuild only what the edit touched. Roslyn's answer is the **red-green tree**, and it is worth understanding precisely because it solves two problems at once — immutability for safe sharing, and laziness for cheap parent/position access.

**Green tree (the substance).**
- Immutable. Once built, a green node never changes.
- Stores only *relative width* (how many characters it spans), **not absolute position**. This is the key trick: a node that knows only its width is *position-independent* and can be reused anywhere.
- Has no parent pointer (a parent pointer would tie it to one location and one tree version, defeating sharing).
- Fully shareable: the same green subtree can appear in many tree versions.

**Red tree (the facade).**
- Lazily created on demand as you navigate down from the root.
- Adds the two things green lacks: a **parent pointer** and an **absolute position** (computed by summing widths from the root).
- Cheap and disposable; recomputed for each tree version, never stored long-term.

**Why two layers?** Parent pointers and absolute positions are exactly the data that *changes* when you edit (insert a character and every following node's absolute position shifts; a node's parent depends on which tree it is in). By moving that volatile data into the throwaway red layer, the green layer becomes a stable, immutable, infinitely-shareable substrate. Edit one token: build a new green node for it, build new green nodes only along the spine from the edit to the root, and **reuse every other green subtree by reference.** A 100,000-node file with a one-character edit rebuilds maybe 20 green nodes. That is what makes Roslyn's IDE incremental.

The names are literally from the original whiteboard: green nodes were drawn in green (the persistent data), red nodes in red (the facade). The pattern is not Roslyn-exclusive — Swift's **libSyntax**/SwiftSyntax used the same idea, and the broader **persistent data structure** literature (Okasaki) is the theory underneath.

### 6. Putting it together: which design for which job

There is no universally best layout; there is a best layout *for a goal*:

| Goal | Layout |
| --- | --- |
| Teaching, small interpreter, prototyping | Pointer tree (`Box`/`unique_ptr`). Simplest. |
| Batch compiler, parse-once-analyze-many, max throughput | Flat/arena, index-based, interned (rustc, Zig, Carbon). |
| Field-selective passes, extreme locality | Struct-of-arrays flat AST (Zig `MultiArrayList`). |
| IDE, edit-on-every-keystroke, incremental reuse | Red-green tree (Roslyn, SwiftSyntax). |
| Source-faithful rewriting + incrementality | Full-fidelity red-green (Roslyn keeps trivia too). |

A real toolchain may use *several*: a flat arena AST for the batch compiler path and a red-green-style tree for the IDE path over the same language. The layout follows the workload, and a professional engineer chooses it deliberately rather than defaulting to the pointer tree because it is what the textbook drew.

### 7. Memory reclamation and lifetime

The layout dictates the lifetime model. A pointer tree is reclaimed node-by-node (GC, refcount, or recursive drop). An **arena** is reclaimed *all at once*: the entire AST lives as long as the arena, and freeing the arena frees every node in one operation — perfect for a compiler where the AST has a clear phase lifetime and individual nodes are never freed early. This is why arenas pair so naturally with compilers: there is no "free this one node" use case; you build the tree, use it for a phase or the whole run, then drop it wholesale. The flip side: you cannot cheaply free part of the tree, and a long-lived arena can hold memory you are "done" with. For incremental/IDE workloads the red-green tree's *persistent* model (old versions garbage-collected when no longer referenced) is the better fit. Match the reclamation strategy to whether the AST's lifetime is *batch* (arena) or *evolving* (persistent).

## Real-World Analogies

| Concept | Analogy |
| --- | --- |
| Pointer tree | A scavenger hunt: each clue is at a random address you can only find by reading the previous clue. The CPU prefetcher can't help. |
| Flat/arena AST | A spreadsheet: every row adjacent, addressed by row number, scanned top to bottom at memory speed. |
| Struct-of-arrays | A library shelved by attribute: all the spines in one row, all the call-numbers in another — grab exactly the column you need. |
| Interning | Coat check: hand in your identical coat, get a numbered tag; everyone with the same coat shares one stored copy and compares tags, not coats. |
| Green tree | A printed book's content — fixed, identical in every copy, reusable. |
| Red tree | Your bookmark and the page number — specific to *your* reading, recomputed, thrown away. |
| Structural sharing | Editing a shared doc: only the changed paragraph is new; the rest is the same stored text referenced again. |
| Arena reclamation | A whiteboard: write all over it during the meeting, erase the whole thing at once when done. |

## Mental Models

### "A child is an index, not an address."

In a flat AST the relationship "this is my left operand" is a small integer into a shared array. This single substitution — pointer → index — is what unlocks one allocation, cache locality, cheap serialization, and trivial parallel hand-off. Think in row numbers, not addresses.

### "Pay for the fields you touch."

Struct-of-arrays makes a pass's cost proportional to the *columns* it reads, not the *width of the node*. A tag-counting pass should never load a single span byte. Layout is how you make that true.

### "Green is the substance; red is the view."

The immutable, position-free green tree is the program. The red tree is a temporary lens you hold over it to ask "where am I and who is my parent." Edits create new substance only where they must; the view is always cheap and disposable.

### "Match reclamation to lifetime."

A batch AST wants an arena (build, use, drop wholesale). An evolving AST wants persistence (old versions die when unreferenced). Choosing the wrong one — refcounting a batch arena, or arena-allocating an IDE's ever-changing tree — fights the workload.

## Code Examples

### A flat, index-based AST with a traversal (Rust)

```rust
type NodeId = u32;

#[derive(Clone, Copy)]
enum Node {
    Lit(i64),
    BinOp { op: u8, lhs: NodeId, rhs: NodeId },
}

struct Ast {
    nodes: Vec<Node>,    // ONE backing allocation
    spans: Vec<(u32, u32)>, // parallel: span of nodes[i]
}

impl Ast {
    fn new() -> Self { Ast { nodes: Vec::new(), spans: Vec::new() } }

    fn push(&mut self, node: Node, span: (u32, u32)) -> NodeId {
        let id = self.nodes.len() as NodeId;
        self.nodes.push(node);
        self.spans.push(span);   // span travels in lockstep — never orphaned
        id
    }

    // Evaluate by following indices, not pointers. No allocation, great locality.
    fn eval(&self, id: NodeId) -> i64 {
        match self.nodes[id as usize] {
            Node::Lit(n) => n,
            Node::BinOp { op, lhs, rhs } => {
                let l = self.eval(lhs);
                let r = self.eval(rhs);
                match op { b'+' => l + r, b'*' => l * r, _ => unreachable!() }
            }
        }
    }
}

fn main() {
    // Build  (2 + 3) * 4  bottom-up, recording spans.
    let mut ast = Ast::new();
    let two  = ast.push(Node::Lit(2), (1, 2));
    let three = ast.push(Node::Lit(3), (5, 6));
    let sum  = ast.push(Node::BinOp { op: b'+', lhs: two, rhs: three }, (1, 6));
    let four = ast.push(Node::Lit(4), (11, 12));
    let prod = ast.push(Node::BinOp { op: b'*', lhs: sum, rhs: four }, (1, 12));
    println!("{}", ast.eval(prod));   // 20
}
```

Every node lives in one `Vec`; "children" are `u32` indices; the span array runs parallel so a node and its span are always found by the same index.

### A red-green tree, sketched (pseudocode)

```text
// GREEN: immutable, width-only, no parent, fully shared.
struct GreenNode {
    kind: SyntaxKind,
    width: u32,                 // RELATIVE width, not absolute position
    children: Vec<GreenNode>,   // shared by reference across versions
}

// RED: lazy facade adding parent + absolute position.
struct RedNode<'a> {
    green:  &'a GreenNode,
    parent: Option<&'a RedNode<'a>>,
    offset: u32,                // absolute position, computed on demand
}

// EDIT: replace one token. Only the spine to the root is new green;
// every sibling subtree is reused by reference.
fn with_replaced_leaf(root: &GreenNode, path: &[usize], new_leaf: GreenNode) -> GreenNode {
    if path.is_empty() { return new_leaf; }
    let (i, rest) = (path[0], &path[1..]);
    let mut children = root.children.clone();         // shallow: shares siblings
    children[i] = with_replaced_leaf(&root.children[i], rest, new_leaf);
    GreenNode { kind: root.kind, width: recompute(&children), children }
}
```

The red layer is never stored long-term; you build it on the way down to ask "where am I?", then drop it. A one-token edit rebuilds only `path.len()` green nodes.

### Interning identifiers (Rust)

```rust
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Symbol(u32);

#[derive(Default)]
struct Interner { map: HashMap<String, Symbol>, strs: Vec<String> }

impl Interner {
    fn intern(&mut self, s: &str) -> Symbol {
        if let Some(&sym) = self.map.get(s) { return sym; }
        let sym = Symbol(self.strs.len() as u32);
        self.strs.push(s.to_owned());
        self.map.insert(s.to_owned(), sym);
        sym
    }
    fn resolve(&self, sym: Symbol) -> &str { &self.strs[sym.0 as usize] }
}

fn main() {
    let mut it = Interner::default();
    let a1 = it.intern("counter");
    let a2 = it.intern("counter");
    assert_eq!(a1, a2);          // same id; name comparison is now O(1)
}
```

Once `counter` is `Symbol(n)`, every name comparison in name resolution is a `u32` equality instead of a string compare — and the string is stored exactly once.

## Trade-offs

| You gain... | ...at the cost of... |
| --- | --- |
| Flat/arena AST: one allocation, cache locality, fast build/free | Manual "pointers" (indices can dangle/alias); need the arena to deref |
| Struct-of-arrays: pay only for fields a pass touches | Ergonomics (index parallel arrays); only wins for field-selective passes |
| Interning: O(1) equality, huge memory savings | An intern table to thread through; ids are meaningless without it |
| Red-green tree: cheap incremental edits, safe sharing, full fidelity | Two layers to implement; red recomputation; conceptual overhead |
| Arena reclamation: free the whole AST in one op | Cannot cheaply free part of the tree; may hold memory you're "done" with |
| Pointer tree: simplest, borrow-checker-friendly, looks like grammar | Slow at scale: N allocations, cache misses, fat nodes |

## Use Cases

- **Batch compilers needing throughput** (rustc, Zig, Carbon, Clang at scale) → flat/arena, interned, sometimes SoA.
- **IDEs and language servers** (Roslyn, rust-analyzer's rowan, SwiftSyntax) → red-green / persistent trees for keystroke-latency incremental reuse.
- **Serializable / mmap-able ASTs** (precompiled headers, save-analysis, distributed builds) → flat POD layouts that need no pointer fix-up.
- **Parallel front ends** → flat arenas hand off to worker threads without pointer-graph hazards.
- **Memory-constrained tooling** → interning + flat layout to fit a large program's tree in cache-friendly, deduplicated form.

## Coding Patterns

### 1. Index newtypes, not raw integers

Wrap node ids in a typed handle (`struct ExprId(u32)`) so you cannot accidentally index the wrong arena with the wrong id. Recovers some of the type safety that raw indices lose.

### 2. Parallel arrays kept in lockstep

If `spans[i]` is the span of `nodes[i]`, *only ever* push to both together (or wrap the pair in one `push`). A drifted parallel array is a silent corruption.

### 3. Width-only nodes for shareable trees

Store relative widths, not absolute positions, on any node you want to reuse across versions. Compute absolute position lazily from the root. This is the red-green discipline distilled.

### 4. Intern early, compare by id

Intern identifiers/types/literals at construction time; downstream, compare ids, never the underlying strings/structures.

### 5. Arena per phase

Allocate the AST in an arena scoped to the phase (or run) that needs it; drop the arena to reclaim everything at once. No per-node lifetime bookkeeping.

## Best Practices

- **Default to a pointer tree only for prototypes.** The moment performance or scale matters, move to a flat/arena, index-based layout — that is what the production compilers did.
- **Choose layout by workload:** batch → arena; incremental/IDE → red-green/persistent. Don't force one model onto both paths.
- **Intern everything compared by equality** (names, types, common literals). It is one of the highest-leverage memory and speed wins.
- **Keep volatile data (absolute position, parent) out of shareable nodes.** Width + lazy red facade is the pattern.
- **Measure before micro-optimizing layout.** SoA only pays for field-selective passes; profile that your passes are actually column-selective before paying SoA's ergonomic cost.
- **Use typed handles** to claw back safety lost when pointers became indices.
- **Make span/position travel with the node mechanically** (parallel arrays pushed together, or width carried on the node) so it is never orphaned.

## Edge Cases & Pitfalls

- **Dangling/aliasing indices.** A `NodeId` is a manual pointer: it can point at a freed arena, the wrong arena, or a stale slot. The borrow checker cannot help. Typed handles + a single owning arena mitigate.
- **SoA hurting non-selective passes.** A pass that reads *every* field of *every* node may be slower in SoA (it now stride-jumps across arrays) than in AoS. SoA is not universally faster.
- **Red-tree thrash.** Repeatedly rebuilding red facades in a hot loop (e.g., naive repeated `parent`/`position` queries) can dominate; cache the red nodes you revisit.
- **Interner as a bottleneck.** A single global interner behind a lock can serialize a parallel front end; shard or use a concurrent interner.
- **Arena holding memory too long.** A long-lived arena pins every node's memory even after a phase is done; scope arenas tightly.
- **Serialization assuming pointer stability.** Flat ASTs serialize cleanly *only* if ids are array indices, not addresses; mixing the two breaks mmap/round-trip.
- **Forgetting that green widths must be recomputed** up the spine after an edit; a stale width corrupts all downstream absolute positions.

## Common Mistakes

1. **Defaulting to `Box<Expr>` everywhere in a performance-sensitive compiler** and then being surprised parsing is allocation-bound.
2. **Storing absolute positions on nodes you want to reuse** — every edit invalidates them, killing structural sharing.
3. **Putting parent pointers on green nodes** — ties them to one tree, defeating sharing entirely.
4. **Reaching for SoA without profiling** that passes are field-selective; paying ergonomics for no locality win.
5. **Comparing identifiers by string** in name resolution instead of interning and comparing ids.
6. **Using raw `u32` ids** that get crossed between two arenas, indexing nonsense without a compile error.
7. **Refcounting or GC-ing a batch AST** that wants a single wholesale arena free.
8. **Re-creating red nodes in a tight loop** and calling it "the red-green tree is slow."

## Tricky Points

- **rust-analyzer uses `rowan`**, a red-green (concrete-syntax) library, while **rustc** uses a flat-ish arena HIR — same language, two layouts, because one path is IDE-incremental and the other is batch.
- **Green nodes can be interned too** — Roslyn deduplicates small green nodes (e.g., a `;` token, common keywords) so the *substance* itself is shared across the whole tree, not just across versions.
- **A flat AST's recursion still uses the call stack** — index-following `eval` can still overflow on deep trees; production code sometimes uses an explicit work-stack regardless of layout.
- **Carbon's parse tree is post-order-flattened** — children before parents in the array — which lets some passes run as a single linear scan with an explicit stack, no recursion at all.
- **Interned `Ty` equality is pointer equality** in rustc: two types are equal iff they are the *same* interned instance, which is why interning must be canonical (structurally-equal types intern to one instance).
- **Red-green is a persistent data structure**, so old tree versions remain valid and are GC'd only when nothing references them — multiple analyses can hold different versions concurrently.
- **Width-only nodes make "absolute position" an O(depth) computation**, not O(1); usually fine, but a reason red nodes cache their offset.

## Test Yourself

1. List the four costs of a pointer-tree AST at scale, and which the flat AST fixes.
2. Why is a child represented as a `u32` index instead of a pointer in rustc/Zig/Carbon? Name three wins.
3. What does struct-of-arrays buy, and when does it *not* pay off?
4. Explain interning and why it makes type/name equality O(1).
5. In a red-green tree, what data lives on green nodes and what lives on red — and why is the split exactly there?
6. After a one-character edit to a 100k-node file, roughly how many green nodes are rebuilt? Why?
7. Why do arenas pair naturally with batch compilers but not with IDEs?
8. Give a way an index-based AST can corrupt that a pointer-based one cannot, and how to mitigate it.
9. Why must green nodes store relative width rather than absolute position to be shareable?

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│  PROFESSIONAL AST LAYOUT CHEAT SHEET                                   │
├──────────────────────────────────────────────────────────────────────┤
│ POINTER TREE   Box<Expr>/unique_ptr. Simple, grammar-shaped.          │
│   cost: N allocs, N frees, cache misses, fat nodes. Prototype-only.   │
├──────────────────────────────────────────────────────────────────────┤
│ FLAT / ARENA   nodes: Vec<Node>; child = u32 INDEX, not pointer.      │
│   win: 1 alloc, locality, small handles, serializable, parallel.      │
│   used by: rustc (arena+intern), Zig, Carbon.                         │
├──────────────────────────────────────────────────────────────────────┤
│ STRUCT-OF-ARRAYS  tags[], lhs[], rhs[], spans[] (parallel columns).   │
│   pay only for fields a pass touches. Zig MultiArrayList.             │
│   caveat: hurts non-field-selective passes.                          │
├──────────────────────────────────────────────────────────────────────┤
│ INTERNING   unique value -> small id. O(1) equality, dedup memory.    │
│   identifiers, types (rustc: Ty equality = pointer equality).        │
├──────────────────────────────────────────────────────────────────────┤
│ RED-GREEN TREE  (Roslyn, SwiftSyntax, rust-analyzer/rowan)            │
│   GREEN: immutable, WIDTH-only, no parent, fully shared = substance.  │
│   RED:   lazy facade adds parent + ABSOLUTE position = view.          │
│   edit 1 token -> rebuild only the spine to root; reuse the rest.     │
│   volatile data (pos, parent) lives in throwaway red layer.          │
├──────────────────────────────────────────────────────────────────────┤
│ RECLAMATION   batch AST -> arena (free wholesale).                    │
│               evolving AST -> persistent (GC old versions).          │
├──────────────────────────────────────────────────────────────────────┤
│ PICK BY WORKLOAD: batch compiler -> flat/arena/intern.                │
│                   IDE/keystroke    -> red-green/persistent.           │
└──────────────────────────────────────────────────────────────────────┘
```

## Summary

- The **pointer tree** (`Box`/`unique_ptr`, one heap object per node) is simple and grammar-shaped but pays N allocations, cache misses, and fat nodes — fine for prototypes, wrong for compilers.
- The **flat / arena / index-based AST** stores all nodes in one contiguous array and makes children small `u32` indices: one allocation, cache locality, small handles, cheap serialization and parallel hand-off. This is the **data-oriented** turn that rustc, Zig, and Carbon took.
- **Struct-of-arrays** pushes locality further by columnizing fields so each pass touches only the data it needs — a win specifically for field-selective passes.
- **Interning** deduplicates identifiers/types/literals into small ids, turning equality into O(1) integer comparison and slashing memory; it is the natural companion to a flat AST.
- **Red-green trees** (Roslyn, SwiftSyntax, rowan) solve incrementality: an immutable, width-only, parent-less **green** tree is infinitely shareable, while a lazy **red** facade supplies parent and absolute position. A one-character edit rebuilds only the spine to the root and reuses every other subtree by reference.
- **Reclamation follows lifetime:** batch ASTs want an arena (free wholesale); evolving IDE ASTs want a persistent model (old versions GC'd when unreferenced).
- There is no universally best layout — there is a best layout *for a workload*, and the professional move is to choose it deliberately rather than defaulting to the textbook pointer tree.

## What You Can Build

- A **flat, index-based AST** for a small language, benchmarked against a `Box`-based version on a large generated program — measure build time, traversal time, and peak memory.
- A **struct-of-arrays variant** with a tag-only pass and a full pass, demonstrating SoA's win on the selective one and its cost on the full one.
- An **interner** plus a name-resolution pass that compares `Symbol` ids, with a benchmark against string comparison.
- A **toy red-green tree** that supports a single-token replacement and proves (by pointer identity) that unchanged subtrees are reused.
- An **mmap-able serialized AST**: write the flat node array to disk and re-load it with zero pointer fix-up.

## Further Reading

- The rustc dev guide: "Memory management in rustc" and "Interning" — arenas, `TyCtxt`, and interned types.
- Andrew Kelley's talks/notes on Zig's data-oriented compiler and `MultiArrayList` (struct-of-arrays AST).
- The Carbon language design docs and toolchain talks on the data-oriented, array-based parse tree.
- Eric Lippert's "Persistence, Facades and Roslyn's Red-Green Trees" — the canonical explanation of the red-green design.
- The `rowan` crate documentation (rust-analyzer's red-green library) and the rust-analyzer architecture doc.
- Chris Okasaki, *Purely Functional Data Structures* — the persistence theory underneath structural sharing.
- Mike Acton, "Data-Oriented Design and C++" (CppCon 2014) — the locality-first mindset that motivates flat ASTs.

## Related Topics

- [Junior level](junior.md) — what an AST is and how to walk it.
- [Middle level](middle.md) — representation, the visitor pattern, transformers, and spans.
- [Senior level](senior.md) — the AST as a phase interface, lowering staircases, and typed ASTs.
- [Interview questions](interview.md) — layout, red-green, interning, and data-oriented questions.
- [Hands-on tasks](tasks.md) — build flat, SoA, interned, and red-green ASTs and benchmark them.
