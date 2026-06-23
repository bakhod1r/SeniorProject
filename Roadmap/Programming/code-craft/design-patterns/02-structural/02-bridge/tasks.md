# Bridge — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/bridge](https://refactoring.guru/design-patterns/bridge)

Each task includes: a brief, the dimensions, and a reference solution. Try each before reading the solution.

---

## Table of Contents

1. [Task 1: Shape × Renderer](#task-1-shape-renderer)
2. [Task 2: Notification × Channel](#task-2-notification-channel)
3. [Task 3: Logger × Sink](#task-3-logger-sink)
4. [Task 4: Repository × Storage](#task-4-repository-storage)
5. [Task 5: Refactor Class Explosion](#task-5-refactor-class-explosion)
6. [Task 6: Three-Hierarchy Bridge](#task-6-three-hierarchy-bridge)
7. [Task 7: Theme × Widget](#task-7-theme-widget)
8. [Task 8: Document × Storage × Renderer](#task-8-document-storage-renderer)
9. [Task 9: Bridge with Decorated Implementor](#task-9-bridge-with-decorated-implementor)
10. [Task 10: Cross-Platform Beep](#task-10-cross-platform-beep)
11. [How to Practice](#how-to-practice)

---

## Task 1: Shape × Renderer

**Brief.** The textbook example. Two shapes, two renderers, no class explosion.

### Solution (Go)

```go
package main

import "fmt"

type Renderer interface {
    Circle(r float64)
    Square(s float64)
}

type Vector struct{}
func (Vector) Circle(r float64) { fmt.Printf("vector circle r=%.1f\n", r) }
func (Vector) Square(s float64) { fmt.Printf("vector square s=%.1f\n", s) }

type Raster struct{}
func (Raster) Circle(r float64) { fmt.Printf("raster circle r=%.1f\n", r) }
func (Raster) Square(s float64) { fmt.Printf("raster square s=%.1f\n", s) }

type Shape interface{ Draw() }

type Circle struct{ r Renderer; size float64 }
func (c Circle) Draw() { c.r.Circle(c.size) }

type Square struct{ r Renderer; size float64 }
func (s Square) Draw() { s.r.Square(s.size) }

func main() {
    for _, s := range []Shape{
        Circle{r: Vector{}, size: 5},
        Square{r: Raster{}, size: 3},
    } {
        s.Draw()
    }
}
```

### Notice

- Adding `Triangle` is one struct; adding `Svg` is one struct.
- Renderers are stateless — safe to share.

---

## Task 2: Notification × Channel

**Brief.** Build `Welcome`, `Receipt`, `Alert` × `Email`, `Sms`, `Slack`.

### Solution (Java)

```java
public interface Channel {
    void send(String to, String subject, String body);
}

public final class EmailChannel implements Channel {
    public void send(String to, String subject, String body) {
        System.out.printf("EMAIL %s | %s | %s%n", to, subject, body);
    }
}
public final class SmsChannel implements Channel {
    public void send(String to, String subject, String body) {
        System.out.printf("SMS %s | %s%n", to, subject + " " + body);
    }
}
public final class SlackChannel implements Channel {
    public void send(String to, String subject, String body) {
        System.out.printf("SLACK #%s [%s] %s%n", to, subject, body);
    }
}

public abstract class Notification {
    protected final Channel ch;
    protected Notification(Channel ch) { this.ch = ch; }
    public abstract void send(String to);
}

public final class Welcome extends Notification {
    public Welcome(Channel c) { super(c); }
    public void send(String to) { ch.send(to, "Welcome", "Glad you joined!"); }
}
public final class Receipt extends Notification {
    private final long cents;
    public Receipt(Channel c, long cents) { super(c); this.cents = cents; }
    public void send(String to) { ch.send(to, "Receipt", "Charged $" + cents/100.0); }
}
```

### Notice

- 3 + 3 = 6 classes; cross-product would be 9.
- The Channel interface has one method — minimal contract.

---

## Task 3: Logger × Sink

**Brief.** A tiny logging library with two refined loggers and three sinks.

### Solution (Python)

```python
from abc import ABC, abstractmethod
from datetime import datetime, timezone


class Sink(ABC):
    @abstractmethod
    def emit(self, level: str, msg: str) -> None: ...


class ConsoleSink(Sink):
    def emit(self, level, msg):
        print(f"{datetime.now(timezone.utc).isoformat()} [{level}] {msg}")


class FileSink(Sink):
    def __init__(self, path): self.path = path
    def emit(self, level, msg):
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} [{level}] {msg}\n")


class JsonSink(Sink):
    def __init__(self, sink): self.sink = sink
    def emit(self, level, msg):
        import json
        self.sink.emit(level, json.dumps({"level": level, "msg": msg}))


class Logger:
    def __init__(self, sink: Sink, name: str = "root"):
        self._sink, self._name = sink, name
    def info(self, msg): self._sink.emit("INFO", f"{self._name}: {msg}")
    def error(self, msg): self._sink.emit("ERROR", f"{self._name}: {msg}")


class StructuredLogger(Logger):
    def info(self, msg, **fields):
        self._sink.emit("INFO", f"{self._name}: {msg} {fields}")
```

### Notice

- `JsonSink` is a Decorator-shaped wrapper around any Sink — Bridge composes with Decorator.
- `StructuredLogger` shows a Refined Abstraction extending the base.

---

## Task 4: Repository × Storage

**Brief.** A user repository that runs on Postgres in prod and in-memory in tests.

### Solution (Go)

```go
type UserStorage interface {
    Save(ctx context.Context, u User) error
    Load(ctx context.Context, id string) (User, error)
}

type pgStorage struct{ db *sql.DB }
func (p *pgStorage) Save(ctx context.Context, u User) error {
    _, err := p.db.ExecContext(ctx, "INSERT INTO users(id, name, email) VALUES($1,$2,$3)", u.ID, u.Name, u.Email)
    return err
}
func (p *pgStorage) Load(ctx context.Context, id string) (User, error) {
    var u User
    err := p.db.QueryRowContext(ctx, "SELECT id, name, email FROM users WHERE id=$1", id).Scan(&u.ID, &u.Name, &u.Email)
    return u, err
}

type memStorage struct{ mu sync.RWMutex; m map[string]User }
func newMemStorage() *memStorage { return &memStorage{m: make(map[string]User)} }
func (s *memStorage) Save(ctx context.Context, u User) error {
    s.mu.Lock(); defer s.mu.Unlock()
    s.m[u.ID] = u; return nil
}
func (s *memStorage) Load(ctx context.Context, id string) (User, error) {
    s.mu.RLock(); defer s.mu.RUnlock()
    u, ok := s.m[id]; if !ok { return User{}, fmt.Errorf("not found") }
    return u, nil
}

type UserRepository struct{ s UserStorage; clock func() time.Time }

func (r *UserRepository) Register(ctx context.Context, name, email string) (User, error) {
    u := User{ID: uuid.NewString(), Name: name, Email: email, CreatedAt: r.clock()}
    return u, r.s.Save(ctx, u)
}
```

### Notice

- The repo's logic (UUID generation, clock injection) lives in the abstraction.
- I/O (SQL, map locking) lives in the implementor.
- Tests construct `&UserRepository{s: newMemStorage(), clock: time.Now}` — no SQL.

---

## Task 5: Refactor Class Explosion

**Brief.** Given `WindowsButton`, `LinuxButton`, `WindowsCheckbox`, `LinuxCheckbox`, refactor.

### Before

```java
public class WindowsButton    { public void render() { /* win paint */ } public void click() { /* win event */ } }
public class LinuxButton      { public void render() { /* x11 paint */ } public void click() { /* x11 event */ } }
public class WindowsCheckbox  { public void render() { /* win paint */ } public void toggle() { /* win event */ } }
public class LinuxCheckbox    { public void render() { /* x11 paint */ } public void toggle() { /* x11 event */ } }
```

### After

```java
public interface Platform {
    void paint(Widget w);
    void registerEvent(Widget w, String type);
}
public class WindowsPlatform implements Platform { ... }
public class LinuxPlatform implements Platform { ... }

public abstract class Widget {
    protected final Platform p;
    protected Widget(Platform p) { this.p = p; }
    public void render() { p.paint(this); }
}

public final class Button extends Widget {
    public Button(Platform p) { super(p); }
    public void click() { p.registerEvent(this, "click"); }
}
public final class Checkbox extends Widget {
    public Checkbox(Platform p) { super(p); }
    public void toggle() { p.registerEvent(this, "toggle"); }
}
```

### Notice

- 4 classes → 5 (with the abstract base; 6 with the interface).
- Adding macOS: 1 class. Adding Slider: 1 class.

---

## Task 6: Three-Hierarchy Bridge

**Brief.** Notification × Channel × Provider, two bridges nested.

### Solution sketch (see Interview Q42 for full version)

```
Notification (Welcome, Receipt, Alert)
   ↓ has-a
Channel (Email, Sms)
   ↓ has-a
Provider (Mailgun, Twilio, AwsSes)
```

Each axis is independent. Adding a new provider doesn't touch channels or notifications.

---

## Task 7: Theme × Widget

**Brief.** A small UI library: `Button` and `Label` with `Light` and `Dark` themes.

### Solution (Python)

```python
class Theme(ABC):
    @abstractmethod
    def background(self) -> str: ...
    @abstractmethod
    def foreground(self) -> str: ...

class LightTheme(Theme):
    def background(self): return "#ffffff"
    def foreground(self): return "#000000"

class DarkTheme(Theme):
    def background(self): return "#000000"
    def foreground(self): return "#ffffff"

class Widget(ABC):
    def __init__(self, theme: Theme): self.theme = theme
    @abstractmethod
    def render(self) -> str: ...

class Button(Widget):
    def __init__(self, theme, label): super().__init__(theme); self.label = label
    def render(self):
        return f'<button bg="{self.theme.background()}" fg="{self.theme.foreground()}">{self.label}</button>'

class Label(Widget):
    def __init__(self, theme, text): super().__init__(theme); self.text = text
    def render(self):
        return f'<span fg="{self.theme.foreground()}">{self.text}</span>'
```

### Notice

- Switching theme = swap the implementor.
- Adding `HighContrastTheme` for accessibility is one class.

---

## Task 8: Document × Storage × Renderer

**Brief.** A document holds two implementors: how it's saved and how it's rendered.

### Solution (Java)

```java
public interface Storage  { void save(String id, byte[] content); byte[] load(String id); }
public interface Renderer { String render(Document doc); }

public abstract class Document {
    protected final Storage storage;
    protected final Renderer renderer;
    protected final String id;

    protected Document(String id, Storage storage, Renderer renderer) {
        this.id = id; this.storage = storage; this.renderer = renderer;
    }

    public abstract String content();

    public void save() { storage.save(id, content().getBytes(StandardCharsets.UTF_8)); }
    public String view() { return renderer.render(this); }
}

public final class TextDocument extends Document {
    private final String text;
    public TextDocument(String id, String text, Storage s, Renderer r) {
        super(id, s, r); this.text = text;
    }
    public String content() { return text; }
}
```

### Notice

- Two implementors held by one abstraction — a real production case.
- If they need to coordinate (transactional save), the abstraction becomes the coordinator. Bridge starts to bend toward Mediator.

---

## Task 9: Bridge with Decorated Implementor

**Brief.** Wrap a concrete implementor in retries and metrics decorators without changing the abstraction.

### Solution (Go)

```go
type Storage interface { Save(ctx context.Context, k string, v []byte) error }

type s3Storage struct{ /* ... */ }
func (s *s3Storage) Save(ctx context.Context, k string, v []byte) error { /* ... */ }

type retrying struct{ inner Storage; attempts int }
func (r *retrying) Save(ctx context.Context, k string, v []byte) error {
    var err error
    for i := 0; i < r.attempts; i++ {
        err = r.inner.Save(ctx, k, v)
        if err == nil { return nil }
    }
    return err
}

type metered struct{ inner Storage; m Metrics }
func (m *metered) Save(ctx context.Context, k string, v []byte) error {
    start := time.Now()
    err := m.inner.Save(ctx, k, v)
    m.m.RecordLatency("save", time.Since(start))
    if err != nil { m.m.IncErrors("save") }
    return err
}

storage := &metered{inner: &retrying{inner: &s3Storage{...}, attempts: 3}, m: metrics}
```

### Notice

- The abstraction sees only `Storage`. Decorators stack on the implementor side.
- This is the same Decorator stack you'd build around an Adapter — Bridge composes with Decorator.

---

## Task 10: Cross-Platform Beep

**Brief.** A `Sound` abstraction with `Beep`, `Chime`, `Alarm`, played on a `Speaker` (PC, mobile, headless test).

### Solution (Python)

```python
class Speaker(ABC):
    @abstractmethod
    def play(self, freq_hz: int, ms: int) -> None: ...

class PcSpeaker(Speaker):
    def play(self, freq_hz, ms): print(f"PC speaker: {freq_hz}Hz for {ms}ms")

class MobileSpeaker(Speaker):
    def play(self, freq_hz, ms): print(f"Mobile haptic+sound: {freq_hz}Hz for {ms}ms")

class TestSpeaker(Speaker):
    def __init__(self): self.calls = []
    def play(self, freq_hz, ms): self.calls.append((freq_hz, ms))

class Sound:
    def __init__(self, speaker: Speaker): self._sp = speaker

class Beep(Sound):
    def play(self): self._sp.play(440, 100)

class Alarm(Sound):
    def play(self):
        for _ in range(3): self._sp.play(880, 200)
```

### Notice

- `TestSpeaker` is a recording fake — Bridge enables this naturally.
- Adding `Chime` is one class; adding `LinuxSpeaker` is one class.

---

## How to Practice

1. **Pick a task; write before checking.** Bridge is easy to follow but harder to design — practice picking the right cut.
2. **For each task, decide what's "abstraction" and what's "implementor" *before* writing.** Wrong cuts are the bug.
3. **Add a third member to each side.** Verify it's still 1-class additions.
4. **Wire a real run.** A `main` that exercises 2-3 combinations confirms the bridge is functional.
5. **Test through fakes.** Recording fakes let you assert call sequences without real I/O.
6. **Re-read your code in 24h.** If you can't immediately spot the two hierarchies and the link, the names need work.
7. **Compare with Adapter and Strategy.** For each task, ask: "would this also work as Adapter or Strategy?" If yes, why is Bridge the better name?

---

← Back to Bridge folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Bridge — Find the Bug](find-bug.md)
