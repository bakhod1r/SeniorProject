# Metaclasses — Middle Level

> **Topic:** [Metaclasses](README.md)
> **Focus:** Actually writing a metaclass — `__new__`, `__init__`, `__call__`, `__prepare__` — and, crucially, the simpler tools (`__init_subclass__`, `__set_name__`, class decorators) that should usually replace it.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **A metaclass is a class whose instances are classes. So you customize class creation by overriding the same special methods you already know — just one rung up.**

At junior level you learned the ratio: *metaclass : class :: class : instance*, and that `type` is the default metaclass. Now we make it concrete. To write a metaclass you subclass `type`:

```python
class Meta(type):
    ...

class Thing(metaclass=Meta):
    ...
```

`Thing` is now an *instance of* `Meta`. That sentence is the key to everything. Because a class is an instance of its metaclass, the special methods you already use on classes — `__new__`, `__init__`, `__call__` — gain a parallel meaning when you put them on a metaclass:

- A metaclass's `__new__`/`__init__` run when the **class** is created (not when instances are).
- A metaclass's `__call__` runs when you *instantiate* the class — `Thing()` calls `Meta.__call__(Thing)`.

That's the symmetry. `__init__` on a normal class initializes an instance; `__init__` on a metaclass initializes a class. Same machinery, one level up.

> 🎓 **Why this matters for a middle engineer:** You will hit a real need — "register every subclass automatically," "validate that every model defines `table_name`," "inject a method into a family of classes." Metaclasses *can* do all of these. But Python 3.6+ gave you `__init_subclass__` and `__set_name__` (PEP 487), which do the common cases far more simply. The mark of a competent engineer here is not "can write a metaclass" — it's "knows when *not* to, and reaches for the lighter tool."

This page shows: the full lifecycle of class creation (`__prepare__` → namespace → `__new__` → `__init__`), the four override points and what each is for, the three classic use cases (registration, validation, instance-creation control), and a side-by-side of the metaclass solution versus the `__init_subclass__` / decorator solution so you can pick correctly.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` — that a class is an object, `type` is the default metaclass, and the `class` statement is sugar for `type(name, bases, namespace)`.
- **Required:** `__new__` vs `__init__` on *ordinary* classes (`__new__` allocates/returns the object; `__init__` initializes it).
- **Required:** Inheritance and method resolution basics, `super()`.
- **Helpful:** Decorators (function and class), since they're an alternative we'll compare against.
- **Helpful:** Descriptors at a basic level (an object with `__get__`/`__set__`), for `__set_name__`.

You do **not** need (yet):

- Metaclass conflicts in multiple inheritance, ABCMeta internals, or how ORMs wire this up end-to-end (that's `senior.md`).
- Ruby eigenclasses, Smalltalk's parallel hierarchy, or JVM class objects (`professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Metaclass** | A class that subclasses `type`. Its instances are classes. |
| **`metaclass=` keyword** | The class-statement argument that selects which metaclass builds this class. |
| **`__prepare__`** | Classmethod on the metaclass that returns the namespace object the class body will populate. Runs *first*. |
| **`__new__` (metaclass)** | Creates and returns the new class object. Can mutate the namespace/bases before the class exists. Runs once at class creation. |
| **`__init__` (metaclass)** | Initializes the already-created class object. Runs once at class creation, after `__new__`. |
| **`__call__` (metaclass)** | Runs when you *instantiate the class* (`Thing()`). Controls instance creation. |
| **`namespace` / `mcs`/`cls`** | The dict of class body contents; `mcs` (or `mcls`) is the metaclass itself by convention. |
| **`__init_subclass__`** | A hook (PEP 487) on a *base class* that runs whenever a subclass is defined. The lighter alternative to a metaclass for most registration/validation. |
| **`__set_name__`** | A hook (PEP 487) on a *descriptor/attribute* object; the owning class calls it at class-creation time, passing the attribute's name. |
| **Class decorator** | A function applied with `@deco` above a class; receives the finished class and returns a (possibly modified) class. The other lightweight alternative. |
| **Registry** | A dict/list collecting classes (often subclasses) so they can be looked up by name/key. |
| **Declarative** | A style where you write structure (fields) and a framework derives behavior, typically via one of the above hooks. |

---

## Core Concepts

### 1. Writing a Metaclass = Subclassing `type`

```python
class Meta(type):
    def __new__(mcs, name, bases, namespace, **kwargs):
        print(f"Building class {name!r}")
        cls = super().__new__(mcs, name, bases, namespace)
        return cls

class Thing(metaclass=Meta):
    pass
# prints: Building class 'Thing'  -- at definition time, no instance made
```

`Meta.__new__` receives the *same three arguments* the `class` statement always assembles: the name, the bases tuple, and the namespace dict. You can inspect them, modify them, validate them, and then call `super().__new__` to actually build the class.

### 2. The Full Class-Creation Lifecycle

When `class Thing(Base, metaclass=Meta, **kwargs):` runs, Python performs these steps in order:

```text
1. Determine the metaclass (explicit metaclass=, or inherited from a base).
2. metaclass.__prepare__(name, bases, **kwargs)  -> returns the namespace mapping
3. Execute the class body, populating that namespace (defs, assignments).
4. metaclass.__new__(metaclass, name, bases, namespace, **kwargs) -> the class object
5. For each attribute that has __set_name__, call attr.__set_name__(cls, attrname).
6. metaclass.__init__(cls, name, bases, namespace, **kwargs)
7. __init_subclass__ of the parent is invoked (with the new subclass).
   (Steps 5 and 7 are part of type.__new__/__init_subclass__ machinery.)
8. Bind the resulting class object to the name `Thing`.
```

The two clocks again: steps 2–8 are **class-creation time** (once, at import). Later, `Thing()` is **instance-creation time** and goes through `Meta.__call__` (see Core Concept 5).

### 3. `__new__` vs `__init__` on a Metaclass

They mirror the ordinary-class versions, one level up:

```python
class Meta(type):
    def __new__(mcs, name, bases, namespace, **kw):
        # Use __new__ when you must change the namespace/bases
        # BEFORE the class exists (e.g. inject or rename members).
        namespace.setdefault("created_by", "Meta")
        return super().__new__(mcs, name, bases, namespace)

    def __init__(cls, name, bases, namespace, **kw):
        # Use __init__ when the class already exists and you just
        # want to inspect/register/validate it.
        super().__init__(name, bases, namespace)
        print(f"{name} now exists with attrs: {list(namespace)}")
```

Rule: **`__new__` to *shape* the class (rare); `__init__` to *react to* the finished class (common).** If you only need to read the class and register/validate it, `__init__` is enough and simpler.

### 4. `__prepare__` — Controlling the Namespace

Normally the class body fills an ordinary dict. `__prepare__` lets you supply a *different* mapping, so you can observe definition order or special-case assignments. The classic example is preserving order before dicts were ordered (pre-3.7), or building enums:

```python
class OrderedMeta(type):
    @classmethod
    def __prepare__(mcs, name, bases, **kw):
        return collections.OrderedDict()   # or a custom recording dict

    def __new__(mcs, name, bases, namespace, **kw):
        cls = super().__new__(mcs, name, bases, dict(namespace))
        cls._field_order = [k for k in namespace if not k.startswith("__")]
        return cls
```

Since Python 3.7 plain dicts preserve insertion order, so `__prepare__` is rarely needed *just* for ordering — but it's the only hook that can intercept assignments *as they happen* in the body (e.g. forbidding duplicate names, as `enum` does).

### 5. `__call__` — Controlling Instance Creation

Here's a subtlety that surprises people. When you write `Thing()`, what actually runs? Because `Thing` is an instance of `Meta`, calling it invokes `Meta.__call__(Thing)`. That metaclass `__call__` is what *normally* orchestrates `Thing.__new__` and `Thing.__init__`. Override it to control how instances are made:

```python
class SingletonMeta(type):
    _instances = {}
    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Config(metaclass=SingletonMeta):
    def __init__(self):
        self.value = 42

a = Config()
b = Config()
print(a is b)   # True — only one instance ever created
```

`super().__call__(*args, **kwargs)` is the line that does the *normal* "call `__new__`, then `__init__`." By intercepting before it, the metaclass controls instance creation for the whole class.

### 6. The Modern Alternatives (Use These First)

Most real-world reasons to write a metaclass are better served by PEP 487 hooks or a class decorator.

**`__init_subclass__`** — runs on the *base* whenever a subclass is defined. No metaclass needed:

```python
class Plugin:
    registry = {}
    def __init_subclass__(cls, /, key=None, **kwargs):
        super().__init_subclass__(**kwargs)
        cls.registry[key or cls.__name__] = cls   # auto-register every subclass

class JSONPlugin(Plugin, key="json"):
    pass

print(Plugin.registry)   # {'json': <class 'JSONPlugin'>}
```

**`__set_name__`** — lets an attribute learn the name it was assigned to, at class-creation time:

```python
class Field:
    def __set_name__(self, owner, name):
        self.name = name           # the descriptor now knows it's "title"
    def __get__(self, obj, objtype=None):
        return obj.__dict__.get(self.name)

class Article:
    title = Field()                # __set_name__ called with name="title"
```

**Class decorator** — receives the finished class, returns a modified one:

```python
def register(cls):
    REGISTRY[cls.__name__] = cls
    return cls

@register
class Handler:
    ...
```

The competent move: reach for these three before a metaclass. A metaclass is justified mainly when you need to affect instance creation (`__call__`), control the namespace mapping (`__prepare__`), or impose a metaclass-level interface across an entire class hierarchy.

---

## Real-World Analogies

**The factory's quality-control station.** A class decorator is an inspector at the *end* of the assembly line: the class is already built; the inspector stamps it, logs it, maybe bolts on an extra part, and ships it. A metaclass `__new__` is a redesign of the *machine itself*: it can change how the class is assembled, mid-build, before it's finished. Use the inspector when you can; rebuild the machine only when end-of-line inspection isn't enough.

**Birth certificate vs. genome editing.** `__init_subclass__` is the registrar who records every newborn class in the town ledger — observation after the fact. A metaclass `__new__` is editing the blueprint before the class is born. The registrar is enough for "keep a list of everyone." You only edit the blueprint when you must change the thing itself.

**A class roster that signs itself in.** Auto-registration via `__init_subclass__` is like a class where each new student, simply by enrolling, automatically appears on the attendance sheet — no teacher action required. That's the magic frameworks sell, achievable without ever touching a metaclass.

---

## Mental Models

### Model 1: The Mirror Across the Rung

Every special method you know on instances has a metaclass twin:

```text
ORDINARY CLASS (acts on instances)   METACLASS (acts on classes)
  __new__   -> allocate instance       __new__   -> allocate class
  __init__  -> init instance           __init__  -> init class
  Class()   -> make an instance        Meta-instance is the class itself
  (the class is called to make obj)    __call__  -> runs when the class is called
```

When in doubt, ask "one rung up, what does this method now operate on?" The answer is always "the class" instead of "the instance."

### Model 2: Decision Ladder (climb only as far as you must)

```text
Need to react to subclass definition (register/validate)?  -> __init_subclass__
Need an attribute to know its own name?                    -> __set_name__
Need to post-process a single finished class?              -> class decorator
Need to control how INSTANCES are made for a family?       -> metaclass __call__
Need to change the namespace mapping / intercept body?     -> metaclass __prepare__
Need to inject/rewrite members before the class exists?    -> metaclass __new__
Need a shared metaclass-level interface across a hierarchy? -> metaclass
```

Stop at the first rung that does the job. Most tasks stop in the top three.

### Model 3: Two Clocks, Two Hooks

- **Class clock** (once, import): `__prepare__`, metaclass `__new__`/`__init__`, `__set_name__`, `__init_subclass__`.
- **Instance clock** (each `Thing()`): metaclass `__call__`, then class `__new__`/`__init__`.

If your customization should happen *per instance*, it belongs on the instance clock. If it should happen *per class*, it belongs on the class clock. Putting work on the wrong clock is the most common design error here.

---

## Code Examples

### Example 1: Auto-registration — metaclass vs the lighter way

```python
# --- The metaclass way (works, but heavier) ---
class RegistryMeta(type):
    registry = {}
    def __init__(cls, name, bases, ns, **kw):
        super().__init__(name, bases, ns)
        if bases:                      # skip the base itself
            RegistryMeta.registry[name] = cls

class BaseA(metaclass=RegistryMeta): pass
class Foo(BaseA): pass
print(RegistryMeta.registry)          # {'Foo': <class 'Foo'>}

# --- The __init_subclass__ way (preferred) ---
class BaseB:
    registry = {}
    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        cls.registry[cls.__name__] = cls

class Bar(BaseB): pass
print(BaseB.registry)                 # {'Bar': <class 'Bar'>}
```

Same outcome; the second needs no metaclass and is obvious to any reader.

### Example 2: Enforcing a class invariant at definition time

```python
class RequiresTableName(type):
    def __new__(mcs, name, bases, ns, **kw):
        if bases and "table_name" not in ns:
            raise TypeError(f"{name} must define `table_name`")
        return super().__new__(mcs, name, bases, ns)

class Model(metaclass=RequiresTableName): pass

class User(Model):
    table_name = "users"      # OK

# class Broken(Model): pass  # -> TypeError at import: must define table_name
```

The same check via `__init_subclass__` (preferred unless you need metaclass behavior):

```python
class Model2:
    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        if "table_name" not in cls.__dict__:
            raise TypeError(f"{cls.__name__} must define `table_name`")
```

### Example 3: A singleton via `__call__`

```python
class SingletonMeta(type):
    _cache = {}
    def __call__(cls, *a, **kw):
        if cls not in cls._cache:
            cls._cache[cls] = super().__call__(*a, **kw)
        return cls._cache[cls]

class Logger(metaclass=SingletonMeta):
    def __init__(self):
        print("constructing Logger")   # prints only once

x, y = Logger(), Logger()
print(x is y)    # True
```

This is the one case where a metaclass is genuinely the natural fit — controlling *instance* creation for a whole class. (Even so, many teams prefer a module-level singleton or a factory function for clarity.)

### Example 4: `__set_name__` — descriptors that know their name

```python
class Column:
    def __set_name__(self, owner, name):
        self.name = name
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        return obj.__dict__.get(self.name)
    def __set__(self, obj, value):
        obj.__dict__[self.name] = value

class Row:
    id = Column()
    email = Column()

r = Row()
r.email = "a@b.com"
print(r.email)             # a@b.com
print(Row.email.name)      # "email" — learned at class-creation time
```

Before PEP 487 (3.6), making each `Column` learn its attribute name required a metaclass to scan the namespace. `__set_name__` removed that need.

### Example 5: Reading the lifecycle order

```python
class Trace(type):
    @classmethod
    def __prepare__(mcs, name, bases, **kw):
        print("1. __prepare__"); return {}
    def __new__(mcs, name, bases, ns, **kw):
        print("3. __new__"); return super().__new__(mcs, name, bases, ns)
    def __init__(cls, name, bases, ns, **kw):
        print("4. __init__"); super().__init__(name, bases, ns)

class Demo(metaclass=Trace):
    print("2. class body runs")
# Output order: 1, 2, 3, 4
```

---

## Pros & Cons

**Pros of writing a metaclass:**

- **One hook for an entire hierarchy.** Behavior applies to every class using that metaclass, including future ones, without each opting in.
- **Can affect instance creation.** `__call__` lets you intercept `ClassName()` — singletons, instance caching, dependency injection at the type level.
- **Can rewrite the class before it exists.** `__new__`/`__prepare__` can inject, rename, or forbid members during the build.

**Cons:**

- **Overpowered for most tasks.** Registration, validation, and naming are all solved more cheaply by PEP 487 hooks or decorators.
- **Inheritance friction.** A subclass *inherits* its metaclass; mixing class hierarchies with different metaclasses causes conflicts (a `senior.md` topic).
- **Cognitive cost.** Reviewers must understand a second object-model layer to follow your code.
- **Tooling blind spots.** IDEs, type checkers, and static analyzers often can't "see" what a metaclass injects, hurting autocomplete and type safety.

> Decision rule: write the *lighter* solution first. Only escalate to a metaclass when you specifically need `__call__`, `__prepare__`, or a hierarchy-wide metatype interface — and write down *why* in a comment.

---

## Use Cases

- **Singletons / instance caching** — `__call__` is the clean fit (Example 3).
- **Declarative bases that must control instantiation** — when merely defining fields isn't enough and you need to intercept `Model()`.
- **Enums / sentinel families** — controlling the namespace via `__prepare__` (how `enum` forbids duplicate members and assigns values).
- **Framework-wide policy** — "every class of this kind gets feature X injected," where opting in via inheritance of a metaclass is desirable.
- **Most "register subclasses / validate definition" needs** — these are listed here so you recognize them, but you should reach for `__init_subclass__` instead.

---

## Coding Patterns

**Pattern: Prefer `__init_subclass__` for registration/validation.** It's discoverable (lives on the base class, reads top-to-bottom), composes via cooperative `super().__init_subclass__(**kwargs)`, and needs no metaclass.

**Pattern: `__set_name__` for self-aware attributes.** Any descriptor/field that needs its own name should implement `__set_name__` rather than relying on a metaclass to scan the namespace.

**Pattern: Class decorator for one-off post-processing.** If you need to transform *specific* classes (not a whole hierarchy), `@decorator` is simpler and more explicit than a metaclass.

**Pattern: Metaclass only for `__call__`/`__prepare__` needs.** Reserve metaclasses for the genuinely type-level concerns: instance-creation control and namespace control.

**Pattern: Always call `super()`.** In metaclass `__new__`/`__init__` and in `__init_subclass__`, call the parent implementation. Skipping it breaks cooperative multiple inheritance and ABC machinery.

**Anti-pattern: A metaclass that only reads the class.** If your metaclass `__init__` just registers or validates without touching `__call__`/`__new__`/`__prepare__`, it should almost certainly be `__init_subclass__`.

---

## Best Practices

- **Climb the decision ladder; stop early.** `__init_subclass__` → `__set_name__` → class decorator → metaclass, in that order.
- **Use metaclass `__init__` (not `__new__`) unless you must mutate the namespace.** Reading and reacting is `__init__`'s job; reshaping is `__new__`'s.
- **Cooperate with `super()` everywhere** in the class-creation chain.
- **Document the "why."** A metaclass with a one-line comment explaining what couldn't be done more simply saves the next reader an hour.
- **Keep metaclass logic small and pure.** Heavy side effects at import time (network calls, file I/O) make import order fragile and tests slow.
- **Don't put per-instance logic on the class clock.** If it should run each time you make an object, it belongs in `__init__`/`__new__` of the class or in metaclass `__call__`, not in metaclass `__init__`.

---

## Edge Cases & Pitfalls

- **Forgetting `bases` is empty for the base class.** Registration code often runs for the abstract base too; guard with `if bases:` or check `cls.__dict__`.
- **`namespace` is mutated, not copied, in `__new__`.** If you pass it to `super().__new__`, later edits to your local copy won't matter; edit *before* the call.
- **`__init_subclass__` is implicitly a classmethod.** You don't (and shouldn't) decorate it; Python treats it specially. Its first parameter is the *subclass*.
- **Keyword arguments flow through the class statement.** `class Foo(Base, key="x")` passes `key="x"` to `__init_subclass__`/`__prepare__`/`__new__`/`__init__`. Accept and forward `**kwargs`.
- **`__call__` on the metaclass shadows the normal construction path.** If you override it and forget `super().__call__(...)`, instances won't get `__init__` run. A subtle, hard-to-spot bug.
- **Type checkers may not follow metaclass magic.** Members injected by a metaclass often appear "undefined" to mypy/Pyright. Sometimes you must add stubs or `# type: ignore`, which is a real cost in the metaclass-vs-decorator decision.
- **`__set_name__` runs only for attributes set in the class body.** Attributes added *after* class creation (e.g. `Cls.x = Field()` later) don't get `__set_name__` called automatically — you'd have to call it yourself.

---

## Cheat Sheet

```text
WRITE A METACLASS:  class Meta(type): ...   then  class C(metaclass=Meta): ...
  -> C is an INSTANCE of Meta.

LIFECYCLE (class-creation time, once at import):
  __prepare__ -> body runs -> __new__ -> __set_name__ -> __init__ -> __init_subclass__

METACLASS METHODS:
  __new__(mcs, name, bases, ns, **kw)   shape the class (rare)
  __init__(cls, name, bases, ns, **kw)  react to the class: register/validate (common)
  __call__(cls, *a, **kw)               runs on C() -> controls INSTANCE creation
  __prepare__ (classmethod)             returns the namespace mapping

PREFER THESE (PEP 487 / decorators) FIRST:
  __init_subclass__(cls, **kw)   on the base; fires per subclass (register/validate)
  __set_name__(self, owner, nm)  on an attribute; learns its own name
  @decorator                     post-process one finished class

ALWAYS: call super() in the creation chain. Forward **kwargs.
ESCALATE TO METACLASS ONLY FOR: __call__, __prepare__, hierarchy-wide metatype.
```

---

## Summary

A metaclass is a class that subclasses `type`; its instances are classes, so the special methods you already know gain a one-rung-up meaning. `__new__`/`__init__` on a metaclass run at **class-creation time** (`__new__` to reshape the class, `__init__` to react to it), `__prepare__` controls the namespace mapping, and `__call__` runs when you *instantiate* the class — making it the natural hook for singletons and instance caching.

But the headline lesson for a middle engineer is restraint. Python 3.6+ gave you `__init_subclass__` (per-subclass hook for registration/validation) and `__set_name__` (attributes that learn their own name), plus class decorators for one-off post-processing. These cover the vast majority of historical metaclass use cases with code that's discoverable, composable, and friendlier to tooling. Climb the decision ladder and stop at the first rung that works; reserve a real metaclass for the genuinely type-level concerns. The senior level digs into where this gets hard: metaclass conflicts, ABCMeta, and how production ORMs actually combine these mechanisms.

---

## Further Reading

- PEP 487 — "Simpler customization of class creation" (`__init_subclass__`, `__set_name__`). The single most useful read for this level.
- PEP 3115 — "Metaclasses in Python 3000" (`__prepare__` and the new metaclass syntax).
- The Python "Data model" reference — sections on metaclasses, `__set_name__`, and `__init_subclass__`.
- The Python `enum` module source — a production metaclass that uses `__prepare__` to forbid duplicate members.
- The `descriptor` HOWTO in the Python docs — to understand `__set_name__` in context.
