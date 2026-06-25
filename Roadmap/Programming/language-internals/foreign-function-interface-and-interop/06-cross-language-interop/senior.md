# Cross-Language Interop — Senior Level

> **Topic:** [Cross-Language Interop](README.md)
> **Focus:** In-process polyglot runtimes (JVM, CLR, GraalVM/Truffle), WebAssembly as a universal interop target (core Wasm, the Component Model, WIT, WASI), object/component systems (COM, WinRT, Objective-C/Swift), and a rigorous decision framework across the whole spectrum.

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

> Focus: **Beyond flattening to C, there are runtimes where many languages share a type system and a garbage collector, and there is an emerging universal interop target — WebAssembly — that solves the ABI problem with a shared interface language.**

The junior and middle levels established the spectrum and the hardest in-process case (C++). This level covers the two ends of the modern interop story that a senior engineer is expected to reason about fluently.

First, **shared-runtime polyglot interop.** Some platforms sidestep the ABI problem entirely by making multiple languages compile to the *same* intermediate representation and share *the same* type system, object model, and garbage collector. On the **JVM**, Java, Kotlin, Scala, Clojure, and Groovy all produce bytecode and pass each other real, live objects with no marshalling. On the **CLR/.NET**, C#, F#, and VB.NET share the Common Type System (CTS) defined by the Common Language Infrastructure (CLI). **GraalVM/Truffle** generalizes this to a polyglot engine where JavaScript, Python, Ruby, R, Java, and LLVM-based languages run in one VM and exchange objects. The big advantage: when languages already share types and a GC, "interop" is nearly free — it's just calling a method on an object.

Second, **WebAssembly as a universal target.** Wasm started as a fast, sandboxed, portable bytecode for the browser. Its **Component Model** plus **WIT** (WebAssembly Interface Types) turn it into something more ambitious: a *language-neutral, ABI-stable composition layer*. You describe an interface once in WIT; any language that compiles to a Wasm component can implement or consume it; the toolchain handles the lifting and lowering of rich types (strings, lists, records, variants) across the boundary. Wasm is, in effect, an attempt to solve the in-process interop problem *properly* — the canonical ABI problem replaced by a shared IDL, inside a sandbox.

Third, the **object/component systems** — COM, WinRT, and the Objective-C/Swift runtime — that solved cross-language objects in earlier eras, and whose ideas echo in everything above.

Finally, a **decision framework** that places all of this on one axis.

> 🎓 **Why this matters at this level:** Choosing the interop strategy for a system — FFI vs polyglot VM vs Wasm component vs RPC — is an architectural decision with multi-year consequences for performance, safety, team boundaries, and portability. This page is the reasoning toolkit for making it well.

---

## Prerequisites

- **Required:** Middle level — the C++ flattening pattern, opaque handles, ownership contracts, and the IDL/RPC model.
- **Required:** Understanding of what a garbage collector does and why GC interop is hard across runtimes.
- **Required:** Familiarity with bytecode/intermediate representations conceptually (JVM bytecode, CIL).
- **Helpful:** Having used at least one JVM or .NET language, and having seen Wasm in any context.
- **Helpful:** Awareness of sandboxing and capability-based security.

You do **not** yet need: the large-scale binding-maintenance, format-selection-at-scale, and production-discipline material in `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Polyglot runtime** | A VM that hosts multiple languages and lets them share objects, types, and a GC (JVM, CLR, GraalVM). |
| **CTS / CLI** | .NET's Common Type System and Common Language Infrastructure — the shared type model that lets C#, F#, and VB.NET interoperate as one. |
| **Truffle** | GraalVM's framework for building language interpreters that the Graal JIT can optimize and that can share objects across languages. |
| **Interop message (Truffle)** | The protocol by which Truffle languages expose objects to each other (member access, array reads, executable calls). |
| **Wasm core** | The base WebAssembly: a stack machine with i32/i64/f32/f64, linear memory, and module imports/exports. No high-level types. |
| **Linear memory** | A Wasm module's single flat byte array; the only place complex data (strings, structs) lives at the core level. |
| **Component Model** | A Wasm specification layering rich, language-neutral interfaces and composition on top of core Wasm modules. |
| **WIT (WebAssembly Interface Types)** | The IDL of the Component Model: describes records, variants, lists, strings, results, resources — independent of any language. |
| **Lifting / lowering** | Converting a language's native value to the canonical Component Model representation (lower) and back (lift) at a component boundary. |
| **Canonical ABI** | The Component Model's specified, stable way of laying out WIT types over core Wasm — the "solved" ABI. |
| **WASI** | The WebAssembly System Interface — a capability-based, POSIX-like API giving Wasm access to files, clocks, sockets, etc. |
| **Resource (WIT)** | A handle to an opaque, owned object passed across a component boundary — the Component Model's principled version of the opaque pointer. |
| **COM** | Microsoft's Component Object Model: a binary standard for cross-language objects via vtable-based interfaces, `IUnknown`, and reference counting. |
| **IUnknown** | The base COM interface every COM object implements: `QueryInterface`, `AddRef`, `Release`. |
| **WinRT** | Windows Runtime — a modern, metadata-rich evolution of COM underpinning modern Windows APIs. |
| **Objective-C runtime** | A dynamic message-dispatch runtime that Swift bridges to, enabling Swift↔Objective-C interop on Apple platforms. |

---

## Core Concepts

### 1. Shared-Runtime Interop: Solve the ABI by Not Having Two ABIs

The JVM and CLR make interop almost disappear by a simple trick: **don't let the languages have separate ABIs at all.** Kotlin and Scala don't compile to native code with their own calling conventions — they compile to **JVM bytecode**, the same target Java uses. At runtime there is one heap, one object model, one GC, one exception mechanism. A Scala `List` *is* a JVM object a Kotlin or Java method can hold directly. No marshalling, no serialization, no flattening. Calling Java from Kotlin is just a method call.

.NET does the same through the **CLI/CTS**: C#, F#, and VB.NET all compile to CIL (Common Intermediate Language) and obey one Common Type System, so a class defined in F# is a first-class type in C#. The platform *is* the interop layer.

The cost is buy-in: every participating language must target that runtime and accept its object model and GC. You cannot bring an arbitrary native language into the JVM heap. But within the family, interop is the cheapest it ever gets.

### 2. GraalVM/Truffle: Polyglot in One Engine

GraalVM generalizes the shared-runtime idea beyond a single bytecode. With **Truffle**, language interpreters are written so the Graal JIT can optimize them, and a shared **interop protocol** lets a JavaScript object be read by Python, a Java method be called from Ruby, or a value flow between R and LLVM-compiled C. The languages keep their own semantics but exchange objects through a common message protocol (read member, execute, get array element). The result is multiple languages in **one process, one heap**, sharing live objects — without each pair needing a hand-written binding.

The trade-off is that you're committing to the GraalVM engine, and peak performance and language completeness vary by guest language. But conceptually it's the most ambitious "shared types, shared GC" interop available today outside a single bytecode family.

### 3. WebAssembly Core: A Neutral, Sandboxed Compilation Target

Core Wasm is deliberately minimal: a portable stack machine with four numeric types and a **linear memory** (one flat byte array). Dozens of languages — C, C++, Rust, Go, C#, Swift — can compile to it. It is **sandboxed** (a module can only touch its own linear memory and the imports it's explicitly given) and **portable** (the same `.wasm` runs anywhere there's a runtime).

But core Wasm has the *same old interop problem in a new place*: to pass a string between two modules, you must agree on how to lay it out in linear memory (pointer + length? null-terminated? which encoding?). At the core level, that agreement is unspecified — you're back to hand-rolling an ABI, just inside the sandbox. This is exactly what the Component Model fixes.

### 4. The Component Model + WIT: A Shared IDL That Solves the ABI

The **Component Model** layers language-neutral, richly typed interfaces on top of core modules, and **WIT** is its IDL. You write an interface once:

```wit
// calculator.wit
package example:calc;

interface calculator {
    record point { x: f64, y: f64 }
    add: func(a: s64, b: s64) -> s64;
    distance: func(p1: point, p2: point) -> f64;
    parse: func(text: string) -> result<s64, string>;
}
```

Any language with a Component Model toolchain can **implement** this interface (producing a component) or **consume** it. The toolchain knows how to **lower** a guest language's native string/record/list into the **canonical ABI** representation in linear memory and **lift** it back on the other side. Crucially, the canonical ABI is *specified and stable* — it is the standardized solution to the very ABI problem that makes C++ interop miserable. Two components written in Rust and Python compose because both speak WIT through the same canonical ABI, not because they share a heap.

The conceptual leap: **the Component Model is in-process interop where the "lingua franca" is a modern, rich, ABI-stable IDL instead of the lowest-common-denominator C ABI.** It's the C-ABI lingua-franca idea, redesigned with strings, lists, variants, and a proper ownership story (`resource`).

### 5. WASI and Capability-Based Access

A sandboxed component can do nothing by default — it can't open files or sockets. **WASI** provides those capabilities, but in a **capability-based** way: the host explicitly grants a component a preopened directory, a clock, a socket. There is no ambient authority. This makes Wasm components a strong substrate for running untrusted or third-party code in-process: you get near-native speed *and* isolation, the combination that in-process FFI famously cannot offer.

### 6. Object/Component Systems: COM and Its Descendants

Long before Wasm, **COM** solved cross-language objects on Windows with a *binary* standard. A COM object exposes one or more **interfaces**, each laid out as a **vtable** (a table of function pointers) with a fixed, agreed binary shape. Every interface derives from **IUnknown**, which provides `QueryInterface` (ask an object "do you support interface X?") and **reference counting** via `AddRef`/`Release`. Because the contract is the *vtable layout plus IUnknown*, any language that can call through a vtable and respect the refcount can use a COM object — C++, C#, VB, Delphi, scripting languages. **WinRT** is the metadata-rich modern evolution. **.NET COM interop** bridges managed code to COM via runtime callable wrappers. On Apple platforms, the dynamic **Objective-C runtime** plays a similar bridging role for Swift↔Objective-C.

The enduring lesson from COM: **a binary-stable interface contract (vtable + identity + lifetime protocol) lets arbitrary languages share objects** — which is exactly what the Component Model's `resource` and canonical ABI re-derive with modern, portable, sandboxed semantics.

### 7. The Decision Framework

Place every approach on one axis from *fastest/most-coupled* to *slowest/most-isolated*:

```text
  In-process C-FFI     Polyglot VM         Wasm component        RPC / IPC
  ───────────────      ───────────────     ───────────────       ───────────────
  fastest call          shared GC & types   sandboxed, portable   isolated, slow
  zero isolation        zero isolation*     strong isolation       strong isolation
  ABI fragility         runtime lock-in     stable canonical ABI   schema + network
  native code           same-runtime langs  many langs → Wasm      any langs, any host
```

(*polyglot VMs isolate languages logically but still share one process/heap, so a VM crash takes everyone down.)

Decision questions, in order:
1. **Do the languages already share a runtime** (all JVM, all .NET)? Use the shared-runtime interop — it's nearly free.
2. **Do you need maximum call throughput with native code and accept fragility/coupling**? Raw FFI (flatten C++ to C).
3. **Do you need many languages, in-process speed, *and* sandboxed isolation/portability**? Wasm components — the emerging answer.
4. **Do you need fault isolation, independent deploy/scale, or a cross-machine boundary**? RPC/IPC, accept the latency.

The senior skill is recognizing which question dominates for *this* system, and not defaulting to whatever the team used last time.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Shared-runtime interop (JVM/CLR)** | Coworkers who all speak one common language natively — no translator needed, they just talk. |
| **GraalVM polyglot** | A United Nations room where one universal interpreter lets every delegate's statement be understood by all the others instantly. |
| **Core Wasm linear memory** | A shared shipping container: everyone can put bytes in, but unless you agree on how things are packed, the other end finds a jumble. |
| **Component Model + WIT** | A universal, standardized customs declaration form: pack by the spec and any country's port can unpack your goods correctly. |
| **Canonical ABI** | A globally standardized pallet size — warehouses worldwide can handle your shipment because everyone agreed on the dimensions. |
| **WASI capabilities** | A guest who can only use the specific keys the host hands them — no master key, no roaming the building. |
| **COM vtable + IUnknown** | A standard wall-socket plus a meter: any appliance can plug in, and a counter tracks how many things are drawing power so the supply turns off when the last unplugs. |
| **The decision axis** | A mixing console fader: slide toward speed (left) or toward isolation (right); you can't have both maxed. |

---

## Mental Models

### The "One Heap, No Translation" Model

For shared-runtime interop, picture all the languages sharing a single heap and a single GC. There is no boundary to marshal across — a value created by one language is *the same object* another language sees. Interop cost approaches zero. The price is admission: you must compile to that runtime and live by its rules. This is the cheapest interop in existence *if* you can pay the entry fee.

### The "Sandbox With a Standard Doorway" Model

For Wasm components, picture each language compiled into its own sealed box (the sandbox) with a single, standardized doorway (the canonical ABI / WIT). Boxes can't reach into each other's memory — but they can pass rich, typed values through the standard doorway, and the toolchain handles the packing and unpacking. You get the isolation of separate processes with the locality of one process and the portability of a single bytecode. This is why many believe Wasm components are *the* interop layer of the next decade.

### The "Contract Is the Component" Model (from COM)

COM's deep idea, worth internalizing: **the object is whatever satisfies the binary interface contract.** Identity (`QueryInterface`), lifetime (`AddRef`/`Release`), and a fixed vtable layout *are* the object as far as another language is concerned. The implementation language is irrelevant. WIT `resource`s and the canonical ABI restate this with modern, portable, sandboxed semantics. When you design any cross-language object boundary, you are really designing a contract of identity, lifetime, and dispatch.

---

## Code Examples

### Shared-runtime interop: Kotlin calling Java, no marshalling

```java
// Greeter.java
public class Greeter {
    public String greet(String name) { return "Hello, " + name; }
}
```

```kotlin
// Main.kt — different language, SAME JVM heap and types
fun main() {
    val g = Greeter()                 // a real Java object on the JVM heap
    println(g.greet("Ada"))           // direct virtual call — no FFI, no copy
}
```

There is no boundary code at all. `Greeter` is a JVM object; Kotlin holds it directly and dispatches a method. The "interop" is invisible because there is only one runtime, one object model, one GC.

### .NET: F# type consumed from C#, sharing the CTS

```fsharp
// Library.fs
namespace Shared
type Point = { X: float; Y: float }
module Geometry =
    let distance (a: Point) (b: Point) =
        sqrt ((a.X - b.X) ** 2.0 + (a.Y - b.Y) ** 2.0)
```

```csharp
// Program.cs — C# uses the F#-defined type as a first-class CTS type
using Shared;
var a = new Point(0.0, 0.0);
var b = new Point(3.0, 4.0);
Console.WriteLine(Geometry.distance(a, b)); // 5 — one type system, no glue
```

### WebAssembly Component Model: one WIT, two languages compose

The shared interface:

```wit
// adder.wit
package demo:adder;
world adder {
    export add: func(a: s32, b: s32) -> s32;
}
```

A Rust component *implements* it (sketch using the standard binding macro):

```rust
wit_bindgen::generate!({ world: "adder" });
struct Component;
impl Guest for Component {
    fn add(a: i32, b: i32) -> i32 { a + b }
}
export!(Component);
```

A different host or component — written in, say, Python or JavaScript — *consumes* the same component through the same WIT, and the toolchain lifts/lowers the values across the canonical ABI. Neither side knows or cares what language the other is; the WIT contract and canonical ABI are the entire agreement. Pass a `string` or a `list<u8>` instead of an `s32` and the toolchain still handles the layout — the thing core Wasm could not do by itself.

### COM in spirit: an interface contract any language can call

```c
// IUnknown-shaped vtable: identity + lifetime + methods, binary-stable layout
struct ICalcVtbl {
    HRESULT (*QueryInterface)(ICalc*, REFIID, void**);
    ULONG   (*AddRef)(ICalc*);
    ULONG   (*Release)(ICalc*);          // refcounting lifetime
    HRESULT (*Add)(ICalc*, int a, int b, int* out);  // the actual method
};
struct ICalc { struct ICalcVtbl* lpVtbl; };
```

Any language that can call through this vtable and honor `AddRef`/`Release` can use the object — that's how a VB script and a C++ app used the same COM component for decades. The refcount is the cross-language lifetime contract; forgetting a `Release` (or one too many) is the canonical COM leak/crash.

---

## Pros & Cons

| Approach | Pros | Cons |
|----------|------|------|
| **Shared-runtime (JVM/CLR)** | Near-zero interop cost; shared types and GC; mature tooling | All languages must target that runtime; no native-code or arbitrary-language inclusion; one process = shared crash domain |
| **GraalVM polyglot** | Many languages share objects in one engine; no per-pair bindings | Engine lock-in; variable guest-language performance/completeness; large runtime |
| **Wasm core** | Portable, sandboxed, many source languages | No rich-type interop by itself — you re-invent an ABI in linear memory |
| **Wasm Component Model** | Language-neutral, ABI-stable, sandboxed, portable, rich types, capability security | Younger ecosystem; toolchain maturity varies; lift/lower has some cost |
| **COM / WinRT** | Battle-tested binary cross-language objects; identity + lifetime standardized | Windows-centric; refcounting is error-prone; verbose; aging model |
| **RPC / IPC** | Fault isolation, independent deploy, cross-machine, designed to evolve | Serialization + network latency on every call; operational complexity |

---

## Use Cases

- **A product built entirely on the JVM or .NET** → use shared-runtime interop; reaching for FFI or RPC between, say, Kotlin and Java would be self-inflicted complexity.
- **Embedding many scripting languages in one analytics engine** → GraalVM polyglot, so a user's Python and the engine's Java exchange objects without per-pair bindings.
- **Running untrusted plugins at near-native speed inside your app** → Wasm components with WASI capabilities: speed *and* a sandbox, which raw FFI cannot give.
- **Composing functions written in different languages into one binary, portably** → Wasm Component Model; WIT is the contract, the canonical ABI is the stable wire.
- **Driving legacy Windows components from a modern app** → COM/.NET COM interop, accepting the refcounting discipline.
- **Two teams, two languages, separate SLAs and deploys** → RPC, because shared runtime/Wasm/FFI all couple lifetime and deployment.

---

## Coding Patterns

### Pattern 1: Prefer shared-runtime when the family already fits

If every language involved already targets the JVM or CLR, the correct "interop strategy" is *no interop layer at all* — just call methods. Don't add FFI or RPC where shared types already exist.

### Pattern 2: WIT-first design for Wasm composition

Write the WIT interface before the implementation, exactly as you'd write a `.proto` before a gRPC service. The interface — records, variants, `result<T,E>`, `resource` handles — is the durable contract; implementations in any language follow.

### Pattern 3: Model owned objects as WIT `resource`s, not raw pointers

The Component Model's `resource` is the principled successor to the opaque `void*` handle: it carries ownership and lifetime semantics across the boundary, so the toolchain — not hand-written discipline — enforces "freed exactly once."

### Pattern 4: Grant capabilities explicitly (WASI)

Never assume ambient authority for a component. Pass exactly the directory, socket, or clock it needs. This turns "run third-party code" from a risk into a bounded, auditable grant.

### Pattern 5: Treat the spectrum as a dial you set per boundary

Different boundaries in one system can sit at different points: a hot inner loop in-process via FFI, a plugin surface via Wasm, a cross-team edge via RPC. Don't force one mechanism on every boundary.

---

## Best Practices

- **Match the mechanism to the dominant constraint** (speed, isolation, portability, team boundaries) — not to habit.
- **Use shared-runtime interop wherever the languages already share a runtime.** It is strictly the cheapest correct option there.
- **Design Wasm interfaces in WIT first** and let the canonical ABI carry rich types; don't hand-roll layouts in linear memory.
- **Lean on capability-based isolation** for untrusted code: Wasm + WASI gives you in-process speed with a sandbox.
- **Respect lifetime contracts** whatever the model — COM refcounts, WIT resources, FFI handles. Lifetime is where cross-language object interop breaks.
- **Keep boundaries narrow and rich-typed where the model allows it.** WIT and the Component Model let you pass real strings/lists/records — use that instead of flattening everything to bytes by hand.
- **Document the crash domain.** Be explicit that polyglot-VM and FFI boundaries share a process (one crash kills all), while RPC and sandboxed components do not.
- **Plan for the maturity gap.** The Component Model is powerful but young; verify your target languages' toolchains support the WIT features you need before committing.

---

## Edge Cases & Pitfalls

- **Assuming polyglot VMs give isolation.** They share types and a GC — and a *process*. A native crash or `OutOfMemoryError` takes down every language at once. Logical interop ≠ fault isolation.
- **GC cycles across runtime boundaries.** When two GCs (or a GC and a refcount) reference each other's objects, neither can prove the cycle is dead; you get leaks. Polyglot and FFI boundaries both hit this.
- **Treating core Wasm as if it solved interop.** Core Wasm only standardizes the *numeric* boundary; passing a string between two core modules still requires an agreed linear-memory layout. The Component Model is what actually solves it.
- **WIT/canonical-ABI version skew.** A component built against one version of the interface or ABI may not compose with another; the ecosystem is still stabilizing. Pin versions.
- **COM refcount leaks and over-releases.** One missing `Release` leaks the object forever; one extra `Release` frees it early and crashes other holders. The classic, still-common COM bug class.
- **`QueryInterface` returning an interface you forgot to `Release`.** Every interface pointer obtained is a new reference you own and must release.
- **Objective-C/Swift bridging surprises.** Bridged types (e.g., `NSString` ↔ `String`) may copy or share depending on context; assuming one or the other causes subtle bugs.
- **Lift/lower cost ignored.** The Component Model isn't free — large records and lists are copied across the canonical ABI. For ultra-hot paths, even this can matter; measure.
- **Capability over-granting in WASI.** Handing a component a whole filesystem root "to be safe" defeats the sandbox. Grant the minimum.
- **Choosing a polyglot VM for languages that don't really fit it.** Forcing a native-heavy or systems language into a managed polyglot engine can cost more than a clean RPC or FFI boundary. The shared-runtime advantage only applies to languages that genuinely target the runtime.
