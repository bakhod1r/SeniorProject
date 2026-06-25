# Boxing, Tagging & NaN-Boxing — Junior Level

> **Topic:** [Boxing, Tagging & NaN-Boxing](README.md)
> **Focus:** A single slot in memory has to hold *either* a number *or* a pointer to an object — and you must tell which is which without a separate label. How runtimes solve that, starting with the simplest trick: boxing.

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
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [What You Can Build](#what-you-can-build)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)
20. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Why can't a list hold a plain `int`, and what does the runtime do instead?**

Here is a problem that every flexible language quietly solves a hundred times a second. You write `list = [1, "hi", obj]`. The list needs to store three *values* of three different *kinds* in its slots. But a slot is just a fixed number of bytes — typically eight bytes, a single machine word. How does the runtime put the number `1`, a string pointer, and an object pointer all into eight-byte slots **and still remember which is which** when it reads them back later?

If every slot were a raw pointer, the number `1` would have to become a pointer too — to a little object on the heap that says "I am the integer 1." That act of wrapping a plain value into a heap object so it can be pointed at is called **boxing**. Pulling the value back out is **unboxing**. Java does this every time you put an `int` into an `ArrayList<Integer>`. It works, it's simple, and it is also slow: every boxed integer is a separate heap allocation that the garbage collector must track, and reading it means chasing a pointer out into memory.

Because boxing is expensive, language designers invented cleverer tricks. **Pointer tagging** steals a few unused bits of a pointer to mark "this isn't really a pointer, it's a small integer." **NaN-boxing** goes further and hides *everything* — small integers, pointers, `true`, `false`, `null` — inside the spare bits of a floating-point number. These tricks let a runtime store a number directly in the slot, with no heap object at all, while still knowing it's a number and not a pointer.

In one sentence: **a dynamically typed slot must carry both a value and its kind in the same eight bytes, and boxing, tagging, and NaN-boxing are three escalating answers to "how do we fit both?"**

> 🎓 **Why this matters for a junior:** The first time you profile a Java or C# program and discover that 40% of your allocations are boxed `Integer` objects, or you wonder why `Integer.valueOf(127) == Integer.valueOf(127)` is `true` but `128` is `false`, you are staring straight at this topic. Understanding boxing turns a baffling bug into an obvious one — and teaches you why `int[]` crushes `ArrayList<Integer>` on performance.

This page covers: what boxing and unboxing actually are, the cost of boxing (allocation, GC, cache misses), the famous Java autoboxing pitfalls (`==` vs `.equals`, the `Integer` cache, NullPointerExceptions on unboxing), and a first, gentle look at the alternatives — tagging and NaN-boxing — that the higher tiers explore in depth.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a variable, a value, and a pointer (reference) are. You should be able to picture "a slot in memory holds eight bytes."
- **Required:** The difference between a *primitive* (`int`, `double`, `bool`) and an *object/reference* in a language like Java, C#, or Python.
- **Required:** Basic awareness that objects live on the **heap** and the heap is managed by a garbage collector (in managed languages).
- **Helpful but not required:** A rough sense that memory access has a cost and that "pointer chasing" can be slow (we will explain).
- **Helpful but not required:** The idea that a `double` is a 64-bit IEEE-754 floating-point number.

You do **not** need to know:

- How a garbage collector works internally (that's another topic).
- The bit-level layout of IEEE-754 or how NaN is encoded (that's `middle.md` and `senior.md`).
- How CPUs lay out address space or what 5-level paging is (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Primitive / value type** | A value stored directly in its slot: `int`, `double`, `bool`, `char`. No heap object, no pointer. |
| **Reference / object** | A value that lives on the heap; the slot holds a *pointer* to it. |
| **Slot** | A fixed-size storage location — usually one machine word (8 bytes on 64-bit). A variable, an array element, or an object field. |
| **Boxing** | Wrapping a primitive in a heap-allocated object so it can be referenced and treated like any other object. `int 5` → `Integer` object holding 5. |
| **Unboxing** | The reverse: extracting the primitive value back out of the box. |
| **Autoboxing** | The compiler doing boxing/unboxing automatically when you mix primitives and objects (Java, C#). |
| **Heap allocation** | Reserving memory on the heap for a new object. Each box is one of these. |
| **GC pressure** | The extra work the garbage collector does because of many short-lived allocations (like boxes). |
| **Pointer chasing** | Following a pointer to read what it points at — a memory access that may miss the cache. |
| **Cache miss** | When the CPU needs data that isn't in its fast cache and must fetch it from slower main memory. |
| **Tag** | A few bits attached to a value that say what *kind* of value it is. |
| **Pointer tagging** | Using the always-zero low bits of an aligned pointer to store a tag, so a slot can hold "small int" or "real pointer" without a separate field. |
| **SMI** | "Small Integer." V8's name for a tagged small integer stored directly in a slot. |
| **NaN-boxing** | Encoding integers, pointers, and special values inside the unused payload bits of a floating-point NaN, so every value is physically a `double`. |
| **Immediate value** | A value stored directly in the slot with no heap object — the opposite of boxed. |
| **Integer cache** | A pool of pre-made small `Integer` objects (Java caches −128..127) that autoboxing reuses to avoid allocating. |

---

## Core Concepts

### 1. The Core Problem: One Slot, Two Possible Meanings

Imagine you are designing a list that can hold anything. Every element is one machine word — eight bytes. Sometimes that word should mean "the integer 42." Sometimes it should mean "a pointer to a `User` object at heap address `0x7fff...`." When you read a slot back, the *bits look the same* — eight bytes are eight bytes. So how do you know whether to treat them as a number or as an address to follow?

You have three broad strategies:

1. **Make everything a pointer (boxing).** Even the number 42 becomes a tiny heap object. Now every slot is uniformly "a pointer," and the object it points to carries a type tag. Simple, uniform, slow.
2. **Steal spare bits to tag (pointer tagging).** Numbers stay in the slot directly; use a couple of low bits to flag "this is a small int, not a pointer."
3. **Hide everything inside a float (NaN-boxing).** Exploit the fact that a 64-bit `double` has billions of unused bit-patterns (NaNs) and stuff non-float values into them.

This page focuses on strategy 1, because it's the one you meet first as a working programmer — Java and C# do it constantly, often without you asking.

### 2. Boxing: Wrapping a Primitive So It Can Be a Reference

A **box** is a heap object whose only job is to hold one primitive value. In Java:

```text
   int (primitive, 4 bytes, lives in a register or on the stack)
        │  boxing
        ▼
   Integer (object on the heap)
   ┌──────────────────────────┐
   │ object header (~12-16 B)  │
   │ int value: 5              │
   └──────────────────────────┘
        ▲
        │ the slot in your ArrayList holds a POINTER to this
```

The primitive `5` is 4 bytes. The boxed `Integer` holding 5 is a full heap object — an object header *plus* the value, often 16 bytes total, plus the 8-byte pointer that refers to it. You turned 4 bytes of data into ~24 bytes of memory traffic. That is the cost of boxing.

### 3. Why Boxing Is Slow

Boxing hurts in three compounding ways:

- **Allocation cost.** Each box is a heap allocation. Allocating is cheap individually but adds up fast in a loop.
- **GC pressure.** Every box is garbage the collector must eventually find, trace, and free. A loop that boxes a million integers creates a million pieces of short-lived garbage.
- **Cache misses from pointer chasing.** An `int[]` stores its numbers *contiguously* — the CPU can stream them. An `ArrayList<Integer>` stores *pointers* contiguously, and each pointer leads somewhere else in the heap. Reading the values means jumping all over memory, and each jump risks a cache miss. This is often the biggest cost of all.

### 4. The Canonical Comparison: `int[]` vs `ArrayList<Integer>`

This is the single most important practical takeaway of the whole topic:

```text
int[]                          ArrayList<Integer>
┌──┬──┬──┬──┬──┐                ┌──┬──┬──┬──┬──┐
│ 1│ 2│ 3│ 4│ 5│  ← values     │ •│ •│ •│ •│ •│  ← pointers
└──┴──┴──┴──┴──┘                └─┬┴─┬┴─┬┴─┬┴─┬┘
contiguous, cache-friendly        │  │  │  │  │
                                   ▼  ▼  ▼  ▼  ▼
                                  [1][2][3][4][5]  ← scattered boxes
```

The `int[]` is one tight block the CPU loves. The `ArrayList<Integer>` is an array of pointers to scattered boxes — more memory, more allocations, and a cache miss waiting at every element. In tight numeric loops, `int[]` can be **several times faster**. When you need performance, prefer primitive arrays (or specialized libraries like Eclipse Collections / fastutil in Java) over boxed collections.

### 5. Unboxing and Its Famous Trap: the Null Box

Unboxing pulls the primitive back out of the box. In Java, `int x = someInteger;` automatically unboxes. The trap: if the `Integer` is `null`, unboxing it means dereferencing null, which throws a `NullPointerException` — often in a surprising place:

```java
Integer a = null;
int b = a;        // NullPointerException! (autoboxing tries a.intValue())
```

You wrote what looks like a harmless assignment, but the compiler inserted a method call on `null`. This is one of the most common boxing-related bugs.

### 6. A First Look at the Alternatives

Boxing makes *everything* a pointer. The clever alternatives keep small values *in* the slot:

- **Pointer tagging.** Aligned heap pointers always end in a few zero bits (a pointer to an 8-byte-aligned object ends in `000`). Runtimes use those free bits as a tag: "ends in 0 → it's a small integer; ends in 1 → it's a real pointer." V8 (the JavaScript engine in Chrome and Node) calls its tagged small integers **SMIs**. Ruby tags its `Fixnum`, `nil`, `true`, `false`, and symbols this way. The cost: a tagged integer loses a bit of range (a 64-bit slot holds 63- or 62-bit ints, not full 64-bit).
- **NaN-boxing.** A 64-bit `double` has an enormous number of bit patterns that all mean "Not a Number." Runtimes hijack those spare patterns to encode integers, pointers, and `true`/`false`/`null` — so *every value is physically a double*, and arithmetic on real numbers runs at native speed. SpiderMonkey (Firefox), LuaJIT, and JavaScriptCore (Safari) use this.

You don't need the bit-level details yet — `middle.md` and `senior.md` cover them. For now, hold the shape: **boxing puts the value behind a pointer; tagging and NaN-boxing keep the value in the slot and use spare bits to remember its kind.**

### 7. Where You Meet This Daily

- **Java:** `List<Integer>`, `Map<String, Long>`, generics over primitives — all box. `int`, `long`, `double` are primitives; `Integer`, `Long`, `Double` are boxes.
- **C#:** Putting an `int` into an `object` or a non-generic collection boxes it. Generics (`List<int>`) avoid it — a key difference from Java.
- **Python:** *Everything* is an object, including the number `5`. CPython caches small integers (−5 to 256) so they aren't re-allocated.
- **JavaScript:** Engines use SMIs (tagged small ints) or NaN-boxing under the hood, but you never see it — all numbers are conceptually doubles.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **A slot** | A single mailbox slot of fixed size. It can hold one thing. |
| **Primitive in a slot** | Writing the number directly on a card and dropping the card in the slot. |
| **Boxing** | The number is too "different" to file with the objects, so you put it in a little box, label the box, and file *the box* instead. Now everything in the cabinet is a box. |
| **Unboxing** | Opening the box to read the number back. |
| **The box has overhead** | The cardboard box is bigger than the slip of paper inside it. Storing a 1-gram coin in a 50-gram box. |
| **GC pressure** | Every box you throw away has to be picked up later by the cleanup crew. Throw away a million boxes and the crew is overwhelmed. |
| **Pointer chasing / cache miss** | The filing cabinet holds *address cards*; to read a value you must walk to whatever shelf the card points to. Walking across the warehouse for each one is slow. |
| **Pointer tagging** | The address cards have an 8-aligned address, so the last digit is always 0. You agree: "if the last digit is 1, it's not an address — it's a small number written right here." Free information, no extra card. |
| **NaN-boxing** | A check that's been voided ("NaN") can have anything scribbled in its memo line. You agree to write secret codes there — a small number, a locker key — knowing nobody treats a voided check as money. |
| **Integer cache** | The post office keeps pre-made boxes for the numbers people ask for most (−128..127) and hands out the *same* box each time instead of making a new one. |

---

## Mental Models

### The "Box Behind a Pointer" Model

Picture a primitive as a slip of paper with a number on it. To file it among objects, you put the slip in a cardboard box and file the box. The slot in your collection doesn't hold the slip — it holds a string leading to the box. To read the number you follow the string, open the box, read the slip. Every step is overhead: the box's bulk (header), the string (pointer), and the walk to find the box (cache miss). This is boxing, and it explains *every* performance complaint about boxed collections.

### The "Free Bits" Model

A pointer to an 8-byte-aligned object never uses its bottom three bits — they're always zero, because the address is a multiple of 8. Those three bits are *free real estate*. Tagging says: "let me write a tiny label there." Because the label rides along inside the slot, a tagged small integer needs no box, no allocation, no pointer chase. The price is that you sacrifice a little numeric range. Carry this picture: **alignment hands you free low bits; tagging spends them on a type label.**

### The "Everything Is a Double" Model (preview)

Imagine a runtime where *every* value — every integer, every pointer, every `true` — is physically a 64-bit `double`. Real numbers are stored as themselves. Everything else is smuggled inside the vast unused space of NaN bit patterns. The payoff: floating-point math, which dominates JavaScript and Lua, runs with zero unwrapping. The catch: pulling out a pointer requires masking off the NaN-marking bits first. This is NaN-boxing; `senior.md` draws the exact bits.

---

## Code Examples

We'll see boxing's cost and its traps across languages.

### Java — Boxing happens automatically (autoboxing)

```java
import java.util.ArrayList;
import java.util.List;

public class Boxing {
    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            list.add(i);   // AUTOBOXING: int i -> Integer.valueOf(i), a heap object
        }
        int sum = 0;
        for (Integer n : list) {
            sum += n;      // AUTO-UNBOXING: n.intValue()
        }
        System.out.println(sum); // 10
    }
}
```

Every `list.add(i)` silently calls `Integer.valueOf(i)` and stores a pointer to a heap object. Every `sum += n` silently calls `n.intValue()`. The convenience hides the cost.

### Java — The Integer cache and the `==` trap

```java
public class IntegerCache {
    public static void main(String[] args) {
        Integer a = 127, b = 127;
        System.out.println(a == b);        // true  -- same cached object

        Integer c = 128, d = 128;
        System.out.println(c == d);        // false -- two different objects!

        System.out.println(c.equals(d));   // true  -- compares VALUES
    }
}
```

`Integer.valueOf` caches the boxes for −128..127 and hands out the *same* object each time, so `==` (reference identity) is `true`. Outside that range it allocates fresh objects, so `==` is `false`. **Always use `.equals()` to compare boxed values; `==` compares pointers, not numbers.**

### Java — The null-unboxing NullPointerException

```java
import java.util.HashMap;
import java.util.Map;

public class NullUnbox {
    public static void main(String[] args) {
        Map<String, Integer> counts = new HashMap<>();
        int n = counts.get("missing");  // get() returns null -> auto-unbox null -> NPE
        System.out.println(n);
    }
}
```

`counts.get("missing")` returns `null` (the key is absent). Assigning it to `int n` auto-unboxes, which calls `.intValue()` on `null` — a `NullPointerException`, thrown by a line that *looks* like it can't fail.

### C# — Boxing a value type into `object`

```csharp
using System;

class Program {
    static void Main() {
        int x = 42;
        object boxed = x;      // BOXING: int copied onto the heap, boxed holds a reference
        int y = (int)boxed;    // UNBOXING: copy back out

        Console.WriteLine(y);  // 42

        // Boxed copies are independent of the original:
        x = 99;
        Console.WriteLine((int)boxed); // still 42 -- the box has its own copy
    }
}
```

In C#, a `struct` (value type) is boxed when stored in an `object` or a non-generic collection. Critically, **generics avoid this**: `List<int>` stores ints directly, no boxing — unlike Java, where `List<Integer>` always boxes.

### Python — Everything is an object, and small ints are cached

```python
a = 256
b = 256
print(a is b)    # True  -- CPython caches small ints (-5..256)

c = 257
d = 257
print(c is d)    # often False in the REPL -- separate objects

print(c == d)    # True  -- compares VALUES, always correct
```

In CPython, even `5` is a heap object (`PyLongObject`). The interpreter pre-creates the small integers −5 to 256 and reuses them, so `is` (identity) is `True` for those. Outside the cache, identity is not guaranteed. As in Java: **compare values with `==`, never identity with `is`.**

### Go — No autoboxing, but `interface{}` boxes

```go
package main

import "fmt"

func main() {
    var i int = 42
    var any interface{} = i // boxing-like: int stored in an interface value (heap if it escapes)
    n := any.(int)          // type assertion = unboxing
    fmt.Println(n)          // 42
}
```

Go has no Java-style autoboxing, but putting a value into an empty interface (`interface{}` / `any`) is the same idea: the value gains a type tag and may be heap-allocated. Type assertions pull it back out. Same trade-off, different syntax.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Boxing — simplicity** | Uniform: everything is a pointer, the rest of the runtime is simpler. | Slowest of the three strategies. |
| **Boxing — memory** | — | A 4-byte int becomes a ~24-byte footprint (header + value + pointer). |
| **Boxing — speed** | Fine when boxing is rare. | Allocation + GC + cache misses dominate tight numeric loops. |
| **Boxing — caching** | Small-int caches (Java −128..127, Python −5..256) recover some cost and dedupe. | Caches create the `==`/`is` identity surprises. |
| **Tagging — speed** | Small integers stay in the slot: no allocation, no pointer chase. | Loses 1+ bit of integer range; pointers need masking before use. |
| **NaN-boxing — speed** | Native float math, every value in one word, no separate type field. | Intricate bit layout; interacts with CPU address-space and pointer-authentication details. |
| **Developer experience** | Autoboxing makes code read cleanly (`list.add(5)`). | The hidden cost and the identity/NPE traps surprise newcomers. |

---

## Use Cases

Boxing (and its caches) is the right or unavoidable tool when:

- **You're using a generic collection in Java.** `List<Integer>`, `Map<K, Long>` — boxing is mandatory because Java generics don't specialize over primitives.
- **You need to treat a primitive polymorphically.** Pass an `int` where an `Object` is expected, store mixed types together.
- **Convenience outweighs performance.** Glue code, configuration, small data — the boxing cost is irrelevant.

Reach past boxing — to primitive arrays, C# generics, or tagging/NaN-boxing runtimes — when:

- **You have a hot numeric loop.** Use `int[]`/`double[]` or C#'s `List<int>`/`Span<int>`. The difference is often several-fold.
- **You're building a dynamic-language runtime.** Then *you* choose the representation — boxing vs SMI tagging vs NaN-boxing — and the choice shapes the whole VM's speed (the higher tiers explore this).
- **Memory footprint matters at scale.** Millions of boxed integers waste gigabytes versus a primitive array.

---

## Coding Patterns

### Pattern 1: Prefer primitive arrays in hot paths (Java)

```java
// Slow: boxed
List<Integer> values = new ArrayList<>();
// Fast: primitive
int[] values2 = new int[n];
```

When a collection is large and numeric and you control its shape, a primitive array eliminates every box.

### Pattern 2: Always compare boxed values with `.equals` / `==value`, never identity

```java
if (a.equals(b)) { ... }   // Java: correct
```

```python
if c == d:   # Python: correct (value compare)
    ...
# never `if c is d` for number equality
```

### Pattern 3: Guard against null before unboxing (Java)

```java
Integer v = map.get(key);
int n = (v != null) ? v : 0;   // safe; or map.getOrDefault(key, 0)
```

### Pattern 4: Use C# generics to avoid boxing

```csharp
List<int> nums = new();   // no boxing
// not: ArrayList nums (non-generic) -> boxes every int
```

### Pattern 5: Stream primitives, not boxes (Java)

```java
int sum = IntStream.rangeClosed(1, 100).sum();  // IntStream, no boxing
// not: Stream<Integer> ... .reduce(0, Integer::sum)  -> boxes
```

---

## Best Practices

- **Know which of your types box.** In Java, capital-letter wrapper types (`Integer`, `Long`, `Double`) box; lowercase primitives (`int`, `long`, `double`) don't. In C#, `struct → object` boxes; generics don't.
- **Use specialized primitive APIs.** `IntStream`/`LongStream` over `Stream<Integer>`; `int[]` over `List<Integer>`; fastutil / Eclipse Collections for primitive collections.
- **Never rely on `==` / `is` for boxed-number equality.** Use `.equals` (Java) or `==` (Python value compare). The small-int caches make identity *sometimes* work, which is worse than always failing.
- **Treat every auto-unbox as a possible NPE.** Any `int x = someInteger;` where the `Integer` could be null is a latent crash. Prefer `getOrDefault`, `Optional`, or explicit null checks.
- **Measure before assuming boxing matters.** In glue code it's free. In a 10-million-iteration loop it can dominate. Profile, don't guess.
- **Understand your runtime's number representation.** If you write JavaScript, Lua, or Ruby, knowing whether the engine uses SMI tagging or NaN-boxing explains why integer-heavy code is fast and why huge integers or weird values can fall off a fast path.

---

## Edge Cases & Pitfalls

- **The `Integer` cache boundary at 128.** `Integer a = 127, b = 127; a == b` is `true`; at `128` it's `false`. Pure identity accident; never depend on it.
- **`Long` has a cache too.** Java caches `Long.valueOf(−128..127)` exactly like `Integer`. Same trap.
- **Null unboxing throws.** `int x = nullableInteger;` is a `NullPointerException` factory. The most surprising NPE in Java for beginners.
- **`==` between `Integer` and `int` unboxes the `Integer`.** Mixing the two in a comparison silently unboxes — which can *also* NPE if the boxed side is null.
- **Boxed values copy in C#.** `object boxed = x;` makes an independent copy; later changes to `x` don't affect `boxed`. Surprises people who expect reference semantics.
- **Python's `is` on small ints "works" then mysteriously stops.** `256 is 256` → `True`, `257 is 257` → often `False`. The cache boundary, not a language guarantee.
- **Hidden boxing in generics/streams.** `Stream<Integer>`, `Map<Integer, ...>`, lambdas capturing primitives — boxing sneaks in where you didn't write it.
- **Tagged small ints have reduced range (preview).** A runtime using 1-bit tagging stores 63-bit, not 64-bit, integers. Numbers near the limit may silently promote to a boxed "big" representation.

---

## Common Mistakes

1. **Comparing boxed numbers with `==` (Java) or `is` (Python).** Works for small cached values, fails for large ones. A classic intermittent bug.
2. **Assigning a possibly-null `Integer` to an `int`.** Auto-unboxing null → NPE.
3. **Using `ArrayList<Integer>` for a large numeric workload.** Boxing tax in memory and speed where `int[]` would fly.
4. **Assuming C# collections box like Java's.** They don't — `List<int>` is unboxed. Carrying Java intuition to C# misleads.
5. **Thinking Python `int` is a primitive.** It's a full heap object; the small-int cache is the only reason identity ever holds.
6. **Mutating after boxing in C# and expecting the box to change.** The box is a snapshot copy.
7. **Ignoring boxing in hot lambdas/streams.** A `Stream<Integer>` in a critical loop quietly allocates millions of boxes.
8. **Believing all of this is "just an optimization detail."** The identity and null traps are *correctness* bugs, not just performance ones.

---

## Test Yourself

1. Why can't an `ArrayList` in Java store a raw `int` directly? What does it store instead?
2. Predict the output: `Integer a = 100, b = 100; System.out.println(a == b);` and the same with `200`. Explain the difference.
3. Write a Java snippet that throws a `NullPointerException` from a line that looks like a plain integer assignment.
4. In C#, does `List<int>` box its elements? Does putting an `int` into an `object` box it? Why the difference?
5. In Python, why is `256 is 256` often `True` but `1000 is 1000` often `False`? Which operator should you use for value equality?
6. Draw the memory difference between `int[5]` and `ArrayList<Integer>` of size 5. Which is cache-friendly, and why?
7. A pointer to an 8-byte-aligned object always ends in three zero bits. How could a runtime use those bits, and what would it cost?
8. One sentence each: what is boxing, what is pointer tagging, what is NaN-boxing?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              BOXING / TAGGING / NaN-BOXING (JUNIOR)               │
├──────────────────────────────────────────────────────────────────┤
│ The problem: one 8-byte slot must hold a NUMBER or a POINTER,     │
│ and you must tell which without a separate type field.            │
├──────────────────────────────────────────────────────────────────┤
│ BOXING      wrap primitive in a heap object; slot holds a pointer │
│             + simple, uniform                                     │
│             - allocation + GC + cache misses (pointer chasing)    │
│ TAGGING     keep small int IN the slot; use free low bits as tag  │
│             + no allocation; - loses 1+ bit of range              │
│ NaN-BOXING  hide ints/ptrs/true/false/null inside double's NaN    │
│             + native float math; - intricate bit layout           │
├──────────────────────────────────────────────────────────────────┤
│ Java        Integer/Long/Double box; int/long/double don't.       │
│             Cache −128..127 → == surprises. Null unbox → NPE.      │
│ C#          struct→object boxes; generics (List<int>) don't.      │
│ Python      EVERYTHING is an object; small ints −5..256 cached.   │
│ JS/Lua/Ruby SMI tagging or NaN-boxing under the hood.             │
├──────────────────────────────────────────────────────────────────┤
│ RULES OF THUMB                                                    │
│  * compare boxed numbers with .equals / == value, never identity  │
│  * never auto-unbox a value that might be null                    │
│  * use int[] / List<int> / IntStream in hot numeric paths         │
│  * int[] is contiguous & fast; ArrayList<Integer> chases pointers │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **dynamically typed slot** (a variable, array element, or field) must hold either a primitive value or a reference, and the runtime must know which — without a separate type field.
- **Boxing** solves this by making everything a pointer: a primitive is wrapped in a heap object so it can be referenced and treated polymorphically. **Unboxing** extracts it back.
- Boxing is **slow** for three reasons: heap allocation, GC pressure, and cache misses from pointer chasing. The canonical lesson is `int[]` (contiguous, fast) versus `ArrayList<Integer>` (pointers to scattered boxes, slow).
- **Java autoboxing** has famous traps: `Integer` identity `==` vs `.equals`, the **−128..127 Integer cache** (and the `Long` cache), and **NullPointerExceptions** when auto-unboxing a `null`.
- **C#** boxes value types only when needed (`struct → object`); generics like `List<int>` and `Span<int>` avoid it — a key contrast with Java.
- **Python** makes *everything* an object, caching small integers −5..256, which is why `is` sometimes "works" for numbers.
- The cleverer alternatives keep values **in the slot**: **pointer tagging** spends an aligned pointer's free low bits on a type tag (V8 SMIs, Ruby Fixnum, OCaml ints), and **NaN-boxing** hides every value inside a double's spare NaN bits (SpiderMonkey, LuaJIT, JavaScriptCore).
- A junior's #1 habit: when you see boxed numbers in a hot path or compared with `==`/`is`, **suspect a performance or correctness bug.**

---

## What You Can Build

- **A boxing-cost benchmark.** Sum a million numbers stored in an `int[]` versus an `ArrayList<Integer>`. Measure time and allocations. Chart the gap.
- **An Integer-cache explorer.** Loop `i` from −200 to 200; for each, check whether `Integer.valueOf(i) == Integer.valueOf(i)`. Print where identity flips. Find the −128 and 127 boundaries empirically.
- **A null-unbox fuzzer.** Write a program that auto-unboxes values from a map with missing keys, and demonstrate every place an NPE can hide.
- **A Python small-int cache mapper.** Find experimentally the lowest and highest integers for which `n is n` (constructed two ways) holds. Confirm the −5..256 range.
- **A "tag the pointer" toy.** In C, allocate 8-byte-aligned objects, confirm their addresses end in `000`, and store a 1-bit "is-small-int" tag in the low bit. Mask it off before dereferencing.

---

## Further Reading

- *Effective Java* — Joshua Bloch. Item 61 ("Prefer primitive types to boxed primitives") is the definitive practical treatment.
- *Java Language Specification* — §5.1.7 (Boxing Conversion) and §5.1.8 (Unboxing Conversion).
- *CLR via C#* — Jeffrey Richter. The chapter on boxing/unboxing in the .NET runtime.
- *CPython internals* — the `Objects/longobject.c` small-integer cache (`_PyLong_GetSmall`), and "Inside the Python Virtual Machine."
- *Crafting Interpreters* — Robert Nystrom. The "Optimization" chapter introduces NaN-boxing with clear diagrams.
- *V8 blog* — "Pointer Compression" and the SMI representation posts.
- *The fastutil and Eclipse Collections* documentation — primitive collections that avoid boxing in the JVM.

---

## Related Topics

- This folder, next levels: [`middle.md`](middle.md), [`senior.md`](senior.md), [`professional.md`](professional.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling topics in this section: floating-point representation, integer representation, and memory layout live alongside this folder under `data-representation-and-numerics/`.
- Cross-cutting context: garbage collection and heap allocation under `language-internals/`; cache behavior and pointer chasing under the CPU/memory topics.

---

## Diagrams & Visual Aids

### The Core Problem: One Slot, Two Meanings

```text
        a single 8-byte slot
        ┌───────────────────────────┐
        │ 0x000000000000002A         │
        └───────────────────────────┘
                    │
        is this... the number 42?
        ...or a pointer to address 0x2A?
                    │
        Without a tag, you cannot tell.
        Boxing / tagging / NaN-boxing each answer this.
```

### Boxing: The Slot Holds a Pointer to a Box

```text
   your collection slot          the heap
   ┌──────────────┐              ┌──────────────────────┐
   │  pointer  ●──┼─────────────▶│ object header        │
   └──────────────┘              │ int value: 42        │
                                 └──────────────────────┘
   read 42  =  follow pointer (cache miss) + skip header + read value
```

### `int[]` vs `ArrayList<Integer>`

```text
int[]  (values inline, contiguous):
┌────┬────┬────┬────┬────┐
│ 10 │ 20 │ 30 │ 40 │ 50 │   ← CPU streams this; cache-friendly
└────┴────┴────┴────┴────┘

ArrayList<Integer>  (pointers to scattered boxes):
┌────┬────┬────┬────┬────┐
│ ●  │ ●  │ ●  │ ●  │ ●  │
└─┬──┴─┬──┴─┬──┴─┬──┴─┬──┘
  ▼    ▼    ▼    ▼    ▼
[10] [20] [30] [40] [50]      ← scattered; a cache miss per element
```

### The Three Strategies at a Glance

```text
BOXING        slot = pointer ──▶ [ box: value ]        (everything on heap)
TAGGING       slot = value with tag bits               (small int stays inline)
              ...01010  → low bits say "small int"
NaN-BOXING    slot = a double; non-floats hidden in NaN payload
              [ NaN marker | tag | 48-bit payload ]
```

### The Integer Cache (Java −128..127)

```text
Integer.valueOf(n):
   n in −128..127 ?
        │ yes               │ no
        ▼                   ▼
   return SHARED cached    allocate a NEW Integer
   object (== is true)     object (== is false)
```
