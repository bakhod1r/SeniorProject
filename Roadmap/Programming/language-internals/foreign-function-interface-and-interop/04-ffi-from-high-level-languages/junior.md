# FFI from High-Level Languages — Junior Level

> **Topic:** [FFI from High-Level Languages](README.md)
> **Focus:** Your Python/Java/Go/Rust program needs to call a function written in C. How does that actually happen, and why is it more delicate than a normal function call?

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

> Focus: **What is FFI, and what is the smallest possible example of one language calling code written in another?**

**FFI** stands for **Foreign Function Interface**. It is the mechanism that lets code written in one language call a function that was compiled from another language. In practice, "the other language" is almost always **C**, because C has the simplest, most stable calling convention and almost every operating system speaks it natively. When a Python program calls into NumPy, when a Java program talks to a graphics driver, when a Node.js app reads from a USB device — somewhere underneath, a high-level language is reaching across a boundary and calling a native C function.

Why would you ever want this? Three reasons keep coming up:

1. **Speed.** Some work is too slow in a high-level language. A tight numeric loop in pure Python is 50–100× slower than the same loop in C. So the loop is written in C, compiled once, and called from Python.
2. **Reuse.** A library already exists — written in C or C++ — and rewriting it would be insane. SQLite, OpenSSL, libcurl, FFmpeg, zlib: all C, all used from dozens of higher-level languages through FFI.
3. **Access.** The operating system kernel, device drivers, and hardware all expose **C** interfaces. To talk to them at all, you must speak C's language at the boundary.

In one sentence: **FFI is the door between the comfortable, safe world of your high-level language and the fast, dangerous, manually-managed world of native machine code.** This page teaches you what that door looks like and how to walk through it without hurting yourself.

> 🎓 **Why this matters for a junior:** You will use FFI long before you "do FFI." Every time you `import numpy`, `pip install cryptography`, or run a Go program that links libc, you are relying on FFI. Understanding what happens at that boundary explains a whole class of confusing errors — `Segmentation fault` from a Python script, "library not found" at startup, mysterious crashes that no try/except catches. These are FFI errors, and a normal exception handler cannot save you from them.

This page covers: the two big ways high-level languages reach native code, the simplest concrete example in Python, what a "shared library" (`.so`/`.dll`/`.dylib`) is, why types have to be described carefully at the boundary, and why a mistake here crashes the whole process instead of raising a clean exception. The deeper memory, threading, and performance details are in `middle.md`, `senior.md`, and `professional.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a simple program in at least one of Python, Java, Go, Rust, or JavaScript/Node.
- **Required:** What a function is — parameters, a return value, calling it.
- **Required:** The idea that a program is compiled or interpreted into something the CPU runs.
- **Helpful but not required:** A vague sense of what C is and that it uses pointers.
- **Helpful but not required:** Knowing that your OS has files like `libc.so` (Linux), `.dylib` (macOS), or `.dll` (Windows).

You do **not** need to know:

- The CPU calling convention or how arguments are passed in registers (that's `middle.md`).
- How garbage collectors interact with native pointers (that's `senior.md`).
- How to build manylinux wheels or sign native binaries (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **FFI** | Foreign Function Interface. The general ability of one language to call functions compiled from another. |
| **Native code** | Machine code compiled ahead of time, typically from C, C++, or Rust. Runs directly on the CPU, not in an interpreter or VM. |
| **Managed code** | Code that runs inside a runtime with automatic memory management — Python objects, Java objects, Go values, JS values. The runtime owns their lifetime. |
| **Shared library** | A file of compiled functions that programs load at runtime. `.so` on Linux, `.dylib` on macOS, `.dll` on Windows. Also called a "dynamic library." |
| **Symbol** | A named entry point in a library — usually a function name like `sqlite3_open`. The loader looks up symbols by name. |
| **ABI** | Application Binary Interface. The low-level contract for how functions are called: how arguments are laid out, how the return value comes back, how the stack is managed. The C ABI is the universal one. |
| **Calling convention** | Part of the ABI: the precise rules for passing arguments (which registers, what stack layout) and who cleans up. |
| **Dynamic FFI** | Loading a library and describing function signatures **at runtime**, from your high-level language. Python `ctypes`, .NET `[DllImport]`, Ruby Fiddle. |
| **Native extension** | A library written in C (or Rust) **specifically** to be a module of your high-level language. CPython C-API extensions, JNI libraries, Node addons. |
| **Marshalling** | Converting a value from one language's representation to another's at the boundary — e.g. a Python `str` to a C `char*`. |
| **Pointer** | A number that is the address of some bytes in memory. C uses them everywhere. Crossing FFI, you often pass and receive pointers. |
| **`argtypes` / `restype`** | In Python `ctypes`: the declarations telling the FFI what argument types a C function takes and what it returns. Getting these wrong corrupts memory. |
| **Segmentation fault** | The OS killing your process because native code touched memory it shouldn't. The classic symptom of an FFI mistake. You cannot catch it with `try/except`. |
| **GIL** | Global Interpreter Lock. In CPython, only one thread runs Python at a time. FFI code can release it to let other threads run. |

---

## Core Concepts

### 1. Two ways to cross the boundary

There are exactly two broad approaches, and almost every ecosystem offers one or both.

**(a) Dynamic FFI — describe the library at runtime.** You take an *existing* compiled shared library (say, the system's math library), load it from your high-level code, and *tell your runtime* what each function looks like: "`cos` takes one double and returns a double." No C compiler needed, no separate build step. The classic example is Python's `ctypes`. Other examples: .NET's `[DllImport]`, Ruby's Fiddle/FFI, LuaJIT's FFI.

**(b) Native extension modules — compile glue code.** You write a small amount of C (or Rust) that *knows about both worlds*: it speaks your high-level language's internal API on one side and calls the native library on the other. You compile this glue into a shared library that your runtime loads as a module. Examples: CPython C-API extensions (and tools like Cython/PyO3 that generate them), Java's JNI, Node.js native addons (N-API), Go's cgo, Rust's `extern "C"`.

The trade-off, in one line: **dynamic FFI is easy and needs no compiler but is slower and type-unsafe; native extensions are fast and integrated but need a build toolchain and more code.**

### 2. What a shared library actually is

A shared library is a file full of compiled functions, each reachable by a **symbol** (its name). On Linux it ends in `.so`, on macOS `.dylib`, on Windows `.dll`. When your program runs, the OS **loader** finds the library, maps it into your process's memory, and resolves symbols — so when you ask for the function `cos`, the loader hands back its address. From there, calling it is just "jump to this address with these arguments."

You already depend on dozens of these. On Linux, run `ldd $(which python3)` and you'll see `python3` is linked against `libc.so`, `libpthread.so`, and more. FFI is just *you* doing, deliberately and at runtime, what the loader already does for the program's own dependencies.

### 3. The boundary has no shared type system

Inside Python, a string is a rich object with a length, an encoding, and a reference count. Inside C, a string is just a pointer to bytes that ends in a zero byte. These are **not the same thing**. At the FFI boundary, *someone* has to convert — to **marshal** — between them. With dynamic FFI you describe the conversion (`argtypes`/`restype`); with native extensions you write the conversion code by hand.

This is where most beginner FFI bugs live. If you tell `ctypes` that a function returns an `int` when it actually returns a pointer (which is 64 bits on a modern machine), the value gets truncated and you read garbage — or crash.

### 4. Why an FFI mistake crashes the whole process

When pure Python code does something wrong — index out of range, divide by zero — the interpreter raises an exception you can catch. The interpreter is a referee that checks every move.

Native code has **no referee**. When you cross into C, you leave the interpreter behind. If the C function dereferences a bad pointer, the *CPU* faults and the *OS* kills your entire process with a **segmentation fault**. There is no exception, no stack trace from Python, no `finally` block. This is the single most important thing to internalize as a junior: **on the native side of FFI, mistakes are fatal, not recoverable.**

### 5. Who owns the memory?

In Python, Java, Go, and Node, you never `free` memory — a garbage collector or reference counter does it for you. In C, *you* allocate and *you* free. When a value crosses the boundary, a critical question appears: **who is responsible for freeing this?** If a C library hands you a pointer to a buffer it allocated, and you forget to call its `free` function, you leak memory. If you free it twice, you crash. Every FFI binding has to answer the ownership question for every value, and getting it wrong is one of the most common real-world FFI bugs.

---

## Real-World Analogies

**The international phone call (the boundary).** You speak Python; the library speaks C. FFI is the phone line plus the agreement on what language to speak. The C ABI is the agreed common language — like two diplomats both using English even though neither is a native speaker. If one side thinks you said "meters" and the other heard "feet," nobody errors out; you just get a wrong, silent answer (a wrong `argtype`).

**The customs checkpoint (marshalling).** Goods crossing a border get repackaged and inspected. A Python string can't just walk into C as-is; it's repackaged into a C string at the boundary. That repackaging costs time, and if the customs form is wrong, the wrong thing gets delivered.

**Power tools without guards (native code).** Your high-level language is a workshop with safety guards on every machine. Crossing into C removes the guards for speed and power. You *can* cut faster — and you can also cut your hand off. The segfault is the workshop accident the guards used to prevent.

**Hiring a contractor (ownership).** When a C library allocates memory and hands it to you, it's like a contractor leaving materials on your property. Sometimes they expect you to dispose of the leftovers (you must `free`); sometimes they'll come back and clean up themselves (don't `free`, they own it). The contract has to say which — and if you guess wrong, you either pile up trash (leak) or throw away something they still need (use-after-free).

---

## Mental Models

**Model 1: FFI is a translation desk between two countries.** One country (managed) has automatic services — clean streets, sanitation, police. The other (native) is wild-west fast but you're on your own. The desk in between translates documents (marshalling) and stamps passports (the ABI). Most of FFI engineering is making that desk correct and cheap.

**Model 2: The boundary is a one-way safety cliff.** On your side, mistakes raise exceptions. Step across, and mistakes are silent corruption or instant death. So you do as little as possible on the far side and validate everything *before* you cross.

**Model 3: Types at the boundary are a contract you assert, not one that's checked.** When you write `argtypes` in `ctypes` or a `#[repr(C)]` struct in Rust, you are *promising* the layout matches the C side. Nobody verifies it. If your promise is wrong, you don't get a type error — you get corruption. This is why FFI demands more care than ordinary typed code.

---

## Code Examples

> Goal of this section: the **smallest real example** in several languages — calling a function that already exists in the system C library. We use `cos` from the math library because it's everywhere.

### Python with `ctypes` — call C `cos`

```python
import ctypes
import ctypes.util

# Find and load the system math library (libm).
libm_path = ctypes.util.find_library("m")   # "libm.so.6" on Linux, etc.
libm = ctypes.CDLL(libm_path)

# THE CRITICAL STEP: describe the C signature.
# C declaration is:  double cos(double x);
libm.cos.argtypes = [ctypes.c_double]   # one double in
libm.cos.restype = ctypes.c_double      # one double out

print(libm.cos(0.0))   # 1.0
print(libm.cos(3.141592653589793))   # -1.0
```

The two lines that set `argtypes` and `restype` are the entire game. They tell `ctypes` how to marshal the Python float into a C double and how to interpret the bytes that come back. **Leave them out and `ctypes` guesses `int`**, which truncates the double and gives you nonsense.

### Python — what happens when you get the types wrong

```python
import ctypes
libc = ctypes.CDLL("libc.so.6")

# C declaration:  char *strerror(int errnum);
# strerror returns a POINTER. If we don't say so, ctypes assumes int,
# truncates the 64-bit pointer to 32 bits, and we read garbage / crash.

libc.strerror.restype = ctypes.c_char_p   # CORRECT: returns a C string
print(libc.strerror(2))   # b'No such file or directory'

# Comment out the restype line above and you may get a wrong number
# or a SEGFAULT. No exception will be raised — the process just dies.
```

This is the canonical junior FFI bug: a forgotten or wrong `restype`/`argtype` silently corrupting data.

### Go with cgo — call C `cos`

```go
package main

/*
#include <math.h>
*/
import "C"
import "fmt"

func main() {
	// C.double and C.cos come from the preamble comment above.
	result := C.cos(C.double(0.0))
	fmt.Println(float64(result)) // 1
}
```

In Go, the `import "C"` with a comment *above it* (the "preamble") turns on **cgo**. The C functions become available as `C.cos`, and you convert Go types to C types explicitly (`C.double(...)`). Unlike Python, this is compiled — you need a C compiler installed, and the binary is no longer pure Go.

### Rust calling C `cos`

```rust
// Tell Rust about an external C function. The libm is linked by default.
extern "C" {
    fn cos(x: f64) -> f64;
}

fn main() {
    // Calling foreign code is `unsafe` — the compiler can't verify the
    // signature is right or that the function behaves.
    let r = unsafe { cos(0.0) };
    println!("{}", r); // 1
}
```

Rust forces you to wrap the call in `unsafe`, which is the language saying out loud: "I cannot protect you here; you are asserting this is correct."

### Node.js — the shape of a native addon

Node doesn't do dynamic FFI in core. Native code is shipped as a compiled **addon** using **N-API**. As a junior, the important takeaway is what *using* one looks like:

```javascript
// Someone wrote and compiled a native addon; you just require it.
const native = require('./build/Release/mymodule.node');
console.log(native.cosWrapper(0.0)); // 1
```

The `.node` file is a compiled shared library that Node loads like a normal module. The hard work (writing the C glue with N-API) lives inside it — covered in later tiers.

---

## Pros & Cons

**Pros**

- **Performance.** Hot loops in native code run at full machine speed instead of interpreter speed.
- **Reuse of mature libraries.** Decades of battle-tested C (SQLite, OpenSSL, FFmpeg) become available without rewriting.
- **Hardware and OS access.** Drivers, kernel calls, and devices expose C interfaces; FFI is the only way to reach them.
- **Shared ecosystem.** One C library can serve Python, Ruby, Go, and Node bindings — write the core once.

**Cons**

- **Safety is gone at the boundary.** A bug becomes a segfault or silent corruption, not a catchable exception.
- **Type mismatches are silent and dangerous.** A wrong `argtype` corrupts memory instead of erroring.
- **Build and distribution get harder.** You now ship compiled binaries per platform, not just portable source.
- **Debugging is two-world.** You need both a high-level debugger and a native one (gdb/lldb) to chase a crash.
- **Performance can paradoxically get worse.** Each boundary crossing has overhead; calling C a million times in a loop can be slower than staying in the high-level language.

---

## Use Cases

- **Numeric/scientific computing.** NumPy, SciPy, and pandas are thin Python wrappers over C/Fortran. The reason they're fast is FFI.
- **Cryptography.** Python's `cryptography`, Node's `crypto`, and Java's JCA providers wrap OpenSSL or BoringSSL.
- **Databases.** SQLite is a C library; every language's SQLite binding is an FFI layer.
- **Media.** Image, audio, and video processing (libjpeg, FFmpeg) is C, wrapped everywhere.
- **System integration.** Reading hardware sensors, talking to USB devices, calling OS-specific APIs.
- **Embedding.** Putting a Lua or Python interpreter *inside* a C application — the reverse direction of FFI.

---

## Coding Patterns

### Pattern 1: Always declare the signature

For dynamic FFI, never call a C function before you have set both its argument types and its return type. Treat an undeclared call as a bug.

```python
lib.somefunc.argtypes = [ctypes.c_int, ctypes.c_char_p]
lib.somefunc.restype = ctypes.c_int
```

### Pattern 2: Validate before you cross

Do all your checking on the safe side. Once the value is in C, there's no second chance.

```python
def safe_call(n):
    if not isinstance(n, int) or n < 0:
        raise ValueError("n must be a non-negative int")  # catchable, here
    return lib.process(n)  # only cross once the input is known-good
```

### Pattern 3: Wrap the unsafe call in a clean function

Expose a normal, idiomatic function to your callers; hide the FFI mechanics inside it.

```python
def cosine(x: float) -> float:
    return libm.cos(x)   # callers never touch ctypes
```

This "safe wrapper around an unsafe core" pattern appears in *every* language and is the single most important habit. Rust formalizes it; everyone else should imitate it.

---

## Best Practices

1. **Declare every signature explicitly.** No undeclared `ctypes` calls, ever.
2. **Cross the boundary as rarely as possible.** Push loops into C; don't call C in a Python loop a million times.
3. **Hide FFI behind a normal-looking API.** Callers shouldn't know native code is involved.
4. **Decide and document memory ownership** for every pointer that crosses: who frees, and when.
5. **Test on every platform you ship to.** A binding that works on Linux can crash on macOS or Windows because of type-size or library-name differences.
6. **Pin to a stable interface.** Prefer libraries with a stable C ABI; C++ name-mangling and templates do not cross FFI cleanly.
7. **Keep the native side tiny.** The less code runs without a safety net, the fewer fatal bugs.

---

## Edge Cases & Pitfalls

- **Forgetting `restype` for pointer-returning functions.** `ctypes` assumes `int`; a 64-bit pointer truncates to 32 bits → garbage or crash. *Always* set `restype`.
- **Passing a Python string where C wants bytes.** C strings are bytes (`b"..."`). A `str` must be encoded first, or `ctypes` will complain — or worse, on some setups, do the wrong thing.
- **Library not found at runtime.** "cannot open shared object file" means the loader couldn't locate the `.so`. It's a *deployment* problem, not a code problem — the library isn't on the search path.
- **Integer size mismatches.** A C `long` is 64-bit on Linux but 32-bit on Windows. Hard-coding `c_int` where the C side uses `long` corrupts values across platforms.
- **Assuming exceptions protect you.** `try/except` does **not** catch a segfault. Once C corrupts memory, your process is doomed.
- **The off-by-one in C strings.** C strings need a trailing zero byte. If you build a buffer one byte too small, the C function reads past the end.
- **Calling C in a tight Python loop.** Each `ctypes` call has overhead. A million tiny C calls can be slower than pure Python; the win comes from doing the *whole loop* in C.

---

## Cheat Sheet

| Question | Quick answer |
|----------|-------------|
| What's the simplest FFI in Python? | `ctypes.CDLL`, then set `.argtypes` and `.restype`, then call. |
| Two broad approaches? | Dynamic FFI (describe at runtime) vs. native extension (compile glue). |
| What's a `.so`/`.dll`/`.dylib`? | A shared library of compiled functions, loaded at runtime by symbol name. |
| What's the universal boundary language? | The **C ABI**. |
| Why did my Python script segfault? | An FFI/native-code error. No exception will catch it. |
| Most common junior bug? | Wrong or missing `restype`/`argtypes`. |
| Who frees C-allocated memory? | Whoever the library's contract says — decide it explicitly. |
| Why is NumPy fast? | Its hot code is C, reached via FFI. |
| Should I call C inside a Python loop? | No — push the whole loop into C; boundary crossings are not free. |

---

## Summary

FFI is the bridge from a managed, safe, high-level language to fast, manually-managed native code — almost always reached through the **C ABI** and a **shared library** (`.so`/`.dll`/`.dylib`). There are two broad approaches: **dynamic FFI**, where you load a library and describe its signatures at runtime (Python `ctypes`, .NET `[DllImport]`), and **native extensions**, where you compile glue code that speaks both worlds (CPython C-API, JNI, cgo, N-API, Rust `extern "C"`).

The defining feature of the boundary is that it has **no shared type system and no safety net**. You must marshal values explicitly, declare every signature correctly, and decide who owns each piece of memory. A mistake here doesn't raise a catchable exception — it segfaults or silently corrupts data. The disciplined habits — declare signatures, cross rarely, wrap the unsafe core in a safe API, document ownership — are what separate a working binding from a flaky one.

The next tiers go deeper: `middle.md` on calling conventions, marshalling cost, and the GIL; `senior.md` on garbage collectors versus native pointers, JNI versus Project Panama, and cgo's performance cliff; `professional.md` on callbacks, threading across the boundary, and shipping native artifacts at scale.
