# Method Dispatch & Inline Caches — Junior Level

> **Topic:** [Method Dispatch & Inline Caches](README.md)
> **Focus:** When you write `obj.method()`, how does the machine actually find the code to run? And why is that question harder than it looks?

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

> Focus: **What does `obj.method()` compile down to?** And **why is "just call the method" not as simple as it sounds?**

When you write `total.add(5)` or `animal.speak()`, you are asking the machine to do one specific thing: **find the right block of machine code and jump to it.** That act — finding the target of a call — is called **method dispatch**. It sounds trivial. For a plain function like `sqrt(2.0)`, it *is* trivial: the compiler knows exactly where `sqrt` lives, and it bakes the address directly into the call instruction. One jump, done. This is **static dispatch** (also called direct dispatch).

The trouble starts the moment the target depends on the *type of the object at runtime*. Consider `animal.speak()`. If `animal` might be a `Dog`, a `Cat`, or a `Cow`, the machine cannot know at compile time which `speak` to call — `Dog.speak` and `Cat.speak` are different blocks of code. It has to look at the actual object *while the program is running*, discover its real type, and then jump to the matching method. This is **dynamic dispatch** (also called virtual dispatch), and it is the beating heart of polymorphism — the feature that lets one line of code (`animal.speak()`) drive many different behaviors.

In one sentence: **method dispatch is the lookup step that turns a method name into a concrete piece of code to run, and the central question is "how much of that lookup can we do ahead of time, and how much must we do live?"**

> 🎓 **Why this matters for a junior:** Every object-oriented language you will ever use — Java, C++, Python, JavaScript, C#, Go, Ruby — leans on dynamic dispatch constantly. Understanding the *cost* of that lookup, even at a basic level, is what separates "I wrote code that works" from "I wrote code that's fast." A surprising amount of real-world performance tuning comes down to: *was this call dispatched directly, or did the machine have to go hunting?*

This page covers: the difference between static and dynamic dispatch, the **vtable** (the table of function pointers that makes virtual calls fast in compiled languages), the slow "search up the chain" lookup that dynamic languages like Python and JavaScript do, and the clever trick — the **inline cache** — that those languages use to make repeated calls fast. The next level (`middle.md`) goes deeper on vtable layout and interface dispatch; `senior.md` covers polymorphic inline caches and devirtualization; `professional.md` covers the JIT, megamorphic call sites, and real engine internals.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a function/method is, and how to call one in at least one language.
- **Required:** The basic idea of a class, an object (instance), and a method that belongs to a class.
- **Required:** The idea of inheritance — a `Dog` "is an" `Animal` and can override `Animal`'s methods.
- **Helpful but not required:** What a *pointer* is — an address that points at something in memory.
- **Helpful but not required:** A vague sense that code lives at addresses in memory, just like data does.

You do **not** need to know:

- How a CPU pipeline or branch predictor works (that's `senior.md` and `professional.md`).
- What a JIT compiler is in detail (touched on in `professional.md`).
- The exact byte layout of a vtable or itable (that's `middle.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Method dispatch** | The act of finding which concrete block of code a method call should jump to. |
| **Static dispatch** | The target is known at compile time. The compiler bakes the address into the call. Also called *direct dispatch* or *early binding*. |
| **Dynamic dispatch** | The target depends on the object's runtime type and must be resolved while the program runs. Also called *virtual dispatch* or *late binding*. |
| **Polymorphism** | One piece of code (`animal.speak()`) producing different behavior depending on the actual object. Dynamic dispatch is the mechanism that implements it. |
| **Virtual method** | A method that can be overridden by subclasses, and so requires dynamic dispatch. (In C++ you mark it `virtual`; in Java most methods are virtual by default.) |
| **vtable (virtual table)** | A per-class table of function pointers. Each object carries a hidden pointer to its class's vtable; a virtual call indexes into it. |
| **vptr** | The hidden pointer, stored inside each object, that points to its class's vtable. |
| **Receiver** | The object on the left of the dot: in `animal.speak()`, `animal` is the receiver. |
| **Call site** | A specific location in the code where a call happens, e.g. the exact `animal.speak()` on line 42. |
| **Method lookup** | In dynamic languages, the runtime search for a method by name — walking the object's class and its parents. |
| **Prototype chain** | In JavaScript, the chain of objects searched to resolve a property or method. |
| **MRO (Method Resolution Order)** | In Python, the ordered list of classes searched to find a method. |
| **Inline cache (IC)** | A small cache attached to a call site that remembers "last time, the object was type X and the method was at address Y," so a repeat call can skip the search. |
| **Monomorphic** | A call site that, in practice, only ever sees one type of object. The happy, fast case. |
| **Hidden class / shape** | The runtime's internal descriptor of an object's structure, used as the "key" that an inline cache checks against. |

---

## Core Concepts

### 1. Two Ways to Find a Method

Every method call is answered in one of two fundamental ways.

**Static dispatch.** The compiler already knows the exact target. A free function `sqrt(x)`, a `private` method, a `final` method, a non-virtual C++ method, a Go function call — all of these resolve to a fixed address at compile time. The generated machine code is essentially `call 0x4011a0`. This is as cheap as a call gets: one jump, and the CPU's branch predictor handles it beautifully because the target never changes.

**Dynamic dispatch.** The compiler does *not* know the target, because it depends on the runtime type of the receiver. `animal.speak()` where `animal` is declared as `Animal` but might actually be a `Dog` or a `Cat`. The machine must, at runtime, ask the object "what are you, really?" and then jump to the matching method. This is more expensive, and the rest of this topic is largely about *how* runtimes make it fast.

### 2. The vtable: How Compiled Languages Do It Fast

In C++, Java, C#, and similar languages, dynamic dispatch is implemented with a **vtable** — a virtual method table.

Here is the trick. Every class with virtual methods gets, at compile/link time, one shared table: an array of function pointers, one slot per virtual method. `Animal`'s vtable has a slot for `speak`. `Dog`'s vtable also has a slot for `speak` *at the same index*, but it points at `Dog::speak` instead of `Animal::speak`.

Every object carries a hidden pointer — the **vptr** — to its class's vtable. So a `Dog` object's vptr points at `Dog`'s vtable; a `Cat` object's vptr points at `Cat`'s vtable.

Now the magic. The call `animal->speak()` becomes, roughly:

```text
1. vptr   = animal->__vptr        // load the hidden pointer (one memory read)
2. target = vptr[INDEX_OF_speak]  // load the function pointer (one memory read)
3. call target                    // jump to it (one indirect call)
```

The compiler knows `speak` is, say, slot 0 in *every* `Animal`-family vtable — that index is fixed at compile time. So the only runtime work is: follow the vptr, read the slot, jump. Two memory loads and an indirect call. Fast, constant-time, and it works no matter how many subclasses exist. **This is the single most important mechanism in this whole topic.**

### 3. Why Dynamic Languages Are Different (and Slower by Default)

Python, JavaScript, and Ruby don't have a fixed vtable laid out at compile time, because their objects can change shape at runtime — you can add a method to a class, attach a field to a single object, or rewire inheritance on the fly. There's no compile step that can freeze a vtable.

So how do they find `obj.method()`? Naively, by **searching**:

- **Python** looks at the object, then walks its class's **MRO** (Method Resolution Order) — an ordered list of the class and all its parents — checking each one's dictionary for an attribute named `method`.
- **JavaScript** walks the **prototype chain**: it checks the object itself, then the object's prototype, then *that* prototype, and so on up the chain, looking for a property named `method`.
- **Ruby** walks its class's ancestor chain, checking each class's method table.

Each step is a hash-table (dictionary) lookup. A few of those per call, every single call, is slow — far slower than the vtable's "two loads and a jump." If you called `obj.method()` a million times in a loop, naively you'd do that whole search a million times, even though the answer is *the same every time*.

### 4. The Inline Cache: Remembering the Answer

Here's the key insight that makes dynamic languages fast: **at any given call site, the object is almost always the same type as it was last time.** The `obj.method()` on line 42 sees `Account` objects on iteration 1, iteration 2, iteration 3... essentially always `Account`.

So the runtime adds a tiny memo *at the call site* — an **inline cache** (IC). The first time the line runs, it does the slow search, finds the answer, and writes down: *"if the object's type is `Account`, the method is at address `0xABC`."* On every later run, it does a quick check — *"is this object still an `Account`?"* — and if yes (the common case), it jumps straight to `0xABC`, skipping the entire search.

That quick check is called the **guard**. The guard compares the object's runtime type descriptor (its **hidden class** or **shape**) against the cached one. A pointer comparison and a branch — cheap. If the guard passes, you've turned a multi-step dictionary search into something almost as fast as a vtable call. This is why modern JavaScript and Python are far faster than a naive interpreter would be.

A call site that always sees one type is called **monomorphic** — "one shape." That's the case inline caches love.

### 5. Putting It Together

Static dispatch is the fastest (no lookup at all). The vtable makes dynamic dispatch in compiled languages nearly as fast (a couple of loads). And the inline cache lets dynamic languages *approach* vtable speed for the common case where a call site keeps seeing the same type. The whole field is a story of **turning a search into a jump** — and the more predictable your types are at each call site, the better that trick works. The reverse — call sites that see many different types — is where things get slow, which is a major theme of the senior and professional pages.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Static dispatch** | Calling a coworker whose extension you've memorized — you dial directly, no looking up. |
| **Dynamic dispatch** | Calling "the on-call engineer" — you don't know who that is until you check the rota, *then* you dial. |
| **vtable** | A speed-dial sheet taped to each phone. Slot 1 is always "manager," slot 2 always "support" — but *whose* number is in slot 1 depends on which office's phone you're using. |
| **vptr** | The little label on the phone telling you *which* speed-dial sheet belongs to it. |
| **Method lookup (dynamic langs)** | Looking someone up in a paper phone book, then, if not found, in the next town's phone book, and the next — a chain of searches. |
| **Inline cache** | A sticky note next to a specific phone: "Last time I called 'on-call,' it was Priya at ext. 204." You glance at the note, confirm it's still Priya's shift, and dial 204 — no rota check. |
| **The guard** | Glancing at the rota *just enough* to confirm "yep, still Priya" before trusting the sticky note. |
| **Monomorphic call site** | A phone where 'on-call' has been the same person all week — the sticky note is always right. |
| **Polymorphic call site** | A phone where 'on-call' rotates among three people — the one sticky note keeps being wrong, so you keep a tiny list of three. |

---

## Mental Models

### The "Search vs Jump" Model

Hold this in your head: **every method dispatch is somewhere on a spectrum from "pure jump" to "pure search."** Static dispatch is a pure jump (zero search). A vtable call is a jump with a tiny bit of indirection (follow a pointer, read a slot). Naive dynamic lookup is a search (walk a chain of dictionaries). An inline cache is the runtime's attempt to **move a call from the search end of the spectrum to the jump end** by remembering the answer. Almost everything in this topic is a technique for sliding calls toward "jump."

### The "Same Phone, Different Sheet" Model (for vtables)

The reason the vtable trick works is that the *index* is fixed but the *table* varies. Picture a hundred identical phones, each with a speed-dial sheet. "Slot 0 = speak" is true on every phone. But the sheet on the `Dog` phone has `Dog::speak` in slot 0, and the sheet on the `Cat` phone has `Cat::speak` in slot 0. The caller doesn't need to know which animal it has — it just says "dial slot 0," and the object's own sheet (via its vptr) routes it correctly. That's polymorphism in one image.

### The "Sticky Note with a Guard" Model (for inline caches)

An inline cache is a sticky note that says "type X → address Y," plus a habit of double-checking the type before trusting it. The double-check (the guard) is cheap. The note is right almost every time. When it's wrong, you peel it off, do the slow search once, and write a fresh note. This "guess fast, verify cheaply, fall back rarely" pattern is one of the most important ideas in all of runtime engineering — you'll see it again in branch prediction, caching, and speculative optimization.

---

## Code Examples

### Static vs Dynamic Dispatch in C++

```cpp
#include <cstdio>

struct Animal {
    // NOT virtual: statically dispatched. Always calls Animal::name.
    const char* name() { return "animal"; }
    // virtual: dynamically dispatched through the vtable.
    virtual void speak() { printf("...\n"); }
    virtual ~Animal() = default;
};

struct Dog : Animal {
    void speak() override { printf("Woof\n"); }
};

void make_it_speak(Animal* a) {
    a->speak();   // DYNAMIC: vtable lookup. Could be Dog::speak or Animal::speak.
    a->name();    // STATIC: always Animal::name, even for a Dog. Bound at compile time.
}

int main() {
    Dog d;
    make_it_speak(&d);   // prints "Woof" — speak() found Dog via the vtable
}
```

`speak()` is `virtual`, so the call goes through `d`'s vtable and finds `Dog::speak`. `name()` is *not* virtual, so even though `d` is really a `Dog`, the compiler statically binds to `Animal::name`. This single example shows the whole static/dynamic split in one function.

### What the vtable Call Becomes (pseudo-assembly)

```text
; a->speak()  where speak is virtual method at slot 0
mov  rax, [rdi]          ; rax = a->vptr        (load the hidden pointer)
mov  rax, [rax + 0]      ; rax = vptr[0]        (load slot 0 = the speak target)
call rax                 ; jump to it           (indirect call)
```

Two loads and an indirect `call`. Compare with a static call, which is a single `call <fixed address>`. That extra indirection is the entire runtime cost of a virtual call in C++ — usually a handful of cycles when the branch predictor cooperates.

### Dynamic Lookup in Python (conceptual)

```python
class Animal:
    def speak(self): return "..."

class Dog(Animal):
    def speak(self): return "Woof"

d = Dog()
print(d.speak())   # "Woof"

# What Python does, roughly, to resolve d.speak:
#   1. Is "speak" an attribute on the instance d's __dict__?  No.
#   2. Walk type(d).__mro__ = [Dog, Animal, object]
#   3. Is "speak" in Dog.__dict__?  Yes -> use Dog.speak
print(Dog.__mro__)   # (<class 'Dog'>, <class 'Animal'>, <class 'object'>)
```

`Dog.__mro__` is the **Method Resolution Order**: the exact ordered list Python searches. For `speak`, it stops at `Dog`. For a method only defined on `Animal`, it would search `Dog` (miss), then `Animal` (hit). Each step is a dictionary lookup. Without caching, this search happens on *every* call.

### Why Naive Lookup Is Slow (and why caching helps)

```python
class Account:
    def balance(self): return 100

# A hot loop calling the same method on the same type a million times.
acc = Account()
total = 0
for _ in range(1_000_000):
    total += acc.balance()   # SAME type, SAME method, every iteration
```

Naively, every one of the million iterations re-walks `Account`'s MRO to find `balance`. But the answer never changes! A modern Python (3.12+ has specializing adaptive interpreter ICs) or a JIT like PyPy will cache the resolved method at this call site after the first iteration, guard on "is the object still an `Account`?", and skip the search. That's the inline cache earning its keep.

### Monomorphic vs Polymorphic in JavaScript (conceptual)

```javascript
function getX(point) {
  return point.x;          // property access — also uses an inline cache!
}

// MONOMORPHIC: every call sees the same shape {x, y}. Fast.
for (let i = 0; i < 1e6; i++) {
  getX({ x: i, y: 0 });
}

// POLYMORPHIC / MEGAMORPHIC: many different shapes through one call site. Slow.
const shapes = [{ x: 1 }, { x: 1, y: 2 }, { a: 0, x: 3 }, { x: 4, z: 9 }, /* ... */];
for (const s of shapes) {
  getX(s);                 // the IC at `point.x` keeps missing -> degrades
}
```

The first loop keeps the `point.x` call site **monomorphic** — one shape — so V8's inline cache nails it every time. The second loop feeds many object shapes through the same site, so the cache can't settle on one answer and the access gets slow. Note that **property access** (`point.x`), not just method calls, is cached this way.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Static dispatch** | Fastest possible call. Perfectly predictable for the CPU. Can be inlined by the compiler. | No polymorphism — the target is frozen. Can't override behavior at runtime. |
| **vtable dynamic dispatch** | Constant-time regardless of subclass count. Enables polymorphism. Cheap (two loads + a jump). | Slightly slower than static. Blocks inlining unless the compiler can prove the target. One extra word (vptr) per object. |
| **Naive dynamic lookup** | Maximum flexibility — classes and objects can change shape at runtime. | Slow: a dictionary search (or several) per call. Unacceptable in hot loops without caching. |
| **Inline caches** | Turn the slow search into a near-vtable-speed guarded jump for the common (monomorphic) case. | Add complexity. Degrade badly when a call site sees many types (polymorphic/megamorphic). |

---

## Use Cases

Understanding dispatch matters when:

- **You're writing performance-sensitive object-oriented code.** Knowing that a virtual call costs more than a static one — and far more when it can't be inlined — guides where you put hot paths.
- **You're choosing a class design.** Marking a method `final` (Java) or `sealed` (C#/Kotlin), or making a function non-virtual (C++), can let the compiler use the fast static path.
- **You're profiling a dynamic-language hot loop.** A loop that's mysteriously slow is often slow because a call site went *megamorphic* — many types flowing through one spot, defeating the inline cache.
- **You're learning how runtimes work.** Dispatch is one of the first things any runtime engineer studies, because it's on the critical path of nearly every program.

You don't need to think about dispatch when:

- The code isn't hot (runs rarely). Clarity beats micro-optimization there.
- You're in a tight numeric loop with no method calls at all.

---

## Coding Patterns

### Pattern 1: Keep a hot call site type-stable (monomorphic)

```javascript
// GOOD: the array holds one shape, so `p.x` stays monomorphic.
const points = makePoints();           // all {x, y}
let sum = 0;
for (const p of points) sum += p.x;    // IC stays happy

// RISKY: mixing many object shapes through the same hot access defeats the IC.
```

The junior takeaway: **in hot loops, feed one type through a given call site.** Type-stable collections keep inline caches monomorphic.

### Pattern 2: Mark methods non-overridable when they truly are

```java
public final class Money {           // final class -> methods can be devirtualized
    public final long cents() { ... } // final method -> compiler may bind statically
}
```

`final` is a hint that the compiler and JIT can use to skip dynamic dispatch and even inline the call. Use it when a method genuinely shouldn't be overridden — it's both clearer and faster.

### Pattern 3: Don't fear virtual calls — fear *unpredictable* ones

A virtual call that always lands on the same target is cheap (the branch predictor and inline cache handle it). The expensive case is the call site that jumps all over the place. Design for predictability, not for zero virtual calls.

---

## Best Practices

- **Default to clear code; optimize dispatch only where it's hot.** A virtual call in cold code costs nothing meaningful. Profile first.
- **Keep hot call sites monomorphic.** If a loop calls `x.foo()` a million times, try to make sure `x` is the same type each time. This is the single biggest inline-cache lever you control.
- **Use `final`/`sealed`/non-virtual when a method shouldn't be overridden.** It documents intent *and* unlocks the fast path.
- **Prefer homogeneous collections in hot paths.** A `List<Dog>` iterated and `.speak()`-ed is faster than a `List<Animal>` holding a wild mix, because the call site stays type-stable.
- **Don't prematurely de-virtualize by hand.** Don't replace clean polymorphism with `if/else` type switches "for speed" without measuring — modern runtimes optimize the polymorphism for you, and your manual version is often slower *and* uglier.

---

## Edge Cases & Pitfalls

- **"Virtual is always slow" is a myth.** A predictable virtual call is only a few cycles more than a static one, and the JIT often inlines it away entirely. The real cost is *unpredictable* dispatch.
- **Calling a virtual method in a constructor/destructor.** In C++, during construction the object's vptr points at the *base* class's vtable, so a virtual call in a constructor does *not* reach the derived override. This surprises everyone once.
- **Non-virtual methods don't dispatch dynamically — even on a derived object.** In the C++ example, `a->name()` calls `Animal::name` even when `a` is really a `Dog`. If you expected the override, you forgot `virtual`.
- **The hidden vptr costs a word per object.** Tiny objects with virtual methods carry an extra pointer. Usually negligible, occasionally relevant for huge arrays of tiny objects.
- **Adding a method to a class at runtime (Python/JS/Ruby) can invalidate inline caches.** It's flexible, but it forces caches to be thrown away and rebuilt — a hidden cost of monkey-patching in a hot path.
- **A single "weird" object can pollute a hot call site.** In JS, feeding even occasionally-different shapes through a hot property access can knock its inline cache out of the fast monomorphic state.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                 METHOD DISPATCH — THE BASICS                     │
├──────────────────────────────────────────────────────────────────┤
│ STATIC dispatch    target known at compile time -> direct call   │
│                    (free functions, final/private, non-virtual)  │
│ DYNAMIC dispatch   target depends on runtime type -> look it up  │
│                    (virtual/overridable methods, polymorphism)   │
├──────────────────────────────────────────────────────────────────┤
│ COMPILED langs (C++/Java/C#):  vtable                            │
│   obj.method()  ->  vptr = obj->__vptr                           │
│                     target = vptr[slot]                          │
│                     call target           (2 loads + a jump)     │
├──────────────────────────────────────────────────────────────────┤
│ DYNAMIC langs (Python/JS/Ruby):  search then cache               │
│   naive   = walk MRO / prototype chain / ancestor list (slow)    │
│   cached  = inline cache: remember (type -> target) at the site  │
│             guard: "still the same type?"  yes -> jump           │
├──────────────────────────────────────────────────────────────────┤
│ MONOMORPHIC call site = sees one type   -> IC is fast & happy    │
│ POLYMORPHIC call site = sees a few      -> small cache, ok       │
│ MEGAMORPHIC call site = sees many       -> cache gives up, slow  │
├──────────────────────────────────────────────────────────────────┤
│ Junior levers:                                                   │
│   * keep hot call sites type-stable (monomorphic)                │
│   * use final/sealed/non-virtual where appropriate               │
│   * prefer homogeneous collections in hot loops                  │
│   * profile before optimizing dispatch                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Method dispatch** is the step that turns a method *name* into a concrete block of code to jump to.
- **Static dispatch** resolves the target at compile time — one direct jump, the fastest case. **Dynamic dispatch** resolves it at runtime based on the object's real type — the mechanism behind polymorphism.
- Compiled languages implement dynamic dispatch with a **vtable**: each object has a hidden **vptr** to its class's table of function pointers, and a call becomes "follow the vptr, read the fixed slot, jump." Two loads and an indirect call.
- Dynamic languages (Python, JavaScript, Ruby) can't freeze a vtable, so they **search** — walking the MRO, the prototype chain, or the ancestor list — which is slow if done on every call.
- The fix is the **inline cache**: a memo at each call site that records "this type → this target," protected by a cheap **guard** that re-checks the type. The common case (same type every time) becomes a guarded jump instead of a search.
- A call site that sees one type is **monomorphic** (fast). The more types a single call site sees, the worse caching works — a theme the senior and professional pages develop.
- The unifying idea: **dispatch optimization is about turning a search into a jump**, and your biggest lever as a programmer is keeping hot call sites type-stable.

---

## Diagrams & Visual Aids

### Static vs Dynamic Dispatch

```text
STATIC (direct):
   call site:  sqrt(x)
   compiled:   call 0x4011a0      <- address baked in, never changes

DYNAMIC (virtual):
   call site:  animal.speak()
   compiled:   load  vptr  = animal->__vptr
               load  target = vptr[slot_of_speak]
               call  target                  <- depends on the real object
```

### The vtable Picture

```text
   Dog object            Dog vtable
  ┌───────────┐         ┌─────────────────────┐
  │ vptr  ────┼────────►│ [0] -> Dog::speak    │
  │ name      │         │ [1] -> Animal::eat   │  (inherited, not overridden)
  │ age       │         │ [2] -> Dog::fetch    │
  └───────────┘         └─────────────────────┘

   Cat object            Cat vtable
  ┌───────────┐         ┌─────────────────────┐
  │ vptr  ────┼────────►│ [0] -> Cat::speak    │  <- same slot 0, different target
  │ name      │         │ [1] -> Animal::eat   │
  └───────────┘         └─────────────────────┘

   "Call slot 0" works for both — the object's own vptr routes it.
```

### Naive Dynamic Lookup (the slow path)

```text
   obj.speak()  in Python:

   obj.__dict__         has "speak"?  no
        │
        ▼
   Dog.__dict__         has "speak"?  YES  -> done   (each box = a dict lookup)
        │ (if no...)
        ▼
   Animal.__dict__      has "speak"?  ...
        │
        ▼
   object.__dict__      has "speak"?  ...
```

### Inline Cache: Guess Fast, Verify Cheap

```text
   call site:  obj.speak()
   ┌──────────────── inline cache ────────────────┐
   │  cached type:   Account                       │
   │  cached target: 0xABC (Account.speak)         │
   └───────────────────────────────────────────────┘
                       │
       guard: is obj's type == Account?
                  │              │
                 YES            NO  (cache miss)
                  │              │
            jump 0xABC       do slow search once,
            (fast!)          rewrite the cache
```

### The Monomorphic → Megamorphic Slide

```text
   types seen at one call site:

   MONOMORPHIC   [ Account ]                     -> guard + jump        (fast)
   POLYMORPHIC   [ Account, Savings, Checking ]  -> tiny cache of cases (ok)
   MEGAMORPHIC   [ A, B, C, D, E, F, G, ... ]    -> cache gives up      (slow)

   Keep hot call sites on the left.
```
