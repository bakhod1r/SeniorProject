# Type Object — Hands-On Tasks

> **Source:** [gameprogrammingpatterns.com/type-object.html](https://gameprogrammingpatterns.com/type-object.html)

10 practice tasks with full Go, Java, and Python solutions.

---

## Table of Contents

1. [Task 1: Basic Monster + Breed](#task-1-basic-monster--breed)
2. [Task 2: Breed as a factory](#task-2-breed-as-a-factory)
3. [Task 3: Shared breed, independent health](#task-3-shared-breed-independent-health)
4. [Task 4: Load breeds from JSON](#task-4-load-breeds-from-json)
5. [Task 5: Type inheritance (copy-down)](#task-5-type-inheritance-copy-down)
6. [Task 6: Detect inheritance cycles](#task-6-detect-inheritance-cycles)
7. [Task 7: Data-driven enemy spawner](#task-7-data-driven-enemy-spawner)
8. [Task 8: Refactor a subclass explosion](#task-8-refactor-a-subclass-explosion)
9. [Task 9: Hybrid type object (data + behavior)](#task-9-hybrid-type-object-data--behavior)
10. [Task 10: Hot-reload the breed registry](#task-10-hot-reload-the-breed-registry)

---

## Task 1: Basic Monster + Breed

**Problem:** Define a `Breed` holding `name`, `maxHealth`, and `attackString`, and a `Monster` that references a breed and starts at full health. Print a monster's name and attack.

### Go

```go
package main

import "fmt"

type Breed struct {
    Name         string
    MaxHealth    int
    AttackString string
}

type Monster struct {
    breed  *Breed
    health int
}

func (m *Monster) Name() string   { return m.breed.Name }
func (m *Monster) Attack() string { return m.breed.AttackString }

func main() {
    goblin := &Breed{"Goblin", 20, "The goblin stabs you."}
    m := &Monster{breed: goblin, health: goblin.MaxHealth}
    fmt.Printf("%s: %s\n", m.Name(), m.Attack())
}
```

### Java

```java
final class Breed {
    final String name; final int maxHealth; final String attackString;
    Breed(String name, int maxHealth, String attackString) {
        this.name = name; this.maxHealth = maxHealth; this.attackString = attackString;
    }
}
final class Monster {
    final Breed breed; int health;
    Monster(Breed breed) { this.breed = breed; this.health = breed.maxHealth; }
    String name()   { return breed.name; }
    String attack() { return breed.attackString; }
}
public class Task1 {
    public static void main(String[] args) {
        Breed goblin = new Breed("Goblin", 20, "The goblin stabs you.");
        Monster m = new Monster(goblin);
        System.out.println(m.name() + ": " + m.attack());
    }
}
```

### Python

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Breed:
    name: str
    max_health: int
    attack_string: str

class Monster:
    def __init__(self, breed: Breed):
        self.breed = breed
        self.health = breed.max_health

goblin = Breed("Goblin", 20, "The goblin stabs you.")
m = Monster(goblin)
print(f"{m.breed.name}: {m.breed.attack_string}")
```

---

## Task 2: Breed as a factory

**Problem:** Add a `newMonster()` method to `Breed` so the type object constructs instances and stamps the starting health. Callers should never `new Monster` directly.

### Go

```go
func (b *Breed) NewMonster() *Monster {
    return &Monster{breed: b, health: b.MaxHealth}
}

// usage
dragon := &Breed{"Dragon", 230, "Fire!"}
m := dragon.NewMonster()
```

### Java

```java
final class Breed {
    final String name; final int maxHealth; final String attackString;
    Breed(String name, int maxHealth, String attackString) {
        this.name = name; this.maxHealth = maxHealth; this.attackString = attackString;
    }
    Monster newMonster() { return new Monster(this); }   // type object as factory
}
// usage: Monster m = new Breed("Dragon", 230, "Fire!").newMonster();
```

### Python

```python
@dataclass(frozen=True)
class Breed:
    name: str
    max_health: int
    attack_string: str
    def new_monster(self) -> "Monster":
        return Monster(self)

# usage: m = Breed("Dragon", 230, "Fire!").new_monster()
```

---

## Task 3: Shared breed, independent health

**Problem:** Create 3 goblins from one breed. Damage one. Show the others are unaffected and that all three share the *same* breed object.

### Go

```go
func (m *Monster) TakeDamage(d int) { m.health -= d }

func main() {
    goblin := &Breed{"Goblin", 20, "stab"}
    a, b, c := goblin.NewMonster(), goblin.NewMonster(), goblin.NewMonster()
    a.TakeDamage(15)
    fmt.Println(a.health, b.health, c.health)        // 5 20 20
    fmt.Println(a.breed == b.breed, b.breed == c.breed) // true true (same object)
}
```

### Java

```java
final class Monster {
    final Breed breed; int health;
    Monster(Breed breed) { this.breed = breed; this.health = breed.maxHealth; }
    void takeDamage(int d) { health -= d; }
}
// in main:
Breed goblin = new Breed("Goblin", 20, "stab");
Monster a = goblin.newMonster(), b = goblin.newMonster(), c = goblin.newMonster();
a.takeDamage(15);
System.out.println(a.health + " " + b.health + " " + c.health); // 5 20 20
System.out.println((a.breed == b.breed) + " " + (b.breed == c.breed)); // true true
```

### Python

```python
class Monster:
    def __init__(self, breed):
        self.breed = breed
        self.health = breed.max_health
    def take_damage(self, d): self.health -= d

goblin = Breed("Goblin", 20, "stab")
a, b, c = goblin.new_monster(), goblin.new_monster(), goblin.new_monster()
a.take_damage(15)
print(a.health, b.health, c.health)            # 5 20 20
print(a.breed is b.breed, b.breed is c.breed)  # True True
```

---

## Task 4: Load breeds from JSON

**Problem:** Parse a JSON object of breeds into a registry keyed by name. Look up a breed and spawn a monster. Fail clearly on an unknown name.

### Go

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Registry struct{ breeds map[string]*Breed }

func LoadRegistry(data []byte) (*Registry, error) {
    var raw map[string]Breed
    if err := json.Unmarshal(data, &raw); err != nil {
        return nil, err
    }
    r := &Registry{breeds: map[string]*Breed{}}
    for name, b := range raw {
        bb := b           // copy loop var
        bb.Name = name
        r.breeds[name] = &bb
    }
    return r, nil
}

func (r *Registry) Get(name string) (*Breed, error) {
    b, ok := r.breeds[name]
    if !ok {
        return nil, fmt.Errorf("unknown breed: %s", name)
    }
    return b, nil
}

func main() {
    js := []byte(`{"goblin":{"MaxHealth":20,"AttackString":"stab"}}`)
    r, _ := LoadRegistry(js)
    b, err := r.Get("goblin")
    if err != nil { panic(err) }
    fmt.Println(b.NewMonster().Name())
}
```

### Java

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

final class Registry {
    private final Map<String, Breed> breeds = new HashMap<>();

    static Registry load(String json) throws Exception {
        var mapper = new ObjectMapper();
        Map<String, Map<String, Object>> raw =
            mapper.readValue(json, Map.class);
        var r = new Registry();
        for (var e : raw.entrySet()) {
            var d = e.getValue();
            r.breeds.put(e.getKey(), new Breed(
                e.getKey(),
                ((Number) d.get("maxHealth")).intValue(),
                (String) d.get("attack")));
        }
        return r;
    }
    Breed get(String name) {
        Breed b = breeds.get(name);
        if (b == null) throw new NoSuchElementException("unknown breed: " + name);
        return b;
    }
}
// Registry.load("{\"goblin\":{\"maxHealth\":20,\"attack\":\"stab\"}}").get("goblin").newMonster();
```

### Python

```python
import json

class Registry:
    def __init__(self): self._breeds = {}
    @classmethod
    def load(cls, text: str) -> "Registry":
        r = cls()
        for name, d in json.loads(text).items():
            r._breeds[name] = Breed(name, d["max_health"], d["attack"])
        return r
    def get(self, name: str) -> Breed:
        try:
            return self._breeds[name]
        except KeyError:
            raise KeyError(f"unknown breed: {name}") from None

reg = Registry.load('{"goblin": {"max_health": 20, "attack": "stab"}}')
print(reg.get("goblin").new_monster().breed.name)
```

---

## Task 5: Type inheritance (copy-down)

**Problem:** Let a breed declare a `parent`. A child inherits any field it doesn't set. Resolve inheritance at build time (copy-down). Build `troll` as a tougher `goblin`.

### Go

```go
type rawBreed struct {
    Parent    string
    MaxHealth *int
    Attack    *string
}

func (r *Registry) Add(name string, raw rawBreed) error {
    b := &Breed{Name: name}
    if raw.Parent != "" {
        p, err := r.Get(raw.Parent)
        if err != nil { return fmt.Errorf("%s: %w", name, err) }
        *b = *p        // copy-down all parent fields
        b.Name = name
    }
    if raw.MaxHealth != nil { b.MaxHealth = *raw.MaxHealth }
    if raw.Attack != nil    { b.AttackString = *raw.Attack }
    r.breeds[name] = b
    return nil
}
// Add("goblin", {MaxHealth:&20, Attack:&"stab"}); Add("troll", {Parent:"goblin", MaxHealth:&48})
// troll inherits "stab", overrides health -> 48
```

### Java

```java
final class Breed {
    final String name; final int maxHealth; final String attack;
    Breed(String name, Integer maxHealth, String attack, Breed parent) {
        this.name = name;
        this.maxHealth = maxHealth != null ? maxHealth : parent.maxHealth;  // copy-down
        this.attack    = attack    != null ? attack    : parent.attack;
    }
    Monster newMonster() { return new Monster(this); }
}
// new Breed("goblin", 20, "stab", null);
// new Breed("troll", 48, null, goblin);  // attack "stab" inherited
```

### Python

```python
@dataclass(frozen=True)
class Breed:
    name: str
    max_health: int
    attack: str

def build(name, data, registry):
    parent = registry[data["parent"]] if "parent" in data else None
    return Breed(
        name=name,
        max_health=data.get("max_health", parent.max_health if parent else None),
        attack=data.get("attack", parent.attack if parent else None),
    )

reg = {}
reg["goblin"] = build("goblin", {"max_health": 20, "attack": "stab"}, reg)
reg["troll"]  = build("troll",  {"parent": "goblin", "max_health": 48}, reg)
print(reg["troll"])   # attack "stab" inherited, max_health 48
```

---

## Task 6: Detect inheritance cycles

**Problem:** Given raw breed data with `parent` links, detect any inheritance cycle (e.g. `a→b→a`) and raise a clear error before building breeds.

### Go

```go
func DetectCycle(raw map[string]rawBreed) error {
    const (white, gray, black = 0, 1, 2)
    color := map[string]int{}
    var visit func(string) error
    visit = func(n string) error {
        color[n] = gray
        if p := raw[n].Parent; p != "" {
            if _, ok := raw[p]; !ok {
                return fmt.Errorf("%s: parent %q not found", n, p)
            }
            switch color[p] {
            case gray:
                return fmt.Errorf("inheritance cycle through %s", p)
            case white:
                if err := visit(p); err != nil { return err }
            }
        }
        color[n] = black
        return nil
    }
    for n := range raw {
        if color[n] == white {
            if err := visit(n); err != nil { return err }
        }
    }
    return nil
}
```

### Java

```java
static void detectCycle(Map<String, String> parentOf) {  // name -> parent (or null)
    Map<String, Integer> color = new HashMap<>(); // 0 white,1 gray,2 black
    for (String start : parentOf.keySet()) {
        if (color.getOrDefault(start, 0) != 0) continue;
        for (String n = start; n != null; ) {
            Integer c = color.get(n);
            if (c != null && c == 1)
                throw new IllegalStateException("inheritance cycle at " + n);
            if (c != null && c == 2) break;
            color.put(n, 1);
            n = parentOf.get(n);
        }
        // mark this chain black
        for (String n = start; n != null && color.get(n) == 1; n = parentOf.get(n))
            color.put(n, 2);
    }
}
```

### Python

```python
def detect_cycle(parent_of: dict[str, str | None]) -> None:
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in parent_of}
    def visit(n: str):
        color[n] = GRAY
        p = parent_of.get(n)
        if p is not None:
            if p not in color:
                raise KeyError(f"{n}: parent {p!r} not found")
            if color[p] == GRAY:
                raise ValueError(f"inheritance cycle through {p!r}")
            if color[p] == WHITE:
                visit(p)
        color[n] = BLACK
    for n in parent_of:
        if color[n] == WHITE:
            visit(n)

detect_cycle({"a": "b", "b": "a"})   # ValueError: inheritance cycle through 'a'
```

---

## Task 7: Data-driven enemy spawner

**Problem:** Build a spawner driven by a wave table — a list of `(breedName, count)` pairs. Resolve each breed once, spawn `count` monsters. Report total spawned per breed.

### Go

```go
type WaveEntry struct {
    Breed string
    Count int
}

func (r *Registry) SpawnWave(wave []WaveEntry) ([]*Monster, error) {
    var out []*Monster
    for _, e := range wave {
        b, err := r.Get(e.Breed)         // resolve ONCE per entry
        if err != nil { return nil, err }
        for i := 0; i < e.Count; i++ {
            out = append(out, b.NewMonster())
        }
    }
    return out, nil
}
```

### Java

```java
record WaveEntry(String breed, int count) {}

List<Monster> spawnWave(Registry reg, List<WaveEntry> wave) {
    List<Monster> out = new ArrayList<>();
    for (WaveEntry e : wave) {
        Breed b = reg.get(e.breed());        // resolve once, hoisted out of inner loop
        for (int i = 0; i < e.count(); i++) out.add(b.newMonster());
    }
    return out;
}
```

### Python

```python
def spawn_wave(registry, wave: list[tuple[str, int]]) -> list:
    out = []
    for name, count in wave:
        breed = registry.get(name)           # resolve once
        out.extend(breed.new_monster() for _ in range(count))
    return out

wave = [("goblin", 5), ("troll", 2)]
monsters = spawn_wave(reg, wave)
print(len(monsters))   # 7
```

---

## Task 8: Refactor a subclass explosion

**Problem:** You're given three subclasses differing only in data. Collapse them into one `Monster` class + `Breed` data objects, with no behavior change.

### Go

```go
// BEFORE: no inheritance in Go, but the equivalent smell is three near-identical structs.
// type Dragon struct{ health int }; func (Dragon) Attack() string { return "fire" } ... etc.

// AFTER: one Monster + Breed data.
var (
    DragonBreed = &Breed{"Dragon", 230, "fire"}
    GoblinBreed = &Breed{"Goblin", 20, "stab"}
    TrollBreed  = &Breed{"Troll", 48, "smash"}
)
// DragonBreed.NewMonster(), etc. — kinds are now data, not types.
```

### Java

```java
// BEFORE:
// class Dragon extends Monster { int maxHealth = 230; String attack = "fire"; }
// class Goblin extends Monster { int maxHealth = 20;  String attack = "stab"; }
// class Troll  extends Monster { int maxHealth = 48;  String attack = "smash"; }

// AFTER: one Monster class, kinds as Breed data.
final class Breed {
    final String name; final int maxHealth; final String attack;
    Breed(String n, int h, String a) { name=n; maxHealth=h; attack=a; }
    Monster newMonster() { return new Monster(this); }
}
final class Monster {
    final Breed breed; int health;
    Monster(Breed b) { breed = b; health = b.maxHealth; }
}
// Breed DRAGON = new Breed("Dragon", 230, "fire"); ... no subclasses.
```

### Python

```python
# BEFORE:
# class Dragon(Monster): max_health = 230; attack = "fire"
# class Goblin(Monster): max_health = 20;  attack = "stab"
# class Troll(Monster):  max_health = 48;  attack = "smash"

# AFTER: kinds become data.
DRAGON = Breed("Dragon", 230, "fire")
GOBLIN = Breed("Goblin", 20, "stab")
TROLL  = Breed("Troll", 48, "smash")
# DRAGON.new_monster(); ... one Monster class, three Breed objects.
```

---

## Task 9: Hybrid type object (data + behavior)

**Problem:** Some breeds attack differently (melee vs fire vs heal). Keep the *choice* of behavior as data on the breed, but the *implementation* in a fixed, engineer-owned set (a Strategy table).

### Go

```go
type AttackFn func(m *Monster, target string) string

var attacks = map[string]AttackFn{
    "melee": func(m *Monster, t string) string { return t + " is struck." },
    "fire":  func(m *Monster, t string) string { return t + " burns!" },
    "heal":  func(m *Monster, t string) string { return m.breed.Name + " heals." },
}

type Breed struct {
    Name      string
    MaxHealth int
    AttackKey string // DATA: picks a behavior from the fixed set
}

func (m *Monster) Attack(target string) string {
    fn, ok := attacks[m.breed.AttackKey]
    if !ok { panic("unknown attack: " + m.breed.AttackKey) }
    return fn(m, target)
}
```

### Java

```java
enum AttackKind {
    MELEE((m, t) -> t + " is struck."),
    FIRE ((m, t) -> t + " burns!"),
    HEAL ((m, t) -> m.breed.name + " heals.");
    final java.util.function.BiFunction<Monster, String, String> fn;
    AttackKind(java.util.function.BiFunction<Monster, String, String> fn) { this.fn = fn; }
}
final class Breed {
    final String name; final int maxHealth; final AttackKind attackKind; // data picks behavior
    Breed(String name, int maxHealth, AttackKind kind) {
        this.name = name; this.maxHealth = maxHealth; this.attackKind = kind;
    }
    Monster newMonster() { return new Monster(this); }
}
final class Monster {
    final Breed breed;
    Monster(Breed b) { breed = b; }
    String attack(String target) { return breed.attackKind.fn.apply(this, target); }
}
```

### Python

```python
ATTACKS = {
    "melee": lambda m, t: f"{t} is struck.",
    "fire":  lambda m, t: f"{t} burns!",
    "heal":  lambda m, t: f"{m.breed.name} heals.",
}

@dataclass(frozen=True)
class Breed:
    name: str
    max_health: int
    attack_key: str            # DATA: chooses behavior from the fixed set
    def new_monster(self): return Monster(self)

class Monster:
    def __init__(self, breed): self.breed = breed
    def attack(self, target):
        try:
            return ATTACKS[self.breed.attack_key](self, target)
        except KeyError:
            raise KeyError(f"unknown attack: {self.breed.attack_key}") from None
```

---

## Task 10: Hot-reload the breed registry

**Problem:** Implement a thread-safe, all-or-nothing reload: build new immutable breeds from updated data, validate, then atomically swap. Live monsters keep their old breed (snapshot semantics). Reads must be lock-free.

### Go

```go
import "sync/atomic"

type Registry struct {
    snap atomic.Pointer[map[string]*Breed]
}

func NewRegistry() *Registry {
    r := &Registry{}
    m := map[string]*Breed{}
    r.snap.Store(&m)
    return r
}

func (r *Registry) Get(name string) (*Breed, bool) {
    b, ok := (*r.snap.Load())[name]      // lock-free read
    return b, ok
}

func (r *Registry) Reload(raw map[string]rawBreed) error {
    next := make(map[string]*Breed, len(raw))
    for name, d := range raw {
        if d.MaxHealth == nil || *d.MaxHealth <= 0 {
            return fmt.Errorf("breed %q: invalid maxHealth", name) // reject whole batch
        }
        next[name] = &Breed{Name: name, MaxHealth: *d.MaxHealth}
    }
    r.snap.Store(&next)                  // atomic swap; old breeds untouched
    return nil
}
```

### Java

```java
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

final class Registry {
    private final AtomicReference<Map<String, Breed>> snap =
        new AtomicReference<>(Map.of());

    Optional<Breed> get(String name) { return Optional.ofNullable(snap.get().get(name)); }

    void reload(Map<String, Map<String, Object>> raw) {
        var next = new HashMap<String, Breed>();
        for (var e : raw.entrySet()) {
            Object hp = e.getValue().get("maxHealth");
            if (!(hp instanceof Number n) || n.intValue() <= 0)
                throw new IllegalArgumentException("breed " + e.getKey() + ": invalid maxHealth");
            next.put(e.getKey(), new Breed(e.getKey(), n.intValue(), ""));
        }
        snap.set(Map.copyOf(next));     // atomic swap; existing monsters keep old breed
    }
}
```

### Python

```python
import threading

class Registry:
    def __init__(self):
        self._snap: dict[str, Breed] = {}
        self._lock = threading.Lock()        # guards writers only

    def get(self, name: str) -> Breed | None:
        return self._snap.get(name)          # dict read is atomic in CPython (lock-free)

    def reload(self, raw: dict[str, dict]) -> None:
        nxt: dict[str, Breed] = {}
        for name, d in raw.items():
            hp = d.get("max_health")
            if not isinstance(hp, int) or hp <= 0:
                raise ValueError(f"breed {name!r}: invalid max_health")  # reject batch
            nxt[name] = Breed(name, hp, d.get("attack", ""))
        with self._lock:
            self._snap = nxt                 # rebind the whole dict: atomic swap
```

---

[← Optimize](optimize.md) · [Other Patterns](../README.md) · [Design Patterns](../../README.md)
