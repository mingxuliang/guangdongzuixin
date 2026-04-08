import { useState, useEffect } from 'react';

interface KePaginationProps {
  total: number;
  pageSize?: number;
  current: number;
  onChange: (page: number) => void;
  className?: string;
}

/**
 * 知识萃取步骤通用分页条
 * 显示：上一页 · 页码（含省略） · 下一页 · 每页条数显示 · 跳转输入框
 */
export function KePagination({
  total,
  pageSize = 10,
  current,
  onChange,
  className = '',
}: KePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [jumpVal, setJumpVal] = useState('');

  // 切换 tab 或 total 变化时保证不超界
  useEffect(() => {
    if (current > totalPages) onChange(1);
  }, [totalPages, current, onChange]);

  if (total === 0) return null;

  const goTo = (p: number) => {
    const clamped = Math.max(1, Math.min(p, totalPages));
    if (clamped !== current) onChange(clamped);
  };

  const handleJump = () => {
    const n = parseInt(jumpVal, 10);
    if (!isNaN(n)) goTo(n);
    setJumpVal('');
  };

  // 生成页码数组，超过 7 页则使用省略号
  const pageNumbers = (): (number | '...')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '...', totalPages];
    if (current >= totalPages - 3) return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', current - 1, current, current + 1, '...', totalPages];
  };

  const btnBase =
    'h-7 min-w-[28px] px-1.5 flex items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer select-none';
  const activeBtn = 'bg-blue-500 text-white shadow-sm shadow-blue-500/30';
  const normalBtn = 'text-gray-500 hover:bg-blue-50 hover:text-blue-600';
  const disabledBtn = 'text-gray-200 cursor-not-allowed';

  return (
    <div className={`flex items-center justify-between gap-3 px-1 py-2 ${className}`}>
      {/* 左侧：总条数 */}
      <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">
        共 <span className="font-semibold text-gray-600">{total}</span> 条
        &nbsp;·&nbsp;第 <span className="font-semibold text-gray-600">{current}</span> / {totalPages} 页
      </span>

      {/* 中间：页码 */}
      <div className="flex items-center gap-1 flex-wrap justify-center">
        {/* 上一页 */}
        <button
          type="button"
          disabled={current === 1}
          onClick={() => goTo(current - 1)}
          className={`${btnBase} ${current === 1 ? disabledBtn : normalBtn}`}
          title="上一页"
        >
          <i className="ri-arrow-left-s-line text-sm" />
        </button>

        {pageNumbers().map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="h-7 w-6 flex items-center justify-center text-xs text-gray-300">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => goTo(p as number)}
              className={`${btnBase} ${p === current ? activeBtn : normalBtn}`}
            >
              {p}
            </button>
          )
        )}

        {/* 下一页 */}
        <button
          type="button"
          disabled={current === totalPages}
          onClick={() => goTo(current + 1)}
          className={`${btnBase} ${current === totalPages ? disabledBtn : normalBtn}`}
          title="下一页"
        >
          <i className="ri-arrow-right-s-line text-sm" />
        </button>
      </div>

      {/* 右侧：跳转 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[11px] text-gray-400">跳至</span>
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jumpVal}
          onChange={e => setJumpVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleJump()}
          className="w-12 h-7 text-xs text-center text-gray-600 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
          placeholder={String(current)}
        />
        <button
          type="button"
          onClick={handleJump}
          className="h-7 px-2.5 text-xs text-blue-500 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer whitespace-nowrap"
        >
          跳转
        </button>
      </div>
    </div>
  );
}
