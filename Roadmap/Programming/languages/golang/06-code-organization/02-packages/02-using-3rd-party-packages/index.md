---
layout: default
title: Using 3rd Party Packages
parent: Packages
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/02-packages/02-using-3rd-party-packages/
---

# Using 3rd Party Packages

[← Back](../)

We explore how to add, version, audit, and maintain external dependencies in Go using `go get`, `go mod tidy`, `govulncheck`, and friends. Mastering this workflow is what separates a hobby project from a production-grade module that stays secure, reproducible, and easy to upgrade.

## Sub-pages

- [junior.md](junior.md) — Beginner walk-through of adding deps, semver basics, and pkg.go.dev
- [middle.md](middle.md) — Pseudo-versions, major-version imports, upgrades, `replace`, `govulncheck`, licenses
- [senior.md](senior.md) — Build-vs-buy decisions, auditing, supply-chain threats, adapter pattern, fork discipline
- [professional.md](professional.md) — `go get` internals, proxy protocol, private proxy operations, SBOM and license tooling
- [specification.md](specification.md) — `go get` reference, pseudo-version grammar, environment variables
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-dependency scenarios
- [optimize.md](optimize.md) — Optimization exercises for dependency workflows
