"""Apply the stale-source partial-collection guard to the CI working tree.

The collector already computes ALLOW_PARTIAL_FOR_RUN/LAST_COMPLETE_FOR_RUN.
This tiny compatibility patch makes the content-validation gate honor those
flags when one or more player detail records remain incomplete after bounded
rechecks. The source file is left immutable so the normal strict collector
path remains the default outside a stale recovery run.
"""

from pathlib import Path


PATH = Path("scripts/scrape_character_usage.py")
OLD = '''    expected_players = len(mids)\n    if len(players) != expected_players:\n        dump_detail_failure_summary(\n            len(mids),\n            len(players),\n            content_recheck_failures + [{"error_type": "InvalidDetailContent"}],\n        )\n        raise RuntimeError(\n            "Some requested ranked players had incomplete team or equipment data; "\n            f"refusing to publish missing player details ({len(players)} != {expected_players})."\n        )\n'''
NEW = '''    expected_players = len(mids)\n    if len(players) != expected_players:\n        missing_players = expected_players - len(players)\n        dump_detail_failure_summary(\n            len(mids),\n            len(players),\n            content_recheck_failures + [{"error_type": "InvalidDetailContent"}],\n        )\n        # Normal runs remain fail-closed. During an already-authorized stale\n        # fallback, however, the ranking is still useful and the collector\n        # must publish the verified subset instead of discarding it merely\n        # because one ranked player could not be fully hydrated.\n        if not ALLOW_PARTIAL_FOR_RUN or LAST_COMPLETE_FOR_RUN is None or missing_players <= 0:\n            raise RuntimeError(\n                "Some requested ranked players had incomplete team or equipment data; "\n                f"refusing to publish missing player details ({len(players)} != {expected_players})."\n            )\n        diagnostics["partial_missing_players"] = missing_players\n        diagnostics["partial_detail_recheck_failures"] = len(content_recheck_failures)\n'''


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    if NEW in text:
        return
    if OLD not in text:
        raise SystemExit("Expected collector content-validation gate was not found; refusing an unsafe patch.")
    PATH.write_text(text.replace(OLD, NEW, 1), encoding="utf-8")
    patched = PATH.read_text(encoding="utf-8")
    if NEW not in patched or OLD in patched:
        raise SystemExit("Partial collection runtime patch verification failed.")


if __name__ == "__main__":
    main()
