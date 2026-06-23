# 8.4 — `encoding/json`

JSON is the lingua franca of HTTP APIs, configuration files, log
records, IPC payloads, and almost every place two systems exchange
structured data. Go's `encoding/json` is the standard-library answer:
reflection-based marshaling, struct-tag-driven naming, streaming
encoders and decoders that compose cleanly with `io.Reader` and
`io.Writer`, and a small set of interfaces (`Marshaler`, `Unmarshaler`,
`TextMarshaler`, `TextUnmarshaler`) that let you customize behavior
without leaving the package.

This leaf walks the package end-to-end: the day-one APIs, the tag
grammar, custom (un)marshalers, the streaming `Encoder`/`Decoder`,
`RawMessage` for delayed parsing, `Number` for arbitrary-precision
numerics, the field-resolution rules for embedded structs, the error
types, and the production patterns and traps that hit teams every
quarter — `omitempty` not omitting `time.Time{}`, integers decoded into
`interface{}` as `float64`, HTML-escape-by-default, missing
`DisallowUnknownFields`. We close with a performance playbook and a
forward look at `encoding/json/v2`.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need `Marshal`/`Unmarshal`, struct tags, and the trap with numbers |
| [middle.md](middle.md) | You're writing custom marshalers, streaming, NDJSON, polymorphic decoding |
| [senior.md](senior.md) | You need exact tag/embed semantics, `Token`, escaping, cycles |
| [professional.md](professional.md) | You're shipping API responses, schema versioning, defensive limits |
| [specification.md](specification.md) | You need the formal type-mapping and interface tables |
| [interview.md](interview.md) | You're preparing for or running interviews on JSON in Go |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for `encoding/json` bugs |
| [optimize.md](optimize.md) | You're cutting allocations or pushing throughput |

## Prerequisites

- Go 1.22+ (examples use `errors.Is`, generics where natural,
  `slices`/`maps`).
- Solid grasp of `io.Reader`/`io.Writer` from
  [`01-io-and-file-handling`](../01-io-and-file-handling/index.md) —
  the streaming sections build on it directly.
- Reflect-time vs compile-time mental model helps for the optimization
  chapter.

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — every `Encoder`/`Decoder` in this leaf takes an `io.Writer`/
  `io.Reader`. Drain HTTP bodies the same way.
- [`08-standard-library/05-net-http`](../05-net-http/) — request/response
  decoding patterns and `MaxBytesReader` belong there.
- [`08-standard-library/06-time`](../06-time/) — `time.Time`'s
  `MarshalJSON` is RFC 3339, and its non-zero behavior with `omitempty`
  is the subject of multiple bug exercises.
