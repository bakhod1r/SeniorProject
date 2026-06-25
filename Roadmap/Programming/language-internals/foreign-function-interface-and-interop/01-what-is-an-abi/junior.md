# What Is an ABI — Junior Level

> **Topic:** [What Is an ABI](README.md)
> **Focus:** The difference between source code that compiles together and machine code that *runs* together. Why "it compiled" and "it works" are two different promises.

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

> Focus: **What is an ABI, and why is it different from an API?**

When you write `printf("hello\n")` and call a function from a library, you are relying on two completely separate promises. The first promise is at the level of *source code*: the function is named `printf`, it takes a format string and some arguments, and it returns an `int`. That promise is the **API** — the Application *Programming* Interface. It is the contract you read in a header file or in documentation. It lives in the world of names, types, and signatures.

The second promise is invisible to you, and it operates at the level of *machine code*. When your compiled program actually calls `printf`, the two pieces of code — yours and the library's — have to agree on a huge number of low-level mechanical details that no source file mentions. Which CPU register holds the first argument? Which register holds the return value? How wide is an `int` — 4 bytes or 8? When you pass a `struct`, where do its fields sit in memory, and how much invisible padding is between them? Who cleans up the stack after the call? This second promise is the **ABI** — the Application *Binary* Interface.

In one sentence: **an API is a contract between source files; an ABI is a contract between compiled binaries.** The API lets your code *compile* against a library. The ABI lets your code, once compiled, actually *call into* that library at runtime without corrupting memory or crashing.

> 🎓 **Why this matters for a junior:** The single most confusing class of bug you will eventually hit is "it compiled fine, but it crashes at runtime in a way that makes no sense." A large fraction of those bugs are **ABI mismatches** — two pieces of binary code that agreed on the *names* but disagreed on the *bytes*. Understanding that there are two contracts, not one, is what lets you reason about these bugs instead of just rebuilding everything and hoping.

This page covers: what an API is versus what an ABI is, the concrete things an ABI nails down (argument passing, type sizes, struct layout, the return value, the stack), why the **C ABI** is the universal language that everything speaks at the boundary, and what "ABI stability" means and why it lets you upgrade a shared library without recompiling the world. Deeper levels go into calling conventions in detail, name mangling, the C++ ABI problem, and platform-specific ABIs like System V AMD64 and Windows x64.

---

## Prerequisites

What you should know before reading this:

- **Required:** You can write, compile, and run a simple program in at least one compiled language (C, C++, Rust, Go) or have called a native library from a higher-level one.
- **Required:** What a function call is — arguments go in, a return value comes out.
- **Required:** A rough idea that source code (`.c`, `.cpp`) gets turned into machine code by a compiler.
- **Helpful but not required:** Awareness that programs use *libraries* — files like `.so` on Linux, `.dll` on Windows, `.dylib` on macOS.
- **Helpful but not required:** A vague sense that the CPU has *registers* (tiny fast storage slots) and a *stack* (a region of memory for function calls).

You do **not** need to know:

- Assembly language. We will show a little, but you do not need to write it.
- The exact register names of any platform — that is `senior.md` and `professional.md`.
- How linkers and loaders work in detail.

---

## Glossary

| Term | Definition |
|------|-----------|
| **API (Application Programming Interface)** | A *source-level* contract: function names, parameter types, return types. What you need to **compile** against something. |
| **ABI (Application Binary Interface)** | A *binary-level* contract: how compiled code passes arguments, lays out data, and calls functions. What you need to **run** correctly against already-compiled code. |
| **Calling convention** | The part of the ABI that says *how arguments and return values are passed* — which registers, what order, who cleans the stack. |
| **Register** | A small, extremely fast storage location inside the CPU. Arguments are often passed in registers. |
| **Stack** | A region of memory that grows and shrinks as functions are called and return. Holds local variables and overflow arguments. |
| **Alignment** | A rule that a value of size *N* must sit at a memory address that is a multiple of some number (often *N*). Misalignment is slow or illegal. |
| **Padding** | Unused filler bytes a compiler inserts inside a `struct` so that each field is correctly aligned. |
| **Struct layout** | The exact byte-by-byte arrangement of a struct's fields in memory, including padding. |
| **Name mangling** | How a compiler turns a source name (especially in C++) into the actual symbol name in the binary. |
| **Symbol** | A name in a compiled object file that the linker uses to connect a call to its target (e.g. `printf`). |
| **Object file / executable / shared library** | Files containing machine code. Their *format* (ELF, PE, Mach-O) is part of the platform ABI. |
| **Shared library** | A library loaded at runtime and shared between programs: `.so` (Linux), `.dll` (Windows), `.dylib` (macOS). |
| **ABI break** | A change that makes already-compiled code stop working with a new binary, even if the source still compiles. |
| **C ABI** | The simple, stable, universally-implemented ABI of the C language. The lingua franca everyone uses at the boundary. |
| **`extern "C"`** | A C++ instruction that tells the compiler to expose a function using the plain, stable C ABI instead of the complex C++ one. |

---

## Core Concepts

### 1. Two Contracts, Not One

Imagine a library function:

```c
int add(int a, int b);
```

The **API** contract is everything in that one line of source: the name `add`, two `int` parameters, an `int` result. If your code calls `add(2, 3)` and the header declares it this way, your code *compiles*. That is the whole job of the API.

But compilation is only half the story. When the program runs, your compiled `add(2, 3)` has to physically hand `2` and `3` to the library's compiled `add` and physically receive `5` back. *Where* does `2` go? Into a CPU register? Which one? Onto the stack? At what offset? *Where* does `5` come back? The answers to all of those questions are the **ABI** contract. None of them appear in the source. They are decided by the compiler and the platform.

When two binaries agree on the ABI, the call works. When they disagree — even slightly — you get garbage values, crashes, or silent corruption.

### 2. What an ABI Actually Specifies

An ABI is a thick rulebook. The big-ticket items:

- **Calling convention.** Which registers hold the first, second, third argument; which register holds the return value; what order arguments go in; who is responsible for cleaning up the stack after the call. (We cover this in depth in the next topic.)
- **Data type sizes.** How many bytes is an `int`? A `long`? A pointer? This is *not* the same on every platform — a `long` is 8 bytes on Linux but only 4 bytes on 64-bit Windows.
- **Alignment.** A value of size *N* usually must live at an address that is a multiple of *N*. An 8-byte `double` wants an 8-byte-aligned address.
- **Struct and union layout.** Where each field sits, and how much **padding** the compiler inserts between fields to keep them aligned.
- **Register usage.** Which registers a called function is allowed to clobber, and which it must preserve and restore.
- **The stack frame.** How the stack is arranged during a call, where the return address lives, how local variables are stored.
- **Name mangling.** How source-level names become binary symbols (a big deal in C++, covered later).
- **The object/executable file format.** ELF on Linux, PE on Windows, Mach-O on macOS. The container that holds the machine code.
- **System call convention.** How a program asks the operating system kernel to do something.
- **Exception handling / stack unwinding.** How errors propagate up the call stack.
- **Thread-local storage.** How per-thread variables are found.

For now, focus on the first four — calling convention, sizes, alignment, and struct layout. They are where the everyday bugs come from.

### 3. Type Sizes Are Not Universal

Here is a fact that surprises almost everyone the first time: **`sizeof(long)` is not the same everywhere.**

| Type | Linux/macOS (64-bit) | 64-bit Windows |
|------|----------------------|----------------|
| `int` | 4 bytes | 4 bytes |
| `long` | **8 bytes** | **4 bytes** |
| `long long` | 8 bytes | 8 bytes |
| pointer | 8 bytes | 8 bytes |

This split has names. Linux and macOS use **LP64**: `Long` and `Pointer` are 64-bit. 64-bit Windows uses **LLP64**: only `Long Long` and `Pointer` are 64-bit, while `long` stays 32-bit.

Why does this matter? If you write a struct with a `long` field, compile it on Linux, and then a different program compiled on Windows tries to read that same struct, they disagree about how big the field is and where everything after it lives. The bytes line up wrong. This is an ABI difference baked into the platform, and it is exactly why portable code uses fixed-width types like `int32_t` and `int64_t` at any binary boundary.

### 4. Struct Layout and the Invisible Padding

Consider this struct:

```c
struct Example {
    char  a;   // 1 byte
    int   b;   // 4 bytes
    char  c;   // 1 byte
};
```

You might guess it is 6 bytes (1 + 4 + 1). It is almost always **12 bytes**. The compiler inserts **padding**:

```text
offset:  0      1   2   3   4      5      6   7   8      9  10  11
        [a] [pad pad pad] [   b (4 bytes) ] [c] [pad pad pad]
```

Three padding bytes go after `a` so that `b` starts at offset 4 (4-byte aligned). Then three more padding bytes go after `c` so the *whole struct* is a multiple of 4 (its largest member's alignment). Reorder the fields — put both `char`s together — and you get a smaller struct. The point for now: **a struct's layout in memory is not just the sum of its fields. The ABI dictates the padding.** If two binaries disagree about padding rules, they disagree about where every field is.

### 5. The C ABI: Everyone's Common Language

Every language that wants to talk to the outside world — call a system library, expose a plugin interface, be called from Python or Java or Go — speaks **C at the boundary**. Not C the language, but the **C ABI**.

Why C? Because the C ABI is the simplest, oldest, most stable, and most universally implemented binary contract in existence. It has no classes, no templates, no exceptions, no name mangling to speak of. A C function named `add` is just a symbol named `add` (or `_add`), and its calling convention is fully specified by the platform. Every operating system's libraries expose a C ABI. Every foreign-function interface — Python's `ctypes`, Java's JNI, Rust's `extern "C"`, Go's cgo — connects through the C ABI. It is the universal handshake. When people say "speak C at the boundary," they mean: expose your functionality through the C ABI so anything can call it.

### 6. ABI Stability: Upgrade Without Recompiling

Here is the big payoff of caring about ABIs. Suppose you have a program that uses a shared library — say `libcrypto.so`. A security fix comes out. The maintainers ship a new `libcrypto.so`. Can your already-compiled program use the new library *without being recompiled*?

**Yes — if and only if the ABI did not change.** This is **ABI stability**. If the new library kept every function's calling convention, every struct's layout, every type size identical, then your old binary's expectations still match the new binary's reality. You drop in the new `.so` and everything works. This is how Linux distributions ship security updates to millions of machines without recompiling every program.

If the ABI *did* change — say a struct grew a field, or a function's arguments changed in memory layout — your old program now has *wrong expectations*. It might pass arguments the new code reads incorrectly, or read a struct field at the wrong offset. The result is the dreaded "it used to work, now it crashes" after a library upgrade.

### 7. ABI Break vs API Break — They Are Independent

This is the subtle, important idea. **You can break the ABI while keeping the API intact.**

Suppose a library has:

```c
struct Config {
    int timeout;
};
```

In version 2, the maintainer adds a field:

```c
struct Config {
    int timeout;
    int retries;   // new field
};
```

The **API is unchanged** in the sense that `config.timeout` still compiles. But the **ABI is broken**: `struct Config` went from 4 bytes to 8 bytes. Any already-compiled program that allocates a `Config` based on the old 4-byte size, then passes it to the new library, has a struct that is the wrong size — the new library will read or write `retries` past the end of the caller's memory. Source-compatible, binary-incompatible. The reverse can also happen: you can break the *source* API (rename a function) while the old binary symbol still works. The two contracts move independently, and you have to think about both.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **API** | The *recipe* written in a cookbook: "add two cups of flour." A human-readable instruction. |
| **ABI** | The actual *physical handoff* in the kitchen: which hand passes the bowl, which counter it sits on, how the bowl is oriented. The mechanics, not the words. |
| **Calling convention** | An agreed protocol for passing a baton in a relay race: which hand, at which mark, at what speed. Both runners must agree or the baton drops. |
| **Type size mismatch** | One country measures in inches, another in centimeters. Same number "12," wildly different physical length. |
| **Struct padding** | A muffin tray with fixed-size cups. Even a tiny muffin occupies a whole cup; the gaps are padding. |
| **C ABI as lingua franca** | English at an international airport. Not everyone's native language, but everyone speaks enough of it to coordinate. |
| **ABI stability** | A wall outlet shape that never changes. You can buy a new lamp (new library) and plug it into the old wall (old program) because the plug shape (ABI) is stable. |
| **ABI break with stable API** | The cookbook still says "two cups of flour," but the kitchen secretly swapped to bigger cups. The recipe reads the same; the result is wrong. |
| **`extern "C"`** | A specialist who normally speaks dense jargon (C++) agreeing to speak plain English (C ABI) when talking to outsiders. |
| **Name mangling** | A coat-check system that turns "blue jacket" into a unique ticket number so two identical-looking jackets don't get confused. |

---

## Mental Models

### The Two-Contracts Model

Whenever you connect two pieces of code, picture **two separate handshakes stacked on top of each other**. The top handshake is the API: do the names and types match so it compiles? The bottom handshake is the ABI: do the bytes, registers, and layouts match so it runs? A successful compile only confirms the *top* handshake. The bottom handshake is checked the hard way — at runtime, by whether it crashes. Carrying this picture stops you from assuming "it compiled, so it must be compatible."

### The "Bytes on the Wire" Model

Think of a function call as sending a little message across a wire from caller to callee. The API tells you *what the message means* ("two integers"). The ABI is the **wire format** — the exact byte layout of the message, where each field starts, how wide it is, what order things come in. Two programs can agree perfectly on the *meaning* and still fail because they disagree on the *wire format*. This is the same intuition you have for network protocols, applied to function calls.

### The "Frozen Snapshot" Model (for ABI stability)

When your program is compiled, it takes a **frozen snapshot** of every assumption about the libraries it calls: every struct size, every argument position, every type width. That snapshot is baked into the binary and never updates. A shared library can be swapped underneath your program freely — *as long as the new library still matches the frozen snapshot*. The moment the library's reality drifts from your program's frozen snapshot, you get corruption. ABI stability is the promise "the things in your snapshot will not change."

---

## Code Examples

### Seeing type sizes differ

```c
#include <stdio.h>

int main(void) {
    printf("char       = %zu\n", sizeof(char));
    printf("int        = %zu\n", sizeof(int));
    printf("long       = %zu\n", sizeof(long));
    printf("long long  = %zu\n", sizeof(long long));
    printf("void*      = %zu\n", sizeof(void *));
    return 0;
}
```

On Linux/macOS x86-64 you get `long = 8`. On 64-bit Windows you get `long = 4`. Same source, different ABI. This single difference has broken countless cross-platform programs.

### Seeing struct padding

```c
#include <stdio.h>
#include <stddef.h>

struct Bad  { char a; int b; char c; };   // fields in a wasteful order
struct Good { int b; char a; char c; };   // fields packed tightly

int main(void) {
    printf("Bad  size = %zu\n", sizeof(struct Bad));    // typically 12
    printf("Good size = %zu\n", sizeof(struct Good));   // typically 8
    printf("offset of Bad.b = %zu\n", offsetof(struct Bad, b)); // typically 4
    return 0;
}
```

Same three fields, different sizes, because of padding. The `offsetof` macro reveals where a field actually sits — and *that offset is part of the ABI*. If another binary expects `b` at a different offset, it reads the wrong bytes.

### Exposing a C ABI from C++ with `extern "C"`

```cpp
// mathlib.cpp — compiled as C++ but exposes a C ABI
extern "C" int add(int a, int b) {
    return a + b;
}
```

Without `extern "C"`, a C++ compiler **mangles** the name `add` into something like `_Z3addii` (the encoding includes the argument types). A C program, or Python's `ctypes`, looking for a plain symbol named `add` would not find it. `extern "C"` says: "expose this with the plain, stable C ABI and the plain name `add`." This one keyword is how C++ libraries make themselves callable from everything else.

### Calling a C function from Python (through the C ABI)

```python
import ctypes

# Load a shared library that exposes a C-ABI function `add`.
lib = ctypes.CDLL("./mathlib.so")

lib.add.argtypes = [ctypes.c_int, ctypes.c_int]   # describe the ABI
lib.add.restype  = ctypes.c_int

print(lib.add(2, 3))   # -> 5
```

Python has no idea what C is at the source level. It only needs to know the **ABI**: the symbol name (`add`), the argument types and sizes, and the return type. You are literally describing the binary contract by hand with `argtypes` and `restype`. Get any of those sizes wrong and you read garbage — that is an ABI mismatch you caused yourself.

### A struct ABI break in slow motion

```c
// library v1 — Config is 4 bytes
struct Config { int timeout; };

// library v2 — Config is now 8 bytes, source still "looks" compatible
struct Config { int timeout; int retries; };
```

A program compiled against v1 allocates 4 bytes for a `Config`. If you swap in v2's library without recompiling, the v2 code believes `Config` is 8 bytes and will read or write 4 bytes *past* the caller's allocation. The source never changed for `timeout` — the API looks fine — but the ABI broke. This is the canonical "compiled but crashes" failure.

---

## Pros & Cons

This section is about the **trade-offs of caring about (and committing to) a stable ABI** — the central engineering decision around ABIs.

| Aspect | Pros of a stable ABI | Cons / costs |
|--------|----------------------|--------------|
| **Upgradability** | Ship a new shared library; every existing program benefits without recompiling. Security fixes reach the whole system instantly. | You are *frozen*: you cannot change struct layouts, type sizes, or calling conventions without breaking everyone. |
| **Ecosystem** | A stable C ABI lets every language interoperate. The whole FFI world depends on it. | The lowest-common-denominator (C ABI) is feature-poor: no exceptions, no generics, no rich types across the boundary. |
| **Distribution** | Vendors ship pre-compiled binaries that "just work" across versions. | Hard to evolve. Adding a field to a public struct is a breaking change forever. |
| **Debuggability** | A documented ABI means mismatches are diagnosable, not magic. | ABI bugs are subtle: they often don't crash *at* the mistake, they corrupt memory and crash later. |
| **Performance** | Calling conventions are tuned per platform for speed (registers over stack). | Per-platform tuning means per-platform ABIs — code is not portable at the binary level. |

---

## Use Cases

You need to think explicitly about ABIs when:

- **You ship or consume a shared library** (`.so`, `.dll`, `.dylib`) that other programs link against. Their compiled binaries depend on your ABI staying stable.
- **You write a plugin system.** Plugins are compiled separately and loaded at runtime — they *must* match the host's ABI exactly.
- **You call native code from a managed language** — Python `ctypes`/`cffi`, Java JNI, Node N-API, Go cgo, C# P/Invoke. You are describing an ABI by hand.
- **You expose a C++ library to other languages.** You wrap it in `extern "C"` to present a stable C ABI.
- **You target multiple platforms.** `long` sizes, struct padding, and calling conventions differ between Linux, Windows, and macOS, and between x86-64 and ARM.
- **You debug a "compiled fine, crashes weirdly" bug** across a library boundary. ABI mismatch is a prime suspect.

You can mostly *ignore* ABIs when you compile your entire program from source in one go with one compiler — then the compiler enforces a consistent ABI internally and you never see a boundary.

---

## Coding Patterns

### Pattern 1: Use fixed-width types at any binary boundary

```c
#include <stdint.h>

struct WireMessage {
    int32_t  id;        // exactly 4 bytes, every platform
    int64_t  timestamp; // exactly 8 bytes, every platform
};
```

Never use `int`, `long`, or `unsigned` in a struct that crosses a binary boundary. Use `int32_t`, `uint64_t`, etc., so the size is identical on every platform. This sidesteps the LP64/LLP64 `long` trap.

### Pattern 2: Wrap C++ in `extern "C"` for any public interface

```cpp
extern "C" {
    void*  widget_create(void);
    void   widget_destroy(void* w);
    int    widget_value(void* w);
}
```

Expose an opaque pointer (`void*`) and plain C-ABI functions. Hide all the C++ classes behind them. Now anything — C, Python, Rust, Go — can call your library, and you are free to change the C++ internals without breaking callers.

### Pattern 3: Describe the ABI explicitly when calling foreign code

```python
import ctypes
lib = ctypes.CDLL("./widget.so")
lib.widget_create.restype  = ctypes.c_void_p
lib.widget_value.argtypes  = [ctypes.c_void_p]
lib.widget_value.restype   = ctypes.c_int
```

Always set `argtypes` and `restype`. If you skip them, `ctypes` guesses (defaulting to `int`-sized), which silently truncates pointers on 64-bit systems — a classic ABI bug.

### Pattern 4: Keep public structs opaque

Instead of exposing the fields of a struct (and freezing its layout forever), hand callers an **opaque handle** and provide accessor functions. Then you can change the struct's real layout in a future version without breaking the ABI, because callers never knew the layout to begin with.

---

## Best Practices

- **Treat "it compiled" as proving only the API.** The ABI is checked at runtime. Never assume binary compatibility from a clean compile.
- **Use fixed-width integer types** (`int32_t`, `uint64_t`) for anything that crosses a binary boundary. Avoid `long` like a trap — it is.
- **Speak C at the boundary.** Expose interoperable functionality through the C ABI (`extern "C"` in C++). It is the only contract everything understands.
- **Compile everything in a single program with one compiler and matching flags** where you can. Mixing compilers, standard-library versions, or build flags is a leading cause of ABI mismatch.
- **Keep public structs opaque** if you ever want to evolve them. Once you expose fields, their layout is frozen.
- **When calling foreign code, describe the ABI exactly** — argument types, sizes, return type. Do not let the FFI guess.
- **Be suspicious after a library upgrade.** "Used to work, now crashes" with no source change is a textbook ABI break.
- **Read the platform's ABI document** when you go low-level. There is an official one for each platform; it is the source of truth.

---

## Edge Cases & Pitfalls

- **`long` is 4 bytes on 64-bit Windows.** A struct or function signature using `long` will *not* be binary-compatible between Linux and Windows. Use `int64_t`.
- **Struct padding silently changes the size.** Reordering fields or changing one field's type can shift every later field's offset and break binary compatibility, even when the source still compiles.
- **Forgetting `extern "C"`** in a C++ library means the function gets a mangled name and a C caller or `ctypes` can't find the symbol at all — you get a "symbol not found" load error.
- **Mixing two C++ compilers (or two libstdc++ versions)** can fail because C++ ABIs differ between compilers. Two libraries compiled by different compilers may not link or may crash at runtime even with identical source.
- **Adding a field to a public struct is an ABI break,** not a harmless addition. The struct's size changes; old callers allocate the wrong size.
- **Skipping `argtypes`/`restype` in `ctypes`** lets Python assume `int`-sized arguments and returns, truncating 64-bit pointers to 32 bits on the way in or out. Memory corruption that looks random.
- **Assuming all platforms agree on enum size.** The width of an `enum` is implementation-defined; it can differ across compilers, breaking structs that embed enums.
- **Bit-fields have implementation-defined layout.** Two compilers can pack `int x : 3;` differently. Never put bit-fields in a cross-boundary struct.
- **Endianness** (byte order) is technically separate from the ABI but bites the same way: bytes laid out by a little-endian machine read wrong on a big-endian one.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                  API vs ABI — THE ONE THING                       │
├──────────────────────────────────────────────────────────────────┤
│  API = source-level contract  → lets code COMPILE together        │
│  ABI = binary-level contract  → lets code RUN together            │
│  "It compiled" proves only the API. ABI is checked at runtime.    │
├──────────────────────────────────────────────────────────────────┤
│  An ABI specifies:                                                │
│    * calling convention  (which register holds which arg)         │
│    * type sizes          (int=4, long=? , pointer=8)              │
│    * alignment & padding (struct layout, byte by byte)            │
│    * register usage, stack frame                                  │
│    * name mangling, file format (ELF/PE/Mach-O)                   │
│    * syscall convention, exceptions, thread-local storage         │
├──────────────────────────────────────────────────────────────────┤
│  The long trap:                                                   │
│    Linux/macOS (LP64):  long = 8 bytes                            │
│    64-bit Windows (LLP64): long = 4 bytes                         │
│    → use int32_t / int64_t at any boundary                        │
├──────────────────────────────────────────────────────────────────┤
│  C ABI = the universal handshake                                  │
│    every FFI (ctypes, JNI, cgo, P/Invoke) speaks C at the edge    │
│    extern "C"  → expose a stable C ABI from C++                   │
├──────────────────────────────────────────────────────────────────┤
│  ABI stability = swap a shared library, no recompile, IF the      │
│  ABI is unchanged. Adding a struct field BREAKS the ABI even      │
│  when the source still compiles (API intact, ABI broken).         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- An **API** is a *source-level* contract (names, types, signatures) that lets code **compile** together. An **ABI** is a *binary-level* contract that lets already-compiled code **run** together.
- A successful compile proves only the API. The ABI is verified the hard way — at runtime — and a mismatch shows up as "compiled fine, crashes weirdly."
- An ABI specifies the **calling convention** (which registers hold arguments and the return value), **type sizes**, **alignment and struct padding**, register usage, the stack frame, name mangling, the file format, and more.
- **Type sizes are not universal.** The biggest junior trap is `long`: 8 bytes on Linux/macOS (LP64), 4 bytes on 64-bit Windows (LLP64). Use fixed-width types like `int32_t` at boundaries.
- **Struct layout includes invisible padding.** A struct's size and field offsets are part of the ABI, not just the sum of its fields.
- The **C ABI** is the universal language at the boundary — simple, stable, and implemented everywhere. Every FFI speaks C. `extern "C"` exposes a stable C ABI from C++.
- **ABI stability** is what lets you upgrade a shared library without recompiling callers — *only if* the ABI is unchanged.
- **ABI breaks and API breaks are independent.** Adding a field to a public struct keeps the source compatible (API intact) but changes the struct's size (ABI broken).
- A junior's #1 habit: when you hit a cross-library bug that makes no sense, **suspect an ABI mismatch** — different sizes, different layouts, mismatched compilers, or a missing `extern "C"`.
