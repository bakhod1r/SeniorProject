# Boxing, Tagging & NaN-Boxing — Professional Level

> **Topic:** [Boxing, Tagging & NaN-Boxing](README.md)
> **Focus:** Where the bit-tricks meet the hardware and the platform — 48- vs 57-bit virtual addressing and 5-level paging, ARM pointer authentication (PAC) and top-byte-ignore, real production encodings (SpiderMonkey, LuaJIT, JavaScriptCore, V8), and the operational reality of shipping and evolving a tagged/NaN-boxed runtime across architectures.

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
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [War Stories](#war-stories)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)
21. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **The bit-tricks assume facts about the hardware. What happens when the hardware changes those facts?**

Tagging and NaN-boxing rest on two load-bearing assumptions about the machine: that heap pointers are *aligned* (low bits zero) and that virtual addresses are *narrow* (high bits are predictable filler). Both assumptions held comfortably for the era these encodings were invented in — x86-64 and early ARM64 both expose 48-bit canonical virtual addresses, so a pointer "really" needs only 48 bits, leaving room in a tagged word or a NaN payload. A runtime engineer who treats these assumptions as eternal will, sooner or later, ship a binary that corrupts memory on a machine that breaks them.

The hardware *has* started to break them. Intel's **5-level paging** extends user virtual addresses from 48 to **57 bits**, and Linux can hand out addresses above the old 48-bit ceiling. ARMv8.3 added **pointer authentication (PAC)**, which signs pointers by stuffing a cryptographic MAC into the *high, unused* bits of an address — exactly the bits a NaN-box wanted for its tag. ARM's **top-byte-ignore (TBI)** and **memory tagging (MTE)** also colonize high pointer bits. Each of these is a direct collision with the bit budget that tagging and NaN-boxing depend on. The professional question is no longer "how do I encode a value?" but "how do I encode a value *and keep it correct across the architectures and OS configurations my runtime will actually run on*?"

This page is about that collision and the engineering around it: how production engines (V8, SpiderMonkey, LuaJIT, JavaScriptCore) actually encode values today, how they defend the 48-bit assumption (mmap hints, address-space reservation, masking strategies), how PAC and TBI change pointer handling, and the operational discipline — feature detection, fallbacks, fuzzing, and ABI stability — required to evolve a representation that the entire VM is built on without breaking the world.

In one sentence: **the spare bits aren't yours by right — the OS and the CPU are increasingly claiming the high bits of every pointer, and a production runtime must negotiate that claim explicitly or it will corrupt memory in the field.**

---

## Prerequisites

- **Required:** `senior.md` — the complete NaN-boxed value, boxing/tagging/NaN-boxing as design points, GC and JIT coupling.
- **Required:** Solid grasp of virtual memory: pages, page tables, canonical addresses, and `mmap`.
- **Required:** Familiarity with at least one production VM's value type and the cost model of memory safety bugs.
- **Helpful:** Awareness of ARMv8.3+ features (PAC), and Intel's LA57 / 5-level paging.
- **Helpful:** Experience shipping cross-architecture (x86-64 and ARM64) native code.

You do **not** need to be a hardware architect — but you must respect the boundary where your software's assumptions meet the CPU's reality.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Canonical address** | A virtual address whose top bits are a sign-extension of the highest *implemented* bit (bit 47 for 48-bit, bit 56 for 57-bit). Non-canonical addresses fault. |
| **48-bit addressing** | The classic x86-64/ARM64 scheme: bits 0–47 meaningful, bits 48–63 = copy of bit 47. |
| **5-level paging / LA57** | Intel extension raising user virtual addresses to **57 bits**; Linux can allocate above the 48-bit line (often only via explicit hint). |
| **Top-byte-ignore (TBI)** | ARM64 feature: the CPU ignores the top 8 bits of an address on dereference, letting software store a tag there. |
| **Pointer authentication (PAC)** | ARMv8.3: signs a pointer with a MAC stored in its unused high bits; `AUT*` instructions verify and strip it before use. |
| **MTE (Memory Tagging Extension)** | ARMv8.5: associates a 4-bit tag with memory granules and the matching pointer (in high bits) for memory-safety checking. |
| **Pointer compression** | Storing 32-bit base-relative offsets instead of full 64-bit pointers (V8) to halve pointer memory. |
| **Punbox / Nunbox** | SpiderMonkey's historical names: "punbox" (NaN-box, payload-in-NaN, 64-bit) vs "nunbox" (split 32-bit tag + 32-bit payload, used on 32-bit builds). |
| **EncodedJSValue** | JavaScriptCore's 64-bit value: tagged integers, "low" pointers, and *offset* doubles. |
| **TValue** | LuaJIT's 64-bit NaN-boxed value type. |
| **Address-space reservation** | Reserving (mapping `PROT_NONE`) a low address region so the allocator only ever returns pointers that fit the tag budget. |
| **ABI stability** | The guarantee that a value's bit layout doesn't change in ways that break embedders, serialized snapshots, or JIT-emitted code. |

---

## Core Concepts

### 1. The Two Load-Bearing Assumptions, Stated Precisely

Every inline encoding depends on some subset of:

1. **Alignment (low bits free):** heap objects are N-byte aligned ⇒ low log₂(N) bits of every pointer are zero. Used by pointer tagging.
2. **Narrow addresses (high bits free/predictable):** userspace pointers fit in ≤48 bits ⇒ bits 48–63 are sign-extension filler ⇒ a pointer fits in a NaN payload or a tagged high field. Used by NaN-boxing.

These are **ABI/OS guarantees**, not CPU laws. Alignment holds because *your* allocator promises it. Narrowness holds because the *OS* configures paging that way — and the OS can change it.

### 2. 5-Level Paging Breaks the High-Bit Assumption

Intel's LA57 and the corresponding Linux support extend user virtual addresses to 57 bits. A pointer can now legitimately have bits set in positions 48–56 — bits a NaN-box assumed were zero filler. If your `unbox_ptr` masks to 48 bits, a 57-bit pointer is silently truncated to a *different, wrong* address: memory corruption, not a crash you can catch.

Linux mitigates this for legacy software: by default it returns addresses *below* the 48-bit line and only hands out high addresses when the program passes an explicit `mmap` hint above `0x7fffffffffff`. So a runtime that **never requests high addresses** is usually safe today — but "usually" and "today" are exactly the words a professional distrusts. The disciplined answer is to *reserve* or *constrain* the address space the VM allocates from, so its pointers provably fit the tag budget.

### 3. ARM Pointer Authentication (PAC) Colonizes the High Bits

PAC (ARMv8.3) signs a pointer by computing a MAC over it and a context, then writing that MAC into the pointer's *unused high bits* — precisely the region NaN-boxing and high-bit tagging use. A signed pointer is not directly dereferenceable; you must `AUT*` it first to verify and strip the signature. Two consequences for a runtime:

- **You cannot store a raw PAC-signed pointer in a NaN payload** and later mask it as if the high bits were zero — they hold the signature.
- A runtime on a PAC platform must either authenticate/strip pointers *before* boxing them (storing the bare address) and re-sign on use, or carve its tag out of bits PAC doesn't touch, coordinating with the number of signature bits (which varies with the VA width — fewer address bits ⇒ more signature bits).

This is the cleanest modern example of the hardware reclaiming "your" spare bits.

### 4. Top-Byte-Ignore and MTE: More Claims on High Bits

ARM's **TBI** lets software store an 8-bit tag in the top byte of a pointer; the CPU ignores it on dereference. That *sounds* like a gift to tagging — and it is, if you control it. But **MTE** (Memory Tagging Extension) uses those same top-byte bits for hardware memory-safety tags. If your runtime stores its own tag in the top byte while MTE is active, you collide with the hardware's safety mechanism. The bits are contested resources; a professional negotiates which subsystem owns which bits, on which platform.

### 5. How Real Engines Encode Values (Production Reality)

- **LuaJIT (`TValue`):** classic NaN-boxing. Doubles are themselves; everything else lives in NaN payloads with a small itype tag in the high bits and a 47-bit pointer/payload. Mike Pall's design deliberately keeps pointers within the assumed range.
- **SpiderMonkey:** historically two schemes — **PunBox** (64-bit NaN-boxing, payload inside the NaN) and **NunBox** (32-bit builds: a separate 32-bit tag word beside a 32-bit payload). The names are an in-joke; the engineering is real.
- **JavaScriptCore (`EncodedJSValue`):** the **offset-double** ("nun-boxing"-spirit) scheme — integers carry a tag in high bits, pointers are "low" untagged values, and doubles are stored with a constant **added** so they never collide with the int/pointer/immediate ranges. This makes pointer and int access mask-free.
- **V8:** **SMI tagging** (low-bit int vs HeapObject) plus **HeapNumber** boxing for non-SMI numbers, plus **pointer compression** (32-bit base-relative references) on 64-bit builds. V8 deliberately did *not* go full NaN-boxing; it bet on tagged small ints + compressed pointers.

The lesson: there is no single industry answer. Each engine picked a point on the design space and then engineered hard around the platform assumptions that point requires.

### 6. Defending the 48-Bit Assumption in Production

A NaN-boxing runtime that must remain correct across paging configurations defends the assumption explicitly:

- **Constrain allocation.** Use `mmap` *without* high-address hints, and on Linux optionally reserve the high region so the allocator can't stray above 48 bits.
- **Assert on box.** In debug builds, assert every boxed pointer fits the payload (`(ptr & ~PAYLOAD) == 0` after sign handling). A failed assert in CI beats corruption in the field.
- **Feature-detect at startup.** Detect LA57 / PAC / TBI / MTE and either adjust masks or fall back to a safe representation (e.g., split tag, or boxing).
- **Provide a portable fallback.** Keep a NaN-boxing-free representation (tagging or boxed) compilable behind a flag for hostile platforms.

### 7. ABI Stability and Snapshots

In a mature engine, the value layout is part of an **ABI**: embedders read raw `Value`s through the C API, the JIT emits machine code that hard-codes tag masks, and some engines **serialize the heap** (V8 snapshots) with values encoded. Changing the representation therefore breaks: embedder code, cached JIT output, and serialized snapshots. This is why representation changes in shipping engines are rare, version-gated, and accompanied by migration machinery. The bit layout is not an implementation detail you can refactor freely — it's a contract with everything around it.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Spare bits aren't yours by right** | Building a shed on an easement: fine until the utility company exercises its right to the strip of land. |
| **5-level paging extends addresses** | A city expanding phone numbers from 7 to 8 digits — old systems that assumed "the 8th digit is always 0" now misdial. |
| **PAC writes a signature in high bits** | A bank now stamps a hologram across the top of every check; your old habit of writing notes there overwrites the hologram and the check bounces. |
| **TBI vs MTE contesting the top byte** | Two departments both claiming the margin of the same form for their stamps — one's stamp invalidates the other's. |
| **Address-space reservation** | Renting only the ground-floor units so every key you issue is guaranteed to be a two-digit room number that fits your keychain tags. |
| **ABI stability of the layout** | The standardized shipping-container dimensions — change them and every crane, ship, and truck in the world breaks. |
| **Feature-detect + fallback** | A car that detects leaded vs unleaded and adjusts, with a limp-home mode if the fuel is unknown. |

---

## Mental Models

### The "Contested Bit Budget" Model

Stop thinking of a pointer's high and low bits as *yours*. They are a shared budget contested by the allocator (alignment), the OS (address width), and the CPU (PAC, TBI, MTE). At any moment, each subsystem may claim some bits. A correct representation is a *negotiated allocation* of that budget on each target platform — not a fixed layout you carry everywhere. When you port, re-negotiate.

### The "Assumption Is a Liability" Model

Every "always-zero" bit your encoding relies on is a liability that comes due when the hardware fills it. Track each assumption as an explicit, testable invariant: "pointers fit in 48 bits," "low 3 bits are zero," "high byte is free." For each, know the platforms where it holds, the detection that confirms it, and the fallback when it doesn't. A representation is robust not when it's clever but when its assumptions are *enumerated, asserted, and falsifiable in CI*.

### The "Representation Is an ABI" Model

Treat the value layout the way you treat a wire format or a public API: versioned, documented, and changed only with migration. The JIT, the embedder API, and serialized snapshots are all *consumers* of the layout. You can't refactor a contract by editing one side. This mindset prevents the catastrophic "we just changed the tag bits in a minor release" incident.

---

## Code Examples

### C — Asserting the 48-bit assumption at box time (debug builds)

```c
#include <assert.h>
#include <stdint.h>

#define PAYLOAD 0x0000FFFFFFFFFFFFULL   // 48-bit
#define TAG_PTR 0xFFFC000000000000ULL   // sign + qNaN region (illustrative)

static inline uint64_t box_ptr_checked(void *p) {
    uint64_t a = (uint64_t)(uintptr_t)p;
#ifndef NDEBUG
    // If any bit above 48 is set, our NaN payload would truncate the pointer.
    assert((a & ~PAYLOAD) == 0 && "pointer exceeds 48-bit NaN-box budget");
#endif
    return TAG_PTR | (a & PAYLOAD);
}
```

A failed assert in CI is cheap; the same situation in production is silent corruption. This single guard catches 5-level-paging and high-mmap surprises before they ship.

### C — Constraining the allocator's address range (Linux)

```c
#include <sys/mman.h>
#include <stdint.h>
#include <stdio.h>

// Request memory WITHOUT a high-address hint so Linux stays below the 48-bit line.
// (Passing a hint above 0x7fffffffffff is what opts into 5-level-paging addresses.)
void *vm_map(size_t bytes) {
    void *p = mmap(NULL, bytes, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p == MAP_FAILED) return NULL;
    if (((uint64_t)(uintptr_t)p) >> 48) {
        // We got a >48-bit address anyway: refuse to NaN-box on this config.
        fprintf(stderr, "VM: high VA detected; disable NaN-boxing\n");
    }
    return p;
}
```

By never hinting a high address, the VM normally stays within budget; the check is the safety net for unusual kernel configs.

### C — Startup feature detection (sketch)

```c
#include <stdbool.h>

typedef struct {
    bool la57;   // 5-level paging (57-bit VA) in use
    bool pac;    // ARM pointer authentication available/active
    bool tbi;    // top-byte-ignore enabled
    bool mte;    // memory tagging active
} PlatformCaps;

// Detect once; choose the representation accordingly.
enum Repr { REPR_NANBOX, REPR_TAGGED, REPR_BOXED };

enum Repr choose_repr(PlatformCaps c) {
    if (c.la57 || c.pac || c.mte)
        return REPR_TAGGED;   // high bits contested → avoid NaN payload pointers
    return REPR_NANBOX;       // classic assumptions hold
}
```

Real engines bake the choice at build time for the JIT's sake, but the *principle* — detect, then pick a representation whose assumptions hold — is the professional posture.

### C — Handling PAC: strip before boxing, re-sign on use (conceptual)

```c
// On ARM PAC, a live pointer carries a signature in high bits.
// Box the BARE address; re-authenticate when you dereference.

static inline void *strip_pac(void *p) {
#if defined(__ARM_FEATURE_PAC_DEFAULT)
    __asm__("xpaci %0" : "+r"(p));   // strip data-pointer auth code
#endif
    return p;
}

static inline uint64_t box_ptr_pac(void *p) {
    void *bare = strip_pac(p);            // high bits now zero → fits payload
    return TAG_PTR | ((uint64_t)(uintptr_t)bare & PAYLOAD);
}
// On unbox you must re-sign (PACIA/AUTIA) before calling through the pointer.
```

The point isn't the exact instruction — it's that **PAC and NaN-boxing both want the high bits, so the runtime must explicitly mediate**: store bare, sign on use.

### C — A serialization/ABI guard

```c
// Embedders and snapshots depend on this layout. Version it.
#define VALUE_LAYOUT_VERSION 3

_Static_assert(VALUE_LAYOUT_VERSION == 3,
    "Value bit layout changed: bump version, migrate snapshots, "
    "recompile embedders and JIT code caches.");
```

A loud, compile-time reminder that the layout is a contract, not a free variable.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **NaN-boxing in production** | Native floats, dense values; proven in LuaJIT/SpiderMonkey/JSC. | Fragile under LA57/PAC/TBI/MTE; needs active defense of the 48-bit budget. |
| **Tagging + pointer compression (V8)** | Portable assumptions (alignment only); compressed pointers save memory. | Reduced int range; compression caps heap size; more decode in JIT. |
| **Address-space reservation** | Guarantees pointers fit the tag budget. | Reserves VA up front; interacts with ASLR and embedder expectations. |
| **Feature detection + fallback** | Correct across hostile platforms. | Multiple code paths to test; JIT may need per-platform builds. |
| **Treating layout as ABI** | Stable embedders, snapshots, JIT caches. | Representation becomes hard to evolve; changes need migration. |
| **PAC/TBI/MTE coexistence** | Hardware memory-safety on top of the VM. | Direct contention for the high bits the encoding wants. |

---

## Use Cases

- **Shipping a JS/Lua/dynamic runtime on Apple Silicon and Graviton:** you *will* meet PAC and ARM64 address layouts; the representation must coexist with them.
- **Targeting servers with 5-level paging enabled:** large-memory hosts may run LA57; a NaN-boxing VM must reserve/constrain its address space or fall back.
- **Embedding a VM in a larger native app:** the host's pointers, ASLR, and sandbox may violate your alignment/width assumptions — defend the boundary.
- **Long-lived engines with snapshots and a stable C API:** the layout is an ABI; evolution requires versioning and migration, not refactoring.

When the platform is fixed and friendly (a controlled appliance on known x86-64 with 4-level paging), the classic encodings are safe and you can spend your effort elsewhere — but document the assumption so a future port doesn't inherit a silent landmine.

---

## Coding Patterns

### Pattern 1: Enumerate and assert every assumption

```c
_Static_assert(sizeof(void *) == 8, "64-bit only");
#ifndef NDEBUG
  assert((ptr & ~PAYLOAD) == 0);   // 48-bit budget
  assert((heap_obj & 0x7) == 0);   // alignment
#endif
```

### Pattern 2: Detect-then-choose at startup (or build time)

```c
enum Repr r = choose_repr(detect_platform_caps());
```

### Pattern 3: Store bare pointers; sign/tag on the boundary

```c
Value box   = TAG_PTR | (strip_high_bits(p) & PAYLOAD);
void *live  = reauth(unbox_payload(box));   // re-sign before deref on PAC
```

### Pattern 4: Reserve the address space the tag budget allows

```c
// Reserve low VA so the allocator's pointers provably fit the payload.
reserve_low_address_space(BUDGET_BYTES);
```

### Pattern 5: Version the layout; gate changes behind migration

```c
#define VALUE_LAYOUT_VERSION 3   // bump → migrate snapshots + recompile embedders
```

---

## Best Practices

- **Treat alignment and address-width as *guarantees you must enforce*, not facts you may assume.** Constrain the allocator; assert on box; detect the platform.
- **Default to the most portable representation that meets your perf bar.** Tagging (alignment-only) ports more safely than NaN-boxing (address-width-dependent). V8's choice is instructive.
- **Coexist with PAC/TBI/MTE deliberately.** Decide, per platform, which bits the hardware owns and which you own; strip/re-sign pointers at the boxing boundary.
- **Make the layout an ABI artifact.** Version it, document the masks in one place, and gate changes behind snapshot migration and embedder/JIT recompilation.
- **Fuzz across configurations.** Round-trip random doubles/ints/pointers/immediates, *including* high addresses and signaling NaNs, on each target.
- **Keep a fallback representation compilable.** A flag that switches NaN-boxing off to tagging/boxing is cheap insurance for a hostile new platform.
- **Measure the real cost on real silicon.** PAC stripping, masking, and decompression have measurable cost on ARM; don't assume the x86 cost model transfers.

---

## Edge Cases & Pitfalls

- **A pointer above the 48-bit line silently truncates.** No fault, no crash — a *different* valid-looking address. The worst class of bug: silent corruption.
- **PAC-signed pointers stored raw.** Masking a signed pointer to 48 bits destroys the address *and* the signature; dereferencing the result faults or corrupts.
- **MTE collides with a top-byte software tag.** If you store a tag in the top byte while MTE is enabled, the hardware's tag check fails or your tag is clobbered.
- **`mmap` hint accidentally opting into high addresses.** Passing a hint above the 48-bit line on Linux can hand you a 57-bit pointer you can't box.
- **ASLR / sandbox placing the heap high.** Some sandboxes deliberately use high VA; your VM's pointers then don't fit the budget.
- **Snapshot loaded by a binary with a different layout version.** A serialized value decoded under the wrong masks is corruption from the first access.
- **JIT code cache outliving a layout change.** Cached machine code hard-codes the old masks; running it after an upgrade is undefined.
- **Pointer compression base mismatch.** A compressed pointer is meaningless without its base; cross-process or cross-heap mixing corrupts.

---

## Common Mistakes

1. **Assuming "48-bit pointers" is a CPU law.** It's an OS/ABI configuration that LA57 and sandboxes break.
2. **Masking PAC-signed pointers as if the high bits were free.** Destroys both address and signature.
3. **Storing a software tag in the top byte without checking for MTE.** Hardware/software tag collision.
4. **Shipping NaN-boxing with no high-address assertion or allocator constraint.** The latent corruption waits for the wrong host.
5. **Treating the value layout as a private implementation detail.** It's an ABI consumed by embedders, snapshots, and the JIT.
6. **Porting the x86 representation to ARM unchanged.** Different address features; the bit budget differs.
7. **No fallback representation.** When a new platform breaks your assumptions, you have no safe mode to ship.
8. **Skipping cross-config fuzzing.** The bugs live exactly in the configurations your dev machine doesn't run.

---

## Tricky Points

- **"It works on my machine" is maximally dangerous here.** Your laptop runs 4-level paging, maybe no PAC; the corruption appears only on the host that breaks an assumption. The absence of a crash proves nothing.
- **The high bits are a moving target.** Each CPU generation may claim more of them (PAC width grows as VA width shrinks; MTE arrives; LA57 spreads). A representation safe today may be unsafe on next year's silicon.
- **Pointer compression is a different answer to the same pressure.** V8 sidesteps NaN-boxing's address-width fragility by storing 32-bit base-relative pointers — trading max heap size for portability and density. There's more than one way to spend the budget.
- **TBI is both gift and trap.** It legitimizes a software top-byte tag — until MTE wants the same byte. A feature that helps tagging on one ARM config breaks it on another.
- **The fallback path is rarely exercised, so it rots.** Keep the non-NaN-boxing representation *building and tested in CI*, or it won't actually work the day you need it.
- **Snapshots freeze the representation in serialized form.** You can change the live layout but old snapshots still carry the old encoding; migration, not refactoring, is the tool.

---

## War Stories

- **The high-mmap truncation.** A runtime NaN-boxed pointers masked to 48 bits and ran fine for years. A customer enabled 5-level paging on a large-memory host; the allocator returned a 49-bit address, the mask silently dropped bit 48, and the VM began reading a *different valid object*. The crash (when it finally came) pointed nowhere near the cause. Fix: assert the 48-bit budget on box (caught it instantly in CI) and stop hinting high addresses.
- **PAC on Apple Silicon.** A VM ported to arm64e stored signed pointers in NaN payloads and masked them on unbox. The masked value lost the signature; the next indirect call faulted. The fix was to strip authentication (`xpaci`) before boxing and re-sign on use — making the representation store *bare* addresses.
- **The minor-version layout change.** An engine "optimized" its immediate tag numbering in a point release. Embedders compiled against the old C API began misreading `true`/`null`; serialized snapshots from the prior version decoded as garbage. The lesson, learned expensively: the value layout is an ABI; bump a version and migrate, never quietly retune.
- **TBI vs MTE.** A team used ARM top-byte-ignore to stash a 1-byte type tag — elegant and fast. Enabling MTE for memory-safety in a later build clobbered that byte on every tagged store. They had to relocate their tag out of the MTE-owned byte and feature-gate the whole scheme.

---

## Test Yourself

1. Why is "userspace pointers are 48 bits" an OS/ABI guarantee rather than a CPU guarantee? Name two ways it can be broken.
2. A NaN-boxing VM masks pointers to 48 bits. Walk through exactly what goes wrong when the allocator returns a 49-bit address. Why is this worse than a crash?
3. ARM PAC stores a signature in a pointer's high bits. Why can't you NaN-box a signed pointer directly, and what's the correct boxing protocol?
4. Contrast TBI and MTE with respect to the top byte of a pointer. Why is a software top-byte tag safe under one and unsafe under the other?
5. How does V8's choice (SMI tagging + pointer compression) avoid the address-width fragility that NaN-boxing has? What does it trade away?
6. You must change the immediate tag encoding in a shipping engine with a C API and heap snapshots. List everything that breaks and the migration steps.
7. Write the startup logic that detects LA57/PAC and falls back from NaN-boxing to tagging. What must also change in the JIT for the fallback to be real?
8. Why must the non-NaN-boxing fallback representation be continuously built and tested in CI, not just kept "available"?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│      REPRESENTATION MEETS HARDWARE/PLATFORM (PROFESSIONAL)       │
├──────────────────────────────────────────────────────────────────┤
│ LOAD-BEARING ASSUMPTIONS (enforce, don't assume):                │
│   alignment  → low bits free (tagging)                           │
│   narrow VA  → high bits free (NaN-boxing); 48-bit ≈ filler       │
├──────────────────────────────────────────────────────────────────┤
│ HARDWARE THAT CLAIMS THE BITS:                                   │
│   LA57 / 5-level paging → 57-bit VA; high bits now real           │
│   ARM PAC               → signature in high bits                  │
│   ARM TBI               → top byte = software tag (gift)          │
│   ARM MTE               → top-byte granule tag (collides w/ TBI)  │
├──────────────────────────────────────────────────────────────────┤
│ PRODUCTION ENCODINGS:                                            │
│   LuaJIT TValue        → classic NaN-box                          │
│   SpiderMonkey         → PunBox (NaN, 64b) / NunBox (split, 32b)  │
│   JavaScriptCore       → EncodedJSValue (offset doubles)          │
│   V8                   → SMI tag + HeapNumber + ptr compression   │
├──────────────────────────────────────────────────────────────────┤
│ DEFENSES:                                                        │
│   assert ptr fits payload on box (CI catches it)                 │
│   don't hint high mmap addresses; reserve low VA                 │
│   detect LA57/PAC/TBI/MTE → choose repr; keep a fallback          │
│   strip PAC → box bare → re-sign on use                          │
│   version the layout = ABI (embedders, snapshots, JIT caches)    │
├──────────────────────────────────────────────────────────────────┤
│ WORST BUG: high-bit truncation → silent memory corruption        │
│ "works on my machine" proves nothing — test hostile configs      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Tagging and NaN-boxing rest on two **load-bearing assumptions**: aligned pointers (low bits free) and narrow addresses (high bits predictable filler, ≈48 bits). These are **OS/ABI guarantees you must enforce**, not CPU laws.
- The hardware is reclaiming the bits. **5-level paging (LA57)** extends user VAs to 57 bits; **ARM PAC** writes a signature into a pointer's high bits; **TBI** lets software tag the top byte while **MTE** claims that same byte for hardware memory-safety. Each collides with the encoding's bit budget.
- The signature failure mode is **silent truncation**: a >48-bit pointer masked to 48 bits becomes a *different valid address* — corruption with no crash at the scene. Assert the budget on box and constrain the allocator (no high-address mmap hints; reserve low VA).
- **PAC** requires a protocol: strip the signature, box the *bare* address, re-sign before dereference. You cannot mask a signed pointer as if its high bits were free.
- Production engines chose **different points**: LuaJIT (classic NaN-box), SpiderMonkey (PunBox/NunBox), JavaScriptCore (offset-double `EncodedJSValue`), and V8 (SMI tagging + HeapNumber + **pointer compression**, deliberately avoiding NaN-boxing's address fragility).
- The defense kit: **enumerate and assert** every assumption, **detect platform features** at startup/build and **choose a representation whose assumptions hold**, keep a **portable fallback** building in CI, and **fuzz across configurations** (high addresses, signaling NaNs, PAC).
- The value layout is an **ABI**, consumed by embedders, heap snapshots, and JIT code caches. Evolve it with **versioning and migration**, never silent retuning. The professional posture: the spare bits aren't yours by right — negotiate the contested bit budget explicitly on every platform you ship to.

---

## Further Reading

- *Intel SDM* and the Linux `Documentation/x86/x86_64/5level-paging.rst` — LA57 and the high-address opt-in behavior.
- *ARM Architecture Reference Manual* — Pointer Authentication (PAC), Top-Byte-Ignore (TBI), and Memory Tagging Extension (MTE).
- *LuaJIT source & Mike Pall's mailing-list posts* — the `TValue` NaN-boxing design and its assumptions.
- *SpiderMonkey* — `Value.h` and the PunBox/NunBox history; the "NaN-boxing" SpiderMonkey internals docs.
- *JavaScriptCore* — `JSCJSValue.h` / `EncodedJSValue` and "Speculation in JavaScriptCore."
- *V8 blog* — "Pointer Compression in V8" and SMI/HeapNumber representation.
- *"What is PAC and how does it affect runtimes?"* — Apple's arm64e and pointer authentication developer documentation.
- *The Garbage Collection Handbook* — Jones, Hosking, Moss: representation/GC coupling under moving collection.

---

## Related Topics

- This folder: [`junior.md`](junior.md), [`middle.md`](middle.md), [`senior.md`](senior.md), [`interview.md`](interview.md), [`tasks.md`](tasks.md).
- Sibling topics: IEEE-754 floating-point representation and integer representation under `data-representation-and-numerics/`.
- Cross-cutting: virtual memory and paging, CPU architecture features, garbage collection, and JIT/VM design under `language-internals/` and the CPU-architecture topics.

---

## Diagrams & Visual Aids

### The Contested Bit Budget of a 64-bit Pointer

```text
 63                        57 56        48 47                          0
┌────────────────────────────┬────────────┬─────────────────────────────┐
│  PAC signature / MTE tag    │ LA57 extra │   classic 48-bit address    │
│  (ARM claims these)         │ (LA57 uses)│   (always meaningful)       │
└────────────────────────────┴────────────┴─────────────────────────────┘
   NaN-boxing WANTED all the bits above 48 for its tag/filler assumption.
   Hardware increasingly OWNS them. → negotiate per platform.
```

### Silent Truncation (the worst bug)

```text
allocator returns:  0x0001_7FFE_C0DE_1000   (49-bit address, LA57 host)
NaN-box masks 48:   0x0000_7FFE_C0DE_1000   ← bit 48 dropped!
                            │
                    points at a DIFFERENT valid object
                            │
                    reads/writes succeed → corruption, no crash here
```

### PAC Boxing Protocol

```text
live signed ptr ──xpaci──▶ bare addr ──mask 48──▶ NaN-box value
                                                       │
 on use:  unbox payload ──pacia/autia──▶ re-signed ptr ──deref──▶ object
```

### Production Engines on the Design Map

```text
                inline-int fast    inline-float fast    ptr-bit fragility
LuaJIT  (NaN)        via payload         YES                  HIGH
SpiderMonkey(Pun)    via payload         YES                  HIGH
JSC (offset-dbl)     YES (tagged)        offset add           MEDIUM
V8 (SMI+compress)    YES (SMI)           boxed HeapNumber     LOW (alignment only)
```

### Defense-in-Depth Checklist Flow

```text
detect caps (LA57/PAC/TBI/MTE)
        │
   assumptions hold? ──no──▶ fall back to tagging/boxing (tested in CI)
        │yes
   constrain allocator (no high mmap hint) + reserve low VA
        │
   assert ptr fits payload on every box (debug/CI)
        │
   version the layout as an ABI (embedders / snapshots / JIT caches)
```
