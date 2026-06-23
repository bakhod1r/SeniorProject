---
layout: default
title: Closing Channels
parent: Channels
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/02-channels/06-closing-channels/
---

# Closing Channels

[← Back](../)

`close(ch)` is a one-line built-in with a long list of consequences. Closing a channel signals "no more values will be sent." Receivers can still drain buffered values and then observe the closed state through a second return value or by the termination of a `for range` loop. But the rules are unforgiving: a send to a closed channel panics, closing a closed channel panics, closing a `nil` channel panics. The convention "only the sender closes" exists precisely because the language gives the closer all the responsibility. With multiple senders the problem becomes harder and demands explicit patterns: a synchronising closer goroutine, `sync.Once`, or a separate done channel.

## Sub-pages

- [junior.md](junior.md) — `close()` semantics, comma-ok receive, `for range`, sender-closes convention, basic patterns
- [middle.md](middle.md) — Multi-sender close safety, `sync.Once`, done-channel pattern, generator and broadcast idioms
- [senior.md](senior.md) — Memory model and happens-before with close, architectural patterns, leak diagnosis, fan-in fan-out shutdown
- [professional.md](professional.md) — `closechan` runtime function, sudog drain, atomic state transitions, panic paths
- [specification.md](specification.md) — Formal Go spec excerpts: `close` built-in, receive on closed, range termination, references
- [interview.md](interview.md) — Interview questions from junior to staff, with model answers and follow-ups
- [tasks.md](tasks.md) — Hands-on exercises: closing generators, broadcast, multi-sender shutdown, range patterns
- [find-bug.md](find-bug.md) — Bug hunts: send-on-closed panics, double-close, nil-close, missing close, premature close
- [optimize.md](optimize.md) — When close is and is not a hot path, signal channels, broadcast efficiency, alternatives
