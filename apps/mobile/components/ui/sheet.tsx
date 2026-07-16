import { useEffect, useRef, useState } from "react";
import {
  View,
  Animated,
  TouchableWithoutFeedback,
  Dimensions,
  type ViewProps,
} from "react-native";
import { cn } from "../../lib/utils";

const SCREEN_WIDTH = Dimensions.get("window").width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.8, 320);

interface SheetProps extends ViewProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  children: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  side = "left",
  className,
  children,
  ...props
}: SheetProps) {
  const translateX = useRef(
    new Animated.Value(side === "left" ? -DRAWER_WIDTH : DRAWER_WIDTH),
  ).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: side === "left" ? -DRAWER_WIDTH : DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShouldRender(false);
      });
    }
  }, [open]);

  if (!shouldRender) return null;

  return (
    <View
      className="absolute inset-0"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        elevation: 9999,
      }}
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View
          className="absolute inset-0"
          style={{ opacity: backdropOpacity, backgroundColor: "rgba(0,0,0,0.5)" }}
        />
      </TouchableWithoutFeedback>

      {/* Drawer */}
      <Animated.View
        className={cn(
          "absolute top-0 bottom-0 bg-white shadow-xl",
          side === "left" ? "left-0" : "right-0",
          className,
        )}
        style={{ width: DRAWER_WIDTH, transform: [{ translateX }] }}
        {...props}
      >
        {children}
      </Animated.View>
    </View>
  );
}
