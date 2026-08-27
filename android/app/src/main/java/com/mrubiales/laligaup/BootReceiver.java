package com.mrubiales.laligaup;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        JSONArray actions = AutomationStorage.getActions(context);
        for (int i = 0; i < actions.length(); i++) {
            if (actions.optJSONObject(i) != null &&
                    "pending".equals(actions.optJSONObject(i).optString("status", "pending"))) {
                AutomationScheduler.schedule(context, actions.optJSONObject(i));
            }
        }
    }
}
