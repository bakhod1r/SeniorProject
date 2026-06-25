# Sandboxing & Isolation — Middle Level

> **Topic:** [Sandboxing & Isolation](README.md)
> **Focus:** The actual machinery. How does an OS *enforce* a sandbox? Syscall filtering (seccomp-bpf), namespaces, cgroups, capabilities, and the language-level sandboxes (V8 isolates, Wasm) — and why each is strong or weak where it is.

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

> Focus: **By what mechanism is a sandbox actually enforced?** A wall you can't point to isn't a wall. This level names the bricks.

At the junior level a sandbox was a *concept*: a box with a few doors. Now we look at how operating systems and language runtimes build those walls in concrete terms. The recurring insight: **almost everything interesting a program does — read a file, send a packet, fork a process, change its own permissions — goes through a system call to the kernel.** The syscall interface is therefore the natural place to enforce a sandbox. If you control which syscalls the guest can make, and which resources those syscalls can even *name*, you control what the guest can do.

On Linux, the modern sandbox is assembled from a small set of independent primitives, each restricting one axis:

- **seccomp-bpf** filters *which syscalls* a process may make at all.
- **namespaces** change *what the process can see* — its own view of processes, network, filesystem mounts, user IDs, hostnames, and IPC.
- **cgroups** cap *how much* it can consume — CPU, memory, I/O.
- **capabilities(7)** split the old all-or-nothing "root" into fine-grained powers.
- **Landlock**, **AppArmor**, and **SELinux** add *mandatory access control* — policy enforced by the kernel that even root can't simply override.

These compose. A real container is roughly "namespaces + cgroups + seccomp + capability dropping" combined. Other operating systems offer their own variants: OpenBSD's `pledge`/`unveil` and macOS's Seatbelt sandbox profiles.

In parallel, **language-level sandboxes** enforce a boundary inside a single process: V8 isolates separate JavaScript heaps, and WebAssembly enforces memory and capability boundaries by the structure of the bytecode itself. These are cheaper and faster but, as we'll see, fundamentally more fragile, because the wall is made of *correct code* rather than *hardware-enforced separation*.

> 🎓 **Why this matters at this level:** You're now the engineer who has to *configure* the sandbox, not just admire it. Picking the wrong primitive, leaving a namespace unshared, forgetting to drop a capability, or writing an over-broad seccomp filter is how real production sandboxes leak. Understanding what each brick does — and crucially, what it does *not* do — is the difference between a sandbox and a sandbox-shaped decoration.

This page covers the Linux sandbox primitives in working detail, the OpenBSD and macOS equivalents, how language-level sandboxes (V8 isolates, Wasm/WASI) enforce their boundary, why memory safety is the soft underbelly of in-process sandboxes, and the composition patterns that turn individual bricks into a wall. `senior.md` goes deeper into escape classes and the strength-vs-cost trade-off; `professional.md` covers production architectures.

---

## Prerequisites

What you should know before reading this:

- **Required:** The junior-level idea of a sandbox: least privilege, ambient authority, deny-by-default, the strength-vs-cost spectrum.
- **Required:** What a **system call** is and that file/network/process operations go through the kernel.
- **Required:** Basic Linux literacy — processes, file descriptors, users/UIDs, mount points, `fork`/`exec`.
- **Helpful but not required:** Familiarity with `strace`, Docker, or having configured a container before.
- **Helpful but not required:** A rough sense of what a JavaScript engine or a bytecode VM is.

You do **not** need to know:

- How to write BPF bytecode by hand (we read filters conceptually).
- Hypervisor internals or microVM design (that's `senior.md`/`professional.md`).
- Formal capability theory or exploitation techniques (later levels).

---

## Glossary

| Term | Definition |
|------|-----------|
| **System call (syscall)** | The kernel-entry mechanism a process uses for privileged actions (open, read, connect, fork, mmap…). The chokepoint sandboxes target. |
| **seccomp** | "Secure computing mode": a Linux feature to restrict the syscalls a process may make. |
| **seccomp-bpf** | The flexible form of seccomp: a BPF program inspects each syscall (number + arguments) and decides allow / deny / kill / trap. |
| **BPF (Berkeley Packet Filter)** | A small in-kernel bytecode used here to express the syscall-filtering policy. |
| **Namespace** | A Linux feature giving a process its own isolated *view* of a kernel resource. Types: pid, net, mnt, user, uts, ipc, cgroup, time. |
| **PID namespace** | Gives the process its own process-ID space; it can't see or signal processes outside it. |
| **Network namespace (net)** | Gives the process its own network stack — its own interfaces, routes, ports. An empty one = no network at all. |
| **Mount namespace (mnt)** | Gives the process its own filesystem mount table — you can present it a tiny, curated root. |
| **User namespace (user)** | Maps UIDs/GIDs so a process can be "root" *inside* while being unprivileged *outside*. Foundation of rootless containers. |
| **UTS namespace** | Isolates hostname and domain name. |
| **IPC namespace** | Isolates System V IPC and POSIX message queues. |
| **cgroup (control group)** | A Linux mechanism to limit and account resource usage (CPU, memory, I/O, PIDs) for a group of processes. |
| **capabilities(7)** | Linux's split of root's power into ~40 distinct privileges (e.g., `CAP_NET_ADMIN`, `CAP_SYS_ADMIN`), grantable individually. |
| **MAC (Mandatory Access Control)** | Security policy enforced by the kernel and not overridable by the resource owner — SELinux, AppArmor, Landlock. |
| **Landlock** | A modern, unprivileged Linux LSM letting a process restrict its *own* filesystem access. |
| **AppArmor / SELinux** | Kernel MAC systems that confine programs by administrator-defined policy (path-based vs label-based, respectively). |
| **pledge / unveil** | OpenBSD syscalls: `pledge` restricts which syscall *categories* a process may use; `unveil` restricts which filesystem paths it can see. |
| **Seatbelt** | macOS's sandbox (`sandbox_init` + `.sb` profile language) used by app sandboxing. |
| **V8 isolate** | An independent instance of the V8 JavaScript engine with its own heap; isolates don't share JS objects. |
| **Realm / context** | A fresh JavaScript global environment with its own built-ins, used to separate untrusted scripts in-process. |
| **Linear memory** | WebAssembly's single contiguous, bounds-checked memory region — a module cannot address outside it. |
| **WASI** | The WebAssembly System Interface: a capability-based API for Wasm to touch files, clocks, etc., only via handles the host grants. |
| **`no_new_privs`** | A process flag that prevents a process (and children) from ever gaining privileges via setuid/setgid — a seccomp prerequisite. |

---

## Core Concepts

### 1. The Syscall Is the Chokepoint

A user-space process can compute all it wants inside its own memory with no help from the kernel. But the moment it wants to *affect the world* — touch a file, send a packet, spawn a child, allocate more memory from the OS, change its identity — it must execute a **system call**. There is no other door. This makes the syscall interface the single most important place to enforce a sandbox: **restrict the syscalls, and you restrict the program's reach.** Every Linux sandbox primitive is, directly or indirectly, about this interface — either blocking syscalls (seccomp), or changing what the syscalls can *see* and *name* (namespaces), or capping what they can *consume* (cgroups).

### 2. seccomp-bpf — Filtering Syscalls

**seccomp-bpf** installs a small BPF program that the kernel runs on *every* syscall the process makes. The program inspects the syscall number (and, with limits, some argument registers) and returns a verdict:

| Verdict | Effect |
|---------|--------|
| `ALLOW` | Let the syscall proceed. |
| `ERRNO` | Make it fail with a chosen error (e.g., `EPERM`), as if denied. |
| `KILL` | Terminate the process immediately. |
| `TRAP` | Deliver a signal (lets a supervisor handle it). |
| `TRACE` / `USER_NOTIF` | Hand the decision to a tracer/supervisor in another process. |

You build a **deny-by-default** filter: deny (or kill on) everything, then explicitly allow the handful the program legitimately needs (`read`, `write`, `exit`, maybe `mmap`). A media transcoder, for instance, might allow file reads/writes and memory mapping but deny `socket`, `connect`, `execve`, `ptrace`, and `clone`. Now even a fully compromised transcoder *cannot open a network connection*, because the syscall that does so is simply not permitted.

Two important caveats: seccomp filters on syscall **number and register arguments**, but it generally **cannot dereference pointers** (it can't read the path string passed to `open`), so it can't make decisions based on *which* file — that's namespaces'/Landlock's job. And installing a seccomp filter requires `no_new_privs` so a sandboxed process can't escape via a setuid binary.

### 3. Namespaces — Changing What You Can See

A **namespace** virtualizes a kernel resource so the process gets its own private view. Linux has several, each isolating one axis:

- **mnt** — its own mount table. You can build a minimal root (just the few files it needs) and the process sees *only that*. Paths outside don't exist for it.
- **net** — its own network stack. Create one with no interfaces, and the process has *no network at all* — not even loopback — so it physically cannot connect anywhere.
- **pid** — its own process-ID space. It can't see, signal, or `ptrace` host processes; inside, it might be PID 1.
- **user** — maps UIDs. A process can be UID 0 (root) *inside* its user namespace while being an unprivileged UID *outside*. This is the basis of **rootless** containers and is the most security-relevant (and historically the most bug-prone) namespace.
- **uts** — its own hostname.
- **ipc** — its own IPC objects.

Namespaces are *visibility* control, not *permission* control: they shrink the set of things the process can even *name*. You can't attack a network you can't see. The combination of mnt + net + pid + user namespaces produces most of the isolation people associate with containers.

### 4. cgroups — Capping Consumption

Namespaces and seccomp control *what* a process can do; **cgroups** (control groups) control *how much*. A cgroup caps CPU shares, memory, I/O bandwidth, and the number of PIDs a group of processes may use, with the kernel enforcing the limit (e.g., the OOM killer fires when the memory cap is hit). This is the **anti-denial-of-service** leg of isolation: without it, a sandboxed process that can do nothing externally can still pin all CPUs or exhaust RAM. A sandbox without resource limits is not a complete sandbox.

### 5. capabilities(7) — Splitting Root

Historically a process was either root (can do everything) or not (can't do privileged things). **Capabilities** break root into ~40 separate powers: `CAP_NET_BIND_SERVICE` (bind ports below 1024), `CAP_NET_ADMIN` (configure networking), `CAP_SYS_ADMIN` (a huge, dangerous catch-all), `CAP_DAC_OVERRIDE` (bypass file permission checks), and so on. The least-privilege move is to **drop every capability you don't need.** A web server that only needs to bind port 443 can hold `CAP_NET_BIND_SERVICE` and drop everything else, so even if exploited it can't reconfigure the network or override file permissions. Note `CAP_SYS_ADMIN` is so broad it's often called "the new root" — granting it usually undoes much of your isolation.

### 6. Mandatory Access Control — Landlock, AppArmor, SELinux

Standard Unix permissions are *discretionary* (DAC): the owner of a file decides who may access it, and root overrides everything. **Mandatory Access Control (MAC)** layers on a policy the kernel enforces regardless of file ownership — even root is bound by it.

- **AppArmor** confines programs by **path-based** profiles ("this program may read `/etc/myapp/*` and nothing else").
- **SELinux** confines by **labels** on subjects and objects, with rich type-enforcement policy (powerful, complex).
- **Landlock** is newer and special: it's **unprivileged**, so a normal process can restrict *its own* filesystem access at runtime without an admin writing a system policy. This makes it ideal for an application sandboxing itself.

MAC complements seccomp/namespaces: seccomp says which *syscalls*, namespaces say which *resources are visible*, MAC says which *specific objects* the allowed syscalls may touch.

### 7. Other OSes: pledge/unveil and Seatbelt

Linux isn't the only model. **OpenBSD** offers two beautifully simple syscalls:

- **`pledge`** — a process *promises* it will only use certain categories of syscalls ("stdio", "rpath", "inet"…); breaking the promise kills it. It's deny-by-default and trivially auditable.
- **`unveil`** — restricts which filesystem paths the process can see, path by path.

The OpenBSD philosophy is that a program should *voluntarily reduce its own privileges* early in `main`, in two or three lines, after it's set up but before it processes untrusted input. **macOS** has **Seatbelt**: per-app sandbox profiles (a Scheme-like `.sb` policy language) controlling file, network, and IPC access, used by the App Sandbox and many system daemons.

### 8. Language-Level Sandboxes: V8 Isolates and Realms

Move up from the OS into a single process. A **V8 isolate** is an independent instance of the V8 JavaScript engine with its own heap and garbage collector; objects in one isolate cannot reference objects in another. Platforms run thousands of tenants by giving each a lightweight isolate instead of a whole process or VM — this is how some serverless/edge platforms achieve sub-millisecond cold starts. A **Realm** (or context) is a fresh JS global with its own built-ins, used to keep untrusted scripts from polluting or reading each other's globals.

The appeal is **density and speed**: an isolate is far cheaper than a process, which is far cheaper than a VM. The catch is in the next concept.

### 9. Why In-Process Sandboxes Are Fragile

An isolate's boundary is enforced by the **correctness of the engine's code**, not by hardware. The untrusted JavaScript and the host run in the *same address space*. If there's a single **memory-safety bug** in the engine — a type confusion, an out-of-bounds write in the JIT, a use-after-free — then carefully crafted guest code can read or write host memory and step across the boundary. This is exactly the class of bug that browser exploit chains weaponize. The lesson: **in-process language sandboxes are a real defense, but a soft one** — they're only as strong as the millions of lines of engine code holding the wall. This is why high-stakes systems put a *second*, OS-level or VM-level boundary around the in-process one (defense in depth).

### 10. WebAssembly: Boundaries Built Into the Bytecode

WebAssembly takes a different approach: the isolation is structural. A Wasm module addresses only its own **linear memory**, and every memory access is **bounds-checked** against that region's size — it cannot form a pointer into host memory because Wasm has no such pointers. It has **no ambient authority**: it can't call the OS, can't open files, can't network. To do anything external, the host must explicitly import functions into the module. **WASI** standardizes those imports as **capability-based** handles: the module receives a pre-opened directory handle and can only operate within it; it can't name `/etc/passwd` because it was never handed a handle that reaches there. Wasm is still software-enforced (a bug in the runtime can break it), but its small, verified core and capability-by-construction design make it a far smaller and more auditable trusted base than a full JS engine.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Syscall as chokepoint** | A building where the only way to interact with the outside is through one reception desk — control the desk, control everything. |
| **seccomp-bpf** | A bouncer with a guest list of *actions*: "You may use the printer and the kitchen. Everything else, denied." |
| **Namespaces** | Tinting the windows so the guest sees only their own room — the rest of the building isn't even visible. |
| **Network namespace (empty)** | A room with no phone, no internet jack, no signal — you literally cannot call out. |
| **User namespace** | A play "manager" badge: you're the boss *of this room*, but security at the real front desk doesn't recognize it. |
| **cgroups** | A meter on the room's power and water: use what you like up to the cap, then it's cut off. |
| **capabilities** | Replacing one master key with a ring of single-purpose keys, and only clipping on the ones needed. |
| **MAC (SELinux/AppArmor)** | House rules posted on the wall that even the owner must follow — not just "whoever owns the room decides." |
| **pledge/unveil** | A guest signing a short contract at the door: "I will only use the kitchen and read these two books," enforced on pain of ejection. |
| **V8 isolate** | Separate soundproof booths in one studio — cheap to add, but all sharing the same building (one structural fault affects all). |
| **Wasm linear memory** | A sealed sandbox tray: the toys can only be moved *within the tray*, and bumping the edges is physically blocked. |
| **WASI capability handle** | Being handed one specific labeled drawer's key, with no way to ask for the keys to other drawers. |

---

## Mental Models

### The "Three Axes" Model

Don't think of a Linux sandbox as one thing; think of **three orthogonal axes**, each handled by a different primitive:

```text
WHAT can it DO?       -> seccomp (which syscalls)
WHAT can it SEE?      -> namespaces (visible resources)
HOW MUCH can it USE?  -> cgroups (resource limits)
```

A real sandbox sets all three. Leaving one out is a leak: full syscall filtering but no namespace means it can still see the host's processes; perfect namespaces but no cgroup means it can still freeze the machine.

### The "Voluntary Self-Restriction" Model

The cleanest sandboxes (pledge/unveil, Landlock, seccomp installed by the program itself) follow a pattern: **the program drops its own privileges early, right after setup and before touching untrusted input.** Open the files you'll need, bind the port, *then* pledge/seccomp/Landlock away the powers you no longer need. After that line, even if the rest of the program is exploited, the attacker inherits the *reduced* privilege set. Think: "initialize with power, then throw the power away before the dangerous part."

### The "Software Wall vs Hardware Wall" Model

Sort every sandbox into one of two buckets:

- **Software-enforced** (V8 isolate, Wasm, in-process): the wall is correct code. Fast and dense, but a single memory bug in the enforcer can collapse it.
- **Hardware/kernel-enforced** (separate process + namespaces, VMs): the wall is the CPU's address-space separation or the hypervisor. Costlier, but a memory bug in the guest stays in the guest.

When you distrust the guest a lot, you want at least one hardware/kernel wall in the stack. The software walls are excellent *additional* layers, weak as the *only* layer.

### The "Visibility Is Not Permission" Model

Namespaces remove *visibility*; capabilities and MAC remove *permission*; seccomp removes *the action itself*. These are different. A process might be *permitted* to open sockets (has the capability) but can't reach anything because its network namespace is empty (no visibility), and also can't call `socket` because seccomp blocks it (no action). Strong sandboxes overlap these so that no single missing brick opens a path.

---

## Code Examples

These are illustrative and simplified; production code needs careful error handling and platform checks.

### seccomp-bpf in C with libseccomp (deny-by-default)

```c
#include <seccomp.h>
#include <unistd.h>

void install_filter(void) {
    // Default action: kill the process on any syscall not explicitly allowed.
    scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_KILL_PROCESS);

    // Allow only the syscalls this worker legitimately needs.
    seccomp_rule_add(ctx, SCMP_ACT_ALLOW, SCMP_SYS(read),  0);
    seccomp_rule_add(ctx, SCMP_ACT_ALLOW, SCMP_SYS(write), 0);
    seccomp_rule_add(ctx, SCMP_ACT_ALLOW, SCMP_SYS(exit_group), 0);
    seccomp_rule_add(ctx, SCMP_ACT_ALLOW, SCMP_SYS(brk),   0);
    seccomp_rule_add(ctx, SCMP_ACT_ALLOW, SCMP_SYS(mmap),  0);
    // Note: NO socket, NO connect, NO execve, NO clone, NO ptrace.

    seccomp_load(ctx);   // from here on, the filter is active and irreversible
    seccomp_release(ctx);
}

int main(void) {
    // ... set up: open the files/handles we'll need ...
    install_filter();    // drop privileges BEFORE processing untrusted input
    // ... process untrusted data: even if exploited, it can't network or fork ...
    return 0;
}
```

After `seccomp_load`, an attempt to `socket()` or `execve()` terminates the process. The filter is **deny-by-default**, installed **after setup**, and **irreversible** — three properties of a good seccomp sandbox.

### Restricting Syscalls Directly with `prctl` (no library)

```c
#include <sys/prctl.h>
#include <linux/seccomp.h>

// Prerequisite: forbid gaining new privileges (e.g. via setuid binaries).
prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
// Then install a BPF program (omitted) via PR_SET_SECCOMP / SECCOMP_SET_MODE_FILTER.
```

`PR_SET_NO_NEW_PRIVS` is mandatory: without it, an unprivileged process could try to escape the sandbox by executing a setuid program. seccomp filtering for unprivileged processes is only allowed once this flag is set.

### Building a Network-less, Filesystem-restricted Child (conceptual, Linux)

```c
// Pseudocode for the namespace-isolation pattern:
//
// 1. clone() the child with new namespaces:
//      CLONE_NEWNET   -> empty network: no interfaces at all
//      CLONE_NEWNS    -> private mounts: build a tiny root
//      CLONE_NEWPID   -> can't see host processes
//      CLONE_NEWUSER  -> "root" inside, unprivileged outside
//
// 2. In the child, set up a minimal root filesystem:
//      mount a fresh /, bind-mount only /sandbox into it,
//      then pivot_root / chroot so nothing else is reachable.
//
// 3. Apply a cgroup limit (memory, CPU, pids) to the child.
//
// 4. Install a seccomp filter (deny-by-default).
//
// 5. exec the untrusted program.
//
// Result: the untrusted program sees an empty network, a 1-directory
// filesystem, no host processes, capped resources, and a tiny syscall
// allowlist. This stack is roughly what a hardened container is.
```

### Running Untrusted Wasm With No Authority, Then Granting One Directory

```rust
// Using a Wasm runtime (e.g. wasmtime). The module starts with ZERO authority.
let engine = Engine::default();
let module = Module::from_file(&engine, "untrusted.wasm")?;

// WASI context: grant ONLY a single pre-opened directory as a capability.
// The module can operate within "./sandbox_dir" and CANNOT name anything else.
let wasi = WasiCtxBuilder::new()
    .preopened_dir(open_dir("./sandbox_dir")?, "/")?   // its entire visible FS
    // no inherit_network(), no inherit_stdio of secrets, no other dirs
    .build();

let mut store = Store::new(&engine, wasi);
let instance = linker.instantiate(&mut store, &module)?;
// The module can compute and touch ./sandbox_dir. It has no path to
// /etc/passwd, no socket, no host memory: capability-by-construction.
```

The module's *only* link to the outside world is the directory handle the host chose to pre-open. There is no API by which it can ask for more — that's the capability model in action.

### V8 Isolate: Cheap, But Same Address Space (caution)

```text
// Conceptual: a host runs many tenants, each in its own V8 isolate.
//
//   isolate_A  (tenant 1's heap)   ┐
//   isolate_B  (tenant 2's heap)   ├─ all inside ONE OS process
//   isolate_C  (tenant 3's heap)   ┘
//
// JS objects can't cross isolates by design -> good logical isolation,
// great density (thousands per process), sub-ms startup.
//
// BUT: a single memory-safety bug in V8 (e.g., a JIT type confusion)
// lets malicious JS in isolate_B read/write the SHARED process memory,
// reaching isolate_A or the host. That's why production platforms wrap
// the isolate process itself in OS-level sandboxing + per-tenant limits.
```

---

## Pros & Cons

| Primitive | Pros | Cons |
|-----------|------|------|
| **seccomp-bpf** | Shrinks attack surface drastically; cheap; composes with everything. | Can't inspect pointer args (no "which file"); over-broad allowlists leak; brittle if a needed syscall is missed (crashes). |
| **Namespaces** | Strong visibility isolation; foundation of containers; mostly free. | User namespaces have a history of kernel CVEs; misconfiguration leaks host resources. |
| **cgroups** | Real resource caps; prevents DoS; per-group accounting. | Don't isolate, only limit; v1/v2 differences trip people up. |
| **capabilities** | Fine-grained de-privileging; least privilege for "root" tasks. | `CAP_SYS_ADMIN` is so broad it negates much isolation; easy to over-grant. |
| **MAC (SELinux/AppArmor/Landlock)** | Policy even root can't bypass; object-level control. | SELinux is complex to author; AppArmor path-based gaps; Landlock is FS-only. |
| **pledge/unveil** | Beautifully simple, auditable, deny-by-default. | OpenBSD only; coarse-grained categories. |
| **V8 isolate / Realm** | Extreme density, sub-ms startup, cheap per tenant. | Software wall in shared address space; one engine memory bug = escape. |
| **WebAssembly / WASI** | No ambient authority; capability-based; small TCB; portable. | Still software-enforced; ecosystem and host-interface still maturing. |

---

## Use Cases

- **Hardening a media/document parser:** seccomp-deny `socket`/`execve`/`clone`; the parser keeps reading and writing files but cannot exfiltrate or spawn shells even if the input exploits it.
- **Multi-tenant edge/serverless:** V8 isolates or Wasm modules for thousands of cheap, fast tenants — wrapped in OS-level isolation as a second layer.
- **Running a build/CI step from an untrusted dependency:** namespaces (empty net, minimal FS) + cgroups + seccomp, so a malicious `postinstall` script can't reach your secrets or the network.
- **A self-confining daemon:** an OpenBSD service that `pledge`s down to `"stdio rpath"` after startup, or a Linux service that installs a seccomp filter and Landlock rules on itself.
- **Plugin systems:** ship plugins as Wasm so each one runs with exactly the host functions you import and nothing else.
- **Rootless containers:** user namespaces let unprivileged users run containers without real root, shrinking the damage of a container escape.

---

## Coding Patterns

### Pattern 1: Set Up, Then Drop (privilege separation in time)

```text
main():
    open files / bind ports / load config   <- needs privilege & broad access
    --- DROP HERE ---
    pledge("stdio") / seccomp_load() / landlock_restrict_self()
    process_untrusted_input()                <- runs with minimal privilege
```

Acquire what you need first, then irreversibly shed everything else *before* the dangerous code runs.

### Pattern 2: Stack the Three Axes

```text
seccomp   (what it can DO)    +
namespaces(what it can SEE)   +
cgroups   (how much it USES)  +
capability drop / MAC         = a real sandbox, not a partial one.
```

Never ship a sandbox missing one of these axes for code you genuinely distrust.

### Pattern 3: Pre-open Capabilities, Don't Grant Ambient Access

```text
Host opens the one allowed directory/socket and passes the HANDLE in
(WASI preopened_dir, a passed file descriptor). The guest uses the handle
but has no syscall/API to open anything by name. Authority = exactly the
handles you passed.
```

### Pattern 4: Two Walls for High Distrust

```text
in-process isolate/Wasm  (cheap logical isolation, density)
        wrapped inside
OS-level sandbox or microVM  (hardware/kernel wall for escapes)

So that a memory-safety bug in the inner enforcer is caught by the outer wall.
```

### Pattern 5: Fail Closed

```text
If the sandbox can't be fully applied (seccomp load fails, namespace
unsupported, cgroup unavailable) -> ABORT, don't run the untrusted code
unsandboxed. A sandbox that silently degrades to "no sandbox" is worse
than no sandbox, because you think you're protected.
```

---

## Best Practices

- **Install the sandbox before touching untrusted input,** after you've opened everything you legitimately need.
- **Make filters deny-by-default and allow the minimum.** Audit each allowed syscall/capability/path — could you drop it?
- **Always pair isolation (seccomp/namespaces) with resource limits (cgroups).** Containment without DoS protection is incomplete.
- **Drop all capabilities you don't need; never grant `CAP_SYS_ADMIN` casually** — it's effectively root and dissolves much of your isolation.
- **Set `no_new_privs` before seccomp** and never run sandboxed code through setuid binaries.
- **Prefer the program restricting itself** (Landlock, pledge, self-installed seccomp) so the policy lives with the code and travels with it.
- **Fail closed:** if any sandbox layer can't be applied, refuse to run the untrusted code rather than running it bare.
- **Treat in-process sandboxes as one layer.** Wrap V8 isolates / Wasm runtimes in an OS-level boundary when the guest is genuinely hostile.
- **Keep the host-exposed interface tiny.** For Wasm, import only the functions the module truly needs; for syscalls, allow only the few required. Every exposed surface is attack surface.
- **Test the sandbox by trying to escape it.** Confirm `socket()` fails, that `/etc/passwd` is unreachable, that the memory limit fires. An untested sandbox is a guess.

---

## Edge Cases & Pitfalls

- **The forgotten syscall.** Your allowlist misses one syscall the runtime needs (often deep in libc or the allocator) and the program crashes — or you over-allow to "fix" it and reopen the hole. Trace real runs to build the list precisely.
- **Pointer-argument blindness in seccomp.** seccomp filters on the syscall number and register args, not the *contents* of pointers, so it cannot say "open only `/tmp/x`." You need namespaces/Landlock/MAC for path-level control.
- **`CAP_SYS_ADMIN` creep.** It's required for some legitimate operations (certain mounts), and granting it tends to unravel the rest of the sandbox. Look for narrower alternatives.
- **User-namespace CVEs.** User namespaces expanded the unprivileged kernel attack surface; several escapes have come from there. Powerful and convenient, but keep the kernel patched.
- **cgroup v1 vs v2 differences.** Limits configured for one don't apply under the other; "I set a memory limit" can silently do nothing on the wrong hierarchy.
- **In-process boundary trusts the engine.** A V8/Wasm sandbox is only as strong as the engine's memory safety. Don't treat a single in-process boundary as sufficient for highly hostile code.
- **TOCTOU at the boundary.** If the host checks a path/permission and then the guest acts, a window exists where the referenced object changes (a swapped symlink, a recreated file). Operate on handles you already opened, not on names you re-resolve.
- **Sandbox doesn't sandbox the data path.** You can lock down syscalls but still hand the guest a shared writable file or memory region that becomes the escape/communication channel.
- **Silent degradation.** Code paths where the sandbox "couldn't be applied here" quietly run the guest unconfined.
- **Namespaces leak via `/proc` and special files.** Mounting host `/proc`, `/sys`, or device nodes into the sandbox can re-expose what the namespaces hid.

---

## Common Mistakes

1. **Over-broad seccomp allowlists** ("allow everything except a few") instead of deny-by-default.
2. **Skipping `no_new_privs`,** leaving a setuid escape path open.
3. **Namespaces without cgroups** — perfectly isolated, still able to OOM or peg the host.
4. **Granting `CAP_SYS_ADMIN`** to make something work, quietly undoing the sandbox.
5. **Mounting host `/proc` or `/sys`** into the sandbox and re-exposing the host.
6. **Treating a single V8 isolate as a hard boundary** for hostile tenants, with no OS-level wall behind it.
7. **Granting a Wasm module too many host imports** ("just give it filesystem access") and recreating ambient authority.
8. **Installing the sandbox too late,** after some untrusted input has already been processed.
9. **Failing open** — running the code unsandboxed when a layer can't be applied.
10. **Not testing the walls** — assuming `socket()` is blocked without ever confirming it fails.

---

## Tricky Points

- **seccomp can't read paths, namespaces can't block syscalls.** They cover different axes; you usually need both. Confusing their jobs creates gaps.
- **"Root inside a user namespace" is not real root.** It's powerful within the namespace but unprivileged outside — except where kernel bugs let that boundary leak, which is the historic risk.
- **A network namespace with loopback is not the same as one with none.** "Empty net" (no interfaces) is stronger than "private net with lo" — decide which you actually need.
- **Dropping a capability is irreversible for that process,** which is the point — but it also means ordering matters: do privileged setup before dropping.
- **Wasm bounds-checks memory, but the *host functions* are the soft spot.** A buggy host import (e.g., one that trusts an index from the guest) reintroduces a memory bug across the boundary. The Wasm core is safe; your imported functions are your new attack surface.
- **An isolate's logical separation (no shared objects) is not a memory boundary.** Two isolates share the process's address space; the separation holds only while the engine is bug-free.
- **`pledge` promises are checked at syscall time, not declaration time.** You promise categories up front; violating one *later* kills the process — great for catching surprises, but it means thorough testing is needed so a rare code path doesn't kill you in production.

---

## Test Yourself

1. Name the three orthogonal axes a complete Linux sandbox should cover and which primitive handles each.
2. Why can seccomp block `open` entirely but *not* "allow opening only `/tmp/x`"? Which primitive fills that gap?
3. What does `no_new_privs` prevent, and why must it be set before installing a seccomp filter for an unprivileged process?
4. Explain how an *empty* network namespace makes network exfiltration impossible regardless of the guest's intent.
5. Why is granting `CAP_SYS_ADMIN` often described as undoing your sandbox? Give one reason.
6. A V8 isolate keeps tenant heaps separate, yet a malicious tenant escapes to the host. What class of bug made that possible, and why doesn't the isolate boundary stop it?
7. Describe, in WASI terms, how a module ends up able to write to `./sandbox_dir` but unable to even *name* `/etc/passwd`.
8. What's the "set up, then drop" pattern, and why does the *order* matter for security?
9. Your sandboxed process can't open sockets or see host files, but it allocates memory in an infinite loop and freezes the box. Which axis did you forget, and what fixes it?
10. Why is "fail closed" the correct behavior when a sandbox layer can't be applied, and what's the danger of "fail open"?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              OS & LANGUAGE SANDBOX PRIMITIVES (Linux-centric)     │
├──────────────────────────────────────────────────────────────────┤
│ THREE AXES (set all three):                                      │
│   DO   -> seccomp-bpf   (which syscalls; deny-by-default)        │
│   SEE  -> namespaces    (pid/net/mnt/user/uts/ipc views)        │
│   USE  -> cgroups       (CPU / memory / I/O / PID caps)          │
├──────────────────────────────────────────────────────────────────┤
│ PERMISSION refinements:                                          │
│   capabilities(7)  -> split root; drop all you don't need        │
│   Landlock         -> unprivileged self FS restriction           │
│   AppArmor (path) / SELinux (label) -> MAC, even root is bound   │
├──────────────────────────────────────────────────────────────────┤
│ OTHER OSes:                                                      │
│   OpenBSD: pledge (syscall categories) + unveil (paths)          │
│   macOS:   Seatbelt (.sb profiles)                               │
├──────────────────────────────────────────────────────────────────┤
│ LANGUAGE-LEVEL (in-process, software wall):                      │
│   V8 isolate / Realm -> dense & fast; SHARED address space;      │
│                         one engine memory bug = escape           │
│   WebAssembly        -> linear memory bounds-checked;            │
│                         no ambient authority                     │
│   WASI               -> capability handles (preopened dirs)      │
├──────────────────────────────────────────────────────────────────┤
│ RULES:                                                           │
│   * set no_new_privs before seccomp                              │
│   * set up THEN drop (irreversibly), before untrusted input      │
│   * fail CLOSED if a layer can't apply                           │
│   * wrap in-process sandboxes in an OS/VM wall for hostile code  │
│   * keep the exposed interface (syscalls/imports) tiny           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Everything a program does externally goes through a **syscall**, making the syscall interface the natural enforcement point for a sandbox.
- Linux assembles sandboxes from orthogonal primitives: **seccomp-bpf** (which syscalls), **namespaces** (what's visible — pid/net/mnt/user/uts/ipc), **cgroups** (resource caps), **capabilities** (split root), and **MAC** (Landlock/AppArmor/SELinux, policy even root can't bypass). A hardened container is roughly all of these combined.
- A complete sandbox covers **three axes — DO, SEE, USE** — plus capability dropping/MAC; omitting any one is a leak.
- Other OSes offer elegant variants: OpenBSD's **pledge/unveil** and macOS **Seatbelt**.
- **Language-level sandboxes** (V8 isolates, Realms) enforce a boundary *inside one process* — extremely dense and fast, but **software-enforced in a shared address space**, so a single memory-safety bug in the engine breaks the wall.
- **WebAssembly** builds isolation into the bytecode: bounds-checked linear memory and **no ambient authority**, with **WASI** granting access only through capability handles — a much smaller, more auditable trusted base than a full JS engine, though still software-enforced.
- Best practice: **set up then drop** privileges before untrusted input, **deny by default**, **fail closed**, **stack the axes**, and **wrap in-process sandboxes in an OS/VM wall** when the guest is truly hostile.
- The recurring theme: *visibility, permission, and action are separate controls* — strong sandboxes overlap them so no single missing brick opens a path.

---

## Further Reading

- *`man 2 seccomp`, `man 7 namespaces`, `man 7 capabilities`, `man 7 cgroups`* — the primary Linux references; read them directly.
- *The Landlock documentation* — https://landlock.io/ — unprivileged self-sandboxing.
- *OpenBSD `pledge(2)` and `unveil(2)` man pages* — the gold standard for simple, auditable self-restriction.
- *"Sandboxing in Linux with zero lines of code"* and similar LWN.net articles on seccomp/namespaces — practical depth.
- *The Chromium sandbox design docs* — how seccomp + namespaces + a broker are combined in a real product.
- *WebAssembly System Interface (WASI) documentation* — https://wasi.dev/ — capability-based system access.
- *Apple's "App Sandbox Design Guide"* — Seatbelt profiles in practice.
- *"Understanding and Hardening Linux Containers"* — NCC Group whitepaper — namespaces/cgroups/seccomp as a security boundary.

---

## Diagrams & Visual Aids

### The Three Axes of a Linux Sandbox

```text
                       ┌──────── untrusted process ────────┐
                       │                                   │
   seccomp-bpf  ───────┤  WHAT can it DO?                  │
   (syscall filter)    │   only: read, write, exit, mmap   │
                       │   denied: socket, execve, clone…  │
                       │                                   │
   namespaces   ───────┤  WHAT can it SEE?                 │
   (pid/net/mnt/...)   │   net: empty (no interfaces)      │
                       │   mnt: only /sandbox              │
                       │   pid: can't see host processes   │
                       │                                   │
   cgroups      ───────┤  HOW MUCH can it USE?             │
   (resource caps)     │   mem: 128MB  cpu: 0.5  pids: 32  │
                       │                                   │
                       └───────────────────────────────────┘
        Drop any one axis and a hole opens in that dimension.
```

### Software Wall vs Hardware/Kernel Wall

```text
SOFTWARE-ENFORCED (in-process)            KERNEL/HARDWARE-ENFORCED
┌───────────── one process ─────────┐     ┌─ host ─┐  ┌─ guest process / VM ─┐
│  host  │  guest (untrusted JS/Wasm)│     │ host   │  │  guest               │
│  ▲ shared address space ▲          │     │ memory │  │  memory (separate)   │
│  └── wall = correct engine code ───┘     └────────┘  └──────────────────────┘
   FAST, DENSE                                ▲ wall = address-space / hypervisor
   one memory bug in engine = ESCAPE          COSTLIER; guest memory bug stays in guest

   -> For hostile guests: put a kernel/hardware wall AROUND the software one.
```

### WASI Capability Model: Authority = Handles You Were Given

```text
   host                                   wasm module (untrusted)
   ┌───────────────────────────┐          ┌───────────────────────────┐
   │ open("./sandbox_dir") ─────┼─ handle ─►  fd 3  (its only door)    │
   │                           │          │                           │
   │ /etc/passwd  (NOT passed) │          │  cannot NAME /etc/passwd   │
   │ network      (NOT passed) │          │  no socket import = no net │
   └───────────────────────────┘          └───────────────────────────┘
        The module has exactly the capabilities handed to it. There is
        no API to request more. Authority is not ambient; it is granted.
```

### "Set Up, Then Drop" Over Time

```text
TIME ─►

  [ open files ][ bind port ][ load config ]     <- full privilege (setup)
                                          │
                                   ── DROP ──   pledge / seccomp_load / landlock
                                          │
  [ ........ process UNTRUSTED input ........ ]  <- minimal privilege

   An exploit landing in the right half inherits only the reduced powers.
```
