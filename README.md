# Automatoi

A factory game whose only control is a text editor. You are given one bot, one
field of wheat and a console that wants wheat. Everything the bot does, it does
because you wrote a line of JavaScript telling it to.

**Play it: <https://bonjorno2.github.io/Automatoi/>**

The game teaches its own language. It opens with a single line — `bot.move("east")`
— and hands over the next one only once you have run the last, so the first ten
minutes are eight steps long and end with a bot that farms, deposits and queues
its own research. After that the codebook stops leading: it offers a rung when
something you did suggests one, and says nothing the rest of the time.

Research is hardware. A planter, a scanner, a radio, a builder and a fabricator
each unlock a piece of the API rather than a number, so the tech tree is the
language growing. Saving is a code you can read out loud, because a script made
of lines the game already knows costs a handful of characters to write down.

## Running it

```bash
npm install
npm run dev
```

`npm test` runs the suite. `npm run build` produces `dist/`, which the Pages
workflow publishes on every push to `master`.

## How it is put together

Each bot's script runs in its own worker and blocks on `Atomics.wait` against a
`SharedArrayBuffer`, which is why `while (true)` is a reasonable thing for a
player to write: the script is suspended between actions rather than spinning,
and the page stays responsive. That needs a cross-origin isolated page, and
GitHub Pages cannot send the headers that grant it — `public/coi-serviceworker.js`
installs them from a service worker instead.

The simulation is deterministic and headless, and is tested that way; the
renderer reads a fresh snapshot each frame and holds no reference to anything
alive.
