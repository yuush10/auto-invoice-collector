/**
 * Unit tests for AILoginService
 * Tests AI login orchestration, environment configuration, and subprocess handling
 */

import { AILoginService, getAILoginService, AILoginResult } from '../src/services/AILoginService';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock SecretManager
jest.mock('../src/services/SecretManager', () => ({
  getSecretManager: jest.fn().mockReturnValue({
    isAvailable: jest.fn().mockResolvedValue(false),
    getCredentials: jest.fn().mockResolvedValue(null),
  }),
}));

describe('AILoginService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Clear mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance', () => {
      const instance1 = getAILoginService();
      const instance2 = getAILoginService();
      expect(instance1).toBe(instance2);
    });

    test('should return instance via static method', () => {
      const instance = AILoginService.getInstance();
      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(AILoginService);
    });
  });

  describe('isEnabled', () => {
    test('should return false when ENABLE_AI_LOGIN is not set', () => {
      delete process.env.ENABLE_AI_LOGIN;
      const service = getAILoginService();
      expect(service.isEnabled()).toBe(false);
    });

    test('should return false when ENABLE_AI_LOGIN is "false"', () => {
      process.env.ENABLE_AI_LOGIN = 'false';
      const service = getAILoginService();
      expect(service.isEnabled()).toBe(false);
    });

    test('should return true when ENABLE_AI_LOGIN is "true"', () => {
      process.env.ENABLE_AI_LOGIN = 'true';
      const service = getAILoginService();
      expect(service.isEnabled()).toBe(true);
    });

    test('should return false for other values', () => {
      process.env.ENABLE_AI_LOGIN = 'yes';
      const service = getAILoginService();
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('isFallbackEnabled', () => {
    test('should return true when AI_LOGIN_FALLBACK is not set (default)', () => {
      delete process.env.AI_LOGIN_FALLBACK;
      const service = getAILoginService();
      expect(service.isFallbackEnabled()).toBe(true);
    });

    test('should return true when AI_LOGIN_FALLBACK is "true"', () => {
      process.env.AI_LOGIN_FALLBACK = 'true';
      const service = getAILoginService();
      expect(service.isFallbackEnabled()).toBe(true);
    });

    test('should return false when AI_LOGIN_FALLBACK is "false"', () => {
      process.env.AI_LOGIN_FALLBACK = 'false';
      const service = getAILoginService();
      expect(service.isFallbackEnabled()).toBe(false);
    });
  });

  describe('getTimeout', () => {
    test('should return default 60000ms when not configured', () => {
      delete process.env.AI_LOGIN_TIMEOUT;
      const service = getAILoginService();
      expect(service.getTimeout()).toBe(60000);
    });

    test('should return configured timeout', () => {
      process.env.AI_LOGIN_TIMEOUT = '90000';
      const service = getAILoginService();
      expect(service.getTimeout()).toBe(90000);
    });

    test('should return default for invalid value', () => {
      process.env.AI_LOGIN_TIMEOUT = 'invalid';
      const service = getAILoginService();
      expect(service.getTimeout()).toBe(60000);
    });
  });

  describe('getAnthropicApiKey', () => {
    test('should return API key from environment variable', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      const service = getAILoginService();
      const apiKey = await service.getAnthropicApiKey();
      expect(apiKey).toBe('sk-ant-test-key');
    });

    test('should return null when no API key configured', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const service = getAILoginService();
      const apiKey = await service.getAnthropicApiKey();
      expect(apiKey).toBeNull();
    });
  });

  describe('attemptLogin', () => {
    const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

    const createMockProcess = (): ChildProcess => {
      const mockProcess = new EventEmitter() as ChildProcess;
      mockProcess.stdout = new EventEmitter() as any;
      mockProcess.stderr = new EventEmitter() as any;
      mockProcess.stdin = { write: jest.fn(), end: jest.fn() } as any;
      mockProcess.kill = jest.fn();
      return mockProcess;
    };

    test('should return error when API key is not configured', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const service = getAILoginService();
      const result = await service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'user', password: 'pass' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('API key not configured');
    });

    test('should return error when credentials are missing', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const service = getAILoginService();
      const result = await service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: '', password: '' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Credentials not provided');
    });

    test('should spawn Python process with correct arguments', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const service = getAILoginService();
      const loginPromise = service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'testuser', password: 'testpass' },
        headless: true,
        timeout: 1000,
      });

      // Emit events immediately to avoid timeout
      setImmediate(() => {
        const successResult = { success: true, cookies: [{ name: 'session', value: 'abc', domain: 'example.com' }] };
        mockProcess.stdout!.emit('data', JSON.stringify(successResult));
        mockProcess.emit('close', 0);
      });

      const result = await loginPromise;

      expect(mockSpawn).toHaveBeenCalled();
      const [command, args, options] = mockSpawn.mock.calls[0];
      expect(command).toContain('python');
      expect(args).toContain('--vendor');
      expect(args).toContain('ibj');
      expect(args).toContain('--login-url');
      expect(args).toContain('https://example.com/login');
      expect(options?.env?.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
      expect(options?.env?.IBJ_USERNAME).toBe('testuser');
      expect(options?.env?.IBJ_PASSWORD).toBe('testpass');
    });

    test('should handle successful login result', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const service = getAILoginService();
      const loginPromise = service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'testuser', password: 'testpass' },
        timeout: 1000,
      });

      // Emit events immediately
      setImmediate(() => {
        const successResult: AILoginResult = {
          success: true,
          cookies: [
            { name: 'session', value: 'abc123', domain: '.example.com' },
            { name: 'auth', value: 'xyz789', domain: '.example.com' },
          ],
        };
        mockProcess.stdout!.emit('data', JSON.stringify(successResult));
        mockProcess.emit('close', 0);
      });

      const result = await loginPromise;

      expect(result.success).toBe(true);
      expect(result.cookies).toHaveLength(2);
      expect(result.cookies![0].name).toBe('session');
      expect(result.duration).toBeDefined();
    });

    test('should handle failed login result', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const service = getAILoginService();
      const loginPromise = service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'testuser', password: 'testpass' },
        timeout: 1000,
      });

      // Emit events immediately
      setImmediate(() => {
        const failedResult = { success: false, error: 'CAPTCHA challenge failed' };
        mockProcess.stdout!.emit('data', JSON.stringify(failedResult));
        mockProcess.emit('close', 0);
      });

      const result = await loginPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('CAPTCHA challenge failed');
    });

    test('should handle Python process error', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const service = getAILoginService();
      const loginPromise = service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'testuser', password: 'testpass' },
        timeout: 1000,
      });

      // Emit events immediately
      setImmediate(() => {
        mockProcess.emit('error', new Error('spawn python3 ENOENT'));
      });

      const result = await loginPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start AI login process');
    });

    test('should handle non-zero exit code', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const service = getAILoginService();
      const loginPromise = service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'testuser', password: 'testpass' },
        timeout: 1000,
      });

      // Emit events immediately
      setImmediate(() => {
        mockProcess.stderr!.emit('data', 'ModuleNotFoundError: No module named browser_use');
        mockProcess.emit('close', 1);
      });

      const result = await loginPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('browser_use');
    });

    test('should handle invalid JSON output', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.AI_LOGIN_TIMEOUT = '1000'; // Short timeout for test

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const service = getAILoginService();
      const loginPromise = service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'testuser', password: 'testpass' },
        timeout: 1000, // Short timeout
      });

      // Emit events immediately
      setImmediate(() => {
        mockProcess.stdout!.emit('data', 'not valid json {');
        mockProcess.emit('close', 0);
      });

      const result = await loginPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse');
    });

    test('should pass --no-headless flag when headless is false', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.AI_LOGIN_TIMEOUT = '1000'; // Short timeout for test

      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const service = getAILoginService();
      const loginPromise = service.attemptLogin({
        vendorKey: 'ibj',
        loginUrl: 'https://example.com/login',
        credentials: { username: 'testuser', password: 'testpass' },
        headless: false,
        timeout: 1000, // Short timeout
      });

      // Emit events immediately
      setImmediate(() => {
        mockProcess.stdout!.emit('data', JSON.stringify({ success: true, cookies: [] }));
        mockProcess.emit('close', 0);
      });

      await loginPromise;

      const [, args] = mockSpawn.mock.calls[0];
      expect(args).toContain('--no-headless');
    });
  });
});
