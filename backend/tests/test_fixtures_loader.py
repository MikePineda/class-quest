from app.services import fixtures


def test_demo_content_loads_and_matches_graph():
    demo = fixtures.load_demo()
    assert demo.graph["graph_id"] == "wk3ml0a1"
    assert demo.quest["graph_id"] == demo.gauntlet["graph_id"] == demo.graph["graph_id"]
    assert demo.quest["archetype"] == "quest" and demo.gauntlet["archetype"] == "gauntlet"
    assert len(demo.segments) == demo.graph["source"]["segment_count"] == 14


def test_demo_segments_contain_every_quote_verbatim():
    demo = fixtures.load_demo()
    for c in demo.graph["concepts"]:
        for span in c["source_spans"]:
            assert span["quote"] in demo.segments[span["segment_id"]]


def test_load_demo_returns_fresh_copies():
    a, b = fixtures.load_demo(), fixtures.load_demo()
    a.graph["graph_id"] = "mutated"
    assert b.graph["graph_id"] == "wk3ml0a1"
