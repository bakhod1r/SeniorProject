# Sandboxing & Isolation — Hands-On Tasks

> **Topic:** [Sandboxing & Isolation](README.md)

---

## Introduction

These exercises build isolation from the inside out: filter a syscall, confine a
process with namespaces and cgroups, run untrusted Wasm with only a granted
capability, and finally design the architecture for a multi-tenant code runner
with a written threat model. They are defensive — you confine code, you don't
escape anything.

Run on a Linux machine you own. Tick a self-check box when you can explain *which
boundary* did the confining and what would defeat it.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Block a syscall with seccomp

Write a program that installs a seccomp-bpf filter denying `write` (or, more
safely, `getpid`), then calls it and observe the kill/EPERM.

**Self-check:**
- [ ] The process is terminated (or the call fails) exactly at the filtered syscall.
- [ ] I understand `SCMP_ACT_KILL` (deny-by-default) vs allowlisting specific syscalls.

### Task 2 — See what a program actually calls

`strace -f -c ./yourprogram` to get the syscall histogram.

**Self-check:**
- [ ] I have the real list of syscalls my program needs.
- [ ] I can turn that list into a minimal allowlist and explain why each entry is required.

---

## Core

### Task 3 — Confine with namespaces + cgroups

Use `unshare` (or write a small clone-with-namespaces program) to give a process
its own PID, mount, and network namespace; then put it in a cgroup with a memory
and PID limit.

**Self-check:**
- [ ] Inside, the process sees itself as PID 1 and cannot see host processes.
- [ ] The memory/PID limits are enforced (a fork bomb or big alloc is contained).
- [ ] I can explain why this is still *not* a boundary against a kernel exploit.

### Task 4 — Drop ambient authority

Run a container (or your namespaced process) as non-root, with all capabilities
dropped, `no_new_privs`, and a read-only root filesystem. Try to do something
privileged and watch it fail.

**Self-check:**
- [ ] Privileged operations fail; the workload still runs.
- [ ] I can list which capabilities (if any) a typical network service genuinely needs.

### Task 5 — Untrusted Wasm with one capability

Using Wasmtime/Wasmer (or a WASI runtime), run a Wasm module that tries to read
two paths: one inside a `preopened_dir` you granted, one outside it.

**Self-check:**
- [ ] The granted path works; the ungranted path is denied — the guest has *no* ambient filesystem.
- [ ] I can explain how WASI preopens are capabilities, not path-based permissions.

---

## Advanced

### Task 6 — Container vs microVM for a threat

Pick a concrete workload (e.g. "run a contributor's untrusted build script").
Write a one-page comparison: bare container vs gVisor vs Firecracker microVM —
isolation strength, startup, density, and which you'd choose and why.

**Self-check:**
- [ ] My choice is justified by an explicit threat model, not by familiarity.
- [ ] I correctly identify that bare containers are inappropriate for arbitrary untrusted native code.

### Task 7 — Minimal host interface for a plugin

Design a Wasm plugin host that exposes exactly three capability-scoped host
functions (e.g. `log`, `kv_get`, `kv_put` scoped to the plugin's namespace) and
nothing else. Argue why a plugin can't exfiltrate data.

**Self-check:**
- [ ] The plugin can do only what the three host functions allow.
- [ ] I can explain how adding a too-powerful host function (e.g. `http_get`) would silently widen the sandbox.

### Task 8 — Find the boundary's surface

For your Task 3 confinement, enumerate everything that crosses the boundary:
allowed syscalls, shared filesystem mounts, shared memory, timers, network. That
list *is* the attack surface.

**Self-check:**
- [ ] I can point to the single most dangerous item on my list.
- [ ] I understand why side channels (cache/timing) aren't on the syscall list yet still cross the boundary.

---

## Capstone

### Task 9 — Architect a multi-tenant code runner

Design (and document) the full isolation architecture for a service that runs
arbitrary user-submitted code:

1. **Threat model** — attacker fully controls guest code; define success (no host
   compromise, no cross-tenant data, bounded resources).
2. **Boundary choice** — microVM/gVisor + container packaging, justified.
3. **Hardening** — non-root, dropped caps, deny-by-default seccomp, read-only
   rootfs, default-deny egress, no metadata endpoint, cgroup limits + timeout.
4. **Lifecycle** — fresh-per-job, destroy-don't-reuse.
5. **Secrets** — none in the blast radius; brokered.
6. **Detection** — what signals a breakout attempt, and how you'd alert.

Produce a diagram of the boundaries and the data/authority crossing each.

**Self-check:**
- [ ] Every layer maps to a specific threat it mitigates.
- [ ] Defeating any single layer still leaves the attacker contained.
- [ ] I documented the residual risks (kernel/hypervisor 0-day, side channels) and how I'd reduce them.

---

## Self-Assessment

You own this topic when you can:

- [ ] Install a deny-by-default seccomp filter and derive a minimal allowlist from observed syscalls.
- [ ] Confine a process with namespaces + cgroups and explain why it's not a boundary against kernel bugs.
- [ ] Run untrusted Wasm with only granted capabilities and explain the no-ambient-authority model.
- [ ] Place V8 isolates / containers / gVisor / Firecracker on the strength-cost curve and choose correctly from a threat model.
- [ ] Architect layered isolation for untrusted multi-tenant code with an explicit threat model.
