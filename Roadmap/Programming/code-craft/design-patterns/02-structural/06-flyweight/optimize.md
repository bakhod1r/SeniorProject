# Flyweight — Optimize

> **Source:** [refactoring.guru/design-patterns/flyweight](https://refactoring.guru/design-patterns/flyweight)

Each section presents a Flyweight that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Bound the cache (LRU)](#optimization-1-bound-the-cache-lru)
2. [Optimization 2: Switch to weak references](#optimization-2-switch-to-weak-references)
3. [Optimization 3: Use `__slots__` in Python](#optimization-3-use-__slots__-in-python)
4. [Optimization 4: Replace hash factory with array (small key space)](#optimization-4-replace-hash-factory-with-array-small-key-space)
5. [Optimization 5: Use integer indices instead of pointers](#optimization-5-use-integer-indices-instead-of-pointers)
6. [Optimization 6: Lock-free factory](#optimization-6-lock-free-factory)
7. [Optimization 7: Cache the lookup result in callers](#optimization-7-cache-the-lookup-result-in-callers)
8. [Optimization 8: Off-heap storage for extreme scale](#optimization-8-off-heap-storage-for-extreme-scale)
9. [Optimization 9: Combine Flyweight with Composite](#optimization-9-combine-flyweight-with-composite)
10. [Optimization 10: Drop Flyweight if savings are illusory](#optimization-10-drop-flyweight-if-savings-are-illusory)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Bound the cache (LRU)

### Before

```java
public class GlyphFactory {
    private static final Map<Key, Glyph> CACHE = new ConcurrentHashMap<>();
    public static Glyph get(...) { return CACHE.computeIfAbsent(...); }
}
```

After 24 hours of production traffic, heap is dominated by the cache; OOM imminent.

### After

```java
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.LoadingCache;

public class GlyphFactory {
    private static final LoadingCache<Key, Glyph> CACHE = Caffeine.newBuilder()
        .maximumSize(10_000)
        .recordStats()
        .build(key -> new Glyph(key.c(), key.font(), key.size()));

    public static Glyph get(char c, String f, int s) {
        return CACHE.get(new Key(c, f, s));
    }
}
```

**Measurement.** Heap caps at predictable size. Cache hit rate visible via `recordStats`.

**Lesson:** For high-cardinality keys, bound the cache. Caffeine handles concurrency, eviction, and statistics with one configuration call.

---

## Optimization 2: Switch to weak references

### Before

```python
class GlyphFactory:
    _cache: dict = {}    # strong refs
```

The cache holds millions of entries that callers no longer reference. Could be reclaimed by GC.

### After

```python
import weakref

class GlyphFactory:
    _cache: weakref.WeakValueDictionary = weakref.WeakValueDictionary()
```

**Measurement.** Cache size matches active working set. Memory drops when callers release references.

**Lesson:** Weak references give automatic cache sizing. Use when working set is variable and unpredictable.

---

## Optimization 3: Use `__slots__` in Python

### Before

```python
class Glyph:
    def __init__(self, c, font, size):
        self.char, self.font, self.size = c, font, size
```

Each instance carries a `__dict__` (~104 bytes). 1M instances → ~150 MB.

### After

```python
class Glyph:
    __slots__ = ("char", "font", "size")
    def __init__(self, c, font, size):
        self.char, self.font, self.size = c, font, size
```

**Measurement.** Per-instance memory drops from ~150 bytes to ~50 bytes. 1M instances → ~50 MB.

**Lesson:** In Python, `__slots__` complements Flyweight by reducing per-instance overhead. Always use for Flyweight classes.

---

## Optimization 4: Replace hash factory with array (small key space)

### Before

```java
public static Glyph get(char c, String font, int size) {
    return CACHE.computeIfAbsent(new Key(c, font, size), Glyph::new);
}
```

Hash lookup ~50 ns. The dominant case is ASCII (`c < 128`) Arial 12; 99% of calls are this.

### After

```java
private static final Glyph[] ASCII_ARIAL_12 = new Glyph[128];
static {
    for (int c = 0; c < 128; c++) ASCII_ARIAL_12[c] = new Glyph((char) c, "Arial", 12);
}

public static Glyph get(char c, String font, int size) {
    if (c < 128 && font.equals("Arial") && size == 12) {
        return ASCII_ARIAL_12[c];
    }
    return CACHE.computeIfAbsent(new Key(c, font, size), Glyph::new);
}
```

**Measurement.** Hot-path lookup drops from ~50 ns to ~5 ns. 90% of calls take the fast path.

**Lesson:** For small, dense key spaces, an array beats a hash map. Hot-path specialization is a worthwhile optimization.

---

## Optimization 5: Use integer indices instead of pointers

### Before

```go
type Tree struct {
    kind *TreeKind   // 8 bytes
    x, y float32     // 8 bytes
}
// 24 bytes (alignment)
```

### After

```go
type Tree struct {
    kindIdx uint16   // 2 bytes; supports 65k species
    x, y    float32  // 8 bytes
}
// 12 bytes (alignment)
```

The kinds are stored in a slice (the factory). `kinds[t.kindIdx]` accesses the flyweight.

**Measurement.** Per-tree memory drops 50%. For 1M trees: 12 MB saved.

**Lesson:** When references are 8 bytes and the key space is small, indices are smaller. Useful when the context object is allocation-intensive.

---

## Optimization 6: Lock-free factory

### Before

```go
func (f *GlyphFactory) Get(c rune, font string, size int) *Glyph {
    f.mu.Lock(); defer f.mu.Unlock()
    // ... lookup, insert ...
}
```

Under high concurrency, the lock is the bottleneck.

### After

```go
import "sync"

type GlyphFactory struct {
    cache sync.Map   // lock-free
}

func (f *GlyphFactory) Get(c rune, font string, size int) *Glyph {
    key := GlyphKey{c, font, size}
    if v, ok := f.cache.Load(key); ok { return v.(*Glyph) }
    g := &Glyph{c, font, size}
    actual, _ := f.cache.LoadOrStore(key, g)
    return actual.(*Glyph)
}
```

**Measurement.** At 8 threads, throughput up 5-10×. Contention disappears from the profile.

**Lesson:** Lock-free maps (`sync.Map`, Java `ConcurrentHashMap`) give linear scaling on read-heavy workloads.

---

## Optimization 7: Cache the lookup result in callers

### Before

```java
for (int i = 0; i < text.length(); i++) {
    Glyph g = factory.get(text.charAt(i), "Arial", 12);
    g.draw(i * 8, 0);
}
```

Every iteration looks up the factory.

### After

```java
String font = "Arial";
int size = 12;
char prev = 0;
Glyph cached = null;
for (int i = 0; i < text.length(); i++) {
    char c = text.charAt(i);
    if (c != prev) {
        cached = factory.get(c, font, size);
        prev = c;
    }
    cached.draw(i * 8, 0);
}
```

For consecutive identical characters, no factory call. In English text, ~50-70% of consecutive pairs share a character or word.

**Measurement.** Factory calls drop ~30-50%; render loop ~20% faster.

**Lesson:** Cache the factory result locally for repeated lookups. Hot loops should not always hit the factory.

---

## Optimization 8: Off-heap storage for extreme scale

### Before

100M `Token` instances on heap. JVM minor GC takes 200ms+ — unacceptable for a streaming pipeline.

### After

Store tokens in an off-heap arena (Chronicle Map, Apache Arrow):

```java
ChronicleMap<TokenKey, TokenData> tokens = ChronicleMapBuilder
    .of(TokenKey.class, TokenData.class)
    .entries(100_000_000)
    .createPersistedTo(tokenFile);
```

Tokens live outside the heap; GC traversal doesn't touch them.

**Measurement.** GC pause times drop 90%. Heap usage stable at app-level (a few GB) instead of dataset size (100s of GB).

**Lesson:** When data sets exceed heap budget, off-heap storage scales beyond Flyweight's reach. The pattern dissolves into systems-level engineering.

---

## Optimization 9: Combine Flyweight with Composite

### Before

```java
class TextNode { Glyph glyph; int x, y; }
class TextLine { List<TextNode> chars; }
class Document { List<TextLine> lines; }
```

50k characters → 50k `TextNode` instances. Each holds `glyph + x + y`.

### After (Composite tree where leaves share Glyphs):

```java
class TextLine {
    Glyph[] glyphs;     // 50k references — but each shared via Flyweight
    int[] xPositions;
    int yPosition;      // shared per line
}
```

Or compress further: store only character codes; resolve Glyph at render time:

```java
class TextLine {
    String text;        // backing string
    int[] xPositions;
    int yPosition;
    Font font;          // shared per line
}
```

**Measurement.** Memory per line drops dramatically. Iteration is cache-friendly (parallel arrays).

**Lesson:** Flyweight + Composite + columnar layout combine to reduce memory drastically. Choose layout based on access pattern.

---

## Optimization 10: Drop Flyweight if savings are illusory

### Before

A small `Setting` class wrapped in a Flyweight factory. ~100 unique settings used in the app.

### Measurement

Heap dump shows: 100 cached `Setting` instances + factory hashmap (~5KB). Without Flyweight: ~100 instances × 32 bytes = 3.2KB. **Flyweight added overhead.**

### After

Drop the factory. Use direct construction:

```java
public final class Setting {
    public Setting(String key, String value) { ... }
}
```

**Measurement.** Code simpler; memory similar; readability up.

**Lesson:** Profile before declaring Flyweight a win. For small object counts, the factory overhead may exceed the savings.

---

## Optimization Tips

1. **Profile before and after.** Don't claim savings you can't measure.
2. **Bound the cache.** Use LRU, weak refs, or array-backed factories.
3. **Use `__slots__` (Python) or final fields (Java).** Reduce per-instance overhead.
4. **Specialize hot paths.** Array index for small key spaces beats hash map.
5. **Indices over pointers** when references dominate context size.
6. **Lock-free maps** (`sync.Map`, `ConcurrentHashMap`) for concurrency.
7. **Cache lookup results in callers.** Hot loops shouldn't always hit the factory.
8. **Off-heap for extreme scale.** When heap can't contain the data set.
9. **Combine with Composite + columnar layout** for cache-friendly iteration.
10. **Drop Flyweight if savings are illusory.** Reverse over-engineering aggressively.
11. **Test memory regression** in CI. Catch bypasses and unbounded growth.
12. **Optimize for change too.** A clean 50-line factory beats a tweaked 500-line one.

---

← Back to Flyweight folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**You've completed the Flyweight pattern suite.** Continue to: [Proxy](../07-proxy/junior.md)
