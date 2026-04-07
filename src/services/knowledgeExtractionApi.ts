const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type KeSession = {
  id: string;
  mode: 'course' | 'manual';
  course_id: string | null;
  course_title: string | null;
  material_selection: { outline: boolean; ppt: boolean; script: boolean };
  extract_goal: string;
  target_audience: string;
  use_scenes: string[];
  status: string;
  assets: Array<{
    id: string;
    kind: string;
    original_name: string;
    size: number;
    extracted_text?: string;
  }>;
  anchor_package: Record<string, unknown> | null;
  error_message: string | null;
};

function url(path: string) {
  return `${base}${path}`;
}

export function isKeApiEnabled(): boolean {
  return Boolean(base);
}

export async function keHealth(): Promise<{ ok: boolean }> {
  const r = await fetch(url('/health'));
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json() as Promise<{ ok: boolean }>;
}

export async function keCreateSession(body: Partial<KeSession>): Promise<KeSession> {
  const r = await fetch(url('/knowledge-extraction/sessions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<KeSession>;
}

export async function kePatchSession(id: string, body: Partial<KeSession>): Promise<KeSession> {
  const r = await fetch(url(`/knowledge-extraction/sessions/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<KeSession>;
}

export async function keGetSession(id: string): Promise<KeSession> {
  const r = await fetch(url(`/knowledge-extraction/sessions/${id}`));
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<KeSession>;
}

export async function keUploadAsset(
  sessionId: string,
  file: File,
  kind: string,
): Promise<{ id: string; audio_pending?: boolean; extracted_text?: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', kind);
  const r = await fetch(url(`/knowledge-extraction/sessions/${sessionId}/assets`), {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ id: string; audio_pending?: boolean; extracted_text?: string }>;
}

export type KnowledgeItem = {
  id: string;
  type: 'explicit' | 'tacit' | 'practice';
  category: string;
  title: string;
  content: string;
  source: string;
  priority: 'high' | 'medium' | 'low';
  reusable: boolean;
  selected: boolean;
};

export async function keRunFilter(sessionId: string): Promise<KeSession & { filter_items?: KnowledgeItem[] }> {
  const r = await fetch(url(`/knowledge-extraction/sessions/${sessionId}/filter/run`), {
    method: 'POST',
  });
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text) as { error?: string };
      throw new Error(j.error || text);
    } catch {
      throw new Error(text);
    }
  }
  return JSON.parse(text) as KeSession & { filter_items?: KnowledgeItem[] };
}

// ──────── Step 3 & 4 类型 ────────────────────────────────────────────────────

export type RefinementCoreKnowledge = {
  id: string;
  title: string;
  type: string;
  content: string;
  tags: string[];
};

export type RefinementCaseMaterial = {
  id: string;
  title: string;
  source: string;
  content: string;
  highlight: string;
};

export type RefinementPracticalTool = {
  id: string;
  title: string;
  format: string;
  desc: string;
};

export type RefinementOptimizationSuggestion = {
  id: string;
  content: string;
  priority: 'high' | 'medium';
};

export type RefinementResult = {
  core_knowledge: RefinementCoreKnowledge[];
  case_materials: RefinementCaseMaterial[];
  practical_tools: RefinementPracticalTool[];
  optimization_suggestions: RefinementOptimizationSuggestion[];
};

export async function keRunRefine(sessionId: string): Promise<KeSession & { refine_result?: RefinementResult; refine_status?: string; refine_error?: string | null }> {
  const r = await fetch(url(`/knowledge-extraction/sessions/${sessionId}/refine/run`), {
    method: 'POST',
  });
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text) as { error?: string };
      throw new Error(j.error || text);
    } catch {
      throw new Error(text);
    }
  }
  return JSON.parse(text) as KeSession & { refine_result?: RefinementResult; refine_status?: string; refine_error?: string | null };
}

export async function keReextractItem(
  sessionId: string,
  item: { item_title: string; item_content: string; item_type: string },
): Promise<{ optimized_content: string; mock?: boolean }> {
  const r = await fetch(url(`/knowledge-extraction/sessions/${sessionId}/reextract`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text) as { error?: string };
      throw new Error(j.error || text);
    } catch {
      throw new Error(text);
    }
  }
  return JSON.parse(text) as { optimized_content: string; mock?: boolean };
}

// ──────── Step 4b 类型：质量评估 ─────────────────────────────────────────────

export type ValidationItem = {
  id: string;
  knowledge_accuracy: number;      // 0-100
  knowledge_accuracy_reason: string;
  goal_alignment: number;          // 0-100
  goal_alignment_reason: string;
  reuse_value: number;             // 0-100
  reuse_value_reason: string;
  overall: number;                 // 三维均值
  status: 'pass' | 'needs_review' | 'fail';
  suggestion: string;
};

export async function keRunValidation(
  sessionId: string,
  structured_result: RefinementResult,
): Promise<{ session_id: string; validation_items: ValidationItem[]; mock: boolean }> {
  const r = await fetch(url(`/knowledge-extraction/sessions/${sessionId}/validate/run`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structured_result }),
  });
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text) as { error?: string };
      throw new Error(j.error || text);
    } catch {
      throw new Error(text);
    }
  }
  return JSON.parse(text) as { session_id: string; validation_items: ValidationItem[]; mock: boolean };
}

export async function keRunAnchor(sessionId: string): Promise<KeSession> {
  const r = await fetch(url(`/knowledge-extraction/sessions/${sessionId}/anchor/run`), {
    method: 'POST',
  });
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text) as { error?: string };
      throw new Error(j.error || text);
    } catch {
      throw new Error(text);
    }
  }
  return JSON.parse(text) as KeSession;
}
