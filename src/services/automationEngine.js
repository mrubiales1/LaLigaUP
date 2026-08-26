import toast from 'react-hot-toast';
import { executeScheduledAction } from './automationExecutor';
import { useAutomationStore, AUTOMATION_STATUS } from '../stores/automationStore';
import { queryClient } from '../utils/queryClient';

let intervalId = null;
let processing = false;
let activeUserId = null;

const finalStatuses = new Set([
  AUTOMATION_STATUS.COMPLETED,
  AUTOMATION_STATUS.SKIPPED,
  AUTOMATION_STATUS.FAILED,
  AUTOMATION_STATUS.UNKNOWN,
]);

const notifyResult = (action, result) => {
  const message = `${action.playerName}: ${result.resultMessage}`;
  if (result.status === AUTOMATION_STATUS.COMPLETED) toast.success(message, { duration: 8000 });
  else if (finalStatuses.has(result.status)) toast.error(message, { duration: 10000 });
};

export const processDueAutomations = async ({ userId = activeUserId, dependencies } = {}) => {
  if (!userId || processing) return [];
  if (process.env.NODE_ENV === 'test' && !dependencies) return [];
  if (process.env.REACT_APP_DISABLE_AUTOMATION_EXECUTION === 'true') return [];

  processing = true;
  const processed = [];
  try {
    const store = useAutomationStore.getState();
    const now = Date.now();
    const dueActions = store.actions
      .filter((action) =>
        action.status === AUTOMATION_STATUS.PENDING &&
        String(action.userId) === String(userId) &&
        new Date(action.executeAt).getTime() <= now
      )
      .sort((left, right) => new Date(left.executeAt) - new Date(right.executeAt));

    for (const action of dueActions) {
      // The user may cancel a later action while a previous due action is
      // awaiting the network. Re-read it before crossing the execution gate.
      const latestAction = useAutomationStore.getState().actions.find((item) => item.id === action.id);
      if (latestAction?.status !== AUTOMATION_STATUS.PENDING) continue;

      useAutomationStore.getState().updateAction(action.id, {
        status: AUTOMATION_STATUS.EXECUTING,
        attempts: (action.attempts || 0) + 1,
        startedAt: new Date().toISOString(),
      });

      let result;
      try {
        result = await executeScheduledAction(action, dependencies);
      } catch (error) {
        result = {
          status: AUTOMATION_STATUS.UNKNOWN,
          resultMessage: error.message || 'La ejecución terminó de forma inesperada y no se reintentará.',
        };
      }

      if (result.status === 'reschedule') {
        useAutomationStore.getState().updateAction(action.id, {
          status: AUTOMATION_STATUS.PENDING,
          executeAt: result.executeAt,
          expiresAt: result.expiresAt || action.expiresAt,
          resultMessage: result.resultMessage,
        });
      } else {
        useAutomationStore.getState().updateAction(action.id, {
          ...result,
          finishedAt: new Date().toISOString(),
        });
        notifyResult(action, result);
        queryClient.invalidateQueries({ queryKey: ['market', action.leagueId] });
        queryClient.invalidateQueries({ queryKey: ['bargainsClauses', action.leagueId] });
        queryClient.invalidateQueries({ queryKey: ['teamData', action.leagueId] });
      }
      processed.push({ actionId: action.id, ...result });
    }
  } finally {
    processing = false;
  }
  return processed;
};

export const startAutomationEngine = (userId) => {
  if (!userId) return;
  if (intervalId && String(activeUserId) === String(userId)) return;
  stopAutomationEngine();
  activeUserId = userId;
  useAutomationStore.getState().recoverInterruptedActions(userId);
  processDueAutomations({ userId });
  intervalId = setInterval(() => processDueAutomations({ userId }), 1000);
};

export const stopAutomationEngine = () => {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  activeUserId = null;
};
