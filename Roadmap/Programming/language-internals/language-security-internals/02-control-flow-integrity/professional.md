# Control-Flow Integrity — Professional Level

> **Topic:** [Control-Flow Integrity](README.md)
> **Focus:** The cat-and-mouse frontier — CFI bypass classes (COOP, data-only attacks), the precision ceiling of CFI, performance and adoption economics, and how to architect a defense-in-depth program that doesn't overclaim.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **CFI is deployed everywhere now. So why are memory-corruption exploits still shipping? What does CFI fundamentally *not* solve, and how do you reason about the residual risk like an owner?**

The previous levels built CFI up: forward-edge type sets, backward-edge shadow stacks and PAC, hardware landing pads. This level tears at the seams — not to teach offense, but because **a professional must know exactly where the guarantee stops.** CFI does not make memory-unsafe code safe. It raises the *cost* of turning a memory bug into code execution, and it shifts the attacker toward bug classes CFI cannot see: **data-only attacks** (corrupt non-control data) and **COOP** (Counterfeit Object-Oriented Programming — reuse whole *legitimate* virtual calls so even fine-grained vtable CFI is satisfied). It also collides with reality: precision is bounded by what the type system and analysis can prove, every check costs cycles and complicates JITs/unwinding, and adoption is gated by CPU support, ABIs, and the slowest third-party `.so` in your dependency graph.

The professional framing is economic and architectural. CFI is one mitigation in a portfolio whose *purpose* is to make exploitation expensive and unreliable enough that attackers go elsewhere — chained with ASLR, memory tagging (MTE), sandboxing, privilege separation, and, ultimately, *memory-safe languages* that delete the bug class. You are the person who decides where on that curve to invest, and who must resist the seductive but false claim "we enabled CFI, so we're protected against memory corruption."

> 🎓 **Why this matters for a professional:** You set security strategy, threat models, and the bar for "good enough." You'll be asked "are we protected against ROP?" and the correct answer is a precise, bounded statement, not "yes." You decide whether the right move is more CFI, MTE, a sandbox, or rewriting a parser in Rust. And you must read exploit post-mortems and recognize *which* layer failed and why CFI didn't catch it.

This page covers: the **precision ceiling** of CFI, **data-only attacks** and why CFI is blind to them, **COOP** and counterfeit-object reuse, **performance and adoption economics**, where CFI sits relative to **MTE/ASLR/sandboxing/memory safety**, and how to architect and communicate a defense-in-depth program honestly.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md`, `middle.md`, `senior.md` — the full stack from stack smashing through ROP/JOP/COP, LLVM CFI/CFG/XFG, shadow stacks, CET/IBT, PAC/BTI, KCFI/FineIBT.
- **Required:** Comfort reasoning about *threat models* and attacker capabilities (read primitive, write primitive, info leak).
- **Helpful but not required:** Exposure to ARM **MTE** (Memory Tagging Extension) and ASLR internals.
- **Helpful but not required:** Experience owning a hardening rollout across a large binary/dependency graph.

You do **not** need to know:

- How to construct any of these bypasses — we describe *classes* and *why CFI misses them*, defensively.

> ⚠️ **Defensive scope.** This level discusses *why* defenses fail at a conceptual, architectural level. It deliberately contains no working bypass construction, payloads, or exploit primitives.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Data-only attack** | Corrupting *non-control* data (flags, lengths, indices, pointers-to-data) to change behavior without ever redirecting a branch. Invisible to CFI. |
| **COOP** | Counterfeit Object-Oriented Programming — crafting fake-but-type-valid objects and invoking *legitimate* virtual functions in a malicious sequence. |
| **Counterfeit object** | An attacker-built object whose vtable pointer points at a *real, valid* vtable, so vtable CFI is satisfied. |
| **Precision ceiling** | The limit on how small a CFI target set can be made given the analysis/type information available. |
| **Equivalence class** | The set of targets CFI treats as interchangeable (e.g., all functions of one type). Attacks live *inside* a class. |
| **MTE (Memory Tagging Extension)** | ARM feature tagging memory regions and pointers; mismatched access faults. Catches spatial/temporal bugs CFI can't. |
| **ASLR** | Address Space Layout Randomization — randomizes module/stack/heap base addresses; defeated by info leaks. |
| **Info leak** | A bug that discloses memory contents/addresses; the key that unlocks many "blocked" exploits. |
| **Sandboxing** | Confining a process so that even full code execution yields limited capability. |
| **Defense in depth** | Layering independent mitigations so an attacker must defeat several at once. |
| **Memory safety** | Language/runtime guarantees (Rust, Go, managed runtimes) that delete the bug class CFI mitigates. |
| **Residual risk** | The exploitation paths that remain *after* a mitigation is deployed. |

---

## Core Concepts

### 1. The Precision Ceiling: CFI Allows an Equivalence Class, Not a Point

Every CFI scheme answers "may this indirect branch go *here*?" by checking membership in a **target set** — an **equivalence class** of "indistinguishable" targets. Fine-grained CFI shrinks the class (type-based, type-hash), but it can almost never shrink it to the single, contextually-correct target, because the information to do so (which target is correct *at this call, in this state*) isn't statically available. Consequences:

- If two functions share a type, CFI treats them as interchangeable. An attacker who can only redirect *within* the class still has options.
- Indirect calls with permissive types (`void(void)`, `void*(void*)`, opaque callback ABIs) have large classes and weak CFI value.
- Backward-edge integrity (shadow stack/PAC-ret) is the exception — there's exactly *one* correct return target, so it can be precise. This is *why backward-edge integrity is stronger than forward-edge CFI*: the forward edge has a precision ceiling the backward edge doesn't.

So the honest statement is: CFI bounds the attacker to *legal-looking* control flow. The remaining attacks are the ones that *stay legal-looking*.

### 2. Data-Only Attacks: CFI's Structural Blind Spot

CFI protects **control data** (return addresses, code pointers). It is, by construction, blind to **non-control data**. If a bug lets an attacker flip an `is_admin` flag, enlarge a `length` field, swap a `file_path`, or corrupt a *data* pointer the program later trusts, the program's control flow stays *entirely legitimate* — every branch goes where the source says — yet the behavior is attacker-chosen.

Classic shapes (described, not weaponized):

- Overwrite a permission/role boolean so a later legitimate `if (authorized)` takes the privileged path.
- Corrupt a size/bounds field so a subsequent legitimate copy reads/writes more than intended.
- Redirect a *data* pointer (not a function pointer) — e.g., a buffer pointer or a configuration pointer — so legitimate code operates on attacker-chosen memory.
- **Data-Oriented Programming (DOP):** chain such non-control corruptions to achieve rich, even Turing-complete, computation — all without a single hijacked branch.

The takeaway: **CFI raises the cost of control-flow hijacking, which *pushes* sophisticated attackers toward data-only techniques.** A CFI-hardened target is not a safe target; it's a target where the cheap attack moved.

### 3. COOP: Defeating Even Fine-Grained vtable CFI

**Counterfeit Object-Oriented Programming (COOP)** is the canonical demonstration that *forward-edge CFI can be satisfied and still bypassed*. The idea: instead of forging a *fake* vtable (which `cfi-vcall` would reject), the attacker assembles **counterfeit objects** whose vtable pointers point at **real, valid vtables**, then drives a sequence of **legitimate virtual calls** ("vfgadgets" — whole virtual functions) to perform computation. Because every call dispatches through a *genuine* vtable to a *type-valid* method, vtable-integrity CFI sees nothing wrong.

COOP matters professionally because it proves a deep point: **enforcing that each individual indirect call is *type-valid* does not prevent a malicious *composition* of valid calls.** The "grammar" is enforced; the "sentence" is still hostile. Defenses respond with even tighter context (e.g., per-call-site argument/state checks), but the precision ceiling means there's always residual composition freedom. COOP is the forward-edge analog of "ROP reuses legitimate code" — only now it reuses legitimate *typed* calls.

### 4. The Economics: Performance, Adoption, and the Weakest Link

CFI's deployment is governed less by theory than by cost:

- **Performance.** Inserted checks cost cycles (forward-edge type checks), hardware features cost little (CET shadow stack, PAC) but not nothing. Hot indirect-call paths (interpreter loops, dispatch tables) feel it most. Real numbers are usually low single-digit percent, but "low" is relative to a product's margins.
- **Toolchain/ABI friction.** LLVM CFI wants LTO and whole-program visibility; PAC/CET need property-note marking; mixing instrumented and un-instrumented objects creates "legacy" gaps. The guarantee is only as strong as the *least-protected* linked component.
- **Hardware gating.** CET/PAC/BTI/MTE need capable silicon and OS support; you ship to a fleet with a long tail of old CPUs, so you maintain both paths.
- **Compatibility breakage.** JITs, `dlsym`, `setjmp`/`longjmp`, custom unwinders, signal handling, and stack switching all collide with CFI and must be handled or exempted — and every exemption is a potential hole.

The professional's job is to spend the CFI budget where the attack surface is (untrusted parsers, network input, IPC boundaries) and to *measure* both the overhead and the residual.

### 5. CFI in the Portfolio: ASLR, MTE, Sandboxing, Memory Safety

CFI is one layer. The complementary layers attack *different* parts of the exploit chain:

- **ASLR** hides addresses — but a single **info leak** undoes it, and CFI doesn't prevent leaks. ASLR + CFI is standard, but they share the info-leak weakness.
- **ARM MTE (Memory Tagging)** attacks the *root cause* CFI only mitigates downstream: it catches out-of-bounds and use-after-free *at the moment of the bad access*, before the attacker ever reaches a corrupted pointer. MTE and CFI are highly complementary — MTE kills many bugs that would otherwise feed a CFI-bypass.
- **Sandboxing / privilege separation** assumes the worst (code execution happens) and *contains* it, so a bypass yields little. Browsers' renderer sandboxes are the model.
- **Memory-safe languages** (Rust, Go, managed runtimes) *delete the bug class*. The strategic endgame for new code is to remove the conditions CFI exists to mitigate. CFI is the safety net for the C/C++ you can't rewrite *yet*.

The architecture mindset: CFI makes the *control-flow* step expensive; MTE makes the *corruption* step fail early; sandboxing makes *success* cheap to contain; memory safety makes the *bug* not exist. You want as many of these as the platform and budget allow.

### 6. Communicating the Guarantee Without Overclaiming

A recurring professional failure is the security claim that outruns the mechanism. Precise framing:

- ✅ "Forward-edge CFI restricts indirect calls to type-compatible targets, and shadow stacks/PAC make return-address forgery infeasible, so classic ROP/vtable-hijack chains are blocked."
- ❌ "CFI protects us from memory-corruption exploits."
- ✅ "Residual exposure: data-only attacks, COOP-style composition within type classes, and any path our exemptions (JIT, FFI) open. We mitigate those with MTE/ASLR/sandboxing and are migrating the highest-risk parsers to a memory-safe language."

That paragraph is the deliverable. It states what's covered, what's not, and the plan for the gap.

---

## Real-World Analogies

**Precision ceiling as a multiple-choice exam.** Fine-grained CFI narrows the answer from "any of 10,000 options" to "one of these 12 type-matching options." It rarely gets to "exactly this one," because the information needed to pick *the* correct answer at runtime isn't on the answer sheet. Attackers live among the remaining 12.

**Data-only attack as forging the contents, not the envelope.** CFI guards the *envelope's address* — where the letter goes. A data-only attack leaves the address perfect (the letter goes exactly where it should) but rewrites the *check amount inside*. The mail system (control flow) behaves flawlessly; the payload is poisoned.

**COOP as a hostile script performed by legitimate actors.** Every actor (virtual function) is real, union-card-carrying, and reads only lines from the real script (valid vtables). But the *director* (attacker) arranges genuine lines into a play nobody sanctioned. Checking each actor's credentials (vtable CFI) never reveals the plot.

**MTE vs CFI as smoke detectors vs fire doors.** MTE is a smoke detector that alarms the instant something starts to burn (the bad memory access). CFI is a fire door that stops the blaze from spreading to the exits (control flow). You want both: detect early, contain late.

---

## Mental Models

**Model 1: CFI bounds the attacker to a *legal-looking* subset; the residual is whatever stays legal-looking.** Data-only and COOP are exactly the attacks that never leave the legal set. Internalize this and you stop expecting CFI to be a wall.

**Model 2: Forward edge has a precision ceiling; backward edge doesn't.** One correct return target ⇒ precise (shadow stack/PAC). Many type-valid call targets ⇒ bounded class, not a point. Invest accordingly.

**Model 3: Layers attack different exploit *steps*.** Bug exists → (memory safety deletes it) → corruption happens → (MTE catches it) → pointer hijacked → (CFI blocks it) → code runs → (sandbox contains it). Map each mitigation to the step it owns; gaps appear where no layer covers a step.

**Model 4: Security claims are bounded statements with a stated residual.** "Protected" is never a complete sentence. "Protected against X, residual Y, mitigated by Z, with plan W" is.

---

## Code Examples

> Architectural/illustrative. The "attack shapes" are conceptual descriptions of *what CFI misses*, not exploits.

### 1. The shape CFI cannot see (data-only)

```c
struct session {
    bool   is_admin;      // <-- non-control data
    char   name[32];      // <-- overflow source
    void (*on_close)(void);
};

void handle(struct session *s, const char *input) {
    // Suppose a bug overflows s->name into s->is_admin (data, not a pointer).
    // CFI sees NOTHING wrong: no indirect branch was redirected.
    memcpy(s->name, input, attacker_len);   // BUG

    if (s->is_admin) {                       // legitimate branch, now true
        do_privileged_thing();               // reached via 100% valid control flow
    }
    s->on_close();   // CFI *does* guard this call — but the damage is already done
}
```

The lesson: lay out security-critical *data* (flags, roles, sizes) so it isn't corruptible from adjacent buffers, validate it independently, and don't rely on CFI to notice — it can't.

### 2. Why type-based forward CFI still leaves a class

```c
typedef void (*op_t)(void);   // permissive type

void a(void); void b(void); void c(void); /* ... 200 more void(void) ... */

void run(op_t op) {
    // cfi-icall confirms `op` is *some* void(void) function.
    // It cannot confirm it's THE one intended here -> 200-member class.
    op();
}
```

Mitigation pattern: give callbacks *distinct, specific* types so each call site's class is tiny.

### 3. Measuring the overhead you're buying

```bash
# Build two variants and benchmark the hot path honestly.
$ clang -O2 -flto              app.c -o app.base
$ clang -O2 -flto -fsanitize=cfi -fcf-protection=full app.c -o app.cfi

$ hyperfine './app.base bench' './app.cfi bench'   # report the delta
```

### 4. Stating the guarantee in a threat model (the real deliverable)

```text
Mitigation:  Forward-edge CFI (LLVM cfi-icall/cfi-vcall, LTO) +
             backward-edge integrity (CET shadow stack / PAC-ret) +
             IBT/BTI landing pads + Full RELRO + PIE/ASLR.

Blocks:      Classic stack-smash-to-shellcode, ROP `ret`-chaining,
             fake-vtable hijack, GOT overwrite.

Residual:    Data-only / DOP attacks (no branch redirected),
             COOP (composition of type-valid vcalls),
             info-leak-assisted attacks, exemptions (JIT, dlsym, longjmp).

Mitigated by: ARM MTE where available, renderer/parser sandboxing,
             least privilege, and migration of the JSON/media parsers
             to Rust (tracked: SEC-1421).
```

---

## Trade-offs

| Decision | In favor | Against |
|----------|----------|---------|
| **Enable fine-grained forward CFI** | Blocks fake-vtable / type-mismatched hijacks. | LTO/ABI friction; class-precision ceiling; COOP residual. |
| **Enable hardware backward edge (CET/PAC)** | Precise, cheap, kills ROP `ret`-chains. | Hardware gating; JIT/unwinding handling. |
| **Add MTE** | Catches the *bug* before the pointer is hijacked. | ARM-only, hardware-gated, tag-exhaustion/overhead nuances. |
| **Sandbox the component** | Contains even full code execution. | Architecture cost; IPC complexity. |
| **Rewrite in a memory-safe language** | Deletes the bug class entirely. | Cost/time; FFI boundary still unsafe; not always feasible. |
| **Do nothing more, "CFI is on"** | Cheap. | Overclaims; ignores data-only/COOP/info-leak residual. |

---

## Use Cases

- **Browsers** combine fine-grained CFI, CET/PAC, ASLR, and aggressive sandboxing precisely *because* CFI alone leaves COOP/data-only residual.
- **OS kernels** layer KCFI/FineIBT with stack-protection and (increasingly) Rust components for new drivers.
- **Mobile platforms (iOS/Android)** pair PAC/BTI/MTE — the MTE complement directly attacks the bugs CFI only mitigates downstream.
- **Hypervisors/enclaves** treat CFI as one layer in a minimal-TCB strategy, not the boundary.
- **New greenfield services** skip most of this by being written in memory-safe languages, isolating unavoidable C/C++ behind a sandbox/FFI boundary.

---

## Coding Patterns

**Pattern: Protect security-critical *data* independently of CFI.** Separate role/permission/size fields from attacker-reachable buffers (separate allocations, guard pages, redundant checks, canary-style validation of the field). CFI won't notice their corruption.

**Pattern: Tighten types to shrink forward-edge classes.** Specific function-pointer signatures and sealed class hierarchies reduce the equivalence class and the COOP/vfgadget surface.

**Pattern: Budget mitigations by attack surface.** Maximum hardening on untrusted-input boundaries (parsers, IPC, network); relax in trusted internals to spend the perf/complexity budget where it matters.

**Pattern: Make exemptions explicit and audited.** Every `no_sanitize`, JIT region, and FFI boundary is a documented hole with an owner and a compensating control.

**Pattern: Pair detection with containment.** MTE/ASAN-in-prod-where-feasible for early detection; sandboxing for late containment; CFI in the middle.

---

## Best Practices

1. **Enable both edges with fine granularity** *and* state the residual — never present CFI as a memory-corruption cure.
2. **Add MTE where available**; it attacks the bug class upstream of CFI and composes powerfully with it.
3. **Sandbox the components that parse untrusted input**, so a CFI bypass yields contained capability.
4. **Drive memory-safety migration for the highest-risk C/C++** (parsers, decoders); treat CFI as the net for what remains.
5. **Audit the full link closure and every CFI exemption.** The guarantee equals the weakest linked object.
6. **Measure overhead on real hot paths** and place protection by attack surface, not uniformly.
7. **Write the threat model as bounded statements** with explicit residual and a remediation plan.

---

## Edge Cases & Pitfalls

- **"CFI is on" in a binary linking an un-instrumented library** — the un-instrumented region is a CFI-free zone; an attacker pivots there.
- **Permissive callback types** (`void(void)` everywhere) collapse forward-edge precision; the class is huge.
- **Info leaks neutralize ASLR *and* enable many CFI-adjacent attacks** — yet CFI doesn't stop leaks. Treat read primitives as first-class threats.
- **COOP satisfies vtable CFI by construction** — counting on `cfi-vcall` to stop "vtable-based" attacks misreads the threat.
- **Data-only attacks leave perfect control flow** — no mitigation on this page (including CET/PAC) will fire.
- **JIT/`dlsym`/`longjmp` exemptions** are real holes; an attacker who can influence JIT'd code or FFI targets routes around CFI.
- **Performance-driven uniform CFI** wastes budget on cold paths while under-protecting hot, untrusted ones.

---

## Common Mistakes

- Claiming CFI defeats memory-corruption exploits (it raises cost; it doesn't delete the bug class).
- Forgetting data-only/DOP and COOP exist, then being blindsided by an exploit that "shouldn't have worked."
- Leaving callback types permissive and assuming forward-edge CFI is "fine-grained."
- Trusting ASLR without acknowledging the info-leak dependency.
- Treating MTE, sandboxing, and memory safety as alternatives to CFI rather than complements.
- Letting exemptions (JIT/FFI) accumulate unaudited.

---

## Tricky Points

- **Backward-edge CFI can be precise; forward-edge cannot** — single correct return vs an equivalence class of type-valid calls. This asymmetry explains where exploits concentrate.
- **COOP is to the forward edge what ROP is to the backward edge** — both reuse *legitimate* code; CFI raised the bar but the composition freedom remains.
- **CFI changes attacker behavior more than it changes outcomes for the most capable adversaries** — it prices out the cheap attacks, redirecting effort to data-only/COOP/leaks.
- **The strongest "CFI strategy" often isn't more CFI** — it's MTE (kill the bug earlier), sandboxing (contain success), or memory safety (delete the bug).
- **Every exemption is a deliberate hole** — the security of the whole equals the security of the least-protected reachable component.

---

## Test Yourself

1. Explain the **precision ceiling** and why the forward edge has one but the backward edge (mostly) doesn't.
2. What is a **data-only attack**, and why is CFI structurally unable to detect it? Give a concrete shape.
3. What is **COOP**, and why does it satisfy fine-grained vtable CFI? What does this prove about "type-valid" enforcement?
4. Where does CFI sit relative to **MTE**, **ASLR**, **sandboxing**, and **memory-safe languages** in the exploit chain? Which step does each own?
5. Why is "we enabled CFI, so we're protected against memory corruption" wrong, and what's the correct bounded statement?
6. Why does linking one un-instrumented library undermine a CFI deployment?
7. Why might the best next investment for a CFI-hardened product be MTE or a Rust rewrite rather than tighter CFI?
8. How do **info leaks** interact with CFI and ASLR, and why are read primitives first-class threats?

> If you can answer 2, 3, 4, and 5 precisely, you can own the security narrative for a memory-unsafe codebase.

---

## Cheat Sheet

| Concept | One-liner |
|---------|-----------|
| **Precision ceiling** | CFI allows an equivalence class, rarely a single point. |
| **Forward vs backward precision** | Forward = bounded class; backward = exact (precise). |
| **Data-only attack** | Corrupt non-control data; control flow stays legal; CFI is blind. |
| **DOP** | Chain data-only corruptions into rich computation. |
| **COOP** | Compose *legitimate* type-valid vcalls; vtable CFI is satisfied. |
| **MTE** | Catch the bug at the bad access — upstream of CFI. |
| **ASLR + info leak** | Randomization undone by one disclosure; CFI doesn't stop leaks. |
| **Sandbox** | Contain even full code execution. |
| **Memory safety** | Delete the bug class; the strategic endgame. |
| **The deliverable** | "Blocks X; residual Y; mitigated by Z; plan W." |

---

## Summary

CFI is deployed broadly, yet memory-corruption exploits persist because CFI raises the *cost* of control-flow hijacking without deleting the underlying bug class — and capable attackers simply move to what CFI cannot see. The **precision ceiling** means forward-edge CFI permits an **equivalence class** of type-valid targets rather than the single correct one (the backward edge, with one correct return, can be precise — which is why shadow stacks/PAC are stronger than forward-edge CFI). Two residual classes dominate: **data-only attacks** (corrupt non-control data — flags, sizes, data pointers — leaving control flow perfectly legitimate and CFI blind, extensible to Turing-complete **DOP**) and **COOP** (compose *legitimate, type-valid* virtual calls so even fine-grained vtable CFI is satisfied — proving that enforcing each call's validity doesn't prevent a hostile composition). Deployment is gated by **performance, ABI/toolchain friction, hardware support, and the weakest linked object**, and every JIT/FFI exemption is a deliberate hole. Architecturally, CFI is one layer: **MTE** catches the bug upstream, **ASLR** hides addresses (until an info leak), **sandboxing** contains success, and **memory-safe languages** delete the bug class outright. The professional deliverable is never "we're protected" — it's a bounded statement: what's blocked, what's residual, what mitigates the residual, and the plan to close it.

---

## Further Reading

- Schuster et al., "Counterfeit Object-Oriented Programming" (COOP) — the canonical vtable-CFI-bypass paper.
- Hu et al., "Data-Oriented Programming" (DOP) — Turing-complete data-only attacks.
- Carlini et al., "Control-Flow Bending" — limits of CFI under realistic attacker models.
- Burow et al., "Control-Flow Integrity: Precision, Security, and Performance" — a comparative survey of CFI schemes.
- ARM MTE documentation and "Memory Tagging" whitepapers — the complementary upstream defense.
- Microsoft, Google Project Zero, and Apple security write-ups on real CFI-era exploits — read for *which layer failed and why*.
