# Interop & Polyglot Architectures — Middle

> **What?** The concrete *mechanisms* by which languages interoperate — network boundaries (REST, gRPC, message queues), in-process FFI (cgo, ctypes, JNI), and the shared schemas (protobuf, Avro, JSON Schema) that turn an informal handshake into an enforceable contract — together with the tradeoffs that decide which one you reach for.
> **How?** By recognizing that interop is a spectrum from *loose and slow* (a message on a queue) to *tight and fast* (a function call across a language boundary in the same process), and that you move along that spectrum by trading coupling, safety, and operational simplicity for latency and throughput. The contract — the schema — is what keeps either end of that spectrum from rotting.

---

## 1. The interop spectrum

Every interop choice sits somewhere on one axis: **how tightly are the two languages coupled, and how much does crossing the boundary cost?**

```
LOOSE / SAFE / SLOW                                    TIGHT / SHARP / FAST
─────────────────────────────────────────────────────────────────────────►
 Message queue   REST/JSON   gRPC/protobuf   Shared memory / sockets   FFI (same process)
 (async, fire    (sync,      (sync, binary,  (custom, fast,            (a function call;
  & forget)       universal)  typed, fast)    fiddly)                   no serialization)
```

As you move right:
- **Latency drops** (no network hop, less serialization).
- **Coupling rises** (the two sides must agree on more, and deploy more carefully).
- **Blast radius grows** (a crash on one side can take down the other).
- **Operational complexity shifts** (from "two services to deploy" to "one binary, two memory models").

There is no universally correct point. The senior skill is matching the *point on the spectrum* to the *relationship between the two components*. Most of this file is about the options and where each one belongs.

---

## 2. Network boundaries: the loose-coupling default

Keeping each language in its own process and talking over the network is the default for a reason: the OS process boundary gives you **fault isolation** (one crash doesn't kill the other), **independent deployment**, and **language independence** for free. Three flavors dominate.

### REST + JSON — the universal handshake

```
POST /predict   { "features": [0.4, 1.2], "model": "fraud-v3" }
→  200 OK       { "score": 0.91, "label": "fraud" }
```

- **Pros:** every language can do it; human-readable; trivially debuggable with `curl`; works through any proxy.
- **Cons:** JSON is verbose and slow to parse; no enforced schema (a typo in a field name fails silently at runtime); text encoding of numbers loses precision and wastes bytes.
- **Use when:** the boundary is external/public, traffic is modest, or you value debuggability over raw speed.

### gRPC + protobuf — typed, binary, fast

gRPC uses **Protocol Buffers** as both the schema language and the wire format. You define the contract once, in a `.proto` file, and generate type-safe client and server stubs in *every* language:

```protobuf
syntax = "proto3";
package fraud.v1;

message PredictRequest {
  repeated double features = 1;
  string model = 2;
}
message PredictResponse {
  double score = 1;
  string label = 2;
}
service FraudScorer {
  rpc Predict(PredictRequest) returns (PredictResponse);
}
```

Run `protoc` and you get a Go client, a Python server, a TypeScript client — all from the same file. The wire format is compact binary (often 3–10× smaller than the equivalent JSON) and parsing is far cheaper.

- **Pros:** strong typing across languages; compact, fast binary encoding; streaming; the `.proto` *is* the contract and the docs.
- **Cons:** not human-readable on the wire; needs a code-gen build step; browser support requires gRPC-Web + a proxy; harder to poke at with `curl`.
- **Use when:** internal service-to-service traffic, latency or throughput matters, and you want the contract enforced by types.

### Message queues — async decoupling

Sometimes the two components shouldn't even wait for each other. The Go API drops a message on **Kafka** / **RabbitMQ** / **SQS**, and the Python worker consumes it whenever it's ready:

```
Go API  ──► [ Kafka topic: "uploads" ] ──►  Python OCR worker
            (producer)                       (consumer, at its own pace)
```

- **Pros:** maximal decoupling — producer and consumer don't need to be up at the same time; natural buffering for bursty load; the consumer language is invisible to the producer.
- **Cons:** no synchronous answer (you get a result later, or never); harder to reason about ordering and exactly-once delivery; the message schema still has to be agreed (see §4).
- **Use when:** the work is asynchronous by nature (image processing, email, ETL), or you need to absorb load spikes.

| | REST/JSON | gRPC/protobuf | Message queue |
|---|---|---|---|
| Coupling | Loose | Loose | Loosest |
| Latency overhead | Medium | Low | N/A (async) |
| Schema enforced? | No (unless you add it) | Yes | Depends |
| Debuggability | Excellent | Poor (binary) | Medium |
| Best for | Public/edge APIs | Internal hot paths | Async pipelines |

---

## 3. In-process FFI: tight coupling, sharp edges

Sometimes the network is too slow or too clumsy. If your Python code needs to call a number-crunching routine *millions of times*, a network hop per call (~0.1–1 ms each) is a non-starter. The answer is a **Foreign Function Interface (FFI)**: calling code written in another language *inside the same process*, with no serialization and no network hop — just a function call.

This is how NumPy is fast: the Python you write is a thin shell over C and Fortran routines called via FFI. The names you'll meet:

| Mechanism | Calls *into* | From |
|---|---|---|
| **ctypes / cffi** | C shared libraries (`.so`/`.dll`) | Python |
| **cgo** | C | Go |
| **JNI** (Java Native Interface) | C/C++ | Java/JVM |
| **PyO3 / rust-cpython** | Rust | Python (and back) |
| **N-API / node-gyp** | C/C++ | Node.js |
| **`extern "C"`** | exposes Rust/C++ *to* others | Rust, C++ |

A minimal `ctypes` example — Python calling a C function:

```python
import ctypes
lib = ctypes.CDLL("./libfast.so")
lib.add.argtypes = [ctypes.c_int, ctypes.c_int]
lib.add.restype  = ctypes.c_int
result = lib.add(2, 3)   # a real C function call — no network, no JSON
```

The payoff is enormous: **near-zero call overhead** and the ability to use a fast/systems language for a hot inner loop while keeping a productive language for everything else. But FFI has sharp edges that the network boundary doesn't:

**1. Memory safety crosses the boundary.** A bug in the C code (a buffer overrun, a use-after-free) doesn't throw a clean exception — it segfaults the *entire* process, taking your Python down with it. The garbage collector on one side knows nothing about memory the other side allocated; ownership of every pointer must be agreed by hand. This is the single biggest reason FFI is dangerous: you lose the safety guarantees of *both* languages at the seam.

**2. The ABI is fragile.** FFI works at the level of the **Application Binary Interface** — the exact machine-level layout of function calls and structs. Change a struct field, recompile with a different compiler, target a different CPU, and the binary contract can silently break. There's no JSON to eyeball; you get corrupted data or a crash.

**3. Build complexity explodes.** Now your build needs a C compiler, the right headers, platform-specific shared libraries, and cross-compilation toolchains. `cgo`, famously, disables Go's clean static-binary cross-compilation story and slows builds significantly. A pure-Go binary runs anywhere; a `cgo` binary drags libc along.

**4. Two memory models, two GCs, two debuggers.** You're now debugging across a boundary where one side is garbage-collected and the other is manually managed, with one debugger that understands Python and another that understands C. (Senior level goes deep on this.)

**Rule of thumb:** reach for FFI only when (a) the call is *hot* — invoked so often that per-call network overhead dominates — and (b) you're wrapping a *mature, stable* native library rather than your own evolving code. NumPy, cryptography libs, image codecs, and DB drivers are classic good FFI citizens. Your own business logic almost never is.

---

## 4. Shared schemas: the contract that makes interop safe

Whether you go network or FFI, the two languages must *agree on the shape of the data*. An informal agreement ("the response has a `score` field, I think") rots the moment one side changes. A **schema / IDL (Interface Definition Language)** turns that agreement into a machine-checked, versioned artifact.

The three you'll meet:

| Schema tech | Wire format | Strengths | Typical home |
|---|---|---|---|
| **Protocol Buffers** | Compact binary | Fast, typed, great codegen, strict field rules | gRPC, internal RPC |
| **Apache Avro** | Compact binary | Schema travels with data; excellent schema *evolution* | Kafka, big-data pipelines |
| **JSON Schema** | JSON (text) | Validates existing JSON APIs; human-readable | REST APIs, config |

The schema does three jobs at once:

1. **Single source of truth.** The `.proto` or `.avsc` file *is* the contract. Both the Go and Python sides generate their types from it, so they cannot disagree about field names or types — a whole class of integration bugs vanishes.
2. **Code generation.** One file produces idiomatic types in every language, eliminating the hand-written, drift-prone DTOs each side would otherwise maintain.
3. **Schema evolution rules.** This is the subtle, important one. A good schema system tells you which changes are *safe* (adding an optional field) and which are *breaking* (renaming, changing a type, reusing a field number). protobuf's field *numbers* exist precisely for this: the wire format keys off the number, not the name, so you can rename `model` to `model_name` without breaking old clients — but you must *never* reuse field number `2` for a different meaning.

```protobuf
message PredictResponse {
  double score = 1;
  string label = 2;
  // SAFE to add — old clients ignore unknown fields:
  string model_version = 3;
  // BREAKING — never change a field's type or reuse its number:
  // double label = 2;   // ☠️ corrupts every existing client
}
```

Without a schema, every cross-language boundary is a verbal agreement that decays. With one, the boundary is enforced at build time and can evolve without coordinated big-bang deploys. **The schema is what makes polyglot survivable, not the choice of REST vs gRPC.** (Schema and tooling maturity is also covered in [`03-ecosystem-and-tooling-maturity`](../03-ecosystem-and-tooling-maturity/).)

---

## 5. Serialization is never free

Every time data crosses a network boundary, it gets **serialized** (turned into bytes) on one side and **deserialized** on the other. This costs CPU, allocations, and time — and it's easy to underestimate.

Rough orders of magnitude (illustrative, not benchmarks):

| Operation | Approx. cost |
|---|---|
| In-process function call (FFI) | nanoseconds |
| protobuf encode/decode of a small message | microseconds |
| JSON encode/decode of the same message | several× the protobuf cost |
| A localhost network round-trip | tens of microseconds |
| A cross-datacenter round-trip | milliseconds |

The lesson: if you call across a JSON network boundary in a tight loop a million times, the serialization and round-trips can dwarf the actual work. That's exactly the situation where you either (a) **batch** — send 1,000 items per request instead of one — or (b) move to FFI to delete the boundary cost entirely. A surprising number of "our service is slow" investigations end at "we're making 50 fine-grained JSON calls where we should make one batched protobuf call."

---

## 6. Choosing the boundary granularity

Where you *draw* the boundaries matters as much as the *mechanism*. Two anti-patterns sit at the extremes:

**Too fine-grained ("chatty").** You split things so small that completing one user action requires ten cross-language round-trips. Now serialization and latency dominate, and a single slow hop stalls the whole chain. The classic symptom of a network boundary placed where an in-process call belonged.

**Too coarse ("a distributed monolith").** You draw boundaries that look like services but are so tightly coupled they must always deploy together and share a database. You pay all the *costs* of a network boundary (serialization, latency, two debuggers) and get none of the *benefit* (independent deploy, fault isolation).

The heuristic: **put a boundary where the coupling is naturally low** — where the two sides change for different reasons, are owned by different teams, or genuinely need different languages. Don't put a boundary in the middle of one tightly-coupled algorithm just because you *can*. Boundaries are cheap to add at design time and brutally expensive to move later, so place them along the seams that already exist in the problem.

---

## 7. A worked decision

Your Go API needs fraud scores from a Python ML model. Which interop mechanism?

- **Message queue?** No — the API needs the score *synchronously* to decide whether to accept the transaction. Async doesn't fit.
- **FFI (embed Python in Go)?** Tempting for speed, but Python's runtime doesn't embed cleanly into Go, the GIL complicates concurrency, and a model crash would take down your API. Too sharp for this seam.
- **REST/JSON?** Works, debuggable, but you're calling it on every transaction — latency and JSON overhead matter, and you want the request/response shape *enforced* so a model change can't silently break scoring.
- **gRPC/protobuf?** ✅ Internal, hot, latency-sensitive, and you want a typed contract that both teams generate from one `.proto`. This is the textbook fit.

**Decision: gRPC with a shared `.proto`, services kept separate.** If profiling later shows the network hop itself is the bottleneck even after batching, *then* consider co-locating or FFI — but you start at the loosely-coupled end and tighten only when measurement forces you to.

---

## 8. Common mistakes at this level

**Defaulting to FFI for speed without measuring.** FFI's sharp edges (crashes, build pain, ABI fragility) are real costs paid immediately; the speed benefit only matters if the boundary was actually hot. Measure first.

**Shipping a network API with no schema.** "We'll just use JSON" works until the third silent field-name typo causes a production incident. Add JSON Schema or move to protobuf; an unenforced contract is a contract that will break.

**Reusing protobuf field numbers.** The one truly unforgivable schema sin — it corrupts every deployed client at once. Field numbers are forever.

**Chatty boundaries.** N fine-grained calls where one batched call belongs. Profile for round-trip count, not just per-call time.

**Treating serialization as free.** It's CPU and allocations on *both* sides of every call. In hot paths it's frequently the bottleneck.

---

## 9. Quick rules

- [ ] Interop is a **spectrum** from async/queue (loose, slow) to FFI (tight, fast); match the point to the coupling.
- [ ] Default to a **network boundary** (gRPC internally, REST at the edge) for the fault isolation and independent deploys.
- [ ] Use **FFI only for hot, stable native libraries** — never for your own evolving business logic. It costs you both languages' safety at the seam.
- [ ] Put a **shared schema (protobuf/Avro/JSON Schema)** on *every* cross-language boundary. The schema, not the protocol, is what makes polyglot safe.
- [ ] Learn the **schema-evolution rules** cold: add optional fields freely; never rename-by-reuse or change a field number/type.
- [ ] **Serialization is never free** — batch chatty calls, and profile round-trip count.
- [ ] Place boundaries along **natural seams of low coupling**, not in the middle of a tight algorithm.

---

## 10. What's next

| Topic | File |
|---|---|
| The deep costs: cross-language debugging & observability, the FFI/network tradeoff in depth, runtime-level polyglot (JVM, .NET, GraalVM, WASM), polyglot vs sprawl | [`senior.md`](senior.md) |
| Org-level: governance, platform teams, supported-language lists, hiring & on-call cost, WASM's future | [`professional.md`](professional.md) |
| Interview Q&A on interop mechanisms and polyglot strategy | [`interview.md`](interview.md) |
| Design exercises: choose boundaries, design a contract, cost a new language | [`tasks.md`](tasks.md) |

---

**Memorize this:** interop is a spectrum, and you trade coupling/safety for latency as you move toward FFI. Default to a network boundary for isolation; reach for FFI only on hot, stable native code, knowing you forfeit both languages' safety at the seam. And whatever the mechanism, put a *schema* on the boundary — the contract, not the protocol, is what keeps polyglot from rotting.
