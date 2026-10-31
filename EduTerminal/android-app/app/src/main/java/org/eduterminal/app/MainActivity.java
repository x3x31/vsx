package org.eduterminal.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 10;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private TextView statusView;
    private TextView addressView;
    private TextView pairingView;
    private TextView logView;
    private LinearLayout requestsView;
    private LinearLayout toolsView;

    private volatile boolean refreshing;

    private final Runnable poller = new Runnable() {
        @Override
        public void run() {
            refresh();
            handler.postDelayed(this, 2500);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusView = findViewById(R.id.status);
        addressView = findViewById(R.id.address);
        pairingView = findViewById(R.id.pairing_code);
        logView = findViewById(R.id.log);
        requestsView = findViewById(R.id.requests);
        toolsView = findViewById(R.id.tools);

        findViewById(R.id.btn_start).setOnClickListener(view -> startEnvironment());
        findViewById(R.id.btn_stop).setOnClickListener(view -> stopEnvironment());
        findViewById(R.id.btn_prepare).setOnClickListener(view -> confirmPrepare());
        findViewById(R.id.btn_new_code).setOnClickListener(view -> newPairingCode());
        findViewById(R.id.btn_open_vsx).setOnClickListener(
                view -> TermuxBridge.openUrl(this, ConnectorClient.baseUrl() + "/vsx/"));
        findViewById(R.id.btn_open_terminal).setOnClickListener(
                view -> TermuxBridge.openTermux(this));

        requestNotificationPermission();
        startMonitorService();
        refresh();
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(poller);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(poller);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    REQUEST_NOTIFICATIONS);
        }
    }

    private void startMonitorService() {
        Intent service = new Intent(this, EduTerminalService.class);
        startForegroundService(service);
    }

    private void startEnvironment() {
        if (!TermuxBridge.isInstalled(this)) {
            showTermuxDialog();
            return;
        }
        boolean started = TermuxBridge.runScript(this, "bootstrap/start.sh");
        if (!started) {
            toast("Não foi possível iniciar o Termux. Confira allow-external-apps.");
            return;
        }
        statusView.setText(R.string.status_starting);
        statusView.setTextColor(getColor(R.color.yellow));
        logView.setText("Iniciando o connector no Termux...");
        handler.postDelayed(this::refresh, 1500);
    }

    private void stopEnvironment() {
        TermuxBridge.runScript(this, "bootstrap/stop.sh");
        toast("Parando o ambiente...");
        handler.postDelayed(this::refresh, 1200);
    }

    private void confirmPrepare() {
        if (!TermuxBridge.isInstalled(this)) {
            showTermuxDialog();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.prepare)
                .setMessage(R.string.prepare_confirm)
                .setPositiveButton(R.string.prepare_yes, (dialog, which) -> prepareEnvironment())
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void prepareEnvironment() {
        boolean started = TermuxBridge.runScript(this, "installer/termux-install.sh");
        if (!started) {
            toast("Não foi possível executar o instalador no Termux.");
            return;
        }
        toast("Preparando o ambiente. Isso pode levar alguns minutos.");
        logView.setText("Instalando Node.js, Git, Python, Nano, Vim e o connector...");
    }

    private void newPairingCode() {
        runAsync(() -> {
            try {
                ConnectorClient.startPairing();
                runOnUiThread(() -> {
                    toast("Novo código gerado");
                    refresh();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    toast("Inicie o ambiente antes de gerar o código");
                    logView.setText(error.getMessage());
                });
            }
        });
    }

    private void refresh() {
        if (refreshing || executor.isShutdown()) {
            return;
        }
        refreshing = true;

        executor.execute(() -> {
            boolean online = false;
            JSONObject pairing = null;
            JSONArray requests = null;
            JSONArray tools = null;
            String error = null;

            try {
                online = ConnectorClient.health();
                if (online) {
                    pairing = ConnectorClient.pairingCurrent();
                    requests = ConnectorClient.pendingRequests();
                    tools = ConnectorClient.tools();
                }
            } catch (Exception failure) {
                error = failure.getMessage();
            }

            final boolean isOnline = online;
            final JSONObject currentPairing = pairing;
            final JSONArray pending = requests;
            final JSONArray availableTools = tools;
            final String failure = error;

            runOnUiThread(() -> {
                refreshing = false;
                render(isOnline, currentPairing, pending, availableTools, failure);
            });
        });
    }

    private void render(
            boolean online,
            JSONObject pairing,
            JSONArray requests,
            JSONArray tools,
            String error) {
        if (online) {
            statusView.setText(R.string.status_online);
            statusView.setTextColor(getColor(R.color.green));
        } else {
            statusView.setText(R.string.status_stopped);
            statusView.setTextColor(getColor(R.color.yellow));
        }

        addressView.setText(
                "VSX local: " + ConnectorClient.baseUrl() + "/vsx/\n"
                        + "VSX na rede: " + NetworkUtils.lanUrl() + "/vsx/");

        renderPairing(online, pairing);
        renderRequests(requests);
        renderTools(tools);

        if (error != null && !online) {
            logView.setText("Servidor local parado.\n" + error);
        } else if (online) {
            logView.setText("Servidor local pronto. Abra o VSX pelo botão acima ou pelo navegador.");
        } else {
            logView.setText("Toque em Iniciar ambiente. Na primeira vez, use Preparar/atualizar ambiente.");
        }
    }

    private void renderPairing(boolean online, JSONObject pairing) {
        if (!online || pairing == null) {
            pairingView.setText(R.string.pairing_empty);
            pairingView.setTextColor(getColor(R.color.text_muted));
            return;
        }

        String code = value(pairing, "code");
        long expiresAt = pairing.optLong("expiresAt", 0);
        if (code.isEmpty()) {
            pairingView.setText(R.string.pairing_empty);
            pairingView.setTextColor(getColor(R.color.text_muted));
            return;
        }
        if (expiresAt > 0 && expiresAt <= System.currentTimeMillis()) {
            pairingView.setText("expirado");
            pairingView.setTextColor(getColor(R.color.yellow));
            return;
        }

        StringBuilder spaced = new StringBuilder();
        for (int index = 0; index < code.length(); index++) {
            if (index > 0) {
                spaced.append(' ');
            }
            spaced.append(code.charAt(index));
        }
        pairingView.setText(spaced.toString());
        pairingView.setTextColor(getColor(R.color.green));
    }

    private void renderRequests(JSONArray requests) {
        requestsView.removeAllViews();
        if (requests == null || requests.length() == 0) {
            requestsView.addView(mutedText(getString(R.string.requests_empty)));
            return;
        }

        for (int index = 0; index < requests.length(); index++) {
            JSONObject request = requests.optJSONObject(index);
            if (request == null) {
                continue;
            }
            String requestId = value(request, "requestId");
            String name = value(request, "name");
            String ip = value(request, "ip");

            LinearLayout card = card();
            card.addView(titleText(name.isEmpty() ? "VSX" : name));
            card.addView(mutedText(ip.isEmpty() ? "dispositivo na rede" : ip));

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);

            Button deny = new Button(this);
            deny.setText("Recusar");
            deny.setOnClickListener(view -> answerRequest(requestId, false));

            Button approve = new Button(this);
            approve.setText("Aprovar");
            approve.setBackgroundTintList(ColorStateList.valueOf(getColor(R.color.green)));
            approve.setTextColor(getColor(R.color.bg));
            approve.setOnClickListener(view -> answerRequest(requestId, true));

            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            params.setMargins(0, dp(8), dp(8), 0);
            actions.addView(deny, params);
            LinearLayout.LayoutParams approveParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            approveParams.setMargins(0, dp(8), 0, 0);
            actions.addView(approve, approveParams);
            card.addView(actions);

            requestsView.addView(card);
        }
    }

    private void answerRequest(String requestId, boolean approve) {
        runAsync(() -> {
            try {
                ConnectorClient.approve(requestId, approve);
                runOnUiThread(() -> {
                    toast(approve ? "Conexão autorizada" : "Conexão recusada");
                    refresh();
                });
            } catch (Exception error) {
                runOnUiThread(() -> logView.setText(error.getMessage()));
            }
        });
    }

    private void renderTools(JSONArray tools) {
        toolsView.removeAllViews();
        if (tools == null || tools.length() == 0) {
            toolsView.addView(mutedText("Inicie o ambiente para ver as ferramentas."));
            return;
        }

        for (int index = 0; index < tools.length(); index++) {
            JSONObject tool = tools.optJSONObject(index);
            if (tool == null) {
                continue;
            }
            String id = value(tool, "id");
            String name = value(tool, "name");
            boolean installed = tool.optBoolean("installed", false);
            String version = value(tool, "version");

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.setPadding(0, dp(6), 0, dp(6));

            TextView label = new TextView(this);
            label.setText(installed && !version.isEmpty() ? name + "  " + version : name);
            label.setTextColor(getColor(installed ? R.color.green : R.color.text));
            label.setTextSize(14);
            LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            row.addView(label, labelParams);

            Button action = new Button(this);
            action.setText(installed ? "instalado" : "instalar");
            action.setEnabled(!installed);
            action.setOnClickListener(view -> installTool(id, name));
            row.addView(action);

            toolsView.addView(row);
        }
    }

    private void installTool(String id, String name) {
        toast("Instalando " + name + "...");
        runAsync(() -> {
            try {
                ConnectorClient.installTool(id);
                runOnUiThread(() -> {
                    toast(name + " instalado");
                    refresh();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    toast("Falha ao instalar " + name);
                    logView.setText(error.getMessage());
                });
            }
        });
    }

    private void showTermuxDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.termux_missing_title)
                .setMessage(R.string.termux_missing_message)
                .setPositiveButton(R.string.install_termux,
                        (dialog, which) -> TermuxBridge.installTermux(this))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void runAsync(Runnable task) {
        if (!executor.isShutdown()) {
            executor.execute(task);
        }
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        card.setBackgroundColor(getColor(R.color.surface));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(8));
        card.setLayoutParams(params);
        return card;
    }

    private TextView titleText(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(getColor(R.color.text));
        view.setTextSize(15);
        view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private TextView mutedText(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(getColor(R.color.text_muted));
        view.setTextSize(13);
        view.setPadding(0, dp(4), 0, dp(4));
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String value(JSONObject object, String key) {
        if (object == null) {
            return "";
        }
        Object raw = object.opt(key);
        if (raw == null || raw == JSONObject.NULL) {
            return "";
        }
        return String.valueOf(raw);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
