package com.mrubiales.laligaup;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

final class FantasyAutomationExecutor {
    private static final String API = "https://fantasy-api.llt-services.com/api";
    private static final String CMP = "/v1/competition/1";
    private static final String TOKEN_URL = "https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN";
    private static final String DEFAULT_CLIENT_ID = "6457fa17-1224-416a-b21a-ee6ce76e9bc0";

    private FantasyAutomationExecutor() {}

    static JSONObject execute(Context context, JSONObject action) {
        try {
            JSONObject tokens = ensureFreshTokens(context, AutomationStorage.getTokens(context));
            if (tokens.optString("access_token").isEmpty()) {
                return result(action, "failed", "No hay una sesión válida para ejecutar la acción.");
            }
            if ("clause".equals(action.optString("type"))) return executeClause(context, action, tokens);
            if ("bid".equals(action.optString("type"))) return executeBid(context, action, tokens);
            return result(action, "failed", "Tipo de automatización desconocido.");
        } catch (AuthException error) {
            return result(action, "failed", error.getMessage());
        } catch (Exception error) {
            return result(action, "unknown", "La ejecución nativa terminó de forma inesperada y no se reintentará.");
        }
    }

    private static JSONObject executeClause(Context context, JSONObject action, JSONObject tokens) {
        String teamUrl = API + CMP + "/leagues/" + encode(action.optString("leagueId")) +
                "/teams/" + encode(action.optString("sellerTeamId")) + "?x-lang=es&_=" + System.currentTimeMillis();
        HttpResult read;
        try {
            read = request("GET", teamUrl, tokens.optString("access_token"), null);
        } catch (IOException error) {
            return reschedule(action, System.currentTimeMillis() + 30_000,
                    "No se pudo comprobar la cláusula; se reintentará.");
        }
        if (!read.success()) return result(action, "failed", "No se pudo comprobar la plantilla (HTTP " + read.code + ").");

        JSONObject playerTeam = findPlayerTeam(arrayAt(read.body, "players"), action);
        if (playerTeam == null || playerTeam.optJSONObject("playerMaster") == null || playerTeam.optLong("buyoutClause", 0) <= 0) {
            return result(action, "skipped", "El jugador ya no pertenece al equipo original.");
        }
        long currentAmount = playerTeam.optLong("buyoutClause", 0);
        if (currentAmount > action.optLong("maxAmount", 0)) {
            JSONObject result = result(action, "skipped", "La cláusula actual supera el máximo autorizado.");
            put(result, "actualAmount", currentAmount);
            return result;
        }

        String lockedUntil = playerTeam.optString("buyoutClauseLockedEndTime", "");
        long unlockAt = parseTime(lockedUntil);
        if (unlockAt > System.currentTimeMillis()) {
            JSONObject result = reschedule(action, unlockAt, "La cláusula continúa bloqueada; se ajustó la hora.");
            put(result, "actualAmount", currentAmount);
            return result;
        }

        String playerTeamId = playerTeam.optString("playerTeamId", playerTeam.optString("id"));
        String payUrl = API + CMP + "/league/" + encode(action.optString("leagueId")) +
                "/buyout/" + encode(playerTeamId) + "/pay";
        JSONObject body = new JSONObject();
        put(body, "buyoutClauseToPay", currentAmount);
        try {
            HttpResult post = request("POST", payUrl, tokens.optString("access_token"), body.toString());
            if (!post.success()) return result(action, "failed", apiMessage(post, "La API rechazó el pago de la cláusula."));
            JSONObject result = result(action, "completed", "Cláusula pagada por " + currentAmount + "€.");
            put(result, "actualAmount", currentAmount);
            return result;
        } catch (IOException error) {
            return result(action, "unknown", "Resultado incierto al pagar la cláusula; no se reintentará.");
        }
    }

    private static JSONObject executeBid(Context context, JSONObject action, JSONObject tokens) {
        String marketUrl = API + CMP + "/league/" + encode(action.optString("leagueId")) +
                "/market?x-lang=es&_=" + System.currentTimeMillis();
        HttpResult read;
        try {
            read = request("GET", marketUrl, tokens.optString("access_token"), null);
        } catch (IOException error) {
            long expiresAt = parseTime(action.optString("expiresAt"));
            if (expiresAt - System.currentTimeMillis() <= 5_000) {
                return result(action, "failed", "No se pudo comprobar el mercado antes del cierre.");
            }
            return reschedule(action, System.currentTimeMillis() + 3_000,
                    "No se pudo comprobar el mercado; se reintentará.");
        }
        if (!read.success()) return result(action, "failed", "No se pudo comprobar el mercado (HTTP " + read.code + ").");

        JSONObject marketItem = findMarketItem(arrayAt(read.body, null), action);
        if (marketItem == null) return result(action, "skipped", "El jugador ya no está en el mercado.");
        JSONObject existingBid = marketItem.optJSONObject("bid");
        if (existingBid != null && "pending".equals(existingBid.optString("status"))) {
            return result(action, "skipped", "Ya existe una puja activa para este jugador.");
        }

        String expiresAtText = marketItem.optString("expirationDate", action.optString("expiresAt"));
        long expiresAt = parseTime(expiresAtText);
        long now = System.currentTimeMillis();
        if (expiresAt <= now) return result(action, "failed", "El mercado terminó antes de poder enviar la puja.");
        long expectedAt = expiresAt - 30_000;
        if (expectedAt > now) {
            JSONObject result = reschedule(action, expectedAt, "La hora de cierre cambió; se reprogramó la puja.");
            put(result, "expiresAt", TimeUtils.format(expiresAt));
            return result;
        }

        JSONObject player = marketItem.optJSONObject("playerMaster");
        long minimum = Math.max(marketItem.optLong("salePrice", 0), player == null ? 0 : player.optLong("marketValue", 0));
        long amount = action.optLong("amount", 0);
        if (amount < minimum) return result(action, "skipped", "La puja programada es inferior al mínimo actual.");

        String bidUrl = API + CMP + "/league/" + encode(action.optString("leagueId")) +
                "/market/" + encode(marketItem.optString("id")) + "/bid?x-lang=es";
        JSONObject body = new JSONObject();
        put(body, "money", amount);
        try {
            HttpResult post = request("POST", bidUrl, tokens.optString("access_token"), body.toString());
            if (!post.success()) return result(action, "failed", apiMessage(post, "La API rechazó la puja."));
            JSONObject result = result(action, "completed", "Puja enviada por " + amount + "€.");
            put(result, "actualAmount", amount);
            return result;
        } catch (IOException error) {
            return result(action, "unknown", "Resultado incierto al enviar la puja; no se reintentará.");
        }
    }

    private static JSONObject ensureFreshTokens(Context context, JSONObject tokens) throws AuthException {
        long expiresOn = tokens.optLong("expires_on", 0) * 1000L;
        if (expiresOn == 0) expiresOn = jwtExpiration(tokens.optString("access_token"));
        if (expiresOn > System.currentTimeMillis() + 300_000) return tokens;
        String refreshToken = tokens.optString("refresh_token");
        if (refreshToken.isEmpty()) throw new AuthException("La sesión ha caducado y no tiene token de renovación.");
        try {
            String clientId = tokens.optString("client_id", DEFAULT_CLIENT_ID);
            String form = "grant_type=refresh_token&refresh_token=" + encode(refreshToken) +
                    "&client_id=" + encode(clientId) + "&scope=" + encode("openid offline_access");
            HttpResult response = requestForm(TOKEN_URL, form);
            if (!response.success()) throw new AuthException("No se pudo renovar la sesión antes de ejecutar la acción.");
            JSONObject refreshed = new JSONObject(response.body);
            String access = refreshed.optString("id_token", refreshed.optString("access_token"));
            if (access.isEmpty()) throw new AuthException("La renovación no devolvió un token válido.");
            for (String key : refreshed.keySet()) put(tokens, key, refreshed.opt(key));
            put(tokens, "access_token", access);
            if (!refreshed.has("refresh_token")) put(tokens, "refresh_token", refreshToken);
            long expiresIn = refreshed.optLong("id_token_expires_in", refreshed.optLong("expires_in", 86400));
            put(tokens, "expires_on", System.currentTimeMillis() / 1000L + expiresIn);
            AutomationStorage.setTokens(context, tokens);
            return tokens;
        } catch (AuthException error) {
            throw error;
        } catch (Exception error) {
            throw new AuthException("No se pudo renovar la sesión antes de ejecutar la acción.");
        }
    }

    private static JSONObject findPlayerTeam(JSONArray players, JSONObject action) {
        for (int i = 0; i < players.length(); i++) {
            JSONObject entry = players.optJSONObject(i);
            if (entry == null) continue;
            JSONObject master = entry.optJSONObject("playerMaster");
            boolean teamMatch = action.optString("playerTeamId").equals(entry.optString("playerTeamId", entry.optString("id")));
            boolean playerMatch = master != null && action.optString("playerId").equals(master.optString("id"));
            if (teamMatch || playerMatch) return entry;
        }
        return null;
    }

    private static JSONObject findMarketItem(JSONArray market, JSONObject action) {
        for (int i = 0; i < market.length(); i++) {
            JSONObject entry = market.optJSONObject(i);
            if (entry == null || !action.optString("marketId").equals(entry.optString("id"))) continue;
            JSONObject player = entry.optJSONObject("playerMaster");
            if (player != null && action.optString("playerId").equals(player.optString("id"))) return entry;
        }
        return null;
    }

    private static JSONArray arrayAt(String body, String key) {
        try {
            Object root = new JSONTokener(body).nextValue();
            if (root instanceof JSONArray) return (JSONArray) root;
            if (!(root instanceof JSONObject)) return new JSONArray();
            JSONObject object = (JSONObject) root;
            if (key != null) {
                JSONArray direct = object.optJSONArray(key);
                if (direct != null) return direct;
                JSONObject data = object.optJSONObject("data");
                if (data != null && data.optJSONArray(key) != null) return data.optJSONArray(key);
            }
            for (String candidate : new String[]{"data", "elements", "market", "players"}) {
                JSONArray array = object.optJSONArray(candidate);
                if (array != null) return array;
            }
        } catch (Exception ignored) {}
        return new JSONArray();
    }

    private static HttpResult request(String method, String url, String token, String body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(15_000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("x-app", "2");
        connection.setRequestProperty("x-lang", "es");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        return read(connection);
    }

    private static HttpResult requestForm(String url, String form) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(15_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        try (OutputStream output = connection.getOutputStream()) {
            output.write(form.getBytes(StandardCharsets.UTF_8));
        }
        return read(connection);
    }

    private static HttpResult read(HttpURLConnection connection) throws IOException {
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 400 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder body = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
        }
        connection.disconnect();
        return new HttpResult(code, body.toString());
    }

    private static JSONObject result(JSONObject action, String status, String message) {
        JSONObject result = new JSONObject();
        put(result, "id", action.optString("id"));
        put(result, "status", status);
        put(result, "resultMessage", message);
        if (!"pending".equals(status)) put(result, "finishedAt", TimeUtils.now());
        return result;
    }

    private static JSONObject reschedule(JSONObject action, long executeAt, String message) {
        JSONObject result = result(action, "pending", message);
        put(result, "executeAt", TimeUtils.format(executeAt));
        return result;
    }

    private static String apiMessage(HttpResult response, String fallback) {
        try {
            JSONObject body = new JSONObject(response.body);
            return body.optString("message", body.optString("error", fallback));
        } catch (Exception ignored) { return fallback + " (HTTP " + response.code + ")"; }
    }

    private static long parseTime(String value) {
        if (value == null || value.isEmpty()) return 0;
        return TimeUtils.parse(value);
    }

    private static long jwtExpiration(String token) {
        try {
            String[] parts = token.split("\\.");
            String payload = new String(android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE), StandardCharsets.UTF_8);
            return new JSONObject(payload).optLong("exp", 0) * 1000L;
        } catch (Exception ignored) { return 0; }
    }

    private static String encode(String value) {
        try { return URLEncoder.encode(value == null ? "" : value, "UTF-8"); }
        catch (Exception ignored) { return ""; }
    }

    private static void put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (Exception ignored) {}
    }

    private static final class HttpResult {
        final int code;
        final String body;
        HttpResult(int code, String body) { this.code = code; this.body = body; }
        boolean success() { return code >= 200 && code < 300; }
    }

    private static final class AuthException extends Exception {
        AuthException(String message) { super(message); }
    }
}
