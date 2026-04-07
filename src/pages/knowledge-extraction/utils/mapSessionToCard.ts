import type { KeSession } from '@/services/knowledgeExtractionApi';
import { mockExtractions } from '@/mocks/knowledgeExtraction';

/** 与 ExtractionCard 使用的结构一致 */
export type ExtractionCardModel = {
  id: string;
  title: string;
  sourceCourse: string;
  tag: string;
  tagColor: string;
  coverImage: string;
  author: string;
  updatedAt: string;
  progress: number;
  itemCount: number;
  outputFormats: string[];
  steps: string[];
  completedSteps: number;
  passRate: number;
};

const COVER_POOL = mockExtractions.map((m) => m.coverImage);

const SCENE_TAG: Record<string, { label: string; tagColor: string }> = {
  'knowledge-base': { label: '企业知识库', tagColor: 'blue' },
  onboarding: { label: '新人带教', tagColor: 'sky' },
  retraining: { label: '复训场景', tagColor: 'indigo' },
  'micro-course': { label: '微课转化', tagColor: 'cyan' },
  'job-aid': { label: '岗位工具包', tagColor: 'blue' },
};

function hashId(s: string): number {
  return Math.abs(s.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
}

export function mapSessionToExtractionCard(s: KeSession): ExtractionCardModel {
  const sceneId = s.use_scenes?.[0] || 'knowledge-base';
  const tagInfo = SCENE_TAG[sceneId] || SCENE_TAG['knowledge-base'];

  let completedSteps = 0;
  if (s.anchor_package) completedSteps = 1;
  if (s.filter_status === 'ready' && (s.filter_items?.length ?? 0) > 0) completedSteps = 2;
  if (s.refine_status === 'ready' && s.refine_result) completedSteps = 3;
  if (s.extraction_completed) completedSteps = 4;

  const progress = Math.round((completedSteps / 4) * 100);

  const rr = s.refine_result;
  let itemCount = 0;
  if (rr) {
    itemCount =
      (rr.core_knowledge?.length ?? 0) +
      (rr.case_materials?.length ?? 0) +
      (rr.practical_tools?.length ?? 0);
  }
  if (itemCount === 0 && s.anchor_package) itemCount = 1;

  let passRate = 0;
  const vi = s.validation_items;
  if (Array.isArray(vi) && vi.length > 0) {
    passRate = Math.round(vi.reduce((sum, x) => sum + (x.overall ?? 0), 0) / vi.length);
  }

  const goal = (s.extract_goal || '').trim();
  const titleBase = goal.slice(0, 48) || `知识萃取 · ${s.id.slice(0, 8)}`;
  const title = goal.length > 48 ? `${goal.slice(0, 48)}…` : titleBase;

  const src = (s.course_title || '').trim() || goal.slice(0, 40) || '手工上传';
  const sourceCourse = src.length > 40 ? `${src.slice(0, 40)}…` : src;

  const updatedAt = s.updated_at
    ? new Date(s.updated_at)
        .toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
        .replace(/\//g, '.')
    : '';

  const coverImage = COVER_POOL[hashId(s.id) % COVER_POOL.length];

  return {
    id: s.id,
    title,
    sourceCourse,
    tag: tagInfo.label,
    tagColor: tagInfo.tagColor,
    coverImage,
    author: '我',
    updatedAt,
    progress,
    itemCount,
    outputFormats: ['知识手册', '微课脚本素材'],
    steps: ['源头锚定', '分层筛选', '结构化提炼', '校验闭环'],
    completedSteps,
    passRate,
  };
}
