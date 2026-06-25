# Dynamic Linking & Loading — Middle Level

> **Topic:** [Dynamic Linking & Loading](README.md)
> **Focus:** How a call to `printf` actually finds `printf` at run time — the GOT, the PLT, lazy vs eager binding, and the ELF dynamic section that drives it all.

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

> Focus: **When your code calls a function in another shared library, what machine-level mechanism turns that call into the right address — and why is the first call slow but every call after it fast?**

At the junior level, "the loader resolves symbols" was a black box: the loader finds `printf` and "wires up the call." Now we open the box. The wiring is two small tables that the linker plants in every dynamically linked binary:

- The **GOT (Global Offset Table)** — an array of *pointers*. After resolution, the slot for `printf` holds `printf`'s real run-time address.
- The **PLT (Procedure Linkage Table)** — a tiny array of *stubs* (a few instructions each). Your code never calls `printf` directly; it calls the PLT stub for `printf`, which jumps through the GOT.

The clever part is **lazy binding**: the first time you call `printf`, its GOT slot doesn't yet hold the answer. The PLT stub instead routes the call into the dynamic loader, which resolves `printf`, *patches the GOT slot with the answer*, and tail-jumps into `printf`. Every subsequent call sails straight through the now-correct GOT slot with no loader involvement. You pay the resolution cost once, only for symbols you actually use, and only when you first use them.

> 🎓 **Why this matters at the middle level:** This is the layer where "thread-safety of the loader," "why is my cold start slow," "what does `-z now` do," and "how does `LD_PRELOAD` hijack `malloc`" all suddenly make sense. The GOT/PLT model is the single most leverage-dense idea in dynamic linking — once you can draw it, half of the senior-level material is obvious.

This page covers: the GOT and PLT in detail; the exact first-call resolution dance and the GOT patch; lazy (`DT_BIND_NOW` off) vs eager/now (`-z now`) binding and their trade-offs; the ELF **dynamic section** (`DT_NEEDED`, `DT_RELA`, `DT_JMPREL`, …) that the loader reads; and a recap of position-independent code and why the GOT exists in the first place.

---

## Prerequisites

- **Required:** Junior level of this topic — static vs dynamic linking, what the loader does, `ldd`/`nm`.
- **Required:** Comfort reading a little x86-64 assembly (a `call`, a `jmp`, an indirect jump `jmp *(%rax)`).
- **Required:** Understanding that virtual memory gives each process its own address space, and that code/data live at virtual addresses.
- **Helpful:** Having compiled a `.so` with `-fPIC` and run `objdump -d` on something.
- **Helpful:** Awareness of relocations as "fix-ups the linker/loader applies to patch addresses."

You do **not** yet need: symbol versioning, interposition rules, `dlopen` internals, JVM class loaders, or ABI policy — those are `senior.md` / `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **GOT (Global Offset Table)** | A writable table of pointers, one slot per imported symbol (and per global referenced position-independently). After resolution the slot holds the symbol's real address. |
| **PLT (Procedure Linkage Table)** | A read-only table of small code stubs, one per imported function. Calls go *through* the PLT, which jumps via the GOT. |
| **`.got` / `.got.plt`** | ELF sections holding GOT entries. `.got.plt` holds the entries the PLT uses (function pointers); `.got` often holds data-symbol pointers. |
| **`.plt`** | The ELF section holding PLT stubs. |
| **Lazy binding** | Resolving each function's address on its *first call*, not at load time. The default for functions on most Linux systems. |
| **Eager / now binding** | Resolving *all* symbols at load time, before `main`. Enabled by `-z now` / `LD_BIND_NOW=1` / `DT_BIND_NOW`. |
| **Relocation** | An instruction to the linker/loader: "patch the address at location X to point at symbol Y (plus an offset)." |
| **`R_X86_64_JUMP_SLOT`** | The relocation type for a PLT/GOT function slot — the kind resolved lazily. |
| **`R_X86_64_GLOB_DAT`** | The relocation type for a GOT *data* slot — resolved at load time. |
| **Dynamic section** | The ELF `.dynamic` section: a list of tagged entries (`DT_*`) the loader reads to know what to do. |
| **`DT_NEEDED`** | A dynamic-section entry naming a required library (the "shopping list"). |
| **`DT_JMPREL` / `DT_PLTRELSZ`** | Where the PLT relocations live and how big they are. |
| **`_dl_runtime_resolve`** | The glibc loader routine the PLT trampolines into on a first call. |
| **PIC (Position-Independent Code)** | Code that works at any load address by addressing data/calls *relative to itself* (RIP-relative) and going through the GOT for absolute addresses. |
| **`DT_BIND_NOW` / `DF_BIND_NOW`** | Dynamic flags requesting eager binding. |

---

## Core Concepts

### 1. Why the GOT Exists: PIC Needs Indirection

A shared library can be loaded at a *different address* in every process (and at a random address every run, thanks to ASLR). So its code cannot contain hard-coded absolute addresses for external functions and globals — those addresses aren't known until load time and differ per process.

The solution is **one layer of indirection**: instead of "jump to the absolute address of `printf`," position-independent code does "load the pointer from *my* GOT slot for `printf`, then jump there." The *code* (in the read-only, shareable `.text`) stays identical in every process. Only the *GOT* (a small, writable, per-process table) gets patched with the addresses that vary. This is the central trick that makes code sharing and ASLR both possible.

So: **the GOT is the one writable place where per-process, resolved-at-load-time addresses live.** The code is constant; the GOT is the variable part.

### 2. The PLT: A Stub Per Function

For *function* calls there's a second table, the PLT, because of lazy binding. Each imported function gets:

- A **PLT stub** (in `.plt`, read-only, shared): a few instructions.
- A **GOT slot** (in `.got.plt`, writable, per-process): a pointer.

Your code calls `printf@plt` (the stub), not `printf` directly. The stub's job is: "jump to wherever my GOT slot points." Initially that slot points *back into the PLT* at the resolver trampoline — so the first call detours into the loader. After resolution the slot points at real `printf`, and the same stub now jumps straight there.

A classic PLT stub (x86-64, simplified):

```asm
printf@plt:
    jmp   *printf@got(%rip)     ; jump to whatever the GOT slot holds
    ; --- first time, the GOT slot points HERE, at the lazy trampoline: ---
    push  $relocation_index     ; which symbol? push its index
    jmp   PLT0                  ; jump to the common resolver trampoline

PLT0:                           ; the shared "go ask the loader" stub
    push  GOT[1]                ; loader's bookkeeping (link_map)
    jmp   *GOT[2]               ; jump to _dl_runtime_resolve
```

### 3. The First-Call Resolution Dance

Walk through the *first* call to `printf` with lazy binding on:

1. Your code executes `call printf@plt`.
2. The PLT stub does `jmp *printf@got`. But the GOT slot still holds its *initial* value — the address of the `push $index; jmp PLT0` sequence right below.
3. So control falls to `push $relocation_index; jmp PLT0`.
4. `PLT0` pushes the loader's bookkeeping pointer and jumps to `_dl_runtime_resolve`.
5. `_dl_runtime_resolve` looks up symbol number `index` (`printf`), searches the loaded libraries for its definition, and finds its real address.
6. **It writes that real address into `printf`'s GOT slot** — the patch.
7. It then jumps directly to `printf` (so this first call still completes normally).

Now the *second* call to `printf`:

1. `call printf@plt`.
2. `jmp *printf@got` — and the GOT slot now holds the real address of `printf`.
3. Straight to `printf`. No loader, no resolution. Just one indirect jump.

That's the whole magic. **First call: detour through the loader, patch the GOT. Every later call: one indirect jump.**

### 4. Lazy vs Eager (Now) Binding

**Lazy binding (default for functions):**

- *Pro:* You only resolve symbols you actually call. A program that imports 2,000 functions but uses 50 pays for 50. Startup is faster.
- *Con:* The first call to each function carries a one-time latency spike. Bad for latency-sensitive paths and for predictability.
- *Con (security):* The GOT is writable for the program's lifetime, so an attacker who can overwrite a GOT slot can hijack a call ("GOT overwrite"). This is the classic motivation for **RELRO**.

**Eager / now binding (`-z now`, `LD_BIND_NOW=1`):**

- The loader resolves *everything* at load time, before `main`.
- *Pro:* No first-call spikes; fully deterministic latency. Combined with **full RELRO** (`-z now -z relro`), the GOT can be made *read-only* after relocation, defeating GOT-overwrite attacks.
- *Con:* Slower startup if you import a lot and use a little — you pay to resolve symbols you may never call.

The rule of thumb: **lazy for fast startup, eager+RELRO for security and latency determinism.** Security-hardened distros increasingly default to full RELRO.

### 5. The ELF Dynamic Section: the Loader's Instruction Sheet

How does the loader know which libraries to load, where the relocations are, where the GOT is? It reads the **`.dynamic`** section — an array of `(tag, value)` entries. Key tags:

| Tag | Meaning |
|-----|---------|
| `DT_NEEDED` | Name of a required library. One per dependency. |
| `DT_SONAME` | This library's own soname. |
| `DT_RPATH` / `DT_RUNPATH` | Extra search paths baked in. |
| `DT_JMPREL` / `DT_PLTRELSZ` / `DT_PLTREL` | The PLT relocations (the `JUMP_SLOT`s). |
| `DT_RELA` / `DT_RELASZ` | The non-PLT relocations (data, `GLOB_DAT`). |
| `DT_SYMTAB` / `DT_STRTAB` | The dynamic symbol and string tables. |
| `DT_HASH` / `DT_GNU_HASH` | The symbol hash table — for fast lookup by name. |
| `DT_INIT` / `DT_INIT_ARRAY` | Initializer (constructor) functions to run before `main`. |
| `DT_FINI` / `DT_FINI_ARRAY` | Finalizer (destructor) functions to run at unload/exit. |
| `DT_FLAGS` (`DF_BIND_NOW`) | Request eager binding. |

`readelf -d ./app` prints exactly this. When you debug a linking problem at this level, you're often reading the dynamic section to confirm what the binary actually asks for.

### 6. Initializers Run Before `main` (and via the dynamic section)

`DT_INIT_ARRAY` lists functions the loader calls *after* relocation but *before* `main`. This is how C++ runs constructors for global objects, how `__attribute__((constructor))` functions fire, and how some libraries set themselves up. The mirror, `DT_FINI_ARRAY`, runs at process exit or library unload. Knowing this explains "why is code running before `main`?" — the loader is executing the init array.

---

## Real-World Analogies

**The speed-dial that programs itself.** The PLT/GOT is a speed-dial button labelled "printf." The *first* time you press it, it doesn't have a number yet, so it routes you to the operator (the loader), who looks up the number, *writes it onto the speed-dial button*, and connects your call. Every press after that dials directly. You did the slow lookup once; the button remembers.

**The mailroom forwarding table.** Your code addresses mail to "printf, c/o the GOT." The GOT is a forwarding table at the mailroom. At first the table forwards to the loader's desk, who finds the real office, *updates the forwarding table*, and delivers. Later mail goes straight to the office. The letters (your code) never change; only the forwarding table (writable GOT) does.

**Will-call vs already-seated (lazy vs eager).** Lazy binding is will-call: you only collect a ticket for the show you actually attend, but there's a queue at the window the first time. Eager binding seats everyone before the doors even matter — no queue mid-show, but you waited up front, even for shows nobody watches.

---

## Mental Models

**Model 1: GOT = data indirection, PLT = code indirection.** Both exist so that constant, shareable code can reach per-process, load-time addresses. Data goes through the GOT; functions go through the PLT (which itself uses the GOT). One writable table, one read-only table of stubs.

**Model 2: The first call writes the answer down.** Lazy binding is memoization at the machine level. The PLT stub's GOT slot is a cache, initially "miss" (points at the resolver), permanently "hit" after the first call (points at the function).

**Model 3: `readelf -d` is the loader's to-do list.** Everything the loader does — which libraries, which relocations, which init functions, eager-or-lazy — is declared in the dynamic section. If behavior surprises you, read the list.

---

## Code Examples

### See the PLT and GOT in a real binary

```text
$ cat > prog.c <<'EOF'
#include <stdio.h>
int main(void){ puts("a"); puts("b"); return 0; }
EOF
$ gcc prog.c -o prog -no-pie -fno-stack-protector

$ objdump -d -j .plt prog        # the PLT stubs
0000000000401020 <puts@plt>:
  401020: ff 25 e2 2f 00 00     jmp    *0x2fe2(%rip)   # GOT slot for puts
  401026: 68 00 00 00 00        push   $0x0            # relocation index 0
  40102b: e9 e0 ff ff ff        jmp    401010 <PLT0>

$ readelf -r prog | grep puts    # the relocation that fills the GOT slot
000000404018  ...  R_X86_64_JUMP_SLOT  0000000000000000 puts@GLIBC_2.2.5
```

`R_X86_64_JUMP_SLOT` is the lazily-resolved kind. The GOT slot at `0x404018` starts as a pointer back into the PLT and becomes `puts`'s real address after the first call.

### Watch lazy resolution happen, then watch it not happen again

```text
$ LD_DEBUG=bindings ./prog 2>&1 | grep puts
   <pid>: binding file ./prog to /lib/.../libc.so.6: normal symbol `puts'
   # printed ONCE — the first call. The second call to puts produces no
   # binding line, because the GOT slot is already patched.
```

`LD_DEBUG` is the loader's verbose mode and a superb teaching/debugging tool. `LD_DEBUG=help ./prog` lists categories.

### Force eager binding and confirm the difference

```text
$ LD_BIND_NOW=1 LD_DEBUG=bindings ./prog 2>&1 | grep -c "symbol"
   # Now ALL symbols bind at startup, before main runs — many lines,
   # all emitted before the program's own output.

# Build with eager binding + full RELRO baked in:
$ gcc prog.c -o prog_hard -Wl,-z,relro,-z,now
$ readelf -d prog_hard | grep -E "BIND_NOW|FLAGS"
   0x...  (FLAGS)    BIND_NOW
$ readelf -l prog_hard | grep RELRO
   GNU_RELRO  ...
```

With `-z now -z relro` the loader resolves everything up front and then remaps the GOT read-only — a GOT-overwrite exploit now hits a write fault.

### Read the dynamic section directly

```text
$ readelf -d ./prog
 Tag        Type            Name/Value
 0x0001 (NEEDED)            Shared library: [libc.so.6]
 0x000c (INIT)              0x401000
 0x0019 (INIT_ARRAY)        0x403e10
 0x0017 (JMPREL)            0x4005a0
 0x0007 (RELA)              0x400540
 0x0005 (STRTAB)            0x400400
 0x0006 (SYMTAB)            0x400320
 ...
```

This is the literal instruction sheet the loader follows. `NEEDED` is the shopping list; `JMPREL` points at the PLT relocations; `INIT_ARRAY` lists pre-`main` constructors.

### A constructor that runs before main

```c
#include <stdio.h>
__attribute__((constructor)) static void setup(void) {
    puts("[ctor] runs before main, via DT_INIT_ARRAY");
}
int main(void){ puts("[main]"); return 0; }
```

```text
$ gcc ctor.c -o ctor && ./ctor
[ctor] runs before main, via DT_INIT_ARRAY
[main]
```

The loader executed `setup` from the init array before transferring control to `main`.

---

## Pros & Cons

| Aspect | Lazy binding | Eager (now) binding |
|--------|--------------|---------------------|
| **Startup latency** | Lower — only used symbols cost anything. | Higher — resolves everything up front. |
| **First-call latency** | Spike on first use of each symbol. | None — already resolved. |
| **Latency determinism** | Worse — hidden per-symbol spikes. | Better — all cost is at startup. |
| **Security (GOT)** | GOT stays writable for the program's life (attackable). | Pairs with full RELRO to make GOT read-only. |
| **Throughput at steady state** | Same — after warm-up both are one indirect jump. | Same. |
| **Best for** | Short-lived processes, many imports/few used. | Latency-sensitive servers, security-hardened builds. |

The GOT/PLT indirection itself costs one extra indirect jump per cross-library call versus a direct call — usually negligible, but it's the reason static or LTO'd builds can be marginally faster on hot call paths.

---

## Use Cases

- **Understanding cold-start cost:** a process importing thousands of symbols across dozens of `.so`s pays measurable loader time. Knowing lazy vs eager lets you tune it (and explains why static/AOT helps cold start).
- **Hardening:** choosing `-z now -z relro` to close the GOT-overwrite class of exploits, accepting slightly slower startup.
- **Profiling weirdness:** a function that's mysteriously slow *the first time* and fast afterward is often just lazy PLT resolution — not your code.
- **Interposition (preview of senior):** because cross-library calls go through the GOT/PLT, you can *insert* a different definition of a symbol (e.g. a wrapper `malloc`) and every call routes to yours. The GOT/PLT model is precisely what makes `LD_PRELOAD` possible.

---

## Coding Patterns

### Pattern 1: Use `LD_DEBUG` to teach yourself what the loader did

`LD_DEBUG=libs` (search), `LD_DEBUG=bindings` (symbol resolution), `LD_DEBUG=reloc` (relocations), `LD_DEBUG=statistics` (timing). This is the highest-signal way to learn and debug at this level. No code changes needed.

### Pattern 2: Choose binding mode at link time, deliberately

For a server where tail latency matters, `-Wl,-z,now,-z,relro` removes first-call spikes and hardens the GOT. For a short-lived CLI launched millions of times, lazy may start fractionally faster. Measure, don't guess.

### Pattern 3: Read `readelf -d` before blaming your code

Surprising pre-`main` behavior, a missing dependency, or an unexpected search path all show up in the dynamic section. Read it first.

---

## Best Practices

1. **Prefer `-z relro -z now` for production servers and security-sensitive binaries.** The hardening usually outweighs the startup cost; profile the startup if it's a hot loop.
2. **Don't fight the GOT/PLT — understand it.** A one-time first-call cost is normal and expected; don't "optimize" it away by accident with brittle hacks.
3. **Build shared libraries with `-fPIC`** (and prefer `-fvisibility=hidden` to export only what you mean to — fewer exported symbols means faster resolution and fewer interposition surprises).
4. **Use `readelf`/`objdump`/`LD_DEBUG` to verify, not assume.** The dynamic linker's behavior is fully observable; observe it.
5. **Keep your exported symbol surface small.** Every exported symbol is a GOT/PLT/hash-table entry and a potential interposition target.

---

## Edge Cases & Pitfalls

**Pitfall: assuming the GOT/PLT is thread-safe to resolve concurrently.** Lazy resolution in glibc *is* made thread-safe by the loader, but custom or older loaders, and certain `dlopen` patterns, can race. If two threads make the first call simultaneously, the loader must serialize the resolution. Usually handled for you; worth knowing exists.

**Pitfall: lazy binding hides errors until first call.** If a symbol is unresolvable (a missing function in a present library), lazy binding doesn't fail at startup — it fails at the *first call*, possibly deep in production, with `symbol lookup error`. Eager binding (`-z now`) surfaces the same problem at startup, which is often what you want for fail-fast behavior.

**Pitfall: confusing `.got` and `.got.plt`.** Data symbols (`GLOB_DAT`) resolve at load time into `.got`; function jump-slots (`JUMP_SLOT`) resolve lazily via `.got.plt`. Full RELRO makes `.got` read-only after load but, with lazy binding still on, `.got.plt` stays writable — which is why *full* hardening needs `now` too.

**Pitfall: stripping the wrong thing.** You can strip a lot from a binary, but the *dynamic* symbol table (`.dynsym`) and the dynamic section are load-bearing — strip them and the loader can't resolve anything. `strip` knows this and leaves `.dynsym` alone; hand-rolled stripping might not.

**Pitfall: thinking PIE and PIC are the same.** PIC is position-independent *library* code (always required for `.so`). PIE is a position-independent *executable* — the main program itself is built like a shared object so it too can be ASLR'd. Both rely on GOT-style indirection; PIE extends ASLR to the executable's own code, not just its libraries.

**Pitfall: `-no-pie` "fixing" an address-related bug.** If a bug "goes away" when you disable PIE/ASLR, you almost certainly have undefined behavior (an uninitialized pointer, a stale address) that randomization merely *exposes*. The fix is the bug, not the flag.

---

## Cheat Sheet

```text
THE TWO TABLES
  GOT (.got / .got.plt)  writable, per-process  -> holds resolved POINTERS
  PLT (.plt)             read-only, shared       -> holds tiny call STUBS
  why: shareable constant code reaches per-process addresses via indirection

FIRST CALL (lazy):
  call func@plt -> jmp *GOT[func] (still = resolver) -> push idx -> PLT0
    -> _dl_runtime_resolve -> find func -> WRITE addr into GOT[func] -> jump func
SECOND CALL:
  call func@plt -> jmp *GOT[func] (now = real func) -> done.   (one indirect jmp)

BINDING MODES
  lazy (default funcs)   resolve on first call    -> fast start, first-call spike
  now  (-z now / LD_BIND_NOW=1)  resolve all at load -> det. latency, slower start
  full hardening: -Wl,-z,relro,-z,now  -> GOT read-only after load (no overwrite)

RELOCATION TYPES (x86-64)
  R_X86_64_JUMP_SLOT  PLT function slot  (lazy)
  R_X86_64_GLOB_DAT   GOT data slot      (load time)

DYNAMIC SECTION (readelf -d)
  DT_NEEDED   required library      DT_INIT_ARRAY  ctors run before main
  DT_JMPREL   PLT relocations       DT_FINI_ARRAY  dtors at unload/exit
  DT_RELA     data relocations      DT_RPATH/RUNPATH baked search paths
  DT_SONAME   this lib's name       DT_GNU_HASH    fast symbol lookup

OBSERVE EVERYTHING
  readelf -d / -r / -l    LD_DEBUG=bindings|libs|reloc|statistics ./app
  objdump -d -j .plt app
```

---

## Summary

- A cross-library function call goes through two tables: the **PLT** (read-only stubs, one per function) and the **GOT** (writable pointers, patched with real addresses). Shareable constant code reaches per-process addresses via this indirection — the same trick that makes PIC and ASLR work.
- **Lazy binding** resolves each function on its *first* call: the PLT stub detours into `_dl_runtime_resolve`, which finds the symbol, **patches the GOT slot**, and jumps to the function. Every later call is one indirect jump straight through the patched GOT.
- **Eager (`now`) binding** resolves everything at load time: no first-call spikes, deterministic latency, and — paired with **full RELRO** — a read-only GOT that defeats GOT-overwrite exploits, at the cost of slower startup.
- The loader is driven by the ELF **dynamic section** (`readelf -d`): `DT_NEEDED` (dependencies), `DT_JMPREL`/`DT_RELA` (relocations), `DT_INIT_ARRAY` (pre-`main` constructors), and more. It's the loader's literal to-do list.
- Constructors run **before `main`** via `DT_INIT_ARRAY`; destructors run at unload/exit via `DT_FINI_ARRAY`.
- Everything here is observable: `LD_DEBUG`, `readelf`, and `objdump` let you watch the loader resolve, patch, and jump. When in doubt, observe.

Next: `senior.md` builds on the GOT/PLT to cover **symbol resolution rules** (search order, interposition, `LD_PRELOAD`, versioning, the diamond problem) and **`dlopen`/`dlsym`** for runtime plugins.
