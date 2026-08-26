import teamService from './teamService';
import {
  computeBidExecutionTime,
  executeBidAutomation,
  executeClauseAutomation,
} from './automationExecutor';

jest.mock('./teamService', () => ({
  __esModule: true,
  default: { addOffer: jest.fn() },
}));

const playerTeam = (overrides = {}) => ({
  playerTeamId: 'pt-1',
  buyoutClause: 20_000_000,
  buyoutClauseLockedEndTime: null,
  playerMaster: { id: 'player-1', nickname: 'Prueba' },
  ...overrides,
});

const clauseAction = (overrides = {}) => ({
  type: 'clause',
  leagueId: 'league-1',
  sellerTeamId: 'seller-1',
  playerTeamId: 'pt-1',
  playerId: 'player-1',
  playerName: 'Prueba',
  maxAmount: 25_000_000,
  ...overrides,
});

const marketItem = (overrides = {}) => ({
  id: 'market-1',
  salePrice: 10_000_000,
  expirationDate: '2030-01-01T12:00:00.000Z',
  playerMaster: { id: 'player-1', nickname: 'Prueba', marketValue: 9_000_000 },
  ...overrides,
});

const bidAction = (overrides = {}) => ({
  type: 'bid',
  leagueId: 'league-1',
  marketId: 'market-1',
  playerId: 'player-1',
  playerName: 'Prueba',
  amount: 11_000_000,
  expiresAt: '2030-01-01T12:00:00.000Z',
  ...overrides,
});

describe('automationExecutor (solo APIs simuladas)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('programa una puja exactamente 30 segundos antes del cierre', () => {
    expect(computeBidExecutionTime('2030-01-01T12:00:00.000Z'))
      .toBe('2030-01-01T11:59:30.000Z');
  });

  test('no paga si la cláusula actual supera el máximo autorizado', async () => {
    const api = {
      getTeamData: jest.fn().mockResolvedValue({ data: { players: [playerTeam({ buyoutClause: 26_000_000 })] } }),
      payBuyoutClause: jest.fn(),
    };
    const result = await executeClauseAutomation(clauseAction(), { api });
    expect(result.status).toBe('skipped');
    expect(api.getTeamData).toHaveBeenCalledWith('league-1', 'seller-1', { fresh: true });
    expect(api.payBuyoutClause).not.toHaveBeenCalled();
  });

  test('reprograma una cláusula que sigue bloqueada sin intentar pagar', async () => {
    const unlockAt = new Date(Date.now() + 60_000).toISOString();
    const api = {
      getTeamData: jest.fn().mockResolvedValue({ data: { players: [playerTeam({ buyoutClauseLockedEndTime: unlockAt })] } }),
      payBuyoutClause: jest.fn(),
    };
    const result = await executeClauseAutomation(clauseAction(), { api });
    expect(result).toMatchObject({ status: 'reschedule', executeAt: unlockAt });
    expect(api.payBuyoutClause).not.toHaveBeenCalled();
  });

  test('paga una cláusula una sola vez tras revalidar precio y bloqueo', async () => {
    const api = {
      getTeamData: jest.fn().mockResolvedValue({ data: { players: [playerTeam()] } }),
      payBuyoutClause: jest.fn().mockResolvedValue({ status: 204 }),
    };
    const result = await executeClauseAutomation(clauseAction(), { api });
    expect(result.status).toBe('completed');
    expect(api.payBuyoutClause).toHaveBeenCalledTimes(1);
    expect(api.payBuyoutClause).toHaveBeenCalledWith('league-1', 'pt-1', 20_000_000);
  });

  test('ajusta la puja si el mercado cambia su hora de cierre', async () => {
    const now = new Date('2030-01-01T11:58:00.000Z').getTime();
    const api = {
      getMarket: jest.fn().mockResolvedValue({ data: [marketItem()] }),
      makeBid: jest.fn(),
    };
    const result = await executeBidAutomation(bidAction(), { api, now });
    expect(result.status).toBe('reschedule');
    expect(result.executeAt).toBe('2030-01-01T11:59:30.000Z');
    expect(api.makeBid).not.toHaveBeenCalled();
  });

  test('envía la puja una sola vez dentro de la ventana de 30 segundos', async () => {
    const now = new Date('2030-01-01T11:59:35.000Z').getTime();
    const api = {
      getMarket: jest.fn().mockResolvedValue({ data: [marketItem()] }),
      makeBid: jest.fn().mockResolvedValue({ status: 200, data: { id: 'bid-1' } }),
    };
    const result = await executeBidAutomation(bidAction(), { api, now });
    expect(result.status).toBe('completed');
    expect(api.makeBid).toHaveBeenCalledTimes(1);
    expect(api.makeBid).toHaveBeenCalledWith('league-1', 'market-1', 11_000_000);
    expect(teamService.addOffer).toHaveBeenCalledWith('player-1', 11_000_000, 'Prueba', 'bid-1');
  });

  test('una respuesta POST ambigua queda como incierta y no se reintenta aquí', async () => {
    const now = new Date('2030-01-01T11:59:35.000Z').getTime();
    const api = {
      getMarket: jest.fn().mockResolvedValue({ data: [marketItem()] }),
      makeBid: jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
    };
    const result = await executeBidAutomation(bidAction(), { api, now });
    expect(result.status).toBe('unknown');
    expect(api.makeBid).toHaveBeenCalledTimes(1);
  });
});
