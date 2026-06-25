# Dynamic Linking & Loading — Senior Level

> **Topic:** [Dynamic Linking & Loading](README.md)
> **Focus:** Symbol resolution rules, interposition and `LD_PRELOAD`, symbol versioning, the diamond/duplicate-symbol problem, and `dlopen`/`dlsym` for runtime plugins — the parts that decide *which* definition of a symbol actually wins.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

> Focus: **When several loaded objects all define a symbol named `malloc`, which one does a given call reach — and how do you deliberately control that?**

The middle level explained the *mechanism* (PLT/GOT) by which a call reaches a resolved address. This level is about the *policy*: how the loader decides which definition a name resolves to when more than one is available, and how engineers exploit and fight that policy in practice.

This is where dynamic linking stops being plumbing and becomes a design surface. **Interposition** — making the loader pick *your* `malloc` over libc's — powers allocator replacement (jemalloc, tcmalloc), sanitizers, leak detectors, mocking, and a whole genre of profiling tools. **Symbol versioning** is how glibc ships `memcpy@GLIBC_2.2.5` and `memcpy@GLIBC_2.14` in the same library so old binaries keep working. The **diamond / duplicate-symbol problem** is why two plugins that each statically link the same library can corrupt each other's global state. And `dlopen`/`dlsym` is how every plugin system on the planet loads code that wasn't known at build time.

> 🎓 **Why this matters at the senior level:** The bugs here are the nastiest in native software because they are *non-local*: the symptom (a crash in library C) has its cause in *the interaction between* the load order of A and B, an `RTLD_GLOBAL` flag, or a versioned-symbol mismatch on a different machine. Engineers who understand resolution policy debug these in minutes; everyone else debugs them for days.

This page covers: the loader's symbol search order and the global-scope rule; interposition via `LD_PRELOAD` and the `malloc` hook pattern; `RTLD_LOCAL` vs `RTLD_GLOBAL` and macOS two-level namespaces; symbol versioning and ABI compatibility; the diamond/duplicate-symbol problem; and `dlopen`/`dlsym`/`dlclose` plugin mechanics with constructors/destructors.

---

## Prerequisites

- **Required:** Middle level — GOT/PLT, lazy vs eager binding, the dynamic section.
- **Required:** Comfort with C, pointers, function pointers, and building `.so` files with `gcc -shared -fPIC`.
- **Required:** A working model of "a process has multiple loaded objects (the executable + several `.so`s), each with its own symbol table."
- **Helpful:** Some exposure to a plugin architecture, or to running software under a sanitizer/allocator-replacement tool.

You do **not** yet need: ABI-stability strategy at organizational scale, JVM class loaders, Windows IAT/delay-load internals, or large-scale startup-cost engineering — those are `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Symbol scope** | The set of objects the loader searches to resolve a given reference, and the order it searches them. |
| **Global scope (default lookup scope)** | The ordered set of objects (executable first, then dependencies in load order) searched for normal symbol references. |
| **Interposition** | Inserting a definition of a symbol *earlier* in the search order so it overrides the "real" one. |
| **`LD_PRELOAD`** | An env var listing `.so`s to load *first*, before all dependencies — the canonical interposition lever on Linux. |
| **`RTLD_GLOBAL`** | A `dlopen` flag: the library's symbols join the global scope and become available to interpose/resolve later loads. |
| **`RTLD_LOCAL`** | A `dlopen` flag (default): the library's symbols are *not* added to the global scope; only it and its own deps see them. |
| **`RTLD_NOW` / `RTLD_LAZY`** | `dlopen` flags choosing eager vs lazy binding for the opened library. |
| **Symbol versioning** | Tagging symbols with a version (`memcpy@GLIBC_2.14`) so one library can ship multiple ABI-incompatible versions of a name. |
| **Default version** | The version (`@@`) a symbol resolves to when a binary asks for the name without a version. |
| **Two-level namespace** | macOS scheme where each imported symbol records *which library* it comes from, so the same name in two libraries doesn't collide. |
| **Flat namespace** | The Linux-style scheme (and a macOS opt-in) where a name resolves by global search regardless of which library "owns" it. |
| **`dlopen` / `dlsym` / `dlclose`** | Runtime API to load a library, look up a symbol by name, and unload it — the basis of plugins. |
| **Diamond problem** | A and B both depend on C; if C is duplicated (e.g. statically linked into both), there are two copies of C's state. |
| **`-Bsymbolic`** | A link flag making a library prefer its *own* definitions for internal references, resisting interposition. |
| **`RTLD_NEXT`** | A `dlsym` pseudo-handle meaning "the *next* definition after me in the search order" — how a wrapper calls the real function. |

---

## Core Concepts

### 1. The Search Order Decides Who Wins

When the loader resolves a normal symbol reference, it searches loaded objects in a defined order and **takes the first definition it finds**. On Linux (ELF, flat namespace) that order is, roughly:

1. **Preloaded objects** (`LD_PRELOAD`), in listed order.
2. **The executable itself.**
3. **The needed libraries**, in breadth-first load order (the order they appear via `DT_NEEDED`, then their dependencies).

"First match wins" is the whole game. Two libraries both define `log`? Whoever is earlier in this order is the `log` everyone gets. This is *not* a link error on Linux — it's silent interposition, and it's the root of a category of surprising bugs.

### 2. Interposition: Deliberately Winning the Search

Because "first match wins," you can *insert* a definition earlier and override the real one. The canonical tool is `LD_PRELOAD`: a `.so` listed there is searched *before everything*, so its symbols win.

The most famous use is replacing `malloc`/`free`. jemalloc and tcmalloc ship as `.so`s you `LD_PRELOAD`; every `malloc` call in the program — including inside libc and third-party libraries — routes to the replacement, with no recompilation. Sanitizers (ASan), leak detectors, and allocation profilers all use the same lever.

A wrapper that *augments* rather than replaces uses `RTLD_NEXT` to reach the original:

```c
// malloc_count.so — counts allocations, then delegates to the real malloc
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>

static unsigned long count = 0;

void *malloc(size_t n) {
    static void *(*real_malloc)(size_t) = NULL;
    if (!real_malloc)                      // resolve the REAL malloc, after us
        real_malloc = dlsym(RTLD_NEXT, "malloc");
    __sync_fetch_and_add(&count, 1);
    return real_malloc(n);
}
```

`dlsym(RTLD_NEXT, "malloc")` means "find `malloc` *after me* in the search order" — i.e. the genuine libc one. This is the standard interposition idiom.

### 3. `RTLD_LOCAL` vs `RTLD_GLOBAL`: Who Can See a Plugin's Symbols

When you `dlopen` a plugin, its symbols default to **`RTLD_LOCAL`**: visible to the plugin and its own dependencies, but *not* added to the process-wide global scope. A *later*-loaded plugin therefore cannot accidentally resolve against the *earlier* plugin's symbols.

`RTLD_GLOBAL` does the opposite: it merges the plugin's symbols into the global scope, where they become visible to — and can interpose on — subsequently loaded objects. This is occasionally necessary (one plugin must expose symbols another plugin needs) but is a frequent source of cross-plugin contamination: two plugins each exporting a `init` or a `version` symbol globally will collide, and the first-loaded wins for everyone.

**Default to `RTLD_LOCAL` for plugins.** Reach for `RTLD_GLOBAL` only with a specific cross-plugin contract in mind, and keep exported surfaces tiny (`-fvisibility=hidden`).

### 4. macOS Two-Level Namespaces: A Different Default

macOS `dyld` (by default) uses a **two-level namespace**: each undefined symbol an object imports records *which library* it expects to find it in (`libSystem`'s `malloc`, specifically). Resolution isn't a flat global search; it's "get `malloc` *from libSystem*." Consequences:

- The same symbol name in two libraries does **not** collide — each importer is bound to a specific provider.
- `LD_PRELOAD`-style interposition doesn't work the same way; macOS uses `DYLD_INSERT_LIBRARIES` plus an interpose table (`__interpose` section) for explicit interposition.
- You can opt into a **flat namespace** (`-flat_namespace` / `DYLD_FORCE_FLAT_NAMESPACE`) to get Linux-like behavior, but it reintroduces collisions.

This is a major portability gotcha: code that relies on flat-namespace interposition on Linux behaves differently on macOS, and vice versa.

### 5. Symbol Versioning and ABI Compatibility

glibc must ship a `memcpy` that behaves the new way for new binaries and the old way for binaries compiled years ago — in *one* `libc.so.6`. It does this with **symbol versioning**: the library defines `memcpy@GLIBC_2.2.5` (old) and `memcpy@@GLIBC_2.14` (new default, note `@@`). A binary compiled today records that it wants `memcpy@GLIBC_2.14`; an old binary recorded `memcpy@GLIBC_2.2.5`. The loader binds each to the version it asked for. Same name, two behaviors, ABI preserved.

This is also the mechanism behind the infamous `version 'GLIBC_2.34' not found` error: you built against a newer glibc and tried to run on an older one that simply doesn't *have* that version of the symbol. The fix is to build against the *oldest* glibc you must support (or static-link, or use `musl`).

`readelf --dyn-syms ./bin` shows the versions a binary requires; `readelf -V` shows version definitions and needs.

### 6. The Diamond / Duplicate-Symbol Problem

A depends on C, B depends on C, your program depends on A and B. With *shared* C, there's **one** copy of C — one set of its globals, one allocator arena, one logging singleton. Good.

But if A and B each *statically* link C (or `dlopen` private copies), there are now **two** copies of C's code and, critically, **two copies of its global state**. Objects allocated by A's copy and freed by B's copy corrupt the heap; a "singleton" exists twice; a registry initialized in one copy is empty in the other. This is the duplicate-symbol / diamond problem, and it's why mixing static and dynamic copies of the same library is dangerous.

On Linux's flat namespace, if both copies export the symbols *globally*, interposition may accidentally "merge" them (first wins) — sometimes masking the bug, sometimes creating a worse one. The disciplined fixes: link C *once* as a shared library that both A and B use; or hide C's symbols (`-fvisibility=hidden`, version scripts) so the two copies can't see each other; or, for plugins, `RTLD_LOCAL` so each keeps its own.

### 7. `dlopen`/`dlsym`/`dlclose`: Runtime Plugins

`dlopen` loads a library *while the program runs*; `dlsym` looks up a symbol by name and returns a pointer you cast and call; `dlclose` unloads. This is how editors load language servers, how databases load extensions, how media players load codecs. The plugin's constructors (`DT_INIT_ARRAY`) run during `dlopen`; its destructors run during the matching `dlclose` (or at exit).

The portable contract is a small, C-linkage **entry point** the host looks up by a known name, returning a vtable of function pointers — never relying on the C++ ABI across the boundary (name mangling and ABI differences make C++ plugin interfaces fragile).

---

## Real-World Analogies

**The org chart that resolves "who do I ask?"** A symbol reference is "I need someone who does `malloc`." Resolution walks an org chart in a fixed order and stops at the first person with that job title. `LD_PRELOAD` is hiring a contractor and seating them at the *front* of the line, so every "who does malloc?" question reaches the contractor first. `RTLD_NEXT` is the contractor saying "let me forward this to the next person who also has that title" — the real malloc.

**Two branch offices, two ledgers (the diamond problem).** Headquarters (C) should keep one ledger. If two departments (A and B) each photocopy the *code* of accounting and keep *their own* ledger, money "deposited" via A and "withdrawn" via B never reconciles — the books are corrupt. One shared accounting department (shared library) keeps one ledger.

**Versioned recipes in one cookbook.** glibc is a cookbook with both "Grandma's gravy (1998 edition)" and "gravy (2014 edition)" printed under the heading "gravy." Old chefs follow the 1998 page they were trained on; new chefs follow 2014. Same dish name, both behaviors preserved — that's symbol versioning.

---

## Mental Models

**Model 1: Resolution is "first match in a fixed walk."** Everything — interposition, the diamond problem, `LD_PRELOAD`, `RTLD_GLOBAL` collisions — falls out of "the loader walks a defined order and takes the first definition." Master the order and you predict the outcome.

**Model 2: `LD_PRELOAD` / interposition = jumping the queue.** You don't change anyone's code; you change *who's first in line* for a name. Powerful, invisible, and exactly why it's both a great tool and a security concern (an attacker who controls `LD_PRELOAD` controls every libc call).

**Model 3: Symbol visibility is an API boundary.** Every *exported* symbol is part of your library's interface, interposable and collidable. `-fvisibility=hidden` + an explicit export list is how you say "this is my API; everything else is private," shrinking the resolution surface and the bug surface.

---

## Code Examples

### Interpose `malloc` with `LD_PRELOAD` (count allocations system-wide)

```text
$ gcc -shared -fPIC -D_GNU_SOURCE malloc_count.c -o malloc_count.so -ldl
$ LD_PRELOAD=./malloc_count.so ls            # ls's mallocs now route through ours
# (the wrapper counts and forwards via dlsym(RTLD_NEXT, "malloc"))
```

No recompilation of `ls`; every `malloc` in the process — libc's own included — passes through your code. This is the entire basis of allocator replacement and many profilers.

### A plugin host with `dlopen`/`dlsym`

```c
// plugin API (shared header): host and plugins agree on this
typedef struct { const char *name; int (*run)(int); } Plugin;

// plugin.c
#include "plugin_api.h"
static int run(int x){ return x * 2; }
// Exported entry point the host looks up by name:
Plugin *plugin_entry(void) {
    static Plugin p = { .name = "doubler", .run = run };
    return &p;
}
```

```c
// host.c
#include <dlfcn.h>
#include <stdio.h>
#include "plugin_api.h"
int main(int argc, char **argv) {
    void *h = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);   // local: no global pollution
    if (!h) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 1; }

    Plugin *(*entry)(void) = (Plugin *(*)(void)) dlsym(h, "plugin_entry");
    char *err = dlerror();                                // ALWAYS check via dlerror, not NULL
    if (err) { fprintf(stderr, "dlsym: %s\n", err); return 1; }

    Plugin *p = entry();
    printf("plugin '%s': run(21) = %d\n", p->name, p->run(21));
    dlclose(h);                                          // runs the plugin's destructors
    return 0;
}
```

```text
$ gcc -shared -fPIC plugin.c -o doubler.so
$ gcc host.c -o host -ldl && ./host ./doubler.so
plugin 'doubler': run(21) = 42
```

Note: check `dlsym` errors via `dlerror()`, not a NULL return — a symbol can legitimately resolve to address `NULL`. Default to `RTLD_LOCAL`.

### Observe symbol versions and a version mismatch

```text
$ readelf --dyn-syms /bin/ls | grep -i memcpy
   ... FUNC GLOBAL DEFAULT UND memcpy@GLIBC_2.14 (2)

# The dreaded mismatch when running a new binary on an old system:
$ ./app
./app: /lib/.../libc.so.6: version `GLIBC_2.34' not found (required by ./app)
# -> built against a newer glibc than the target has. Build against the oldest
#    supported glibc, or static-link, or use musl.
```

### Resist interposition for a library's internal calls

```text
# Make libfoo prefer its OWN definitions for internal references,
# so an LD_PRELOAD can't accidentally hijack libfoo's internal helpers:
$ gcc -shared -fPIC -Wl,-Bsymbolic foo.c -o libfoo.so
```

`-Bsymbolic` binds intra-library references to the library's own symbols at link time. Use with care: it *also* prevents legitimate interposition of those symbols.

---

## Pros & Cons

| Mechanism | Pros | Cons |
|-----------|------|------|
| **`LD_PRELOAD` interposition** | Replace/augment any symbol with no recompilation; basis of allocators, sanitizers, profilers, shims. | Process-wide and invisible; a security risk if attacker-controlled; behaves differently on macOS. |
| **`RTLD_GLOBAL`** | Lets cooperating plugins share symbols. | Cross-plugin collisions; "first loaded wins"; hard-to-debug non-local failures. |
| **`RTLD_LOCAL` (default)** | Isolation between plugins; predictable. | Cooperating plugins must export via explicit handles, not ambient global symbols. |
| **Symbol versioning** | Ship multiple ABIs in one library; preserve old binaries forever. | Complex; `version not found` errors; requires version scripts to do well. |
| **Two-level namespace (macOS)** | No accidental name collisions; each import bound to its provider. | Breaks Linux-style flat interposition; portability surprises. |
| **`dlopen` plugins** | Load code unknown at build time; extensibility. | Lifetime/unload bugs; C++ ABI fragility; classloader-style leaks (see professional). |

---

## Use Cases

- **Allocator replacement / memory profiling:** `LD_PRELOAD` jemalloc/tcmalloc, or a counting/leak-tracking shim, across an unmodified binary.
- **Sanitizers and fault injection:** interpose `malloc`/`open`/`connect` to inject failures or record behavior in tests.
- **Plugin architectures:** `dlopen` codecs, database extensions, language servers, game mods — anything loaded after build.
- **ABI longevity:** symbol versioning so a 2015 binary still runs on 2025's libc, and so your own shared library can evolve without breaking callers.
- **Diagnosing "wrong function got called":** when two libraries define the same name, knowing the search order tells you instantly which one wins.

---

## Coding Patterns

### Pattern 1: Wrapper-with-`RTLD_NEXT` for augmentation

To *observe or modify* a function without replacing it, define your version, resolve the real one via `dlsym(RTLD_NEXT, name)`, and forward. This is the standard, safe interposition shape (cache the resolved pointer in a `static`).

### Pattern 2: C-linkage vtable entry point for plugins

Expose one `extern "C"` function returning a struct of function pointers (and a version field). Never expose a C++ class across the `dlopen` boundary. This isolates the host from the plugin's compiler/ABI and is the only portable contract.

### Pattern 3: `RTLD_LOCAL` + hidden visibility for plugin isolation

`dlopen(..., RTLD_LOCAL)` plus building plugins with `-fvisibility=hidden` and exporting only the entry point keeps each plugin's symbols from colliding with the host's or with other plugins'. Make global visibility a deliberate, documented exception.

### Pattern 4: Build against the oldest supported runtime

To avoid `version not found`, build on (or target via toolchain) the oldest glibc / oldest macOS deployment target you must support. ABI floors are a property of *where you build*, not where you run.

---

## Best Practices

1. **Default plugins to `RTLD_LOCAL`; reach for `RTLD_GLOBAL` only with a contract.** Treat global scope as shared mutable state.
2. **Shrink your exported symbol surface** with `-fvisibility=hidden` and explicit version scripts. Every export is interposable and collidable.
3. **Check `dlsym` via `dlerror()`, not NULL.** And `dlerror()` is one-shot — call it immediately after the `dl*` call.
4. **Never share one C library as two copies.** Link it once as a `.so`; don't statically embed the same library into multiple components that interact.
5. **Treat `LD_PRELOAD` as a privileged input.** Strip it for setuid/privileged processes (the loader does, for security); never trust attacker-controllable preload paths.
6. **Document and test your ABI floor.** Know the minimum glibc/macOS/Windows runtime you support and CI against it.
7. **Cross the plugin boundary in C, with a versioned vtable.** Spare yourself C++ name-mangling and ABI breakage.

---

## Edge Cases & Pitfalls

**Pitfall: silent interposition on Linux.** Two libraries defining `read_config` is *not* an error on Linux — first in search order silently wins, and the loser's callers may end up in the winner's function with mismatched expectations. macOS's two-level namespace would have caught this. Hide internal symbols to avoid it.

**Pitfall: `dlclose` doesn't always unload.** If anything still references the library (another `dlopen` with the same path, a `RTLD_NODELETE` flag, an in-flight callback, a thread running its code), `dlclose` decrements a refcount but does *not* unmap. Calling into a function pointer from a "closed" library that's actually been unloaded is a use-after-unload crash; calling one you *thought* was unloaded but wasn't can leak. Treat unload as best-effort and never call into a plugin after closing it.

**Pitfall: destructor ordering at exit.** `DT_FINI_ARRAY` destructors run in reverse load order, but if a destructor in library A touches state owned by library B that's already been finalized, you crash *during shutdown*. Keep destructors minimal and self-contained; don't reach across libraries on the way down.

**Pitfall: `RTLD_GLOBAL` + duplicate symbol = action at a distance.** Loading plugin B globally can interpose a symbol that plugin A was already using, silently changing A's behavior mid-run. The crash appears in A; the cause is B's load. Local scope prevents this.

**Pitfall: versioned-symbol "downgrade."** A binary that records `memcpy@GLIBC_2.14` will *refuse* to bind to an older libc lacking that version — even if the older `memcpy` would work fine. The version request is a hard floor, not a preference.

**Pitfall: C++ across `dlopen`.** Throwing an exception across a `dlopen` boundary, passing `std::string` between objects built with different standard-library versions, or relying on RTTI across the boundary are all ways to get crashes that depend on compiler flags. Keep the boundary C and POD.

**Pitfall: `LD_PRELOAD` and static linking don't mix.** Interposition works because calls go through the dynamic symbol resolution machinery. A statically linked binary has already resolved its `malloc` internally — `LD_PRELOAD` can't touch it. This is why you can't easily ASan/profile a fully static binary via preload.

---

## Cheat Sheet

```text
SEARCH ORDER (Linux, flat namespace) — first match wins:
  1. LD_PRELOAD objects   2. the executable   3. needed libs (load order, BFS)

INTERPOSITION
  LD_PRELOAD=./shim.so prog        # shim's symbols win, no recompile
  dlsym(RTLD_NEXT, "malloc")       # inside a wrapper: reach the REAL one
  macOS: DYLD_INSERT_LIBRARIES + __interpose (two-level namespace differs!)

dlopen FLAGS
  RTLD_LOCAL  (default)  symbols NOT in global scope     <- default for plugins
  RTLD_GLOBAL            symbols join global scope (collisions!)
  RTLD_NOW              resolve all now    RTLD_LAZY  resolve on first call
  RTLD_NODELETE        never unload on dlclose

PLUGIN API
  void *h = dlopen(path, RTLD_NOW|RTLD_LOCAL);
  fn = dlsym(h, "entry"); if (dlerror()) ...;   // check dlerror(), not NULL
  ... call ...; dlclose(h);                      // runs DT_FINI_ARRAY (best-effort)
  Boundary = extern "C" vtable of fn pointers + version. NEVER C++ ABI.

SYMBOL VERSIONING
  memcpy@GLIBC_2.2.5 (old)   memcpy@@GLIBC_2.14 (default)   in ONE libc.so.6
  "version `GLIBC_2.34' not found" -> built newer than target; build on oldest

DIAMOND / DUPLICATE SYMBOL
  A->C, B->C : share ONE C (one state). Two static copies of C = two states = corruption.
  defenses: link C once as .so; -fvisibility=hidden; version scripts; RTLD_LOCAL

HARDEN A LIBRARY'S OWN CALLS
  -Wl,-Bsymbolic        prefer own defs (resists interposition)
  -fvisibility=hidden   export only your API
```

---

## Summary

- Symbol resolution is **"first match in a fixed search order."** On Linux that order is preloads → executable → needed libs (load order). Master the order and every interposition/collision outcome becomes predictable.
- **Interposition** exploits the order: `LD_PRELOAD` puts your `.so` first, so your `malloc` (or any symbol) wins with no recompilation — the basis of allocator replacement, sanitizers, and profilers. A wrapper reaches the original via `dlsym(RTLD_NEXT, name)`.
- **`RTLD_LOCAL`** (the default) isolates a `dlopen`ed plugin's symbols; **`RTLD_GLOBAL`** merges them into global scope, enabling cooperation but inviting cross-plugin collisions. Default to local.
- **macOS two-level namespaces** bind each import to a specific provider, preventing the silent name collisions Linux's flat namespace allows — and breaking flat-style interposition. A real portability difference.
- **Symbol versioning** lets one library ship multiple ABIs of a name (`memcpy@GLIBC_2.2.5` vs `@@GLIBC_2.14`), preserving old binaries; mismatches surface as `version not found` when you build newer than the target runtime.
- The **diamond / duplicate-symbol problem**: sharing one copy of a library means one set of globals; two static copies means two — and heap/state corruption when they interact. Link shared libraries once; hide internal symbols.
- **`dlopen`/`dlsym`/`dlclose`** load plugins at runtime; cross the boundary with a C-linkage vtable, check `dlsym` via `dlerror()`, default to `RTLD_LOCAL`, and treat `dlclose` as best-effort.

Next: `professional.md` scales this up — ABI-stability strategy, startup cost at fleet scale (why many `.so`s = slow start, prelink history, why static/AOT wins cold starts), Windows DLL search/hijacking and delay-loading, and JVM class loading + classloader leaks.
