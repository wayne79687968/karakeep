import type { Metadata } from "next";
import AssistantChat from "@/components/dashboard/assistant/AssistantChat";
import { MessageSquare } from "lucide-react";

export const metadata: Metadata = {
  title: "Assistant | Karakeep",
};

export default function AssistantPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4">
      <div className="flex items-center">
        <MessageSquare className="mr-2" />
        <p className="text-2xl">Assistant</p>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
        <AssistantChat />
      </div>
    </div>
  );
}
