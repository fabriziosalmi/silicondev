# Pipelines & Jobs

Source: `src/renderer/src/components/PipelinesJobs.tsx`

## Overview

Build and run sequential processing pipelines. Each pipeline chains steps that pass output to the next: LLM inference, shell commands, and text filters.

## Pipeline Definition

| Field   | Description               |
| ------- | ------------------------- |
| `id`    | UUID                      |
| `name`  | Display name              |
| `nodes` | Array of processing steps |

### Step Types

| Type        | Description                                    |
| ----------- | ---------------------------------------------- |
| `llm`       | Run input through the loaded model             |
| `tool`      | Execute a shell command (`$NODE_INPUT` env var) |
| `condition` | Match keyword, output ifTrue/ifFalse text      |

Steps run sequentially — each step's output feeds into the next as input.

## Operations

| Action  | Description                           |
| ------- | ------------------------------------- |
| Create  | Define a new pipeline with steps      |
| Edit    | Modify name, reorder, configure steps |
| Delete  | Remove a pipeline                     |
| Execute | Run the pipeline with an input string |

## Execution

`POST /api/agents/{id}/execute` with `{ input: "..." }`.

The backend runs each node in order. LLM nodes use the currently loaded model. Tool nodes run shell commands with a 30-second timeout. Results show per-step status and output.

## Storage

Pipelines are stored in `~/.silicon-studio/agents/agents.json`.

## API

| Endpoint                   | Method | Description             |
| -------------------------- | ------ | ----------------------- |
| `/api/agents/`             | GET    | List all pipelines      |
| `/api/agents/`             | POST   | Create/update pipeline  |
| `/api/agents/{id}`         | DELETE | Delete pipeline         |
| `/api/agents/{id}/execute` | POST   | Execute pipeline        |
