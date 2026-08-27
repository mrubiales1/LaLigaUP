import React, { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarClock, Clock3, Gavel, Shield, Trash2, X, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { AUTOMATION_STATUS, useAutomationStore } from '../../stores/automationStore';
import { formatNumberWithDots } from '../../utils/helpers';
import nativeAutomationService from '../../services/nativeAutomationService';

const STATUS_INFO = {
  pending: { label: 'Pendiente', classes: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  executing: { label: 'Ejecutando', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  completed: { label: 'Completada', classes: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
  cancelled: { label: 'Cancelada', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  skipped: { label: 'Omitida', classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  failed: { label: 'Fallida', classes: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  unknown: { label: 'Resultado incierto', classes: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
};

const money = (value) => `${formatNumberWithDots(Math.round(Number(value) || 0))}€`;
const dateTime = (value) => value ? new Date(value).toLocaleString('es-ES') : 'Sin fecha';

const countdown = (executeAt, now) => {
  const remaining = Math.max(0, new Date(executeAt).getTime() - now);
  if (!Number.isFinite(remaining) || remaining === 0) return 'En ejecución';
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${secs}s`;
};

const ActionCard = ({ action, now, onCancel }) => {
  const isClause = action.type === 'clause';
  const Icon = isClause ? Shield : Gavel;
  const status = STATUS_INFO[action.status] || STATUS_INFO.failed;
  const isPending = action.status === AUTOMATION_STATUS.PENDING;

  return (
    <article className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex gap-4">
        {action.playerImage ? (
          <img src={action.playerImage} alt={action.playerName} className="w-16 h-16 rounded-lg object-contain bg-gray-50 dark:bg-gray-900" />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-violet-100 dark:bg-violet-950 flex items-center justify-center">
            <Icon className="w-7 h-7 text-violet-600" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white truncate">{action.playerName}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                <Icon className="w-4 h-4" /> {isClause ? 'Clausulazo' : 'Puja de mercado'}
              </p>
            </div>
            <span className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${status.classes}`}>{status.label}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-sm">
            <div>
              <div className="text-gray-500 dark:text-gray-400">{isClause ? 'Máximo autorizado' : 'Importe'}</div>
              <div className="font-bold text-gray-900 dark:text-white">{money(isClause ? action.maxAmount : action.amount)}</div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-gray-400">Programada para</div>
              <div className="font-medium text-gray-900 dark:text-white">{dateTime(action.executeAt)}</div>
            </div>
          </div>
          {isPending && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-sm text-violet-700 dark:text-violet-300">
              <span className="inline-flex items-center gap-1"><Clock3 className="w-4 h-4" /> {countdown(action.executeAt, now)}</span>
              <button type="button" onClick={() => onCancel(action.id)} className="inline-flex items-center gap-1 font-semibold hover:text-red-600">
                <X className="w-4 h-4" /> Cancelar
              </button>
            </div>
          )}
          {!isPending && action.resultMessage && (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{action.resultMessage}</p>
          )}
        </div>
      </div>
    </article>
  );
};

const Automate = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const userId = useAuthStore((state) => state.user?.userId || state.user?.id);
  const actions = useAutomationStore((state) => state.actions);
  const cancelAction = useAutomationStore((state) => state.cancelAction);
  const clearFinished = useAutomationStore((state) => state.clearFinished);
  const [now, setNow] = useState(Date.now());
  const [nativeCapabilities, setNativeCapabilities] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!nativeAutomationService.isAvailable()) return;
    nativeAutomationService.getCapabilities().then(setNativeCapabilities).catch(() => {});
  }, []);

  const visibleActions = useMemo(() => actions
    .filter((action) => String(action.userId) === String(userId) && String(action.leagueId) === String(leagueId))
    .sort((left, right) => new Date(left.executeAt || left.createdAt) - new Date(right.executeAt || right.createdAt)),
  [actions, userId, leagueId]);
  const pending = visibleActions.filter((action) => [AUTOMATION_STATUS.PENDING, AUTOMATION_STATUS.EXECUTING].includes(action.status));
  const history = visibleActions.filter((action) => ![AUTOMATION_STATUS.PENDING, AUTOMATION_STATUS.EXECUTING].includes(action.status)).reverse();

  const handleCancel = (actionId) => {
    if (cancelAction(actionId)) toast.success('Acción programada cancelada');
    else toast.error('La acción ya se estaba ejecutando y no puede cancelarse');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Bot className="w-8 h-8 text-violet-500" /> Automate
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Acciones financieras programadas para esta liga.</p>
      </div>

      {nativeAutomationService.isAvailable() ? (
        <div className={`rounded-xl border p-4 text-sm ${nativeCapabilities?.exactAlarmPermission
          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-200'
          : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              {nativeCapabilities?.exactAlarmPermission
                ? 'Automatizaciones Android activas, incluso con la pantalla apagada.'
                : 'Android necesita permiso de alarmas exactas para ejecutar pujas a tiempo.'}
            </span>
            {!nativeCapabilities?.exactAlarmPermission && (
              <button
                type="button"
                onClick={async () => {
                  await nativeAutomationService.requestExactAlarmPermission();
                  toast('Activa «Alarmas y recordatorios» y vuelve a LaLigaUP.');
                }}
                className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                Conceder permiso
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-amber-800 dark:text-amber-200">
          <strong>Importante:</strong> mantén la aplicación abierta, la sesión iniciada, el equipo despierto y conexión a Internet. La app minimizada sigue trabajando, pero una puja perdida por cierre o suspensión nunca se enviará tarde.
        </div>
      )}

      <section>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-violet-500" /> Pendientes ({pending.length})
        </h2>
        {pending.length ? (
          <div className="space-y-3">{pending.map((action) => <ActionCard key={action.id} action={action} now={now} onCancel={handleCancel} />)}</div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
            No hay acciones pendientes. Prográmalas desde una tarjeta de cláusula o de mercado.
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Historial reciente</h2>
            <button type="button" onClick={() => clearFinished(userId, leagueId)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-600">
              <Trash2 className="w-4 h-4" /> Limpiar
            </button>
          </div>
          <div className="space-y-3">{history.map((action) => <ActionCard key={action.id} action={action} now={now} onCancel={handleCancel} />)}</div>
        </section>
      )}
    </div>
  );
};

export default Automate;
