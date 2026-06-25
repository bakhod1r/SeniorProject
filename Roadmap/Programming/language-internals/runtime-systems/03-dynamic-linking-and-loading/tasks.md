# Dynamic Linking & Loading — Hands-On Tasks

> **Topic:** [Dynamic Linking & Loading](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I know `ldd`
exists" to "I can interpose `malloc`, read a PLT/GOT in a disassembler, ship a
`dlopen` plugin, and diagnose a classloader leak from a heap dump." Every task
fits into one or two focused sessions, and they build on one another. Attempt
each one *before* reading the hints — five minutes of struggle watching
`LD_DEBUG=bindings` teaches more than any paragraph here.

How to use this file: read the task, do the work on a real machine (Linux is
assumed for the ELF tasks; macOS/Windows tasks are marked), run the commands,
and only then check the hints. Tick a self-check box when you can *explain* the
result to another engineer, not when the command merely ran. The sample
solutions are intentionally sparse — they appear only where the canonical
answer is more instructive than your own first attempt would be.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model and the toolchain reflexes. Short, but each
introduces a tool or failure mode you'll reuse.

### Task 1: Static vs dynamic, measured

**Problem.** Compile a trivial `hello.c` (one `printf`) two ways:
`gcc hello.c -o hd` (dynamic) and `gcc -static hello.c -o hs` (static).
Record both file sizes. Run `ldd` on each and `file` on each. Explain the size
difference and what `ldd` says about the static one.

**Constraints.**
- Use the exact same source for both.
- Report sizes in bytes, not "big/small."

**Hints (try without first).**
- The dynamic binary is a few KB; the static one is hundreds of KB because it
  contains a copy of the C library code it uses.
- `ldd hs` prints `not a dynamic executable` — there is nothing to resolve.
- `file` tells you "dynamically linked, interpreter /lib64/ld-linux..." vs
  "statically linked."

**Self-check.**
- [ ] You can state, in bytes, the size cost of static linking here.
- [ ] You can explain *why* `ldd` has nothing to say about the static binary.
- [ ] You can name the interpreter recorded in the dynamic binary.

---

### Task 2: Cause and fix a "cannot open shared object file"

**Problem.** Build a shared library `libgreet.so` from a `greet()` function,
and a `main` that calls it (`gcc main.c -L. -lgreet -o app`). Run `./app` and
observe the failure. Make it run *three different ways*: via
`LD_LIBRARY_PATH`, via installing into a system dir + `ldconfig`, and via
baking a `RUNPATH` with `-Wl,-rpath,'$ORIGIN'`.

**Constraints.**
- Build the `.so` with `-fPIC`.
- For the `$ORIGIN` version, confirm with `readelf -d app | grep PATH`.

**Hints (try without first).**
- The build *succeeds*; only the *run* fails — linking and loading are
  different phases on different machines/times.
- `$ORIGIN` means "relative to the binary's own directory," so the app finds
  `libgreet.so` next to itself no matter where it's copied.
- Quote `'$ORIGIN'` so the shell doesn't expand it; it's resolved by the loader.

**Self-check.**
- [ ] You can explain why the build succeeded but the run failed.
- [ ] You can describe the trade-offs of the three fixes (env var vs install
      vs baked path).
- [ ] You understand why `$ORIGIN` is the right choice for a bundled app.

---

### Task 3: Read the dependency tree without running the binary

**Problem.** Pick a non-trivial system binary (e.g. `/usr/bin/ssh`). List its
dependencies with `ldd`, then with `readelf -d | grep NEEDED`, then with
`objdump -p | grep NEEDED`. Explain why you might prefer `readelf`/`objdump`
over `ldd` for an *untrusted* binary.

**Hints (try without first).**
- `ldd` on some systems works by *running* the binary under the loader, which
  can execute code (constructors, even crafted ones).
- `readelf -d` and `objdump -p` parse the file statically — no execution.
- `NEEDED` lines are the direct dependencies; `ldd` additionally shows the
  *transitive* resolution and where each was found.

**Self-check.**
- [ ] You can name the security reason not to `ldd` an untrusted binary.
- [ ] You can distinguish "direct NEEDED entries" from "fully resolved tree."

---

## Core

These get into the mechanism: the loader's behavior, the PLT/GOT, and binding
modes. Use `LD_DEBUG` liberally.

### Task 4: Watch lazy binding happen exactly once

**Problem.** Write a program that calls `puts` twice. Run it under
`LD_DEBUG=bindings` and find the binding line for `puts`. Count how many times
it appears. Then run under `LD_BIND_NOW=1` and compare *when* the binding
happens relative to the program's own output.

**Hints (try without first).**
- With lazy binding, `puts` binds on the *first* call; the second call uses the
  already-patched GOT slot and produces no new binding line.
- With `LD_BIND_NOW=1`, every symbol binds before `main`, so all binding lines
  appear *before* the program prints anything.
- `LD_DEBUG=help ./prog` lists every category.

**Self-check.**
- [ ] You observed the single binding line for `puts` under lazy mode.
- [ ] You can explain why eager mode emits all bindings before `main`'s output.
- [ ] You can describe the latency trade-off you just demonstrated.

---

### Task 5: Find the PLT stub and GOT slot in a disassembler

**Problem.** Build a small program (with `-no-pie` to make addresses easier to
read) that calls `puts`. Use `objdump -d -j .plt` to find `puts@plt`, and
`readelf -r` to find the `R_X86_64_JUMP_SLOT` relocation for `puts`. Identify
the GOT address the PLT stub jumps through, and match it to the relocation's
offset.

**Constraints.**
- `gcc prog.c -o prog -no-pie`.
- Quote the exact GOT address from the `jmp *0x...(%rip)` in the stub.

**Hints (try without first).**
- The PLT stub is `jmp *GOTADDR(%rip)` followed by `push $index; jmp PLT0`.
- The relocation type for a function jump-slot is `R_X86_64_JUMP_SLOT`; its
  offset is the GOT slot that gets patched.
- Before the first call, that GOT slot points back into the PLT (at the
  `push $index` line); after, it points at real `puts`.

**Self-check.**
- [ ] You can point at the exact instruction that jumps through the GOT.
- [ ] You can match the PLT stub's GOT address to the relocation offset.
- [ ] You can describe the GOT slot's value before and after the first call.

---

### Task 6: Force eager binding + full RELRO and verify the GOT is read-only

**Problem.** Build the same program with `-Wl,-z,relro,-z,now`. Confirm with
`readelf -d | grep -E 'BIND_NOW|FLAGS'` and `readelf -l | grep RELRO`. Explain,
in terms of the GOT-overwrite attack, what these two flags together buy you,
and what `relro` *without* `now` fails to protect.

**Hints (try without first).**
- `now` resolves all symbols at load; `relro` lets the loader remap relocated
  sections read-only after relocation.
- With lazy binding (`.got.plt` still writable), full RELRO can't lock the PLT
  GOT — that's why you need `now` too for the function table.
- A GOT-overwrite attack redirects a call by writing a new address into a GOT
  slot; a read-only GOT turns that write into a fault.

**Self-check.**
- [ ] You can explain why `relro` alone is insufficient under lazy binding.
- [ ] You can describe the attack that full RELRO defeats.
- [ ] You measured (LD_DEBUG=statistics) the startup cost of eager binding.

---

### Task 7: Interpose `malloc` with `LD_PRELOAD`

**Problem.** Write a `.so` that defines `malloc`, increments a global counter,
forwards to the real `malloc` via `dlsym(RTLD_NEXT, "malloc")`, and prints the
count in a destructor. `LD_PRELOAD` it in front of `/bin/ls` and report the
allocation count. Then try to `LD_PRELOAD` it in front of a *statically
linked* binary and explain what happens.

**Constraints.**
- Build with `-shared -fPIC -D_GNU_SOURCE ... -ldl`.
- Cache the resolved real `malloc` in a `static` pointer.

**Hints (try without first).**
- `dlsym(RTLD_NEXT, "malloc")` finds the *next* `malloc` after yours in the
  search order — the genuine libc one.
- Beware recursion and bootstrap: `dlsym` itself may call `malloc`; guard with
  a flag or a tiny static buffer for the first allocations if needed.
- Against a static binary, `LD_PRELOAD` does nothing — its `malloc` was
  resolved internally at link time; there's no dynamic call to interpose.

**Self-check.**
- [ ] Your shim counts and forwards correctly (the program still works).
- [ ] You can explain the `RTLD_NEXT` mechanism.
- [ ] You can explain why static binaries are immune to preload interposition.

**Sample solution (sketch).**
```c
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
static unsigned long n = 0;
void *malloc(size_t sz) {
    static void *(*real)(size_t) = NULL;
    if (!real) real = dlsym(RTLD_NEXT, "malloc");
    __sync_fetch_and_add(&n, 1);
    return real(sz);
}
__attribute__((destructor)) static void report(void){
    fprintf(stderr, "[shim] malloc called %lu times\n", n);
}
```
The subtlety the sketch glosses over is the `dlsym`-calls-`malloc` bootstrap;
on glibc it usually resolves without re-entering your `malloc`, but a robust
shim handles the re-entrant first call with a small static arena.

---

### Task 8: Demonstrate silent symbol interposition (the diamond risk)

**Problem.** Build two shared libraries `liba.so` and `libb.so` that *both*
define a non-static function `whoami()` returning a different string. Build a
program that links both (`-la -lb`) and calls `whoami()`. Which string prints?
Now swap the link order and re-run. Explain. Then rebuild both libraries with
`-fvisibility=hidden` (or a version script) keeping `whoami` internal, and show
the collision is gone.

**Hints (try without first).**
- On Linux's flat namespace, this is *not* an error; first-in-search-order
  wins, and link order affects search order.
- This is exactly how two statically-embedded copies of a library, or two
  plugins, can silently call into each other's functions.
- Hiding the symbol (or `-Bsymbolic`) removes it from the interposition pool.

**Self-check.**
- [ ] You can predict which `whoami` wins from the link order.
- [ ] You can connect this to the diamond/duplicate-symbol problem.
- [ ] You can show a fix (hidden visibility / version script / `-Bsymbolic`).

---

## Advanced

These are real engineering: plugins, lifecycle, versioning, and cross-platform
behavior.

### Task 9: Build a `dlopen` plugin host with clean lifecycle

**Problem.** Define a C plugin API: a single `extern "C"` entry point returning
a versioned vtable (`struct { int abi_version; const char *name; int (*run)(int);
void (*shutdown)(void); }`). Write a host that `dlopen`s a plugin with
`RTLD_NOW | RTLD_LOCAL`, checks `abi_version`, calls `run`, calls `shutdown`,
then `dlclose`s. Verify a plugin's *constructor* runs at `dlopen` and its
*destructor* runs at `dlclose`.

**Constraints.**
- Check `dlsym` via `dlerror()`, not a NULL return.
- Reject plugins whose `abi_version` doesn't match the host's.
- Add an `__attribute__((constructor))`/`((destructor))` to the plugin and
  observe when they fire.

**Hints (try without first).**
- `dlerror()` is one-shot: clear it (`dlerror()`), call `dlsym`, then check
  `dlerror()` immediately.
- `RTLD_LOCAL` keeps the plugin's symbols out of the global scope, so a second
  plugin can't accidentally resolve against the first.
- The constructor prints during `dlopen`; the destructor during `dlclose`
  (or at process exit if something pinned the library).

**Self-check.**
- [ ] You verified ctor-at-`dlopen`, dtor-at-`dlclose` ordering.
- [ ] You can explain why the boundary must be C, not a C++ class.
- [ ] You can explain why `RTLD_LOCAL` is the right default.

---

### Task 10: Make `dlclose` *fail* to unload, and detect it

**Problem.** Construct a case where `dlclose` returns success but the library
is *not* actually unmapped: e.g. start a thread inside the plugin that keeps
running, or open it with `RTLD_NODELETE`. Confirm whether it unloaded by
checking `/proc/self/maps` (or by re-`dlopen`ing and observing the constructor
does *not* run again). Explain the danger of calling a saved function pointer
after the (apparent) close.

**Hints (try without first).**
- `dlclose` decrements a refcount; mapping stays until it reaches zero *and*
  nothing pins it.
- `grep <libname> /proc/self/maps` before and after `dlclose` shows whether the
  mapping is gone.
- Calling a function pointer into a truly-unloaded library is use-after-unload;
  calling one you wrongly believed unloaded is a silent leak.

**Self-check.**
- [ ] You produced a "closed but still mapped" library and proved it.
- [ ] You can name two reasons `dlclose` won't unmap.
- [ ] You can connect this to the JVM classloader-leak analogy.

---

### Task 11: Symbol versioning in your own library

**Problem.** Using a linker **version script**, ship a `libmath.so` that
exports `compute@@MATH_2.0` as the default and keeps an older
`compute@MATH_1.0` definition. Build one client against 1.0 and one against
2.0, and show both bind to their respective versions against the same
`libmath.so`. Inspect with `readelf --dyn-syms` and `readelf -V`.

**Hints (try without first).**
- A version script maps symbols to version nodes; `@@` marks the default, `@`
  marks a non-default (older) version.
- The asm directive `.symver compute_v1, compute@MATH_1.0` ties an internal
  implementation to an exported versioned name.
- Each client records the version it was built against; the loader honors it.

**Self-check.**
- [ ] Two clients built at different times bind to different versions of the
      same symbol from one `.so`.
- [ ] You can read the versions out of `readelf --dyn-syms`.
- [ ] You can explain how this is the mechanism behind glibc's `memcpy@...`.

---

### Task 12: Reproduce and read a `version 'X' not found` failure

**Problem.** Build a binary on a newer system (or against a newer glibc) and run
it on an older one (an older container image is the easiest lab). Capture the
exact `version 'GLIBC_X.YZ' not found` error. Then make it run on the old system
*without* downgrading your build machine, three ways: build against an older
glibc (or in an old container), static-link, and build against `musl`.

**Hints (try without first).**
- The error means the binary recorded a need for a symbol *version* the old
  `libc.so.6` simply doesn't define — a hard floor, not a preference.
- `readelf --dyn-syms yourbin | grep GLIBC_` shows the highest version you
  depend on; that's your effective floor.
- An old build container is the cleanest way to lower the floor without touching
  your host toolchain.

**Self-check.**
- [ ] You reproduced the error and can read the required version floor.
- [ ] You fixed it without downgrading your dev machine.
- [ ] You can explain why the loader refuses even though the old symbol exists.

---

### Task 13 (JVM): `ClassNotFoundException` vs `NoClassDefFoundError`

**Problem.** Write Java that triggers each *deliberately*. For
`ClassNotFoundException`: `Class.forName("does.not.Exist")`. For
`NoClassDefFoundError`: compile `App` against a `Helper` class on the
classpath, then *delete `Helper.class`* and run `App` so it does `new Helper()`.
Then trigger a *third*, subtler `NoClassDefFoundError`: a class whose `static {}`
block throws, used twice — observe how the second use hides the original cause.

**Hints (try without first).**
- The first is explicit, by-name loading (checked `Exception`).
- The second is "present at compile, gone at run" (direct reference → `Error`).
- The third: the first use throws `ExceptionInInitializerError` (the real
  cause); the class is poisoned, so *later* uses throw bare
  `NoClassDefFoundError` with no mention of the original exception.

**Self-check.**
- [ ] You produced all three and can explain which loading path each took.
- [ ] You can explain why the poisoned-class case masks the root cause.
- [ ] You know to look for the *first* `ExceptionInInitializerError`.

---

## Capstone

### Task 14: Diagnose a classloader leak from a heap dump (JVM)

**Problem.** Build (or use) a small web app deployed in Tomcat (or a stand-in:
a parent classloader that repeatedly creates child `URLClassLoader`s loading a
class that registers a `ThreadLocal` on a *shared* thread). "Redeploy" several
times, then take a heap dump (`jmap -dump:live`). In a profiler (Eclipse MAT,
VisualVM), find the leaked classloaders and the **GC-root path** that pins them.
Then fix the leak and prove (via dump) that the old classloaders are now
collected.

**Constraints.**
- The leaking reference must come from *outside* the app's classloader (a
  pooled thread's `ThreadLocal`, a JVM-wide `DriverManager` entry, an
  un-stopped `ExecutorService`/`Timer`, an MBean, or a shutdown hook).
- Prove the fix by showing the old classloader count drops after GC.

**Hints (try without first).**
- A classloader leak retains *every class and static field* it loaded, so each
  leaked loader is tens of MB — find them by retained size.
- The decisive view is "Path to GC Roots, excluding weak/soft references": it
  shows exactly which long-lived object pins the loader.
- The fix is lifecycle: on undeploy, `ThreadLocal.remove()`, deregister JDBC
  drivers, `shutdownNow()` executors, cancel timers, unregister MBeans.

**Self-check.**
- [ ] You found the leaked classloaders by retained size.
- [ ] You can name the exact GC-root path that pinned one.
- [ ] After the fix, the dump shows the old classloaders collected.
- [ ] You can articulate why this is the JVM analogue of "`dlclose` didn't
      actually unload."

---

### Task 15: Measure and justify a linking-strategy decision end to end

**Problem.** Take one real-ish service (an HTTP server with a few dependencies).
Produce two builds: dynamic and static (Go makes this trivial; for C, use a
musl-static toolchain). Measure: (a) cold-start time (`LD_DEBUG=statistics` for
the dynamic loader's share; wall-clock for both), (b) binary size, (c) resident
memory of N concurrent instances (to see shared-library RAM savings), and
(d) the *operational* cost of patching a CVE in a transitive dependency for each
build. Write a one-page recommendation for (i) a CLI tool, (ii) a long-lived
fleet service, (iii) a serverless function — and defend each with your numbers.

**Hints (try without first).**
- Expect static to win cold start and deployment simplicity, lose on binary
  size and (critically) on patching.
- The RAM-sharing benefit of dynamic only shows up with *many* instances of
  programs sharing the *same* big libraries — measure it, don't assume it.
- The patching cost is qualitative but decisive: dynamic = one package update;
  static = rebuild + redeploy every affected binary + an SBOM to know which.

**Self-check.**
- [ ] You have real numbers for startup, size, and multi-instance RAM.
- [ ] Your three recommendations follow from "lifetime and launch frequency,"
      not preference.
- [ ] You can articulate the patching trade-off as the deciding factor for the
      fleet service.

---

You're done when you can: read a binary's dependencies and dynamic section
without running it; trace a call from PLT stub through GOT slot to resolved
function; interpose a symbol and explain why it works (and when it doesn't);
ship a `dlopen` plugin with clean lifecycle and isolation; version your own
library's ABI; and diagnose a classloader leak from a GC-root path. At that
point the loader is no longer magic — it's a tool you drive.
