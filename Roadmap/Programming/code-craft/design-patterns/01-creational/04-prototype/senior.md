# Prototype — Senior Level

> **Source:** [refactoring.guru/design-patterns/prototype](https://refactoring.guru/design-patterns/prototype)
> **Prerequisites:** [Junior](junior.md) · [Middle](middle.md)

---

## Introduction

Prototype at the senior level intersects with **memory, performance, and cross-cutting concerns**: the cost of deep clones, structural sharing tricks, copy-on-write semantics, and prototype-based architecture decisions (registry pattern, prototype + factory composition).

---

## Architectural Patterns

### Prototype + Registry

```java
public final class PrototypeRegistry {
    private final Map<String, Prototype> registry = new ConcurrentHashMap<>();

    public void register(String name, Prototype p) { registry.put(name, p); }
    public Prototype create(String name) {
        Prototype p = registry.get(name);
        if (p == null) throw new IllegalArgumentException(name);
        return p.clone();
    }
}
```

The registry is essentially a typed factory whose backing implementation is "look up the prototype, clone it." Adding a variant = registering a new prototype, no new class.

### Prototype + Abstract Factory

Abstract Factory's products may be Prototypes:

```java
class ButtonProtoFactory {
    private final Button winProto = new WindowsButton(/* configured */);
    public Button create() { return winProto.clone(); }
}
```

Construction reduces to a clone — useful when products are heavy.

### Prototype + Composite

Cloning a composite tree: each node clones itself + recursively clones children.

```python
class TreeNode:
    def __init__(self): self.children = []
    def __deepcopy__(self, memo):
        new = TreeNode()
        memo[id(self)] = new
        new.children = [copy.deepcopy(c, memo) for c in self.children]
        return new
```

Recursive clone is natural for trees.

### Prototype-based Configuration

```python
class FeatureFlags:
    def __init__(self):
        self.debug = False
        self.experimental = {}
    def __deepcopy__(self, memo):
        new = FeatureFlags()
        new.debug = self.debug
        new.experimental = self.experimental.copy()
        return new

# Base prototype
base = FeatureFlags()
base.debug = False

# Per-tenant variants
tenant_a = copy.deepcopy(base)
tenant_a.experimental["new-ui"] = True
```

---

## Performance Considerations

### Cost of Deep Clone

Deep clone is O(n) in object graph size. For 1M-node tree: hundreds of microseconds.

### Mitigations

1. **Selective deep copy.** Identify which fields really need fresh copies; share immutable.
2. **Persistent data structures.** Scala/Clojure immutable maps share structure; "copy" is O(log n) for maps, O(1) for lists with cons.
3. **Copy-on-Write.** Treat the clone as read-only; only allocate fresh memory when modified.

### Copy-on-Write (COW)

```python
class CowList:
    def __init__(self, source: list = None):
        self._items = source if source is not None else []
        self._owned = source is None

    def append(self, item):
        if not self._owned:
            self._items = list(self._items)   # copy now
            self._owned = True
        self._items.append(item)
```

Until first mutation, the "clone" shares storage. First mutation copies.

Used in OS kernels (fork()), Linux's `mmap`, Java's `CopyOnWriteArrayList`.

### Persistent Data Structures (Scala)

```scala
val m1 = Map("a" -> 1, "b" -> 2)
val m2 = m1 + ("c" -> 3)   // structural sharing; old map intact
```

`m2` shares most internal nodes with `m1`. "Copy" is O(log n), not O(n).

---

## Concurrency

### Cloning under contention

If many threads clone the same prototype simultaneously, the prototype's read access must be safe. Make prototypes **immutable**:

```java
public final class ImmutablePrototype {
    private final List<String> items;   // unmodifiable
    public ImmutablePrototype clone() {
        // No synchronization needed — read-only access to items
        return new ImmutablePrototype(new ArrayList<>(items));
    }
}
```

If the prototype is mutable and may be modified mid-clone: synchronize.

### Race conditions in registry

```go
var (
    registry = map[string]Prototype{}
    mu       sync.RWMutex
)

func Register(name string, p Prototype) {
    mu.Lock(); defer mu.Unlock()
    registry[name] = p
}

func Create(name string) Prototype {
    mu.RLock(); defer mu.RUnlock()
    return registry[name].Clone()
}
```

`sync.RWMutex` allows concurrent reads. Or use `sync.Map` for fully concurrent access.

---

## Testability

```java
@Test
void cloneIsIndependent() {
    Document orig = makeDoc();
    Document copy = orig.clone();
    copy.title = "modified";
    assertEquals("original", orig.title);   // unchanged
}

@Test
void cloneIsDeep() {
    Document orig = makeDoc();
    orig.sections.add(new Section("A"));
    Document copy = orig.clone();
    copy.sections.add(new Section("B"));
    assertEquals(1, orig.sections.size());   // unchanged
    assertEquals(2, copy.sections.size());
}
```

Verify both:
- Clone is logically equal to original.
- Mutating clone doesn't affect original.

---

## Code Examples — Advanced

### Java — Copy-on-Write Prototype

```java
public final class CowDocument {
    private List<String> sections;
    private boolean owned;

    public CowDocument(List<String> sections) {
        this.sections = sections;
        this.owned = false;   // we don't own this list yet
    }

    public CowDocument clone() {
        // Cheap: share the list.
        return new CowDocument(this.sections);
    }

    public void addSection(String s) {
        if (!owned) {
            this.sections = new ArrayList<>(sections);
            this.owned = true;
        }
        sections.add(s);
    }
}
```

`clone()` is O(1). Mutation triggers the actual copy.

### Python — Memoized Deep Copy

```python
class GraphNode:
    def __init__(self, value):
        self.value = value
        self.neighbors: list[GraphNode] = []

    def __deepcopy__(self, memo):
        if id(self) in memo: return memo[id(self)]
        new = GraphNode(self.value)
        memo[id(self)] = new
        new.neighbors = [copy.deepcopy(n, memo) for n in self.neighbors]
        return new
```

`memo` correctly handles cycles in graphs.

### Go — Selective Clone with Functional Options

```go
type Config struct {
    Database *DBConfig
    Cache    *CacheConfig
    Logging  *LogConfig
}

type CloneOption func(*Config)

func ShareDatabase(c *Config) { c.Database = origDB }   // share, don't clone

func (c *Config) Clone(opts ...CloneOption) *Config {
    cp := &Config{
        Database: c.Database.Clone(),
        Cache:    c.Cache.Clone(),
        Logging:  c.Logging.Clone(),
    }
    for _, o := range opts { o(cp) }
    return cp
}

// Usage
shared := orig.Clone(ShareDatabase)   // Cache + Logging are deep, Database is shared
```

---

## When Prototype Becomes a Liability

### Symptom 1: Manual deep clone code grows complex

20 levels of nested fields, each requiring careful copy. Refactor to immutable data + structural sharing.

### Symptom 2: Cloning shared resources

File handles, sockets, threads. Prototype is the wrong tool — use Factory + reopen.

### Symptom 3: Cloning is overkill

If the source object is immutable, sharing it is enough. Prototype adds unnecessary copies.

### Symptom 4: Prototype inheritance complexity

Each subclass must override `clone()` correctly. Mistakes lead to slicing. Modern languages with copy semantics (records, dataclasses) reduce this risk.

---

## Migration Patterns

### Prototype → Immutable + Structural Sharing

```scala
// Before: mutable + clone
class Config { ... def clone(): Config = ... }

// After: immutable case class
case class Config(...)
val variant = base.copy(timeout = 60)   // structural sharing, free clone
```

### Prototype → Factory

If "construction" isn't actually expensive, replace clone() with a Factory that builds fresh.

### Prototype → DI Container

```java
@Configuration
class AppConfig {
    @Bean @Scope("prototype")   // every injection gets a fresh instance
    Doc doc() { return loadFromDisk(); }
}
```

Spring `@Scope("prototype")` is literally Prototype pattern in DI form.

---

## Related Topics

- **Next:** [Prototype — Professional](professional.md)
- **Practice:** [Tasks](tasks.md), [Find-Bug](find-bug.md), [Optimize](optimize.md), [Interview](interview.md).
- **Companions:** [Memento](../../03-behavioral/05-memento/junior.md), [Composite](../../02-structural/03-composite/junior.md), [Builder](../03-builder/junior.md), [Singleton](../05-singleton/junior.md).
- **Persistent data structures:** Scala `immutable`, Clojure data, Vavr.

---

[← Middle](middle.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Professional](professional.md)
