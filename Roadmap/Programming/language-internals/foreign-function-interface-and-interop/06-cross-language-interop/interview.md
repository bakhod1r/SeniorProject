# Cross-Language Interop — Interview Questions

> **Topic:** [Cross-Language Interop](README.md)
> **Focus:** Interview-style questions and answers spanning the interop spectrum — in-process FFI, polyglot VMs, Wasm components, and RPC/IPC — plus the technology-specific depth (C++ shims, WIT, gRPC/Protobuf, COM/.NET, GraalVM) and the tricky traps that separate someone who has read about interop from someone who has shipped it.

---

## Introduction

These questions test whether a candidate can reason about cross-language interop as an *architectural* decision, not just recite that "FFI is fast." Strong answers connect a mechanism to its consequences — crash domain, coupling, evolution, security — and pick deliberately rather than by habit. The questions are grouped into Conceptual, Technology-Specific (C++ interop, WebAssembly Component Model, gRPC/Protobuf, COM/.NET, GraalVM/JVM polyglot), Tricky-Trap, and Design. Each answer is written to be the kind of response a senior or staff engineer would give in a real interview.

## Table of Contents

- [Conceptual](#conceptual)
- [Technology-Specific](#technology-specific)
- [Tricky-Trap](#tricky-trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Lay out the spectrum of cross-language interop mechanisms and the one axis that orders them.**

The axis runs from *fastest and most coupled* to *slowest and most decoupled*. In order: **in-process FFI** (a near-native call, shared memory, one crash domain, ABI-fragile); **polyglot VM** (shared heap, types, and GC — interop nearly free, but still one process and no fault isolation); **Wasm component** (sandboxed, portable, a stable WIT ABI — near-native speed *and* isolation); **RPC/IPC with an IDL** (serialized, isolated, independently deployable — slowest per call, most decoupled). The single axis is **coupling**: how much two pieces of software share — memory, crash domain, deployment. You choose a point on it by the dominant constraint.

## Question 2

**Why is in-process FFI both the fastest and the most dangerous option?**

Fastest because a foreign call is a handful of instructions over a native call — no serialization, no copy, no hop. Most dangerous because the boundary has no protection: the foreign code shares your address space (a buffer overflow is an RCE into your process), shares your crash domain (a segfault kills the whole process, not a request), and the ABI is a fragile binary contract that a compiler or flag change can silently corrupt. You also inherit its threading, reentrancy, and lifetime assumptions. Speed and danger are the same property — there is nothing between you and the foreign code.

## Question 3

**What does "shared crash domain" mean, and which mechanisms have one?**

A crash domain is the set of components that die together when one faults. In-process FFI and polyglot VMs share one crash domain — a fault anywhere in the process (a native segfault, an unrecoverable error) takes everything down. RPC/IPC does not: the remote process can crash and yours returns a clean error. A Wasm component is effectively isolated — a guest fault traps and surfaces as a host-side error rather than corrupting or crashing the host. Knowing the crash domain of each boundary is how you reason about blast radius.

## Question 4

**Why do polyglot VMs make interop "nearly free," and what is the catch?**

Because the participating languages do not have separate ABIs at all — Kotlin, Scala, and Java all compile to JVM bytecode and share one heap, one object model, one GC; C#, F#, and VB.NET share the CLR's Common Type System. A value created in one language *is* the same object another holds; no marshalling. The catch is twofold: every language must target that runtime (you cannot bring an arbitrary native language in), and the shared runtime is **not fault isolation** — one process, one GC, so an OOM or a native-dependency crash takes down every language at once.

## Question 5

**When is RPC the correct choice even though it is the slowest?**

When the dominant requirement is one that no in-process mechanism can satisfy: **fault isolation** (a crash-prone or untrusted component must not take down the host), **independent deployment and rollback** (each side ships on its own cadence), **independent scaling** (a CPU-heavy component scales horizontally), or a **cross-machine** boundary. In those cases RPC's serialization-and-hop latency is the price of a real boundary, and FFI would be an architectural bug. You choose the slower mechanism on purpose.

## Question 6

**What makes the Wasm Component Model the "emerging interop answer"?**

It uniquely combines properties nothing else offers together: near-native speed, strong sandboxing (a component touches only its own linear memory and granted capabilities), language neutrality (many source languages compile to components), portability (one component runs on any conforming runtime), and a *stable, specified ABI* — the canonical ABI — described by a rich IDL, WIT. It solves the in-process interop problem properly: instead of hand-rolling a layout in linear memory, you describe an interface once in WIT and the toolchain lifts and lowers rich types across a standardized ABI, inside a sandbox.

## Question 7

**Why does an IDL matter for RPC, and what does it buy you?**

The IDL is the single language-neutral description of types and operations; a code generator produces stubs in every language from it. It buys you three things: **cross-language reach** (any language with a generator can speak the contract), **decoupling** (the contract is the only thing the two sides share — they can be different languages, runtimes, versions), and a **disciplined evolution story** (field numbers, reserved tags) that lets the two sides change independently without breaking the wire. The IDL is the durable artifact; implementations are replaceable.

## Question 8

**Contrast "schema-defined boundary" (RPC) with "binary-ABI boundary" (FFI) as evolution surfaces.**

An FFI boundary is a binary ABI — struct layout, calling convention, sizes — that is fragile and not designed to evolve; changing a struct breaks every caller unless they recompile against the new layout, and even then mismatches corrupt silently. A schema-defined boundary is built to evolve: add optional fields, reserve retired ones, and old and new sides interoperate across the version gap. That is why RPC boundaries survive independent deployment and FFI boundaries generally do not.

---

## Technology-Specific

## Question 9

**Why can't you FFI directly into a C++ class, and what is the standard fix?**

C++ has name mangling (no stable symbol names), an unstable ABI across compilers, exceptions that cannot legally cross a C frame, templates that do not exist at link time, and an object model (vtables, multiple inheritance) no other language understands. The fix is the **`extern "C"` shim**: a thin C-linkage layer that wraps the C++ API in flat functions over **opaque pointers**. The C side sees `Parser*` and calls `parser_create` / `parser_parse` / `parser_destroy`; it never sees the C++ layout, no C++ types cross, and exceptions are caught and converted to error codes at the shim.

## Question 10

**What are the rules for a correct `extern "C"` shim?**

Four rules. (1) **Opaque handle in, opaque handle out** — construction/destruction through `create`/`destroy`, never expose the layout. (2) **No C++ types cross the boundary** — only C scalars, pointers, and length pairs; strings become `const char*` + length. (3) **Exceptions never escape** — wrap each function body in `try { ... } catch (...) { return error; }`, because unwinding through a C frame is undefined behavior. (4) **One owner, one allocator** — the side that allocates frees, with the matching allocator; if the shim returns a buffer, the shim provides the free function.

## Question 11

**What is SWIG and what does it not free you from?**

SWIG (Simplified Wrapper and Interface Generator) reads an interface file describing your C/C++ headers and generates binding glue for many target languages at once — the C shim, the language wrapper, marshalling, and proxy classes. It saves you from hand-writing N bindings. It does *not* free you from understanding the C ABI: you still own the interface-file surface, the ownership annotations (`%newobject`/`%delobject` exist because SWIG cannot infer who frees what), and the sharp edges around templates, callbacks, and exceptions. Treat the `.i` file as a reviewed artifact, not a magic box.

## Question 12

**Explain the Wasm Component Model and WIT to someone who only knows core Wasm.**

Core Wasm is a numeric stack machine with a flat linear memory; it standardizes the *numeric* boundary but not rich types — passing a string between two core modules still requires an unspecified, hand-agreed memory layout, which is the old ABI problem in a new place. The **Component Model** layers language-neutral, richly typed interfaces on top, and **WIT** is its IDL: you describe records, variants, lists, strings, `result<T,E>`, and `resource` handles once. The toolchain **lowers** a guest's native value into the **canonical ABI** in linear memory and **lifts** it on the other side. The canonical ABI is specified and stable — it is the actual solution to the ABI problem.

## Question 13

**What is a WIT `resource` and why is it better than a raw `void*` handle?**

A `resource` is a handle to an opaque, owned object passed across a component boundary — the Component Model's principled successor to the opaque pointer. Unlike a raw `void*`, a `resource` carries ownership and lifetime semantics that the *toolchain* enforces: it tracks who owns the handle and ensures it is dropped exactly once, rather than relying on hand-written discipline and hoping no path leaks or double-frees. It is the safe, typed version of the pattern you would otherwise implement by convention with C handles.

## Question 14

**How does WASI's capability model make Wasm suitable for untrusted code?**

A Wasm component has **no ambient authority** — by default it cannot open files, sockets, or even read the clock. WASI grants those capabilities **explicitly and narrowly**: the host preopens a specific directory, hands over a specific socket or clock, and that is all the component can touch. There is no `open("/etc/passwd")` because there is no filesystem unless granted. This turns "run third-party code" from an unbounded risk into a bounded, auditable grant, and combined with the sandbox (memory isolation, trap-on-fault) it gives you near-native speed *with* isolation — the combination raw FFI cannot offer.

## Question 15

**Walk through how a Protobuf message is structured on the wire and why field numbers matter.**

A Protobuf message on the wire is a sequence of (field-number, wire-type, value) records — the **field number is the identity**, not the field name (names exist only in the `.proto`, not on the wire). That is why field numbers are the contract: a reader matches incoming records by number, ignores unknown numbers, and uses defaults for missing ones. Reusing or renumbering a field silently reinterprets old bytes as a different field. The whole evolution story — add, reserve, never reuse — rests on the stability of those numbers.

## Question 16

**Compare gRPC/Protobuf, Cap'n Proto, and FlatBuffers.**

All three are IDL-plus-codegen systems for cross-language data and (for gRPC) RPC. **Protobuf/gRPC** has a compact binary wire format and the richest ecosystem and evolution discipline, but pays a *parse* step — decoding the wire into language objects. **Cap'n Proto** makes the wire format *be* the in-memory format, so there is no parse step (zero-copy); you read fields directly from the buffer, trading a less compact, more rigid layout for eliminating decode cost. **FlatBuffers** is similarly zero-copy / no-parse — you access data through generated accessors over the buffer, popular where you mmap a buffer and read a few fields without materializing the whole structure. Pick Protobuf for ecosystem and evolution; pick Cap'n Proto / FlatBuffers when deserialization cost is your bottleneck.

## Question 17

**Explain IUnknown and the role of QueryInterface, AddRef, and Release in COM.**

`IUnknown` is the base interface every COM object implements, providing the three operations that make cross-language objects work. **`QueryInterface(iid, ppv)`** is identity and discovery — "do you support interface X? if so, give me a pointer to it" — and crucially every pointer it returns is a *new owned reference*. **`AddRef`** increments the reference count; **`Release`** decrements it and, when it reaches zero, the object destroys itself. Because the contract is the vtable layout plus this trio, any language that can call through a vtable and honor the count can use the object — that is COM's cross-language power and its lifetime discipline in one.

## Question 18

**What are the two classic COM refcount bugs and how do you prevent them?**

**Refcount leak** — an `AddRef` (or a `QueryInterface` result) without a matching `Release`; the object lives forever, a slow leak that takes weeks to OOM a service. **Over-release** — one `Release` too many; the object frees while other holders still point at it, a use-after-free that crashes far from the bug. The prevention is the same: **RAII smart pointers** (`CComPtr`, `ComPtr`, `_com_ptr_t`) that `AddRef` in the constructor and `Release` in the destructor, so the count is tied to scope and no early return or exception can leak or over-release. Treat any raw `AddRef`/`Release` in modern code as a smell.

## Question 19

**How do WinRT and .NET COM interop relate to raw COM?**

**WinRT** is a metadata-rich modern evolution of COM that underpins modern Windows APIs — same vtable/`IUnknown` foundation, but with rich metadata enabling projection into many languages. **.NET COM interop** bridges managed code to COM via **runtime callable wrappers** (and COM callable wrappers in the other direction), and the .NET garbage collector largely manages the refcounting for you, so you rarely call `AddRef`/`Release` by hand. The relationship: both build on the raw COM binary contract; the moment you drop *below* them to raw COM, the reference counting becomes your manual responsibility again.

## Question 20

**Why is GraalVM/Truffle polyglot interop different from JVM-family interop?**

JVM-family interop works because Kotlin, Scala, and Java all compile to the *same bytecode* and share one object model — interop is just method calls within one type system. GraalVM/Truffle generalizes beyond a single bytecode: language interpreters are written so the Graal JIT can optimize them, and a shared **interop message protocol** (read member, execute, get array element) lets, say, a JavaScript object be read from Python or a Java method called from Ruby. The languages keep their own semantics but exchange live objects through the common protocol — no per-pair hand-written bindings. The trade-off is engine lock-in and uneven per-language maturity.

---

## Tricky-Trap

## Question 21

**"We use a polyglot VM, so the languages are isolated from each other." True or false?**

False, in the sense that matters operationally. They are isolated *logically* — each language keeps its own semantics and type system — but they share one process, one heap, and one GC. A native crash in a JNI dependency, an `OutOfMemoryError`, or a runaway thread takes down *every* language at once. Logical interop is not fault isolation. If you need a crash boundary, a polyglot VM does not give it to you; you need separate processes (RPC) or a sandbox (Wasm components).

## Question 22

**A teammate says "core Wasm solved cross-language interop." Where are they wrong?**

Core Wasm standardizes only the *numeric* boundary and the sandbox. To pass anything richer than i32/i64/f32/f64 — a string, a struct, a list — between two core modules, you must agree on a layout in linear memory (pointer + length? null-terminated? which encoding?), and at the core level that agreement is unspecified. So you are back to hand-rolling an ABI, just inside a sandbox. What actually solves rich-type interop is the **Component Model + WIT + the canonical ABI**, which is a layer on top of core Wasm.

## Question 23

**You removed a Protobuf field and reused its field number for a new field in the same release. What happens?**

Silent data corruption across versions. Old producers still on the prior schema write the old field's bytes under that number; new consumers read them as the new field — so garbage flows through. Field numbers are the wire contract; you must **reserve** a retired number (and its name) forever and never reuse it. The defense is a CI compatibility test that serializes with one schema version and deserializes with the adjacent versions, asserting no loss.

## Question 24

**Why is a C++ exception that propagates into your C FFI shim a bug even if "it seems to work"?**

Because unwinding a C++ exception through a C stack frame is *undefined behavior*. It may appear to work on one compiler/platform and crash, leak, or corrupt on another, or after an optimization change. The C ABI has no concept of exceptions or stack unwinding tables for those frames. The correct design catches every exception at the shim boundary (`catch (...)`) and converts it to an error code or null return. "It seems to work" is the most dangerous failure mode because it passes tests and breaks in production.

## Question 25

**You picked gRPC for a boundary between two modules in the same process, same team, with a sub-millisecond budget. What's wrong?**

You paid for isolation you did not need. gRPC adds a serialize → hop → deserialize tax on every call, which can consume most of a sub-millisecond budget. The boundary needs no fault isolation (one team, one deploy, acceptable shared crash domain) and no language barrier. RPC is the right tool when you need a crash boundary, independent deploy/scale, or a cross-machine hop; when you need none of those, its latency is pure waste — an in-process call (or shared-runtime interop) is correct.

## Question 26

**`QueryInterface` succeeded and you used the returned pointer, then forgot to Release it. Is that a leak or a crash?**

A leak. Every pointer `QueryInterface` hands back is a *new owned reference* — an implicit `AddRef`. Forgetting the matching `Release` means that reference is never dropped, so the object's count never reaches zero and it is never freed. It is one of the most common COM leaks precisely because it is easy to forget that a successful `QueryInterface` is itself an ownership transfer. The fix is to capture the result in a `ComPtr` so the `Release` is automatic.

## Question 27

**"The Component Model is zero-cost because it's in-process." Where does this break down?**

Lift and lower are not free. The canonical ABI copies values across the boundary — a large `record`, a long `list`, or a big `string` is materialized on each side. For most workloads the cost is negligible against the benefit, but on an ultra-hot path passing large payloads, the copy can matter, and you should measure rather than assume "in-process means free." It is far cheaper than RPC serialization, but it is not the literally-zero cost of sharing a pointer in raw FFI.

## Question 28

**You returned a heap buffer from your C++ shim and the caller freed it with their language's free. Why might this crash?**

Because the allocator that allocated the buffer (your C++ `new` / your CRT's allocator) may differ from the one the caller's `free` uses. Freeing memory with a different allocator than the one that allocated it is undefined behavior — heap corruption or a crash, often far from the site. The shim must expose a matching free function (`buffer_free`) so the same allocator that allocated also frees. "One owner, one allocator" is a hard rule, not a guideline.

---

## Design

## Question 29

**Design the interop boundary for a SaaS platform that runs customer-supplied plugins in the request path with low latency.**

The dominant constraints are **untrusted code**, **in-process latency**, and **safety**. FFI is out — a customer plugin's buffer overrun would corrupt or crash the host. Pure RPC adds latency you are trying to avoid and operational complexity per plugin. The right answer is **Wasm components**: compile plugins to components against a WIT interface, run them sandboxed in-process for near-native speed, and grant each plugin only the WASI capabilities it needs (no ambient filesystem/network). A plugin fault *traps* and returns a host-side error instead of taking down the worker. Version the WIT interface, pin component-to-interface compatibility, and measure lift/lower cost for large payloads. This buys speed *and* isolation, which no other point on the axis gives together.

## Question 30

**Design a boundary between two teams' services with separate SLAs, release trains, and on-call rotations.**

This boundary is organizational as much as technical, so it must be **decoupled**: independent deploy, independent failure, independent scaling. The answer is **RPC with an IDL** — gRPC/Protobuf as the default. Define the service contract in a `.proto`, generate stubs for each team's language, and treat the schema as the API. Enforce **schema-evolution discipline**: optional fields only, stable field numbers, reserved retirements, and a CI compatibility test round-tripping adjacent versions. The serialization-and-hop latency is the deliberate price of a crash boundary and independent lifecycles. If decode latency later becomes the bottleneck, consider Cap'n Proto or FlatBuffers for the hot messages.

## Question 31

**You need to expose a large, performance-critical C++ image library to Python, Java, and C#. Design the interop.**

Two layers. First, a **`extern "C"` shim** over the C++ library: opaque handles for image objects, flat functions for operations, strings as pointer+length, exceptions caught and converted to error codes, and a matching free function for every buffer the shim returns. Second, generate the per-language bindings — use **SWIG** (or hand-write for a small surface) driven by a reviewed interface file, so one description produces Python, Java, and C# wrappers, with explicit ownership annotations so no path leaks. Keep the boundary surface small and the hot operations coarse-grained to amortize the crossing. Document the ownership and threading contract explicitly. FFI is correct here because the code is *trusted* and the throughput justifies the coupling.

## Question 32

**Given a fault-isolation requirement — a crash-prone third-party codec must never take down the service — compare FFI and RPC and justify your choice.**

FFI would load the codec into the service's address space: a segfault on a malformed input kills the whole process, repeatedly, as bad input replays — exactly the failure the requirement forbids. RPC/IPC runs the codec in a separate process behind an IDL; a crash there kills only that worker, the service returns a clean error, and the supervisor restarts the worker. The cost is serialization plus an IPC hop per call, which you measure against the latency budget. Because the *dominant constraint is fault isolation*, RPC is the correct architecture and FFI would be the bug. (If the latency cost is unacceptable and the codec can be recompiled, a Wasm component — sandboxed, trap-on-fault, near-native speed — is the middle-ground alternative worth evaluating.)
