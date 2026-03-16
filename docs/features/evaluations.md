# Model Evaluations

Source: `src/renderer/src/components/Evaluations.tsx`

## Overview

Run benchmarks against the currently loaded model. Each benchmark has 30 questions; results are scored and stored in `localStorage` for comparison across sessions.

## Available Benchmarks

| Benchmark | Measures | Pool |
|-----------|----------|------|
| MMLU | General knowledge (multiple choice) | 30 |
| HellaSwag | Common-sense sentence completion | 30 |
| HumanEval | Python function generation | 30 |
| TruthfulQA | Factual yes/no answers | 30 |

## Sample Count

The default is 30 questions (all). You can reduce it to 10 or 20 using the selector in the banner. Questions are sampled randomly from the full pool each run, so repeated runs with fewer samples test different subsets.

## Workflow

1. Load a model from the Models tab.
2. Optionally change the sample count in the banner (default: 30).
3. Click "Run" next to the benchmark you want to evaluate.
4. Progress is shown as each question is answered.
5. The final score (% correct) appears in the history table.

## Evaluation History

Past results are stored in `localStorage` under `silicon-studio-eval-history` and displayed in a history table with model name, date, benchmark, score, and question count. Use the "Clear" button to reset.

## Limitations

- Requires a model to be loaded in memory.
- All benchmarks are locally implemented; they are not identical to official reference implementations.
- Results are stored locally only; no server persistence.
