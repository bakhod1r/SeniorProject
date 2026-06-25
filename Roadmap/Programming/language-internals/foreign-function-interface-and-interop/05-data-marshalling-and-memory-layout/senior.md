# Data Marshalling & Memory Layout — Senior Level

> **Topic:** [Data Marshalling & Memory Layout](README.md)
> **Focus:** ABI-exact struct layout, GC pinning against moving collectors, zero-copy buffers at scale, and the ownership/lifetime contracts that make a binding crash-free instead of crash-sometimes.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Core Concepts](#core-concepts)
3. [Mental Models](#mental-models)
4. [Code Examples](#code-examples)
5. [Best Practices](#best-practices)
6. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
7. [Summary](#summary)

---

## Introduction

> Focus: **The four marshalling contracts — layout, lifetime, ownership, encoding — re-stated at the level of the C ABI, the garbage collector's relocation behavior, and the allocator boundary, so you can design a binding that does not corrupt the heap under load.**

At the middle level you learned the four contracts and the per-runtime tool for each. At the senior level the question shifts from "which tool" to "what exactly is the machine doing, and where is the contract enforced — or not enforced — at the byte and instruction level?" A binding that passes its tests and then segfaults once an hour in production is failing a contract that the test never stressed: a GC cycle that landed mid-call, an allocator mismatch that only corrupts the heap occasionally, a struct whose padding differs by one byte on the customer's compiler.

The senior skill is to reason about marshalling the way the ABI document and the GC source reason about it. A `struct` is not "fields"; it is a sequence of offsets dictated by alignment rules that the C compiler and your runtime must agree on byte-for-byte. A "pointer into a managed array" is not a stable address; it is a *currently-valid* address that a moving collector is free to invalidate at the next safepoint unless you have explicitly told it not to. "Who frees this" is not etiquette; it is the difference between returning memory to the heap that allocated it and handing `glibc`'s `free` a pointer that came from Rust's allocator — which is undefined behavior that may corrupt freelist metadata and detonate three function calls later.

This page is organized around the contracts as the machine sees them: **layout matching against the C ABI**, **pinning against moving GCs**, **zero-copy vs copy buffers**, and **ownership/lifetime including opaque handles**. The recurring theme: at the FFI boundary every runtime invariant you rely on — type safety, bounds checks, the borrow checker, the GC's right to move things — is suspended, and you re-establish each one by hand, per call, with full knowledge of what the other side's ABI expects.

---

## Core Concepts

### 1. Struct layout must match the C ABI byte-for-byte

A C struct's layout is fully determined by three rules applied in declaration order:

1. **Each field is placed at the next offset that is a multiple of its alignment.** A 4-byte `int` goes at the next offset divisible by 4; an 8-byte `double` at the next offset divisible by 8.
2. **Padding bytes are inserted** between fields to satisfy rule 1.
3. **The struct's total size is rounded up to a multiple of its largest member's alignment**, so that arrays of the struct keep every element aligned.

```c
struct Packet {
    uint8_t  type;    // offset 0, size 1
    // 3 bytes padding (so len is 4-aligned)
    uint32_t len;     // offset 4, size 4
    uint8_t  flags;   // offset 8, size 1
    // 7 bytes padding (so ts is 8-aligned)
    uint64_t ts;      // offset 16, size 8
};                    // sizeof == 24, alignof == 8
```

Every runtime that wants to read or write this struct must reproduce **the same offsets**. The mechanisms:

| Runtime | How you force C layout |
|---------|------------------------|
| **Rust** | `#[repr(C)]` — fixes declaration order, C alignment, C padding. Default `repr(Rust)` is unspecified and the compiler *may reorder fields*. |
| **C#/.NET** | `[StructLayout(LayoutKind.Sequential)]` keeps declaration order with platform padding; add `Pack = n` to mirror a packed C struct. |
| **Python** | `ctypes.Structure` subclass with `_fields_` in order; ctypes computes the same padding; set `_pack_` for packed structs. |
| **Go (cgo)** | Use the generated `C.struct_Packet`; it carries C's layout. A hand-rolled Go struct must replicate field order *and* explicit padding fields. |
| **Java** | No raw struct layout in classic JNI — marshal field-by-field, or use the Foreign Function & Memory API's `MemoryLayout` with explicit `paddingLayout`. |

The senior nuance is the failure mode: a single divergence in one field's offset means **every byte from that field onward is garbage**, because both sides walk the same memory with different maps. The bug is not "field `len` is wrong"; it is "field `len` and everything after it is reinterpreted." That is why a one-byte padding difference (e.g. a packed struct read as unpacked) silently corrupts an entire record.

**Packing.** A C header with `#pragma pack(1)` (or `__attribute__((packed))`) removes inter-field padding. If your side doesn't mirror it (`Pack = 1`, `_pack_ = 1`, `#[repr(C, packed)]`), your offsets gain phantom padding and diverge. Packed structs also create *unaligned fields*, which on some architectures (older ARM, some DSPs) fault on access, and which in Rust make taking a reference to a packed field undefined behavior — read by value instead.

**Bitfields, unions, enums.** C bitfields have *implementation-defined* layout (the order of bits within the storage unit is not standardized across compilers); never marshal them across an FFI boundary by reinterpreting bytes — expose accessor functions instead. C `union`s map to `#[repr(C)] union`, `ctypes.Union`, or `[StructLayout(LayoutKind.Explicit)]` with overlapping `[FieldOffset]`s. A C `enum`'s underlying integer type can vary (often `int`, but compilers may shrink it); pin it down with the C side's actual width.

### 2. Pinning: keeping managed memory still across a native call

Compacting collectors — HotSpot's G1/Parallel/Serial, .NET's, Go's — relocate live objects to defragment the heap. The instant a relocation happens, any raw pointer you handed to C points at freed-or-reused memory. Pinning suppresses the move for a window.

**.NET — three tools, three lifetimes.**

- `fixed (byte* p = arr) { ... }` pins for the lexical scope of the block. The JIT emits a pin that the GC honors at any safepoint inside the block. Cheapest; use for the duration of a single call.
- `GCHandle.Alloc(obj, GCHandleType.Pinned)` pins until you call `Free()`. Use for a pointer C retains across multiple managed calls (a callback context, a long-lived buffer). You *must* `Free()` it or the object is permanently pinned and the heap fragments.
- `GC.KeepAlive(obj)` does **not** pin — it prevents *collection* (not movement) by acting as a use of the object at that code point. You need it when C holds a pointer derived from `obj` but the JIT, seeing no further managed use, could let the GC collect `obj` mid-call.

The senior distinction: **pinning prevents movement; KeepAlive prevents collection.** A buffer you handed to C via an unmanaged pointer needs pinning (stable address) *and* keep-alive (the object must not be collected). A `fixed` block gives you both for its scope; a raw `GCHandle.AddrOfPinnedObject` gives you a stable address but you still must keep the handle reachable.

**Java (JNI).** `GetPrimitiveArrayCritical`/`ReleasePrimitiveArrayCritical` gives you a (usually) direct pointer into the array and effectively suspends GC for that window. The contract is strict: between Get and Release you must do *minimal* work, must not call back into the JVM, must not allocate, must not block — because the whole GC is held hostage. The looser `GetByteArrayElements` may instead hand you a *copy*; you cannot tell which, so you must `Release` with the correct mode (`0` to copy back and free, `JNI_ABORT` to discard). The FFM API replaces this with explicit `Arena` lifetimes and off-heap `MemorySegment`s, sidestepping pinning by allocating outside the GC heap.

**Go.** Go's collector is moving for goroutine stacks and (as of recent runtimes) can move heap objects in limited ways; more importantly, cgo enforces a *pointer-passing rule*: you may pass a Go pointer to C for the duration of a call, but **C must not retain it past the return**, and the Go memory it points to must not itself contain Go pointers. `runtime.Pinner` (Go 1.21+) lets you pin specific objects for bounded windows when you genuinely need C to hold a Go pointer briefly. For anything long-lived shared with C, allocate in C (`C.malloc`) so the Go GC never sees it.

**Python (CPython).** The reference-counting collector is **non-moving** — objects never relocate — so there is no pinning in the .NET/Java sense. The discipline is purely lifetime: keep the `refcount` above zero (hold a Python reference) for as long as C holds the pointer. `from_buffer` views and `ctypes` arrays must outlive every native use. The cyclic GC can run, but it only collects unreachable cycles; a reachable buffer is safe.

### 3. Zero-copy vs copy buffers

A buffer crosses as **pointer + length** (C has no length-carrying array). Two strategies:

- **Copy.** Allocate a fresh C buffer, copy data in, call, copy results back. Simple, safe, allocator-clean. Costs a memcpy and an allocation per call — fine for small/occasional data, a bottleneck for large/frequent data (image frames, audio blocks, network packets).
- **Zero-copy.** Hand C a pointer *directly into your runtime's memory*. No copy; near-native throughput. The price: the bytes must stay **valid** (not freed) and **unmoved** (not relocated) for the entire window C uses them — which means pinning in moving-GC runtimes and a live reference everywhere.

**Python's buffer protocol** is the canonical zero-copy mechanism. `memoryview`, `bytearray`, and any object exposing `__buffer__`/the C-level `bf_getbuffer` expose their raw bytes with shape/stride metadata. **NumPy** exposes `arr.ctypes.data` (the raw pointer) and `__array_interface__`; because CPython doesn't move objects, a NumPy array's data pointer is stable as long as the array is alive — which makes NumPy↔C zero-copy comparatively safe. The discipline that remains: don't let the array be garbage-collected (keep a reference), and respect strides — a non-contiguous slice has no single flat buffer, so request a C-contiguous view (`np.ascontiguousarray`) before handing the pointer to code that assumes contiguity.

**The contiguity and strides trap.** A 2-D array slice, a transposed view, or a Fortran-ordered array is *not* a flat C buffer. Passing `arr.ctypes.data` for such a view hands C a pointer whose memory layout doesn't match what C's `row*width + col` indexing expects. Always confirm contiguity and ownership of the underlying buffer before zero-copy.

### 4. Ownership and lifetime: the allocator boundary

The law under every ownership convention: **memory allocated by allocator X must be freed by allocator X.** Rust's `String` lives in Rust's global allocator; a C `malloc` buffer lives in libc's allocator; a .NET array lives in the GC heap; a Go slice lives in Go's heap. Freeing across these boundaries is undefined behavior — at best a no-op, at worst freelist corruption that crashes later, somewhere unrelated.

The three ownership conventions and their precise failure modes:

| Convention | Who allocates / frees | Failure if violated |
|------------|----------------------|---------------------|
| **Caller allocates, callee fills** | Caller allocates and frees; callee writes into it | Buffer too small → C overruns it → heap/stack corruption. Mitigate with a "query size then allocate" two-call protocol. |
| **Callee allocates, caller frees via paired fn** | Callee allocates with its allocator; caller calls the *library's* `free_x()` | Calling plain `free` instead → allocator mismatch → corruption. Not calling it → leak. |
| **Callee allocates, callee owns** | Callee allocates and frees (or it's static) | Caller frees it → double-free or freeing static memory → crash. |

**Opaque handles** are the clean design for callee-owned complex objects. C returns a `void*` (or a typed-but-incomplete pointer); you pass it back to every operation and **never dereference it**. This decouples your binding from C's internal struct — the struct can grow, shrink, or reorder across library versions and your binding doesn't break, because you never assumed a layout. Wrap the handle in a safe type (`Drop` in Rust, `IDisposable`/`SafeHandle` in .NET, `__del__`/context manager in Python, a `Close()` method in Go) that calls the paired destructor exactly once. `SafeHandle` in .NET is the gold standard: it makes the handle's lifetime GC-tracked and guarantees the finalizer runs even if you forget to dispose, while preventing the handle from being recycled mid-call.

The **two-call size protocol** (caller-allocates, but the caller doesn't know the size) is worth naming because it appears everywhere in Win32 and POSIX: call once with a null buffer to learn the required length, allocate, call again to fill. The marshalling layer must handle the first call's "buffer too small" return code without treating it as an error.

### 5. Lifetime is an interval, not a point

Validity is a window: the data must be valid *from the moment C receives the pointer until the moment C is done with it*. If C stores the pointer (registers a callback context, keeps a buffer for async I/O), that window extends past the call return. Most lifetime bugs are a window that is too *narrow* — you freed, dropped, unpinned, or let the refcount hit zero while C still held the pointer. The senior habit is to ask, for every pointer that crosses: *"How long does the other side hold this — just the call, or longer? And what keeps it valid for that whole interval?"*

---

## Mental Models

### Model 1: The struct is a contract drawn in offsets

Don't think "fields"; think "a map from offset to type that both sides must share exactly." When a struct binding misbehaves, draw the byte layout on both sides — offsets, sizes, padding — and the divergence is almost always visible. A field two bytes off, a missing pad, a `long` that's 4 bytes here and 8 there. Bytes don't lie.

### Model 2: A managed pointer is a lease, not a deed

When you take the address of a managed array, you hold a *lease* that the GC can revoke at the next safepoint. Pinning converts the lease into a deed for a bounded term. Forgetting to pin means the GC can foreclose mid-call. The pointer's value was correct the instant you read it and wrong the instant the collector ran.

### Model 3: Every allocation has exactly one rightful undertaker

The allocator that created a block is the only one that may free it. A returned pointer carries an implicit "free me with *this* function" tag that the type system can't see. Encode that tag in your code — a wrapper type, a paired-free call, a comment — because the moment it's ambiguous, someone calls the wrong `free` and the heap corrupts silently.

### Model 4: Zero-copy trades safety for speed, and you pay the safety back by hand

Copying is safe because the moment of copy severs the lifetime dependency. Zero-copy keeps that dependency alive, so you must manually guarantee validity + immovability for the whole window. The performance win is real; so is the obligation.

---

## Code Examples

### Rust: ABI-exact struct, opaque handle, paired free

```rust
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};

// Byte-for-byte match for the C `struct Packet` above.
#[repr(C)]
struct Packet {
    type_: u8,    // offset 0
    len: u32,     // offset 4 (compiler inserts 3 bytes padding before it)
    flags: u8,    // offset 8
    ts: u64,      // offset 16 (7 bytes padding before it)
}                 // size 24, align 8 — matches C

// Opaque handle: we never see inside `Parser`.
#[repr(C)]
struct Parser {
    _private: [u8; 0],   // zero-sized, !Send/!Sync-friendly opaque marker
}

extern "C" {
    fn parser_new() -> *mut Parser;
    fn parser_feed(p: *mut Parser, buf: *const u8, len: usize) -> c_int;
    fn parser_free(p: *mut Parser);          // paired destructor
    fn lib_strdup(s: *const c_char) -> *mut c_char; // C mallocs
    fn lib_free(p: *mut c_char);             // paired free for lib_strdup
}

/// Safe RAII wrapper: frees exactly once on drop, with the PAIRED free.
struct SafeParser(*mut Parser);
impl SafeParser {
    fn new() -> Self { SafeParser(unsafe { parser_new() }) }
    fn feed(&mut self, data: &[u8]) -> i32 {
        unsafe { parser_feed(self.0, data.as_ptr(), data.len()) }
    }
}
impl Drop for SafeParser {
    fn drop(&mut self) { unsafe { parser_free(self.0) } } // exactly once
}

fn dup_string(s: &str) -> String {
    let input = CString::new(s).expect("no interior NUL");
    unsafe {
        let out = lib_strdup(input.as_ptr()); // C owns `out`
        let owned = CStr::from_ptr(out).to_string_lossy().into_owned(); // copy
        lib_free(out as *mut c_char);          // allocator match!
        owned
    }
    // `input` is freed by Rust's allocator when it drops — also matched.
}

fn assert_layout() {
    assert_eq!(std::mem::size_of::<Packet>(), 24);
    assert_eq!(std::mem::align_of::<Packet>(), 8);
    // memoffset::offset_of!(Packet, ts) == 16 in a real test
}
```

`SafeParser` ties the C object's lifetime to a Rust value; `dup_string` frees the C-allocated string with the C-paired free and lets Rust free the `CString` — no allocator crossing.

### C#: SafeHandle, pinning, KeepAlive, explicit numeric widths

```csharp
using System;
using System.Runtime.InteropServices;

static class Native {
    // size_t -> nuint; explicit bool width; UTF-8 string marshalling.
    [DllImport("demo", CharSet = CharSet.Utf8)]
    public static extern int demo_parse(string s,
        [MarshalAs(UnmanagedType.I1)] out bool ok, out int value);

    [DllImport("demo")] public static extern unsafe void demo_fill(byte* p, nuint n);
    [DllImport("demo")] public static extern IntPtr parser_new();
    [DllImport("demo")] public static extern void parser_free(IntPtr p);
    [DllImport("demo")] public static extern IntPtr register_buffer(byte[] b); // C retains ptr
}

// SafeHandle: GC-tracked lifetime, guaranteed single free, no mid-call recycle.
sealed class ParserHandle : SafeHandle {
    public ParserHandle() : base(IntPtr.Zero, ownsHandle: true) { }
    public override bool IsInvalid => handle == IntPtr.Zero;
    protected override bool ReleaseHandle() { Native.parser_free(handle); return true; }
}

static class Demo {
    static unsafe void FillZeroCopy(byte[] data) {
        fixed (byte* p = data) {                // pin + keep-alive for the block
            Native.demo_fill(p, (nuint)data.Length);
        }                                        // unpinned here
    }

    static void RegisterAndUse(byte[] buf) {
        IntPtr ctx = Native.register_buffer(buf); // C now holds a ptr derived from buf
        // ... buf has no further managed use; the JIT could let the GC collect it.
        DoOtherWork(ctx);
        GC.KeepAlive(buf);   // extend buf's lifetime to cover the native use
    }
    static void DoOtherWork(IntPtr ctx) { }
}
```

`fixed` pins for the call; `GC.KeepAlive(buf)` covers the case where C retains a pointer past a method that has no other use of `buf`; `[MarshalAs(I1)]` stops the default 4-byte `BOOL` from reading three garbage bytes.

### Python (ctypes/NumPy): zero-copy with contiguity check and a live reference

```python
import ctypes, numpy as np

lib = ctypes.CDLL("./libdemo.so")
# void demo_sum(const double *p, size_t n, double *out);
lib.demo_sum.argtypes = [ctypes.POINTER(ctypes.c_double),
                         ctypes.c_size_t,
                         ctypes.POINTER(ctypes.c_double)]

def sum_zero_copy(arr: np.ndarray) -> float:
    # A slice/transpose may be non-contiguous -> force a C-contiguous buffer.
    arr = np.ascontiguousarray(arr, dtype=np.float64)
    out = ctypes.c_double()
    ptr = arr.ctypes.data_as(ctypes.POINTER(ctypes.c_double))  # raw pointer, no copy
    lib.demo_sum(ptr, arr.size, ctypes.byref(out))
    # `arr` is referenced until this line returns -> non-moving GC keeps it valid.
    return out.value
```

The `ascontiguousarray` call is the senior detail: without it, a transposed or strided view hands C a pointer whose memory does not match flat `p[i]` indexing.

### Go (cgo): allocator matching and the no-retained-pointer rule

```go
/*
#include <stdlib.h>
char *lib_dup(const char *s);   // mallocs a copy; caller frees with C.free
void  lib_free(char *p);        // (if the lib ships its own free, use THAT)
*/
import "C"
import "unsafe"

func dup(s string) string {
    cs := C.CString(s)               // Go -> C buffer, C allocator
    defer C.free(unsafe.Pointer(cs)) // free with C allocator: matched

    out := C.lib_dup(cs)             // C owns `out`
    defer C.free(unsafe.Pointer(out))// caller frees C-allocated result
    return C.GoString(out)           // copy back into a Go string
    // Rule: C must NOT retain `cs`/`out` past these calls, and the Go memory
    // we pass must not itself contain Go pointers handed to C.
}
```

### Layout self-test (any language)

```c
/* Ship this in the C library so bindings can verify they agree. */
#include <stddef.h>
size_t packet_size(void)      { return sizeof(struct Packet); }   /* 24 */
size_t packet_off_ts(void)    { return offsetof(struct Packet, ts); } /* 16 */
```

A binding's test suite calls these and asserts its own `sizeof`/offset match. This catches packing and `long`-width drift *at startup*, not in production.

---

## Best Practices

- **Force C layout on every marshalled struct** (`#[repr(C)]`, `LayoutKind.Sequential`, `ctypes.Structure`, FFM `MemoryLayout`). Never rely on default layout — Rust's especially is free to reorder.
- **Mirror packing explicitly.** If the C header packs, set `Pack`/`_pack_`/`repr(C, packed)`; read packed fields by value, never by reference (unaligned-reference UB in Rust).
- **Map integers to fixed widths** (`int32_t`↔`i32`, `int64_t`↔`i64`). Use a runtime's `long` only when you truly mean the platform `long`, and know LP64 vs LLP64.
- **Pin the shortest possible window.** Prefer scoped pins (`fixed`, critical-array) over long-lived `GCHandle`/`Pinner`; long pins fragment the heap.
- **Distinguish pin from keep-alive.** Pin for a stable address; `GC.KeepAlive` (or equivalent) whenever C retains a pointer past the object's last managed use.
- **Wrap every opaque handle in a safe owner** with a single-free destructor (`Drop`, `SafeHandle`/`IDisposable`, `__del__`/context manager). Prefer `SafeHandle` over raw `IntPtr` in .NET.
- **Match allocators religiously.** Callee-allocated memory is freed with the library's paired free, never plain `free`.
- **Add a layout self-test.** Have the C side export `sizeof`/`offsetof` helpers; assert against them at startup so packing/width drift fails loudly.
- **Prefer copy for small/occasional data; reserve zero-copy for hot, large buffers** — and only after confirming contiguity and immovability.
- **Validate buffer lengths on both sides** and pass length with every pointer; for unknown sizes use the two-call query-then-fill protocol.

---

## Edge Cases & Pitfalls

- **Packed-vs-unpacked mismatch.** Reading a `#pragma pack(1)` struct as unpacked inserts phantom padding; every field after the first divergence is garbage. Symptom: the first one or two fields look right, the rest is noise.
- **`long` width flip (LP64 vs LLP64).** Same code marshals a 64-bit `long` on Linux/macOS and a 32-bit `long` on 64-bit Windows. Corrupts struct reads and argument passing. Use fixed-width types.
- **`bool`/`_Bool` width.** .NET marshals `bool` as a 4-byte `BOOL` by default; a 1-byte C `_Bool` leaves 3 garbage bytes. Force `[MarshalAs(UnmanagedType.I1)]`. Other runtimes vary too — pin the width down.
- **Forgetting to pin a buffer handed to async/retained C.** Works in tests (no GC ran), corrupts under load (GC relocated the array while C held the pointer). The classic "works locally, crashes in prod" FFI bug.
- **Missing keep-alive across a stored pointer.** The JIT sees no further use of the managed object, the GC collects it, and C dereferences freed memory. Intermittent, load-dependent.
- **JNI critical-array misuse.** Calling back into the JVM, allocating, or blocking while holding `GetPrimitiveArrayCritical` can deadlock or stall the whole GC. Keep the window tiny and pure.
- **Permanently pinned `GCHandle`.** A `GCHandleType.Pinned` handle never `Free()`d pins the object forever and fragments the heap — a slow memory/perf leak.
- **Non-contiguous NumPy view passed zero-copy.** A transposed or strided array's data pointer doesn't match flat indexing; force `ascontiguousarray` first.
- **Bitfields across the boundary.** C bitfield bit-order is implementation-defined; never reinterpret their bytes — use accessor functions.
- **Double-free / freeing static memory.** Freeing a library-owned (`callee-owns`) returned pointer, or freeing callee-allocated memory with the wrong allocator, corrupts the heap.
- **Unaligned access on strict architectures.** Packed/misaligned reads fault on some ARM/DSP targets even though x86 tolerates them — a portability landmine.

---

## Summary

At the senior level the four marshalling contracts are re-stated against the machine. **Layout** means reproducing the C ABI's offsets byte-for-byte — alignment, padding, packing, total size — via `#[repr(C)]`, `LayoutKind.Sequential`, `ctypes.Structure`, or FFM `MemoryLayout`, and one diverging offset corrupts every field after it. **Lifetime** means pinning managed buffers against moving collectors (`fixed`/`GCHandle` in .NET, `GetPrimitiveArrayCritical` in JNI, `runtime.Pinner`/no-retained-pointers in Go, refcount-keep-alive in non-moving CPython), and distinguishing pinning (stable address) from keep-alive (no collection). **Zero-copy** buys near-native throughput by handing C a pointer into your memory, at the price of guaranteeing validity and immovability for the whole window — Python's buffer protocol and NumPy make this practical, with contiguity as the trap. **Ownership** rides the allocator-matching law and the three conventions (caller-fills, callee-allocates-paired-free, callee-owns), with opaque handles plus single-free wrapper types as the safe default. Master these as the ABI and GC see them, and "random" FFI crashes become diagnosable failures of a specific, named contract.

---
