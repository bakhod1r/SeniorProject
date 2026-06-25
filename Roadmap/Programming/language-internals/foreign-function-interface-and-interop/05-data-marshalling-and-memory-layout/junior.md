# Data Marshalling & Memory Layout — Junior Level

> **Topic:** [Data Marshalling & Memory Layout](README.md)
> **Focus:** You can call a C function from your language. Now you have to hand it *data* — a string, a struct, an array — and get data back. Almost everything that can go wrong, goes wrong here.

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

> Focus: **What does it actually mean to pass *data* — not just a number — across the boundary between two languages?** And **why is a string the single most dangerous thing you will ever hand to a C function?**

Calling a foreign function — a C function from Python, Java, Go, Rust, or C# — is the easy part. The runtime puts your arguments in registers, jumps to the function's address, and reads the return value. That works perfectly for `int`, `double`, and other simple numbers, because both sides agree on exactly what those bytes mean.

The trouble starts the moment you pass something with *structure*: a string, an array, a struct, a pointer to a buffer. Now both sides have to agree on the **memory layout** of that data — where each byte lives, how long it is, who owns it, who is allowed to free it. Your language and C almost never agree out of the box. **Marshalling** (sometimes spelled "marshaling") is the work of translating data from your language's representation into the representation C expects, and back again.

In one sentence: **marshalling is the diplomacy between two languages that store the same idea — "the word hello" — in completely different bytes.**

> 🎓 **Why this matters for a junior:** The first FFI bug you hit will not be "the function didn't get called." It will be a crash, a garbled string, or a corrupted struct — a *data* bug. Roughly every memorable FFI war story is a marshalling story: a string that wasn't NUL-terminated, a struct whose fields didn't line up, a buffer the garbage collector moved out from under C, or memory freed by the wrong allocator. Learn the data rules and you avoid 90% of FFI pain.

This page covers, at a junior level: what marshalling is and why it's needed, the three big impedance mismatches (**strings**, **structs**, **arrays/buffers**), the iron rule of **who allocates and who frees**, and the same hello-world-of-marshalling examples — passing a string and a struct to C — across Python, Java, Go, Rust, and C#. The next level (`middle.md`) goes deep on encodings, pinning, and ownership conventions; `senior.md` covers ABI-exact layout, GC interaction, and zero-copy; `professional.md` covers designing a marshalling layer for a real cross-language library.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to call *one* simple C function from your language — at least the "add two ints" hello-world of FFI. (That is the previous topic; this one assumes it.)
- **Required:** What a pointer is: an address that points at some bytes in memory.
- **Required:** What a `struct` / `class` / record is — a bundle of named fields.
- **Required:** That strings are made of bytes, and that "characters" and "bytes" are not the same thing once you leave plain ASCII.
- **Helpful but not required:** A vague sense that a program has a *stack* (local variables) and a *heap* (things you allocate).
- **Helpful but not required:** Awareness that some languages (Java, Go, Python, C#) have a **garbage collector** that frees memory for you.

You do **not** need to know:

- The exact rules of struct alignment and padding (that's `middle.md` and `senior.md`).
- How pinning works internally, or the details of a specific GC (that's `senior.md`).
- ABI details like LP64 vs LLP64, calling conventions, or endianness of serialized formats (later levels).

---

## Glossary

| Term | Definition |
|------|-----------|
| **FFI** | Foreign Function Interface. The mechanism that lets code in one language call functions written in (or compiled to the ABI of) another — almost always C. |
| **Marshalling** | Converting data from one language's in-memory representation to another's, so the foreign side can read it. "Unmarshalling" is the reverse. |
| **ABI** | Application Binary Interface. The binary-level contract: how arguments are passed, how structs are laid out in memory, how big each type is. C defines the *lingua franca* ABI. |
| **Memory layout** | The exact arrangement of bytes for a value: which field is at which offset, how big it is, where the padding goes. |
| **NUL terminator** | The single zero byte (`'\0'`, value 0) that marks the end of a C string. C strings have **no length field**; the zero byte *is* the length. |
| **`char*`** | A C string: a pointer to the first byte of a sequence of bytes ending in a NUL terminator. |
| **Encoding** | The rule mapping characters to bytes: UTF-8, UTF-16, ASCII, Latin-1. "hello" is the same in all; "café" or "日本" differ wildly. |
| **Owner** | Whoever is responsible for eventually **freeing** a piece of memory. Exactly one side should own each allocation. |
| **Allocator** | The library that hands out and reclaims memory: C's `malloc`/`free`, Rust's allocator, the JVM heap, etc. Memory from one allocator must be freed by *that same* allocator. |
| **GC (Garbage Collector)** | The runtime component (Java, Go, Python, C#) that automatically frees memory you stopped using — and may *move* objects around to compact the heap. |
| **Pinning** | Telling the GC "do not move or free this object" for the duration of a native call, so a pointer you handed to C stays valid. |
| **Opaque handle** | A pointer or token you pass back and forth but never look inside. C owns the real structure; you just hold the handle. |
| **Out-parameter** | A pointer argument that the function *writes into*: you pass `&result`, the function fills it in. The C way of "returning" extra values. |
| **Zero-copy** | Letting C read your buffer directly, with no copy. Fast but dangerous: the bytes must stay put and valid for the whole call. |
| **Use-after-free** | Reading or writing memory after it was freed. A classic FFI crash when one side frees what the other still references. |
| **Double-free** | Freeing the same memory twice — usually because both sides thought they owned it. Corrupts the allocator; crashes later, far from the cause. |

---

## Core Concepts

### 1. Why Marshalling Exists at All

A number is a number. When you pass `42` to a C function, your runtime puts the integer `42` in a register and C reads `42`. No translation needed, because both sides represent a 32-bit integer identically.

But "the string hello" is not stored identically. In C it's six bytes: `h e l l o \0`. In Java it might be a `String` object with a length field and UTF-16 code units. In Python 3 a `str` is an object with its own internal encoding and a length. In Go a `string` is a struct of `(pointer, length)` with **no** NUL terminator. In Rust a `String` is `(pointer, length, capacity)`, UTF-8, and again **no** NUL terminator.

Five languages, five different byte layouts for the same idea. C can only read **one** of them — the `char*` shape. So before C can touch your string, *someone has to produce the C shape*. That production is marshalling.

### 2. The Three Big Mismatches

Almost all marshalling pain falls into three buckets:

| Mismatch | The problem in one line |
|----------|-------------------------|
| **Strings** | Different length conventions (NUL-terminated vs length-prefixed) and different encodings (UTF-8 vs UTF-16). |
| **Structs** | The fields have to sit at the *exact same byte offsets* on both sides, or every field after the first mismatch is garbage. |
| **Arrays / buffers** | You pass a pointer + a length, and the bytes must stay valid and not get moved by the GC during the call. |

Master these three and the rest is detail.

### 3. The C String: NUL-Terminated, No Length

A C string is just a pointer to bytes. C does not store the length anywhere. To find where the string ends, C functions like `strlen` **walk forward until they hit a zero byte**. That has two consequences a junior must burn into memory:

1. **If there is no NUL terminator, C reads off the end** of your buffer into whatever memory follows — garbage, a crash, or a security hole.
2. **If your string contains a zero byte in the middle** (binary data, some encodings), C thinks the string ends there.

```text
The word "hi" as a C string:
  +---+---+----+
  | h | i | \0 |     three bytes; the \0 IS the end marker
  +---+---+----+
```

Go and Rust strings have a length and **no NUL terminator**. So when you hand a Go or Rust string to C, you must produce a NUL-terminated copy (`C.CString` in Go, `CString::new` in Rust). Forgetting this is the single most common beginner FFI bug.

### 4. The Encoding Question

Even once lengths agree, the *bytes inside* may differ. "café" is:

- 5 bytes in UTF-8 (`c a f é`, where `é` is two bytes).
- 4 UTF-16 code units (8 bytes) on Java and the Windows "wide" APIs.

If C expects UTF-8 and you hand it UTF-16, or vice versa, you get **mojibake** — garbled text like `cafÃ©`. Rust strings are *always* UTF-8, which is convenient for C interop. Java strings are UTF-16 internally; you must explicitly encode to UTF-8 bytes before handing them to a UTF-8-expecting C function. The first rule of the encoding question: **always know which encoding the C side expects, and convert explicitly.**

### 5. Who Allocates, Who Frees — The Iron Rule

This rule causes more crashes than any other:

> **Memory must be freed by the same allocator that allocated it.**

If C's `malloc` allocated a buffer, C's `free` must release it. If Rust's allocator made a string, Rust must drop it. If you call `free()` on memory that Rust allocated, you mix allocators and corrupt the heap — usually crashing later, somewhere unrelated, making it maddening to debug.

This leads to the central ownership question for *every* pointer crossing the boundary:

- **Who allocated it?** (Which side's allocator made these bytes?)
- **Who frees it, and when?** (And do they call the *right* free function?)

Three common conventions you'll meet:

1. **Caller allocates, callee fills.** You give C a buffer you own; C writes into it; you free it. (Safest.)
2. **Callee allocates, caller frees with a paired function.** C returns a pointer; the library gives you a `free_thing()` you must call. *Never* use plain `free` unless the docs say to.
3. **Callee allocates, callee owns.** C returns a pointer to memory it manages; you must **not** free it. (e.g. `strerror`.)

When the docs are unclear about which of these applies, *stop and find out*. Guessing here means a double-free or a leak.

### 6. Structs Must Line Up Byte-for-Byte

A struct is just a contiguous block of bytes. C lays out fields in declaration order, with **padding** inserted so each field is aligned. If your language lays the same struct out differently — different field order, different padding, different field sizes — then when C reads "the second field," it reads the wrong bytes.

To match C, every language gives you a way to force C-compatible layout:

- Rust: `#[repr(C)]` on the struct.
- C#: `[StructLayout(LayoutKind.Sequential)]`.
- Python (ctypes): subclass `ctypes.Structure` and declare `_fields_`.
- Go: declare a struct mirroring the C one (cgo handles layout, but you keep field order/types matching).

A junior takeaway: **a struct that crosses the FFI boundary must use the C layout, never the language's default layout.** Rust's default layout in particular is *deliberately unspecified* — the compiler may reorder fields — so `#[repr(C)]` is mandatory.

### 7. The Garbage Collector Can Move Your Data

In Java, Go, Python, and C#, the GC may **move** an object in memory to compact the heap, or **free** it the moment it sees no more references. Both are catastrophic mid-FFI-call:

- If you pass C a pointer into a GC-managed array and the GC *moves* the array, C's pointer now points at stale or reused memory.
- If the only reference to an object lives in a C variable the GC can't see, the GC may *free* the object while C is still using it.

The cure is **pinning** (and keeping a reference alive): tell the GC "hands off this object until the call returns." Each runtime has its own mechanism — `fixed`/`GCHandle` in C#, `GetPrimitiveArrayCritical` in Java, the "C must not retain Go pointers" rule in Go. You'll meet these in detail in `middle.md`. For now: **GC-managed memory is not safe to hand to C unless you pin it.**

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Marshalling** | Translating a document so a foreign office can read it. The *meaning* is the same; the *form* must change. |
| **C string (NUL-terminated)** | A sentence with no length stated, ending only when you reach a period. If someone forgets the period, you keep reading the next sentence too. |
| **Length-prefixed string** | A package labeled "12 items inside." You know exactly when to stop, no end-marker needed. |
| **Encoding mismatch (mojibake)** | Reading a Japanese letter as if it were written in the Latin alphabet — you get gibberish, not an error. |
| **Who frees the memory** | A borrowed book. Exactly one person must return it to the library. If both think the other will, it's lost (leak). If both return a copy, chaos (double-free). |
| **Allocator mismatch** | Returning a library book to a *different* library. Their system rejects it and the shelving breaks. |
| **Struct layout** | A form with fields in a fixed order. If the foreign office expects "name, then date" and you send "date, then name," every field is misread. |
| **Pinning** | Putting a "DO NOT MOVE — work in progress" sticker on a crate in a warehouse that's being reorganized. |
| **Opaque handle** | A coat-check ticket. You don't know how the coat is stored; you just hand back the ticket to get it. |
| **Out-parameter** | Handing the clerk a blank envelope and saying "put the answer in here." |
| **Use-after-free** | Trying to pick up a coat after the coat-check already gave it away. |

---

## Mental Models

### The Translation Desk

Picture a desk between two offices, "Your Language" and "C." Anything passing the desk must be translated into a form the other office reads. Numbers cross instantly (both offices use the same number format). Strings, structs, and arrays get *re-typed onto a C form* by a clerk — that clerk is your marshalling code. The clerk's job: get the form's fields in the right order, attach the right end-marker to strings, and write down clearly **who keeps the original** so nobody throws it away twice.

### The "Same Idea, Different Bytes" Model

For any piece of data crossing the boundary, ask: *what bytes does my side store, and what bytes does C expect?* "hello" is `h e l l o` plus maybe a NUL, maybe a length, maybe UTF-16. If the two byte pictures differ, marshalling must reconcile them. Drawing the two byte layouts side by side is the fastest way to find a bug.

### The Ownership Tag

Imagine every pointer carries an invisible tag: *"allocated by C, freed by C"* or *"allocated by Rust, freed by Rust."* A crash happens when someone ignores the tag — frees C's memory with Rust's `drop`, or frees Rust's memory with C's `free`. Before you free anything across an FFI boundary, read its tag. If you can't tell what the tag says, you don't yet understand the API well enough to call it safely.

---

## Code Examples

We do the two "hello world" marshalling tasks in every language: **(A) pass a string to a C function that returns its length, and (B) pass a small struct to a C function that fills it in.** Assume this C side:

```c
// libdemo.c
#include <string.h>

// (A) reads a NUL-terminated UTF-8 string, returns its byte length.
size_t demo_strlen(const char *s) {
    return strlen(s);
}

// (B) a point, filled in by C.
typedef struct { int x; int y; } Point;

void demo_make_point(Point *p, int x, int y) {
    p->x = x;
    p->y = y;
}
```

### Python (ctypes)

```python
import ctypes

lib = ctypes.CDLL("./libdemo.so")

# (A) string. ctypes wants bytes (a NUL-terminated char*), NOT a str.
lib.demo_strlen.restype = ctypes.c_size_t
lib.demo_strlen.argtypes = [ctypes.c_char_p]

s = "café"
n = lib.demo_strlen(s.encode("utf-8"))   # encode str -> bytes explicitly
print(n)   # 5  (é is two bytes in UTF-8)

# (B) struct. Mirror the C layout with ctypes.Structure.
class Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int), ("y", ctypes.c_int)]

lib.demo_make_point.argtypes = [ctypes.POINTER(Point), ctypes.c_int, ctypes.c_int]

p = Point()
lib.demo_make_point(ctypes.byref(p), 3, 4)   # pass &p as an out-parameter
print(p.x, p.y)   # 3 4
```

Note the **explicit** `.encode("utf-8")`. A Python `str` is not bytes; ctypes refuses it. You choose the encoding.

### Go (cgo)

```go
package main

/*
#include <string.h>
typedef struct { int x; int y; } Point;
static void demo_make_point(Point *p, int x, int y) { p->x = x; p->y = y; }
*/
import "C"
import (
	"fmt"
	"unsafe"
)

func main() {
	// (A) string. Go strings have NO NUL terminator, so make a C copy.
	cs := C.CString("café") // allocates a C buffer; YOU must free it
	defer C.free(unsafe.Pointer(cs))
	n := C.strlen(cs)
	fmt.Println(n) // 5

	// (B) struct. cgo gives us C.Point with C's layout.
	var p C.Point
	C.demo_make_point(&p, 3, 4)
	fmt.Println(int(p.x), int(p.y)) // 3 4
}
```

`C.CString` allocates with C's allocator, so you free it with `C.free` — *the allocator must match*. The `defer C.free(...)` is the iron rule made concrete.

### Rust

```rust
use std::ffi::CString;
use std::os::raw::{c_char, c_int};

#[repr(C)] // mandatory: Rust's default layout is unspecified
struct Point { x: c_int, y: c_int }

extern "C" {
    fn demo_strlen(s: *const c_char) -> usize;
    fn demo_make_point(p: *mut Point, x: c_int, y: c_int);
}

fn main() {
    // (A) string. Rust String is UTF-8 but NOT NUL-terminated.
    // CString appends the NUL and rejects interior NUL bytes.
    let s = CString::new("café").unwrap();
    let n = unsafe { demo_strlen(s.as_ptr()) };
    println!("{n}"); // 5
    // `s` stays alive until here, keeping the pointer valid.

    // (B) struct, filled by C.
    let mut p = Point { x: 0, y: 0 };
    unsafe { demo_make_point(&mut p, 3, 4); }
    println!("{} {}", p.x, p.y); // 3 4
}
```

`CString` owns the buffer; when `s` drops, *Rust* frees it. We never let C free it. And `#[repr(C)]` is not optional — without it, the compiler is free to reorder `x` and `y`.

### Java (JNI sketch)

```java
public class Demo {
    static { System.loadLibrary("demo"); }

    // Java Strings are UTF-16. The native bridge must convert to UTF-8.
    public static native long strlen(String s);
    public static native int[] makePoint(int x, int y); // returns {x, y}

    public static void main(String[] args) {
        System.out.println(strlen("café")); // native side encodes to UTF-8 -> 5
        int[] p = makePoint(3, 4);
        System.out.println(p[0] + " " + p[1]); // 3 4
    }
}
```

```c
// JNI side: GetStringUTFChars hands you a UTF-8 (modified) C string.
JNIEXPORT jlong JNICALL Java_Demo_strlen(JNIEnv *env, jclass c, jstring s) {
    const char *cs = (*env)->GetStringUTFChars(env, s, NULL);
    jlong n = (jlong) demo_strlen(cs);
    (*env)->ReleaseStringUTFChars(env, s, cs); // pair every Get with a Release
    return n;
}
```

The JVM gives you the string as a C `char*` via `GetStringUTFChars`, and you **must** pair it with `ReleaseStringUTFChars`. Java has no raw struct layout, so structs are usually marshalled field-by-field (or via newer foreign-memory APIs).

### C# (P/Invoke)

```csharp
using System.Runtime.InteropServices;

class Demo {
    // The marshaller converts the C# string to a NUL-terminated buffer.
    [DllImport("demo", CharSet = CharSet.Ansi)]
    static extern nuint demo_strlen(string s);

    [StructLayout(LayoutKind.Sequential)] // match C field order/offsets
    struct Point { public int x; public int y; }

    [DllImport("demo")]
    static extern void demo_make_point(ref Point p, int x, int y);

    static void Main() {
        System.Console.WriteLine(demo_strlen("cafe")); // marshaller makes the char*
        var p = new Point();
        demo_make_point(ref p, 3, 4);
        System.Console.WriteLine($"{p.x} {p.y}"); // 3 4
    }
}
```

C#'s **marshaller** does a lot for you: `CharSet` controls the string encoding, `[StructLayout(LayoutKind.Sequential)]` forces C field order, and `ref` passes the struct by address as an out-parameter. The *attributes are the marshalling instructions.*

---

## Pros & Cons

**Pros of marshalling data across FFI:**

- Lets you reuse mature C libraries (image codecs, crypto, databases) from any language.
- Numbers and simple data cross cheaply; performance can be near-native.
- With care, large buffers can be passed *zero-copy* (no duplication).

**Cons / costs:**

- Strings and structs require explicit, error-prone conversion.
- Memory ownership bugs (leaks, double-frees, use-after-free) are easy to introduce and hard to debug.
- GC-managed languages add pinning and lifetime concerns.
- Encoding mismatches silently corrupt text instead of erroring.
- The boundary defeats your language's normal safety guarantees — Rust's borrow checker and Java's memory safety stop at the `extern "C"` line.

---

## Use Cases

- Calling a C image/audio/video codec and passing it a pixel buffer.
- Wrapping a C database client (SQLite, libpq) where you pass query strings and read back rows.
- Using a crypto library: hand it a byte buffer + length, get back a digest buffer.
- Talking to an OS API that takes/returns C strings and structs (file paths, system info).
- Hardware/driver SDKs that expose opaque handles and out-parameters.

---

## Coding Patterns

### Pattern: Make a C string, free it on the same side

```go
cs := C.CString(goStr)        // C allocator allocates
defer C.free(unsafe.Pointer(cs)) // C allocator frees — match!
use(cs)
```

The `defer` (or `try/finally`, or RAII) guarantees the free runs even on error.

### Pattern: Caller allocates, callee fills (out-parameter)

```python
buf = ctypes.create_string_buffer(256)   # you own this
lib.fill_message(buf, 256)               # C writes into it
print(buf.value.decode("utf-8"))         # you read it; you free it (automatic here)
```

You control the buffer's lifetime — the safest ownership model.

### Pattern: Mirror the struct with explicit C layout

```rust
#[repr(C)]
struct Config { width: c_int, height: c_int, flags: u32 }
```

Always annotate; never rely on the default layout for an FFI struct.

### Pattern: Pair every "get" with its "release"

```c
const char *cs = (*env)->GetStringUTFChars(env, s, NULL);
// ... use cs ...
(*env)->ReleaseStringUTFChars(env, s, cs);
```

Every acquire of a native view of a managed object must have a matching release.

---

## Clean Code

- **Convert strings explicitly, at one place.** Have a single helper that turns your language's string into the exact C form (encoding + NUL). Don't sprinkle ad-hoc `.encode()` calls.
- **Name the ownership in the function name or a comment.** `must_free_with_xfree()` is clearer than hoping the caller reads the docs.
- **Keep the unsafe boundary tiny.** Wrap each C call in a thin, well-named safe function and never expose raw pointers to the rest of your code.
- **Mirror struct field order and document it.** Put a comment linking your struct to the exact C declaration it copies.
- **Free in the same scope you allocate**, using `defer`/`finally`/RAII so it survives early returns and exceptions.

---

## Best Practices

- Always know **which encoding** the C side expects (almost always UTF-8 on Linux/macOS; UTF-16 "wide" on many Windows APIs). Convert explicitly.
- Never pass a Go or Rust string straight to C — it has no NUL terminator. Build a `C.CString` / `CString` first.
- Never `free()` memory your language's runtime allocated, and never let your runtime free memory C allocated. Match the allocator.
- For each returned pointer, find out: *do I free this, and with what function?* If the docs don't say, don't free (you'll leak, which is safer than a double-free) — and ask.
- Always annotate FFI structs with the C-layout attribute (`#[repr(C)]`, `[StructLayout(Sequential)]`, ctypes `Structure`).
- When handing a GC-managed buffer to C, pin it (and keep a live reference) for the whole call.
- Treat opaque handles as opaque: pass them, store them, but never dereference or inspect their contents.

---

## Edge Cases & Pitfalls

- **No NUL terminator.** Passing a Go/Rust string's raw bytes to a C function that calls `strlen` reads off the end. Always NUL-terminate.
- **Interior NUL byte.** Binary data with an embedded zero looks "ended early" to C. Rust's `CString::new` even rejects this with an error — heed it.
- **Wrong encoding.** UTF-16 bytes handed to a UTF-8 function (or vice versa) produce mojibake, not a crash — easy to miss until a non-ASCII user complains.
- **Allocator mismatch.** `free`-ing Rust- or Go-allocated memory corrupts the heap. The crash appears much later, far from the cause.
- **Freeing a borrowed string.** Some C functions return a `char*` you must **not** free (it points into static or library-owned memory). Freeing it is a crash.
- **GC moved the buffer.** Without pinning, the collector can relocate your array mid-call, leaving C with a dangling pointer.
- **Struct field misalignment.** A struct laid out differently on the two sides reads garbage for every field after the first mismatch.

---

## Common Mistakes

- Passing a `str` where C wants `bytes` (and forgetting `.encode()` / `CString`).
- Forgetting to free a `C.CString` — a steady memory leak.
- Calling `C.free` on something C did *not* allocate, or library-owned memory.
- Relying on the default struct layout in Rust (unspecified — fields may be reordered).
- Assuming the GC will leave your buffer alone during a native call. It won't, unless you pin.
- Reusing or reading a buffer after the C side (or you) freed it.

---

## Tricky Points

- A Go `string` and a Rust `&str` carry their length and are **not** NUL-terminated; a C `char*` is NUL-terminated and carries **no** length. These are opposite designs.
- Rust strings are guaranteed UTF-8; Java strings are UTF-16; C makes no encoding promise — it's "just bytes," and the meaning is by convention.
- "Caller allocates" vs "callee allocates" changes *who frees*. Reading the function's documentation for this is not optional.
- The GC can free an object whose only remaining reference lives inside C — invisible to the collector. Keeping a live reference on the managed side is part of correctness, not a nicety.

---

## Test Yourself

1. Why can't you hand a Go `string` directly to a C function that calls `strlen`?
2. What is mojibake, and which mismatch causes it?
3. If a C library returns a `char*`, what two questions must you answer before doing anything with it?
4. Why must `#[repr(C)]` be on every Rust struct that crosses the FFI boundary?
5. What does "pinning" prevent, and in which languages do you need it?
6. Why is freeing Rust-allocated memory with C's `free` dangerous?

<details>
<summary>Answers</summary>

1. Go strings have a length and **no NUL terminator**; `strlen` walks until a zero byte and would read past the string's end. You must build a NUL-terminated copy (`C.CString`).
2. Mojibake is garbled text from an **encoding mismatch** — e.g. UTF-16 bytes interpreted as UTF-8. It doesn't error; it just produces nonsense characters.
3. (a) Do I own this — must I free it? (b) If so, with which free function (plain `free`, or a library-specific one)? If unclear, don't free it.
4. Rust's default layout is unspecified; the compiler may reorder fields. `#[repr(C)]` forces the exact, predictable C layout so offsets match.
5. Pinning prevents the GC from **moving** (and keeping a reference prevents it from **freeing**) an object while C holds a pointer to it. Needed in Java, Go, Python, and C#.
6. It mixes allocators: C's `free` doesn't understand Rust's allocator's bookkeeping, corrupting the heap and typically crashing later.

</details>

---

## Tricky Questions

- **You pass `"hello\0world"` to a C `strlen`. What does it return, and why?** It returns 5 — C stops at the interior NUL byte, never seeing "world."
- **A function returns a pointer and the docs say nothing about freeing. Do you free it?** No — leaking is recoverable; a double-free or freeing borrowed memory crashes. Leak, and go find out the real rule.
- **Your struct works on your laptop but corrupts on a teammate's machine.** Suspect a layout/padding mismatch or a size difference in a field type (e.g. `long`), not the logic.
- **Text is fine in tests but garbled for one user named "Łukasz."** Classic encoding bug — ASCII passed cleanly, the non-ASCII byte exposed the UTF-8/UTF-16 mismatch.

---

## Cheat Sheet

```text
STRINGS
  C string  = char*, NUL-terminated, NO length, encoding-by-convention
  Go/Rust   = (ptr,len), UTF-8, NO NUL terminator  -> make a C copy first
  Java      = UTF-16 internally -> encode to UTF-8 explicitly
  Python    = str (decoded) vs bytes (raw) -> ctypes wants bytes
  Always: know the encoding; convert explicitly; NUL-terminate for C.

STRUCTS
  Must match C layout EXACTLY.
  Rust   #[repr(C)]
  C#     [StructLayout(LayoutKind.Sequential)]
  Python class P(ctypes.Structure): _fields_ = [...]
  Go     mirror the C struct (cgo)

OWNERSHIP (the iron rule)
  Free with the SAME allocator that allocated.
  Conventions: caller-allocates-callee-fills (safest)
               callee-allocates -> use the PAIRED free function
               callee-owns      -> do NOT free
  Don't know? Don't free. Find out.

GC LANGUAGES (Java/Go/Python/C#)
  Pin buffers + keep a live reference for the whole native call.
  GC may MOVE or FREE objects mid-call otherwise.

OUT-PARAMS
  Pass &result; the function writes into it. (byref / ref / &mut)

OPAQUE HANDLES
  Pass them, store them, never look inside.
```

---

## Summary

Marshalling is the work of getting *data* — not just calls — safely across a language boundary. The three big mismatches are **strings** (NUL-terminated vs length-prefixed, UTF-8 vs UTF-16), **structs** (which must match C's byte layout exactly), and **arrays/buffers** (which must stay valid and unmoved during the call). Threaded through all of it is the **iron rule of ownership**: memory must be freed by the same allocator that allocated it, and exactly one side must own each allocation. In GC languages you must additionally **pin** buffers so the collector doesn't move or free them mid-call. Get the data rules right and FFI is reliable; get them wrong and you get garbled text, leaks, and crashes far from their cause.

---

## What You Can Build

- A small wrapper that calls a C string function (like `strlen` or a hashing routine) from your language, converting strings correctly.
- A binding that passes a struct to C and reads back the filled-in fields, with the right layout attribute.
- A "caller allocates, callee fills" buffer round-trip: hand C a buffer, let it write a message, read it back.
- A tiny library binding (e.g. to SQLite or a C math library) where you practice ownership: who frees each returned pointer.

---

## Further Reading

- Your language's FFI documentation: Python `ctypes`, Go `cgo`, Rust `std::ffi`, .NET P/Invoke, Java JNI / the Foreign Function & Memory API.
- The C standard library docs for `strlen`, `malloc`/`free`, and how `char*` strings work.
- Tutorials on UTF-8 vs UTF-16 and why text encoding matters at boundaries.
- The next files in this topic: `middle.md` (encodings, pinning, ownership conventions in depth) and `senior.md` (ABI-exact layout and GC interaction).

---

## Related Topics

Foreign function interface basics (calling the function before passing data); calling conventions and the C ABI; garbage collection and how collectors move objects; text encodings (UTF-8, UTF-16); memory management (stack, heap, allocators); the previous and following topics in this FFI section.

---

## Diagrams & Visual Aids

```text
The same word, five byte layouts:

  C      char*:    [ h ][ e ][ l ][ l ][ o ][\0]      NUL-terminated, no length
  Go     string:   ptr -> [ h ][ e ][ l ][ l ][ o ]   + length=5, NO NUL
  Rust   String:   ptr -> [ h ][ e ][ l ][ l ][ o ]   + len=5, cap, UTF-8, NO NUL
  Java   String:   [00 68][00 65][00 6C][00 6C][00 6F] UTF-16 (2 bytes/char)
  Python str/bytes: str is decoded; bytes is the raw char* shape

Marshalling = producing the C shape from yours (and back).


Ownership, drawn:

  caller allocates ──▶ [ buffer ] ──▶ callee fills ──▶ caller frees   (safest)
  callee allocates ──▶ returns ptr ──▶ caller frees with PAIRED fn
  callee owns      ──▶ returns ptr ──▶ caller MUST NOT free

  Allocator mismatch:
     Rust alloc ──▶ ptr ──▶ C free()  ==  HEAP CORRUPTION (crash later)
```
