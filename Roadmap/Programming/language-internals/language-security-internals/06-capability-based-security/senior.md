# Capability-Based Security — Senior Level

> **Topic:** [Capability-Based Security](README.md)
> **Focus:** Where capabilities are actually enforced — capability OS kernels (seL4/KeyKOS/EROS, Fuchsia), object-capability languages (E, SES/Compartments, Pony, Newspeak), WASI, and the membrane/macaroon machinery that makes the model hold under real adversaries.

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
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Enforcement.** At junior/middle, "no ambient authority" was a discipline; here it is a property a *kernel*, a *language realm*, or a *WASM host* enforces, and we examine the machinery that makes it sound.

Capability discipline by convention is only as strong as the most careless `import os` in your codebase. The senior question is: **what enforces it?** The answer comes from three families that each remove ambient authority at a different layer:

1. **Capability operating systems** put unforgeable capabilities in the *kernel*. A process literally has no way to name a resource except through a kernel-managed capability slot — there is no `open("/path")` syscall that consults a global namespace. KeyKOS, EROS/CapROS, **seL4** (formally verified), and Fuchsia's Zircon (handles) live here.
2. **Object-capability languages and realms** remove ambient authority at the *language* level. A program's code is denied the powerful globals (`fs`, `net`, even `Date.now`) unless explicitly endowed. E, Joe-E, Pony's capability-secure type system, Newspeak, and **SES (Secure ECMAScript) / `Compartment`** in JavaScript live here.
3. **Sandbox ABIs** like **WASI** make capabilities the *interface contract*: a WebAssembly module gets no ambient filesystem; the host must *preopen* and hand it a directory capability, or the module cannot touch the disk at all.

Across all three, the same machinery recurs: capability *derivation* (mint a weaker child from a parent), the **membrane** (a transitive, revocable boundary), and, for distributed/token settings, **macaroons** (capabilities you can attenuate with caveats offline). This page is about how those work and where they break.

---

## Prerequisites

- **Required:** Middle level — the three ocap rules, facets, caretakers, attenuation/amplification, the powerbox, retrofitting.
- **Required:** Working knowledge of OS concepts: processes, address spaces, syscalls, virtual memory, IPC.
- **Required:** Comfort reading two or three languages and basic type-system vocabulary (reference types, capabilities-as-types).
- **Helpful:** Exposure to microkernels (Mach, L4), to WebAssembly, and to token-based auth (JWT/OAuth) for the macaroon comparison.
- **Helpful:** A feel for formal verification at the level of "what does it mean to *prove* a kernel correct."

You do **not** yet need:

- Hardware capability machines (CHERI) and ABI-level retrofits at scale — that's `professional.md`.
- Organizational rollout, migration economics, and the ACL-vs-capability adoption analysis — `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Capability (kernel)** | An opaque, kernel-protected reference to a kernel object (a thread, an endpoint, a page, a fault handler). Lives in a per-process **capability space (CSpace)**; userspace names it by an index it cannot forge into a different object. |
| **CSpace / CNode** | The per-process table(s) of capability slots in seL4. A process can only invoke objects it has slots for. |
| **Capability derivation** | Minting a child capability from a parent, usually with *reduced* rights (e.g., read-only, badged). Tracked in a derivation tree so revocation can sweep descendants. |
| **Badge** | A kernel-attached, unforgeable tag on a capability (seL4 endpoints) so the receiver can distinguish *which* client invoked it — identity without ambient identity. |
| **Endpoint** | An seL4 IPC rendezvous object; holding a capability to it grants the right to send/receive messages — the unit of inter-component authority. |
| **Handle (Zircon/Fuchsia)** | Fuchsia's userspace name for a kernel object capability, with rights bits; the *only* way to act on kernel objects. No ambient global namespace. |
| **Membrane** | A *transitive*, revocable boundary: a wrapper that, whenever an object passes through it (as argument or return), wraps *that* object too, so an entire object subgraph is revoked atomically. The generalization of the caretaker. |
| **SES (Secure ECMAScript)** | A frozen, ambient-authority-free subset/runtime of JavaScript; `Compartment` evaluates code in a realm with only the endowments you pass. |
| **Realm / Compartment** | An isolated set of JS intrinsics and globals; a Compartment is a realm you populate with exactly the capabilities a guest may use. |
| **Reference capability (Pony)** | Pony's six type qualifiers (`iso`, `val`, `ref`, `box`, `trn`, `tag`) that the compiler uses to make data-race-free *and* capability-secure sharing statically checked. |
| **Macaroon** | A bearer token built from an HMAC chain so that *anyone* holding it can append **caveats** (restrictions) offline, producing a strictly-attenuated token, without contacting the issuer. |
| **Caveat** | A restriction embedded in a macaroon ("expires before T", "only this object", "only from this IP", or a *third-party* caveat requiring a discharge proof). |
| **Confinement (formal)** | The provable property that a subject cannot exercise or transmit authority beyond its initial capabilities. |

---

## Core Concepts

### 1. Capabilities in the Kernel: seL4 as the Reference Design

In seL4 there is no ambient anything. Every action — sending a message, mapping a page, starting a thread — is the **invocation of a capability** the process holds in its CSpace. There is no `open("/etc/passwd")`; there is no global file namespace at all. A driver can touch a device register only if it holds the capability to that frame of physical memory. The kernel's entire job is to be the unforgeable, mediated translation from "slot index in this process's CSpace" to "kernel object + rights."

Three properties make this powerful:

- **No ambient authority, enforced by hardware + kernel.** Userspace cannot fabricate a capability; it can only invoke, copy (with `CNode_Copy`), mint a weaker child (`CNode_Mint`, adding a badge or reducing rights), or delete one.
- **Derivation tree + `Revoke`.** Capabilities form a tree (parent → minted children). `seL4_CNode_Revoke` on a capability deletes the entire subtree of descendants. This is membrane-style revocation, in the kernel, in bounded time.
- **Formal verification.** seL4's C implementation is proven to refine an abstract spec, and the spec is proven to enforce **integrity** and **authority confinement** — i.e., the math says a subject cannot gain authority it wasn't given. This is only tractable *because* the model is capabilities: the security policy is "the capabilities you hold," which is small enough to reason about formally. An ACL system's ambient authority is far harder to prove anything about.

KeyKOS and EROS/CapROS are the lineage seL4 descends from: persistent, capability-based, with the same "everything is a capability invocation" stance and the same confinement guarantees (EROS proved its confinement mechanism). Fuchsia/Zircon carries the idea into a shipping consumer OS: every kernel object is named by a **handle** with **rights** bits, handles are transferred over channels, and there is no ambient filesystem — a component's namespace is exactly the handles it was given at launch by its parent (a powerbox-style model at the OS level).

### 2. Capabilities in the Language: Removing Ambient Globals

A capability OS confines *processes*. An object-capability *language* confines *modules within a process* — finer grained, and the right tool for plugin systems and supply-chain defense.

The enabling trick is always the same: **deny the guest the ambient globals.** Ordinary languages hand every line of code `fs`, `net`, `process.env`, `Date.now()`, `Math.random()` — all ambient authority and all nondeterminism. An ocap language/runtime *withholds* them and forces endowment:

- **E** (Miller et al.) was designed from scratch with no ambient authority: capabilities are object references, distributed objects communicate by eventual-send, and the powerbox pattern originates here.
- **Joe-E** is a verified, ambient-authority-free subset of Java: it removes `static` mutable state, `java.io.File` (ambient), reflection, and `finalize`, leaving a language where the heap reference graph *is* the authority graph.
- **SES / Compartments (JavaScript).** SES (now shipping as Hardened JavaScript in Agoric/Endo, and the basis for the TC39 Compartments proposal) *freezes* the primordials (so guest code can't mutate `Array.prototype` to attack the host) and runs guest code in a `Compartment` whose globals contain only what you endow. A guest in a Compartment with no `fetch` simply cannot do network I/O. This is the practical, deployable form of language-level ocap today.
- **Pony** bakes capabilities into the *type system*: its reference capabilities (`iso`, `val`, `ref`, `box`, `trn`, `tag`) statically guarantee that shared data is either immutable or uniquely owned, giving data-race freedom *and* a foundation for object-capability security at compile time.
- **Newspeak** has no global namespace at all — even class names are not ambient; modules receive their dependencies through a *module manifest*, making it ocap by construction.

The common thread: the **absence of ambient globals is the security mechanism.** Everything else (endowment, membranes) is plumbing on top of that absence.

### 3. WASI: Capabilities as the Sandbox Contract

WebAssembly's core has no I/O at all — by design. **WASI (the WebAssembly System Interface)** gives a module I/O, but on a **capability basis**: there is no `open("/etc/passwd")`. A module receives **preopened** file descriptors from the host (e.g., the runtime is told `--dir /sandbox`), and the module's `path_open` can only resolve paths *relative to a directory capability it already holds*. No preopen, no filesystem. The same applies to sockets, clocks, and randomness — each is an explicitly granted capability, not ambient.

This is the cleanest mainstream example of the model: WASI didn't *add* a sandbox to an ambient system; it started from *zero authority* and made every grant explicit. A compromised or malicious WASM module that was handed only `/sandbox` cannot exfiltrate over the network, because it holds no socket capability — full stop. That is structural supply-chain defense, which is precisely why WASI is attractive for plugin runtimes and edge compute.

### 4. The Membrane: Transitive, Revocable Boundaries

A caretaker (middle level) revokes *one* object. But objects hand out other objects: an account returns a transaction, which returns a ledger entry. Revoking the account doesn't revoke the objects it already vended. The **membrane** fixes this. A membrane is a wrapper with one extra rule: **whenever a wrapped object passes a reference across the membrane (as an argument *in* or a return value *out*), that reference is automatically wrapped by the same membrane.** So the *entire object subgraph* reachable through the membrane is mediated by it, and flipping the membrane's single revocation switch severs *all* of it atomically. This is the in-language analog of seL4's `Revoke` over a derivation subtree, and it is the correct tool for sandboxing a stateful object graph you must later cut off whole.

### 5. Macaroons: Attenuable Bearer Capabilities for Distributed Systems

Across a network, capabilities are bearer tokens. A plain signed token is a *fixed* capability: you can't make it narrower without asking the issuer to mint a new one. **Macaroons** (Google, 2014) make tokens *attenuable offline*. A macaroon is an HMAC chain: the issuer signs an empty token with a secret; to add a **caveat** (a restriction like `expires < T` or `object = 42`), *anyone* re-HMACs the current signature using the caveat text as the key. Because HMAC is one-way, you can only ever *add* caveats — never remove them — so derived macaroons are **strictly weaker**. The verifier re-runs the chain with the root secret and checks every caveat.

This gives capability properties to tokens: **attenuation by any holder, offline, with no issuer round-trip**; **delegation** (hand the attenuated macaroon onward); and even **third-party caveats** ("valid only if you also present a discharge macaroon from the auth service proving the user is an admin"), which compose authority across services without a central session store. Macaroons are the distributed-systems realization of the same "attenuate-and-delegate" algebra you saw with facets — and a clean answer to "OAuth scopes are too coarse and can't be narrowed by the client."

### 6. Why Mainstream OSes Stayed ACL-Based

If capabilities are this good, why is your laptop ACL-based? History and friction:

- **The Unix model won** on simplicity and the `everything-is-a-path` global namespace, which is *ambient by design* and deeply baked into every program, library, and shell idiom.
- **Audit-by-identity** ("who did this?") maps naturally to ACLs and is what compliance regimes ask for; capabilities answer "what was held," which is harder to retrofit onto identity-centric tooling.
- **Retrofitting is invasive.** Going capability-secure means *every* program must receive its authority instead of reaching for it — an ecosystem-wide rewrite. Pure capability OSes (KeyKOS, EROS) never reached the application gravity Unix had.
- **The compromise** — and where the field is actually moving — is *capability islands inside ambient systems*: file descriptors (already capabilities), `pledge`/`unveil` on OpenBSD, `capsicum` on FreeBSD (Capsicum turns an ambient process into a capability one with `cap_enter`), Linux `seccomp` + `landlock`, WASI sandboxes, and SES compartments. You don't convert the OS; you convert the *trust-sensitive component*.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **seL4 CSpace** | A keyring where the kernel is the only locksmith; you can copy or grind-down keys but never forge a new one. |
| **Capability derivation tree** | A master key from which sub-master and individual keys are cut; rekeying the master invalidates everything cut from it. |
| **Badge** | A serial number laser-etched into a key so the lock records *which* key opened it. |
| **Membrane** | A quarantine zone: anything that touches anything inside also becomes quarantined, and you can lift the whole zone at once. |
| **WASI preopen** | A workshop with no doors to the outside; the only access is the one supply hatch the foreman opened for you. |
| **Macaroon** | A travel visa you can voluntarily stamp with extra restrictions ("transit only, expires Friday") that no later holder can erase. |
| **Third-party caveat** | A visa that's valid only if you *also* carry a letter from a second consulate. |
| **Compartment** | A film set: the actors (guest code) have only the props (endowments) the director placed there; the rest of the studio doesn't exist for them. |

---

## Mental Models

### The "Three Layers of Enforcement" Model

Ambient authority can be removed at the **kernel** (seL4/Zircon — confines processes), the **language runtime** (SES/Joe-E/Pony — confines modules), or the **sandbox ABI** (WASI — confines a guest binary). Pick the layer that matches your trust boundary: untrusted *binaries* → WASI; untrusted *modules in your process* → a Compartment; untrusted *services/drivers* → a capability microkernel. The model is identical at every layer; only the unit of confinement and the enforcement mechanism change.

### The "Membrane Is Revocation That Spreads" Model

A caretaker cuts one wire. A membrane cuts a wire *and* every wire that ever passed through it. When you must revoke a *stateful object graph* (a whole plugin's view of your domain objects), reach for a membrane, because the objects you're worried about are the ones the plugin will obtain *later*, transitively — and only a membrane catches those.

### The "Attenuate Without Asking the Issuer" Model (macaroons)

The mental shift macaroons demand: the *holder* attenuates, *offline*, and the result is unforgeably weaker. Stop thinking of a token as a fixed grant you must return to the issuer to narrow. Think of it as a capability the client can voluntarily shrink before delegating — the HMAC chain makes "shrink-only" a cryptographic law. This is what lets you hand a cache server a macaroon scoped to one key with a 30-second expiry, derived client-side from your broad token.

---

## Code Examples

### SES / Compartment: Endow Exactly What a Guest May Reach (JavaScript)

```js
import 'ses';
lockdown();   // freeze primordials: guest can't mutate Array.prototype etc.

// A guest module with NO ambient authority:
const compartment = new Compartment({
  // endowments — the guest's ENTIRE reachable world:
  log: (msg) => console.log('[guest]', msg),
  readConfig: () => structuredClone(CONFIG),   // attenuated, copy-out
  // deliberately ABSENT: fetch, fs, process, Date, Math.random
});

compartment.evaluate(`
  log('hi');                 // works: endowed
  readConfig();              // works: endowed (read-only copy)
  // fetch('https://evil');  // ReferenceError: fetch is not defined
  // process.env.SECRET;     // ReferenceError: process is not defined
`);
// The guest cannot phone home or read the environment: those names don't exist here.
```

### A Membrane (transitive revocation) — the shape

```js
function makeMembrane(target) {
  let enabled = true;
  const wrapped = new WeakMap();

  function wrap(obj) {
    if (Object(obj) !== obj) return obj;          // primitives pass through
    if (wrapped.has(obj)) return wrapped.get(obj);
    const proxy = new Proxy(obj, {
      get(t, p) {
        if (!enabled) throw new Error('revoked');
        return wrap(t[p]);                        // wrap returned objects too
      },
      apply(t, thisArg, args) {
        if (!enabled) throw new Error('revoked');
        return wrap(t(...args.map(wrap)));         // wrap args in, result out
      },
    });
    wrapped.set(obj, proxy);
    return proxy;
  }

  return { facet: wrap(target), revoke: () => { enabled = false; } };
}
// revoke() severs the WHOLE subgraph the guest reached through `facet`, at once.
```

### Macaroon: Attenuate Offline (Python, conceptual)

```python
import hmac, hashlib

def macaroon(root_key, identifier, caveats):
    sig = hmac.new(root_key, identifier.encode(), hashlib.sha256).digest()
    for c in caveats:
        sig = hmac.new(sig, c.encode(), hashlib.sha256).digest()  # chain
    return identifier, caveats, sig

# Issuer mints a broad macaroon:
id_, cav, sig = macaroon(ROOT, "user=alice", [])

# A CLIENT attenuates it OFFLINE — no issuer round-trip — by adding caveats:
cav2 = cav + ["object = 42", "time < 1719300000"]
sig2 = sig
for c in ["object = 42", "time < 1719300000"]:
    sig2 = hmac.new(sig2, c.encode(), hashlib.sha256).digest()
# (id_, cav2, sig2) is STRICTLY weaker. The client cannot REMOVE a caveat:
# HMAC is one-way, so it can't recover an earlier signature in the chain.

# Verifier re-derives from ROOT and checks every caveat holds.
```

### seL4-style Capability Invocation (C, conceptual)

```c
// No open("/path"). To send on an endpoint, you INVOKE a capability slot:
seL4_MessageInfo_t msg = seL4_MessageInfo_new(0, 0, 0, 1);
seL4_SetMR(0, request);
seL4_Call(EP_CAP_SLOT, msg);     // EP_CAP_SLOT indexes THIS process's CSpace

// Mint a WEAKER, badged child capability for a client to call us back:
seL4_CNode_Mint(dest_cnode, dest_slot, depth,
                src_cnode, ep_slot, depth,
                seL4_AllRights, client_badge);   // attenuated + identified

// Revoke the whole derivation subtree (membrane-in-the-kernel):
seL4_CNode_Revoke(root_cnode, ep_slot, depth);
```

### Capsicum: Turn an Ambient Process Capability-Secure (FreeBSD, C)

```c
int dir = open("/sandbox", O_DIRECTORY);   // acquire authority FIRST
cap_enter();                               // CROSS THE LINE: now in capability mode
// After cap_enter(): open("/etc/passwd") FAILS — no ambient namespace.
// You may only use fds you already hold (and *at fds derived from `dir`):
int f = openat(dir, "data.txt", O_RDONLY); // relative to the held directory cap
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Kernel enforcement (seL4)** | Ambient authority impossible; confinement *formally proven*; tiny TCB. | Whole-OS rewrite; no ambient `path` ecosystem; specialized. |
| **Language realms (SES)** | Module-grain confinement inside one process; deployable today; great for plugins/supply-chain. | Must freeze primordials; guest nondeterminism removed can break code expecting `Date`/`Math.random`. |
| **WASI** | Zero-authority default; explicit grants; strong supply-chain story; portable. | Younger ecosystem; preopen model differs from POSIX expectations; some APIs still maturing. |
| **Membranes** | Transitive, atomic revocation of an object graph. | Proxy overhead on every crossing; breaks object identity; subtle to implement correctly. |
| **Macaroons** | Offline client-side attenuation; third-party caveats compose cross-service auth; no session store. | Bearer secrets (theft = authority); root-key compromise = total; tooling less ubiquitous than JWT. |
| **Capsicum/pledge/landlock** | Capability islands inside Unix without rewriting the OS. | Per-process opt-in; one un-sandboxed path leaves ambient authority. |

---

## Use Cases

- **High-assurance / safety-critical systems.** seL4 in avionics, automotive, defense, secure phones — where you need a *proof*, not a test suite, that components can't exceed their authority.
- **Plugin and edge runtimes.** WASI/Compartments for running untrusted third-party code (Shopify Functions, Fastly/Cloudflare-style edge, Figma plugins-style sandboxes) with structural confinement.
- **Supply-chain hardening.** SES lockdown so a compromised npm transitive dependency in a Compartment can't reach the network or filesystem it was never endowed.
- **Fine-grained, offline-attenuable auth.** Macaroons where a client must derive a tightly-scoped, short-lived token from a broad one without an issuer round-trip (storage gateways, internal service meshes).
- **Driver / service isolation.** Fuchsia-style handle-based component sandboxing where a driver holds only the MMIO and IRQ capabilities for its device.

---

## Coding Patterns

### Pattern 1: Lockdown then compartmentalize (SES)

```js
lockdown();
const guest = new Compartment({ /* only the endowments this guest needs */ });
guest.evaluate(untrustedSource);
```

### Pattern 2: Membrane around a vended object graph

```js
const { facet, revoke } = makeMembrane(domainRoot);
plugin.attach(facet);          // plugin reaches the graph only via the membrane
onPluginRemoved(revoke);       // cut the whole subgraph atomically
```

### Pattern 3: Mint-weaker-then-delegate (kernel or macaroon)

```text
child = mint(parent, rights = reduce(parent.rights), badge = clientId)
give(child) to the less-trusted party        # never give the parent
revoke(parent.subtree) when the relationship ends
```

### Pattern 4: WASI preopen as the only authority

```text
wasmtime --dir=/sandbox::/  module.wasm     # module's ENTIRE fs = /sandbox
# no --dir => module has NO filesystem at all
```

### Pattern 5: Third-party caveat for cross-service authority (macaroons)

```text
macaroon.addThirdPartyCaveat(authServiceLocation, predicate="user is admin")
# holder must obtain a DISCHARGE macaroon from authService to use it
```

---

## Best Practices

- **Match the enforcement layer to the trust boundary.** Untrusted binary → WASI; untrusted in-process module → Compartment/membrane; untrusted service/driver → capability kernel. Don't enforce at the wrong granularity.
- **Freeze the primordials before running guests (SES).** A guest that can mutate shared intrinsics escapes the model regardless of endowments. `lockdown()` is non-negotiable.
- **Use a membrane, not a caretaker, when revoking a stateful graph.** If the holder will obtain objects *transitively*, only a membrane catches them.
- **Mint badged, reduced-rights children; never delegate the parent capability.** Keep the parent (and its `Revoke` power) on your side of the boundary.
- **Treat macaroon root keys like crowns.** Root-key compromise forges everything. Rotate, scope per-service, and prefer third-party caveats over one omnipotent root.
- **Keep nondeterminism out of confined guests deliberately.** Withholding `Date.now`/`Math.random` is a feature (determinism, no covert clock channels); supply *attenuated* deterministic versions where the guest legitimately needs them.
- **Build capability islands in ambient systems** (`cap_enter`, `pledge`/`unveil`, `landlock`) for the security-critical component rather than waiting to rewrite the whole OS.

---

## Edge Cases & Pitfalls

- **Primordial poisoning before lockdown.** If guest code (or a guest's dependency) runs before `lockdown()`, or the host shares a mutable intrinsic, the guest can patch `Object.prototype` and exfiltrate through the host's own objects. Order and isolation matter.
- **Membrane identity breakage.** Wrapping changes `===` and prototype identity; code that uses objects as map keys or does `instanceof` across the membrane misbehaves. Membranes must carefully shadow identity, and some patterns simply can't cross.
- **Covert and side channels survive confinement.** Capabilities bound *authority*, not *information flow*. A confined guest with a shared cache or a real clock can still leak bits through timing. seL4 proves authority confinement, not the absence of timing channels (those need separate, expensive mitigations).
- **Macaroon caveat verification is the soft spot.** The cryptography only guarantees caveats can't be *removed*; if the verifier forgets to *check* a caveat (e.g., never evaluates `time < T`), the attenuation is decorative. Most macaroon CVEs are missing or mis-ordered caveat checks.
- **WASI ambient leakage via the host.** WASI confines the *module*, but a host that wires a too-broad preopen (`--dir /`) or a permissive custom import re-creates ambient authority. The sandbox is only as tight as the host's grants.
- **Capsicum/pledge after the fact.** Authority acquired *before* `cap_enter()`/`pledge()` is retained. Mis-ordering — sandboxing before opening the fds you need, or opening too many before sandboxing — defeats the point.
- **Rights amplification via sealer pairs across a membrane.** If a sealer/unsealer pair straddles the boundary, it can move authority the membrane was meant to mediate. Audit sealer pairs as first-class authority.

---

## Common Mistakes

1. **Running guest JS without `lockdown()`** — shared mutable primordials make the Compartment porous.
2. **Caretaker where a membrane is needed** — the guest obtains objects transitively and your revocation misses them.
3. **Delegating the parent capability** instead of a minted, reduced child — you lose the revocation handle and over-grant.
4. **Forgetting to *check* macaroon caveats** — you verified the signature but not the restrictions; attenuation is now cosmetic.
5. **Over-broad WASI preopen** (`--dir /`) — the module is "sandboxed" but the sandbox is the whole disk.
6. **Sandboxing in the wrong order** (`cap_enter`/`pledge` before acquiring needed fds, or after acquiring too many).
7. **Assuming confinement stops information leaks** — it stops *authority* gain, not timing/cache side channels.
8. **One omnipotent macaroon root key** shared everywhere — its theft forges every token in the system.

---

## Tricky Points

- **Formal verification is *enabled by* the capability model, not bolted onto it.** seL4 could be proven because "your authority is the capabilities you hold" is a small, explicit, closed statement. You cannot write that statement crisply for an ambient-authority system — there's no bounded set to reason about. The model and the proof are the same intellectual move.
- **A membrane is the language-level dual of `seL4_CNode_Revoke`.** Both revoke a *subtree* of derived authority atomically: the kernel over a derivation tree, the membrane over the reachable object subgraph. Recognizing them as the same pattern at different layers is the senior insight.
- **Macaroons make "shrink-only" a law of physics (HMAC), which is why a *client* can be trusted to attenuate.** In OAuth you must trust the issuer to mint a narrower scope; with macaroons the math forbids widening, so delegation needs no central authority — a genuinely different trust topology.
- **"No ambient authority" and "no nondeterminism" come together in realms, and that's deliberate.** Withholding `Date.now`/`Math.random`/`fetch` from a guest removes both an authority *and* a covert channel (clocks leak, network leaks). Capability languages tend toward determinism not by accident but because the same globals carry both authority and observability.
- **Bearer capabilities (fds, macaroons, tokens) are powerful *because* they carry no identity, and dangerous for the same reason.** Theft is total: the thief *is* authorized. This is the price of "possession is the permission," and it's why such capabilities must be short-lived, narrowly scoped, and revocable.

---

## Test Yourself

1. Explain why seL4 can be *formally verified* to enforce authority confinement, and why proving the same about a Unix ACL system is far harder. Tie your answer to ambient authority.
2. Describe the difference between a caretaker and a membrane. Give a concrete scenario where a caretaker silently fails to revoke and a membrane succeeds.
3. In SES, what does `lockdown()` do, and why is a `Compartment` without it insecure even if you endow it minimally?
4. A macaroon's signature verifies but a user still accessed object 99 despite an `object = 42` caveat. Where is the bug, given that HMAC prevents caveat removal?
5. WASI: a module "has no filesystem" yet reads `/etc/passwd`. List two host-side misconfigurations that could explain this.
6. Why do object-capability languages tend to withhold `Date.now()` and `Math.random()` from guests? Name both reasons (authority and channel).
7. Trace a third-party caveat: what extra artifact must the holder present, who issues it, and why does this let two services compose authority without a shared session store?
8. Capsicum: a program calls `cap_enter()` and then `open("/tmp/log")` fails. Explain precisely why, and how the program should have arranged to write its log.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│         WHERE CAPABILITIES ARE ENFORCED (3 layers)               │
├──────────────────────────────────────────────────────────────────┤
│ KERNEL    seL4 / KeyKOS / EROS / Fuchsia(Zircon handles)         │
│   action = invoke a cap in your CSpace; no open("/path")         │
│   Mint (weaker child, badge) | Copy | Revoke(subtree)            │
│   seL4: FORMALLY PROVEN authority confinement & integrity        │
├──────────────────────────────────────────────────────────────────┤
│ LANGUAGE  E | Joe-E(Java subset) | SES/Compartment(JS) | Pony |  │
│           Newspeak                                               │
│   mechanism = DENY ambient globals (fs/net/Date/Math/process)    │
│   SES: lockdown() freezes primordials; Compartment = endowments  │
│   Pony: reference capabilities (iso/val/ref/box/trn/tag) static  │
├──────────────────────────────────────────────────────────────────┤
│ SANDBOX   WASI                                                  │
│   zero authority by default; host PREOPENS dir/socket caps       │
│   no --dir => module has NO filesystem                          │
├──────────────────────────────────────────────────────────────────┤
│ MEMBRANE  caretaker that wraps EVERYTHING crossing it           │
│   => revoke an entire object subgraph atomically                │
│   (language-level dual of seL4_CNode_Revoke over a subtree)     │
├──────────────────────────────────────────────────────────────────┤
│ MACAROON  HMAC-chained bearer token                             │
│   anyone can ADD caveats offline (attenuate); none can REMOVE   │
│   third-party caveat => needs a discharge macaroon (compose)    │
│   PITFALL: verifier must actually CHECK each caveat             │
├──────────────────────────────────────────────────────────────────┤
│ CAP ISLANDS in Unix: capsicum(cap_enter) | pledge/unveil |      │
│   seccomp+landlock  — convert the component, not the whole OS   │
├──────────────────────────────────────────────────────────────────┤
│ REMEMBER: capabilities bound AUTHORITY, not INFORMATION          │
│   timing / cache side channels survive confinement              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Capability discipline becomes *enforced* at three layers: the **kernel** (seL4, KeyKOS, EROS/CapROS, Fuchsia/Zircon), the **language runtime** (E, Joe-E, SES/Compartments, Pony, Newspeak), and the **sandbox ABI** (WASI). The model is identical; the unit of confinement and the enforcer differ.
- In a **capability OS** there is no ambient namespace: every action is the invocation of a kernel capability held in a CSpace; capabilities are minted weaker, badged, copied, and **revoked over a derivation subtree**. seL4 is **formally verified** to enforce authority confinement — a proof made tractable *because* the model is capabilities.
- **Object-capability languages** remove ambient authority by **withholding the powerful globals**. SES `lockdown()` freezes primordials and a `Compartment` runs guest code with only the endowments you pass; Pony encodes capabilities in its type system. The *absence* of ambient globals is the mechanism.
- **WASI** starts from zero authority and makes every grant explicit (preopened directory/socket capabilities) — the cleanest mainstream supply-chain story: a module handed no socket cannot reach the network.
- The **membrane** generalizes the caretaker to revoke an entire reachable object subgraph atomically — the in-language dual of the kernel's subtree `Revoke`.
- **Macaroons** give tokens capability properties: HMAC chaining lets *any holder* add caveats offline (attenuate) but never remove them, enabling client-side delegation and cross-service composition via third-party caveats — with the standing pitfall that verifiers must actually *check* every caveat.
- Mainstream OSes stayed **ACL-based** for historical/ecosystem reasons; the practical path is **capability islands** (Capsicum, pledge/unveil, landlock, WASI, SES) converting the security-critical component rather than the whole system.
- The hard limit: capabilities confine **authority**, not **information** — timing and cache side channels survive, and bearer capabilities are total-loss on theft.

---

## What You Can Build

- **A working membrane.** Implement transitive wrapping with `Proxy`, demonstrate that revoking the root cuts off objects the holder obtained *after* attachment, and document where object identity breaks.
- **A macaroon library + a deliberate caveat-check bug.** Implement minting, offline attenuation, and verification; then write a test proving that *skipping* a caveat check defeats attenuation while the signature still verifies.
- **An SES-sandboxed plugin host.** `lockdown()`, run a third-party plugin in a Compartment endowed with only a logger and a read-only config, and show that `fetch`/`fs` are unreachable.
- **A WASI confinement demo.** Compile a program that tries to read `/etc/passwd`; run it with no `--dir` (fails), then with `--dir /sandbox` (only the sandbox is visible).
- **A Capsicum (or landlock) wrapper.** Acquire the fds a tool needs, enter capability mode, and prove that subsequent ambient `open()` calls fail.

---

## Further Reading

- *seL4: Formal Verification of an OS Kernel* — Klein et al., SOSP 2009; and the seL4 reference manual (capabilities, CSpace, Mint/Revoke). https://sel4.systems/
- *KeyKOS / EROS / CapROS* — Bomberger, Hardy, Shapiro. The capability-OS lineage and the EROS confinement proof. https://www.cs.washington.edu/homes/levy/capabook/ and http://www.eros-os.org/
- *Capsicum: Practical Capabilities for UNIX* — Watson, Anderson, Laurie, Kennaway, USENIX Security 2010. https://www.cl.cam.ac.uk/research/security/capsicum/
- *Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud* — Birgisson et al., NDSS 2014. https://research.google/pubs/pub41892/
- *WASI: The WebAssembly System Interface* — capability-based design docs. https://wasi.dev/ and https://github.com/WebAssembly/WASI
- *Hardened JavaScript / SES / Compartments* — Agoric/Endo and TC39 proposals. https://github.com/endojs/endo and https://github.com/tc39/proposal-compartments
- *Joe-E: A Security-Oriented Subset of Java* — Mettler, Wagner, Close, NDSS 2010. https://www.cs.berkeley.edu/~daw/papers/joe-e-ndss10.pdf
- *Pony reference capabilities* — the tutorial on `iso/val/ref/box/trn/tag`. https://tutorial.ponylang.io/reference-capabilities.html
- *The Fuchsia Book — Zircon kernel objects, handles, and rights.* https://fuchsia.dev/fuchsia-src/concepts/kernel
