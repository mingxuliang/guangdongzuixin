/**
 * 服务端调用 Dify Workflow（blocking），与前端 agent-dify 行为对齐。
 */
function getV1Root() {
  const raw = (process.env.DIFY_BASE_URL || '').trim() || 'http://127.0.0.1:8088/v1';
  const base = raw.replace(/\/$/, '');
  if (/\/v1$/i.test(base)) return base;
  return `${base}/v1`;
}

function stripJsonFence(s) {
  const t = s.trim();
  if (t.startsWith('```')) {
    return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  return t;
}

/**
 * Dify 工作流若在「开始」节点增加必填变量 `llm_profile_json`（如 LLM 画像/模型配置），
 * `/v1/workflows/run` 的 inputs 必须包含该字段，否则会 400: invalid_param。
 * 默认传 JSON 字符串 `"{}"`；可用环境变量 `KE_LLM_PROFILE_JSON` 覆盖（须为合法 JSON 文本）。
 * 若旧版工作流未定义该变量且接口报错，可设 `KE_OMIT_LLM_PROFILE_JSON=1` 不再合并此字段。
 */
function mergeWorkflowInputs(inputs) {
  const base = inputs && typeof inputs === 'object' ? { ...inputs } : {};
  if (process.env.KE_OMIT_LLM_PROFILE_JSON === '1') return base;
  const raw = process.env.KE_LLM_PROFILE_JSON?.trim();
  let llm_profile_json = '{}';
  if (raw) {
    try {
      JSON.parse(raw);
      llm_profile_json = raw;
    } catch {
      llm_profile_json = '{}';
    }
  }
  return { ...base, llm_profile_json };
}

/**
 * 从文本中截取第一个平衡的 JSON 数组片段（避免贪婪正则匹配到错误 ]）
 */
function extractFirstJsonArray(s) {
  if (!s || typeof s !== 'string') return null;
  const start = s.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Dify 部分版本 outputs 为 [{ variable, value }]，统一成对象 */
function normalizeWorkflowOutputs(outputs) {
  if (outputs == null) return {};
  if (!Array.isArray(outputs)) return outputs;
  const merged = {};
  for (const entry of outputs) {
    if (entry && typeof entry === 'object') {
      const k = entry.variable ?? entry.key ?? entry.name;
      const v = entry.value ?? entry.text ?? entry.content;
      if (k !== undefined && v !== undefined) merged[k] = v;
    }
  }
  return merged;
}

function escapeControlCharsInJsonStrings(chunk) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function parseJsonLenient(chunk) {
  const c = chunk.trim();
  try {
    return JSON.parse(c);
  } catch {
    try {
      return JSON.parse(c.replace(/,\s*([\]}])/g, '$1'));
    } catch {
      const escaped = escapeControlCharsInJsonStrings(c);
      try {
        return JSON.parse(escaped);
      } catch {
        try {
          return JSON.parse(escaped.replace(/,\s*([\]}])/g, '$1'));
        } catch {
          throw new Error('JSON parse failed');
        }
      }
    }
  }
}

/** 将 Dify 工作流 outputs.knowledge_items（字符串或已解析值）转为 knowledge_items 数组 */
function parseFilterKnowledgeItems(rawOut) {
  if (Array.isArray(rawOut)) return rawOut;

  let text =
    typeof rawOut === 'string'
      ? rawOut
      : rawOut != null
        ? JSON.stringify(rawOut)
        : '[]';
  text = text.trim().replace(/^\uFEFF/, '');

  // Dify 偶发「字符串里再包一层 JSON 字符串」
  if (typeof rawOut === 'string') {
    let s = text;
    for (let d = 0; d < 5; d++) {
      try {
        const p = parseJsonLenient(s);
        if (Array.isArray(p)) return p;
        if (p && typeof p === 'object' && Array.isArray(p.knowledge_items)) return p.knowledge_items;
        if (typeof p === 'string') {
          s = p;
          continue;
        }
        break;
      } catch {
        break;
      }
    }
    text = s;
  }

  const tryParseArray = (chunk) => {
    const cleaned = stripJsonFence(chunk.trim());
    const parsed = parseJsonLenient(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.knowledge_items)) return parsed.knowledge_items;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    if (parsed && typeof parsed === 'object' && (parsed.id || parsed.title)) return [parsed];
    return null;
  };

  // 1) 整段直接解析（含围栏）
  try {
    const a = tryParseArray(text);
    if (a) return a;
  } catch {
    /* continue */
  }

  // 2) 平衡括号截取数组再解析
  const balanced = extractFirstJsonArray(text);
  if (balanced) {
    try {
      const a = tryParseArray(balanced);
      if (a) return a;
    } catch {
      /* continue */
    }
    try {
      const parsed = parseJsonLenient(balanced);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* continue */
    }
  }

  // 3) 尝试截取第一个 JSON 对象（LLM 有时输出 { "knowledge_items": [...] }）
  const objStart = text.indexOf('{');
  if (objStart !== -1) {
    const sub = text.slice(objStart);
    const tryObj = sub.match(/^\{[\s\S]*\}/);
    if (tryObj) {
      try {
        const o = parseJsonLenient(tryObj[0]);
        if (Array.isArray(o.knowledge_items)) return o.knowledge_items;
        if (Array.isArray(o.items)) return o.items;
      } catch {
        /* continue */
      }
    }
  }

  // 4) 旧版贪婪正则兜底（仅当平衡括号失败）
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = parseJsonLenient(match[0]);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* ignore */
  }

  // 5) 最终兜底：对整段文本做控制字符转义后重试
  try {
    const escaped = escapeControlCharsInJsonStrings(text);
    const arrChunk = extractFirstJsonArray(escaped);
    if (arrChunk) {
      const parsed = JSON.parse(arrChunk);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* ignore */
  }

  return null;
}

export async function runKeAnchorWorkflow(inputs) {
  const apiKey = process.env.KE_ANCHOR_API_KEY?.trim();
  if (!apiKey) {
    return { mock: true, anchor_package: buildMockAnchorPackage(inputs) };
  }

  const user = process.env.KE_ANCHOR_USER?.trim() || 'knowledge-extraction-anchor';
  const url = `${getV1Root()}/workflows/run`;
  const timeoutMs = Number(process.env.KE_ANCHOR_TIMEOUT_MS || 180000);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        inputs: mergeWorkflowInputs(inputs),
        response_mode: 'blocking',
        user,
      }),
    });
  } finally {
    clearTimeout(tid);
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Dify Workflow ${res.status}: ${rawText.slice(0, 800)}`);
  }

  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error('Dify 返回非 JSON');
  }

  const data = json.data;
  const status = String(data?.status ?? '');
  if (status === 'failed' || status === 'error') {
    throw new Error(data?.error || json.message || '工作流执行失败');
  }

  const outputs = data?.outputs;
  if (!outputs || typeof outputs !== 'object') {
    throw new Error('缺少 data.outputs');
  }

  const rawOut = outputs.anchor_package;
  const text = typeof rawOut === 'string' ? rawOut : JSON.stringify(rawOut ?? {});

  let anchor_package;
  try {
    anchor_package = JSON.parse(stripJsonFence(text));
  } catch {
    anchor_package = {
      anchor_summary: text.slice(0, 2000),
      scope_in: [],
      scope_out: [],
      material_inventory: [],
      gaps: ['解析 anchor_package JSON 失败，已保存原始文本片段'],
      downstream_hints: '',
      _raw: text,
    };
  }

  return { mock: false, anchor_package };
}

// ── Step 2：分层筛选 ─────────────────────────────────────────────────────────

export async function runKeFilterWorkflow(inputs) {
  const apiKey = process.env.KE_FILTER_API_KEY?.trim();
  if (!apiKey) {
    return { mock: true, knowledge_items: buildMockFilterItems(inputs) };
  }

  const user = process.env.KE_ANCHOR_USER?.trim() || 'knowledge-extraction-filter';
  const url = `${getV1Root()}/workflows/run`;
  const timeoutMs = Number(process.env.KE_ANCHOR_TIMEOUT_MS || 180000);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ inputs: mergeWorkflowInputs(inputs), response_mode: 'blocking', user }),
    });
  } finally {
    clearTimeout(tid);
  }

  const rawText = await res.text();
  if (!res.ok) throw new Error(`Dify Filter Workflow ${res.status}: ${rawText.slice(0, 800)}`);

  let json;
  try { json = JSON.parse(rawText); } catch { throw new Error('Dify 返回非 JSON'); }

  const data = json.data;
  const status = String(data?.status ?? '');
  if (status === 'failed' || status === 'error') {
    throw new Error(data?.error || json.message || '分层筛选工作流执行失败');
  }

  const outputs = normalizeWorkflowOutputs(data?.outputs);
  const rawOut =
    outputs?.knowledge_items ?? outputs?.output ?? outputs?.text ?? outputs?.result;

  let knowledge_items = parseFilterKnowledgeItems(rawOut);

  if (!knowledge_items?.length) {
    // 若首选 key 为空，遍历所有 outputs 值再尝试
    if (rawOut == null) {
      for (const v of Object.values(outputs)) {
        const recovered = parseFilterKnowledgeItems(v);
        if (recovered?.length) { knowledge_items = recovered; break; }
      }
    }
  }

  if (!knowledge_items?.length) {
    const text =
      typeof rawOut === 'string'
        ? rawOut
        : JSON.stringify(rawOut ?? {}).slice(0, 100_000);
    console.warn('[filter] parseFilterKnowledgeItems 解析失败，rawOut 前 500 字:', String(rawOut).slice(0, 500));
    knowledge_items = [
      {
        id: 'k_raw',
        type: 'explicit',
        category: '解析提示',
        title: 'AI返回内容解析失败，请查看原始内容',
        content: text.slice(0, 800),
        structured_body: text,
        source: 'Dify原始输出',
        priority: 'low',
        reusable: false,
        selected: false,
      },
    ];
  }

  // 确保每个条目都有必要字段
  knowledge_items = knowledge_items.map((item, i) => ({
    id: item.id ?? `k${i + 1}`,
    type: item.type ?? 'explicit',
    knowledge_form: item.knowledge_form ?? '',
    category: item.category ?? '未分类',
    title: item.title ?? `知识条目${i + 1}`,
    content: item.content ?? '',
    structured_body: item.structured_body ?? '',
    source: item.source ?? 'Dify',
    priority: item.priority ?? 'medium',
    reusable: item.reusable !== false,
    selected: item.selected !== false && item.priority !== 'low',
  }));

  return { mock: false, knowledge_items };
}

function buildMockFilterItems(inputs) {
  const goal = inputs.extract_goal || '（未填写）';
  return [
    {
      id: 'mock_k1', type: 'explicit', category: '方法论',
      title: `【演示】${goal.slice(0, 20)} - 核心流程`,
      content: '未配置 KE_FILTER_API_KEY，当前显示演示数据。导入 ke-02 工作流并配置 Key 后可获取真实知识条目。',
      source: '演示数据', priority: 'high', reusable: true, selected: true,
    },
    {
      id: 'mock_k2', type: 'tacit', category: '经验技巧',
      title: '【演示】关键经验汇总',
      content: '请在 .env.local 中配置 KE_FILTER_API_KEY，并在 Dify 中导入 dify/ke-02-layered-filter.dsl.yml。',
      source: '演示数据', priority: 'medium', reusable: true, selected: false,
    },
  ];
}

// ── Step 3：结构化提炼 ───────────────────────────────────────────────────────

export async function runKeRefineWorkflow(inputs) {
  const apiKey = process.env.KE_REFINE_API_KEY?.trim();
  if (!apiKey) {
    return { mock: true, structured_result: buildMockRefinementResult(inputs) };
  }

  const user = process.env.KE_ANCHOR_USER?.trim() || 'knowledge-extraction-refine';
  const url = `${getV1Root()}/workflows/run`;
  const timeoutMs = Number(process.env.KE_ANCHOR_TIMEOUT_MS || 180000);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ inputs: mergeWorkflowInputs(inputs), response_mode: 'blocking', user }),
    });
  } finally {
    clearTimeout(tid);
  }

  const rawText = await res.text();
  if (!res.ok) throw new Error(`Dify Refine Workflow ${res.status}: ${rawText.slice(0, 800)}`);

  let json;
  try { json = JSON.parse(rawText); } catch { throw new Error('Dify 返回非 JSON'); }

  const data = json.data;
  const status = String(data?.status ?? '');
  if (status === 'failed' || status === 'error') {
    throw new Error(data?.error || json.message || '结构化提炼工作流执行失败');
  }

  const rawOut = data?.outputs?.structured_result;
  const text = typeof rawOut === 'string' ? rawOut : JSON.stringify(rawOut ?? {});

  let structured_result;
  try {
    const cleaned = stripJsonFence(text);
    structured_result = JSON.parse(cleaned);
  } catch {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('未找到 JSON 对象');
      structured_result = JSON.parse(match[0]);
    } catch {
      structured_result = buildMockRefinementResult(inputs);
      structured_result._raw = text.slice(0, 800);
    }
  }

  return { mock: false, structured_result };
}

function buildMockRefinementResult(inputs) {
  const goal = inputs.extract_goal || '（未填写）';
  return {
    core_knowledge: [
      {
        id: 'ck1', title: `【演示】${goal.slice(0, 18)} - 核心方法`,
        type: '方法论',
        content: '未配置 KE_REFINE_API_KEY，当前显示演示数据。导入 ke-03 工作流并配置 Key 后可获取真实提炼成果。',
        tags: ['演示', '待配置'],
      },
    ],
    case_materials: [
      {
        id: 'cm1', title: '【演示】案例素材示例',
        source: '演示数据',
        content: '请在 .env.local 配置 KE_REFINE_API_KEY 后重试。',
        highlight: '配置Key后显示真实案例',
      },
    ],
    practical_tools: [
      {
        id: 'pt1', title: '【演示】工具模板示例',
        format: '模板',
        desc: '配置 KE_REFINE_API_KEY 并导入 dify/ke-03-structured-refinement.dsl.yml 后可获取真实工具建议。',
      },
    ],
    optimization_suggestions: [
      {
        id: 'os1',
        content: '配置 KE_REFINE_API_KEY 后，AI 将基于四大萃取目标给出具体优化建议。',
        priority: 'high',
      },
    ],
  };
}

// ── Step 4：重新提取单条 ─────────────────────────────────────────────────────

export async function runKeReextractWorkflow(inputs) {
  const apiKey = process.env.KE_REEXTRACT_API_KEY?.trim();
  if (!apiKey) {
    return { mock: true, optimized_content: buildMockOptimizedContent(inputs) };
  }

  const user = process.env.KE_ANCHOR_USER?.trim() || 'knowledge-extraction-reextract';
  const url = `${getV1Root()}/workflows/run`;
  const timeoutMs = Number(process.env.KE_ANCHOR_TIMEOUT_MS || 120000);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ inputs: mergeWorkflowInputs(inputs), response_mode: 'blocking', user }),
    });
  } finally {
    clearTimeout(tid);
  }

  const rawText = await res.text();
  if (!res.ok) throw new Error(`Dify Reextract Workflow ${res.status}: ${rawText.slice(0, 800)}`);

  let json;
  try { json = JSON.parse(rawText); } catch { throw new Error('Dify 返回非 JSON'); }

  const data = json.data;
  const status = String(data?.status ?? '');
  if (status === 'failed' || status === 'error') {
    throw new Error(data?.error || json.message || '重新提取工作流执行失败');
  }

  const rawOut = data?.outputs?.optimized_content;
  const optimized_content = typeof rawOut === 'string' ? rawOut.trim() : buildMockOptimizedContent(inputs);

  return { mock: false, optimized_content };
}

function buildMockOptimizedContent(inputs) {
  const base = inputs.item_content || '';
  return `${base}\n\n【AI二次优化】经深度分析，该知识点在实际应用中需结合具体业务场景灵活调整，建议配合案例库使用，可提升学员理解效率。（请配置 KE_REEXTRACT_API_KEY 并导入 ke-04 工作流以获取真实 AI 优化内容）`;
}

// ── 音频转写精炼（调用 ke-audio-transcript-refine 工作流）─────────────────

export async function runKeAudioRefineWorkflow(inputs) {
  const apiKey = process.env.KE_AUDIO_REFINE_API_KEY?.trim();
  if (!apiKey) {
    // 未配置 Key 时直接返回原始转写，不做精炼
    return { mock: true, refined_transcript: inputs.raw_transcript };
  }

  const user = process.env.KE_ANCHOR_USER?.trim() || 'knowledge-extraction-audio';
  const url = `${getV1Root()}/workflows/run`;
  // 音频精炼可能比较耗时（大量文本），给 5 分钟超时
  const timeoutMs = Number(process.env.KE_AUDIO_REFINE_TIMEOUT_MS || 300000);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ inputs: mergeWorkflowInputs(inputs), response_mode: 'blocking', user }),
    });
  } finally {
    clearTimeout(tid);
  }

  const rawText = await res.text();
  if (!res.ok) throw new Error(`Dify Audio Refine Workflow ${res.status}: ${rawText.slice(0, 800)}`);

  let json;
  try { json = JSON.parse(rawText); } catch { throw new Error('Dify 返回非 JSON'); }

  const data = json.data;
  const status = String(data?.status ?? '');
  if (status === 'failed' || status === 'error') {
    throw new Error(data?.error || json.message || '音频精炼工作流执行失败');
  }

  const rawOut = data?.outputs?.refined_transcript;
  const refined_transcript = typeof rawOut === 'string' && rawOut.trim()
    ? rawOut.trim()
    : inputs.raw_transcript; // 兜底返回原始转写

  return { mock: false, refined_transcript };
}

// ── Step 4b：校验闭环 - 批量质量评估 ────────────────────────────────────────

export async function runKeValidationWorkflow(inputs) {
  const apiKey = process.env.KE_VALIDATION_API_KEY?.trim();
  if (!apiKey) {
    return { mock: true, validation_items: buildMockValidationItems(inputs) };
  }

  const user = process.env.KE_ANCHOR_USER?.trim() || 'knowledge-extraction-validation';
  const url = `${getV1Root()}/workflows/run`;
  const timeoutMs = Number(process.env.KE_ANCHOR_TIMEOUT_MS || 180000);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({ inputs: mergeWorkflowInputs(inputs), response_mode: 'blocking', user }),
    });
  } finally {
    clearTimeout(tid);
  }

  const rawText = await res.text();
  if (!res.ok) throw new Error(`Dify Validation Workflow ${res.status}: ${rawText.slice(0, 800)}`);

  let json;
  try { json = JSON.parse(rawText); } catch { throw new Error('Dify 返回非 JSON'); }

  const data = json.data;
  const status = String(data?.status ?? '');
  if (status === 'failed' || status === 'error') {
    throw new Error(data?.error || json.message || '质量评估工作流执行失败');
  }

  const rawOut = data?.outputs?.validation_result;
  const text = typeof rawOut === 'string' ? rawOut : JSON.stringify(rawOut ?? []);

  let validation_items;
  try {
    const cleaned = stripJsonFence(text);
    const parsed = JSON.parse(cleaned);
    validation_items = Array.isArray(parsed) ? parsed : [];
  } catch {
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('未找到 JSON 数组');
      const parsed = JSON.parse(match[0]);
      validation_items = Array.isArray(parsed) ? parsed : [];
    } catch {
      // 解析失败：返回 mock 兜底数据
      return { mock: true, validation_items: buildMockValidationItems(inputs) };
    }
  }

  // 归一化字段，确保每条评估结果格式完整
  validation_items = validation_items.map(item => {
    const ka = Math.min(100, Math.max(0, Number(item.knowledge_accuracy ?? 80)));
    const ga = Math.min(100, Math.max(0, Number(item.goal_alignment ?? 80)));
    const rv = Math.min(100, Math.max(0, Number(item.reuse_value ?? 80)));
    const overall = Math.round((ka + ga + rv) / 3);
    let itemStatus = item.status;
    if (!['pass', 'needs_review', 'fail'].includes(itemStatus)) {
      itemStatus = overall >= 80 ? 'pass' : overall >= 60 ? 'needs_review' : 'fail';
    }
    return {
      id: item.id ?? '',
      knowledge_accuracy: ka,
      knowledge_accuracy_reason: item.knowledge_accuracy_reason ?? '',
      goal_alignment: ga,
      goal_alignment_reason: item.goal_alignment_reason ?? '',
      reuse_value: rv,
      reuse_value_reason: item.reuse_value_reason ?? '',
      overall,
      status: itemStatus,
      suggestion: item.suggestion ?? '',
    };
  });

  return { mock: false, validation_items };
}

function buildMockValidationItems(inputs) {
  // 从 structured_result_json 中提取 id，生成演示评分
  let ids = [];
  try {
    const parsed = JSON.parse(inputs.structured_result_json || '{}');
    const ckIds = (parsed.core_knowledge ?? []).map(i => i.id);
    const cmIds = (parsed.case_materials ?? []).map(i => i.id);
    ids = [...ckIds, ...cmIds];
  } catch { /* 解析失败时使用空数组 */ }

  if (ids.length === 0) ids = ['ck1', 'cm1'];

  return ids.map((id, idx) => ({
    id,
    knowledge_accuracy: 75 + (idx % 3) * 5,
    knowledge_accuracy_reason: '未配置 KE_VALIDATION_API_KEY，演示数据',
    goal_alignment: 80 + (idx % 2) * 5,
    goal_alignment_reason: '未配置 KE_VALIDATION_API_KEY，演示数据',
    reuse_value: 70 + (idx % 4) * 5,
    reuse_value_reason: '未配置 KE_VALIDATION_API_KEY，演示数据',
    overall: Math.round((75 + (idx % 3) * 5 + 80 + (idx % 2) * 5 + 70 + (idx % 4) * 5) / 3),
    status: 'needs_review',
    suggestion: '请在 .env.local 配置 KE_VALIDATION_API_KEY 并导入 ke-05 工作流以获取真实评估',
  }));
}

// ── Step 1：源头锚定（保持在下方）──────────────────────────────────────────

function buildMockAnchorPackage(inputs) {
  const goal = inputs.extract_goal || '（未填写）';
  return {
    anchor_summary: `【离线演示】已根据萃取目标生成占位锚定说明：${goal.slice(0, 200)}`,
    scope_in: ['与目标直接相关的课程知识点', '可复用的流程与工具'],
    scope_out: ['与目标无关的扩展阅读'],
    material_inventory: [
      { kind: 'bundle', status: 'ok', note: '未配置 KE_ANCHOR_API_KEY 时返回模拟数据' },
    ],
    gaps: ['配置 KE_ANCHOR_API_KEY 并导入 dify/ke-01-source-anchor.dsl.yml 工作流后可调用真实 Dify'],
    downstream_hints: '进入第二步时可按「显性/隐性」维度筛选',
  };
}
