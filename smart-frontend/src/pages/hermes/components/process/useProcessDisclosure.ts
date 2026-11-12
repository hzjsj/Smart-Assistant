import { useCallback, useEffect, useRef, useState } from 'react';

/** One request cycle owns the defaults; tokens never override manual choices. */
export function useProcessDisclosure(active: boolean) {
  const previousActive = useRef(active);
  const [expanded, setExpanded] = useState(active);
  const [toolKeys, setToolKeys] = useState<string[]>([]);
  const [reasoningKeys, setReasoningKeys] = useState<string[]>([]);

  useEffect(() => {
    if (previousActive.current === active) return;
    previousActive.current = active;
    setExpanded(active);
    if (active) {
      setToolKeys([]);
      setReasoningKeys([]);
    }
  }, [active]);

  const toggleReasoning = useCallback((key: string) => {
    setReasoningKeys((keys) =>
      keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key],
    );
  }, []);

  return {
    expanded,
    setExpanded,
    toolKeys,
    setToolKeys,
    reasoningKeys,
    toggleReasoning,
  };
}
