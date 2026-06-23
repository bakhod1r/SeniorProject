## `//go:linkname` Directive — Professional

## 1. Production stance: do not use

For a production service shipping under a SemVer guarantee, the default answer to "should we use `//go:linkname`?" is **no**. The directive trades a small, locally-visible benefit (skipping a function call, reading a runtime internal) for an open-ended liability (your binary may stop working on the next Go release).

There are well-defined cases where the trade is worth it — implementing a syscall wrapper that the stdlib does not yet expose, providing a fallback for a Go version before a public API existed, integrating with a profiler that needs deep runtime hooks. These cases are exceptions. Treat them as exceptions in your code review process.

This page is about how to handle the directive when, despite the default position, it lands in your codebase.

---

## 2. The cost model

| Cost | Borne by |
|------|----------|
| Runtime internal symbol changes | The on-call engineer for the next Go upgrade |
| Signature mismatch produces silent miscompilation | The team that owns the eventual customer-facing incident |
| The directive's allow-list shrinks in a future release | Whoever has to ship a fix in production within 24 hours |
| Audit work to find every linkname in the dependency tree | Security and compliance teams |

The cost is not visible on the day the directive is committed. It surfaces six to eighteen months later, often during an unrelated upgrade, often with a tight deadline.

---

## 3. Documentation requirements

Every `//go:linkname` in a production codebase should be accompanied by a comment block answering five questions:

```go
// linkname rationale:
//   why:           Avoiding the math/rand/v2 init overhead in a hot retry path.
//   measured gain: ~15ns/call vs math/rand/v2 (see bench_test.go).
//   target source: src/runtime/stubs.go (Go 1.20-1.22).
//   removed when:  math/rand/v2 lands and is benchmarked equivalent on go1.23+.
//   owner:         platform-runtime@team
import _ "unsafe"

//go:build go1.20 && !go1.23
//go:linkname fastrand runtime.fastrand
func fastrand() uint32
```

The "removed when" line is the most important: it commits the team to a removal trigger, not just a date.

---

## 4. Code review checklist

When reviewing a PR that adds or modifies a `//go:linkname`:

| Check | Expected |
|-------|----------|
| `import _ "unsafe"` present | Yes (mandatory in Go 1.23+) |
| Build tags pin specific Go versions | Yes; covers tested versions only |
| Target symbol verified in the runtime source | Yes; commit message links to the file |
| Signature copied verbatim from runtime source | Yes; PR reviewer cross-checks |
| Fallback path exists for unsupported Go versions | Yes; build-tag mutually exclusive |
| Documentation block present | Yes |
| Bench numbers justify the cost | Yes; alternative profile included |
| CI matrix exercises both linkname and fallback | Yes |

Any "no" is a blocking comment.

---

## 5. CI matrix design

A production-grade CI for code that uses `//go:linkname`:

```yaml
strategy:
  matrix:
    go: ['1.21.x', '1.22.x', '1.23.x', '1.24.x', 'tip']
steps:
  - uses: actions/setup-go@v5
    with:
      go-version: ${{ matrix.go }}
  - run: go build ./...
  - run: go test ./...
  - run: go vet ./...
```

The crucial entry is `tip` — Go's master branch. It catches breakage roughly one release cycle before it ships in stable, giving you time to land a fix.

For libraries published on Go module proxy, also matrix across the supported `go.mod` `go` directive version (`go 1.21`, `go 1.22`, etc.) to catch directive-syntax changes.

---

## 6. Detecting linkname dependencies

The directive is grep-able, but the deeper question is: which of my dependencies use it?

```bash
$ go mod download -json all | jq -r .Dir | \
    xargs -I{} grep -l '//go:linkname' {}/*.go 2>/dev/null
```

This walks every downloaded module's Go files and prints those containing the directive. Run it weekly; a sudden new appearance in the output is a signal that a recent dependency update introduced a linkname dependency.

For more rigorous tracking, the open-source `linkname-lint` style checks can be integrated into `golangci-lint`. They are not bundled by default; consult your linter configuration.

---

## 7. The `-checklinkname` flag

Go 1.23 ships a linker flag controlling external linkname enforcement:

```bash
go build -ldflags="-checklinkname=1" ./...    # default: warn or error
go build -ldflags="-checklinkname=0" ./...    # disable; last-resort escape hatch
```

For production CI, **leave the flag at its default**. If a build fails due to a disallowed linkname, that is the signal to migrate, not to disable the check. Treat `-checklinkname=0` the way you treat `// nolint:errcheck` — a deliberate, audited, time-limited exception.

A reasonable policy: any commit that sets `-checklinkname=0` requires an attached issue with an owner, a target removal date, and a sign-off from the platform team.

---

## 8. Migration playbook for breaking changes

When a Go release breaks a linkname your service depends on:

1. **Identify**: `go build` fails with `relocation target X not defined`. Note the symbol.
2. **Locate consumers**: `git grep -n 'X'` across your repository and `go mod download`'d sources.
3. **Find the replacement**: search the Go release notes for the symbol name. Almost always a public alternative was added in the release that removed the symbol.
4. **Implement the public alternative behind the same internal name**: keep the call sites unchanged.
5. **Build-tag-gate the old linkname for older Go versions**: if you support both.
6. **Update the documentation block**: change "removed when" to "removed" and link to the migration PR.
7. **Add a regression test**: ensure the replacement behaves the same on relevant inputs.

The migration usually takes a day or two for a small linkname. The cost compounds when several appear at once, which is why limiting the number of linknames per service is itself a goal.

---

## 9. Detection tools for the supply chain

| Tool | Use |
|------|-----|
| `go mod why` | Trace which dependency pulls in a linkname-using package |
| `osv-scanner` | Check for known incidents in dependencies (some linkname-related advisories) |
| `govulncheck` | Vulnerability checks; will flag known runtime API surface issues |
| `go vet` | Built-in directive sanity checks |
| `staticcheck` | Catches some misuse patterns |

A production-grade pipeline runs the first four on every push and the fifth on a nightly schedule.

---

## 10. When the directive is the right answer

There are narrow cases where `//go:linkname` is the cleanest path:

| Case | Notes |
|------|-------|
| Implementing a syscall wrapper before stdlib exposes it | `golang.org/x/sys` precedent; commit to removal once stdlib catches up |
| Profiler integration needing runtime internals | `runtime/pprof` already covers most needs; verify before reaching for linkname |
| Cross-package private data sharing within a coherent monorepo | Internal packages (`internal/`) are usually a better fit |
| Test helpers that need to peek into the runtime | Restrict to `_test.go` files; never ship in production binaries |

Even in these cases, the directive should be the **last** technique you try, documented as such in the commit message.

---

## 11. Anti-patterns to flag in review

| Pattern | Why bad |
|---------|---------|
| Linkname to gain a few nanoseconds in a non-hot path | Cost dwarfs benefit |
| Linkname without `import _ "unsafe"` | Fails to build on Go 1.23+ |
| Linkname without build tags | Will silently break on Go upgrade |
| Linkname targeting a stdlib export | Pointless; call the export directly |
| Linkname in `_test.go` that only exists to access an unexported value | Use `export_test.go` instead |
| Linkname commented "TODO: remove later" with no removal trigger | "Later" never arrives |
| Multiple linknames sharing one Go version constraint | Couples failure across them; split into per-target files |

The last item is worth its own pattern: if you have five linknames each gated by `go1.20-1.22`, that is brittle. Each should specify its own version range tied to its own target's history.

---

## 12. Observability

Once a linkname is in production, surface its existence in logs and metrics:

```go
import _ "unsafe"

//go:linkname runtimeNano runtime.nanotime
func runtimeNano() int64

func init() {
    if runtimeNano() < 0 {
        log.Println("warning: runtime.nanotime returned negative value; linkname may be broken")
    }
    metrics.Counter("linkname_usage_total", "target", "runtime.nanotime").Inc()
}
```

Emitting a metric tagged with the linked symbol name gives you a dashboard listing every active linkname in production. When you upgrade Go and the metric stops appearing — because the binary failed to link — the absence is itself the signal.

---

## 13. Library author guidance

If you maintain a library that uses `//go:linkname`:

1. **Document it in your README.** Users have a right to know they are inheriting the maintenance burden.
2. **Provide a build tag to disable it.** Users who do not want the dependency on runtime internals can opt out.
3. **Pin tested Go versions in `go.mod` and CI.** Be honest about what you support.
4. **Have a fallback implementation.** When the linkname breaks, your library should still work, even if slower.
5. **Cut a release the day Go's release candidate ships.** Your users need the patch on day one of the new Go release, not week three.

The libraries that handle this well — `golang.org/x/sys`, `goccy/go-json`, `bytedance/sonic` — share these practices. The libraries that handle it poorly become CVE-tier incidents when Go ships.

---

## 14. Operational scenario: a Go release breaks production

A condensed playbook for the moment the runtime symbol disappears:

1. The deploy fails. The error is `relocation target runtime.foo not defined` at link time.
2. Pin the previous Go toolchain in `go.mod` (`toolchain go1.22.5`) and redeploy. This buys hours.
3. Identify every linkname in your service and its transitive dependencies.
4. For each: implement the public-API replacement or roll the dependency back to a version not using the linkname.
5. Test on the new Go version in staging. Verify the replacement passes the integration suite.
6. Deploy to production.
7. Write a postmortem; the action items should include adding `tip` to the CI matrix.

A well-prepared team executes this in a working day. An unprepared team takes a week and burns operational trust.

---

## 15. Summary

In production code, `//go:linkname` is a **last-resort technique** with explicit documentation, build-tag gating, cross-version CI, code-review checklist, and a defined removal trigger. The Go 1.23 changes (`import _ "unsafe"` requirement, `-checklinkname` flag) are signals from the Go team that external use is being phased out. Treat every linkname as technical debt with a known expiry. Audit your dependency tree for transitive uses. Have a migration plan ready before the linkname breaks, not after.

---

## Further reading
- `golang/go#67401`: https://github.com/golang/go/issues/67401
- Go 1.23 release notes (linkname section): https://go.dev/doc/go1.23
- `golang.org/x/sys` build process: https://go.googlesource.com/sys
- `govulncheck`: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
