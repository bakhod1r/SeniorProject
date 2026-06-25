# Dynamic Linking & Loading — Interview Questions

> **Topic:** [Dynamic Linking & Loading](README.md)

---

## Introduction

These questions probe whether a candidate understands what happens between `exec` and `main`, and the policy and mechanism that decide which definition of a symbol a running program actually reaches. The strongest answers are mechanical and specific: they name the GOT and PLT, distinguish lazy from eager binding, describe the search order that makes interposition possible, and connect each idea to a real engineering consequence — startup latency, security patching, dependency hell, DLL hijacking, or a classloader leak. Weaker answers stop at "the loader links the libraries" without explaining how a call reaches the right address or why the choices matter.

The questions are grouped: **Conceptual** (the model that's true everywhere), **Platform-Specific** (Linux ELF/`ld.so`, Windows DLLs, macOS `dyld`/Mach-O, JVM classloaders), **Tricky / Trap** (where the obvious answer is wrong), and **Design** (scenarios that test whether the candidate has actually shipped and debugged this).

## Table of Contents

- [Conceptual](#conceptual)
- [Platform-Specific](#platform-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is the difference between static and dynamic linking, and what does each cost you?**

Static linking copies library code into the executable at build time, producing a self-contained binary; dynamic linking records a dependency list and resolves the libraries at load/run time via the dynamic loader. Static linking gives fast startup (nothing to resolve), trivial deployment (one file), and reproducibility — at the cost of large binaries, no cross-process memory sharing, and painful security patching (a `libssl` CVE means rebuilding *every* binary). Dynamic linking gives small binaries, one copy of a library shared in physical RAM across processes, and easy patching (fix one `.so`, every program benefits) — at the cost of slower startup (the loader must find/map/resolve), deployment fragility (the right library versions must be present), and possible run-time-vs-build-time version drift. The single most decisive factor each way: **patching favors dynamic; cold-start latency and deployment simplicity favor static.**

## Question 2

**What does the dynamic loader do, and when does it run relative to `main`?**

It runs *before* `main`. For a dynamically linked executable, the kernel sees a recorded interpreter (the loader, e.g. `ld-linux.so`) and runs it first. The loader reads the binary's "needed" list, finds each library via the search order, `mmap`s it into the process, recursively loads transitive dependencies, processes relocations (wiring up symbol addresses), runs initializer/constructor functions (`DT_INIT_ARRAY`), and only then transfers control to `main`. At process exit (or library unload) it runs the finalizers/destructors. So "your program" is really "the loader, which then runs your program."

## Question 3

**Explain the GOT and the PLT and how a cross-library call uses them.**

The GOT (Global Offset Table) is a writable, per-process table of pointers; after resolution, each slot holds a symbol's real run-time address. The PLT (Procedure Linkage Table) is a read-only table of tiny stubs, one per imported function. Position-independent code can't hard-code external addresses (they vary per process and per ASLR run), so the *code* — which is shared and constant — reaches external functions indirectly: it calls the function's PLT stub, which jumps through the function's GOT slot. The GOT is the single writable place where per-process, resolved addresses live; the PLT is the indirection that routes calls through it. This one layer of indirection is exactly what makes code sharing and ASLR possible.

## Question 4

**Walk through what happens on the first call to a lazily-bound function, and on the second call.**

First call: the code calls `func@plt`; the stub does `jmp *GOT[func]`, but that slot still holds its initial value, which points back into the PLT at a small trampoline (`push index; jmp PLT0`). That routes into the loader's resolver (`_dl_runtime_resolve`), which looks up `func` across the loaded libraries, finds its address, **writes that address into `func`'s GOT slot**, and jumps to `func` so the call completes. Second call: `jmp *GOT[func]` now reads the patched slot and goes straight to `func` — one indirect jump, no loader involvement. Lazy binding is machine-level memoization: pay the resolution cost once, only for symbols you actually call, only when first called.

## Question 5

**Lazy vs eager (now) binding — what's the trade-off, and when would you force eager?**

Lazy binding resolves each function on first call: faster startup (you only pay for symbols you use) but a first-call latency spike per symbol and a GOT that stays writable for the process lifetime (attackable). Eager/now binding (`-z now` / `LD_BIND_NOW=1`) resolves everything at load: slower startup but no first-call spikes, deterministic latency, and — paired with full RELRO (`-z relro -z now`) — a GOT remapped read-only after load, defeating GOT-overwrite exploits. Force eager for latency-sensitive servers (no hidden first-call spikes) and for security-hardened builds. It also surfaces unresolved-symbol errors at startup (fail-fast) instead of mid-execution.

## Question 6

**Why must shared library code be position-independent, and what role does the GOT play in that?**

A shared library may be loaded at a different virtual address in every process, and at a random address on every run under ASLR. If its code contained absolute addresses for external symbols, those would be wrong in every process. PIC solves this by addressing external functions and globals *indirectly* through the GOT (and using RIP-relative addressing for its own internal references). The code stays byte-identical across processes — so it can be mapped read-only and shared in physical RAM — while only the small, writable GOT differs per process, holding the addresses that vary. No GOT, no sharing and no practical ASLR.

## Question 7

**What's the difference between an ABI and an API, and how does a soname encode ABI compatibility?**

An API is a source-level contract (function signatures, headers): if it holds, you can recompile and it works. An ABI is a binary contract (calling conventions, struct layout, symbol names/versions, vtable layout): if it holds, an *already-compiled* binary keeps working without recompilation. ABI breaks are silent — no compiler catches a reordered struct field. The soname (`libssl.so.3`) encodes the ABI generation; binaries record the soname they need. Compatible changes (adding symbols, with versioning) keep the soname; incompatible changes (removing/changing symbols, reordering public structs, changing calling conventions) require a **soname bump** (`.so.3` → `.so.4`) so old and new binaries can each find their own real file and coexist.

## Question 8

**Why does a binary with many shared libraries start slower, and what eliminates that cost?**

Each library costs the loader: open the file, `mmap` it, parse its dynamic section, recursively load its dependencies, process relocations, run constructors — plus per-symbol hash-table lookups across all loaded objects. A binary pulling in dozens of transitive `.so`s spends real milliseconds before `main`; relocation processing and symbol lookup dominate. Static linking and AOT compilation eliminate most of it by resolving at build time, which is why they win serverless cold starts and frequently-launched CLIs. The historical `prelink` mitigated dynamic startup by pre-computing relocations, but it's effectively dead because fixed addresses fight ASLR.

---

## Platform-Specific

## Question 9

**(Linux) Describe the loader's library search order and the most common way it fails.**

Roughly: (1) `LD_PRELOAD` objects; (2) `DT_RPATH` (deprecated, before `LD_LIBRARY_PATH`) — but in practice (3) `LD_LIBRARY_PATH`, then (4) `DT_RUNPATH` baked into the binary, then (5) the `ld.so.cache` (`/etc/ld.so.cache`, rebuilt by `ldconfig` from `/etc/ld.so.conf`), then (6) default system dirs (`/lib`, `/usr/lib`, multiarch variants). (Note RPATH is searched before `LD_LIBRARY_PATH` while the newer RUNPATH is searched after — a frequent point of confusion.) The common failure is `error while loading shared libraries: libX.so: cannot open shared object file` — the library isn't in any searched location. Diagnose with `ldd` (or `readelf -d` for an untrusted binary), find the `not found` line, make that library findable.

## Question 10

**(Linux) What is the ELF dynamic section, and name the entries the loader most relies on.**

`.dynamic` is an array of `(tag, value)` entries that drive the loader. Key tags: `DT_NEEDED` (each required library — the shopping list), `DT_SONAME` (this library's own name), `DT_RPATH`/`DT_RUNPATH` (baked search paths), `DT_JMPREL`/`DT_PLTRELSZ` (PLT relocations — the lazy `JUMP_SLOT`s), `DT_RELA`/`DT_RELASZ` (data relocations — `GLOB_DAT`), `DT_SYMTAB`/`DT_STRTAB` (dynamic symbol/string tables), `DT_GNU_HASH` (fast symbol lookup), and `DT_INIT_ARRAY`/`DT_FINI_ARRAY` (constructors before `main`, destructors at unload/exit). `readelf -d` prints it; it's the loader's literal to-do list.

## Question 11

**(Linux) What is `LD_PRELOAD` and give a real use. How does a preloaded wrapper call the original function?**

`LD_PRELOAD` lists `.so`s the loader inserts *before* all dependencies, so their symbols win the first-match search — interposition. Canonical use: replacing `malloc`/`free` with jemalloc/tcmalloc, or inserting a counting/leak-detecting shim, across an *unmodified* binary; sanitizers and many profilers work the same way. A wrapper that augments rather than replaces resolves the original via `dlsym(RTLD_NEXT, "malloc")` — "the next definition after me in the search order" — caches that pointer, does its bookkeeping, and forwards. It works because cross-library calls go through dynamic symbol resolution; it does *not* work against a statically linked binary (calls already resolved internally) and is stripped for setuid binaries for security.

## Question 12

**(Linux) Explain symbol versioning and the `version 'GLIBC_2.34' not found` error.**

Symbol versioning lets one library ship multiple ABI-incompatible definitions of a name: glibc defines `memcpy@GLIBC_2.2.5` (old) and `memcpy@@GLIBC_2.14` (the `@@` default), and the loader binds each binary to the exact version it recorded a need for — old binaries keep their old behavior, new binaries get the new one, all from one `libc.so.6`. The `version not found` error means you built against a *newer* glibc than the target system has, so the requested version of the symbol simply isn't present. The version request is a hard floor, not a preference — even if the older symbol would work, the loader refuses. Fix: build against the oldest glibc you must support, or static-link, or use `musl`.

## Question 13

**(Windows) What is the IAT, and what is DLL hijacking/planting?**

The Import Address Table is Windows' equivalent of the GOT: the PE header lists imported DLLs and functions, and the loader fills the IAT with resolved pointers, through which `call [IAT_slot]` reaches the function. DLL hijacking/planting exploits the **DLL search order**, which historically searched the application's directory and the current working directory *early*. If an attacker can drop a malicious DLL — named like one the app loads by bare name — into a directory searched before the legitimate one (e.g. the `Downloads` folder an installer runs from), the app loads and executes the attacker's code with the app's privileges. It's a repeatedly-exploited RCE class. Defenses: `SetDefaultDllDirectories`/`SafeDllSearchMode`, loading by fully-qualified path, `LOAD_LIBRARY_SEARCH_*` flags, and code signing.

## Question 14

**(Windows) What is delay-loading and what does it buy and cost?**

A delay-loaded DLL isn't resolved at startup; the loader defers it until the first call into one of its functions (via a stub that loads the DLL on demand). It buys faster startup (skip DLLs you may not use) and the ability to run when an *optional* dependency is absent — you catch the structured exception on the failed delay-load and degrade gracefully. It costs late failure surfacing: a missing or incompatible DLL launches fine and crashes the one user who exercises that feature, with a stack deep in the loader, rather than failing cleanly at launch.

## Question 15

**(macOS) What is a two-level namespace, and how does it differ from Linux's flat namespace?**

In macOS's default two-level namespace, each undefined symbol an object imports records *which library* it expects to provide it (e.g. `malloc` *from libSystem*), so resolution is "get this symbol from that specific library," not a flat global search. Consequence: the same symbol name defined in two libraries does **not** collide — each importer binds to its declared provider. This prevents the silent first-match interposition Linux's flat namespace allows, but it also means Linux-style `LD_PRELOAD` interposition doesn't translate directly — macOS uses `DYLD_INSERT_LIBRARIES` plus an explicit `__interpose` table. You can opt into a flat namespace (`-flat_namespace`), reintroducing both Linux-like interposition and Linux-like collisions. This is a real portability gotcha.

## Question 16

**(macOS) What are `dyld`, `.dylib`, and how do you inspect dependencies?**

`dyld` is macOS's dynamic loader (the analogue of `ld.so`). Shared libraries are `.dylib` files; "frameworks" are bundles containing a `.dylib` plus headers and resources. `otool -L <binary>` lists a binary's dynamic dependencies (the `ldd` analogue), and `otool -l` dumps load commands. Dependencies are often recorded with `@rpath`, `@loader_path`, or `@executable_path` prefixes (macOS's equivalents of `$ORIGIN`), letting bundled apps locate their `.dylib`s relative to the app. `install_name_tool` rewrites those paths when bundling.

## Question 17

**(JVM) Walk through the phases of class loading.**

Three stages. **Loading:** a classloader finds the `.class` bytes (disk, JAR, network, or generated in memory) and creates a `Class` object. **Linking**, in three sub-phases: **verification** (prove the bytecode is well-formed and type-safe — a notable chunk of startup cost), **preparation** (allocate static fields, set to default 0/null values — not yet running initializers), and **resolution** (turn symbolic constant-pool references into direct references — the JVM's lazy, per-reference analogue of relocation). **Initialization:** run static initializers and static field assignments, the first time the class is *actively used*. So the JVM is a verified, per-class dynamic linker with lazy resolution.

## Question 18

**(JVM) Explain the classloader hierarchy and parent delegation. Why does class identity include the classloader?**

Classloaders form a tree — Bootstrap (core `java.*`) → Platform → Application/System (your classpath) → custom loaders (app servers, OSGi, plugins). Parent delegation: when asked to load a class, a loader first asks its parent, loading the class itself only if the parent can't. This guarantees core classes load once via the bootstrap loader and can't be shadowed by application code — a security and integrity property. Class identity is `(fully-qualified name, defining classloader)`: the same class file loaded by two different loaders yields two distinct, *incompatible* `Class` objects. That's deliberate — it's how app servers isolate two web apps bundling different versions of the same library — and it's the cause of the baffling `ClassCastException: Foo cannot be cast to Foo`.

## Question 19

**(JVM) `ClassNotFoundException` vs `NoClassDefFoundError` — distinguish them precisely.**

`ClassNotFoundException` is a checked `Exception` thrown by *explicit* loading — `Class.forName(...)`, `loader.loadClass(...)`, reflection — when the named class can't be found. The code asked for a class by name; the loader couldn't locate it. `NoClassDefFoundError` is an `Error` thrown when the JVM needs a class to *link or execute* directly-referenced code (a `new`, a field type, a superclass) and the class is missing at run time **or** its static initializer previously threw. The signature of the latter is "present at compile, gone or broken at run" — usually a build-vs-run classpath mismatch, or a poisoned class whose `static {}` block threw once and now makes every reference fail (masking the original `ExceptionInInitializerError`).

---

## Tricky / Trap

## Question 20

**A binary file exists and is executable, but running it gives "No such file or directory." How is that possible?**

The "file" the kernel can't find is not the binary — it's the binary's **interpreter**, the dynamic loader recorded inside it. A binary built for `ld-musl-x86_64.so.1` run on a glibc-only system (or a 32-bit loader on a system without the 32-bit runtime, or a cross-arch binary) will produce `No such file or directory` even though the executable is right there. Confirm with `readelf -l <bin> | grep interpreter` (or `file <bin>`) and install the matching loader/runtime. Classic Alpine-vs-Debian container surprise.

## Question 21

**Two libraries you link both define a function `log`. On Linux, what happens — and would macOS behave the same?**

On Linux's flat namespace, this is **not** a link or load error: the loader's first-match search silently picks one definition (the one earlier in the search order), and *every* caller — including the library that "owns" the other `log` — may end up in the winner's function with mismatched expectations. The failure is non-local and maddening. On macOS's default two-level namespace, each importer is bound to the specific provider it declared, so the names *don't* collide — each library gets its own `log`. The Linux fix is to hide internal symbols (`-fvisibility=hidden`, version scripts) so they can't interpose each other, or use `-Bsymbolic` so a library prefers its own definitions.

## Question 22

**`dlclose` returned success, but you suspect the library wasn't actually unloaded. Why might that be?**

`dlclose` decrements a reference count; it only unmaps when the count hits zero. If anything still holds the library — another `dlopen` of the same path, the `RTLD_NODELETE` flag, a thread still running its code, a registered callback or atexit handler pointing into it, a `ThreadLocal`-style reference — the count stays positive and the code stays mapped. Worse, if you *think* it unloaded and call into a function pointer you saved, you may get a use-after-unload crash (if it really did unload) or stale behavior (if it didn't). Treat `dlclose` as best-effort and never call into a plugin after closing it. This is the native analogue of a JVM classloader leak.

## Question 23

**You disabled PIE/ASLR (`-no-pie`) and a flaky crash disappeared. Did you fix the bug?**

No — you hid it. If a bug's reproducibility depends on address randomization, you almost certainly have undefined behavior (an uninitialized or dangling pointer, an out-of-bounds access that lands somewhere benign at a fixed layout) that ASLR merely *exposes* by changing the layout. Disabling randomization makes addresses deterministic, so the corrupted access happens to hit harmless memory each run. The real fix is finding the UB (ASan/Valgrind), not the flag. Shipping `-no-pie` to "fix" it also discards a security mitigation.

## Question 24

**Your app redeploys fine the first few times in the container, then OOMs after the tenth redeploy. The classes themselves are small. What's happening?**

A classloader leak. Each redeploy creates a new classloader for the app; the old one (and *all* its classes and static fields) should become garbage. But something with a longer lifetime than the app holds a reference *into* the old classloader, pinning it: a `ThreadLocal` on a container-owned pooled thread, a JDBC driver still registered in the JVM-wide `DriverManager`, an `ExecutorService`/`Timer` the app started but never stopped (whose thread's context classloader pins the app loader), a static cache in a shared library, or an MBean/shutdown hook. Each pinned classloader retains tens of MB; ten redeploys later, OOM. Fix: deregister/clear/shut down everything on undeploy, and heap-dump-diff to find the GC-root path to the leaked classloader.

## Question 25

**Why was double-checked-locking-style "is the library loaded yet?" not the issue — but why *is* lazy binding's first-call resolution something to think about for concurrency?**

Glibc's lazy PLT resolution is made thread-safe by the loader: if two threads make the first call to the same function simultaneously, the resolver serializes so the GOT slot is patched exactly once and both calls reach the real function. So you generally don't worry about it. The thing to think about is *latency determinism*, not correctness: that first call carries a one-time resolution spike, which on a hot, latency-sensitive path can show up as a tail-latency outlier indistinguishable from a GC pause or a cache miss. If you need predictability, force eager binding (`-z now`) so all resolution happens at startup. (Custom or older loaders, and some `dlopen` patterns, can have weaker guarantees — don't assume the glibc behavior universally.)

## Question 26

**You statically linked everything to avoid "missing .so" problems. Two months later there's a critical `libssl` CVE. What's the consequence?**

You opted out of fleet-wide patching. With dynamic linking, the fix is a single `libssl.so` package update and a restart — every program picks it up. Statically linked, the vulnerable `libssl` code is *baked into every binary*, so you must **rebuild and redeploy every affected binary** — and you must *know* which binaries embedded the vulnerable version, which requires a software bill of materials. This is the central argument against static-linking security-critical libraries by default. If you static-link them anyway (for cold-start reasons), you must own the rebuild pipeline and SBOM tracking explicitly.

---

## Design

## Question 27

**Design a C/C++ plugin system that loads plugins at runtime. What's the loading mechanism, the interface contract, and the isolation strategy?**

Use `dlopen`/`dlsym`/`dlclose` (Windows: `LoadLibraryEx`/`GetProcAddress`/`FreeLibrary`). The interface contract must be **C linkage, POD-only**: expose a single `extern "C"` entry point the host looks up by a known name, returning a versioned struct of function pointers (a vtable) — never a C++ class, never exceptions or `std::string` across the boundary, because name mangling and standard-library ABI differences make C++ plugin interfaces fragile across compilers/versions. Include an explicit ABI version field so the host can reject incompatible plugins. Isolation: `dlopen` with `RTLD_LOCAL` (the default) so a plugin's symbols don't pollute the global scope or collide with other plugins, build plugins with `-fvisibility=hidden` exporting only the entry point, and load each by fully-qualified path (Windows: restricted search dirs) to avoid planting. Treat `dlclose` as best-effort and never call into a plugin after unload; manage plugin lifetime with explicit init/shutdown calls in the vtable.

## Question 28

**A service has a 400ms cold start; profiling shows much of it before `main`. How do you attack it?**

First quantify the loader's share: `LD_DEBUG=statistics` reports loader time, relocation count, and time-in-relocation. If the loader dominates, the levers are: reduce the *number* of shared libraries (each costs open/map/relocate/init) by trimming transitive dependencies or merging; reduce *symbols* (smaller export surfaces, `-fvisibility=hidden`); choose lazy binding so unused symbols cost nothing at startup (accepting first-call spikes); and, the big hammer, **static-link or AOT-compile** to delete most loader work — decisive for serverless where every cold invocation pays it. For a JVM service, much of "before main" is class loading/verification and JIT warmup; AOT (GraalVM native-image), class-data sharing (CDS/AppCDS), and tiered-compilation tuning are the analogues. Always measure before and after; "use static linking" without numbers is a guess.

## Question 29

**You ship a shared library used by many third-party binaries. How do you evolve it for years without breaking them?**

Treat the exported symbol set as a published ABI. Control exports with a linker **version script** (export only the intended API; hide everything else with `-fvisibility=hidden`). For compatible changes — *adding* functions — add new versioned symbols and keep old ones working; the soname stays the same. For any *incompatible* change — removing or changing a symbol's signature/semantics, reordering or resizing a public struct, changing a calling convention — **bump the soname** (`.so.N` → `.so.N+1`) so old binaries continue to resolve the old library installed side-by-side. Use symbol versioning to keep both an old and a new behavior of the same name in one library when needed. Run an ABI checker (`abidiff`/libabigail) in CI to catch *silent* breaks the compiler won't. Document the ABI floor and never overwrite an in-use soname's file with incompatible content — that's how you cause dependency hell.

## Question 30

**Design the defense against DLL planting for a Windows desktop application that loads optional plugins.**

The attack is the loader finding an attacker's DLL before the legitimate one via the search order (CWD/app dir early). Defenses, layered: (1) call `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_APPLICATION_DIR)` early to remove the dangerous directories from the default search; (2) load every dependency and plugin by **fully-qualified path** (`LoadLibraryEx` with `LOAD_WITH_ALTERED_SEARCH_PATH` or `LOAD_LIBRARY_SEARCH_*` flags), never by bare name; (3) install the app and its DLLs into a directory normal users can't write (`Program Files`), so an attacker can't drop a DLL beside the binary; (4) **Authenticode-sign** binaries and, for plugins, verify the signature before loading; (5) avoid running from world-writable locations (an installer launched from `Downloads` shouldn't load DLLs by relative name); (6) audit what the app loads by bare name with a dependency tool. The same principle on Linux is avoiding writable/attacker-controllable `RPATH`/`$ORIGIN` directories and not honoring `LD_LIBRARY_PATH` for privileged processes.

## Question 31

**You're choosing the linking strategy for (a) a widely-distributed CLI tool, (b) a fleet of long-lived microservices, and (c) AWS Lambda functions. Justify each.**

(a) **CLI tool → static (or Go/Rust-static).** It's launched constantly, must run on unknown machines without "missing .so" failures, and benefits from one self-contained file; cold-start and deployment simplicity dominate, and it rarely needs the shared-RAM benefit. (b) **Long-lived microservices → dynamic.** They run for hours/days, often many instances of related services share big libraries (so RAM sharing matters), and fleet-wide security patching of `libssl`/`libcrypto` via a single package update is a major operational win; the one-time startup cost amortizes to nothing over a long lifetime. (c) **Lambda → static / AOT.** Cold starts happen on every scale-up and pay loader (and, for JVM, class-load + JIT-warmup) cost on the critical user-facing path; static/AOT (or GraalVM native-image, provisioned concurrency, SnapStart) minimizes that. The unifying principle: **lifetime and launch frequency decide it** — short-lived/frequent favors static/AOT (startup cost matters), long-lived/shared favors dynamic (sharing and patching matter).
