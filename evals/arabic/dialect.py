"""Dialect ID for Aiyaz evals. stdin {"texts": [...]}, stdout {"results": [...]}.

Latin-script words (English tech terms) are removed before classifying, so
mixed replies are judged on their Arabic only.
"""
import json
import os
import re
import sys
from pathlib import Path

# The model lives inside the project's ignored venv, not in the home folder.
os.environ.setdefault("CAMELTOOLS_DATA", str(Path(__file__).parent / ".venv" / "camel_data"))

from camel_tools.dialectid import DialectIdentifier  # noqa: E402

LATIN = re.compile(r"[A-Za-z][A-Za-z0-9_\-]*")


def main() -> None:
    payload = json.load(sys.stdin)
    did = DialectIdentifier.pretrained()
    texts = [LATIN.sub(" ", t).strip() for t in payload["texts"]]
    preds = did.predict(texts)
    results = [
        {"text": orig, "label": p.top, "score": float(p.scores[p.top])}
        for orig, p in zip(payload["texts"], preds)
    ]
    json.dump({"results": results}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
