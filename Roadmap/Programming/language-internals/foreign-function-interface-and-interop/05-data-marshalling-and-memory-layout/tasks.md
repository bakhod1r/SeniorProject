# Data Marshalling & Memory Layout — Hands-On Tasks

> **Topic:** [Data Marshalling & Memory Layout](README.md)

## Introduction

Reading about marshalling teaches you the contracts; only writing bindings teaches you to *feel* them. These tasks build from verifying a struct's byte offsets to designing a leak-free string round-trip, pinning a buffer, reasoning through an allocator-mismatch crash, and mapping the LP64/LLP64 trap. Work in whichever runtime you're strongest in (Rust, C#, Python ctypes, Go cgo) — the contracts are the same; the tools differ. Where a task needs a C side, a tiny `cc -shared` library suffices. Each task has a self-check so you know when you're done, a hint if you're stuck, and a sparse solution sketch for the load-bearing parts.

Progression: **Warm-Up** (observe layout and encoding), **Core** (round-trip strings and structs without leaks, pin a buffer), **Advanced** (reason through allocator mismatch, map widths), **Capstone** (a small safe marshalling layer).

---

## Warm-Up

### Task W1 — Measure struct padding

Write a struct equivalent to the C struct below in your runtime, force C layout, and print its total size and the offset of each field. Compare against C's `sizeof`/`offsetof`.

```c
struct Sample {
    char     a;   // 1 byte
    int      b;   // 4 bytes
    char     c;   // 1 byte
    double   d;   // 8 bytes
};
```

**Self-check:** You should get `sizeof == 24`, with offsets `a=0, b=4, c=8, d=16`. If you get 14, you didn't force C layout.

<details><summary>Hint</summary>
Rust: `#[repr(C)] struct Sample { a: u8, b: i32, c: u8, d: f64 }` then `std::mem::size_of::<Sample>()` and the `memoffset::offset_of!` macro. C#: `[StructLayout(LayoutKind.Sequential)]` + `Marshal.SizeOf` and `Marshal.OffsetOf`. Python: subclass `ctypes.Structure`, read `ctypes.sizeof(Sample)` and `Sample.b.offset`.
</details>

<details><summary>Solution sketch</summary>

```python
import ctypes
class Sample(ctypes.Structure):
    _fields_ = [("a", ctypes.c_char), ("b", ctypes.c_int),
                ("c", ctypes.c_char), ("d", ctypes.c_double)]
print(ctypes.sizeof(Sample))   # 24
print(Sample.b.offset, Sample.d.offset)  # 4 16
```
The 3 padding bytes before `b` (to 4-align) and 7 before `d` (to 8-align) produce 24.
</details>

### Task W2 — Packed vs unpacked

Repeat W1 but with the C struct declared `#pragma pack(1)`. Define the matching packed struct on your side, then *deliberately* define an unpacked version and observe the offset divergence.

**Self-check:** Packed size is `1+4+1+8 = 14`; unpacked is 24. Reading the packed C bytes with the unpacked definition should misread every field from `b` onward.

<details><summary>Hint</summary>
Rust: `#[repr(C, packed)]`. C#: `[StructLayout(LayoutKind.Sequential, Pack = 1)]`. Python: set `_pack_ = 1` in the class body.
</details>

### Task W3 — String representation tour

For your runtime, print: (a) whether its native string is NUL-terminated, (b) its in-memory encoding, (c) the bytes produced when you convert `"café"` to a C string. Note how many bytes the `é` takes.

**Self-check:** In UTF-8, `é` is 2 bytes (`0xC3 0xA9`), so `"café"` → 5 bytes + 1 NUL = 6 bytes. In UTF-16 it's one 2-byte code unit. Confirm your runtime matches the table from the middle level.

---

## Core

### Task C1 — Struct round-trip through C

Write a C function `void scale(struct Sample *s, int factor)` that multiplies `b` and `d` by `factor`. Call it from your runtime, passing a struct by pointer, and verify the modified fields come back correct.

**Self-check:** Initialize `b=3, d=1.5`, call with `factor=2`, expect `b=6, d=3.0`. If `d` is garbage but `b` is fine, your `d` offset (padding) is wrong.

<details><summary>Hint</summary>
Pass the struct by reference/pointer (`&mut` / `ref` / `ctypes.byref`). The C side mutates in place; you read the fields after the call.
</details>

### Task C2 — String round-trip, both directions, no leak

Write a C function `char *shout(const char *s)` that `malloc`s an uppercased copy (caller frees with `free`). From your runtime: marshal a string *in* (append NUL / transcode), receive the `char*` *out*, copy it into a native string, and free the C buffer with the *matching* allocator. Run it in a loop and confirm memory is flat.

**Self-check:** Run 1,000,000 iterations under a memory monitor (`/usr/bin/time -l`, `valgrind --leak-check=full`, or RSS sampling). RSS must not grow. A leak means you didn't free the C buffer; a crash means you freed with the wrong allocator or freed twice.

<details><summary>Hint</summary>
Rust: `CString::new(s)` in, `CStr::from_ptr(out).to_string_lossy().into_owned()` to copy, then call C's `free(out)`. Go: `C.CString` in (`defer C.free`), `C.GoString(out)` to copy, `C.free(unsafe.Pointer(out))`. Python: pass `bytes`, set `restype = c_char_p` *carefully* — note `c_char_p` auto-copies but won't free; for explicit ownership use `c_void_p` and `ctypes.string_at` then call `libc.free`.
</details>

<details><summary>Solution sketch</summary>

```rust
let input = CString::new(s).unwrap();          // Rust allocator owns input
unsafe {
    let out = shout(input.as_ptr());           // C malloc owns out
    let owned = CStr::from_ptr(out).to_string_lossy().into_owned();
    libc::free(out as *mut c_void);            // free with C's allocator
    owned
}                                              // input dropped by Rust: matched
```
Two allocations, two matched frees, zero crossings.
</details>

### Task C3 — Pin a buffer for a zero-copy fill

Write a C function `void fill(unsigned char *p, size_t n)` that writes `n` bytes (e.g. `p[i] = i & 0xFF`). From a moving-GC runtime (.NET or Java), allocate a managed byte array, **pin it**, pass a pointer + length zero-copy, then read the result back.

**Self-check:** After the call, `arr[i] == i & 0xFF`. Then deliberately remove the pin and explain (in a comment) why the code might still pass tests but could corrupt under GC pressure.

<details><summary>Hint</summary>
.NET: `fixed (byte* p = arr) { fill(p, (nuint)arr.Length); }`. Java (JNI): `GetPrimitiveArrayCritical` → call → `ReleasePrimitiveArrayCritical(... , 0)`. The pin must span the entire native call.
</details>

<details><summary>Solution sketch</summary>

```csharp
static unsafe void Run(byte[] arr) {
    fixed (byte* p = arr) {        // pinned for the block
        fill(p, (nuint)arr.Length);
    }                              // unpinned; safe because C is done
}
// Without `fixed`, a GC during fill() could relocate `arr`; C would write
// to the old address. Tests pass when no GC happens to run mid-call.
```
</details>

### Task C4 — Out-parameter with status code

Write a C function `int parse_int(const char *s, long *out)` returning `0` on success and `-1` on failure (and leaving `*out` untouched on failure). Bind it so that on failure your code raises an error / returns `Err` and **never reads the out-value**.

**Self-check:** `parse_int("42", &out)` → success, `out == 42`. `parse_int("xyz", &out)` → your binding returns an error *without* reading `out`. Add an assertion that you don't touch `out` on the failure path.

<details><summary>Hint</summary>
Check the return code first; only convert/expose the out-value inside the success branch. On failure, the out-parameter may hold stack garbage.
</details>

---

## Advanced

### Task A1 — Reason through an allocator-mismatch crash (conceptual)

You are given a C host that frees every returned string with libc `free()`. Your Rust library returns strings via `CString::into_raw()`. Write a 150–250 word explanation of: (1) why each individual call appears to work, (2) why the heap corrupts, (3) where the crash surfaces, and (4) the fix. Then implement the fix.

**Self-check:** Your explanation must mention that `into_raw` used *Rust's* allocator, that libc `free` reads metadata Rust never wrote, that corruption is silent until a later allocation/free walks the poisoned freelist, and that the fix is a Rust-exported `free_string(p)` that calls `CString::from_raw(p)` so Rust's allocator reclaims it.

<details><summary>Solution sketch</summary>

```rust
#[no_mangle]
pub extern "C" fn free_string(p: *mut c_char) {
    if p.is_null() { return; }
    unsafe { drop(CString::from_raw(p)); } // Rust allocator frees it: matched
}
```
The C host calls `free_string(s)` instead of `free(s)`. Same allocator allocates and frees; no metadata mismatch; no corruption.
</details>

### Task A2 — Map LP64 vs LLP64 types

Build a table mapping each C type below to a *fixed-width* type in your runtime, and mark which ones change size between 64-bit Linux (LP64) and 64-bit Windows (LLP64): `int`, `long`, `long long`, `size_t`, `intptr_t`, `void*`, `_Bool`, `wchar_t`.

**Self-check:** `long` is 64-bit on LP64, 32-bit on LLP64 (the trap). `wchar_t` is 4 bytes on Unix, 2 bytes on Windows. `int`/`long long`/`size_t`/`intptr_t`/`void*`/`_Bool` are stable across both. Your binding for `long` must use a fixed-width 32/64 choice or it corrupts on Windows.

<details><summary>Solution sketch</summary>

| C type | Stable? | Map to (fixed-width) |
|--------|---------|----------------------|
| `int` | yes (32) | `i32` / `Int32` / `c_int` |
| `long` | **NO** (64 LP64 / 32 LLP64) | choose `i32` or `i64` per platform; avoid runtime `long` |
| `long long` | yes (64) | `i64` |
| `size_t` | yes (ptr-width) | `usize` / `nuint` / `c_size_t` |
| `intptr_t` | yes (ptr-width) | `isize` / `nint` / `c_ssize_t` |
| `void*` | yes (ptr-width) | raw pointer type |
| `_Bool` | usually 1 | force 1-byte (`I1` in .NET) |
| `wchar_t` | **NO** (4 Unix / 2 Win) | marshal explicit UTF-16/UTF-32, not `wchar_t` |
</details>

### Task A3 — Identify "do not free" returns

Take five real C functions that return `char*` — e.g. `strerror`, `getenv`, `inet_ntoa`, `sqlite3_mprintf`, POSIX `strdup` — and classify each: library-owned/do-not-free, callee-allocated/paired-free, or callee-allocated/libc-free. Write the correct cleanup for each.

**Self-check:** `strerror`/`getenv`/`inet_ntoa` → library-owned, never free (and `strerror`/`inet_ntoa` may reuse a static buffer — copy out before the next call). `sqlite3_mprintf` → free with `sqlite3_free`. `strdup` → free with libc `free`.

### Task A4 — Force the 4-byte bool bug, then fix it (.NET)

Define a C struct `struct Flags { _Bool active; int count; }`. Marshal it in .NET *without* `[MarshalAs(UnmanagedType.I1)]` on `active` and observe `count` (and possibly `active`) reading wrong. Then add `I1` and confirm correctness.

**Self-check:** Without `I1`, .NET treats `active` as a 4-byte BOOL, shifting `count`'s offset and reading garbage; with `I1`, `active` is 1 byte and the layout matches C. Print both layouts to see the offset shift.

<details><summary>Hint</summary>
`[StructLayout(LayoutKind.Sequential)] struct Flags { [MarshalAs(UnmanagedType.I1)] public bool active; public int count; }`. Compare `Marshal.OffsetOf` for `count` with and without the attribute.
</details>

---

## Capstone

### Task X1 — A small safe marshalling layer

Wrap a tiny C "parser" library with an opaque handle and build a safe marshalling layer around it. The C side:

```c
typedef struct Parser Parser;                 // opaque
Parser *parser_new(void);
int     parser_feed(Parser *p, const char *utf8, size_t len); // 0 = ok
char   *parser_result(Parser *p);             // callee mallocs; free with parser_free_str
void    parser_free_str(char *s);             // paired free
void    parser_free(Parser *p);               // paired destructor
```

Build a layer that:

1. Wraps `Parser *` in a type that frees **exactly once** on drop/dispose (opaque handle, never dereferenced).
2. Marshals input strings as UTF-8 with explicit NUL handling, one conversion site.
3. Receives `parser_result`'s `char*`, copies it to a native string, and frees it with `parser_free_str` (not plain `free`) — one place only.
4. Checks `parser_feed`'s status and surfaces an error without exposing internals on failure.
5. Never lets a raw pointer escape the layer; keeps the `unsafe`/`extern`/`DllImport` block tiny.
6. Includes a startup self-test that asserts the binding agrees with the C side (e.g. a round-trip that exercises feed → result → free).

**Self-check:**
- Run 1,000,000 feed/result/free cycles: RSS is flat (no leak), no crash (no allocator crossing, no double-free).
- Drop/dispose the handle twice in a test: the destructor must run exactly once (guard with a null-after-free or a moved-out flag / `SafeHandle`).
- Feed invalid input: you get a typed error, the handle stays usable or is cleanly torn down, and no raw pointer leaked.
- Grep the codebase: every raw pointer lives inside the marshalling module; callers see only safe types.

<details><summary>Hint</summary>
Rust: a `struct Parser(NonNull<ffi::Parser>)` with `Drop` calling `parser_free`; a `feed(&mut self, s: &str) -> Result<(), Error>` using `CString::new`; a `result(&self) -> String` that calls `parser_result`, copies via `CStr`, then `parser_free_str`. .NET: a `SafeHandle` subclass for the parser plus `[MarshalAs(UnmanagedType.LPUTF8Str)]` for input and a `result` method that copies then calls `parser_free_str`.
</details>

<details><summary>Solution sketch (Rust core)</summary>

```rust
pub struct Parser(NonNull<ffi::Parser>);

impl Parser {
    pub fn new() -> Self {
        Parser(NonNull::new(unsafe { ffi::parser_new() }).expect("alloc"))
    }
    pub fn feed(&mut self, s: &str) -> Result<(), Error> {
        let c = CString::new(s).map_err(|_| Error::InteriorNul)?; // one site
        let rc = unsafe { ffi::parser_feed(self.0.as_ptr(), c.as_ptr(), s.len()) };
        if rc != 0 { return Err(Error::Code(rc)); }               // check status
        Ok(())
    }
    pub fn result(&self) -> String {
        unsafe {
            let p = ffi::parser_result(self.0.as_ptr());          // callee mallocs
            let out = CStr::from_ptr(p).to_string_lossy().into_owned(); // copy
            ffi::parser_free_str(p);                              // PAIRED free
            out
        }
    }
}
impl Drop for Parser {
    fn drop(&mut self) { unsafe { ffi::parser_free(self.0.as_ptr()) } } // once
}
```
Raw pointers never leave this module; allocators never cross; every allocation has its matched free; status is checked before any out-value is trusted.
</details>

---

## Wrap-Up

If you completed these, you can: verify a struct's ABI layout against C, round-trip strings in both directions with zero leaks and no allocator crossings, pin a buffer for safe zero-copy, explain and fix an allocator-mismatch crash, map the LP64/LLP64 and bool-width traps, and assemble a marshalling layer where the dangerous operations are unrepresentable. That is the working skill set behind every correct, crash-free binding.

---
