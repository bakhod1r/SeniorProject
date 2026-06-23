---
layout: default
title: Context Tree
parent: Context Package
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/04-context-package/04-context-tree/
---

# Context Tree

[← Back](../)

Every `Context` in a running Go program is a node in a tree. The root is `Background()` (or `TODO()`); every `WithCancel`, `WithTimeout`, `WithDeadline`, `WithValue`, `WithCancelCause`, and `WithoutCancel` call hangs a new child off an existing node. This section dissects how the tree is built, how cancellation cascades downward (and never upward), why nested deadlines obey "first deadline wins," and how Go 1.20+/1.21+ additions — `Cause`, `WithCancelCause`, `WithDeadlineCause`, `AfterFunc`, `WithoutCancel` — reshape the tree's behaviour.

## Sub-pages

- [junior.md](junior.md) — The tree shape, parent-child cancellation, first observations
- [middle.md](middle.md) — Propagation in depth, deadline arithmetic, AfterFunc and WithoutCancel
- [senior.md](senior.md) — `cancelCtx` internals, `propagateCancel`, the watcher goroutine
- [professional.md](professional.md) — Tree-shape tuning, allocation cost, observability
- [specification.md](specification.md) — Formal rules of the cancellation tree
- [interview.md](interview.md) — Tree-cascade interview questions
- [tasks.md](tasks.md) — Hands-on exercises building and inspecting context trees
- [find-bug.md](find-bug.md) — Cascade bugs, leaked cancels, wrong parents
- [optimize.md](optimize.md) — Shrinking trees, AfterFunc savings, allocation tactics
