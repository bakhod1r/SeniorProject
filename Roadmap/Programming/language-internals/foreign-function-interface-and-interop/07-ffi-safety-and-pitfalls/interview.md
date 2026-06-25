# FFI Safety & Pitfalls — Interview Questions

> **Topic:** [FFI Safety & Pitfalls](README.md)

---

## Introduction

These questions probe whether a candidate can be trusted to design, review, and own an FFI boundary — the seam where a managed, memory-safe language calls into native, unsafe code (or vice versa). The boundary is where guarantees end: the type checker stops checking, the garbage collector stops protecting, exceptions stop unwinding cleanly, and attacker-controlled data meets code with no memory safety. A strong candidate does not just know "FFI is dangerous"; they can name the specific hazard classes, explain the exact mechanism of each, and state the defense and the tool that catches it.

The discriminator between a mid-level and a senior answer here is *specificity*. "Be careful with memory" is weak. "The C library allocated this with its arena allocator, so I must free it with the library's free, not the runtime's, or I corrupt the heap — and I encode that in a wrapper type so a caller cannot get it wrong" is strong. The questions below progress from conceptual foundations, through language-specific surfaces (Rust, JNI, cgo, `ctypes`, .NET), into the tricky traps where the obvious answer is wrong, and finally into design scenarios that reveal whether the candidate has actually owned a boundary in production.

All security content here is **defensive**: the goal is to engineer against failure shapes, never to weaponize them.

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

### Question 1: What guarantees do you lose when you cross an FFI boundary?

All of the ones your safe language provides at exactly the point where data crosses. The type system stops verifying — the C side may interpret the bytes differently than you declared. The garbage collector stops protecting — it may move or collect an object a raw pointer still references. Bounds checking is gone. Exception/panic unwinding has no meaning across the C ABI. And memory safety as a whole becomes the responsibility of hand-written, manually-verified code rather than the compiler. The boundary is a hole in every guarantee, which is why the discipline is to make that hole small, validated, and auditable.

### Question 2: Name the major hazard classes of FFI.

Memory ownership and lifetime (allocator mismatch, double-free, dangling pointers, GC moving or collecting a buffer in use); type and ABI mismatch (wrong width, signedness, struct layout, calling convention — code that "compiles then corrupts"); error handling across the boundary (unwinding a panic/exception across `extern "C"`, `errno` discipline); threading and reentrancy (GIL, JNI attach/detach, callbacks on the wrong thread, non-thread-safe libraries); resource leaks (handles, JNI references); and security (a safe language inheriting the unsafe one's memory-safety bugs at the boundary).

### Question 3: Why is a type/ABI mismatch described as "compiles, then corrupts"?

Because the source-level declaration and the binary contract are separate. A binding can declare a function signature that the compiler accepts and the linker resolves, yet describe the wrong *binary* contract — wrong integer width, wrong signedness, wrong struct padding, wrong calling convention. There is no runtime check; the code runs and reads or writes the wrong bytes, corrupting data or the stack silently. The symptom appears far from the cause and often only for certain input values, which is why it is so hard to debug.

### Question 4: What is an allocator mismatch and why is it undefined behavior?

Memory must be freed by the deallocator paired with the allocator that produced it. An allocator tracks its allocations in its own metadata (free lists, size classes, arenas). Handing a pointer from allocator A to allocator B's free corrupts B's metadata — B tries to reclaim a block it never tracked. Across FFI this happens when C `malloc`'d memory is freed by the runtime, when runtime memory is `free`'d by C, or when a library's custom allocator's output is freed with plain `free`. The defense: document and encode that each allocation is freed by its matching deallocator, on every path.

### Question 5: Why must you never let a panic or exception unwind across an `extern "C"` boundary?

The C ABI has no concept of stack unwinding. When a Rust panic or C++ exception propagates out of a C-linkage function into a C caller, the behavior is undefined — it ranges from an immediate abort to silent stack corruption that varies by compiler, optimization level, and platform. You must stop it at the boundary: `catch_unwind` in Rust, `catch (...)` in C++, and convert the failure into an error return code that C understands. The boundary is where you translate the sending language's error mechanism into the receiving language's.

### Question 6: What is `errno` discipline?

`errno` is a per-thread global that a failing C call sets, and it is only meaningful *immediately* after that call — almost any intervening call, including invisible ones your runtime makes, may overwrite it. The discipline: read `errno` on the very next line after the call, before doing anything else (and set `errno = 0` first if the API specifies that). Marshalling, logging, or allocation between the call and the read silently destroys the error value.

### Question 7: How can the garbage collector break a native call?

Two ways. A *moving/compacting* GC may relocate an object to defragment the heap; any raw pointer native code holds into that object now dangles. A GC may *collect* an object it judges unreachable; if native code still holds a pointer into it, the backing store is freed mid-call. Both are timing-dependent — they only fire when the GC actually runs, i.e. under load, i.e. in production. The defenses are pinning (tell the GC not to move/collect for the window) and, on .NET, `GC.KeepAlive` to stop the JIT from shortening an object's lifetime below the native use.

### Question 8: What is the security implication of linking native code into a memory-safe language?

The safe language does not extend its guarantees over the native code. A buffer overflow, integer overflow, or use-after-free in the C library is fully present and exploitable, and the FFI call is the point where attacker-controlled data reaches it. Your safe runtime is a thin shell over an unsafe core. Defensively: validate all crossing data as hostile, assume native parsers of untrusted input are vulnerable, track the native dependency's CVEs as your own, and isolate untrusted or unstable native code out-of-process.

### Question 9: Describe the "thin, audited boundary" discipline.

Confine every unsafe operation — raw pointers, manual frees, casts, FFI declarations, panic-catching — to one small module. Validate everything crossing it as hostile. Above it, expose a safe API of ordinary types and idiomatic errors so callers structurally cannot trigger UB. Encode ownership in types (a non-copyable wrapper that frees once on destruction). Document each unsafe function's precondition. Minimize the surface. The result: the dangerous code is small enough to prove correct and rarely changes; the safe code is large and cannot misuse the boundary.

### Question 10: Why are FFI bugs so often intermittent?

Because the worst classes depend on timing and state that vary between runs. A GC-collected buffer only fails when the GC happens to run during the call. A threading/reentrancy bug only fires on a particular interleaving. A wrong-width ABI bug only corrupts for input values large enough to overflow the declared type. An allocator mismatch may be benign until an unrelated change shifts the heap layout. Green tests prove little; you need sanitizers, stress, and value-range tests to surface these.

### Question 11: Which tools catch which FFI hazards?

ASan catches buffer overflows, use-after-free, double-free, and some allocator mismatches; LeakSanitizer catches leaks. Valgrind catches uninitialized reads and invalid frees without recompiling. TSan catches data races across the threading hazards. `-Xcheck:jni` catches bad references, calls with pending exceptions, wrong-thread `JNIEnv` use, and ref-table overflow. `GODEBUG=cgocheck` enforces cgo pointer rules; `go test -race` catches cgo races. Miri detects UB in Rust unsafe/FFI shims. Fuzzing the validation layer confirms it rejects malformed input.

### Question 12: What does it mean that "RAII does not cross the boundary"?

Automatic cleanup — Rust `Drop`, C++ destructors, `try-with-resources`, Python `__del__` — runs based on *your* language's control flow. While control is on the C side, your destructors do not run, and while control is on your side, C's cleanup does not run. So a native resource acquired through FFI is not cleaned up by your normal scope exit unless you explicitly bridge it: a wrapper object whose destructor calls the C free function, registered to run on the error path too.

---

## Language-Specific

### Question 13 (Rust): How do you write a sound `extern "C"` export in Rust?

Wrap the body in `catch_unwind` so no panic unwinds into C, converting a caught panic into an error code. Validate all pointer arguments (null-check, document the safety contract for length/validity). Use `#[no_mangle]` and the C ABI. Never return a Rust-owned pointer to C without documenting who frees it and exposing a matching free function. Keep the export thin — it should validate and delegate to safe Rust, not contain logic. Test under Miri and ASan.

### Question 14 (Rust): What is the role of the `unsafe` keyword at an FFI boundary, and what does it *not* do?

`unsafe` marks code where the compiler cannot verify memory safety and the programmer asserts the invariants hold — calling FFI functions, dereferencing raw pointers, transmuting. It does *not* turn off the borrow checker for safe code, and it does *not* make the operation safe; it shifts the proof obligation to you. The discipline is to keep `unsafe` blocks small, document the invariant each one relies on, and wrap them in a safe API so callers never write `unsafe` themselves.

### Question 15 (Java/JNI): What are the lifecycle rules for a native thread that wants to call into Java?

A thread the JVM did not create has no valid `JNIEnv`. It must call `AttachCurrentThread` to get one before any JNI call, and `DetachCurrentThread` before it exits. The `JNIEnv*` is per-thread and must never be cached and reused on another thread. Forgetting to attach crashes; forgetting to detach leaks or can block JVM shutdown.

### Question 16 (Java/JNI): Explain JNI local versus global references and how each leaks.

A local reference is valid only within the current native call on the current thread and is freed when the native method returns; but it counts against a limited table, so a long loop creating many objects without `DeleteLocalRef` or a `PushLocalFrame`/`PopLocalFrame` exhausts the table and crashes. A global reference survives across calls and threads but must be explicitly `DeleteGlobalRef`'d — allocating them (e.g. one per event in a callback) without deleting leaks memory in native JNI tables until the service OOMs, often invisible to ordinary heap dumps.

### Question 17 (Java/JNI): Why must you check for exceptions after JNI calls?

A Java exception thrown during a JNI call does not interrupt your C code — it is recorded as *pending* and sits there until you return to the JVM. Making any further JNI call (other than a few exception-handling ones) while an exception is pending is undefined behavior. So after every call that can throw, you `ExceptionCheck`/`ExceptionOccurred`, then either `ExceptionClear` and handle it in native code, or return promptly so the JVM throws it.

### Question 18 (Go/cgo): What is the cgo pointer-passing rule and why does it exist?

Go code may pass a Go pointer to C, but the C code must not store it past the call's return, and you may not pass a Go pointer that *points to* memory containing other Go pointers. The reason: Go's garbage collector can move and reclaim Go memory and cannot track pointers held by C. Passing pointer-to-Go-pointers would hide live references from the collector. The rules are enforced by `cgocheck`; violating them is a hard error, not a style issue.

### Question 19 (Go/cgo): What are the threading and performance implications of a cgo call?

A cgo call occupies its OS thread for the duration of the call; the Go scheduler cannot preempt code running in C. A flood of blocking cgo calls can therefore consume OS threads and stall the runtime. cgo calls also have meaningful per-call overhead (stack switching, scheduler bookkeeping), so chatty FFI is slow — batch where possible. And C must be treated as potentially non-thread-safe; serialize access if it is.

### Question 20 (Python/ctypes): What are the classic `ctypes` traps?

Omitting `restype`: `ctypes` defaults the return to `int`, so a function returning a pointer or `size_t` gets truncated to 32 bits on a 64-bit platform — the pointer is corrupted. Omitting `argtypes`: `ctypes` guesses argument marshalling, which can pass the wrong representation. Forgetting that strings/buffers passed to C must outlive the call (a temporary can be collected). And mismatched struct field types/packing. The fix is to declare `restype` and `argtypes` for every function and define structures with explicit `_fields_` and `_pack_` where needed.

### Question 21 (Python): What is the GIL's role in FFI, and what are the two rules?

The GIL allows only one thread to execute Python bytecode at a time. Rule one: release it around blocking or long native calls (`Py_BEGIN_ALLOW_THREADS`/`Py_END_ALLOW_THREADS`; `ctypes` does this by default), or you freeze every other Python thread and risk deadlock if the native code calls back into Python. Rule two: never touch a `PyObject` without holding the GIL — reacquire (`PyGILState_Ensure`) before any object access, including from a thread C created, or you corrupt the interpreter (refcounts are not safe without it).

### Question 22 (.NET): How does marshalling go wrong, and what do pinning and `GC.KeepAlive` fix?

P/Invoke marshalling copies or pins managed data for native calls. It goes wrong when a raw pointer to managed memory outlives the marshalling window, or when the source object becomes unreachable before the native call returns and the JIT shortens its lifetime — the GC then moves or collects the backing store mid-call. Pinning (`GCHandle.Alloc(obj, Pinned)` or `fixed`) stops the GC from moving the object for the window; `GC.KeepAlive(obj)` placed *after* the native call forces the object to stay reachable across it. Use both for a long native call holding a managed pointer.

### Question 23 (.NET): Why keep pinning windows short?

A pinned object cannot be moved, so the GC cannot compact around it. Many long-lived pins fragment the managed heap, defeating the compacting collector and degrading allocation performance over time. Pin for the shortest possible window — ideally just the native call — and unpin in a `finally` so it is released on every path.

### Question 24 (Cross-language): How do you return ownership of a heap allocation from C to a managed caller safely?

Document explicitly who frees it and expose the matching free function. The managed wrapper takes ownership in a type whose destructor calls that free exactly once on every path. Never assume the managed runtime's collector will free C-allocated memory — it will not, and freeing C memory with the runtime's allocator is an allocator mismatch. The cleanest pattern is opaque handles: C owns the object, hands the caller an opaque pointer, and exposes create/use/destroy functions the wrapper drives.

---

## Tricky / Trap

### Question 25: "It works on my machine and in CI, so the binding is correct." What is wrong with this?

FFI's worst bugs are intermittent and environment-dependent. A wrong-width ABI bug corrupts only for large input values; a GC-collected-buffer bug fires only when the GC runs under load; an allocator mismatch is benign until the heap layout shifts; a threading bug needs a specific interleaving. Passing tests prove the easy paths work, not that the boundary is sound. You need ASan/Valgrind, the runtime checker, value-range tests, and stress before you trust it.

### Question 26: A `ctypes` call returns a pointer and works in tests but crashes randomly in production. What is the first thing you check?

Whether `restype` is set. With no `restype`, `ctypes` truncates the returned pointer to a 32-bit `int`; addresses that fit in 32 bits work, addresses with non-zero high bits become corrupted pointers. In tests, allocations may land low; in production under memory pressure they do not. Set `restype = ctypes.c_void_p` (or the proper pointer type) and `argtypes`, then test with large allocations.

### Question 27: "I'll just `free()` whatever pointer the library gives me." Why is this dangerous?

If the library allocated it with anything other than the standard `malloc`/`free` you are calling — a custom arena, a different C runtime (a real hazard on Windows where each DLL can link its own CRT), or a pool — your `free` corrupts an allocator that never tracked the block. You must call the library's documented free function. Never assume the allocator; read the API contract.

### Question 28: Your Rust library exports `extern "C"` functions and crashes deep in the C host with a meaningless stack trace. What class of bug should you suspect?

A panic unwinding across the `extern "C"` boundary. The panic corrupts the C stack and the crash surfaces later in unrelated C code, so the trace points nowhere near the cause. Audit every export for a `catch_unwind` wrapper; an export that can panic without catching is the prime suspect.

### Question 29: A JNI callback fires and your code reads a Java field fine, but the JVM crashes intermittently when the callback runs. What do you check?

Which thread the callback runs on. If the native library delivers the callback on its own thread (not a JVM thread), that thread has no valid `JNIEnv` and any JNI call is undefined behavior. The fix is to `AttachCurrentThread` at the start of the callback, do minimal work, detach (or use a long-lived attached thread), and never reuse a cached `JNIEnv` from another thread.

### Question 30: A colleague says "we're in Rust, so this C parsing library is memory-safe now." Correct them.

Linking C into Rust does not extend Rust's safety over the C code. Any memory-safety bug in the C parser — overflow, use-after-free — is fully present and exploitable, and the FFI call is where untrusted input reaches it. Rust protects the Rust code, not the linked C. For untrusted input the right move is to validate at the boundary and, if the parser is untrusted or unstable, isolate it out-of-process.

### Question 31: "The GIL means I don't need locks in my C extension." True or false?

False in general. The GIL serializes Python *bytecode*, but a well-written extension releases the GIL around blocking work — during which other threads run — and any C-level shared state touched there needs its own synchronization. Also, the moment you reacquire to touch `PyObject`s you must hold the GIL, but C-only data races are not covered by it. Do not rely on the GIL for C-level mutual exclusion you actually need.

### Question 32: A binding passes ASan but still corrupts memory under real load. What might ASan have missed?

ASan instruments the code compiled with it. If the native library is an opaque prebuilt binary not compiled with ASan, corruption inside it can be invisible. ASan also does not catch data races (that is TSan), GC-interaction bugs in the managed runtime, or logic errors that produce wrong-but-valid frees. Run TSan for races, `-Xcheck:jni`/`cgocheck` for runtime-specific hazards, Valgrind on the opaque binary, and stress under the real workload.

---

## Design

### Question 33: Design a safe Rust wrapper around an unsafe C library that parses untrusted input.

Confine all FFI declarations and `unsafe` to one module. Above it, an owning handle type wraps the C object; `new` validates input (length, non-empty, well-formedness) before calling C and null-checks the returned pointer; methods take `&self` and translate C error codes into a Rust `Result`; `Drop` calls the C free exactly once. Every export-facing function that C might call back into is wrapped in `catch_unwind`. Because the input is untrusted, validate aggressively at the boundary and run the parser out-of-process (or at least fuzz it under ASan), so a memory-safety bug in the C parser cannot compromise the host. Gate the crate in CI under Miri and ASan.

### Question 34: You must integrate a flaky, closed-source native codec into a multi-tenant service. How do you contain it?

Run it out-of-process. Each codec invocation goes to a worker process over a pipe or socket; the parent supervises it. When the codec segfaults or hangs, the parent sees a closed pipe or a timeout, kills and respawns the worker, and fails just that request — the other tenants are untouched. Sandbox the worker (seccomp to restrict syscalls, resource limits, read-only filesystem) so even a compromise is contained. You trade IPC overhead and supervision complexity for a bounded blast radius, which is the correct trade for untrusted/unstable native code in a shared service.

### Question 35: Design the CI gates for a repository that contains FFI bindings.

Compile and run the test suite under AddressSanitizer (with LeakSanitizer) for memory corruption and leaks; under ThreadSanitizer for races at the boundary. For JNI code, run tests with `-Xcheck:jni`. For cgo, run `go test -race` and set `GODEBUG=cgocheck=2`. For Rust unsafe/FFI shims, run Miri. Add value-range tests that exercise small, large, negative, zero, and boundary inputs to surface wrong-width ABI bugs. Fuzz the validation layer defensively. Make all of these required checks, so no binding merges without having run under the tools that catch what review misses.

### Question 36: How would you review an FFI binding to convince yourself it has no undefined behavior?

Walk the hazard checklist. Ownership: is each allocation freed with the matching allocator, once, on every path? Lifetime: does any raw pointer point into managed memory, and is it pinned/`KeepAlive`'d for the whole window? ABI: are types generated or checked, with a value-range test? Errors: is every `extern "C"` export guarded against unwinding, is `errno` read immediately, are JNI exceptions checked? Threading: is each callback's thread known and handled, non-thread-safe libraries serialized, the GIL released around blocking calls? Resources: are handles and JNI refs released on all paths? Surface: is unsafe code confined and minimized? Tooling: has it run under ASan/TSan/the runtime checker? If any answer is "I assumed it was fine," that is the bug.
