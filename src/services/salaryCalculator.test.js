import {
  STARTING_CASH,
  calculateObservedLedger,
  calculateSalaryReport,
  findJoinDates,
  getMarketValueOnDate,
  reconstructInitialRosters,
} from './salaryCalculator';

const managers = [
  { managerId: 'a', teamId: 'ta', managerName: 'Ana', currentTeamValue: 50 },
  { managerId: 'b', teamId: 'tb', managerName: 'Berto', currentTeamValue: 60 },
];

const activities = [
  { id: 'j1', activityTypeId: 9, user1Id: 'a', createdAt: '2026-08-01T10:00:00+02:00' },
  { id: 'j2', activityTypeId: 9, user1Id: 'b', createdAt: '2026-08-01T10:01:00+02:00' },
  { id: 'buy-market', activityTypeId: 31, user1Id: 'a', playerMasterId: 'x', amount: 10, createdAt: '2026-08-02T10:00:00+02:00' },
  { id: 'sell-market', activityTypeId: 33, user1Id: 'a', playerMasterId: 'a2', amount: 5, createdAt: '2026-08-03T10:00:00+02:00' },
  { id: 'direct', activityTypeId: 1, user1Id: 'a', user2Id: 'b', playerMasterId: 'b1', amount: 7, createdAt: '2026-08-04T10:00:00+02:00' },
  { id: 'reward', activityTypeId: 6, user1Id: 'a', amount: 2, createdAt: '2026-08-05T10:00:00+02:00' },
];

const teamResponse = (ids) => ({
  data: {
    players: ids.map((id) => ({ playerMaster: { id } })),
  },
});

describe('salaryCalculator', () => {
  test('reconstruye las plantillas iniciales recorriendo el mercado hacia atrás', () => {
    const teamDataByTeamId = new Map([
      ['ta', teamResponse(['a1', 'x', 'b1'])],
      ['tb', teamResponse(['b2'])],
    ]);

    const { rosters } = reconstructInitialRosters({ managers, teamDataByTeamId, activities });

    expect([...rosters.get('a')].sort()).toEqual(['a1', 'a2']);
    expect([...rosters.get('b')].sort()).toEqual(['b1', 'b2']);
  });

  test('contabiliza una compra entre managers como gasto del comprador e ingreso del vendedor', () => {
    const joins = findJoinDates(activities);
    const ana = calculateObservedLedger('a', activities, joins.get('a'));
    const berto = calculateObservedLedger('b', activities, joins.get('b'));

    expect(ana).toMatchObject({
      purchases: 17,
      sales: 5,
      rewards: 2,
      receivedFromManagers: 0,
      observedBalance: STARTING_CASH - 10,
    });
    expect(berto).toMatchObject({
      purchases: 0,
      receivedFromManagers: 7,
      observedBalance: STARTING_CASH + 7,
    });
  });

  test('elige el valor de mercado del día de alta o el último anterior', () => {
    const history = { data: [
      { date: '2026-07-31T00:00:00+02:00', marketValue: 10 },
      { date: '2026-08-02T00:00:00+02:00', marketValue: 12 },
      { date: '2026-08-03T00:00:00+02:00', marketValue: 15 },
    ] };

    expect(getMarketValueOnDate(history, '2026-08-02T20:00:00+02:00')).toBe(12);
    expect(getMarketValueOnDate(history, '2026-08-01T20:00:00+02:00')).toBe(10);
    expect(getMarketValueOnDate(history, null)).toBeNull();
  });

  test('calibra la compensación inicial con el saldo real del usuario autenticado', () => {
    const joinDates = findJoinDates(activities);
    const rosters = new Map([
      ['a', new Set(['a1', 'a2'])],
      ['b', new Set(['b1', 'b2'])],
    ]);
    const history = (marketValue) => ({ data: [
      { date: '2026-08-01T00:00:00+02:00', marketValue },
    ] });
    const marketHistoryByPlayerId = new Map([
      ['a1', history(10)], ['a2', history(20)],
      ['b1', history(30)], ['b2', history(40)],
    ]);
    const observedAna = STARTING_CASH - 10;

    const report = calculateSalaryReport({
      managers,
      activities,
      rosters,
      joinDates,
      marketHistoryByPlayerId,
      currentManagerId: 'a',
      currentBalance: observedAna + 5,
    });
    const ana = report.rows.find((row) => row.managerId === 'a');
    const berto = report.rows.find((row) => row.managerId === 'b');

    expect(report.startingValueReference).toBe(35);
    expect(ana.calibratedCompensation).toBe(5);
    expect(ana.displayedBalance).toBe(observedAna + 5);
    expect(ana.isExactBalance).toBe(true);
    expect(berto.calibratedCompensation).toBe(0);
    expect(berto.displayedBalance).toBe(STARTING_CASH + 7);
  });

  test('no convierte un saldo oficial ausente en cero', () => {
    const joinDates = findJoinDates(activities);
    const rosters = new Map([
      ['a', new Set(['a1'])],
      ['b', new Set(['b1'])],
    ]);
    const marketHistoryByPlayerId = new Map([
      ['a1', { data: [{ date: '2026-08-01T00:00:00+02:00', marketValue: 10 }] }],
      ['b1', { data: [{ date: '2026-08-01T00:00:00+02:00', marketValue: 20 }] }],
    ]);

    const report = calculateSalaryReport({
      managers,
      activities,
      rosters,
      joinDates,
      marketHistoryByPlayerId,
      currentManagerId: 'a',
      currentBalance: null,
    });
    const ana = report.rows.find((row) => row.managerId === 'a');

    expect(report.currentBalance).toBeNull();
    expect(report.startingValueReference).toBeNull();
    expect(ana.isExactBalance).toBe(false);
    expect(ana.displayedBalance).toBe(ana.observedBalance);
  });
});
