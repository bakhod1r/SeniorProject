# Flyweight — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/flyweight](https://refactoring.guru/design-patterns/flyweight)

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

### Q1. What is the Flyweight pattern?

**A.** A structural pattern that reduces memory usage by sharing common state between many objects. The intrinsic state (shared) lives in flyweights; the extrinsic state (per-use) is passed in or kept in a context.

### Q2. Define intrinsic and extrinsic state.

**A.** **Intrinsic** = data that's the same across many uses (font, character, mesh). **Extrinsic** = data that varies per use (position, scale, age).

### Q3. Why must flyweights be immutable?

**A.** Because they're shared by many users. If one user mutates the flyweight, every user sees the change. Immutability keeps sharing safe.

### Q4. What's the role of the Flyweight Factory?

**A.** To return existing flyweights for a key, or create and cache new ones. Without the factory, callers might construct duplicates and defeat sharing.

### Q5. Give a real-world software example.

**A.** Java's `Integer.valueOf` (caches [-128, 127]); `String.intern()`; glyph caches in text engines; sprite/particle instancing in games.

### Q6. What's the difference between Flyweight and Singleton?

**A.** Singleton: exactly one instance globally. Flyweight: many instances, each shared by users with the same intrinsic key.

### Q7. What's the difference between Flyweight and Object Pool?

**A.** Object Pool reuses *instances* (often mutable, with reset). Flyweight shares *intrinsic state* (immutable). Different intent: pool avoids allocation; Flyweight reduces total memory.

### Q8. When should you NOT use Flyweight?

**A.** When you have few objects (savings are tiny, complexity is real); when most state varies per instance (no real sharing); when objects need mutable independent state.

### Q9. How do you identify if Flyweight applies?

**A.** Look for many similar objects with overlapping state. A heap dump dominated by one type with repeating field values is the signal.

### Q10. Can a Flyweight class have any methods?

**A.** Yes — methods that operate on intrinsic state alone, or that take extrinsic state as parameters. Avoid methods that mutate the flyweight.

---

## Middle Questions

### Q11. How do you bound the cache?

**A.** LRU eviction (when full, drop least-recently-used); time-based expiration; weak references (let GC reclaim unreferenced flyweights); naturally-bounded keys (e.g., 256 colors). Pick based on key cardinality and working set.

### Q12. What's the danger of an unbounded factory cache?

**A.** It turns a memory optimization into a memory leak. New keys keep adding entries; the cache outgrows the savings. Always bound for high-cardinality keys.

### Q13. How does Flyweight relate to Composite?

**A.** A Composite tree often has many shared leaves; Flyweight makes those leaves shared. Game scene graph: Composite for structure, Flyweight for shared meshes/textures.

### Q14. How do you make a Flyweight thread-safe?

**A.** The factory's cache must be thread-safe (`ConcurrentHashMap`, `sync.Map`, RWLock). The flyweight itself is immutable, so reads are inherently safe.

### Q15. What happens if two threads concurrently `get` the same uncached key?

**A.** Without protection, both create instances; one is wasted. Use `computeIfAbsent` (Java) or check-then-set with double-check (Go) to avoid duplicate creation.

### Q16. Why might Flyweight not save memory in practice?

**A.** Object header overhead (12-16 bytes JVM, 150+ Python) plus hash table bookkeeping can exceed the per-instance savings if instances are very small or sharing rate is low. Always profile.

### Q17. What's the trade-off of weak references in the factory?

**A.** Pros: cache size matches working set automatically; no manual eviction needed. Cons: GC may reclaim a flyweight you'd reuse soon → re-allocation churn.

### Q18. How do you migrate to Flyweight without breaking existing code?

**A.** Add the Flyweight class + factory; convert one construction site at a time; lint to forbid direct construction outside the factory; verify memory savings via heap dump.

### Q19. How do you test Flyweight sharing?

**A.** Identity assertions: `factory.get(k) == factory.get(k)`. If true, sharing works. Memory regression tests: heap measurement before/after expected to drop after Flyweight applies.

### Q20. What's a common implementation mistake?

**A.** Making the flyweight mutable; bypassing the factory; storing extrinsic state inside the flyweight; unbounded cache for high-cardinality keys.

---

## Senior Questions

### Q21. How does Flyweight interact with garbage collection?

**A.** Long-lived flyweights survive minor GC and live in old generation — long-lived but cheap. Many references to a flyweight don't increase GC cost; reachability tracing follows them but they stay alive as long as any context references them. Weak-ref factories let GC reclaim cold flyweights.

### Q22. When does Flyweight hurt performance instead of helping?

**A.** When per-call factory lookup overhead exceeds allocation savings (small objects, low sharing), when lock contention bottlenecks the factory, or when scattered flyweight memory hurts cache locality.

### Q23. Compare Flyweight with dictionary encoding in databases.

**A.** Same idea at different layers. Dictionary encoding: column stores a small dictionary + indexed values. Flyweight at app layer: factory of unique objects + references. Both share the storage cost of unique values across many positions.

### Q24. How does Flyweight enable GPU instancing in games?

**A.** Game engines treat shared mesh + material as flyweights. Per-instance transforms ride in a vertex buffer. One GPU draw call processes thousands of instances. The Flyweight pattern at API level; the GPU does the actual instancing.

### Q25. What's the relationship between Flyweight and embedding tables in ML?

**A.** A vocabulary embedding table is a Flyweight: 50k unique embedding vectors shared across millions of token positions. Operations like attention reference them by integer index. Same intent: share large state across many uses.

### Q26. How do you decide between weak-ref and LRU caches?

**A.** Weak-ref: cache size matches active working set; no manual tuning. LRU: predictable size; possible better hit rate if working set fits the budget. Mixed-cardinality workloads prefer weak refs; predictable workloads prefer LRU.

### Q27. How does Flyweight scale across processes?

**A.** Within a process, Flyweight is shared memory references. Across processes, each process has its own factory and instances. Distributed sharing requires a remote cache (Redis, memcached) or shared memory mapping (mmap, Apache Arrow).

### Q28. How do you handle factory cache invalidation?

**A.** Flyweights are typically immutable, so the *value* doesn't change. Invalidation isn't normally needed. If the underlying source (e.g., loaded fonts) changes, expire by version key: `(font, version, char)` becomes the key; old entries naturally evict.

### Q29. What's a "perfect hash" optimization for Flyweight?

**A.** When the key space is small and known (e.g., 128 ASCII characters), use an array indexed by the key instead of a hash map. O(1) without hash computation. JVM's `Integer` cache works this way.

### Q30. How does Flyweight relate to event sourcing?

**A.** Events have a *type* (intrinsic: schema, version, name) and *payload* (extrinsic). Sharing the type metadata across millions of events is a Flyweight optimization in event-store implementations.

---

## Professional Questions

### Q31. What's the per-instance memory cost in JVM?

**A.** Compressed OOPs (default): 12 bytes header + fields + alignment to 8 bytes. A class with one int: ~16 bytes. With references, 4 bytes per ref. Without compressed OOPs (heaps > 32 GB): 16 bytes header + 8 bytes per ref.

### Q32. How does `String.intern` work internally?

**A.** Each interned string is added to the JVM-global string table — a fixed-size hash table (default ~60k buckets, configurable). `intern()` looks up; if present, returns canonical. If not, adds. Excessive interning fills the table; performance degrades. Modern JVMs collect interned strings in young gen if not in the table.

### Q33. What's `-XX:AutoBoxCacheMax`?

**A.** Expands `Integer.valueOf`'s cache range beyond [-128, 127]. Useful for apps that autobox a wider range repeatedly. Trade memory for fewer allocations.

### Q34. Why are CPython object headers so heavy?

**A.** Each Python object carries reference count (8 bytes), type pointer (8 bytes), and class-specific overhead. Minimum is ~16-32 bytes per object; with `__dict__` for attributes, +50-100 bytes. `__slots__` removes the dict; reduces by half.

### Q35. How does `__slots__` help Flyweight?

**A.** Eliminates the per-instance `__dict__`. A class with 3 fields drops from ~150 bytes to ~50-80 bytes per instance. For 1M instances: ~70 MB savings. Pairs perfectly with Flyweight.

### Q36. What's the difference between TLAB and slow-path allocation in JVM?

**A.** TLAB (Thread-Local Allocation Buffer) is a per-thread bumper-pointer region: allocations cost ~10 ns. Slow path (when TLAB is full) goes through synchronized eden allocation: 100+ ns. Flyweight saves both: factory cache hits avoid allocation entirely.

### Q37. How does cache-line alignment affect Flyweight?

**A.** A flyweight that fits in one cache line (64 bytes) is fetched in one memory transaction. Hot flyweights (e.g., glyph 'e' in a text engine) stay in L1/L2; access is ~1 ns. Misaligned or scattered flyweights take L3 or DRAM hits — 10-100× slower.

### Q38. What's an arena allocator and how does it help?

**A.** Allocates many objects from a contiguous memory block. Flyweights allocated from one arena are co-located; iterating contexts that reference them benefits from prefetching. Less GC bookkeeping per arena vs per-object.

### Q39. How do you measure Flyweight savings reliably?

**A.** Heap dump before and after; compare instance counts and total bytes for the affected class. Use JFR / VisualVM (Java), pprof (Go), tracemalloc (Python). For end-to-end, measure RSS or `runtime.ReadMemStats`.

### Q40. When is off-heap storage better than Flyweight?

**A.** When the data set exceeds heap budget; when GC pause time dominated by reachability traversal of millions of objects; when serialization to other processes is needed. Off-heap (mmap, Chronicle Map) avoids language-level objects entirely.

---

## Coding Tasks

### Task 1: Glyph factory (Go)

```go
type Glyph struct{ char rune; font string; size int }

type GlyphFactory struct {
    mu    sync.RWMutex
    cache map[GlyphKey]*Glyph
}

type GlyphKey struct{ char rune; font string; size int }

func (f *GlyphFactory) Get(c rune, font string, size int) *Glyph {
    key := GlyphKey{c, font, size}
    f.mu.RLock()
    if g, ok := f.cache[key]; ok { f.mu.RUnlock(); return g }
    f.mu.RUnlock()
    f.mu.Lock(); defer f.mu.Unlock()
    if g, ok := f.cache[key]; ok { return g }
    g := &Glyph{char: c, font: font, size: size}
    f.cache[key] = g
    return g
}
```

---

### Task 2: Forest with shared TreeKind (Python)

```python
@dataclass(frozen=True)
class TreeKind:
    species: str
    color: str

class TreeKindFactory:
    _cache: dict[tuple, TreeKind] = {}
    @classmethod
    def get(cls, species, color):
        key = (species, color)
        if key not in cls._cache: cls._cache[key] = TreeKind(species, color)
        return cls._cache[key]

class Tree:
    __slots__ = ("kind", "x", "y")
    def __init__(self, kind, x, y): self.kind, self.x, self.y = kind, x, y
```

---

### Task 3: LRU-bounded factory (Java)

```java
public final class GlyphFactory {
    private final LinkedHashMap<Key, Glyph> cache;
    public GlyphFactory(int maxSize) {
        cache = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<Key, Glyph> e) {
                return size() > maxSize;
            }
        };
    }
    public synchronized Glyph get(char c, String f, int s) {
        var k = new Key(c, f, s);
        return cache.computeIfAbsent(k, _k -> new Glyph(c, f, s));
    }
    record Key(char c, String f, int s) {}
}
```

---

### Task 4: Color flyweight (Java)

```java
public final class Color {
    private final int r, g, b;
    private Color(int r, int g, int b) { this.r=r; this.g=g; this.b=b; }
    public static Color of(int r, int g, int b) {
        return cache.computeIfAbsent(key(r,g,b), k -> new Color(r,g,b));
    }
    private static Map<Long, Color> cache = new ConcurrentHashMap<>();
    private static long key(int r, int g, int b) { return ((long)r<<16) | ((long)g<<8) | b; }
}
```

---

### Task 5: Token table for NLP (Python)

```python
class TokenKind:
    __slots__ = ("text", "type")
    def __init__(self, text, t): self.text, self.type = text, t

class TokenTable:
    def __init__(self):
        self._kinds = []
        self._index = {}

    def get_id(self, text, t) -> int:
        key = (text, t)
        if key in self._index: return self._index[key]
        i = len(self._kinds)
        self._kinds.append(TokenKind(text, t))
        self._index[key] = i
        return i

    def kind(self, i: int) -> TokenKind:
        return self._kinds[i]
```

Each token instance holds an int (`token_id`) instead of a TokenKind reference; even smaller per-instance.

---

## Trick Questions

### Q41. "Is `Integer.valueOf` Flyweight?"

**A.** Yes — autoboxed integers in the cached range share instances. It's runtime-implemented Flyweight.

### Q42. "Is Object Pool the same as Flyweight?"

**A.** No. Pool reuses mutable instances after use (with reset). Flyweight shares immutable instances. Different intent.

### Q43. "If my flyweight has only ints, does it still help?"

**A.** Probably not. The object header alone is bigger than the data; adding factory overhead may not save anything. Profile.

### Q44. "Can I cache the factory itself per request?"

**A.** Then sharing breaks: each request has its own factory, no inter-request sharing. Defeats the purpose.

### Q45. "Should I always intern strings?"

**A.** No. Interning helps for repeated long-lived strings used as keys. Hurts for unique short-lived strings (string table fills).

---

## Behavioral / Architectural Questions

### Q46. "Tell me about a time you applied Flyweight."

**A.** *STAR:* Situation (a parser created 30M `Token` objects, OOM in production). Task (reduce memory). Action (split into immutable `TokenKind` + lightweight `Token` ref; introduced factory). Result (memory dropped by 70%; service stayed up).

### Q47. "How did you decide Flyweight was the right tool?"

**A.** Heap dump showed one class dominating; same field values repeating. Calculated savings: ~5× memory. Profile said yes; complexity tax was worth it for the scale.

### Q48. "When did you decide *not* to use Flyweight?"

**A.** A teammate proposed Flyweight for a few hundred config objects. Heap impact: tens of KB. Complexity tax: real. Pushed back; we shipped without the pattern.

### Q49. "How do you maintain a Flyweight long-term?"

**A.** Lint: forbid direct construction outside the factory. Tests: assert sharing identity for canonical inputs. Memory regression tests: alert if heap usage grows unexpectedly. Document the intrinsic/extrinsic split prominently.

### Q50. "When does a Flyweight need to evolve?"

**A.** When the intrinsic/extrinsic split changes (new field that's actually per-instance moved into extrinsic). When the cache strategy needs tuning (LRU → weak ref). When the system scales to a new tier (in-process → distributed). Plan for these as the system grows.

---

## Tips for Answering

1. **Lead with "share intrinsic state, pass extrinsic per call."** That's the headline.
2. **Bring real examples.** `Integer.valueOf`, `String.intern`, glyph caches, game forests. Pick one familiar to the interviewer.
3. **Mention immutability explicitly.** Senior signal.
4. **Discuss when NOT to use it.** "Few objects → ceremony." Knowing failure modes is signal.
5. **Talk about cache management.** Bounded? Weak refs? Mention without prompting.
6. **Profile before claiming savings.** "We measured a 5× drop" is more credible than "we saved memory."
7. **Code: small flyweight, real factory, immutable class.** That's enough to demonstrate the pattern.

---

← Back to Flyweight folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Flyweight — Hands-On Tasks](tasks.md)
