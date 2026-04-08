import { useState, useRef, useEffect, useCallback } from 'react';

import { GenerationProgressScreen } from '@/components/GenerationProgressScreen';
import {
  isKeApiEnabled,
  keCreateSession,
  keGetSession,
  kePatchSession,
  keRunAnchor,
  keUploadAsset,
} from '@/services/knowledgeExtractionApi';

interface SourceAnchorStepProps {
  onNext: (payload?: { sessionId: string; anchorSummary?: string }) => void;
  /** 会话创建或加载成功后立刻回调，便于父组件同步 sessionId（避免仅点顶部步骤条时第二步无会话） */
  onSessionReady?: (sessionId: string) => void;
  /** 从列表打开或从后续步骤回到 Step1 时传入，复用该会话并回填表单 */
  resumeSessionId?: string | null;
}

type LocalFileRow = {
  id: string;
  name: string;
  size: string;
  type: 'ppt' | 'word' | 'audio' | 'pdf' | 'other';
  serverAssetId?: string;
  uploading?: boolean;
  audioPending?: boolean; // 音频已上传但待转写
  error?: string;
};

const courseOptions = [
  { id: 'c1', title: '《最佳实践萃取》', tag: '材料快课制课', progress: 45, hasOutline: true, hasPPT: true, hasScript: true },
  { id: 'c2', title: '《数字化课程智能提取与课程生成》', tag: '材料快课制课', progress: 70, hasOutline: true, hasPPT: true, hasScript: false },
  { id: 'c3', title: '《如何划分职业发展通道》', tag: '系列丛书开发', progress: 20, hasOutline: true, hasPPT: false, hasScript: false },
  { id: 'c4', title: '《员工绩效管理与激励机制》', tag: '内训师课程开发', progress: 85, hasOutline: true, hasPPT: true, hasScript: true },
  { id: 'c5', title: '《销售技巧与客户关系管理》', tag: '自由心意剧课', progress: 60, hasOutline: true, hasPPT: true, hasScript: false },
  { id: 'c6', title: '《组织文化建设与变革管理》', tag: 'PPT转视频课', progress: 35, hasOutline: true, hasPPT: false, hasScript: false },
  { id: 'c7', title: '《高效团队建设与协作》', tag: '材料快课制课', progress: 90, hasOutline: true, hasPPT: true, hasScript: true },
  { id: 'c8', title: '《领导力发展与人才培养》', tag: '内训师课程开发', progress: 55, hasOutline: true, hasPPT: true, hasScript: false },
  { id: 'c9', title: '《创新思维与问题解决》', tag: '系列丛书开发', progress: 40, hasOutline: true, hasPPT: false, hasScript: false },
  { id: 'c10', title: '《跨部门沟通与协作》', tag: '自由心意剧课', progress: 75, hasOutline: true, hasPPT: true, hasScript: true },
  { id: 'c11', title: '《时间管理与工作效率提升》', tag: 'PPT转视频课', progress: 30, hasOutline: true, hasPPT: true, hasScript: false },
  { id: 'c12', title: '《情绪管理与压力调适》', tag: '材料快课制课', progress: 65, hasOutline: true, hasPPT: true, hasScript: true },
];

interface UploadedFile {
  id: string;
  name: string;
  size: string;
  type: 'ppt' | 'word' | 'audio' | 'pdf' | 'other';
  status: 'done' | 'uploading';
}

const getFileType = (name: string): UploadedFile['type'] => {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['ppt', 'pptx'].includes(ext)) return 'ppt';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return 'other';
};

const fileTypeConfig: Record<UploadedFile['type'], { icon: string; color: string; bg: string; label: string }> = {
  ppt: { icon: 'ri-slideshow-3-line', color: 'text-orange-500', bg: 'bg-orange-50', label: 'PPT课件' },
  word: { icon: 'ri-file-word-line', color: 'text-blue-500', bg: 'bg-blue-50', label: 'Word文档' },
  audio: { icon: 'ri-mic-line', color: 'text-indigo-500', bg: 'bg-indigo-50', label: '音频文件' },
  pdf: { icon: 'ri-file-pdf-line', color: 'text-red-500', bg: 'bg-red-50', label: 'PDF文档' },
  other: { icon: 'ri-file-line', color: 'text-gray-500', bg: 'bg-gray-50', label: '其他文件' },
};

function newLocalRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const scenes = [
  { id: 'knowledge-base', label: '企业知识库' },
  { id: 'onboarding', label: '新人带教' },
  { id: 'retraining', label: '复训场景' },
  { id: 'micro-course', label: '微课转化' },
  { id: 'job-aid', label: '岗位工具包' },
];

const materialItems = [
  {
    key: 'outline' as const,
    label: '三级大纲',
    desc: '课程结构与知识点框架',
    icon: 'ri-list-ordered',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    hasKey: 'hasOutline' as const,
  },
  {
    key: 'ppt' as const,
    label: 'PPT 课件',
    desc: '授课幻灯片与图文内容',
    icon: 'ri-slideshow-3-line',
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-500',
    hasKey: 'hasPPT' as const,
  },
  {
    key: 'script' as const,
    label: '讲稿 Word 文档',
    desc: '讲师授课文字稿',
    icon: 'ri-file-word-line',
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-500',
    hasKey: 'hasScript' as const,
  },
];

const SourceAnchorStep = ({ onNext, onSessionReady, resumeSessionId }: SourceAnchorStepProps) => {
  const useApi = isKeApiEnabled();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInitError, setSessionInitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [mode, setMode] = useState<'course' | 'manual'>('course');

  // Course mode
  const [selectedCourse, setSelectedCourse] = useState('c1');
  const [courseSearch, setCourseSearch] = useState('');
  const [checkedMaterials, setCheckedMaterials] = useState<Record<string, boolean>>({
    outline: true, ppt: true, script: true,
  });
  const [courseAudioFiles, setCourseAudioFiles] = useState<LocalFileRow[]>([]);
  const courseAudioRef = useRef<HTMLInputElement>(null);

  // Manual mode
  const [manualFiles, setManualFiles] = useState<LocalFileRow[]>([]);
  const manualFileRef = useRef<HTMLInputElement>(null);

  // Common
  const [projectName, setProjectName] = useState('');
  const [extractGoal, setExtractGoal] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [useScene, setUseScene] = useState<string[]>(['knowledge-base']);

  useEffect(() => {
    if (!useApi) return;
    let cancelled = false;

    if (resumeSessionId) {
      (async () => {
        try {
          const s = await keGetSession(resumeSessionId);
          if (cancelled) return;
          setSessionId(s.id);
          onSessionReady?.(s.id);
          setProjectName(typeof s.project_name === 'string' ? s.project_name : '');
          setExtractGoal(s.extract_goal ?? '');
          setTargetAudience(s.target_audience ?? '');
          if (Array.isArray(s.use_scenes) && s.use_scenes.length) setUseScene(s.use_scenes);
          if (s.mode === 'course' || s.mode === 'manual') setMode(s.mode);
          if (s.course_id && courseOptions.some((c) => c.id === s.course_id)) {
            setSelectedCourse(s.course_id);
          }
          const ms = s.material_selection;
          if (ms && typeof ms === 'object') {
            setCheckedMaterials({
              outline: Boolean(ms.outline),
              ppt: Boolean(ms.ppt),
              script: Boolean(ms.script),
            });
          }
        } catch (e) {
          if (!cancelled) setSessionInitError(e instanceof Error ? e.message : String(e));
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const s = await keCreateSession({
          mode: 'course',
          use_scenes: ['knowledge-base'],
          material_selection: { outline: true, ppt: true, script: true },
        });
        if (!cancelled) {
          setSessionId(s.id);
          onSessionReady?.(s.id);
        }
      } catch (e) {
        if (!cancelled) setSessionInitError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useApi, resumeSessionId, onSessionReady]);

  useEffect(() => {
    if (!useApi || !sessionId) return;
    kePatchSession(sessionId, { mode }).catch(() => {});
  }, [mode, sessionId, useApi]);

  const uploadToSession = useCallback(
    async (file: File, kind: string) => {
      if (!sessionId) return null;
      return keUploadAsset(sessionId, file, kind);
    },
    [sessionId]
  );

  const filteredCourses = courseOptions.filter(c =>
    c.title.includes(courseSearch) || c.tag.includes(courseSearch)
  );
  const selectedCourseData = courseOptions.find(c => c.id === selectedCourse);

  const toggleScene = (scene: string) => {
    setUseScene(prev =>
      prev.includes(scene) ? prev.filter(s => s !== scene) : [...prev, scene]
    );
  };

  const toggleMaterial = (key: string) => {
    setCheckedMaterials(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const addLocalRowsAndMaybeUpload = async (
    files: File[],
    kind: 'manual_upload' | 'audio_supplement',
    setter: React.Dispatch<React.SetStateAction<LocalFileRow[]>>
  ) => {
    if (files.length === 0) return;

    const rows: LocalFileRow[] = files.map((file) => ({
      id: newLocalRowId(),
      name: file.name,
      size: formatSize(file.size),
      type: getFileType(file.name),
      uploading: useApi,
    }));

    // 一次批量插入，避免多文件时连续 setState 与列表 key 抖动（降低 React reconcile 异常概率）
    setter((prev) => [...prev, ...rows]);

    if (!useApi) {
      setter((prev) =>
        prev.map((r) => (rows.some((x) => x.id === r.id) ? { ...r, uploading: false } : r)),
      );
      return;
    }
    if (!sessionId) {
      setter((prev) =>
        prev.map((r) =>
          rows.some((x) => x.id === r.id)
            ? { ...r, uploading: false, error: '会话未就绪，请稍后重试' }
            : r,
        ),
      );
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = rows[i].id;
      try {
        const result = await uploadToSession(file, kind);
        if (!result) throw new Error('上传响应为空');
        const isAudioPending = Boolean(result.audio_pending);
        setter((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  serverAssetId: result.id,
                  uploading: false,
                  audioPending: isAudioPending,
                  error: undefined,
                }
              : r,
          ),
        );
      } catch (err) {
        setter((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, uploading: false, error: err instanceof Error ? err.message : String(err) }
              : r,
          ),
        );
      }
    }
  };

  const handleCourseAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void addLocalRowsAndMaybeUpload(files, 'audio_supplement', setCourseAudioFiles);
    e.target.value = '';
  };

  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void addLocalRowsAndMaybeUpload(files, 'manual_upload', setManualFiles);
    e.target.value = '';
  };

  const handleManualDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    void addLocalRowsAndMaybeUpload(files, 'manual_upload', setManualFiles);
  };

  const removeManualFile = (id: string) => setManualFiles(prev => prev.filter(f => f.id !== id));
  const removeCourseAudio = (id: string) => setCourseAudioFiles(prev => prev.filter(f => f.id !== id));

  const handleSubmitNext = async () => {
    setSubmitError(null);
    if (!extractGoal.trim()) {
      setSubmitError('请填写萃取目标');
      return;
    }
    if (!useApi) {
      onNext();
      return;
    }
    if (!sessionId) {
      setSubmitError('会话未就绪，请确认已启动本地 API（见 .env.example）');
      return;
    }
    if (mode === 'manual') {
      if (manualFiles.length === 0) {
        setSubmitError('手动模式请至少上传一个文件');
        return;
      }
      if (manualFiles.some(f => f.uploading)) {
        setSubmitError('请等待文件上传完成');
        return;
      }
      if (manualFiles.some(f => f.error)) {
        setSubmitError('存在上传失败的文件，请删除后重新上传');
        return;
      }
      // 音频文件会标记为 audioPending，视为上传成功；只有非音频文件需要 serverAssetId
      if (!manualFiles.every(f => f.serverAssetId || f.audioPending)) {
        setSubmitError('请等待全部文件上传成功');
        return;
      }
    }

    const course = courseOptions.find(c => c.id === selectedCourse);
    setSubmitting(true);
    try {
      await kePatchSession(sessionId, {
        mode,
        course_id: selectedCourse,
        course_title: course?.title ?? null,
        material_selection: {
          outline: Boolean(checkedMaterials.outline),
          ppt: Boolean(checkedMaterials.ppt),
          script: Boolean(checkedMaterials.script),
        },
        project_name: projectName.trim(),
        extract_goal: extractGoal,
        target_audience: targetAudience,
        use_scenes: useScene,
      });
      const s = await keRunAnchor(sessionId);
      const pkg = s.anchor_package as { anchor_summary?: string } | null;
      onNext({
        sessionId,
        anchorSummary: typeof pkg?.anchor_summary === 'string' ? pkg.anchor_summary : undefined,
      });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const apiBusy = useApi && !sessionId;
  const nextDisabled = submitting || apiBusy || Boolean(sessionInitError);

  const hasAudioPending =
    courseAudioFiles.some((f) => f.audioPending) || manualFiles.some((f) => f.audioPending);

  if (submitting) {
    const anchorSteps = hasAudioPending
      ? ['转写音频文件', '解析文档内容', '锚定知识主题', '生成锚定摘要']
      : ['解析文档内容', '识别知识主题', '锚定关键节点', '生成锚定摘要'];

    return (
      <div className="min-h-[520px] flex flex-col">
        <GenerationProgressScreen
          layout="panel"
          title={hasAudioPending ? '正在转写音频 + 锚定分析' : '正在锚定知识源头'}
          subtitle={
            hasAudioPending
              ? '音频转写需要一点时间，智能引擎正在逐步处理，请耐心等候…'
              : '智能引擎正在解析资料并提炼核心知识主题，请稍候片刻'
          }
          stepLabels={anchorSteps}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {useApi && sessionInitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          无法连接萃取 API：{sessionInitError}。请在本机同时运行后端（npm run server）并配置 VITE_API_BASE=/api。
        </div>
      )}
      {useApi && !sessionId && !sessionInitError && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
          正在初始化萃取会话…
        </div>
      )}
      {submitError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">{submitError}</div>
      )}
      {/* Mode switcher */}
      <div className="bg-white rounded-2xl border border-gray-100 p-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => setMode('course')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
            mode === 'course'
              ? 'bg-blue-500 text-white'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <div className="w-5 h-5 flex items-center justify-center">
            <i className={`ri-links-line text-base ${mode === 'course' ? 'text-white' : 'text-gray-400'}`} />
          </div>
          关联课程（自动获取资料）
        </button>
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
            mode === 'manual'
              ? 'bg-blue-500 text-white'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <div className="w-5 h-5 flex items-center justify-center">
            <i className={`ri-upload-cloud-2-line text-base ${mode === 'manual' ? 'text-white' : 'text-gray-400'}`} />
          </div>
          手动上传（自定义数据源）
        </button>
      </div>

      {mode === 'course' ? (
        /* ── Course mode: two-column linked layout ── */
        <div className="flex gap-4">
          {/* Left: course list */}
          <div className="w-[300px] flex-shrink-0 bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <div className="w-5 h-5 flex items-center justify-center">
                <i className="ri-book-open-line text-blue-500 text-sm" />
              </div>
              <span className="text-xs font-bold text-gray-800">选择关联课程</span>
              <span className="ml-auto text-[10px] text-gray-400">{filteredCourses.length} 门</span>
            </div>
            <div className="px-3 pt-2.5 pb-2 flex-shrink-0">
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <i className="ri-search-line text-gray-400 text-xs" />
                <input
                  type="text"
                  value={courseSearch}
                  onChange={e => setCourseSearch(e.target.value)}
                  placeholder="搜索课程名称或类型..."
                  className="flex-1 bg-transparent text-xs text-gray-600 placeholder-gray-300 focus:outline-none"
                />
              </div>
            </div>
            <div className="px-3 pb-3 space-y-1 overflow-y-auto flex-1" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              {filteredCourses.map(course => (
                <label
                  key={course.id}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all cursor-pointer group ${
                    selectedCourse === course.id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-transparent hover:border-blue-200 hover:bg-blue-50/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="course"
                    value={course.id}
                    checked={selectedCourse === course.id}
                    onChange={() => setSelectedCourse(course.id)}
                    className="w-3.5 h-3.5 accent-blue-500 cursor-pointer flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold leading-snug truncate ${
                      selectedCourse === course.id ? 'text-blue-700' : 'text-gray-700'
                    }`}>
                      {course.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        selectedCourse === course.id
                          ? 'text-blue-600 bg-blue-100'
                          : 'text-gray-400 bg-gray-100'
                      }`}>
                        {course.tag}
                      </span>
                      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            selectedCourse === course.id ? 'bg-blue-400' : 'bg-gray-300'
                          }`}
                          style={{ width: `${course.progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{course.progress}%</span>
                    </div>
                  </div>
                  {selectedCourse === course.id && (
                    <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                      <i className="ri-arrow-right-s-line text-blue-400 text-sm" />
                    </div>
                  )}
                </label>
              ))}
              {filteredCourses.length === 0 && (
                <div className="py-10 text-center text-xs text-gray-400">未找到匹配课程</div>
              )}
            </div>
          </div>

          {/* Connector arrow */}
          <div className="flex flex-col items-center justify-center flex-shrink-0 pt-16">
            <div className="flex flex-col items-center gap-1">
              <div className="w-px h-8 bg-blue-200" />
              <div className="w-7 h-7 rounded-full bg-blue-100 border-2 border-blue-300 flex items-center justify-center">
                <i className="ri-arrow-right-line text-blue-500 text-xs" />
              </div>
              <div className="w-px h-8 bg-blue-200" />
            </div>
          </div>

          {/* Right: materials panel */}
          <div className="flex-1 flex flex-col gap-4">
            {/* Course info banner */}
            {selectedCourseData && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-blue-100 rounded-xl flex-shrink-0">
                  <i className="ri-book-2-line text-blue-600 text-sm" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-blue-800 truncate">{selectedCourseData.title}</p>
                  <p className="text-[10px] text-blue-500 mt-0.5">{selectedCourseData.tag} · 完成度 {selectedCourseData.progress}%</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {selectedCourseData.hasOutline && (
                    <span className="text-[10px] text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">大纲</span>
                  )}
                  {selectedCourseData.hasPPT && (
                    <span className="text-[10px] text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">PPT</span>
                  )}
                  {selectedCourseData.hasScript && (
                    <span className="text-[10px] text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full">讲稿</span>
                  )}
                </div>
              </div>
            )}

            {/* Materials checklist */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-database-2-line text-blue-500 text-sm" />
                </div>
                <span className="text-xs font-bold text-gray-800">课程资料（自动获取）</span>
                <span className="ml-auto text-[10px] text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                  已勾选 {Object.values(checkedMaterials).filter(Boolean).length} / 3 项
                </span>
              </div>
              <div className="p-3 space-y-2">
                {materialItems.map(item => {
                  const available = selectedCourseData ? selectedCourseData[item.hasKey] : false;
                  const checked = checkedMaterials[item.key];
                  return (
                    <div
                      key={item.key}
                      onClick={() => available && toggleMaterial(item.key)}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        !available
                          ? 'border-gray-100 bg-gray-50/50 opacity-50 cursor-not-allowed'
                          : checked
                          ? 'border-blue-200 bg-blue-50/50 cursor-pointer'
                          : 'border-gray-100 hover:border-blue-200 hover:bg-blue-50/20 cursor-pointer'
                      }`}
                    >
                      <div className={`w-4 h-4 flex items-center justify-center rounded border transition-all flex-shrink-0 ${
                        checked && available
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-gray-300 bg-white'
                      }`}>
                        {checked && available && <i className="ri-check-line text-white text-[10px]" />}
                      </div>
                      <div className={`w-8 h-8 flex items-center justify-center rounded-xl flex-shrink-0 ${item.iconBg}`}>
                        <i className={`${item.icon} ${item.iconColor} text-sm`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold ${checked && available ? 'text-blue-700' : 'text-gray-600'}`}>
                          {item.label}
                        </p>
                        <p className="text-[10px] text-gray-400">{item.desc}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                        available
                          ? 'text-blue-600 bg-blue-100'
                          : 'text-gray-400 bg-gray-100'
                      }`}>
                        {available ? '已生成' : '暂无'}
                      </span>
                    </div>
                  );
                })}

                {/* Audio supplement */}
                <div className="border border-dashed border-blue-200 rounded-xl p-3 bg-blue-50/20 mt-1">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 flex items-center justify-center bg-indigo-100 rounded-xl flex-shrink-0">
                      <i className="ri-mic-line text-indigo-500 text-sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700">补充课程讲解音频</p>
                      <p className="text-[10px] text-gray-400">支持 MP3、WAV、M4A 等格式，可选填</p>
                    </div>
                    <button
                      type="button"
                      disabled={apiBusy}
                      onClick={() => courseAudioRef.current?.click()}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white text-[10px] font-semibold rounded-lg hover:bg-blue-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <i className="ri-upload-2-line text-xs" />
                      上传音频
                    </button>
                  <input
                    ref={courseAudioRef}
                    type="file"
                    accept=".mp3,.wav,.m4a,.aac,.ogg"
                    multiple
                    disabled={apiBusy}
                    className="hidden"
                    onChange={handleCourseAudioUpload}
                  />
                  </div>
                  {courseAudioFiles.length > 0 && (
                    <div className="space-y-1.5 mt-2.5" translate="no">
                      {courseAudioFiles.map(f => (
                        <div key={f.id} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1.5 border border-blue-100">
                          <i className="ri-mic-line text-indigo-400 text-xs" />
                          <span className="flex-1 text-[10px] text-gray-600 truncate">{f.name}</span>
                          {f.uploading && <span className="text-[10px] text-blue-500">上传中</span>}
                          {f.error && <span className="text-[10px] text-red-500 truncate max-w-[120px]" title={f.error}>失败</span>}
                          <span className="text-[10px] text-gray-400">{f.size}</span>
                          <button
                            type="button"
                            onClick={() => removeCourseAudio(f.id)}
                            className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors cursor-pointer"
                          >
                            <i className="ri-close-line text-xs" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Goal + audience + scenes */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-bookmark-3-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">项目名称</span>
                  <span className="text-[10px] text-gray-400">（可选，展示在萃取记录卡片标题）</span>
                </div>
                <input
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="例如：销售最佳实践萃取 · 2026Q1"
                  maxLength={80}
                  className="w-full text-xs text-gray-700 placeholder-gray-300 border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-focus-3-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">萃取目标设定</span>
                  <span className="text-[10px] text-red-400 ml-1">*必填</span>
                </div>
                <textarea
                  value={extractGoal}
                  onChange={e => setExtractGoal(e.target.value)}
                  placeholder="请描述本次知识萃取的核心目标，例如：将课程中的讲师经验和方法论提炼为可复用的操作手册，用于新人带教和企业知识库建设..."
                  className="w-full h-20 text-xs text-gray-700 placeholder-gray-300 border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-group-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">目标受众</span>
                </div>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={e => setTargetAudience(e.target.value)}
                  placeholder="例如：1-3年工龄的新晋管理者、销售团队骨干..."
                  className="w-full text-xs text-gray-700 placeholder-gray-300 border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-map-pin-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">应用场景（可多选）</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {scenes.map(scene => (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => toggleScene(scene.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer whitespace-nowrap ${
                        useScene.includes(scene.id)
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-500'
                      }`}
                    >
                      {scene.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              {courseAudioFiles.some(f => f.audioPending) && !submitting && (
                <p className="text-[10px] text-indigo-500 flex items-center gap-1">
                  <i className="ri-time-line" />
                  音频将在点击下方按钮后自动转写（可能需要额外 1-3 分钟）
                </p>
              )}
              <button
                type="button"
                disabled={nextDisabled}
                onClick={() => void handleSubmitNext()}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting
                  ? courseAudioFiles.some(f => f.audioPending) ? '音频转写 + 锚定分析中…' : '锚定分析中…'
                  : '开始分层筛选'}
                <i className="ri-arrow-right-line" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ── Manual mode ── */
        <div className="flex gap-5">
          <div className="w-[320px] flex-shrink-0 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-upload-cloud-2-line text-blue-500 text-sm" />
                </div>
                <span className="text-xs font-bold text-gray-800">上传数据源文件</span>
                <span className="ml-auto text-[10px] text-gray-400">{manualFiles.length} 个文件</span>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { icon: 'ri-slideshow-3-line', color: 'text-orange-500', bg: 'bg-orange-50', label: 'PPT / PPTX' },
                    { icon: 'ri-file-word-line', color: 'text-blue-500', bg: 'bg-blue-50', label: 'DOC / DOCX' },
                    { icon: 'ri-mic-line', color: 'text-indigo-500', bg: 'bg-indigo-50', label: 'MP3 / WAV / M4A' },
                    { icon: 'ri-file-pdf-line', color: 'text-red-500', bg: 'bg-red-50', label: 'PDF' },
                  ].map(fmt => (
                    <div key={fmt.label} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl ${fmt.bg}`}>
                      <div className="w-5 h-5 flex items-center justify-center">
                        <i className={`${fmt.icon} ${fmt.color} text-sm`} />
                      </div>
                      <span className="text-[10px] font-medium text-gray-600">{fmt.label}</span>
                    </div>
                  ))}
                </div>

                <div
                  className={`border-2 border-dashed border-blue-200 rounded-xl p-5 text-center transition-all ${
                    apiBusy ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400 hover:bg-blue-50/30 cursor-pointer'
                  }`}
                  onDragOver={e => e.preventDefault()}
                  onDrop={apiBusy ? undefined : handleManualDrop}
                  onClick={() => !apiBusy && manualFileRef.current?.click()}
                >
                  <div className="w-10 h-10 flex items-center justify-center bg-blue-100 rounded-xl mx-auto mb-2">
                    <i className="ri-upload-cloud-2-line text-blue-500 text-xl" />
                  </div>
                  <p className="text-xs font-semibold text-gray-600">点击或拖拽文件到此处</p>
                  <p className="text-[10px] text-gray-400 mt-1">支持 PPT、Word、PDF、音频等格式，可多选</p>
                  <input
                    ref={manualFileRef}
                    type="file"
                    accept=".ppt,.pptx,.doc,.docx,.pdf,.mp3,.wav,.m4a,.aac,.ogg"
                    multiple
                    disabled={apiBusy}
                    className="hidden"
                    onChange={handleManualUpload}
                  />
                </div>

                {manualFiles.length > 0 && (
                  <div className="space-y-1.5 max-h-[280px] overflow-y-auto" translate="no">
                    {manualFiles.map(f => {
                      const cfg = fileTypeConfig[f.type] ?? fileTypeConfig.other;
                      return (
                        <div key={f.id} className={`flex items-center gap-2.5 p-2.5 rounded-xl border ${f.audioPending ? 'border-indigo-100 bg-indigo-50/60' : `border-gray-100 ${cfg.bg}`}`}>
                          <div className="w-7 h-7 flex items-center justify-center bg-white rounded-lg flex-shrink-0">
                            <i className={`${cfg.icon} ${cfg.color} text-sm`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-700 truncate">{f.name}</p>
                            <p className="text-[10px] text-gray-400">
                              {cfg.label} · {f.size}
                              {f.uploading ? ' · 上传中…' : ''}
                              {f.audioPending ? ' · 待转写（分析时处理）' : ''}
                              {f.error ? ` · ${f.error}` : ''}
                              {!f.uploading && !f.audioPending && !f.error && f.serverAssetId ? ' · 解析完成 ✓' : ''}
                            </p>
                          </div>
                          {f.audioPending && (
                            <span className="text-[9px] text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">待转写</span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeManualFile(f.id)}
                            className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-all cursor-pointer flex-shrink-0"
                          >
                            <i className="ri-close-line text-sm" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {manualFiles.length === 0 && (
                  <p className="text-center text-[10px] text-gray-400 py-1">尚未上传任何文件</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
              <div className="w-8 h-8 flex items-center justify-center bg-blue-100 rounded-xl flex-shrink-0">
                <i className="ri-upload-cloud-2-line text-blue-600 text-base" />
              </div>
              <div>
                <p className="text-xs font-bold text-blue-700">手动上传模式</p>
                <p className="text-[11px] text-blue-600/80 mt-0.5 leading-relaxed">
                  完全自定义上传数据源，支持PPT课件、Word文档、PDF、音频等多种格式，适用于无系统课程记录或外部课程资料的萃取场景。
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-bookmark-3-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">项目名称</span>
                  <span className="text-[10px] text-gray-400">（可选，展示在萃取记录卡片标题）</span>
                </div>
                <input
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="例如：销售最佳实践萃取 · 2026Q1"
                  maxLength={80}
                  className="w-full text-xs text-gray-700 placeholder-gray-300 border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-focus-3-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">萃取目标设定</span>
                  <span className="text-[10px] text-red-400 ml-1">*必填</span>
                </div>
                <textarea
                  value={extractGoal}
                  onChange={e => setExtractGoal(e.target.value)}
                  placeholder="请描述本次知识萃取的核心目标..."
                  className="w-full h-20 text-xs text-gray-700 placeholder-gray-300 border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-group-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">目标受众</span>
                </div>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={e => setTargetAudience(e.target.value)}
                  placeholder="例如：1-3年工龄的新晋管理者、销售团队骨干..."
                  className="w-full text-xs text-gray-700 placeholder-gray-300 border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <i className="ri-map-pin-line text-blue-500 text-sm" />
                  </div>
                  <span className="text-xs font-bold text-gray-800">应用场景（可多选）</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {scenes.map(scene => (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => toggleScene(scene.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer whitespace-nowrap ${
                        useScene.includes(scene.id)
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-500'
                      }`}
                    >
                      {scene.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              {manualFiles.some(f => f.audioPending) && !submitting && (
                <p className="text-[10px] text-indigo-500 flex items-center gap-1">
                  <i className="ri-time-line" />
                  {manualFiles.filter(f => f.audioPending).length} 个音频文件将在点击下方按钮后自动转写（可能需要额外 1-3 分钟）
                </p>
              )}
              <button
                type="button"
                disabled={nextDisabled}
                onClick={() => void handleSubmitNext()}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-xl hover:bg-blue-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting
                  ? manualFiles.some(f => f.audioPending) ? '音频转写 + 锚定分析中…' : '锚定分析中…'
                  : '开始分层筛选'}
                <i className="ri-arrow-right-line" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SourceAnchorStep;
