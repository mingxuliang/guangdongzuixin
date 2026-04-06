import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('extractText.mjs - Text Extraction', () => {
  let extractText;
  let testFiles = [];

  beforeEach(async () => {
    vi.resetModules();
    // Set default env for audio transcription tests
    process.env.KE_AUDIO_TO_TEXT_API_KEY = '';
    process.env.KE_ANCHOR_API_KEY = '';
    process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
  });

  afterEach(() => {
    // Cleanup test files
    for (const file of testFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
    testFiles = [];
  });

  // Helper to create temp files
  function createTempFile(name, content) {
    const fp = path.join(__dirname, `../${name}`);
    fs.writeFileSync(fp, content, 'utf8');
    testFiles.push(fp);
    return fp;
  }

  describe('extractTextFromFile - Text files', () => {
    it('should extract plain text from .txt file', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.txt', 'Hello, World!');
      
      const result = await extractText.extractTextFromFile(fp, 'test.txt');
      
      expect(result).toBe('Hello, World!');
    });

    it('should extract markdown content', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.md', '# Heading\n\nParagraph text');
      
      const result = await extractText.extractTextFromFile(fp, 'test.md');
      
      expect(result).toContain('Heading');
      expect(result).toContain('Paragraph text');
    });

    it('should extract CSV content', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.csv', 'col1,col2\nval1,val2');
      
      const result = await extractText.extractTextFromFile(fp, 'test.csv');
      
      expect(result).toContain('col1');
      expect(result).toContain('val1');
    });

    it('should extract JSON content', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.json', '{"key": "value"}');
      
      const result = await extractText.extractTextFromFile(fp, 'test.json');
      
      expect(result).toContain('key');
      expect(result).toContain('value');
    });

    it('should handle empty text file', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('empty.txt', '');
      
      const result = await extractText.extractTextFromFile(fp, 'empty.txt');
      
      expect(result).toBe('');
    });

    it('should truncate very long text files', async () => {
      extractText = await import('./extractText.mjs');
      const longContent = 'a'.repeat(200000);
      const fp = createTempFile('long.txt', longContent);
      
      const result = await extractText.extractTextFromFile(fp, 'long.txt');
      
      expect(result.length).toBeLessThanOrEqual(120000 + 50);
      expect(result).toContain('…[内容已截断，超出 12 万字上限]');
    });

    it('should handle HTML files', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.html', '<html><body>Hello</body></html>');
      
      const result = await extractText.extractTextFromFile(fp, 'test.html');
      
      expect(result).toContain('Hello');
    });

    it('should handle XML files', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.xml', '<root><item>value</item></root>');
      
      const result = await extractText.extractTextFromFile(fp, 'test.xml');
      
      expect(result).toContain('item');
      expect(result).toContain('value');
    });

    it('should handle file with no extension', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('noext', 'plain content');
      
      const result = await extractText.extractTextFromFile(fp, 'noext');
      
      expect(result).toContain('plain content');
    });

    it('should handle unknown extensions gracefully', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.xyz', 'some content');
      
      const result = await extractText.extractTextFromFile(fp, 'test.xyz');
      
      expect(result).toContain('暂不支持解析该格式');
      expect(result).toContain('.xyz');
    });
  });

  describe('extractTextFromFile - Case insensitive extensions', () => {
    it('should handle .TXT extension', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.TXT', 'UPPER');
      
      const result = await extractText.extractTextFromFile(fp, 'test.TXT');
      
      expect(result).toBe('UPPER');
    });

    it('should handle .PDF extension', async () => {
      extractText = await import('./extractText.mjs');
      const fp = createTempFile('test.PDF', 'not real pdf');
      
      const result = await extractText.extractTextFromFile(fp, 'test.PDF');
      
      expect(result).toContain('PDF 解析失败');
    });
  });

  describe('mergeMaterialLines', () => {
    it('should merge session with manual mode', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: '萃取营销知识',
        target_audience: '营销人员',
        use_scenes: ['training'],
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('模式: manual');
      expect(result).toContain('萃取目标: 萃取营销知识');
      expect(result).toContain('目标受众: 营销人员');
      expect(result).toContain('应用场景: training');
    });

    it('should merge session with course mode', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'course',
        course_title: '市场营销课程',
        extract_goal: '萃取课程精华',
        target_audience: '新人',
        use_scenes: ['onboarding'],
        material_selection: { outline: true, ppt: false, script: true },
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('模式: course');
      expect(result).toContain('关联课程: 市场营销课程');
      expect(result).toContain('勾选资料: 大纲=是, PPT=否, 讲稿=是');
    });

    it('should handle session with empty extract_goal', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: '',
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('萃取目标: （空）');
    });

    it('should handle session with missing optional fields', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('目标受众: （未填）');
      expect(result).toContain('应用场景: ');
    });

    it('should merge assets with extracted text', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: 'test',
        assets: [
          { kind: 'manual_upload', original_name: 'doc.pdf', extracted_text: 'PDF content here' },
          { kind: 'course_material', original_name: 'notes.txt', extracted_text: 'Notes content' }
        ]
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('--- 已上传素材 ---');
      expect(result).toContain('[manual_upload] doc.pdf');
      expect(result).toContain('PDF content here');
      expect(result).toContain('[course_material] notes.txt');
      expect(result).toContain('Notes content');
      expect(result).toContain('解析字数:');
    });

    it('should handle assets with empty extracted_text', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: 'test',
        assets: [
          { kind: 'manual_upload', original_name: 'empty.txt', extracted_text: '' }
        ]
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('--- 已上传素材 ---');
      expect(result).toContain('解析字数: 0');
    });

    it('should handle course mode without assets', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'course',
        course_title: '测试课程',
        extract_goal: 'test',
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('--- 课程模式（无上传文件时由课程元信息占位）---');
      expect(result).toContain('课程「测试课程」中与勾选类型相关的知识');
    });

    it('should handle multiple use_scenes', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: 'test',
        use_scenes: ['training', 'meeting', 'knowledge-base'],
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('应用场景: training, meeting, knowledge-base');
    });

    it('should handle empty use_scenes', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: 'test',
        use_scenes: [],
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('应用场景: ');
    });

    it('should handle null material_selection in course mode', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'course',
        course_title: '测试课程',
        material_selection: null,
        extract_goal: 'test',
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('勾选资料: 大纲=否, PPT=否, 讲稿=否');
    });
  });

  describe('truncate function', () => {
    it('should not truncate short text', async () => {
      extractText = await import('./extractText.mjs');
      
      const shortText = 'Short text';
      const fp = createTempFile('short.txt', shortText);
      
      const result = await extractText.extractTextFromFile(fp, 'short.txt');
      
      expect(result).toBe(shortText);
    });

    it('should handle null/undefined input', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: null,
        assets: [{ extracted_text: null }]
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('萃取目标: （空）');
    });

    it('should handle whitespace-only text', async () => {
      extractText = await import('./extractText.mjs');
      
      const session = {
        mode: 'manual',
        extract_goal: '   ',
        assets: []
      };
      
      const result = extractText.mergeMaterialLines(session);
      
      expect(result).toContain('萃取目标: （空）');
    });
  });
});
