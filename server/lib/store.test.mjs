import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock the entire module before importing
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data/sessions');

describe('store.mjs - Session Management', () => {
  let store;
  let testSessionId;

  beforeEach(async () => {
    // Clear module cache to reset state
    vi.resetModules();
    
    // Ensure test data directory exists and is clean
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(DATA_DIR, file));
        }
      }
    }
    
    // Import fresh module
    store = await import('../lib/store.mjs');
    testSessionId = null;
  });

  afterEach(() => {
    // Cleanup test sessions
    if (testSessionId) {
      const fp = path.join(DATA_DIR, `${testSessionId}.json`);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
      }
    }
  });

  describe('createSessionRecord', () => {
    it('should create a session with default values', () => {
      const session = store.createSessionRecord({});
      
      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.mode).toBe('manual');
      expect(session.course_id).toBeNull();
      expect(session.course_title).toBeNull();
      expect(session.material_selection).toEqual({ outline: true, ppt: true, script: true });
      expect(session.extract_goal).toBe('');
      expect(session.target_audience).toBe('');
      expect(session.use_scenes).toEqual(['knowledge-base']);
      expect(session.status).toBe('draft');
      expect(session.assets).toEqual([]);
      expect(session.anchor_package).toBeNull();
      expect(session.error_message).toBeNull();
      expect(session.updated_at).toBeDefined();
      
      testSessionId = session.id;
    });

    it('should create a session with custom mode', () => {
      const session = store.createSessionRecord({ mode: 'course' });
      
      expect(session.mode).toBe('course');
      testSessionId = session.id;
    });

    it('should create a session with course_id and course_title', () => {
      const session = store.createSessionRecord({
        course_id: 'course-123',
        course_title: '测试课程'
      });
      
      expect(session.course_id).toBe('course-123');
      expect(session.course_title).toBe('测试课程');
      testSessionId = session.id;
    });

    it('should create a session with custom material_selection', () => {
      const session = store.createSessionRecord({
        material_selection: { outline: true, ppt: false, script: false }
      });
      
      expect(session.material_selection).toEqual({ outline: true, ppt: false, script: false });
      testSessionId = session.id;
    });

    it('should create a session with custom use_scenes', () => {
      const session = store.createSessionRecord({
        use_scenes: ['training', 'meeting']
      });
      
      expect(session.use_scenes).toEqual(['training', 'meeting']);
      testSessionId = session.id;
    });

    it('should handle non-array use_scenes by defaulting to knowledge-base', () => {
      const session = store.createSessionRecord({
        use_scenes: 'invalid-scenarios'
      });
      
      expect(session.use_scenes).toEqual(['knowledge-base']);
      testSessionId = session.id;
    });

    it('should create a session with extract_goal and target_audience', () => {
      const session = store.createSessionRecord({
        extract_goal: '萃取机器学习知识',
        target_audience: '初级开发者'
      });
      
      expect(session.extract_goal).toBe('萃取机器学习知识');
      expect(session.target_audience).toBe('初级开发者');
      testSessionId = session.id;
    });

    it('should persist session to disk', () => {
      const session = store.createSessionRecord({});
      testSessionId = session.id;
      
      const fp = path.join(DATA_DIR, `${session.id}.json`);
      expect(fs.existsSync(fp)).toBe(true);
      
      const loaded = JSON.parse(fs.readFileSync(fp, 'utf8'));
      expect(loaded.id).toBe(session.id);
    });
  });

  describe('loadSession', () => {
    it('should return null for non-existent session', () => {
      const result = store.loadSession('non-existent-id');
      expect(result).toBeNull();
    });

    it('should load existing session', () => {
      const created = store.createSessionRecord({ mode: 'course' });
      testSessionId = created.id;
      
      const loaded = store.loadSession(created.id);
      
      expect(loaded).toBeDefined();
      expect(loaded.id).toBe(created.id);
      expect(loaded.mode).toBe('course');
    });

    it('should load session with all properties', () => {
      const created = store.createSessionRecord({
        mode: 'course',
        course_id: 'c-001',
        course_title: 'Test Course',
        extract_goal: 'Extract knowledge',
        target_audience: 'Developers'
      });
      testSessionId = created.id;
      
      const loaded = store.loadSession(created.id);
      
      expect(loaded.course_id).toBe('c-001');
      expect(loaded.course_title).toBe('Test Course');
      expect(loaded.extract_goal).toBe('Extract knowledge');
      expect(loaded.target_audience).toBe('Developers');
    });
  });

  describe('saveSession', () => {
    it('should update session and set updated_at', async () => {
      const created = store.createSessionRecord({});
      testSessionId = created.id;
      
      // Wait a bit to ensure updated_at changes
      await new Promise(resolve => setTimeout(resolve, 10));
      
      created.extract_goal = 'Updated goal';
      store.saveSession(created);
      
      const loaded = store.loadSession(created.id);
      expect(loaded.extract_goal).toBe('Updated goal');
      expect(loaded.updated_at).toBeDefined();
    });

    it('should update session status', () => {
      const created = store.createSessionRecord({});
      testSessionId = created.id;
      
      created.status = 'anchoring';
      created.anchor_package = { summary: 'test' };
      store.saveSession(created);
      
      const loaded = store.loadSession(created.id);
      expect(loaded.status).toBe('anchoring');
      expect(loaded.anchor_package).toEqual({ summary: 'test' });
    });

    it('should update assets array', () => {
      const created = store.createSessionRecord({});
      testSessionId = created.id;
      
      created.assets = [
        { id: 'asset-1', name: 'test.pdf', extracted_text: 'content' }
      ];
      store.saveSession(created);
      
      const loaded = store.loadSession(created.id);
      expect(loaded.assets).toHaveLength(1);
      expect(loaded.assets[0].id).toBe('asset-1');
    });
  });
});
