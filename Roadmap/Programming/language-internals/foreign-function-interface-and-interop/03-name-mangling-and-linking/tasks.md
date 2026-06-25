# Name Mangling & Linking — Hands-On Tasks

> **Topic:** [Name Mangling & Linking](README.md)

---

## Introduction

You do not understand name mangling and linking until you have *seen* the symbols with your own eyes — folded, hidden, duplicated, versioned, demangled. This page is a lab. Every task is something you run in a terminal with `gcc`/`g++`/`clang`, `nm`, `c++filt`, `objdump`, `readelf`, and (where you have it) `rustc`/`rustfilt`. The goal is to build muscle memory for the everyday moves: decode a mangled name by eye, reproduce an `undefined reference` and fix it with `extern "C"`, watch the linker fold weak symbols, control visibility, and provoke the silent ODR violation that no error message will warn you about.

Work top to bottom. Warm-Up gets you fluent with the inspection tools. Core makes you reproduce and fix the two errors that dominate real linking, plus visibility control. Advanced takes you into folding, ODR, and symbol versioning. The Capstone ties it together by building and locking down a real cross-language shared library. Each task has a **Self-check** (how to know you succeeded), most have a **Hint**, and the harder ones have a **Sparse solution** — a sketch, not a copy-paste answer. Type the commands; reading them is not the same as running them.

A note on platform: the examples assume Linux/ELF with GNU binutils, the most instructive environment. macOS (Mach-O) and Windows (PE/MSVC) differ in tool names (`undname`, `dumpbin`, `otool`) but the concepts transfer; where a task is ELF-specific it says so.

---

## Warm-Up

### Task W1 — Demangle by eye, then check with the tool

Without running anything, work out what these Itanium symbols mean, then verify:

```text
_Z3fooi
_Z3barPKc
_ZN3foo3barEi
_ZN3app6EngineC1Ev
_Z3addidPv
```

**Self-check:** Run `echo '<symbol>' | c++filt` for each and compare to your guess. You should get `foo(int)`, `bar(char const*)`, `foo::bar(int)`, `app::Engine::Engine()`, and `add(int, double, void*)`.

**Hint:** `_Z` opens; a number is the length of the following name; `N...E` wraps a scoped name; single-letter type codes — `i`=int, `d`=double, `c`=char, `P`=pointer-to, `K`=const, `v`=void; `C1` is a constructor.

### Task W2 — Produce the symbols yourself

Write `add.cpp` with `int add(int a, int b) { return a + b; }` and an overload `double add(double a, double b)`. Compile to an object and list its symbols.

```bash
g++ -c add.cpp -o add.o
nm add.o            # raw
nm -C add.o         # demangled
```

**Self-check:** You see two distinct symbols (`_Z3addii` and `_Z3adddd`) for the two overloads, demangling to `add(int, int)` and `add(double, double)`. This is overloading working *because* the names differ.

### Task W3 — See what `extern "C"` removes

Add `extern "C" int add_c(int, int) { return 0; }` to the file. Recompile and look at its symbol.

**Self-check:** `add_c` appears as the plain symbol `add_c`, *not* `_Z5add_cii`. `extern "C"` turned off mangling for that one function. Note you cannot give two `extern "C"` overloads — try it and observe the compile error.

### Task W4 — Demangle a full `nm` dump and a disassembly

Pick any C++ object or shared library on your system and run:

```bash
nm -C /path/to/lib.so | head
objdump -d -C add.o | head -40
```

**Self-check:** Function names in both the symbol list and the disassembly appear in readable source form. Now run the same without `-C` and confirm the names are mangled. You've found the two flags (`nm -C`, `objdump -C`) that demangle inline.

---

## Core

### Task C1 — Reproduce `undefined reference` from a missing `extern "C"`

Create a C file and a C++ file:

```c
/* impl.c */
int compute(int x) { return x * 2; }
```

```cpp
// main.cpp
int compute(int x);                 // NOTE: no extern "C"
int main() { return compute(21); }
```

```bash
gcc -c impl.c -o impl.o
g++ -c main.cpp -o main.o
g++ main.o impl.o -o app            # observe the error
```

**Self-check:** You get `undefined reference to 'compute(int)'`. The C file defined the symbol `compute`; `main.cpp` referenced `_Z7computei`. They don't match.

**Fix it:** Change the declaration in `main.cpp` to `extern "C" int compute(int);`, recompile, link. Now it succeeds.

**Hint:** Confirm the mismatch directly: `nm impl.o | grep compute` shows plain `compute`; `nm main.o | grep compute` shows `U _Z7computei` (undefined). After the fix, `main.o` shows `U compute`.

### Task C2 — Reproduce `multiple definition`

```cpp
// shared.h
int counter = 0;                    // a DEFINITION in a header (the bug)
```

```cpp
// a.cpp
#include "shared.h"
int use_a() { return counter; }
// b.cpp
#include "shared.h"
int use_b() { return counter; }
```

Add a trivial `main` and link `a.o` + `b.o`.

**Self-check:** You get `multiple definition of 'counter'`. Two TUs each emitted a strong definition.

**Fix it three ways and confirm each links:** (1) `inline int counter = 0;` in the header (C++17 inline variable); (2) declare `extern int counter;` in the header and define `int counter = 0;` in exactly one `.cpp`; (3) `static int counter = 0;` if each TU should have its own copy. Explain to yourself how each differs in semantics.

### Task C3 — Control visibility on a shared library

Write a library with a public and a private function:

```cpp
// lib.cpp
__attribute__((visibility("default"))) int public_api(void) { return 1; }
int private_helper(void) { return 2; }
```

```bash
g++ -shared -fPIC lib.cpp -o lib_open.so
g++ -shared -fPIC -fvisibility=hidden lib.cpp -o lib_tight.so
nm -D --defined-only lib_open.so   | grep -E 'public_api|private_helper'
nm -D --defined-only lib_tight.so  | grep -E 'public_api|private_helper'
```

**Self-check:** `lib_open.so` exports *both* functions in its dynamic symbol table. `lib_tight.so` exports *only* `public_api` — `private_helper` is hidden, invisible to any consumer. You have just made a symbol undependable-on by anyone outside the library.

**Hint:** `nm -D` lists *dynamic* (exported) symbols specifically; plain `nm` lists all symbols including local ones, so use `-D` to see the actual ABI surface.

### Task C4 — Confirm the calling convention is part of an MSVC name (concept)

If you have MSVC/Windows: compile `int __cdecl f(int); int __stdcall g(int);`, run `dumpbin /symbols obj` and `undname` on the decorated names. If you don't, reason about why `?f@@YAHH@Z` (cdecl, `YA`) and `?g@@YGHH@Z` (stdcall, `YG`) differ only in one letter.

**Self-check:** You can state *why* a 32-bit Windows `__cdecl`-vs-`__stdcall` mismatch surfaces as an unresolved-symbol error rather than a silent crash: the convention is encoded in the name, so a mismatched declaration produces a different, unresolvable symbol.

---

## Advanced

### Task A1 — Watch the linker fold a weak/COMDAT template symbol

```cpp
// max.hpp
template <typename T> T mymax(T a, T b) { return a > b ? a : b; }
```

```cpp
// a.cpp
#include "max.hpp"
int use_a() { return mymax(1, 2); }     // instantiates mymax<int>
// b.cpp
#include "max.hpp"
int use_b() { return mymax(3, 4); }     // ALSO instantiates mymax<int>
```

```bash
g++ -c a.cpp b.cpp
nm a.o b.o | grep -i mymax
g++ a.o b.o main.o -o app                # links cleanly — no multiple definition
```

**Self-check:** Both objects define the *same* `mymax<int>` symbol, and `nm` shows it with binding `W` (weak). Despite two definitions, linking succeeds because the linker folds the COMDAT duplicates into one. Demangle the symbol with `nm -C` to see `int mymax<int>(int, int)`.

**Hint:** The `W` in the second column of `nm` output is the tell: weak symbol. A normal function would be `T` (text, strong) and two of them would collide.

### Task A2 — Reproduce a silent ODR violation

```cpp
// widget.h — included by both files
struct Widget {
#ifdef EXTRA
    int extra;
#endif
    int id;
};
inline Widget make_widget(int i) { Widget w; w.id = i; return w; }
```

```bash
g++ -c a.cpp -o a.o                      # Widget = {id}        (4 bytes)
g++ -c -DEXTRA b.cpp -o b.o              # Widget = {extra, id} (8 bytes)
g++ a.o b.o main.o -o app                # LINKS. No error.
```

**Self-check:** The program links with no warning or error, yet `sizeof(Widget)` and the offset of `id` differ between the two TUs, and one folded `make_widget` body wins. Add prints of `sizeof(Widget)` and `offsetof(Widget, id)` in each TU to *prove* they disagree. You have created undefined behavior with a clean build — the central danger of vague linkage.

**Sparse solution:** Compile the two TUs with *identical* flags (drop `-DEXTRA`, or move the flag-dependent field out of the shared header entirely) and the ODR violation disappears. The real-world defense is: never let a type's layout depend on a flag that can vary between TUs that share the type, and keep ABI-relevant flags identical across all TUs.

### Task A3 — Weak symbol as an overridable default, and the archive trap

```c
/* default.c */ __attribute__((weak)) int hook(void) { return 42; }
/* over.c    */ int hook(void) { return 100; }            // strong
/* main.c    */ #include <stdio.h>
                int hook(void); int main(){ printf("%d\n", hook()); }
```

Link `main.o default.o` (prints 42), then `main.o default.o over.o` (prints 100). Now put the override in an archive: `ar rcs libover.a over.o` and link `main.o default.o libover.a`.

**Self-check:** With the loose `over.o`, the strong override wins (100). With the override only inside `libover.a` and nothing else referencing it, the archive member is *not pulled in*, so the weak default (42) wins. Force it with `-Wl,--whole-archive libover.a -Wl,--no-whole-archive` (or `-u hook`) and 100 returns.

**Hint:** This is the archive-extraction rule biting: a `.a` member is only extracted when something already references a symbol it defines. The weak default is enough to satisfy the reference, so the override member is never pulled.

### Task A4 — Inspect glibc symbol versioning (ELF)

```bash
objdump -T /lib/x86_64-linux-gnu/libc.so.6 | grep -E '\smemcpy$|\smemcpy@'
readelf -V /lib/x86_64-linux-gnu/libc.so.6 | head -30
```

**Self-check:** You see at least two `memcpy` entries: one with `@@GLIBC_2.x` (the default version, what fresh links bind to) and possibly one with a single `@GLIBC_2.y` (a compatibility version old binaries stay bound to). You can articulate that `@@` is the default and `@` is a kept-for-compatibility version, and that resolution only ever goes forward in version — which is why building on a new distro and running on an old one yields `version 'GLIBC_2.x' not found`.

**Hint:** `objdump -T` shows the version node appended to the symbol name; `readelf -V` shows the version *definition* and *need* tables that drive this resolution.

### Task A5 — Demangle each scheme with its own tool

Collect one symbol per scheme and feed each to the right and the wrong demangler:

```bash
echo '_ZN3foo3barEi'         | c++filt      # Itanium → foo::bar(int)
echo '_RNvCs1234_5crate3foo'  | rustfilt     # Rust v0 → crate::foo  (rustfilt)
echo '_RNvCs1234_5crate3foo'  | c++filt      # wrong tool → garbage / unchanged
# Windows: undname '?bar@foo@@QEAAHH@Z'
```

**Self-check:** Each name is readable through its matching demangler and *unreadable* (or unchanged) through the wrong one. You can now explain why a flame graph full of raw `_R...` frames means "missing Rust demangler," not "corrupt profile."

---

## Capstone

### Task CAP1 — Build, lock down, and verify a cross-language shared library

Build a small C++ (or Rust) library that exposes exactly *one* public function across a flat C ABI, hides everything else, and that you verify symbol-by-symbol. Then strip it while keeping it debuggable.

Requirements:

1. **Implementation** in C++ with internal helpers (at least one inline function, one template, one private non-inline helper) plus one public `extern "C"` entry point.
2. **Hidden by default:** build with `-fvisibility=hidden -fvisibility-inlines-hidden`; mark only the public function `__attribute__((visibility("default")))`.
3. **Verify the surface:** `nm -D --defined-only lib.so` shows *exactly one* defined exported symbol (the C entry point), and it is unmangled.
4. **Reproduce the leak first:** build a *second* copy without the visibility flags and show it exports dozens-to-thousands of symbols (including weak template/inline symbols), to feel the difference.
5. **Strip with a sidecar:** `objcopy --only-keep-debug`, `strip --strip-debug --strip-unneeded`, `objcopy --add-gnu-debuglink`, and confirm the dynamic symbol table is unchanged by the strip (`nm -D` identical before and after).
6. **Link a consumer** against the tight library and confirm it runs; then try to call the private helper from the consumer and confirm you get `undefined reference` — proving the symbol is truly un-dependable.

**Self-check:**
- Tight library: `nm -D --defined-only lib.so | wc -l` is tiny (the public C symbol, plus a few unavoidable runtime symbols); the naive build's count is orders of magnitude larger.
- The one exported symbol is plain (no `_Z`/`_R`), confirmed with `nm -D lib.so`.
- A consumer referencing the private helper fails to link — the visibility flag turned a "please don't use this" comment into a linker-enforced fact.
- `nm -D` output is byte-identical before and after `strip`, proving `strip` removed only internal/debug symbols, not the ABI.

**Sparse solution / sketch:**

```cpp
// engine.cpp
#define PUBLIC __attribute__((visibility("default")))
template <typename T> static T clamp(T v, T lo, T hi){ return v<lo?lo:(v>hi?hi:v);} // internal
static inline int scale(int x){ return x * 2; }                                     // internal
static int private_helper(int x){ return clamp(scale(x), 0, 100); }                 // hidden
extern "C" PUBLIC int engine_run(int x){ return private_helper(x); }                // the ONLY export
```

```bash
# tight build
g++ -shared -fPIC -fvisibility=hidden -fvisibility-inlines-hidden engine.cpp -o libtight.so
nm -D --defined-only libtight.so          # expect: engine_run (plain), little else
# naive build for contrast
g++ -shared -fPIC engine.cpp -o libnaive.so
nm -D --defined-only libnaive.so | wc -l  # much larger
# strip with sidecar
objcopy --only-keep-debug libtight.so libtight.debug
strip --strip-debug --strip-unneeded libtight.so
objcopy --add-gnu-debuglink=libtight.debug libtight.so
nm -D --defined-only libtight.so          # unchanged vs before strip
```

For the consumer, write a `.c` file declaring `extern int engine_run(int);` (links) and another declaring `extern int private_helper(int);` (fails with `undefined reference` — the proof that hiding works).

**Stretch goals:**
- Add a **version script** (`MYLIB_1.0 { global: engine_run; local: *; };`, linked with `-Wl,--version-script=`) and confirm it produces the same tight surface even across third-party objects, then add a second version node with a `.symver` compatibility shim and observe both `engine_run@@MYLIB_2.0` and `engine_run@MYLIB_1.0` in `objdump -T`.
- Rewrite the core in **Rust** (`#[no_mangle] pub extern "C" fn engine_run(...)`), build a `staticlib`/`cdylib`, and confirm `nm -D` shows the same plain `engine_run` and *no* `_R...` symbols crossing the boundary.
- Demangle a crash backtrace from the stripped binary using the `.debug` sidecar and `addr2line -C -e libtight.debug`, proving you retained full symbolication despite shipping a stripped library.

---

## Wrap-Up

If you completed these, you can now: decode any Itanium symbol by eye and demangle any scheme with its right tool; reproduce and fix both `undefined reference` (decl/def mismatch, missing `extern "C"`) and `multiple definition` (header definitions); see weak/COMDAT folding happen and provoke the silent ODR violation it can hide; control visibility to shrink an ABI to exactly its public surface; read glibc symbol versioning; and build, lock down, strip, and verify a real cross-language shared library. That is the full operational loop of name mangling and linking — not as theory, but as commands you have actually run.
