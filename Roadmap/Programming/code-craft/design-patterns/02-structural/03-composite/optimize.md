# Composite — Optimize

> **Source:** [refactoring.guru/design-patterns/composite](https://refactoring.guru/design-patterns/composite)

Each section presents a Composite that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Memoize recursive aggregation](#optimization-1-memoize-recursive-aggregation)
2. [Optimization 2: Iterative traversal for deep trees](#optimization-2-iterative-traversal-for-deep-trees)
3. [Optimization 3: Pre-size children list](#optimization-3-pre-size-children-list)
4. [Optimization 4: Side-index for fast lookup](#optimization-4-side-index-for-fast-lookup)
5. Optimization 5: __slots__ for million-node Python
6. [Optimization 6: Snapshot iteration to avoid CME](#optimization-6-snapshot-iteration-to-avoid-cme)
7. [Optimization 7: Batched leaf operations](#optimization-7-batched-leaf-operations)
8. [Optimization 8: Flyweight leaves](#optimization-8-flyweight-leaves)
9. [Optimization 9: Persistent / structural-sharing](#optimization-9-persistent-structural-sharing)
10. [Optimization 10: Data-oriented rewrite for hot loops](#optimization-10-data-oriented-rewrite-for-hot-loops)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Memoize recursive aggregation

### Before

```java
public long size() {
    return kids.stream().mapToLong(FsItem::size).sum();   // recomputes every call
}
```

If `size()` is called many times on the same tree (UI rendering, search, dashboards), every call walks the whole subtree.

### After

```java
private long cachedSize = -1L;

public long size() {
    if (cachedSize < 0) cachedSize = kids.stream().mapToLong(FsItem::size).sum();
    return cachedSize;
}

public void add(FsItem c) {
    kids.add(c);
    invalidateUp();
}

private void invalidateUp() {
    cachedSize = -1L;
    if (parent() instanceof Folder p) p.invalidateUp();
}
```

**Measurement.** A UI calling `size()` 100×/frame on a 10k-node tree: O(N) each call → O(1) with cache. Frame budget reclaimed.

**Lesson:** Memoize idempotent aggregations. Always invalidate on mutation, propagating up.

---

## Optimization 2: Iterative traversal for deep trees

### Before

```python
def walk(node):
    yield node
    for c in getattr(node, "children", ()):
        yield from walk(c)
```

Python recursion limit caps at ~1000. Deep trees crash.

### After

```python
def walk(root):
    stack = [root]
    while stack:
        n = stack.pop()
        yield n
        for c in reversed(getattr(n, "children", ())):
            stack.append(c)
```

**Measurement.** Tree depth 100,000: recursive crashes; iterative completes. Throughput slightly higher even on shallow trees (no per-call frame setup).

**Lesson:** Production code that handles untrusted/unbounded depth must use iterative traversal.

---

## Optimization 3: Pre-size children list

### Before

```java
public class Folder {
    private final List<FsItem> kids = new ArrayList<>();   // default size 10
}

// Building a folder with 1000 known children:
Folder d = new Folder();
for (FsItem c : thousand) d.add(c);
```

Each `add` past capacity triggers an array copy (10 → 16 → 24 → ...). Building a 1000-child folder allocates ~10 backing arrays.

### After

```java
public Folder(int expected) {
    this.kids = new ArrayList<>(expected);
}

Folder d = new Folder(1000);
```

Or builder pattern:

```java
public static Folder of(FsItem... items) {
    var d = new Folder(items.length);
    for (var i : items) d.add(i);
    return d;
}
```

**Measurement.** Building 100k-child trees: allocations drop ~50%; build time drops 20-30%.

**Lesson:** When building bulk Composites, pre-size collections. Same advice as any container code.

---

## Optimization 4: Side-index for fast lookup

### Before

```python
def find_by_id(root, target_id):
    for n in walk(root):
        if n.id == target_id: return n
    return None
```

O(N) per lookup. Repeated lookups in a UI scroll/click handler dominate.

### After

```python
class IndexedTree:
    def __init__(self, root):
        self._root = root
        self._index = {n.id: n for n in walk(root)}

    def find_by_id(self, target_id):
        return self._index.get(target_id)

    def add(self, parent_id, node):
        self._index[parent_id]._children.append(node)
        self._index[node.id] = node
```

**Measurement.** Lookups go from O(N) to O(1). Memory overhead: one dict. Worth it once N > a few hundred and lookups are frequent.

**Lesson:** Composites are trees by structure but often need flat-index views for lookups. Build the index alongside the tree.

---

## Optimization 5: __slots__ for million-node Python

### Before

```python
class Node:
    def __init__(self, name): self.name = name; self.children = []
```

Each `Node` has a per-instance `__dict__` (~104 bytes overhead). 1M nodes ≈ 200+ MB.

### After

```python
class Node:
    __slots__ = ("name", "children")
    def __init__(self, name): self.name = name; self.children = []
```

**Measurement.** Memory drops to ~30-50 MB for 1M nodes. Slight CPU win too (attribute access is faster).

**Lesson:** Large Python Composites should use `__slots__`. Easy win, no API change.

---

## Optimization 6: Snapshot iteration to avoid CME

### Before

```java
for (FsItem c : folder.children()) {
    if (c.shouldDelete()) folder.remove(c);   // throws CME
}
```

### After

```java
List<FsItem> snapshot = List.copyOf(folder.children());
for (FsItem c : snapshot) {
    if (c.shouldDelete()) folder.remove(c);
}
```

Or iterate with `Iterator.remove()` if the underlying collection supports it.

**Measurement.** Snapshot cost: one list copy (small relative to traversal). No exceptions.

**Lesson:** Don't mutate during iteration. Snapshot or two-pass.

---

## Optimization 7: Batched leaf operations

### Before

```java
public void renderAll(Folder root, Renderer r) {
    for (FsItem c : root.children()) {
        if (c instanceof Folder d) renderAll(d, r);
        else r.render(c);   // 1 call per leaf
    }
}
```

### After (when the renderer supports it)

```java
public void renderAll(Folder root, Renderer r) {
    List<File> leaves = collectLeaves(root);
    r.renderBatch(leaves);
}
```

**Cost.** Per-call overhead, GPU command-buffer flushes, network round trips. Batched: one cost, amortized.

**Measurement.** OpenGL renderer: 4 ms/frame → 0.4 ms/frame. Database batch insert: 100× faster.

**Lesson:** Composite hides per-leaf calls; batch when the underlying API supports it.

---

## Optimization 8: Flyweight leaves

### Before

```python
class Glyph:
    def __init__(self, char, font, size, color):
        self.char = char; self.font = font; self.size = size; self.color = color

# A page of text is a Composite of Glyphs:
page = Section()
for char in "the quick brown fox..." * 1000:
    page.add(Glyph(char, default_font, 12, "#000"))
```

Each glyph stores a font/size/color reference even though they're the same.

### After

```python
class Glyph:
    __slots__ = ("char",)
    def __init__(self, char): self.char = char

class Page(Section):
    def __init__(self, font, size, color):
        super().__init__()
        self.style = (font, size, color)   # extrinsic state shared
```

Glyphs are tiny; the Page holds the shared style; rendering combines them.

**Measurement.** Glyph memory: 5× smaller. With 1M glyphs, 50 MB → 10 MB.

**Lesson:** When leaves share state, factor it out (Flyweight pattern). Composite + Flyweight is a powerful combination.

---

## Optimization 9: Persistent / structural-sharing

### Before

```java
public Folder withAdded(FsItem item) {
    var next = new ArrayList<>(children);   // O(N) copy
    next.add(item);
    return new Folder(name, next);
}
```

Every "mutation" copies the entire children list. For a 10k-child folder, that's 10k pointers per change.

### After (Persistent vector via Clojure/Vavr)

```java
import io.vavr.collection.Vector;

public final class Folder {
    private final String name;
    private final Vector<FsItem> children;

    public Folder(String name, Vector<FsItem> children) {
        this.name = name; this.children = children;
    }

    public Folder withAdded(FsItem item) {
        return new Folder(name, children.append(item));   // O(log N) with structural sharing
    }
}
```

**Measurement.** Mutation cost: O(N) → O(log N). Memory: shared subtrees not duplicated.

**Lesson:** Immutable Composites at scale need persistent data structures. Use Vavr (Java), Clojure (JVM), or Immer (JS).

---

## Optimization 10: Data-oriented rewrite for hot loops

### Before

```cpp
// Game scene graph: 1M sprites, 60 fps
for (auto& sprite : root_node->descendants()) {
    sprite->update();
    sprite->render();
}
```

Virtual dispatch + pointer chasing dominate. Per-frame: ~15 ms (target: 16 ms). One regression breaks the budget.

### After

```cpp
// Same data, struct-of-arrays:
std::vector<glm::vec2> positions;   // contiguous
std::vector<glm::vec2> velocities;
std::vector<TextureID>  textures;

// Tight loop, vectorizable:
for (size_t i = 0; i < positions.size(); ++i) {
    positions[i] += velocities[i] * dt;
}
gpu.render_batch(positions, textures);
```

Composite stays for editor/structure code; runtime hot path is data-oriented.

**Measurement.** Frame time drops from ~15 ms to ~3 ms. CPU cache utilization improves dramatically.

**Lesson:** Composite has a performance ceiling for million-element hot paths. ECS/DOD complements it for the 1% of code that drives 99% of CPU.

---

## Optimization Tips

1. **Profile first.** Composite is rarely the bottleneck for application code; usually the *work per node* dominates.
2. **Memoize idempotent aggregates.** Cache `size()`, `count()`, `bounds()` — invalidate on mutation.
3. **Iterative > recursive for deep / untrusted trees.** Avoid stack overflow and recursion limits.
4. **Pre-size collections** when bulk-building.
5. **Side-index for fast lookups.** Trees are great for hierarchies; dicts are great for IDs. Use both.
6. **`__slots__` for big Python Composites.** Free memory win.
7. **Snapshot before mutating during iteration.** Avoids CME and "deleted while iterated" bugs.
8. **Batch leaf operations** when the underlying API supports it.
9. **Flyweight leaves** when state is shared across many.
10. **Persistent data structures** for immutable Composites at scale.
11. **Data-oriented rewrite for million-element hot paths.** Composite for structure; flat arrays for runtime.
12. **Optimize for change too.** A clean Composite that's easy to extend is more valuable than a tweaked one no one understands.

---

← Back to Composite folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**You've completed the Composite pattern suite.** Continue to: [Decorator](../04-decorator/junior.md) · [Facade](../05-facade/junior.md) · [Flyweight](../06-flyweight/junior.md) · [Proxy](../07-proxy/junior.md)
