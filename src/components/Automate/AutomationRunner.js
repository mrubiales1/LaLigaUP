import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { startAutomationEngine, stopAutomationEngine } from '../../services/automationEngine';
import { useAutomationStore, AUTOMATION_STATUS } from '../../stores/automationStore';
import nativeAutomationService from '../../services/nativeAutomationService';
import { App as CapacitorApp } from '@capacitor/app';

const AutomationRunner = () => {
  const userId = useAuthStore((state) => state.user?.userId || state.user?.id);
  const tokens = useAuthStore((state) => state.tokens);
  const actions = useAutomationStore((state) => state.actions);

  useEffect(() => {
    if (!userId) return undefined;
    if (nativeAutomationService.isAvailable()) return undefined;
    startAutomationEngine(userId);
    return () => stopAutomationEngine();
  }, [userId]);

  useEffect(() => {
    if (!userId || !nativeAutomationService.isAvailable()) return undefined;
    let cancelled = false;

    const reconcileAndSync = async () => {
      try {
        const nativeState = await nativeAutomationService.getResults();
        if (cancelled) return;
        const nativeResults = nativeState.results || [];
        for (const result of nativeResults) {
          useAutomationStore.getState().updateAction(result.id, result);
        }
        if (nativeState.tokens) {
          await useAuthStore.getState().syncTokensFromNative(nativeState.tokens);
        }
        if (nativeResults.length) {
          await nativeAutomationService.acknowledgeResults(nativeResults.map((result) => result.id));
        }
        const pending = useAutomationStore.getState().actions.filter((action) =>
          String(action.userId) === String(userId) &&
          action.status === AUTOMATION_STATUS.PENDING
        );
        await nativeAutomationService.sync(pending, useAuthStore.getState().tokens);
      } catch (error) {
        // The page exposes capability/permission errors; keep the global
        // runner silent to avoid repeated toasts on every state change.
        console.warn('[AutomationRunner:nativeSync]', error);
      }
    };

    reconcileAndSync();
    const interval = setInterval(reconcileAndSync, 15_000);
    let appStateListener;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) reconcileAndSync();
    }).then((listener) => { appStateListener = listener; });

    return () => {
      cancelled = true;
      clearInterval(interval);
      appStateListener?.remove();
    };
  }, [userId, actions, tokens]);

  return null;
};

export default AutomationRunner;
