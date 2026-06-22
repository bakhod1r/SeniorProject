# Type Object — Interview Preparation

> **Source:** [gameprogrammingpatterns.com/type-object.html](https://gameprogrammingpatterns.com/type-object.html)
> **Format:** Q&A across all levels with model answers.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is the Type Object pattern?

**Answer:** A pattern that lets you define new "kinds of things" as **data** instead of as **subclasses**. Instead of `Dragon`, `Goblin`, `Troll` each being a class, you have one class (`Monster`) plus a separate "type" object (`Breed`) holding the per-kind data. Each `Monster` instance holds a reference to its `Breed`.

### J2. What problem does it solve?

**Answer:** The **class explosion**: one subclass per data variation, producing dozens of near-identical classes that differ only in a few values. Type Object collapses them into one class plus N data objects, so adding a kind becomes adding data — no new code, no recompile.

### J3. Where does a monster's *current* health live — on `Monster` or `Breed`?

**Answer:** On `Monster`. It changes per individual (each monster takes its own damage), so it's per-instance state. Only kind-wide data (max health, attack string, name) lives on the shared `Breed`.

### J4. Give a real-world example outside games.

**Answer:** A product catalog: one `Product` class, with each instance pointing at a `ProductType` that defines category, tax class, and shipping rules. Adding a product category = adding a `ProductType` row, not a subclass.

### J5. Why store the type by reference (pointer), not by value?

**Answer:** So thousands of instances share *one* type object — the memory win — and so they don't drift apart. Storing by value gives each instance its own copy, defeating sharing.

### J6. What's the simplest signature of the pattern?

**Answer:** A class with a field pointing at another object that holds the kind's data:

```java
class Monster { Breed breed; int health; }
class Breed   { String name; int maxHealth; }
```

---

## Middle Questions

### M1. How is Type Object related to Flyweight?

**Answer:** The type object *is* a Flyweight. The breed is the **intrinsic, shared, immutable** state; the monster's `health` is the **extrinsic, per-instance** state. Type Object is Flyweight applied specifically to the concept of "kind."

### M2. How does type inheritance work, and what are the two strategies?

**Answer:** A type object can reference a *parent* type object and inherit fields it doesn't override (e.g. "Troll is a tougher Goblin"). Two strategies: **copy-down** (resolve parent fields at construction; reads are plain field access) and **delegation** (store only overrides; chase the parent on read). Copy-down is better on the hot path because type objects are built rarely and read constantly.

### M3. Why must type objects be immutable?

**Answer:** Because they're shared across many instances. If any instance could mutate a breed, it would change every instance of that kind. Immutability also makes shared reads thread-safe without locks.

### M4. How does data-driven loading work?

**Answer:** Type objects are defined in JSON/DB and loaded into a registry (`Map<String, Breed>`) at startup. Adding a kind means editing data, not code. The registry is the single source of truth and the only place type objects are constructed.

### M5. Why does load order matter with inheritance?

**Answer:** A child breed copies/reads from its parent, so the parent must already be built when the child loads. Either order the data parent-first or topologically sort by the `parent` edges (detecting cycles in the process).

### M6. How is the type object also a Factory?

**Answer:** The type object knows the starting state for an instance, so it's the natural factory: `breed.newMonster()` stamps `maxHealth` onto a fresh monster. It folds [Factory Method](../../01-creational/01-factory-method/middle.md) into the type itself.

---

## Senior Questions

### S1. When should you NOT use Type Object?

**Answer:** Three cases: (1) **few fixed kinds** known at compile time → use subclasses and keep the compiler's type checking; (2) kinds needing **genuinely different code/behavior** → use polymorphism or Strategy; (3) kinds that are **free combinations of orthogonal traits** → use ECS. Type Object pays only when kinds differ mainly in *data*.

### S2. State the decision rule: Type Object vs subclassing.

**Answer:** Do kinds differ by **data** or by **behavior**? Data → Type Object (runtime, data-driven, designer-authored, no recompile). Behavior → subclassing/Strategy (compile-time safety, per-kind code).

### S3. What is a "hybrid" type object?

**Answer:** A type object carrying data *plus* a key into a **fixed, closed set** of Strategies. Designers compose behavior from an engineer-owned set (e.g. `attackKind: "fire"` selects a `FireAttack` strategy). It covers "some" per-kind behavior without giving up data-driven kinds. If the behavior set grows open-ended, you've hit the ECS threshold.

### S4. How do Type Object and Strategy relate?

**Answer:** They compose, not compete. Strategy varies an *algorithm* behind an interface; Type Object varies a *kind* via shared data. The hybrid puts a Strategy *inside* the type object.

### S5. How do you handle runtime type registration safely?

**Answer:** **Copy-on-write the registry**: readers (the game loop) read a lock-free atomic snapshot; a writer builds a new map, adds the breed, and atomically swaps the pointer. This is sound only because breeds are immutable — readers never see a torn or half-applied map.

### S6. What's wrong with `if (monster.breed.name.equals("Dragon")) breatheFire()`?

**Answer:** It re-couples engine code to specific data — you've reinvented subclassing badly and defeated the pattern. Behavior that varies by kind should live on the type object (a Strategy key), dispatched uniformly: `monster.attack(target)`.

---

## Professional Questions

### P1. How do you validate designer-authored type data?

**Answer:** Treat it as untrusted input crossing a trust boundary, with three layers: **structural** (schema — field present, typed, in range), **referential** (every parent/strategy-key/id resolves), and **semantic** (domain invariants: no inheritance cycles, `minDamage ≤ maxDamage`). Run all three at load and reload; emit errors naming file, breed, and field so designers self-serve.

### P2. How do you hot-reload type data without corrupting live instances?

**Answer:** Build a complete new immutable registry, validate it whole, then **atomically swap** the registry pointer — all-or-nothing. Never mutate live breeds in place (it races the game loop). Choose an instance policy: **snapshot** (live monsters keep their old breed) or **live-update** (re-point by name at a frame boundary), and document it.

### P3. How do you version type schemas?

**Answer:** Tag data with `schemaVersion` and run an ordered chain of migrations (vN → vN+1 → … → current) at load, so old content keeps working. New code never reads obsolete fields directly — migrations normalize first. Handle **content data** and **saved instances** as two separate migration problems; never reinterpret old data silently.

### P4. When does ECS supersede Type Object?

**Answer:** When kinds become free combinations of orthogonal traits (`canFly`, `isArmored`, `isPoisonous` in any of 2ⁿ mixes). A monolithic per-kind type object then either explodes into one breed per combination or rots into flag-soup. Decompose into ECS components (`Flying`, `Armor`, `Poison`) attached per entity. Type Object asks "what kind?"; ECS asks "what components?"

### P5. What makes the registry read atomic during reload?

**Answer:** Immutability plus an atomic pointer swap. Because breeds never change in place and the whole map is replaced in one atomic operation, a reader either sees the entire old registry or the entire new one — never a torn intermediate.

---

## Coding Tasks

### C1. Refactor a subclass explosion into Type Object

> You're given `Dragon`, `Goblin`, `Troll` subclasses differing only in `maxHealth` and `attack`. Collapse them.

```java
// Before: 3 subclasses
class Dragon extends Monster { int maxHealth = 230; String attack = "fire"; }
class Goblin extends Monster { int maxHealth = 20;  String attack = "stab"; }
class Troll  extends Monster { int maxHealth = 48;  String attack = "smash"; }

// After: one class + data objects
final class Breed {
    final String name; final int maxHealth; final String attack;
    Breed(String n, int h, String a) { name=n; maxHealth=h; attack=a; }
    Monster newMonster() { return new Monster(this); }
}
final class Monster {
    final Breed breed; int health;
    Monster(Breed b) { breed = b; health = b.maxHealth; }
}
// Kinds become DATA:
Breed dragon = new Breed("Dragon", 230, "fire");
```

### C2. Implement copy-down type inheritance

```python
@dataclass(frozen=True)
class Breed:
    name: str; max_health: int; attack: str

def build(name, data, registry):
    parent = registry[data["parent"]] if "parent" in data else None
    return Breed(
        name=name,
        max_health=data.get("max_health", parent.max_health if parent else None),
        attack=data.get("attack", parent.attack if parent else None),
    )
```

### C3. Make a lock-free registry for runtime registration (Go)

```go
type Registry struct{ snap atomic.Pointer[map[string]*Breed] }
func (r *Registry) Get(n string) (*Breed, bool) { b, ok := (*r.snap.Load())[n]; return b, ok }
func (r *Registry) Register(b *Breed) {
    old := r.snap.Load()
    next := map[string]*Breed{}
    for k, v := range *old { next[k] = v }
    next[b.Name] = b
    r.snap.Store(&next) // atomic swap; readers stay lock-free
}
```

---

## Trick Questions

### T1. "Type Object gives you compile-time type safety for each kind." True?

**False.** It *trades away* compile-time type safety. A breed name is a string and a breed is data, not a Java/Go type — the compiler can't verify "is this a valid kind?". That loss is the price you pay for runtime/data-driven flexibility.

### T2. "Should each `Monster` deep-copy its `Breed` to be safe?"

**No.** Deep-copying defeats the Flyweight memory win — the whole point is one shared breed for thousands of monsters. Safety comes from **immutability**, not copying.

### T3. "Is current health intrinsic (type-object) state?"

**No.** Current health changes per individual monster, so it's *extrinsic*, per-instance state on `Monster`. Only kind-wide, unchanging data is intrinsic and lives on `Breed`.

### T4. "Type Object and Strategy are competing alternatives — pick one."

**Misleading.** They compose. The hybrid type object holds data *plus* a key into a fixed Strategy set. Strategy varies behavior; Type Object varies kind.

### T5. "If I have 200 monster kinds, Type Object is automatically right."

**Not automatically.** If those 200 kinds need 200 genuinely different *behaviors* (real code), Type Object can't express that as data and you need polymorphism/Strategy. Count varies; what matters is whether they differ by *data* or *behavior*. And if they're combinations of orthogonal traits → ECS.

### T6. "Two monsters are the same kind iff `m1.breed == m2.breed`?"

**Usually, but watch hot reload.** Pointer identity works within one registry generation. After a hot reload that rebuilds breeds, the old and new "Goblin" are different objects — compare by `breed.name` if identity must survive a reload.

---

## Behavioral Questions

### B1. Tell me about a time you chose data-driven design over code.

**Framework:** Describe a content-heavy domain (game entities, product types, rule types) where non-engineers needed to add variations frequently. Explain that you introduced a type object + registry so they could ship content as data, removing engineering from the critical path. Quantify: tuning loop dropped from "file a ticket + redeploy" to "edit JSON + hot reload."

### B2. Describe a time you over-engineered with a flexible pattern.

**Framework:** Be honest — e.g. you reached for Type Object with three fixed kinds and lost compile-time safety for no benefit, then debugged a typo'd breed name that would've been a compile error. Lesson: pick the *leftmost adequate* point on the subclass→Type Object→ECS spectrum.

### B3. How did you keep designer-authored data from breaking production?

**Framework:** Describe the validation gauntlet (structural/referential/semantic), build-validate-atomic-swap reload, and designer-readable errors. Emphasize "if a breed object exists, it's valid" — validation at the boundary, not scattered through gameplay.

---

## Tips for Answering

1. **Lead with the trade-off.** Type Object = data flexibility *traded for* compile-time safety and per-kind code. Saying only the upside signals shallowness.
2. **Name the relatives precisely.** Flyweight (sharing), Factory (the type-object-as-factory), Strategy (the hybrid's behavior), Prototype (copy-down inheritance), ECS (the successor).
3. **Use the decision rule.** "Do kinds vary by data or behavior?" — it shows you know *when* to apply it, which is what seniors are tested on.
4. **Be honest about the wrong cases.** Few fixed kinds → subclasses; rich per-kind behavior → polymorphism; orthogonal traits → ECS. Knowing when *not* to use it is the strongest signal.
5. **Mention immutability unprompted.** It's the load-bearing constraint that makes sharing, threading, and hot reload sound.
6. **For production questions, talk pipeline:** validate → build → atomic swap → version/migrate. That's the 80% of a real system.

---

[← Professional](professional.md) · [Other Patterns](../README.md) · [Design Patterns](../../README.md) · **Next:** [Type Object — Find the Bug](find-bug.md)
