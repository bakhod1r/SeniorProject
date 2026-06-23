# Memento — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/memento](https://refactoring.guru/design-patterns/memento)

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What is the Memento pattern?

**A.** A behavioral pattern for capturing an object's internal state in an opaque snapshot ("Memento") so it can be restored later. Caretakers store Mementos but don't read them — only the Originator knows the format. Preserves encapsulation while enabling undo / rollback.

### Q2. Name the three roles in Memento.

**A.** **Originator** (knows state, produces and consumes Mementos), **Memento** (the snapshot, opaque to outsiders), **Caretaker** (holds Mementos but doesn't peek).

### Q3. Why is the Caretaker forbidden from reading the Memento?

**A.** Encapsulation. If the Caretaker could read internal state, the Originator's design becomes constrained — refactoring breaks the Caretaker. Opaque Mementos let the Originator change internals freely.

### Q4. What's the difference between Memento and Command?

**A.** Command is "do this action"; undo via inverse OR Memento. Memento is "this is what the state was." A Command often *uses* a Memento for undo, but they're distinct concepts.

### Q5. Give 5 real-world examples.

**A.** Editor undo/redo, game saves, database SAVEPOINT, browser history.pushState, Redux time-travel, Git commits, IDE refactor previews, form draft autosave.

### Q6. Why must Mementos be immutable?

**A.** A Memento is meant to represent state at a point in time. Mutation breaks that contract — the snapshot would change after capture. Immutable values are safe to share, store, and serialize.

### Q7. What's a "Caretaker" in Memento?

**A.** Code that stores and retrieves Mementos but doesn't open them. Examples: undo stack, save file system, browser history. Treats Mementos as opaque tokens.

### Q8. When NOT to use Memento?

**A.** State is one or two simple fields (just copy them). External resources (files, sockets) can't be snapshotted meaningfully. Action has a known inverse — Command's undo via inverse is simpler. State is huge and snapshots are too expensive.

### Q9. What's the difference between Memento and Prototype?

**A.** Prototype clones objects to create new instances (creational pattern). Memento snapshots state to restore later (behavioral pattern). Same mechanics; different intents.

### Q10. How does Memento relate to undo/redo?

**A.** Undo: restore the Originator from the Memento captured before the action. Redo: re-apply the action (or restore from the Memento captured after). Two stacks: undo and redo. New action clears redo.

---

## Middle Questions

### Q11. Full snapshot vs diff-based Memento — when each?

**A.** Full snapshot: simple, fast restore, more memory. Use when state is small. Diff (only changed fields): more compute on save and restore, much less memory. Use for large state with many small changes (editors, configuration).

### Q12. How do you bound undo history?

**A.** Cap the stack: when size exceeds N (e.g., 1000), drop the oldest. Memory is bounded; old actions become un-undoable. A common alternative: cap by total memory used (bytes).

### Q13. What's a stale Memento?

**A.** A Memento that captured a reference to a mutable object; that object changed after capture. The "snapshot" no longer represents what was there. Fix: deep-copy mutable refs at save time, or use immutable values.

### Q14. Why pair Memento with Command?

**A.** Commands describe actions; Mementos describe state. Together: Command's `execute` runs an action and snapshots state; Command's `undo` restores from the snapshot. Clean separation; reusable machinery.

### Q15. How do you persist a Memento?

**A.** Serialize to JSON / Protobuf / Avro / etc. Store in DB, file, localStorage. On restore: deserialize back to Memento; pass to Originator. Schema versioning is essential for long-lived persistent Mementos.

### Q16. Memento vs immutable record (data class)?

**A.** They're closely related. An immutable record can BE a Memento. The pattern adds the role of Caretaker — code that stores Mementos opaquely. The encapsulation contract distinguishes Memento from "just a value."

### Q17. What's a wide vs narrow Memento?

**A.** Wide: snapshot the whole Originator state. Narrow: snapshot only fields a Command will modify. Wide is safer but uses more memory; narrow is efficient but error-prone if modifications cascade.

### Q18. How does database SAVEPOINT relate to Memento?

**A.** SAVEPOINT is a Memento managed by the transaction system. The DB is the Originator; the transaction stack is the Caretaker. ROLLBACK TO restores. Same shape, transaction-system-managed.

### Q19. Memento and concurrency — what's the risk?

**A.** Snapshotting a concurrently-mutated object → torn state. Either: snapshot inside a synchronized block, or snapshot by reading an immutable atomic state. For lock-free, pair with immutable values + AtomicReference.

### Q20. How do you test a Memento?

**A.** Round-trip: create Originator, save Memento, mutate, restore from Memento, assert state matches original. For persisted Mementos: round-trip serialization → deserialization → restore.

---

## Senior Questions

### Q21. Snapshots in event sourcing — how do they fit?

**A.** Loading an aggregate by replaying every event is slow for long histories. Periodic snapshots (Mementos saved alongside events) accelerate replay: load latest snapshot + events since. Trade-off: snapshot frequency vs storage vs load latency.

### Q22. Persistent data structures and Memento?

**A.** PDS (Clojure, Scala, Immer, Immutable.js) give "free" Mementos: every modification produces a new immutable value; the old value remains valid. Memory shared via structural sharing. Time-travel debugging becomes natural.

### Q23. MVCC in databases — how is it Memento?

**A.** Each transaction sees a snapshot of the database as of its start. The DB maintains multiple row versions; readers see versions matching their snapshot. The transaction's snapshot is a Memento managed by the engine. Postgres, InnoDB use this.

### Q24. Schema evolution of persisted Mementos?

**A.** Add fields with defaults; remove fields by deprecating first. Renames: dual-name during transition. Major changes: version field; migration logic in deserializer. Schema registry (Confluent, Apicurio) enforces compatibility.

### Q25. Snapshot frequency tuning — what's the trade-off?

**A.** Frequent: storage cost; CPU cost; faster restore. Rare: less storage; longer replay; bigger working set. Tune per aggregate based on load latency requirements. Auto-tuning systems snapshot when measured load latency exceeds threshold.

### Q26. How does Redux DevTools time-travel debugging work?

**A.** Redux state is immutable; every action produces new state. DevTools captures every state. Scrubbing through history rehydrates the app to that snapshot. Possible because state is structurally shared (Immer / Immutable.js); no deep copying.

### Q27. Sensitive data in Mementos — risk?

**A.** Mementos may contain passwords, tokens, PII. If logged for debugging or persisted to insecure storage, leakage. Mitigations: mark sensitive fields explicitly; redact in logs; encrypt persistent Mementos.

### Q28. Memento with shared mutable references — how to fix?

**A.** Deep copy the reference at save time, OR capture stable identifiers (IDs) instead of references. Best: design state with immutable values throughout, so refs can be safely shared.

### Q29. How do file system snapshots (BTRFS, ZFS) work?

**A.** Copy-on-write. Snapshots are pointer-cheap: snapshot = copy the root pointer of the filesystem tree. Modifications create new branches; unchanged blocks shared. Pattern: persistent data structure at filesystem level.

### Q30. Resources in state — how to handle Memento?

**A.** Strip resources before saving (file handles, sockets, threads). Reacquire on restore. Or: model resources separately ("recipe to acquire" vs "the resource itself"). Don't snapshot transient connections.

---

## Professional Questions

### Q31. Hash Array Mapped Trie (HAMT) — how does it enable persistent maps?

**A.** Tree of 32-way nodes indexed by 5-bit chunks of hash. Modify: copy the path from root to leaf (~log32 N nodes); rest shared. Get/Set: O(log32 N) ≈ O(1) for practical N. Memory cost per modification: O(log N). Used in Clojure, Scala, Immutable.js.

### Q32. Postgres MVCC tuple visibility — explain.

**A.** Each tuple has `xmin` (creator txn) and `xmax` (deleter/updater txn). A transaction's snapshot is the active xid set at start. A tuple is visible if `xmin` committed and matches the snapshot, AND (no `xmax` or `xmax` not in snapshot). Vacuum reclaims dead tuples after no transaction needs them.

### Q33. Snapshot vs delta in event-sourced systems?

**A.** Pure snapshots: random access; high storage. Pure deltas: low storage; long restore. Mixed: full snapshot every K events, deltas in between. Restore: nearest snapshot + apply deltas. Tunes trade-off via K.

### Q34. Cost of saving a persistent map vs mutable map?

**A.** Mutable map.put: ~10-50 ns (amortized). Persistent map.assoc: ~100-200 ns (allocation + tree walk). ~2-10× slower per operation; but you get a Memento for free. For systems heavy on snapshots, the trade-off favors persistent.

### Q35. Off-heap Mementos — when?

**A.** When Memento count is huge (millions); GC pressure becomes the bottleneck. Store in `ByteBuffer` direct memory or memory-mapped file. Less GC; more manual lifecycle management. Common in databases and search engines.

### Q36. Compression strategy for archived Mementos?

**A.** zstd at level 9 for cold storage (best ratio). lz4 for hot data (fastest decompression). Delta encoding between consecutive snapshots when patterns are similar. JSON + zstd typically gives 5-10× compression.

### Q37. How does Git represent commits as Mementos?

**A.** Each commit references a tree; the tree is a Merkle DAG of file blobs. Modifications create new objects only for changed parts; rest is shared. Branches are pointers to commits. Checkout = restore tree to that commit's state.

### Q38. Java Serialization vs Protobuf for Mementos — costs?

**A.** Java Serialization: bloated bytecode, slow, schema-fragile. Protobuf: compact, fast, schema-versioned. For high-volume persistent Mementos, Protobuf typically 5-10× faster and 3-5× smaller. Avro is similar with a schema registry.

### Q39. LMDB / BoltDB COW B-trees — Memento aspect?

**A.** Each transaction starts a new COW B-tree root. Writers create new nodes; readers continue with their root. No locks for readers; high throughput. The transaction's root IS a Memento; lock-free read access.

### Q40. JIT optimization on small Mementos?

**A.** Small immutable record creation: ~10-30 ns including allocation. JIT inlines constructor for monomorphic call sites. Escape analysis may scalar-replace on the stack if Memento doesn't escape. For high-frequency snapshotting, allocation pressure matters more than dispatch.

---

## Coding Tasks

### T1. Counter with undo

A Counter class with `inc()`. Memento captures the value; restore replaces. History stack.

### T2. Editor with undo/redo

Document with append; undo and redo stacks; redo cleared on new action.

### T3. Diff-based Memento

Document fields; updating returns a Patch; reverting applies the inverse.

### T4. Persistent draft

Form state serialized to localStorage; restored on reload.

### T5. Bounded history

History stack with max size; oldest dropped.

### T6. Snapshot in event-sourced aggregate

Aggregate with apply(event); snapshot every N events; load uses latest snapshot + tail events.

### T7. Sensitive data redaction

Memento that includes a password; serializer redacts when logging.

### T8. Concurrent snapshot

Lock-free Memento via AtomicReference + immutable record.

---

## Trick Questions

### TQ1. "If everything is immutable, do I need Memento?"

**A.** Not as a separate pattern — every value IS a Memento. The "Caretaker" stores references to old values. Functional languages (Clojure, Haskell) embrace this; the pattern is implicit. In imperative languages with mutation, Memento is explicit.

### TQ2. "Can a Memento contain a reference to the Originator?"

**A.** It can, but it shouldn't. The Memento is meant to be an opaque snapshot. If it references the Originator, you have a cycle and the snapshot can change with the Originator. Capture state as values.

### TQ3. "Doesn't the Caretaker know SOMETHING about the Memento?"

**A.** It knows the type ("MementoType"). It knows lifecycle (when to discard). It doesn't know the *contents*. The opacity contract is about state, not identity.

### TQ4. "What's wrong with Memento having public fields?"

**A.** Anyone can read them. The Caretaker (or other code) can break encapsulation. Java's package-private visibility, Python's `_underscore` convention, JavaScript's closures, etc., enforce or signal opacity.

### TQ5. "Is database savepoint REALLY Memento?"

**A.** Conceptually yes. The DB engine implements it efficiently using transaction logs and undo info, not literal full-state snapshots. Same intent; different implementation.

### TQ6. "Memento for a class with no state — useful?"

**A.** No. Memento captures *state*. Stateless objects have nothing to capture. If you find yourself snapshotting nothing, the pattern doesn't apply.

### TQ7. "Memento for streaming data — possible?"

**A.** A snapshot of a stream is meaningless (the stream has no "state" beyond position). For streams, capture the *position* (offset, cursor) — that's a Memento for the consumer state. The stream itself is unchanged.

### TQ8. "Why don't all classes implement Memento?"

**A.** Most don't need restore. The pattern adds boilerplate: save method, restore method, Memento class. Pay only when undo / rollback / save-load is a real requirement.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you used Memento for undo."

Pick a concrete: text editor, drawing app, IDE refactor. Describe state captured, granularity of snapshots (per character vs per logical action), bounded history, redo handling.

### B2. "How would you design a save game system?"

Memento for game state. Serialize to disk (Protobuf or JSON for portability). Multiple save slots with metadata (timestamp, screenshot). Schema versioning. Caretaker = save manager UI; doesn't read save files.

### B3. "Walk me through adding snapshots to event sourcing."

Identify aggregates with long histories; implement `snapshot()` method; choose snapshot frequency (every N events, time-based, adaptive); stand up snapshot store; modify load logic. Test parity with full replay.

### B4. "Your form data is lost on reload. Fix?"

Memento periodic save to localStorage / IndexedDB. On load, check for draft; offer to restore. Schema-versioned in case of form changes. Don't store sensitive data unencrypted.

### B5. "How do you handle Memento for a microservice's state?"

Each service may have its own Mementos for local state. Cross-service "snapshot" requires saga / coordinated checkpoint. For simple services: persist state via outbox + event sourcing. For complex: workflow engines that checkpoint per step.

### B6. "Why might you choose persistent data structures for state?"

Built-in time-travel for free. Easier reasoning (no aliasing). Concurrency-friendly (immutable values). Costs: ~2-10× slower mutations; library learning curve. Worth it for state-heavy apps with snapshot needs.

---

## Tips for Answering

1. **Lead with intent.** "Memento captures state opaquely so it can be restored without breaking encapsulation."
2. **Three roles always.** Originator / Memento / Caretaker.
3. **Pair with Command for undo/redo.** Common interview combo.
4. **Mention encapsulation.** Memento's primary value.
5. **Connect to event sourcing / MVCC at scale.** Senior signal.
6. **Persistent data structures = Memento for free.** Functional-language savvy.
7. **Bound history.** Always.
8. **Sensitive data warning.** Mature operational thinking.

[← Professional](professional.md) · [Tasks →](tasks.md)
