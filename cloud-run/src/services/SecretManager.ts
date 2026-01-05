/**
 * Google Cloud Secret Manager client
 * Retrieves vendor credentials securely
 */
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { VendorCredentials } from '../vendors/types';

/**
 * Secret Manager client wrapper
 */
export class SecretManager {
  private client: SecretManagerServiceClient;
  private projectId: string;
  private cache: Map<string, { credentials: VendorCredentials; expiresAt: number }>;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.client = new SecretManagerServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    this.cache = new Map();

    if (!this.projectId) {
      console.warn('[SecretManager] No project ID found. Set GOOGLE_CLOUD_PROJECT environment variable.');
    }
  }

  /**
   * Get credentials for a vendor
   * @param secretName Name of the secret in Secret Manager
   * @returns Vendor credentials
   */
  async getCredentials(secretName: string): Promise<VendorCredentials> {
    // Check cache first
    const cached = this.cache.get(secretName);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[SecretManager] Cache hit for ${secretName}`);
      return cached.credentials;
    }

    // Fetch from Secret Manager
    console.log(`[SecretManager] Fetching secret: ${secretName}`);

    if (!this.projectId) {
      throw new Error('Project ID not configured. Set GOOGLE_CLOUD_PROJECT environment variable.');
    }

    const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;

    try {
      const [version] = await this.client.accessSecretVersion({ name });

      if (!version.payload?.data) {
        throw new Error(`Secret ${secretName} has no data`);
      }

      // Parse the secret payload as JSON
      const secretData = version.payload.data.toString();
      const credentials = JSON.parse(secretData) as VendorCredentials;

      // Validate required fields
      if (!credentials.username || !credentials.password) {
        throw new Error(`Secret ${secretName} missing required fields (username, password)`);
      }

      // Cache the credentials
      this.cache.set(secretName, {
        credentials,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      console.log(`[SecretManager] Successfully retrieved credentials for ${secretName}`);
      return credentials;
    } catch (error) {
      console.error(`[SecretManager] Failed to retrieve secret ${secretName}:`, error);
      throw new Error(`Failed to retrieve credentials for ${secretName}: ${(error as Error).message}`);
    }
  }

  /**
   * Check if Secret Manager is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.projectId) {
      return false;
    }

    try {
      // Try to list secrets (just 1) to verify access
      const [secrets] = await this.client.listSecrets({
        parent: `projects/${this.projectId}`,
        pageSize: 1,
      });
      return true;
    } catch (error) {
      console.warn('[SecretManager] Not available:', (error as Error).message);
      return false;
    }
  }

  /**
   * Get credentials without validation (for API-based vendors)
   * Use this for vendors that don't use username/password authentication
   * @param secretName Name of the secret in Secret Manager
   * @returns Raw credentials of type T
   */
  async getCredentialsRaw<T>(secretName: string): Promise<T> {
    // Check cache first (using same cache key mechanism)
    const cached = this.cache.get(secretName);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[SecretManager] Cache hit for ${secretName} (raw)`);
      return cached.credentials as unknown as T;
    }

    // Fetch from Secret Manager
    console.log(`[SecretManager] Fetching secret (raw): ${secretName}`);

    if (!this.projectId) {
      throw new Error('Project ID not configured. Set GOOGLE_CLOUD_PROJECT environment variable.');
    }

    const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;

    try {
      const [version] = await this.client.accessSecretVersion({ name });

      if (!version.payload?.data) {
        throw new Error(`Secret ${secretName} has no data`);
      }

      // Parse the secret payload as JSON without validation
      const secretData = version.payload.data.toString();
      const credentials = JSON.parse(secretData) as T;

      // Cache the credentials (store as VendorCredentials for cache compatibility)
      this.cache.set(secretName, {
        credentials: credentials as unknown as VendorCredentials,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      console.log(`[SecretManager] Successfully retrieved raw credentials for ${secretName}`);
      return credentials;
    } catch (error) {
      console.error(`[SecretManager] Failed to retrieve secret ${secretName}:`, error);
      throw new Error(`Failed to retrieve credentials for ${secretName}: ${(error as Error).message}`);
    }
  }

  /**
   * Clear cached credentials
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[SecretManager] Cache cleared');
  }
}

// Singleton instance
let instance: SecretManager | null = null;

/**
 * Get the SecretManager singleton instance
 */
export function getSecretManager(): SecretManager {
  if (!instance) {
    instance = new SecretManager();
  }
  return instance;
}
