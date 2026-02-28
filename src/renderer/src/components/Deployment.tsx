import { useState } from 'react'
import { PageHeader } from './ui/PageHeader'
import { Card } from './ui/Card'
import { Server, Activity, Copy, Check, Globe, ShieldCheck } from 'lucide-react'
import { useGlobalState } from '../context/GlobalState'
import { apiClient } from '../api/client'
import { useEffect } from 'react'

export function Deployment() {
    const { activeModel } = useGlobalState()
    const [serverRunning, setServerRunning] = useState(false)
    const [host, setHost] = useState('127.0.0.1')
    const [port, setPort] = useState('8000')
    const [apiKey, setApiKey] = useState('sk-silicon-studio-local')
    const [errorMsg, setErrorMsg] = useState('')
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const [throughput, setThroughput] = useState(0) // tokens/s
    const [requests, setRequests] = useState(0) // total reqs

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await apiClient.deployment.getStatus() as any;
                setServerRunning(status.running);
                if (status.running) {
                    setThroughput(status.throughput || 0);
                    setRequests(status.requests || 0);
                } else {
                    setThroughput(0);
                }
            } catch (e) {
                console.error("Failed to check server status", e);
            }
        };
        checkStatus();
        const interval = setInterval(checkStatus, 3000);
        return () => clearInterval(interval);
    }, []);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    const toggleServer = async () => {
        setErrorMsg('');
        if (serverRunning) {
            setLoading(true);
            try {
                await apiClient.deployment.stop();
                setServerRunning(false);
            } catch (e: any) {
                setErrorMsg(e.message);
            } finally {
                setLoading(false);
            }
        } else {
            if (!activeModel) {
                setErrorMsg("No active model is loaded in memory. Please select a model in the Models tab first.");
                return;
            }
            if (!activeModel.path) {
                setErrorMsg("Active model does not have a valid local path.");
                return;
            }

            setLoading(true);
            try {
                await apiClient.deployment.start(activeModel.path, host, parseInt(port));
                setServerRunning(true);
            } catch (e: any) {
                setErrorMsg(e.message);
            } finally {
                setLoading(false);
            }
        }
    }

    return (
        <div className="h-full flex flex-col text-white overflow-hidden pb-4">
            <PageHeader
                title="Deployment Hub"
                description="Expose your loaded local models as an OpenAI-compatible API server on your network."
                badge="BETA"
            />

            <div className="flex-1 flex gap-6 overflow-hidden min-h-0">

                {/* Configuration Sidebar */}
                <div className="w-[400px] flex flex-col gap-6 overflow-y-auto no-scrollbar pb-8">

                    <Card className="p-0 overflow-hidden flex flex-col border border-white/10 shadow-xl bg-[#18181B]">
                        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${serverRunning ? 'bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
                                <h3 className="font-bold">Server Status</h3>
                            </div>
                            <span className={`text-xs font-bold px-2 py-1 rounded border uppercase tracking-wider ${serverRunning ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                {serverRunning ? 'RUNNING' : 'STOPPED'}
                            </span>
                        </div>

                        <div className="p-6 space-y-6">

                            {errorMsg && (
                                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-xs">
                                    {errorMsg}
                                </div>
                            )}

                            <button
                                onClick={toggleServer}
                                disabled={loading}
                                className={`w-full py-3.5 px-6 rounded-xl font-bold transition-all duration-300 flex items-center justify-center gap-3 shadow-lg disabled:opacity-50 ${serverRunning
                                    ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30'
                                    : 'bg-gradient-to-b from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-white border border-green-400/20 shadow-green-500/25 drop-shadow-md'
                                    }`}
                            >
                                {loading ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <Server className="w-5 h-5" />
                                )}
                                {serverRunning ? 'Stop API Server' : 'Start API Server'}
                            </button>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                    <Globe className="w-3.5 h-3.5" /> Bind Address
                                </label>
                                <select value={host} onChange={(e) => setHost(e.target.value)} disabled={serverRunning} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[13px] text-gray-300 outline-none focus:border-blue-500 disabled:opacity-50 appearance-none shadow-inner">
                                    <option value="127.0.0.1">localhost (127.0.0.1) - Secure</option>
                                    <option value="0.0.0.0">0.0.0.0 - Expose to Network</option>
                                </select>
                            </div>

                            <div className="space-y-4 pt-4 border-t border-white/5">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-black/40 border border-white/5 rounded-xl p-4 text-center">
                                        <div className="text-[10px] text-gray-500 font-bold uppercase mb-1">Throughput</div>
                                        <div className="text-xl font-mono text-blue-400">{throughput.toFixed(1)} <span className="text-[10px] text-gray-600">t/s</span></div>
                                    </div>
                                    <div className="bg-black/40 border border-white/5 rounded-xl p-4 text-center">
                                        <div className="text-[10px] text-gray-500 font-bold uppercase mb-1">Total Reqs</div>
                                        <div className="text-xl font-mono text-purple-400">{requests}</div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                        Port Number
                                    </label>
                                    <input
                                        type="number"
                                        disabled={serverRunning}
                                        value={port}
                                        onChange={(e) => setPort(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[13px] text-gray-300 outline-none focus:border-blue-500 disabled:opacity-50 font-mono shadow-inner"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center justify-between">
                                        <div className="flex items-center gap-2">API Key (Auth)</div>
                                    </label>
                                    <input
                                        type="text"
                                        disabled={serverRunning}
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[13px] text-gray-300 outline-none focus:border-blue-500 disabled:opacity-50 font-mono shadow-inner"
                                    />
                                    <p className="text-[10px] text-yellow-500/70 leading-relaxed">Client-side only. The backend does not enforce this key.</p>
                                </div>
                            </div>
                        </div>
                    </Card>

                    <Card className="p-5 border border-white/10 bg-gradient-to-br from-blue-900/20 to-purple-900/20">
                        <div className="flex items-start gap-3">
                            <ShieldCheck className="w-6 h-6 text-blue-400 shrink-0" />
                            <div>
                                <h4 className="text-sm font-bold text-blue-100 mb-1">OpenAI Compatible</h4>
                                <p className="text-xs text-blue-200/70 leading-relaxed">
                                    Silicon Studio exposes a drop-in replacement API for standard OpenAI SDKs (Python, Node.js). Point your remote apps to your IP address to use your local MLX instances for free.
                                </p>
                            </div>
                        </div>
                    </Card>

                </div>

                {/* Integration Examples Area */}
                <div className="flex-1 flex flex-col bg-black/20 border border-white/10 rounded-xl overflow-hidden relative">
                    <div className="p-5 border-b border-white/5 bg-white/[0.02] flex items-center gap-2 sticky top-0 backdrop-blur-md z-10">
                        <Activity className="w-5 h-5 text-gray-400" />
                        <h3 className="font-semibold">Integration Examples</h3>
                    </div>

                    <div className="p-6 overflow-y-auto space-y-6">

                        {/* Notice Banner */}
                        <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 p-4 rounded-lg text-sm flex items-start gap-3">
                            <span className="text-xl leading-none">⚠️</span>
                            <div>
                                <strong className="block mb-1">Note on Model IDs</strong>
                                <p className="text-yellow-500/80">When querying this API, the `model` parameter is ignored. The API will always route requests to the model currently loaded in Silicon Studio's Active Memory ({activeModel ? activeModel.name : 'None'}).</p>
                            </div>
                        </div>

                        {/* cURL Code Snippet */}
                        <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40 shadow-inner">
                            <div className="bg-[#18181B]/80 px-4 py-3 border-b border-white/10 flex justify-between items-center backdrop-blur-md">
                                <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">cURL Example</span>
                                <button onClick={() => handleCopy(`curl http://127.0.0.1:${port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "local-model",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'`)} className="text-gray-500 hover:text-white transition-colors">
                                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                                </button>
                            </div>
                            <pre className="p-4 text-sm font-mono text-blue-300 overflow-x-auto">
                                {`curl http://127.0.0.1:${port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "local-model",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'`}
                            </pre>
                        </div>

                        {/* Python Code Snippet */}
                        <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40 shadow-inner">
                            <div className="bg-[#18181B]/80 px-4 py-3 border-b border-white/10 flex justify-between items-center backdrop-blur-md">
                                <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">Python (OpenAI SDK)</span>
                            </div>
                            <pre className="p-4 text-sm font-mono overflow-x-auto text-orange-200">
                                {`from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:${port}/v1",
    api_key="${apiKey}"
)

response = client.chat.completions.create(
    model="local-model",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Write a haiku about local AI."}
    ]
)

print(response.choices[0].message.content)`}
                            </pre>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    )
}
