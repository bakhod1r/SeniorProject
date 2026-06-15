# Build Fundamentals — Interview Questions

> **Roadmap:** [Build Systems](../README.md) → Build Fundamentals
> *A build interview rarely asks "what is a compiler." It asks "you see `undefined reference` — walk me through it," and then watches whether you can separate compile from link, API from ABI, and load time from run time. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — The Build Pipeline](#theme-1--the-build-pipeline)
3. [Theme 2 — Symbols and Linking](#theme-2--symbols-and-linking)
4. [Theme 3 — Static vs Dynamic Linking](#theme-3--static-vs-dynamic-linking)
5. [Theme 4 — The ABI](#theme-4--the-abi)
6. [Theme 5 — ELF, the Loader, and Hardening](#theme-5--elf-the-loader-and-hardening)
7. [Theme 6 — Debugging Scenarios](#theme-6--debugging-scenarios)
8. [Theme 7 — Design and Judgment](#theme-7--design-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **compile vs link** (your code is wrong vs the pieces can't connect)
- **API vs ABI** (source contract vs binary contract)
- **link time vs load time vs run time** (three different borders that fail differently)
- **declaration vs definition** (a promise vs the goods)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a command.

---

## Theme 1 — The Build Pipeline

### Q1.1 — Walk me through what happens when you run `gcc main.c -o app`.

> **Testing:** Do you know the pipeline is multiple distinct stages, or do you think "gcc compiles it"?

**A.** It's four stages, each a separate tool that can fail independently:
1. **Preprocess** — expand `#include` and `#define`, producing a translation unit (`main.i`).
2. **Compile** — translate that to assembly (`main.s`).
3. **Assemble** — assembly to machine code in an object file (`main.o`), which has *holes* (unresolved symbols) where it calls code defined elsewhere.
4. **Link** — combine object files and libraries, resolve every symbol, produce `app`.

`gcc` runs all four silently, but you can stop at each: `-E` (preprocess), `-S` (compile to asm), `-c` (assemble to `.o`), and a final link. The reason the split matters: a *compile* error means your code is wrong; a *link* error means your code is fine but the pieces can't be connected. Different category, different fix.

### Q1.2 — What is a translation unit, and why does editing one header recompile many files?

> **Testing:** Do you understand the compiler's true unit of work, and the textual nature of `#include`?

**A.** A translation unit is one source file *with all its headers fully expanded* — the actual blob the compiler sees, often thousands of lines after preprocessing. `#include` is *textual inclusion*: the header's text is copied into every file that includes it. So changing a header changes the text of every dependent TU, and each must recompile. The build system can only do this incrementally if it tracks the header→source dependency graph — which is why a stale or missing dependency record causes "I changed the header but the rebuild used old code" bugs.

### Q1.3 — Is Python compiled or interpreted? Defend your answer.

> **Testing:** Whether you can resist the false binary and reason about *where translation happens and what you ship*.

**A.** Both, depending on where you draw the line. CPython *compiles* source to **bytecode** (`.pyc` in `__pycache__`) and then a **virtual machine** interprets that bytecode. So it's "compiled to bytecode, interpreted at the VM level" — distinct from AOT languages (C/Go/Rust) that compile to machine code you ship, and distinct from a pure line-by-line interpreter. The useful framing isn't "compiled vs interpreted" but: *what artifact do you ship, and what must exist on the target?* AOT ships machine code (needs nothing); Python ships source/bytecode (needs the interpreter installed).

### Q1.4 — A one-line code change triggers a 10-minute rebuild. What's likely happening?

> **Testing:** Connecting the TU/header model to real build-time pain.

**A.** The change was almost certainly in a *widely-included header*. Because the header is textually copied into every TU that includes it, editing it invalidates all of them, and they all recompile. The fix at the fundamentals level is to reduce header coupling (forward declarations, the pimpl idiom, smaller headers); the build-system level fix is good dependency tracking and caching so unchanged TUs are reused. This is exactly the incremental-build concern that [02 — Dependency Graphs](../02-dependency-graphs/README.md) addresses.

---

## Theme 2 — Symbols and Linking

### Q2.1 — You get `undefined reference to 'parse_json'`. Compile or link error? Root cause?

> **Testing:** The single most important distinction in the whole topic.

**A.** **Link error** — the code compiled fine. The linker found a *use* of `parse_json` (an undefined symbol, `U` in `nm`) but no *definition* (`T`) across any object file or library you gave it. Root causes, in order of likelihood: you forgot to pass the `.o` that defines it; you forgot the `-l` flag for the library; or the library is listed *before* the object that needs it (link order). The fix is never "edit the code" — the code is fine. It's "give the linker the missing piece."

### Q2.2 — What's the difference between a declaration and a definition, and which one does the compiler need?

> **Testing:** Why link errors appear "late."

**A.** A **declaration** is a promise that something exists with a given signature (`int add(int,int);`). A **definition** is the actual body/storage (`int add(int a,int b){return a+b;}`). The *compiler* needs only the **declaration** to compile a TU successfully — it trusts the promise and emits a relocation placeholder. The **linker** needs the **definition** to fill that placeholder. That's why a missing implementation surfaces at *link* time, not compile time: the compiler was satisfied by the promise; the linker is the one collecting on it.

### Q2.3 — What do `T`, `U`, `D`, and `B` mean in `nm` output, and how does the linker use them?

> **Testing:** Whether you've actually inspected symbol tables, and whether you read `U` correctly.

**A.** In `nm`: `T` = defined in **text** (code) — this object *provides* it; `D` = defined initialized **data**; `B` = uninitialized data (**bss**); `U` = **undefined** — this object *needs* it from elsewhere. Linking is a matching problem: for every `U` across all inputs, find exactly one defining `T`/`D`. Zero matches → `undefined reference`. Two matches → `multiple definition`. The classic mistake is reading `U` as "unused" — it means *needed but not provided here*, which sends people chasing the wrong file.

### Q2.4 — Explain the three kinds of linkage in C and why `static` at file scope prevents name clashes.

> **Testing:** Linkage as a visibility mechanism, not an optimization.

**A.** **External** (the default): the symbol is visible to the linker and shareable across TUs. **Internal** (`static` at file scope): the symbol is private to its TU — the linker never sees it. **Weak** (`__attribute__((weak))`): visible but overridable by a strong definition. Two files can each define a `static` helper named `helper` without clashing precisely because internal linkage hides them from the linker; there's nothing for it to find a conflict between. `static` here is a *privacy fence*, not a performance hint.

### Q2.5 — What is relocation, and why can the linker fail when every `.o` is individually valid?

> **Testing:** Whether you understand that addresses are assigned only at link time.

**A.** When the compiler emits a call to an external symbol, it doesn't know the final address, so it writes a placeholder plus a **relocation entry**: "patch the bytes at this offset to point at symbol `X`." The linker lays out all code and data, assigns every symbol its final address, then walks the relocation entries and patches each placeholder. The linker is the *only* stage that sees the combined layout — so it can fail (unresolved symbol, multiple definition) even though each `.o` is internally consistent, because consistency *across* objects is a property only the link step can check.

### Q2.6 — Why does link order matter for static libraries but feel like it doesn't for object files?

> **Testing:** A subtle, real gotcha that separates people who've actually fought the linker.

**A.** The traditional linker scans inputs **left to right** and, for an archive (`.a`), pulls only the members that satisfy *currently undefined* symbols. If a library appears *before* the object that needs it, nothing is undefined yet, so the library contributes nothing — and you get `undefined reference` later. Hence the rule: **objects before libraries** (`gcc main.o -lfoo`, not `gcc -lfoo main.o`). Plain `.o` files are always fully included regardless of order, so they're insensitive to it. (You can also wrap with `--start-group`/`--end-group` for circular dependencies.)

---

## Theme 3 — Static vs Dynamic Linking

### Q3.1 — Contrast static and dynamic linking. When would you choose each?

> **Testing:** Whether you can articulate the tradeoff beyond "size."

**A.** **Static** copies library code *into* the binary at link time: large, self-contained, immune to host library drift — but a library security fix requires *rebuilding* the binary. **Dynamic** records a *reference* (`DT_NEEDED`) and the dynamic linker loads the `.so` at startup: small, shared across processes, and a security patch to the shared `.so` fixes every consumer at once — but the library must be present at a compatible version on the target, the root of most "works on my machine" failures.

Choose **static** for portability to machines you don't control, or single-artifact deployment (Go/Rust default here). Choose **dynamic** when you control the runtime and want fast fleet-wide CVE patching, or when many processes share a library and you care about memory. At scale this is really a *patch-velocity and supply-chain* decision — static means you need an SBOM to know what to rebuild when a CVE drops.

### Q3.2 — Mechanically, what is a `.a` versus a `.so`?

> **Testing:** Beyond the metaphor — do you know what the files actually are?

**A.** A `.a` is an **archive**: a bundle of `.o` files with an index, effectively a `.zip` of object files. At link time the linker extracts *only the members it needs* to resolve undefined symbols and copies that code into the binary; the archive isn't present at runtime. A `.so` is a **fully-linked shared object** loaded at runtime; the binary keeps only a reference to it. Building a `.so` requires position-independent code (`-fPIC`) because the OS may load it at any address (ASLR).

### Q3.3 — Why must shared objects be compiled with `-fPIC`?

> **Testing:** Connecting PIC to load-time addressing and ASLR.

**A.** A shared object can be loaded at *any* address (different per process, randomized by ASLR), and its code segment is shared read-only across processes — so it can't contain hard-coded absolute addresses. `-fPIC` makes the code **position-independent**: it references globals and external functions through indirection tables (the GOT for data, the PLT for lazy-bound functions) resolved relative to the load base at load time, rather than baking in absolute addresses. Omitting `-fPIC` when building a `.so` gives `relocation R_X86_64_... can not be used when making a shared object; recompile with -fPIC`.

### Q3.4 — A Go binary is one file you can `scp` and run; a C binary often isn't. Why?

> **Testing:** Whether you see static linking as the cause.

**A.** Go statically links by default — the runtime and standard library are baked into the single binary, so it has no external `.so` dependencies and runs on any compatible kernel/arch with no setup. Most C/C++ links *dynamically* by default, so the binary needs its shared libraries (and a compatible glibc) present on the target — which is why "missing shared library" / "GLIBC version" errors are a C rite of passage. It's a *build* property (link model), not a language feature. (Go can also produce dynamic binaries via cgo, which reintroduces the libc dependency.)

---

## Theme 4 — The ABI

### Q4.1 — What is the ABI, and how is it different from the API?

> **Testing:** The distinction that catches the most "silent" production bugs.

**A.** The **API** is the *source-level* contract — function signatures, types, what the header declares — and the **compiler enforces it within a TU**. The **ABI** (Application Binary Interface) is the *binary-level* contract: calling convention (which registers/stack carry arguments), struct layout (field offsets, padding, alignment), name mangling, type sizes, vtable layout. Crucially, **nothing re-checks the ABI** when binaries built at different times meet at runtime. So "it compiles and links" guarantees the API lined up; it does *not* guarantee the ABI does.

### Q4.2 — A library upgrade keeps every function signature identical but reorders a struct's fields. It links and starts fine, then corrupts data. What happened?

> **Testing:** Whether you can recognize an ABI break with no error message.

**A.** An **ABI break**. The *API* is unchanged — same signatures, same types — so your code compiles and links against the new header, and the symbols resolve at load time. But the *memory layout* changed: you write `cfg.timeout` at the offset your build-time header said, and the new library reads it at a different offset. Same symbol, same signature, incompatible binary layout. There's no diagnostic because the build only checks the API. This is exactly why mature libraries treat ABI stability as a hard contract and **bump the `.so` major version** (`libfoo.so.2` → `libfoo.so.3`) on an ABI break, and use symbol versioning so the loader can refuse an incompatible library instead of silently miscalling it.

### Q4.3 — What does `version GLIBC_2.34 not found` actually mean, and why does this mechanism exist?

> **Testing:** Symbol versioning as ABI protection.

**A.** glibc uses **symbol versioning**: your binary doesn't just need `memcpy`, it needs a specific version like `memcpy@GLIBC_2.34`, recorded as the newest version your build's glibc offered. The error means the target's glibc is *older* and only provides, say, `memcpy@GLIBC_2.14`. glibc is forward-compatible (new glibc runs old binaries) but not backward-compatible. The mechanism *exists* precisely to prevent silent ABI mismatches: rather than calling an older, potentially incompatible implementation, the loader refuses to start. The fix is to build on the *oldest* glibc you intend to support (the manylinux "build old, run new" principle).

### Q4.4 — Why does C++ have name mangling and C doesn't, and how does that affect linking across the two?

> **Testing:** Name mangling as part of the ABI, and `extern "C"`.

**A.** C++ supports overloading, namespaces, and templates, so a single source name like `add` can correspond to many distinct functions. The compiler **mangles** the symbol to encode the argument types and scope (e.g. `_Z3addii`), making each overload a unique linker symbol. C has no overloading, so `add` stays `add`. This means C and C++ can't link to each other's symbols by default — the names don't match. You bridge it with `extern "C"` in the C++ code, which tells the compiler to emit an unmangled C-style symbol for that declaration so a C caller (or a stable cross-language boundary) can link to it.

---

## Theme 5 — ELF, the Loader, and Hardening

### Q5.1 — ELF has a section header table and a program header table. What's the difference and who uses each?

> **Testing:** Senior-level structural understanding.

**A.** **Sections** (section header table) are the **linker's** view — fine-grained, named, typed regions: `.text` (code), `.rodata` (constants), `.data` (initialized globals), `.bss` (zero-init globals), `.symtab`/`.strtab` (symbols), `.rela.*` (relocations), `.debug_*` (DWARF). The linker combines same-named sections across inputs. **Segments** (program header table) are the **loader's** view — coarse, contiguous ranges to `mmap` with one set of page permissions (`R E` for code, `RW` for data). The section→segment mapping is where W^X and RELRO physically live. Stripping removes sections (`.symtab`, `.debug_*`) the loader never reads, so the binary still runs but loses symbol names.

### Q5.2 — Between `execve` and `main`, what does the dynamic linker do?

> **Testing:** Whether you know `main` isn't the first code to run.

**A.** `execve` reads the ELF, sees the `PT_INTERP` naming `ld.so`, and runs *that* first. The dynamic linker then: (1) builds the transitive `DT_NEEDED` dependency graph; (2) locates each shared object by the search order (RPATH → `LD_LIBRARY_PATH` → RUNPATH → `ld.so.cache` → default dirs) and `mmap`s it at a (usually ASLR-randomized) base; (3) applies relocations, patching the GOT; (4) runs initializers (`DT_INIT_ARRAY` — C++ static constructors); then jumps to `_start` → `__libc_start_main` → finally your `main`. All the pre-`main` startup latency and a chunk of attack surface live in that gap; `LD_DEBUG=libs|reloc|bindings` makes it visible.

### Q5.3 — Explain the GOT and PLT and how lazy binding works.

> **Testing:** The mechanism behind "dynamic linking is free until you call it" and RELRO.

**A.** The **GOT** (Global Offset Table) is a writable table of addresses; external globals and lazily-bound functions get a slot, and code reads the address *from* the GOT rather than embedding it. The **PLT** (Procedure Linkage Table) is a per-function trampoline enabling **lazy binding**: the first call to `printf` jumps to its PLT stub → GOT slot (pointing at the resolver) → the resolver finds `printf`, *writes its address into the GOT slot*, and tail-calls it; subsequent calls read the now-patched slot directly. So you only pay to resolve functions you actually call. The tradeoff: the GOT is writable, an exploit target. **Full RELRO + eager binding** (`-Wl,-z,relro -Wl,-z,now`) resolves everything at load and then marks the GOT read-only, blocking GOT-overwrite attacks at the cost of paying all resolution up front.

### Q5.4 — Name the core Linux exploit-mitigation build flags and what each defends.

> **Testing:** Hardening as a build-time, auditable concern.

**A.** **PIE** (`-fPIE -pie`) — position-independent executable, enabling ASLR for the main executable's own code (not just libraries). **Full RELRO** (`-Wl,-z,relro -Wl,-z,now`) — read-only GOT after load, blocking GOT overwrite. **Stack canaries** (`-fstack-protector-strong`) — detect stack-buffer overflow before `ret`. **FORTIFY** (`-D_FORTIFY_SOURCE=2 -O2`) — compile- and run-time bounds checks on `memcpy`/`sprintf`/etc. Audit any binary with `checksec --file=app`. The professional point: enforce these in the shared build template and *verify in CI* — don't trust per-project Makefiles or distro defaults you can't prove.

### Q5.5 — What's the difference between RPATH and RUNPATH, and why does it matter?

> **Testing:** A real deployment footgun.

**A.** Both are paths embedded in the binary telling the loader where to find its `.so`s, but the search *order* differs: `DT_RPATH` is searched **before** `LD_LIBRARY_PATH` (so it overrides the user's environment — unoverridable without `patchelf`, hence deprecated), while `DT_RUNPATH` is searched **after** `LD_LIBRARY_PATH` (so the environment can override it — the modern, correct choice). Emit RUNPATH with `-Wl,--enable-new-dtags`. Combine with `$ORIGIN` (`-Wl,-rpath,'$ORIGIN/../lib'`) to find bundled libraries relative to the executable, making the whole install *relocatable*. Never ship a binary that depends on `LD_LIBRARY_PATH` — it's a debugging tool that gets silently dropped by a different launcher in production.

---

## Theme 6 — Debugging Scenarios

### Q6.1 — A binary runs on your machine but dies on the server with `libcrypto.so.3: cannot open shared object file`. Walk me through it.

> **Testing:** Calm, tool-driven triage instead of panic.

**A.** First, classify: this is a **load-time** failure, not compile or link — the code is fine, it built and linked. The binary is dynamically linked and the server lacks `libcrypto.so.3` (or it's not on the search path). Triage:
1. `ldd ./app` → shows `libcrypto.so.3 => not found` (confirms the culprit).
2. `readelf -d ./app | grep -E 'NEEDED|RUNPATH'` → ground truth: what it declares it needs and where it'll look.
3. `LD_DEBUG=libs ./app` → watch the loader's actual search, directory by directory.

Fixes: install the library on the server; or statically link it; or ship in a container that bundles it; or set a proper `RUNPATH`/`$ORIGIN` if the lib is vendored alongside. The key discipline is reading `readelf -d` for ground truth *before* poking at `LD_LIBRARY_PATH`.

### Q6.2 — A binary that clearly exists fails with "No such file or directory" when you run it. What's wrong?

> **Testing:** A counterintuitive but common failure.

**A.** The error is misleading — the *binary* exists, but its **program interpreter** (`PT_INTERP`, the `ld-linux`/`ld-musl` named in the ELF) is missing or wrong. Almost always: you copied a **musl** binary (built on Alpine) to a **glibc** host, or vice versa, or the binary is for the wrong CPU architecture. Confirm with `readelf -l ./app | grep INTERP` (shows the required interpreter) and `file ./app` (shows arch + interpreter + PIE status). The fix is to run it on the matching libc/arch, or rebuild for the target.

### Q6.3 — Your service links and starts fine, then crashes the first time it hits a specific code path with `symbol lookup error: undefined symbol`. Why now and not at startup?

> **Testing:** Lazy binding and the run-time border.

**A.** **Lazy binding.** By default the dynamic linker resolves a function symbol only on its *first call*, not at load. The missing symbol lives on a code path you hadn't exercised until now, so resolution — and failure — is deferred to that moment. The loaded library doesn't actually provide that symbol (likely an ABI/version skew where the `.so` is older/newer than you built against). To surface such failures *at startup* instead of mid-run, set `LD_BIND_NOW=1 ./app` (or link with `-z now`), which forces eager resolution of all symbols. Then `readelf -d` / `nm -D` on the actual loaded `.so` to confirm the symbol is genuinely absent.

### Q6.4 — Same code, builds and tests pass in CI, but the released binary fails on customers' older systems with a GLIBC version error. Nothing in the code changed. What changed?

> **Testing:** The glibc floor and build-environment awareness.

**A.** The **build environment's glibc** rose — almost certainly a CI base-image bump (e.g., Ubuntu 20.04 → 22.04). The binary now records newer `GLIBC_x` symbol versions, lifting its **floor** above customers' older glibc. CI passed because the test runners updated too. The fix is to **decouple the release build from the dev/CI base** and build releases inside a deliberately-*old* environment (a `manylinux`-style image), so the floor stays at or below the oldest target. General principle: *build on the oldest libc you support, run on the newest.*

### Q6.5 — `gcc main.o -lfoo` fails with `undefined reference`, but `gcc -lfoo main.o` "should be the same." Resolve the contradiction.

> **Testing:** Link order, in a deliberately inverted prompt.

**A.** It's actually the reverse — **objects must come before the libraries they use**. The correct, working command is `gcc main.o -lfoo`. The linker scans left to right and pulls archive members only to satisfy *currently undefined* symbols. With `-lfoo` first, nothing is undefined yet, so `libfoo` contributes nothing, and `main.o`'s references go unresolved → `undefined reference`. With `main.o` first, its undefined symbols are recorded, then `-lfoo` is scanned and supplies them. So list libraries *last*; for mutual dependencies, use `-Wl,--start-group ... -Wl,--end-group`.

---

## Theme 7 — Design and Judgment

### Q7.1 — You own a shared library consumed by 50 teams. How do you keep it evolvable without breaking everyone?

> **Testing:** ABI stewardship at scale.

**A.** Treat the **ABI as a hard contract**, distinct from the API:
- Build with `-fvisibility=hidden` and export only a deliberate public surface (`__attribute__((visibility("default")))`) — every accidental export becomes a permanent obligation.
- Use a **version script** so I can ship a new incompatible `foo@@LIB_2.0` while old binaries keep `foo@LIB_1.0`.
- Never reorder/resize public struct fields in place; add at the end, or use opaque pointers / accessor functions so layout isn't part of the contract.
- **Bump the `.so` major version** (`SONAME`) on any ABI break, so the loader refuses incompatible pairings instead of silently miscalling.
- Run an ABI-diff tool (`abidiff`/`abi-compliance-checker`) in CI to *catch* breaks before release.

### Q7.2 — A monorepo's C++ incremental build spends 25 seconds linking after a one-line change. What do you do?

> **Testing:** Knowing the linker is the serial bottleneck.

**A.** Linking is the serial whole-program gather step that reruns in full even for a one-line change, while compilation already parallelizes — so the highest-ROI move is **switch the linker to `lld` or `mold`** (`-fuse-ld=mold`), which can cut the link from 25s to a few seconds with zero code changes because mold parallelizes the linker itself. Secondary levers: split into smaller link units / shared libraries so less relinks; ensure debug info isn't ballooning the link (split DWARF, `-gsplit-dwarf`); and if LTO is on, make sure it's **ThinLTO** (cacheable, parallel) not full LTO (serial). The linker swap is the first thing to try.

### Q7.3 — How would you decide between statically and dynamically linking a fleet of services, given you must patch CVEs fast?

> **Testing:** Linking as a supply-chain / incident-response decision.

**A.** If **fast fleet-wide CVE patching** is the priority and I control the base images, lean **dynamic**: a CVE in a shared lib is one `apt upgrade` + restart that fixes every consumer, and I control the glibc floor so it doesn't drift. If I'm shipping self-contained artifacts to environments I don't control, **static** (Go/Rust) wins on portability — *but* I must generate a per-artifact **SBOM** so the next CVE is a query ("which artifacts bundled `libwebp` < x?") instead of an archaeology dig requiring rebuild-and-redeploy of everything. The decision isn't dogmatic; the non-negotiable is *instrumenting whichever I choose* — controlled base images for dynamic, SBOMs for static. The xz/liblzma incident is the cautionary tale: static bundling without an SBOM made inventory the long pole of the response.

### Q7.4 — Why might "just statically link everything" be a *latency* decision, not just a deployment one?

> **Testing:** Whether you connect dynamic linking to startup cost.

**A.** A dynamically-linked binary with many transitive `.so`s pays real cost *before* `main`: the loader `mmap`s each DSO, applies relocations, and resolves symbols (an O(libraries) scan per unresolved symbol). A C++ service linking hundreds of shared libraries can spend hundreds of milliseconds in `ld.so` at startup. Static linking resolves all of that at *build* time, so process startup is just `exec` + run — meaningfully faster cold-start, which matters for short-lived processes, serverless, and anything that forks frequently. So static vs dynamic trades binary size and patch-velocity for startup latency, and for some workloads the latency is the deciding factor.

### Q7.5 — When would you choose musl/Alpine over a glibc base, and what's the hidden cost?

> **Testing:** Whether "small image" reasoning includes the libc swap.

**A.** Choose **musl/Alpine** when I want tiny images and truly-static binaries and I control the whole stack — Go and Rust target musl cleanly. The hidden cost is that **Alpine isn't "small Ubuntu," it's a different libc**: musl's DNS resolver handles `resolv.conf` differently (intermittent resolution bugs), its default thread stack is small (deep recursion segfaults), and its `malloc` historically differs in performance. A glibc-built binary also won't run on musl-only hosts at all. So I'd choose glibc (Debian slim, RHEL UBI, distroless-glibc) whenever I depend on third-party `.so`s, the broad C/C++ ecosystem, or behavioral compatibility — and only reach for Alpine when the size win is worth owning musl's edges.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: `.o` vs `.a` vs `.so`?** A: `.o` = one TU's object code; `.a` = archive (bundle) of `.o`s, linked at build time; `.so` = shared object loaded at runtime.
- **Q: What does `-c` do?** A: Compile/assemble to an object file *without* linking.
- **Q: What does `ldd` show?** A: The shared libraries a binary needs at *load* time, and which can't be resolved.
- **Q: `undefined reference` vs `multiple definition`?** A: Zero matching definitions vs two — both link-time symbol-resolution errors.
- **Q: What is `SONAME`?** A: The shared library's canonical name (`libfoo.so.2`) recorded in `DT_NEEDED`; its major number signals ABI compatibility.
- **Q: What flag forces eager symbol binding?** A: `LD_BIND_NOW=1` at runtime, or `-z now` at link.
- **Q: Why `extern "C"`?** A: Emit an unmangled C-style symbol so C (or a stable boundary) can link to C++ code.
- **Q: What does `strip` remove, and what breaks?** A: Symbol and debug *sections*; the binary still runs but `nm`/debuggers lose names.
- **Q: What's `$ORIGIN` in an RPATH?** A: "Directory of the executable" — makes bundled-library installs relocatable.
- **Q: Lazy vs eager binding in one line?** A: Lazy resolves a function on first call (cheaper startup); eager resolves all at load (safer with RELRO, surfaces missing symbols immediately).
- **Q: Does PIE have a cost?** A: A small extra indirection for the executable's own code; usually negligible, real on measured hot paths.
- **Q: Why `-fPIC` for a `.so` but not always for an executable?** A: A `.so` can load at any address and is shared read-only; PIE executables also use it, but classic fixed-address executables don't need it.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Calling every build error a "compiler error" — failing the compile/link distinction.
- Reading `nm`'s `U` as "unused."
- Claiming "it linked, so it'll run" — ignoring the load/run-time borders.
- Treating ABI and API as the same thing.
- Debugging load failures by randomly exporting `LD_LIBRARY_PATH`.
- "Just statically link it" with no mention of CVE patching / SBOMs.

**Green flags:**
- Naming the *distinction* (compile/link, API/ABI, link/load/run time) before reaching for a command.
- Reaching for `readelf -d` / `LD_DEBUG` for *ground truth* instead of guessing.
- Mentioning the glibc floor and "build old, run new" unprompted.
- Framing static-vs-dynamic as a supply-chain/patch-velocity decision, not just size.
- Knowing `main` isn't the first code to run.
- Caveating tradeoffs ("static is faster startup *but* costs you patch velocity and needs an SBOM").

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **compile vs link**, **API vs ABI**, **link/load/run time**, **declaration vs definition**. Name the distinction first; the command follows.
- **Symbols and linking:** the linker matches every undefined (`U`) symbol to exactly one definition (`T`); `undefined reference` and `multiple definition` are "zero" and "two" matches. Relocation patches placeholder addresses at link time. Link order: objects before libraries.
- **Static vs dynamic** is portability + startup-latency + *supply-chain*: dynamic patches one `.so` for the fleet; static needs a rebuild and an SBOM.
- **The ABI** is the binary contract the build *doesn't* re-check across separately-built binaries — the source of silent corruption; symbol versioning and `SONAME` bumps exist to police it.
- **ELF/loader/hardening:** sections (linker) vs segments (loader); `ld.so` runs before `main`; the GOT/PLT make dynamic calls cheap-until-used and are what RELRO protects; PIE/RELRO/canaries/FORTIFY are auditable build-time flags.
- **Debugging:** classify the border, read `readelf -d` and `LD_DEBUG` for ground truth, and recognize the signatures — "No such file" = wrong interpreter, intermittent garbage = ABI skew, mid-run `symbol lookup error` = lazy-bound missing symbol, GLIBC version = floor too high.

---

## Further Reading

- *Computer Systems: A Programmer's Perspective* (Bryant & O'Hallaron) — Chapter 7, "Linking." The reference for symbols, relocation, and dynamic linking.
- *Linkers and Loaders* — John Levine. Deeper on the linker's internals.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- `man ld.so`, `man nm`, `man readelf`, `man patchelf` — primary sources for the tooling the answers reference.

---

## Related Topics

- [02 — Dependency Graphs](../02-dependency-graphs/interview.md) — incremental-build and dependency questions that follow from the TU model.
- [04 — Per-Language Tools](../04-per-language-tools/interview.md) — how `go build`, `cargo`, and `gradle` wrap this pipeline.
- [09 — Reproducible Builds](../09-reproducible-builds/interview.md) — determinism, toolchain pinning, and SBOM questions.
- [Quality Engineering README](../../README.md) — where build fundamentals sit in the broader interview landscape.
