import { useCallback, useEffect, useRef, useState } from 'react';
import { copyPaperRequestConfig, type PaperRequestConfig } from './paper';

interface PendingRequest {
  conversationKey: string;
  content: string;
  paperConfig?: PaperRequestConfig;
}

/** Wait for useXChat's effect-driven conversation/store switch before sending. */
export const useNewConversationRequest = ({
  activeConversationKey,
  initializing,
  onSend,
}: {
  activeConversationKey: string;
  initializing: boolean;
  onSend: (content: string, paperConfig?: PaperRequestConfig) => void;
}) => {
  const [committedKey, setCommittedKey] = useState(activeConversationKey);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    setCommittedKey(activeConversationKey);
  }, [activeConversationKey]);

  useEffect(() => {
    if (
      !pending ||
      pendingRef.current !== pending ||
      activeConversationKey !== pending.conversationKey ||
      committedKey !== pending.conversationKey ||
      initializing
    ) {
      return;
    }
    // useXChat switches its key, then its store in successive effects. Defer
    // until those updates settle; cleanup cancels stale callbacks on switching.
    const timer = setTimeout(() => {
      if (pendingRef.current !== pending) return;
      pendingRef.current = null;
      setPending(null);
      onSend(pending.content, pending.paperConfig);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeConversationKey, committedKey, initializing, onSend, pending]);

  const enqueue = (request: PendingRequest) => {
    if (pendingRef.current) return false;
    const snapshot = {
      ...request,
      ...(request.paperConfig
        ? { paperConfig: copyPaperRequestConfig(request.paperConfig) }
        : {}),
    };
    pendingRef.current = snapshot;
    setPending(snapshot);
    return true;
  };

  return { enqueue, cancel, pending: pending !== null };
};
