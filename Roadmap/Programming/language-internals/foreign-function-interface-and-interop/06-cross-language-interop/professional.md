# Cross-Language Interop — Professional Level

> **Topic:** [Cross-Language Interop](README.md)
> **Focus:** Making the interop decision in production — the FFI vs polyglot-VM vs Wasm-component vs RPC framework, the engineering discipline that keeps each one alive (C++ shims, COM refcounting, schema evolution), and the failure modes that send a team back to redesign.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
  - [The Production Decision Framework](#the-production-decision-framework)
  - [In-Process FFI: Fastest, Most Dangerous](#in-process-ffi-fastest-most-dangerous)
  - [Flattening C++ Through a `extern "C"` Shim](#flattening-c-through-a-extern-c-shim)
  - [SWIG and Generated Bindings at Scale](#swig-and-generated-bindings-at-scale)
  - [COM: vtables, IUnknown, and Refcount Discipline](#com-vtables-iunknown-and-refcount-discipline)
  - [Polyglot VMs in Production](#polyglot-vms-in-production)
  - [Wasm Components: The Emerging Interop Answer](#wasm-components-the-emerging-interop-answer)
  - [RPC/IPC with an IDL](#rpcipc-with-an-idl)
  - [Schema-Evolution Discipline](#schema-evolution-discipline)
  - [Choosing RPC Over FFI for Fault Isolation](#choosing-rpc-over-ffi-for-fault-isolation)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [War Stories](#war-stories)
- [Summary](#summary)

---

## Introduction

At the professional tier — Staff, Principal, Distinguished — cross-language interop stops being "how do I call this library from my language" and becomes "which boundary do I draw, and what will it cost the organization for the next five years." The senior tier gave you the full spectrum: in-process FFI, polyglot VMs, Wasm components, and RPC. This page is about choosing among them under real constraints — latency budgets, fault-isolation requirements, team boundaries, portability mandates, and the maintenance burden of whatever you pick — and then keeping that choice healthy in production.

The recurring theme is that **interop is a coupling decision disguised as a technical one.** When you pick in-process FFI you are saying "these two languages will share a crash domain, a deployment, and a memory space forever." When you pick RPC you are saying "these two systems will evolve independently, fail independently, and pay a serialization tax on every call." Neither is right or wrong in the abstract; the professional skill is reading which constraint dominates and not defaulting to whatever the team used last time. A trading firm that picks gRPC for a sub-microsecond inner loop has made an architectural error; a platform team that picks a hand-written FFI shim for a multi-tenant plugin surface has made a security and reliability error. Both errors are common, both are expensive, and both are avoidable with a framework.

This document assumes you can already flatten a C++ class to a C ABI, write a `.proto`, and explain the canonical ABI. What changes here is consequence and discipline. We will walk the decision framework explicitly, then go deep on the engineering that keeps each mechanism alive in production: the shim layer that wraps a C++ API, the refcount accounting that COM demands, the schema-evolution rules that let an IDL outlive a single deploy, and the precise reasoning that makes RPC the correct choice when fault isolation is the hard requirement.

> 🎓 **Why this matters at this level:** The interop boundary is one of the hardest architectural decisions to reverse. Migrating from an in-process FFI to RPC is a multi-quarter project that touches build systems, deployment, observability, and on-call. Getting it right the first time is worth more than almost any micro-optimization you will make this year.

---

## Prerequisites

- Junior, middle, and senior tiers of this topic fully internalized.
- Hands-on experience flattening at least one C++ or Rust API to a C ABI and binding it from a managed language.
- Having defined and evolved at least one IDL-based service (Protobuf/gRPC, Thrift, or similar) in production.
- Familiarity with at least one polyglot runtime (JVM-family or .NET-family) and one Wasm toolchain.
- Operational experience: on-call for a service whose failures crossed a language boundary.
- Comfort reasoning about crash domains, blast radius, and deployment coupling.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Crash domain** | The set of components that die together when one of them faults. In-process FFI and polyglot VMs share one; RPC and sandboxed components do not. |
| **Coupling axis** | The spectrum from tightly coupled (shared memory, shared deploy) to loosely coupled (independent processes, independent deploy). |
| **`extern "C"` shim** | A C-linkage wrapper around C++ code that exposes a flat, name-mangling-free, exception-free C ABI surface. |
| **Opaque pointer / handle** | A `void*` (or typed-but-opaque struct pointer) that represents a C++ object across the boundary without exposing its layout. |
| **SWIG** | Simplified Wrapper and Interface Generator — generates binding code from an interface file for many target languages. |
| **COM** | Component Object Model — Microsoft's binary standard for cross-language objects via vtable interfaces and `IUnknown` refcounting. |
| **IUnknown** | The base COM interface: `QueryInterface`, `AddRef`, `Release`. Identity, discovery, and lifetime. |
| **Refcount leak** | An object never freed because an `AddRef` was not matched by a `Release`. |
| **Over-release** | An object freed early because `Release` was called more times than `AddRef`, causing use-after-free in remaining holders. |
| **WIT** | WebAssembly Interface Types — the IDL of the Wasm Component Model. |
| **Canonical ABI** | The Component Model's specified, stable layout of WIT types over core Wasm. |
| **IDL** | Interface Definition Language — a language-neutral description of types and operations (`.proto`, `.thrift`, `.capnp`, WIT). |
| **Wire compatibility** | Whether messages produced by one schema version can be read by another. |
| **Field number / tag** | The stable integer identity of a field in Protobuf/Thrift; the contract, not the field name. |
| **Zero-copy deserialization** | Reading structured data directly from the wire buffer without parsing into separate objects (Cap'n Proto, FlatBuffers). |
| **Fault isolation** | The property that one component's failure cannot corrupt or crash another. |

---

## Core Concepts

### The Production Decision Framework

Every interop mechanism sits on one axis from *fastest and most coupled* to *slowest and most decoupled*:

```text
  In-process FFI    Polyglot VM        Wasm component       RPC / IPC (IDL)
  ──────────────    ──────────────     ──────────────       ──────────────
  ns-scale call     ns-scale call      µs-scale call        ms-scale call
  shared memory     shared heap+GC     sandboxed memory     separate processes
  one crash domain  one crash domain   isolated*            isolated
  ABI fragility     runtime lock-in    stable WIT ABI       schema + network
  most dangerous    same-runtime only  portable+secure      most decoupled
```

(*A Wasm component traps rather than corrupting the host; the host survives the guest's failure.)

Walk these questions in order; the first "yes" usually wins:

1. **Do the languages already share a runtime** (all JVM, all .NET)? Use shared-runtime interop. There is no boundary to design — it is just method calls. Reaching for FFI or RPC here is self-inflicted complexity.
2. **Is this a hard fault-isolation, independent-deploy, or cross-machine requirement?** Use RPC/IPC. Accept the latency; you are buying a crash boundary and independent lifecycles, which no in-process mechanism gives you.
3. **Do you need to run untrusted or third-party code in-process at near-native speed?** Use Wasm components with WASI capabilities. This is the only point on the axis that gives speed *and* a sandbox.
4. **Do you need maximum throughput against trusted native code, and can you own the maintenance of a binding layer?** Use FFI — flatten to a C ABI. This is the fastest and the most dangerous; pick it with eyes open.

The trap at every level below Principal is **defaulting to the familiar mechanism.** A team that ships microservices reaches for gRPC even for an in-process plugin; a team that lives in C++ reaches for FFI even when the boundary is a security perimeter. The framework exists to interrupt the default.

### In-Process FFI: Fastest, Most Dangerous

FFI is the fastest interop there is — a foreign call is a few instructions over a native call. It is also the most dangerous, for reasons that compound:

- **Shared crash domain.** A null deref, a buffer overrun, or an `abort()` in the foreign code takes down the whole process. Your Python web server does not "catch an exception" when the C library segfaults; it dies.
- **Shared memory, no boundary.** Foreign code can scribble anywhere in your address space. A buffer overflow in a parsing library is a remote code execution path into your host.
- **ABI fragility.** The boundary is a binary contract — struct layout, calling convention, name mangling, type sizes. A compiler upgrade, a flag change, or a 32-vs-64-bit mismatch corrupts data silently.
- **Lifetime and ownership ambiguity.** Who frees this pointer? With which allocator? When? Every FFI boundary needs an explicit ownership contract, and most production FFI bugs are violations of an implicit one.
- **Threading and reentrancy.** The foreign library's threading assumptions (does it have global state? is it reentrant? does it expect a specific thread?) are now your problem.

The professional posture: use FFI when you genuinely need the throughput against *trusted* native code, keep the boundary surface tiny, flatten it to a clean C ABI, and write down the ownership and threading contract as if a junior will violate it — because one will.

### Flattening C++ Through a `extern "C"` Shim

You cannot FFI directly into a C++ class. C++ has name mangling, an unstable ABI across compilers, exceptions that cannot cross a C boundary, templates that do not exist at link time, and an object model (vtables, multiple inheritance) that no other language understands. The universal answer is the **`extern "C"` shim**: a thin C-linkage layer that wraps the C++ API in flat functions operating on **opaque pointers**.

The pattern has four rules:

1. **Opaque handle in, opaque handle out.** The C side sees `typedef struct Parser Parser;` and `Parser*`; it never sees the C++ layout. Construction and destruction go through `parser_create` / `parser_destroy`.
2. **No C++ types cross the boundary.** No `std::string`, no `std::vector`, no references, no templates — only C scalars, pointers, and length pairs. Strings become `const char*` + length; collections become pointer + count.
3. **Exceptions never escape.** Every shim function wraps its body in `try { ... } catch (...) { return error_code; }`. A C++ exception unwinding through a C frame is undefined behavior; the shim is where you convert exceptions to error codes.
4. **One owner, one allocator.** The side that allocates frees. If the shim returns a buffer, the shim provides the function to free it — never assume the caller's `free` matches your `new`.

This shim is the load-bearing wall of any C++ FFI. It is also where SWIG, cbindgen (for Rust), and every binding generator ultimately operate: they all produce or assume a C ABI surface.

### SWIG and Generated Bindings at Scale

Writing the shim by hand for a small surface is correct. For a large API — hundreds of functions, target bindings in Python, Java, C#, Ruby, and more — hand-writing every binding is unsustainable. **SWIG** reads an interface file (a `.i` that wraps your C/C++ headers) and generates the glue for many target languages at once: the C shim, the language-specific wrapper, type marshalling, and even proxy classes that map C++ objects to target-language objects.

What SWIG buys you: one interface description, N language bindings, regenerated on every header change. What it costs you: a generated layer you do not fully control, marshalling overhead you did not write, and sharp edges around ownership (SWIG's `%newobject` / `%delobject` directives exist precisely because it cannot infer ownership), templates, callbacks, and exceptions. The professional discipline is to treat the `.i` interface file as a real artifact — review it, narrow the exposed surface deliberately, and own the ownership annotations rather than letting the defaults leak resources. SWIG does not remove the need to understand the C ABI; it removes the need to type it N times.

### COM: vtables, IUnknown, and Refcount Discipline

COM is the canonical "cross-language objects via a binary contract" system, and it remains everywhere on Windows. A COM object exposes one or more **interfaces**, each a **vtable** — a table of function pointers with a fixed, agreed binary layout. Every interface derives from **IUnknown**, which provides three methods:

- `QueryInterface(iid, ppv)` — identity and discovery: "do you support interface X? if so, give me a pointer to it."
- `AddRef()` — increment the reference count.
- `Release()` — decrement; when the count hits zero, the object destroys itself.

Because the contract is *vtable layout + IUnknown*, any language that can call through a vtable and honor the refcount can use a COM object: C++, C#, VB, Delphi, scripting languages. That is the power. The danger is **manual reference counting**, which is the COM bug factory:

- **Refcount leak.** You obtain an interface pointer (which is an implicit `AddRef`, or an explicit one) and forget the matching `Release`. The object lives forever. In a long-running service this is a slow memory leak that takes weeks to manifest.
- **Over-release.** You `Release` once too often. The object frees while other holders still point at it — use-after-free, often a crash far from the bug.
- **`QueryInterface` ownership.** Every pointer `QueryInterface` hands back is a *new reference you own.* Forgetting to release it is the single most common COM leak.

The disciplines that tame this: **smart-pointer wrappers** (`CComPtr`, `ComPtr`, `_com_ptr_t`) that `AddRef`/`Release` in their constructor/destructor so the count is RAII-managed; the **"rule of AddRef/Release pairs"** audited in review; and treating any raw `AddRef`/`Release` call in modern code as a smell. WinRT and .NET COM interop largely automate the refcounting (runtime callable wrappers), but the moment you drop to raw COM, the count is yours.

### Polyglot VMs in Production

When all participating languages already target the JVM or CLR, interop is nearly free — Kotlin holds a real Java object, F# defines a type C# consumes as first-class. GraalVM generalizes this to JavaScript, Python, Ruby, and LLVM-based languages sharing one engine. In production this is the cheapest correct interop *if* you can pay the entry fee.

The professional caveats are about what the shared runtime does *not* give you:

- **It is not fault isolation.** One heap, one GC, one process. An `OutOfMemoryError`, a native crash in a JNI dependency, or a runaway thread takes down every language at once. Logical interop is not a crash boundary.
- **GC interop is the hard edge.** When a polyglot value references native memory (or two runtimes reference each other), neither GC can prove a cycle is dead. JNI global references, GraalVM host/guest references, and finalizer ordering are where polyglot-VM leaks and crashes live.
- **Performance is uneven.** GraalVM guest languages vary in maturity and peak performance; a Python-on-GraalVM workload may or may not beat CPython depending on the path.
- **Lock-in is real.** Committing a system to GraalVM polyglot is committing to that engine's lifecycle and operational model.

### Wasm Components: The Emerging Interop Answer

The Wasm Component Model with WIT is, in 2026, the most promising answer to the in-process interop problem because it gives the combination nothing else does: **near-native speed, strong sandboxing, language neutrality, portability, and a stable ABI.** You describe an interface once in WIT; any language with a component toolchain implements or consumes it; the toolchain lifts and lowers rich types (strings, lists, records, variants, `result`, `resource`) across the standardized canonical ABI.

What makes it the production-grade answer for the "run untrusted or third-party code in-process" problem:

- **Trap, don't corrupt.** A guest fault traps; the host survives and can report it. Compare to FFI, where a fault is a process death.
- **Capability security via WASI.** A component has no ambient authority — no filesystem, no sockets — until the host explicitly grants a preopened directory, a clock, a socket. "Run this plugin" becomes a bounded, auditable grant.
- **`resource` handles** are the principled successor to the opaque `void*`: they carry ownership across the boundary so the toolchain enforces "freed exactly once."
- **Portability.** The same component runs on any conforming runtime, on any host architecture.

The professional caveats: the ecosystem is young; toolchain support for advanced WIT features varies by source language; lift/lower has a real (if small) cost on large payloads; and version skew between a component and the interface it was built against is a live concern — pin and verify.

### RPC/IPC with an IDL

When the requirement is fault isolation, independent deployment, independent scaling, or a cross-machine boundary, the answer is RPC/IPC with an IDL. You describe the service contract in an IDL and a code generator produces stubs in every language. The major families and their trade-offs:

- **gRPC / Protobuf.** The default for service-to-service RPC. Compact binary wire format, HTTP/2 transport, streaming, strong cross-language tooling, and — critically — a disciplined schema-evolution story built on field numbers. The cost is a parse step (decode into language objects) on every message.
- **Apache Thrift.** Predates gRPC's ubiquity; similar IDL-plus-codegen model with a pluggable transport/protocol stack. Strong in polyglot shops with a Thrift legacy.
- **Cap'n Proto.** "Infinitely faster" by design: the wire format *is* the in-memory format, so there is no parse step — you read fields directly from the buffer (zero-copy). Trades a less compact wire and a more rigid layout for eliminating deserialization cost. Excellent when decode latency dominates.
- **FlatBuffers.** Also zero-copy / no-parse; you access data through generated accessors directly over the buffer. Popular in games and mobile where you want to mmap a buffer and read a few fields without materializing the whole structure.

The selection logic at scale: **choose Protobuf/gRPC when you want the richest ecosystem and disciplined evolution; choose Cap'n Proto or FlatBuffers when deserialization cost is your bottleneck and you can accept a more rigid format.** The defining property of all of them versus FFI is that the boundary is *serialized and isolated* — slower per call, but a true fault and evolution boundary.

### Schema-Evolution Discipline

An IDL boundary's whole value is that the two sides can evolve independently. That only holds if you obey evolution rules; violate them and you get silent data corruption or hard failures across a version boundary. The Protobuf discipline (and its analogs in Thrift) is the canonical example:

- **Field numbers are the contract, not field names.** Never reuse a retired field number; never renumber a live field. The wire carries tags, not names.
- **Adding a field is safe** if it is optional / has a sensible default. Old readers ignore unknown tags; new readers see the default when old writers omit it.
- **Removing a field:** stop writing it, but *reserve its number and name* so no future field accidentally reuses the tag.
- **Never change a field's type incompatibly.** `int32`→`int64` is sometimes safe; `string`→`int32` is never.
- **Required is forever a mistake.** Proto3 dropped `required` precisely because a required field can never be removed without breaking every old reader. Treat everything as optional.
- **Plan for unknown fields to round-trip.** A proxy that decodes and re-encodes should preserve unknown fields so it does not strip data added by a newer producer.

The professional artifact is a **compatibility test in CI**: serialize with schema version N, deserialize with N−1 and N+1, assert no loss. Schema evolution that is only checked by code review will eventually break in production.

### Choosing RPC Over FFI for Fault Isolation

The most important interop decision a professional makes is often choosing the *slower* mechanism on purpose. When a component is untrusted, crash-prone, written by another team, or must be deployed and scaled independently, **RPC's isolation is worth its latency.** The reasoning:

- **Crash containment.** A native library that segfaults under malformed input will kill your host process via FFI. Behind an RPC boundary it kills only its own process; your service returns a clean error and the supervisor restarts the worker. This alone justifies RPC for any code you do not fully trust.
- **Independent deployment and rollback.** FFI couples the foreign code's release to yours — you rebuild and redeploy your whole binary to update it. RPC lets each side ship and roll back on its own cadence.
- **Independent scaling.** A CPU-heavy component behind RPC can scale horizontally; the same code FFI'd into your process scales only with your process.
- **Language and runtime freedom.** The remote side can be any language, any runtime version, without ABI negotiation.
- **Blast-radius control.** A memory leak, a resource exhaustion, or a runaway loop in the remote component is contained; it does not consume your host's heap.

The cost you pay — serialization, a network/IPC hop, operational complexity — is real and must be measured. But when the dominant requirement is "this failure must not take down that," RPC is not the slow compromise; it is the correct architecture, and FFI would be the bug.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **In-process FFI** | Sharing one apartment with a stranger: instant, intimate, and if they start a fire you both burn. |
| **`extern "C"` shim** | An embassy translator who only passes simple, agreed phrases — no idioms, no exceptions — across the border. |
| **Opaque handle** | A coat-check ticket: it identifies your coat without revealing or exposing the coat itself. |
| **COM refcount** | A shared-cabin booking ledger: every guest who checks in must check out, or the cabin is never released. |
| **Polyglot VM** | A bilingual household: everyone speaks the same house language, but they all live in one house that one fire can burn down. |
| **Wasm component** | A soundproof recording booth with a standard intercom: isolated, but rich messages pass through the agreed panel. |
| **RPC with an IDL** | Two companies trading via signed purchase orders: slower than a handshake, but each can fail, audit, and evolve on its own. |
| **Schema evolution** | Tax forms that add new boxes each year while keeping the old box numbers stable so old software still files. |

---

## Mental Models

**The coupling dial.** Picture a single fader from "shared everything" to "shared nothing." FFI is full left (shared memory, shared crash, shared deploy); RPC is full right (shared nothing but a contract). Polyglot VMs and Wasm components sit in between. You are not choosing a technology; you are setting how tightly two pieces of software are bound together. Set the dial by the dominant constraint, not by habit.

**Speed and isolation are a budget you cannot both max.** Every step toward isolation costs latency; every step toward speed costs a shared failure mode. The professional move is to spend that budget per boundary — a hot inner loop full-left, a third-party plugin in the Wasm middle, a cross-team edge full-right — rather than forcing one setting on the whole system.

**The contract is the component.** From COM to WIT to Protobuf, cross-language interop always reduces to a stable contract of identity, lifetime, and operations. The implementation language is irrelevant; the contract is the thing you version, review, and defend. When you design any boundary, you are really designing a contract that must outlive both sides' current versions.

**A boundary you cannot reverse cheaply must be chosen carefully.** FFI-to-RPC migrations are quarters-long. Treat the initial interop choice with the gravity of a schema choice in a database: easy to set, expensive to change.

---

## Code Examples

### Flattening a C++ class to a C ABI shim

```cpp
// parser.hpp — the C++ API we cannot FFI into directly.
#include <string>
class Parser {
public:
    explicit Parser(const std::string& grammar);  // may throw
    int parse(const std::string& input);          // may throw
    ~Parser();
};
```

```cpp
// parser_c.cpp — the extern "C" shim: opaque handle, no C++ types, no exceptions.
#include "parser.hpp"

extern "C" {

typedef struct Parser Parser;  // opaque to the C side

// Construction: returns NULL on failure rather than throwing across the boundary.
Parser* parser_create(const char* grammar) {
    try {
        return reinterpret_cast<Parser*>(new ::Parser(grammar));
    } catch (...) {
        return nullptr;  // exceptions converted to a NULL/error signal
    }
}

// Operation: rich result reduced to an out-param + error code.
int parser_parse(Parser* p, const char* input, int* out_result) {
    if (!p || !input || !out_result) return -1;   // defensive
    try {
        *out_result = reinterpret_cast<::Parser*>(p)->parse(input);
        return 0;                                  // success
    } catch (...) {
        return -2;                                 // failure, no unwinding past C
    }
}

// Destruction: the side that allocated frees, with the matching allocator.
void parser_destroy(Parser* p) {
    delete reinterpret_cast<::Parser*>(p);
}

} // extern "C"
```

The four rules in one file: opaque handle, no C++ types crossing, exceptions caught at the boundary, allocation and deallocation owned by the same side. Any FFI caller — Python `ctypes`, Go `cgo`, C# P/Invoke — binds these flat functions.

### A Protobuf service and a compatible schema evolution

```protobuf
// payment.proto — version 1
syntax = "proto3";
package payment.v1;

message Charge {
  string id        = 1;
  int64  amount    = 2;   // minor units
  string currency  = 3;
}

service Payments {
  rpc CreateCharge(Charge) returns (Charge);
}
```

Evolving it compatibly — add fields, never reuse numbers, never break old readers:

```protobuf
// payment.proto — version 2, wire-compatible with v1
syntax = "proto3";
package payment.v1;

message Charge {
  string id          = 1;
  int64  amount      = 2;
  string currency    = 3;
  string description = 4;   // NEW: optional, old readers ignore tag 4
  string customer_id = 5;   // NEW: old writers omit it, new readers see ""

  reserved 6;               // a field once existed at 6; never reuse the tag
  reserved "legacy_token";  // and never reuse the name
}
```

An old client sending a v1 `Charge` is read correctly by a v2 server (missing fields default). A new client sending fields 4 and 5 is read by a v1 server, which ignores the unknown tags. That is the contract holding across a version boundary.

### A WIT interface and the components that meet it

```wit
// filter.wit — the language-neutral contract for an in-process plugin.
package plugins:filter;

interface transform {
    // result<T, E> gives a typed error channel instead of a process crash.
    apply: func(input: list<u8>) -> result<list<u8>, string>;
}

world plugin {
    export transform;
}
```

A guest (Rust, Go, C#, …) compiles to a component implementing `transform`; the host loads it sandboxed, grants only the capabilities it needs, and calls `apply`. A `panic` in the guest traps and surfaces as a host-side error — the host process survives, which is exactly what an in-process FFI plugin could never promise.

### A COM interface and RAII refcount discipline

```cpp
// The interface contract: IUnknown + one method, fixed vtable layout.
struct IFilter : IUnknown {
    virtual HRESULT __stdcall Apply(const BYTE* in, ULONG n, BYTE** out, ULONG* m) = 0;
};

// WRONG: manual refcounting — every early return is a leak waiting to happen.
void use_filter_raw(IFilter* f) {
    f->AddRef();
    // ... if any branch returns here without Release(), the object leaks ...
    f->Release();
}

// RIGHT: RAII wrapper pairs AddRef/Release with scope; no manual counting.
void use_filter_raii(IFilter* raw) {
    ComPtr<IFilter> f(raw);   // AddRef in ctor
    BYTE* out = nullptr; ULONG m = 0;
    f->Apply(/*...*/ &out, &m);
    // Release() runs in ComPtr's destructor on every exit path, including throws.
}
```

The lesson the senior tier stated and the professional tier enforces in review: **raw `AddRef`/`Release` is a smell; lifetime belongs to a scoped wrapper.**

---

## Pros & Cons

| Mechanism | Pros | Cons |
|-----------|------|------|
| **In-process FFI** | Fastest possible call; zero-copy; full native speed | Shared crash domain; shared memory (security); ABI fragility; manual ownership; you own the binding layer |
| **Polyglot VM** | Near-zero interop cost; shared types and GC; mature tooling | No fault isolation (one process); GC-interop edges; lock-in; same-runtime languages only |
| **Wasm component** | Near-native speed *and* sandbox; portable; stable WIT ABI; capability security; many source languages | Young ecosystem; uneven toolchain support; lift/lower cost on large payloads; version skew |
| **RPC / IPC (IDL)** | True fault isolation; independent deploy/scale; any language; disciplined evolution | Serialization + network/IPC latency on every call; operational complexity; schema-discipline burden |

---

## Use Cases

- **A hot numeric kernel called millions of times from a managed app** → in-process FFI through a flat C shim; the throughput justifies the coupling, and the code is trusted.
- **A monolith where Kotlin, Scala, and Java already coexist** → shared-runtime interop; adding any other mechanism is self-inflicted complexity.
- **A SaaS platform running customer-supplied plugins** → Wasm components with WASI capabilities; near-native speed with a real sandbox and per-plugin capability grants.
- **A media pipeline calling a fragile, crash-prone third-party codec** → RPC/IPC; isolate the crash so a malformed file kills a worker, not the service.
- **Two teams with separate SLAs, on-call rotations, and release trains** → RPC; the boundary is organizational as much as technical.
- **Driving legacy Windows components from a modern app** → COM/.NET interop with RAII refcount wrappers.
- **A latency-critical service where Protobuf decode is the bottleneck** → Cap'n Proto or FlatBuffers to eliminate the parse step.

---

## Coding Patterns

- **Tiny boundary surface.** Whatever the mechanism, minimize the number of functions/types crossing. A small boundary is a small bug surface and a small thing to evolve.
- **Shim-first for C++.** Always interpose an `extern "C"` layer; never expose C++ types or let exceptions escape.
- **Opaque handles, never raw layouts.** Pass `Parser*`, not a struct the other side parses. The other side must not depend on your layout.
- **RAII for every foreign lifetime.** COM `ComPtr`, FFI handle wrappers, WIT `resource` — bind lifetime to scope so no path leaks.
- **IDL-first for RPC and Wasm.** Write the `.proto` / WIT before the implementation; the contract is the durable artifact.
- **Reserve, never reuse.** Retired field numbers and names are reserved forever.
- **Capability-minimal.** Grant a Wasm component exactly the directory/socket/clock it needs, nothing more.
- **Compatibility tests in CI.** Round-trip serialize/deserialize across adjacent schema versions as a gate.

---

## Best Practices

- **Choose the mechanism by the dominant constraint** — latency, isolation, portability, team boundaries — not by what the team used last.
- **Treat the interop choice as hard to reverse** and design it with that gravity.
- **Use shared-runtime interop wherever languages already share a runtime.** It is strictly the cheapest correct option there.
- **Pick RPC when fault isolation, independent deploy, or independent scaling is the requirement** — and measure the latency cost so the trade is explicit, not assumed.
- **Reach for Wasm components when you need speed *and* a sandbox** for untrusted or third-party in-process code.
- **Keep the boundary narrow, flat, and richly documented** with ownership and threading contracts.
- **Make schema evolution a tested invariant**, not a code-review hope.
- **Manage every foreign lifetime with RAII**; raw refcount or raw free calls are a review smell.
- **Document the crash domain** of every boundary explicitly, so on-call knows whether a foreign fault is contained.

---

## Edge Cases & Pitfalls

- **Defaulting to the familiar mechanism.** The microservices team RPC-ing an in-process call; the C++ team FFI-ing a security perimeter. The framework exists to break this reflex.
- **Assuming polyglot VMs give isolation.** They share a process; one fault kills every language. Logical interop ≠ fault isolation.
- **Exceptions escaping the C boundary.** A C++ exception unwinding through a C frame is undefined behavior. Catch all at the shim.
- **Allocator mismatch.** Freeing with the caller's `free` what the library allocated with `new` (or a different CRT). Always provide the matching free function.
- **COM refcount leaks and over-releases.** A missing `Release` leaks forever; an extra one frees early and crashes other holders. `QueryInterface` results are owned references.
- **Reusing a retired Protobuf field number.** Silent data corruption across versions. Reserve forever.
- **`required` fields in an IDL.** They can never be removed without breaking old readers. Treat everything as optional.
- **Stripping unknown fields in a proxy.** A decode/re-encode that drops unknown tags silently deletes data from newer producers.
- **Ignoring lift/lower cost.** The Component Model copies large records and lists across the canonical ABI; on ultra-hot paths, measure.
- **Over-granting WASI capabilities.** Handing a component the filesystem root "to be safe" defeats the sandbox.
- **ABI skew from a toolchain bump.** A compiler or flag change silently changes struct layout or calling convention; pin and test the boundary.

---

## War Stories

**The plugin that took down the fleet.** A platform team shipped customer plugins as native shared libraries loaded via FFI for speed. It worked until a customer's plugin had a buffer overrun on a specific input; the overrun corrupted the host's heap and crashed not one request but the whole worker process, repeatedly, across the fleet as the bad input replayed. The post-mortem conclusion was not "fix the plugin" — it was "the architecture was wrong." They migrated the plugin surface to Wasm components: same near-native speed, but a guest fault now traps and returns an error instead of corrupting the host. The lesson: *for untrusted in-process code, isolation is a requirement, not an optimization, and FFI cannot provide it.*

**The COM leak that took three weeks to find.** A long-running Windows service slowly grew its memory over weeks until it OOM-ed. The cause was a single code path that called `QueryInterface` to probe for an optional interface and, on the rare branch where the interface was present, forgot the matching `Release`. Because the branch was rare, the leak was slow; because it was slow, it survived testing. The fix was mechanical — wrap the pointer in `ComPtr` — but the search was painful. The lesson: *manual refcounting hides leaks in rare branches; RAII the lifetime so no branch can forget.*

**The field number that corrupted payments.** A team removed a deprecated field from a Protobuf message and, in the same change, added a new field — reusing the now-free field number. Old producers still on the prior schema were writing the old field's bytes under that number; new consumers read them as the new field. The result was garbage amounts flowing through a payment path before a compatibility test (added afterward) would have caught it in seconds. The lesson: *field numbers are the contract; reserve retired numbers forever and gate schema changes with a round-trip compatibility test in CI.*

**The gRPC inner loop.** A trading-adjacent team built a pricing engine and, by reflex, put gRPC between the matching core and the risk module — both in the same datacenter, both owned by the same team, with a sub-millisecond latency budget. Every price update paid a serialize-hop-deserialize tax that consumed most of the budget. The boundary needed no fault isolation (one team, one deploy, one crash domain was acceptable) and no language barrier. Collapsing it to an in-process call recovered the latency. The lesson: *RPC is the right tool for isolation and independent lifecycles; when you need neither, its latency is pure waste.*

---

## Summary

At the professional tier, cross-language interop is a coupling decision you make deliberately and defend over years. The four mechanisms sit on one axis: in-process FFI (fastest, most dangerous, shared crash domain), polyglot VMs (near-free interop within a runtime, but no isolation), Wasm components (the emerging answer — near-native speed *and* a sandbox *and* portability via a stable WIT ABI), and RPC/IPC with an IDL (slowest, most decoupled, the only true fault and evolution boundary). You choose among them by the dominant constraint — latency, isolation, portability, team boundaries — and you refuse to default to the familiar.

Each mechanism then demands its own discipline. FFI demands a tiny, flat `extern "C"` shim with opaque handles, caught exceptions, and explicit ownership — generated by SWIG at scale, but never understood less for being generated. COM demands RAII refcount wrappers because manual `AddRef`/`Release` is a leak factory. IDL boundaries demand schema-evolution rules — stable field numbers, optional everything, reserved retirements — enforced by a compatibility test in CI, not a code-review hope. And the single highest-leverage judgment is knowing when to choose the slower mechanism on purpose: when one component's failure must not take down another, RPC's isolation is worth its latency, and FFI would be the bug.

The professional's superpower is not making the fastest call across a language boundary. It is drawing the boundary in the right place — tight where speed and trust allow, isolated where failure and team independence demand — so the system stays fast where it can and survives where it must.
