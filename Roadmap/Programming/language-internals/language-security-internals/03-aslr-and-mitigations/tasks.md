# ASLR & Mitigations — Hands-On Tasks

> **Topic:** [ASLR & Mitigations](README.md)

---

## Introduction

These exercises are **observational and defensive**. You will watch addresses move
between runs, compare hardened and unhardened binaries, and build an auditing
tool — never a working exploit. The recurring lesson: ASLR is one layer, it is
strong only in aggregate, and a single information leak collapses it.

Run everything on machines and binaries you own. Tick a self-check box when you
can *explain* what you observed, not merely when a command printed something.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Watch the addresses move

Write a tiny program that prints the address of a stack variable, a heap
allocation, a libc function, and a function in itself:

```c
#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int x; void *h = malloc(1);
    printf("stack=%p heap=%p libc=%p main=%p\n",
           (void*)&x, h, (void*)&printf, (void*)&main);
    return 0;
}
```

Run it ~10 times.

**Self-check:**
- [ ] The stack, heap, and libc addresses change every run.
- [ ] With a non-PIE build, `main` stays fixed; with PIE it moves too.

### Task 2 — Toggle system ASLR

Read `/proc/sys/kernel/randomize_va_space`, then (with privilege, on a machine you
own) set it to `0` and rerun Task 1.

**Self-check:**
- [ ] At `0`, addresses are stable across runs; at `2`, they are not.
- [ ] I can explain what level `1` randomizes vs level `2`.

---

## Core

### Task 3 — PIE vs non-PIE

Build the same program twice: `-no-pie` and `-fPIE -pie`. Compare the address of
`main` across runs for each.

**Self-check:**
- [ ] Non-PIE `main` is constant; PIE `main` is randomized.
- [ ] I can explain why a non-PIE executable is a reliable anchor for an attacker even when libraries are randomized.

### Task 4 — Read your binary's mitigations

Install/run `checksec` (or inspect with `readelf -lW` / `readelf -d`) on several
system binaries and your own builds. Record PIE, NX, RELRO (partial/full), stack
canary, and Fortify status.

**Self-check:**
- [ ] I can locate NX from the `GNU_STACK` program header, RELRO from `GNU_RELRO` + `BIND_NOW`, and PIE from the ELF type (`DYN` vs `EXEC`).
- [ ] I can name a binary on my system that's missing one mitigation.

### Task 5 — Add hardening and diff

Take an unhardened build and rebuild with
`-fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now`.
Diff the `checksec` output.

**Self-check:**
- [ ] Every mitigation flipped from "No/Partial" to "Yes/Full."
- [ ] I can state what each flag added and which attack step it blocks.

---

## Advanced

### Task 6 — One leak defeats ASLR (conceptually)

Write a *benign* program that prints one libc pointer, then by hand compute the
base of libc (pointer minus the symbol's known offset, from `readelf -s` of the
libc). Verify your computed base matches the mapping in `/proc/self/maps`.

**Self-check:**
- [ ] My computed libc base equals the real base from `maps`.
- [ ] I can articulate the exploitation lesson: a single leaked pointer de-randomizes an entire region by fixed offsets — which is why "leak-then-ROP" beats ASLR.

### Task 7 — Fork does not re-randomize

Write a program that prints an address, then `fork()`s and has the child print the
same address. Compare. Then `exec` a fresh copy and compare again.

**Self-check:**
- [ ] Parent and forked child share the layout; the re-`exec`'d process does not.
- [ ] I can explain why forking servers are more brute-forceable than re-exec'ing ones.

### Task 8 — Entropy back-of-envelope

Estimate the number of random bits in your platform's mmap base (compare low/high
bits of libc base across many runs). Compute how many blind tries a brute force
would need on 32-bit vs 64-bit.

**Self-check:**
- [ ] I can state an approximate entropy figure and why 32-bit is brute-forceable while 64-bit generally isn't.

---

## Capstone

### Task 9 — Mitigation auditor

Write a script that takes a directory, finds every ELF binary, and reports a table
of PIE / NX / RELRO / canary / Fortify status, flagging any binary that fails a
policy you define (e.g. "all network-facing binaries must be PIE + full RELRO +
NX + canary"). Output a pass/fail summary suitable for a CI gate.

**Self-check:**
- [ ] My tool correctly classifies a deliberately-unhardened test binary as failing.
- [ ] My policy explains *why* each required mitigation matters (anchor removal, ROP cost, GOT protection, overflow detection).
- [ ] I documented that passing the audit does not make a buggy program safe — it only raises exploitation cost.

---

## Self-Assessment

You own this topic when you can:

- [ ] Explain what ASLR randomizes, where the entropy comes from, and why 32-bit is weak.
- [ ] Read a binary's PIE/NX/RELRO/canary status and harden a build to full coverage.
- [ ] Explain, with a worked offset calculation, how one info-leak collapses ASLR.
- [ ] Describe how ASLR composes with DEP, RELRO, canaries, CET/PAC, and KPTI into defense-in-depth — and where each layer fails alone.
