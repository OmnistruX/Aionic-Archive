import React, { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { Asset, DetectedEvent, ProviderCapability } from './shared/types';
import {
  AssetWorkspaceData,
  fetchAssets,
  fetchAssetWorkspace,
  fetchProviders,
} from './lib/api';
import { SidebarNav, WorkspaceTab } from './components/SidebarNav';
import { ScannerWorkspace } from './components/ScannerWorkspace';
import { MomentsWorkspace } from './components/MomentsWorkspace';
import { EvidenceWorkspace } from './components/EvidenceWorkspace';
import { SearchCompareWorkspace } from './components/SearchCompareWorkspace';
import { ProvidersContractWorkspace } from './components/ProvidersContractWorkspace';
import { GovernanceExportsWorkspace } from './components/GovernanceExportsWorkspace';

const TAB_TITLES: Record<WorkspaceTab, string> = {
  scanner: 'Multimodal Scanner',
  moments: 'Significant Moments',
  evidence: 'Evidence Workbench',
  search: 'Hybrid Search',
  providers: 'Providers & API Contract',
  governance: 'Governance & Export',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('scanner');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [workspace, setWorkspace] = useState<AssetWorkspaceData | null>(null);
  const [providers, setProviders] = useState<ProviderCapability[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [seekRequestSec, setSeekRequestSec] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    const res = await fetchProviders();
    setProviders(res.providers);
  }, []);

  const loadWorkspace = useCallback(async (assetId: string) => {
    if (!assetId) return;
    const data = await fetchAssetWorkspace(assetId);
    setWorkspace(data);
    setSelectedEventId((prev) =>
      prev && data.events.some((e) => e.id === prev) ? prev : data.events[0]?.id ?? null
    );
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assetList, providerRes] = await Promise.all([fetchAssets(), fetchProviders()]);
      setAssets(assetList);
      setProviders(providerRes.providers);
      if (assetList.length > 0) {
        const initialId = assetList[0].id;
        setSelectedAssetId(initialId);
        await loadWorkspace(initialId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Aionic Archive Intelligence backend.');
    } finally {
      setLoading(false);
    }
  }, [loadWorkspace]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const handleSelectAsset = async (assetId: string) => {
    setSelectedAssetId(assetId);
    await loadWorkspace(assetId);
  };

  const handleAssetUploaded = async (newAssetId: string) => {
    const list = await fetchAssets();
    setAssets(list);
    setSelectedAssetId(newAssetId);
    await loadWorkspace(newAssetId);
  };

  const handleWorkspaceMutated = async () => {
    if (!selectedAssetId) return;
    const [list] = await Promise.all([fetchAssets(), loadWorkspace(selectedAssetId)]);
    setAssets(list);
  };

  const handleJumpToTimestamp = (seconds: number) => {
    setSeekRequestSec(seconds);
    setActiveTab('scanner');
  };

  const handleJumpToAssetTimestamp = async (assetId: string, seconds: number) => {
    if (assetId !== selectedAssetId) {
      setSelectedAssetId(assetId);
      await loadWorkspace(assetId);
    }
    setSeekRequestSec(seconds);
    setActiveTab('scanner');
  };

  const handleInspectEvent = (evt: DetectedEvent) => {
    setSelectedEventId(evt.id);
    setActiveTab('moments');
  };

  return (
    <div className="min-h-screen flex bg-[#0B0D14] text-[#E6E9F2]">
      <SidebarNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        assets={assets}
        selectedAssetId={selectedAssetId}
        onSelectAsset={handleSelectAsset}
        momentCount={workspace?.events.length ?? 0}
        layerCount={workspace?.layers.length ?? 0}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Contextual SaaS Top Header */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center justify-between gap-4 bg-[#0B0D14]/95 backdrop-blur-xs border-b border-[#1F2538]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-slate-100 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 whitespace-nowrap shrink-0">
                Aionic Archive Intelligence
              </span>
              <span className="hidden sm:inline text-slate-600" aria-hidden="true">/</span>
              <span className="text-slate-100 font-medium truncate">
                {TAB_TITLES[activeTab]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeTab !== 'moments' ? (
              <button
                type="button"
                onClick={() => setActiveTab('moments')}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-[#171C2C] hover:bg-[#20273D] border border-[#28304A] text-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                Review Moments ({workspace?.events.length ?? 0})
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('evidence')}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-[#171C2C] hover:bg-[#20273D] border border-[#28304A] text-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                Evidence Layers ({workspace?.layers.length ?? 0})
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-8 w-64 rounded bg-[#141826]" />
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-7 h-96 rounded-xl bg-[#111521] border border-[#1F2538]" />
                <div className="xl:col-span-5 h-96 rounded-xl bg-[#111521] border border-[#1F2538]" />
              </div>
            </div>
          ) : error ? (
            <div role="alert" className="p-6 rounded-xl bg-[#1F131A] border border-rose-500/40 space-y-3">
              <h2 className="text-sm font-semibold text-rose-200">Subsystem Initialization Error</h2>
              <p className="text-xs text-rose-200/80">{error}</p>
              <button
                type="button"
                onClick={bootstrap}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white"
              >
                Retry Connection
              </button>
            </div>
          ) : !workspace ? (
            <div className="p-8 rounded-xl bg-[#111521] border border-[#22283C] text-center text-xs text-slate-400">
              No assets available in the archive vault yet.
            </div>
          ) : (
            <>
              {activeTab === 'scanner' && (
                <ScannerWorkspace
                  asset={workspace.asset}
                  keyframes={workspace.keyframes}
                  events={workspace.events}
                  transcripts={workspace.transcripts}
                  jobs={workspace.jobs}
                  providers={providers}
                  seekRequestSec={seekRequestSec}
                  onClearSeekRequest={() => setSeekRequestSec(null)}
                  onAssetUploaded={handleAssetUploaded}
                  onWorkspaceMutated={handleWorkspaceMutated}
                  onInspectEvent={handleInspectEvent}
                />
              )}
              {activeTab === 'moments' && (
                <MomentsWorkspace
                  events={workspace.events}
                  rankingConfig={workspace.rankingConfig}
                  selectedEventId={selectedEventId}
                  onSelectEventId={setSelectedEventId}
                  onJumpToTimestamp={handleJumpToTimestamp}
                  onWorkspaceMutated={handleWorkspaceMutated}
                />
              )}
              {activeTab === 'evidence' && (
                <EvidenceWorkspace
                  asset={workspace.asset}
                  layers={workspace.layers}
                  events={workspace.events}
                  revisions={workspace.revisions}
                  onJumpToTimestamp={handleJumpToTimestamp}
                  onWorkspaceMutated={handleWorkspaceMutated}
                />
              )}
              {activeTab === 'search' && (
                <SearchCompareWorkspace
                  assets={assets}
                  onJumpToAssetTimestamp={handleJumpToAssetTimestamp}
                />
              )}
              {activeTab === 'providers' && (
                <ProvidersContractWorkspace
                  providers={providers}
                  activeAssetId={workspace.asset.id}
                  onRefreshProviders={loadProviders}
                />
              )}
              {activeTab === 'governance' && (
                <GovernanceExportsWorkspace asset={workspace.asset} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
