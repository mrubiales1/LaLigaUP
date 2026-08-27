package com.mrubiales.laligaup;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

public class AutomationReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String actionId = intent.getStringExtra("actionId");
        if (actionId == null) return;
        Intent service = new Intent(context, AutomationExecutionService.class);
        service.putExtra("actionId", actionId);
        ContextCompat.startForegroundService(context, service);
    }
}
