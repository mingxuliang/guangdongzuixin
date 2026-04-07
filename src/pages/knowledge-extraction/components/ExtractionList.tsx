import { useCallback, useEffect, useState } from 'react';
import { mockExtractions, extractionFilterOptions } from '@/mocks/knowledgeExtraction';
import { isKeApiEnabled, keListSessions } from '@/services/knowledgeExtractionApi';
import ExtractionCard from './ExtractionCard';
import { mapSessionToExtractionCard, type ExtractionCardModel } from '../utils/mapSessionToCard';

interface ExtractionListProps {
  onNew: () => void;
  onOpen: (id: string) => void;
  /** 父级在从工作流返回列表时递增，用于重新拉取会话 */
  refreshKey?: number;
}

const ExtractionList = ({ onNew, onOpen, refreshKey = 0 }: ExtractionListProps) => {
  const useApi = isKeApiEnabled();
  const [activeFilter, setActiveFilter] = useState('全部');
  const [searchVal, setSearchVal] = useState('');
  const [apiRows, setApiRows] = useState<ExtractionCardModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!useApi) {
      setApiRows([]);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { sessions } = await keListSessions();
      setApiRows(sessions.map(mapSessionToExtractionCard));
    } catch (e) {
      setLoadError(String((e as Error)?.message ?? e));
      setApiRows([]);
    } finally {
      setLoading(false);
    }
  }, [useApi]);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshKey]);

  const sourceRows: ExtractionCardModel[] = useApi ? apiRows : (mockExtractions as ExtractionCardModel[]);

  const filtered = sourceRows.filter((e) => {
    const matchFilter = activeFilter === '全部' || e.tag === activeFilter;
    const matchSearch =
      !searchVal ||
      e.title.includes(searchVal) ||
      e.sourceCourse.includes(searchVal) ||
      e.author.includes(searchVal);
    return matchFilter && matchSearch;
  });

  const totalItems = sourceRows.reduce((s, e) => s + e.itemCount, 0);
  const completedCount = sourceRows.filter((e) => e.progress === 100).length;

  return (
    <div className="space-y-5">
      {/* Stats banner */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '萃取记录', value: sourceRows.length, icon: 'ri-filter-3-line', color: 'text-blue-600 bg-blue-50' },
          { label: '知识条目', value: totalItems, icon: 'ri-file-list-3-line', color: 'text-sky-600 bg-sky-50' },
          { label: '已完成', value: completedCount, icon: 'ri-check-double-line', color: 'text-indigo-600 bg-indigo-50' },
          { label: '进行中', value: sourceRows.length - completedCount, icon: 'ri-loader-4-line', color: 'text-cyan-600 bg-cyan-50' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 ${stat.color}`}>
              <i className={`${stat.icon} text-lg`} />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-xs text-gray-400">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full" />
          <h2 className="text-[15px] font-bold text-gray-800">萃取记录</h2>
          <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {filtered.length}
          </span>
          {useApi && loading && (
            <span className="text-[10px] text-blue-500 flex items-center gap-1">
              <i className="ri-loader-4-line animate-spin" />
              同步中
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 py-2 hover:border-blue-300 focus-within:border-blue-400 focus-within:shadow-sm focus-within:shadow-blue-100 transition-all">
            <span className="w-4 h-4 flex items-center justify-center text-gray-400">
              <i className="ri-search-line text-sm" />
            </span>
            <input
              type="text"
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder="搜索萃取记录"
              className="text-sm outline-none bg-transparent text-gray-700 placeholder-gray-400 w-36"
            />
            {searchVal && (
              <button type="button" onClick={() => setSearchVal('')} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <i className="ri-close-line text-sm" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void loadList()}
            className="w-9 h-9 flex items-center justify-center bg-white border border-gray-200 rounded-xl text-gray-500 hover:text-blue-500 hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer"
            title="刷新列表"
          >
            <i className="ri-refresh-line text-base" />
          </button>

          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-xs font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-md shadow-blue-200 cursor-pointer whitespace-nowrap"
          >
            <i className="ri-add-line text-sm" />
            新建萃取
          </button>
        </div>
      </div>

      {loadError && useApi && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
          加载会话列表失败：{loadError}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {['全部', ...extractionFilterOptions].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setActiveFilter(opt)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer flex-shrink-0 ${
              activeFilter === opt
                ? 'bg-blue-500 text-white shadow-md shadow-blue-200'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-16 h-16 flex items-center justify-center bg-blue-50 rounded-2xl mb-4">
            <i className="ri-filter-3-line text-3xl text-blue-300" />
          </div>
          <p className="text-sm font-medium text-gray-500">暂无萃取记录</p>
          <p className="text-xs mt-1 text-gray-400 mb-4">
            {useApi ? '完成一次萃取流程后，将在此显示服务端保存的记录' : '开始你的第一次知识萃取吧~'}
          </p>
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-add-line text-sm" />
            新建萃取
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filtered.map((extraction) => (
            <ExtractionCard key={extraction.id} extraction={extraction} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ExtractionList;
