import React, { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import Modal from '../Common/Modal';
import { createMoneyInputHandler } from '../../utils/moneyInput';
import { formatNumberWithDots } from '../../utils/helpers';

const ScheduleActionModal = ({ isOpen, type, playerName, suggestedAmount, minimumAmount = 1, executeAt, onClose, onSchedule }) => {
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (isOpen) setAmount(String(Math.round(suggestedAmount || minimumAmount || 0)));
  }, [isOpen, suggestedAmount, minimumAmount]);

  if (!isOpen) return null;
  const numericAmount = Number.parseInt(amount, 10);
  const isClause = type === 'clause';
  const maximumAmount = isClause ? 200_000_000 : 500_000_000;
  const valid = Number.isFinite(numericAmount) && numericAmount >= minimumAmount && numericAmount <= maximumAmount;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="p-6 mx-4">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-6 h-6 text-violet-500" />
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              {isClause ? 'Programar clausulazo' : 'Programar puja'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{playerName}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="scheduled-action-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {isClause ? 'Precio máximo autorizado' : 'Importe de la puja'}
          </label>
          <div className="relative">
            <input
              id="scheduled-action-amount"
              type="text"
              value={amount ? formatNumberWithDots(amount) : ''}
              onChange={createMoneyInputHandler(setAmount)}
              className="w-full px-3 py-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              autoFocus
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">€</span>
          </div>
          {!valid && amount && (
            <p className="text-xs text-red-500 mt-1">
              {numericAmount < minimumAmount
                ? `El mínimo actual es ${formatNumberWithDots(minimumAmount)}€.`
                : `Introduce una cantidad válida de hasta ${formatNumberWithDots(maximumAmount)}€.`}
            </p>
          )}
        </div>

        <div className="rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 p-3 text-sm text-violet-800 dark:text-violet-200">
          {isClause
            ? 'Antes de pagar se volverán a comprobar propietario, bloqueo y precio. Si la cláusula supera tu máximo, no se ejecutará.'
            : 'La app volverá a comprobar el mercado y enviará la puja cuando falten 30 segundos.'}
          {executeAt && (
            <div className="font-semibold mt-1">Previsto: {new Date(executeAt).toLocaleString('es-ES')}</div>
          )}
        </div>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200">
          La aplicación debe permanecer abierta, con sesión iniciada y conexión a Internet. Suspender o apagar el ordenador puede impedir una puja programada.
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSchedule(numericAmount)}
            className="flex-1 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-gray-400 text-white font-semibold"
          >
            Programar
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ScheduleActionModal;
