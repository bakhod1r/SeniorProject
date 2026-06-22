# Type Object — Optimize

> **Source:** [gameprogrammingpatterns.com/type-object.html](https://gameprogrammingpatterns.com/type-object.html)

10 inefficient implementations + benchmarks + optimized version + tradeoffs.

Benchmarks: Apple M2 Pro, single thread. Figures are illustrative orders of magnitude, not lab-grade measurements; the point is the *relative* cost.

---

## Table of Contents

1. [Optimization 1: Share one type object instead of copying](#optimization-1-share-one-type-object-instead-of-copying)
2. [Optimization 2: Intern/cache the type lookup](#optimization-2-interncache-the-type-lookup)
3. [Optimization 3: Avoid the map lookup on the hot path](#optimization-3-avoid-the-map-lookup-on-the-hot-path)
4. [Optimization 4: Copy-down inheritance instead of delegation chains](#optimization-4-copy-down-inheritance-instead-of-delegation-chains)
5. [Optimization 5: Struct-of-arrays for instances](#optimization-5-struct-of-arrays-for-instances)
6. [Optimization 6: Integer type IDs instead of string keys](#optimization-6-integer-type-ids-instead-of-string-keys)
7. [Optimization 7: Lazy type loading](#optimization-7-lazy-type-loading)
8. [Optimization 8: Copy-on-write registry instead of locking reads](#optimization-8-copy-on-write-registry-instead-of-locking-reads)
9. [Optimization 9: Cache derived per-type data](#optimization-9-cache-derived-per-type-data)
10. [Optimization 10: Validate once at load, not per access](#optimization-10-validate-once-at-load-not-per-access)

---

## Optimization 1: Share one type object instead of copying

### Inefficient

```go
type Monster struct {
    breed  Breed // value: each monster embeds a full copy of the breed
    health int
}
func NewMonster(b Breed) *Monster { return &Monster{breed: b, health: b.MaxHealth} }
```

### Why it's wasteful

The whole point of Type Object is sharing. A by-value field copies the breed (name, strings, stats) into every instance.

```
100,000 monsters × ~120 B breed  ≈ 12 MB of duplicated type data
```

### Optimized

```go
type Monster struct {
    breed  *Breed // pointer: one shared breed for all monsters of this kind
    health int
}
func NewMonster(b *Breed) *Monster { return &Monster{breed: b, health: b.MaxHealth} }
```

```
100,000 monsters × 8 B pointer + ~120 B (a few shared breeds) ≈ 0.8 MB
```

~15× less memory, and breeds stay in sync (patch the breed, every monster sees it).

### Tradeoff

Shared mutable state is dangerous — the breed **must** be immutable. You trade copy-isolation for a discipline (no breed setters).

---

## Optimization 2: Intern/cache the type lookup

### Inefficient

```python
def spawn(name: str, registry: dict, world):
    breed = registry[name]      # dict lookup + string hash EVERY spawn
    return breed.new_monster()

# Wave spawner calls spawn("goblin", ...) 5,000 times per wave.
```

### Why it's slow

Hashing the string `"goblin"` and probing the dict 5,000 times per wave is pure overhead when the breed never changes during the wave.

```
5,000 spawns × dict[str] lookup ≈ 0.9 ms/wave (hashing dominates)
```

### Optimized

```python
def spawn_wave(name: str, count: int, registry: dict, world):
    breed = registry[name]      # resolve ONCE, hoist out of the loop
    return [breed.new_monster() for _ in range(count)]
```

```
1 lookup + 5,000 constructions ≈ 0.15 ms/wave
```

### Tradeoff

You must hold the resolved breed reference. Fine when many instances of one kind are created together; if every spawn is a different kind, there's nothing to hoist.

---

## Optimization 3: Avoid the map lookup on the hot path

### Inefficient

```java
// Called every frame for every monster during AI update.
String attackString(Monster m) {
    return registry.get(m.breedName).attackString;   // map lookup per monster per frame
}
```

### Why it's slow

The monster stores a `breedName` *string* and re-resolves it through the registry on every access. With 10,000 monsters at 60 fps that's 600,000 map lookups/second for data that never moves.

```
10,000 monsters × 60 fps × HashMap.get ≈ 4.2 ms/s spent in lookups
```

### Optimized

```java
// Resolve the breed reference ONCE, at construction; store the object, not the name.
final class Monster {
    final Breed breed;                       // direct reference
    Monster(Breed breed) { this.breed = breed; }
}
String attackString(Monster m) { return m.breed.attackString; }   // field deref, no map
```

```
10,000 × 60 × pointer deref ≈ 0.05 ms/s
```

### Tradeoff

The monster now holds an object reference instead of a portable string id. If you serialize monsters, you serialize `breed.name` and re-resolve on load — which is correct anyway.

---

## Optimization 4: Copy-down inheritance instead of delegation chains

### Inefficient

```java
int maxHealth() {                          // delegation: walk parents every read
    return own != null ? own : parent.maxHealth();
}
```

### Why it's slow

A field unset on a deep breed (e.g. `eliteFireTroll → fireTroll → troll → goblin`) walks four objects per read. Reads happen constantly; the chain length is paid every time.

```
Depth-4 chain, 100,000 reads/frame ≈ 1.8 ms/frame in pointer-chasing
```

### Optimized

```java
// Resolve the full chain ONCE at load (copy-down), so reads are plain field access.
final class Breed {
    final int maxHealth;   // already includes inherited value
    Breed(Builder b, Breed parent) {
        this.maxHealth = b.maxHealth != null ? b.maxHealth : parent.maxHealth;
    }
}
int maxHealth() { return maxHealth; }   // one field load, no walk
```

```
100,000 reads/frame ≈ 0.1 ms/frame
```

### Tradeoff

Copy-down uses slightly more memory (each breed stores all inherited fields) and means changing a parent requires rebuilding descendants. Worth it: type objects are built rarely, read constantly.

---

## Optimization 5: Struct-of-arrays for instances

### Inefficient

```go
type Monster struct {           // array-of-structs
    breed  *Breed
    health int
    posX, posY float64
    cooldown   float64
}
var monsters []Monster

func tickHealth(ms []Monster) {     // touches only `health`...
    for i := range ms {
        ms[i].health = min(ms[i].health+1, ms[i].breed.MaxHealth)
    }
}
```

### Why it's slow

A health-regen pass reads only `health` and `breed.MaxHealth`, but each `Monster` struct is large; the CPU pulls whole structs (pos, cooldown) into cache, wasting bandwidth.

```
100,000 monsters, AoS regen pass ≈ 0.62 ms (cache misses on padding)
```

### Optimized

```go
type Monsters struct {          // struct-of-arrays: hot fields packed together
    breed    []*Breed
    health   []int
    posX, posY []float64
    cooldown   []float64
}
func tickHealth(m *Monsters) {
    for i := range m.health {            // tight loop over a contiguous int slice
        if max := m.breed[i].MaxHealth; m.health[i] < max {
            m.health[i]++
        }
    }
}
```

```
100,000 monsters, SoA regen pass ≈ 0.18 ms (sequential, cache-friendly)
```

### Tradeoff

SoA complicates code (no single `Monster` object to pass around) and is overkill for small N. It also moves you toward ECS — which is the right destination if you're doing this seriously. Use for hot bulk passes over many instances.

---

## Optimization 6: Integer type IDs instead of string keys

### Inefficient

```python
# Breed referenced everywhere by string name.
registry: dict[str, Breed] = {}
breed = registry["fire_troll"]          # string hash on every cross-reference
```

### Why it's slow

String keys hash the whole string each lookup and store fat keys. In a system resolving millions of breed references (loading saves, spawn tables, drop tables), string hashing adds up.

```
1,000,000 lookups by str key ≈ 78 ms
```

### Optimized

```python
# Assign each breed a small integer id at load; index a list, not a dict.
breeds: list[Breed] = []                # id == index
name_to_id: dict[str, int] = {}         # resolve names → ids ONCE, at load

def breed_id(name: str) -> int: return name_to_id[name]   # only at load/deserialize
def get(bid: int) -> Breed: return breeds[bid]            # O(1) list index, no hashing
```

```
1,000,000 lookups by int id (list index) ≈ 6 ms
```

### Tradeoff

Integer ids are not human-readable and must stay stable across reloads/saves (or you remap). Keep the name↔id table for tooling and serialization; use ids only on hot internal paths.

---

## Optimization 7: Lazy type loading

### Inefficient

```java
// Startup: parse + build EVERY breed, including 900 that this level never spawns.
void boot() {
    for (var entry : allBreedData.entrySet())   // 1,000 breeds, full parse
        registry.put(entry.getKey(), buildBreed(entry.getValue()));
}
```

### Why it's slow

A game with 1,000 breeds but a level that uses 40 pays the full parse/validate/build cost up front, lengthening load time and resident memory.

```
Build all 1,000 breeds at boot ≈ 180 ms, ~6 MB resident
```

### Optimized

```java
// Build a breed on first request; cache it. (Validate schema eagerly, build lazily.)
Breed get(String name) {
    return cache.computeIfAbsent(name, n -> buildBreed(rawData.get(n)));
}
```

```
Build only the ~40 used breeds ≈ 8 ms, ~0.3 MB resident
```

### Tradeoff

Lazy building hides bad data until first use — so still **validate** all data eagerly at load (cheap), and only defer the *build*. First spawn of a new kind has a one-time build cost (a possible frame hitch); pre-warm known-needed breeds before a wave.

---

## Optimization 8: Copy-on-write registry instead of locking reads

### Inefficient

```go
type Registry struct {
    mu     sync.RWMutex
    breeds map[string]*Breed
}
func (r *Registry) Get(name string) *Breed {
    r.mu.RLock()                 // lock on EVERY read, even though writes are rare
    defer r.mu.RUnlock()
    return r.breeds[name]
}
```

### Why it's slow

Hot reload happens seconds apart; reads happen millions of times. An RLock/RUnlock per read adds atomic contention on the shared lock across all reader goroutines.

```
8 goroutines × 1,000,000 reads with RWMutex ≈ 95 ms (lock contention)
```

### Optimized

```go
type Registry struct {
    snap atomic.Pointer[map[string]*Breed]   // immutable snapshot
}
func (r *Registry) Get(name string) (*Breed, bool) {
    b, ok := (*r.snap.Load())[name]          // single atomic load, no lock
    return b, ok
}
// Writers build a new map and Store() it (see find-bug Bug 5).
```

```
8 goroutines × 1,000,000 reads with atomic snapshot ≈ 11 ms
```

### Tradeoff

Writers do more work (copy the whole map per registration) and there's a brief window where a reader sees the pre-swap snapshot. Both are fine because breeds are immutable and writes are rare. Don't use COW if writes are frequent and the map is huge.

---

## Optimization 9: Cache derived per-type data

### Inefficient

```python
def loot_weight_total(breed: Breed) -> int:
    return sum(d.weight for d in breed.drops)   # recomputed every time we roll loot
```

### Why it's slow

Every loot roll re-sums the drop weights, even though the drop table is fixed per breed and shared. With heavy loot churn this is repeated work over immutable data.

```
500,000 loot rolls, summing a 12-entry table each time ≈ 41 ms
```

### Optimized

```python
@dataclass(frozen=True)
class Breed:
    name: str
    drops: tuple
    total_weight: int          # precomputed at load, since drops are immutable

def loot_weight_total(breed: Breed) -> int:
    return breed.total_weight  # field read
```

```
500,000 loot rolls reading a cached field ≈ 2 ms
```

### Tradeoff

Only valid because the breed (and its drop table) is immutable — derived data can be computed once and never invalidated. If breeds were mutable you'd have a cache-coherence problem. Compute derived fields in the registry's build step.

---

## Optimization 10: Validate once at load, not per access

### Inefficient

```java
int maxDamage(Monster m) {
    int lo = m.breed.minDamage, hi = m.breed.maxDamage;
    if (lo < 0 || hi < lo)                    // defensive check on EVERY access
        throw new IllegalStateException("bad damage range for " + m.breed.name);
    return hi;
}
```

### Why it's slow (and wrong-shaped)

The breed is immutable and validated at load — re-checking its invariants on every gameplay access is pure overhead, and it scatters validation logic through the codebase.

```
1,000,000 accesses with per-call validation ≈ 14 ms + branch-predictor noise
```

### Optimized

```java
// Validate ONCE when the breed is built; if a Breed exists, it's valid.
final class Breed {
    final int minDamage, maxDamage;
    Breed(int minDamage, int maxDamage) {
        if (minDamage < 0 || maxDamage < minDamage)
            throw new IllegalArgumentException("bad damage range");
        this.minDamage = minDamage; this.maxDamage = maxDamage;
    }
}
int maxDamage(Monster m) { return m.breed.maxDamage; }   // trust the invariant
```

```
1,000,000 accesses, no validation ≈ 1 ms
```

### Tradeoff

Validation must be *complete* at the boundary (structural + referential + semantic) so gameplay can trust the invariant. That's exactly the professional-level pipeline — the cost moves from per-access to once-per-load, where it belongs.

---

## Summary Table

| # | Optimization | Win | Key tradeoff |
|---|---|---|---|
| 1 | Share by pointer, not by value | ~15× memory | Breed must be immutable |
| 2 | Hoist the type lookup out of loops | ~6× spawn cost | Only helps batched same-kind spawns |
| 3 | Store the breed reference, not its name | ~80× hot-path | Re-resolve name on deserialize |
| 4 | Copy-down inheritance | ~18× read | Rebuild descendants on parent change |
| 5 | Struct-of-arrays for instances | ~3.4× bulk pass | Code complexity; leads toward ECS |
| 6 | Integer type ids | ~13× lookup | Not human-readable; must stay stable |
| 7 | Lazy type building | ~22× load time | Validate eagerly; first-use hitch |
| 8 | Copy-on-write registry | ~9× concurrent read | Writers copy the whole map |
| 9 | Cache derived per-type data | ~20× | Only sound because breeds are immutable |
| 10 | Validate at load, not per access | ~14× | Boundary validation must be complete |

The recurring theme: **immutability + share-by-reference + resolve-once-at-load**. Almost every optimization is "do the work once when the type object is built, then make the hot path a plain field read."

---

[← Find the Bug](find-bug.md) · [Other Patterns](../README.md) · [Design Patterns](../../README.md) · **Next:** [Type Object — Tasks](tasks.md)
