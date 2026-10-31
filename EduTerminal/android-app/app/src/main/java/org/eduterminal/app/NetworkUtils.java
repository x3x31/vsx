package org.eduterminal.app;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

public final class NetworkUtils {
    public static final int PORT = 8765;

    private NetworkUtils() {
    }

    public static String localUrl() {
        return "http://127.0.0.1:" + PORT;
    }

    public static String lanUrl() {
        return "http://" + lanAddress() + ":" + PORT;
    }

    public static String lanAddress() {
        String fallback = null;
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) {
                    continue;
                }
                String name = network.getName();
                if (name.startsWith("rmnet") || name.startsWith("tun") || name.startsWith("ppp")) {
                    continue;
                }
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) {
                        continue;
                    }
                    String host = address.getHostAddress();
                    if (host == null) {
                        continue;
                    }
                    if (host.startsWith("192.168.") || host.startsWith("10.") || isPrivate172(host)) {
                        return host;
                    }
                    if (fallback == null) {
                        fallback = host;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return fallback != null ? fallback : "127.0.0.1";
    }

    private static boolean isPrivate172(String host) {
        if (!host.startsWith("172.")) {
            return false;
        }
        String[] parts = host.split("\\.");
        if (parts.length < 2) {
            return false;
        }
        try {
            int second = Integer.parseInt(parts[1]);
            return second >= 16 && second <= 31;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }
}
