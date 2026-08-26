import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { startAutomationEngine, stopAutomationEngine } from '../../services/automationEngine';

const AutomationRunner = () => {
  const userId = useAuthStore((state) => state.user?.userId || state.user?.id);

  useEffect(() => {
    if (!userId) return undefined;
    startAutomationEngine(userId);
    return () => stopAutomationEngine();
  }, [userId]);

  return null;
};

export default AutomationRunner;
