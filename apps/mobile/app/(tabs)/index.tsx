import { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { useTickets } from "../../lib/api";
import { TicketCard } from "../../components/TicketCard";
import { Button } from "../../components/ui/button";
import type { Ticket } from "@mobile/shared";

export default function TicketList() {
  const { data: tickets, isLoading, isError, refetch } = useTickets();

  const renderItem = useCallback(({ item }: { item: Ticket }) => (
    <TouchableOpacity
      onPress={() => router.push(`/ticket/${item.ticketId}`)}
      className="mx-4 mb-2"
    >
      <TicketCard ticket={item} />
    </TouchableOpacity>
  ), []);

  const renderEmpty = useCallback(() => (
    <View className="flex-1 items-center justify-center py-20">
      <Text className="text-lg font-semibold text-gray-500 mb-1">
        No tickets
      </Text>
      <Text className="text-sm text-gray-400">
        Tickets will appear here when the agent detects events
      </Text>
    </View>
  ), []);

  return (
    <View className="flex-1 bg-gray-50">
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#000" />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-red-500 mb-2">Failed to load tickets</Text>
          <Button variant="outline" onPress={() => refetch()}>
            Retry
          </Button>
        </View>
      ) : (
        <FlatList
          data={tickets ?? []}
          keyExtractor={(item: Ticket) => item.ticketId}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={{ paddingVertical: 12 }}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refetch} />
          }
        />
      )}
    </View>
  );
}
