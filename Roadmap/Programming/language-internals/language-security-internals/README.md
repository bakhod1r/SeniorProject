# Language Security Internals

Security, at the level this section cares about, is not a feature you add — it is a property of how the language *executes*. A buffer overflow is an evaluation-model failure. ASLR, stack canaries, CFI, and W^X are the runtime's immune system. Spectre is the CPU's own optimizer betraying the program's abstractions. This section is about the mechanisms — in the language, the compiler, the runtime, and the hardware — that decide whether a bug stays a bug or becomes a remote code execution.

> *"Given a sufficiently powerful attacker, every undefined behaviour is a control-flow primitive."*

The mental model that unifies the whole section: an attacker's job is to turn **data they control** into **code (or control flow) the program never intended**. Every defense here either (a) makes that corruption impossible (memory safety), (b) makes the corrupted state useless because addresses are unpredictable (ASLR), (c) checks at the corruption's payoff moment that control flow is still legal (CFI, canaries), (d) shrinks what a compromised component can reach (sandboxing, capabilities), or (e) closes a channel that leaks secrets without any corruption at all (side channels). Knowing which layer catches which attack — and which attacks slip *between* the layers — is the senior skill.

---

## Why this matters

The most expensive vulnerability classes in the industry's history are exactly the ones modeled here: memory-corruption bugs (~70% of the CVEs in large C/C++ codebases per both Microsoft and Google data), and microarchitectural side channels (Spectre/Meltdown forced a rewrite of how every OS and browser isolates secrets). The defenses are why exploitation today is *hard* instead of trivial — and understanding them is what separates "I sanitize my inputs" from "I know my threat model and which mitigation actually stops which exploit primitive."

---

## The topics

| # | Topic | The question it answers |
|---|---|---|
| 01 | [Memory-Safety Mechanisms](01-memory-safety-mechanisms/) | How do languages prevent (or fail to prevent) out-of-bounds and use-after-free? |
| 02 | [Control-Flow Integrity](02-control-flow-integrity/) | How do we stop a corrupted pointer from redirecting execution? |
| 03 | [ASLR & Mitigations](03-aslr-and-mitigations/) | How does randomizing the address space blunt exploitation, and how is it bypassed? |
| 04 | [Sandboxing & Isolation](04-sandboxing-and-isolation/) | How do we run untrusted code while bounding its blast radius? |
| 05 | [Side Channels & Spectre](05-side-channels-and-spectre/) | How do timing, cache, and speculation leak secrets with no memory bug at all? |
| 06 | [Capability-Based Security](06-capability-based-security/) | What if authority were *unforgeable references* instead of ambient permissions? |

---

## How to read this section

Start with **01** — memory safety is the root cause class the rest of the section defends against. **02** and **03** are the two pillars of the "assume the bug exists, contain the exploit" strategy that real C/C++ deployments rely on (CFI breaks control-flow hijacking; ASLR breaks the attacker's knowledge of *where* to jump). **04** widens the lens from a single process to isolating whole untrusted components (Wasm, seccomp, V8 isolates, containers, MicroVMs). **05** is the hardest and most modern: attacks that defeat *all* of the above because they never corrupt memory — they read it through the side door of microarchitecture. **06** is the "what if we designed for least authority from the start" counterpoint — the affirmative model behind capabilities, object-capability languages, and WASI.

Each topic ships the standard `junior` → `middle` → `senior` → `professional` tiers plus `interview` and `tasks`.

---

## Related sections

- **[Memory Management](../memory-management/)** — use-after-free, double-free, and allocator hardening are the bug substrate topic 01 defends.
- **[Runtime Systems](../runtime-systems/)** — JITs both create attack surface (W^X violations, JIT spraying) and enforce isolation (V8 isolates).
- **[Data Representation & Numerics](../data-representation-and-numerics/)** — integer overflow is the classic *trigger* that turns into a memory-safety violation.
- **[Foreign Function Interface & Interop](../foreign-function-interface-and-interop/)** — the FFI boundary is where a safe language inherits an unsafe one's vulnerabilities.
