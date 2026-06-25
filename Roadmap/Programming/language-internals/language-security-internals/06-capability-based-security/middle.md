# Capability-Based Security — Middle Level

> **Topic:** [Capability-Based Security](README.md)
> **Focus:** The object-capability model as a set of rules — no ambient authority, the three sources of capabilities, attenuation, revocation, and how to *retrofit* least authority onto ordinary code.

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

> Focus: **The object-capability (ocap) model stated as rules you can check**, and the engineering of attenuation, delegation, and revocation.

At the junior level a capability was "a key": an unforgeable token that fuses designation and authority. That intuition is correct but informal. At this level we make it a *model* with rules precise enough to reason about and to audit.

The **object-capability model** (ocap) is the cleanest statement of capability security, due to Mark Miller, Jonathan Shapiro, and the lineage of KeyKOS/EROS/E. Its rules are deceptively short:

1. **No ambient authority.** There is no way to *name* a resource except through a reference you already hold. No global `open`, no path namespace, no "look it up." If you do not hold a reference to something, that something does not exist for you.
2. **Authority propagates only by reference-passing.** A subject can obtain a new capability in exactly three ways: it was *endowed* with it at creation, it was *introduced* to it (passed as an argument by someone who holds it), or it *created* the resource itself (parenthood). This is summarized as **"connectivity begets connectivity."**
3. **References are unforgeable.** You cannot manufacture a valid reference from data. In a memory-safe language this is the type system and GC; in a kernel it is an opaque handle the kernel translates.

From these three rules everything else follows: confined subjects, the impossibility of the confused deputy, POLA as the default, and the ability to *prove* what a component can reach by following its references.

This page covers: the ocap rules and what each forbids; the difference between a capability and a *facet* (a wrapper that attenuates); the **caretaker/revoker** pattern that makes capabilities revocable; how delegation and attenuation actually compose; and the practical work of **retrofitting** least authority onto code that was written assuming ambient `fs` and `net`.

---

## Prerequisites

- **Required:** The junior level — confused deputy, ambient authority, the fusion of designation and authority, POLA.
- **Required:** Comfort with closures / first-class functions and object references in at least one memory-safe language (JS, Python, Java, Go).
- **Required:** A working idea of what "trust boundary" means.
- **Helpful:** Familiarity with dependency injection as a design technique.
- **Helpful:** Exposure to Unix file descriptors and how `open()` returns a handle.

You do **not** yet need:

- Capability-OS kernel internals (seL4 cap derivation trees) — that's `senior.md`/`professional.md`.
- Formal confinement proofs or the take-grant / ocap calculus — `senior.md`.
- WASI host-runtime implementation details — `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Object-capability model (ocap)** | A capability model where capabilities *are* references in a memory-safe language; the three rules (no ambient authority, propagation only by reference-passing, unforgeable references) define it. |
| **Facet** | A distinct object that wraps another and exposes a *subset* of its behavior — the standard way to attenuate. Multiple facets can front one underlying object. |
| **Attenuation** | Producing a capability that is *strictly weaker* than one you hold (read-only, single resource, rate-limited, expiring). |
| **Amplification** | The (rarer) inverse: combining capabilities to gain authority neither had alone. Requires explicit support (e.g., a sealer/unsealer pair). |
| **Caretaker / revoker** | A forwarding facet you insert between holder and resource so you can later *sever* the link — the canonical revocation pattern. |
| **Sealer / unsealer** | A paired capability: the sealer boxes a value so only the matching unsealer can open it. The ocap equivalent of encrypt/decrypt for in-process values; enables rights amplification. |
| **Endowment** | The capabilities a subject is born with, given by its creator. |
| **Introduction** | Gaining a capability because someone who holds it passed it to you. |
| **Parenthood** | Gaining a capability by *creating* the resource it controls. |
| **Confinement** | The property that a subject cannot leak or acquire authority beyond what it was given — provable from the three rules. |
| **Powerbox** | A trusted broker that holds broad authority and hands out narrow, attenuated capabilities on request (often with user consent). The "file open dialog" is a powerbox. |
| **Ambient authority** | (Recap) Authority available from the environment without being explicitly granted for the call. The thing ocap forbids. |
| **Trusted Computing Base (TCB)** | The set of components whose correctness security depends on. Capability discipline aims to *shrink* it. |

---

## Core Concepts

### 1. The Three Rules, Stated to Be Checkable

Treat ocap as a checklist you can run against a design:

- **Rule 1 — No ambient authority.** *Can any component reach a resource without holding a reference to it?* If yes (a global `open`, a static registry, a singleton DB connection, an env-var read), you have ambient authority and the model's guarantees do not hold. The test: delete the import of every authority source and see what still compiles. Anything that still reaches the world was using ambient power.
- **Rule 2 — Propagation only by reference-passing.** *Can a component gain a new capability by any means other than endowment, introduction, or parenthood?* If there is a `lookupByName`, a service locator, a reflection-based `Class.forName(...).newInstance()` that grabs authority, the answer is yes and Rule 2 is broken.
- **Rule 3 — Unforgeability.** *Can a component fabricate a valid capability from data it controls?* Integer-indexed handles you can guess, predictable URLs, type-confusion in an unsafe language — all break unforgeability. In a memory-safe language, references are unforgeable for free; in C or with `unsafe`, you must enforce it.

When all three hold, a component's reachable authority equals the transitive closure of the references it holds — and *nothing else*. That single fact is the whole value proposition.

### 2. Capability vs Facet

A raw capability is the underlying object/handle. A **facet** is a wrapper object that mediates access to it. Facets are how you do everything interesting:

- **Attenuate:** a facet that forwards only `read`, dropping `write`.
- **Revoke:** a facet that forwards until you flip a switch, then forwards to nothing.
- **Log/audit:** a facet that records each use before forwarding.
- **Rate-limit:** a facet that forwards only N times per second.

The holder of a facet cannot tell (and cannot reach) what is behind it. They can only do what the facet exposes. This is the in-process analog of a reverse proxy.

### 3. Attenuation Is the Normal Case, Not the Exception

In a healthy capability design, almost no one holds a *raw* powerful capability. The filesystem authority lives in one place; everyone else holds *attenuated facets*: "a read handle to this one file," "a write handle to this one directory," "an HTTP client locked to this one host." You attenuate **at every hand-off**: when you delegate downstream, you pass the weakest sufficient facet. Over a call graph, authority monotonically *narrows* the further it travels from its source — the opposite of ambient authority, where every callee inherits everything.

### 4. Revocation: The Caretaker Pattern

A raw capability, once handed out, cannot be taken back — the holder has the reference and you cannot reach into their memory. So **you never hand out the raw capability if you might need to revoke.** Instead you hand out a **caretaker**: a forwarding facet that you also hold a control handle to.

```text
   holder ──► [ CARETAKER facet ] ──forwards──► [ real resource ]
                     ▲
                     │ revoke() flips an internal switch
              you hold the control side
```

After `revoke()`, the caretaker forwards to nothing (or throws). The holder still has *their* reference — but it now points at a dead forwarder. You revoked authority without touching the holder's memory. This is the standard, and it composes: a caretaker can wrap a caretaker.

### 5. Delegation and the Diamond

Capabilities delegate transitively: if A gives a (caretaker) capability to B, and B passes it to C, then C can use the resource — *and A can still revoke all of them at once* by killing the original caretaker, because B and C both forward through it. This is far cleaner than ACLs, where revoking a permission that has been re-granted through several layers is a notoriously hard problem ("the revocation problem"). With caretakers, revocation is just "stop forwarding."

### 6. The Powerbox: Where Broad Authority Is Allowed to Live

Total no-ambient-authority would mean no component can ever do anything new. The escape valve is the **powerbox**: a single, trusted, audited component that *does* hold broad authority (the real filesystem, the real network) and whose job is to **hand out narrow, attenuated capabilities** — usually mediated by policy or user consent. The macOS/Windows "open file" dialog is a powerbox: the app has no filesystem authority, but when the user picks a file, the OS hands the app a capability to *that one file*. The user's act of choosing *is* the grant. This keeps the powerful authority in one auditable place and makes grants explicit and intentional.

### 7. Retrofitting Least Authority onto Ordinary Code

Most real code is ambient: it `import os`, `import requests`, reads env vars, opens a global DB pool. You retrofit toward capabilities incrementally:

1. **Find the authority sources.** Grep for `open`, `socket`, `requests`, `os.environ`, `subprocess`, global singletons.
2. **Push them to the edge.** Move every authority acquisition up to a single `main`/composition-root.
3. **Inject downward.** Pass the resulting handles (or attenuated facets) as parameters, so inner modules import *no* authority.
4. **Attenuate at boundaries.** Where a module only needs to read one directory, give it a facet for that directory, not the real `open`.

The end state: a thin "impure shell" at the top that holds all real authority, and a large "capability-pure core" that can only act through what it was handed. This mirrors functional-core/imperative-shell design, but the discipline is about *authority*, not side effects.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Facet** | A receptionist who will pass your message to the CEO but won't let you into the CEO's office. A controlled front for a powerful object. |
| **Attenuation** | A guest Wi-Fi password that gets you internet but not the internal network. |
| **Caretaker / revocation** | A parking valet's keypad fob the garage can deactivate. The fob still exists; it just stops opening the gate. |
| **Delegation diamond** | You lend a contractor a building key; they lend it to a subcontractor. Building management can rekey the lock once and lock out both. |
| **Powerbox** | The hotel front desk: the only place with master access, handing out single-room cards on request. |
| **Sealer / unsealer** | A tamper-evident diplomatic pouch: only the holder of the matching seal can open it. |
| **Confinement** | A clean room: whatever's inside can only interact through the airlocks you installed. |
| **Composition root** | The building's main electrical panel: all power enters here and is distributed on labeled circuits. |

---

## Mental Models

### The "Authority Narrows Downhill" Model

Picture authority as water entering at the top of your program (the composition root, the powerbox). As it flows down the call graph, every hand-off can only *narrow* the stream (attenuate) — never widen it. A leaf function is at the bottom holding a trickle: exactly one read handle. Contrast ambient authority, where every function stands in the same ocean. Designing well is arranging the plumbing so each component sits in the smallest puddle that lets it work.

### The "Revoke Is a Forwarder You Kill" Model

You cannot delete a reference out of someone's hand. So revocation is never about *their* reference — it is about *the thing their reference points at*. Always interpose a forwarder you control. Revocation = "make the forwarder forward to a wall." Carry this and you will design revocability in from the start, instead of discovering you handed out raw keys you can never reclaim.

### The "Follow the References to Audit" Model

To answer "what could this component possibly do?", do not read a policy file. Start from the references it was endowed with and the arguments it was passed, and take the transitive closure: what those references let it reach, what *those* let it reach, and so on. Under the three rules, that closure is the *complete* answer — there is no hidden ambient back door. Security review becomes graph reachability.

---

## Code Examples

### Attenuation by Facet (TypeScript / JS)

```ts
// The raw capability: a full read/write file handle.
interface FileCap {
  read(): string;
  write(data: string): void;
  delete(): void;
}

// A read-only FACET: same shape minus the dangerous methods.
function readOnly(file: FileCap): { read(): string } {
  return { read: () => file.read() };   // forwards read; write/delete unreachable
}

// A logging facet that wraps and observes.
function audited(file: FileCap, log: (m: string) => void): FileCap {
  return {
    read:   ()   => { log("read");          return file.read(); },
    write:  (d)  => { log(`write ${d.length}`); file.write(d); },
    delete: ()   => { log("delete");        file.delete(); },
  };
}

// Hand a plugin the weakest sufficient capability:
runPlugin(readOnly(audited(theFile, console.log)));
// the plugin can ONLY read, and every read is logged.
```

### The Caretaker / Revoker Pattern (JS)

```js
// Wrap any object so its authority can be revoked later.
function makeCaretaker(target) {
  let live = target;                       // the only reference to the real object
  const facet = new Proxy({}, {
    get(_, prop) {
      if (live === null) throw new Error("revoked");
      const v = live[prop];
      return typeof v === "function" ? v.bind(live) : v;
    },
  });
  const revoke = () => { live = null; };   // control side: severs the link
  return { facet, revoke };
}

const { facet, revoke } = makeCaretaker(theBankAccount);
giveToUntrustedCode(facet);   // they hold the facet, not the account
// ... later, on suspicion ...
revoke();                     // every future call through `facet` now throws
```

JavaScript even has this built into the language: `Proxy.revocable(target, handler)` returns `{ proxy, revoke }` for exactly this purpose. The holder keeps their reference; you keep the kill switch.

### Sealer / Unsealer (rights amplification, JS)

```js
// A matched pair: only the unsealer can open what the sealer boxed.
function makeBrand() {
  const boxes = new WeakSet();
  const contents = new WeakMap();
  const seal = (value) => {
    const box = Object.freeze({});         // opaque token
    boxes.add(box); contents.set(box, value);
    return box;                            // can be passed through untrusted code
  };
  const unseal = (box) => {
    if (!boxes.has(box)) throw new Error("not my box");
    return contents.get(box);              // only THIS unsealer recovers it
  };
  return { seal, unseal };
}
// Used to safely carry a privileged value through code that must not read it,
// and to amplify rights: holding BOTH a box and the matching unsealer = access.
```

### Retrofitting: Ambient → Injected (Python)

```python
# BEFORE: ambient authority scattered through the module.
import os, requests
def sync_user(uid):
    data = requests.get(f"https://api.internal/users/{uid}").json()  # any host
    with open(f"/data/{uid}.json", "w") as f:                        # any path
        f.write(str(data))
    return os.environ["SIGNING_KEY"]                                  # any env var

# AFTER: authority injected; the function imports nothing powerful.
def sync_user(http, storage, signing_key, uid):
    data = http.get_user(uid)        # http = client locked to api.internal
    storage.put(f"{uid}.json", data) # storage = facet over ONE directory
    return signing_key               # handed in, not read from the environment

# Composition root (the only place that holds real authority):
def main():
    http    = HostBoundClient("https://api.internal")   # attenuated net
    storage = DirStore("/data")                          # attenuated fs
    key     = os.environ["SIGNING_KEY"]                  # ambient read, ONCE, here
    sync_user(http, storage, key, uid="42")
```

`sync_user` now cannot reach an arbitrary host, an arbitrary path, or the environment. Its entire authority is three parameters, and an auditor can see it at a glance.

### A Powerbox Hand-Out (pseudocode)

```text
# The app holds NO filesystem authority. It asks the powerbox:
chosen = powerbox.requestFile(prompt="Pick a file to import",
                              mode="read")
# The powerbox shows the user a dialog. The user's pick IS the grant.
# The app receives a read-only capability to EXACTLY that one file.
parse(chosen)   # cannot read anything the user didn't choose
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Revocation** | Clean and transitive via caretakers — kill one forwarder, revoke a whole delegation tree. | Requires interposing forwarders up front; raw caps can't be reclaimed. |
| **Attenuation** | Composes freely; authority narrows downhill. | Wrapper layers add indirection and a little overhead. |
| **Auditability** | "What can it reach?" = reference closure; review becomes reachability. | Demands the no-ambient discipline hold *everywhere*. |
| **Retrofit** | Incremental — push authority to the edge module by module. | Real ecosystems assume ambient `fs`/`net`; many libraries resist injection. |
| **TCB size** | Powerbox concentrates broad authority in one auditable place. | The powerbox itself is highly trusted and must be correct. |
| **Confinement** | Untrusted code is bounded by what you handed it — provably. | One leaked capability (logged token, escaped reference) breaches the boundary. |
| **Amplification** | Sealer/unsealer enables safe, explicit privilege combination. | Subtle; misused, it becomes a covert authority channel. |

---

## Use Cases

- **Plugin / extension sandboxes.** Hand a plugin a powerbox-mediated set of facets; revoke on uninstall or misbehavior.
- **Per-tenant or per-request authority.** Each request carries an attenuated capability (one tenant's data, read-only), so a bug can't cross tenants.
- **Revocable sharing.** "Anyone with the link" sharing where you can later disable a specific link — a caretaker over a signed URL.
- **Mediating untrusted libraries.** Wrap a third-party SDK behind a facet that exposes only the methods you actually use, denying it ambient reach.
- **Privilege separation in services.** Split a monolith so the component parsing untrusted input holds *no* database or network capability; it returns data to a separate component that does.

When it's the wrong fit: hard real-time paths where wrapper indirection is unaffordable; environments where you cannot stop ambient authority (a language with unavoidable global `open` and no sandbox) so the guarantees can't actually hold.

---

## Coding Patterns

### Pattern 1: Composition root holds all authority

```text
main() {
  net   = attenuate(realNetwork, allow=["api.internal"])
  store = attenuate(realFS, dir="/data")
  app(net, store)        // everything below imports NO authority
}
```

### Pattern 2: Attenuate at every hand-off

```python
def handle_request(req, store):
    tenant_store = store.scoped(req.tenant_id)   # narrow before passing down
    process(req.body, tenant_store)              # process can't cross tenants
```

### Pattern 3: Hand a caretaker when revocation may be needed

```js
const { facet, revoke } = makeCaretaker(resource);
register(plugin, facet);
onUninstall(plugin, revoke);   // revocation designed in, not bolted on
```

### Pattern 4: Facet exposes only what's used

```ts
// Don't pass the whole SDK; pass exactly the verbs you need.
const mailer = { send: (to, body) => sdk.messages.create({ to, body }) };
notifier(mailer);   // notifier cannot list, delete, or read other messages
```

### Pattern 5: Powerbox for user-mediated grants

```text
cap = powerbox.grant(resource="camera", consentPrompt="Allow camera?")
useCamera(cap)   // app had no camera authority until the user said yes
```

---

## Best Practices

- **Establish a single composition root.** All authority enters there; nothing below imports an authority source. This is the structural backbone of capability discipline.
- **Never delegate a raw capability you might revoke.** Interpose a caretaker by default; raw hand-offs are forever.
- **Attenuate before you delegate, every time.** Pass the weakest facet that still works. Authority should narrow as it travels.
- **Keep the powerbox small and audited.** It is your concentrated trusted base; everything broad lives here and nowhere else.
- **Make facets expose verbs, not objects.** Hand `{ send }`, not the whole mail SDK; the shape of the facet *is* the granted authority.
- **Treat tokens (URLs, OAuth) as capabilities, with the same rules.** Unforgeable, attenuated (scoped), revocable (short-lived + a deny list). The macaroon model formalizes this (covered in `senior.md`).
- **Audit by reference closure in review.** Ask "what was this handed, and what does that reach?" rather than "what does the policy say?"

---

## Edge Cases & Pitfalls

- **Ambient leaks through the language runtime.** Even capability-injected code may, in an ordinary language, still do `import os`. Without a runtime that *denies* ambient access (a sandbox, a frozen realm, a capability OS), the discipline is by-convention only — and one careless import breaks it.
- **Over-broad facets.** A facet that forwards `__getattr__`/`get` for *everything* (a naive Proxy) re-exposes the whole object and attenuates nothing. Attenuation means *removing* verbs, not transparently forwarding all of them.
- **Capability leakage via return values.** A facet that *returns* a raw inner object hands out unattenuated authority through the back door. Wrap return values too.
- **Revocation that doesn't cover already-captured state.** If the holder copied data out before you revoked, revocation stops *future* access, not past extraction. Capabilities control *authority*, not *information already obtained*.
- **Caretaker chains and identity.** Wrapping breaks object identity (`===`), and a holder may rely on identity for equality/maps. Design facets so identity-sensitive code still works, or document the break.
- **Sealer/unsealer used as a covert channel.** A pair shared across a boundary can smuggle authority past an auditor who only follows ordinary references. Treat sealer pairs as authority and audit them.
- **The powerbox becomes a god object.** If everything routes through one powerbox that grants generously, you've recreated ambient authority with extra steps. The powerbox must grant *narrowly* and on policy.

---

## Common Mistakes

1. **Transparent proxies that forward everything.** That's not attenuation; you handed back the full object behind a thin shim.
2. **Handing out raw capabilities, then wanting to revoke.** Too late — you can't reach their reference. Always interpose a caretaker if revocation is plausible.
3. **Leaving one ambient import in an otherwise-injected module.** Reintroduces full authority and silently voids every guarantee.
4. **Returning inner objects from facets.** Authority escapes through return values; wrap them.
5. **Treating revocation as information control.** It governs future *access*, not data the holder already copied.
6. **A powerbox that grants broadly "for convenience."** Recreates ambient authority; grants must be narrow and policy-gated.
7. **Forgetting that tokens are capabilities.** Long-lived, unscoped bearer tokens are raw, unrevocable, over-broad capabilities — the worst kind.
8. **Confusing dependency injection of *anything* with capability injection.** Injecting a config value isn't capability discipline; injecting *authority* (and refusing to import it) is.

---

## Tricky Points

- **No-ambient-authority is a property of the *substrate*, not your code style.** You can write injection-style code all day, but if the language still offers a global `open`, a malicious or buggy module bypasses your design. True ocap needs the runtime to *withhold* ambient power (frozen realms, WASI, a capability kernel). Without that, you have *good hygiene*, not *enforced confinement*.
- **Revocation is forwarding, not deletion — always.** The holder's reference is unreachable to you forever. The only lever you have is the thing it points at. Internalize this and revocation design becomes obvious.
- **Attenuation is monotone; amplification needs a key.** You can always make a capability weaker for free. Making one stronger requires holding *another* capability (a sealer, an unsealer, a powerbox) — there is no free lunch, which is exactly why authority can't silently grow.
- **The delegation tree and the revocation tree are the same tree.** Because everyone forwards through the caretaker you planted, the structure you use to *share* authority is the structure you use to *reclaim* it. ACLs separate these, which is why ACL revocation is hard.
- **Confinement bounds authority, not information.** A confined component can't *gain new authority*, but if you handed it secret data it can still remember and reveal that data. Don't conflate "can't reach new resources" with "can't leak what it already saw."

---

## Test Yourself

1. State the three ocap rules. For each, give one concrete code construct that *violates* it.
2. Explain the difference between a *capability* and a *facet*. Why do real designs hand out facets almost everywhere?
3. You handed an untrusted plugin a raw, writable file handle a week ago and now need to cut its access. Can you? Explain what you should have done instead, in terms of forwarders.
4. Write (in pseudocode) a read-only facet over a `{read, write, delete}` object. Then explain why a `Proxy` that forwards *all* gets would *not* be an attenuation.
5. Trace a delegation diamond: A → B and A → C, both through one caretaker. A calls `revoke()`. What happens to B and C, and why is this easier than ACL revocation?
6. Define "powerbox" and give a real example from an OS or browser. Why does concentrating broad authority there *help* rather than hurt?
7. A module is fully dependency-injected but still contains `import requests`. Has the no-ambient-authority rule been satisfied? Justify.
8. Why can revocation stop future access but not "un-leak" data the holder already copied? Tie this to the distinction between authority and information.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              OBJECT-CAPABILITY MODEL (ocap)                      │
├──────────────────────────────────────────────────────────────────┤
│ THREE RULES                                                      │
│   1. No ambient authority   (no global open / lookup / registry) │
│   2. Propagate by reference  (endow | introduce | parent — only) │
│   3. References unforgeable  (memory safety / opaque handles)    │
│   => reachable authority = transitive closure of held refs       │
├──────────────────────────────────────────────────────────────────┤
│ FACET = wrapper exposing a SUBSET of an object's behavior        │
│   attenuate (drop verbs) | audit | rate-limit | revoke           │
├──────────────────────────────────────────────────────────────────┤
│ ATTENUATION  monotone & free: only ever WEAKER (read-only, 1 file)│
│ AMPLIFICATION needs a key (sealer/unsealer, powerbox)            │
├──────────────────────────────────────────────────────────────────┤
│ REVOCATION = interpose a CARETAKER (forwarder you control)       │
│   you keep the kill switch; holder keeps a ref to a dead forwarder│
│   delegation tree == revocation tree (kill one node, revoke all) │
├──────────────────────────────────────────────────────────────────┤
│ POWERBOX = the ONE trusted broker holding broad authority,       │
│            handing out narrow caps on policy / user consent       │
│   (the OS "open file" dialog is a powerbox)                      │
├──────────────────────────────────────────────────────────────────┤
│ RETROFIT RECIPE                                                  │
│   find authority sources -> push to composition root             │
│   -> inject downward -> attenuate at boundaries                  │
│   end state: thin impure shell + capability-pure core            │
├──────────────────────────────────────────────────────────────────┤
│ TRAPS                                                            │
│   * transparent proxy = no attenuation                           │
│   * raw delegation = unrevocable forever                         │
│   * one `import os` = ambient authority back                     │
│   * revocation stops ACCESS, not already-copied DATA             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The **object-capability (ocap) model** makes "a capability is a key" precise with three checkable rules: **no ambient authority**, **propagation only by reference-passing** (endowment / introduction / parenthood), and **unforgeable references**.
- When those rules hold, a component's reachable authority equals the **transitive closure of the references it holds** — making "what can this do?" a graph-reachability question instead of a policy question.
- A **facet** is a wrapper exposing a subset of an object's behavior. Facets do the real work: **attenuation** (drop verbs), auditing, rate-limiting, and revocation.
- **Attenuation is monotone and free** — you can always make a capability weaker. Making one *stronger* (**amplification**) requires holding another capability (sealer/unsealer, powerbox). Authority can never silently grow.
- **Revocation is forwarding, not deletion.** You cannot reach a holder's reference, so you interpose a **caretaker** you control and sever it later. The delegation tree *is* the revocation tree, which is why capability revocation is clean where ACL revocation is hard.
- The **powerbox** is the sanctioned home for broad authority: one trusted, audited broker that hands out narrow, attenuated capabilities on policy or user consent (e.g., the OS file dialog).
- You **retrofit** least authority by finding authority sources, pushing them to a composition root, injecting downward, and attenuating at boundaries — yielding a thin impure shell over a capability-pure core.
- The crucial caveat: **no-ambient-authority is a property of the runtime, not your style.** Without a substrate that withholds ambient power, you have good hygiene, not enforced confinement — and one `import os` breaks it.

---

## What You Can Build

- **A caretaker library.** A small `makeCaretaker(target) -> { facet, revoke }` in your language of choice. Demonstrate a delegation diamond and a single `revoke()` cutting off all holders.
- **An attenuating file facet.** Given a full file handle, produce read-only, append-only, and single-write facets. Write tests proving the dropped verbs are unreachable.
- **A retrofit case study.** Take a 200-line ambient script, refactor all authority to a composition root, and produce a before/after diagram of "what each function can reach."
- **A powerbox prototype.** A broker holding `/data` and an HTTP client; expose `requestDir(name)` and `requestHost(host)` that return attenuated facets, and log every grant.
- **A sealer/unsealer demo.** Implement a brand pair and use it to pass a privileged value safely through an untrusted transformation that must not read it.

---

## Further Reading

- *Robust Composition: Towards a Unified Approach to Access Control and Concurrency Control* — Mark S. Miller, PhD dissertation, 2006. The definitive ocap text (caretakers, facets, sealers, the powerbox). http://www.erights.org/talks/thesis/
- *Capability Myths Demolished* — Miller, Yee, Shapiro. Dismantles the common misconceptions that ACLs and capabilities are equivalent. http://srl.cs.jhu.edu/pubs/SRL2003-02.pdf
- *The E Language and the ocap model* — erights.org. The reference implementation of object capabilities. http://www.erights.org/
- *Proxy and Reflect (`Proxy.revocable`)* — MDN. The caretaker pattern built into JavaScript. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/revocable
- *A Security Kernel Based on the Lambda-Calculus* — Jonathan Rees (W7). Capabilities as plain lexical scope. https://mumble.net/~jar/pubs/secureos/
- *POLA Today Keeps the Virus Away* — Marc Stiegler. Why least authority matters for everyday software. https://cap-lore.com/CapTheory/POLA/
