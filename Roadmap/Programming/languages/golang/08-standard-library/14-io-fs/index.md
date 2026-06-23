# 8.14 `io/fs` — Abstract Read-Only Filesystem

The interface that lets your code read from disk, from a `.zip` archive, from
an `embed.FS`, or from an in-memory test fixture without changing a line.
`io/fs` is what `io.Reader` is to byte streams, scaled up to filesystems.

## Files in this leaf

- [junior.md](junior.md) — the four core interfaces, helper functions,
  forward-slash rules, walking trees, the canonical concrete FS types.
- [middle.md](middle.md) — optional capability interfaces, `WalkDir`
  internals, building your own FS, `fstest` for conformance and unit tests.
- [senior.md](senior.md) — the exact contract, `ValidPath`, error sentinels,
  symlink support (Go 1.21+), the `os.DirFS` vs `os.Root` (Go 1.24) story.
- [professional.md](professional.md) — production patterns: layered FS,
  filtered FS, observability, http.FS, ParseFS pitfalls.
- [specification.md](specification.md) — the formal interface reference.
- [interview.md](interview.md) — the questions that come up about `io/fs`.
- [tasks.md](tasks.md) — exercises that build real FS implementations.
- [find-bug.md](find-bug.md) — broken `FS` implementations to repair.
- [optimize.md](optimize.md) — `WalkDir` lazy stat, `DirEntry` reuse,
  capability fast paths.

## Cross-links

- [`../01-io-and-file-handling/`](../01-io-and-file-handling/) — the
  byte-stream layer that `fs.File` sits on top of.
- [`../09-go-embed/`](../09-go-embed/) — `embed.FS` is the canonical
  read-only `fs.FS`.
- [`../15-templates/`](../15-templates/) — `template.ParseFS` consumes any
  `fs.FS`.
