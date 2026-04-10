"""Single source of truth for dataset display metadata."""

DATASET_META: dict[str, dict] = {
    "synthea_standard":  {"name": "Synthea Standard Cohort",   "description": "Balanced baseline dataset for standard migration runs.",   "badge": "Standard",  "color": "blue"   },
    "clean_cohort":      {"name": "Clean Reference Dataset",    "description": "Clean reference data with minimal issues.",                "badge": "Clean",     "color": "emerald"},
    "high_anomaly":      {"name": "High Anomaly Dataset",       "description": "Messier source data to show error handling.",              "badge": "Stress",    "color": "red"    },
    "edge_cases":        {"name": "Edge Cases Dataset",         "description": "Boundary conditions and unusual source values.",           "badge": "Edge",      "color": "amber"  },
    "medicare_sample":   {"name": "Medicare Sample Cohort",     "description": "Production-style Medicare-shaped sample.",               "badge": "Medicare",  "color": "blue"   },
    "medicaid_complex":  {"name": "Medicaid Complex Dataset",   "description": "Complex Medicaid-shaped source records.",                 "badge": "Medicaid",  "color": "red"    },
    "tiny_clean":        {"name": "Tiny Clean Demo",            "description": "Small clean dataset for fast demos.",                     "badge": "Tiny",      "color": "emerald"},
    "tiny_anomaly":      {"name": "Tiny Anomaly Demo",          "description": "Small dataset with review-worthy fields.",               "badge": "Tiny",      "color": "amber"  },
    "tiny_edge":         {"name": "Tiny Edge Demo",             "description": "Small boundary-case dataset.",                            "badge": "Tiny",      "color": "blue"   },
}
