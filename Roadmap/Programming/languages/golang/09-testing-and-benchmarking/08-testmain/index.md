---
layout: default
title: TestMain Function
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/08-testmain/
---

# TestMain Function

[← Back](../)

`func TestMain(m *testing.M)` is the single hook the Go testing framework gives you to control what happens before the first test runs and after the last test finishes in a package. It is rare for a unit-test package to need one, and ubiquitous for an integration-test package — anywhere you want to set up a database, container, network namespace, tracer, or shared flag, `TestMain` is where it goes. The full surface area is tiny (one signature, one method on `*testing.M`), but the operational subtleties — `os.Exit` skipping defers, flag parsing order, one-per-package uniqueness, lifecycle around panics, integration with containers — are exactly what separates a flaky test suite from a stable one.

This subsection walks the spec line by line, gives copy-pasteable patterns for the most common setups, and catalogues the bugs people actually ship.

## Sub-pages

- [junior.md](junior.md) — Signature, lifecycle, `m.Run`, first setup/teardown, `os.Exit`
- [middle.md](middle.md) — Flag parsing, custom flags, shared resources, defer pitfalls, `t.Cleanup` interaction
- [senior.md](senior.md) — Testcontainers, panic recovery, sub-process tests, helper packages, coverage of init paths
- [professional.md](professional.md) — House style, CI wiring, flake budgets, shared `TestMain` extraction
- [specification.md](specification.md) — Godoc, signature rules, exit codes, `testing.M.Run` contract
- [interview.md](interview.md) — 25 questions across junior to staff
- [tasks.md](tasks.md) — 14 hands-on exercises building up TestMain mastery
- [find-bug.md](find-bug.md) — 15 common bugs with fixes
- [optimize.md](optimize.md) — Lazy setup, parallel containers, reuse patterns

The recommended reading order is left-to-right above. Pages stack: middle assumes junior, senior assumes middle, professional assumes senior. The reference pages (specification, interview, find-bug, tasks, optimize) can be read in any order once you have the foundations.

If you only have time for one page, read [junior.md](junior.md). If you have time for two, add [middle.md](middle.md). The rest deepen specific aspects of the same core pattern.
