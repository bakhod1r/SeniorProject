# Name Mangling & Linking — Interview Questions

> **Topic:** [Name Mangling & Linking](README.md)

---

## Introduction

These questions probe whether you understand what the linker actually does with the names your compiler emits. They span four bands: **Conceptual** (what mangling is and why it exists), **Toolchain-Specific** (Itanium/GCC/Clang, MSVC, Rust `v0`, `extern "C"`), **Tricky-Trap** (the silent failures — ODR, weak folding, versioning surprises), and **Design** (how you'd architect a stable, cross-language ABI). Strong answers connect a concrete symbol (`_Z3fooi`, `?foo@@YAHH@Z`, `memcpy@@GLIBC_2.14`) to a real consequence (a link error, a load-time cost, a corrupted binary). Vague answers ("the linker resolves names") signal you've never read an `nm` dump in anger.

---

## Table of Contents

- [Conceptual (Q1–Q9)](#conceptual)
- [Toolchain-Specific (Q10–Q20)](#toolchain-specific)
- [Tricky-Trap (Q21–Q28)](#tricky-trap)
- [Design (Q29–Q32)](#design)

---

## Conceptual

## Question 1

**What is name mangling and why does it exist?**

Name mangling is the compiler encoding extra information — namespace/class scope, parameter types, `const`/ref qualifiers, template arguments — into the linker symbol name. It exists because the linker works on a flat namespace of strings and has no concept of types, overloading, or scopes. C++ allows `add(int)` and `add(double)` to coexist; the linker can only tell them apart if they have *different symbol names*. So `add(int)` becomes `_Z3addi` and `add(double)` becomes `_Z3addd`. Mangling is the bridge from a type-rich source language to a type-blind linker.

## Question 2

**Why does C not mangle names but C++ does?**

C has no overloading, no namespaces, no templates — a function name is globally unique by language rule, so `foo` can be the symbol `foo` directly. C++ has overloading and scopes, so the bare name is ambiguous and must be decorated with the signature to stay unique. This is exactly why `extern "C"` exists: it tells a C++ compiler to *not* mangle a particular declaration so it gets a plain C-compatible symbol.

## Question 3

**What does the linker do, in one sentence, with symbols?**

It matches every *undefined* symbol reference in the input objects to exactly one *defined* symbol across all inputs (objects and libraries), records the relocations, and reports an error if a reference has no definition (`undefined reference`) or has more than one strong definition (`multiple definition`).

## Question 4

**What is the difference between a strong and a weak symbol?**

A strong symbol must be unique — two strong definitions of the same name is a `multiple definition` error. A weak symbol may have multiple definitions (the linker keeps one) and is overridden by any strong definition of the same name. Weak symbols enable overridable defaults and, crucially, the vague-linkage folding that lets inline functions and templates live in headers.

## Question 5

**What is vague linkage and what kinds of entities have it?**

Vague linkage is the C++ rule that certain entities are emitted in *every* translation unit that uses them, as weak/COMDAT symbols, and deduplicated by the linker. It applies to inline functions, template instantiations, vtables, RTTI (`type_info`), and static data members of templates. It's why you can `#include` a header full of inline functions and templates into a hundred `.cpp` files and not get `multiple definition` — the linker folds the duplicate copies into one.

## Question 6

**What is the One Definition Rule (ODR)?**

The ODR says every entity (function, variable, type, template specialization) must have exactly one definition across the whole program, and where multiple copies are allowed (inline functions, templates), they must be *token-for-token identical*. Violating it is undefined behavior. The dangerous part: the compiler and linker generally cannot detect an ODR violation, so the program links cleanly and silently misbehaves.

## Question 7

**What is symbol visibility and why control it?**

Visibility decides whether a symbol appears in a shared object's dynamic symbol table (`default` = exported/interposable) or is internal to the module (`hidden`). You control it because exported symbols cost load time (the runtime linker hashes and relocates them), constrain future refactors (consumers can depend on them — they become permanent ABI), and block optimizations. Hiding internals makes a library load faster, optimize better, and have a smaller, enforceable ABI.

## Question 8

**What is the difference between mangling and the ABI?**

Mangling is the *visible* part of the ABI — the symbol names. The full ABI also includes the calling convention (how arguments are passed and values returned), struct/class layout, vtable layout, exception-handling model, and standard-library type layouts. Two libraries can have *matching symbol names* and still be incompatible because their `std::string` layouts differ. A matching name is necessary but not sufficient for compatibility.

## Question 9

**Why is a flat C ABI the universal cross-language interface?**

Because C linkage has no mangling, no overloading, no exceptions, and a stable, well-documented calling convention — the smallest possible contract. Every compiler and language can produce and consume it. So C++/Rust/Go libraries exposed to other languages present a flat `extern "C"` surface of plain functions taking POD and pointers; that surface survives compiler changes, compiler-version changes, and standard-library ABI drift that any richer interface would not.

---

## Toolchain-Specific

## Question 10

**Demangle `_Z3fooi`. What scheme is it and what tool decodes it?**

It's the **Itanium C++ ABI** scheme (used by GCC and Clang on Linux/macOS). `_Z` is the mangling prefix, `3foo` is the length-prefixed name `foo`, `i` is the parameter type `int`. So it's `foo(int)`. Decode it with `c++filt`: `echo _Z3fooi | c++filt` → `foo(int)`.

## Question 11

**Demangle `_ZN3foo3barEi`.**

Itanium nested-name form. `_ZN ... E` wraps a nested (scoped) name: `3foo` then `3bar`, so `foo::bar`, and the trailing `i` is an `int` parameter. Result: `foo::bar(int)`. The `N...E` envelope is the tell that the name has scope (namespace or class).

## Question 12

**How does MSVC mangling differ from Itanium, and what decodes it?**

MSVC uses a completely different, `?`-prefixed scheme that *also encodes the calling convention and storage class*. `add(int,int)` is `_Z3addii` under Itanium but `?add@@YAHHH@Z` under MSVC (`?` opens, `add@@` is name+empty scope, `Y` = free function, `A` = `__cdecl`, the `H`s are the `int`s, `@Z` terminates). Decode it with `undname` or `dumpbin /symbols` — not `c++filt`. The two schemes are mutually unintelligible, which is why you cannot link GCC C++ objects against MSVC ones.

## Question 13

**Why does MSVC encode the calling convention in the mangled name?**

So that a calling-convention mismatch becomes a *link error* rather than a silent runtime crash. On 32-bit Windows, `__cdecl` and `__stdcall` clean up the stack differently; calling one as the other corrupts the stack. By baking the convention into the name (`YA` for `__cdecl`, `YG` for `__stdcall`), a mismatched declaration produces an unresolved-symbol error at link time — the linker catching the bug for you.

## Question 14

**What is Rust `v0` mangling and how does it differ from the legacy scheme?**

Rust mangles because monomorphized generics, modules, traits, and closures all need distinct symbols. The **legacy** scheme reused the Itanium `_ZN..E` envelope and appended an opaque compiler hash (`..17h<hex>E`), which was lossy (you couldn't always recover generic arguments) and unstable across compiler versions. The modern **`v0`** scheme (RFC 2603) starts with `_R`, is hash-free, deterministic, and fully reversible — it encodes generic parameters precisely. Decode it with `rustfilt` (or a recent `c++filt`).

## Question 15

**What do `#[no_mangle]` and `extern "C"` each do in Rust FFI, and why do you need both?**

`#[no_mangle]` forces the function to be emitted under its plain source name (`engine_run`) instead of the mangled `_R...`. `extern "C"` sets the C calling convention. You need both: without `#[no_mangle]` the C side gets `undefined reference` because the real symbol is mangled; without `extern "C"` the name might match but the calling convention is Rust's, which C doesn't speak — a subtler, run-time failure.

## Question 16

**What does `extern "C"` do in C++, and what does it *not* do?**

It disables name mangling for the declared function(s) so they get plain C-compatible symbol names, and it specifies C calling convention/linkage. It does *not* make the function's body C — you can still use C++ inside. And it *cannot* be applied to overloaded functions (two `extern "C"` overloads would mangle to the same name → error) or to member functions in a way that survives, because C has no concept of those. It's strictly a boundary mechanism for free functions with C-compatible signatures.

## Question 17

**You see `undefined reference to 'foo(int)'` (demangled). List the likely causes.**

(1) Declaration/definition mismatch — declared `foo(int)`, defined `foo(long)`, so the names differ. (2) Missing `extern "C"` — `foo` is defined in a C file as plain `foo` but referenced from C++ as `_Z3fooi`. (3) The defining library isn't on the link line, or appears in the wrong order (GNU `ld` resolves left-to-right and drops unreferenced archive members). (4) The symbol exists but was hidden (`-fvisibility=hidden`) or stripped from the library. The demangled *signature* is the clue to which.

## Question 18

**You see `multiple definition of 'counter'`. What happened and how do you fix it?**

Two input objects each provided a *strong* definition of `counter`. The classic cause is a non-inline variable or function *defined* (not just declared) in a header that's included in multiple TUs. Fixes: mark it `inline` (C++17 inline variables), make it `static` if it should be file-local, or declare `extern` in the header and define it in exactly one `.cpp`. In C, GCC 10+'s `-fno-common` default also turns previously-tolerated tentative-definition collisions into this error.

## Question 19

**How do you make a stack trace full of `_Z...` symbols readable?**

Pipe it through `c++filt` (`./prog 2>&1 | c++filt`), use `nm -C`/`objdump -C`/`addr2line -C`, or rely on tools that demangle natively (`gdb`, `perf report --demangle`). If the symbols are `_R...` (Rust `v0`) use `rustfilt`; if `?...@@...` (MSVC) use `undname`. A profiler showing raw symbols usually means it lacks the right demangler for that scheme, not that the data is corrupt.

## Question 20

**What is `strip` and does it change a shared library's ABI?**

`strip` removes the symbol-table and debug-info sections from a binary to shrink it and hide internals. It removes *local* and *debug* symbols but **not** the *dynamic* symbol table — the exported symbols a `.so` must keep to be linkable. So stripping shrinks and cleans the artifact but does **not** change the ABI surface; visibility flags and version scripts control exports, `strip` only removes what was already internal.

---

## Tricky-Trap

## Question 21

**Two `.cpp` files include a header with `inline Config make_config()`, but one is compiled with `-DEXTRA` that adds a field to `Config`. It links cleanly. What's wrong?**

It's an **ODR violation**. Both TUs emit `make_config` under one weak symbol, but with *different* `Config` layouts. The linker folds the two COMDAT copies into one, silently keeping whichever it sees first. Now half the program thinks `Config` is one size and half another, but only one `make_config` body runs — fields get written at the wrong offsets, causing memory corruption that manifests far from the cause. The clean link is the trap; there is no error. Defense: never make a type's layout depend on a flag that varies between TUs sharing it.

## Question 22

**A function is `__attribute__((weak))` with a default, and a strong override sits in an archive (`.a`). The override doesn't take effect. Why?**

A weak symbol is overridden by a strong one only if the linker *actually pulls in* the strong definition. Archive members are pulled in only when something already references a symbol they define. If nothing references the override's symbol, the linker never extracts that member, the strong definition is never seen, and the weak default wins. Fix: force the member in (`-Wl,--whole-archive`, `-u symbol`) or reference it directly.

## Question 23

**Your binary runs on the build machine but fails on an older one with `version 'GLIBC_2.34' not found`. Why?**

You built on a newer distro, so the linker bound your references to the *default* glibc symbol versions of that distro (e.g. `somefunc@@GLIBC_2.34`). The older machine's `libc.so.6` has no `GLIBC_2.34` version node, so the runtime linker can't resolve the binding and aborts. glibc resolution only runs *forward* in version, never backward. Fix: build against the oldest glibc you support (oldest target distro, a sysroot, or a `manylinux`-style image), so the symbols you bind to exist everywhere you deploy.

## Question 24

**What's the difference between `memcpy@@GLIBC_2.14` and `memcpy@GLIBC_2.2.5` in the same `libc.so.6`?**

Symbol versioning lets one library ship multiple ABI versions of the same name. The `@@` node (`memcpy@@GLIBC_2.14`) is the **default** — a program you link today binds to it. The single-`@` node (`memcpy@GLIBC_2.2.5`) is a **compatibility** version: an old binary compiled years ago has that exact versioned reference baked into its relocations and keeps resolving to the old implementation. `memcpy`'s overlap behavior changed, so glibc kept both rather than break old programs.

## Question 25

**Two distinct functions in your binary have the same address after linking with `lld`. What happened and what can it break?**

**Identical Code Folding (ICF)** (`--icf=all`) merged two functionally identical but unrelated functions into one symbol/address to shrink the binary. It breaks any code that relies on *function-pointer identity*: comparing two function pointers for equality, dispatch tables keyed by address, or test frameworks that distinguish functions by pointer. Distinct from COMDAT folding (which folds copies of the *same* entity). Fix: `--icf=safe` or `--icf=none` where identity matters.

## Question 26

**Your "small C API" shared library actually exports 30,000 symbols. You used `-fvisibility=hidden`. What did you miss?**

`-fvisibility=hidden` hides ordinary functions but **not** the weak symbols generated for inline functions and template instantiations — those stay `default`-visibility and leak into your dynamic symbol table. You also need **`-fvisibility-inlines-hidden`** (and/or a `local: *;` version script) to hide the thousands of template/inline weak symbols. Without it your tight C API drags its entire C++ implementation's template symbols into the ABI.

## Question 27

**You link an object built with the old libstdc++ string ABI against one built with the new (`_GLIBCXX_USE_CXX11_ABI`). It links but crashes. Why didn't the linker catch it?**

The two `std::string` layouts are an ABI mismatch, but libstdc++ uses an **inline-namespace ABI tag** so the two strings usually get *different mangled names* — turning many such mismatches into a clean `undefined reference` rather than a crash. If a particular interface slips through with matching names (e.g. a function passing `std::string` by value where the tag didn't differentiate), the linker sees matching symbols and binds them despite incompatible layouts, and you get corruption. A matching name is not a matching contract.

## Question 28

**A profiler's flame graph is full of `_RNvCs...` frames you can't read. Is the data corrupt?**

No — those are **Rust `v0`** mangled symbols, and the profiler demangled with an Itanium demangler (`c++filt`) that doesn't understand `_R...`, so it left them raw. Pipe through `rustfilt`, or configure the profiler with a Rust-aware demangler. Raw symbols in a profile almost always mean a missing/mismatched demangler, not bad data.

---

## Design

## Question 29

**Design the public surface of a C++ library that other teams (possibly other compilers) will link against. What's your strategy?**

Export nothing by default: compile with `-fvisibility=hidden -fvisibility-inlines-hidden` (and/or a `local: *;` version script). Expose only a flat `extern "C"` surface of opaque-handle (`void*`) functions taking POD and pointers — no C++ types across the boundary. Mark each exported function with a cross-platform `*_API` macro (`visibility("default")` on ELF, `__declspec(dllexport)` on PE). Maintain the export list in a version script / `.def` as the single source of truth. This gives a small, enforceable, compiler-independent ABI; review `nm -D` output to confirm only the intended symbols are exported.

## Question 30

**You must change a function's behavior in a shipped library without breaking already-deployed binaries. How?**

Use **symbol versioning** (GNU `ld`). Keep the old implementation as a compatibility version and add the new one as the default: `.symver do_thing_v1, do_thing@MYLIB_1.0` and `.symver do_thing_v2, do_thing@@MYLIB_2.0`, with a version script declaring both nodes. New programs bind `do_thing@@MYLIB_2.0`; binaries linked against your old release keep resolving `do_thing@MYLIB_1.0`. One `.so`, two behaviors, zero field breakage — exactly how glibc evolves.

## Question 31

**How do you ship a small, stripped production binary while keeping the ability to symbolize field crashes?**

Split debug info into a sidecar: `objcopy --only-keep-debug app app.debug` to archive full symbols in a symbol server, `strip --strip-debug --strip-unneeded app` to shrink the shipped binary, and `objcopy --add-gnu-debuglink=app.debug app` to connect them. The shipped binary is small and leaks no internal symbols; a crash from the field plus the archived `app.debug` still yields fully demangled, line-numbered backtraces. Lose the sidecar and you lose symbolication, so archive it reliably.

## Question 32

**You're exposing a Rust core to C and to Python (via ctypes). How do you design the symbol surface?**

Put the entire FFI surface in one module, each function `#[no_mangle] pub extern "C"` taking only C-ABI types (raw pointers, `repr(C)` structs, integers) — opaque-handle pattern (`*mut Engine` created/destroyed by exported functions). Generate the matching C header with `cbindgen` so the header and the actual symbols stay in sync. Verify with `nm -D` that the exported names are exactly the plain, unmangled ones Python/C expect. The flat C surface is simultaneously the C ABI and the ctypes ABI; no caller ever sees a `_R...` symbol or a Rust type layout.

---

## Closing Note

The thread through every band: the linker is a string-matcher with no type knowledge, so *everything* — overloading, scopes, FFI, ABI evolution — is solved by controlling what strings end up in the symbol table and what they bind to. The strongest candidates reach for `nm`, `c++filt`, `objdump -T`, and a version script the way other engineers reach for a debugger, and they treat the dynamic symbol table as a contract to be designed, not a side effect to be ignored.
