import { fantasyAPI } from './api';
import teamService from './teamService';
import { extractArray } from '../utils/helpers';
import { extractTeamPlayers } from '../utils/fetchAllTeamsData';
import { getClauseLockState } from '../utils/clauseUtils';
import { validateClauseAmount } from '../utils/validation';

const BID_LEAD_MS = 30 * 1000;

export const computeBidExecutionTime = (expirationDate) => {
  const expirationMs = new Date(expirationDate).getTime();
  return Number.isFinite(expirationMs) ? new Date(expirationMs - BID_LEAD_MS).toISOString() : null;
};

const responseSucceeded = (response) => response?.status === 200 || response?.status === 204;

const ambiguousPostError = (error) =>
  !error?.response || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(error?.code);

const retryableReadError = (message, now, delayMs = 15_000) => ({
  status: 'reschedule',
  executeAt: new Date(now + delayMs).toISOString(),
  resultMessage: message,
});

export const executeClauseAutomation = async (action, { api = fantasyAPI, now = Date.now() } = {}) => {
  let teamResponse;
  try {
    teamResponse = await api.getTeamData(action.leagueId, action.sellerTeamId, { fresh: true });
  } catch (_error) {
    return retryableReadError('No se pudo comprobar la cláusula; se reintentará.', now, 30_000);
  }

  const playerTeam = extractTeamPlayers(teamResponse).find((entry) =>
    String(entry.playerTeamId || entry.id) === String(action.playerTeamId) ||
    String(entry.playerMaster?.id) === String(action.playerId)
  );
  if (!playerTeam?.playerMaster || !playerTeam.buyoutClause) {
    return { status: 'skipped', resultMessage: 'El jugador ya no pertenece al equipo original.' };
  }

  const currentAmount = Number(playerTeam.buyoutClause);
  if (!validateClauseAmount(currentAmount)) {
    return { status: 'failed', resultMessage: 'La cláusula actual no es válida.' };
  }
  if (currentAmount > Number(action.maxAmount)) {
    return {
      status: 'skipped',
      resultMessage: `Cláusula de ${currentAmount}€ superior al máximo autorizado.`,
      actualAmount: currentAmount,
    };
  }

  const lockState = getClauseLockState(playerTeam.buyoutClauseLockedEndTime);
  if (!lockState.isOpen) {
    return {
      status: 'reschedule',
      executeAt: playerTeam.buyoutClauseLockedEndTime,
      resultMessage: 'La cláusula continúa bloqueada; se ajustó la hora.',
      actualAmount: currentAmount,
    };
  }

  try {
    const response = await api.payBuyoutClause(
      action.leagueId,
      playerTeam.playerTeamId || playerTeam.id,
      currentAmount
    );
    if (!responseSucceeded(response)) {
      return { status: 'failed', resultMessage: 'La API no confirmó el pago de la cláusula.' };
    }
    return {
      status: 'completed',
      actualAmount: currentAmount,
      resultMessage: `Cláusula pagada por ${currentAmount}€.`,
    };
  } catch (error) {
    return {
      status: ambiguousPostError(error) ? 'unknown' : 'failed',
      resultMessage: error.response?.data?.message || error.message || 'Error al pagar la cláusula.',
    };
  }
};

export const executeBidAutomation = async (action, { api = fantasyAPI, now = Date.now() } = {}) => {
  let marketResponse;
  try {
    marketResponse = await api.getMarket(action.leagueId, { fresh: true });
  } catch (_error) {
    const expirationMs = new Date(action.expiresAt).getTime();
    if (expirationMs - now <= 5_000) {
      return { status: 'failed', resultMessage: 'No se pudo comprobar el mercado antes del cierre.' };
    }
    return retryableReadError('No se pudo comprobar el mercado; se reintentará.', now, 3_000);
  }

  const marketItem = extractArray(marketResponse).find((entry) =>
    String(entry.id) === String(action.marketId) &&
    String(entry.playerMaster?.id || entry.player?.id) === String(action.playerId)
  );
  if (!marketItem) {
    return { status: 'skipped', resultMessage: 'El jugador ya no está en el mercado.' };
  }
  if (marketItem.bid?.status === 'pending') {
    return { status: 'skipped', resultMessage: 'Ya existe una puja activa para este jugador.' };
  }

  const expiresAt = marketItem.expirationDate || action.expiresAt;
  const expirationMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expirationMs) || now >= expirationMs) {
    return { status: 'failed', resultMessage: 'El mercado terminó antes de poder enviar la puja.' };
  }

  const executeAt = computeBidExecutionTime(expiresAt);
  if (new Date(executeAt).getTime() > now) {
    return {
      status: 'reschedule',
      executeAt,
      expiresAt,
      resultMessage: 'La hora de cierre cambió; se reprogramó la puja.',
    };
  }

  const minimumBid = Math.max(Number(marketItem.salePrice || 0), Number(marketItem.playerMaster?.marketValue || 0));
  if (!Number.isFinite(action.amount) || action.amount < minimumBid) {
    return {
      status: 'skipped',
      resultMessage: `La puja programada es inferior al mínimo actual de ${minimumBid}€.`,
    };
  }

  try {
    const response = await api.makeBid(action.leagueId, marketItem.id, action.amount);
    if (!responseSucceeded(response)) {
      return { status: 'failed', resultMessage: 'La API no confirmó la puja.' };
    }
    const responseData = response.data || response;
    teamService.addOffer(action.playerId, action.amount, action.playerName, responseData?.id);
    return { status: 'completed', actualAmount: action.amount, resultMessage: `Puja enviada por ${action.amount}€.` };
  } catch (error) {
    return {
      status: ambiguousPostError(error) ? 'unknown' : 'failed',
      resultMessage: error.response?.data?.message || error.message || 'Error al enviar la puja.',
    };
  }
};

export const executeScheduledAction = (action, dependencies) => {
  if (action.type === 'clause') return executeClauseAutomation(action, dependencies);
  if (action.type === 'bid') return executeBidAutomation(action, dependencies);
  return Promise.resolve({ status: 'failed', resultMessage: 'Tipo de automatización desconocido.' });
};
