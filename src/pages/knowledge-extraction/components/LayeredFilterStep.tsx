import { useState, useCallback, useEffect } from 'react';
import { GenerationProgressScreen } from '@/components/GenerationProgressScreen';
import { keGetSession, keRunFilter, type KnowledgeItem } from '@/services/knowledgeExtractionApi';
import { recoverFilterItemsFromKRaw } from '../utils/recoverFilterItems';
import { pollFilterUntilSettled } from '../utils/longRunningSession';
import { KePagination } from './KePagination';

const PAGE_SIZE = 10;

interface LayeredFilterStepProps {
  sessionId: string | null;
  onNext: (items?: KnowledgeItem[]) => void;
  onPrev: () => void;
}

const typeConfig: Record<string, { label: string; color: string; bg: string }> = {
  explicit: { label: '显性知识', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  tacit:    { label: '隐性知识', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
  practice: { label: '优秀实践', color: 'text-sky-700', bg: 'bg-sky-50 border-sky-200' },
};

const priorityConfig: Record<string, { label: string; dot: string }> = {
  high:   { label: '高优先', dot: 'bg-blue-500' },
  medium: { label: '中优先', dot: 'bg-sky-400' },
  low:    { label: '低优先', dot: 'bg-gray-300' },
};

const LayeredFilterStep = ({ sessionId, onNext, onPrev }: LayeredFilterStepProps) => {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    const { signal } = ac;

    const applySession = (s: { filter_items?: KnowledgeItem[]; filter_error?: string | null }) => {
      const raw = recoverFilterItemsFromKRaw(s.filter_items ?? []);
      setItems(raw);
      setIsMock(Boolean(s.filter_error?.startsWith('mock:')));
    };

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let s = await keGetSession(sessionId);
        if (signal.aborted) return;
        if (s.filter_status === 'ready' && Array.isArray(s.filter_items)) {
          applySession(s);
          return;
        }
        if (s.filter_status === 'failed') {
          setError(s.filter_error || '分层筛选失败');
          return;
        }
        if (s.filter_status === 'running') {
          s = await pollFilterUntilSettled(sessionId, { signal });
          if (signal.aborted) return;
          if (s.filter_status === 'ready' && Array.isArray(s.filter_items)) {
            applySession(s);
            return;
          }
          if (s.filter_status === 'failed') {
            setError(s.filter_error || '分层筛选失败');
            return;
          }
          if (s.filter_status === 'running') {
            setError(
              '分层筛选仍在服务端处理中，请稍后点击「重新分析」或刷新页面；若 Dify 较慢属正常现象。',
            );
            return;
          }
        }
        s = await keRunFilter(sessionId);
        if (signal.aborted) return;
        applySession(s);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'Aborted') return;
        setError(msg);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [sessionId]);

  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleItem = (id: string) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, selected: !i.selected } : i));

  const filtered = items.filter(item => {
    if (filterType !== 'all' && item.type !== filterType) return false;
    if (filterPriority !== 'all' && item.priority !== filterPriority) return false;
    return true;
  });

  // 筛选条件变化时重置到第 1 页
  useEffect(() => { setPage(1); }, [filterType, filterPriority]);

  const pagedItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selectedCount  = items.filter(i => i.selected).length;
  const explicitCount  = items.filter(i => i.type === 'explicit' && i.selected).length;
  const tacitCount     = items.filter(i => i.type === 'tacit'    && i.selected).length;
  const practiceCount  = items.filter(i => i.type === 'practice' && i.selected).length;

  if (!sessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 px-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 max-w-lg text-center">
          <p className="font-bold mb-1">暂无萃取会话</p>
          <p className="text-xs leading-relaxed">
            请返回「源头锚定」填写信息并点击「开始分层筛选」；勿仅通过顶部步骤条跳转，否则无法关联会话与音频转写。
          </p>
        </div>
        <button
          type="button"
          onClick={onPrev}
          className="px-4 py-2 text-xs text-white bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors cursor-pointer"
        >
          返回源头锚定
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[520px] flex flex-col">
        <GenerationProgressScreen
          layout="panel"
          title="正在进行分层筛选"
          subtitle="AI 正在解析知识条目并按显性、隐性、优秀实践分层，首次分析约 1-3 分钟"
          stepLabels={['分析知识材料', '识别显隐知识', '划分优先级', '生成筛选列表']}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700 max-w-lg text-center">
          <p className="font-bold mb-1">分层筛选失败</p>
          <p className="text-xs leading-relaxed">{error}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onPrev}
            className="px-4 py-2 text-xs text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
          >
            返回上一步
          </button>
          <button
            type="button"
            onClick={() => {
              if (!sessionId) return;
              setError(null);
              setLoading(true);
              keRunFilter(sessionId)
                .then(s => { setItems(recoverFilterItemsFromKRaw(s.filter_items ?? [])); })
                .catch(e => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setLoading(false));
            }}
            className="px-4 py-2 text-xs text-white bg-blue-500 rounded-xl hover:bg-blue-600 transition-colors cursor-pointer"
          >
            重新分析
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-5 h-full">
      {/* Left: stats + filters */}
      <div className="w-[220px] flex-shrink-0 space-y-3">
        {isMock && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700 leading-relaxed">
            演示数据。配置 <code className="font-mono">KE_FILTER_API_KEY</code> 并导入 ke-02 工作流后可获取真实结果。
          </div>
        )}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-bold text-gray-700 mb-3">筛选统计</p>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">已选内容</span>
              <span className="text-sm font-bold text-blue-600">{selectedCount}</span>
            </div>
            <div className="h-px bg-gray-100" />
            {[
              { label: '显性知识', count: explicitCount, dot: 'bg-blue-500' },
              { label: '隐性知识', count: tacitCount, dot: 'bg-indigo-500' },
              { label: '优秀实践', count: practiceCount, dot: 'bg-sky-400' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${row.dot}`} />
                  <span className="text-xs text-gray-500">{row.label}</span>
                </div>
                <span className="text-xs font-semibold text-gray-700">{row.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-bold text-gray-700 mb-3">筛选条件</p>
          <div className="space-y-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">知识类型</p>
            {[
              { value: 'all', label: '全部' },
              { value: 'explicit', label: '显性知识' },
              { value: 'tacit', label: '隐性知识' },
              { value: 'practice', label: '优秀实践' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilterType(opt.value)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                  filterType === opt.value ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">优先级</p>
            {[
              { value: 'all', label: '全部' },
              { value: 'high', label: '高优先' },
              { value: 'medium', label: '中优先' },
              { value: 'low', label: '低优先' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilterPriority(opt.value)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                  filterPriority === opt.value ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: knowledge list */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex-1">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <i className="ri-filter-3-line text-blue-500 text-sm" />
              <span className="text-xs font-bold text-gray-800">知识内容筛选</span>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{filtered.length} 条</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setItems(prev => prev.map(i => ({ ...i, selected: true })))}
                className="text-[10px] text-blue-500 hover:underline cursor-pointer whitespace-nowrap"
              >全选</button>
              <span className="text-gray-200">|</span>
              <button
                type="button"
                onClick={() => setItems(prev => prev.map(i => ({ ...i, selected: false })))}
                className="text-[10px] text-gray-400 hover:underline cursor-pointer whitespace-nowrap"
              >清空</button>
            </div>
          </div>

          <div className="p-3 space-y-2 overflow-y-auto max-h-[calc(100vh-420px)]">
            {filtered.length === 0 && (
              <div className="py-16 text-center text-xs text-gray-400">
                暂无符合条件的知识条目
              </div>
            )}
            {pagedItems.map(item => {
              const tc = typeConfig[item.type] ?? typeConfig.explicit;
              const pc = priorityConfig[item.priority] ?? priorityConfig.medium;
              return (
                <div
                  key={item.id}
                  className={`border rounded-xl p-3 transition-all cursor-pointer ${
                    item.selected ? 'border-blue-200 bg-blue-50/40' : 'border-gray-100 hover:border-gray-200 bg-white'
                  }`}
                  onClick={() => toggleItem(item.id)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-4 h-4 flex items-center justify-center rounded border flex-shrink-0 mt-0.5 transition-all ${
                      item.selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                    }`}>
                      {item.selected && <i className="ri-check-line text-white text-[10px]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tc.bg} ${tc.color}`}>
                          {tc.label}
                        </span>
                        {item.knowledge_form && (
                          <span className="text-[10px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-100">
                            {item.knowledge_form}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          {item.category}
                        </span>
                        <div className="flex items-center gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${pc.dot}`} />
                          <span className="text-[10px] text-gray-400">{pc.label}</span>
                        </div>
                        {item.reusable && (
                          <span className="text-[10px] text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">
                            可复用
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-gray-800 mb-1">{item.title}</p>
                      <div>
                        <p className={`text-[11px] text-gray-500 leading-relaxed break-all ${
                          expandedIds.has(item.id) ? '' : 'line-clamp-2'
                        }`}>
                          {item.content}
                        </p>
                        {item.content.length > 60 && (
                          <button
                            type="button"
                            onClick={e => toggleExpand(item.id, e)}
                            className="mt-0.5 text-[10px] text-blue-500 hover:text-blue-700 cursor-pointer whitespace-nowrap"
                          >
                            {expandedIds.has(item.id)
                              ? <><i className="ri-arrow-up-s-line" /> 收起</>
                              : <><i className="ri-arrow-down-s-line" /> 展开全文</>}
                          </button>
                        )}
                      </div>
                      {expandedIds.has(item.id) && item.structured_body && (
                        <div className="mt-2 bg-blue-50/50 rounded-xl p-2.5 border border-blue-100">
                          <p className="text-[9px] font-bold text-blue-600 mb-1 uppercase tracking-wider">结构化内容</p>
                          <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{item.structured_body}</p>
                        </div>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        <i className="ri-file-line mr-1" />
                        来源：{item.source}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {filtered.length > PAGE_SIZE && (
          <KePagination
            total={filtered.length}
            pageSize={PAGE_SIZE}
            current={page}
            onChange={setPage}
            className="border border-gray-100 rounded-xl bg-white px-3"
          />
        )}

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
            disabled={selectedCount === 0}
            onClick={() => onNext(items.filter(i => i.selected))}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            进入结构化提炼
            <i className="ri-arrow-right-line" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default LayeredFilterStep;
