# Build Fundamentals — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Build Fundamentals
> *The junior page named the stages. This page formalizes the machinery underneath them: translation units, the symbol table, relocation, the C ABI, and why "it links" and "it runs" are two separate promises that can both quietly break.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Translation Unit — the True Atom of Compilation](#the-translation-unit--the-true-atom-of-compilation)
4. [Symbols, the Symbol Table, and Linkage](#symbols-the-symbol-table-and-linkage)
5. [Relocation — How the Linker Actually Patches Addresses](#relocation--how-the-linker-actually-patches-addresses)
6. [Static Libraries vs Shared Objects, Mechanically](#static-libraries-vs-shared-objects-mechanically)
7. [The ABI — the Contract Beneath the Build](#the-abi--the-contract-beneath-the-build)
8. [Load Time vs Run Time — Two Promises](#load-time-vs-run-time--two-promises)
9. [Worked Example — Reading nm, ldd, and objdump](#worked-example--reading-nm-ldd-and-objdump)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does the build machinery actually work, and how do I inspect it?**

At the junior level a build is a pipeline of named stages. That model is correct but cartoonish — it can't yet explain *why* changing a function's signature in a header forces recompiles across the codebase, *why* a library upgrade that "should be compatible" segfaults at startup, or *why* the same `.o` file links into two programs without conflict.

The answers come from three concepts the cartoon glossed over: the **translation unit** (the real unit of compilation), the **symbol table** (the linker's ledger), and the **ABI** (the binary contract that compilation alone can't check). This page makes them concrete with the actual tools — `nm`, `ldd`, `objdump`, `readelf` — that let you *see* the build instead of guessing about it.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can describe compile vs link.
- **Required:** Comfortable on the command line; you can run `gcc` and read its output.
- **Helpful:** You've debugged at least one `undefined reference` or missing-`.so` error.
- **Helpful:** A rough sense of what "an address in memory" means.

---

## The Translation Unit — the True Atom of Compilation

The compiler does not compile "a file." It compiles a **translation unit (TU)**: a single source file *plus every header it pulls in, fully expanded*. The preprocessor produces the TU; the compiler consumes it.

```c
// app.c
#include <stdio.h>     // ~800 lines after expansion
#include "config.h"    // your header
int main(void){ printf("%d\n", MAX_USERS); return 0; }
```

After preprocessing, `app.c`'s translation unit is *thousands* of lines — all of `stdio.h`, all of `config.h`, then your three lines. The compiler sees that whole blob as one indivisible unit. This single fact explains a cluster of real-world behaviours:

- **Why editing a header recompiles many files.** Each `.c` that `#include`s the header has that header *copied into its TU*. Change the header → every dependent TU is now different text → all must recompile. The build system can only track this if it knows the header-to-source dependency graph ([02 — Dependency Graphs](../02-dependency-graphs/middle.md)).
- **Why `#include` order can change behaviour.** The TU is built top-to-bottom; a macro defined early rewrites text that comes later. Headers are not modules — they are *textual inclusion*.
- **Why two TUs can each define a `static` helper named `helper` without colliding.** `static` at file scope means **internal linkage**: the symbol is private to its TU. The linker never sees it, so there's no clash.

> **Key insight:** The TU is the boundary of what the compiler can *see and check*. Anything outside the current TU — a function in another file — is, to the compiler, just a *promised symbol*. All cross-TU correctness is deferred to the linker (for existence) and to the ABI (for compatibility). Most "mysterious" build behaviour is really "the compiler couldn't see across the TU boundary."

---

## Symbols, the Symbol Table, and Linkage

Every object file carries a **symbol table**: a ledger of names it *defines* and names it *needs*. This is the data the linker actually operates on.

Each symbol is in one of two states:

- **Defined** — this TU contains the body/storage for the name. (`T` for text/code, `D`/`B` for data in `nm` output.)
- **Undefined** — this TU *references* the name but expects someone else to define it. (`U` in `nm`.)

And each defined symbol has a **linkage**:

| Linkage | C keyword | Visible to linker? | Use |
|---|---|---|---|
| **External** | (default) | Yes | Functions/globals shared across files |
| **Internal** | `static` (file scope) | No | File-private helpers |
| **Weak** | `__attribute__((weak))` | Yes, but overridable | Defaults, optional overrides |

Linking is, at its core, a **matching problem**: for every `U` (undefined) symbol across all inputs, find exactly one `T`/`D` (defined, external) symbol. Zero matches → `undefined reference`. Two matches → `multiple definition`. This is the entire mental model, and it's literally what the linker does with the symbol tables.

```bash
nm main.o
#                  U add        ← undefined: main.o NEEDS add
#                  U printf     ← undefined: needs printf (from libc)
# 0000000000000000 T main       ← defined:   main.o PROVIDES main

nm math.o
# 0000000000000000 T add        ← defined:   math.o PROVIDES add
```

Link them and the `U add` in `main.o` is satisfied by the `T add` in `math.o`. `printf` stays `U` until libc is linked in. This is not a metaphor for what the linker does — it *is* what the linker does.

---

## Relocation — How the Linker Actually Patches Addresses

When the compiler emits a call to `add`, it doesn't know where `add` will live in memory — that's decided only once everything is laid out together. So it emits a placeholder and records a **relocation entry**: *"at byte offset X in my code, there's an address that needs to be patched to point at symbol `add`."*

```
compile time:  call <????>     + relocation: "patch this to addr of `add`"
link time:     call 0x401136   ← linker computed add's final address and patched it in
```

The linker's job is: lay out all the code and data, assign every symbol a final address, then walk the relocation entries and patch every placeholder. That's why the linker can fail even when every `.o` is individually valid — it's the only stage that knows the *combined* layout.

Two reasons this matters in practice:

1. **Position-independent code (PIC).** Shared libraries can't assume a fixed load address (the OS may load them anywhere, for security — ASLR). So they're compiled `-fPIC` and use an extra indirection (the GOT/PLT) so addresses are resolved relative to load position. Forgetting `-fPIC` when building a `.so` gives the classic `relocation R_X86_64_... can not be used when making a shared object; recompile with -fPIC`.
2. **Why static linking can shrink the final binary's startup cost.** Static linking resolves and patches at *build* time; dynamic linking defers some patching to *load* time (and, lazily, to *first call*). Dynamic linking trades binary size for a little startup work and a runtime dependency.

---

## Static Libraries vs Shared Objects, Mechanically

The junior page framed static vs dynamic as "copied in" vs "referenced." Here's the mechanism.

**Static library (`.a`)** — an *archive*: literally a bundle of `.o` files with an index, like a `.zip` of object files.

```bash
ar rcs libmath.a add.o sub.o mul.o      # create archive
gcc main.o -L. -lmath -o app           # link against it
```

At link time, the linker pulls *only the `.o` members it needs* out of the archive to satisfy undefined symbols, and copies that code into `app`. Unused members are not included. The archive is gone at runtime; `app` is self-contained.

**Shared object (`.so` / `.dll` / `.dylib`)** — a fully-linked library loaded at runtime.

```bash
gcc -fPIC -c add.c -o add.o
gcc -shared add.o -o libmath.so         # build the shared object
gcc main.o -L. -lmath -o app            # records a NEED for libmath.so, copies nothing
```

`app` now contains only a *reference*: "I need `libmath.so`, and from it the symbol `add`." At startup the **dynamic linker** (`ld.so`) finds `libmath.so`, maps it into memory, and resolves the symbol. If it can't find it → the runtime `cannot open shared object file`.

> **The subtle trap:** with a static library, link **order matters** — the linker processes inputs left-to-right and only resolves symbols it has *already seen as undefined*. `gcc -lmath main.o` can fail with `undefined reference` while `gcc main.o -lmath` succeeds, because when the linker saw `-lmath` first, nothing yet needed `add`. Put libraries *after* the objects that use them.

---

## The ABI — the Contract Beneath the Build

The **Application Binary Interface** is the set of low-level conventions two pieces of compiled code must agree on to call each other *correctly at the binary level*:

- How arguments are passed (which registers, what stack layout — the *calling convention*).
- How a `struct` is laid out in memory (field offsets, padding, alignment).
- How names are encoded (**name mangling** — C++ encodes types into symbol names; C does not).
- Sizes of fundamental types, exception-unwinding tables, vtable layout.

Here is the dangerous part: **the compiler checks the *API* (the source-level contract) within a TU; nothing checks the *ABI* across separately-built binaries.** If a shared library was built with one `struct` layout and your program assumes another, *the symbols still match*, *it links fine*, *it loads fine* — and then it reads the wrong bytes and corrupts memory or crashes. There is no error message naming the cause.

```c
// v1 of the library's header — what you compiled against
struct Config { int timeout; };
// v2 of the library actually installed at runtime
struct Config { int retries; int timeout; };  // fields shifted!
```

Your code writes `cfg.timeout` at offset 0; the v2 library reads it at offset 4. Same symbol, same signature, *incompatible ABI*. This is precisely the failure mode that `version GLIBC_2.34 not found` exists to *prevent*: shared libraries carry **versioned symbols** so the dynamic linker can refuse to load a too-old library rather than silently call an ABI-incompatible function.

> **Key insight:** "It compiles and links" guarantees the *API* lined up. It does **not** guarantee the *ABI* lines up at runtime. ABI breakage is the category of bug that slips past the entire build and detonates in production — which is why mature libraries treat ABI stability as a hard contract and bump their `.so` major version (`libfoo.so.2` → `libfoo.so.3`) when they break it.

---

## Load Time vs Run Time — Two Promises

A dynamically-linked program makes its peace with the outside world in *two* distinct moments, and confusing them costs debugging time:

| Moment | Who acts | What can fail | Error you see |
|---|---|---|---|
| **Build/link time** | static linker (`ld`) | symbol not found among inputs | `undefined reference to 'x'` |
| **Load time** (process start) | dynamic linker (`ld.so`) | `.so` missing or too old | `cannot open shared object file`, `GLIBC_x not found` |
| **Run time** (later, lazy) | dynamic linker (lazy PLT) | symbol missing in a lazily-bound call | `symbol lookup error: ... undefined symbol` |

So a program can **link successfully, start successfully, and *then* die** the first time it calls a function that the loaded library doesn't actually provide (lazy binding). Set `LD_BIND_NOW=1` to force all resolution at load time and surface these failures *immediately* rather than mid-run — a useful debugging trick.

---

## Worked Example — Reading nm, ldd, and objdump

Build a two-file program and inspect every layer:

```bash
gcc -c math.c -o math.o
gcc -c main.c -o main.o
gcc main.o math.o -o app

# 1. What symbols does each object define/need?
nm main.o          # U add, U printf, T main
nm math.o          # T add

# 2. What shared libraries does the final binary need at load time?
ldd app
#   linux-vdso.so.1
#   libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6      ← printf lives here
#   /lib64/ld-linux-x86-64.so.2                        ← the dynamic linker itself

# 3. Disassemble to see the relocation got patched
objdump -d app | grep -A3 '<main>:'
#   ... call <add>     ← now a concrete address, not a placeholder

# 4. Full ELF detail: sections, versioned symbols, needed libs
readelf -d app        # dynamic section: NEEDED libc.so.6, etc.
```

This four-command loop — `nm` (symbols), `ldd` (load-time deps), `objdump` (actual code), `readelf` (ELF structure) — is how a senior engineer turns a vague "it won't run" into a specific "it needs `libssl.so.3` and the box only has `.so.1`." Guessing is for people who don't know these tools exist.

---

## Mental Models

- **The symbol table is a ledger of IOUs.** Each object file lists what it *owes* (undefined, `U`) and what it *holds* (defined, `T`/`D`). Linking is settling every IOU: each owed symbol must be paid by exactly one holder.

- **`static` (file scope) is a privacy fence, not an optimization.** It keeps a symbol *internal* to its TU so the linker never sees it — which is why two files can reuse the same private helper name without a clash.

- **The ABI is a verbal contract; the API is the written one.** The compiler enforces the written contract (signatures, types). Nobody re-checks the verbal one (memory layout, calling convention) when binaries built at different times meet at runtime. Trust mismatches there cause silent corruption.

- **Link time and load time are two different border crossings.** First crossing (link): are all the pieces present in the build? Second crossing (load): are the shared pieces present, and compatible, on *this* machine? A passport that works at one border can be rejected at the other.

---

## Common Mistakes

1. **Putting libraries before objects on the link line.** `gcc -lfoo main.o` can fail where `gcc main.o -lfoo` succeeds. The static linker resolves left-to-right against *already-undefined* symbols; list libraries last.

2. **Building a `.so` without `-fPIC`.** Shared objects must be position-independent. Omitting `-fPIC` yields a relocation error at link time on most 64-bit platforms.

3. **Assuming "it linked" means "it'll run."** Linking checks the *build's* symbols. A dynamically-linked binary can still fail at *load* time (missing `.so`) or even later (lazy-bound missing symbol). Use `ldd` to see load-time needs.

4. **Treating an ABI change as an API change.** Reordering struct fields or changing a type's size breaks the ABI even if the *source* still compiles against the new header. Consumers built against the old layout will misread memory. Bump the `.so` major version on ABI breaks.

5. **Reading `nm` output backwards.** `U` means *needs* (undefined here), not *unused*. `T`/`D`/`B` mean *provides*. People routinely invert this and chase the wrong file.

6. **Ignoring weak symbols.** A weak symbol can be silently overridden by a strong one elsewhere. If a default implementation is "mysteriously" replaced, check for weak linkage before assuming a build bug.

---

## Test Yourself

1. What exactly is a *translation unit*, and why does editing a header recompile every file that includes it?
2. In `nm` output, what do `T` and `U` mean, and how does the linker use them?
3. Why does link *order* matter for static libraries but feel like it doesn't for object files?
4. A library upgrade keeps the same function signatures but reorders a struct's fields. It links and starts fine, then corrupts data. What category of break is this, and why did the build not catch it?
5. Your binary links cleanly but dies at startup with `cannot open shared object file`. Which tool do you run first, and what does it tell you?
6. What does `-fPIC` do and when must you use it?

<details>
<summary>Answers</summary>

1. A TU is one source file *with all its headers fully expanded* — the actual blob the compiler sees. A header is textually *copied* into every includer's TU, so changing it changes all those TUs, forcing recompiles.
2. `T` = symbol *defined* (code) in this object; `U` = symbol *undefined* (needed) here. The linker matches each `U` to exactly one `T`/`D` across all inputs.
3. The static linker scans inputs left-to-right and only pulls archive members that satisfy *currently undefined* symbols. A library listed before the code that needs it sees nothing undefined yet, so it contributes nothing. Plain objects are always fully included, so their order is less sensitive.
4. An **ABI break** (memory layout changed). The build only checks the *API* (signatures/types via the header), which still matched — so it linked and loaded. The layout mismatch only manifests as wrong-offset memory access at runtime.
5. `ldd app` — it lists the shared libraries the binary needs at load time and shows which can't be resolved, pointing straight at the missing/`not found` `.so`.
6. `-fPIC` produces position-independent code that works regardless of load address (via GOT/PLT indirection). Required when building shared objects (`.so`), since the OS may load them at any address (ASLR).

</details>

---

## Cheat Sheet

```
INSPECT THE BUILD
  nm file.o            symbols: T=defined(code) D/B=data U=undefined(needed)
  nm -D libfoo.so      dynamic symbols of a shared object
  ldd app              shared libs needed at LOAD time (and which are missing)
  objdump -d app       disassemble — see patched relocations
  readelf -d app       dynamic section: NEEDED libs, versioned symbols
  LD_BIND_NOW=1 ./app  force all symbol resolution at startup (surface lazy fails)

LINKAGE
  (default)  external  → visible to linker, shared across TUs
  static     internal  → private to its TU (no clash, no linker visibility)
  weak       overridable default

THREE BORDERS (where things fail)
  link  time  ld     undefined reference                → piece missing in build
  load  time  ld.so  cannot open shared object / GLIBC  → .so absent/too old
  run   time  ld.so  symbol lookup error                → lazy-bound symbol missing

GOTCHAS
  link order:  objects BEFORE libraries   (gcc main.o -lfoo)
  shared obj:  compile with -fPIC
  ABI break:   same API, different layout → links+loads, corrupts at runtime
               → bump libfoo.so.2 → .so.3
```

---

## Summary

- The compiler's true atom is the **translation unit** — a source file with headers fully expanded. The TU boundary is the limit of what the compiler can see and check; everything cross-file is deferred to the linker and the ABI.
- Object files carry a **symbol table** of defined (`T`/`D`) and undefined (`U`) symbols with a **linkage** (external/internal/weak). Linking is matching every undefined symbol to exactly one definition; the famous errors are just "zero matches" and "two matches."
- The linker assigns final addresses and **relocates** — patches placeholder addresses. Shared objects need `-fPIC` so this works at any load address.
- **Static libraries** (`.a`) are archives the linker pulls needed members from at build time; **shared objects** are referenced and resolved at load time by the dynamic linker. Link order matters for static libs.
- The **ABI** is the binary-level contract (calling convention, struct layout, name mangling). The build checks the *API*, not the *ABI* — so ABI breaks link and load cleanly, then corrupt or crash. This is why ABI stability is a hard library contract.
- A dynamic program crosses **two borders**: link time (build) and load time (this machine). Knowing which border failed — via `nm`, `ldd`, `objdump`, `readelf` — is the difference between fixing it and guessing.

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron) — Chapter 7 again, now read for relocation and symbol resolution in detail.
- *Linkers and Loaders* — John Levine. The definitive book on this stage; dated examples, timeless concepts.
- *How To Write Shared Libraries* — Ulrich Drepper. PIC, the GOT/PLT, and symbol versioning from the glibc maintainer.
- `man ld.so`, `man nm`, `man readelf` — the primary sources for the tools above.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/middle.md) — how the build tracks header→source dependencies to know what to recompile.
- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how each language's toolchain wraps and hides linking.
- [09 — Reproducible Builds](../09-reproducible-builds/middle.md) — making relocation and layout deterministic.
- [senior.md](senior.md) — link-time optimization, the shape of ELF, and toolchain design decisions.
