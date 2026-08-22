# ClassQuest data contract

**This is the parallelisation boundary. Agree it first, then everyone can work.**

Front end builds against `fixtures/`. Back end targets `schema/`. Neither waits for the other. Do this before deciding the stack, because it is true regardless of which stack you pick.

## Files

| File | What it is |
|---|---|
| `schema/course-graph.schema.json` | Stage 2 output. The learning-objective graph: concepts, prerequisites, Bloom level, source grounding, misconceptions. |
| `schema/game.schema.json` | Stage 4 output. A playable game. References the graph and the fixed visual vocabulary. |
| `fixtures/overfitting.graph.json` | A real filled graph, 5 ML concepts. Hand written, no model involved. |
| `fixtures/overfitting.quest.json` | The Quest archetype built from that graph. |
| `fixtures/overfitting.gauntlet.json` | The Gauntlet archetype built from **the same** graph. |
| `schema/validate.py` | Validates everything. `python3 schema/validate.py` from the repo root. |

## The one thing to understand

`overfitting.quest.json` and `overfitting.gauntlet.json` carry the **same `graph_id`**. One extraction, two games, no second pass over the source document.

That is the entire architectural claim, and it is checked by the validator. If a change ever breaks that property, the design has drifted.

## Why the fields are shaped this way

**`misconceptions` on every concept.** These become the distractors in prediction scenes. Every incorrect option carries a `misconception_id` pointing back at the belief it came from, which is enforced by the schema. This is what makes a cohort answer distribution diagnostic: knowing that 52 percent picked `high_train_high_test` tells an educator exactly what to reteach. Distractors invented at scene-generation time cannot do that.

**`source_spans` on every concept.** Grounding. The `quote` must occur verbatim in the referenced segment. A concept that cannot point at its source is a hallucination and gets dropped before it reaches a learner. A wrong fact inside a quiz is worse than no quiz, because retrieval practice rehearses it.

**Enums for `background`, `prop`, `actor`, `widget`.** The model picks from a hand-built vocabulary and never emits CSS, colour or layout. Presentation bugs become schema errors caught before render rather than on stage.

**`prerequisites` rather than an order.** The graph stores the partial order. Choosing one of its many valid topological sorts is the narrative planner's job, and it optimises that choice for story cohesion. Storing a fixed order here would throw away the freedom the planner needs.

## What the validator checks beyond the schema

1. Concept ids unique.
2. Prerequisites resolve, and the graph is acyclic. A cycle is a hard failure: the planner cannot sort it.
3. Every `concept_id` and `misconception_id` in a game resolves in the graph.
4. Exactly one correct option per prediction scene.
5. Chapter order respects prerequisite order. Teaching a concept before its prerequisite is a bug even if the JSON is well formed.

Verified by injecting faults: it catches all five classes.

## Not built this weekend

Assessment item generation. The graph is the test blueprint, so pre and post items would be generated against the same extracted objectives, but no pilot runs before Sunday (see proposal Section 5). Not worth building.
