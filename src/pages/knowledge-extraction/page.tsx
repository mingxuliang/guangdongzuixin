import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardSidebar from '@/pages/dashboard/components/DashboardSidebar';
import ExtractionHeader from './components/ExtractionHeader';
import ExtractionList from './components/ExtractionList';
import SourceAnchorStep from './components/SourceAnchorStep';
import LayeredFilterStep from './components/LayeredFilterStep';
import {
  isKeApiEnabled,
  keGetSession,
  kePatchSession,
  type KnowledgeItem,
  type RefinementResult,
} from '@/services/knowledgeExtractionApi';
import StructuredRefinementStep from './components/StructuredRefinementStep';
import ValidationClosureStep from './components/ValidationClosureStep';

type ViewMode = 'list' | 'workflow';

const KnowledgeExtractionPage = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeStep, setActiveStep] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  /** 从列表进入时递增，驱动 ExtractionList 重新请求 GET /sessions */
  const [listRefresh, setListRefresh] = useState(0);

  const handleNew = () => {
    setActiveStep(0);
    setViewMode('workflow');
    setKeSessionId(null);
    setKeAnchorSummary(null);
    setKeFilterItems(null);
    setKeRefinementResult(null);
  };

  const handleOpen = async (id: string) => {
    if (!isKeApiEnabled()) {
      setActiveStep(0);
      setViewMode('workflow');
      setKeSessionId(null);
      setKeAnchorSummary(null);
      setKeFilterItems(null);
      setKeRefinementResult(null);
      return;
    }
    try {
      const s = await keGetSession(id);
      setKeSessionId(s.id);
      const summary = s.anchor_package?.anchor_summary;
      setKeAnchorSummary(typeof summary === 'string' ? summary : null);
      setKeFilterItems(s.filter_items ?? null);
      setKeRefinementResult(s.refine_result ?? null);
      let step = 0;
      if (!s.anchor_package) step = 0;
      else if (s.filter_status !== 'ready' || !(s.filter_items?.length)) step = 1;
      else if (s.refine_status !== 'ready' || !s.refine_result) step = 2;
      else step = 3;
      setActiveStep(step);
      setViewMode('workflow');
    } catch {
      setActiveStep(0);
      setViewMode('workflow');
      setKeSessionId(null);
      setKeAnchorSummary(null);
      setKeFilterItems(null);
      setKeRefinementResult(null);
    }
  };

  const handleBackToList = () => {
    setViewMode('list');
    setActiveStep(0);
    setListRefresh((k) => k + 1);
  };

  const [keSessionId, setKeSessionId] = useState<string | null>(null);
  const [keAnchorSummary, setKeAnchorSummary] = useState<string | null>(null);
  const [keFilterItems, setKeFilterItems] = useState<KnowledgeItem[] | null>(null);
  const [keRefinementResult, setKeRefinementResult] = useState<RefinementResult | null>(null);

  const handleNext = () => setActiveStep(prev => Math.min(prev + 1, 3));
  const handlePrev = () => setActiveStep(prev => Math.max(prev - 1, 0));

  const handleAnchorStepNext = (payload?: { sessionId: string; anchorSummary?: string }) => {
    if (payload?.sessionId) setKeSessionId(payload.sessionId);
    if (payload?.anchorSummary) setKeAnchorSummary(payload.anchorSummary);
    handleNext();
  };

  return (
    <div className="flex min-h-screen bg-[#f0f4fa]">
      <DashboardSidebar />

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-lg border-b border-gray-100 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {viewMode === 'workflow' && (
              <button
                type="button"
                onClick={handleBackToList}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all cursor-pointer"
              >
                <i className="ri-arrow-left-line text-sm" />
              </button>
            )}
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <span
                className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
                onClick={() => navigate('/ai-course')}
              >
                首页
              </span>
              <i className="ri-arrow-right-s-line" />
              {viewMode === 'workflow' ? (
                <>
                  <span
                    className="text-gray-400 hover:text-blue-500 cursor-pointer transition-colors"
                    onClick={handleBackToList}
                  >
                    知识萃取
                  </span>
                  <i className="ri-arrow-right-s-line" />
                  <span className="text-gray-700 font-semibold">新建萃取</span>
                </>
              ) : (
                <span className="text-gray-700 font-semibold">知识萃取</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'workflow' && (
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-save-line text-sm" />
                保存草稿
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative w-9 h-9 flex items-center justify-center bg-white border border-gray-200 rounded-xl text-gray-500 hover:text-blue-500 hover:border-blue-200 hover:bg-blue-50 transition-all cursor-pointer"
              >
                <i className="ri-notification-3-line text-base" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full border border-white" />
              </button>
              {notifOpen && (
                <div className="absolute top-12 right-0 w-64 bg-white rounded-2xl border border-gray-100 z-30 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <span className="text-sm font-bold text-gray-800">通知</span>
                  </div>
                  <div className="px-4 py-3 text-xs text-gray-500">暂无新通知</div>
                </div>
              )}
            </div>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center cursor-pointer shadow-md shadow-blue-200">
              <span className="text-white text-xs font-bold">刘</span>
            </div>
          </div>
        </header>

        {/* Workflow step header — only in workflow mode */}
        {viewMode === 'workflow' && (
          <ExtractionHeader activeStep={activeStep} onStepChange={setActiveStep} />
        )}

        {/* Page body */}
        <div className="flex-1 overflow-y-auto p-5">
          {viewMode === 'list' && (
            <ExtractionList onNew={handleNew} onOpen={handleOpen} refreshKey={listRefresh} />
          )}
          {viewMode === 'workflow' && activeStep === 0 && <SourceAnchorStep onNext={handleAnchorStepNext} />}
          {viewMode === 'workflow' && activeStep === 1 && (
            <div className="space-y-4">
              {keAnchorSummary && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-900">
                  <p className="font-bold text-emerald-800 mb-1">源头锚定摘要</p>
                  <p className="leading-relaxed text-emerald-900/90 whitespace-pre-wrap">{keAnchorSummary}</p>
                  {keSessionId && (
                    <p className="mt-2 text-[10px] text-emerald-700/80">会话 ID：{keSessionId}</p>
                  )}
                </div>
              )}
              <LayeredFilterStep
                sessionId={keSessionId}
                onNext={(items) => { if (items) setKeFilterItems(items); handleNext(); }}
                onPrev={handlePrev}
              />
            </div>
          )}
          {viewMode === 'workflow' && activeStep === 2 && (
            <StructuredRefinementStep
              sessionId={keSessionId}
              onNext={(result) => { setKeRefinementResult(result); handleNext(); }}
              onPrev={handlePrev}
            />
          )}
          {viewMode === 'workflow' && activeStep === 3 && (
            <ValidationClosureStep
              sessionId={keSessionId}
              refinementResult={keRefinementResult}
              onPrev={handlePrev}
              onComplete={async () => {
                if (keSessionId) {
                  try {
                    await kePatchSession(keSessionId, { extraction_completed: true });
                  } catch {
                    /* 仍刷新列表，展示当前服务端进度 */
                  }
                }
                setListRefresh((k) => k + 1);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default KnowledgeExtractionPage;
