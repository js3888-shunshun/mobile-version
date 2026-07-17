import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

/**
 * Catches JS errors in the React tree and displays them on screen.
 * Without this, any uncaught error = white screen crash with zero feedback.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught fatal error:", error, errorInfo);
    this.setState({ errorInfo: errorInfo.componentStack ?? null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>App Crashed</Text>
          <Text style={styles.subtitle}>
            {this.state.error?.name ?? "Unknown Error"}
          </Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.message}>
              {this.state.error?.message ?? "No message"}
            </Text>
            {this.state.error?.stack ? (
              <Text style={styles.stack}>{this.state.error.stack}</Text>
            ) : null}
            {this.state.errorInfo ? (
              <Text style={styles.componentStack}>{this.state.errorInfo}</Text>
            ) : null}
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    paddingTop: 80,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#e74c3c",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: "#f5a623",
    marginBottom: 16,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  message: {
    fontSize: 16,
    color: "#ecf0f1",
    marginBottom: 16,
    lineHeight: 22,
  },
  stack: {
    fontSize: 11,
    color: "#95a5a6",
    fontFamily: "monospace",
    lineHeight: 16,
    marginBottom: 16,
  },
  componentStack: {
    fontSize: 11,
    color: "#7f8c8d",
    fontFamily: "monospace",
    lineHeight: 16,
    borderTopWidth: 1,
    borderTopColor: "#2c3e50",
    paddingTop: 12,
  },
});
