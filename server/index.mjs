// 按优先级加载环境变量：.env → .env.local（.env.local 会覆盖 .env）
// 必须相对本文件解析项目根目录：若从子目录启动 node（cwd 非仓库根），仅依赖 process.cwd() 会读不到 .env.local，导致 KE_* 未注入、全程走模拟数据
import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const _serverDir = path.dirname(fileURLToPath(import.meta.url));
const _projectRoot = path.join(_serverDir, '..');
dotenvConfig({ path: path.join(_projectRoot, '.env') });
dotenvConfig({ path: path.join(_projectRoot, '.env.local'), override: true });

import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';

import { runKeAnchorWorkflow, runKeFilterWorkflow, runKeRefineWorkflow, runKeReextractWorkflow, runKeValidationWorkflow } from './lib/difyClient.mjs';
import { createTempAssetFilePath, extractTextFromFile, mergeMaterialLines, AUDIO_PENDING, isAudioExt, transcribeAudio } from './lib/extractText.mjs';
import { downloadOssFileToLocal, getOssPrefix, isOssConfigured, putLocalFileToOss } from './lib/ossUpload.mjs';
import { ensurePostgresSchema, getSessionStoreDriver, isPostgresConfigured } from './lib/db.mjs';
import { createSessionRecord, listSessions, loadSession, saveSession } from './lib/store.mjs';
import { listUsers, getUserById, createUser, updateUser, deleteUser, verifyPassword, signToken, verifyToken, seedDefaultAdmin } from './lib/userStore.mjs';

const __dirname = _serverDir;
const ROOT = _projectRoot;
const UPLOAD_ROOT = path.join(__dirname, 'uploads');

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 8787);

/**
 * 上传时音频为 AUDIO_PENDING，在 anchor/run 或 filter/run 前统一转写（硅基/Dify）。
 * 解决：已有 anchor_package 后又上传新音频时，若未再次点源头锚定，第二步仍应带上转写结果。
 */
async function transcribePendingAudioAssets(s) {
  let changed = false;
  for (const asset of s.assets || []) {
    if (asset.extracted_text !== AUDIO_PENDING) continue;
    let cleanup;
    let absPath = null;
    if (asset.path) {
      const localCandidate = path.join(ROOT, asset.path);
      if (fs.existsSync(localCandidate)) {
        absPath = localCandidate;
      }
    }
    if (!absPath && asset.storage === 'oss' && asset.oss_key) {
      const tempPath = await createTempAssetFilePath(asset.original_name, `audio-${s.id}`);
      await downloadOssFileToLocal({
        bucket: asset.oss_bucket,
        objectKey: asset.oss_key,
        localPath: tempPath,
      });
      absPath = tempPath;
      cleanup = async () => {
        try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }
      };
    }
    if (!absPath) {
      asset.extracted_text = `[音频文件暂不可用，无法自动转写: ${asset.original_name}]`;
      asset.audio_pending = false;
      changed = true;
      continue;
    }
    const tag = '[pending-audio]';
    console.log(`${tag} 开始转写: ${asset.original_name} (session=${s.id})`);
    try {
      asset.extracted_text = await transcribeAudio(absPath, asset.original_name, {
        extract_goal: s.extract_goal || '',
        course_title: s.course_title || '',
        target_audience: s.target_audience || '',
      });
    } finally {
      if (cleanup) await cleanup();
    }
    asset.audio_pending = false;
    changed = true;
    console.log(`${tag} 转写完成: ${asset.original_name} (${String(asset.extracted_text).length} 字)`);
  }
  if (changed) await saveSession(s);
  return changed;
}

function ensureUploadDir(sessionId) {
  const dir = path.join(UPLOAD_ROOT, sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

/** 与 extractText.transcribeAudio 一致：硅基流动优先；否则 KE_AUDIO_TO_TEXT_API_KEY / KE_ANCHOR_API_KEY */
function asrApiKeyInfo() {
  const sf =
    process.env.SILICONFLOW_API_KEY?.trim() || process.env.KE_SILICONFLOW_ASR_API_KEY?.trim();
  if (sf) {
    return {
      configured: true,
      provider: 'siliconflow',
      source: process.env.SILICONFLOW_API_KEY?.trim() ? 'SILICONFLOW_API_KEY' : 'KE_SILICONFLOW_ASR_API_KEY',
    };
  }
  const direct = process.env.KE_AUDIO_TO_TEXT_API_KEY?.trim();
  const fallback = process.env.KE_ANCHOR_API_KEY?.trim();
  if (direct) return { configured: true, provider: 'dify', source: 'KE_AUDIO_TO_TEXT_API_KEY' };
  if (fallback) return { configured: true, provider: 'dify', source: 'KE_ANCHOR_API_KEY' };
  return { configured: false, provider: 'none', source: 'none' };
}

app.get('/api/health', (_req, res) => {
  const asr = asrApiKeyInfo();
  res.json({
    ok: true,
    service: 'knowledge-extraction-api',
    time: new Date().toISOString(),
    session_storage: getSessionStoreDriver(),
    postgres_configured: isPostgresConfigured(),
    object_storage: isOssConfigured() ? 'configured' : 'local_only',
    oss_prefix: getOssPrefix(),
    /** 未配置时 Step1 会返回模拟 anchor_package，PDF 解析内容不会发往 Dify */
    ke_anchor_configured: Boolean(process.env.KE_ANCHOR_API_KEY?.trim()),
    dify_base_url: (process.env.DIFY_BASE_URL || '').trim() || '(default http://127.0.0.1:8088/v1)',
    /** ASR：硅基流动或 Dify；未配置时 anchor/run 中音频只会写入占位说明 */
    asr_configured: asr.configured,
    asr_provider: asr.provider,
    asr_key_source: asr.source,
    audio_refine_configured: Boolean(process.env.KE_AUDIO_REFINE_API_KEY?.trim()),
  });
});

app.post('/api/knowledge-extraction/sessions', async (req, res) => {
  try {
    const session = await createSessionRecord(req.body || {});
    res.status(201).json(session);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/knowledge-extraction/sessions', async (_req, res) => {
  try {
    res.json({ sessions: await listSessions() });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/knowledge-extraction/sessions/:id', async (req, res) => {
  const s = await loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json(s);
});

app.patch('/api/knowledge-extraction/sessions/:id', async (req, res) => {
  const s = await loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (b.mode != null) s.mode = b.mode;
  if (b.course_id !== undefined) s.course_id = b.course_id;
  if (b.course_title !== undefined) s.course_title = b.course_title;
  if (b.material_selection) s.material_selection = { ...s.material_selection, ...b.material_selection };
  if (b.extract_goal !== undefined) s.extract_goal = b.extract_goal;
  if (b.project_name !== undefined) s.project_name = String(b.project_name);
  if (b.target_audience !== undefined) s.target_audience = b.target_audience;
  if (b.use_scenes) s.use_scenes = b.use_scenes;
  if (b.extraction_completed !== undefined) s.extraction_completed = Boolean(b.extraction_completed);
  await saveSession(s);
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
  const s = await loadSession(req.params.id);
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
    if (isOssConfigured()) {
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
  await saveSession(s);
  res.status(201).json(asset);
});

app.post('/api/knowledge-extraction/sessions/:id/anchor/run', async (req, res) => {
  const s = await loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  if (!s.extract_goal?.trim()) {
    return res.status(400).json({ error: 'extract_goal_required' });
  }

  if (s.mode === 'manual' && (!s.assets || s.assets.length === 0)) {
    return res.status(400).json({ error: 'manual_requires_files' });
  }

  s.status = 'anchoring';
  s.error_message = null;
  await saveSession(s);

  try {
    await transcribePendingAudioAssets(s);

    const material_bundle_text = mergeMaterialLines(s);
    const bundleSlice = material_bundle_text.slice(0, 100_000);
    const inputs = {
      mode: s.mode,
      extract_goal: s.extract_goal,
      target_audience: s.target_audience || '',
      use_scenes: JSON.stringify(s.use_scenes || []),
      course_title: s.course_title || '',
      material_bundle_text: bundleSlice,
    };

    console.log(
      `[anchor/run] session=${s.id} assets=${s.assets?.length ?? 0} material_bundle_chars=${bundleSlice.length}`,
    );

    const result = await runKeAnchorWorkflow(inputs);
    s.anchor_package = result.anchor_package;
    s.status = 'ready';
    s.error_message = result.mock
      ? 'mock: 未配置 KE_ANCHOR_API_KEY，返回模拟锚定包'
      : null;
    if (result.mock) {
      console.warn(
        '[anchor/run] 模拟锚定：KE_ANCHOR_API_KEY 未生效。请确认 .env / .env.local 位于项目根且已重启 node；GET /api/health 中 ke_anchor_configured 应为 true。',
      );
    } else {
      console.log('[anchor/run] 已调用 Dify 源头锚定工作流（非模拟）');
    }
    await saveSession(s);
    res.json(s);
  } catch (e) {
    s.status = 'failed';
    s.error_message = String(e?.message || e);
    await saveSession(s);
    console.error('[anchor/run] 失败:', s.error_message);
    res.status(500).json({ error: s.error_message, session: s });
  }
});

app.post('/api/knowledge-extraction/sessions/:id/filter/run', async (req, res) => {
  const s = await loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  // 与 anchor/run 一致：先转写待处理音频，再合并 material_bundle（避免仅第二步触发时音频仍是占位）
  await transcribePendingAudioAssets(s);

  if (!s.anchor_package) {
    return res.status(400).json({ error: 'anchor_required: 请先完成源头锚定（Step 1）' });
  }

  s.filter_status = 'running';
  s.filter_error = null;
  await saveSession(s);

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
    await saveSession(s);
    res.json(s);
  } catch (e) {
    s.filter_status = 'failed';
    s.filter_error = String(e?.message || e);
    await saveSession(s);
    console.error('[filter/run] 失败:', s.filter_error);
    res.status(500).json({ error: s.filter_error, session: s });
  }
});

app.post('/api/knowledge-extraction/sessions/:id/refine/run', async (req, res) => {
  const s = await loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  if (!s.filter_items || s.filter_items.length === 0) {
    return res.status(400).json({ error: 'filter_required: 请先完成分层筛选（Step 2）' });
  }

  s.refine_status = 'running';
  s.refine_error = null;
  await saveSession(s);

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
    await saveSession(s);
    res.json(s);
  } catch (e) {
    s.refine_status = 'failed';
    s.refine_error = String(e?.message || e);
    await saveSession(s);
    console.error('[refine/run] 失败:', s.refine_error);
    res.status(500).json({ error: s.refine_error, session: s });
  }
});

app.post('/api/knowledge-extraction/sessions/:id/reextract', async (req, res) => {
  const s = await loadSession(req.params.id);
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

app.post('/api/knowledge-extraction/sessions/:id/validate/run', async (req, res) => {
  const s = await loadSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });

  const { structured_result } = req.body || {};
  if (!structured_result || typeof structured_result !== 'object') {
    return res.status(400).json({ error: 'structured_result（对象）必填' });
  }

  try {
    const inputs = {
      structured_result_json: JSON.stringify(structured_result),
      extract_goal: s.extract_goal || '',
      target_audience: s.target_audience || '',
    };

    const result = await runKeValidationWorkflow(inputs);

    // 持久化评估结果到 session
    s.validation_items = result.validation_items;
    s.validation_mock = result.mock;
    await saveSession(s);

    res.json({
      session_id: s.id,
      validation_items: result.validation_items,
      mock: result.mock,
    });
  } catch (e) {
    console.error('[validate/run] 失败:', String(e?.message || e));
    res.status(500).json({ error: String(e?.message || e) });
  }
});

await ensurePostgresSchema();

/**
 * 生产/Devbox：与 vite.config.ts 中 /islide-api 代理一致，转发到阿里云市场 iSlide。
 * 前端第五步调用同源的 `/islide-api/generate_ppt`（见 marketplaceGenerate.ts），构建后无 Vite 代理时必须由此转发。
 */
const islideUpstream = (process.env.ISLIDE_PROXY_TARGET || 'https://islide.market.alicloudapi.com').replace(/\/$/, '');
app.use('/islide-api', async (req, res) => {
  const u = new URL(req.originalUrl, 'http://localhost');
  const subPath = u.pathname.replace(/^\/islide-api(\/|$)/, '/') || '/';
  const targetUrl = `${islideUpstream}${subPath === '/' ? '' : subPath}${u.search}`;
  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json; charset=UTF-8',
        ...(req.headers.authorization ? { Authorization: String(req.headers.authorization) } : {}),
      },
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    if (!upstream.body) {
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    console.error('[islide-api proxy] 失败:', String(e?.message || e));
    res.status(502).json({ error: String(e?.message || e) });
  }
});

// ── Auth middleware ──────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== '管理员') {
    return res.status(403).json({ error: '仅管理员可操作' });
  }
  next();
}

// ── Auth routes ─────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { account, password } = req.body || {};
    if (!account || !password) {
      return res.status(400).json({ error: '请输入账号和密码' });
    }
    const user = await verifyPassword(account.trim(), password);
    if (!user) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    if (user.status === '停用') {
      return res.status(403).json({ error: '账号已停用，请联系管理员' });
    }
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: '登录服务异常' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  } catch (e) {
    console.error('[auth/me]', e);
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// ── User management routes (admin only) ─────────────────────────────────────

app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const keyword = req.query.keyword || '';
    const users = await listUsers({ keyword });
    res.json(users);
  } catch (e) {
    console.error('[users/list]', e);
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, account, password, phone, role, department, status } = req.body || {};
    if (!name?.trim() || !account?.trim()) {
      return res.status(400).json({ error: '姓名和账号为必填项' });
    }
    const user = await createUser({
      name: name.trim(),
      account: account.trim(),
      password: password || 'password123',
      phone: phone?.trim() || '',
      role: role || '内训师',
      department: department?.trim() || '',
      status: status || '启用',
    });
    res.json(user);
  } catch (e) {
    if (e.message === '账号已存在') {
      return res.status(409).json({ error: e.message });
    }
    console.error('[users/create]', e);
    res.status(500).json({ error: '创建用户失败' });
  }
});

app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await updateUser(req.params.id, req.body || {});
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  } catch (e) {
    console.error('[users/update]', e);
    res.status(500).json({ error: '更新用户失败' });
  }
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: '不能删除自己的账号' });
    }
    const ok = await deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: '用户不存在' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[users/delete]', e);
    res.status(500).json({ error: '删除用户失败' });
  }
});

app.patch('/api/users/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !['启用', '停用'].includes(status)) {
      return res.status(400).json({ error: '状态值无效' });
    }
    if (req.params.id === req.user.id && status === '停用') {
      return res.status(400).json({ error: '不能停用自己的账号' });
    }
    const user = await updateUser(req.params.id, { status });
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  } catch (e) {
    console.error('[users/status]', e);
    res.status(500).json({ error: '状态更新失败' });
  }
});

app.put('/api/users/:id/password', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '密码长度不能少于6位' });
    }
    const isAdmin = req.user.role === '管理员';
    const isSelf = req.params.id === req.user.id;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: '只能修改自己的密码' });
    }
    const user = await updateUser(req.params.id, { password });
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[users/password]', e);
    res.status(500).json({ error: '密码重置失败' });
  }
});

/** 生产/Devbox：构建前端后由本进程托管 out/ */
const serveStatic = process.env.SERVE_STATIC === '1' || process.env.NODE_ENV === 'production';
const outDir = path.join(ROOT, 'out');
if (serveStatic && fs.existsSync(outDir)) {
  app.use(express.static(outDir));
  app.get(/^(?!\/api)(?!\/islide-api)/, (_req, res) => {
    res.sendFile(path.join(outDir, 'index.html'));
  });
} else if (serveStatic && !fs.existsSync(outDir)) {
  // eslint-disable-next-line no-console
  console.warn('[ke-api] SERVE_STATIC 已开启但缺少 out/，请先执行 npm run build');
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(
    `[ke-api] http://0.0.0.0:${PORT}  health: /api/health  storage: ${isOssConfigured() ? 'OSS' : 'local'}`
  );
  try {
    await seedDefaultAdmin();
  } catch (e) {
    console.warn('[users] 种子管理员初始化跳过:', e.message);
  }
});
