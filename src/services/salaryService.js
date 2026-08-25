import { fantasyAPI } from './api';
import {
  calculateSalaryReport,
  normalizeSalaryManagers,
  reconstructInitialRosters,
} from './salaryCalculator';

const MAX_ACTIVITY_PAGES = 30;
const API_RETRIES = 3;

const extractArray = (response) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.elements)) return response.data.elements;
  if (Array.isArray(response?.elements)) return response.elements;
  return [];
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const withRetry = async (operation, attempts = API_RETRIES) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await delay(350 * (2 ** attempt));
    }
  }
  throw lastError;
};

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
};

export const fetchCompleteActivityHistory = async (leagueId) => {
  const activities = [];
  let complete = false;
  let failedPage = null;
  let pagesLoaded = 0;

  for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
    let response;
    try {
      response = await withRetry(() => fantasyAPI.getLeagueActivity(leagueId, page, {
        silent: true,
        timeout: 20_000,
      }));
    } catch (error) {
      failedPage = page;
      if (page === 0) throw error;
      break;
    }

    const pageItems = extractArray(response);
    if (pageItems.length === 0) {
      complete = true;
      break;
    }
    activities.push(...pageItems);
    pagesLoaded += 1;
  }

  const unique = [...new Map(
    activities.map((activity, index) => [String(activity.id ?? `${activity.createdAt}-${index}`), activity])
  ).values()];

  return {
    activities: unique,
    complete,
    failedPage,
    pagesLoaded,
  };
};

const getCurrentBalance = async (ownTeamId) => {
  if (!ownTeamId) return null;
  try {
    const response = await fantasyAPI.getTeamMoney(ownTeamId);
    const value = response?.data?.teamMoney ?? response?.teamMoney;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
};

export const fetchSalaryReport = async ({ leagueId, currentManagerId }) => {
  const [standingsResponse, activityHistory] = await Promise.all([
    fantasyAPI.getLeagueRanking(leagueId),
    fetchCompleteActivityHistory(leagueId),
  ]);
  const managers = normalizeSalaryManagers(standingsResponse);
  if (managers.length === 0) throw new Error('La liga no tiene managers disponibles');

  const teamResponses = await mapWithConcurrency(managers, 4, async (manager) => {
    const response = await withRetry(() => fantasyAPI.getTeamData(leagueId, manager.teamId));
    return [manager.teamId, response];
  });
  const teamDataByTeamId = new Map(teamResponses);
  const { rosters, joinDates } = reconstructInitialRosters({
    managers,
    teamDataByTeamId,
    activities: activityHistory.activities,
  });

  const playerIds = [...new Set(
    [...rosters.values()].flatMap((roster) => [...roster])
  )];
  const failedMarketHistories = [];
  const marketHistoryEntries = await mapWithConcurrency(playerIds, 6, async (playerId) => {
    try {
      const response = await withRetry(() => fantasyAPI.getPlayerMarketValue(playerId, {
        silent: true,
        timeout: 20_000,
      }), 2);
      return [playerId, response];
    } catch {
      failedMarketHistories.push(playerId);
      return [playerId, []];
    }
  });
  const marketHistoryByPlayerId = new Map(marketHistoryEntries);

  const ownId = currentManagerId === null || currentManagerId === undefined
    ? null
    : String(currentManagerId);
  const ownManager = managers.find((manager) => manager.managerId === ownId);
  const currentBalance = await getCurrentBalance(ownManager?.teamId);
  const report = calculateSalaryReport({
    managers,
    activities: activityHistory.activities,
    rosters,
    joinDates,
    marketHistoryByPlayerId,
    currentManagerId: ownId,
    currentBalance,
    historyComplete: activityHistory.complete && failedMarketHistories.length === 0,
  });

  return {
    ...report,
    coverage: {
      activityComplete: activityHistory.complete,
      failedActivityPage: activityHistory.failedPage,
      pagesLoaded: activityHistory.pagesLoaded,
      activities: activityHistory.activities.length,
      historicalPlayers: playerIds.length,
      failedMarketHistories,
      complete: activityHistory.complete && failedMarketHistories.length === 0,
    },
  };
};

export default fetchSalaryReport;
