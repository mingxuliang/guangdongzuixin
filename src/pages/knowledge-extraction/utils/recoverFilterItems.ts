import type { KnowledgeItem } from '@/services/knowledgeExtractionApi';

/** 与后端 difyClient 中单条归一化逻辑对齐 */
function normalizeOne(item: Record<string, unknown>, i: number): KnowledgeItem {
  const pr = item.priority;
  const priority =
    pr === 'high' || pr === 'medium' || pr === 'low' ? pr : 'medium';
  const ty = item.type;
  const type =
    ty === 'explicit' || ty === 'tacit' || ty === 'practice' ? ty : 'explicit';
  return {
    id: String(item.id ?? `k${i + 1}`),
    type,
    knowledge_form:
      typeof item.knowledge_form === 'string' ? item.knowledge_form : undefined,
    category: String(item.category ?? '未分类'),
    title: String(item.title ?? `知识条目${i + 1}`),
    content: String(item.content ?? ''),
    structured_body:
      typeof item.structured_body === 'string' ? item.structured_body : undefined,
    source: String(item.source ?? 'Dify'),
    priority,
    reusable: item.reusable !== false,
    selected: item.selected !== false && priority !== 'low',
  };
}

function escapeControlCharsInJsonStrings(chunk: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { out += ch; inString = !inString; continue; }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

function extractFirstJsonArray(s: string): string | null {
  const start = s.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function lenientParseArray(chunk: string): unknown[] | null {
  const stripped = chunk.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const candidates = [stripped, stripped.replace(/,\s*([\]}])/g, '$1')];
  for (const c of candidates) {
    try {
      const p = JSON.parse(c);
      if (Array.isArray(p) && p.length > 0) return p;
      if (p && typeof p === 'object' && Array.isArray(p.knowledge_items)) return p.knowledge_items;
    } catch { /* continue */ }
  }
  const escaped = escapeControlCharsInJsonStrings(stripped);
  const arr = extractFirstJsonArray(escaped);
  if (arr) {
    try {
      const p = JSON.parse(arr);
      if (Array.isArray(p) && p.length > 0) return p;
    } catch { /* continue */ }
    try {
      const p = JSON.parse(arr.replace(/,\s*([\]}])/g, '$1'));
      if (Array.isArray(p) && p.length > 0) return p;
    } catch { /* continue */ }
  }
  return null;
}

/**
 * 后端曾把解析失败存成单条 k_raw，但 content 或 structured_body 里已是合法 JSON 数组（与 Dify 日志一致）。
 * 在前端再尝试解析一次，避免用户必须清会话。
 */
export function recoverFilterItemsFromKRaw(items: KnowledgeItem[]): KnowledgeItem[] {
  if (items.length !== 1) return items;
  const only = items[0];
  if (only.id !== 'k_raw') return items;

  const sources = [
    (only.structured_body ?? '').trim(),
    (only.content ?? '').trim(),
  ].filter(Boolean);

  for (const raw of sources) {
    const parsed = lenientParseArray(raw);
    if (parsed) {
      return parsed.map((row, idx) =>
        normalizeOne(row as Record<string, unknown>, idx),
      );
    }
  }

  return items;
}
