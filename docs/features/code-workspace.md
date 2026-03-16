# Code Workspace

Source: `src/renderer/src/components/CodeWorkspace/CodeWorkspace.tsx`

## Overview

The Code Workspace provides an in-app code editor with an AI agent panel. It lets you open a project directory, browse files, edit code with syntax highlighting, and use an AI agent to make changes.

## Features

- **File Tree**: Browse and open files from a selected project directory
- **Monaco Editor**: Full-featured code editor with syntax highlighting, line numbers, and language detection
- **Diff Viewer**: Review AI-generated changes as side-by-side diffs before accepting or rejecting them
- **Agent Panel**: Chat with the AI agent to request code edits — the agent reads files, proposes changes, and applies accepted diffs
- **File Management**: Create new files, save with `Cmd+S`, and track unsaved changes

## Usage

1. Click **Select Directory** to open a project folder
2. Browse the file tree on the left and click files to open them in tabs
3. Edit files directly in the Monaco editor
4. Open the Agent Panel on the right to ask the AI to modify code
5. Review proposed diffs and accept or reject each change

## Agent Panel

The agent uses the loaded model to:
- Read file contents from the workspace
- Generate code modifications based on your instructions
- Present changes as visual diffs for review

The agent requires a model to be loaded. It runs through the NanoCore `SupervisorAgent` and `PlannerEditor` — the same infrastructure exposed by the `/api/terminal` backend endpoints.

### NanoCore Features Available in the Agent Panel

- **Diff proposals**: File edits are shown as diffs; you approve or reject before the file is written
- **Undo / Rollback**: Undo the last edit, or roll back to any checkpoint in the edit history
- **Self-healing**: Up to 3 automatic retries on tool failures before escalating to you
- **Human escalation**: When the agent is stuck, it pauses and asks for guidance
- **Mixture of Agents (MoA)**: Parallel Security, Performance, and Syntax expert sub-agents
- **Air-gapped mode**: Blocks outbound network calls in tool executions
- **Python sandbox**: Isolated subprocess for script execution
- **Context health**: Token budget and context usage indicator
- **Scout Agent**: Background monitor flags high-activity files as refactoring candidates
- **Planner mode**: Generate a multi-step plan and approve it before execution begins

## Backend API

The Code Workspace frontend communicates with two backend routers:

| Prefix | Purpose |
|--------|---------|
| `/api/workspace` | File tree (`POST /tree`), read (`POST /read`), save (`POST /save`), create (`POST /create`), rename (`POST /rename`), delete (`POST /delete`), git info (`POST /git-info`) |
| `/api/terminal` | NanoCore agent SSE stream for agent panel |

All file operations enforce path containment — paths outside the selected workspace root are rejected. macOS system paths are also blocked.

## Authentication

All backend requests include the `Authorization: Bearer <token>` header when `SILICON_AUTH_TOKEN` is set. The agent SSE stream uses `fetch` (not `EventSource`), so it can include the authorization header directly rather than needing a `?token=` query parameter.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+S` | Save active file |
