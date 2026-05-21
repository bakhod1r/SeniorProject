---
layout: default
title: Native Fuzzing
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 12
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/
---

# Native Fuzzing

Native fuzzing landed in Go 1.18 alongside generics. It is exposed through
`testing.F` and the `go test -fuzz` flag. Coverage-guided mutation makes the
runtime synthesize new inputs that explore unseen code paths.

## Subsections

1. [Fuzzing — Junior](01-junior/)
2. [Fuzzing — Middle](02-middle/)
3. [Fuzzing — Senior](03-senior/)
4. [Fuzzing — Professional](04-professional/)
5. [Fuzzing — Specification](05-specification/)
6. [Fuzzing — Interview](06-interview/)
7. [Fuzzing — Tasks](07-tasks/)
8. [Fuzzing — Find the Bug](08-find-the-bug/)
9. [Fuzzing — Optimize](09-optimize/)

## References

- Go 1.18 release notes — fuzzing section, March 2022.
- testing package godoc — type `F`.
- Proposal: cmd/go: add fuzz testing (golang/go#44551).
