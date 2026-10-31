package org.eduterminal.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class ConnectorClient {
    private static final int CONNECT_TIMEOUT = 2500;
    private static final int READ_TIMEOUT = 12000;

    private ConnectorClient() {
    }

    public static String baseUrl() {
        return NetworkUtils.localUrl();
    }

    public static boolean health() {
        try {
            JSONObject payload = new JSONObject(request("GET", "/health", null));
            return payload.optBoolean("ok", false);
        } catch (Exception error) {
            return false;
        }
    }

    public static JSONObject pairingCurrent() throws IOException {
        return parse(request("GET", "/api/eduterminal/pairing/current", null));
    }

    public static JSONObject startPairing() throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("label", "EduTerminal");
        } catch (Exception ignored) {
        }
        return parse(request("POST", "/api/eduterminal/pairing/start", body));
    }

    public static JSONArray pendingRequests() throws IOException {
        JSONObject payload = parse(request("GET", "/api/eduterminal/requests", null));
        return payload.optJSONArray("requests");
    }

    public static void approve(String requestId, boolean approve) throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("requestId", requestId);
        } catch (Exception ignored) {
        }
        request("POST", approve ? "/api/eduterminal/pair/approve" : "/api/eduterminal/pair/deny", body);
    }

    public static JSONArray tools() throws IOException {
        JSONObject payload = parse(request("GET", "/api/eduterminal/tools", null));
        return payload.optJSONArray("tools");
    }

    public static void installTool(String id) throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("id", id);
        } catch (Exception ignored) {
        }
        request("POST", "/api/eduterminal/tools/install", body);
    }

    private static JSONObject parse(String text) throws IOException {
        try {
            return new JSONObject(text);
        } catch (JSONException error) {
            throw new IOException("Resposta inválida do connector", error);
        }
    }

    private static String request(String method, String path, JSONObject body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl() + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT);
        connection.setReadTimeout(READ_TIMEOUT);
        connection.setRequestProperty("Accept", "application/json");

        try {
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = read(stream);
            if (status >= 400) {
                throw new IOException("HTTP " + status + (text.isEmpty() ? "" : ": " + text));
            }
            return text;
        } finally {
            connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }
}
