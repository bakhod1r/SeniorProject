# Flyweight — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/flyweight](https://refactoring.guru/design-patterns/flyweight)

Each task includes a brief, the data shape, and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Glyph factory](#task-1-glyph-factory)
2. [Task 2: Forest with shared TreeKind](#task-2-forest-with-shared-treekind)
3. [Task 3: Color flyweight](#task-3-color-flyweight)
4. [Task 4: LRU-bounded factory](#task-4-lru-bounded-factory)
5. [Task 5: Weak-reference factory](#task-5-weak-reference-factory)
6. [Task 6: Token table for NLP](#task-6-token-table-for-nlp)
7. [Task 7: Particle system flyweight](#task-7-particle-system-flyweight)
8. [Task 8: Concurrent factory](#task-8-concurrent-factory)
9. [Task 9: Refactor a memory-heavy class](#task-9-refactor-a-memory-heavy-class)
10. [Task 10: Memory benchmark](#task-10-memory-benchmark)
11. [How to Practice](#how-to-practice)

---

## Task 1: Glyph factory

**Brief.** Build a glyph factory; render the word "hello" using shared flyweights.

### Solution (Go)

```go
type Glyph struct{ char rune; font string; size int }

func (g *Glyph) Draw(x int) { fmt.Printf("%c@%d ", g.char, x) }

type GlyphFactory struct{ cache map[GlyphKey]*Glyph }
type GlyphKey struct{ c rune; font string; size int }

func New() *GlyphFactory { return &GlyphFactory{cache: map[GlyphKey]*Glyph{}} }

func (f *GlyphFactory) Get(c rune, font string, size int) *Glyph {
    k := GlyphKey{c, font, size}
    if g, ok := f.cache[k]; ok { return g }
    g := &Glyph{c, font, size}
    f.cache[k] = g
    return g
}

f := New()
for i, c := range "hello" {
    f.Get(c, "Arial", 12).Draw(i * 8)
}
fmt.Println("\nunique:", len(f.cache))   // 4 (h e l o)
```

---

## Task 2: Forest with shared TreeKind

**Brief.** Plant 1M trees of one species; verify only 1 `TreeKind` is allocated.

### Solution (Python)

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class TreeKind:
    species: str
    color: str

class TreeKindFactory:
    _cache: dict[tuple, TreeKind] = {}
    @classmethod
    def get(cls, species, color):
        k = (species, color)
        if k not in cls._cache: cls._cache[k] = TreeKind(species, color)
        return cls._cache[k]

class Tree:
    __slots__ = ("kind", "x", "y")
    def __init__(self, kind, x, y): self.kind, self.x, self.y = kind, x, y

trees = []
for x in range(1000):
    for y in range(1000):
        trees.append(Tree(TreeKindFactory.get("oak", "green"), x, y))

print("trees:", len(trees), "kinds:", len(TreeKindFactory._cache))
# trees: 1000000  kinds: 1
```

---

## Task 3: Color flyweight

**Brief.** Cache `Color(r, g, b)` instances. Two calls with the same r/g/b return identity-equal instances.

### Solution (Java)

```java
public final class Color {
    private final int r, g, b;
    private Color(int r, int g, int b) { this.r=r; this.g=g; this.b=b; }
    private static final Map<Long, Color> CACHE = new ConcurrentHashMap<>();

    public static Color of(int r, int g, int b) {
        long key = ((long)r << 16) | ((long)g << 8) | b;
        return CACHE.computeIfAbsent(key, k -> new Color(r, g, b));
    }
}

assert Color.of(255, 0, 0) == Color.of(255, 0, 0);   // identity
```

---

## Task 4: LRU-bounded factory

**Brief.** Cache up to 100 flyweights; evict least-recently-used when full.

### Solution (Java)

```java
public final class GlyphFactory {
    private final LinkedHashMap<Key, Glyph> cache;

    public GlyphFactory(int maxSize) {
        this.cache = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<Key, Glyph> e) {
                return size() > maxSize;
            }
        };
    }

    public synchronized Glyph get(char c, String font, int size) {
        var key = new Key(c, font, size);
        return cache.computeIfAbsent(key, k -> new Glyph(c, font, size));
    }

    record Key(char c, String font, int size) {}
}
```

Test: insert 200 unique glyphs; verify cache size stays at 100; verify the first inserted key is evicted.

---

## Task 5: Weak-reference factory

**Brief.** Cache flyweights via weak references. Once no client holds a reference, GC reclaims.

### Solution (Python)

```python
import weakref

class GlyphFactory:
    def __init__(self):
        self._cache: weakref.WeakValueDictionary = weakref.WeakValueDictionary()

    def get(self, char, font, size):
        key = (char, font, size)
        g = self._cache.get(key)
        if g is None:
            g = Glyph(char, font, size)
            self._cache[key] = g
        return g
```

When all `Tree` references to a `Glyph` are dropped, the glyph is GC'd; the weak entry is removed.

---

## Task 6: Token table for NLP

**Brief.** Map tokens to integer IDs; document holds int IDs instead of full token references.

### Solution (Python)

```python
class TokenKind:
    __slots__ = ("text", "kind")
    def __init__(self, text, kind): self.text, self.kind = text, kind

class TokenTable:
    def __init__(self):
        self._kinds: list[TokenKind] = []
        self._idx: dict = {}

    def id_of(self, text, kind):
        key = (text, kind)
        if key in self._idx: return self._idx[key]
        i = len(self._kinds)
        self._kinds.append(TokenKind(text, kind))
        self._idx[key] = i
        return i

    def kind(self, i):
        return self._kinds[i]


# Document is a list of int IDs.
table = TokenTable()
doc_ids = [table.id_of(w, "word") for w in "the quick brown fox jumps over the lazy dog".split()]
print(doc_ids)        # [0, 1, 2, 3, 4, 5, 0, 6, 7]  ← "the" reused
print(len(table._kinds))   # 8 unique
```

---

## Task 7: Particle system flyweight

**Brief.** A particle has shared mesh + texture (intrinsic) and per-instance position/velocity (extrinsic).

### Solution (Go)

```go
type ParticleType struct{ mesh string; texture string; mass float32 }

var particleTypes = map[string]*ParticleType{}
var muTypes sync.Mutex

func GetParticleType(name string, mesh string, tex string, mass float32) *ParticleType {
    muTypes.Lock(); defer muTypes.Unlock()
    if t, ok := particleTypes[name]; ok { return t }
    t := &ParticleType{mesh, tex, mass}
    particleTypes[name] = t
    return t
}

type Particle struct {
    typ *ParticleType
    x, y, vx, vy float32
}

func (p *Particle) Update(dt float32) {
    p.x += p.vx * dt
    p.y += p.vy * dt
}
```

Spawn 50k particles of one type; one shared `*ParticleType`.

---

## Task 8: Concurrent factory

**Brief.** Multiple goroutines call the factory simultaneously; verify no duplicates.

### Solution (Go)

```go
type GlyphFactory struct {
    mu    sync.RWMutex
    cache map[GlyphKey]*Glyph
}

func (f *GlyphFactory) Get(c rune, font string, size int) *Glyph {
    key := GlyphKey{c, font, size}
    f.mu.RLock()
    if g, ok := f.cache[key]; ok { f.mu.RUnlock(); return g }
    f.mu.RUnlock()

    f.mu.Lock(); defer f.mu.Unlock()
    if g, ok := f.cache[key]; ok { return g }   // double-check
    g := &Glyph{c, font, size}
    f.cache[key] = g
    return g
}

// Test:
var wg sync.WaitGroup
results := make(chan *Glyph, 1000)
for i := 0; i < 1000; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); results <- f.Get('e', "Arial", 12) }()
}
wg.Wait(); close(results)

first := <-results
for g := range results {
    if g != first { t.Fatal("duplicate flyweight") }
}
```

---

## Task 9: Refactor a memory-heavy class

**Brief.** Given:

```python
class Tree:
    def __init__(self, species, color, texture, x, y, scale):
        self.species, self.color, self.texture = species, color, texture
        self.x, self.y, self.scale = x, y, scale
```

Refactor into Flyweight.

### Solution

```python
@dataclass(frozen=True)
class TreeKind:
    species: str
    color: str
    texture: str

class TreeKindFactory:
    _cache: dict = {}
    @classmethod
    def get(cls, species, color, texture):
        k = (species, color, texture)
        if k not in cls._cache: cls._cache[k] = TreeKind(*k)
        return cls._cache[k]

class Tree:
    __slots__ = ("kind", "x", "y", "scale")
    def __init__(self, species, color, texture, x, y, scale):
        self.kind = TreeKindFactory.get(species, color, texture)
        self.x, self.y, self.scale = x, y, scale
```

For 1M trees of 5 species: 5 `TreeKind` instances; 1M small `Tree` contexts.

---

## Task 10: Memory benchmark

**Brief.** Build the same structure with and without Flyweight; measure memory.

### Solution (Python)

```python
import tracemalloc

def benchmark(use_flyweight: bool):
    tracemalloc.start()
    if use_flyweight:
        kinds = TreeKindFactory()
        trees = [Tree(kinds.get("oak", "green", "bark1"), x, y, 1.0)
                 for x in range(100) for y in range(100)]
    else:
        trees = [TreeOriginal("oak", "green", "bark1", x, y, 1.0)
                 for x in range(100) for y in range(100)]
    snapshot = tracemalloc.take_snapshot()
    total = sum(s.size for s in snapshot.statistics("filename"))
    tracemalloc.stop()
    return total

with_fw = benchmark(True)
without = benchmark(False)
print(f"with Flyweight: {with_fw / 1024:.1f} KB")
print(f"without:        {without / 1024:.1f} KB")
print(f"savings:        {(without - with_fw) / 1024:.1f} KB ({100 * (1 - with_fw / without):.1f}%)")
```

---

## How to Practice

1. **Try each task.** Don't peek before you have something working.
2. **Always verify sharing.** `factory.get(k) is factory.get(k)` (Python) or `==` (Go/Java) should be true.
3. **Measure memory.** Heap dump or `tracemalloc` before and after. The savings are the proof.
4. **Stress concurrency.** For factory tasks, run 1000 concurrent goroutines/threads; assert no duplicates.
5. **Refactor a real class.** Pick one in your codebase; identify intrinsic; apply Flyweight; measure.
6. **Test eviction policies.** Build LRU and weak-ref versions; understand the trade-offs first-hand.
7. **Profile a high-cardinality case.** What happens when keys are mostly unique? See the cost of an unbounded cache.

---

← Back to Flyweight folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Flyweight — Find the Bug](find-bug.md)
