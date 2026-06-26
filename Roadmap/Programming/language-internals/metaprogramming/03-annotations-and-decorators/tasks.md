# Annotations & Decorators — Tasks & Exercises

> **Topic:** [Annotations & Decorators](README.md)
> **Focus:** Hands-on exercises that force the distinction between inert metadata (annotations/attributes) and live wrapping code (decorators), and exercise both processing paths — compile-time and runtime.

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Warm-Up](#warm-up)
3. [Python Decorator Tasks](#python-decorator-tasks)
4. [Java Annotation Tasks](#java-annotation-tasks)
5. [TypeScript / C# Tasks](#typescript--c-tasks)
6. [Cross-Cutting & Trap Tasks](#cross-cutting--trap-tasks)
7. [Stretch Projects](#stretch-projects)
8. [Solutions (Sparse)](#solutions-sparse)

---

## How to Use This Page

Each task has a **goal**, a **self-check** (how to know you succeeded), and a **hint**. Try the task before reading the hint, and write the self-check assertion *first* so you have a target. Sparse solutions for the trickier tasks are at the bottom — consult them only after a genuine attempt. The golden rule running through every task: **before you write code, say out loud whether you're dealing with metadata (someone must read it) or behavior (it runs and wraps).**

---

## Warm-Up

### Task W1 — Classify the `@`

For each, state (a) metadata or behavior, (b) who reads/runs it, (c) when: `@Override`, `@app.route("/x")` (Flask), `@property`, `@Entity` (JPA), `[Required]` (C#), `@Component` (Angular), `@lru_cache`.

- **Self-check:** You can name the reader and the timing for all seven, and you flagged that `@Override` is compile-time-only while `@Entity` is runtime-reflection.
- **Hint:** Apply the deletion test — "if I remove the tool that reads this, does behavior change?"

### Task W2 — The rewrite

Rewrite `@a` `@b` over `def f(): ...` as explicit assignments, and state the call-time execution order of the wrappers.

- **Self-check:** You wrote `f = a(b(f))` and said `a`'s wrapper executes first (outermost), `b`'s last.
- **Hint:** Decorators apply bottom-up; they execute top-down.

### Task W3 — The inert annotation

Define a Java annotation `@Cool` and apply it to a method. Predict the program's behavior.

- **Self-check:** You predicted *no effect whatsoever*, and you can explain why (no reader, and it would need `@Retention(RUNTIME)` even to be reflectable).
- **Hint:** An annotation is half a feature.

---

## Python Decorator Tasks

### Task P1 — Timing decorator with `wraps`

Write `@timed` that prints how long the wrapped function took and returns its result unchanged. Preserve the function's name and docstring.

- **Self-check:** `timed`-decorated `add.__name__ == "add"` and `add.__doc__` is preserved; timing prints; the return value is correct.
- **Hint:** `functools.wraps(func)` on the inner `wrapper`; use `time.perf_counter()`.

### Task P2 — Prove `wraps` matters

Write the same decorator *without* `functools.wraps` and assert that `__name__` is now wrong.

- **Self-check:** `assert decorated.__name__ == "wrapper"` passes without `wraps`, and fails (correctly) once you add `wraps`.
- **Hint:** Print `decorated.__name__` before and after adding `@functools.wraps`.

### Task P3 — Decorator factory `@retry(times)`

Write a parameterized `@retry(times=3)` that re-invokes the function on exception up to `times` attempts, re-raising the last exception.

- **Self-check:** A function that fails twice then succeeds returns its value with `@retry(times=3)`; a function that always fails raises after exactly `times` attempts (count them).
- **Hint:** Three layers — `retry(times)` → `decorator(func)` → `wrapper(*a, **k)`.

### Task P4 — Bare-or-parameterized decorator

Make a decorator `@trace` that works both as `@trace` and as `@trace(prefix=">>")`.

- **Self-check:** Both `@trace` and `@trace(prefix="X")` produce working, identity-preserving wrappers.
- **Hint:** `def trace(func=None, *, prefix="")` and return `functools.partial(trace, prefix=prefix)` when `func is None`.

### Task P5 — Class decorator `@auto_repr`

Write a class decorator that adds a `__repr__` listing all instance attributes as `Name(a=.., b=..)`.

- **Self-check:** `repr(Point(1, 2)) == "Point(x=1, y=2)"`.
- **Hint:** Define a function and assign `cls.__repr__ = ...`; iterate `self.__dict__`.

### Task P6 — Registry via decorator

Build a `@command(name)` decorator that registers functions in a module-level `COMMANDS` dict and a `dispatch(name, *args)` that calls the registered function.

- **Self-check:** Decorating two functions populates `COMMANDS` at import; `dispatch("greet")` calls the right one.
- **Hint:** The factory closes over `name` and mutates `COMMANDS` as a *side effect at definition time*.

### Task P7 — Memoization with eviction trap

Write a `@memoize` decorator. Then construct an input that *breaks* it (unhashable argument) and fix it.

- **Self-check:** You can articulate that `memoize(f)(([1,2]))` raises `TypeError: unhashable type` and you handled it (reject, or convert to a tuple key).
- **Hint:** Cache keys must be hashable; lists aren't.

---

## Java Annotation Tasks

### Task J1 — Runtime annotation + reader

Define `@Benchmark` with `@Retention(RUNTIME)` and `@Target(METHOD)`, apply it, then write a method that reflectively finds all `@Benchmark` methods of a class and "runs" them (just print their names).

- **Self-check:** Removing `@Retention(RUNTIME)` makes your reader find *nothing* — verify both states.
- **Hint:** `clazz.getDeclaredMethods()` + `m.isAnnotationPresent(Benchmark.class)`.

### Task J2 — Retention experiment

Take J1's annotation and change retention to `SOURCE`, then `CLASS`, then `RUNTIME`. For each, predict whether your reflective reader sees it.

- **Self-check:** Only `RUNTIME` is visible to reflection; `SOURCE` and `CLASS` are not. Confirm by running.
- **Hint:** Reflection can only see `RUNTIME`-retained annotations.

### Task J3 — `@Override` safety

Write a subclass that *intends* to override `toString` but misspells it. Show that adding `@Override` turns the silent bug into a compile error.

- **Self-check:** Without `@Override` it compiles (and silently doesn't override); with `@Override` it fails to compile.
- **Hint:** The compiler reads `@Override` and verifies a matching supertype method exists.

### Task J4 — Annotation with members

Extend `@Benchmark` to have `int warmups() default 0` and a `String label() default ""`. Read both values reflectively.

- **Self-check:** `m.getAnnotation(Benchmark.class).warmups()` returns the value you set; defaults apply when omitted.
- **Hint:** Members look like methods in the `@interface`; access them on the annotation instance.

### Task J5 — Conceptual: design a code-generating processor

On paper, design (don't fully implement) an annotation processor for `@GenerateBuilder` that emits a `XxxBuilder` class. List the APT pieces you'd use and the round behavior.

- **Self-check:** You named `AbstractProcessor`, `getSupportedAnnotationTypes`, the `Filer`, the `Messager`, the `Element` model, `META-INF/services` registration, and the round model (generated files compiled in a later round).
- **Hint:** You read the *structure* (`Element`s), not values; you *write* source via the `Filer`.

---

## TypeScript / C# Tasks

### Task T1 — Method-wrapping decorator (legacy TS)

With `experimentalDecorators: true`, write a `@log` method decorator that logs the method name on each call.

- **Self-check:** Calling the method prints its name then runs normally.
- **Hint:** Legacy signature `(target, key, descriptor)`; wrap `descriptor.value`.

### Task T2 — DI metadata round-trip

With `experimentalDecorators` and `emitDecoratorMetadata` on and `reflect-metadata` imported, read `design:paramtypes` of a decorated class and print the constructor parameter types.

- **Self-check:** `Reflect.getMetadata('design:paramtypes', Service)` returns the constructor's class types; removing the class decorator makes it `undefined`.
- **Hint:** The class needs *a* decorator for metadata to be emitted at all.

### Task T3 — Break and explain interface injection

Try to inject a dependency typed as an *interface* and observe the failure. Explain it.

- **Self-check:** You can state that interfaces erase to `Object`, so `design:paramtypes` can't carry them; the fix is an injection token.
- **Hint:** Types are erased; only concrete classes survive as metadata.

### Task T4 — C# attribute + reflection

Define a `[Retry(times)]` attribute and read its `Times` value via reflection on a method.

- **Self-check:** `GetCustomAttribute<RetryAttribute>().Times` returns the value passed in brackets.
- **Hint:** `[AttributeUsage]` is the `@Target` analogue; constructor args carry the data.

---

## Cross-Cutting & Trap Tasks

### Task X1 — Stacking order security bug

Write `@authorize` and `@cache` decorators in Python. Demonstrate that putting `@cache` *outside* `@authorize` lets an unauthorized caller get a cached result.

- **Self-check:** With the wrong order, a request that should be denied returns a cached value; with `@authorize` outermost, it's correctly denied.
- **Hint:** `@authorize` over `@cache` means `authorize(cache(f))` — authorize runs first.

### Task X2 — The parentheses trap

Take your `@retry(times)` factory and apply it as bare `@retry` (no parens). Capture the error and explain it.

- **Self-check:** You can explain that the function got passed as `times`, so the factory misbehaves; the correct usage needs `@retry(3)`.
- **Hint:** A factory must be *called* to produce the decorator.

### Task X3 — Self-invocation (conceptual / Spring)

Explain, in writing, why a `@Transactional` method called as `this.method()` from within the same bean doesn't run in a transaction, and give two fixes.

- **Self-check:** You mention the proxy, that self-calls bypass it, and offer fixes (inject the bean into itself; split beans; `TransactionTemplate`).
- **Hint:** The annotation's behavior lives in a *proxy*, not the object.

### Task X4 — Identity loss in the wild

Build a tiny router that dispatches on `func.__name__`. Decorate a handler *without* `functools.wraps` and show the router breaks; fix it.

- **Self-check:** Without `wraps`, all handlers register as `"wrapper"` and collide; with `wraps`, names are correct.
- **Hint:** This is why `wraps` is non-optional for name-keyed frameworks.

---

## Stretch Projects

### Task S1 — Mini DI container (Python)

Build a container where `@injectable` marks classes and the container resolves constructor dependencies by reading type annotations (`inspect.signature` / `__annotations__`), recursively constructing dependencies.

- **Self-check:** `container.resolve(Service)` returns a `Service` with its dependencies auto-constructed; a missing binding raises a clear error.
- **Hint:** Python's `inspect.signature(cls).parameters` gives parameter annotations — your `design:paramtypes` equivalent.

### Task S2 — Validation framework (runtime)

Build annotations/markers `@not_null`, `@min_len(n)` for class fields (use Python field annotations or a small descriptor), and a `validate(obj)` that reflects over them and returns a list of violations.

- **Self-check:** An object violating two rules returns exactly two violation messages; a valid object returns none.
- **Hint:** Store constraints as metadata on the class; reflect over them in `validate`.

### Task S3 — Build-vs-runtime comparison write-up

Implement the *same* tiny feature (e.g., auto-generated `__repr__`) two ways: a runtime class decorator and a (sketched) compile-time generator. Write up the cost trade-off.

- **Self-check:** Your write-up names the trade-off — runtime pays at definition/startup and per introspection; compile-time pays at build and is free afterward.
- **Hint:** This is the central axis of the whole topic in miniature.

---

## Solutions (Sparse)

### P3 — `@retry(times)`

```python
import functools

def retry(times):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last = None
            for _ in range(times):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last = e
            raise last
        return wrapper
    return decorator
```

Key: the factory layer captures `times`; the decorator layer captures `func`; the wrapper retries. Count attempts to verify `times` is honored.

### P4 — bare-or-parameterized

```python
import functools

def trace(func=None, *, prefix=""):
    if func is None:
        return functools.partial(trace, prefix=prefix)
    @functools.wraps(func)
    def wrapper(*a, **k):
        print(f"{prefix}{func.__name__}")
        return func(*a, **k)
    return wrapper
```

When called with arguments only, `func` is `None`, so we return a partial that will receive the function next.

### P6 — registry

```python
import functools
COMMANDS = {}

def command(name):
    def deco(func):
        COMMANDS[name] = func        # side effect at import/definition time
        @functools.wraps(func)
        def wrapper(*a, **k):
            return func(*a, **k)
        return wrapper
    return deco

def dispatch(name, *a, **k):
    return COMMANDS[name](*a, **k)
```

Note the registration happens when the module is imported, not when the function is called — the classic framework-router pattern.

### J1 — runtime annotation + reader (sketch)

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Benchmark { }

static void run(Class<?> c) {
    for (Method m : c.getDeclaredMethods())
        if (m.isAnnotationPresent(Benchmark.class))
            System.out.println("benchmark: " + m.getName());
}
```

Both halves required: the `RUNTIME`-retained annotation *and* the reflective reader. Drop `RUNTIME` and the reader prints nothing.

### X1 — stacking order

```python
@authorize        # outermost: runs first, can deny before cache is consulted
@cache
def get_secret(user): ...
```

`authorize(cache(get_secret))` — authorization happens before any cache lookup. Reverse the order and `cache(authorize(...))` serves cached results to anyone, bypassing the check. Order is a security decision.

### S1 — mini DI (sketch)

```python
import inspect

REGISTRY = set()
def injectable(cls):
    REGISTRY.add(cls)
    return cls

def resolve(cls):
    sig = inspect.signature(cls.__init__)
    args = []
    for name, p in sig.parameters.items():
        if name == "self":
            continue
        dep = p.annotation                 # the "design:paramtypes" equivalent
        args.append(resolve(dep))
    return cls(*args)
```

`inspect.signature` reading parameter annotations is Python's analogue of TypeScript's `design:paramtypes` — the same idea (read declared types to wire dependencies), without needing a metadata polyfill because Python keeps annotations accessible at runtime.
