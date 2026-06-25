# FFI Safety & Pitfalls — Hands-On Tasks

> **Topic:** [FFI Safety & Pitfalls](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I can call a C
function from another language" to "I can reproduce, diagnose, and fix every
major class of FFI memory and safety bug under a sanitizer." The tasks build on
one another: the warm-ups rebuild the mental model of the boundary, the core
tasks reproduce real failure modes deliberately so you can recognize them, and
the advanced and capstone tasks have you design audited boundaries and contain
untrusted native code.

Every memory-safety task is **defensive**. You will reproduce crashes — an
allocator mismatch, a use-after-free from a collected buffer, a panic crossing
the boundary — *under a sanitizer*, in a minimal harness you control, and then
fix them. There are no weaponized exploits here; the point is to see the failure
shape clearly so you engineer against it. Run everything under AddressSanitizer
or Valgrind whenever the task involves native memory, and under the runtime's
own checker (`-Xcheck:jni`, `cgocheck`, Miri) when the task is runtime-specific.

How to use this file: read the task, write the code, run it under the named
tool, and only then read the hints. Tick the self-check boxes when you can
*explain the sanitizer output to someone else*, not when the program merely
runs. Sample solutions are sparse — they appear only where the canonical shape
is more instructive than your first attempt.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These short tasks rebuild the boundary mental model: ownership, ABI, and the
tools you will lean on for the rest of the file.

### Task 1: Build the harness and prove the tool works

**Problem.** Write a tiny C library (`lib.c`) with one function `int add(int, int)`
and call it from one host language of your choice (Rust `extern`, Python
`ctypes`, Go cgo, or Java JNI). Then deliberately write a one-line use-after-free
in a small C program and compile it with `-fsanitize=address`. Confirm ASan
prints a `heap-use-after-free` report.

**Constraints.**
- Keep the binding to a single function — this is about the toolchain, not logic.
- Build the C side with `-fsanitize=address -g`.
- If you cannot use ASan on your platform, use Valgrind (`valgrind ./prog`).

**Hints (try without first).**
- The ASan report names the access, the allocation, and the free, each with a
  stack. Read all three.
- `-g` is what gives you source lines instead of raw addresses.
- This task exists so that every later "run it under ASan" step just works.

**Self-check.**
- [ ] Your binding calls `add` and prints the right result.
- [ ] You produced and read a real ASan (or Valgrind) report.

---

### Task 2: A correct, paired allocation across the boundary

**Problem.** Extend `lib.c` with `char *make_msg(void)` that returns a
`malloc`'d, null-terminated string, and `void free_msg(char *)` that frees it.
From your host, call `make_msg`, use the string, and free it with `free_msg`
(not the host's allocator). Run under ASan/Valgrind and confirm zero leaks.

**Constraints.**
- The host must call `free_msg`, never its own free, on the returned pointer.
- Free on every path, including any error path you add.

**Hints (try without first).**
- This is the *correct* baseline you will deliberately break in Task 8.
- In `ctypes`, set `make_msg.restype = ctypes.c_void_p` and
  `free_msg.argtypes = [ctypes.c_void_p]`.
- LeakSanitizer (bundled with ASan) reports the leak if you forget the free.

**Self-check.**
- [ ] Zero leaks reported.
- [ ] You can state who owns the buffer and which function frees it.

---

### Task 3: Spot the ABI mismatch on paper

**Problem.** Given this C declaration:

```c
size_t buffer_size(const char *name);   /* returns a size_t */
```

write the *wrong* and the *right* `ctypes` declarations for it, and explain in a
sentence what goes wrong on a 64-bit platform with the wrong one.

**Constraints.**
- No running code required; reason it out.
- Then verify your reasoning by running both if you can.

**Hints (try without first).**
- `ctypes` defaults an unset `restype` to `int` (32-bit).
- A `size_t` is 64-bit on a 64-bit platform.
- The wrong version truncates the high 32 bits of the return.

**Self-check.**
- [ ] You wrote `buffer_size.restype = ctypes.c_size_t` as the fix.
- [ ] You can explain why small sizes "work" and large sizes corrupt.

---

### Task 4: Bridge cleanup with RAII / `defer` / `finally`

**Problem.** Wrap the `make_msg`/`free_msg` pair from Task 2 in your language's
automatic-cleanup mechanism so the buffer is freed even if an exception/panic/
early-return happens between acquire and use. (Rust `Drop`, Go `defer`, Java
`try-with-resources` or `finally`, Python `try/finally` or a context manager.)

**Constraints.**
- Add a path that returns early (or raises) after acquiring the buffer.
- Prove with ASan/Valgrind that the buffer is still freed on that path.

**Hints (try without first).**
- RAII does not cross the boundary by itself — you are *building* the bridge.
- A wrapper whose destructor calls `free_msg` is the canonical shape.
- The early-return path is the one that leaks if you got it wrong.

**Self-check.**
- [ ] Both the normal and the early-return path report zero leaks.

---

## Core

These tasks reproduce real FFI failure modes deliberately, under a sanitizer,
then fix them. This is the heart of the file.

### Task 5: Reproduce an allocator mismatch under ASan, then fix it

**Problem.** In a small C library, allocate a buffer through a *custom*
allocator (a simple bump/arena allocator you write, or just `malloc` from a
function named `lib_alloc` paired with `lib_free`). From the host, free the
returned pointer with the *wrong* deallocator (the host runtime's free or plain
`free` when the library expected `lib_free`). Run under ASan and observe the
corruption/mismatch report. Then fix it by calling the matching `lib_free`,
encoded in a wrapper type so it cannot be gotten wrong again.

**Constraints.**
- The allocation and the (wrong) free must use mismatched allocators.
- Reproduce the failure *under ASan or Valgrind* — do not rely on a "lucky"
  silent run.
- The fix must encode the matching free in a type/wrapper, not just a comment.

**Hints (try without first).**
- ASan flags `alloc-dealloc-mismatch` for `malloc`/`delete`-style mismatches; a
  custom-allocator mismatch may surface as heap corruption — Valgrind's
  `Mismatched free()` is also useful.
- The mismatch can be *benign* on a given run; the sanitizer is what makes it
  reliably visible. That is the lesson.
- Encode ownership: a non-copyable wrapper whose destructor calls `lib_free`.

**Self-check.**
- [ ] You produced a real sanitizer report for the mismatch.
- [ ] Your fixed version pairs every allocation with `lib_free` on every path.
- [ ] A caller of your wrapper cannot reintroduce the mismatch.

**Sample Solution (the fix, in Rust).**

```rust
mod ffi {
    use std::os::raw::c_char;
    extern "C" {
        pub fn lib_alloc(n: usize) -> *mut c_char;
        pub fn lib_free(p: *mut c_char);   // the MATCHING deallocator
    }
}

pub struct LibBuf(*mut std::os::raw::c_char);

impl LibBuf {
    pub fn new(n: usize) -> Option<Self> {
        let p = unsafe { ffi::lib_alloc(n) };
        if p.is_null() { None } else { Some(LibBuf(p)) }
    }
}

impl Drop for LibBuf {
    fn drop(&mut self) {
        unsafe { ffi::lib_free(self.0) }   // ✅ matching free, exactly once
    }
}
```

---

### Task 6: Catch a panic / exception at the boundary

**Problem.** Write a Rust `extern "C"` function (or a C++ C-linkage function)
whose body can panic (or throw) on a specific input. Call it from a C `main`.
First observe the unsafe version (the panic/exception attempts to unwind across
the boundary). Then fix it: wrap the body in `catch_unwind` (Rust) or
`try { ... } catch (...) { return error; }` (C++) and convert the failure into
an error return code.

**Constraints.**
- The host caller is plain C with no unwinding support.
- The fixed version must never let an unwind leave the function.
- Return a documented error code on the failure path.

**Hints (try without first).**
- In recent Rust an unwind across `extern "C"` aborts rather than being pure UB,
  but you should still catch and convert — an abort is still a crash.
- A crash whose stack trace points into unrelated C code is the signature of an
  unwind that corrupted the C stack.
- `AssertUnwindSafe` is usually needed to satisfy `catch_unwind`'s bound.

**Self-check.**
- [ ] The unsafe version aborts/corrupts; the fixed version returns an error code.
- [ ] You can explain why unwinding across `extern "C"` is undefined behavior.

**Sample Solution (Rust fix).**

```rust
use std::panic::{catch_unwind, AssertUnwindSafe};

#[no_mangle]
pub extern "C" fn parse_or_panic(x: i32) -> i32 {
    let r = catch_unwind(AssertUnwindSafe(|| {
        if x < 0 { panic!("negative not allowed"); }
        x * 2
    }));
    match r {
        Ok(v)  => v,
        Err(_) => -1,   // ✅ panic translated to an error code; no unwind escapes
    }
}
```

---

### Task 7: errno discipline

**Problem.** Write (or use) a C function that fails and sets `errno` (e.g. open a
nonexistent file). Call it from your host and demonstrate the *wrong* pattern:
do some work (logging, an allocation, another call) between the failing call and
reading `errno`, and show the error value is now wrong. Then fix it by reading
`errno` on the line immediately after the call.

**Constraints.**
- Show a concrete case where the intervening work corrupts `errno`.
- The fix reads `errno` (e.g. `std::io::Error::last_os_error()`) immediately.

**Hints (try without first).**
- Almost any libc call may set `errno`; even ones your runtime makes invisibly.
- The reliable repro is to call something that succeeds (and resets `errno`)
  between the failing call and your read.
- Set `errno = 0` before calls whose API requires it.

**Self-check.**
- [ ] You demonstrated a wrong `errno` from intervening work.
- [ ] Your fixed version reports the correct error.

---

### Task 8: Demonstrate a GC-moved/collected buffer bug, then fix it with pinning / KeepAlive

**Problem.** In a managed language (.NET preferred for the clearest repro; JNI is
also fine), pass a pointer to a managed buffer into a native function that holds
the pointer across work during which the GC runs. Arrange for the source object
to become collectible (or for the heap to compact), so the native code sees moved
or freed memory. Observe the corruption. Then fix it: pin the buffer for the
native window and, on .NET, add `GC.KeepAlive` after the call.

**Constraints.**
- Force a GC during the native call (`GC.Collect()` from another thread on .NET,
  or allocate heavily) to make the bug reliable.
- Reproduce under the runtime's diagnostics where possible; do not rely on a
  lucky silent run.
- The fix must pin for the *whole* native window and keep it short.

**Hints (try without first).**
- On .NET the JIT may shorten an object's lifetime so it is collectible *before*
  the native call returns — `GC.KeepAlive(buf)` after the call prevents that.
- `GCHandle.Alloc(buf, GCHandleType.Pinned)` stops the GC from moving it; free
  the handle in a `finally`.
- On JNI, `GetPrimitiveArrayCritical`/`ReleasePrimitiveArrayCritical` give a
  pinned window; keep the critical section tiny.

**Self-check.**
- [ ] You reproduced corruption from a GC running during the native call.
- [ ] The pinned + `KeepAlive` version is correct under a forced GC.
- [ ] You can explain why the pin window must be short (heap fragmentation).

**Sample Solution (the .NET fix).**

```csharp
byte[] buf = GetManagedBuffer();
GCHandle h = GCHandle.Alloc(buf, GCHandleType.Pinned); // ✅ no move during the window
try {
    Native.Process(h.AddrOfPinnedObject(), buf.Length);
}
finally {
    h.Free();                                          // ✅ unpin on every path
}
GC.KeepAlive(buf);                                     // ✅ reachable across the call
```

---

### Task 9: Audit and fix a wrong `ctypes` `restype`

**Problem.** You are given (write it yourself) a Python `ctypes` binding to a C
function `void *make_buffer(size_t n)` and `void free_buffer(void *p)` where the
binding *omits* `restype` and `argtypes`. Reproduce the failure (corrupted
pointer, crash on free) by allocating a buffer large enough that its address has
non-zero high bits — or simply observe that `free_buffer` receives a truncated
pointer. Then fix the declarations and confirm correctness under Valgrind.

**Constraints.**
- Start from the buggy binding (no `restype`/`argtypes`).
- Demonstrate the truncation, not just assert it.
- The fix sets `restype = c_void_p` and full `argtypes`.

**Hints (try without first).**
- Print `hex(ptr)` from both the buggy and fixed bindings to see the high bits
  vanish in the buggy one.
- The crash may be intermittent because it depends on where the allocator places
  the buffer — which is exactly why it is dangerous.
- Run the program under Valgrind to catch the invalid free in the buggy version.

**Self-check.**
- [ ] You observed a truncated pointer in the buggy binding.
- [ ] The fixed binding round-trips the pointer correctly with zero Valgrind
  errors.

---

### Task 10: A JNI local-reference leak (and the fix)

**Problem.** Write a JNI native method that, in a loop, creates many Java objects
(e.g. `NewStringUTF` in a loop of 100,000) without deleting the local references.
Run with `-Xcheck:jni` and observe the warning / ref-table growth. Then fix it
with `PushLocalFrame`/`PopLocalFrame` (or explicit `DeleteLocalRef`).

**Constraints.**
- Run the JVM with `-Xcheck:jni`.
- The loop must create enough refs to surface the table pressure.
- The fix must bound the local-reference table.

**Hints (try without first).**
- The local-reference table has a limit; a long loop without frames overruns it.
- `-Xcheck:jni` warns about excessive local references before the hard crash.
- `PushLocalFrame(env, 16)` ... `PopLocalFrame(env, NULL)` per iteration frees
  that iteration's locals.

**Self-check.**
- [ ] `-Xcheck:jni` flagged the leak in the buggy version.
- [ ] The framed version runs clean.

---

## Advanced

By now you can reproduce and fix the core hazards individually. The advanced
track is about building an audited boundary and reasoning about threading.

### Task 11: Wrap an unsafe C API in a safe Rust facade

**Problem.** Given a small C library that exposes an opaque object with
create/use/destroy functions (write one: a "counter" with `counter_new`,
`counter_add`, `counter_get`, `counter_free`), build a safe Rust facade. All
`unsafe` and `extern` live in one module; the public type owns the handle, frees
once on `Drop`, validates inputs, and exposes only safe types. A caller must not
be able to double-free, use-after-free, or trigger UB.

**Constraints.**
- The entire `unsafe` surface is one small module.
- The public type is non-copyable and frees exactly once.
- Run the result under Miri and ASan.

**Hints (try without first).**
- An opaque `enum Counter {}` (uninhabited) as the C type means Rust never looks
  inside the struct.
- `Drop` calls `counter_free`; because the type is not `Copy` and owns the
  pointer, double-free is structurally impossible.
- Null-check every pointer the C side returns before wrapping it.

**Self-check.**
- [ ] The public API exposes no raw pointers.
- [ ] Miri and ASan are clean.
- [ ] You can argue, in one paragraph, why a caller cannot cause UB.

**Sample Solution (skeleton).**

```rust
mod ffi {
    pub enum Counter {}                       // opaque
    extern "C" {
        pub fn counter_new() -> *mut Counter;
        pub fn counter_add(c: *mut Counter, n: i64);
        pub fn counter_get(c: *const Counter) -> i64;
        pub fn counter_free(c: *mut Counter);
    }
}

pub struct Counter(*mut ffi::Counter);        // owns the handle, not Copy

impl Counter {
    pub fn new() -> Option<Self> {
        let p = unsafe { ffi::counter_new() };
        if p.is_null() { None } else { Some(Counter(p)) }
    }
    pub fn add(&mut self, n: i64) { unsafe { ffi::counter_add(self.0, n) } }
    pub fn get(&self) -> i64 { unsafe { ffi::counter_get(self.0) } }
}

impl Drop for Counter {
    fn drop(&mut self) { unsafe { ffi::counter_free(self.0) } }  // ✅ once, on all paths
}
```

---

### Task 12: Serialize a non-thread-safe C library

**Problem.** Take the `counter` library from Task 11 and assume it is *not*
thread-safe (it keeps global state). Drive it from multiple threads in your host
and reproduce corruption (wrong final total) under TSan. Then fix it by
serializing access with a lock in the safe wrapper, and confirm TSan is clean.

**Constraints.**
- Reproduce the corruption under ThreadSanitizer before fixing.
- The fix serializes all access to the library through one lock.
- The final total must be correct after the fix.

**Hints (try without first).**
- A `Mutex` around every call is the simplest correct fix; per-thread contexts
  are the higher-throughput alternative if the library supports them.
- TSan may not flag the C-internal race if the library is opaque — observe the
  wrong total as the symptom, and reason about why serialization fixes it.
- Document in the wrapper that the library is non-reentrant.

**Self-check.**
- [ ] You reproduced an incorrect total under concurrency.
- [ ] The serialized version produces the correct total.

---

### Task 13: A foreign-thread callback done correctly (JNI)

**Problem.** Write a C library that invokes a registered callback from a thread
*it* creates (use `pthread_create`). Have the callback need to call a Java
method. First write it incorrectly (use a `JNIEnv` cached from the registering
thread) and observe the crash under `-Xcheck:jni`. Then fix it: attach the
foreign thread, check exceptions, do minimal work, detach.

**Constraints.**
- The callback fires on a thread the JVM did not create.
- Run under `-Xcheck:jni`.
- The fix attaches, exception-checks, and detaches.

**Hints (try without first).**
- A `JNIEnv*` is per-thread; reusing one from another thread is UB and
  `-Xcheck:jni` will say so.
- `AttachCurrentThread` gives the foreign thread a valid `JNIEnv`.
- Do minimal work in the callback; for real systems, hand off to a JVM-owned
  thread (an executor) rather than doing heavy work on the foreign thread.

**Self-check.**
- [ ] The buggy version is flagged by `-Xcheck:jni`.
- [ ] The fixed version attaches, checks exceptions, and detaches cleanly.

---

## Capstone

The capstones are open-ended and production-shaped. Each should take a few days;
the "What done looks like" paragraph replaces the self-check.

### Task 14: A fully audited binding to a real C library

**Problem.** Pick a small, real C library (e.g. a compression or hashing library)
and write a complete, audited binding in your language of choice. The binding
must confine all unsafe code to one module, validate every input at the
boundary, translate every error into a native error type, never let an unwind
cross `extern "C"`, free every resource on every path, and expose a safe,
idiomatic API.

**What done looks like.** A library where the unsafe surface is small enough to
review in one sitting, every public function is safe to call with any input
without UB, and a test suite runs under ASan (and Valgrind on the opaque
library), plus the runtime checker (Miri / `-Xcheck:jni` / `cgocheck`) in CI.
You have a written contract for each unsafe function (its precondition), a
value-range test that would catch a wrong-width ABI bug, and a one-page note
explaining the ownership model. You can hand the binding to a colleague and they
cannot cause memory corruption through the public API.

---

### Task 15: Out-of-process isolation for an untrusted native parser (defensive)

**Problem.** Take a C parser of untrusted input (a toy format you write is fine —
the point is the architecture, not the parser) and run it out-of-process. The
parent process sends input to a worker over a pipe or socket; the worker parses
and returns the result; if the worker crashes, the parent detects it, restarts
the worker, and fails only that request.

**What done looks like.** A supervisor that spawns a worker process, streams a
request to it, and reads a response with a timeout. When you deliberately feed
the worker an input that makes the parser crash (a defensive fault you inject —
no real exploit needed), the parent observes the closed pipe / non-zero exit,
logs it, respawns the worker, and the *next* request succeeds — the parent never
crashes. Bonus: sandbox the worker (seccomp on Linux, or at least a resource
limit and a restricted working directory) and document what a compromised worker
could and could not do. You can articulate the trade-off — IPC overhead and
supervision complexity in exchange for a bounded blast radius — and when it is
the right call (untrusted or unstable native code in a shared service) versus
overkill (a stable library you audited and control).

---

### Task 16: An FFI hazard checklist and CI gate for a team

**Problem.** Write a reusable review checklist and CI configuration that a team
could adopt for every FFI binding in a repository. It must cover all six hazard
classes (ownership/lifetime, ABI, error handling, threading, resource leaks,
security) and wire up the tools that catch what review misses.

**What done looks like.** A checklist a reviewer can walk in ten minutes
(ownership documented and paired; lifetime pinned where managed memory crosses;
ABI generated or checked plus a value-range test; no unwind across `extern "C"`,
`errno` read immediately, JNI exceptions checked; callbacks' threads known,
non-thread-safe libraries serialized, GIL released around blocking calls;
handles and refs freed on all paths; crossing data validated, untrusted code
isolated). A CI config that runs the suite under ASan + LeakSanitizer, TSan, and
the runtime checker (`-Xcheck:jni` / `go test -race` + `cgocheck` / Miri), all as
*required* checks. You can explain, for each checklist item, which tool or test
backs it — so the checklist is enforced, not aspirational.
