package com.mrubiales.laligaup;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

final class AutomationScheduler {
    private AutomationScheduler() {}

    static boolean hasExactAlarmPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return manager.canScheduleExactAlarms();
    }

    static boolean schedule(Context context, JSONObject action) {
        if (action == null || !"pending".equals(action.optString("status", "pending"))) return false;
        if (!hasExactAlarmPermission(context)) return false;
        try {
            String id = action.getString("id");
            long triggerAt = TimeUtils.parse(action.getString("executeAt"));
            if (triggerAt <= 0) return false;
            if (triggerAt <= System.currentTimeMillis()) triggerAt = System.currentTimeMillis() + 250;
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pending = pendingIntent(context, id, PendingIntent.FLAG_UPDATE_CURRENT);
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    static void cancel(Context context, String id) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = pendingIntent(context, id, PendingIntent.FLAG_NO_CREATE);
        if (pending != null) {
            manager.cancel(pending);
            pending.cancel();
        }
    }

    private static PendingIntent pendingIntent(Context context, String id, int flag) {
        Intent intent = new Intent(context, AutomationReceiver.class);
        intent.setAction("com.mrubiales.laligaup.AUTOMATION." + id);
        intent.putExtra("actionId", id);
        int flags = flag | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, id.hashCode(), intent, flags);
    }
}
