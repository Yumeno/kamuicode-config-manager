#!/usr/bin/env python3
"""
kamuicode_model_memo.yaml スキーマ検証スクリプト

各モデルエントリが以下を満たすことをチェック:
- 必須キー: name, server_name, release_date, features
- 禁止キー: model, model_name, modelName, publisher, developer, model_type, url, link, description, summary, note
- 各値が非空文字列

CI で実行され、違反があれば exit 1 で失敗。
"""

import sys
from pathlib import Path

import yaml

REQUIRED_KEYS = ["name", "server_name", "release_date", "features"]
FORBIDDEN_KEYS = [
    "model",
    "model_name",
    "modelName",
    "publisher",
    "developer",
    "model_type",
    "url",
    "link",
    "description",
    "summary",
    "note",
]


def validate(yaml_path: Path) -> list[str]:
    """YAMLを検証し、エラーメッセージのリストを返す。空リストなら成功。"""
    errors: list[str] = []

    if not yaml_path.exists():
        return [f"File not found: {yaml_path}"]

    try:
        with yaml_path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except yaml.YAMLError as e:
        return [f"YAML parse error: {e}"]

    if not isinstance(data, dict):
        return ["Root must be a mapping"]

    ai_models = data.get("ai_models")
    if not isinstance(ai_models, dict):
        return ["'ai_models' key missing or not a mapping"]

    for category, models in ai_models.items():
        if not isinstance(models, list):
            errors.append(f"Category '{category}': value must be a list")
            continue

        for idx, model in enumerate(models):
            if not isinstance(model, dict):
                errors.append(f"Category '{category}' [#{idx}]: entry must be a mapping")
                continue

            label = f"Category '{category}' [#{idx}]"
            server_name = model.get("server_name", "<no server_name>")
            label_with_server = f"{label} server_name='{server_name}'"

            # 必須キーチェック
            for key in REQUIRED_KEYS:
                if key not in model:
                    errors.append(f"{label_with_server}: missing required key '{key}'")
                else:
                    value = model[key]
                    if value is None or (isinstance(value, str) and not value.strip()):
                        errors.append(f"{label_with_server}: '{key}' is empty")
                    elif not isinstance(value, str):
                        errors.append(
                            f"{label_with_server}: '{key}' must be a string (got {type(value).__name__})"
                        )

            # 禁止キーチェック
            for key in FORBIDDEN_KEYS:
                if key in model:
                    errors.append(
                        f"{label_with_server}: forbidden key '{key}' found "
                        f"(use 'features' to embed such info instead)"
                    )

    return errors


def main() -> int:
    repo_root = Path(__file__).parent.parent
    yaml_path = repo_root / "kamuicode_model_memo.yaml"

    if len(sys.argv) > 1:
        yaml_path = Path(sys.argv[1])

    print(f"Validating: {yaml_path}")
    errors = validate(yaml_path)

    if errors:
        print(f"\n[FAIL] Validation FAILED: {len(errors)} error(s)\n")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("\n[OK] Validation PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
