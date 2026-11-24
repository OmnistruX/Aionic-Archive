import React from 'react';
import {
  Activity,
  Cpu,
  Film,
  Layers,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Asset } from '../shared/types';
import { formatTimestamp } from '../shared/layers';

export type WorkspaceTab =
  | 'scanner'
  | 'moments'
  | 'evidence'
  | 'search'
  | 'providers'
  | 'governance';

interface SidebarNavProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  assets: Asset[];
  selectedAssetId: string;
  onSelectAsset: (assetId: string) => void;
  momentCount: number;
  layerCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'scanner', label: 'Multimodal Scanner', icon: Film },
  { id: 'moments', label: 'Significant Moments', icon: Sparkles },
  { id: 'evidence', label: 'Evidence Workbench', icon: Layers },
  { id: 'search', label: 'Hybrid Search', icon: Search },
  { id: 'providers', label: 'Providers & API', icon: Cpu },
  { id: 'governance', label: 'Governance & Export', icon: ShieldCheck },
];

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  onSelectTab,
  assets,
  selectedAssetId,
  onSelectAsset,
  momentCount,
  layerCount,
  mobileOpen,
  onCloseMobile,
}) => {
  const content = (
    <div className="flex h-full flex-col bg-[#0F121C] border-r border-[#1F2538] text-[#E6E9F2]">
      <div className="flex items-center justify-between px-5 py-5 border-b border-[#1F2538]">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight text-slate-50 whitespace-nowrap">
            Aionic Archive
          </div>
          <div className="text-xs text-slate-400 whitespace-nowrap mt-0.5">
            Multimodal Subsystem
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-2 text-slate-400 hover:text-slate-100 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav aria-label="Primary workspaces" className="px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const count =
            item.id === 'moments' ? momentCount : item.id === 'evidence' ? layerCount : null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                isActive
                  ? 'bg-[#1A1F31] text-white font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#151927]'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-cyan-300' : 'text-slate-500'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {count !== null && (
                <span className="font-mono text-xs tabular-nums text-slate-400 shrink-0">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-2 px-4 pt-4 border-t border-[#1F2538] flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-medium text-slate-400">Media Vault</span>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
          </span>
        </div>
        <div className="space-y-1.5">
          {assets.map((asset) => {
            const selected = asset.id === selectedAssetId;
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => {
                  onSelectAsset(asset.id);
                  onCloseMobile();
                }}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  selected
                    ? 'bg-[#171C2C] border-violet-500/50 text-slate-100'
                    : 'bg-transparent border-transparent hover:bg-[#141825] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="text-xs font-medium truncate text-slate-100">
                  {asset.originalFilename}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1 font-mono tabular-nums">
                  <span>{formatTimestamp(asset.durationSec)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{asset.dataOrigin === 'real_upload' ? 'Uploaded' : 'Fixture'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-5 py-3.5 border-t border-[#1F2538] text-[11px] text-slate-500 flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="whitespace-nowrap">SQLite local · Originals intact</span>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[256px] shrink-0 h-screen sticky top-0">
        {content}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[272px] max-w-[85vw] h-full shadow-2xl">{content}</div>
          <button
            type="button"
            aria-label="Dismiss navigation overlay"
            onClick={onCloseMobile}
            className="flex-1 bg-black/60 backdrop-blur-xs"
          />
        </div>
      )}
    </>
  );
};
