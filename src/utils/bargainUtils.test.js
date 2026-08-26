import { buildBargains, getBargainClauseState, selectProfitableBidCandidates } from './bargainUtils';

const NOW = new Date('2026-08-26T10:00:00Z').getTime();
const player = (id) => ({ id, nickname: `Jugador ${id}` });
const clause = (id, price, hours) => ({
  player: player(id),
  buyoutClause: price,
  buyoutClauseLockedEndTime: hours === null ? null : new Date(NOW + hours * 3600000).toISOString(),
});

describe('bargainUtils', () => {
  test('clasifica abierta, próxima (<48h) y cerrada', () => {
    expect(getBargainClauseState(null, NOW).key).toBe('open');
    expect(getBargainClauseState(new Date(NOW + 47 * 3600000), NOW).key).toBe('soon');
    expect(getBargainClauseState(new Date(NOW + 48 * 3600000), NOW).key).toBe('locked');
  });

  test('filtra por margen y ordena por estado y oportunidad', () => {
    const maxBids = { 1: 10_000_000, 2: 8_000_000, 3: 6_000_000, 4: 5_000_000 };
    const result = buildBargains(
      [clause(3, 5_500_000, 80), clause(2, 9_000_000, 20), clause(1, 9_000_000, null), clause(4, 7_100_000, null)],
      (p) => ({ maxProfitableBid: maxBids[p.id] }),
      2_000_000,
      NOW
    );

    expect(result.map((item) => item.player.id)).toEqual([1, 2, 3]);
    expect(result[0].difference).toBe(-1_000_000);
  });

  test('solo consulta la ficha rentable de jugadores con subida diaria', () => {
    const clauses = [clause(1, 1_000_000, null), clause(2, 1_000_000, null), clause(3, 1_000_000, null)];
    const changes = { 1: 150_000, 2: 0, 3: -20_000 };
    expect(selectProfitableBidCandidates(clauses, (item) => ({ diferencia1: changes[item.id] })))
      .toEqual([clauses[0]]);
  });
});
