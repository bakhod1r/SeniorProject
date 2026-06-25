# Method Dispatch & Inline Caches — Middle Level

> **Topic:** [Method Dispatch & Inline Caches](README.md)
> **Focus:** The concrete machinery: vtable layout for single inheritance, why multiple inheritance needs thunks, interface dispatch (itables), and how inline caches actually check their guard.

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
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Exactly how is a vtable laid out, and what breaks when a class has more than one base?** And **what is the guard inside an inline cache actually comparing?**

At the junior level, a vtable was "a table of function pointers, indexed by a fixed slot." That model is correct for the common case — **single inheritance** — and it's worth being able to draw the exact memory layout. But the moment a class inherits from *two* bases, the clean "slot N means method M" picture cracks, and real C++ implementations resort to a small piece of glue code called a **thunk** to patch it back together. Understanding why is a rite of passage for anyone who works at the runtime level.

This page also takes apart the second big mechanism: **interface dispatch**. A method call through an interface (`Comparable`, `io.Reader`) is *not* the same as a call through a class, because an object can implement an interface without that interface being anywhere near its main inheritance line. Java solves this with **itables**, Go solves it with the **itab**, and C++ solves the analogous problem through multiple-inheritance vtables. Each is a different answer to the same question: *"given an object and an interface, how do I find the right method quickly?"*

Finally, we go one level deeper on the inline cache: what the **guard** physically compares (a class/shape pointer), how a **monomorphic** cache is built and torn down, and the first sign of trouble — what happens when a second type shows up at a call site. The senior page generalizes that to polymorphic inline caches (PICs) and devirtualization.

In one sentence: **this level is where dispatch stops being a metaphor and becomes a concrete data structure you could draw on a whiteboard — vtable slots, itab headers, and a guard that's just a pointer comparison.**

---

## Prerequisites

What you should know before reading this:

- **Required:** The junior-level model — static vs dynamic dispatch, the vtable/vptr idea, naive dynamic lookup, and the basic inline cache.
- **Required:** What a pointer and a struct/object memory layout look like (fields at offsets).
- **Required:** The difference between class inheritance and interface implementation.
- **Helpful but not required:** Reading simple pseudo-assembly (loads, an indirect `call`).
- **Helpful but not required:** Basic awareness that objects have a header word or two (type info, vptr).

You do **not** need to know:

- JIT internals or speculative optimization (that's `professional.md`).
- The CPU branch predictor's microarchitecture (that's `senior.md`).
- Garbage-collector interactions with object headers.

---

## Glossary

| Term | Definition |
|------|-----------|
| **vtable slot** | A fixed index into a class's vtable corresponding to one virtual method. Determined at compile time. |
| **Single inheritance** | A class has at most one base class. The clean case for vtable layout: the derived vtable is the base vtable extended. |
| **Multiple inheritance** | A class inherits from two or more bases. Forces multiple vptrs and pointer adjustment. |
| **`this` pointer adjustment** | Correcting the receiver pointer so it points at the right sub-object before calling a method. The job of a thunk. |
| **Thunk** | A tiny stub of generated code that adjusts the `this` pointer (and/or return value) and then jumps to the real method. Used in multiple-inheritance vtables. |
| **Interface** | A named set of method signatures a type can implement, independent of its class hierarchy (Java `interface`, Go interface). |
| **itable** | Java's per-(class, interface) table mapping interface methods to the class's implementations. |
| **itab (Go)** | Go's interface table: a small header holding the dynamic type and a function-pointer array for the interface's methods. |
| **Interface value (Go)** | A two-word pair: a pointer to the itab and a pointer to the concrete data. |
| **Guard** | The runtime check in an inline cache that compares the receiver's class/shape against the cached one. |
| **Hidden class / shape / map** | The runtime descriptor of an object's structure (V8 "Map", SpiderMonkey "Shape", Python type). The guard's comparison key. |
| **Monomorphic IC** | An inline cache holding exactly one (class → target) entry. |
| **Cache miss** | The guard fails: the receiver isn't the cached type, so the runtime must re-resolve and update the cache. |
| **Dispatch token / type ID** | A unique per-class value the guard compares against, often just the class pointer. |

---

## Core Concepts

### 1. Single-Inheritance vtable Layout (the clean case)

With single inheritance, the layout is beautifully simple and is what makes vtables fast. The rule: **a derived class's vtable starts with the base class's slots in the same order, then appends its own new methods.**

```text
class Base    { virtual void f(); virtual void g(); };
class Derived : Base { void g() override; virtual void h(); };

Base vtable:      [0]=Base::f   [1]=Base::g
Derived vtable:   [0]=Base::f   [1]=Derived::g   [2]=Derived::h
                   ^same slot     ^overridden      ^new
```

Because slot indices are preserved, code compiled against `Base*` can call `g()` at slot 1 and it works correctly on a `Derived` — the slot holds `Derived::g`. The `this` pointer needs no adjustment, because a `Derived` object *starts with* a `Base` sub-object at offset 0. One vptr, fixed slots, zero pointer math. This is why single inheritance is the fast, simple case in every implementation.

### 2. Multiple Inheritance: Two Bases, Two vptrs, and Pointer Adjustment

Now let a class inherit from two bases:

```cpp
struct A { virtual void fa(); int a; };
struct B { virtual void fb(); int b; };
struct C : A, B { void fa() override; void fb() override; };
```

A `C` object can't put both `A` and `B` at offset 0 — only one can be first. A typical layout:

```text
C object:
  offset 0:  [ A's vptr ][ a ]      <- the A sub-object
  offset N:  [ B's vptr ][ b ]      <- the B sub-object
```

So a `C` has **two vptrs** and two embedded sub-objects. Here's the problem. When some code holds a `B*` (pointing at the `B` sub-object, at offset N) and calls `fb()`, the actual `C::fb` method expects a `C*` (pointing at offset 0). The pointers differ by N bytes. Something must subtract N from the receiver before entering `C::fb`. That "something" is a **thunk**.

### 3. Thunks: The Glue for `this` Adjustment

A **thunk** is a tiny compiler-generated stub. The `B` sub-object's vtable doesn't point its `fb` slot directly at `C::fb`; it points at a thunk that does:

```text
thunk_for_C_fb:
    this -= N          ; adjust B*  ->  C*   (the "this adjustment")
    jmp C::fb          ; tail-call the real method
```

So calling `fb()` through a `B*` lands in the thunk, which fixes the pointer and jumps to the real `C::fb`. From the caller's side it's invisible — still "read the slot, call it" — but the slot points at glue, not the method. Thunks can also adjust the *return* pointer for covariant returns. The cost is a tiny extra jump and some pointer arithmetic on the multiple-inheritance path; single inheritance never pays it. Virtual inheritance (the diamond) adds further indirection (vtable-stored offsets) but the principle is the same: **adjust the receiver, then dispatch.**

### 4. Interface Dispatch Is a Different Problem

A class hierarchy gives every subtype a vtable that's a superset of its base's vtable, with stable slots. Interfaces break that. A type can implement `Comparable` (Java) or `io.Reader` (Go) regardless of where it sits in the class tree, and two unrelated types implementing the same interface won't have that interface's methods at the same vtable slot. So "interface method → fixed slot" doesn't hold the way "class method → fixed slot" does. Runtimes need a separate mechanism.

### 5. Java itables

In Java, a class that implements interfaces gets, for each interface, an **itable** (interface method table): a small array mapping that interface's methods to the class's concrete implementations. `invokevirtual` (class-method call) uses the simple, fixed-slot vtable. `invokeinterface` (interface call) is harder: the JVM must, given the object's class and the target interface, find the right itable and then the right method within it. Naively that's a search over the class's interface tables — more expensive than `invokevirtual`. HotSpot optimizes this with **inline caches on interface call sites**: the first call resolves the itable lookup, and subsequent calls with the same receiver class hit a cached target behind a class guard, just like other dispatch. So the *worst case* is the itable search, but the *common case* is a guarded direct call.

### 6. Go's itab (Interface Table)

Go has no classes, but interface dispatch is central. A Go **interface value** is two words: `(itab, data)`. The **itab** is a small header that ties a concrete type to an interface:

```text
itab:
   ├─ inter  : *interfacetype   (which interface, e.g. io.Reader)
   ├─ _type  : *_type           (the concrete dynamic type, e.g. *os.File)
   ├─ hash   : uint32           (type hash, for type switches)
   └─ fun[]  : [n]uintptr       (function pointers: the concrete methods
                                  implementing the interface, in interface order)
```

A call `r.Read(buf)` where `r` is an `io.Reader` becomes: load the itab from the interface value, load `fun[index_of_Read]`, and call it with the `data` pointer as the receiver. itabs are built lazily and **cached** in a global hash table keyed by (interface type, concrete type), so the expensive "does this type satisfy this interface, and where are its methods?" computation happens once per (interface, type) pair, not per call. After that, an interface call in Go is essentially "load a function pointer from a 2-word value and call it" — close to a C++ virtual call in cost.

### 7. C++ Interface-Like Dispatch

C++ has no `interface` keyword; the idiom is an abstract base class (all pure-virtual). Calling through such a base is just ordinary virtual dispatch — *unless* the abstract base is one of several base classes, in which case you're back in multiple-inheritance territory with its extra vptr and thunks. So in C++, "interface dispatch" is a special case of multiple-inheritance vtable dispatch, paid for with the same thunks.

### 8. The Guard, Concretely

An inline cache's **guard** is mechanically simple: it compares the receiver's type descriptor against the cached one. Physically:

- **V8 / SpiderMonkey:** compare the object's hidden-class/shape pointer (the **Map** / **Shape**) against the cached pointer. A pointer compare + a conditional branch.
- **HotSpot:** compare the object's class pointer (`klass`) against the cached `klass`.
- **Go/C++ vtable calls** don't need a guard at all — the vtable *is* the dispatch; there's no speculation to verify.

The guard's whole job is to make speculation safe: *we bet the type is X; the guard confirms it before we trust the cached target.* On success, jump to the cached method. On failure (a **cache miss**), re-resolve and update the cache. A monomorphic IC is just `{ cached_type, cached_target }` plus this compare-and-branch. The next page generalizes one entry to several (a PIC).

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Single-inheritance vtable** | A company org chart where each role's extension is fixed; a new department just appends new extensions to the list. |
| **Multiple inheritance** | An employee who sits in two departments at once, with a desk in each wing of the building. |
| **`this` adjustment** | To deliver mail to that employee's "marketing desk," you walk to the marketing wing first — a different physical spot than their "engineering desk." |
| **Thunk** | A receptionist who intercepts mail addressed to the marketing desk, walks it over to the right wing, and hands it off — invisible to the sender. |
| **itable / itab** | A cross-reference card: "for the *Comparable* role, this person's relevant methods are here" — separate from their main org-chart entry. |
| **Go interface value** | A name badge with two lines: which *role* you're acting as, and *who* you actually are. |
| **Guard** | Checking the badge still says the expected name before trusting last time's directions. |

---

## Mental Models

### The "Layered Vtable" Model (single inheritance)

Picture a vtable as a stack of layers: the base layer at the bottom, each subclass adding a layer on top. Overrides *replace a card in a lower layer in place*; new methods *add cards on top*. Because lower layers never move, code that only knows about the base can index into the bottom layers safely. This image makes it obvious why single inheritance needs no pointer math and why slots are stable.

### The "Two Desks, One Person" Model (multiple inheritance)

A multiply-inheriting object literally has more than one "front door" (vptr/sub-object). Whoever knocks on the `B` door is standing N bytes into the object; the method, though, lives in the unified `C` and expects you at the front door. The thunk is the usher that walks you from the `B` door to the front door before the method runs. Hold this and multiple-inheritance dispatch stops being mysterious.

### The "Badge Plus Person" Model (Go interfaces)

A Go interface value is a person wearing a role badge: the badge (itab) says *which role's method list to use*, and underneath is the actual person (data). Dispatch is "read the role's method list, pick the right method, call it on the person." The itab cache means the runtime figures out a person's badge-for-this-role once and laminates it.

---

## Code Examples

### Single-Inheritance Layout in Action (C++)

```cpp
#include <cstdio>

struct Base {
    virtual void f() { printf("Base::f\n"); }
    virtual void g() { printf("Base::g\n"); }
    virtual ~Base() = default;
};

struct Derived : Base {
    void g() override { printf("Derived::g\n"); }  // overrides slot 1
    virtual void h() { printf("Derived::h\n"); }    // new slot 2
};

int main() {
    Base* p = new Derived();
    p->f();   // slot 0 -> Base::f      (inherited)
    p->g();   // slot 1 -> Derived::g   (overridden, same slot)
    // p->h() won't compile: Base has no slot 2. The slot exists, the static type doesn't expose it.
    delete p;
}
```

The receiver `p` needs no adjustment: a `Derived` begins with its `Base` sub-object at offset 0, so `Base*` and the real `Derived*` are the same address.

### Multiple Inheritance and the Hidden Thunk (C++)

```cpp
#include <cstdio>

struct A { virtual void fa() { printf("A::fa\n"); } int a = 1; };
struct B { virtual void fb() { printf("B::fb\n"); } int b = 2; };

struct C : A, B {
    void fa() override { printf("C::fa\n"); }
    void fb() override { printf("C::fb\n"); }
};

int main() {
    C c;
    A* pa = &c;   // points at offset 0   (A sub-object)
    B* pb = &c;   // points at offset N   (B sub-object) — DIFFERENT address!

    printf("%p vs %p\n", (void*)pa, (void*)pb);  // not equal

    pb->fb();     // goes through B's vtable slot -> THUNK -> adjusts this -> C::fb
}
```

`pa` and `pb` print different addresses even though both refer to the same `c`. The call `pb->fb()` enters `C::fb` only because B's vtable slot for `fb` points at a compiler-generated thunk that subtracts the offset to recover the real `C*`.

### Go Interface Dispatch and the itab (conceptual)

```go
package main

import "fmt"

type Speaker interface{ Speak() string }

type Dog struct{ name string }
func (d Dog) Speak() string { return "Woof" }

func main() {
    var s Speaker = Dog{"Rex"}   // s is (itab(Speaker, Dog), &Dog{"Rex"})
    fmt.Println(s.Speak())       // load itab.fun[0] -> Dog.Speak; call with data
}

// Mentally, s.Speak() is:
//   itab   := s.tab               // the cached (Speaker, Dog) itable
//   target := itab.fun[0]         // Dog.Speak
//   data   := s.data
//   target(data)
```

The first time a `Dog` is assigned to a `Speaker`, Go builds (or fetches from the global cache) the `(Speaker, Dog)` itab. Every later call just reads `fun[0]`. A type switch (`switch v := s.(type)`) uses `itab._type` / `itab.hash`.

### Watching an Inline Cache Form (JavaScript, conceptual)

```javascript
function area(shape) {
  return shape.width * shape.height;   // two property-access ICs: .width and .height
}

// First call: ICs are empty -> slow generic lookup, then they record the shape.
area({ width: 3, height: 4 });

// Subsequent calls with the SAME shape {width, height}:
//   guard: shape's Map == cached Map ?  yes
//   -> read width at cached offset, read height at cached offset (no dictionary search)
area({ width: 5, height: 6 });  // monomorphic, fast
```

After the first call, V8's IC for `.width` records "for objects of this Map, `width` lives at field offset k." The guard checks the Map pointer; on a hit it loads from the fixed offset — no name search. The same machinery serves both property reads and method calls.

### A Cache Miss in Slow Motion

```text
call site: shape.width

iter 1:  IC empty
         -> generic lookup finds width at offset 8 for Map_M1
         -> IC := { Map_M1 -> offset 8 }                      (now MONOMORPHIC)

iter 2:  shape has Map_M1
         -> guard hit -> load [shape + 8]                     (fast)

iter 3:  shape has Map_M2 (different shape!)
         -> guard MISS
         -> generic lookup finds width at offset 16 for Map_M2
         -> IC must now hold two cases -> becomes POLYMORPHIC   (senior.md)
```

One stray shape is enough to push a monomorphic site toward polymorphic. That transition is the central performance story of the next level.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Single-inheritance vtable** | Stable slots, no pointer adjustment, one vptr. Fastest dynamic dispatch. | Limited to one base; can't model "is-a" with two parents. |
| **Multiple-inheritance vtable** | Models multiple bases / multiple interfaces in C++. | Multiple vptrs (bigger objects), thunks add a small cost, `this` differs per base pointer. |
| **itable / itab interface dispatch** | Decouples interface satisfaction from the class hierarchy; any type can implement any interface. | Resolution is more work than a vtable slot; relies on caching to be fast. |
| **Inline-cache guard** | Turns dynamic-language lookup into a guarded jump. | Adds a compare-and-branch and must be invalidated when types/shapes change. |

---

## Use Cases

- **Reading C++ ABI behavior.** When a `dynamic_cast`, a `reinterpret_cast` between base pointers, or a multiple-inheritance pointer comparison surprises you, the vtable/thunk model explains it.
- **Understanding Go interface cost.** Knowing the interface value is `(itab, data)` and that itabs are cached explains why interface calls are cheap after warmup but boxing a value into an interface still has a cost.
- **Explaining `invokeinterface` vs `invokevirtual` performance in the JVM.** Interface calls historically cost more; the itable-plus-IC story is why, and why it usually doesn't matter after warmup.
- **Debugging a JS/Python hot path that's mysteriously slow.** A call site that slid from monomorphic toward polymorphic is a frequent culprit; the guard/miss model tells you what to look for.

---

## Coding Patterns

### Pattern 1: Prefer single inheritance + interfaces over deep multiple inheritance

```text
Instead of: class C : public Drawable, public Serializable, public Comparable { ... }
            (three vptrs, thunks, fatter objects)
Prefer:     compose, or use one base + lightweight interface-style mixins.
```

Multiple inheritance isn't wrong, but each extra base adds a vptr and thunked calls. Reach for it deliberately.

### Pattern 2: Keep interface method sets small and stable

In Go and Java, a smaller interface means a smaller itab/itable and fewer call sites that can go megamorphic across many implementations. `io.Reader` (one method) is cheap to dispatch and easy to keep monomorphic per call site.

### Pattern 3: Don't box into an interface inside a hot loop unnecessarily

```go
// Each assignment to an interface variable may require an itab (cached, but still).
// In a hot loop over concrete Dogs, call the concrete method directly when you can.
```

If you already hold the concrete type, calling it directly is a static dispatch — strictly cheaper than going through an interface value.

---

## Best Practices

- **Know which call is which.** `invokevirtual`/non-virtual-call = vtable or static; `invokeinterface`/Go-interface-call = itable/itab. They have different costs.
- **Treat multiple inheritance as a tool with a footprint.** Extra vptrs and thunks are real; use composition or interfaces when you only need the contract, not the storage.
- **Keep object shapes stable.** In dynamic languages, initialize all fields in the constructor in a consistent order so objects share one hidden class — this keeps property-access ICs monomorphic.
- **Don't compare base pointers from different bases for identity.** Under multiple inheritance, `(A*)&c != (B*)&c`. Compare typed pointers or compare addresses of the most-derived object.
- **Let the runtime cache interface dispatch; design for type stability, not manual caching.** Hand-rolling your own dispatch table rarely beats the runtime's itab/IC.

---

## Edge Cases & Pitfalls

- **`(A*)&c` and `(B*)&c` are different addresses** under multiple inheritance. Code that assumes "same object → same pointer value" breaks. Identity must compare most-derived pointers.
- **Calling through the wrong base after a `reinterpret_cast`** skips the thunk and lands you at the wrong offset — undefined behavior. Use `static_cast`/`dynamic_cast`, which apply the offset.
- **An empty/zero interface value in Go** has a nil itab; calling a method on a nil interface panics, while a non-nil interface wrapping a nil pointer does *not* (the itab is present). This nil-vs-nil-interface trap bites everyone once.
- **Adding a field or method late (dynamic langs) splits hidden classes.** Two objects you think are "the same shape" may have different Maps if their fields were added in different orders — silently making a call site polymorphic.
- **itable/itab lookups are only cheap after the cache is warm.** A microbenchmark that measures the first interface call measures the resolution cost, not the steady state.
- **Covariant return types add return-adjusting thunks** in C++. The slot points at glue that fixes the returned pointer, not just `this`.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│            VTABLES, ITABLES, AND GUARDS                          │
├──────────────────────────────────────────────────────────────────┤
│ SINGLE INHERITANCE                                               │
│   derived vtable = base slots (same order) + new slots           │
│   override = replace target in same slot                         │
│   no this-adjustment (base sub-object at offset 0)               │
├──────────────────────────────────────────────────────────────────┤
│ MULTIPLE INHERITANCE                                             │
│   object has one vptr + sub-object PER base                      │
│   B* and A* of same object differ by an offset                   │
│   THUNK = stub that adjusts `this` then jmps to real method      │
├──────────────────────────────────────────────────────────────────┤
│ INTERFACE DISPATCH                                               │
│   Java   invokeinterface -> itable (per class,interface) + IC    │
│   Go     interface value = (itab, data); itab.fun[i] = method    │
│          itabs cached by (interface type, concrete type)         │
│   C++    interface = abstract base => multiple-inheritance vtbl  │
├──────────────────────────────────────────────────────────────────┤
│ THE GUARD (inline cache)                                         │
│   compare receiver's class/shape ptr to cached ptr               │
│   hit  -> jump cached target                                     │
│   miss -> re-resolve, update IC (mono -> poly transition)        │
├──────────────────────────────────────────────────────────────────┤
│ vtable/itab calls need NO guard (no speculation to verify)       │
│ inline caches DO (they bet on the type)                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Single-inheritance vtables** are the clean case: the derived table extends the base table with stable slot indices, overrides replace targets in place, and no pointer adjustment is needed because the base sub-object sits at offset 0.
- **Multiple inheritance** gives an object more than one vptr and more than one sub-object, so a base pointer can be offset from the real object. **Thunks** — tiny stubs that adjust `this` and jump — patch the difference, invisibly to the caller.
- **Interface dispatch is a distinct problem** because interface satisfaction is independent of the class tree. Java uses **itables** (resolved lazily, accelerated by inline caches), Go uses the **itab** inside a two-word interface value (cached by interface/type pair), and C++ folds it into multiple-inheritance vtables.
- vtable and itab calls need **no guard** — the table *is* the dispatch. **Inline caches** do need a guard, because they *speculate* on the type.
- The **guard** is mechanically a pointer comparison: the receiver's class/shape pointer against the cached one. A hit jumps to the cached target; a **miss** re-resolves and updates the cache, often pushing a site from monomorphic toward polymorphic.
- The practical levers: prefer single inheritance plus small interfaces, keep object shapes stable so ICs stay monomorphic, and don't assume base-pointer identity under multiple inheritance.

---

## Diagrams & Visual Aids

### Single vs Multiple Inheritance Object Layout

```text
SINGLE INHERITANCE (Derived : Base):
  ┌──────────────────────────┐
  │ vptr -> Derived vtable    │   one vptr; Base part at offset 0
  │ base fields              │
  │ derived fields           │
  └──────────────────────────┘

MULTIPLE INHERITANCE (C : A, B):
  ┌──────────────────────────┐  <- A* and C* point here (offset 0)
  │ vptr_A -> C's A-vtable    │
  │ A fields                 │
  ├──────────────────────────┤  <- B* points here (offset N)
  │ vptr_B -> C's B-vtable    │
  │ B fields                 │
  └──────────────────────────┘
```

### A Thunk in the B-vtable

```text
   pb (a B*) ──► B-sub-object of C
                    │ vptr_B
                    ▼
              C's B-vtable
              ┌───────────────────────────┐
              │ [0] fb -> thunk_C_fb        │
              └──────────────┬──────────────┘
                             ▼
                    thunk_C_fb:
                        this -= N      (B* -> C*)
                        jmp  C::fb
```

### Go Interface Value and itab

```text
   interface value (2 words)
   ┌──────────────┬──────────────┐
   │ tab  ────────┼──► itab       │      data ──► concrete object
   │ data ────────┼──► object     │
   └──────────────┴──────────────┘
                       │
                       ▼
                 ┌──────────────────────────┐
                 │ inter : *io.Reader         │
                 │ _type : *os.File           │
                 │ hash  : 0x...              │
                 │ fun[0]: os.(*File).Read    │  <- the method
                 └──────────────────────────┘
   r.Read(buf)  =  tab.fun[0](data, buf)
```

### Inline-Cache Guard, Step by Step

```text
   obj.method()  with IC = { Map_M1 -> target_T1 }

        load  map = obj.hiddenClass
        cmp   map, Map_M1            ; the guard
        jne   miss                  ; cache miss path
        call  target_T1             ; FAST: guarded direct call
   miss:
        ; slow generic lookup, then update IC
```

### Class vs Interface Dispatch Side by Side

```text
   CLASS CALL (invokevirtual / C++ virtual):
     vptr -> vtable -> [fixed slot] -> method        (slot index is constant)

   INTERFACE CALL (invokeinterface / Go interface):
     value -> itab/itable -> [interface-relative slot] -> method
     (the itab is found per (type, interface); cached; warm = fast)
```
