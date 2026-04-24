#!/usr/bin/env python3
"""Household-scoped HomeHub CLI for Hermes sandbox skills.

The CLI intentionally exposes typed HomeHub actions instead of raw
PostgREST URLs. It injects HOUSEHOLD_ID into every scoped read/write and
uses the short-lived Hermes JWT from the sandbox environment.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Iterable, Protocol, TextIO


SEGMENTS = ("financial", "food", "fun", "social", "system")
TRIPADVISOR_BASE_URL = "https://api.content.tripadvisor.com/api/v1"
TRIPADVISOR_CATEGORIES = ("hotels", "restaurants", "attractions", "geos")
MEAL_SLOTS = ("breakfast", "lunch", "dinner", "snack")
MEAL_STATUSES = ("planned", "cooking", "served", "skipped")
PANTRY_LOCATIONS = ("fridge", "freezer", "pantry")
ACCOUNT_KINDS = ("checking", "savings", "credit", "investment", "loan", "cash")
BUDGET_PERIODS = ("weekly", "monthly", "yearly")
GROCERY_STATUSES = ("draft", "ordered", "received", "cancelled")
NODE_TYPES = (
    "person",
    "place",
    "merchant",
    "dish",
    "ingredient",
    "topic",
    "event_type",
    "subscription",
    "account",
    "category",
)


class HomeHubError(Exception):
    """User-facing CLI error."""


@dataclass(frozen=True)
class EnvConfig:
    household_id: str
    supabase_url: str
    anon_key: str
    jwt: str
    member_id: str | None = None
    member_role: str | None = None
    conversation_id: str | None = None
    tripadvisor_api_key: str | None = None

    @classmethod
    def from_env(cls, env: dict[str, str]) -> "EnvConfig":
        missing = [
            name
            for name in (
                "HOUSEHOLD_ID",
                "HOMEHUB_SUPABASE_URL",
                "HOMEHUB_SUPABASE_ANON_KEY",
                "HOMEHUB_SUPABASE_JWT",
            )
            if not env.get(name)
        ]
        if missing:
            raise HomeHubError(f"missing required environment variable(s): {', '.join(missing)}")
        return cls(
            household_id=env["HOUSEHOLD_ID"],
            supabase_url=env["HOMEHUB_SUPABASE_URL"].rstrip("/"),
            anon_key=env["HOMEHUB_SUPABASE_ANON_KEY"],
            jwt=env["HOMEHUB_SUPABASE_JWT"],
            member_id=env.get("HOMEHUB_MEMBER_ID"),
            member_role=env.get("HOMEHUB_MEMBER_ROLE"),
            conversation_id=env.get("HOMEHUB_CONVERSATION_ID"),
            tripadvisor_api_key=env.get("TRIPADVISOR_API_KEY")
            or env.get("HOMEHUB_TRIPADVISOR_API_KEY"),
        )


ParamList = list[tuple[str, str]]


class Client(Protocol):
    def request(
        self,
        method: str,
        schema: str,
        table: str,
        *,
        params: ParamList | None = None,
        body: dict[str, Any] | None = None,
        prefer: str | None = None,
    ) -> Any:
        ...


class PostgrestClient:
    def __init__(self, config: EnvConfig):
        self.config = config

    def request(
        self,
        method: str,
        schema: str,
        table: str,
        *,
        params: ParamList | None = None,
        body: dict[str, Any] | None = None,
        prefer: str | None = None,
    ) -> Any:
        query = ""
        if params:
            query = "?" + urllib.parse.urlencode(params, doseq=True, safe=",.*:()!_")
        url = f"{self.config.supabase_url}/rest/v1/{urllib.parse.quote(table)}{query}"
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        headers = {
            "apikey": self.config.anon_key,
            "Authorization": f"Bearer {self.config.jwt}",
            "Accept-Profile": schema,
            "Accept": "application/json",
        }
        if body is not None:
            headers.update(
                {
                    "Content-Profile": schema,
                    "Content-Type": "application/json",
                    "Prefer": prefer or "return=representation",
                }
            )
        elif prefer:
            headers["Prefer"] = prefer

        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace").strip()
            raise HomeHubError(f"PostgREST {method} {schema}.{table} failed: HTTP {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise HomeHubError(f"PostgREST {method} {schema}.{table} failed: {exc.reason}") from exc

        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw


class TripAdvisorClient(Protocol):
    def get(self, path: str, params: ParamList | None = None) -> Any:
        ...


class TripAdvisorHttpClient:
    """Thin urllib wrapper around the TripAdvisor Content API.

    The API authenticates via a `key` query parameter. Every response is
    a JSON object; we bubble up HTTP errors as `HomeHubError` so the CLI
    renders a consistent `homehub: ...` message instead of crashing.
    """

    def __init__(self, api_key: str, base_url: str = TRIPADVISOR_BASE_URL):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def get(self, path: str, params: ParamList | None = None) -> Any:
        query_params = [("key", self.api_key)] + list(params or [])
        url = f"{self.base_url}{path}?{urllib.parse.urlencode(query_params, doseq=True)}"
        req = urllib.request.Request(
            url,
            method="GET",
            headers={
                "Accept": "application/json",
                # TripAdvisor rejects default urllib UA in some regions.
                "User-Agent": "HomeHub/1.0 (+https://homehub.app)",
                "Referer": "https://homehub.app",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace").strip()
            raise HomeHubError(
                f"TripAdvisor {path} failed: HTTP {exc.code} {detail}"
            ) from exc
        except urllib.error.URLError as exc:
            raise HomeHubError(f"TripAdvisor {path} failed: {exc.reason}") from exc

        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw


@dataclass
class CommandContext:
    config: EnvConfig
    client: Client
    tripadvisor: TripAdvisorClient | None = None


def parse_json(raw: str | None, *, default: Any = None, label: str = "json") -> Any:
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HomeHubError(f"invalid {label}: {exc}") from exc


def add_if(params: ParamList, key: str, value: str | None, op: str = "eq") -> None:
    if value is not None and value != "":
        params.append((key, f"{op}.{value}"))


def scoped_params(ctx: CommandContext, table: str, params: ParamList | None = None) -> ParamList:
    out = list(params or [])
    if table == "household":
        out.append(("id", f"eq.{ctx.config.household_id}"))
    else:
        out.append(("household_id", f"eq.{ctx.config.household_id}"))
    return out


def scoped_body(ctx: CommandContext, body: dict[str, Any]) -> dict[str, Any]:
    if "household_id" in body:
        raise HomeHubError("do not pass household_id; the homehub CLI injects it from the Hermes JWT scope")
    return {"household_id": ctx.config.household_id, **body}


def compact_body(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if value is not None}


def require_member_id(ctx: CommandContext) -> str:
    if not ctx.config.member_id:
        raise HomeHubError("HOMEHUB_MEMBER_ID is required for this command")
    return ctx.config.member_id


def get(ctx: CommandContext, schema: str, table: str, params: ParamList) -> Any:
    return ctx.client.request("GET", schema, table, params=scoped_params(ctx, table, params))


def insert(ctx: CommandContext, schema: str, table: str, body: dict[str, Any]) -> Any:
    return ctx.client.request("POST", schema, table, body=scoped_body(ctx, compact_body(body)))


def patch(ctx: CommandContext, schema: str, table: str, params: ParamList, body: dict[str, Any]) -> Any:
    return ctx.client.request(
        "PATCH",
        schema,
        table,
        params=scoped_params(ctx, table, params),
        body=compact_body(body),
    )


def delete(ctx: CommandContext, schema: str, table: str, params: ParamList) -> Any:
    return ctx.client.request(
        "DELETE",
        schema,
        table,
        params=scoped_params(ctx, table, params),
        prefer="return=representation",
    )


def cmd_calendar_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "starts_at.asc"), ("limit", str(args.limit))]
    add_if(params, "starts_at", args.from_iso, "gte")
    add_if(params, "starts_at", args.to_iso, "lte")
    add_if(params, "segment", args.segment)
    add_if(params, "kind", args.kind)
    return get(ctx, "app", "event", params)


def cmd_calendar_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "event",
        {
            "segment": args.segment,
            "kind": args.kind,
            "title": args.title,
            "starts_at": args.starts_at,
            "ends_at": args.ends_at,
            "all_day": args.all_day,
            "location": args.location,
            "metadata": parse_json(args.metadata_json, default={}, label="metadata-json"),
        },
    )


def cmd_food_meals_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "planned_for.asc,slot.asc"), ("limit", str(args.limit))]
    add_if(params, "planned_for", args.from_date, "gte")
    add_if(params, "planned_for", args.to_date, "lte")
    add_if(params, "status", args.status)
    return get(ctx, "app", "meal", params)


def cmd_food_meals_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "meal",
        {
            "planned_for": args.planned_for,
            "slot": args.slot,
            "title": args.title,
            "servings": args.servings,
            "status": args.status,
            "notes": args.notes,
        },
    )


def cmd_food_pantry_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "name.asc"), ("limit", str(args.limit))]
    add_if(params, "location", args.location)
    return get(ctx, "app", "pantry_item", params)


def cmd_food_pantry_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "pantry_item",
        {
            "name": args.name,
            "quantity": args.quantity,
            "unit": args.unit,
            "expires_on": args.expires_on,
            "location": args.location,
        },
    )


def cmd_food_pantry_update(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return patch(
        ctx,
        "app",
        "pantry_item",
        [("id", f"eq.{args.id}")],
        {
            "name": args.name,
            "quantity": args.quantity,
            "unit": args.unit,
            "expires_on": args.expires_on,
            "location": args.location,
            "last_seen_at": datetime.now(UTC).isoformat() if args.touch else None,
        },
    )


def cmd_food_pantry_remove(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return delete(ctx, "app", "pantry_item", [("id", f"eq.{args.id}")])


def cmd_food_groceries_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [
        ("select", "*,grocery_list_item(*)"),
        ("order", "updated_at.desc"),
        ("limit", str(args.limit)),
    ]
    add_if(params, "status", args.status)
    return get(ctx, "app", "grocery_list", params)


def cmd_food_groceries_create(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "grocery_list",
        {
            "planned_for": args.planned_for,
            "status": args.status,
            "provider": args.provider,
            "external_order_id": args.external_order_id,
        },
    )


def cmd_food_groceries_add_item(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "grocery_list_item",
        {
            "list_id": args.list_id,
            "name": args.name,
            "quantity": args.quantity,
            "unit": args.unit,
        },
    )


def cmd_money_transactions_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "occurred_at.desc"), ("limit", str(args.limit))]
    add_if(params, "occurred_at", args.from_iso, "gte")
    add_if(params, "occurred_at", args.to_iso, "lte")
    add_if(params, "account_id", args.account_id)
    add_if(params, "category", args.category)
    return get(ctx, "app", "transaction", params)


def cmd_money_accounts_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "created_at.desc"), ("limit", str(args.limit))]
    add_if(params, "kind", args.kind)
    return get(ctx, "app", "account", params)


def cmd_money_accounts_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "account",
        {
            "owner_member_id": args.owner_member_id,
            "kind": args.kind,
            "name": args.name,
            "balance_cents": args.balance_cents,
            "currency": args.currency,
        },
    )


def cmd_money_budgets_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "category.asc"), ("limit", str(args.limit))]
    add_if(params, "period", args.period)
    add_if(params, "category", args.category)
    return get(ctx, "app", "budget", params)


def cmd_money_budgets_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "budget",
        {
            "name": args.name,
            "period": args.period,
            "category": args.category,
            "amount_cents": args.amount_cents,
            "currency": args.currency,
        },
    )


def cmd_money_bill_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    metadata = parse_json(args.metadata_json, default={}, label="metadata-json")
    if args.amount_cents is not None:
        metadata = {**metadata, "amount_cents": args.amount_cents}
    return insert(
        ctx,
        "app",
        "event",
        {
            "segment": "financial",
            "kind": "bill_due",
            "title": args.title,
            "starts_at": args.starts_at,
            "ends_at": args.ends_at,
            "all_day": args.all_day,
            "metadata": metadata,
        },
    )


def cmd_social_people_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "display_name.asc"), ("limit", str(args.limit))]
    if args.query:
        params.append(("display_name", f"ilike.*{args.query}*"))
    return get(ctx, "app", "person", params)


def cmd_social_people_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    metadata = parse_json(args.metadata_json, default={}, label="metadata-json")
    return insert(
        ctx,
        "app",
        "person",
        {
            "member_id": args.member_id,
            "display_name": args.name,
            "aliases": args.alias,
            "relationship": args.relationship,
            "metadata": metadata,
        },
    )


def cmd_suggestions_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "created_at.desc"), ("limit", str(args.limit))]
    add_if(params, "status", args.status)
    add_if(params, "segment", args.segment)
    return get(ctx, "app", "suggestion", params)


def cmd_suggestions_create(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "app",
        "suggestion",
        {
            "segment": args.segment,
            "kind": args.kind,
            "title": args.title,
            "rationale": args.rationale,
            "preview": parse_json(args.preview_json, default={}, label="preview-json"),
            "status": "pending",
        },
    )


def cmd_memory_nodes_search(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "updated_at.desc"), ("limit", str(args.limit))]
    add_if(params, "type", args.type)
    if args.query:
        params.append(("canonical_name", f"ilike.*{args.query}*"))
    return get(ctx, "mem", "node", params)


def cmd_memory_nodes_create(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return insert(
        ctx,
        "mem",
        "node",
        {
            "type": args.type,
            "canonical_name": args.name,
            "manual_notes_md": args.notes,
            "metadata": parse_json(args.metadata_json, default={}, label="metadata-json"),
            "needs_review": args.needs_review,
        },
    )


def cmd_memory_facts_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "recorded_at.desc"), ("limit", str(args.limit))]
    add_if(params, "subject_node_id", args.subject_node_id)
    add_if(params, "predicate", args.predicate)
    if args.current:
        params.append(("valid_to", "is.null"))
    return get(ctx, "mem", "fact", params)


def cmd_memory_fact_candidate_add(args: argparse.Namespace, ctx: CommandContext) -> Any:
    object_value = parse_json(args.object_json, default=None, label="object-json")
    if object_value is None and args.object_text is not None:
        object_value = args.object_text
    return insert(
        ctx,
        "mem",
        "fact_candidate",
        {
            "subject_node_id": args.subject_node_id,
            "predicate": args.predicate,
            "object_value": object_value,
            "object_node_id": args.object_node_id,
            "confidence": args.confidence,
            "evidence": parse_json(args.evidence_json, default=[], label="evidence-json"),
            "valid_from": args.valid_from,
            "valid_to": args.valid_to,
            "source": "member",
            "reason": args.reason,
        },
    )


def cmd_settings_household(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return get(ctx, "app", "household", [("select", "*")])


def cmd_settings_members(args: argparse.Namespace, ctx: CommandContext) -> Any:
    return get(ctx, "app", "member", [("select", "*"), ("order", "created_at.asc")])


def cmd_settings_connections(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "created_at.desc"), ("limit", str(args.limit))]
    add_if(params, "provider", args.provider)
    add_if(params, "status", args.status)
    return get(ctx, "sync", "provider_connection", params)


def cmd_settings_grants(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [
        ("select", "*,member!inner(household_id,display_name,role)"),
        ("member.household_id", f"eq.{ctx.config.household_id}"),
        ("order", "segment.asc"),
    ]
    return ctx.client.request("GET", "app", "member_segment_grant", params=params)


def cmd_chat_conversations_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "last_message_at.desc"), ("limit", str(args.limit))]
    if args.pinned:
        params.append(("pinned", "eq.true"))
    return get(ctx, "app", "conversation", params)


def cmd_chat_turns_list(args: argparse.Namespace, ctx: CommandContext) -> Any:
    conversation_id = args.conversation_id or ctx.config.conversation_id
    if not conversation_id:
        raise HomeHubError("pass --conversation-id or set HOMEHUB_CONVERSATION_ID")
    params: ParamList = [
        ("select", "*"),
        ("conversation_id", f"eq.{conversation_id}"),
        ("order", "created_at.asc"),
        ("limit", str(args.limit)),
    ]
    return get(ctx, "app", "conversation_turn", params)


def cmd_ops_model_calls(args: argparse.Namespace, ctx: CommandContext) -> Any:
    params: ParamList = [("select", "*"), ("order", "at.desc"), ("limit", str(args.limit))]
    add_if(params, "task", args.task)
    return get(ctx, "app", "model_calls", params)


def cmd_onboarding_progress(args: argparse.Namespace, ctx: CommandContext) -> Any:
    rows = get(ctx, "app", "household", [("select", "settings")])
    settings = rows[0].get("settings") if rows else {}
    if not isinstance(settings, dict):
        settings = {}
    onboarding = settings.get("onboarding")
    if not isinstance(onboarding, dict):
        onboarding = {}

    segments = list(onboarding.get("setup_segments") or [])
    prompt_ids = list(onboarding.get("setup_prompt_ids") or [])
    surface_ids = list(onboarding.get("setup_surface_ids") or [])

    if args.segment and args.segment not in segments:
        segments.append(args.segment)
    for prompt_id in args.prompt_id:
        if prompt_id not in prompt_ids:
            prompt_ids.append(prompt_id)
    for surface_id in args.surface_id:
        if surface_id not in ("calendar", "decisions"):
            raise HomeHubError("surface ids must be 'calendar' or 'decisions'")
        if surface_id not in surface_ids:
            surface_ids.append(surface_id)

    onboarding["setup_segments"] = segments
    onboarding["setup_prompt_ids"] = prompt_ids
    onboarding["setup_surface_ids"] = surface_ids
    onboarding["last_onboarded_at"] = datetime.now(UTC).isoformat()
    settings["onboarding"] = onboarding

    return ctx.client.request(
        "PATCH",
        "app",
        "household",
        params=[("id", f"eq.{ctx.config.household_id}")],
        body={"settings": settings},
    )


def require_tripadvisor(ctx: CommandContext) -> TripAdvisorClient:
    if ctx.tripadvisor is not None:
        return ctx.tripadvisor
    api_key = ctx.config.tripadvisor_api_key
    if not api_key:
        raise HomeHubError(
            "TRIPADVISOR_API_KEY is not set in the sandbox env; ask HomeHub to configure it in the router"
        )
    ctx.tripadvisor = TripAdvisorHttpClient(api_key)
    return ctx.tripadvisor


def _tripadvisor_pick_photo(photos_payload: Any) -> str | None:
    """Pick a reasonable photo URL from a TripAdvisor photos response.

    TripAdvisor returns an array under `data`; each entry has `images`
    keyed by size (`thumbnail`, `small`, `medium`, `large`, `original`).
    We prefer `medium` to stay chat-friendly; fall back through the size
    ladder if that's missing.
    """
    if not isinstance(photos_payload, dict):
        return None
    entries = photos_payload.get("data")
    if not isinstance(entries, list):
        return None
    for entry in entries:
        images = (entry or {}).get("images") if isinstance(entry, dict) else None
        if not isinstance(images, dict):
            continue
        for size in ("medium", "large", "small", "original", "thumbnail"):
            candidate = images.get(size)
            if isinstance(candidate, dict) and isinstance(candidate.get("url"), str):
                return candidate["url"]
    return None


def _tripadvisor_normalize_location(
    entry: dict[str, Any],
    *,
    photo_url: str | None = None,
) -> dict[str, Any]:
    """Flatten a TripAdvisor location into the fields our chat LLM needs.

    We pull `web_url` up to the top level because TripAdvisor's Content
    API terms require linking back to the canonical page whenever we
    display any data. Keeping the raw payload under `raw` lets the model
    reach for less-common fields (hours, cuisine, subratings) without
    losing the guarantee that `web_url` is always present.
    """
    address_obj = entry.get("address_obj") or {}
    address = (
        address_obj.get("address_string")
        if isinstance(address_obj, dict)
        else None
    )
    rating = entry.get("rating")
    try:
        rating_value = float(rating) if rating is not None else None
    except (TypeError, ValueError):
        rating_value = None
    num_reviews = entry.get("num_reviews")
    try:
        num_reviews_int = int(num_reviews) if num_reviews is not None else None
    except (TypeError, ValueError):
        num_reviews_int = None
    return {
        "location_id": entry.get("location_id"),
        "name": entry.get("name"),
        "web_url": entry.get("web_url"),
        "photo_url": photo_url,
        "address": address,
        "rating": rating_value,
        "num_reviews": num_reviews_int,
        "category": (entry.get("category") or {}).get("name")
        if isinstance(entry.get("category"), dict)
        else None,
        "raw": entry,
    }


def cmd_tripadvisor_search(args: argparse.Namespace, ctx: CommandContext) -> Any:
    client = require_tripadvisor(ctx)
    params: ParamList = [("language", args.language)]
    if args.lat_long:
        path = "/location/nearby_search"
        params.append(("latLong", args.lat_long))
        if args.query:
            params.append(("searchQuery", args.query))
    else:
        if not args.query:
            raise HomeHubError("--query is required unless --lat-long is set")
        path = "/location/search"
        params.append(("searchQuery", args.query))
    if args.category:
        params.append(("category", args.category))
    if args.address:
        params.append(("address", args.address))
    if args.phone:
        params.append(("phone", args.phone))

    payload = client.get(path, params)
    entries = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return []
    results: list[dict[str, Any]] = []
    for entry in entries[: args.limit]:
        if not isinstance(entry, dict):
            continue
        photo_url: str | None = None
        if args.with_photos and entry.get("location_id"):
            try:
                photos = client.get(f"/location/{entry['location_id']}/photos", [("language", args.language)])
            except HomeHubError:
                photos = None
            photo_url = _tripadvisor_pick_photo(photos)
        results.append(_tripadvisor_normalize_location(entry, photo_url=photo_url))
    return results


def cmd_tripadvisor_details(args: argparse.Namespace, ctx: CommandContext) -> Any:
    client = require_tripadvisor(ctx)
    detail_params: ParamList = [("language", args.language)]
    if args.currency:
        detail_params.append(("currency", args.currency))
    detail = client.get(f"/location/{args.location_id}/details", detail_params)
    if not isinstance(detail, dict):
        return detail
    photo_url: str | None = None
    if args.with_photos:
        try:
            photos = client.get(f"/location/{args.location_id}/photos", [("language", args.language)])
        except HomeHubError:
            photos = None
        photo_url = _tripadvisor_pick_photo(photos)
    return _tripadvisor_normalize_location(detail, photo_url=photo_url)


def cmd_tripadvisor_photos(args: argparse.Namespace, ctx: CommandContext) -> Any:
    client = require_tripadvisor(ctx)
    params: ParamList = [("language", args.language), ("limit", str(args.limit))]
    if args.source:
        params.append(("source", args.source))
    payload = client.get(f"/location/{args.location_id}/photos", params)
    if not isinstance(payload, dict):
        return []
    entries = payload.get("data")
    if not isinstance(entries, list):
        return []
    normalized: list[dict[str, Any]] = []
    for entry in entries[: args.limit]:
        if not isinstance(entry, dict):
            continue
        images = entry.get("images") if isinstance(entry.get("images"), dict) else {}
        normalized.append(
            {
                "id": entry.get("id"),
                "caption": entry.get("caption"),
                "url": _tripadvisor_pick_photo({"data": [entry]}),
                "thumbnail_url": (images.get("thumbnail") or {}).get("url")
                if isinstance(images.get("thumbnail"), dict)
                else None,
                "large_url": (images.get("large") or {}).get("url")
                if isinstance(images.get("large"), dict)
                else None,
                "published_date": entry.get("published_date"),
            }
        )
    return normalized


def cmd_tripadvisor_reviews(args: argparse.Namespace, ctx: CommandContext) -> Any:
    client = require_tripadvisor(ctx)
    params: ParamList = [("language", args.language), ("limit", str(args.limit))]
    payload = client.get(f"/location/{args.location_id}/reviews", params)
    if not isinstance(payload, dict):
        return []
    entries = payload.get("data")
    if not isinstance(entries, list):
        return []
    normalized: list[dict[str, Any]] = []
    for entry in entries[: args.limit]:
        if not isinstance(entry, dict):
            continue
        normalized.append(
            {
                "id": entry.get("id"),
                "title": entry.get("title"),
                "text": entry.get("text"),
                "rating": entry.get("rating"),
                "published_date": entry.get("published_date"),
                "url": entry.get("url"),
                "trip_type": entry.get("trip_type"),
                "user": (entry.get("user") or {}).get("username")
                if isinstance(entry.get("user"), dict)
                else None,
            }
        )
    return normalized


def add_limit(parser: argparse.ArgumentParser, default: int = 50) -> None:
    parser.add_argument("--limit", type=int, default=default)


def add_metadata(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--metadata-json", help="JSON object; defaults to {}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="homehub",
        description="Household-scoped HomeHub tool surface for Hermes skills.",
    )
    sub = parser.add_subparsers(dest="area", required=True)

    calendar = sub.add_parser("calendar")
    calendar_sub = calendar.add_subparsers(dest="command", required=True)
    p = calendar_sub.add_parser("list")
    p.add_argument("--from", dest="from_iso")
    p.add_argument("--to", dest="to_iso")
    p.add_argument("--segment", choices=SEGMENTS)
    p.add_argument("--kind")
    add_limit(p)
    p.set_defaults(handler=cmd_calendar_list)
    p = calendar_sub.add_parser("add")
    p.add_argument("--title", required=True)
    p.add_argument("--starts-at", required=True)
    p.add_argument("--ends-at")
    p.add_argument("--segment", choices=SEGMENTS, required=True)
    p.add_argument("--kind", default="manual")
    p.add_argument("--all-day", action="store_true")
    p.add_argument("--location")
    add_metadata(p)
    p.set_defaults(handler=cmd_calendar_add)

    food = sub.add_parser("food")
    food_sub = food.add_subparsers(dest="resource", required=True)
    meals = food_sub.add_parser("meals")
    meals_sub = meals.add_subparsers(dest="command", required=True)
    p = meals_sub.add_parser("list")
    p.add_argument("--from", dest="from_date")
    p.add_argument("--to", dest="to_date")
    p.add_argument("--status", choices=MEAL_STATUSES)
    add_limit(p)
    p.set_defaults(handler=cmd_food_meals_list)
    p = meals_sub.add_parser("add")
    p.add_argument("--planned-for", required=True)
    p.add_argument("--slot", choices=MEAL_SLOTS, required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--servings", type=int)
    p.add_argument("--status", choices=MEAL_STATUSES, default="planned")
    p.add_argument("--notes")
    p.set_defaults(handler=cmd_food_meals_add)
    pantry = food_sub.add_parser("pantry")
    pantry_sub = pantry.add_subparsers(dest="command", required=True)
    p = pantry_sub.add_parser("list")
    p.add_argument("--location", choices=PANTRY_LOCATIONS)
    add_limit(p)
    p.set_defaults(handler=cmd_food_pantry_list)
    p = pantry_sub.add_parser("add")
    p.add_argument("--name", required=True)
    p.add_argument("--quantity", type=float)
    p.add_argument("--unit")
    p.add_argument("--expires-on")
    p.add_argument("--location", choices=PANTRY_LOCATIONS)
    p.set_defaults(handler=cmd_food_pantry_add)
    p = pantry_sub.add_parser("update")
    p.add_argument("--id", required=True)
    p.add_argument("--name")
    p.add_argument("--quantity", type=float)
    p.add_argument("--unit")
    p.add_argument("--expires-on")
    p.add_argument("--location", choices=PANTRY_LOCATIONS)
    p.add_argument("--touch", action="store_true")
    p.set_defaults(handler=cmd_food_pantry_update)
    p = pantry_sub.add_parser("remove")
    p.add_argument("--id", required=True)
    p.set_defaults(handler=cmd_food_pantry_remove)
    groceries = food_sub.add_parser("groceries")
    groceries_sub = groceries.add_subparsers(dest="command", required=True)
    p = groceries_sub.add_parser("list")
    p.add_argument("--status", choices=GROCERY_STATUSES)
    add_limit(p, default=10)
    p.set_defaults(handler=cmd_food_groceries_list)
    p = groceries_sub.add_parser("create")
    p.add_argument("--planned-for")
    p.add_argument("--status", choices=GROCERY_STATUSES, default="draft")
    p.add_argument("--provider")
    p.add_argument("--external-order-id")
    p.set_defaults(handler=cmd_food_groceries_create)
    p = groceries_sub.add_parser("add-item")
    p.add_argument("--list-id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--quantity", type=float)
    p.add_argument("--unit")
    p.set_defaults(handler=cmd_food_groceries_add_item)

    money = sub.add_parser("money")
    money_sub = money.add_subparsers(dest="resource", required=True)
    transactions = money_sub.add_parser("transactions")
    transactions_sub = transactions.add_subparsers(dest="command", required=True)
    p = transactions_sub.add_parser("list")
    p.add_argument("--from", dest="from_iso")
    p.add_argument("--to", dest="to_iso")
    p.add_argument("--account-id")
    p.add_argument("--category")
    add_limit(p, default=100)
    p.set_defaults(handler=cmd_money_transactions_list)
    accounts = money_sub.add_parser("accounts")
    accounts_sub = accounts.add_subparsers(dest="command", required=True)
    p = accounts_sub.add_parser("list")
    p.add_argument("--kind", choices=ACCOUNT_KINDS)
    add_limit(p)
    p.set_defaults(handler=cmd_money_accounts_list)
    p = accounts_sub.add_parser("add")
    p.add_argument("--name", required=True)
    p.add_argument("--kind", choices=ACCOUNT_KINDS, required=True)
    p.add_argument("--balance-cents", type=int)
    p.add_argument("--currency", default="USD")
    p.add_argument("--owner-member-id")
    p.set_defaults(handler=cmd_money_accounts_add)
    budgets = money_sub.add_parser("budgets")
    budgets_sub = budgets.add_subparsers(dest="command", required=True)
    p = budgets_sub.add_parser("list")
    p.add_argument("--period", choices=BUDGET_PERIODS)
    p.add_argument("--category")
    add_limit(p)
    p.set_defaults(handler=cmd_money_budgets_list)
    p = budgets_sub.add_parser("add")
    p.add_argument("--name", required=True)
    p.add_argument("--period", choices=BUDGET_PERIODS, required=True)
    p.add_argument("--category", required=True)
    p.add_argument("--amount-cents", type=int, required=True)
    p.add_argument("--currency", default="USD")
    p.set_defaults(handler=cmd_money_budgets_add)
    bills = money_sub.add_parser("bills")
    bills_sub = bills.add_subparsers(dest="command", required=True)
    p = bills_sub.add_parser("add")
    p.add_argument("--title", required=True)
    p.add_argument("--starts-at", required=True)
    p.add_argument("--ends-at")
    p.add_argument("--all-day", action="store_true")
    p.add_argument("--amount-cents", type=int)
    add_metadata(p)
    p.set_defaults(handler=cmd_money_bill_add)

    social = sub.add_parser("social")
    social_sub = social.add_subparsers(dest="resource", required=True)
    people = social_sub.add_parser("people")
    people_sub = people.add_subparsers(dest="command", required=True)
    p = people_sub.add_parser("list")
    p.add_argument("--query")
    add_limit(p)
    p.set_defaults(handler=cmd_social_people_list)
    p = people_sub.add_parser("add")
    p.add_argument("--name", required=True)
    p.add_argument("--relationship")
    p.add_argument("--alias", action="append", default=[])
    p.add_argument("--member-id")
    add_metadata(p)
    p.set_defaults(handler=cmd_social_people_add)

    chat = sub.add_parser("chat")
    chat_sub = chat.add_subparsers(dest="resource", required=True)
    conversations = chat_sub.add_parser("conversations")
    conversations_sub = conversations.add_subparsers(dest="command", required=True)
    p = conversations_sub.add_parser("list")
    p.add_argument("--pinned", action="store_true")
    add_limit(p)
    p.set_defaults(handler=cmd_chat_conversations_list)
    turns = chat_sub.add_parser("turns")
    turns_sub = turns.add_subparsers(dest="command", required=True)
    p = turns_sub.add_parser("list")
    p.add_argument("--conversation-id")
    add_limit(p, default=100)
    p.set_defaults(handler=cmd_chat_turns_list)

    suggestions = sub.add_parser("suggestions")
    suggestions_sub = suggestions.add_subparsers(dest="command", required=True)
    p = suggestions_sub.add_parser("list")
    p.add_argument("--status", default="pending")
    p.add_argument("--segment", choices=SEGMENTS)
    add_limit(p)
    p.set_defaults(handler=cmd_suggestions_list)
    p = suggestions_sub.add_parser("create")
    p.add_argument("--segment", choices=SEGMENTS, required=True)
    p.add_argument("--kind", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--rationale", required=True)
    p.add_argument("--preview-json", help="JSON preview payload; defaults to {}")
    p.set_defaults(handler=cmd_suggestions_create)

    memory = sub.add_parser("memory")
    memory_sub = memory.add_subparsers(dest="resource", required=True)
    nodes = memory_sub.add_parser("nodes")
    nodes_sub = nodes.add_subparsers(dest="command", required=True)
    p = nodes_sub.add_parser("search")
    p.add_argument("--query")
    p.add_argument("--type", choices=NODE_TYPES)
    add_limit(p)
    p.set_defaults(handler=cmd_memory_nodes_search)
    p = nodes_sub.add_parser("create")
    p.add_argument("--type", choices=NODE_TYPES, required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--notes")
    p.add_argument("--needs-review", action="store_true")
    add_metadata(p)
    p.set_defaults(handler=cmd_memory_nodes_create)
    facts = memory_sub.add_parser("facts")
    facts_sub = facts.add_subparsers(dest="command", required=True)
    p = facts_sub.add_parser("list")
    p.add_argument("--subject-node-id")
    p.add_argument("--predicate")
    p.add_argument("--current", action="store_true")
    add_limit(p)
    p.set_defaults(handler=cmd_memory_facts_list)
    candidates = memory_sub.add_parser("fact-candidates")
    candidates_sub = candidates.add_subparsers(dest="command", required=True)
    p = candidates_sub.add_parser("add")
    p.add_argument("--subject-node-id")
    p.add_argument("--predicate", required=True)
    group = p.add_mutually_exclusive_group()
    group.add_argument("--object-text")
    group.add_argument("--object-json")
    p.add_argument("--object-node-id")
    p.add_argument("--confidence", type=float)
    p.add_argument("--evidence-json")
    p.add_argument("--valid-from")
    p.add_argument("--valid-to")
    p.add_argument("--reason")
    p.set_defaults(handler=cmd_memory_fact_candidate_add)

    settings = sub.add_parser("settings")
    settings_sub = settings.add_subparsers(dest="command", required=True)
    p = settings_sub.add_parser("household")
    p.set_defaults(handler=cmd_settings_household)
    p = settings_sub.add_parser("members")
    p.set_defaults(handler=cmd_settings_members)
    p = settings_sub.add_parser("connections")
    p.add_argument("--provider")
    p.add_argument("--status")
    add_limit(p)
    p.set_defaults(handler=cmd_settings_connections)
    p = settings_sub.add_parser("grants")
    p.set_defaults(handler=cmd_settings_grants)

    ops = sub.add_parser("ops")
    ops_sub = ops.add_subparsers(dest="command", required=True)
    p = ops_sub.add_parser("model-calls")
    p.add_argument("--task")
    add_limit(p, default=100)
    p.set_defaults(handler=cmd_ops_model_calls)

    tripadvisor = sub.add_parser(
        "tripadvisor",
        description=(
            "TripAdvisor Content API surface. Every result carries `web_url`; "
            "you MUST link to it when rendering a place in the chat (TOS)."
        ),
    )
    tripadvisor_sub = tripadvisor.add_subparsers(dest="command", required=True)
    p = tripadvisor_sub.add_parser("search")
    p.add_argument("--query", help="free-text search; optional when --lat-long is set")
    p.add_argument("--category", choices=TRIPADVISOR_CATEGORIES)
    p.add_argument("--lat-long", help='"lat,long" pair; triggers nearby_search')
    p.add_argument("--address")
    p.add_argument("--phone")
    p.add_argument("--language", default="en")
    p.add_argument(
        "--with-photos",
        action="store_true",
        help="fetch one representative photo URL per hit (slower)",
    )
    add_limit(p, default=5)
    p.set_defaults(handler=cmd_tripadvisor_search)
    p = tripadvisor_sub.add_parser("details")
    p.add_argument("--location-id", required=True)
    p.add_argument("--language", default="en")
    p.add_argument("--currency", default="USD")
    p.add_argument("--with-photos", action="store_true")
    p.set_defaults(handler=cmd_tripadvisor_details)
    p = tripadvisor_sub.add_parser("photos")
    p.add_argument("--location-id", required=True)
    p.add_argument("--language", default="en")
    p.add_argument("--source", help="e.g. Traveler, Management")
    add_limit(p, default=5)
    p.set_defaults(handler=cmd_tripadvisor_photos)
    p = tripadvisor_sub.add_parser("reviews")
    p.add_argument("--location-id", required=True)
    p.add_argument("--language", default="en")
    add_limit(p, default=5)
    p.set_defaults(handler=cmd_tripadvisor_reviews)

    onboarding = sub.add_parser("onboarding")
    onboarding_sub = onboarding.add_subparsers(dest="command", required=True)
    p = onboarding_sub.add_parser("record-progress")
    p.add_argument("--segment", choices=("financial", "food", "fun", "social"))
    p.add_argument("--prompt-id", action="append", default=[])
    p.add_argument("--surface-id", action="append", default=[])
    p.set_defaults(handler=cmd_onboarding_progress)

    return parser


def write_json(out: TextIO, value: Any) -> None:
    json.dump(value, out, indent=2, sort_keys=True)
    out.write("\n")


def run(
    argv: list[str] | None = None,
    *,
    env: dict[str, str] | None = None,
    client: Client | None = None,
    tripadvisor: TripAdvisorClient | None = None,
    out: TextIO = sys.stdout,
    err: TextIO = sys.stderr,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        config = EnvConfig.from_env(env or os.environ)
        ctx = CommandContext(
            config=config,
            client=client or PostgrestClient(config),
            tripadvisor=tripadvisor,
        )
        result = args.handler(args, ctx)
        write_json(out, result)
        return 0
    except HomeHubError as exc:
        print(f"homehub: {exc}", file=err)
        return 2


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
