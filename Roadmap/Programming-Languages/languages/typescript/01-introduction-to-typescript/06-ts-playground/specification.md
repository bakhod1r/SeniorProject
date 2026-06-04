# TS Playground — Specification

> **Official Documentation Reference**
>
> Source: [TypeScript Playground](https://www.typescriptlang.org/play) and [TypeScript Dev Docs](https://www.typescriptlang.org/dev/) — Playground, Sandbox, VFS, and Twoslash.

---

## Table of Contents

1. [Docs Reference](#1-docs-reference)
2. [Feature / Panel Reference](#2-feature--panel-reference)
3. [Core Concepts & Rules](#3-core-concepts--rules)
4. [Compiler Options Exposed in the UI](#4-compiler-options-exposed-in-the-ui)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Browser / Platform Compatibility](#6-browser--platform-compatibility)
7. [Edge Cases from Official Docs](#7-edge-cases-from-official-docs)
8. [Version & Capability History](#8-version--capability-history)
9. [Official Examples](#9-official-examples)
10. [URL & Deep-Link Reference](#10-url--deep-link-reference)
11. [Twoslash Directive Reference](#11-twoslash-directive-reference)
12. [Compliance Checklist](#12-compliance-checklist)
13. [Related Documentation](#13-related-documentation)

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Official Playground** | [typescriptlang.org/play](https://www.typescriptlang.org/play) |
| **Dev / Sandbox docs** | [typescriptlang.org/dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) |
| **Virtual FS docs** | [typescriptlang.org/dev/typescript-vfs](https://www.typescriptlang.org/dev/typescript-vfs/) |
| **Twoslash** | [shikijs.github.io/twoslash](https://shikijs.github.io/twoslash/) |
| **Handbook** | [typescriptlang.org/docs/handbook/intro.html](https://www.typescriptlang.org/docs/handbook/intro.html) |
| **tsconfig reference** | [typescriptlang.org/tsconfig](https://www.typescriptlang.org/tsconfig) |
| **Compiler API wiki** | [github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) |

The Playground is part of the official TypeScript website (`microsoft/TypeScript-Website` on GitHub). It is open source, and its building blocks (`@typescript/sandbox`, `@typescript/vfs`, `@typescript/twoslash`, `@typescript/ata`) are published npm packages.

---

## 2. Feature / Panel Reference

### The Editor

**Description:** A Monaco editor (the same engine as VS Code) wired to the in-browser TypeScript language service. Provides syntax highlighting, autocomplete, quick-info on hover, signature help, and live diagnostics.

| Feature | Behavior | Source |
|---------|----------|--------|
| Live type-checking | Re-checks on every edit via the language service | [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) |
| Hover quick-info | Calls `getQuickInfoAtPosition` | Compiler API |
| Autocomplete | Calls `getCompletionsAtPosition` | Compiler API |

### Output Tabs

| Tab | Shows | Underlying API |
|-----|-------|----------------|
| `.JS` | Compiled JavaScript | `getEmitOutput` (JS files) |
| `.D.TS` | Generated declarations | `getEmitOutput` (declaration emit) |
| **Errors** | All diagnostics, formatted | `getSemanticDiagnostics` + `getSyntacticDiagnostics` |
| **Logs** | `console.*` output after Run | Sandboxed evaluation of emitted JS |
| **Plugins** | AST viewer, type explorers, etc. | Sandbox plugin API |

### Menus & Controls

| Control | Purpose |
|---------|---------|
| **TS Config** | Toggle/select compiler options (mirrors `tsconfig.json`) |
| **Version dropdown** | Select a released version or **Nightly** |
| **Examples** | Curated, runnable sample gallery |
| **Share** | Copy the deep-link URL (or shortlink) |
| **Run** | Execute the emitted JavaScript |

---

## 3. Core Concepts & Rules

### Rule 1: The Playground Runs the Real Compiler in the Browser

> *Docs: [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) — the Sandbox loads the TypeScript compiler and runs it client-side.*

There is no server-side type-checking. The selected version's `typescript.js` bundle is loaded into the browser, so diagnostics and emit match `tsc` of that version exactly.

```typescript
// ✅ Correct mental model — results equal `tsc <selected version>`
const x: number = 1;

// ❌ Incorrect — assuming it merely "simulates" type-checking
```

### Rule 2: Type Errors Do Not Block Execution

> *Docs: [Handbook — Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) — types are erased; JS is emitted even with errors unless `noEmitOnError`.*

```typescript
// ✅ Correct — code runs despite the error
let n: number = "oops";
console.log(n); // logs "oops" when Run

// ❌ Incorrect — expecting Run to refuse to execute
```

### Rule 3: No Real File System or npm Packages

> *Docs: [dev/typescript-vfs](https://www.typescriptlang.org/dev/typescript-vfs/) — files live in an in-memory virtual file system.*

```typescript
// ❌ Incorrect — there is no node_modules to resolve from at runtime
import express from "express"; // module-not-found / runtime failure

// ✅ Correct — inline the behavior, or use a type-only ATA import
function add(a: number, b: number) {
  return a + b;
}
```

### Rule 4: State Lives in the URL

> *Docs: [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) — code is compressed into the hash; options/version into the query string.*

```typescript
// ✅ Sharing the URL shares code + options + version, with no server upload
const note = "the URL is the document";
```

---

## 4. Compiler Options Exposed in the UI

> From: [tsconfig reference](https://www.typescriptlang.org/tsconfig)

The Playground exposes the same options as `tsconfig.json`. The most commonly used:

| Option | Type | Default (Playground) | Effect |
|--------|------|----------------------|--------|
| `target` | `ES3`…`ESNext` | ES-recent | JavaScript version emitted |
| `module` | `CommonJS`/`ESNext`/… | varies | Module format of emit |
| `strict` | `boolean` | often on | Enables all strict checks |
| `strictNullChecks` | `boolean` | from `strict` | `null`/`undefined` not freely assignable |
| `noImplicitAny` | `boolean` | from `strict` | Error on inferred `any` |
| `noUncheckedIndexedAccess` | `boolean` | off | `arr[i]` is `T | undefined` |
| `jsx` | `preserve`/`react`/`react-jsx` | — | JSX emit strategy (use `.tsx`) |
| `lib` | string[] | from `target` | Built-in type libraries available |
| `declaration` | `boolean` | on (for `.D.TS`) | Emit declaration files |
| `exactOptionalPropertyTypes` | `boolean` | off | Optional ≠ explicitly `undefined` |

```typescript
// Demonstrates strictNullChecks (set via the Config menu)
function len(s: string | null) {
  return s.length; // error when strictNullChecks is ON
}
```

---

## 5. Behavioral Specification

### Type-Checking Model

Type-checking is **incremental and continuous**, driven by the language service. Each edit triggers re-checking of affected regions; diagnostics update live, identically to the editor experience in VS Code.

### Emit Model

The `.JS` and `.D.TS` tabs are produced by the emitter. Emit reflects `target`, `module`, `jsx`, and related options. Declaration emit (`.D.TS`) includes only the public/declared surface, with implementations stripped.

### Execution Model

**Run** evaluates the emitted JavaScript in a sandboxed browser context. `console.*` calls are intercepted and routed to the Logs tab. No Node globals (`process`, `require`, `Buffer`, `fs`) are available. Asynchronous code runs, but with browser, not Node, semantics.

### Type Acquisition Model

Type-only imports of supported packages are resolved through **Automatic Type Acquisition** (`@typescript/ata`), which fetches `.d.ts` files into the VFS. Executable package code is not fetched — type-checking works; running the package's code does not.

```typescript
// Type-only import resolved by ATA; runtime code is NOT loaded.
import type { CSSProperties } from "react";
const style: CSSProperties = { color: "red" }; // type-checks
```

### Sharing Model

Sharing is **serverless**. The compiler options and the selected version are serialized into the URL query string; the source code is compressed (LZ-based) into the URL hash fragment (`#code/...`). The hash is never transmitted to the server, so the code stays on the client. For snippets that exceed URL length limits, the Playground offers shortlink/Gist-backed sharing.

```typescript
// Conceptually, the link is built from three parts:
// origin + "/play" + "?<options>&ts=<version>" + "#code/<compressed-source>"
const note = "options in the query, code in the hash";
```

### Version Model

Selecting a version downloads that version's `typescript.js` bundle plus the matching built-in `lib.*.d.ts` files, recreates the language service, and re-checks the current code. **Nightly** points at the latest main-branch development build, equivalent to `typescript@next`.

---

## 6. Browser / Platform Compatibility

| Feature | Chrome | Firefox | Safari | Edge | Notes |
|---------|--------|---------|--------|------|-------|
| Editor + type-checking | ✅ | ✅ | ✅ | ✅ | Requires modern JS engine (Monaco) |
| Run (eval emitted JS) | ✅ | ✅ | ✅ | ✅ | Browser sandbox, no Node globals |
| Version switching | ✅ | ✅ | ✅ | ✅ | Network fetch of compiler bundle |
| ATA (package types) | ✅ | ✅ | ✅ | ✅ | Needs network to types CDN |
| Deep-link sharing | ✅ | ✅ | ✅ | ✅ | URL length limits for huge snippets |

The Playground is a client-side web app; a modern desktop browser is recommended. Mobile browsers work for viewing/reading but are awkward for editing.

---

## 7. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| Code has type errors | JS still emits and runs (no `noEmitOnError` by default) | [Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) |
| `import` of unsupported package | Type resolution fails (ATA has nothing to fetch) | [ATA](https://www.npmjs.com/package/@typescript/ata) |
| Node globals at runtime | Undefined — browser sandbox, not Node | [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) |
| Very large snippet | URL may exceed limits; use shortlink/Gist sharing | [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) |
| Switching version | Reloads compiler + lib files; re-checks code | [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) |
| `const enum` / decorators | Emit reflects current options; visible in `.JS` | [tsconfig](https://www.typescriptlang.org/tsconfig) |

---

## 8. Version & Capability History

| Capability | Status | Migration / Notes |
|------------|--------|-------------------|
| Version dropdown (released versions) | ✅ Stable | Pin a version for reproductions |
| **Nightly** build | ✅ Available | Equivalent to `typescript@next` |
| AST viewer plugin | ✅ Available | Enable via Plugins settings |
| Twoslash rendering | ✅ Used across docs | `@typescript/twoslash` |
| Automatic Type Acquisition | ✅ Supported | Type-only; runtime code not loaded |
| Sandbox embedding API | ✅ Public | `@typescript/sandbox` on npm |
| Deep-link query params | ✅ Stable | `?strict=true&ts=5.4.0#code/...` |

The Playground tracks TypeScript releases: when a new TS version ships, it becomes selectable in the dropdown, and Nightly always reflects the latest main-branch build.

---

## 9. Official Examples

### Example from Docs: Erasure (Types Vanish at Runtime)

> Source: [TypeScript Handbook — The Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html)

```typescript
interface User {
  name: string;
}

const user: User = { name: "Ada" };
console.log(typeof user); // "object" — there is no "User" at runtime
```

**Result (Logs tab):**

```
"object"
```

The `.JS` tab confirms the `interface` is entirely gone in the output.

### Example from Docs: Strict Null Checking

> Source: [Handbook — Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

```typescript
function printLength(value: string | null) {
  if (value !== null) {
    console.log(value.length); // narrowed to string here
  }
}

printLength("hello"); // 5
printLength(null);    // (no log)
```

**Result (Logs tab):**

```
5
```

---

## 10. URL & Deep-Link Reference

> Source: [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/)

| URL part | Carries | Example |
|----------|---------|---------|
| Query string | Compiler options + version | `?strict=true&target=99&ts=5.4.0` |
| Hash `#code/...` | Compressed source text | `#code/PTAEHU...` |
| Hash `#example/...` | A gallery example id | `#example/generic-functions` |

```typescript
// A configured deep link can pre-set flags, version, and code:
// https://www.typescriptlang.org/play?strictNullChecks=true&ts=5.4.0#code/<encoded>
const note = "construct links to ship preconfigured examples in docs";
```

The hash fragment is never transmitted to the server, keeping code client-side.

---

## 11. Twoslash Directive Reference

> Source: [shikijs.github.io/twoslash](https://shikijs.github.io/twoslash/)

| Directive | Purpose | Example |
|-----------|---------|---------|
| `// ^?` | Render the type of the identifier above the caret | shows `const x: number` |
| `// @errors: <codes>` | Assert specific diagnostic codes occur | `// @errors: 2322` |
| `// @filename: <name>` | Start a new virtual file (multi-file) | `// @filename: app.ts` |
| `// @strict: true/false` | Set a compiler flag for the sample | `// @strict: false` |
| `// @noErrors` | Suppress error reporting for the sample | — |
| `// ---cut---` | Hide everything above this line from output | trims setup |

```typescript
// @errors: 2345
declare function greet(name: string): void;
greet(42);
//    ^^ asserted error 2345

const total = 1 + 2;
//    ^? const total: number
```

Twoslash runs the real compiler, so these annotations are verified at build time — examples that drift fail the build.

---

## 11b. Sandbox & VFS API Reference (Embedding)

> Source: [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/), [dev/typescript-vfs](https://www.typescriptlang.org/dev/typescript-vfs/)

The Playground is built on published packages that you can embed in your own pages.

| Package | Role |
|---------|------|
| `@typescript/sandbox` | Monaco editor wired to an in-browser TypeScript compiler |
| `@typescript/vfs` | In-memory virtual file system backing the compiler |
| `@typescript/ata` | Automatic Type Acquisition for type-only package imports |
| `@typescript/twoslash` | Batch tool extracting verified types/errors for docs |

### Sandbox Surface (illustrative)

```typescript
// The sandbox exposes the compiler and editor so you can query the program.
interface PlaygroundSandbox {
  editor: unknown;                       // Monaco editor instance
  ts: typeof import("typescript");       // the loaded compiler API
  getText(): string;                     // current source
  setText(value: string): void;          // replace source
  getEmitResult(): Promise<{
    outputFiles: { name: string; text: string }[];
  }>;                                    // JS + .d.ts
  getAST(): import("typescript").SourceFile;
}
```

### VFS Surface (illustrative)

```typescript
// The VFS is just a Map of filename -> contents, plus a System shim.
type FileMap = Map<string, string>;

// Built-in lib files (lib.es2022.d.ts, lib.dom.d.ts, ...) are loaded into the
// map so global types resolve; your editor file is one more entry.
declare function createSystem(files: FileMap): unknown;
```

These APIs are why third-party sites (and the docs' interactive examples) can host the same editing experience as the official Playground.

---

## 11c. Plugins Specification

> Source: [dev/sandbox plugins](https://www.typescriptlang.org/dev/playground-plugins/)

The Playground supports plugins — additional panels in the right-hand area. Official/community plugins include:

| Plugin | Purpose |
|--------|---------|
| **AST Viewer** | Renders the parser's `SourceFile` tree; click source to highlight nodes |
| **Type explorers** | Query the `TypeChecker` for the type of any node |
| **Emit/Show JS** | Fine-grained inspection of emitted output |
| **Custom plugins** | Authored via the plugin API and loaded by name |

```typescript
// A plugin receives the sandbox and can read the program/AST/types.
// Conceptually:
interface PlaygroundPlugin {
  id: string;
  displayName: string;
  didMount(sandbox: unknown, container: HTMLElement): void;
}
```

---

## 12. Compliance Checklist

- [ ] Reproductions pin a specific TS version via the version dropdown / `ts=` param.
- [ ] Shared links include the compiler options needed to show the behavior.
- [ ] Examples rely only on inline code or supported type-only imports (no npm runtime).
- [ ] Documentation examples use Twoslash so they stay compiler-verified.
- [ ] Node-specific code is not expected to run (browser sandbox only).
- [ ] Large snippets use shortlink/Gist sharing to avoid URL limits.
- [ ] The `.D.TS` tab is checked when auditing a library's public surface.

---

## 13. Related Documentation

| Topic | Doc Section | URL |
|-------|-------------|-----|
| Playground | Live editor | [typescriptlang.org/play](https://www.typescriptlang.org/play) |
| Sandbox / embedding | Dev tooling | [typescriptlang.org/dev/sandbox](https://www.typescriptlang.org/dev/sandbox/) |
| Virtual file system | Dev tooling | [typescriptlang.org/dev/typescript-vfs](https://www.typescriptlang.org/dev/typescript-vfs/) |
| Twoslash | Docs rendering | [shikijs.github.io/twoslash](https://shikijs.github.io/twoslash/) |
| Compiler options | tsconfig reference | [typescriptlang.org/tsconfig](https://www.typescriptlang.org/tsconfig) |
| Compiler API | Wiki | [Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) |
| Handbook | Language reference | [typescriptlang.org/docs/handbook](https://www.typescriptlang.org/docs/handbook/intro.html) |

---

> **Content Rules applied for this `specification.md`:**
> - Linked directly to relevant official doc sections.
> - Documented the Playground's behavioral model (type-check, emit, run, ATA).
> - Listed compiler options, edge cases, and the deep-link/Twoslash references.
> - Used official TypeScript behavior; no invented features.
> - Included browser compatibility and capability history tables.

---

## Appendix A: Compiler Option Quick Reference (Most-Used in the Playground)

> Source: [tsconfig reference](https://www.typescriptlang.org/tsconfig)

```typescript
// Each of these is a toggle/picker in the Playground's TS Config menu.
// strict:                     enables the strict family below
// strictNullChecks:           null/undefined not freely assignable
// noImplicitAny:              error on inferred 'any'
// noUncheckedIndexedAccess:   arr[i] -> T | undefined
// exactOptionalPropertyTypes: optional !== explicitly undefined
// target:                     ES3..ESNext (controls emit + default lib)
// module:                     CommonJS / ESNext / NodeNext ...
// moduleResolution:           classic / node / bundler / nodenext
// jsx:                        preserve / react / react-jsx (use .tsx)
// lib:                        which built-in type libraries are available
// declaration:                emit .d.ts (drives the .D.TS tab)
const optionsAreUiToggles = true;
```

| Option | Common reason to change it in the Playground |
|--------|----------------------------------------------|
| `strict` | Match a project that runs strict mode |
| `noUncheckedIndexedAccess` | Reproduce index-access undefined errors |
| `target` | See how a feature downlevels in the `.JS` tab |
| `jsx` | Explore JSX emit strategies in `.tsx` mode |
| `lib` | Add/remove DOM or newer ES APIs |
| `exactOptionalPropertyTypes` | Reproduce strict optional-property behavior |

---

## Appendix B: Limitations Specification

> Source: [dev/sandbox](https://www.typescriptlang.org/dev/sandbox/), [dev/typescript-vfs](https://www.typescriptlang.org/dev/typescript-vfs/)

| Limitation | Why it exists | Workaround |
|------------|---------------|------------|
| Single file | The VFS holds one editor file | Use multi-file Twoslash for docs; StackBlitz for projects |
| No npm runtime | No `node_modules`; ATA fetches types only | Inline behavior; StackBlitz/CodeSandbox |
| No Node globals at Run | Browser sandbox, not Node | Run locally or in a Node container |
| No real file system | In-memory VFS only | Local `tsc` for file-system work |
| URL length limits | State lives in the URL | Shortlink/Gist sharing for large snippets |

---

## Appendix: Quick Specification Summary

- The Playground is the official, open-source, browser-based TypeScript editor on `typescriptlang.org`.
- It runs the real compiler client-side; behavior equals `tsc` for the selected version (or Nightly).
- Output tabs (`.JS`, `.D.TS`, Errors, Logs) and the Plugins panel surface compiler APIs.
- Compiler options mirror `tsconfig.json` and are set through the UI; they encode into the URL.
- Sharing is serverless: code compresses into the URL hash, options/version into the query.
- Type-only package imports work via Automatic Type Acquisition; runtime package code does not load.
- Twoslash provides compiler-verified, annotated examples for documentation.
- Limits: single file, no npm runtime, no Node globals, no real file system.

---

## Appendix C: Glossary of Spec Terms

| Term | Definition |
|------|-----------|
| **Sandbox** | `@typescript/sandbox` — Monaco editor + in-browser compiler |
| **VFS** | `@typescript/vfs` — in-memory virtual file system |
| **ATA** | Automatic Type Acquisition — fetches `.d.ts` for imports |
| **Language service** | Incremental, editor-oriented compiler API (hover, completions, diagnostics) |
| **Batch compiler** | `ts.createProgram` — one-shot build path |
| **Lib files** | `lib.*.d.ts` declaring built-in globals (`Array`, `document`) |
| **Twoslash** | Tool extracting verified types/errors for rendered docs |
| **Nightly** | Latest main-branch dev build (≈ `typescript@next`) |
| **Deep link** | URL pre-setting code + options + version |
| **Declaration emit** | Producing `.d.ts` (the `.D.TS` tab) |

---

## Appendix D: Conformance Examples

### Conformance: Emit Reflects `target`

> Source: [tsconfig — target](https://www.typescriptlang.org/tsconfig#target)

```typescript
// At target ES5 this class downlevels to a function + prototype.
// At target ESNext it remains a class. Verify in the .JS tab.
class Counter {
  #count = 0;
  inc() {
    this.#count++;
  }
}
```

### Conformance: Declaration Emit Excludes Bodies

> Source: [tsconfig — declaration](https://www.typescriptlang.org/tsconfig#declaration)

```typescript
export function add(a: number, b: number): number {
  return a + b;
}
// .D.TS tab: export declare function add(a: number, b: number): number;
```

### Conformance: Diagnostics Match `tsc`

> Source: [Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

```typescript
const n: number = "x";
// Errors tab: Type 'string' is not assignable to type 'number'. (2322)
// Identical message and code to running `tsc` of the same version.
```

These conformance examples can be pasted into the Playground to verify that its behavior matches the official specification for the selected version.
