# Sandboxing & Isolation — Junior Level

> **Topic:** [Sandboxing & Isolation](README.md)
> **Focus:** You have a piece of code you don't fully trust. How do you run it while bounding what it can read, write, and reach? This is the core idea of a sandbox.

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
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [What You Can Build](#what-you-can-build)
18. [Further Reading](#further-reading)
19. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a sandbox?** And **why would I ever want to deliberately limit what my own program can do?**

A **sandbox** is a controlled environment that runs code while restricting what that code is *allowed to do*. The code inside can compute, allocate memory, maybe read a file or two — but it cannot reach the rest of your system. It cannot delete `/etc/passwd`, open a socket to a server in another country, read your SSH keys, or spawn a shell, *unless you explicitly granted it that power*.

The reason sandboxes exist is simple: **you constantly run code you didn't write and don't fully trust.** A browser runs JavaScript from every website you visit. A serverless platform runs functions uploaded by thousands of customers on shared machines. A game runs mods written by strangers. A CI pipeline runs build scripts pulled from a dependency you've never audited. In every one of these cases, the code is *useful* but *untrusted*, and "untrusted" means: assume it might be malicious or buggy, and make sure that even if it is, it can't hurt anything outside its box.

The key mental shift for a junior is this: **a sandbox is about limiting power, not about detecting badness.** An antivirus tries to spot bad code by recognizing it. A sandbox doesn't care whether the code is good or bad — it simply removes the code's *ability* to do harm. Even if the code is 100% malware, if it physically cannot open a network socket, it cannot exfiltrate your data over the network. That is a much stronger guarantee than "we scanned it and it looked fine."

In one sentence: **a sandbox is a room with very few doors, and you control every door.** The code runs inside; the only things it can touch are the doors you chose to open for it.

> 🎓 **Why this matters for a junior:** Even early in your career you will be handed the job of "run this untrusted thing safely" — a user-uploaded script, a plugin, a third-party library, a webhook handler. The instinct of most beginners is to *trust and hope*. The professional instinct is to *contain*: run it where it can do the least damage. Learning the basic vocabulary (process, syscall, capability, least privilege) and the basic levers (separate process, restricted filesystem, no network) is the foundation of every security architecture you'll ever build.

This page covers what a sandbox really is, the difference between *trusted* and *untrusted* code, the idea of **least privilege**, the simplest building blocks (separate processes, restricted file access, no network), and a first look at the spectrum of techniques — from in-process language sandboxes to whole virtual machines. Deeper levels go into the actual mechanisms: `middle.md` covers OS primitives like seccomp and namespaces, `senior.md` covers the isolation-strength-vs-cost spectrum and escape classes, and `professional.md` covers production architectures like browser process models and microVMs.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a **process** is — a running program with its own memory. You've at least seen `ps` or Task Manager.
- **Required:** Roughly what a **file** and a **network connection** are, and that programs use them.
- **Required:** The idea that a program asks the operating system for things (open a file, send data) rather than doing them directly.
- **Helpful but not required:** Awareness that your OS has a **kernel** (the privileged core) and **user space** (where your programs run).
- **Helpful but not required:** Some exposure to JavaScript, a browser, or a language runtime — many sandbox examples live there.

You do **not** need to know:

- How seccomp-bpf filters are written, or what a Linux namespace is internally (that's `middle.md`).
- How a hypervisor or microVM works (that's `senior.md` / `professional.md`).
- Anything about capability theory, the confused-deputy problem, or memory-safety exploitation (later levels).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Sandbox** | A restricted environment that runs code while limiting what it can access or do. |
| **Isolation** | Keeping one piece of code's effects separate from another's (and from the host). The "wall" of the sandbox. |
| **Trusted code** | Code you wrote or vetted and are willing to give full power. |
| **Untrusted code** | Code from an outside source you cannot fully verify — treat as potentially hostile. |
| **Host** | The system *running* the sandbox — the thing you're protecting. |
| **Guest** | The code running *inside* the sandbox. |
| **Least privilege** | Give code exactly the permissions it needs to do its job, and nothing more. |
| **Privilege** | The ability to perform a sensitive action: read a file, open a socket, run another program. |
| **Process** | A running program with its own memory space, isolated by the OS from other processes. |
| **Kernel** | The privileged core of the OS that controls hardware, memory, and access to everything. |
| **System call (syscall)** | The way a program asks the kernel to do something (open a file, send network data, create a process). |
| **Ambient authority** | Power a program has automatically just by running as you — e.g., it can open *any* file you can, without asking. |
| **Capability** | A specific, unforgeable token of permission ("you may use *this* file handle"), as opposed to ambient authority. |
| **Attack surface** | The set of ways untrusted code could try to reach outside the sandbox. Smaller is safer. |
| **Sandbox escape** | When code inside the sandbox finds a way to break out and act on the host. The thing we design against. |
| **In-process sandbox** | A sandbox that runs untrusted code *inside the same process* as the host (e.g., a JavaScript engine). Convenient but fragile. |
| **Virtual machine (VM)** | A simulated computer running its own OS, isolated from the host by hardware virtualization. Strong but heavy. |
| **Container** | A lightweight isolated environment using OS features (not a full VM). Common in deployment; *not* a strong security boundary by itself. |

---

## Core Concepts

### 1. Trusted vs Untrusted Code

The first question to ask about any code is: **do I trust it?** Trust here is binary in spirit: either you wrote/audited it and will give it power, or you didn't and you won't. The danger zone is the huge amount of code in between — dependencies, plugins, user input that gets executed, scripts from the internet. The default professional stance is: **code I didn't write is untrusted until contained.**

A sandbox is the tool for the untrusted column. You run trusted code normally; you run untrusted code in a box.

### 2. Least Privilege

**Least privilege** means a program should have exactly the permissions it needs and not one more. A function that resizes images needs to read the input image and write the output image. It does **not** need network access, the ability to read your password file, or permission to launch other programs. If you grant it only "read this file, write that file," then even a malicious image-resizer is harmless — it has no power to misuse.

Least privilege is the *goal*; a sandbox is the *enforcement mechanism*. The sandbox is where you actually take away everything the code doesn't need.

### 3. Ambient Authority — The Root Problem

Here's the uncomfortable default of normal programs: when you run a program, it inherits *your* power. It can open any file your user account can open, connect to any server, spawn any process. It has this power **automatically, without asking** — that's called **ambient authority**. The program didn't request file access; it just *has* it, in the air around it, like ambient light.

Ambient authority is why a single malicious script can do so much damage: it starts the game with all of your permissions already in hand. Sandboxing is largely about **removing ambient authority** — taking away the automatic power and forcing code to use only the specific permissions you handed it.

### 4. The Boundary: Inside vs Outside

Every sandbox has a **boundary** — a wall separating "inside the box" from "the host." The entire job of the sandbox is to make sure that:

- Code inside cannot read or write memory outside.
- Code inside cannot perform sensitive actions (file, network, process) except through doors you opened.
- Even if the code inside is fully malicious, the damage is confined to the box.

The boundary is where security lives. A **sandbox escape** is what we call it when code crosses that boundary it wasn't supposed to. Designing a sandbox is largely designing a boundary that is hard to cross.

### 5. The Simplest Sandbox: A Separate Process

The OS already gives you a basic, free isolation boundary: the **process**. Each process has its own memory; one process cannot directly read another process's memory. So the first, cheapest sandboxing move is: **run the untrusted code in a separate process.** If it crashes, only that process dies — your main program survives. If it corrupts memory, it corrupts *its own* memory, not yours.

A separate process alone is weak (the untrusted process still has your file and network access), but it's the foundation that everything else builds on. Strong sandboxes start with "separate process" and then *add restrictions* on top: no network, restricted filesystem, limited syscalls.

### 6. The Three Big Things to Restrict

When you sandbox code, you're usually limiting three categories of power:

| Resource | What unrestricted code can do | What a sandbox does |
|----------|-------------------------------|---------------------|
| **Filesystem** | Read/write/delete any file you can. | Allow only a specific directory, or nothing at all. |
| **Network** | Open connections anywhere. | Block all sockets, or allow only specific hosts. |
| **Process / system** | Spawn shells, run other programs, read system info. | Forbid creating new processes; block dangerous syscalls. |

A fourth, quieter one is **resources** — CPU time, memory, disk space — so that buggy or malicious code can't simply hog the machine (a denial-of-service). Limiting these is also part of isolation.

### 7. The Spectrum: Weak/Cheap to Strong/Expensive

There is no single "the sandbox." There's a **spectrum**, trading isolation strength against performance cost:

```text
WEAKER, CHEAPER  ◄──────────────────────────────────────►  STRONGER, COSTLIER

in-process    →   OS-level     →   WebAssembly   →   containers   →   microVMs / full VMs
language          sandbox          sandbox            (OS features)     (hardware virtualization)
sandbox           (seccomp,        (Wasm/WASI)
(V8 isolate)      namespaces)
```

- **In-process** (e.g., a JavaScript engine running untrusted JS): fast, lightweight, but fragile — a single memory-safety bug in the engine can let the guest reach into the host.
- **OS-level** (restricting syscalls and visible resources): stronger, still cheap, shares the kernel.
- **WebAssembly**: designed from scratch to be a sandbox — no ambient authority, isolated memory.
- **Containers**: convenient packaging + some isolation, but famously "not a security boundary" on their own.
- **microVMs / VMs**: each guest gets its own kernel and hardware-enforced boundary — strongest, but heavier to start and run.

The right point on this spectrum depends on *how much you distrust the code* and *how much performance you can spend*. Running your own helper script? A process limit is fine. Running arbitrary code uploaded by anonymous strangers on a shared server? You want something near the strong end.

### 8. Sandboxing Is One Layer, Not the Whole Story

A crucial early lesson: **a sandbox is one layer of defense, not a magic force field.** Good security uses **defense in depth** — multiple independent layers, so that breaking one doesn't break everything. A sandbox plus memory-safe code plus careful design is far stronger than any single one. Never think "it's sandboxed, so it's safe." Think "it's sandboxed, which is one of several reasons it's hard to abuse."

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Sandbox** | A child's literal sandbox: they can play freely *inside it*, but the mess stays in the box and doesn't spread across the yard. |
| **Untrusted code** | A contractor you hired but don't know well — useful, but you wouldn't hand them keys to every room. |
| **Least privilege** | Giving the plumber a key only to the bathroom, not to your whole house and safe. |
| **Ambient authority** | A houseguest who, by default, can open every door, drawer, and the front gate — without asking. |
| **Capability** | Handing someone one specific key for one specific door, instead of the master key. |
| **The boundary** | The walls of a prison visiting room: people inside and outside can interact only through the small window. |
| **Separate process** | Giving the contractor their own separate workshop instead of letting them work inside your living room. |
| **Sandbox escape** | The contractor finding an unlocked back window and wandering into the rest of the house. |
| **Defense in depth** | A bank with a guard, a locked door, a vault, *and* cameras — not just one of them. |
| **Container vs VM** | A container is a partitioned cubicle in a shared office (thin walls, shared building); a VM is a separate building with its own foundation. |
| **Resource limits** | A time limit and a snack limit so one kid can't eat all the cookies or hog the sandbox all day. |

---

## Mental Models

### The "Room With Doors" Model

Picture the untrusted code as a person locked in a room. By default — without a sandbox — that "room" is your entire house: every door is open. Sandboxing is the act of **walling off a small room and then deciding, one by one, which doors to add.** Want it to read one config file? Add exactly that door. Want it to write output? Add exactly that door. Everything you don't add simply isn't reachable. The discipline is: **start with zero doors and add the minimum**, never "start with all doors and try to close the dangerous ones." (You'll always forget one.)

### The "Deny by Default" Model

The single most important security default is **deny by default**: everything is forbidden unless explicitly allowed. The opposite — **allow by default**, where you try to enumerate and block the bad things — always loses, because attackers find the one thing you forgot to block. A good sandbox is an *allowlist* ("only these specific powers"), never a *blocklist* ("everything except these bad ones"). Carry this: **allowlist beats blocklist, every time.**

### The "Assume Compromise" Model

When designing a sandbox, don't ask "how do I keep the code from being malicious?" Assume it **already is**. Ask instead: "**If this code is 100% hostile and as clever as possible, what's the worst it can do from inside this box?**" If the answer is "nothing much, because it has no network, no files but one, and no way to spawn processes," your sandbox is doing its job. This pessimistic framing is how every real security engineer thinks.

### The "Strength Costs Money" Model

Isolation strength and performance cost move together. The strongest isolation (a full separate machine) is also the most expensive to spin up and run; the cheapest (running untrusted code in your own process) is the most fragile. There's no free lunch. Choosing a sandbox is choosing **how much you're willing to pay for how much safety**, based on **how much you distrust the code**.

---

## Code Examples

These examples are intentionally simple and conceptual — they show the *shape* of sandboxing ideas, not production-grade enforcement. (Real OS enforcement is in `middle.md`.)

### The Problem: Running Untrusted Code With Full Power (don't do this)

```python
# DANGEROUS: this hands untrusted code ALL of your ambient authority.
untrusted_code = get_code_from_user()   # could be anything
exec(untrusted_code)                     # runs with full access to files, network, OS
```

`exec` runs the string as Python *inside your process*, with everything your program can do. The untrusted code can `import os; os.system("rm -rf ~")`, read your secrets, or open network connections. This is the *anti-pattern*: untrusted code + full ambient authority + same process. Every concept below is about removing pieces of that danger.

### Step 1: Run It In a Separate Process

```python
import subprocess

# At least now a crash or memory corruption is confined to a child process,
# and we can kill it, time-limit it, and (later) strip its permissions.
result = subprocess.run(
    ["python3", "untrusted_script.py"],
    timeout=2,                 # resource limit: don't let it run forever
    capture_output=True,       # we read its output rather than letting it touch ours
)
```

This is weak — the child still has your file and network access — but it's the foundation. We now have a *boundary* (the process) and we've added a *resource limit* (timeout). Next steps add real restrictions.

### Step 2: Take Away the Network (conceptual)

```text
Idea: launch the untrusted process in an environment where the network
simply does not exist for it.

  - No network interface is visible to it.
  - Any attempt to open a socket fails immediately, because there is
    nothing to connect through.

On Linux this is done with a "network namespace" (covered in middle.md):
the child sees an empty network — not even localhost — so even fully
malicious code cannot phone home. The point: we removed the *ability*,
not just forbade the *intent*.
```

### Step 3: Restrict the Filesystem to One Directory (conceptual)

```text
Idea: make the untrusted code see ONLY a small directory as its whole world.

  /sandbox/
    input.txt      <- the one file it may read
    output.txt     <- the one file it may write

It cannot see /etc, /home, your SSH keys, or anything else — those paths
simply do not exist from inside the box. If it tries to open
"/home/you/.ssh/id_rsa", the open fails with "no such file".

This is "least privilege" applied to the filesystem: one input door,
one output door, no others.
```

### A Real In-Process Sandbox: JavaScript in the Browser

The most widely deployed sandbox on earth is the one running JavaScript on web pages. When you visit a site, its JavaScript runs in a heavily restricted environment:

```javascript
// JavaScript running on a web page CANNOT do these:
//   - read arbitrary files on your disk
//   - open a raw TCP socket to any server
//   - read another website's data (the "same-origin policy")
//   - launch a program on your computer
//
// It CAN only do what the browser explicitly exposes, e.g.:
fetch("/api/data");            // network, but only to allowed origins (rules apply)
localStorage.setItem("k","v"); // a tiny key-value store scoped to this site
document.querySelector("h1");  // the page's own content, nothing else
```

Every website is untrusted code, yet you run thousands of them a day without disaster — because the browser sandbox removes ambient authority by default. JavaScript starts with *almost no* power and is handed specific, narrow capabilities.

### WebAssembly: A Sandbox By Design

WebAssembly (Wasm) is a portable binary format built to run untrusted code safely. Its key property: **it has no ambient authority at all.** A Wasm module cannot, on its own, touch files, network, or the host's memory.

```text
A WebAssembly module by itself can ONLY:
  - do math and logic
  - read/write its OWN isolated block of memory ("linear memory")

It CANNOT, on its own:
  - read host files
  - open network connections
  - call host functions

The host must EXPLICITLY hand the module specific functions to call.
If the host gives it nothing, the module is a pure calculator with no
way to affect the outside world. This is "capability-based": the module
has exactly the powers it was handed, and nothing more.
```

This is why Wasm is increasingly used to run untrusted plugins, edge functions, and serverless code: the safe default ("can do nothing") is built into the design, not bolted on.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Safety** | Contains untrusted code; even malicious code is bounded. | No sandbox is perfect — escapes exist; it's a wall, not magic. |
| **Least privilege** | Forces you to think about what code actually needs. | Requires effort to figure out the minimal permission set. |
| **Separate process** | Free, simple isolation boundary; crashes don't spread. | Weak alone; child still has ambient authority unless restricted. |
| **In-process sandbox (e.g., JS engine)** | Very fast, cheap to start, millions of them possible. | Fragile: one memory-safety bug in the engine can break the wall. |
| **WebAssembly** | Safe by design, no ambient authority, portable, fast-ish. | Needs a host runtime; can't do much without granted capabilities (by design). |
| **Containers** | Easy packaging + decent isolation; ubiquitous in deployment. | "Not a security boundary" alone — shares the host kernel. |
| **VMs / microVMs** | Strongest isolation; own kernel; hardware-enforced. | Heavier: more memory, slower to start, more overhead. |
| **Defense in depth** | Multiple layers; breaking one doesn't break all. | More moving parts to design, configure, and maintain. |

---

## Use Cases

Reach for a sandbox when:

- **You run code from users or third parties.** Plugins, user-uploaded scripts, marketplace extensions, mods.
- **You run a browser-like product.** Anything that loads and executes content from the open web.
- **You build a serverless or "run my function" platform.** Many tenants' code on shared machines.
- **You process untrusted *data* with risky parsers.** Image decoders, document parsers, and media codecs are common exploit targets; sandbox the parser even though it's "your" code, because the *input* is hostile.
- **You run build/CI scripts from dependencies.** A compromised dependency's build step shouldn't own your CI machine.
- **You want blast-radius control.** Even for your own code, isolating a risky component limits damage if it's exploited.

A sandbox is usually overkill when:

- The code is fully trusted and runs only on your own controlled inputs.
- The performance cost of isolation outweighs a tiny, contained risk — though "I'll skip the sandbox for speed" is a decision to make consciously, not by accident.

---

## Coding Patterns

### Pattern 1: Deny-by-Default (allowlist, not blocklist)

```text
WRONG (blocklist):  allow everything, then forbid the dangerous syscalls/paths.
                    -> you will forget one; attacker uses the one you forgot.

RIGHT (allowlist):  forbid everything, then permit only the few things needed.
                    -> the unknown/forgotten stays forbidden, which is safe.
```

Every good sandbox is an allowlist. If you catch yourself listing things to *block*, stop and invert it.

### Pattern 2: Separate Process First, Then Restrict

```text
1. Move untrusted code into its own process.   (boundary)
2. Strip its network.                          (remove a power)
3. Confine its filesystem to one directory.    (remove a power)
4. Limit CPU/memory/time.                       (anti-DoS)
5. (Advanced) restrict its syscalls.           (shrink attack surface)
```

Build the sandbox in layers, each removing one category of power.

### Pattern 3: Pass Capabilities, Don't Grant Authority

```text
WRONG: untrusted code can open ANY file it wants (ambient authority).
RIGHT: the host opens the one allowed file and hands the OPEN HANDLE in.
       The code can use that handle, but cannot name or open any other file.
```

Instead of giving the code the *power to open files*, give it *the one file*. This is the core of capability thinking.

### Pattern 4: Set a Hard Resource Budget

```text
Always cap: wall-clock time, CPU time, memory, output size.
A sandbox that perfectly blocks files and network but lets code run an
infinite loop or allocate all RAM is still a denial-of-service waiting
to happen. "Can't do harm" includes "can't hog the machine."
```

### Pattern 5: Validate at the Boundary, Not Inside

```text
Anything crossing from inside the sandbox to outside (return values,
file contents, messages) is UNTRUSTED OUTPUT. Validate and sanitize it
on the OUTSIDE before trusting it. The boundary is a checkpoint in both
directions.
```

---

## Best Practices

- **Treat any code you didn't write as untrusted until contained.** Dependencies and plugins included.
- **Start from zero permissions and add the minimum.** Deny-by-default, always.
- **Sandbox risky *parsers* of untrusted *data*, not just untrusted *code*.** The hostile thing is often the input.
- **Always set resource limits.** Time, CPU, memory, output. Prevent denial-of-service, not just data theft.
- **Use the strongest isolation the performance budget allows for code you distrust most.** Anonymous, arbitrary code → lean toward VMs/microVMs.
- **Don't rely on a single layer.** Combine sandbox + memory-safe languages + minimal granted powers. Defense in depth.
- **Prefer purpose-built sandboxes over hand-rolled ones.** Browsers, Wasm runtimes, and established container/microVM tools have had far more scrutiny than anything you'll write in an afternoon.
- **Remember containers are packaging, not a hard security wall.** Add real isolation (seccomp, user namespaces, or a microVM) when running untrusted tenants.
- **Validate everything that crosses the boundary outward.** The sandbox's output is still untrusted.
- **Keep the sandboxed code's interface tiny.** The fewer functions you expose to the guest, the smaller the attack surface.

---

## Edge Cases & Pitfalls

- **"It's sandboxed, so it's safe."** No sandbox is perfect. Treat the sandbox as risk *reduction*, not risk elimination. Keep other layers.
- **Forgetting resource limits.** A perfectly file/network-isolated process can still freeze your machine with an infinite loop or memory bomb.
- **In-process sandboxes and memory bugs.** If untrusted code runs *inside your process* (like a scripting engine), a memory-safety bug in the engine can let the guest read or corrupt the host's memory. This is why in-process sandboxes are inherently fragile.
- **Blocklist thinking.** Trying to enumerate and block "the dangerous things" instead of allowing only the safe few. You'll always miss one.
- **Leaky boundaries.** Handing the sandbox a file handle, an environment variable, or a callback that quietly exposes more than you intended. Every door you open is part of the attack surface.
- **Trusting sandbox output.** Data coming *out* of the sandbox is still attacker-controlled. Don't paste it straight into a database query, HTML page, or shell command.
- **Assuming containers isolate like VMs.** Containers share the host kernel; a kernel bug can let a container escape. They're great for packaging, weaker as a security boundary.
- **The shared component.** If the host and guest share something — a clipboard, a temp directory, a cache, a kernel — that shared thing is a path the attacker will probe.
- **Time-of-check vs time-of-use.** Checking a permission and then acting on it leaves a gap where things can change between the check and the use. (Explored more at higher levels.)

---

## Common Mistakes

1. **Running untrusted code with `exec`/`eval` in your own process.** Maximum danger, zero isolation. Almost never acceptable.
2. **Granting broad permissions "to make it work," then never tightening them.** The temporary `allow all` becomes permanent.
3. **Blocking known-bad instead of allowing known-good.** Blocklists leak.
4. **Skipping resource limits.** Forgetting that hogging the machine is also an attack.
5. **Treating a container as a strong security boundary for hostile tenants.** It isn't, by itself.
6. **Forgetting that the *input data* is the threat.** Sandboxing the code but feeding it a malicious file that exploits the parser.
7. **Trusting whatever comes back out of the sandbox.** Output is still untrusted.
8. **Hand-rolling a sandbox.** Custom sandboxes are notoriously leaky; use battle-tested ones.
9. **One layer only.** Relying solely on the sandbox with no memory safety, no input validation, no monitoring.
10. **Confusing "we scanned it and it looked clean" with "it can't do harm."** Detection is not containment.

---

## Test Yourself

1. In your own words, what's the difference between *detecting* bad code (like an antivirus) and *containing* it (like a sandbox)? Which gives a stronger guarantee, and why?
2. What is "ambient authority," and why is removing it the heart of sandboxing?
3. You're given a function that resizes images. List the *minimum* permissions it needs. Now list five powerful things it does **not** need and that a sandbox should remove.
4. Why is "allow everything except the dangerous syscalls" (a blocklist) a worse design than "forbid everything except the needed syscalls" (an allowlist)?
5. A coworker says, "We run user scripts in a separate process, so we're safe." What's still missing? Name at least three additional restrictions.
6. Why is a sandbox that runs untrusted code *inside your own process* (in-process) considered fragile? What kind of bug breaks it?
7. Explain why WebAssembly is described as "safe by design." What can a bare Wasm module *not* do?
8. Why isn't a container, by itself, a strong security boundary against a hostile tenant? What does it share with the host that a VM does not?
9. You sandbox a script perfectly: no files, no network. It runs `while True: x = x + "a" * 1000000`. What went wrong, and which kind of limit fixes it?
10. Give an example where the *data* you feed into a sandbox is more dangerous than the code, and explain why you'd sandbox the parser anyway.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                    SANDBOXING & ISOLATION (basics)                │
├──────────────────────────────────────────────────────────────────┤
│ Goal: run untrusted code while bounding what it can do.          │
│ Key idea: LIMIT POWER, don't just detect badness.                │
├──────────────────────────────────────────────────────────────────┤
│ Default mindset:                                                 │
│   * Deny by default (allowlist, never blocklist)                 │
│   * Assume the code is already malicious                         │
│   * Least privilege: grant only what's needed                    │
├──────────────────────────────────────────────────────────────────┤
│ Three powers to restrict:                                        │
│   FILESYSTEM  -> confine to one dir, or nothing                  │
│   NETWORK     -> block all sockets, or allow specific hosts      │
│   PROCESS/SYS -> no spawning, block dangerous syscalls           │
│   (+ RESOURCES: cap CPU, memory, time, output -> anti-DoS)       │
├──────────────────────────────────────────────────────────────────┤
│ Strength vs cost spectrum (weak/cheap -> strong/costly):         │
│   in-process JS engine  ->  OS-level (seccomp/namespaces)        │
│     ->  WebAssembly  ->  containers  ->  microVMs / full VMs     │
├──────────────────────────────────────────────────────────────────┤
│ Remember:                                                        │
│   * Ambient authority is the root problem; remove it.            │
│   * Containers != strong security boundary (shared kernel).      │
│   * No sandbox is perfect -> defense in depth (many layers).     │
│   * Output of the sandbox is STILL untrusted.                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **sandbox** runs untrusted (or less-trusted) code while **bounding what it can do** — limiting power rather than detecting badness.
- The professional default: **code you didn't write is untrusted until contained.**
- The heart of sandboxing is **removing ambient authority** — the automatic, unrequested power a program normally inherits from you — and replacing it with **least privilege**: only the permissions the code actually needs.
- Design **deny-by-default** (allowlist), and **assume the code is already malicious** when reasoning about the worst case.
- You usually restrict three powers — **filesystem, network, process/system** — plus **resources** (CPU, memory, time) to prevent denial-of-service.
- The simplest real boundary is a **separate process**; strong sandboxes start there and *add* restrictions.
- There's a **spectrum** of isolation, trading strength for cost: in-process language sandboxes (fast, fragile) → OS-level → WebAssembly (safe by design) → containers (packaging, weak alone) → microVMs/VMs (strongest, heaviest).
- **Containers are not a strong security boundary by themselves** — they share the host kernel.
- No sandbox is perfect; real security is **defense in depth** — sandbox *plus* memory safety *plus* minimal granted powers *plus* validating the boundary in both directions.

---

## What You Can Build

- **A "run this script safely" runner.** Take a user-submitted script, run it in a separate process with a timeout, no network, and a one-directory filesystem. Verify it can't read a secret file you place outside that directory.
- **A least-privilege checklist tool.** For a given task (resize image, parse CSV, fetch URL), list the minimal permissions and which a sandbox should strip.
- **A WebAssembly calculator plugin host.** Load a `.wasm` module that does math, give it *no* host functions, and confirm it genuinely cannot touch files or network.
- **A "break out of the browser" curiosity demo.** Write JavaScript that *tries* to read a local file or open a raw socket and document each way the browser refuses. You'll learn the browser sandbox by hitting its walls.
- **A blocklist-vs-allowlist demonstration.** Build a tiny permission system both ways and show how the blocklist version is defeated by something you didn't think to block.
- **A resource-bomb test harness.** Feed your sandbox infinite loops and memory bombs to prove your CPU/memory/time limits actually fire.

---

## Further Reading

- *Saltzer & Schroeder, "The Protection of Information in Computer Systems"* (1975) — the origin of "least privilege" and "fail-safe defaults." Still essential.
- *The Chromium security model documentation* — how a real browser sandboxes untrusted web content. https://chromium.googlesource.com/chromium/src/+/main/docs/security/
- *WebAssembly's security model* — https://webassembly.org/docs/security/
- *The seccomp man page* — `man 2 seccomp` — a first look at restricting syscalls (deeper in `middle.md`).
- *"Capability Myths Demolished"* — Miller, Yee, Shapiro — why capabilities beat ambient authority (conceptual, motivates later levels).
- *OWASP — "Least Privilege"* cheat sheet for the practical security framing.
- *MDN — "Same-origin policy"* — the everyday browser sandbox you already rely on. https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy

---

## Diagrams & Visual Aids

### Ambient Authority vs Sandboxed (Least Privilege)

```text
WITHOUT A SANDBOX (ambient authority):

   ┌─────────────────────────────────────────────┐
   │  untrusted code  ──►  files (ALL)            │
   │                  ──►  network (ANYWHERE)     │
   │                  ──►  spawn processes        │
   │                  ──►  read your secrets      │
   └─────────────────────────────────────────────┘
        It starts the game holding ALL your power.


WITH A SANDBOX (least privilege):

   ┌──────────────── boundary ─────────────────┐
   │  untrusted code                           │
   │       │                                   │
   │       ├──► /sandbox/input.txt   (read)    │  ◄─ the only doors
   │       └──► /sandbox/output.txt  (write)   │     you opened
   │                                           │
   │   network:  ✗ none                        │
   │   spawn:    ✗ forbidden                   │
   │   secrets:  ✗ not even visible            │
   └───────────────────────────────────────────┘
```

### The Strength-vs-Cost Spectrum

```text
ISOLATION STRENGTH ─►  weak ............................ strong
COST / OVERHEAD    ─►  cheap ........................... expensive

  in-process     OS-level      WebAssembly   containers     microVM / VM
  JS engine      seccomp +     (Wasm/WASI)   (namespaces    (own kernel,
  (V8 isolate)   namespaces                   + cgroups)     hardware-
                                                             enforced)
   │                │              │              │              │
   fast, but        cheap,         safe by        packaging,     strongest,
   one engine       shares         design,        shares the     heaviest to
   bug = escape     the kernel     no ambient     host kernel    start & run
                                   authority      (not a hard
                                                  boundary)
```

### The Sandbox as a Checkpoint (Both Directions)

```text
        OUTSIDE (host, protected)                 INSIDE (guest, untrusted)
   ┌────────────────────────────┐  boundary  ┌────────────────────────────┐
   │  your files, network,      │    ║        │  untrusted code runs here  │
   │  secrets, other processes  │    ║        │                            │
   │                            │    ║        │   has ONLY what you        │
   │   ── inputs you allow ───────► ║ ───────►│   handed it (capabilities) │
   │                            │    ║        │                            │
   │   ◄── outputs (UNTRUSTED!) ──  ║ ◄───────│   produces results         │
   │       validate before use  │    ║        │                            │
   └────────────────────────────┘    ║        └────────────────────────────┘
                                  checkpoint:
                          deny by default, allow the minimum,
                          and DISTRUST whatever comes back out.
```
