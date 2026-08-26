import { getClauseTimeRemaining } from './clauseUtils';

const HOUR_MS = 60 * 60 * 1000;
const SOON_LIMIT_MS = 48 * HOUR_MS;

export const getBargainClauseState = (clauseEndTime, now = Date.now()) => {
  const unlockAt = clauseEndTime ? new Date(clauseEndTime).getTime() : 0;
  const remainingMs = unlockAt - now;

  if (!unlockAt || remainingMs <= 0) {
    return { key: 'open', rank: 0, isOpen: true, label: 'Cláusula abierta', timeRemaining: null };
  }
  if (remainingMs < SOON_LIMIT_MS) {
    return {
      key: 'soon',
      rank: 1,
      isOpen: false,
      label: 'Abre en menos de 2 días',
      timeRemaining: getClauseTimeRemaining(clauseEndTime),
    };
  }
  return {
    key: 'locked',
    rank: 2,
    isOpen: false,
    label: 'Cláusula cerrada',
    timeRemaining: getClauseTimeRemaining(clauseEndTime),
  };
};

/** Reduce drásticamente las fichas individuales a consultar usando la subida
 * diaria que ya viene en la respuesta global del mercado. */
export const selectProfitableBidCandidates = (clauses, resolveTrend) =>
  (clauses || []).filter((clause) => Number(resolveTrend(clause.player)?.diferencia1) > 0);

export const buildBargains = (clauses, resolveTrend, threshold = 2_000_000, now = Date.now()) =>
  (clauses || [])
    .map((clause) => {
      const trend = resolveTrend(clause.player);
      const maxProfitableBid = trend?.maxProfitableBid;
      if (!Number.isFinite(maxProfitableBid) || maxProfitableBid <= 0) return null;

      const clausePrice = Number(clause.buyoutClause || clause.clauseValue || 0);
      const difference = clausePrice - maxProfitableBid;
      if (!clausePrice || difference > threshold) return null;

      return {
        ...clause,
        clausePrice,
        maxProfitableBid,
        difference,
        trend,
        clauseState: getBargainClauseState(clause.buyoutClauseLockedEndTime, now),
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      a.clauseState.rank - b.clauseState.rank ||
      a.difference - b.difference ||
      b.maxProfitableBid - a.maxProfitableBid
    );
