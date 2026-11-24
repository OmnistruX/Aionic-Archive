import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  Asset,
  AuditRecord,
  DetectedEvent,
  Keyframe,
  LayerRecord,
  ModelRun,
  ProcessingJob,
  RankingConfig,
  ReviewDecision,
  RevisionEntry,
  TranscriptSegment,
} from '../src/shared/types';
import { createDefaultRankingConfig } from '../src/shared/ranking';

export interface AaiDatabasePaths {
  dataDir: string;
  vaultDir: string;
  keyframesDir: string;
  audioDir: string;
  dbPath: string;
}

export function resolveDataPaths(customDataDir?: string): AaiDatabasePaths {
  const dataDir = path.resolve(customDataDir || process.env.AAI_DATA_DIR || path.join(process.cwd(), 'data'));
  const vaultDir = path.join(dataDir, 'vault');
  const keyframesDir = path.join(dataDir, 'keyframes');
  const audioDir = path.join(dataDir, 'audio');
  const dbPath = path.join(dataDir, 'aai_archive.db');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(keyframesDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  return { dataDir, vaultDir, keyframesDir, audioDir, dbPath };
}

export class AaiStore {
  public readonly db: DatabaseSync;
  public readonly paths: AaiDatabasePaths;

  constructor(customDataDir?: string) {
    this.paths = resolveDataPaths(customDataDir);
    this.db = new DatabaseSync(this.paths.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
    this.runMigrations();
    this.ensureDefaultRankingConfig();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        source_adapter TEXT NOT NULL,
        data_origin TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_format TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        duration_sec REAL NOT NULL,
        import_date TEXT NOT NULL,
        creation_date TEXT,
        creation_date_status TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        frame_rate REAL,
        video_codec TEXT,
        audio_codec TEXT,
        audio_sample_rate INTEGER,
        audio_channels INTEGER,
        location_metadata TEXT,
        sha256_hash TEXT NOT NULL,
        is_duplicate_of TEXT,
        processing_status TEXT NOT NULL,
        provenance_note TEXT NOT NULL,
        embedded_metadata_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS keyframes (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        timestamp_sec REAL NOT NULL,
        scene_index INTEGER NOT NULL,
        scene_score REAL NOT NULL,
        filename TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        extraction_method TEXT NOT NULL,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        start_sec REAL NOT NULL,
        end_sec REAL NOT NULL,
        text TEXT NOT NULL,
        speaker_label TEXT,
        confidence REAL,
        provider_id TEXT NOT NULL,
        is_placeholder_notice INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS detected_events (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        start_sec REAL NOT NULL,
        end_sec REAL NOT NULL,
        thumbnail_url TEXT,
        observable_description TEXT NOT NULL,
        analytical_summary TEXT NOT NULL,
        relevant_transcript TEXT NOT NULL,
        detection_method TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_name TEXT,
        base_signal_strength REAL NOT NULL,
        estimated_relevance_score REAL NOT NULL,
        confidence_score REAL,
        uncertainty_note TEXT NOT NULL,
        reason_for_selection TEXT NOT NULL,
        ordinary_explanations_json TEXT NOT NULL,
        classification TEXT NOT NULL,
        review_status TEXT NOT NULL,
        user_annotations TEXT NOT NULL,
        assigned_project TEXT,
        tags_json TEXT NOT NULL,
        modalities_json TEXT NOT NULL,
        data_origin TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS layer_records (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        event_id TEXT,
        layer TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        start_sec REAL,
        end_sec REAL,
        author_type TEXT NOT NULL,
        author_name TEXT NOT NULL,
        provider_id TEXT,
        model_name TEXT,
        source_reference TEXT NOT NULL,
        confidence REAL,
        uncertainty_disclosure TEXT,
        revision_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS processing_jobs (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        cloud_ai_authorized INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        current_stage TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 1,
        completed_chunks INTEGER NOT NULL DEFAULT 0,
        stages_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_summary TEXT,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS model_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        modality TEXT NOT NULL,
        config_json TEXT NOT NULL,
        input_summary TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        estimated_tokens INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS review_decisions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        previous_classification TEXT NOT NULL,
        corrected_classification TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revision_history (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        field_changed TEXT NOT NULL,
        previous_value TEXT NOT NULL,
        new_value TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ranking_configs (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === columnName);
  }

  private runMigrations(): void {
    const applied = new Set<number>(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) =>
        Number(r.version)
      )
    );
    const now = new Date().toISOString();

    if (!applied.has(1)) {
      this.db
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(1, '001_initial_aai_multimodal_schema', now);
    }

    if (!applied.has(2)) {
      // Additive migration v2: explicit soft-delete semantics, model_run links, export_records, narrative_scenes (Layer F)
      if (!this.hasColumn('assets', 'deleted_at')) {
        this.db.exec('ALTER TABLE assets ADD COLUMN deleted_at TEXT');
      }
      if (!this.hasColumn('detected_events', 'deleted_at')) {
        this.db.exec('ALTER TABLE detected_events ADD COLUMN deleted_at TEXT');
      }
      if (!this.hasColumn('detected_events', 'model_run_id')) {
        this.db.exec('ALTER TABLE detected_events ADD COLUMN model_run_id TEXT');
      }
      if (!this.hasColumn('layer_records', 'deleted_at')) {
        this.db.exec('ALTER TABLE layer_records ADD COLUMN deleted_at TEXT');
      }
      if (!this.hasColumn('layer_records', 'model_run_id')) {
        this.db.exec('ALTER TABLE layer_records ADD COLUMN model_run_id TEXT');
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS export_records (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          format TEXT NOT NULL,
          source_sha256 TEXT NOT NULL,
          event_count INTEGER NOT NULL,
          layer_count INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS narrative_scenes (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          event_id TEXT,
          layer TEXT NOT NULL DEFAULT 'F',
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          start_sec REAL,
          end_sec REAL,
          source_reference TEXT NOT NULL,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );
      `);

      this.db
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(2, '002_soft_delete_and_provenance_links', now);
    }
  }

  public getSchemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null } | undefined;
    return row?.v ? Number(row.v) : 1;
  }

  public recordExport(rec: {
    id: string;
    assetId: string;
    format: string;
    sourceSha256: string;
    eventCount: number;
    layerCount: number;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        'INSERT INTO export_records (id, asset_id, format, source_sha256, event_count, layer_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(rec.id, rec.assetId, rec.format, rec.sourceSha256, rec.eventCount, rec.layerCount, rec.createdAt);
  }

  private ensureDefaultRankingConfig(): void {
    const existing = this.db.prepare('SELECT id FROM ranking_configs WHERE id = ?').get('default');
    if (!existing) {
      const def = createDefaultRankingConfig();
      this.db
        .prepare('INSERT INTO ranking_configs (id, config_json, updated_at) VALUES (?, ?, ?)')
        .run('default', JSON.stringify(def), def.updatedAt);
    }
  }

  private mapAssetRow(row: Record<string, unknown>): Asset & { storedFilename: string } {
    const id = String(row.id);
    return {
      id,
      originalFilename: String(row.original_filename),
      storedFilename: String(row.stored_filename),
      sourceAdapter: row.source_adapter as Asset['sourceAdapter'],
      dataOrigin: row.data_origin as Asset['dataOrigin'],
      mediaKind: row.media_kind as Asset['mediaKind'],
      mimeType: String(row.mime_type),
      fileFormat: String(row.file_format),
      fileSizeBytes: Number(row.file_size_bytes),
      durationSec: Number(row.duration_sec),
      importDate: String(row.import_date),
      creationDate: row.creation_date ? String(row.creation_date) : null,
      creationDateStatus: row.creation_date_status as Asset['creationDateStatus'],
      width: row.width !== null ? Number(row.width) : null,
      height: row.height !== null ? Number(row.height) : null,
      frameRate: row.frame_rate !== null ? Number(row.frame_rate) : null,
      videoCodec: row.video_codec ? String(row.video_codec) : null,
      audioCodec: row.audio_codec ? String(row.audio_codec) : null,
      audioSampleRate: row.audio_sample_rate !== null ? Number(row.audio_sample_rate) : null,
      audioChannels: row.audio_channels !== null ? Number(row.audio_channels) : null,
      locationMetadata: row.location_metadata ? String(row.location_metadata) : null,
      sha256Hash: String(row.sha256_hash),
      isDuplicateOf: row.is_duplicate_of ? String(row.is_duplicate_of) : null,
      processingStatus: row.processing_status as Asset['processingStatus'],
      provenanceNote: String(row.provenance_note),
      embeddedMetadataJson: String(row.embedded_metadata_json),
      mediaUrl: `/api/media/${encodeURIComponent(id)}`,
    };
  }

  public listAssets(): Asset[] {
    const rows = this.db.prepare('SELECT * FROM assets ORDER BY import_date DESC').all() as Record<string, unknown>[];
    return rows.map((r) => {
      const { storedFilename: _s, ...asset } = this.mapAssetRow(r);
      return asset;
    });
  }

  public getAssetWithFile(id: string): (Asset & { storedFilename: string }) | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapAssetRow(row) : null;
  }

  public findAssetByHash(sha256Hash: string): Asset | null {
    const row = this.db
      .prepare('SELECT * FROM assets WHERE sha256_hash = ? ORDER BY import_date ASC LIMIT 1')
      .get(sha256Hash) as Record<string, unknown> | undefined;
    if (!row) return null;
    const { storedFilename: _s, ...asset } = this.mapAssetRow(row);
    return asset;
  }

  public insertAsset(asset: Omit<Asset, 'mediaUrl'> & { storedFilename: string }): Asset {
    this.db
      .prepare(
        `INSERT INTO assets (
          id, original_filename, stored_filename, source_adapter, data_origin, media_kind,
          mime_type, file_format, file_size_bytes, duration_sec, import_date, creation_date,
          creation_date_status, width, height, frame_rate, video_codec, audio_codec,
          audio_sample_rate, audio_channels, location_metadata, sha256_hash, is_duplicate_of,
          processing_status, provenance_note, embedded_metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        asset.id,
        asset.originalFilename,
        asset.storedFilename,
        asset.sourceAdapter,
        asset.dataOrigin,
        asset.mediaKind,
        asset.mimeType,
        asset.fileFormat,
        asset.fileSizeBytes,
        asset.durationSec,
        asset.importDate,
        asset.creationDate,
        asset.creationDateStatus,
        asset.width,
        asset.height,
        asset.frameRate,
        asset.videoCodec,
        asset.audioCodec,
        asset.audioSampleRate,
        asset.audioChannels,
        asset.locationMetadata,
        asset.sha256Hash,
        asset.isDuplicateOf,
        asset.processingStatus,
        asset.provenanceNote,
        asset.embeddedMetadataJson
      );
    return {
      ...asset,
      mediaUrl: `/api/media/${encodeURIComponent(asset.id)}`,
    };
  }

  public updateAssetStatus(assetId: string, status: Asset['processingStatus']): void {
    this.db.prepare('UPDATE assets SET processing_status = ? WHERE id = ?').run(status, assetId);
  }

  public replaceKeyframes(assetId: string, keyframes: Array<Omit<Keyframe, 'imageUrl'> & { filename: string }>): void {
    this.db.prepare('DELETE FROM keyframes WHERE asset_id = ?').run(assetId);
    const stmt = this.db.prepare(
      `INSERT INTO keyframes (id, asset_id, timestamp_sec, scene_index, scene_score, filename, width, height, extraction_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const kf of keyframes) {
      stmt.run(
        kf.id,
        kf.assetId,
        kf.timestampSec,
        kf.sceneIndex,
        kf.sceneScore,
        kf.filename,
        kf.width,
        kf.height,
        kf.extractionMethod
      );
    }
  }

  public listKeyframes(assetId: string): Keyframe[] {
    const rows = this.db
      .prepare('SELECT * FROM keyframes WHERE asset_id = ? ORDER BY timestamp_sec ASC')
      .all(assetId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      assetId: String(r.asset_id),
      timestampSec: Number(r.timestamp_sec),
      sceneIndex: Number(r.scene_index),
      sceneScore: Number(r.scene_score),
      imageUrl: `/api/keyframes/${encodeURIComponent(String(r.asset_id))}/${encodeURIComponent(String(r.filename))}`,
      width: r.width !== null ? Number(r.width) : null,
      height: r.height !== null ? Number(r.height) : null,
      extractionMethod: String(r.extraction_method),
    }));
  }

  public replaceTranscripts(assetId: string, segments: TranscriptSegment[]): void {
    this.db.prepare('DELETE FROM transcript_segments WHERE asset_id = ?').run(assetId);
    const stmt = this.db.prepare(
      `INSERT INTO transcript_segments (id, asset_id, start_sec, end_sec, text, speaker_label, confidence, provider_id, is_placeholder_notice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const seg of segments) {
      stmt.run(
        seg.id,
        seg.assetId,
        seg.startSec,
        seg.endSec,
        seg.text,
        seg.speakerLabel,
        seg.confidence,
        seg.providerId,
        seg.isPlaceholderNotice ? 1 : 0
      );
    }
  }

  public listTranscripts(assetId: string): TranscriptSegment[] {
    const rows = this.db
      .prepare('SELECT * FROM transcript_segments WHERE asset_id = ? ORDER BY start_sec ASC')
      .all(assetId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      assetId: String(r.asset_id),
      startSec: Number(r.start_sec),
      endSec: Number(r.end_sec),
      text: String(r.text),
      speakerLabel: r.speaker_label ? String(r.speaker_label) : null,
      confidence: r.confidence !== null ? Number(r.confidence) : null,
      providerId: String(r.provider_id),
      isPlaceholderNotice: Number(r.is_placeholder_notice) === 1,
    }));
  }

  private mapEventRow(r: Record<string, unknown>): DetectedEvent {
    return {
      id: String(r.id),
      assetId: String(r.asset_id),
      startSec: Number(r.start_sec),
      endSec: Number(r.end_sec),
      thumbnailUrl: r.thumbnail_url ? String(r.thumbnail_url) : null,
      observableDescription: String(r.observable_description),
      analyticalSummary: String(r.analytical_summary),
      relevantTranscript: String(r.relevant_transcript),
      detectionMethod: String(r.detection_method),
      providerId: String(r.provider_id),
      modelName: r.model_name ? String(r.model_name) : null,
      baseSignalStrength: Number(r.base_signal_strength),
      estimatedRelevanceScore: Number(r.estimated_relevance_score),
      confidenceScore: r.confidence_score !== null ? Number(r.confidence_score) : null,
      uncertaintyNote: String(r.uncertainty_note),
      reasonForSelection: String(r.reason_for_selection),
      ordinaryExplanations: JSON.parse(String(r.ordinary_explanations_json || '[]')),
      classification: r.classification as DetectedEvent['classification'],
      reviewStatus: r.review_status as DetectedEvent['reviewStatus'],
      userAnnotations: String(r.user_annotations),
      assignedProject: r.assigned_project ? String(r.assigned_project) : null,
      tags: JSON.parse(String(r.tags_json || '[]')),
      modalities: JSON.parse(String(r.modalities_json || '[]')),
      dataOrigin: r.data_origin as DetectedEvent['dataOrigin'],
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  public insertEvents(events: DetectedEvent[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO detected_events (
        id, asset_id, start_sec, end_sec, thumbnail_url, observable_description, analytical_summary,
        relevant_transcript, detection_method, provider_id, model_name, base_signal_strength,
        estimated_relevance_score, confidence_score, uncertainty_note, reason_for_selection,
        ordinary_explanations_json, classification, review_status, user_annotations, assigned_project,
        tags_json, modalities_json, data_origin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const e of events) {
      stmt.run(
        e.id,
        e.assetId,
        e.startSec,
        e.endSec,
        e.thumbnailUrl,
        e.observableDescription,
        e.analyticalSummary,
        e.relevantTranscript,
        e.detectionMethod,
        e.providerId,
        e.modelName,
        e.baseSignalStrength,
        e.estimatedRelevanceScore,
        e.confidenceScore,
        e.uncertaintyNote,
        e.reasonForSelection,
        JSON.stringify(e.ordinaryExplanations),
        e.classification,
        e.reviewStatus,
        e.userAnnotations,
        e.assignedProject,
        JSON.stringify(e.tags),
        JSON.stringify(e.modalities),
        e.dataOrigin,
        e.createdAt,
        e.updatedAt
      );
    }
  }

  public deleteUnreviewedMachineEvents(assetId: string): void {
    this.db
      .prepare(`DELETE FROM detected_events WHERE asset_id = ? AND review_status = 'unreviewed'`)
      .run(assetId);
  }

  public listEvents(assetId?: string): DetectedEvent[] {
    const rows = assetId
      ? (this.db
          .prepare('SELECT * FROM detected_events WHERE asset_id = ? ORDER BY start_sec ASC')
          .all(assetId) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM detected_events ORDER BY estimated_relevance_score DESC, start_sec ASC')
          .all() as Record<string, unknown>[]);
    return rows.map((r) => this.mapEventRow(r));
  }

  public getEvent(eventId: string): DetectedEvent | null {
    const row = this.db.prepare('SELECT * FROM detected_events WHERE id = ?').get(eventId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapEventRow(row) : null;
  }

  public updateEventReview(
    eventId: string,
    patch: {
      reviewStatus?: DetectedEvent['reviewStatus'];
      classification?: DetectedEvent['classification'];
      startSec?: number;
      endSec?: number;
      userAnnotations?: string;
      assignedProject?: string | null;
      tags?: string[];
    }
  ): DetectedEvent | null {
    const current = this.getEvent(eventId);
    if (!current) return null;

    const updatedAt = new Date().toISOString();
    const next = {
      ...current,
      reviewStatus: patch.reviewStatus ?? current.reviewStatus,
      classification: patch.classification ?? current.classification,
      startSec: patch.startSec !== undefined ? patch.startSec : current.startSec,
      endSec: patch.endSec !== undefined ? patch.endSec : current.endSec,
      userAnnotations: patch.userAnnotations !== undefined ? patch.userAnnotations : current.userAnnotations,
      assignedProject: patch.assignedProject !== undefined ? patch.assignedProject : current.assignedProject,
      tags: patch.tags !== undefined ? patch.tags : current.tags,
      updatedAt,
    };

    // Note: observable_description (Layer E) is deliberately NEVER mutated here.
    this.db
      .prepare(
        `UPDATE detected_events
         SET review_status = ?, classification = ?, start_sec = ?, end_sec = ?,
             user_annotations = ?, assigned_project = ?, tags_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.reviewStatus,
        next.classification,
        next.startSec,
        next.endSec,
        next.userAnnotations,
        next.assignedProject,
        JSON.stringify(next.tags),
        next.updatedAt,
        eventId
      );

    return this.getEvent(eventId);
  }

  public insertLayerRecord(record: LayerRecord): LayerRecord {
    this.db
      .prepare(
        `INSERT INTO layer_records (
          id, asset_id, event_id, layer, title, content, start_sec, end_sec,
          author_type, author_name, provider_id, model_name, source_reference,
          confidence, uncertainty_disclosure, revision_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.assetId,
        record.eventId,
        record.layer,
        record.title,
        record.content,
        record.startSec,
        record.endSec,
        record.authorType,
        record.authorName,
        record.providerId,
        record.modelName,
        record.sourceReference,
        record.confidence,
        record.uncertaintyDisclosure,
        record.revisionCount,
        record.createdAt,
        record.updatedAt
      );
    return record;
  }

  public deleteMachineLayerRecords(assetId: string): void {
    this.db
      .prepare(`DELETE FROM layer_records WHERE asset_id = ? AND author_type != 'human_reviewer'`)
      .run(assetId);
  }

  public listLayerRecords(assetId?: string): LayerRecord[] {
    const rows = assetId
      ? (this.db
          .prepare('SELECT * FROM layer_records WHERE asset_id = ? ORDER BY created_at DESC')
          .all(assetId) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM layer_records ORDER BY created_at DESC').all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      assetId: String(r.asset_id),
      eventId: r.event_id ? String(r.event_id) : null,
      layer: r.layer as LayerRecord['layer'],
      title: String(r.title),
      content: String(r.content),
      startSec: r.start_sec !== null ? Number(r.start_sec) : null,
      endSec: r.end_sec !== null ? Number(r.end_sec) : null,
      authorType: r.author_type as LayerRecord['authorType'],
      authorName: String(r.author_name),
      providerId: r.provider_id ? String(r.provider_id) : null,
      modelName: r.model_name ? String(r.model_name) : null,
      sourceReference: String(r.source_reference),
      confidence: r.confidence !== null ? Number(r.confidence) : null,
      uncertaintyDisclosure: r.uncertainty_disclosure ? String(r.uncertainty_disclosure) : null,
      revisionCount: Number(r.revision_count),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  public upsertJob(job: ProcessingJob): void {
    this.db
      .prepare(
        `INSERT INTO processing_jobs (
          id, asset_id, mode, provider_id, cloud_ai_authorized, status, current_stage,
          chunk_count, completed_chunks, stages_json, started_at, completed_at, error_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_stage = excluded.current_stage,
          chunk_count = excluded.chunk_count,
          completed_chunks = excluded.completed_chunks,
          stages_json = excluded.stages_json,
          completed_at = excluded.completed_at,
          error_summary = excluded.error_summary`
      )
      .run(
        job.id,
        job.assetId,
        job.mode,
        job.providerId,
        job.cloudAiAuthorized ? 1 : 0,
        job.status,
        job.currentStage,
        job.chunkCount,
        job.completedChunks,
        JSON.stringify(job.stages),
        job.startedAt,
        job.completedAt,
        job.errorSummary
      );
  }

  public getJob(jobId: string): ProcessingJob | null {
    const r = this.db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      assetId: String(r.asset_id),
      mode: r.mode as ProcessingJob['mode'],
      providerId: String(r.provider_id),
      cloudAiAuthorized: Number(r.cloud_ai_authorized) === 1,
      status: r.status as ProcessingJob['status'],
      currentStage: (r.current_stage as ProcessingJob['currentStage']) || null,
      chunkCount: Number(r.chunk_count),
      completedChunks: Number(r.completed_chunks),
      stages: JSON.parse(String(r.stages_json)),
      startedAt: String(r.started_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
      errorSummary: r.error_summary ? String(r.error_summary) : null,
    };
  }

  public listJobs(assetId?: string): ProcessingJob[] {
    const rows = assetId
      ? (this.db
          .prepare('SELECT * FROM processing_jobs WHERE asset_id = ? ORDER BY started_at DESC')
          .all(assetId) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM processing_jobs ORDER BY started_at DESC').all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      assetId: String(r.asset_id),
      mode: r.mode as ProcessingJob['mode'],
      providerId: String(r.provider_id),
      cloudAiAuthorized: Number(r.cloud_ai_authorized) === 1,
      status: r.status as ProcessingJob['status'],
      currentStage: (r.current_stage as ProcessingJob['currentStage']) || null,
      chunkCount: Number(r.chunk_count),
      completedChunks: Number(r.completed_chunks),
      stages: JSON.parse(String(r.stages_json)),
      startedAt: String(r.started_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
      errorSummary: r.error_summary ? String(r.error_summary) : null,
    }));
  }

  public insertModelRun(run: ModelRun): void {
    this.db
      .prepare(
        `INSERT INTO model_runs (
          id, job_id, asset_id, provider_id, model_name, modality, config_json,
          input_summary, status, latency_ms, estimated_tokens, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.jobId,
        run.assetId,
        run.providerId,
        run.modelName,
        run.modality,
        run.configJson,
        run.inputSummary,
        run.status,
        run.latencyMs,
        run.estimatedTokens,
        run.errorMessage,
        run.createdAt
      );
  }

  public listModelRuns(assetId?: string): ModelRun[] {
    const rows = assetId
      ? (this.db
          .prepare('SELECT * FROM model_runs WHERE asset_id = ? ORDER BY created_at DESC')
          .all(assetId) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM model_runs ORDER BY created_at DESC').all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      assetId: String(r.asset_id),
      providerId: String(r.provider_id),
      modelName: String(r.model_name),
      modality: r.modality as ModelRun['modality'],
      configJson: String(r.config_json),
      inputSummary: String(r.input_summary),
      status: r.status as ModelRun['status'],
      latencyMs: Number(r.latency_ms),
      estimatedTokens: r.estimated_tokens !== null ? Number(r.estimated_tokens) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      createdAt: String(r.created_at),
    }));
  }

  public insertReviewDecision(decision: ReviewDecision): void {
    this.db
      .prepare(
        `INSERT INTO review_decisions (
          id, event_id, asset_id, decision, previous_classification, corrected_classification, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        decision.id,
        decision.eventId,
        decision.assetId,
        decision.decision,
        decision.previousClassification,
        decision.correctedClassification,
        decision.note,
        decision.createdAt
      );
  }

  public listReviewDecisions(): ReviewDecision[] {
    const rows = this.db
      .prepare('SELECT * FROM review_decisions ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      eventId: String(r.event_id),
      assetId: String(r.asset_id),
      decision: r.decision as ReviewDecision['decision'],
      previousClassification: r.previous_classification as ReviewDecision['previousClassification'],
      correctedClassification: r.corrected_classification as ReviewDecision['correctedClassification'],
      note: String(r.note),
      createdAt: String(r.created_at),
    }));
  }

  public insertRevision(entry: RevisionEntry): void {
    this.db
      .prepare(
        `INSERT INTO revision_history (
          id, entity_type, entity_id, field_changed, previous_value, new_value, changed_by, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.entityType,
        entry.entityId,
        entry.fieldChanged,
        entry.previousValue,
        entry.newValue,
        entry.changedBy,
        entry.reason,
        entry.createdAt
      );
  }

  public listRevisions(limit = 60): RevisionEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM revision_history ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      entityType: r.entity_type as RevisionEntry['entityType'],
      entityId: String(r.entity_id),
      fieldChanged: String(r.field_changed),
      previousValue: String(r.previous_value),
      newValue: String(r.new_value),
      changedBy: String(r.changed_by),
      reason: String(r.reason),
      createdAt: String(r.created_at),
    }));
  }

  public insertAudit(record: AuditRecord): void {
    this.db
      .prepare(
        `INSERT INTO audit_records (id, action, actor, entity_type, entity_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.action,
        record.actor,
        record.entityType,
        record.entityId,
        record.details,
        record.createdAt
      );
  }

  public listAudits(limit = 100): AuditRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_records ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      action: String(r.action),
      actor: String(r.actor),
      entityType: String(r.entity_type),
      entityId: String(r.entity_id),
      details: String(r.details),
      createdAt: String(r.created_at),
    }));
  }

  public getRankingConfig(): RankingConfig {
    const row = this.db.prepare('SELECT config_json FROM ranking_configs WHERE id = ?').get('default') as
      | { config_json: string }
      | undefined;
    if (!row) {
      return createDefaultRankingConfig();
    }
    return JSON.parse(row.config_json) as RankingConfig;
  }

  public saveRankingConfig(config: RankingConfig): RankingConfig {
    const updated: RankingConfig = {
      ...config,
      id: 'default',
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO ranking_configs (id, config_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`
      )
      .run('default', JSON.stringify(updated), updated.updatedAt);
    return updated;
  }
}
