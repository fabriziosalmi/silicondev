export const API_BASE = 'http://127.0.0.1:8000'

export interface SystemStats {
    memory: {
        total: number
        available: number
        used: number
        percent: number
    }
    disk: {
        total: number
        free: number
        used: number
        percent: number
    }
    cpu: {
        percent: number
        cores: number
    }
    platform: {
        system: string
        processor: string
        release: string
    }
}

export interface PreviewRow {
    [key: string]: any
}

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
        convertCsv: async (filePath: string, outputPath: string, instructionCol: string, inputCol?: string, outputCol?: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/preparation/convert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: filePath, output_path: outputPath, instruction_col: instructionCol, input_col: inputCol, output_col: outputCol })
            });
            if (!res.ok) throw new Error('Failed to convert CSV');
            return res.json();
        },
        generateMcp: async (modelId: string, serverId: string, prompt: string, outputPath: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/preparation/generate-mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId, server_id: serverId, prompt, output_path: outputPath })
            });
            if (!res.ok) throw new Error('Failed to generate via MCP');
            return res.json();
        }
    },
    engine: {
        getModels: async (): Promise<any[]> => {
            const res = await fetch(`${API_BASE}/api/engine/models`);
            if (!res.ok) throw new Error('Failed to fetch models');
            return res.json();
        },
        downloadModel: async (modelId: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/models/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            if (!res.ok) throw new Error('Failed to start download');
            return res.json();
        },
        deleteModel: async (modelId: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/models/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            if (!res.ok) throw new Error('Failed to delete model');
            return res.json();
        },
        registerModel: async (name: string, path: string, url: string = ""): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/models/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, path, url })
            });
            if (!res.ok) throw new Error('Failed to register model');
            return res.json();
        },
        scanModels: async (path: string): Promise<any[]> => {
            const res = await fetch(`${API_BASE}/api/engine/models/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            if (!res.ok) throw new Error('Failed to scan directory');
            return res.json();
        },
        getJobStatus: async (jobId: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/jobs/${jobId}`);
            if (!res.ok) throw new Error('Failed to get job status');
            return res.json();
        },
        finetune: async (params: any): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/finetune`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            if (!res.ok) throw new Error('Failed to start fine-tuning');
            return res.json();
        },
        chatStream: async (modelId: string, messages: any[], params: any = {}): Promise<Response> => {
            const res = await fetch(`${API_BASE}/api/engine/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId, messages, ...params })
            });
            if (!res.ok) throw new Error('Failed to generate chat response');
            return res;
        },
        stopChat: async (): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/chat/stop`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to stop chat generation');
            return res.json();
        },
        exportModel: async (modelId: string, outputPath: string, qBits: number = 4): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/models/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId, output_path: outputPath, q_bits: qBits })
            });
            if (!res.ok) throw new Error('Failed to export model');
            return res.json();
        },
        loadModel: async (modelId: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/models/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });
            if (!res.ok) throw new Error('Failed to load model into memory');
            return res.json();
        },
        unloadModel: async (): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/engine/models/unload`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to unload model');
            return res.json();
        }
    },
    rag: {
        getCollections: async (): Promise<any[]> => {
            const res = await fetch(`${API_BASE}/api/rag/collections`);
            if (!res.ok) throw new Error('Failed to fetch collections');
            return res.json();
        },
        createCollection: async (name: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/rag/collections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (!res.ok) throw new Error('Failed to create collection');
            return res.json();
        },
        deleteCollection: async (id: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/rag/collections/${id}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error('Failed to delete collection');
            return res.json();
        },
        ingest: async (collectionId: string, files: string[], chunkSize: number, overlap: number): Promise<any> => {
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
        getAgents: async (): Promise<any[]> => {
            const res = await fetch(`${API_BASE}/api/agents/`);
            if (!res.ok) throw new Error('Failed to fetch agents');
            return res.json();
        },
        saveAgent: async (agent: any): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/agents/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(agent)
            });
            if (!res.ok) throw new Error('Failed to save agent');
            return res.json();
        },
        deleteAgent: async (agentId: string): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/agents/${agentId}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error('Failed to delete agent');
            return res.json();
        },
        execute: async (agentId: string, input: string): Promise<any> => {
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
        start: async (modelPath: string, host: string, port: number): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/deployment/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_path: modelPath, host, port })
            });
            if (!res.ok) throw new Error('Failed to start deployment');
            return res.json();
        },
        stop: async (): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/deployment/stop`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error('Failed to stop deployment');
            return res.json();
        },
        getStatus: async (): Promise<any> => {
            const res = await fetch(`${API_BASE}/api/deployment/status`);
            if (!res.ok) throw new Error('Failed to fetch deployment status');
            return res.json();
        },
        list: async (): Promise<any[]> => {
            const res = await fetch(`${API_BASE}/api/deployment/list`);
            if (!res.ok) throw new Error('Failed to list deployments');
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
