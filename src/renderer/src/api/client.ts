export const API_BASE = 'http://127.0.0.1:8000'

// --- Shared Types ---

export interface SystemStats {
    memory: { total: number; available: number; used: number; percent: number }
    disk: { total: number; free: number; used: number; percent: number }
    cpu: { percent: number; cores: number }
    platform: { system: string; processor: string; release: string }
}

export interface PreviewRow {
    [key: string]: string | number | boolean | null
}

export interface ModelEntry {
    id: string
    name: string
    size: string
    family?: string
    architecture?: string
    context_window?: string
    quantization?: string
    url?: string
    external?: boolean
    is_custom?: boolean
    is_finetuned?: boolean
    downloaded: boolean
    downloading: boolean
    local_path: string | null
    base_model?: string
    adapter_path?: string
    params?: Record<string, unknown>
}

export interface JobStatus {
    status: 'starting' | 'training' | 'completed' | 'failed' | 'not_found'
    progress: number
    job_name?: string
    job_id?: string
    model_path?: string
    error?: string
}

export interface ConvertResult {
    status: string
    rows_processed: number
    rows_skipped: number
    validation_errors: string[]
    output_path: string
}

export interface RagCollection {
    id: string
    name: string
    chunks: number
    size: string
    lastUpdated: string
    model: string
}

export interface AgentDefinition {
    id?: string
    name: string
    nodes: Record<string, unknown>[]
    edges: Record<string, unknown>[]
    config?: Record<string, unknown>
}

export interface AgentExecutionResult {
    agent_id: string
    status: string
    execution_time: number
    steps: { node_id: string; node_name: string; status: string; timestamp: number; output: string }[]
}

export interface DeploymentStatus {
    running: boolean
    pid: number | null
    uptime_seconds: number | null
}

export interface FineTuneParams {
    model_id: string
    dataset_path: string
    epochs?: number
    learning_rate?: number
    batch_size?: number
    lora_rank?: number
    lora_alpha?: number
    max_seq_length?: number
    lora_dropout?: number
    lora_layers?: number
    job_name?: string
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

// --- API Client ---

export const apiClient = {
    API_BASE,
    monitor: {
        getStats: async (): Promise<SystemStats> => {
            const res = await fetch(`${API_BASE}/api/monitor/stats`);
            if (!res.ok) throw new Error('Failed to fetch stats');
            return res.json();
        }
    },
    preparation: {
        previewCsv: async (filePath: string, limit: number = 5): Promise<{ data: PreviewRow[] }> => {
            const res = await fetch(`${API_BASE}/api/preparation/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: filePath, limit })
            });
            if (!res.ok) throw new Error('Failed to preview CSV');
            return res.json();
        },
        convertCsv: async (filePath: string, outputPath: string, instructionCol: string, inputCol?: string, outputCol?: string): Promise<ConvertResult> => {
            const res = await fetch(`${API_BASE}/api/preparation/convert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: filePath, output_path: outputPath, instruction_col: instructionCol, input_col: inputCol, output_col: outputCol })
            });
            if (!res.ok) throw new Error('Failed to convert CSV');
            return res.json();
        },
        generateMcp: async (modelId: string, serverId: string, prompt: string, outputPath: string): Promise<never> => {
            const res = await fetch(`${API_BASE}/api/preparation/generate-mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId, server_id: serverId, prompt, output_path: outputPath })
            });
            if (!res.ok) throw new Error('MCP generation is not yet implemented');
            return res.json();
        }
    },
    engine: {
        getModels: async (): Promise<ModelEntry[]> => {
            const res = await fetch(`${API_BASE}/api/engine/models`);
            if (!res.ok) throw new Error('Failed to fetch models');
            return res.json();
        },
        downloadModel: async (modelId: string): Promise<{ status: string; model_id: string }> => {
            const res = await fetch(`${API_BASE}/api/engine/models/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            if (!res.ok) throw new Error('Failed to start download');
            return res.json();
        },
        deleteModel: async (modelId: string): Promise<{ status: string; model_id: string }> => {
            const res = await fetch(`${API_BASE}/api/engine/models/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            if (!res.ok) throw new Error('Failed to delete model');
            return res.json();
        },
        registerModel: async (name: string, path: string, url: string = ""): Promise<ModelEntry> => {
            const res = await fetch(`${API_BASE}/api/engine/models/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, path, url })
            });
            if (!res.ok) throw new Error('Failed to register model');
            return res.json();
        },
        scanModels: async (path: string): Promise<ModelEntry[]> => {
            const res = await fetch(`${API_BASE}/api/engine/models/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            if (!res.ok) throw new Error('Failed to scan directory');
            return res.json();
        },
        getJobStatus: async (jobId: string): Promise<JobStatus> => {
            const res = await fetch(`${API_BASE}/api/engine/jobs/${jobId}`);
            if (!res.ok) throw new Error('Failed to get job status');
            return res.json();
        },
        finetune: async (params: FineTuneParams): Promise<{ job_id: string; status: string; job_name: string }> => {
            const res = await fetch(`${API_BASE}/api/engine/finetune`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            if (!res.ok) throw new Error('Failed to start fine-tuning');
            return res.json();
        },
        chatStream: async (modelId: string, messages: ChatMessage[], params: Record<string, unknown> = {}): Promise<Response> => {
            const res = await fetch(`${API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId, messages, ...params })
            });
            if (!res.ok) throw new Error('Failed to generate chat response');
            return res;
        },
        stopChat: async (): Promise<{ status: string }> => {
            const res = await fetch(`${API_BASE}/api/engine/chat/stop`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to stop chat generation');
            return res.json();
        },
        exportModel: async (modelId: string, outputPath: string, qBits: number = 4): Promise<{ status: string; path: string }> => {
            const res = await fetch(`${API_BASE}/api/engine/models/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId, output_path: outputPath, q_bits: qBits })
            });
            if (!res.ok) throw new Error('Failed to export model');
            return res.json();
        },
        loadModel: async (modelId: string): Promise<{ status: string; model_id: string }> => {
            const res = await fetch(`${API_BASE}/api/engine/models/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            if (!res.ok) throw new Error('Failed to load model into memory');
            return res.json();
        },
        unloadModel: async (): Promise<{ status: string }> => {
            const res = await fetch(`${API_BASE}/api/engine/models/unload`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to unload model');
            return res.json();
        }
    },
    rag: {
        getCollections: async (): Promise<RagCollection[]> => {
            const res = await fetch(`${API_BASE}/api/rag/collections`);
            if (!res.ok) throw new Error('Failed to fetch collections');
            return res.json();
        },
        createCollection: async (name: string): Promise<RagCollection> => {
            const res = await fetch(`${API_BASE}/api/rag/collections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (!res.ok) throw new Error('Failed to create collection');
            return res.json();
        },
        deleteCollection: async (id: string): Promise<{ status: string }> => {
            const res = await fetch(`${API_BASE}/api/rag/collections/${id}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error('Failed to delete collection');
            return res.json();
        },
        ingest: async (collectionId: string, files: string[], chunkSize: number, overlap: number): Promise<RagCollection> => {
            const res = await fetch(`${API_BASE}/api/rag/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collection_id: collectionId, files, chunk_size: chunkSize, overlap })
            });
            if (!res.ok) throw new Error('Failed to ingest files');
            return res.json();
        }
    },
    agents: {
        getAgents: async (): Promise<AgentDefinition[]> => {
            const res = await fetch(`${API_BASE}/api/agents/`);
            if (!res.ok) throw new Error('Failed to fetch agents');
            return res.json();
        },
        saveAgent: async (agent: AgentDefinition): Promise<AgentDefinition> => {
            const res = await fetch(`${API_BASE}/api/agents/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(agent)
            });
            if (!res.ok) throw new Error('Failed to save agent');
            return res.json();
        },
        deleteAgent: async (agentId: string): Promise<{ status: string }> => {
            const res = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error('Failed to delete agent');
            return res.json();
        },
        execute: async (agentId: string, input: string): Promise<AgentExecutionResult> => {
            const res = await fetch(`${API_BASE}/api/agents/${agentId}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input })
            });
            if (!res.ok) throw new Error('Failed to execute agent');
            return res.json();
        }
    },
    deployment: {
        start: async (modelPath: string, host: string, port: number): Promise<{ status: string; message: string; pid: number }> => {
            const res = await fetch(`${API_BASE}/api/deployment/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_path: modelPath, host, port })
            });
            if (!res.ok) throw new Error('Failed to start deployment');
            return res.json();
        },
        stop: async (): Promise<{ status: string; message: string }> => {
            const res = await fetch(`${API_BASE}/api/deployment/stop`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to stop deployment');
            return res.json();
        },
        getStatus: async (): Promise<DeploymentStatus> => {
            const res = await fetch(`${API_BASE}/api/deployment/status`);
            if (!res.ok) throw new Error('Failed to fetch deployment status');
            return res.json();
        },
        getLogs: async (since: number = 0): Promise<{ logs: { timestamp: number; source: string; message: string }[] }> => {
            const res = await fetch(`${API_BASE}/api/deployment/logs?since=${since}`);
            if (!res.ok) throw new Error('Failed to fetch deployment logs');
            return res.json();
        }
    },
    checkHealth: async (): Promise<boolean> => {
        try {
            const res = await fetch(`${API_BASE}/health`);
            return res.ok;
        } catch {
            return false;
        }
    }
}
