---
layout: default
title: Project Layout
parent: Code Organization
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/03-project-layout/
---

# Project Layout

[← Back](../)

How a Go project is laid out on disk — `cmd/`, `pkg/`, `internal/`, `api/`, `configs/`, `scripts/` — shapes how it builds, who can import what, and how new contributors find their way around. This chapter walks from a single-file `main.go` to a multi-binary monorepo, contrasts the popular `golang-standards/project-layout` template with its critics, and spells out how the toolchain itself constrains the directory tree.

## Sub-pages

- [junior.md](junior.md) — From `main.go` to `cmd/<bin>/main.go + internal/`: the smallest layouts that scale
- [middle.md](middle.md) — When to introduce `internal/`, the `pkg/` debate, multi-binary repos, monorepo vs polyrepo
- [senior.md](senior.md) — Layout for large teams: boundary enforcement, import graphs, refactor patterns
- [professional.md](professional.md) — How `go build` discovers packages, module path mapping, vendoring and build-tag effects
- [specification.md](specification.md) — `go.dev/ref/mod` and `cmd/go` rules that govern `internal/`, `vendor/`, and module paths
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard) for restructuring projects
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken layouts and bad import structures
- [optimize.md](optimize.md) — Optimization exercises for slow builds, tangled graphs, and oversized packages
