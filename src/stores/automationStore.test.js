import { AUTOMATION_STATUS, useAutomationStore } from './automationStore';

const action = (overrides = {}) => ({
  type: 'bid',
  userId: 'user-1',
  leagueId: 'league-1',
  playerId: 'player-1',
  playerName: 'Prueba',
  marketId: 'market-1',
  amount: 10_000_000,
  executeAt: '2030-01-01T12:00:00.000Z',
  ...overrides,
});

describe('automationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAutomationStore.setState({ actions: [] });
  });

  test('actualiza una acción pendiente duplicada en vez de crear dos', () => {
    const store = useAutomationStore.getState();
    const first = store.scheduleAction(action());
    const second = useAutomationStore.getState().scheduleAction(action({ amount: 12_000_000 }));
    expect(second.id).toBe(first.id);
    expect(useAutomationStore.getState().actions).toHaveLength(1);
    expect(useAutomationStore.getState().actions[0].amount).toBe(12_000_000);
  });

  test('permite cancelar únicamente acciones pendientes', () => {
    const scheduled = useAutomationStore.getState().scheduleAction(action());
    expect(useAutomationStore.getState().cancelAction(scheduled.id)).toBe(true);
    expect(useAutomationStore.getState().actions[0].status).toBe(AUTOMATION_STATUS.CANCELLED);
    expect(useAutomationStore.getState().cancelAction(scheduled.id)).toBe(false);
  });

  test('no reintenta una acción interrumpida tras reiniciar la app', () => {
    const scheduled = useAutomationStore.getState().scheduleAction(action());
    useAutomationStore.getState().updateAction(scheduled.id, { status: AUTOMATION_STATUS.EXECUTING });
    useAutomationStore.getState().recoverInterruptedActions('user-1');
    expect(useAutomationStore.getState().actions[0].status).toBe(AUTOMATION_STATUS.UNKNOWN);
  });
});
