"""The public demo: the bundled world, playable with no account at all.

This exists for one reason. The link goes out on a QR code, a stranger scans
it, and the very first thing they touch is the world compiled into the page —
no sign-up, no server. Reading works there and answering works there, because
both are already in the bundle. Explaining did not: the Socratic student lives
on the server, so the third gate met a dead end that said so out loud. On a
demo stand that reads as a broken product rather than as an honest boundary.

## What makes this safe to leave open

An unauthenticated endpoint that reaches a language model is somebody else's
free model key unless three things are true, and all three are:

1. **The prompt's content is ours, not the caller's.** The request names a
   bundle and a concept id; the concept — its label, summary and
   misconceptions — is loaded from `fixtures/` on this box. A caller cannot
   post their own concept, so they cannot use the endpoint to ask the model
   anything. The only free text they contribute is their own turns, exactly as
   in the signed-in chat.
2. **It is bounded.** Per address, and — because a distributed caller has as
   many addresses as it likes and there is only one key — globally too. See
   `ratelimit.py`.
3. **It writes nothing.** No row, no XP, no session. `socratic.next_turn` is a
   pure function of (concept, turns); this router is that function behind a
   limiter, and it never touches the database at all.

Nothing is awarded here, and the response says so with zeroes rather than by
inventing a number: XP is the signed-in server's to give.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from app import schemas
from app.ratelimit import RateLimit
from app.services import fixtures, scoring, socratic

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post(
    "/explain/turn",
    response_model=schemas.ExplainChatOut,
    dependencies=[Depends(RateLimit("demo_explain", also="demo_explain_global"))],
    responses={
        404: {"description": "Unknown concept in that bundle"},
        429: {"description": "The demo chat is busy; try again shortly"},
    },
    summary="One turn of the Socratic chat against a bundled demo world",
)
def demo_explain_turn(body: schemas.DemoExplainChatIn) -> schemas.ExplainChatOut:
    content = fixtures.load_bundle(body.bundle)
    concept = next(
        (c for c in content.graph.get("concepts", []) if c.get("id") == body.concept_id),
        None,
    )
    if concept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown concept")

    turn = socratic.next_turn(concept, [t.model_dump() for t in body.turns])

    if not turn["done"]:
        return schemas.ExplainChatOut(
            done=False, understanding=turn["understanding"], question=turn["question"],
            targeted_misconception_id=turn["targeted_misconception_id"],
            turns_remaining=turn["turns_remaining"], result=None,
        )

    score = scoring.clamp_score(turn["understanding"])
    return schemas.ExplainChatOut(
        done=True, understanding=score, question=None,
        targeted_misconception_id=None, turns_remaining=0,
        result=schemas.ExplainOut(
            score=score, verdict=turn["verdict"],
            # Zero, and not for lack of a better number: there is no account to
            # credit and no row to write, so any other value would be a claim
            # that something was saved.
            xp_awarded=0, world_xp=0, server_xp=0,
            feedback=turn["feedback"], misconception_id=turn.get("misconception_id"),
            concept=schemas.ConceptOut(
                id=concept["id"], label=concept["label"], summary=concept["summary"]),
        ),
    )
