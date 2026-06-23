---
layout: default
title: go mod init
parent: Modules & Dependencies
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/01-modules-and-dependencies/01-go-mod-init/
---

# go mod init

[← Back](../)

We explore `go mod init`, the command that creates a `go.mod` file and turns a directory into a Go module. It is the entry point of every modern Go project and the foundation for dependency management, versioning, and reproducible builds.

## Sub-pages

- [junior.md](junior.md) — Beginners' walk-through of the command and the resulting `go.mod`
- [middle.md](middle.md) — Module path rules, `go.mod` directives, multi-module repos, GOPATH migration, `/v2+` versioning
- [senior.md](senior.md) — Module-boundary design, Semantic Import Versioning, `internal/` packages, monorepo vs polyrepo, vanity paths
- [professional.md](professional.md) — Toolchain internals, module resolution algorithm, proxy and checksum DB, programmatic `go.mod` authoring, hermetic builds
- [specification.md](specification.md) — Formal spec text from the Go Modules Reference, grammar, validation rules
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken `go.mod` scenarios
- [optimize.md](optimize.md) — Optimization exercises for workflows around `go mod init`
