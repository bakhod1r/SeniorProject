# go generate — Senior

## 1. Where generation belongs in your architecture

Generated code is **compile-time** code. Three forces push work into `go generate` and away from runtime:

1. **Performance.** Reflection-based JSON or ORM is slow; generated marshallers (e.g., `easyjson`, `sqlc`) skip reflection entirely.
2. **Type safety.** A generated typed client for a gRPC/REST API turns runtime errors into compile errors.
3. **Boilerplate elimination.** `String()` for enums, mock implementations, embedded specs — mechanical work that humans get wrong.

Forces pushing work *away* from generation:
- Slow generation step hurts the inner dev loop.
- Generated files bloat diffs and obscure ownership in review.
- Coupling to a generator becomes a long-term dependency you must maintain.

Rule of thumb: generate when an **external schema** is the source of truth (`.proto`, `.sql`, OpenAPI), or when the code is **mechanical and derivable**. Don't generate code that humans would just write differently each time.

---

## 2. Source of truth design

Generation only pays off when the input schema is itself authoritative. If your team treats generated code as the "real" code and edits it by hand, you have inverted the dependency and the generator becomes useless.

Architectural enforcement:
- Put generated files in `*_gen.go` / `*_string.go` so their nature is visible in every code listing.
- Use the `// Code generated ... DO NOT EDIT.` header so linters and review tools flag manual edits.
- In code review, reject changes that edit generated files directly.
- Keep schemas (`.proto`, `.sql`, OpenAPI) under the same versioned tree as the code they generate.

---

## 3. The reproducibility contract

For generation to be safe across machines and time, three things must be pinned:

| Thing | How |
|-------|-----|
| Tool version | `go run path/to/tool@vX.Y.Z` inline, or `go.mod tool` directive |
| Go toolchain version | `go.mod` `go 1.XX` line + `toolchain` directive (Go 1.21+) |
| Generator inputs | All in repo (no fetching schemas from URLs at generation time) |

Without all three, two engineers running `go generate ./...` on identical commits can produce **different** output. CI then yo-yos depending on who pushed last. Pin everything; document the policy in `CONTRIBUTING.md`.

---

## 4. Build cache, generation cache

`go generate` itself has **no cache**. Every invocation re-runs every directive. For a large repo with slow generators (protoc with many `.proto` files), this dominates iteration time. Mitigations:

- Use `go generate -run="<regex>"` to invoke only the generator that matters for your change.
- Place generator invocations in `Makefile` targets that file-system-watch their inputs (e.g., regenerate only when the matching `.proto` changes).
- For protoc specifically: rely on its own `--<lang>_out=` incremental behavior or use a wrapper like `buf` that has its own cache.

The deeper lesson: `go generate` is the *invocation* layer; caching is the *generator's* responsibility. Pick generators that are fast or incremental.

---

## 5. Cross-platform directives

`//go:generate` lives inside a `.go` file, which is subject to build constraints. So a directive in `linux_amd64.go` runs only when generating with `GOOS=linux GOARCH=amd64`. This is occasionally useful (platform-specific syscalls) but is a common source of "the generator doesn't fire on the M-series Mac" tickets.

Convention: keep generation directives in build-constraint-free files unless platform specificity is essential.

```go
// generate.go — no //go:build line, runs everywhere
package mypkg

//go:generate go run ./internal/cmd/gen
```

---

## 6. Designing your own generator

When the ecosystem doesn't have what you need, write a small generator yourself. Senior-level checklist:

- **Use `go/ast`, `go/parser`, `go/types`** to read source — not regex.
- **Use `text/template` or `go/format` + `text/template`** to write output, then `go/format.Source(out)` to gofmt the result.
- **Emit the `DO NOT EDIT` header** so it's machine-recognized.
- **Be deterministic.** Sort map iteration, sort symbol lists, never include timestamps. Non-determinism breaks the "regen + git diff" CI check.
- **Accept inputs via flags or `os.Args`,** not implicit globals — directives are easier to read.
- **Exit non-zero on any error,** with a clear message including the source file/line.

Skeleton:

```go
package main

import (
    "flag"
    "go/format"
    "log"
    "os"
)

var typeName = flag.String("type", "", "type name to generate for")

func main() {
    flag.Parse()
    if *typeName == "" {
        log.Fatal("required: -type")
    }
    out := generate(*typeName) // returns []byte of Go source
    formatted, err := format.Source(out)
    if err != nil {
        log.Fatalf("format: %v\nraw output:\n%s", err, out)
    }
    if err := os.WriteFile(*typeName+"_gen.go", formatted, 0o644); err != nil {
        log.Fatal(err)
    }
}

func generate(typeName string) []byte { return nil }
```

---

## 7. Code review for generated code

Three rules that scale to large teams:

1. **Generated files in their own commits** when the schema also changes. A PR that mixes schema + generated diff + handwritten code is unreadable; split into "schema change" + "regenerate" + "use the new types".
2. **Verify the generator command** is pinned and reproducible. Reject `@latest`.
3. **Read the schema diff carefully,** skim the generated diff. If the generator is deterministic, the generated diff should fall out mechanically from the schema diff.

---

## 8. Failure modes at scale

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Regenerated output differs between two engineers | Different Go or generator versions | Pin both in `go.mod` and inline `@vX.Y.Z` |
| CI fails "generated code out of date" but engineer regenerated | Generator depends on machine state (PATH, env var) | Move generator to `go run path@version`; remove env dependencies |
| Regeneration is too slow | Many directives all re-run | Adopt `-run=` filtering; or push to per-input `Makefile` targets |
| Generated files conflict on merge | Two PRs touched the same generator | Reorder: rebase, regenerate, push |
| Generator output non-deterministic | Map iteration, timestamps, random IDs | Sort everything; never include time |

---

## 9. Should you generate at build time?

Some projects auto-run `go generate` from a `go:build ignore` driver or a `Makefile` wrapping `go build`. **Don't.** It hides the generation step from new contributors, slows every build, and makes CI sensitive to environment changes. The convention "generated files are committed; CI verifies they are current" is more robust.

The narrow exception is `go.mod`'s `tool` directive ecosystem (Go 1.24+), which standardizes tool resolution — but the generation invocation itself is still explicit.

---

## 10. Summary

`go generate` is a thin invocation layer over your generators; the discipline is everything else: pin versions, mark generated files, keep generators deterministic, split commits, and let CI enforce that the committed artifact matches the schema. Treat generation as a contract between a versioned input (schema) and a versioned tool, with code review on both sides of that contract.

---

## Further reading
- `go help generate`
- Go blog — Generating code: https://go.dev/blog/generate
- `buf` (protobuf workflow): https://buf.build
- `sqlc`: https://docs.sqlc.dev
