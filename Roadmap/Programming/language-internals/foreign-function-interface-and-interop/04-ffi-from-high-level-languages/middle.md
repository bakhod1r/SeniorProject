# FFI from High-Level Languages — Middle Level

> **Topic:** [FFI from High-Level Languages](README.md)
> **Focus:** What actually happens in the machine when you cross the boundary — calling conventions, marshalling cost, the GIL, and reference counting across FFI.

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

> Focus: **Move from "I can call a C function" to "I understand what the machine and runtime are doing when I do."**

At the junior level, FFI is a recipe: load the library, declare the signature, call the function. At the middle level, you need to understand the machinery underneath, because that machinery is exactly where the subtle bugs and performance problems come from. Three things matter most:

1. **The calling convention** — the precise, CPU-level contract for passing arguments and returning values. The C ABI defines it; everything that crosses the boundary obeys it.
2. **Marshalling cost** — converting values between representations is not free. A `str` → `char*` conversion allocates, copies, and encodes. Do it in a loop and it dominates your runtime.
3. **The runtime's invariants** — your high-level language has rules its native extensions must respect: CPython's **GIL** and **reference counting**, Java's **local/global references**, Go's GC pointer rules. Break them and you get crashes that look like cosmic-ray bugs.

In one sentence: **at this level, FFI stops being a function call and becomes a negotiation between two memory-and-execution models that don't trust each other.** This page makes that negotiation explicit.

> 🎓 **Why this matters at the middle level:** The bugs you'll be assigned to fix are no longer "I forgot `restype`." They're "this binding leaks 4 KB per request," "the app deadlocks under load," "it's fast on my machine but slow in production." All three are middle-level FFI problems: ownership, the GIL, and marshalling cost. You can't fix them from the recipe; you need the model underneath.

This page covers: the C calling convention in enough detail to reason about it, the real cost of marshalling each common type, the **GIL** and when native code must release it, reference counting across the CPython boundary, and the difference between `ctypes` (dynamic) and `cffi`/Cython (compiled) and *why* you'd choose each.

---

## Prerequisites

- **Required:** The junior FFI material — dynamic vs. native extensions, `argtypes`/`restype`, shared libraries, the no-safety-net boundary.
- **Required:** Comfort with pointers conceptually: an address, dereferencing, that a pointer is a fixed-size integer.
- **Required:** Basic threading awareness — that multiple threads can run concurrently.
- **Helpful:** Having seen a stack frame and the idea that arguments live in registers or on the stack.
- **Helpful:** Knowing what a heap allocation (`malloc`) costs roughly.

You do **not** need:

- Lock-free programming or memory-ordering theory (that's `senior.md`).
- The internals of JNI critical regions or Project Panama linkers (that's `senior.md`/`professional.md`).
- How to build distributable wheels (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Calling convention** | The exact rules for a function call: which registers hold which arguments, where the return value goes, who saves what, how the stack is aligned. |
| **System V AMD64 ABI** | The calling convention on Linux/macOS x86-64. First six integer args go in `rdi, rsi, rdx, rcx, r8, r9`; floats in `xmm0–7`; integer return in `rax`. |
| **Marshalling** | Converting a value between two languages' in-memory representations at the boundary. |
| **Boxing/unboxing** | Wrapping a primitive in a heap object (boxing) or extracting it (unboxing). Common marshalling cost in Java/JS. |
| **GIL** | CPython's Global Interpreter Lock — only one thread executes Python bytecode at a time. Native code may release it. |
| **`Py_BEGIN_ALLOW_THREADS`** | The CPython C-API macro pair that releases the GIL around a long native call and reacquires it after. |
| **Reference count** | CPython tracks how many references point at each object; at zero it's freed. C extensions must `Py_INCREF`/`Py_DECREF` correctly. |
| **Borrowed reference** | A pointer to a Python object you may use but do **not** own — you must not `DECREF` it. |
| **Owned/new reference** | A reference you own and are responsible for `DECREF`-ing. |
| **`cffi`** | A Python FFI library that parses C declarations and can compile small wrappers — closer to the metal than `ctypes`, often faster and safer. |
| **Cython** | A Python-like language compiled to a C extension; generates C-API code for you. |
| **Trampoline / thunk** | A small generated piece of code that adapts one calling convention or signature to another, often used for callbacks. |
| **Boundary crossing cost** | The fixed overhead of one FFI call: argument marshalling, possible GIL release/acquire, stack setup. |

---

## Core Concepts

### 1. The calling convention: what "passing an argument" means

When you call `cos(0.0)`, there is no magic. On Linux/macOS x86-64, the **System V AMD64 ABI** says: the first floating-point argument goes in register `xmm0`, the function runs, and the `double` result comes back in `xmm0`. Integer arguments go in `rdi, rsi, rdx, rcx, r8, r9`, in that order; a seventh integer argument spills onto the stack. The integer return value comes back in `rax`.

Your FFI layer's job is to **place each argument in the right place according to this convention**, then jump to the function's address. `ctypes` builds this call dynamically using a library called **libffi**, which knows the ABI for every platform and can assemble an arbitrary call at runtime. A compiled extension (Cython, cgo, JNI glue) gets the C compiler to emit the call directly, which is why it's faster — there's no runtime call-assembly step.

The practical consequence: **the ABI is per-platform.** The same `ctypes` code calls differently on x86-64 Linux, ARM64 macOS, and 32-bit Windows. libffi hides this, but it's why type *sizes* matter — if you say `c_int` (32-bit) where the function expects `long` (64-bit on Linux), the argument lands in the register only half-filled, and the function reads garbage in the high bits.

### 2. Marshalling is where your time goes

Crossing the boundary requires converting representations, and conversions cost real work:

- **`int`/`float`:** cheap. A Python int that fits in a machine word, or a float, converts to a C `long`/`double` with a few instructions. Almost free.
- **Strings:** expensive. A Python `str` is UTF-something internally; a C `char*` is null-terminated bytes. Converting means **encoding + allocating + copying** the whole string. For a 10 KB string this is a 10 KB allocation and copy *per call*.
- **Arrays/buffers:** depends. If you can pass a *pointer to existing contiguous memory* (NumPy arrays expose their buffer this way), it's nearly free — no copy. If the runtime has to flatten or copy, it's O(n).
- **Structs:** you must lay them out to match the C struct exactly (field order, padding/alignment). A mismatch is silent corruption.

The headline rule: **the dominant cost of FFI in real code is usually marshalling, not the C function.** If a profiler shows your "fast C binding" is slow, suspect string/array conversion in the loop before you suspect the C code.

### 3. The GIL: why long C calls must release it

CPython has a **Global Interpreter Lock**: at any instant, only one thread runs Python bytecode. This is fine until you make a C call that blocks — a network read, a long computation, a `sleep`. If your C extension holds the GIL while blocking for 200 ms, **every other Python thread is frozen** for those 200 ms.

The fix is a CPython C-API idiom: release the GIL around the blocking native work, then reacquire it.

```c
Py_BEGIN_ALLOW_THREADS    /* releases the GIL */
result = slow_native_call();   /* other Python threads can now run */
Py_END_ALLOW_THREADS      /* reacquires the GIL before touching Python objects */
```

The rule is strict: **you may not touch any Python object while the GIL is released.** Between those two macros you may only do pure C work. This is exactly how libraries like `requests` (via the socket layer) and NumPy let other threads run during I/O or big computations — they drop the GIL while in C. With `ctypes`, calls release the GIL by default during the foreign call, which is convenient but means you have no Python-object access in there anyway.

### 4. Reference counting across the boundary

In a CPython C extension, every Python object has a **reference count**. The C-API hands you objects as either:

- a **new (owned) reference** — *you* must `Py_DECREF` it when done, or it leaks;
- a **borrowed reference** — someone else owns it; you must **not** `DECREF` it, or you cause a premature free and later crash.

Getting this wrong is the canonical native-extension bug. `Py_INCREF` one too few times and the object is freed while you still use it (crash). One too many and it never frees (leak). The C-API docs label every function's return as "new" or "borrowed" precisely because this is the thing people get wrong. Dynamic FFI (`ctypes`) sidesteps most of this by not handing you raw Python objects — another reason it's "safer but slower."

### 5. `ctypes` vs `cffi` vs Cython — the same goal, three trade-offs

- **`ctypes`** (stdlib): pure runtime, no compiler. You declare signatures by hand. Easiest to start, slowest per call, easiest to get type sizes wrong.
- **`cffi`**: you give it actual C declarations (it can even read a header). It can run in an "API mode" that compiles a small C shim, giving near-C-extension speed and far fewer type mistakes. Preferred for serious bindings.
- **Cython**: you write Python-ish code, it generates a full C extension. Best when you're writing *new* glue/algorithms, not just wrapping an existing library.

The choice is: how much speed and safety do you need versus how much build complexity can you accept?

---

## Real-World Analogies

**The shipping container (ABI).** A standardized container fits every crane, truck, and ship in the world regardless of who built them. The C ABI is that container: any language that can pack arguments into it can call any function expecting it. The standardization is the whole value.

**Currency exchange at the airport (marshalling).** Every time you cross a border you change money, and the exchange takes a cut. Crossing FFI repeatedly with strings is like exchanging currency on every purchase — the fees (copies) dominate if you do it constantly. Smart travelers exchange once, in bulk (pass one big buffer, not many small ones).

**The single key to the workshop (GIL).** Only one worker can hold the key to the Python workshop at a time. If a worker takes the key, then goes off to do a long errand outside (a blocking C call), everyone else is locked out for no reason. The polite worker hangs the key back up (`Py_BEGIN_ALLOW_THREADS`) before leaving on the errand.

**Library books (reference counting).** A book is reshelved (freed) only when every borrower returns it. A *new reference* is you checking out a book — you owe a return. A *borrowed reference* is reading over someone's shoulder — not your book to return. Returning a book you didn't check out (DECREF a borrowed ref) corrupts the records.

---

## Mental Models

**Model 1: The boundary is a toll booth with a fixed fee plus a per-byte fee.** Every crossing pays a fixed cost (set up the call, maybe touch the GIL) and a variable cost (copy the data). Optimizing FFI is minimizing *number of crossings* (fixed cost) and *bytes copied per crossing* (variable cost).

**Model 2: The GIL is a baton in a relay.** Only the runner with the baton runs Python. A well-behaved C call that will be slow *passes the baton* while it works and *grabs it back* before touching anything Python.

**Model 3: Every object reference is a debt or a loan.** "New reference" = a debt you must repay (DECREF). "Borrowed reference" = a loan you must not repay (someone else will). The whole CPython C-API is bookkeeping these debts.

---

## Code Examples

### Marshalling cost made visible (Python)

```python
import ctypes, time
libc = ctypes.CDLL("libc.so.6")
libc.strlen.argtypes = [ctypes.c_char_p]
libc.strlen.restype = ctypes.c_size_t

s = ("x" * 10_000).encode()   # encode ONCE, outside the loop

# Bad: re-encode every iteration (marshalling in the hot path).
t0 = time.perf_counter()
for _ in range(100_000):
    libc.strlen(("x" * 10_000).encode())   # allocates + copies 10 KB each time
bad = time.perf_counter() - t0

# Good: reuse the already-marshalled bytes.
t0 = time.perf_counter()
for _ in range(100_000):
    libc.strlen(s)
good = time.perf_counter() - t0

print(f"re-encode each call: {bad:.3f}s   reuse: {good:.3f}s")
# The "bad" version is dominated by string allocation, not by strlen.
```

The lesson: the C function (`strlen`) is trivial; the cost is the marshalling you do *around* it.

### Releasing the GIL in a C extension

```c
#define PY_SSIZE_T_CLEAN
#include <Python.h>

static PyObject *do_slow_work(PyObject *self, PyObject *args) {
    long n;
    if (!PyArg_ParseTuple(args, "l", &n)) return NULL;

    long result;
    Py_BEGIN_ALLOW_THREADS          /* drop the GIL: pure C only below */
    result = 0;
    for (long i = 0; i < n; i++) result += i;   /* no Python objects here */
    Py_END_ALLOW_THREADS            /* reacquire before building a PyObject */

    return PyLong_FromLong(result); /* safe: GIL held again */
}
```

If you forgot the macros, this loop would freeze every other Python thread for its whole duration.

### Owned vs borrowed reference (the classic bug)

```c
/* PyList_GetItem returns a BORROWED reference. Do NOT DECREF it. */
PyObject *item = PyList_GetItem(list, 0);   /* borrowed */
/* ... use item ... */
/* Py_DECREF(item);   <-- BUG: would over-decref and corrupt refcounts */

/* PyLong_FromLong returns a NEW reference. You MUST DECREF it. */
PyObject *num = PyLong_FromLong(42);        /* owned */
/* ... use num ... */
Py_DECREF(num);                              /* required, or it leaks */
```

### Go cgo: explicit type conversion at the boundary

```go
package main

/*
#include <string.h>
*/
import "C"
import (
	"fmt"
	"unsafe"
)

func main() {
	// C.CString allocates a C buffer and copies — YOU must free it.
	cs := C.CString("hello")
	defer C.free(unsafe.Pointer(cs)) // ownership is yours; free it

	n := C.strlen(cs)
	fmt.Println(int(n)) // 5
}
```

Note the `defer C.free`: `C.CString` allocates with C's `malloc`, so the Go GC will *not* clean it up — you own it.

---

## Pros & Cons

**Pros**

- **Predictable cost model.** Once you understand crossing cost = fixed + per-byte, you can optimize bindings deliberately.
- **GIL release unlocks parallelism.** Native code that drops the GIL lets Python use multiple cores for the native portion.
- **Compiled FFI (cffi API mode, Cython) gets near-C speed** while keeping a Python-friendly surface.

**Cons**

- **Marshalling can erase the speed win** if you cross the boundary too often with large values.
- **Reference-counting bugs are subtle and non-local** — a leak or crash can surface far from the mistake.
- **GIL discipline is easy to violate.** Touching a Python object after releasing the GIL is a latent crash.
- **Type-size portability bugs** (`int` vs `long`) hide until you run on a different platform.

---

## Use Cases

- **Wrapping a blocking C library for a threaded server** — you *must* release the GIL or you serialize all requests.
- **High-throughput numeric kernels** — pass a NumPy buffer pointer once, do all the work in C, return once. One crossing, zero copies.
- **Choosing `cffi` over `ctypes`** for a binding that will be called often or maintained long-term, to cut per-call cost and type mistakes.
- **Writing a Cython extension** when the hot path is *new* code, not a wrapper around an existing `.so`.

---

## Coding Patterns

### Pattern 1: Marshal once, cross once

Convert your data to the C representation *outside* the loop, and prefer one bulk call over many small ones.

```python
buf = bytes(my_data)          # marshal once
lib.process_all(buf, len(buf))  # single crossing for the whole array
```

### Pattern 2: Bracket every blocking native call with GIL release

In any C extension, if the native work is non-trivial and touches no Python objects, wrap it in `Py_BEGIN_ALLOW_THREADS`/`Py_END_ALLOW_THREADS`.

### Pattern 3: Match C integer types exactly

Use `ctypes.c_long`, `c_size_t`, `c_int32` etc. to match the C declaration's *actual* type, not "whatever looks like a number." Read the header.

### Pattern 4: Own-it-then-free-it for C allocations

When a C function allocates and returns a buffer, immediately arrange to free it (a `try/finally`, a Go `defer C.free`, a Rust `Drop` wrapper). Never leave the free to "later."

---

## Best Practices

1. **Profile the binding, not just the C library.** The slow part is often marshalling you wrote, not the foreign function.
2. **Prefer passing pointers to existing buffers over copying.** Zero-copy is the biggest single FFI speed lever.
3. **Release the GIL around blocking or long native calls** — and never touch Python objects while it's released.
4. **Annotate every reference as owned or borrowed** in comments; the bug is invisible otherwise.
5. **Pin integer types to the C declaration**, and test on 32-bit/64-bit and Linux/Windows if you ship cross-platform.
6. **Choose the tool for the job:** `ctypes` for a quick script, `cffi` for a real binding, Cython for new hot code.
7. **Keep the GIL-released region as small as possible** — just the blocking call, nothing else.

---

## Edge Cases & Pitfalls

- **Touching a Python object after `Py_BEGIN_ALLOW_THREADS`.** Classic latent crash; the object machinery isn't protected without the GIL.
- **DECREF-ing a borrowed reference.** Over-decrement frees an object still in use → later use-after-free crash, far from the cause.
- **Re-marshalling in a loop.** Encoding the same string every iteration turns an O(1) C call into an O(n) allocation storm.
- **`c_int` where C uses `long` on 64-bit Linux.** Truncation; works on Windows (where `long` is 32-bit), corrupts on Linux. Platform-dependent and nasty.
- **Forgetting to free a `C.CString`/`malloc`'d buffer.** The GC won't, because C owns it — steady leak.
- **Assuming the GIL makes compound C operations atomic.** It doesn't; the GIL is released across many C boundaries.
- **Struct padding mismatch.** Your `ctypes.Structure` must replicate the C struct's alignment exactly, or fields read from the wrong offsets.

---

## Cheat Sheet

| Topic | Key fact |
|-------|----------|
| Argument passing (x86-64 SysV) | Ints in `rdi, rsi, rdx, rcx, r8, r9`; floats in `xmm0–7`; int return in `rax`. |
| What `ctypes` uses to make calls | **libffi**, which knows each platform's ABI. |
| Cheapest things to marshal | `int`, `float` (machine word). |
| Most expensive common marshalling | strings (encode + alloc + copy) and copied arrays. |
| GIL release idiom | `Py_BEGIN_ALLOW_THREADS` … `Py_END_ALLOW_THREADS`. |
| Rule while GIL released | Touch **no** Python objects. |
| New vs borrowed reference | New = you DECREF; borrowed = you must not. |
| `ctypes` vs `cffi` vs Cython | Quick / serious-binding / new-hot-code. |
| Biggest speed lever | Zero-copy buffers + fewer crossings. |

---

## Summary

At the middle level, FFI is a **negotiation between two memory-and-execution models**. The C **calling convention** (e.g. System V AMD64) dictates exactly where arguments live; `ctypes` realizes it dynamically through libffi, while compiled extensions emit the call directly and run faster. **Marshalling** — converting representations at the boundary — is usually where the time goes; ints and floats are cheap, strings and copied arrays are not, and the winning move is fewer crossings with zero-copy buffers.

Inside CPython native extensions, two invariants rule everything: the **GIL** (release it around blocking native work, touch no Python objects while released) and **reference counting** (own-it-then-DECREF, never DECREF a borrowed reference). These are the source of the leaks, deadlocks, and use-after-free crashes you'll be asked to fix. The tool choice — `ctypes`, `cffi`, or Cython — trades build complexity against speed and safety.

`senior.md` goes further: garbage collectors versus raw native pointers, JNI's reference model versus Project Panama, Go's cgo performance cliff and goroutine-stack switch, and Rust's safe-wrapper-over-unsafe-core discipline.
