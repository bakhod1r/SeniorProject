# Capability-Based Security — Hands-On Tasks

> **Topic:** [Capability-Based Security](README.md)

---

## Introduction

Reading about capabilities convinces no one; *feeling* the confused deputy bite and then watching a capability make it impossible does. These exercises are deliberately hands-on and language-light — you can do them in JavaScript/TypeScript, Python, Go, or Rust, swapping the ambient-authority source (`fs`/`net`/`os`) for whatever your language calls it. The goal is muscle memory: the import-to-inject refactor, the facet/attenuation reflex, the caretaker-vs-membrane judgment, and the macaroon caveat discipline.

Work top to bottom. Each task has a **self-check** (how you know you're done), a **hint** (collapsed reasoning if you're stuck), and, for the harder ones, a **sparse solution** that gives the shape, not the full code. Don't read the solution until your self-check fails twice. The Capstone ties everything into one POLA redesign with a capability-flow diagram, which is exactly the artifact you'd produce in a real security review.

Grading: **Warm-Up** builds intuition, **Core** is the must-do skill set every senior should have, **Advanced** is staff-level depth, and the **Capstone** is a portfolio-worthy exercise.

---

## Warm-Up

### Task W1 — Spot the ambient authority

Take any module you've written recently (or this snippet) and list every place it exercises *ambient authority* — power it took without being handed it.

```js
import fs from 'node:fs';
import https from 'node:https';

export function backup(name, data) {
  fs.writeFileSync(`/backups/${name}`, data);
  https.get(`https://audit.internal/log?file=${name}`);
  console.log(process.env.BACKUP_KEY);
}
```

**Self-check:** You should find at least four: `fs` (whole filesystem), `https` (network egress), `process.env` (all secrets), and arguably `console`. For each, state what a *compromise of this file or anything it imports* could do with that authority.

<details><summary>Hint</summary>

Ambient authority = anything reachable without a parameter. Ask of each line: "did a caller grant this, or did the module grab it?" Every `import` of an I/O module, every global (`process`, `console`, `globalThis`), every singleton client is ambient.

</details>

---

### Task W2 — Read-only facet by hand

Given a mutable object, hand out a *read-only facet* — an object exposing only the read operations — without copying the data.

```js
const account = {
  balance: 100,
  deposit(n) { this.balance += n; },
  withdraw(n) { this.balance -= n; },
};
// Produce `readOnly` such that readOnly.balance works but
// readOnly.deposit / readOnly.withdraw do NOT exist.
```

**Self-check:** `readOnly.balance === 100` is true; `typeof readOnly.deposit === 'undefined'`; and a later `account.deposit(50)` is reflected in `readOnly.balance` (it's a *view*, not a copy).

<details><summary>Hint</summary>

A facet exposes a *subset* of operations. Either build a small object with a getter that forwards to `account`, or use a `Proxy` whose `get` trap returns only whitelisted keys. The security is in the *omission* of `deposit`/`withdraw`.

</details>

---

### Task W3 — Name the revocation tool

For each scenario, decide whether a **caretaker** (revokes one object) or a **membrane** (revokes a whole reachable subgraph) is correct, and say why in one sentence.

1. You grant a plugin a single `Logger` object with one `log(msg)` method.
2. You grant a tenant a `Database` object whose `.table(name)` returns `Table` objects that return `Row` objects.
3. You grant a function a one-shot `readConfig()` capability.
4. You grant an extension a reference to your editor's `Document` tree, which it will navigate node by node.

**Self-check:** 1 and 3 are caretakers (the granted object vends nothing meaningful); 2 and 4 are membranes (the granted object vends other capability-bearing objects that a caretaker's revocation would miss).

---

## Core

### Task C1 — Reproduce the confused deputy, then fix it with a capability

Build the classic confused deputy, watch it misbehave, then close it with a capability.

**Part A — reproduce.** Write a "report exporter" that runs with authority to write anywhere, and accepts an *output path* from a caller:

```js
// Deputy: has ambient write authority. Accepts a path from the (untrusted) caller.
import fs from 'node:fs';
function exportReport(outputPath, contents) {
  fs.writeFileSync(outputPath, contents); // uses DEPUTY's authority on CALLER's say-so
}
// Attacker call: overwrite a privileged file the caller could never write directly.
exportReport('/etc/app/billing.lock', 'corrupted');
```

Confirm (in a sandbox dir, using a fake "privileged" file) that the attacker can overwrite a file they had no authority over.

**Part B — fix.** Redesign so the caller must present a *write capability* for the destination instead of a path. The caller can only hold a write capability for places it's already authorized to write, so it can't designate the privileged file.

**Self-check:** After the fix, the attacker call cannot even *name* the privileged destination — there's no path parameter, only a capability they don't possess. The deputy can write *only* where the caller had a capability.

<details><summary>Hint</summary>

The bug is that designation (the path) is separated from authority (the deputy's ambient `fs`). Fuse them: `exportReport(destCap, contents)` where `destCap.write(contents)` is bound to one already-authorized location. The caller obtains `destCap` only from a powerbox that checks authority *at grant time*.

</details>

<details><summary>Sparse solution</summary>

```js
// Powerbox: the ONLY place with ambient fs; mints write capabilities after an authz check.
function grantWriteCap(requester, dest) {
  if (!authorized(requester, dest)) throw new Error('denied');
  return { write: (contents) => fs.writeFileSync(dest, contents) }; // bound to `dest`
}
// Deputy now takes a CAPABILITY, not a path:
function exportReport(destCap, contents) { destCap.write(contents); }
// Attacker has no cap for billing.lock (authz check would have failed), so it can't be designated.
```

The deputy is no longer confused because it cannot act on anything the caller didn't already hold a capability for.

</details>

---

### Task C2 — Refactor ambient `fs` to an injected directory capability

Take a module that imports `fs` and reaches across the whole disk, and convert it to *receive* a directory capability bound to one directory.

```js
// BEFORE
import { readFileSync } from 'node:fs';
export function loadTemplate(name) {
  return readFileSync(`/app/templates/${name}.html`, 'utf8');
}
```

Requirements:
1. The module no longer imports `fs`.
2. It receives a `dir` capability and can only read within the bound directory.
3. A path-traversal attempt (`name = '../../etc/passwd'`) must fail.
4. The powerbox (your `main`) is the only place that opens the directory.

**Self-check:** `loadTemplate` has no `fs` import; calling it with a traversal name throws or is rejected; and you can prove (by reading the signature) exactly what authority the function holds — only `dir`.

<details><summary>Hint</summary>

Build a `openDirCap(root)` factory in a `platform` module: it returns `{ read(name) }` that resolves `name` against `root`, *rejects* any resolved path that escapes `root` (normalize and check the prefix), and reads it. Inject the returned cap into `loadTemplate`.

</details>

<details><summary>Sparse solution</summary>

```js
// platform/fs-cap.js  (the ONLY module that imports fs)
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
export function openDirCap(root) {
  const base = resolve(root);
  return {
    read(name) {
      const p = resolve(base, name);
      if (p !== base && !p.startsWith(base + sep)) throw new Error('escapes capability');
      return readFileSync(p, 'utf8');
    },
  };
}
// business module — no fs:
export function loadTemplate(dir, name) { return dir.read(`${name}.html`); }
// main (powerbox):
const templates = openDirCap('/app/templates');
loadTemplate(templates, 'invoice');
```

Add a CI lint rule banning `node:fs` outside `platform/` to keep the boundary from eroding.

</details>

---

### Task C3 — Implement a revocable capability (caretaker)

Wrap a capability so it can be granted now and *revoked* later, with all subsequent use throwing.

```js
// makeCaretaker(target) => { facet, revoke }
// facet behaves like target until revoke() is called; afterward every use throws.
```

**Self-check:** `facet.someMethod()` works before `revoke()`; after `revoke()`, any access throws `revoked`; and the original `target` is never handed to the holder (only `facet`).

<details><summary>Hint</summary>

Keep a boolean `live`. The facet forwards to `target` while `live`, throws otherwise. A `Proxy` with `get`/`apply` traps that check `live` is the cleanest form. Note this only protects `target` itself — see C4 for why that's not enough when `target` vends objects.

</details>

<details><summary>Sparse solution</summary>

```js
function makeCaretaker(target) {
  let live = true;
  const facet = new Proxy(target, {
    get(t, p) { if (!live) throw new Error('revoked'); return t[p]; },
    apply(t, self, args) { if (!live) throw new Error('revoked'); return t(...args); },
  });
  return { facet, revoke: () => { live = false; } };
}
```

</details>

---

### Task C4 — Show the caretaker leak, then fix it with a membrane

Demonstrate that a caretaker fails to revoke *transitively-vended* objects, then build a membrane that fixes it.

**Part A — the leak.** Use your C3 caretaker on a `db` object whose `.table('orders')` returns a `Table` whose `.row(1)` returns a `Row`. Obtain a `Row` through the caretaker'd `db`, then `revoke()`, and show the `Row` *still works*.

**Part B — the fix.** Implement `makeMembrane(target)` that wraps every object crossing the boundary (arguments in, results out) with the same revocation switch, so revoking severs `db`, `table`, and `row` at once.

**Self-check:** In Part A, the previously-obtained `Row` keeps working after revocation (the leak). In Part B, after `revoke()`, the *same* previously-obtained wrapped `Row` throws.

<details><summary>Hint</summary>

The membrane's rule: in the `get`/`apply` traps, don't just check `live` — recursively `wrap()` whatever you return (and whatever is passed in), reusing a `WeakMap` so identity is stable. Because returned objects are themselves wrapped by the same membrane, flipping `live` kills the entire reachable subgraph.

</details>

<details><summary>Sparse solution</summary>

```js
function makeMembrane(target) {
  let live = true;
  const seen = new WeakMap();
  const wrap = (o) => {
    if (Object(o) !== o) return o;
    if (seen.has(o)) return seen.get(o);
    const px = new Proxy(o, {
      get(t, p) { if (!live) throw new Error('revoked'); return wrap(t[p]); },
      apply(t, s, a) { if (!live) throw new Error('revoked'); return wrap(t(...a.map(wrap))); },
    });
    seen.set(o, px);
    return px;
  };
  return { facet: wrap(target), revoke: () => { live = false; } };
}
```

The difference from C3 is the single word `wrap` around returns and args — that's what makes revocation transitive.

</details>

---

### Task C5 — Build an attenuating wrapper (read-only view of a read-write resource)

Given a read-write key-value store, produce a *read-only attenuated* capability that exposes `get` but makes `set`/`delete` unreachable — without copying the data.

```js
const store = new Map();
// readView = attenuate(store): readView.get(k) works; readView.set / .delete do not exist.
```

Then go further: produce a `prefixView(store, 'tenant42:')` that can read/write *only* keys under one prefix (attenuation by *scope*, not just operation).

**Self-check:** `readView.set` is `undefined`; `readView.get('x')` reflects later writes via the real `store` (it's a view); `prefixView` rejects `get`/`set` on keys outside its prefix.

<details><summary>Hint</summary>

Attenuation = expose a *smaller* interface. For read-only, return `{ get: (k) => store.get(k) }`. For the prefix scope, wrap each operation to prepend/validate the prefix and reject keys outside it — the absence of access to other prefixes is the security.

</details>

---

### Task C6 — Design a macaroon with caveats

Implement a minimal macaroon: mint with a root key, attenuate offline by adding caveats, and verify by re-deriving the chain *and checking every caveat*.

Requirements:
1. `mint(rootKey, identifier)` → macaroon with empty caveats.
2. `addCaveat(macaroon, caveatString)` → strictly weaker macaroon, *no root key needed* (offline).
3. `verify(rootKey, macaroon, context)` → re-derives the HMAC chain, then evaluates each caveat against `context`.
4. Support at least `expires < T` and `object = N` caveats.

**Then prove the trap:** write a `verifyBuggy` that checks the signature but *skips* the caveat evaluation, and a test minting an *expired* token that `verifyBuggy` wrongly accepts but `verify` rejects.

**Self-check:** Adding a caveat needs no root key; you cannot remove a caveat and still verify (HMAC one-way); `verify` rejects an expired or wrong-object request; and your test demonstrates `verifyBuggy` accepting a token `verify` rejects — proving security lives in the verifier.

<details><summary>Hint</summary>

Signature: `sig = HMAC(rootKey, identifier)`, then for each caveat `sig = HMAC(sig, caveat)`. `addCaveat` just re-HMACs the current sig — no root key. `verify` recomputes from the root, `compare_digest`s the sig, then loops the caveats evaluating each (`expires < T` against `context.now`, `object = N` against `context.object`) and *fails closed* on any caveat it doesn't recognize.

</details>

<details><summary>Sparse solution</summary>

```python
import hmac, hashlib
def _sig(key, ident, caveats):
    s = hmac.new(key, ident.encode(), hashlib.sha256).digest()
    for c in caveats: s = hmac.new(s, c.encode(), hashlib.sha256).digest()
    return s
def mint(root, ident): return {"id": ident, "caveats": [], "sig": _sig(root, ident, [])}
def add_caveat(m, c):  # OFFLINE: no root key
    return {"id": m["id"], "caveats": m["caveats"]+[c],
            "sig": hmac.new(m["sig"], c.encode(), hashlib.sha256).digest()}
def verify(root, m, ctx):
    if not hmac.compare_digest(_sig(root, m["id"], m["caveats"]), m["sig"]): return False
    for c in m["caveats"]:                       # <-- the step verify_buggy omits
        if not check(c, ctx): return False       # fail CLOSED on unknown caveats
    return True
```

`check` parses `"expires < 123"` / `"object = 42"` and compares against `ctx`. The buggy version returns `True` right after the signature check.

</details>

---

## Advanced

### Task A1 — Confine a dependency in an SES Compartment (or your language's sandbox)

Run a piece of "untrusted" pure-computation code (e.g., a tiny markdown-to-HTML function) so that it *cannot* reach the network or filesystem even if it tries.

Requirements:
1. `lockdown()` (SES) or your runtime's equivalent before running guest code.
2. The guest runs in a Compartment endowed with *nothing dangerous* — no `fetch`, no `fs`, no `process`.
3. Inside the guest, attempt `fetch(...)` and `process.env` and confirm both throw `ReferenceError` (the names don't exist).
4. The guest still successfully transforms its input (proving it works with zero ambient authority).

**Self-check:** The guest's malicious attempts fail with "not defined" while its legitimate computation succeeds — demonstrating *containment, not detection*: you didn't scan the code, you removed the path.

<details><summary>Hint</summary>

`import 'ses'; lockdown();` then `const c = new Compartment({ /* only safe endowments */ }); c.evaluate(guestSource)`. The guest's `fetch`/`process` references resolve to nothing because the Compartment's global scope doesn't include them. If you're not in JS, use a subprocess with a seccomp/Landlock profile, or a WASI module with no socket/preopen, to achieve the same.

</details>

---

### Task A2 — WASI preopen sandbox

Compile a small program to WebAssembly/WASI that tries to read a file by path, and demonstrate the capability-filesystem behavior under three host configurations.

Run it three ways with a WASI runtime (e.g., `wasmtime`):
1. **No `--dir`** — the program's `open` of any path fails (no filesystem capability at all).
2. **`--dir /sandbox`** — it can read files under `/sandbox` only; an attempt to read `/etc/passwd` fails.
3. **`--dir /`** (the anti-pattern) — it reads `/etc/passwd` successfully.

**Self-check:** You can articulate why case 3 is a *host misconfiguration*, not a WASI weakness: the sandbox is exactly as tight as the host's grant, and `--dir /` hands the module the whole disk.

<details><summary>Hint</summary>

Write the program to `open`/read a path passed as an argument and print the result or the error. The WASM module itself is identical across all three runs; only the host's preopen grants differ. That's the whole lesson — authority lives in the host's grant, not the module.

</details>

---

### Task A3 — Add a CI lint rule that enforces a capability boundary

A retrofit only holds if ambient authority can't creep back. Add a *mechanical* enforcement so the next contributor cannot re-import ambient authority into the confined layer.

Requirements:
1. Identify your "business layer" directory (the confined modules).
2. Add a lint rule (e.g., ESLint `no-restricted-imports`, or a custom grep-based CI check) that *fails the build* if any file in that directory imports `fs`/`net`/`http`/`child_process`.
3. Allow those imports only in your `platform`/powerbox directory.
4. Write a test/commit that *intentionally* violates the rule and confirm CI rejects it.

**Self-check:** The intentional violation fails CI with a clear message; the powerbox directory is unaffected; and you can explain why this turns a *discipline* (code review might catch it) into a *guarantee* (CI always catches it).

---

### Task A4 — Third-party caveat (cross-service composition)

Extend your C6 macaroon library with a *third-party caveat*: a caveat that the macaroon is valid only if the holder also presents a **discharge macaroon** from another service proving a predicate.

Requirements:
1. `addThirdPartyCaveat(macaroon, location, predicate)` adds the caveat and records what discharge is required.
2. The third party (a separate function) issues a discharge macaroon if the predicate holds.
3. `verify` now requires *both* the original macaroon and the matching discharge macaroon, and checks them together.

**Self-check:** Without the discharge macaroon, verification fails; with a valid discharge, it passes; and you can explain how this composes authority across two services *without them sharing a session store* (the proof travels with the request).

<details><summary>Hint</summary>

This is the trickiest macaroon mechanic. The third-party caveat binds a secret shared between issuer and the third party; the discharge macaroon is built from that secret and must be cryptographically bound to the root macaroon (so a discharge for one macaroon can't be replayed on another). Keep it conceptual if the binding is too deep — the *interface* and the *trust property* are what matters for the exercise.

</details>

---

## Capstone

### Task CAP1 — Redesign a small app's authority model around POLA, with a capability-flow diagram

Take a small but realistic app — pick one:

- A **plugin host** that runs user-supplied transformers over uploaded files.
- A **multi-tenant** note-taking API.
- A **CI runner** that executes user-provided build steps.

Produce a complete POLA redesign:

1. **Authority inventory.** List every ambient authority the current (or naive) design relies on (`fs`, `net`, `env`, DB client, current-user thread-local). For each, note what a compromise could reach.
2. **Powerbox design.** Define the single place that holds broad authority and what narrowed capabilities it mints for each component.
3. **Per-component capability set.** For each module/plugin/tenant path, list *exactly* the capabilities it receives — and prove it cannot exceed them.
4. **Attenuation & revocation plan.** Where do you attenuate (read-only facets, scoped stores, macaroon caveats)? Where do you need a *membrane* vs a caretaker, and why?
5. **Supply-chain story.** Which dependencies are confined (no socket/fs) and which are trusted? Justify the split.
6. **Confused-deputy audit.** Identify every place the old design forwarded identity or accepted a designator from an untrusted caller, and show the capability that removes the confused deputy.
7. **Capability-flow diagram.** Draw (ASCII is fine) the flow of authority: powerbox at the top, arrows showing which capability each component receives, where membranes wrap subgraphs, and where macaroons cross service boundaries.

**Self-check (your design is done when):**
- Every component's authority is readable from *what it's handed*, not from reading its body.
- You can answer "could component X reach resource Y?" with a yes/no by tracing the diagram, not by auditing code.
- Every confused-deputy edge in the old design is closed by a capability in the new one.
- Revocation is *transitive* wherever a granted object vends other objects (you used a membrane, not a caretaker).
- The supply-chain split is explicit: pure-computation deps hold no I/O capability.

<details><summary>Hint — the diagram shape</summary>

```
                 +------------------ POWERBOX (main) ------------------+
                 |  holds: fs, net, env, root macaroon key, db client  |
                 +----+----------------+------------------+------------+
                      |                |                  |
            openDirCap('/uploads')   scopedDb(tenant)   mintMacaroon(scope)
                      |                |                  |
                      v                v                  v
                 +---------+      +-----------+      +-------------------+
                 | plugin  |      | tenant    |      | partner integ.   |
                 | (SES    |      | handler   |      | (gets attenuated  |
                 | compart)|      | (membrane |      |  macaroon, can't  |
                 | NO net  |      |  over db) |      |  widen authority) |
                 +---------+      +-----------+      +-------------------+
```

Annotate each arrow with the *exact* capability and its attenuation. The diagram *is* your security argument.

</details>

---

## Self-Assessment Checklist

By the end you should be able to, without notes:

- [ ] Reproduce the confused deputy and explain *why* fusing designation with authority removes it.
- [ ] Refactor an `import fs` module into one that *receives* a directory capability, with traversal rejection.
- [ ] Implement a caretaker, and *demonstrate its leak* on a vended object graph, then fix it with a membrane.
- [ ] Build a read-only facet and a prefix-scoped facet (attenuation by operation and by scope).
- [ ] Implement macaroon mint/attenuate/verify, and *prove* that skipping the caveat check defeats attenuation.
- [ ] Confine an untrusted dependency so it has no path to the network — and explain "containment, not detection."
- [ ] Show the WASI preopen behavior under no-`--dir`, `--dir /sandbox`, and `--dir /`, and name which is the host's mistake.
- [ ] Enforce a capability boundary mechanically in CI so ambient authority can't creep back.
- [ ] Produce a POLA capability-flow diagram for a small app and answer reachability questions from the diagram alone.
