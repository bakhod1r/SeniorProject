# Finalizers & Destructors — Junior Level

> **Topic:** [Finalizers & Destructors](README.md)
> **Focus:** What cleanup code is, the difference between deterministic destructors and non-deterministic finalizers, and why you almost always want the deterministic kind.

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

When you create an object, sometimes it grabs a *resource* from the outside world: a file gets opened, a network socket is connected, a chunk of memory is reserved, a lock is taken. Memory the program allocates is usually cleaned up automatically by the language (a garbage collector or scope rules). But those outside-world resources are different — the operating system handed you a *handle*, and it expects you to hand it back. If you don't, the program "leaks" the resource. Open enough files without closing them and the OS refuses to give you more.

**Cleanup code** is the code that runs to release these resources. There are two broad families of cleanup mechanism, and the single most important idea in this whole topic is the difference between them:

- A **destructor** runs at a *known, predictable* moment — usually when a variable goes out of scope or you explicitly ask for it. This is **deterministic**.
- A **finalizer** runs *whenever the garbage collector gets around to it* — which might be much later, or in a different thread, or (in some cases) **never**. This is **non-deterministic**.

If you remember only one sentence from this page: **use deterministic cleanup (destructors, `with`, `defer`, `using`, `Drop`) for anything that matters, and treat finalizers as a last-resort safety net, not a plan.**

---

## Prerequisites

- Basic idea of **objects/values** and **variables** in any language.
- The concept of **scope** — the region of code where a variable is "alive".
- A rough idea of **garbage collection (GC)**: in languages like Java, Python, Go, and C#, you don't manually free memory; a background mechanism reclaims memory you can no longer reach. (We are *not* studying GC internals here — just that it runs "sometime later".)
- What a **resource** is: a file handle, a network socket, a database connection, a lock — something finite the OS or a server gives you and wants back.

---

## Glossary

| Term | Meaning |
|---|---|
| **Resource** | Something finite obtained from outside your program (file handle, socket, DB connection, lock) that must be released. |
| **Destructor** | Cleanup code that runs at a *deterministic* point — scope exit or explicit destroy. |
| **Finalizer** | Cleanup code the **garbage collector** may run *eventually*, with no timing guarantee. |
| **Deterministic** | Happens at a moment you can point to in the source code. |
| **Non-deterministic** | Happens at an unpredictable time you cannot point to (or maybe never). |
| **Scope** | The block of code where a variable lives; exiting it can trigger cleanup. |
| **RAII** | "Resource Acquisition Is Initialization" — a C++/Rust pattern: get the resource in a constructor, release it in the destructor. |
| **Leak** | Failing to release a resource, so it accumulates and eventually exhausts a limit. |
| **Handle** | A small token (often a number) the OS gives you to refer to an open resource. |

---

## Core Concepts

### Memory is cleaned up for you; resources are not

In a garbage-collected language, you rarely worry about *memory* — when an object becomes unreachable, the GC reclaims its memory. The trap is assuming the GC also closes your files and sockets. It does not, at least not on time. The GC's job is to manage memory pressure, so it runs when *memory* is tight — and you can run out of file handles long before you run out of memory.

### Deterministic cleanup: you know exactly when

```
{
    open a file
    ... use it ...
}   // <- the moment we reach this brace, the file is closed
```

You can read the code and put your finger on the exact line where cleanup happens. C++ destructors, Rust's `Drop`, Go's `defer`, Python's `with`, and C#'s `using` all give you this. The release is tied to *control flow*, not to memory pressure.

### Non-deterministic cleanup: it happens "later, maybe"

```
make an object that has a finalizer
... stop using it ...
// the finalizer might run in 5 ms, in 5 minutes, or never before the program exits
```

A finalizer is attached to the object and the GC *might* call it before reclaiming the object's memory. The keyword is *might*. There is no promise about **when**, **which thread**, or even **whether** it runs at all (programs that exit can skip finalizers entirely).

### Why finalizers exist at all

If they're so unreliable, why do they exist? Two honest reasons:

1. **A safety net.** If a programmer forgets to close something, a finalizer can catch the leak eventually — better late than never, and a great place to log "hey, you forgot to close this."
2. **Native memory the GC can't see.** Some objects hold memory allocated outside the GC's world (e.g., a C library buffer). A finalizer is a way to make sure that foreign memory eventually gets freed.

Neither reason makes a finalizer a good *primary* cleanup strategy.

---

## Real-World Analogies

- **Library books.** A *destructor* is returning the book to the desk the moment you walk out of the library — predictable, on your way out. A *finalizer* is the library eventually noticing months later that a book is missing and sending you a late notice... if and when they get around to auditing. You don't want your *only* return mechanism to be the audit.

- **Hotel checkout.** Deterministic cleanup is checking out at the front desk when you leave. A finalizer is housekeeping eventually finding the room still occupied days later. If everyone relied on housekeeping, the hotel would run out of rooms.

- **Restaurant tables.** Finite tables = finite file handles. Diners who leave without telling anyone (relying on staff to *eventually* notice) cause the restaurant to "run out of tables" even though most are actually empty. Telling the host "we're done" (deterministic close) keeps the tables flowing.

---

## Mental Models

- **"Close it where you opened it."** The code that acquires a resource should be visibly responsible for releasing it, in the same scope. Deterministic mechanisms make this natural.

- **"Finalizer = smoke detector, not fire department."** A smoke detector is a backstop that alerts you something went wrong. It is not how you put out fires. Use finalizers to *detect/clean up forgotten* resources, not as your normal release path.

- **"The GC manages memory, not promises."** The GC's clock is set by memory pressure. Your file handles, sockets, and locks live on a *different* clock. Don't tie one clock to the other.

---

## Code Examples

### Deterministic — Python `with` (the good way)

```python
with open("data.txt") as f:        # acquire
    contents = f.read()
# <- file is GUARANTEED closed here, even if read() raised an exception
```

The `with` block closes the file at a known point. This is deterministic cleanup.

### Non-deterministic — Python `__del__` (the risky way)

```python
class FileWrapper:
    def __init__(self, path):
        self.f = open(path)
    def __del__(self):             # a finalizer
        self.f.close()             # runs "whenever", maybe at shutdown, maybe never

w = FileWrapper("data.txt")
# w.f stays open until the garbage collector decides to clean up w.
```

This *looks* convenient but the close happens at an unpredictable time. Under heavy load you can exhaust file handles waiting for it.

### Deterministic — Go `defer`

```go
f, err := os.Open("data.txt")
if err != nil {
    return err
}
defer f.Close()   // <- runs when this function returns, guaranteed, in order
// ... use f ...
```

`defer` schedules `f.Close()` to run at function exit — a known point.

### Deterministic — C++ destructor (RAII)

```cpp
{
    std::ifstream file("data.txt");   // constructor opens
    // ... use file ...
}   // <- destructor runs here, closes the file, automatically
```

The file closes at the closing brace, every time, including when an exception unwinds the stack.

---

## Pros & Cons

### Deterministic cleanup (destructors / `with` / `defer` / `using` / `Drop`)

**Pros**
- Release happens at a known point — easy to reason about.
- Works correctly even when exceptions/errors occur.
- Resources are freed promptly, so you don't exhaust limited handles.

**Cons**
- You (or the language structure) must remember to use it — though languages make this easy.

### Finalizers (GC-driven)

**Pros**
- A backstop for forgotten cleanup.
- Can free native memory invisible to the GC.

**Cons**
- No guarantee of *when* — could be far too late.
- No guarantee it runs *at all* (shutdown can skip it).
- Runs on a special thread; bugs there are easy to miss.
- Tempts people into using it for scarce resources, which causes leaks.

---

## Use Cases

- **Use deterministic cleanup for:** files, sockets, database connections, locks/mutexes, temporary files, GUI handles — anything scarce or with side effects you care about timing for. This is *almost everything*.
- **Use a finalizer only for:** a last-resort safety net that logs/cleans up a forgotten native resource. Even then, it is a *second* line of defense behind an explicit close.

---

## Best Practices

1. **Prefer the language's deterministic tool first:** `with` (Python), `using` (C#), `defer` (Go), destructors/RAII (C++), `Drop` (Rust).
2. **Never put scarce-resource release in a finalizer as the only path.** Files, sockets, and connections will run out.
3. **Pair acquire and release in the same scope** so the lifetime is visible.
4. **If you must offer a finalizer, also offer an explicit close** and document that close is the real mechanism.
5. **Don't throw exceptions from cleanup code** — it's hard to handle and often silently ignored.

---

## Edge Cases & Pitfalls

- **"It worked on my machine."** A finalizer may run quickly under light load (so your tests pass) and then far too late under production load (so you leak handles). Light testing hides the bug.
- **Program exit skips finalizers.** Many runtimes do *not* run pending finalizers when the process exits. Anything you "planned" to flush at the end may never flush.
- **Order is not guaranteed.** If two finalizable objects refer to each other, you cannot assume one runs before the other; the one you depend on might already be gone.
- **Exceptions in cleanup vanish.** Errors thrown inside finalizers are usually swallowed, so failures go unnoticed.
- **Double-close.** If both a finalizer and an explicit close run, make sure closing twice is safe (idempotent), or you'll get crashes or errors.

---

## Summary

- Programs grab finite **resources** (files, sockets, connections, locks) that must be released.
- **Destructors** release at a **deterministic** moment — scope exit or explicit destroy. **Finalizers** release **whenever the GC chooses**, which may be much later or never.
- The GC manages *memory* on a memory-pressure clock; your resources live on a *different* clock, so never tie scarce-resource release to the GC.
- Use deterministic mechanisms — Python `with`, C# `using`, Go `defer`, C++ destructors, Rust `Drop` — as your **primary** cleanup, and treat finalizers as a **safety net** only.
- The classic mistake is relying on a finalizer to close files/sockets; under load you exhaust the limit long before the finalizer runs.
