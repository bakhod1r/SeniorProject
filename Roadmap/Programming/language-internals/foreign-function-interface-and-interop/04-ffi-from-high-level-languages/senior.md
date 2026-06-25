# FFI from High-Level Languages — Senior Level

> **Topic:** [FFI from High-Level Languages](README.md)
> **Focus:** How each major runtime's memory and execution model collides with native code — GC vs. raw pointers, JNI vs. Panama, cgo's cost cliff, and Rust's safe-wrapper discipline.

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

---

## Introduction

> Focus: **Why each language's FFI looks different — because each runtime's memory model and scheduler impose different rules on native code.**

By the senior level, "call a C function" is trivial; the interesting questions are about *impedance mismatch*. A high-level runtime makes promises to its own code — objects don't move, or they *do* move, the GC can run at any safepoint, threads are green and multiplexed onto OS threads, the heap is owned by the collector. Native code knows none of this. The design of every FFI mechanism is fundamentally a set of rules for keeping those promises intact while raw C code runs in the middle of them.

The four runtimes diverge sharply:

- **CPython** has no moving GC and uses reference counting, so pointers to objects are stable — but the **GIL** governs execution and refcounts must be maintained by hand.
- **The JVM** has a **moving, generational GC**: objects can be relocated at any safepoint. So JNI gives you *handles* (jobjects), not raw addresses, and special "critical" APIs to pin arrays briefly. Project **Panama** replaces JNI's hand-written boilerplate with a typed, lower-overhead API.
- **Go** has a **moving stack and a goroutine scheduler**. cgo must switch from a tiny growable goroutine stack to a real OS stack, coordinate with the scheduler, and forbid passing Go pointers into C because the GC could move or free them.
- **Rust** has *no* runtime GC; ownership is compile-time. So Rust's FFI is the cleanest — `extern "C"`, `#[repr(C)]`, `unsafe` — and the central discipline is wrapping an `unsafe` core in a safe API.

In one sentence: **FFI design is the art of letting raw native code run inside a managed runtime without letting it violate the invariants that runtime depends on.** This page works through each runtime's specific contract.

> 🎓 **Why this matters at the senior level:** You'll choose binding strategies, review native glue, and own the "why does this crash only under GC pressure / only at 64 threads / only after migrating off cgo" incidents. Those are not coding bugs — they're model-mismatch bugs, and you can only reason about them if you understand what each runtime promises and how FFI threatens it.

This page covers: moving vs. non-moving GC and what it means for pointers; JNI's reference model and `GetPrimitiveArrayCritical`; Project Panama (`Linker`, `MethodHandle`, `MemorySegment`, downcalls/upcalls); cgo's per-call cost and the "don't pass Go pointers to C" rule; and Rust's `extern "C"`/`#[repr(C)]`/`bindgen`/`cbindgen` and the safe-wrapper pattern.

---

## Prerequisites

- **Required:** The middle FFI material — calling conventions, marshalling cost, GIL, reference counting.
- **Required:** A working model of garbage collection: at least the distinction between reference counting and tracing/moving collectors.
- **Required:** Threading fundamentals — OS threads vs. runtime-managed (green) threads.
- **Helpful:** Exposure to the JVM, Go's goroutine model, or Rust's ownership system.
- **Helpful:** Having debugged at least one native crash with gdb/lldb.

You do **not** need:

- Production packaging/distribution mechanics (that's `professional.md`).
- The detailed callback/upcall threading hazards at scale (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Moving GC** | A garbage collector that relocates live objects to compact the heap. The JVM and Go have moving collectors; CPython does not. |
| **Pinning** | Temporarily forbidding the GC from moving a specific object so native code can hold a raw pointer to it safely. |
| **Safepoint** | A point where a thread can be paused for GC. The GC only runs when all threads are at safepoints. |
| **JNI** | Java Native Interface — the original Java↔native mechanism. Uses a `JNIEnv*` and opaque object handles. |
| **`JNIEnv*`** | A per-thread pointer giving native code access to JNI functions. **Not** shareable across threads. |
| **Local reference** | A JNI object handle valid only for the duration of the native call; auto-freed on return. |
| **Global reference** | A JNI handle that survives across native calls; you must explicitly delete it or it leaks. |
| **`GetPrimitiveArrayCritical`** | A JNI call that *pins* a Java primitive array so C can access its raw bytes — must be released ASAP; blocks GC. |
| **Project Panama / FFM API** | Java's Foreign Function & Memory API: `Linker`, `MethodHandle`, `MemorySegment` — a typed, lower-boilerplate JNI replacement. |
| **Downcall** | Managed code calling into native code (the common direction). |
| **Upcall** | Native code calling back into managed code (a callback). The dangerous direction. |
| **cgo** | Go's C interop. Triggered by `import "C"` with a preamble comment. |
| **Goroutine stack** | A small, growable, *movable* stack. C needs a fixed OS stack, so cgo switches stacks per call. |
| **`extern "C"`** | Rust (and C++) syntax declaring functions use the C ABI, with no name mangling. |
| **`#[repr(C)]`** | Rust attribute forcing a struct/enum to use C's field layout and alignment. |
| **`bindgen`** | Tool that auto-generates Rust FFI declarations from C headers. |
| **`cbindgen`** | Tool that generates C headers from Rust `extern "C"` code (the reverse). |

---

## Core Concepts

### 1. Moving vs. non-moving GC determines whether raw pointers are safe

This single fact explains most of the divergence between FFI designs.

**CPython: non-moving + refcounted.** An object's address never changes for its lifetime. So a C extension can hold a raw `PyObject*` across calls — as long as it keeps the refcount up so the object isn't freed. Pointers are stable; the discipline is *lifetime*, not *location*.

**JVM and Go: moving collectors.** The GC compacts the heap by *relocating* live objects. An address you grabbed a microsecond ago may be stale after the next GC. Therefore neither runtime lets native code freely hold raw pointers into managed memory. The JVM gives you **handles** (jobjects) that the JNI layer translates; Go simply **forbids** passing Go pointers into C that C will retain.

The consequence: bindings for moving-GC runtimes need either **handles** (an indirection the runtime can update) or **pinning** (temporarily forbidding movement) whenever native code must see real bytes.

### 2. JNI: handles, reference scopes, and critical regions

JNI never hands native code a raw Java object address. It hands a **jobject** — an opaque handle the runtime can keep valid even as the GC moves the underlying object. Two scopes:

- **Local references** are valid only during the current native method call and freed automatically on return. There's a *limited table* of them; a native loop that creates thousands without freeing them overflows the local reference table.
- **Global references** survive across calls. You create them with `NewGlobalRef` and **must** `DeleteGlobalRef`, or they leak — and a leaked global ref also keeps the Java object alive, so it's a Java memory leak caused by native code.

For raw array access, JNI offers two tiers. `GetArrayElements` may copy. `GetPrimitiveArrayCritical` **pins** the array so C sees its actual bytes with no copy — but while pinned, the GC is effectively blocked, so you must do minimal work and call `ReleasePrimitiveArrayCritical` immediately. Holding a critical region across a blocking call or a callback is a recipe for stalling or deadlocking the collector.

Two more JNI gotchas seniors must know: the **`JNIEnv*` is per-thread** (never cache and reuse it on another thread), and **Java exceptions don't propagate automatically** — after a JNI call that might throw, you must `ExceptionCheck` and bail; ignoring a pending exception and continuing to call JNI is undefined behavior.

### 3. Project Panama (the Foreign Function & Memory API)

JNI's problems are real: hand-written C glue, per-binding `.so` files, boilerplate, and easy ref leaks. **Project Panama** (the `java.lang.foreign` FFM API, standard since Java 22) replaces it with a pure-Java, typed approach:

- **`Linker`** produces a `MethodHandle` bound to a native function, given its descriptor (argument and return layouts).
- **`MemorySegment`** is a typed, bounds-checked view of off-heap (or heap) memory — no more raw `void*` with no length.
- **`Arena`** scopes the lifetime of native memory; when the arena closes, the memory is freed deterministically.
- **Downcalls** (Java→native) are `MethodHandle.invoke`; **upcalls** (native→Java) wrap a Java method handle as a function pointer C can call.

The wins: no C compiler, no per-platform `.so` to ship, bounds-checked memory, deterministic deallocation, and lower per-call overhead than JNI because there's no `JNIEnv` round-trip. The cost: you describe layouts explicitly, and `unsafe`-equivalent operations are still possible (you can still mis-describe a signature and crash).

### 4. cgo: the goroutine-stack switch and the pointer rule

Go's FFI, **cgo**, has two senior-level realities.

**It's not a cheap call.** A normal Go function call is a few instructions. A cgo call must: switch from the goroutine's small, movable stack to a dedicated **system stack** (because C needs a real, fixed OS stack), coordinate with the Go scheduler (the goroutine is now "in a syscall-like state," so the scheduler may need another OS thread to keep other goroutines running), and switch back on return. The fixed overhead is on the order of tens of nanoseconds — negligible once, catastrophic in a tight loop calling C millions of times. This is the **cgo performance cliff**: code that's fine at low call rates falls off a cliff when the crossing becomes the hot path.

**Don't pass Go pointers to C (that C keeps).** Because Go's GC can move objects and reclaim them, C must not *store* a Go pointer past the call's return. The cgo pointer-passing rules are enforced (with `GODEBUG=cgocheck`): you may pass a Go pointer to C for the duration of the call, but C may not retain it, and the memory it points to must not itself contain Go pointers. If C needs to keep data, copy it into C-allocated memory (`C.malloc`) — which you then own and must free.

cgo also has knock-on costs seniors weigh: it **breaks easy cross-compilation** (you now need a C cross-toolchain, not just `GOOS`/`GOARCH`), inflates binary size, and complicates static linking. Many teams treat "introduce cgo" as a significant architectural decision, not a convenience.

### 5. Rust: the cleanest FFI, and the safe-wrapper pattern

Rust has no runtime GC and no relocation, so its FFI is the most direct of the four:

- **`extern "C" { fn foo(x: i32) -> i32; }`** declares a C function; calling it requires `unsafe` because the compiler can't verify the foreign side.
- **`#[repr(C)]`** on structs/enums forces C-compatible layout so they can cross the boundary.
- **`bindgen`** reads a C header and *generates* the `extern` blocks and `#[repr(C)]` structs automatically — the standard way to bind a large C library.
- **`cbindgen`** does the reverse: generates a C header *from* your Rust `extern "C"` functions, so C/other languages can call into your Rust.

The defining Rust idiom is the **safe-wrapper-over-unsafe-core** pattern: the raw `extern` calls live in a small `unsafe` module, and a hand-written safe API wraps them, encoding ownership and lifetimes in the type system (e.g., a struct whose `Drop` impl calls the C `free`, so leaks are impossible). This is exactly the pattern every other language *should* follow but only Rust *enforces* — and it's why Rust is increasingly the language people write the native core in (then bind to Python via PyO3, to Node via neon, to C via cbindgen).

---

## Real-World Analogies

**Assigned seats vs. coat-check tags (non-moving vs. moving GC).** CPython is a theater with assigned seats: once you know seat 14C, that's where the person stays — a raw pointer works. The JVM is a coat check: you get a *tag*, and the attendant may move your coat to a different hook (GC compaction). You must hand back the tag (jobject), never assume a physical hook. `GetPrimitiveArrayCritical` is asking the attendant to *freeze the rack* while you grab your coat — fast, but everyone else waits, so be quick.

**A toll plaza between a bike path and a highway (cgo stack switch).** Goroutines are bikes on a narrow movable path; C is a highway needing a real lane. Every C call, you dismount, push through the toll plaza onto the highway, and reverse on the way back. One trip is fine; commuting through the plaza a million times a second is the cliff.

**Don't lend your house keys to a contractor who might lose them (Go pointer rule).** You can let C *look* at your data during a job, but if C pockets the key (retains a Go pointer), the GC might rekey the locks (move/free the object) and now the contractor holds a key to nothing — or to someone else's house. Hand them a *copy* they own instead.

**A licensed electrician wrapping the live wires (Rust safe wrapper).** The `unsafe` core is the bare live wire; the safe API is the sealed, labeled outlet. End users plug into the outlet and can't touch the wire. Rust makes you build the outlet before anyone uses the wire.

---

## Mental Models

**Model 1: Pointers are stable iff the GC doesn't move.** Decide first: does this runtime relocate objects? If yes, native code gets handles or pins, never free-roaming raw pointers. If no, native code gets pointers but owes lifetime management. Every FFI design falls out of this answer.

**Model 2: The boundary cost is per-runtime, not universal.** A CPython `ctypes` call, a JNI call, a Panama downcall, a cgo call, and a Rust `extern` call have wildly different fixed costs (Rust ≈ free; cgo expensive; JNI moderate). "FFI overhead" without naming the runtime is meaningless.

**Model 3: Push the unsafe surface down and make it small.** Across all languages, the senior move is the same: a tiny, audited, unsafe boundary layer, wrapped by a safe, idiomatic API that encodes ownership. Rust enforces it; you should impose it everywhere.

---

## Code Examples

### JNI: local vs. global references and an exception check

```c
#include <jni.h>

JNIEXPORT void JNICALL
Java_Demo_work(JNIEnv *env, jobject self, jstring jname) {
    /* GetStringUTFChars returns a C string; may pin or copy. Must Release. */
    const char *name = (*env)->GetStringUTFChars(env, jname, NULL);
    if (name == NULL) return;             /* OutOfMemory pending */

    /* ... use name ... */

    (*env)->ReleaseStringUTFChars(env, jname, name);  /* required, or leak */

    /* If we called something that may throw, we MUST check before continuing. */
    if ((*env)->ExceptionCheck(env)) {
        return;   /* a Java exception is pending; do not keep calling JNI */
    }
}
```

### JNI critical region: zero-copy array access, kept tiny

```c
jbyte *buf = (*env)->GetPrimitiveArrayCritical(env, arr, NULL);  /* pins; blocks GC */
/* Do ONLY tight, non-blocking, no-JNI-call work here. */
long sum = 0;
jsize n = (*env)->GetArrayLength(env, arr);
for (jsize i = 0; i < n; i++) sum += buf[i];
(*env)->ReleasePrimitiveArrayCritical(env, arr, buf, 0);  /* unpin ASAP */
```

### Project Panama (FFM API): calling C `strlen` from pure Java

```java
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

try (Arena arena = Arena.ofConfined()) {
    Linker linker = Linker.nativeLinker();
    MethodHandle strlen = linker.downcallHandle(
        linker.defaultLookup().find("strlen").orElseThrow(),
        FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS));

    MemorySegment cString = arena.allocateUtf8String("hello"); // off-heap, arena-scoped
    long len = (long) strlen.invoke(cString);                  // downcall
    System.out.println(len);                                   // 5
} // arena closes -> native memory freed deterministically
```

No C file, no `.so` of your own, no `JNIEnv`, and the memory is freed when the arena closes.

### cgo: copy data into C memory rather than passing a Go pointer C retains

```go
package main

/*
#include <stdlib.h>
#include <string.h>
*/
import "C"
import "unsafe"

// WRONG idea: hand C a pointer into a Go slice that C will keep.
// RIGHT: copy into C-owned memory.
func storeInC(data []byte) unsafe.Pointer {
	p := C.malloc(C.size_t(len(data)))          // C owns this; GC won't touch it
	C.memcpy(p, unsafe.Pointer(&data[0]), C.size_t(len(data)))
	return p                                     // caller must C.free(p) later
}
```

### Rust: bindgen-style declaration + safe wrapper with Drop

```rust
use std::os::raw::c_char;

// (bindgen would generate these from a header.)
extern "C" {
    fn create_thing() -> *mut Thing;
    fn destroy_thing(t: *mut Thing);
    fn thing_value(t: *mut Thing) -> i32;
}
#[repr(C)]
struct Thing { _private: [u8; 0] } // opaque

// Safe wrapper: unsafe core, safe surface, leak-proof via Drop.
pub struct SafeThing(*mut Thing);

impl SafeThing {
    pub fn new() -> Self { SafeThing(unsafe { create_thing() }) }
    pub fn value(&self) -> i32 { unsafe { thing_value(self.0) } }
}
impl Drop for SafeThing {
    fn drop(&mut self) { unsafe { destroy_thing(self.0) } } // free runs automatically
}
```

A caller of `SafeThing` writes pure safe Rust and *cannot* forget to free or misuse the raw pointer.

---

## Pros & Cons

**Pros**

- **Panama modernizes Java FFI** — no C glue, bounds-checked memory, deterministic freeing, lower overhead than JNI.
- **Rust's model makes safe, leak-proof bindings idiomatic** and is the best language to write the shared native core in.
- **CPython's stable pointers** make object lifetimes (not locations) the only concern — simpler than moving-GC FFI.

**Cons**

- **JNI is verbose and leak-prone** — global refs and critical regions are easy to mishandle and stall the GC.
- **cgo has a real per-call cost and breaks easy cross-compilation** — a strategic, not casual, dependency.
- **Moving GCs forbid free-roaming pointers**, forcing handles/pinning and the bugs that come with them.
- **Every model is different**, so cross-language native cores must satisfy the strictest set of rules.

---

## Use Cases

- **Migrating a Java service off JNI to Panama** to delete native build steps and ref-leak incidents.
- **Writing the native core once in Rust** and binding it to Python (PyO3), Node (neon), and C (cbindgen) — one audited unsafe surface, many safe wrappers.
- **Auditing a cgo hot path** that regressed under load and either batching crossings or moving the loop into C.
- **Reviewing a JNI binding** for `JNIEnv*` thread-caching, missing `ExceptionCheck`, leaked global refs, and oversized critical regions.

---

## Coding Patterns

### Pattern 1: Handles for moving GCs, pins only briefly

Never cache raw addresses into JVM/Go heaps. Use handles; if you must touch raw bytes, pin (`GetPrimitiveArrayCritical`) for the shortest possible window and never block or call back inside it.

### Pattern 2: Copy across the boundary when ownership must transfer

If native code needs to *retain* data from a moving-GC runtime, copy it into native-owned memory (`C.malloc`, `Arena`) and track that ownership explicitly.

### Pattern 3: Safe wrapper over unsafe core (universal)

Confine `unsafe`/raw FFI to a small module; expose a type whose destructor (`Drop`, `__del__`, `AutoCloseable`/`Arena`) guarantees cleanup. Encode ownership in the type, not in comments.

### Pattern 4: Generate bindings, don't hand-write them

Use `bindgen` (C→Rust) or `cbindgen` (Rust→C) so declarations stay in sync with headers. Hand-written `extern` blocks drift and silently corrupt when the C side changes.

---

## Best Practices

1. **Know your GC's movement semantics before designing a binding** — it dictates handles vs. pointers.
2. **Keep JNI critical regions microscopic** — no blocking, no JNI calls, no upcalls inside them.
3. **Track every JNI global ref**; delete it deterministically, treat a leak as a Java leak.
4. **Prefer Panama for new Java native work**; reserve JNI for legacy or where Panama can't reach.
5. **Treat cgo as architecture**: measure call frequency, batch crossings, and weigh the cross-compilation cost.
6. **Never let C retain a Go pointer**; copy into C memory and own it.
7. **In Rust, push raw FFI into a tiny `unsafe` core** and wrap it with a `Drop`-backed safe type.
8. **Auto-generate bindings** and re-generate when headers change.

---

## Edge Cases & Pitfalls

- **Caching a `JNIEnv*` across threads.** It's per-thread; using it on another thread is undefined behavior.
- **Ignoring a pending Java exception** after a JNI call, then making more JNI calls — undefined behavior.
- **Local reference table overflow** in a native loop that creates many jobjects without freeing them.
- **Leaked global ref** that pins a Java object forever — a native-caused Java memory leak.
- **Blocking or calling back inside a critical region** — stalls or deadlocks the collector.
- **cgo in a hot loop** — the per-call stack switch becomes the dominant cost (the cgo cliff).
- **Passing a Go pointer to C that C stores** — GC moves/frees it, C now holds a dangling pointer.
- **Adding cgo and discovering cross-compilation broke** — you now need a C cross-toolchain.
- **Mis-describing a Panama `FunctionDescriptor`** — still crashes; the FFM API is safer but not magic.
- **Hand-written Rust `extern` block drifting from the C header** after a library upgrade — silent layout corruption; use `bindgen`.

---

## Cheat Sheet

| Runtime | GC | Pointer model | FFI mechanism | Signature crash risk |
|---------|----|---------------|--------------|----------------------|
| CPython | refcount, non-moving | stable raw `PyObject*` | C-API / ctypes / cffi | refcount + argtype errors |
| JVM | moving, generational | handles (jobject), pin for arrays | JNI / **Panama (FFM)** | descriptor/ref-scope errors |
| Go | moving stacks | no Go ptrs retained by C | cgo | per-call cost + ptr rule |
| Rust | none (compile-time) | raw ptrs in `unsafe` | `extern "C"` + bindgen/cbindgen | `unsafe`-localized |

| Item | Key fact |
|------|----------|
| `GetPrimitiveArrayCritical` | Pins array (blocks GC); release immediately, do nothing heavy inside. |
| JNI global ref | Must `DeleteGlobalRef`; leak = Java leak. |
| Panama core types | `Linker`, `MethodHandle`, `MemorySegment`, `Arena`. |
| cgo cliff | Per-call goroutine→system stack switch; brutal in tight loops. |
| Go pointer rule | C may use a Go ptr during the call, never retain it. |
| Rust idiom | Safe wrapper (Drop-backed) over a tiny unsafe core; bindgen/cbindgen for declarations. |

---

## Summary

Each runtime's FFI is shaped by its memory and execution model. **CPython** doesn't move objects, so native code holds stable `PyObject*` pointers and the only discipline is lifetime (refcounts) under the GIL. The **JVM** moves objects, so JNI deals in opaque handles, scoped local/global references, and brief pinning via `GetPrimitiveArrayCritical`; it's verbose and leak-prone, and **Project Panama** (the FFM API — `Linker`, `MethodHandle`, `MemorySegment`, `Arena`) replaces it with typed, bounds-checked, deterministically-freed, lower-overhead access and no hand-written C. **Go**'s cgo pays a real per-call cost (goroutine→system stack switch plus scheduler coordination), forbids C from retaining Go pointers, and complicates cross-compilation — making it an architectural decision. **Rust** has no runtime GC, so its FFI (`extern "C"`, `#[repr(C)]`, `bindgen`/`cbindgen`) is the cleanest, and its enforced **safe-wrapper-over-unsafe-core** pattern is the model everyone else should imitate — which is why Rust is increasingly the language the shared native core is written in.

The universal senior lesson: decide whether the GC moves, push the unsafe surface down into a tiny audited layer, encode ownership in types, and know that "FFI overhead" is meaningless without naming the runtime. `professional.md` extends this to callbacks/upcalls under threading, attaching native threads to the runtime, and shipping native artifacts (manylinux wheels, JNI loading, signing) at production scale.
