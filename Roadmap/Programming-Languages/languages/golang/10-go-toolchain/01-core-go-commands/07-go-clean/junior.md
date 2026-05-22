# go clean — Junior

## 1. What does `go clean` do?

`go clean` **removes files and caches that the Go tools create** — leftover binaries, object files, and (with flags) the build/test/module caches. You use it when you want a fresh start or to reclaim disk space.

```bash
go clean              # remove build artifacts in the current package
go clean -cache       # wipe the whole build cache
```

Most of the time you do not need it — Go's caches are managed automatically and are safe. `go clean` is for the occasional "clear everything and rebuild" moment.

---

## 2. Prerequisites
- Go 1.21+.
- Understanding that Go keeps caches under `GOCACHE` and modules under `GOMODCACHE`.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Build cache** (`GOCACHE`) | Compiled package objects reused across builds |
| **Test cache** | Cached passing test results |
| **Module cache** (`GOMODCACHE`) | Downloaded dependency source code |
| **Object files** | Intermediate compile outputs (`.o`, `.a`) |
| **`-n`** | Print what would be removed without doing it |
| **`-x`** | Print the commands as they run |

---

## 4. The most common invocations

```bash
go clean                # remove the package's build outputs in the current dir
go clean -cache         # delete the entire build cache
go clean -testcache     # expire all cached test results
go clean -modcache      # delete the entire module download cache
go clean -i             # also remove the installed binary/archive for the package
go clean -r             # apply recursively to dependencies
```

The two you will reach for most:
- **`go clean -testcache`** — force tests to re-run from scratch.
- **`go clean -cache`** — fix a (rare) "stale cache" situation by rebuilding everything.

---

## 5. A worked example

```bash
# tests keep showing (cached) and you want a clean run:
go clean -testcache
go test ./...           # everything re-runs, no (cached)
```

```bash
# see what a clean would remove, without removing it:
go clean -n -cache
```

`-n` is your safety net: it prints the actions instead of performing them.

---

## 6. What does NOT need cleaning

Go's build and module caches are **content-addressed and safe** — stale entries are essentially impossible under normal use because cache keys include all inputs. So:

- You rarely need `go clean -cache`. If a build seems wrong, suspect your code first.
- The module cache rarely needs wiping; it just grows. Clean it mainly to reclaim disk.

In short: do not run `go clean` reflexively. Reach for it deliberately.

---

## 7. When you actually use it

| Situation | Command |
|-----------|---------|
| Tests stuck on `(cached)` results | `go clean -testcache` |
| Disk full from years of downloads | `go clean -modcache` |
| Suspected (rare) cache corruption | `go clean -cache` |
| Remove a stray built binary | `go clean` (or `go clean -i`) |

---

## 8. Cleaning vs deleting by hand

`go clean` knows *where* the caches live (via `go env`) and removes them correctly:

```bash
go env GOCACHE        # where the build cache is
go env GOMODCACHE     # where modules are
go clean -cache       # safer than rm -rf on those paths
```

Prefer `go clean` over `rm -rf` so you do not accidentally delete the wrong directory.

---

## 9. Common beginner mistakes

- **Running `go clean -cache` to "fix" build errors.** Usually the bug is in your code, not the cache.
- **Forgetting `-n`.** Use it to preview before a destructive clean.
- **Confusing `-testcache` (expire test results) with `-cache` (wipe build objects).**
- **Wiping `-modcache` then being offline.** You will re-download everything on the next build.

---

## 10. Summary

`go clean` removes Go-generated files and caches. The everyday uses are `go clean -testcache` (re-run tests fresh) and `go clean -modcache` (reclaim disk). You rarely need `go clean -cache` because the build cache is safe and content-addressed. Use `-n` to preview, and prefer `go clean` over manual `rm -rf` on cache directories.

---

## Further reading
- `go help clean`
- Build and test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
- `go env` (cache locations): `go help environment`
