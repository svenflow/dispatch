import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { MapPinWidgetData } from "../api/types";
import { GOOGLE_MAPS_EMBED_KEY } from "../config/constants";

interface MapPinWidgetProps {
  data: MapPinWidgetData;
}

function openInMaps(latitude: number, longitude: number, label?: string | null) {
  const encodedLabel = label ? encodeURIComponent(label) : "";
  const query = encodedLabel || `${latitude},${longitude}`;
  const url = `https://www.google.com/maps/search/?api=1&query=${query}&center=${latitude},${longitude}`;
  Linking.openURL(url).catch(() => {
    Linking.openURL(
      `maps:0,0?q=${query}&ll=${latitude},${longitude}&z=${14}`,
    );
  });
}

/** Build Google Maps Embed API URL */
function buildEmbedUrl(data: MapPinWidgetData): string {
  const key = GOOGLE_MAPS_EMBED_KEY;
  if (data.pins.length === 1) {
    const pin = data.pins[0];
    const q = pin.label
      ? encodeURIComponent(pin.label)
      : `${pin.latitude},${pin.longitude}`;
    return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${q}&center=${pin.latitude},${pin.longitude}&zoom=14`;
  }
  // Multiple pins: show directions from first to last
  const first = data.pins[0];
  const last = data.pins[data.pins.length - 1];
  const origin = first.label
    ? encodeURIComponent(first.label)
    : `${first.latitude},${first.longitude}`;
  const destination = last.label
    ? encodeURIComponent(last.label)
    : `${last.latitude},${last.longitude}`;
  return `https://www.google.com/maps/embed/v1/directions?key=${key}&origin=${origin}&destination=${destination}`;
}

/** Build HTML wrapper with iframe for native WebView */
function buildIframeHtml(embedUrl: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>*{margin:0;padding:0}html,body,iframe{width:100%;height:100%;border:0}</style>
</head><body>
<iframe src="${embedUrl}" width="100%" height="100%" style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
</body></html>`;
}

/** Embedded Google Map */
function EmbeddedMap({ data }: { data: MapPinWidgetData }) {
  const embedUrl = buildEmbedUrl(data);

  if (Platform.OS === "web") {
    return (
      <View style={styles.mapContainer}>
        <iframe
          src={embedUrl}
          width="100%"
          height="100%"
          style={{ border: 0, borderRadius: 12 } as any}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </View>
    );
  }

  return (
    <View style={styles.mapContainer}>
      <WebView
        source={{ html: buildIframeHtml(embedUrl), baseUrl: "https://maps.google.com" }}
        style={styles.webview}
        scrollEnabled
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        nestedScrollEnabled
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={(request) => {
          // Allow the initial HTML load and embed iframe
          if (request.url === "about:blank" || request.url.startsWith("https://maps.google.com") || request.url.includes("google.com/maps/embed")) {
            return true;
          }
          // Intercept "View larger map" and other navigation — open externally
          if (request.url.includes("google.com/maps") || request.url.includes("maps.google.com")) {
            Linking.openURL(request.url);
            return false;
          }
          // Any other external link — open in browser
          Linking.openURL(request.url);
          return false;
        }}
      />
    </View>
  );
}

export function MapPinWidget({ data }: MapPinWidgetProps) {
  return (
    <View style={styles.container}>
      {data.title ? <Text style={styles.title}>{data.title}</Text> : null}
      <EmbeddedMap data={data} />
      {data.pins.length > 1 && (
        <View style={styles.pinsContainer}>
          {data.pins.map((pin, idx) => (
            <Pressable
              key={idx}
              style={styles.pinRow}
              onPress={() => openInMaps(pin.latitude, pin.longitude, pin.label)}
            >
              <View style={styles.pinIcon}>
                <Text style={styles.pinEmoji}>📍</Text>
              </View>
              <View style={styles.pinInfo}>
                <Text style={styles.pinLabel}>
                  {pin.label || "Location"}
                </Text>
                <Text style={styles.pinCoords}>
                  {pin.latitude.toFixed(4)}, {pin.longitude.toFixed(4)}
                </Text>
              </View>
              <Text style={styles.openArrow}>›</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    gap: 8,
  },
  title: {
    color: "#e4e4e7",
    fontSize: 15,
    fontWeight: "600",
  },
  mapContainer: {
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#27272a",
  },
  webview: {
    flex: 1,
    borderRadius: 12,
  },
  pinsContainer: {
    gap: 4,
  },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  pinIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#27272a",
    alignItems: "center",
    justifyContent: "center",
  },
  pinEmoji: {
    fontSize: 16,
  },
  pinInfo: {
    flex: 1,
    gap: 1,
  },
  pinLabel: {
    color: "#e4e4e7",
    fontSize: 14,
    fontWeight: "500",
  },
  pinCoords: {
    color: "#71717a",
    fontSize: 12,
  },
  openArrow: {
    color: "#71717a",
    fontSize: 20,
    fontWeight: "300",
  },
});
