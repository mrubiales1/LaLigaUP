import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const AUTOMATION_STATUS = {
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
};

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `automation_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const samePendingTarget = (left, right) =>
  left.status === AUTOMATION_STATUS.PENDING &&
  left.type === right.type &&
  String(left.userId) === String(right.userId) &&
  String(left.leagueId) === String(right.leagueId) &&
  String(left.playerId) === String(right.playerId);

export const useAutomationStore = create(
  persist(
    (set, get) => ({
      actions: [],

      scheduleAction: (actionData) => {
        const now = new Date().toISOString();
        const current = get().actions;
        const existing = current.find((action) => samePendingTarget(action, actionData));
        const action = {
          id: existing?.id || createId(),
          status: AUTOMATION_STATUS.PENDING,
          attempts: 0,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          lastError: null,
          resultMessage: null,
          ...actionData,
        };

        set({
          actions: existing
            ? current.map((item) => item.id === existing.id ? action : item)
            : [...current, action],
        });
        return action;
      },

      updateAction: (actionId, updates) => set((state) => ({
        actions: state.actions.map((action) => action.id === actionId
          ? { ...action, ...updates, updatedAt: new Date().toISOString() }
          : action),
      })),

      cancelAction: (actionId) => {
        const action = get().actions.find((item) => item.id === actionId);
        if (!action || action.status !== AUTOMATION_STATUS.PENDING) return false;
        get().updateAction(actionId, {
          status: AUTOMATION_STATUS.CANCELLED,
          resultMessage: 'Cancelada por el usuario',
          finishedAt: new Date().toISOString(),
        });
        return true;
      },

      deleteAction: (actionId) => set((state) => ({
        actions: state.actions.filter((action) => action.id !== actionId),
      })),

      recoverInterruptedActions: (userId) => set((state) => ({
        actions: state.actions.map((action) =>
          action.status === AUTOMATION_STATUS.EXECUTING && String(action.userId) === String(userId)
            ? {
                ...action,
                status: AUTOMATION_STATUS.UNKNOWN,
                resultMessage: 'La app se cerró durante la ejecución. No se reintentará para evitar duplicados.',
                finishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : action
        ),
      })),

      clearFinished: (userId, leagueId) => set((state) => ({
        actions: state.actions.filter((action) =>
          String(action.userId) !== String(userId) ||
          String(action.leagueId) !== String(leagueId) ||
          [AUTOMATION_STATUS.PENDING, AUTOMATION_STATUS.EXECUTING].includes(action.status)
        ),
      })),
    }),
    {
      name: 'laligaup-automations',
      version: 1,
      partialize: (state) => ({ actions: state.actions }),
    }
  )
);

export default useAutomationStore;
