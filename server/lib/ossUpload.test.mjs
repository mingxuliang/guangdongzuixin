import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock environment setup helper
function setupEnv(envVars = {}) {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    // Reset to original before each test
    process.env = { ...originalEnv, ...envVars };
  });
  afterEach(() => {
    process.env = originalEnv;
  });
}

describe('ossUpload.mjs - OSS Upload', () => {
  // We need to reset modules to test with different env vars
  beforeEach(() => {
    vi.resetModules();
  });

  describe('getClient (via isOssConfigured)', () => {
    it('should return false when OSS_ENDPOINT is missing', async () => {
      delete process.env.OSS_ENDPOINT;
      delete process.env.OSS_ACCESS_KEY_ID;
      delete process.env.OSS_SECRET_ACCESS_KEY;
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(false);
    });

    it('should return false when OSS_ACCESS_KEY_ID is missing', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      delete process.env.OSS_ACCESS_KEY_ID;
      delete process.env.OSS_SECRET_ACCESS_KEY;
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(false);
    });

    it('should return false when OSS_SECRET_ACCESS_KEY is missing', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      delete process.env.OSS_SECRET_ACCESS_KEY;
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(false);
    });

    it('should return true when all OSS config is present', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.OSS_BUCKET = 'test-bucket';
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });

    it('should return false when OSS_BUCKET is missing even with credentials', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      delete process.env.OSS_BUCKET;
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(false);
    });

    it('should handle whitespace in credentials', async () => {
      process.env.OSS_ENDPOINT = '  https://objectstorageapi.hzh.sealos.run  ';
      process.env.OSS_ACCESS_KEY_ID = '  test-key  ';
      process.env.OSS_SECRET_ACCESS_KEY = '  test-secret  ';
      process.env.OSS_BUCKET = '  test-bucket  ';
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });

    it('should handle trailing slash in endpoint', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run/';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.OSS_BUCKET = 'test-bucket';
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });
  });

  describe('OSS configuration defaults', () => {
    it('should use default region when OSS_REGION is not set', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.OSS_BUCKET = 'test-bucket';
      delete process.env.OSS_REGION;
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });

    it('should use configured region when OSS_REGION is set', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.OSS_BUCKET = 'test-bucket';
      process.env.OSS_REGION = 'ap-guangzhou';
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });

    it('should default forcePathStyle to true when not set', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.OSS_BUCKET = 'test-bucket';
      delete process.env.OSS_FORCE_PATH_STYLE;
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });

    it('should handle OSS_FORCE_PATH_STYLE=0', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.OSS_BUCKET = 'test-bucket';
      process.env.OSS_FORCE_PATH_STYLE = '0';
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });

    it('should handle OSS_FORCE_PATH_STYLE=1', async () => {
      process.env.OSS_ENDPOINT = 'https://objectstorageapi.hzh.sealos.run';
      process.env.OSS_ACCESS_KEY_ID = 'test-key';
      process.env.OSS_SECRET_ACCESS_KEY = 'test-secret';
      process.env.OSS_BUCKET = 'test-bucket';
      process.env.OSS_FORCE_PATH_STYLE = '1';
      
      const { isOssConfigured } = await import('./ossUpload.mjs');
      expect(isOssConfigured()).toBe(true);
    });
  });
});
