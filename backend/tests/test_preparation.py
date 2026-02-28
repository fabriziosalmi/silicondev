import pytest
import os
import json
from app.preparation.service import DataPreparationService

def test_preview_csv(temp_csv):
    service = DataPreparationService()
    preview = service.preview_csv(temp_csv, limit=2)

    assert len(preview) == 2
    assert preview[0]["instruction"] == "Translate to French"
    assert preview[0]["input"] == "Hello World"
    assert preview[0]["output"] == "Bonjour le monde"

def test_convert_csv_to_jsonl(temp_csv, temp_output_jsonl):
    service = DataPreparationService()

    result = service.convert_csv_to_jsonl(
        file_path=temp_csv,
        output_path=temp_output_jsonl,
        instruction_col="instruction",
        input_col="input",
        output_col="output"
    )

    assert result["status"] == "success"
    assert result["rows_processed"] == 3  # 4 rows minus 1 skipped (missing data row)
    assert result["rows_skipped"] == 1

    with open(temp_output_jsonl, "r") as f:
        lines = f.readlines()
        assert len(lines) == 3

        # Parse first line to check structure
        record1 = json.loads(lines[0])
        assert "instruction" in record1
        assert "input" in record1
        assert "output" in record1
        assert record1["instruction"] == "Translate to French"
        assert record1["input"] == "Hello World"
        assert record1["output"] == "Bonjour le monde"

        # Empty input test row
        record3 = json.loads(lines[2])
        assert record3["instruction"] == "Empty input test"
        assert record3["input"] == ""
        assert record3["output"] == "Output without input"
