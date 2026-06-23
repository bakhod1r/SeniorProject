# Abstract Factory — Find the Bug

> **Source:** [refactoring.guru/design-patterns/abstract-factory](https://refactoring.guru/design-patterns/abstract-factory)

12 buggy snippets distributed across Go, Java, Python.

---

## Bug 1: Mixed Variants Within One Factory (Java)

```java
class WindowsGuiFactory implements GuiFactory {
    public Button   createButton()   { return new WindowsButton(); }
    public Checkbox createCheckbox() { return new MacCheckbox(); }   // BUG
}
```

**Symptoms:** UI looks half Windows, half Mac. No compiler error — both classes implement the right interface.

<details><summary>Find the bug</summary>

`createCheckbox` returns a `MacCheckbox` instead of a `WindowsCheckbox`. Type system doesn't catch family mismatches.

</details>

### Fix

```java
public Checkbox createCheckbox() { return new WindowsCheckbox(); }
```

### Lesson

Test every Concrete Factory: `assertThat(f.createCheckbox()).isInstanceOf(WindowsCheckbox.class);`. Family consistency is structural, not enforced.

---

## Bug 2: Forgot to Update One Factory (Java)

```java
interface GuiFactory {
    Button   createButton();
    Checkbox createCheckbox();
    Slider   createSlider();   // newly added
}

class WindowsGuiFactory implements GuiFactory {
    public Button   createButton()   { return new WindowsButton(); }
    public Checkbox createCheckbox() { return new WindowsCheckbox(); }
    public Slider   createSlider()   { return new WindowsSlider(); }
}

class MacGuiFactory implements GuiFactory {
    public Button   createButton()   { return new MacButton(); }
    public Checkbox createCheckbox() { return new MacCheckbox(); }
    // BUG: missing createSlider — won't compile
}
```

**Symptoms:** Compile error: `MacGuiFactory must implement createSlider`.

<details><summary>Find the bug</summary>

This is the *abstract factory dilemma*. Adding a new product type forces updates to *every* Concrete Factory.

</details>

### Fix

Add `createSlider` to all Concrete Factories. Or, for backward compat, use a default method:

```java
interface GuiFactory {
    Button   createButton();
    Checkbox createCheckbox();
    default Slider createSlider() {
        throw new UnsupportedOperationException("This factory doesn't support sliders");
    }
}
```

### Lesson

Plan family axes carefully. New product types are expensive.

---

## Bug 3: Direct Constructor in Client Code (Java)

```java
public void renderToolbar(GuiFactory factory) {
    Button save = factory.createButton();
    Button cancel = new HtmlButton();   // BUG
    save.render();
    cancel.render();
}
```

**Symptoms:** `cancel` is always HTML regardless of the factory.

<details><summary>Find the bug</summary>

Direct `new HtmlButton()` bypasses the factory. Family consistency violated.

</details>

### Fix

```java
Button cancel = factory.createButton();
```

### Lesson

Search for `new ConcreteX(` in client code. None should remain after Abstract Factory adoption.

---

## Bug 4: Race in Singleton Concrete Factory (Java)

```java
public class WindowsGuiFactory implements GuiFactory {
    private static WindowsGuiFactory INSTANCE;
    private WindowsGuiFactory() {}
    public static WindowsGuiFactory getInstance() {
        if (INSTANCE == null) {
            INSTANCE = new WindowsGuiFactory();   // BUG: race
        }
        return INSTANCE;
    }
}
```

**Symptoms:** Under concurrent first-access, two factories might be created.

<details><summary>Find the bug</summary>

Lazy singleton without synchronization. Both threads see null, both construct.

</details>

### Fix

```java
private static class Holder { static final WindowsGuiFactory INSTANCE = new WindowsGuiFactory(); }
public static WindowsGuiFactory getInstance() { return Holder.INSTANCE; }
```

Or use enum singleton. See [Singleton](../05-singleton/junior.md).

### Lesson

If your factory is a singleton, use a thread-safe singleton implementation.

---

## Bug 5: Cross-Product Reference Breaks Type Safety (Java)

```java
class WindowsCheckbox implements Checkbox {
    private final Button parent;
    public WindowsCheckbox(Button parent) { this.parent = parent; }
}

class WindowsGuiFactory implements GuiFactory {
    public Button   createButton()   { return new WindowsButton(); }
    public Checkbox createCheckbox() {
        return new WindowsCheckbox(new MacButton());   // BUG
    }
}
```

**Symptoms:** WindowsCheckbox accepts a parent Button, but it's a MacButton — visual confusion.

<details><summary>Find the bug</summary>

The factory creates a wrong-variant cross-reference. Type system permits because both implement `Button`.

</details>

### Fix

```java
public Checkbox createCheckbox() {
    return new WindowsCheckbox(createButton());
}
```

Or pass a typed reference (with a generic-typed factory).

### Lesson

Cross-product references are a code smell. If unavoidable, the factory must coordinate them within the same family.

---

## Bug 6: Product Stored in Wrong Variant Field (Python)

```python
class App:
    def __init__(self, factory: ThemeFactory):
        self.button: WinButton = factory.make_button()   # BUG: type hint lies
        self.checkbox = factory.make_checkbox()
```

**Symptoms:** `mypy` warnings ignored; runtime AttributeError when `WinButton`-specific method is called on a `MacButton`.

<details><summary>Find the bug</summary>

The type annotation `WinButton` is too narrow. `factory.make_button()` returns `Button`, not specifically `WinButton`.

</details>

### Fix

```python
self.button: Button = factory.make_button()
```

### Lesson

Type hints must match the abstract factory's return type, not assume a specific variant.

---

## Bug 7: Factory Caches Mutable Products (Go)

```go
type GUIFactory interface{ CreateButton() Button }

type winFactory struct{}

var sharedButton = &winButton{label: ""}

func (winFactory) CreateButton() Button {
    return sharedButton   // BUG: shared mutable
}
```

**Symptoms:** Setting `b1.label = "Save"` also changes `b2.label` because they're the same object.

<details><summary>Find the bug</summary>

The factory returns the same instance every call. Callers expect fresh objects (or at least immutable shared ones).

</details>

### Fix

```go
func (winFactory) CreateButton() Button {
    return &winButton{label: ""}
}
```

Or document that the product is immutable and never mutated.

### Lesson

Document factory contract: fresh per call, or shared. Cached mutable singletons are a bug factory.

---

## Bug 8: ServiceLoader Returns Wrong Concrete (Java)

```java
ServiceLoader<GuiFactory> loader = ServiceLoader.load(GuiFactory.class);
GuiFactory chosen = loader.iterator().next();   // BUG: takes the first one
```

**Symptoms:** On Mac, the app uses Windows widgets because the Windows JAR was loaded first.

<details><summary>Find the bug</summary>

`ServiceLoader` doesn't filter — it returns whatever providers register. The first one isn't necessarily the right one.

</details>

### Fix

```java
GuiFactory chosen = loader.stream()
    .map(ServiceLoader.Provider::get)
    .filter(f -> f.platform().equals(detectOs()))
    .findFirst()
    .orElseThrow();
```

### Lesson

`ServiceLoader` discovers; **filtering is your job**. Add a `platform()` or `name()` method to the factory interface to enable selection.

---

## Bug 9: Plugin Classloader Leak (Java)

```java
public class PluginManager {
    private static final List<GuiFactory> registered = new ArrayList<>();

    public void load(URL jar) throws Exception {
        URLClassLoader cl = new URLClassLoader(new URL[]{jar});
        Class<?> c = cl.loadClass("com.x.MyFactory");
        registered.add((GuiFactory) c.getDeclaredConstructor().newInstance());
    }

    public void unload(int idx) {
        registered.remove(idx);   // BUG: doesn't release classloader
    }
}
```

**Symptoms:** Memory grows after each plugin load/unload cycle. Eventually `OutOfMemoryError: Metaspace`.

<details><summary>Find the bug</summary>

Removing the factory from the list isn't enough — internal references (caches, classloaders, registered services) keep the plugin classloader alive.

</details>

### Fix

```java
private static class PluginEntry {
    final URLClassLoader cl;
    GuiFactory factory;
    PluginEntry(URLClassLoader cl, GuiFactory f) { this.cl = cl; this.factory = f; }
}

public void unload(int idx) throws IOException {
    PluginEntry e = registered.remove(idx);
    e.factory = null;
    e.cl.close();
}
```

Plus: ensure all factory products are released before unloading.

### Lesson

Plugin systems require explicit lifecycle. Removing a reference doesn't free the classloader — close the loader and verify GC reclaims it.

---

## Bug 10: Abstract Factory Mistake — Returns Concrete Type (Java)

```java
interface GuiFactory {
    WindowsButton createButton();   // BUG: concrete return type
    Checkbox      createCheckbox();
}

class MacGuiFactory implements GuiFactory {
    public WindowsButton createButton() { return new WindowsButton(); }   // forced!
    public Checkbox      createCheckbox() { return new MacCheckbox(); }
}
```

**Symptoms:** Mac factory must return `WindowsButton`. Defeats the entire pattern.

<details><summary>Find the bug</summary>

The interface declares a concrete return type. Concrete Factories are bound to that concrete type.

</details>

### Fix

```java
interface GuiFactory {
    Button   createButton();   // abstract
    Checkbox createCheckbox();
}
```

### Lesson

Abstract Factory's return types must always be abstract.

---

## Bug 11: Python Factory Returns From Wrong Family (Python)

```python
@theme("dark")
class DarkTheme(ThemeFactory):
    def make_button(self):   return DarkButton()
    def make_checkbox(self): return LightCheckbox()   # BUG
```

**Symptoms:** A "dark" theme has a light checkbox. UI inconsistency.

<details><summary>Find the bug</summary>

Same as Bug 1 — wrong variant. Python's dynamic typing makes this even harder to catch.

</details>

### Fix

```python
def make_checkbox(self): return DarkCheckbox()
```

### Lesson

Per-Concrete-Factory unit test. Python doesn't even give compile-time hints.

---

## Bug 12: Stale Product After Hot-Swap (Java)

```java
public class App {
    private final GuiFactory factory;
    private final Button persistentButton;   // stored at construction

    public App(GuiFactory factory) {
        this.factory = factory;
        this.persistentButton = factory.createButton();
    }

    public void switchTheme(GuiFactory next) {
        // BUG: doesn't refresh persistentButton
        // (assume reflection sets factory)
    }
}
```

**Symptoms:** After theme switch, `persistentButton` is still the old style.

<details><summary>Find the bug</summary>

Products created at one time can't reflect later factory swaps. The button is a snapshot.

</details>

### Fix — Don't store products

```java
private Button currentButton() { return factory.createButton(); }
```

### Fix — Notify and recreate

```java
public void switchTheme(GuiFactory next) {
    factory = next;
    persistentButton = factory.createButton();   // refresh
    notifyObservers();
}
```

### Lesson

Hot-swap is a contract: existing products stay; future ones are new variants. Or, maintain a registry of products to refresh.

---

## Practice Tips

1. **Test family consistency for every Concrete Factory.**
2. **Hunt for `new ConcreteX(` in client code.**
3. **Run `go test -race`, `mypy`, JMH** to catch language-specific bugs.
4. **Log factory selection at startup** — "Using AwsFactory" — so deployment errors are obvious.

---

[← Tasks](tasks.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
