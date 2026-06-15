---
layout: default
title: Module Proxy & Checksum Database
parent: Modules & Dependencies
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/01-modules-and-dependencies/05-module-proxy-and-checksum-db/
---

# Module Proxy & Checksum Database

[← Back](../)

We explore the two services that sit between your `go` command and the open internet: the **module proxy** (configured via `GOPROXY`, defaulting to `proxy.golang.org`) that serves module source over a small HTTP protocol, and the **checksum database** (`GOSUMDB`, defaulting to `sum.golang.org`) — a tamper-evident transparency log that guarantees everyone in the world who fetches a given module version receives the same bytes. Together with `go.sum` they form the integrity and availability backbone of the Go module ecosystem.

## Sub-pages

- [junior.md](junior.md) — Beginners' walk-through of the proxy, `go.sum`, and what `GOPROXY`/`GOSUMDB` mean
- [middle.md](middle.md) — The GOPROXY HTTP protocol, the module cache, `go.sum` verification, `GOPRIVATE`
- [senior.md](senior.md) — Transparency-log design, supply-chain trust boundaries, private/self-hosted proxies
- [professional.md](professional.md) — Protocol internals, Merkle-tree verification, air-gapped operation, enterprise mirrors
- [specification.md](specification.md) — Formal reference: endpoints, env vars, `go.sum` line format, sumdb protocol
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard) with real `curl` against the proxy
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-proxy and checksum-mismatch scenarios
- [optimize.md](optimize.md) — Workflow optimizations around proxies, caching, and air-gapped builds
