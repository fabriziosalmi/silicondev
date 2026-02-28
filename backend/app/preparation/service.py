import pandas as pd
import json
import os
import time
from typing import List, Dict, Any, Optional
from pathlib import Path

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
            df = pd.read_csv(file_path)
            # Replace NaN with empty strings for JSON compatibility
            df = df.where(pd.notnull(df), "")
            return df.head(limit).to_dict(orient="records")
        except Exception as e:
            raise ValueError(f"Error reading CSV: {str(e)}")

    def convert_csv_to_jsonl(self,
                             file_path: str,
                             output_path: str,
                             instruction_col: str,
                             input_col: Optional[str],
                             output_col: str) -> Dict[str, Any]:
        """
        Convert CSV to JSONL format with ruthless structural validation.
        Rationale: Garbage In, Garbage Out. SOTA fine-tuning requires clean data.
        """
        if not os.path.exists(file_path):
            raise ValueError(f"File not found: {file_path}")
            
        try:
            df = pd.read_csv(file_path)
            jsonl_data = []
            skipped_rows = 0
            errors = []

            for i, row in df.iterrows():
                instruction = str(row.get(instruction_col, "")).strip()
                response = str(row.get(output_col, "")).strip()
                context = ""
                if input_col:
                    context = str(row.get(input_col, "")).strip()

                # --- RUTHLESS VALIDATION ---
                # 1. Skip if instruction or response is truly empty
                if not instruction or not response or instruction == "nan" or response == "nan":
                    skipped_rows += 1
                    errors.append(f"Row {i}: Missing instruction or response.")
                    continue

                # 2. Skip if response is too short (likely junk)
                if len(response) < 3:
                    skipped_rows += 1
                    errors.append(f"Row {i}: Response too short ({len(response)} chars).")
                    continue
                
                # SOTA Format mapping
                jsonl_data.append({
                    "instruction": instruction,
                    "input": context,
                    "output": response
                })

            # Create output directory if it doesn't exist
            output_dir = os.path.dirname(output_path)
            if output_dir:
                os.makedirs(output_dir, exist_ok=True)

            with open(output_path, 'w') as f:
                for entry in jsonl_data:
                    f.write(json.dumps(entry) + '\n')

            return {
                "status": "success",
                "rows_processed": len(jsonl_data),
                "rows_skipped": skipped_rows,
                "validation_errors": errors[:10], # Return first 10 for UI feedback
                "output_path": output_path
            }
        except Exception as e:
            raise ValueError(f"Conversion failed: {str(e)}")

    def generate_via_mcp(self, model_id: str, server_id: str, prompt: str, output_path: str) -> Dict[str, Any]:
        """
        Mock MCP generation: In a real app, this would call the MCP server,
        get context, and use the bridge model to generate JSONL rows.
        """
        # Simulate work
        time.sleep(2)
        
        # Real-world logic would happen here...
        
        mock_data = [
            {"instruction": f"Explain {server_id} concept A", "output": f"Detailed explanation based on {prompt}"},
            {"instruction": f"Mapping between {server_id} and X", "output": "Logic description..."},
            {"instruction": f"Security best practices for {server_id}", "output": "Use local vault..."},
        ]
        
        # Save to file
        with open(output_path, "w") as f:
            for row in mock_data:
                f.write(json.dumps(row) + "\n")
                
        return {
            "status": "success",
            "rows": len(mock_data),
            "data": mock_data
        }
