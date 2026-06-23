---
layout: default
title: Error Design — Best Practices
parent: Error Handling
grand_parent: Go
nav_order: 12
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/12-error-design-best-practices/
---

# Error Design — Best Practices

[← Back](../)

We collect the accepted wisdom of Go error design into one place: when to use sentinels, when to use typed errors, when to leave them opaque; how to wrap without spamming context; how to write messages that read well in logs; and how to draw the line between the *programmer error* (panic) and the *operational error* (return). Errors are values — design them with the same care you give the rest of your API.

## Sub-pages

- [junior.md](junior.md) — Message style, the three error shapes, basic wrapping rules
- [middle.md](middle.md) — API stability, error families, structured fields, testing strategy
- [senior.md](senior.md) — Library vs application errors, internationalization, telemetry
- [professional.md](professional.md) — Cost models, evolution patterns, cross-process error contracts
- [specification.md](specification.md) — `error` interface, `Is`/`As`/`Unwrap` contracts, formatter rules
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken error designs
- [optimize.md](optimize.md) — Optimization exercises for error allocation and shape
