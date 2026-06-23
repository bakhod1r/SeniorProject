# Flyweight — Find the Bug

> **Source:** [refactoring.guru/design-patterns/flyweight](https://refactoring.guru/design-patterns/flyweight)

Each section presents a Flyweight that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Mutable flyweight](#bug-1-mutable-flyweight)
2. [Bug 2: Bypassing the factory](#bug-2-bypassing-the-factory)
3. [Bug 3: Extrinsic state stored inside the flyweight](#bug-3-extrinsic-state-stored-inside-the-flyweight)
4. [Bug 4: Unbounded cache turns into memory leak](#bug-4-unbounded-cache-turns-into-memory-leak)
5. [Bug 5: Concurrent insertion creates duplicates](#bug-5-concurrent-insertion-creates-duplicates)
6. Bug 6: Bad hashCode/__hash__ on key
7. [Bug 7: Equality semantics surprise the caller](#bug-7-equality-semantics-surprise-the-caller)
8. [Bug 8: Static factory leaks across tests](#bug-8-static-factory-leaks-across-tests)
9. [Bug 9: Weak-ref cache loses live entries](#bug-9-weak-ref-cache-loses-live-entries)
10. [Bug 10: Cache key includes extrinsic data](#bug-10-cache-key-includes-extrinsic-data)
11. [Bug 11: Identity check across factories](#bug-11-identity-check-across-factories)
12. [Bug 12: Saving zero memory because object is too small](#bug-12-saving-zero-memory-because-object-is-too-small)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Mutable flyweight

```java
public class Glyph {
    public char c;
    public String font;
    public int size;
    public Color color;
}

var g = factory.get('e', "Arial", 12);
g.color = Color.RED;   // intends to set this glyph red
// elsewhere:
var g2 = factory.get('e', "Arial", 12);
// g2 is the same instance — also red now!
```

A user reports: "All my 'e' characters turned red unexpectedly."

<details><summary>Reveal</summary>

**Bug:** The flyweight is mutable. Setting `color` on one reference changes it for every user of that flyweight.

**Fix:** make the flyweight immutable; move `color` to extrinsic state.

```java
public final class Glyph {
    private final char c;
    private final String font;
    private final int size;
    public Glyph(char c, String font, int size) { ... }
    // accessors only — no setters
}

// Color is now extrinsic
public class Char {
    private final Glyph glyph;
    private final Color color;   // per-instance
}
```

**Lesson:** Flyweights must be immutable. Mutable shared state is the canonical Flyweight bug.

</details>

---

## Bug 2: Bypassing the factory

```python
g1 = factory.get('e', 'Arial', 12)
g2 = Glyph('e', 'Arial', 12)   # ← bypasses factory!
print(g1 is g2)   # False — duplicate instance
```

A test asserts `g1 is g2`; it fails intermittently in production code that constructed `Glyph` directly.

<details><summary>Reveal</summary>

**Bug:** The class allows direct construction. Callers can bypass the factory and create duplicates, defeating sharing.

**Fix:** make the constructor private (Java) or convention-private (Python `_Glyph`); enforce factory access.

```python
class _Glyph:   # convention private
    __slots__ = ("char", "font", "size")
    def __init__(self, *args): ...

class GlyphFactory:
    def get(self, c, font, size):
        return self._cache.setdefault((c, font, size), _Glyph(c, font, size))
```

In Java, package-private constructor + factory in the same package.

**Lesson:** The factory must be the only construction path. Make direct construction impossible (or strongly discouraged).

</details>

---

## Bug 3: Extrinsic state stored inside the flyweight

```java
public final class Tree {
    private final String species;
    private final String color;
    private final int x;       // extrinsic stored here!
    private final int y;       // extrinsic stored here!
    public Tree(String species, String color, int x, int y) { ... }
}

var factory = new TreeFactory();
factory.get("oak", "green", 0, 0);
factory.get("oak", "green", 5, 0);   // separate flyweight — coordinates differ
```

The factory cache grows unboundedly because every position gives a unique key.

<details><summary>Reveal</summary>

**Bug:** Position is extrinsic — should not be in the flyweight. Including it in the key creates a unique flyweight per position; no sharing happens.

**Fix:** split state.

```java
public final class TreeKind {
    private final String species;
    private final String color;   // intrinsic only
}

public final class Tree {
    private final TreeKind kind;
    private final int x, y;       // extrinsic
}
```

**Lesson:** Misidentifying intrinsic vs extrinsic is the #1 design bug. If the cache grows linearly with usage, the split is wrong.

</details>

---

## Bug 4: Unbounded cache turns into memory leak

```java
public class FlyweightFactory {
    private static final Map<String, Flyweight> CACHE = new ConcurrentHashMap<>();

    public static Flyweight get(String key) {
        return CACHE.computeIfAbsent(key, Flyweight::new);
    }
}

// Usage with high-cardinality keys (request IDs)
for (Request r : stream) {
    FlyweightFactory.get(r.id());   // 100M unique IDs over time
}
```

After 30 minutes, the JVM is OOM.

<details><summary>Reveal</summary>

**Bug:** The cache is unbounded. Keys with high cardinality fill it forever. The flyweight optimization became a leak.

**Fix:** bound the cache (LRU, time-based, weak references) or rethink — request IDs probably aren't a Flyweight candidate at all.

```java
private static final Cache<String, Flyweight> CACHE = Caffeine.newBuilder()
    .maximumSize(10_000)
    .build();
```

Or use weak references if the values can be GC'd when unused.

**Lesson:** The cache must be bounded for high-cardinality keys. Verify key cardinality before applying Flyweight.

</details>

---

## Bug 5: Concurrent insertion creates duplicates

```go
type GlyphFactory struct {
    cache map[string]*Glyph   // no synchronization
}

func (f *GlyphFactory) Get(key string) *Glyph {
    if g, ok := f.cache[key]; ok { return g }
    g := &Glyph{}
    f.cache[key] = g
    return g
}
```

Under concurrent load, the race detector reports data races. Two goroutines simultaneously create flyweights for the same key — sharing breaks momentarily, race conditions cause map corruption.

<details><summary>Reveal</summary>

**Bug:** No synchronization. Concurrent `Get` calls can both find no cached entry and both insert. The map can corrupt under concurrent writes.

**Fix:** add synchronization.

```go
type GlyphFactory struct {
    mu    sync.RWMutex
    cache map[string]*Glyph
}

func (f *GlyphFactory) Get(key string) *Glyph {
    f.mu.RLock()
    if g, ok := f.cache[key]; ok { f.mu.RUnlock(); return g }
    f.mu.RUnlock()
    f.mu.Lock(); defer f.mu.Unlock()
    if g, ok := f.cache[key]; ok { return g }
    g := &Glyph{}
    f.cache[key] = g
    return g
}
```

**Lesson:** The factory's cache must be thread-safe. Use `RWLock`, `sync.Map`, or `ConcurrentHashMap`.

</details>

---

## Bug 6: Bad hashCode/__hash__ on key

```java
public class GlyphKey {
    public char c;
    public String font;
    public int size;

    @Override
    public boolean equals(Object o) { /* correct */ }

    @Override
    public int hashCode() { return 1; }   // ← always 1
}
```

The factory's cache becomes a linked list (every key collides into one bucket). Lookup degrades to O(N).

<details><summary>Reveal</summary>

**Bug:** The hash code is constant. Every insertion collides; the map becomes a single-bucket linked list. Lookups are O(N).

**Fix:** generate a proper hash code.

```java
@Override
public int hashCode() { return Objects.hash(c, font, size); }
```

Or use a record (Java 14+):

```java
public record GlyphKey(char c, String font, int size) {}
// equals and hashCode auto-generated
```

**Lesson:** A custom Key class needs a proper `hashCode`/`__hash__`. Use language-provided generators (records, dataclasses) when possible.

</details>

---

## Bug 7: Equality semantics surprise the caller

```python
glyph_a = factory.get('e', 'Arial', 12)
glyph_b = factory.get('e', 'Arial', 12)
if glyph_a == glyph_b:        # passes — identity equal
    print("same glyph")
```

A reviewer asks: "what does `==` mean here? What if I have a non-flyweight `e` from elsewhere?"

<details><summary>Reveal</summary>

**Bug (subtle):** with Flyweight, `==` (identity in Python) and `equals` semantics overlap — they're the same when objects come from the same factory. But if a `Glyph` is constructed elsewhere, `==` is false even for "equal" content. Caller may be confused.

**Fix:** be explicit. Define `__eq__` based on intrinsic content, not just identity.

```python
class Glyph:
    __slots__ = ("char", "font", "size")
    def __eq__(self, other):
        return isinstance(other, Glyph) and \
               (self.char, self.font, self.size) == (other.char, other.font, other.size)
    def __hash__(self):
        return hash((self.char, self.font, self.size))
```

Now `==` is value-based; `is` checks identity (sharing).

**Lesson:** Don't rely on Flyweight identity unless you control all construction. Define `equals` explicitly for cross-factory comparisons.

</details>

---

## Bug 8: Static factory leaks across tests

```java
public class GlyphFactory {
    private static final Map<Key, Glyph> CACHE = new ConcurrentHashMap<>();

    public static Glyph get(...) { ... }
    public static int cacheSize() { return CACHE.size(); }
}

@Test void testOne() {
    GlyphFactory.get('e', "Arial", 12);
    assertEquals(1, GlyphFactory.cacheSize());   // passes
}

@Test void testTwo() {
    GlyphFactory.get('e', "Arial", 12);
    assertEquals(1, GlyphFactory.cacheSize());
    // depends on test order!
}
```

Tests pass individually but fail when run together (or vice versa).

<details><summary>Reveal</summary>

**Bug:** The static cache leaks between tests. Test order changes outcomes; some tests assume a clean cache; others don't.

**Fix:** clear in setup, or inject a per-test factory instance.

```java
@BeforeEach void setUp() { GlyphFactory.clear(); }
```

Or refactor to use an instance-based factory injected into the test:

```java
GlyphFactory factory = new GlyphFactory();
```

**Lesson:** Static factory state must be managed in tests. Prefer instance-based factories for testability.

</details>

---

## Bug 9: Weak-ref cache loses live entries

```python
import weakref

class GlyphFactory:
    def __init__(self):
        self._cache = weakref.WeakValueDictionary()

    def get(self, c, font, size):
        key = (c, font, size)
        g = self._cache.get(key)
        if g is None:
            g = Glyph(c, font, size)
            self._cache[key] = g
        return g

g = factory.get('e', 'Arial', 12)
del g                              # released here
g2 = factory.get('e', 'Arial', 12)  # creates a new one
```

A test asserts that `g` is `g2` (same instance after caching). It fails because `g` was GC'd before `g2` was fetched.

<details><summary>Reveal</summary>

**Bug:** Weak refs let GC reclaim the flyweight if no client holds a strong ref. The new fetch creates a fresh instance.

**Fix:** keep a strong ref while testing, or use a stronger eviction strategy (LRU, manual).

```python
g = factory.get('e', 'Arial', 12)
g2 = factory.get('e', 'Arial', 12)
assert g is g2   # works; both refs alive
```

For production, decide deliberately: weak refs match working set automatically (good); but test code must hold strong refs.

**Lesson:** Weak references are powerful but require understanding. The "cache miss" can happen even when you thought you had cached.

</details>

---

## Bug 10: Cache key includes extrinsic data

```java
public class CharContext {
    private Glyph glyph;
    private int x, y;

    public Glyph getGlyph() {
        return GlyphFactory.get(glyph.getChar(), glyph.getFont(), glyph.getSize(),
                                 x, y);   // ← x,y in factory key!
    }
}
```

The factory cache fills up because each context's position is in the key.

<details><summary>Reveal</summary>

**Bug:** `x, y` are extrinsic but included in the factory key. The cache treats every position as a different glyph — no sharing.

**Fix:** factory key includes only intrinsic state.

```java
public Glyph getGlyph() {
    return GlyphFactory.get(glyph.getChar(), glyph.getFont(), glyph.getSize());
}
```

**Lesson:** The factory's key must be only intrinsic. Including extrinsic state explodes the cache.

</details>

---

## Bug 11: Identity check across factories

```python
factory_a = GlyphFactory()
factory_b = GlyphFactory()

g_a = factory_a.get('e', 'Arial', 12)
g_b = factory_b.get('e', 'Arial', 12)

assert g_a is g_b   # fails!
```

A test expecting sharing fails: two separate factories produce different instances.

<details><summary>Reveal</summary>

**Bug:** Each factory has its own cache. Sharing only works within one factory. Two factories means two separate flyweight pools.

**Fix:** use one factory across the application — make it global (singleton) or share via DI.

```python
# Global / module-level
_factory = GlyphFactory()

def get_glyph(c, font, size): return _factory.get(c, font, size)
```

**Lesson:** A single factory per logical "world" is required for sharing. Don't construct factories per request, per module, per test (unless test isolation demands it — and then accept the consequence).

</details>

---

## Bug 12: Saving zero memory because object is too small

```java
public final class Bool {
    private final boolean value;
    public Bool(boolean v) { this.value = v; }
}

// Factory caches Bool.TRUE and Bool.FALSE
```

After applying Flyweight, heap measurement shows no improvement.

<details><summary>Reveal</summary>

**Bug:** The object is so small that the JVM header (~12 bytes) dominates. Sharing it doesn't save measurable memory; the factory's hashmap overhead may exceed the savings.

**Fix:** for very small objects, accept that Flyweight isn't worth it. Use primitives directly when possible.

For the rare case (e.g., autoboxed `Boolean.TRUE`/`Boolean.FALSE`), the runtime already provides cached instances; you don't need a custom factory.

**Lesson:** Profile before declaring savings. Object overhead means small objects don't always benefit. Flyweight earns its keep when the *content* of the object is meaningfully bigger than the header.

</details>

---

## Practice Tips

- Read each snippet, **stop**, predict what goes wrong.
- For each bug, think about how it'd manifest in production: silent state corruption, slow degradation, OOM.
- After fixing, write a test that *would have caught* the bug. If you can't, the fix is incomplete.
- Repeat in a week. Flyweight bugs cluster around a few patterns: mutability, factory bypass, extrinsic confusion, unbounded growth.

---

← Back to Flyweight folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Flyweight — Optimize](optimize.md)
