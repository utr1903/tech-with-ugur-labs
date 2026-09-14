import { notFound } from "next/navigation";
import { ChatScreen } from "../../../components/chat-screen";
import { isThreadId } from "../../../lib/thread-id";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  if (!isThreadId(threadId)) notFound();
  return <ChatScreen threadId={threadId} />;
}
