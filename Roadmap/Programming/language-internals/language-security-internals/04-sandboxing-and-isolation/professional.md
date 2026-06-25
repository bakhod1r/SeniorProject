# Sandboxing & Isolation — Professional Level

> **Topic:** [Sandboxing & Isolation](README.md)
> **Focus:** Choosing and operating isolation in production — strength vs. cost, multi-tenancy, threat modeling, and breakout detection.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Isolation-Strength / Cost Curve](#the-isolation-strength--cost-curve)
3. [Core Concepts in Production](#core-concepts-in-production)
4. [Code Examples](#code-examples)
5. [Use Cases](#use-cases)
6. [Best Practices](#best-practices)
7. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
8. [War Stories](#war-stories)
9. [Summary](#summary)

---

## Introduction

By the professional tier the question is never "should we sandbox?" but "which
isolation boundary, at what cost, for this specific threat model?" A multi-tenant
code runner, a browser, a serverless platform, and a plugin host all need
isolation — but they sit at wildly different points on the strength/cost curve,
and choosing wrong means either an unaffordable bill or a tenant escape on the
front page. This tier is about making that choice deliberately, operating it, and
detecting when it fails.

The governing principle is **least authority at the execution boundary**: a
component should reach only what it has been explicitly granted, and the cost of a
compromise should be bounded by construction, not by hope.

---

## The Isolation-Strength / Cost Curve

From weakest/cheapest to strongest/most expensive:

| Mechanism | Boundary | Startup | Density | Breakout surface |
|---|---|---|---|---|
| Language sandbox (V8 isolate, JS realm) | In-process | microseconds | thousands/host | The whole runtime's memory safety — one JIT bug escapes |
| seccomp + namespaces (container) | Shared kernel | milliseconds | hundreds/host | The entire syscall surface + kernel bugs |
| gVisor | Userspace kernel | ~10s ms | hundreds/host | Smaller (intercepting kernel reimplements syscalls) |
| Firecracker / Kata microVM | Hardware virt | ~100 ms | tens–hundreds/host | The hypervisor + a tiny device model |
| Separate physical host | Hardware | n/a | 1 | Network only |

The job is to pick the *cheapest* row that still contains your worst-case
attacker. Cloudflare Workers run untrusted JS in V8 isolates (cheapest) because
they accept the V8-bug risk and mitigate it with extra layers; AWS Lambda uses
Firecracker microVMs because it must isolate arbitrary native code across tenants.

---

## Core Concepts in Production

**"Containers are not a security boundary" — and what to add.** A stock container
is namespaces + cgroups + a default seccomp profile sharing one kernel. For
*untrusted* multi-tenant code that's insufficient: a single kernel LPE escapes
all containers on the host. Production multi-tenant platforms therefore add a real
boundary underneath — gVisor or a microVM — and treat the container only as
packaging/resource-management.

**Tighten the syscall surface.** The default Docker seccomp profile blocks ~44
syscalls; a hardened service should allowlist only the syscalls it actually issues
(observe with `strace`/`seccomp` audit mode, then deny-by-default). Every syscall
you allow is attack surface into the kernel.

**Drop ambient authority.** Run as non-root, drop all capabilities and add back
only the few needed (`CAP_NET_BIND_SERVICE` at most), set
`no_new_privs`, read-only root filesystem, and no host mounts. The container that
can't reach the network or the filesystem can't exfiltrate much when compromised.

**Browser-style multi-process / site isolation.** Render untrusted content in a
low-privilege sandboxed process that talks to a privileged *broker* over a narrow
IPC; the renderer has almost no direct OS access. Site isolation puts each origin
in its own process so a renderer compromise plus a Spectre-class leak still can't
read another origin's secrets.

---

## Code Examples

A minimal seccomp-bpf allowlist (conceptual, libseccomp):

```c
scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_KILL);   // deny-by-default
int allow[] = { SCMP_SYS(read), SCMP_SYS(write),
                SCMP_SYS(exit_group), SCMP_SYS(rt_sigreturn) };
for (size_t i = 0; i < sizeof allow/sizeof *allow; i++)
    seccomp_rule_add(ctx, SCMP_ACT_ALLOW, allow[i], 0);
seccomp_load(ctx);     // any other syscall -> process killed
```

Running untrusted Wasm with an explicitly granted capability (Wasmtime/WASI
preopens — the guest gets *only* the directory you hand it):

```rust
let mut wasi = WasiCtxBuilder::new();
wasi.preopened_dir(Dir::open_ambient_dir("./sandbox", ambient_authority())?,
                   "/data")?;   // guest sees /data, nothing else; no ambient fs
```

The Wasm case is the cleanest: the guest has *no* ambient authority at all — it
can touch only what it was handed, which is the capability model in practice.

---

## Use Cases

- **Multi-tenant code execution** (CI runners, online judges, notebook backends): microVM-per-job or gVisor; never bare containers for arbitrary tenant code.
- **Edge / serverless functions**: V8 isolates (Workers) for JS-only at extreme density; Firecracker for arbitrary runtimes.
- **Plugin systems**: Wasm with capability-scoped host functions — the plugin reaches only the host APIs you expose.
- **Browsers / document viewers**: multi-process renderer sandbox + broker + site isolation.

---

## Best Practices

- **Deny by default, allowlist explicitly** — syscalls, capabilities, mounts, network.
- **Layer the boundaries** — sandbox *and* memory safety *and* CFI; assume each can fail.
- **Make the boundary auditable** — enumerate exactly what crosses it (syscalls, IPC messages, shared memory) and treat that list as the attack surface.
- **Resource-limit everything** (cgroups: CPU, memory, PIDs, I/O) — isolation includes denial-of-service, not just confidentiality.
- **No secrets inside the blast radius** — keep tenant secrets out of any process an attacker could compromise; broker access to them.
- **Re-create, don't reuse** — for per-job sandboxes, destroy and recreate rather than reset, to avoid state-leak between tenants.

---

## Edge Cases & Pitfalls

- **TOCTOU at the boundary** — a sandbox that validates a path then the host opens it can be raced; pass *handles/capabilities*, not names.
- **Shared caches/timers cross the boundary** — side channels (cache, timing) ignore syscall filters; isolating secrets needs *process/CPU* separation, not just seccomp.
- **The `/proc` and `ioctl` long tail** — many escapes come from an over-broad allowlist letting through one powerful syscall (`ptrace`, `keyctl`, `userfaultfd`, unrestricted `ioctl`).
- **Privileged helper creep** — every host function you expose to a Wasm/plugin guest is new surface; a too-powerful host call defeats the sandbox.
- **"It's in a container" complacency** — packaging isolation mistaken for security isolation is the single most common real-world mistake.

---

## War Stories

- **Default-profile escapes**: multiple container escapes have chained a permissive seccomp profile (an allowed `ioctl`/`userfaultfd`) with a kernel bug — the lesson that the syscall allowlist *is* the boundary.
- **runc CVE-2019-5736**: a container could overwrite the host `runc` binary, escaping to the host — why read-only host binaries and microVM isolation for untrusted workloads matter.
- **Spectre forced site isolation**: browsers moved to process-per-origin precisely because in-process isolation could not stop microarchitectural reads across origins.

---

## Summary

Production isolation is an engineering trade on a strength/cost curve: pick the
cheapest boundary that contains your real attacker, drop ambient authority,
allowlist the syscall and capability surface, layer multiple boundaries, keep
secrets out of the blast radius, and monitor for breakout. "Containers are not a
security boundary" is the line to remember: for untrusted code, put a real
boundary (gVisor, microVM, or capability-scoped Wasm) underneath.
