# Name Mangling & Linking — Interview Questions

> **Topic:** [Name Mangling & Linking](README.md)

---

## Introduction

These questions probe whether a candidate understands *why* compiled languages
encode signatures into symbol names, how the linker resolves those symbols, and
why C's lack of mangling is precisely what makes it the FFI lingua franca. Strong
answers can demangle an Itanium symbol by eye, explain `extern "C"`/`#[no_mangle]`
as ABI-surface control, read an "undefined reference" or "multiple definition"
error to its root cause, and reason about symbol visibility and versioning as
deliberate engineering choices rather than incantations.

## Table of Contents

- [Conceptual](#conceptual)
- [Toolchain-Specific](#toolchain-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is name mangling and why does it exist?**

Name mangling is the compiler encoding a function's full identity — namespace,
class, parameter types, template arguments, const/ref qualifiers — into the linker
symbol. It exists because the linker matches symbols by *name only*, and a
language with overloading, namespaces, and templates can have many distinct
functions that share a source name (`foo(int)` and `foo(double)`). Distinct
symbols are the only way the linker can tell them apart.

## Question 2

**Why doesn't C mangle names, and why does that matter for FFI?**

C has no overloading, namespaces, or templates, so a function's source name is
already a unique symbol (perhaps with a platform-specific leading underscore). That
gives C a dead-simple, stable, universally-implemented symbol convention — which is
exactly why every language's FFI speaks C: an unmangled `int add(int,int)` exports
the symbol `add`, and any language can bind to it by that plain name.

## Question 3

**Decode `_ZN3foo3barEi`.**

It's Itanium C++ ABI mangling: `_Z` is the prefix; `N...E` is a nested name;
`3foo` = a 3-char component `foo`; `3bar` = `bar`; `i` = parameter `int`. So it's
`foo::bar(int)`. `c++filt _ZN3foo3barEi` prints exactly that.

## Question 4

**What does the linker actually do with these symbols?**

It collects symbol *definitions* and *undefined references* from every object file
and library, resolves each reference to exactly one definition, applies relocations
(patching addresses into the code/data), and enforces the one-definition rule.
Unresolved references → "undefined reference"; two strong definitions → "multiple
definition."

## Question 5

**What is `extern "C"` and when do you use it?**

`extern "C"` tells a C++ compiler to give a declaration C linkage: no mangling, C
calling convention, no overloading. You use it to *export* a C++ function under a
stable, unmangled symbol so C (or any FFI) can call it, and to *import* C functions
into C++ without the compiler mangling the reference. It's the standard way to put
a C ABI façade on a C++ library.

---

## Toolchain-Specific

## Question 6

**How do GCC/Clang (Itanium ABI) and MSVC mangling differ?**

Both encode the full signature, but with completely different schemes: Itanium
produces `_Z...`-style names (`_ZN3foo3barEi`), MSVC produces `?`-prefixed names
(`?bar@foo@@...`). They are mutually unintelligible, which is one reason a C++
library compiled with MSVC can't be linked against one expecting GCC's ABI. Demangle
with `c++filt` (Itanium) or `undname`/`UnDecorateSymbolName` (MSVC).

## Question 7

**How does Rust mangle, and what is `#[no_mangle]`?**

Rust mangles by default to keep generic instantiations and module paths distinct —
historically a hash-based scheme, now the standardized `v0` mangling
(`_RNv...`), which is reversibly demanglable. `#[no_mangle]` (often with
`extern "C"`) suppresses mangling so the function exports under its plain name for
FFI — required to call it from C.

## Question 8

**What is symbol visibility and how do you control it?**

Visibility decides whether a symbol is exported from a shared object. Defaults
differ (ELF exports everything by default; Windows exports nothing unless marked).
Control it with `-fvisibility=hidden` plus `__attribute__((visibility("default")))`
on the API, `__declspec(dllexport/dllimport)` on Windows, or a linker version
script / `.def` file. Hiding internal symbols shrinks the ABI surface, speeds
load-time symbol resolution, and enables more optimization.

## Question 9

**What is glibc symbol versioning?**

glibc attaches versions like `GLIBC_2.34` to symbols so multiple ABI-incompatible
implementations of the same function can coexist in one library; an old binary keeps
binding to the old versioned symbol while new binaries get the new one. It's how
glibc evolves a function's ABI without breaking already-compiled programs. `readelf
--version-info` / `nm -D` show the versions.

## Question 10

**What are weak symbols and COMDAT/vague linkage?**

A weak symbol can be overridden by a strong definition and doesn't cause a
multiple-definition error. COMDAT/vague linkage lets the same inline function,
template instantiation, or vtable be emitted in many translation units and *folded*
to one at link time — without it, every TU that uses `std::vector<int>` would
collide. The linker picks one copy and discards the rest.

---

## Tricky / Trap

## Question 11

**"undefined reference to `foo(int)`" when linking C++ against a C library. Cause?**

The C++ side declared `foo` without `extern "C"`, so it emitted a *mangled*
undefined reference (`_Z3fooi`) while the C library exports the *unmangled* symbol
`foo`. The names don't match. Fix: wrap the C header's declarations in
`extern "C"` (idiomatically via `#ifdef __cplusplus`).

## Question 12

**You changed a function's parameter from `int` to `long` but only recompiled the
caller. It links and runs but corrupts data. Why?**

In C there's no signature in the symbol, so the old and new `foo` share the symbol
`foo` and the linker happily binds them — but the caller now passes a `long` to a
callee still expecting an `int` (or vice versa across a shared-lib boundary). The
mismatch isn't caught because C symbols don't encode types. (In C++ the mangled
name would have changed, turning it into a link error instead.)

## Question 13

**Two libraries each define a strong symbol `init`. What happens?**

A multiple-definition error at link for static linking; for dynamic linking the
first one found in search order silently wins (interposition), which can call the
wrong `init` entirely. This is a classic ODR/symbol-collision bug; fix with internal
linkage (`static`/anonymous namespace), hidden visibility, or namespacing.

## Question 14

**An ODR violation: two TUs define the same inline function differently. Result?**

Undefined behavior. Because the function has vague linkage, the linker folds all
copies to *one* arbitrarily-chosen definition; every caller silently gets that one,
regardless of which it "saw." The program may work, crash, or differ by build —
classic heisenbug. The rule: an inline function/template/class must be *identical*
in every TU.

## Question 15

**Why might a stack trace show `_ZN...` gibberish instead of function names?**

The demangler wasn't applied (or symbols were stripped). Debuggers/profilers
demangle via `c++filt`/`__cxa_demangle`; if the binary was `strip`ped of its symbol
table, or the tool didn't demangle, you see raw mangled names — or nothing.

---

## Design

## Question 16

**Design the exported symbol surface of a C++ shared library meant to be a stable
plugin ABI.**

Expose *only* `extern "C"` functions (flatten the C++ API to a C ABI), pass opaque
`struct Handle*` pointers instead of C++ objects, return error codes not exceptions,
and compile with `-fvisibility=hidden` so only the explicitly-exported `extern "C"`
entry points are visible. This avoids mangling-scheme lock-in, ODR/vtable-layout
coupling, and exception-ABI mismatch — giving a surface any compiler or language can
bind to and that you can evolve carefully.

## Question 17

**How would you let a Rust library be called from both C and C++?**

Mark the functions `#[no_mangle] pub extern "C"`, use `#[repr(C)]` for any structs
crossing the boundary, and generate a C header (e.g. with `cbindgen`). C calls the
plain symbols directly; C++ includes the header wrapped in `extern "C"` (cbindgen
emits the `#ifdef __cplusplus` guard). Both see a clean, unmangled C ABI.

## Question 18

**You must ship `libfoo.so.2` that adds a function but must not break programs
linked against `.so.1`. Approach?**

Keep the soname/ABI backward-compatible: only *add* symbols, never change an existing
function's signature/layout; if you must change behavior, use symbol versioning to
keep the old versioned symbol alongside the new one. Bump the soname only on a real
ABI break. Hidden visibility on internals keeps the exported surface small and stable.

## Question 19

**How do you keep load time fast for a large shared library with thousands of
symbols?**

Minimize the dynamic symbol table: `-fvisibility=hidden` plus explicit exports (or a
version script), enable `-Bsymbolic`/`-z now` where appropriate, and avoid leaking
template/inline symbols. Fewer exported symbols means less work for the dynamic
linker resolving references at load, and a smaller ABI you must keep stable.
