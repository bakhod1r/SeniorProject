# Foreign Function Interface & Interop

No language is an island. Sooner or later your Python calls into NumPy's C core,
your Go binary links a C crypto library, your Rust crate wraps a system API, your
JVM service shells out to native code through JNI, and your Node addon bridges to
C++. The **Foreign Function Interface (FFI)** is the seam where two languages'
runtimes — with different calling conventions, memory models, type systems, error
handling, and garbage-collection assumptions — have to agree on how to call each
other without corrupting memory or each other's invariants.

> *"Every FFI boundary is a treaty between two runtimes that don't trust each
> other's memory."*

The unifying theme of this section is **the boundary is where abstractions go to
die.** Inside one language, the compiler enforces types, the GC owns lifetimes,
and errors propagate cleanly. Cross the FFI and all of that stops at the border:
you are back to raw addresses, manual lifetimes, ABI rules written in calling
conventions, and the discipline of marshalling data into a representation both
sides understand. Get it right and you get C-speed access to decades of libraries.
Get it wrong and you get the worst bugs in software: memory corruption that
manifests *in the other language*, hours from the actual mistake.

---

## Why this matters

- The fast path of nearly every "slow" dynamic language is C: NumPy, Pandas,
  cryptography, database drivers, ML runtimes. Understanding the FFI is
  understanding where the performance actually lives.
- FFI bugs are uniquely vicious: a lifetime mistake on the Rust side corrupts the
  C heap; a missing `GC.KeepAlive` lets .NET collect an object the native code is
  still using; a calling-convention mismatch silently scrambles arguments.
- The FFI is where a memory-safe language **inherits the unsafety** of the one it
  calls — a fact the security section cares about deeply.

---

## The topics

| # | Topic | The question it answers |
|---|---|---|
| 01 | [What Is an ABI](01-what-is-an-abi/) | What contract must two compiled units share to interoperate at all? |
| 02 | [Calling Conventions](02-calling-conventions/) | How exactly are arguments, returns, and the stack arranged at a call? |
| 03 | [Name Mangling & Linking](03-name-mangling-and-linking/) | Why is the symbol `_ZN3foo3barEi`, and how does the linker find it? |
| 04 | [FFI from High-Level Languages](04-ffi-from-high-level-languages/) | How do Python/Java/Go/Rust/Node actually call native code? |
| 05 | [Data Marshalling & Memory Layout](05-data-marshalling-and-memory-layout/) | How do structs, strings, and arrays cross the boundary safely? |
| 06 | [Cross-Language Interop](06-cross-language-interop/) | Beyond C: how do whole ecosystems talk (C++, Wasm, gRPC, COM)? |
| 07 | [FFI Safety & Pitfalls](07-ffi-safety-and-pitfalls/) | What are the failure modes, and how do you not get destroyed by them? |

---

## How to read this section

Read **01 → 02 → 03** as a unit: the ABI is the contract, calling conventions are
its argument/return rules, and name mangling + linking is how the symbols actually
resolve. These are the foundations and they're mostly about C/C++ and the
machine. Then **04** is the practical payoff — how real high-level languages
(`ctypes`/`cffi`/CPython C-API, JNI/Panama, cgo, Rust `extern "C"`/`bindgen`,
N-API) cross the boundary. **05** is the hardest day-to-day skill: marshalling
data (strings, structs, ownership, the C `char*` ↔ language-string impedance
mismatch) without leaks or corruption. **06** widens beyond C-as-lingua-franca to
C++ ABIs, WebAssembly, IPC/RPC, and COM. **07** is the consolidated war-stories
and safety tier — read it last and keep it open whenever you write real FFI code.

Each topic ships the standard `junior` → `middle` → `senior` → `professional`
tiers plus `interview` and `tasks`.

---

## Related sections

- **[Runtime Systems](../runtime-systems/)** — GC integration, stack unwinding, and object layout all leak across the FFI boundary.
- **[Data Representation & Numerics](../data-representation-and-numerics/)** — marshalling is fundamentally about agreeing on bit-level representation and endianness.
- **[Memory Management](../memory-management/)** — who owns and frees what is *the* FFI question; pinning and lifetimes live here too.
- **[Language Security Internals](../language-security-internals/)** — the FFI is the seam through which a safe language inherits an unsafe one's vulnerabilities.
