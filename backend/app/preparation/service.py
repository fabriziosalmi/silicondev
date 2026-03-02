import pandas as pd
import json
import os
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# Encoding fallback chain: try each in order until one works
_ENCODING_CHAIN = ["utf-8", "utf-8-sig", "cp1252", "latin-1"]
# Files larger than this are read in chunks to avoid OOM
_LARGE_CSV_THRESHOLD = 100 * 1024 * 1024  # 100 MB
_CSV_CHUNK_SIZE = 10_000  # rows per chunk


def _detect_encoding(file_path: str) -> str:
    """Detect a working encoding for the file from the fallback chain."""
    for enc in _ENCODING_CHAIN:
        try:
            with open(file_path, encoding=enc) as f:
                f.read(4096)  # test first 4KB
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"  # ultimate fallback


def _read_csv_chunked(file_path: str, chunksize: int = _CSV_CHUNK_SIZE, **kwargs):
    """Yield DataFrames in chunks for large CSV files."""
    enc = _detect_encoding(file_path)
    for chunk in pd.read_csv(
        file_path, encoding=enc, chunksize=chunksize,
        keep_default_na=False, na_values=[], **kwargs
    ):
        yield chunk


def _read_csv_safe(file_path: str, **kwargs) -> pd.DataFrame:
    """Read CSV with encoding fallback chain. Tries UTF-8, then UTF-8-sig, CP1252, Latin-1."""
    last_err = None
    for enc in _ENCODING_CHAIN:
        try:
            return pd.read_csv(file_path, encoding=enc, **kwargs)
        except UnicodeDecodeError as e:
            last_err = e
            continue
        except pd.errors.ParserError as e:
            raise ValueError(
                f"CSV parsing error (encoding={enc}): {e}. "
                f"Check for unmatched quotes or malformed rows."
            )
    raise ValueError(f"Cannot decode file — tried {', '.join(_ENCODING_CHAIN)}: {last_err}")


class DataPreparationService:
    def __init__(self):
        pass

    def preview_csv(self, file_path: str, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Preview the first N rows of a CSV file.
        """
        if not os.path.exists(file_path):
            raise ValueError(f"File not found: {file_path}")

        try:
            df = _read_csv_safe(file_path, nrows=limit)
            # Replace NaN with empty strings for JSON compatibility
            df = df.where(pd.notnull(df), "")
            return df.head(limit).to_dict(orient="records")
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"Error reading CSV: {str(e)}")

    def _process_csv_rows(
        self,
        df: pd.DataFrame,
        instruction_col: str,
        input_col: Optional[str],
        output_col: str,
    ) -> tuple[List[Dict[str, Any]], int, List[str]]:
        """Process a DataFrame into JSONL records. Returns (records, skipped, errors)."""
        records = []
        skipped = 0
        errors = []
        for i, row in df.iterrows():
            instruction = str(row.get(instruction_col, "")).strip()
            response = str(row.get(output_col, "")).strip()
            context = ""
            if input_col:
                context = str(row.get(input_col, "")).strip()

            if not instruction or not response:
                skipped += 1
                if len(errors) < 10:
                    errors.append(f"Row {i}: Missing instruction or response.")
                continue

            if len(response) < 3:
                skipped += 1
                if len(errors) < 10:
                    errors.append(f"Row {i}: Response too short ({len(response)} chars).")
                continue

            records.append({
                "instruction": instruction,
                "input": context,
                "output": response
            })
        return records, skipped, errors

    def convert_csv_to_jsonl(self,
                             file_path: str,
                             output_path: str,
                             instruction_col: str,
                             input_col: Optional[str],
                             output_col: str) -> Dict[str, Any]:
        """
        Convert CSV to JSONL format with structural validation.
        Skips rows with empty or too-short responses.
        Large files (>100 MB) are processed in chunks to avoid OOM.
        """
        if not os.path.exists(file_path):
            raise ValueError(f"File not found: {file_path}")

        try:
            # Create output directory if it doesn't exist
            output_dir = os.path.dirname(output_path)
            if output_dir:
                os.makedirs(output_dir, exist_ok=True)

            file_size = os.path.getsize(file_path)
            total_processed = 0
            total_skipped = 0
            all_errors: List[str] = []

            if file_size > _LARGE_CSV_THRESHOLD:
                # Chunked processing for large files
                logger.info(f"Large CSV ({file_size // (1024*1024)} MB), processing in chunks")
                with open(output_path, 'w') as out_f:
                    for chunk_df in _read_csv_chunked(file_path, chunksize=_CSV_CHUNK_SIZE):
                        records, skipped, errors = self._process_csv_rows(
                            chunk_df, instruction_col, input_col, output_col
                        )
                        for entry in records:
                            out_f.write(json.dumps(entry) + '\n')
                        total_processed += len(records)
                        total_skipped += skipped
                        if len(all_errors) < 10:
                            all_errors.extend(errors[:10 - len(all_errors)])
            else:
                # Small file: load entirely
                df = _read_csv_safe(file_path, keep_default_na=False, na_values=[])
                records, total_skipped, all_errors = self._process_csv_rows(
                    df, instruction_col, input_col, output_col
                )
                total_processed = len(records)
                with open(output_path, 'w') as f:
                    for entry in records:
                        f.write(json.dumps(entry) + '\n')

            return {
                "status": "success",
                "rows_processed": total_processed,
                "rows_skipped": total_skipped,
                "validation_errors": all_errors[:10],
                "output_path": output_path
            }
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"Conversion failed: {str(e)}")

