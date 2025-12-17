/**
 * Vendor module exports
 */

// Types
export * from './types';

// Base class
export { BaseVendor } from './BaseVendor';

// Registry
export {
  getVendorRegistry,
  registerVendor,
  getVendor,
} from './VendorRegistry';

// Note: Individual vendor implementations will be added in Phase 3.2-3.4
// Example:
// export { IBJVendor } from './IBJVendor';
// export { AitemasuVendor } from './AitemasuVendor';
// export { GoogleAdsVendor } from './GoogleAdsVendor';
