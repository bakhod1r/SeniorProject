---
layout: default
title: Publishing Modules
parent: Packages
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/02-packages/03-publishing-modules/
---

# Publishing Modules

[← Back](../)

We explore how to release a Go module so others can `go get` it: tagging the repository with semver tags, surfacing documentation on pkg.go.dev and godoc, respecting the `/v2+` major-version import path rule, retracting bad releases, and serving custom vanity import paths.

## Sub-pages

- [junior.md](junior.md) — Beginner walk-through of publishing, semver tags, and pkg.go.dev
- [middle.md](middle.md) — Pre-publish checklist, pseudo-versions, godoc, multi-module tagging, and retraction
- [senior.md](senior.md) — API design, backwards compatibility, deprecation policy, and security releases
- [professional.md](professional.md) — Proxy and sumdb internals, GoReleaser, signing, multi-module monorepo release engineering
- [specification.md](specification.md) — Formal grammar for semver, pseudo-versions, `retract` directive, and vanity meta tags
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises for cutting and publishing releases
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-release scenarios
- [optimize.md](optimize.md) — Release-engineering optimizations for faster, safer publishing
