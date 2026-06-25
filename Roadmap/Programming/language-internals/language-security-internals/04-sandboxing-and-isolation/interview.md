# Sandboxing & Isolation — Interview Questions

> **Topic:** [Sandboxing & Isolation](README.md)

---

## Introduction

These questions test whether a candidate can reason about isolation as a
deliberate trade between strength and cost, place real technologies
(seccomp/namespaces, V8 isolates, Wasm/WASI, gVisor, Firecracker, browser site
isolation) on that curve, and articulate why "it runs in a container" is not a
security claim. Strong answers always start from a threat model and end with
defense-in-depth.

## Table of Contents

- [Conceptual](#conceptual)
- [Technology-Specific](#technology-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is the goal of sandboxing, in one sentence?**

To run code you don't fully trust while *bounding by construction* what it can
reach and what a compromise can cost — least authority at the execution boundary.

## Question 2

**What is "ambient authority" and why is it the root problem?**

Ambient authority is the power a process holds simply by existing — it can name any
file, open any socket, see the whole filesystem — and a permission check decides
each time. It's the substrate that makes the *confused deputy* problem possible
and makes sandboxes necessary: the affirmative fix is to remove ambient authority
and hand each component only the specific capabilities it needs (the Wasm/WASI and
capability-security model).

## Question 3

**Rank in-process sandboxes, containers, and microVMs by isolation strength and
cost.**

In-process (V8 isolate) is cheapest and densest but its boundary is the runtime's
own memory safety — one JIT bug escapes. Containers (namespaces + cgroups +
seccomp) are stronger but share the host kernel, so a kernel LPE escapes all of
them. MicroVMs (Firecracker) add a hardware-virtualization boundary with a tiny
device model — strongest of the three, at ~100ms startup and lower density.

---

## Technology-Specific

## Question 4

**What do Linux namespaces and cgroups each provide, and why aren't they enough
alone?**

Namespaces virtualize what a process can *see* (pid, net, mnt, user, uts, ipc);
cgroups limit what it can *consume* (CPU, memory, PIDs, I/O). Together they make a
container. They are not a full security boundary because the process still calls
into the *one shared kernel* — the entire syscall surface (and any kernel bug)
remains reachable.

## Question 5

**What does seccomp-bpf add, and how should you configure it?**

seccomp-bpf filters which syscalls a process may issue, killing or erroring on the
rest. Configure it deny-by-default and allowlist only the syscalls the workload
actually uses (discover via audit/`strace`). Every allowed syscall is kernel
attack surface, so the narrower the allowlist, the smaller the escape surface.

## Question 6

**Why are V8 isolates a good fit for multi-tenant serverless JS?**

They start in microseconds and pack thousands per host, giving the density and
cold-start economics edge platforms (Cloudflare Workers) need. The trade is that
the isolation boundary is V8's correctness — so platforms layer extra mitigations
(per-isolate limits, Spectre defenses, separate processes for risky work) on top.

## Question 7

**Why is WebAssembly described as a sandbox by design?**

Wasm has linear memory the guest can't escape, structured validated control flow,
and — crucially — *no ambient authority*: a pure Wasm module can't touch the
filesystem or network unless the host explicitly grants a capability (WASI
preopens). It's capability-secure by default, which is why it's popular for
plugins, edge, and untrusted compute.

## Question 8

**gVisor vs Firecracker — what's the difference?**

gVisor interposes a userspace kernel (Sentry) that reimplements the syscall
surface, shrinking what reaches the host kernel — strong isolation without a full
VM, at some syscall-performance cost. Firecracker is a minimal VMM running each
workload in a real lightweight VM with a tiny device model — a hardware boundary
with fast (~100ms) startup. gVisor narrows the kernel surface; Firecracker
replaces sharing the kernel with virtualization.

## Question 9

**How does a browser isolate untrusted web content?**

A low-privilege sandboxed renderer process handles untrusted HTML/JS with almost
no direct OS access, talking to a privileged broker over narrow IPC. Site
isolation puts each origin in its own process, so a renderer compromise plus a
Spectre-class read still can't reach another origin's data.

---

## Tricky / Trap

## Question 10

**"We run untrusted code in Docker, so we're isolated." Respond.**

A stock container is packaging and resource isolation sharing one kernel — not a
security boundary for *untrusted* code, because one kernel exploit escapes every
container on the host. For untrusted multi-tenant code you need a real boundary
underneath: gVisor, a microVM, or capability-scoped Wasm, with the container as
mere packaging.

## Question 11

**Your seccomp allowlist is minimal but includes `ptrace` and broad `ioctl`. Any
concern?**

Yes — a single over-powerful syscall undoes the whole filter. `ptrace` can let a
process manipulate another; unrestricted `ioctl` reaches huge swaths of kernel
driver code. The boundary is only as tight as its most dangerous allowed syscall;
audit the long tail, not just the count.

## Question 12

**Can a syscall filter stop a side-channel leak across the boundary?**

No. Cache/timing side channels don't issue distinctive syscalls — they read
microarchitectural state. Containing secrets against side channels needs
process/CPU separation (and the browser's site-isolation answer), not seccomp.

## Question 13

**Why pass a file *descriptor/handle* into a sandbox instead of a *path*?**

A path is re-resolved by the host and is subject to TOCTOU races and symlink
tricks; a descriptor/capability designates the exact resource and carries the
authority to use it, eliminating the re-lookup and the confused-deputy race. This
is the capability principle applied to sandbox APIs.

---

## Design

## Question 14

**Design isolation for a multi-tenant "run arbitrary user code" service.**

- **Boundary:** microVM-per-job (Firecracker) or gVisor — never bare containers for arbitrary native code.
- **Per-job lifecycle:** create fresh, run, destroy (no reuse → no cross-tenant state leak).
- **Inside:** non-root, all caps dropped, read-only rootfs, deny-by-default seccomp, no host mounts.
- **Network:** default-deny egress; explicit allowlist; no metadata-endpoint access.
- **Resources:** cgroup CPU/memory/PID/IO limits + wall-clock timeout (DoS is part of isolation).
- **Secrets:** none inside the sandbox; broker any needed access.
- **Detection:** log denied syscalls / unexpected egress as breakout signals.

State the threat model explicitly: attacker fully controls the guest code; success
= no host compromise, no cross-tenant data, bounded resource use.

## Question 15

**How do you decide where on the strength/cost curve to sit?**

Start from the worst-case attacker and the density/cost you can afford. Trusted-ish
code at high density → in-process isolates. Untrusted code → push down to gVisor or
microVM. The rule: choose the *cheapest* boundary that still contains your real
attacker, then layer additional mitigations so one failure isn't fatal.

## Question 16

**What does defense-in-depth look like for a sandbox?**

Multiple independent boundaries: a capability-scoped runtime (Wasm) *inside* a
seccomp+namespaces container *inside* a microVM, with memory-safe host code and
CFI, secrets brokered out of band, and monitoring on the IPC/syscall surface. The
point is that defeating any single layer still leaves the attacker contained.
