# Dynamic Linking & Loading — Professional Level

> **Topic:** [Dynamic Linking & Loading](README.md)
> **Focus:** The engineering consequences at scale — ABI compatibility strategy, startup cost across a fleet, Windows DLL search/hijacking/delay-load, and JVM class loading with its leak class. Where dynamic linking becomes an operational and security concern.

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

> Focus: **How does dynamic linking shape real systems — binary distribution, startup latency, security posture, and the JVM's classloader model — and what decisions does a senior+ engineer own here?**

By this level the mechanism (PLT/GOT) and the policy (resolution, interposition, versioning) are tools you wield. The professional concern is the *system*: a fleet of services, a desktop app shipped to millions of machines, a managed runtime with a thousand classes. The questions change shape:

- **ABI compatibility:** how does your shared library evolve for years without breaking the binaries that depend on it? What is a soname bump, and when must you do one?
- **Startup cost at scale:** why does a binary that depends on 60 shared libraries start measurably slower than a static one, why did `prelink` exist, and why do AOT/static binaries win serverless cold starts?
- **Windows DLL reality:** the import address table (IAT), the DLL search order, **DLL hijacking/planting** (a real, exploited security class), and delay-loading.
- **JVM class loading:** loading → linking (verify/prepare/resolve) → initialization, the parent-delegation classloader hierarchy, custom classloaders, `ClassNotFoundException` vs `NoClassDefFoundError`, and **classloader leaks** — a production-grade memory bug.

> 🎓 **Why this matters at the professional level:** These are the decisions that show up in postmortems and architecture reviews, not code reviews. "Why did the security patch not take effect?" (static linking). "Why does cold start cost us 400ms?" (loader work). "Why does redeploying our app on the app server slowly OOM it?" (classloader leak). "Why does this third-party installer let an attacker run code?" (DLL planting). Owning dynamic linking at this level means owning real production risk.

This page covers ABI/soname strategy and dependency/DLL hell; startup-cost engineering (prelink history, why static/AOT helps cold start); the Windows loader (IAT, search order, hijacking, delay-load); and JVM class loading end to end including classloader leaks.

---

## Prerequisites

- **Required:** Senior level — symbol resolution, interposition, versioning, the diamond problem, `dlopen`.
- **Required:** Operational familiarity with shipping software: building, packaging, deploying, observing startup.
- **Required:** For the JVM section, working knowledge of Java/JVM bytecode at a high level.
- **Helpful:** Having debugged a real "missing/incompatible library" or "redeploy leaks memory" incident.

---

## Glossary

| Term | Definition |
|------|-----------|
| **ABI (Application Binary Interface)** | The binary contract between compiled components: calling conventions, struct layout, symbol names/versions, vtable layout. Distinct from API (source-level). |
| **soname** | The versioned library name (`libssl.so.3`) used for compatibility matching. A bump signals ABI break. |
| **soname bump** | Changing the soname (`.so.3` → `.so.4`) to declare "old binaries must not link this; the ABI changed." |
| **Dependency hell / DLL hell** | The failure mode where incompatible versions of shared libraries cannot be satisfied for all consumers at once. |
| **Prelink** | A (now largely retired) Linux technique that pre-computed relocations to speed startup; broken by ASLR's goals. |
| **IAT (Import Address Table)** | Windows' equivalent of the GOT: a table of resolved function pointers the loader fills for each imported DLL function. |
| **DLL search order** | The ordered locations the Windows loader searches for a DLL — historically including the current directory, the root of "DLL hijacking." |
| **DLL hijacking / planting** | Placing a malicious DLL where the loader will find it before the legitimate one, hijacking a process. |
| **Delay-load** | Windows feature deferring a DLL's load until the first call into it, to speed startup or tolerate optional dependencies. |
| **Classloader** | A JVM object responsible for finding and loading `.class` bytes and defining `Class` objects. |
| **Parent delegation** | The JVM rule that a classloader asks its parent to load a class before trying itself. |
| **`ClassNotFoundException`** | Thrown when *explicit* loading (`Class.forName`, `loadClass`) can't find a class. A checked exception. |
| **`NoClassDefFoundError`** | Thrown when the JVM needs a class during *linking/execution* that was present at compile time but is now missing/unloadable. An `Error`. |
| **Classloader leak** | A retired/redeployed application's classloader (and thus all its classes and statics) cannot be GC'd because something outside it still references it. |
| **AOT (Ahead-of-Time) compilation** | Compiling to native code before run time (GraalVM native-image, Go), eliminating most load/link/JIT-warmup cost. |

---

## Core Concepts

### 1. ABI Compatibility and the soname Contract

An **API** is a source-level promise: this header, this function signature. An **ABI** is a *binary* promise: this symbol with this calling convention, this struct laid out exactly so, this version. A library can keep its API (recompile-and-it-works) while breaking its ABI (the *already-compiled* binary now misbehaves). ABI breaks are silent and deadly because no compiler catches them — the old binary just reads a struct field at the wrong offset.

The **soname** encodes the ABI promise. `libssl.so.3` means "ABI generation 3." Binaries record the soname they need (`DT_NEEDED: libssl.so.3`). When you make an **ABI-incompatible** change — remove/change a symbol, reorder a public struct, change a calling convention — you must **bump the soname** (`.so.3` → `.so.4`). Now old binaries (needing `.so.3`) and new binaries (needing `.so.4`) can coexist on one system, each finding its own real file. ABI-*compatible* additions (new symbols, with versioning) keep the soname.

Getting this wrong *is* **dependency hell / DLL hell**: app X needs `libfoo.so.3`, app Y needs an incompatible build that overwrote it, and now one of them is broken. Distros invest enormous effort (soname discipline, symbol versioning, side-by-side installs) precisely to keep dependency hell at bay.

### 2. Startup Cost at Scale: Why Many `.so`s = Slow Start

Every shared library the loader must process costs: open the file, `mmap` it, parse its dynamic section, recursively load *its* dependencies, run relocations, run constructors. A binary with 5 libraries is cheap; one with 80 (a typical desktop app pulling Qt/GTK + dozens of transitive deps) spends real milliseconds in the loader before `main`.

The dominant costs are **relocation processing** (especially with many symbols and eager binding) and **symbol lookup** across many libraries (hash-table probes per symbol, times thousands of symbols). This is why:

- **`prelink`** existed: it pre-computed library load addresses and relocations so the loader could skip work. It's effectively dead because pre-assigning fixed addresses fights **ASLR** (the whole point of which is *random* addresses). Security won; prelink lost.
- **`-z now` makes startup slower but latency predictable**; lazy binding spreads the cost.
- **Static linking and AOT win cold starts.** A static binary skips the loader's find/map/resolve loop almost entirely. This is decisive for **serverless** (a function invoked from cold pays loader cost on every cold start) and **CLIs** (launched millions of times). Go's static binaries and GraalVM native-image exist substantially for this reason: trade build complexity and binary size for near-zero startup.

The rule: **if cold-start latency is a product metric, fewer shared libraries — ideally static or AOT — is the lever.** If memory sharing across many long-lived processes is the metric, dynamic wins.

### 3. The Windows Loader: IAT, Search Order, Hijacking, Delay-Load

Windows uses the same *ideas* with different names and a different security history.

- **IAT (Import Address Table):** Windows' GOT. The PE header lists imported DLLs and functions; the loader fills the IAT with resolved pointers. Calls go `call [IAT_slot]`. (Windows historically bound eagerly; lazy-ish behavior comes via delay-load.)
- **DLL search order:** the loader searches a sequence of directories for each needed DLL. The dangerous historical default included **the application's directory and the current working directory early in the order.** That is the root of **DLL hijacking / planting**: if an attacker can drop `version.dll` (or any DLL the app loads by name) into a directory searched *before* the legitimate one — say, the folder a user double-clicked an installer from — the app loads and executes the attacker's DLL with the app's privileges. This is a real, repeatedly-exploited class (installers run from `~/Downloads` are a classic vector). Mitigations: `SetDefaultDllDirectories`/`SafeDllSearchMode`, loading with **fully-qualified paths**, `LOAD_LIBRARY_SEARCH_*` flags, and signing.
- **Delay-loading:** mark a DLL delay-loaded and the loader doesn't resolve it until the first call into it. Speeds startup and lets an app run when an *optional* DLL is absent (you catch the structured exception and degrade gracefully). The cost is that a missing/incompatible DLL surfaces *later*, mid-feature, instead of at launch.

The cultural difference: Linux dependency hell is mostly about *versions*; Windows DLL hell historically added a *security* dimension (the search order) that Linux's RPATH/cache model largely avoids.

### 4. JVM Class Loading: Loading, Linking, Initialization

The JVM is a dynamic linker for bytecode, and it makes the phases explicit:

1. **Loading:** a classloader finds the `.class` bytes (from disk, a JAR, the network, generated in memory) and creates a `Class` object.
2. **Linking**, in three sub-phases:
   - **Verification:** check the bytecode is well-formed and type-safe (no stack overflows of the operand stack, no illegal casts). This is a big chunk of JVM startup cost.
   - **Preparation:** allocate static fields and set them to *default* values (0/null) — not initializers yet.
   - **Resolution:** turn symbolic references (constant-pool entries like "the method `String.length`") into direct references — the JVM's analogue of relocation, done lazily per reference.
3. **Initialization:** run static initializers and static field assignments, *the first time the class is actively used*. This is where your `static {}` blocks fire.

This lazy, per-class pipeline is exactly dynamic linking, one class at a time, with verification bolted on for safety.

### 5. The Classloader Hierarchy and Parent Delegation

Classloaders form a tree: **Bootstrap** (core `java.*`) → **Platform/Extension** → **Application/System** (your classpath) → any **custom** loaders (app servers, plugin frameworks, OSGi). The default rule is **parent delegation**: when asked to load a class, a loader first asks its *parent*, and only loads the class itself if the parent can't. This guarantees core classes (`java.lang.Object`) are loaded once by the bootstrap loader and can't be shadowed by application code — a security and correctness property.

Crucially, **class identity = (fully-qualified name, defining classloader).** The *same* class file loaded by *two different* classloaders yields two distinct `Class` objects that are **not assignment-compatible** — assigning one to a variable typed by the other throws `ClassCastException` even though "they're the same class." This is by design (it's how app servers isolate two web apps that bundle different versions of the same library) and a frequent source of baffling `ClassCastException: Foo cannot be cast to Foo` errors.

### 6. `ClassNotFoundException` vs `NoClassDefFoundError`

A perennial interview and debugging distinction:

- **`ClassNotFoundException`** (a checked `Exception`): thrown by *explicit* loading — `Class.forName("com.x.Y")`, `loader.loadClass(...)`, reflection — when the bytes can't be found. The code asked for a class by name and the loader couldn't locate it.
- **`NoClassDefFoundError`** (an `Error`): thrown when the JVM needs a class to *link or execute* code that referenced it directly (a `new`, a field type, a superclass) and the class is now missing **or failed to initialize**. A common trap: a class's static initializer throws, the class is marked erroneous, and *every later use* gets `NoClassDefFoundError` — masking the real cause (the original initializer exception). The presence-at-compile, absence-at-run shape is the signature: usually a packaging/classpath mismatch between build and run.

### 7. Classloader Leaks: A Production Memory Bug

In a long-running container (Tomcat, an app server) you redeploy an app: the old app's classloader and all its classes and statics *should* become garbage and be collected. A **classloader leak** is when they can't be, because some object *outside* the app's classloader still references *into* it. The whole classloader is then pinned, retaining **every class it loaded and every static field** — often tens of megabytes per redeploy. Redeploy ten times, OOM.

Classic culprits, all "something with a longer life than your app holds a reference into your app":

- A **`ThreadLocal`** on a pooled (container-owned) thread holding an app object.
- A **JDBC driver** registered in the container-wide `DriverManager`.
- A **timer/thread** (`java.util.Timer`, an `ExecutorService`) started by the app but never stopped, whose thread's context classloader pins the app loader.
- A static cache in a *shared* (container) library keyed by app classes.
- Singletons registered in JVM-wide registries (MBeans, shutdown hooks, security providers).

The fix is lifecycle discipline: on undeploy, deregister drivers, cancel timers, clear `ThreadLocal`s, shut down executors, and unregister from any JVM-wide singleton. Tools: a heap dump + "find the GC root path to the leaked classloader" in a profiler. This is the JVM's version of "`dlclose` didn't actually unload" from the senior level — the runtime kept a reference, so the unload didn't happen.

---

## Real-World Analogies

**The shared utility line (ABI / soname).** A water main (`libssl.so.3`) serves a whole street. You can add *new* taps without disturbing anyone (ABI-compatible, same soname). But if you change the *pipe diameter/thread* (ABI break), you must lay a *new main* (`.so.4`) alongside the old — homes plumbed for the old thread keep using it; new homes use the new one. Forcing everyone onto a re-threaded main overnight is dependency hell.

**The airport with too many connections (startup cost).** A direct flight (static binary) gets you there fast. A trip with 80 connections (80 shared libraries), each with check-in, security, and boarding (open/map/relocate/init), burns hours before you reach the destination (`main`). Prelink was a frequent-flyer fast-track that got cancelled for security reasons (ASLR).

**The building directory that trusts the lobby flyer (DLL hijacking).** Windows' old search order is like a receptionist who, asked for "the accountant," first checks a flyer taped up in the *lobby anyone can reach* before checking the official directory. An attacker tapes up their own flyer ("accountant: room 13, my office") and now your mail goes to them. Fully-qualified paths = ignore the lobby, use the official directory only.

**The org that won't let a contractor leave (classloader leak).** You dissolved a project team (undeployed the app), but a company-wide committee (a container thread's `ThreadLocal`) still lists a team member as a contact. Because that company-wide list references the person, you can't actually off-board *anyone* on the team — the whole team's desks, files, and badges stay allocated. Off-boarding requires removing every external reference first.

---

## Mental Models

**Model 1: soname = ABI generation number.** Same soname ⇒ promise of binary compatibility (additions only). Different soname ⇒ explicit "incompatible, install side-by-side." Every dependency-hell incident is a soname-discipline failure somewhere.

**Model 2: Startup cost = work-per-library × libraries.** Want faster cold start? Reduce libraries (static/AOT) or reduce per-library work (fewer symbols, lazy binding). Want memory sharing across many processes? Keep dynamic. It's a genuine trade, not a default.

**Model 3: The JVM is a verified, per-class dynamic linker.** Loading/linking/initialization is `dlopen`/relocation/constructors with type-verification added and laziness per *class*. Classloader identity is the namespace; a classloader leak is "the runtime kept a reference, so unload never happened."

**Model 4: Search order is attack surface.** Anywhere the loader looks for a dependency by *name* in a *writable-by-attacker* location (Windows CWD, a permissive RPATH, `LD_LIBRARY_PATH` for a privileged process) is a code-execution vector. Fully-qualified paths and trusted directories are the defense.

---

## Code Examples

### Inspect and reason about a soname

```text
$ readelf -d /usr/lib/.../libssl.so.3 | grep SONAME
 0x...  (SONAME)   Library soname: [libssl.so.3]
$ readelf -d ./myapp | grep NEEDED
 0x...  (NEEDED)   Shared library: [libssl.so.3]      <- app pinned to ABI gen 3
```

If OpenSSL bumps to `libssl.so.4` (ABI break), `myapp` keeps needing `.so.3`; both can be installed. Overwriting `.so.3`'s file with `.so.4` content is exactly how dependency hell starts.

### Measure loader cost

```text
$ LD_DEBUG=statistics ./heavy_app 2>&1 | grep -A6 "runtime linker statistics"
   total startup time in dynamic loader: 7,300,000 cycles
   time needed for relocation: 4,100,000 cycles
   number of relocations: 18,442
   ...
# Compare against a statically linked or AOT build to quantify the win.
```

This turns "dynamic linking is slow" from folklore into a number you can put in a perf budget.

### Java: the two failures, side by side

```java
// ClassNotFoundException — explicit, by name, not found:
try { Class.forName("com.example.NotShipped"); }
catch (ClassNotFoundException e) { /* asked by name, loader couldn't find it */ }

// NoClassDefFoundError — present at compile, gone (or failed init) at run:
//   Compiled with Helper on the classpath; run without it:
public class App {
    public static void main(String[] a) {
        new Helper();   // direct reference -> NoClassDefFoundError if Helper missing at run
    }
}
// Also fires if Helper's static initializer THREW the first time it was used.
```

### Java: a classloader leak and its fix

```java
// LEAK: a container-owned thread's ThreadLocal pins this app's classloader.
public class Cache {
    private static final ThreadLocal<byte[]> BUF = ThreadLocal.withInitial(() -> new byte[1<<20]);
    // On a pooled request thread, BUF retains an app-loaded object forever ->
    // the app's classloader can never be GC'd after undeploy.
}

// FIX: clear it on undeploy (e.g. ServletContextListener.contextDestroyed):
public void contextDestroyed(ServletContextEvent e) {
    Cache.BUF.remove();                 // release ThreadLocal
    java.sql.DriverManager.deregisterDriver(myDriver);  // unregister JDBC driver
    myExecutor.shutdownNow();           // stop app-started threads
}
```

### Windows: load a DLL safely (avoid hijacking)

```c
// UNSAFE: name only — subject to the search order (CWD, app dir, ...):
HMODULE h = LoadLibraryA("plugin.dll");

// SAFER: restrict the search to system + the directory of the module you trust,
// and/or pass a fully-qualified path:
SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_APPLICATION_DIR);
HMODULE h2 = LoadLibraryExA("C:\\Program Files\\MyApp\\plugin.dll",
                            NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
```

---

## Pros & Cons

| Decision | Pros | Cons |
|----------|------|------|
| **Dynamic linking (fleet)** | Shared RAM across processes; patch one `.so`, fix all; smaller images per binary. | Slower cold start; deployment/version fragility; dependency hell risk; search-order attack surface. |
| **Static linking / AOT** | Fast cold start; self-contained deploy; reproducible; no missing-lib failures. | Bigger binaries; security patch = rebuild *everything*; no cross-process code sharing. |
| **soname discipline** | Old and new binaries coexist; no dependency hell. | Requires careful ABI governance; mistakes are silent. |
| **Delay-load (Windows)** | Faster startup; tolerate optional DLLs. | Failures surface late, mid-feature, harder to diagnose. |
| **JVM classloaders** | App isolation; hot redeploy; plugins; multiple library versions side-by-side. | Classloader leaks; `ClassCastException: Foo to Foo`; complex hierarchy debugging. |

---

## Use Cases

- **Serverless / CLI cold-start optimization:** choose static/AOT to delete loader (and JIT-warmup) cost on every cold invocation.
- **Long-lived multi-tenant hosts (app servers):** dynamic linking + classloader isolation to run many apps/versions in one process and hot-redeploy them.
- **Security patching at fleet scale:** dynamic `libssl` so a CVE fix is one package update, not a rebuild of every service — the dominant argument *against* static-linking everything.
- **Desktop app distribution:** managing the DLL/`.so`/`.dylib` dependency set and search order so the app starts on customer machines and resists DLL planting.
- **Diagnosing redeploy OOMs / `ClassCastException: Foo to Foo` / `version not found`:** all are dynamic-linking-at-scale failures with crisp root causes once you know the model.

---

## Coding Patterns

### Pattern 1: Choose the linking model per workload, with numbers

Cold-start-bound (serverless, CLI) → lean toward static/AOT. Patch-cadence-bound or RAM-bound (many long-lived processes sharing big libs) → dynamic. Decide with `LD_DEBUG=statistics` and cold-start measurements, not vibes.

### Pattern 2: Govern ABI with sonames and version scripts

Treat your shared library's exported symbols as a published contract. Use a linker **version script** to control exports, add symbols compatibly (new versions), and **bump the soname** on any ABI break. CI should diff the exported symbol set between releases.

### Pattern 3: Load DLLs by full path and restrict search dirs

On Windows, never `LoadLibrary("name")` for anything an attacker could shadow. Use `SetDefaultDllDirectories`, fully-qualified paths, and signed binaries. Treat the search order as hostile.

### Pattern 4: Lifecycle every JVM-wide registration

For anything an app registers in a JVM-wide singleton (drivers, MBeans, shutdown hooks, `ThreadLocal`s on pooled threads, executors, timers), register on startup and **explicitly unregister on shutdown/undeploy.** This is the entire defense against classloader leaks.

---

## Best Practices

1. **Make startup cost a measured budget**, especially for cold-start-sensitive workloads; reach for static/AOT when the numbers justify it.
2. **Don't static-link security-critical libraries (`libssl`/`libcrypto`) carelessly** — you're opting *out* of fleet-wide patching. If you do, own the rebuild-and-redeploy responsibility explicitly.
3. **Practice soname discipline.** Compatible change → keep soname + version new symbols. Incompatible change → bump soname. Never overwrite an in-use soname's file with incompatible content.
4. **On Windows, treat the DLL search order as attack surface.** Full paths, restricted search directories, signing; audit what your app loads by bare name.
5. **In the JVM, deregister everything on undeploy** and heap-dump-diff after redeploys to catch classloader leaks before they OOM production.
6. **Know your `ClassNotFoundException` vs `NoClassDefFoundError` first move:** the former is a packaging/lookup miss; the latter is "present at compile, gone or init-failed at run" — check the *first* initializer exception, which the later errors mask.
7. **Keep dependency trees shallow and pinned.** Fewer transitive `.so`s/DLLs/JARs means faster start, smaller attack surface, and less dependency hell.

---

## Edge Cases & Pitfalls

**Pitfall: a "compatible" change that's secretly an ABI break.** Adding a field to the *middle* of a public struct, changing an enum's values, changing a function's calling convention, or inlining a previously-out-of-line function all break ABI while the API looks unchanged. No compiler warns. Tools like `abidiff` (libabigail) catch these; manual review usually doesn't.

**Pitfall: `RUNPATH` `$ORIGIN` security and portability.** `$ORIGIN` in RPATH/RUNPATH lets a binary find libraries *relative to itself* (great for bundled apps). But a writable `$ORIGIN` directory, or an attacker-controllable RPATH, becomes a code-execution vector — the Linux analogue of DLL planting. Privileged binaries ignore some of these for that reason.

**Pitfall: prelink nostalgia.** Don't try to reintroduce prelink-style fixed addresses for speed; you'd be disabling ASLR. The modern answer to startup cost is static/AOT or fewer libraries, not defeating address randomization.

**Pitfall: Windows delay-load hiding a missing dependency until a customer hits it.** A delay-loaded DLL that's absent launches fine and crashes the *one* customer who uses that feature, with a stack deep in the loader. Decide deliberately which dependencies are optional, and handle the delay-load failure (structured exception) gracefully.

**Pitfall: `ClassCastException: Foo cannot be cast to Foo`.** Two classloaders loaded the same class file → two distinct `Class` identities. Almost always a classloader-hierarchy or duplicate-JAR problem (the class is on both the parent and child classpath, or two web apps share it incorrectly). The fix is classpath hygiene, not casting tricks.

**Pitfall: static initializer failure poisoning a class.** If `static {}` throws once, the class enters an erroneous state and *every* subsequent reference throws `NoClassDefFoundError` — with no mention of the original cause. Always capture and log the *first* `ExceptionInInitializerError`; the later `NoClassDefFoundError`s are red herrings.

**Pitfall: `LD_LIBRARY_PATH` in production.** Convenient, but it's process-environment state that's easy to set wrong, easy to leak between services, and ignored for setuid binaries. Prefer RPATH/RUNPATH (`$ORIGIN` for bundles) or proper installation; reserve `LD_LIBRARY_PATH` for debugging.

---

## Cheat Sheet

```text
ABI / soname
  API = source contract; ABI = binary contract (layout, calling conv, symbol versions)
  soname = ABI generation: libssl.so.3 . Compatible change -> keep soname + version
  new symbols. Incompatible -> bump soname (.so.3 -> .so.4). abidiff catches silent breaks.
  dependency hell / DLL hell = soname/version discipline failure.

STARTUP COST
  cost ~= per-library work (open/mmap/relocate/init) x number of libraries
  prelink: pre-computed relocs; DEAD (fights ASLR). Don't resurrect.
  -z now: slower start, predictable latency. lazy: spreads cost.
  static / AOT win COLD START (serverless, CLI). dynamic wins cross-process RAM sharing + patching.
  measure: LD_DEBUG=statistics ./app

WINDOWS
  IAT = the GOT (loader fills imported-fn pointers)
  DLL search order historically includes CWD/app dir -> DLL HIJACKING/PLANTING (RCE class)
  defenses: full paths, SetDefaultDllDirectories, LOAD_LIBRARY_SEARCH_*, signing
  delay-load: defer DLL until first call -> faster start, late failures

JVM CLASS LOADING
  loading -> linking(verify, prepare, resolve) -> initialization(static {} on first use)
  hierarchy: Bootstrap -> Platform -> Application -> custom ; PARENT DELEGATION
  class identity = (name, defining classloader) -> "ClassCastException: Foo to Foo"
  ClassNotFoundException = explicit Class.forName/loadClass miss (checked Exception)
  NoClassDefFoundError   = needed at link/run, missing OR static-init failed (Error)
  CLASSLOADER LEAK: outside ref (ThreadLocal on pooled thread, JDBC driver, timer,
    static cache, MBean) pins the app classloader -> retains all classes+statics -> OOM on redeploy
    fix: deregister/clear/shutdown EVERYTHING on undeploy; heap-dump GC-root path
```

---

## Summary

- **ABI vs API:** the ABI is the *binary* contract (layout, calling convention, symbol versions); it breaks silently with no compiler warning. The **soname** encodes the ABI generation — keep it for compatible additions, **bump it** for incompatible changes so old and new binaries coexist. Failures here are **dependency hell / DLL hell**.
- **Startup cost scales with the number of shared libraries** (open/map/relocate/init/lookup per library). `prelink` once mitigated this but is dead because it fights ASLR. **Static linking and AOT win cold starts** (serverless, CLI); **dynamic linking wins cross-process memory sharing and fleet-wide security patching.** Measure with `LD_DEBUG=statistics`.
- **Windows:** the IAT is the GOT; the historical **DLL search order** (including CWD/app dir) is the root of **DLL hijacking/planting**, a real RCE class — defend with full paths, restricted search directories, and signing. **Delay-loading** speeds startup but defers failures.
- **JVM class loading** is a verified, per-class dynamic linker: loading → linking (**verify/prepare/resolve**) → **initialization** (static blocks on first use), with a **parent-delegation** classloader hierarchy and **class identity = (name, classloader)**.
- **`ClassNotFoundException`** = explicit lookup miss (checked); **`NoClassDefFoundError`** = needed at link/run but missing *or* its static initializer failed (and the original cause gets masked).
- **Classloader leaks** are the JVM's "unload didn't happen": an external reference (`ThreadLocal` on a pooled thread, JDBC driver, timer, static cache, MBean) pins a redeployed app's classloader, retaining all its classes and statics — OOM on repeated redeploy. The fix is deregistering everything on undeploy.

This concludes the tiered material. See `interview.md` for graded questions and `tasks.md` for hands-on exercises that make all of this muscle memory.
