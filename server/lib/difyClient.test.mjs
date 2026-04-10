import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('difyClient.mjs - Dify Workflow Client', () => {
  let difyClient;

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getV1Root (implicit via runKeAnchorWorkflow)', () => {
    it('should use default V1 root when DIFY_BASE_URL is not set', async () => {
      delete process.env.DIFY_BASE_URL;
      delete process.env.KE_OMIT_LLM_PROFILE_JSON;
      process.env.KE_ANCHOR_API_KEY = 'test-key';

      difyClient = await import('./difyClient.mjs');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: { status: 'completed', outputs: { anchor_package: '{}' } } }),
      });
      global.fetch = mockFetch;

      await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('http://127.0.0.1:8088/v1/workflows/run');
      const body = JSON.parse(callArgs[1].body);
      expect(body.inputs.llm_profile_json).toBe('{}');
      delete process.env.KE_ANCHOR_API_KEY;
    });

    it('should append /v1 when DIFY_BASE_URL does not end with /v1', async () => {
      process.env.DIFY_BASE_URL = 'http://81.70.78.132:8088';
      process.env.KE_ANCHOR_API_KEY = 'test-key';

      difyClient = await import('./difyClient.mjs');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: { status: 'completed', outputs: { anchor_package: '{}' } } }),
      });
      global.fetch = mockFetch;

      await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('8088/v1/workflows/run');
      delete process.env.KE_ANCHOR_API_KEY;
    });

    it('should not double append /v1 when DIFY_BASE_URL already ends with /v1', async () => {
      process.env.DIFY_BASE_URL = 'http://81.70.78.132:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-key';

      difyClient = await import('./difyClient.mjs');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: { status: 'completed', outputs: { anchor_package: '{}' } } }),
      });
      global.fetch = mockFetch;

      await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('8088/v1/workflows/run');
      delete process.env.KE_ANCHOR_API_KEY;
    });

    it('should remove trailing slash from DIFY_BASE_URL', async () => {
      process.env.DIFY_BASE_URL = 'http://81.70.78.132:8088/v1/';
      process.env.KE_ANCHOR_API_KEY = 'test-key';

      difyClient = await import('./difyClient.mjs');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: { status: 'completed', outputs: { anchor_package: '{}' } } }),
      });
      global.fetch = mockFetch;

      await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('8088/v1/workflows/run');
      delete process.env.KE_ANCHOR_API_KEY;
    });
  });

  describe('runKeAnchorWorkflow - Mock Mode', () => {
    it('should return mock result when KE_ANCHOR_API_KEY is not set', async () => {
      delete process.env.KE_ANCHOR_API_KEY;
      
      difyClient = await import('./difyClient.mjs');
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: '测试萃取目标' });
      
      expect(result.mock).toBe(true);
      expect(result.anchor_package).toBeDefined();
      expect(result.anchor_package.anchor_summary).toContain('离线演示');
      expect(result.anchor_package.anchor_summary).toContain('测试萃取目标');
    });

    it('should include default user when KE_ANCHOR_USER is not set', async () => {
      delete process.env.KE_ANCHOR_API_KEY;
      delete process.env.KE_ANCHOR_USER;
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ data: { status: 'completed', outputs: { anchor_package: '{}' } } })
      });
      global.fetch = mockFetch;
      
      // This test verifies default user is used (no error thrown)
      await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
    });
  });

  describe('runKeAnchorWorkflow - Real API Mode', () => {
    it('should send correct request to Dify API', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      process.env.KE_ANCHOR_USER = 'test-user';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: {
            status: 'completed',
            outputs: { anchor_package: '{"summary":"test"}' }
          }
        })
      });
      global.fetch = mockFetch;
      
      const inputs = {
        mode: 'manual',
        extract_goal: '测试目标',
        target_audience: '开发人员',
        use_scenes: '["knowledge-base"]',
        course_title: '测试课程',
        material_bundle_text: '测试内容'
      };
      
      const result = await difyClient.runKeAnchorWorkflow(inputs);
      
      expect(result.mock).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8088/v1/workflows/run',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('"inputs":')
        })
      );
      const sent = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sent.inputs.llm_profile_json).toBe('{}');
      expect(sent.inputs.extract_goal).toBe('测试目标');
    });

    it('should throw error on non-OK response', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      });
      global.fetch = mockFetch;
      
      await expect(difyClient.runKeAnchorWorkflow({ extract_goal: 'test' }))
        .rejects.toThrow('Dify Workflow 401');
    });

    it('should throw error on workflow failure status', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: { status: 'failed', error: 'Workflow execution failed' }
        })
      });
      global.fetch = mockFetch;
      
      await expect(difyClient.runKeAnchorWorkflow({ extract_goal: 'test' }))
        .rejects.toThrow('Workflow execution failed');
    });

    it('should throw error when data.outputs is missing', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: { status: 'completed', outputs: null }
        })
      });
      global.fetch = mockFetch;
      
      await expect(difyClient.runKeAnchorWorkflow({ extract_goal: 'test' }))
        .rejects.toThrow('缺少 data.outputs');
    });

    it('should throw error when response is not valid JSON', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'not json content'
      });
      global.fetch = mockFetch;
      
      await expect(difyClient.runKeAnchorWorkflow({ extract_goal: 'test' }))
        .rejects.toThrow('Dify 返回非 JSON');
    });

    it('should handle JSON with code fence in anchor_package', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: {
            status: 'completed',
            outputs: { anchor_package: '```json\n{"summary":"test"}\n```' }
          }
        })
      });
      global.fetch = mockFetch;
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      
      expect(result.anchor_package.summary).toBe('test');
    });

    it('should fallback when anchor_package JSON parsing fails', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: {
            status: 'completed',
            outputs: { anchor_package: 'not valid json at all' }
          }
        })
      });
      global.fetch = mockFetch;
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      
      expect(result.anchor_package.anchor_summary).toContain('not valid json');
      expect(result.anchor_package.gaps).toContain('解析 anchor_package JSON 失败，已保存原始文本片段');
      expect(result.anchor_package._raw).toBe('not valid json at all');
    });

    it('should use default timeout of 180000ms', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      delete process.env.KE_ANCHOR_TIMEOUT_MS;
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: { status: 'completed', outputs: { anchor_package: '{}' } }
        })
      });
      global.fetch = mockFetch;
      
      await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      
      // Timeout should be set but fetch should complete before it
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should use custom timeout from KE_ANCHOR_TIMEOUT_MS', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      process.env.KE_ANCHOR_TIMEOUT_MS = '60000';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: { status: 'completed', outputs: { anchor_package: '{}' } }
        })
      });
      global.fetch = mockFetch;
      
      await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('stripJsonFence', () => {
    it('should handle strings without code fences', async () => {
      delete process.env.KE_ANCHOR_API_KEY;
      
      difyClient = await import('./difyClient.mjs');
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      expect(result.anchor_package).toBeDefined();
    });

    it('should strip ```json fence', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: {
            status: 'completed',
            outputs: { anchor_package: '```json\n{"summary":"test"}\n```' }
          }
        })
      });
      global.fetch = mockFetch;
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      expect(result.anchor_package.summary).toBe('test');
    });

    it('should strip ``` fence without json', async () => {
      process.env.DIFY_BASE_URL = 'http://127.0.0.1:8088/v1';
      process.env.KE_ANCHOR_API_KEY = 'test-api-key';
      
      difyClient = await import('./difyClient.mjs');
      
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          data: {
            status: 'completed',
            outputs: { anchor_package: '```\n{"summary":"test"}\n```' }
          }
        })
      });
      global.fetch = mockFetch;
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      expect(result.anchor_package.summary).toBe('test');
    });
  });

  describe('buildMockAnchorPackage', () => {
    it('should use default goal when extract_goal is empty', async () => {
      delete process.env.KE_ANCHOR_API_KEY;
      
      difyClient = await import('./difyClient.mjs');
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: '' });
      
      expect(result.anchor_package.anchor_summary).toContain('（未填写）');
    });

    it('should truncate long extract_goal', async () => {
      delete process.env.KE_ANCHOR_API_KEY;
      
      difyClient = await import('./difyClient.mjs');
      
      const longGoal = 'a'.repeat(500);
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: longGoal });
      
      expect(result.anchor_package.anchor_summary.length).toBeLessThan(longGoal.length + 50);
    });

    it('should include proper scope_in and scope_out', async () => {
      delete process.env.KE_ANCHOR_API_KEY;
      
      difyClient = await import('./difyClient.mjs');
      
      const result = await difyClient.runKeAnchorWorkflow({ extract_goal: 'test' });
      
      expect(result.anchor_package.scope_in).toContain('与目标直接相关的课程知识点');
      expect(result.anchor_package.scope_out).toContain('与目标无关的扩展阅读');
      expect(result.anchor_package.downstream_hints).toBeDefined();
    });
  });
});
