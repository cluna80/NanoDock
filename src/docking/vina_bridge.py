#!/usr/bin/env python3
"""
vina_bridge.py — thin shim that wraps the pre-existing drug_discovery pipeline.

This is the ONLY Python file in the NanoDock repo. All heavy lifting
(AutoDock Vina, ADMET profiling, ChEMBL queries) lives in the pre-existing
open-source drug_discovery repo, which this repo treats as a dependency.

Usage:
    echo '{"smiles": "CCO", "target": "EGFR"}' | python vina_bridge.py

Output (stdout, JSON):
    {"smiles": "CCO", "target": "EGFR", "affinity_kcal_mol": -7.3, "runtime_s": 12.4}

Exits non-zero on error with error message on stderr.
"""
from __future__ import annotations
import json
import os
import sys
import time
import random


def dock(smiles: str, target: str) -> dict:
    """
    Dispatch a docking run to the real FBDD pipeline if present,
    otherwise fall back to a deterministic mock for smoke tests.
    """
    drug_discovery_path = os.environ.get("DRUG_DISCOVERY_PATH", "")
    if drug_discovery_path and os.path.isdir(drug_discovery_path):
        sys.path.insert(0, drug_discovery_path)
        try:
            # Expected to exist in boss's existing repo.
            # Adapt this import to match the actual entry point of drug_discovery.py
            from drug_discovery import run_single_dock  # type: ignore
            t0 = time.time()
            result = run_single_dock(smiles=smiles, target=target)
            return {
                "smiles": smiles,
                "target": target,
                "affinity_kcal_mol": float(result["affinity"]),
                "pose_pdb": result.get("pose_pdb"),
                "runtime_s": round(time.time() - t0, 2),
                "backend": "autodock-vina",
            }
        except ImportError:
            pass  # Fall through to mock

    # Mock path — keeps the demo runnable even before DRUG_DISCOVERY_PATH is wired up.
    # Deterministic per-SMILES so repeated demos give consistent results.
    rng = random.Random(hash(smiles + target) & 0xFFFFFFFF)
    time.sleep(0.1)  # simulate a little work
    return {
        "smiles": smiles,
        "target": target,
        "affinity_kcal_mol": round(-6.0 - rng.random() * 4.0, 2),
        "pose_pdb": None,
        "runtime_s": 0.1,
        "backend": "mock",
    }


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        smiles = payload["smiles"]
        target = payload.get("target", "EGFR")
    except Exception as e:
        print(f"bad input: {e}", file=sys.stderr)
        return 2

    try:
        result = dock(smiles, target)
    except Exception as e:
        print(f"dock failed: {e}", file=sys.stderr)
        return 1

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
