# Prototype — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/prototype](https://refactoring.guru/design-patterns/prototype)

---

## Junior Questions (10)

### J1. What is the Prototype pattern?
**Answer:** A creational pattern where objects clone themselves via a `clone()` method, decoupling the cloning code from concrete classes.

### J2. Difference between shallow and deep copy?
**Answer:** Shallow copies top-level fields; nested object references are shared. Deep recursively copies nested objects; no shared mutable state.

### J3. Why is Java's `Cloneable` problematic?
**Answer:** `Object.clone()` skips constructors, defaults to shallow, and throws a checked exception. Modern Java avoids it via copy constructors.

### J4. How does Python's `copy.deepcopy` work?
**Answer:** Recursively copies nested objects, using a `memo` dict to handle circular references. Calls `__deepcopy__` if defined; otherwise falls back to pickle protocol.

### J5. Why must Go programmers manually copy slices in Clone()?
**Answer:** Go's `=` for slices/maps copies only the header (pointer + len + cap). The underlying array is shared. Manual copy via `append([]T(nil), src...)` or full-iteration copy.

### J6. What's a Prototype Registry?
**Answer:** A map from name to pre-configured prototype, accessed via `registry.get(name).clone()`. Adds named "presets" without subclasses.

### J7. When should you use Prototype?
**Answer:** When construction is expensive, when polymorphic copy is needed (don't know concrete class), or when you want configuration presets to derive from.

### J8. When should you NOT use Prototype?
**Answer:** When construction is cheap (just use constructor), object is immutable (share, don't clone), or external resources are involved (file handles, sockets).

### J9. What's the difference between Prototype and Memento?
**Answer:** Prototype is "give me another like this." Memento is "save the current state to restore later." Mechanically similar; intent differs.

### J10. What's a common Prototype mistake?
**Answer:** Returning the original (sharing references) instead of a copy. Or shallow clone where deep is needed.

---

## Middle Questions (10)

### M1. How do you implement Prototype in Java avoiding `Cloneable`?
**Answer:** Copy constructor + `clone()`:
```java
public Foo(Foo other) { this.x = other.x; ... }
public Foo clone() { return new Foo(this); }
```

### M2. How do you handle circular references in deep clone?
**Answer:** Use memoization. Python's `copy.deepcopy(obj, memo={})` does this automatically. Custom implementations must also accept and use a memo dict.

### M3. What's Copy-on-Write (COW)?
**Answer:** A technique where the clone shares storage with the original until first mutation; only then allocates a copy. `clone()` is O(1); only mutations cost. Used in `CopyOnWriteArrayList`, OS `fork()`.

### M4. How does Prototype interact with inheritance?
**Answer:** Each subclass must override `clone()` (or copy constructor) to return its own type. Forgetting causes "slicing" — clone returns parent type, losing subclass fields.

### M5. Compare Prototype vs Builder.
**Answer:**
- **Builder:** assemble from scratch, many optional fields.
- **Prototype:** copy an existing object.

Combine: Builder produces a prototype; clones derive variants.

### M6. Compare Prototype vs Factory.
**Answer:**
- **Factory:** decides which class to instantiate.
- **Prototype:** clones existing instance, doesn't choose a class.

Use Prototype when construction is expensive; Factory when polymorphic instantiation needed.

### M7. What's serialization-based cloning?
**Answer:** Serialize then deserialize. Handles deep graphs and cycles automatically. Slow (~10× manual). Common pattern: JSON via Jackson/Gson.

### M8. How do you make a thread-safe Prototype Registry?
**Answer:** Use `ConcurrentHashMap` (Java) or `sync.RWMutex` (Go). Register at startup; reads at runtime. Or `sync.Map` for fully concurrent.

### M9. What's the relationship between Prototype and persistent data structures?
**Answer:** Persistent data structures (Clojure, Scala immutable) use structural sharing — "copy" is O(log n) with most internal nodes shared. Prototype's deep clone is O(n). Persistent structures sidestep most clone concerns.

### M10. When does Prototype become an anti-pattern?
**Answer:** When the source is immutable (just share), when external resources are involved (file handles can't clone), when construction is cheap (no benefit), or when manual clone code becomes hard to maintain.

---

## Senior Questions (10)

### S1. How would you architect a game's enemy spawning system using Prototype?
**Answer:**
1. Pre-load prototype enemies at game start (sprite, attack, AI loaded once).
2. Prototype Registry keyed by enemy type.
3. Spawn loop: `registry.get("goblin").clone()` then set position.
4. Cloning is much cheaper than full construction (sprites/sounds shared via reference).

### S2. How do you optimize Prototype for hot-path use?
**Answer:** Selective deep copy (don't clone immutable fields), structural sharing (persistent collections), pre-clone caching (clone once, reuse if read-only), Copy-on-Write for read-mostly use.

### S3. Compare manual deep clone, serialization cloning, and JSON roundtrip.
**Answer:**
- **Manual:** fastest (5-10× faster), most code, must handle cycles.
- **Java serialization:** medium, less code, requires `Serializable`.
- **JSON:** slowest, simplest, only works for POJOs.

Use manual for hot paths, JSON for "deep clone for logging."

### S4. How do you handle Prototype with external resources?
**Answer:** Prototype is the wrong tool when objects own files/sockets/threads. Either:
- Reopen the resource in clone (`new FileHandle(this.path)`).
- Refactor: separate state (cloneable) from resource (factory-managed).
- Use `WeakReference` for resources, recreate on demand.

### S5. How do you design a Prototype Registry that supports versioning?
**Answer:** Registry keyed by `(name, version)`. Old prototypes coexist; new versions added without breaking old callers. Version field on prototype lets clients verify.

### S6. How does Prototype compose with Composite?
**Answer:** Composite trees clone recursively — each node clones itself + its children. Memoization for cycles.

### S7. What's the migration path from Prototype to immutable data structures?
**Answer:**
1. Identify clone hotspots.
2. Convert mutable fields to immutable types (`List.of`, persistent collections).
3. Replace `clone()` with constructor + `with*()` methods producing new instances.
4. Delete `clone()` once no callers remain.

The clone disappears — sharing replaces copying for immutables.

### S8. How does Spring's `@Scope("prototype")` relate to the pattern?
**Answer:** Spring's prototype scope makes each `@Inject` produce a fresh bean — essentially Prototype + DI. The container *is* the registry; injection *is* the clone. For stateful components needing per-injection isolation.

### S9. When would you use serialization cloning over manual?
**Answer:**
- Object graph too complex to manually clone.
- POJOs with simple structure (Jackson works).
- Audit/logging — need a persistent snapshot.
- Cross-process communication (clone to deserialized form).

Avoid for hot paths.

### S10. How do you test a Prototype implementation?
**Answer:**
1. Clone is independent (mutate clone, original unchanged).
2. Clone has same logical content.
3. Deep semantics: nested mutations don't propagate.
4. Cycle handling.
5. Subclass slicing: clone of subclass returns subclass type.

---

## Professional Questions (10)

### P1. Walk me through `Object.clone()` internals.
**Answer:** Native: `Class.newInstance0` allocates without calling constructor; bytewise copies fields. Shallow by default. Throws `CloneNotSupportedException` unless `Cloneable` (marker) is implemented.

### P2. Why is `Cloneable` considered broken?
**Answer:** Constructor skipped (final field initializers, side effects), shallow by default, checked exception, `clone()` is `protected` in `Object` (must override to make public). Bloch (Effective Java Item 13) advises avoiding it.

### P3. How does `copy.deepcopy` handle cycles?
**Answer:** Memo dict mapping `id(orig)` → cloned object. Before recursing into children, store `memo[id(self)] = new`. Recursion checks memo first; cycles return the existing copy.

### P4. What's the JMM implication of cloning?
**Answer:** The clone is constructed by one thread; other threads need a happens-before edge to see fully-initialized state. `final` fields provide safe publication automatically. `volatile` references or synchronization for non-final.

### P5. How does COW work in `CopyOnWriteArrayList`?
**Answer:** All mutations replace the underlying array. Reads see the snapshot. Iterators have a fixed snapshot. Mutations are O(n) (full array copy); reads O(1). Used for read-mostly workloads.

### P6. What's the cost of reflection-based deep clone in Go?
**Answer:** ~100× slower than hand-written `Clone()`. Reflection navigates fields generically without compile-time knowledge. Avoid for hot paths.

### P7. How do persistent data structures work?
**Answer:** Hash Array Mapped Tries (HAMT) for maps; "fat node" trees for sequences. Updates create new nodes for the path from root to changed leaf; rest is shared. O(log n) for most operations, with high branching factor (32 in Clojure) keeping height ~6 for billion-element collections.

### P8. How does Prototype interact with Java records?
**Answer:** Records are immutable; cloning is unnecessary (share). For "modify a copy," use `with*()` methods (manually written or Lombok `@With`).

### P9. What are the security implications of serialization-based cloning?
**Answer:** `ObjectInputStream.readObject()` can instantiate arbitrary classes via gadget chains, leading to RCE. Mitigations: filter classes (`ObjectInputFilter`), use safer formats (JSON), avoid `Serializable` on user-input paths.

### P10. How would you benchmark Prototype implementations?
**Answer:** JMH for Java (warm JIT, careful with escape analysis). For very fast clone calls, use `Blackhole` to prevent dead-code elimination. Check allocation profile (`-prof gc`) to compare manual vs reflection vs JSON clone.

---

## Coding Tasks (5)

### C1. Implement Java Prototype with copy constructor.

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
```

### C2. Python custom `__deepcopy__` with memo.

```python
class Graph:
    def __init__(self, value): self.value = value; self.neighbors = []
    def __deepcopy__(self, memo):
        if id(self) in memo: return memo[id(self)]
        new = Graph(self.value); memo[id(self)] = new
        new.neighbors = [copy.deepcopy(n, memo) for n in self.neighbors]
        return new
```

### C3. Go Clone with manual deep slice/map copy.

```go
type Config struct { Name string; Tags []string; Flags map[string]bool }

func (c *Config) Clone() *Config {
    flags := make(map[string]bool, len(c.Flags))
    for k, v := range c.Flags { flags[k] = v }
    return &Config{
        Name:  c.Name,
        Tags:  append([]string(nil), c.Tags...),
        Flags: flags,
    }
}
```

### C4. Prototype Registry in Java.

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
```

### C5. Copy-on-Write Wrapper.

```java
public final class CowList<T> {
    private List<T> items;
    private boolean owned;
    public CowList(List<T> initial) { this.items = List.copyOf(initial); this.owned = true; }
    public CowList<T> clone() {
        CowList<T> c = new CowList<>(this.items);
        c.owned = false;
        return c;
    }
    public synchronized void add(T item) {
        if (!owned) { this.items = new ArrayList<>(items); this.owned = true; }
        ((ArrayList<T>) items).add(item);
    }
}
```

---

## Trick Questions (5)

### T1. Can you clone a singleton?
**Technically yes** (override `clone()`), but it defeats the singleton invariant. Bloch: throw `CloneNotSupportedException` from `clone()` of singletons.

### T2. Is `Object.clone()` always shallow?
**Yes by default.** Subclasses can override to deep-clone, but the native machinery is shallow. Implementing deep-via-Cloneable requires manually deep-cloning each reference.

### T3. Does `copy.deepcopy` work on objects without `__deepcopy__`?
**Yes** — falls back to pickle protocol (`__reduce_ex__`). Slower but works for most user classes.

### T4. Can Prototype be a Singleton?
**The Prototype itself can be a Singleton** (one instance per type). The **clones** are not — they're fresh copies. Combine the patterns when prototypes are global presets.

### T5. Is Go's `=` copy ever a true deep copy?
**Yes for value types** (structs without reference fields). For structs with slices, maps, channels, pointers — `=` is shallow. Manual copy needed.

---

## Behavioral Questions (5)

### B1. Tell me about Prototype in production.
**Sample:** "Game entity system. We had 50 enemy templates loaded at startup (each parsing JSON, loading sprites). Spawning was 10K/sec at peak. Cloning each was 50× faster than re-parsing. Prototype made the spawn loop trivial."

### B2. Describe a deep-clone bug.
**Sample:** "A document editor's undo stack stored shallow clones. Mutating the document after save propagated changes into the saved snapshot, breaking undo. Switched to `copy.deepcopy` with custom `__deepcopy__` excluding the cache field."

### B3. When did you skip Prototype?
**Sample:** "For a config object with 5 immutable fields, Prototype was overkill. We made it a record/dataclass and shared references — no cloning needed."

### B4. How do you decide deep vs shallow?
**Sample:** "If a field is immutable (String, frozen dataclass, record), share. If mutable and shared mutation would be a bug, deep clone. Document the contract."

### B5. Describe a clone performance problem.
**Sample:** "A 100MB session object cloned per request — 10ms/clone became the bottleneck. Switched to Vavr persistent maps; clone became O(log n). 100× speedup."

---

## Tips

1. **Lead with shallow vs deep.** It's the single most important distinction.
2. **Mention `Cloneable` is broken.** Senior interviewer signal.
3. **Compare with Memento** — they're often confused.
4. **Know language idioms:** copy constructor (Java), `copy` module (Python), explicit slice copy (Go).
5. **Mention persistent data structures** for Java/Scala roles.

---

[← Senior Singleton interview](../05-singleton/interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
