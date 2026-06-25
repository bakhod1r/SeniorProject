# What Is an ABI — Hands-On Tasks

> **Topic:** [What Is an ABI](README.md)
> **Focus:** Make the ABI visible with your own hands — measure type sizes and alignment, diff struct layouts, manufacture an ABI break and watch it corrupt memory, and read symbol names and versions out of real binaries with `nm`, `readelf`, and `objdump`.

---

## Introduction

You cannot reason about an ABI you have never inspected. The exercises below take the abstractions — type sizes, struct padding, calling conventions, name mangling, symbol versioning, ABI breaks — and turn them into commands you run and output you read. Each task has a goal, steps, a self-check box, a hint, and a sparse solution sketch you should only open after a genuine attempt.

You will need a C/C++ toolchain (`gcc`/`g++` or `clang`), and on Linux the binutils suite (`nm`, `readelf`, `objdump`, `c++filt`). Most tasks work on macOS too, with `otool`/`nm` standing in for `readelf` where noted. Windows-specific observations can be reproduced with MSVC's `dumpbin`, but a Linux box (or container) is the smoothest environment for the symbol-versioning tasks.

Work through them in order — the warm-ups build the muscle the capstone needs. The single most valuable habit you will build: when something "compiles but crashes," your hands reach for `nm`, `readelf -V`, and a `sizeof`/`offsetof` probe before your mind reaches for a guess.

- **Warm-Up** — sizes, alignment, and the difference between API and ABI.
- **Core** — struct layout, padding, manufacturing an ABI break, reading symbols.
- **Advanced** — name mangling, symbol versions, layout across compilers/flags.
- **Capstone** — a stable C-ABI plugin, evolved without breaking an old caller.

---

## Warm-Up

### Task W1 — Print the size and alignment of every fundamental type

**Goal:** Build a baseline intuition for type sizes and confront the LP64/LLP64 split.

**Steps:**
1. Write a small program that prints `sizeof` and `alignof` (or `_Alignof`) for `char`, `short`, `int`, `long`, `long long`, `void*`, `size_t`, `float`, `double`, `long double`, `int32_t`, `int64_t`, `intptr_t`.
2. Compile and run it on your machine. Note the value for `long` and `void*`.
3. If you have access to a 64-bit Windows toolchain (or a CI runner), build and run it there too and compare `sizeof(long)`.

**Self-check:**
- [ ] I can state `sizeof(long)` and `sizeof(void*)` on my platform.
- [ ] I can name which data model my platform uses (LP64 or LLP64).
- [ ] I understand why `long` could differ between two platforms.

**Hint:** On Linux/macOS (LP64) `sizeof(long)` is 8; on 64-bit Windows (LLP64) it is 4. `sizeof(void*)` is 8 on all of them.

<details>
<summary>Solution sketch</summary>

```c
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>
#define P(t) printf("%-12s size=%2zu align=%2zu\n", #t, sizeof(t), _Alignof(t))
int main(void){ P(char);P(short);P(int);P(long);P(long long);P(void*);
                P(size_t);P(float);P(double);P(long double);
                P(int32_t);P(int64_t);P(intptr_t); return 0; }
```
On LP64 you will see `long size=8`; on LLP64, `long size=4`. `int32_t`/`int64_t` are identical everywhere — that is the point.
</details>

---

### Task W2 — Classify five changes as API break, ABI break, both, or neither

**Goal:** Internalize that API and ABI compatibility are independent axes.

**Steps:** For each change to a public library, decide: API break? ABI break?
1. Rename a public function `init()` → `initialize()`.
2. Change a function body (the implementation) only.
3. Add a non-virtual method to a C++ class.
4. Reorder two fields in a public struct callers allocate by value.
5. Change a function's return type from `int` to `int64_t`.

**Self-check:**
- [ ] I classified all five without looking.
- [ ] I can explain why one of them is an ABI break with *no* API break.

**Hint:** "Does old *source* still compile?" answers API. "Does an old *binary* still run correctly?" answers ABI. They are not the same question.

<details>
<summary>Solution sketch</summary>

1. Rename → API break **and** ABI break (symbol disappears).
2. Body only → neither (the entire reason shared libraries exist).
3. Non-virtual method → neither (no layout or vtable change).
4. Reorder fields → **ABI break, no API break** — source compiles, but old binaries have the old offsets baked in.
5. Return type widen → both (source changes meaning; return register/width changes).
</details>

---

## Core

### Task C1 — Reveal struct padding with `offsetof`

**Goal:** See that a struct's size is not the sum of its fields, and that field order changes the layout.

**Steps:**
1. Define `struct A { char a; int b; char c; };` and print `sizeof(A)` plus `offsetof(A,a)`, `offsetof(A,b)`, `offsetof(A,c)`.
2. Define `struct B { char a; char c; int b; };` (the same fields, reordered) and print the same.
3. Compare the two total sizes and explain the difference.

**Self-check:**
- [ ] I can point to the padding bytes in `struct A`.
- [ ] I can explain why reordering fields changed the total size.
- [ ] I understand why this makes field order part of the ABI.

**Hint:** `int` wants 4-byte alignment. In `struct A`, padding appears after `a` and after `c`. Group the small fields together (struct B) and you waste fewer bytes.

<details>
<summary>Solution sketch</summary>

`struct A` is typically 12 bytes: `a`@0, 3 pad, `b`@4, `c`@8, 3 trailing pad. `struct B` is typically 8 bytes: `a`@0, `c`@1, 2 pad, `b`@4. Same fields, different layout and size — which is exactly why reordering fields in a public struct is an ABI break.
</details>

---

### Task C2 — Manufacture an ABI break and watch it corrupt memory

**Goal:** Reproduce the "compiled fine, crashes/garbage at runtime" signature from a struct layout change.

**Steps:**
1. Create `widget_v1.h`: `typedef struct { int id; int flags; } Widget;`
2. Write `lib.c` that includes the header and has `void describe(const Widget* w){ printf("id=%d flags=%d\n", w->id, w->flags); }`. Build it as a shared library (`-shared -fPIC`).
3. Write `main.c` that includes `widget_v1.h`, sets `w.id=1; w.flags=7;`, and calls `describe(&w)`. Link against the library and run. Confirm it prints `id=1 flags=7`.
4. Now create `widget_v2.h`: `typedef struct { int id; int generation; int flags; } Widget;` — a field inserted in the *middle*. Rebuild *only* the library against v2 (leave `main` built against v1). Re-run without recompiling `main`.

**Self-check:**
- [ ] My program compiled and linked with no errors in both runs.
- [ ] After upgrading only the library, the printed `flags` value was wrong.
- [ ] I can explain which offset disagreement caused it.

**Hint:** `main` (v1) writes `flags` at offset 4. The v2 library reads offset 4 as `generation` and offset 8 as `flags` (which `main` never wrote). No compiler error — pure ABI mismatch.

<details>
<summary>Solution sketch</summary>

```bash
cc -shared -fPIC lib.c -o libwidget.so        # against v1, then again against v2
cc main.c -L. -lwidget -Wl,-rpath,. -o app
./app                                          # v1 lib: id=1 flags=7
# rebuild ONLY the lib against widget_v2.h, do NOT rebuild app:
./app                                          # id=1 flags=<garbage>
```
The fix in real life: only ever *append* fields to the end of a struct callers hold by pointer, or hide the struct behind an opaque handle so callers never bake in offsets.
</details>

---

### Task C3 — Read symbols out of an object file with `nm`

**Goal:** See the difference between a C symbol and a mangled C++ symbol.

**Steps:**
1. Write `sym.cpp` with `int cpp_add(int,int){...}` and `extern "C" int c_add(int,int){...}`.
2. Compile to an object file: `g++ -c sym.cpp -o sym.o`.
3. Run `nm sym.o | grep add` and read the two symbol names.
4. Pipe the mangled one through `c++filt` to demangle it.

**Self-check:**
- [ ] I can identify the plain C symbol and the mangled C++ symbol.
- [ ] I demangled the C++ symbol back to a readable signature.
- [ ] I understand why `dlsym("cpp_add")` would fail but `dlsym("c_add")` would work.

**Hint:** The Itanium-mangled name looks like `_Z7cpp_addii`. `nm sym.o | c++filt` demangles in place.

<details>
<summary>Solution sketch</summary>

```bash
g++ -c sym.cpp -o sym.o
nm sym.o | grep add
#   _Z7cpp_addii   (mangled: cpp_add(int, int))
#   c_add          (plain C symbol, universal)
echo _Z7cpp_addii | c++filt        # -> cpp_add(int, int)
```
Only `c_add` has a name another compiler — or `dlsym` — can reliably resolve.
</details>

---

## Advanced

### Task A1 — Compare a struct's layout across two compiler flags

**Goal:** Reproduce, in miniature, the libstdc++ dual-ABI mismatch — same source, different layout under a flag.

**Steps:**
1. Write a tiny `struct S` containing a `std::string` member and a function `size_t s_size(){ return sizeof(S); }` exported `extern "C"`.
2. Compile it twice: once with `-D_GLIBCXX_USE_CXX11_ABI=0` and once with `=1`. Print `sizeof(S)` from each build (or `nm` the object and demangle any string-typed symbols).
3. Observe whether the size and/or the mangled names of string-taking functions differ.

**Self-check:**
- [ ] I observed a difference between the two ABI settings (size or mangled name).
- [ ] I can explain why mixing the two in one program causes `undefined reference` link errors.

**Hint:** Add a non-`extern "C"` function `void take(std::string)` and `nm | c++filt` both builds — you will see `std::basic_string` versus `std::__cxx11::basic_string`.

<details>
<summary>Solution sketch</summary>

```bash
g++ -D_GLIBCXX_USE_CXX11_ABI=0 -c s.cpp -o s0.o && nm s0.o | c++filt | grep take
g++ -D_GLIBCXX_USE_CXX11_ABI=1 -c s.cpp -o s1.o && nm s1.o | c++filt | grep take
#  take(std::basic_string<...>)            <- legacy ABI
#  take(std::__cxx11::basic_string<...>)   <- C++11 ABI
```
Different mangled names → the linker treats the two `take` functions as unrelated → `undefined reference` when you mix them. Fix: one macro value for the whole program.
</details>

---

### Task A2 — Read glibc symbol versions with `readelf -V`

**Goal:** See multiple versioned definitions of one symbol coexisting in a single library.

**Steps:** (Linux)
1. Run `readelf -V /lib/x86_64-linux-gnu/libc.so.6` and find the "Version definitions" section.
2. Locate a symbol that has more than one version, such as `memcpy`. Confirm you see both an old version and a default (`@@`) version.
3. Run `readelf -V` on one of your own dynamically linked binaries and find its "Version needs" section — the glibc versions *it* requires.

**Self-check:**
- [ ] I found at least one symbol with two versioned definitions in libc.
- [ ] I distinguished a *provided* version (`@@`/`@`) from a *required* version (Version needs).
- [ ] I can explain why a binary built on a new system may fail on an older one.

**Hint:** `objdump -T /lib/x86_64-linux-gnu/libc.so.6 | grep memcpy` is a friendlier view; you will see `memcpy@@GLIBC_2.14` and `memcpy@GLIBC_2.2.5`. On macOS this task does not apply (no glibc); read the dynamic table with `otool -L` / `nm -m` instead.

<details>
<summary>Solution sketch</summary>

```bash
objdump -T /lib/x86_64-linux-gnu/libc.so.6 | grep ' memcpy'
#   ... GLIBC_2.14  memcpy        (@@ default)
#   ... GLIBC_2.2.5 memcpy        (compat)
readelf -V ./app | sed -n '/Version needs/,/^$/p'   # what app requires
```
The loader binds each binary to the exact version it recorded; a binary requiring `GLIBC_2.34` cannot run where libc only provides up to `GLIBC_2.31` — hence "build on the oldest glibc you support."
</details>

---

### Task A3 — Confirm an ABI break with `abidiff` (if available)

**Goal:** Use the mechanical tool that answers "did I break the ABI?"

**Steps:**
1. Take the v1 and v2 libraries from Task C2 (the struct with a field inserted in the middle), built with `-g`.
2. Install `libabigail` (`abidiff`) if available, and run `abidiff libwidget.so.v1 libwidget.so.v2`.
3. Read the report: it should flag the struct layout change and the offset shift.

**Self-check:**
- [ ] `abidiff` reported the layout change between the two builds.
- [ ] Empty output on two identical builds; non-empty on the breaking change.
- [ ] I can describe how I would gate this in CI against the last release.

**Hint:** No `abidiff`? Approximate it by `nm -D --defined-only` on both libraries and diffing the exported symbol lists, plus a `sizeof`/`offsetof` probe for layout. `abidiff` is more thorough because it also reads DWARF type info.

<details>
<summary>Solution sketch</summary>

```bash
abidiff libwidget.so.v1 libwidget.so.v2
#   'struct Widget' changed: size, member offsets shifted ...
```
CI gate: `abidiff last_release.so candidate.so`; if non-empty and the soname major number did not bump, fail the build.
</details>

---

## Capstone

### Task CAP — Ship a stable C-ABI plugin and evolve it without breaking an old caller

**Goal:** Build a real ABI-stable boundary — a host that loads a plugin via a versioned C vtable and opaque handles — then evolve the host's internal state *and* add a capability, and prove the *old* plugin binary still loads and runs.

**Steps:**
1. Define `plugin_abi.h`: an opaque `typedef struct PluginContext PluginContext;`, and a `PluginVTable` struct whose **first field** is `int32_t abi_version`, followed by function pointers `create`, `process`, `destroy`. Define `#define PLUGIN_ABI_VERSION 1`.
2. Write `plugin.c` exporting one plain C symbol `const PluginVTable* plugin_entry(void)` returning a static vtable with `abi_version = PLUGIN_ABI_VERSION`. Build it as a shared object. Keep this binary — it is your "old plugin."
3. Write `host.c` that `dlopen`s the plugin, resolves `plugin_entry` with `dlsym`, checks `vt->abi_version` and *refuses* to load if it does not match what the host supports, then calls `create`/`process`/`destroy`. Run it; confirm it works.
4. **Evolve the host:** change the *internal* definition of `struct PluginContext` (add fields, reorder them) entirely inside the host. Rebuild only the host. Re-run against the *unchanged old plugin binary* from step 2. It must still work — because the plugin only ever held a `PluginContext*`, never its layout.
5. **Add a capability:** append a new function pointer to the *end* of `PluginVTable`, bump `PLUGIN_ABI_VERSION` to 2, and make the host treat the new function as optional when an older plugin reports version 1. Confirm the old (v1) plugin still loads and the new (v2) plugin gets the new call.

**Self-check:**
- [ ] The host refuses a plugin whose `abi_version` it does not support, with a clean message (not a crash).
- [ ] After changing the host's internal `PluginContext` layout, the *old* plugin binary still ran correctly without recompilation.
- [ ] Appending a vtable function and bumping the version did not break the old plugin.
- [ ] I can explain which two design choices (opaque handle, append-only versioned vtable) made the evolution safe.

**Hint:** The two load-bearing rules: (1) the caller never learns the layout of `PluginContext` — it is opaque — so you can change it freely; (2) you only ever *append* to `PluginVTable` and gate new entries on the version field, so old binaries that stop reading at the old end are unaffected. Reordering or inserting in the middle of the vtable, or exposing `PluginContext`'s fields, would break everything.

<details>
<summary>Solution sketch</summary>

```c
/* plugin_abi.h */
#define PLUGIN_ABI_VERSION 2
typedef struct PluginContext PluginContext;        /* opaque */
typedef struct {
    int32_t abi_version;
    PluginContext* (*create)(const char*);
    int32_t        (*process)(PluginContext*, const uint8_t*, size_t);
    void           (*destroy)(PluginContext*);
    int32_t        (*reset)(PluginContext*);        /* APPENDED in v2 */
} PluginVTable;

/* host.c — guard before use */
const PluginVTable* vt = plugin_entry();
if (vt->abi_version < 1 || vt->abi_version > PLUGIN_ABI_VERSION) { /* refuse */ }
/* only call vt->reset if vt->abi_version >= 2 */
```
The host's `struct PluginContext { ... }` definition can change arbitrarily between releases; the plugin compiled against v1 holds only a pointer and is unaffected. This is the entire pattern behind every durable plugin SDK.
</details>

---

## Wrap-Up

If you completed these, you have done with your hands what most engineers only read about: you measured the LP64/LLP64 split, watched padding rearrange a struct, *manufactured* an ABI break and saw it corrupt memory with zero compiler complaint, read mangled and versioned symbols out of real binaries, and built a boundary that survives both internal evolution and feature growth. The reflex you should walk away with: when a thing "compiles but crashes," reach for `nm`, `readelf -V`, and a `sizeof`/`offsetof` probe — the ABI is not abstract, it is bytes you can print.
