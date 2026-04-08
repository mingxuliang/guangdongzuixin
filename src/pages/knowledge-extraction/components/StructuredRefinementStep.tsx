import { useEffect, useState } from 'react';
import { GenerationProgressScreen } from '@/components/GenerationProgressScreen';
import {
  keGetSession,
  keRunRefine,
  type RefinementResult,
} from '../../../services/knowledgeExtractionApi';
import { pollRefineUntilSettled } from '../utils/longRunningSession';
import { KePagination } from './KePagination';

const PAGE_SIZE = 8;

interface StructuredRefinementStepProps {
  sessionId: string | null;
  onNext: (result: RefinementResult) => void;
  onPrev: () => void;
}

type TabKey = 'core' | 'case' | 'tool' | 'suggest';

const StructuredRefinementStep = ({ sessionId, onNext, onPrev }: StructuredRefinementStepProps) => {
  const [activeTab, setActiveTab] = useState<TabKey>('core');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tabPages, setTabPages] = useState<Record<TabKey, number>>({ core: 1, case: 1, tool: 1, suggest: 1 });
  const setTabPage = (tab: TabKey, p: number) => setTabPages(prev => ({ ...prev, [tab]: p }));
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [result, setResult] = useState<RefinementResult | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const ac = new AbortController();
    const { signal } = ac;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let s = await keGetSession(sessionId);
        if (signal.aborted) return;

        const applyRefine = (sess: typeof s) => {
          const r = sess.refine_result;
          if (r && (r.core_knowledge?.length || r.case_materials?.length)) {
            setResult(r);
            setIsMock(Boolean(sess.refine_error?.startsWith('mock')));
            return true;
          }
          return false;
        };

        if (s.refine_status === 'ready') {
          if (applyRefine(s)) return;
          setError('结构化提炼返回数据为空，请检查工作流配置');
          return;
        }
        if (s.refine_status === 'failed') {
          setError(s.refine_error || '结构化提炼失败');
          return;
        }
        if (s.refine_status === 'running') {
          s = await pollRefineUntilSettled(sessionId, { signal });
          if (signal.aborted) return;
          if (applyRefine(s)) return;
          if (s.refine_status === 'failed') {
            setError(s.refine_error || '结构化提炼失败');
            return;
          }
          if (s.refine_status === 'running') {
            setError(
              '结构化提炼仍在服务端处理中，请稍后点击「重新提炼」或刷新页面；若 Dify 较慢属正常现象。',
            );
            return;
          }
        }

        s = await keRunRefine(sessionId);
        if (signal.aborted) return;
        if (!applyRefine(s)) {
          setError('结构化提炼返回数据为空，请检查工作流配置');
        }
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (msg === 'Aborted') return;
        setError(msg);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [sessionId]);

  const tabs: { key: TabKey; label: string; icon: string; count: number }[] = [
    { key: 'core', label: '核心知识', icon: 'ri-star-line', count: result?.core_knowledge?.length ?? 0 },
    { key: 'case', label: '案例素材', icon: 'ri-file-copy-2-line', count: result?.case_materials?.length ?? 0 },
    { key: 'tool', label: '实操工具', icon: 'ri-tools-line', count: result?.practical_tools?.length ?? 0 },
    { key: 'suggest', label: '优化建议', icon: 'ri-lightbulb-line', count: result?.optimization_suggestions?.length ?? 0 },
  ];

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[520px] flex flex-col">
        <GenerationProgressScreen
          layout="panel"
          title="正在结构化提炼"
          subtitle="AI 正在将知识条目整合为核心知识、案例素材、实操工具、优化建议四层架构，通常需要 30-90 秒"
          stepLabels={['整合知识条目', '提炼核心知识', '梳理案例工具', '生成优化建议']}
        />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="bg-gradient-to-r from-red-500 to-red-600 rounded-2xl p-4 text-white">
          <p className="text-sm font-bold mb-1">结构化提炼</p>
          <p className="text-xs text-red-100">提炼过程遇到问题，请检查配置或重试</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center px-6 max-w-sm">
            <div className="w-14 h-14 flex items-center justify-center bg-red-50 rounded-2xl">
              <i className="ri-error-warning-line text-red-400 text-2xl" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800 mb-2">结构化提炼失败</p>
              <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-xl p-3 text-left">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => { setError(null); setLoading(true); if (sessionId) keRunRefine(sessionId).then(s => { setResult(s.refine_result ?? null); setIsMock(Boolean(s.refine_error?.startsWith('mock'))); }).catch(e => setError(String(e?.message ?? e))).finally(() => setLoading(false)); }}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-refresh-line" />重新提炼
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={onPrev} className="flex items-center gap-2 px-4 py-2 text-xs text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap">
            <i className="ri-arrow-left-line" />返回上一步
          </button>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const coreList = result.core_knowledge ?? [];
  const caseList = result.case_materials ?? [];
  const toolList = result.practical_tools ?? [];
  const suggestList = result.optimization_suggestions ?? [];

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Top info */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-bold">结构化提炼成果</p>
              {isMock && (
                <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full">演示数据</span>
              )}
            </div>
            <p className="text-xs text-blue-200">按「核心知识 - 案例素材 - 实操工具 - 优化建议」四层架构梳理</p>
          </div>
          <div className="flex items-center gap-4">
            {[
              { label: '知识条目', value: String(coreList.length) },
              { label: '案例素材', value: String(caseList.length) },
              { label: '实操工具', value: String(toolList.length) },
            ].map(stat => (
              <div key={stat.label} className="text-center">
                <p className="text-xl font-bold">{stat.value}</p>
                <p className="text-[10px] text-blue-200">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-2xl border border-gray-100 flex-1 overflow-hidden flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-4 pt-3">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap mr-1 ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <i className={`${tab.icon} text-sm`} />
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {activeTab === 'core' && (() => {
            const paged = coreList.slice((tabPages.core - 1) * PAGE_SIZE, tabPages.core * PAGE_SIZE);
            return (
              <>
                <div className="space-y-3">
                  {coreList.length === 0 ? (
                    <div className="text-center py-10 text-xs text-gray-400">暂无核心知识条目</div>
                  ) : paged.map(item => (
                    <div key={item.id} className="border border-gray-100 rounded-xl p-4 hover:border-blue-200 transition-all group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                              {item.type}
                            </span>
                            {(item.tags ?? []).map(tag => (
                              <span key={tag} className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{tag}</span>
                            ))}
                            {item.applicable_when && (
                              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                <i className="ri-map-pin-line mr-0.5" />{item.applicable_when}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-bold text-gray-800 mb-1.5">{item.title}</p>
                          {editingId === item.id ? (
                            <textarea
                              defaultValue={item.content}
                              className="w-full text-xs text-gray-600 border border-blue-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-100"
                              rows={3}
                              onBlur={() => setEditingId(null)}
                              autoFocus
                            />
                          ) : (
                            <>
                              <p className="text-xs text-gray-600 leading-relaxed mb-2">{item.content}</p>
                              {item.method_steps && item.method_steps.length > 0 && (
                                <div className="mt-2 bg-blue-50/60 rounded-xl p-3 border border-blue-100">
                                  <p className="text-[10px] font-bold text-blue-700 mb-1.5 flex items-center gap-1">
                                    <i className="ri-list-ordered text-xs" />操作步骤
                                  </p>
                                  <ol className="space-y-1">
                                    {item.method_steps.map((step, si) => (
                                      <li key={si} className="text-[11px] text-gray-700 leading-relaxed flex gap-1.5">
                                        <span className="font-bold text-blue-500 flex-shrink-0">{si + 1}.</span>
                                        <span>{step.replace(/^第[一二三四五六七]步[:：]?\s*/, '').replace(/^\d+\.\s*/, '')}</span>
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              )}
                              {item.key_principles && item.key_principles.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {item.key_principles.map((p, pi) => (
                                    <span key={pi} className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                                      <i className="ri-key-2-line mr-0.5" />{p}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setEditingId(item.id)}
                            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all cursor-pointer"
                          >
                            <i className="ri-edit-line text-xs" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {coreList.length > PAGE_SIZE && (
                  <KePagination total={coreList.length} pageSize={PAGE_SIZE} current={tabPages.core} onChange={p => setTabPage('core', p)} className="border border-gray-100 rounded-xl bg-gray-50/60 px-3" />
                )}
              </>
            );
          })()}

          {activeTab === 'case' && (() => {
            const paged = caseList.slice((tabPages.case - 1) * PAGE_SIZE, tabPages.case * PAGE_SIZE);
            return (
              <>
                <div className="space-y-3">
                  {caseList.length === 0 ? (
                    <div className="text-center py-10 text-xs text-gray-400">暂无案例素材</div>
                  ) : paged.map(item => (
                    <div key={item.id} className="border border-gray-100 rounded-xl p-4 hover:border-blue-200 transition-all">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 flex items-center justify-center bg-sky-100 rounded-xl flex-shrink-0 mt-0.5">
                          <i className="ri-file-copy-2-line text-sky-600 text-sm" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <p className="text-sm font-bold text-gray-800">{item.title}</p>
                            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">来源：{item.source}</span>
                          </div>
                          {(item.situation || item.task || item.action || item.result) ? (
                            <div className="space-y-1.5 mb-2">
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
                                  <p className="text-[11px] text-gray-600 leading-relaxed">{item.action}</p>
                                </div>
                              )}
                              {item.result && (
                                <div className="flex gap-2">
                                  <span className="text-[9px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded flex-shrink-0 h-fit mt-0.5">成果</span>
                                  <p className="text-[11px] text-gray-600 leading-relaxed">{item.result}</p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-600 leading-relaxed mb-2">{item.content}</p>
                          )}
                          {item.highlight && (
                            <div className="flex items-start gap-1.5 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
                              <i className="ri-lightbulb-line text-amber-500 text-xs flex-shrink-0 mt-0.5" />
                              <span className="text-[10px] text-amber-700 font-medium leading-relaxed">{item.highlight}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {caseList.length > PAGE_SIZE && (
                  <KePagination total={caseList.length} pageSize={PAGE_SIZE} current={tabPages.case} onChange={p => setTabPage('case', p)} className="border border-gray-100 rounded-xl bg-gray-50/60 px-3" />
                )}
              </>
            );
          })()}

          {activeTab === 'tool' && (() => {
            const paged = toolList.slice((tabPages.tool - 1) * PAGE_SIZE, tabPages.tool * PAGE_SIZE);
            return (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {toolList.length === 0 ? (
                    <div className="col-span-3 text-center py-10 text-xs text-gray-400">暂无实操工具</div>
                  ) : paged.map(item => (
                    <div key={item.id} className="border border-gray-100 rounded-xl p-4 hover:border-blue-200 transition-all group col-span-1">
                      <div className="flex items-start gap-3 mb-2">
                        <div className="w-9 h-9 flex items-center justify-center bg-blue-50 rounded-xl flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                          <i className="ri-tools-line text-blue-500 text-sm" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-800 mb-1">{item.title}</p>
                          <span className="text-[10px] text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">{item.format || item.tool_type}</span>
                        </div>
                      </div>
                      {item.tool_content ? (
                        <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100 mb-2">
                          <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{item.tool_content}</p>
                        </div>
                      ) : null}
                      {item.desc && <p className="text-[10px] text-gray-400 leading-relaxed">{item.desc}</p>}
                    </div>
                  ))}
                </div>
                {toolList.length > PAGE_SIZE && (
                  <KePagination total={toolList.length} pageSize={PAGE_SIZE} current={tabPages.tool} onChange={p => setTabPage('tool', p)} className="border border-gray-100 rounded-xl bg-gray-50/60 px-3" />
                )}
              </>
            );
          })()}

          {activeTab === 'suggest' && (() => {
            const paged = suggestList.slice((tabPages.suggest - 1) * PAGE_SIZE, tabPages.suggest * PAGE_SIZE);
            const startIdx = (tabPages.suggest - 1) * PAGE_SIZE;
            return (
              <>
                <div className="space-y-3">
                  {suggestList.length === 0 ? (
                    <div className="text-center py-10 text-xs text-gray-400">暂无优化建议</div>
                  ) : paged.map((item, i) => (
                    <div key={item.id} className="flex items-start gap-3 border border-gray-100 rounded-xl p-4 hover:border-blue-200 transition-all">
                      <div className={`w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0 text-xs font-bold ${
                        item.priority === 'high' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {startIdx + i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-700 leading-relaxed">{item.content}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            item.priority === 'high' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {item.priority === 'high' ? '高优先级' : '中优先级'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {suggestList.length > PAGE_SIZE && (
                  <KePagination total={suggestList.length} pageSize={PAGE_SIZE} current={tabPages.suggest} onChange={p => setTabPage('suggest', p)} className="border border-gray-100 rounded-xl bg-gray-50/60 px-3" />
                )}
              </>
            );
          })()}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          className="flex items-center gap-2 px-4 py-2 text-xs text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-arrow-left-line" />
          返回上一步
        </button>
        <button
          type="button"
          onClick={() => onNext(result)}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap"
        >
          进入校验闭环
          <i className="ri-arrow-right-line" />
        </button>
      </div>
    </div>
  );
};

export default StructuredRefinementStep;
