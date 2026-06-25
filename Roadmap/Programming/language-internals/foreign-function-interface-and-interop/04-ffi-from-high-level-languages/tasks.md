# FFI from High-Level Languages — Hands-On Tasks

> **Topic:** [FFI from High-Level Languages](README.md)

---

## Introduction

This file takes you from "I can copy a `ctypes` snippet" to "I can build a
correct, well-behaved binding across Python, Rust, Go, Java, and Node, and I
know exactly which runtime guarantee I am surrendering at each call." Every
task is small enough for one or two focused sessions, and they build on one
another: the early tasks make a real C function callable; the later ones
confront the hazards that only appear under threading, garbage collection,
and load.

How to use this file: read the task, write the code, *run it* — and wherever
the task involves memory or threads, run it under a sanitizer (ASan,
Valgrind) or the runtime's race detector. Only then read the hints. Mark a
self-check box when you can *explain* the result to someone else, not when the
program merely compiles. The sample solutions are deliberately sparse: they
appear only where the canonical shape is more instructive than your first
attempt would be. You will need a C compiler (`cc`/`clang`/`gcc`) for almost
every task.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These tasks establish the mechanics of a single downcall in each major
runtime. They are short, but each one introduces a binding mechanism you will
reuse for the rest of the file.

### Task 1: Call a real C function from Python with ctypes

**Problem.** Without writing any C of your own, call the C standard library's
`cos` from Python via `ctypes`. Load libm (`ctypes.CDLL("libm.so.6")` on
Linux, `ctypes.CDLL("libc.dylib")` or `ctypes.util.find_library("m")` on
macOS), set the signature correctly, and verify `cos(0.0) == 1.0` and
`cos(pi) == -1.0` to within floating tolerance.

**Constraints.**
- You **must** set `func.argtypes = [ctypes.c_double]` and
  `func.restype = ctypes.c_double`.
- First run it *without* setting `restype`, observe the wrong answer, then
  fix it.
- Print both the broken and the corrected result.

**Hints (try without first).**
- With no `restype`, ctypes assumes `c_int`, so it reads the integer return
  register instead of the floating-point one — you get garbage, not 1.0.
- `ctypes.util.find_library("m")` is the portable way to locate libm.
- This single difference — declaring the signature — is the entire lesson of
  Warm-Up.

**Self-check.**
- [ ] You can explain *why* the no-`restype` version returns nonsense.
- [ ] You can state where ctypes got the type information from (you, not the
  library).

---

### Task 2: Write your own C library and bind to it

**Problem.** Write a tiny C file `mymath.c` exposing
`int add(int a, int b)` and `double scale(const double *xs, int n,
double factor)` (multiply each element by `factor`, return the sum).
Compile it to a shared library and call both functions from Python with
`ctypes`.

**Constraints.**
- Compile with `cc -shared -fPIC -o libmymath.so mymath.c`.
- For `scale`, build the input array with
  `(ctypes.c_double * n)(*values)` and pass it as
  `ctypes.POINTER(ctypes.c_double)`.
- Set `argtypes`/`restype` for *both* functions.

**Hints (try without first).**
- `-fPIC` (position-independent code) is required for a shared library.
- Passing a Python list directly will fail; you must marshal it into a
  ctypes array first — that array is the C-visible buffer.
- The array object must stay alive (referenced) for the duration of the
  call, or Python may collect it out from under C.

**Self-check.**
- [ ] You understand what `-shared -fPIC` produced.
- [ ] You can explain who owns the array buffer and how long it must live.

---

### Task 3: A tiny Rust `extern "C"` library, called from C and Python

**Problem.** Write a Rust crate that exposes
`#[no_mangle] pub extern "C" fn rust_add(a: i32, b: i32) -> i32` and
`pub extern "C" fn rust_sum(ptr: *const i32, len: usize) -> i64`. Build it as
a `cdylib`, then call it from a small C `main` *and* from Python with
`ctypes`.

**Constraints.**
- In `Cargo.toml` set `[lib] crate-type = ["cdylib"]`.
- The `rust_sum` body must be `unsafe` to read the raw pointer; reconstruct
  a slice with `std::slice::from_raw_parts(ptr, len)`.
- Verify the same `.so`/`.dylib` works from both C and Python.

**Hints (try without first).**
- `extern "C"` picks the C calling convention; `#[no_mangle]` exports the
  plain symbol name so a C linker can resolve it.
- `from_raw_parts` is `unsafe` precisely because the compiler cannot verify
  `ptr`/`len` are valid — that is the binding author's responsibility.
- `cargo build --release` puts the artifact under `target/release/`.

**Self-check.**
- [ ] You can explain what each of `extern "C"`, `#[no_mangle]`, and
  `cdylib` contributes.
- [ ] You can state why `rust_sum`'s body has to be `unsafe`.

**Sample Solution.**

```rust
// src/lib.rs  —  Cargo.toml: [lib] crate-type = ["cdylib"]
#[no_mangle]
pub extern "C" fn rust_add(a: i32, b: i32) -> i32 {
    a + b
}

#[no_mangle]
pub extern "C" fn rust_sum(ptr: *const i32, len: usize) -> i64 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller guarantees `ptr` points to `len` valid i32s.
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    slice.iter().map(|&x| x as i64).sum()
}
```

---

### Task 4: A cgo example, end to end

**Problem.** Write a Go program that calls a C function via cgo. Define the C
inline in the preamble (`int csquare(int x) { return x * x; }`), import `"C"`,
and call `C.csquare(C.int(7))` from Go. Print the result and confirm the
build needs a C toolchain.

**Constraints.**
- The `import "C"` must immediately follow the comment block containing the C
  code — no blank line between them.
- Convert Go ints to `C.int` explicitly; convert the result back with
  `int(...)`.
- Build once with the default settings and once with `CGO_ENABLED=0` and
  observe the failure.

**Hints (try without first).**
- The magic comment block above `import "C"` is the C preamble; the blank
  line rule is real and a common first-time error.
- `CGO_ENABLED=0` disables cgo entirely, so any `C.` reference fails to
  build — proving the dependency on a C toolchain.
- Go and C `int` are not interchangeable types; you must convert.

**Self-check.**
- [ ] You can explain why `CGO_ENABLED=0` broke the build.
- [ ] You understand that cgo just made your build pipeline depend on a C
  compiler.

---

## Core

These tasks build the working vocabulary of someone who ships bindings:
measuring the boundary's cost, releasing the GIL, respecting pointer rules,
and managing references.

### Task 5: Measure cgo call overhead

**Problem.** Benchmark the cost of a single cgo call against a single native
Go call. Write a Go benchmark that calls a trivial C function
(`void cnoop(void) {}`) in a loop and a Go `gonoop()` in another, using
`go test -bench`. Report nanoseconds per call for each.

**Constraints.**
- Use the `testing.B` benchmark harness, not hand-rolled timing.
- The C function must be trivial so you measure crossing overhead, not work.
- Run with `-benchmem` and note the difference.

**Hints (try without first).**
- Expect the cgo call to be on the order of tens to over a hundred
  nanoseconds, versus a couple for the Go call — often 20-50x.
- The overhead is the runtime transition: switching to a system stack and
  recording that the goroutine is now running un-preemptible C code.
- The lesson is to *batch*: design APIs that do more work per crossing
  instead of calling C in a tight loop.

**Self-check.**
- [ ] You produced a concrete ns/call number for each.
- [ ] You can explain where the cgo overhead comes from.
- [ ] You can describe how batching would amortize it.

---

### Task 6: Release the GIL around a blocking C call

**Problem.** Write a C function `void slow_work(int ms)` that sleeps for `ms`
milliseconds (e.g., `usleep`). Build a CPython extension (or use `ctypes`) so
that calling it from two Python threads *with the GIL released* lets the two
sleeps overlap, and *without* releasing it serializes them. Time both.

**Constraints.**
- In a C extension, wrap the sleep in
  `Py_BEGIN_ALLOW_THREADS` / `Py_END_ALLOW_THREADS`.
- With `ctypes`, note that `CDLL` releases the GIL automatically while
  `PyDLL` does not — use both to contrast.
- Launch two `threading.Thread`s each calling the function with `ms=500` and
  measure total wall-clock time.

**Hints (try without first).**
- GIL held: total ≈ 1000ms (serialized). GIL released: total ≈ 500ms
  (overlapped) — the sleeps run concurrently because no Python bytecode runs
  during them.
- Inside `Py_BEGIN_ALLOW_THREADS` you must touch **no** `PyObject*` —
  the invariant protecting them is the GIL, which you just dropped.
- This is exactly why C extensions that do real I/O or compute should
  release the GIL: otherwise they freeze the whole interpreter.

**Self-check.**
- [ ] You measured both the serialized and overlapped timings.
- [ ] You can explain what must *not* happen inside the GIL-released block.

**Sample Solution.**

```c
/* CPython extension fragment: release the GIL around the blocking call. */
static PyObject *py_slow_work(PyObject *self, PyObject *args) {
    int ms;
    if (!PyArg_ParseTuple(args, "i", &ms)) return NULL;

    Py_BEGIN_ALLOW_THREADS          /* drop the GIL */
    usleep((useconds_t)ms * 1000);  /* pure C work, NO PyObject* here */
    Py_END_ALLOW_THREADS            /* reacquire the GIL */

    Py_RETURN_NONE;
}
```

---

### Task 7: "Don't pass Go pointers to C" — provoke and fix it

**Problem.** Write a cgo program that deliberately violates the pointer rules:
pass a pointer to a Go struct that itself contains a Go pointer (e.g., a
`*string` field or a slice) into a C function. Run it and observe the
`cgocheck` panic. Then refactor to pass an opaque handle instead.

**Constraints.**
- Trigger the runtime check (it is on by default; `GODEBUG=cgocheck=1`).
- The fix must use `runtime/cgo.Handle` (or a manual integer key into a
  Go-side map), passing C an integer instead of a Go pointer.
- The C side stores the handle and later calls back into Go to resolve it.

**Hints (try without first).**
- The rule: C must not be handed Go memory that contains other Go pointers,
  and C must never *retain* a Go pointer after the call returns.
- The reason is the moving, concurrent garbage collector: it can relocate or
  collect the object, and it cannot see a reference living in C memory.
- `cgo.Handle` gives you a stable `uintptr` token you can safely pass and
  later `.Value()` back to the original Go object.

**Self-check.**
- [ ] You saw the `cgocheck` panic and can read its message.
- [ ] You can explain why even a *brief* C-held Go pointer is unsafe (the GC
  can run at any moment).
- [ ] Your handle-based version passes cleanly.

---

### Task 8: JNI or Panama downcall to your C library

**Problem.** Call `int add(int, int)` from your Task 2 C library from Java.
Pick *one* path: (a) **Panama** — describe the function with a
`FunctionDescriptor`, obtain a downcall `MethodHandle` from the `Linker`, and
invoke it (Java 22+, no C glue); or (b) **JNI** — declare a `native` method,
generate the header, write the C glue, and load the library.

**Constraints.**
- Panama path: allocate any native memory through an `Arena` and let its
  `close()` free it; load the library via `SymbolLookup`.
- JNI path: load with `System.loadLibrary`, and after any call that can
  throw, demonstrate an `ExceptionCheck`.
- Verify `add(2, 3) == 5` from Java.

**Hints (try without first).**
- Panama is dramatically less boilerplate: no `.h` generation, no C glue, no
  manual reference management — the binding lives entirely in Java.
- In JNI, the `JNIEnv*` is per-thread and the `JavaVM*` is global; do not
  confuse them.
- If you take the Panama path, note that an upcall stub's lifetime is its
  arena — calling it after the arena closes crashes (you'll meet this in
  Task 11).

**Self-check.**
- [ ] Your Java program calls the C function and prints the right answer.
- [ ] You can articulate why Panama exists (eliminating JNI's C-glue burden).

**Sample Solution.**

```java
// Panama downcall to: int add(int, int)  — Java 22+, no C glue needed.
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

Linker linker = Linker.nativeLinker();
SymbolLookup lib = SymbolLookup.libraryLookup("libmymath.so", Arena.global());
MethodHandle add = linker.downcallHandle(
    lib.find("add").orElseThrow(),
    FunctionDescriptor.of(ValueLayout.JAVA_INT,                 // returns int
                          ValueLayout.JAVA_INT, ValueLayout.JAVA_INT));
int result = (int) add.invoke(2, 3);   // -> 5
```

---

### Task 9: Build an N-API addon

**Problem.** Build a Node native addon (use `node-addon-api`) exposing a
single function `add(a, b)` that returns `a + b`. Compile it with
`node-gyp`, `require` it from JavaScript, and call it.

**Constraints.**
- Use the N-API / node-addon-api headers, *not* raw V8.
- Provide a `binding.gyp` and build with `node-gyp configure build`.
- Read the values out as `Napi::Number` and return a `Napi::Number`.

**Hints (try without first).**
- N-API's headline property is ABI stability: the compiled `.node` keeps
  working across Node major versions without recompilation.
- `Napi::CallbackInfo` gives you the arguments; validate `info.Length()`
  and types before reading.
- node-addon-api is the ergonomic C++ wrapper over the C N-API; you could
  also write it in plain C against `node_api.h`.

**Self-check.**
- [ ] `require('./build/Release/addon').add(2, 3)` returns 5.
- [ ] You can explain what "ABI stable across Node majors" buys you versus
  the old NAN/V8 approach.

---

### Task 10: Return a heap allocation across the boundary and free it correctly

**Problem.** Add to your C library a function `char *make_greeting(const char
*name)` that `malloc`s and returns a NUL-terminated string, plus
`void free_greeting(char *p)`. Bind both from Python (`ctypes`), call
`make_greeting`, copy the result into a Python `str`, and free it with
`free_greeting`. Run under Valgrind or ASan to prove no leak and no
double-free.

**Constraints.**
- `make_greeting`'s `restype` must be a pointer type that does **not** let
  ctypes auto-convert and lose the original pointer (use `c_void_p`, then
  cast to read the bytes, *and* keep the original pointer for freeing).
- You must call `free_greeting` with the *exact* pointer C returned.
- Verify clean under a memory tool.

**Hints (try without first).**
- If `restype = c_char_p`, ctypes converts the result to a Python `bytes`
  and you lose the original pointer — you then can't free it correctly. Use
  `c_void_p`, read via `ctypes.string_at`, and free the original.
- Ownership is a *convention*: the library said "I allocate, you free with
  `free_greeting`." Match it exactly — don't call libc `free` if the library
  exposes its own deallocator.
- A double-free or wrong-allocator free is silent corruption; the sanitizer
  is how you prove correctness.

**Self-check.**
- [ ] Valgrind/ASan reports zero leaks and zero invalid frees.
- [ ] You can explain why `c_char_p` as `restype` would have broken the
  free.

---

## Advanced

By now you can make correct single downcalls and respect ownership. The
Advanced track confronts the upcall hazards: callbacks from foreign threads,
reference lifetime under a moving GC, and stub lifetimes.

### Task 11: Upcall — call back into managed code from C

**Problem.** Add to your C library a function
`void for_each(int *xs, int n, void (*cb)(int))` that invokes `cb` on each
element. Register a *managed* callback from your runtime of choice and have C
call it back. Do it in two runtimes — pick two of Python (`ctypes`
`CFUNCTYPE`), Rust (`extern "C"` fn pointer), Panama (`upcallStub`), or cgo
(`//export`).

**Constraints.**
- The callback must be kept alive for the whole duration C might call it —
  in Python you must hold a reference to the `CFUNCTYPE` object or it is
  collected and C calls a dangling pointer.
- In Panama, the upcall stub is bound to an `Arena`; calling it after the
  arena closes is a crash — demonstrate that you keep the arena open.
- Catch any managed exception *inside* the callback; never let it propagate
  into C.

**Hints (try without first).**
- The classic Python bug: `lib.for_each(arr, n, CFUNCTYPE(...)(py_fn))` —
  the callback object is a temporary, gets collected, and C calls freed
  memory. Bind it to a variable that outlives the call.
- A managed exception unwinding into C is undefined behavior; convert it to
  a status the C side understands at the boundary.
- This is the dangerous direction: C chooses when, on which thread, and with
  what locks held, to call you.

**Self-check.**
- [ ] Your callback fires correctly for every element in both runtimes.
- [ ] You can explain the keep-alive requirement and the stub/arena lifetime
  rule.
- [ ] You handle a callback that raises without crashing the process.

---

### Task 12: Upcall from a *foreign* thread — attachment required

**Problem.** Extend Task 11 so the C library invokes the callback from a
thread *it* created (spawn a `pthread` inside C that calls `cb`). In a
runtime with required thread attachment, show the crash when the foreign
thread calls in unattached, then fix it by attaching.

**Constraints.**
- CPython path: the foreign thread must call `PyGILState_Ensure()` before
  touching any `PyObject*` and `PyGILState_Release()` after.
- JNI path: the foreign thread must `AttachCurrentThread` to obtain a
  thread-local `JNIEnv*` and `DetachCurrentThread` before it exits.
- Demonstrate both the broken (unattached) and fixed (attached) behavior.

**Hints (try without first).**
- A thread the runtime never created has no thread state (no Python thread
  state / no `JNIEnv*`); calling in without attaching corrupts the runtime.
- This bug is insidious because the callback works when the library happens
  to call it on your main thread and crashes only when it uses its own
  worker thread — exactly the kind of thing a unit test misses.
- Attach once when the thread starts doing managed work; detach before it
  dies (a thread that exits while attached can crash the JVM).

**Self-check.**
- [ ] You reproduced the unattached crash.
- [ ] The attached version is stable under repeated calls from the foreign
  thread.
- [ ] You can name the attach/detach (or ensure/release) pair for your
  runtime.

---

### Task 13: JNI local reference management under a loop

**Problem.** Write a JNI native method that, in a loop of (say) 100,000
iterations, creates a Java object (e.g., via `NewStringUTF` or `NewObject`)
and uses it. First write it *without* `DeleteLocalRef` and observe the local
reference table fill up and crash; then fix it by deleting each local
reference (or using `PushLocalFrame`/`PopLocalFrame`).

**Constraints.**
- The naive version must create a local reference per iteration and not free
  it.
- The fix must either `DeleteLocalRef` each iteration or bracket the loop
  body with `PushLocalFrame`/`PopLocalFrame`.
- Show that the Java objects are eligible for GC but the *local refs* are
  what exhaust the table.

**Hints (try without first).**
- Local references are freed automatically only when the *native method
  returns*; inside a long loop they accumulate until the table overflows.
- The crash is not "out of Java heap" — it is "out of local reference
  slots," a JNI-specific resource.
- `PushLocalFrame(n)`/`PopLocalFrame(NULL)` scopes a batch of local refs and
  frees them all at once — cleaner than per-object `DeleteLocalRef`.

**Self-check.**
- [ ] You reproduced the local-reference-table exhaustion.
- [ ] You can explain why deleting the local ref (not the Java object) is the
  fix.
- [ ] You can contrast local versus global references and when each is
  appropriate.

---

### Task 14: Pin vs copy — passing a managed array to C under a moving GC

**Problem.** In JNI, pass a large `byte[]` to a C function that sums it.
Implement it two ways: with `GetByteArrayElements`/`ReleaseByteArrayElements`
(which may copy) and with `GetPrimitiveArrayCritical`/`ReleasePrimitive
ArrayCritical` (which pins to avoid a copy). Measure the difference for a
large array, and note the restriction the critical version imposes.

**Constraints.**
- The critical region must be short and must not call back into the JVM or
  block — between Get/ReleasePrimitiveArrayCritical the GC may be disabled.
- Compare timings for, say, a 64 MB array.
- Explain what "pinning" means against a compacting collector.

**Hints (try without first).**
- A moving/compacting collector can relocate the array, invalidating any raw
  pointer C holds — so the JVM either *copies* the data out (safe, slower) or
  *pins* it in place (`...Critical`, faster, but constrains the GC).
- `...Critical` says "do not move or collect this; I'll be quick" — so you
  must do no JNI calls and no blocking inside the critical section.
- This is the JNI face of the universal moving-GC dilemma: pin or copy.

**Self-check.**
- [ ] You measured copy vs pin and can explain the gap.
- [ ] You can state the rules you must obey inside a critical section and
  why.

---

### Task 15: Wrap an unsafe Rust FFI binding in a safe API

**Problem.** Suppose a C library exposes `Ctx *ctx_new(void)`,
`int ctx_do(Ctx *, int)`, and `void ctx_free(Ctx *)`. Declare them in a Rust
`extern "C"` block and build a *safe* Rust wrapper: a `struct Ctx` owning the
raw pointer, whose `Drop` calls `ctx_free`, whose methods are safe, and which
converts the C error code into a `Result`. The caller should never write
`unsafe`.

**Constraints.**
- All raw FFI calls live in `unsafe` blocks *inside* the wrapper.
- `Drop` must free exactly once; make the type non-`Copy`/non-`Clone` to
  prevent double-free.
- A null return from `ctx_new` becomes an `Err`, not a panic-on-deref later.

**Hints (try without first).**
- The entire value of a `-sys`/safe-wrapper crate is encapsulating `unsafe`
  behind a sound API: lifetimes via ownership, null via `Option`/`Result`,
  cleanup via `Drop`.
- RAII (`Drop`) is how you guarantee `ctx_free` runs exactly once, even on
  early return or panic.
- Use `bindgen` to generate the `extern` block and any structs from the C
  header so layout and signatures stay in sync automatically.

**Self-check.**
- [ ] Callers of your wrapper never need an `unsafe` block.
- [ ] Double-free is impossible by construction (single owner, `Drop`).
- [ ] You can explain why FFI is `unsafe` and what the wrapper proves.

**Sample Solution.**

```rust
use std::os::raw::c_int;

#[repr(C)] pub struct RawCtx { _private: [u8; 0] }   // opaque

extern "C" {
    fn ctx_new() -> *mut RawCtx;
    fn ctx_do(c: *mut RawCtx, x: c_int) -> c_int;
    fn ctx_free(c: *mut RawCtx);
}

pub struct Ctx { raw: *mut RawCtx }   // single owner; no Copy/Clone

impl Ctx {
    pub fn new() -> Option<Ctx> {
        let raw = unsafe { ctx_new() };           // SAFETY: no args, FFI call
        if raw.is_null() { None } else { Some(Ctx { raw }) }
    }
    pub fn run(&self, x: i32) -> Result<i32, i32> {
        // SAFETY: self.raw is non-null for the lifetime of Ctx.
        let rc = unsafe { ctx_do(self.raw, x) };
        if rc < 0 { Err(rc) } else { Ok(rc) }
    }
}

impl Drop for Ctx {
    fn drop(&mut self) {
        // SAFETY: raw was created by ctx_new and freed exactly once here.
        unsafe { ctx_free(self.raw) }
    }
}
```

---

## Capstone

The Capstone tasks are open-ended — the kind of binding you would actually
ship or be asked to design in a senior interview. The "What done looks like"
paragraph replaces the self-check.

### Task 16: A production-grade Python binding to a C library

**Problem.** Pick a real C library (e.g., a compression, hashing, or image
codec library) and build a Python binding you would be comfortable shipping.
Use `cffi` API mode or a compiled extension (not bare `ctypes`), release the
GIL around any blocking/compute-heavy call, get the ownership and free
contract exactly right, and produce installable wheels.

**What done looks like.** Signatures are checked at *build* time (cffi API
mode or a compiled extension), not discovered as runtime crashes. Every heavy
or blocking call releases the GIL and touches no `PyObject*` while released,
and you have a benchmark showing two threads making progress concurrently.
Every cross-boundary allocation has a documented owner and is freed with the
library's own deallocator; the test suite runs clean under Valgrind/ASan (zero
leaks, zero invalid frees). You pinned the C library's version and can explain
how a struct-layout bump would otherwise corrupt you silently. Finally, you
produced wheels for the platform matrix (manylinux, musllinux, macOS x86-64
and ARM64, Windows) with dependent shared libraries bundled
(`auditwheel`/`delocate`) so `pip install` works without a compiler, verified
on a clean machine. You can name, for each design choice, which runtime
guarantee you surrendered and how you contained the risk.

---

### Task 17: A callback-based binding that survives foreign threads

**Problem.** Bind a C library that is *event-driven* — it invokes a callback
from its own background threads (think an audio, networking, or file-watching
library). Choose a runtime (CPython, JNI, or cgo) and make the callback path
correct under that library's threading.

**What done looks like.** The callback fires correctly even when the library
invokes it from a thread your runtime never created, because you attach that
thread before it touches managed state (`PyGILState_Ensure`/`Release`, or
`AttachCurrentThread`/`DetachCurrentThread`) and detach/release before it
exits. You hold a long-lived reference to the managed callback (a Python
reference you keep alive, or a JNI `NewGlobalRef` — never a local ref, which
would dangle after the registering call returns; or a cgo handle into a Go
map — never a raw Go pointer C retains). The callback catches every managed
exception at the boundary and converts it to a status the C side expects,
never letting it unwind into C. It does the minimum work and never re-enters
the native library (which may hold a lock while calling you). You stress-tested
it: thousands of callbacks from multiple native threads under a sanitizer, with
no crash, no leak, and no reference-table exhaustion. You can explain why a
single-threaded unit test would have passed while this binding was still
fundamentally broken — and which specific hazard each part of your design
neutralizes.

---

If you can complete all of these, you can build a correct binding in any of
the major high-level runtimes, you know exactly which guarantee you give up at
each call, and you can defend every design choice in a senior code review.
