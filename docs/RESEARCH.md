# ClassQuest, team research and working doc

Everything we verified, everything we decided, and where new ideas go.

**This file is the workbench.** `classquest-proposal.md` is the finished argument, do not edit it while brainstorming. Add here first, promote to the proposal once a decision sticks.

Last updated 22 Aug 2026. Team: Miguel, Jonathan, Bharath, Alan, Aman. QUT Brisbane.

---

## 1. The thesis, in one line

> **We do not generate questions. We generate an understanding of the material, then build the game from it.**

Everyone else runs `content -> questions -> game skin`.
We run `content -> concept map -> story -> game`.

The map holds: what the concepts are, which ones must be learned first, where students typically go wrong, and what each concept is grounded in from the source text.

**Every new idea gets tested against this line.** If it does not strengthen it, it is a feature, not a differentiator.

---

## 2. Idea inbox

Add anything. Do not self-censor at the point of writing. The filter runs later, not while you are thinking.

### How to add
```
### [your name] short title
What it is, two sentences.
Why it helps: ...
```

### The filter, run before anything moves to scope

Four questions. An idea needs a yes on 1 and 2 to survive.

| # | Question | Why it matters |
|---|---|---|
| 1 | Does it strengthen the map thesis, or is it a separate feature bolted on? | Separate features make us look like StudyQuest with fewer modes. We lose that comparison every time. |
| 2 | Can it be built and working before the Saturday night checkpoint? | Anything else competes with Quest, and Quest is the whole demo. |
| 3 | Which judging criterion does it move: Theme, Pitch, Technology, Creativity, Design? | If you cannot name one, it is polish. |
| 4 | If it breaks live on stage, does the demo survive? | Anything that can hang the pitch needs a fallback or it does not ship. |

### Ideas so far

#### [Miguel] Share your game with classmates
A generated game gets a URL you send to your cohort.
**Verdict: in scope, must have.** Passes 1 (social is the second research-backed moderator, see 4.2), passes 2 (cheap), moves Creativity and Theme, and cannot break the demo.

#### [Miguel] Online mode, play together
Cohort progress visible on a shared game.
**Verdict: scoped down to asynchronous.** A leaderboard plus per-scene prediction distribution that updates on refresh. Realtime sync is cut: it fails question 4 badly, websockets plus two devices on conference wifi is the classic way a hackathon demo dies. The research moderator does not require realtime.

#### [Miguel] Multiple base game templates, like StudyQuest asks you the type
**Verdict: in, and it turned out to be more important than it looked.** Became the archetype system. Quest must have, Gauntlet if time. Critically, the archetype switch is what *proves* the map: one extraction renders two games with no second pass over the document. That is the strongest technical argument we have.

---

## 3. Decisions log

What is settled, why, and what would reopen it.

| Decision | Why | Reopens if |
|---|---|---|
| The concept map is the differentiator | Only defensible claim after the competitor scan. Everything else is execution. | Someone finds a competitor doing explicit pedagogical modelling |
| Subject agnostic, any uploaded content | Miguel's call. The product is not an ML tool. | Never, this is settled |
| Narrative plus social, both | The two moderators the meta-analysis found significant (4.2) | No |
| Quest must have, Gauntlet nice to have | Gauntlet is cheap only because it reuses a finished engine | Quest not working end to end Saturday night, then Gauntlet is dropped |
| Art direction hand built, never generated | Design is 20% of the score and we have no pre-polished artifact. A fixed vocabulary sets the quality floor and makes presentation bugs into schema errors. | No |
| Realtime multiplayer cut | Fails filter question 4 | No |
| Evaluation designed, not run | No testers outside the team, and we cannot be our own participants | Someone recruits 5+ outside testers |
| Nothing pre-existing enters the repo | Rules: no work before 6pm Day 1, all projects original. Rebuild rather than copy, even your own code. | No |
| Stack open | Follows who knows what. Not load bearing for the idea. | Decide in the meeting |

### Not decided yet
- Who owns which of the five workstreams: map, scenes, runtime and art, sharing, pitch
- Stack
- Who calls the Saturday night checkpoint

---

## 4. Research library

Everything below was retrieved and checked. **Do not add a citation to any deliverable that is not in this table.** If you need a new claim, verify it first and add a row.

### 4.1 The problem

| Claim | Source | Status |
|---|---|---|
| STEM failure rates 34% under traditional lecturing vs 22% under active learning. Exam scores +0.47 SD. Odds of failing 1.95x. 225 studies. | Freeman et al. 2014, *PNAS* 111(23):8410. doi:10.1073/pnas.1319030111 | **Verified. Our strongest number, open the pitch on it.** |
| 2024 SES: undergrad overall quality 76.5%, peer engagement 60.2%. Postgrad peer engagement 62.1%, up from 53.8% in 2019. n = 158,000+ UG. | QILT Student Experience Survey 2024, qilt.edu.au | Verified |
| Retention 86.1% in 2023, so roughly 13.9% attrition. First Nations students around 75%. | ACSES 2026 analysis of 2024 data | **Secondary.** Primary table at education.gov.au timed out. Confirm if used. |
| Retrieval practice beats restudy at 2 day and 1 week delays, and loses at 5 minutes. | Roediger & Karpicke 2006, *Psychological Science* 17(3):249-255 | Verified. This is why our evaluation needs a delayed test. |
| 76% of academics report lower attendance post-Covid, 54% report worse engagement. | Times Higher Education survey, 339 respondents, June 2022 | **Weak.** Self-report, UK-skewed, not peer reviewed. Colour only, never load bearing. |

### 4.2 Why narrative and social, and not something else

| Claim | Source | Status |
|---|---|---|
| Gamification effects: cognitive g = 0.49 [0.30, 0.69], motivational g = 0.36, behavioural g = 0.25. **Game fiction and social interaction were the two significant moderators of the behavioural effect**, with competition combined with collaboration best. Cognitive effect stable under high rigour. | Sailer & Homner 2020, *Educational Psychology Review* 32:77-112. doi:10.1007/s10648-019-09498-w | **Verified. This is the paper our whole design rests on.** Note the moderators were for behavioural, not cognitive outcomes. State that if asked. |
| Digital games beat non-game conditions, g = 0.33. Design matters beyond medium. | Clark, Tanner-Smith & Killingsworth 2016, *RER* 86(1):79-122 | Verified |
| Gamification works but is heavily context and user dependent | Hamari, Koivisto & Sarsa 2014, HICSS-47 | Verified |
| Novelty effect: impact follows a U shape, decays after ~4 weeks, recovers weeks 6 to 10 | Rodrigues et al. 2022, *IJETHE*. doi:10.1186/s41239-021-00314-6 | Verified. Name it before a judge does. |
| Narrative-centred learning: engagement correlated with learning gains, independent of prior knowledge | Rowe, Shores, Mott & Lester 2011, Crystal Island, *IJAIED* 21 | Verified |

### 4.3 The mechanics

| Claim | Source | Status |
|---|---|---|
| Pretesting effect: unsuccessful retrieval **before** instruction improves later learning | Richland, Kornell & Kao 2009, *JEP: Applied* 15(3):243-257 | Verified. This is why predict-then-reveal, and why wrong answers are fine. |
| Predicting as a learning strategy, review | Brod 2021, *Psychon Bull Rev*. doi:10.3758/s13423-021-01904-1 | Verified |
| Normalized gain: traditional 0.23 ± 0.04, interactive engagement 0.48 ± 0.14. 62 courses, 6,542 students. | Hake 1998, *Am. J. Phys.* 66(1):64-74 | Verified. Our evaluation metric. |

### 4.4 AI generation

| Claim | Source | Status |
|---|---|---|
| Multi-agent educational game generation. 15 Bloom-aligned mechanics, 200 questions across 5 domains, 90% validation pass, **73% token reduction** from structural design. | GamED.AI, arXiv 2604.23947, Apr 2026 | **Verified. Closest prior art, cite it.** Their input is instructor questions, ours is raw content. That difference is our gap. |
| LLM-generated retrieval questions in 2 data science courses, ~60 students: 89% accuracy in the AI-question week vs 73% without. Authors warn quality varies and instructors must review. | An et al., arXiv 2507.05629, Jul 2025 | Verified. Small n, quasi-experimental. State the limitation. |
| Systematic review of automatic question generation for education | Kurdi et al. 2020, *IJAIED* 30:121-204 | Verified |
| PCG survey with LLM integration | Merino et al., AIIDE 2024, arXiv 2410.15644 | Verified |
| Hallucination taxonomies. Fabricated facts and invented statistics as documented failure modes. | *Artificial Intelligence Review* 2025. doi:10.1007/s10462-025-11454-w | Verified. Backs our grounding requirement. |

---

## 5. Competitor intel

Fetched live 22 Aug 2026.

| Product | What it is | Where it stops |
|---|---|---|
| **StudyQuest** | PDF, DOCX, slides, text in. 40+ modes: Boss Battle, Flappy Bird, Subway Surfers, Snake, Knowledge Royale. XP, streaks, AI study plans. Free forever tier. Claims 25,000+ students, 1.5M questions, 4.8/5. | Fiction fully decoupled from content. Claims **"learn up to 40% faster" with no study, method or citation.** Use this: it is the evidence gap made visible. |
| **StudyFetch** | Arcade / PDF to Game, Spark.E AI tutor, flashcards, Notes AI, live lecture assistant, voice tutoring. Free tier, Base $7.99/mo, Premium $11.99/mo, weekly $3.92. | Game-style challenges over flashcards. Homepage 403s to direct fetch, pricing from review sites, recheck before quoting. |
| **Knowt** | Lectures, PDFs, YouTube, PPT, spreadsheets, images in. Notes, flashcards, quizzes, matching games, spaced repetition, Kai voice assistant. Claims 1M users, "50% of AP students". | Light gamification, no narrative. |
| **Kuse, Eduaide** | Quizzes, flashcards, mind maps. Jeopardy and escape room formats. | **Not verified this session.** Verify or drop before the pitch. |

**The three-part gap, which is the spine of our argument:**
1. In every product the game and the knowledge are separable layers.
2. Social play, where it exists, is a leaderboard. Nobody has a cohort in a shared narrative.
3. Nobody publishes learning-outcome evidence.

---

## 6. Technical notes worth keeping

**Two-tier models.** Graph extraction is one call per upload, quality critical: `claude-opus-5`, $5/$25 per MTok. Scene generation is per node, cost sensitive: `claude-sonnet-5`, $2/$10 introductory through 31 Aug 2026, then $3/$15. Do not economise on extraction, a malformed graph breaks everything downstream and is invisible until someone plays the game.

**Prompt caching is the biggest cost lever**, larger than model choice. The source content is a stable prefix across every scene call for one upload. Cache once, read cheap thereafter.

**The hard technical problem, for the Technology criterion.** Two orderings must hold at once and they conflict: pedagogical (prerequisites before dependents, a hard constraint) and narrative (the story must not lurch, the thing to optimise). The concept graph has many valid topological sorts and most make terrible stories. Enumerate valid sorts, score for cohesion, pick the best valid one.

**Grounding is not optional.** Every concept carries a verbatim quote that must occur in the segment it cites. A hallucinated fact in a quiz is worse than no quiz, because it arrives with the authority of assessment and then gets rehearsed.

---

## 7. Rules, the ones that can bite

- Nothing built before **6pm Day 1** goes in. All projects original. Do not copy your own prior code, rebuild it.
- Repo link to the Executive Team **before 3pm Day 3.** That is the real deadline, not the pitch.
- Team registered by 12pm Day 2. Size 3 to 5, we are 5.
- At least 3 of 5 present in person at the awards.
- Nothing NSFW, discriminatory, illegal or political. Uploads are user supplied, so a minimal content filter is cheap insurance.

**Judging: Theme, Pitch, Technology, Creativity, Design.** Five criteria, no stated weighting.

Three things to know about that rubric:
1. **Nothing scores research rigour.** This file makes Creativity defensible and Pitch credible. It earns no line of its own. Do not let it eat the time Design and rehearsal need.
2. **Design is a full fifth**, and every artifact we show is generated. That is why art direction is hand built.
3. **Creativity is where honesty can become self-sabotage.** On stage, lead with the map. The competitor honesty is the answer to a question, not the opening line.

---

## 8. Where everything lives

| File | What it is |
|---|---|
| `RESEARCH.md` | This file. Workbench, idea inbox, decisions, sources. |
| `classquest-proposal.md` | The finished argument. Problem, related work, solution, technical approach, evaluation, feasibility. |
| `classquest-deck.html` | 11 slides for the team on the differentiator. Open in a browser, arrow keys. |
| `schema/README.md` | The data contract and why each field exists. **Read this before writing code.** |
| `schema/course-graph.schema.json` | The map. Stage 2 output. |
| `schema/game.schema.json` | A playable game. Stage 4 output. |
| `schema/validate.py` | `python3 schema/validate.py`. Checks the schemas plus five cross-file invariants. |
| `fixtures/*.json` | A real map with 5 ML concepts, and both archetypes built from it. Front end builds against these. |

**The two game fixtures carry the same `graph_id`.** One extraction, two games. The validator enforces it, so our central claim is checked rather than asserted.
