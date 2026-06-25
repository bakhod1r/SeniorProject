# Dynamic Linking & Loading — Junior Level

> **Topic:** [Dynamic Linking & Loading](README.md)
> **Focus:** What actually happens between "I typed `./myprogram`" and "`main` runs" — and why your binary depends on files it doesn't contain.

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

> Focus: **What is the difference between static and dynamic linking, and what is the "dynamic loader" that runs before your `main`?**

When you compile a program, your source becomes **object files** full of machine code. But almost no real program is self-contained: your code calls `printf`, `malloc`, `pthread_create`, `socket` — functions you did not write. Those live in **libraries**. The job of joining your code to those libraries is called **linking**.

There are two ways to do it, and the choice shapes the size of your binary, how it starts up, how it shares memory, and how you patch security bugs:

- **Static linking** copies the library code *into your executable* at build time. The result is one big self-contained file. There is nothing left to resolve at run time.
- **Dynamic linking** leaves the library *out* of your executable and records only a *note*: "I need `libc.so.6`, and I call `printf` and `malloc` from it." At run time, a special program — the **dynamic loader** (`ld.so` / `ld-linux.so` on Linux) — reads those notes, finds the libraries on disk, maps them into memory, and wires up the calls. Only then does your `main` run.

In one sentence: **static linking bakes the dependencies into the loaf; dynamic linking keeps a shopping list and sends a helper to fetch the ingredients every time you bake.**

> 🎓 **Why this matters for a junior:** The single most common "it works on my machine" failure in native code is a linking problem — `error while loading shared libraries: libfoo.so.2: cannot open shared object file`, or on Windows `The code execution cannot proceed because VCRUNTIME140.dll was not found`. These are not your code being wrong. They are the *loader* being unable to find a dependency. Once you understand the loader's job, these errors go from terrifying to a five-minute fix.

This page covers: static vs dynamic linking and their trade-offs; what the dynamic loader does at startup; what a **shared library** is (`.so`, `.dll`, `.dylib`); how the loader *finds* libraries; and the basic tools (`ldd`, `nm`, `file`) that let you see all of this for yourself. The next level (`middle.md`) opens the hood on the GOT, the PLT, and lazy binding; `senior.md` covers symbol resolution, interposition, and `dlopen` plugins; `professional.md` covers ABI compatibility, startup cost at scale, JVM class loading, and DLL/dependency hell.

---

## Prerequisites

What you should know before reading this:

- **Required:** You can compile and run a simple C program (`gcc hello.c -o hello && ./hello`), or have used a compiled language (Go, Rust, C++).
- **Required:** Basic shell use — running a binary, reading an error message, `ls`.
- **Required:** A vague idea that programs are *files of machine code* and that the OS loads them to run.
- **Helpful but not required:** Knowing what a function call is at the assembly level (a jump to an address). We will explain the rest.
- **Helpful but not required:** Awareness that your OS has a notion of "processes" and "virtual memory."

You do **not** need to know:

- The exact byte layout of ELF, PE, or Mach-O files (that's later levels).
- What the GOT and PLT are (that's `middle.md`).
- Anything about symbol versioning, interposition, or class loaders (that's `senior.md` / `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Linking** | Joining compiled object files and libraries into a runnable program, resolving each "call this function" to an actual address. |
| **Static linking** | Copying library code into the executable at build time. Result is self-contained. |
| **Dynamic linking** | Leaving libraries out and resolving them at run/load time via the dynamic loader. |
| **Object file** | The compiler's output (`.o` on Linux, `.obj` on Windows): machine code plus a table of unresolved references. |
| **Library** | A reusable bundle of compiled code. Static libraries are archives (`.a`, `.lib`); shared libraries are `.so` / `.dll` / `.dylib`. |
| **Shared library / shared object** | A library loaded at run time and shareable between processes. `.so` (Linux), `.dll` (Windows), `.dylib` (macOS). |
| **Symbol** | A named thing in a binary: a function or a global variable. Linking is mostly about matching symbol *uses* to symbol *definitions*. |
| **Dynamic loader / dynamic linker** | The program that runs *before* your `main` and resolves dynamic dependencies. `ld-linux.so` / `ld.so` on Linux, the loader inside the kernel + `ntdll`/`kernel32` machinery on Windows, `dyld` on macOS. |
| **Static linker** | The build-time tool (`ld`) that produces the executable. Different program from the dynamic loader, despite the similar name. |
| **Dependency** | A library your program needs at run time. Recorded as a "needed" entry inside the binary. |
| **`ldd`** | A Linux command that prints the shared libraries a binary needs and where they were found. |
| **`nm`** | A command that lists the symbols in an object/library — which are defined and which are undefined (needed). |
| **PIC (Position-Independent Code)** | Code that runs correctly no matter what address it is loaded at. Required for shared libraries. |
| **ASLR** | Address Space Layout Randomization: the OS loads libraries at random addresses each run, for security. Made practical by PIC. |
| **soname** | The "library name with a version" recorded for matching, e.g. `libssl.so.3`. Lets the system pick a compatible version. |

---

## Core Concepts

### 1. Your Compiler Leaves Holes; the Linker Fills Them

When the compiler turns `main.c` into `main.o`, it cannot know the address of `printf` — `printf` is not in your file. So it emits a *placeholder*: "here is a call to a symbol named `printf`, address to be determined." The object file carries a list of these undefined symbols.

**Linking** is the act of resolving every undefined symbol to a real definition. The question "where does the definition come from, and *when* is the address filled in?" is exactly what splits static from dynamic linking.

You can see the holes with `nm`:

```text
$ nm main.o
                 U printf      <- 'U' means UNDEFINED: we use it, we don't define it
0000000000000000 T main        <- 'T' means defined in the Text (code) section
```

### 2. Static Linking: Copy It All In

With static linking, the **static linker** (`ld`, invoked for you by `gcc`) finds the definition of `printf` inside `libc.a` (a static archive), copies that machine code into your executable, and patches the call to point at it. After linking, your binary contains everything. Run it on any compatible machine and there is nothing more to resolve.

```text
$ gcc -static hello.c -o hello_static
$ ./hello_static          # works with zero external dependencies
$ ldd hello_static
        not a dynamic executable
```

Result: a bigger file (it now contains a copy of every library function you used), but completely self-contained.

### 3. Dynamic Linking: Keep a Shopping List

With dynamic linking (the default on nearly every OS), the static linker does *not* copy `printf` in. Instead it records two things in the executable:

1. **A "needed" list:** the libraries this program requires (e.g. `libc.so.6`).
2. **A relocation list:** the symbols (`printf`, `malloc`, …) the loader must wire up at run time.

The executable is small. But it cannot run by itself — it needs the libraries *and* a helper to wire them in.

```text
$ gcc hello.c -o hello       # dynamic is the default
$ ldd hello
        linux-vdso.so.1 (0x00007ffc...)
        libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f...)
        /lib64/ld-linux-x86-64.so.2 (0x00007f...)   <- the loader itself
```

### 4. The Dynamic Loader Runs Before `main`

Here is the part that surprises most juniors: **your `main` is not the first thing that runs.** When you exec a dynamically linked program, the kernel notices it has an "interpreter" recorded inside it — the dynamic loader, `ld-linux.so` — and runs *that* first. The loader then:

1. Reads the "needed" list.
2. Finds each library on disk (using a search order — see below).
3. Maps each library into the process's memory.
4. Recursively loads *their* dependencies too.
5. Resolves the symbols — patches the addresses so `printf` points at the real `printf` in the now-loaded libc.
6. Runs library initializers (constructors).
7. *Finally* jumps to your `main`.

All of this happens in milliseconds, invisibly, every single time you run the program. The cost of all this work is the **startup cost** of dynamic linking — usually tiny, but it grows with the number of libraries.

### 5. How the Loader Finds Libraries (Linux, simplified)

When the loader needs `libfoo.so.2`, it searches, roughly in order:

1. Paths baked into the binary (`RPATH` / `RUNPATH` — think "a hint the build recorded").
2. The `LD_LIBRARY_PATH` environment variable (a colon-separated list of directories).
3. The system cache (`/etc/ld.so.cache`, built from `/etc/ld.so.conf` by `ldconfig`).
4. Default system directories (`/lib`, `/usr/lib`, and the multiarch variants).

If it finds the file, great. If not, you get the dreaded `cannot open shared object file: No such file or directory`. The fix is almost always "make the library findable" — install it, or add its directory to the search path.

### 6. Other Platforms, Same Idea

The concept is universal; the names differ:

- **Linux:** shared objects are `.so`; loader is `ld-linux.so` / `ld.so`; tools are `ldd`, `nm`, `objdump`, `readelf`.
- **Windows:** shared libraries are `.dll` (Dynamic-Link Libraries); the OS loader resolves them; tools are `dumpbin`, Dependency Walker / Dependencies. The classic error: "*X.dll was not found*."
- **macOS:** shared libraries are `.dylib`; the loader is `dyld`; the tool is `otool -L`. Frameworks are bundles of `.dylib` + headers + resources.

---

## Real-World Analogies

**The recipe and the pantry.** A *statically linked* binary is a cookbook where every recipe reprints, in full, every sub-recipe it uses ("to make this, first here is the complete recipe for bread, in full"). It's huge but self-contained. A *dynamically linked* binary is a cookbook that says "use store-bought bread (see brand 'libc', version 6)." Smaller book — but you'd better have that bread in the pantry, or dinner doesn't happen.

**The phone's contacts.** Static linking is writing your friend's full phone number into every note you ever make. Dynamic linking is saving them once as "Mom" and looking up the number when you call. If Mom changes her number, dynamic wins (update one place). If your contacts app is broken, dynamic loses (you can't reach anyone).

**The building's shared elevator.** Ten apartments (processes) in one building share one elevator (one copy of `libc` in physical RAM). That's the memory-sharing win of dynamic libraries: the OS loads `libc` into physical memory *once* and maps it into every process. Static linking is each apartment building its own private elevator — works, but ten elevators' worth of steel.

---

## Mental Models

**Model 1: Linking is "filling in phone numbers."** Every function call in your code is a name that needs a number (an address). Static linking writes all the numbers at build time. Dynamic linking leaves the names and writes the numbers at startup, using the loader as the directory-assistance operator.

**Model 2: The loader is "the program that runs your program."** You think you ran `./hello`. The kernel actually ran `ld-linux.so hello` — the loader is the real entry point for a dynamic executable, and it hands control to your `main` only after setup is done.

**Model 3: `ldd` is "the loader's dry run."** `ldd` shows you what the loader *would* find. If `ldd` says `not found`, the real run will fail the same way. It is your first diagnostic, always.

---

## Code Examples

### See the dependencies of a binary (Linux)

```text
$ ldd /usr/bin/git
        linux-vdso.so.1 (0x00007ffd...)
        libpcre2-8.so.0 => /usr/lib/.../libpcre2-8.so.0 (0x...)
        libz.so.1 => /usr/lib/.../libz.so.1 (0x...)
        libc.so.6 => /usr/lib/.../libc.so.6 (0x...)
        /lib64/ld-linux-x86-64.so.2 (0x...)
```

Each `=>` line is a dependency and where it was resolved. A line that says `=> not found` is a problem waiting to crash.

### Build the same program both ways and compare size

```text
$ gcc hello.c -o hello_dynamic
$ gcc -static hello.c -o hello_static
$ ls -l hello_*
-rwxr-xr-x  hello_dynamic   16312       # tiny: libc lives elsewhere
-rwxr-xr-x  hello_static    872400      # huge: contains a copy of libc
```

The dynamic binary is a few kilobytes; the static one drags in a copy of the C library. That size difference is the most visible trade-off of all.

### Make and use a shared library yourself (Linux)

```c
// greet.c
#include <stdio.h>
void greet(const char *name) {
    printf("Hello, %s!\n", name);
}
```

```c
// main.c
void greet(const char *name);   // declaration only; definition is elsewhere
int main(void) {
    greet("world");
    return 0;
}
```

```text
# Build greet.c into a shared library:
$ gcc -fPIC -shared greet.c -o libgreet.so

# Build main, telling the linker we need libgreet from the current dir:
$ gcc main.c -L. -lgreet -o app

# Run it — but the loader can't find libgreet.so in standard paths:
$ ./app
./app: error while loading shared libraries: libgreet.so: cannot open shared object file

# Tell the loader where to look:
$ LD_LIBRARY_PATH=. ./app
Hello, world!
```

That sequence — *build fine, run fails to find the .so, fix the search path* — is the single most common dynamic-linking experience you will have. Note `-fPIC`: shared libraries must be position-independent (see "PIC" below).

### Diagnose a missing library

```text
$ ldd ./app
        libgreet.so => not found        <- there's your bug
        libc.so.6 => /lib/.../libc.so.6 (0x...)
```

`ldd` told you exactly which dependency the loader cannot find. Fix the path, re-run `ldd`, confirm it now resolves.

### macOS equivalent

```text
$ otool -L /bin/ls
/bin/ls:
        /usr/lib/libutil.dylib (compatibility version 1.0.0, current version 1.0.0)
        /usr/lib/libSystem.B.dylib (...)
```

`otool -L` is macOS's `ldd`. `libSystem` is the macOS equivalent of "the system C library + friends."

---

## Pros & Cons

| Aspect | Static linking | Dynamic linking |
|--------|----------------|-----------------|
| **Binary size** | Large — contains copies of everything used. | Small — just code + a dependency list. |
| **Memory (many processes)** | Each process has its own copy of library code in RAM. | One copy of a `.so` in physical RAM, shared across all processes that use it. |
| **Startup time** | Fast — nothing to resolve. | Slower — the loader must find, map, and wire up libraries first. |
| **Security patching** | Painful — a bug in `libssl` means **rebuilding every binary** that statically linked it. | Easy — patch one `libssl.so`, every program picks up the fix on next start. |
| **Deployment** | Trivial — one file, no external dependencies. | Fragile — the right library versions must be present (`cannot open shared object file`). |
| **Determinism** | Exactly the code you shipped runs. | The library version at *run time* may differ from build time. |
| **Disk usage (whole system)** | Wasteful — every binary re-includes `libc`. | Efficient — one shared `libc` on disk serves everyone. |

The headline trade-off: **dynamic linking trades startup cost and deployment fragility for smaller binaries, shared memory, and easy security patching.** That trade is usually worth it, which is why dynamic is the default everywhere.

---

## Use Cases

**Dynamic linking is the right default when:**

- You ship software to a system (Linux distro, macOS, Windows) that already has the standard libraries.
- Many programs share the same big libraries (`libc`, `libssl`, the C++ runtime) — sharing saves disk and RAM.
- You need security patches to propagate without rebuilding everything (this alone justifies it for `libssl`/`libcrypto`).
- You want plugins — code loaded *while the program is already running* (covered in `senior.md`).

**Static linking earns its keep when:**

- You want a single self-contained binary you can `scp` anywhere and run — no "missing .so" surprises. (Go does this by default; it's a big reason Go is loved for ops tooling.)
- You're building a container image and want it tiny (`FROM scratch` + one static binary).
- Cold-start latency matters and you want to eliminate loader work (serverless, CLI tools run thousands of times).
- The target environment is unknown or minimal (embedded, rescue images).

---

## Coding Patterns

### Pattern 1: Always run `ldd` (or `otool -L`) on a binary that won't start

Before guessing, *look*. `error while loading shared libraries` → run `ldd` → find the `not found` line → that's the answer. This is a reflex, not a debugging session.

### Pattern 2: Don't ship secret dependencies on `LD_LIBRARY_PATH`

`LD_LIBRARY_PATH=. ./app` is fine for a quick test, but baking it into a launch script is a smell. The right fix is to install the library in a standard place, or to record a proper run-time path in the binary at build time (covered in `senior.md`). Relying on an environment variable is fragile and a known source of security issues.

### Pattern 3: Pick the linking mode deliberately

For a CLI tool you'll distribute widely, consider static (or Go/Rust which make it easy). For a desktop app on a managed OS, dynamic is natural. Don't let it be an accident — know which you're shipping and why. Check with `ldd`/`file`.

---

## Best Practices

1. **Make `ldd`/`otool -L`/`dumpbin /dependents` a habit.** Inspect what your binary actually requires before deploying it.
2. **Install libraries properly instead of fighting `LD_LIBRARY_PATH`.** Use the package manager, or place them in standard directories and run `ldconfig`.
3. **Match library versions to what your binary expects.** A binary built against `libssl.so.3` won't run with only `libssl.so.1.1` present. The version in the dependency name matters.
4. **Prefer static linking for distributable, single-file tools** when the language makes it cheap (Go, and Rust with `musl`).
5. **Keep your build's link step visible.** Read the `-l` flags; know what you're pulling in.
6. **Never copy a single `.dll`/`.so` between machines and hope.** Dependencies are recursive — a library has its own dependencies. Copy the whole set or install properly.

---

## Edge Cases & Pitfalls

**Pitfall: "It compiles and links, so it'll run."** Linking succeeds at *build* time; the loader does its work at *run* time, possibly on a different machine with different libraries. A clean build does not guarantee a clean start. Always test on a representative target.

**Pitfall: Forgetting `-fPIC` when building a shared library.** Shared libraries must be **position-independent** — they can be loaded at any address (different processes, ASLR). On most modern toolchains it's the default for `-shared`, but if you build a `.o` without `-fPIC` and then try to make a `.so` from it, you'll get a relocation error. Fix: recompile with `-fPIC`.

**Pitfall: The version number in the soname.** `libfoo.so`, `libfoo.so.2`, and `libfoo.so.2.3.1` are usually *symlinks* pointing at one real file. The loader matches on the **soname** (`libfoo.so.2`), and the bare `libfoo.so` is typically a build-time-only link. Deleting the "extra" symlinks breaks things — they're load-bearing.

**Pitfall: Missing the loader itself.** On exotic or stripped systems you can get `No such file or directory` when running a *present, executable* binary. The "file" the kernel can't find is the **interpreter** — the dynamic loader recorded inside the binary (e.g. a binary built for `ld-musl` run on a `glibc`-only system). The binary is there; its loader isn't.

**Pitfall: Windows DLL "not found" at the worst time.** A Windows app can launch fine and then crash much later when it first tries to use a missing DLL (delay loading) or a DLL of the wrong architecture (32-bit DLL, 64-bit process). The error mentions a `.dll` you've never heard of — it's a dependency-of-a-dependency. Use a dependency-walker tool to see the full tree.

**Pitfall: Assuming `ldd` is safe on untrusted binaries.** On some systems `ldd` works by *running* the program under the loader, which can execute code. Don't `ldd` a binary you don't trust; use `objdump -p` / `readelf -d` to read its dependencies *without* running it.

---

## Cheat Sheet

```text
LINKING MODES
  static   = copy library code into the executable at build time
             + self-contained, fast start
             - big binary, hard to patch, no memory sharing
  dynamic  = record dependencies; loader resolves them at run time
             + small binary, shared in RAM, easy to patch
             - slower start, "missing .so/.dll" deployment risk

THE DYNAMIC LOADER (runs BEFORE your main)
  Linux:   ld-linux.so / ld.so
  Windows: OS loader (ntdll/kernel32 machinery)
  macOS:   dyld
  job: find libraries -> map them -> wire up symbols -> run inits -> call main

SHARED LIBRARY FILE NAMES
  Linux   .so      (e.g. libssl.so.3)
  Windows .dll
  macOS   .dylib

INSPECT A BINARY
  Linux:   ldd ./app          # dependencies + resolution (don't use on untrusted!)
           readelf -d ./app   # dependencies, safely (no execution)
           nm ./lib.so        # symbols (U = undefined/needed, T = defined)
           file ./app         # static vs dynamic, architecture
  macOS:   otool -L ./app
  Windows: dumpbin /dependents app.exe

LINUX SEARCH ORDER (simplified)
  1. RPATH/RUNPATH baked into the binary
  2. LD_LIBRARY_PATH
  3. /etc/ld.so.cache  (run `ldconfig` to rebuild)
  4. /lib, /usr/lib, multiarch dirs

THE CLASSIC ERROR
  "error while loading shared libraries: libX.so: cannot open shared object file"
  -> run ldd, find the 'not found' line, make that library findable
```

---

## Summary

- **Linking** matches every function/variable *use* in your code to a *definition*. The question is *when*: at build time (static) or load time (dynamic).
- **Static linking** copies library code into the executable: big, self-contained, fast to start, but hard to patch and wasteful of RAM across processes.
- **Dynamic linking** keeps a dependency list and lets the **dynamic loader** (`ld-linux.so`, the Windows loader, macOS `dyld`) find and wire up libraries at run time: small binaries, shared in RAM, easy to patch — at the cost of startup work and "missing library" deployment risk.
- Your `main` is *not* the first code to run. The loader runs first: it finds dependencies, maps them, resolves symbols, runs initializers, then calls `main`.
- The loader finds libraries via a **search order** (RPATH/RUNPATH, `LD_LIBRARY_PATH`, the cache, system dirs). Most "missing library" failures are search-path problems.
- Tools to *see* all of this: `ldd` / `readelf -d` (Linux), `otool -L` (macOS), `dumpbin` (Windows), and `nm` for symbols.
- The deepest payoff of dynamic linking is **security patching**: fix one `libssl.so`, every program is fixed. The deepest cost is **deployment fragility**: the right libraries must be present. Static linking flips both.

Next: `middle.md` opens the hood — how a dynamically linked call *actually* reaches the right function through the **PLT** and **GOT**, and why the first call is slow but the rest are fast (**lazy binding**).
