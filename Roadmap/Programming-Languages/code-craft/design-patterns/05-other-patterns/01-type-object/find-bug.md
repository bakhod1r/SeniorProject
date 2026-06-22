# Type Object — Find the Bug

> **Source:** [gameprogrammingpatterns.com/type-object.html](https://gameprogrammingpatterns.com/type-object.html)

12 buggy snippets. Read, find the bug, then check the answer. Bugs distributed across Go, Java, Python.

---

## Table of Contents

1. [Bug 1: Mutating shared type data (Java)](#bug-1-mutating-shared-type-data-java)
2. [Bug 2: Storing the type object by value (Go)](#bug-2-storing-the-type-object-by-value-go)
3. [Bug 3: Deep-copying the breed per instance (Python)](#bug-3-deep-copying-the-breed-per-instance-python)
4. [Bug 4: Missing instance-to-type back-reference (Java)](#bug-4-missing-instance-to-type-back-reference-java)
5. [Bug 5: Registry race condition (Go)](#bug-5-registry-race-condition-go)
6. [Bug 6: Null type lookup from data (Python)](#bug-6-null-type-lookup-from-data-python)
7. [Bug 7: Type-inheritance cycle (Java)](#bug-7-type-inheritance-cycle-java)
8. [Bug 8: Children loaded before parents (Python)](#bug-8-children-loaded-before-parents-python)
9. [Bug 9: Per-instance state on the type object (Go)](#bug-9-per-instance-state-on-the-type-object-go)
10. [Bug 10: Comparing instances by type identity wrongly (Java)](#bug-10-comparing-instances-by-type-identity-wrongly-java)
11. [Bug 11: Mutable collection inside an immutable breed (Python)](#bug-11-mutable-collection-inside-an-immutable-breed-python)
12. [Bug 12: In-place mutation on hot reload (Go)](#bug-12-in-place-mutation-on-hot-reload-go)

---

## Bug 1: Mutating shared type data (Java)

```java
class Breed {
    String name;
    int maxHealth;
    Breed(String name, int maxHealth) { this.name = name; this.maxHealth = maxHealth; }
}

class Monster {
    final Breed breed;
    int health;
    Monster(Breed breed) { this.breed = breed; this.health = breed.maxHealth; }

    // "Buff" this monster permanently.
    void enrage() {
        breed.maxHealth += 50;   // ← BUG
        this.health = breed.maxHealth;
    }
}
```

**Symptoms:** Enraging *one* goblin raises `maxHealth` for *every* goblin sharing that breed, and any goblin spawned afterward starts with the inflated value.

<details><summary>Find the bug</summary>

`breed` is shared by every monster of that kind. Writing `breed.maxHealth += 50` mutates the shared type object, corrupting all instances. Per-instance buffs must live on the instance, and the breed should be immutable.

</details>

### Fix

```java
final class Breed {
    final String name;
    final int maxHealth;          // immutable: shared safely
    Breed(String name, int maxHealth) { this.name = name; this.maxHealth = maxHealth; }
}

final class Monster {
    final Breed breed;
    int maxHealthBonus = 0;        // per-instance modifier
    int health;
    Monster(Breed breed) { this.breed = breed; this.health = breed.maxHealth; }

    int maxHealth() { return breed.maxHealth + maxHealthBonus; }
    void enrage()   { maxHealthBonus += 50; health = maxHealth(); }
}
```

---

## Bug 2: Storing the type object by value (Go)

```go
type Breed struct {
    Name      string
    MaxHealth int
}

type Monster struct {
    breed  Breed // ← BUG: stored by value, not by pointer
    health int
}

func NewMonster(b Breed) *Monster {
    return &Monster{breed: b, health: b.MaxHealth}
}
```

**Symptoms:** With 10,000 monsters you store 10,000 full copies of the breed — no memory win. Worse, a later "patch the goblin breed" updates the registry's copy but none of the copies already embedded in live monsters.

<details><summary>Find the bug</summary>

`breed Breed` embeds a *copy* of the breed in every monster. Type Object's sharing (and the Flyweight memory win) only works when instances hold a *pointer* to one shared breed.

</details>

### Fix

```go
type Monster struct {
    breed  *Breed // pointer → one shared breed object
    health int
}

func NewMonster(b *Breed) *Monster {
    return &Monster{breed: b, health: b.MaxHealth}
}
```

---

## Bug 3: Deep-copying the breed per instance (Python)

```python
import copy
from dataclasses import dataclass

@dataclass
class Breed:
    name: str
    max_health: int
    attack: str

class Monster:
    def __init__(self, breed: Breed):
        self.breed = copy.deepcopy(breed)   # ← BUG
        self.health = self.breed.max_health
```

**Symptoms:** Memory balloons — each of 50,000 monsters owns a full clone of its breed. Profiling shows millions of `Breed` objects where there should be a few dozen.

<details><summary>Find the bug</summary>

`copy.deepcopy(breed)` defeats the entire pattern. The point is that thousands of monsters *share* one breed. Deep-copying "to be safe" destroys the Flyweight win. Safety comes from immutability, not copying.

</details>

### Fix

```python
@dataclass(frozen=True)         # immutable → safe to share, no copy needed
class Breed:
    name: str
    max_health: int
    attack: str

class Monster:
    def __init__(self, breed: Breed):
        self.breed = breed       # shared reference
        self.health = breed.max_health
```

---

## Bug 4: Missing instance-to-type back-reference (Java)

```java
final class Breed {
    final String name;
    final int maxHealth;
    Breed(String name, int maxHealth) { this.name = name; this.maxHealth = maxHealth; }
    Monster newMonster() {
        return new Monster(maxHealth);   // ← BUG: passes data, not the breed
    }
}

final class Monster {
    int health;
    Monster(int maxHealth) { this.health = maxHealth; }

    String describe() {
        return "??? (" + health + ")";   // can't get the name — no breed reference!
    }
}
```

**Symptoms:** A monster can't answer `getName()` or `attack()` because it never kept a reference to its breed — only a snapshot of one field.

<details><summary>Find the bug</summary>

The factory copied `maxHealth` into the monster but dropped the breed reference. The type reference is mandatory: it's how the instance reaches all of its kind's data.

</details>

### Fix

```java
final class Breed {
    final String name; final int maxHealth;
    Monster newMonster() { return new Monster(this); }   // pass the breed itself
}
final class Monster {
    final Breed breed;
    int health;
    Monster(Breed breed) { this.breed = breed; this.health = breed.maxHealth; }
    String describe() { return breed.name + " (" + health + "/" + breed.maxHealth + ")"; }
}
```

---

## Bug 5: Registry race condition (Go)

```go
type Registry struct {
    breeds map[string]*Breed
}

func (r *Registry) Get(name string) *Breed { return r.breeds[name] }

// Called from a mod loader on another goroutine while the game loop calls Get.
func (r *Registry) Register(b *Breed) {
    r.breeds[b.Name] = b   // ← BUG: concurrent map write vs concurrent read
}
```

**Symptoms:** Intermittent `fatal error: concurrent map read and map write` crashes when content is hot-loaded while the game loop is spawning monsters.

<details><summary>Find the bug</summary>

A plain Go map is not safe for concurrent read+write. The game loop reads via `Get` while the loader writes via `Register` — a data race that the runtime aborts on. Because breeds are immutable, copy-on-write is the clean fix.

</details>

### Fix

```go
type Registry struct {
    snap atomic.Pointer[map[string]*Breed]
}

func (r *Registry) Get(name string) (*Breed, bool) {
    b, ok := (*r.snap.Load())[name]
    return b, ok                       // lock-free read of an immutable snapshot
}

func (r *Registry) Register(b *Breed) {
    old := r.snap.Load()
    next := make(map[string]*Breed, len(*old)+1)
    for k, v := range *old {
        next[k] = v
    }
    next[b.Name] = b
    r.snap.Store(&next)                // atomic swap; readers never see a torn map
}
```

---

## Bug 6: Null type lookup from data (Python)

```python
class Spawner:
    def __init__(self, registry: dict[str, "Breed"]):
        self.registry = registry

    def spawn(self, breed_name: str) -> "Monster":
        breed = self.registry.get(breed_name)   # ← BUG: returns None on typo
        return breed.new_monster()              # AttributeError, far from the cause
```

**Symptoms:** A typo in a spawn table (`"gobln"`) produces `AttributeError: 'NoneType' object has no attribute 'new_monster'` deep in spawning, with no clue which data row was wrong.

<details><summary>Find the bug</summary>

`dict.get` returns `None` for a missing key; the code then dereferences it. Missing type names from data must fail loudly *at the lookup*, naming the offending key — or fall back to a documented default.

</details>

### Fix

```python
class Spawner:
    def spawn(self, breed_name: str) -> "Monster":
        try:
            breed = self.registry[breed_name]        # KeyError names the bad key
        except KeyError:
            raise KeyError(f"unknown breed in spawn table: {breed_name!r}") from None
        return breed.new_monster()
```

---

## Bug 7: Type-inheritance cycle (Java)

```java
final class Breed {
    final String name;
    final Breed parent;
    final Integer ownMaxHealth;
    Breed(String name, Integer ownMaxHealth, Breed parent) {
        this.name = name; this.ownMaxHealth = ownMaxHealth; this.parent = parent;
    }
    // Delegation: walk up the chain for an unset field.
    int maxHealth() {
        if (ownMaxHealth != null) return ownMaxHealth;
        return parent.maxHealth();   // ← BUG: infinite recursion on a cycle
    }
}
```

**Symptoms:** If designer data accidentally makes Troll's parent Orc and Orc's parent Troll, `maxHealth()` recurses until `StackOverflowError`.

<details><summary>Find the bug</summary>

Nothing detects inheritance cycles. With `troll → orc → troll`, the delegation walk never terminates. Cycles must be caught when the registry is built, before any breed goes live.

</details>

### Fix

```java
// At load time, validate the parent graph is acyclic:
static void assertNoCycle(Breed b) {
    Set<Breed> seen = new HashSet<>();
    for (Breed cur = b; cur != null; cur = cur.parent) {
        if (!seen.add(cur))
            throw new IllegalStateException("inheritance cycle at breed: " + cur.name);
    }
}
// Even better: use copy-down so maxHealth() is a plain field, never a runtime walk.
```

---

## Bug 8: Children loaded before parents (Python)

```python
def load(raw: dict[str, dict], registry: dict) -> None:
    for name, data in raw.items():                # ← BUG: arbitrary order
        parent = registry[data["parent"]] if "parent" in data else None
        registry[name] = Breed(
            name=name,
            max_health=data.get("max_health", parent.max_health if parent else None),
        )
```

**Symptoms:** Loading `{"troll": {"parent": "goblin", ...}, "goblin": {...}}` throws `KeyError: 'goblin'` because `troll` is processed first and its parent isn't in the registry yet.

<details><summary>Find the bug</summary>

The loader assumes parents appear before children, but dict/JSON order is whatever the designer wrote. A child needs its parent built first — load in topological order (and detect cycles while sorting).

</details>

### Fix

```python
def load(raw: dict[str, dict], registry: dict) -> None:
    def visit(name, stack):
        if name in registry: return
        if name in stack: raise ValueError(f"inheritance cycle at {name}")
        stack.add(name)
        data = raw[name]
        parent = None
        if "parent" in data:
            if data["parent"] not in raw:
                raise KeyError(f"{name}: parent {data['parent']!r} not found")
            visit(data["parent"], stack)             # parent first
            parent = registry[data["parent"]]
        stack.discard(name)
        registry[name] = Breed(name=name,
            max_health=data.get("max_health", parent.max_health if parent else None))
    for n in raw:
        visit(n, set())
```

---

## Bug 9: Per-instance state on the type object (Go)

```go
type Breed struct {
    Name      string
    MaxHealth int
    Health    int // ← BUG: current health on the SHARED type object
}

func (b *Breed) NewMonster() *Breed {
    copy := *b
    copy.Health = b.MaxHealth
    return &copy // returns a "monster" that's really a breed copy
}

func (b *Breed) TakeDamage(d int) { b.Health -= d }
```

**Symptoms:** There's no real `Monster` type — `Health` lives on `Breed`, and the "factory" copies the whole breed per spawn. Damaging one shared breed would hit all monsters; the workaround (copying) silently reintroduces Bug 2/3.

<details><summary>Find the bug</summary>

Current health is per-instance state and must not live on the type object. Conflating `Breed` and `Monster` forces a copy-per-spawn (losing sharing) just to keep healths separate. Split the two roles.

</details>

### Fix

```go
type Breed struct {                  // shared, immutable: only per-kind data
    Name      string
    MaxHealth int
}
type Monster struct {                // per-instance state
    breed  *Breed
    Health int
}
func (b *Breed) NewMonster() *Monster { return &Monster{breed: b, Health: b.MaxHealth} }
func (m *Monster) TakeDamage(d int)   { m.Health -= d }   // affects only this monster
```

---

## Bug 10: Comparing instances by type identity wrongly (Java)

```java
boolean sameMonster(Monster a, Monster b) {
    return a.breed == b.breed;   // ← BUG: this answers "same KIND?", not "same monster?"
}
```

**Symptoms:** `sameMonster(goblin1, goblin2)` returns `true` for two *different* goblins because they share the goblin breed. Targeting/de-dup logic treats distinct monsters as the same entity.

<details><summary>Find the bug</summary>

`a.breed == b.breed` compares *type* identity (same kind), not *instance* identity. Two distinct monsters of the same breed share one breed object, so this is always true within a kind. Compare the instances themselves for identity.

</details>

### Fix

```java
boolean sameMonster(Monster a, Monster b) { return a == b; }      // instance identity
boolean sameKind(Monster a, Monster b)    { return a.breed == b.breed; }  // type identity
```

*(Caveat: `breed ==` is reliable for "same kind" only within one registry generation; after a hot reload that rebuilds breeds, compare `a.breed.name.equals(b.breed.name)`.)*

---

## Bug 11: Mutable collection inside an immutable breed (Python)

```python
from dataclasses import dataclass, field

@dataclass(frozen=True)
class Breed:
    name: str
    loot: list[str] = field(default_factory=list)   # ← BUG: mutable list in a "frozen" breed

class Monster:
    def __init__(self, breed: Breed):
        self.breed = breed

    def drop_extra(self, item: str):
        self.breed.loot.append(item)   # mutates the SHARED list
```

**Symptoms:** `@dataclass(frozen=True)` blocks reassigning `loot`, but the *list it points at* is still mutable. One monster appending to `loot` changes the loot table for every monster of that breed.

<details><summary>Find the bug</summary>

Frozen dataclasses are *shallow* — they freeze the reference, not the contents. A shared mutable list inside a shared breed corrupts all instances when mutated. Use an immutable container, and put per-instance drops on the instance.

</details>

### Fix

```python
@dataclass(frozen=True)
class Breed:
    name: str
    loot: tuple[str, ...] = ()        # immutable tuple, safe to share

class Monster:
    def __init__(self, breed: Breed):
        self.breed = breed
        self.extra_loot: list[str] = []        # per-instance, mutable here is fine
    def drop_extra(self, item: str):
        self.extra_loot.append(item)
```

---

## Bug 12: In-place mutation on hot reload (Go)

```go
// Hot reload: apply new data to existing breeds.
func (r *Registry) Reload(updates map[string]BreedData) {
    for name, data := range updates {
        b := r.breeds[name]
        b.MaxHealth = data.MaxHealth   // ← BUG: mutates a live, shared breed in place
        b.Attack = data.Attack
    }
}
```

**Symptoms:** While the game loop reads `breed.MaxHealth` and `breed.Attack` for spawning, the reloader writes them on another goroutine — a data race that can read a torn pair (new MaxHealth, old Attack). Also breaks any "snapshot" expectation that live monsters keep their original stats.

<details><summary>Find the bug</summary>

Hot reload must not mutate live breeds in place: it races readers and tears data. Build brand-new immutable breeds, then atomically swap the whole registry (build-validate-swap). Live monsters keep their old breed (snapshot) or are re-pointed at a frame boundary.

</details>

### Fix

```go
func (r *Registry) Reload(updates map[string]BreedData) error {
    old := r.snap.Load()
    next := make(map[string]*Breed, len(*old))
    for k, v := range *old {
        next[k] = v
    }
    for name, data := range updates {
        next[name] = &Breed{Name: name, MaxHealth: data.MaxHealth, Attack: data.Attack} // new object
    }
    // (validate `next` fully here; reject on error)
    r.snap.Store(&next)   // atomic swap; no live breed is ever mutated
    return nil
}
```

---

[← Interview](interview.md) · [Other Patterns](../README.md) · [Design Patterns](../../README.md) · **Next:** [Type Object — Optimize](optimize.md)
