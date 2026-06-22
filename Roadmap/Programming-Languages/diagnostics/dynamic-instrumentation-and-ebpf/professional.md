# Dynamic Instrumentation & eBPF — Professional Level

> **Topic:** [Dynamic Instrumentation & eBPF Roadmap](README.md)
> **Focus:** At fleet scale, eBPF is the substrate beneath a whole ecosystem — Cilium for networking, Tetragon and Falco for runtime security, Parca/Pixie/Pyroscope for continuous profiling and auto-instrumentation — and the professional job is to wield dynamic tracing as a governed, overhead-budgeted, kernel-skew-aware diagnostic capability that complements (never replaces) in-app APM and OpenTelemetry spans.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Broader eBPF Ecosystem](#the-broader-ebpf-ecosystem)
6. [eBPF Observability Platforms](#ebpf-observability-platforms)
7. [Dynamic Tracing in Kubernetes and Containers](#dynamic-tracing-in-kubernetes-and-containers)
8. [Relationship to APM and Auto-Instrumentation](#relationship-to-apm-and-auto-instrumentation)
9. [Governance and Security of BPF in Production](#governance-and-security-of-bpf-in-production)
10. [Fleet-Scale Operational Concerns](#fleet-scale-operational-concerns)
11. [Code Examples](#code-examples)
12. [Worked Example — Standing Up Production-Safe Dynamic Tracing](#worked-example--standing-up-production-safe-dynamic-tracing)
13. [A Real Incident, Walked Through](#a-real-incident-walked-through)
14. [Pros and Cons](#pros-and-cons)
15. [Use Cases](#use-cases)
16. [Coding Patterns](#coding-patterns)
17. [Clean Usage](#clean-usage)
18. [Best Practices](#best-practices)
19. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
20. [Common Mistakes](#common-mistakes)
21. [Tricky Points](#tricky-points)
22. [Anti-Patterns at Professional Level](#anti-patterns-at-professional-level)
23. [Test Yourself](#test-yourself)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction

> Focus: **eBPF as a fleet-scale, governed diagnostic platform — and where it stops.**

At the junior, middle, and senior tiers you learned how a single eBPF program attaches to a kprobe, uprobe, tracepoint, or perf event, how the verifier and CO-RE keep it safe and portable, and how `bpftrace` and `bcc` turn that into ad-hoc kernel and userspace tracing on one box. The professional tier changes the unit of analysis from *one host* to *a fleet*: thousands of nodes, dozens of kernel versions, mixed CO-RE/BTF availability, multi-tenant Kubernetes clusters, and a security team that — correctly — wants to know exactly who can load arbitrary code into the kernel and what it does.

The eBPF ecosystem has also grown far beyond diagnostics. The same instruction set and verifier power **Cilium** (CNI, kube-proxy replacement, load balancing), **Tetragon** and **Falco** (runtime security observability and threat detection), and **Parca**, **Pixie**, and **Pyroscope** (continuous profiling and zero-code auto-instrumentation). A professional must map that landscape, because the agents your platform team already runs may give you the tracing you need — or compete for the same overhead budget and the same privileged DaemonSet slot.

This file keeps **diagnostics/observability** as the anchor. Networking and security are treated as ecosystem context you must understand to operate responsibly, not as the goal. The hard, honest truth threaded throughout: eBPF is the best tool ever built for seeing *what the kernel and processes are doing*, and a poor tool for *why your distributed transaction is slow* — that still needs in-app spans.

> 🎓 **Why this matters at the professional level:** A staff engineer is judged not on whether they can write a clever `bpftrace` one-liner, but on whether they can give an entire org safe, low-overhead, kernel-portable visibility *without* an unaudited DaemonSet running as root on every node becoming the next supply-chain incident. Governance, overhead budgets, kernel skew, and knowing eBPF's blind spots are the professional skills.

## Prerequisites

- The full single-host story from [junior](junior.md) (probes, `bpftrace` basics), [middle](middle.md) (maps, verifier, BCC/libbpf), and [senior](senior.md) (CO-RE/BTF, uprobes, USDT, perf events, ring buffers).
- Working knowledge of Kubernetes primitives: DaemonSets, PID/mount namespaces, `securityContext`, Linux capabilities, and CNI.
- Comfort with Linux capabilities model (`CAP_SYS_ADMIN`, `CAP_BPF`, `CAP_PERFMON`) and LSMs.
- Familiarity with the broader observability stack — metrics, logs, traces, and OpenTelemetry — to position eBPF correctly. See the **observability-stack** and **profiling-techniques** skills.

## Glossary

| Term | Meaning |
|------|---------|
| **CO-RE** | Compile Once – Run Everywhere; relocations let one BPF object run across kernels. |
| **BTF** | BPF Type Format; kernel type metadata (`/sys/kernel/btf/vmlinux`) enabling CO-RE. |
| **Cilium** | eBPF-based CNI: networking, network policy, kube-proxy replacement, load balancing. |
| **Tetragon** | Cilium's eBPF runtime security observability and enforcement engine. |
| **Falco** | CNCF runtime threat-detection engine; eBPF (or kmod) syscall events + rules. |
| **parca-agent / Parca** | eBPF whole-system continuous CPU profiler (agent) + storage/UI (server). |
| **Pixie** | Auto-instrumenting eBPF observability for k8s (protocol tracing, no code change). |
| **Pyroscope** | Continuous profiling backend (Grafana); ingests eBPF and SDK profiles. |
| **Coroot** | eBPF-based observability platform: service maps, SLOs, from kernel-level data. |
| **bpftrace** | High-level tracing language/CLI over BPF; the ad-hoc workhorse. |
| **libbpf** | C library for loading/relocating CO-RE BPF objects; the production loader. |
| **XDP** | eXpress Data Path; BPF at the driver RX hook for line-rate packet processing. |
| **tc / traffic-control** | BPF hook in the traffic-control layer (ingress/egress qdisc). |
| **CAP_BPF** | Capability (5.8+) granting `bpf()` syscall use without full `CAP_SYS_ADMIN`. |
| **BPF LSM** | Linux Security Module backed by BPF; attach programs to LSM hooks for policy. |
| **bpffs** | BPF filesystem (`/sys/fs/bpf`) for pinning maps/programs beyond process lifetime. |
| **pinned maps** | Maps/programs persisted in bpffs so they survive the loader exiting. |
| **kubectl-trace** | Runs `bpftrace` programs as Kubernetes Jobs scheduled onto target nodes. |
| **BPF token** | Newer (6.9+) delegation primitive letting unprivileged userns load BPF safely. |
| **attestation** | Proving a BPF program's provenance/integrity (signing, supply-chain trust). |
| **eBPF-for-Windows** | Nascent port of the eBPF runtime to Windows; not production-equivalent to Linux. |

## Core Concepts

### 1. eBPF is a platform substrate, not just a tracing tool

The same `bpf()` syscall, verifier, JIT, and maps power tracing, networking (XDP/tc), and security (LSM). Diagnostics is one consumer. Recognizing this means you can read the whole landscape with one mental model: *a sandboxed program attached to a kernel hook, communicating with userspace via maps and ring buffers.*

### 2. Agents vs ad-hoc, at scale

A single `bpftrace` invocation is *ad-hoc*: one human, one node, one question, attached then detached. A production deployment is an *agent*: a long-lived DaemonSet that loads pinned, CO-RE programs and exports to a backend. The professional decision is which question deserves an always-on agent (continuous profiling) and which deserves a transient, governed ad-hoc run (incident debugging).

### 3. CO-RE/BTF is the portability contract across a fleet

Across thousands of nodes you will not have matching kernel headers. CO-RE + BTF is what lets one `libbpf` object load on 5.10, 5.15, and 6.6 alike. Where BTF is missing (older or stripped kernels), you fall back to BTFHub-generated BTF or you simply cannot run modern CO-RE agents — this is a hard fleet constraint, not a footnote.

### 4. Overhead is a budget you spend per-event, fleet-wide

Per-event cost (a few hundred nanoseconds for a kprobe) is negligible on one box and enormous when multiplied by a hot syscall × thousands of nodes × always-on. Overhead is a *fleet budget*; you allocate it deliberately and measure it, never assume it.

### 5. Privilege is the central governance lever

Loading BPF historically required `CAP_SYS_ADMIN` (effectively root). `CAP_BPF` + `CAP_PERFMON` (5.8+) narrow that; BPF LSM, program signing, and BPF tokens narrow it further. Who holds these capabilities *is* your security posture.

### 6. eBPF's blind spots are structural, not temporary

eBPF sees syscalls, packets, function entry/exit, and CPU stacks. It does **not** see application-level intent (which customer, which feature flag, which business transaction), and it cannot decrypt TLS payloads without explicit integration (uprobes on the TLS library, or kernel TLS hooks). These limits define where APM/OTel still wins.

## The Broader eBPF Ecosystem

Three pillars sit beside diagnostics. Know them; they share your nodes and your overhead budget.

**NETWORKING — Cilium / XDP / tc.** Cilium is an eBPF CNI that replaces `iptables`-based kube-proxy with eBPF maps for service load balancing, enforces network policy in the datapath, and uses **XDP** (driver RX hook) for DDoS mitigation and line-rate load balancing. The diagnostic payoff is **Hubble**, Cilium's flow-observability layer, which gives L3–L7 visibility into pod-to-pod traffic with zero application changes.

**SECURITY — Falco / Tetragon / BPF LSM.** **Falco** detects threats by matching syscall streams against rules ("a shell spawned in a container", "a write to `/etc/shadow`"). **Tetragon** does runtime security observability *and* in-kernel enforcement via TracingPolicies — and crucially can **kill** a process from kernel context (`Sigkill` action) rather than racing userspace. **BPF LSM** attaches policy programs to LSM hooks. For diagnostics, these produce extremely high-fidelity process and syscall event streams you can correlate during incidents.

**PROFILING — parca-agent / Pixie / Pyroscope.** **parca-agent** samples whole-system CPU stacks via eBPF perf events and ships them for flame-graph analysis — continuous, fleet-wide, no app instrumentation, no symbols-in-binary requirement beyond what frame-pointer/DWARF unwinding needs. **Pyroscope** (Grafana) is the storage/query backend ingesting eBPF and SDK profiles. **Pixie** auto-instruments protocols (HTTP, gRPC, MySQL, Redis, DNS) with uprobes/kprobes for instant service-level telemetry.

> Anchor reminder: this topic is **diagnostics**. Cilium and Tetragon are context because they run on your nodes and emit data you'll use — but your charter is *observing running programs*, not building a CNI or an IPS.

## eBPF Observability Platforms

| Platform | What it auto-instruments (zero app change) | Honest limits |
|----------|--------------------------------------------|---------------|
| **Pixie** | HTTP/gRPC/SQL/Redis/DNS/Kafka via kprobes+uprobes; CPU profiles; service maps | uretprobe protocol parsing is version-fragile; TLS needs uprobe on the SSL lib; data stays node-local by default (limited retention) |
| **Coroot** | Service map, latency/error SLOs, network maps from kernel-level eBPF | infers topology, not business semantics; needs recent kernels/BTF |
| **Parca** | Whole-system continuous CPU profiling | CPU-centric; off-CPU and memory profiling are weaker; needs unwind info |
| **Cilium Hubble** | L3–L7 network flows, DNS, HTTP visibility | requires Cilium as CNI; L7 visibility needs Envoy/proxy or parser support |
| **Datadog / Grafana eBPF agents** | USM (universal service monitoring), network performance, profiling | vendor-coupled; the "zero code" L7 visibility shares the same TLS/version caveats |

The common thread: these platforms give you *infrastructure-level* observability — what is talking to what, how fast, how often, who is burning CPU — without touching application code. What none of them gives you for free is the *distributed-trace context* (a single trace ID following a request across ten services) or *business meaning*. They infer; SDK spans assert.

## Dynamic Tracing in Kubernetes and Containers

Containers complicate the two things tracing depends on: *which process* and *which file path*.

- **PID namespaces.** A process is PID 1 inside its container but some large PID on the host. `bpftrace` runs in the host/root PID namespace, so you target the **host PID**. Find it via `crictl inspect`, `nsenter`, or by reading the cgroup. eBPF maps record host PIDs; translate carefully when reporting.
- **Mount namespaces and uprobe path resolution.** A uprobe attaches to `binary:symbol`, but the container's `/usr/bin/app` does **not** exist at that path in the host's mount namespace. You must resolve the binary through the container's root, e.g. `/proc/<host_pid>/root/usr/bin/app`, or attach by inode. This is the single most common k8s uprobe failure.
- **Privilege.** A pod that loads BPF needs `CAP_BPF`+`CAP_PERFMON` (or `CAP_SYS_ADMIN`), often `hostPID: true`, and access to `/sys/kernel/btf` and `/sys/fs/bpf`. That is a *privileged* pod — treat it like one.
- **kubectl-trace** schedules a `bpftrace` program as a Job on a chosen node, handling the privileged pod spec for you. It is node-scoped: it sees every container on that node, so your script must filter by cgroup/PID.
- **Node vs pod scope.** eBPF is fundamentally a *node*-level (kernel) tool. "Tracing a pod" really means *tracing the node's kernel, filtered to that pod's processes*. There is no kernel-enforced pod boundary for a kprobe — you enforce it in your script.

## Relationship to APM and Auto-Instrumentation

eBPF auto-instrumentation and SDK-based APM are complements with a clean division of labor.

- **What eBPF auto-instrumentation gives you:** request rates, latencies, and error rates per service derived from syscalls and protocol parsing — *with zero code change and immediate fleet coverage.* Excellent for "is this service slow and where," for legacy/third-party binaries you can't instrument, and for the network/syscall layer APM can't reach.
- **What eBPF cannot do:**
  - **Distributed context propagation.** eBPF sees individual syscalls and connections; it cannot reliably stitch a single logical request across N services without the in-band trace/span IDs that an SDK injects into headers. Some platforms heuristically correlate, but it is best-effort, not the ground truth a propagated `traceparent` provides.
  - **Business semantics.** "This request was for customer 42's checkout with coupon X" lives in app memory, not in syscalls.
  - **Encrypted payloads.** With TLS terminating in the app, bytes on the socket are ciphertext. eBPF reads plaintext only by hooking *inside* the TLS library via uprobes (e.g. `SSL_read`/`SSL_write`) or via kTLS — both are integration work, not free.
  - **uretprobe-based HTTP parsing is fragile.** Parsing HTTP/2 or gRPC from buffer contents at function boundaries breaks across library versions, with HPACK compression, and with connection pooling/multiplexing.
- **Why in-app spans still win:** OpenTelemetry SDK spans carry propagated context, semantic attributes, and exact timing of *logical* operations (DB call, cache lookup, business step) regardless of encryption or library version. The professional pattern is **eBPF for breadth and the infra layer, OTel SDK spans for depth and distributed context** — and let them correlate (many platforms join eBPF data to trace IDs).

## Governance and Security of BPF in Production

Loading BPF means running verifier-checked code in the kernel. Verifier-safe is not the same as *trustworthy*. Governance:

- **Who can load.** Historically `CAP_SYS_ADMIN`. Since 5.8, **`CAP_BPF`** (load programs/maps) split from **`CAP_PERFMON`** (perf/tracing reads) lets you grant the minimum. Treat any pod with these as a privileged tenant.
- **Attack surface.** A malicious or buggy BPF program can read kernel memory it's allowed to touch, exfiltrate via maps, add latency to hot paths, or (with LSM/tc/XDP) alter behavior. Verifier limits memory safety, not intent.
- **BPF LSM + signing.** Use BPF LSM hooks to constrain *which* programs may load and from where; sign BPF objects and verify signatures at load. This is the kernel-side of supply-chain defense.
- **Supply-chain risk.** Running a third-party "observability agent" DaemonSet as root on every node is one of the highest-trust grants in your infra. Pin versions, verify provenance/attestation, read the program list, and prefer agents that document their probes.
- **Audit.** Log every `bpf()` load with who/what/when (auditd, or the agent's own audit trail). "An eBPF program was loaded on node X by Y" must be answerable.
- **BPF token (6.9+).** Delegates a *scoped* ability to load BPF into an unprivileged user namespace, so a workload can use BPF without the cluster handing out blanket `CAP_BPF`. This is how multi-tenant BPF gets safer.
- **Locked-down/secure-boot environments.** Lockdown mode and secure boot can restrict tracing (e.g. `kprobe` on arbitrary functions, reading kernel memory) entirely. Some regulated/hardened fleets simply forbid raw BPF tracing — plan for that.

## Fleet-Scale Operational Concerns

- **Overhead budgets.** Set an explicit budget (e.g. "tracing agents may consume ≤1% CPU and ≤200 MB RSS per node"). Measure with the agent on and off. A probe on a hot path (`tcp_sendmsg`, scheduler events) that's fine on one node can melt CPU at fleet scale.
- **Kernel version skew.** Thousands of nodes span many kernels. CO-RE handles most ABI drift, but new hook points, renamed structs, and missing BTF break things unevenly. Maintain a kernel/BTF support matrix.
- **BTF availability.** No `/sys/kernel/btf/vmlinux` → no CO-RE. Use **BTFHub** to ship external BTF, or gate the agent off on unsupported kernels rather than crash-looping.
- **Rollout/canary.** Roll BPF agents like any privileged code: canary on a small node pool, watch CPU/latency/verifier-load failures, then progress. A bad agent version can take down a node's hot path.
- **Pinned maps and bpffs lifecycle.** Pinning to `/sys/fs/bpf` lets programs survive loader restarts and lets tools share maps — but pins are *not* auto-cleaned. Orphaned pins leak kernel memory and confuse the next loader. Own the create/cleanup lifecycle.
- **What breaks on a kernel upgrade.** Attach points may move or disappear; BTF changes; verifier behavior tightens (programs that loaded before may be rejected); LSM/lockdown policy may change. Re-validate agents against the target kernel in your canary *before* a fleet kernel upgrade.

## Code Examples

```bash
# 1) kubectl-trace: run a bpftrace program as a Job on a specific node
#    (counts syscalls by name on that node's kernel)
kubectl trace run node/ip-10-0-3-21.ec2.internal \
  -e 'tracepoint:raw_syscalls:sys_enter { @[probe] = count(); }'
```

```bash
# 2) Trace a containerized process from the node with bpftrace.
#    Resolve the host PID, then filter the kprobe to it.
HOST_PID=$(crictl inspect --output go-template \
  --template '{{.info.pid}}' "$CONTAINER_ID")
bpftrace -e "kprobe:vfs_read /pid == $HOST_PID/ { @bytes = hist(arg2); }"
```

```bash
# 3) Cilium Hubble: observe L7 HTTP flows for a service, zero app change
hubble observe --namespace shop --protocol http \
  --to-pod shop/checkout --output compact --since 2m
# shows source/dest pods, verdict (FORWARDED/DROPPED), HTTP method/path/status
```

```yaml
# 4) Tetragon TracingPolicy: observe (and optionally act on) writes to
#    sensitive files from any process — real-shaped, diagnostics-first.
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: monitor-sensitive-writes
spec:
  kprobes:
    - call: "security_file_permission"
      syscall: false
      args:
        - index: 0
          type: "file"
        - index: 1
          type: "int"
      selectors:
        - matchArgs:
            - index: 0
              operator: "Prefix"
              values: ["/etc/shadow", "/etc/passwd"]
            - index: 1
              operator: "Mask"
              values: ["2"]   # MAY_WRITE
          # matchActions: [ { action: Sigkill } ]  # enforcement (opt-in)
```

```bash
# 5) Continuous profiling note: parca-agent runs as a DaemonSet, samples
#    CPU stacks fleet-wide via perf events, and pushes to Parca/Pyroscope.
#    No app changes; flame graphs per-container, always on.
helm install parca-agent parca/parca-agent \
  --set remoteStore.address=parca.observability.svc:7070 \
  --set sampling.frequency=19   # Hz; keep low for overhead budget
```

```bash
# 6) uprobe across a container's mount namespace: attach via /proc/<pid>/root
HOST_PID=$(crictl inspect --output go-template --template '{{.info.pid}}' "$CID")
bpftrace -e "uprobe:/proc/$HOST_PID/root/usr/local/bin/api:handleRequest \
  { @[comm] = count(); }"
# NOTE: the binary path lives in the container's mount ns, not the host's.
```

## Worked Example — Standing Up Production-Safe Dynamic Tracing

A platform team wants org-wide dynamic tracing for incidents across ~4,000 nodes (kernels 5.10–6.6, mixed BTF) without each engineer needing root on prod.

1. **Define the charter and budget.** Ad-hoc incident tracing only (continuous profiling already exists via parca-agent). Overhead budget: agent idle ≤0.3% CPU; an active trace must auto-expire.
2. **Build the kernel/BTF matrix.** Inventory kernels; confirm `/sys/kernel/btf/vmlinux` presence. For the ~6% of older nodes lacking BTF, ship BTFHub blobs; flag a small legacy pool as unsupported.
3. **Choose the access path.** Deploy `kubectl-trace`-style on-demand Jobs rather than an always-on tracing DaemonSet. Tracing pods are privileged but ephemeral and audited.
4. **Govern privilege.** Grant `CAP_BPF`+`CAP_PERFMON` (not `CAP_SYS_ADMIN`) to the trace Job's ServiceAccount via a dedicated PSP/Kyverno policy. Restrict who can create those Jobs via RBAC; require a ticket reference label.
5. **Audit and bound.** Every trace Job logs requester, node, script, and start/stop. A mutating policy injects an `activeDeadlineSeconds` so no probe outlives the incident. Scripts run from a vetted, signed library; arbitrary one-liners require break-glass approval.
6. **Canary the runner.** New trace-runner versions roll to a 50-node canary pool; watch verifier-load failures and node CPU before fleet-wide.
7. **Document blind spots.** Wiki: "eBPF tracing answers *what the kernel/process is doing*; for cross-service latency and business context use OTel traces in the APM." Prevents misuse as a distributed-tracing replacement.

Result: any on-call engineer can launch a governed, time-boxed, kernel-portable trace on any node, with full audit and a bounded overhead budget — and no standing root DaemonSet.

## A Real Incident, Walked Through

**Symptom.** A payments service shows P99 latency spiking to 4 s intermittently. APM (OTel spans) shows the *application* handler taking 30 ms — the span starts late and the slow time is *outside* the instrumented code. APM is blind to the gap.

**Hypothesis.** Time is lost before the app handler runs: TLS handshake, connection accept backlog, or DNS. The span boundary can't see it.

**Investigate with eBPF on the affected node:**

```bash
HOST_PID=$(crictl inspect --output go-template --template '{{.info.pid}}' "$CID")

# Where is time going in the kernel for this process? Off-CPU + syscall latency.
bpftrace -e '
tracepoint:syscalls:sys_enter_* /pid == '"$HOST_PID"'/ { @start[tid] = nsecs; }
tracepoint:syscalls:sys_exit_*  /pid == '"$HOST_PID"' && @start[tid]/ {
  @lat[probe] = hist(nsecs - @start[tid]); delete(@start[tid]); }'
```

The histogram shows `sys_exit_connect` and `sys_exit_recvfrom` (DNS) with a long tail. A follow-up DNS-specific trace confirms `getaddrinfo` occasionally blocking ~4 s.

**Root cause.** A node-local DNS cache (NodeLocal DNSCache) was crash-looping on a subset of nodes, forcing fallback to a throttled upstream resolver. The latency was entirely in name resolution — *before* any app span opened, and inside an encrypted/connection path APM never instrumented.

**Fix and proof.** Restart/repair NodeLocal DNSCache on the affected pool; the `sys_exit` DNS histogram collapses back to microseconds and P99 recovers. eBPF saw the syscall-level truth APM structurally could not.

## Pros and Cons

| Pros | Cons |
|------|------|
| Fleet-wide visibility with zero app changes | Linux-only (eBPF-for-Windows is nascent, not equivalent) |
| Sees syscall/network/CPU layers APM can't | Cannot reconstruct distributed-trace context or business semantics |
| Low per-event overhead; safe via verifier | Overhead compounds at fleet scale; must be budgeted |
| CO-RE/BTF → portable across kernels | Breaks on missing BTF, kernel skew, lockdown/secure-boot |
| Rich ecosystem (Cilium/Tetragon/Parca/Pixie) | Privileged; high-trust attack & supply-chain surface |
| Continuous profiling = always-on flame graphs | uretprobe protocol parsing fragile; TLS needs integration |

## Use Cases

- Fleet-wide continuous CPU profiling (parca-agent → Parca/Pyroscope) to find regressions across releases.
- Zero-code service-level RED metrics and service maps (Pixie, Coroot) for legacy/third-party binaries.
- Incident-time, node-level tracing of syscall/IO/network latency that APM spans don't cover.
- Network flow observability (Hubble) for connectivity and policy-drop debugging.
- Runtime security event streams (Tetragon/Falco) to correlate during incidents.
- Pre-TLS or in-TLS-library tracing (uprobe on the SSL lib) when integrated deliberately.

## Coding Patterns

- **Time-box every ad-hoc probe** with `activeDeadlineSeconds` / an `interval` self-exit so nothing lingers fleet-wide.
- **Filter to a host PID/cgroup** in-script; never assume "pod scope" exists at the kernel level.
- **Resolve uprobe binaries via `/proc/<pid>/root/...`** to cross the mount namespace.
- **Ship CO-RE objects with BTFHub fallback** and a kernel allowlist gate.
- **Pin maps in bpffs only with an explicit cleanup owner**; treat pins as resources with a lifecycle.
- **Correlate, don't replace:** join eBPF infra data to OTel trace IDs rather than trying to rebuild traces from syscalls.

## Clean Usage

Keep agents minimal and declared: a small, audited probe set; documented overhead; signed objects; least-privilege capabilities (`CAP_BPF`/`CAP_PERFMON`, not `CAP_SYS_ADMIN`); and a clear boundary between always-on agents (profiling) and ad-hoc, time-boxed incident tracing. Every BPF load should be attributable to a human and a reason.

## Best Practices

- Establish and **measure** an overhead budget per node; reject probes that exceed it.
- Maintain a **kernel/BTF support matrix**; gate agents off unsupported kernels gracefully.
- **Canary** BPF agents and trace-runners; re-validate before fleet kernel upgrades.
- Enforce **least privilege**: `CAP_BPF`+`CAP_PERFMON`, BPF LSM, signed programs, BPF tokens for tenants.
- **Audit** every load (who/what/when); restrict who can create privileged trace Jobs via RBAC.
- Treat third-party BPF agents as **high-trust supply chain**: pin, verify, read the probe list.
- Document **blind spots** so teams don't misuse eBPF as a distributed-tracing replacement.

## Edge Cases and Pitfalls

- **Missing BTF** on older/stripped kernels silently disables CO-RE agents — gate, don't crash-loop.
- **Mount-namespace path mismatch** makes uprobes "attach" to the wrong/nonexistent binary.
- **Host vs container PID confusion** mislabels which workload owns an event.
- **Orphaned bpffs pins** leak kernel memory after a crashed loader.
- **Lockdown/secure-boot** can forbid kprobes/kernel-memory reads entirely.
- **Verifier tightening** on a new kernel can reject a program that loaded fine before.
- **Hot-path probes** (`tcp_sendmsg`, scheduler) that are cheap on one node are catastrophic fleet-wide.

## Common Mistakes

- Running an always-on, unaudited, root DaemonSet "for observability" on every prod node.
- Expecting eBPF auto-instrumentation to give true distributed traces — it gives correlated infra data, not propagated context.
- Attaching a uprobe by host path inside k8s and wondering why it does nothing.
- Ignoring kernel skew and shipping a non-CO-RE agent that loads on 12% of the fleet.
- Granting `CAP_SYS_ADMIN` when `CAP_BPF`+`CAP_PERFMON` would do.
- Leaving heavy ad-hoc probes attached after the incident ends.

## Tricky Points

- **"Pod-scoped tracing" is a fiction at the kernel layer** — it's node tracing filtered by you.
- **Verifier-safe ≠ trustworthy** — memory safety says nothing about intent or exfiltration via maps.
- **eBPF can read TLS plaintext** — but only by hooking *inside* the TLS library (uprobe `SSL_read`) or via kTLS; on the raw socket it's ciphertext.
- **CO-RE doesn't fix everything** — new hook points and removed symbols still break across kernels.
- **BPF token** delegates load ability without blanket capability — the path to safer multi-tenant BPF.

## Anti-Patterns at Professional Level

- **eBPF as a silver bullet.** Treating it as the answer to every observability gap; ignoring that it can't see business/distributed semantics.
- **Replacing in-app spans.** Ripping out OTel SDK instrumentation because "eBPF auto-instruments" — losing real distributed context.
- **Ungoverned BPF in prod.** No audit, no signing, blanket `CAP_SYS_ADMIN`, arbitrary one-liners on demand.
- **Ignoring kernel skew.** Assuming one agent build runs everywhere; no BTF matrix.
- **Leaving heavy probes running fleet-wide.** No time-box, no overhead budget — a self-inflicted incident.
- **Trusting third-party agents blindly.** Running someone else's kernel code as root with no provenance check.

## Test Yourself

1. Why is "tracing a pod" a misnomer at the eBPF level, and how do you actually scope to one pod?
2. What two capabilities (5.8+) let you load and trace without full `CAP_SYS_ADMIN`, and what does each grant?
3. Why does a uprobe on `/usr/bin/app` fail inside Kubernetes, and what path fixes it?
4. Name three things eBPF auto-instrumentation structurally cannot give you that OTel SDK spans can.
5. What is BTF, and what happens on a node that lacks `/sys/kernel/btf/vmlinux`?
6. How would you read TLS plaintext with eBPF, and why isn't it "free"?
7. What is the BPF token and what problem does it solve for multi-tenant clusters?

## Tricky Questions

<details><summary>If Pixie auto-instruments HTTP/gRPC with zero code changes, why keep OpenTelemetry SDK spans at all?</summary>
Because Pixie (and any eBPF tool) reconstructs request data from buffers and syscalls at one node — it has no propagated trace context across services, no business attributes, and its uretprobe-based protocol parsing is fragile across library versions and breaks on TLS. OTel spans carry an in-band `traceparent`, semantic attributes, and exact logical timing regardless of encryption. Use eBPF for breadth/infra and SDK spans for distributed depth; correlate them.
</details>

<details><summary>A vendor ships an eBPF "observability" DaemonSet that runs as root on every node. What's your governance checklist before approving?</summary>
Verify provenance/attestation and pin the version; read the documented probe list (what hooks, what data leaves the node); require least privilege (`CAP_BPF`+`CAP_PERFMON`, not `CAP_SYS_ADMIN`); confirm it loads CO-RE objects with a BTF fallback and a kernel allowlist; measure its overhead against your budget on a canary; ensure loads are audited; and assess supply-chain risk — this is kernel code with high trust. Prefer signing/BPF LSM gating if your kernels support it.
</details>

<details><summary>Your fleet is mid-rollout to a new kernel. Continuous-profiling agents start crash-looping on the upgraded nodes. Likely cause?</summary>
Kernel skew: a hook point moved/renamed, BTF changed such that a CO-RE relocation now fails, or the verifier tightened and rejects a previously valid program. Mitigation: always re-validate BPF agents against the target kernel in a canary pool *before* fleet upgrade; gate the agent off unsupported kernels rather than crash-loop; keep a kernel/BTF matrix.
</details>

<details><summary>Can eBPF replace your APM for finding why a distributed checkout is slow?</summary>
No. eBPF can show which service/node is slow and at what syscall/network layer, but it cannot follow one logical request across services without propagated context, and it can't tell you it was customer 42's coupon path. It complements APM — narrowing "where" at the infra layer — but distributed "why across services" needs propagated spans.
</details>

## Cheat Sheet

```bash
# Ad-hoc node trace as a k8s Job
kubectl trace run node/<name> -e '<bpftrace program>'

# Host PID for a container
crictl inspect --output go-template --template '{{.info.pid}}' "$CID"

# uprobe across mount namespace
bpftrace -e 'uprobe:/proc/<host_pid>/root/path/to/bin:sym { ... }'

# Hubble L7 flows
hubble observe --namespace ns --protocol http --to-pod ns/svc --since 2m

# Capabilities (least privilege)
#   CAP_BPF      -> load programs/maps
#   CAP_PERFMON  -> perf/tracing reads
#   avoid CAP_SYS_ADMIN where possible

# bpffs pins (own the lifecycle!)
ls /sys/fs/bpf
bpftool prog show ; bpftool map show
```

| Need | Tool |
|------|------|
| Continuous CPU profiling, fleet-wide | parca-agent → Parca / Pyroscope |
| Zero-code service RED + map | Pixie / Coroot |
| Network flow observability | Cilium Hubble |
| Runtime security events | Tetragon / Falco |
| Ad-hoc node/container tracing | bpftrace / kubectl-trace |
| Distributed trace context | OpenTelemetry SDK (not eBPF) |

## Summary

At the professional tier, eBPF stops being a one-host one-liner and becomes a governed, fleet-scale diagnostic platform sitting inside a broad ecosystem — Cilium/XDP for networking, Tetragon/Falco for security, and parca-agent/Pixie/Pyroscope/Coroot/Hubble for observability and profiling — all built on the same verifier-checked, CO-RE-portable substrate. The professional's job is to deploy that capability with explicit overhead budgets, a kernel/BTF support matrix, least-privilege capabilities (`CAP_BPF`/`CAP_PERFMON`, BPF LSM, signing, BPF tokens), full audit of who loads what, and careful Kubernetes handling of PID/mount namespaces — while being honest that eBPF is blind to distributed-trace context, business semantics, and TLS payloads, so it complements rather than replaces OpenTelemetry SDK spans and APM. Used this way, dynamic tracing answers "what is the kernel and process actually doing" across thousands of nodes safely; used as a silver bullet or an ungoverned root DaemonSet, it becomes the incident.

## What You Can Build

- A governed `kubectl-trace`-style self-service tracing capability with RBAC, audit, and auto-expiry.
- A fleet continuous-profiling pipeline (parca-agent → Parca/Pyroscope) with an enforced overhead budget.
- A kernel/BTF support matrix and BTFHub fallback packaging for CO-RE agents.
- A correlation layer joining eBPF infra signals (Pixie/Hubble) to OTel trace IDs.
- A BPF governance policy: signing, BPF LSM gating, capability scoping, supply-chain review.

## Further Reading

- Brendan Gregg, *BPF Performance Tools* — the canonical catalog of production tracing tools.
- Brendan Gregg, *Systems Performance* (2nd ed.) — methodology that frames where tracing fits.
- Liz Rice, *Learning eBPF* — the runtime, verifier, CO-RE, and ecosystem from the ground up.
- Cilium / Hubble, Tetragon, Falco, Pixie, and Parca/Pyroscope official documentation.
- The **linux-debugging**, **observability-stack**, and **profiling-techniques** skills for adjacent methodology — host-level triage, stack design, and flame-graph-driven profiling.

## Related Topics

- [Continuous Profiling](../continuous-profiling/)
- [Tracing](../tracing/)
- [Metrics](../metrics/)
- [Logging](../logging/)
- [Debugging](../debugging/)
- [Observability Engineering](../observability-engineering/)

## Diagrams and Visual Aids

eBPF as one substrate, many consumers:

```
                         ┌───────────────────────────┐
                         │   bpf() syscall + verifier │
                         │   + JIT + maps/ringbuf     │
                         └─────────────┬─────────────┘
            ┌───────────────┬──────────┼──────────┬────────────────┐
            ▼               ▼          ▼          ▼                ▼
      DIAGNOSTICS      NETWORKING   SECURITY   PROFILING       (focus)
   bpftrace/Pixie/    Cilium/XDP/  Tetragon/  parca-agent/    <- this topic
   Coroot/Hubble        tc        Falco/LSM   Pyroscope
```

Where each layer sees (and stops):

```
  Business intent / customer / coupon ......... ONLY app (OTel span attrs)
  Distributed trace (req across services) ..... OTel propagated context
  TLS plaintext ............................... app, or eBPF uprobe in SSL lib
  HTTP/gRPC/SQL on the wire ................... eBPF protocol parsing (fragile)
  Syscalls / IO / connect / DNS latency ....... eBPF (the gap APM misses)  ◀──
  CPU stacks / scheduling / off-CPU ........... eBPF perf events
```

k8s uprobe path resolution across namespaces:

```
   host mount ns                         container mount ns
   ─────────────                         ──────────────────
   /usr/bin/bpftrace                      /usr/local/bin/api   (PID 1 inside)
        │                                        ▲
        │ attach uprobe ─── WRONG: /usr/local/bin/api (not on host)
        └────────────────── RIGHT: /proc/<host_pid>/root/usr/local/bin/api
                                   (host PID via crictl inspect)
```
