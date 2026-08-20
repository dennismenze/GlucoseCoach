#!/usr/bin/env python3
"""One-shot source cleanup: remove obsolete JSON exchange controls and handlers."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, value: str) -> None:
    (ROOT / relative).write_text(value, encoding="utf-8")


def replace_once(relative: str, old: str, new: str) -> None:
    text = read(relative)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{relative}: expected exactly one literal match, found {count}: {old[:80]!r}")
    write(relative, text.replace(old, new, 1))


def regex_once(relative: str, pattern: str, replacement: str) -> None:
    text = read(relative)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise SystemExit(f"{relative}: expected exactly one regex match, found {count}: {pattern}")
    write(relative, updated)


def clean_index() -> None:
    replace_once(
        "docs/index.html",
        "Einträge werden lokal unter derselben Website-Adresse gespeichert. Andere Browser und Geräte sehen sie nicht. Für einen Gerätewechsel kann eine Gesamtsicherung exportiert und wieder importiert werden.",
        "Einträge werden lokal unter derselben Website-Adresse gespeichert. Andere Browser und Geräte sehen sie nicht. Für einen Gerätewechsel kann die vollständige CSV exportiert und wieder importiert werden.",
    )
    replace_once(
        "docs/index.html",
        "              <button class=\"secondary\" type=\"button\" id=\"export-diary\">Tagebuch-JSON exportieren</button>\n"
        "              <label class=\"file-button\">Tagebuch-JSON importieren<input id=\"import-diary\" type=\"file\" accept=\"application/json\" hidden></label>\n",
        "",
    )
    replace_once(
        "docs/index.html",
        "            <button class=\"secondary\" type=\"button\" id=\"export-all\">Gesamtsicherung exportieren</button>\n"
        "            <label class=\"file-button\">Gesamtsicherung importieren<input id=\"import-all\" type=\"file\" accept=\"application/json\" hidden></label>\n",
        "            <button class=\"secondary\" type=\"button\" id=\"export-all\">Vollständige CSV herunterladen</button>\n"
        "            <label id=\"import-complete-csv-label\" class=\"file-button\">Vollständige CSV importieren<input id=\"import-complete-csv\" type=\"file\" accept=\".csv,text/csv\" hidden></label>\n",
    )


def clean_core() -> None:
    replace_once(
        "docs/app-v3-core.js",
        "const GC_BACKUP_SCHEMA='glucosecoach-backup-v3';\n",
        "",
    )
    regex_once(
        "docs/app-v3-core.js",
        r"function gcDownload\(name,data\)\{.*?\}\nfunction gcBind",
        "function gcBind",
    )
    regex_once(
        "docs/app-v3-core.js",
        r"document\.querySelector\('#export-diary'\)\.onclick=.*?;const files=",
        "const files=",
    )
    regex_once(
        "docs/app-v3-core.js",
        r";document\.querySelector\('#export-all'\)\.onclick=.*?e\.target\.value=''\}(?=\})",
        "",
    )


def clean_importers() -> None:
    regex_once(
        "docs/app-importers.js",
        r"\n    const backupInput = document\.querySelector\('#import-all'\);\n"
        r"    if \(backupInput\) \{.*?\n    \}\n\n    if \(previousLoad\)",
        "\n\n    if (previousLoad)",
    )
    regex_once(
        "docs/app-importers-context.js",
        r"\n    const backupInput = document\.querySelector\('#import-all'\);\n"
        r"    if \(backupInput\) \{.*?\n    \}\n\n    const clearButton",
        "\n\n    const clearButton",
    )


def clean_loader_and_export_ui() -> None:
    regex_once(
        "docs/app-v3.js",
        r"\n  const cleanupStyle = document\.createElement\('style'\);.*?"
        r"document\.head\.appendChild\(cleanupStyle\);\n",
        "",
    )
    regex_once(
        "docs/app-export-ui.js",
        r"\n  function removeControl\(id\) \{.*?\n  \}\n\n"
        r"  function removeLegacyJsonControls\(\) \{.*?\n  \}\n",
        "\n",
    )
    replace_once(
        "docs/app-export-ui.js",
        "    removeLegacyJsonControls();\n",
        "",
    )


def verify() -> None:
    files = [
        "docs/index.html",
        "docs/app-v3-core.js",
        "docs/app-importers.js",
        "docs/app-importers-context.js",
        "docs/app-v3.js",
        "docs/app-export-ui.js",
    ]
    forbidden = [
        "export-diary",
        "import-diary",
        "import-all",
        "export-all-json",
        "Tagebuch-JSON",
        "glucosecoach-tagebuch.json",
        "glucosecoach-gesamtsicherung.json",
        "GC_BACKUP_SCHEMA",
        "removeLegacyJsonControls",
        "legacy-json-control-hider",
    ]
    text = "\n".join(read(path) for path in files)
    remnants = [value for value in forbidden if value in text]
    if remnants:
        raise SystemExit(f"Legacy JSON exchange remnants remain: {remnants}")

    index = read("docs/index.html")
    if "JSON" in index or "application/json" in index:
        raise SystemExit("docs/index.html still exposes JSON")
    for required in (
        "Vollständige CSV herunterladen",
        "Vollständige CSV importieren",
        'id="import-complete-csv"',
    ):
        if required not in index:
            raise SystemExit(f"docs/index.html is missing {required!r}")


def main() -> None:
    clean_index()
    clean_core()
    clean_importers()
    clean_loader_and_export_ui()
    verify()
    print("Removed obsolete JSON exchange UI and handlers from static sources")


if __name__ == "__main__":
    main()
