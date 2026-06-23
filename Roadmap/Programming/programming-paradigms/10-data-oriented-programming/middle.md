# Data-Oriented Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Data-Oriented Programming
> *Mechanical sympathy: you can't write fast code for hardware you imagine; you write it for the cache hierarchy that actually exists.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Cache Hierarchy You're Actually Programming](#the-cache-hierarchy-youre-actually-programming)
4. [Cache Lines, Spatial & Temporal Locality](#cache-lines-spatial--temporal-locality)
5. [Why Pointer-Chasing Is Slow](#why-pointer-chasing-is-slow)
6. [The AoS → SoA Transformation, Properly](#the-aos--soa-transformation-properly)
7. [Hot/Cold Data Splitting](#hotcold-data-splitting)
8. [The Data-Oriented vs OO Mindset](#the-data-oriented-vs-oo-mindset)
9. [Intro to ECS (Entity-Component-System)](#intro-to-ecs-entity-component-system)
10. [The Other DOP — Sharvit's Three Principles](#the-other-dop--sharvits-three-principles)
11. [Common Mistakes](#common-mistakes)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The mechanics — why layout wins, and how to restructure for it.**

The junior page gave you the headline: design around data layout, prefer SoA on hot loops, because the CPU loads 64-byte cache lines from slow RAM. This page makes that operational. You'll learn the actual cache hierarchy you're programming against, why **pointer-chasing through object graphs** is the silent killer in OO-heavy code, how to do the **AoS → SoA** and **hot/cold splitting** transformations deliberately, and how **ECS** generalizes all of this into an architecture. Then we switch tracks and lay out Sharvit's *data-oriented programming* — the unrelated, simplicity-driven idea — as three concrete principles.

The unifying skill is **mechanical sympathy** (Martin Thompson's term, borrowed from Jackie Stewart on racing): understanding the machine well enough that your code cooperates with it instead of fighting it. You don't need to count cycles. You need to know that *a cache miss costs ~100ns, an L1 hit costs ~1ns, and your data layout decides which one your loop pays — millions of times per frame.*

---

## Prerequisites

- **Required:** The junior page — AoS vs SoA, the cache-line intuition, the two meanings of "data-oriented."
- **Required:** Comfort reading C/C++ or Rust structs, vectors, and pointers/references.
- **Helpful:** You've profiled something and seen a "cache miss" or "memory-bound" line in a tool like `perf`, VTune, or a flame graph.
- **Not required:** SIMD intrinsics, ECS frameworks, or Clojure — all introduced here.

---

## The Cache Hierarchy You're Actually Programming

A modern CPU core sits behind a stack of memories, each bigger and slower than the last. You don't address them directly — the hardware moves data between them — but their *cost structure* is the single most important performance fact in systems programming.

| Level | Typical size | Typical latency | Lesson |
|---|---|---|---|
| Registers | ~dozens | 0 cycles | Where actual work happens. |
| **L1** (per core) | ~32–64 KB | ~1 ns (≈4 cyc) | Tiny. Your hot working set wants to live here. |
| **L2** (per core) | ~256 KB–2 MB | ~4 ns | Still fast; spillover from L1. |
| **L3** (shared) | ~8–64 MB | ~15 ns | Shared across cores; contention point. |
| **Main RAM** | GBs | ~100 ns | ~100× slower than L1. **The cliff.** |
| SSD / disk | TBs | ~10–100 µs+ | A different universe; not our concern here. |

Two consequences drive everything in DOD:

1. **A cache miss to RAM costs ~100× an L1 hit.** A loop that misses on every iteration isn't "a bit slower" — it's spending almost all its time *waiting*, with the CPU's arithmetic units idle. Such code is **memory-bound**: making the math faster does nothing; only better access patterns help.
2. **Caches are small.** L1 holds tens of kilobytes. If your hot working set is a million 76-byte structs (~76 MB), it can't live in cache — but the *fields a loop needs* (a million 4-byte `hp`, ~4 MB) might fit in L2/L3. Shrinking what each iteration touches is half the game.

> **Reframe:** you're not optimizing instructions; you're optimizing *what data is resident in fast memory when the loop reaches it.* Layout is how you control residency.

---

## Cache Lines, Spatial & Temporal Locality

The cache's transfer unit is the **cache line** — almost universally **64 bytes** today. The CPU never fetches one byte; it fetches the whole line containing it. This single mechanism gives two kinds of locality you can exploit:

- **Spatial locality** — *if you use a byte, you'll soon use its neighbors.* Loading one line brings ~16 floats or ~8 doubles "for free." SoA is the spatial-locality play: pack the field you sweep so that one line load serves many iterations. The **prefetcher** amplifies this — when the CPU notices you marching linearly through memory, it speculatively loads *upcoming* lines before you ask, hiding latency almost entirely. Linear, contiguous access is the prefetcher's best case; random access defeats it.
- **Temporal locality** — *if you use a byte, you'll use it again soon.* Keep the same data hot by processing it while it's resident: do all the work on a chunk before moving on, rather than streaming the whole array once per operation.

```cpp
// Spatial locality: linear sweep. Prefetcher loves this; ~16 floats per line.
for (size_t i = 0; i < n; ++i) sum += xs[i];

// No spatial locality: random indices. Each access likely a fresh line, a fresh miss.
for (size_t i = 0; i < n; ++i) sum += xs[idx[i]];  // idx is a shuffle
```

The first loop is often an order of magnitude faster than the second on the *same data* — because the first streams cache lines the prefetcher predicted, and the second scatters across memory, missing constantly. **Access pattern, not just data, determines speed.**

> **The two localities in one line:** spatial = "neighbors come along for the ride" (so pack what you sweep); temporal = "what's hot stays hot" (so finish with data before evicting it).

---

## Why Pointer-Chasing Is Slow

Here is the deepest reason idiomatic OO code is often cache-hostile: **it's built on pointers.** A `List<Order>` of objects, a linked list, a tree of nodes, an `Entity` holding a `Sprite*` and a `Component*` — every one of those is a graph of heap allocations connected by pointers. Traversing it means **pointer-chasing**: read a pointer, jump to wherever it points, read the next pointer there, jump again.

Each jump is a problem for the cache for two reasons:

1. **The target is somewhere unpredictable.** Heap allocations made at different times land at scattered addresses. The next node isn't adjacent, so it's a fresh cache line — likely a miss.
2. **The prefetcher can't help.** It predicts *linear* access. It cannot guess where a pointer points, so it can't prefetch the next node. The CPU stalls, fully, waiting ~100ns for RAM, *then* reads the pointer, *then* stalls again for the next node. This is a **dependent load chain** — you can't start fetching node N+1 until node N arrives.

```cpp
// Linked list: every `node = node->next` is a potential cache miss with no prefetch.
long sum = 0;
for (Node* n = head; n; n = n->next) sum += n->value;   // pointer-chasing

// Same values in a contiguous array: prefetched, ~16 per line, no stalls.
long sum = 0;
for (int v : values) sum += v;                          // linear scan
```

The array version routinely runs **5×–10× faster** than the linked list for the same sum, despite identical algorithmic complexity (both O(n)). The list pays a near-full memory latency per element; the array pays one miss per 16 elements and lets the prefetcher hide even those.

This is why "an OO object graph" — many small objects connected by references — is the canonical slow case, and why DOD's first move is almost always *flatten the graph into contiguous arrays.*

> **The rule:** every pointer you chase is a coin-flip cache miss the prefetcher can't cover. Replace pointer graphs with contiguous arrays and indices, and you turn dependent-load stalls into streamed reads.

---

## The AoS → SoA Transformation, Properly

You saw the basic flip on the junior page. Here's how to do it deliberately, including the part most people skip.

**Step 1 — Identify the hot loop and what it touches.** Profile. Find the loop that dominates, and list *exactly which fields* each iteration reads and writes. That set — and nothing else — should be packed and adjacent.

**Step 2 — Split fields into parallel arrays, indexed by the same `i`.**

```rust
// Before: AoS. Physics loop reads pos+vel but drags hp, name, sprite through cache.
struct Body { pos: Vec3, vel: Vec3, mass: f32, hp: i32, name: String }
let bodies: Vec<Body>;

// After: SoA. Each field packed; the physics loop touches only pos+vel arrays.
struct Bodies {
    pos: Vec<Vec3>,   // hot: integration reads/writes these
    vel: Vec<Vec3>,
    mass: Vec<f32>,   // warm: used by some systems
    hp: Vec<i32>,     // cold-ish
    name: Vec<String> // cold: never in the physics loop
}
```
```rust
// The hot loop now streams two packed arrays — prefetcher-friendly, no waste.
for i in 0..n {
    bodies.pos[i] += bodies.vel[i] * dt;
}
```

**Step 3 — Keep the `i`-correspondence sacred.** SoA's contract is that index `i` means "the same logical entity" across *every* array. Inserting, removing, or sorting must touch all arrays in lockstep, or your data corrupts. This is SoA's real maintenance cost: the compiler no longer guarantees the fields belong together — *you* do. (ECS, below, exists partly to manage this bookkeeping for you.)

**Step 4 — Don't over-split.** Two fields *always used together* (say `pos` and `vel`, both read every iteration) can live in one small "hot struct" array rather than two arrays — that's still cache-friendly and simpler. SoA is not "one array per field, dogmatically"; it's "**group fields by access pattern**." The goal is that a cache line a loop loads is *full of bytes that loop uses.*

> **The discipline:** SoA isn't a syntax; it's "lay out fields by who's accessed together, so hot loops read packed lines." Splitting beyond that buys nothing and costs readability.

---

## Hot/Cold Data Splitting

A close relative of AoS→SoA, useful even when you keep an object-ish layout. Most structs mix **hot** fields (touched constantly) with **cold** fields (touched rarely): an enemy's `position` is hot; its `deathAnimationName`, `lootTableId`, and `tooltipText` are cold. In one fat struct, the cold fields bloat every cache line the hot loop loads.

**Split the struct.** Keep a tight hot struct and push cold fields behind one indirection:

```cpp
// Before: 96-byte struct; the hot loop reads 12 bytes but loads cold fields too.
struct Entity { Vec3 pos; Vec3 vel; int hp; char name[32]; char tooltip[32]; };

// After: hot fields tight (28 bytes → 2 fit per line); cold fields out of the way.
struct EntityHot  { Vec3 pos; Vec3 vel; int hp; };      // swept every frame
struct EntityCold { char name[32]; char tooltip[32]; }; // touched on death/UI only
std::vector<EntityHot>  hot;
std::vector<EntityCold> cold;  // parallel; same index = same entity
```

Now the hot loop packs ~2 `EntityHot` per cache line instead of dragging 64 bytes of names along. The cold data still exists, indexed the same way, fetched only on the rare path that needs it. This is the *minimum-viable* DOD move: you don't have to go full SoA to win — just stop letting cold bytes ride in hot cache lines.

> **Heuristic:** a field that 1% of accesses touch shouldn't sit in the cache line that 99% of accesses load. Hot/cold splitting is "evict the tourists from the commuter bus."

---

## The Data-Oriented vs OO Mindset

DOD and OOP aren't just different layouts; they start from different *questions*, and that shapes the whole design.

| | **Object-Oriented mindset** | **Data-Oriented mindset** |
|---|---|---|
| First question | *What are the things?* (nouns → classes) | *What data exists, how much, how accessed?* |
| Unit of design | The individual object | The collection and the loop over it |
| Data + behavior | Bundled (encapsulation) | Separated (plain data; functions over it) |
| Memory layout | Implicit, per-object (AoS, pointer graphs) | Explicit, designed (SoA, contiguous arrays) |
| Default for performance | Often cache-hostile | Cache-friendly by construction |
| Optimizes for | Modeling, extensibility, encapsulation | Throughput on hot, data-parallel work |

The honest framing: **OOP optimizes for the programmer's mental model; DOD optimizes for the machine's access pattern.** Neither is "correct" — they're tuned for different cost functions. Most software is *not* memory-bound and benefits more from OOP's clarity. But in the domains where you have *millions of one thing in a per-frame loop* — games, simulation, physics, rendering, signal processing, analytics, compilers — the machine's cost function dominates, and DOD wins decisively. (The senior page is entirely about telling these cases apart.)

> **Not a war:** DOD says "for the few hot, high-volume paths, design the data for the CPU." It doesn't say "delete all your classes." It says "your default object layout is a *modeling* choice that happens to also be a *performance* choice — and on hot paths, it's usually the wrong one."

---

## Intro to ECS (Entity-Component-System)

**ECS** is DOD turned into an architecture, born in game engines to manage millions of entities. It has three parts:

- **Entity** — just an **ID** (an integer). Not an object, not a struct — a handle. "Entity #4217."
- **Component** — a plain **data** struct with no behavior: `Position{x,y,z}`, `Velocity{x,y,z}`, `Health{hp}`. An entity *has* components; the engine stores all `Position` components together in one packed array (SoA by component).
- **System** — a **function** that runs a loop over all entities having a given set of components. The `MovementSystem` iterates every entity with `Position` + `Velocity` and integrates them.

```csharp
// Components are pure data (Unity DOTS / Bevy-style).
struct Position { public float3 Value; }
struct Velocity { public float3 Value; }

// A system is a function over packed component arrays — a cache-friendly SoA sweep.
partial struct MovementSystem : ISystem {
    public void OnUpdate(ref SystemState state) {
        foreach (var (pos, vel) in
                 SystemAPI.Query<RefRW<Position>, RefRO<Velocity>>())
            pos.ValueRW.Value += vel.ValueRO.Value * dt;   // streams packed components
    }
}
```

Why this is DOD made structural:

- **Components are stored SoA**, grouped so a system's loop reads only the components it needs, packed and contiguous — automatic cache-friendliness.
- **Behavior is separated from data** (systems are functions; components are data) — which, note, is *also* a principle of Sharvit's DOP. ECS satisfies both meanings of "data-oriented" at once.
- **Composition over inheritance.** Instead of a deep `Enemy : Character : Entity` hierarchy, an entity *is* whatever components it has. Add a `Poisoned` component to make it poisoned; no class change.

ECS is the dominant high-performance game architecture for a reason: it gives you the SoA cache wins *and* a clean composition model, while the framework handles the painful "keep all the parallel arrays in sync" bookkeeping. (Frameworks, archetypes, and trade-offs are on the professional page.)

> **One line:** ECS = entities are IDs, components are data (stored SoA), systems are functions that sweep packed components. It's data-oriented design with a clean API.

---

## The Other DOP — Sharvit's Three Principles

Switching tracks completely. **Data-Oriented Programming** as Yehonathan Sharvit means it has *nothing to do with caches*. Its target is **complexity**, and its complaint is that OOP **entangles code and data**: your data hides inside objects, accessible only through methods, fused with behavior and mutation, locked into rigid class shapes. Sharvit's prescription is three principles, drawn from the Clojure tradition:

**Principle 1 — Separate code from data.** Don't weld methods onto records. Data is data; functions that operate on it live separately, as stateless modules. A `Customer` is a record of fields; `calculateDiscount(customer, order)` is a free function, not `customer.calculateDiscount(order)`.

```javascript
// OOP: data and behavior welded together.
class Author { constructor(name, books){ this.name=name; this.books=books; }
               fullName(){ /* … */ } isProlific(){ return this.books > 100; } }

// Sharvit DOP: data is a generic map; behavior is separate, generic functions.
const author = { name: "Ursula K. Le Guin", books: 23 };   // just data
const isProlific = (a) => a.books > 100;                    // separate function
```

**Principle 2 — Represent data with generic, immutable structures.** Model data as plain maps and vectors, not bespoke classes. A user is `{name, email, age}` — a transparent, generic map — manipulated by *generic* functions (`get`, `assoc`, `merge`, `select`) that work on *any* map. This makes data **transparent**: you can print it, diff it, serialize it to JSON, walk it generically, without knowing its class. The cost is you lose the compiler-enforced *shape* a class would give (mitigated with schema/validation libraries like `clojure.spec` or Zod).

**Principle 3 — Data is immutable.** You never mutate a record in place; you produce a new version (`assoc(user, 'age', 31)` returns a new map). Old references stay valid and unchanged, which kills a whole class of aliasing bugs and makes concurrency far safer. Efficient **persistent data structures** (structural sharing) make this cheap — the same machinery behind immutable collections in functional programming.

The payoff bundle: **simplicity, flexibility, testability, easy serialization, safe concurrency** — data is just data, functions are just functions, nothing changes underneath you. The cost: **loss of encapsulation** (data is wide open) and **loss of static, compiler-checked structure** (everything's a generic map). This is the trade the senior page weighs.

> **Don't conflate them.** DOD separates code and data *to please the cache*; DOP-Sharvit separates code and data *to reduce complexity*. They arrive at "data should be plain and separate from behavior" from opposite motivations — a genuine and useful coincidence, but a coincidence.

---

## Common Mistakes

- **Treating SoA as free.** It isn't — you trade a self-contained object for a duty to keep N parallel arrays in lockstep on every insert/remove/sort. Weigh that against the speedup; it's only worth it on genuinely hot paths.
- **Optimizing cold code.** Memory layout matters when a loop is **memory-bound and hot**. Restructuring a loop that runs 100 times a second over 50 items wastes effort and readability. Profile; confirm the loop is actually memory-bound before reshaping.
- **Ignoring the prefetcher.** Linear access is the goal not just because of cache lines but because the *prefetcher* hides latency for linear scans. Random access (gather/scatter, `arr[idx[i]]`) defeats it even with perfect packing.
- **Going SoA when you should split hot/cold.** Full SoA is a big readability hit. Often a simple hot/cold struct split captures most of the win for a fraction of the complexity.
- **Conflating the two DOPs in design discussions.** Saying "let's go data-oriented" without specifying *which* one leads teams to talk past each other — one person means cache layout, another means immutable maps.

---

## Summary

The cache hierarchy is the hardware you're really programming: an L1 hit costs ~1ns and a RAM miss ~100ns, so a **memory-bound** loop spends its life *waiting*, and **data layout decides which** it pays. The CPU transfers **64-byte cache lines** and **prefetches** linear access, which makes two patterns fast — **spatial locality** (pack what you sweep) and **temporal locality** (finish with hot data before evicting it) — and one pattern slow: **pointer-chasing** through object graphs, where each `node->next` is a dependent-load cache miss the prefetcher can't cover, often making linked structures 5–10× slower than the equivalent contiguous array. The deliberate moves are **AoS → SoA** (group fields by access pattern into parallel arrays) and **hot/cold splitting** (keep rarely-touched fields out of hot cache lines), and **ECS** packages both into an architecture: entities are IDs, components are SoA data, systems are functions sweeping packed components. Separately, Sharvit's **data-oriented *programming*** is an unrelated complexity-reducing idea — *separate code from data*, *generic immutable data structures*, *immutability* — trading encapsulation and static shape for transparency, flexibility, and safe concurrency.

---

## Further Reading

- Mike Acton, *Data-Oriented Design and C++* (CppCon 2014) — the canonical DOD talk.
- Richard Fabian, *Data-Oriented Design* — the book; AoS/SoA, existence-based processing, relational thinking.
- Ulrich Drepper, *What Every Programmer Should Know About Memory* — the authoritative cache deep-dive.
- Yehonathan Sharvit, *Data-Oriented Programming* (Manning) — the three principles in full.
- Scott Meyers, *CPU Caches and Why You Care* — a tight, vivid talk on cache lines and false sharing.
- Bob Nystrom, *Game Programming Patterns* — the "Data Locality" and "Component" chapters (free online).

---

## Related Topics

- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the loops and arrays DOD reshapes.
- [12 — Array-Oriented Programming](../12-array-oriented-programming/) — vectorized whole-array ops over SoA-style data.
- [Object-Oriented Programming](../../object-oriented-programming/) — encapsulation and object graphs that DOD trades away.
- [Language Internals](../../language-internals/) — caches, prefetching, SIMD, and memory mechanics in depth.
- [`junior.md`](junior.md) — AoS vs SoA and the cache-line intuition from scratch.
- [`senior.md`](senior.md) — the trade-offs: when DOD's wins justify the readability cost, and when it's premature.
