import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

interface KnowledgeItemForExport {
  id: string;
  kind?: 'core' | 'case' | 'tool';
  type: string;
  title: string;
  v1Content: string;
  v2Content: string;
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
  modified: boolean;
  reExtracted: boolean;
  aiScores: { rule1: number; rule2: number; rule3: number } | null;
  aiStatus: 'pass' | 'needs_review' | 'fail' | null;
  aiSuggestion: string;
  validation: { rule1: boolean; rule2: boolean; rule3: boolean };
}

const BRAND_BLUE = '1E5EFF';
const LIGHT_BLUE = 'EEF4FF';
const GRAY_BG = 'F5F7FA';
const BORDER_NONE = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function typeColor(type: string): string {
  if (['核心知识', '方法论', '知识点', '操作步骤', '经验技巧'].includes(type)) return 'D97706';
  if (type === '配套案例') return '4F46E5';
  if (type === '实操工具') return '7C3AED';
  return '0284C7';
}

function scoreLabel(score: number): string {
  if (score >= 80) return `${score}分（优）`;
  if (score >= 60) return `${score}分（良）`;
  return `${score}分（待优化）`;
}

function getItemPassRate(item: KnowledgeItemForExport): number {
  return Math.round((Object.values(item.validation).filter(Boolean).length / 3) * 100);
}

function normalizeExportText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\t/g, '  ')
    .replace(/\u200B/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pushStructuredContent(children: (Paragraph | Table)[], item: KnowledgeItemForExport) {
  children.push(labelPara('结构化内容'));
  children.push(contentPara(item.content));

  if (item.kind === 'core' && item.methodSteps?.length) {
    children.push(labelPara('操作步骤'));
    item.methodSteps.forEach((step, idx) => {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 20, after: 20 },
          children: [
            new TextRun({ text: `${idx + 1}. `, bold: true, color: BRAND_BLUE, size: 18, font: '微软雅黑' }),
            new TextRun({ text: step, color: '374151', size: 18, font: '微软雅黑' }),
          ],
        }),
      );
    });
  }

  if (item.kind === 'core' && item.keyPrinciples?.length) {
    children.push(labelPara('关键要点'));
    children.push(contentPara(item.keyPrinciples.map((p) => `• ${p}`).join('\n'), 'FFF7ED', '9A3412'));
  }

  if (item.kind === 'core' && item.applicableWhen) {
    children.push(labelPara('适用场景'));
    children.push(contentPara(item.applicableWhen, 'ECFDF5', '065F46'));
  }

  if (item.kind === 'case') {
    if (item.situation) {
      children.push(labelPara('情境'));
      children.push(contentPara(item.situation, 'F0F9FF', '0C4A6E'));
    }
    if (item.task) {
      children.push(labelPara('任务'));
      children.push(contentPara(item.task, 'EEF2FF', '3730A3'));
    }
    if (item.action) {
      children.push(labelPara('行动'));
      children.push(contentPara(item.action, 'EFF6FF', '1D4ED8'));
    }
    if (item.result) {
      children.push(labelPara('成果'));
      children.push(contentPara(item.result, 'ECFDF5', '047857'));
    }
    if (item.highlight) {
      children.push(labelPara('可借鉴点'));
      children.push(contentPara(item.highlight, 'FFFBEB', '92400E'));
    }
  }

  if (item.kind === 'tool') {
    if (item.format) {
      children.push(labelPara('工具形式'));
      children.push(contentPara(item.format, 'EEF2FF', '3730A3'));
    }
    if (item.toolContent) {
      children.push(labelPara('工具实际内容'));
      children.push(contentPara(item.toolContent, 'F9FAFB', '374151'));
    }
    if (item.toolDesc) {
      children.push(labelPara('使用说明'));
      children.push(contentPara(item.toolDesc, 'EFF6FF', '1E40AF'));
    }
  }
}

export async function exportKnowledgeToWord(params: {
  knowledgeList: KnowledgeItemForExport[];
  passRate: number;
  modifiedCount: number;
}): Promise<void> {
  const { knowledgeList, passRate, modifiedCount } = params;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const children: (Paragraph | Table)[] = [];

  // ── 封面标题 ──────────────────────────────────────────────────
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({
          text: '知识萃取成果包',
          color: BRAND_BLUE,
          size: 52,
          bold: true,
          font: '微软雅黑',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [
        new TextRun({
          text: '（2.0 优化版本）',
          color: '6B7280',
          size: 28,
          font: '微软雅黑',
        }),
      ],
    }),
  );

  // ── 摘要信息表 ────────────────────────────────────────────────
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: BORDER_NONE,
      rows: [
        new TableRow({
          children: [
            metaCell('生成日期', dateStr),
            metaCell('知识条数', String(knowledgeList.length)),
            metaCell('审核通过率', `${passRate}%`),
            metaCell('优化条数', String(modifiedCount)),
          ],
        }),
      ],
    }),
  );
  children.push(emptyLine(200));

  // ── 审核维度说明 ──────────────────────────────────────────────
  children.push(sectionHeading('审核维度'));
  const rules = [
    { title: '知识深度与准确性', desc: '内容准确、深入，且已提炼出可复用方法' },
    { title: '目标对齐性', desc: '与课程目标一致，无遗漏无冗余' },
    { title: '复用与实践价值', desc: '可复用到带教、复训、微课等场景' },
  ];
  rules.forEach(rule => {
    children.push(
      new Paragraph({
        spacing: { before: 80, after: 60 },
        children: [
          new TextRun({ text: `▶  ${rule.title}：`, bold: true, color: BRAND_BLUE, size: 20, font: '微软雅黑' }),
          new TextRun({ text: rule.desc, color: '374151', size: 20, font: '微软雅黑' }),
        ],
      }),
    );
  });
  children.push(emptyLine(160));

  // ── 知识清单 ──────────────────────────────────────────────────
  children.push(sectionHeading(`萃取知识清单（共 ${knowledgeList.length} 条）`));

  knowledgeList.forEach((item, idx) => {
    const itemPassRate = getItemPassRate(item);
    const allPass = itemPassRate === 100;
    const color = typeColor(item.type);
    const statusBadge = item.modified ? '已编辑' : item.reExtracted ? 'AI 已优化' : '';

    // 条目序号 + 类型 + 标题
    children.push(
      new Paragraph({
        spacing: { before: 260, after: 80 },
        shading: { type: ShadingType.SOLID, color: allPass ? LIGHT_BLUE : GRAY_BG, fill: allPass ? LIGHT_BLUE : GRAY_BG },
        children: [
          new TextRun({ text: `${String(idx + 1).padStart(2, '0')}  `, color: 'A0AEC0', size: 18, font: 'Consolas' }),
          new TextRun({ text: `【${item.type}】`, bold: true, color, size: 20, font: '微软雅黑' }),
          new TextRun({ text: `  ${item.title}`, bold: true, color: '111827', size: 22, font: '微软雅黑' }),
          ...(statusBadge ? [new TextRun({ text: `  · ${statusBadge}`, color: '6B7280', size: 18, font: '微软雅黑' })] : []),
        ],
      }),
    );

    if (item.modified || item.reExtracted) {
      children.push(labelPara('2.0 优化内容'));
      children.push(contentPara(item.v2Content));
    }

    pushStructuredContent(children, item);

    if (item.modified || item.reExtracted) {
      children.push(labelPara('1.0 原始版本（完整文本）', '9CA3AF'));
      children.push(contentPara(item.v1Content, 'F3F4F6', '6B7280'));
    }

    // 标签行
    if (item.tags.length > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [
            new TextRun({ text: '标签：', color: '9CA3AF', size: 18, font: '微软雅黑' }),
            new TextRun({ text: item.tags.join('  /  '), color: '6B7280', size: 18, font: '微软雅黑' }),
          ],
        }),
      );
    }

    // AI 评分行
    if (item.aiScores) {
      const avg = Math.round((item.aiScores.rule1 + item.aiScores.rule2 + item.aiScores.rule3) / 3);
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 60, after: 60 },
          children: [
            new TextRun({ text: `AI 评分：  `, color: '9CA3AF', size: 18, font: '微软雅黑' }),
            new TextRun({ text: `知识准确性 ${scoreLabel(item.aiScores.rule1)}   `, color: '374151', size: 18, font: '微软雅黑' }),
            new TextRun({ text: `目标对齐 ${scoreLabel(item.aiScores.rule2)}   `, color: '374151', size: 18, font: '微软雅黑' }),
            new TextRun({ text: `复用价值 ${scoreLabel(item.aiScores.rule3)}   `, color: '374151', size: 18, font: '微软雅黑' }),
            new TextRun({ text: `综合均分 ${avg} 分`, bold: true, color: avg >= 80 ? '059669' : avg >= 60 ? 'D97706' : 'DC2626', size: 18, font: '微软雅黑' }),
          ],
        }),
      );
    }

    // AI 优化建议
    if (item.aiSuggestion && item.aiStatus !== 'pass') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 60, after: 80 },
          shading: { type: ShadingType.SOLID, color: 'FFFBEB', fill: 'FFFBEB' },
          children: [
            new TextRun({ text: '💡 优化建议：', bold: true, color: 'B45309', size: 18, font: '微软雅黑' }),
            new TextRun({ text: item.aiSuggestion, color: '92400E', size: 18, font: '微软雅黑' }),
          ],
        }),
      );
    }

    // 通过率
    children.push(
      new Paragraph({
        spacing: { before: 40, after: 40 },
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: `审核通过率：${itemPassRate}%`,
            bold: true,
            color: allPass ? BRAND_BLUE : itemPassRate >= 60 ? '0284C7' : '6B7280',
            size: 18,
            font: '微软雅黑',
          }),
        ],
      }),
    );

    // 分隔线
    children.push(
      new Paragraph({
        spacing: { before: 40, after: 40 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' } },
        children: [],
      }),
    );
  });

  // ── 页脚说明 ──────────────────────────────────────────────────
  children.push(emptyLine(200));
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: '本文档由广东移动智能制课平台自动生成 · ', color: 'D1D5DB', size: 16, font: '微软雅黑' }),
        new TextRun({ text: dateStr, color: 'D1D5DB', size: 16, font: '微软雅黑' }),
      ],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: '微软雅黑', size: 22, color: '1F2937' },
          paragraph: { spacing: { line: 360 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, bottom: 1080, left: 1260, right: 1260 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `知识萃取成果包_2.0_${dateStr}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 辅助函数 ──────────────────────────────────────────────────
function emptyLine(before = 0): Paragraph {
  return new Paragraph({ spacing: { before, after: 0 }, children: [] });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    border: { bottom: { style: BorderStyle.THICK, size: 6, color: BRAND_BLUE } },
    children: [
      new TextRun({ text, bold: true, color: BRAND_BLUE, size: 26, font: '微软雅黑' }),
    ],
  });
}

function metaCell(label: string, value: string): TableCell {
  return new TableCell({
    borders: BORDER_NONE,
    shading: { type: ShadingType.SOLID, color: LIGHT_BLUE, fill: LIGHT_BLUE },
    margins: { top: 120, bottom: 120, left: 180, right: 180 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: label, color: '6B7280', size: 16, font: '微软雅黑', break: 0 }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: value, bold: true, color: BRAND_BLUE, size: 28, font: '微软雅黑' }),
        ],
      }),
    ],
  });
}

function labelPara(text: string, color = BRAND_BLUE): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 40 },
    children: [
      new TextRun({ text, bold: true, color, size: 18, font: '微软雅黑' }),
    ],
  });
}

function contentPara(text: string, bgColor = 'F9FAFB', textColor = '374151'): Paragraph {
  const lines = normalizeExportText(text).split('\n');

  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 80 },
    shading: { type: ShadingType.SOLID, color: bgColor, fill: bgColor },
    children: lines.flatMap((line, idx) => {
      const run = new TextRun({ text: line || ' ', color: textColor, size: 20, font: '微软雅黑' });
      return idx < lines.length - 1 ? [run, new TextRun({ break: 1 })] : [run];
    }),
  });
}
