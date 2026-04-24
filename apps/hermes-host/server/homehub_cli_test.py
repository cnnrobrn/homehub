import io
import json
import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import homehub_cli


ENV = {
    "HOUSEHOLD_ID": "household-1",
    "HOMEHUB_SUPABASE_URL": "https://supabase.test",
    "HOMEHUB_SUPABASE_ANON_KEY": "anon",
    "HOMEHUB_SUPABASE_JWT": "jwt",
    "HOMEHUB_MEMBER_ID": "member-1",
    "TRIPADVISOR_API_KEY": "fake-ta-key",
}


class FakeTripAdvisor:
    def __init__(self, responses: dict[str, Any] | None = None) -> None:
        self.calls: list[tuple[str, list[tuple[str, str]]]] = []
        self.responses = responses or {}

    def get(self, path: str, params: list[tuple[str, str]] | None = None) -> Any:
        self.calls.append((path, list(params or [])))
        if path in self.responses:
            return self.responses[path]
        # Default: empty data envelope.
        return {"data": []}


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def request(
        self,
        method: str,
        schema: str,
        table: str,
        *,
        params: list[tuple[str, str]] | None = None,
        body: dict[str, Any] | None = None,
        prefer: str | None = None,
    ) -> Any:
        call = {
            "method": method,
            "schema": schema,
            "table": table,
            "params": params or [],
            "body": body,
            "prefer": prefer,
        }
        self.calls.append(call)
        if method == "GET" and schema == "app" and table == "household":
            return [
                {
                    "settings": {
                        "onboarding": {
                            "setup_segments": ["food"],
                            "setup_prompt_ids": ["food.pantry"],
                            "setup_surface_ids": [],
                        }
                    }
                }
            ]
        return [{"ok": True, "body": body, "params": params or []}]


class HomeHubCliTest(unittest.TestCase):
    def run_cli(
        self,
        argv: list[str],
        client: FakeClient | None = None,
        tripadvisor: FakeTripAdvisor | None = None,
        env: dict[str, str] | None = None,
    ) -> tuple[int, str, str, FakeClient, FakeTripAdvisor | None]:
        fake = client or FakeClient()
        out = io.StringIO()
        err = io.StringIO()
        rc = homehub_cli.run(
            argv,
            env=env or ENV,
            client=fake,
            tripadvisor=tripadvisor,
            out=out,
            err=err,
        )
        return rc, out.getvalue(), err.getvalue(), fake, tripadvisor

    def test_calendar_add_injects_household_id(self) -> None:
        rc, _, err, fake, _ta = self.run_cli(
            [
                "calendar",
                "add",
                "--title",
                "Dentist",
                "--starts-at",
                "2026-05-01T13:00:00Z",
                "--segment",
                "social",
                "--kind",
                "appointment",
            ]
        )

        self.assertEqual(rc, 0, err)
        call = fake.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["schema"], "app")
        self.assertEqual(call["table"], "event")
        self.assertEqual(call["body"]["household_id"], "household-1")
        self.assertEqual(call["body"]["title"], "Dentist")

    def test_pantry_list_adds_household_filter(self) -> None:
        rc, _out, err, fake, _ta = self.run_cli(["food", "pantry", "list", "--location", "pantry"])

        self.assertEqual(rc, 0, err)
        params = fake.calls[0]["params"]
        self.assertIn(("household_id", "eq.household-1"), params)
        self.assertIn(("location", "eq.pantry"), params)

    def test_suggestion_create_uses_current_schema(self) -> None:
        rc, _, err, fake, _ta = self.run_cli(
            [
                "suggestions",
                "create",
                "--segment",
                "food",
                "--kind",
                "propose_grocery_order",
                "--title",
                "Review grocery order",
                "--rationale",
                "Checkout needs approval.",
                "--preview-json",
                '{"provider":"instacart"}',
            ]
        )

        self.assertEqual(rc, 0, err)
        body = fake.calls[0]["body"]
        self.assertEqual(body["household_id"], "household-1")
        self.assertEqual(body["status"], "pending")
        self.assertEqual(body["preview"], {"provider": "instacart"})
        self.assertNotIn("proposed_action", body)

    def test_onboarding_progress_preserves_existing_values(self) -> None:
        rc, out, err, fake, _ta = self.run_cli(
            [
                "onboarding",
                "record-progress",
                "--segment",
                "food",
                "--prompt-id",
                "food.groceries",
                "--surface-id",
                "decisions",
            ]
        )

        self.assertEqual(rc, 0, err)
        self.assertEqual(fake.calls[0]["method"], "GET")
        patch = fake.calls[1]
        self.assertEqual(patch["method"], "PATCH")
        self.assertEqual(patch["params"], [("id", "eq.household-1")])
        onboarding = patch["body"]["settings"]["onboarding"]
        self.assertEqual(onboarding["setup_segments"], ["food"])
        self.assertEqual(onboarding["setup_prompt_ids"], ["food.pantry", "food.groceries"])
        self.assertEqual(onboarding["setup_surface_ids"], ["decisions"])
        self.assertIn("last_onboarded_at", onboarding)
        parsed = json.loads(out)
        self.assertEqual(parsed[0]["ok"], True)

    def test_tripadvisor_search_normalizes_results(self) -> None:
        ta = FakeTripAdvisor(
            {
                "/location/search": {
                    "data": [
                        {
                            "location_id": "12345",
                            "name": "Grotta Palazzese",
                            "web_url": "https://www.tripadvisor.com/Restaurant_Review-g12345",
                            "address_obj": {
                                "address_string": "Via Narciso 59, Polignano a Mare"
                            },
                            "rating": "4.5",
                            "num_reviews": "1234",
                            "category": {"name": "restaurant"},
                        }
                    ]
                }
            }
        )
        rc, out, err, _fake, _ta = self.run_cli(
            [
                "tripadvisor",
                "search",
                "--query",
                "Grotta Palazzese",
                "--category",
                "restaurants",
                "--limit",
                "3",
            ],
            tripadvisor=ta,
        )

        self.assertEqual(rc, 0, err)
        parsed = json.loads(out)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["name"], "Grotta Palazzese")
        self.assertEqual(parsed[0]["web_url"], "https://www.tripadvisor.com/Restaurant_Review-g12345")
        self.assertEqual(parsed[0]["rating"], 4.5)
        self.assertEqual(parsed[0]["num_reviews"], 1234)
        self.assertEqual(parsed[0]["category"], "restaurant")
        # Called search but not photos (no --with-photos flag).
        self.assertEqual(ta.calls[0][0], "/location/search")
        self.assertTrue(any(p == ("searchQuery", "Grotta Palazzese") for p in ta.calls[0][1]))
        self.assertTrue(any(p == ("category", "restaurants") for p in ta.calls[0][1]))
        self.assertEqual(len(ta.calls), 1)

    def test_tripadvisor_search_with_photos_fetches_photo_url(self) -> None:
        ta = FakeTripAdvisor(
            {
                "/location/search": {
                    "data": [
                        {
                            "location_id": "999",
                            "name": "Cool Place",
                            "web_url": "https://www.tripadvisor.com/Attraction_Review-g999",
                        }
                    ]
                },
                "/location/999/photos": {
                    "data": [
                        {
                            "id": 1,
                            "images": {
                                "thumbnail": {"url": "https://cdn/t.jpg"},
                                "medium": {"url": "https://cdn/m.jpg"},
                                "large": {"url": "https://cdn/l.jpg"},
                            },
                        }
                    ]
                },
            }
        )
        rc, out, err, _fake, _ta = self.run_cli(
            ["tripadvisor", "search", "--query", "Cool", "--with-photos"],
            tripadvisor=ta,
        )

        self.assertEqual(rc, 0, err)
        parsed = json.loads(out)
        self.assertEqual(parsed[0]["photo_url"], "https://cdn/m.jpg")
        paths = [call[0] for call in ta.calls]
        self.assertIn("/location/search", paths)
        self.assertIn("/location/999/photos", paths)

    def test_tripadvisor_nearby_requires_query_or_lat_long(self) -> None:
        ta = FakeTripAdvisor()
        rc, _out, err, _fake, _ta = self.run_cli(
            ["tripadvisor", "search"],
            tripadvisor=ta,
        )
        self.assertEqual(rc, 2)
        self.assertIn("--query is required", err)
        self.assertEqual(ta.calls, [])

    def test_tripadvisor_nearby_with_lat_long(self) -> None:
        ta = FakeTripAdvisor(
            {
                "/location/nearby_search": {
                    "data": [
                        {
                            "location_id": "77",
                            "name": "Nearby Spot",
                            "web_url": "https://www.tripadvisor.com/X-77",
                        }
                    ]
                }
            }
        )
        rc, _out, err, _fake, _ta = self.run_cli(
            ["tripadvisor", "search", "--lat-long", "40.7,-74.0"],
            tripadvisor=ta,
        )
        self.assertEqual(rc, 0, err)
        self.assertEqual(ta.calls[0][0], "/location/nearby_search")
        self.assertTrue(any(p == ("latLong", "40.7,-74.0") for p in ta.calls[0][1]))

    def test_tripadvisor_missing_key_reports_helpful_error(self) -> None:
        env = {k: v for k, v in ENV.items() if k != "TRIPADVISOR_API_KEY"}
        rc, _out, err, _fake, _ta = self.run_cli(
            ["tripadvisor", "search", "--query", "x"],
            env=env,
        )
        self.assertEqual(rc, 2)
        self.assertIn("TRIPADVISOR_API_KEY", err)

    def test_tripadvisor_photos_surfaces_large_and_thumb(self) -> None:
        ta = FakeTripAdvisor(
            {
                "/location/555/photos": {
                    "data": [
                        {
                            "id": 42,
                            "caption": "Sunset",
                            "images": {
                                "thumbnail": {"url": "https://cdn/t.jpg"},
                                "medium": {"url": "https://cdn/m.jpg"},
                                "large": {"url": "https://cdn/l.jpg"},
                            },
                            "published_date": "2025-01-01",
                        }
                    ]
                }
            }
        )
        rc, out, err, _fake, _ta = self.run_cli(
            ["tripadvisor", "photos", "--location-id", "555", "--limit", "2"],
            tripadvisor=ta,
        )
        self.assertEqual(rc, 0, err)
        parsed = json.loads(out)
        self.assertEqual(parsed[0]["url"], "https://cdn/m.jpg")
        self.assertEqual(parsed[0]["large_url"], "https://cdn/l.jpg")
        self.assertEqual(parsed[0]["thumbnail_url"], "https://cdn/t.jpg")
        self.assertEqual(parsed[0]["caption"], "Sunset")

    def test_missing_environment_fails_before_request(self) -> None:
        fake = FakeClient()
        out = io.StringIO()
        err = io.StringIO()
        rc = homehub_cli.run(
            ["calendar", "list"],
            env={"HOUSEHOLD_ID": "household-1"},
            client=fake,
            out=out,
            err=err,
        )

        self.assertEqual(rc, 2)
        self.assertEqual(fake.calls, [])
        self.assertIn("missing required environment", err.getvalue())


if __name__ == "__main__":
    unittest.main()
