---
layout: default
title: Syscall Handling
parent: Scheduler Deep Dive
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/10-scheduler-deep-dive/05-syscall-handling/
---

# Syscall Handling

[← Back](../)

A syscall is the one place where a goroutine leaves user space and enters the kernel — and where Go's M:N scheduler must decide whether to wait for the kernel or move on without the calling thread. The runtime answers that question with two very different mechanisms: the **netpoller** parks goroutines against file descriptors without holding an OS thread, while **blocking syscalls** route through `entersyscall`/`exitsyscall` and let `sysmon` hand the P off to a fresh M after ~10 µs. This page is where the GMP triangle meets the kernel: every `read`, `open`, `connect`, `epoll_wait`, and cgo call goes through one of these paths, and a single misuse can leak Ms or stall a fully loaded P. Master this section and you will understand exactly why a Go server with 50 000 idle TCP connections needs only a handful of threads, while one calling `os.ReadFile` in 200 goroutines may briefly own 200 of them.

## Sub-pages

- [junior.md](junior.md) — What a syscall is, the two paths, and why your `os.ReadFile` does not stall the whole program
- [middle.md](middle.md) — `entersyscall`/`exitsyscall` flow, sysmon's 10 µs handoff, netpoller vs blocking-syscall comparison, cgo as a special syscall
- [senior.md](senior.md) — Production patterns: bounded file I/O, cgo pools, VDSO fast paths, `LockOSThread` interaction with syscalls
- [professional.md](professional.md) — Reading `runtime/proc.go` syscall code, `_Psyscall` state, `entersyscallblock`, per-platform thread creation
- [specification.md](specification.md) — Formal invariants of the syscall path; what the runtime guarantees and what it does not
- [interview.md](interview.md) — Syscall handling interview questions from intern to staff level
- [tasks.md](tasks.md) — Exercises that demonstrate handoff, M creation, and netpoller behaviour
- [find-bug.md](find-bug.md) — Real bugs where syscall handling went wrong in production
- [optimize.md](optimize.md) — Reducing handoff cost, bounding cgo, fast paths, and minimising M churn
