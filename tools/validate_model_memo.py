#!/usr/bin/env python3
"""
kamuicode_model_memo.yaml スキーマ検証スクリプト

各モデルエントリが以下を満たすことをチェック:
- 必須キー: name, server_name, release_date, features
- 禁止キー: model, model_name, modelName, publisher, developer, model_type, url, link, description, summary, note
- 各値が非空文字列
- deprecated ブロック (任意) の構造:
    - deprecated.replaced_by: 必須かつ YAML 内に実在する server_name (自己参照不可)
    - deprecated.reason: 必須の非空文字列
    - 他のキーは許容しない

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
DEPRECATED_REQUIRED_KEYS = ["replaced_by", "reason"]
DEPRECATED_ALLOWED_KEYS = {"replaced_by", "reason"}


def collect_server_names(ai_models: dict) -> set[str]:
    """全エントリの server_name を集める"""
    names: set[str] = set()
    for models in ai_models.values():
        if isinstance(models, list):
            for model in models:
                if isinstance(model, dict):
                    sn = model.get("server_name")
                    if isinstance(sn, str) and sn:
                        names.add(sn)
    return names


def validate_deprecated_block(
    deprecated, label: str, own_server_name: str, all_server_names: set[str]
) -> list[str]:
    """deprecated ブロックを検証"""
    errors: list[str] = []

    if not isinstance(deprecated, dict):
        return [f"{label}: 'deprecated' must be a mapping"]

    # 必須キー
    for key in DEPRECATED_REQUIRED_KEYS:
        if key not in deprecated:
            errors.append(f"{label}: 'deprecated.{key}' is required")
            continue
        value = deprecated[key]
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{label}: 'deprecated.{key}' must be a non-empty string")

    # 想定外キー
    extra_keys = set(deprecated.keys()) - DEPRECATED_ALLOWED_KEYS
    if extra_keys:
        errors.append(
            f"{label}: 'deprecated' has unknown key(s): {sorted(extra_keys)} "
            f"(allowed: {sorted(DEPRECATED_ALLOWED_KEYS)})"
        )

    # replaced_by の参照先存在確認 + 自己参照禁止
    replaced_by = deprecated.get("replaced_by")
    if isinstance(replaced_by, str) and replaced_by.strip():
        if replaced_by == own_server_name:
            errors.append(
                f"{label}: 'deprecated.replaced_by' must not be a self-reference "
                f"('{replaced_by}')"
            )
        elif replaced_by not in all_server_names:
            errors.append(
                f"{label}: 'deprecated.replaced_by' references unknown server_name "
                f"'{replaced_by}'"
            )

    return errors


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

    all_server_names = collect_server_names(ai_models)

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

            # deprecated ブロックチェック (任意)
            if "deprecated" in model:
                own_sn = server_name if isinstance(server_name, str) else ""
                errors.extend(
                    validate_deprecated_block(
                        model["deprecated"], label_with_server, own_sn, all_server_names
                    )
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
