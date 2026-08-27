package com.mrubiales.laligaup;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(name = "Automation")
public class AutomationPlugin extends Plugin {
    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("exactAlarmPermission", AutomationScheduler.hasExactAlarmPermission(getContext()));
        result.put("androidVersion", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    @PluginMethod
    public void requestExactAlarmPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !AutomationScheduler.hasExactAlarmPermission(getContext())) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSArray incoming = call.getArray("actions", new JSArray());
        JSObject tokens = call.getObject("tokens", new JSObject());
        try {
            JSONArray oldActions = AutomationStorage.getActions(getContext());
            Map<String, JSONObject> oldById = new HashMap<>();
            for (int i = 0; i < oldActions.length(); i++) {
                JSONObject oldAction = oldActions.optJSONObject(i);
                if (oldAction != null) oldById.put(oldAction.optString("id"), oldAction);
            }
            Set<String> incomingIds = new HashSet<>();
            JSONArray mergedActions = new JSONArray();
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject action = incoming.getJSONObject(i);
                String id = action.getString("id");
                incomingIds.add(id);
                JSONObject oldAction = oldById.get(id);
                // Never let a stale WebView snapshot resurrect an in-flight or
                // completed native POST; that could schedule a duplicate.
                if (oldAction != null && !"pending".equals(oldAction.optString("status", "pending"))) {
                    mergedActions.put(oldAction);
                } else {
                    mergedActions.put(action);
                }
            }
            for (int i = 0; i < oldActions.length(); i++) {
                String oldId = oldActions.getJSONObject(i).optString("id");
                if (!incomingIds.contains(oldId)) AutomationScheduler.cancel(getContext(), oldId);
            }

            AutomationStorage.setActions(getContext(), mergedActions);
            if (tokens.length() > 0) AutomationStorage.setTokens(getContext(), tokens);
            int scheduled = 0;
            for (int i = 0; i < mergedActions.length(); i++) {
                if (AutomationScheduler.schedule(getContext(), mergedActions.getJSONObject(i))) scheduled++;
            }
            JSObject result = new JSObject();
            result.put("scheduled", scheduled);
            result.put("exactAlarmPermission", AutomationScheduler.hasExactAlarmPermission(getContext()));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudieron sincronizar las automatizaciones", error);
        }
    }

    @PluginMethod
    public void getResults(PluginCall call) {
        JSObject result = new JSObject();
        result.put("results", AutomationStorage.getResults(getContext()));
        result.put("tokens", AutomationStorage.getTokens(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledgeResults(PluginCall call) {
        AutomationStorage.acknowledgeResults(getContext(), call.getArray("ids", new JSArray()));
        call.resolve();
    }
}
