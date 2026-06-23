# Composite — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/composite](https://refactoring.guru/design-patterns/composite)

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What is the Composite pattern?

**A.** A structural pattern that lets you compose objects into tree structures and treat both individual leaves and entire branches uniformly through a shared interface.

### Q2. Name the three roles.

**A.** **Component** (shared interface), **Leaf** (atomic node), **Composite** (node that holds children).

### Q3. Give a real-world example.

**A.** A file system: `File` and `Folder` both implement `FsItem`; `Folder.size()` recursively sums children. The DOM, ASTs, GUI widget trees, BOMs, org charts are all Composite.

### Q4. What's the difference between Transparent and Safe Composite?

**A.** Transparent puts `add`/`remove` on Component; clients treat all nodes uniformly but `add()` on a Leaf must error or no-op. Safe keeps child management only on Composite; safer types but client must distinguish.

### Q5. Why is Composite a good fit for trees?

**A.** Tree operations (size, render, search) are recursive: a node defers to its children. Composite makes that recursion polymorphic — `node.size()` works whether `node` is a leaf or a composite.

### Q6. What's the difference between Composite and Decorator?

**A.** Both build trees. Composite has many children, treated uniformly (file system); Decorator wraps **one** target and adds behavior (compressed file). Composite branches; Decorator chains.

### Q7. Can a Composite have no children?

**A.** Yes. An empty folder is a valid Composite. Its operations should still make sense (e.g., `size() == 0`).

### Q8. Why are cycles dangerous in Composite?

**A.** Recursive operations and traversals follow children. A cycle (A is descendant of B, B is descendant of A) loops forever — stack overflow or infinite memory growth.

### Q9. Should the Component interface include `add` and `remove`?

**A.** Depends. Transparent yes; Safe no. The trade-off is uniformity vs type safety. Default: start Safe, expose `add`/`remove` only on Composite.

### Q10. When should you NOT use Composite?

**A.** When data is flat (a list, not a tree); when operations on leaves and composites diverge wildly; when forced uniformity creates fake methods (`File.add()` that throws).

---

## Middle Questions

### Q11. How would you implement cycle detection on `add`?

**A.** Walk up the proposed parent's ancestor chain; if you find the item being added, throw. O(depth) per add, but safe.

```java
for (FsItem cur = this; cur != null; cur = cur.parent()) {
    if (cur == item) throw new IllegalArgumentException("cycle");
}
```

### Q12. When would you use Visitor with Composite?

**A.** When operations multiply or don't fit on Component cleanly. Word counter, JSON serializer, audit log writer — each is a Visitor that walks the tree without bloating Component.

### Q13. How do parent pointers complicate the Composite?

**A.** Invariants to maintain: every `add` must set parent; every `remove` must clear it. They enable upward navigation but create a place for bugs. Make parent setters package-private so only the Composite owning the children can call them.

### Q14. How do you handle mutation in a multi-threaded Composite?

**A.** Options:
- Snapshot list on read (allocate; safe).
- Concurrent collections (`CopyOnWriteArrayList` for read-heavy).
- RW locks (coarse-grained).
- Immutable trees (replace with new tree on mutation).

Production trees often choose immutable to sidestep concurrency entirely.

### Q15. How does Composite differ from a plain tree data structure?

**A.** A plain tree is just data — nodes hold children. Composite is when those nodes share a polymorphic interface so clients write recursive code without type checks. Tree = data structure; Composite = pattern of using one.

### Q16. How would you traverse a Composite without recursion?

**A.** Explicit stack (DFS) or queue (BFS). Pop a node, do the work, push children. Avoids stack overflow on deep trees:

```python
stack = [root]
while stack:
    n = stack.pop()
    visit(n)
    if hasattr(n, "children"):
        stack.extend(reversed(n.children))
```

### Q17. What's the trade-off between mutable and immutable Composite?

**A.** Mutable is cheaper to update (O(1) local) but unsafe across threads, prone to invariant bugs, and hard to reason about. Immutable is O(depth) per mutation but thread-safe by construction, debuggable, and rules out cycles structurally. Persistent data structures soften the cost via structural sharing.

### Q18. How do you test a Composite?

**A.** Build small structural fixtures (helpers like `folder("root", file("a", 100), file("b", 200))`). Property-based tests for invariants ("size = sum of leaf sizes"). Recording-Visitor tests for traversal order. Cycle and corruption tests for defensive code.

### Q19. How does Composite combine with Iterator?

**A.** Composite is the structure; Iterator yields the traversal order (DFS, BFS, in-order). They compose naturally: `for node in tree:` gives you a flat sequence over the structure.

### Q20. What's "interface bloat" in Composite?

**A.** When the Component interface accumulates methods that don't make sense for all node types (`File.read()` vs `Folder.read()`). Symptoms: half the methods no-op or throw on one side. Fix: split Component (Interface Segregation), or pull operations out via Visitor.

---

## Senior Questions

### Q21. Compare Composite and Decorator at a system level.

**A.** Both build trees. Decorator: same interface, wraps one inner object, adds behavior — chains, never branches. Composite: same interface, holds many children, models hierarchy — branches always. A document with Composite for structure and Decorator for cross-cutting (compression, encryption) is common.

### Q22. How does the DOM exemplify Composite?

**A.** `Node` is the Component, `Element`, `Text`, `Comment` are Leaves and Composites. Browsers build a tree of millions of nodes; querySelector, layout, paint all walk the tree. Real engines specialize hot paths into iterative passes; the polymorphic interface remains for the API surface.

### Q23. When would you abandon Composite for performance?

**A.** Million-node trees with hot per-frame iteration (game scene graphs). Virtual dispatch and pointer chasing dominate. Move to data-oriented layouts: struct-of-arrays, contiguous allocations, no virtual calls in the inner loop. Keep Composite for editor/structure code.

### Q24. How do you evolve a Component interface without breaking clients?

**A.** Backward-compatible: add default methods (Java 8+), optional capabilities via marker interfaces, or a separate interface that some nodes opt into. Breaking: deprecate cycle, version interfaces, migrate one operation at a time. Visitor is often a better fit than expanding Component.

### Q25. Composite + DI containers: how do they interact?

**A.** Trees are usually built dynamically (read from disk, parsed, user-constructed) — DI doesn't fit naturally. What DI handles well is the *services* that operate on the tree (visitors, repositories). Inject those, not the nodes.

### Q26. How do you handle persistence of a Composite tree?

**A.** Several options:
- Serialize the whole tree (JSON/Protobuf) — simple, but doesn't handle large trees well.
- Adjacency list in DB (`(node_id, parent_id)`) — flexible queries, harder traversal.
- Materialized path (`/root/docs/spec`) — fast subtree queries.
- Nested set / closure table — depending on query patterns.

The right choice depends on read/write ratio and query shape.

### Q27. How does Composite affect distributed tracing?

**A.** Each node visit could be a span — usually too noisy. Tag the high-level operation as one span; record per-node metrics for hot paths. Avoid one-span-per-node unless debugging.

### Q28. When does Composite become a god-class?

**A.** When Component grows to 30+ methods, half no-op for one side. The fix isn't more code in Component; it's pulling operations into Visitors and segregating capabilities into smaller interfaces.

### Q29. How do you handle external references (e.g., a node referencing a non-tree object)?

**A.** Be explicit. Holding a reference to "external state" is fine but makes the tree non-self-contained — serialization, immutability, and equality become tricky. Document where the boundaries are.

### Q30. What's the lifecycle of a Composite tree?

**A.** Define ownership: who builds the tree, who owns the root, who can mutate. Disposal: who calls `close()` on resource-holding leaves? Often the root owner is responsible for walking and disposing. Make this explicit in API contracts.

---

## Professional Questions

### Q31. How does the JVM handle recursive virtual calls in Composite traversal?

**A.** HotSpot inlines monomorphic virtual calls. Recursive inlining is bounded by `MaxInlineLevel` (default 9). Past that, the call stays virtual. Sealed types (Java 17+) help CHA prove monomorphism. For deep trees, recursive inlining doesn't matter; iterative traversal is needed anyway.

### Q32. Why does iterative traversal often beat recursive in benchmarks?

**A.** Recursive: function-call overhead per frame, possible stack-grow checks (Go), allocation of frames. Iterative with explicit stack: tight loop, often vectorizable, no per-call overhead. JIT can sometimes match recursion via inlining; iterative wins reliably.

### Q33. What's the memory cost of a million-node Composite in Java?

**A.** Per node ≈ 32-50 bytes (header, fields, children list reference). ArrayList backing array adds. A million nodes ≈ 50-100 MB. Cache misses dominate traversal because nodes scatter on the heap.

### Q34. What's a "structural sharing" persistent data structure?

**A.** An immutable tree where mutation produces a new tree that shares unchanged subtrees with the old. Modifying one leaf rebuilds only the path from root to that leaf — O(log N) for balanced trees. Used in Clojure's collections, Scala's `immutable.Map`, Immer (JS).

### Q35. Why does CPython's recursion limit hurt Composite?

**A.** Default `sys.getrecursionlimit() == 1000`. Recursive walks of deep trees (parsing JSON, archive extraction, untrusted input) hit the limit and raise `RecursionError`. Always use iterative traversal in production Python Composite.

### Q36. How does Go's stack growth affect Composite recursion?

**A.** Goroutines start at 8 KB and grow. Recursion is "free" until ~1 GB virtual stack, but each frame triggers a stack-grow check. For hot recursive loops, iterative traversal is ~1.5-2× faster.

### Q37. What's a "data-oriented Composite" replacement?

**A.** Game engines and HFT systems replace pointer-tree Composite with arrays of structs (struct-of-arrays). Operations process by attribute over contiguous memory; no virtual dispatch, excellent cache behavior, vectorizable. Loses the polymorphic API.

### Q38. How do you protect against XML/JSON-bomb Composite attacks?

**A.** Bound depth and total size when ingesting untrusted trees. A malicious input claiming 10^6 nesting levels eats memory and crashes recursion. Defenses: depth limit, node count limit, size limit, time limit. Reject before fully parsing.

### Q39. How do you debug a deep Composite tree?

**A.** Visualization helpers (graphviz exporter), pretty-printing with depth-limited output, structural diff between trees, oracle-mode tests. Step debuggers struggle with 10k-deep traversals — log and binary-search.

### Q40. How does Composite combine with Flyweight?

**A.** When many leaves share state (e.g., glyphs in a text engine), Flyweight makes leaves shared instances; Composite manages structural relationships. The combination keeps memory low while preserving the tree API.

---

## Coding Tasks

### Task 1: Recursive size with Composite (Java)

```java
public interface FsItem { long size(); }

public final class File implements FsItem {
    private final long size;
    public File(long size) { this.size = size; }
    public long size() { return size; }
}

public final class Folder implements FsItem {
    private final List<FsItem> kids = new ArrayList<>();
    public void add(FsItem i) { kids.add(i); }
    public long size() { return kids.stream().mapToLong(FsItem::size).sum(); }
}
```

---

### Task 2: Iterative traversal (Python)

```python
def walk(root):
    stack = [root]
    while stack:
        n = stack.pop()
        yield n
        for c in reversed(getattr(n, "children", ())):
            stack.append(c)
```

---

### Task 3: Cycle detection (Go)

```go
func (d *Folder) Add(item FsItem) error {
    for cur := FsItem(d); cur != nil; cur = cur.Parent() {
        if cur == item { return fmt.Errorf("cycle") }
    }
    d.children = append(d.children, item)
    item.SetParent(d)
    return nil
}
```

---

### Task 4: WordCount Visitor (Python)

```python
class WordCount:
    def __init__(self): self.count = 0
    def visit_paragraph(self, p): self.count += len(p.text.split())
    def visit_section(self, s): pass

def accept(node, v):
    if isinstance(node, Section):
        v.visit_section(node)
        for c in node.children: accept(c, v)
    elif isinstance(node, Paragraph):
        v.visit_paragraph(node)
```

---

### Task 5: Immutable Folder (Java)

```java
public final class Folder {
    private final String name;
    private final List<FsItem> children;

    public Folder(String name, List<FsItem> children) {
        this.name = name;
        this.children = List.copyOf(children);
    }

    public Folder withAdded(FsItem item) {
        var next = new ArrayList<>(children);
        next.add(item);
        return new Folder(name, next);
    }
}
```

---

## Trick Questions

### Q41. "Is a linked list a Composite?"

**A.** No — a linked list is a chain (each node has one successor). Composite has *many* children per node. A degenerate Composite with one child per node is just a chain; you'd call it a List.

### Q42. "If my tree only has two levels, do I still need Composite?"

**A.** Probably not. Two-level structures are well served by a parent class with a child list — the recursion barely materializes. Composite shines when depth varies and you don't know it in advance.

### Q43. "Can I use Composite without inheritance?"

**A.** Yes — Go has no inheritance, and the pattern works fine via interfaces and structs. The pattern is about polymorphism (same interface for one and many), not specifically inheritance.

### Q44. "Are sum types better than Composite?"

**A.** For a *closed* set of node types and exhaustive matching, sum types can be cleaner — the compiler enforces coverage. For an *open* set (anyone can add a new node type), Composite is the right choice.

### Q45. "Why is the DOM mutable?"

**A.** Because JavaScript needed familiar imperative APIs (`appendChild`, `removeChild`). It's a deliberate compromise — engines work hard to make this safe under JS's single-threaded event loop. Modern frameworks (React, Vue) wrap the mutable DOM with virtual immutable trees.

---

## Behavioral / Architectural Questions

### Q46. "Tell me about a time you used Composite."

**A.** *STAR:* Situation (a CMS where pages had nested sections of arbitrary depth). Task (count words, render to HTML, search). Action (made `Section` and `Paragraph` implement `DocItem`; word count and rendering became 5-line Visitors). Result (adding a new node type — `Quote` — was one class; tests stayed clean).

### Q47. "How would you explain Composite to a junior engineer?"

**A.** Use the file system. Show that `File.size()` and `Folder.size()` look the same to the caller, even though folders ask their children for help. Then show what the *non-Composite* version looks like (lots of `if isinstance(...)`) — they immediately see the win.

### Q48. "When did you decide *not* to use Composite?"

**A.** A teammate proposed Composite for a list of orders with optional "parent order" links. It wasn't a real tree — most orders had no parent. A simple foreign key + occasional join was simpler. Composite would have been overkill.

### Q49. "How do you balance Composite with performance demands?"

**A.** Composite for the API and structure; data-oriented redesign for hot paths. The two views can coexist — game engines do this routinely. Don't preoptimize; profile, then specialize.

### Q50. "Your team's Composite has a 30-method Component interface. What do you do?"

**A.** Audit operations: which run on every node? Which are leaf-only or composite-only? Group leaf-only methods, group composite-only methods, leave the small core on Component. Pull cross-cutting operations (export, audit) into Visitors. Communicate the cleanup as a planned refactor — don't rip in one PR.

---

## Tips for Answering

1. **Lead with "treat one and many uniformly."** That's the headline.
2. **Bring an example from real software.** DOM, file system, AST — pick the one closest to your work.
3. **Distinguish from siblings.** Decorator (chain, single target), Iterator (traversal), Visitor (operations).
4. **Discuss when NOT to use it.** Forced uniformity is the failure mode.
5. **Mention cycles, depth, and concurrency.** These are senior-level concerns that interviewers love.
6. **Show the Visitor escape hatch.** When operations multiply, Visitor keeps Component clean.
7. **Be honest about performance.** Composite's polymorphism has cost; sometimes data-oriented design replaces it for hot paths.

---

← Back to Composite folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Composite — Hands-On Tasks](tasks.md)
