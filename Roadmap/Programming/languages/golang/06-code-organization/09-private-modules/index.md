---
layout: default
title: Private Modules
parent: Code Organization
grand_parent: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/09-private-modules/
---

# Private Modules

[← Back](../)

We learn how to use Go modules that are not published on the public proxy — code in a private GitHub or GitLab repo, an internal corporate VCS, or behind a self-hosted module proxy. The toolchain knows nothing about your private hosts unless you tell it through `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, and the surrounding auth machinery; getting these settings right is the difference between a working build and an opaque "410 Gone" or "unknown revision" error.

## Sub-pages

- [junior.md](junior.md) — What a private module is, why `GOPRIVATE` exists, importing your first private repo
- [middle.md](middle.md) — `GOPRIVATE`/`GONOSUMDB`/`GONOPROXY` deep dive, `.netrc` and PAT setup, CI integration, troubleshooting
- [senior.md](senior.md) — Architecting access for a team: Athens/Artifactory proxies, sumdb strategy, mixed public/private builds
- [professional.md](professional.md) — How `cmd/go` resolves private vs public, proxy and sumdb protocols, security implications
- [specification.md](specification.md) — Reference for `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `GOPROXY` and the proxy protocol
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-private-module scenarios
- [optimize.md](optimize.md) — Optimization exercises for private-module setups
