# Codebase API

Source: `backend/app/api/codebase.py`

## Overview

The Codebase API provides hybrid search capabilities (BM25 + vector search) over a local codebase. It parses source files into meaningful chunks using AST for Python and line-based windows for other languages, and maintains an index for semantic code search.

## Index Directory

Index a local directory for semantic code search.

```http
POST /api/codebase/index
```

**Request:**
```json
{
  "directory": "/Users/fab/projects/my-app"
}
```

**Response:**
```json
{
  "status": "indexed",
  "directory": "/Users/fab/projects/my-app",
  "file_count": 142,
  "chunk_count": 523
}
```

## Search Codebase

Search the indexed codebase with hybrid BM25 + vector search.

```http
POST /api/codebase/search
```

**Request:**
```json
{
  "query": "authentication middleware",
  "top_k": 10
}
```

**Response:**
```json
{
  "results": [
    {
      "file_path": "src/middleware/auth.ts",
      "start_line": 15,
      "end_line": 45,
      "symbol": "authMiddleware",
      "kind": "function",
      "content": "export function authMiddleware(req, res, next) { ... }",
      "score": 0.85,
      "method": "hybrid"
    }
  ]
}
```

## Get Status

Get the current status of the codebase index.

```http
GET /api/codebase/status
```

**Response:**
```json
{
  "indexed": true,
  "directory": "/Users/fab/projects/my-app",
  "file_count": 142,
  "chunk_count": 523,
  "indexed_at": 1698765432.1,
  "has_embeddings": true
}
```

## Delete Index

Delete the current codebase index from memory and disk.

```http
DELETE /api/codebase/index
```

**Response:**
```json
{
  "status": "deleted"
}
```