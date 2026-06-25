# Capability-Based Security — Professional Level

> **Topic:** [Capability-Based Security](README.md)
> **Focus:** Shipping least-authority in real codebases — dependency-injecting authority, SES/WASI/Node permission models, macaroons and capability tokens in distributed systems, revocation via membranes, supply-chain defense, and the organizational economics of migrating an ACL/RBAC system toward capabilities.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
   - [Retrofitting Least-Authority Into a Real Codebase](#retrofitting-least-authority-into-a-real-codebase)
   - [Object-Capability Discipline in Practice](#object-capability-discipline-in-practice)
   - [WASI Capability Filesystem for Plugin and Edge Sandboxing](#wasi-capability-filesystem-for-plugin-and-edge-sandboxing)
   - [Macaroons and Capability Tokens in Distributed Systems](#macaroons-and-capability-tokens-in-distributed-systems)
   - [Revocation: The Caretaker and Membrane Patterns](#revocation-the-caretaker-and-membrane-patterns)
   - [Supply-Chain Defense Through Capability Confinement](#supply-chain-defense-through-capability-confinement)
   - [Migrating an ACL/RBAC System Toward Capabilities](#migrating-an-aclrbac-system-toward-capabilities)
   - [Production Capability Systems: seL4 and Fuchsia Handles](#production-capability-systems-sel4-and-fuchsia-handles)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [War Stories](#war-stories)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [What You Can Build](#what-you-can-build)
20. [Further Reading](#further-reading)
21. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the senior tier you learned *where* capabilities are enforced — the kernel, the language realm, the sandbox ABI — and the machinery (membranes, macaroons, derivation trees) that keeps the model sound. At the professional tier the question changes from "what enforces it" to "how do I retrofit this into a hundred-thousand-line service without halting feature work, and how do I justify the cost to the people who pay for it."

This is the tier where capability security stops being a property of clean-room systems like seL4 and becomes a *refactoring discipline* you apply to a Node service that already `import`s `fs` in forty files, an organizational migration you stage over quarters, and a supply-chain control you defend in a security review. The hardest parts here are not cryptographic or kernel-theoretic. They are economic and social: ambient authority is *convenient*, every program in your stack assumes it, and the people who maintain those programs experience least-authority as friction until the day it saves them from a breach.

This page is about that real-world middle ground — *capability islands inside ambient systems*. You will rarely get to start on seL4. You will almost always be handed a codebase soaked in ambient authority and asked to make the trust-sensitive parts of it not be. The professional skill is knowing which parts those are, how to wrap them, how to hand authority to them by injection instead of import, and how to revoke that authority cleanly when a tenant churns or a plugin is removed. We will work through the retrofit recipe, the deployable runtimes (SES/Hardened JS, the Node permission model, WASI), the distributed-token story (macaroons and their failure modes), and the migration economics — with war stories where each one has bitten teams in production.

---

## Prerequisites

- **Required:** Senior tier — the three enforcement layers (kernel/language/ABI), membranes, caretakers, macaroons with caveats, the powerbox, and the ACL-vs-capability comparison.
- **Required:** Fluency refactoring a real service in at least one of JavaScript/TypeScript, Go, Rust, or Python — extracting dependencies, inverting control, threading interfaces through call graphs.
- **Required:** Working knowledge of how your platform exposes ambient authority: `fs`/`net`/`child_process` in Node, `os`/`open` in Python, the global allocator and syscalls in systems languages.
- **Required:** Operational context — multi-tenancy, plugin systems, third-party dependency risk, incident response, and the compliance questions ("who could have done this?") that drive auth design.
- **Helpful:** Exposure to OAuth2/JWT scopes for the macaroon comparison, and to one capability-island Unix mechanism (`pledge`/`unveil`, Capsicum, Landlock, seccomp).
- **Helpful:** Having owned an authorization rewrite or a sandbox rollout end to end.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Ambient authority** | Power a piece of code can exercise simply by *being* code in the process — `import fs`, a global socket, `process.env` — without anyone handing it that power. The thing capabilities eliminate. |
| **Authority injection** | Passing a capability (a file handle, a scoped client, a directory object) into a module as an argument or constructor parameter instead of letting the module reach for ambient authority. |
| **POLA** | Principle of Least Authority — every component holds exactly the authority it needs to do its job and no more; the design target of all this work. |
| **Powerbox** | The single trusted component that holds broad authority and hands out narrowly-scoped capabilities to everything else; the place ambient authority is *allowed* to live. |
| **SES / Hardened JavaScript** | A frozen, ambient-authority-free JavaScript runtime (`lockdown()` + `Compartment`) shipping in Agoric/Endo; the practical language-level ocap form today. |
| **Compartment** | An isolated JS evaluation scope populated with exactly the endowments (capabilities) a guest may use; no ambient globals. |
| **Node permission model** | Node.js's `--permission` flag plus `--allow-fs-read`/`--allow-fs-write`/`--allow-child-process`/etc., a process-level allowlist that turns ambient `fs`/`net` access into a granted-only capability. |
| **WASI preopen** | A directory (or socket) capability the host hands a WebAssembly module at startup; the module can resolve paths only relative to preopens it holds — no preopen, no filesystem. |
| **Macaroon** | An HMAC-chained bearer token any holder can *attenuate* offline by appending caveats; the distributed-systems realization of capability attenuation. |
| **Caveat** | A restriction baked into a macaroon (`expires < T`, `object = 42`, or a third-party caveat needing a discharge). |
| **Caretaker** | A revocable indirection wrapping a single capability; flip a switch and the wrapped object is severed. |
| **Membrane** | A *transitive* caretaker: every object that passes through it is wrapped too, so an entire reachable subgraph can be revoked atomically. |
| **Confused deputy** | A privileged component tricked into misusing its authority on behalf of a less-privileged caller — the canonical failure that ambient authority enables and capabilities prevent. |
| **Handle (Zircon/Fuchsia)** | A userspace name for a kernel-object capability with rights bits; the only way to act on a kernel object in Fuchsia — no ambient namespace. |

---

## Core Concepts

### Retrofitting Least-Authority Into a Real Codebase

The single most important professional move is mechanical and unglamorous: **stop importing authority; start receiving it.** A module that does `import fs from 'node:fs'` has reached into the ambient world and grabbed the entire filesystem. A module that takes a `storage` parameter in its constructor holds exactly the authority its caller chose to grant. The first is ambient authority; the second is a capability. The refactor from one to the other is the whole game at this tier.

The recipe, applied to a real service:

**Step 1 — Inventory the ambient reach.** Grep for the ambient authority sources: `fs`, `net`, `http`, `child_process`, `process.env`, `dns`, global database clients, global HTTP clients. Each import is a place a module can do something its callers never authorized. This list *is* your attack surface for the confused-deputy and supply-chain classes.

**Step 2 — Push authority to the edges (the powerbox).** Decide where broad authority is *allowed* to live: usually `main()`, a composition root, a DI container, or a small "platform" module. That place opens files, dials sockets, reads env. Everything else receives capabilities from it. This is the powerbox pattern at application scale — you are not eliminating ambient authority from the *process*, you are confining it to one auditable place.

**Step 3 — Inject narrowed capabilities.** Instead of handing a module `fs`, hand it `openFileInDir(configDir)` bound to one directory, or a `ConfigStore` object exposing only `read(key)`. The module's authority is now a strict subset of the filesystem. The narrowing is the security; the injection is just plumbing.

**Step 4 — Make the ambient path a lint error.** Once a module receives its authority, forbid it from reaching for ambient authority again. `eslint-plugin-no-restricted-imports` banning `node:fs`/`node:net` in the business-logic layer is a capability boundary you can enforce in CI. Without this, the next contributor re-introduces `import fs` and silently re-opens the door.

The friction is real and worth naming: injection makes call signatures longer, makes wiring explicit, and makes "just read this one file here" annoying. That annoyance is the *point* — it surfaces every place a module exercises authority, which was previously invisible. The discipline pays off the first time you can answer "could the markdown renderer have read `/etc/passwd`?" with "no, it was only given a string" instead of "let me audit the whole call graph."

### Object-Capability Discipline in Practice

Object-capability (ocap) discipline turns the dependency-injection refactor above into a *language-enforced* property. Three deployable forms matter in production today.

**SES / Hardened JavaScript.** SES (Secure ECMAScript, shipping as Hardened JS in Agoric/Endo and the basis for the TC39 Compartments proposal) does two things: `lockdown()` *freezes the primordials* — `Object.prototype`, `Array.prototype`, `Function`, etc. — so a guest cannot mutate shared intrinsics to attack the host, and `Compartment` evaluates guest code in a scope whose globals contain only the endowments you pass. A plugin run in a Compartment with no `fetch` and no `process` literally cannot do network I/O or read the environment, because those names do not exist in its scope. This is the strongest in-process confinement you can deploy without a separate runtime, and it is the basis of Agoric's smart-contract platform where mutually distrustful code runs in one process.

**The Node permission model.** For whole-process confinement without rearchitecting, Node's `--permission` flag (stable as of recent Node majors) turns ambient `fs`/`net`/`child_process`/native-addon access into an allowlist. `node --permission --allow-fs-read=/app/config app.js` means any `fs.readFile` outside `/app/config` throws `ERR_ACCESS_DENIED`. This is coarse — process-level, not module-level — but it is a one-flag capability island that defends against a compromised dependency reaching the filesystem or shelling out. Treat it as the outer perimeter; SES Compartments are the inner walls.

**Compartments for dependency confinement.** The high-leverage pattern is to load *individual dependencies* into Compartments. Your business logic runs with full authority; the risky transitive dependency (a markdown parser, a template engine, an image decoder) runs in a Compartment endowed with only what it legitimately needs — usually *nothing* but pure-computation globals. A supply-chain compromise of that dependency is then contained: the malicious code has no socket, no `fs`, no `process` to exfiltrate through.

### WASI Capability Filesystem for Plugin and Edge Sandboxing

When the untrusted code is a *binary* rather than a module in your language, WASI is the production answer. WebAssembly core has no I/O; WASI adds it on a strict capability basis. The host **preopens** directories and sockets and hands the module file descriptors for them; the module's `path_open` can only resolve paths *relative to a preopen it already holds*. Run a module with `--dir /sandbox` and its entire filesystem is `/sandbox`; run it with no `--dir` and it has no filesystem at all.

In production this is how edge and plugin platforms get structural isolation. A Shopify Function, a Fastly Compute or Cloudflare-style edge module, a Figma-style plugin, or a database UDF compiled to WASM receives only the preopens the host grants. The supply-chain consequence is sharp: a compromised or malicious module handed only `/sandbox` and no socket preopen *cannot exfiltrate over the network* — not because a policy says so, but because it holds no network capability. The sandbox is exactly as tight as the host's grants, which is the one thing you must get right: a host that wires `--dir /` re-creates ambient authority and throws the whole model away.

The operational discipline for a WASI plugin host: (1) grant the *minimum* preopens per plugin, scoped to a per-plugin directory; (2) deny socket capabilities by default and grant them only to plugins whose function genuinely requires network egress, ideally through a host-mediated, policy-checked proxy rather than a raw socket; (3) treat the host's import surface (the functions you expose to the module) as authority too — a permissive custom host import is just as much ambient authority as a broad preopen.

### Macaroons and Capability Tokens in Distributed Systems

Across a network, a capability is a bearer token. The professional question is how to make those tokens *attenuable* and *delegable* without an issuer round-trip, and macaroons are the cleanest answer. A macaroon is an HMAC chain: the issuer signs an identifier with a root secret; any holder can append a **caveat** (`expires < T`, `object = 42`, `method = GET`) by re-HMACing the current signature with the caveat text. Because HMAC is one-way, holders can only ever *add* caveats, never remove them — derived macaroons are strictly weaker. The verifier re-runs the chain from the root secret and *must check every caveat*.

This buys three properties ordinary signed tokens lack. **Offline attenuation:** a client holding a broad macaroon can mint a tightly-scoped, 30-second token for a downstream cache without contacting the issuer. **Delegation:** hand the attenuated macaroon onward; the recipient's authority is bounded by every caveat in the chain. **Third-party caveats:** "valid only if you also present a discharge macaroon from the auth service proving the user is an admin" — this composes authority across services *without a shared session store*, because the discharge proof travels with the request. This is exactly the gap OAuth scopes leave: scopes are coarse and can only be narrowed by the issuer, whereas a macaroon holder narrows client-side, cryptographically.

The standing production hazard is not the cryptography — it is verification. The HMAC chain guarantees caveats cannot be *removed*; it guarantees *nothing* about whether your verifier actually *evaluates* them. The recurring macaroon vulnerability is a verifier that checks the signature, accepts the token, and never evaluates `expires < T` or `object = 42` — at which point the attenuation is decorative and every short-lived token is effectively eternal. Treat the caveat-verification function as the security-critical core, test it adversarially, and fail closed on any caveat the verifier does not recognize.

### Revocation: The Caretaker and Membrane Patterns

Granting authority is easy; *taking it back* is where capability systems earn their keep, and it is where teams most often get the pattern wrong. The two tools are the caretaker and the membrane, and choosing between them is a senior-to-professional judgment call you make on every revocable grant.

A **caretaker** wraps *one* capability behind a revocable indirection. The holder gets the caretaker, not the real object; the real object stays on your side. Flip the caretaker's switch and the wrapped capability throws. This is correct when the thing you grant is a *single object with no vending* — a one-shot file handle, a config reader, a logger.

A **membrane** is the transitive caretaker, and it is what you actually need most of the time. The problem: objects vend other objects. A tenant given a `Database` caretaker calls `db.table('orders')`, which returns a `Table`, which returns `Row` objects. Revoking the `Database` caretaker severs `db` but *not* the `Table` and `Row` objects the tenant already obtained — those are live references with full authority, and your "revocation" did nothing to the data the tenant can still reach. The membrane fixes this by wrapping *every* object that crosses the boundary, in either direction, with the same revocation switch. Revoke the membrane and the *entire reachable subgraph* the tenant ever obtained dies atomically. This is the in-language dual of `seL4_CNode_Revoke` over a derivation subtree.

In production, reach for a membrane whenever you grant access to a *stateful object graph* that the holder will navigate transitively — a plugin's view of your domain model, a tenant's handle to a multi-table store, an extension's reference to the editor's document tree. The membrane's cost is real (proxy overhead on every crossing, and `===`/`instanceof` identity breaks across the boundary), so don't reach for it when a caretaker suffices; but a caretaker where a membrane is needed is a *silent* authority leak, which is the worst kind.

### Supply-Chain Defense Through Capability Confinement

The most compelling modern argument for capability security is supply-chain. A typical service has thousands of transitive dependencies, any one of which could be compromised (typosquat, hijacked maintainer account, malicious update). Under ambient authority, *every* one of those dependencies can `require('fs')`, open a socket, and exfiltrate your secrets — the moment any of them is malicious, the whole process's authority is theirs. This is not hypothetical; it is the mechanism behind a long line of npm/PyPI/crates supply-chain incidents.

Capabilities change the default. **A capability-secure module cannot reach the network unless someone hands it a socket.** Run a dependency in an SES Compartment endowed with only pure computation, or as a WASI module with no socket preopen, and a malicious version of it has *no path* to exfiltrate — it holds no network capability, full stop. This is structural, not heuristic: it does not depend on detecting the malicious behavior, scanning the code, or trusting the maintainer. It depends only on the dependency genuinely not needing the authority you withheld, which for a markdown parser or a left-pad equivalent is trivially true.

The professional framing for a security review: classify each dependency by the authority it *legitimately* needs. Pure-computation dependencies (parsers, formatters, math) need *nothing* and should run confined — the cost is a Compartment or a WASM boundary, the payoff is that their compromise is contained. I/O dependencies (an HTTP client, a database driver) need authority and must be trusted or wrapped in a narrowing facet. This classification turns "we have 3,000 dependencies and trust them all implicitly" into "we have 40 dependencies that hold real authority, and the other 2,960 are confined."

### Migrating an ACL/RBAC System Toward Capabilities

Most systems you inherit are ACL- or RBAC-based: a request arrives with an identity, and a policy check asks "is this identity allowed to do this action on this object?" Migrating toward capabilities means moving from *identity-plus-policy-check* to *possession-of-an-unforgeable-reference*. This migration is where most of the friction — and most of the value — lives, so be honest about both.

**Why it is hard.** ACLs answer "who did this?" — exactly what compliance and audit ask for — and that question maps awkwardly onto "what was held." Your entire codebase assumes ambient identity: the current user is in a thread-local, a request context, a session. Every authorization decision reaches for that ambient identity, which is the confused-deputy vulnerability waiting to happen. Ripping out ambient identity is as invasive as ripping out ambient `fs`, and your auditors will ask where the identity went.

**Where to start (and stop).** Do *not* attempt to convert the whole system. Convert the *delegation-heavy, confused-deputy-prone* edges first: where service A acts on behalf of user U against service B and currently forwards U's full identity (so B can't tell whether A is doing what U asked or something broader). Replace that with a capability — a macaroon attenuated to exactly the action U authorized — and the confused deputy is structurally gone, because A can only present authority it was granted. Cross-service delegation, "share this document with a link," scoped API tokens, and per-tenant data access are the natural first targets.

**The hybrid that actually ships.** The endpoint stays ACL/RBAC for coarse, identity-centric, auditable decisions ("is this user a member of this org?"). Capabilities handle the fine-grained, delegable, attenuable decisions inside that boundary ("this specific link grants read on these three documents until Friday"). You keep identity for audit and authentication; you add capabilities for authorization-by-possession where delegation and least-authority matter. The migration is additive and reversible, which is the only kind of authorization migration a sane organization will approve.

### Production Capability Systems: seL4 and Fuchsia Handles

Two systems prove capabilities are not just a research toy but ship in products under adversarial load.

**seL4** is a formally verified microkernel where there is no ambient authority at all: every action is the invocation of a capability held in the process's capability space (CSpace), capabilities are minted weaker and badged, and `seL4_CNode_Revoke` severs a derivation subtree. Its C implementation is *proven* to enforce authority confinement and integrity. The professional significance is twofold: it ships in high-assurance products (secure phones, defense, automotive, avionics) where you need a *proof* rather than a test suite, and it demonstrates that the proof is *enabled by* the capability model — "your authority is the capabilities you hold" is a small enough statement to verify formally, which you simply cannot say about an ambient-authority system.

**Fuchsia / Zircon** carries the idea into a shipping consumer OS. Every kernel object is named by a **handle** carrying rights bits; handles are the only way to act on kernel objects, they are transferred over channels, and there is no ambient filesystem — a component's namespace is exactly the set of handles its parent granted at launch. This is the powerbox pattern at OS scale: a component holds the handles for its job and no more, so a compromised driver holds only the MMIO and IRQ handles for its device and cannot touch the rest of the system. Fuchsia is the existence proof that capability-by-handle scales to a full, maintainable, consumer operating system — the thing KeyKOS and EROS proved was *possible* but never reached application gravity for.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Authority injection** | A contractor who must be *handed* the key to one room, versus one who keeps a master key to the whole building "for convenience." |
| **Powerbox** | The building's front desk: the only place that holds all keys and cuts narrowly-scoped ones for visitors. |
| **Confused deputy** | A compiler given a fee-file path by the customer overwrites the billing log, because it acts with *its* authority on the customer's say-so — the original 1988 confused-deputy story. |
| **Membrane** | A quarantine zone: anything that touches anything inside also becomes quarantined, and you can lift the whole zone at once. |
| **Macaroon caveat** | A travel visa you can voluntarily stamp with extra restrictions ("transit only, expires Friday") that no later holder can erase. |
| **Third-party caveat** | A visa valid only if you also carry a letter from a second consulate. |
| **WASI preopen** | A workshop with no doors outside; the only access is the one supply hatch the foreman opened for you. |
| **ACL → capability migration** | Moving from "the guard checks your ID against a list" to "you hold a key that only opens what you were given." |
| **Supply-chain confinement** | Letting a subcontractor into one supply closet instead of the whole warehouse, so a dishonest subcontractor can steal only what's in that closet. |

---

## Mental Models

### The "Import Is a Grab, Injection Is a Grant" Model

Every `import fs` is a module reaching out and *taking* authority no one gave it. Every constructor parameter is a module *receiving* authority a caller chose to grant. The entire retrofit is converting grabs into grants. When you read a module's signature and can enumerate its authority from the parameters alone — without reading the body — you have arrived. When you must read the whole body to know what it can touch, you are still in ambient-authority land.

### The "Powerbox at the Edge, Confinement at the Core" Model

You will never make a real process have zero ambient authority. Instead you confine ambient authority to one auditable place (the powerbox: `main`, the composition root, the host of a sandbox) and make everything downstream receive narrowed capabilities. Security review then has one question — "what does the powerbox hand out, and to whom?" — instead of a whole-codebase audit.

### The "Attenuate Without Asking" Model (macaroons)

Stop thinking of a token as a fixed grant you must return to the issuer to narrow. Think of it as a capability the *holder* shrinks, offline, before delegating — the HMAC chain makes "shrink-only" a cryptographic law. This is the trust topology that lets a client hand a cache server a one-key, 30-second token derived from its broad token with no issuer round-trip.

### The "Revocation Spreads or It Lies" Model

A caretaker cuts one wire; a membrane cuts that wire and every wire that ever passed through it. If the holder obtains objects *transitively* and you revoke with a caretaker, your revocation is a lie — the holder still reaches everything it vended. Match the revocation tool to whether authority spreads.

### The "Confinement Is Containment, Not Detection" Model

Capability confinement does not detect a malicious dependency, scan it, or trust its maintainer. It removes the *path*: no socket capability, no exfiltration, regardless of what the code wants to do. This is why it works against unknown future compromises — it defends the structure, not the specific attack.

---

## Code Examples

### Refactor: From Ambient `fs` to an Injected Directory Capability (Node/TS)

```ts
// BEFORE — ambient authority: this module can read the entire filesystem.
// A compromise of this file, or of anything it imports, reaches all of disk.
import { readFile } from 'node:fs/promises';

export async function loadTemplate(name: string): Promise<string> {
  return readFile(`/app/templates/${name}.html`, 'utf8'); // unbounded reach + path traversal risk
}

// AFTER — injected capability: the module receives a directory capability
// bound to exactly one directory and can touch nothing else.
export interface DirCap {
  read(name: string): Promise<string>; // resolves only within the bound directory
}

export async function loadTemplate(dir: DirCap, name: string): Promise<string> {
  return dir.read(`${name}.html`); // authority is exactly what `dir` was given
}

// The POWERBOX (composition root / main) is the only place that opens the dir:
import { openDirCap } from './platform/fs-cap.js'; // narrowing factory, traversal-checked
const templates = openDirCap('/app/templates');
await loadTemplate(templates, 'invoice');
// loadTemplate now provably cannot read /etc/passwd: it was never handed it.
```

### Confine a Risky Dependency in an SES Compartment (JavaScript)

```js
import 'ses';
lockdown(); // freeze primordials so the guest can't poison Array.prototype etc.

// A transitive dependency we don't fully trust (e.g., a markdown renderer).
// It needs NOTHING but pure computation, so we endow it with nothing dangerous.
const sandbox = new Compartment({
  // endowments = the dependency's ENTIRE reachable world:
  // (deliberately ABSENT: fetch, fs, process, require, Buffer with network)
});

const render = sandbox.evaluate(untrustedRendererSource); // returns a pure (md) => html
const html = render(userMarkdown);
// Even if `untrustedRendererSource` is malicious, it holds no socket and no fs:
// it cannot phone home. Supply-chain compromise is structurally contained.
```

### Process Perimeter with the Node Permission Model (shell)

```bash
# Outer capability island: the whole process may read only /app/config,
# write only /app/cache, and may NOT spawn children or load native addons.
node --permission \
     --allow-fs-read=/app/config \
     --allow-fs-write=/app/cache \
     server.js
# Any fs access outside those paths -> ERR_ACCESS_DENIED at runtime.
# child_process and native addons are denied by default under --permission.
```

### WASI Plugin Host: Preopen Is the Only Authority (shell + host policy)

```bash
# Plugin gets EXACTLY /plugins/acme as its filesystem and NO network.
wasmtime run --dir=/plugins/acme::/ plugin.wasm
# No --dir => the module has no filesystem at all.
# No socket capability granted => the module cannot open a network connection,
# so a malicious plugin cannot exfiltrate, regardless of its code.
```

### Macaroon: Offline Attenuation + the Caveat-Check That Must Not Be Skipped (Python)

```python
import hmac, hashlib, time

def mint(root_key: bytes, identifier: str, caveats: list[str]):
    sig = hmac.new(root_key, identifier.encode(), hashlib.sha256).digest()
    for c in caveats:
        sig = hmac.new(sig, c.encode(), hashlib.sha256).digest()  # chain
    return identifier, list(caveats), sig

# Issuer mints a broad macaroon for a user.
ident, cav, sig = mint(ROOT, "user=alice", [])

# CLIENT attenuates OFFLINE — no issuer round-trip — before delegating.
new_caveats = ["object = 42", f"time < {int(time.time()) + 30}"]
cav2, sig2 = cav + new_caveats, sig
for c in new_caveats:
    sig2 = hmac.new(sig2, c.encode(), hashlib.sha256).digest()
# (ident, cav2, sig2) is STRICTLY weaker. HMAC one-wayness forbids removing a caveat.

def verify(root_key, ident, caveats, sig, request_object) -> bool:
    s = hmac.new(root_key, ident.encode(), hashlib.sha256).digest()
    for c in caveats:
        s = hmac.new(s, c.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(s, sig):
        return False  # signature (chain integrity) check
    for c in caveats:                 # <-- THE STEP THAT IS FATALLY EASY TO OMIT
        if not check_caveat(c, request_object):
            return False              # fail CLOSED on any caveat that does not hold
    return True
# Skipping the caveat loop is the recurring macaroon CVE: the signature verifies,
# attenuation becomes decorative, and "30-second" tokens live forever.
```

### Transitive Revocation: A Membrane Over a Vended Object Graph (JavaScript)

```js
function makeMembrane(target) {
  let live = true;
  const wrapped = new WeakMap();
  const wrap = (obj) => {
    if (Object(obj) !== obj) return obj;             // primitives pass through
    if (wrapped.has(obj)) return wrapped.get(obj);
    const proxy = new Proxy(obj, {
      get(t, p) { if (!live) throw new Error('revoked'); return wrap(t[p]); },
      apply(t, self, args) {
        if (!live) throw new Error('revoked');
        return wrap(t(...args.map(wrap)));           // wrap args IN and result OUT
      },
    });
    wrapped.set(obj, proxy);
    return proxy;
  };
  return { facet: wrap(target), revoke: () => { live = false; } };
}

// A tenant navigates the graph transitively: db -> table -> row.
const { facet: dbForTenant, revoke } = makeMembrane(database);
tenant.attach(dbForTenant);
// On tenant churn, ONE call severs db, every table, and every row it ever obtained:
revoke();
// A caretaker on `database` alone would have left vended tables/rows live — a leak.
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Authority injection** | Authority visible in signatures; confused deputy structurally prevented; testable (inject a fake). | Longer signatures, explicit wiring, friction the team feels before the payoff. |
| **SES Compartments** | In-process, module-grain confinement; deployable today; strong supply-chain story. | Must `lockdown()`; guests lose nondeterminism (`Date`/`Math.random`) which can break naive code. |
| **Node permission model** | One-flag process perimeter; defends `fs`/`net`/spawn without rearchitecting. | Coarse (process-level); all-or-nothing per resource; not module-grain. |
| **WASI** | Zero-authority default; confines untrusted *binaries*; portable; strong edge/plugin story. | Younger ecosystem; preopen model differs from POSIX expectations; host can over-grant. |
| **Macaroons** | Offline client attenuation; cross-service composition via third-party caveats; no session store. | Bearer secrets (theft = authority); root-key compromise total; verifier must actually check caveats. |
| **Membranes** | Atomic transitive revocation of a graph. | Proxy overhead; breaks `===`/`instanceof`; subtle to implement correctly. |
| **ACL → capability migration** | Eliminates confused deputies on delegation edges; enables least-authority sharing. | Invasive; fights ambient identity; auditors ask "who did it?"; must stay hybrid to ship. |

---

## Use Cases

- **Plugin and extension hosts.** Run untrusted third-party code in WASI sandboxes or SES Compartments with only the capabilities its function needs.
- **Edge / serverless compute.** Per-tenant WASM modules with per-tenant preopens and policy-mediated egress.
- **Supply-chain hardening.** Confine pure-computation dependencies so a compromised transitive package has no socket or filesystem to exploit.
- **Scoped, delegable API tokens.** Macaroons for "share-by-link," downstream service delegation, and short-lived attenuated tokens without an issuer round-trip.
- **Multi-tenant data access with clean revocation.** Membranes over per-tenant views so a churned tenant's whole reachable graph is severed atomically.
- **High-assurance components.** seL4-based isolation where a *proof* of confinement is required; Fuchsia-style handle isolation for drivers and services.

---

## Coding Patterns

### Pattern 1: Powerbox at the composition root

```ts
// One place holds broad authority; everything else receives narrowed capabilities.
const platform = { fs: openDirCap('/app/data'), net: dialScoped('payments.internal:443') };
const service = makeService(platform.fs, platform.net); // injected, not imported
```

### Pattern 2: Confine-the-dependency

```js
lockdown();
const dep = new Compartment({ /* only what THIS dependency legitimately needs */ });
const safe = dep.evaluate(untrustedDependencySource);
```

### Pattern 3: Attenuate-then-delegate (macaroon)

```text
narrow = addCaveat(broadToken, "object=42"); narrow = addCaveat(narrow, "expires<+30s")
send(narrow) to the less-trusted downstream      # never send the broad token
```

### Pattern 4: Membrane for a vended graph

```js
const { facet, revoke } = makeMembrane(domainRoot);
tenant.attach(facet);          // tenant reaches the graph only through the membrane
onTenantChurn(revoke);         // sever the whole subgraph atomically
```

### Pattern 5: Confused-deputy fix on a delegation edge

```text
# BEFORE: service A forwards user U's full identity to B (B can't tell scope)
# AFTER:  service A presents a macaroon attenuated to exactly the action U authorized
authority = attenuate(userMacaroon, ["action=read", "object=" + requestedDoc])
callB(authority)   # A can only ever exercise what it was granted
```

---

## Best Practices

- **Inject authority; never import it in the business layer.** Make `import fs`/`net` a lint error outside the powerbox.
- **Confine the broad authority to one auditable powerbox** and review what it hands out, not the whole codebase.
- **Confine pure-computation dependencies** (parsers, formatters) in a Compartment or WASM boundary endowed with nothing — that's where supply-chain risk concentrates and where the cost is lowest.
- **`lockdown()` before running any guest.** A guest that can mutate shared primordials escapes regardless of endowments.
- **Grant the minimum WASI preopen and deny sockets by default.** Mediate egress through a host-checked proxy, not a raw socket capability.
- **Treat the macaroon caveat-verification function as security-critical.** Test it adversarially, fail closed on unrecognized caveats, and never accept a token whose caveats you did not evaluate.
- **Use a membrane, not a caretaker, when the holder obtains objects transitively.** A caretaker where a membrane is needed is a silent leak.
- **Migrate ACL→capability on delegation edges first, keep a hybrid.** Identity for audit/authentication, capabilities for fine-grained, delegable authorization.
- **Rotate and scope macaroon root keys per service;** prefer third-party caveats over one omnipotent root.

---

## Edge Cases & Pitfalls

- **Re-imported ambient authority.** A retrofit holds until the next contributor adds `import fs` to a confined module. Without a CI lint rule, the boundary silently erodes.
- **Powerbox bloat.** If "the one place with authority" grows to half the codebase, you have a powerbox in name only. Keep it small and audited.
- **Over-broad WASI preopen / permissive host import.** `--dir /` or a powerful custom host function re-creates ambient authority inside a "sandbox."
- **Membrane identity breakage.** `===`, `instanceof`, and using objects as map keys misbehave across the membrane; some patterns simply cannot cross.
- **Caretaker where a membrane was needed.** Revocation silently misses objects the holder obtained transitively.
- **Macaroon caveat not *checked*.** The signature verifies, the attenuation is cosmetic — the most common macaroon vulnerability.
- **Ambient identity survives the migration.** Converting object authority to capabilities while leaving a thread-local "current user" that handlers reach for keeps the confused-deputy hole open.
- **Confinement mistaken for information-flow control.** Capabilities bound *authority*, not *information*: a confined guest with a real clock or shared cache can still leak bits through timing.
- **Bearer-token theft is total.** A stolen macaroon *is* the authority; keep them short-lived, narrowly scoped, and revocable.

---

## War Stories

**The markdown renderer that could read your secrets.** A team shipped a docs site whose markdown pipeline imported a chain of plugins, one of which transitively pulled in a package that, post-compromise, read `process.env` and POSTed it out. The fix was not a scanner — it was moving the renderer into an SES Compartment endowed with nothing but pure string functions. The malicious update still ran; it just had no `process` and no `fetch`. The lesson the team internalized: *the renderer never needed the authority, so it should never have held it.* Pure-computation dependencies are the cheapest things to confine and the most dangerous to leave ambient.

**The "30-second" token that lived for months.** A storage gateway used macaroons with an `expires < T` caveat to scope download links. A refactor of the verification path checked the HMAC signature and returned early, skipping the caveat-evaluation loop. Signatures verified, so everything "worked" — and every link minted in that window was effectively permanent, because the expiry caveat was never evaluated. It surfaced only when an audit found a months-old "temporary" link still downloading. The fix was a fail-closed verifier that errors on any caveat it doesn't evaluate, plus an adversarial test that mints an *expired* token and asserts rejection. Macaroon security lives entirely in the verifier, not the chain.

**The revocation that revoked nothing.** A multi-tenant analytics product gave each tenant a caretaker over a `Dataset` object and, on tenant offboarding, flipped the caretaker. Tenants who had earlier called `dataset.query(...)` held live `ResultCursor` objects that kept streaming rows long after "revocation," because the caretaker only severed the `Dataset` handle, not the cursors it had vended. Replacing the caretaker with a membrane — wrapping every object that crossed the tenant boundary — made offboarding sever the whole reachable graph at once. The team's takeaway: *if the object you grant vends other objects, you need a membrane or your revocation is a lie.*

**The WASI host that wired the whole disk.** An edge platform ran customer WASM modules and, for "developer convenience," preopened `--dir /`. The modules were "sandboxed" — no ambient authority in the WASM sense — but the sandbox was the entire host filesystem, so a malicious module read other customers' data. The sandbox is exactly as tight as the host's grants; a permissive preopen throws away the entire model. Per-customer, per-directory preopens and default-deny sockets fixed it.

**The confused deputy in the report exporter.** An internal reporting service ran exports "as the service" and accepted an output path from the requesting user. A user supplied a path pointing at a privileged config file; the service, exercising *its* authority on the user's say-so, overwrote it — the textbook confused deputy. The fix was to stop trusting a *path* and start requiring a *capability*: the user had to present a write capability for the destination, which they could only have if they were already authorized to write there. Bundling designation with authority (the capability *is* the path-plus-permission) is precisely what closes the confused-deputy hole.

---

## Common Mistakes

1. **Importing ambient `fs`/`net` in business logic** instead of receiving an injected capability — the original sin every retrofit targets.
2. **Letting the powerbox sprawl** until "the one place with authority" is everywhere.
3. **Running guest/plugin JS without `lockdown()`** — shared mutable primordials make the Compartment porous.
4. **Over-broad WASI preopen** (`--dir /`) or a permissive custom host import re-creating ambient authority.
5. **Verifying a macaroon's signature but never *checking* its caveats** — attenuation becomes decorative.
6. **Using a caretaker where a membrane is required** — revocation silently misses transitively-vended objects.
7. **Converting object authority to capabilities while leaving ambient identity** (thread-local current user) — the confused deputy survives.
8. **Treating confinement as information-flow control** — timing and cache side channels survive.
9. **One omnipotent macaroon root key** everywhere — its theft forges every token.
10. **Trying to convert the whole ACL system at once** instead of starting with delegation edges and staying hybrid.

---

## Tricky Points

- **The retrofit's hardest part is social, not technical.** The mechanical change (import → inject) is easy; convincing a team to accept the friction *before* the payoff, and keeping ambient authority from creeping back via the next PR, is the real work. A CI lint rule turns a discipline into a guarantee.
- **"Confinement is containment, not detection" is the whole supply-chain argument.** You don't have to recognize the malicious dependency; you only have to not hand it a socket. That's why it defends against *future, unknown* compromises that no scanner can catch.
- **Macaroon security is entirely in the verifier.** The cryptography guarantees shrink-only; it guarantees nothing about whether you *evaluate* the caveats. Every macaroon incident is a missing or mis-ordered caveat check, never a broken HMAC.
- **A membrane is the language-level dual of `seL4_CNode_Revoke`.** Both atomically revoke a *subtree* of derived authority — the kernel over a derivation tree, the membrane over a reachable object subgraph. Recognizing them as one pattern at two layers is the professional insight.
- **Bundling designation with authority is what kills the confused deputy.** The bug exists because ambient authority *separates* "what to act on" (a path the user names) from "permission to act" (the deputy's ambient power). A capability fuses them: holding the reference *is* the permission, so a caller can only designate what it was authorized to touch.
- **You will ship a hybrid, and that is correct.** Identity-based ACLs for audit and authentication, capabilities for fine-grained delegable authorization. Purists who demand all-capabilities never ship; the value is in converting the confused-deputy-prone edges.

---

## Test Yourself

1. Take a module that does `import fs` and refactor it to receive a directory capability. Then add the CI lint rule that prevents the ambient import from returning. What does the rule protect against that a code review alone does not?
2. Explain, in supply-chain terms, why running a markdown parser in an SES Compartment endowed with nothing defends against a *future* compromise of that parser, without any scanner or signature.
3. A storage gateway's macaroon link with `expires < T` is still valid months later, yet the HMAC signature verifies. Where is the bug, and write the one assertion in a test that would have caught it.
4. A tenant offboarding flips a caretaker over a `Dataset`, but the tenant's `ResultCursor` objects keep streaming. Explain why, and what pattern fixes it.
5. Describe a confused-deputy bug in a report exporter that accepts an output path, then rewrite the interface so the bug is structurally impossible.
6. Your WASI plugin host preopens `--dir /` for "convenience." What authority did you just grant, and what is the minimal correct grant for a plugin that processes one customer's files?
7. You are asked to migrate an RBAC system to capabilities. Which edges do you convert first and why, and what do you deliberately leave as ACL/RBAC?
8. Why is the Node permission model an *outer* perimeter rather than a replacement for SES Compartments? What does each catch that the other does not?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│        SHIPPING LEAST-AUTHORITY — PROFESSIONAL CHEAT SHEET            │
├──────────────────────────────────────────────────────────────────────┤
│ RETROFIT RECIPE                                                       │
│   1. Inventory ambient reach (grep fs/net/child_process/env)         │
│   2. Push authority to ONE powerbox (main / composition root)        │
│   3. Inject NARROWED capabilities (dir cap, scoped client)           │
│   4. Lint-forbid ambient imports in the business layer (CI gate)     │
├──────────────────────────────────────────────────────────────────────┤
│ DEPLOYABLE CONFINEMENT                                                │
│   SES/Hardened JS  lockdown() + Compartment(endowments)  module-grain │
│   Node perm model  --permission --allow-fs-read=...      process-grain│
│   WASI             preopen dir/socket caps; no --dir=no fs  binary    │
│   seL4 / Fuchsia   handles/CSpace; proof-grade; drivers, hi-assurance │
├──────────────────────────────────────────────────────────────────────┤
│ DISTRIBUTED TOKENS — MACAROONS                                       │
│   HMAC chain: anyone ADDs caveats offline; NONE can remove           │
│   third-party caveat => needs a discharge macaroon (compose svcs)    │
│   PITFALL: verifier MUST evaluate every caveat — fail closed         │
├──────────────────────────────────────────────────────────────────────┤
│ REVOCATION                                                           │
│   caretaker = sever ONE object                                       │
│   membrane  = sever the whole vended subgraph atomically             │
│   rule: holder obtains objects transitively => MUST use a membrane   │
├──────────────────────────────────────────────────────────────────────┤
│ SUPPLY CHAIN                                                         │
│   classify deps by authority NEEDED; pure-compute deps => confine    │
│   "containment not detection": no socket cap => no exfiltration      │
├──────────────────────────────────────────────────────────────────────┤
│ ACL/RBAC -> CAPABILITY MIGRATION                                     │
│   convert DELEGATION edges first (confused-deputy-prone)             │
│   keep HYBRID: identity for audit/authn, caps for fine-grained authz │
├──────────────────────────────────────────────────────────────────────┤
│ REMEMBER: confinement bounds AUTHORITY, not INFORMATION              │
│   timing/cache side channels survive; bearer-token theft is total    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The professional reality of capability security is *capability islands inside ambient systems*: you retrofit least-authority into trust-sensitive parts of an existing codebase rather than starting on seL4.
- The core refactor is **import → inject**: stop grabbing ambient authority (`import fs`/`net`), start receiving narrowed capabilities from a small, auditable **powerbox**, and lint-forbid the ambient path so it cannot creep back.
- **SES/Hardened JS** (`lockdown()` + `Compartment`) confines modules in-process; the **Node permission model** confines the whole process at the perimeter; **WASI preopens** confine untrusted *binaries*; **seL4** and **Fuchsia handles** are proof-grade and OS-scale production capability systems.
- **Macaroons** give distributed tokens capability properties — offline attenuation, delegation, and cross-service composition via third-party caveats — with the standing hazard that *security lives entirely in the verifier*: every incident is a caveat that was never checked.
- **Revocation** demands matching the tool to the spread of authority: a **caretaker** severs one object, a **membrane** severs an entire transitively-vended subgraph atomically. A caretaker where a membrane is needed is a silent leak.
- **Supply-chain defense** is the strongest modern argument: confinement is *containment, not detection* — a dependency with no socket capability cannot exfiltrate, defending against unknown future compromises with no scanner.
- **Migrating ACL/RBAC toward capabilities** pays off most on delegation edges (where confused deputies live), is invasive enough that it must stay **hybrid** — identity for audit, capabilities for fine-grained delegable authorization — and that hybrid is the correct, shippable end state.
- The hard limits remain: capabilities confine **authority, not information** (timing/cache channels survive), and bearer capabilities are total-loss on theft.

---

## What You Can Build

- **A capability-injection retrofit** of one service: convert its business layer from ambient `fs`/`net` to injected capabilities, with a CI lint rule enforcing the boundary, and measure how the security-review question shrinks.
- **A confined-dependency plugin host** in SES: `lockdown()`, run third-party plugins in Compartments endowed with only what each needs, and demonstrate a malicious plugin cannot reach the network.
- **A WASI plugin/edge sandbox** with per-tenant preopens, default-deny sockets, and a policy-mediated egress proxy.
- **A macaroon library with an adversarial verifier test** that proves skipping a caveat check (or mis-ordering it) is caught by CI.
- **A membrane-based multi-tenant store** where tenant offboarding severs the whole reachable graph atomically, with a test proving transitively-vended objects die too.
- **An ACL→capability migration plan** for one delegation edge, with before/after diagrams showing the confused deputy removed and the hybrid boundary documented.

---

## Further Reading

- *seL4: Formal Verification of an OS Kernel* — Klein et al., SOSP 2009; and the seL4 reference manual (CSpace, Mint/Revoke). https://sel4.systems/
- *The Fuchsia Book — Zircon kernel objects, handles, and rights.* https://fuchsia.dev/fuchsia-src/concepts/kernel
- *Macaroons: Cookies with Contextual Caveats for Decentralized Authorization in the Cloud* — Birgisson et al., NDSS 2014. https://research.google/pubs/pub41892/
- *Hardened JavaScript / SES / Compartments* — Agoric/Endo and the TC39 proposal. https://github.com/endojs/endo and https://github.com/tc39/proposal-compartments
- *WASI: The WebAssembly System Interface* — capability-based design docs and the preopen model. https://wasi.dev/
- *Node.js Permission Model* — the `--permission` documentation. https://nodejs.org/api/permissions.html
- *The Confused Deputy (or why capabilities might have been invented)* — Norm Hardy, 1988. https://cap-lore.com/CapTheory/ConfusedDeputy.html
- *Robust Composition: Towards a Unified Approach to Access Control and Concurrency Control* — Mark S. Miller's dissertation (membranes, the powerbox, ocap). http://www.erights.org/talks/thesis/
- *Capsicum: Practical Capabilities for UNIX* — Watson et al., USENIX Security 2010; and OpenBSD `pledge`/`unveil`; Linux Landlock. https://www.cl.cam.ac.uk/research/security/capsicum/

---

## Diagrams & Visual Aids

```
IMPORT (GRAB) vs INJECT (GRANT)
===============================

  AMBIENT:   [ module ] --import fs--> [ ENTIRE FILESYSTEM ]
             authority is INVISIBLE in the signature; reach is unbounded

  CAPABILITY:[ powerbox ] --openDirCap('/app/data')--> [ DirCap ]
                                                          |
                                            inject (constructor arg)
                                                          v
                                                      [ module ]
             authority is EXACTLY DirCap; visible in the signature


POWERBOX AT THE EDGE, CONFINEMENT AT THE CORE
=============================================

   ambient authority lives HERE (audited)         confined here
   +-------------------+                    +------------------------+
   |     POWERBOX      |  --narrowed caps-> |  business logic        |
   |  main / comp root |                    |  (no fs/net imports)   |
   |  fs, net, env     |  --Compartment---> |  risky dependency      |
   +-------------------+                    +------------------------+
   review question: "what does the powerbox hand out, to whom?"


MACAROON ATTENUATION CHAIN
==========================

   issuer:   HMAC(root, "user=alice")               = sig0   (broad)
   client:   HMAC(sig0, "object=42")                = sig1
   client:   HMAC(sig1, "expires<+30s")             = sig2   (strictly weaker)
                 |                                       |
          can only ADD                            verifier re-derives from root
          (HMAC one-way)                          AND checks EVERY caveat <-- fatal if skipped


CARETAKER vs MEMBRANE
=====================

  caretaker:  [holder] --> (X)-> [object]          revoke X: object severed
                              ^                     but vended children survive!

  membrane:   [holder] --> (M)-> [db] -(M)-> [table] -(M)-> [row]
                              every crossing re-wrapped by the same M
              revoke M: db, table, row ALL severed atomically


SUPPLY-CHAIN CONFINEMENT
========================

   AMBIENT:    malicious dep --require('net')--> [ EXFILTRATE ]   (any of 3000 deps)
   CONFINED:   malicious dep --(no socket cap)--> [   blocked  ]   containment, not detection
```
