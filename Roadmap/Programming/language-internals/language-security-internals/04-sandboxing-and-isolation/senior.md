# Sandboxing & Isolation — Senior Level

> **Topic:** [Sandboxing & Isolation](README.md)
> **Focus:** The strength-vs-cost spectrum as an engineering decision; escape *classes* (syscall surface, kernel bugs, side channels); the shared-kernel problem; microVMs (Firecracker), userspace kernels (gVisor); the confused-deputy / ambient-authority root cause; and threat modeling the boundary itself.

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
18. [Further Reading](#further-reading)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Given a threat, which isolation strength do you actually buy, and what can still get out?** A senior doesn't pick a sandbox by habit; they pick it by attack surface, blast radius, and cost.

By now you know the primitives. The senior question is harder and more uncomfortable: **every sandbox can be escaped; you are choosing how hard the escape is and how much you'll pay to make it harder.** "Is it secure?" is the wrong question. The right questions are: *What is the attack surface the guest can reach? What is the blast radius if it escapes? How much performance and operational cost does the next rung of isolation cost, and is the marginal safety worth it for this threat?*

The central tension is the **shared component**. A plain container's guest reaches the host's **shared kernel** through hundreds of syscalls — a vast, monolithic, memory-unsafe C codebase. A single exploitable kernel bug reachable from the container is a full escape, and the kernel is too big to ever be bug-free. This is precisely why "containers are not a security boundary" for hostile multi-tenant workloads: the boundary is the kernel, and the kernel's attack surface is enormous. The industry's answer is to **shrink or move the shared component**:

- **gVisor** interposes a **userspace kernel** (Sentry) that handles most guest syscalls itself, so the guest almost never touches the host kernel directly — it trades performance for a far smaller host-kernel surface.
- **Firecracker** (and Kata) give each guest its own real kernel inside a **microVM**, separated from the host by hardware virtualization — the boundary becomes the hypervisor (a much smaller, more defensible surface than the kernel) plus the virtual hardware emulation.

Layer onto this the escapes that don't go through *any* of these explicit boundaries — **side channels** (cache timing, Spectre-class speculation) that leak information across an isolation boundary without ever "breaking" it — and you have the full senior picture: defense in depth, because no single wall is sufficient, and threat modeling, because you must know *what you're defending against* to choose well.

> 🎓 **Why this matters at this level:** You will be the person who decides whether anonymous user code runs in a container, a gVisor sandbox, or a Firecracker microVM — a decision with real money and real latency attached, and real breach consequences if you under-isolate. You'll also be the one explaining to leadership why "we use containers, so it's isolated" is not the same as "tenants are securely isolated from each other." Getting the strength-vs-cost call right, and articulating the residual risk honestly, is a senior security responsibility.

This page covers the spectrum as a decision framework, the major **escape classes** conceptually and defensively, the shared-kernel attack surface, gVisor and Firecracker as two opposite answers, the **confused-deputy problem** and **ambient authority** as the root cause that motivates capability security, and how to threat-model the boundary including **TOCTOU** at the boundary. `professional.md` takes this into production architectures (browsers, serverless, operating at scale).

---

## Prerequisites

- **Required:** Middle-level command of the OS primitives — seccomp, namespaces, cgroups, capabilities, MAC — and the language sandboxes (V8 isolates, Wasm/WASI).
- **Required:** A working model of what a kernel, a syscall, a process address space, and virtual memory are.
- **Required:** Comfort reasoning about "what's inside vs outside the boundary" and least privilege.
- **Helpful but not required:** Awareness of CPU caches and speculative execution (for side channels), and a rough idea of how a hypervisor virtualizes hardware.
- **Helpful but not required:** Having operated containers or VMs in production.

You do **not** need to write exploits or hypervisors. The treatment here is conceptual and defensive: we name *classes* of escape to design against them, not to perform them.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Attack surface** | The set of interfaces (syscalls, host functions, emulated devices) the guest can reach and thus potentially exploit. Smaller = safer. |
| **Trusted Computing Base (TCB)** | The set of components whose correctness the security guarantee depends on. A smaller TCB is easier to defend. |
| **Blast radius** | How much is compromised if the guest escapes — one tenant, the whole host, the whole fleet. |
| **Shared kernel** | The single host kernel that all containers on a machine call into; the common boundary and common point of failure. |
| **Hypervisor / VMM** | Software (with CPU support) that runs guest VMs, mediating their access to real hardware. The boundary for VM-based isolation. |
| **microVM** | A minimal, fast-booting VM with a stripped-down device model (e.g., Firecracker), used for per-workload hardware isolation. |
| **gVisor** | A sandbox that runs a **userspace kernel** ("Sentry") intercepting guest syscalls, so the guest rarely touches the host kernel. |
| **Sentry / Gofer** | gVisor components: Sentry implements the syscall surface in user space; Gofer mediates filesystem access. |
| **Kata Containers** | Containers backed by lightweight VMs — OCI-compatible packaging with VM-strength isolation. |
| **Syscall surface** | The portion of the host kernel reachable via permitted syscalls — a primary escape vector for containers. |
| **Side channel** | An information leak through a shared physical resource (cache, timing, power) rather than through the intended interface. |
| **Spectre / Meltdown** | Speculative-execution attacks that leak memory across isolation boundaries via microarchitectural side channels. |
| **Confused deputy** | A privileged component tricked by a less-privileged one into misusing its authority on the latter's behalf. |
| **Ambient authority** | Power available implicitly by context (e.g., a process's identity) rather than via an explicit, unforgeable token. The root enabler of confused-deputy attacks. |
| **Capability (security)** | An unforgeable token that *both* designates a resource *and* authorizes access to it — eliminating ambient authority. |
| **TOCTOU** | Time-Of-Check-To-Time-Of-Use: a gap between validating something and acting on it, during which it can change. |
| **Defense in depth** | Multiple independent isolation layers, so breaching one does not breach the system. |
| **Noisy neighbor** | A tenant whose resource use degrades others — an availability side effect of imperfect isolation. |

---

## Core Concepts

### 1. The Spectrum Is a Cost Function, Not a Ladder to Climb

Lay out the options by **isolation strength vs cost**:

```text
in-process    OS-level       gVisor          microVM /        full VM /
isolate/Wasm  container      (userspace      Kata             separate host
              (ns+cgroup+    kernel)          (Firecracker)
              seccomp)
   │             │              │                │                  │
weakest       weak-ish       medium-strong    strong            strongest
fastest,      fast,          some syscall     ~125ms boot,      heavy
densest       shared kernel  overhead,        own kernel,       (full OS,
              (huge surface) smaller host     hypervisor        slow boot,
                             kernel surface   boundary          high RAM)
```

You don't always want the strongest — you want the **cheapest option whose residual risk you can accept for this threat**. A trusted internal batch job: a container is fine. Arbitrary code from anonymous users on shared hardware: you want a hardware boundary (microVM) or a drastically reduced host-kernel surface (gVisor). The senior skill is mapping *threat* → *acceptable residual risk* → *the cheapest rung that meets it*, and being explicit about what you're trading.

### 2. The Shared-Kernel Problem ("Containers Are Not a Security Boundary")

A container shares the host's **single kernel**. The guest reaches that kernel through the syscall interface — hundreds of syscalls, each a path into millions of lines of privileged, memory-unsafe C. **Any** exploitable kernel bug reachable from the container is a full host compromise, and from the host, every co-tenant. seccomp shrinks *which* syscalls are reachable, which genuinely helps, but a kernel that large will always have undiscovered bugs in the reachable set. That's the precise, defensible meaning of "containers are not a security boundary": **the boundary is the kernel, and the kernel is too big and too unsafe to be a strong wall against a determined, hostile guest.** Containers are an excellent *deployment* and *resource* boundary; they are a *weak security* boundary for hostile multi-tenancy without help.

### 3. Two Answers: Shrink the Surface (gVisor) or Move the Boundary (microVM)

The industry's two main responses attack the shared-kernel problem from opposite directions:

- **gVisor — shrink the host-kernel surface.** gVisor runs a **userspace kernel** (Sentry) that *implements* the syscall interface itself, in a memory-safe language (Go), and itself runs heavily seccomp-confined. When the guest makes a syscall, Sentry handles it; only a small, tightly filtered set of operations ever reach the real host kernel. The guest's reachable host-kernel surface shrinks from "hundreds of syscalls" to "a handful, behind a strict filter." Cost: real syscall-heavy workloads slow down, because syscalls now cross into Sentry instead of straight to the kernel.

- **Firecracker / Kata — move the boundary to hardware.** Each guest gets its **own real kernel** inside a **microVM**, isolated from the host by **hardware virtualization**. The boundary is no longer the host kernel's syscall surface but the **hypervisor + the emulated device model** — a much smaller, more auditable surface. Firecracker minimizes that surface further by emulating only a tiny set of devices (no BIOS, no PCI, minimal virtio). Cost: ~tens-to-hundreds of milliseconds to boot, more memory per guest, an extra OS to manage. Firecracker's design point — fast boot, minimal devices, one microVM per function — is exactly what makes per-tenant hardware isolation viable at serverless scale.

Both are "stronger than a plain container." They differ in *what* the residual TCB is (Sentry + a tiny host filter vs hypervisor + device emulation) and in *what they cost*.

### 4. Escape Classes (Conceptual, Defensive)

You can't enumerate every bug, but you *can* enumerate the **classes** of escape and design against each:

| Class | What it is | Defensive response |
|-------|-----------|--------------------|
| **Syscall-surface / kernel bug** | Guest exploits a bug in a host-kernel syscall handler reachable from the sandbox. | Shrink the surface: tight seccomp, gVisor (userspace kernel), or move to a microVM so the guest never calls the host kernel. |
| **Emulated-device / hypervisor bug** | (VM case) Guest exploits the virtual hardware emulation or the VMM. | Minimize the device model (Firecracker's tiny virtio set), keep the VMM small and in a memory-safe language, sandbox the VMM itself. |
| **Misconfiguration / leaky boundary** | A mounted host path, an unshared namespace, a too-broad capability, a passed-in handle that reaches more than intended. | Deny-by-default, audit every mount/handle/capability, fail closed, test the boundary. |
| **Logic / confused-deputy** | Guest tricks a privileged broker into doing something on its behalf (see below). | Capability-based design; the broker authorizes by token, never by ambient identity. |
| **Resource exhaustion / DoS** | Guest doesn't escape but degrades or denies service to host/co-tenants (noisy neighbor). | cgroups, quotas, rate limits, per-tenant accounting. |
| **Side channel** | Guest infers another tenant's data through shared hardware (cache, timing, speculation) without "breaking" any wall. | See below — the hardest class. |

The point of classifying is that **each class has a different defense**, and a sandbox strong against one class can be wide open to another. A microVM crushes the kernel-bug class but does nothing about Spectre-class side channels.

### 5. Side Channels: Escapes That Don't Break the Wall

The most unsettling escapes never cross the explicit boundary at all. **Side channels** leak information through a *shared physical resource*: two tenants on the same core share CPU caches, branch predictors, and execution units, and one can infer the other's secrets by measuring timing. **Spectre/Meltdown** showed that **speculative execution** can be coaxed into accessing memory across a security boundary and leaving a measurable microarchitectural trace, even when the architectural boundary is intact. Crucially, *stronger logical isolation (a VM, even a separate kernel) does not necessarily stop a side channel* if the two guests share the same physical core/cache. Defenses live below the OS sandbox: core/cache partitioning, not co-scheduling distrusting tenants on sibling hyperthreads (disabling SMT for sensitive workloads), microcode mitigations, and constant-time code in the secret-handling components. For the strongest guarantees, you stop sharing hardware: dedicated cores or dedicated hosts per trust domain. A senior recognizes side channels as a *distinct axis* the OS/VM sandbox does not, by itself, close.

### 6. The Confused Deputy and Ambient Authority — The Root Cause

Most non-kernel sandbox escapes are some flavor of the **confused-deputy problem**: a privileged component (the "deputy" — a broker process, a host function, a setuid helper) is tricked by a less-privileged caller (the guest) into using *its* authority to do something the guest couldn't do directly. The classic example is a compiler with permission to write to a billing file being asked by a user to "write output to" that file path — it does, abusing its own authority on the user's behalf.

The *root cause* is **ambient authority**: the deputy acts using *who it is* (its identity, its ambient permissions) rather than *what token the request carried*. Because authority is ambient, the deputy can't tell "authority I should use for *this* request" from "authority I happen to possess." The structural fix is **capability security**: requests carry **capabilities** — unforgeable tokens that simultaneously *name* the resource and *authorize* it. A capability can't be confused with ambient power because the only authority in play is the one the caller actually presented. WASI's preopened-directory handles, passed file descriptors, and object-capability languages are all instances of this fix. This is *why* the whole field keeps returning to capabilities: they structurally eliminate the confused-deputy class, which ambient-authority designs can only patch case by case.

### 7. Threat-Modeling the Boundary: Inside, Outside, and the Interface

Designing a sandbox is mostly **drawing the boundary correctly**:

- **What's inside** (untrusted): the guest code, the data it generates, anything it can write.
- **What's outside** (protected): host memory, secrets, other tenants, the network, the control plane.
- **The interface**: every syscall allowed, every host function imported, every mounted path, every passed handle, every shared file/region/clipboard. *This is the attack surface.* Threat modeling is the discipline of enumerating the interface and asking, for each element, "what could a maximally hostile guest do with this?"

Two things bite seniors specifically. First, **the interface is wider than the obvious API** — error messages, timing, log files, shared temp directories, and metadata all cross the boundary and can leak or be abused. Second, **outputs are inputs in disguise**: data flowing *out* of the sandbox (return values, files, rendered content) is attacker-controlled and must be validated before the host trusts it, or you've moved the vulnerability outside the box.

### 8. TOCTOU at the Boundary

A specific, recurring boundary bug is **Time-Of-Check-To-Time-Of-Use**. The host checks a property of something the guest can influence — a path, a symlink, a file's permissions, a length field — and then *acts* on it a moment later. In the gap, the guest changes it. Classic forms: the host validates that `path` points inside the sandbox directory, then opens `path`, but the guest swaps it for a symlink to `/etc/shadow` in between; or a host function reads a length from guest memory, validates it, then re-reads it (now larger). The defense is to **eliminate the gap**: operate on the object you already resolved (open the file descriptor first, then validate the *fd*, then use the *same fd*), copy guest-supplied values into host memory once and validate the copy, and never re-resolve names you already checked. TOCTOU is why "validate then use the handle, not the name" is a security rule, not just hygiene.

### 9. Defense in Depth as the Operating Assumption

Because every single wall has a class of escape it doesn't cover — kernel bugs (containers), VMM/device bugs (VMs), engine memory bugs (in-process), side channels (everything sharing hardware), confused-deputy logic (any broker) — the senior posture is **never rely on one layer**. Combine: a memory-safe language for the guest runtime + an in-process boundary + an OS sandbox or microVM + minimal exposed interface + side-channel hardening for the most sensitive data. The goal isn't a perfect wall (there is none); it's making the cheapest escape path expensive enough, and the blast radius small enough, that the *expected* loss is acceptable for the threat you actually face.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Shared kernel** | An apartment block where every unit shares one structural wall with the building's core — one breach in that core reaches everyone. |
| **gVisor (userspace kernel)** | Hiring a private concierge who handles all your requests, so you almost never deal with the building's (vulnerable) front desk directly. |
| **microVM (Firecracker)** | Giving each tenant a separate prefab house with its own foundation, instead of separate rooms in one building. |
| **Hypervisor as boundary** | A small, hardened airlock between buildings — far easier to inspect than the whole building's wiring. |
| **Side channel** | Figuring out what your neighbor is cooking by the smell and the timing of the kitchen fan — you never entered their house. |
| **Confused deputy** | Tricking the building's locksmith (who can open any door) into opening a door you're not allowed through, by phrasing your request just right. |
| **Ambient authority** | The locksmith acting on "I'm the locksmith, I can open anything" instead of "show me the specific key-authorization for this door." |
| **Capability** | A signed work order naming exactly one door — the locksmith acts only on what the order authorizes. |
| **TOCTOU** | Showing a guard a valid ticket, then swapping it for a forged one in the half-second before they scan it. |
| **Blast radius** | Whether a fire is contained to one prefab house or spreads through a shared attic to the whole block. |
| **Defense in depth** | A vault behind a guarded door behind a fenced perimeter, monitored by cameras — no single failure is fatal. |

---

## Mental Models

### The "What's the Residual TCB?" Model

For any sandbox, ask: **whose correctness am I betting on?** For a container, it's the entire host kernel reachable via allowed syscalls — huge, memory-unsafe. For gVisor, it's the Sentry (memory-safe, smaller) plus a tiny host-kernel filter. For Firecracker, it's the hypervisor plus a minimal device model. For an in-process isolate, it's the whole engine. The sandbox you should prefer, for a given cost, is usually the one with the **smallest, most auditable, most memory-safe TCB** reachable by the guest. "Strength" is mostly "smallness and safety of the reachable TCB."

### The "Each Wall Has a Blind Spot" Model

Tag every layer with the escape class it *doesn't* cover. Container: kernel bugs. VM: VMM/device bugs and side channels. In-process: engine memory bugs. Capability broker: still vulnerable to logic bugs. Once you see that **no layer covers all classes**, defense in depth stops being a slogan and becomes arithmetic: stack layers so that the classes one layer misses are caught by another, and accept that side channels need a hardware-level answer.

### The "Authority Should Travel With the Request" Model

The fix for the entire confused-deputy family is one idea: **authority should be carried by the request as an unforgeable token, never inferred from who's holding the request.** Whenever you see a privileged helper acting on a name or path supplied by an untrusted caller "because the helper has permission," you're looking at ambient authority and a latent confused deputy. Replace "the helper can access X, and the caller asked it to" with "the caller presented a capability for exactly X." If you internalize one senior idea from this page, make it this.

### The "Move the Boundary to the Smallest Hostile Interface" Model

Don't ask "how do I make the kernel bug-free" (impossible). Ask "how do I make the guest stop talking to the kernel." That reframing is the whole logic of gVisor (interpose a userspace kernel) and microVMs (give the guest its own kernel so it talks to a small hypervisor instead). The strongest sandboxes don't harden the big shared component — they **interpose a small one** between the guest and the big one.

---

## Code Examples

These are conceptual sketches; the lessons are architectural.

### Picking a Rung by Threat (decision sketch)

```text
function choose_isolation(workload):
    if workload.code is fully trusted and inputs are controlled:
        return PROCESS_OR_CONTAINER        # cheap, blast radius low by trust

    if workload is untrusted but you control the tenants (known accounts):
        return CONTAINER + tight seccomp + dropped caps + cgroups
        # acceptable if you can also detect/respond; document residual kernel risk

    if workload is arbitrary code from anonymous / mutually-distrusting tenants:
        if latency budget tolerates ~100ms cold start and per-VM RAM:
            return MICROVM (Firecracker/Kata)   # hardware boundary, small VMM TCB
        else:
            return GVISOR                       # smaller host-kernel surface, in-between cost

    if the data is so sensitive that side channels matter (crypto keys, multi-tenant secrets):
        return DEDICATED_HARDWARE per trust domain   # stop sharing cores/caches
```

The decision is driven by *who the tenant is* and *how sensitive the data is*, not by what's fashionable.

### Confused Deputy: the Bug and the Capability Fix

```text
// VULNERABLE (ambient authority): the broker acts using ITS OWN permissions,
// trusting a path the untrusted guest supplied.
host_broker.write_output(path = guest_supplied_path, data):
    open(path, "w")          # broker can write ANYWHERE it has permission,
    write(data)              # including /etc or another tenant's file.
// Guest passes "/var/lib/billing/records" -> broker dutifully corrupts billing.

// FIXED (capability): the guest can only reference resources it was GRANTED.
host_broker.write_output(handle = capability_token, data):
    // 'handle' is an unforgeable token the host issued for ONE specific file
    // inside the guest's sandbox. There is no way for the guest to name
    // /var/lib/billing/records, because it was never granted a capability to it.
    write_via(handle, data)
```

The fix removes the broker's ability to be *confused*: it acts only on the authority the request literally carried.

### TOCTOU at the Boundary: Check-Then-Use vs Use-the-Handle

```text
// VULNERABLE (TOCTOU): validate a NAME, then use the NAME later.
if is_inside_sandbox(path):     # check: looks safe now
    // ... guest swaps 'path' to a symlink -> /etc/shadow ...
    fd = open(path)             # use: opens the swapped target. ESCAPE.

// SAFE: resolve ONCE to a handle, validate the HANDLE, use the SAME handle.
fd = open(path, O_NOFOLLOW)     # resolve once, don't follow symlinks
if fd_is_inside_sandbox(fd):    # validate the thing we actually hold
    read(fd) / write(fd)        # use the same fd; nothing to swap
```

Operate on the resolved object, not the re-resolvable name. The gap is the bug.

### gVisor vs Firecracker: Where the Guest's Syscalls Go (conceptual)

```text
PLAIN CONTAINER:
   guest ── syscall ──────────────────────────────► HOST KERNEL (huge surface)

gVisor:
   guest ── syscall ──► Sentry (userspace kernel, memory-safe, seccomp'd)
                          └─ only a tiny, filtered set ──► host kernel

FIRECRACKER microVM:
   guest ── syscall ──► GUEST's OWN kernel (inside the VM)
                          └─ hardware-virtualized I/O ──► tiny VMM device model ──► host
```

In all three the guest "makes syscalls," but *what those syscalls reach* — and thus the reachable TCB — is radically different.

---

## Pros & Cons

| Option | Pros | Cons |
|--------|------|------|
| **In-process isolate / Wasm** | Highest density, fastest start; great as an inner layer. | Engine memory bug = escape; shares host address space; weak as sole boundary. |
| **Plain container** | Cheap, fast, ubiquitous tooling; good resource/deploy boundary. | Shared kernel = huge attack surface; not a strong security boundary for hostile tenants. |
| **gVisor** | Much smaller host-kernel surface; memory-safe userspace kernel; container-like ergonomics. | Syscall-heavy workloads slow down; compatibility gaps (not every syscall implemented identically). |
| **microVM (Firecracker/Kata)** | Hardware-enforced boundary; own kernel per guest; small VMM TCB; fast enough for serverless. | Higher per-guest RAM; ~100ms-class boot; extra OS to manage; still shares hardware (side channels). |
| **Full VM / separate host** | Strongest practical isolation; mature. | Heavy: slow boot, high resource cost, operational weight. |
| **Capability-based design** | Structurally kills the confused-deputy class; explicit, auditable authority. | Requires designing the system around capabilities; retrofitting ambient-authority systems is hard. |
| **Side-channel hardening** | Addresses the class other layers ignore. | Costly (disable SMT, dedicate cores/hosts); never fully "solved" on shared hardware. |

---

## Use Cases

- **Anonymous code execution platforms** (online IDEs, code-runners, untrusted serverless): microVMs or gVisor, because tenants are mutually distrusting and arbitrary.
- **High-density multi-tenant edge** with tighter latency budgets: Wasm or V8 isolates as the inner layer, wrapped in OS/VM isolation, with the security argument leaning on Wasm's small TCB.
- **Per-function hardware isolation at scale**: Firecracker's fast-boot minimal microVMs make one-VM-per-invocation economically viable.
- **Container compatibility with stronger isolation**: gVisor or Kata when you need OCI images but can't accept the shared-kernel risk.
- **Secrets/crypto workloads on shared infrastructure**: dedicated cores/hosts and constant-time code, because side channels defeat logical isolation.
- **Plugin/extension brokers**: capability-passing host interfaces so a hostile plugin can't confuse the host into over-privileged actions.

---

## Coding Patterns

### Pattern 1: Match the Rung to the Threat, Document the Residual Risk

```text
threat -> acceptable residual risk -> cheapest rung that meets it.
Write down what you are NOT protected against (e.g., "shared-host side
channels; kernel 0-days reachable through gVisor's filter"). An undocumented
residual risk becomes someone's surprise breach.
```

### Pattern 2: Interpose a Small Component Between Guest and Big Component

```text
Don't harden the kernel; stop the guest from calling it (gVisor, microVM).
Don't trust the engine alone; wrap it. The strong move is interposition of a
small, auditable shim, not perfection of a large shared dependency.
```

### Pattern 3: Capabilities Instead of Ambient Authority at Every Broker

```text
Any host function / broker that acts on guest-supplied references:
  pass an unforgeable handle that NAMES + AUTHORIZES one resource.
  never act on a path/ID/name using the broker's own ambient permissions.
This is the only structural cure for the confused-deputy class.
```

### Pattern 4: Resolve-Then-Hold to Kill TOCTOU

```text
Resolve the object ONCE (open the fd, with O_NOFOLLOW where relevant),
validate the OBJECT you hold, then use the SAME object. Copy guest-supplied
scalars into host memory once and validate the copy. Never re-resolve names.
```

### Pattern 5: Treat Side Channels as a Separate Axis

```text
For data where cross-tenant inference is in scope:
  - don't co-schedule distrusting tenants on sibling hyperthreads
  - partition or flush caches at trust-domain boundaries
  - constant-time the secret-handling code
  - escalate to dedicated hardware when the stakes justify it
Logical isolation (even a VM) does not, by itself, close this axis.
```

---

## Best Practices

- **Choose isolation by threat model, not by default or fashion.** Map tenant trust and data sensitivity to the cheapest rung whose residual risk you accept — and write that residual risk down.
- **For hostile multi-tenancy, don't lean on plain containers.** Use gVisor or microVMs; treat containers as a deploy/resource boundary, not the security boundary.
- **Minimize the reachable TCB.** Tight seccomp, minimal device models, minimal host imports — every removed interface is removed attack surface.
- **Design brokers and host functions around capabilities,** never ambient authority. This eliminates the confused-deputy class structurally.
- **Eliminate TOCTOU at the boundary:** resolve-then-hold, validate the handle not the name, copy-and-validate guest scalars once.
- **Validate everything flowing *out* of the sandbox.** Outputs are attacker-controlled inputs to the host.
- **Stack independent layers (defense in depth)** and label each layer's blind spot so you know which class is still open.
- **Address side channels separately** when cross-tenant inference is in scope — partitioning, no-SMT-sharing, dedicated hardware, constant-time code.
- **Fail closed and test the boundary by attacking it:** confirm the kernel surface is what you think, that escapes you expect to fail actually fail.
- **Keep the VMM / runtime small and memory-safe,** and sandbox *it* too — the enforcer is itself attack surface.

---

## Edge Cases & Pitfalls

- **"We use containers, so tenants are isolated."** False for hostile multi-tenancy: the shared kernel is the boundary, and it's a weak one. Quantify and address it.
- **A microVM that still shares a core leaks via side channels.** Hardware isolation of memory doesn't imply hardware isolation of caches/branch predictors.
- **gVisor compatibility gaps.** It reimplements the syscall surface; an app relying on an unimplemented or subtly different syscall behaves differently or breaks. Test your actual workload.
- **The VMM is attack surface too.** A device-emulation bug in the hypervisor is a VM escape. Minimal device models exist precisely to shrink this.
- **Capabilities leaked by accident.** Passing a too-broad handle (a directory fd that reaches more than intended, an fd that can be `openat`'d upward) recreates ambient authority. Scope handles tightly.
- **Outputs trusted as safe.** Rendering sandbox output into HTML, a SQL query, or a shell command moves the exploit *outside* the box.
- **TOCTOU in "obviously safe" checks.** Path-prefix checks, symlink assumptions, and re-read length fields are classic gaps.
- **Side-channel mitigations that don't compose.** Disabling SMT on some hosts but co-scheduling distrusting tenants elsewhere in the fleet leaves the weakest host as the breach point.
- **Blast radius underestimated.** Escaping one guest often means reaching the host control plane and thus *every* guest — model the worst case, not the first hop.
- **Over-trusting a memory-safe runtime's host functions.** Wasm's core is safe, but a buggy host import that trusts a guest index reintroduces a memory bug at the boundary.

---

## Common Mistakes

1. **Using plain containers as the security boundary for untrusted, mutually-distrusting tenants.**
2. **Believing a VM/microVM closes side channels** — it doesn't, if hardware is shared.
3. **Building brokers on ambient authority,** then patching confused-deputy bugs one at a time forever.
4. **Check-then-use (TOCTOU) on guest-controlled names** instead of resolve-then-hold on handles.
5. **Trusting sandbox outputs** as if they were the host's own data.
6. **Treating one strong layer as sufficient,** ignoring the class it doesn't cover.
7. **Leaving the VMM/runtime large and unsandboxed,** so the enforcer is itself an easy target.
8. **Not documenting residual risk,** so an accepted trade-off becomes an unexpected breach.
9. **Passing over-broad capabilities/handles** that quietly restore ambient reach.
10. **Choosing isolation strength by habit** rather than by an explicit threat model and cost trade-off.

---

## Tricky Points

- **Stronger logical isolation can still share hardware.** Two Firecracker VMs on one core are *memory*-isolated but *cache*-adjacent — side channels don't respect the VM boundary.
- **gVisor isn't "a smaller kernel" exposed to the guest — it's a *different* kernel (in user space).** The guest's syscalls hit Sentry; the host kernel sees only Sentry's tightly filtered, small set. The win is *which* kernel is reachable.
- **Capabilities don't fix every escape — they fix the *confused-deputy* class.** Kernel bugs, device bugs, and side channels are orthogonal and need their own answers.
- **Shrinking the syscall surface helps containers but can't make the kernel safe;** it reduces *reachable* bugs, not *existing* bugs. The kernel stays a large memory-unsafe TCB.
- **"No ambient authority" (Wasm) is about the *core*; the host imports are where authority comes back in.** A capability-clean core with a sloppy import set is not capability-clean overall.
- **TOCTOU is a property of the *interface*, not the *check*.** Even a correct check is unsafe if the checked thing can change before use. The cure is structural (hold the resolved object), not "check more carefully."
- **The cheapest escape, not the average one, defines your security.** An attacker takes the weakest path — the in-process engine bug, the leaky mount, the side channel — regardless of how strong the headline boundary is.

---

## Test Yourself

1. Explain precisely why "containers are not a security boundary" — name the shared component and why its size matters.
2. gVisor and Firecracker both isolate untrusted code more strongly than a plain container. Describe how each changes *what the guest's syscalls reach*, and contrast their costs.
3. Give the five escape *classes* and one distinct defense for each. Which class do microVMs *not* address?
4. What is the confused-deputy problem, what is its root cause, and how does capability security structurally eliminate it?
5. Why can two memory-isolated microVMs on the same physical core still leak data to each other? What class is this, and what stops it?
6. Walk through a TOCTOU escape at a sandbox boundary and the resolve-then-hold fix that prevents it.
7. You're choosing isolation for "arbitrary code from anonymous users, latency-sensitive." Argue for gVisor vs Firecracker and state the residual risk either way.
8. Why is "minimize the reachable TCB" a better north star than "make the boundary strong"? Tie it to the gVisor and Firecracker designs.
9. Data flows *out* of a sandbox and is rendered into an HTML page. What's the senior concern, and where did the vulnerability move?
10. Explain "the cheapest escape defines your security" and how it argues for defense in depth rather than a single strong wall.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│         ISOLATION: STRENGTH vs COST + ESCAPE CLASSES             │
├──────────────────────────────────────────────────────────────────┤
│ SPECTRUM (cheap/weak -> costly/strong):                          │
│   in-process isolate/Wasm -> container -> gVisor ->              │
│   microVM (Firecracker/Kata) -> full VM / dedicated host         │
│   Choose the CHEAPEST rung whose residual risk you accept.       │
├──────────────────────────────────────────────────────────────────┤
│ SHARED KERNEL = weak boundary (containers):                      │
│   guest reaches huge memory-unsafe kernel via syscalls.          │
│   gVisor   -> interpose userspace kernel (shrink host surface)   │
│   microVM  -> own kernel per guest (move boundary to hypervisor) │
├──────────────────────────────────────────────────────────────────┤
│ ESCAPE CLASSES (each needs its own defense):                     │
│   1. kernel/syscall bug   -> shrink surface / gVisor / microVM   │
│   2. VMM/device bug       -> minimal device model, sandbox VMM   │
│   3. misconfig/leaky bndry-> deny-by-default, audit, fail closed │
│   4. confused deputy      -> CAPABILITIES, not ambient authority │
│   5. resource DoS         -> cgroups, quotas, per-tenant limits  │
│   6. SIDE CHANNEL         -> no-SMT-share, partition, dedicated HW│
│      (NOT closed by VMs alone if hardware is shared)             │
├──────────────────────────────────────────────────────────────────┤
│ BOUNDARY DISCIPLINE:                                             │
│   * smallest reachable TCB wins                                  │
│   * authority travels WITH the request (capability)             │
│   * resolve-then-hold (kill TOCTOU); validate the handle         │
│   * sandbox OUTPUTS are untrusted inputs to the host             │
│   * defense in depth: the cheapest escape defines your security  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- "Is it secure?" is the wrong question; **"what attack surface, what blast radius, what cost?"** is the senior question. Every sandbox can be escaped — you choose how hard and how costly.
- The **shared kernel** makes plain containers a weak security boundary for hostile multi-tenancy: the guest reaches a huge, memory-unsafe TCB through syscalls.
- Two opposite answers shrink the problem: **gVisor** interposes a memory-safe **userspace kernel** (smaller reachable host-kernel surface, syscall-overhead cost); **Firecracker/Kata** give each guest its **own kernel in a microVM** (boundary becomes a small hypervisor + minimal device model, at a boot/RAM cost).
- Escapes come in **classes** — kernel/syscall bug, VMM/device bug, misconfiguration, confused-deputy logic, resource DoS, and **side channels** — each needing its own defense; no single layer covers all.
- **Side channels** (cache/timing/Spectre) leak across boundaries without breaking them and are *not* closed by logical isolation alone; they need hardware-level answers (no SMT sharing, partitioning, dedicated hosts, constant-time code).
- The **confused-deputy problem**, rooted in **ambient authority**, is the structural cause of most logic escapes; **capability security** — unforgeable tokens that name *and* authorize — eliminates the class, which is why the field keeps returning to capabilities.
- **Threat-model the boundary**: inside vs outside, and the *full* interface (syscalls, imports, mounts, handles, even timing/error/temp-file leakage). Validate outputs as untrusted; **kill TOCTOU** with resolve-then-hold.
- The operating assumption is **defense in depth**: stack independent layers, minimize the reachable TCB, and remember **the cheapest escape — not the strongest wall — defines your security.**

---

## Further Reading

- *gVisor design documentation* — https://gvisor.dev/docs/ — the userspace-kernel architecture (Sentry/Gofer) and its security model.
- *"Firecracker: Lightweight Virtualization for Serverless Applications"* — Agache et al., NSDI 2020 — the microVM design and its security/density trade-offs.
- *Kata Containers architecture docs* — VM-isolated, OCI-compatible containers.
- *"The Confused Deputy"* — Norm Hardy (1988) — the original, short and essential.
- *"Capability Myths Demolished"* — Miller, Yee, Shapiro — why capabilities solve confused-deputy structurally.
- *Spectre and Meltdown papers* (Kocher et al.; Lipp et al., 2018) — speculative-execution side channels across boundaries.
- *"A Systematic Evaluation of Transient Execution Attacks and Defenses"* — Canella et al. — the side-channel landscape.
- *NCC Group, "Understanding and Hardening Linux Containers"* — the shared-kernel boundary in depth.
- *Saltzer & Schroeder (1975)* — least privilege, complete mediation, fail-safe defaults — the principles underlying all of this.

---

## Diagrams & Visual Aids

### Where the Guest's Syscalls Land (and the Reachable TCB)

```text
PLAIN CONTAINER
   guest ─syscall─────────────────────────────►  [ HOST KERNEL ]  ◄── huge,
                                                    memory-unsafe, shared TCB

gVISOR
   guest ─syscall─►  [ Sentry: userspace kernel ]  ── tiny filtered set ─►  host kernel
                       (memory-safe, seccomp'd)              (small reachable surface)

FIRECRACKER microVM
   guest ─syscall─►  [ guest's OWN kernel ]  ─virtio─►  [ tiny VMM ]  ─►  host
                       (inside the VM)                   (small device model = small TCB)

   Reachable TCB:  container = whole host kernel  >  gVisor = Sentry + small filter
                   microVM   = hypervisor + minimal devices  (smallest of the three)
```

### The Escape-Class Map (each layer's blind spot)

```text
                 kernel  VMM/    misconfig  confused  resource  side
                 bug     device  /leak      deputy    DoS       channel
 container        ✗ open  n/a     depends    depends   cgroups   ✗ open
 gVisor           ~small  n/a     depends    depends   cgroups   ✗ open
 microVM          ✓ guest ✗ open  depends    depends   limits    ✗ open
 in-process       n/a     n/a     depends    depends   limits?   ✗ open
 capability design  -      -       -         ✓ closed   -          -
 dedicated HW       -      -       -          -          -        ✓ closed

  ✓ = strongly addressed   ✗ open = a real escape path this layer ignores
  No row closes every column -> stack layers (defense in depth).
```

### Confused Deputy → Capability Fix

```text
AMBIENT AUTHORITY (confusable)              CAPABILITY (not confusable)
  guest ── "write to PATH" ──► broker         guest ── "write via HANDLE" ──► broker
                               (acts with                                    (acts only on
                                ITS OWN power                                 the resource the
                                on any PATH)                                  HANDLE authorizes)
  guest names /var/lib/billing ─► CORRUPTED   guest has no handle to billing ─► CANNOT NAME IT
```

### TOCTOU at the Boundary

```text
   CHECK ──────────────[ gap: guest swaps target ]──────────────► USE
   is_inside(path)?  ✓                 (symlink -> /etc/shadow)     open(path) -> ESCAPE

   FIX:  resolve ONCE to a handle ─► validate the HANDLE ─► use the SAME handle
         (nothing left to swap between check and use)
```
