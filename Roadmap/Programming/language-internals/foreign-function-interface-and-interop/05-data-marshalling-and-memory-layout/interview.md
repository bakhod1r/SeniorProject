# Data Marshalling & Memory Layout — Interview Questions

> **Topic:** [Data Marshalling & Memory Layout](README.md)

## Introduction

These questions probe whether you can write and debug a real binding, not just recite definitions. Interviewers in systems, runtime, and infrastructure roles use this topic to separate engineers who have *shipped* FFI code — and seen it crash in production — from those who have only read about it. The questions cluster around four hard problems: string impedance, struct layout, pinning/lifetime, and allocator ownership. The best answers name the precise failure mode ("the GC moved the buffer," "you freed library-static memory," "LP64 vs LLP64") rather than waving at "it's a memory bug."

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky-Trap](#tricky-trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What are the four core problems every data-marshalling boundary must solve?**

Encoding (bytes mean the same characters on both sides), layout (struct fields sit at the same byte offsets), lifetime (the data stays valid and unmoved for as long as both sides need it), and ownership (exactly one allocator frees each allocation). A binding is correct iff all four hold; each one, when broken, has a signature failure — mojibake, garbage fields, use-after-free/GC-move crash, leak or double-free.

## Question 2

**Why does `struct { char a; int b; }` occupy 8 bytes instead of 5?**

Alignment and padding. The `int b` must be 4-byte aligned, so its address must be a multiple of 4. After `a` at offset 0, three padding bytes are inserted (offsets 1–3) to put `b` at offset 4. Total is 8, rounded to the largest member's alignment. Any side that lays the struct out without that padding reads garbage from `b` onward.

## Question 3

**What is the rule that governs which `free` may release a given allocation?**

The allocator that created a block is the only one that may free it: memory from allocator X is freed by allocator X. Allocators keep block-local metadata (freelist links, size headers) whose layout is allocator-specific, so a foreign `free` misinterprets that metadata and corrupts the heap — usually crashing later, somewhere unrelated.

## Question 4

**Distinguish zero-copy from copy buffer marshalling and the trade-off.**

Copy allocates a fresh native buffer and memcpys data across; it's simple and severs the lifetime dependency, at the cost of an allocation and a copy per call. Zero-copy hands C a pointer directly into your runtime's memory; it's near-native fast but the bytes must stay valid (not freed) and unmoved (not relocated) for the whole window C uses them — which means pinning in moving-GC runtimes plus a live reference.

## Question 5

**What is the difference between pinning and keep-alive?**

Pinning prevents *movement* — it gives C a stable address by telling a moving GC not to relocate the object. Keep-alive (e.g. `GC.KeepAlive`) prevents *collection* — it forces the runtime to consider the object reachable up to a code point. A retained native pointer often needs both: a stable address (pin) and a guarantee the object isn't reclaimed (keep-alive).

## Question 6

**Why is a struct with a C bitfield dangerous to marshal by reinterpreting bytes?**

C bitfield bit-ordering within the storage unit is implementation-defined — different compilers and ABIs can place the same bits differently. Reinterpreting the bytes assumes a layout the standard doesn't guarantee, so it breaks across compilers. Marshal bitfields through accessor functions instead of byte reinterpretation.

## Question 7

**What is an opaque handle and why is it a good design?**

A `void*` (or typed-but-incomplete pointer) that C returns and you pass back to every operation without ever dereferencing it. It decouples your binding from C's internal struct layout: the struct can change size, order, or contents across library versions and your binding doesn't break, because you never assumed a layout. Wrap it in a type that calls the paired destructor exactly once.

## Question 8

**What does "lifetime is an interval, not a point" mean for marshalling?**

The data must be valid from the moment C receives the pointer until the moment C is done — which may extend past the call return if C stored the pointer. Most lifetime bugs are a window that's too narrow: you freed, dropped, unpinned, or let the refcount hit zero while C still held the pointer. Pinning and keep-alive deliberately widen the window.

---

## Language-Specific

## Question 9

**Compare how C, Rust, Go, Java, and Python represent a string in memory.**

C: `char*`, NUL-terminated, encoding by convention. Rust: `String`/`&str` = (ptr, len), no terminator, guaranteed UTF-8. Go: `string` = (ptr, len), no terminator, UTF-8. Java: `String` of UTF-16 code units + length, no terminator. Python 3: abstract `str` (decoded text) vs `bytes` (raw channel). C#/.NET: `string` of UTF-16 code units. So Go/Rust must append a NUL to call C; Java/.NET must transcode UTF-16→UTF-8 or →wide; Python must explicitly `.encode()`.

## Question 10

**How do you force C-compatible struct layout in Rust, C#, Python ctypes, and Go?**

Rust: `#[repr(C)]` (default `repr(Rust)` may reorder fields — never use it for FFI). C#: `[StructLayout(LayoutKind.Sequential)]`, plus `Pack = n` to mirror packed structs. Python: subclass `ctypes.Structure` with `_fields_` in order (set `_pack_` for packed). Go (cgo): use the generated `C.struct_X`, which carries C's layout; a hand-rolled Go struct must replicate order and explicit padding.

## Question 11

**In Rust, what is the difference between `CString` and `CStr`?**

`CString` owns a heap-allocated, NUL-terminated buffer that Rust allocated and will free on drop (Rust's allocator). `CStr` is a borrowed, unowned view of an existing NUL-terminated C string — it frees nothing. Mixing them up is the difference between "free it" and "read it": dropping a `CString` built from a borrowed C pointer, or freeing what a `CStr` points at, is wrong.

## Question 12

**Name the .NET marshalling attributes for layout, string encoding, and bool width.**

`[StructLayout(LayoutKind.Sequential)]` (and `LayoutKind.Explicit` with `[FieldOffset]` for unions) controls layout. `CharSet.Utf8`/`CharSet.Unicode` on `[DllImport]`, or `[MarshalAs(UnmanagedType.LPUTF8Str)]` / `LPWStr`, controls string encoding. `[MarshalAs(UnmanagedType.I1)]` forces a 1-byte `bool` (default marshals `bool` as a 4-byte `BOOL`).

## Question 13

**How does Go's pinning model differ from .NET's `fixed`/`GCHandle`?**

Go has no general pinning API in the .NET sense; instead it enforces a *rule*: you may pass a Go pointer to C for the duration of a call, but C must not retain it past the return, and the Go memory it points to must not itself contain Go pointers handed to C. `runtime.Pinner` (Go 1.21+) pins specific objects for bounded windows. For long-lived shared buffers, allocate in C (`C.malloc`) so the Go GC never tracks them.

## Question 14

**Why doesn't CPython need pinning, and what discipline does it need instead?**

CPython's reference-counting collector is non-moving — objects never relocate — so there's no stable-address problem. The discipline is purely lifetime: keep a Python reference (refcount > 0) for as long as C holds the pointer. The trap is letting a temporary (`lib.f(make_buffer())`) be dropped at statement end while C retains it; bind it to a name that outlives the native use.

## Question 15

**What does JNI's `GetPrimitiveArrayCritical` do, and what are the rules while you hold the critical pointer?**

It gives a (usually) direct pointer into a Java array and effectively suspends GC for that window — so between Get and Release you must do minimal work and must not call back into the JVM, allocate, or block, because the whole collector is held. `GetByteArrayElements` may instead return a *copy*; you can't tell which, so you Release with the correct mode (`0` to copy back, `JNI_ABORT` to discard).

## Question 16

**How do you map `size_t` and `long` correctly across languages?**

`size_t`/`intptr_t` are pointer-width: map to `usize`/`isize` (Rust), `nuint`/`nint` (C#), `C.size_t` (Go cgo), `ctypes.c_size_t` (Python) — these are consistent because they track pointer width. `long` is the trap: it's 64-bit on LP64 (Unix) and 32-bit on LLP64 (64-bit Windows), so map C `long` to fixed-width `int32_t`/`int64_t`-equivalents and reach for a language `long` only when you truly mean the platform `long`.

---

## Tricky-Trap

## Question 17

**A binding works on Linux and crashes on Windows. What are the first two suspects?**

The LP64/LLP64 `long` width difference (64-bit on Linux, 32-bit on 64-bit Windows) silently corrupting a struct field or argument, and a wide-vs-UTF-8 string assumption (Windows wants UTF-16 wide for the `W` APIs; `wchar_t` is 2 bytes on Windows, 4 on Unix). Both are platform-specific and pass Linux tests.

## Question 18

**You call `strerror(errno)`, copy the message, then `free()` the returned pointer "to avoid a leak." What happens?**

`strerror` returns a pointer to library-owned (often static) memory; you must never free it. Calling `free` on it is undefined behavior that typically corrupts the heap silently and crashes later in an unrelated allocation. The fix: copy it out and never free a library-owned `char*`.

## Question 19

**Why does freeing a Rust `CString::into_raw` pointer with C's `free()` crash?**

The pointer was allocated by Rust's global allocator, whose block metadata layout differs from libc's. libc `free` reads metadata Rust never wrote, corrupting its freelist — usually detonating on a later, unrelated allocation. It must return to Rust via `CString::from_raw` to be dropped by the same allocator that created it.

## Question 20

**A .NET `bool` struct field is sometimes `true` when C wrote `false`. Why?**

The default marshalling treats `bool` as a 4-byte `BOOL`, but the C `_Bool` is 1 byte. .NET reads the 1 real byte plus 3 adjacent garbage bytes; when the garbage is nonzero, the field reads `true`. Fix with `[MarshalAs(UnmanagedType.I1)]` to force a 1-byte bool.

## Question 21

**A buffer is correct in unit tests but corrupts ~1 in 50,000 times under load in Java/.NET. What's happening?**

The buffer wasn't pinned, and a GC ran mid-call and relocated it; C then read or wrote the old (now freed/reused) location. It's load-dependent because it requires a GC at a precise instant, which load makes frequent and tests rarely trigger. Fix: pin (`fixed`/`GCHandle.Pinned`/`GetPrimitiveArrayCritical`) for the whole native use.

## Question 22

**A C function returns `int` status and writes the result via an out-parameter. You read the out-value, then check status. What's the bug?**

On failure the out-parameter is often left uninitialized, so reading it before verifying status reads stack garbage or a stale value. Always check the status first and only trust the out-parameter when the status indicates success.

## Question 23

**You read a `#pragma pack(1)` C struct with an unpacked struct definition on your side. What goes wrong, and what's the symptom?**

Your side inserts inter-field padding the packed C struct doesn't have, so offsets diverge. The symptom is telling: the first one or two fields read correctly, then everything from the first divergence onward is garbage — because both sides walk the same bytes with different maps. Fix: mirror the packing (`Pack = 1`, `_pack_ = 1`, `#[repr(C, packed)]`).

## Question 24

**You pass a transposed NumPy array's `ctypes.data` pointer to a C function that does `p[i]` flat indexing. Why might it produce wrong results?**

A transposed (or strided/sliced) view is not C-contiguous — its data pointer doesn't correspond to a flat row-major buffer, so flat `p[i]` indexing reads the wrong elements. Force a contiguous buffer with `np.ascontiguousarray` before handing the pointer to code that assumes contiguity.

## Question 25

**You take `&data[0]` of a managed array, store the pointer, return from the method, and use it later. Why is this wrong even if you pinned during the call?**

A scoped pin (e.g. `fixed`) ends when the block exits, after which the GC may move the array, invalidating the stored pointer. For a pointer retained past the call you need a long-lived pin (`GCHandle.Pinned`) held for the whole retention window, plus keep-alive to prevent collection — and you must `Free()` the handle afterward.

## Question 26

**In Rust, why is taking a reference to a field of a `#[repr(C, packed)]` struct undefined behavior?**

Packed fields can be unaligned, but a Rust reference must point to a properly aligned value; forming a reference to an unaligned field is UB (and on strict architectures the dereference faults). Read the field by value (a copy through `ptr::read_unaligned` or a plain field read into a local) instead of taking `&field`.

---

## Design

## Question 27

**Design a safe marshalling layer for a C library. What are the core principles?**

One conversion site per direction (not scattered encode/decode/free). Ownership encoded in types (`OwnedCStr` vs `BorrowedCStr`; `SafeHandle` not raw `IntPtr`). Allocators never cross — each allocation paired with its matching free in the same type's lifetime. Tiny, audited `unsafe`/`DllImport`/`extern` surface that never leaks raw pointers. Centralized, fixed-width C type declarations. Narrow-scope pinning plus explicit keep-alive where C retains. An ABI self-test (`sizeof`/`offsetof` from C) that fails loudly at startup. Mandatory status-checking that makes the out-value unreachable until verified.

## Question 28

**How would you wrap a C opaque handle so it can't be misused?**

Wrap the raw pointer in a type with a single-free destructor — Rust `Drop` calling the paired free, .NET `SafeHandle` (GC-tracked lifetime, guaranteed single release, no mid-call recycle), Python `__del__` or a context manager, Go a `Close()` method. The raw pointer never escapes the wrapper, so callers can't double-free, free with the wrong allocator, or dereference it.

## Question 29

**Design the protocol for a function that returns a variable-length result whose size the caller can't predict.**

The two-call (query-then-fill) protocol: call once with a null/zero buffer to learn the required length (the function returns the size or a "buffer too small" code), allocate exactly that, call again to fill. The marshalling layer treats the first call's "too small" as a normal control-flow signal, not an error, and handles the rare race where the size grows between calls (retry).

## Question 30

**How do you decide between caller-allocates-callee-fills, callee-allocates-paired-free, and callee-owns for a returned buffer?**

Caller-allocates-callee-fills when the caller can size the buffer (or via the two-call protocol) — safest, no allocator crossing, but risk of undersizing. Callee-allocates-paired-free when only the library knows the size or uses its own allocator — caller must call the library's free, never plain `free`. Callee-owns for static/internal data — caller never frees, and must copy out before the next call if the buffer is reused. Encode whichever you pick in the wrapper type.

## Question 31

**Design a zero-copy bridge for streaming audio frames from a managed runtime to a native codec. What must the design guarantee?**

The managed frame buffer must stay valid and immovable for the codec's entire use of it. Pin it (long-lived `GCHandle.Pinned` or a critical section) for the window, keep a live reference (keep-alive) so it isn't collected, pass pointer+length, and free/unpin in the completion path — including on error. If the codec retains the buffer asynchronously, the pin must span the async lifetime, not just the call. Prefer off-heap/native-allocated buffers (or .NET's pinned-object heap) for hot, long-lived frames to avoid fragmenting the GC heap.

## Question 32

**You're designing a cross-platform binding that must survive Linux and Windows. Enumerate the portability decisions.**

Use fixed-width integer types (`int32_t`/`int64_t`), never relying on C `long` (LP64 vs LLP64). Marshal strings as explicit UTF-8 or UTF-16, not "the platform `wchar_t`" (2 bytes Windows, 4 bytes Unix). Force `bool` width explicitly (1-byte). Match struct packing and add an `offsetof`/`sizeof` self-test that runs at startup on every platform. Pick the correct allocator/free per platform (e.g. `CoTaskMemFree` vs `g_free` vs libc `free`). Account for calling-convention and name-decoration differences in the `DllImport`/`extern` declarations.

---
