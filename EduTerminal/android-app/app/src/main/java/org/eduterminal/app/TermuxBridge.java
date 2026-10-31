package org.eduterminal.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

public final class TermuxBridge {
    public static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";
    private static final String TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash";
    private static final String REPO_DIR = TERMUX_HOME + "/vsx";

    private TermuxBridge() {
    }

    public static boolean isInstalled(Context context) {
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static boolean runScript(Context context, String relativePath) {
        if (!isInstalled(context)) {
            return false;
        }

        String script = REPO_DIR + "/EduTerminal/" + relativePath;
        Intent intent = new Intent();
        intent.setClassName(TERMUX_PACKAGE, "com.termux.app.RunCommandService");
        intent.setAction("com.termux.RUN_COMMAND");
        intent.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_BASH);
        intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-lc", script});
        intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", TERMUX_HOME);
        intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
        intent.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");

        try {
            context.startService(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static void openTermux(Context context) {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE);
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }
    }

    public static void openUrl(Context context, String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    public static void installTermux(Context context) {
        openUrl(context, "https://f-droid.org/packages/com.termux/");
    }
}
