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

/**
 * 后端曾把解析失败存成单条 k_raw，但 content 里已是合法 JSON 数组（与 Dify 日志一致）。
 * 在前端再尝试解析一次，避免用户必须清会话。
 */
export function recoverFilterItemsFromKRaw(items: KnowledgeItem[]): KnowledgeItem[] {
  if (items.length !== 1) return items;
  const only = items[0];
  if (only.id !== 'k_raw') return items;

  const raw = (only.content ?? '').trim();
  const tryChunks = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim(),
  ];

  for (const chunk of tryChunks) {
    if (!chunk.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(chunk) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((row, idx) =>
          normalizeOne(row as Record<string, unknown>, idx),
        );
      }
    } catch {
      /* 尝试宽松：去掉末尾多余逗号 */
      try {
        const fixed = chunk.replace(/,\s*([\]}])/g, '$1');
        const parsed = JSON.parse(fixed) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((row, idx) =>
            normalizeOne(row as Record<string, unknown>, idx),
          );
        }
      } catch {
        /* continue */
      }
    }
  }

  return items;
}
