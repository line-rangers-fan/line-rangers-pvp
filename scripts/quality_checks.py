"""Validation helpers for the published character and equipment statistics."""

from __future__ import annotations

from collections import defaultdict


EQUIPMENT_TYPES = ("WEAPON", "ARMOR", "ACC")


def assign_competition_ranks(rows: list[dict]) -> list[dict]:
    """Assign 1, 2, 2, 4-style ranks to rows already sorted by usage."""
    previous_count: int | None = None
    current_rank = 0
    for index, row in enumerate(rows, start=1):
        count = int(row["occurrence_count"])
        if count != previous_count:
            current_rank = index
        row["rank"] = current_rank
        previous_count = count
    return rows


def equipment_rankings(records: list[dict]) -> dict[str, list[dict]]:
    """Aggregate equipment records while deduplicating players per item.

    ``records`` represents character occurrences grouped by player. A player
    may use the same character and the same item more than once, so its use
    counts toward ``occurrence_count`` every time but toward ``player_count``
    only once.
    """
    totals = {
        kind: defaultdict(
            lambda: {
                "item_code": "",
                "image": "",
                "name": "",
                "occurrence_count": 0,
                "player_count": 0,
            }
        )
        for kind in EQUIPMENT_TYPES
    }

    for record in records:
        seen = {kind: set() for kind in EQUIPMENT_TYPES}
        for item in record.get("equipment", []):
            kind = str(item.get("type", "")).upper()
            item_code = str(item.get("item_code") or item.get("id") or "").strip()
            if kind not in totals or not item_code:
                continue

            row = totals[kind][item_code]
            row["item_code"] = item_code
            row["image"] = str(item.get("image") or "")
            row["name"] = str(item.get("name") or item_code)
            row["occurrence_count"] += 1
            seen[kind].add(item_code)

        for kind, item_codes in seen.items():
            for item_code in item_codes:
                totals[kind][item_code]["player_count"] += 1

    result: dict[str, list[dict]] = {}
    for kind, values in totals.items():
        rows = list(values.values())
        rows.sort(
            key=lambda row: (
                -int(row["occurrence_count"]),
                -int(row["player_count"]),
                str(row["item_code"]),
            )
        )
        result[kind] = assign_competition_ranks(rows)
    return result


def validate_data(data: dict, previous: dict | None = None) -> bool:
    """Reject incomplete or internally inconsistent published data."""
    errors: list[str] = []
    players = int(data.get("sampled_players", 0))
    slots = int(data.get("character_slots", 0))
    characters = data.get("characters")

    if players <= 0 or not isinstance(characters, list):
        errors.append("invalid sample")
        characters = []

    if sum(int(char.get("occurrence_count", 0)) for char in characters) != slots:
        errors.append("slot total mismatch")

    unit_codes = [str(char.get("unit_code") or "") for char in characters]
    if any(not code for code in unit_codes) or len(unit_codes) != len(set(unit_codes)):
        errors.append("duplicate or missing character unit code")

    for character in characters:
        occurrence_count = int(character.get("occurrence_count", 0))
        player_count = int(character.get("player_count", 0))
        if occurrence_count < player_count or player_count > players:
            errors.append("invalid character counts")
            continue

        rankings = character.get("equipment_rankings")
        if not isinstance(rankings, dict):
            errors.append("missing equipment rankings")
            continue

        for equipment_type in EQUIPMENT_TYPES:
            category = rankings.get(equipment_type)
            if not isinstance(category, dict):
                errors.append(f"missing {equipment_type} ranking")
                continue

            category_occurrences = int(category.get("equipped_occurrence_count", 0))
            category_players = int(category.get("equipped_player_count", 0))
            items = category.get("items")
            if (
                category_occurrences < 0
                or category_occurrences > occurrence_count
                or category_players < 0
                or category_players > player_count
                or not isinstance(items, list)
            ):
                errors.append(f"invalid {equipment_type} totals")
                continue

            item_occurrences = 0
            previous_item_count: int | None = None
            previous_rank = 0
            for index, item in enumerate(items, start=1):
                item_count = int(item.get("occurrence_count", 0))
                item_players = int(item.get("player_count", 0))
                if (
                    not str(item.get("item_code") or "").strip()
                    or not str(item.get("name") or "").strip()
                    or item_count <= 0
                    or item_players <= 0
                    or item_count < item_players
                    or item_count > category_occurrences
                    or item_players > category_players
                ):
                    errors.append(f"invalid {equipment_type} item")
                    break

                rank = int(item.get("rank", 0))
                expected_rank = (
                    index if item_count != previous_item_count else previous_rank
                )
                if rank != expected_rank:
                    errors.append(f"invalid {equipment_type} rank")
                    break

                item_occurrences += item_count
                previous_item_count = item_count
                previous_rank = rank

            if item_occurrences != category_occurrences:
                errors.append(f"{equipment_type} total mismatch")

    if previous:
        for key in ("sampled_players", "character_slots"):
            old = int(previous.get(key, 0))
            new = int(data.get(key, 0))
            if old and new < old * 0.5:
                errors.append(f"{key} dropped by 50% or more")

    if errors:
        raise ValueError("; ".join(errors))
    return True
