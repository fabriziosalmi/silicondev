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

The agent requires a model to be loaded. It communicates through the same NanoCore agent infrastructure used by the Terminal.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+S` | Save active file |
