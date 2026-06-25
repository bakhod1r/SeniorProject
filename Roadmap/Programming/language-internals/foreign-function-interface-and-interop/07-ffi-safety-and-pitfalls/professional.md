# FFI Safety & Pitfalls — Professional Level

> **Topic:** [FFI Safety & Pitfalls](README.md)
> **Focus:** The production hazard playbook — owning the FFI boundary as a system: memory ownership and lifetime, ABI/type discipline, error handling across the language line, threading and reentrancy, resource leaks, and the defensive posture that keeps a safe language safe when it links unsafe code.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Hazard Playbook](#the-hazard-playbook)
   - [Hazard 1: Memory Ownership and Lifetime](#hazard-1-memory-ownership-and-lifetime)
   - [Hazard 2: Type and ABI Mismatch](#hazard-2-type-and-abi-mismatch)
   - [Hazard 3: Error Handling Across the Boundary](#hazard-3-error-handling-across-the-boundary)
   - [Hazard 4: Threading and Reentrancy](#hazard-4-threading-and-reentrancy)
   - [Hazard 5: Resource Leaks and Robustness](#hazard-5-resource-leaks-and-robustness)
   - [Hazard 6: Security at the Boundary](#hazard-6-security-at-the-boundary)
5. [The Discipline: A Thin, Audited Boundary](#the-discipline-a-thin-audited-boundary)
6. [Tooling: How You Actually Catch These](#tooling-how-you-actually-catch-these)
7. [Process Isolation as an Architectural Tool](#process-isolation-as-an-architectural-tool)
8. [Code Examples](#code-examples)
9. [Best Practices](#best-practices)
10. [War Stories](#war-stories)
11. [Review Checklist](#review-checklist)
12. [Summary](#summary)

---

## Introduction

At the professional tier you are not the engineer who *uses* an FFI binding; you are the engineer who *owns* it. You decide whether a team may link a native library at all, you design the boundary so that the next ten people who touch it cannot introduce undefined behavior, you write the CI gates that catch the bugs review misses, and you are the one paged when a binding corrupts memory in production at three in the morning and the stack trace points into a `.so` you do not have symbols for.

This document is organized as a **hazard playbook**: six classes of failure, each with the mechanism, the symptom, the defense, and the test. The order matters. Memory ownership and ABI mismatch are the corruptors — they damage state silently and surface far from the cause. Error handling, threading, and resource leaks are the destabilizers — they crash, hang, or leak. Security is the meta-hazard: every binding inherits the memory-safety bugs of the unsafe side at exactly the point where attacker-controlled data crosses over.

The thread running through all of it is a single discipline, drawn from the Rust ecosystem but universal: **a thin, audited unsafe boundary wrapping a safe API.** The dangerous operations — raw pointers, manual frees, type punning, exception bridging — are confined to a small layer that validates everything and is small enough to prove correct in one sitting. Everything above it is ordinary safe code that *cannot* misuse the boundary because the boundary does not hand it the tools. This document is the professional's case for that discipline and the playbook for executing it.

> 🎓 **Why this matters at the professional level:** Your leverage is not writing the cleverest binding. It is making it impossible for the organization to ship an unsafe one. The defenses below are the ones you bake into the boundary design, the CI pipeline, and the review checklist so that correctness survives the original author leaving.

---

## Prerequisites

- The junior/middle/senior tiers of this topic: the loss of safety at the boundary and the six hazard classes in outline.
- Working knowledge of at least two FFI surfaces in depth (e.g. Rust `extern`, JNI, cgo, Python `ctypes`/CFFI, .NET P/Invoke).
- Comfort reading C headers and reasoning about calling conventions, struct layout, and the C type system.
- Operational experience: triaging a production crash from a core dump, reading a sanitizer report, running a binding under a debugger.
- Familiarity with how at least one managed runtime allocates, collects, and moves memory.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Allocator mismatch** | Freeing a pointer with a different allocator than the one that allocated it (e.g. `free()` on memory from a custom arena, or the runtime's free on a C `malloc`). Undefined behavior; often heap corruption. |
| **Double-free** | Freeing the same allocation twice. Corrupts the allocator's metadata; a classic exploit primitive and a classic crash. |
| **Dangling pointer** | A pointer to memory that has been freed or whose backing object has moved. Use yields use-after-free. |
| **Pinning** | Telling a managed runtime not to move (or collect) an object for a window, so native code may hold a raw pointer to it safely. |
| **`GC.KeepAlive`** | A .NET call that extends an object's reachability to a program point, preventing the GC from collecting it while native code still uses a pointer derived from it. |
| **ABI** | Application Binary Interface — the binary contract: type sizes, struct layout/padding, calling convention, name mangling. Distinct from the source-level API. |
| **Unwinding across `extern "C"`** | Letting a Rust panic or C++ exception propagate out of a function declared with the C ABI. Undefined behavior. |
| **`catch_unwind`** | The Rust function that stops a panic at an FFI export so it does not unwind into C. |
| **errno discipline** | The convention of clearing `errno`, calling, and reading it immediately — because almost any intervening call may overwrite it. |
| **Local/global reference (JNI)** | A JNI handle to a Java object; local refs are per-call-per-thread and limited in number, global refs survive across calls and leak unless deleted. |
| **`-Xcheck:jni`** | A JVM flag enabling extensive runtime JNI validation (bad refs, pending exceptions, wrong-thread use). |
| **Audited boundary** | A small, deliberately-unsafe layer where all FFI lives, exhaustively validated, wrapping a safe API used everywhere else. |

---

## The Hazard Playbook

### Hazard 1: Memory Ownership and Lifetime

This is the hazard that corrupts silently and surfaces nowhere near the cause. Across the boundary, the single most important question for every pointer is: **who owns this, and when does it die?** The boundary breaks because the two sides answer that question with different, undocumented assumptions.

**Allocator mismatch.** Memory allocated by one allocator must be freed by the *matching* deallocator. If C allocates a buffer with its `malloc` and you free it with your runtime's allocator (or vice versa), you corrupt heap metadata. The same applies when a library exposes a custom allocator: a buffer returned by `lib_alloc()` must be returned with `lib_free()`, never plain `free()`. The rule is mechanical: **every allocation is paired with the deallocation from the same allocator, documented at the API.** Where a library returns memory it expects you to free, the binding must call the library's free function on every path.

**Double-free and dangling pointers.** A double-free happens when both sides believe they own a pointer and both free it; a dangling pointer when one side frees and the other still holds. The defense is to make ownership *unambiguous and encoded*: exactly one side owns each allocation, the binding documents the transfer, and the owning side uses a wrapper whose destructor frees exactly once on every path (including error paths). A non-copyable owning type cannot be double-freed because there is only ever one owner.

**GC moves and collects under you.** Managed runtimes (JVM, .NET, Go, Python) may *move* objects to compact the heap and *collect* objects that look unreachable. If native code holds a raw pointer into a managed buffer, both are fatal: a move makes the pointer dangle; a collection frees the backing store mid-call. The crash is timing-dependent — it only fires when the GC actually runs, which is under load, which is production. The defenses:

- **Pinning.** Pin the object (JNI `GetPrimitiveArrayCritical`/`NewGlobalRef`, .NET `fixed`/`GCHandle.Alloc(obj, Pinned)`, Go's cgo pointer rules) so the runtime will not move it for the window the native code uses it.
- **`GC.KeepAlive` (.NET).** A naive marshalled pointer can dangle if the source object becomes unreachable *before* the native call returns, because the JIT may shorten its lifetime. `GC.KeepAlive(obj)` placed *after* the native call forces the object to stay reachable across it.
- **Bounded windows.** Pin for the shortest possible window. Long-lived pins fragment the heap and defeat the collector; that is its own production problem.

The mental model: **a raw pointer into managed memory is a lease the GC granted, and it expires the moment you stop pinning.**

### Hazard 2: Type and ABI Mismatch — "Compiles, Then Corrupts"

This hazard is uniquely nasty because the symptom is delayed and disconnected from the cause. A type or ABI mismatch usually *compiles cleanly and links*, then reads or writes the wrong bytes at runtime — corrupting data or the stack with no diagnostic.

The failure modes:

- **Wrong width.** Declaring a parameter or return as `int` when C used `long` or `size_t`, or `int32` when C used `int64`. The callee writes or reads more or fewer bytes than the caller expects; the result is a truncated value or a smashed adjacent register/stack slot.
- **Wrong signedness.** Treating an unsigned length as signed flips large values negative and breaks bounds logic.
- **Struct layout mismatch.** The two sides disagree about field order, padding, or alignment. Reading field `b` lands in field `a`'s padding. This is the canonical "I redeclared the struct by hand and got it subtly wrong" bug.
- **Calling-convention mismatch.** Declaring the wrong convention (cdecl vs stdcall on Win32, or a mismatched variadic signature) smashes the stack on return.
- **Python `ctypes` `restype`/`argtypes` omission.** `ctypes` defaults an unspecified return type to `int`. A function that actually returns a pointer or a `size_t` gets truncated to 32 bits on a 64-bit platform — the pointer is corrupted, the dereference crashes or, worse, reads garbage. Omitting `argtypes` lets `ctypes` guess argument marshalling, which can pass the wrong representation.

The defense is **never to hand-transcribe the ABI when you can generate or check it**, and to declare types explicitly and exhaustively where you must. Use binding generators (`bindgen`, `cbindgen`, SWIG, `cffi` in API mode) that read the C headers as the single source of truth. Where you write declarations by hand (`ctypes`, P/Invoke), specify *every* `restype`/`argtypes`/`MarshalAs`. Then **test across value ranges** — small, large, negative, zero, and boundary values — because a wrong width often produces correct results for small inputs and corruption for large ones.

### Hazard 3: Error Handling Across the Boundary

The single hardest rule, and the one most often violated: **never let a panic or exception unwind across an `extern "C"` boundary.** The C ABI has no concept of unwinding. When a Rust panic or a C++ exception propagates out of a C-ABI function into a C caller, the behavior is undefined — in practice it ranges from an immediate abort to silent stack corruption that varies by compiler, optimization level, and platform. This is not a style preference; it is undefined behavior.

The defenses, per ecosystem:

- **Rust:** wrap the body of every `extern "C"` export in `std::panic::catch_unwind`, convert a caught panic into an error return code, and never let `catch_unwind` itself be the last thing on the stack with a panic in flight. (Since Rust 1.81, an unwind across an `extern "C"` boundary aborts rather than being pure UB, but you should still catch and convert — an abort is a crash you chose not to handle.)
- **C++:** wrap every C-ABI export body in `try { ... } catch (...) { return error_code; }`. An exception escaping a `noexcept`/C-linkage function calls `std::terminate` at best.
- **JNI:** after *every* JNI call that can throw, call `ExceptionCheck`/`ExceptionOccurred`; a pending Java exception does not stop your C code — it sits there until you return to the JVM, and any further JNI call with an exception pending is itself undefined. Check, then `ExceptionClear` and handle, or return promptly to let the JVM throw.
- **Go cgo:** a Go panic cannot cross into C and a C `longjmp` cannot cross into Go; design so neither tries.

**errno discipline.** For C APIs that report errors via `errno`, the value is only meaningful *immediately* after the failing call. Almost any intervening call — including ones your runtime makes invisibly — may overwrite it. The discipline: set `errno = 0` if the API requires it, call, and read `errno` on the *very next* line, before anything else. Marshalling that does work between the call and the read silently destroys the error.

The unifying principle: **errors must be translated into the receiving language's native error mechanism at the boundary, never propagated as the sending language's mechanism.** A C return code becomes a Rust `Result`; a Rust panic becomes a C error code; a JNI failure becomes a checked-and-cleared Java exception. The boundary is the translation layer.

### Hazard 4: Threading and Reentrancy

The boundary connects two threading worlds that do not share assumptions, and the bugs are *intermittent* — the worst kind.

**GIL release for blocking calls (Python).** CPython runs only one thread of Python bytecode at a time under the GIL. A native call that blocks (I/O, long compute) while holding the GIL freezes *every* Python thread, and if it tries to call back into Python, deadlocks. Release the GIL around blocking native work (`Py_BEGIN_ALLOW_THREADS` / `Py_END_ALLOW_THREADS`; `ctypes` does this by default for foreign calls) and **never touch a `PyObject` without holding the GIL** — reacquire (`PyGILState_Ensure`) before any object access, including from a thread C created.

**JNI thread attach/detach.** A native thread the JVM did not create cannot make any JNI call until it `AttachCurrentThread`s to obtain a valid `JNIEnv`, and must `DetachCurrentThread` before it dies. Forgetting to attach crashes; forgetting to detach can leak or block shutdown. A `JNIEnv*` is **per-thread** and must never be cached and reused on another thread.

**Callback on the wrong thread.** When you register a callback with a native library, you must learn *which thread it fires on* — your thread, an internal worker, or a pool thread. A callback delivered on a foreign thread that touches managed state without attaching/acquiring is undefined behavior. The safe pattern: in the callback, attach/acquire as needed, do minimal work, and *hand off* to a runtime-owned thread (event loop, channel, executor) rather than doing managed work inline on the foreign thread.

**Non-reentrant and non-thread-safe libraries.** Many C libraries keep global state or are reentrant only with a per-context handle. Two threads calling such a library concurrently corrupt its internals. Serialize access with a lock around the library, or give each thread its own context. Read the threading documentation as carefully as the memory documentation. Also watch **reentrancy**: if a library calls your callback and your callback calls back into the library mid-operation, a non-reentrant library corrupts.

**cgo and the Go scheduler.** A cgo call occupies its OS thread for the call's duration; a flood of blocking cgo calls can exhaust the thread pool. cgo also forbids passing Go pointers that contain Go pointers into C, because the collector cannot track them across the boundary — violations are caught by `cgocheck` and are a hard rule, not a guideline.

### Hazard 5: Resource Leaks and Robustness

**Native handle and reference leaks.** Every native resource acquired through FFI — file descriptors, library handles, allocated buffers, JNI references — must be released on *every* path, including error paths. JNI is the canonical offender: **local references accumulate** within a long native method (a loop creating Java objects) until they exhaust the local-reference table and crash; **global references leak** if allocated and never deleted, growing memory until a long-running service OOMs. Bound local refs with `PushLocalFrame`/`PopLocalFrame` or explicit `DeleteLocalRef`; delete globals explicitly.

**RAII does not cross the boundary.** Your language's automatic cleanup — Rust `Drop`, C++ destructors, `try-with-resources`, Python `__del__` — does not run while control is on the C side, and C's cleanup does not run while control is on yours. Bridge cleanup explicitly: a wrapper object whose destructor calls the C free function, registered so it runs on the error path too (`defer`, `finally`, RAII, `__exit__`).

**A native crash kills the process.** There is no `try/catch` for a segfault in native code. One bug in one native call takes down the whole process — every in-flight request, every tenant. This robustness fact drives architecture (see [Process Isolation](#process-isolation-as-an-architectural-tool)).

### Hazard 6: Security at the Boundary

The defensive meta-hazard: **a memory-safe language inherits the unsafe language's bugs at the boundary.** Linking a C library into Rust, Java, Go, or Python does not extend your language's safety guarantees over that C code. A buffer overflow, integer overflow, or use-after-free in the native library is fully exploitable, and the FFI call is exactly the point where attacker-controlled data reaches it. Your memory-safe runtime is a thin shell over an unsafe core, and the boundary is the soft spot.

This is treated **defensively** — the goal is to engineer against these failure shapes, not to weaponize them:

- **Validate at the boundary.** Treat all data crossing into native code as hostile: check lengths against buffer capacities, reject malformed enums and out-of-range values, null-terminate where C expects it, and bound sizes *before* C sees them. The boundary is a trust boundary; validate it like one.
- **Assume the native parser is vulnerable.** Media codecs, document parsers, and decompressors written in C are historically rich in memory-safety bugs. If such code parses attacker-controlled input, assume it can be made to misbehave.
- **Contain the blast radius.** Where native code is untrusted (attacker-controlled input) or unstable (flaky third party), run it out-of-process so a compromise or crash cannot take the main process with it (see below). Consider sandboxing (seccomp, namespaces) for the isolated process.
- **Keep the native code current.** A native dependency's CVEs are *your* CVEs. Track and patch them; the boundary does not shield you.

The principle: **the boundary is where your safety guarantees end and your validation must begin.**

---

## The Discipline: A Thin, Audited Boundary

Every hazard above argues for one architectural pattern, which Rust formalized but every language can apply:

1. **Confine unsafe operations to one small module.** All raw pointers, manual frees, casts, panic-catching, and FFI declarations live in one place. Nothing outside it touches a raw pointer.
2. **Validate everything at the boundary.** Null-check, bounds-check, validate enums/lengths/signedness, reject malformed input — assuming the outside is hostile.
3. **Expose a safe API.** Above the boundary, callers see ordinary safe types and idiomatic errors. They *cannot* trigger UB because the boundary never hands them the tools.
4. **Encode ownership in types.** A handle wrapper that frees once on destruction; a non-copyable owning type that cannot be double-freed; a lifetime that prevents use-after-free.
5. **Translate errors at the boundary.** No panic/exception unwinds across `extern "C"`; every native failure becomes a native error of the receiving language.
6. **Document every contract.** Each unsafe function states its precondition ("`ptr` must be non-null and point to `len` valid bytes; caller retains ownership"). Reviewers check call sites against the contract.
7. **Test under sanitizers and checkers.** ASan/Valgrind for memory, TSan for threading, `-Xcheck:jni`, `cgocheck`, Miri for Rust UB.
8. **Minimize the surface.** Fewer functions, simpler data, opaque handles over shared structs. Every boundary function is a function someone must audit.
9. **Isolate when robustness or trust demands it.** Untrusted or unstable native code goes out-of-process.

The payoff: the dangerous code is small enough to prove correct and rarely changes; the safe code is large, idiomatic, and structurally cannot misuse the boundary.

---

## Tooling: How You Actually Catch These

Review finds some boundary bugs; tools find the rest. The professional gates the boundary in CI behind:

- **AddressSanitizer (ASan).** Catches heap/stack/global buffer overflows, use-after-free, double-free, and allocator-mismatch *new/delete* mismatches. The first tool to reach for on any memory-corruption crash. Compile both sides with ASan where possible; LeakSanitizer (bundled) catches handle/buffer leaks.
- **Valgrind/Memcheck.** No recompile required, catches use of uninitialized memory and invalid frees; slower than ASan but works on opaque binaries.
- **ThreadSanitizer (TSan).** Catches data races and some lock-ordering bugs across the boundary's threading hazards.
- **`-Xcheck:jni`.** Enables JVM runtime validation of JNI usage — bad references, calls with a pending exception, wrong-thread `JNIEnv` use, ref-table overflow. Run it in the test suite; it surfaces exactly the JNI hazards above.
- **`GODEBUG=cgocheck=1`/`2` and `go test -race`.** Enforce cgo's pointer-passing rules and catch races at the cgo boundary.
- **Miri (Rust).** Interprets Rust to detect UB (out-of-bounds, use-after-free, invalid values, some aliasing violations) in `unsafe` and FFI-shim code under test.
- **Fuzzing the boundary.** Feed the validation layer malformed and adversarial inputs (`cargo-fuzz`, libFuzzer, AFL++) under ASan, defensively, to confirm the boundary rejects what it must.

The rule: **a binding that has never run under ASan and the relevant runtime checker has not been tested.** Make these gates required, not optional.

---

## Process Isolation as an Architectural Tool

For native code that is **untrusted** (parses attacker-controlled input) or **unstable** (flaky third party, GPU driver, experimental codec), in-process care has a hard ceiling: one bug crashes or compromises everything. The architectural answer is **out-of-process isolation** — run the native code in a separate process, communicate over a pipe, socket, or shared-memory channel, and when it crashes, restart just that process.

What you gain: a bounded blast radius. A segfault, a memory corruption, even an exploited vulnerability is contained to the worker process; the parent observes a closed pipe and a non-zero exit, logs it, and respawns. You can additionally sandbox the worker (seccomp-bpf to restrict syscalls, namespaces/cgroups to restrict resources, a read-only filesystem) so even a fully compromised worker can do little.

What you pay: IPC overhead (serialization, copies, context switches) and operational complexity (process supervision, restart policy, backpressure). The trade is firmly worth it for untrusted parsers and unstable drivers; it is overkill for a stable, audited math library you control.

The decision rule: **choose your blast radius deliberately.** In-process FFI is fastest and most fragile; out-of-process is slower and contained. Match the isolation to the trust and stability of the native code, not to convenience.

---

## Code Examples

### Example 1: Catching a panic at the boundary (Rust)

```rust
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::os::raw::c_int;

#[no_mangle]
pub extern "C" fn compute(input: c_int) -> c_int {
    // ✅ a panic here must NOT unwind into the C caller (UB).
    let result = catch_unwind(AssertUnwindSafe(|| {
        do_work(input)            // may panic
    }));
    match result {
        Ok(value) => value,       // normal path
        Err(_)    => -1,          // ✅ translate panic into an error code
    }
}
```

The panic is stopped at the export and converted to an error return. C never sees an unwind.

### Example 2: errno discipline (Rust calling a C API)

```rust
extern "C" {
    fn risky_call() -> i32;
}

fn checked() -> Result<(), i32> {
    let rc = unsafe { risky_call() };
    // ✅ read errno on the VERY NEXT line; nothing may run in between.
    let err = std::io::Error::last_os_error();
    if rc != 0 {
        return Err(err.raw_os_error().unwrap_or(-1));
    }
    Ok(())
}
```

Any work between the call and the `errno` read can overwrite it; the discipline is read-immediately.

### Example 3: Pinning a managed buffer for a native call (.NET)

```csharp
byte[] buffer = GetManagedBuffer();
GCHandle handle = GCHandle.Alloc(buffer, GCHandleType.Pinned); // ✅ GC won't move it
try {
    IntPtr ptr = handle.AddrOfPinnedObject();
    NativeProcess(ptr, buffer.Length);   // native code holds the raw pointer
}
finally {
    handle.Free();                       // ✅ unpin on every path; keep the window short
}
GC.KeepAlive(buffer);                    // ✅ ensure buffer stays reachable across the call
```

Pinning stops a move; `GC.KeepAlive` stops the JIT from shortening the object's lifetime below the native use.

### Example 4: Pairing a custom allocator (the allocator-mismatch fix)

```c
/* The C library OWNS what it allocates; you must use its free. */
char *buf = lib_alloc(n);          /* allocated by the library's allocator */
/* ... use buf ... */
lib_free(buf);                     /* ✅ matching free — NOT free(buf) */
```

```rust
// In the safe wrapper, encode this so callers cannot get it wrong:
pub struct LibBuf(*mut c_char);
impl Drop for LibBuf {
    fn drop(&mut self) {
        unsafe { lib_free(self.0) }  // ✅ exactly one free, the matching one, on Drop
    }
}
```

The ownership and the matching deallocator are encoded in the type; a caller cannot double-free or mismatch.

### Example 5: A native thread attaching to the JVM with exception checks (JNI)

```c
void on_native_event(MyContext *ctx, int code) {
    JNIEnv *env;
    if ((*ctx->vm)->AttachCurrentThread(ctx->vm, (void **)&env, NULL) != JNI_OK)
        return;                                  /* ✅ foreign thread must attach */

    jclass cls = (*env)->GetObjectClass(env, ctx->listener);
    jmethodID mid = (*env)->GetMethodID(env, cls, "onEvent", "(I)V");
    (*env)->CallVoidMethod(env, ctx->listener, mid, code);

    if ((*env)->ExceptionCheck(env)) {           /* ✅ check after a call that can throw */
        (*env)->ExceptionDescribe(env);
        (*env)->ExceptionClear(env);             /* ✅ clear before any further JNI call */
    }
    (*env)->DeleteLocalRef(env, cls);            /* ✅ avoid local-ref accumulation */
    (*ctx->vm)->DetachCurrentThread(ctx->vm);    /* ✅ detach before the thread exits */
}
```

Attach, exception-check-and-clear, delete locals, detach — the four JNI rules in one function.

### Example 6: Correct `ctypes` type declarations (Python)

```python
import ctypes
lib = ctypes.CDLL("./libwork.so")

# ✅ declare argtypes AND restype explicitly — defaults are wrong for pointers/size_t
lib.make_buffer.argtypes = [ctypes.c_size_t]
lib.make_buffer.restype  = ctypes.c_void_p   # NOT the default c_int (would truncate on 64-bit)

lib.free_buffer.argtypes = [ctypes.c_void_p]
lib.free_buffer.restype  = None

ptr = lib.make_buffer(4096)
try:
    pass  # use ptr
finally:
    lib.free_buffer(ptr)   # ✅ matching free on every path
```

Omitting `restype` here would truncate the returned pointer to 32 bits and corrupt it on a 64-bit platform.

---

## Best Practices

1. **One side owns each allocation; free with the matching allocator on every path.** Encode it in a wrapper type.
2. **Never hand-transcribe an ABI you can generate or check.** Use binding generators; where you must declare by hand, declare every type and test across value ranges.
3. **Never unwind a panic/exception across `extern "C"`.** `catch_unwind`/`catch(...)`/JNI exception checks; translate to the receiving language's error mechanism.
4. **Read `errno` on the line immediately after the failing call.**
5. **Know which thread every callback runs on;** attach/acquire, do minimal work, hand off to a runtime-owned thread.
6. **Release the GIL around blocking native calls; hold it whenever touching `PyObject`s.**
7. **Attach native threads to the JVM, exception-check, detach; never share a `JNIEnv`.**
8. **Bound JNI local refs; delete globals explicitly.**
9. **Serialize or partition non-thread-safe libraries.**
10. **Bridge cleanup explicitly** so RAII effectively crosses the boundary on all paths.
11. **Confine unsafe code to a thin, validated boundary; expose a safe API; minimize the surface.**
12. **Gate the boundary in CI under ASan/Valgrind/TSan/`-Xcheck:jni`/`cgocheck`/Miri.**
13. **Validate all crossing data as hostile; isolate untrusted/unstable native code out-of-process.**

---

## War Stories

These are the *shapes* of real production failures — studied defensively as failure modes to engineer against, never as exploit recipes.

**The pointer truncated by a missing `restype`.** A Python service used `ctypes` to call a C function returning a `char*`. No `restype` was set, so `ctypes` defaulted the return to `int` and truncated the 64-bit pointer to 32 bits. On the developer's machine, addresses happened to fit; in production, the high bits were non-zero and the dereference read garbage or crashed intermittently on certain allocations. The lesson burned into the team: **always set `restype` and `argtypes`, and test on the target's pointer width.** The fix was one line per function plus a test that exercised large return values.

**The panic that corrupted the C caller.** A Rust library exposed `extern "C"` functions to a C host. An input edge case triggered a `panic!` deep inside one export. Because the panic unwound across the C ABI, the behavior varied: a debug build aborted cleanly; an optimized release build corrupted the stack and crashed later in unrelated C code, producing a stack trace that pointed nowhere near the real bug. Days were lost chasing the phantom before someone recognized the pattern. The fix was a `catch_unwind` wrapper on every export and a lint that flagged any export without one. **Never let a panic leave an `extern "C"` function.**

**The buffer the GC collected mid-call.** A .NET integration marshalled a managed array to a long-running native call. Under low load it never failed; under production load the GC ran during the call, the source object had already become unreachable (the JIT had shortened its lifetime), the backing store was collected, and the native code wrote into freed memory — corrupting whatever was reallocated there. The crash was non-deterministic and load-correlated, the hardest kind to reproduce. The fix was pinning for the call window plus `GC.KeepAlive(buffer)` after the call. **A raw pointer into managed memory needs the GC pinned away for the entire native window.**

**The allocator that didn't match.** A binding received a buffer from a C library that used a custom arena allocator and freed it with the runtime's `free`. It "worked" for months because the corruption was benign until the heap layout shifted after an unrelated dependency bump, at which point it became random crashes in allocations that had nothing to do with the binding. The fix was to call the library's `lib_free`, encoded in a wrapper type so it could not be gotten wrong again. **Every allocation pairs with the deallocator from the same allocator.**

**The JNI reference leak that ate the heap.** A long-running JVM service created a JNI global reference per event in a native callback and never deleted them. Memory grew slowly over days until the service OOM-killed; because the growth was in native JNI tables, ordinary JVM heap dumps showed nothing and the leak was mis-attributed for a week. `-Xcheck:jni` in the test suite — added only after the incident — would have flagged the unbounded ref growth immediately. **Delete every JNI global ref you create; run `-Xcheck:jni` in CI.**

The common thread: every one of these was silent or intermittent, surfaced far from its cause, and was prevented by a single boundary discipline plus the right CI gate.

---

## Review Checklist

When you review an FFI binding, walk this list:

- **Ownership:** Is it documented who owns each pointer and when it is freed? Is each allocation freed with the matching allocator, exactly once, on every path including errors?
- **Lifetime:** Does any raw pointer point into managed memory? If so, is the object pinned (and `GC.KeepAlive`'d on .NET) for the whole native window?
- **ABI:** Are types generated or checked, not hand-transcribed? Are widths, signedness, struct layout, and calling convention correct? Is there a test across value ranges?
- **Errors:** Is every `extern "C"` export wrapped so no panic/exception unwinds out? Is `errno` read immediately? Are JNI exceptions checked-and-cleared after each throwing call?
- **Threading:** Is the thread of every callback known? Do foreign-thread callbacks attach/acquire and hand off? Is a non-thread-safe library serialized? Is the GIL released around blocking calls?
- **Resources:** Are native handles and JNI refs released on every path? Are JNI local refs bounded in loops?
- **Surface:** Is the unsafe code confined to one small, validated module exposing a safe API? Is the surface minimized?
- **Tooling:** Has it run under ASan/Valgrind, TSan, and the runtime checker (`-Xcheck:jni`/`cgocheck`/Miri)?
- **Security:** Is crossing data validated as hostile? Is untrusted/unstable native code isolated out-of-process?

---

## Summary

The professional owns the FFI boundary as a system. The hazard playbook has six classes. **Memory ownership and lifetime** is the silent corruptor: pair every allocation with its matching deallocator, encode single ownership in a wrapper that frees once on all paths, and pin (plus `GC.KeepAlive` on .NET) any object whose raw pointer crosses into native code. **Type and ABI mismatch** compiles then corrupts: generate or check the ABI rather than transcribing it, declare every type explicitly where you must (`ctypes` `restype`/`argtypes`), and test across value ranges. **Error handling** has one inviolable rule — never unwind a panic or exception across `extern "C"`; catch and translate at the boundary, check JNI exceptions, and read `errno` immediately. **Threading and reentrancy** produce the intermittent bugs: release the GIL around blocking calls, attach/detach native threads to the JVM without sharing a `JNIEnv`, know which thread each callback runs on and hand off, and serialize non-thread-safe libraries. **Resource leaks** drain long-running services: release every handle and JNI reference on every path because RAII does not cross the boundary. And **security** is the meta-hazard: a safe language inherits the unsafe one's bugs at the boundary, so validate all crossing data as hostile and isolate untrusted or unstable native code out-of-process.

Tying it together is the discipline: a thin, audited unsafe boundary that validates everything and exposes a safe API, with ownership encoded in types, the surface minimized, and the whole thing gated in CI under ASan, Valgrind, TSan, and the runtime's own checker. The war stories — the truncated pointer, the panic that corrupted the caller, the collected buffer, the mismatched allocator, the JNI ref leak — are exactly the failures this discipline and these gates prevent. Your leverage is not the cleverest binding; it is making the unsafe one impossible to ship.
