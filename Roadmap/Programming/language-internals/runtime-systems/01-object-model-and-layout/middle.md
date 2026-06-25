# Object Model & Layout — Middle Level

> **Topic:** [Object Model & Layout](README.md)
> **Focus:** The real headers — JVM mark word + class pointer, CPython's PyObject, the C++ vtable pointer — and why adding properties to a JS object in inconsistent orders quietly wrecks performance.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What's actually in the header, and how does a dynamic language make `obj.x` as fast as a fixed offset?**

The junior page established the shape: header, fields, padding. This page opens up the parts you took on faith. We'll dissect the **JVM object header** byte by byte — the mark word that smuggles a hash code, lock state, and GC age into 64 bits, and the class pointer that tells the runtime what kind of object this is. We'll look at **CPython's PyObject**, where every object is a refcount and a type pointer followed by a payload. We'll see where C++ parks its **vtable pointer**. And then the headline act for application engineers: **hidden classes** (V8 calls them "Maps", SpiderMonkey calls them "Shapes"). These are the trick that lets a language with no static types still access `obj.x` as a constant offset instead of a hash lookup — *as long as you don't surprise the runtime by building objects in inconsistent shapes.*

The practical payoff: by the end of this page you'll understand why a Java `HashMap` of 10 million `Long` keys is mostly header overhead, why a Python loop over objects is slow, and why this innocent-looking JS code is a performance bug:

```js
function makePoint(a, b) {
  const p = {};
  if (a > 0) { p.x = a; p.y = b; }   // shape: {x, y}
  else       { p.y = b; p.x = a; }   // DIFFERENT shape: {y, x}
  return p;                          // two shapes for one logical type -> deopt
}
```

`senior.md` takes this further into compressed oops, biased-locking history, vtable mechanics, and hidden-class transition trees. For now, we make the headers concrete.

---

## Prerequisites

- **Required:** The junior page: offsets, alignment, padding, inline vs boxed, AoS vs SoA.
- **Required:** Comfort reading a struct/class definition in C, Java, Python, JS, Go, or Rust.
- **Required:** The mental model "field access = base + constant offset."
- **Helpful:** A rough idea of what a garbage collector and a hash map are.
- **Helpful:** Knowing that JavaScript and Python objects can gain and lose properties at runtime.

You do **not** yet need: compressed-oop encoding math, biased-locking state machines, vtable layout under multiple inheritance, or hidden-class transition-tree internals. Those are `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Object header** | Runtime-owned bytes prepended to an object before its declared fields. |
| **Mark word** | The JVM's per-object 64-bit header slot holding hash code, lock bits, and GC age (its contents change depending on lock/GC state). |
| **Class pointer (klass pointer)** | A header field pointing to the object's class metadata (the JVM's `Klass`). |
| **PyObject** | CPython's base layout: `ob_refcnt` (reference count) + `ob_type` (type pointer), the head of every Python object. |
| **vtable** | A per-class table of function pointers for virtual methods. |
| **vptr (vtable pointer)** | A hidden per-object pointer to the class's vtable, present when a C++ class has virtual functions. |
| **Hidden class / Map / Shape** | A runtime-internal descriptor that maps property names to fixed offsets, shared by all objects of the same "shape." |
| **Monomorphic** | A code site that has only ever seen one hidden class — the fast case. |
| **Polymorphic / megamorphic** | A site that has seen a few / many hidden classes — progressively slower. |
| **Shape transition** | Moving from one hidden class to another when a property is added; recorded in a transition tree. |
| **Inline cache (IC)** | A cache at a property-access site remembering "for this shape, the field is at this offset." |
| **Dictionary mode / slow properties** | When an object gives up on hidden classes and stores properties in a hash map instead. |
| **Compressed oops** | A JVM trick storing 64-bit object references as 32-bit values (covered in `senior.md`). |
| **Slot** | A fixed position for an in-object property (V8 "in-object property") or a Python `__slots__` field. |
| **Tagged pointer** | A pointer whose low bits encode a type tag, letting small values avoid a heap object (referenced in prose). |

---

## Core Concepts

### 1. The JVM Object Header, Field by Field

On a 64-bit HotSpot JVM, every ordinary object instance begins with:

```
+0   mark word    (8 bytes)   -- hash, lock state, GC age, etc.
+8   class pointer (4 or 8 B)  -- 4 bytes if compressed oops on (the default)
+12  [your fields start here]  -- arrays add a 4-byte length here too
```

So before a single field you declared, you've spent **12 bytes** (8-byte mark word + 4-byte compressed class pointer), and the object is then padded up to an 8-byte boundary — so the minimum object size is **16 bytes**.

The **mark word** is a master of disguise. Its bits mean different things depending on the object's state:

- **Unlocked:** identity hash code (once computed), GC age bits, and a couple of tag bits.
- **Biased / thin-locked / fat-locked:** the same 64 bits get repurposed to hold a thread ID or a pointer to a lock record.
- **During GC:** the mark word can hold a forwarding pointer.

This is why it's called the *mark* word — it's a scratch space the runtime overloads. The key takeaway for now: **the JVM crams hash, locking, and GC metadata into one shared 64-bit slot per object**, and it only "spills" to a real lock object when there's actual contention.

### 2. CPython's PyObject: Refcount + Type, Then Payload

Every CPython object starts with `PyObject`:

```c
typedef struct {
    Py_ssize_t ob_refcnt;     // reference count  (8 bytes)
    PyTypeObject *ob_type;     // pointer to the type  (8 bytes)
} PyObject;                    // 16 bytes of header before any payload
```

Variable-sized objects (lists, strings, big ints) use `PyVarObject`, which adds an `ob_size`. After the header comes the type-specific payload. A Python `int` is a `PyLongObject`: the 16-byte header, a size/sign field, then the magnitude digits — which is why a small `int` weighs ~28 bytes.

Two consequences fall straight out of this:

- **Reference counting is per-object work.** Every time a reference is created or dropped, CPython writes to `ob_refcnt`. That's a memory write on operations that look free, and it's a reason the GIL exists and why free-threaded CPython is hard.
- **Everything is boxed.** There is no unboxed `int` in pure Python. A list of a million ints is a million pointers to a million ~28-byte objects. NumPy escapes this by storing a raw C array with *one* header for the whole array.

### 3. The C++ vtable Pointer

A C++ class with no virtual functions has **no hidden fields** — it's just its members, like a C struct. The moment you add a `virtual` method, the compiler inserts a hidden **vptr** (vtable pointer), almost always as the **first** member, at offset 0:

```cpp
struct Plain   { int x; };               // sizeof == 4, no vptr
struct Virtual { virtual ~Virtual(); int x; };  // sizeof == 16 on 64-bit:
                                          // 8-byte vptr + 4-byte x + 4 padding
```

The vptr points to the class's **vtable**, a static per-class array of function pointers. A virtual call `obj->foo()` becomes: load the vptr from offset 0, index into the vtable to find `foo`'s slot, call through that pointer. The *next* topic (method dispatch) covers the call mechanics; what matters here is **the vptr is a per-object header cost, placed first, that you pay for the entire object's life the moment any method is virtual.**

### 4. Hidden Classes: Making `obj.x` a Fixed Offset Again

Here's the central problem of dynamic languages. In JavaScript, `obj.x` can't be a compile-time offset — `obj` has no static type, properties can be added or deleted at runtime, and two objects called `obj` might have totally different shapes. The naive implementation is a **hash map per object**: every property access is a string hash and a bucket lookup. That's an order of magnitude slower than a `+offset` load.

V8's answer (and SpiderMonkey's, and JSC's) is the **hidden class** — V8 calls it a **Map**, SpiderMonkey a **Shape**, JSC a **Structure**. The idea: objects with the *same set of properties added in the same order* share one hidden class, and that hidden class records "property `x` is at offset 0, property `y` is at offset 1." So:

```js
const a = { x: 1, y: 2 };   // hidden class C2: {x@0, y@1}
const b = { x: 5, y: 9 };   // SAME hidden class C2 — shared!
```

Now `obj.x` compiles (after JIT warm-up) to: check `obj`'s hidden class is C2, then load the in-object slot at offset 0. That check + fixed load is nearly as fast as a static struct. The per-site cache that remembers "(shape C2 → offset 0)" is the **inline cache**.

### 5. Shape Transitions and Why Order Matters

Objects gain their hidden class through a chain of **transitions**. Starting from the empty object:

```
{}  --add x-->  C1{x@0}  --add y-->  C2{x@0, y@1}
```

Each `add property` step moves to a new hidden class along a transition edge. Crucially, **the order of additions defines the path.** If you add `x` then `y`, you get C2. If you add `y` then `x`, you get a *different* hidden class C3 = `{y@0, x@1}` — same properties, different shape, different offsets.

```js
function f(a, b) {
  const p = {};
  if (cond) { p.x = a; p.y = b; }   // -> shape {x, y}
  else      { p.y = b; p.x = a; }   // -> shape {y, x}   DIFFERENT
  use(p.x);                          // this site now sees TWO shapes
}
```

The `use(p.x)` site is now **polymorphic** — it must handle both shapes. A few shapes are tolerable (the IC becomes a small list); too many and it goes **megamorphic**, falling back to the slow hash-map lookup and disabling key optimizations. **The fix is trivial and free: always initialize an object's properties in the same order, ideally all in the constructor.**

### 6. Monomorphic vs Polymorphic vs Megamorphic

A property-access site is rated by how many hidden classes it has seen:

| State | Shapes seen | Speed |
|-------|-------------|-------|
| **Monomorphic** | 1 | Fastest: single shape check + fixed offset load. |
| **Polymorphic** | 2–4 (engine-dependent) | A short list of (shape → offset) — still fast, slightly slower. |
| **Megamorphic** | many | Falls back to a generic hash lookup; the optimizing JIT may bail out of the function. |

Keeping hot sites monomorphic is one of the highest-leverage things a JS or Ruby or Python (PyPy) performance engineer does — and it's almost entirely a question of **object layout discipline**: same fields, same order, same types.

### 7. Python's `__slots__`: Opting Out of the Per-Object Dict

By default a CPython object stores its attributes in a `__dict__` — a per-instance hash map (so Python objects are "always megamorphic" by JS standards). Declaring `__slots__` tells CPython to lay the attributes out as **fixed offsets** in the object instead, removing the per-instance dict:

```python
class Point:
    __slots__ = ('x', 'y')   # x and y become fixed slots, no per-instance __dict__
    def __init__(self, x, y):
        self.x = x
        self.y = y
```

This is CPython's manual version of the hidden-class idea: trade dynamism (you can no longer add arbitrary attributes) for compact, fixed-offset layout. For a class instantiated millions of times, `__slots__` routinely cuts per-object memory by 30–50% and speeds attribute access.

### 8. AoS vs SoA, Now With Cache Numbers

The junior page introduced AoS vs SoA. The middle-level point is *quantitative*. A cache line is 64 bytes. Suppose a particle is 24 bytes (`float x,y,z; float vx,vy,vz` would be 24). In **AoS**, a 64-byte line holds ~2.6 particles — so a loop reading only `x` fetches 64 bytes to use 4, wasting ~94% of the bandwidth. In **SoA**, the `x` array is contiguous: a 64-byte line holds 16 `x` values, all of which your loop uses — near-100% useful, and the access pattern is a clean linear stream the hardware prefetcher and the auto-vectorizer both love. The same logic governs whether you split a hot field out of a cold struct (covered in `senior.md`).

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Mark word** | A multi-purpose sticky note on a file folder: sometimes it says "checked out by Alice," sometimes "shelf B3," sometimes a tracking number — same note, different meaning by context. |
| **Class pointer** | The "what kind of form is this?" stamp linking the document to its template. |
| **PyObject refcount** | A library checkout counter on every book: each borrow ticks it up, each return ticks it down; at zero the book is recycled. |
| **vtable pointer** | A "see manager for instructions" card; the manager (vtable) has the actual procedures for this type of customer. |
| **Hidden class / shape** | The blueprint shared by all houses built to the same plan — once you know the plan, "the kitchen is room 3" is fixed, no searching. |
| **Shape transition** | Adding rooms to a house plan in a fixed sequence; build them in a different order and you've got a *different* (incompatible) blueprint. |
| **Monomorphic site** | A toll booth that only ever sees one car model — it knows exactly where the transponder is. |
| **Megamorphic site** | A toll booth seeing every vehicle ever made — it gives up and searches each one by hand. |
| **`__slots__`** | Swapping a "write anything anywhere" notebook for a pre-printed form with fixed boxes. |

---

## Mental Models

### The "Shared Blueprint" Model

A hidden class is a blueprint that lives *outside* the objects and is *shared* by all objects of that shape. The object itself just holds the field values in slots; the blueprint says what each slot means. This is exactly how a C struct works — except the "blueprint" (the struct definition) is fixed at compile time, while a hidden class is discovered at runtime and can branch into a tree as different objects take different paths. Keep your objects on one path and they share one blueprint; scatter them across paths and the JIT drowns in blueprints.

### The "Header Tax" Model

Every managed object pays a fixed header tax before it stores any of your data: ~16 bytes in Java, ~16 bytes in CPython, 8 bytes (vptr) in virtual C++. Mentally tag every small heap object with "+16 bytes you didn't ask for." When you're about to create a million of something, multiply the tax. This is the model that makes you reach for primitive arrays, `__slots__`, value types, or flattening instead of a million tiny boxed objects.

### The "Same Shape Every Time" Discipline

For dynamic languages, hold one rule above all: **construct every instance of a logical type with the same fields, in the same order, with the same types.** Initialize everything in the constructor; don't conditionally add properties later; don't `delete` properties; don't start a field as `null` and later make it an object if you can help it. Each violation forks the shape and pushes hot sites toward megamorphic. The discipline is free and the payoff is large.

---

## Code Examples

### Java — Measuring the header with JOL

```java
// Using OpenJDK's JOL (Java Object Layout) tool:
import org.openjdk.jol.info.ClassLayout;

class Small { int x; }

public class Demo {
    public static void main(String[] args) {
        System.out.println(ClassLayout.parseClass(Small.class).toPrintable());
    }
}
```

JOL prints something like: 8 bytes mark word, 4 bytes class pointer, 4 bytes for `int x`, total 16. It will show you the exact offsets and any alignment padding the JVM inserted — the authoritative way to see a Java object's layout rather than guessing.

### Java — Boxed map overhead

```java
// A HashMap<Long, Long> with 10M entries stores, per entry:
//   - a Node object (~32 bytes: header + hash + key ref + value ref + next ref)
//   - a boxed Long key  (~16 bytes)
//   - a boxed Long value (~16 bytes)
// That's ~64 bytes of object overhead to store 16 bytes of actual longs.
Map<Long, Long> m = new HashMap<>();
```

The actual data is two longs (16 bytes); the structure around it is ~4x that. For dense integer-keyed data, a specialized primitive map (e.g. `long[]`-backed open addressing, or libraries like Eclipse Collections / fastutil) can cut memory several-fold.

### Python — `__slots__` shrinks instances

```python
import sys

class Loose:
    def __init__(self, x, y):
        self.x = x; self.y = y          # stored in a per-instance __dict__

class Tight:
    __slots__ = ('x', 'y')              # stored as fixed slots, no __dict__
    def __init__(self, x, y):
        self.x = x; self.y = y

# The Tight instance has no __dict__, so it's markedly smaller and faster
# to access. For millions of instances this is a major memory win.
print(hasattr(Loose(1, 2), '__dict__'))  # True
print(hasattr(Tight(1, 2), '__dict__'))  # False
```

### JavaScript — Monomorphic vs polymorphic construction

```js
// GOOD: every Point has the same shape, built in the same order.
class Point {
  constructor(x, y) { this.x = x; this.y = y; }  // always {x, y}
}

// BAD: shape depends on a branch -> two hidden classes for one logical type.
function makePointBad(x, y, flag) {
  const p = {};
  if (flag) { p.x = x; p.y = y; }   // {x, y}
  else      { p.y = y; p.x = x; }   // {y, x}  -> different shape!
  return p;
}

// ALSO BAD: adding a property later forks the shape.
const q = new Point(1, 2);
q.z = 3;   // q now has a different hidden class than every other Point
```

Use a `class` (or always the same object literal), set all fields up front, and don't tack on properties after construction. The optimizing compiler rewards you with monomorphic, inline-cached property access.

### C++ — Where the vptr lands

```cpp
#include <cstdio>

struct Plain   { int a; };
struct Virtual { virtual void f() {} int a; };

int main() {
    printf("Plain   = %zu\n", sizeof(Plain));    // 4
    printf("Virtual = %zu\n", sizeof(Virtual));  // 16: 8B vptr + 4B a + 4B pad
    return 0;
}
```

The vptr is added at offset 0, ahead of `a`. Every virtual object pays 8 bytes and a pointer-chase per virtual call — the cost of dynamic dispatch made visible in `sizeof`.

### Go — `unsafe` to inspect offsets and alignment

```go
package main

import (
    "fmt"
    "unsafe"
)

type T struct {
    a byte
    b int64
    c byte
}

func main() {
    var t T
    fmt.Println("size:", unsafe.Sizeof(t))                 // 24 (lots of padding)
    fmt.Println("off b:", unsafe.Offsetof(t.b))            // 8
    fmt.Println("align b:", unsafe.Alignof(t.b))           // 8
    // Reorder to {b, a, c} -> size shrinks to 16.
}
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Per-object headers** | Enable GC, identity hashing, locking, dynamic typing, reflection. | A fixed memory tax that dominates when objects are small and numerous. |
| **Hidden classes** | Turn dynamic property access into near-static fixed-offset loads; huge speedup. | Fragile: inconsistent shapes deoptimize hot code silently. |
| **Inline caches** | Make repeated access at one site essentially free once warmed. | Polymorphism degrades them; megamorphic sites fall off the fast path. |
| **`__slots__` / value types** | Cut per-object memory and speed access by removing the per-instance dict/box. | Lose dynamism (no ad-hoc attributes); more rigid. |
| **vtable pointer** | Enables polymorphism with a single indirection. | Per-object 8 bytes + a pointer chase on every virtual call; defeats inlining. |
| **SoA** | Maximizes useful bytes per cache line; vectorizable. | Harder to express "one whole object"; more arrays to coordinate. |
| **Reference counting (Python)** | Deterministic, prompt reclamation. | A memory write on every ref change; cache-unfriendly; complicates threading. |

---

## Use Cases

This level of layout knowledge pays off when:

- **Profiling shows a JS/TS function deoptimized.** The fix is almost always shape discipline — same fields, same order, set in the constructor.
- **A Java service is GC-bound or memory-bound on many small objects.** Headers and boxing are the culprit; primitive arrays, value-like flattening, or fewer/larger objects help.
- **A Python data pipeline is slow and memory-heavy.** `__slots__`, `array`/`bytes`, or moving the inner loop to NumPy removes the per-object header tax.
- **You're writing a hot numeric loop in C++/Rust/Go.** AoS→SoA and field reordering set your cache efficiency.
- **You're sizing a cache or in-memory store.** Knowing the true per-entry cost (header + boxing + map node) prevents a 3–4x memory surprise.

It matters **less** when objects are few, when you're nowhere near a memory or latency limit, or when correctness and clarity outweigh the last 2x of layout efficiency.

---

## Coding Patterns

### Pattern 1: Construct in one fixed shape (dynamic languages)

```js
class User {
  constructor(id, name, age) {
    this.id = id;        // always these three fields...
    this.name = name;    // ...in this order...
    this.age = age;      // ...set in the constructor. One shape forever.
  }
}
```

### Pattern 2: `__slots__` for high-count Python classes

```python
class Node:
    __slots__ = ('value', 'next')   # millions of these? slots saves big.
```

### Pattern 3: Initialize all fields even when "unknown"

```js
// Bad: leaving `parent` unset until later forks the shape on assignment.
// Good: declare it up front with a stable type.
class TreeNode {
  constructor(v) {
    this.value = v;
    this.left = null;     // declared now, stable shape
    this.right = null;
    this.parent = null;
  }
}
```

### Pattern 4: Prefer primitive/typed arrays for bulk numbers

```js
const xs = new Float64Array(n);   // contiguous, unboxed doubles
```
```java
double[] xs = new double[n];      // not Double[] / List<Double>
```

### Pattern 5: SoA for field-at-a-time hot loops

```cpp
struct Bodies {           // instead of struct Body{...} bodies[N];
    std::vector<float> x, y, z, vx, vy, vz;
};
// integrate(): loop over x[]/vx[] contiguously — streams cache, vectorizes.
```

---

## Best Practices

- **Use a layout/inspection tool, don't guess.** JOL for Java, `unsafe.Sizeof`/`Offsetof` for Go, `std::mem::size_of` for Rust, `sys.getsizeof` and `__sizeof__` for Python, `--print-bytecode`/DevTools for V8 shapes.
- **In dynamic languages, lock object shape:** all fields set in the constructor, same order, stable types, no late `delete` or ad-hoc property tacking.
- **Reach for `__slots__`** on any Python class you create in large numbers.
- **Avoid boxing in hot paths.** Primitive/typed arrays over boxed collections; specialized primitive maps for dense integer keys.
- **Keep hot property-access sites monomorphic.** If a function processes objects of several shapes, consider splitting it per shape so each site sees one.
- **Order struct fields largest-alignment-first** (carries over from junior; still true here).
- **Measure deopts.** In Node, `--trace-deopt` and `--trace-ic` reveal which sites went polymorphic and why.
- **Don't store small integers as objects** when an unboxed/tagged representation exists — connect this to the data-representation topic.

---

## Edge Cases & Pitfalls

- **Conditional property assignment forks the shape.** `if (c) o.a = 1;` followed by `else o.b = 2;` makes two shapes. Set all properties unconditionally; use `null`/`undefined` as a placeholder value, not a missing field.
- **`delete obj.prop` in JS** drops the object to dictionary (slow) mode in most engines. Set to `null` instead of deleting if you need the fast path.
- **Adding properties in a loop, in data-dependent order,** generates a fan of shapes. Build the object fully, then mutate values, never the shape.
- **Mixed-type fields.** A field that is sometimes an `int` and sometimes a `string` (in JS) or that starts boxed and becomes unboxed forces the engine to widen its representation — a hidden deopt.
- **Java `Optional`, autoboxing, and varargs** silently allocate boxed objects in hot loops. `for (int i : list)` over a `List<Integer>` unboxes a million times.
- **Python's default `__dict__`** means every attribute access is a dict lookup; without `__slots__` you never get fixed-offset speed.
- **The mark word is volatile state.** Don't assume an object's identity hash is "stored somewhere fixed" — it may not be computed until first requested, and locking can temporarily displace it. (Details in `senior.md`.)
- **Arrays of objects are arrays of references** (Java, JS, Python). Iterating them is pointer-chasing across scattered heap memory, defeating prefetch — unlike a primitive/typed array.
- **`sizeof` lies about deep cost.** `sizeof` (or `getsizeof`) reports the object's *own* bytes, not the boxed objects it points to. A list's `getsizeof` doesn't include the elements.

---

## Test Yourself

1. On a 64-bit HotSpot JVM with compressed oops, what is the minimum size of an object with a single `int` field, and why isn't it 4 bytes?
2. Name three distinct things the JVM mark word can hold, and explain why one 64-bit slot can mean different things at different times.
3. Write two JS functions that produce objects with the *same* properties but *different* hidden classes. Explain the transition paths.
4. Why does `delete obj.x` hurt performance in V8 far more than `obj.x = null`?
5. Estimate the per-entry overhead of a `HashMap<Long, Long>` and explain where each byte goes. Propose a leaner structure.
6. Add `__slots__` to a Python class and explain, in terms of layout, what changed and what you gave up.
7. A C++ `struct` jumps from 8 bytes to 24 when you add one `virtual` method to a class that already had two `double`s. Account for every byte.
8. You have a hot loop that reads only the `mass` field of 10M bodies. Show the AoS and SoA layouts and compute the useful-bytes-per-cache-line for each.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              OBJECT MODEL & LAYOUT — RUNTIME HEADERS             │
├──────────────────────────────────────────────────────────────────┤
│ JVM object (64-bit, compressed oops):                            │
│   mark word (8B) | class ptr (4B) | fields... | pad -> min 16B   │
│   mark word holds: hash | lock state | GC age  (overloaded)      │
├──────────────────────────────────────────────────────────────────┤
│ CPython object:                                                  │
│   ob_refcnt (8B) | ob_type ptr (8B) | payload...                 │
│   everything boxed; int ~28B; refcount written on every ref op   │
├──────────────────────────────────────────────────────────────────┤
│ C++ with virtual: vptr (8B) at offset 0, then members            │
├──────────────────────────────────────────────────────────────────┤
│ HIDDEN CLASSES (V8 Map / SpiderMonkey Shape / JSC Structure):    │
│   same props + same ADD ORDER -> same shape -> fixed offsets     │
│   add order differs -> different shape -> polymorphic/megamorphic │
│   site state:  monomorphic(1) > polymorphic(2-4) > megamorphic   │
│   delete prop -> dictionary (slow) mode                          │
├──────────────────────────────────────────────────────────────────┤
│ DISCIPLINE (dynamic langs): set ALL fields, SAME order, in ctor  │
│ PYTHON: __slots__ removes per-instance __dict__ (big save)       │
│ BULK NUMBERS: primitive/typed arrays, never boxed collections    │
│ HOT FIELD LOOP: SoA -> ~100% useful bytes per 64B cache line     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The **JVM header** is a **mark word** (8B; overloaded for hash/lock/GC) plus a **class pointer** (4B compressed), making the minimum object 16 bytes — before any field you declared.
- **CPython** prepends a **refcount** and a **type pointer** to every object; everything is boxed, so a small `int` is ~28 bytes and every reference operation writes memory.
- **C++** adds a **vtable pointer** at offset 0 the instant a class has any virtual method — a per-object 8 bytes and a pointer chase per virtual call.
- **Hidden classes** (V8 Maps, SpiderMonkey Shapes) let dynamic languages access `obj.x` as a fixed offset by sharing a shape descriptor among same-shaped objects, cached at each site by an **inline cache**.
- **Shape is defined by which properties were added in which order.** Build objects inconsistently and you fork shapes, pushing hot sites from **monomorphic** → **polymorphic** → **megamorphic** (slow hash lookup, possible JIT bailout).
- The fix is free **layout discipline**: set all fields, in the same order, with stable types, in the constructor; don't `delete` properties; don't tack on fields late.
- **Python `__slots__`** is the manual hidden-class: fixed-offset attributes instead of a per-instance dict, cutting memory and speeding access.
- **Boxing and headers** dominate memory for many small objects; **primitive/typed arrays** and **SoA** are the standard escapes, with SoA maximizing useful bytes per cache line.
- Always **inspect real layouts** with JOL, `unsafe.Sizeof`, `size_of`, or `getsizeof` rather than guessing.

---

## What You Can Build

- **A JOL-style object inspector** (for your language) that prints header bytes, field offsets, and padding for any class.
- **A deopt detector for Node.** Run a workload under `--trace-deopt --trace-ic`, parse the output, and report which functions went polymorphic/megamorphic and the likely shape culprit.
- **A `__slots__` memory benchmark.** Create 10M instances with and without `__slots__`; chart RSS and attribute-access time.
- **A primitive-map vs boxed-map benchmark in Java.** `HashMap<Long,Long>` versus a `long[]`-backed open-addressing map at 10M entries; compare memory and throughput.
- **A "shape transition" visualizer.** Take a sequence of property additions and draw the transition tree, showing where two construction paths diverge into different shapes.

---

## Further Reading

- *OpenJDK JOL (Java Object Layout)* — the tool and its documented examples; the single best way to learn the JVM header.
- *CPython Internals* — Anthony Shaw; and the CPython source `Include/object.h` for `PyObject`/`PyVarObject`.
- V8 blog: *Fast properties in V8* and *Maps (Hidden Classes) in V8* — the canonical explanation of shapes and inline caches.
- *SpiderMonkey* documentation on Shapes; *JavaScriptCore* on Structures.
- *The Lean and Mean guide to V8 performance* talks by the V8 team (shapes, ICs, deopts).
- *Effective Python* (Brett Slatkin) — the items on `__slots__` and memory.
- *Inside the JVM* / the HotSpot wiki pages on the object header and mark word.

---

## Related Topics

- This folder: `junior.md`, `senior.md`, `professional.md`, `interview.md`, `tasks.md`.
- The next runtime topic, **method dispatch**, takes the vtable pointer and inline cache introduced here and explains the actual call mechanics.
- **Data representation** (tagged pointers, boxing, NaN-boxing) is the sibling concept behind "why is a small int an object?" referenced throughout.
- **Garbage collection** reads and writes the mark word's GC bits and relies on the class pointer to walk an object's fields.
- **Cache architecture** is the reason hidden-class offsets, `__slots__`, and SoA produce measurable speedups.

---

## Diagrams & Visual Aids

### The JVM Object Header

```text
64-bit HotSpot, compressed oops ON:

byte:  0        8        12              ...
      ┌────────┬────────┬──────────────────────┐
      │ mark   │ klass  │  your fields          │  -> padded to 8B,
      │ word   │ ptr    │  (arrays: +4B length) │     min object = 16B
      │ (8B)   │ (4B)   │                       │
      └────────┴────────┴──────────────────────┘
        ^ hash / lock state / GC age (meaning varies by state)
```

### A Hidden-Class Transition Tree

```text
            {}  (empty shape C0)
             │ add "x"
             ▼
        C1 { x@0 }
        ┌────┴──────────────┐
   add "y"              add "z"
        ▼                   ▼
  C2 { x@0, y@1 }    C3 { x@0, z@1 }
   ^ a={x,y} lands here   ^ b={x,z} lands here

Building objects with DIFFERENT add-orders puts them on DIFFERENT
branches -> a shared access site sees multiple shapes -> slowdown.
```

### Monomorphic vs Megamorphic Access Site

```text
obj.x  at one call site:

MONOMORPHIC (1 shape)         MEGAMORPHIC (many shapes)
┌──────────────────┐         ┌──────────────────────────┐
│ shape == C2 ?     │        │ give up on inline cache    │
│   load slot[0]     │        │ -> generic hash lookup     │
│ (fixed offset)     │        │ -> maybe deopt the function│
└──────────────────┘         └──────────────────────────┘
   near-static speed             ~10x slower property reads
```

### CPython int vs C int

```text
C int (4 bytes):           CPython int (~28 bytes):
┌────┐                     ┌──────────┬──────────┬──────┬─────────┐
│ 42 │                     │ refcnt   │ type ptr │ size │ digits  │
└────┘                     │ (8B)     │ (8B)     │ (8B) │ (4B+...) │
 raw value, no header      └──────────┴──────────┴──────┴─────────┘
                            header (boxed) before the actual value
```
