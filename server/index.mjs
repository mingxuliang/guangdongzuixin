// 按优先级加载环境变量：.env → .env.local（.env.local 会覆盖 .env）
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();                              // 先加载 .env
dotenvConfig({ path: '.env.local', override: true }); // .env.local 优先级更高
import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

import { runKeAnchorWorkflow, runKeFilterWorkflow, runKeRefineWorkflow, runKeReextractWorkflow } from './lib/difyClient.mjs';
import { extractTextFromFile, mergeMaterialLines, AUDIO_PENDING, isAudioExt, transcribeAudio } from './lib/extractText.mjs';
import { isOssConfigured, putLocalFileToOss } from './lib/ossUpload.mjs';
import { createSessionRecord, loadSession, saveSession } from './lib/store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UPLOAD_ROOT = path.join(__dirname, 'uploads');

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 8787);

function ensureUploadDir(sessionId) {
  const dir = path.join(UPLOAD_ROOT, sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'knowledge-extraction-api',
    time: new Date().toISOString(),
    object_storage: isOssConfigured() ? 'configured' : 'local_only',
  });
});

app.post('/api/knowledge-extraction/sessions', (req, res) => {
  try {
    const session = createSessionRecord(req.body || {});
    res.status(201).json(session);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/knowledge-extraction/sessions/:id', (req, res) => {
  const s = loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json(s);
});

app.patch('/api/knowledge-extraction/sessions/:id', (req, res) => {
  const s = loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (b.mode != null) s.mode = b.mode;
  if (b.course_id !== undefined) s.course_id = b.course_id;
  if (b.course_title !== undefined) s.course_title = b.course_title;
  if (b.material_selection) s.material_selection = { ...s.material_selection, ...b.material_selection };
  if (b.extract_goal !== undefined) s.extract_goal = b.extract_goal;
  if (b.target_audience !== undefined) s.target_audience = b.target_audience;
  if (b.use_scenes) s.use_scenes = b.use_scenes;
  saveSession(s);
  res.json(s);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const sid = req.params.id;
      cb(null, ensureUploadDir(sid));
    },
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
});

app.post('/api/knowledge-extraction/sessions/:id/assets', upload.single('file'), async (req, res) => {
  const s = loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!req.file) return res.status(400).json({ error: 'file_required' });

  const kind = (req.body?.kind || 'manual_upload').toString();
  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const isAudio = isAudioExt(ext);

  // 音频文件：延迟转写（在 anchor/run 时统一处理），上传立即响应
  // 非音频文件：立即提取文本（PDF/Word/PPT 通常只需几秒）
  const extracted_text = isAudio
    ? AUDIO_PENDING
    : await extractTextFromFile(req.file.path, req.file.originalname);

  const assetId = randomUUID();
  const safeName = req.file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  const ossKey = `knowledge-extraction/${req.params.id}/${assetId}-${safeName}`;

  let storage = 'local';
  let localPath = path.relative(ROOT, req.file.path).replace(/\\/g, '/');
  let oss_bucket;
  let oss_key;

  try {
    // 音频文件始终保留本地副本（anchor/run 阶段需要读取本地文件做转写）
    // 非音频文件按正常逻辑上传 OSS
    if (isOssConfigured() && !isAudio) {
      const up = await putLocalFileToOss({
        localPath: req.file.path,
        objectKey: ossKey,
        contentType: req.file.mimetype,
      });
      if (up) {
        storage = 'oss';
        oss_bucket = up.bucket;
        oss_key = up.key;
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        localPath = undefined;
      }
    }
  } catch (e) {
    return res.status(502).json({
      error: `object_storage_upload_failed: ${String(e?.message || e)}`,
    });
  }

  const asset = {
    id: assetId,
    kind,
    original_name: req.file.originalname,
    storage,
    path: localPath,
    oss_bucket,
    oss_key,
    size: req.file.size,
    mime: req.file.mimetype,
    extracted_text,
    // 音频文件标记为待转写，便于前端显示进度提示
    audio_pending: isAudio ? true : undefined,
  };
  s.assets = s.assets || [];
  s.assets.push(asset);
  saveSession(s);
  res.status(201).json(asset);
});

app.post('/api/knowledge-extraction/sessions/:id/anchor/run', async (req, res) => {
  const s = loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  if (!s.extract_goal?.trim()) {
    return res.status(400).json({ error: 'extract_goal_required' });
  }

  if (s.mode === 'manual' && (!s.assets || s.assets.length === 0)) {
    return res.status(400).json({ error: 'manual_requires_files' });
  }

  s.status = 'anchoring';
  s.error_message = null;
  saveSession(s);

  try {
    // ── 批量转写待处理音频文件（上传时跳过，在此统一处理）────────────────────
    let audioTranscribed = false;
    for (const asset of (s.assets || [])) {
      if (asset.extracted_text !== AUDIO_PENDING) continue;
      if (!asset.path) {
        // 音频文件没有本地路径（OSS 情况）
        asset.extracted_text = `[音频文件已上传至云存储，本地副本不可用，无法自动转写: ${asset.original_name}]`;
        asset.audio_pending = false;
        audioTranscribed = true;
        continue;
      }
      const absPath = path.join(ROOT, asset.path);
      if (!fs.existsSync(absPath)) {
        asset.extracted_text = `[音频本地文件已被移除，无法转写: ${asset.original_name}]`;
        asset.audio_pending = false;
        audioTranscribed = true;
        continue;
      }
      console.log(`[anchor/run] 开始转写音频: ${asset.original_name}`);
      asset.extracted_text = await transcribeAudio(absPath, asset.original_name);
      asset.audio_pending = false;
      audioTranscribed = true;
      console.log(`[anchor/run] 转写完成: ${asset.original_name} (${asset.extracted_text.length} 字)`);
    }
    if (audioTranscribed) saveSession(s); // 保存转写结果

    const material_bundle_text = mergeMaterialLines(s);
    const inputs = {
      mode: s.mode,
      extract_goal: s.extract_goal,
      target_audience: s.target_audience || '',
      use_scenes: JSON.stringify(s.use_scenes || []),
      course_title: s.course_title || '',
      material_bundle_text: material_bundle_text.slice(0, 100_000),
    };

    const result = await runKeAnchorWorkflow(inputs);
    s.anchor_package = result.anchor_package;
    s.status = 'ready';
    s.error_message = result.mock
      ? 'mock: 未配置 KE_ANCHOR_API_KEY，返回模拟锚定包'
      : null;
    saveSession(s);
    res.json(s);
  } catch (e) {
    s.status = 'failed';
    s.error_message = String(e?.message || e);
    saveSession(s);
    console.error('[anchor/run] 失败:', s.error_message);
    res.status(500).json({ error: s.error_message, session: s });
  }
});

app.post('/api/knowledge-extraction/sessions/:id/filter/run', async (req, res) => {
  const s = loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  if (!s.anchor_package) {
    return res.status(400).json({ error: 'anchor_required: 请先完成源头锚定（Step 1）' });
  }

  s.filter_status = 'running';
  s.filter_error = null;
  saveSession(s);

  try {
    const material_bundle_text = mergeMaterialLines(s);
    const inputs = {
      anchor_package: JSON.stringify(s.anchor_package),
      extract_goal: s.extract_goal || '',
      target_audience: s.target_audience || '',
      material_bundle_text: material_bundle_text.slice(0, 100_000),
    };

    const result = await runKeFilterWorkflow(inputs);
    s.filter_items = result.knowledge_items;
    s.filter_status = 'ready';
    s.filter_error = result.mock
      ? 'mock: 未配置 KE_FILTER_API_KEY，返回演示数据'
      : null;
    saveSession(s);
    res.json(s);
  } catch (e) {
    s.filter_status = 'failed';
    s.filter_error = String(e?.message || e);
    saveSession(s);
    console.error('[filter/run] 失败:', s.filter_error);
    res.status(500).json({ error: s.filter_error, session: s });
  }
});

app.post('/api/knowledge-extraction/sessions/:id/refine/run', async (req, res) => {
  const s = loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  if (!s.filter_items || s.filter_items.length === 0) {
    return res.status(400).json({ error: 'filter_required: 请先完成分层筛选（Step 2）' });
  }

  s.refine_status = 'running';
  s.refine_error = null;
  saveSession(s);

  try {
    const selectedItems = (s.filter_items || []).filter(item => item.selected !== false);
    const inputs = {
      anchor_package: JSON.stringify(s.anchor_package || {}),
      filter_items_json: JSON.stringify(selectedItems),
      extract_goal: s.extract_goal || '',
      target_audience: s.target_audience || '',
    };

    const result = await runKeRefineWorkflow(inputs);
    s.refine_result = result.structured_result;
    s.refine_status = 'ready';
    s.refine_error = result.mock
      ? 'mock: 未配置 KE_REFINE_API_KEY，返回演示数据'
      : null;
    saveSession(s);
    res.json(s);
  } catch (e) {
    s.refine_status = 'failed';
    s.refine_error = String(e?.message || e);
    saveSession(s);
    console.error('[refine/run] 失败:', s.refine_error);
    res.status(500).json({ error: s.refine_error, session: s });
  }
});

app.post('/api/knowledge-extraction/sessions/:id/reextract', async (req, res) => {
  const s = loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  const { item_title, item_content, item_type } = req.body || {};
  if (!item_title || !item_content) {
    return res.status(400).json({ error: 'item_title 和 item_content 必填' });
  }

  try {
    const anchorSummary = s.anchor_package?.anchor_summary || '';
    const inputs = {
      item_title: String(item_title),
      item_content: String(item_content),
      item_type: String(item_type || 'explicit'),
      extract_goal: s.extract_goal || '',
      anchor_summary: anchorSummary.slice(0, 500),
    };

    const result = await runKeReextractWorkflow(inputs);
    res.json({ optimized_content: result.optimized_content, mock: result.mock });
  } catch (e) {
    console.error('[reextract] 失败:', String(e?.message || e));
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** 生产/Devbox：构建前端后由本进程托管 out/ */
const serveStatic = process.env.SERVE_STATIC === '1' || process.env.NODE_ENV === 'production';
const outDir = path.join(ROOT, 'out');
if (serveStatic && fs.existsSync(outDir)) {
  app.use(express.static(outDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(outDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(
    `[ke-api] http://0.0.0.0:${PORT}  health: /api/health  storage: ${isOssConfigured() ? 'OSS' : 'local'}`
  );
});
