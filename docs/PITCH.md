# The three-minute run

Three minutes does not fit a tour of the product. It fits **one complete lap**: a real
lecture becomes a world, a question exposes a belief, the class answers back.

Everything below is verified against the deployed API, not assumed.

---

## The one world to open

**"What Is Machine Learning?"** — `5cf64d290e8241e79cae70e167843de0`, on the *Machine Learning*
server (join code `S9CDPJ`). Six concepts, seven questions, eleven people in the class.

```
https://classquest.net/world/5cf64d290e8241e79cae70e167843de0
```

**Do not open world 1, "Course Foundations & Logistics".** It is the unit outline — teaching
team, assessment, academic integrity. Opening it shows a game about *the rules of a unit*
instead of a game about machine learning, and it is the world the owner had been testing with.

**Do not open world 3, "Learning Paradigms"** either, unless you want it. Its questions
illustrate with signposts and chests; only *this* world draws the plotted curve, on five of
its seven questions.

---

## Before you stand up

The fourth door opens only after the other three are cleared, and the reading receipt lives in
**that browser's local storage**. So clear the world once, on the demo machine, in the browser
you will present from:

1. Open the world, walk into **Storybook** and page through **every** concept (arrow keys).
2. Walk into **Quiz** and answer until it passes.
3. Walk into **Explain to Win** and finish one conversation.
4. Confirm the fourth door is lit and says *"See what stuck, and how the class did."*

Then leave it open at the hub. Also check, in this order:

- `curl https://api.classquest.net/health` → `{"db":"ok","llm":"live"}`
- You are signed in as **yourself**, not a seeded classmate.
- Zoom out to 100%, full screen, sound off.

---

## The run

**0:00 — 0:25 · The problem, once**

> "Everyone has sat through a lecture, nodded, and found out at the exam that they had
> understood one thing backwards the whole time. Nothing in the lecture ever asks you to
> commit, so nothing ever catches it."

**0:25 — 0:50 · It is a real unit**

Show the world loading. Say the thing that matters:

> "This is my actual machine learning unit. I uploaded the slides. Everything you are about to
> see — the concepts, the questions, the wrong answers — was built from them."

Walk a few steps. Three doors: read it, be asked about it, explain it to someone.

**0:50 — 1:50 · The lap that sells it**

Walk into **Quiz**. Get to *"Calculating payroll tax from a known formula. Reach for ML?"*

Read it to the room. Let them answer in their heads — everyone can.

**Commit the wrong one: "Yes, ML handles it better."** Deliberately. The diagnosis is the
product; a correct answer shows almost nothing.

What comes back names the belief you just demonstrated, why it was tempting, what is true
instead, and a verbatim line from the uploaded slides.

> "It didn't mark me wrong. It told me *what I believe* — and it can point at the line in my
> own slides that says otherwise."

Then the class answers underneath: how the other ten answered the same question, and which
wrong idea most of them chose.

> "Multiply that by a cohort and a lecturer knows what to re-teach on Monday — before the exam,
> not after it."

**1:50 — 2:25 · The ending**

Walk to the fourth door. The closing summary: which ideas actually stuck — **answered
correctly, not merely visited** — the XP the server issued, and where you sit in the class.

**2:25 — 3:00 · Land it**

> "Any lecture, any subject, about a minute to build. It reads the material, finds the ideas,
> and writes the wrong answers that are worth getting wrong. That last part is the hard part,
> and it is the part we do."

---

## Traps

- **`Esc` on the map leaves the world.** Inside a portal it closes the portal. Getting out by
  accident costs a full page load. Use the buttons on stage.
- **Explain to Win is a live model: about three seconds a turn, two to four turns.** That is
  ten to fifteen seconds of silence. Mention it, do not perform it, unless you are ahead of
  the clock.
- **Do not answer a question you have already answered** looking for XP. Repeats award zero,
  by design, and the screen says so.
- **The class needs three answers on a question** before it will draw a distribution. The
  seeded cohort covers every question, so this only bites on a world nobody has played.

## If something breaks

| Breaks | Do |
|---|---|
| The site is down | `https://classquest.net/world?demo=1` — the bundled fixture, no API at all |
| The class shows nothing | Keep going. It degrades silently and the rest of the world is unaffected |
| The chat hangs | It falls back to the offline student on its own. Do not reload |
| You are ejected to the picker | The row you want is under *Machine Learning*, second one |

## Reset between runs

Answers and XP are on the server and **do not reset** — that is the point, and a second run
simply shows history. What you can reset is the browser's reading receipt, if you want the
fourth door sealed again for a fresh audience:

```js
localStorage.removeItem('cq.portals.5cf64d290e8241e79cae70e167843de0')
```
