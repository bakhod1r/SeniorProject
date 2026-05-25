# Build Tags — Senior

## 1. Build-time vs runtime selection

The first architectural decision: when a feature varies by platform or option, do you select **at compile time** (build tags) or **at runtime** (`runtime.GOOS`, feature flags, configuration)?

| Build tag | Runtime check |
|-----------|---------------|
| Branch removed from binary entirely | All branches compiled in |
| Different code can use OS-specific imports | Single tree of imports, all OS-compatible |
| Selection frozen at `go build` | Can flip in production without redeploy |
| Bug in one variant only affects that build | Bug in one variant ships everywhere |

Use **build tags** when:
- Code uses OS-specific imports (`syscall`, `golang.org/x/sys/unix`).
- The behavior cannot be modified without rebuilding (CE vs Enterprise).
- The code size of unused variants matters (mobile, embedded).

Use **runtime flags** when:
- You want to toggle without redeploy (A/B tests, kill switches).
- All variants are pure Go and compile on every platform.

Mixing them is fine — wrap the cross-platform interface in a build-tagged file and keep the runtime feature toggle in shared code.

---

## 2. The plug-in / driver pattern

The canonical use of build tags. One package, one interface, multiple per-OS implementations:

```go
// notifier.go (always compiled)
package notify

type Notifier interface{ Send(title, body string) error }

func New() Notifier { return newPlatformNotifier() }
```

```go
// notifier_linux.go
//go:build linux

package notify

type linuxNotifier struct{}

func (linuxNotifier) Send(title, body string) error { /* dbus */ return nil }

func newPlatformNotifier() Notifier { return linuxNotifier{} }
```

```go
// notifier_darwin.go
//go:build darwin

package notify

type macNotifier struct{}

func (macNotifier) Send(title, body string) error { /* NSUserNotification */ return nil }

func newPlatformNotifier() Notifier { return macNotifier{} }
```

```go
// notifier_windows.go
//go:build windows

package notify

type winNotifier struct{}

func (winNotifier) Send(title, body string) error { /* Win32 toast */ return nil }

func newPlatformNotifier() Notifier { return winNotifier{} }
```

Properties of this pattern:
- The caller imports `notify` once; the right implementation is selected at link time.
- Each implementation can import OS-specific packages without breaking the others.
- Add a new platform by adding one file — no `switch runtime.GOOS` to update.
- Forget to add a platform and the build fails with `undefined: newPlatformNotifier` — fail-loud is the goal.

This is exactly how `os`, `net`, and `syscall` are structured in the standard library.

---

## 3. Build cache implications

Each distinct **combination** of tags is a separate cache key. Build the same package three ways and you populate three independent cache entries:

```bash
go build .                       # combo A: default
go build -tags=integration .     # combo B: integration
go build -tags=integration,e2e . # combo C: integration+e2e
```

Practical consequences:

- A CI matrix that runs jobs with different tag sets does **not** share compile work across jobs — each job pays from scratch unless `GOCACHE` is persisted.
- Locally switching back and forth between two tag sets keeps both warm in `GOCACHE`; the third invalidates neither but adds to disk usage.
- Inconsistent tags across developers' machines = inconsistent cache hit rates; a Makefile that pins the tag set per workflow is the cure.

If you find yourself defining more than a handful of custom tags, the combinatorial explosion (2^N) means cache reuse degrades quickly. Treat tags as a scarce resource.

---

## 4. Avoiding tag proliferation

Anti-pattern:

```go
//go:build (linux || darwin || freebsd || openbsd || netbsd) && !mobile && !wasm && (cgo || pureGo)
```

A constraint this long is a smell that the file's contents are doing too much. Refactor with these rules:

- **Use `unix` instead of listing every Unix-like OS** — that's exactly why it exists (Go 1.19+).
- **Split files** rather than piling constraints on one file. Two clear files beat one Boolean puzzle.
- **Avoid custom tags that overlap** with `GOOS`/`GOARCH`. Don't invent `linux_amd64` when the suffix already gives you that.
- **Don't gate trivial differences** with a tag. A `runtime.GOOS == "darwin"` one-liner is cheaper than a separate file when the code is two lines long.

Aim for: each file's constraint fits on one line and reads in one breath.

---

## 5. Designing for cgo on/off builds

A common requirement: the library uses cgo for performance when available, falls back to pure Go otherwise. Split into two files:

```go
// fast_cgo.go
//go:build cgo

package mypkg

// #include <some.h>
import "C"

func compute(x int) int { return int(C.compute(C.int(x))) }
```

```go
// fast_nocgo.go
//go:build !cgo

package mypkg

func compute(x int) int { /* pure Go fallback */ return x * 2 }
```

Both files must export the **same** function signature. The caller doesn't know which one was linked in.

Why this matters in production: cross-compiling normally has `CGO_ENABLED=0`, so without the `!cgo` fallback your library fails to build for any cross-target. Conversely, only `//go:build cgo` and your library silently loses cgo when someone disables it. Always pair them.

---

## 6. Tag-gated integration tests

Keep the inner-loop `go test ./...` fast by tagging slow tests:

```go
//go:build integration

package billing

import "testing"

func TestStripeRealAPI(t *testing.T) { /* hits Stripe sandbox */ }
```

CI runs two stages:

```yaml
- name: unit
  run: go test -race -cover ./...
- name: integration
  run: go test -tags=integration -timeout=10m ./...
```

This is preferable to `t.Skip()` because:
- The slow test file isn't even **compiled** for the unit run (less work, fewer transitive deps).
- A developer who hasn't installed the integration prerequisites (postgres, stripe-cli) doesn't even see the file.
- The boundary is one tag in CI, not scattered `os.Getenv("RUN_INTEGRATION")` calls.

---

## 7. Distinct-binary patterns (CE vs Enterprise)

A revenue-sensitive pattern: ship a community-edition binary that excludes paid features, plus an enterprise binary that includes them — from the same repo.

```
/billing/
  free.go          (always compiled)
  enterprise.go    //go:build enterprise
```

```bash
go build -o bin/myapp-ce .                        # community
go build -tags=enterprise -o bin/myapp-ee .       # enterprise
```

Architectural rules:

- The CE build must compile and pass tests **without** the `enterprise` tag — that is the default; reviewers see CE behavior by default.
- Enterprise files can import internal/paid packages that CE files cannot, but they must implement the same interfaces so callers don't branch.
- Never reverse it (i.e., `//go:build !enterprise` for CE-only code). The default build should be the more conservative one; opt **in** to extras.
- Keep a CI matrix that builds both binaries on every PR.

This is exactly how Grafana, GitLab, and several Hashicorp products structure their open-core repos.

---

## 8. Code review checklist

When reviewing build-tag changes, look for:

- [ ] **Blank line after the constraint** before `package` — easy to miss in diff view.
- [ ] **`//go:build` matches `// +build`** if both are present (one is wrong otherwise).
- [ ] **Default build still compiles** when a new tag is introduced (run `go build ./...`).
- [ ] **Both branches of `cgo`/`!cgo`** export the same identifiers with the same signatures.
- [ ] **No tag overlap** with what `GOOS`/`GOARCH` already provide.
- [ ] **`unix` instead of listing OS-by-OS** when the file truly applies to all Unix-like systems.
- [ ] **No `//go:build never`** or `//go:build ignore` for code that is actually used; that pattern is for tools subpackages.
- [ ] **CI matrix covers each tag combo** that ships to users — otherwise some combo is silently broken.

---

## 9. Summary

Use build tags for compile-time selection of platform-specific or optional code; use runtime flags for things you want to flip without rebuilding. The plug-in pattern — one interface, several per-OS files with the same constructor — is the idiomatic way to keep platform code clean. Each tag combination is a separate `GOCACHE` key, so resist proliferation: prefer the `unix` umbrella, split files instead of stacking constraints, and pair every `//go:build cgo` with a `//go:build !cgo` fallback. For dual-binary builds (CE/Enterprise), keep the default build feature-conservative and require an opt-in tag for paid features.

---

## Further reading
- `go help buildconstraint`
- Russ Cox on build tag design: https://research.swtch.com/vgo-cmd
- `golang.org/x/sys/unix` package — extensive build-tag patterns in practice
- Source: `src/os/*` and `src/syscall/*` — production-grade plug-in pattern
