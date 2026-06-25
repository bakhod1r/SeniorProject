# FFI from High-Level Languages — Interview Questions

> **Topic:** [FFI from High-Level Languages](README.md)

---

## Introduction

These questions probe whether a candidate can call native code from a managed runtime *correctly* — not just whether they can paste a `ctypes` snippet from a tutorial. The foreign function interface is where the runtime's guarantees end and the operating system's calling convention begins. Every safety net the managed language normally provides — garbage collection, exception handling, bounds checks, thread management, type checking — stops at that boundary, and the candidate must demonstrate they know exactly which guarantee they are giving up at each call.

A strong candidate reasons in terms of the ABI, ownership of memory across the boundary, the cost model of a single foreign call, and the runtime-specific hazards: the GIL in CPython, local reference tables in JNI, the moving collector in Go's runtime, and the lifetime rules of Rust's `unsafe` blocks. They distinguish a *downcall* (managed → native) from an *upcall* (native → managed), know that the latter is far more dangerous, and can state precisely why passing a Go pointer to C or caching a `JNIEnv*` across threads corrupts the process. A weaker candidate treats FFI as "just call the function" and is surprised when it segfaults under load.

The questions below move from the conceptual vocabulary that every binding author needs, through the five major language surfaces (Python, Java, Go, Rust, Node), into the traps where the obvious answer is wrong, and finish with design scenarios that reveal whether the candidate has actually shipped a binding.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Python (ctypes / cffi / C-API / GIL)](#python-ctypes--cffi--c-api--gil)
  - [Java (JNI / Panama)](#java-jni--panama)
  - [Go (cgo)](#go-cgo)
  - [Rust (extern / bindgen)](#rust-extern--bindgen)
  - [Node (N-API)](#node-n-api)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)
- [Cheat Sheet](#cheat-sheet)

---

## Conceptual / Foundational

### Question 1: What is an FFI, and what exactly does crossing the boundary cost you?

An FFI (foreign function interface) is the mechanism by which code written in one language calls code written in another — almost always a high-level managed language calling a function exposed with the C ABI. The C ABI is the lingua franca because it is the lowest common denominator that every platform's linker and loader already speak: a flat set of symbols, primitive types, and a stack/register calling convention. What crossing the boundary costs is every guarantee the managed runtime gives you for free *inside* it. On the other side there is no garbage collector tracking your pointers, no exception that unwinds cleanly, no bounds checking, no thread that the runtime knows about, and no type system enforcing that the `int` you passed is the `int` the function expected. The candidate should be able to name these losses explicitly — they are the source of every FFI bug.

### Question 2: Why is the C ABI the universal interop target rather than, say, C++?

Because the C ABI is *stable and specified per platform*, while the C++ ABI is not portable. C has a small, fixed set of types and a name-mangling-free symbol table: a function `add` is exported as the symbol `add`. C++ mangles names (to encode overloads and namespaces), and the mangling scheme, vtable layout, exception-handling tables, and `std::string`/`std::vector` layouts differ across compilers and even compiler versions. There is no single "C++ ABI." So virtually every FFI mechanism targets `extern "C"` symbols: you wrap C++ in a C-compatible shim, expose plain functions, and let the high-level language bind to those. The throughline is that interop requires a *contract neither side can renege on*, and only C provides one.

### Question 3: Distinguish a downcall from an upcall, and explain why upcalls are more dangerous.

A **downcall** is managed code calling into native code: your runtime initiates the call, on a thread it owns, at a moment it chooses. An **upcall** is native code calling *back* into managed code — a callback. The upcall inverts everything you controlled: the native library decides *when* the callback fires, *on which thread*, and *with what locks held*. That introduces three independent hazards absent from downcalls — the callback may run on a thread the runtime has never seen (so it must be attached first), it may fire during a garbage collection, and the native library may hold an internal lock while calling you (so re-entering that library deadlocks). A candidate who treats both directions as symmetric has not shipped a callback-based binding.

### Question 4: What does "marshalling" mean and where does it bite?

Marshalling is converting a value from the managed representation to the native one and back. A Python `str` is a heap object with a length and an encoding; a C function wants a `char*` — a bare pointer to NUL-terminated bytes. Marshalling is the code that allocates, copies, encodes, and frees to bridge the two. It bites in three places: **cost** (copying a large buffer on every call dominates the call), **lifetime** (who owns the converted buffer, and when is it freed — a classic use-after-free or leak source), and **correctness** (encoding mismatches, off-by-one on NUL terminators, struct padding differences). The expensive truth is that for many bindings, marshalling cost, not the foreign call itself, is the bottleneck.

### Question 5: Who owns memory that crosses the boundary, and why does this matter so much?

Ownership — who is responsible for freeing an allocation and when — has no shared representation across the boundary, so it must be agreed by *convention* and enforced by *discipline*. If C allocates a buffer and returns it, does the caller free it (with `free`? with a library-specific `xxx_free`?), or does the library retain ownership? If the managed side allocates and passes a pointer in, must that allocation outlive the call (and is the managed object pinned so the GC cannot move or collect it)? Every binding must answer these for every pointer, and the answer must match the native library's documented contract exactly. This matters more than anything else in FFI because the failure modes — double-free, use-after-free, leak, freeing with the wrong allocator — are silent, corrupting, and often only manifest under load.

### Question 6: What is the difference between calling-by-FFI and shelling out to a subprocess?

FFI loads the native library *into your own process* and calls its functions directly via the ABI — same address space, function-call latency (nanoseconds to microseconds). Shelling out spawns a separate OS process, serializes input across a pipe or file, and parses output — process-spawn and IPC latency (milliseconds), but with full isolation. The trade-off is the entire point: FFI is fast and shares memory but a crash in the native code crashes *your* process and a memory bug corrupts *your* heap; a subprocess is slow and copies data but is fully isolated, so its crash is just a non-zero exit code. Choose FFI for hot paths and tight data sharing; choose a subprocess when isolation or a hostile/unstable library matters more than latency.

### Question 7: What is `argtypes`/`restype` (or a function descriptor), and why is getting it wrong catastrophic?

It is the explicit declaration of a foreign function's signature on the managed side — the parameter types and return type. The native library exports only a symbol and a machine-code calling convention; it carries no type metadata the managed runtime can read. So *you* must tell the runtime "this takes a `double` and returns a `double`." Getting it wrong is catastrophic because there is no type check at the boundary: if you declare the return as a pointer-sized `int` but it actually returns a `double`, the runtime reads the wrong register, and you get garbage — or, with a pointer, a wild address that crashes or corrupts when dereferenced. The classic CPython footgun is omitting `restype` for a function returning a pointer, which defaults to `c_int`, truncating a 64-bit pointer to 32 bits.

### Question 8: Why does a moving garbage collector complicate FFI more than a non-moving one?

A non-moving collector (CPython's refcounting, classic conservative collectors) keeps an object at a fixed address for its lifetime, so a raw pointer handed to C stays valid. A *moving/compacting* collector (the JVM, Go's runtime, .NET) relocates live objects to defragment the heap, which invalidates any raw pointer C is holding. This forces FFI APIs to either **pin** the object (tell the GC "do not move this") for the duration of the native call, or **copy** the data into off-heap, GC-invisible memory before the call. JNI's `GetPrimitiveArrayCritical` and `Get/ReleaseStringCritical` exist precisely to pin; Go's rule against storing Go pointers in C memory exists precisely because the collector can move them. A candidate who doesn't know whether their runtime's GC moves objects cannot reason about pointer validity across the boundary.

### Question 9: How do exceptions and errors cross the boundary?

They don't — not without explicit translation. Native C has no concept of a Java/Python/Go exception; it signals errors via return codes and `errno`. So a downcall that fails returns an error code your binding must check and convert into an idiomatic managed exception. More dangerously, in an *upcall* you must never let a managed exception propagate into native stack unwinding: C's unwinder doesn't know about it and behavior is undefined. Every callback must catch everything at the boundary and convert it to a status the C side understands. In JNI specifically, after any call that can throw you must `ExceptionCheck` and clear or handle the pending exception before issuing another JNI call.

### Question 10: What is struct layout / ABI compatibility, and how does it silently break?

A C struct has a precise memory layout: field order, sizes, and compiler-inserted *padding* to satisfy alignment. The managed side must describe the *identical* layout to read or write the struct correctly. It silently breaks when the two disagree — a forgotten padding byte, a wrong field type, an `int` that is 32-bit on one side and 64-bit on the other, or a native library that bumps its struct layout in a new version while your binding still uses the old one. Nothing errors; the binding just reads fields from the wrong offsets and produces corrupt data. This is why `bindgen`-style tools that generate struct definitions directly from the C headers are valuable: they keep layout in lockstep with the source of truth.

---

## Language-Specific

### Python (ctypes / cffi / C-API / GIL)

### Question 11: Compare `ctypes`, `cffi`, and the CPython C-API as ways to call native code.

`ctypes` is in the standard library and requires no compilation: you `CDLL("libfoo.so")`, set `argtypes`/`restype`, and call — great for quick bindings, but every call is interpreted dispatch (slower) and signature errors are runtime crashes. `cffi` lets you write the C declarations (or feed it a header) and offers two modes: an ABI mode like ctypes, and an *API mode* that compiles a small C shim, giving you real C compilation (catches signature mismatches at build time) and far better performance. The **C-API** (writing a C extension against `Python.h`) is the most powerful and fastest — you manipulate `PyObject*` directly — but it is the most work, ties you to CPython internals, and forces you to manage refcounts and the GIL by hand. Rule of thumb: prototype with `ctypes`, ship performance-sensitive bindings with `cffi` API mode or a compiled extension.

### Question 12: What is the GIL, and how does it interact with calling a blocking C function?

The Global Interpreter Lock is a single mutex that ensures only one thread executes Python bytecode at a time, which is what keeps CPython's object model (refcounts especially) safe without per-object locks. When you call into a long-running or blocking C function, you should *release the GIL* (`Py_BEGIN_ALLOW_THREADS` / `Py_END_ALLOW_THREADS` in a C extension; ctypes releases it automatically around `CDLL` calls, while `PyDLL` does not) so other Python threads can run while the C code works. The catch: while the GIL is released, the C code must not touch *any* `PyObject*`, because the invariant protecting them is no longer held. Releasing the GIL around a blocking call is what turns a binding from "serializes the whole interpreter" into "lets the rest of the program proceed."

### Question 13: A foreign (C-created) thread wants to call back into Python. What must it do?

It must acquire the GIL and register a thread state before touching a single `PyObject*`, via `PyGILState_Ensure()`, do its Python work, then `PyGILState_Release()`. A thread the interpreter did not create has no Python thread state; calling into the interpreter without `PyGILState_Ensure` corrupts the interpreter. This is the Python analogue of JNI's `AttachCurrentThread`. It is the single most common bug in callback-heavy CPython bindings: the callback works when invoked on the main thread and crashes intermittently when the C library invokes it from one of its own worker threads.

### Question 14: In `ctypes`, what happens if you forget `restype` for a function returning a pointer?

`ctypes` defaults `restype` to `c_int`. On a 64-bit platform a pointer is 64 bits, but `c_int` is 32 bits, so the returned pointer is *truncated* to its low 32 bits. The moment you dereference it you read a wild address — a crash, or worse, silent corruption if the truncated value happens to point at mapped memory. The fix is to set `func.restype = ctypes.c_void_p` (or the appropriate pointer/struct type) explicitly. This is the canonical reason "my ctypes binding works for `int`-returning functions but crashes on the one that returns a struct pointer."

### Question 15: Why can relying on the GIL for correctness make your extension fragile?

Because the GIL is a CPython *implementation detail*, not part of the language. Code that assumes "only one thread runs at a time, so I don't need a lock" breaks on interpreters without a GIL — Jython, IronPython, and crucially CPython's free-threaded build (PEP 703), which is becoming a supported configuration. A C extension that touched shared C-level state under the protection of the GIL, or assumed a Python-level compound operation was atomic, becomes a data race the moment the GIL is gone. Correct extensions take explicit locks for their own shared state rather than leaning on the GIL.

### Java (JNI / Panama)

### Question 16: What is a `JNIEnv*`, and what is the cardinal rule about it?

`JNIEnv*` is the interface pointer through which native code calls every JNI function (to access fields, call methods, create objects). The cardinal rule: **it is valid only on the thread it was obtained on; never cache it and use it from another thread.** Each thread attached to the JVM has its own `JNIEnv*`. A native thread obtains one via `AttachCurrentThread`. Reusing a `JNIEnv*` captured on a different thread corrupts the JVM. The `JavaVM*`, by contrast, *is* global and may be shared across threads — that is the handle you cache and use to attach new threads.

### Question 17: Explain local versus global references in JNI and why mismanaging them leaks or crashes.

When native code receives or creates a Java object reference (a `jobject`), it is by default a **local reference**: valid only for the duration of the current native method call, and automatically freed when the native method returns. Two failure modes follow. First, if a long-running native function creates many local references in a loop without deleting them (`DeleteLocalRef`), it exhausts the local reference table and crashes — even though the Java objects are garbage, the local refs keep them alive and fill the table. Second, if native code stores a local reference and uses it *after* the native method returns (e.g., in a later callback), it is using a dangling reference. To keep a reference across calls you must promote it to a **global reference** (`NewGlobalRef`) and explicitly `DeleteGlobalRef` when done. Local-reference mismanagement is the most common JNI memory bug.

### Question 18: What does `AttachCurrentThread`/`DetachCurrentThread` do, and what happens if you skip the detach?

`AttachCurrentThread(vm, &env, NULL)` registers a native (non-JVM) thread with the JVM and yields a `JNIEnv*` for it, making it legal for that thread to call JNI functions. You must call `DetachCurrentThread` before the thread exits. Skipping the detach is a real bug: a thread that terminates while still attached can crash the JVM or leak its thread-local JVM state. The pattern is attach-once at the top of the native thread's lifetime, do work, detach-once before it dies — not attach/detach around every call (that is wasteful but not corrupting).

### Question 19: What problem does Project Panama (the Foreign Function & Memory API) solve relative to JNI?

JNI requires you to write, compile, and ship C glue for every binding — boilerplate that is error-prone (local refs, exception checks, manual pinning) and a build/distribution burden. The **Foreign Function & Memory API** (Panama, stable in Java 22) lets you call native functions and manipulate off-heap memory *entirely from Java*, with no C glue: you describe a function with a `FunctionDescriptor`, obtain a downcall `MethodHandle` from the `Linker`, and allocate native memory via `MemorySegment` scoped to an `Arena` whose `close()` deterministically frees it. It is safer (the API enforces lifetimes via arenas and bounds via segments) and dramatically less boilerplate. Upcalls are supported via `Linker::upcallStub`, which wraps a Java `MethodHandle` as a native function pointer bound to an arena — and the catch is that calling that stub after its arena closes crashes.

### Question 20: After a JNI call that can throw, what must you do before the next JNI call?

You must call `ExceptionCheck` (or `ExceptionOccurred`) and handle a pending exception — by clearing it (`ExceptionClear`) or by returning to let it propagate to Java. Most JNI functions have undefined behavior if called while an exception is pending. Native code does not get an exception thrown *at* it the way Java does; the exception is recorded as "pending" on the thread, and you must explicitly check for it. Forgetting this check is a subtle, intermittent JNI bug: subsequent JNI calls behave unpredictably because they ran with an exception already pending.

### Go (cgo)

### Question 21: What is the single most important rule about pointers in cgo, and why does it exist?

**You must not pass a Go pointer to C if the Go memory it points to contains other Go pointers, and C must not store any Go pointer after the call returns.** The reason is Go's garbage collector: it is moving (it can relocate goroutine stacks, and it tracks pointers to keep memory alive), and it has no visibility into C memory. If C stashed a Go pointer in a C-side structure, the GC would neither see that reference (so it might collect the object) nor be able to update it if it moved the object — a dangling pointer. The cgo pointer-passing rules, enforced at runtime by `cgocheck`, exist to keep the collector's invariants intact. The standard workaround for "C needs a long-lived handle to a Go object" is to store the object in a Go-side map and pass C an opaque integer *handle* (e.g., via `runtime/cgo.Handle`) rather than the pointer itself.

### Question 22: What is the cost of a single cgo call, and why is it non-trivial?

A cgo call is far more expensive than a normal Go function call — historically tens to over a hundred nanoseconds versus a couple. The cost comes from the runtime work required to safely transition between the Go and C worlds: the calling goroutine must switch from its small, growable Go stack to a system stack C can use, the runtime must record the transition so the scheduler and garbage collector treat the goroutine correctly (it is now running C code that can't be preempted or have its stack moved), and it must switch back on return. The practical consequence: cgo is unsuitable for chatty, fine-grained calls in a hot loop. The design fix is to **batch** — do more work per crossing — rather than calling C millions of times.

### Question 23: Why does cgo affect the whole program's performance and build, not just the calls themselves?

Several reasons a candidate should know. A goroutine blocked in a C call occupies an OS thread for the duration (the scheduler cannot preempt C code), so many concurrent blocking C calls can force the runtime to spin up many threads. cgo disables some optimizations and complicates the build: it requires a C toolchain, breaks pure-Go cross-compilation (you now need a cross C compiler), and produces binaries that are dynamically linked against libc by default — which is precisely why `CGO_ENABLED=0` static binaries are preferred for minimal containers. So "we added one cgo call" can change your build pipeline, your container base image, and your scheduling behavior.

### Question 24: How do you call back into Go from C with cgo?

You export a Go function with the `//export FuncName` comment directive, which makes it callable from C as a symbol. The C side receives it as a function pointer and calls it. The constraints are real: the exported function's signature must use C-compatible types, you cannot return a Go pointer that C will retain (same pointer rules), and the call must be able to run on a thread the Go runtime can manage. For C libraries that invoke callbacks from their own threads, you typically pass an opaque handle (an integer key into a Go-side map) as the callback's user-data argument and look up the real Go object inside the exported function.

### Rust (extern / bindgen)

### Question 25: How do you expose a Rust function to C, and what do the pieces mean?

You write `#[no_mangle] pub extern "C" fn add(a: i32, b: i32) -> i32`. `extern "C"` selects the C calling convention so the function is callable across the ABI; `#[no_mangle]` disables Rust's name mangling so the symbol is exported as plain `add` that a C linker can find; `pub` makes it visible. You compile the crate as a `cdylib` (or `staticlib`) to produce a `.so`/`.dll`/`.dylib` (or `.a`) with a C-compatible symbol table. To consume C from Rust, you write an `extern "C" { fn ... }` block declaring the foreign functions and call them inside an `unsafe` block. The candidate should note that Rust uses `#[repr(C)]` on structs to guarantee C-compatible layout.

### Question 26: What is `bindgen`, and what problem does it solve?

`bindgen` is a tool that reads C (and some C++) header files and *generates* the corresponding Rust `extern` declarations, struct definitions (`#[repr(C)]`), constants, and type aliases automatically. The problem it solves is keeping the Rust-side declarations in lockstep with the C source of truth: hand-writing `extern` blocks and struct layouts is tedious and silently wrong if a header changes a field, a size, or a signature. By generating from the headers, `bindgen` ensures struct layout and signatures match the library exactly, and re-generating on a library upgrade catches breaking changes at compile time rather than as runtime corruption. Its companion `cbindgen` does the reverse: generates a C header from a Rust library exposing `extern "C"` functions.

### Question 27: Why is FFI inherently `unsafe` in Rust, and what is the binding author's job?

Calling a foreign function is `unsafe` because the compiler cannot verify anything about the other side: it cannot check that the pointers you pass are valid, that the function won't violate Rust's aliasing rules, that returned pointers are non-null and properly aligned, or that lifetimes are respected. The C ABI carries no such information. So Rust forces every foreign call and every raw-pointer dereference into an `unsafe` block, marking "the human has verified the invariants the compiler cannot." The binding author's job — the entire value of a good `-sys`/safe-wrapper crate — is to encapsulate that `unsafe` behind a *safe* API: validate inputs, manage lifetimes with ownership types (e.g., a wrapper whose `Drop` calls the C free function), convert null to `Option`, and convert error codes to `Result`, so callers never touch `unsafe` themselves.

### Node (N-API)

### Question 28: What is N-API, and what is its headline benefit over the old NAN/V8 approach?

N-API (Node-API) is Node's stable C interface for building native addons. Its headline benefit is **ABI stability across Node major versions**: an addon compiled against N-API keeps loading and working on Node 18, 20, 22, and beyond *without recompilation*. The previous era bound directly to V8's C++ API, which changed between Node versions, so every native module had to be recompiled (often via NAN, a compatibility shim) for each new Node release — a constant treadmill of breakage. N-API decouples the addon from V8's internals through a stable C ABI, which is why prebuilt addon binaries can be shipped once per platform and reused across Node upgrades. (node-addon-api is the convenience C++ wrapper over the C N-API.)

### Question 29: How does an N-API addon avoid blocking the Node event loop during heavy native work?

By doing the work on a worker thread via the **async worker** pattern (`napi_create_async_work` / `AsyncWorker` in node-addon-api), not on the main thread. The execute callback runs on a libuv thread-pool thread and must *not* touch any JavaScript values or call most N-API functions (only the main thread may), while the complete callback runs back on the main thread where it is safe to construct the result and resolve the promise/invoke the JS callback. If a native function did its heavy lifting synchronously on the main thread, it would block the event loop and stall the entire process. For native threads that need to call a JS function, `napi_threadsafe_function` is the safe bridge.

---

## Tricky / Trap Questions

### Question 30: "We only call one tiny C function per request, so cgo/JNI overhead is irrelevant." True?

Often false, and the trap is reasoning about a single call instead of the aggregate and the side effects. One call per request at high QPS is millions of crossings; at ~50-100ns of cgo overhead each that is real CPU. Worse, the per-call overhead is rarely the whole story: a blocking C call pins an OS thread for its duration (cgo) or holds the GIL unless released (CPython), so the binding's effect on *scheduling and concurrency* can dwarf the raw call cost. The correct answer measures the crossing cost against the request budget and considers batching, GIL release, and thread occupancy — not just "it's one function."

### Question 31: "The function works in my unit test, so the binding is correct." What's the flaw?

FFI bugs are overwhelmingly the kind a single-threaded, single-call unit test cannot surface. Pointer-lifetime bugs (use-after-free, double-free) may not trigger until the GC actually moves or collects at the wrong moment, which is load- and timing-dependent. Local-reference exhaustion (JNI) only appears after thousands of iterations. Missing GIL acquisition only crashes when the callback fires from a foreign thread. Moving-GC corruption only manifests when a collection happens to run mid-call. A passing unit test proves the happy path; FFI correctness requires stress testing under concurrency, running under sanitizers (ASan/Valgrind), and exercising the callback paths from native threads.

### Question 32: A candidate stores a Go pointer in a C struct "just for the duration of the callback." Why is this wrong even briefly?

Because the Go garbage collector can run *at any time*, including during the C code's execution between when you stored the pointer and when the callback uses it. The collector might move the pointed-to object (invalidating the stored address) or, if it cannot see the C-side reference, collect it as garbage. "Just for a moment" is not a defense against a collector that is concurrent and gives you no notification of when it runs. The cgo rules forbid this categorically, and `cgocheck` will often catch it at runtime with a panic. The correct pattern is an opaque integer handle into a Go-side map, never a raw Go pointer held by C.

### Question 33: "I declared `restype = c_int` and the C function returns a pointer, but it works on my 32-bit test box." Why does it break in production?

On a 32-bit platform pointers *are* 32 bits, so `c_int` happens to hold the whole pointer and the code works by accident. In production on 64-bit hardware, the pointer is 64 bits, `c_int` truncates it to the low 32 bits, and dereferencing the truncated value crashes or corrupts. This is the same class of bug as "works on x86, fails on ARM": code that relies on an incidental property of one platform. The fix is to declare pointer return types correctly (`c_void_p` or a typed pointer) so the width is right on every platform.

### Question 34: An upcall throws a Java/Python exception that propagates into the C caller. What actually happens?

Undefined behavior. The native C function that invoked your callback has its own stack frames and its own (non-existent, for plain C) notion of unwinding; a managed exception trying to unwind through C frames does not respect C's expectations and can corrupt the stack, skip cleanup, or crash. In JNI the exception becomes "pending" and the C code keeps running with subsequent JNI calls misbehaving; in CPython letting a Python exception escape a callback into C similarly leaves the error indicator set in a place C can't handle. The rule is absolute: every callback catches everything at the boundary and converts it to a return code or status the C side was designed to receive.

### Question 35: "N-API gives ABI stability, so my addon never needs rebuilding." What's the catch?

ABI stability is across *Node* versions — the contract between the addon and the Node runtime — not across *platforms* or against the *native libraries you link*. You still need a separate prebuilt binary per (OS, architecture, libc): a Linux glibc build won't run on Alpine/musl, an x64 build won't run on ARM64. And if your addon links a third-party C library that bumps its own ABI, you must rebuild against the new headers. N-API removes the per-Node-version recompile treadmill; it does not remove the platform matrix or the native-dependency-versioning problem.

### Question 36: A candidate releases the GIL with `Py_BEGIN_ALLOW_THREADS` and then calls `PyList_Append` inside that block. What breaks?

Everything. Inside `Py_BEGIN_ALLOW_THREADS` / `Py_END_ALLOW_THREADS` the GIL is *not held*, and the GIL is exactly the invariant that makes touching `PyObject*` safe. `PyList_Append` manipulates a Python object (and its refcounts), so calling it without the GIL is a data race against every other Python thread and will corrupt the interpreter. The rule for a GIL-released section is that it may run only pure C / OS work that touches no Python objects; any Python interaction must happen with the GIL re-acquired. This is the dual of "a foreign thread must `PyGILState_Ensure` before touching Python."

### Question 37: Caching a `JNIEnv*` in a global so all your native threads can reuse it — what goes wrong?

`JNIEnv*` is per-thread. A `JNIEnv*` obtained on thread A is invalid on thread B; using it from B corrupts the JVM. The cached-env pattern works in tests where everything runs on one thread and explodes the moment a second thread uses the cache. The correct global to cache is the `JavaVM*` (which is process-wide), and each thread obtains its own `JNIEnv*` via `AttachCurrentThread`. This is one of the most common JNI mistakes precisely because the buggy version appears to work.

---

## Design Scenarios

### Question 38: You must integrate a fast C image-processing library into a Python service. Walk through your binding strategy.

I would first decide the mechanism by performance and safety needs: for a hot path I'd reach for `cffi` API mode or a compiled extension over `ctypes`, because API mode compiles a shim that catches signature errors at build time and is faster per call. I'd define the ABI precisely — `argtypes`/`restype` or the `cffi` cdef from the library's headers — and pin the library's version so a struct-layout change can't silently corrupt me. For the data: images are large, so I'd avoid copying on every call by passing buffers via the buffer protocol / pointers where the library allows in-place work, and I'd nail down ownership (does the library allocate the output, and which free function reclaims it). For any operation that blocks, I'd release the GIL around the C call so the rest of the service keeps running, being careful to touch no `PyObject*` while it's released. I'd test under concurrency and a sanitizer, not just a single-call unit test. Finally, for distribution, I'd build manylinux/musllinux/macOS/Windows wheels with the dependent `.so`s bundled (`auditwheel`/`delocate`) so users `pip install` without a compiler.

### Question 39: A native library invokes a callback from its own background threads. Design the callback path in JNI.

Cache the `JavaVM*` (global) at library load, and store the Java callback object as a **global reference** (`NewGlobalRef`) — never a local ref, since the callback fires after the registering native method returned. In the C callback function, which runs on the library's thread: call `AttachCurrentThread` to get a thread-local `JNIEnv*` (and arrange to `DetachCurrentThread` when that thread finally exits, e.g. via a thread-exit hook or by attaching as a daemon). Do the minimum JNI work — look up and call the Java method — then `ExceptionCheck` and handle any pending exception so it doesn't propagate. Free any local references created in the callback to avoid table exhaustion if it fires in a loop. Keep the callback non-re-entrant with respect to the native library: assume it may hold a lock while calling me, so I don't call back into it. The shape generalizes to every runtime: attach the foreign thread, hold a long-lived (global) reference, do minimal work, catch exceptions, detach on thread death.

### Question 40: Your team is choosing between cgo and a subprocess to use a C library from a Go service. How do you decide?

I weigh isolation against latency and operational cost. cgo shares the address space: function-call latency, zero serialization, direct data sharing — but a crash or memory bug in the C code takes down the Go process, it complicates the build (C toolchain, loses easy cross-compilation, default-dynamic libc so no trivial scratch container), and each blocking call ties up an OS thread. A subprocess is fully isolated (its crash is a non-zero exit, its memory bug can't corrupt my heap), keeps the Go binary pure-Go and statically linkable, but pays process-spawn and IPC cost and forces serialization. So: if the C library is mature, trusted, and on a hot path with tight data sharing, cgo — with batching to amortize crossing cost and the pointer rules respected. If the library is unstable, untrusted, or used coarsely (a few big operations), a subprocess buys isolation cheaply. I'd also consider whether a pure-Go reimplementation or an existing pure-Go package removes the dilemma entirely, since avoiding the boundary is always the safest binding.

---

## Cheat Sheet

```
+-------------------------------------------------------------------+
| FFI from High-Level Languages — Must-Know                         |
+-------------------------------------------------------------------+
| 1. C ABI is the universal target (C++ ABI is not portable).       |
|    Wrap C++ in extern "C" shims.                                  |
|                                                                   |
| 2. Downcall (managed->native) = controlled.                       |
|    Upcall (native->managed callback) = dangerous: wrong thread,   |
|    GC mid-call, library lock held.                                |
|                                                                   |
| 3. Always declare the signature: argtypes/restype (ctypes),       |
|    FunctionDescriptor (Panama). No type check at the boundary.    |
|    ctypes restype defaults to c_int -> truncates 64-bit pointers. |
|                                                                   |
| 4. Moving GC (JVM/Go/.NET) invalidates raw pointers ->            |
|    pin (JNI critical) or copy off-heap.                           |
|                                                                   |
| 5. Python: release the GIL around blocking C; touch NO PyObject*  |
|    while released. Foreign thread -> PyGILState_Ensure/Release.   |
|                                                                   |
| 6. JNI: JNIEnv* is per-thread (never cache cross-thread);         |
|    JavaVM* is global. Local refs die when the native method       |
|    returns -> NewGlobalRef to keep; ExceptionCheck after throws;  |
|    AttachCurrentThread/DetachCurrentThread for native threads.    |
|                                                                   |
| 7. Go cgo: NEVER let C store a Go pointer; use an opaque handle.  |
|    Each call costs ~50-100ns + pins an OS thread; BATCH.          |
|    CGO_ENABLED=0 for static, cross-compilable, scratch-image bins.|
|                                                                   |
| 8. Rust: extern "C" + #[no_mangle], #[repr(C)] structs, cdylib.   |
|    FFI is unsafe; wrap it in a safe API (Drop=free, null=Option,  |
|    code=Result). bindgen generates from headers to stay in sync.  |
|                                                                   |
| 9. Node N-API: ABI-stable across Node majors (no per-version      |
|    rebuild); still needs per-(os,arch,libc) prebuilds. Heavy work |
|    on async workers, not the main thread.                         |
|                                                                   |
| 10. Errors don't auto-cross: convert codes<->exceptions; NEVER    |
|     let a managed exception unwind into C (undefined behavior).   |
|                                                                   |
| 11. Ownership of cross-boundary memory is convention, not type.   |
|     Match the library's free contract exactly; pin struct layout. |
|                                                                   |
| 12. A passing unit test proves nothing for FFI. Stress under      |
|     concurrency, run sanitizers, exercise callbacks from native   |
|     threads.                                                      |
+-------------------------------------------------------------------+
```
