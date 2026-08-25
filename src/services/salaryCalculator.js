export const STARTING_CASH = 100_000_000;
export const EXPECTED_STARTING_PLAYERS = 14;

const BUY_TYPES = new Set([1, 31, 32]);
const SELL_TYPES = new Set([6, 33]);
const MANAGER_TRANSFER_TYPES = new Set([1, 32]);
const KNOWN_NON_MONEY_TYPES = new Set([4, 7, 9]);

const asId = (value) => (value === null || value === undefined ? null : String(value));
const asMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const unwrapArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.elements)) return value.data.elements;
  if (Array.isArray(value?.elements)) return value.elements;
  return [];
};

export const normalizeSalaryManagers = (standings) => unwrapArray(standings)
  .map((entry) => {
    const team = entry?.team || entry;
    const manager = team?.manager || entry?.manager || {};
    const managerId = asId(manager.id ?? team?.managerId ?? entry?.managerId);
    const teamId = asId(team?.id ?? entry?.teamId);
    if (!managerId || !teamId) return null;
    return {
      managerId,
      teamId,
      managerName: manager.managerName || manager.name || entry?.managerName || 'Manager',
      avatar: manager.avatar || null,
      currentTeamValue: asMoney(team.teamValue ?? entry?.teamValue),
      points: asMoney(entry?.points ?? team.teamPoints ?? team.points),
    };
  })
  .filter(Boolean);

export const findJoinDates = (activities) => {
  const result = new Map();
  unwrapArray(activities).forEach((activity) => {
    if (Number(activity?.activityTypeId) !== 9 || !activity?.createdAt) return;
    const managerId = asId(activity.user1Id);
    if (!managerId) return;
    const previous = result.get(managerId);
    if (!previous || new Date(activity.createdAt) < new Date(previous)) {
      result.set(managerId, activity.createdAt);
    }
  });
  return result;
};

const getTeamPlayers = (teamData) => unwrapArray(teamData?.players || teamData?.data?.players);
const getPlayerMasterId = (player) => asId(
  player?.playerMaster?.id ?? player?.playerMasterId ?? player?.player?.id ?? player?.id
);

/**
 * Recorre el mercado hacia atrás desde las plantillas actuales. Así recupera
 * los 14 jugadores que recibió cada manager al entrar en la liga.
 */
export const reconstructInitialRosters = ({ managers, teamDataByTeamId, activities }) => {
  const joinDates = findJoinDates(activities);
  const rosters = new Map();

  managers.forEach((manager) => {
    const currentPlayers = getTeamPlayers(teamDataByTeamId.get(manager.teamId));
    rosters.set(
      manager.managerId,
      new Set(currentPlayers.map(getPlayerMasterId).filter(Boolean))
    );
  });

  const wasAlreadyInLeague = (managerId, activity) => {
    const joinedAt = joinDates.get(managerId);
    return !joinedAt || !activity?.createdAt
      || new Date(activity.createdAt).getTime() >= new Date(joinedAt).getTime();
  };

  [...unwrapArray(activities)]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .forEach((activity) => {
      const type = Number(activity.activityTypeId);
      const playerId = asId(activity.playerMasterId ?? activity.playerId);
      const buyerId = asId(activity.user1Id);
      const sellerId = asId(activity.user2Id);
      if (!playerId) return;

      if (MANAGER_TRANSFER_TYPES.has(type)) {
        if (rosters.has(buyerId) && wasAlreadyInLeague(buyerId, activity)) {
          rosters.get(buyerId).delete(playerId);
        }
        if (rosters.has(sellerId) && wasAlreadyInLeague(sellerId, activity)) {
          rosters.get(sellerId).add(playerId);
        }
        return;
      }

      if (type === 31 && rosters.has(buyerId) && wasAlreadyInLeague(buyerId, activity)) {
        rosters.get(buyerId).delete(playerId);
      }
      if (type === 33 && rosters.has(buyerId) && wasAlreadyInLeague(buyerId, activity)) {
        rosters.get(buyerId).add(playerId);
      }
    });

  return { rosters, joinDates };
};

const calendarDay = (date) => {
  if (!date) return null;
  const match = String(date).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date(date).toISOString().slice(0, 10);
};

export const getMarketValueOnDate = (history, date) => {
  if (!date) return null;
  const rows = unwrapArray(history)
    .filter((row) => row?.date && Number.isFinite(Number(row.marketValue)))
    .sort((a, b) => calendarDay(a.date).localeCompare(calendarDay(b.date)));
  if (rows.length === 0) return null;

  const targetDay = calendarDay(date);
  const onOrBefore = rows.filter((row) => calendarDay(row.date) <= targetDay);
  const selected = onOrBefore[onOrBefore.length - 1] || rows[0];
  return asMoney(selected.marketValue);
};

export const calculateObservedLedger = (managerId, activities, joinedAt = null) => {
  const id = asId(managerId);
  const joinedTime = joinedAt ? new Date(joinedAt).getTime() : null;
  let purchases = 0;
  let sales = 0;
  let rewards = 0;
  let receivedFromManagers = 0;
  let unknownMoney = 0;

  unwrapArray(activities).forEach((activity) => {
    if (joinedTime && activity?.createdAt && new Date(activity.createdAt).getTime() < joinedTime) return;
    const type = Number(activity?.activityTypeId);
    const amount = asMoney(activity?.amount);
    const actorId = asId(activity?.user1Id);
    const counterpartyId = asId(activity?.user2Id);

    if (actorId === id && BUY_TYPES.has(type)) purchases += amount;
    if (actorId === id && type === 33) sales += amount;
    if (actorId === id && type === 6) rewards += amount;
    if (counterpartyId === id && MANAGER_TRANSFER_TYPES.has(type)) receivedFromManagers += amount;

    const isKnown = BUY_TYPES.has(type) || SELL_TYPES.has(type) || KNOWN_NON_MONEY_TYPES.has(type);
    if (amount && (actorId === id || counterpartyId === id) && !isKnown) unknownMoney += amount;
  });

  const income = sales + rewards + receivedFromManagers;
  return {
    purchases,
    sales,
    rewards,
    receivedFromManagers,
    income,
    expenses: purchases,
    netActivity: income - purchases,
    observedBalance: STARTING_CASH + income - purchases,
    unknownMoney,
  };
};

/**
 * La API solo revela el saldo del usuario autenticado. Ese saldo se usa como
 * ancla para inferir el umbral de compensación inicial de la liga. Para los
 * rivales el resultado sigue siendo una estimación: recompensas diarias y
 * otros movimientos que no aparecen en Actividad no se pueden observar.
 */
export const calculateSalaryReport = ({
  managers,
  activities,
  rosters,
  joinDates,
  marketHistoryByPlayerId,
  currentManagerId,
  currentBalance,
  historyComplete = true,
}) => {
  const ownId = asId(currentManagerId);
  const initialRows = managers.map((manager) => {
    const roster = rosters.get(manager.managerId) || new Set();
    const joinedAt = joinDates.get(manager.managerId) || null;
    let startingTeamValue = 0;
    let valuedPlayers = 0;

    roster.forEach((playerId) => {
      const value = getMarketValueOnDate(marketHistoryByPlayerId.get(playerId), joinedAt);
      if (value !== null) {
        startingTeamValue += value;
        valuedPlayers += 1;
      }
    });

    return {
      ...manager,
      joinedAt,
      startingPlayers: roster.size,
      valuedPlayers,
      startingTeamValue,
      initialValueComplete: Boolean(joinedAt) && roster.size > 0 && valuedPlayers === roster.size,
      ...calculateObservedLedger(manager.managerId, activities, joinedAt),
    };
  });

  const hasCurrentBalance = currentBalance !== null
    && currentBalance !== undefined
    && Number.isFinite(Number(currentBalance));
  const numericCurrentBalance = hasCurrentBalance ? Number(currentBalance) : null;
  const ownRow = initialRows.find((row) => row.managerId === ownId);
  const canCalibrate = ownRow?.initialValueComplete && hasCurrentBalance;
  const ownUnobservedAdjustment = canCalibrate
    ? numericCurrentBalance - ownRow.observedBalance
    : null;
  const startingValueReference = canCalibrate && ownUnobservedAdjustment >= 0
    ? ownRow.startingTeamValue + ownUnobservedAdjustment
    : null;

  const rows = initialRows.map((row) => {
    const calibratedCompensation = startingValueReference !== null && row.initialValueComplete
      ? Math.max(0, startingValueReference - row.startingTeamValue)
      : 0;
    const estimatedBalance = row.observedBalance + calibratedCompensation;
    const isCurrentUser = row.managerId === ownId;
    return {
      ...row,
      calibratedCompensation,
      estimatedBalance,
      displayedBalance: isCurrentUser && hasCurrentBalance
        ? numericCurrentBalance
        : estimatedBalance,
      isCurrentUser,
      isExactBalance: isCurrentUser && hasCurrentBalance,
      reconstructionComplete: historyComplete
        && row.startingPlayers === EXPECTED_STARTING_PLAYERS
        && row.initialValueComplete
        && row.unknownMoney === 0,
    };
  });

  return {
    rows: rows.sort((a, b) => b.displayedBalance - a.displayedBalance),
    startingValueReference,
    ownUnobservedAdjustment,
    currentBalance: hasCurrentBalance ? numericCurrentBalance : null,
  };
};
