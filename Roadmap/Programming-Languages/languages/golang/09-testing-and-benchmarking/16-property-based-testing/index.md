---
layout: default
title: Property-Based Testing
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 16
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/
---

# Property-Based Testing

Property-based testing (PBT) describes **invariants** that hold for any
valid input. The library generates many random inputs and tries to break
the property; on failure it **shrinks** the input to the smallest example
that still fails.

Go has three relevant tools:

- `testing/quick` — small, in stdlib, no shrinking.
- `pgregory.net/rapid` — modern, shrinks, stateful PBT support.
- `leanovate/gopter` — earlier library, generators + arbitrary types.

PBT is complementary to native `go test -fuzz`: fuzz mutates raw bytes,
PBT generates **structured typed values** to verify logical properties.

PBT shines for parsers, codecs, data structures, and algorithms. It is
overkill for business rules dominated by discrete cases.

## Subsections

- [junior](junior/) — concept, first property with rapid, sort and reverse.
- [middle](middle/) — generators, custom types, round-trip JSON, monotonicity.
- [senior](senior/) — stateful PBT, shrinking strategies, gopter, integrating with fuzz.
- [professional](professional/) — CI strategy, seeds, flakes, oracle selection.
- [specification](specification/) — formal definitions of rapid and testing/quick APIs.
- [interview](interview/) — Q&A for PBT.
- [tasks](tasks/) — practice problems with hints.
- [find-bug](find-bug/) — spot-the-defect drills.
- [optimize](optimize/) — make PBT fast in CI.
