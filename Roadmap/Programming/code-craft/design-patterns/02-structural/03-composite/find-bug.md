# Composite — Find the Bug

> **Source:** [refactoring.guru/design-patterns/composite](https://refactoring.guru/design-patterns/composite)

Each section presents a Composite that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Cycle in tree → infinite recursion](#bug-1-cycle-in-tree-infinite-recursion)
2. [Bug 2: Mutable internal list returned](#bug-2-mutable-internal-list-returned)
3. [Bug 3: ConcurrentModificationException during traversal](#bug-3-concurrentmodificationexception-during-traversal)
4. [Bug 4: Parent pointer not updated on remove](#bug-4-parent-pointer-not-updated-on-remove)
5. [Bug 5: Recursion blows the stack on deep tree](#bug-5-recursion-blows-the-stack-on-deep-tree)
6. [Bug 6: Component shared between two parents](#bug-6-component-shared-between-two-parents)
7. [Bug 7: instanceof in client code](#bug-7-instanceof-in-client-code)
8. [Bug 8: Cached size never invalidated](#bug-8-cached-size-never-invalidated)
9. [Bug 9: Equals/hashCode mutates with children](#bug-9-equalshashcode-mutates-with-children)
10. [Bug 10: Visitor double-visits a shared node](#bug-10-visitor-double-visits-a-shared-node)
11. [Bug 11: Recursion through symlinks (Go)](#bug-11-recursion-through-symlinks-go)
12. [Bug 12: Reverse children for left-to-right iteration](#bug-12-reverse-children-for-left-to-right-iteration)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Cycle in tree → infinite recursion

```java
public class Folder implements FsItem {
    private final List<FsItem> kids = new ArrayList<>();
    public void add(FsItem item) { kids.add(item); }   // no cycle check
    public long size() {
        return kids.stream().mapToLong(FsItem::size).sum();
    }
}

Folder a = new Folder();
Folder b = new Folder();
a.add(b);
b.add(a);   // CYCLE
a.size();   // infinite recursion → StackOverflowError
```

<details><summary>Reveal</summary>

**Bug:** No cycle protection. Adding `a` into `b` after `b` was added to `a` creates a cycle. Any recursive operation runs forever.

**Fix:** Detect cycles on `add`.

```java
public void add(FsItem item) {
    for (FsItem cur = this; cur != null; cur = cur.parent()) {
        if (cur == item) throw new IllegalArgumentException("cycle");
    }
    kids.add(item); item.setParent(this);
}
```

**Lesson:** Production Composites with mutable parents need cycle detection. The bug is dormant until someone (a user, an import, a typo) creates the cycle.

</details>

---

## Bug 2: Mutable internal list returned

```python
class Folder:
    def __init__(self, name): self.name = name; self._children = []
    def children(self): return self._children   # !
    def add(self, c): self._children.append(c)

f = Folder("root")
f.add(File("a"))
clients = f.children()
clients.clear()   # client just emptied the folder
```

<details><summary>Reveal</summary>

**Bug:** `children()` returns the internal list. Any caller can mutate it directly, bypassing `add`/`remove` invariants.

**Fix:** return a defensive copy or a read-only view.

```python
def children(self): return tuple(self._children)
```

Or in Java:

```java
public List<FsItem> children() { return Collections.unmodifiableList(kids); }
```

**Lesson:** Encapsulate the children list. Returning the internal mutable collection is one of the most common Composite bugs.

</details>

---

## Bug 3: ConcurrentModificationException during traversal

```java
public void deleteEmpty(Folder f) {
    for (FsItem c : f.children()) {
        if (c instanceof Folder sub && sub.children().isEmpty()) {
            f.remove(c);   // mutates while iterating
        }
    }
}
```

<details><summary>Reveal</summary>

**Bug:** The iterator fails fast: `ConcurrentModificationException` when `f.remove(c)` runs.

**Fix:** Collect targets, then remove.

```java
List<FsItem> toRemove = new ArrayList<>();
for (FsItem c : f.children()) {
    if (c instanceof Folder sub && sub.children().isEmpty()) toRemove.add(c);
}
toRemove.forEach(f::remove);
```

Or use `Iterator.remove()` if the underlying list supports it.

**Lesson:** Don't mutate a list while iterating it. Compose the change as a two-pass operation.

</details>

---

## Bug 4: Parent pointer not updated on remove

```java
public class Folder extends FsItem {
    public boolean remove(FsItem item) {
        return kids.remove(item);   // doesn't clear item.parent
    }
}

Folder a = new Folder();
File f = new File("a", 100);
a.add(f);
a.remove(f);
System.out.println(f.parent());   // still 'a' — but it's not a child!
```

<details><summary>Reveal</summary>

**Bug:** `remove` doesn't reset the parent pointer. The item now claims to be a child of `a`, but `a.children()` doesn't contain it. Every operation that walks up via parent (`path()`, "is descendant of...?") gives wrong answers.

**Fix:**

```java
public boolean remove(FsItem item) {
    if (kids.remove(item)) {
        item.setParent(null);
        return true;
    }
    return false;
}
```

**Lesson:** Parent pointers are dual-state with children lists. Every `add` and `remove` must keep them in sync.

</details>

---

## Bug 5: Recursion blows the stack on deep tree

```python
class Folder:
    def size(self) -> int:
        return sum(c.size() for c in self._children)

# Build a 100,000-deep tree.
root = Folder("root")
cur = root
for i in range(100_000):
    nxt = Folder(f"d{i}")
    cur.add(nxt)
    cur = nxt
root.size()   # RecursionError
```

<details><summary>Reveal</summary>

**Bug:** Recursive `size` exceeds Python's recursion limit (default 1000). `RecursionError` is raised.

**Fix:** Use iterative traversal.

```python
def size(self) -> int:
    total = 0
    stack = [self]
    while stack:
        n = stack.pop()
        if isinstance(n, Folder):
            stack.extend(n._children)
        else:
            total += n.size()
    return total
```

Or, if the tree is built from untrusted input (zip, archive, JSON), bound depth at parse time.

**Lesson:** Deep trees are a real attack vector. Use iterative traversal in production code that handles untrusted data.

</details>

---

## Bug 6: Component shared between two parents

```python
shared = File("shared.txt", 1024)

a = Folder("a"); a.add(shared)
b = Folder("b"); b.add(shared)

a.remove(shared)
print(b.size())   # works? Or did it remove from b too?
```

<details><summary>Reveal</summary>

**Bug:** Depends on implementation. If `add` simply appends, the file is "in" both folders structurally. Mutations to `shared.size` affect both. Worse, parent pointer is whichever was set last.

**Fix:** Decide and document semantics.

- **Move semantics:** `add` first detaches from old parent. One owner per item.
- **Share semantics:** items can have multiple parents; remove from one doesn't affect another.

Most Composite uses prefer move semantics.

```python
def add(self, item):
    if item.parent is not None:
        item.parent._children.remove(item)
    item.parent = self
    self._children.append(item)
```

**Lesson:** Implicit shared sub-trees are a bug source. Either explicitly support sharing (with documentation) or enforce single-parent.

</details>

---

## Bug 7: instanceof in client code

```java
public long sizeOf(FsItem item) {
    if (item instanceof File f) return f.size();
    if (item instanceof Folder d) return d.children().stream().mapToLong(this::sizeOf).sum();
    throw new IllegalStateException("unknown");
}
```

<details><summary>Reveal</summary>

**Bug:** The whole point of Composite is uniformity. The client checks types, defeating the pattern. Adding `Symlink` requires adding another `if`.

**Fix:** put `size()` on Component; let polymorphism do the work.

```java
public long sizeOf(FsItem item) { return item.size(); }   // 1 line, no checks
```

**Lesson:** `instanceof` against Composite types is a smell. Push the operation into Component (or use Visitor for ops that don't fit).

</details>

---

## Bug 8: Cached size never invalidated

```java
public class Folder {
    private final List<FsItem> kids = new ArrayList<>();
    private long cachedSize = -1;

    public long size() {
        if (cachedSize < 0)
            cachedSize = kids.stream().mapToLong(FsItem::size).sum();
        return cachedSize;
    }

    public void add(FsItem c) { kids.add(c); }   // forgot to invalidate!
}
```

<details><summary>Reveal</summary>

**Bug:** First `size()` caches the result. After `add`, the cache is stale; subsequent `size()` returns the old value.

**Fix:** invalidate on every mutation, propagating up the tree.

```java
public void add(FsItem c) {
    kids.add(c);
    invalidateUp();
}

private void invalidateUp() {
    cachedSize = -1L;
    if (parent() instanceof Folder p) p.invalidateUp();
}
```

**Lesson:** Memoization on a mutable structure must invalidate on every mutation. Forgetting one path silently returns wrong answers.

</details>

---

## Bug 9: Equals/hashCode mutates with children

```java
public class Folder {
    private final List<FsItem> kids = new ArrayList<>();
    @Override public int hashCode() { return Objects.hash(name, kids); }
    @Override public boolean equals(Object o) { ... }
}

Folder f = new Folder("a");
Map<Folder, String> map = new HashMap<>();
map.put(f, "value");
f.add(new File("x", 100));   // hash changes!
map.get(f);   // null — can't find it
```

<details><summary>Reveal</summary>

**Bug:** `hashCode` depends on the mutable child list. Adding a child changes the hash; the entry in the map is now unreachable.

**Fix:** options.
1. Use **identity-based** hash (`System.identityHashCode`).
2. Make the structure **immutable** (children list final and copy-on-write).
3. Don't put mutable Composites in hash-based collections.

**Lesson:** Hashing mutable Composites is dangerous. Decide your equality semantics deliberately.

</details>

---

## Bug 10: Visitor double-visits a shared node

```python
class Visitor:
    def visit(self, node):
        node.accept(self)

def accept(self, v):   # in Section
    v.visit_section(self)
    for c in self.children:
        v.visit(c)

# A shared paragraph appears in two sections (illegally).
p = Paragraph("shared")
section_a.children.append(p)
section_b.children.append(p)

# Walking the tree visits p twice → counted twice.
```

<details><summary>Reveal</summary>

**Bug:** Visitor walks every reachable node. Shared sub-trees are visited multiple times. Counts double, side effects fire twice.

**Fix:** either disallow sharing (move semantics), or track a `visited` set in the visitor.

```python
class Visitor:
    def __init__(self): self.seen = set()
    def visit(self, n):
        if id(n) in self.seen: return
        self.seen.add(id(n))
        n.accept(self)
```

**Lesson:** Composite is a tree; sharing makes it a DAG, and naive traversals double-count. Pick a structural model and enforce it.

</details>

---

## Bug 11: Recursion through symlinks (Go)

```go
type Symlink struct{ name string; target FsItem }
func (s *Symlink) Size() int64 { return s.target.Size() }   // follows!

// Symlink loop:
a := &Folder{name: "a"}
a.children = append(a.children, &Symlink{name: "loop", target: a})
a.Size()   // infinite recursion
```

<details><summary>Reveal</summary>

**Bug:** The symlink follows its target. If the target is an ancestor (loop), traversal recurses forever.

**Fix:** track visited nodes; break on revisit.

```go
func sizeOf(item FsItem, visited map[FsItem]bool) int64 {
    if visited[item] { return 0 }
    visited[item] = true
    if s, ok := item.(*Symlink); ok { return sizeOf(s.target, visited) }
    if d, ok := item.(*Folder); ok {
        var t int64
        for _, c := range d.children { t += sizeOf(c, visited) }
        return t
    }
    return item.Size()
}
```

Or **don't follow symlinks by default** in `size()`; offer a separate `SizeFollow()` if needed.

**Lesson:** Symlinks turn trees into graphs. Default behavior should not follow them; document and opt-in for code that must.

</details>

---

## Bug 12: Reverse children for left-to-right iteration

```go
// "Iterative DFS" but children visited right-to-left:
stack := []FsItem{root}
for len(stack) > 0 {
    n := stack[len(stack)-1]; stack = stack[:len(stack)-1]
    visit(n)
    if d, ok := n.(*Folder); ok {
        for _, c := range d.children {   // BUG: pushed in order
            stack = append(stack, c)
        }
    }
}
```

<details><summary>Reveal</summary>

**Bug:** Pushing children in original order makes them pop in *reverse* order — visit happens right-to-left. Renders, file listings, expected order — all wrong.

**Fix:** push children in reverse so they pop left-to-right.

```go
for i := len(d.children) - 1; i >= 0; i-- {
    stack = append(stack, d.children[i])
}
```

**Lesson:** Iterative DFS must reverse children to preserve left-to-right traversal. Easy to miss; tests with ordered children catch it.

</details>

---

## Practice Tips

- Read each snippet, **stop**, write down what you think is wrong.
- For each bug, ask: "what's the *worst* production impact?" Many Composite bugs (cycles, stale caches, shared sub-tree corruption) are *silent* until specific inputs trigger them.
- After fixing, write a test that *would have caught* the bug. If the test is hard to write, the fix is incomplete.
- Repeat in a week. Composite bugs repeat across codebases.

---

← Back to Composite folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Composite — Optimize](optimize.md)
