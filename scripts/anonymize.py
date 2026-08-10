#!/usr/bin/env python3
"""Produce an anonymized demo copy of a research epJSON file.

Replaces every zone name (which embeds real addresses and UUIDs) with a
generic sequential name across the whole document, scrubs the Building name
and the custom Site:Location fields. Surface names keep their own UUIDs —
they carry no address information.

Zones keep a synthetic ID_<uuid>_ prefix and their zone suffix, so the demo
preserves the building/zone structure the viewer groups on.

Usage: python3 scripts/anonymize.py <input.epJSON> <output.epJSON> [model-name]
"""

import json
import re
import sys
from pathlib import Path

UUID_RE = re.compile(
    r"^ID_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    model_name = sys.argv[3] if len(sys.argv) > 3 else "Demo model"

    data = json.loads(src.read_text(encoding="utf-8"))

    zones = sorted(data.get("Zone", {}).keys())

    # Group zones by their CityGML building UUID, mirroring
    # groupZonesIntoBuildings in src/core/parse.ts, so the demo keeps a
    # meaningful Building_X_{P1,Core} structure.
    by_uuid: dict[str, list[str]] = {}
    buildings: dict[str, list[str]] = {}
    for z in zones:
        m = UUID_RE.match(z)
        if m:
            by_uuid.setdefault(m.group(0), []).append(z)
        else:
            buildings[z] = [z]
    for names in by_uuid.values():
        if len(names) == 1:
            key = names[0]
        else:
            parts = [n.split("_") for n in names]
            n = min(len(p) for p in parts)
            n = next((i for i in range(n) if len({p[i] for p in parts}) > 1), n)
            key = "_".join(parts[0][:n])
        buildings[re.sub(r"_F\d+$", "", key)] = names

    def letters(i: int) -> str:
        out = ""
        while True:
            out = chr(ord("A") + i % 26) + out
            i = i // 26 - 1
            if i < 0:
                return out

    replacements: dict[str, str] = {}
    for bi, (bld, bzones) in enumerate(sorted(buildings.items())):
        # Keep a synthetic ID_<uuid>_ prefix: the viewer groups zones into
        # buildings by that UUID, so a demo without one collapses to a single
        # building and stops exercising building selection.
        new_bld = f"ID_{bi:08x}-0000-4000-8000-{bi:012x}_Building_{letters(bi)}"
        replacements[bld] = new_bld
        for z in bzones:
            if z != bld and z.startswith(bld):
                replacements[z] = new_bld + z[len(bld):]

    # Longest-first global text replacement catches every cross-reference
    # (zone_name, thermostat names, HVAC object names, …)
    text = json.dumps(data, ensure_ascii=False)
    for old in sorted(replacements, key=len, reverse=True):
        text = text.replace(json.dumps(old)[1:-1], json.dumps(replacements[old])[1:-1])
    data = json.loads(text)

    for b in data.get("Building", {}).values():
        b["name"] = model_name
    if "Site:Location" in data:
        data["Site:Location"] = {
            "Demo Location": {"city": "Anonymized", "reference_system": "local coordinates"}
        }

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")

    n_surf = len(data.get("BuildingSurface:Detailed", {}))
    print(f"{dst}: {len(zones)} zones → {len(buildings)} buildings, {n_surf} surfaces")
    leftover = [z for z in replacements.values() if "straat" in z.lower() or "laan" in z.lower()]
    residual = re.findall(r"[A-Z][a-z]+(?:straat|laan|lei|plein)", json.dumps(data))
    if leftover or residual:
        print("WARNING: possible residual street names:", set(residual) | set(leftover))


if __name__ == "__main__":
    main()
