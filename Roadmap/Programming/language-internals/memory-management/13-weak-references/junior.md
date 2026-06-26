# Weak References — Junior Level
> **Topic:** [Weak References](README.md)
> **Focus:** What a weak reference is, why it exists, and how it differs from a normal reference.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

When you write `user = account.owner` in almost any language, you create a **strong reference**: as long as some variable, field, or collection holds that reference, the garbage collector (GC) is forbidden from reclaiming the object. The reference *keeps the object alive*. This is the default, and it is what you want most of the time.

A **weak reference** is the opposite promise. It points at an object but explicitly says: *"I want to find this object if it still exists, but I do not want my pointing at it to be the reason it stays in memory."* If the only references left to an object are weak ones, the GC is free to reclaim it. The next time you ask a weak reference for its object, you might get the object back — or you might get `null` / `None` / `nil`, meaning "it's gone."

That single property — *referencing without retaining* — is the whole idea, and it solves a surprising number of memory problems that are otherwise impossible to fix cleanly.

## Prerequisites

- **Heap and garbage collection basics:** objects live on the heap; the GC reclaims objects that are no longer **reachable** from your program.
- **Reachability:** an object is "reachable" (and therefore safe from collection) if there is a chain of strong references from a *root* (a local variable, a static field, a thread stack) to it.
- **References vs. values:** a reference is a handle/pointer to an object, not the object's bytes themselves.

You do not need to know GC internals. You only need to accept one rule: *the GC keeps an object alive exactly as long as something strongly references it.*

## Glossary

| Term | Meaning |
|------|---------|
| **Strong reference** | A normal reference; keeps its target alive. The default. |
| **Weak reference** | A reference that does *not* keep its target alive; the GC may reclaim the target anyway. |
| **Referent** | The object a weak reference points at. |
| **Reachable** | Connected to a GC root by a chain of strong references; safe from collection. |
| **Weakly reachable** | Reachable *only* through weak references; eligible for collection. |
| **Cleared** | A weak reference whose referent has been collected now returns "nothing" (`null`/`None`/`nil`). |
| **Dereference / upgrade** | Asking a weak reference for its object, which may succeed or report "gone." |

## Core Concepts

### A weak reference can become empty at any time

This is the defining behavior. A strong reference, once set, always gives you the same object until you reassign it. A weak reference can *spontaneously* stop pointing at anything, because the GC reclaimed the object behind your back. Your code must therefore always handle two outcomes when reading a weak reference:

1. The object is still alive → you get it.
2. The object was collected → you get an explicit "nothing."

There is no third option, and you cannot prevent outcome 2 by trying harder. If you need the object to survive, hold a *strong* reference to it.

### Weak references do not extend lifetime — they observe it

Think of a weak reference as a *one-way mirror onto the GC's bookkeeping*. It lets you watch whether an object is still alive without participating in keeping it alive. You are a spectator, not a stakeholder.

### "Only weakly reachable" is the trigger

An object is collected when the *strong* references run out, even if many weak references still point at it. One strong reference anywhere is enough to keep it. So weak references matter only after every strong reference is gone.

```
Root ──strong──▶ Object   ◀──weak── WeakRef A
                          ◀──weak── WeakRef B

(Object is alive: the strong chain from Root protects it.)


Root ──╳ (strong link removed)      Object  ◀──weak── WeakRef A
                                            ◀──weak── WeakRef B

(Object is now only weakly reachable → GC may reclaim it →
 WeakRef A and WeakRef B both become "cleared".)
```

## Real-World Analogies

- **A phone number on a sticky note vs. employing the person.** Employing someone (strong reference) obliges the company to keep them around. A sticky note with their number (weak reference) lets you *try* to reach them, but if they quit and move away, your note is just a dead number. You can still attempt the call; it just might not connect.

- **A library catalog card.** The card (weak reference) describes a book and helps you find it. But the card does not stop the library from discarding the book. When you go to the shelf, the book may be there — or the slot may be empty.

- **A coat-check ticket where the cloakroom may discard unclaimed coats overnight.** Your ticket lets you reclaim the coat *if* it is still there, but holding the ticket does not guarantee the coat survives.

## Mental Models

- **Default-strong, opt-in-weak.** Every reference you write is strong unless you deliberately wrap it in a weak-reference type. Weakness is never accidental; you ask for it.
- **"Maybe-pointer."** Treat a weak reference as a value that is *either* the object *or* empty — much like an optional/nullable type that the runtime can flip to empty for you.
- **The GC is the boss.** You do not decide when the referent dies. The GC does, on its own schedule. Your job is to react correctly when it has.

## Code Examples

The exact API differs per language, but the shape is always the same: wrap the object, then *check* before using.

**Python** (`weakref`):
```python
import weakref

class Cache:
    pass

obj = Cache()                 # strong reference in `obj`
ref = weakref.ref(obj)        # weak reference, does NOT keep obj alive

print(ref())                  # <Cache object ...>  — still alive
del obj                       # drop the only strong reference
import gc; gc.collect()       # encourage collection
print(ref())                  # None — the object is gone
```

**Java** (`java.lang.ref.WeakReference`):
```java
import java.lang.ref.WeakReference;

Object strong = new Object();
WeakReference<Object> weak = new WeakReference<>(strong);

System.out.println(weak.get()); // the object — still alive
strong = null;                  // drop the only strong reference
System.gc();                    // suggest a GC
System.out.println(weak.get()); // likely null — collected
```

**JavaScript** (`WeakRef`):
```javascript
let obj = { name: "node" };
const ref = new WeakRef(obj);

console.log(ref.deref()); // { name: "node" } — alive
obj = null;               // drop the only strong reference
// ...after a future GC...
console.log(ref.deref()); // undefined — collected
```

Notice the universal pattern: **never assume the object is there.** Always call the dereference function (`ref()`, `.get()`, `.deref()`) and check the result.

## Pros & Cons

**Pros**
- Lets you reference an object without being responsible for its lifetime.
- Prevents a whole class of memory leaks where a long-lived structure accidentally pins short-lived objects.
- Enables caches and registries that "let go" automatically when memory is needed.

**Cons**
- You must handle the "it's gone" case *every single time* — more code, more branches.
- Behavior is non-deterministic: *when* a weak referent disappears depends on the GC, which you do not control.
- Easy to misuse (e.g., as if it guaranteed the object stays until you're done — it does not).

## Use Cases

- **Caches that should not keep entries alive on their own.** If the rest of the program stops using a cached object, the cache should let it go rather than hoard it.
- **Back-pointers** (e.g., a child node pointing back to its parent) where you don't want the back-pointer to keep things alive.
- **Listener/observer lists** that should not keep dead subscribers alive forever.
- **Associating extra data with an object you don't own**, without forcing that object to live longer.

You will study each of these in depth in later tiers; for now, just recognize the *shape*: "I want to refer to it, but not own its lifetime."

## Best Practices

- **Always check the result of a dereference.** Treat "gone" as a normal, expected outcome, not an error.
- **Keep a strong reference for as long as you actually need the object.** Dereference into a local strong variable and use *that*, so it cannot vanish mid-operation.
- **Don't reach for weak references by default.** Use them only when the leak/lifetime problem is real. A strong reference is simpler and almost always correct.

## Edge Cases & Pitfalls

- **The "use-after-check" race.** You check `ref()` is non-null, then later call `ref()` again expecting the same object — but it was collected in between. Fix: dereference *once* into a strong local and use that local.

  ```python
  obj = ref()              # one dereference
  if obj is not None:
      use(obj)             # `obj` is a strong ref now; safe to use
  ```

- **Forcing a GC to "test" weak refs is unreliable.** `gc.collect()` / `System.gc()` are *hints*. Timing of clearing is not something to depend on in production logic.
- **A lingering strong reference defeats the whole purpose.** If a weak referent "never gets collected," look for a strong reference you forgot about — a closure, a list, a static field.

## Summary

A weak reference points at an object *without keeping it alive*. When the last strong reference disappears, the GC may reclaim the object, and the weak reference becomes empty. The single skill to internalize at this level: **always dereference defensively and handle the "it's gone" case.** Weak references are an opt-in tool for the specific situation where you want to *refer to* something without *owning its lifetime* — caches, back-pointers, and listener lists are the classic motivations you'll explore next.
