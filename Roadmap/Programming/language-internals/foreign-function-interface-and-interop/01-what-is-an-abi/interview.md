# What Is an ABI — Interview Questions

> **Topic:** [What Is an ABI](README.md)
> **Focus:** Interview-grade questions on the application binary interface — what it is, how it differs from the API, the major platform ABIs (System V AMD64, Windows x64, AArch64 AAPCS), the C++ ABI problem, and the binary-compatibility traps that separate engineers who have shipped a library from those who have only used one.

---

## Introduction

These questions probe whether you actually understand the contract that lets a compiled binary call another compiled binary. Interviewers use ABI questions because they cleanly separate three populations: people who think "it's the same CPU, so the binaries are compatible" (junior), people who can name a calling convention (middle), and people who have been burned by a struct-layout change or a `std::string` link error in production and can explain exactly why (senior+). Answer with precision — name the register, name the clause, name the macro. Vague answers signal you have read about ABIs but never debugged one.

The questions are grouped: **Conceptual** (what an ABI is and how it differs from an API), **Platform-Specific** (System V AMD64, Windows x64, AArch64 AAPCS, the C++ Itanium ABI), **Tricky-Trap** (the things that compile fine and crash), and **Design** (how you would build something ABI-stable). Aim to answer in two or three precise sentences; depth beats breadth.

## Table of Contents

- [Conceptual](#conceptual)
- [Platform-Specific](#platform-specific)
- [Tricky-Trap](#tricky-trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is an ABI, in one sentence, and how is it different from an API?**

An ABI (Application Binary Interface) is the binary-level contract between compiled components: calling convention, data type sizes and alignment, struct/object memory layout, symbol naming, and the binary format. An API is the *source*-level contract — function names, signatures, types as the compiler sees them. The API is what you compile against; the ABI is what you link and run against.

## Question 2

**What concrete things does an ABI specify?**

How arguments are passed (which registers, which stack slots, in what order) and how values are returned; which registers are caller- vs callee-saved; how the stack is aligned and cleaned up; the size, alignment, and padding of every data type; the in-memory layout of structs and (for C++) objects and vtables; how symbols are named/mangled; and the object/executable format (ELF, PE, Mach-O). For C++ it additionally covers name mangling, vtable layout, RTTI, and exception unwinding.

## Question 3

**Why does the C ABI act as the universal "lingua franca" for interop?**

Because it is small, frozen, and standardized per platform, and it lacks every feature that makes a stable ABI hard — no name mangling, no vtables, no exceptions, no templates, no rich types. Every compiler and almost every language can produce and consume it identically. That is why every cross-language and cross-compiler boundary is a C boundary, even when both sides are written in C++.

## Question 4

**Is "x86-64" an ABI? Why or why not?**

No. "x86-64" is an instruction set architecture (a CPU). An ABI is owned by the *platform* — the OS plus toolchain. The same x86-64 chip runs at least two incompatible ABIs: System V AMD64 (Linux/macOS/BSD) and Windows x64. They differ in argument registers, scratch areas, and integer type sizes, so a binary built for one cannot call a binary built for the other. The mantra: ABI belongs to the platform, not the processor.

## Question 5

**What is a calling convention and how does it relate to the ABI?**

A calling convention is the part of the ABI governing how a function is called: which registers carry arguments and return values, who saves which registers, how the stack is aligned, and who cleans up the stack. It is a subset of the ABI — the ABI also covers data layout, symbol naming, and binary format. Two components must agree on the calling convention or the callee reads arguments from the wrong place and corrupts the stack.

## Question 6

**What does `extern "C"` actually do, and why is it the escape hatch from the C++ ABI problem?**

It disables C++ name mangling so the symbol is a plain C name, and — because it restricts the interface to C types with no exceptions or vtables crossing the line — it sidesteps vtable-layout and exception-model incompatibility entirely. The C ABI has none of C++'s ABI-hard features, so it is identical across every compiler on a platform. That is why interop and plugin boundaries are declared `extern "C"`.

## Question 7

**What is a soname and how does it encode ABI compatibility?**

A soname is the "shared object name" baked into an ELF library, like `libfoo.so.1`. The convention, enforced by the loader: the *major* number changes if and only if the ABI breaks. A binary linked against `libfoo.so.1` will load any compatible `libfoo.so.1.x.y` but the loader refuses `libfoo.so.2`. The soname is the mechanism that turns "ABI break = incompatible" into "the loader physically won't pair them."

## Question 8

**What is name mangling and why does it exist?**

Name mangling encodes a C++ function's name plus its full signature (parameter types, namespace, template arguments) into a single unique symbol, so that overloads and namespaced names map to distinct linker symbols. C has no overloading, so it needs no mangling. Mangling is part of the C++ ABI, and the schemes differ entirely between compilers — Itanium's `_Z3fooi` versus MSVC's `?foo@@YAHH@Z` — which is one reason C++ libraries do not interoperate across compilers.

---

## Platform-Specific

## Question 9

**In the System V AMD64 ABI, how are the first integer arguments passed?**

In the registers `rdi, rsi, rdx, rcx, r8, r9` — six integer/pointer argument registers, in that order — with floating-point arguments in `xmm0`–`xmm7`. Further arguments go on the stack. The integer return value comes back in `rax` (and `rdx` for 128-bit returns). This is the convention on Linux, macOS, and the BSDs.

## Question 10

**What is the red zone in System V AMD64?**

A 128-byte area *below* the stack pointer (`rsp`) that a leaf function may use as scratch without adjusting `rsp`, guaranteed not to be clobbered by signal or interrupt handlers. It lets leaf functions skip the prologue/epilogue stack adjustment. Windows x64 has no red zone — this is one of the concrete incompatibilities between the two x86-64 ABIs.

## Question 11

**How does the Windows x64 calling convention differ from System V AMD64?**

Windows x64 passes only the first *four* arguments in registers — `rcx, rdx, r8, r9` (and `xmm0`–`xmm3` for floats) — versus System V's six. It requires the caller to reserve 32 bytes of "shadow space" on the stack above the return address for the callee to spill those register arguments, and it has no red zone. The callee-saved register set also differs. A function compiled for one convention and called as the other reads arguments from the wrong registers and corrupts the stack.

## Question 12

**What is shadow space (a.k.a. home space) on Windows x64?**

A 32-byte region the caller must allocate on the stack — above the return address, before the call — that the callee owns and may use to spill its four register-passed arguments. It exists whether or not the callee uses it. It is the Windows x64 analogue of (and incompatible with) System V's red zone: shadow space is caller-reserved above the return address; the red zone is callee scratch below `rsp`.

## Question 13

**In AArch64 AAPCS64, how are arguments passed, and how does it compare to x86-64?**

AAPCS64 passes the first eight integer/pointer arguments in `x0`–`x7` and the first eight floating-point/SIMD arguments in `v0`–`v7`, returning integers in `x0`. That is eight integer argument registers — more than System V's six and double Windows x64's four — so more arguments stay in registers, which suits ARM's larger register file. This is the ABI used on Apple Silicon, AWS Graviton, and ARM Linux/Android.

## Question 14

**What is a Homogeneous Floating-point Aggregate (HFA) in AAPCS64?**

A struct of up to four members all of the same floating-point type — e.g. `struct { float a, b, c, d; }` — which AAPCS64 passes in consecutive SIMD/FP registers (`v0`–`v3`) rather than by stack or pointer. It is an aggregate-passing rule with no x86-64 analogue, and a classic source of bugs when porting struct-passing FFI code from x86 to ARM, because the struct travels through entirely different registers.

## Question 15

**Why does the same C source produce non-interoperable binaries on Linux, Windows, and ARM even on conceptually similar hardware?**

Because the three platform ABIs differ in the clauses that govern calls and data: integer argument registers (6 vs 4 vs 8), scratch areas (red zone vs shadow space vs neither), and integer type sizes (`long` is 64-bit under LP64 on Unix but 32-bit under LLP64 on Win64). A function compiled under one ABI and invoked as another reads arguments from the wrong registers, mismatches the stack discipline, and corrupts state. The CPU is the same; the ABI is not.

## Question 16

**What is the Itanium C++ ABI, despite the name?**

It is the de-facto C++ ABI used by GCC and Clang across Unix-like systems (Linux, macOS, BSD) — originally specified for the long-dead Itanium architecture and then adopted as the cross-Unix standard. It defines C++ name mangling (`_Z...`), vtable layout, RTTI/typeinfo layout, object layout under inheritance, and the table-driven exception-unwinding model. MSVC on Windows uses an entirely different, incompatible C++ ABI.

## Question 17

**Name the three independent ways the Itanium and MSVC C++ ABIs disagree.**

(1) **Name mangling** — Itanium emits `_Z3fooi`, MSVC emits `?foo@@YAHH@Z`; completely different schemes. (2) **Vtable layout** — the vtable-pointer position, virtual-function slot order, RTTI placement, and multiple-inheritance arrangement all differ. (3) **Exception handling** — Itanium uses table-driven DWARF/`.eh_frame` unwinding, MSVC uses an SEH-based model, so an exception thrown by one cannot be caught by the other. Plus divergent STL type layouts. Agreement on all of them is required to interoperate, and the two families agree on none.

## Question 18

**Where does the vtable pointer live in an Itanium-ABI object, and why does its layout matter for the ABI?**

In a polymorphic Itanium-ABI object, the vtable pointer is the first word of the object; it points to the virtual function table — an array of function pointers whose slot order is fixed by the ABI, with the typeinfo/RTTI pointer at a defined negative offset. It matters because calling a virtual function indexes a fixed slot in that table; if two compilers lay the table out differently, the same call dispatches to a different function. Adding a virtual function shifts every later slot, which is why it is an ABI break.

---

## Tricky-Trap

## Question 19

**A library upgrade "compiled fine" but the program now segfaults at startup. What is your first hypothesis?**

ABI mismatch: the caller was compiled against one version of a header (one struct layout / symbol set) and is now running against a library with a different binary layout, without being recompiled. The compiler validated the source-level API and never had the chance to validate the binary-level ABI, because the two halves were built at different times. Confirm by checking whether a full clean rebuild of everything makes the crash vanish, and by `abidiff`-ing the two library builds.

## Question 20

**You add a field to the *middle* of a struct in a public header. Is that an API break, an ABI break, or both?**

It is an **ABI break with no API break**. Source that uses the struct still compiles fine, so there is no API break — but every binary compiled against the old layout has the *offsets* of the later fields baked into its machine code, and those offsets are now wrong. Old binaries read and write the wrong bytes. Appending the field at the *end* (for a struct callers only hold by pointer) would have avoided the break.

## Question 21

**Does adding a method to a C++ class break the ABI? Does it depend on the method?**

It depends. Adding a **non-virtual** method does *not* break the ABI — it touches neither the object's layout nor its vtable. Adding a **virtual** method *does* break the ABI, because it inserts a slot into the vtable and shifts every later virtual function's slot index, so existing binaries dispatch to the wrong functions. Neither is an API break; both compile cleanly.

## Question 22

**On 64-bit Windows, what is `sizeof(long)`? Why does this surprise people?**

It is **4 bytes** — 32 bits. Windows 64-bit uses the LLP64 data model, where only `long long` and pointers are 64-bit and `long` stays 32-bit; Unix 64-bit uses LP64, where `long` is 64-bit. It surprises people because code that assumed `sizeof(long) == sizeof(void*)` — safe on LP64 — truncates pointers stored in `long` on Win64. The portable fix is `intptr_t`/`uintptr_t`, which are pointer-sized on both models.

## Question 23

**What does `undefined reference to 'foo(std::__cxx11::basic_string<...>)'` mean?**

It is the libstdc++ dual-ABI mismatch. One translation unit was compiled with `_GLIBCXX_USE_CXX11_ABI=1` (the C++11 string, mangled in the `std::__cxx11` inline namespace) and another with `=0` (the legacy string, mangled as plain `std::basic_string`). Because the two string types have different mangled names, the linker sees the called `foo` and the defined `foo` as different functions. The fix is to compile *everything* with the same value of that macro.

## Question 24

**Why is passing a `std::string` across a shared-library boundary dangerous even when both sides are C++?**

Because a `std::string`'s in-memory layout is not standardized across implementations or even across ABI settings of the same implementation — libstdc++, libc++, the MSVC STL, and the dual-ABI old/new layouts all disagree on what a `std::string` *is* in memory. If the two sides of the boundary were built with different STLs or different ABI flags, they disagree on the byte layout, and passing the object is undefined behavior. The safe boundary marshals to a C string plus length.

## Question 25

**Can a C++ exception safely propagate across a C function in the call stack, or across a foreign-compiler frame?**

No. Exception unwinding is part of the C++ ABI and is not understood by a C frame, and the unwinding *tables* differ between compilers (Itanium DWARF vs MSVC SEH). An exception unwinding through a C frame or a foreign-compiler frame is undefined behavior — it typically calls `std::terminate` or corrupts the stack. The discipline is to catch everything at the boundary (`catch (...)`) and convert to an error code.

## Question 26

**Two static libraries (`.a` files) were built with different `_GLIBCXX_USE_CXX11_ABI` settings. Does static linking save you?**

No. Static linking does not escape the C++ ABI problem. If the two archives disagree on the string ABI (or any type layout), you get the same mismatched mangled names — link errors — or, where the names happen to collide, ODR violations that pick one definition silently and corrupt the layout at run time. The fix is the same: build all inputs, including third-party archives, with a single consistent ABI setting.

## Question 27

**A binary built on a new build server fails to start on older production hosts with `version 'GLIBC_2.34' not found`. What happened and how do you fix it?**

The newer build server's linker recorded a dependency on glibc symbol *versions* (via symbol versioning) that the older production glibc does not provide — you can run against a newer libc but not an older one. The fix is to build the shippable binary on the **oldest** glibc you intend to support, so the recorded symbol-version requirements stay satisfiable downlevel. `readelf -V` on the binary versus the production libc confirms the mismatch.

## Question 28

**The same struct serialized on Linux and deserialized on Windows reads garbage in some fields. Plausible ABI cause?**

A `long` (or other model-sensitive type) in the struct: it is 8 bytes on Linux's LP64 and 4 bytes on Windows's LLP64, so the struct's size and the offsets of every field after the `long` differ between the two platforms. The Windows side reads later fields at the wrong offsets. The fix is fixed-width types (`int32_t`/`int64_t`) in any layout that crosses a platform boundary, never bare `long`.

---

## Design

## Question 29

**You ship a binary SDK that customers build against using GCC, Clang, *and* MSVC. How do you design the interface?**

Expose only an `extern "C"` ABI: plain C functions, fixed-width integer types, and **opaque handles** (forward-declared structs the caller only holds by pointer) for all state. No C++ types, no STL types, no exceptions across the line — catch everything at the seam and return error codes. Internally the SDK can be full C++; the *seam* is C, because the C ABI is the only contract all three compilers honor identically.

## Question 30

**How do you design a plugin ABI that survives both compiler upgrades and the addition of new features?**

Define the contract as a versioned C struct of function pointers (a hand-rolled vtable) plus opaque handles, with an `abi_version` field as the first member that the host checks *before* anything else and refuses to load on mismatch. Keep all state behind opaque pointers so the host can grow its internal structs without breaking the layout the plugin sees. Add new capabilities by *appending* function pointers and bumping the version, never by reordering or changing existing ones — so an old plugin and a new host degrade gracefully instead of crashing.

## Question 31

**How do you evolve a long-lived shared library without breaking the binaries already linked against it, and how do you know whether a change is ABI-safe?**

Treat the exported-symbol set and every public type's layout as frozen: change only the implementation, or *add* new symbols. Use opaque handles for anything you might grow, and reserve struct padding plus a `size` field where a by-value struct is unavoidable. To know whether you broke the ABI, run **`abidiff`** (libabigail) against the last released build in CI — empty output means ABI-compatible, non-empty means you must bump the soname major version. Glibc-style symbol versioning lets you even ship a changed-behavior `func@@LIB_2.0` while keeping `func@LIB_1.0` for installed binaries.

## Question 32

**How would you map SemVer to actual binary compatibility for a C library, and what enforces it?**

MAJOR for any ABI break (a removed/changed symbol, a layout change) — which also requires a soname major bump and forces consumers to recompile; MINOR for purely additive, backward-compatible changes (new symbols only); PATCH for implementation-only fixes that preserve behavior and layout. The enforcement is mechanical: the loader matches binaries to libraries by soname, so the soname must bump in lockstep with the MAJOR/ABI-break, and an `abidiff` CI gate fails the build if an ABI change ships without the corresponding soname bump. Version numbers must track real binary compatibility, not marketing.
