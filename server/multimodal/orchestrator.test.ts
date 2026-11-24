import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AaiStore } from '../db';
import { computeFileSha256, ensureVerificationMp4Fixture, probeMediaFile } from '../media/ffmpegProcessor';
import { LocalSignalAdapter, ProviderRegistry } from './providerAdapter';
import { MultimodalOrchestrator } from './orchestrator';

test('LocalSignalAdapter produces Layer E observations and technical irregularity ordinary explanations', async () => {
  const adapter = new LocalSignalAdapter();
  const cap = await adapter.detectCapabilities();
  assert.equal(cap.available, true);
  assert.equal(cap.requiresConsent, false);

  const out = await adapter.analyze({
    assetId: 'asset-test',
    originalFilename: 'test.mp4',
    mediaKind: 'video',
    durationSec: 24,
    mode: 'balanced',
    sceneCuts: [
      { timestampSec: 6.0, sceneScore: 0.6 },
      { timestampSec: 16.1, sceneScore: 0.65 },
      { timestampSec: 16.9, sceneScore: 0.68 },
    ],
    keyframes: [],
    audioProfile: {
      hasAudio: true,
      meanVolumeDb: -18.5,
      maxVolumeDb: -3.2,
      silenceIntervals: [{ startSec: 5.0, endSec: 6.5, durationSec: 1.5 }],
      energyShiftTimestampsSec: [6.5],
    },
    cloudAiConsent: false,
  });

  assert.ok(out.observableEvidence.length >= 2);
  const irregularity = out.candidateMoments.find((m) => m.classification === 'technical_irregularity');
  assert.ok(irregularity, 'Expected clustered rapid cuts to flag a technical_irregularity');
  assert.ok(irregularity!.ordinaryExplanations.length >= 2);
});

test('MultimodalOrchestrator blocks cloud provider without consent and recovers from interrupted job on real MP4', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aai-test-'));
  try {
    const store = new AaiStore(tmpDir);
    const registry = new ProviderRegistry();
    const orchestrator = new MultimodalOrchestrator(store, registry);

    const fixture = await ensureVerificationMp4Fixture(store.paths.vaultDir);
    const stat = fs.statSync(fixture.filePath);
    const sha256 = await computeFileSha256(fixture.filePath);
    const probed = await probeMediaFile(fixture.filePath);

    store.insertAsset({
      id: 'asset-mp4-test',
      originalFilename: 'test_reel.mp4',
      storedFilename: fixture.storedFilename,
      sourceAdapter: 'verification_fixture',
      dataOrigin: 'verification_fixture',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      fileFormat: probed.fileFormat,
      fileSizeBytes: stat.size,
      durationSec: probed.durationSec,
      importDate: new Date().toISOString(),
      creationDate: null,
      creationDateStatus: 'unknown',
      width: probed.width,
      height: probed.height,
      frameRate: probed.frameRate,
      videoCodec: probed.videoCodec,
      audioCodec: probed.audioCodec,
      audioSampleRate: probed.audioSampleRate,
      audioChannels: probed.audioChannels,
      locationMetadata: null,
      sha256Hash: sha256,
      isDuplicateOf: null,
      processingStatus: 'imported',
      provenanceNote: 'Unit test MP4',
      embeddedMetadataJson: '{}',
    });

    // 1. Must refuse Gemini cloud call without explicit cloudAiConsent=true
    await assert.rejects(
      () =>
        orchestrator.runPipeline({
          assetId: 'asset-mp4-test',
          mode: 'economy',
          providerId: 'google-gemini-multimodal',
          cloudAiConsent: false,
        }),
      /explicit user cloud consent/i
    );

    // 2. Simulate interruption at stage 7 (extract_keyframes) and verify recovery/resume
    await assert.rejects(
      () =>
        orchestrator.runPipeline({
          assetId: 'asset-mp4-test',
          mode: 'economy',
          providerId: 'local-ffmpeg-signal',
          cloudAiConsent: false,
          simulateInterruptAtStage: 'extract_keyframes',
        }),
      /Interrupted at stage/i
    );

    const jobs = store.listJobs('asset-mp4-test');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'interrupted');

    // Resume the exact same job ID -> must complete all 12 stages and extract real keyframes
    const resumed = await orchestrator.runPipeline({
      assetId: 'asset-mp4-test',
      mode: 'economy',
      providerId: 'local-ffmpeg-signal',
      cloudAiConsent: false,
      resumeJobId: jobs[0].id,
    });

    assert.equal(resumed.job.status, 'completed');
    assert.ok(resumed.job.stages.every((s) => s.status === 'completed'));
    assert.ok(resumed.keyframes.length >= 3);
    assert.ok(resumed.events.length >= 2);

    // 3. Verify Stage 4 extracted real mono 16kHz MP3 audio file into audioDir
    const extractedMp3 = path.join(store.paths.audioDir, 'asset-mp4-test.mp3');
    assert.ok(fs.existsSync(extractedMp3), 'Expected Stage 4 to extract MP3 audio for ASR');
    assert.ok(fs.statSync(extractedMp3).size > 5000, 'Expected non-empty extracted MP3 audio');

    // 4. Verify schema migration v2 applied cleanly and google-gemini-transcribe enforces approval gate & consent
    assert.equal(store.getSchemaVersion(), 2);
    const caps = await registry.detectAllCapabilities();
    const geminiAsr = caps.find((c) => c.id === 'google-gemini-transcribe');
    assert.ok(geminiAsr, 'Expected google-gemini-transcribe adapter to be registered');
    assert.equal(geminiAsr!.modelName, 'gemini-3.5-transcribe');
    assert.equal(geminiAsr!.requiresConsent, true);
    if (process.env.AAI_ALLOW_CLOUD_AI !== 'true') {
      assert.equal(geminiAsr!.available, false, 'Cloud ASR must remain disabled pending AAI_ALLOW_CLOUD_AI=true');
    }

    await assert.rejects(
      () =>
        orchestrator.runSpeechTranscription({
          assetId: 'asset-mp4-test',
          providerId: 'google-gemini-transcribe',
          cloudAiConsent: false,
        }),
      /explicit user cloud consent/i
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
