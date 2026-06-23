# `internal/` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The Rule, Verbatim](#the-rule-verbatim)
3. [Paraphrase and Restatement](#paraphrase-and-restatement)
4. [Where the Rule Is Documented](#where-the-rule-is-documented)
5. [Relationship to the Module Path](#relationship-to-the-module-path)
6. [Relationship to the Go Language Specification](#relationship-to-the-go-language-specification)
7. [Interaction With Other Toolchain Features](#interaction-with-other-toolchain-features)
8. [What the Rule Does NOT Specify](#what-the-rule-does-not-specify)
9. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not specify the `internal/` rule. The rule is part of the `go` tooling, not the language. The authoritative sources of truth are:

1. **`go help importpath`** — terse, command-line oriented documentation built into the toolchain.
2. **`cmd/go` reference** at `go.dev/cmd/go/#hdr-Internal_Directories` — the canonical web-rendered statement of the rule.
3. **Toolchain source** — `cmd/go/internal/load` is the de-facto specification when the reference is silent on edge cases.

This file separates "what the cmd/go reference says" from convention and downstream tooling behaviour. Where the reference is silent, the toolchain source code is the de-facto specification.

---

## The Rule, Verbatim

The `cmd/go` reference, under the heading "Internal Directories," states the rule. A close paraphrase (not a verbatim quote, but written to preserve the exact meaning):

> An import of a path containing the element `internal` is disallowed if the importing code is outside the tree rooted at the parent of the `internal` directory. Specifically, code in directory `D/internal/I` (or in subdirectories of that path) can be imported only by code in the directory tree rooted at `D` itself. It cannot be imported by code in any other tree.

The rule is symmetric in spirit with the standard library's pre-1.4 conventions: implementation packages should be hidden from third-party importers. With the formal rule, hiding is enforced by the toolchain rather than by convention.

### Restatement in one sentence

> A package whose import path contains a path element named `internal` may be imported only by code rooted at the parent of that `internal` directory.

This is the form most engineers memorise. It is exactly equivalent to the verbatim wording above.

---

## Paraphrase and Restatement

A few additional restatements that emphasise different aspects of the rule:

### As a question to ask of every import

For every import edge `A imports B`:
- Does the import path of B contain `internal` as a path element?
  - If no, allow.
  - If yes, find the parent: the prefix of B up to (but not including) the `internal` element. Call this `parent`.
    - Is the import path of A equal to `parent`?
      - If yes, allow.
    - Does the import path of A start with `parent + "/"`?
      - If yes, allow.
    - Otherwise, reject.

### As a tree predicate

Visualise the package universe as a directory tree. Each `internal/` directory is a sealed gate: code below the gate can come and go; code above the gate cannot pass through.

### As a path-prefix check

The allowable importer prefixes form a single closed set: the parent and all of its descendants. The check is purely syntactic on the import path; no further information is consulted.

---

## Where the Rule Is Documented

The Go project documents `internal/` in three places:

| Location                               | Form                          | Audience                       |
|----------------------------------------|-------------------------------|--------------------------------|
| `go.dev/cmd/go/#hdr-Internal_Directories` | Web reference                 | Engineers reading the toolchain |
| `go help importpath` (or `go help packages` in some versions) | Terse CLI text         | Engineers using the toolchain  |
| `cmd/go/internal/load` (Go source)     | Implementation                | Engineers extending the toolchain |

The first two are normative. The third is the authoritative implementation; when the first two are ambiguous, the source is consulted.

The rule has been documented essentially unchanged since Go 1.5, when it was extended from the standard library to user code.

---

## Relationship to the Module Path

The rule operates on **import paths**. An import path within a module is, by construction, the module path concatenated with the package's path under the module root.

### Worked example

```
module example.com/group/lib   (declared in go.mod)
```

```
<module-root>/
├── parser.go                  ← package parser
├── api/
│   └── api.go                 ← package api
└── internal/
    └── helper/
        └── helper.go          ← package helper
```

Resulting import paths:

| File                         | Import path                                |
|------------------------------|--------------------------------------------|
| `parser.go`                  | `example.com/group/lib`                    |
| `api/api.go`                 | `example.com/group/lib/api`                |
| `internal/helper/helper.go`  | `example.com/group/lib/internal/helper`    |

The rule applies to `example.com/group/lib/internal/helper`. The parent of the `internal` element is `example.com/group/lib`. Allowed importers: `example.com/group/lib`, `example.com/group/lib/api`, and any other package under `example.com/group/lib/...`.

### Cross-module imports

When code in module `M1` imports a package whose path is in module `M2`, the rule is applied to the *import path* (which belongs to `M2`'s path namespace). It is not necessary that `M1` and `M2` be the same module — they almost never are when the importer is rejected. The rule is purely about path prefixes; it is *because* `M1`'s package is not under `M2`'s path that the rule fires.

### The rule and `module` directives

The `module` directive in `go.mod` declares the module path. Changing it changes the import path of every package in the module, which in turn shifts which `internal/` boundaries apply. Renaming a module is a non-trivial operation; the rule's behaviour after the rename should be reviewed.

---

## Relationship to the Go Language Specification

The Go language specification (`go.dev/ref/spec`) defines the language: types, statements, expressions, packages, and the visibility of identifiers (capitalisation rule). It does **not** define `internal/`. From the language specification's point of view, an internal package is just a package; its visibility within a single program is governed by capitalisation.

The `internal/` rule is enforced by **the build tooling** (`cmd/go`). The compiler proper (`compile`, `link`) does not check the rule; by the time source reaches the compiler, the toolchain has already accepted or rejected the import graph.

This separation matters in two practical ways:

1. **Alternative compilers.** Tools like `gccgo` historically did not enforce `internal/` because they were not invoked through `cmd/go`. Recent versions delegate to module-aware tooling.
2. **Custom build systems.** Bazel's `rules_go`, Buck2's Go support, and similar systems implement the rule themselves. They are not bound by the language specification — they are matching `cmd/go`'s behaviour by convention.

The rule lives in the layer above the language: it is part of the Go *toolchain contract*.

---

## Interaction With Other Toolchain Features

The rule composes with several other toolchain features without surprises.

### Capitalisation (identifier exports)

Capitalisation is a language feature; `internal/` is a toolchain feature. Both apply, in this order:

1. *May this importer reach this package at all?* Decided by the `internal/` rule.
2. *Which symbols of the package may this importer use?* Decided by capitalisation.

A symbol is reachable from outside its package if and only if both checks succeed.

### `vendor/`

Vendoring is a *resolution* mechanism: it tells the toolchain where to find the bytes for a given import path. It does not change import paths. The `internal/` rule operates on the import path before resolution; therefore vendoring cannot bypass the rule. A vendored copy of a third-party module under `vendor/example.com/upstream/internal/x` retains its original import path; it is rejected for importers outside `example.com/upstream/`.

### `replace`

The `replace` directive substitutes the source of a module. It does not rename the import path. The rule fires on the import path, before `replace` is consulted. `replace` cannot bypass the rule.

### Workspaces (`go.work`)

A workspace is a build context for multiple modules. Each module retains its own `internal/` boundaries. Two modules in the same workspace cannot reach into each other's `internal/`. Workspaces do not relax the rule.

### Sub-modules

A nested `go.mod` introduces a separate module. The rule treats sub-modules as foreign: code in the inner module is not "rooted at the parent" of any `internal/` in the outer module, even though they share a directory tree.

### Build tags

The rule does not interact with build tags. A package excluded by build tags is not loaded; therefore no rule check fires against it. A package included by build tags is loaded normally and the rule applies.

---

## What the Rule Does NOT Specify

The cmd/go reference is silent on several adjacent questions. The toolchain source provides the authoritative answers.

### It does not specify identifier visibility

The rule decides who may *import* the package. It says nothing about which *symbols* of the package are visible — that is the language's capitalisation rule.

### It does not specify what counts as a path element

The reference says "element," meaning a `/`-separated component. The toolchain source treats `internal` as a path element if and only if it appears between two `/` characters (or at the start/end of the path with one `/` neighbour). Substring matches do not count.

### It does not specify case

`internal` is matched case-sensitively. `Internal/`, `INTERNAL/`, and `internAl/` are *not* magical. The toolchain source uses byte-for-byte equality.

### It does not specify behaviour for malformed import paths

If an import path is malformed (contains forbidden characters, has empty segments, etc.), the rule is moot — the toolchain rejects the path before checking visibility.

### It does not specify behaviour at runtime

The rule is a build-time check. At runtime, internal packages are indistinguishable from public ones. Their symbols appear in stack traces, profiles, and reflection output exactly like any other package.

### It does not specify how IDEs should display the rule

Editors and language servers may surface the rule differently — as red squigglies, as quick-fix suggestions, as doc-comment warnings. None of these are normative; they reflect each tool's UX choices. The build is the only authority.

---

## References

- [`cmd/go` documentation — Internal Directories](https://go.dev/cmd/go/#hdr-Internal_Directories) — authoritative statement of the rule.
- [Go Modules Reference](https://go.dev/ref/mod) — concepts of module path and import path.
- [Go Language Specification](https://go.dev/ref/spec) — the language spec, which does *not* mention `internal/`.
- [`go help importpath`](https://pkg.go.dev/cmd/go#hdr-Import_path_syntax) — terse command-line documentation.
- [`go help packages`](https://pkg.go.dev/cmd/go#hdr-Package_lists_and_patterns) — package-pattern documentation.
- [Go 1.4 release notes](https://go.dev/doc/go1.4) — original (experimental) introduction.
- [Go 1.5 release notes](https://go.dev/doc/go1.5) — extension to user code.

The rule is small enough to fit in a paragraph, stable enough that the references above have not changed in years, and uniformly enforced by every Go-aware toolchain. For day-to-day work the one-sentence restatement is enough; for tooling work, the implementation in `cmd/go/internal/load` is the canonical reference.
