#!/usr/bin/env python3
"""Vérifie que les chiffres, dates et siècles des récits figurent dans les notes de sources.

Garde-fou simple contre les inventions les plus fréquentes d'un LLM (dates et chiffres).
Ce n'est PAS une preuve d'exactitude : une relecture humaine reste nécessaire.

Usage : python3 pipeline/verify.py [data/places.json]
"""
import json
import re
import sys
from pathlib import Path

WORD_NUMBERS = {
    "soixante-quatorze": "74",
    "quatre-vingt-dix": "90",
    "quatre comtes": "4",
    "sept arches": "7",
    "sept étages": "7",
    "huit siècles": "800",
    "huit cents": "800",
}

NUM_RE = re.compile(r"\d+(?:[   ]\d{3})*")
ROMAN_RE = re.compile(r"\b([IVXL]+)ᵉ")


def norm_digits(text: str) -> str:
    # "4 000" -> "4000" (espaces fines ou insécables entre groupes de 3 chiffres)
    return re.sub(r"(?<=\d)[   ](?=\d{3}\b)", "", text)


def numbers(text: str) -> set[str]:
    return {norm_digits(m) for m in NUM_RE.findall(text)}


def romans(text: str) -> set[str]:
    return set(ROMAN_RE.findall(text))


def main(path: str) -> int:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    problems = 0
    for p in data["places"]:
        facts = " ".join(p["facts"])
        facts_nums = numbers(norm_digits(facts))
        facts_rom = romans(facts)
        issues = []
        if len(p["sources"]) < 3:
            issues.append(f"moins de 3 sources ({len(p['sources'])})")
        if not (41.0 < p["lat"] < 44.5 and 0.5 < p["lon"] < 2.5):
            issues.append("coordonnées hors zone")
        for field in ("express", "histoire"):
            text = p[field]
            for n in sorted(numbers(text) - facts_nums):
                issues.append(f"{field}: nombre « {n} » absent des notes de sources")
            for r in sorted(romans(text) - facts_rom):
                issues.append(f"{field}: siècle « {r}ᵉ » absent des notes de sources")
            for word, digit in WORD_NUMBERS.items():
                if word in text and digit not in facts_nums and word not in facts:
                    issues.append(f"{field}: « {word} » non étayé par les notes")
        status = "OK " if not issues else "KO "
        print(f"{status}{p['id']}")
        for i in issues:
            print(f"    - {i}")
        problems += len(issues)
    print(f"\n{len(data['places'])} lieux, {problems} point(s) à revoir.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "data/places.json"))
