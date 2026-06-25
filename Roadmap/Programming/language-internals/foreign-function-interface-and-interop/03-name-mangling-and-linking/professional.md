# Name Mangling & Linking — Professional Level

> **Topic:** [Name Mangling & Linking](README.md)
> **Focus:** Treating the symbol table as a controlled ABI surface — visibility, versioning, weak/COMDAT folding, ODR hygiene, demangling in production tooling, and shipping stable cross-language exports.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
   - [Symbol Visibility as ABI-Surface Control](#symbol-visibility-as-abi-surface-control)
   - [Why Hiding Symbols Speeds Load and Shrinks the ABI](#why-hiding-symbols-speeds-load-and-shrinks-the-abi)
   - [Version Scripts and Module Definition Files](#version-scripts-and-module-definition-files)
   - [Weak Symbols, COMDAT, and Vague-Linkage Folding](#weak-symbols-comdat-and-vague-linkage-folding)
   - [ODR Violations That Silently Pick a Definition](#odr-violations-that-silently-pick-a-definition)
   - [glibc Symbol Versioning](#glibc-symbol-versioning)
   - [Reading Linker Diagnostics](#reading-linker-diagnostics)
   - [Demangling in Stack Traces and Profilers](#demangling-in-stack-traces-and-profilers)
   - [Exposing Rust and C++ Through a C ABI](#exposing-rust-and-c-through-a-c-abi)
   - [strip and the Production Symbol Footprint](#strip-and-the-production-symbol-footprint)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Operational Checklist](#operational-checklist)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

At the professional tier, name mangling and linking stop being a thing the toolchain does to you and become a thing you do to the toolchain. A library that ships to thousands of consumers is, in linker terms, a *contract printed in a symbol table*. Every symbol you export is a promise; every promise you cannot keep forever is a future ABI break, a future `undefined reference`, a future support ticket from a downstream team whose binary loaded yours and found the function gone. The senior tier taught you how mangling encodes types and how the linker folds vague-linkage duplicates. This tier is about governing that surface: deciding which symbols are public, versioning the ones that must evolve, hiding the rest, and reading the toolchain's diagnostics fluently enough to debug a corrupted production binary at 3 a.m.

The unifying idea is **the dynamic symbol table is your ABI, and most of it should not exist**. A default C++ or Rust build exports far more than its public API — every external-linkage function, every template instantiation, every inline helper that happened to get a weak symbol. Each exported symbol enlarges the dynamic symbol table, slows every `dlopen`/program-load because the runtime linker must hash and relocate it, widens the surface that consumers can accidentally depend on, and makes every refactor a potential ABI break. The professional move is to *export nothing by default and opt specific symbols in* — `-fvisibility=hidden` plus explicit `__attribute__((visibility("default")))`, or `__declspec(dllexport)`, or a version script, or a `.def` file. This single discipline shrinks load time, shrinks the ABI, and turns "we accidentally broke a symbol nobody knew we exported" into a compile-time impossibility.

This document covers visibility control on ELF and PE, why hiding helps, weak/COMDAT folding and the ODR violations it hides, glibc's `GLIBC_2.x` symbol versioning, fluent reading of `undefined reference to 'foo(int)'` and `multiple definition` errors, demangling inside stack traces and profilers, the `extern "C"` / `#[no_mangle]` export discipline for Rust and C++, and `strip` as the last step that decides what ships. The senior page covered the mangling schemes themselves and vague linkage mechanics; here we operationalize all of it.

---

## Prerequisites

- **Required:** `junior.md`, `middle.md`, and `senior.md` of this topic — symbols, the Itanium and MSVC mangling schemes, archives vs shared objects, `nm`/`c++filt`/`readelf`/`objdump`, weak/COMDAT and vague linkage.
- **Required:** Practical experience building a shared library (`.so`/`.dylib`/`.dll`) that other code links against.
- **Required:** Comfort reading linker error output and inspecting object files.
- **Helpful:** Having shipped or maintained a library with a stability guarantee, or having debugged an ABI break in production.
- **Helpful:** Some exposure to packaging (distro packages, `manylinux`, semantic versioning of `.so` SONAMEs).

---

## Glossary

| Term | Definition |
|------|-----------|
| **ABI surface** | The set of symbols, types, and layouts a binary exposes and promises to keep stable across versions. |
| **Visibility** | Whether a symbol is exported in the dynamic symbol table (`default`) or internal to the module (`hidden`/`internal`/`protected`). |
| **`-fvisibility=hidden`** | GCC/Clang flag making every symbol hidden by default; you then opt specific ones back to `default`. |
| **`__declspec(dllexport/dllimport)`** | MSVC/PE attributes marking a symbol as exported from / imported into a DLL. |
| **Version script** | A GNU `ld` linker script (`--version-script`) that lists which symbols are global vs local and attaches version tags. |
| **`.def` file** | A module-definition file listing the symbols a Windows DLL exports (the PE analogue of a version script's export list). |
| **COMDAT** | The section-grouping mechanism (ELF and PE) tagging vague-linkage symbols so duplicate copies fold to one. |
| **Vague linkage** | Inline functions, templates, vtables, RTTI emitted in every using translation unit and deduplicated by the linker. |
| **Weak symbol** | A symbol that may have multiple definitions (linker keeps one) or be overridden by a strong one. |
| **ODR** | One Definition Rule — every entity must have exactly one definition; violations are undefined behavior. |
| **Symbol versioning** | Attaching a version tag (e.g. `GLIBC_2.17`) to a symbol so one library can ship multiple ABI-incompatible versions of the same name. |
| **`@GLIBC_2.x`** | The version node decorating a glibc symbol; `@@` marks the default version, `@` a non-default (compatibility) version. |
| **Default version** | The version a fresh link binds to (one `@@` node per symbol); older binaries stay bound to older `@` nodes. |
| **SONAME** | The "shared object name" a `.so` advertises; the runtime version identity distros depend on. |
| **`strip`** | The tool that removes symbol-table and debug information from a binary after linking. |
| **Demangle** | Convert a mangled symbol (`_ZN3foo3barEi`) back to source form (`foo::bar(int)`). |

---

## Core Concepts

### Symbol Visibility as ABI-Surface Control

By default, a C or C++ shared object built on ELF exports *every* external-linkage symbol into its dynamic symbol table. That is almost never what you want. The professional default is the inverse:

```bash
g++ -fvisibility=hidden -fvisibility-inlines-hidden -c *.cpp
```

`-fvisibility=hidden` makes every symbol *hidden* (not in the dynamic table) unless you explicitly mark it `default`. `-fvisibility-inlines-hidden` additionally hides the weak symbols generated for inline functions and template instantiations, which are a huge fraction of the accidental exports in a C++ library. You then re-export only your public API:

```cpp
#define PUBLIC __attribute__((visibility("default")))

PUBLIC int mylib_init(void);   // exported
int internal_helper(void);     // hidden — invisible outside the .so
```

On Windows/PE the model is opt-in from the start: nothing is exported from a DLL unless marked `__declspec(dllexport)` (when building) / `__declspec(dllimport)` (when consuming), or listed in a `.def` file. The cross-platform idiom is one macro that expands to the right attribute per platform and per build-vs-consume role.

The four ELF visibilities, in increasing exposure: `internal` (not even referenceable from other modules, may skip the PLT), `hidden` (usable inside the module, absent from the dynamic table), `protected` (exported but cannot be interposed/overridden by the main executable), and `default` (exported and interposable). For nearly all library code you want `hidden` for internals and `default` for the public API; `protected` is occasionally used to prevent symbol interposition but has historically had toolchain quirks, so reach for it deliberately.

### Why Hiding Symbols Speeds Load and Shrinks the ABI

Hiding is not cosmetic; it has measurable, compounding benefits:

1. **Faster load / `dlopen`.** Every symbol in the dynamic table must be hashed and is a candidate for relocation and symbol interposition resolution at load time. A library exporting 50,000 symbols pays a real, repeated cost on every process start and every `dlopen`. Hiding internals can cut the dynamic symbol count by 10x and noticeably shrink startup time for large C++ binaries.
2. **Smaller binary.** Fewer dynamic-symbol entries and fewer string-table bytes for their names. Mangled C++ names are long; tens of thousands of them add up.
3. **Better optimization.** A symbol the compiler/linker knows is hidden cannot be interposed at runtime, so the compiler can inline across the boundary, devirtualize, and prove no external code calls it — enabling dead-symbol elimination. A `default`-visibility symbol must assume an arbitrary external definition could win at load time, which blocks these optimizations.
4. **Smaller, enforceable ABI.** This is the strategic win. If a symbol is hidden, no consumer can depend on it, so you are free to rename, change, or delete it. The visibility flag converts "please don't depend on internals" (a comment nobody reads) into "you *cannot* depend on internals" (a linker-enforced fact). Your ABI becomes exactly the symbols you chose, and only those constrain your future.

The asymmetry to internalize: an *exported* symbol is a liability for the entire life of the library; a *hidden* one is free. So the correct posture is hidden-by-default, export-on-purpose.

### Version Scripts and Module Definition Files

Two mechanisms let you declare the export list outside the source, which is invaluable for large or third-party-heavy codebases.

A **GNU `ld` version script** controls global vs local visibility and (optionally) attaches version nodes:

```text
MYLIB_1.0 {
  global:
    mylib_init;
    mylib_run;
    mylib_*;        # wildcard: export the public-prefix family
  local:
    *;              # hide everything else
};
```

`local: *;` is the version-script equivalent of `-fvisibility=hidden`: every symbol not explicitly listed global becomes local (hidden). This is the most robust way to lock down a C ABI, because it works even for symbols coming out of third-party object files you cannot annotate. Pass it with `-Wl,--version-script=mylib.map`.

On Windows, the **`.def` (module-definition) file** plays the export-list role:

```text
LIBRARY mylib
EXPORTS
    mylib_init
    mylib_run
```

A `.def` lets you export symbols without touching source (and to control ordinals, aliasing, and `NONAME` exports). The conceptual parallel is exact: both the version script and the `.def` are a manifest of "this, and only this, is the public surface."

### Weak Symbols, COMDAT, and Vague-Linkage Folding

Recall from the senior tier: inline functions, template instantiations, vtables, RTTI, and certain statics are emitted in *every* translation unit that uses them, as **weak** symbols inside **COMDAT** groups. The linker sees N copies tagged "all interchangeable" and *folds* them to one — keeping one COMDAT group, discarding the rest. This is what lets you put an inline function or template in a header included a hundred times without a multiple-definition error.

At professional scale, two facts about folding matter operationally:

- **The fold reduces the dynamic symbol table only if those symbols are hidden.** A weak inline that is `default`-visibility still gets exported. `-fvisibility-inlines-hidden` exists precisely so that the thousands of weak template/inline symbols in a C++ build do not leak into your ABI. Without it, your "small public C API" library may export 30,000 internal C++ template symbols.
- **Identical Code Folding (ICF)** is a *separate*, more aggressive linker pass (`lld --icf=all`, gold `--icf`) that merges *functionally identical but unrelated* functions into one address. It shrinks binaries further but can make two distinct function pointers compare equal — breaking any code that relies on function-pointer identity (some dispatch tables, some test frameworks). Know which folding you have enabled.

### ODR Violations That Silently Pick a Definition

COMDAT folding is correct *only if the folded copies are truly identical*. When they are not — two translation units compiled with different flags, different `#define`s, or different definitions of the "same" type emit *different* code under the *same* weak symbol — the linker still folds them, silently keeping one. The program links cleanly, runs, and behaves according to whichever copy the linker happened to keep. This is an **ODR violation**, and it is the most dangerous class of linker-adjacent bug because there is no error, no warning by default, and the corruption manifests far from its cause.

The canonical professional trap: a header defines `struct Config` whose layout depends on a build flag, and two libraries (or two TUs) are built with different flags. One sees a 16-byte `Config`, the other 24. Both emit `inline Config make_config()` under one weak symbol; the linker folds them; now half the program writes fields at offsets the other half does not expect. You get heap corruption with a stack trace pointing at innocent code.

Defenses, in order of strength: (1) never make a type's layout depend on a flag that can vary between TUs that share the type; (2) compile all TUs sharing a header with identical relevant flags (`-D`, `-std`, ABI flags, `_GLIBCXX_*` macros); (3) use the **inline namespace ABI-tagging** trick that libstdc++ uses (`_GLIBCXX_USE_CXX11_ABI`) so incompatible layouts get *different* mangled names and the ODR violation becomes a clean `undefined reference` instead of silent corruption; (4) run with `-Wodr` (GCC LTO) and the ASan/TSan ODR checkers, which can catch some violations at link or run time.

### glibc Symbol Versioning

glibc is the masterclass in evolving an ABI without breaking old binaries, and the mechanism is **symbol versioning**. A single `libc.so.6` ships *multiple* versions of the same function name, each tagged with the glibc version that introduced its current behavior:

```text
$ objdump -T /lib/x86_64-linux-gnu/libc.so.6 | grep ' memcpy'
... memcpy@GLIBC_2.2.5
... memcpy@@GLIBC_2.14     <-- the '@@' marks the DEFAULT version
```

`memcpy@@GLIBC_2.14` is the *default* version: a program you link today binds to it. `memcpy@GLIBC_2.2.5` (single `@`) is a *compatibility* version: an old binary compiled years ago has `memcpy@GLIBC_2.2.5` baked into its relocations and continues to resolve to the old implementation. (`memcpy`'s behavior around overlapping copies changed; rather than break old programs, glibc kept both.) The version node, not just the bare name, participates in symbol resolution.

Two professional consequences:

- **The infamous "version `GLIBC_2.34' not found" runtime error.** You built a binary on a new distro (so the linker bound it to `somefunc@@GLIBC_2.34`) and ran it on an older distro whose `libc.so.6` has no `GLIBC_2.34` node. The runtime linker fails. This is why release builds target an *old* glibc (build on the oldest distro you support, or use a sysroot / `manylinux`-style image), so the symbols you bind to exist everywhere you deploy. You can only ever run forward in glibc version, never backward.
- **You can use the same mechanism for your own library.** A version script with multiple version nodes lets you ship `foo@@MYLIB_2.0` for new callers while keeping `foo@MYLIB_1.0` (with `.symver` directives) for binaries linked against your old release — evolving behavior without breaking the field. This is how serious shared libraries (libc, libstdc++, OpenSSL historically) maintain decade-long backward compatibility.

### Reading Linker Diagnostics

Two error messages dominate this domain, and reading them fluently is a core professional skill.

**`undefined reference to 'foo(int)'`** means: a translation unit *referenced* a symbol that no input object or library *defined*. The demangled form `foo(int)` (rather than `_Z3fooi`) tells you GCC/Clang already demangled it for you, and the *signature* is the clue. The usual causes, in order of frequency:

1. **Declaration/definition mismatch** — you declared `foo(int)` but defined `foo(long)`; the reference and the definition mangle to different names.
2. **Missing `extern "C"`** — a C++ TU references `foo(int)` (mangled `_Z3fooi`) but the definition lives in a C file as `foo` (unmangled). The fix is `extern "C"` on the declaration so both agree on the unmangled name. A *purely* unmangled `undefined reference to 'foo'` (no argument types shown) is the tell that a `extern "C"`/C-vs-C++ boundary is involved.
3. **Library not linked, or link order wrong** — the defining library is missing from the command line, or appears *before* the object that needs it (GNU `ld` resolves left-to-right and discards archive members nothing has yet referenced).
4. **Stripped or hidden symbol** — the definition exists but was hidden (`-fvisibility=hidden`) or stripped from the library you are linking against.

**`multiple definition of 'foo'`** means: two input objects each provided a *strong* definition of the same symbol. Causes: a non-inline function or a variable defined in a header that is included in multiple TUs (the classic; mark it `inline` or move the definition to one `.cpp`); a `extern` variable accidentally defined in the header; or, in C, a pre-GCC-10 "common symbol" tentative-definition collision (`-fcommon` vs `-fno-common`, which became the default and started surfacing these). The fix is to ensure exactly one strong definition exists — `inline`, `static` for file-local, or one-definition-in-one-TU.

### Demangling in Stack Traces and Profilers

In production, mangled names show up everywhere humans need to read them: crash backtraces, `perf` reports, flame graphs, `gdb` frames, sanitizer reports, allocation profiles. A frame that reads `_ZN6engine6Parser5parseERKNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE` is unreadable; demangled it is `engine::Parser::parse(std::string const&)`. The professional knows which tools demangle and how to force it:

- **`c++filt`** decodes Itanium names; pipe any text through it (`./tool 2>&1 | c++filt`). Modern `c++filt` also handles Rust `v0` and (with `-s` schemes) other formats.
- **`nm -C`**, **`objdump -C`**, **`readelf` + `c++filt`** demangle while dumping symbols.
- **`gdb`** demangles by default (`set print asm-demangle on` for disassembly).
- **`perf report --demangle`** (on by default in recent versions) and **flame-graph scripts** demangle frames; if a profiler shows raw `_Z...`, it could not find a demangler for that scheme — Rust `v0` needs a Rust-aware demangler (`rustfilt`), and MSVC names need `undname`/`dbghelp`.
- **`addr2line -C`** demangles when symbolizing addresses from a crash.

The trap: a profiler or symbolizer that demangles *Itanium* will print Rust `v0` or MSVC names raw. When a flame graph is full of `_R...` (Rust) or `?...@@...` (MSVC) frames, you are missing the right demangler, not looking at corrupted data. Keep `rustfilt` and the platform demangler in your debugging toolbox.

### Exposing Rust and C++ Through a C ABI

The only ABI that survives across compilers, compiler versions, and languages is the **flat C ABI**, because it has no mangling, no overloading, no exceptions, and a stable calling convention. So every serious cross-language SDK exposes a C surface, regardless of implementation language.

From C++:

```cpp
extern "C" {                          // no mangling; C calling convention
  PUBLIC void* engine_create(void);   // PUBLIC = visibility("default")/dllexport
  PUBLIC int   engine_run(void* e, int input);
  PUBLIC void  engine_destroy(void* e);
}
```

The implementation can be full C++; the *boundary* is C — opaque `void*` handles plus functions taking only POD and pointers. This survives the ABI churn (`std::string` layout, exception model, libstdc++ vs libc++) that any direct C++ interface would not.

From Rust:

```rust
#[no_mangle]                          // emit plain symbol "engine_run", not _R...
pub extern "C" fn engine_run(e: *mut Engine, input: i32) -> i32 { /* ... */ }
```

Both `#[no_mangle]` (plain, stable symbol name) and `extern "C"` (C calling convention) are required; missing the former gives the C side an `undefined reference` (the real symbol was `_R...`), missing the latter gives a calling-convention mismatch even when the name matched. At professional scale you also pair this with `cbindgen` (Rust) to auto-generate the matching C header, keeping the symbol surface and the header in sync, and you put the entire C surface in *one* module so it is easy to audit and version with a `.def`/version script.

### strip and the Production Symbol Footprint

`strip` removes symbol-table and debug-info sections from a binary after linking. It is the last gate on what ships and serves two goals: smaller binaries and not handing reverse engineers your full internal symbol map.

The professional pattern is **strip but keep debug info recoverable**:

```bash
objcopy --only-keep-debug app app.debug    # 1. save full symbols+debug to a sidecar
strip --strip-debug --strip-unneeded app    # 2. strip the shipping binary
objcopy --add-gnu-debuglink=app.debug app   # 3. link the binary to its debug sidecar
```

This ships a small, stripped binary while keeping a `.debug` file (archived in your symbol server / build artifacts) that lets you symbolize crash dumps from the field later. Stripping the *shipped* binary does not stop you from getting demangled, fully-symbolized stack traces from a crash, because you kept the sidecar.

Critical caveat: `strip` removes *local* and *debug* symbols, but it does **not** remove the **dynamic** symbol table — the exported symbols a shared library *must* keep to be linkable are untouched. So `strip` shrinks and hides internals but does not change your ABI surface. Visibility/version-script control your ABI; `strip` cleans up everything that was already internal. Use both: visibility decides what is exported, `strip` removes the rest from the shipped artifact, and the debug sidecar preserves symbolization.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Hidden-by-default visibility** | A building where every door is locked by default and you issue keys (export) only for the public entrances; nobody can wander into the server room. |
| **Exported symbol as a liability** | Every public phone number you print is a number you must keep answered forever; an unlisted line you can change anytime. |
| **Version script / `.def`** | The official "public directory" of a company — only listed extensions reach the outside; everything else is internal-only. |
| **COMDAT folding** | A print shop receiving fifty identical copies of one form and filing a single master, shredding the rest. |
| **ODR violation** | Fifty "identical" forms that actually have different fine print; the clerk files one at random and everyone now works from possibly-wrong text. |
| **glibc symbol versioning** | An elevator that still stops at floors numbered under the old scheme *and* the new one, so old tenants and new tenants both find their floor. |
| **`undefined reference`** | A recipe that calls for an ingredient nobody put on the shopping list — the dish (link) cannot be completed. |
| **strip with debug sidecar** | Shipping the appliance without the wiring diagram taped inside, but keeping the diagram on file so a technician can still service a returned unit. |

---

## Mental Models

### The "Symbol Table Is a Published Contract" Model

Treat every symbol in your dynamic symbol table as a clause in a contract you signed with every consumer, forever. Adding a clause (export) is cheap today and expensive for life. Removing or changing a clause breaks someone. The whole discipline of this tier is keeping the contract *as small as it can possibly be* — export only what is genuinely public — so that the surface you must keep stable is small enough to actually keep stable.

### The "Hidden Is Free, Exported Is Forever" Model

A hidden symbol costs nothing: no load-time hashing, no ABI promise, full optimization freedom. An exported symbol costs on every load and constrains every future refactor. So the default must be hidden, and each export must justify itself. When unsure, hide it — you can always export later (additive, safe); un-exporting later is an ABI break (subtractive, dangerous).

### The "Folding Is Correct Only If Copies Are Identical" Model

The linker folds vague-linkage duplicates trusting they are identical. That trust is yours to honor. Every inline function, template, and vtable in a shared header is a *promise of byte-identical emission everywhere*. The moment a flag, macro, or type definition diverges between two TUs, the promise breaks, the fold is wrong, and you get silent corruption. Flag consistency across TUs is not hygiene; it is a correctness requirement.

### The "A Matching Name Is Not a Matching Contract" Model

A resolved symbol means the *name* lined up. It does not mean the calling convention, the struct layout, the glibc version, or the C++ standard-library ABI lined up. The link succeeding is necessary, not sufficient. Narrow cross-boundary interfaces to a flat C ABI precisely because that is the one place where a matching name *does* reliably mean a matching contract.

---

## Code Examples

### Cross-platform export macro (build vs consume, ELF and PE)

```cpp
// mylib_export.h
#if defined(_WIN32)
#  define MYLIB_EXPORT __declspec(dllexport)
#  define MYLIB_IMPORT __declspec(dllimport)
#else
#  define MYLIB_EXPORT __attribute__((visibility("default")))
#  define MYLIB_IMPORT
#endif

#ifdef MYLIB_BUILDING            // defined only when compiling the library itself
#  define MYLIB_API MYLIB_EXPORT
#else
#  define MYLIB_API MYLIB_IMPORT
#endif

extern "C" MYLIB_API int mylib_init(void);   // the ONLY thing exported
```

Build the library with `-fvisibility=hidden -fvisibility-inlines-hidden -DMYLIB_BUILDING`. Everything not marked `MYLIB_API` is hidden on ELF and simply not exported on PE.

### Before and after: the dynamic symbol count

```bash
# Default build: every external-linkage + weak template/inline symbol exported
$ g++ -shared -fPIC *.cpp -o libnaive.so
$ nm -D --defined-only libnaive.so | wc -l
41207

# Hidden-by-default + explicit exports
$ g++ -shared -fPIC -fvisibility=hidden -fvisibility-inlines-hidden \
      -DMYLIB_BUILDING *.cpp -o libtight.so
$ nm -D --defined-only libtight.so | wc -l
12
```

Same code, same public API; the second library exposes 12 symbols instead of 41,207. It loads faster, optimizes better, and its ABI is exactly those 12 promises.

### Locking down a C ABI with a version script

```text
# mylib.map
MYLIB_1.0 {
  global:
    mylib_init;
    mylib_run;
  local:
    *;                # everything else hidden, even from third-party objects
};
```

```bash
$ g++ -shared -fPIC *.cpp -Wl,--version-script=mylib.map -o libmylib.so
```

The `local: *;` clause hides every symbol not explicitly listed — including symbols from static libraries you linked in but did not write, which `-fvisibility` cannot reach.

### Reading the two classic errors

```text
# undefined reference — demangled signature is the clue
$ g++ main.o -o app
/usr/bin/ld: main.o: undefined reference to `compute(int)'
#                                            ^^^^^^^^^^^^^ C++ mangled _Z7computei
# Diagnosis: compute is defined in a C file as plain `compute`; main.cpp lacks
#            extern "C". Fix: declare  extern "C" int compute(int);

# multiple definition — two strong definitions of one symbol
$ g++ a.o b.o -o app
/usr/bin/ld: b.o: multiple definition of `counter'; a.o: first defined here
# Diagnosis: `int counter;` lives in a header included by both TUs.
# Fix: `inline int counter;` (C++17) or declare extern + define in one .cpp.
```

### Symbol versioning your own library

```cpp
// v2 default, v1 compatibility shim kept for old binaries
extern "C" int do_thing_v1(int);
extern "C" int do_thing_v2(int);
__asm__(".symver do_thing_v1, do_thing@MYLIB_1.0");
__asm__(".symver do_thing_v2, do_thing@@MYLIB_2.0");   // @@ = default for new links
```

```text
# mylib.map
MYLIB_1.0 { global: do_thing; };
MYLIB_2.0 { global: do_thing; } MYLIB_1.0;   # 2.0 depends on 1.0
```

New programs bind `do_thing@@MYLIB_2.0`; binaries linked against your old release keep resolving `do_thing@MYLIB_1.0`. One `.so`, two behaviors, no field breakage.

### Demangling a stack trace

```text
$ ./crashy
Segmentation fault
$ gdb -batch -ex run -ex bt ./crashy 2>&1 | c++filt
#0  engine::Parser::parse(std::string const&) at parser.cpp:88
#1  engine::Session::handle(Request const&) at session.cpp:140
# (gdb already demangles; the explicit c++filt is the belt-and-suspenders form,
#  and the one that rescues raw _Z... frames from tools that did NOT demangle.)
```

### Strip but keep symbolication

```bash
$ objcopy --only-keep-debug app app.debug     # archive this in your symbol server
$ strip --strip-debug --strip-unneeded app    # ship this
$ objcopy --add-gnu-debuglink=app.debug app   # link them for later
$ ls -l app app.debug
-rwxr-xr-x  ...  2.1M  app          # small, shippable
-rw-r--r--  ...   38M  app.debug    # full symbols, kept off the shipped artifact
```

A crash from the field, plus `app.debug`, still yields fully demangled, line-numbered backtraces.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **`-fvisibility=hidden` + explicit exports** | Smaller ABI, faster load, better optimization, refactor freedom. | Must annotate the public API; forgetting a mark gives an `undefined reference` to your own consumers. |
| **Version scripts / `.def`** | Lock the export list outside source; works on third-party objects; enables symbol versioning. | Another build artifact to maintain; wildcard mistakes can over- or under-export silently. |
| **Symbol versioning** | Decade-long backward compatibility from one `.so`; old and new binaries coexist. | Intricate `.symver` mechanics; ELF/GNU-`ld`-specific; easy to get the default (`@@`) node wrong. |
| **COMDAT / vague-linkage folding** | Inline functions and templates live in headers with no multiple-definition errors. | Hides ODR violations: divergent definitions fold silently into UB. |
| **strip + debug sidecar** | Small shipped binary, no leaked internals, full crash symbolication retained. | Extra build step; lose the sidecar and field crashes become near-undebuggable. |

---

## Use Cases

- **Shipping a stable shared library** (a database client, a codec, an SDK) where the export list *is* the supported ABI and must stay small and versioned.
- **Cross-language SDKs** implemented in C++/Rust, exposed as a flat `extern "C"`/`#[no_mangle]` C surface generated and audited as one module.
- **Distro / `manylinux` packaging** where you must build against an old glibc so `@@GLIBC_2.x` bindings resolve on every target system.
- **Plugin systems** using `dlopen` where load time scales with exported-symbol count, so hiding internals is a measurable startup win.
- **Long-lived libraries** that must evolve a function's behavior without breaking already-shipped binaries — symbol versioning's home turf.
- **Production debugging** of stripped binaries, where demangling and a debug sidecar turn a raw crash into a readable backtrace.

---

## Coding Patterns

### Pattern 1: Hidden-by-default, exported-on-purpose

Compile every shared library with `-fvisibility=hidden -fvisibility-inlines-hidden` (or a `local: *;` version script), and mark exactly the public API with a `*_API` macro. Make adding an export a deliberate, reviewed act.

### Pattern 2: Flat C surface generated from the implementation language

Implement in C++/Rust; expose one C module (`extern "C"` / `#[no_mangle] extern "C"`) of opaque handles and POD-only functions; generate the matching header (`cbindgen`, or a hand-maintained header reviewed against `nm -D`). The C surface is your versioned ABI.

### Pattern 3: ODR hygiene gate

Forbid flag-dependent type layouts in shared headers. Build all TUs sharing a header with identical ABI-relevant flags. Where layouts *must* differ across configurations, use inline-namespace ABI tags so the names diverge and an ODR mismatch becomes a clean `undefined reference` instead of silent corruption.

### Pattern 4: Strip-with-sidecar in the release pipeline

In CI, after link: `objcopy --only-keep-debug` to a sidecar archived in the symbol server, `strip` the shipped artifact, `--add-gnu-debuglink` to connect them. Never ship the sidecar; never lose it either.

---

## Best Practices

- **Export nothing by default.** `-fvisibility=hidden -fvisibility-inlines-hidden` (or `local: *;`) is the baseline for every shared library; opt the public API back in explicitly.
- **Treat every export as a permanent promise.** When unsure, hide it — exporting later is additive and safe; un-exporting later is an ABI break.
- **Expose cross-boundary interfaces as flat C.** `extern "C"` / `#[no_mangle] extern "C"`, POD and pointers only; it is the only ABI that survives compiler and language drift.
- **Build against the oldest glibc/OS you support.** You can run forward in glibc version but never backward; bind to old `@@GLIBC_2.x` nodes so the symbols exist everywhere.
- **Keep ABI-relevant flags identical across all TUs sharing a header.** Inconsistent `-D`/`-std`/ABI flags are the number-one cause of silent ODR corruption.
- **Use a version script (or `.def`) as the single source of truth for the export list**, especially when third-party objects are linked in that `-fvisibility` cannot annotate.
- **Strip the shipped binary but keep a debug sidecar** archived in a symbol server so field crashes stay symbolizable.
- **Keep the right demangler in your toolbox per scheme:** `c++filt` (Itanium), `rustfilt`/`c++filt` (Rust `v0`), `undname` (MSVC). A raw symbol in a profiler usually means the wrong demangler, not bad data.

---

## Edge Cases & Pitfalls

- **Forgetting `-fvisibility-inlines-hidden`.** Plain `-fvisibility=hidden` still leaks the thousands of weak template/inline symbols; the inline flag is what actually shrinks a C++ ABI.
- **The `local: *;` over-hide.** A wildcard hide can accidentally hide a symbol your public inline header needs at the call site, producing `undefined reference` only in *consumers*, not in your own build/tests.
- **glibc forward-only.** Building on a new distro and deploying to an old one fails with `version 'GLIBC_2.x' not found`. The build environment, not the code, is the bug.
- **ODR via `_GLIBCXX_USE_CXX11_ABI` mismatch.** Linking objects built with the old and new libstdc++ string ABI can fold incompatible `std::string` layouts; symptoms are corruption, not a clean error, unless the ABI tag forces a name divergence.
- **ICF breaking function-pointer identity.** `--icf=all` can make two distinct functions share an address; code relying on pointer identity (dispatch tables, comparison) breaks. Use `--icf=safe` or disable it where identity matters.
- **`strip` does not shrink the ABI.** It removes local/debug symbols but never the dynamic symbol table; people who `strip` expecting a smaller export surface are surprised the ABI is unchanged. Visibility, not `strip`, controls exports.
- **Demangling the wrong scheme.** Feeding a Rust `v0` (`_R...`) or MSVC (`?...`) name to `c++filt`'s Itanium decoder yields garbage; in a flame graph this looks like corruption but is a missing-demangler problem.
- **`multiple definition` from `-fno-common`.** GCC 10+ defaults to `-fno-common`, turning previously-tolerated tentative-definition collisions in C headers into hard link errors; old code that "worked" suddenly breaks.

---

## Operational Checklist

- [ ] Shared library built with `-fvisibility=hidden -fvisibility-inlines-hidden` (or `local: *;` version script).
- [ ] Public API marked with an export macro that handles build-vs-consume on ELF and PE.
- [ ] `nm -D --defined-only` output reviewed: only the intended symbols are exported.
- [ ] Cross-language/cross-compiler boundary is flat `extern "C"`/`#[no_mangle]`, POD + pointers only.
- [ ] Built against the oldest glibc/OS in the support matrix; `objdump -T | grep GLIBC_` checked against deploy targets.
- [ ] All TUs sharing a header use identical ABI-relevant flags; no flag-dependent type layouts in shared headers.
- [ ] Release pipeline: `--only-keep-debug` sidecar archived, binary stripped, `--add-gnu-debuglink` applied.
- [ ] Demanglers (`c++filt`, `rustfilt`, `undname`) available wherever crash logs and profiles are read.
- [ ] If versioning the ABI: version script with correct `@@` default nodes and `.symver` compatibility shims.

---

## Test Yourself

1. Build a small C++ shared library twice — once with default visibility, once with `-fvisibility=hidden -fvisibility-inlines-hidden` — and compare `nm -D | wc -l`. Explain the ratio and why load time differs.
2. Write a version script with `local: *;` and confirm an internal helper that links fine in your own tests gives `undefined reference` when a *separate* program tries to use it. Why is that the desired outcome?
3. Run `objdump -T /lib/.../libc.so.6 | grep memcpy`. Identify the `@@` default node and a `@` compatibility node. Explain what an old binary resolves to and why.
4. Reproduce `version 'GLIBC_2.x' not found` by building on a new machine and running on an older one (or in an older container). Then rebuild against an old sysroot and show it resolves. Which environment was the bug?
5. Trigger `undefined reference to 'foo(int)'` by defining `foo` in a C file and calling it from C++ without `extern "C"`. Add `extern "C"` and watch it link. What changed in the symbol names?
6. Create the flag-dependent `Config` ODR trap, confirm it links cleanly, then add an ABI tag (inline namespace) and show the link now *fails* loudly. Why is the loud failure better?
7. Strip a binary with `--only-keep-debug` + `--add-gnu-debuglink` and confirm you still get a demangled, line-numbered backtrace from a crash. Then delete the sidecar and observe what you lose.
8. Pipe a Rust `v0` symbol through `c++filt` (Itanium) and through `rustfilt`. Explain why one is garbage and one is readable, and what this means for profiler output.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│          NAME MANGLING & LINKING — PROFESSIONAL CHEAT SHEET           │
├──────────────────────────────────────────────────────────────────────┤
│  VISIBILITY = ABI SURFACE                                            │
│   build .so with: -fvisibility=hidden -fvisibility-inlines-hidden    │
│   export public API: __attribute__((visibility("default")))         │
│                      / __declspec(dllexport) (PE)  / .def / .map     │
│   hidden = free (no load cost, no promise, optimizable)             │
│   exported = forever (load cost + permanent ABI promise)            │
├──────────────────────────────────────────────────────────────────────┤
│  VERSION SCRIPT (lock down + version)                                │
│   MYLIB_1.0 { global: mylib_*; local: *; };                         │
│   local:*  == hidden-by-default, even for 3rd-party objects         │
├──────────────────────────────────────────────────────────────────────┤
│  glibc SYMBOL VERSIONING                                             │
│   memcpy@@GLIBC_2.14  (@@ = DEFAULT, new links bind here)            │
│   memcpy@GLIBC_2.2.5  (@  = compat, old binaries stay here)         │
│   RULE: build on OLDEST target → run forward only, never backward   │
├──────────────────────────────────────────────────────────────────────┤
│  ERRORS                                                             │
│   undefined reference to `foo(int)'  → decl/def mismatch, missing   │
│        extern "C", lib not linked / wrong order, hidden/stripped     │
│   multiple definition of `foo'       → 2 strong defs (header def,    │
│        non-inline var; fix: inline / one-TU / static / extern)       │
├──────────────────────────────────────────────────────────────────────┤
│  ODR: divergent defs fold SILENTLY under one weak symbol → UB.       │
│   Defense: identical flags + no flag-dependent layouts + ABI tags.   │
├──────────────────────────────────────────────────────────────────────┤
│  DEMANGLE:  c++filt (Itanium) · rustfilt (Rust _R) · undname (MSVC)  │
│   raw _Z/_R/? in a profiler = WRONG demangler, not corruption.      │
├──────────────────────────────────────────────────────────────────────┤
│  STRIP (keep symbolication):                                        │
│   objcopy --only-keep-debug app app.debug                           │
│   strip --strip-debug --strip-unneeded app                          │
│   objcopy --add-gnu-debuglink=app.debug app                         │
│   NOTE: strip does NOT remove the dynamic symbol table → ABI intact  │
├──────────────────────────────────────────────────────────────────────┤
│  EXPORT C SURFACE:  extern "C" (C++) / #[no_mangle] extern "C" (Rust)│
│   opaque void* handles + POD/pointers = the only stable cross-ABI.   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **The dynamic symbol table is your ABI, and most of it should not exist.** Build shared libraries with `-fvisibility=hidden -fvisibility-inlines-hidden` (or a `local: *;` version script / a `.def` on Windows) and export only the deliberate public API.
- **Hiding symbols speeds load, shrinks the binary, enables optimization, and — most importantly — shrinks the enforceable ABI.** A hidden symbol is free; an exported symbol is a permanent promise and a per-load cost. Export on purpose, hide by default.
- **Vague-linkage symbols (inline functions, templates, vtables, RTTI) fold via COMDAT** to one copy — correct *only if the copies are byte-identical*. Divergent definitions under one weak symbol cause **ODR violations** that the linker resolves *silently*, producing location-independent corruption. Identical flags and no flag-dependent layouts are the defense.
- **glibc symbol versioning** (`memcpy@@GLIBC_2.14` default vs `memcpy@GLIBC_2.2.5` compat) lets one library ship multiple ABI versions of a name; build against the *oldest* target you support because resolution only ever goes forward in version.
- **Read the two key errors fluently:** `undefined reference to 'foo(int)'` (decl/def mismatch, missing `extern "C"`, unlinked/misordered library, hidden/stripped symbol) and `multiple definition` (two strong definitions — fix with `inline`/one-TU/`static`).
- **Demangle in production tooling** with the scheme-correct tool — `c++filt`, `rustfilt`, `undname`. A raw symbol in a stack trace or flame graph almost always means the wrong demangler, not bad data.
- **Expose cross-language/cross-compiler interfaces as a flat C ABI** (`extern "C"` / `#[no_mangle] extern "C"`, opaque handles + POD), the only contract that survives ABI drift.
- **`strip` the shipped binary but keep a debug sidecar** (`--only-keep-debug` + `--add-gnu-debuglink`); note `strip` removes local/debug symbols but never the dynamic symbol table, so it cleans the artifact without changing your ABI.

---

## Further Reading

- *How To Write Shared Libraries* — Ulrich Drepper, on visibility, versioning, COMDAT, and load-time costs.
- GCC docs — *Visibility* (`-fvisibility`, `-fvisibility-inlines-hidden`) and `__attribute__((visibility))`.
- GNU `ld` manual — *Version Scripts* (`--version-script`) and `.symver` directives.
- *Symbol Versioning* — the original Solaris/GNU symbol-versioning design notes and the glibc `Versions` files.
- Microsoft docs — *Exporting from a DLL* (`__declspec(dllexport)`, module-definition `.def` files).
- cppreference — *One Definition Rule (ODR)* page.
- Rust — `cbindgen` documentation and the Rustonomicon FFI chapter on `#[no_mangle]`/`extern "C"`.
- `binutils` manuals for `nm`, `objdump`, `readelf`, `strip`, `objcopy`, `c++filt`; LLVM `lld` docs on `--icf`.
- *manylinux* project documentation on building against an old glibc for portable Linux wheels.
