package com.mrubiales.laligaup;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class AutomationStorage {
    private static final String PREFS = "laligaup_native_automation";
    private static final String ACTIONS = "actions";
    private static final String RESULTS = "results";
    private static final String TOKENS = "tokens_encrypted";
    private static final String KEY_ALIAS = "laligaup_automation_tokens";

    private AutomationStorage() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONArray getActions(Context context) {
        try { return new JSONArray(prefs(context).getString(ACTIONS, "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    static synchronized void setActions(Context context, JSONArray actions) {
        prefs(context).edit().putString(ACTIONS, actions.toString()).apply();
    }

    static synchronized JSONObject findAction(Context context, String id) {
        JSONArray actions = getActions(context);
        for (int i = 0; i < actions.length(); i++) {
            JSONObject action = actions.optJSONObject(i);
            if (action != null && id.equals(action.optString("id"))) return action;
        }
        return null;
    }

    static synchronized void updateAction(Context context, String id, JSONObject updates) {
        JSONArray actions = getActions(context);
        for (int i = 0; i < actions.length(); i++) {
            JSONObject action = actions.optJSONObject(i);
            if (action == null || !id.equals(action.optString("id"))) continue;
            for (String key : updates.keySet()) {
                try { action.put(key, updates.get(key)); } catch (Exception ignored) {}
            }
            break;
        }
        setActions(context, actions);
    }

    static synchronized void addResult(Context context, JSONObject result) {
        JSONArray results;
        try { results = new JSONArray(prefs(context).getString(RESULTS, "[]")); }
        catch (Exception ignored) { results = new JSONArray(); }
        results.put(result);
        prefs(context).edit().putString(RESULTS, results.toString()).apply();
    }

    static synchronized JSONArray getResults(Context context) {
        try { return new JSONArray(prefs(context).getString(RESULTS, "[]")); }
        catch (Exception ignored) { return new JSONArray(); }
    }

    static synchronized void acknowledgeResults(Context context, JSONArray acknowledgedIds) {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < acknowledgedIds.length(); i++) {
            String id = acknowledgedIds.optString(i, "");
            if (!id.isEmpty()) ids.add(id);
        }
        JSONArray remaining = new JSONArray();
        JSONArray results = getResults(context);
        for (int i = 0; i < results.length(); i++) {
            JSONObject result = results.optJSONObject(i);
            if (result == null || !ids.contains(result.optString("id"))) remaining.put(result);
        }
        prefs(context).edit().putString(RESULTS, remaining.toString()).apply();
    }

    static synchronized void setTokens(Context context, JSONObject tokens) throws Exception {
        prefs(context).edit().putString(TOKENS, encrypt(tokens.toString())).apply();
    }

    static synchronized JSONObject getTokens(Context context) {
        try {
            String encrypted = prefs(context).getString(TOKENS, null);
            return encrypted == null ? new JSONObject() : new JSONObject(decrypt(encrypted));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static SecretKey getKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private static String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private static String decrypt(String value) throws Exception {
        String[] parts = value.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
