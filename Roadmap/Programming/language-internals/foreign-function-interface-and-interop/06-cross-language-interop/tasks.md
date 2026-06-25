# Cross-Language Interop — Hands-On Tasks

> **Topic:** [Cross-Language Interop](README.md)
> **Focus:** Practice the interop spectrum end to end — flatten a C++ class to a C ABI shim, define and compatibly evolve a Protobuf/gRPC service, build a Wasm component behind a WIT interface, and reason FFI vs RPC against a fault-isolation requirement.

---

## Introduction

These tasks move from warm-up exercises that build vocabulary to a capstone that forces a real interop decision. Each task states a goal, a self-check so you know when you are done, a hint if you stall, and a sparse solution sketch — enough to confirm your direction without doing the work for you. The point is not to memorize one toolchain; it is to develop the judgment to pick the right boundary and the discipline to implement it correctly. Do the FFI tasks even if your day job is RPC, and vice versa — the whole value of this topic is fluency across the spectrum.

Work in the order given; later tasks assume the vocabulary the earlier ones build. Where a task names a specific toolchain (cgo, `wit-bindgen`, `protoc`), feel free to substitute an equivalent in your stack — the concept transfers.

---

## Warm-Up

### Task W1 — Place the mechanisms on the axis

**Goal:** Without notes, write the four interop mechanisms — in-process FFI, polyglot VM, Wasm component, RPC/IPC — in order from fastest/most-coupled to slowest/most-decoupled, and annotate each with its crash domain and one defining trade-off.

**Self-check:** Your ordering matches FFI → polyglot VM → Wasm component → RPC. You correctly noted that FFI and polyglot VMs share a crash domain, RPC does not, and a Wasm component traps rather than corrupting the host.

**Hint:** The axis is *coupling* — how much two pieces share (memory, crash, deploy).

<details><summary>Solution sketch</summary>

FFI: ns-scale call, shared memory, **one crash domain**, ABI-fragile. Polyglot VM: shared heap/GC, interop nearly free, **one crash domain** (no isolation). Wasm component: sandboxed, portable, stable WIT ABI, **isolated** (traps). RPC: serialized, **isolated**, independently deployable, slowest.

</details>

### Task W2 — Identify why C++ resists direct FFI

**Goal:** List the C++ features that make a class impossible to call directly across a C FFI boundary, and name the standard remedy for each.

**Self-check:** You named at least name mangling, ABI instability across compilers, exceptions that cannot cross a C frame, templates (no link-time existence), and the object model (vtables). The remedy in every case is the `extern "C"` shim with opaque handles.

**Hint:** Think about what the *symbol table* and the *calling convention* know about a C++ class — almost nothing portable.

<details><summary>Solution sketch</summary>

Name mangling → C linkage. Unstable ABI → flatten to C scalars/pointers. Exceptions → catch at the shim, return error codes. Templates → instantiate concretely behind the shim. Object model → opaque pointer + free functions.

</details>

### Task W3 — Spot the COM leak

**Goal:** Given a function that calls `QueryInterface`, uses the returned pointer, and returns early on one branch without `Release`, identify whether it leaks or crashes and write the one-line fix.

**Self-check:** You said **leak** (the `QueryInterface` result is a new owned reference whose `Release` is skipped), and your fix wraps the pointer in a RAII smart pointer (`ComPtr` / `CComPtr`).

<details><summary>Solution sketch</summary>

`QueryInterface` performs an implicit `AddRef`; skipping `Release` means the count never reaches zero → leak. Fix: `ComPtr<IThing> p; hr = obj->QueryInterface(IID_IThing, &p);` — `Release` now runs in the destructor on every path.

</details>

---

## Core

### Task C1 — Flatten a C++ class to a C ABI shim

**Goal:** Given a C++ class with a throwing constructor and a method, write the `extern "C"` shim that exposes it over a C ABI: opaque handle, no C++ types crossing, exceptions caught, and matched allocation/deallocation. Then call it from any FFI host (Python `ctypes`, Go `cgo`, C# P/Invoke).

**Self-check:** Your shim has `create` returning `NULL` on failure (not throwing), an operation taking the opaque handle plus an out-param and returning an error code, and a `destroy`. No `std::string` / `std::vector` / reference appears in the C signatures. Every shim function body is wrapped in `try { ... } catch (...) { ... }`. Your host program creates, calls, and destroys without crashing.

**Hint:** Strings cross as `const char*` plus a length; results cross as an out-pointer plus an int return code. The side that `new`s must provide the function that `delete`s.

<details><summary>Solution sketch</summary>

```cpp
extern "C" {
typedef struct Engine Engine;  // opaque
Engine* engine_create(const char* cfg) {
    try { return reinterpret_cast<Engine*>(new ::Engine(cfg)); }
    catch (...) { return nullptr; }
}
int engine_run(Engine* e, const char* in, int* out) {
    if (!e || !in || !out) return -1;
    try { *out = reinterpret_cast<::Engine*>(e)->run(in); return 0; }
    catch (...) { return -2; }
}
void engine_destroy(Engine* e) { delete reinterpret_cast<::Engine*>(e); }
}
```
Host (Python ctypes): load the `.so`, set `argtypes`/`restype`, call `engine_create`, then `engine_run` with a `c_int` out-param, then `engine_destroy`.

</details>

### Task C2 — Return a heap buffer safely across the shim

**Goal:** Extend C1 so an operation returns a variable-length byte buffer. Design the ownership so the caller can free it without an allocator mismatch.

**Self-check:** Your shim returns the buffer pointer and its length (out-param), and you provide an `engine_buffer_free(void*)` that the caller must call. You did **not** assume the caller's `free` matches your allocator.

**Hint:** "One owner, one allocator" — whatever allocates must provide the matching free.

<details><summary>Solution sketch</summary>

```cpp
int engine_encode(Engine* e, const char* in, unsigned char** out, int* n) {
    try { auto v = reinterpret_cast<::Engine*>(e)->encode(in);
          *n = (int)v.size();
          *out = (unsigned char*)std::malloc(v.size());   // host frees via our free fn
          std::memcpy(*out, v.data(), v.size()); return 0; }
    catch (...) { return -2; }
}
void engine_buffer_free(void* p) { std::free(p); }   // matching allocator
```

</details>

### Task C3 — Define a Protobuf/gRPC service

**Goal:** Write a `.proto` for a small service (e.g. a `Catalog` with `GetItem` and `ListItems`), generate stubs in two languages, and stand up a trivial server and client that exchange one message.

**Self-check:** Your `.proto` uses `proto3`, assigns explicit field numbers, defines a `service` with RPC methods, and you generated stubs without errors. A client in one language calls a server in another and gets the expected response.

**Hint:** Field numbers are the contract; pick them deliberately and leave gaps if you anticipate growth.

<details><summary>Solution sketch</summary>

```protobuf
syntax = "proto3";
package catalog.v1;
message Item   { string id = 1; string name = 2; int64 price = 3; }
message GetReq { string id = 1; }
service Catalog { rpc GetItem(GetReq) returns (Item); }
```
Generate with `protoc` (or `buf`), implement the server in language A, call from language B.

</details>

### Task C4 — Evolve the schema compatibly

**Goal:** Add two fields to the `Item` message and retire one, keeping full wire compatibility. Then prove it: serialize with the old schema, deserialize with the new, and vice versa, asserting no data loss.

**Self-check:** You added new fields with fresh numbers (never reusing one), `reserved` the retired field's number *and* name, and your round-trip test passes in both directions. An old client talking to a new server, and a new client talking to an old server, both work.

**Hint:** Old readers ignore unknown tags; new readers see defaults for missing fields. Never reuse or renumber.

<details><summary>Solution sketch</summary>

```protobuf
message Item {
  string id          = 1;
  string name        = 2;
  int64  price       = 3;
  string currency    = 4;   // NEW
  string category    = 5;   // NEW
  reserved 6;               // a field once lived here
  reserved "sku_legacy";    // never reuse the name either
}
```
Test: `new.parse(old.serialize())` and `old.parse(new.serialize())` both succeed; assert the shared fields survive and unknown fields round-trip.

</details>

### Task C5 — Build a Wasm component with a WIT interface

**Goal:** Define a WIT interface with a function that takes and returns rich types (e.g. `apply: func(input: list<u8>) -> result<list<u8>, string>`), implement it as a component in a language of your choice, and call it from a host runtime.

**Self-check:** Your WIT compiles, your component exports the interface, and the host loads and calls it. A failure path returns the `result` error variant rather than crashing the host. The component has no filesystem/network access you did not explicitly grant.

**Hint:** Use a binding generator (`wit-bindgen`) to produce the guest glue; the `result<T, E>` type is your typed error channel instead of a trap.

<details><summary>Solution sketch</summary>

```wit
package demo:filter;
interface transform { apply: func(input: list<u8>) -> result<list<u8>, string>; }
world plugin { export transform; }
```
Guest (Rust sketch): `impl Guest for Component { fn apply(input: Vec<u8>) -> Result<Vec<u8>, String> { ... } }`, then `export!(Component)`. Host: instantiate the component, grant capabilities explicitly, call `apply`, handle both `Ok` and `Err`.

</details>

---

## Advanced

### Task A1 — Make the guest fault and observe isolation

**Goal:** Deliberately panic/trap inside the Wasm component from C5 on a specific input, and confirm the host survives and reports an error rather than dying.

**Self-check:** When the guest traps, your host catches it as an error and keeps running. Contrast this in writing with what would happen if the same logic were FFI'd into the host (process death).

**Hint:** A trap propagates to the host as a runtime error on the call, not as a host-process crash. That is the property FFI cannot give.

<details><summary>Solution sketch</summary>

Force an out-of-bounds access or explicit panic in the guest for a sentinel input; the runtime returns a trap error from the call; the host logs it and continues. The written contrast: FFI would segfault the whole process; the Wasm sandbox contains it.

</details>

### Task A2 — Wrap a COM-style lifetime with RAII

**Goal:** Given a vtable-based interface with `AddRef`/`Release` (real COM on Windows, or a hand-rolled IUnknown-shaped struct elsewhere), write a smart-pointer wrapper that pairs `AddRef`/`Release` with scope, then show that an early return or exception cannot leak or over-release.

**Self-check:** Your wrapper `AddRef`s in the constructor (or on assignment) and `Release`s in the destructor. A function that returns early on a branch, or throws, still releases exactly once. Raw `AddRef`/`Release` calls no longer appear in your usage code.

**Hint:** This is RAII applied to a manual refcount — the destructor is your guarantee.

<details><summary>Solution sketch</summary>

```cpp
template <class T> struct Com {
    T* p{};
    Com(T* raw) : p(raw) { if (p) p->AddRef(); }
    ~Com() { if (p) p->Release(); }
    T* operator->() { return p; }
    // (also handle copy/move to keep the count correct)
};
```
Every scope exit — normal, early return, or exception — runs the destructor exactly once.

</details>

### Task A3 — Measure the cost difference

**Goal:** For one operation, implement it three ways — an in-process call (or FFI), a Wasm-component call, and a gRPC call to a local server — and measure per-call latency. Tabulate the results with the crash domain of each.

**Self-check:** Your numbers show the expected ordering (in-process/FFI fastest, Wasm in the middle, gRPC slowest), and your table pairs each latency with its isolation property so the trade-off is explicit, not just the speed.

**Hint:** The point is not the absolute numbers but the *shape*: each step toward isolation costs latency, and you are buying something real with it.

<details><summary>Solution sketch</summary>

| Mechanism | ~latency/call | Crash domain | Buys you |
|-----------|---------------|--------------|----------|
| FFI / in-process | nanoseconds | shared | raw speed |
| Wasm component | microseconds | isolated (traps) | speed + sandbox |
| gRPC (local) | tens of µs–ms | isolated | independent deploy/scale |

</details>

---

## Capstone

### Task CAP — Choose and justify the boundary for a real requirement

**Goal:** You are handed a component to integrate: a fast but **crash-prone, third-party** native codec that must process untrusted user uploads in the request path. The non-negotiable requirement is that **a codec crash must never take down the service**, and the latency budget is moderate (tens of milliseconds is acceptable). Decide the interop mechanism, justify it against the alternatives, and sketch the implementation and its schema/interface.

**Self-check:** You ruled out **raw FFI** explicitly because a crash on malformed input would kill the host process (shared crash domain) — disqualifying given the requirement. You chose either **RPC/IPC** (codec in a separate process; a crash kills only a worker; supervisor restarts it) or a **Wasm component** (sandboxed, trap-on-fault, if the codec can be recompiled to Wasm), and you justified the pick by the dominant constraint (fault isolation) plus the latency headroom. You defined the contract (a `.proto` for RPC, or a WIT interface for Wasm) and described how a codec failure surfaces as a clean error.

**Hint:** Walk the decision framework: languages don't share a runtime (skip polyglot VM); the dominant constraint is fault isolation with moderate latency — that is exactly where RPC (or a Wasm sandbox) wins and FFI is the bug.

<details><summary>Solution sketch</summary>

**Decision:** RPC/IPC is the safe default; Wasm component is the lower-latency alternative if the codec can be recompiled.

- **Why not FFI:** the codec shares the host's address space; a segfault on a malformed upload crashes the whole process, repeatedly, as bad input replays — the exact failure the requirement forbids.
- **RPC path:** run the codec in a worker process behind a small `.proto` (`Decode(bytes) -> result`); a crash kills only the worker, the request returns a clean error, the supervisor restarts the worker. Cost: serialize + IPC hop, within the moderate budget. Apply schema-evolution discipline to the `.proto`.
- **Wasm path (if recompilable):** compile the codec to a component behind a WIT `decode: func(list<u8>) -> result<list<u8>, string>`, run it sandboxed in-process with no granted capabilities beyond the input; a fault traps and returns the `Err` variant; near-native speed with isolation.
- **Conclusion:** the dominant constraint is fault isolation, so the *slower-but-isolated* mechanism is correct; raw FFI would be an architectural bug regardless of its speed advantage.

</details>

---

## Wrap-Up

If you completed these, you can now flatten a C++ API to a clean C ABI without leaking exceptions or memory, define and *evolve* an IDL boundary without breaking the wire, build a sandboxed Wasm component behind a WIT contract, and — most importantly — choose FFI versus RPC versus Wasm by the dominant constraint rather than by habit. The capstone is the skill that matters most at the senior and professional tiers: drawing the boundary in the right place so the system stays fast where it can and survives where it must.
