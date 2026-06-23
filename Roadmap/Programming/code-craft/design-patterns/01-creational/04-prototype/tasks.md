# Prototype — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/prototype](https://refactoring.guru/design-patterns/prototype)

10 practice tasks with full Go, Java, Python solutions.

---

## Task 1: Basic Shape Cloning

### Java
```java
public abstract class Shape {
    public int x, y; public String color;
    public Shape() {}
    public Shape(Shape o) { if (o != null) { this.x = o.x; this.y = o.y; this.color = o.color; } }
    public abstract Shape clone();
}
public class Circle extends Shape {
    public int radius;
    public Circle() {}
    public Circle(Circle o) { super(o); if (o != null) this.radius = o.radius; }
    public Circle clone() { return new Circle(this); }
}
public class Rectangle extends Shape {
    public int width, height;
    public Rectangle() {}
    public Rectangle(Rectangle o) { super(o); if (o != null) { this.width = o.width; this.height = o.height; } }
    public Rectangle clone() { return new Rectangle(this); }
}
```

### Python
```python
import copy

class Shape:
    def __init__(self, x=0, y=0, color="black"):
        self.x, self.y, self.color = x, y, color

class Circle(Shape):
    def __init__(self, x=0, y=0, color="black", radius=0):
        super().__init__(x, y, color); self.radius = radius

c1 = Circle(10, 20, "red", 5)
c2 = copy.deepcopy(c1)
```

### Go
```go
type Shape interface { Clone() Shape; Print() }

type Circle struct{ X, Y, Radius int; Color string }
func (c *Circle) Clone() Shape { return &Circle{c.X, c.Y, c.Radius, c.Color} }
func (c *Circle) Print()       { fmt.Println(*c) }
```

---

## Task 2: Deep Clone with Nested Lists

### Java
```java
public class Document {
    public String title;
    public List<Section> sections;

    public Document(Document o) {
        this.title = o.title;
        this.sections = o.sections.stream().map(Section::new).collect(Collectors.toList());
    }
    public Document clone() { return new Document(this); }
}
public class Section {
    public String content;
    public List<String> tags;

    public Section(Section o) {
        this.content = o.content;
        this.tags = new ArrayList<>(o.tags);   // copy mutable list
    }
}
```

### Python
```python
@dataclass
class Doc:
    title: str
    sections: list[str]

doc1 = Doc("A", ["intro", "main"])
doc2 = copy.deepcopy(doc1)   # safe deep copy
doc2.sections.append("end")
# doc1.sections still ["intro", "main"]
```

### Go
```go
type Document struct {
    Title    string
    Sections []*Section
}

func (d *Document) Clone() *Document {
    sections := make([]*Section, len(d.Sections))
    for i, s := range d.Sections { sections[i] = s.Clone() }
    return &Document{Title: d.Title, Sections: sections}
}
```

---

## Task 3: Prototype Registry

### Java
```java
public class ShapeRegistry {
    private final Map<String, Shape> protos = new ConcurrentHashMap<>();
    public void register(String name, Shape p) { protos.put(name, p); }
    public Shape create(String name) {
        Shape p = protos.get(name);
        if (p == null) throw new IllegalArgumentException(name);
        return p.clone();
    }
}

ShapeRegistry r = new ShapeRegistry();
Circle c = new Circle(); c.radius = 10; c.color = "red";
r.register("default-circle", c);
Circle c2 = (Circle) r.create("default-circle");   // independent copy
```

### Python
```python
class Registry:
    def __init__(self): self._protos = {}
    def register(self, name, p): self._protos[name] = p
    def create(self, name): return copy.deepcopy(self._protos[name])

r = Registry()
r.register("goblin", Enemy(hp=30, sprite="goblin.png"))
e1 = r.create("goblin"); e2 = r.create("goblin")  # independent
```

### Go
```go
type Registry struct{ protos map[string]Shape; mu sync.RWMutex }

func NewRegistry() *Registry { return &Registry{protos: map[string]Shape{}} }
func (r *Registry) Register(name string, p Shape) { r.mu.Lock(); defer r.mu.Unlock(); r.protos[name] = p }
func (r *Registry) Create(name string) Shape    { r.mu.RLock(); defer r.mu.RUnlock(); return r.protos[name].Clone() }
```

---

## Task 4: Cyclic Graph Clone

### Python
```python
class Node:
    def __init__(self, value): self.value = value; self.neighbors = []
    def __deepcopy__(self, memo):
        if id(self) in memo: return memo[id(self)]
        new = Node(self.value); memo[id(self)] = new
        new.neighbors = [copy.deepcopy(n, memo) for n in self.neighbors]
        return new

a = Node("A"); b = Node("B")
a.neighbors.append(b); b.neighbors.append(a)
a2 = copy.deepcopy(a)   # works, no infinite recursion
```

### Java
```java
public Node deepClone() { return deepClone(new HashMap<>()); }
private Node deepClone(Map<Node, Node> memo) {
    if (memo.containsKey(this)) return memo.get(this);
    Node n = new Node(this.value); memo.put(this, n);
    for (Node neighbor : this.neighbors) n.neighbors.add(neighbor.deepClone(memo));
    return n;
}
```

### Go
```go
func (n *Node) Clone() *Node { return n.cloneWithMemo(map[*Node]*Node{}) }
func (n *Node) cloneWithMemo(memo map[*Node]*Node) *Node {
    if c, ok := memo[n]; ok { return c }
    nc := &Node{Value: n.Value}
    memo[n] = nc
    for _, nb := range n.Neighbors {
        nc.Neighbors = append(nc.Neighbors, nb.cloneWithMemo(memo))
    }
    return nc
}
```

---

## Task 5: Game Enemy Spawner with Prototype

### Python
```python
class Enemy:
    def __init__(self, hp, speed, sprite, attack):
        self.hp = hp; self.speed = speed; self.sprite = sprite; self.attack = attack
        self.x, self.y = 0, 0

class Game:
    def __init__(self):
        self.protos = {
            "goblin": Enemy(30, 5, load_sprite("goblin.png"), Attack("bite", 5)),
            "orc":    Enemy(80, 3, load_sprite("orc.png"),    Attack("club", 12)),
        }

    def spawn(self, kind: str, x: int, y: int) -> Enemy:
        e = copy.deepcopy(self.protos[kind])
        e.x, e.y = x, y
        return e
```

### Java
```java
class EnemySpawner {
    private final Map<String, Enemy> protos = new HashMap<>();
    public void register(String kind, Enemy proto) { protos.put(kind, proto); }
    public Enemy spawn(String kind, int x, int y) {
        Enemy e = protos.get(kind).clone();
        e.x = x; e.y = y;
        return e;
    }
}
```

---

## Task 6: Configuration Variants

### Python
```python
base = AppConfig(db_url="...", cache_size=100, debug=False, ...)
dev      = copy.deepcopy(base); dev.debug = True
staging  = copy.deepcopy(base); staging.cache_size = 1000
prod     = copy.deepcopy(base); prod.cache_size = 10000

# Or with dataclass.replace:
from dataclasses import replace
dev2 = replace(base, debug=True)   # cleaner if base is immutable
```

---

## Task 7: Snapshot for Undo/Redo

### Java
```java
public class TextEditor {
    private String text = "";
    private final Deque<String> history = new ArrayDeque<>();

    public void save() { history.push(text); }   // strings are immutable; share
    public void edit(String append) { text += append; }
    public void undo() { if (!history.isEmpty()) text = history.pop(); }
}
```

For mutable state, snapshot via clone.

---

## Task 8: COW Wrapper

### Java
```java
public final class CowList<T> {
    private List<T> items;
    private boolean owned;
    public CowList(List<T> source) { this.items = source; this.owned = false; }
    public CowList<T> clone() { CowList<T> c = new CowList<>(items); c.owned = false; return c; }
    public synchronized void add(T item) {
        if (!owned) { items = new ArrayList<>(items); owned = true; }
        items.add(item);
    }
    public T get(int i) { return items.get(i); }
}
```

`clone()` is O(1). First mutation triggers O(n) copy.

---

## Task 9: Prototype + Factory Method

### Java
```java
public abstract class ShapeFactory {
    abstract Shape create();
}

public class CircleFactory extends ShapeFactory {
    private final Circle proto;
    public CircleFactory(Circle proto) { this.proto = proto; }
    public Shape create() { return proto.clone(); }   // factory backed by prototype
}
```

Factory's `create()` clones the prototype — combining the patterns.

---

## Task 10: Selective Deep Copy

### Python
```python
class Document:
    def __init__(self):
        self.title = ""
        self.large_cache = {}     # immutable bytes — shared safely
        self.sections = []        # mutable — must clone

    def __deepcopy__(self, memo):
        new = Document()
        new.title = self.title
        new.large_cache = self.large_cache       # shared (saves memory)
        new.sections = copy.deepcopy(self.sections, memo)
        return new
```

Selective: clone what's mutable, share what's immutable.

---

## Practice Tips

1. **Test independence:** mutate clone, original unchanged.
2. **Test depth:** mutate nested structures, original unchanged for deep clone.
3. **Test cycle handling:** clone a cyclic graph, verify no infinite loop.
4. **Run benchmarks** for hot-path clones.
5. **Document shallow vs deep semantics** in comments.

---

[← Interview](interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
