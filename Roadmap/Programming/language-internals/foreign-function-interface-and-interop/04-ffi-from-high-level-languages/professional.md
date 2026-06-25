# FFI from High-Level Languages — Professional Level

> **Topic:** [FFI from High-Level Languages](README.md)
> **Focus:** Production FFI: callbacks/upcalls under threading, attaching native threads to a runtime, and shipping native artifacts (wheels, JNI loading, signing) without breaking customers.

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

> Focus: **Everything that makes FFI hard once it's *shipped* — concurrency at the boundary, threads the runtime didn't create, and binary distribution across platforms.**

A binding that calls `cos` is a toy. A *product* binding has to survive: native libraries calling *back* into managed code (upcalls) from arbitrary threads; native threads the runtime never created suddenly trying to touch managed objects; and a build/release pipeline that produces correct binaries for Linux, macOS, and Windows, on x86-64 and ARM64, against the right libc, signed and loadable on locked-down systems. Each of these is a category of production incident that a senior-level understanding of the boundary doesn't, by itself, prevent.

The three professional concerns:

1. **Callbacks/upcalls and threading.** Native code calling managed code is the most dangerous FFI direction. The callback may fire on a thread the runtime doesn't know about, during a GC, or while a lock is held. You must control *which thread* runs managed code and ensure that thread is *attached* to the runtime.
2. **Thread attachment and affinity.** The JVM needs `AttachCurrentThread` before a native thread can call JNI; CPython needs the GIL acquired (`PyGILState_Ensure`) before a foreign thread touches Python; some libraries demand callbacks on a specific thread. Get this wrong and you crash or deadlock.
3. **Build and packaging.** `manylinux` wheels, `delocate`/`auditwheel` to bundle dependent `.so`s, JNI library loading and `java.library.path`, code signing/notarization on macOS, and supply-chain integrity. This is where most *customer-visible* FFI failures actually occur — "import error on their machine, works on mine."

In one sentence: **at the professional level, FFI failures are concurrency incidents and distribution incidents, not coding mistakes — and both are won or lost before the code ever runs in anger.** This page is about those two fronts.

> 🎓 **Why this matters at the professional level:** You own the on-call pager for the binding. The failures you'll see — a callback segfaulting only under load, a customer who can't `pip install`, a crash that appears only on Alpine Linux or only after macOS Gatekeeper quarantines the dylib — are all professional-tier FFI problems. They're invisible in a unit test and obvious in production.

This page covers: upcall safety and thread attachment in each runtime, callback hazards (re-entrancy, exceptions across the boundary, GC during a callback), and the full distribution story for native code — wheels, manylinux/auditwheel, JNI loading, signing, and what breaks across platforms.

---

## Prerequisites

- **Required:** The senior FFI material — moving vs. non-moving GC, JNI/Panama, cgo cost, Rust safe wrappers.
- **Required:** Solid concurrency: threads, locks, deadlock, the difference between runtime-managed and OS threads.
- **Required:** Familiarity with at least one runtime's threading model (GIL, JVM threads, or goroutines).
- **Helpful:** Having built and shipped a native package (a wheel, a JAR with a `.so`, an npm package with a prebuilt addon).
- **Helpful:** Exposure to platform packaging quirks (glibc vs. musl, macOS notarization, Windows DLL search order).

You do **not** need anything beyond this; this is the deepest tier.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Upcall** | Native code calling *back* into managed code (a callback). The most hazardous FFI direction. |
| **Thread attachment** | Registering a native (foreign) thread with the runtime so it may call managed code: `AttachCurrentThread` (JVM), `PyGILState_Ensure` (CPython). |
| **`PyGILState_Ensure` / `Release`** | CPython API a foreign thread calls to safely acquire/release the GIL before touching Python objects. |
| **`AttachCurrentThread`** | JNI call that attaches a native thread to the JVM and yields a `JNIEnv*` for it. |
| **Re-entrancy** | A callback re-entering the same library/lock that invoked it, risking deadlock or state corruption. |
| **manylinux** | A set of standardized Linux baselines (glibc versions) so a wheel built once runs on many distros. |
| **auditwheel / delocate** | Tools that bundle a wheel's dependent shared libraries into the wheel (Linux / macOS) so users don't need them installed. |
| **`java.library.path`** | The JVM's search path for native libraries loaded by `System.loadLibrary`. |
| **musl vs. glibc** | Two C libraries; a wheel built against glibc won't run on musl-based Alpine without a musllinux build. |
| **Notarization / Gatekeeper** | macOS mechanisms that block unsigned/unnotarized native binaries from loading. |
| **N-API ABI stability** | Node's promise that an N-API addon compiled once keeps working across Node major versions. |
| **Prebuilt binaries** | Shipping compiled artifacts (per platform) so users don't compile at install time. |

---

## Core Concepts

### 1. Upcalls are the dangerous direction

A **downcall** (managed→native) is controlled: your managed code initiates it, on a thread the runtime owns, at a moment of your choosing. An **upcall** (native→managed, i.e. a callback) inverts all of that. The native library decides *when* the callback fires, *on which thread*, and *with what locks held*. Three independent hazards follow:

- **Wrong thread.** The callback may run on a thread the native library created — a thread the runtime has never seen. Touching a managed object from an unattached thread is undefined behavior (JVM) or a crash/corruption (CPython without the GIL).
- **GC/relocation mid-callback.** In a moving-GC runtime, a callback that grabs raw pointers before the GC and uses them after is holding stale addresses.
- **Re-entrancy and locks.** The native library may hold an internal lock while invoking your callback. If your callback calls *back into* that library, you deadlock. If it blocks, you stall the library.

The professional rule: **treat every callback as running on a hostile, unknown thread with unknown locks held, until you've proven otherwise.** Do the minimum, attach correctly, and don't call back in.

### 2. Thread attachment: making a foreign thread safe to use

When native code wants to run managed code on a thread the runtime didn't create, the thread must be **attached** first.

- **CPython:** a non-Python thread must call `PyGILState_Ensure()` to acquire the GIL and register thread state, do its Python work, then `PyGILState_Release()`. Skipping this and touching a `PyObject*` from a foreign thread corrupts the interpreter.
- **JVM:** the thread calls `(*vm)->AttachCurrentThread(...)` to get a `JNIEnv*`, does JNI work, and `DetachCurrentThread()` before exiting (a thread that exits while attached can crash the JVM or leak). Crucially, the `JNIEnv*` is **per attachment/thread** — never reuse one captured on a different thread.
- **Go (callbacks into Go from C):** cgo supports `//export`ed Go functions callable from C, but the call must originate on a thread cgo can map to a goroutine; long-lived C threads calling exported Go functions need care, and you cannot store Go pointers across the boundary.
- **Panama (upcalls):** you wrap a Java `MethodHandle` as a native function pointer (an "upcall stub") bound to an `Arena`; the FFM API manages the thread state, but the stub's lifetime is the arena's, and calling it after the arena closes is a crash.

The unifying idea: **a foreign thread is invisible to the runtime until it announces itself, and it must un-announce itself before it dies.**

### 3. Exceptions and errors across the callback boundary

Native code has no concept of a Java/Python exception. If your callback throws and you let the exception propagate *into* C, behavior is undefined — the C library's stack unwinding doesn't know about it. So every callback must **catch everything at the boundary** and convert it to an error code or status the C side understands (often: set a flag, return a sentinel, and re-raise on the managed side later). Equally, after a JNI upcall you must `ExceptionCheck` and clear or handle a pending exception before doing more JNI work. "Let it propagate" is a downcall luxury; in upcalls it's a crash.

### 4. The distribution problem: shipping native code that loads everywhere

Most *customer-reported* FFI failures are not crashes in your code — they're "it won't import on my machine." The native artifact must load on the target's OS, architecture, libc, and security policy.

**Python wheels.** A wheel containing a `.so` is tagged with platform info (e.g. `cp311-cp311-manylinux_2_17_x86_64`). The **manylinux** standard pins a baseline glibc so one wheel runs across many distros. **`auditwheel`** (Linux) and **`delocate`** (macOS) *bundle the dependent shared libraries into the wheel* so the user doesn't need libssl/libjpeg installed. Forget this and the user gets "cannot open shared object file." Alpine (musl libc) needs a separate **musllinux** wheel; a manylinux wheel won't run there. ARM64 (Apple Silicon, AWS Graviton) needs its own wheels.

**JNI libraries.** The `.so`/`.dll`/`.dylib` must be on `java.library.path` (or loaded by absolute path, or unpacked from the JAR to a temp dir at startup — the common pattern, e.g. what SQLite-JDBC does). Name and architecture must match; a 64-bit JVM can't load a 32-bit library.

**Node addons.** N-API gives **ABI stability** across Node major versions, so a single prebuilt `.node` keeps working — a huge improvement over the old NAN/V8-API era where every Node upgrade forced a recompile. Tools like `prebuild`/`prebuildify` ship per-platform binaries so users don't need a compiler.

**Signing and policy.** macOS **notarization/Gatekeeper** will refuse to load an unsigned/unquarantined dylib; you must sign (and often notarize) native artifacts. Windows has its own driver/DLL signing concerns. On hardened Linux, SELinux/AppArmor can block loading from certain paths.

### 5. Versioning and ABI compatibility over time

A shipped binding is a long-lived ABI contract. If the native library bumps its ABI (changes a struct layout, a function signature), your binding silently corrupts unless rebuilt against the new headers. Professionals **pin the native dependency version**, rebuild bindings when it changes, and prefer libraries with explicit ABI-stability promises. N-API is the gold standard here for Node; for C libraries, SONAME versioning (`libfoo.so.2`) is the signal — link against the major you tested.

---

## Real-World Analogies

**A subcontractor phoning your office whenever they like (upcalls).** A downcall is you calling the subcontractor during business hours. An upcall is the subcontractor phoning *your* office at 3 a.m., on a line you didn't know existed, while you're mid-meeting (holding a lock). You must have a night-desk protocol: answer briefly, take a message, never start a long task, and never call them back on the same line (re-entrancy deadlock).

**Visitor badges (thread attachment).** A contractor's worker can't roam your secure building until reception issues a badge (`AttachCurrentThread`/`PyGILState_Ensure`). And they must hand the badge back when leaving (`Detach`/`Release`), or security records break and the next audit fails (JVM crash on thread exit).

**Shipping appliances with the right plug (distribution).** Your device works perfectly — but if you ship a US plug to Europe (glibc wheel to Alpine), it won't power on. manylinux is the universal adapter; auditwheel is bundling the power brick so the customer doesn't need their own; notarization is the safety certification without which the store won't stock it.

**A signed, sealed certificate (signing/notarization).** A perfectly good binary that isn't notarized is like an unsigned legal document: technically complete, but the system refuses to honor it. Gatekeeper is the notary public who won't let the deal proceed without the seal.

---

## Mental Models

**Model 1: Downcalls are guests you invited; upcalls are strangers at the door.** You control everything about a downcall. An upcall arrives on someone else's terms — unknown thread, unknown locks, unknown timing. Defensive minimalism is the only safe posture.

**Model 2: A foreign thread is radioactive until attached.** It cannot safely touch a single managed object until it announces itself to the runtime, and it must decontaminate (detach/release) before it dies.

**Model 3: Shipping native code is shipping the dependency graph, not just your file.** Your `.so` is correct; what fails is everything it links to and every policy that gates loading it. The release artifact is the closure of dependencies plus the right platform tag plus a signature.

**Model 4: The ABI is a contract with a version, and silence is the failure mode.** When the native side's ABI changes and you don't rebuild, nothing errors — it corrupts. Pin, rebuild, and trust SONAMEs/N-API, not luck.

---

## Code Examples

### CPython: a foreign thread safely calling Python via the GIL

```c
/* Called from a thread the Python interpreter did NOT create. */
void native_callback(int value) {
    PyGILState_STATE g = PyGILState_Ensure();   /* attach + acquire GIL */

    PyObject *cb = get_saved_callable();         /* a global ref we stored earlier */
    PyObject *res = PyObject_CallFunction(cb, "i", value);
    if (res == NULL) {
        PyErr_Print();        /* a Python exception fired in the callback; handle it
                                 HERE — never let it propagate into C */
    } else {
        Py_DECREF(res);
    }

    PyGILState_Release(g);    /* release GIL + detach state */
}
```

### JNI: attaching a native thread, then detaching before exit

```c
JavaVM *jvm;  /* captured once at load time */

void *native_thread_main(void *arg) {
    JNIEnv *env;
    (*jvm)->AttachCurrentThread(jvm, (void **)&env, NULL);  /* get a JNIEnv */

    /* ... JNI work, with ExceptionCheck after calls that can throw ... */

    (*jvm)->DetachCurrentThread(jvm);   /* REQUIRED before the thread exits */
    return NULL;
}
```

### Panama: an upcall stub whose lifetime is the arena

```java
Arena arena = Arena.ofShared();
Linker linker = Linker.nativeLinker();

// Wrap a Java method as a C-callable function pointer.
MethodHandle target = MethodHandles.lookup()
    .findStatic(MyCallbacks.class, "onEvent",
                MethodType.methodType(void.class, int.class));
MemorySegment stub = linker.upcallStub(
    target, FunctionDescriptor.ofVoid(ValueLayout.JAVA_INT), arena);

// Pass `stub` to native code as a function pointer.
// CAUTION: once `arena` is closed, calling the stub from C crashes.
```

### Python packaging: bundling dependent libs into a wheel

```bash
# Build the wheel, then bundle its non-system .so dependencies INTO it,
# and tag it with a manylinux baseline so it runs across distros.
python -m build --wheel
auditwheel repair dist/mypkg-1.0-cp311-cp311-linux_x86_64.whl \
    --plat manylinux_2_17_x86_64 -w dist/

# macOS equivalent:
# delocate-wheel dist/mypkg-1.0-cp311-cp311-macosx_11_0_arm64.whl
```

### Node: an N-API addon is ABI-stable across Node majors

```c
#include <node_api.h>
/* Built against the stable N-API; the resulting .node keeps loading
   across Node 18, 20, 22... without recompilation. Ship one prebuilt
   binary per (os, arch) and users never need a compiler. */
napi_value Init(napi_env env, napi_value exports) { /* ... */ return exports; }
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

---

## Pros & Cons

**Pros**

- **Correct attachment + minimal callbacks** make even hostile native libraries safe to integrate.
- **N-API's ABI stability** removes the per-Node-version recompile treadmill.
- **manylinux/auditwheel/delocate** let one build serve a huge install base — the reason `pip install` "just works" for native packages.
- **Panama upcall stubs + arenas** give deterministic callback lifetimes without hand-written C.

**Cons**

- **Upcalls are inherently fragile** — threading, re-entrancy, and exceptions all conspire.
- **Distribution is a combinatorial matrix** (OS × arch × libc × Node/Python version) that multiplies build and test cost.
- **Signing/notarization adds a release gate** that fails late and visibly (at the customer's machine).
- **ABI drift is silent** — a native upgrade without a rebuild corrupts rather than errors.

---

## Use Cases

- **Integrating an event-driven C library** (audio, networking, GUI) that calls your code back from its own threads — requires correct attachment and minimal, lock-free callbacks.
- **Shipping a Python package with a native core** to a broad audience: manylinux + musllinux + macОS (x86-64 + ARM64) + Windows wheels, with dependencies bundled.
- **Distributing a JNI library inside a JAR** that unpacks the right `.so`/`.dll`/`.dylib` to a temp dir at startup and loads it by absolute path.
- **Publishing a Rust-based Node addon** via N-API/neon with prebuilt binaries so npm users never compile.

---

## Coding Patterns

### Pattern 1: Attach-do-minimum-detach for every foreign thread

Wrap all managed work done from a foreign thread in attach/detach (JVM) or GIL ensure/release (CPython). Never leave a thread attached at exit.

### Pattern 2: Callbacks are catch-all and non-re-entrant

Every callback catches all exceptions at the boundary, converts them to a status the C side understands, does the minimum work, and never calls back into the library that invoked it.

### Pattern 3: Bundle the dependency closure into the artifact

Use `auditwheel`/`delocate` (Python), unpack-from-JAR (Java), or `prebuildify` (Node) so the user installs one self-contained artifact and needs nothing preinstalled.

### Pattern 4: Pin and rebuild against the native ABI

Pin the native dependency's major/SONAME, rebuild bindings on every bump, and ship a test that asserts the ABI version at load time.

### Pattern 5: Sign and notarize as a release step

Treat code signing (and macOS notarization) as a non-optional pipeline stage, with a smoke test that loads the signed artifact on a clean machine.

---

## Best Practices

1. **Acquire the GIL / attach the thread before touching any managed object from foreign code.** No exceptions.
2. **Detach every attached JVM thread before it exits**, and release every `PyGILState`.
3. **Catch every exception inside a callback**; never let it propagate into native stack unwinding.
4. **Keep callbacks minimal and non-re-entrant**; assume the library holds a lock while calling you.
5. **Build the full platform matrix** (OS × arch × libc × runtime version) and test loading on clean images.
6. **Bundle dependent shared libraries** into the shippable artifact; don't assume the customer has them.
7. **Sign and notarize native binaries**; verify on a quarantined machine.
8. **Pin the native ABI and rebuild on every change**; assert the version at load time.
9. **Prefer ABI-stable interfaces** (N-API, SONAME-versioned C libs, Panama) to minimize the rebuild/recompile burden.

---

## Edge Cases & Pitfalls

- **Callback on an unattached thread.** Touching managed objects → undefined behavior / corruption. Always attach first.
- **JVM thread exits while still attached.** Crash or leak; `DetachCurrentThread` is mandatory.
- **Exception thrown out of a callback into C.** Native unwinding doesn't know about it → undefined behavior.
- **Re-entrant callback deadlock.** Callback calls back into the library that holds a lock while invoking it.
- **Calling a Panama upcall stub after its arena closed.** Use-after-free crash.
- **manylinux wheel on Alpine (musl).** Won't load; needs a musllinux build.
- **Missing `auditwheel`/`delocate` step.** "cannot open shared object file" on the customer's machine.
- **Wrong architecture artifact.** 64-bit runtime can't load a 32-bit library; Apple Silicon needs ARM64 wheels.
- **Unsigned dylib on macOS.** Gatekeeper refuses to load it.
- **Native ABI bumped without rebuild.** Silent struct/layout corruption; nothing errors.
- **Caching a `JNIEnv*`/GIL thread-state across threads.** Both are per-thread; cross-thread reuse corrupts.

---

## Cheat Sheet

| Concern | Mechanism / fix |
|---------|-----------------|
| Foreign thread → Python | `PyGILState_Ensure` / `PyGILState_Release`. |
| Foreign thread → JVM | `AttachCurrentThread` / `DetachCurrentThread`; per-thread `JNIEnv*`. |
| Callback exception | Catch at boundary, convert to status; `ExceptionCheck` after JNI upcalls. |
| Callback locks | Assume a lock is held; do minimum; never re-enter the library. |
| Panama upcall lifetime | Bound to an `Arena`; don't call after it closes. |
| Linux wheel portability | manylinux baseline + `auditwheel repair`; separate musllinux for Alpine. |
| macOS wheel portability | `delocate-wheel`; sign + notarize. |
| JNI lib loading | `java.library.path`, or unpack-from-JAR to temp + load by path. |
| Node addon stability | N-API ABI stability + prebuilt per-platform binaries. |
| ABI drift | Pin SONAME/major, rebuild on bump, assert version at load. |

---

## Summary

Professional FFI is dominated by two fronts the lower tiers don't reach: **concurrency at the boundary** and **binary distribution**. Callbacks (**upcalls**) are the hazardous direction — they fire on threads the runtime never created, possibly during GC and while the native library holds a lock. The defenses are universal: **attach** the thread (`PyGILState_Ensure`, `AttachCurrentThread`) before touching any managed object and **detach/release** before it dies; **catch every exception** at the callback boundary instead of letting it propagate into native unwinding; and keep callbacks minimal and non-re-entrant.

The other front is shipping native code that *loads on the customer's machine*. That means building the full matrix (OS × architecture × libc × runtime version), bundling dependent shared libraries into the artifact (**auditwheel**/**delocate**, unpack-from-JAR, **prebuildify**), respecting baselines like **manylinux**/**musllinux**, signing and notarizing for macOS Gatekeeper, and pinning the native **ABI** so a silent layout change doesn't corrupt data. **N-API**'s ABI stability and **Panama**'s arena-scoped upcalls are the modern tools that make this less painful. The throughline of the entire topic: native code gives you speed and reach, but every guarantee your runtime normally provides — safety, threading discipline, deterministic loading — becomes *your* explicit responsibility the moment you cross the boundary.
