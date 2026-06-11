# Data-Oriented Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Data-Oriented Programming
> *Stop asking "what objects are in my program?" Start asking "what data do I have, and how is it actually accessed?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Two Things Called "Data-Oriented"](#two-things-called-data-oriented)
4. [Glossary](#glossary)
5. [Core Concept 1 — The Flip: Data First, Not Objects](#core-concept-1--the-flip-data-first-not-objects)
6. [Core Concept 2 — Array-of-Structs vs Struct-of-Arrays](#core-concept-2--array-of-structs-vs-struct-of-arrays)
7. [Core Concept 3 — The Cache Line, In One Idea](#core-concept-3--the-cache-line-in-one-idea)
8. [The Same Data, Two Layouts](#the-same-data-two-layouts)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

You've been taught to start a program by asking *what are the things?* — a `Player`, an `Enemy`, an `Order` — and to bundle each thing's data with the methods that act on it. That's object-oriented thinking, and it's a fine default for *modeling*. But it quietly decides something else for you: **how that data is laid out in memory**. And memory layout is where a huge amount of real-world performance is won or lost.

Data-oriented programming starts from the opposite end. Instead of *"what objects exist?"* it asks:

> **What data do I actually have, how much of it, and how does the code touch it?**

The answer reshapes everything. When you notice that you have *one million* enemies and that the physics step only ever reads each enemy's *position* and *velocity*, you stop thinking "an enemy is an object" and start thinking "I have a million positions and a million velocities, processed in a tight loop." That reframe — from one rich object to many records of plain data, organized for how they're used — is the entire paradigm in a sentence.

> **The mindset shift:** the CPU doesn't see your objects. It sees bytes flowing from memory through caches into registers. Design for *that* flow, and slow code can get 5×–50× faster with no algorithm change at all.

---

## Prerequisites

- **Required:** You can read basic code in a language with explicit structs/arrays. Examples use **C/C++**, **Rust**, and **C#**, but the ideas are language-agnostic.
- **Required:** You know what a `struct`/`class` is and what an array is.
- **Helpful:** You've written a loop over a big collection (a million items) and noticed it felt slow.
- **Not required:** Any knowledge of CPU caches, SIMD, or game engines — we build the cache intuition from scratch here.

---

## Two Things Called "Data-Oriented"

> **⚠️ Read this first — the name is overloaded.** Two distinct ideas share "data-oriented," and people constantly talk past each other. This whole roadmap covers **both**, kept clearly separate.

| | **Data-Oriented DESIGN (DOD)** | **Data-Oriented PROGRAMMING (DOP)** |
|---|---|---|
| **Goal** | **Performance.** Make the CPU fast. | **Simplicity.** Make code easier to reason about. |
| **Core idea** | Design around *memory layout* and how data is accessed. | Separate *code from data*; represent data as plain, generic, immutable structures. |
| **Touchstone** | Mike Acton's CppCon 2014 talk; game engines, ECS. | Yehonathan Sharvit's book *Data-Oriented Programming* (2022); the Clojure tradition. |
| **Where you see it** | Games, simulation, databases, compilers, HPC. | Web/business apps in Clojure, JavaScript, Python. |

These are not rivals — they answer different questions. **DOD** is about *bytes and cache lines*. **DOP** is about *not trapping your data inside objects*. The junior page focuses mostly on **DOD** (it's the heavier, more-cited one and the one with the dramatic "why") and introduces **DOP** at the end so you don't confuse the two later.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Data-Oriented Design (DOD)** | Designing software around how data is laid out and accessed in memory, to suit the CPU. |
| **Data-Oriented Programming (DOP)** | (Sharvit) Separating code from data and modeling data as generic, immutable structures. |
| **AoS** | *Array of Structs* — store whole objects back-to-back: `[{x,y,hp}, {x,y,hp}, …]`. |
| **SoA** | *Struct of Arrays* — store each field in its own array: `xs[], ys[], hps[]`. |
| **Cache line** | The fixed-size chunk (typically **64 bytes**) the CPU loads from RAM at once. |
| **Cache** | Small, very fast memory near the CPU that holds recently/nearby-used data. |
| **Locality** | How close together (in memory or time) your accesses are. More locality = faster. |
| **Hot data** | Fields touched on every iteration of a hot loop (e.g., position). |
| **Cold data** | Fields rarely touched (e.g., a display name, a debug string). |
| **ECS** | *Entity-Component-System* — a DOD architecture for games (covered later). |
| **Mechanical sympathy** | Writing code that works *with* how the hardware actually behaves. |

> The two acronyms to lock in: **AoS** (objects laid out whole) vs **SoA** (fields split into parallel arrays). Almost every DOD example is a story about turning one into the other.

---

## Core Concept 1 — The Flip: Data First, Not Objects

Here's the classic object-oriented setup. Each enemy is an object that owns its data and behavior:

```cpp
struct Enemy {
    float x, y, z;          // position      (12 bytes)
    float vx, vy, vz;       // velocity      (12 bytes)
    int   hp;               // health        (4 bytes)
    char  name[32];         // display name  (32 bytes)
    Sprite* sprite;         // pointer to art (8 bytes)
    void update(float dt) { x += vx*dt; y += vy*dt; z += vz*dt; }
};
std::vector<Enemy> enemies;  // an Array of Structs (AoS)
```

Clean, readable, models the world. Now the physics loop runs every frame:

```cpp
for (auto& e : enemies) e.update(dt);   // only touches x,y,z,vx,vy,vz
```

The data-oriented question is: **what does this loop actually read?** Only position and velocity — 24 of the struct's ~76 bytes. But memory doesn't come in 24-byte sips; it comes in 64-byte gulps (a cache line). Every time the loop advances to the next enemy, the CPU drags in that enemy's `name`, `hp`, and `sprite` pointer too — bytes the loop never uses — and then throws them away. You're paying full price for memory bandwidth and using a third of it.

The flip: **stop modeling "an enemy" and start modeling "the data the loop needs."** *Where there is one enemy, there are many* — so design for the many.

> **Acton's mantra:** "Where there is one, there are many." The moment you have a thousand of a thing, the interesting unit isn't the *thing* — it's the *collection*, and how a loop sweeps through it.

---

## Core Concept 2 — Array-of-Structs vs Struct-of-Arrays

The single most important transformation in DOD has a name: **AoS → SoA**.

**Array of Structs (AoS)** — the default. One array; each slot is a whole object:

```
enemies:  [ x y z vx vy vz hp name… sprite ][ x y z vx vy vz hp name… sprite ][ … ]
            └──────────── enemy 0 ──────────┘└──────────── enemy 1 ──────────┘
```

**Struct of Arrays (SoA)** — flip it. One array *per field*, all parallel:

```cpp
struct EnemyData {
    std::vector<float> x, y, z;      // all positions, packed
    std::vector<float> vx, vy, vz;   // all velocities, packed
    std::vector<int>   hp;
    std::vector<std::string> name;   // cold data, kept aside
};
```
```
x:   [ x0 x1 x2 x3 x4 … ]   ← contiguous, nothing else between them
vx:  [v0 v1 v2 v3 v4 … ]
hp:  [h0 h1 h2 h3 h4 … ]
name:[ "…" "…" … ]          ← never loaded by the physics loop
```

Now the physics loop becomes:

```cpp
for (size_t i = 0; i < n; ++i) {
    x[i]  += vx[i] * dt;
    y[i]  += vy[i] * dt;
    z[i]  += vz[i] * dt;
}
```

Every byte the CPU loads from the `x`, `vx`, … arrays is a byte the loop *uses*. No names, no sprite pointers, no wasted bandwidth. Same algorithm, same result — but the data is arranged for *how the loop walks it*. On a million enemies, that's commonly a several-fold speedup.

> **The whole trick:** AoS groups data by *object*; SoA groups data by *field*. Loops usually want one field across many objects — so SoA feeds them perfectly, and AoS makes them choke on data they don't need.

---

## Core Concept 3 — The Cache Line, In One Idea

Why does any of this matter? Because of a single hardware fact you can hold in your head:

> **RAM is far away and slow. The CPU never reads one byte — it reads a whole 64-byte cache line at a time and keeps it in a tiny fast cache.**

A rough mental table of distances (the exact numbers vary, but the *ratios* are the lesson):

| Where the data is | Roughly how long to get it |
|---|---|
| CPU register | instant (≈ 0 cycles) |
| L1 cache | ≈ 1 ns |
| L2 cache | ≈ 4 ns |
| L3 cache | ≈ 15 ns |
| Main RAM | ≈ 100 ns |

RAM is on the order of **100× slower** than L1. So the CPU's whole strategy is: *when you ask for one byte, grab the 64 bytes around it too, because you'll probably want a neighbor next.* That bet is called **spatial locality**, and you either help it or fight it:

- **SoA helps it.** The next `x` you need sits right after the last one. One cache-line load (64 bytes) serves you ~16 floats — 16 enemies' worth — before the CPU has to go back to RAM.
- **AoS fights it.** The next `x` you need is ~76 bytes away (past the previous enemy's name and sprite). Each cache line you load gives you *one* useful `x` and a pile of garbage you'll discard. You hit RAM far more often.

That's it. That's the engine under "AoS vs SoA." You're not making the CPU compute faster — you're making sure that when it *waits for memory*, every byte it waited for is a byte you'll use.

> **One picture to remember:** a cache line is a 64-byte bus seat. SoA fills the seat with passengers going your way; AoS fills it with one passenger and a stack of luggage you immediately throw out.

---

## The Same Data, Two Layouts

> Task: **sum the health of a million entities.** Only `hp` is needed.

```cpp
// AoS — hp is buried inside a fat struct.
struct Entity { float x,y,z, vx,vy,vz; int hp; char name[32]; };
std::vector<Entity> es(1'000'000);

long total = 0;
for (auto& e : es) total += e.hp;     // touches 4 useful bytes per 76+; mostly cache misses
```

```cpp
// SoA — hp lives in its own packed array.
std::vector<int> hp(1'000'000);

long total = 0;
for (int h : hp) total += h;          // 16 hp values per cache line; almost no waste
```

Same answer. The SoA version commonly runs several times faster, purely because the loop reads packed `hp` values instead of dragging an entire entity through cache for each one. **Nothing about the algorithm changed — only the data layout did.** That is the lesson junior DOD comes down to: *layout is a design decision, and the default object layout is rarely the one your hot loops want.*

A Rust sketch of the same split (same idea, idiomatic):

```rust
// AoS: a Vec of whole records.
struct Entity { pos: [f32; 3], vel: [f32; 3], hp: i32, name: String }
let aos: Vec<Entity> = /* … */;

// SoA: parallel Vecs, one per field. Loops over `hp` touch only packed i32s.
struct Entities { x: Vec<f32>, y: Vec<f32>, z: Vec<f32>,
                  vx: Vec<f32>, vy: Vec<f32>, vz: Vec<f32>,
                  hp: Vec<i32>, name: Vec<String> }
```

---

## Real-World Examples

| Where you've met it | What the data-oriented idea bought |
|---|---|
| **Game engines** (Unity DOTS, Bevy, Unreal Mass) | Millions of entities updated in cache-friendly SoA loops at 60 FPS. |
| **NumPy / pandas** | A DataFrame is SoA: each *column* is a packed array, so column math is fast. |
| **Analytics databases** (Parquet, ClickHouse) | "Columnar storage" *is* SoA on disk — scan one column without reading whole rows. |
| **Particle systems** | A million particles as parallel position/velocity/color arrays, not a million objects. |
| **Spreadsheets / vectorized math** | Whole-column operations, the AoS→SoA idea at the user level. |

If you've ever wondered why pandas tells you to "vectorize, don't loop row by row," now you know: a column is SoA, and operating on a whole column lets the CPU stream packed data. Looping row-by-row is AoS access — slow.

---

## Mental Models

- **Bus seats (cache lines).** Memory arrives 64 bytes at a time, like a bus that always brings a full seat of passengers. SoA fills every seat with people going your way; AoS wastes seats on luggage.
- **The warehouse pick.** AoS is storing each customer's *whole order* in one bin; to count just the staplers you open every bin. SoA is a bin *per product*; to count staplers you visit one shelf. When your job is "one field across everyone," product-bins win.
- **Where there's one, there's a million.** The instant you have many of a thing, the object is the wrong unit. Design the *collection* and the *loop*, not the individual.
- **The CPU can't see your classes.** Encapsulation, inheritance, "an enemy knows how to update itself" — none of it exists at the silicon level. There's only bytes and how far apart they are.

---

## Common Mistakes

- **Optimizing layout before measuring.** DOD's payoff is real but *situational*. For a list of 50 menu items, AoS vs SoA is irrelevant — the whole thing fits in cache. Reach for SoA on **big, hot, data-parallel loops**, not everywhere. (Profile first; the senior page is all about this.)
- **Thinking it's about "faster instructions."** It's not — the CPU runs the same arithmetic. The win is *fewer trips to slow RAM* because the bytes you wait for are the bytes you use.
- **Splitting hot and cold data wrong.** If your loop reads `x` and `hp`, those belong together (or in two tight arrays); burying `hp` next to a 32-byte name string defeats the point. Group by *who's accessed together*.
- **Confusing the two "DOPs."** Mike Acton's data-oriented *design* (cache layout) and Sharvit's data-oriented *programming* (separate code from data) are different ideas. Don't quote one when you mean the other.
- **SoA everywhere, killing readability.** SoA scatters one logical thing across many arrays; `enemies[i].x` becomes `x[i]`, and you lose the tidy `Enemy` abstraction. That cost is real. Pay it where the speed matters, not as a reflex.

---

## A First Look at the *Other* Data-Oriented (Sharvit's DOP)

So you're not blindsided later: Yehonathan Sharvit's **Data-Oriented Programming** is a *different* idea with the same name. It has nothing to do with cache lines. Its complaint is that OOP **welds data to code** — your data is trapped inside objects, reachable only through methods, mixed up with behavior and mutation. Sharvit's three principles push the other way:

1. **Separate code from data.** Functions live apart from the data they operate on (no methods welded onto records).
2. **Represent data as generic, immutable structures.** A user is just a map `{name, email, …}` — a transparent bag of values — not a sealed `User` class. Generic functions (`get`, `update`, `merge`) work on *any* such data.
3. **Data is immutable.** You never mutate; you produce new versions.

The payoff is *flexibility and simplicity* (data is transparent, easy to inspect, serialize, and transform); the cost is *less structure and type-safety* (a map has no compiler-checked shape). This is the **Clojure** philosophy, and it's covered in depth from the middle page onward. For now, just file it: **two ideas, one name** — DOD for *speed via layout*, DOP for *simplicity via separating data from code*.

---

## Test Yourself

1. In one sentence, what question does data-oriented *design* ask that OOP doesn't?
2. Draw AoS vs SoA for a `Particle{ x, y, color }` with 5 particles. Which layout is better for "move every particle" (reads x, y)?
3. What is a cache line, roughly how big is it, and why does its size matter for SoA?
4. Why is summing one field of a million-object AoS array slow, even though it's "just an addition"?
5. Name two real systems that use SoA/columnar layout and what they gain.
6. State the difference between data-oriented *design* (Acton) and data-oriented *programming* (Sharvit) in one line each.

> Try each before reading on. If #3 or #4 is fuzzy, re-read [The Cache Line](#core-concept-3--the-cache-line-in-one-idea).

---

## Cheat Sheet

```
DATA-ORIENTED DESIGN (DOD) = design around DATA LAYOUT, for the CPU.
  Ask: what data, how much, how is it accessed? — not "what objects?"
  Mantra: "Where there is one, there are many." Design the collection.

AoS  = Array of Structs   [ {x,y,hp} {x,y,hp} … ]   default, object-shaped
SoA  = Struct of Arrays   x[]  y[]  hp[]            field-shaped, loop-friendly

WHY SoA WINS A HOT LOOP:
  CPU loads a 64-byte CACHE LINE at a time. RAM is ~100x slower than L1.
  SoA → next value is adjacent → one line serves ~16 packed values.
  AoS → next value is a whole struct away → mostly wasted bytes, more RAM trips.

RULE: same algorithm, different LAYOUT → big speedups on big hot loops.
  But: measure first; SoA hurts readability; only worth it where it's hot.

THE OTHER "DOP" (Sharvit): separate code from data; data = generic,
  immutable maps/vectors manipulated by generic functions (Clojure).
  Different idea, same name. DOD = speed. DOP = simplicity.
```

---

## Summary

Data-oriented **design** flips the starting question from *"what objects exist?"* to *"what data do I have and how is it accessed?"* Because the CPU loads memory in 64-byte **cache lines** and RAM is ~100× slower than L1 cache, the *layout* of your data — not just your algorithm — decides how fast a hot loop runs. The headline transformation is **AoS → SoA**: instead of an array of whole structs, keep each field in its own packed array, so a loop over one field streams useful bytes instead of dragging whole objects through cache. This is "mechanical sympathy" — designing *with* the hardware. It matters most on **big, hot, data-parallel loops** (games, simulation, analytics) and barely at all on small collections, so you measure before you transform. Separately and confusingly, **data-oriented programming** in Sharvit's sense is an unrelated idea about *separating code from data* and modeling data as immutable generic structures (the Clojure philosophy) — same name, different goal: simplicity rather than speed.

---

## Further Reading

- Mike Acton, *Data-Oriented Design and C++* (CppCon 2014) — the touchstone talk; "where there is one, there are many."
- Richard Fabian, *Data-Oriented Design* (book, free online) — the systematic treatment of DOD.
- Yehonathan Sharvit, *Data-Oriented Programming* (Manning, 2022) — the *other* DOP: separate code from data.
- Tony Albrecht, *Pitfalls of Object-Oriented Programming* — the original "your objects are cache-hostile" wake-up call.
- Ulrich Drepper, *What Every Programmer Should Know About Memory* — the deep dive on caches behind all of this.

---

## Related Topics

- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the loop-and-array substrate DOD lives on.
- [12 — Array-Oriented Programming](../12-array-oriented-programming/) — whole-array/vectorized ops; SoA's natural cousin.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where DOD/DOP sit on the paradigm map.
- [Object-Oriented Programming](../../object-oriented-programming/) — the object-first style DOD reacts against.
- [Language Internals](../../language-internals/) — caches, memory, and SIMD, where the hardware mechanics live.
- [`middle.md`](middle.md) — the cache hierarchy in detail, pointer-chasing, hot/cold splitting, ECS, and Sharvit's principles.
