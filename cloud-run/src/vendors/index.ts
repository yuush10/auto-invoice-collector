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

// Vendor implementations
export { AitemasuVendor } from './AitemasuVendor';
export { IBJVendor } from './IBJVendor';
export { GoogleAdsVendor } from './GoogleAdsVendor';

// Register vendors on module load
import { AitemasuVendor } from './AitemasuVendor';
import { IBJVendor } from './IBJVendor';
import { GoogleAdsVendor } from './GoogleAdsVendor';
import { registerVendor } from './VendorRegistry';

registerVendor(new AitemasuVendor());
registerVendor(new IBJVendor());
registerVendor(new GoogleAdsVendor());
