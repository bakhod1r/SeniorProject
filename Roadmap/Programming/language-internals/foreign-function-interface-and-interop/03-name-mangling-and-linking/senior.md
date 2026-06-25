# Name Mangling & Linking — Senior Level

> **Topic:** [Name Mangling & Linking](README.md)
> **Focus:** MSVC's mangling scheme, Rust's legacy vs `v0` mangling and `#[no_mangle]`, weak/COMDAT/vague linkage for inline functions and templates, and diagnosing cross-compiler ABI/mangling mismatches.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction

> Focus: **The Itanium scheme is one of several. How does MSVC mangle (differently, and worse)? How does Rust mangle, and why does `v0` exist? And why does the *same* inline function or template appear in twenty object files without a multiple-definition error?**

At middle level the world was Itanium: GCC and Clang, one mangling grammar, `c++filt` to decode. The senior reality is that **there is no single C++ mangling**. Microsoft's compiler (`cl.exe`) uses a completely different, prefix-`?`-based scheme that encodes the same information in an entirely different alphabet. The two are *incompatible*: a C++ library built with MSVC cannot be directly linked against object files from GCC, because the same function `add(int,int)` has a different symbol in each (`_Z3addii` vs `?add@@YAHHH@Z`), and the calling conventions and object layouts differ too. This is *the* reason "you can't mix C++ compilers" and *the* reason `extern "C"` is the only safe cross-compiler C++ boundary.

Rust is its own story. Rust mangles because it has generics, modules, traits, and monomorphization — all of which need distinct symbols. Its *legacy* scheme appended a hash and was lossy and unstable; the modern **`v0`** scheme (RFC 2603) is a documented, demangle-able, hash-free grammar analogous in spirit to Itanium. And `#[no_mangle]` is Rust's `extern "C"`-for-symbols: it forces a plain, unmangled name so other languages can call in.

The deepest senior topic here is **vague linkage**: inline functions, templates, vtables, and certain statics are *emitted in every translation unit that uses them*, so the same symbol legitimately appears in many object files. If the linker treated those as multiple definitions, nothing would compile. Instead they're emitted as **weak/COMDAT** symbols, and the linker *folds* them — keeps one, discards the rest. Understanding weak vs strong symbols, COMDAT groups, and why an ODR violation across these can *silently pick one definition and corrupt your program* is a senior-grade skill, because these bugs don't error out — they miscompile.

> 🎓 **Why this matters at senior level:** When you ship a library that others link, or you integrate prebuilt binaries, or you debug a heisenbug that turns out to be an ODR violation across two differently-compiled translation units, you need the full picture: which mangling, which linkage, which definition won and why. This is where "the linker is magic" becomes "I can predict and control exactly what the linker does."

This page covers MSVC and Rust mangling, weak/COMDAT/vague linkage, and ABI-mismatch debugging. `professional.md` covers symbol versioning, version scripts, `strip`, and the operational scale picture.

---

## Prerequisites

- **Required:** `junior.md` and `middle.md` — symbols, the Itanium grammar, archives vs shared objects, visibility, `nm`/`c++filt`/`readelf`.
- **Required:** Working knowledge of C++ inline functions, templates, and (helpful) vtables.
- **Required:** Some exposure to Rust, or willingness to read short Rust snippets.
- **Helpful:** Having built C++ on both Linux/macOS and Windows, or at least understanding the toolchain split.
- **Helpful:** Familiarity with the term "ABI" beyond just mangling.

You do **not** need:

- Symbol versioning (`GLIBC_2.x`), version scripts, or `strip` internals (that's `professional.md`).
- The full grammar of MSVC mangling (we cover the readable shape, not every modifier).

---

## Glossary

| Term | Definition |
|------|-----------|
| **MSVC mangling** | Microsoft Visual C++'s name decoration scheme. Begins with `?`, encodes name, scope, calling convention, and types in its own alphabet. Incompatible with Itanium. |
| **`undname`** | The Windows tool that demangles MSVC names (Itanium's `c++filt` equivalent). |
| **Calling convention** | The contract for passing arguments and returning values (`__cdecl`, `__stdcall`, `__thiscall`). MSVC encodes it *into* the mangled name. |
| **Rust legacy mangling** | The original Rust scheme: path plus a hash suffix; lossy, version-unstable, hard to demangle reliably. |
| **Rust `v0` mangling** | RFC 2603's deterministic, hash-free, demangle-able scheme. Symbols start with `_R`. |
| **`#[no_mangle]`** | A Rust attribute that emits a function/static under its plain source name, unmangled — the FFI export switch. |
| **`extern "C"` (Rust)** | Declares C calling convention; combined with `#[no_mangle]` to expose C-callable functions. |
| **Weak symbol** | A symbol the linker may override with a strong one, and may safely see multiple definitions of (keeping one). |
| **Strong symbol** | The normal kind: exactly one allowed; a strong overrides a weak. |
| **COMDAT** | A linker mechanism grouping a symbol with its data so duplicate copies across object files are *folded* to one. |
| **Vague linkage** | The C++ notion that inline functions, templates, vtables, etc. are emitted in every using TU and deduplicated by the linker. |
| **ODR violation** | Two *different* definitions of the same entity exist; the linker silently keeps one → undefined behavior, often a heisenbug. |
| **ICF** (Identical Code Folding) | A linker optimization merging *functionally identical* functions into one symbol — distinct from COMDAT folding of *the same* entity. |
| **ABI** (Application Binary Interface) | The full binary contract: mangling, calling convention, struct layout, vtable layout, exception model. |

---

## Core Concepts

### 1. MSVC mangling: same job, different alphabet

Microsoft's compiler decorates C++ names too, but the scheme is unrelated to Itanium. It starts with `?`, and crucially it encodes the **calling convention** and **storage class** in addition to name and types. `add(int, int)` becomes:

```text
  GCC/Clang (Itanium):  _Z3addii
  MSVC:                 ?add@@YAHHH@Z
```

Reading the MSVC form roughly: `?` opens it, `add@@` is the name with an empty scope, `Y` marks a free function, `A` is `__cdecl`, the first `H` is the return type (`int`), the next two `H`s are the `int` parameters, `@Z` terminates. A member function `Point::dist(int) const` looks like `?dist@Point@@QEBAHH@Z` — `Point@@` is the class scope, `QEBA` packs access/`const`/calling-convention, etc. It is denser and far less readable than Itanium, and the demangler is `undname` (or `dumpbin /symbols` on the object file), not `c++filt`.

Two operational facts dominate:

- **MSVC and Itanium are mutually unintelligible.** You cannot link `.obj` files from `cl.exe` against `.o` files from `g++` and expect C++ symbols to resolve — the names differ and the ABIs differ. Even two *MSVC* versions can differ in the standard library ABI.
- **The calling convention is part of the name.** Change `__cdecl` to `__stdcall` and the symbol changes. On 32-bit Windows especially, a calling-convention mismatch shows up as an unresolved-symbol link error — which is the linker doing you a favor by catching it.

### 2. Rust mangling: legacy vs `v0`

Rust mangles because monomorphized generics, modules, traits, and closures all produce distinct functions that need distinct symbols. The **legacy** scheme produced names like:

```text
_ZN4core3fmt5write17h2e8f9a1b3c4d5e6fE
                                ^^^^^^^^^^^^^^^^^ disambiguating hash
```

It reused the Itanium `_ZN…E` envelope but appended a compiler-internal **hash** to disambiguate, which made names *lossy* (you couldn't always reconstruct generic arguments) and *unstable* across compiler versions.

The modern **`v0`** scheme (RFC 2603, opt-in via `-C symbol-mangling-version=v0`, increasingly the default) starts with `_R` and is a fully specified, hash-free, reversible grammar that encodes generic parameters precisely:

```text
_RNvCs1234_5cratename3foo      (v0: starts _R, no hash, demangle-able)
```

Use `rustfilt` (or recent `c++filt`, which learned `v0`) to demangle. The point for a senior: **Rust symbols are mangled and version-fragile by default**, which is exactly why you don't expose mangled Rust symbols across an FFI boundary.

### 3. `#[no_mangle]` and `extern "C"`: Rust's FFI export switch

To call Rust from C (or any FFI), you must give the function a stable, unmangled, C-callable symbol:

```rust
#[no_mangle]
pub extern "C" fn rust_add(a: i32, b: i32) -> i32 {
    a + b
}
```

`extern "C"` sets the C calling convention; `#[no_mangle]` forces the plain symbol name `rust_add` (not `_RNv...`). Without `#[no_mangle]`, the C side can't find the symbol (it's mangled and version-dependent); without `extern "C"`, the calling convention is Rust's, which C doesn't speak. Both are required — this is the exact analogue of `extern "C"` in C++.

### 4. Vague linkage: why the same symbol appears everywhere

Consider an inline function or a template in a header included by 50 source files. Each translation unit that *uses* it emits its *own* copy of the machine code (the compiler can't know which TU will be the "owner"). Naively that's 50 definitions of one symbol — a multiple-definition catastrophe. C++ resolves this with **vague linkage**: such symbols (inline functions, instantiated templates, vtables, RTTI, static data members of templates) are emitted as **weak/COMDAT** symbols, and the linker is told *"these are all the same entity; keep one, discard the rest."*

This is why you can put an `inline` function or a template in a header, include it everywhere, and not get a link error. The linker **folds** the duplicates.

### 5. Weak vs strong symbols, and COMDAT folding

- A **strong** symbol must be unique; two strong definitions → multiple-definition error.
- A **weak** symbol may be defined multiple times; the linker keeps one. A **strong** definition *overrides* a weak one (this is how you provide a default that can be overridden — e.g. `__attribute__((weak))`).
- **COMDAT** (the section-grouping mechanism, called COMDAT on both ELF and PE/COFF) is how vague-linkage symbols are tagged so the linker knows "all copies of `_Z3maxIiET_S0_S0_` are interchangeable — pick any one."

The folding rule: among interchangeable COMDAT copies, the linker keeps the first (or one per its policy) and drops the rest. **This is correct only if the copies really are identical.** When they're not — when two TUs were compiled with different flags, different `#define`s, or different struct definitions and emitted *different* code under the *same* symbol — you have an **ODR violation**, and the linker silently keeps one. The program links, runs, and behaves according to whichever copy won. No error. This is one of the nastiest senior-level bugs.

### 6. The ODR violation that silently wins

A concrete, classic ODR trap: two `.cpp` files include a header defining `struct Config`, but one is compiled with `-DDEBUG` that adds a field, so `sizeof(Config)` differs between TUs. The header's `inline Config make_config()` is emitted in both, with *different* layouts, under the *same* weak symbol. The linker folds them to one. Now half the program thinks `Config` is 16 bytes and half thinks it's 24, but only one `make_config` body runs — fields are written at the wrong offsets, and you get memory corruption that has *nothing to do with the line where it manifests*. The fix is discipline: identical definitions across all TUs, consistent flags, no flag-dependent struct layouts in shared headers.

### 7. ABI mismatch is more than mangling

Mangling is the *visible* part of the ABI, but a true cross-compiler mismatch involves more: calling convention, struct/class layout, vtable layout, name of the standard-library symbols (libstdc++ vs libc++ vs MSVC STL), and the exception-handling model. Two libraries can have *matching* C symbol names yet still be incompatible if they assume different `std::string` layouts. This is why the only *guaranteed*-stable cross-compiler C++ interface is a **C interface** (`extern "C"` functions passing only C-compatible types — POD structs, pointers, primitives), and why mature cross-language SDKs expose a flat C API even when implemented in C++ or Rust.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Itanium vs MSVC mangling** | Two countries encoding the same address with different formats — both unambiguous internally, but neither postal service can deliver the other's labels. |
| **Calling convention in the MSVC name** | A shipping label that also encodes *how* to hand over the package (front door vs loading dock); deliver wrong and it bounces. |
| **Rust legacy hash** | A filename with a random suffix to avoid collisions — unique, but you can't tell what's inside from the name. |
| **Rust `v0`** | A structured, parseable filename: project, module, function, generics, all readable. |
| **`#[no_mangle]`** | Insisting your shop sign use plain block letters so any passer-by can read it, not the company's internal code. |
| **Vague linkage / COMDAT folding** | Fifty offices each printing the same standard form; the archivist keeps one master and shreds the duplicates. |
| **ODR violation** | Fifty offices printing forms they *think* are identical but aren't (different fine print); the archivist keeps one at random, and now everyone's working from possibly the wrong version. |
| **ABI mismatch beyond mangling** | Two builders who agree on the door *labels* but disagree on the *floor plan* — the rooms don't line up even though the signs match. |

---

## Mental Models

### The "Many Dialects, One C Lingua Franca" Model

Picture mangling as a set of mutually unintelligible dialects: GCC/Clang speak Itanian, MSVC speaks Microsoftese, Rust speaks `v0`-ish. Within a dialect, communication is perfect. Across dialects, nothing resolves. The one shared trade language everyone learned is **C linkage** — plain, unmangled names with the C calling convention. Every FFI bridge in existence is built on this trade language, which is why `extern "C"` (and `#[no_mangle]`) is the universal export switch.

### The "Print Many, Keep One" Model for Vague Linkage

An inline function or template instantiation is a stamp every using office presses onto its own paperwork. By design, dozens of identical copies exist. The linker is the archivist who, seeing the COMDAT tag "these are interchangeable," keeps exactly one and shreds the rest. The system *only works if the copies are truly identical*. The ODR violation is when the copies *differ but are tagged interchangeable* — the archivist still keeps one, and the mismatch becomes a silent, location-independent corruption.

### The "Symbol Match Is Necessary, Not Sufficient" Model

A resolved symbol means the *name* lined up. It does **not** mean the *meaning* lined up. Calling convention, struct layout, and standard-library version are invisible to symbol resolution. Treat a successful link across compiler/ABI boundaries with suspicion: the name matched, but did the contract? The discipline is to *narrow the boundary to C-compatible types and `extern "C"`*, where the contract is small enough to be stable.

---

## Code Examples

### Comparing Itanium and MSVC for the same function

```cpp
int add(int a, int b) { return a + b; }
```

```text
# Linux / Itanium
$ g++ -c add.cpp && nm add.o
0000000000000000 T _Z3addii

# Windows / MSVC (cl /c add.cpp ; dumpbin /symbols add.obj)
... SECT1 ... External | ?add@@YAHHH@Z (int __cdecl add(int,int))
```

```text
# Demangle MSVC on Windows:
> undname ?add@@YAHHH@Z
int __cdecl add(int,int)
```

Same function, two unrelated symbols. They will never resolve against each other.

### MSVC encodes calling convention into the symbol

```cpp
int __cdecl   f_cdecl(int);     // ?f_cdecl@@YAHH@Z
int __stdcall f_stdcall(int);   // ?f_stdcall@@YGHH@Z   (note Y_A_ vs Y_G_)
```

Changing only the calling convention changes the mangled name. A 32-bit Windows link error like `unresolved external symbol _f@4` vs `f` is almost always a calling-convention/declaration mismatch — the decoration didn't match.

### Rust mangling: legacy vs v0

```rust
// lib.rs
pub fn compute(x: i32) -> i32 { x * 2 }
```

```text
# Legacy mangling (hash suffix)
$ rustc --crate-type=lib -C symbol-mangling-version=legacy lib.rs
$ nm liblib.rlib | grep compute
... _ZN3lib7compute17h9f3c2a1b8e7d6c5fE   (Itanium envelope + hash)

# v0 mangling (hash-free, demangle-able)
$ rustc --crate-type=lib -C symbol-mangling-version=v0 lib.rs
$ nm liblib.rlib | grep compute
... _RNvCsXXXX_3lib7compute              (starts _R, no hash)

$ nm liblib.rlib | rustfilt
... lib::compute
```

The legacy name carries an opaque hash; the `v0` name is structured and reversible.

### Rust callable from C

```rust
// ffi.rs
#[no_mangle]
pub extern "C" fn rust_add(a: i32, b: i32) -> i32 {
    a + b
}
```

```text
$ rustc --crate-type=staticlib ffi.rs -o libffi.a
$ nm libffi.a | grep rust_add
0000000000000000 T rust_add        ← plain, unmangled; C can link it
```

From C:

```c
extern int rust_add(int, int);     /* matches the unmangled symbol */
int main(void) { return rust_add(2, 3); }
```

Drop `#[no_mangle]` and the C side gets `undefined reference to rust_add` — the real symbol was `_RNv...`.

### Vague linkage: the same template symbol in many objects

```cpp
// max.hpp
template <typename T> T mymax(T a, T b) { return a > b ? a : b; }
```

```cpp
// a.cpp
#include "max.hpp"
int  use_a() { return mymax(1, 2); }     // instantiates mymax<int>
```

```cpp
// b.cpp
#include "max.hpp"
int  use_b() { return mymax(3, 4); }     // ALSO instantiates mymax<int>
```

```text
$ g++ -c a.cpp b.cpp
$ nm a.o b.o | grep mymax
a.o: 0000000000000000 W _Z5mymaxIiET_S0_S0_      ← 'W' = weak (COMDAT)
b.o: 0000000000000000 W _Z5mymaxIiET_S0_S0_      ← same weak symbol

$ g++ a.o b.o use.o -o app     # links fine: linker folds the two copies
```

The `W` (weak) marks the COMDAT vague-linkage symbol. Both objects define `mymax<int>`; the linker keeps one. No multiple-definition error — that's vague linkage working.

### A weak symbol as an overridable default

```c
/* default.c */
__attribute__((weak)) int config_value(void) { return 42; }   // weak default
```

```c
/* override.c (optional) */
int config_value(void) { return 100; }   // strong: overrides the weak default
```

If `override.c` is linked, the strong `config_value` wins and returns 100; if not, the weak default (42) is used. This is the mechanism behind overridable library hooks and `__attribute__((weak))`-declared optional functions.

### An ODR violation that links cleanly (do not do this)

```cpp
// header.hpp — included by both files
struct Widget {
#ifdef EXTRA
    int extra;       // present only when EXTRA is defined
#endif
    int id;
};
inline Widget make_widget(int i) { Widget w; w.id = i; return w; }
```

```text
$ g++ -c               a.cpp -o a.o    # Widget = {id}        (4 bytes)
$ g++ -c -DEXTRA       b.cpp -o b.o    # Widget = {extra, id} (8 bytes)
$ g++ a.o b.o -o app                   # LINKS. No error.
```

Two different `make_widget` bodies (different `Widget` layouts) under one weak symbol. The linker folds them, one wins, and now `w.id` is written at the wrong offset in half the program. The link is clean; the behavior is undefined. Consistent flags and never-flag-dependent layouts in shared headers are the only defense.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **MSVC mangling** | Encodes calling convention → catches convention mismatches at link time. | Dense, hard to read; incompatible with Itanium; even MSVC-version drift breaks the STL ABI. |
| **Rust `v0` mangling** | Hash-free, deterministic, demangle-able, encodes generics precisely. | Still version-fragile as an FFI surface; long names. |
| **`#[no_mangle]` / `extern "C"`** | A stable, universal export switch for FFI. | Forfeits overloading/generics at the boundary; you must hand-maintain a flat C surface. |
| **Vague linkage / COMDAT** | Lets inline functions and templates live in headers without multiple-definition errors. | Hides ODR violations: differing definitions fold silently into undefined behavior. |
| **Weak symbols** | Enable overridable defaults and optional hooks. | Subtle override semantics; accidental weak/strong clashes are confusing. |

---

## Use Cases

- **Shipping a cross-language SDK** — implemented in C++/Rust, exposed as a flat `extern "C"` / `#[no_mangle]` C API so any consumer and any compiler can link it.
- **Integrating prebuilt third-party binaries** and diagnosing why their C++ symbols don't resolve against your compiler (mangling/ABI mismatch).
- **Reading Windows link errors** (`unresolved external symbol ?...@@...`) and decoding them with `undname`/`dumpbin`.
- **Putting templates and inline functions in headers** safely, relying on vague linkage — and knowing when an ODR violation is silently corrupting you.
- **Providing overridable defaults** with weak symbols (plugin hooks, test stubs replacing production functions).
- **Debugging a heisenbug** that profiling traces to a function compiled inconsistently across translation units (the classic ODR/flag-mismatch corruption).

---

## Coding Patterns

### Pattern 1: Flat C API over a C++/Rust core

```cpp
// public C++ implementation, private
class Engine { /* ... */ };

// flat, stable, C-callable surface
extern "C" {
    void* engine_create(void)            { return new Engine(); }
    int   engine_run(void* e, int input) { return static_cast<Engine*>(e)->run(input); }
    void  engine_destroy(void* e)        { delete static_cast<Engine*>(e); }
}
```

Opaque `void*` handle plus `extern "C"` functions taking only C-compatible types. This survives compiler and ABI changes that any direct C++ interface would not.

### Pattern 2: Cross-platform export macro

```cpp
#if defined(_WIN32)
#  define EXPORT __declspec(dllexport)
#  define IMPORT __declspec(dllimport)
#else
#  define EXPORT __attribute__((visibility("default")))
#  define IMPORT
#endif

#ifdef BUILDING_MYLIB
#  define MYLIB_API EXPORT
#else
#  define MYLIB_API IMPORT
#endif

extern "C" MYLIB_API int mylib_init(void);
```

The same macro exports when building the library and imports when consuming it, on both PE (MSVC) and ELF (GCC/Clang).

### Pattern 3: Rust FFI boundary

```rust
#[no_mangle]
pub extern "C" fn parser_new() -> *mut Parser { Box::into_raw(Box::new(Parser::new())) }

#[no_mangle]
pub extern "C" fn parser_free(p: *mut Parser) {
    if !p.is_null() { unsafe { drop(Box::from_raw(p)); } }
}
```

Every FFI-exported Rust function is `#[no_mangle] pub extern "C"` and passes only C-ABI types or raw pointers.

### Pattern 4: ODR hygiene for shared headers

- Never make a struct/class layout depend on a `#define` that varies between translation units.
- Compile all TUs that share a header with the *same* relevant flags (`-D`, `-std`, ABI flags).
- Treat inline functions and templates in headers as code that *must* be byte-identical everywhere.

---

## Best Practices

- **Expose only a C ABI across compiler/language boundaries.** `extern "C"` (C++) and `#[no_mangle] extern "C"` (Rust), passing POD and pointers. This is the only contract that survives ABI drift.
- **Never link C++ objects from different compilers** (GCC `.o` against MSVC `.obj`) or, often, even different major versions of the same compiler/STL. Re-expose through a C boundary instead.
- **Demangle with the right tool per scheme:** `c++filt` (Itanium), `undname`/`dumpbin` (MSVC), `rustfilt` (Rust). Feeding a name to the wrong demangler yields garbage.
- **Prefer `v0` Rust mangling** when you need to inspect or symbolize Rust binaries; it's stable and demangle-able.
- **Treat every inline/template symbol as a vague-linkage symbol** and keep its definition byte-identical across all TUs. ODR violations don't error — they corrupt.
- **Keep build flags consistent** across all TUs sharing a header (especially layout-affecting `-D` and `-std`). Inconsistent flags are the #1 cause of silent ODR violations.
- **Use weak symbols deliberately, sparingly,** and document where a strong override is expected.

---

## Edge Cases & Pitfalls

- **Mixing GCC-built and MSVC-built C++ libraries.** The symbols don't match and the ABIs differ; it won't link, or worse, links and corrupts. Use a C boundary.
- **MSVC standard-library ABI drift.** Even between MSVC toolset versions, `std::string`/iterator layouts can change; binaries built with different `/MD` vs `/MT` runtimes mix badly. The symbol may resolve while the layout doesn't.
- **Forgetting `#[no_mangle]` *or* `extern "C"` in Rust FFI.** Missing `#[no_mangle]` → mangled `_R...` symbol the C side can't find. Missing `extern "C"` → wrong calling convention even if the name matched.
- **Calling-convention mismatch on 32-bit Windows.** Declaring a `__stdcall` function as `__cdecl` (or vice versa) changes the decorated name and gives an unresolved-symbol error — read the decoration, not just the bare name.
- **ODR violation across translation units.** Different inline/template definitions (or flag-dependent layouts) under one weak symbol fold silently; the bug manifests far from its cause. The hardest class of linker-adjacent heisenbug.
- **Identical Code Folding (ICF) surprises.** A linker that folds *functionally identical* functions can make two distinct function pointers compare *equal*, breaking code that uses function-pointer identity. Disable ICF (or use `-fno-icf`/`--icf=none`) if you depend on distinct addresses.
- **Weak override not happening.** A weak symbol is only overridden by a strong definition *that the linker actually pulls in*. If the strong definition lives in an archive member nothing else references, it's never pulled, and the weak default wins unexpectedly.
- **`inline` in C vs C++.** C's `inline` linkage rules (C99) differ from C++'s; an `inline` function in a C header without a matching `extern inline` definition can produce a missing-symbol error. The two languages' vague-linkage stories are not identical.

---

## Test Yourself

1. Compile `int add(int,int)` with both GCC and MSVC (or read the symbols given above). Why can these two object files never link against each other for this function? Name two ABI differences beyond the symbol name.
2. Demangle `?dist@Point@@QEBAHH@Z` (with `undname` if you have it). Which part is the class, which is the `const` member marker, which is the calling convention?
3. Build a Rust lib with `legacy` and then `v0` mangling. Compare the symbol for the same function. What does the legacy hash suffix prevent you from recovering?
4. Write a Rust function callable from C. Remove `#[no_mangle]` and observe the C-side link error. Then remove `extern "C"` instead — why is that error different and more subtle?
5. Put a template in a header, instantiate the *same* specialization in two `.cpp` files, and inspect the symbol's binding with `nm`. Why is it `W` (weak)? Why does linking both not produce a multiple-definition error?
6. Reproduce the `Widget`/`-DEXTRA` ODR example. Confirm it links cleanly. Then run it under a sanitizer or add prints to show the layout mismatch. Why did the linker not catch it?
7. Define a `__attribute__((weak))` default function and, in a separate object, a strong override. Show that linking the override changes behavior. Now put the override in an archive nothing else references — does it still win? Why or why not?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│        MANGLING SCHEMES + LINKAGE (SENIOR)                       │
├──────────────────────────────────────────────────────────────────┤
│ Same function add(int,int):                                      │
│   Itanium (GCC/Clang):  _Z3addii        demangle: c++filt        │
│   MSVC (cl.exe):        ?add@@YAHHH@Z   demangle: undname        │
│   Rust v0:              _RNv...          demangle: rustfilt       │
│   Rust legacy:          _ZN..17h<hash>E (lossy, version-fragile)  │
├──────────────────────────────────────────────────────────────────┤
│ MSVC encodes the CALLING CONVENTION in the name:                 │
│   __cdecl YA...  __stdcall YG...  → convention mismatch = link   │
│   error (a feature, not a bug)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Rust FFI export switch (BOTH required):                          │
│   #[no_mangle]  →  plain symbol name                             │
│   extern "C"    →  C calling convention                          │
├──────────────────────────────────────────────────────────────────┤
│ Vague linkage: inline fns, templates, vtables, RTTI emitted in   │
│   EVERY using TU as WEAK/COMDAT → linker FOLDS to one copy.      │
│   nm shows 'W' (weak). No multiple-definition error. By design.  │
├──────────────────────────────────────────────────────────────────┤
│ ODR VIOLATION: differing definitions under ONE weak symbol →     │
│   linker keeps one SILENTLY → undefined behavior, heisenbug.     │
│   Defense: identical defs + identical flags across all TUs.      │
├──────────────────────────────────────────────────────────────────┤
│ Cross-compiler / cross-language safe boundary = C ABI:           │
│   extern "C" / #[no_mangle], pass only POD + pointers.           │
│   A matching symbol name does NOT guarantee a matching ABI.      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- There is **no single C++ mangling.** GCC/Clang use **Itanium** (`_Z…`, demangle with `c++filt`); MSVC uses a `?`-prefixed scheme (`?add@@YAHHH@Z`, demangle with `undname`) that also encodes the **calling convention**. The two are mutually unintelligible — you cannot link C++ across them.
- **Rust mangles** because of monomorphized generics, modules, and traits. The **legacy** scheme appended an opaque, version-fragile hash; the modern **`v0`** scheme (`_R…`) is hash-free, deterministic, and demangle-able with `rustfilt`.
- **`#[no_mangle]` + `extern "C"`** is Rust's FFI export switch — both are required to get a stable, C-callable symbol. It's the exact analogue of C++'s `extern "C"`.
- **Vague linkage** emits inline functions, templates, vtables, and RTTI in *every* using translation unit as **weak/COMDAT** symbols; the linker **folds** the duplicates to one. This is why headers can carry inline/template code without multiple-definition errors.
- A **strong** symbol overrides a **weak** one; weak symbols enable overridable defaults and optional hooks.
- An **ODR violation** — different definitions of the same entity (often via flag-dependent struct layouts) under one weak symbol — folds *silently*, producing location-independent undefined behavior. The link succeeds; the program is wrong.
- **ABI is more than mangling:** calling convention, struct/vtable layout, STL version, and exception model all matter. A matching symbol name is **necessary but not sufficient**.
- The only **guaranteed-stable** cross-compiler/cross-language interface is a **flat C ABI** (`extern "C"` / `#[no_mangle]`, POD and pointers) — which is why every serious SDK exposes one.

---

## Further Reading

- *Itanium C++ ABI* mangling spec — https://itanium-cxx-abi.github.io/cxx-abi/abi.html#mangling
- *Microsoft C++ name decoration / `undname` docs* — https://learn.microsoft.com/cpp/build/reference/decorated-names
- *Rust RFC 2603: the `v0` symbol mangling scheme* — https://rust-lang.github.io/rfcs/2603-rust-symbol-name-mangling-v0.html
- *The Rustonomicon* — FFI chapter, on `#[no_mangle]` and `extern "C"`. https://doc.rust-lang.org/nomicon/ffi.html
- *"What Is the One Definition Rule and Why Do We Care?"* — multiple clear write-ups; cppreference's ODR page is the reference. https://en.cppreference.com/w/cpp/language/definition
- *How To Write Shared Libraries* — Ulrich Drepper, on weak symbols and COMDAT.
- *GCC docs* on `__attribute__((weak))`, COMDAT, and template instantiation linkage.
- *LLVM `lld` docs* on Identical Code Folding (`--icf`).
