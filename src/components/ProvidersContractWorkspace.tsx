import React, { useState } from 'react';
import { CheckCircle2, Code2, Play, RefreshCw, XCircle } from 'lucide-react';
import { ProviderCapability } from '../shared/types';
import { MULTIMODAL_API_CONTRACT, PROVIDER_ADAPTER_TS_INTERFACE } from '../shared/apiContract';

interface ProvidersContractWorkspaceProps {
  providers: ProviderCapability[];
  activeAssetId: string;
  onRefreshProviders: () => Promise<void>;
}

export const ProvidersContractWorkspace: React.FC<ProvidersContractWorkspaceProps> = ({
  providers,
  activeAssetId,
  onRefreshProviders,
}) => {
  const [probing, setProbing] = useState(false);
  const [liveResponse, setLiveResponse] = useState<{ endpoint: string; status: number; body: string } | null>(null);
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);

  const handleProbe = async () => {
    setProbing(true);
    try {
      await onRefreshProviders();
    } finally {
      setProbing(false);
    }
  };

  const handleLiveTest = async (endpointId: string, method: 'GET' | 'POST', rawPath: string) => {
    setTestingEndpoint(endpointId);
    const resolvedPath = rawPath.replace(':assetId', encodeURIComponent(activeAssetId));
    try {
      const init: RequestInit =
        method === 'POST'
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                endpointId === 'analysis-preflight'
                  ? { assetId: activeAssetId, mode: 'balanced', useCloudAi: false }
                  : { query: 'flicker', layer: 'all', category: 'all' }
              ),
            }
          : { method: 'GET' };
      const res = await fetch(resolvedPath, init);
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // leave plain text
      }
      setLiveResponse({
        endpoint: `${method} ${resolvedPath}`,
        status: res.status,
        body: pretty.slice(0, 4500),
      });
    } catch (err) {
      setLiveResponse({
        endpoint: `${method} ${resolvedPath}`,
        status: 0,
        body: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setTestingEndpoint(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#1F2538]">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">
            Multimodal Provider Adapters & API Contract
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Provider-independent orchestration layer with live capability detection. Unavailable models are disclosed honestly rather than simulated.
          </p>
        </div>
        <button
          type="button"
          disabled={probing}
          onClick={handleProbe}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#171C2C] hover:bg-[#20273D] border border-[#28304A] text-slate-200 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-300 ${probing ? 'animate-spin' : ''}`} />
          Re-probe Runtime Capabilities
        </button>
      </div>

      {/* Live Capability Detection Matrix */}
      <section className="rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1F2538] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Registered Provider Adapters</h2>
          <span className="font-mono text-xs tabular-nums text-slate-400">
            {providers.filter((p) => p.available).length} of {providers.length} available
          </span>
        </div>

        <div className="divide-y divide-[#1D2335]">
          {providers.map((p) => (
            <div key={p.id} className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  {p.available ? (
                    <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-slate-100">{p.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">{p.id}</span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed pl-6">{p.statusReason}</p>

                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-mono text-slate-400 pl-6">
                  <span>Status: {p.available ? 'Available' : 'Unavailable'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Consent: {p.requiresConsent ? 'Explicit opt-in required' : 'Local zero-consent'}</span>
                  <span aria-hidden="true">·</span>
                  <span>Modalities: {p.supportedModalities.join(', ')}</span>
                  {p.environmentVarRequired && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Server env: {p.environmentVarRequired}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Documented REST API Contract + Live Tester */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-7 rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1F2538]">
            <h2 className="text-sm font-semibold text-slate-100">
              Canonical Subsystem REST API Contract
            </h2>
          </div>
          <div className="divide-y divide-[#1D2335]">
            {MULTIMODAL_API_CONTRACT.map((ep) => {
              const canSafeTest =
                (ep.method === 'GET' && !ep.path.includes('export')) ||
                ep.id === 'analysis-preflight' ||
                ep.id === 'search-hybrid';
              return (
                <div key={ep.id} className="p-4 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono">
                      <span
                        className={
                          ep.method === 'GET'
                            ? 'text-cyan-300 font-semibold'
                            : ep.method === 'POST'
                              ? 'text-violet-300 font-semibold'
                              : 'text-amber-300 font-semibold'
                        }
                      >
                        {ep.method}
                      </span>
                      <span className="text-slate-100">{ep.path}</span>
                    </div>
                    {canSafeTest && (
                      <button
                        type="button"
                        disabled={testingEndpoint === ep.id}
                        onClick={() => handleLiveTest(ep.id, ep.method as 'GET' | 'POST', ep.path)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1A2033] hover:bg-[#232B42] text-cyan-300 whitespace-nowrap shrink-0"
                      >
                        <Play className="w-3 h-3" />
                        Test Live
                      </button>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed">{ep.summary}</p>
                  <p className="text-[11px] text-slate-500">
                    Governance: {ep.governanceRule}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400 truncate">
                    Response: {ep.responseShape}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Reusable TypeScript Adapter Interface & Live Response Output */}
        <div className="xl:col-span-5 space-y-5">
          {liveResponse && (
            <section className="rounded-xl bg-[#111521] border border-cyan-500/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1F2538] flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-300 truncate">{liveResponse.endpoint}</span>
                <span className="text-slate-300 shrink-0">HTTP {liveResponse.status}</span>
              </div>
              <pre className="p-4 text-[11px] text-slate-200 overflow-x-auto max-h-72 leading-relaxed">
                {liveResponse.body}
              </pre>
            </section>
          )}

          <section className="rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1F2538] flex items-center gap-2 text-xs font-semibold text-slate-100">
              <Code2 className="w-4 h-4 text-violet-300" />
              <span>Reusable TypeScript Provider Adapter Contract</span>
            </div>
            <pre className="p-4 text-[11px] text-slate-300 overflow-x-auto max-h-[540px] leading-relaxed">
              {PROVIDER_ADAPTER_TS_INTERFACE}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
};
