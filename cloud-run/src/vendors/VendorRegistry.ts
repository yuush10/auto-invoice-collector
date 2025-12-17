/**
 * Vendor Registry
 * Manages vendor implementations and provides lookup functionality
 */
import { VendorAutomation, VendorConfig, VENDOR_WHITELIST, getVendorConfig } from './types';

/**
 * Registry for vendor automation implementations
 */
class VendorRegistry {
  private vendors: Map<string, VendorAutomation> = new Map();

  /**
   * Register a vendor implementation
   */
  register(vendor: VendorAutomation): void {
    console.log(`[VendorRegistry] Registering vendor: ${vendor.vendorKey}`);
    this.vendors.set(vendor.vendorKey, vendor);
  }

  /**
   * Get a vendor implementation by key
   */
  get(vendorKey: string): VendorAutomation | undefined {
    return this.vendors.get(vendorKey);
  }

  /**
   * Check if a vendor is registered
   */
  has(vendorKey: string): boolean {
    return this.vendors.has(vendorKey);
  }

  /**
   * Get all registered vendors
   */
  getAll(): VendorAutomation[] {
    return Array.from(this.vendors.values());
  }

  /**
   * Get all registered vendor keys
   */
  getAllKeys(): string[] {
    return Array.from(this.vendors.keys());
  }

  /**
   * Get vendor with its config
   */
  getWithConfig(vendorKey: string): { vendor: VendorAutomation; config: VendorConfig } | undefined {
    const vendor = this.vendors.get(vendorKey);
    const config = getVendorConfig(vendorKey);

    if (!vendor || !config) {
      return undefined;
    }

    return { vendor, config };
  }

  /**
   * Get available vendors (registered and whitelisted)
   */
  getAvailableVendors(): VendorConfig[] {
    return VENDOR_WHITELIST.filter(config =>
      config.enabled && this.vendors.has(config.vendorKey)
    );
  }

  /**
   * Get pending vendors (whitelisted but not registered)
   */
  getPendingVendors(): VendorConfig[] {
    return VENDOR_WHITELIST.filter(config =>
      config.enabled && !this.vendors.has(config.vendorKey)
    );
  }
}

// Singleton instance
const registry = new VendorRegistry();

/**
 * Get the vendor registry singleton
 */
export function getVendorRegistry(): VendorRegistry {
  return registry;
}

/**
 * Register a vendor implementation
 * Shorthand for getVendorRegistry().register(vendor)
 */
export function registerVendor(vendor: VendorAutomation): void {
  registry.register(vendor);
}

/**
 * Get a vendor by key
 * Shorthand for getVendorRegistry().get(vendorKey)
 */
export function getVendor(vendorKey: string): VendorAutomation | undefined {
  return registry.get(vendorKey);
}
