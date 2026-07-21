import { View, Text, ScrollView } from "react-native";
import { cn } from "../../lib/utils";

interface TableColumn {
  key: string;
  header: string;
  width?: string;
}

interface TableProps {
  columns: TableColumn[];
  data: Record<string, React.ReactNode>[];
  className?: string;
}

export function Table({ columns, data, className }: TableProps) {
  return (
    <ScrollView horizontal className={cn("", className)}>
      <View>
        {/* Header */}
        <View className="flex-row bg-gray-100 rounded-t-lg">
          {columns.map((col) => (
            <View
              key={col.key}
              style={{ width: col.width ? (parseInt(col.width) ?? 100) : 120 }}
              className="px-3 py-2"
            >
              <Text className="text-xs font-semibold text-gray-600 uppercase">
                {col.header}
              </Text>
            </View>
          ))}
        </View>
        {/* Rows */}
        {data.map((row, i) => (
          <View
            key={i}
            className={cn(
              "flex-row border-b border-gray-200",
              i % 2 === 0 ? "bg-white" : "bg-gray-50",
            )}
          >
            {columns.map((col) => (
              <View
                key={col.key}
                style={{ width: col.width ? (parseInt(col.width) ?? 100) : 120 }}
                className="px-3 py-3"
              >
                {typeof row[col.key] === "string" ? (
                  <Text className="text-sm text-gray-800">
                    {row[col.key] as string}
                  </Text>
                ) : (
                  row[col.key]
                )}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
