# Capability-Based Security — Hands-On Tasks

> **Topic:** [Capability-Based Security](README.md)

---

## Introduction

These exercises make the abstract concrete: reproduce the confused-deputy problem
and fix it with a capability, refactor an ambient-`fs` module into an
injected-capability one, build revocable and attenuating wrappers, design a
macaroon with caveats, and finally redesign a small app around POLA. The thread
throughout: authority should be something you *hold and were handed*, never
something you have *by default*.

Tick a self-check box when you can explain *why* the capability version is safer,
not merely that it runs.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Reproduce the confused deputy

Write a "report generator" deputy that has write access to a protected file and
takes a caller-supplied *output path*. Show that a low-privilege caller can pass
the protected path and trick the deputy into overwriting it.

**Self-check:**
- [ ] I can demonstrate the deputy misusing its authority on the caller's behalf.
- [ ] I can name the two ingredients: the deputy's ambient authority + the caller's free designation.

### Task 2 — Fix it with a capability

Change the deputy to accept an *output capability* (an already-opened writable
handle / a directory capability), not a path string. Show the attack now fails.

**Self-check:**
- [ ] The caller can only supply a destination it already holds authority over.
- [ ] I can explain why "no designation without authority" closes the hole.

---

## Core

### Task 3 — De-ambient a module

Take a module that does `import fs` and writes to a fixed directory. Refactor it so
the directory capability is injected by the caller; the composition root is the
only place holding broad `fs`.

**Self-check:**
- [ ] The module's full authority is visible in its constructor parameters.
- [ ] Nothing in the module reaches ambient `fs`/`net`/`env`.

### Task 4 — Attenuating wrapper

Given a read-write resource (e.g. a key-value store), write a wrapper that exposes
only `get` (read-only) and pass *that* to a less-trusted component.

**Self-check:**
- [ ] The recipient cannot write — the capability to do so is not expressible through the wrapper.
- [ ] I can explain attenuation as "derive a strictly weaker capability before delegating."

### Task 5 — Revocable capability (caretaker)

Implement a caretaker: instead of the real resource, hand out a forwarder that
relays calls and checks a `revoked` flag. Show that flipping the flag instantly
disables the holder's access.

**Self-check:**
- [ ] Before revoke, the holder works; after, every call fails.
- [ ] I understand why plain capabilities need this pattern to be revocable at all.

---

## Advanced

### Task 6 — Membrane (transitive revocation)

Extend the caretaker idea: wrap an object so that any object it *returns* is also
wrapped by the same membrane, and revoking the membrane severs the whole graph at
once.

**Self-check:**
- [ ] Revoking the membrane disables not just the root object but everything reachable through it.
- [ ] I can explain why this is the safe way to lend a whole subsystem to less-trusted code.

### Task 7 — Design a macaroon

Construct (conceptually or with a macaroon library) a token for "GET /reports/*
until tomorrow": a base token plus caveats `method=GET`, `path prefix=/reports/`,
`expires=<T>`, chained with HMAC. Then *attenuate* it further (add `path
prefix=/reports/2026/`) without contacting the issuer.

**Self-check:**
- [ ] Each caveat only narrows authority; no holder can broaden it.
- [ ] I can explain a third-party caveat and when you'd use one.

### Task 8 — Confine a dependency

Using WASI (run an untrusted module with only a preopened dir) or SES
(`lockdown()` + `Compartment` with a minimal endowment), run a dependency and show
it cannot reach the filesystem/network you didn't grant.

**Self-check:**
- [ ] The dependency is bounded to exactly its granted capabilities.
- [ ] I can connect this to supply-chain defense: an untrusted package's blast radius is what it was handed.

---

## Capstone

### Task 9 — Redesign an app around POLA

Take a small app (e.g. a CLI that reads config, writes output, and calls one API).
Redesign its authority model:

1. Identify every ambient authority it currently uses (fs, net, env, clock).
2. Replace each with an injected capability, attenuated to the minimum.
3. Make any temporary authority revocable.
4. Draw the **capability-flow diagram**: every authority every component holds,
   traced back to an explicit grant at the composition root.

**Self-check:**
- [ ] No component holds authority it wasn't explicitly handed.
- [ ] A reviewer can read each component's authority from its signature.
- [ ] I can explain how a compromised component (or dependency) is bounded by its granted capabilities.

---

## Self-Assessment

You own this topic when you can:

- [ ] Define a capability and contrast it with ambient authority / ACLs.
- [ ] Reproduce the confused deputy and fix it with a capability.
- [ ] Refactor ambient `import fs` into injected, attenuated capabilities.
- [ ] Implement attenuation, a revocable caretaker, and a membrane.
- [ ] Use WASI/SES and macaroons to confine code and carry attenuable authority, and explain why this bounds supply-chain risk.
