---
layout: default
title: Mutex Copying
parent: Concurrency Anti-Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/02-mutex-copying/
---

# Mutex Copying

Copying a value that contains a `sync.Mutex` (or `RWMutex`, `WaitGroup`, `Once`, `Cond`) is one of the most common silent bugs in Go. The two copies look identical, but each one carries its own internal state — its own `state` word and its own `sema` handle. Code that locks the original keeps reading and writing one piece of memory while code that locks the copy reads and writes another. The mutex stops protecting anything and the data race that follows is invisible until production load reveals it.

This section explains:

- Why mutexes must never be copied — the runtime state cannot be split.
- How `go vet`'s `copylocks` checker catches the most common cases.
- Five concrete ways code accidentally copies a mutex: return-by-value, pass-by-value, value receivers, capturing in closures, and ranging over slices of structs.
- The same rule for `sync.RWMutex`, `WaitGroup`, `Once`, and `Cond`.
- Correct patterns: pointer receivers, pointer fields, and passing `*T` everywhere.
- The `noCopy` marker pattern that opts a type into copylocks detection.
- Real consequences in production: corrupted locks, double-Unlock panics, deadlocks.

Read `junior.md` first if you have ever written `func (s State) Inc() { s.mu.Lock(); ... }` and wondered why it does nothing.
