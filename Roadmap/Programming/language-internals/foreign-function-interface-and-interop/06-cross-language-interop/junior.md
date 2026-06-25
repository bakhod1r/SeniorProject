# Cross-Language Interop — Junior Level

> **Topic:** [Cross-Language Interop](README.md)
> **Focus:** What it means for two whole programs written in different languages to talk to each other — and the two fundamentally different ways they do it: share a process, or send messages.

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

---

## Introduction

> Focus: **When a Python program needs to call a C library, or a Go service needs to talk to a Java service, what actually happens?**

You already know that a single program can be written in one language. But almost no real system is *only* one language. A web backend in Go calls a machine-learning model written in Python. That Python code calls a fast math library written in C. The whole thing talks to a billing service written in Java, and a desktop app written in C# uses a printer driver written in C++. **Cross-language interop** is the umbrella term for all the ways code written in one language reaches code written in another.

The first thing to understand is that there are really only **two big families** of answers, and everything else is a variation:

1. **In-process interop** — the two languages run inside the *same operating-system process*, sharing the same memory. The call from one language into the other is (almost) as fast as a normal function call. This is the world of FFI (Foreign Function Interface), of binding generators like SWIG, of polyglot virtual machines like the JVM and GraalVM, and of WebAssembly modules. It is *fast* but *dangerous*: a crash in one language crashes the whole process.

2. **Out-of-process interop** — the two languages run as *separate programs*, possibly on separate machines, and talk by **sending messages** to each other over a socket or pipe. The message is serialized (turned into bytes) on one side, sent, and deserialized on the other. This is the world of RPC (Remote Procedure Call), gRPC, REST, and message queues. It is *slower* (you pay for serialization and network) but *safer* (one side crashing does not take down the other).

In one sentence: **when two languages can't easily share a function-call convention, you either agree on a richer way to bind them in one process, or you give up on sharing a process and pass messages between two.**

> 🎓 **Why this matters for a junior:** Your first "I need to call the other team's service" moment is coming fast. Knowing whether to reach for an in-process binding (link a library) or out-of-process messaging (call an API) is one of the most consequential early decisions in a system — and getting it wrong means either a fragile crash-prone monolith or a slow chatty mess. This page gives you the map.

This page covers: what a "process" and an "ABI" are at a beginner level, why C is the common language everyone agrees on in-process, what serialization and RPC are, and a first concrete look at calling C from Python and calling one service from another. The deeper machinery — C++ name mangling, the WebAssembly Component Model, gRPC schema evolution, COM — lives in `middle.md`, `senior.md`, and `professional.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a basic program in at least one language (Python, Go, Java, JavaScript, C, or C#).
- **Required:** What a *function* is — it takes arguments, runs, and returns a value.
- **Required:** The rough idea that a program becomes a running *process* when you launch it.
- **Helpful but not required:** That data in memory is ultimately just bytes, and that text like `"hello"` and numbers like `42` have a binary representation.
- **Helpful but not required:** That programs can talk over a network using something like HTTP.

You do **not** need to know:

- C++ name mangling, vtable layout, or the details of an ABI (that's `middle.md` and `senior.md`).
- How a polyglot VM like GraalVM shares objects (that's `senior.md`).
- The WebAssembly Component Model or WIT (that's `senior.md` and `professional.md`).
- How to choose between gRPC, Thrift, and Cap'n Proto at scale (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Interop / interoperability** | The general ability of code written in different languages (or systems) to work together. |
| **Process** | A running program with its own private memory. Two processes cannot directly read each other's variables. |
| **In-process** | Two pieces of code running inside the *same* process, sharing memory. |
| **Out-of-process** | Two pieces of code running in *separate* processes, talking by sending data. |
| **FFI (Foreign Function Interface)** | A language feature that lets you call functions written in another (usually compiled, native) language directly, in the same process. |
| **Native code** | Machine code compiled for the CPU directly (C, C++, Rust), as opposed to code that runs on a VM/interpreter (Python, Java). |
| **ABI (Application Binary Interface)** | The low-level rules for *how* a compiled function is called: which registers hold arguments, how the stack is arranged, how names are spelled in the binary. The "machine handshake." |
| **C ABI** | The ABI used by C. It is simple and stable, so nearly every language agrees on it. It is the "lingua franca" of in-process interop. |
| **Binding** | Glue code that lets language A call a library written in language B. May be hand-written or auto-generated. |
| **Serialization (marshalling)** | Turning an in-memory value (an object, a struct) into a flat sequence of bytes that can be sent or stored. |
| **Deserialization (unmarshalling)** | The reverse: turning received bytes back into an in-memory value. |
| **RPC (Remote Procedure Call)** | Making a function call that actually runs in *another* process/machine, hiding the network behind a normal-looking function. |
| **IDL (Interface Definition Language)** | A small, language-neutral file that describes the data types and function signatures both sides agree on. A code generator turns it into real code for each language. |
| **gRPC / Protocol Buffers** | A popular RPC framework (gRPC) plus its IDL and serialization format (Protocol Buffers / protobuf). |
| **WebAssembly (Wasm)** | A portable, sandboxed binary format that many languages can compile to, increasingly used as a neutral interop target. |
| **Polyglot VM** | A virtual machine that can run several languages at once and let them share objects (e.g., the JVM, GraalVM). |
| **Sandbox** | An isolated environment where code runs with restricted access, so a bug or attack cannot damage the host. |

---

## Core Concepts

### 1. A Program Becomes a Process; Processes Don't Share Memory

When you run `python app.py` or launch a compiled binary, the OS creates a **process**: a private chunk of memory plus a thread of execution. The crucial fact for interop: **two separate processes cannot see each other's variables.** If your Python process has a list `[1, 2, 3]`, a Java process running next to it has no way to "just read" that list. The bytes live in a memory area the OS keeps private.

That single fact splits the whole topic in half:

- If you want speed and direct data sharing, you must get the other language's code to run **inside your process**.
- If you can't (or don't want to), you must **send a copy of the data** to the other process.

### 2. In-Process: The Problem Is the "Handshake" (ABI)

Say you want to call a function `add(a, b)` from a library, in the same process. At the machine level, the caller and the function must agree on tiny details: *Where do I put the arguments — in which CPU registers? Where does the return value go? What is the function actually named in the compiled file?* These rules together are the **ABI**.

Here is the catch: **different languages and compilers have different ABIs.** A C++ compiler renames `add` to something like `_Z3addii` (this is *name mangling*). A function might expect a class layout that another language doesn't understand. So languages can't just call into each other blindly.

The universal solution is to agree on the **simplest possible ABI — the C ABI**. C functions have plain names, plain arguments (numbers and pointers), and no hidden machinery. Almost every language can call a C function and expose itself *as if* it were C. That's why C is the "meeting point" of in-process interop: not because C is special as a language, but because its calling convention is the simple, stable thing everyone agreed on decades ago.

### 3. Out-of-Process: The Problem Is "How Do I Describe the Data?"

If the two languages run in separate processes, you can't share a function call at all. Instead you **send bytes**. But the sender's `User { name: "Ada", age: 36 }` and the receiver's idea of a user are different objects in different languages. So both sides must agree on a **wire format**: an exact byte layout for the data.

To avoid both sides writing fragile byte-pushing code by hand, you write a single **IDL** file describing the messages and operations, and a code generator produces matching code for each language. Send → serialize → transport → deserialize → receive. This is what gRPC, Thrift, and friends do.

### 4. The Core Trade-off: Speed vs. Isolation

This is the whole topic in one line:

| | In-process | Out-of-process |
|---|---|---|
| **Speed** | Very fast (function call, shared memory) | Slower (serialize + transport + deserialize) |
| **Isolation** | None — one crash kills everything | Strong — one side can crash alone |
| **Coupling** | Tight (same memory, same lifetime) | Loose (independent deploy, independent restart) |
| **Difficulty** | Subtle ABI/memory bugs | Schema and network handling |

You choose based on what you value more: raw performance and direct data sharing (in-process), or safety, independent deployment, and the ability to put the two halves on different machines (out-of-process).

### 5. The Spectrum (Preview)

It's not just two options — it's a *spectrum* from "fastest and most dangerous" to "slowest and most decoupled":

```text
fastest, most coupled                          slowest, most isolated
        ◄──────────────────────────────────────────────►
  Raw C-FFI   Polyglot VM      Wasm component       RPC / IPC
 (link a lib)  (shared GC,      (sandboxed,        (separate process,
              shared objects)    portable)          send messages)
```

You'll learn each of these in detail across the higher levels. For now, just hold the picture: there is a dial, and the dial trades speed for safety.

### 6. Why You Almost Never Write the Bytes by Hand

A beginner might think: "I'll just write the bytes myself." Don't. Hand-writing serialization or ABI glue is the source of endless bugs — one side adds a field, the other side reads garbage; one platform uses a different byte order; a string isn't null-terminated. The entire ecosystem of **binding generators** (SWIG, cppyy) and **IDL compilers** (protoc, Thrift) exists to generate that error-prone glue *correctly and automatically* from one source of truth.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Two languages, one process** | Two coworkers sharing one desk and one notebook — instant, but if one spills coffee, both lose their work. |
| **Two languages, two processes** | Two coworkers in different buildings emailing documents back and forth — slower, but a fire in one building doesn't burn the other. |
| **ABI** | The shape of an electrical plug. Two devices can only connect if their plugs and sockets match. |
| **C ABI as lingua franca** | English at an international conference — not because it's the best language, but because everyone agreed to use it to communicate. |
| **Name mangling** | A library that files books under cryptic internal codes instead of titles; you need the exact code to find one. |
| **Serialization** | Flat-packing furniture into a box to ship it; the receiver reassembles it from the instructions. |
| **IDL** | A blueprint both the factory and the assembler work from, so the part made in one country fits the product built in another. |
| **RPC** | Ordering takeout by phone: you say what you want as if talking to a person, but a whole delivery system runs behind the scenes. |
| **Sandbox (Wasm)** | A padded room where a guest can move around freely but can't reach anything outside or break the house. |
| **Polyglot VM** | A multilingual office where everyone speaks through one shared interpreter and writes on one shared whiteboard. |

---

## Mental Models

### The "Same Desk vs. Separate Buildings" Model

The single best model for a junior. Two languages either **share a desk** (one process, shared memory — fast, fragile) or work in **separate buildings** (separate processes, messages — slower, resilient). Every interop technology is a refinement of one of these two pictures. When someone describes a new approach, your first question should be: *same desk, or separate buildings?*

### The "Translator at the Border" Model

When data crosses a language boundary, it passes through a translator. In-process, the translator is a thin shim that re-labels the call so it matches the C ABI. Out-of-process, the translator is a serializer that packs the data into bytes and a deserializer that unpacks it. The translator always costs *something* — the only question is how much. The cheaper the translation, the tighter the coupling; the richer the translation, the more independence you buy.

### The "Lingua Franca" Model

For in-process interop, picture every language standing in a circle, none speaking the others' tongues. They all agree to speak one simple shared language — **C** — at the boundary. Nobody has to learn every other language; everyone just learns to speak and understand C. WebAssembly is an attempt to invent a *newer*, safer lingua franca for the same circle, with a modern, language-neutral type description (you'll meet it in `senior.md`).

---

## Code Examples

We'll do two tiny end-to-end examples: one **in-process** (Python calling C) and one **out-of-process** (one program sending a message to another). Keep both pictures side by side as you read.

### In-process: Python calls a C function (FFI)

First, a trivial C library:

```c
// mathlib.c  — compile to a shared library
int add(int a, int b) {
    return a + b;
}
```

Compile it into a shared object (`.so` on Linux, `.dylib` on macOS, `.dll` on Windows):

```bash
cc -shared -fPIC -o libmath.so mathlib.c
```

Now call it from Python using the built-in `ctypes` FFI — same process, no network:

```python
import ctypes

lib = ctypes.CDLL("./libmath.so")     # load the C library into THIS process
lib.add.argtypes = [ctypes.c_int, ctypes.c_int]
lib.add.restype = ctypes.c_int

print(lib.add(2, 3))                   # -> 5, a near-direct function call
```

Notice: there is no socket, no serialization, no second program. Python loaded the C code *into its own process* and called `add` almost like a normal function. We had to *declare the types* (`argtypes`, `restype`) because the boundary is the bare C ABI — Python and C must agree on "two ints in, one int out." That agreement is the whole job.

### Out-of-process: one program sends a message to another

Here the two halves are separate programs. They talk over a socket and agree on a simple text format (we'll use JSON — a beginner-friendly serialization).

The **server** (could be in any language; here Python):

```python
# server.py
import socket, json

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.bind(("127.0.0.1", 9000))
srv.listen()
print("listening on 9000")

while True:
    conn, _ = srv.accept()
    data = conn.recv(1024)
    request = json.loads(data)            # DESERIALIZE bytes -> dict
    result = {"sum": request["a"] + request["b"]}
    conn.sendall(json.dumps(result).encode())  # SERIALIZE dict -> bytes
    conn.close()
```

The **client** (a different process; could be a different language entirely):

```python
# client.py
import socket, json

cli = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
cli.connect(("127.0.0.1", 9000))
cli.sendall(json.dumps({"a": 2, "b": 3}).encode())  # SERIALIZE + send
reply = json.loads(cli.recv(1024))                  # receive + DESERIALIZE
print(reply["sum"])                                 # -> 5
cli.close()
```

Same `2 + 3 = 5` result, but everything is different: two processes, a socket, and explicit **serialize → send → receive → deserialize**. The client never touches the server's memory. If the server crashes, the client just gets a connection error — it does not crash too.

> **Tip:** Real systems don't hand-write the JSON glue like this. They use an RPC framework (gRPC, Thrift) where you describe the messages once in an IDL and a generator writes both client and server stubs for you. The mechanics above are exactly what those frameworks automate.

### The same idea, but "the other language is C++"

If the library you wanted to call in-process were **C++** instead of C, the FFI example would *not* work directly, because C++ mangles names and has features (classes, exceptions) that the C ABI doesn't describe. The standard fix is a thin **C wrapper**:

```cpp
// wrapper.cpp
#include "fancy_cpp_lib.hpp"

extern "C" {                       // <- "expose these with the plain C ABI"
    int add(int a, int b) {        // a flat C-style function...
        return FancyMath().add(a, b);  // ...that calls the real C++ inside
    }
}
```

`extern "C"` tells the C++ compiler "name and call these functions the simple C way, not the C++ way." Now Python's `ctypes` can find `add` again. You'll study this pattern properly in `middle.md`; for now, just remember: **to reach C++ from another language, you usually flatten it to a C interface first.**

---

## Pros & Cons

| Aspect | In-process interop | Out-of-process interop |
|--------|--------------------|------------------------|
| **Speed** | Excellent — function call, shared memory, no copy | Lower — serialize, transport, deserialize on every call |
| **Data sharing** | Direct: pass a pointer, share a buffer | Indirect: you always send a *copy* |
| **Fault isolation** | None — a crash anywhere kills the whole process | Strong — one side can crash and restart alone |
| **Deployment** | One unit; everything ships together | Independent: deploy and scale each side separately |
| **Setup difficulty** | Tricky: ABI, memory ownership, build/link complexity | Tricky differently: schemas, networking, versioning |
| **Languages can be on different machines?** | No — must be the same process, same machine | Yes — that's the whole point |
| **Debugging** | One debugger sees everything, but crashes are ugly | Two logs to correlate, but failures are clean errors |

The honest summary for a junior: **in-process buys you speed and direct data access at the cost of fragility and coupling; out-of-process buys you safety and independence at the cost of speed and latency.**

---

## Use Cases

**Reach for in-process interop when:**

- You need to call a fast native library (math, compression, cryptography, image processing) from a slower language like Python.
- The call happens *millions of times* and the per-call cost of serialization would dominate.
- You're embedding a scripting language (Lua, Python) inside a host application for plugins.
- The two languages already share a runtime (Kotlin and Java on the JVM; C# and F# on .NET).

**Reach for out-of-process interop when:**

- The other half is owned by another team and deployed separately (a microservice).
- You need fault isolation — a crash or memory bug in one language must not bring down the other.
- The two halves might run on different machines, or scale independently.
- You want to mix many languages freely without fighting each other's ABIs and build systems.

**Rule of thumb for beginners:** if you're not sure, **start out-of-process** (an API or RPC). It's easier to reason about, safer, and you can always optimize a hot path into in-process later. Going the other way — pulling apart a fragile in-process tangle — is much harder.

---

## Coding Patterns

### Pattern 1: The C-ABI shim (in-process)

To expose any language to others in-process, give it a flat C-style surface: simple functions, numbers and pointers only, no exceptions crossing the boundary.

```c
// Everything the outside world sees is plain C.
void*  thing_new(void);
int    thing_do(void* handle, int x);
void   thing_free(void* handle);
```

The `void*` is an **opaque handle** — the outside language holds it but never looks inside. You'll see why this matters in `middle.md`.

### Pattern 2: The IDL + generated stubs (out-of-process)

Describe the contract once; let a tool generate code for every language.

```proto
// add.proto  (Protocol Buffers IDL — language-neutral)
service Calculator {
  rpc Add(AddRequest) returns (AddReply);
}
message AddRequest { int32 a = 1; int32 b = 2; }
message AddReply   { int32 sum = 1; }
```

Run the generator (`protoc`) and you get a `Calculator` client and server in Go, Python, Java, etc. — all guaranteed to agree on the wire format.

### Pattern 3: Always declare the boundary types explicitly

Whether it's `ctypes` `argtypes`/`restype` or a `.proto` schema, **write down the exact types crossing the border**. The number-one beginner bug is a silent type mismatch (a 32-bit int read as 64-bit, a string read as a pointer). Make the contract explicit and machine-checked.

### Pattern 4: Keep the boundary small

Don't expose 200 functions or a deeply nested object graph across a language boundary. Define a *narrow* interface — a handful of operations with simple inputs and outputs. A small boundary is easier to get right, easier to version, and easier to move from in-process to out-of-process later.

---

## Best Practices

- **Default to the safer option.** When unsure, choose out-of-process (an API/RPC). Move to in-process only when you've measured a real performance need.
- **Never hand-roll serialization or ABI glue.** Use a generator (protoc, Thrift, SWIG, cppyy). Generated code is correct and stays in sync.
- **Make the contract a file, not folklore.** A `.proto` or `.h` header that both sides reference beats "the format is whatever the Python team last shipped."
- **Keep the interface narrow and the types simple.** Numbers, strings, and small structs cross boundaries cleanly; complex object graphs don't.
- **Flatten C++ to a C interface before exposing it.** Use `extern "C"` wrappers; don't try to call mangled C++ symbols directly.
- **Free what you allocate, on the side that allocated it.** Memory ownership across a language boundary is a top source of bugs (much more in `middle.md`).
- **Log on both sides of an out-of-process boundary.** When something fails, you'll want to see what the sender sent and what the receiver received.
- **Test the boundary with both languages.** A test that only exercises one side proves nothing about the agreement between them.

---

## Edge Cases & Pitfalls

- **"I'll just call the C++ function directly."** You usually can't — C++ name mangling means the symbol isn't named what you think. Use an `extern "C"` shim.
- **Silent type-size mismatches.** Declaring a C function's `int` as Python `c_long` (or vice versa) can read the wrong bytes and "work" by luck until it doesn't. Match types exactly.
- **Assuming in-process is always faster overall.** It's faster *per call*, but a crash that takes down the whole process can cost you far more than the latency you saved.
- **Forgetting that strings differ everywhere.** C strings end in a `\0` byte; many languages store a length instead; encodings (UTF-8 vs UTF-16) differ. A string is rarely "just a string" across a boundary.
- **Byte order (endianness).** Sending raw integer bytes between machines can break if they order bytes differently. Real serialization formats handle this; hand-rolled byte-pushing often doesn't.
- **Mixing up the two models.** Treating an out-of-process RPC call as if it were free (like an in-process call) leads to "chatty" designs that make thousands of network round-trips. Remember: every RPC pays the serialize-and-transport tax.
- **No versioning plan.** The day one side adds a field and the other hasn't updated is the day things break — unless your format was designed for evolution (a `senior.md`/`professional.md` topic).
- **One side crashes the other (in-process).** Because they share a process, a segfault in the C library kills your Python program too — there's no firewall between them. Isolation is exactly what out-of-process buys.
- **Forgetting to free, or freeing twice.** Across an FFI boundary the garbage collector of one language doesn't know about memory the other allocated. This is the single most common in-process interop bug; we'll dedicate real space to it in `middle.md`.
