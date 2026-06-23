# Composite — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/composite](https://refactoring.guru/design-patterns/composite)

Each task includes a brief, the structure, and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: File System (size + print)](#task-1-file-system-size-print)
2. [Task 2: Document Outline (word count)](#task-2-document-outline-word-count)
3. [Task 3: Expression Tree (evaluator)](#task-3-expression-tree-evaluator)
4. [Task 4: Bundle Pricing](#task-4-bundle-pricing)
5. [Task 5: Iterative Walker](#task-5-iterative-walker)
6. [Task 6: Cycle Detection](#task-6-cycle-detection)
7. [Task 7: Visitor Pattern (HTML render)](#task-7-visitor-pattern-html-render)
8. [Task 8: Org Chart (head-count)](#task-8-org-chart-head-count)
9. [Task 9: Immutable Folder](#task-9-immutable-folder)
10. [Task 10: Persistent BOM (with sharing)](#task-10-persistent-bom-with-sharing)
11. [How to Practice](#how-to-practice)

---

## Task 1: File System (size + print)

**Brief.** `File` and `Folder` share `FsItem`. `Folder.size()` recurses; `Folder.print()` shows the tree.

### Solution (Go)

```go
type FsItem interface {
    Name() string
    Size() int64
    Print(indent string)
}

type File struct{ name string; size int64 }
func (f *File) Name() string { return f.name }
func (f *File) Size() int64  { return f.size }
func (f *File) Print(indent string) {
    fmt.Printf("%s- %s (%d)\n", indent, f.name, f.size)
}

type Folder struct{ name string; kids []FsItem }
func (d *Folder) Name() string { return d.name }
func (d *Folder) Size() int64 {
    var t int64
    for _, c := range d.kids { t += c.Size() }
    return t
}
func (d *Folder) Print(indent string) {
    fmt.Printf("%s+ %s/ (%d)\n", indent, d.name, d.Size())
    for _, c := range d.kids { c.Print(indent + "  ") }
}
func (d *Folder) Add(c FsItem) { d.kids = append(d.kids, c) }
```

---

## Task 2: Document Outline (word count)

**Brief.** A document has sections; sections have subsections and paragraphs. Count total words.

### Solution (Python)

```python
class Item:
    def words(self) -> int: ...

class Paragraph(Item):
    def __init__(self, text: str): self.text = text
    def words(self) -> int: return len(self.text.split())

class Section(Item):
    def __init__(self, title: str):
        self.title = title
        self.children: list[Item] = []
    def add(self, x: Item): self.children.append(x)
    def words(self) -> int:
        return sum(c.words() for c in self.children)

doc = Section("Doc")
intro = Section("Intro"); intro.add(Paragraph("hello world how are you"))
body  = Section("Body");  body.add(Paragraph("composite pattern is useful"))
doc.add(intro); doc.add(body)
print(doc.words())  # 10
```

---

## Task 3: Expression Tree (evaluator)

**Brief.** Build a tree of arithmetic operations and evaluate it.

### Solution (Java)

```java
public interface Expr { double eval(); }

public final class Num implements Expr {
    private final double v;
    public Num(double v) { this.v = v; }
    public double eval() { return v; }
}

public abstract class BinOp implements Expr {
    protected final Expr lhs, rhs;
    protected BinOp(Expr l, Expr r) { lhs = l; rhs = r; }
}

public final class Add extends BinOp {
    public Add(Expr l, Expr r) { super(l, r); }
    public double eval() { return lhs.eval() + rhs.eval(); }
}
public final class Mul extends BinOp {
    public Mul(Expr l, Expr r) { super(l, r); }
    public double eval() { return lhs.eval() * rhs.eval(); }
}

// (2 + 3) * 4
Expr e = new Mul(new Add(new Num(2), new Num(3)), new Num(4));
System.out.println(e.eval());   // 20.0
```

---

## Task 4: Bundle Pricing

**Brief.** A line item is either a single product (with a price) or a bundle of items. Compute total.

### Solution (Python)

```python
class Item:
    def price(self) -> int: ...

class Product(Item):
    def __init__(self, p: int): self._p = p
    def price(self) -> int: return self._p

class Bundle(Item):
    def __init__(self, items: list[Item]): self._items = items
    def price(self) -> int: return sum(i.price() for i in self._items)

# 200 + (100 + 50) = 350
order = Bundle([Product(200), Bundle([Product(100), Product(50)])])
print(order.price())  # 350
```

---

## Task 5: Iterative Walker

**Brief.** Walk a tree without recursion. Useful for deep trees.

### Solution (Python generator)

```python
def walk(root):
    """Depth-first, pre-order, no recursion."""
    stack = [root]
    while stack:
        n = stack.pop()
        yield n
        for c in reversed(getattr(n, "children", ())):
            stack.append(c)
```

Use:

```python
for node in walk(root):
    print(node)
```

---

## Task 6: Cycle Detection

**Brief.** Adding an item to a folder must fail if it would create a cycle.

### Solution (Java)

```java
public abstract class FsItem {
    private FsItem parent;
    public FsItem parent() { return parent; }
    void setParent(FsItem p) { this.parent = p; }
}

public class Folder extends FsItem {
    private final List<FsItem> kids = new ArrayList<>();

    public void add(FsItem item) {
        for (FsItem cur = this; cur != null; cur = cur.parent()) {
            if (cur == item) throw new IllegalArgumentException("cycle");
        }
        if (item.parent() instanceof Folder old) old.kids.remove(item);
        item.setParent(this);
        kids.add(item);
    }
}
```

Test:

```java
Folder a = new Folder();
Folder b = new Folder();
a.add(b);
assertThrows(IllegalArgumentException.class, () -> b.add(a));
```

---

## Task 7: Visitor Pattern (HTML render)

**Brief.** A document outline + visitor that renders to HTML.

### Solution (Python)

```python
class Visitor:
    def visit_paragraph(self, p): ...
    def visit_section(self, s): ...

class HtmlRenderer(Visitor):
    def __init__(self): self.parts = []
    def visit_paragraph(self, p): self.parts.append(f"<p>{p.text}</p>")
    def visit_section(self, s):
        self.parts.append(f"<h2>{s.title}</h2>")
        for c in s.children: c.accept(self)
    def html(self): return "\n".join(self.parts)


class Paragraph:
    def __init__(self, t: str): self.text = t
    def accept(self, v): v.visit_paragraph(self)

class Section:
    def __init__(self, t: str):
        self.title = t; self.children = []
    def accept(self, v): v.visit_section(self)


root = Section("Doc")
root.children.append(Paragraph("Hello world"))
r = HtmlRenderer(); root.accept(r); print(r.html())
```

---

## Task 8: Org Chart (head-count)

**Brief.** Employee, Manager (which has reports). Count total people in a subtree.

### Solution (Go)

```go
type Person interface {
    HeadCount() int
    Name() string
}

type Employee struct{ name string }
func (e Employee) HeadCount() int { return 1 }
func (e Employee) Name() string   { return e.name }

type Manager struct {
    name    string
    reports []Person
}
func (m *Manager) HeadCount() int {
    c := 1
    for _, r := range m.reports { c += r.HeadCount() }
    return c
}
func (m *Manager) Name() string { return m.name }
func (m *Manager) Add(p Person) { m.reports = append(m.reports, p) }

ceo := &Manager{name: "CEO"}
vp  := &Manager{name: "VP-Eng"}
vp.Add(Employee{name: "Alice"})
vp.Add(Employee{name: "Bob"})
ceo.Add(vp)
ceo.Add(Employee{name: "Carol"})
fmt.Println(ceo.HeadCount())  // 4
```

---

## Task 9: Immutable Folder

**Brief.** Mutations return new folders without modifying the old.

### Solution (Java)

```java
public final class Folder {
    private final String name;
    private final List<FsItem> kids;

    public Folder(String name, List<FsItem> kids) {
        this.name = name;
        this.kids = List.copyOf(kids);
    }

    public Folder withAdded(FsItem x) {
        var next = new ArrayList<>(kids);
        next.add(x);
        return new Folder(name, next);
    }

    public Folder without(FsItem x) {
        var next = new ArrayList<>(kids);
        next.remove(x);
        return new Folder(name, next);
    }

    public long size() { return kids.stream().mapToLong(FsItem::size).sum(); }
}
```

Test:

```java
Folder v1 = new Folder("root", List.of());
Folder v2 = v1.withAdded(new File("a", 100));
assert v1.size() == 0;
assert v2.size() == 100;
```

---

## Task 10: Persistent BOM (with sharing)

**Brief.** A bill of materials (BOM) where sub-assemblies are shared between products without copying.

### Solution (Python)

```python
from typing import Tuple


class Part:
    __slots__ = ("name", "cost_cents")
    def __init__(self, name: str, cost_cents: int):
        self.name, self.cost_cents = name, cost_cents
    def cost(self) -> int: return self.cost_cents


class Assembly:
    __slots__ = ("name", "parts")
    def __init__(self, name: str, parts: Tuple):
        self.name, self.parts = name, tuple(parts)   # immutable
    def cost(self) -> int:
        return sum(p.cost() for p in self.parts)


# Shared sub-assembly:
piston = Assembly("piston", (Part("ring", 200), Part("bolt", 50)))

engine_v6  = Assembly("V6 engine",  (piston, piston, piston, piston, piston, piston))
engine_v8  = Assembly("V8 engine",  (piston,) * 8)

# `piston` is one object, referenced 14 times. Modify nothing — perfectly safe.
print(engine_v6.cost())   # 1500
print(engine_v8.cost())   # 2000
```

### Notice

- Tuples (immutable) instead of lists.
- Shared `piston` is safe because nothing can mutate it.
- "Modifying" requires building a new `Assembly` with new `parts`.

---

## How to Practice

1. **Try each task without looking at the solution.** Then compare.
2. **Test with structural fixtures.** Build a small DSL: `folder("root", file(...), folder(...))`.
3. **Add cycle tests** to any mutable Composite — even toy ones.
4. **Convert one mutable Composite to immutable.** Note where the API gets uglier and where it gets cleaner.
5. **Add a new node type** to one of your trees. Confirm it's a one-class addition.
6. **Run a Visitor over each tree** for one new operation. Notice how the structure is untouched.
7. **Profile a 100k-node tree.** See whether recursion or list iteration dominates; learn what to optimize.

---

← Back to Composite folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Composite — Find the Bug](find-bug.md)
