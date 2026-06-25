# What Is an ABI — Senior Level

> **Topic:** [What Is an ABI](README.md)
> **Focus:** Platform ABIs in depth (System V AMD64, Windows x64, AArch64 AAPCS), the C++ ABI problem (why C++ libraries don't interoperate across compilers), and ABI versioning as a production discipline.

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

> Focus: **Why is the C ABI a stable lingua franca while the C++ ABI is a minefield, and how do real platform ABIs differ in ways that bite production systems?**

At the senior level, "what is an ABI" stops being a definition and becomes a set of *concrete platform contracts you have to reason about under pressure*: a customer's plugin built with MSVC won't load into your MinGW host; a shared library upgrade segfaults a service that was working an hour ago; a struct passed from Rust to a C library reads garbage on ARM but works on x86. Every one of these is an ABI question, and the senior engineer is the person who can name the exact clause being violated.

This level does three things. First, it contrasts the major **platform ABIs** — System V AMD64 (Linux/macOS/BSD), Windows x64, and AArch64 AAPCS64 — so you understand *why* the same C source produces non-interoperable binaries across them, and which clauses differ (argument registers, shadow space vs red zone, struct passing, the LP64/LLP64 split). Second, it dissects the **C++ ABI problem**: why two C++ compilers can compile the same header and produce libraries that won't talk to each other, broken down into its three independent causes — name mangling, vtable layout, and exception handling. Third, it treats **ABI versioning** as an operational discipline: glibc symbol versioning, the libstdc++ dual-ABI `std::string` saga, and how to evolve a shared library without breaking the binaries that already depend on it.

The unifying theme: the C ABI is small, frozen, and platform-standardized, which is exactly why everyone routes interop through it. C++ adds vtables, exceptions, templates, and standard-library types, none of which the C ABI describes — so C++ needs its *own* ABI, and the lack of a single agreed-upon one is the root of nearly all C++ interop pain.

---

## Prerequisites

- **Required:** Middle-level fluency: you can read a calling convention off disassembly, inspect struct padding, and demangle symbols.
- **Required:** You understand shared libraries, dynamic linking, and the difference between link-time and runtime symbol resolution.
- **Required:** Working knowledge of C++ — virtual functions, exceptions, the standard library — enough to reason about how they compile.
- **Helpful:** You have shipped or consumed a binary library across compilers or platforms.
- **Helpful:** Familiarity with `ldd`, `readelf -V`, `objdump`, and `nm` workflows.

---

## Glossary

| Term | Definition |
|------|-----------|
| **System V AMD64 ABI** | The calling/object ABI used by Linux, macOS, and BSD on x86-64. Six integer arg registers, red zone, no shadow space. |
| **Windows x64 ABI** | Microsoft's x86-64 ABI. Four register arguments, 32-byte shadow space, no red zone, different callee-saved set. |
| **AAPCS64** | The ARM 64-bit Procedure Call Standard (AArch64). Eight integer arg registers (`x0`–`x7`), eight SIMD (`v0`–`v7`). |
| **Itanium C++ ABI** | The de-facto cross-Unix C++ ABI (name despite Itanium's death). Used by GCC and Clang on Linux/macOS. Defines mangling, vtables, exceptions, RTTI. |
| **MSVC C++ ABI** | Microsoft's incompatible C++ ABI on Windows: different mangling, different vtable layout, different exception model (SEH-based). |
| **vtable** | The virtual function table — an array of function pointers a polymorphic object points to. Its layout is part of the C++ ABI. |
| **Name mangling** | Encoding a C++ function's name and signature into a unique symbol. Itanium and MSVC schemes differ entirely. |
| **Symbol versioning** | An ELF mechanism (glibc) letting one library export multiple versions of the same symbol (e.g. `memcpy@GLIBC_2.2.5` vs `@GLIBC_2.14`). |
| **soname** | The "shared object name" recorded in an ELF library (`libfoo.so.1`); the linker/loader matches major versions through it. |
| **Dual ABI** | libstdc++'s coexistence of the old and new `std::string`/`std::list` ABIs, selected by `_GLIBCXX_USE_CXX11_ABI`. |
| **ODR (One Definition Rule)** | C++'s rule that an entity has exactly one definition program-wide. ABI violations often manifest as ODR violations across libraries. |
| **LP64 / LLP64** | Data models: LP64 (`long`=8, Unix) vs LLP64 (`long`=4, Windows) on 64-bit. |
| **Red zone / shadow space** | System V's 128-byte scratch below `rsp` vs Windows's 32-byte caller-reserved area above the return address. Mutually incompatible. |

---

## Core Concepts

### 1. Why the Same C Source Differs Across Platform ABIs

A single C function compiled for Linux, Windows, and ARM produces three different binaries that cannot call each other, even on conceptually identical hardware. The differences are the platform ABIs:

| Clause | System V AMD64 (Linux/mac/BSD) | Windows x64 | AArch64 AAPCS64 |
|--------|--------------------------------|-------------|-----------------|
| Integer arg registers | `rdi, rsi, rdx, rcx, r8, r9` (6) | `rcx, rdx, r8, r9` (4) | `x0`–`x7` (8) |
| Float arg registers | `xmm0`–`xmm7` | `xmm0`–`xmm3` | `v0`–`v7` |
| Return register | `rax` / `xmm0` | `rax` / `xmm0` | `x0` / `v0` |
| Caller-reserved stack | 128-byte **red zone** below `rsp` | 32-byte **shadow space** above return addr | (no red zone) |
| `long` size | 8 bytes (LP64) | 4 bytes (LLP64) | 8 bytes (LP64) |
| Struct passing | classify ≤16B into regs | ≤8B by value in 1 reg, else by pointer | up to 16B in regs, HFA rules |

The Windows convention passing only four arguments in registers, with mandatory shadow space, is fundamentally incompatible with System V's six-register, red-zone model — a function compiled for one and called as the other corrupts the stack and reads arguments from the wrong registers. This is why "it's the same x86-64 CPU" does not mean "the binaries are interchangeable." The CPU is the same; the ABI is not.

### 2. The x86 Legacy: cdecl, stdcall, fastcall

Before x86-64 unified things, 32-bit x86 had a zoo of calling conventions, and you still meet them in Windows headers and legacy code:

- **cdecl** — the C default. Arguments pushed right-to-left on the stack; the **caller** cleans up. Supports variadic functions (the caller knows the arg count). Names decorated with a leading underscore (`_func`).
- **stdcall** — the Win32 API convention. Arguments on the stack right-to-left, but the **callee** cleans up. Cannot be variadic. Names decorated like `_func@12` (the number is the bytes of arguments).
- **fastcall** — passes the first two arguments in `ecx`/`edx`, the rest on the stack; callee cleans up. Decorated `@func@12`.

The senior point: on 32-bit x86 the calling convention is *not implied by the platform* — it is per-function, declared in the header (`__cdecl`, `__stdcall`). Get it wrong and the stack is cleaned by the wrong party, corrupting it. x86-64 mercifully collapsed this to one convention per OS, but the historical zoo still shows up in Win32 declarations and FFI bindings.

### 3. The C++ ABI Problem, Decomposed

Here is the central senior insight: **C++ has no single universal ABI, and that is why C++ libraries don't reliably interoperate across compilers.** The problem decomposes into three *independent* incompatibilities. Two compilers must agree on *all three* to interoperate, and the two major families — Itanium (GCC/Clang) and MSVC — agree on *none*.

**(a) Name mangling.** Itanium mangles `int foo(int)` to `_Z3fooi`; MSVC mangles it to `?foo@@YAHH@Z`. Completely different schemes. A symbol exported by one is invisible to the other.

**(b) Vtable layout.** A polymorphic object holds a pointer to a vtable — an array of function pointers. *Where* the vtable pointer sits in the object, *what order* the virtual functions appear in the table, where RTTI and the typeinfo pointer live, and how multiple/virtual inheritance arranges multiple vtables — all of this differs between Itanium and MSVC. Even if you could find the right symbol, calling a virtual function through a mismatched vtable jumps to the wrong slot.

**(c) Exception handling.** Itanium uses a table-driven, DWARF-based unwinding model (`__cxa_throw`, `.eh_frame`, the Itanium EH ABI). MSVC uses an SEH-based model. A C++ exception thrown in a GCC-built library cannot be caught in an MSVC-built one; the unwinder doesn't understand the other's tables. Worse, an exception that unwinds *across* an incompatible boundary typically calls `std::terminate` or corrupts the stack.

Add standard-library type layout (`std::string`, `std::vector` have different internal layouts between libstdc++, libc++, and the MSVC STL) and template instantiation, and you have the full picture: passing a `std::string` across a compiler boundary is undefined behavior because the two sides disagree about what a `std::string` *is* in memory.

### 4. `extern "C"`: Escaping to the Stable C ABI

The escape hatch from all of section 3 is to expose **only a C ABI** at the boundary:

```cpp
extern "C" {
    void*  obj_create();
    int    obj_method(void* self, int arg);
    void   obj_destroy(void* self);
}
```

`extern "C"` does three things at once: disables name mangling (plain symbol `obj_create`), and — by restricting you to C types and no exceptions/vtables across the line — sidesteps vtable layout and exception-handling incompatibility entirely. The C ABI has none of C++'s problem features, so it is the same across every compiler on a platform. This is why every cross-language and cross-compiler interface is a C interface, even when both sides are written in C++. The cost: you marshal everything into C types (opaque pointers, primitive scalars, no exceptions across the line, no templates), losing C++'s expressiveness at the seam.

### 5. ABI Versioning: Symbol Versioning in glibc

How does glibc ship a new `realpath` or `memcpy` without breaking every binary ever linked against it? **Symbol versioning.** A single `libc.so.6` exports multiple versioned definitions of the same symbol:

```text
memcpy@GLIBC_2.2.5      (old behavior)
memcpy@@GLIBC_2.14      (new default; @@ marks the default version)
```

A binary linked years ago recorded a dependency on `memcpy@GLIBC_2.2.5`; the loader binds it to the old implementation. A freshly linked binary binds to `memcpy@@GLIBC_2.14`. Both coexist in one library file. This is how glibc maintains backward compatibility across decades while still fixing and improving symbols. You can see it with `readelf -V` (version definitions and requirements). The famous `memcpy` regression of 2011 — where new glibc's `memcpy` copied backward and broke programs that illegally passed overlapping buffers — was navigated partly through this mechanism.

### 6. The libstdc++ Dual-ABI / `std::string` Saga

The canonical real-world ABI break: in 2015, C++11 required `std::string` and `std::list` to change their internal layout (C++11 banned copy-on-write strings and required O(1) `list::size()`). libstdc++ could not just change `std::string`'s layout — that would break every existing C++ binary that passes a `std::string` across a library boundary. Their solution was the **dual ABI**: both the old (`std::string`) and new (`std::__cxx11::string`) layouts coexist in the same `libstdc++.so`, selected at compile time by the macro `_GLIBCXX_USE_CXX11_ABI` (default 1 on modern systems, 0 for the legacy ABI).

The operational pain this caused — and still causes — is the dreaded link error:

```text
undefined reference to `foo(std::__cxx11::string)`
```

This means one object file was compiled with `_GLIBCXX_USE_CXX11_ABI=1` (new `std::__cxx11::string`) and another with `=0` (old `std::string`), and the mangled names no longer match. The fix is to compile *everything* in the program with the same setting. This single macro has consumed untold engineering hours and is the textbook example of why exposing standard-library types across a binary boundary is dangerous.

### 7. soname and Major-Version Compatibility

ELF libraries carry a **soname** — `libfoo.so.1` — recorded in the binary. The convention: the *major* number changes on an ABI break, and the loader matches binaries to libraries by soname. A program linked against `libfoo.so.1` will load `libfoo.so.1.2.3` (a compatible point release) but will refuse `libfoo.so.2` (an ABI-incompatible major bump). This is the mechanism that operationalizes "ABI break = major version." Libraries that get this wrong — bumping the soname when nothing broke, or *not* bumping it when the ABI did break — cause either needless rebuilds or silent corruption. Tools like `abidiff` (libabigail) compare two builds of a library and report whether the ABI actually changed, removing the guesswork.

### 8. AArch64 AAPCS64 Specifics Worth Knowing

ARM's 64-bit ABI is increasingly relevant (Apple Silicon, AWS Graviton, mobile). Key clauses that differ from x86-64:

- Eight integer argument registers `x0`–`x7` and eight SIMD/FP registers `v0`–`v7` — twice System V's integer count, so more arguments stay in registers.
- **Homogeneous Floating-point Aggregates (HFA):** a struct of up to four identical floating-point members (e.g. `struct { float a, b, c, d; }`) is passed in consecutive SIMD registers — a rule with no x86-64 analogue.
- Apple's AArch64 ABI deviates from the generic AAPCS64 in argument-passing for variadic functions and in some alignment rules — a subtle source of bugs when porting Linux-ARM code to macOS-ARM.

The lesson: even within "AArch64," there are dialects. The ABI is the platform's, not the CPU's.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **C ABI as lingua franca** | Diplomatic protocol conducted in a simple shared language; everyone agrees to use it precisely *because* it's minimal and unambiguous. |
| **C++ ABI problem** | Two legal systems using the same words ("contract," "tort") with different definitions, procedures, and courts — documents don't transfer. |
| **vtable mismatch** | Two elevators with the same buttons wired to different floors. Press "3," arrive at "7." |
| **Symbol versioning** | A phone system that keeps the old extension working while adding a new one for the same person; old callers reach the old desk. |
| **Dual ABI (`std::string`)** | A building mid-renovation running both the old wiring and new wiring in parallel; an appliance must be plugged into the matching system. |
| **soname major bump** | A power-plug standard change that forces a new socket shape (major version) so old appliances physically can't plug into the incompatible new supply. |
| **Windows shadow space vs red zone** | Two restaurants with opposite tipping customs; follow the wrong one and the bill is wrong for everyone after you. |

---

## Mental Models

### The "Three Independent Locks" Model (C++ ABI)

C++ interop requires opening three independent locks — mangling, vtable layout, and exception model — and the key for one does not fit the others. Itanium and MSVC supply *different keys for all three*. This model explains why "just rename the symbol" never fixes C++ interop: even with the right symbol, the vtable and exception locks remain shut. The only universal master key is `extern "C"`, which *removes the locks* by removing the features that need them.

### The "Frozen Core, Versioned Skin" Model (ABI evolution)

A well-run shared library has a **frozen core** (the ABI surface that callers depend on) and a **versioned skin** (symbol versioning, sonames, opaque handles) that lets it evolve underneath. Picture the library as a building whose foundation and external connections never move, while the interior is renovated freely. Symbol versioning, `extern "C"` boundaries, and opaque structs are the tools that keep the connections frozen while the inside changes.

### The "Platform, Not Processor" Model

Whenever you reason about an ABI, attach it to the *operating system + toolchain*, never to the CPU alone. "x86-64" is not an ABI; "System V AMD64 on Linux" and "Windows x64" are. The same chip runs two incompatible ABIs. This model stops the common senior-level error of assuming binaries are portable because the hardware matches.

---

## Code Examples

### Watch a C++ symbol differ from its C counterpart

```cpp
// lib.cpp
int  cpp_add(int a, int b)            { return a + b; }   // mangled
extern "C" int c_add(int a, int b)    { return a + b; }   // plain
```

```bash
g++ -c lib.cpp -o lib.o
nm lib.o | grep add
#  _Z7cpp_addii   <- mangled (Itanium): name+signature encoded
#  c_add          <- plain C symbol, callable from anything
```

`_Z7cpp_addii` cannot be reliably found by another compiler or by `dlsym("cpp_add")`. `c_add` can. This is the C++ ABI problem and its escape hatch in three lines.

### A vtable layout you can read

```cpp
struct Base {
    virtual void a();
    virtual void b();
    virtual ~Base();
};
```

```bash
g++ -fdump-lang-class -c base.cpp        # GCC: dumps vtable layout
# Inspect the .class dump: the vtable lists a(), b(), the two destructors,
# the typeinfo pointer — in an order fixed by the Itanium ABI.
```

The *order* of `a`, `b`, the two destructor variants, and the placement of the typeinfo pointer are Itanium-ABI-defined. MSVC arranges them differently. Calling a virtual through a mismatched layout dispatches to the wrong slot.

### Inspect symbol versioning in glibc

```bash
readelf -V /lib/x86_64-linux-gnu/libc.so.6 | grep -A2 memcpy
# Shows multiple versioned definitions: memcpy@@GLIBC_2.14, memcpy@GLIBC_2.2.5
objdump -T /lib/x86_64-linux-gnu/libc.so.6 | grep memcpy
```

This is the live evidence that one library file exports several ABI-versioned implementations of the same function for backward compatibility.

### Reproduce the dual-ABI link error

```bash
# Compile two TUs with different std::string ABIs:
g++ -D_GLIBCXX_USE_CXX11_ABI=1 -c provider.cpp   # new std::__cxx11::string
g++ -D_GLIBCXX_USE_CXX11_ABI=0 -c consumer.cpp    # old std::string
g++ provider.o consumer.o -o app
# undefined reference to `foo(std::__cxx11::basic_string<...>)'
```

The mangled names differ because the string type differs. Compiling both with the *same* macro value resolves it. This is the single most common C++ ABI footgun in the wild.

### Check whether a library upgrade is ABI-compatible

```bash
abidiff libfoo.so.1.0   libfoo.so.1.1
# Reports added/removed/changed symbols and struct layout changes.
# Empty output => ABI-compatible; you can ship without a soname bump.
```

`abidiff` (libabigail) mechanically answers "did I break the ABI?" — far more reliable than eyeballing a diff.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **C ABI at the boundary** | Universal, stable, cross-compiler, cross-language. The only contract everything honors. | Lowest common denominator: no exceptions, no generics, no rich types; everything marshalled to C primitives and opaque pointers. |
| **C++ rich ABI (Itanium)** | Within one toolchain, full C++ — vtables, exceptions, templates, STL — flows freely across libraries. | No cross-compiler guarantee; GCC↔MSVC don't interoperate; STL layout changes break binaries. |
| **Symbol versioning** | Evolve a library while keeping decade-old binaries working in the same `.so`. | Complex to author (version scripts); easy to mis-version and silently break or needlessly churn. |
| **Dual ABI** | Allowed a mandatory `std::string` change without an industry-wide flag day. | Years of confusing link errors; two layouts to reason about; a compile-flag dependency. |
| **Stable platform ABIs** | Ecosystem of pre-built binaries, plugins, drivers that just work. | Freezes design; per-platform divergence (SysV vs Win64 vs AAPCS) means no binary portability. |

---

## Use Cases

- **Shipping a binary SDK** to customers on multiple compilers — you expose a C ABI and an opaque handle, never C++ types, so MSVC and GCC users both link.
- **Designing a plugin ABI** for a host application — you freeze a C-ABI vtable-of-function-pointers struct and version it explicitly.
- **Diagnosing a cross-compiler link failure** — `nm | c++filt` plus knowledge of the dual-ABI macro pinpoints the mangling mismatch.
- **Evolving a long-lived shared library** without breaking installed binaries — symbol versioning, opaque structs, soname discipline, `abidiff` in CI.
- **Porting to ARM (Graviton, Apple Silicon)** — AAPCS64 differs from System V; HFA rules and Apple's variadic deviations must be accounted for.
- **Embedding a C++ engine in a managed runtime** (JNI, .NET, Node) — the boundary is always C, precisely to dodge the C++ ABI problem.

### When NOT to depend on a rich ABI

- Across compilers or compiler-version boundaries you don't control — assume only the C ABI holds.
- Across language boundaries — only C.
- Across a long support window — the smaller the ABI surface, the longer you can keep it stable.

---

## Coding Patterns

### Pattern 1: The C-ABI facade over a C++ implementation

```cpp
// engine.hpp (C++ internals, hidden)
class Engine { /* ... rich C++ ... */ };

// engine_c.h  (the only thing customers see)
#ifdef __cplusplus
extern "C" {
#endif
typedef struct Engine Engine;          // opaque
Engine* engine_create(void);
int     engine_step(Engine*, int);
void    engine_destroy(Engine*);
#ifdef __cplusplus
}
#endif
```

The customer links against a stable C ABI; you keep full C++ inside. No vtables, exceptions, or STL types cross the line.

### Pattern 2: Catch all exceptions at the C boundary

```cpp
extern "C" int engine_step(Engine* e, int x) {
    try {
        return reinterpret_cast<Engine*>(e)->step(x);
    } catch (...) {
        return -1;        // never let a C++ exception unwind across the C ABI
    }
}
```

A C++ exception unwinding through a C frame (or a foreign-compiler frame) is undefined behavior. Convert exceptions to error codes at the seam.

### Pattern 3: Pin the standard-library ABI in the build

```bash
# Enforce one std::string ABI across the whole build, fail otherwise.
add_compile_definitions(_GLIBCXX_USE_CXX11_ABI=1)
```

Set it once, project-wide, and document it. Mixed settings are the dual-ABI link error.

### Pattern 4: Version the plugin ABI explicitly

```c
#define PLUGIN_ABI_VERSION 3
typedef struct {
    int abi_version;             // host checks this first
    int (*init)(void*);
    int (*process)(void*, const char*, size_t);
} PluginVTable;
```

The host refuses to load a plugin whose `abi_version` it doesn't support, turning a future ABI break into a clean rejection instead of a crash.

---

## Best Practices

- **Expose only a C ABI across any boundary you don't fully control** (compiler, language, support window). It is the only universally honored contract.
- **Never pass STL types or throw exceptions across a binary boundary.** Marshal to C primitives and opaque handles; catch-all at the seam.
- **Pin `_GLIBCXX_USE_CXX11_ABI` (and equivalents) project-wide** and document it. Mixed values produce the classic dual-ABI link error.
- **Bump the soname major version on every ABI break,** and never on a compatible change. Run `abidiff` in CI to know which it is.
- **Use opaque handles for anything you might evolve.** Once a struct's fields are public, its layout is frozen forever.
- **Treat the platform (OS + toolchain), not the CPU, as the ABI's owner.** "Same x86-64" never implies binary compatibility.
- **For ARM ports, read AAPCS64 and your vendor's deviations** (Apple's differ from generic). Don't assume x86 struct/variadic behavior carries over.
- **Provide stable C entry points even from C++ libraries** so other languages can bind through one universal interface.

---

## Edge Cases & Pitfalls

- **Throwing through a `noexcept` or foreign-compiler frame** calls `std::terminate` or corrupts unwinding. Exceptions are ABI-bound; they don't cross.
- **Inline functions and templates leak ABI.** An inline function or template instantiated in two TUs with different compiler versions can violate the ODR, producing one definition silently winning — a layout mismatch that crashes far from the cause.
- **Default arguments and `enum` underlying types** are part of the C++ ABI surface in subtle ways; changing them can break binary compatibility while keeping source compatibility.
- **Adding a virtual function** to a base class changes the vtable layout (every later slot shifts) — an ABI break even though source compiles. Adding a *non-virtual* method usually doesn't.
- **Changing a class's member order or adding a data member** changes its size and layout — ABI break. Reserve padding fields up front if you anticipate growth.
- **Mixing libstdc++ and libc++** in one process is generally undefined: two incompatible STL implementations means two incompatible `std::string` layouts.
- **Apple Silicon variadic deviations:** code relying on the generic AAPCS64 variadic rules can misbehave on macOS-ARM. Test on the actual platform.
- **`long double` across ABIs:** 80-bit on x86 System V, 64-bit on Windows/AArch64-some — never in a cross-ABI interface.
- **Static linking does not fully escape the C++ ABI problem:** if two statically linked archives were built with different ABIs, you still get ODR violations at link or runtime.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│           PLATFORM ABIs (same CPU ≠ same ABI)                     │
├──────────────────────────────────────────────────────────────────┤
│             SysV AMD64        Windows x64       AArch64 AAPCS64   │
│ int args    rdi rsi rdx       rcx rdx r8 r9     x0-x7             │
│             rcx r8 r9 (6)     (4)               (8)               │
│ ret reg     rax / xmm0        rax / xmm0        x0 / v0           │
│ scratch     128B red zone     32B shadow space  (none)           │
│ long size   8 (LP64)          4 (LLP64)         8 (LP64)          │
├──────────────────────────────────────────────────────────────────┤
│ x86-32 legacy: cdecl(caller cleans) stdcall(callee cleans,Win32)  │
│                fastcall(ecx,edx + stack)                          │
├──────────────────────────────────────────────────────────────────┤
│           THE C++ ABI PROBLEM = 3 INDEPENDENT MISMATCHES          │
│   1. name mangling   _Z3fooi (Itanium)  vs  ?foo@@YAHH@Z (MSVC)   │
│   2. vtable layout   slot order, RTTI/typeinfo placement          │
│   3. exception model DWARF/Itanium EH   vs  SEH                   │
│   + STL type layout (libstdc++ vs libc++ vs MSVC STL)            │
│   ESCAPE: extern "C" removes the features → stable C ABI          │
├──────────────────────────────────────────────────────────────────┤
│ ABI EVOLUTION TOOLS                                              │
│   symbol versioning  memcpy@GLIBC_2.2.5 vs @@GLIBC_2.14           │
│   dual ABI           _GLIBCXX_USE_CXX11_ABI (std::__cxx11::string)│
│   soname             major bump = ABI break (libfoo.so.1 → .so.2) │
│   abidiff            mechanically detect ABI changes in CI        │
├──────────────────────────────────────────────────────────────────┤
│ SENIOR RULES                                                     │
│   * C ABI for any boundary you don't control                     │
│   * never pass STL / throw exceptions across a boundary          │
│   * opaque handles for anything you might evolve                 │
│   * soname major bump on every ABI break, abidiff in CI          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The same C source compiled for **System V AMD64**, **Windows x64**, and **AArch64 AAPCS64** produces non-interoperable binaries because the platform ABIs differ in argument registers (6 vs 4 vs 8), scratch areas (red zone vs shadow space), and `long` size (LP64 vs LLP64). The ABI belongs to the **platform, not the CPU**.
- The **x86-32 legacy** conventions — cdecl (caller cleans), stdcall (callee cleans, Win32), fastcall — show that a calling convention can be per-function, declared in headers; x86-64 collapsed this to one per OS.
- The **C++ ABI problem** is three independent incompatibilities: **name mangling**, **vtable layout**, and **exception handling** — plus divergent STL type layouts. Itanium (GCC/Clang) and MSVC agree on none, so C++ libraries don't interoperate across compilers.
- **`extern "C"`** is the universal escape: it removes mangling and, by restricting you to C types with no exceptions or vtables across the line, sidesteps the whole C++ ABI problem. This is why every cross-compiler and cross-language interface is a C interface.
- **ABI versioning** is a production discipline: glibc **symbol versioning** lets one library export multiple versioned symbols; **sonames** encode major-version compatibility; **`abidiff`** mechanically detects ABI changes.
- The **libstdc++ dual ABI** (`_GLIBCXX_USE_CXX11_ABI`, `std::__cxx11::string`) is the canonical real-world break: a mandatory C++11 `std::string` layout change handled by coexisting old and new ABIs — and the source of the most common C++ link error in the wild.
- Senior habits: expose a **C ABI** at any boundary you don't control, **never** pass STL types or throw exceptions across a boundary, use **opaque handles** for evolvable state, **bump the soname** on every ABI break, and put `abidiff` in CI.
