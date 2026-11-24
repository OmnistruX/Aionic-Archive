import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, Eye, FileJson, ShieldCheck } from 'lucide-react';
import { Asset, AuditRecord, ModelRun, ReleaseManifest, RevisionEntry } from '../shared/types';
import {
  fetchExportPreview,
  fetchGovernanceAudit,
  fetchReleaseManifest,
  verifyAssetIntegrity,
} from '../lib/api';

interface GovernanceExportsWorkspaceProps {
  asset: Asset;
}

const EXPORT_FORMATS: Array<{
  format: 'json' | 'csv' | 'md' | 'srt' | 'vtt';
  label: string;
  description: string;
}> = [
  {
    format: 'json',
    label: 'JSON Evidence Package',
    description: 'Full provenance bundle separating Layer E, A, R, S, F + SHA-256 + model runs.',
  },
  {
    format: 'csv',
    label: 'CSV Event Register',
    description: 'Tabular significant-moment register with prioritisation scores & selection rationales.',
  },
  {
    format: 'md',
    label: 'Markdown Report',
    description: 'Human-readable evidence-linked narrative & epistemic summary document.',
  },
  {
    format: 'srt',
    label: 'SRT Subtitles',
    description: 'SubRip timestamped transcript export.',
  },
  {
    format: 'vtt',
    label: 'WebVTT Subtitles',
    description: 'Web Video Text Tracks subtitle export.',
  },
];

export const GovernanceExportsWorkspace: React.FC<GovernanceExportsWorkspaceProps> = ({ asset }) => {
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [modelRuns, setModelRuns] = useState<ModelRun[]>([]);
  const [revisions, setRevisions] = useState<RevisionEntry[]>([]);
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<{
    verifiedIntact: boolean;
    measuredSha256: string;
    checkedAt: string;
  } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ filename: string; content: string } | null>(null);

  const loadGovernance = async () => {
    const [data, releaseManifest] = await Promise.all([fetchGovernanceAudit(), fetchReleaseManifest()]);
    setAudits(data.audits);
    setModelRuns(data.modelRuns);
    setRevisions(data.revisions);
    setManifest(releaseManifest);
  };

  useEffect(() => {
    loadGovernance().catch(() => {});
  }, [asset.id]);

  const handleVerifyHash = async () => {
    setVerifying(true);
    try {
      const res = await verifyAssetIntegrity(asset.id);
      setIntegrityResult({
        verifiedIntact: res.verifiedIntact,
        measuredSha256: res.measuredSha256,
        checkedAt: res.checkedAt,
      });
      await loadGovernance();
    } finally {
      setVerifying(false);
    }
  };

  const handlePreviewExport = async (format: 'json' | 'csv' | 'md' | 'srt' | 'vtt') => {
    const res = await fetchExportPreview(asset.id, format);
    setPreviewDoc({ filename: res.filename, content: res.content });
    await loadGovernance();
  };

  const handleDownloadExport = (format: 'json' | 'csv' | 'md' | 'srt' | 'vtt') => {
    const url = `/api/assets/${encodeURIComponent(asset.id)}/export?format=${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
      loadGovernance().catch(() => {});
    }, 400);
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-[#1F2538]">
        <h1 className="text-xl font-semibold text-slate-50">
          Governance, Provenance Audit & Evidence-Linked Exports
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Verify cryptographic SHA-256 integrity of original vault media, inspect AI model run provenance, and export evidence-linked registers.
        </p>
      </div>

      {/* Release Manifest & Convergence Evidence */}
      {manifest && (
        <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Release Manifest & Gemini Contract Evidence
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                Release {manifest.releaseVersion} · Schema v{manifest.schemaVersion} · {manifest.sprintId} · Node {manifest.runtime.nodeVersion} ({manifest.runtime.platform}/{manifest.runtime.arch})
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setPreviewDoc({
                    filename: `aai_release_manifest_${manifest.releaseVersion}.json`,
                    content: JSON.stringify(manifest, null, 2),
                  })
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[#171C2C] hover:bg-[#20273D] text-slate-200 whitespace-nowrap"
              >
                <FileJson className="w-3.5 h-3.5" />
                Preview Manifest
              </button>
              <a
                href="/api/governance/release-manifest?download=1"
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download Manifest .json
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-[#0B0E17] border border-[#1E2436]">
              <div className="text-[11px] text-slate-500">Gemini Multimodal</div>
              <div className="font-mono text-slate-100 mt-0.5">{manifest.geminiContract.multimodalModel}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {manifest.geminiContract.cloudProcessingApproved
                  ? `SDK ${manifest.geminiContract.sdk} · Approved`
                  : 'Disabled pending approval'}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#0B0E17] border border-[#1E2436]">
              <div className="text-[11px] text-slate-500">Gemini Speech ASR</div>
              <div className="font-mono text-slate-100 mt-0.5">{manifest.geminiContract.transcriptionModel}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {manifest.geminiContract.cloudProcessingApproved
                  ? manifest.geminiContract.apiKeyConfigured
                    ? 'Cloud Gate Enabled'
                    : 'Key Unconfigured'
                  : 'Cloud Gate Locked (Local Only)'}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#0B0E17] border border-[#1E2436]">
              <div className="text-[11px] text-slate-500">Local Media Engine</div>
              <div className="font-mono text-cyan-300 mt-0.5">
                {manifest.runtime.ffmpegAvailable && manifest.runtime.ffprobeAvailable
                  ? 'FFmpeg + FFprobe OK'
                  : 'FFmpeg Missing'}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">Zero-egress baseline</div>
            </div>
            <div className="p-3 rounded-lg bg-[#0B0E17] border border-[#1E2436]">
              <div className="text-[11px] text-slate-500">Vault Evidence Ledger</div>
              <div className="font-mono tabular-nums text-slate-100 mt-0.5">
                {manifest.archiveSummary.totalAssets} assets · {manifest.archiveSummary.totalEvents} events
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums">
                {manifest.archiveSummary.totalLayerRecords} layers · {manifest.archiveSummary.totalAuditRecords} audits
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Integrity Verification + Exports */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-5 rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">Source Integrity & Privacy Policy</h2>
            <button
              type="button"
              disabled={verifying}
              onClick={handleVerifyHash}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {verifying ? 'Hashing…' : 'Verify SHA-256'}
            </button>
          </div>

          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-slate-500">Selected Vault Asset</dt>
              <dd className="text-slate-100 font-medium mt-0.5">{asset.originalFilename}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Recorded SHA-256 Checksum</dt>
              <dd className="font-mono text-[11px] text-slate-300 break-all mt-0.5">
                {asset.sha256Hash}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Provenance Note</dt>
              <dd className="text-slate-300 leading-relaxed mt-0.5">{asset.provenanceNote}</dd>
            </div>
          </dl>

          {integrityResult && (
            <div
              role="status"
              className={`p-3 rounded-lg border text-xs space-y-1 ${
                integrityResult.verifiedIntact
                  ? 'bg-[#131A26] border-cyan-500/40 text-cyan-100'
                  : 'bg-[#1F131A] border-rose-500/40 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>
                  {integrityResult.verifiedIntact
                    ? 'Vault source file matches original SHA-256 checksum.'
                    : 'Checksum mismatch detected on disk.'}
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                Checked at {new Date(integrityResult.checkedAt).toLocaleTimeString()}
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-[#1D2335] text-xs space-y-1.5 text-slate-400">
            <div className="font-medium text-slate-200">Active Governance Safeguards (§16)</div>
            <ul className="list-disc pl-4 space-y-1 leading-relaxed">
              <li>Local-first processing default; explicit opt-in required for Cloud AI calls.</li>
              <li>Original vault media files are never deleted or overwritten during analysis or review.</li>
              <li>No biometric facial identification of unknown people and no mental-state diagnoses.</li>
              <li>All server-side API credentials remain isolated in environment secrets.</li>
            </ul>
          </div>
        </section>

        {/* Evidence-Linked Export Center */}
        <section className="xl:col-span-7 rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Evidence-Linked Exports (§19)</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Every export embeds source asset ID, SHA-256 checksum, epistemic layer separation, and prioritisation disclaimers.
            </p>
          </div>

          <div className="divide-y divide-[#1D2335] border border-[#1E2436] rounded-lg bg-[#0B0E17]">
            {EXPORT_FORMATS.map((item) => (
              <div key={item.format} className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-100">{item.label}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{item.description}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handlePreviewExport(item.format)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[#171C2C] hover:bg-[#20273D] text-slate-200 whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadExport(item.format)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download .{item.format}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {previewDoc && (
            <div className="rounded-lg bg-[#0B0E17] border border-[#242B42] overflow-hidden">
              <div className="px-3.5 py-2 border-b border-[#1E2436] flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-300">{previewDoc.filename}</span>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Close preview
                </button>
              </div>
              <pre className="p-3.5 text-[11px] text-slate-300 overflow-x-auto max-h-64 leading-relaxed">
                {previewDoc.content.slice(0, 6000)}
              </pre>
            </div>
          )}
        </section>
      </div>

      {/* Model Run Provenance + Audit Ledger */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <section className="rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1F2538] flex items-center justify-between text-xs">
            <h2 className="font-semibold text-slate-100">Model Run Provenance</h2>
            <span className="font-mono tabular-nums text-slate-400">{modelRuns.length} runs</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0D101A] text-slate-400 border-b border-[#1D2335]">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Provider / Model</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Latency</th>
                  <th className="py-2.5 px-4 font-medium text-right">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2234] font-mono tabular-nums">
                {modelRuns.slice(0, 15).map((r) => (
                  <tr key={r.id} className="hover:bg-[#141826]">
                    <td className="py-2.5 px-4">
                      <div className="text-slate-200 font-sans font-medium">{r.modelName}</div>
                      <div className="text-[11px] text-slate-500">{r.providerId}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={r.status === 'completed' ? 'text-cyan-300' : 'text-rose-400'}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-300">{r.latencyMs}ms</td>
                    <td className="py-2.5 px-4 text-right text-slate-400">
                      {r.estimatedTokens ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#1F2538] flex items-center justify-between text-xs">
            <h2 className="font-semibold text-slate-100">Custodian Audit Ledger</h2>
            <span className="font-mono tabular-nums text-slate-400">
              {audits.length} records · {revisions.length} revisions
            </span>
          </div>
          <div className="divide-y divide-[#1C2234] max-h-80 overflow-y-auto">
            {audits.slice(0, 25).map((aud) => (
              <div key={aud.id} className="px-4 py-3 text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-cyan-300">{aud.action}</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500">
                    {new Date(aud.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-slate-300 leading-snug">{aud.details}</p>
                <div className="text-[11px] text-slate-500">
                  Actor: {aud.actor} · Entity: {aud.entityType} ({aud.entityId})
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
