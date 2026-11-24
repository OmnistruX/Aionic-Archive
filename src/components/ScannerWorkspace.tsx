import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Mic,
  Play,
  Pause,
  RefreshCw,
  RotateCcw,
  Upload,
  Video,
} from 'lucide-react';
import {
  Asset,
  DetectedEvent,
  Keyframe,
  MOMENT_CATEGORIES,
  PreFlightEstimate,
  ProcessingJob,
  ProcessingMode,
  ProviderCapability,
  TranscriptSegment,
} from '../shared/types';
import { formatTimestamp } from '../shared/layers';
import {
  fetchPreFlightEstimate,
  resumePipelineJob,
  runMultimodalPipeline,
  transcribeAssetSpeech,
  uploadMediaAsset,
} from '../lib/api';

interface ScannerWorkspaceProps {
  asset: Asset;
  keyframes: Keyframe[];
  events: DetectedEvent[];
  transcripts: TranscriptSegment[];
  jobs: ProcessingJob[];
  providers: ProviderCapability[];
  seekRequestSec: number | null;
  onClearSeekRequest: () => void;
  onAssetUploaded: (assetId: string) => Promise<void>;
  onWorkspaceMutated: () => Promise<void>;
  onInspectEvent: (event: DetectedEvent) => void;
}

export const ScannerWorkspace: React.FC<ScannerWorkspaceProps> = ({
  asset,
  keyframes,
  events,
  transcripts,
  jobs,
  providers,
  seekRequestSec,
  onClearSeekRequest,
  onAssetUploaded,
  onWorkspaceMutated,
  onInspectEvent,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [mode, setMode] = useState<ProcessingMode>('balanced');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('local-ffmpeg-signal');
  const [cloudConsent, setCloudConsent] = useState(false);
  const [estimate, setEstimate] = useState<PreFlightEstimate | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [asrConsent, setAsrConsent] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [provenanceInput, setProvenanceInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestJob = jobs[0] ?? null;
  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const requiresConsent = Boolean(selectedProvider?.requiresConsent);
  const geminiAsrProvider = providers.find((p) => p.id === 'google-gemini-transcribe');

  // Seek video when another workspace requests a timestamp jump
  useEffect(() => {
    if (seekRequestSec !== null && videoRef.current) {
      videoRef.current.currentTime = seekRequestSec;
      setCurrentTime(seekRequestSec);
      onClearSeekRequest();
    }
  }, [seekRequestSec, onClearSeekRequest]);

  // Fetch live pre-flight cost/resource estimate when mode, asset, or provider changes
  useEffect(() => {
    let active = true;
    fetchPreFlightEstimate({
      assetId: asset.id,
      mode,
      useCloudAi: requiresConsent,
    })
      .then((est) => {
        if (active) setEstimate(est);
      })
      .catch(() => {
        if (active) setEstimate(null);
      });
    return () => {
      active = false;
    };
  }, [asset.id, mode, requiresConsent]);

  const seekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      setCurrentTime(seconds);
    }
  };

  const togglePlayback = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await uploadMediaAsset(file, provenanceInput);
      setProvenanceInput('');
      setStatusMessage(
        res.duplicateDetected
          ? `Ingested "${res.asset.originalFilename}". Matching SHA-256 hash detected (${res.duplicateOfAssetId}); original preserved without deletion.`
          : `Ingested "${res.asset.originalFilename}" (${(res.asset.fileSizeBytes / 1024).toFixed(1)} KB). Ready for 12-stage analysis.`
      );
      await onAssetUploaded(res.asset.id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRunPipeline = async (simulateInterrupt = false) => {
    setIsRunning(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await runMultimodalPipeline({
        assetId: asset.id,
        mode,
        providerId: selectedProviderId,
        cloudAiConsent: requiresConsent ? cloudConsent : false,
        simulateInterruptAtStage: simulateInterrupt ? 'extract_keyframes' : undefined,
      });
      setStatusMessage(
        res.fallbackNotice
          ? res.fallbackNotice
          : `Completed 12-stage ${mode} analysis (${res.events.length} candidate moments, ${res.keyframes.length} keyframes).`
      );
      await onWorkspaceMutated();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Pipeline execution error.');
      await onWorkspaceMutated();
    } finally {
      setIsRunning(false);
    }
  };

  const handleResumeJob = async (jobId: string) => {
    setIsRunning(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await resumePipelineJob(jobId);
      setStatusMessage(
        `Recovered interrupted job from stage "${res.resumedFromStage}" and completed all 12 stages (${res.events.length} moments).`
      );
      await onWorkspaceMutated();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to resume job.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleTranscribeSpeech = async () => {
    setIsTranscribing(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await transcribeAssetSpeech({
        assetId: asset.id,
        providerId: 'google-gemini-transcribe',
        cloudAiConsent: asrConsent,
      });
      const speechCount = res.segments.filter((s) => !s.isPlaceholderNotice).length;
      setStatusMessage(
        speechCount > 0
          ? `Speech transcription (${res.modelRun.modelName}) completed in ${res.modelRun.latencyMs}ms: ${speechCount} timestamped segment(s) indexed.`
          : `Speech transcription (${res.modelRun.modelName}) completed in ${res.modelRun.latencyMs}ms: no intelligible speech detected.`
      );
      await onWorkspaceMutated();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Speech transcription failed.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const durationSafe = Math.max(asset.durationSec || 1, 1);

  return (
    <div className="space-y-6">
      {/* Top Origin Disclosure & Technical Spec Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#1F2538]">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-50 truncate">
            {asset.originalFilename}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 mt-1 font-mono tabular-nums">
            <span className={asset.dataOrigin === 'real_upload' ? 'text-cyan-300' : 'text-amber-300'}>
              {asset.dataOrigin === 'real_upload'
                ? 'Source: User Upload'
                : 'Source: Built-in FFmpeg Verification MP4'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{asset.fileFormat.toUpperCase()}</span>
            <span aria-hidden="true">·</span>
            <span>{(asset.fileSizeBytes / 1024).toFixed(1)} KB</span>
            <span aria-hidden="true">·</span>
            <span>{formatTimestamp(asset.durationSec)}</span>
            {asset.width && asset.height && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {asset.width}x{asset.height} @ {asset.frameRate ?? '-'} fps
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span title={asset.sha256Hash}>SHA-256 {asset.sha256Hash.slice(0, 10)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.webm,.mkv,.avi,.mp3,.wav,.m4a,.jpg,.jpeg,.png,.webp"
            onChange={handleFileSelected}
            className="hidden"
            id="aai-media-upload-input"
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <Upload className="w-3.5 h-3.5" />
            {isUploading ? 'Ingesting file…' : 'Ingest Media File'}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="flex items-start gap-2.5 px-4 py-3 text-xs rounded-lg bg-[#131A26] border border-cyan-500/40 text-cyan-100"
        >
          <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 px-4 py-3 text-xs rounded-lg bg-[#1F131A] border border-rose-500/40 text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Primary Focal Anchor: Real Video Player + Multimodal Pipeline Control Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Real Video Player, Moment Timeline Bar, Extracted Keyframes */}
        <div className="xl:col-span-7 space-y-5">
          <div className="rounded-xl bg-[#111521] border border-[#22283C] overflow-hidden">
            <div className="aspect-video bg-[#07090F] relative flex items-center justify-center">
              {asset.mediaKind === 'video' ? (
                <video
                  key={asset.id}
                  ref={videoRef}
                  src={asset.mediaUrl}
                  controls
                  preload="metadata"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="w-full h-full object-contain"
                />
              ) : asset.mediaKind === 'image' ? (
                <img
                  src={asset.mediaUrl}
                  alt={asset.originalFilename}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="p-8 text-center space-y-4 w-full">
                  <Video className="w-8 h-8 text-slate-500 mx-auto" />
                  <audio key={asset.id} src={asset.mediaUrl} controls className="w-full max-w-md mx-auto" />
                </div>
              )}
            </div>

            {/* Interactive Moment Timeline Scrubber */}
            <div className="p-4 border-t border-[#1F2538] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 shrink-0">
                  {asset.mediaKind === 'video' && (
                    <button
                      type="button"
                      onClick={togglePlayback}
                      aria-label={isPlaying ? 'Pause video' : 'Play video'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#1A2033] hover:bg-[#232B42] text-slate-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                  )}
                  <span className="font-mono text-xs tabular-nums text-slate-300 whitespace-nowrap">
                    {formatTimestamp(currentTime)} / {formatTimestamp(asset.durationSec)}
                  </span>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap">
                  {events.length} flagged moment{events.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* Clickable moment markers */}
              <div className="relative h-8 rounded-md bg-[#0B0E17] border border-[#1E2436] overflow-hidden">
                {/* Playhead */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 z-20 pointer-events-none"
                  style={{ left: `${Math.min(100, (currentTime / durationSafe) * 100)}%` }}
                />
                {events.map((evt) => {
                  const leftPct = (evt.startSec / durationSafe) * 100;
                  const widthPct = Math.max(2.5, ((evt.endSec - evt.startSec) / durationSafe) * 100);
                  const barColor =
                    evt.classification === 'technical_irregularity'
                      ? 'bg-amber-400/45 hover:bg-amber-400/70 border-amber-300/60'
                      : evt.reviewStatus === 'accepted'
                        ? 'bg-cyan-400/45 hover:bg-cyan-400/70 border-cyan-300/60'
                        : 'bg-violet-500/45 hover:bg-violet-500/70 border-violet-300/60';
                  return (
                    <button
                      key={evt.id}
                      type="button"
                      onClick={() => {
                        seekTo(evt.startSec);
                        onInspectEvent(evt);
                      }}
                      title={`${MOMENT_CATEGORIES[evt.classification]?.label} (${formatTimestamp(evt.startSec)}–${formatTimestamp(evt.endSec)})`}
                      aria-label={`Jump to ${MOMENT_CATEGORIES[evt.classification]?.label} at ${formatTimestamp(evt.startSec)}`}
                      style={{ left: `${leftPct}%`, width: `${Math.min(100 - leftPct, widthPct)}%` }}
                      className={`absolute top-1.5 bottom-1.5 rounded-xs border transition-colors cursor-pointer ${barColor}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Extracted Keyframes Filmstrip (Real FFmpeg JPGs) */}
          <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Extracted Representative Keyframes
              </h2>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {keyframes.length} frame{keyframes.length === 1 ? '' : 's'}
              </span>
            </div>

            {keyframes.length === 0 ? (
              <p className="text-xs text-slate-400 py-4">
                No keyframes extracted yet. Run the 12-stage multimodal pipeline to extract scene keyframes via FFmpeg.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {keyframes.map((kf) => (
                  <button
                    key={kf.id}
                    type="button"
                    onClick={() => seekTo(kf.timestampSec)}
                    className="group text-left rounded-lg overflow-hidden border border-[#232A40] hover:border-cyan-400/60 bg-[#0B0E17] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    <div className="aspect-video bg-[#080A12] overflow-hidden">
                      <img
                        src={kf.imageUrl}
                        alt={`Keyframe ${kf.sceneIndex} at ${formatTimestamp(kf.timestampSec)}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-150"
                      />
                    </div>
                    <div className="px-2.5 py-2 flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-slate-200">{formatTimestamp(kf.timestampSec)}</span>
                      <span className="text-slate-500 truncate ml-2">
                        {kf.extractionMethod === 'ffmpeg_scene_cut' ? 'Cut' : `S${kf.sceneIndex}`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Transcript / ASR Capability Panel */}
          <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">
                Timestamped Transcript & Audio Disclosures
              </h2>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs tabular-nums text-slate-400">
                  {transcripts.length} segment{transcripts.length === 1 ? '' : 's'}
                </span>
                {asset.audioCodec && (
                  <button
                    type="button"
                    disabled={isTranscribing || !asrConsent || !geminiAsrProvider?.available}
                    onClick={handleTranscribeSpeech}
                    title={
                      !geminiAsrProvider?.available
                        ? geminiAsrProvider?.statusReason ?? 'Gemini speech transcription unavailable'
                        : !asrConsent
                          ? 'Grant explicit cloud audio consent below before transcribing'
                          : 'Run Gemini 3.5 Transcribe on extracted audio track'
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-[#1A2033] hover:bg-[#232B42] text-cyan-200 border border-cyan-500/35 whitespace-nowrap shrink-0 disabled:opacity-45"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    {isTranscribing ? 'Transcribing…' : 'Transcribe Speech'}
                  </button>
                )}
              </div>
            </div>

            {asset.audioCodec && (
              <div className="p-3 rounded-lg bg-[#0B0E17] border border-[#1E2436] space-y-2 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
                  <span>
                    ASR Adapter:{' '}
                    <span className="font-mono text-slate-200">
                      {geminiAsrProvider?.modelName ?? 'gemini-3.5-transcribe'}
                    </span>
                  </span>
                  <span className={geminiAsrProvider?.available ? 'text-cyan-300 font-mono' : 'text-amber-300 font-mono'}>
                    {geminiAsrProvider?.available ? 'Server Key Ready' : 'Server Key Unconfigured'}
                  </span>
                </div>
                <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={asrConsent}
                    onChange={(e) => setAsrConsent(e.target.checked)}
                    className="mt-0.5 accent-cyan-400"
                  />
                  <span>
                    Authorize extracting mono 16kHz MP3 audio and sending it to Google Gemini Speech Transcription (
                    <span className="font-mono">gemini-3.5-transcribe</span>).
                  </span>
                </label>
              </div>
            )}

            <div className="space-y-2">
              {transcripts.map((seg) => (
                <div
                  key={seg.id}
                  className="flex items-start gap-3 py-2 border-b border-[#1D2335] last:border-b-0 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => seekTo(seg.startSec)}
                    className="font-mono tabular-nums text-cyan-300 hover:underline shrink-0"
                  >
                    {formatTimestamp(seg.startSec)}
                  </button>
                  <div className="min-w-0 flex-1">
                    <span className="text-slate-400 mr-2">{seg.speakerLabel ?? 'Speaker'}:</span>
                    <span className={seg.isPlaceholderNotice ? 'text-slate-400 italic' : 'text-slate-200'}>
                      {seg.text}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right 5 cols: Processing Mode, Cost Pre-Flight, Cloud Consent, 12-Stage Pipeline */}
        <div className="xl:col-span-5 space-y-5">
          <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">
                Multimodal Analysis Pipeline
              </h2>
              <span className="text-xs text-slate-400">Spec §5 & §18</span>
            </div>

            {/* Processing Mode Segmented Control */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 block">Processing Mode</label>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#0B0E17] border border-[#1E2436]">
                {(['economy', 'balanced', 'deep'] as ProcessingMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`py-2 px-2 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap shrink-0 ${
                      mode === m
                        ? 'bg-[#1F263D] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m === 'deep' ? 'Deep Analysis' : m}
                  </button>
                ))}
              </div>
            </div>

            {/* Provider Selector */}
            <div className="space-y-1.5">
              <label htmlFor="provider-select" className="text-xs text-slate-400 block">
                Multimodal Provider Adapter
              </label>
              <select
                id="provider-select"
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  setCloudConsent(false);
                }}
                className="w-full px-3 py-2 text-xs rounded-lg bg-[#0B0E17] border border-[#242B42] text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                {providers
                  .filter((p) => p.kind === 'local_signal' || p.kind === 'cloud_multimodal')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.available ? 'Available' : 'Unavailable'}
                    </option>
                  ))}
              </select>
              {selectedProvider && (
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {selectedProvider.statusReason}
                </p>
              )}
            </div>

            {/* Pre-Flight Resource & Cost Estimate */}
            {estimate && (
              <div className="p-3.5 rounded-lg bg-[#0B0E17] border border-[#1E2436] space-y-2">
                <div className="text-xs font-medium text-slate-200">
                  Pre-Flight Resource Estimate
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                  <div>
                    <span className="text-slate-500 block font-sans text-[11px]">Keyframes</span>
                    <span className="text-slate-200">~{estimate.estimatedKeyframes} frames</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-sans text-[11px]">Chunks</span>
                    <span className="text-slate-200">{estimate.chunkCount} chunk(s)</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-sans text-[11px]">Cloud Tokens</span>
                    <span className="text-slate-200">
                      {estimate.estimatedCloudTokens.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-sans text-[11px]">Est. API Cost</span>
                    <span className="text-cyan-300">{estimate.estimatedCostRangeUsd}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Explicit Opt-In Cloud AI Authorization (§16 & §18) */}
            {requiresConsent && (
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[#161426] border border-violet-500/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloudConsent}
                  onChange={(e) => setCloudConsent(e.target.checked)}
                  className="mt-0.5 accent-violet-500"
                />
                <span className="text-xs text-slate-200 leading-relaxed">
                  I explicitly authorize transmitting extracted keyframes and metadata from this asset to{' '}
                  <strong>{selectedProvider?.name}</strong>.
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isRunning || (requiresConsent && !cloudConsent)}
                onClick={() => handleRunPipeline(false)}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors whitespace-nowrap disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
                {isRunning ? 'Running 12-Stage Pipeline…' : 'Run Analysis Pipeline'}
              </button>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => handleRunPipeline(true)}
                title="Test interrupted session recovery checkpoint at Stage 7"
                className="px-3 py-2.5 text-xs font-medium rounded-lg bg-[#191E2E] hover:bg-[#232A40] text-slate-300 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45"
              >
                Test Interruption
              </button>
            </div>
          </section>

          {/* 12-Stage Pipeline Status & Resumable Recovery Ledger */}
          <section className="rounded-xl bg-[#111521] border border-[#22283C] p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">12-Stage Processing Ledger</h2>
                {latestJob && (
                  <p className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                    {latestJob.id} · {latestJob.mode} · {latestJob.status}
                  </p>
                )}
              </div>
              {latestJob && (latestJob.status === 'interrupted' || latestJob.status === 'failed') && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => handleResumeJob(latestJob.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Resume Job
                </button>
              )}
            </div>

            {!latestJob ? (
              <p className="text-xs text-slate-400 py-2">No processing runs recorded for this asset yet.</p>
            ) : (
              <ol className="divide-y divide-[#1C2234]">
                {latestJob.stages.map((st) => {
                  const statusColor =
                    st.status === 'completed'
                      ? 'text-cyan-300'
                      : st.status === 'failed'
                        ? 'text-rose-400'
                        : st.status === 'running'
                          ? 'text-violet-300'
                          : 'text-slate-500';
                  return (
                    <li key={st.stageId} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {String(st.order).padStart(2, '0')}.
                          </span>
                          <span className="text-slate-200 font-medium truncate">{st.label}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 pl-6 leading-snug">
                          {st.errorMessage || st.log}
                        </p>
                      </div>
                      <div className="text-right shrink-0 font-mono text-[11px] tabular-nums">
                        <span className={statusColor}>{st.status}</span>
                        <div className="text-slate-500 flex items-center justify-end gap-1 mt-0.5">
                          <span>{st.agentCode}</span>
                          {st.durationMs !== null && (
                            <>
                              <span aria-hidden="true">·</span>
                              <Clock className="w-2.5 h-2.5 inline" />
                              <span>{st.durationMs}ms</span>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
