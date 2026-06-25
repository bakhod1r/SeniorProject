# Name Mangling & Linking — Hands-On Tasks

> **Topic:** [Name Mangling & Linking](README.md)

---

## Introduction

You learn linking by making the linker angry and then understanding why. These
exercises have you demangle real symbols, manufacture and read the two canonical
link errors (undefined reference, multiple definition), control symbol visibility,
and watch vague-linkage folding happen. Tools you'll use: `nm`, `c++filt`,
`objdump`, `readelf`, `ld`, plus your compiler's visibility flags.

Tick a self-check box when you can *explain* the symbol table you're looking at,
not merely when the build succeeds.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Demangle by hand, then by tool

Given `_ZN3foo3barEi`, decode it on paper, then verify:

```sh
echo '_ZN3foo3barEi' | c++filt
```

**Self-check:**
- [ ] I got `foo::bar(int)` by hand.
- [ ] I can identify the `N...E` nested-name and the `i` = `int` parameter encoding.

### Task 2 — See C vs C++ symbols

Compile the same `int add(int,int)` once as C and once as C++, then `nm` both
object files.

**Self-check:**
- [ ] The C object exports `add` (maybe `_add`); the C++ object exports a mangled `_Z3addii`.
- [ ] I can explain why only the C++ name carries the parameter types.

<details><summary>Hint</summary>

`gcc -c add.c` vs `g++ -c add.cpp`, then `nm add.o`. Add `extern "C"` to the C++
version and watch the symbol become `add` again.
</details>

---

## Core

### Task 3 — Reproduce "undefined reference"

Declare `int foo(int);` in a C++ file *without* `extern "C"`, define `foo` in a C
file, and link them. Read the error.

**Self-check:**
- [ ] The linker complains about an undefined `_Z3fooi` (mangled) while the C file defined `foo` (unmangled).
- [ ] Wrapping the declaration in `extern "C"` fixes it.
- [ ] I understand this is a *name mismatch*, not a missing file.

### Task 4 — Reproduce "multiple definition"

Define a non-`static`, non-`inline` global function `init` in two `.c` files and
link both. Then fix it three ways: `static`, an anonymous namespace (C++), and
hidden visibility.

**Self-check:**
- [ ] I triggered the multiple-definition error.
- [ ] Each fix works, and I can explain how it changes the symbol's linkage/visibility.

### Task 5 — Export a C++ function for C

Write a C++ function that uses `std::string` internally but exposes an
`extern "C"` entry point taking/returning `const char*`. Confirm with `nm` that the
exported symbol is unmangled, and call it from a C `main`.

**Self-check:**
- [ ] The exported symbol is the plain name, callable from C.
- [ ] I kept all C++ types behind the boundary (no `std::string` in the signature).

---

## Advanced

### Task 6 — Control the exported surface with visibility

Build a shared library with several functions but mark only one
`__attribute__((visibility("default")))` and compile with `-fvisibility=hidden`.
Inspect the dynamic symbol table with `nm -D` / `readelf --dyn-syms`.

**Self-check:**
- [ ] Only the intended symbol is exported; the rest are local.
- [ ] I can explain why this shrinks the ABI surface and speeds load-time resolution.

### Task 7 — Watch vague-linkage folding

Define an `inline` function (or instantiate `std::vector<int>` operations) used in
two translation units, link them, and confirm there's exactly one definition in the
final binary (no multiple-definition error).

**Self-check:**
- [ ] Both TUs compiled the function, but the linker folded them to one COMDAT copy.
- [ ] I can explain why this is *required* for inline functions/templates to work at all.

### Task 8 — Read symbol versions

On a Linux box, run `readelf --version-info /lib/x86_64-linux-gnu/libc.so.6` (path
may vary) and find versioned symbols like `GLIBC_2.34`.

**Self-check:**
- [ ] I can point to a symbol with multiple versions and explain how old binaries keep working.
- [ ] I understand versioning as ABI evolution without recompilation.

---

## Capstone

### Task 9 — A stable C-ABI plugin, evolved without breaking callers

Design a small plugin shared library:

1. Expose a C ABI: `extern "C"` functions, an opaque `Handle*`, error-code returns,
   `-fvisibility=hidden` with explicit exports.
2. Build a host that `dlopen`s it and calls through the symbols.
3. Now **evolve** the library: add a new function and keep the old ones unchanged.
   Rebuild only the library and confirm the *old, unrecompiled* host still loads and
   works.
4. Then deliberately **break** the ABI (change an exported function's signature) and
   observe/explain the failure in the old host.

**Self-check:**
- [ ] Adding symbols didn't break the old host; changing a signature did.
- [ ] My exported symbol table contains only the intended entry points (verified with `nm -D`).
- [ ] I can explain every symbol's linkage and why the C ABI made the evolution safe.

---

## Self-Assessment

You own this topic when you can:

- [ ] Demangle an Itanium symbol by hand and with `c++filt`.
- [ ] Explain why C doesn't mangle and why that makes it the FFI lingua franca.
- [ ] Diagnose "undefined reference" and "multiple definition" to their root cause.
- [ ] Use `extern "C"`/`#[no_mangle]` and visibility flags to control the exported ABI surface.
- [ ] Explain vague linkage/COMDAT folding, ODR violations, and glibc symbol versioning.
