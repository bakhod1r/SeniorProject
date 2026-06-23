# Prototype — Find the Bug

> **Source:** [refactoring.guru/design-patterns/prototype](https://refactoring.guru/design-patterns/prototype)

12 buggy snippets across Go, Java, Python.

---

## Bug 1: Returning `this` Instead of Copy (Java)

```java
public Shape clone() { return this; }   // BUG
```

**Symptom:** Two "clones" mutate each other.

### Fix
```java
public Shape clone() { return new Shape(this); }
```

### Lesson
Always return a fresh instance.

---

## Bug 2: Shallow Clone of Mutable Field (Java)

```java
public class Document {
    public List<String> sections;
    public Document(Document o) {
        this.sections = o.sections;   // BUG: shared reference
    }
}
```

**Symptom:** Mutating `clone.sections` mutates `original.sections`.

### Fix
```java
this.sections = new ArrayList<>(o.sections);
```

### Lesson
Defensive copy mutable collections.

---

## Bug 3: Forgot to Override `clone()` in Subclass (Java)

```java
abstract class Shape { public abstract Shape clone(); }
class Circle extends Shape {
    int radius;
    public Shape clone() { return new Circle(); }   // BUG: doesn't copy radius
}
```

**Symptom:** Cloned circles have `radius = 0`.

### Fix
```java
public Circle clone() {
    Circle c = new Circle();
    c.radius = this.radius;
    return c;
}
// Or via copy constructor.
```

### Lesson
Each subclass must clone its own fields.

---

## Bug 4: Java's `Object.clone` Skipping Constructor (Java)

```java
public class CounterShape implements Cloneable {
    public static int count = 0;
    public int id;
    public CounterShape() { this.id = ++count; }
    public Object clone() throws CloneNotSupportedException { return super.clone(); }
}

CounterShape c1 = new CounterShape();   // count=1, id=1
CounterShape c2 = (CounterShape) c1.clone();   // BUG: count still 1, id=1
```

**Symptom:** Counter not incremented; `c2.id == c1.id`.

### Fix — copy constructor
```java
public CounterShape clone() {
    CounterShape c = new CounterShape();   // ctor runs; count++
    c.id = this.id;   // or generate new id
    return c;
}
```

### Lesson
`Object.clone()` skips constructor. Use copy constructor for proper initialization.

---

## Bug 5: Slice Sharing in Go (Go)

```go
func (c *Config) Clone() *Config {
    return &Config{
        Tags: c.Tags,   // BUG: shared slice
    }
}
```

**Symptom:** `clone.Tags = append(clone.Tags, "x")` may mutate original (if capacity allows).

### Fix
```go
Tags: append([]string(nil), c.Tags...)
```

### Lesson
Go's `=` is shallow for slices; explicit copy needed.

---

## Bug 6: Map Sharing in Go (Go)

```go
func (c *Config) Clone() *Config {
    return &Config{Flags: c.Flags}   // BUG: shared map
}
```

**Symptom:** Setting `clone.Flags["x"] = true` mutates original.

### Fix
```go
flags := make(map[string]bool, len(c.Flags))
for k, v := range c.Flags { flags[k] = v }
return &Config{Flags: flags}
```

### Lesson
Go maps must be explicitly copied.

---

## Bug 7: Cycle Without Memo in Python (Python)

```python
class Node:
    def __init__(self, value):
        self.value = value
        self.neighbors = []

    def __deepcopy__(self, memo):
        new = Node(self.value)
        new.neighbors = [copy.deepcopy(n) for n in self.neighbors]   # BUG: no memo
        return new

a = Node("A"); b = Node("B")
a.neighbors.append(b); b.neighbors.append(a)
copy.deepcopy(a)   # RecursionError
```

**Symptom:** Stack overflow on cyclic graphs.

### Fix
```python
def __deepcopy__(self, memo):
    if id(self) in memo: return memo[id(self)]
    new = Node(self.value); memo[id(self)] = new
    new.neighbors = [copy.deepcopy(n, memo) for n in self.neighbors]
    return new
```

### Lesson
Use memo to handle cycles.

---

## Bug 8: Cloning External Resources (Java)

```java
public class FileWriter implements Cloneable {
    public Path path;
    public java.io.FileWriter writer;   // open file handle
    public Object clone() throws CloneNotSupportedException {
        return super.clone();   // BUG: shares the file handle
    }
}
```

**Symptom:** Both clones write to the same file; closing one closes the other; corruption.

### Fix
```java
public FileWriter clone() throws IOException {
    FileWriter fw = new FileWriter();
    fw.path = this.path;
    fw.writer = new java.io.FileWriter(this.path, true);   // fresh handle
    return fw;
}
```

### Lesson
External resources need fresh instances; don't share.

---

## Bug 9: Cloning Listener Lists (Java)

```java
public class Observable implements Cloneable {
    private final List<Listener> listeners = new ArrayList<>();
    public Object clone() throws CloneNotSupportedException {
        return super.clone();   // BUG: shares listeners
    }
}
```

**Symptom:** Cloning an Observable causes events to fire twice (one for each shared listener entry).

### Fix
```java
public Observable clone() {
    Observable o = new Observable();
    // Don't share listeners; let caller re-subscribe.
    return o;
}
```

Or keep listeners separately keyed.

### Lesson
Cloning callback registrations is usually wrong. Decide intentionally.

---

## Bug 10: Shallow Clone of Date (Java)

```java
public class Event implements Cloneable {
    public java.util.Date when;   // mutable!
    public Object clone() throws CloneNotSupportedException {
        return super.clone();   // BUG: shared Date
    }
}
```

**Symptom:** `clone.when.setTime(...)` mutates original's `when`.

### Fix
```java
public Event clone() {
    Event e = new Event();
    e.when = (Date) this.when.clone();   // Date is Cloneable + mutable
    return e;
}
```

Or use `Instant` (immutable) and skip the deep clone.

### Lesson
Mutable types in fields require explicit deep copy. Prefer immutable types (`Instant`, `LocalDateTime`).

---

## Bug 11: Prototype Registry Race (Go)

```go
type Registry struct {
    protos map[string]Shape   // BUG: no synchronization
}

func (r *Registry) Register(name string, p Shape) { r.protos[name] = p }
func (r *Registry) Create(name string) Shape     { return r.protos[name].Clone() }
```

**Symptom:** `go test -race` reports race; potential panic on concurrent map write.

### Fix
```go
type Registry struct {
    protos map[string]Shape
    mu     sync.RWMutex
}
func (r *Registry) Register(name string, p Shape) { r.mu.Lock(); defer r.mu.Unlock(); r.protos[name] = p }
func (r *Registry) Create(name string) Shape     { r.mu.RLock(); defer r.mu.RUnlock(); return r.protos[name].Clone() }
```

### Lesson
Concurrent registries need locks (or `sync.Map`).

---

## Bug 12: Cloning Singleton (Java)

```java
public final class Logger implements Cloneable {
    private static final Logger INSTANCE = new Logger();
    private Logger() {}
    public static Logger getInstance() { return INSTANCE; }
    public Object clone() throws CloneNotSupportedException {
        return super.clone();   // BUG: creates a second Logger
    }
}
```

**Symptom:** `Logger.getInstance().clone()` returns a different Logger; singleton invariant broken.

### Fix
```java
public Object clone() throws CloneNotSupportedException {
    throw new CloneNotSupportedException("Singleton cannot be cloned");
}
```

### Lesson
Singletons must explicitly forbid cloning.

---

## Practice Tips

1. **Run `go test -race`** for any Go Prototype code.
2. **Test mutation independence** — mutate clone, assert original unchanged.
3. **Test cycle handling** — clone cyclic graphs.
4. **Test resource handling** — verify fresh handles, not shared.
5. **Use `final` / immutable types** to avoid the deep-clone problem entirely.

---

[← Tasks](tasks.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
