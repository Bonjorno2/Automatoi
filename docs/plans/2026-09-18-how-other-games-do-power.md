# How other games do power, and which shape Automatori should take

Date: 2026-09-18
Status: survey, before any decision

Not a plan. The prior art for a power system, gathered before designing one,
because the proposal on the table — runs that lose charge over distance, with a
gauge formula handed to the player — is **the one thing none of these four games
does**, and that is worth understanding before either doing it or dropping it.

---

## What each game actually does

### Factorio: one pool, no topology, graceful throttle

There is no voltage, no resistance and **no loss over distance**. A network is
effectively a single node: a consumer five tiles from the generators and one five
thousand tiles away draw identically. Poles define *connectivity and coverage*,
nothing else.

When supply falls short, every machine on the network slows **proportionally** —
an assembler wanting 210 kW and a drill wanting 90 kW on a 180 kW supply both run
at 60%. That falls out of a per-entity buffer rather than any circuit solver:
each machine refills a small internal buffer from the network each tick, and a
buffer that cannot fill is a machine that runs slow.

**Distance loss has been proposed to Wube repeatedly and rejected repeatedly**,
on two grounds. Performance: real transmission loss depends on distance *and*
current flow, which is a max-flow problem, and it has to stay fast in a factory
with a hundred thousand entities. And design: a flat per-pole drain is just a
constant resistor, which changes no decision anybody makes. Under the system they
kept, the bigger your single network the better — expansion is always rewarded.

### Satisfactory: one pool, binary failure

Also pooled, also no distance loss. The difference is what happens at the edge:
demand exceeds supply and **the fuse blows, taking the entire grid down** until a
human walks over and flips it back. No graceful degradation at all.

That is harsh enough that 1.0 shipped Priority Power Switches to mitigate it —
you assign sections to priority groups and the game sheds them in order rather
than killing everything. Tripped groups do **not** restore themselves, and
reconnecting a blown subgrid to a healthy one takes the healthy one down with it,
which is among the most complained-about behaviours in the game.

Worth stealing separately: Satisfactory **gives the player a formula and expects
them to use it.** Overclocking costs `power = base × (clock/100)^1.321928`, which
is `log₂(2.5)` chosen so that 250% clock is exactly 2× on a nuclear plant. It is
printed in the UI, the community builds calculators around it, and nobody
complains that arithmetic is required — because the *decision* it feeds (how many
buildings at what clock) has no single right answer.

### Mindustry: one pool, and a death spiral

Linear satisfaction like Factorio — at 50% supply everything runs at half speed,
after batteries drain. The twist is that **generators need power to make their own
fuel**, so a brownout can feed itself: less power, less fuel, less power. Impact
Reactors can black out and lose a sector.

Its one piece of topology is the **battery diode**: a one-way transfer between two
batteries, used to protect the circuit that keeps your reactor fed from the grid
that might collapse. It does not connect networks — it moves *stored* charge one
way. Small primitive, large expressive power, and the classic mistake is linking a
node across it and undoing the isolation you built.

### Oxygen Not Included: the one that models capacity

The outlier, and the closest thing to the proposal. **Wires have a carrying
capacity by tier** — 1 kW basic, 2 kW conductive, 20 kW heavi-watt — and a circuit
that exceeds its wire's rating **damages the wire**. Failure is local, visible and
dramatic rather than a bar going below 100%.

Two details that matter for us:

1. **The limit is on load, not on distance.** A long wire carries exactly what a
   short one does. ONI charges you for *how much* flows, never for *how far*.
2. **Transformers exist to make the problem tractable.** They partition the grid,
   capping what any downstream circuit can draw regardless of what is hung off it.
   Without that boundary, one global constraint would make every addition a
   whole-base problem — the design explicitly buys locality.

It is also the system players find fiddliest, and the fiddliness is exactly the
part a programming game gets to convert into code.

---

## What the survey actually says

**Nobody charges for distance, and one of them rejected it on the record.** That
is a real signal and it should not be waved away.

But the reason it fails in those games does not obviously transfer. In Factorio
the objection is that computing a per-run gauge is arithmetic a human has to
redo by hand on every line forever, which is tedium with no decision in it.
**Automatori is the game where that tedium is the content**: you compute it once,
write `gaugeFor(...)`, and hand it to a planner that applies it to every run you
will ever lay. The design's whole rhythm is a hands phase whose pain is tedium and
a mind phase that automates it. A formula that is miserable by hand and pleasant
in code is, for this game specifically, a feature rather than the objection.

**The consequence to go in with eyes open about:** loss over distance makes long
runs *bad*, so players build local generation at each outpost rather than one
spreading grid. That is not Factorio's shape — it is a map of self-sufficient
satellites. It may well be the chaos that is wanted, but it is a different chaos
and it should be chosen rather than discovered.

**And the thing every one of these systems has that we would need:** a world-side
signal at the moment of failure. Factorio has the satisfaction bar, Satisfactory
kills the lights, Mindustry visibly slows, ONI burns the wire in front of you. The
design's "failure is content" rule says a brownout that can only be discovered by
reading a number is not good enough.

---

## Four shapes for Automatori

### A. The pool (Factorio)

One network, total supply against total demand, proportional slowdown, distance
free. Poles have a reach and define connectivity only.

*For:* simplest to build and to read; no solver; graceful, uniform failure;
proven four times over. *Against:* topology is irrelevant, so it adds no reason
for the map to be big — power becomes "build more generators", a resource sink
with no spatial decision in it. **It uses none of what makes this game different.**

### B. Capacity per run (ONI)

A run carries only so much, set by its gauge. Exceed it and the run fails, locally
and visibly. An isolation block partitions the grid so an addition is a local
problem.

*For:* topology matters enormously; layout is a real puzzle; failure is local and
legible; and the load on a run **changes as the factory grows**, so the formula
never stops being live — which is the property that separates content from a
speed bump. *Against:* the fiddliest of the four by reputation, and it needs the
isolation primitive to be bearable.

### C. Loss over distance (the original proposal)

`loss = tiles × load / gauge`, handed to the player at the first brownout.

*For:* directly charges for distance, which is the sprawl pressure being chased;
gives exactly the formula-you-are-given-and-then-use feeling that Satisfactory's
overclock exponent gets right. *Against:* nobody does it, Wube rejected it twice
in public, and it makes expansion a tax rather than a reward — expect satellites,
not a grid.

### D. Capacity per run, distance charged in upkeep — **recommended**

B's carrying capacity, plus the tunable lattice, plus this: **distance costs
attention rather than efficiency.** A run delivers its full load whatever its
length — but a tuned run *drifts*, and a longer run drifts faster, because there
is more of it to hold. A fifty-tile superconducting trunk needs re-tuning far more
often than a five-tile spur.

The formula handed over is `capacity` against `load`, which is ONI's honest
question. Distance enters twice, both times without a solver: a long run costs
more lattice to build, and it costs more *maintenance* to keep.

*Why this one.* It keeps every good property from the survey and avoids the thing
all four games avoided. Failure is local and visible — a run that has drifted
browns out the machines at its end, and those visibly slow, which is Factorio's
legibility with ONI's locality. Expansion is still rewarded, not taxed. And the
cost it charges is **attention**, which is the one currency this game is uniquely
able to make interesting: attention is what a script takes off your hands. A
planner that surveys the grid, computes required gauge, and dispatches bots to
re-tune what has sagged is cycle 5 again, one layer up, and it gets harder exactly
as the map gets bigger.

---

## Sources

- [Factorio: Electric system](https://wiki.factorio.com/Electric_system)
- [Factorio forums: Energy Loss Over Distance](https://forums.factorio.com/viewtopic.php?t=119)
- [Factorio forums: Cable Resistance / Non-lossless Power Transmission](https://forums.factorio.com/viewtopic.php?t=15546)
- [Satisfactory: Clock speed](https://satisfactory.wiki.gg/wiki/Clock_speed)
- [Satisfactory: Priority Power Switch](https://satisfactory.wiki.gg/wiki/Priority_Power_Switch)
- [Mindustry: Power](https://mindustry-unofficial.fandom.com/wiki/Power)
- [Mindustry: Battery Diode](https://mindustry-unofficial.fandom.com/wiki/Battery_Diode)
- [Oxygen Not Included: Guide/Power Circuits](https://oxygennotincluded.wiki.gg/wiki/Guide/Power_Circuits)
- [Oxygen Not Included: Power Transformer](https://oxygennotincluded.wiki.gg/wiki/Power_Transformer)
