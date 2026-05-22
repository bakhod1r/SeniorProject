# go clean — Senior

## 1. Why you almost never need `go clean -cache`

The build cache is **content-addressed**: each action's result is keyed by a hash of all its inputs (source, flags, tags, toolchain, environment). A stale result is therefore impossible under correct operation — if any input changes, the key changes and a fresh entry is produced. So "clean the cache to fix a weird build" is usually cargo-cult; the real cause is almost always:

- A genuine source/dependency issue.
- An environment difference (`GOFLAGS`, build tags, `GOOS/GOARCH`) you did not account for.
- A toolchain version mismatch.

Reserve `go clean -cache` for actual cache **corruption** (disk errors, interrupted writes), which is rare. Reaching for it routinely just makes the next build slow.

---

## 2. Cache size management instead of wiping

The build cache grows but trims itself: Go maintains the cache with usage timestamps and periodically evicts old entries. You can also cap it:

```bash
go env GOCACHE
# Go 1.22+: configure a soft size limit via the cache trimming mechanism
GOCACHE=... go env -w GOCACHE=...
```

Modern Go performs automatic cache trimming, so unbounded growth is mostly a non-issue. For the module cache, growth is bounded by the set of versions you have used; `go clean -modcache` is the blunt reset.

A targeted alternative for the module cache:

```bash
# Go has no per-version module clean; -modcache is all-or-nothing.
go clean -modcache    # full reset
```

---

## 3. The read-only module cache and CI

`GOMODCACHE` entries are read-only by design to prevent accidental mutation. Implications:

- `rm -rf` on it fails or needs `chmod -R u+w` first; **`go clean -modcache` is the correct tool** (it handles permissions).
- In Docker/CI where the cache is on a mounted volume, deleting it as a non-owner can fail; use `go clean -modcache` or ensure correct ownership.
- A corrupted module cache entry surfaces as checksum/verify failures; `go clean -modcache` then re-download (with `go mod download`) resolves it, and `go mod verify` confirms integrity.

---

## 4. `-testcache` semantics

`go clean -testcache` does not delete files arbitrarily — it **expires** cached test results by marking the cache so future identical test runs re-execute. This is the global counterpart to `-count=1`. Use it when:

- A test depends on untracked external state and you want all future runs to re-execute until recached.
- You changed something the cache cannot see (e.g., a test database) and need a clean baseline.

In CI, prefer `-count=1` on the relevant suite over a global `-testcache` expiry, which is broader than needed.

---

## 5. Where it surprises people

- **`go clean` (no flags) does little today.** With the modern build cache, packages are not built into their source dirs by default, so a bare `go clean` often removes nothing. People expect it to "clean the build" — that is `-cache`.
- **`-modcache` then offline** → builds fail re-downloading. Do not wipe the module cache before a disconnected build.
- **`-cache` in CI per job** → defeats the build cache you carefully persisted, slowing every job.
- **Permission errors on manual `rm`** of `GOMODCACHE` (read-only files).
- **`-i` is per-package**, not a global uninstall; people expect it to clear all installed tools.
- **Fuzz seed corpora are safe** — `-fuzzcache` only clears generated corpus, not `testdata/fuzz`.

---

## 6. CI usage patterns

```bash
# Reclaim disk on a long-lived self-hosted runner (scheduled, not per-job):
go clean -modcache
go clean -cache

# Verify a cold-cache build works (catch hidden cache dependence):
go clean -cache && go build ./...

# Force a fresh integration test baseline:
go clean -testcache && go test -tags=integration ./...
```

Senior CI rule: **do not clean caches per job** if you are caching them for speed — that is contradictory. Clean only on a schedule (disk hygiene) or in a dedicated "cold build" verification job.

---

## 7. Diagnosing "is the cache the problem?"

Before cleaning, prove it:

```bash
go build -x ./... 2>&1 | grep -i "cache\|recompile"   # see hits vs compiles
go env GOFLAGS GOOS GOARCH CGO_ENABLED                # environment differences
go version                                            # toolchain mismatch?
```

If a clean "fixes" a build, the real bug (env drift, nondeterministic generation) is still there and will recur. Find it.

---

## 8. Summary

`go clean`'s cache flags are blunt resets you rarely need: the build cache is content-addressed and self-trimming, so corruption (not staleness) is the only legitimate reason to wipe it. `-modcache` reclaims the most disk and is the correct tool given read-only entries; `-testcache` globally expires test results (prefer `-count=1` for targeted re-runs). Never clean caches per CI job if you cache them for speed; clean on a schedule or in a cold-build verification job, and always diagnose env/toolchain drift before blaming the cache.

---

## Further reading
- Build and test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
- Module cache: https://go.dev/ref/mod#module-cache
- `go help clean`, `go help environment`
