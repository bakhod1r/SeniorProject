---
layout: default
title: Golden File Testing
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 11
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/
---

# Golden File Testing

Golden file testing compares the output of a function against a checked-in reference file under `testdata/`. The directory is excluded from the build; the bytes inside are the source of truth. A package-level `-update` flag regenerates the goldens when the SUT changes intentionally.

The pattern fits outputs that are large, structured, or tedious to assert field-by-field: rendered HTML, formatted JSON, generated code, CLI screens. It does not fit small outputs that a single `==` already pins, nor non-deterministic outputs whose noise cannot be normalized away.

The cost lives in the human process. A team that runs `-update` blindly and merges without reading the diff has built a test that locks in bugs. A team that treats every golden change as a deliberate, reviewed artifact has built a regression net of remarkable density.

## Pages

- [Junior](junior/) — what goldens are, the `-update` idiom, `testdata/`, first tests.
- [Middle](middle/) — table-driven goldens, normalization, diff output, libraries.
- [Senior](senior/) — versioned goldens, code-gen tests, review culture, anti-patterns.
- [Professional](professional/) — production posture, library selection, organizational discipline.
- [Specification](specification/) — formal contract.
- [Interview](interview/) — common questions.
- [Tasks](tasks/) — practice exercises.
- [Find the Bug](find-bug/) — broken snippets to diagnose.
- [Optimize](optimize/) — measured improvements.

## Libraries cited

- `github.com/sebdah/goldie/v2`
- `github.com/hexops/autogold/v2`
- `github.com/google/go-cmp/cmp`
