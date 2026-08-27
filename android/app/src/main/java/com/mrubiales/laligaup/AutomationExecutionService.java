package com.mrubiales.laligaup;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AutomationExecutionService extends Service {
    private static final String CHANNEL_ID = "laligaup_automations";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String actionId = intent == null ? null : intent.getStringExtra("actionId");
        if (actionId == null) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        startForeground(Math.abs(actionId.hashCode()), notification("Comprobando una acción programada…"));
        executor.execute(() -> execute(actionId, startId));
        return START_NOT_STICKY;
    }

    private void execute(String actionId, int startId) {
        JSONObject action = AutomationStorage.findAction(this, actionId);
        if (action == null || !"pending".equals(action.optString("status", "pending"))) {
            stopSelf(startId);
            return;
        }

        JSONObject executing = new JSONObject();
        put(executing, "status", "executing");
        put(executing, "startedAt", TimeUtils.now());
        AutomationStorage.updateAction(this, actionId, executing);

        JSONObject result = FantasyAutomationExecutor.execute(this, action);
        AutomationStorage.updateAction(this, actionId, result);
        AutomationStorage.addResult(this, result);
        JSONObject updated = AutomationStorage.findAction(this, actionId);
        if (updated != null && "pending".equals(result.optString("status"))) {
            AutomationScheduler.schedule(this, updated);
        }
        stopSelf(startId);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Automatizaciones", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Ejecución segura de cláusulas y pujas programadas");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification notification(String text) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("LaLigaUP Automate")
                .setContentText(text)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private static void put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
