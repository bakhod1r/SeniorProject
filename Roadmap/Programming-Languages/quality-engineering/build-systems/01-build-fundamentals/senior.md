# Build Fundamentals — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Build Fundamentals
> *The middle page showed you the machinery. This page is about the decisions: how object files are laid out as ELF, what the dynamic linker really does between `execve` and `main`, and why your choice of linker, LTO mode, and RPATH policy quietly sets the ceiling on a whole organization's build speed and deployment safety.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Object File Anatomy — ELF, Mach-O, PE](#object-file-anatomy--elf-mach-o-pe)
4. [Sections vs Segments — Two Views of the Same Bytes](#sections-vs-segments--two-views-of-the-same-bytes)
5. [The Dynamic Linker (ld.so) From `execve` to `main`](#the-dynamic-linker-ldso-from-execve-to-main)
6. [GOT and PLT — Indirection as a Design Choice](#got-and-plt--indirection-as-a-design-choice)
7. [Symbol Versioning and Visibility](#symbol-versioning-and-visibility)
8. [RPATH, RUNPATH, and the Search-Order Minefield](#rpath-runpath-and-the-search-order-minefield)
9. [Link-Time Optimization — Full and Thin](#link-time-optimization--full-and-thin)
10. [Dead-Code Elimination at Link](#dead-code-elimination-at-link)
11. [Toolchain Design — GCC vs Clang, BFD vs gold vs lld vs mold](#toolchain-design--gcc-vs-clang-bfd-vs-gold-vs-lld-vs-mold)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The structures and tradeoffs a senior engineer reasons about when the build itself becomes the bottleneck or the liability.**

By the middle level you can read `nm`, `ldd`, and `objdump`, and you understand symbols, relocation, and the ABI. That makes you dangerous in a debugging session. The senior jump is different: you now make *policy*. You decide whether the org links with `lld` or `mold`, whether release builds use thin LTO, whether binaries set `RUNPATH` or rely on the loader's default search, and whether a library exports its full symbol table or hides everything behind a versioned facade.

Each of those choices has second-order effects on build wall-time, binary size, startup latency, ABI stability, and the blast radius of a security patch. To choose well you have to understand the artifacts at the byte level — the **ELF** container, the **GOT/PLT** indirection, the loader's relocation work — because that is where the costs actually live. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — TUs, symbol tables, relocation, the ABI, load vs run time.
- **Required:** You can disassemble with `objdump -d` and read `readelf` output without flinching.
- **Helpful:** You've shipped a shared library that someone else consumed, and felt the weight of "don't break the ABI."
- **Helpful:** A working memory of virtual memory: pages, permissions (`r-x`, `rw-`), and why W^X matters.

---

## Object File Anatomy — ELF, Mach-O, PE

An object file or executable is a *container format*. Three dominate, one per platform family, and they solve the same problem with different vocabularies:

| Format | Platforms | Magic | Inspect with |
|---|---|---|---|
| **ELF** | Linux, BSD, most Unix | `7f 45 4c 46` (`\x7fELF`) | `readelf`, `objdump`, `eu-readelf` |
| **Mach-O** | macOS, iOS | `cf fa ed fe` (64-bit LE) | `otool`, `nm`, `dyld_info`, `vtool` |
| **PE/COFF** | Windows | `MZ` ... `PE\0\0` | `dumpbin`, `llvm-readobj`, `objdump` |

They share a common skeleton because they all serve the same two masters — the *linker* (which needs fine-grained, named regions to combine) and the *loader* (which needs a coarse map of what to mmap and with which permissions).

An ELF file begins with an **ELF header** that points to two tables:

```bash
readelf -h app          # the ELF header: type (EXEC/DYN/REL), entry point, table offsets
readelf -S app          # SECTION header table — the LINKER's view
readelf -l app          # PROGRAM header table (segments) — the LOADER's view
```

The single most clarifying fact about ELF: it carries **two parallel descriptions of the same bytes** — a section table for tooling and a segment table for the kernel — and which one is authoritative depends on whether you're building or running. That is the next section.

> **A note on ELF `type`.** `readelf -h` reports `EXEC`, `DYN`, or `REL`. `REL` is a relocatable object (`.o`). `EXEC` is a fixed-address executable. `DYN` is a *position-independent* shared object *or* a PIE executable — which is why a modern "executable" often reports `DYN`. Confusing `DYN` for "this is a library" trips up people reading `file` output on a hardened binary.

---

## Sections vs Segments — Two Views of the Same Bytes

A **section** is the linker's unit: a named, typed region (`.text` for code, `.rodata` for constants, `.data` for initialized globals, `.bss` for zero-initialized globals, `.symtab`/`.strtab` for symbols, `.rela.*` for relocations, `.debug_*` for DWARF). The linker combines sections of the same name across input objects.

A **segment** is the loader's unit: a contiguous range to `mmap` with one set of page permissions. The kernel does not care about your forty sections; it cares about three or four segments:

```bash
readelf -l app
# Type           Offset   VirtAddr           Flags  Align
# LOAD           0x000000 0x...000           R E    0x1000   ← code: read+execute
# LOAD           0x002db8 0x...2db8          RW     0x1000   ← data: read+write
# DYNAMIC        ...                                          ← the dynamic linker's metadata
# GNU_RELRO      ...                          R     0x1       ← made read-only after relocation
```

The **section-to-segment mapping** (shown at the bottom of `readelf -l`) is where `.text` and `.rodata` get folded into one `R E` segment, and `.data` and `.bss` into one `RW` segment. This is not bookkeeping trivia — it's the substrate for security hardening:

- **W^X (write XOR execute):** code segments are `R E`, never `RW`. The split into separate-permission segments is what makes that enforceable.
- **RELRO:** the `GNU_RELRO` segment marks regions (notably the GOT) that the loader flips to read-only *after* it finishes relocating them, closing a class of GOT-overwrite exploits. Full RELRO (`-Wl,-z,relro,-z,now`) plus eager binding means an attacker can't rewrite a function pointer in the GOT after startup.

> **Key insight:** Sections exist for the linker; segments exist for the loader. Stripping (`strip`) removes sections the loader never reads (`.symtab`, `.debug_*`) without touching segments, which is why a stripped binary still runs identically but loses every symbol name your debugger and `nm` wanted. The mapping between the two views is also where every memory-protection feature physically lives.

---

## The Dynamic Linker (ld.so) From `execve` to `main`

When you run a dynamically-linked program, `main` is *not* the first code that executes. The kernel's `execve` reads the ELF, sees a `PT_INTERP` program header naming the **interpreter** — `/lib64/ld-linux-x86-64.so.2` — and hands control to *that* first. Everything before `main` is the dynamic linker doing its job.

```bash
readelf -l app | grep -A1 INTERP
# [Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]
```

The loader's startup sequence, in order:

1. **Build the dependency list.** Read the `DT_NEEDED` entries (`readelf -d`), then transitively their needs, producing the full DSO graph.
2. **Locate each DSO.** Search, in strict order: `DT_RPATH` (deprecated, but still honored if no RUNPATH), `LD_LIBRARY_PATH`, `DT_RUNPATH`, the `ld.so.cache` (`/etc/ld.so.cache`, built by `ldconfig`), then the default trusted paths (`/lib`, `/usr/lib`).
3. **`mmap` each DSO** into the address space at a (usually ASLR-randomized) base.
4. **Relocate.** Apply each DSO's relocations — patch the GOT, bind data references. With eager binding (`LD_BIND_NOW` / `-z now`), resolve *every* function symbol here. With lazy binding (the default), defer function symbols to first call.
5. **Run initializers** — `DT_INIT_ARRAY` (C++ static constructors, `__attribute__((constructor))` functions), in dependency order.
6. **Jump to the entry point** — `_start` (from crt1.o), which sets up `argc`/`argv`/`envp`, calls `__libc_start_main`, which finally calls **your `main`**.

You can watch the whole thing:

```bash
LD_DEBUG=libs ./app        # show DSO search and load order
LD_DEBUG=bindings ./app    # show every symbol bind as it happens
LD_DEBUG=reloc ./app       # show relocation processing
LD_DEBUG=help ./app        # list all categories
```

> **Why a senior cares:** every one of those steps is *startup latency* and *attack surface*. A binary with 200 transitive DSOs pays for 200 `mmap`s, 200 relocation passes, and a symbol-resolution scan whose cost grows with the number of exported symbols across the graph (the loader does an O(libraries) search per unresolved symbol). This is precisely why large C++ services that link hundreds of shared libraries can spend hundreds of milliseconds in `ld.so` before `main` — and why "just statically link it" is sometimes a *latency* decision, not only a deployment one.

---

## GOT and PLT — Indirection as a Design Choice

Position-independent code can't bake absolute addresses into `.text` (that segment is shared read-only across processes; per-process patches would break sharing and W^X). Two tables solve this:

- **GOT — Global Offset Table** (`.got`, `.got.plt`): a writable table of *data*. Each external global variable and each lazily-bound function gets a slot. Code reads the address *from* the GOT instead of embedding it. The loader writes the real addresses into the GOT at relocation time; the GOT is per-process and in the `RW` segment.
- **PLT — Procedure Linkage Table** (`.plt`): a small trampoline *per* external function, enabling **lazy binding**. The first call to `printf` jumps to its PLT stub, which jumps through the GOT to the resolver (`_dl_runtime_resolve`), which finds `printf`, *writes its address into the GOT slot*, and tail-calls it. Every subsequent call reads the now-patched GOT slot and jumps straight there.

```
first call:   call printf@plt → PLT stub → GOT slot (points to resolver)
              → resolver finds printf, patches GOT slot, jumps to printf
later calls:  call printf@plt → PLT stub → GOT slot (now points to printf) → printf
```

```bash
objdump -d -j .plt app          # see the PLT trampolines
readelf -r app                  # relocations: .rela.plt (lazy) vs .rela.dyn (eager)
```

The design tradeoff is explicit: lazy binding makes startup cheaper (you don't resolve functions you never call) at the cost of a tiny first-call overhead and a *writable, executable-adjacent* GOT that exploits target. Eager binding plus full RELRO (`-z now -z relro`) makes the GOT read-only after startup — safer, but you pay all resolution up front. For a short-lived CLI, lazy is fine; for a long-running hardened service, eager + RELRO is the standard hardened posture.

> **Key insight:** The GOT/PLT is the physical reason dynamic linking is "free until you call it" and the physical thing that RELRO protects. Once you see that a call to a shared-library function is really *a load from a writable table*, both the performance story and the security story become obvious.

---

## Symbol Versioning and Visibility

A mature shared library exports a *deliberately small, deliberately versioned* surface. Two mechanisms control this.

**Visibility** decides which defined symbols even appear in the dynamic symbol table. By default, every external symbol in a `.so` is exported — which bloats the dynamic symbol table (slower loader resolution), leaks internals, and makes ABI commitments you didn't mean to make. The disciplined default is to hide everything and opt in:

```c
// compile the whole library with -fvisibility=hidden, then:
__attribute__((visibility("default"))) int public_api(void);   // exported
int internal_helper(void);                                      // hidden (default-hidden)
```

```bash
gcc -fvisibility=hidden -fPIC -shared *.c -o libfoo.so
nm -D libfoo.so | grep ' T '      # only the symbols you chose to export
```

**Symbol versioning** lets one `.so` export multiple incompatible versions of the same symbol so old binaries keep working while new ones get new behavior — this is how glibc ships decades of compatibility in a single `libc.so.6`. A version script:

```
# libfoo.map
LIBFOO_1.0 { global: foo; bar; local: *; };
LIBFOO_2.0 { global: foo; } LIBFOO_1.0;   # a NEW foo@@LIBFOO_2.0; old callers keep foo@LIBFOO_1.0
```

```bash
gcc -shared -fPIC -Wl,--version-script=libfoo.map *.o -o libfoo.so.2
readelf --dyn-syms libfoo.so.2     # see foo@LIBFOO_1.0 and foo@@LIBFOO_2.0
```

This is the machinery behind `version GLIBC_2.34 not found`: your binary recorded a *versioned* requirement (`memcpy@GLIBC_2.34`), and the older library on the target only provides `memcpy@GLIBC_2.14`. The loader refuses rather than silently calling an ABI-incompatible implementation. Symbol versioning is how `02-dependency-graphs` and `09-reproducible-builds` concerns meet the ABI: the version is part of the dependency contract, baked into the artifact.

> **Senior decision:** if you own a widely-consumed `.so`, `-fvisibility=hidden` plus a version script is not optional polish — it is the difference between being able to evolve the library and being frozen forever because every accidental export is now someone's load-bearing dependency.

---

## RPATH, RUNPATH, and the Search-Order Minefield

Where the loader looks for a DSO is governed by a search order that has caused more "works here, not there" incidents than almost anything else:

```
DT_RPATH (legacy, if no RUNPATH)  →  LD_LIBRARY_PATH  →  DT_RUNPATH  →  ld.so.cache  →  default dirs
```

The trap is the ordering difference between the two embedded paths:

- **`DT_RPATH`** is searched *before* `LD_LIBRARY_PATH` — so a baked-in RPATH overrides the user's environment. Deprecated for exactly this reason: it's unoverridable without patching the binary.
- **`DT_RUNPATH`** is searched *after* `LD_LIBRARY_PATH` — so the environment can override it. This is the modern, correct choice when you ship a binary that bundles its own libraries.

```bash
gcc main.o -L. -lfoo -Wl,-rpath,'$ORIGIN/../lib' -Wl,--enable-new-dtags -o app
#   --enable-new-dtags  → emit DT_RUNPATH (modern) instead of DT_RPATH (legacy)
#   $ORIGIN             → "directory of the executable" — makes the install relocatable
readelf -d app | grep -E 'RPATH|RUNPATH|NEEDED'
```

`$ORIGIN` is the senior's tool for *relocatable installs*: `-rpath '$ORIGIN/../lib'` makes the binary find its bundled libraries relative to *itself*, so the whole install tree can move without breaking. This is how AppImage, many vendored toolchains, and language runtimes ship self-contained.

To fix an already-built binary without recompiling — invaluable when debugging a third-party artifact:

```bash
patchelf --print-rpath app
patchelf --set-rpath '$ORIGIN/lib' app
patchelf --replace-needed libold.so.1 libnew.so.1 app
```

> **The rule:** prefer `DT_RUNPATH` + `$ORIGIN` for shipped binaries; treat `LD_LIBRARY_PATH` as a *debugging* tool, never a deployment mechanism — environments are forgotten, inherited by children, and unset in production. A binary that needs `LD_LIBRARY_PATH` set to run is a binary that will fail the day it runs under a different launcher.

---

## Link-Time Optimization — Full and Thin

Ordinary compilation optimizes *within* a TU. The compiler cannot inline across the TU boundary because, when it compiles `app.c`, it has never seen the body of `add` in `math.c`. **Link-time optimization (LTO)** removes that wall by deferring real codegen to *link* time, when every TU is present.

Mechanically, with LTO the compiler emits not machine code but a *serialized intermediate representation* (GIMPLE for GCC, LLVM bitcode for Clang) into the object file. The linker, via a plugin, hands all of that IR back to the compiler's optimizer, which now optimizes the *whole program* — cross-TU inlining, cross-TU constant propagation, cross-TU dead-code elimination — and only then emits final code.

```bash
# Full / "fat" LTO — whole program in one optimizer instance
gcc  -flto -O2 -c *.c
gcc  -flto -O2 *.o -o app

clang -flto=full -O2 *.c -o app
```

**Full LTO** gives the best optimization but is a scalability disaster: it serializes the entire program through one optimizer process — enormous memory, no parallelism, and it murders incremental builds (change one file, re-optimize everything). For a large codebase this is a non-starter.

**ThinLTO** (Clang/LLVM; GCC's analog is WHOPR/partitioned LTO) fixes this. It does a cheap, parallel *summary* pass over all the bitcode to build a call graph and decide cross-module import decisions, then optimizes each module *in parallel*, importing only the specific functions it needs from other modules. The result: most of full LTO's wins at near-normal build cost, and it *caches* (incremental ThinLTO).

```bash
clang -flto=thin -O2 -c *.c          # each .o now holds bitcode + a summary
clang -flto=thin -O2 *.o -o app -fuse-ld=lld \
      -Wl,--thinlto-cache-dir=.lto-cache    # cache for incremental rebuilds
```

> **Senior decision matrix:** for a small static binary where you control the link, full LTO is fine and simplest. For a large monorepo target, **ThinLTO** is almost always the right answer — it's the only LTO mode that survives contact with a real build cache and parallel build farm. And LTO of any kind requires that *all* inputs (including static libs) carry IR; a single non-LTO `.a` becomes an optimization barrier. Coordinate LTO as a *toolchain-wide* decision, which ties directly into [09 — Reproducible Builds](../09-reproducible-builds/senior.md): LTO codegen must be pinned to a compiler version to stay deterministic.

---

## Dead-Code Elimination at Link

A library you link against contains far more than you call. By default the linker pulls in whole *sections*, so unused functions ride along, bloating the binary and its attack surface. The fix is **section-level garbage collection**, and it has two halves.

First, the compiler must put each function and data object in its *own* section so the linker can drop them individually:

```bash
gcc -ffunction-sections -fdata-sections -c *.c
```

Then the linker garbage-collects sections unreachable from the entry point / exported symbols:

```bash
gcc *.o -Wl,--gc-sections -o app
gcc *.o -Wl,--gc-sections -Wl,--print-gc-sections -o app   # report what got dropped
```

Without `-ffunction-sections`, GC is coarse: if any function in a section is reachable, the *whole* section (every function the compiler grouped together) survives. The two flags are a pair; one without the other is mostly wasted.

This is also why **LTO and `--gc-sections` compound**: LTO's whole-program view finds dead code the per-TU compiler couldn't (e.g., a function only ever called by another dead function), and `--gc-sections` physically removes it. Together they're the standard recipe for minimal release binaries.

> **The connection to static linking:** `--gc-sections` is the reason static linking doesn't bloat as much as people fear — the linker already pulls only the *archive members* you reference (recall the `.a` mechanics from middle.md), and with section GC it further drops unreferenced functions *within* a pulled member. A statically linked Go or Rust binary is small not despite static linking but because of aggressive dead-code elimination layered on top of it.

---

## Toolchain Design — GCC vs Clang, BFD vs gold vs lld vs mold

A "toolchain" is a coordinated set of components, and a senior often gets to choose them. The two halves:

**Compiler front/middle/back end — GCC vs Clang:**

| | GCC | Clang/LLVM |
|---|---|---|
| IR for LTO | GIMPLE | LLVM bitcode |
| ThinLTO | partitioned LTO (WHOPR) | first-class `-flto=thin` |
| Diagnostics | good, improving | historically clearer |
| Sanitizers | yes | originated here (ASan/UBSan/TSan) |
| Tooling reuse | monolithic | library-based (clang-tidy, IDE backends) |

In practice the *codegen quality* gap is small and workload-dependent; the bigger differentiators are ThinLTO maturity, sanitizer ergonomics, and whether your platform's ABI is GCC-canonical (Linux distro packages are built with GCC; mixing Clang-built `.so`s is generally fine for C but demands care for C++ where the C++ ABI and libstdc++ vs libc++ choice intrudes — see the ABI discussion in middle.md).

**Linkers — the bigger lever for build speed:**

| Linker | Origin | Relative link speed | Notes |
|---|---|---|---|
| **BFD ld** | GNU binutils default | baseline (slowest) | Most compatible; the reference behavior |
| **gold** | Google, ELF-only | ~2x BFD | Now largely superseded; deprecated upstream |
| **lld** | LLVM | ~3–5x BFD | Cross-platform (ELF/Mach-O/PE/wasm), excellent ThinLTO integration |
| **mold** | R. Ueyama (also wrote lld) | ~5–10x+ | Fastest; heavily parallel; the current speed leader on Linux |

Selecting the linker is a one-flag decision and frequently the single highest-ROI build-speed change for a large C/C++/Rust project:

```bash
gcc   main.o -fuse-ld=lld  -o app
clang main.o -fuse-ld=mold -o app
# or globally for a build, with newer GCC/Clang:
clang main.o -B/usr/libexec/mold -o app          # point at mold's ld wrapper
mold -run make                                    # intercept ld for an existing build
```

Link time dominates the *edit-build-test* loop on large native projects because linking is inherently a whole-program, mostly-serial gather step — you relink the *entire* binary even after a one-line change. Compilation parallelizes across cores trivially; linking historically did not. mold's contribution is making the linker itself massively parallel, which is why dropping in `-fuse-ld=mold` can cut a 30-second incremental link to 3 seconds with zero code changes.

> **Senior decision:** for a large native codebase, the default org-wide toolchain choice in the mid-2020s is *Clang + lld (or mold) + ThinLTO*, because that combination is the only one that makes whole-program optimization coexist with fast, cacheable, parallel builds. GCC + BFD remains the right call when you must match a distro's canonical ABI exactly or when you depend on a GCC-only feature. Whatever you pick, pin it (version + flags) — an unpinned toolchain silently breaks [reproducibility](../09-reproducible-builds/senior.md) the day a runner upgrades.

---

## Mental Models

- **ELF has two readers with different needs.** The linker reads *sections* (fine-grained, named, typed); the loader reads *segments* (coarse, permission-tagged). Every confusion about "where does this byte live and who can write it" resolves by asking *which reader's view* you're in.

- **`main` is the middle of the story, not the start.** Between `execve` and `main` the dynamic linker locates, maps, relocates, and initializes a whole graph of DSOs. Startup cost and a real chunk of attack surface live in that gap — `LD_DEBUG` is your window into it.

- **A shared-library call is a load from a writable table.** The GOT/PLT turns "call this external function" into "read its address from the GOT, then jump." That one fact explains lazy binding's cheapness, its first-call cost, and exactly what RELRO is defending.

- **LTO moves the optimization boundary from the TU to the whole program — and ThinLTO is what makes that affordable.** Full LTO is the pure idea; ThinLTO is the engineering that lets it survive a build farm.

- **The linker is the serial bottleneck of the native build.** Compilation parallelizes; linking gathers everything into one artifact. That's why the linker choice (mold/lld) often beats every other build-speed tweak.

---

## Common Mistakes

1. **Shipping `LD_LIBRARY_PATH` as a deployment mechanism.** It's searched before RUNPATH, inherited by child processes, and silently unset in production launchers. Use `DT_RUNPATH` + `$ORIGIN` for relocatable installs; reserve `LD_LIBRARY_PATH` for interactive debugging.

2. **Using `DT_RPATH` instead of `DT_RUNPATH`.** Legacy RPATH overrides the user's environment and can't be overridden without `patchelf`. Always pass `-Wl,--enable-new-dtags` to emit RUNPATH.

3. **Exporting every symbol from a shared library.** Default visibility leaks internals, bloats the dynamic symbol table (slower load-time resolution), and turns accidental exports into permanent ABI obligations. Build with `-fvisibility=hidden` and opt in.

4. **Reaching for full LTO on a large codebase.** It serializes the whole program through one optimizer, destroys incremental builds, and exhausts memory. Use `-flto=thin` with a cache; full LTO only for small, self-contained binaries.

5. **Enabling `--gc-sections` without `-ffunction-sections -fdata-sections`.** Section GC can only drop *whole sections*; without per-function/per-data sections the granularity is too coarse to remove anything. The flags are a set.

6. **Assuming `DYN` in `readelf -h` means "library."** Modern PIE executables are also `DYN`. Check for a `PT_INTERP` and an entry point, or `file`'s "pie executable" annotation, before concluding it's a shared object.

7. **Mixing LTO and non-LTO inputs and expecting full optimization.** A single non-LTO `.a` is an optimization barrier — the optimizer can't see across it. LTO is all-or-nothing across the inputs you care about.

---

## Test Yourself

1. ELF carries a section header table and a program header table. Which does the *kernel loader* use, which does the *linker* use, and what does each unit represent?
2. Trace what happens between `execve` and your `main` for a dynamically-linked program. Name three steps the dynamic linker performs.
3. Explain lazy binding in terms of the PLT and GOT. What does RELRO + eager binding change, and what does it defend against?
4. You own a `.so` consumed across the company. List two build-time mechanisms you'd use to keep your ABI surface small and evolvable, and what each does.
5. A binary runs when launched from its build directory but fails to find its library in production. Name the likely RPATH/RUNPATH cause and the fix that makes the install relocatable.
6. Why is full LTO usually wrong for a large monorepo, and what does ThinLTO change to fix it?
7. Your incremental build's bottleneck is a 25-second link. What's the single highest-ROI change, and why does it work?

<details>
<summary>Answers</summary>

1. The **kernel loader** uses the **program header table** (segments) — coarse regions to `mmap` with given page permissions. The **linker** uses the **section header table** (sections) — fine-grained named/typed regions (`.text`, `.data`, `.bss`, `.symtab`…) that it combines across inputs. Stripping removes sections without touching segments.
2. `execve` reads `PT_INTERP` and runs `ld.so` first. The loader: (a) builds the transitive `DT_NEEDED` DSO graph; (b) locates and `mmap`s each DSO (RPATH/`LD_LIBRARY_PATH`/RUNPATH/`ld.so.cache`/default dirs); (c) applies relocations / patches the GOT; (d) runs `DT_INIT_ARRAY` initializers; then jumps to `_start` → `__libc_start_main` → `main`.
3. The first call to an external function jumps to its **PLT** stub, which reads a **GOT** slot pointing at the resolver; the resolver finds the function, writes its address into the GOT slot, and jumps there. Subsequent calls read the patched slot directly. **Eager binding + RELRO** (`-z now -z relro`) resolves everything at load time and then marks the GOT read-only, defending against post-startup GOT-overwrite attacks (at the cost of paying all resolution up front).
4. (a) `-fvisibility=hidden` + `__attribute__((visibility("default")))` on the public API — only chosen symbols are exported, shrinking the dynamic symbol table and the ABI surface. (b) A **version script** (`--version-script`) — versions symbols so you can ship a new incompatible `foo@@LIBFOO_2.0` while old binaries keep `foo@LIBFOO_1.0`, evolving without breaking consumers.
5. Most likely the binary has no embedded path and relied on the build directory being on `LD_LIBRARY_PATH`, or has an absolute RPATH that doesn't exist in production. Fix: link with `-Wl,-rpath,'$ORIGIN/../lib' -Wl,--enable-new-dtags` so it finds bundled libs relative to the executable — a relocatable install. (`patchelf --set-rpath` for an existing binary.)
6. Full LTO serializes the *entire* program through one optimizer instance — huge memory, no parallelism, and any change re-optimizes everything (no incrementality). **ThinLTO** does a cheap parallel summary/call-graph pass, then optimizes each module in parallel importing only needed functions, and caches results — most of the wins at near-normal, cacheable, parallel build cost.
7. Switch the linker to **lld or mold** via `-fuse-ld=`. Linking is the serial whole-program gather step that reruns in full on every change; compilation already parallelizes. A faster, parallel linker (mold) can cut a 25-second link to a few seconds with no code change.

</details>

---

## Cheat Sheet

```
ELF STRUCTURE
  readelf -h app      ELF header (type EXEC/DYN/REL, entry, table offsets)
  readelf -S app      sections  — LINKER's view (.text .rodata .data .bss .symtab)
  readelf -l app      segments  — LOADER's view (LOAD R E / LOAD RW / GNU_RELRO)
  readelf -d app      dynamic section (NEEDED, RPATH/RUNPATH, versioned syms)
  readelf -r app      relocations (.rela.plt lazy / .rela.dyn eager)

DYNAMIC LINKER (between execve and main)
  PT_INTERP → ld.so   reads NEEDED graph, mmaps DSOs, relocates GOT, runs INIT
  LD_DEBUG=libs|bindings|reloc|help ./app   trace the loader
  GOT = data table of addresses (writable);  PLT = per-fn trampoline (lazy bind)

HARDENING (build-time flags)
  -fPIE -pie                   position-independent executable (ASLR for code)
  -Wl,-z,relro -Wl,-z,now      full RELRO + eager bind → GOT read-only after start
  -fstack-protector-strong     stack canaries
  checksec --file=app          audit all of the above

SEARCH ORDER (DSO lookup)
  DT_RPATH(legacy) → LD_LIBRARY_PATH → DT_RUNPATH → ld.so.cache → default dirs
  ship with: -Wl,-rpath,'$ORIGIN/../lib' -Wl,--enable-new-dtags   (RUNPATH+relocatable)
  fix existing: patchelf --set-rpath / --replace-needed

SIZE / SPEED
  -fvisibility=hidden + version-script   small, evolvable .so ABI
  -ffunction-sections -fdata-sections -Wl,--gc-sections   drop dead code at link
  -flto=thin -Wl,--thinlto-cache-dir=DIR  whole-program opt, parallel + cacheable
  -fuse-ld=lld | -fuse-ld=mold            fastest linkers (biggest build-speed win)
```

---

## Summary

- An object/executable is a **container** — ELF (Linux), Mach-O (macOS), PE (Windows) — carrying two parallel descriptions of the same bytes: **sections** for the linker, **segments** for the loader. The section-to-segment mapping is where W^X and RELRO physically live.
- `main` runs *after* the **dynamic linker** has located, mapped, relocated, and initialized the entire DSO graph. That gap is real startup latency and real attack surface; `LD_DEBUG` reveals it.
- The **GOT/PLT** turns external calls into loads from a writable table, which is why lazy binding is cheap, why first calls cost a little, and exactly what **RELRO** + eager binding defends.
- **Symbol visibility** (`-fvisibility=hidden`) and **symbol versioning** (version scripts) keep a shared library's ABI surface small and evolvable — the discipline that lets glibc-style compatibility exist.
- **RPATH/RUNPATH** + `$ORIGIN` make installs relocatable; `LD_LIBRARY_PATH` is a debugging tool, not a deployment one. Prefer RUNPATH via `--enable-new-dtags`.
- **ThinLTO** + **section GC** + a **fast linker (lld/mold)** is the modern recipe for builds that are simultaneously well-optimized, small, and fast — and the linker choice is usually the single biggest build-speed lever, because linking is the serial whole-program gather step.

You now reason about the build as a set of *policy* decisions with measurable second-order effects. The next layer — [professional.md](professional.md) — is about operating those decisions across an organization, in production, under real failure.

---

## Further Reading

- *Linkers and Loaders* — John Levine. Still the canonical treatment of relocation, libraries, and dynamic loading.
- *How To Write Shared Libraries* — Ulrich Drepper. Visibility, the GOT/PLT, symbol versioning, and load-time cost, from glibc's maintainer.
- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron) — Chapter 7, now for PIC, the GOT/PLT, and ELF in depth.
- [The mold linker README and design notes](https://github.com/rui314/mold) — why a linker can be 5–10x faster and what it parallelizes.
- [LLVM ThinLTO documentation](https://llvm.org/docs/FatLTO.html) and the original ThinLTO paper — the summary-based, parallel LTO design.
- `man ld.so`, `man ld`, `man patchelf`, the System V ABI and ELF specifications.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/senior.md) — how LTO and DSO graphs interact with incremental, cacheable builds.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — pinning the toolchain (compiler, linker, LTO mode) so codegen is deterministic.
- [04 — Per-Language Tools](../04-per-language-tools/senior.md) — how Go, Rust, and C++ toolchains expose (or hide) linker and LTO choices.
- [Language Internals › Compilers](../../../language-internals/compilers-and-interpreters/README.md) — what the optimizer does *inside* the compile and LTO stages.
