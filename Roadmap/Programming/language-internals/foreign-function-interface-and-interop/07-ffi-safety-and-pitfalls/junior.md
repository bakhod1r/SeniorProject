# FFI Safety & Pitfalls — Junior Level

> **Topic:** [FFI Safety & Pitfalls](README.md)
> **Focus:** The moment your safe language calls into C, the safety net disappears. What goes wrong, and the first habits that keep you out of trouble.

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
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What happens to your language's safety guarantees the instant you cross the FFI boundary?** (Answer: they vanish.) And **what is the smallest set of habits that keeps you from corrupting memory or crashing the process?**

A **Foreign Function Interface (FFI)** is the bridge that lets code written in one language call functions written in another — almost always a high-level, memory-managed language (Python, Java, C#, Go, Rust) calling into a lower-level one (C, or C++ exposed through a C interface). You reach for FFI when you need a battle-tested C library (OpenSSL, SQLite, libpng, zlib), when you need raw speed for a hot loop, or when you must talk to an operating-system API that only ships a C header.

Here is the uncomfortable truth that makes this whole topic matter: **the FFI boundary is where a memory-safe language stops being memory-safe.** Inside Python, an out-of-bounds index raises a clean `IndexError`. Inside Java, a bad reference throws `NullPointerException`. Inside safe Rust, the borrow checker rejects use-after-free at compile time. The moment you call across to C, none of that applies. C will happily write past the end of a buffer, free a pointer twice, or hand you back a pointer to memory that no longer exists — and the result is not a clean exception. The result is **undefined behavior**: silent corruption, a crash minutes later in unrelated code, or a security hole.

In one sentence: **FFI is a door in the wall of your safe language, and on the other side of that door there are no guardrails.** This page is about the things that go wrong at that door and the first habits that keep you safe.

> 🎓 **Why this matters for a junior:** Your first FFI bug will not look like an FFI bug. The program will crash in a random place, or print garbage, or work fine on your laptop and corrupt data in production. You will lose hours hunting in the wrong file. Learning to recognize the *shape* of FFI failures — and to suspect the boundary first — is one of the highest-leverage debugging skills you can build early.

This page covers: who owns and frees memory across the boundary, why the types on both sides have to match *exactly*, why a crash on the C side takes down your whole program, and the first defensive habits — null-check everything, read the ownership rules in the docs, and run your code under a memory checker.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to call a function and pass arguments in at least one high-level language (Python, Java, C#, Go, or Rust).
- **Required:** A rough idea of what a **pointer** is — a value that holds the address of some memory, rather than the data itself.
- **Required:** The difference between the **stack** (local variables, automatically cleaned up when a function returns) and the **heap** (memory you allocate explicitly and must free explicitly).
- **Helpful but not required:** Having seen a C function signature, e.g. `int read(int fd, void *buf, size_t count)`.
- **Helpful but not required:** A vague sense that your program is one **process** and a crash anywhere in it kills the whole thing.

You do **not** need to know:

- Calling conventions, name mangling, or ABI details (those live in sibling topics in this section).
- How to write a full Rust `unsafe` wrapper or a complete JNI module (that is `middle.md` and `senior.md`).
- The CPU-level mechanics of stack frames and registers.

---

## Glossary

| Term | Definition |
|------|-----------|
| **FFI** | Foreign Function Interface. The mechanism by which code in one language calls functions compiled from another. |
| **The boundary** | The point in the program where control crosses from one language to the other. Almost everything in this topic is about what can go wrong exactly here. |
| **Native code** | Compiled machine code, usually from C or C++. From the high-level language's point of view, code on the "other side" of the FFI. |
| **Managed code** | Code that runs under a runtime with automatic memory management and safety checks (Java/JVM, C#/.NET, Python, Go). The "safe" side. |
| **Undefined behavior (UB)** | A program operation for which the language standard imposes *no* requirements. Anything may happen: a crash, silent corruption, or apparent success. The defining hazard of C and therefore of FFI. |
| **Ownership** | The question of *who is responsible for freeing* a piece of memory. The single most important contract to get right across an FFI boundary. |
| **Allocator** | The component that hands out and reclaims heap memory (`malloc`/`free` in C, the GC in Java/Go, etc.). Memory must be freed by the *same* allocator that allocated it. |
| **Use-after-free** | Reading or writing memory that has already been freed. Classic UB; a frequent FFI bug. |
| **Double-free** | Calling `free` twice on the same pointer. Corrupts the allocator's bookkeeping; classic UB. |
| **Dangling pointer** | A pointer to memory that has been freed, moved, or gone out of scope. Dereferencing it is UB. |
| **Null pointer** | A pointer that points at "no object," conventionally address 0. C functions often return null to signal failure. Dereferencing it usually crashes. |
| **Marshalling** | Converting data from the representation the high-level language uses into the representation C expects (and back). Where many silent type bugs live. |
| **GC (Garbage Collector)** | The runtime component that automatically frees managed objects when they are no longer reachable. It can free — or even *move* — an object while native code still holds a pointer to it. |
| **Pinning** | Telling the runtime "do not move or collect this object" while native code uses it. |
| **errno** | A thread-local integer in C that holds the error code of the last failing system call. Must be read in a specific, careful way. |
| **Sanitizer / Valgrind** | Tools (AddressSanitizer, Valgrind) that detect memory errors at runtime, including ones that cross the FFI boundary. Your best friend in this topic. |

---

## Core Concepts

### 1. The Boundary Is Where Safety Ends

Picture your program as a walled garden. Inside the wall, your language enforces rules: no reading off the end of an array, no using an object after it is gone, no type confusion. The FFI is a gate in that wall. Step through it into C, and the rules do not follow you. The C compiler trusts you completely — it assumes every pointer is valid, every length is correct, and every contract is honored. When that assumption is wrong, you get **undefined behavior**, not an exception.

The practical consequence: a bug introduced at the boundary may not crash at the boundary. C might scribble one byte past a buffer, corrupting some unrelated piece of data, and your program continues happily for another ten seconds before crashing somewhere that has nothing to do with the real bug. This is why FFI bugs are so painful — the symptom is far from the cause.

### 2. Who Frees What? (Ownership)

This is the single most important question in FFI, and it has exactly one correct answer per pointer: **whoever allocated it must free it, using the matching deallocator.**

When a C library hands you a pointer, you must read its documentation to learn one thing: *do I own this and must free it, or does the library still own it?* There are three common contracts:

- **The library owns it.** You must *not* free it. You may use it until some documented point (often "until you call the next function," or "until you close the handle"). Freeing it yourself is a double-free.
- **You own it; free it with the library's function.** Many libraries allocate with their own internal allocator and require you to call *their* free function (e.g. `sqlite3_free`, `png_destroy_read_struct`), not the generic `free`. Mixing them up corrupts the heap.
- **You own it; free it with `free`.** The library used plain `malloc`, so plain `free` is correct.

Getting this wrong produces leaks (you never free) or corruption (you free with the wrong allocator, or you free something the library still owns).

### 3. The Types Must Match Exactly

When you declare a foreign function in your high-level language, you are *promising* the compiler what the C function's signature looks like — its argument types and return type. The high-level runtime cannot verify this promise. If you say a parameter is a 4-byte integer but C reads it as an 8-byte one, C will read four bytes of garbage past your value. The program **compiles**, runs, and then corrupts data. There is no error message. This "compiles, then corrupts" failure mode is the second great hazard of FFI, right behind ownership.

### 4. A Crash on the C Side Kills Everything

Inside your managed language, an error throws an exception that you can catch. On the C side, a bad memory access does not throw — it sends a **segmentation fault** straight to your process, and the operating system kills the *entire program*. There is no `try/except` that saves you. One bug in one native call takes down your whole service. This lack of isolation is why people sometimes run risky native code in a *separate process* (more on that in higher tiers).

### 5. Null Is the C Way of Saying "Failure"

A huge fraction of C functions return a null pointer to mean "I failed" (allocation failed, file not found, parse error). C does not throw; it returns null and expects *you* to check. If you forget to check and use the pointer, you dereference null and crash. **Null-checking every pointer that crosses the boundary is non-negotiable.**

---

## Real-World Analogies

**The hospital airlock.** A clean operating room (your safe language) connects to the outside world through an airlock (the FFI). Inside the OR, everything is sterile and the rules are strict. The airlock is the one place contamination can enter. You do not relax there — you scrub *harder*: gown up, check everything, assume the outside is dirty. The FFI boundary is that airlock. The discipline goes *up* at the boundary, not down.

**Borrowing a power tool from a neighbor.** When you borrow a tool (a pointer), you must know the deal: do you return it, or did they give it to you to keep? If you keep something they meant to lend, they have nothing (use-after-free). If you try to return something they actually gave you, confusion ensues (double-free). The ownership contract has to be agreed in advance, in plain words. FFI documentation *is* that conversation — read it.

**A phrasebook between two travelers.** Two people who do not share a language communicate through a phrasebook that maps words one-to-one. If the phrasebook says "*rojo* means blue" when it actually means red, both travelers follow it perfectly and still end up completely confused — no one made a "mistake," the *mapping* was wrong. A wrong FFI type declaration is exactly this: both sides behave correctly according to a mapping that lies.

---

## Mental Models

**Model 1: "The boundary is a trust handoff."** Inside your language, the runtime is responsible for safety. At the boundary, *you* become responsible. Visualize every FFI call as a moment where you personally sign off: "I promise this pointer is valid, this length is right, and I know who frees the result." If you cannot honestly sign, do not make the call yet.

**Model 2: "C functions are honest about nothing and trust everything."** A C function will not tell you it failed unless you check its return value. It will not validate your arguments. It assumes you are perfect. Treat every C function as a contract written in fine print that *you* must enforce on both ends.

**Model 3: "Type declarations are unverified promises."** When you write a foreign function declaration, you are not describing the C function — you are *promising* what it looks like, and nobody checks. A wrong promise is a silent, time-bombed corruption. Treat the declaration with the suspicion you would give a security boundary.

**Model 4: "Far from the crash is near the boundary."** When an FFI-using program crashes in a strange place, your first hypothesis should be the boundary, not the place it crashed. Memory corruption travels.

---

## Code Examples

The examples below are intentionally small and show the *shape* of the most common junior-level FFI mistakes, each next to its fix. They use Python `ctypes` and Go `cgo` because those are the most approachable, but the lessons are universal.

### Example 1: The null-check you must never skip (Python `ctypes`)

```python
import ctypes

libc = ctypes.CDLL("libc.so.6")

# strdup allocates a copy of the string and returns a char* (or NULL on failure)
libc.strdup.restype = ctypes.c_char_p
libc.strdup.argtypes = [ctypes.c_char_p]

ptr = libc.strdup(b"hello")

# ❌ DANGER: if strdup failed, ptr is None / null. Using it would crash.
# ✅ Always check before use:
if not ptr:
    raise MemoryError("strdup failed")

print(ptr)  # b"hello"

# ⚠️ strdup used malloc internally — WE now own this memory and must free it.
libc.free.argtypes = [ctypes.c_void_p]
# Note: because restype was c_char_p, Python already copied the bytes out,
# but the underlying malloc'd buffer still leaks unless we free the raw pointer.
```

The two lessons: **null-check the return**, and **understand who owns the result** (`strdup` allocates with `malloc`, so the caller must `free` it).

### Example 2: The wrong `restype` — compiles, then lies (Python `ctypes`)

```python
import ctypes
libc = ctypes.CDLL("libc.so.6")

# strlen returns size_t (8 bytes on a 64-bit system).
# ctypes DEFAULTS the return type to C int (4 bytes) unless you say otherwise.

# ❌ WRONG: no restype set. ctypes assumes int. For short strings it often
#    "works" by luck, then silently breaks for some inputs.
length_wrong = libc.strlen(b"hello")  # may be right today, by accident

# ✅ RIGHT: declare the real return type.
libc.strlen.restype = ctypes.c_size_t
libc.strlen.argtypes = [ctypes.c_char_p]
length_right = libc.strlen(b"hello")  # 5, reliably
```

This is the canonical `ctypes` trap: a missing or wrong `restype`/`argtypes` produces a value that is *sometimes* correct, which is far more dangerous than always wrong, because your tests pass.

### Example 3: Returning a pointer to a local — dangling on arrival (C, called from anything)

```c
/* ❌ BROKEN C function exposed over FFI */
const char *make_greeting(void) {
    char buffer[64];
    snprintf(buffer, sizeof buffer, "hello");
    return buffer;   /* buffer lives on the stack; it is GONE the instant we return */
}
```

When your high-level language calls `make_greeting` and reads the returned pointer, it is reading stack memory that has already been reused. Sometimes it prints "hello," sometimes garbage, sometimes it crashes — classic UB. The fix is to allocate on the heap and document that the caller must free it, or to have the caller pass in a buffer.

### Example 4: Allocator mismatch (Go cgo)

```go
/*
#include <stdlib.h>
#include <string.h>

char* make_copy(const char* s) {
    char* p = malloc(strlen(s) + 1);  // C's malloc
    strcpy(p, s);
    return p;                          // caller must free with C's free
}
*/
import "C"
import "unsafe"

func Copy(s string) string {
    cs := C.CString(s)                 // allocated by C's malloc
    defer C.free(unsafe.Pointer(cs))   // ✅ freed by C's free — matching allocator

    out := C.make_copy(cs)
    defer C.free(unsafe.Pointer(out))  // ✅ make_copy used malloc, so C.free is correct

    return C.GoString(out)             // copies bytes into a Go string (GC-managed)
}
```

The rule on display: **memory `malloc`'d in C is freed by C's `free`** — never by Go's garbage collector, and never by some *other* library's free function. `C.CString` and the strings `make_copy` returns are both C-allocated, so both are released with `C.free`.

### Example 5: Catch the panic before it crosses the boundary (Go cgo callback)

```go
//export Callback
func Callback() C.int {
    // C will call this. If a Go panic unwinds into C, behavior is undefined.
    defer func() {
        if r := recover(); r != nil {
            // ✅ swallow the panic at the boundary; never let it escape into C
            // log r, return an error code instead
        }
    }()

    doRiskyWork()   // might panic
    return 0
}
```

The principle generalizes to every language: **an exception, panic, or error native to your high-level language must not unwind across the boundary into C.** Catch it at the edge and convert it to an error code or a return value the C side understands.

---

## Pros & Cons

**Pros of using FFI at all (why we accept the risk):**

- **Reuse.** Decades of hardened C libraries (SQLite, OpenSSL, libcurl, FFmpeg) are available instantly instead of rewriting them.
- **Performance.** A tight numeric loop in C can run far faster than the equivalent in Python.
- **System access.** Many OS and hardware APIs are C-only.

**Cons / costs you take on at the boundary:**

- **You lose your safety net.** Memory safety, exception safety, and type checking stop at the gate.
- **Bugs are non-local and hard to debug.** The crash is far from the cause.
- **No isolation.** One native crash kills the whole process.
- **Maintenance burden.** Type declarations and ownership contracts must be kept in sync with the C library by hand; a library upgrade can silently break them.
- **Build complexity.** You now need a C toolchain, headers, and the right shared libraries on every machine.

The honest summary: **use FFI when the benefit clearly outweighs the cost, and then treat the boundary with discipline.** It is not free, and the bill arrives as production crashes if you are sloppy.

---

## Use Cases

- **Wrapping a C library.** Calling SQLite from Python, OpenSSL from Go, or zlib from Java — the most common reason juniors meet FFI.
- **Speeding up a hot path.** Pushing a numeric inner loop into C (or a C-exposed Rust function) when the high-level version is too slow.
- **Talking to the OS.** Calling a system API that has no high-level binding.
- **Reusing internal C/C++ code.** A company has a large existing C++ engine and wants to drive it from a Python or Go service.

In every case the value is real — and so is the obligation to handle the boundary carefully.

---

## Coding Patterns

**Pattern 1: Always declare argument and return types.** Never let the FFI tool guess. In `ctypes` set `argtypes` and `restype`; in cgo and JNI the types come from the header, so include the *correct* header.

**Pattern 2: Null-check immediately.** The very next line after any FFI call that can return a pointer should check for null and convert it into an error in your language's own style (an exception, an error value).

**Pattern 3: Free with the matching deallocator, in a `finally`/`defer`/RAII.** Pair every allocation with its release, and use your language's "always runs" mechanism (`try/finally`, `defer`, `with`, RAII) so a release happens even on the error path.

**Pattern 4: Convert at the edge.** Copy C strings and buffers into native objects (a Python `bytes`, a Go `string`, a Java `String`) as soon as possible, then release the C memory. After that you are back in safe territory.

**Pattern 5: Catch your own exceptions at the boundary.** In any function C can call back into, wrap the body so no native-language exception/panic escapes into C.

---

## Best Practices

1. **Read the ownership documentation before you write a single line.** For every function: who allocates, who frees, with which deallocator, and until when is the pointer valid? Write the answer in a comment.
2. **Null-check every pointer that crosses the boundary, every time.** No exceptions.
3. **Set explicit types** (`argtypes`/`restype` in ctypes; correct headers in cgo/JNI). A guessed type is a future corruption.
4. **Run under a memory checker.** Run your tests under AddressSanitizer or Valgrind. These tools catch use-after-free, double-free, leaks, and buffer overruns *across* the boundary, where your language's own tools cannot see.
5. **Keep the boundary small.** The fewer FFI calls and the simpler the data crossing, the fewer places to get it wrong. A thin wrapper around a safe, native-language API is the goal.
6. **Never let an exception/panic escape into C.** Catch it at the edge.
7. **Copy data out, then free.** Get back into your safe language as fast as possible.

---

## Edge Cases & Pitfalls

- **The "works on my machine" type bug.** A wrong integer size or `restype` produces correct results for *some* inputs (small numbers, short strings) and corruption for others. Tests pass; production fails. Always declare types explicitly.
- **The garbage collector moves or frees your data mid-call.** If you hand a managed object's address to C and then the GC runs, the object may be moved or collected while C still uses the old address. (Pinning fixes this; covered in higher tiers.)
- **Pointer to a local.** A C function (or a buffer you allocate in your language) that returns or stores a pointer to stack memory leaves a dangling pointer the instant the frame returns.
- **Forgetting the null terminator.** C strings end with a `\0` byte. If you pass a buffer without one, C string functions read off the end until they hit a zero somewhere in unrelated memory.
- **Freeing with the wrong function.** `free`-ing memory that a library allocated with its own allocator, or vice versa, corrupts the heap. Symptoms appear later, far away.
- **Ignoring the return value.** A C function returns `-1` or null to signal failure and you sail past it, using a result that does not exist.
- **Encoding surprises.** Passing a Unicode string to a C function that expects bytes; the lengths and contents do not match what you think.

---

## Common Mistakes

1. **Skipping the null check** "because it always works in testing."
2. **Letting the FFI tool guess types** instead of declaring them.
3. **Double-freeing** — freeing a pointer the library still owns, or freeing the same pointer twice.
4. **Leaking** — never freeing C-allocated memory because you forgot you owned it.
5. **Freeing with the wrong deallocator** — plain `free` on memory the library wants you to release with *its* function.
6. **Letting an exception/panic unwind into C.**
7. **Debugging in the wrong place** — chasing the crash location instead of suspecting the boundary.

---

## Tricky Points

- **"It worked" is not "it is correct."** Undefined behavior is allowed to look correct. A program with a real FFI bug can pass every test and still be one input away from corruption. Correctness in FFI is argued from the contracts, not observed from a green test run.
- **The error is silent by default.** C does not raise; it returns a sentinel (null, `-1`) and relies on you to check. Silence means you must be proactive.
- **The same word means different things on each side.** `int`, `long`, `bool`, and `char` do not have the same size or signedness in every language and on every platform. Never assume; declare.

---

## Test Yourself

1. Why can an FFI bug crash your program in a place that has nothing to do with the bug?
2. A C function returns a `char*`. What two questions must you answer before using it?
3. What is the danger of *not* setting `restype` on a `ctypes` function whose C version returns `size_t`?
4. Why does a C function returning a pointer to a local stack buffer produce undefined behavior?
5. Why must a panic or exception never unwind across the boundary into C?
6. Name one tool that can detect memory errors that occur on the C side of an FFI call.

<details>
<summary>Answers</summary>

1. Because C writes to invalid memory without crashing immediately; it corrupts unrelated data, and the crash happens later when that corrupted data is used.
2. (a) Is it null (did the call fail)? (b) Who owns it — must I free it, and with which deallocator?
3. `ctypes` defaults the return type to a 4-byte C `int`, but `size_t` is 8 bytes on 64-bit systems. The truncated/garbage value is sometimes right by accident and silently wrong for larger values.
4. The stack frame is destroyed when the function returns, so the pointer immediately dangles; reading it reads reused/garbage memory.
5. The C side has no notion of your language's exceptions; unwinding through C frames it does not understand is undefined behavior.
6. AddressSanitizer (ASan) or Valgrind.

</details>

---

## Cheat Sheet

| Hazard | First-line defense |
|--------|--------------------|
| Null return | Null-check on the very next line |
| Wrong type | Declare `argtypes`/`restype` (or use the correct header) |
| Who frees? | Read the docs; pair alloc with the *matching* free in `finally`/`defer` |
| Double-free / use-after-free | Free exactly once, with the matching deallocator; never free borrowed pointers |
| Dangling pointer | Never return/store a pointer to a stack local |
| Crash kills process | Catch native exceptions/panics at the boundary |
| Silent corruption | Run tests under ASan / Valgrind |
| Hard-to-find bug | Suspect the boundary first |

**The golden rule:** at the boundary, *raise* your discipline; never lower it.

---

## Summary

FFI lets your safe language call C, and the moment it does, the safety guarantees stop. The four things that go wrong most often for a junior are: forgetting to check for a null return, getting the types wrong (which compiles and then silently corrupts), getting ownership wrong (leak, double-free, or use-after-free), and letting a crash or exception cross the boundary. The defenses are simple and non-negotiable: declare types explicitly, null-check every pointer, pair every allocation with the matching free, catch your own exceptions at the edge, copy data into safe native objects quickly, keep the boundary small, and run everything under a memory checker. Most of all, when an FFI-using program misbehaves, suspect the boundary first — the bug is rarely where the crash is.

---

## What You Can Build

- A small Python `ctypes` wrapper around one or two functions of a real C library (e.g. compute a SHA-256 hash with a C crypto library), with correct `argtypes`/`restype` and proper null-checks.
- A Go program using cgo to call a C string function, demonstrating correct allocation and `C.free` of C-allocated memory.
- A deliberately buggy FFI program (wrong `restype`, missing null check, return-pointer-to-local) plus a writeup of what each bug does and how ASan/Valgrind reports it.

---

## Further Reading

- The official FFI documentation for your language: Python `ctypes`, Go `cgo`, Java JNI, .NET P/Invoke, Rust `extern`/`std::ffi`.
- The documentation of any C library you wrap — specifically its memory-ownership and threading sections.
- AddressSanitizer and Valgrind getting-started guides.
- The sibling topics in this section on data marshalling and memory layout, and on calling conventions and the ABI, which explain *why* types must match.

---

## Related Topics

- Data marshalling and memory layout — how data is converted across the boundary, and why struct layouts must match.
- Calling conventions and the ABI — the lower-level reason type and convention mismatches corrupt the stack.
- The security section of the roadmap — the FFI boundary as an attack surface when untrusted input crosses into C.
- Process isolation and inter-process communication — the alternative when native code is too unstable to run in-process.
