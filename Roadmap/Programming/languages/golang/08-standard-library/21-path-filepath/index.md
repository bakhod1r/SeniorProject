# 8.21 `path` and `path/filepath`

Two packages, one concept. `path` operates on slash-separated paths
(URLs, virtual FS names, `io/fs` paths). `filepath` operates on
OS file system paths — backslashes on Windows, forward-slashes
everywhere else. Knowing which to reach for, and when, is the whole
game.

## Files in this leaf

- [junior.md](junior.md) — the key distinction, `filepath.Join`,
  `Split`, `Dir`, `Base`, `Ext`, `Abs`, `Clean`, and the `path`
  equivalents for URL work. Common beginner mistakes.
- [middle.md](middle.md) — `filepath.Walk`, `WalkDir`, `Glob`,
  `Match`, `EvalSymlinks`, `Rel`, `IsAbs`, `IsLocal`, `SplitList`.
  Building cross-platform tools.
- [senior.md](senior.md) — `WalkDir` internals and `DirEntry` vs
  `FileInfo`, traversal order guarantees, symlink loop detection,
  `filepath.Localize` (Go 1.23+), path traversal security, the
  `WalkFunc` contract, cross-compilation path handling.
- [professional.md](professional.md) — building a file indexer,
  safe archive extraction, watch patterns, large tree streaming,
  testing with `os.DirFS` and `testing/fstest`.
- [specification.md](specification.md) — full API reference tables
  for both packages, `WalkFunc` and `WalkDir` contracts, pattern
  syntax.
- [interview.md](interview.md) — Q&A by level from junior to
  principal.
- [tasks.md](tasks.md) — ten+ exercises: recursive finder,
  path sanitizer, config locator, tree printer.
- [find-bug.md](find-bug.md) — ten+ broken snippets to repair:
  wrong package, path traversal, hardcoded separators, symlink
  mishandling.
- [optimize.md](optimize.md) — ten+ optimization exercises:
  Walk→WalkDir, concurrent traversal, early termination, batching.

## Cross-links

- [`../05-os/`](../05-os/) — `os.Stat`, `os.ReadDir`, `os.MkdirAll`,
  and other file system operations that consume paths built by
  `filepath`.
- [`../14-io-fs/`](../14-io-fs/) — `fs.FS` uses forward-slash `path`
  rules, not OS `filepath` rules. Understanding both packages makes
  `io/fs` behaviour obvious.
- [`../01-io-and-file-handling/`](../01-io-and-file-handling/) — the
  byte-stream layer underneath file access. `filepath.Join` gets you
  to the file; `io.Reader` and friends read it.
