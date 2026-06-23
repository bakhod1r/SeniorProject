# 8.9 — `embed` and `//go:embed`

The `embed` package lets the Go compiler bake files from your source tree
directly into the resulting binary. One directive, one variable, and the
file's bytes ride along forever — no installer, no relative-path hunt, no
`os.Open` at startup that fails on a misconfigured container. The result
is a single self-contained executable that ships templates, SQL
migrations, web assets, fixtures, certificates, license text, or
anything else you'd rather not lose track of in deployment.

`embed` is small on purpose. There are exactly three target types
(`string`, `[]byte`, `embed.FS`), one directive (`//go:embed`), and a
handful of rules about paths and patterns. The depth comes from how it
plugs into the rest of the standard library — `io/fs`, `http.FS`,
`text/template.ParseFS`, `testing/fstest` — and from the cross-platform
quirks that bite teams the first time they ship a binary on Windows.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need the directive syntax and the three target types |
| [middle.md](middle.md) | You're serving HTTP, parsing templates, and walking embedded trees |
| [senior.md](senior.md) | You need the exact semantics of patterns, hidden files, and `fs.FS` |
| [professional.md](professional.md) | You're shipping a binary with versioned, compressed assets |
| [specification.md](specification.md) | You need the formal directive grammar and constraint list |
| [interview.md](interview.md) | You're preparing for or running interviews on `embed` |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for `embed` bugs in real code |
| [optimize.md](optimize.md) | You're trimming binary size or chasing first-byte latency |

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/) — the
  `io.Reader`/`io.Writer` foundation.
- [`08-standard-library/14-io-fs`](../14-io-fs/) — the `io/fs.FS` interface
  that `embed.FS` implements.
- [`08-standard-library/15-templates`](../15-templates/) — `ParseFS` and
  template loading from embedded trees.
