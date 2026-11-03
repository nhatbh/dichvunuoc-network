from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from .cad import read_document
from .engine import analyze
from .models import ReviewConfig
from .service import write_json


def main():
    parser = argparse.ArgumentParser(
        description="Read-only CAD inspection and deterministic GIS review. No production mutations."
    )
    parser.add_argument("files", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path, help="Reviewed CRS/layer mapping JSON")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    raw = []
    inventory = {"layers": [], "blocks": [], "files": [], "issues": []}
    for path in args.files:
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        info = {
            "id": sha[:24],
            "name": path.name,
            "sha256": sha,
            "format": path.suffix.lower().lstrip("."),
            "bytes": path.stat().st_size,
        }
        doc = read_document(info, path, args.output / "converted" / info["id"])
        raw.extend(doc["features"])
        inventory["files"].append(doc["file"])
        inventory["layers"].extend(doc["layers"])
        inventory["blocks"].extend(doc.get("blocks", []))
        inventory["issues"].extend(doc["issues"])
    config = ReviewConfig.model_validate(
        json.loads(args.config.read_text()) if args.config else {"expectedVersion": 1}
    )
    result = analyze(raw, inventory, config)
    write_json(args.output / "inventory.json", inventory)
    write_json(args.output / "source-features.json", raw)
    write_json(args.output / "review.json", result)
    write_json(args.output / "draft-assets.json", {"assets": result["drafts"]})
    write_json(args.output / "review-config.json", config.model_dump())
    print(
        json.dumps(
            {
                "state": result["state"],
                "summary": result["summary"],
                "output": str(args.output.resolve()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
