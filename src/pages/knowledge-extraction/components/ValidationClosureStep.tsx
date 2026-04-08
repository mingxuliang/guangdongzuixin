import { useState, useEffect, useRef } from 'react';
import { CheckCheck, CheckCircle2 } from 'lucide-react';
import { GenerationProgressScreen } from '@/components/GenerationProgressScreen';
import { keReextractItem, keRunValidation, type RefinementResult, type ValidationItem } from '../../../services/knowledgeExtractionApi';
import { exportKnowledgeToWord } from '../utils/exportToWord';
import { KePagination } from './KePagination';

const PAGE_SIZE = 8;

interface ValidationClosureStepProps {
  sessionId: string | null;
  refinementResult: RefinementResult | null;
  onPrev: () => void;
  /** 用户点击「完成萃取」进入成功页时回调（用于标记会话完成、刷新列表） */
  onComplete?: () => void | Promise<void>;
}

// ─── 审核规则定义 ───────────────────────────────────────────────
const validationRules = [
  {
    id: 'rule1',
    title: '知识准确性',
    desc: '内容准确无误，经过业务/讲师验证',
    icon: 'ri-shield-check-line',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  {
    id: 'rule2',
    title: '目标对齐性',
    desc: '与课程目标一致，无遗漏无冗余',
    icon: 'ri-focus-3-line',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
  },
  {
    id: 'rule3',
    title: '复用价值',
    desc: '可复用到带教、复训、微课等场景',
    icon: 'ri-recycle-line',
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
  },
];

// ─── 知识条目类型 ────────────────────────────────────────────────
interface KnowledgeItem {
  id: string;
  kind: 'core' | 'case' | 'tool';
  type: string;
  title: string;
  content: string;
  tags: string[];
  source?: string;
  highlight?: string;
  format?: string;
  toolContent?: string;
  toolDesc?: string;
  methodSteps?: string[];
  keyPrinciples?: string[];
  applicableWhen?: string;
  situation?: string;
  task?: string;
  action?: string;
  result?: string;
  /** AI 三维评分（0-100），null 表示尚未评估 */
  aiScores: { rule1: number; rule2: number; rule3: number } | null;
  /** AI 各维度评估说明 */
  aiReasons: { rule1: string; rule2: string; rule3: string } | null;
  /** AI 综合状态 */
  aiStatus: 'pass' | 'needs_review' | 'fail' | null;
  /** AI 优化建议 */
  aiSuggestion: string;
  /** 人工手动覆盖 pass/fail */
  validation: { rule1: boolean; rule2: boolean; rule3: boolean };
  v1Content: string;
  v2Content: string;
  modified: boolean;
  reExtracted: boolean;
}

function serializeKnowledgeItem(item: KnowledgeItem): string {
  const lines: string[] = [];
  lines.push(`标题：${item.title}`);
  lines.push(`类型：${item.type}`);

  if (item.kind === 'core') {
    lines.push(`核心内容：${item.content}`);
    if (item.methodSteps?.length) {
      lines.push('操作步骤：');
      item.methodSteps.forEach((step, idx) => lines.push(`${idx + 1}. ${step}`));
    }
    if (item.keyPrinciples?.length) {
      lines.push(`关键要点：${item.keyPrinciples.join('；')}`);
    }
    if (item.applicableWhen) {
      lines.push(`适用场景：${item.applicableWhen}`);
    }
  }

  if (item.kind === 'case') {
    if (item.situation) lines.push(`情境：${item.situation}`);
    if (item.task) lines.push(`任务：${item.task}`);
    if (item.action) lines.push(`行动：${item.action}`);
    if (item.result) lines.push(`成果：${item.result}`);
    lines.push(`案例说明：${item.content}`);
    if (item.highlight) lines.push(`可借鉴点：${item.highlight}`);
  }

  if (item.kind === 'tool') {
    if (item.format) lines.push(`工具形式：${item.format}`);
    if (item.toolContent) lines.push(`工具内容：${item.toolContent}`);
    if (item.toolDesc) lines.push(`使用说明：${item.toolDesc}`);
  }

  if (item.tags.length > 0) {
    lines.push(`标签：${item.tags.join(' / ')}`);
  }

  return lines.join('\n');
}

// 将 RefinementResult 转换为内部 KnowledgeItem 格式
function buildFromRefinement(result: RefinementResult): KnowledgeItem[] {
  const items: KnowledgeItem[] = [];

  (result.core_knowledge ?? []).forEach(item => {
    const base: KnowledgeItem = {
      id: item.id,
      kind: 'core',
      type: item.type || '核心知识',
      title: item.title,
      content: item.content,
      tags: item.tags ?? [],
      methodSteps: item.method_steps ?? [],
      keyPrinciples: item.key_principles ?? [],
      applicableWhen: item.applicable_when,
      aiScores: null,
      aiReasons: null,
      aiStatus: null,
      aiSuggestion: '',
      validation: { rule1: true, rule2: true, rule3: true },
      v1Content: '',
      v2Content: '',
      modified: false,
      reExtracted: false,
    };
    const serialized = serializeKnowledgeItem(base);
    items.push({ ...base, v1Content: serialized, v2Content: serialized });
  });

  (result.case_materials ?? []).forEach(item => {
    const base: KnowledgeItem = {
      id: item.id,
      kind: 'case',
      type: '配套案例',
      title: item.title,
      content: item.content,
      tags: [item.source, item.highlight].filter(Boolean),
      source: item.source,
      highlight: item.highlight,
      situation: item.situation,
      task: item.task,
      action: item.action,
      result: item.result,
      aiScores: null,
      aiReasons: null,
      aiStatus: null,
      aiSuggestion: '',
      validation: { rule1: true, rule2: true, rule3: true },
      v1Content: '',
      v2Content: '',
      modified: false,
      reExtracted: false,
    };
    const serialized = serializeKnowledgeItem(base);
    items.push({ ...base, v1Content: serialized, v2Content: serialized });
  });

  (result.practical_tools ?? []).forEach(item => {
    const base: KnowledgeItem = {
      id: item.id,
      kind: 'tool',
      type: '实操工具',
      title: item.title,
      content: item.desc,
      tags: [item.format].filter(Boolean),
      format: item.format,
      toolContent: item.tool_content,
      toolDesc: item.desc,
      aiScores: null,
      aiReasons: null,
      aiStatus: null,
      aiSuggestion: '',
      validation: { rule1: true, rule2: true, rule3: true },
      v1Content: '',
      v2Content: '',
      modified: false,
      reExtracted: false,
    };
    const serialized = serializeKnowledgeItem(base);
    items.push({ ...base, v1Content: serialized, v2Content: serialized });
  });

  return items;
}

// 将 ValidationItem 数组的评分合并到 KnowledgeItem 列表
function applyValidationScores(items: KnowledgeItem[], validations: ValidationItem[]): KnowledgeItem[] {
  const scoreMap = new Map(validations.map(v => [v.id, v]));
  return items.map(item => {
    const v = scoreMap.get(item.id);
    if (!v) return item;
    const pass = (score: number) => score >= 60;
    return {
      ...item,
      aiScores: {
        rule1: v.knowledge_accuracy,
        rule2: v.goal_alignment,
        rule3: v.reuse_value,
      },
      aiReasons: {
        rule1: v.knowledge_accuracy_reason,
        rule2: v.goal_alignment_reason,
        rule3: v.reuse_value_reason,
      },
      aiStatus: v.status,
      aiSuggestion: v.suggestion,
      // AI 分数同步覆盖人工 validation（>=60 视为通过）
      validation: {
        rule1: pass(v.knowledge_accuracy),
        rule2: pass(v.goal_alignment),
        rule3: pass(v.reuse_value),
      },
    };
  });
}

// ─── 差异分析工具函数 ────────────────────────────────────────────
function computeDiff(v1: string, v2: string): Array<{ type: 'same' | 'removed' | 'added'; text: string }> {
  if (v1 === v2) return [{ type: 'same', text: v1 }];
  const result: Array<{ type: 'same' | 'removed' | 'added'; text: string }> = [];
  const sep = /([。！？；\n])/;
  const v1Parts = v1.split(sep).filter(Boolean);
  const v2Parts = v2.split(sep).filter(Boolean);
  const v1Set = new Set(v1Parts);
  const v2Set = new Set(v2Parts);
  v1Parts.forEach(part => { if (!v2Set.has(part)) result.push({ type: 'removed', text: part }); });
  v2Parts.forEach(part => { if (!v1Set.has(part)) result.push({ type: 'added', text: part }); });
  v1Parts.forEach(part => { if (v2Set.has(part)) result.push({ type: 'same', text: part }); });
  if (result.length === 0) {
    return [{ type: 'removed', text: v1 }, { type: 'added', text: v2 }];
  }
  return result;
}

type ViewMode = 'list' | 'compare' | 'success';
type PanelMode = 'v1' | 'v2' | 'diff';

// ─── 版本查看面板 ────────────────────────────────────────────────
interface VersionPanelProps {
  item: KnowledgeItem;
  onClose: () => void;
}

const VersionPanel = ({ item, onClose }: VersionPanelProps) => {
  const [mode, setMode] = useState<PanelMode>('diff');
  const diffResult = computeDiff(item.v1Content, item.v2Content);
  const hasChange = item.v1Content !== item.v2Content;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl w-[680px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-xl">
              <i className="ri-git-branch-line text-gray-600 text-sm" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">{item.title}</p>
              <p className="text-[10px] text-gray-400">版本内容查看与差异分析</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer">
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          {[
            { key: 'v1' as PanelMode, label: '1.0 原始版本', icon: 'ri-file-text-line' },
            { key: 'v2' as PanelMode, label: '2.0 优化版本', icon: 'ri-file-edit-line' },
            { key: 'diff' as PanelMode, label: '差异对比', icon: 'ri-git-merge-line' },
          ].map(tab => (
            <button key={tab.key} type="button" onClick={() => setMode(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                mode === tab.key ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
              }`}>
              <i className={`${tab.icon} text-xs`} />
              {tab.label}
            </button>
          ))}
          {!hasChange && <span className="ml-auto text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded-full">1.0 与 2.0 内容一致，暂无差异</span>}
          {hasChange && <span className="ml-auto text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">内容已优化</span>}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {mode === 'v1' && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed">{item.v1Content}</p>
            </div>
          )}
          {mode === 'v2' && (
            <div className={`rounded-xl p-4 border ${item.modified || item.reExtracted ? 'bg-emerald-50/40 border-emerald-200' : 'bg-gray-50 border-gray-100'}`}>
              <p className="text-sm text-gray-700 leading-relaxed">{item.v2Content}</p>
            </div>
          )}
          {mode === 'diff' && (
            !hasChange ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <i className="ri-check-line text-gray-400 text-xl mb-2" />
                <p className="text-sm text-gray-500">1.0 与 2.0 内容完全一致</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 mb-2">1.0 原始版本</p>
                    <div className="bg-red-50/40 border border-red-100 rounded-xl p-3">
                      <p className="text-xs text-gray-600 leading-relaxed">{item.v1Content}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-emerald-700 mb-2">2.0 优化版本</p>
                    <div className="bg-emerald-50/40 border border-emerald-100 rounded-xl p-3">
                      <p className="text-xs text-gray-600 leading-relaxed">{item.v2Content}</p>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-2">差异分析</p>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-1.5">
                    {diffResult.map((seg, i) => (
                      <span key={i} className={`inline text-xs leading-relaxed ${
                        seg.type === 'removed' ? 'bg-red-100 text-red-700 line-through px-0.5 rounded' :
                        seg.type === 'added' ? 'bg-emerald-100 text-emerald-700 px-0.5 rounded' : 'text-gray-600'
                      }`}>{seg.text}</span>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 重新提取弹窗（接入真实 API）────────────────────────────────
interface ReExtractModalProps {
  item: KnowledgeItem;
  sessionId: string | null;
  onConfirm: (newContent: string) => void;
  onClose: () => void;
}

const ReExtractModal = ({ item, sessionId, onConfirm, onClose }: ReExtractModalProps) => {
  const [loading, setLoading] = useState(false);
  const [extracted, setExtracted] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleExtract = async () => {
    setLoading(true);
    setErr(null);
    try {
      const result = await keReextractItem(sessionId, {
        item_title: item.title,
        item_content: item.v1Content,
        item_type: item.type,
      });
      setExtracted(result.optimized_content.trim());
      setDone(true);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl w-[560px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-50 rounded-xl">
              <i className="ri-refresh-line text-amber-600 text-sm" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">AI 重新提取</p>
              <p className="text-[10px] text-gray-400 truncate max-w-[280px]">{item.title}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer">
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!done ? (
            <>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                <p className="text-xs text-amber-700 font-medium mb-1">当前 1.0 内容</p>
                <p className="text-xs text-gray-600 leading-relaxed">{item.v1Content}</p>
              </div>
              <p className="text-xs text-gray-500">AI 将基于萃取核心目标对此条知识进行二次优化，生成更完整、更贴近实践的 2.0 版本。</p>
              {err && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap">
                  取消
                </button>
                <button type="button" onClick={handleExtract} disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60">
                  {loading ? (<><i className="ri-loader-4-line animate-spin" />AI 优化中...</>) : (<><i className="ri-refresh-line" />开始 AI 优化</>)}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <i className="ri-checkbox-circle-line text-emerald-600 text-sm" />
                  <p className="text-xs text-emerald-700 font-semibold">AI 优化完成，2.0 版本如下</p>
                </div>
                <textarea
                  value={extracted}
                  onChange={e => setExtracted(e.target.value)}
                  className="w-full text-xs text-gray-700 bg-white border border-emerald-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-100 leading-relaxed"
                  rows={5}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap">
                  放弃
                </button>
                <button type="button" onClick={() => onConfirm(extracted)}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors cursor-pointer whitespace-nowrap">
                  <i className="ri-check-line" />应用到 2.0 版本
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 删除确认弹窗 ────────────────────────────────────────────────
interface DeleteConfirmProps {
  item: KnowledgeItem;
  onConfirm: () => void;
  onClose: () => void;
}

const DeleteConfirm = ({ item, onConfirm, onClose }: DeleteConfirmProps) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
    <div className="bg-white rounded-2xl shadow-xl w-[400px] p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 flex items-center justify-center bg-red-50 rounded-xl">
          <i className="ri-delete-bin-line text-red-500 text-lg" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">确认删除</p>
          <p className="text-[10px] text-gray-400">此操作不可撤销</p>
        </div>
      </div>
      <div className="bg-gray-50 rounded-xl p-3 mb-4">
        <p className="text-xs text-gray-600 leading-relaxed">
          确定要删除「<strong className="text-gray-800">{item.title}</strong>」这条知识记录吗？
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-gray-500 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap">取消</button>
        <button type="button" onClick={onConfirm} className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap">
          <i className="ri-delete-bin-line" />确认删除
        </button>
      </div>
    </div>
  </div>
);

function renderValidationItemBody(item: KnowledgeItem) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600 leading-relaxed">{item.content}</p>

      {item.kind === 'core' && item.methodSteps && item.methodSteps.length > 0 && (
        <div className="bg-blue-50/60 rounded-xl p-3 border border-blue-100">
          <p className="text-[10px] font-bold text-blue-700 mb-1.5 flex items-center gap-1">
            <i className="ri-list-ordered text-xs" />操作步骤
          </p>
          <ol className="space-y-1">
            {item.methodSteps.map((step, si) => (
              <li key={si} className="text-[11px] text-gray-700 leading-relaxed flex gap-1.5">
                <span className="font-bold text-blue-500 flex-shrink-0">{si + 1}.</span>
                <span>{step.replace(/^第[一二三四五六七]步[:：]?\s*/, '').replace(/^\d+\.\s*/, '')}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {item.kind === 'core' && item.keyPrinciples && item.keyPrinciples.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.keyPrinciples.map((p, pi) => (
            <span key={pi} className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
              <i className="ri-key-2-line mr-0.5" />{p}
            </span>
          ))}
        </div>
      )}

      {item.kind === 'case' && (item.situation || item.task || item.action || item.result) && (
        <div className="space-y-1.5">
          {item.situation && (
            <div className="flex gap-2">
              <span className="text-[9px] font-bold text-sky-600 bg-sky-100 px-1.5 py-0.5 rounded flex-shrink-0 h-fit mt-0.5">情境</span>
              <p className="text-[11px] text-gray-600 leading-relaxed">{item.situation}</p>
            </div>
          )}
          {item.task && (
            <div className="flex gap-2">
              <span className="text-[9px] font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded flex-shrink-0 h-fit mt-0.5">任务</span>
              <p className="text-[11px] text-gray-600 leading-relaxed">{item.task}</p>
            </div>
          )}
          {item.action && (
            <div className="flex gap-2">
              <span className="text-[9px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded flex-shrink-0 h-fit mt-0.5">行动</span>
              <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-line">{item.action}</p>
            </div>
          )}
          {item.result && (
            <div className="flex gap-2">
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded flex-shrink-0 h-fit mt-0.5">成果</span>
              <p className="text-[11px] text-gray-600 leading-relaxed">{item.result}</p>
            </div>
          )}
        </div>
      )}

      {item.kind === 'case' && item.highlight && (
        <div className="flex items-start gap-1.5 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
          <i className="ri-lightbulb-line text-amber-500 text-xs flex-shrink-0 mt-0.5" />
          <span className="text-[10px] text-amber-700 font-medium leading-relaxed">{item.highlight}</span>
        </div>
      )}

      {item.kind === 'tool' && item.toolContent && (
        <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
          <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{item.toolContent}</p>
        </div>
      )}

      {item.kind === 'tool' && item.toolDesc && (
        <p className="text-[10px] text-gray-400 leading-relaxed">{item.toolDesc}</p>
      )}

      {(item.modified || item.reExtracted) && item.v2Content !== item.v1Content && (
        <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-200">
          <p className="text-[10px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1">
            <i className="ri-magic-line text-xs" />2.0 优化内容
          </p>
          <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{item.v2Content}</p>
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────
const ValidationClosureStep = ({ sessionId, refinementResult, onPrev, onComplete }: ValidationClosureStepProps) => {
  const initialList = refinementResult ? buildFromRefinement(refinementResult) : [];

  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>(initialList);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const [versionPanelItem, setVersionPanelItem] = useState<KnowledgeItem | null>(null);
  const [reExtractItem, setReExtractItem] = useState<KnowledgeItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<KnowledgeItem | null>(null);

  // AI 批量评估状态
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateMock, setValidateMock] = useState(false);
  const validateCalledRef = useRef(false);

  // 进入本步骤时自动触发 AI 评估
  useEffect(() => {
    if (!sessionId || !refinementResult || validateCalledRef.current) return;
    validateCalledRef.current = true;
    setValidating(true);
    setValidateError(null);
    keRunValidation(sessionId, refinementResult)
      .then(result => {
        setValidateMock(result.mock);
        setKnowledgeList(prev => applyValidationScores(prev, result.validation_items));
      })
      .catch(e => {
        setValidateError(String((e as Error)?.message ?? e));
      })
      .finally(() => setValidating(false));
  }, [sessionId, refinementResult]);

  const calculatePassRate = () => {
    if (knowledgeList.length === 0) return 0;
    const totalChecks = knowledgeList.length * 3;
    const passedChecks = knowledgeList.reduce((sum, item) => sum + Object.values(item.validation).filter(Boolean).length, 0);
    return Math.round((passedChecks / totalChecks) * 100);
  };

  const getItemPassRate = (item: KnowledgeItem) => Math.round((Object.values(item.validation).filter(Boolean).length / 3) * 100);

  const toggleValidation = (itemId: string, ruleId: string) => {
    setKnowledgeList(prev => prev.map(item =>
      item.id === itemId ? { ...item, validation: { ...item.validation, [ruleId]: !item.validation[ruleId as keyof typeof item.validation] } } : item
    ));
  };

  const startEdit = (item: KnowledgeItem) => { setEditingId(item.id); setEditContent(item.v2Content); };
  const saveEdit = (itemId: string) => {
    setKnowledgeList(prev => prev.map(item => item.id === itemId ? { ...item, v2Content: editContent, modified: true, reExtracted: false } : item));
    setEditingId(null);
  };
  const cancelEdit = () => { setEditingId(null); setEditContent(''); };
  const handleDelete = (itemId: string) => { setKnowledgeList(prev => prev.filter(item => item.id !== itemId)); setDeleteItem(null); if (editingId === itemId) setEditingId(null); };

  const handleReExtractConfirm = (newContent: string) => {
    if (!reExtractItem) return;
    setKnowledgeList(prev => prev.map(item =>
      item.id === reExtractItem.id ? { ...item, v2Content: newContent, reExtracted: true, modified: false } : item
    ));
    setReExtractItem(null);
  };

  const [downloading, setDownloading] = useState(false);
  const [page, setPage] = useState(1);

  const finishExtraction = () => {
    setViewMode('success');
    void onComplete?.();
  };
  const backToList = () => setViewMode('list');

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await exportKnowledgeToWord({
        knowledgeList,
        passRate: calculatePassRate(),
        modifiedCount: knowledgeList.filter(item => item.modified || item.reExtracted).length,
      });
    } finally {
      setDownloading(false);
    }
  };

  const passRate = calculatePassRate();
  const modifiedCount = knowledgeList.filter(item => item.modified || item.reExtracted).length;

  // ─── 成功页面 ────────────────────────────────────────────────
  if (viewMode === 'success') {
    return (
      <div className="flex flex-col h-full gap-4">
        <div className="bg-gradient-to-r from-blue-500 to-blue-700 rounded-2xl p-5 text-white [box-shadow:0_8px_24px_-4px_rgba(59,130,246,0.35)]">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 flex items-center justify-center bg-white/20 rounded-full flex-shrink-0">
              <CheckCircle2 className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold mb-1">萃取完成！</h2>
              <p className="text-sm text-blue-100">
                共 <strong className="text-white">{knowledgeList.length}</strong> 条知识，
                审核通过率 <strong className="text-white">{passRate}%</strong>，
                优化 <strong className="text-white">{modifiedCount}</strong> 条
              </p>
            </div>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownload()}
              className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 text-sm font-semibold rounded-xl hover:bg-blue-50 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {downloading
                ? <><i className="ri-loader-4-line animate-spin" />正在生成 Word…</>
                : <><i className="ri-file-word-line" />导出 Word 成果包</>}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-800">萃取成果预览</p>
            <button type="button" onClick={() => setViewMode('list')} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors cursor-pointer">
              <i className="ri-arrow-left-line" />返回继续编辑
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              {knowledgeList.map((item, idx) => {
                const itemRate = getItemPassRate(item);
                const allPass = itemRate === 100;
                return (
                  <div key={item.id} className={`rounded-xl border p-4 transition-all ${allPass ? 'border-blue-100 bg-blue-50/20' : 'border-gray-100 bg-white'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`text-[10px] font-bold w-5 flex-shrink-0 mt-0.5 ${allPass ? 'text-blue-400' : 'text-gray-300'}`}>{String(idx + 1).padStart(2, '0')}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            item.type === '核心知识' || item.type === '方法论' || item.type === '知识点' || item.type === '操作步骤' || item.type === '经验技巧' ? 'bg-amber-100 text-amber-700' :
                            item.type === '配套案例' ? 'bg-indigo-100 text-indigo-700' :
                            item.type === '实操工具' ? 'bg-violet-100 text-violet-700' :
                            'bg-sky-100 text-sky-700'
                          }`}>{item.type}</span>
                          <span className="text-sm font-bold text-gray-800 truncate">{item.title}</span>
                          {item.modified && <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">已编辑</span>}
                          {item.reExtracted && <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">AI已优化</span>}
                        </div>
                        <div className="mt-1">
                          {renderValidationItemBody(item)}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          {item.tags.map(tag => <span key={tag} className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{tag}</span>)}
                          <span className={`ml-auto text-[10px] font-semibold ${allPass ? 'text-blue-600' : 'text-gray-400'}`}>{itemRate}% 通过</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── AI 评估等待页面 ────────────────────────────────────────
  if (validating) {
    return (
      <div className="min-h-[520px] flex flex-col">
        <GenerationProgressScreen
          layout="panel"
          title="正在生成评估结果"
          subtitle={`智能引擎正在对 ${knowledgeList.length} 条知识进行三维度质量评分，请稍候`}
          stepLabels={['解析课题信息', '评估知识准确性', '分析目标对齐', '生成质量报告']}
        />
      </div>
    );
  }

  // ─── 主列表页面 ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 h-full">
      {validateError && (
        <div className="flex items-center gap-2.5 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
          <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0" />
          <span className="text-xs text-red-700">AI评估失败：{validateError}（已使用人工评审模式）</span>
        </div>
      )}
      {validateMock && !validateError && (
        <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5">
          <i className="ri-information-line text-amber-500 text-sm flex-shrink-0" />
          <span className="text-xs text-amber-700">【演示模式】未配置 KE_VALIDATION_API_KEY，当前显示演示评分。导入 ke-05 工作流并配置 Key 后可获取真实 AI 评估。</span>
        </div>
      )}

      {/* 顶部统计栏 */}
      <div className="bg-white rounded-2xl border border-gray-100 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-500 mr-2">评估维度</span>
          {validationRules.map(rule => (
            <div key={rule.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${rule.border} ${rule.bg}`}>
              <i className={`${rule.icon} text-sm ${rule.color}`} />
              <span className={`text-xs font-semibold ${rule.color}`}>{rule.title}</span>
              <span className="text-[10px] text-gray-400 hidden lg:inline">— {rule.desc}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <div className="text-right">
            <p className="text-[10px] text-gray-400">综合通过率</p>
            <p className={`text-lg font-bold leading-tight ${passRate >= 80 ? 'text-blue-600' : passRate >= 60 ? 'text-blue-400' : 'text-gray-400'}`}>{passRate}%</p>
          </div>
          <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${passRate >= 80 ? 'bg-blue-50' : passRate >= 60 ? 'bg-blue-50/60' : 'bg-gray-100'}`}>
            <i className={`ri-shield-check-line text-lg ${passRate >= 80 ? 'text-blue-600' : passRate >= 60 ? 'text-blue-400' : 'text-gray-400'}`} />
          </div>
        </div>
      </div>

      {/* 知识列表 */}
      <div className="bg-gray-50/80 rounded-2xl border border-gray-100 flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-white/80">
          <p className="text-xs text-gray-500">
            共 <strong className="text-gray-700">{knowledgeList.length}</strong> 条知识，
            <span className="text-emerald-600"> {knowledgeList.filter(item => getItemPassRate(item) === 100).length}</span> 条全部通过，
            <span className="text-sky-600"> {modifiedCount}</span> 条已优化
          </p>
          <span className="text-[10px] text-gray-400">点击规则标签切换审核状态</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="space-y-3">
            {knowledgeList.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 flex items-center justify-center bg-gray-100 rounded-2xl mb-3">
                  <i className="ri-inbox-line text-gray-400 text-xl" />
                </div>
                <p className="text-sm text-gray-500">暂无知识条目</p>
                <p className="text-xs text-gray-400 mt-1">请先完成结构化提炼（Step 3）</p>
              </div>
            )}
            {knowledgeList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item, i) => {
              const idx = (page - 1) * PAGE_SIZE + i;
              const itemRate = getItemPassRate(item);
              const isEditing = editingId === item.id;
              const allPass = itemRate === 100;

              return (
                <div key={item.id} className={`rounded-2xl overflow-hidden transition-all duration-200 bg-white border hover:-translate-y-0.5 ${
                  allPass
                    ? 'border-blue-200 [box-shadow:0_4px_20px_-2px_rgba(59,130,246,0.20),0_1px_4px_-1px_rgba(59,130,246,0.10)]'
                    : 'border-gray-200 [box-shadow:0_4px_16px_-2px_rgba(0,0,0,0.08),0_1px_4px_-1px_rgba(0,0,0,0.04)]'
                }`}>
                  <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-0">
                    <span className={`text-[10px] font-bold w-5 flex-shrink-0 ${allPass ? 'text-blue-400' : 'text-gray-300'}`}>{String(idx + 1).padStart(2, '0')}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      item.type === '核心知识' || item.type === '方法论' || item.type === '知识点' || item.type === '操作步骤' || item.type === '经验技巧' ? 'bg-amber-100 text-amber-700' :
                      item.type === '配套案例' ? 'bg-indigo-100 text-indigo-700' :
                      item.type === '实操工具' ? 'bg-violet-100 text-violet-700' :
                      'bg-sky-100 text-sky-700'
                    }`}>{item.type}</span>
                    <span className="text-sm font-bold text-gray-800 flex-1 truncate">{item.title}</span>
                    {item.modified && <span className="text-[10px] text-sky-600 bg-sky-50 border border-sky-100 px-1.5 py-0.5 rounded-full flex-shrink-0">已编辑</span>}
                    {item.reExtracted && <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">AI已优化</span>}
                    {allPass && (
                      <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <CheckCheck className="w-3 h-3" />
                        全部通过
                      </span>
                    )}
                  </div>

                  <div className="px-4 pt-2.5 pb-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <i className="ri-edit-line text-blue-500 text-xs" />
                          <span className="text-[10px] text-blue-600 font-semibold">编辑 2.0 版本内容</span>
                        </div>
                        <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                          className="w-full text-xs text-gray-700 border border-blue-300 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-100 leading-relaxed"
                          rows={10} autoFocus />
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => saveEdit(item.id)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-[10px] font-semibold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap">
                            <i className="ri-check-line" />保存
                          </button>
                          <button type="button" onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 text-[10px] rounded-lg hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap">取消</button>
                        </div>
                      </div>
                    ) : renderValidationItemBody(item)}
                  </div>

                  <div className={`mx-4 h-px ${allPass ? 'bg-blue-100' : 'bg-gray-100'}`} />

                  {!isEditing && (
                    <div className="flex items-center gap-0 px-3 py-2">
                      <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                        {validationRules.map(rule => {
                          const passed = item.validation[rule.id as keyof typeof item.validation];
                          const score = item.aiScores?.[rule.id as keyof typeof item.aiScores];
                          const reason = item.aiReasons?.[rule.id as keyof typeof item.aiReasons];
                          const hasAi = score !== undefined && score !== null;
                          return (
                            <button key={rule.id} type="button"
                              onClick={() => toggleValidation(item.id, rule.id)}
                              title={hasAi ? `${rule.title}：${score}分 — ${reason || rule.desc}（点击手动切换）` : `${rule.title}：${rule.desc}`}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
                                passed ? `${rule.bg} ${rule.border} ${rule.color}` : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'
                              }`}>
                              <div className={`w-3.5 h-3.5 flex items-center justify-center rounded-full flex-shrink-0 ${passed ? `${rule.color} bg-white/60` : 'bg-gray-200 text-gray-400'}`}>
                                <i className={`text-[8px] font-bold ${passed ? 'ri-check-line' : 'ri-close-line'}`} />
                              </div>
                              <span className="text-[10px] font-semibold">{rule.title}</span>
                              {hasAi && (
                                <span className={`text-[9px] font-bold px-1 rounded ${
                                  score >= 80 ? 'text-emerald-700 bg-emerald-100' :
                                  score >= 60 ? 'text-amber-700 bg-amber-100' :
                                  'text-red-700 bg-red-100'
                                }`}>{score}</span>
                              )}
                            </button>
                          );
                        })}
                        {/* 综合分 / 进度条 */}
                        {item.aiScores ? (
                          <div className={`ml-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${
                            allPass ? 'bg-blue-50 border-blue-200' : itemRate >= 60 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
                          }`}>
                            <i className={`ri-bar-chart-2-line text-xs ${allPass ? 'text-blue-500' : itemRate >= 60 ? 'text-amber-500' : 'text-red-500'}`} />
                            <span className={`text-[10px] font-bold ${allPass ? 'text-blue-600' : itemRate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                              综合 {Math.round((item.aiScores.rule1 + item.aiScores.rule2 + item.aiScores.rule3) / 3)}
                            </span>
                          </div>
                        ) : (
                          <div className={`ml-1 flex items-center gap-1.5 px-2 py-1 rounded-lg ${allPass ? 'bg-blue-50' : itemRate >= 60 ? 'bg-blue-50/50' : 'bg-gray-100'}`}>
                            <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${allPass ? 'bg-blue-500' : itemRate >= 60 ? 'bg-blue-300' : 'bg-gray-300'}`} style={{ width: `${itemRate}%` }} />
                            </div>
                            <span className={`text-[10px] font-bold ${allPass ? 'text-blue-600' : itemRate >= 60 ? 'text-blue-400' : 'text-gray-400'}`}>{itemRate}%</span>
                          </div>
                        )}
                        {/* AI 优化建议 */}
                        {item.aiSuggestion && item.aiStatus !== 'pass' && (
                          <div className="w-full mt-1 flex items-start gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                            <i className="ri-lightbulb-line text-amber-500 text-xs flex-shrink-0 mt-0.5" />
                            <span className="text-[10px] text-amber-700 leading-relaxed">{item.aiSuggestion}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0 ml-2 self-start mt-0.5">
                        <button type="button" onClick={() => setVersionPanelItem(item)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="版本对比">
                          <i className="ri-git-merge-line text-xs" />
                        </button>
                        <button type="button" onClick={() => setReExtractItem(item)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-all cursor-pointer" title="AI重新提取">
                          <i className="ri-refresh-line text-xs" />
                        </button>
                        <button type="button" onClick={() => startEdit(item)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="编辑">
                          <i className="ri-edit-line text-xs" />
                        </button>
                        <button type="button" onClick={() => setDeleteItem(item)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer" title="删除">
                          <i className="ri-delete-bin-line text-xs" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {knowledgeList.length > PAGE_SIZE && (
            <KePagination
              total={knowledgeList.length}
              pageSize={PAGE_SIZE}
              current={page}
              onChange={setPage}
              className="border-t border-gray-100 bg-white/80 px-3 mt-2"
            />
          )}
        </div>
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={onPrev} className="flex items-center gap-2 px-4 py-2 text-xs text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap">
          <i className="ri-arrow-left-line" />返回上一步
        </button>
        <button type="button" onClick={finishExtraction}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap bg-gradient-to-r from-blue-500 to-blue-700 text-white hover:from-blue-600 hover:to-blue-800 [box-shadow:0_4px_12px_-2px_rgba(59,130,246,0.40)]">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          完成萃取
        </button>
      </div>

      {/* 弹窗层 */}
      {versionPanelItem && <VersionPanel item={versionPanelItem} onClose={() => setVersionPanelItem(null)} />}
      {reExtractItem && <ReExtractModal item={reExtractItem} sessionId={sessionId} onConfirm={handleReExtractConfirm} onClose={() => setReExtractItem(null)} />}
      {deleteItem && <DeleteConfirm item={deleteItem} onConfirm={() => handleDelete(deleteItem.id)} onClose={() => setDeleteItem(null)} />}
    </div>
  );
};

export default ValidationClosureStep;
