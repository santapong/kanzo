#!/usr/bin/env python3
"""Preview/import a reviewed local portfolio manifest into native Kanzo profiles.

No repository is cloned or scanned and no referenced file is read. Existing
brief/context fields are preserved. Organization follows the manifest unless
the explicitly supplied presentation-layer overrides change it.
"""
import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen


def read_json(path):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > 5 * 1024 * 1024:
        raise ValueError("input must be a JSON file no larger than 5 MiB")
    return json.loads(path.read_text())


def profiles_from(manifest, overrides):
    result = {}
    for project in manifest["projects"]:
        slug = project["slug"]
        override = overrides.get("projects", {}).get(slug, {})
        category = override.get("category") or project.get("project_type", {}).get("category") or "Other"
        state = project.get("activity", {}).get("state", "review")
        if state not in ("active", "inactive", "review", "alias"):
            state = "review"
        if override.get("visibility") in ("active", "inactive"):
            state = override["visibility"]
        source = project.get("path") or ""
        sources = project.get("sources", [])
        paths = [s if isinstance(s, str) else s.get("path", "") for s in sources]
        instructions = [p for p in paths if p and not p.startswith("/")]
        memories = [p for p in paths if p.startswith("/") and p.endswith(".md")]
        result[slug] = {
            "category": category,
            "visibility": state,
            "source_path": source,
            "source_revision": project.get("intake_commit") or "",
            "instructions": instructions,
            "memories": memories,
            "context_notes": "Imported metadata checked " + str(project.get("checked_date", "unknown"))
                + ". Recheck the live checkout, branch and instructions before work. "
                + project.get("source_review", ""),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("--overrides")
    parser.add_argument("--port", type=int, default=4242)
    parser.add_argument("--apply", action="store_true", help="write profiles; the default is a count-only preview")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("invalid port")
    changes = profiles_from(read_json(args.manifest), read_json(args.overrides) if args.overrides else {})
    counts = {}
    for profile in changes.values():
        counts[profile["visibility"]] = counts.get(profile["visibility"], 0) + 1
    if not args.apply:
        print(json.dumps({"mode": "preview", "profiles": len(changes), "visibility": counts}))
        return
    base = f"http://127.0.0.1:{args.port}"
    saved = 0
    for slug, patch in changes.items():
        with urlopen(f"{base}/api/projects/{slug}/profile", timeout=5) as reply:
            existing = json.load(reply)
        # Never replace a user's existing brief, source or chosen context with
        # older inventory text. Category/visibility are the explicit import.
        for key, value in patch.items():
            if key in ("category", "visibility") or not existing.get(key):
                existing[key] = value
        request = Request(f"{base}/api/projects/{slug}/profile", data=json.dumps(existing).encode(),
                          headers={"Content-Type": "application/json"}, method="PUT")
        with urlopen(request, timeout=5) as reply:
            json.load(reply)
        saved += 1
    print(json.dumps({"mode": "applied", "saved": saved, "visibility": counts}))


if __name__ == "__main__":
    main()
