# Prototype — Optimize

> **Source:** [refactoring.guru/design-patterns/prototype](https://refactoring.guru/design-patterns/prototype)

10 inefficient implementations + benchmarks + optimizations.

Apple M2 Pro, single thread.

---

## Optimization 1: Replace Naive Re-Construction with Prototype

### Slow
```python
for i in range(10000):
    enemy = Enemy(load_sprite("goblin.png"), parse_attack("bite"), ...)   # heavy I/O each time
    spawn(enemy)
```

### Optimized
```python
proto = Enemy(load_sprite("goblin.png"), parse_attack("bite"), ...)
for i in range(10000):
    enemy = copy.deepcopy(proto)   # cheap copy
    spawn(enemy)
```

### Benchmark
| | Re-construct | Clone |
|---|---|---|
| Per iteration | ~5 ms | ~0.05 ms |

**100× speedup.** Resources loaded once.

---

## Optimization 2: Selective Deep Copy

### Slow
```python
def __deepcopy__(self, memo):
    return Doc(
        title=self.title,
        large_cache=copy.deepcopy(self.large_cache, memo),   # 100MB
        sections=copy.deepcopy(self.sections, memo),
    )
```

### Optimized
```python
def __deepcopy__(self, memo):
    new = Doc()
    new.title = self.title
    new.large_cache = self.large_cache   # share immutable
    new.sections = copy.deepcopy(self.sections, memo)
    return new
```

**~50× faster** for objects with large immutable fields.

### Tradeoff
- Document immutability invariant.
- If anyone mutates `large_cache`, clones see it.

---

## Optimization 3: Persistent Data Structures

### Slow (Java with `HashMap`)
```java
Map<String, Integer> m1 = ...;   // 1M entries
Map<String, Integer> m2 = new HashMap<>(m1);   // O(n) full copy
```

### Optimized (Vavr persistent map)
```java
import io.vavr.collection.Map;
Map<String, Integer> m1 = ...;
Map<String, Integer> m2 = m1.put("k", 0);   // O(log n), structural sharing
```

### Benchmark
| | Mutable HashMap | Vavr persistent |
|---|---|---|
| 1M-entry copy | 50 ms | 0.001 ms |

Persistent data structures sidestep the deep-clone problem.

---

## Optimization 4: Copy-on-Write

### Slow — eager copy
```java
public CowList<T> clone() {
    return new CowList<>(new ArrayList<>(this.items));   // O(n) immediately
}
```

### Optimized — defer
```java
public CowList<T> clone() {
    CowList<T> c = new CowList<>(this.items);   // O(1), share
    c.owned = false;
    return c;
}

public synchronized void add(T item) {
    if (!owned) { items = new ArrayList<>(items); owned = true; }
    items.add(item);
}
```

If clones are read-only (common): zero copies. If they mutate: copy on first write.

---

## Optimization 5: Cache the Prototype Registry

### Slow
```python
def spawn(kind):
    proto = load_prototype(kind)   # disk read each time
    return copy.deepcopy(proto)
```

### Optimized
```python
_cache = {}
def spawn(kind):
    if kind not in _cache:
        _cache[kind] = load_prototype(kind)
    return copy.deepcopy(_cache[kind])
```

Or use `functools.lru_cache`:
```python
@lru_cache(maxsize=128)
def get_proto(kind):
    return load_prototype(kind)
```

---

## Optimization 6: Avoid Reflection Clone in Go

### Slow
```go
import "github.com/mohae/deepcopy"
clone := deepcopy.Copy(orig).(*Config)   // ~100× slower
```

### Optimized — hand-written
```go
func (c *Config) Clone() *Config {
    return &Config{
        Name: c.Name,
        Tags: append([]string(nil), c.Tags...),
        Flags: cloneMap(c.Flags),
    }
}
```

### Benchmark
| | Reflection | Hand-written |
|---|---|---|
| Per clone | ~50 µs | ~0.5 µs |

**100× speedup** by writing the clone manually.

---

## Optimization 7: Manual Clone over Java Serialization

### Slow
```java
public Foo deepClone(Foo orig) throws IOException, ClassNotFoundException {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    new ObjectOutputStream(bos).writeObject(orig);
    return (Foo) new ObjectInputStream(new ByteArrayInputStream(bos.toByteArray())).readObject();
}
```

### Optimized — copy constructor
```java
public Foo clone() { return new Foo(this); }
```

### Benchmark
| | Serialization | Manual |
|---|---|---|
| Per clone | ~20 µs | ~0.1 µs |

**~200× speedup.**

---

## Optimization 8: Batch Deep Copy

### Slow
```java
List<Doc> clones = new ArrayList<>();
for (Doc d : docs) clones.add(d.clone());
```

If clones share a common parent state:

### Optimized
```java
SharedState shared = docs.get(0).sharedState;
for (Doc d : docs) {
    Doc c = d.shallowClone();
    c.sharedState = shared;   // all clones share
    clones.add(c);
}
```

---

## Optimization 9: Use Records / Frozen Dataclasses

### Slow — mutable + clone
```python
class Point:
    def __init__(self, x, y): self.x = x; self.y = y
    def __deepcopy__(self, memo): return Point(self.x, self.y)

p2 = copy.deepcopy(p1)
```

### Optimized — frozen + share
```python
@dataclass(frozen=True)
class Point:
    x: int
    y: int

p1 = Point(1, 2)
p2 = p1   # safe share, immutable
```

### Tradeoff
- Lose ability to mutate.
- "Modify a copy" via `dataclasses.replace`.

For most data, this is the right call.

---

## Optimization 10: Pool Prototype Clones

### Slow — clone every time
```java
public Doc spawn() { return prototype.clone(); }
```

### Optimized — pool + reset
```java
private final ArrayBlockingQueue<Doc> pool = new ArrayBlockingQueue<>(100);

public Doc spawn() {
    Doc d = pool.poll();
    if (d == null) d = prototype.clone();
    else d.reset();   // restore default state
    return d;
}

public void release(Doc d) { pool.offer(d); }
```

For frequent spawn/despawn (game entities), pooling avoids repeated allocations.

### Tradeoff
- `reset()` must be reliable.
- Memory overhead (pool).

---

## Optimization Tips

### How to find Prototype bottlenecks

1. **Profile alloc objects** (`pprof -alloc_objects`).
2. **Look at deep-clone time** for large object graphs.
3. **Identify which fields are mutable vs immutable.**
4. **Measure registry lookup vs clone cost.**

### Optimization checklist

- [ ] Replace re-construction with prototype + clone.
- [ ] Selective deep copy: share immutable, clone mutable.
- [ ] Persistent data structures for large collections.
- [ ] Copy-on-Write for read-mostly clones.
- [ ] Cache prototypes; don't reload.
- [ ] Hand-written clone over reflection.
- [ ] Hand-written clone over serialization.
- [ ] Use frozen / immutable types where possible.
- [ ] Pool clones for hot paths.

### Anti-optimizations

- ❌ **Premature COW.** Adds complexity if all clones mutate.
- ❌ **Object pool without reset.** Bug factory.
- ❌ **Sharing mutable data "to save memory".** Surprising mutations.
- ❌ **Reflection for one-off clone.** Hand-write it.

---

## Summary

Prototype's main cost is **deep copy of large object graphs**. Optimizations focus on:
- **Avoiding the copy** (immutable, sharing, COW).
- **Reducing the copy** (selective deep, persistent structures).
- **Reusing the copy** (pool, registry cache).

For most application code, deep clone via copy constructor is fast enough. Reach for advanced techniques only when profiles confirm the bottleneck.

---

[← Find-Bug](find-bug.md) · [Creational](../README.md) · [Roadmap](../../../README.md)

**Prototype roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

---

## Creational Patterns Complete

All 5 Creational patterns now have full 8-file TEMPLATE.md coverage:
- ✅ Factory Method
- ✅ Abstract Factory
- ✅ Builder
- ✅ Prototype
- ✅ Singleton

**Next:** Structural Patterns (pending future phases).
