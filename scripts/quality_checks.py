"""Validation and ranking helpers for character/equipment statistics."""
from collections import defaultdict

EQUIPMENT_TYPES = ("WEAPON", "ARMOR", "ACC")

def equipment_rankings(records):
    totals = {kind: defaultdict(lambda: {"equipment_id": "", "image": "", "occurrence_count": 0, "player_count": 0}) for kind in EQUIPMENT_TYPES}
    for record in records:
        seen = {kind: set() for kind in EQUIPMENT_TYPES}
        for item in record.get("equipment", []):
            kind = str(item.get("type", "")).upper()
            equipment_id = str(item.get("id", "")).strip()
            if kind not in totals or not equipment_id:
                continue
            row = totals[kind][equipment_id]
            row["equipment_id"] = equipment_id
            row["image"] = item.get("image", "")
            row["occurrence_count"] += 1
            seen[kind].add(equipment_id)
        for kind in EQUIPMENT_TYPES:
            for equipment_id in seen[kind]:
                totals[kind][equipment_id]["player_count"] += 1
    result = {}
    for kind, values in totals.items():
        rows = list(values.values())
        rows.sort(key=lambda x: (-x["occurrence_count"], -x["player_count"], x["equipment_id"]))
        for rank, row in enumerate(rows, 1):
            row["rank"] = rank
        result[kind] = rows
    return result

def validate_data(data, previous=None):
    errors = []
    players = int(data.get("sampled_players", 0))
    slots = int(data.get("character_slots", 0))
    chars = data.get("characters")
    if players <= 0 or not isinstance(chars, list): errors.append("invalid sample")
    if sum(int(c.get("occurrence_count", 0)) for c in chars or []) != slots: errors.append("slot total mismatch")
    images = [c.get("image") for c in chars or []]
    if len(images) != len(set(images)): errors.append("duplicate character image")
    if previous:
        for key in ("sampled_players", "character_slots"):
            old = int(previous.get(key, 0)); new = int(data.get(key, 0))
            if old and new < old * 0.5: errors.append(f"{key} dropped by 50% or more")
    if errors: raise ValueError("; ".join(errors))
    return True
