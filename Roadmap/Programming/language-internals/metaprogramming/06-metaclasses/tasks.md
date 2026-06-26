# Metaclasses — Hands-On Tasks

> **Topic:** [Metaclasses](README.md)

---

## Introduction

You understand metaclasses by building one, feeling its sharp edges, and then
*replacing* it with the lighter modern tool to see why the lighter tool usually wins.
These exercises are Python-centric (where metaclasses are most accessible) with a Ruby
detour for `method_missing`. The recurring lesson: metaclass code runs at
class-creation time, and most things you'd use it for have a simpler answer.

Tick a self-check box when you can explain *when your code runs* and *why the simpler
tool is preferable*, not merely when it works.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Prove a class is an object

Show that a class has a type, that `type` is its own type, and that you can build a
class with `type(...)` directly.

```python
class Foo: pass
print(type(Foo))          # <class 'type'>
print(type(type))         # <class 'type'>
Bar = type('Bar', (), {'x': 1})
print(Bar().x)            # 1
```

**Self-check:**
- [ ] I can state that `Foo`'s metaclass is `type`.
- [ ] I built a working class with the 3-arg `type` call and explained that `class` is sugar for it.

### Task 2 — Observe class-creation time

Write a metaclass whose `__new__` prints a message, then define two classes with it
*without instantiating them*. Confirm the message prints at definition.

**Self-check:**
- [ ] The message prints when the `class` statements execute, before any instance is made.
- [ ] I can explain why this is "import-time" cost.

---

## Core

### Task 3 — Subclass registry, the metaclass way

Write a `PluginMeta(type)` that records every concrete subclass in a registry dict
keyed by name. Define a `Plugin` base and two subclasses; show the registry fills
automatically.

**Self-check:**
- [ ] Subclasses appear in the registry without any explicit registration call.
- [ ] My metaclass calls `super().__new__` and skips registering the base itself.

### Task 4 — The same registry, the modern way

Re-implement Task 3 using `__init_subclass__` and **no metaclass**. Compare the two.

**Self-check:**
- [ ] Behavior is identical; the code is shorter and has no `metaclass=`.
- [ ] I can argue why `__init_subclass__` is the better default (readability, tooling, composition).

### Task 5 — Descriptor that learns its name

Build a tiny `Field` descriptor and use `__set_name__` so each field knows its
attribute name, then a `Model` base that lists its fields — *without* a metaclass
scanning the namespace.

**Self-check:**
- [ ] Each `Field` knows its own name via `__set_name__`.
- [ ] I avoided a metaclass for what looks like a classic "ORM declarative base" task.

---

## Advanced

### Task 6 — Provoke and fix a metaclass conflict

Create a class that inherits from both an `abc.ABC` and a class using your own
metaclass. Observe the `metaclass conflict`, then fix it by defining a combined
metaclass.

**Self-check:**
- [ ] I reproduced the conflict and can explain the "metaclass must subclass all bases' metaclasses" rule.
- [ ] My combined metaclass resolves it; I can explain why this is a smell worth avoiding.

### Task 7 — Singleton three ways

Implement a singleton via (a) a metaclass `__call__` override, (b) a module-level
instance, (c) `functools.lru_cache` on a factory. Compare testability.

**Self-check:**
- [ ] All three give one shared instance.
- [ ] I can argue that the non-metaclass versions are simpler and easier to reset in tests — and that the metaclass version is over-engineering.

### Task 8 — Ruby `method_missing` (or a Python `__getattr__` analogue)

Implement a dynamic-finder object: `find_by_<attr>(value)` is synthesized on demand.
Then add the reflection-honesty hook (`respond_to_missing?` in Ruby /
`__getattr__` care in Python) and show a typo no longer silently returns nothing
useful.

**Self-check:**
- [ ] Dynamic methods work without being predefined.
- [ ] Reflection (`respond_to?` / `hasattr`) stays consistent, and I can explain the typo-hiding danger.

---

## Capstone

### Task 9 — Build a mini declarative framework, then de-magic it

Build a small "schema" framework where `class User(Model): name = Str(); age = Int()`
gives you field metadata, validation, and a registry. Implement it **twice**:

1. With a metaclass (`__prepare__` + `__new__` scanning the namespace).
2. With `__init_subclass__` + `__set_name__` and no metaclass.

Then write a short note: which was easier to read, to debug (set a breakpoint and
step), and to type-check?

**Self-check:**
- [ ] Both versions produce identical behavior.
- [ ] I can point to concrete ways the non-metaclass version is easier to read/debug/tool.
- [ ] I can name the *one* thing only the metaclass version can do (control the class namespace via `__prepare__`) and judge whether this app needed it (it didn't).

---

## Self-Assessment

You own this topic when you can:

- [ ] Explain a class as an object whose type is its metaclass, and `type` as both metaclass and class factory.
- [ ] Distinguish class-creation-time from instance-creation-time code.
- [ ] Replace a registry/descriptor-naming metaclass with `__init_subclass__`/`__set_name__`.
- [ ] Diagnose and resolve a metaclass conflict, and recognize singleton-via-metaclass as over-engineering.
- [ ] State the few framework-level cases where a metaclass genuinely earns its place.
