/**
 * check-machine-id.ts
 *
 * Run on ANY machine to see the Machine ID the platform will generate.
 * Use this to verify the ID matches what the License tab shows.
 *
 * Usage (from project root):
 *   npx tsx tools/check-machine-id.ts
 */

import { getMachineIdComponents } from '../src/utils/licenseManager';

const c = getMachineIdComponents();

console.log('\n=======================================================');
console.log('  QA Agent Platform — Machine ID Checker');
console.log('=======================================================\n');
console.log(`  Machine ID        :  ${c.machineId}`);
console.log('\n--- Signal breakdown (most stable -> least stable) ---\n');
console.log(`  S1 Windows GUID   :  ${c.windowsMachineGuid  || '(not available)'}`);
console.log(`  S2 BIOS UUID      :  ${c.biosUuid            || '(not available)'}`);
console.log(`  S3 Volume Serial  :  ${c.volumeSerial        || '(not available)'}`);
console.log(`  S4 Physical MAC   :  ${c.stableMAC           || '(not available - virtual adapters filtered)'}`);
console.log(`  S5 Hostname       :  ${c.hostname}`);
console.log(`  S5 CPU Model      :  ${c.cpuModel}`);
console.log(`  S5 Platform/Arch  :  ${c.platform} / ${c.arch}`);
console.log('\n--- Stability assessment ---\n');
const signals = [c.windowsMachineGuid, c.biosUuid, c.volumeSerial, c.stableMAC].filter(Boolean);
if (signals.length >= 3) {
  console.log('  [EXCELLENT] 3+ hardware signals found. ID is highly stable.');
  console.log('  Safe to issue a machine-bound license.');
} else if (signals.length === 2) {
  console.log('  [GOOD] 2 hardware signals found. ID is stable for normal use.');
  console.log('  Safe to issue a machine-bound license.');
} else if (signals.length === 1) {
  console.log('  [FAIR] Only 1 hardware signal found. ID may change if that signal changes.');
  console.log('  Consider issuing a time-limited or seat-based license instead.');
} else {
  console.log('  [WEAK] No hardware signals found — OS-level signals only.');
  console.log('  DO NOT issue a machine-bound license. Use seat-based instead.');
}
console.log('\n=======================================================');
console.log('  Compare the Machine ID above with Admin -> License tab.');
console.log('  Send this full output to your vendor when requesting');
console.log('  a paid license.');
console.log('=======================================================\n');
