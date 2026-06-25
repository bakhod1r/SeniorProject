# Data Marshalling & Memory Layout — Middle Level

> **Topic:** [Data Marshalling & Memory Layout](README.md)
> **Focus:** The four hard problems behind every binding — encodings, struct layout, pinning, and ownership — and how each runtime gives you a tool for each. Where the bugs actually live.

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
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **How do the four hard problems of marshalling — encoding, layout, pinning, ownership — actually behave, and what is the precise tool for each in Python, Java, Go, Rust, and C#?**

At the junior level you learned *that* strings, structs, arrays, and ownership are the hard parts. At this level you learn *how* each one works in enough detail to write correct bindings on your own and to debug them when they fail. The recurring theme: marshalling is a set of **contracts**, and a binding is correct exactly when both sides honor the same contract — same encoding, same byte offsets, same lifetime, same allocator.

The reason this is hard is that your language's safety net stops at the FFI boundary. The borrow checker, the GC, bounds checking, type checking — none of them see across the `extern "C"`. So the discipline you'd normally get for free has to be re-established by hand, per call. The good news is that the failure modes are finite and well-understood; once you can name them, you can prevent them.

> 🎓 **Why this matters at the middle level:** This is the level where you stop copying binding code from Stack Overflow and start writing it. You'll be asked to wrap a C library nobody has wrapped, or to fix a binding that crashes "randomly." Random crashes in FFI are almost never random — they're a lifetime bug, an allocator mismatch, or an unpinned buffer. Knowing the four contracts turns "it crashes sometimes" into "the GC moved the buffer on line 12."

This page covers: **string encodings** (UTF-8 vs UTF-16, who allocates the returned string, `CString`/`CStr`), **struct layout** (alignment, padding, why default layout is dangerous), **arrays and buffers** (pointer+length, copy vs zero-copy, pinning per runtime), and **ownership and lifetime** (allocator matching, the three conventions, keeping objects alive across calls). `senior.md` goes deeper into ABI-exact layout, GC internals, and zero-copy at scale.

---

## Prerequisites

- **Required:** Everything in `junior.md`: the three mismatches, the iron allocator rule, and basic per-language binding syntax.
- **Required:** Comfort calling a C function from at least two of: Python, Go, Rust, Java, C#.
- **Required:** Understanding of pointers, stack vs heap, and that a struct is a contiguous block of bytes.
- **Helpful:** A working idea of what a garbage collector does — that it reclaims unreferenced memory and may compact/move live objects.
- **Helpful:** Basic familiarity with UTF-8 (variable-width, ASCII-compatible) vs UTF-16 (mostly 2 bytes per code unit).

You do **not** yet need: the full ABI (System V vs Windows x64), cache-line and false-sharing concerns, or designing a public binding API. Those are `senior.md` and `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Alignment** | A type's required address granularity. A 4-byte `int` is typically 4-byte aligned: its address must be a multiple of 4. |
| **Padding** | Unused bytes the compiler inserts between fields so each field meets its alignment requirement. |
| **`#[repr(C)]`** | Rust attribute forcing C-compatible field order, alignment, and padding. |
| **`LayoutKind.Sequential`** | .NET struct layout that keeps fields in declared order with platform padding (the usual choice for C interop). |
| **`CString` / `CStr`** | Rust types: `CString` owns a NUL-terminated buffer (allocated by Rust); `CStr` is a borrowed view of an existing NUL-terminated C string. |
| **Pinning** | Preventing the GC from moving (and, with a live reference, freeing) an object during a native call. |
| **`GCHandle.Alloc(obj, GCHandleType.Pinned)`** | .NET API to pin a managed object and obtain a stable address. |
| **`fixed`** | C# statement that pins a managed array/string for the duration of a block and yields a raw pointer. |
| **`GetPrimitiveArrayCritical`** | JNI call that gives a (usually) direct pointer into a Java array, suspending GC for that window — must be released quickly. |
| **`GC.KeepAlive`** | .NET method that creates a "use" of an object at a point in code, preventing the GC from collecting it before then. |
| **Buffer protocol / `memoryview`** | Python's mechanism for exposing an object's raw bytes (e.g. NumPy arrays) without copying. |
| **Out-parameter** | A pointer argument the callee writes into; the C idiom for returning extra values. |
| **Opaque pointer** | A `void*`/handle whose internals are hidden; you pass it through without dereferencing. |
| **LP64 / LLP64** | Data models. On 64-bit Unix (LP64) `long` is 64-bit; on 64-bit Windows (LLP64) `long` is 32-bit. A classic interop trap. |
| **`size_t` / `intptr_t`** | C types sized to the platform's pointer width; map to `usize`/`isize`, `nuint`/`nint`, `C.size_t`, `ctypes.c_size_t`. |

---

## Core Concepts

### 1. Strings: Encoding, Termination, and Who Allocates

A string crossing the boundary involves **three** independent questions, and you must answer all three:

1. **Termination/length:** Is the C side NUL-terminated (`char*`) or length-counted (pointer + `size_t`)? Your side may be the opposite.
2. **Encoding:** UTF-8? UTF-16 (Windows wide / Java)? Something legacy (Latin-1)? Bytes don't carry their encoding; it's a convention you must know.
3. **Ownership of a *returned* string:** If C returns a `char*`, who frees it — and with which function?

Per language, the in-memory string is:

| Language | Representation | NUL-terminated? | Encoding |
|----------|----------------|-----------------|----------|
| C | `char*` | Yes (the NUL is the end) | By convention (usually UTF-8 on Unix) |
| Go | `string` = (ptr, len) | **No** | UTF-8 |
| Rust | `String` = (ptr, len, cap); `&str` = (ptr, len) | **No** | UTF-8 (guaranteed) |
| Java | `String` (UTF-16 code units + length) | No | UTF-16 internally |
| Python 3 | `str` (decoded text) vs `bytes` (raw) | No | `str` is abstract; `bytes` is your raw channel |
| C# | `string` (UTF-16) | No | UTF-16 internally |

So Go and Rust must *append a NUL* to hand a string to C (`C.CString`, `CString::new`). Java and C# must *transcode* UTF-16 → UTF-8 (or → wide on Windows). Python must explicitly `.encode()` a `str` into `bytes`. Rust's UTF-8 guarantee makes it the friendliest to UTF-8 C APIs — but reading an arbitrary C `char*` back into Rust requires checking it's valid UTF-8 (`CStr::to_str` can fail).

**Reading a C string back:** Rust borrows it as `CStr` (no copy, no free) and converts with `to_str()`; Go copies with `C.GoString`; Python reads `.value` from a `c_char_p`; C# uses `Marshal.PtrToStringAnsi/UTF8`. Whether you must free the original `char*` afterward depends on convention #3 above.

### 2. Struct Layout: Alignment and Padding

A C struct is laid out by placing each field at the next offset that satisfies its **alignment**, inserting **padding** as needed, and rounding the whole struct's size up to its largest member's alignment. Consider:

```c
struct S {
    char  a;   // offset 0, size 1
    // 3 bytes padding so the int is 4-aligned
    int   b;   // offset 4, size 4
    char  c;   // offset 8, size 1
    // 7 bytes padding so the double is 8-aligned
    double d;  // offset 16, size 8
};               // total size 24, not 14
```

If your language lays the same fields out without that padding — or reorders them to save space — every read after the first divergence is garbage. That's why you must force C layout:

- **Rust:** `#[repr(C)]`. The default `repr(Rust)` is *unspecified* and the compiler **may reorder fields** to minimize padding. Never rely on it for FFI.
- **C#:** `[StructLayout(LayoutKind.Sequential)]` (and `Pack` if the C side uses a non-default `#pragma pack`).
- **Python ctypes:** subclass `Structure`, declare `_fields_` in order; ctypes computes the same padding (set `_pack_` to mirror packed structs).
- **Go (cgo):** use the cgo-generated `C.struct_X` type, which carries C's layout; if you hand-roll a Go struct, match field order *and* you may need explicit padding fields.
- **Java:** the JVM exposes no raw struct layout. You either marshal field-by-field or use the newer Foreign Function & Memory API with explicit `MemoryLayout`/`VarHandle`.

A subtlety: a field's *type size* must also match. A C `int` is 32 bits; a C `long` is 64-bit on Unix (LP64) but 32-bit on 64-bit Windows (LLP64). Map to fixed-width types (`int32_t`/`int64_t` ↔ `i32`/`i64`, `c_long` only when you truly mean the platform `long`).

### 3. Arrays and Buffers: Pointer + Length, Copy vs Zero-Copy

C has no concept of "an array that knows its length." You pass **two** things: a pointer to the first element and a count (or byte length). The contract is entirely by convention — get the length wrong and C reads out of bounds.

Two strategies:

- **Copy:** marshal a fresh C buffer, pass it, copy the result back. Simple and safe; costs time and memory for large data.
- **Zero-copy:** hand C a pointer *directly into your language's memory*. Fast, but the bytes must stay **valid** and **unmoved** for the whole call. In GC languages this means **pinning**.

Python exposes raw buffers via the **buffer protocol** (`memoryview`, `bytearray`) and scientific arrays via NumPy's `__array_interface__` / `ctypes.data`, enabling zero-copy into C. NumPy arrays are not moved by CPython's (non-compacting) GC, which makes zero-copy there comparatively safe — but you must still keep the array alive.

### 4. Pinning: Keeping GC Memory Still

In compacting/moving collectors (HotSpot's, Go's, .NET's), a live object can be **relocated** to defragment the heap. A raw pointer you gave C becomes stale the instant that happens. Pinning suppresses the move for a window:

- **.NET:** `fixed (byte* p = arr) { native(p, arr.Length); }` pins for the block; or `GCHandle.Alloc(obj, GCHandleType.Pinned)` for a longer-lived pin (must `Free()` it). Pinning fragments the heap, so pin briefly.
- **Java (JNI):** `GetPrimitiveArrayCritical` returns a (usually) direct pointer and effectively pauses GC; you must do *minimal* work and call `ReleasePrimitiveArrayCritical` quickly. The looser `GetByteArrayElements` may copy instead.
- **Go:** you don't pin in the .NET sense. The rule is structural: **C must not retain Go pointers past the call.** You may pass a pointer to Go memory *into* a C call, but C must not store it for later, and Go memory can contain no Go pointers it passes to C. Long-lived buffers shared with C should be C-allocated (or use `runtime.Pinner` in recent Go for bounded cases).
- **Python:** CPython's main GC is reference-counting and **non-moving**, so objects don't relocate — but you must keep a *reference* alive (don't let the refcount hit zero) for as long as C holds the pointer.

### 5. Ownership and Lifetime: The Three Conventions, Precisely

Every pointer crossing the boundary has an owner. The three conventions, with their failure modes:

| Convention | Who frees | Failure if you get it wrong |
|------------|-----------|-----------------------------|
| **Caller allocates, callee fills** | Caller | Buffer too small → overflow; otherwise safe |
| **Callee allocates, caller frees (paired fn)** | Caller, via the library's `free_x()` | Using plain `free` instead → allocator mismatch crash; not freeing → leak |
| **Callee allocates, callee owns** | Callee (you must NOT free) | Freeing it → double-free / freeing static memory → crash |

The **allocator-matching rule** is the law underneath all three: memory from allocator X is freed by allocator X. A Rust `String` freed by C's `free`, a C `malloc` buffer freed by Go's runtime, a .NET array freed by C — all corrupt the heap. When a library *allocates* memory for you, it almost always ships a paired free function precisely so the same allocator reclaims it.

**Keeping objects alive:** the GC frees what it can't see references to. If the only reference to a managed object lives in a native variable (or got optimized away after its last managed use), the GC may collect it *while C is using it*. `GC.KeepAlive(obj)` (.NET) and equivalent "keep a reference until here" patterns extend the object's visible lifetime to cover the native call. This is a real, shipped-in-production bug class, not a theoretical one.

### 6. Numeric Type Mapping and Booleans

The "obvious" numeric types hide traps:

- **`long`:** 64-bit on LP64 (Linux/macOS 64-bit), 32-bit on LLP64 (Windows 64-bit). Don't use a language's `long` to mean C `long` unless you've checked; prefer fixed-width types.
- **`size_t` / `intptr_t`:** pointer-width. Map to `usize`/`isize` (Rust), `nuint`/`nint` (C#), `C.size_t`/`C.intptr_t` (Go cgo), `ctypes.c_size_t` (Python).
- **`bool`:** C `_Bool` is usually 1 byte, but historically and across compilers its size varied. .NET marshals `bool` as a 4-byte BOOL by default unless you say `[MarshalAs(UnmanagedType.I1)]`. Always pin down the bool width.
- **Enums:** a C enum's underlying integer type can vary; match it explicitly.

### 7. Opaque Handles and Out-Parameters

When C exposes a complex object (a database connection, a file handle, a parser), the clean design is an **opaque handle**: C returns a `void*` (or a typed-but-incomplete pointer), and you pass it back to every function that operates on it. You **never** dereference it. This decouples your binding from C's internal layout — the struct can change size and you don't care. Treat the handle as a token.

**Out-parameters** are how C returns multiple values: you pass `&result`, the function writes into it, and you read it after. Marshalling an out-parameter means allocating the destination on your side (or pinning it) and passing its address (`byref`/`ref`/`&mut`/`POINTER`). Error-code conventions ride along: many C functions return an `int` status and write the real result through an out-parameter — your binding must check the status before trusting the out value.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Three string questions (length/encoding/ownership)** | Shipping a parcel: how is it sealed, what language is the label in, and who pays return postage? |
| **Struct padding** | A pre-printed form with fixed-size boxes. You can't write the date in the name box; the boxes are at fixed positions. |
| **Zero-copy** | Letting the inspector read your original ledger instead of photocopying it — faster, but don't shred it mid-inspection. |
| **Pinning** | A "do not move during renovation" tag on a specific shelf while the warehouse is reorganized. |
| **`GC.KeepAlive`** | Telling the cleaning crew "this box is still in use" so they don't haul it away while a contractor works from it. |
| **Allocator matching** | Returning equipment to the exact depot that issued it; another depot's system rejects it. |
| **Opaque handle** | A locker key. You operate the locker via the key; you never see the locker's internal mechanism. |
| **Out-parameter** | Handing over a blank form for the office to fill and return. |
| **LP64/LLP64 `long`** | A "pint" that means 568 ml in one country and 473 ml in another. Same word, different size. |

---

## Mental Models

### The Four Contracts

Every binding is four simultaneous contracts: **encoding** (bytes mean the same characters), **layout** (fields sit at the same offsets), **lifetime** (the data stays valid and unmoved for exactly as long as both sides need it), and **ownership** (exactly one allocator frees each allocation). A binding is correct iff all four hold. When one breaks you get a signature failure: encoding → mojibake; layout → garbage fields; lifetime → use-after-free / GC-moved crash; ownership → leak or double-free. Diagnose by asking which contract broke.

### Draw the Bytes

When a struct or string binding misbehaves, stop guessing and *draw the byte layout on both sides*. Mark offsets, sizes, and padding. Nine times out of ten the bug is visible: a field two bytes off, a missing NUL, a `long` that's 4 bytes on one side and 8 on the other. Bytes don't lie; your mental model of them might.

### Lifetime Is a Window, Not a Point

Validity isn't binary; it's an interval. The data must be valid *from the moment C receives the pointer until the moment C is done with it* — which may extend past the call if C stored the pointer. Pinning and keep-alive both widen that window deliberately. Most lifetime bugs are a window that's too narrow: you freed/unpinned/dropped while C still held the pointer.

---

## Code Examples

### Python (ctypes): out-parameter, struct, zero-copy buffer

```python
import ctypes

lib = ctypes.CDLL("./libdemo.so")

# --- struct with explicit C layout (matches padding automatically) ---
class Rect(ctypes.Structure):
    _fields_ = [("w", ctypes.c_int32), ("h", ctypes.c_int32)]

# --- out-parameter: int status + result via pointer ---
# int demo_parse(const char *s, int *out);   returns 0 on success
lib.demo_parse.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]
lib.demo_parse.restype  = ctypes.c_int

out = ctypes.c_int()
status = lib.demo_parse(b"42", ctypes.byref(out))   # bytes, not str
if status == 0:
    print(out.value)   # 42 — only trust out AFTER checking status

# --- zero-copy: hand C a pointer into a bytearray (non-moving GC) ---
buf = bytearray(1024)
cbuf = (ctypes.c_char * len(buf)).from_buffer(buf)   # no copy
# void demo_fill(char *p, size_t n);
lib.demo_fill.argtypes = [ctypes.POINTER(ctypes.c_char), ctypes.c_size_t]
lib.demo_fill(cbuf, len(buf))
# keep `buf` alive as long as C might touch it
```

### Go (cgo): string round-trip, ownership, the "no Go pointers" rule

```go
/*
#include <stdlib.h>
#include <string.h>
char *demo_dup(const char *s);   // mallocs a copy — caller must free
*/
import "C"
import (
	"fmt"
	"unsafe"
)

func dupViaC(s string) string {
	cs := C.CString(s)                 // Go -> C buffer (C allocator)
	defer C.free(unsafe.Pointer(cs))   // free with C's allocator: match!

	out := C.demo_dup(cs)              // C mallocs the result
	defer C.free(unsafe.Pointer(out))  // we own it; free with C free

	return C.GoString(out)             // copy C string back into a Go string
}

func main() { fmt.Println(dupViaC("café")) }
// Rule: do NOT pass a Go pointer that itself points to Go memory containing
// Go pointers; and C must not retain `cs`/`out` past these calls.
```

### Rust: CString out, CStr in, and never free the borrowed one

```rust
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

extern "C" {
    fn demo_dup(s: *const c_char) -> *mut c_char; // C mallocs
    fn demo_free(p: *mut c_char);                 // paired free
    fn demo_version() -> *const c_char;           // static, do NOT free
}

fn dup_via_c(s: &str) -> String {
    let input = CString::new(s).expect("no interior NUL"); // Rust owns/frees
    unsafe {
        let out = demo_dup(input.as_ptr());          // C owns `out`
        let owned = CStr::from_ptr(out).to_string_lossy().into_owned(); // copy
        demo_free(out);                              // use the PAIRED free
        owned
    }
}

fn version() -> &'static str {
    // borrowed, library-owned: read but NEVER free
    unsafe { CStr::from_ptr(demo_version()).to_str().unwrap() }
}
```

`input` is freed by Rust when it drops; `out` is freed by the C-paired `demo_free` (allocator match); `demo_version`'s pointer is never freed because the library owns it.

### C# (P/Invoke): marshalling attributes, pinning, KeepAlive

```csharp
using System;
using System.Runtime.InteropServices;

class Demo {
    [StructLayout(LayoutKind.Sequential)]   // match C field order/padding
    struct Rect { public int w; public int h; }

    // CharSet selects the string encoding; bool needs an explicit width.
    [DllImport("demo", CharSet = CharSet.Utf8)]
    static extern int demo_parse(string s, out int result);

    [DllImport("demo")]
    static extern void demo_fill(byte[] buf, nuint n);   // nuint = size_t

    static unsafe void FillZeroCopy(byte[] data) {
        fixed (byte* p = data) {           // pin for the duration of the block
            demo_fill_ptr(p, (nuint)data.Length);
        }                                   // unpinned here
    }

    [DllImport("demo")] static extern void demo_fill_ptr(byte* p, nuint n);

    static void UseHandle() {
        var obj = new byte[64];
        IntPtr h = SomeNativeRegister(obj);  // C now holds a pointer into obj
        // ... obj has no other managed use; without KeepAlive the GC could
        //     collect/move it here while C still references it:
        GC.KeepAlive(obj);                   // extend lifetime to cover the call
    }
    static IntPtr SomeNativeRegister(byte[] b) => IntPtr.Zero; // stub
}
```

### Java (JNI): UTF-8 transcoding and critical arrays

```c
JNIEXPORT jlong JNICALL Java_Demo_process(JNIEnv *env, jclass c,
                                          jstring s, jbyteArray data) {
    // String: JVM gives modified-UTF-8; pair Get with Release.
    const char *cs = (*env)->GetStringUTFChars(env, s, NULL);

    // Array: critical pointer pins (suspends GC). Do minimal work, release fast.
    jsize n = (*env)->GetArrayLength(env, data);
    void *p = (*env)->GetPrimitiveArrayCritical(env, data, NULL);
    jlong result = demo_process(cs, p, (size_t)n);
    (*env)->ReleasePrimitiveArrayCritical(env, data, p, 0);

    (*env)->ReleaseStringUTFChars(env, s, cs);
    return result;
}
```

`GetPrimitiveArrayCritical` effectively pins by suspending GC — so the window between Get and Release must be short and must not call back into the JVM, allocate, or block.

---

## Pros & Cons

**Pros:**

- Each runtime gives a precise tool per contract — encodings, layout attributes, pinning, paired frees — so correct bindings are achievable, not magic.
- Zero-copy plus pinning gives near-native performance for large buffers.
- Opaque handles decouple your binding from C's internal struct layout.

**Cons:**

- Four contracts means four ways to be wrong, often with delayed, location-shifted crashes.
- Pinning fights the GC: pin too long and you fragment the heap or stall collection.
- Encoding and `long`-width bugs are silent and platform-dependent.
- Java's lack of raw struct layout forces field-by-field marshalling or the newer FFM API.

---

## Use Cases

- Wrapping a C parser/codec where you pass buffers in and read structured results back via out-parameters.
- Binding a database driver: query strings (encoding), row buffers (zero-copy + pinning), connection handles (opaque).
- Calling Win32/POSIX APIs with their structs, wide/UTF-8 strings, and status-code-plus-out-param conventions.
- Sharing NumPy arrays with C/Fortran numerical kernels with no copy.

---

## Coding Patterns

### Pattern: Status code + out-parameter, checked

```rust
let mut out: i32 = 0;
let rc = unsafe { demo_parse(input.as_ptr(), &mut out) };
if rc != 0 { return Err(rc); }
Ok(out) // only trust `out` after rc == 0
```

### Pattern: Paired allocate/free, scoped

```go
out := C.demo_dup(cs)
defer C.demo_free(out) // the library's free, not C.free, if docs say so
```

### Pattern: Pin only as long as needed

```csharp
fixed (byte* p = buffer) {
    native_call(p, buffer.Length); // tightest possible pin scope
}
```

### Pattern: Keep-alive across a stored pointer

```csharp
native_register(obj);
// ... work that might let the GC see obj as dead ...
GC.KeepAlive(obj); // ensures obj lives until at least here
```

### Pattern: Borrow vs own on returned strings

```rust
// borrowed (library-owned): read, never free
let v = unsafe { CStr::from_ptr(lib_version()).to_str()? };
// owned (callee-allocated): copy out, then free with paired fn
let s = unsafe { let p = make_string(); let r = CStr::from_ptr(p).to_str()?.to_owned(); free_string(p); r };
```

---

## Clean Code

- **One conversion site per direction.** A single `to_c_string` / `from_c_string` helper, not scattered encode/decode calls.
- **Encode ownership in the type or name.** `OwnedCStr` vs `BorrowedCStr`, or `must_free_with_demo_free` in the name/comment.
- **Wrap handles in a safe type** with a destructor (`Drop`/`IDisposable`/`__del__`) that calls the paired free exactly once.
- **Keep `unsafe`/`DllImport` blocks tiny and audited.** The rest of the code should never see a raw pointer.
- **Centralize the C declarations** so type sizes (`int32_t`, `size_t`) are stated once and reviewed.

---

## Best Practices

- State the encoding explicitly at the boundary; never assume the C side's charset matches yours.
- Always force C struct layout (`#[repr(C)]`, `Sequential`, ctypes `Structure`); never trust default layout, especially in Rust.
- Map integers to fixed-width types; avoid language `long` for C `long` unless you've confirmed LP64 vs LLP64.
- Specify `bool` width explicitly (`MarshalAs(UnmanagedType.I1)`, etc.).
- Pin for the shortest possible window; prefer `fixed`/critical-array scopes over long-lived pinned handles.
- For returned pointers, encode the ownership convention in code (a wrapper type that frees in its destructor, or a comment + matching free call).
- Add `GC.KeepAlive` (or equivalent) whenever a native side stores or uses a pointer past the managed object's last managed use.
- Validate buffer lengths on both sides; pass length alongside every pointer.

---

## Edge Cases & Pitfalls

- **`long` size flip** between Linux and Windows silently corrupts struct reads and argument values.
- **Interior NUL** truncates a C string; Rust's `CString::new` errors on it — don't `unwrap()` blindly on untrusted input.
- **Packed C structs** (`#pragma pack(1)`) need matching `Pack`/`_pack_`; otherwise your offsets gain phantom padding.
- **Critical-array misuse:** calling back into the JVM, allocating, or blocking while holding a `GetPrimitiveArrayCritical` pointer can deadlock or break GC.
- **Pinning leaks:** a `GCHandle.Alloc(Pinned)` never `Free()`d permanently pins and fragments the heap.
- **Returning a pointer into a moved/freed buffer:** zero-copy where the source is dropped or unpinned right after the call.
- **`bool` width mismatch:** reading a 1-byte C `_Bool` as a 4-byte managed BOOL reads three garbage bytes.

---

## Common Mistakes

- Using your language's `long` for C `long` and shipping it cross-platform.
- Calling plain `free` on memory that needs the library's paired free function (allocator mismatch).
- Forgetting `GC.KeepAlive` and seeing intermittent "object collected" crashes only under load.
- Holding a JNI critical array too long, or doing JVM calls inside the critical window.
- Relying on Rust's default struct layout for FFI.
- Decoding a returned `char*` but also freeing a library-owned one (double-free / freeing static memory).

---

## Tricky Points

- A `CStr` borrows; a `CString` owns. Mixing them up is the difference between "read it" and "free it."
- `GetPrimitiveArrayCritical` may or may not copy; you cannot assume zero-copy, only that GC is constrained while you hold it.
- CPython's reference-counting GC doesn't move objects, so Python pinning is mostly about keeping the *refcount* up, not preventing relocation — different from Java/.NET.
- A status-code function may leave the out-parameter *uninitialized* on failure; reading it after a nonzero status is itself a bug.
- Go's pinning model is a *rule about pointer retention*, not an API call in the .NET sense — "C must not retain Go pointers."

---

## Test Yourself

1. List the three independent questions every cross-boundary string poses.
2. Why does `struct S { char a; int b; }` occupy 8 bytes, not 5?
3. What does `GC.KeepAlive` accomplish that `fixed`/pinning does not?
4. Why is a language's `long` a dangerous choice for a C `long` in portable code?
5. When you receive a `char*` from `strerror`, do you free it? Why or why not?
6. What's the difference between Rust's `CStr` and `CString`?

<details>
<summary>Answers</summary>

1. (a) Length/termination (NUL vs counted), (b) encoding (UTF-8/UTF-16/etc.), (c) ownership of a returned string (who frees, with what).
2. Padding: `int b` must be 4-aligned, so 3 padding bytes follow `a` (offset 1–3), putting `b` at offset 4; total 8.
3. `KeepAlive` extends an object's *lifetime* (prevents collection) up to a code point; pinning prevents *movement* (and gives a stable address). You may need both — a pinned-but-collectible object is still wrong; a kept-alive-but-movable buffer is still wrong for a stored raw pointer.
4. `long` is 64-bit on 64-bit Unix (LP64) but 32-bit on 64-bit Windows (LLP64), so the same code marshals different sizes per platform. Use fixed-width types.
5. No — `strerror` returns a pointer to library-owned (often static) memory. Freeing it is a crash.
6. `CString` owns a heap NUL-terminated buffer that Rust allocated and will free on drop; `CStr` is a borrowed, unowned view of an existing C string and frees nothing.

</details>

---

## Tricky Questions

- **A binding works on Linux, crashes on Windows.** First suspects: `long` width (LP64 vs LLP64) in a struct or signature, or a wide-vs-UTF-8 string assumption.
- **A C# bool field is sometimes `true` when it should be `false`.** Default `bool` marshals as 4-byte BOOL; the C side wrote 1 byte, leaving 3 garbage bytes. Add `[MarshalAs(UnmanagedType.I1)]`.
- **A buffer is correct in unit tests but corrupts under load in Java.** A critical-array window that's too long, or GC pressure relocating an unpinned array.
- **A returned string is fine, then the program crashes on exit.** You freed library-owned memory, or freed callee-allocated memory with the wrong allocator.

---

## Cheat Sheet

```text
STRINGS — three questions: termination? encoding? who frees?
  Go/Rust string: (ptr,len), UTF-8, NO NUL -> CString to call C
  Java/C#: UTF-16 -> transcode to UTF-8 (or wide) explicitly
  Reading back: Rust CStr (borrow), Go C.GoString (copy),
                C# Marshal.PtrToStringUTF8, Python c_char_p.value

STRUCTS — force C layout, match field sizes
  Rust #[repr(C)] | C# [StructLayout(Sequential)] | ctypes Structure
  Watch: padding/alignment, #pragma pack -> Pack/_pack_, long width

ARRAYS — pointer + length; copy or zero-copy
  zero-copy needs the bytes valid + UNMOVED for the whole call

PINNING / LIFETIME
  C#:   fixed { } (scoped) | GCHandle.Alloc(Pinned) (long-lived, Free it)
        GC.KeepAlive(obj) to prevent collection across stored pointers
  Java: GetPrimitiveArrayCritical (short, no JVM calls inside) + Release
  Go:   "C must not retain Go pointers"; C-allocate long-lived shared buffers
  Py:   non-moving GC; keep a reference (refcount) alive

OWNERSHIP — allocator X allocates -> allocator X frees
  caller-allocates-callee-fills (safest)
  callee-allocates -> PAIRED free fn (not plain free)
  callee-owns -> do NOT free

NUMBERS
  long: 64-bit LP64 (Unix) vs 32-bit LLP64 (Win64) -> use fixed-width
  size_t/intptr_t -> usize/isize, nuint/nint, c_size_t
  bool: pin down the width (often I1)
```

---

## Summary

Marshalling resolves into four contracts. **Strings** demand answers to three questions — termination, encoding, ownership — and Go/Rust strings (counted, UTF-8, no NUL) sit opposite C's NUL-terminated `char*`. **Structs** must reproduce C's exact offsets, which means forcing C layout (`#[repr(C)]`, `Sequential`, ctypes `Structure`), matching alignment/padding, and matching field sizes including the `long` LP64/LLP64 trap. **Arrays/buffers** travel as pointer + length, copied or zero-copy, and zero-copy in GC languages requires **pinning** plus a live reference — `fixed`/`GCHandle`/`GC.KeepAlive` in .NET, `GetPrimitiveArrayCritical` in Java, the "no retained Go pointers" rule in Go. **Ownership** rides the allocator-matching law and three conventions for who frees a returned pointer. Master the four and "random" FFI crashes become diagnosable.

---

## What You Can Build

- A binding to a C library that uses status-code + out-parameter functions, correctly checked.
- A zero-copy image/audio buffer bridge with proper pinning in Java or .NET.
- A safe Rust wrapper type around a C opaque handle that frees exactly once on drop.
- A cross-platform binding that survives the LP64/LLP64 `long` difference by using fixed-width types.

---

## Further Reading

- Your runtime's marshalling reference: .NET `Marshal`/`StructLayout`/`MarshalAs`, JNI string and array functions, Rust `std::ffi` (`CString`, `CStr`), Go cgo documentation, Python `ctypes` and the buffer protocol.
- The C ABI and struct layout rules (alignment, padding) for your platform.
- UTF-8 vs UTF-16 transcoding references.
- This topic's `senior.md` (ABI-exact layout, GC internals, zero-copy at scale).

---

## Related Topics

The foreign function interface basics; calling conventions and the C ABI; garbage collection internals (moving vs non-moving collectors); text encodings; memory allocators and the heap; the previous and following topics in this FFI section.

---

## Diagrams & Visual Aids

```text
Struct padding (struct { char a; int b; char c; double d; }):

  offset:  0    1  2  3   4    5  6  7   8    9 ...15  16          23
          [a] [pad pad pad][   b   ][c][pad...... pad][     d      ]
           1B   3B padding   4B int  1B   7B padding     8B double
  total size = 24 (rounded to 8-byte alignment), NOT 14.


Lifetime window (must cover C's use of the pointer):

  managed alloc ─┬─ pin/keepalive ──[ C uses pointer ]── unpin ─┬─ free
                 │<──────────── valid & unmoved ───────────────>│
   BUG: unpin or free here  ──▶  C reads moved/freed memory.


Ownership decision tree for a returned pointer:

  Did C allocate it?
     ├─ No (you allocated) ............... you free, your allocator
     └─ Yes
          ├─ Library gives a free_x()? ... call free_x()  (NOT plain free)
          └─ Docs say library-owned? ..... do NOT free
          └─ Unclear? ..................... do NOT free; go find out
```
