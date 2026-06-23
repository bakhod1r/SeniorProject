---
layout: default
title: Common Interfaces
parent: Methods & Interfaces
grand_parent: Go
nav_order: 12
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/12-common-interfaces/
---

# Common Interfaces

[← Back](../)

The Go standard library is built around a small set of interfaces that show up everywhere: `error`, `fmt.Stringer`, `io.Reader`, `io.Writer`, `sort.Interface`, `json.Marshaler`, `http.Handler`, `context.Context`, `fs.FS`, and the new `iter.Seq`/`iter.Seq2` from Go 1.23+. Mastering these interfaces is the single biggest leverage point for writing idiomatic Go: once your types satisfy them, they slot into the standard library for free — `io.Copy`, `sort.Sort`, `fmt.Println`, `json.Marshal`, `http.ListenAndServe`, `for v := range seq` all start working.

This section is a tour. Every page focuses on **how to implement** these interfaces correctly, what their contracts say, where the std-lib uses them as fast-path detectors (e.g. `io.Copy` checks for `WriterTo` and `ReaderFrom`), and what bugs are easy to introduce.

## Sub-pages

- [junior.md](junior.md) — `error`, `Stringer`, `Reader`, `Writer`, `sort.Interface`
- [middle.md](middle.md) — Composition, `io.Pipe`, `json.Marshaler`, `context.Context`
- [senior.md](senior.md) — Internals: `io.Copy` fast paths, itab caching, contract enforcement
- [professional.md](professional.md) — API design through interface boundaries, layered systems
- [specification.md](specification.md) — Std-lib contracts cited from godoc
- [interview.md](interview.md) — Q&A on implementing and combining these interfaces
- [tasks.md](tasks.md) — Exercises (easy → expert)
- [find-bug.md](find-bug.md) — Bug-hunting on broken implementations
- [optimize.md](optimize.md) — Fast paths, allocation-free Stringer, sync.Pool patterns
