"use client";

import { useState } from "react";
import FeedCard from "./FeedCard";
import type { FeedItem } from "@/lib/feed-types";

// Renders a single shared card. The deep-link page is a server component, so it
// can't pass an onUpdate function across the boundary — this client wrapper
// holds the item in local state and feeds FeedCard the same vote/share UX it
// gets in the list.
export default function FeedCardSolo({ item }: { item: FeedItem }) {
  const [current, setCurrent] = useState<FeedItem>(item);

  function update(id: string, updates: Partial<FeedItem>) {
    setCurrent((prev) => (prev.id === id ? { ...prev, ...updates } : prev));
  }

  return <FeedCard item={current} onUpdate={update} />;
}
