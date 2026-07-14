import { useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTickets } from "../../lib/api";
import { TicketCard } from "../../components/TicketCard";
import type { Ticket } from "@mobile/shared";

export default function TicketList() {
  const insets = useSafeAreaInsets();
  const { data: tickets, isLoading, isError, refetch } = useTickets();

  const renderItem = ({ item }: { item: Ticket }) => (
    <TouchableOpacity
      onPress={() => router.push(`/ticket/${item.id}`)}
      className="mx-4 mb-2"
    >
      <TicketCard ticket={item} />
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View className="flex-1 items-center justify-center py-20">
      <Text className="text-4xl mb-4">📝</Text>
      <Text className="text-lg font-semibold text-gray-500 mb-1">No tickets yet</Text>
      <Text className="text-sm text-gray-400">
        Tap + to create your first ticket
      </Text>
    </View>
  );

  return (
    <View className="flex-1 bg-gray-50" style={{ paddingBottom: insets.bottom }}>
      {/* Header */}
      <View className="flex-row justify-between items-center px-4 py-3 bg-white border-b border-gray-200">
        <Text className="text-lg font-bold">Tickets</Text>
        <TouchableOpacity
          className="bg-black rounded-full w-8 h-8 items-center justify-center"
          onPress={() => router.push("/ticket/new")}
        >
          <Text className="text-white text-xl font-bold">+</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#000" />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-red-500 mb-2">Failed to load tickets</Text>
          <TouchableOpacity onPress={() => refetch()}>
            <Text className="text-blue-600 font-semibold">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={tickets ?? []}
          keyExtractor={(item: Ticket) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={{ paddingVertical: 12 }}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} />
          }
        />
      )}
    </View>
  );
}
