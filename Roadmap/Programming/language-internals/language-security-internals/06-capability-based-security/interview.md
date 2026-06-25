# Capability-Based Security — Interview Questions

> **Topic:** [Capability-Based Security](README.md)

---

## Introduction

This bank covers capability-based security as it actually comes up in senior and staff interviews: not "define a capability" but "explain the confused deputy and how a capability removes it," "compare ambient authority to capabilities," "design a plugin sandbox," and "where does the macaroon model break." The questions are grouped Conceptual, System-Specific (seL4/KeyKOS/EROS, ocap languages, WASI, file descriptors, macaroons), Tricky-Trap, and Design. Each has a model answer at the depth an interviewer expects to hear — crisp, mechanism-first, with the trade-offs named.

A few answers anchor everything else and are worth over-preparing: the **confused deputy**, the **Principle of Least Authority (POLA)**, **ambient authority vs capabilities**, and **attenuation/revocation**. If you can explain those four with a concrete example each, most other questions become corollaries.

---

## Table of Contents

- [Conceptual](#conceptual)
- [System-Specific](#system-specific)
- [Tricky-Trap](#tricky-trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is a capability, precisely, and what two things does it fuse that ACLs keep separate?**

A capability is an *unforgeable, communicable reference that simultaneously designates a resource and conveys the authority to use it*. The key is the fusion: a capability bundles **designation** ("which resource") with **authority** ("permission to act on it") into one token. ACL systems split these — you *name* a resource by an ambient identifier (a path, an ID) and *separately* a policy check asks whether your identity is permitted. That separation is precisely the gap the confused deputy exploits. With a capability, you cannot name a resource you have no authority over, because naming it *is* holding the authority to it. To act on something you must hold a reference to it; you cannot fabricate the reference; and you can only obtain it if someone with the authority hands it to you.

## Question 2

**Explain the Principle of Least Authority (POLA). How does it differ from "least privilege" as usually practiced?**

POLA says every component should hold exactly the authority needed to do its job, and no more — measured by what it *can do*, not who it *is*. The practical difference from typical "least privilege": least privilege is usually applied at coarse, identity-centric granularity (a service account with a role), and the authority is *ambient* within that boundary — every line of code in the process can use it. POLA pushes the granularity down to the *object/module* level and makes authority *non-ambient*: a function holds only the capabilities passed to it, so the markdown renderer in your process can't touch the network even though the *process* can. POLA is least privilege taken seriously enough to remove ambient authority, which is where the real attack surface lives.

## Question 3

**Define ambient authority and explain why it is the root cause of the confused deputy and most supply-chain exfiltration.**

Ambient authority is power a piece of code can exercise simply by being code in the process — `import fs`, a global socket, `process.env`, the current-user thread-local — without anyone explicitly granting it. It is the default in mainstream languages and OSes. It causes the confused deputy because a privileged component's ambient authority is exercised on a *caller's say-so*: the caller designates a target, the deputy acts with *its own* ambient power, and nothing ties "what to act on" to "who is allowed to act on it." It causes supply-chain exfiltration because *every* transitive dependency inherits the process's ambient authority — any one malicious package can `require('net')` and phone home. Remove ambient authority and both classes evaporate structurally: a component can only act on what it was handed.

## Question 4

**Walk through the confused-deputy problem with a concrete example, then show how a capability removes it.**

The classic example (Hardy, 1988): a compiler service runs with authority to write to a billing/log file. A customer invokes it and passes an output filename. A malicious customer passes the *path of the billing file* as the output path. The compiler, exercising *its own* write authority on the customer's say-so, overwrites billing data. The compiler is the confused deputy — tricked into misusing authority it legitimately holds. The bug exists because designation (the path the customer names) is separated from authority (the compiler's ambient write power). The capability fix: instead of accepting a *path*, the service requires the customer to present a *write capability* for the destination. The customer can only hold such a capability for files they are already authorized to write, so they cannot designate the billing file at all — designation and authority are now fused, and the deputy can act only where the caller had authority.

## Question 5

**Compare attenuation and revocation. Give the mechanism for each in an object-capability setting.**

*Attenuation* is deriving a *weaker* capability from a stronger one — a read-only view of a read-write resource, a single-method facet of a rich object, a directory capability bound to one subtree. Mechanism: wrap the strong capability in an object that exposes only the reduced operations (a facet), or in a macaroon with an added caveat. *Revocation* is *taking back* a granted capability. Mechanism: a **caretaker** — a revocable indirection wrapping one capability that throws once flipped — or, for a capability that vends other capabilities, a **membrane** that wraps every object crossing the boundary so the whole reachable subgraph can be revoked atomically. Attenuation happens at grant time and is permanent for that derived capability; revocation happens later and requires you to have kept the indirection (the caretaker/membrane) on your side.

## Question 6

**What is a facet, and how does it implement attenuation?**

A facet is a restricted view of an object that exposes a subset of its operations. If you have a `BankAccount` with `deposit`, `withdraw`, and `balance`, you can hand an untrusted party a *deposit-only facet* — an object whose only method forwards `deposit` to the real account and exposes nothing else. The party holds a real capability, but an attenuated one: it can deposit and literally cannot withdraw, because the withdraw method does not exist on the facet. Facets implement attenuation by *omission* — you give out a smaller interface, and the absence of the powerful methods is the security. They compose: a facet of a facet is further attenuated.

## Question 7

**Why does the object-capability model say "the object reference graph IS the authority graph"?**

In an ocap language, the only way to affect an object is to hold a reference to it and invoke a method; the only ways to obtain a reference are by initial conditions, by being passed one (parenthood, endowment, introduction), or by creating an object. There is no ambient way to reach an object you don't have a reference to — no global lookup, no `File("/path")` that conjures authority. Therefore the set of objects a given object can affect is exactly the set reachable through its reference graph, and authority propagates only by passing references. Reasoning about "what can this code do" reduces to "what is reachable from its references," which is a bounded, analyzable question — the property that makes confinement provable.

## Question 8

**How do capabilities relate to the Principle of Least Authority being *enforced* rather than *encouraged*?**

ACL/RBAC systems *encourage* least privilege: you can configure narrow roles, but ambient authority means the code can still reach further than its role implies in practice, and discipline is by convention. Capabilities *enforce* POLA: if a module was never handed a socket capability, no amount of code in it can open a socket — the authority isn't there to misuse. The enforcement comes from the absence of ambient authority plus unforgeability. This is why "capability discipline by convention is only as strong as the most careless `import os`" — the moment ambient authority exists, the enforcement is gone and you're back to encouragement.

---

## System-Specific

## Question 9

**In seL4, what does "everything is a capability invocation" mean, and why is there no `open("/path")`?**

In seL4 there is no ambient namespace and no ambient authority. Every operation — sending IPC, mapping a page, starting a thread, touching a device register — is the *invocation of a capability* held in the process's capability space (CSpace), addressed by a slot index the process cannot forge into a different object. There is no global file namespace, so there is no `open("/etc/passwd")` that consults one; a process can act on a kernel object only if it holds a capability to it in a CSpace slot. The kernel's entire job is the unforgeable translation from "slot index in this CSpace" to "kernel object + rights." Authority is therefore exactly the set of capabilities in your CSpace — a small, explicit, closed statement, which is what makes formal verification tractable.

## Question 10

**What is the seL4 derivation tree, and what does `seL4_CNode_Revoke` do?**

Capabilities in seL4 form a *derivation tree*: from a parent capability you can mint children, usually with reduced rights or a badge (`CNode_Mint`), and those children can be minted further. The kernel tracks this parent→child structure. `seL4_CNode_Revoke` on a capability deletes the *entire subtree of descendants* derived from it, in bounded time. This is membrane-style transitive revocation, but in the kernel and over the derivation tree rather than an object subgraph — it is the kernel analog of revoking a membrane. It's what lets you mint and hand out many attenuated children and then sever all of them with one operation when the relationship ends.

## Question 11

**What did KeyKOS and EROS contribute, and what does seL4's formal verification actually prove?**

KeyKOS (and its descendants EROS/CapROS) were persistent, capability-based operating systems that established the lineage: everything is a capability invocation, capabilities are the sole authority, and confinement is a first-class, provable property (EROS proved its confinement mechanism). seL4 inherited that stance and added a machine-checked proof: its C implementation is proven to *refine* an abstract specification, and the spec is proven to enforce **integrity** (no unauthorized modification) and **authority confinement** (a subject cannot acquire authority it was not given). Crucially, the proof is *enabled by* the capability model — "your authority is the capabilities you hold" is a bounded statement you can reason about formally, which you cannot write crisply for an ambient-authority system.

## Question 12

**Name three object-capability languages/runtimes and the mechanism each uses to remove ambient authority.**

- **E** (Miller et al.) was designed from scratch with no ambient authority; capabilities are object references, distributed objects use eventual-send, and the powerbox pattern originates here.
- **Joe-E** is a verified ambient-authority-free *subset of Java*: it removes static mutable state, `java.io.File`, reflection, and `finalize`, leaving a language where the heap reference graph is the authority graph.
- **SES / Compartments (JavaScript)** *freezes the primordials* with `lockdown()` and runs guest code in a `Compartment` whose globals contain only the endowments you pass — withhold `fetch` and the guest cannot do network I/O.

(Also valid: **Pony**, which encodes capabilities in its type system via reference capabilities `iso/val/ref/box/trn/tag`; **Newspeak**, which has no global namespace at all and feeds modules their dependencies through a manifest.)

## Question 13

**How does Pony's type system provide capability security, and how is that different from SES?**

Pony bakes *reference capabilities* into the type system: six qualifiers — `iso` (isolated, unique mutable), `val` (immutable, freely shareable), `ref` (mutable, not shareable), `box` (read-only view), `trn` (transition), `tag` (identity only, no read/write) — that the compiler statically checks. They guarantee shared data is either immutable or uniquely owned, giving data-race freedom *and* a static foundation for object-capability security. The difference from SES: Pony enforces at *compile time* through types, so violations are type errors; SES enforces at *runtime* by withholding ambient globals from a frozen realm. Pony's is static and language-wide; SES's is dynamic and scoped to a Compartment you can apply to untrusted code inside an otherwise-ambient JS process.

## Question 14

**In WASI, how does a module get filesystem access, and what happens with no preopen?**

WebAssembly core has no I/O. WASI grants it on a strict capability basis: there is no `open("/etc/passwd")`. At startup the host **preopens** directories (and sockets) and hands the module file descriptors for them. The module's `path_open` can only resolve a path *relative to a preopen it already holds*. So `wasmtime --dir /sandbox` gives the module a filesystem of exactly `/sandbox`; with no `--dir` the module has *no filesystem at all*. The same applies to sockets, clocks, and randomness — each is an explicitly granted capability, not ambient. This is the cleanest mainstream capability model: it starts from zero authority and makes every grant explicit, so a module handed no socket cannot reach the network, period.

## Question 15

**Why are Unix file descriptors considered capabilities, and where does the analogy break?**

A file descriptor is unforgeable (you can't make up an integer and have it refer to an arbitrary file — the kernel maps fd→open-file-entry per process), it conveys authority (holding the fd lets you read/write per its mode), and it's communicable (you can pass it over a Unix domain socket via `SCM_RIGHTS`, even to another process). That's a capability. Where it breaks: Unix surrounds fds with *ambient* authority — `open("/path")` consults a global namespace, so you can mint an fd to anything the *process* is allowed to access, by name, at any time. The fd is a capability, but the system that hands them out is ambient. Capability discipline on Unix means removing that ambient `open` (e.g., Capsicum's `cap_enter`, which leaves you only the fds you already hold and `openat` relative to directory fds).

## Question 16

**Explain how a macaroon works and why any holder can attenuate it offline.**

A macaroon is a bearer token built as an HMAC chain. The issuer signs an identifier with a root secret to get the initial signature. To add a **caveat** (a restriction like `expires < T` or `object = 42`), *anyone* holding the macaroon re-HMACs the current signature using the caveat text as the key, producing a new signature. Because HMAC is one-way, you can only ever *add* caveats — you can't recover an earlier signature to remove one — so every derived macaroon is *strictly weaker*. That's why any holder can attenuate offline with no issuer round-trip: the cryptography makes "shrink-only" a law. The verifier re-runs the entire chain from the root secret to confirm integrity, then must evaluate every caveat.

## Question 17

**What is a third-party caveat and what problem does it solve?**

A first-party caveat restricts the macaroon directly (`expires < T`). A *third-party caveat* says "this macaroon is valid only if you also present a **discharge macaroon** from some other service proving a predicate" — e.g., "valid only with a discharge from the auth service proving the user is an admin." The holder must contact that third party, satisfy the predicate, and obtain the discharge macaroon, which it then presents alongside the original. This composes authority *across services without a shared session store*: the proof travels with the request, so service B can require an attestation from auth service C without B and C sharing state. It's the macaroon answer to distributed, cross-service authorization.

## Question 18

**How do macaroons differ from OAuth scopes / JWTs in trust topology?**

With OAuth/JWT, scopes are fixed at issuance and can only be *narrowed by the issuer* — a client that wants a tighter token must go back to the authorization server. The client cannot be trusted to narrow its own token because nothing stops it from widening. Macaroons invert this: HMAC one-wayness makes widening cryptographically impossible, so a *client* can be trusted to attenuate and delegate offline, and third-party caveats let authority compose across services without a central session store. The trade-off: macaroons are bearer secrets (theft = authority), tooling is less ubiquitous than JWT, and the verifier must actually *check* every caveat or the attenuation is decorative.

---

## Tricky-Trap

## Question 19

**"We use RBAC with very fine-grained roles, so we already have least authority." What's wrong with this?**

The fineness of the roles doesn't remove *ambient authority*. Even with perfect roles, within the process every line of code can exercise the role's full authority — the markdown renderer can use the database credential the service holds. RBAC answers "is this *identity* allowed?"; least authority in the capability sense is about "what can this *code object* reach?" Fine-grained roles still leave you exposed to the confused deputy (the deputy acts with its role on a caller's say-so) and to supply-chain exfiltration (any dependency inherits the role's authority). Granular roles are good, but they are least *privilege by identity*, not least *authority by possession* — different axis, different attack surface.

## Question 20

**A guest runs in an SES Compartment with no `fetch` and no `fs`. Is it confined? What could still go wrong?**

Mostly, but two traps. First, **`lockdown()` must have run** and the host must not share *mutable* intrinsics: if the guest can mutate `Object.prototype` or `Array.prototype`, it can attack the host's own objects and escape through them — the Compartment endowments are irrelevant if primordials aren't frozen. Second, **capabilities confine authority, not information**: a guest with a real clock or a shared cache can still leak bits through timing side channels even with no `fetch`. So "no network capability" prevents the guest from *exfiltrating actively*, but doesn't prevent covert channels, and it doesn't help at all if primordials were left mutable or the guest ran before `lockdown()`.

## Question 21

**A macaroon's signature verifies, but a user accessed object 99 despite an `object = 42` caveat. Where's the bug?**

The bug is in the *verifier*, not the cryptography. HMAC chaining guarantees the caveat `object = 42` could not have been *removed* — it's still in the macaroon, and the signature proves the chain is intact. But signature verification only proves *integrity of the caveat list*; it does *not* evaluate the caveats. The verifier checked the HMAC and accepted the token without running the per-caveat check that compares the requested object to 42. This is the single most common macaroon vulnerability: the attenuation is cryptographically sound but *decorative* because the verifier never enforced it. Fix: a fail-closed verifier that evaluates every caveat and rejects any it doesn't recognize.

## Question 22

**A program calls `cap_enter()` (Capsicum) and then `open("/tmp/log")` fails. Why, and how should it have written its log?**

`cap_enter()` puts the process into *capability mode*, which removes ambient authority — including the global namespace that `open("/path")` consults. After `cap_enter()` there is no way to name a file by absolute path; you can only use file descriptors you already hold and `openat()` relative to a *directory capability* (a directory fd) you hold. So `open("/tmp/log")` fails because it requires the ambient namespace that capability mode revoked. The program should have opened the log file (or its containing directory) *before* `cap_enter()`, then either written to the held fd or used `openat(logdir_fd, "log", ...)` relative to the pre-acquired directory capability. Order matters: acquire authority first, then cross the line.

## Question 23

**A team revokes a tenant's access by flipping a caretaker over the `Dataset` object, but the tenant keeps streaming rows. Why?**

Because `Dataset` *vends* other objects: the tenant earlier called `dataset.query(...)` and obtained `ResultCursor` objects, which are *separate live references* with their own authority. The caretaker wraps only the `Dataset` handle, so flipping it severs `dataset` but does nothing to the cursors already handed out — they keep working. The caretaker pattern revokes one object; it does not follow the objects that object produced. The fix is a **membrane**: wrap every object that crosses the tenant boundary (arguments in, results out) with the same revocation switch, so revoking the membrane severs the *whole reachable subgraph* — dataset, cursors, rows — atomically. Rule of thumb: if the granted object vends other objects, a caretaker's revocation is a lie; use a membrane.

## Question 24

**"A WASI module has no filesystem, so it's safe." A pen-tester reads `/etc/passwd`. What two host misconfigurations explain this?**

The sandbox is only as tight as the *host's grants*. Two host-side mistakes: (1) **Over-broad preopen** — the host launched the module with `--dir /` (or `--dir /::/`), so the module's "sandbox" is the entire host filesystem and `/etc/passwd` is in scope. (2) **A permissive custom host import** — the host exposed a function to the module (e.g., a "read any file" helper or a debug import) that itself exercises ambient host authority, re-creating ambient access through the import surface even if preopens are tight. In both cases WASI confined the *module* correctly; the *host* handed it too much. The host's preopens and custom imports are authority and must be minimized like any other grant.

## Question 25

**Why do object-capability languages tend to withhold `Date.now()` and `Math.random()` from guests? Give both reasons.**

Two reasons, both real. **Authority/observability:** a real clock and a real RNG are channels — a clock lets a confined guest measure timing (a covert channel and a fingerprinting vector), and shared nondeterminism can leak information across a boundary. **Determinism:** withholding them makes guest execution deterministic, which is essential for reproducibility, for running the same computation on multiple replicas and comparing (consensus, blockchains, deterministic replay), and for testing. So it's not paranoia about `Date` specifically — it's that the same ambient globals carry *both* a covert channel *and* nondeterminism, and ocap realms tend to want neither. When a guest legitimately needs time or randomness, you supply an *attenuated, deterministic* version as an explicit capability.

## Question 26

**Isn't a bearer token (macaroon, fd you can pass) a security weakness because it carries no identity?**

It's a deliberate trade-off, and it's the same property that makes it powerful. Bearer capabilities embody "possession is the permission" — whoever holds it is authorized, which is exactly what enables frictionless delegation (hand it over, no identity plumbing) and offline attenuation. The cost is that theft is *total*: the thief *is* authorized, with no identity check to fail. This is why bearer capabilities must be short-lived, narrowly scoped (attenuated to the minimum), revocable (caretaker/membrane or short expiry caveats), and transmitted only over confidential channels. You don't fix the bearer property; you bound its blast radius. The mistake is treating a long-lived, broad bearer token as if it were an identity-bound credential.

---

## Design

## Question 27

**Design a plugin host that runs untrusted third-party JavaScript plugins. What's your capability strategy?**

Start from zero authority and endow explicitly. `lockdown()` first so guests can't poison shared primordials. Run each plugin in its own `Compartment` whose globals contain *only* the capabilities that plugin's declared function needs — typically a logger, a scoped read-only config, and a narrow host API, and *deliberately* no `fetch`/`fs`/`process`. For any host capability a plugin needs (say, a key-value store), pass an *attenuated facet* (this plugin's namespace only), and wrap stateful object graphs in a **membrane** so that disabling a plugin severs everything it ever reached. For network egress, don't hand a raw socket; expose a host-mediated, policy-checked `fetch`-like function so you can rate-limit, allowlist, and audit. Result: a malicious plugin has no path to exfiltrate or reach other plugins, and removal is clean.

## Question 28

**Design the authority model for a multi-tenant SaaS so that a compromised tenant-handling code path cannot read another tenant's data.**

Make tenant data reachable only through a per-tenant capability, never through ambient identity. The request handler obtains a `TenantStore` capability scoped to exactly one tenant (the powerbox at the request boundary mints it from the authenticated tenant ID); downstream code receives *that* and has no ambient way to name another tenant's data — there is no `db.table('orders').where(tenant=...)` reachable, only the scoped store. Wrap the store in a **membrane** so offboarding severs the tenant's whole reachable graph atomically, including any cursors/rows it vended. The security property: even a bug or compromise in tenant-handling code can only reach the tenant whose capability it holds, because cross-tenant data is simply not reachable from its references. Contrast with the ambient-identity design where a missing `WHERE tenant_id = ?` leaks everything.

## Question 29

**Design a "share this document by link" feature using capabilities. How do you support read-only, expiry, and revocation?**

The link *is* a capability — ideally a macaroon. Mint a macaroon scoped to the document (caveat `object = doc123`), attenuate to read-only (caveat `method = GET` or `access = read`), and add an expiry caveat (`expires < T`). The sharer (a *client*) can attenuate further offline before sending — e.g., add a tighter expiry — without contacting the server, because HMAC forbids widening. The verifier checks the chain from the root key and *evaluates every caveat* (fail closed). For revocation, either rely on short expiry caveats (simplest), or include a caveat referencing a revocation list / version the verifier checks (e.g., `link-version = 7`, and bump the document's accepted version to invalidate outstanding links). Rotate the document's root key to revoke *all* links at once. Bearer nature means: HTTPS only, short-lived, minimal scope.

## Question 30

**Design cross-service delegation (service A calls service B on behalf of user U) without the confused deputy and without a shared session store.**

Don't forward U's full identity to B — that's the confused-deputy setup (B can't tell whether A is doing what U authorized or more). Instead, U's request grants A a capability *attenuated to exactly the action U authorized*: a macaroon with caveats pinning the operation and object. A presents *that* macaroon to B; A can only ever exercise what it was granted, so it cannot widen the request. For requirements that depend on a third service (e.g., "only if U is an admin"), use a **third-party caveat** discharged by the auth service — the discharge macaroon travels with the request, so B can require the attestation without B and the auth service sharing a session store. Net: A is structurally incapable of acting beyond U's grant, and authority composes across A/B/auth with no central state.

## Question 31

**You're asked to migrate a large ACL/RBAC system toward capabilities. How do you stage it, and what do you keep as ACL?**

Don't convert everything — convert the *confused-deputy-prone delegation edges* first: cross-service "act on behalf of," share-by-link, scoped third-party API tokens, per-tenant data access. Replace identity-forwarding with attenuated capabilities (macaroons) on those edges, which structurally removes the confused deputy. Keep ACL/RBAC for *coarse, identity-centric, auditable* decisions ("is this user a member of this org?", authentication, compliance "who did it?"). The end state is a deliberate hybrid: identity for audit and authentication at the boundary, capabilities for fine-grained, delegable, attenuable authorization inside it. Stage it additively and reversibly (feature-flagged per edge) because no organization will approve a big-bang authorization rewrite, and because the value concentrates on a few edges, not the whole policy surface.

## Question 32

**Design supply-chain confinement for a service with thousands of dependencies. What's your classification and mechanism?**

Classify each dependency by the authority it *legitimately needs*. The large majority — parsers, formatters, math, string utilities — need *nothing* but pure computation; run those confined (SES Compartment with no dangerous endowments, or a WASM boundary with no socket/fs), so a compromise has no path to exfiltrate. A small set — HTTP clients, DB drivers, the framework — genuinely need I/O authority; those you must trust, pin, and ideally wrap in narrowing facets (the DB driver gets a scoped connection, not the whole config). The mechanism's value is *containment, not detection*: you don't scan for malice, you remove the path — no socket capability means no exfiltration regardless of what the code wants. This turns "we trust 3,000 packages" into "40 hold real authority; 2,960 are confined."

## Question 33

**When would you reach for seL4 / a capability microkernel instead of language-level ocap or WASI?**

When the trust boundary is between *processes/components on one machine* and you need *proof-grade* isolation — the security property must be *verified*, not tested. seL4 fits high-assurance domains (defense, avionics, automotive, secure phones) where a formal proof of authority confinement and integrity is a requirement, and where you can afford a microkernel architecture in which every component receives its authority as capabilities. Use *language-level ocap* (SES) when the untrusted code is a *module inside your process*; use *WASI* when it's an untrusted *binary*; use a *capability kernel* when it's untrusted *services/drivers* and you need a machine-checked guarantee. The granularity and enforcement layer follow the trust boundary; seL4 is the answer when the boundary is at the OS component level and "we tested it" isn't sufficient assurance.

## Question 34

**Design revocation for a capability you've handed to a partner integration, knowing they may have passed it deeper into their own system.**

Two layers. If the capability is an *object* (in-process), use a **membrane**, not a caretaker: wrap every object that crosses to the partner so that whatever they obtained transitively from it is also wrapped, and one `revoke()` severs the whole subgraph atomically — this handles the "they passed it deeper" case, which a caretaker would miss. If the capability is a *distributed token* (a macaroon they may have delegated downstream), you cannot reach into their system, so design for revocability up front: short-lived expiry caveats so unused authority dies quickly, a version/epoch caveat the verifier checks against a revocation list, and a per-partner root key you can rotate to kill *all* their outstanding (and re-delegated) tokens at once. The principle: when authority can spread beyond your reach, revocation must be designed in (membrane or key/version invalidation), not bolted on.

## Question 35

**A junior proposes "we'll just audit every dependency's source for network calls" as supply-chain defense. Critique and offer the capability alternative.**

Auditing source is *detection*, and detection of supply-chain malice is a losing game: the malicious code may be obfuscated, may activate only under conditions you don't trigger, may arrive in a *future* update after your audit, and the attack surface is thousands of transitively-evolving packages you can't re-audit on every release. The capability alternative is *containment*: don't try to recognize the malicious behavior, remove the *path* for it. Run pure-computation dependencies with no socket and no filesystem capability (Compartment or WASM); then a malicious version has nowhere to exfiltrate *regardless of what its code does or when it was added*. Detection scales with attacker cleverness and dependency churn; containment scales with your discipline about what authority you hand out. Use both if you like, but containment is the structural defense.

---

## Summary

The interview backbone is four ideas applied repeatedly: the **confused deputy** (a deputy misuses its ambient authority on a caller's say-so because designation is split from authority), **POLA** (least authority by possession, enforced by the absence of ambient authority), **ambient authority vs capabilities** (grab vs grant; the reference graph is the authority graph), and **attenuation/revocation** (facets and caveats shrink authority; caretakers and membranes take it back — membranes when authority spreads transitively). System-specific depth comes from knowing the mechanism in each setting: seL4's CSpace and `Revoke` over a derivation tree, ocap languages withholding ambient globals, WASI preopens, fds-as-capabilities-with-an-ambient-`open`, and macaroons whose security lives entirely in the verifier checking every caveat. Design questions are corollaries: confine the dependency, scope the tenant, attenuate the link, delegate without forwarding identity, and prefer containment over detection.
