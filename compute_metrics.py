"""Print the API's reproducible holdout evaluation without mislabeling the saved artifact."""

import json
import sys

import app


def main() -> int:
    report = app.get_model_performance()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if not report.get("available"):
        print("Evaluation unavailable; no deployment-model metrics have been inferred.")
        return 1
    print(
        "\nImportant: these results describe reconstructed candidates evaluated on a "
        "held-out split. They do not validate the training provenance of the saved "
        "deployment artifact or establish clinical validity."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
