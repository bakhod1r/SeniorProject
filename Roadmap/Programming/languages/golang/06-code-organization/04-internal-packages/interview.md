# Internal Packages — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is an `internal/` package in Go?

**Model answer.** An `internal/` package is one whose import path contains a path element named `internal`. The Go toolchain enforces a special rule: such a package can be imported only by code rooted at the parent of the `internal` directory. Code outside that subtree — including code in other modules — gets a compile error if it tries to import.

The mechanism is purely structural: there is no `internal` keyword, no annotation, no flag. You put a package in a directory called `internal`, and the toolchain refuses unauthorised imports.

**Common wrong answers.**
- "It's a private keyword like Java's `private`." (No — there is no keyword. It is a directory name.)
- "It hides the source code." (No — the source is plain text. Only *importing* is restricted.)
- "It's a runtime check." (No — it is a build-time check by the `go` toolchain.)

**Follow-up.** *What error do you see when you violate the rule?* — `use of internal package <path> not allowed`.

---

### Q2. Where does the rule say the boundary sits?

**Model answer.** "The parent of the `internal` directory." Walk up one level from the `internal` element in the import path; everything in *that* directory's subtree may import; everything else may not.

For `example.com/lib/internal/x`, the parent is `example.com/lib`. Anything under `example.com/lib/...` may import; anything else (including other modules) may not.

**Follow-up.** *What about `example.com/lib/foo/internal/x`?* — Parent is `example.com/lib/foo`. Only code under `example.com/lib/foo/...` may import. Even sibling code in `example.com/lib/bar/...` is rejected.

---

### Q3. Can you write tests for an `internal/` package?

**Model answer.** Yes. The `_test.go` files live in the same directory as the code they test, so they are inside the parent of `internal/` and the rule allows them to import.

White-box tests (`package x`) and black-box tests (`package x_test`) both work; the latter even imports the package by its full internal path.

**Common wrong answers.**
- "No, they're hidden from tests too." (Tests are normal Go code; the rule applies but is satisfied because tests live next to the source.)

**Follow-up.** *What if I want to test `internal/x` from a top-level `tests/` directory?* — Allowed, because `tests/` is also under the module root, which is the parent of `internal/`.

---

### Q4. Does Go have a `private` keyword?

**Model answer.** No. Go has two visibility mechanisms:
- **Capitalisation** — identifiers starting with a capital letter are exported from their package.
- **`internal/` directories** — packages under such a directory are importable only by code in the parent's subtree.

Together they cover symbol-level and package-level visibility. There is no fine-grained per-symbol "private" or "protected."

**Follow-up.** *How does this compare to Rust's `pub(crate)`?* — Go's `internal/` is roughly equivalent: visible inside the module, hidden from outside.

---

### Q5. Can you put an `internal/` directory anywhere?

**Model answer.** Yes. The rule applies wherever an `internal/` directory appears. The boundary moves with the directory:
- `internal/x` at the module root → visible to the whole module.
- `feature/internal/x` → visible only inside `feature/`.
- `feature/sub/internal/x` → visible only inside `feature/sub/`.

Use deeper `internal/` to scope visibility tighter; use root-level `internal/` for module-wide privacy.

**Follow-up.** *Is more nesting always better?* — No. Each level adds a path component and constrains who can import. Most projects need only one `internal/` at the module root.

---

## Middle

### Q6. When would you use multi-level `internal/`?

**Model answer.** When a feature has helpers that nothing else in the module should touch. For example:

```
project/
├── handler/
│   ├── handler.go
│   └── internal/
│       └── parse/
└── service/
    └── service.go    ← cannot import handler/internal/parse
```

`parse` is private to `handler` only, not to the whole module. Useful when two features should not share helpers, or when one feature's API is significantly more in flux than the rest of the module.

**Common wrong answers.**
- "Always use multi-level for safety." (No — adds friction without earning its keep in most projects.)
- "Multi-level is required for libraries." (No — most libraries use one root-level `internal/`.)

**Follow-up.** *What is the cost of adding a deeper `internal/`?* — Long import paths, new contributors get confused, sometimes legitimate cross-feature imports get blocked.

---

### Q7. How do you refactor a public package into `internal/`?

**Model answer.** Mechanically:

```bash
git mv pkg internal/pkg
goimports -w .            # update import paths
go mod tidy
go build ./...
```

But this is a breaking change for any external consumer who imports `<module>/pkg`. They will get `use of internal package not allowed` after the change. This requires a major version bump (per SemVer): `v1.x.y` → `v2.0.0`. Document the change clearly in release notes.

**Follow-up.** *Is there a softer alternative?* — Yes. Add a `// Deprecated:` comment for one release cycle, see who complains, then hide. Or keep the public package as a thin re-export of the now-internal implementation.

---

### Q8. Does `replace` let you bypass `internal/`?

**Model answer.** No. `replace` substitutes the *bytes* used to satisfy an import; it does not change the *import path*. The `internal/` rule fires on the import path before `replace` is consulted. The toolchain still rejects the import.

**Follow-up.** *What about vendoring?* — Same story. `vendor/` is a resolution mechanism, not a path namespace. The rule fires on the import path; vendored bytes don't change it.

---

### Q9. Two of my modules in the same monorepo can't share `internal/`. Why?

**Model answer.** The `internal/` rule is module-scoped, not repository-scoped. A nested `go.mod` introduces a separate module; from the toolchain's view the two modules are as foreign as if they lived in different repositories. To share code:
1. Duplicate it (cheap if tiny).
2. Promote it to the public surface of one module.
3. Extract it into a third, intentional shared module.

Each is a real trade-off. There is no way to "share an internal package across modules" within Go's rules.

**Follow-up.** *What about `go.work`?* — A workspace is a build-time convenience. It does not merge modules; each retains its own `internal/`.

---

### Q10. How does Go's `internal/` compare to `package`-private in Java?

**Model answer.** Both are build-unit-level: visible inside, hidden outside. Differences:
- **Granularity.** Java is per-symbol (any class member can be marked package-private). Go is per-package (every export of an internal package is visible to insiders, hidden from outsiders).
- **Mechanism.** Java uses keywords. Go uses directory layout.
- **Default.** Java defaults to package-private if no modifier is given. Go defaults to public — capital-letter identifiers are exported unless they are inside an `internal/` package.

The closest analogue across languages is Rust's `pub(crate)`.

**Follow-up.** *Why does Go use a directory instead of a keyword?* — Cheap to apply (no source change), highly visible in code review (the directory shows in the tree), and integrates with the existing import path system without a language change.

---

### Q11. Can a function inside an `internal/` package import a public package?

**Model answer.** Yes. The rule restricts who may import the *internal* package; it does not restrict what the *internal* package may import. An internal package is free to import any other package — public or internal — subject to the rule applied to those packages.

**Follow-up.** *Can it create an import cycle?* — Only as much as Go allows in general. Go forbids import cycles at the language level, regardless of `internal/`.

---

### Q12. What's the canonical layout for an application with `internal/`?

**Model answer.**

```
project/
├── go.mod
├── cmd/
│   └── server/main.go      ← thin entry point
├── api/                    ← public DTOs
└── internal/
    ├── handler/
    ├── service/
    ├── repo/
    └── config/
```

`cmd/server` wires everything from `internal/`. `api/` is the only public surface. Most application logic lives in `internal/`. This is "almost everything is internal" — typical for an application module.

For a library, the shape is reversed: most packages are public, with `internal/` reserved for genuinely private helpers.

**Follow-up.** *Where does `pkg/` fit?* — `pkg/` is a convention some teams use for explicitly public packages. It is not magical to the toolchain. Some projects use it; the Go standard library does not.

---

## Senior

### Q13. A teammate proposes putting *every* package under `internal/`. Walk through your reasoning.

**Model answer.** "Everything is internal" with one public façade is a smell. Usually it indicates one of:

1. **A God-object façade.** The "one public function" is doing the work of a whole API. Hidden complexity is still complexity.
2. **No clear product story.** The team has not decided what is contract and what is implementation. `internal/` is a workaround for an undefined API.
3. **Over-application of "closed by default."** The principle is healthy, but taken to extremes it produces a library that is hard to extend.

The right answer depends on the situation. For an *application* (binary), almost everything internal is correct. For a *library* (consumers `import` it), at least a meaningful set of packages must be public — that is the whole point of the library.

**Follow-up.** *What's the smallest viable public surface?* — Whatever the documented user story requires, and no more. Aim for ten or fewer public functions in a small library.

---

### Q14. How do you audit a module's public surface before a release?

**Model answer.**

```bash
go list ./... | grep -v '/internal/'
```

That list is your contract. For each package, ask:
1. Is this package documented?
2. Are its exported names stable?
3. Do I want to be supporting it in two years?
4. Should it be hidden under `internal/` instead?
5. Should it be split into its own module?

For each "no" or "doubt," act before the release. After the release, you have made the promise.

For larger libraries, codify this into a release checklist and have a senior engineer sign off.

**Follow-up.** *How do you remove a package from the public API after it's been released?* — Major version bump. Mark it `// Deprecated:` in the next minor; remove or hide in the next major; document migration paths.

---

### Q15. A monorepo has two modules. Module A wants to use a helper from Module B's `internal/`. What's the right call?

**Model answer.** The toolchain refuses, correctly. Options:

1. **Promote the helper to Module B's public surface.** Now it is part of Module B's contract; Module B owes stability to A. Often unwanted.
2. **Extract the helper into a new third module C.** C is a deliberately public module; both A and B import it. Adds release-management overhead but makes the dependency intentional.
3. **Duplicate the helper in A.** Acceptable if the helper is tiny and the duplication is unlikely to drift.
4. **Re-think the module split.** If A and B share enough internal code that this keeps coming up, maybe they should be one module.

There is no right answer in the abstract. The senior engineer surfaces the trade-offs and lets the team decide.

**Follow-up.** *Why can't `go.work` solve this?* — Workspaces are build-time conveniences; they do not merge modules.

---

### Q16. How does the `internal/` rule interact with `replace`, `vendor/`, and `go.work`?

**Model answer.** It does not. Each of those features changes a different aspect of the build:

- **`replace`** changes the *bytes* used to satisfy an import; the import path is unchanged.
- **`vendor/`** changes the *resolution path* for downloads; the import path is unchanged.
- **`go.work`** changes which *modules* are visible during a build; each module retains its own `internal/`.

The `internal/` rule fires on the import path, *before* any of these features is consulted. None of them can be used to bypass the rule.

This independence is by design. The rule is a structural property of import paths, not a property of resolution or content.

**Follow-up.** *So how can I share an `internal/` package across modules?* — You can't. Either don't have separate modules, or promote the package to public, or extract a third shared module.

---

### Q17. When is multi-level `internal/` worth the cost?

**Model answer.** When you have observed *real, repeated* leaks of helpers between features. Symptoms:

- Two features keep importing each other's helpers in PRs.
- A helper that should be private to a feature keeps being depended on by other features.
- A feature has its own complex API that you want to evolve without affecting siblings.

The cost: longer import paths, occasional confusion for new contributors, sometimes blocking legitimate sharing. The benefit: an architectural boundary the toolchain enforces.

If you have not seen the leak, do not pre-emptively erect the boundary. Multi-level `internal/` should be a *response* to a problem, not a preventive measure.

**Follow-up.** *What's a cheaper alternative?* — Code review, lint rules (`depguard`), and a clear architectural document. `internal/` is one tool, not the only tool.

---

### Q18. Walk me through an interview problem: "Design the package layout for a new microservice."

**Model answer.** I would propose:

```
service/
├── go.mod
├── cmd/server/main.go        ← thin: parse flags, wire deps, run server
├── api/                      ← public DTOs (often generated from a schema)
└── internal/
    ├── handler/              ← HTTP handlers
    ├── service/              ← business logic
    ├── repo/                 ← persistence
    ├── config/               ← config loading
    └── observe/              ← logging, metrics, tracing setup
```

Reasoning:
- `cmd/server/main.go` is intentionally thin — wiring only. Logic in `main` is hard to test.
- `api/` is the public surface. If consumers (other services, SDKs) need to know the request/response shapes, this is the only place they look.
- Everything else is `internal/`. The microservice is a binary, not a library; nothing here should be importable from outside the module.
- `handler` calls `service`, `service` calls `repo`. This direction is enforced by code review, not by the toolchain.

I would *not* multi-level `internal/` unless I had observed leaks between `handler` and, say, `repo`. For a typical microservice, root-level `internal/` is enough.

**Follow-up.** *What if the team also wants to ship a Go SDK for clients?* — Either (a) extract the SDK into a separate module, or (b) promote the relevant types into the public `api/` package. Option (a) is cleaner; (b) is faster for small SDKs.

---

## Staff

### Q19. The team is building a Go library used by hundreds of consumers. How do you set the `internal/` policy?

**Model answer.** Three policies:

1. **Closed by default.** Every new package starts under `internal/`. Promotion to public requires a documented use case and senior review. This is the cheapest way to keep the surface small.
2. **Surface audits at every minor release.** Before tagging, list non-internal packages. Read the list. Discuss. Hide what should not be public; document what stays public.
3. **A public stability policy.** A `STABILITY.md` (or section in `README.md`) that says: "Anything under `<module>/internal/...` is internal and may change. Everything else follows SemVer."

In addition, codify enforcement:

- CI runs `go list ./... | grep -v '/internal/' > public.txt`. PRs that change `public.txt` require a senior reviewer.
- Linters (`depguard`, custom rules) enforce direction inside `internal/`.
- A `doc.go` at the module root spells out the contract.

The senior engineer's responsibility is to make the policy *cheap to follow* — automatic checks, clear docs, easy promotion process — so contributors do the right thing without thinking about it.

**Follow-up.** *What's the worst-case failure mode?* — Accidental promotion: a package quietly leaves `internal/` because a contributor mis-organised a refactor. The auto-diff on `public.txt` catches it.

---

### Q20. Describe the algorithm `cmd/go` uses to enforce `internal/`.

**Model answer.** Roughly:

```go
func allowed(imported, importer string) bool {
    elems := strings.Split(imported, "/")
    last := -1
    for i, e := range elems {
        if e == "internal" { last = i }
    }
    if last == -1 {
        return true     // not internal
    }
    parent := strings.Join(elems[:last], "/")
    return importer == parent || strings.HasPrefix(importer, parent+"/")
}
```

The toolchain implements this in `cmd/go/internal/load`, called once per import edge during package loading. Errors are accumulated and reported together, so `go build ./...` shows all violations at once.

The rule is purely syntactic on the import path. It does not consult `vendor/`, `replace`, or `go.work`. It does not check the file system beyond what is needed to resolve the import path.

**Follow-up.** *What about the special case for command-line invocations?* — `go run main.go` from inside the parent of `internal/` is allowed; from outside, not. The implementation passes a `srcDir` parameter that the rule uses for the command-line case.

---

### Q21. You're porting Go's import semantics into a custom build system (e.g., Bazel). What do you need to replicate?

**Model answer.** The minimal correct port:

1. **Package loading.** For each package, compute its import path from its module path and on-disk location.
2. **Per-import-edge check.** For every `import` statement, run the algorithm above against the importer and imported paths.
3. **Error reporting.** Surface violations as build errors with the same wording as `cmd/go` (so existing developer reflexes apply).
4. **Test handling.** Tests are loaded as ordinary packages; the rule applies normally.

Things you do *not* need:

- Special-case handling for `vendor/`, `replace`, `go.work`. These are resolution-time concerns; the rule operates on import paths, which are determined before resolution.
- Caching of the rule check. It is `O(import edges)` and trivially cheap.

Bazel's `rules_go` does this; Buck2's Go support does this; gccgo through `cmd/go` does this. If your custom system handles Go imports at all, you must enforce the rule, or you are subtly off-spec.

**Follow-up.** *Are there any edge cases that bite custom systems?* — Multiple `internal/` elements in one path; matching `internal` only as a path element (not substring); handling forks where the module path differs from the upstream.

---

### Q22. The `internal/` rule has been stable since Go 1.5. What design decisions made it so resilient?

**Model answer.** Three:

1. **Purely syntactic.** The rule operates on import paths, which are immutable strings, not on filesystem state, build state, or runtime behaviour. There is nothing to reconcile when other features change.
2. **No language change.** The rule lives in the toolchain, not in the language specification. Adding it (and modifying it) does not require a Go specification change. This avoids the highest-cost evolution path.
3. **Coarse granularity.** Per-package, not per-symbol. Per-symbol visibility would have required interaction with the type system, escape analysis, and reflection. Per-package can be implemented in a few dozen lines of path manipulation.

The combination is what gives the rule its longevity. It is small, orthogonal, and does one thing.

If Go had instead introduced a `private` keyword at the symbol level, every subsequent feature (generics, fuzzing, reflection, go.work, etc.) would have had to consider its interaction. With `internal/`, those features are oblivious to it; the rule continues to apply uniformly.

**Follow-up.** *Would you change anything?* — Probably not. The single complaint people sometimes raise — "I want `internal` for one function, not the whole package" — is solved by capitalising the function lowercase. The two mechanisms compose.
