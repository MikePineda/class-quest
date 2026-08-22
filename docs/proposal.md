# ClassQuest: Generating Narrative Learning Games from Course Content

**Internal research proposal, v1**
Team: 5 AI masters students, Queensland University of Technology, Brisbane
Hackathon theme: Innovation that helps
Deadline: Sunday 3PM

---

## 0. Summary

Passive delivery of course material has a measurable cost: across 225 studies, undergraduate STEM failure rates fell from 34% to 22% when active learning replaced traditional lecturing (Freeman et al., 2014). The fix is known. What is missing is that authoring active, retrieval-based material is expensive, so most course content stays a slide deck.

ClassQuest takes uploaded course content and returns a playable narrative learning game. Our positioning claim, and the thing that separates us from a crowded market:

> **Competitors generate `content -> questions -> game skin`. ClassQuest generates `content -> learning-objective graph -> narrative arc -> shared playable scenes`.**

The learning-objective graph is an explicit intermediate representation: concepts, prerequisite dependencies, Bloom level, and likely learner misconceptions. Separating pedagogy from presentation is what makes the output teachable, affordable, and measurable.

The meta-analytic literature identifies two design features that moderate gamification's effect on behavioural learning outcomes: **game fiction** and **social interaction**, with competition combined with collaboration performing best (Sailer and Homner, 2020). ClassQuest is built to generate both in a single artifact: a narrative you play through, and a cohort you play it with. No product in the scanned market does either well, and none does both.

---

## 1. Problem and motivation

**Passive instruction underperforms, and the effect is large.** Freeman et al. (2014) meta-analysed 225 studies of undergraduate STEM courses and found examination performance increased by 0.47 standard deviations under active learning, while the odds of failing under traditional lecturing were 1.95 times higher. Average failure rates dropped from 34% to 22%. This is not a marginal effect and it holds across STEM disciplines and class sizes.

**Australian engagement data shows the same weak point.** The 2024 QILT Student Experience Survey, covering over 158,000 undergraduate and 99,000 postgraduate coursework students, rated undergraduate Overall Quality of Educational Experience at 76.5%. Peer Engagement, by contrast, sat at 60.2% (QILT, 2024). Engagement is consistently the softest indicator in the national picture, not satisfaction. Retention across Australian Table A institutions was 86.1% in 2023, implying roughly 13.9% attrition, and retention for First Nations students was substantially lower at around 75% (ACSES, 2026).

Anecdotally the picture is worse post-pandemic. A Times Higher Education survey of 339 academics found 76% reporting lower lecture attendance and 54% reporting worse engagement among those who did attend (Times Higher Education, 2022). We flag this as practitioner self-report, UK-skewed and not peer reviewed. It is context, not evidence.

**The mechanism, and the hinge.** Dry material does not fail because it is ugly. It fails because it is consumed passively, and passive consumption produces weak retention. Retrieval practice reliably outperforms restudy at delays of two days and one week (Roediger and Karpicke, 2006). Educators broadly know this. The barrier is authoring cost: converting a lecture into sequenced retrieval practice with plausible distractors and a reason to keep going is many hours of expert work per hour of content. That authoring bottleneck is the problem ClassQuest attacks.

We have measured this cost directly. One team member previously hand-built a machine learning tutorial in this exact format, as personal prior work unrelated to this project, and the effort required to author a single subject by hand is precisely what makes the approach unscalable for any educator who is not willing to spend weeks on it. That experience is the origin of this proposal, not part of its deliverable.

---

## 2. Related work

### 2.1 Academic literature

**Gamification works, with conditions.** Sailer and Homner's (2020) meta-analysis in *Educational Psychology Review* found significant effects of gamification on cognitive (g = 0.49, 95% CI [0.30, 0.69]), motivational (g = 0.36) and behavioural (g = 0.25) learning outcomes. The cognitive effect remained stable when restricted to methodologically rigorous studies. Critically for our design, the two significant moderators of the effect on **behavioural** learning outcomes were **inclusion of game fiction** and **social interaction**, with the combination of competition and collaboration particularly effective. We note the scope precisely: these moderators were identified for behavioural outcomes, not cognitive ones. They are still the clearest published guidance on which design features to build. Clark, Tanner-Smith and Killingsworth (2016) reached a compatible conclusion in *Review of Educational Research*: digital games outperformed non-game conditions (g = 0.33, k = 57), and effects varied by narrative and mechanic characteristics, meaning design matters beyond medium. Hamari, Koivisto and Sarsa (2014) add the necessary caution that effects depend heavily on context and user.

This literature converts two aesthetic preferences into engineering requirements. Narrative integration and social play are not decoration, they are the measured moderators.

**Narrative-centred learning has precedent.** Crystal Island, a narrative-centred environment for eighth-grade microbiology, found engagement correlated with both learning outcomes and in-game problem solving, independently of prior knowledge and gaming experience (Rowe et al., 2011).

**The known failure mode.** Gamification suffers a novelty effect. A longitudinal study found impact following a U-shape, decaying after roughly four weeks before recovering between weeks six and ten through familiarisation (Rodrigues et al., 2022). We state this up front rather than burying it, and it shapes our evaluation design.

**Automated generation is an active field.** Kurdi et al. (2020) survey automatic question generation for education. An et al. (2025) report an empirical study in two data science courses where students scored 89% in a week with LLM-generated retrieval questions versus 73% without, while cautioning that generated quality varies and instructor review remains necessary. Most directly, **GamED.AI** (Agarwal et al., 2026) is a hierarchical multi-agent framework for automated educational game generation using LangGraph sub-graphs, supporting 15 Bloom-aligned interaction mechanics, reporting a 90% validation pass rate and 73% token reduction across 200 questions in five domains.

**We are not first, and we say so.** GamED.AI's input is instructor-authored questions and its output is per-question mini-games. ClassQuest's input is raw course content and its output is a sequenced narrative. That difference is our gap, and it is a real one.

### 2.2 Commercial landscape

| Product | What it does | Gap |
|---|---|---|
| **StudyQuest** | PDF, DOCX, slide images or text in. "40+ game modes" including Boss Battle, Flappy Bird, Subway Surfers, Snake. XP, streaks, AI study plans. Free tier. Claims 25,000+ students | Fiction fully decoupled from content. Claims students "learn up to 40% faster" with **no study, method or citation** |
| **StudyFetch** | "Arcade" / PDF to Game, plus Spark.E AI tutor, flashcards, live lecture assistant. Free tier, then $7.99 to $11.99 per month | Game-style challenges layered over flashcards |
| **Knowt** | Lectures, PDFs, YouTube, slides in. Notes, flashcards, quizzes, matching games, spaced repetition. Claims 1M users | Light gamification, no narrative |
| **Kuse, Eduaide** | Quizzes, flashcards, mind maps; Jeopardy and escape-room formats | `[CONFIRM]` Not independently verified this session |

**The gap, stated plainly.** Three things are missing across the whole market.

1. **Fiction is decoupled from content.** In all four products the game and the knowledge are separable layers: swap the questions and keep the game, or swap the game and keep the questions.
2. **Social play, where it exists, is competition only.** StudyQuest's Knowledge Royale is a leaderboard. None of the products supports a cohort moving through a shared narrative together, which is the competition-plus-collaboration combination the meta-analysis favours.
3. **Nobody publishes learning-outcome evidence.** Their claims are user counts and unsourced percentages.

There is room for a generator whose pedagogical structure is explicit, whose social layer is collaborative rather than purely competitive, and whose effect is actually measured.

---

## 3. Proposed solution

ClassQuest is a platform: a user uploads course content and receives a playable narrative learning game built from it.

**The target output format.** A generated game is a sequence of pixel-art scenes that teach as the learner plays: small interactive simulations, prediction-first challenges where the learner commits to an outcome before the answer is revealed, and assessment distributed through the story rather than appended at the end. The learner is not reading a chapter and then being quizzed on it. They are moving through a narrative whose obstacles are the concepts.

The user journey is: upload content, select a game archetype and scope, receive a generated learning-objective map for review, then play through generated scenes with progress and assessment tracked against that map.

### 3.1 The social layer

A generated game is a shareable artifact, not a private one. Two tiers, in increasing cost:

- **Share a game (in scope).** A generated game gets a URL. A student generates from their lecture notes and sends it to their cohort. This is cheap to build, it is the natural distribution mechanism for the product, and it demos in ten seconds.
- **Play it together (scoped carefully).** A shared game instance where a cohort's progress is visible: who is on which scene, who predicted what before the reveal, a shared cohort score against the concept graph. Prediction-first play is unusually well suited to this, because everyone commits publicly before the answer is revealed, which is a collaborative moment rather than a race.

Realtime synchronised multiplayer is explicitly out of scope for this weekend. See Section 6.

The prediction-first mechanic is not a stylistic choice either. It is the pretesting effect: unsuccessful retrieval attempts made before instruction improve subsequent learning (Richland, Kornell and Kao, 2009; see also Brod, 2021). ClassQuest generates this mechanic systematically rather than by hand.

---

## 4. Technical approach and the role of AI

### 4.1 Pipeline

Four stages, with the second as the contribution.

**Stage 1, ingestion.** Parse uploaded documents into chunked, citable source segments. Every downstream artifact retains a pointer back to its source span.

**Stage 2, learning-objective graph extraction.** A single structured-output pass produces a typed graph:

```
Concept {
  id, label, source_spans[]
  prerequisites: [concept_id]
  bloom_level: remember | understand | apply | analyse | evaluate | create
  misconceptions: [{ statement, why_plausible }]
}
```

This artifact is the design decision the entire system rests on. The full contract is specified in `schema/course-graph.schema.json`, with a worked example in `fixtures/overfitting.graph.json` and cross-file invariant checks in `schema/validate.py`. Games are specified in `schema/game.schema.json`.

The two fixtures `overfitting.quest.json` and `overfitting.gauntlet.json` carry the same `graph_id`: one extraction, two games, no second pass over the source. The validator enforces this, so the architectural claim in 4.5 is checked rather than asserted.

**Stage 3, narrative planning.** A topological ordering of the concept graph is mapped onto a story arc: acts, settings, a protagonist goal, and a scene per concept or concept cluster.

**Stage 4, lazy scene generation.** Each scene is generated on demand from its concept node plus narrative context, not from the whole corpus.

### 4.2 Why the intermediate representation pays

- **Pedagogy.** Extracted misconceptions become the distractors in prediction-first challenges. Distractors are the hardest part of question authoring to do well, and generating them from a misconception model rather than by sampling plausible-sounding text is a genuine quality difference.
- **Cost.** This solves the token constraint identified in our build brief. Graph extraction is one pass over the content; scene generation is per node and on demand. GamED.AI reports a 73% token reduction from comparable structural design (Agarwal et al., 2026), which suggests the approach is sound and not merely convenient.
- **Evaluability.** The graph is the assessment blueprint. Pre-test and post-test items are generated against the same extracted objectives the game teaches, which is what makes a learning-gain measurement possible at all on this timescale.

### 4.3 The interesting technical challenge

**Two orderings must hold at once, and they conflict.** A generated game must be *pedagogically ordered*, meaning prerequisites precede dependents, and *narratively coherent*, meaning the story does not lurch between unrelated settings. The concept graph gives a partial order with many valid topological sorts. Most of them make terrible stories. Our approach is to treat narrative planning as constrained ordering: enumerate valid topological sorts, score them for narrative cohesion using concept semantic similarity as a proxy for scene adjacency, and select the highest-scoring valid ordering. Prerequisite violations are a hard constraint; narrative smoothness is the objective.

**Correctness is non-negotiable.** A hallucinated fact inside a quiz is worse than no quiz, because it is delivered with the authority of assessment and rehearsed through retrieval practice. Fabricated facts and invented statistics are documented LLM failure modes (Artificial Intelligence Review, 2025). Our mitigations: every generated claim carries a source-span citation, schema-validated structured output at each stage, and a validation pass checking generated assertions against the source segments they cite. Anything unsupported is dropped rather than shipped.

### 4.4 Model and stack

**Two-tier model strategy.** The pipeline has two workloads with opposite economics, so they get different models.

| Stage | Volume | Model | Price per MTok (in / out) | Why |
|---|---|---|---|---|
| Graph extraction | 1 call per upload | `claude-opus-5` | $5 / $25 | Quality critical and low volume. Schema compliance and misconception quality here determine everything downstream. This is the worst place to economise. |
| Scene generation | 1 call per concept node | `claude-sonnet-5` | $2 / $10 (introductory rate, reverts to $3 / $15 after 2026-08-31) | High volume, cost sensitive, and the narrative quality bar is lower than the extraction correctness bar |

Both use structured outputs (`output_config.format`) with schema validation, and adaptive thinking on the extraction pass.

**Prompt caching is the third lever, and it is the largest one.** The source content is a stable prefix shared across every scene generation call for a given upload. Cached once, every subsequent scene call reads it at a fraction of the input cost. Combined with lazy per-node generation, this is what makes per-game cost predictable enough to price a free tier.

Cheap third-party models were considered. The honest position: the extraction stage is precisely where a weaker model costs the most, because a malformed graph or a shallow misconception list breaks everything downstream and is invisible until a judge plays the game. Scene generation is the defensible place to trade quality for cost, and Sonnet 5 already sits there. One SDK with two model IDs is also lower risk than a second provider integration mid-hackathon.

**Stack: open, to be decided by the team today.** `[DECIDE]`

The decision should follow who knows what, not architecture preference. Two viable shapes:

- **One repository, Next.js full stack.** One deploy, no CORS, no env duplication, API routes keep the LLM keys server-side. Lowest operational overhead. Requires the team to be comfortable in React and Node.
- **Split front end and Python back end.** Parsing documents and orchestrating the pipeline is natural in Python, and it lets anyone who knows Python but not React contribute from the first hour. Costs two deploys, CORS, and a contract to keep in sync.

**A separate repository is not what enables parallel work, and this is worth being clear about before splitting on that basis.** Conflicts come from two people editing the same file, not from front and back sharing a repo. Work parallelises inside one repository by dividing routes and components.

**What actually unblocks everyone is agreeing the learning-objective graph schema in the first hour.** That JSON is the real parallelisation boundary. Once it is fixed, the front end builds against a hand-written fixture while the back end is still wiring up the model, and neither waits on the other. Without it, separate repositories will not help.

Whatever is chosen, the rubric scores how well the stack fits the problem, so the reasoning needs to be sayable in one sentence on stage. Persistence via Postgres or SQLite for shared games and cohort state.

### 4.5 Hand-built archetypes, generated content

Design carries 20% of the judging score and every artifact we show is generated, so output quality is not a polish task, it is a scoring requirement.

The answer is to generate content, never presentation. We hand-build a small set of **game archetypes**. Each archetype is a complete design system: tile set, sprite vocabulary, palette, typography, dialogue frames, scene layouts, and a scene renderer. The model emits structured scene descriptions that reference an archetype's vocabulary by name. It never emits CSS, colours, or layout.

The user picks the archetype at upload time, which is also the token guardrail identified in our build brief: choosing the format up front bounds what has to be generated.

Three reasons this is the right structure:

- **Quality floor.** A hand-designed archetype means the ugliest possible generated game still looks intentional. Model-generated styling means the floor is wherever the model happens to land, and we cannot inspect every output before the judges do.
- **Cost.** Scene descriptions referencing a fixed vocabulary are dramatically smaller than generated markup and styling.
- **Determinism.** A generated game either validates against the archetype's vocabulary or it does not. Presentation bugs become schema errors, caught before render rather than on stage.

It is also the honest answer to a judge asking what stops the output looking like generic AI slop: we did not ask the model to be a designer.

**Two archetypes, differing by mechanic rather than by art.** This matters for cost and for the pitch.

| Archetype | Experience | Build cost |
|---|---|---|
| **Quest** (must have) | Narrative arc. Scenes follow the concept dependency order, predict-then-reveal at each obstacle, dialogue and simulation between beats. Long form. | Full build. This is the product. |
| **Gauntlet** (second) | Same concept graph, same art, same renderer. Rapid timed run of prediction challenges across the same concepts. Short form, replayable, leaderboard-shaped. | Hours, not days. Reuses the entire engine and changes only sequencing, pacing and the score surface. |

**The archetype switch is the proof of the architecture.** Our central claim is that the learning-objective graph is a real intermediate representation, genuinely separate from presentation. The switch demonstrates it: extract once, render twice, no re-extraction and no second model pass over the source content. A judge sees the same uploaded document become two different games in one click. That is a stronger argument for the design than any slide explaining it, and it costs almost nothing because the expensive stage is already done.

Gauntlet also feeds the social layer directly. A short timed run over a shared concept graph is the natural shape for a cohort leaderboard (Section 3.1).

**Confirmed** as a nice-to-have, built only after Quest runs end to end. If the Saturday night checkpoint is not green, it is dropped without discussion.

---

## 5. Impact and evaluation plan

**Who it helps.** Students who disengage from dense or dry material, and educators who know active learning works but cannot afford the authoring hours. The theme fit is direct, not stretched.

**Design.** Matched-groups or within-subjects, with four measurement points:

1. Pre-test on the extracted learning objectives
2. Intervention: ClassQuest-generated game versus reading the equivalent source material
3. Immediate post-test
4. **Delayed post-test at 7 days**

The delayed test is not optional. Roediger and Karpicke (2006) found repeated study actually beat repeated testing at a five-minute delay, with the effect reversing at two days and one week. An evaluation that measures only immediately would understate or invert our result.

**Primary measure.** Hake normalized gain, `<g> = (post - pre) / (100 - pre)`. Benchmarks from Hake (1998), across 62 courses and 6,542 students: traditional instruction 0.23 ± 0.04, interactive engagement 0.48 ± 0.14. This gives the number an interpretable frame rather than a bare percentage.

**Secondary measures.** Time on task, completion rate, voluntary return, and a short self-reported engagement instrument.

**Honest limitations, stated in the document rather than discovered by a judge.**

- **No pilot data will exist by Sunday.** We are not recruiting participants outside the team, so this section reports a designed protocol, not results. Team members cannot serve as participants: they have seen the source content, built the generator, and know the hypothesis.
- We cannot run a 7-day delayed test before Sunday. We report the design and any 24 to 48 hour data we can collect.
- Novelty effect confounds any short study (Rodrigues et al., 2022). Early gains may reflect the format being new, not the format being better.
- Self-selection: volunteers are more motivated than the disengaged students we are targeting.

**How to present this.** State it plainly rather than dressing it up. "We designed the evaluation and we have not run it" is a credible answer that costs nothing, because no judging criterion scores evidence. Claiming a result we did not measure is the only version of this that can lose points, and it is exactly the thing we criticise StudyQuest for in Section 2.2. The value of this section in the pitch is that it shows we know what would count as proof.

---

## 6. Feasibility and scope

**Must have.** Upload content, generate the learning-objective graph, generate and play the Quest archetype, share the generated game by URL. Plus the hand-built archetype design system that all generated games inherit (see 4.5).

**Nice to have, in priority order.** The Gauntlet archetype, because it is cheap and it demonstrates the architecture (4.5). Then the asynchronous cohort view on a shared game (a leaderboard plus per-scene prediction distribution, polled rather than pushed). Then accounts and saved games.

**Cut.** Realtime synchronised multiplayer, payments, game library, polish beyond the one archetype.

**On multiplayer, the honest call.** Realtime sync is the single most common way a hackathon demo dies: websockets, state reconciliation and two devices on conference wifi. The social moderator does not require realtime. Asynchronous shared state, meaning a cohort leaderboard and a prediction distribution that updates on refresh, delivers the collaborative moment and the pitch narrative at a fraction of the risk. Build the share link first, then the async cohort view only if the checkpoint is green.

**On a Stitch prototype.** Worth it, with one condition: it is a pitch asset, not a build artifact. A Stitch mock of the upload-to-share flow, including the cohort screen we will not have built, lets the pitch show the full product vision while the live demo shows the working core. It should cost one person about an hour and must not pull anyone off the pipeline. If it starts competing with the build, drop it. `[CONFIRM: do we want this? I can generate it now.]`

**Team split (5 people).** Ingestion and graph extraction; narrative planning and scene generation; front-end and playable runtime; evaluation instruments and pilot; pitch, deck and demo rehearsal. `[CONFIRM: assign names]`

**Checkpoint.** Saturday night, end-to-end path must run on one small document. If it does not, cut the second game type immediately and protect the demo.

**Demo plan, two beats.** Beat one: open with a game we generated earlier during the event from a real document, fully played through and polished, so judges see a finished result immediately. Beat two: live-generate a small game from fresh content in front of them. The live generation is the wow moment; the pre-generated game is what proves quality, because a live generation under time pressure will always be the smaller artifact.

If Gauntlet ships, insert it between the two beats as a ten-second moment: same document, same extraction, one click, a different game. Say the claim out loud while clicking it, because that click is the evidence for the whole technical argument.

**The fallback is not optional and it is not the same thing as beat one.** Keep a third artifact loaded in a separate tab: a game pre-generated from the exact document we plan to use live. If the live call is slow or fails, switch tabs and keep talking. Rehearse the switch. Losing the wow moment costs a little; a hanging demo costs the Pitch score outright.

**Business model.** Freemium. Free tier with a capped number of generated games, paid tier for more, or per-generation pricing. Token cost scales with content volume, so caps and user-selected scope are product requirements, not just monetisation.

---

---

## 7. Judging criteria and compliance

### 7.1 Rubric mapping

Five criteria: Theme, Pitch, Technology, Creativity, Design. No stated weighting, so treat them as equal at 20% each.

| Criterion | What it asks | Our strongest asset | Risk |
|---|---|---|---|
| **Theme** | How well the project connects to "Innovation that helps" | Direct fit, no stretch. Students who bounce off dry material | Low |
| **Pitch** | How clearly and confidently the team presents problem, solution, demo | Section 1 gives a single hard number (34% to 22% failure rate) to open on | Rehearsal time. Budget it. |
| **Technology** | How technically solid, and how well the stack fits the problem | Two-tier models, prompt caching, schema-validated structured output, constrained topological ordering | The pipeline must actually run live |
| **Creativity** | How original the approach is and whether it solves a real problem in a novel way | The learning-objective graph, and generating both meta-analytic moderators | **Highest risk. See below.** |
| **Design** | How polished, usable, and well thought-out the UI/UX is | A fixed design system means every generated game looks intentional | **Highest structural risk.** 20% of the score now rides entirely on generated output. There is no pre-polished artifact to fall back on. |

### 7.2 Three strategic consequences

**1. There is no criterion for research rigour.** Nothing in the rubric scores evidence, citations or methodology. The literature in this document does real work, but indirectly: it makes the Creativity claim defensible and the Pitch problem statement credible. It does not earn points on its own line. **Do not let this document consume time that Design and demo rehearsal need.** It is scaffolding for the pitch, not the deliverable.

**2. Design is a full fifth of the score, so the Stitch prototype is now a yes.** Recommendation upgraded from optional to planned. One person, roughly an hour, mocking the upload-to-share flow including the cohort screen we will not have built. The pitch shows the full vision, the live demo shows the working core.

**3. Creativity is where our honesty must not become self-sabotage.** This document opens Related Work by saying the space is crowded and we are not first. That is correct for an internal document and correct if a judge asks directly. It is the wrong way to open a pitch that is scored on originality. On stage, lead with the graph and the two moderators; the competitor honesty is the answer to a question, not the opening line. That is emphasis, not deception.

### 7.3 Compliance, action required today

**Originality: clear.** Every artifact presented is built during the event, from an empty repository, after 6pm on Day 1. No prior work is demoed, submitted, or forked. This satisfies both the "original works" rule and the no-early-start rule with no approval required, which is the reason it is worth keeping that way.

One consequence worth stating: **do not copy code from prior personal projects into the repository**, even code you wrote yourself. Rebuild it. The rule is about when the work happened, not who owns it.

**Other binding requirements:**

- Repository on GitHub or GitLab, link supplied to the Executive Team **before 3pm on Day 3**. The 3PM deadline is the repo link deadline.
- Team registered by 12pm on Day 2.
- Team size 3 to 5. We are 5, compliant.
- At least 3 of 5 members present in person at the awards presentation on Day 3.
- Nothing NSFW, discriminatory, illegal, or addressing a political matter. Not a concern for us, but generated content is user-supplied. A minimal content filter on upload is cheap insurance and is worth one hour.

---

## References

- ACSES (2026). *Retention rates in Australian higher education: Analysis of 2024 data*. https://www.acses.edu.au/publication/retention-rates-in-australian-higher-education-2026-update/ `[Secondary source; confirm against education.gov.au 2024 Section 15]`
- Agarwal, S., Shah, Y., Shekhar, A. R., Bordoloi, P., and Gupta, V. (2026). GamED.AI: A Hierarchical Multi-Agent Framework for Automated Educational Game Generation. arXiv:2604.23947.
- An, Y., Liu, J., Acharya, N., and Hashmi, R. (2025). Enhancing Student Learning with LLM-Generated Retrieval Practice Questions: An Empirical Study in Data Science Courses. arXiv:2507.05629.
- *Artificial Intelligence Review* (2025). Hallucination to truth: a review of fact-checking and factuality evaluation in large language models. doi:10.1007/s10462-025-11454-w
- Brod, G. (2021). Predicting as a learning strategy. *Psychonomic Bulletin & Review*. doi:10.3758/s13423-021-01904-1
- Clark, D. B., Tanner-Smith, E. E., and Killingsworth, S. S. (2016). Digital Games, Design, and Learning: A Systematic Review and Meta-Analysis. *Review of Educational Research*, 86(1), 79-122. doi:10.3102/0034654315582065
- Freeman, S., et al. (2014). Active learning increases student performance in science, engineering, and mathematics. *PNAS*, 111(23), 8410-8415. doi:10.1073/pnas.1319030111
- Hake, R. R. (1998). Interactive-engagement versus traditional methods: A six-thousand-student survey of mechanics test data for introductory physics courses. *American Journal of Physics*, 66(1), 64-74.
- Hamari, J., Koivisto, J., and Sarsa, H. (2014). Does Gamification Work? A Literature Review of Empirical Studies on Gamification. *HICSS-47*, 3025-3034. doi:10.1109/HICSS.2014.377
- Kurdi, G., Leo, J., Parsia, B., Sattler, U., and Al-Emari, S. (2020). A Systematic Review of Automatic Question Generation for Educational Purposes. *IJAIED*, 30, 121-204. doi:10.1007/s40593-019-00186-y
- Merino, T., et al. (2024). Procedural Content Generation in Games: A Survey with Insights on Emerging LLM Integration. *AIIDE 2024*. arXiv:2410.15644.
- QILT (2024). *Student Experience Survey*. https://www.qilt.edu.au/surveys/student-experience-survey-(ses)
- Richland, L. E., Kornell, N., and Kao, L. S. (2009). The pretesting effect: Do unsuccessful retrieval attempts enhance learning? *Journal of Experimental Psychology: Applied*, 15(3), 243-257.
- Rodrigues, L., et al. (2022). Gamification suffers from the novelty effect but benefits from the familiarization effect. *International Journal of Educational Technology in Higher Education*. doi:10.1186/s41239-021-00314-6
- Roediger, H. L., and Karpicke, J. D. (2006). Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention. *Psychological Science*, 17(3), 249-255. doi:10.1111/j.1467-9280.2006.01693.x
- Rowe, J. P., Shores, L. R., Mott, B. W., and Lester, J. C. (2011). Integrating Learning, Problem Solving, and Engagement in Narrative-Centered Learning Environments. *IJAIED*, 21.
- Sailer, M., and Homner, L. (2020). The Gamification of Learning: a Meta-analysis. *Educational Psychology Review*, 32, 77-112. doi:10.1007/s10648-019-09498-w
- Times Higher Education (2022). Class attendance plummets post-Covid. Survey of 339 academics, June 2022. `[Practitioner self-report, not peer reviewed]`
