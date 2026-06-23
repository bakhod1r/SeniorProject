# 8.21 `path` and `path/filepath` — Tasks

> Hands-on exercises. Each task has acceptance criteria; pass them
> all before moving on. The solutions are not provided.

## T1 — Recursive file finder with extension filter

Write `func FindByExt(root string, exts ...string) ([]string, error)`
that returns all files under `root` whose extension matches one of
`exts`. Use `WalkDir`, skip `node_modules`, `.git`, and `vendor`.

**Acceptance:**

- `WalkDir` with `SkipDir` for excluded directories.
- Extensions compared case-insensitively.
- Returns paths in lexical order.
- Test with a tree that includes a symlink loop: the function does
  not hang.
- A 100k-file tree completes in < 5 seconds on local SSD.

## T2 — Path sanitizer for archive extraction

Implement `func SafeJoin(base, entry string) (string, error)` that
returns the full path or an error if `entry` would escape `base`.

**Acceptance:**

- Reject absolute `entry`.
- Reject `entry` with `..` that escapes.
- Reject empty `entry`.
- Reject Windows-reserved names (`CON`, `NUL`).
- Use `filepath.IsLocal` for the primary check.
- 100% test coverage on the rejection cases.

## T3 — Cross-platform config file locator

Write `func ConfigFile(appName, fileName string) (string, error)`
that returns the platform-appropriate config file path.

**Acceptance:**

- On Linux: `~/.config/{appName}/{fileName}` (respect
  `$XDG_CONFIG_HOME`).
- On macOS: `~/Library/Application Support/{appName}/{fileName}`.
- On Windows: `%AppData%\{appName}\{fileName}`.
- Use `os.UserConfigDir` rather than computing the path manually.
- Create the directory if it doesn't exist.

## T4 — Directory tree printer

Build a CLI `treeprint <dir>` that prints the directory tree like
the `tree` command. Use `WalkDir` and `filepath.Rel` for output.

**Acceptance:**

- Output format:
  ```
  root/
  ├── file1.txt
  ├── subdir/
  │   ├── file2.txt
  │   └── file3.txt
  └── file4.txt
  ```
- Skips hidden directories (starting with `.`).
- Optional `-a` flag to include hidden.
- Optional `-L N` flag to limit depth.

## T5 — Glob with double-star (`**`) support

Write `func GlobStar(pattern string) ([]string, error)` that
supports `**` for recursive matching.

**Acceptance:**

- `GlobStar("**/*.go")` finds all `.go` files anywhere.
- `GlobStar("src/**/test_*.go")` finds test files under `src`.
- Use `WalkDir` plus `filepath.Match` on the segments.
- Test with a tree of known files.

## T6 — Atomic file writer

Write `func WriteFileAtomic(path string, data []byte, perm os.FileMode) error`
that writes a file atomically.

**Acceptance:**

- Creates a temp file in the same directory as `path`.
- `Sync` before close.
- `Rename` to final name (atomic on same filesystem).
- Cleans up temp file on failure.
- Works on Linux, macOS, and Windows.

## T7 — Symlink-safe path joiner

Write `func JoinNoSymlinks(base, name string) (string, error)`
that joins `base` and `name`, then verifies no component of the
result is a symlink that escapes `base`.

**Acceptance:**

- For Go 1.24+: use `os.OpenRoot(base)` and `root.Open(name)`.
- For Go ≤ 1.23: use `filepath.EvalSymlinks` and a prefix check.
- Reject if any intermediate symlink escapes.
- Test by creating a symlink inside `base` that points outside.

## T8 — Directory size calculator

Write `func DirSize(root string) (int64, error)` that returns the
total size of all files under `root`. Use `WalkDir` and call
`d.Info()` for sizes.

**Acceptance:**

- Skip symlinks (don't follow them).
- Sum is correct for sparse files (`Info.Size()` reports the
  logical size).
- Returns the partial sum on error, plus the error.
- Concurrent version: 4× faster on a multi-core machine.

## T9 — File system equality check

Write `func SameFile(a, b string) (bool, error)` that returns true
if `a` and `b` refer to the same file.

**Acceptance:**

- Use `os.SameFile(infoA, infoB)` rather than path comparison.
- Detects symlinks pointing to the same target.
- Detects hardlinks (multiple paths to the same inode).
- Works cross-platform (on Windows, NTFS supports hardlinks too).

## T10 — Path-traversal HTTP handler

Build an HTTP file server that serves files under a base directory.
Reject path-traversal attempts.

**Acceptance:**

- Use `os.OpenRoot` (Go 1.24+) or `IsLocal` + `Join` (older).
- Return 404 for paths that don't exist.
- Return 400 for paths that are malformed.
- Return 403 for paths that escape (the user should not learn
  whether the escaped file exists).
- 100% test coverage of attack vectors: `..`, absolute paths,
  Windows reserved names, embedded NUL, long paths.

## Stretch tasks

### S1 — `filepath.Walk` replacement with concurrency budget

Implement `func ConcurrentWalk(root string, parallelism int,
fn func(path string, d fs.DirEntry) error) error` that walks the
tree with up to `parallelism` workers processing files in
parallel.

**Acceptance:**

- Single producer walks; workers consume.
- Bounded channel for backpressure.
- Walk error and worker error both propagate via `errgroup`.
- Benchmarks: 4× speedup over `WalkDir` for CPU-bound work on a
  4-core machine.

### S2 — Build a `find`-like CLI

Implement a CLI matching the basic `find` syntax:

```
find <root> [-type f|d] [-name pattern] [-maxdepth N] [-mtime +N]
```

**Acceptance:**

- All listed flags work.
- Use `WalkDir` plus per-file filter logic.
- Output matches `find` on basic queries.
- Add an `-exec` flag that runs a command per file.

### S3 — Watch directory tree with both poll and notify

Build a watcher that uses `fsnotify` when available and falls back
to polling. Switch dynamically if events stop arriving (e.g., on a
network mount where notification doesn't work).

**Acceptance:**

- Both backends produce the same event stream.
- Detection of notification failure within 30 seconds.
- Test by simulating a mount that doesn't support notifications.

### S4 — Implement `os.OpenRoot` for Go 1.22

Without using Go 1.24+, write `MyRoot` that emulates `os.OpenRoot`
for path-traversal safety. Use `EvalSymlinks` after `Join` and
verify the prefix.

**Acceptance:**

- Reject paths that escape the root (lexically or via symlinks).
- Test with a malicious symlink that points outside.
- Document the TOCTOU window where a symlink could be inserted
  between the check and the open.
- (This is why `os.OpenRoot` was added — your version cannot fully
  close the race.)
