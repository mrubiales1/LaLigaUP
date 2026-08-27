import { registerPlugin } from '@capacitor/core';
import { isAndroidPlatform } from '../utils/platform';

const NativeAutomation = registerPlugin('Automation');

const nativeAutomationService = {
  isAvailable: () => isAndroidPlatform(),
  getCapabilities: () => isAndroidPlatform()
    ? NativeAutomation.getCapabilities()
    : Promise.resolve({ available: false, exactAlarmPermission: false }),
  requestExactAlarmPermission: () => isAndroidPlatform()
    ? NativeAutomation.requestExactAlarmPermission()
    : Promise.resolve({ opened: false }),
  sync: (actions, tokens) => isAndroidPlatform()
    ? NativeAutomation.sync({ actions, tokens: tokens || {} })
    : Promise.resolve({ scheduled: 0 }),
  getResults: () => isAndroidPlatform()
    ? NativeAutomation.getResults()
    : Promise.resolve({ results: [] }),
  acknowledgeResults: (ids) => isAndroidPlatform()
    ? NativeAutomation.acknowledgeResults({ ids })
    : Promise.resolve(),
};

export default nativeAutomationService;
