# FFI Safety & Pitfalls — Middle Level

> **Topic:** [FFI Safety & Pitfalls](README.md)
> **Focus:** The hazard classes of FFI in detail — ownership and lifetimes, ABI/type mismatch, error handling, the GC moving your data — and how to engineer against each one.

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
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the distinct categories of FFI failure, and what specific engineering practice neutralizes each one?**

At the junior level, the lesson was "the boundary is dangerous — null-check, declare types, free correctly." At the middle level, we make that precise. FFI failures are not random; they fall into a small number of **hazard classes**, and each class has a characteristic mechanism, a characteristic symptom, and a characteristic defense. A senior engineer reading a crash report can usually name the hazard class within a minute, because the symptoms are recognizable once you know the taxonomy.

This page organizes everything around those classes:

1. **Memory ownership and lifetime** — who allocates, who frees, with which allocator, and for how long the pointer is valid.
2. **Type and ABI mismatch** — the "compiles, then corrupts" family: wrong sizes, wrong signedness, wrong struct layout, wrong calling convention.
3. **Error handling across the boundary** — C error codes and `errno` versus exceptions, and the hard rule that exceptions/panics must never unwind through C.
4. **The garbage collector versus native pointers** — the GC moving or collecting an object that native code still uses, and how pinning prevents it.

In one sentence: **most FFI bugs are one of four kinds, and once you can name the kind, you know the fix.** The rest of this page builds that taxonomy and the matching defenses.

> 🎓 **Why this matters at the middle level:** You are now the person who *writes* the wrapper, not just calls it. The wrapper is the audited boundary that protects everyone above you. If your ownership contract is wrong, every caller inherits a use-after-free. If your struct layout is off by one field, every caller inherits silent corruption. The quality of the boundary is your responsibility now.

---

## Prerequisites

What you should know before reading this:

- **Required:** The junior-level material — null-checking, the boundary as the end of safety, the basic ownership question.
- **Required:** What the **heap** and **stack** are, and the lifecycle of a heap allocation (`malloc`/`free` or `new`/`delete`).
- **Required:** Basic familiarity with a C `struct` and how its fields are laid out in memory.
- **Helpful but not required:** Awareness that integer types have different sizes on different platforms (`int`, `long`, `size_t`).
- **Helpful but not required:** A sense of what a garbage collector does and that some collectors *move* objects in memory.

You do **not** need to know:

- The full mechanics of a calling convention or the bytes of a particular ABI (those are sibling topics).
- How to write a complete safe-wrapper crate in Rust or a production JNI module (that is `senior.md`/`professional.md`).
- Out-of-process isolation architectures (that is `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Hazard class** | One of the recognizable categories of FFI failure (ownership, ABI, error handling, GC interaction, threading, security, resource). |
| **Lifetime** | The span during which a pointer is valid. Outside it, dereferencing is undefined behavior. |
| **Allocator mismatch** | Freeing memory with a deallocator different from the one that allocated it (e.g. `free` on memory allocated by a library's custom allocator). Corrupts the heap. |
| **ABI (Application Binary Interface)** | The binary contract: type sizes, struct layout, calling convention, register usage. Both sides must agree exactly. |
| **LP64 / LLP64** | Two integer-size conventions. On LP64 (Linux/macOS 64-bit) `long` is 8 bytes; on LLP64 (Windows 64-bit) `long` is 4 bytes. A frequent cross-platform FFI bug. |
| **Struct layout / padding** | How a compiler arranges struct fields and inserts alignment padding. If the two sides disagree, every field after the disagreement is read from the wrong offset. |
| **Signedness** | Whether an integer is signed or unsigned. A signed/unsigned mismatch turns large values negative or vice versa. |
| **errno** | A thread-local error code set by failing C system calls. Valid only immediately after the failing call. |
| **Unwinding** | The process of propagating an exception/panic up the call stack, running destructors. Unwinding *through* C frames that do not expect it is undefined behavior. |
| **`catch_unwind`** | Rust's mechanism to stop a panic at a boundary so it does not unwind into C. |
| **JNI exception check** | After a JNI call that may have thrown a Java exception, native code must check and clear it before doing almost anything else. |
| **Pinning** | Telling a moving/collecting GC: "do not move or free this object while I hold a native pointer to it." |
| **`GC.KeepAlive`** | A .NET method that keeps a managed object reachable (uncollected) up to a specific point, so native code using its memory does not see it freed. |
| **Opaque handle** | A pointer the native library hands you that you treat as a black box (you never dereference it), passing it back to the library on each call. The safest interface shape. |

---

## Core Concepts

### Hazard Class 1: Memory Ownership & Lifetime

This is the largest and most common class. It splits into several distinct failure modes.

**Allocator mismatch.** Heap memory must be freed by the *same* allocator family that allocated it. If a library allocates with its internal allocator (or with a different C runtime than yours — a real problem on Windows, where a DLL may link a different CRT than your program), then `free`-ing it with your `free` corrupts the heap. The defense: free with the function the library tells you to use (`sqlite3_free`, `g_free`, the library's own destructor), never assume plain `free` works.

**Double-free.** Freeing the same pointer twice corrupts the allocator's metadata; the second free, or a later allocation, blows up. This happens when two code paths both think they own the pointer, or when a "free" function is called and then a `defer`/destructor frees it again. The defense: a single, clear owner per pointer, and null the pointer after freeing where the language allows.

**Use-after-free across the boundary.** You free C-allocated memory, then keep using a pointer (or a wrapper object) that still references it. Particularly nasty when the high-level wrapper outlives the C resource. The defense: tie the lifetime of the wrapper to the C resource, so the wrapper cannot be used after the resource is freed.

**Dangling pointers to stack or freed memory.** A C function returns a pointer to a local; or you hand C a pointer into a buffer that your language frees before C is done. The defense: only pass pointers whose lifetime provably outlives the call, and never return pointers to locals.

**The contract must be documented.** Every function in your boundary should have a one-line ownership note: *who allocates, who frees, with what, valid until when.* This is not bureaucracy — it is the specification that makes the boundary auditable.

### Hazard Class 2: Type & ABI Mismatch ("compiles, then corrupts")

The high-level runtime cannot verify your declaration of a C function. A wrong declaration is accepted, runs, and corrupts memory silently. The sub-cases:

- **Wrong integer size.** Declaring a parameter as 4 bytes when C reads 8 (or the reverse). The classic is `long` and `size_t`: on Windows 64-bit (LLP64) `long` is 4 bytes, on Linux/macOS 64-bit (LP64) it is 8. Code that works on Linux corrupts on Windows.
- **Signedness.** Declaring `unsigned` where C uses `signed` (or vice versa) flips the interpretation of high values — a large positive becomes negative.
- **`bool`.** C `bool` is one byte; some FFI tools default to a 4-byte int. The three garbage bytes can be nonzero, making a "true/false" unpredictable.
- **Struct layout / padding.** If your declared struct does not match C's field order, sizes, and alignment padding, every field after the first mismatch is read from the wrong offset. Particularly easy to get wrong with mixed field sizes and platform-dependent padding.
- **Calling convention.** On 32-bit x86 especially, declaring the wrong convention (`cdecl` vs `stdcall`) corrupts the stack on every call. Less common on 64-bit, but still a Windows pitfall.

The unifying symptom of this class: it **compiles**, often **passes simple tests**, and corrupts on some inputs or platforms. The defense: declare exact types; prefer fixed-width types (`int32_t`, `uint64_t`, `intptr_t`) over `int`/`long`; mirror struct layout exactly (and prefer generated bindings over hand-written ones); test on every target platform, especially across LP64/LLP64.

### Hazard Class 3: Error Handling Across the Boundary

The two sides report errors in incompatible ways. C uses **return codes**, **null returns**, and **`errno`**. Your high-level language uses **exceptions**, **panics**, or **error values**. Three rules govern the crossing:

1. **Translate C errors into your language's idiom at the boundary.** A null return or `-1` becomes an exception or an `Err`. Do not propagate raw sentinels upward; callers should not have to know C conventions.

2. **Read `errno` correctly.** `errno` is only meaningful *immediately* after the failing call. Any intervening call — even something innocuous, even your own logging — may overwrite it. Capture it on the very next line, before anything else.

3. **Never let an exception/panic unwind across the boundary into C.** This is undefined behavior, full stop. A Rust panic propagating into C, a C++ exception escaping an `extern "C"` function, a Go panic crossing into C, a Java exception left pending across native code — all are bugs. The defense is to *catch at the edge*: Rust's `std::panic::catch_unwind`, C++'s `catch (...)`, Go's `recover()` in the exported function, and explicit JNI exception checks after every JNI call that can throw. Convert the caught error into a return code the other side understands.

### Hazard Class 4: The GC Versus Native Pointers

In a managed runtime, the garbage collector can **collect** an object that is no longer reachable, and some collectors (the JVM, .NET, Go in some cases) can **move** objects to compact the heap. Either is catastrophic if native code holds a raw pointer to that object's memory:

- **Premature collection.** You hand C a pointer derived from a managed object, then your only reference to that object goes out of scope. The GC sees it as unreachable, collects it, and now C is reading freed memory. The fix: keep the object alive across the native call. In .NET this is exactly what `GC.KeepAlive(obj)` is for — it does nothing but prevent the object from being collected before that point.
- **Object moved during the call.** Even if the object is still alive, a moving GC may relocate it, leaving C's pointer pointing at the old address. The fix: **pin** the object (`fixed` in C#, `GCHandle.Alloc(obj, GCHandleType.Pinned)`, `Get*ArrayElements`/critical sections in JNI, runtime pinning rules in Go) so the GC may not move it for the duration of the native use.

The general principle: **whenever native code holds a pointer into managed memory, you are responsible for keeping that memory both alive and stationary for exactly as long as the pointer is used.**

---

## Real-World Analogies

**The four kinds of contractor disputes.** Ownership disputes (who pays to demolish the old shed?), spec mismatches (the blueprint said meters, they built in feet), communication failures (the client's complaint never reached the foreman), and the site moving under your feet (the surveyor's stakes were relocated overnight). FFI's four hazard classes map cleanly: ownership/lifetime, ABI/type, error handling, and the GC moving your data. Each kind of dispute is prevented by a different practice, and a good project manager recognizes which kind they are looking at instantly.

**The relay-race baton.** Ownership of memory is a baton in a relay. There must be exactly one runner holding it at any instant. Drop it (forget to free) and the race is lost slowly (leak). Two runners grab it (double-free) and you get a crash. Hand it off but keep running with a copy (use-after-free) and you are running with nothing. The handoff zone — the boundary — is where every relay is won or lost.

**A moving warehouse.** The GC is a warehouse manager who, to save space, periodically rearranges all the shelves while you are out. If you wrote down "the part is on shelf 12" (a raw pointer) and come back after a rearrangement, shelf 12 now holds something else, or is empty. Pinning is putting a "DO NOT MOVE" sticker on that shelf until you return.

---

## Mental Models

**Model 1: "Name the hazard class first."** When something breaks, classify before you debug. Is this an ownership bug (leak/double-free/UAF), an ABI bug (wrong values, platform-specific corruption), an error-handling bug (a crash on the error path, an exception crossing C), or a GC bug (works until the GC runs, then crashes)? The class points at the fix.

**Model 2: "Every pointer has a lifetime and an owner; write them down."** For each pointer crossing the boundary, you should be able to state two facts: who frees it, and until when it is valid. If you cannot, you have a bug waiting to happen.

**Model 3: "The boundary is a translation layer for errors too."** Just as it marshals data, the boundary must marshal *errors* — C sentinels in, native exceptions out, and nothing leaks the other way.

**Model 4: "Managed memory is alive and stationary only while you guarantee it."** A raw pointer into GC memory is a promise you make to the GC, not a fact. Hold the object alive and pinned for the duration, or the promise breaks.

---

## Code Examples

### Example 1: Allocator mismatch and its fix (C library with a custom free)

```python
import ctypes

lib = ctypes.CDLL("./libthing.so")

# Suppose thing_serialize() returns a buffer allocated by the library's
# internal allocator, and the docs say "free with thing_free, not free()".
lib.thing_serialize.restype = ctypes.c_void_p
lib.thing_free.argtypes = [ctypes.c_void_p]

buf = lib.thing_serialize(obj)
if not buf:
    raise RuntimeError("serialize failed")
try:
    data = ctypes.string_at(buf, length)   # copy bytes out into Python's heap
finally:
    lib.thing_free(buf)   # ✅ matching deallocator — NOT ctypes' / libc's free
```

Using `libc.free(buf)` here would corrupt the heap, because the library did not allocate it with `malloc`.

### Example 2: Integer-size portability (the LP64/LLP64 trap)

```python
import ctypes

# ❌ FRAGILE: c_long is 8 bytes on Linux/macOS but 4 bytes on Windows.
# If the C function takes size_t, this is wrong on Windows.
lib.process.argtypes = [ctypes.c_long]

# ✅ ROBUST: use the type that matches the C declaration on every platform.
lib.process.argtypes = [ctypes.c_size_t]   # matches size_t everywhere
# For fixed widths, prefer c_int32 / c_uint64 to mirror int32_t / uint64_t.
```

The lesson: **prefer fixed-width and exact-semantic types** (`c_size_t`, `c_int32`, `c_uint64`) over `c_int`/`c_long`, whose width depends on the platform's data model.

### Example 3: Reading `errno` correctly (C, called from Python ctypes)

```python
import ctypes

libc = ctypes.CDLL("libc.so.6", use_errno=True)   # ✅ ask ctypes to capture errno
libc.open.restype = ctypes.c_int
libc.open.argtypes = [ctypes.c_char_p, ctypes.c_int]

fd = libc.open(b"/no/such/file", 0)
if fd == -1:
    err = ctypes.get_errno()          # ✅ read the captured errno, not a stale one
    raise OSError(err, "open failed")
```

Without `use_errno=True`, an intervening Python operation could overwrite `errno` before you read it, and you would report the wrong error. Capture it on the failure path immediately.

### Example 4: Stopping a panic at the boundary (Rust)

```rust
use std::panic::{catch_unwind, AssertUnwindSafe};

// This function is callable from C. A panic must NOT unwind into C.
#[no_mangle]
pub extern "C" fn compute(input: i32) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        do_work(input)   // might panic (e.g. index out of bounds, unwrap)
    }));

    match result {
        Ok(value) => value,
        Err(_) => -1,     // ✅ convert the panic into an error code for C
    }
}
```

Without `catch_unwind`, a panic propagating into the C caller is undefined behavior. The boundary converts it into a sentinel the C side understands.

### Example 5: Keeping a managed object alive across a native call (.NET)

```csharp
// Native function uses a pointer into the managed array while it runs.
byte[] data = GetData();

unsafe
{
    fixed (byte* p = data)          // ✅ pin: the GC may not move 'data' here
    {
        NativeProcess(p, data.Length);
    }
}                                    // unpinned after the block

// In a more subtle case where you pass a pointer that outlives a 'fixed' block,
// GC.KeepAlive ensures the object is not collected before this point:
GC.KeepAlive(data);
```

`fixed` pins the array so the GC cannot relocate it during the call; `GC.KeepAlive` prevents premature collection when the lifetime is harder to express. Both address Hazard Class 4.

### Example 6: Mirroring a struct layout exactly (Go cgo)

```go
/*
typedef struct {
    int32_t  id;       // 4 bytes
    int32_t  flags;    // 4 bytes  (placed here so the 8-byte field is aligned)
    double   weight;   // 8 bytes
} Item;
*/
import "C"

// cgo generates C.Item with the exact same layout from the header above.
// ✅ Let the tool mirror the layout from the real header — do not hand-roll
//    a Go struct with guessed field order or sizes.
func describe(it C.Item) {
    _ = int32(it.id)
    _ = float64(it.weight)
}
```

The safest defense against layout mismatch is to **generate** the binding from the actual C header (cgo, bindgen, SWIG) rather than transcribe field offsets by hand.

---

## Pros & Cons

**Pros of the hazard-class discipline:**

- **Faster diagnosis.** Naming the class narrows the search instantly.
- **Auditable boundaries.** Documented ownership and exact types let a reviewer verify correctness by reading, not just by running.
- **Portability.** Exact-width types and generated bindings survive platform changes.

**Cons / costs:**

- **More upfront rigor.** Documenting ownership and choosing exact types is slower than "make it compile."
- **Tooling overhead.** Generated bindings and sanitizers add build steps.
- **Knowledge load.** You must understand all four classes, not just the one that bit you last.

The trade is worth it: the upfront rigor is far cheaper than a production heap-corruption hunt.

---

## Use Cases

- **Writing the wrapper layer** for a C library that the rest of your codebase will use — the place where all four hazards must be handled once, correctly.
- **Porting an FFI integration across platforms** (Linux to Windows), where LP64/LLP64 and struct-padding differences surface.
- **Adding a native callback** that the C library invokes — the place where error-handling rules (no unwinding into C) and threading rules become critical.
- **Passing large buffers to native code** efficiently without copying, which forces you to handle pinning and lifetime correctly.

---

## Coding Patterns

**Pattern 1: Document ownership in a comment on every boundary function.** "Returns a buffer owned by the caller; free with `thing_free`. Valid until freed."

**Pattern 2: Generate bindings from the real header.** Use cgo, `bindgen`, SWIG, or P/Invoke source generators rather than hand-transcribing signatures and structs.

**Pattern 3: Translate errors at the edge.** C sentinel in, native exception/`Err`/null out. Capture `errno` immediately on the failure path.

**Pattern 4: Wrap every callback body in a catch.** `catch_unwind`/`recover`/`catch(...)`/JNI exception check, so nothing native-language escapes into C.

**Pattern 5: Pin or keep-alive any managed memory shared with native code,** for exactly the duration of the native use, and no longer.

**Pattern 6: Prefer opaque handles.** Have the C library give you a pointer you never dereference, and pass it back on each call. This eliminates struct-layout mismatch entirely for the handle.

---

## Best Practices

1. **Classify before debugging.** Identify the hazard class from the symptom.
2. **One owner per pointer; one free per allocation; matching deallocator.** Document it.
3. **Exact, fixed-width types.** Avoid `int`/`long`; use `int32_t`/`size_t`/`intptr_t` equivalents.
4. **Generate bindings** instead of hand-writing them where possible.
5. **Errno read immediately; errors translated at the boundary.**
6. **No exception/panic crosses into C.** Catch at the edge.
7. **Keep managed memory alive and pinned** while native code holds a pointer to it.
8. **Test under ASan/Valgrind, on every target platform.** Cross-platform CI catches LP64/LLP64 bugs.

---

## Edge Cases & Pitfalls

- **Windows CRT mismatch.** A DLL built against a different C runtime than your program has a *different* heap; `free`-ing across that boundary corrupts memory even though both are "the C `free`."
- **`errno` clobbered by logging.** You call the C function, log "call failed," *then* read `errno` — but logging already overwrote it. Read first.
- **Struct grows in a library update.** The library adds a field to a struct in a new version; your hand-written binding is now too small, and every read past the old end is wrong. Generated bindings + version pinning mitigate this.
- **Pinned too long.** Pinning prevents the GC from moving an object; pinning many objects for a long time fragments the heap and hurts GC performance. Pin narrowly.
- **Callback runs on a thread that cannot touch the runtime.** A C library invokes your callback from a thread it created; touching managed state from there without attaching/locking is a bug (covered in depth at senior level).
- **Sign extension on a small return.** A C function returns `char` (could be negative); naively widening it to a larger unsigned type yields a huge value.

---

## Common Mistakes

1. Using plain `free` on memory a library wants released with its own function.
2. Declaring `long` where the C side uses `size_t`, then porting to Windows.
3. Reading `errno` after an intervening call has overwritten it.
4. Letting a panic/exception unwind into C.
5. Handing the GC's movable memory to C without pinning, then crashing only when the GC happens to run.
6. Transcribing a struct layout by hand and getting the padding wrong.
7. Two owners freeing the same pointer.

---

## Tricky Points

- **"It passes on Linux" hides LP64/LLP64 bugs.** The same code corrupts on Windows because `long` changed size. Type bugs are platform-shaped.
- **GC bugs are timing-shaped.** They appear only when the collector happens to run during the native call — often rare in tests, common under production load.
- **`errno` is a moving target.** Its value is only trustworthy for one instant. Treat it like a volatile reading you must sample immediately.
- **A struct that "works" can still be wrong.** If the mismatch is in a field you do not currently read, the bug is latent until someone reads it.

---

## Test Yourself

1. Name the four hazard classes covered here and one defense for each.
2. Why does `long` make FFI code non-portable between Linux and Windows 64-bit?
3. Why must you read `errno` on the line immediately after the failing call?
4. What two distinct things can a moving, collecting GC do to a managed object that native code points at, and what is the fix for each?
5. Why is letting a panic unwind into C undefined behavior, and how do you prevent it in Rust?
6. Why is an opaque handle a safer interface shape than passing a struct by value?

<details>
<summary>Answers</summary>

1. Ownership/lifetime (one owner, matching free, documented contract); ABI/type mismatch (exact fixed-width types, generated bindings); error handling (translate at the edge, never unwind into C, read errno immediately); GC vs native pointers (keep alive + pin). 
2. `long` is 8 bytes on LP64 (Linux/macOS) but 4 bytes on LLP64 (Windows), so a binding using it reads/writes the wrong number of bytes after a port.
3. Any intervening call — including logging — may overwrite `errno`; it is only meaningful immediately after the failing call.
4. It can *collect* it (fix: keep it reachable, e.g. `GC.KeepAlive`) and *move* it (fix: pin it, e.g. `fixed`/`GCHandle Pinned`).
5. C frames are not built to be unwound through; doing so is UB. In Rust, wrap the body in `catch_unwind` and convert the panic to an error code.
6. The handle is never dereferenced by you, so there is no struct layout to get wrong; the library owns its internals entirely.

</details>

---

## Cheat Sheet

| Hazard class | Symptom | Defense |
|--------------|---------|---------|
| Ownership / lifetime | Leak, double-free, use-after-free | One owner, matching free, documented contract, RAII/`defer`/`finally` |
| ABI / type mismatch | Wrong values; platform-specific corruption | Fixed-width types, generated bindings, mirror struct layout, cross-platform CI |
| Error handling | Crash on error path; exception crosses C | Translate sentinels at edge; read `errno` immediately; catch at boundary |
| GC vs native pointer | Crashes only when GC runs | Keep alive (`GC.KeepAlive`) + pin (`fixed`, `GCHandle`, JNI critical) |

---

## Summary

FFI failures fall into four recognizable hazard classes. **Ownership and lifetime** bugs (leaks, double-frees, use-after-free, dangling pointers) come from unclear or mismatched contracts about who frees what; the defense is one documented owner per pointer and the matching deallocator. **ABI and type mismatches** are the "compiles, then corrupts" family — wrong sizes (LP64/LLP64), signedness, struct padding, calling convention — defended with exact fixed-width types and generated bindings tested on every platform. **Error-handling** bugs come from mixing C sentinels with high-level exceptions; the rules are translate at the edge, read `errno` immediately, and never unwind a panic/exception into C. **GC-versus-native** bugs appear when the collector frees or moves an object native code still points at; keep the object alive and pin it for the duration. Classify the symptom, apply the matching defense, and verify under ASan/Valgrind across platforms.

---

## Further Reading

- Your language's FFI reference, focusing on its memory-ownership and threading guarantees: Python `ctypes`/`cffi`, Go `cgo`, Java JNI, .NET P/Invoke, Rust `std::ffi` and the Rustonomicon's FFI chapter.
- The .NET docs on `GC.KeepAlive`, `GCHandle`, and `fixed`.
- The JNI specification's sections on local/global references and exception handling.
- The sibling topics on data marshalling and memory layout, and on calling conventions and the ABI.

---

## Related Topics

- Data marshalling and memory layout — the mechanics behind struct-layout and type-size mismatches.
- Calling conventions and the ABI — why a wrong convention corrupts the stack.
- Concurrency and threading — the threading hazards of FFI, expanded at the senior level.
- The security section — untrusted input crossing the boundary as an attack surface.
