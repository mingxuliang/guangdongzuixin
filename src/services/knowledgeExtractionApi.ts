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

export async function keUploadAsset(sessionId: string, file: File, kind: string): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', kind);
  const r = await fetch(url(`/knowledge-extraction/sessions/${sessionId}/assets`), {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ id: string }>;
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
