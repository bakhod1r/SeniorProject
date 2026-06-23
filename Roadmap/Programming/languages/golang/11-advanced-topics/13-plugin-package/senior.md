# The `plugin` Package — Senior

## 1. Why the rules are this strict

Most of the `plugin` package's strange behavior — the platform restriction, the no-unload rule, the byte-identical type identity requirement — falls out of a single fact: **a loaded plugin is fully integrated with the host's runtime, not isolated from it**. Once `plugin.Open` succeeds, the plugin's goroutines run on the host's scheduler, its allocations go through the host's allocator, its types live in the host's type table, and its packages share the host's global init order.

There is no sandbox, no boundary, no marshalling. The plugin *is* the host, just loaded later.

That design choice explains everything else.

---

## 2. The linker's view of a plugin

When you run `go build -buildmode=plugin`, the linker performs a different job than for a normal binary. Instead of producing a self-contained executable, it produces a **partially-linked shared object** that:

- Exposes all top-level exported symbols by their fully-qualified name (`myproject/plugins/filter.New`).
- Includes type descriptors (`*runtime._type`) for every type the plugin uses.
- Includes the plugin's `init` functions, listed in a special section the runtime walks.
- Records its set of imported packages with content hashes — the runtime uses these to detect mismatches at `Open`.

The "version mismatch" error you sometimes see comes from comparing those package content hashes against the ones baked into the host. If even one byte of a shared package differs, the hash differs, and `Open` refuses to proceed.

---

## 3. Type identity, the byte-level explanation

`reflect.Type` equality in Go is **pointer equality**. Two types are "the same" when their `*runtime._type` pointers compare equal. When the linker assembles a binary, it emits one `*runtime._type` per type per binary.

When the host loads a plugin:

- The runtime walks the plugin's type table.
- For each type, it checks whether a type with the same name and same hash already exists in the host's type table.
- If it does, the plugin's `*runtime._type` is **rewritten** to point at the host's existing type — making them identity-equal.
- If it doesn't, the plugin's type is registered as a brand-new type.

If the bytes differ between host and plugin (a struct field added, a method changed, a different generic instantiation), the hashes differ, the deduplication fails, and you end up with two distinct `*runtime._type` values that print with the same name. Type assertions between them panic with the maddening "X is not X" error.

This is why "same import path" is not enough. The compiler must process the **same source bytes** under the **same build context** to produce the same hash.

---

## 4. The runtime's role on `Open`

`plugin.Open` is not just `dlopen`. The Go runtime does its own bookkeeping:

1. **`dlopen` the file.** The system loader maps the `.so` into the process's address space.
2. **Read the plugin's `pluginType` table.** This is a generated structure listing every exported symbol, every type, and every `init` function.
3. **Deduplicate types.** As described above.
4. **Check package hashes.** Compare each imported package's hash to the host's. Mismatch → unload and return an error.
5. **Run `init` functions in dependency order.** Only init functions for packages the host has not already initialized.
6. **Add the plugin's types to the global type lookup.** So that `reflect.TypeOf(x)` works for plugin-defined types.
7. **Return the `*Plugin`.**

The cost of `Open` is dominated by step 3 (type deduplication) and step 5 (init). For a plugin with a small dependency tree, expect 1–10 ms. For a plugin importing the entire standard library plus a large framework, it can climb to hundreds of milliseconds.

---

## 5. Why there is no `Unload`

To unload safely, the runtime would have to prove that **nothing** in the plugin's address range can still be reached. Reachability is brutal:

- **Type descriptors.** Any value in the host with a type defined by the plugin holds a pointer into the plugin's memory. Including interface values, `reflect.Type` references, `error` values from plugin error types, channel element types, map key/value types, slice header descriptors — anything.
- **Function pointers.** Function values, callbacks registered with the host, `time.AfterFunc`, `context.AfterFunc`, finalizers, defer chains — any of these may carry an address into the plugin's text section.
- **Goroutines.** A goroutine the plugin started may have its instruction pointer inside the plugin's code. Killing such a goroutine arbitrarily would corrupt the runtime.
- **Methods on plugin types stored in host-side caches.** Including the method tables (`itab`) maintained by the runtime for interface dispatch.
- **Globals.** The plugin's package-level variables stay live as long as anything in the host references them transitively.

Unloading would require either a full STW heap scan plus reverse-pointer audit (expensive and complex) or a per-plugin memory arena with copy-on-detach (a massive runtime change). The Go team has consistently chosen "no" rather than half-correct.

The practical implication: **a plugin once loaded is part of the program forever**. Plan capacity accordingly.

---

## 6. Reading error messages

The `plugin` package's errors are strings. Knowing what each really means saves hours:

| You see | What's actually wrong |
|---------|----------------------|
| `plugin was built with a different version of package X` | Package X's source bytes differ between host and plugin builds. Most often: different vendored copies, different `replace` directives, or one build saw stale generated code. |
| `plugin was built with a different version of package runtime` | Different Go toolchain. Match `go` versions exactly. |
| `realpath failed` | The path doesn't resolve. Check working directory and symlinks. |
| `not an ELF file` / `not a Mach-O file` | You tried to load a plugin built for a different OS, or you fed `plugin.Open` a non-plugin binary. |
| `symbol X not found in plugin Y` | The symbol either isn't capitalized, isn't at package scope, was eliminated by the linker as unreachable, or you misspelled the name. |
| `plugin already loaded` | Same path opened twice. Subsequent calls return the cached `*Plugin`; the error is silent in some versions. |
| `cannot allocate memory` | Out of address space, usually after loading thousands of plugins in a long-running process. |

A useful technique: build the plugin with `-ldflags="-v"` to see exactly what packages got linked in. That makes hash-mismatch diagnostics tractable.

---

## 7. Init order across host and plugin

Both the host and the plugin import some set of packages. The runtime guarantees:

- Each package's `init` runs **exactly once** in the program's lifetime, regardless of how many plugins also import it.
- Init runs in topological order of imports.
- A package's `init` runs after all its imports' `init` functions.
- The host's full `init` chain runs before `main`.
- The plugin's "extra" `init` functions (for packages the host did not import) run inside `plugin.Open`, in dependency order.

This means: when your plugin's `init` runs, every package the host imported is fully initialized. But packages the host did **not** import — even ones the plugin uses heavily — only initialize at `Open` time. A subtle consequence: if the host lazy-imports a package later (via another plugin), that package's `init` runs when the *second* plugin opens, not at process start.

---

## 8. Goroutines and lifetimes

A plugin can launch goroutines from its `init` or from any function the host calls. Those goroutines:

- Share the host's `GOMAXPROCS`.
- Are counted by `runtime.NumGoroutine`.
- Are scheduled identically to host goroutines — there is no isolation.
- Will outlive any individual function call.
- Will outlive the plugin "logically" — since there is no unload, they keep running until the process exits.

If a plugin leaks a goroutine, the leak is permanent. There is no way for the host to enumerate "the plugin's goroutines" and kill them. Plugin authors must own this discipline, and host authors must trust them.

---

## 9. Memory and the GC

The GC treats plugin memory like any other:

- Plugin-allocated objects participate in the same heap.
- Plugin globals are roots, identical to host globals.
- The GC scans the plugin's text section for type descriptors (used to identify live objects of plugin-defined types).

There is no per-plugin accounting. If you want to know "how much memory did this plugin allocate?", the answer is: you can't, not from the runtime. You'd have to wrap every allocation point or use external memory profiling tools (`pprof` shows allocations by call site, which lets you attribute them to the plugin's package paths).

---

## 10. Concurrency safety of `plugin.Open`

`plugin.Open` is safe to call from multiple goroutines concurrently. The package serializes the actual load operation internally:

- Two concurrent calls with the **same** path return the same `*Plugin`.
- Two concurrent calls with **different** paths run their loads sequentially under an internal mutex.

The mutex matters: if `Open` is slow (large plugins, many init functions), other goroutines calling `Open` will block. For startup paths with many plugins, the loads happen sequentially even if you spawn goroutines.

---

## 11. When this design is a feature, not a bug

The constraints look harsh but they enable one specific thing: **in-process Go-native plugins with native call speed**. A call into a plugin function is, after `Lookup`, just a direct function call — the same speed as any other Go function. There is no marshalling, no IPC, no encoding boundary.

For a system where this performance matters (sub-microsecond extension points in a hot path), the `plugin` package is the only option in pure Go. The discipline required to keep host and plugin in lockstep is the price.

For everything else, you're better served by alternatives — see [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/).

---

## 12. Summary

The `plugin` package's restrictions are not arbitrary; they fall directly out of the decision to integrate plugins into the host's runtime rather than sandbox them. Type identity requires byte-identical package content because identity is pointer equality in a shared type table. No unload exists because the runtime keeps unsafe references into the plugin's address range across uncountable code paths. `Open` is more than `dlopen` — it deduplicates types, runs init, and checks hashes. Read error messages literally: "different version of package X" means "X's bytes differ". Use this package only when you control both sides and need native call speed.

---

## Further reading
- Go runtime source — plugin support: https://github.com/golang/go/blob/master/src/runtime/plugin.go
- Plugin package source: https://github.com/golang/go/tree/master/src/plugin
- Linker internals: `cmd/link` documentation
- The broader plugin landscape: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
